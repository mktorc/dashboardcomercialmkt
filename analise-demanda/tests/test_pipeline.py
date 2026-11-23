import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

import copy  # noqa: E402

from demanda import analises, base, coleta, gatilhos, limpeza, preco  # noqa: E402

CFG = yaml.safe_load((RAIZ / "config.yaml").read_text())
# Variante com todos os destinos ligados (código de Miami/EUA continua testado, mesmo desativado).
CFG_TODOS = copy.deepcopy(CFG)
CFG_TODOS["destinos"]["ativos"] = ["Florida", "Orlando", "Miami", "EUA"]
LOJAS = pd.DataFrame({"id": [1, 2, 3], "name": ["MCO", "MIA", "FLL"], "region": ["Orlando", "Miami", "Miami"]})


def reservas(linhas):
    """linhas: (id, status, retirada, criada_utc, loja_id, total, dias)."""
    res = pd.DataFrame([{
        "reservation_id": i, "created_at": "2023-07-01", "pick_up_at": p, "return_at": p, "status": s,
        "car_category": "Midsize Suv", "rental_days": d, "total_amount": t, "rack_rate": t, "discount_amount": 0,
        "additional_charges_price": 0, "miscellaneous_price": 0} for i, s, p, c, l, t, d in linhas])
    hq = pd.DataFrame([{"reservation_id": i, "hq_created_at": c, "hq_status": "completed", "hq_pick_up_at": p,
                        "pick_up_location_id": l, "loja_nome": None, "loja_estado": None, "loja_cidade": None}
                       for i, s, p, c, l, t, d in linhas if c is not None])
    return limpeza.limpar_reservas(res, hq, LOJAS, CFG)


def test_mes_do_arquivo_reconhece_padroes_do_ntto():
    assert coleta.mes_do_arquivo("sites/default/files/2023-06/2017_July_Summary_Analysis_I94.xlsx") == (2017, 7, False)
    assert coleta.mes_do_arquivo("x/Preliminary_SummaryAnalysis_COR_October_2026.xlsx") == (2026, 10, True)
    assert coleta.mes_do_arquivo("x/FINAL_SummaryAnalysis_COR_November_2022_0.xlsx") == (2022, 11, False)
    assert coleta.mes_do_arquivo("x/SA_ADIS_COR_Nov_2021.xlsx") == (2021, 11, False)
    assert coleta.mes_do_arquivo("x/Inbound-Market-Profile-Air.xlsx") is None


def test_destino_e_flags_da_reserva():
    r = reservas([
        ("1", "confirmed", "2025-03-10 10:00:00", "2025-02-01T15:00:00Z", 1, 500, 5),   # Orlando
        ("2", "cancelled-paid", "2025-03-12 10:00:00", "2025-03-01T15:00:00Z", 3, 300, 3),  # FLL → Miami
        ("3", "cancelled", "2025-03-15 10:00:00", "2025-03-01T15:00:00Z", 1, 0, 2),
        ("4", "confirmed", "2025-03-20 10:00:00", None, None, 100, 1),                  # sem HQ, sem loja
        ("5", "confirmed", "2025-03-05 10:00:00", "2025-03-07T15:00:00Z", 2, 100, 1),   # criada depois
    ]).set_index("reservation_id")
    assert r.loc["1", "regiao"] == "Orlando" and r.loc["2", "regiao"] == "Miami"
    assert r.loc["1", "antecedencia_dias"] == 37
    assert list(r["demanda"]) == [True, True, False, True, True]
    assert not r.loc["4", "hq_casou"] and not r.loc["4", "usar_pickup"] and pd.isna(r.loc["4", "estado"])
    assert r.loc["5", "criada_apos_retirada"] and not r.loc["5", "usar_pickup"]
    ex = limpeza.destinos_da_reserva(r.reset_index(), CFG_TODOS)
    assert "4" not in set(ex.reservation_id)  # sem loja: fora de tudo
    assert set(ex[ex.reservation_id == "2"].destino) == {"EUA", "Florida", "Miami"}
    so_orlando = limpeza.destinos_da_reserva(r.reset_index(), CFG)
    assert set(so_orlando.destino) == {"Orlando"} and set(so_orlando.reservation_id) == {"1", "3"}


