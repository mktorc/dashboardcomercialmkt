"""Testes da validação da planilha de concorrentes: python3 -m unittest scripts/precificacao/test_concorrencia.py"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import concorrencia as C

CATS = {"Midsize Suv", "Luxury"}
BASE = dict(concorrente="Alpha", fonte="manual", categoria="Midsize Suv", coletado_em="2026-11-09 10:00",
            retirada="2026-12-20 10:00", devolucao="2026-12-25 10:00", preco_diaria="350,50", moeda="USD")


def v(**o):
    return C.valida_linha({**BASE, **o}, CATS, "Orlando")


class T(unittest.TestCase):
    def test_linha_valida_e_equivalencia_padrao(self):
        r = v()
        self.assertEqual(r["daily_price"], 350.5)
        self.assertEqual(r["equivalence"], "nao_avaliada")
        self.assertEqual(r["location"], "Orlando")

    def test_recusa_categoria_que_nao_e_nossa(self):
        with self.assertRaises(ValueError):
            v(categoria="Compacto")

    def test_preco_zero_ou_ausente_nao_passa(self):
        for o in (dict(preco_diaria="0"), dict(preco_diaria="")):
            with self.assertRaises(ValueError):
                v(**o)

    def test_indisponivel_sem_preco_e_aceito_e_zera_preco(self):
        r = v(preco_diaria="300", disponivel="não")
        self.assertIsNone(r["daily_price"])
        self.assertIs(r["available"], False)

    def test_datas_e_equivalencia(self):
        with self.assertRaises(ValueError):
            v(devolucao="2026-12-19 10:00")
        with self.assertRaises(ValueError):
            v(equivalencia="perfeita")
        self.assertEqual(v(equivalencia="parcial")["equivalence"], "parcial")

    def test_moeda_obrigatoria(self):
        with self.assertRaises(ValueError):
            v(moeda="")

    def test_numero_brasileiro(self):
        self.assertEqual(C.numero("R$ 1.234,56"), 1234.56)
        self.assertEqual(C.numero("1234.5"), 1234.5)


if __name__ == "__main__":
    unittest.main()
