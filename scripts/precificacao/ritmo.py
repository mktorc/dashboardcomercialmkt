"""Ritmo de reservas (pickup) por categoria e data de retirada, para a Gestão de Ocupação. Publica em pricing_occupancy_pace.

Uso: python3 scripts/precificacao/ritmo.py [--publicar] [--futuro 180]
Publica, para cada data de retirada T e categoria c (T entre o início do histórico e hoje + --futuro):
  - f: carros disponíveis em T (frota sem bloqueios, igual a previsao.py);
  - a: antecedência (dias entre a criação da reserva e T) de cada diária vendida para T (open/rental/completed; canceladas fora).
    Com ela a tela reconstrói a ocupação de T em qualquer antecedência L: diárias com a ≥ L ÷ f (D-0 = todas).
  - v, p: faturamento da data (soma do preço pago por diária) e nº de diárias com preço; diária média = v/p, faturamento por veículo = v/f.
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
Fonte (v5): trechos por veículo e frota sem bloqueios, igual ao Utilization do HQ (ver comentário em main()).
Limitação: o HQ só guarda o status atual: não há histórico de alterações de data/categoria, e a data do cancelamento é o proxy acima.
"""
import argparse, json, sys
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
    # Mesma regra do Utilization do HQ (src/lib/occupancy.ts): cada TRECHO de veículo (reserva_veiculos) vira dias = max(1, ceil((horas − 5 h) / 24)),
    # a partir da data de retirada do trecho, na categoria do VEÍCULO que rodou (a da reserva só se o trecho não tem veículo).
    # Reserva com 2 veículos ou troca de carro gera 2 trechos. Preço da diária = rack_total ÷ soma dos dias dos trechos da reserva.
    # Capacidade = veículos na frota no dia (entrada ≤ dia < saída), como fleet_vehicles do Supabase: sem descontar bloqueios.
    SEG = """WITH s AS (SELECT rv.reserva_id, rv.retirada AS p, rv.devolucao AS d, r.criada_em, r.atualizada_em, r.retirada AS r_ret, r.rack_total, r.status,
                   coalesce(v.categoria_id, r.categoria_id) AS cat
                 FROM reserva_veiculos rv JOIN reservas r ON r.id = rv.reserva_id LEFT JOIN veiculos v ON v.id = rv.veiculo_id
                 WHERE rv.retirada IS NOT NULL AND rv.devolucao IS NOT NULL AND rv.ativo IS NOT FALSE
                   AND coalesce(v.categoria_id, r.categoria_id) NOT IN (1, 7)),
               sd AS (SELECT *, greatest(1, CAST(ceil((epoch(d - p) / 3600.0 - 5) / 24 - 1e-9) AS INT)) AS n FROM s),
               tot AS (SELECT reserva_id, sum(n) AS tn FROM sd GROUP BY 1),
               dd AS (SELECT sd.*, tot.tn, CAST(sd.p AS DATE) + CAST(k AS INT) AS dt FROM (SELECT *, unnest(range(n)) AS k FROM sd) sd JOIN tot USING (reserva_id))"""
    cats = dict(con.execute("SELECT id, nome FROM categorias WHERE id NOT IN (1, 7) AND id IN (SELECT categoria_id FROM frota_valida)").fetchall())
    frota = {(d, c): n for d, c, n in con.execute(f"""SELECT c.data, v.categoria_id, count(*) FROM dim_calendario c JOIN veiculos v
        ON coalesce(v.data_compra, v.data_entrada) <= c.data AND (v.data_saida IS NULL OR c.data < v.data_saida)
        WHERE v.categoria_id NOT IN (1, 7) AND c.data BETWEEN DATE '{ini}' AND DATE '{fim}' GROUP BY 1, 2""").fetchall()}
    ant = defaultdict(list)
    fat = {}
    for d, c, x, v, n in con.execute(SEG + """ SELECT dt, cat, date_diff('day', CAST(criada_em AS DATE), dt), CASE WHEN rack_total > 0 THEN rack_total / tn END, 1
                 FROM dd WHERE status IN ('completed', 'open', 'rental')""").fetchall():
        ant[(d, c)].append(max(-1, min(int(x), MAX_ANT)))
        if v is not None:
            t = fat.get((d, c), (0.0, 0))
            fat[(d, c)] = (t[0] + float(v), t[1] + 1)

    canc = defaultdict(list)
    for d, c, x, y in con.execute(SEG + """ SELECT dt, cat, date_diff('day', CAST(criada_em AS DATE), dt),
                 CASE WHEN CAST(atualizada_em AS DATE) <= CAST(r_ret AS DATE) THEN date_diff('day', CAST(atualizada_em AS DATE), dt) END
               FROM dd WHERE status IN ('cancelled', 'cancelled-paid')""").fetchall():
        canc[(d, c)].append([max(-1, min(int(x), MAX_ANT)), None if y is None else max(-1, min(int(y), MAX_ANT))])

    linhas, cal = [], {}
    d = ini
    while d <= fim:
        s, _, ev, rel = CAL.classificar_dia(d, CAL.GESTAO)
        linhas_dia = 0
        for c, nome in cats.items():
            f = frota.get((d, c))
            if f:
                row = dict(d=d.isoformat(), c=nome, f=int(f), a=sorted(ant.get((d, c), [])))
                if fat.get((d, c)):
                    row["v"], row["p"] = round(fat[(d, c)][0], 2), fat[(d, c)][1]
                if canc.get((d, c)):
                    row["x"] = sorted(canc[(d, c)], key=lambda t: (t[0], -1 if t[1] is None else t[1]))
                linhas.append(row)
                linhas_dia += 1
        if linhas_dia:
            cal[d.isoformat()] = [s, ev, rel]
        d += timedelta(days=1)
    payload = dict(versao=5, gerado_em=datetime.now().isoformat(timespec="seconds"), hoje=hoje.isoformat(), de=linhas[0]["d"],
                   ate=fim.isoformat(), categorias=sorted(cats.values()), params=PARAMS, cal=cal, linhas=linhas)
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
