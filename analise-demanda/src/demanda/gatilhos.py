"""Motor de gatilhos: regras do config.yaml → tabela de alertas."""
from __future__ import annotations

import pandas as pd

from .analises import indice_para

COLUNAS = ["data", "mes_referencia", "destino", "categoria", "sinal", "valor", "limite", "acao", "ativo", "detalhe"]


def _alerta(hoje, mes, destino, sinal, valor, limite, acao, ativo, detalhe, categoria="Todas"):
    return {"data": hoje.date(), "mes_referencia": str(mes), "destino": destino, "categoria": categoria,
            "sinal": sinal, "valor": round(float(valor), 4), "limite": limite, "acao": acao, "ativo": ativo,
            "detalhe": detalhe}


def fechar_entrada(ritmo: pd.DataFrame, saz: pd.DataFrame, regra: dict, hoje: pd.Timestamp) -> list[dict]:
    out = []
    r = ritmo[ritmo["dias_ate_inicio"] < regra["horizonte_meses"] * 31]
    for _, x in r.iterrows():
        idx, fonte = indice_para(saz, x["destino"], x["mes"].month)
        razao = x["razao_vs_ano_anterior"]
        if idx is None or pd.isna(razao):
            continue
        if idx > regra["indice_sazonal_min"] and razao > regra["pickup_vs_ano_anterior_min"]:
            out.append(_alerta(hoje, x["mes"], x["destino"], "Alta temporada + pickup acima do ano anterior",
                               razao, f"índice > {regra['indice_sazonal_min']} e razão > {regra['pickup_vs_ano_anterior_min']}",
                               regra["acao"], True,
                               f"índice sazonal {idx:.2f} ({fonte}); on the books {int(x['otb_hoje'])} vs "
                               f"{int(x['otb_ano_anterior'])} na mesma data do ano anterior"))
    return out


def share_caindo(share: pd.DataFrame, regra: dict, hoje: pd.Timestamp) -> list[dict]:
    """Share em queda por N meses seguidos.

    comparacao "yoy" (padrão): variação contra o mesmo mês do ano anterior < 0 — tira a sazonalidade da conta.
    comparacao "mom": share menor que o do mês anterior.
    Ativo = a sequência termina no último mês com share calculado.
    """
    n = regra["meses_seguidos"]
    col = "var_pp" if regra.get("comparacao", "yoy") == "yoy" else "var_mes_anterior_pp"
    out = []
    for destino, g in share.sort_values("mes").groupby("destino"):
        g = g.dropna(subset=[col]).reset_index(drop=True)
        ultimo = g["mes"].max() if len(g) else None
        seq = 0
        for i, x in g.iterrows():
            seq = seq + 1 if x[col] < 0 else 0
            consecutivo = i == 0 or (x["mes"] - g.loc[i - 1, "mes"]).n == 1
            if not consecutivo:
                seq = 1 if x[col] < 0 else 0
            if seq >= n:
                prelim = f" (NTTO {x['ntto_aviso']})" if x.get("ntto_aviso") else ""
                out.append(_alerta(hoje, x["mes"], destino, f"Share caindo {seq} meses seguidos ({regra.get('comparacao', 'yoy')})",
                                   x[col], f"< 0 por {n} meses", regra["acao"], x["mes"] == ultimo,
                                   f"share {x['market_share']:.2%}; variação {x[col]:+.2f} p.p.{prelim}"))
    return out


def pickup_abaixo(ritmo: pd.DataFrame, regra: dict, hoje: pd.Timestamp) -> list[dict]:
    out = []
    lim = 1 - regra["tolerancia"]
    r = ritmo[ritmo["dias_ate_inicio"] <= regra["dias_ate_retirada"]]
    for _, x in r.iterrows():
        razao = x["razao_vs_historico"]
        if pd.notna(razao) and razao < lim:
            out.append(_alerta(hoje, x["mes"], x["destino"], "Pickup abaixo do histórico", razao, f"< {lim:.2f}",
                               regra["acao"], True,
                               f"on the books {int(x['otb_hoje'])} vs média {x['otb_historico']:.0f} "
                               f"({int(x['anos_no_historico'])} ano(s)) na mesma data"))
    return out


