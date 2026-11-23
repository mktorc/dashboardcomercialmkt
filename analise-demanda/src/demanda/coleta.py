"""Coleta das fontes para data/raw (somente leitura em todas elas).

- NTTO (trade.gov, público): resumos mensais por destino (Tabelas I.1 e Q.1) e série nacional mensal 2000→.
- Supabase (service role, GET): reservas sem dados pessoais e cadastro de lojas (fleet_locations).
- HQ Rentals (GET): data de criação real e loja de retirada de cada reserva.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

UA = {"User-Agent": "Mozilla/5.0 (compatible; analise-demanda/1.0)"}
PAGINAS_NTTO = [
    "https://www.trade.gov/i-94-arrivals-program",
    "https://www.trade.gov/i-94-arrivals-historical-data",
]
NOMES_MES = ["january", "february", "march", "april", "may", "june", "july", "august",
             "september", "october", "november", "december"]
MESES = {m: i + 1 for i, m in enumerate(NOMES_MES)}
MESES.update({k[:3]: v for k, v in list(MESES.items())})

# Rótulos (sem diferenciar maiúsculas) de cada série nas tabelas do NTTO.
ROTULOS_I = {"eua": {"grand total"}, "florida": {"florida"}}
ROTULOS_Q = {
    "orlando": {"orlando, fl"},
    "miami": {"miami, fl"},
    "fort_lauderdale": {"fort lauderdale, fl", "ft. lauderdale, fl", "ft lauderdale, fl"},
}
# Campos exportados do Supabase: nada de e-mail, telefone, nome de cliente ou vendedor.
CAMPOS_RESERVA = ("reservation_id,created_at,pick_up_at,return_at,status,car_category,rental_days,"
                  "total_amount,rack_rate,discount_amount,additional_charges_price,miscellaneous_price")


def carregar_env(caminho: Path) -> None:
    if caminho.exists():
        for linha in caminho.read_text().splitlines():
            if "=" in linha and not linha.lstrip().startswith("#"):
                k, v = linha.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _get(url: str, headers: dict | None = None, tentativas: int = 5) -> bytes:
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            # 520–524: erros do Cloudflare na frente do Supabase (origem lenta/instável), passageiros.
            if e.code in (429, 500, 502, 503, 504, 520, 521, 522, 523, 524) and t < tentativas - 1:
                time.sleep(min(60, 2 ** (t + 2)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if t == tentativas - 1:
                raise
            time.sleep(2 ** (t + 1))
    raise RuntimeError("inalcançável")


# ---------------------------------------------------------------- NTTO

def mes_do_arquivo(nome: str) -> tuple[int, int, bool] | None:
    """(ano, mês, preliminar) a partir do nome do resumo mensal; None se não for um resumo mensal por país."""
    n = urllib.parse.unquote(nome).rsplit("/", 1)[-1].lower()
    if "summary" not in n and "sa_adis" not in n:
        return None
    if "cor" not in n and "i94" not in n:
        return None
    ano = re.search(r"(20\d\d)", n)
    mes = next((MESES[m] for m in re.findall(r"[a-z]+", n) if m in MESES), None)
    if not ano or not mes:
        return None
    return int(ano.group(1)), mes, n.startswith("preliminary")


def listar_resumos_ntto() -> dict[str, dict]:
    """Melhor arquivo por mês (final > preliminar) a partir das páginas do NTTO."""
    melhores: dict[str, dict] = {}
    for pagina in PAGINAS_NTTO:
        html = _get(pagina).decode("utf-8", "replace")
        for link in re.findall(r'(?:href|value)="([^"]+\.xlsx)"', html):
            info = mes_do_arquivo(link)
            if not info:
                continue
            ano, mes, prelim = info
            url = link if link.startswith("http") else "https://www.trade.gov/" + link.lstrip("/")
            url = url.replace("trade.gov//", "trade.gov/")
            chave = f"{ano}-{mes:02d}"
            atual = melhores.get(chave)
            if atual is None or (atual["preliminar"] and not prelim):
                melhores[chave] = {"mes": chave, "url": url, "preliminar": prelim}
    return melhores


def _existe(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def adivinhar_resumo(ano: int, mes: int) -> dict | None:
    """Meses que as páginas deixam de listar seguem no servidor: tenta os nomes usados desde 2022
    (pasta = mês de upload, 1 a 4 meses depois do mês de referência). Final antes de preliminar."""
    nome = NOMES_MES[mes - 1].capitalize()
    for prefixos, prelim in ((("FINAL", "Final"), False), (("Preliminary",), True)):
        for soma in (1, 2, 3, 4):
            uy, um = ano + (mes + soma - 1) // 12, (mes + soma - 1) % 12 + 1
            for p in prefixos:
                for suf in ("", "_0", "_1"):
                    url = (f"https://www.trade.gov/sites/default/files/{uy}-{um:02d}/"
                           f"{p}_SummaryAnalysis_COR_{nome}_{ano}{suf}.xlsx")
                    if _existe(url):
                        return {"mes": f"{ano}-{mes:02d}", "url": url, "preliminar": prelim}
    return None


def url_serie_nacional() -> str:
    html = _get(PAGINAS_NTTO[0]).decode("utf-8", "replace")
    for link in re.findall(r'href="([^"]+\.xlsx)"', html):
        n = urllib.parse.unquote(link)
        if "Monthly Arrivals" in n and "Country of Residence" in n:
            return link.replace("trade.gov//", "trade.gov/")
    raise RuntimeError("Série mensal nacional (COR) não encontrada na página do NTTO")


def _coluna_brasil(ws, rotulos: dict[str, set[str]]) -> dict[str, int]:
    col, out = None, {}
    for r in ws.iter_rows(values_only=True):
        if col is None:
            for i, c in enumerate(r):
                if isinstance(c, str) and c.strip().lower() == "brazil":
                    col = i
            continue
        lab = str(r[0] if r and r[0] is not None else "").replace("\xa0", " ").strip().lower()
        for serie, nomes in rotulos.items():
            if lab in nomes and serie not in out and col < len(r) and isinstance(r[col], (int, float)):
                out[serie] = int(r[col])
    return out


def extrair_resumo(caminho: Path) -> dict[str, int | None]:
    from openpyxl import load_workbook

    wb = load_workbook(caminho, read_only=True, data_only=True)
    i = _coluna_brasil(wb["Table I"], ROTULOS_I)
    q = _coluna_brasil(wb["Table Q"], ROTULOS_Q)
    faltando = [s for s in ("eua", "florida") if s not in i] + [s for s in ("orlando", "miami") if s not in q]
    if faltando:
        raise ValueError(f"{caminho.name}: séries não encontradas {faltando}")
    return {**i, **{s: q.get(s) for s in ROTULOS_Q}}


def coletar_ntto(raw: Path, anos: list[int]) -> pd.DataFrame:
    pasta = raw / "ntto" / "arquivos"
    pasta.mkdir(parents=True, exist_ok=True)
    import datetime as _dt

    resumos = listar_resumos_ntto()
    hoje = _dt.date.today()
    for ano in anos:
        for mes in range(1, 13):
            chave = f"{ano}-{mes:02d}"
            # Buracos (ou preliminares antigos): tenta achar o arquivo pelo nome. Mês corrente ainda não sai.
            if (ano, mes) < (hoje.year, hoje.month) and (chave not in resumos or resumos[chave]["preliminar"]):
                achado = adivinhar_resumo(ano, mes)
                if achado and (chave not in resumos or not achado["preliminar"]):
                    resumos[chave] = achado
    linhas = []
    for chave, info in sorted(resumos.items()):
        if int(chave[:4]) not in anos:
            continue
        arq = pasta / f"{chave}{'_prelim' if info['preliminar'] else ''}.xlsx"
        if not arq.exists():  # final não muda; preliminar ganha arquivo novo quando sai o final
            arq.write_bytes(_get(info["url"]))
        linhas.append({"mes": chave, **extrair_resumo(arq), "preliminar": info["preliminar"], "fonte": info["url"]})
    df = pd.DataFrame(linhas)
    df.to_csv(raw / "ntto" / "ntto_destinos.csv", index=False)
    return df


def coletar_ntto_nacional(raw: Path) -> pd.DataFrame:
    from openpyxl import load_workbook

    arq = raw / "ntto" / "ntto_nacional_cor.xlsx"
    arq.parent.mkdir(parents=True, exist_ok=True)
    arq.write_bytes(_get(url_serie_nacional()))  # sempre rebaixa: o NTTO atualiza o mesmo arquivo
    ws = load_workbook(arq, read_only=True, data_only=True)["Monthly"]
    linhas = list(ws.iter_rows(values_only=True))
    cab = linhas[0]
    brasil = next(r for r in linhas if isinstance(r[1], str) and r[1].strip() == "Brazil")
    out = []
    for c, v in zip(cab, brasil):
        if v is None or not isinstance(v, (int, float)):
            continue
        if hasattr(c, "year"):
            mes = f"{c.year}-{c.month:02d}"
        elif isinstance(c, str) and re.match(r"\d{4}-\d{2}", c):
            mes = c[:7]
        else:
            continue
        out.append({"mes": mes, "eua": int(v), "preliminar": "prelim" in str(c).lower()})
    df = pd.DataFrame(out)
    df.to_csv(raw / "ntto" / "ntto_nacional.csv", index=False)
    return df


# ---------------------------------------------------------------- Supabase

def _supabase_get(tabela: str, select: str) -> list[dict]:
    base = (os.environ.get("VITE_SUPABASE_URL") or os.environ["SUPABASE_URL"]).rstrip("/")
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    out, ini = [], 0
    while True:
        url = f"{base}/rest/v1/{tabela}?select={select}&order=id&offset={ini}&limit=1000"
        lote = json.loads(_get(url, {"apikey": chave, "Authorization": f"Bearer {chave}"}))
        out += lote
        if len(lote) < 1000:
            return out
        ini += 1000


def coletar_interno(raw: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    (raw / "interno").mkdir(parents=True, exist_ok=True)
    res = pd.DataFrame(_supabase_get("reservations", CAMPOS_RESERVA))
    lojas = pd.DataFrame(_supabase_get("fleet_locations", "id,name,region"))
    res.to_csv(raw / "interno" / "reservas.csv", index=False)
    lojas.to_csv(raw / "interno" / "lojas.csv", index=False)
    return res, lojas


# ---------------------------------------------------------------- HQ (só GET)

def coletar_hq(raw: Path) -> pd.DataFrame:
    base = (os.environ.get("HQ_BASE_URL", "").strip() or "https://api-america-3.caagcrm.com/api-america-3").rstrip("/")
    tok = base64.b64encode(f'{os.environ["HQ_TENANT_TOKEN"].strip()}:{os.environ["HQ_USER_TOKEN"].strip()}'.encode()).decode()
    cab = {"Authorization": f"Basic {tok}", "Accept": "application/json"}
    linhas, pagina, ultima = [], 1, None
    while ultima is None or pagina <= ultima:
        j = json.loads(_get(f"{base}/car-rental/reservations?limit=100&page={pagina}", cab))
        ultima = j["last_page"]
        for x in j["data"]:
            loc = x.get("pick_up_location") or {}
            linhas.append({
                "reservation_id": str(x["id"]),
                "hq_created_at": x.get("created_at"),
                "hq_status": x.get("status"),
                "hq_pick_up_at": x.get("pick_up_date"),
                "pick_up_location_id": x.get("pick_up_location_id"),
                "loja_nome": loc.get("name"),
                "loja_estado": loc.get("state"),
                "loja_cidade": loc.get("city"),
            })
        pagina += 1
        time.sleep(0.15)  # o HQ limita a 1.000 chamadas por janela e outros syncs dividem a cota
    df = pd.DataFrame(linhas)
    (raw / "interno").mkdir(parents=True, exist_ok=True)
    df.to_csv(raw / "interno" / "hq_reservas.csv", index=False)
    return df


# ---------------------------------------------------------------- gravação no banco (service role)

def _supabase_req(metodo: str, caminho: str, corpo, prefer: str = "") -> None:
    base = (os.environ.get("VITE_SUPABASE_URL") or os.environ["SUPABASE_URL"]).rstrip("/")
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    cab = {**UA, "apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json"}
    if prefer:
        cab["Prefer"] = prefer
    req = urllib.request.Request(f"{base}/rest/v1/{caminho}", data=json.dumps(corpo).encode(), method=metodo, headers=cab)
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()


def gravar_ntto_banco(df: pd.DataFrame) -> int:
    """Upsert em ntto_chegadas (um registro por mês). Preliminar é sobrescrito quando o final chega."""
    linhas = []
    for x in df.to_dict("records"):
        def inteiro(v):
            return None if pd.isna(v) else int(v)
        linhas.append({"mes": f"{x['mes']}-01", "eua": inteiro(x["eua"]), "florida": inteiro(x["florida"]),
                       "orlando": inteiro(x["orlando"]), "miami": inteiro(x["miami"]),
                       "fort_lauderdale": inteiro(x.get("fort_lauderdale")),
                       "preliminar": bool(x["preliminar"]), "fonte": x.get("fonte"),
                       "updated_at": pd.Timestamp.utcnow().isoformat()})
    _supabase_req("POST", "ntto_chegadas?on_conflict=mes", linhas, "resolution=merge-duplicates,return=minimal")
    return len(linhas)


def preencher_lojas(hq: pd.DataFrame) -> int:
    """Preenche reservations.pick_up_location_id a partir do HQ, só onde ainda está vazio
    (o sync passa a gravar a loja nas reservas novas e alteradas)."""
    h = hq.dropna(subset=["pick_up_location_id"])
    total = 0
    for loja, grp in h.groupby(h["pick_up_location_id"].astype(int)):
        ids = grp["reservation_id"].astype(str).tolist()
        for i in range(0, len(ids), 200):
            lote = ",".join(ids[i:i + 200])
            _supabase_req("PATCH", f"reservations?reservation_id=in.({lote})&pick_up_location_id=is.null",
                          {"pick_up_location_id": int(loja)}, "return=minimal")
        total += len(ids)
    return total
