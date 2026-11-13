"""Coleta cotações públicas de concorrentes (sem login e sem preencher dados pessoais) para competitor_price_snapshots. Só inserção.

Fontes implementadas: UP Rent a Car e Allycar (motor de reservas HQ público, passo "Veículos") e Florida Rental Car (a cotação por data
exige nome e WhatsApp: vêm das variáveis FLORIDA_NOME e FLORIDA_WHATSAPP, contato real da equipe; nunca dados falsos; só lê telas).
Fora, de propósito: rentcars.com (Cloudflare bloqueia acesso automatizado: não se contorna).

Uso:
  python3 scripts/precificacao/coletor.py up|ally|florida|nosso|todos            # só mostra o que seria coletado (nada é gravado)
  python3 scripts/precificacao/coletor.py up|ally|florida|nosso|todos --gravar   # grava no Supabase
  "nosso" = cotação do nosso próprio site (orlandorentcar.com), gravada em our_rate_snapshots com source "site_cotacao".
  Opções: --datas 2027-03-10,2027-03-17   --dias 7   --semanas 18 (retiradas a cada 7 dias a partir de --inicio; padrão: hoje + 3 dias)
  --sem-tarifa: coleta TODAS as datas, de hoje + 3 dias até o dia anterior ao primeiro dia programado do HQ, que ainda não têm tarifa
  gravada (preenche o que o HQ não cobre com a cotação do site; lê o banco, então precisa das credenciais como --gravar).
Requer playwright (pip install playwright && playwright install chromium) e, com --gravar, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
Cada coleta é uma linha nova; o mapa de categorias fica em scripts/precificacao/mapa_categorias.json (null = ainda não mapeada,
a coleta fica registrada mas não entra em nenhuma comparação). Equivalência é sempre "parcial" aqui: taxas e proteções são excluídas
pelo concorrente e a franquia de km não é informada; nunca se marca "equivalente" sem evidência.

Extras: alguns concorrentes cobram motorista adicional e bebê conforto (cadeirinha), outros não. O preço gravado é SEMPRE o da cotação (veículo,
sem taxas e seguros); os extras são lidos no passo "Características" do próprio motor, na mesma data (nada é preenchido nem enviado: só se
lê a tela) e gravados à parte, em equivalence_notes (concorrentes) e em season (nosso site), no formato
"extras: motorista=29.99/uma_vez; bebe=5.99/dia; bebe_nome=...". A tela soma 1 motorista adicional e 1 bebê conforto (cadeirinha se não
houver bebê conforto) quando o usuário marca a opção. Grátis = 0. Sem leitura dos extras, a nota diz "extras não coletados".
"""
import json, re, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

MAPA = Path(__file__).parent / "mapa_categorias.json"
UA = "Mozilla/5.0 (compatible; price-research; low-volume)"
PAUSA = 6  # segundos entre consultas: poucas e devagar
UP_URL = ("https://uprentcar.com/reservations-orlando/?target_step=2&forced_locale=pt&pick_up_location_tenant=orlando"
          "&pick_up_location=2&return_location=2&pick_up_date={ini}&pick_up_time=10:00&return_date={fim}&return_time=10:00")
UP_LOCAL = "Orlando (Aeroporto MCO)"


def num(s):
    """Número com vírgula ou ponto decimal: '39,00', '1.260,00', '71.58', '1,680.00'. O último separador, com 1 ou 2 dígitos depois, é o decimal."""
    s = s.strip()
    m = re.search(r"[.,](\d{1,2})$", s)
    if m:
        inteiro = re.sub(r"[.,]", "", s[: m.start()])
        return float(f"{inteiro}.{m.group(1)}")
    return float(re.sub(r"[.,]", "", s))


