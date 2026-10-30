"""Gera o relatório HTML do estudo de precificação a partir do cache DuckDB (sem chamar a API).

Uso: python3 scripts/precificacao/analisar.py [--fim AAAA-MM-DD]
Saídas em data/precificacao/relatorio/: relatorio.html (único, completo) e CSVs de apoio.
"""
import argparse, csv, json, sys
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
    return f'<div class="tabela"><table><thead><tr>{cab}</tr></thead><tbody>{"".join(corpo)}</tbody></table></div>'


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
def sec_resumo(R, fim):
    q = R.q
    n_res = q("SELECT count(*) FROM reservas WHERE status='completed' AND retirada::date BETWEEN ? AND ?", INI, fim)[0][0]
    n_dia, preco_f, preco_b = q("SELECT count(*), avg(preco_final), avg(preco_base) FROM diarias")[0]
    ocup = q("SELECT sum(diarias_vendidas)::DOUBLE / sum(frota), avg(frota) FROM base_diaria")[0]
    frota_m = q("SELECT avg(frota) FROM base_diaria_total")[0][0]
    h = kpis([("Reservas concluídas (período)", num(n_res)), ("Diárias vendidas", num(n_dia)), ("Ocupação média (total)", pct(ocup[0])),
              ("Frota ativa média (veículos)", num(frota_m, 1)), ("Rack médio por diária (final)", usd(preco_f)), ("Preço base médio por diária", usd(preco_b))])
    corte, hoje, andamento = R.corte
    if corte:
        h += nota(f"<b>Período efetivo termina em {fim.strftime('%d/%m/%Y')}.</b> Há reservas ainda em andamento (status rental, a primeira retirada em "
                  f"{andamento.strftime('%d/%m/%Y')}). Como só reservas <b>completed</b> entram, incluir as semanas até hoje ({hoje.strftime('%d/%m/%Y')}) subestimaria a ocupação.", "alerta")
    h += nota(f"<b>Escopo.</b> Diárias de {INI.strftime('%d/%m/%Y')} a {fim.strftime('%d/%m/%Y')}, só reservas <b>completed</b>, em USD. "
              "Frota = veículos de chave 001 a 125 ativos no dia (data de compra até a saída). Preço final = rack total ÷ diárias do HQ; "
              "preço base = (rack + desconto) ÷ diárias. Ocupação = diárias vendidas ÷ frota ativa na categoria.")
    # achados automáticos
    top = q("""SELECT sazonalidade, categoria, avg(ocupacao) o, count(*) n FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ? ORDER BY o DESC LIMIT 3""", N_MIN, FROTA_MIN)
    low = q("""SELECT sazonalidade, categoria, avg(ocupacao) o, count(*) n FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ? ORDER BY o LIMIT 3""", N_MIN, FROTA_MIN)
    saz = q("SELECT sazonalidade, sum(vendidas)::DOUBLE/sum(frota) FROM base_diaria_total GROUP BY 1")
    mapa = {s: v for s, v in saz}
    itens = [f"Ocupação por sazonalidade (total): " + " · ".join(f"{s} {pct(mapa[s])}" for s in SAZ if s in mapa) + "."]
    itens.append("Maiores ocupações médias (sazonalidade × categoria): " + "; ".join(f"{a} / {b}: {pct(c)}" for a, b, c, _ in top) + ".")
    itens.append("Menores ocupações médias: " + "; ".join(f"{a} / {b}: {pct(c)}" for a, b, c, _ in low) + ".")
    h += sub("Principais achados") + "<ul>" + "".join(f"<li>{escape(i)}</li>" for i in itens) + "</ul>"
    h += nota(f"Os achados são descritivos. Só entram categorias com frota média de pelo menos {FROTA_MIN} veículos na sazonalidade. Células com menos de 30 observações aparecem em itálico e não sustentam conclusões. "
              "Leia a seção de limitações antes de usar qualquer preço como referência.", "alerta")
    R.secoes.append(("resumo", "Resumo executivo", h))


