"""Ritmo de reservas (pickup) por categoria e data de retirada, para a Gestão de Ocupação. Publica em pricing_occupancy_pace.

Uso: python3 scripts/precificacao/ritmo.py [--publicar] [--futuro 180]
Publica, para cada data de retirada T e categoria c (T entre o início do histórico e hoje + --futuro):
  - f: carros disponíveis em T (frota sem bloqueios, igual a previsao.py);
  - a: antecedência (dias entre a criação da reserva e T) de cada diária vendida para T (open/rental/completed; canceladas fora).
    Com ela a tela reconstrói a ocupação de T em qualquer antecedência L: diárias com a ≥ L ÷ f (D-0 = todas).
  - m: preço pago de cada diária (mesma ordem de a; 0 = sem preço). Em antecedência L: faturamento = soma de m onde a ≥ L; diária média = ÷ nº de m > 0; por veículo = ÷ f.
  - cal: sazonalidade, evento móvel e posição relativa ao evento de cada data, pelas regras GESTAO de calendario.py.
O benchmark NÃO é pré-calculado: a tela o calcula com a data-base escolhida, usando só datas já encerradas antes dela
(sem vazamento de futuro). Hierarquia (src/lib/occupancy-pace.ts, parâmetros em `params`):
  1. data de evento móvel: mesmo evento, mesma posição relativa ao evento, mesma categoria (só datas de evento);
  2. data comum: mesma categoria, sazonalidade e dia da semana (sem datas de evento);
  3. data comum: mesma categoria e sazonalidade (sem datas de evento).
  Abaixo do mínimo de amostras de cada nível, sem benchmark; nunca se usa ocupação final no lugar de uma antecedência.
  - x: reservas CANCELADAS (cancelled/cancelled-paid), uma entrada [criada, cancelada] por diária: antecedência da criação e da
    última atualização da reserva (proxy da data do cancelamento; null se a atualização é posterior à retirada, quando não dá para
    saber). Permite separar captura bruta, líquida e a posição "ativa" em D-L (criada até D-L e ainda não cancelada).
Fonte (v6): trechos por veículo, regra por mês e frota igual ao dashboard comercial (ver comentário em main()).
Limitação: o HQ só guarda o status atual: não há histórico de alterações de data/categoria, e a data do cancelamento é o proxy acima.
"""
import argparse, json, math, sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from hq import carregar_env
import analisar as A
import calendario as CAL

