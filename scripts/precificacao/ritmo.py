"""Ritmo de reservas (pickup) por categoria e data de retirada, para a Gestão de Ocupação. Publica em pricing_occupancy_pace.

Uso: python3 scripts/precificacao/ritmo.py [--publicar] [--futuro 180]
Publica, para cada data de retirada T e categoria c (T entre o início do histórico e hoje + --futuro):
  - f: carros disponíveis em T (frota sem bloqueios, igual a previsao.py);
  - a: antecedência (dias entre a criação da reserva e T) de cada diária vendida para T (open/rental/completed; canceladas fora).
    Com ela a tela reconstrói a ocupação de T em qualquer antecedência L: diárias com a ≥ L ÷ f (D-0 = todas).
  - cal: sazonalidade, evento móvel e posição relativa ao evento de cada data, pelas regras GESTAO de calendario.py.
O benchmark NÃO é pré-calculado: a tela o calcula com a data-base escolhida, usando só datas já encerradas antes dela
(sem vazamento de futuro). Hierarquia (src/lib/occupancy-pace.ts, parâmetros em `params`):
  1. data de evento móvel: mesmo evento, mesma posição relativa ao evento, mesma categoria (só datas de evento);
  2. data comum: mesma categoria, sazonalidade e dia da semana (sem datas de evento);
  3. data comum: mesma categoria e sazonalidade (sem datas de evento).
  Abaixo do mínimo de amostras de cada nível, sem benchmark; nunca se usa ocupação final no lugar de uma antecedência.
Limitação: reservas canceladas depois não aparecem nas fotos antigas (o HQ só guarda o status atual).
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
    cats = dict(con.execute("SELECT id, nome FROM categorias WHERE id NOT IN (1, 7) AND id IN (SELECT categoria_id FROM frota_valida)").fetchall())
    frota = {(d, c): n for d, c, n in con.execute("SELECT data, categoria_id, frota FROM frota_dia_categoria").fetchall()}
    ant = defaultdict(list)
    for d, c, x in con.execute("SELECT data, categoria_id, antecedencia FROM diarias").fetchall():
        ant[(d, c)].append(max(-1, min(int(x), MAX_ANT)))

    linhas, cal = [], {}
    d = ini
    while d <= fim:
        s, _, ev, rel = CAL.classificar_dia(d, CAL.GESTAO)
        linhas_dia = 0
        for c, nome in cats.items():
            f = frota.get((d, c))
            if f:
                linhas.append(dict(d=d.isoformat(), c=nome, f=int(f), a=sorted(ant.get((d, c), []))))
                linhas_dia += 1
        if linhas_dia:
            cal[d.isoformat()] = [s, ev, rel]
        d += timedelta(days=1)
    payload = dict(versao=2, gerado_em=datetime.now().isoformat(timespec="seconds"), hoje=hoje.isoformat(), de=linhas[0]["d"],
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