def sec_ocupacao(R):
    q = R.q
    h = sub("1. Ocupação por sazonalidade × categoria", "Média, mediana, mínimo, máximo e percentis 10/90 da ocupação diária.")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, avg(frota), avg(ocupacao), median(ocupacao), min(ocupacao), max(ocupacao),
                quantile_cont(ocupacao, 0.1), quantile_cont(ocupacao, 0.9)
                FROM base_diaria GROUP BY 1, 2 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n dias", "Frota média", "Média", "Mediana", "Mín", "Máx", "P10", "P90"], rows,
                [None, None, num, lambda v: num(v, 1), pct, pct, pct, pct, pct, pct], 2, 2)
    h += nota(f"Frota média abaixo de {FROTA_MIN} veículos faz a ocupação disparar (um veículo vendido várias vezes no dia passa de 100%). Essas linhas são mostradas, mas não entram em achados nem em regras.", "alerta")
    R.csv("ocupacao_sazonalidade_categoria", ["sazonalidade", "categoria", "n_dias", "frota_media", "media", "mediana", "min", "max", "p10", "p90"], rows)

    h += sub("2. Ocupação por mês e ano", "Ocupação total (diárias vendidas ÷ frota ativa) por mês; variação contra o mesmo mês do ano anterior.")
    rows = q("SELECT ano, mes, sum(vendidas)::DOUBLE/sum(frota) o, count(*) n FROM base_diaria_total GROUP BY 1,2 ORDER BY 1,2")
    d = {(a, m): o for a, m, o, _ in rows}
    anos = sorted({a for a, _ in d})
    h += g.linhas("Ocupação total por mês", [f"{m:02d}" for m in range(1, 13)], [[d.get((a, m)) for m in range(1, 13)] for a in anos],
                  [str(a) for a in anos], lambda v: pct(v, 0))
    yoy = [(a, m, o, d.get((a - 1, m)), (o - d[(a - 1, m)]) if (a - 1, m) in d else None) for (a, m), o in sorted(d.items())]
    h += tabela(["Ano", "Mês", "Ocupação", "Mesmo mês, ano anterior", "Variação (p.p.)"], yoy,
                [None, None, pct, pct, lambda v: "–" if v is None else num(v * 100, 1)], None, 2)

    h += sub("3. Ocupação por dia da semana × sazonalidade")
    rows = q("SELECT sazonalidade, dow, sum(vendidas)::DOUBLE/sum(frota) FROM base_diaria_total GROUP BY 1,2 ORDER BY 1,2")
    m = {(s, dw): v for s, dw, v in rows}
    h += tabela(["Sazonalidade"] + DIAS_SEM, [(s,) + tuple(m.get((s, i)) for i in range(7)) for s in SAZ if any((s, i) in m for i in range(7))],
                [None] + [pct] * 7, None, 1)

    h += sub("4. Heatmap do calendário", "Cada linha é um mês; cada coluna, um dia. Verde mais vivo = ocupação mais alta. Eventos móveis aparecem na tabela de efeito calendário (item 8).")
    rows = q("SELECT ano, mes, day(data), ocupacao FROM base_diaria_total ORDER BY 1,2,3")
    ml = sorted({(a, mm) for a, mm, _, _ in rows})
    mat = [[None] * 31 for _ in ml]
    idx = {k: i for i, k in enumerate(ml)}
    for a, mm, dd, o in rows:
        mat[idx[(a, mm)]][dd - 1] = min(o, 1.0)
    h += g.calor("Ocupação total por dia (limitada a 100% na cor)", [f"{mm:02d}/{str(a)[2:]}" for a, mm in ml], list(range(1, 32)), mat)

    h += sub("5. Frota ativa ao longo do tempo", "Veículos ativos por categoria (média mensal) e movimentos de compra e venda por mês.")
    rows = q("SELECT categoria, strftime(data, '%Y-%m') ym, avg(frota) FROM base_diaria GROUP BY 1,2 ORDER BY 2")
    yms = sorted({r[1] for r in rows})
    cats = sorted({r[0] for r in rows})
    mm_ = {(c, ym): v for c, ym, v in rows}
    h += g.linhas("Frota ativa média por categoria", yms, [[mm_.get((c, ym)) for ym in yms] for c in cats], cats, lambda v: num(v, 0))
    mov = q("""SELECT ym, sum(c) comp, sum(s) vend FROM (
               SELECT strftime(entrada,'%Y-%m') ym, count(*) c, 0 s FROM frota_valida GROUP BY 1
               UNION ALL SELECT strftime(saida,'%Y-%m'), 0, count(*) FROM frota_valida WHERE saida IS NOT NULL GROUP BY 1) GROUP BY 1 ORDER BY 1""")
    h += tabela(["Mês", "Compras (entradas)", "Vendas (saídas)"], mov, [None, num, num], None, 1)

    h += sub("6 e 7. Dias de esgotamento (> 95%) e de ociosidade (< 40%)", "Percentual de dias em cada situação, por sazonalidade × categoria.")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, avg((ocupacao > 0.95)::INT), avg((ocupacao > 1)::INT), avg((ocupacao < 0.40)::INT)
                FROM base_diaria GROUP BY 1,2 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n dias", "% dias > 95%", "% dias > 100% (conferir dado)", "% dias < 40%"], rows, [None, None, num, pct, pct, pct], 2, 2)
    R.csv("esgotamento_ociosidade", ["sazonalidade", "categoria", "n_dias", "pct_acima_95", "pct_acima_100", "pct_abaixo_40"], rows)

    h += sub("8. Efeito calendário", "Ocupação total em cada evento comparada com a dos demais dias do mesmo mês.")
    rows = q("""WITH ev AS (SELECT t.ano, t.regra, avg(t.ocupacao) o_ev, count(*) n FROM (SELECT *, year(data) ano FROM base_diaria_total) t
                  WHERE regra IN ('Carnaval','Semana Santa','Corpus Christi','20/12 a 05/01') GROUP BY 1,2)
                SELECT ev.ano, ev.regra, ev.n, ev.o_ev,
                  (SELECT avg(b.ocupacao) FROM base_diaria_total b WHERE b.ano = ev.ano AND b.regra NOT IN ('Carnaval','Semana Santa','Corpus Christi','20/12 a 05/01')
                     AND b.mes IN (SELECT DISTINCT month(data) FROM base_diaria_total e2 WHERE e2.regra = ev.regra AND year(e2.data) = ev.ano)) AS o_mes
                FROM ev ORDER BY 2,1""")
    h += tabela(["Ano", "Evento", "n dias", "Ocupação no evento", "Ocupação nos demais dias do mês"], rows, [None, None, num, pct, pct], 2, 2)
    R.secoes.append(("ocupacao", "A. Ocupação e frota", h))