EXTRAS_TAG = "extras:"  # formato lido pela tela (parseExtras em src/lib/competitiveness.ts)
_NOME_MOTORISTA = re.compile(r"additional driver|motorista adicional", re.I)
_NOME_BEBE = re.compile(r"beb[êe] conforto|baby seat|infant seat", re.I)
_NOME_CADEIRA = re.compile(r"cadeirinha|child seat", re.I)
_PRECO_EXTRA = re.compile(r"\$\s?([\d.,]+)\s*(?:/\s*(dia|day)|(uma vez|one time))", re.I)
_GRATIS = re.compile(r"^(livre|free)$", re.I)
_IGNORAR = {"", "read more", "consulte mais informação", "select", "selected", "recommended", "(obrigatório)"}


def _preco_apos(linhas, i):
    """Preço do item que começa na linha i: (valor, 'dia'|'uma_vez'); grátis = (0, 'uma_vez'); None se não achar antes de outro item."""
    for ln in linhas[i + 1 : i + 10]:
        if ln.isdigit() or ln.lower() in _IGNORAR:
            continue
        m = _PRECO_EXTRA.search(ln)
        if m:
            return num(m.group(1)), "dia" if m.group(2) else "uma_vez"
        if _GRATIS.match(ln):
            return 0.0, "uma_vez"
        break  # começou outro item sem preço para este
    return None


def parse_extras(texto):
    """Lê o passo 'Características' do motor HQ: {'motorista': (valor, unidade), 'bebe': (valor, unidade), 'bebe_nome': str} ou None.
    Bebê conforto; se o motor não tiver, cadeirinha. Sem preço claro (nem 'grátis') de qualquer um dos dois, devolve None: nada é presumido."""
    linhas = [ln.strip() for ln in texto.replace("\xa0", " ").splitlines() if ln.strip()]
    ini = next((i for i, ln in enumerate(linhas) if re.match(r"(equipamentos e servi[çc]os|equipment & services)", ln, re.I)), None)
    if ini is None:
        return None
    fim = next((i for i in range(ini + 1, len(linhas)) if re.match(r"(descontos|discounts)", linhas[i], re.I)), len(linhas))
    sec = linhas[ini + 1 : fim]

    def achar(rx):
        for i, ln in enumerate(sec):
            if rx.search(ln) and not ln.startswith("$"):
                p = _preco_apos(sec, i)
                if p:
                    return ln, p
        return None

    motorista, bebe = achar(_NOME_MOTORISTA), achar(_NOME_BEBE) or achar(_NOME_CADEIRA)
    if not motorista or not bebe:
        return None
    return dict(motorista=motorista[1], bebe=bebe[1], bebe_nome=bebe[0])


def custo_extras(extras, dias):
    """Custo de 1 motorista adicional + 1 bebê conforto para `dias` diárias ('dia' multiplica; 'uma_vez' é fixo)."""
    def c(v):
        valor, unidade = v
        return valor * dias if unidade == "dia" else valor
    return round(c(extras["motorista"]) + c(extras["bebe"]), 2)


def _usd(v):
    return f"US$ {v:.2f}".replace(".", ",")


def _fmt_extra(v):
    valor, unidade = v
    return "grátis" if valor == 0 else _usd(valor) + (" /dia" if unidade == "dia" else " uma vez")


def nota_extras(it):
    """Nota com os extras lidos nesta data (formato lido pela tela) ou 'extras não coletados'. O preço da cotação não muda."""
    extras = it.get("extras")
    if not extras:
        return "extras não coletados (motorista adicional e bebê conforto desconhecidos)"
    def f(v):
        valor, unidade = v
        return f"{valor:.2f}/{unidade}"
    return f"{EXTRAS_TAG} motorista={f(extras['motorista'])}; bebe={f(extras['bebe'])}; bebe_nome={extras['bebe_nome']}; dias={it['dias']}"


def _extras_apos_escolher(pg, fr, texto_botao):
    """Escolhe o primeiro veículo disponível e lê os extras do passo seguinte (só leitura: nada é preenchido nem enviado)."""
    try:
        fr.locator(f"text={texto_botao}").first.click()
        pg.wait_for_load_state("networkidle", timeout=60000)
        pg.wait_for_timeout(6000)
        for f in pg.frames:
            if "step3" in f.url:
                return parse_extras(f.inner_text("body"))
    except Exception as e:
        print(f"  extras não coletados ({str(e)[:80]})")
    return None


