"""Extrai dados do HQ Rentals (somente GET) para o cache DuckDB local.

Uso: python3 -I scripts/precificacao/extrair.py --inicio 2023-06-24 --fim 2024-01-31
Reexecutável: upsert por id; checkpoint de página em controle_extracao (retoma se falhar).
Guarda apenas campos necessários; o objeto `customer` e demais dados pessoais são descartados.
"""
import argparse, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from hq import HQ
from calendario import tabela

DB = Path("data/precificacao/hq_cache.duckdb")

DDL = """
CREATE TABLE IF NOT EXISTS reservas(id BIGINT PRIMARY KEY, criada_em TIMESTAMP, retirada TIMESTAMP, devolucao TIMESTAMP,
  atualizada_em TIMESTAMP, status VARCHAR, categoria_id INT, dias INT, moeda VARCHAR, rack_total DOUBLE, desconto DOUBLE,
  misc DOUBLE, cobr_externas DOUBLE, taxas DOUBLE, total DOUBLE);
CREATE TABLE IF NOT EXISTS reserva_veiculos(reserva_id BIGINT, veiculo_id INT, retirada TIMESTAMP, devolucao TIMESTAMP, ativo BOOLEAN);
CREATE TABLE IF NOT EXISTS rack_detalhes(reserva_id BIGINT, season_id INT, dias INT, diaria DOUBLE, inicio TIMESTAMP, fim TIMESTAMP, criado_em TIMESTAMP);
CREATE TABLE IF NOT EXISTS veiculos(id INT PRIMARY KEY, chave VARCHAR, categoria_id INT, data_compra DATE, data_saida DATE, status VARCHAR, na_lista BOOLEAN, data_entrada DATE);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS data_entrada DATE;
CREATE TABLE IF NOT EXISTS bloqueios(id INT PRIMARY KEY, veiculo_id INT, inicio TIMESTAMP, fim TIMESTAMP, descricao VARCHAR);
CREATE TABLE IF NOT EXISTS categorias(id INT PRIMARY KEY, nome VARCHAR, ativa BOOLEAN);
CREATE TABLE IF NOT EXISTS temporadas(id INT PRIMARY KEY, nome VARCHAR, inicio DATE, fim DATE, versao INT, atualizada_em TIMESTAMP);
CREATE TABLE IF NOT EXISTS tarifas_atuais(id INT PRIMARY KEY, season_id INT, categoria_id INT, diaria DOUBLE, semanal DOUBLE, mensal DOUBLE, versao INT);
CREATE TABLE IF NOT EXISTS snapshot_tarifas(data_snapshot DATE, id INT, season_id INT, season_nome VARCHAR, season_inicio DATE, season_fim DATE, categoria_id INT, diaria DOUBLE, semanal DOUBLE, mensal DOUBLE, versao INT);
CREATE TABLE IF NOT EXISTS snapshot_temporadas(data_snapshot DATE, id INT, nome VARCHAR, inicio DATE, fim DATE, versao INT, atualizada_em TIMESTAMP);
CREATE TABLE IF NOT EXISTS dim_calendario(data DATE PRIMARY KEY, sazonalidade VARCHAR, regra_aplicada VARCHAR);
CREATE TABLE IF NOT EXISTS controle_extracao(etapa VARCHAR PRIMARY KEY, ultima_pagina INT, atualizado_em TIMESTAMP, detalhe VARCHAR);
"""


def f(v):
    return None if v in (None, "") else float(v)


def ts(v):
    return None if not v else datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None)


def dt(v):
    return None if not v else datetime.fromisoformat(v.replace("Z", "+00:00")).date() if "T" in v else date.fromisoformat(v[:10])


def upsert(con, tabela_, linhas, chave):
    for ln in linhas:
        cols = list(ln)
        con.execute(f"DELETE FROM {tabela_} WHERE " + " AND ".join(f"{c}=?" for c in chave), [ln[c] for c in chave])
        con.execute(f"INSERT INTO {tabela_}({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", list(ln.values()))


