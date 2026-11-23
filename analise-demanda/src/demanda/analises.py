"""Análises: sazonalidade, market share e curva de pickup."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .base import chegadas_por_destino
from .limpeza import destinos_da_reserva


# ---------------------------------------------------------------- a) sazonalidade

def indice_sazonal(serie: pd.DataFrame, valor: str, anos_excluidos: list[int]) -> pd.DataFrame:
    """Índice por mês do calendário = média, entre anos completos, de (mês ÷ média mensal do ano).

    Só entram anos com os 12 meses e fora de `anos_excluidos`. Devolve mes_cal, indice, n_anos, anos.
    """
    s = serie[["mes", valor]].dropna().copy()
    s["ano"] = s["mes"].dt.year
    s["mes_cal"] = s["mes"].dt.month
    s = s[~s["ano"].isin(anos_excluidos)]
    completos = s.groupby("ano")["mes_cal"].nunique()
    s = s[s["ano"].isin(completos[completos == 12].index)]
    if s.empty:
        return pd.DataFrame(columns=["mes_cal", "indice", "n_anos", "anos"])
    s["rel"] = s[valor].astype(float) / s.groupby("ano")[valor].transform("mean").astype(float)
    out = s.groupby("mes_cal").agg(indice=("rel", "mean"), n_anos=("ano", "nunique"))
    anos = sorted(s["ano"].unique())
    out["anos"] = f"{anos[0]}–{anos[-1]} ({len(anos)} anos)"
    return out.reset_index()


def sazonalidade(nacional: pd.DataFrame, ntto: pd.DataFrame, base: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    exc = cfg["sazonalidade"]["anos_excluidos"]
    desde = cfg["sazonalidade"]["nacional_desde"]
    partes = [indice_sazonal(nacional[nacional["mes"].dt.year >= desde], "eua", exc)
              .assign(escopo="mercado_longo_prazo", destino="EUA")]
    destinos = list(dict.fromkeys(cfg["destinos"]["ativos"] + [cfg["destinos"]["referencia"]]))
    cheg = chegadas_por_destino(ntto, cfg, destinos)
    for d, grp in cheg.groupby("destino"):
        partes.append(indice_sazonal(grp, "chegadas_brasileiros", exc).assign(escopo="mercado", destino=d))
    real = base[base["situacao"].eq("realizado")]
    for d, grp in real.groupby("destino"):
        partes.append(indice_sazonal(grp, "locacoes", exc).assign(escopo="nossas_locacoes", destino=d))
    return pd.concat(partes, ignore_index=True)[["escopo", "destino", "mes_cal", "indice", "n_anos", "anos"]]


def indice_para(saz: pd.DataFrame, destino: str, mes_cal: int) -> tuple[float | None, str]:
    """Índice de mercado do destino; sem ele, o nacional de longo prazo."""
    for escopo, dest in (("mercado", destino), ("mercado_longo_prazo", "EUA")):
        hit = saz[(saz["escopo"] == escopo) & (saz["destino"] == dest) & (saz["mes_cal"] == mes_cal)]
        if len(hit):
            return float(hit["indice"].iloc[0]), f"{escopo}:{dest}"
    return None, ""


# ---------------------------------------------------------------- b) market share

def market_share(base: pd.DataFrame) -> pd.DataFrame:
    """Share mensal com tendência (média móvel 3m) e variação contra o mesmo mês do ano anterior."""
    s = base[base["market_share"].notna()][["mes", "destino", "locacoes", "chegadas_brasileiros",
                                             "market_share", "ntto_aviso"]].copy()
    s = s.sort_values(["destino", "mes"])
    ly = s[["mes", "destino", "market_share"]].assign(mes=s["mes"] + 12).rename(columns={"market_share": "share_ano_anterior"})
    s = s.merge(ly, on=["mes", "destino"], how="left")
    s["var_pp"] = (s["market_share"] - s["share_ano_anterior"]) * 100
    s["var_pct"] = s["market_share"] / s["share_ano_anterior"] - 1
    s["tendencia_3m"] = s.groupby("destino")["market_share"].transform(lambda x: x.rolling(3, min_periods=3).mean())
    s["var_mes_anterior_pp"] = s.groupby("destino")["market_share"].diff() * 100
    return s.reset_index(drop=True)


# ---------------------------------------------------------------- d) pickup

def curva_pickup(reservas: pd.DataFrame, cfg: dict, marcos: list[int], hoje: pd.Timestamp,
                 inicio_confiavel: str | None = None) -> pd.DataFrame:
    """Meses já realizados: % das locações finais que já estavam reservadas a 90/60/30/7 dias da retirada.

    Usa só reservas de demanda casadas com o HQ (usar_pickup). Inclui o mesmo mês do ano anterior.
    """
    ex = destinos_da_reserva(reservas, cfg)
    d = ex[ex["demanda"] & ex["usar_pickup"] & (ex["mes"] < hoje.to_period("M"))]
    if inicio_confiavel:
        d = d[d["mes"] >= pd.Period(inicio_confiavel, freq="M")]
    g = d.groupby(["mes", "destino"])
    out = pd.DataFrame({"locacoes_pickup": g.size()})
    for m in marcos:
        out[f"pct_a_{m}d"] = g["antecedencia_dias"].apply(lambda x, m=m: (x >= m).mean())
    out = out.reset_index()
    ly = out.assign(mes=out["mes"] + 12)[["mes", "destino"] + [f"pct_a_{m}d" for m in marcos]]
    ly = ly.rename(columns={f"pct_a_{m}d": f"pct_a_{m}d_ano_anterior" for m in marcos})
    return out.merge(ly, on=["mes", "destino"], how="left")


def _adr(x: pd.DataFrame) -> float:
    p = x[x["paga"]]
    dias = p["rental_days"].sum()
    return float(p["rack_rate"].sum() / dias) if dias else np.nan


def ritmo(d: pd.DataFrame, hoje: pd.Timestamp, anos_historico: int, meses_a_frente: int,
          grupos: list[str], inicio_confiavel: str | None = None, min_base: int = 0) -> pd.DataFrame:
    """On the books hoje × mesma data nos anos anteriores, por mês de retirada (inclui o mês corrente).

    `d`: reservas de demanda já recortadas (usar_pickup), com as colunas de `grupos` (ex.: destino, categoria).
    otb_hoje / adr_otb: reservas do mês criadas até hoje e o ADR delas (só pagas).
    otb_ano_anterior / adr_ano_anterior_mesma_data: o mesmo, 1 ano antes, até hoje − 1 ano.
    otb_historico: média do on the books nos `anos_historico` anos anteriores com dado.
    Limitação: o status é o atual (sem histórico de status); cancelamentos posteriores não aparecem no passado.
    """
    inicio_dados = d["data_reserva"].min()
    if inicio_confiavel:
        inicio_dados = max(inicio_dados, pd.Period(inicio_confiavel, freq="M").start_time)
    mes0 = hoje.to_period("M")
    base_min = max(min_base, 1)
    linhas = []
    for chave, grp in d.groupby(grupos):
        chave = chave if isinstance(chave, tuple) else (chave,)
        for k in range(meses_a_frente):
            m = mes0 + k
            agora = grp[(grp["mes"] == m) & (grp["data_reserva"] <= hoje)]
            hist, finais, adr_ly = [], [], np.nan
            for a in range(1, anos_historico + 1):
                corte = hoje - pd.DateOffset(years=a)
                mm = m - 12 * a
                # Só compara com anos em que o sistema já registrava reservas antes da janela de venda.
                if corte < inicio_dados or mm.start_time - pd.Timedelta(days=120) < inicio_dados:
                    continue
                sel = grp[grp["mes"] == mm]
                naquela_data = sel[sel["data_reserva"] <= corte]
                hist.append(len(naquela_data))
                finais.append(len(sel))
                if a == 1:
                    adr_ly = _adr(naquela_data)
            otb, otb_ly = len(agora), (hist[0] if hist else np.nan)
            final_ly = finais[0] if finais else np.nan
            otb_hist = float(np.mean(hist)) if hist else np.nan
            ok_ly = bool(hist) and otb_ly >= base_min
            linhas.append({
                **dict(zip(grupos, chave)), "mes": m,
                "dias_ate_inicio": (m.start_time - hoje.normalize()).days,
                "otb_hoje": otb, "otb_ano_anterior": otb_ly, "final_ano_anterior": final_ly,
                "otb_historico": otb_hist, "anos_no_historico": len(hist),
                "razao_vs_ano_anterior": otb / otb_ly if ok_ly else np.nan,
                "razao_vs_historico": otb / otb_hist if hist and otb_hist >= base_min else np.nan,
                # Projeção simples: mantém a fração do final que o ano anterior tinha nesta data.
                "projecao_final": otb / (otb_ly / final_ly) if ok_ly and final_ly else np.nan,
                "adr_otb": _adr(agora),
                "adr_ano_anterior_mesma_data": adr_ly if ok_ly else np.nan,
            })
    out = pd.DataFrame(linhas)
    if len(out):
        out["var_adr_vs_ano_anterior"] = out["adr_otb"] / out["adr_ano_anterior_mesma_data"] - 1
    return out


def ritmo_atual(reservas: pd.DataFrame, cfg: dict, hoje: pd.Timestamp, anos_historico: int,
                meses_a_frente: int = 13, inicio_confiavel: str | None = None, min_base: int = 0) -> pd.DataFrame:
    """Ritmo por destino ativo (ver `ritmo`)."""
    ex = destinos_da_reserva(reservas, cfg)
    d = ex[ex["demanda"] & ex["usar_pickup"]]
    return ritmo(d, hoje, anos_historico, meses_a_frente, ["destino"], inicio_confiavel, min_base)
