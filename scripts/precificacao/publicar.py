"""Publica o relatório HTML no Supabase do projeto (tabela pricing_study_report, legível só por marketing@orlandorentcar.com).

Uso: python3 scripts/precificacao/publicar.py
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (.env.local). A tabela vem da migração 0042.
Só envia o HTML agregado (sem dados pessoais). Mantém os 5 relatórios mais recentes.
"""
import json, sys, urllib.error, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hq import carregar_env
import os

carregar_env()
HTML = Path("data/precificacao/relatorio/relatorio.html")


def chamar(metodo, caminho, corpo=None, extra=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + caminho
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    cab = {"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json", **(extra or {})}
    req = urllib.request.Request(url, data=json.dumps(corpo).encode() if corpo is not None else None, headers=cab, method=metodo)
    with urllib.request.urlopen(req, timeout=120) as r:
        t = r.read()
        return json.loads(t) if t else None


if __name__ == "__main__":
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not os.environ.get(k):
            raise SystemExit(f"Variável de ambiente ausente: {k}")
    if not HTML.exists():
        raise SystemExit("Rode analisar.py antes de publicar.")
    try:
        chamar("GET", "pricing_study_report?select=id&limit=1")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Tabela pricing_study_report indisponível (HTTP {e.code}). Aplique a migração 0042 e tente de novo.")
    periodo = json.loads((HTML.parent / "periodo.json").read_text())  # período real analisado (o corte pode ser anterior a hoje)
    chamar("POST", "pricing_study_report", {"period_start": periodo["inicio"], "period_end": periodo["fim"], "html": HTML.read_text(encoding="utf-8")}, {"Prefer": "return=minimal"})
    antigos = chamar("GET", "pricing_study_report?select=id&order=generated_at.desc&offset=5")
    for r in antigos or []:
        chamar("DELETE", f"pricing_study_report?id=eq.{r['id']}")
    print("Relatório publicado.")
