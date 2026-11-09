"""Calendário sazonal diário (data, sazonalidade, regra aplicada, evento móvel e posição relativa).

Prioridade: Altíssima > Carnaval/Semana Santa/Corpus Christi > Alta até o Carnaval (se ligada) > entre Carnaval e
Semana Santa > regra do mês. O evento móvel é identificado independentemente da sazonalidade que prevaleceu.
Tudo é calculado da Páscoa de cada ano; as regras são parametrizáveis em `Regras`.
`LEGADO` reproduz exatamente o calendário do estudo e da previsão já publicados (dim_calendario);
`GESTAO` é o usado na Gestão de Ocupação (ritmo.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta


def pascoa(ano: int) -> date:
    # Algoritmo gregoriano anônimo (Meeus/Jones/Butcher)
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


def eventos(ano: int) -> dict:
    p = pascoa(ano)
    return {
        # sábado de carnaval = Páscoa-50; terça = Páscoa-47; janela: sábado-5 até terça+5
        "carnaval": (p - timedelta(days=55), p - timedelta(days=42)),
        "semana_santa": (p - timedelta(days=7), p),
        "corpus_christi": (p + timedelta(days=60), p + timedelta(days=63)),  # quinta a domingo
    }


def referencias(ano: int) -> dict:
    """Dia de referência de cada evento móvel: terça de Carnaval, Sexta-feira Santa e quinta de Corpus Christi."""
    p = pascoa(ano)
    return {
        "carnaval": p - timedelta(days=47),
        "semana_santa": p - timedelta(days=2),
        "corpus_christi": p + timedelta(days=60),
    }


@dataclass(frozen=True)
class Regras:
    # janela de cada evento, em dias relativos à referência (início, fim)
    janelas: dict = field(default_factory=lambda: {"carnaval": (-5, 5), "semana_santa": (-5, 2), "corpus_christi": (0, 3)})
    # sazonalidade de cada evento (configurável; Corpus Christi = Alta por regra de negócio)
    sazonalidade_evento: dict = field(default_factory=lambda: {"carnaval": "Alta", "semana_santa": "Alta", "corpus_christi": "Alta"})
    # 1º de janeiro até o início da janela do Carnaval é Alta (fora o 01/01–05/01, Altíssima)
    alta_ate_carnaval: bool = True
    fevereiro: str = "Média"  # fevereiro fora de qualquer regra acima (usado só com alta_ate_carnaval desligado)
    mensal: dict = field(default_factory=lambda: {1: "Alta", 3: "Baixa", 4: "Baixa", 5: "Baixa", 6: "Baixíssima", 7: "Alta", 8: "Média", 9: "Média", 10: "Média", 11: "Média"})


# Regras do estudo e da previsão já publicados: não mudar sem republicar tudo que depende de dim_calendario.
LEGADO = Regras(janelas={"carnaval": (-8, 5), "semana_santa": (-5, 2), "corpus_christi": (0, 3)}, alta_ate_carnaval=False)
GESTAO = Regras()
ROTULO_MES = {1: "Mês: janeiro (06/01 a 31/01)", 3: "Mês: março a maio", 4: "Mês: março a maio", 5: "Mês: março a maio", 6: "Mês: junho",
              7: "Mês: julho", 8: "Mês: agosto a novembro", 9: "Mês: agosto a novembro", 10: "Mês: agosto a novembro", 11: "Mês: agosto a novembro"}
ROTULOS = {"carnaval": "Carnaval", "semana_santa": "Semana Santa", "corpus_christi": "Corpus Christi"}


def evento_do_dia(d: date, regras: Regras) -> tuple[str | None, int | None]:
    """Evento móvel cuja janela contém o dia e a posição relativa à referência (negativo = antes)."""
    for ano in (d.year - 1, d.year, d.year + 1):  # a janela pode cruzar a virada do ano
        ref = referencias(ano)
        for nome, (ini, fim) in regras.janelas.items():
            rel = (d - ref[nome]).days
            if ini <= rel <= fim:
                return nome, rel
    return None, None


def classificar_dia(d: date, regras: Regras = GESTAO) -> tuple[str, str, str | None, int | None]:
    """(sazonalidade, regra aplicada, evento, posição relativa ao evento). Nunca herda a classificação de outro ano."""
    evento, rel = evento_do_dia(d, regras)
    if (d.month == 12 and d.day >= 20) or (d.month == 1 and d.day <= 5):
        return "Altíssima", "20/12 a 05/01", evento, rel
    if evento:
        return regras.sazonalidade_evento[evento], ROTULOS[evento], evento, rel
    ev = eventos(d.year)
    ini_carnaval = referencias(d.year)["carnaval"] + timedelta(days=regras.janelas["carnaval"][0])
    fim_carnaval = referencias(d.year)["carnaval"] + timedelta(days=regras.janelas["carnaval"][1])
    ini_ss = referencias(d.year)["semana_santa"] + timedelta(days=regras.janelas["semana_santa"][0])
    if regras.alta_ate_carnaval and d < ini_carnaval and d.month <= 3:
        return "Alta", "Janeiro até o Carnaval", None, None
    if fim_carnaval < d < ini_ss:
        return "Baixa", "Entre Carnaval e Semana Santa", None, None
    m = d.month
    if m == 2:
        return regras.fevereiro, "Mês: fevereiro fora do Carnaval", None, None
    if m == 12:
        return "Baixa", "Mês: 01/12 a 19/12", None, None
    return regras.mensal[m], ROTULO_MES[m], None, None


def classificar(d: date) -> tuple[str, str]:
    """Calendário legado (dim_calendario do estudo e da previsão)."""
    s, r, _, _ = classificar_dia(d, LEGADO)
    return s, r


def tabela(inicio: date, fim: date):
    d = inicio
    while d <= fim:
        s, r = classificar(d)
        yield d, s, r
        d += timedelta(days=1)
