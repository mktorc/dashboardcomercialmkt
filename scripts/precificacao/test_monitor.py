"""Testes do monitor: python3 -m unittest scripts/precificacao/test_monitor.py"""
import os, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "http://x")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "k")
sys.path.insert(0, str(Path(__file__).parent))
import monitor as M


def iso(horas_atras):
    return (M.AGORA - timedelta(hours=horas_atras)).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def banco(ritmo_h=2, versao=3, canc=5, up_h=3, ally_h=3, nossa_h=3):
    """Fake das consultas do monitor."""
    linhas = [{"x": [[10, 5]]} if i < canc else {} for i in range(10)]

    def f(caminho):
        if caminho.startswith("pricing_occupancy_pace?select=generated_at"):
            return [{"generated_at": iso(ritmo_h), "as_of": "2026-11-10"}]
        if caminho.startswith("pricing_occupancy_pace?select=payload"):
            return [{"payload": {"versao": versao, "hoje": "2026-11-10", "linhas": linhas}}]
        if "competitor_price_snapshots?select=collected_at,competitors" in caminho:
            out = []
            if up_h is not None:
                out.append({"collected_at": iso(up_h), "competitors": {"name": "UP Rent a Car"}})
            if ally_h is not None:
                out.append({"collected_at": iso(ally_h), "competitors": {"name": "Allycar"}})
            return out
        if caminho.startswith("our_rate_snapshots"):
            return [{"collected_at": iso(nossa_h), "source": "site_cotacao"}]
        return [{"equivalence": "parcial", "pickup_at": "2026-12-01T10:00"}]

    return f