def reservas(con, hq, ini, fim):
    r = con.execute("SELECT ultima_pagina FROM controle_extracao WHERE etapa='reservas'").fetchone()
    pagina = (r[0] + 1) if r and r[0] else 1
    if pagina > 1:
        print(f"Retomando reservas da página {pagina}")
    total_pag = None
    while total_pag is None or pagina <= total_pag:
        j = hq.get(f"car-rental/reservations?limit=100&page={pagina}")
        total_pag = j["last_page"]
        for x in j["data"]:
            ret = ts(x["pick_up_date"])
            if not (ini <= ret.date() <= fim):
                continue
            upsert(con, "reservas", [dict(id=x["id"], criada_em=ts(x["created_at"]), retirada=ret, devolucao=ts(x["return_date"]),
                atualizada_em=ts(x["updated_at"]), status=x["status"], categoria_id=x["vehicle_class_id"], dias=x["total_days"],
                moeda=x["currency"], rack_total=f(x["total_rack_rate"]), desconto=f(x["discounts_amount"]), misc=f(x["miscellaneous_price"]),
                cobr_externas=f(x["external_charges_price"]), taxas=f(x["taxes_amount"]), total=f(x["total_price"]))], ["id"])
            con.execute("DELETE FROM reserva_veiculos WHERE reserva_id=?", [x["id"]])
            con.execute("DELETE FROM rack_detalhes WHERE reserva_id=?", [x["id"]])
            for v in x.get("reservation_vehicle_information") or []:
                con.execute("INSERT INTO reserva_veiculos VALUES (?,?,?,?,?)", [x["id"], v["vehicle_id"], ts(v["pick_up_date"]), ts(v["return_date"]), v["active"]])
            for d in x.get("rack_rate_details") or []:
                con.execute("INSERT INTO rack_detalhes VALUES (?,?,?,?,?,?,?)", [x["id"], d["season_id"], d["days"], f(d["base_daily_price"]),
                    ts(d["date_start"]), ts(d["date_end"]), ts(d["created_at"])])
        con.execute("DELETE FROM controle_extracao WHERE etapa='reservas'")
        con.execute("INSERT INTO controle_extracao VALUES ('reservas',?,now(),?)", [pagina, f"{ini}..{fim}"])
        if pagina % 10 == 0:
            print(f"  página {pagina}/{total_pag}", flush=True)
        pagina += 1
    con.execute("DELETE FROM controle_extracao WHERE etapa='reservas'")  # concluído: próxima execução recomeça do início


def frota(con, hq):
    listados = {}
    for v in hq.get("fleets/vehicles?limit=500")["data"]:
        listados[v["id"]] = v
    for vid in range(1, 141):
        v = listados.get(vid) or (hq.get(f"fleets/vehicles/{vid}") or {}).get("data")
        if not v:
            continue
        upsert(con, "veiculos", [dict(id=v["id"], chave=v["vehicle_key"], categoria_id=v["vehicle_class_id"], data_compra=dt(v.get("f228")),
            data_saida=dt(v.get("vehicle_exit_date")), status=v["status"], na_lista=vid in listados,
            data_entrada=dt(v.get("vehicle_entry_date")))], ["id"])


def bloqueios(con, hq):
    """Períodos de bloqueio (oficina, indisponível) dos veículos de chave 001–125, de fleets/vehicles/{id}/blocked-periods."""
    ids = [r[0] for r in con.execute("SELECT id FROM veiculos WHERE try_cast(chave AS INT) BETWEEN 1 AND 125").fetchall()]
    for vid in ids:
        j = hq.get(f"fleets/vehicles/{vid}/blocked-periods?limit=500") or {}
        for b in j.get("blocked_periods") or []:
            upsert(con, "bloqueios", [dict(id=b["id"], veiculo_id=vid, inicio=ts(b["start_date"].replace(" ", "T")), fim=ts(b["end_date"].replace(" ", "T")),
                descricao=(b.get("description") or "")[:200])], ["id"])


