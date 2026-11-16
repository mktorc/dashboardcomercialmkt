"""Testes da leitura da página de cotação: python3 -m unittest scripts/precificacao/test_coletor.py"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import coletor as C

TEXTO = """1 Datas 2 Veículos Classe de Veículo Disponível COMPACTO MODELOS; CHEVROLET TRAX OU SIMILAR O carro compacto é perfeito.
*PRECO PROMOCIONAL ( NAO APLICAVEL CODIGO DE DESCONTO)* Consulte Mais Informação $39,00 / dia $273,00 total para 7 Dias Excl. taxes & insurance(s) Alugar Este Veículo
SEDAN SIMPLES MODELOS; SONATA OU SIMILAR Sedan simples. Consulte Mais Informação $42,00 / dia $294,00 total para 7 Dias Excl. taxes & insurance(s) Alugar Este Veículo
VAN MODELOS; X Sem preço nesta data. Alugar Este Veículo"""


class T(unittest.TestCase):
    def test_le_categorias_com_preco(self):
        r = C.parse_up(TEXTO)
        self.assertEqual([x["categoria"] for x in r], ["COMPACTO", "SEDAN SIMPLES"])
        self.assertEqual((r[0]["diaria"], r[0]["total"], r[0]["dias"]), (39.0, 273.0, 7))
        self.assertTrue(r[0]["promo"])
        self.assertFalse(r[1]["promo"])

    def test_nome_com_rotulos_antes(self):
        t = "\nRecomendado\n\nSEDAN PREMIUM\n\nMASERATI GHIBLI\n\nTexto.\n\nConsulte Mais Informação\n$77,00 / dia\n$539,00 total para 7 Dias\nExcl.\nAlugar Este Veículo"
        self.assertEqual(C.parse_up(t)[0]["categoria"], "SEDAN PREMIUM")

    def test_sem_preco_nao_vira_zero(self):
        self.assertEqual(C.parse_up("VAN MODELOS; X Sem preço. Alugar Este Veículo"), [])

    def test_numeros(self):
        self.assertEqual(C.num("1,234.50"), 1234.5)
        self.assertEqual(C.num("39,00"), 39.0)


ALLY = """All SUV Truck Sedan Van/Minivan Available Vehicle Classes
Tesla Y

All-electric SUV with instant acceleration.

 SUV  5 Seats  4-5 Suitcases
$100,00 / day
$700,00 total for 7 Days
Excl. taxes
Continue
Chevrolet Suburban

Extra-large SUV.

 SUV  8+ Seats  6+ Suitcases
$1.180,00 / day
$1.260,00 total for 7 Days
Excl. taxes
Continue
Summary
Total $0,00"""


class Ally(unittest.TestCase):
    def test_le_modelo_tipo_e_precos(self):
        r = C.parse_ally(ALLY)
        self.assertEqual([x["categoria"] for x in r], ["Tesla Y", "Chevrolet Suburban"])
        self.assertEqual((r[0]["diaria"], r[0]["total"], r[0]["dias"], r[0]["tipo"]), (100.0, 700.0, 7, "SUV 5 Seats 4-5 Suitcases"))
        self.assertEqual(r[1]["total"], 1260.0)

    def test_resumo_sem_preco_fica_fora(self):
        self.assertEqual(C.parse_ally("Available Vehicle Classes\nSummary\nTotal $0,00"), [])


NOSSO = """1
Datas
2
Veículos
Classe de Veículo Disponível
Mini Van 8 Lugares

As minivans são veículos projetados para oferecer espaço.
CarPlay 8 Lugares
$71.58 / dia
$501.06 total para 7 Dias
Excl. taxes & insurance(s)
Alugar este Veículo
Luxury