def subir_preco_categoria(pk_cat: pd.DataFrame, regra: dict, hoje: pd.Timestamp) -> list[dict]:
    """Categoria vendendo mais rápido que no ano anterior e com ADR abaixo do ano anterior (mesma data)."""
    out = []
    r = pk_cat[(pk_cat["car_category"] != "Todas") & (pk_cat["dias_ate_inicio"] < regra["horizonte_meses"] * 31)]
    for _, x in r.iterrows():
        razao, adr, adr_ly = x["razao_vs_ano_anterior"], x["adr_otb"], x["adr_ano_anterior_mesma_data"]
        if pd.isna(razao) or pd.isna(adr) or pd.isna(adr_ly):
            continue
        if razao > regra["pickup_vs_ano_anterior_min"] and adr / adr_ly < regra["adr_vs_ano_anterior_max"]:
            out.append(_alerta(hoje, x["mes"], x["destino"], "Pickup acima e ADR abaixo do ano anterior",
                               adr / adr_ly - 1, f"pickup > {regra['pickup_vs_ano_anterior_min']} e ADR < ano anterior",
                               regra["acao"], True,
                               f"on the books {int(x['otb_hoje'])} vs {int(x['otb_ano_anterior'])}; ADR ${adr:.0f} vs "
                               f"${adr_ly:.0f} na mesma data do ano anterior", categoria=x["car_category"]))
    return out


def ultima_hora(adr_ant: pd.DataFrame, regra: dict, hoje: pd.Timestamp, faixa_ultima: str) -> list[dict]:
    """Faixa 0–7 dias com ADR abaixo da média (simples) das outras faixas, nos últimos 12 meses."""
    out = []
    t = adr_ant[adr_ant["janela"] == "ultimos_12_meses"]
    for (destino, cat), g in t.groupby(["destino", "car_category"]):
        ult = g[g["faixa"] == faixa_ultima]
        outras = g[(g["faixa"] != faixa_ultima) & (g["reservas"] >= regra["min_reservas"])]
        if ult.empty or ult["reservas"].iloc[0] < regra["min_reservas"] or outras.empty:
            continue
        adr, media = float(ult["adr"].iloc[0]), float(outras["adr"].mean())
        if adr < media:
            out.append(_alerta(hoje, "últimos 12 meses", destino, "ADR de última hora abaixo das outras faixas",
                               adr / media - 1, "ADR 0–7 < média das outras faixas", regra["acao"], True,
                               f"0–7 dias: ${adr:.0f}/dia vs média ${media:.0f} nas outras faixas", categoria=cat))
    return out


def gerar_alertas(ritmo, saz, share, cfg: dict, hoje: pd.Timestamp, pk_cat: pd.DataFrame | None = None,
                  adr_ant: pd.DataFrame | None = None) -> pd.DataFrame:
    g = cfg["gatilhos"]
    alertas: list[dict] = []
    if g["fechar_entrada"]["ativo"]:
        alertas += fechar_entrada(ritmo, saz, g["fechar_entrada"], hoje)
    if g["share_caindo"]["ativo"]:
        alertas += share_caindo(share, g["share_caindo"], hoje)
    # aereo_yoy: sem dados aéreos; quando houver, entra aqui com a mesma estrutura.
    if g["pickup_abaixo"]["ativo"]:
        alertas += pickup_abaixo(ritmo, g["pickup_abaixo"], hoje)
    if g.get("subir_preco_categoria", {}).get("ativo") and pk_cat is not None and len(pk_cat):
        alertas += subir_preco_categoria(pk_cat, g["subir_preco_categoria"], hoje)
    if g.get("ultima_hora", {}).get("ativo") and adr_ant is not None and len(adr_ant):
        alertas += ultima_hora(adr_ant, g["ultima_hora"], hoje, cfg["preco"]["rotulos_faixas"][0])
    return pd.DataFrame(alertas, columns=COLUNAS)