ROTULOS = {"RECOMENDADO", "DISPONÍVEL", "DISPONIVEL", "CLASSE DE VEÍCULO", "CLASSE DE VEICULO", "CONSULTE MAIS INFORMAÇÃO"}
TITULO = re.compile(r"^[A-ZÀ-Ú0-9][A-ZÀ-Ú0-9 /+.\-]{2,40}$")


def parse_up(texto):
    """Lê o texto do passo 'Veículos' do motor HQ: [{categoria, diaria, total, dias, promo}]. O que não tiver preço fica de fora.
    A categoria é a primeira linha em maiúsculas do bloco (descartados rótulos como 'Recomendado' e 'Disponível')."""
    out = []
    for bloco in texto.replace("\xa0", " ").split("Alugar Este Veículo"):
        m_dia = re.search(r"\$\s?([\d.,]+)\s*/\s*dia", bloco)
        m_tot = re.search(r"\$\s?([\d.,]+)\s*total para\s*(\d+)\s*Dias", bloco)
        if not m_dia or not m_tot:
            continue
        cabeca = bloco[:m_dia.start()]
        linhas = [ln.strip() for ln in cabeca.splitlines() if ln.strip()]
        categoria = next((ln for ln in linhas if TITULO.match(ln) and ln not in ROTULOS), "")
        if not categoria:  # texto em uma linha só (sem quebras): "... Disponível NOME MODELOS; ..."
            m = re.search(r"(?:Disponível\s+)?([A-ZÀ-Ú][A-ZÀ-Ú0-9 /+-]{2,40}?)\s+MODELOS?;", cabeca)
            categoria = m.group(1).strip() if m else ""
        diaria, total, dias = num(m_dia.group(1)), num(m_tot.group(1)), int(m_tot.group(2))
        if categoria and diaria > 0 and total > 0:
            out.append(dict(categoria=categoria, diaria=diaria, total=total, dias=dias, promo="PRECO PROMOCIONAL" in cabeca.upper()))
    return out


def coleta_up(pickups, dias):
    from playwright.sync_api import sync_playwright
    res = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(user_agent=UA)
        for d in pickups:
            fim = d + timedelta(days=dias)
            agora = datetime.now(timezone.utc)
            pg.goto(UP_URL.format(ini=d.isoformat(), fim=fim.isoformat()), wait_until="networkidle", timeout=90000)
            pg.wait_for_timeout(5000)
            texto, f2 = "", None
            for fr in pg.frames:
                if "hqrentals.app/public/car-rental/reservations/step2" in fr.url:
                    texto, f2 = fr.inner_text("body"), fr
            itens = parse_up(texto)
            url = pg.url
            extras = _extras_apos_escolher(pg, f2, "Alugar Este Veículo") if itens and f2 else None
            print(f"{d}: {len(itens)} categorias com preço; extras: {'lidos' if extras else 'NÃO lidos'}")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, url=url, extras=extras))
            time.sleep(PAUSA)
        b.close()
    return res


ALLY_LOCAL = "Orlando (Aeroporto MCO)"


def parse_ally(texto):
    """Lê o passo 'Vehicles' do motor HQ do Allycar: [{categoria, diaria, total, dias, promo, tipo}]. Sem preço = fora."""
    resto = texto.replace("\xa0", " ").split("Available Vehicle Classes", 1)[-1]
    out = []
    for bloco in resto.split("Continue"):
        m_dia = re.search(r"\$\s?([\d.,]+)\s*/\s*day", bloco)
        m_tot = re.search(r"\$\s?([\d.,]+)\s*total for\s*(\d+)\s*Days", bloco)
        linhas = [ln.strip() for ln in bloco.splitlines() if ln.strip()]
        if not (m_dia and m_tot and linhas):
            continue
        tipo = next((ln for ln in linhas if re.search(r"\d\+?\s*Seats", ln)), "")
        diaria, total, dias = num(m_dia.group(1)), num(m_tot.group(1)), int(m_tot.group(2))
        if diaria > 0 and total > 0:
            out.append(dict(categoria=linhas[0], tipo=re.sub(r"\s+", " ", tipo), diaria=diaria, total=total, dias=dias, promo=False))
    return out


