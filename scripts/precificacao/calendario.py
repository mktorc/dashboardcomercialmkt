"""Calendário sazonal diário (data, sazonalidade, regra aplicada).

Prioridade: Altíssima > Carnaval/Semana Santa/Corpus Christi > entre Carnaval e
Semana Santa > regra do mês.
"""
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


def classificar(d: date) -> tuple[str, str]:
    if (d.month == 12 and d.day >= 20) or (d.month == 1 and d.day <= 5):
        return "Altíssima", "20/12 a 05/01"
    ev = eventos(d.year)
    for nome, rotulo in (("carnaval", "Carnaval"), ("semana_santa", "Semana Santa"), ("corpus_christi", "Corpus Christi")):
        ini, fim = ev[nome]
        if ini <= d <= fim:
            return "Alta", rotulo
    if ev["carnaval"][1] < d < ev["semana_santa"][0]:
        return "Baixa", "Entre Carnaval e Semana Santa"
    m = d.month
    if m == 1: return "Alta", "Mês: janeiro (06/01 a 31/01)"
    if m == 2: return "Média", "Mês: fevereiro fora do Carnaval"
    if m in (3, 4, 5): return "Baixa", "Mês: março a maio"
    if m == 6: return "Baixíssima", "Mês: junho"
    if m == 7: return "Alta", "Mês: julho"
    if 8 <= m <= 11: return "Média", "Mês: agosto a novembro"
    return "Baixa", "Mês: 01/12 a 19/12"


def tabela(inicio: date, fim: date):
    d = inicio
    while d <= fim:
        s, r = classificar(d)
        yield d, s, r
        d += timedelta(days=1)