Os SUVs de grande porte.
$240.00 / dia
$1,680.00 total para 7 Dias
Excl. taxes & insurance(s)
Ultimas Unidades
Não disponível - Contate-nos
Van 12 Assentos
Sem preço nesta data.
Não disponível - Contate-nos"""


class Nosso(unittest.TestCase):
    def test_le_categorias_precos_e_disponibilidade(self):
        r = C.parse_nosso(NOSSO)
        self.assertEqual([x["categoria"] for x in r], ["Mini Van 8 Lugares", "Luxury"])
        self.assertEqual((r[0]["diaria"], r[0]["total"], r[0]["dias"], r[0]["disponivel"]), (71.58, 501.06, 7, True))
        self.assertEqual((r[1]["diaria"], r[1]["total"], r[1]["disponivel"]), (240.0, 1680.0, False))

    def test_numeros_com_ponto_e_virgula(self):
        self.assertEqual(C.num("71.58"), 71.58)
        self.assertEqual(C.num("1,680.00"), 1680.0)
        self.assertEqual(C.num("1.260,00"), 1260.0)
        self.assertEqual(C.num("39,00"), 39.0)
        self.assertEqual(C.num("700"), 700.0)

    def test_linhas_nossas_so_com_mapa_e_diaria_media(self):
        from datetime import date, datetime, timezone
        it = [dict(categoria="Mini Van 8 Lugares", diaria=71.58, total=501.06, dias=7, disponivel=True, retirada=date(2026, 11, 23), devolucao=date(2026, 11, 30), coletado_em=datetime(2026, 11, 9, tzinfo=timezone.utc)),
              dict(categoria="Outra", diaria=10.0, total=70.0, dias=7, disponivel=True, retirada=date(2026, 11, 23), devolucao=date(2026, 11, 30), coletado_em=datetime(2026, 11, 9, tzinfo=timezone.utc))]
        rows, sem = C.linhas_nossas(it, {"Mini Van 8 Lugares": "Mini Van 8 Seats"})
        self.assertEqual(sem, ["Outra"])
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["category"], rows[0]["daily_rate"], rows[0]["source"], rows[0]["currency"]), ("Mini Van 8 Seats", 71.58, "site_cotacao", "USD"))


# Trechos reais do passo "Características" (lidos em 2026-11-10) de cada motor.
EXTRAS_UP = """Equipamentos e Serviços
Additional Driver
 $29,99 Uma vez
Bebê Conforto
0
1
2
3
4
 $5,99 /Dia
Cadeirinha de Bebê
0
1
 $5,99 /Dia
MENOR 25 ANOS
Consulte Mais Informação
 $95,00 Uma vez
Descontos
Código do Cupom"""
EXTRAS_ALLY = """Equipment & Services
 
Unlimited tolls
Free
Selected
 
Baby Seat
Free
0
 
Child Seat
Free
0
 
Additional Driver
Free
0
 
Prepaid Refuel
Read More
$75,00 One Time
Select
Discounts"""
EXTRAS_NOSSO = """Equipment & Services
  Motorista Adicional
0
1
2
3
4
 Livre
  Cadeirinha Infantil (1,5 - 4 anos)
0
1
 Livre
  Transfer em Orlando - Chegada
 $100.00 Uma vez
  Bebe Conforto (0 - 1,5 anos )
0
1
 Livre