def test_base_unificada_share_e_cancelamento():
    r = reservas([
        ("1", "confirmed", "2025-03-10 10:00:00", "2025-02-01T15:00:00Z", 1, 500, 5),
        ("2", "cancelled-paid", "2025-03-12 10:00:00", "2025-03-01T15:00:00Z", 1, 300, 3),
        ("3", "cancelled", "2025-03-15 10:00:00", "2025-03-01T15:00:00Z", 1, 0, 2),
        ("4", "pending", "2025-03-15 10:00:00", "2025-03-01T15:00:00Z", 1, 0, 2),
        ("5", "confirmed", "2025-03-18 10:00:00", "2025-03-01T15:00:00Z", 1, 0, 4),   # cortesia: total 0
        ("6", "confirmed", "2025-03-18 10:00:00", "2025-03-01T15:00:00Z", 2, 100, 1),  # Miami
    ])
    ntto = limpeza.limpar_ntto(pd.DataFrame([{"mes": "2025-03", "eua": 1000, "florida": 400, "orlando": 200,
                                              "miami": 100, "fort_lauderdale": 20, "preliminar": False}]))
    b = base.montar_base(r, ntto, CFG, pd.Timestamp("2025-06-01")).set_index(["destino", "mes"])
    assert set(b.index.get_level_values("destino")) == {"Orlando"}
    o = b.loc[("Orlando", pd.Period("2025-03", "M"))]
    assert o["locacoes"] == 3 and o["locacoes_pagas"] == 2 and o["diarias"] == 12 and o["diarias_pagas"] == 8
    assert o["receita_locacao"] == 800 and o["adr"] == 100  # cortesia fora do ADR
    assert o["chegadas_referencia"] == 400  # Flórida só como contexto
    assert o["market_share"] == pytest.approx(3 / 200)
    assert o["taxa_cancelamento"] == pytest.approx(2 / 4)  # cancelled + cancelled-paid ÷ (sem pending)
    bt = base.montar_base(r, ntto, CFG_TODOS, pd.Timestamp("2025-06-01")).set_index(["destino", "mes"])
    assert bt.loc[("Miami", pd.Period("2025-03", "M")), "chegadas_brasileiros"] == 120  # MIA + FLL


def test_mes_sem_arquivo_do_ntto_fica_vazio_com_aviso():
    r = reservas([("1", "confirmed", "2025-03-10 10:00:00", "2025-02-01T15:00:00Z", 1, 500, 5)])
    ntto = limpeza.limpar_ntto(pd.DataFrame([
        {"mes": m, "eua": 1000, "florida": 400, "orlando": 200, "miami": 100, "fort_lauderdale": 20, "preliminar": False}
        for m in ("2025-01", "2025-02", "2025-04")]))
    b = base.montar_base(r, ntto, CFG, pd.Timestamp("2025-06-01")).set_index("mes")
    mar = b.loc[pd.Period("2025-03", "M")]
    assert pd.isna(mar["chegadas_brasileiros"]) and "não interpolado" in mar["ntto_aviso"]


def test_on_the_books_nao_entra_no_share():
    r = reservas([("1", "confirmed", "2025-07-10 10:00:00", "2025-02-01T15:00:00Z", 1, 500, 5)])
    ntto = limpeza.limpar_ntto(pd.DataFrame([{"mes": "2025-07", "eua": 1000, "florida": 400, "orlando": 200,
                                              "miami": 100, "fort_lauderdale": 20, "preliminar": True}]))
    b = base.montar_base(r, ntto, CFG, pd.Timestamp("2025-07-05"))
    linha = b[(b.destino == "Orlando") & (b.mes == pd.Period("2025-07", "M"))].iloc[0]
    assert linha["situacao"] == "on_the_books" and pd.isna(linha["market_share"])


