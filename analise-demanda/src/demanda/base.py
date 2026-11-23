"""Base unificada mês × destino (destinos ativos do config)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .limpeza import destinos_da_reserva


def chegadas_por_destino(ntto: pd.DataFrame, cfg: dict, destinos: list[str] | None = None) -> pd.DataFrame:
    """Chegadas de brasileiros por mês e destino, somando as séries configuradas de cada destino.

    Meses ausentes no NTTO não são interpolados: ficam sem linha (e a base marca o aviso).
    """
    series = cfg["destinos"]["series"]
    linhas = []
    for destino in destinos or list(series):
        cols = series[destino]
        soma = ntto[cols].astype("float").sum(axis=1, min_count=len(cols))  # faltou uma série → vazio
        linhas.append(pd.DataFrame({"mes": ntto["mes"], "destino": destino,
                                    "chegadas_brasileiros": soma, "ntto_preliminar": ntto["preliminar"]}))
    return pd.concat(linhas, ignore_index=True)


def agregar_locacoes(dem: pd.DataFrame, chaves: list[str]) -> pd.DataFrame:
    """Métricas de locação de um recorte de demanda. ADR = rack (locação já com desconto, sem taxas e extras)
    ÷ diárias, só nas locações pagas (total > 0)."""
    g = dem.groupby(chaves)
    pagas = dem[dem["paga"]].groupby(chaves)
    out = pd.DataFrame({"locacoes": g.size(), "diarias": g["rental_days"].sum()})
    out["locacoes_pagas"] = pagas.size()
    out["diarias_pagas"] = pagas["rental_days"].sum()
    out["receita_locacao"] = pagas["rack_rate"].sum()
    out["receita_total"] = pagas["total_amount"].sum()
    out["descontos"] = pagas["discount_amount"].sum()
    out[["locacoes_pagas", "diarias_pagas", "receita_locacao", "receita_total", "descontos"]] = (
        out[["locacoes_pagas", "diarias_pagas", "receita_locacao", "receita_total", "descontos"]].fillna(0))
    out["adr"] = out["receita_locacao"] / out["diarias_pagas"].replace(0, np.nan)
    out["desconto_pct"] = out["descontos"] / (out["receita_locacao"] + out["descontos"]).replace(0, np.nan)
    return out


def montar_base(reservas: pd.DataFrame, ntto: pd.DataFrame, cfg: dict, hoje: pd.Timestamp) -> pd.DataFrame:
    """Granularidade mês de retirada × destino ativo.

    - locacoes/diarias: toda a demanda; receita, ADR e desconto: só locações pagas.
    - Meses a partir do mês de corte são "on_the_books" e não entram no market share.
    - antecedencia_media: só reservas casadas com o HQ e não criadas depois da retirada.
    - chegadas_referencia: chegadas do destino de referência (Flórida), só contexto.
    """
    ativos = cfg["destinos"]["ativos"]
    ex = destinos_da_reserva(reservas, cfg)
    dem = ex[ex["demanda"]]
    agg = agregar_locacoes(dem, ["mes", "destino"])
    pk = dem[dem["usar_pickup"]].groupby(["mes", "destino"])["antecedencia_dias"]
    agg["antecedencia_media"] = pk.mean()
    agg["antecedencia_mediana"] = pk.median()
    canc = ex[ex["base_cancelamento"]].groupby(["mes", "destino"])
    agg["cancelamentos"] = canc["cancelada"].sum()
    agg["base_cancelamento"] = canc.size()
    agg = agg.reset_index()

    cheg = chegadas_por_destino(ntto, cfg, ativos)
    # Grade completa de meses: mês sem arquivo do NTTO aparece vazio, com aviso, em vez de sumir.
    meses = pd.period_range(min(ntto["mes"].min(), agg["mes"].min()), max(ntto["mes"].max(), agg["mes"].max()), freq="M")
    grade = pd.MultiIndex.from_product([meses, ativos], names=["mes", "destino"]).to_frame(index=False)
    base = grade.merge(cheg, on=["mes", "destino"], how="left").merge(agg, on=["mes", "destino"], how="left")
    ref = chegadas_por_destino(ntto, cfg, [cfg["destinos"]["referencia"]])[["mes", "chegadas_brasileiros"]]
    base = base.merge(ref.rename(columns={"chegadas_brasileiros": "chegadas_referencia"}), on="mes", how="left")

    inicio_interno = reservas.loc[reservas["demanda"], "mes"].min()
    confiavel = pd.Period(cfg["demanda"]["inicio_historico_confiavel"], freq="M")
    mes_corte = hoje.to_period("M")
    tem_interno = base["mes"] >= inicio_interno
    contagens = ["locacoes", "diarias", "locacoes_pagas", "diarias_pagas", "receita_locacao", "receita_total",
                 "descontos", "cancelamentos", "base_cancelamento"]
    for c in contagens:
        base[c] = base[c].fillna(0).where(tem_interno)
    base["situacao"] = np.select(
        [~tem_interno, base["mes"] < confiavel, base["mes"] < mes_corte],
        ["sem_dado_interno", "implantacao", "realizado"], "on_the_books")
    base["taxa_cancelamento"] = base["cancelamentos"] / base["base_cancelamento"].replace(0, np.nan)
    base["reservas_aereas_futuras"] = np.nan  # sem fonte aérea (ForwardKeys/OAG) por enquanto
    realizado = base["situacao"].eq("realizado")
    base["market_share"] = (base["locacoes"] / base["chegadas_brasileiros"]).where(realizado)
    publicado = base["mes"] <= ntto["mes"].max()
    base["ntto_aviso"] = np.select(
        [base["chegadas_brasileiros"].isna() & ~base["mes"].dt.year.isin(cfg["coleta"]["ntto_anos_destino"]),
         base["chegadas_brasileiros"].isna() & publicado, base["chegadas_brasileiros"].isna(),
         base["ntto_preliminar"].astype("boolean").fillna(False).astype(bool)],
        ["ano fora da coleta", "sem arquivo do NTTO (não interpolado)", "ainda não publicado", "preliminar"], "")
    base = base.drop(columns=["ntto_preliminar"])

    cols = ["mes", "destino", "situacao", "chegadas_brasileiros", "ntto_aviso", "chegadas_referencia",
            "reservas_aereas_futuras", "locacoes", "locacoes_pagas", "diarias", "diarias_pagas",
            "receita_locacao", "receita_total", "adr", "descontos", "desconto_pct",
            "antecedencia_media", "antecedencia_mediana", "market_share",
            "cancelamentos", "base_cancelamento", "taxa_cancelamento"]
    return base[cols].sort_values(["destino", "mes"]).reset_index(drop=True)