def coleta_ally(pickups, dias):
    from playwright.sync_api import sync_playwright
    res = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(user_agent=UA)
        for d in pickups:
            fim = d + timedelta(days=dias)
            agora = datetime.now(timezone.utc)
            pg.goto("https://allycar.com/", wait_until="networkidle", timeout=90000)
            pg.fill("#bq-d1", d.isoformat())
            pg.fill("#bq-d2", fim.isoformat())
            pg.select_option("#bq-h1", "10:00")
            pg.select_option("#bq-h2", "10:00")
            pg.click(".bq-painel button[type=submit]")
            pg.wait_for_load_state("networkidle", timeout=60000)
            pg.wait_for_timeout(8000)
            texto, f2 = "", None
            for fr in pg.frames:
                if "hqrentals.app/public/car-rental/reservations/step2" in fr.url:
                    texto, f2 = fr.inner_text("body"), fr
            itens = parse_ally(texto)
            extras = _extras_apos_escolher(pg, f2, "Continue") if itens and f2 else None
            print(f"Allycar {d}: {len(itens)} categorias com preço; extras: {'lidos' if extras else 'NÃO lidos'}")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, url="https://allycar.com/booking.html", extras=extras))
            time.sleep(PAUSA)
        b.close()
    return res


FLORIDA_URL = ("https://reservas.floridarentalcar.com.br/reserva?pickupLocation=mco&returnLocation=mco&pickupDate={ini}&pickupTime=10%3A00"
               "&returnDate={fim}&returnTime=10%3A00")
FLORIDA_LOCAL = "Orlando (Aeroporto MCO)"


def _usd_br(s):
    """'1.234,56' -> 1234.56 (valores em dólar no formato brasileiro, como a Florida exibe)."""
    return float(s.replace(".", "").replace(",", "."))


def parse_florida(texto, dias=7):
    """Lê o passo 'Escolha sua categoria' da Florida Rental Car: [{categoria, diaria, diaria_cheia, total, dias, promo}].
    A diária gravada é a COM cupom (a tela mostra cheia e com cupom; fora da validade do cupom só há um preço). Sem preço = fora."""
    out = []
    for bloco in texto.replace("\xa0", " ").split("Escolher →")[:-1]:
        linhas = [ln.strip() for ln in bloco.splitlines() if ln.strip()]
        if "Valor da diária" not in linhas:
            continue
        j = linhas.index("Valor da diária")
        lugares = [i for i, ln in enumerate(linhas[:j]) if "lugares" in ln]
        precos = [_usd_br(m) for ln in linhas[j + 1:j + 3] for m in re.findall(r"US\$\s*([\d.,]+)/dia", ln)]
        if not lugares or lugares[-1] < 2 or not precos:
            continue
        cheia, diaria = precos[0], precos[-1]
        if diaria > 0:
            out.append(dict(categoria=linhas[lugares[-1] - 2], diaria=diaria, diaria_cheia=cheia, total=round(diaria * dias, 2),
                            dias=dias, promo=diaria < cheia))
    return out


def parse_extras_florida(texto):
    """Extras do passo 'Personalize sua viagem' da Florida: cadeirinha infantil (bebê conforto) por locação. Motorista adicional não é
    listado entre os adicionais (grátis/não cobrado à parte = 0). Sem a cadeirinha na tela = None ('extras não coletados')."""
    t = texto.replace("\xa0", " ")
    m = re.search(r"Cadeirinha infantil.*?\+\s*US\$\s*([\d.,]+)\s*(por locação|/dia)", t, re.S)
    if not m:
        return None
    unidade = "uma_vez" if m.group(2) == "por locação" else "dia"
    return {"motorista": (0.0, "uma_vez"), "bebe": (_usd_br(m.group(1)), unidade), "bebe_nome": "Cadeirinha infantil"}


