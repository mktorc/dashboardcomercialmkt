"""Gera o relatório HTML do estudo de precificação a partir do cache DuckDB (sem chamar a API).

Uso: python3 scripts/precificacao/analisar.py [--fim AAAA-MM-DD]
Saídas em data/precificacao/relatorio/: relatorio.html (único, completo) e CSVs de apoio.
"""
import argparse, csv, json, re, sys
from datetime import date, datetime, timedelta
from html import escape
from pathlib import Path

import duckdb
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import graficos as g
import tema

DB = Path("data/precificacao/hq_cache.duckdb")
OUT = Path("data/precificacao/relatorio")
INI = date(2024, 1, 1)
LIMIAR_OCIOSO, LIMIAR_ESGOTADO, N_MIN = 0.40, 0.95, 30
FROTA_MIN = 3  # categoria com frota média menor que isso não entra em conclusões (1 veículo vendido 4 vezes = 400%)
SAZ = ["Altíssima", "Alta", "Média", "Baixa", "Baixíssima"]
BINS_ANT = [("0–3", 0, 3), ("4–7", 4, 7), ("8–14", 8, 14), ("15–30", 15, 30), ("31–60", 31, 60), ("61–90", 61, 90), ("90+", 91, 10_000)]
BINS_DUR = [("1–3", 1, 3), ("4–7", 4, 7), ("8–14", 8, 14), ("15+", 15, 10_000)]
DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

# ---------- formatação ----------
def num(v, d=0):
    return "–" if v is None else f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
def pct(v, d=1):
    return "–" if v is None else num(v * 100, d) + "%"
def usd(v, d=2):
    return "–" if v is None else "US$ " + num(v, d)


class Rel:
    def __init__(self, con):
        self.con = con
        self.secoes = []
        self.csvs = {}

    def q(self, sql, *args):
        return self.con.execute(sql, list(args)).fetchall()

    def csv(self, nome, cols, rows):
        self.csvs[nome] = (cols, rows)


def tabela(cols, rows, fmts=None, n_col=None, ident=0):
    """rows: tuplas. fmts: função por coluna (None = texto). n_col: índice da coluna `n` (n < N_MIN marca 'amostra pequena')."""
    fmts = fmts or [None] * len(cols)
    cab = "".join(f'<th class="{"n" if i >= ident and fmts[i] else ""}">{escape(c)}</th>' for i, c in enumerate(cols))
    corpo = []
    for r in rows:
        fraca = n_col is not None and r[n_col] is not None and r[n_col] < N_MIN
        cel = "".join(f'<td class="{"n" if i >= ident and fmts[i] else ""}">{escape(str(fmts[i](v) if fmts[i] else ("–" if v is None else v)))}</td>' for i, v in enumerate(r))
        corpo.append(f'<tr class="{"fraca" if fraca else ""}">{cel}</tr>')
    return f'<div class="tabela"><table style="--cols:{len(cols)}"><thead><tr>{cab}</tr></thead><tbody>{"".join(corpo)}</tbody></table></div>'


def nota(txt, tipo="aviso"):
    return f'<div class="card {tipo}">{txt}</div>'


def kpis(itens):
    return '<div class="kpis">' + "".join(f'<div class="card kpi"><b>{v}</b><span>{escape(r)}</span></div>' for r, v in itens) + "</div>"


def sub(titulo, texto=""):
    return f"<h3>{escape(titulo)}</h3>" + (f'<p class="sub">{texto}</p>' if texto else "")


def tag_saz(s):
    return f'<span class="tag" style="background:{tema.SAZONALIDADE.get(s, "#888")}">{s}</span>'


# ---------- estatística ----------
def ols(y, X):
    y, X = np.asarray(y, float), np.asarray(X, float)
    n, p = X.shape
    if n <= p:
        return None
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ beta
    s2 = float(res @ res) / (n - p)
    try:
        se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
    except np.linalg.LinAlgError:
        return None
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return beta, se, 1 - float(res @ res) / ss_tot if ss_tot else None, n


def ranks(x):
    u, inv, cnt = np.unique(x, return_inverse=True, return_counts=True)
    return (np.cumsum(cnt) - (cnt - 1) / 2)[inv]


