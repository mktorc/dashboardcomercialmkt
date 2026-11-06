"""Ocupação esperada por categoria e data (a partir de hoje) e publica no Supabase (tabela pricing_occupancy_forecast).

Uso: python3 scripts/precificacao/previsao.py [--publicar] [--dias 540]
Para cada data futura T e categoria c:
  - hoje: diárias já vendidas para T (reservas open/rental/completed; canceladas, orçamentos e pendentes ficam de fora) ÷ carros disponíveis em T;
  - esperado: ocupação de hoje + ganho típico de vendas daqui até T. O ganho vem do histórico: em datas passadas da mesma categoria e
    sazonalidade, quanto a ocupação cresceu entre (T − dias de antecedência) e o dia. Mostra mediana e faixa (25%–75%).
Frota de T = carros de chave 001–125 (categorias 1 e 7 fora) na frota em T e sem bloqueio cadastrado no HQ em T.
"""
import argparse, json, sys
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from hq import carregar_env
import analisar as A

DB = A.DB
JANELA_HIST = 730  # dias de histórico usados na curva de vendas
N_MIN = 20  # observações mínimas por categoria+sazonalidade; abaixo disso usa todas as sazonalidades da categoria


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=540)
    ap.add_argument("--publicar", action="store_true")
    a = ap.parse_args()
    hoje = date.today()
    fim = hoje + timedelta(days=a.dias)
    con = duckdb.connect(str(DB))
    A.preparar(con, fim)  # inclui bloqueios e categorias inativas; frota/diárias até `fim`
    cats = dict(con.execute("SELECT id, nome FROM categorias WHERE id NOT IN (1, 7) AND id IN (SELECT categoria_id FROM frota_valida)").fetchall())
    saz = dict((d, s) for d, s in con.execute("SELECT data, sazonalidade FROM dim_calendario").fetchall())
    frota = {(d, c): n for d, c, n in con.execute("SELECT data, categoria_id, frota FROM frota_dia_categoria").fetchall()}
    # diárias por (data, categoria) -> lista de antecedências (dias entre a compra e o dia)
    ant = {}
    for d, c, x in con.execute("SELECT data, categoria_id, antecedencia FROM diarias").fetchall():
        ant.setdefault((d, c), []).append(x)
    # frota futura: os carros de hoje, sem os que têm saída marcada e sem bloqueios (já descontados em frota_dia_categoria)
    ini_hist = hoje - timedelta(days=JANELA_HIST)
    ganhos = {}  # (categoria, sazonalidade, antecedência) -> lista de ganhos (pontos de ocupação)
    L_MAX = a.dias
    for c in cats:
        for i in range((hoje - ini_hist).days):
            d = ini_hist + timedelta(days=i)
            f = frota.get((d, c))
            if not f:
                continue
            v = np.array(ant.get((d, c), []), dtype=int)
            final = len(v) / f
            for L in range(0, L_MAX + 1):
                ganhos.setdefault((c, saz[d], L), []).append(final - float((v >= L).sum()) / f)
    # junta por (categoria, antecedência) para o fallback
    por_cat = {}
    for (c, s, L), xs in ganhos.items():
        por_cat.setdefault((c, L), []).extend(xs)

    linhas = []
    for i in range(1, a.dias + 1):
        t = hoje + timedelta(days=i)
        for c, nome in cats.items():
            f = frota.get((t, c))
            if not f:
                continue
            vendidas = len([x for x in ant.get((t, c), [])])
            atual = vendidas / f
            xs = ganhos.get((c, saz[t], i), [])
            base = "sazonalidade"
            if len(xs) < N_MIN:
                xs, base = por_cat.get((c, i), []), "categoria (todas as sazonalidades)"
            if len(xs) < N_MIN:
                continue
            p25, p50, p75 = (float(np.percentile(xs, q)) for q in (25, 50, 75))
            linhas.append(dict(d=t.isoformat(), c=nome, f=int(f), v=vendidas, o=round(atual, 4), e=round(atual + p50, 4),
                               lo=round(atual + p25, 4), hi=round(atual + p75, 4), n=len(xs), b=base, s=saz[t]))
    payload = dict(gerado_em=datetime.now().isoformat(timespec="seconds"), hoje=hoje.isoformat(), ate=fim.isoformat(),
                   categorias=sorted(cats.values()), linhas=linhas)
    out = Path("data/precificacao/relatorio/previsao.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"{len(linhas)} linhas (data × categoria) em {out}")
    if a.publicar:
        carregar_env()
        import publicar as P
        P.chamar("POST", "pricing_occupancy_forecast", {"as_of": hoje.isoformat(), "payload": payload}, {"Prefer": "return=minimal"})
        for r in P.chamar("GET", "pricing_occupancy_forecast?select=id&order=generated_at.desc&offset=5") or []:
            P.chamar("DELETE", f"pricing_occupancy_forecast?id=eq.{r['id']}")
        print("Previsão publicada.")


if __name__ == "__main__":
    main()