def coleta_florida(pickups, dias):
    """Cotação pública da Florida Rental Car. O site exige nome e WhatsApp reais antes de mostrar preço por data: vêm de
    FLORIDA_NOME e FLORIDA_WHATSAPP (contato da própria equipe; nunca dados falsos). Só lê telas: nada é reservado nem pago."""
    import os
    from playwright.sync_api import sync_playwright
    nome, fone = os.environ.get("FLORIDA_NOME"), os.environ.get("FLORIDA_WHATSAPP")
    if not (nome and fone):
        raise RuntimeError("defina FLORIDA_NOME e FLORIDA_WHATSAPP (contato real da equipe) para coletar a Florida Rental Car")
    res, extras = [], None
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(user_agent=UA, viewport={"width": 1280, "height": 900})
        for i, d in enumerate(pickups):
            fim = d + timedelta(days=dias)
            agora = datetime.now(timezone.utc)
            pg.goto(FLORIDA_URL.format(ini=d.isoformat(), fim=fim.isoformat()), timeout=60000)
            pg.wait_for_timeout(3000)
            if pg.query_selector("dialog[open] input[autocomplete=given-name]"):
                pg.fill("dialog input[autocomplete=given-name]", nome)
                pg.fill("input[type=tel]", fone)
                pg.press("input[type=tel]", "Enter")
                pg.wait_for_timeout(4000)
            pg.click("text=Consultar carros")
            pg.wait_for_timeout(8000)
            itens = parse_florida(pg.inner_text("body"), dias)
            if itens and extras is None and i == 0:  # os adicionais são os mesmos em todas as datas: lidos uma vez só
                try:
                    pg.get_by_role("button", name="Escolher").first.click()
                    pg.wait_for_timeout(5000)
                    extras = parse_extras_florida(pg.inner_text("body"))
                except Exception as e:
                    print(f"  extras não coletados ({str(e)[:80]})")
            print(f"Florida Rental Car {d}: {len(itens)} categorias com preço; extras: {'lidos' if extras else 'NÃO lidos'}")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, url="https://reservas.floridarentalcar.com.br/reserva",
                                extras=extras))
            time.sleep(PAUSA)
        b.close()
    return res


NOSSO_NOME = "Orlando Rent Car"
NOSSO_FORMULARIO = "https://orlandorentcar.com/reservations/"
_ROTULOS_NOSSO = re.compile(r"^(\d+|Datas|Veículos|Características|Cliente|Confirme|Pagamentos|Classe de Veículo Disponível|Ultimas Unidades|Excl\..*)$", re.I)


def parse_nosso(texto):
    """Lê o passo 'Veículos' do NOSSO site (motor HQ): [{categoria, diaria, total, dias, disponivel}].
    Cada categoria termina em 'Alugar este Veículo' (disponível) ou 'Não disponível - Contate-nos'; sem preço = fora."""
    out = []
    partes = re.split(r"(Alugar este Veículo|Não disponível - Contate-nos)", texto.replace("\xa0", " "))
    for i in range(0, len(partes) - 1, 2):
        bloco, fim = partes[i], partes[i + 1]
        m_dia = re.search(r"\$\s?([\d.,]+)\s*/\s*dia", bloco)
        m_tot = re.search(r"\$\s?([\d.,]+)\s*total para\s*(\d+)\s*Dias", bloco)
        if not (m_dia and m_tot):
            continue
        linhas = [ln.strip() for ln in bloco[: m_dia.start()].splitlines() if ln.strip()]
        nome = next((ln for ln in linhas if not _ROTULOS_NOSSO.match(ln)), "")
        diaria, total, dias = num(m_dia.group(1)), num(m_tot.group(1)), int(m_tot.group(2))
        if nome and diaria > 0 and total > 0:
            out.append(dict(categoria=nome, diaria=diaria, total=total, dias=dias, disponivel=fim.startswith("Alugar")))
    return out