def spearman(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = len(a)
    if n < 5 or a.std() == 0 or b.std() == 0:
        return None, None, None, n
    r = float(np.corrcoef(ranks(a), ranks(b))[0, 1])
    if abs(r) >= 0.9999:
        return r, r, r, n
    z, e = np.arctanh(r), 1.96 / np.sqrt(max(n - 3, 1))
    return r, float(np.tanh(z - e)), float(np.tanh(z + e)), n


# ---------- preparação das tabelas derivadas ----------
def preparar(con, fim):
    ini = INI.isoformat()
    con.execute("DROP TABLE IF EXISTS frota_valida")
    con.execute(f"""CREATE TABLE frota_valida AS
      SELECT v.id, v.chave, v.categoria_id, coalesce(v.data_compra, v.data_entrada) AS entrada, v.data_saida AS saida,
             v.data_compra IS NULL AS entrada_alternativa
      FROM veiculos v
      WHERE try_cast(v.chave AS INT) BETWEEN 1 AND 125 AND coalesce(v.data_compra, v.data_entrada) IS NOT NULL
        AND coalesce(v.data_compra, v.data_entrada) <= DATE '{fim}' AND (v.data_saida IS NULL OR v.data_saida > DATE '{ini}')""")
    con.execute("DROP TABLE IF EXISTS frota_dia_categoria")
    con.execute(f"""CREATE TABLE frota_dia_categoria AS
      SELECT c.data, v.categoria_id, count(*) AS frota FROM dim_calendario c
      JOIN frota_valida v ON v.entrada <= c.data AND (v.saida IS NULL OR c.data < v.saida)
      WHERE c.data BETWEEN DATE '{ini}' AND DATE '{fim}' GROUP BY 1, 2""")
    con.execute("DROP TABLE IF EXISTS reservas_flags")
    con.execute("""CREATE TABLE reservas_flags AS
      SELECT r.id,
        EXISTS(SELECT 1 FROM reserva_veiculos rv LEFT JOIN veiculos v ON v.id = rv.veiculo_id
               WHERE rv.reserva_id = r.id AND (v.id IS NULL OR try_cast(v.chave AS INT) NOT BETWEEN 1 AND 125)) AS fora_faixa,
        EXISTS(SELECT 1 FROM reserva_veiculos rv JOIN veiculos v ON v.id = rv.veiculo_id
               WHERE rv.reserva_id = r.id AND v.categoria_id <> r.categoria_id) AS upgrade,
        r.dias <> greatest(1, ceil(epoch(r.devolucao - r.retirada) / 86400.0)) AS dias_divergente,
        coalesce(r.rack_total, 0) <= 0 AS rack_zero,
        NOT EXISTS(SELECT 1 FROM reserva_veiculos rv WHERE rv.reserva_id = r.id) AS sem_veiculo
      FROM reservas r WHERE r.status = 'completed'""")
    con.execute("DROP TABLE IF EXISTS diarias")
    con.execute(f"""CREATE TABLE diarias AS
      WITH e AS (SELECT r.*, unnest(range(greatest(r.dias, 1))) AS k FROM reservas r WHERE r.status = 'completed')
      SELECT e.id AS reserva_id, e.categoria_id, coalesce(cat.nome, 'Categoria ' || e.categoria_id || ' (sem nome)') AS categoria,
        CAST(e.retirada AS DATE) + CAST(e.k AS INT) AS data,
        date_diff('day', CAST(e.criada_em AS DATE), CAST(e.retirada AS DATE) + CAST(e.k AS INT)) AS antecedencia,
        e.dias, dayofweek(CAST(e.retirada AS DATE)) AS dow_retirada, month(e.criada_em) AS mes_criacao, year(e.criada_em) AS ano_criacao,
        CASE WHEN NOT f.rack_zero THEN e.rack_total / greatest(e.dias, 1) END AS preco_final,
        CASE WHEN NOT f.rack_zero THEN (e.rack_total + e.desconto) / greatest(e.dias, 1) END AS preco_base,
        CASE WHEN NOT f.rack_zero THEN e.desconto / greatest(e.dias, 1) END AS desconto_dia,
        CASE WHEN NOT f.rack_zero AND e.rack_total + e.desconto > 0 THEN e.desconto / (e.rack_total + e.desconto) END AS desconto_pct,
        cal.sazonalidade, cal.regra_aplicada, f.fora_faixa, f.upgrade, f.dias_divergente, f.rack_zero
      FROM e JOIN reservas_flags f ON f.id = e.id JOIN dim_calendario cal ON cal.data = CAST(e.retirada AS DATE) + CAST(e.k AS INT)
      LEFT JOIN categorias cat ON cat.id = e.categoria_id
      WHERE CAST(e.retirada AS DATE) + CAST(e.k AS INT) BETWEEN DATE '{ini}' AND DATE '{fim}'""")
    con.execute("DROP TABLE IF EXISTS base_diaria")
    con.execute("""CREATE TABLE base_diaria AS
      SELECT f.data, f.categoria_id, coalesce(cat.nome, 'Categoria ' || f.categoria_id || ' (sem nome)') AS categoria,
        cal.sazonalidade, cal.regra_aplicada, f.frota, coalesce(d.v, 0) AS diarias_vendidas,
        coalesce(d.v, 0)::DOUBLE / f.frota AS ocupacao, d.antec_media, d.preco_final_medio, d.preco_base_medio, d.desc_pct_medio,
        coalesce(d.fora, 0) AS diarias_fora_faixa, dayofweek(f.data) AS dow, month(f.data) AS mes, year(f.data) AS ano
      FROM frota_dia_categoria f JOIN dim_calendario cal ON cal.data = f.data LEFT JOIN categorias cat ON cat.id = f.categoria_id
      LEFT JOIN (SELECT data, categoria_id, count(*) AS v, avg(antecedencia) AS antec_media, avg(preco_final) AS preco_final_medio,
                        avg(preco_base) AS preco_base_medio, avg(desconto_pct) AS desc_pct_medio, count(*) FILTER (WHERE fora_faixa) AS fora
                 FROM diarias GROUP BY 1, 2) d ON d.data = f.data AND d.categoria_id = f.categoria_id""")
    con.execute("DROP TABLE IF EXISTS base_diaria_total")
    con.execute("""CREATE TABLE base_diaria_total AS
      SELECT data, any_value(sazonalidade) AS sazonalidade, any_value(regra_aplicada) AS regra, sum(frota) AS frota, sum(diarias_vendidas) AS vendidas,
             sum(diarias_vendidas)::DOUBLE / sum(frota) AS ocupacao, any_value(dow) AS dow, any_value(mes) AS mes, any_value(ano) AS ano
      FROM base_diaria GROUP BY 1""")


# ---------- seções ----------


# ---------- seções (linguagem simples) ----------
ORD = "array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade)"


def forca(rho):
    """Traduz o coeficiente de correlação para palavras."""
    if rho is None:
        return "–"
    a = abs(rho)
    nivel = "quase nenhuma" if a < 0.10 else "fraca" if a < 0.20 else "moderada" if a < 0.40 else "forte"
    if a < 0.10:
        return f"{nivel} ({num(rho, 2)})"
    return f"{nivel}, {'positiva' if rho > 0 else 'negativa'} ({num(rho, 2)})"


def sec_resumo(R, fim):
    q = R.q
    n_res = q("SELECT count(*) FROM reservas WHERE status='completed' AND retirada::date BETWEEN ? AND ?", INI, fim)[0][0]
    n_dia, preco_f, preco_b = q("SELECT count(*), avg(preco_final), avg(preco_base) FROM diarias")[0]
    ocup = q("SELECT sum(diarias_vendidas)::DOUBLE / sum(frota) FROM base_diaria")[0][0]
    frota_m = q("SELECT avg(frota) FROM base_diaria_total")[0][0]
    h = kpis([("Reservas concluídas", num(n_res)), ("Diárias vendidas", num(n_dia)), ("Ocupação média", pct(ocup)),
              ("Frota média (carros ativos)", num(frota_m, 1)), ("Preço médio pago por diária", usd(preco_f)), ("Preço médio antes do desconto", usd(preco_b))])
    corte, hoje, andamento = R.corte
    if corte:
        h += nota(f"<b>O período termina em {fim.strftime('%d/%m/%Y')}.</b> Há aluguéis ainda em andamento (o primeiro começou em {andamento.strftime('%d/%m/%Y')}). "
                  f"Como só entram reservas concluídas, incluir as semanas até hoje ({hoje.strftime('%d/%m/%Y')}) faria a ocupação parecer menor do que é.", "alerta")
    h += nota(f"<b>O que está sendo medido.</b> Diárias de {INI.strftime('%d/%m/%Y')} a {fim.strftime('%d/%m/%Y')}, só reservas concluídas, em dólar. "
              "Frota = carros de chave 001 a 125 ativos em cada dia. Preço pago = valor da diária já com desconto (o “rack”). "
              "Preço antes do desconto = preço pago + desconto. Ocupação = diárias vendidas ÷ carros disponíveis.")
    top = q("""SELECT sazonalidade, categoria, avg(ocupacao) o FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ? ORDER BY o DESC LIMIT 3""", N_MIN, FROTA_MIN)
    low = q("""SELECT sazonalidade, categoria, avg(ocupacao) o FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ? ORDER BY o LIMIT 3""", N_MIN, FROTA_MIN)
    mapa = dict(q("SELECT sazonalidade, sum(vendidas)::DOUBLE/sum(frota) FROM base_diaria_total GROUP BY 1"))
    itens = ["Ocupação por sazonalidade: " + " · ".join(f"{s} {pct(mapa[s])}" for s in SAZ if s in mapa) + ".",
             "Mais cheios: " + "; ".join(f"{a} / {b}: {pct(c)}" for a, b, c in top) + ".",
             "Mais vazios: " + "; ".join(f"{a} / {b}: {pct(c)}" for a, b, c in low) + "."]
    h += sub("Números em destaque") + "<ul>" + "".join(f"<li>{escape(i)}</li>" for i in itens) + "</ul>"
    h += nota(f"Só entram nesta lista categorias com pelo menos {FROTA_MIN} carros em média. Linhas em itálico nas tabelas têm menos de {N_MIN} observações e não servem de base para conclusão.", "alerta")
    R.secoes.append(("resumo", "Resumo executivo", h))


def sec_ocupacao(R):
    q = R.q
    h = sub("1. Ocupação por sazonalidade e categoria", "Quanto da frota estava alugada: a média, o dia típico, o pior e o melhor dia.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, avg(frota), avg(ocupacao), median(ocupacao), min(ocupacao), max(ocupacao)
                FROM base_diaria GROUP BY 1, 2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Dias", "Frota média", "Média", "Dia típico", "Pior dia", "Melhor dia"], rows,
                [None, None, num, lambda v: num(v, 1), pct, pct, pct, pct], 2, 2)
    h += nota(f"Categorias com menos de {FROTA_MIN} carros em média passam de 100% com facilidade (um carro alugado várias vezes no mesmo dia). Aparecem na tabela, mas não entram nas conclusões.", "alerta")
    R.csv("ocupacao_sazonalidade_categoria", ["sazonalidade", "categoria", "dias", "frota_media", "media", "dia_tipico", "pior_dia", "melhor_dia"], rows)

    h += sub("2. Ocupação por mês e ano", "Ocupação total em cada mês, comparada com o mesmo mês do ano anterior.")
    rows = q("SELECT ano, mes, sum(vendidas)::DOUBLE/sum(frota) o, count(*) n FROM base_diaria_total GROUP BY 1,2 ORDER BY 1,2")
    d = {(a, m): o for a, m, o, _ in rows}
    anos = sorted({a for a, _ in d})
    h += g.linhas("Ocupação total por mês", [f"{m:02d}" for m in range(1, 13)], [[d.get((a, m)) for m in range(1, 13)] for a in anos], [str(a) for a in anos], lambda v: pct(v, 0))
    yoy = [(a, m, o, d.get((a - 1, m)), (o - d[(a - 1, m)]) if (a - 1, m) in d else None) for (a, m), o in sorted(d.items())]
    h += tabela(["Ano", "Mês", "Ocupação", "Mesmo mês do ano anterior", "Diferença (pontos %)"], yoy,
                [None, None, pct, pct, lambda v: "–" if v is None else num(v * 100, 1)], None, 2)

    h += sub("3. Ocupação por dia da semana")
    rows = q("SELECT sazonalidade, dow, sum(vendidas)::DOUBLE/sum(frota) FROM base_diaria_total GROUP BY 1,2 ORDER BY 1,2")
    m = {(s, dw): v for s, dw, v in rows}
    h += tabela(["Sazonalidade"] + DIAS_SEM, [(s,) + tuple(m.get((s, i)) for i in range(7)) for s in SAZ if any((s, i) in m for i in range(7))], [None] + [pct] * 7, None, 1)

    h += sub("4. Mapa de calor do calendário", "Cada linha é um mês e cada coluna um dia. Quanto mais verde, mais cheia a frota.")
    rows = q("SELECT ano, mes, day(data), ocupacao FROM base_diaria_total ORDER BY 1,2,3")
    ml = sorted({(a, mm) for a, mm, _, _ in rows})
    mat = [[None] * 31 for _ in ml]
    idx = {k: i for i, k in enumerate(ml)}
    for a, mm, dd, o in rows:
        mat[idx[(a, mm)]][dd - 1] = min(o, 1.0)
    h += g.calor("Ocupação total por dia (acima de 100% aparece como 100%)", [f"{mm:02d}/{str(a)[2:]}" for a, mm in ml], list(range(1, 32)), mat)

    h += sub("5. Quantos carros a frota teve", "Média mensal de carros ativos por categoria, e quantos entraram e saíram em cada mês.")
    rows = q("SELECT categoria, strftime(data, '%Y-%m') ym, avg(frota) FROM base_diaria GROUP BY 1,2 ORDER BY 2")
    yms = sorted({r[1] for r in rows})
    cats = sorted({r[0] for r in rows})
    mm_ = {(c, ym): v for c, ym, v in rows}
    h += g.linhas("Carros ativos por categoria (média do mês)", yms, [[mm_.get((c, ym)) for ym in yms] for c in cats], cats, lambda v: num(v, 0))
    mov = q("""SELECT ym, sum(c) comp, sum(s) vend FROM (
               SELECT strftime(entrada,'%Y-%m') ym, count(*) c, 0 s FROM frota_valida GROUP BY 1
               UNION ALL SELECT strftime(saida,'%Y-%m'), 0, count(*) FROM frota_valida WHERE saida IS NOT NULL GROUP BY 1) GROUP BY 1 ORDER BY 1""")
    h += tabela(["Mês", "Carros que entraram", "Carros que saíram"], mov, [None, num, num], None, 1)

    h += sub("6. Dias lotados e dias vazios", "Lotado = acima de 95% da frota alugada; vazio = abaixo de 40%.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, avg((ocupacao > 0.95)::INT), avg((ocupacao > 1)::INT), avg((ocupacao < 0.40)::INT)
                FROM base_diaria GROUP BY 1,2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Dias", "% dias lotados", "% dias com mais aluguéis que carros", "% dias vazios"], rows, [None, None, num, pct, pct, pct], 2, 2)
    R.csv("dias_lotados_e_vazios", ["sazonalidade", "categoria", "dias", "pct_lotados", "pct_acima_100", "pct_vazios"], rows)

    h += sub("7. Feriados e eventos", "Ocupação total em cada evento, comparada com os outros dias do mesmo mês.")
    rows = q("""WITH ev AS (SELECT t.ano, t.regra, avg(t.ocupacao) o_ev, count(*) n FROM (SELECT *, year(data) ano FROM base_diaria_total) t
                  WHERE regra IN ('Carnaval','Semana Santa','Corpus Christi','20/12 a 05/01') GROUP BY 1,2)
                SELECT ev.ano, ev.regra, ev.n, ev.o_ev,
                  (SELECT avg(b.ocupacao) FROM base_diaria_total b WHERE b.ano = ev.ano AND b.regra NOT IN ('Carnaval','Semana Santa','Corpus Christi','20/12 a 05/01')
                     AND b.mes IN (SELECT DISTINCT month(data) FROM base_diaria_total e2 WHERE e2.regra = ev.regra AND year(e2.data) = ev.ano)) AS o_mes
                FROM ev ORDER BY 2,1""")
    h += tabela(["Ano", "Evento", "Dias", "Ocupação no evento", "Ocupação nos outros dias do mês"], rows, [None, None, num, pct, pct], 2, 2)
    R.secoes.append(("ocupacao", "A. Ocupação e frota", h))


def sec_antecedencia(R):
    q = R.q
    h = sub("8. Quantos dias antes o cliente compra", "Antecedência = dias entre a compra da reserva e o dia da diária. “Típico” é o valor do meio: metade compra com mais dias, metade com menos.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, median(antecedencia), quantile_cont(antecedencia, 0.25), quantile_cont(antecedencia, 0.75)
                FROM diarias GROUP BY 1,2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Diárias", "Típico (dias)", "25% compram com até (dias)", "25% compram com mais de (dias)"], rows,
                [None, None, num, lambda v: num(v, 0), lambda v: num(v, 0), lambda v: num(v, 0)], 2, 2)
    R.csv("antecedencia", ["sazonalidade", "categoria", "diarias", "tipico", "p25", "p75"], rows)
    hist = q(f"""SELECT sazonalidade, {" , ".join(f"count(*) FILTER (WHERE antecedencia BETWEEN {a} AND {b})::DOUBLE / count(*)" for _, a, b in BINS_ANT)} FROM diarias GROUP BY 1""")
    hm = {r[0]: r[1:] for r in hist}
    sz = [s for s in SAZ if s in hm]
    h += g.barras("Parcela das diárias por faixa de antecedência (dias)", [b[0] for b in BINS_ANT], [list(hm[s]) for s in sz], lambda v: pct(v, 0), nomes=sz)

    h += sub("9. Quanto já está vendido a X dias da data", "Parcela das diárias que já estava comprada 90, 60, 30, 14, 7 e 3 dias antes.")
    pts = [90, 60, 30, 14, 7, 3]
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, {", ".join(f"avg((antecedencia >= {p})::INT)" for p in pts)} FROM diarias GROUP BY 1,2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Diárias"] + [f"{p} dias antes" for p in pts], rows, [None, None, num] + [pct] * 6, 2, 2)
    R.csv("quanto_ja_vendido", ["sazonalidade", "categoria", "diarias"] + [f"{p}_dias_antes" for p in pts], rows)
    tot = q(f"SELECT sazonalidade, {', '.join(f'avg((antecedencia >= {p})::INT)' for p in pts)} FROM diarias GROUP BY 1")
    tm = {r[0]: r[1:] for r in tot}
    h += g.linhas("Parcela já vendida, por sazonalidade", [f"{p} dias" for p in pts], [list(tm[s]) for s in SAZ if s in tm], [s for s in SAZ if s in tm], lambda v: pct(v, 0), cores=[tema.SAZONALIDADE[s] for s in SAZ if s in tm])

    h += sub("10. Ritmo de vendas: dias que começam devagar fecham mais vazios?", "Compara os dias em que as vendas estavam mais fracas (25% piores) com os mais fortes (25% melhores) naquele ponto, e a ocupação final de cada grupo.")
    R.pace = {}
    out = []
    for k in (30, 14, 7):
        rows = q(f"""WITH d AS (SELECT data, categoria_id, count(*) final, count(*) FILTER (WHERE antecedencia >= {k}) ate FROM diarias GROUP BY 1,2),
                     j AS (SELECT b.sazonalidade, b.ocupacao, d.ate::DOUBLE / d.final AS pace FROM base_diaria b JOIN d ON d.data = b.data AND d.categoria_id = b.categoria_id WHERE d.final > 0),
                     q AS (SELECT quantile_cont(pace, 0.25) p25, quantile_cont(pace, 0.75) p75 FROM j)
                SELECT 'Todas', count(*) FILTER (WHERE pace < p25), avg(ocupacao) FILTER (WHERE pace < p25), count(*) FILTER (WHERE pace >= p75), avg(ocupacao) FILTER (WHERE pace >= p75),
                       (SELECT p25 FROM q), (SELECT p75 FROM q) FROM j, q GROUP BY ALL""")
        r = rows[0]
        R.pace[k] = r
        out.append((f"{k} dias antes", r[1], r[2], r[3], r[4], (r[4] - r[2]) if r[2] is not None and r[4] is not None else None))
    h += tabela(["Quando", "Dias com vendas fracas", "Ocupação final deles", "Dias com vendas fortes", "Ocupação final deles", "Diferença (pontos %)"], out,
                [None, num, pct, num, pct, lambda v: "–" if v is None else num(v * 100, 1)], None, 1)

    h += sub("11. Quando o cliente fez a reserva (por mês de compra)", "Antecedência típica das diárias, pelo mês em que a reserva foi feita.")
    rows = q("SELECT ano_criacao, mes_criacao, count(*) n, median(antecedencia) FROM diarias GROUP BY 1,2 ORDER BY 1,2")
    h += tabela(["Ano da compra", "Mês da compra", "Diárias", "Antecedência típica (dias)"], rows, [None, None, num, lambda v: num(v, 0)], 2, 2)
    h += nota("Atenção: nos últimos meses a antecedência parece cair, mas é só porque as reservas recentes são para viagens futuras, que ainda não foram concluídas e não entram aqui.", "alerta")

    h += sub("12. Antecedência por duração da reserva")
    case = "CASE " + " ".join(f"WHEN dias BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_DUR) + " END"
    rows = q(f"SELECT {case} faixa, count(*) n, median(antecedencia), avg(antecedencia) FROM diarias GROUP BY 1 ORDER BY min(dias)")
    rows = [r for r in rows if r[0] is not None]
    h += tabela(["Duração da reserva (dias)", "Diárias", "Antecedência típica (dias)", "Antecedência média (dias)"], rows, [None, num, lambda v: num(v, 0), lambda v: num(v, 1)], 1, 1)

    h += sub("13. Compras de última hora (até 2 dias antes)", "Parcela das diárias compradas em cima da hora.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, avg((antecedencia BETWEEN 0 AND 2)::INT), avg((antecedencia < 0)::INT) FROM diarias GROUP BY 1,2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Diárias", "% de última hora", "% registrado depois da data (provável erro)"], rows, [None, None, num, pct, pct], 2, 2)
    R.secoes.append(("antecedencia", "B. Antecedência (quando o cliente compra)", h))


def _caso_antec():
    return "CASE " + " ".join(f"WHEN antecedencia BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_ANT) + " END"


def sec_preco(R):
    q = R.q
    case = _caso_antec()
    ordem = "array_position([" + ",".join(f"'{b[0]}'" for b in BINS_ANT) + "], faixa)"
    h = sub("14. Preço antes e depois do desconto, por antecedência", "Valores por diária, só reservas com preço pago maior que zero.")
    rows = q(f"SELECT {case} faixa, count(*) n, avg(preco_base), avg(preco_final), median(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}")
    rows = [r for r in rows if r[0] is not None]
    h += tabela(["Antecedência (dias)", "Diárias", "Preço antes do desconto", "Preço pago", "Preço pago típico"], rows, [None, num, usd, usd, usd], 1, 1)
    R.csv("preco_por_antecedencia", ["faixa", "diarias", "preco_antes_desconto", "preco_pago", "preco_pago_tipico"], rows)
    h += g.barras("Preço por faixa de antecedência (US$)", [r[0] for r in rows], [[r[2] for r in rows], [r[3] for r in rows]], lambda v: num(v, 0), nomes=["Antes do desconto", "Pago"])

    h += sub("15. Desconto", "Desconto = preço antes do desconto − preço pago. A porcentagem é sobre o preço antes do desconto.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, avg(desconto_dia), avg(desconto_pct), avg((desconto_dia = 0)::INT) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2
                ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Categoria", "Diárias", "Desconto médio por diária", "Desconto médio (%)", "% sem desconto"], rows, [None, None, num, usd, pct, pct], 2, 2)
    R.csv("desconto", ["sazonalidade", "categoria", "diarias", "desconto_medio", "desconto_pct", "pct_sem_desconto"], rows)
    rows = q(f"SELECT {case} faixa, count(*) n, avg(desconto_pct), avg((desconto_dia = 0)::INT) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}")
    rows = [r for r in rows if r[0] is not None]
    h += tabela(["Antecedência (dias)", "Diárias", "Desconto médio (%)", "% sem desconto"], rows, [None, num, pct, pct], 1, 1)

    h += sub("16. Preço médio ao longo do tempo", "Preço pago médio por mês e categoria.")
    rows = q("SELECT categoria, strftime(data, '%Y-%m') ym, avg(preco_final), count(*) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2 ORDER BY 2")
    yms = sorted({r[1] for r in rows})
    cats = sorted({r[0] for r in rows})
    d = {(c, y): v for c, y, v, n in rows if n >= 5}
    h += g.linhas("Preço pago médio por diária (US$)", yms, [[d.get((c, y)) for y in yms] for c in cats], cats, lambda v: num(v, 0))
    h += '<p class="sub">Meses com menos de 5 diárias não aparecem no gráfico.</p>'

    h += sub("17. Quanto cada sazonalidade cobra a mais que a Baixa", "Preço pago médio de cada sazonalidade comparado com o da Baixa, na mesma categoria.")
    rows = q(f"""WITH p AS (SELECT categoria, sazonalidade, avg(preco_final) pf, count(*) n FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2)
                SELECT p.categoria, p.sazonalidade, p.n, p.pf, p.pf / b.pf - 1 FROM p JOIN p b ON b.categoria = p.categoria AND b.sazonalidade = 'Baixa'
                ORDER BY 1, array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], p.sazonalidade)""")
    h += tabela(["Categoria", "Sazonalidade", "Diárias", "Preço pago médio", "Diferença sobre a Baixa"], rows, [None, None, num, usd, lambda v: pct(v, 1)], 2, 2)

    h += sub("18. Preço por duração da reserva")
    caso_d = "CASE " + " ".join(f"WHEN dias BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_DUR) + " END"
    rows = q(f"SELECT {caso_d} f, count(*) n, avg(preco_base), avg(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY min(dias)")
    rows = [r for r in rows if r[0] is not None]
    h += tabela(["Duração (dias)", "Diárias", "Preço antes do desconto", "Preço pago"], rows, [None, num, usd, usd], 1, 1)

    h += sub("19. Preço por dia da semana da retirada")
    rows = q("SELECT dow_retirada, count(*) n, avg(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY 1")
    h += tabela(["Dia da retirada", "Diárias", "Preço pago médio"], [(DIAS_SEM[a], b, c) for a, b, c in rows], [None, num, usd], 1, 1)

    h += sub("20. A diária gravada muda dentro da mesma temporada do HQ?", "A API não mostra as tarifas de 2024 a 2026 (só a temporada base e um calendário diário de 2027), então não dá para comparar com a tabela da época. "
             "Aqui vemos quanto a diária gravada varia dentro da mesma temporada do HQ e categoria. Muita variação sugere preço alterado depois, ou faixas por duração.")
    rows = q("""WITH x AS (SELECT d.season_id, r.categoria_id, round(d.diaria, 2) diaria, count(*) n FROM rack_detalhes d JOIN reservas r ON r.id = d.reserva_id AND r.status = 'completed'
                            WHERE d.diaria > 0 GROUP BY 1, 2, 3),
                     m AS (SELECT season_id, categoria_id, sum(n) tot, max(n) moda_n, arg_max(diaria, n) moda, min(diaria) mn, max(diaria) mx FROM x GROUP BY 1, 2)
                SELECT coalesce(t.nome, 'Temporada ' || m.season_id) nome, coalesce(c.nome, 'Categoria ' || m.categoria_id), m.tot, m.moda, m.moda_n::DOUBLE / m.tot, m.mn, m.mx
                FROM m LEFT JOIN temporadas t ON t.id = m.season_id LEFT JOIN categorias c ON c.id = m.categoria_id WHERE m.tot >= ? ORDER BY m.season_id, 2""", N_MIN)
    h += tabela(["Temporada do HQ", "Categoria", "Registros", "Diária mais comum", "% na diária mais comum", "Menor", "Maior"], rows, [None, None, num, usd, pct, usd, usd], 2, 2)
    R.csv("diaria_gravada_por_temporada", ["temporada", "categoria", "registros", "diaria_mais_comum", "pct_mais_comum", "menor", "maior"], rows)

    h += sub("21. Receita por carro por dia", "Preço pago das diárias vendidas ÷ (carros disponíveis × dias). Mostra quanto cada carro rende por dia, somando preço e ocupação.")
    rows = q(f"""SELECT b.sazonalidade, b.categoria, count(*) n, sum(coalesce(r.rev, 0)) / sum(b.frota)
                FROM base_diaria b LEFT JOIN (SELECT data, categoria_id, sum(preco_final) rev FROM diarias GROUP BY 1,2) r ON r.data = b.data AND r.categoria_id = b.categoria_id
                GROUP BY 1,2 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], b.sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "Dias", "Receita por carro por dia (US$)"], rows, [None, None, num, usd], 2, 2)
    R.csv("receita_por_carro_por_dia", ["sazonalidade", "categoria", "dias", "receita_por_carro_por_dia"], rows)
    R.secoes.append(("preco", "C. Preço e desconto", h))


def sec_relacao(R):
    q = R.q
    case = _caso_antec()
    ordem = "array_position([" + ",".join(f"'{b[0]}'" for b in BINS_ANT) + "], faixa)"
    h = sub("22. Preço, antecedência e ocupação do dia", "Para cada faixa de antecedência: preço pago médio e ocupação média do dia em que a diária foi usada.")
    rows = q(f"""SELECT {case} faixa, count(*) n, avg(d.preco_final), avg(b.ocupacao) FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}""")
    rows = [r for r in rows if r[0] is not None]
    h += tabela(["Antecedência (dias)", "Diárias", "Preço pago médio", "Ocupação do dia"], rows, [None, num, usd, pct], 1, 1)

    h += sub("23. Ocupação por faixa de preço", "Dentro de cada categoria e sazonalidade, as diárias foram divididas em 5 grupos de preço, do mais barato (1) ao mais caro (5).")
    rows = q(f"""WITH x AS (SELECT d.categoria, d.sazonalidade, d.preco_final, b.ocupacao, ntile(5) OVER (PARTITION BY d.categoria, d.sazonalidade ORDER BY d.preco_final) quintil
                FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id WHERE d.preco_final IS NOT NULL)
                SELECT sazonalidade, quintil, count(*) n, avg(preco_final), avg(ocupacao) FROM x GROUP BY 1,2 ORDER BY {ORD}, 2""")
    h += tabela(["Sazonalidade", "Faixa de preço (1 = mais barato)", "Diárias", "Preço pago médio", "Ocupação do dia"], rows, [None, num, num, usd, pct], 2, 2)

    h += sub("24. Quem compra cedo e quem compra tarde, em dias cheios e vazios", f"Preço pago médio por diária. Dia cheio: ocupação acima de {pct(LIMIAR_ESGOTADO, 0)}; dia vazio: abaixo de {pct(LIMIAR_OCIOSO, 0)}.")
    rows = q(f"""SELECT CASE WHEN b.ocupacao > {LIMIAR_ESGOTADO} THEN 'Dia cheio' WHEN b.ocupacao < {LIMIAR_OCIOSO} THEN 'Dia vazio' ELSE 'Dia intermediário' END situacao,
                 CASE WHEN d.antecedencia >= 30 THEN 'Comprou cedo (30 dias ou mais)' WHEN d.antecedencia <= 7 THEN 'Comprou tarde (até 7 dias)' ELSE 'Comprou no meio' END momento,
                 count(*) n, avg(d.preco_final) FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL GROUP BY 1,2 ORDER BY 1,2""")
    h += tabela(["Situação do dia", "Momento da compra", "Diárias", "Preço pago médio"], rows, [None, None, num, usd], 2, 2)

    h += sub("25. Preço, antecedência e ocupação andam juntos?", "Para cada categoria (com frota média de pelo menos 3 carros), a força da relação entre dois fatores. “Fraca” ou “quase nenhuma” quer dizer que um fator quase não explica o outro. Relação não prova causa.")
    dados = q("""SELECT d.categoria, d.preco_final, d.antecedencia, b.ocupacao FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL AND d.categoria_id IN (SELECT categoria_id FROM base_diaria GROUP BY 1 HAVING avg(frota) >= ?)""", FROTA_MIN)
    por = {}
    for c, p, a, o in dados:
        por.setdefault(c, []).append((p, a, o))
    out = []
    for c, v in sorted(por.items()):
        a = np.array(v, float)
        r1, r2, r3 = (spearman(a[:, i], a[:, j])[0] for i, j in ((0, 1), (0, 2), (1, 2)))
        out.append((c, len(v), forca(r1), forca(r2), forca(r3)))
    h += tabela(["Categoria", "Diárias", "Preço × antecedência", "Preço × ocupação", "Antecedência × ocupação"], out, [None, num, None, None, None], 1, 1)
    R.csv("relacao_preco_antecedencia_ocupacao", ["categoria", "diarias", "preco_x_antecedencia", "preco_x_ocupacao", "antecedencia_x_ocupacao"], out)

    h += sub("26. O que mais pesa na ocupação do dia?", f"Comparação que isola cada fator, mantendo os outros iguais (só categorias com frota média de pelo menos {FROTA_MIN} carros). Mostra quantos pontos de ocupação cada fator soma ou tira. Não prova causa.")
    d = q("""SELECT b.ocupacao, d.preco_final, d.antecedencia, d.sazonalidade, b.dow, d.categoria FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
             WHERE d.preco_final IS NOT NULL AND d.antecedencia BETWEEN 0 AND 365
               AND d.categoria_id IN (SELECT categoria_id FROM base_diaria GROUP BY 1 HAVING avg(frota) >= ?)""", FROTA_MIN)
    if len(d) > 60:
        sz = [s for s in SAZ if any(r[3] == s for r in d)][1:]
        cats = sorted({r[5] for r in d})
        ct = cats[1:]
        nomes = ["Constante", "preço", "antecedência"] + sz + list(range(1, 7)) + ct
        X = [[1, r[1], r[2]] + [1.0 * (r[3] == s) for s in sz] + [1.0 * (r[4] == i) for i in range(1, 7)] + [1.0 * (r[5] == c) for c in ct] for r in d]
        res = ols([r[0] for r in d], X)
        if res:
            beta, se, r2, n = res
            pp = lambda b: b * 100
            sinal = lambda v: ("+" if v >= 0 else "−") + num(abs(v), 1)
            linhas = [("Preço: cada US$ 10 a mais", sinal(pp(beta[1]) * 10)), ("Antecedência: cada 30 dias a mais", sinal(pp(beta[2]) * 30))]
            for i, s in enumerate(sz):
                linhas.append((f"Sazonalidade {s}, em vez de {SAZ[0]}", sinal(pp(beta[3 + i]))))
            for i in range(6):
                linhas.append((f"{DIAS_SEM[i + 1]}, em vez de Dom", sinal(pp(beta[3 + len(sz) + i]))))
            for i, c in enumerate(ct):
                linhas.append((f"Categoria {c}, em vez de {cats[0]}", sinal(pp(beta[3 + len(sz) + 6 + i]))))
            h += tabela(["Fator", "Efeito na ocupação do dia (pontos %)"], linhas, [None, None], None, 1)
            h += f'<p class="sub">Base: {num(n)} diárias. Esses fatores juntos explicam só {pct(r2, 0)} da variação da ocupação; o resto depende do que não está nos dados.</p>'
    else:
        h += nota("Amostra pequena demais para esta comparação.", "alerta")
    R.secoes.append(("relacao", "D. Preço e ocupação", h))


def sec_regras(R):
    q = R.q
    h = sub("27. Ocupação típica e dos melhores dias", "Mostra até onde a operação já chegou: o dia típico, o nível dos 25% melhores dias e o dos 10% melhores.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, quantile_cont(ocupacao, 0.5), quantile_cont(ocupacao, 0.75), quantile_cont(ocupacao, 0.9),
                avg((ocupacao > ?)::INT), avg((ocupacao < ?)::INT) FROM base_diaria GROUP BY 1,2
                ORDER BY {ORD}, 2""", LIMIAR_ESGOTADO, LIMIAR_OCIOSO)
    h += tabela(["Sazonalidade", "Categoria", "Dias", "Dia típico", "25% melhores dias, a partir de", "10% melhores dias, a partir de", "% dias lotados", "% dias vazios"], rows,
                [None, None, num, pct, pct, pct, pct, pct], 2, 2)

    h += sub("28. Ritmo de vendas como alerta", "Se a venda de um dia está atrás do normal 30, 14 ou 7 dias antes, ele costuma fechar mais vazio? Só vale como alerta se a diferença for de pelo menos 10 pontos.")
    regras = []
    out = []
    for k, r in sorted(R.pace.items(), reverse=True):
        n_lo, o_lo, n_hi, o_hi = r[1], r[2], r[3], r[4]
        ok = n_lo >= N_MIN and n_hi >= N_MIN and o_lo is not None and o_hi is not None and (o_hi - o_lo) >= 0.10
        out.append((f"{k} dias antes", n_lo, o_lo, n_hi, o_hi, (o_hi - o_lo) if o_lo is not None and o_hi is not None else None, "Os dados apoiam" if ok else "Os dados não apoiam"))
        regras.append((f"Vendas fracas {k} dias antes", f"Dias com vendas fracas fecham com {pct(o_lo)} de ocupação, contra {pct(o_hi)} nos dias fortes (diferença de {num((o_hi - o_lo) * 100, 1)} pontos).",
                       "Os dados apoiam" if ok else "Os dados não apoiam"))
    h += tabela(["Quando", "Dias fracos", "Ocupação final", "Dias fortes", "Ocupação final", "Diferença (pontos %)", "Leitura"], out,
                [None, num, pct, num, pct, lambda v: "–" if v is None else num(v * 100, 1), None], None, 1)

    h += sub("29. Faixa de preço praticada", "Preço pago típico e os extremos: 10% das diárias foram pagas abaixo do “preço baixo”, e 10% acima do “preço alto” (só células com 30 diárias ou mais). Os valores já incluem os descontos dados.")
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, quantile_cont(preco_final, 0.1), median(preco_final), quantile_cont(preco_final, 0.9) FROM diarias
                WHERE preco_final IS NOT NULL GROUP BY 1,2 HAVING count(*) >= ? ORDER BY {ORD}, 2""", N_MIN)
    h += tabela(["Sazonalidade", "Categoria", "Diárias", "Preço baixo", "Preço típico", "Preço alto"], rows, [None, None, num, usd, usd, usd], 2, 2)
    R.csv("faixa_de_preco", ["sazonalidade", "categoria", "diarias", "preco_baixo", "preco_tipico", "preco_alto"], rows)

    h += sub("30. Descontos que não aumentaram a ocupação", "Compara dias com desconto médio acima e abaixo do normal (na mesma sazonalidade). Se mais desconto não trouxe mais ocupação, ele pode ser reduzido.")
    rows = q(f"""WITH x AS (SELECT sazonalidade, ocupacao, desc_pct_medio, median(desc_pct_medio) OVER (PARTITION BY sazonalidade) m FROM base_diaria WHERE desc_pct_medio IS NOT NULL)
                SELECT sazonalidade, count(*) FILTER (WHERE desc_pct_medio > m), avg(ocupacao) FILTER (WHERE desc_pct_medio > m),
                       count(*) FILTER (WHERE desc_pct_medio <= m), avg(ocupacao) FILTER (WHERE desc_pct_medio <= m) FROM x GROUP BY 1
                ORDER BY {ORD}""")
    out = []
    for s, n_a, o_a, n_b, o_b in rows:
        cand = n_a >= N_MIN and n_b >= N_MIN and o_a is not None and o_b is not None and (o_a - o_b) < 0.02
        out.append((s, n_a, o_a, n_b, o_b, "Pode reduzir desconto" if cand else "Sem indício"))
        if cand:
            regras.append((f"Desconto em {s}", f"Dias com desconto maior fecham com {pct(o_a)} de ocupação, contra {pct(o_b)} nos de desconto menor: mais desconto não trouxe mais ocupação.", "Os dados apoiam"))
    h += tabela(["Sazonalidade", "Dias com desconto alto", "Ocupação", "Dias com desconto baixo", "Ocupação", "Leitura"], out, [None, num, pct, num, pct, None], None, 1)

    h += sub("31. Regras iniciais de ajuste de preço", "Cada regra mostra a evidência. São associações do passado, não provam causa: o desconto e o preço já acompanham a demanda. Use como hipóteses para testar.")
    cel = R.q("""SELECT sazonalidade, categoria, count(*) n, avg((ocupacao > ?)::INT), avg((ocupacao < ?)::INT) FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ?""",
              LIMIAR_ESGOTADO, LIMIAR_OCIOSO, N_MIN, FROTA_MIN)
    for s, c, n, ex, oc in cel:
        if ex >= 0.10:
            regras.append((f"Testar preço maior em {s} / {c}", f"{pct(ex)} dos dias ficaram lotados (acima de 95%), em {n} dias: há espaço para testar preço maior.", "Os dados apoiam"))
        if oc >= 0.30:
            regras.append((f"Ação de demanda em {s} / {c}", f"{pct(oc)} dos dias ficaram vazios (abaixo de 40%), em {n} dias: candidato a promoção.", "Os dados apoiam"))
    R.regras = regras
    h += tabela(["Regra", "Evidência", "Situação"], regras or [("–", "Nenhuma regra com evidência suficiente.", "–")], [None, None, None])
    R.secoes.append(("regras", "E. Regras de ajuste de preço", h))


def sec_limitacoes(R):
    itens = [
        "<b>Preço da data da compra.</b> O valor gravado na reserva foi criado, em geral, uns 34 dias depois dela. Não dá para garantir que seja o preço que valia no dia da compra.",
        "<b>Tarifas da API.</b> A API só mostra a tarifa da temporada base e um calendário diário de 2027. Não há tarifas de 2024 a 2026, e muitas temporadas antigas foram editadas em 19/03/2026 sem histórico. Por isso o preço histórico de tabela não é recuperável.",
        "<b>Preço antes do desconto = preço pago + desconto.</b> É uma definição de negócio: mede o preço antes do desconto na reserva, não a tarifa de tabela do dia da compra.",
        "<b>Frota.</b> Frota do dia = carros de chave 001 a 125 com data de compra até o dia e sem saída anterior. A API não informa carros parados em oficina ou bloqueados.",
        "<b>Diárias do HQ.</b> Usamos o total de diárias do HQ, que em parte das reservas difere da contagem por data e hora.",
        "<b>Upgrades e carros fora da faixa.</b> A venda conta na categoria reservada; diárias com carro de chave fora de 001–125 ficam marcadas.",
        "<b>Preços de hoje em diante.</b> O registro diário de tarifas começou em 29/10/2026; só cobre dados a partir dessa data.",
        "<b>Chave 091.</b> Não existe na API.",
    ]
    R.secoes.append(("limitacoes", "Limitações dos dados", "<ul>" + "".join(f"<li>{i}</li>" for i in itens) + "</ul>"))


ANALISES = Path(__file__).parent / "analises"


def colapsar(html):
    """Cada item numerado (<h3>N. …</h3> + conteúdo até o próximo <h3>) vira um <details> recolhível (fechado por padrão)."""
    out = []
    for parte in re.split(r"(?=<h3>)", html):
        m = re.match(r"<h3>(.*?)</h3>(.*)$", parte, re.S)
        if m and re.match(r"\d", m.group(1)):
            out.append(f'<details class="item"><summary>{m.group(1)}</summary><div class="corpo">{m.group(2)}</div></details>')
        else:
            out.append(parte)
    return "".join(out)


def com_analise(id_, html, fim):
    """Anexa ao fim da aba a análise redigida (analises/<id>.html). O resumo traz os próprios blocos; as demais abas ganham um bloco único."""
    arq = ANALISES / f"{id_}.html"
    if not arq.exists():
        return html
    txt = arq.read_text(encoding="utf-8")
    nota_ = f'<p class="nota-data">Análise redigida em 30/10/2026 sobre dados até {fim:%d/%m/%Y}. Se o cache for atualizado, revise os números citados.</p>'
    if id_ == "resumo":
        return html + nota_ + txt
    return html + f'<details class="item analise" open><summary>Análise desta aba: categoria, ocupação e antecedência</summary><div class="corpo analise">{nota_}{txt}</div></details>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fim", default=None, help="padrão: dia anterior à primeira reserva em andamento (status rental)")
    a = ap.parse_args()
    con = duckdb.connect(str(DB))
    R = Rel(con)
    hoje = date.today()
    andamento = con.execute("SELECT min(CAST(retirada AS DATE)) FROM reservas WHERE status = 'rental' AND retirada >= TIMESTAMP '2024-01-01'").fetchone()[0]
    fim = date.fromisoformat(a.fim) if a.fim else (min(hoje, andamento - timedelta(days=1)) if andamento else hoje)
    R.corte = (fim < hoje, hoje, andamento)
    preparar(con, fim)
    sec_resumo(R, fim)
    sec_ocupacao(R)
    sec_antecedencia(R)
    sec_preco(R)
    sec_relacao(R)
    sec_regras(R)
    sec_limitacoes(R)
    R.secoes = [(i, t, com_analise(i, re.sub(r'(<svg class="grafico".*?</svg>)', r'<div class="grafwrap">\1</div>', colapsar(h), flags=re.S), fim)) for i, t, h in R.secoes]
    OUT.mkdir(parents=True, exist_ok=True)
    for nome, (cols, rows) in R.csvs.items():
        with open(OUT / f"{nome}.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            w.writerows(rows)
    html = tema.pagina("Estudo de precificação", f"Orlando Rent Car · diárias de {INI:%d/%m/%Y} a {fim:%d/%m/%Y} · HQ Rentals",
                       R.secoes, f"Gerado em {datetime.now():%d/%m/%Y %H:%M} a partir do cache local do HQ Rentals. Dados internos, sem informações pessoais de clientes.")
    (OUT / "relatorio.html").write_text(html, encoding="utf-8")
    (OUT / "periodo.json").write_text(json.dumps({"inicio": INI.isoformat(), "fim": fim.isoformat()}), encoding="utf-8")
    print(f"Relatório: {OUT / 'relatorio.html'} ({len(html)/1024:.0f} KB), {len(R.csvs)} CSVs")


if __name__ == "__main__":
    main()