def test_indice_sazonal_ignora_anos_excluidos_e_incompletos():
    meses = pd.period_range("2019-01", "2021-12", freq="M")
    serie = pd.DataFrame({"mes": meses, "v": [200 if m.month == 12 else 100 for m in meses]})
    serie.loc[serie.mes.dt.year == 2020, "v"] = 1  # ano excluído não pode pesar
    idx = analises.indice_sazonal(serie, "v", [2020, 2021]).set_index("mes_cal")
    assert idx.loc[12, "indice"] == pytest.approx(200 / (1300 / 12))
    assert idx.loc[12, "n_anos"] == 1
    parcial = serie[serie.mes < pd.Period("2019-07", "M")]
    assert analises.indice_sazonal(parcial, "v", []).empty


def test_ritmo_atual_compara_mesma_data_do_ano_anterior():
    # Reserva antiga: marca que o sistema já registrava vendas antes da janela de jan/2025.
    linhas = [("z", "confirmed", "2024-07-10 10:00:00", "2024-06-01T12:00:00Z", 1, 100, 3)]
    for i in range(12):  # ano anterior: 12 reservas para jan/2025, 6 criadas até 01/11/2024
        criada = "2024-10-01T12:00:00Z" if i < 6 else "2024-12-20T12:00:00Z"
        linhas.append((f"a{i}", "confirmed", "2025-01-15 10:00:00", criada, 1, 100, 3))
    for i in range(9):   # este ano: 9 já criadas para jan/2026
        linhas.append((f"b{i}", "confirmed", "2026-01-15 10:00:00", "2025-10-01T12:00:00Z", 1, 100, 3))
    r = reservas(linhas)
    rit = analises.ritmo_atual(r, CFG, pd.Timestamp("2025-11-01"), anos_historico=1, min_base=5)
    jan = rit[(rit.destino == "Orlando") & (rit.mes == pd.Period("2026-01", "M"))].iloc[0]
    assert jan["otb_hoje"] == 9 and jan["otb_ano_anterior"] == 6 and jan["final_ano_anterior"] == 12
    assert jan["razao_vs_ano_anterior"] == pytest.approx(1.5)
    assert jan["projecao_final"] == pytest.approx(18)
    rit2 = analises.ritmo_atual(r, CFG, pd.Timestamp("2025-11-01"), anos_historico=1, min_base=10)
    assert pd.isna(rit2[(rit2.destino == "Orlando") & (rit2.mes == pd.Period("2026-01", "M"))].iloc[0]["razao_vs_ano_anterior"])


def test_gatilhos():
    hoje = pd.Timestamp("2025-11-20")
    ritmo = pd.DataFrame([
        {"mes": pd.Period("2025-12", "M"), "destino": "Orlando", "dias_ate_inicio": 11, "otb_hoje": 120,
         "otb_ano_anterior": 100, "otb_historico": 140, "anos_no_historico": 2,
         "razao_vs_ano_anterior": 1.2, "razao_vs_historico": 120 / 140},
        {"mes": pd.Period("2026-03", "M"), "destino": "Orlando", "dias_ate_inicio": 101, "otb_hoje": 50,
         "otb_ano_anterior": 40, "otb_historico": 40, "anos_no_historico": 2,
         "razao_vs_ano_anterior": 1.25, "razao_vs_historico": 1.25},
    ])
    saz = pd.DataFrame([{"escopo": "mercado", "destino": "Orlando", "mes_cal": 12, "indice": 1.5},
                        {"escopo": "mercado", "destino": "Orlando", "mes_cal": 3, "indice": 0.8}])
    share = pd.DataFrame({"mes": pd.period_range("2025-06", "2025-10", freq="M"), "destino": "Orlando",
                          "market_share": [.003] * 5, "ntto_aviso": "",
                          "var_pp": [0.1, -0.1, 0.2, -0.05, -0.02], "var_mes_anterior_pp": [0, 0, 0, 0, 0]})
    a = gatilhos.gerar_alertas(ritmo, saz, share, CFG, hoje)
    acoes = set(zip(a.mes_referencia, a.acao))
    assert ("2025-12", "Fechar categoria de entrada") in acoes          # índice 1.5 e à frente do ano anterior
    assert ("2026-03", "Fechar categoria de entrada") not in acoes      # baixa temporada
    assert ("2025-12", "Abrir categorias / promoção") in acoes          # 0.857 < 0.90, começa em 11 dias
    caindo = a[a.acao == "Revisar preço / testar redução"]
    assert list(caindo.mes_referencia) == ["2025-10"] and caindo.ativo.all()


