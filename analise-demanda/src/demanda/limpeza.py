"""Limpeza e padronização das fontes brutas."""
from __future__ import annotations

import pandas as pd



def mes(s: pd.Series) -> pd.Series:
    return s.dt.to_period("M")


def limpar_ntto(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["mes"] = pd.PeriodIndex(out["mes"], freq="M")
    for c in ("eua", "florida", "orlando", "miami", "fort_lauderdale"):
        out[c] = pd.to_numeric(out[c], errors="coerce").astype("Int64")
    out["preliminar"] = out["preliminar"].astype(str).str.lower().eq("true")
    return out.sort_values("mes").drop_duplicates("mes", keep="last").reset_index(drop=True)


def limpar_nacional(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["mes"] = pd.PeriodIndex(out["mes"], freq="M")
    out["eua"] = pd.to_numeric(out["eua"], errors="coerce").astype("Int64")
    return out.sort_values("mes").reset_index(drop=True)


def destino_da_loja(loja_id, lojas_por_destino: dict[str, list[int]]) -> str | None:
    """Destino pela lista de lojas do config (sem loja ou loja fora das listas → None)."""
    if pd.isna(loja_id):
        return None
    for destino, ids in lojas_por_destino.items():
        if int(loja_id) in ids:
            return destino
    return None


def estado_da_loja(estado, destino) -> str | None:
    e = "" if estado is None or pd.isna(estado) else str(estado).strip().lower()
    if e in ("fl", "florida"):
        return "FL"
    if e:
        return e.upper()
    # Lojas cadastradas sem estado: os destinos de loja que operamos (Orlando, Miami) são na Flórida.
    return "FL" if destino else None


def limpar_reservas(res: pd.DataFrame, hq: pd.DataFrame, lojas: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Uma linha por reserva, com data de reserva do HQ, destino e flags de qualidade."""
    r = res.copy()
    r["reservation_id"] = r["reservation_id"].astype(str)
    # Horários do HQ usados como estão (sem trocar fuso), como no restante do painel.
    for c in ("pick_up_at", "return_at"):
        r[c] = pd.to_datetime(r[c].astype(str).str[:19], errors="coerce")
    for c in ("rental_days", "total_amount", "rack_rate", "discount_amount",
              "additional_charges_price", "miscellaneous_price"):
        r[c] = pd.to_numeric(r[c], errors="coerce")
    r = r.drop(columns=["created_at"])  # é o mesmo created_at do HQ; usa-se o vindo do HQ (data_reserva)

    h = hq.copy()
    h["reservation_id"] = h["reservation_id"].astype(str)
    # created_at do HQ vem em UTC (sufixo Z): converte para o horário de Orlando para ficar na mesma base da retirada.
    h["data_reserva"] = (pd.to_datetime(h["hq_created_at"], utc=True, errors="coerce")
                         .dt.tz_convert("America/New_York").dt.tz_localize(None))
    h = h.drop_duplicates("reservation_id")
    r = r.merge(h[["reservation_id", "data_reserva", "hq_status", "pick_up_location_id",
                   "loja_nome", "loja_estado"]], on="reservation_id", how="left")

    r["hq_casou"] = r["data_reserva"].notna()
    r["regiao"] = [destino_da_loja(i, cfg["destinos"]["lojas"]) for i in r["pick_up_location_id"]]
    r["estado"] = [estado_da_loja(e, g) for e, g in zip(r["loja_estado"], r["regiao"])]
    r["sem_loja"] = r["pick_up_location_id"].isna() & r["loja_nome"].isna()

    r["antecedencia_dias"] = (r["pick_up_at"].dt.normalize() - r["data_reserva"].dt.normalize()).dt.days
    r["criada_apos_retirada"] = r["antecedencia_dias"] < 0
    r["usar_pickup"] = r["hq_casou"] & ~r["criada_apos_retirada"]

    d = cfg["demanda"]
    r["demanda"] = r["status"].isin(d["status_demanda"])
    # Total 0 (cortesias/internas): contam como locação, mas ficam fora de receita e ADR.
    r["paga"] = r["total_amount"] > 0
    r["cancelada"] = r["status"].isin(d["status_cancelados"])
    r["base_cancelamento"] = r["status"].isin(d["status_base_cancelamento"])
    r["mes"] = mes(r["pick_up_at"])
    return r


def destinos_da_reserva(r: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Explode cada reserva nos destinos ativos em que conta.

    EUA: todas (menos sem loja); Flórida: loja na Flórida; Orlando/Miami: lista de lojas do config.
    Reservas sem loja ficam fora de tudo.
    """
    ativos = cfg["destinos"]["ativos"]
    r = r[~r["sem_loja"]]
    partes = []
    for destino in ativos:
        if destino == "EUA":
            partes.append(r.assign(destino="EUA"))
        elif destino == "Florida":
            partes.append(r[r["estado"].eq("FL")].assign(destino="Florida"))
        else:
            partes.append(r[r["regiao"].eq(destino)].assign(destino=destino))
    return pd.concat(partes, ignore_index=True) if partes else r.iloc[0:0].assign(destino=None)