def _clica_dia(fr, pg, campo, d):
    """O seletor de datas do motor só aceita clique: abre o calendário, vai ao mês da data e clica no dia."""
    fr.click(f"#{campo}")
    pg.wait_for_timeout(500)
    for _ in range(24):
        cab = fr.locator(".datepicker-dropdown .datepicker-days th.datepicker-switch").first.inner_text().strip().lower()
        atual = _mes_ano(cab)
        if atual == (d.year, d.month):
            break
        fr.locator(".datepicker-dropdown .datepicker-days th.next" if atual < (d.year, d.month) else ".datepicker-dropdown .datepicker-days th.prev").first.click()
        pg.wait_for_timeout(250)
    fr.locator(".datepicker-dropdown td.day:not(.old):not(.new):not(.disabled)").filter(has_text=re.compile(rf"^{d.day}$")).first.click()
    pg.wait_for_timeout(400)


_MESES = {"janeiro": 1, "fevereiro": 2, "março": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9,
          "outubro": 10, "novembro": 11, "dezembro": 12, "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
          "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}


def _mes_ano(cab):
    """'novembro 2026' / 'November 2026' -> (2026, 11)."""
    nome, ano = cab.rsplit(" ", 1)
    return int(ano), _MESES[nome.strip()]


def coleta_nosso(pickups, dias):
    """Cotação do nosso próprio site (MCO, 10:00) para cada retirada: mesma base dos concorrentes (diária e total, sem taxas e seguros)."""
    from playwright.sync_api import sync_playwright
    res = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(user_agent=UA)
        for d in pickups:
            fim = d + timedelta(days=dias)
            agora = datetime.now(timezone.utc)
            pg.goto(NOSSO_FORMULARIO, wait_until="networkidle", timeout=90000)
            pg.wait_for_timeout(5000)
            fr = next(f for f in pg.frames if "reservations/step1" in f.url)
            _clica_dia(fr, pg, "pick_up_date", d)
            _clica_dia(fr, pg, "return_date", fim)
            for campo in ("pick_up_time", "return_time"):
                fr.fill(f"#{campo}", "10:00 AM")
                fr.press(f"#{campo}", "Tab")
            fr.click("button[type=submit]:has-text('Próximo Passo')")
            pg.wait_for_load_state("networkidle", timeout=60000)
            pg.wait_for_timeout(8000)
            texto, f2 = "", None
            for f in pg.frames:
                if "reservations/step2" in f.url:
                    texto, f2 = f.inner_text("body"), f
            itens = parse_nosso(texto)
            extras = _extras_apos_escolher(pg, f2, "Alugar este Veículo") if itens and f2 else None
            print(f"Nosso site {d}: {len(itens)} categorias com preço; extras: {'lidos' if extras else 'NÃO lidos'}")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, extras=extras))
            time.sleep(PAUSA)
        b.close()
    return res


def datas_faltantes(ini, fim, cobertas):
    """Retiradas diárias de `ini` a `fim` (inclusive) que ainda não têm tarifa em our_rate_snapshots (`cobertas` = conjunto de datas)."""
    return [d for d in (ini + timedelta(days=i) for i in range((fim - ini).days + 1)) if d not in cobertas]