def test_adr_por_antecedencia_e_categoria():
    cfg = copy.deepcopy(CFG)
    r = reservas([
        ("1", "confirmed", "2025-03-10 10:00:00", "2025-03-08T15:00:00Z", 1, 400, 4),   # 2 dias → 0–7, ADR 100
        ("2", "confirmed", "2025-03-10 10:00:00", "2024-12-01T15:00:00Z", 1, 480, 4),   # 99 dias → 90+, ADR 120
        ("3", "confirmed", "2025-03-10 10:00:00", "2025-02-20T15:00:00Z", 1, 0, 4),     # cortesia: fora
    ])
    dem = preco.demanda_destinos(r, cfg)
    t = preco.adr_antecedencia(dem, cfg, pd.Timestamp("2025-06-01"), "2023-08")
    t = t[(t.janela == "historico") & (t.car_category == "Todas")].set_index("faixa")
    assert t.loc["0–7", "adr"] == 100 and t.loc["90+", "adr"] == 120
    assert t.loc["90+", "premio_vs_ultima_hora"] == pytest.approx(0.2)
    assert t["reservas"].sum() == 2


def test_adr_categoria_compara_com_ano_anterior():
    r = reservas([
        ("a", "confirmed", "2024-03-10 10:00:00", "2024-02-01T15:00:00Z", 1, 400, 4),   # ADR 100
        ("b", "confirmed", "2025-03-10 10:00:00", "2025-02-01T15:00:00Z", 1, 440, 4),   # ADR 110
    ])
    dem = preco.demanda_destinos(r, CFG)
    t = preco.adr_categoria(dem, pd.Timestamp("2025-06-01"), "2023-08")
    x = t[(t.car_category == "Todas") & (t.mes == pd.Period("2025-03", "M"))].iloc[0]
    assert x["situacao"] == "realizado" and x["adr_referencia"] == 100
    assert x["var_adr_pct"] == pytest.approx(0.10)


def test_gatilho_subir_preco_categoria():
    pk = pd.DataFrame([
        {"destino": "Orlando", "car_category": "Midsize Suv", "mes": pd.Period("2025-12", "M"), "dias_ate_inicio": 10,
         "otb_hoje": 30, "otb_ano_anterior": 20, "razao_vs_ano_anterior": 1.5, "adr_otb": 70.0,
         "adr_ano_anterior_mesma_data": 80.0},
        {"destino": "Orlando", "car_category": "Midsize Sedan", "mes": pd.Period("2025-12", "M"), "dias_ate_inicio": 10,
         "otb_hoje": 30, "otb_ano_anterior": 20, "razao_vs_ano_anterior": 1.5, "adr_otb": 79.5,
         "adr_ano_anterior_mesma_data": 80.0},   # só 0,6% abaixo: dentro da tolerância
    ])
    a = gatilhos.subir_preco_categoria(pk, CFG["gatilhos"]["subir_preco_categoria"], pd.Timestamp("2025-11-20"))
    assert [x["categoria"] for x in a] == ["Midsize Suv"] and a[0]["acao"] == "Subir preço da categoria"