def sec_antecedencia(R):
    q = R.q
    h = sub("9. Distribuição da antecedência", "Antecedência = data da diária − data de criação da reserva, em dias (por diária vendida).")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, median(antecedencia), quantile_cont(antecedencia, 0.25), quantile_cont(antecedencia, 0.75),
                quantile_cont(antecedencia, 0.9) FROM diarias GROUP BY 1,2 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n diárias", "Mediana", "P25", "P75", "P90"], rows, [None, None, num, lambda v: num(v, 0)] + [lambda v: num(v, 0)] * 3, 2, 2)
    R.csv("antecedencia_distribuicao", ["sazonalidade", "categoria", "n", "mediana", "p25", "p75", "p90"], rows)
    hist = q(f"""SELECT sazonalidade, {" , ".join(f"count(*) FILTER (WHERE antecedencia BETWEEN {a} AND {b})::DOUBLE / count(*)" for _, a, b in BINS_ANT)} FROM diarias GROUP BY 1""")
    hm = {r[0]: r[1:] for r in hist}
    sz = [s for s in SAZ if s in hm]
    h += g.barras("Distribuição das diárias por faixa de antecedência", [b[0] for b in BINS_ANT], [list(hm[s]) for s in sz], lambda v: pct(v, 0), nomes=sz)

    h += sub("10. Curva acumulada de reservas (booking curve)", "Parcela das diárias já vendida a D-90, D-60, D-30, D-14, D-7 e D-3 (antecedência ≥ x dias).")
    pts = [90, 60, 30, 14, 7, 3]
    rows = q(f"""SELECT sazonalidade, categoria, count(*) n, {", ".join(f"avg((antecedencia >= {p})::INT)" for p in pts)} FROM diarias GROUP BY 1,2
                 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n diárias"] + [f"D-{p}" for p in pts], rows, [None, None, num] + [pct] * 6, 2, 2)
    R.csv("booking_curve", ["sazonalidade", "categoria", "n"] + [f"D-{p}" for p in pts], rows)
    tot = q(f"SELECT sazonalidade, {', '.join(f'avg((antecedencia >= {p})::INT)' for p in pts)} FROM diarias GROUP BY 1")
    tm = {r[0]: r[1:] for r in tot}
    h += g.linhas("Booking curve por sazonalidade (parcela vendida até D-x)", [f"D-{p}" for p in pts], [list(tm[s]) for s in SAZ if s in tm],
                  [s for s in SAZ if s in tm], lambda v: pct(v, 0), cores=[tema.SAZONALIDADE[s] for s in SAZ if s in tm])

    h += sub("11. Pace por data da diária", "Para cada dia × categoria, a parcela já vendida em D-30, D-14 e D-7 em relação à venda final do dia. Dias com pace baixo fecham com menos ocupação?")
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
        out.append((f"D-{k}", r[5], r[6], r[1], r[2], r[3], r[4]))
    h += tabela(["Ponto", "Pace P25", "Pace P75", "n (pace < P25)", "Ocupação final", "n (pace ≥ P75)", "Ocupação final"], out,
                [None, pct, pct, num, pct, num, pct], None, 1)

    h += sub("12. Antecedência por mês de compra", "Mediana da antecedência (dias) das diárias, pelo mês em que a reserva foi criada.")
    rows = q("SELECT ano_criacao, mes_criacao, count(*) n, median(antecedencia) FROM diarias GROUP BY 1,2 ORDER BY 1,2")
    h += tabela(["Ano da compra", "Mês da compra", "n diárias", "Mediana (dias)"], rows, [None, None, num, lambda v: num(v, 0)], 2, 2)

    h += sub("13. Antecedência por duração da reserva")
    case = "CASE " + " ".join(f"WHEN dias BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_DUR) + " END"
    rows = q(f"SELECT {case} faixa, count(*) n, median(antecedencia), avg(antecedencia) FROM diarias GROUP BY 1 ORDER BY min(dias)")
    rows = [r for r in rows if r[0] is not None]  # antecedência negativa fica fora das faixas (contada na qualidade)
    h += tabela(["Duração (dias)", "n diárias", "Mediana", "Média"], rows, [None, num, lambda v: num(v, 0), lambda v: num(v, 1)], 1, 1)

    h += sub("14. Last-minute (D-0 a D-2)", "Parcela das diárias vendidas com 0 a 2 dias de antecedência.")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, avg((antecedencia BETWEEN 0 AND 2)::INT), avg((antecedencia < 0)::INT) FROM diarias GROUP BY 1,2
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n diárias", "% last-minute", "% com antecedência negativa (conferir dado)"], rows, [None, None, num, pct, pct], 2, 2)
    R.secoes.append(("antecedencia", "B. Antecedência (booking curve)", h))


def _caso_antec():
    return "CASE " + " ".join(f"WHEN antecedencia BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_ANT) + " END"


def sec_preco(R):
    q = R.q
    case = _caso_antec()
    ordem = "array_position([" + ",".join(f"'{b[0]}'" for b in BINS_ANT) + "], faixa)"
    h = sub("15. Preço base versus final por faixa de antecedência", "Valores por diária, só reservas com rack > 0.")
    rows = q(f"SELECT {case} faixa, count(*) n, avg(preco_base), avg(preco_final), median(preco_final), stddev(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}")
    rows = [r for r in rows if r[0] is not None]  # antecedência negativa fica fora das faixas (contada na qualidade)
    h += tabela(["Antecedência (dias)", "n diárias", "Preço base médio", "Preço final médio", "Preço final mediano", "Desvio-padrão"], rows, [None, num, usd, usd, usd, usd], 1, 1)
    R.csv("preco_por_antecedencia", ["faixa", "n", "base_medio", "final_medio", "final_mediano", "desvio"], rows)
    h += g.barras("Preço base × final por faixa de antecedência (US$)", [r[0] for r in rows], [[r[2] for r in rows], [r[3] for r in rows]], lambda v: num(v, 0), nomes=["Base", "Final"])

    h += sub("16. Desconto", "Desconto = preço base − preço final. Percentual sobre o preço base.")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, avg(desconto_dia), avg(desconto_pct), avg((desconto_dia = 0)::INT) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n diárias", "Desconto médio por diária", "Desconto médio (%)", "% sem desconto"], rows, [None, None, num, usd, pct, pct], 2, 2)
    R.csv("desconto", ["sazonalidade", "categoria", "n", "desconto_medio", "desconto_pct", "pct_sem_desconto"], rows)
    rows = q(f"SELECT {case} faixa, count(*) n, avg(desconto_pct), avg((desconto_dia = 0)::INT) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}")
    rows = [r for r in rows if r[0] is not None]  # antecedência negativa fica fora das faixas (contada na qualidade)
    h += tabela(["Antecedência (dias)", "n diárias", "Desconto médio (%)", "% sem desconto"], rows, [None, num, pct, pct], 1, 1)

    h += sub("17. Preço médio por diária ao longo do tempo", "Preço final médio por mês de diária e categoria.")
    rows = q("SELECT categoria, strftime(data, '%Y-%m') ym, avg(preco_final), count(*) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2 ORDER BY 2")
    yms = sorted({r[1] for r in rows})
    cats = sorted({r[0] for r in rows})
    d = {(c, y): v for c, y, v, n in rows if n >= 5}
    h += g.linhas("Preço final médio por diária (US$)", yms, [[d.get((c, y)) for y in yms] for c in cats], cats, lambda v: num(v, 0))
    h += '<p class="sub">Pontos com menos de 5 diárias no mês não são plotados.</p>'

    h += sub("18. Prêmio de sazonalidade sobre a Baixa", "Preço final médio de cada sazonalidade dividido pelo da Baixa, na mesma categoria.")
    rows = q("""WITH p AS (SELECT categoria, sazonalidade, avg(preco_final) pf, count(*) n FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2)
                SELECT p.categoria, p.sazonalidade, p.n, p.pf, p.pf / b.pf - 1 FROM p JOIN p b ON b.categoria = p.categoria AND b.sazonalidade = 'Baixa'
                ORDER BY 1, array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], p.sazonalidade)""")
    h += tabela(["Categoria", "Sazonalidade", "n diárias", "Preço final médio", "Prêmio sobre a Baixa"], rows, [None, None, num, usd, lambda v: pct(v, 1)], 2, 2)

    h += sub("19. Preço por duração da reserva")
    caso_d = "CASE " + " ".join(f"WHEN dias BETWEEN {a} AND {b} THEN '{n}'" for n, a, b in BINS_DUR) + " END"
    rows = q(f"SELECT {caso_d} f, count(*) n, avg(preco_base), avg(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY min(dias)")
    h += tabela(["Duração (dias)", "n diárias", "Preço base médio", "Preço final médio"], rows, [None, num, usd, usd], 1, 1)

    h += sub("20. Preço por dia da semana de retirada")
    rows = q("SELECT dow_retirada, count(*) n, avg(preco_final) FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1 ORDER BY 1")
    h += tabela(["Dia de retirada", "n diárias", "Preço final médio"], [(DIAS_SEM[a], b, c) for a, b, c in rows], [None, num, usd], 1, 1)

    h += sub("21. Estabilidade da diária gravada dentro da temporada", "A API não expõe as tarifas de 2024 a 2026 (só a temporada base e um calendário diário de 2027), então não dá para comparar o rack gravado com a tabela vigente. "
             "Em vez disso, mede quanto a diária gravada varia dentro da mesma temporada e categoria. Uma temporada com muita variação indica preço mexido depois da tabela (ou faixas por duração).")
    rows = q("""WITH x AS (SELECT d.season_id, r.categoria_id, round(d.diaria, 2) diaria, count(*) n FROM rack_detalhes d JOIN reservas r ON r.id = d.reserva_id AND r.status = 'completed'
                            WHERE d.diaria > 0 GROUP BY 1, 2, 3),
                     m AS (SELECT season_id, categoria_id, sum(n) tot, max(n) moda_n, arg_max(diaria, n) moda, min(diaria) mn, max(diaria) mx FROM x GROUP BY 1, 2)
                SELECT coalesce(t.nome, 'Temporada ' || m.season_id) nome, coalesce(c.nome, 'Categoria ' || m.categoria_id), m.tot, m.moda, m.moda_n::DOUBLE / m.tot, m.mn, m.mx
                FROM m LEFT JOIN temporadas t ON t.id = m.season_id LEFT JOIN categorias c ON c.id = m.categoria_id WHERE m.tot >= ? ORDER BY m.season_id, 2""", N_MIN)
    h += tabela(["Temporada", "Categoria", "n linhas de rack", "Diária mais comum", "% na diária mais comum", "Mínima", "Máxima"], rows, [None, None, num, usd, pct, usd, usd], 2, 2)
    R.csv("estabilidade_diaria_gravada", ["temporada", "categoria", "n", "diaria_mais_comum", "pct_mais_comum", "minima", "maxima"], rows)

    h += sub("22. RevPAR (receita de rack por veículo-dia)", "Rack das diárias vendidas ÷ veículos ativos × dias, por sazonalidade × categoria.")
    rows = q("""SELECT b.sazonalidade, b.categoria, count(*) n, sum(coalesce(r.rev, 0)) / sum(b.frota)
                FROM base_diaria b LEFT JOIN (SELECT data, categoria_id, sum(preco_final) rev FROM diarias GROUP BY 1,2) r ON r.data = b.data AND r.categoria_id = b.categoria_id
                GROUP BY 1,2 ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], b.sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "n dias", "RevPAR (US$)"], rows, [None, None, num, usd], 2, 2)
    R.csv("revpar", ["sazonalidade", "categoria", "n_dias", "revpar"], rows)
    R.secoes.append(("preco", "C. Preço", h))