Descontos"""


class Faltantes(unittest.TestCase):
    def test_datas_sem_tarifa_dia_a_dia(self):
        from datetime import date
        import coletor
        cob = {date(2027, 1, 13), date(2027, 1, 15)}
        self.assertEqual(coletor.datas_faltantes(date(2027, 1, 12), date(2027, 1, 16), cob),
                         [date(2027, 1, 12), date(2027, 1, 14), date(2027, 1, 16)])
        self.assertEqual(coletor.datas_faltantes(date(2027, 1, 12), date(2027, 1, 11), cob), [])

    def test_fim_e_o_dia_anterior_ao_primeiro_dia_do_hq(self):
        from datetime import date
        import coletor
        def chamar(m, caminho, *a, **k):
            if "source=eq.hq_rate_calendar" in caminho:
                return [{"pickup_date": "2027-01-16"}]
            return [{"pickup_date": "2027-01-13"}]
        self.assertEqual(coletor.datas_sem_tarifa(chamar, date(2027, 1, 12), 26),
                         [date(2027, 1, 12), date(2027, 1, 14), date(2027, 1, 15)])


class Extras(unittest.TestCase):
    def test_up_cobra_motorista_e_bebe_conforto(self):
        e = C.parse_extras(EXTRAS_UP)
        self.assertEqual(e["motorista"], (29.99, "uma_vez"))
        self.assertEqual(e["bebe"], (5.99, "dia"))
        self.assertEqual(C.custo_extras(e, 7), 71.92)  # 29,99 + 5,99 x 7

    def test_allycar_e_nosso_site_sao_gratis(self):
        for texto in (EXTRAS_ALLY, EXTRAS_NOSSO):
            e = C.parse_extras(texto)
            self.assertEqual(C.custo_extras(e, 7), 0.0)

    def test_nao_confunde_com_outros_extras(self):
        e = C.parse_extras(EXTRAS_NOSSO)  # transfer ($100) vem entre a cadeirinha e o bebê conforto
        self.assertEqual(e["bebe"][0], 0.0)

    def test_sem_secao_ou_sem_preco_claro_nao_presume_nada(self):
        self.assertIsNone(C.parse_extras("Detalhes de Retirada\nLocal de Retirada"))
        self.assertIsNone(C.parse_extras("Equipment & Services\nAdditional Driver\nBaby Seat\nDiscounts"))
        self.assertIsNone(C.parse_extras("Equipment & Services\nBaby Seat\nFree\nDiscounts"))  # sem motorista adicional

    def test_cadeirinha_quando_nao_ha_bebe_conforto(self):
        e = C.parse_extras("Equipamentos e Serviços\nMotorista Adicional\n $10,00 Uma vez\nCadeirinha Infantil\n $4,00 /Dia\nDescontos")
        self.assertEqual(e["bebe"], (4.0, "dia"))

    def test_nota_de_extras_tem_o_formato_lido_pela_tela(self):
        it = dict(categoria="SEDAN SIMPLES", diaria=42.0, total=294.0, dias=7, promo=False, extras=C.parse_extras(EXTRAS_UP))
        self.assertEqual(C.nota_extras(it), "extras: motorista=29.99/uma_vez; bebe=5.99/dia; bebe_nome=Bebê Conforto; dias=7")

    def test_sem_extras_lidos_a_nota_diz_que_nao_coletou(self):
        it = dict(categoria="X", diaria=42.0, total=294.0, dias=7, promo=False, extras=None)
        self.assertTrue(C.nota_extras(it).startswith("extras não coletados"))

    def test_o_preco_gravado_e_sempre_o_base_e_os_extras_ficam_na_nota(self):
        from datetime import date, datetime, timezone
        it = dict(categoria="SEDAN SIMPLES", diaria=42.0, total=294.0, dias=7, promo=False, url="u", retirada=date(2027, 1, 12),
                  devolucao=date(2027, 1, 19), coletado_em=datetime(2026, 11, 10, tzinfo=timezone.utc), extras=C.parse_extras(EXTRAS_UP))
        r = C.linhas_banco([it], {"SEDAN SIMPLES": "Midsize Sedan"}, "UP", "MCO", "n", "p")[0]
        self.assertEqual((r["total_price"], r["daily_price"]), (294.0, 42.0))  # nunca mistura extras no preço do veículo
        self.assertIn("extras: motorista=29.99/uma_vez; bebe=5.99/dia", r["equivalence_notes"])
        n, _ = C.linhas_nossas([dict(it, extras=C.parse_extras(EXTRAS_NOSSO), categoria="Mini Van 8 Lugares")], {"Mini Van 8 Lugares": "Mini Van 8 Seats"})
        self.assertEqual(n[0]["daily_rate"], 42.0)
        self.assertIn("motorista=0.00/uma_vez; bebe=0.00/uma_vez", n[0]["season"])

FLORIDA = """Alterar viagem
ÚLTIMAS UNIDADES
MAIS PROCURADO
Econômico 5L

Toyota Corolla, Hyundai Sonata ou similar

5 lugares
2 malas
Automático
Gasolina
Km livre
Valor da diária
US$\xa083,00/dia
US$\xa066,40/dia
20% OFF nas diárias · cupom GER20 já aplicado
Escolher →
CATEGORIA
Van 12L

Ford Transit ou similar

12 lugares
6 malas
Valor da diária
US$\xa01.157,00/dia
Escolher →
CATEGORIA
Sem Preço

X