PARAMS = dict(n_evento=2, n_dow=8, n_saz=15, estatistica="media")
MAX_ANT = 400  # antecedências maiores não mudam nenhuma leitura até D-400


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--futuro", type=int, default=180)
    ap.add_argument("--publicar", action="store_true")
    a = ap.parse_args()
    hoje = date.today()
    fim = hoje + timedelta(days=a.futuro)
    ini = A.INI
    con = duckdb.connect(str(A.DB))
    A.preparar(con, fim)
    # Mesma regra do dashboard comercial (src/lib/occupancy.ts, Utilização do HQ), por TRECHO de veículo (reserva_veiculos) e por MÊS:
    # POR DIA (o relatório do HQ para uma data): o trecho conta 1 em cada data que ele encosta, da retirada à devolução inclusive
    # (com janela de um dia, max(1, ceil((horas − 5 h) / 24)) é sempre 1). Assim cada data bate com a Utilização do HQ filtrada nela;
    # a soma das datas de um mês não é a do relatório mensal (que arredonda o trecho inteiro no mês).
    # Categoria = a do VEÍCULO que rodou (a da reserva só se o trecho não tem veículo). Todos os trechos entram (como reservation_segments).
    # Preço da diária = rack_total ÷ soma dos dias de todos os trechos da reserva (reserva com rack zerado fica sem preço).
    # Capacidade = veículos na frota no dia (data_entrada ≤ dia < saída, como fleet_vehicles), sem descontar bloqueios e sem os
    # vendidos: o relatório de Utilização do HQ não os conta na capacidade, nem nos meses em que ainda estavam na frota.
    cats = dict(con.execute("SELECT id, nome FROM categorias WHERE id NOT IN (1, 7) AND id IN (SELECT categoria_id FROM veiculos WHERE coalesce(data_entrada, data_compra) IS NOT NULL)").fetchall())
    frota = {(d, c): n for d, c, n in con.execute(f"""SELECT c.data, v.categoria_id, count(*) FROM dim_calendario c JOIN veiculos v
        ON coalesce(v.data_entrada, v.data_compra) <= c.data AND (v.data_saida IS NULL OR c.data < v.data_saida)
        WHERE v.categoria_id NOT IN (1, 7) AND v.status IS DISTINCT FROM 'sold' AND c.data BETWEEN DATE '{ini}' AND DATE '{fim}' GROUP BY 1, 2""").fetchall()}
    # Frota histórica (com os veículos depois vendidos): capacidade das datas passadas usadas como referência da esperada.
    frota_g = {(d, c): n for d, c, n in con.execute(f"""SELECT c.data, v.categoria_id, count(*) FROM dim_calendario c JOIN veiculos v
        ON coalesce(v.data_entrada, v.data_compra) <= c.data AND (v.data_saida IS NULL OR c.data < v.data_saida)
        WHERE v.categoria_id NOT IN (1, 7) AND c.data BETWEEN DATE '{ini}' AND DATE '{fim}' GROUP BY 1, 2""").fetchall()}

    def dias_mes(p, d):
        """[(data, dias)] por mês: dia inicial do trecho no mês e dias contados pela regra do dashboard."""
        out, m = [], date(p.year, p.month, 1)
        while m <= d.date():
            nxt = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
            ini_m, fim_m = datetime(m.year, m.month, 1), datetime(nxt.year, nxt.month, 1)
            if d.date() >= m and p.date() < nxt:
                h = (min(d, fim_m) - max(p, ini_m)).total_seconds() / 3600
                out.append((max(p.date(), m), max(1, math.ceil((h - 5) / 24 - 1e-9))))
            m = nxt
        return out

    ant, canc = defaultdict(list), defaultdict(list)
    por_res = defaultdict(list)
    for rid, p_, d_, criada, atual, r_ret, rack, st, cat in con.execute(
        """SELECT rv.reserva_id, rv.retirada, rv.devolucao, r.criada_em, r.atualizada_em, r.retirada, r.rack_total, r.status,
                  coalesce(v.categoria_id, r.categoria_id)
           FROM reserva_veiculos rv JOIN reservas r ON r.id = rv.reserva_id LEFT JOIN veiculos v ON v.id = rv.veiculo_id
           WHERE rv.retirada IS NOT NULL AND rv.devolucao IS NOT NULL
             AND r.status IN ('completed', 'open', 'rental', 'cancelled', 'cancelled-paid')""").fetchall():
        por_res[rid].append((p_, d_, criada, atual, r_ret, rack, st, cat))
    # Trechos confirmados (por categoria) para a tela calcular a ocupação de QUALQUER intervalo com a regra do HQ para a janela exata:
    # [índice da categoria em `categorias`, retirada, devolução], em minutos desde 1970 (horários do HQ como estão, sem fuso).
    nomes_ord = sorted(cats.values())
    idx = {c: nomes_ord.index(n) for c, n in cats.items()}
    epoch = datetime(1970, 1, 1)
    trechos_conf = [
        [idx[t[7]], int((t[0] - epoch).total_seconds() // 60), int((t[1] - epoch).total_seconds() // 60)]
        for ts in por_res.values() for t in ts
        if t[6] in ("completed", "open", "rental") and t[7] in idx
    ]
    for rid, trechos in por_res.items():
        itens = [(t[0].date() + timedelta(days=k), t) for t in trechos for k in range((t[1].date() - t[0].date()).days + 1)]
        total = len(itens)
        for dia, (p_, d_, criada, atual, r_ret, rack, st, cat) in itens:
            if dia < ini or dia > fim or cat in (1, 7):
                continue
            x = max(-1, min((dia - criada.date()).days, MAX_ANT))
            if st in ("completed", "open", "rental"):
                ant[(dia, cat)].append((x, round(rack / total, 1) if rack and rack > 0 else 0))
            else:
                y = (dia - atual.date()).days if atual.date() <= r_ret.date() else None
                canc[(dia, cat)].append([x, None if y is None else max(-1, min(y, MAX_ANT))])

    linhas, cal = [], {}
    d = ini
    while d <= fim:
        s, _, ev, rel = CAL.classificar_dia(d, CAL.GESTAO)
        linhas_dia = 0
        for c, nome in cats.items():
            f = frota.get((d, c)) or 0
            g = frota_g.get((d, c)) or 0
            if f or g:
                par = sorted(ant.get((d, c), []))
                row = dict(d=d.isoformat(), c=nome, f=int(f), a=[x for x, _ in par])
                if g != f:
                    row["g"] = int(g)
                if any(m for _, m in par):
                    row["m"] = [m for _, m in par]  # preço de cada diária (US$, igual ordem de `a`; 0 = sem preço)
                if canc.get((d, c)):
                    row["x"] = sorted(canc[(d, c)], key=lambda t: (t[0], -1 if t[1] is None else t[1]))
                linhas.append(row)
                linhas_dia += 1
        if linhas_dia:
            cal[d.isoformat()] = [s, ev, rel]
        d += timedelta(days=1)
    payload = dict(versao=7, gerado_em=datetime.now().isoformat(timespec="seconds"), hoje=hoje.isoformat(), de=linhas[0]["d"],
                   ate=fim.isoformat(), categorias=sorted(cats.values()), params=PARAMS, cal=cal, linhas=linhas, t=trechos_conf)
    out = Path("data/precificacao/relatorio/ritmo.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(linhas)} linhas (data × categoria) em {out} ({out.stat().st_size // 1024} KB)")
    if a.publicar:
        carregar_env()
        import publicar as P
        P.chamar("POST", "pricing_occupancy_pace", {"as_of": hoje.isoformat(), "payload": payload}, {"Prefer": "return=minimal"})
        for r in P.chamar("GET", "pricing_occupancy_pace?select=id&order=generated_at.desc&offset=5") or []:
            P.chamar("DELETE", f"pricing_occupancy_pace?id=eq.{r['id']}")
        print("Ritmo publicado.")


if __name__ == "__main__":
    main()