def _linhas_dia(R):
    """Uma linha por dia × categoria com preço e ocupação finais."""
    return R.q("""SELECT categoria, sazonalidade, ocupacao, preco_final_medio, antec_media, dow, diarias_vendidas, desc_pct_medio, data
                  FROM base_diaria WHERE preco_final_medio IS NOT NULL AND diarias_vendidas > 0""")


def sec_relacao(R):
    q = R.q
    case = _caso_antec()
    ordem = "array_position([" + ",".join(f"'{b[0]}'" for b in BINS_ANT) + "], faixa)"
    h = sub("23. Matriz preço × antecedência × ocupação final", "Para cada faixa de antecedência: preço final médio e ocupação final média do dia em que a diária foi consumida.")
    rows = q(f"""SELECT {case} faixa, count(*) n, avg(d.preco_final), avg(b.ocupacao) FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL GROUP BY 1 ORDER BY {ordem}""")
    h += tabela(["Antecedência (dias)", "n diárias", "Preço final médio", "Ocupação final do dia"], rows, [None, num, usd, pct], 1, 1)
    rows = [r for r in rows if r[0] is not None]  # antecedência negativa fica fora das faixas (contada na qualidade)

    h += sub("24. Ocupação final por quintil de preço", "Quintis de preço final por diária, calculados dentro de cada categoria × sazonalidade (1 = mais barato).")
    rows = q("""WITH x AS (SELECT d.categoria, d.sazonalidade, d.preco_final, b.ocupacao, ntile(5) OVER (PARTITION BY d.categoria, d.sazonalidade ORDER BY d.preco_final) quintil
                FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id WHERE d.preco_final IS NOT NULL)
                SELECT sazonalidade, quintil, count(*) n, avg(preco_final), avg(ocupacao) FROM x GROUP BY 1,2
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Quintil de preço", "n diárias", "Preço final médio", "Ocupação final do dia"], rows, [None, num, num, usd, pct], 2, 2)

    h += sub("25. Quem compra cedo × tarde, em dias cheios e vazios", f"Preço final médio por diária. Dia cheio: ocupação > {pct(LIMIAR_ESGOTADO, 0)}; dia vazio: < {pct(LIMIAR_OCIOSO, 0)}.")
    rows = q(f"""SELECT CASE WHEN b.ocupacao > {LIMIAR_ESGOTADO} THEN 'Dia cheio' WHEN b.ocupacao < {LIMIAR_OCIOSO} THEN 'Dia vazio' ELSE 'Intermediário' END situacao,
                 CASE WHEN d.antecedencia >= 30 THEN 'Compra cedo (≥ 30 dias)' WHEN d.antecedencia <= 7 THEN 'Compra tarde (≤ 7 dias)' ELSE 'Intermediária' END momento,
                 count(*) n, avg(d.preco_final) FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL GROUP BY 1,2 ORDER BY 1,2""")
    h += tabela(["Situação do dia", "Momento da compra", "n diárias", "Preço final médio"], rows, [None, None, num, usd], 2, 2)

    h += sub("26. Correlações (Spearman)", "ρ entre preço, antecedência e ocupação final, por categoria, com intervalo de confiança de 95% (Fisher). Unidade: diária vendida.")
    dados = q("""SELECT d.categoria, d.preco_final, d.antecedencia, b.ocupacao FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
                 WHERE d.preco_final IS NOT NULL""")
    por = {}
    for c, p, a, o in dados:
        por.setdefault(c, []).append((p, a, o))
    out = []
    for c, v in sorted(por.items()):
        a = np.array(v, float)
        for nome, i, j in (("preço × antecedência", 0, 1), ("preço × ocupação", 0, 2), ("antecedência × ocupação", 1, 2)):
            r, lo, hi, n = spearman(a[:, i], a[:, j])
            out.append((c, nome, n, r, lo, hi))
    h += tabela(["Categoria", "Par", "n diárias", "ρ", "IC 95% inf.", "IC 95% sup."], out, [None, None, num, lambda v: num(v, 2), lambda v: num(v, 2), lambda v: num(v, 2)], 2, 2)
    R.csv("correlacoes", ["categoria", "par", "n", "rho", "ic_inf", "ic_sup"], out)

    h += sub("27. Regressão múltipla exploratória", "Ocupação final do dia ~ preço final + antecedência + sazonalidade + dia da semana + categoria. Exploratória: não prova causalidade.")
    d = q("""SELECT b.ocupacao, d.preco_final, d.antecedencia, d.sazonalidade, b.dow, d.categoria FROM diarias d JOIN base_diaria b ON b.data = d.data AND b.categoria_id = d.categoria_id
             WHERE d.preco_final IS NOT NULL AND d.antecedencia BETWEEN 0 AND 365""")
    if len(d) > 60:
        sz = [s for s in SAZ if any(r[3] == s for r in d)][1:]
        ct = sorted({r[5] for r in d})[1:]
        nomes = ["Constante", "Preço final (US$)", "Antecedência (dias)"] + [f"Sazonalidade: {s}" for s in sz] + [f"{DIAS_SEM[i]}" for i in range(1, 7)] + [f"Categoria: {c}" for c in ct]
        X = [[1, r[1], r[2]] + [1.0 * (r[3] == s) for s in sz] + [1.0 * (r[4] == i) for i in range(1, 7)] + [1.0 * (r[5] == c) for c in ct] for r in d]
        res = ols([r[0] for r in d], X)
        if res:
            beta, se, r2, n = res
            h += tabela(["Variável", "Coeficiente", "Erro-padrão", "t"], [(nm, b, e, b / e if e else None) for nm, b, e in zip(nomes, beta, se)], [None, lambda v: num(v, 4), lambda v: num(v, 4), lambda v: num(v, 1)], None, 1)
            h += f'<p class="sub">n = {num(n)} diárias · R² = {num(r2, 3) if r2 is not None else "–"}. Sazonalidade de referência: {escape(SAZ[0])}; dia de referência: Dom; categoria de referência: {escape(sorted({r[5] for r in d})[0])}.</p>'
    else:
        h += nota("Amostra insuficiente para a regressão.", "alerta")
    R.secoes.append(("relacao", "D. Preço × antecedência × ocupação", h))


def _elast(x, y):
    res = ols(y, np.column_stack([np.ones(len(x)), x]))
    if not res:
        return None
    beta, se, r2, n = res
    return beta[1], beta[1] - 1.96 * se[1], beta[1] + 1.96 * se[1], n


def sec_elasticidade(R):
    h = sub("28. Elasticidade-preço aproximada", "Regressão log-log: ln(diárias vendidas no dia) contra ln(preço final médio do dia), por categoria × sazonalidade. Unidade: dia × categoria.")
    dias = _linhas_dia(R)
    por = {}
    for c, s, o, p, a, dw, v, dp, dt in dias:
        por.setdefault((c, s), []).append((np.log(p), np.log(v)))
    out, R.elast = [], {}
    for (c, s), v in sorted(por.items(), key=lambda kv: (kv[0][0], SAZ.index(kv[0][1]))):
        a = np.array(v)
        e = _elast(a[:, 0], a[:, 1]) if len(a) >= 5 and a[:, 0].std() > 0 else None
        if e:
            sig = len(a) >= N_MIN and (e[1] > 0 or e[2] < 0)
            forte = sig and e[0] < 0
            leitura = "Sustentada" if forte else ("Sinal positivo: preço seguiu a demanda, não usar" if sig else "Indicativo")
            out.append((c, s, e[3], e[0], e[1], e[2], leitura))
            R.elast[(c, s)] = (e, sig)
    h += tabela(["Categoria", "Sazonalidade", "n dias", "Elasticidade", "IC 95% inf.", "IC 95% sup.", "Leitura"], out,
                [None, None, num, lambda v: num(v, 2), lambda v: num(v, 2), lambda v: num(v, 2), None], 2, 2)
    R.csv("elasticidade", ["categoria", "sazonalidade", "n_dias", "elasticidade", "ic_inf", "ic_sup", "leitura"], out)
    h += nota("<b>Como ler.</b> Elasticidade negativa significa que, em dias de preço médio mais alto, vendeu-se menos. "
              "“Sustentada” exige n ≥ 30 dias, elasticidade negativa e intervalo de confiança que não cruza o zero. Elasticidade positiva significativa (comum na Altíssima, com poucos dias) quase sempre é o preço acompanhando a demanda. O resto é só indicativo.")

    h += sub("29. Elasticidade por faixa de antecedência", "Mesma regressão, separando diárias compradas com mais e com menos de 30 dias de antecedência (por categoria).")
    d = R.q("""SELECT categoria, data, CASE WHEN antecedencia >= 30 THEN 'Cedo (≥ 30 dias)' ELSE 'Tarde (< 30 dias)' END faixa, count(*) v, avg(preco_final) p
               FROM diarias WHERE preco_final IS NOT NULL GROUP BY 1,2,3""")
    por = {}
    for c, dt, f, v, p in d:
        por.setdefault((c, f), []).append((np.log(p), np.log(v)))
    out = []
    for (c, f), v in sorted(por.items()):
        a = np.array(v)
        e = _elast(a[:, 0], a[:, 1]) if len(a) >= 5 and a[:, 0].std() > 0 else None
        if e:
            out.append((c, f, e[3], e[0], e[1], e[2]))
    h += tabela(["Categoria", "Faixa", "n dias", "Elasticidade", "IC 95% inf.", "IC 95% sup."], out, [None, None, num] + [lambda v: num(v, 2)] * 3, 2, 2)

    h += sub("30. Cuidado com o viés")
    h += nota("O preço do dia já responde à demanda esperada: quando a procura sobe, o preço sobe junto. Isso pode fazer a elasticidade aparecer com sinal "
              "positivo ou perto de zero, sem que o preço tenha causado a venda. Comparar dentro da mesma sazonalidade reduz parte do efeito, mas não elimina. "
              "Trate os números como ordem de grandeza e confirme com testes controlados antes de usar em regras automáticas.", "alerta")
    R.secoes.append(("elasticidade", "E. Elasticidade", h))


def sec_regras(R):
    q = R.q
    h = sub("31. Ocupação-alvo por sazonalidade × categoria", "Distribuição histórica da ocupação diária. Os valores de referência (P75 e P90) mostram até onde a operação já chegou.")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, quantile_cont(ocupacao, 0.5), quantile_cont(ocupacao, 0.75), quantile_cont(ocupacao, 0.9),
                avg((ocupacao > ?)::INT), avg((ocupacao < ?)::INT) FROM base_diaria GROUP BY 1,2
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""", LIMIAR_ESGOTADO, LIMIAR_OCIOSO)
    h += tabela(["Sazonalidade", "Categoria", "n dias", "P50", "P75", "P90", "% dias > 95%", "% dias < 40%"], rows, [None, None, num, pct, pct, pct, pct, pct], 2, 2)

    h += sub("32. Gatilhos pela curva de reservas (pace)", "Se o dia está abaixo do ritmo típico a D-30, D-14 ou D-7, qual a ocupação final?")
    regras = []
    base_occ = q("SELECT avg(ocupacao) FROM base_diaria WHERE diarias_vendidas > 0")[0][0]
    out = []
    for k, r in sorted(R.pace.items(), reverse=True):
        n_lo, o_lo, n_hi, o_hi = r[1], r[2], r[3], r[4]
        ok = n_lo >= N_MIN and n_hi >= N_MIN and o_lo is not None and o_hi is not None and (o_hi - o_lo) >= 0.10
        out.append((f"D-{k}", n_lo, o_lo, n_hi, o_hi, (o_hi - o_lo) if o_lo is not None and o_hi is not None else None, "Sustentada" if ok else "Não sustentada"))
        regras.append((f"Pace abaixo do P25 em D-{k}", f"Dias com pace baixo fecham com {pct(o_lo)} contra {pct(o_hi)} nos dias de pace alto (n = {n_lo} e {n_hi}).",
                       "Sustentada" if ok else "Não sustentada pelos dados"))
    h += tabela(["Ponto", "n (pace < P25)", "Ocupação final", "n (pace ≥ P75)", "Ocupação final", "Diferença (p.p.)", "Leitura"], out,
                [None, num, pct, num, pct, lambda v: "–" if v is None else num(v * 100, 1), None], None, 1)

    h += sub("33. Piso e teto de preço", "Percentis 10 e 90 do preço final por diária (só células com n ≥ 30).")
    rows = q("""SELECT sazonalidade, categoria, count(*) n, quantile_cont(preco_final, 0.1), median(preco_final), quantile_cont(preco_final, 0.9) FROM diarias
                WHERE preco_final IS NOT NULL GROUP BY 1,2 HAVING count(*) >= ? ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade), 2""", N_MIN)
    h += tabela(["Sazonalidade", "Categoria", "n diárias", "Piso (P10)", "Mediana", "Teto (P90)"], rows, [None, None, num, usd, usd, usd], 2, 2)
    R.csv("piso_teto", ["sazonalidade", "categoria", "n", "p10", "mediana", "p90"], rows)
    for sz, c, n, lo, md, hi in rows[:0]:
        pass

    h += sub("34. Descontos que não aumentaram a ocupação", "Compara dias com desconto médio acima e abaixo da mediana (mesma sazonalidade): se a ocupação final não sobe com mais desconto, ele é candidato a redução.")
    rows = q("""WITH x AS (SELECT sazonalidade, ocupacao, desc_pct_medio, median(desc_pct_medio) OVER (PARTITION BY sazonalidade) m FROM base_diaria WHERE desc_pct_medio IS NOT NULL)
                SELECT sazonalidade, count(*) FILTER (WHERE desc_pct_medio > m), avg(ocupacao) FILTER (WHERE desc_pct_medio > m),
                       count(*) FILTER (WHERE desc_pct_medio <= m), avg(ocupacao) FILTER (WHERE desc_pct_medio <= m) FROM x GROUP BY 1
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], sazonalidade)""")
    out = []
    for s, n_a, o_a, n_b, o_b in rows:
        cand = n_a >= N_MIN and n_b >= N_MIN and o_a is not None and o_b is not None and (o_a - o_b) < 0.02
        out.append((s, n_a, o_a, n_b, o_b, "Candidato a reduzir desconto" if cand else "Sem evidência de ineficácia"))
        if cand:
            regras.append((f"Desconto em {s}", f"Dias com desconto acima da mediana fecham com {pct(o_a)} contra {pct(o_b)}: mais desconto não veio com mais ocupação (n = {n_a} e {n_b}).", "Sustentada"))
    h += tabela(["Sazonalidade", "n (desconto alto)", "Ocupação final", "n (desconto baixo)", "Ocupação final", "Leitura"], out, [None, num, pct, num, pct, None], None, 1)

    h += sub("35. Regras iniciais de ajuste de preço", "Cada regra traz a evidência. O que não tem evidência suficiente fica marcado como não sustentado.")
    cel = R.q("""SELECT sazonalidade, categoria, count(*) n, avg((ocupacao > ?)::INT), avg((ocupacao < ?)::INT) FROM base_diaria GROUP BY 1,2 HAVING count(*) >= ? AND avg(frota) >= ?""", LIMIAR_ESGOTADO, LIMIAR_OCIOSO, N_MIN, FROTA_MIN)
    for s, c, n, ex, oc in cel:
        if ex >= 0.10:
            regras.append((f"Subir preço em {s} / {c}", f"{pct(ex)} dos dias passaram de 95% de ocupação (n = {n} dias): há espaço para testar preço maior.", "Sustentada"))
        if oc >= 0.30:
            regras.append((f"Promoção em {s} / {c}", f"{pct(oc)} dos dias ficaram abaixo de 40% (n = {n} dias): candidato a ação de demanda.", "Sustentada"))
    for (c, s), (e, forte) in R.elast.items():
        if forte and e[0] < -1:
            regras.append((f"Cautela ao subir preço em {s} / {c}", f"Elasticidade {num(e[0], 2)} (IC {num(e[1], 2)} a {num(e[2], 2)}, n = {e[3]}): demanda sensível a preço.", "Sustentada"))
        elif forte and e[0] > 0:
            regras.append((f"Elasticidade positiva em {s} / {c}", f"Elasticidade {num(e[0], 2)} (n = {e[3]}): provável efeito do preço seguir a demanda; não use como regra.", "Não sustentada pelos dados"))
    R.regras = regras
    h += nota("As regras abaixo são <b>associações históricas</b>, não causalidade: o desconto e o preço já acompanham a demanda. Use-as como hipóteses para testar com mudanças controladas.", "alerta")
    h += tabela(["Regra", "Evidência", "Situação"], regras or [("–", "Nenhuma regra com evidência suficiente.", "–")], [None, None, None])
    R.secoes.append(("regras", "F. Regras iniciais de ajuste de preço", h))