class Monitor(unittest.TestCase):
    def rodar(self, **kw):
        M.resultados.clear()
        M.supabase = banco(**kw)
        M.checar_dados()
        return {(i): n for _, i, n, _ in M.resultados}

    def test_tudo_em_dia(self):
        r = self.rodar()
        self.assertNotIn("falha", r.values())

    def test_ocupacao_parada_vira_falha(self):
        self.assertEqual(self.rodar(ritmo_h=40)["Ocupação (ritmo)"], "falha")

    def test_cada_fonte_e_checada_separadamente(self):
        r = self.rodar(up_h=3, ally_h=60)
        self.assertEqual(r["Concorrente: UP Rent a Car"], "ok")
        self.assertEqual(r["Concorrente: Allycar"], "falha")

    def test_fonte_sem_nenhuma_coleta_recente_falha(self):
        self.assertEqual(self.rodar(ally_h=None)["Concorrente: Allycar"], "falha")

    def test_relatorio_antigo_ou_sem_cancelamentos_falha(self):
        self.assertEqual(self.rodar(versao=2)["Cancelamentos"], "falha")
        self.assertEqual(self.rodar(canc=0)["Cancelamentos"], "falha")

    def test_nossa_tarifa_parada_falha(self):
        self.assertEqual(self.rodar(nossa_h=50)["Nossa tarifa (site)"], "falha")

    def test_banco_inacessivel_nao_passa_em_silencio(self):
        M.resultados.clear()

        def quebra(_):
            raise OSError("sem rede")

        M.supabase = quebra
        with self.assertRaises(OSError):
            M.checar_dados()  # o main captura e registra como falha

    def test_agendamento_ausente_e_falha_mesmo_com_push_recente(self):
        M.resultados.clear()
        os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"] = "t", "o/r"
        sys.argv = ["monitor.py"]

        def gh(caminho, *a, **k):
            if "event=schedule" in caminho:
                return {"workflow_runs": []}  # nunca rodou pelo cron
            return {"workflow_runs": [{"status": "completed", "conclusion": "success", "event": "push", "created_at": iso(1)}]}

        M.github = gh
        M.checar_workflows()
        r = {(i): n for _, i, n, _ in M.resultados}
        self.assertEqual(r["previsao-ocupacao.yml (agendada)"], "falha")
        self.assertEqual(r["previsao-ocupacao.yml (última execução)"], "ok")  # etapas separadas: executou, mas não pelo agendamento

    def test_agendamento_antigo_falha(self):
        M.resultados.clear()
        os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"] = "t", "o/r"
        sys.argv = ["monitor.py"]
        M.github = lambda caminho, *a, **k: {"workflow_runs": [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(50)}]}
        M.checar_workflows()
        r = {(i): n for _, i, n, _ in M.resultados}
        self.assertEqual(r["coleta-concorrentes.yml (agendada)"], "falha")

    def test_ultima_execucao_com_erro_falha(self):
        M.resultados.clear()
        os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"] = "t", "o/r"
        sys.argv = ["monitor.py"]
        M.github = lambda caminho, *a, **k: {"workflow_runs": [{"status": "completed", "conclusion": "failure", "event": "schedule", "created_at": iso(2)}]}
        M.checar_workflows()
        r = {(i): n for _, i, n, _ in M.resultados}
        self.assertEqual(r["previsao-ocupacao.yml (agendada)"], "ok")
        self.assertEqual(r["previsao-ocupacao.yml (última execução)"], "falha")

    def _gh_com(self, agend, todas, chamadas):
        def gh(caminho, metodo="GET", corpo=None):
            if metodo == "POST":
                chamadas.append((caminho, corpo))
                return None
            return {"workflow_runs": agend if "event=schedule" in caminho else todas}

        return gh

    def _prep(self):
        M.resultados.clear()
        os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"] = "t", "o/r"
        sys.argv = ["monitor.py"]

    def test_autocorrecao_dispara_rotina_parada(self):
        self._prep()
        chamadas = []
        antiga = [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(60)}]
        M.github = self._gh_com(antiga, antiga, chamadas)  # sem nenhuma execução nas últimas 24 h
        M.checar_workflows()
        self.assertEqual(len(chamadas), 2)  # as duas rotinas
        self.assertTrue(chamadas[0][0].endswith("/dispatches"))
        self.assertEqual(chamadas[0][1], {"ref": "main"})
        r = {i: n for _, i, n, _ in M.resultados}
        self.assertEqual(r["previsao-ocupacao.yml (agendada)"], "falha")  # a falha do agendamento continua valendo
        self.assertEqual(r["previsao-ocupacao.yml (autocorreção)"], "aviso")

    def test_autocorrecao_nao_dispara_se_houve_execucao_recente(self):
        self._prep()
        chamadas = []
        agend_antiga = [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(60)}]
        recente = [{"status": "in_progress", "conclusion": None, "event": "push", "created_at": iso(2)}]
        M.github = self._gh_com(agend_antiga, recente, chamadas)
        M.checar_workflows()
        self.assertEqual(chamadas, [])

    def test_autocorrecao_ignora_push_concluido(self):
        self._prep()
        chamadas = []
        agend_antiga = [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(60)}]
        push = [{"status": "completed", "conclusion": "success", "event": "push", "created_at": iso(21)}]
        M.github = self._gh_com(agend_antiga, push, chamadas)
        M.checar_workflows()
        self.assertEqual(len(chamadas), 2)  # push concluído não prova atualização diária

    def test_autocorrecao_nao_dispara_com_agendamento_em_dia(self):
        self._prep()
        chamadas = []
        ok = [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(5)}]
        M.github = self._gh_com(ok, ok, chamadas)
        M.checar_workflows()
        self.assertEqual(chamadas, [])

    def test_frequente_parada_e_disparada_so_com_aviso(self):
        self._prep()
        chamadas = []
        M.github = self._gh_com([], [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(5)}], chamadas)
        M.checar_rotinas_frequentes()
        self.assertEqual(len(chamadas), len(M.ROTINAS_FREQUENTES))
        self.assertTrue(all(c[0].endswith("/dispatches") for c in chamadas))
        self.assertNotIn("falha", [n for _, _, n, _ in M.resultados])  # não abre a issue de precificação

    def test_frequente_em_dia_ou_rodando_nao_dispara(self):
        self._prep()
        chamadas = []
        M.github = self._gh_com([], [{"status": "completed", "conclusion": "success", "event": "schedule", "created_at": iso(0.5)}], chamadas)
        M.checar_rotinas_frequentes()
        M.github = self._gh_com([], [{"status": "in_progress", "conclusion": None, "event": "schedule", "created_at": iso(9)}], chamadas)
        M.checar_rotinas_frequentes()
        self.assertEqual(chamadas, [])

    def test_frequente_sem_nenhuma_execucao_e_disparada(self):
        self._prep()
        chamadas = []
        M.github = self._gh_com([], [], chamadas)
        M.checar_rotinas_frequentes()
        self.assertEqual(len(chamadas), len(M.ROTINAS_FREQUENTES))

    def test_sem_github_nao_dispara_nada(self):
        M.resultados.clear()
        sys.argv = ["monitor.py", "--sem-github"]
        chamadas = []
        M.github = lambda *a, **k: chamadas.append(a)
        M.checar_workflows()
        self.assertEqual(chamadas, [])


if __name__ == "__main__":
    unittest.main()
