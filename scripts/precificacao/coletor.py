"""Coleta cotações públicas de concorrentes (sem login e sem preencher dados pessoais) para competitor_price_snapshots. Só inserção.

Fontes implementadas: UP Rent a Car e Allycar (motor de reservas HQ público, passo "Veículos").
Fora, de propósito: rentcars.com (Cloudflare bloqueia acesso automatizado: não se contorna) e Florida Rental Car (a cotação por data
exige nome e WhatsApp: não se preenche com dados falsos).

Uso:
  python3 scripts/precificacao/coletor.py up|ally|todos            # só mostra o que seria coletado (nada é gravado)
  python3 scripts/precificacao/coletor.py up|ally|todos --gravar   # grava no Supabase
  Opções: --datas 2027-03-10,2027-03-17   --dias 7   --semanas 13 (retiradas a cada 7 dias a partir de --inicio)
Requer playwright (pip install playwright && playwright install chromium) e, com --gravar, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
Cada coleta é uma linha nova; o mapa de categorias fica em scripts/precificacao/mapa_categorias.json (null = ainda não mapeada,
a coleta fica registrada mas não entra em nenhuma comparação). Equivalência é sempre "parcial" aqui: taxas e proteções são excluídas
pelo concorrente e a franquia de km não é informada; nunca se marca "equivalente" sem evidência.
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
    return float(s.replace(",", "")) if "," in s and "." in s and s.rfind(".") > s.rfind(",") else float(s.replace(".", "").replace(",", "."))


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
            texto = ""
            for fr in pg.frames:
                if "hqrentals.app/public/car-rental/reservations/step2" in fr.url:
                    texto = fr.inner_text("body")
            itens = parse_up(texto)
            print(f"{d}: {len(itens)} categorias com preço")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, url=pg.url))
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
            texto = ""
            for fr in pg.frames:
                if "hqrentals.app/public/car-rental/reservations/step2" in fr.url:
                    texto = fr.inner_text("body")
            itens = parse_ally(texto)
            print(f"Allycar {d}: {len(itens)} categorias com preço")
            for it in itens:
                res.append(dict(it, retirada=d, devolucao=fim, coletado_em=agora, url="https://allycar.com/booking.html"))
            time.sleep(PAUSA)
        b.close()
    return res


def linhas_banco(itens, mapa, concorrente, local, notas, protecoes):
    """Converte coletas em linhas de competitor_price_snapshots (equivalência 'parcial'; categoria não mapeada fica sem normalizada)."""
    rows = []
    for it in itens:
        extra = [notas]
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
}


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] not in (*FONTES, "todos"):
        raise SystemExit(__doc__)
    dias = int(a[a.index("--dias") + 1]) if "--dias" in a else 7
    if "--datas" in a:
        pickups = [date.fromisoformat(x) for x in a[a.index("--datas") + 1].split(",")]
    else:
        ini = date.fromisoformat(a[a.index("--inicio") + 1]) if "--inicio" in a else date(2027, 2, 1)
        semanas = int(a[a.index("--semanas") + 1]) if "--semanas" in a else 13
        pickups = [ini + timedelta(days=7 * i) for i in range(semanas)]
    todos_mapas = json.loads(MAPA.read_text()) if MAPA.exists() else {}
    gravar = "--gravar" in a
    if gravar:
        from hq import carregar_env
        from concorrencia import chamar
        carregar_env()
    erros = []
    for chave in (FONTES if a[0] == "todos" else [a[0]]):
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
