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


if __name__ == "__main__":
    unittest.main()
