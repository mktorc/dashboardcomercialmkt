"""Pipeline completo: coleta → (gravação no banco) → limpeza → base unificada → análises → gatilhos → qualidade.

Uso:
  .venv/bin/python -I main.py                 # coleta tudo e processa
  .venv/bin/python -I main.py --sem-coleta    # reprocessa com o que já está em data/raw
  .venv/bin/python -I main.py --hoje 2026-11-23
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ / "src"))

import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from demanda import analises, base, coleta, gatilhos, limpeza, preco, qualidade  # noqa: E402

RAW, PROC, REL = RAIZ / "data/raw", RAIZ / "data/processed", RAIZ / "relatorios"


def salvar(df: pd.DataFrame, nome: str) -> None:
    PROC.mkdir(parents=True, exist_ok=True)
    out = df.copy()
    for c in out.columns:
        if isinstance(out[c].dtype, pd.PeriodDtype):
            out[c] = out[c].astype(str)
    out.to_parquet(PROC / f"{nome}.parquet", index=False)
    out.to_csv(PROC / f"{nome}.csv", index=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-coleta", action="store_true")
    ap.add_argument("--hoje", help="data de corte (AAAA-MM-DD); padrão: hoje")
    ap.add_argument("--sem-banco", action="store_true",
                    help="não grava no Supabase (ntto_chegadas e loja das reservas)")
    a = ap.parse_args()
    cfg = yaml.safe_load((RAIZ / "config.yaml").read_text())
    hoje = pd.Timestamp(a.hoje) if a.hoje else pd.Timestamp.today().normalize()

    if not a.sem_coleta:
        coleta.carregar_env((RAIZ / cfg["coleta"]["env_file"]).resolve())
        print("Coletando NTTO…"); ntto_df = coleta.coletar_ntto(RAW, cfg["coleta"]["ntto_anos_destino"])
        coleta.coletar_ntto_nacional(RAW)
        # Grava o NTTO antes do resto: se reservas/HQ falharem, a aba já tem o mês novo.
        if not a.sem_banco:
            print(f"ntto_chegadas: {coleta.gravar_ntto_banco(ntto_df)} meses gravados")
        print("Coletando reservas (Supabase)…"); coleta.coletar_interno(RAW)
        print("Coletando datas de criação e lojas (HQ, só GET)…"); coleta.coletar_hq(RAW)
        if not a.sem_banco:
            print(f"Loja das reservas preenchida (onde vazia): {coleta.preencher_lojas(pd.read_csv(RAW / 'interno/hq_reservas.csv'))}")

    ntto = limpeza.limpar_ntto(pd.read_csv(RAW / "ntto/ntto_destinos.csv"))
    nacional = limpeza.limpar_nacional(pd.read_csv(RAW / "ntto/ntto_nacional.csv"))
    reservas = limpeza.limpar_reservas(pd.read_csv(RAW / "interno/reservas.csv"),
                                       pd.read_csv(RAW / "interno/hq_reservas.csv"),
                                       pd.read_csv(RAW / "interno/lojas.csv"), cfg)

    b = base.montar_base(reservas, ntto, cfg, hoje)
    saz = analises.sazonalidade(nacional, ntto, b, cfg)
    share = analises.market_share(b)
    ini = cfg["demanda"]["inicio_historico_confiavel"]
    curva = analises.curva_pickup(reservas, cfg, cfg["pickup"]["marcos_dias"], hoje, ini)
    ritmo = analises.ritmo_atual(reservas, cfg, hoje, cfg["pickup"]["anos_historico"], inicio_confiavel=ini,
                                 min_base=cfg["pickup"]["min_reservas_base"])

    dem = preco.demanda_destinos(reservas, cfg)
    adr_cat = preco.adr_categoria(dem, hoje, ini)
    adr_saz = preco.adr_vs_sazonal(adr_cat, saz, cfg)
    adr_ant = preco.adr_antecedencia(dem, cfg, hoje, ini)
    pk_cat = preco.pickup_categoria(dem, cfg, hoje, ini)
    alertas = gatilhos.gerar_alertas(ritmo, saz, share, cfg, hoje, pk_cat, adr_ant)

    for df, nome in ((b, "base_unificada"), (saz, "sazonalidade"), (share, "market_share"),
                     (curva, "pickup_curva"), (ritmo, "pickup_ritmo_atual"), (alertas, "alertas"),
                     (adr_cat, "preco_adr_categoria"), (adr_saz, "preco_adr_vs_sazonal"),
                     (adr_ant, "preco_adr_antecedencia"), (pk_cat, "preco_pickup_categoria"),
                     (reservas.drop(columns=["loja_estado"]), "reservas_limpas")):
        salvar(df, nome)
    rel = qualidade.escrever(qualidade.checagens(reservas, ntto, nacional, cfg), reservas, REL, hoje, cfg)
    print(f"Base: {len(b)} linhas · alertas: {len(alertas)} ({int(alertas['ativo'].sum())} ativos) · qualidade: {rel}")


if __name__ == "__main__":
    main()
