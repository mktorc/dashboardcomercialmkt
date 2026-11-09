"""Testes das regras sazonais: python3 -m unittest scripts/precificacao/test_calendario.py (ou, dentro da pasta, python3 -m unittest)."""
import sys, unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import calendario as C

REF = {  # datas de referência conhecidas (terça de Carnaval, Sexta-feira Santa, quinta de Corpus Christi)
    2024: (date(2024, 2, 13), date(2024, 3, 29), date(2024, 5, 30)),
    2025: (date(2025, 3, 4), date(2025, 4, 18), date(2025, 6, 19)),
    2026: (date(2026, 2, 17), date(2026, 4, 3), date(2026, 6, 4)),
    2027: (date(2027, 2, 9), date(2027, 3, 26), date(2027, 5, 27)),
}


class Calendario(unittest.TestCase):
    def test_carnaval_semana_santa_e_corpus_christi_em_anos_diferentes(self):
        for ano, (carnaval, sexta, corpus) in REF.items():
            r = C.referencias(ano)
            self.assertEqual((r["carnaval"], r["semana_santa"], r["corpus_christi"]), (carnaval, sexta, corpus), ano)
            self.assertEqual(C.classificar_dia(carnaval)[2:], ("carnaval", 0))
            self.assertEqual(C.classificar_dia(sexta)[2:], ("semana_santa", 0))
            self.assertEqual(C.classificar_dia(corpus)[:1] + C.classificar_dia(corpus)[2:], ("Alta", "corpus_christi", 0))

    def test_data_que_foi_carnaval_num_ano_e_nao_no_seguinte(self):
        self.assertEqual(C.classificar_dia(date(2025, 3, 4))[:1] + C.classificar_dia(date(2025, 3, 4))[2:], ("Alta", "carnaval", 0))
        s, regra, ev, rel = C.classificar_dia(date(2026, 3, 4))  # 2026: entre Carnaval e Semana Santa
        self.assertEqual((s, ev, rel), ("Baixa", None, None))
        self.assertEqual(regra, "Entre Carnaval e Semana Santa")

    def test_janela_de_cinco_dias_antes_e_depois_do_carnaval(self):
        terca = REF[2026][0]
        for n in range(-5, 6):
            s, _, ev, rel = C.classificar_dia(terca + timedelta(days=n))
            self.assertEqual((s, ev, rel), ("Alta", "carnaval", n))
        self.assertIsNone(C.classificar_dia(terca + timedelta(days=6))[2])
        self.assertIsNone(C.classificar_dia(terca - timedelta(days=6))[2])

    def test_entre_carnaval_e_semana_santa_e_alta_ate_o_carnaval(self):
        self.assertEqual(C.classificar_dia(date(2026, 3, 15))[0], "Baixa")
        self.assertEqual(C.classificar_dia(date(2026, 5, 10))[0], "Baixa")  # março a maio
        self.assertEqual(C.classificar_dia(date(2026, 2, 5))[0], "Alta")  # janeiro até o Carnaval (GESTAO)
        self.assertEqual(C.classificar_dia(date(2026, 2, 5), C.LEGADO)[0], "Média")  # o legado não muda

    def test_virada_do_ano_e_um_unico_periodo_altissimo(self):
        for d in (date(2026, 12, 20), date(2026, 12, 31), date(2027, 1, 1), date(2027, 1, 5)):
            self.assertEqual(C.classificar_dia(d)[0], "Altíssima")
        self.assertEqual(C.classificar_dia(date(2026, 12, 19))[0], "Baixa")
        self.assertEqual(C.classificar_dia(date(2027, 1, 6))[0], "Alta")

    def test_meses_e_hierarquia(self):
        self.assertEqual(C.classificar_dia(date(2026, 6, 10))[0], "Baixíssima")
        self.assertEqual(C.classificar_dia(date(2026, 7, 15))[0], "Alta")
        self.assertEqual(C.classificar_dia(date(2026, 10, 1))[0], "Média")
        self.assertEqual(C.classificar_dia(date(2026, 12, 10))[0], "Baixa")

    def test_corpus_christi_tem_prioridade_sobre_junho_e_e_configuravel(self):
        d = REF[2025][2]  # 19/06/2025: junho seria Baixíssima
        self.assertEqual(C.classificar_dia(d)[0], "Alta")
        r = C.Regras(sazonalidade_evento={**C.GESTAO.sazonalidade_evento, "corpus_christi": "Média"})
        self.assertEqual(C.classificar_dia(d, r)[:1] + C.classificar_dia(d, r)[2:], ("Média", "corpus_christi", 0))

    def test_evento_e_preservado_mesmo_quando_altissima_prevalece(self):
        r = C.Regras(janelas={"carnaval": (-5, 5), "semana_santa": (-5, 2), "corpus_christi": (-200, 200)})
        s, _, ev, rel = C.classificar_dia(date(2026, 12, 25), r)
        self.assertEqual((s, ev), ("Altíssima", "corpus_christi"))

    def test_legado_igual_ao_calendario_publicado(self):
        # dim_calendario do estudo/previsão: as regras antigas continuam valendo (Carnaval terça−8 a terça+5, fevereiro Média)
        self.assertEqual(C.classificar(date(2026, 2, 9)), ("Alta", "Carnaval"))
        self.assertEqual(C.classificar(date(2026, 1, 20)), ("Alta", "Mês: janeiro (06/01 a 31/01)"))


if __name__ == "__main__":
    unittest.main()
