"""Monitor da cadeia de dados do Gestor de Precificação. Falha (exit 1) quando algo está atrasado, parado ou quebrado.

Uso: python3 scripts/precificacao/monitor.py [--sem-github]
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. No GitHub Actions usa também GITHUB_TOKEN e GITHUB_REPOSITORY (execuções agendadas).

Quatro etapas, verificadas separadamente (o que vale é o dado publicado; a execução só explica por quê):
  1. AGENDAMENTO  — o workflow rodou pelo cron (evento "schedule") dentro do prazo? Pegar só um push não conta: um workflow que só funciona
                    quando disparado à mão pode nunca rodar sozinho. Detecta também a rotina que simplesmente DEIXOU de executar.
  2. EXECUÇÃO     — a última execução (qualquer evento) terminou com sucesso?
  3. PUBLICAÇÃO   — o dado novo está no banco (ocupação, cancelamentos, cada fonte de concorrente, nossa tarifa)?
  4. APLICAÇÃO    — a tela lê as mesmas tabelas e mostra a idade de cada dado (painel de saúde em Prioridades); este script não vê o navegador.

Autocorreção: se o agendamento falhou e a rotina ficou 24 h sem execução agendada ou manual (push não conta), o monitor a dispara (workflow_dispatch) e registra isso;
a falha continua valendo (issue aberta), porque o agendador do GitHub é o que está com problema.

Validade das cotações: para CADA concorrente, a cotação mais recente de cada data de retirada (próximos 45 dias) não pode passar de 7 dias (aviso)
nem de 9 dias (falha, que é o limite que a tela aceita no Mercado). Para as fontes próprias vencidas, o monitor dispara uma coleta de reposição
(workflow_dispatch com `inicio` na data vencida e `sem_discovercars`), no máximo 3 por dia. O DiscoverCars (pago) só gera aviso.

Resultado: relatório no log e em $GITHUB_STEP_SUMMARY. Se houver falha, abre (ou atualiza) uma issue "Alerta: dados de precificação"
e a fecha sozinha quando tudo volta ao normal.
"""
import json, os, sys, urllib.error, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hq import carregar_env

carregar_env()
AGORA = datetime.now(timezone.utc)
# Rotinas diárias às 09:00 UTC: 26 h dá folga para atraso do agendador; 30 h para a presença da execução agendada.
LIMITE_DADO = timedelta(hours=26)
LIMITE_AGENDADO = timedelta(hours=30)
FONTES_ESPERADAS = ("UP Rent a Car", "Allycar")  # concorrentes que a coleta diária deve atualizar
WORKFLOWS = {  # arquivo do workflow -> o que ele alimenta
    "previsao-ocupacao.yml": "ocupação, previsão e cancelamentos",
    "coleta-concorrentes.yml": "preços de concorrentes e nossa tarifa",
}
# Validade das cotações por concorrente. A tela só usa coleta de até 9 dias (MAX_AGE_DAYS em src/lib/competitiveness.ts): aviso aos 7, falha aos 9.
FONTES_PROPRIAS = ("UP Rent a Car", "Allycar", "Florida Rental Car", "National", "Alamo")  # coleta grátis, 2x ao dia; o resto vem do DiscoverCars (pago)
LIMITE_COTACAO_AVISO = timedelta(days=7)
LIMITE_COTACAO_FALHA = timedelta(days=9)
HORIZONTE_COTACAO_DIAS = 45
ANTECEDENCIA_MINIMA_DIAS = 3  # os sites só cotam com ~48 h de antecedência: data mais próxima que isso não dá para recoletar
MAX_REPOSICOES_POR_DIA = 3
ISSUE_TITULO = "Alerta: dados de precificação"
# Autocorreção: se o agendamento falhou e a rotina não teve execução agendada/manual (push não conta) nesse prazo, o monitor a dispara pela API.
# O prazo evita disparos repetidos (no máximo um por dia por rotina) e não atropela uma execução em andamento ou recente.
LIMITE_REDISPARO = timedelta(hours=24)
# Rotinas frequentes (fora da precificação) que o agendador do GitHub costuma pular: se a última execução (qualquer evento) for mais
# antiga que o prazo, o monitor dispara. Só AVISO, nunca falha: não abrem a issue de precificação.
ROTINAS_FREQUENTES = {  # arquivo -> (o que alimenta, prazo sem execução)
    "sync-oportunidades-clickmassa.yml": ("oportunidades do ClickMassa", timedelta(hours=2)),
    "sync-contatos-clickmassa.yml": ("contatos do ClickMassa", timedelta(hours=3)),
}

