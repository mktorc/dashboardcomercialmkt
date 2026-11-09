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


if __name__ == "__main__":
    unittest.main()