def sec_qualidade(R, fim):
    q = R.q
    h = sub("36. Qualidade dos dados", "O que foi marcado, e não corrigido.")
    tot = q("SELECT count(*) FROM reservas_flags")[0][0]
    f = q("SELECT sum(rack_zero::INT), sum(fora_faixa::INT), sum(upgrade::INT), sum(dias_divergente::INT), sum(sem_veiculo::INT) FROM reservas_flags")[0]
    acima = q("SELECT count(*), count(*) FILTER (WHERE ocupacao > 1) FROM base_diaria")[0]
    sem_frota = q("""SELECT count(*) FROM diarias d WHERE NOT EXISTS (SELECT 1 FROM frota_dia_categoria f WHERE f.data = d.data AND f.categoria_id = d.categoria_id)""")[0][0]
    neg = q("SELECT count(*) FROM diarias WHERE antecedencia < 0")[0][0]
    sem_compra = q("SELECT id, chave, categoria_id FROM veiculos WHERE try_cast(chave AS INT) BETWEEN 1 AND 125 AND data_compra IS NULL")
    rows = [("Reservas completed analisadas (retirada ≥ 01/12/2023)", tot), ("Rack zero ou negativo (fora das análises de preço)", f[0]),
            ("Reserva com veículo fora da faixa 001–125", f[1]), ("Reserva com veículo de categoria diferente da reservada (upgrade)", f[2]),
            ("Reserva com total_days diferente das datas", f[3]), ("Reserva sem veículo vinculado", f[4]),
            ("Dias × categoria com ocupação > 100%", acima[1]), ("Dias × categoria no total", acima[0]),
            ("Diárias vendidas em categoria sem frota ativa no dia", sem_frota), ("Diárias com antecedência negativa", neg)]
    h += tabela(["Verificação", "Quantidade"], rows, [None, num], None, 1)
    h += nota("Veículos da faixa 001–125 sem data de compra (usam a data de entrada, com aviso): " + (", ".join(f"chave {c}" for _, c, _ in sem_compra) or "nenhum") + ".")
    sem = q("SELECT count(*) FROM frota_valida WHERE entrada_alternativa")[0][0]
    h += sub("37. Cobertura", "Quantidade de dias e diárias por sazonalidade × categoria.")
    rows = q("""SELECT b.sazonalidade, b.categoria, count(*) dias, sum(b.diarias_vendidas), count(DISTINCT year(b.data)) FROM base_diaria b GROUP BY 1,2
                ORDER BY array_position(['Altíssima','Alta','Média','Baixa','Baixíssima'], b.sazonalidade), 2""")
    h += tabela(["Sazonalidade", "Categoria", "Dias", "Diárias vendidas", "Anos cobertos"], rows, [None, None, num, num, num], None, 2)
    R.csv("cobertura", ["sazonalidade", "categoria", "dias", "diarias_vendidas", "anos"], rows)
    R.secoes.append(("qualidade", "G. Qualidade dos dados", h))


