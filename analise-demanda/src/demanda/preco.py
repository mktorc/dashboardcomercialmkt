"""Análises de preço por destino ativo (hoje: Orlando).

ADR = rack (valor da locação já com desconto, sem taxas e extras) ÷ diárias, só em locações pagas (total > 0).
Desconto = discount_amount ÷ (rack + discount_amount), ou seja, sobre o preço cheio.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .analises import indice_sazonal, ritmo
from .base import agregar_locacoes
from .limpeza import destinos_da_reserva

TODAS = "Todas"


def demanda_destinos(reservas: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    ex = destinos_da_reserva(reservas, cfg)
    return ex[ex["demanda"]]


def _com_todas(d: pd.DataFrame) -> pd.DataFrame:
    """Duplica as linhas com categoria = "Todas" para ter o total ao lado das categorias."""
    return pd.concat([d, d.assign(car_category=TODAS)], ignore_index=True)


def situacao(mes: pd.Series, hoje: pd.Timestamp, inicio_confiavel: str) -> pd.Series:
    corte, conf = hoje.to_period("M"), pd.Period(inicio_confiavel, freq="M")
    return pd.Series(np.select([mes < conf, mes < corte], ["implantacao", "realizado"], "on_the_books"), index=mes.index)


# ---------------------------------------------------------------- 1) ADR por mês e categoria (+ 4) desconto)

def adr_categoria(dem: pd.DataFrame, hoje: pd.Timestamp, inicio_confiavel: str) -> pd.DataFrame:
    """Mês × categoria: ADR, desconto e volumes, com o mesmo mês do ano anterior.

    Realizado: compara com o ano anterior fechado. On the books: compara também com o ano anterior
    na mesma data (reservas do mês de 1 ano antes criadas até hoje − 1 ano), que é a comparação justa.
    """
    d = _com_todas(dem)
    chaves = ["destino", "car_category", "mes"]
    atual = agregar_locacoes(d, chaves).reset_index()
    ly = atual[chaves + ["adr", "locacoes", "desconto_pct"]].copy()
    ly["mes"] = ly["mes"] + 12
    ly = ly.rename(columns={"adr": "adr_ano_anterior", "locacoes": "locacoes_ano_anterior",
                            "desconto_pct": "desconto_pct_ano_anterior"})
    out = atual.merge(ly, on=chaves, how="left")

    corte_ly = hoje - pd.DateOffset(years=1)
    ly_data = agregar_locacoes(d[d["data_reserva"] <= corte_ly], chaves).reset_index()
    ly_data = ly_data[chaves + ["adr", "locacoes"]].assign(mes=ly_data["mes"] + 12).rename(
        columns={"adr": "adr_ano_anterior_mesma_data", "locacoes": "locacoes_ano_anterior_mesma_data"})
    out = out.merge(ly_data, on=chaves, how="left")

    out["situacao"] = situacao(out["mes"], hoje, inicio_confiavel)
    otb = out["situacao"].eq("on_the_books")
    out.loc[~otb, ["adr_ano_anterior_mesma_data", "locacoes_ano_anterior_mesma_data"]] = np.nan
    out["adr_referencia"] = out["adr_ano_anterior_mesma_data"].where(otb, out["adr_ano_anterior"])
    out["var_adr_pct"] = out["adr"] / out["adr_referencia"] - 1
    out["var_desconto_pp"] = (out["desconto_pct"] - out["desconto_pct_ano_anterior"]) * 100
    out = out[out["situacao"] != "implantacao"]
    return out.sort_values(chaves).reset_index(drop=True)


# ---------------------------------------------------------------- 2) ADR × índice sazonal

def adr_vs_sazonal(adr_cat: pd.DataFrame, saz: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Por mês do calendário: índice de demanda (mercado e nossas locações) × índice de ADR.

    índice_adr = ADR do mês ÷ média dos ADRs mensais do ano (anos completos realizados).
    captura = (índice_adr − 1) ÷ (índice_demanda − 1): quanto do pico de demanda vira preço
    (1 = o preço sobe na mesma proporção da demanda; < 1 = sobe menos).
    """
    exc = cfg["sazonalidade"]["anos_excluidos"]
    pico = cfg["preco"]["indice_pico"]
    linhas = []
    for destino, g in adr_cat[(adr_cat["car_category"] == TODAS) & (adr_cat["situacao"] == "realizado")].groupby("destino"):
        idx_adr = indice_sazonal(g, "adr", exc).rename(columns={"indice": "indice_adr", "n_anos": "anos_adr"})
        mk = saz[(saz["escopo"] == "mercado") & (saz["destino"] == destino)][["mes_cal", "indice"]]
        nos = saz[(saz["escopo"] == "nossas_locacoes") & (saz["destino"] == destino)][["mes_cal", "indice"]]
        t = (idx_adr[["mes_cal", "indice_adr", "anos_adr"]]
             .merge(mk.rename(columns={"indice": "indice_demanda_mercado"}), on="mes_cal", how="left")
             .merge(nos.rename(columns={"indice": "indice_nossas_locacoes"}), on="mes_cal", how="left"))
        t["destino"] = destino
        t["captura"] = ((t["indice_adr"] - 1) / (t["indice_demanda_mercado"] - 1)).where(
            (t["indice_demanda_mercado"] - 1).abs() >= 0.05)
        t["leitura_mercado"] = _leitura(t["indice_demanda_mercado"], t["indice_adr"], pico)
        t["leitura_nossa_demanda"] = _leitura(t["indice_nossas_locacoes"], t["indice_adr"], pico)
        linhas.append(t)
    return pd.concat(linhas, ignore_index=True) if linhas else pd.DataFrame()


