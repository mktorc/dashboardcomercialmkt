#!/usr/bin/env python3
"""
Importa a exportação de leads do Kommo (.xlsx) para public.crm_leads, com lead_id = "kommo-<ID>".

Uso:
  python3 -I scripts/import-kommo-xlsx.py ARQUIVO.xlsx --dry-run            # só valida e conta, não grava
  python3 -I scripts/import-kommo-xlsx.py ARQUIVO.xlsx --limit 300          # grava só 300 leads (teste)
  python3 -I scripts/import-kommo-xlsx.py ARQUIVO.xlsx                      # carga completa

Lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env.local. Só biblioteca padrão do Python.
É idempotente: usa upsert por lead_id (rodar de novo atualiza, não duplica).
"""
import sys, os, json, time, zipfile, argparse, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

CUTOFF = (2026, 6)                 # só leads criados ANTES de jun/2026 (depois disso o ClickMassa assume)
TZ = timezone(timedelta(hours=-3))  # horário da exportação (Brasília)
BATCH = 500

# Colunas da exportação do Kommo
COLS = {
    "A": "id", "B": "title", "F": "seller", "G": "stage", "J": "created", "L": "modified",
    "W": "origem", "CJ": "utm_medium", "CK": "utm_campaign", "CL": "utm_source",
    "CT": "email", "CW": "phone",
}
# O app procura a etapa exata "Ganho" para os ganhos do Kommo.
WON_STAGES = {"venda ganha", "closed - won"}

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def load_env(path):
    env = {}
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def rows(xlsx):
    # Lê a aba de um arquivo extraído no disco: ler direto de dentro do .xlsx (stream do zip)
    # mostrou erros intermitentes de XML neste computador; do disco leva ~15 s e é estável.
    import tempfile
    z = zipfile.ZipFile(xlsx)
    sst = []
    if 'xl/sharedStrings.xml' in z.namelist():
        sst = [''.join(t.text or '' for t in si.iter(M + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]

    def val(c):
        t = c.get('t')
        if t == 's':
            v = c.find(M + 'v')
            return sst[int(v.text)] if v is not None else ''
        if t == 'inlineStr':
            return ''.join(x.text or '' for x in c.iter(M + 't'))
        v = c.find(M + 'v')
        return v.text if v is not None else ''

    with tempfile.TemporaryDirectory() as tmp:
        sheet = z.extract('xl/worksheets/sheet1.xml', tmp)
        first = True
        for _, el in ET.iterparse(sheet, events=('end',)):
            if el.tag != M + 'row':
                continue
            row = {}
            for c in el.findall(M + 'c'):
                col = c.get('r').rstrip('0123456789')
                if col in COLS:
                    row[COLS[col]] = (val(c) or '').strip()
            el.clear()
            if first:
                first = False
                continue
            yield row


def parse_date(s):
    d = datetime.strptime(s, "%d.%m.%Y %H:%M:%S").replace(tzinfo=TZ)
    return d.astimezone(timezone.utc)


def to_record(r):
    created = parse_date(r["created"])
    if (created.year, created.month) >= CUTOFF:
        return None
    modified = parse_date(r["modified"]) if r.get("modified") else created
    stage = r.get("stage") or None
    if stage and stage.lower() in WON_STAGES:
        stage = "Ganho"
    origem = r.get("origem") or None
    return {
        "lead_id": "kommo-" + r["id"],
        "name": r.get("title") or None,
        "email": r.get("email") or None,
        "phone": r.get("phone") or None,
        "stage_name": stage,
        "seller_name": r.get("seller") or None,
        "utm_source": r.get("utm_source") or origem,
        "utm_medium": r.get("utm_medium") or None,
        "utm_campaign": r.get("utm_campaign") or None,
        "lead_origin": origem,
        "created_at": created.isoformat(),
        "updated_at": modified.isoformat(),
    }


def upsert(url, key, batch):
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/crm_leads?on_conflict=lead_id",
        data=json.dumps(batch).encode(),
        headers={
            "apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120):
                return
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"Erro do Supabase {e.code}: {body}")
        except Exception as e:  # rede
            if attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"Falha de rede: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    env = load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local"))
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not a.dry_run and not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env.local")

    seen = skipped = bad = sent = 0
    ganho = 0
    batch = []
    by_origin, by_year = {}, {}
    for r in rows(a.xlsx):
        seen += 1
        try:
            rec = to_record(r)
        except Exception:
            bad += 1
            continue
        if rec is None:
            skipped += 1
            continue
        if rec["stage_name"] == "Ganho":
            ganho += 1
        by_origin[rec["lead_origin"] or "(vazio)"] = by_origin.get(rec["lead_origin"] or "(vazio)", 0) + 1
        by_year[rec["created_at"][:4]] = by_year.get(rec["created_at"][:4], 0) + 1
        batch.append(rec)
        if len(batch) >= BATCH:
            if not a.dry_run:
                upsert(url, key, batch)
            sent += len(batch)
            batch = []
            if sent % 5000 == 0:
                print(f"  {sent} leads processados...", flush=True)
        if a.limit and sent + len(batch) >= a.limit:
            break
    if batch:
        if a.limit:
            batch = batch[: max(0, a.limit - sent)]
        if not a.dry_run:
            upsert(url, key, batch)
        sent += len(batch)

    print("\nResumo")
    print("  linhas lidas:", seen)
    print("  ignoradas (criadas a partir de jun/2026):", skipped)
    print("  com data inválida:", bad)
    print("  " + ("simulados (dry-run)" if a.dry_run else "gravados") + ":", sent)
    print("  etapa 'Ganho' (após o mapeamento):", ganho)
    print("  por ano:", dict(sorted(by_year.items())))
    print("  origens (top 6):", sorted(by_origin.items(), key=lambda x: -x[1])[:6])


if __name__ == "__main__":
    main()