def sec_limitacoes(R):
    itens = [
        "<b>Preço base histórico.</b> O rack gravado na reserva é o da última recalculação: o detalhe do rack foi criado, em mediana, cerca de 34 dias depois da reserva. Não há como confirmar que é o preço vigente na data da compra.",
        "<b>Tarifas da API.</b> A API só expõe a tabela de tarifas da temporada base e um calendário diário de 2027; não há tarifas de 2024 a 2026, e muitas temporadas antigas foram editadas em 19/03/2026 sem histórico. Por isso o preço base histórico não é recuperável.",
        "<b>Preço base = rack + desconto</b> é uma definição de negócio: mede o preço antes do desconto na reserva, não a tarifa de tabela da data da compra.",
        "<b>Frota por veículo ativo.</b> A frota diária é o número de veículos de chave 001 a 125 com data de compra até o dia e sem saída anterior.",
        "<b>Diárias do HQ.</b> Usamos o total_days do HQ, que em parte das reservas difere da contagem por data e hora (ver qualidade dos dados).",
        "<b>Upgrades e veículos fora da faixa.</b> A venda é atribuída à categoria reservada; diárias com veículo de chave fora de 001–125 ficam marcadas.",
        "<b>Snapshot de tarifas.</b> Só cobre os dados a partir do dia em que for iniciado.",
        "<b>Chave 091.</b> Não existe na API.",
        "<b>Elasticidade.</b> É aproximada e sujeita ao viés de o preço acompanhar a demanda; não é causal.",
    ]
    R.secoes.append(("limitacoes", "Limitações dos dados", "<ul>" + "".join(f"<li>{i}</li>" for i in itens) + "</ul>"))


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
    sec_elasticidade(R)
    sec_regras(R)
    sec_qualidade(R, fim)
    sec_limitacoes(R)
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