resultados = []  # (etapa, item, nivel, detalhe)  nivel: ok | aviso | falha


def reg(etapa, item, nivel, detalhe):
    resultados.append((etapa, item, nivel, detalhe))


def idade(iso):
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")[:19] + "+00:00")
    return AGORA - t


def txt(td):
    h = td.total_seconds() / 3600
    return f"{h:.1f} h" if h < 48 else f"{h / 24:.1f} dias"


def supabase(caminho):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + caminho
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(url, headers={"apikey": chave, "Authorization": f"Bearer {chave}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def github(caminho, metodo="GET", corpo=None):
    req = urllib.request.Request(
        "https://api.github.com/" + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        method=metodo,
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read()
        return json.loads(t) if t else None


def checar_dados():
    # 3. PUBLICAÇÃO — ocupação e cancelamentos
    r = supabase("pricing_occupancy_pace?select=generated_at,as_of&order=generated_at.desc&limit=1")
    if not r:
        reg(3, "Ocupação (ritmo)", "falha", "nenhum relatório publicado")
    else:
        ida = idade(r[0]["generated_at"])
        reg(3, "Ocupação (ritmo)", "ok" if ida <= LIMITE_DADO else "falha",
            f"publicado há {txt(ida)} (referência {r[0]['as_of']}); limite {txt(LIMITE_DADO)}")
        payload = supabase("pricing_occupancy_pace?select=payload&order=generated_at.desc&limit=1")[0]["payload"]
        com_canc = sum(1 for l in payload["linhas"] if l.get("x"))
        if payload.get("versao", 0) < 3 or com_canc == 0:
            reg(3, "Cancelamentos", "falha", f"relatório v{payload.get('versao')} com {com_canc} linhas com cancelamento (esperado v3+ e > 0)")
        else:
            reg(3, "Cancelamentos", "ok", f"v{payload['versao']}, {com_canc} linhas com cancelamento")
        if payload.get("hoje") != r[0]["as_of"]:
            reg(3, "Data de referência", "aviso", f"referência do relatório {payload.get('hoje')} difere do as_of {r[0]['as_of']}")

    # 3. PUBLICAÇÃO — concorrentes por fonte (cada fonte tem de ter coleta recente; uma fonte parada não pode ficar escondida pela outra)
    desde = (AGORA - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S")
    snaps = supabase(f"competitor_price_snapshots?select=collected_at,competitors(name)&collected_at=gte.{desde}&order=collected_at.desc&limit=1000")
    ultima = {}
    for s in snaps:
        nome = (s.get("competitors") or {}).get("name") or "—"
        ultima.setdefault(nome, s["collected_at"])
    for fonte in FONTES_ESPERADAS:
        if fonte not in ultima:
            reg(3, f"Concorrente: {fonte}", "falha", "sem coleta nos últimos 3 dias")
        else:
            ida = idade(ultima[fonte])
            reg(3, f"Concorrente: {fonte}", "ok" if ida <= LIMITE_DADO else "falha", f"última coleta há {txt(ida)}")

    # nossa tarifa
    o = supabase("our_rate_snapshots?select=collected_at,source&order=collected_at.desc&limit=1")
    if not o:
        reg(3, "Nossa tarifa (site)", "falha", "sem registros")
    else:
        ida = idade(o[0]["collected_at"])
        reg(3, "Nossa tarifa (site)", "ok" if ida <= LIMITE_DADO else "falha", f"última coleta há {txt(ida)} ({o[0]['source']})")

    # qualidade do mercado (aviso, não falha): cobertura e equivalência
    ult26 = supabase(f"competitor_price_snapshots?select=equivalence_notes,competitors(name)&collected_at=gte.{(AGORA - LIMITE_DADO).strftime('%Y-%m-%dT%H:%M:%S')}&limit=1000")
    if ult26:
        # Extras (motorista adicional e bebê conforto): cada fonte precisa trazer a marca; sem ela a tela não usa a cotação.
        por_fonte = {}
        for r in ult26:
            nome = (r.get("competitors") or {}).get("name") or "—"
            tot, com = por_fonte.get(nome, (0, 0))
            por_fonte[nome] = (tot + 1, com + (1 if "extras: motorista=" in (r.get("equivalence_notes") or "") else 0))
        for nome, (tot, com) in por_fonte.items():
            reg(3, f"Extras: {nome}", "ok" if com == tot else "aviso", f"{com} de {tot} cotações das últimas 26 h com os extras (motorista adicional e bebê conforto) lidos")
    recentes = supabase(f"competitor_price_snapshots?select=equivalence,pickup_at&collected_at=gte.{(AGORA - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S')}&limit=1000")
    if recentes:
        # A coleta automática grava sempre "parcial" (nunca "equivalente" sem evidência), então só conta como problema
        # cotação que a tela de Competitividade não usa: tudo "nao_avaliada"/"nao_equivalente".
        usaveis = sum(1 for s in recentes if s["equivalence"] in ("equivalente", "parcial"))
        datas = len({s["pickup_at"][:10] for s in recentes})
        reg(3, "Qualidade do mercado (7 dias)", "aviso" if usaveis == 0 else "ok",
            f"{datas} datas de retirada cotadas; {usaveis} de {len(recentes)} cotações utilizáveis na comparação (equivalentes ou parciais; amostra de até 1000)")


def supabase_todas(caminho, pagina=1000, maximo=100000):
    """Lê todas as linhas (o banco devolve no máximo 1.000 por consulta). `caminho` precisa de order estável."""
    saida = []
    while len(saida) < maximo:
        lote = supabase(f"{caminho}&limit={pagina}&offset={len(saida)}")
        saida += lote
        if len(lote) < pagina:
            break
    return saida


def checar_validade_cotacoes():
    """Idade da cotação mais recente de cada (concorrente, data de retirada). Devolve as datas vencidas das fontes próprias (para reposição)."""
    hoje = AGORA.date()
    ini = hoje + timedelta(days=ANTECEDENCIA_MINIMA_DIAS)
    fim = hoje + timedelta(days=HORIZONTE_COTACAO_DIAS)
    desde = (AGORA - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S")
    linhas = supabase_todas(
        f"competitor_price_snapshots?select=pickup_at,collected_at,competitors(name)&pickup_at=gte.{ini}&pickup_at=lt.{fim}&collected_at=gte.{desde}&order=id"
    )
    ultima = {}
    for r in linhas:
        k = ((r.get("competitors") or {}).get("name") or "—", r["pickup_at"][:10])
        if k not in ultima or r["collected_at"] > ultima[k]:
            ultima[k] = r["collected_at"]
    por_fonte = {}
    for (nome, dia), iso in ultima.items():
        por_fonte.setdefault(nome, []).append((idade(iso), dia))
    vencidas = set()
    for nome in sorted(por_fonte):
        itens = por_fonte[nome]
        mais_velha = max(i[0] for i in itens)
        velhas = [dia for ida, dia in itens if ida > LIMITE_COTACAO_AVISO]
        propria = nome in FONTES_PROPRIAS
        if not velhas:
            reg(3, f"Validade: {nome}", "ok", f"{len(itens)} datas de retirada; a mais velha tem {txt(mais_velha)}")
            continue
        nivel = "falha" if propria and mais_velha > LIMITE_COTACAO_FALHA else "aviso"
        origem = "" if propria else " (DiscoverCars: pago, coleta de 3 em 3 dias; só aviso)"
        reg(3, f"Validade: {nome}", nivel,
            f"{len(velhas)} de {len(itens)} datas com cotação acima de {txt(LIMITE_COTACAO_AVISO)}; a mais velha tem {txt(mais_velha)}{origem}")
        if propria:
            vencidas.update(velhas)
    if not por_fonte:
        reg(3, "Validade das cotações", "aviso", "nenhuma cotação de retirada futura nos últimos 30 dias")
    return sorted(vencidas)


def repor_datas_vencidas(vencidas):
    """Dispara a coleta (sem DiscoverCars) começando na data vencida: ela recota aquele dia da semana pelas próximas 26 semanas."""
    if not vencidas or "--sem-github" in sys.argv or not os.environ.get("GITHUB_TOKEN") or not os.environ.get("GITHUB_REPOSITORY"):
        return
    repo = os.environ["GITHUB_REPOSITORY"]
    arquivo = "coleta-concorrentes.yml"
    item = "Reposição de cotações"
    try:
        runs = github(f"repos/{repo}/actions/workflows/{arquivo}/runs?per_page=20")["workflow_runs"]
    except urllib.error.HTTPError as e:
        reg(1, item, "aviso", f"não foi possível consultar o GitHub (HTTP {e.code})")
        return
    if any(r["status"] != "completed" or idade(r["created_at"]) <= timedelta(hours=5) for r in runs):
        reg(1, item, "aviso", f"{len(vencidas)} datas vencidas, mas há coleta em andamento ou com menos de 5 h: não disparada")
        return
    hoje_ = [r for r in runs if r["event"] == "workflow_dispatch" and idade(r["created_at"]) <= timedelta(hours=24)]
    if len(hoje_) >= MAX_REPOSICOES_POR_DIA:
        reg(1, item, "aviso", f"{len(vencidas)} datas vencidas, mas já houve {len(hoje_)} disparos manuais em 24 h: limite diário atingido (veja se alguma fonte está bloqueada)")
        return
    por_dia_semana = {}
    for dia in vencidas:  # uma data por dia da semana (a primeira): o coletor repete de 7 em 7 dias a partir dela
        por_dia_semana.setdefault(date.fromisoformat(dia).weekday(), dia)
    disparadas = []
    for dia in list(por_dia_semana.values())[: MAX_REPOSICOES_POR_DIA - len(hoje_)][:2]:
        try:
            github(f"repos/{repo}/actions/workflows/{arquivo}/dispatches", "POST",
                   {"ref": "main", "inputs": {"sem_discovercars": "true", "inicio": dia}})
            disparadas.append(dia)
        except urllib.error.HTTPError as e:
            reg(1, item, "aviso", f"não foi possível disparar a coleta a partir de {dia} (HTTP {e.code})")
    if disparadas:
        reg(1, item, "aviso", f"{len(vencidas)} datas com cotação acima de {txt(LIMITE_COTACAO_AVISO)}: coleta de reposição disparada a partir de {', '.join(disparadas)} (sem DiscoverCars)")


def autocorrigir(repo, arquivo, execucoes):
    """Dispara a rotina que deixou de rodar pelo agendamento, se também não houve execução recente agendada ou manual/do monitor.
    Run de push já concluído não conta (run em andamento conta): ele só roda quando o código muda e não garante a atualização diária."""
    recentes = [r for r in execucoes if (r["event"] != "push" or r["status"] != "completed") and idade(r["created_at"]) <= LIMITE_REDISPARO]
    if recentes:
        reg(1, f"{arquivo} (autocorreção)", "aviso", f"não disparada: houve execução há {txt(idade(recentes[0]['created_at']))} ({recentes[0]['event']})")
        return
    corpo = {"ref": "main"}
    if arquivo == "coleta-concorrentes.yml":
        # Disparo manual roda o DiscoverCars (robô pago na Apify) a menos que se peça para pular: o monitor nunca deve gastar sozinho.
        corpo["inputs"] = {"sem_discovercars": "true"}
    try:
        github(f"repos/{repo}/actions/workflows/{arquivo}/dispatches", "POST", corpo)
        reg(1, f"{arquivo} (autocorreção)", "aviso", f"sem execução há mais de {txt(LIMITE_REDISPARO)}: disparada pelo monitor (workflow_dispatch)")
    except urllib.error.HTTPError as e:
        reg(1, f"{arquivo} (autocorreção)", "falha", f"não foi possível disparar (HTTP {e.code}); verifique a permissão actions: write")


def checar_workflows():
    if "--sem-github" in sys.argv or not os.environ.get("GITHUB_TOKEN") or not os.environ.get("GITHUB_REPOSITORY"):
        reg(1, "Execuções no GitHub", "aviso", "não verificadas (sem GITHUB_TOKEN/GITHUB_REPOSITORY: rodando fora do Actions)")
        return
    repo = os.environ["GITHUB_REPOSITORY"]
    for arquivo, alimenta in WORKFLOWS.items():
        try:
            agend = github(f"repos/{repo}/actions/workflows/{arquivo}/runs?event=schedule&per_page=5")["workflow_runs"]
            todas = github(f"repos/{repo}/actions/workflows/{arquivo}/runs?per_page=5")["workflow_runs"]
        except urllib.error.HTTPError as e:
            reg(1, arquivo, "falha", f"não foi possível consultar o GitHub (HTTP {e.code})")
            continue
        # 1. AGENDAMENTO
        agendamento_ok = False
        if not agend:
            reg(1, f"{arquivo} (agendada)", "falha", f"nenhuma execução pelo agendamento encontrada ({alimenta}); só push/manual não prova que roda sozinho")
        else:
            ida = idade(agend[0]["created_at"])
            agendamento_ok = ida <= LIMITE_AGENDADO
            reg(1, f"{arquivo} (agendada)", "ok" if agendamento_ok else "falha", f"última execução agendada há {txt(ida)}; limite {txt(LIMITE_AGENDADO)}")
        if not agendamento_ok:
            autocorrigir(repo, arquivo, todas)
        # 2. EXECUÇÃO
        concluidas = [r for r in todas if r["status"] == "completed"]
        if concluidas:
            u = concluidas[0]
            reg(2, f"{arquivo} (última execução)", "ok" if u["conclusion"] == "success" else "falha",
                f"{u['event']} há {txt(idade(u['created_at']))}: {u['conclusion']}")
        else:
            reg(2, f"{arquivo} (última execução)", "aviso", "nenhuma execução concluída nas últimas 5")


def checar_rotinas_frequentes():
    """Dispara a rotina frequente que ficou sem execução além do prazo (o agendador do GitHub pula crons curtos)."""
    if "--sem-github" in sys.argv or not os.environ.get("GITHUB_TOKEN") or not os.environ.get("GITHUB_REPOSITORY"):
        return
    repo = os.environ["GITHUB_REPOSITORY"]
    for arquivo, (alimenta, prazo) in ROTINAS_FREQUENTES.items():
        item = f"{arquivo} (frequente)"
        try:
            runs = github(f"repos/{repo}/actions/workflows/{arquivo}/runs?per_page=1")["workflow_runs"]
        except urllib.error.HTTPError as e:
            reg(1, item, "aviso", f"não foi possível consultar o GitHub (HTTP {e.code})")
            continue
        u = runs[0] if runs else None
        if u and (u["status"] != "completed" or idade(u["created_at"]) <= prazo):
            sucesso = u["status"] != "completed" or u["conclusion"] == "success"
            reg(1, item, "ok" if sucesso else "aviso",
                f"{alimenta}: última execução há {txt(idade(u['created_at']))} ({u['event']}: {u['conclusion'] or u['status']})")
            continue
        try:
            github(f"repos/{repo}/actions/workflows/{arquivo}/dispatches", "POST", {"ref": "main"})
            quando = f"há {txt(idade(u['created_at']))}" if u else "nunca"
            reg(1, item, "aviso", f"{alimenta}: última execução {quando} (prazo {txt(prazo)}); disparada pelo monitor")
        except urllib.error.HTTPError as e:
            reg(1, item, "aviso", f"{alimenta}: não foi possível disparar (HTTP {e.code})")


def publicar_resumo(falhas, avisos):
    linhas = [f"## Saúde dos dados de precificação ({AGORA.strftime('%Y-%m-%d %H:%M')} UTC)", "", "| Etapa | Item | Situação | Detalhe |", "|---|---|---|---|"]
    nomes = {1: "1 Agendamento", 2: "2 Execução", 3: "3 Publicação", 4: "4 Aplicação"}
    simbolo = {"ok": "OK", "aviso": "AVISO", "falha": "FALHA"}
    for etapa, item, nivel, detalhe in sorted(resultados, key=lambda x: x[0]):
        linhas.append(f"| {nomes[etapa]} | {item} | {simbolo[nivel]} | {detalhe} |")
    linhas += ["", "A etapa 4 (aplicação) é o painel de saúde dos dados na tela de Prioridades: lê as mesmas tabelas e mostra a idade de cada dado."]
    corpo = "\n".join(linhas)
    print(corpo)
    destino = os.environ.get("GITHUB_STEP_SUMMARY")
    if destino:
        with open(destino, "a", encoding="utf-8") as f:
            f.write(corpo + "\n")
    return corpo


def sincronizar_issue(corpo, falhas):
    if not os.environ.get("GITHUB_TOKEN") or not os.environ.get("GITHUB_REPOSITORY") or "--sem-github" in sys.argv:
        return
    repo = os.environ["GITHUB_REPOSITORY"]
    try:
        abertas = [i for i in github(f"repos/{repo}/issues?state=open&per_page=50") if i["title"] == ISSUE_TITULO and "pull_request" not in i]
        if falhas:
            texto = f"{len(falhas)} verificação(ões) com falha em {AGORA.strftime('%Y-%m-%d %H:%M')} UTC:\n\n" + "\n".join(f"- **{i}**: {d}" for _, i, _, d in falhas) + "\n\n" + corpo
            if abertas:
                github(f"repos/{repo}/issues/{abertas[0]['number']}/comments", "POST", {"body": texto})
            else:
                github(f"repos/{repo}/issues", "POST", {"title": ISSUE_TITULO, "body": texto})
        elif abertas:
            for i in abertas:
                github(f"repos/{repo}/issues/{i['number']}/comments", "POST", {"body": "Tudo normalizado: nenhuma verificação com falha. Fechando."})
                github(f"repos/{repo}/issues/{i['number']}", "PATCH", {"state": "closed"})
    except urllib.error.HTTPError as e:
        print(f"Aviso: não foi possível atualizar a issue de alerta (HTTP {e.code}); a falha do workflow continua valendo.")


if __name__ == "__main__":
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not os.environ.get(k):
            raise SystemExit(f"Variável de ambiente ausente: {k}")
    try:
        checar_dados()
    except Exception as e:  # o banco inacessível também é um alerta
        reg(3, "Consulta ao banco", "falha", f"{type(e).__name__}: {str(e)[:160]}")
    vencidas = []
    try:
        vencidas = checar_validade_cotacoes()
    except Exception as e:
        reg(3, "Validade das cotações", "aviso", f"não foi possível verificar: {type(e).__name__}: {str(e)[:160]}")
    checar_workflows()
    checar_rotinas_frequentes()
    repor_datas_vencidas(vencidas)
    falhas = [r for r in resultados if r[2] == "falha"]
    avisos = [r for r in resultados if r[2] == "aviso"]
    corpo = publicar_resumo(falhas, avisos)
    sincronizar_issue(corpo, falhas)
    if falhas:
        raise SystemExit(f"{len(falhas)} verificação(ões) com falha.")