def datas_sem_tarifa(chamar, ini, semanas):
    """Datas de `ini` até o dia anterior ao primeiro dia programado do HQ (ou `semanas` à frente, sem HQ) sem nenhuma tarifa gravada."""
    hq = chamar("GET", "our_rate_snapshots?select=pickup_date&source=eq.hq_rate_calendar&order=pickup_date.asc&limit=1")
    fim = date.fromisoformat(hq[0]["pickup_date"]) - timedelta(days=1) if hq else ini + timedelta(days=7 * semanas)
    cobertas, pos = set(), 0
    while True:
        pag = chamar("GET", f"our_rate_snapshots?select=pickup_date&pickup_date=gte.{ini}&pickup_date=lte.{fim}&order=pickup_date.asc&limit=1000&offset={pos}") or []
        cobertas |= {date.fromisoformat(r["pickup_date"]) for r in pag}
        if len(pag) < 1000:
            break
        pos += 1000
    return datas_faltantes(ini, fim, cobertas)


def linhas_nossas(itens, mapa):
    """Linhas de our_rate_snapshots: diária média da cotação de N diárias a partir da retirada (categoria sem mapa fica de fora)."""
    rows, sem_mapa = [], set()
    for it in itens:
        cat = mapa.get(it["categoria"])
        if not cat:
            sem_mapa.add(it["categoria"])
            continue
        rows.append(dict(pickup_date=it["retirada"].isoformat(), category=cat, daily_rate=round(it["total"] / it["dias"], 2),
                         season=f"cotação do site, {it['dias']} diárias; {nota_extras(it)}", currency="USD", source="site_cotacao",
                         collected_at=it["coletado_em"].isoformat()))
    return rows, sorted(sem_mapa)


def linhas_banco(itens, mapa, concorrente, local, notas, protecoes):
    """Converte coletas em linhas de competitor_price_snapshots (equivalência 'parcial'; categoria não mapeada fica sem normalizada)."""
    rows = []
    for it in itens:
        extra = [notas, nota_extras(it)]
        if it.get("tipo"):
            extra.append(it["tipo"])
        if it["promo"]:
            extra.append("preço promocional")
        rows.append(dict(
            _concorrente=concorrente, source="coleta automática (motor de reservas público)", source_url=it["url"], location=local,
            source_category=it["categoria"], normalized_category=mapa.get(it["categoria"]),
            collected_at=it["coletado_em"].isoformat(), pickup_at=f"{it['retirada']}T10:00:00", return_at=f"{it['devolucao']}T10:00:00",
            total_price=it["total"], daily_price=it["diaria"], currency="USD", taxes_included=False,
            protections=protecoes, mileage=None, cancellation_policy=None, payment_conditions=None,
            available=True, equivalence="parcial", equivalence_notes="; ".join(extra)))
    return rows


