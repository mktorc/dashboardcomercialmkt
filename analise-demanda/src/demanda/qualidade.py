"""Relatório de qualidade: lista casos suspeitos sem descartar nada em silêncio (escopo: destinos ativos)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

COLS_CASO = ["reservation_id", "status", "pick_up_at", "car_category", "rental_days", "total_amount",
             "rack_rate", "discount_amount", "additional_charges_price", "miscellaneous_price",
             "data_reserva", "antecedencia_dias", "loja_nome", "hq_status"]

TRATAMENTO = {
    "rack_rate_negativo": "Mantidos e documentados. Todos têm total 0, então já ficam fora do ADR.",
    "extras_negativos": "Mantidos e documentados. Não afetam o ADR (extras ficam fora do rack).",
    "misc_negativo": "Mantidos (informativo; misc = taxa de 6,5% sobre o rack).",
    "total_zero_na_demanda": "Contam em locações; fora de receita, ADR e desconto (locacoes_pagas).",
    "nao_casou_com_hq": "Sem data de reserva: fora da curva de pickup e da antecedência.",
    "criada_apos_retirada": "Fora da curva de pickup e da antecedência (data de reserva inconsistente).",
    "diarias_acima_de_45": "Mantidas (locações longas).",
    "id_duplicado": "—",
    "ntto_meses_sem_arquivo": "Ficam vazios na base, com aviso; não são interpolados.",
    "ntto_preliminares": "Marcados (ntto_aviso = preliminar); o pipeline troca pelo final quando sair.",
    "ntto_resumo_vs_nacional": "Informativo: diferenças vêm de revisões do NTTO entre arquivos.",
}


def no_escopo(reservas: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    return reservas[reservas["regiao"].isin(cfg["destinos"]["ativos"]) & ~reservas["sem_loja"]]


def checagens(reservas: pd.DataFrame, ntto: pd.DataFrame, nacional: pd.DataFrame, cfg: dict) -> dict[str, pd.DataFrame]:
    r = no_escopo(reservas, cfg)
    casos = {
        "rack_rate_negativo": r[r["rack_rate"] < 0],
        "extras_negativos": r[r["additional_charges_price"] < 0],
        "misc_negativo": r[r["miscellaneous_price"] < 0],
        "total_zero_na_demanda": r[r["demanda"] & ~r["paga"]],
        "nao_casou_com_hq": r[~r["hq_casou"]],
        "criada_apos_retirada": r[r["criada_apos_retirada"]],
        "diarias_acima_de_45": r[r["rental_days"] > 45],
        "id_duplicado": r[r["reservation_id"].duplicated(keep=False)],
    }
    out = {k: v[[c for c in COLS_CASO if c in v]] for k, v in casos.items()}
    anos = cfg["coleta"]["ntto_anos_destino"]
    esperados = pd.period_range(f"{min(anos)}-01", ntto["mes"].max(), freq="M")
    faltam = [m for m in esperados if m.year in anos and m not in set(ntto["mes"])]
    out["ntto_meses_sem_arquivo"] = pd.DataFrame({"mes": [str(m) for m in faltam]})
    out["ntto_preliminares"] = ntto[ntto["preliminar"]][["mes", "florida", "orlando", "fonte"]]
    cmp = ntto[["mes", "eua"]].merge(nacional[["mes", "eua"]], on="mes", how="left", suffixes=("_resumo", "_serie_nacional"))
    cmp["diferenca"] = cmp["eua_resumo"] - cmp["eua_serie_nacional"]
    out["ntto_resumo_vs_nacional"] = cmp[cmp["diferenca"].fillna(0) != 0]
    return out


def escopo(reservas: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """De onde vêm e para onde vão as 7.867 reservas no escopo atual."""
    r = reservas
    ativos = cfg["destinos"]["ativos"]
    grupo = pd.Series("outros destinos (desativados)", index=r.index)
    grupo[r["regiao"].isin(ativos)] = "no escopo: " + r["regiao"]
    grupo[r["sem_loja"]] = "fora: sem loja"
    grupo[r["regiao"].isna() & ~r["sem_loja"]] = "fora: loja fora das listas (" + r["loja_nome"].fillna("?") + ")"
    t = pd.crosstab(grupo.rename("grupo"), r["demanda"].map({True: "demanda", False: "fora da demanda"}))
    t["total"] = t.sum(axis=1)
    return t.sort_values("total", ascending=False)


def escrever(checks: dict[str, pd.DataFrame], reservas: pd.DataFrame, pasta: Path, hoje: pd.Timestamp, cfg: dict) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    for k, v in checks.items():
        v.to_csv(pasta / f"qualidade_{k}.csv", index=False)
    r = no_escopo(reservas, cfg)
    dem = r[r["demanda"]]
    ativos = ", ".join(cfg["destinos"]["ativos"])
    md = [f"# Relatório de qualidade — {ativos} — {hoje.date()}", "",
          f"No escopo ({ativos}): **{len(r)}** reservas · demanda: **{len(dem)}** · pagas: **{int(dem['paga'].sum())}** · "
          f"casadas com o HQ: **{int(r['hq_casou'].sum())}**", "",
          "## Escopo", "", escopo(reservas, cfg).to_markdown(), "",
          "## Resumo dos casos (no escopo)", "", "| Checagem | Casos | Tratamento |", "|---|---:|---|"]
    for k, v in checks.items():
        md.append(f"| {k} | {len(v)} | {TRATAMENTO.get(k, '')} |")
    md.append("")
    for k in ("rack_rate_negativo", "extras_negativos", "criada_apos_retirada", "ntto_meses_sem_arquivo"):
        v = checks[k]
        if len(v):
            md += [f"## {k} ({len(v)})", "", v.head(40).to_markdown(index=False),
                   "" if len(v) <= 40 else f"\n… lista completa em qualidade_{k}.csv", ""]
    z = checks["total_zero_na_demanda"]
    if len(z):
        md += [f"## total_zero_na_demanda ({len(z)}) — por categoria e ano", "",
               pd.crosstab(z["car_category"], pd.to_datetime(z["pick_up_at"]).dt.year).to_markdown(),
               "", "Lista completa em qualidade_total_zero_na_demanda.csv", ""]
    status = pd.crosstab(r["status"], r["hq_status"].fillna("(sem HQ)"))
    cobertura = pd.crosstab(dem["mes"].dt.year.rename("ano"), dem["mes"].dt.month.rename("mês"))
    md += ["## Status do banco × status do HQ", "", status.to_markdown(), "",
           "## Cobertura do histórico (locações de demanda por mês de retirada)", "", cobertura.to_markdown(), ""]
    arq = pasta / "qualidade.md"
    arq.write_text("\n".join(md))
    return arq