def categorias_tarifas(con, hq, com_tarifas=False):
    for c in hq.get("fleets/vehicle-classes?limit=100")["fleets_vehicle_classes"]:
        upsert(con, "categorias", [dict(id=c["id"], nome=c["name"], ativa=c["active"])], ["id"])
    temporadas = hq.get("car-rental/seasons?limit=100")
    for s in (temporadas if isinstance(temporadas, list) else temporadas["data"]):
        upsert(con, "temporadas", [dict(id=s["id"], nome=s["name"], inicio=dt(s["date_start"]), fim=dt(s["date_end"]), versao=s["version"],
            atualizada_em=ts(s["updated_at"]))], ["id"])
    if not com_tarifas:
        return
    # A lista de tarifas ignora filtros/paginação: busca por id (~2.700 ids, boa parte de temporadas fora da lista), em paralelo.
    validas = {r[0] for r in con.execute("SELECT id FROM temporadas").fetchall()}
    with ThreadPoolExecutor(max_workers=8) as ex:
        resultados = list(ex.map(lambda i: hq.get(f"car-rental/rates/{i}"), range(1, 2901)))
    for j in resultados:
        if not j or "car_rental_rate" not in j or j["car_rental_rate"]["season_id"] not in validas:
            continue
        r = j["car_rental_rate"]
        upsert(con, "tarifas_atuais", [dict(id=r["id"], season_id=r["season_id"], categoria_id=r["vehicle_class_id"], diaria=f(r["daily_rate"]),
            semanal=f(r["weekly_rate"]), mensal=f(r["monthly_rate"]), versao=r["version"])], ["id"])


def snapshot(con, hq):
    """Cópia datada das temporadas e de TODAS as tarifas (inclui o calendário diário de 2027). Nunca sobrescreve snapshots anteriores."""
    hoje = date.today()
    if con.execute("SELECT count(*) FROM snapshot_tarifas WHERE data_snapshot=?", [hoje]).fetchone()[0]:
        print("Snapshot de hoje já existe.")
        return
    temporadas = hq.get("car-rental/seasons?limit=100")
    for s in (temporadas if isinstance(temporadas, list) else temporadas["data"]):
        con.execute("INSERT INTO snapshot_temporadas VALUES (?,?,?,?,?,?,?)", [hoje, s["id"], s["name"], dt(s["date_start"]), dt(s["date_end"]), s["version"], ts(s["updated_at"])])
    with ThreadPoolExecutor(max_workers=8) as ex:
        resultados = list(ex.map(lambda i: hq.get(f"car-rental/rates/{i}"), range(1, 2901)))
    for j in resultados:
        if not j or "car_rental_rate" not in j:
            continue
        r = j["car_rental_rate"]
        se = r.get("season") or {}
        con.execute("INSERT INTO snapshot_tarifas VALUES (?,?,?,?,?,?,?,?,?,?,?)", [hoje, r["id"], r["season_id"], se.get("name"), dt(se.get("date_start")), dt(se.get("date_end")),
            r["vehicle_class_id"], f(r["daily_rate"]), f(r["weekly_rate"]), f(r["monthly_rate"]), r["version"]])


def calendario(con):
    con.execute("DELETE FROM dim_calendario")
    for d, s, r in tabela(date(2023, 1, 1), date(2028, 12, 31)):
        con.execute("INSERT INTO dim_calendario VALUES (?,?,?)", [d, s, r])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inicio", default="2023-06-24")
    ap.add_argument("--fim", default=date.today().isoformat())
    ap.add_argument("--snapshot", action="store_true", help="grava cópia datada das temporadas e tarifas e sai")
    ap.add_argument("--so-frota", action="store_true", help="atualiza só veículos (e calendário)")
    ap.add_argument("--tarifas", action="store_true", help="varre as tarifas atuais por id (centenas de chamadas)")
    a = ap.parse_args()
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB))
    con.execute(DDL)
    hq = HQ()
    calendario(con)
    if a.snapshot:
        snapshot(con, hq)
        print(f"Snapshot concluído. Chamadas GET: {hq.chamadas}")
        raise SystemExit(0)
    print("Frota...", flush=True)
    frota(con, hq)
    if a.so_frota:
        bloqueios(con, hq)
        print("Frota e bloqueios atualizados.")
        raise SystemExit(0)
    print("Bloqueios...", flush=True)
    bloqueios(con, hq)
    print("Categorias e temporadas...", flush=True)
    categorias_tarifas(con, hq, a.tarifas)
    print("Reservas...", flush=True)
    reservas(con, hq, date.fromisoformat(a.inicio), date.fromisoformat(a.fim))
    print(f"Concluído. Chamadas GET: {hq.chamadas}")