def _leitura(dem: pd.Series, adr: pd.Series, pico: float) -> pd.Series:
    """Pico (demanda > pico) com preço subindo menos que a demanda = possível dinheiro na mesa."""
    return pd.Series(np.select(
        [(dem > pico) & (adr < dem - 0.05), dem > pico, (dem < 2 - pico) & (adr > dem + 0.05)],
        ["pico: preço sobe menos que a demanda (possível dinheiro na mesa)",
         "pico: preço acompanha a demanda",
         "vale: preço cai menos que a demanda"], ""), index=dem.index)


# ---------------------------------------------------------------- 3) ADR por antecedência

def faixa_antecedencia(dias: pd.Series, cfg: dict) -> pd.Series:
    faixas, rotulos = cfg["preco"]["faixas_antecedencia"], cfg["preco"]["rotulos_faixas"]
    out = pd.Series(pd.NA, index=dias.index, dtype="object")
    for (lo, hi), r in zip(faixas, rotulos):
        out[(dias >= lo) & (dias <= hi)] = r
    return out


def adr_antecedencia(dem: pd.DataFrame, cfg: dict, hoje: pd.Timestamp, inicio_confiavel: str) -> pd.DataFrame:
    """ADR por faixa de antecedência e categoria, nos últimos 12 meses realizados e no histórico todo.

    Só locações pagas casadas com o HQ. premio_vs_ultima_hora = ADR da faixa ÷ ADR da faixa 0–7 − 1.
    """
    corte = hoje.to_period("M")
    d = dem[dem["usar_pickup"] & dem["paga"] & (dem["mes"] < corte)
            & (dem["mes"] >= pd.Period(inicio_confiavel, freq="M"))].copy()
    d["faixa"] = faixa_antecedencia(d["antecedencia_dias"], cfg)
    d = _com_todas(d)
    janelas = {"ultimos_12_meses": d[d["mes"] >= corte - 12], "historico": d}
    partes = []
    for nome, x in janelas.items():
        g = x.groupby(["destino", "car_category", "faixa"])
        t = pd.DataFrame({"reservas": g.size(), "diarias": g["rental_days"].sum(), "receita_locacao": g["rack_rate"].sum(),
                          "descontos": g["discount_amount"].sum()}).reset_index()
        t["adr"] = t["receita_locacao"] / t["diarias"]
        t["desconto_pct"] = t["descontos"] / (t["receita_locacao"] + t["descontos"])
        t["janela"] = nome
        partes.append(t)
    out = pd.concat(partes, ignore_index=True)
    ref = out[out["faixa"] == cfg["preco"]["rotulos_faixas"][0]][["janela", "destino", "car_category", "adr"]]
    out = out.merge(ref.rename(columns={"adr": "adr_ultima_hora"}), on=["janela", "destino", "car_category"], how="left")
    out["premio_vs_ultima_hora"] = out["adr"] / out["adr_ultima_hora"] - 1
    ordem = {r: i for i, r in enumerate(cfg["preco"]["rotulos_faixas"])}
    return out.sort_values(["janela", "destino", "car_category", "faixa"],
                           key=lambda s: s.map(ordem) if s.name == "faixa" else s).reset_index(drop=True)


# ---------------------------------------------------------------- 5) pickup por categoria

def pickup_categoria(dem: pd.DataFrame, cfg: dict, hoje: pd.Timestamp, inicio_confiavel: str) -> pd.DataFrame:
    """On the books por mês de retirada (próximos N meses) × categoria vs mesma data do ano anterior, com ADR."""
    d = _com_todas(dem[dem["usar_pickup"]])
    return ritmo(d, hoje, cfg["pickup"]["anos_historico"], cfg["preco"]["horizonte_pickup_meses"],
                 ["destino", "car_category"], inicio_confiavel, cfg["pickup"]["min_reservas_base"])