FONTES = {
    "up": ("UP Rent a Car", coleta_up, UP_LOCAL, "Preço sem taxas e seguros; franquia de km não informada", "não incluídas (preço exclui taxas e seguros)"),
    "ally": ("Allycar", coleta_ally, ALLY_LOCAL, "Preço sem taxas; proteções e franquia de km não informadas", "não informadas (preço exclui taxas)"),
    "florida": ("Florida Rental Car", coleta_florida, FLORIDA_LOCAL,
                "Preço sem taxas e seguros; km livre; preço com cupom GER20 quando válido; motorista adicional não listado (0)",
                "não incluídas (preço exclui taxas e seguros)"),
}


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] not in (*FONTES, "nosso", "todos"):
        raise SystemExit(__doc__)
    dias = int(a[a.index("--dias") + 1]) if "--dias" in a else 7
    if "--datas" in a:
        pickups = [date.fromisoformat(x) for x in a[a.index("--datas") + 1].split(",")]
    elif "--sem-tarifa" in a:
        pickups = None  # calculado abaixo, depois de carregar as credenciais
    else:
        # Padrão: a partir de hoje + 3 dias (os sites exigem ~48 h de antecedência), semanal, 18 semanas (~4 meses à frente).
        ini = date.fromisoformat(a[a.index("--inicio") + 1]) if "--inicio" in a else date.today() + timedelta(days=3)
        semanas = int(a[a.index("--semanas") + 1]) if "--semanas" in a else 18
        pickups = [ini + timedelta(days=7 * i) for i in range(semanas)]
    todos_mapas = json.loads(MAPA.read_text()) if MAPA.exists() else {}
    gravar = "--gravar" in a
    if gravar or "--sem-tarifa" in a:
        from hq import carregar_env
        from concorrencia import chamar
        carregar_env()
    if pickups is None:
        # Datas que o HQ não cobre (o calendário diário dele começa mais tarde) e que o nosso site ainda não cotou.
        ini = date.fromisoformat(a[a.index("--inicio") + 1]) if "--inicio" in a else date.today() + timedelta(days=3)
        pickups = datas_sem_tarifa(chamar, ini, int(a[a.index("--semanas") + 1]) if "--semanas" in a else 26)
        print(f"Datas sem tarifa gravada: {len(pickups)} ({pickups[0]} a {pickups[-1]})" if pickups else "Nenhuma data sem tarifa.")
        if not pickups:
            raise SystemExit(0)
    erros = []
    if a[0] in ("nosso", "todos"):
        try:  # a nossa tarifa não derruba a coleta dos concorrentes (e vice-versa)
            itens = coleta_nosso(pickups, dias)
            rows, sem_mapa = linhas_nossas(itens, {k: v for k, v in todos_mapas.get(NOSSO_NOME, {}).items() if v})
            print(f"{NOSSO_NOME}: {len(rows)} linhas; sem mapa (ignoradas): {sem_mapa}")
            for r in rows[:6]:
                print(f"  {r['pickup_date']} {r['category']}: {r['daily_rate']}/dia")
            if gravar and rows:
                for i in range(0, len(rows), 500):
                    chamar("POST", "our_rate_snapshots", rows[i:i + 500], {"Prefer": "return=minimal"})
                print(f"{NOSSO_NOME}: gravadas {len(rows)} tarifas.")
            elif gravar:
                print(f"{NOSSO_NOME}: nada coletado, nada gravado.")
                erros.append(NOSSO_NOME)
        except Exception as e:
            print(f"{NOSSO_NOME}: falhou ({e})")
            erros.append(NOSSO_NOME)
    for chave in ([] if a[0] == "nosso" else FONTES if a[0] == "todos" else [a[0]]):
        nome, coleta, local, notas, protecoes = FONTES[chave]
        try:  # uma fonte que falhe não derruba as outras
            itens = coleta(pickups, dias)
        except Exception as e:
            print(f"{nome}: falhou ({e})")
            erros.append(nome)
            continue
        mapa = {k: v for k, v in todos_mapas.get(nome, {}).items() if v}
        rows = linhas_banco(itens, mapa, nome, local, notas, protecoes)
        sem_mapa = sorted({r["source_category"] for r in rows if not r["normalized_category"]})
        print(f"{nome}: {len(rows)} linhas; sem mapa (não entram na comparação): {sem_mapa}")
        for r in rows[:6]:
            print(f"  {r['pickup_at'][:10]} {r['source_category']}: {r['daily_price']}/dia, total {r['total_price']} -> {r['normalized_category']}")
        if not gravar:
            continue
        if not rows:
            print(f"{nome}: nada coletado, nada gravado.")
            erros.append(nome)
            continue
        ids = {c["name"]: c["id"] for c in chamar("GET", "competitors?select=id,name")}
        if nome not in ids:
            ids[nome] = chamar("POST", "competitors", {"name": nome, "kind": "direto"}, {"Prefer": "return=representation"})[0]["id"]
        novas = [{**{k: v for k, v in r.items() if k != "_concorrente"}, "competitor_id": ids[nome]} for r in rows]
        for i in range(0, len(novas), 500):
            chamar("POST", "competitor_price_snapshots", novas[i:i + 500], {"Prefer": "return=minimal"})
        print(f"{nome}: gravadas {len(novas)} coletas.")
    if not gravar:
        print("Nada gravado (use --gravar).")
    if erros:
        raise SystemExit(f"Fontes com problema: {', '.join(erros)}")