4 lugares
Escolher →
"""

FLORIDA_EXTRAS = """Cadeirinha infantil
Obrigatória até os 5 anos.
+ US$\xa019,99 por locação*
Assento de elevação
+ US$\xa019,99 por locação*"""


class Florida(unittest.TestCase):
    def test_diaria_com_cupom_e_sem_cupom(self):
        r = C.parse_florida(FLORIDA)
        self.assertEqual([x["categoria"] for x in r], ["Econômico 5L", "Van 12L"])
        self.assertEqual((r[0]["diaria"], r[0]["diaria_cheia"], r[0]["total"], r[0]["promo"]), (66.4, 83.0, 464.8, True))
        self.assertEqual((r[1]["diaria"], r[1]["promo"]), (1157.0, False))  # fora da validade do cupom: só um preço

    def test_extras_cadeirinha(self):
        e = C.parse_extras_florida(FLORIDA_EXTRAS)
        self.assertEqual((e["bebe"], e["motorista"]), ((19.99, "uma_vez"), (0.0, "uma_vez")))
        self.assertIsNone(C.parse_extras_florida("sem adicionais"))
        it = dict(C.parse_florida(FLORIDA)[0], extras=e)
        self.assertIn("motorista=0.00/uma_vez; bebe=19.99/uma_vez", C.nota_extras(it))


def _avis_veiculo(classe, nome, lugares, essencial, completo, esgotado=False, moeda="USD"):
    def fare(tpl, daily):
        return {"feature": {"fareTemplate": tpl}, "transactionCurrency": moeda, "detailUrl": f"https://x/{classe}",
                "inclusionCodes": {"adf": True, "ldw": True}, "price": {"daily": daily, "total": round(daily * 7, 2), "discountPercentage": 20}}
    return {"vehicleInfo": {"name": nome, "isSoldOut": esgotado, "vehicleType": {"class": {"name": classe}},
                            "characteristics": {"passenger": lugares}},
            "fareGroup": [fare("LDW", essencial), fare("LIS", completo)]}


AVIS = {"objectResponse": {"search": {"availabilityResponse": {"itineraryDate": {"rentalDuration": 7}, "vehicles": [
    _avis_veiculo("MINIVAN", "TOYOTA Sienna", 7, 57.6, 65.44),
    _avis_veiculo("VAN FULL-SIZE", "FORD Transit", 12, 98.36, 111.73),
    _avis_veiculo("LUXO", "CHRYSLER 300", 5, 77.91, 88.58, esgotado=True),
    _avis_veiculo("SUV MÉDIA", "TOYOTA Rav4", 5, 48.6, 55.28, moeda="BRL"),
]}}}}


class Avis(unittest.TestCase):
    def test_usa_seguro_essencial_em_usd(self):
        r = C.parse_avis(AVIS)
        self.assertEqual([x["categoria"] for x in r], ["MINIVAN", "VAN FULL-SIZE"])  # esgotado e moeda diferente de USD ficam fora
        self.assertEqual((r[0]["diaria"], r[0]["total"], r[0]["dias"], r[0]["promo"]), (57.6, 403.2, 7, True))
        self.assertEqual(r[1]["tipo"], "FORD Transit ou similar, 12 lugares")
        self.assertTrue(r[0]["motorista_incluso"])

    def test_resposta_vazia(self):
        self.assertEqual(C.parse_avis({}), [])
        self.assertEqual(C.parse_avis(None), [])

    def test_cadeirinha(self):
        self.assertEqual(C.parse_cadeirinha_avis("EQUIPAMENTOS\nASSENTOS PARA CRIANÇAS\nAdicionar apenas por\nUSD 12.43 | dia\nESCOLHA"), 12.43)
        self.assertIsNone(C.parse_cadeirinha_avis("RÁDIO VIA SATÉLITE\nUSD 5.13 | dia"))

    def test_mapa(self):
        import json
        m = json.loads(C.MAPA.read_text())["Avis"]
        self.assertEqual({k: v for k, v in m.items() if v}, {
            "INTERMEDIÁRIO": "Midsize Sedan", "SUV MÉDIA": "Midsize Suv", "STANDARD SUV": "Fullsize Suv",
            "PREMIUM SUV": "SUV Executive 7 Seats", "MINIVAN": "Mini Van 8 Seats", "VAN FULL-SIZE": "Van 12 Seats"})

    def test_mapa_budget(self):
        import json
        m = json.loads(C.MAPA.read_text())["Budget"]
        self.assertEqual({k: v for k, v in m.items() if v}, {
            "INTERMEDIÁRIO": "Midsize Sedan", "SUV MÉDIA": "Midsize Suv", "STANDARD ELITE SUV": "Fullsize Suv",
            "PREMIUM SUV": "SUV Executive 7 Seats", "MINIVAN": "Mini Van 8 Seats", "VAN FULL-SIZE": "Van 12 Seats"})

    def test_mapa_national_alamo(self):
        import json
        m = json.loads(C.MAPA.read_text())
        for nome in ("National", "Alamo"):
            self.assertEqual({k: v for k, v in m[nome].items() if v}, {"Médio": "Midsize Sedan", "Minivan": "Mini Van 8 Seats"})
        self.assertEqual({k: v for k, v in m["Enterprise"].items() if v}, {"Tamanho médio": "Midsize Sedan", "Minivan": "Mini Van 8 Seats"})

    def test_parse_national(self):
        def cls(nome, base, status="AVAILABLE_AT_RETAIL_RATE", moeda="USD"):
            return {"name": nome, "make_model_or_similar_text": "X", "people_capacity": 7, "status": status,
                    "charges": {"PAYLATER": {"rates": [{"unit_amount_payment": {"code": moeda, "amount": base}, "unit_rate_type_quantity": 1.0}],
                                             "total_price_payment": {"code": "USD", "amount": "700.00"}}}}
        j = {"gbo": {"reservation": {"car_classes": [cls("Minivan 7 passageiros", "454.21"), cls("Esgotado", "1", "SOLD_OUT"),
                                                     cls("Real", "1", moeda="BRL")]}}}
        self.assertEqual([(i["categoria"], i["total"], i["total_com_taxas"]) for i in C.parse_national(j)],
                         [("Minivan 7 passageiros", 454.21, 700.0)])


if __name__ == "__main__":
    unittest.main()
