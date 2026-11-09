"""Importa coletas de preços de concorrentes (planilha CSV) para competitor_price_snapshots. Só inserção: nunca altera coletas anteriores.

Uso:
  python3 -I scripts/precificacao/concorrencia.py modelo                      # grava o modelo em data/precificacao/modelo_concorrencia.csv
  python3 -I scripts/precificacao/concorrencia.py importar arquivo.csv        # valida e mostra o resumo (nada é gravado)
  python3 -I scripts/precificacao/concorrencia.py importar arquivo.csv --gravar [--local Orlando]
Requer SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local) e a migração 0058.
Regras: categoria da planilha deve ser uma das nossas (a lista vem da Gestão de Ocupação); preço vazio/zero/indisponível nunca vira 0;
equivalência vazia = "nao_avaliada" (nunca se presume "equivalente"); linhas inválidas são recusadas com o motivo e as demais seguem.
"""
import csv, json, os, sys, urllib.parse, urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

COLUNAS = ["concorrente", "fonte", "url", "categoria", "categoria_concorrente", "coletado_em", "retirada", "devolucao",
           "preco_total", "preco_diaria", "moeda", "impostos_incluidos", "protecoes", "quilometragem", "cancelamento",
           "pagamento", "disponivel", "equivalencia", "observacao_equivalencia"]
EQUIV = {"equivalente", "parcial", "nao_equivalente", "nao_avaliada"}
MODELO = Path("data/precificacao/modelo_concorrencia.csv")


def numero(v):
    v = (v or "").strip().replace("R$", "").replace(" ", "")
    if not v:
        return None
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    return float(v)


def booleano(v):
    v = (v or "").strip().lower()
    if v in ("", "?"):
        return None
    if v in ("sim", "s", "true", "1"):
        return True
    if v in ("nao", "não", "n", "false", "0"):
        return False
    raise ValueError(f"valor sim/não inválido: {v!r}")


def data_hora(v):
    v = (v or "").strip()
    for f in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(v, f)
        except ValueError:
            pass
    raise ValueError(f"data e hora inválida: {v!r} (use AAAA-MM-DD HH:MM)")


def valida_linha(ln, categorias, local):
    """Devolve a linha pronta para o banco ou levanta ValueError com o motivo."""
    nome = (ln.get("concorrente") or "").strip()
    if not nome:
        raise ValueError("concorrente vazio")
    if not (ln.get("fonte") or "").strip():
        raise ValueError("fonte vazia")
    cat = (ln.get("categoria") or "").strip()
    if cat not in categorias:
        raise ValueError(f"categoria {cat!r} não é uma das nossas ({', '.join(sorted(categorias))})")
    ret, dev, col = data_hora(ln.get("retirada")), data_hora(ln.get("devolucao")), data_hora(ln.get("coletado_em"))
    if dev <= ret:
        raise ValueError("devolução não é depois da retirada")
    total, diaria = numero(ln.get("preco_total")), numero(ln.get("preco_diaria"))
    disponivel = booleano(ln.get("disponivel"))
    if disponivel is not False and total is None and diaria is None:
        raise ValueError("sem preço e não marcada como indisponível")
    if (total is not None and total <= 0) or (diaria is not None and diaria <= 0):
        raise ValueError("preço zero ou negativo (ausência de preço deve ficar em branco)")
    if disponivel is False:
        total = diaria = None  # indisponível não tem preço
    eq = (ln.get("equivalencia") or "").strip().lower() or "nao_avaliada"
    if eq not in EQUIV:
        raise ValueError(f"equivalência inválida: {eq!r}")
    moeda = (ln.get("moeda") or "").strip().upper()
    if not moeda:
        raise ValueError("moeda vazia (informe USD ou BRL: só se compara na mesma moeda da nossa tarifa)")
    return dict(
        _concorrente=nome, source=ln["fonte"].strip(), source_url=(ln.get("url") or "").strip() or None, location=local,
        source_category=(ln.get("categoria_concorrente") or "").strip() or None, normalized_category=cat,
        collected_at=col.isoformat(), pickup_at=ret.isoformat(), return_at=dev.isoformat(),
        total_price=total, daily_price=diaria, currency=moeda, taxes_included=booleano(ln.get("impostos_incluidos")),
        protections=(ln.get("protecoes") or "").strip() or None, mileage=(ln.get("quilometragem") or "").strip() or None,
        cancellation_policy=(ln.get("cancelamento") or "").strip() or None,
        payment_conditions=(ln.get("pagamento") or "").strip() or None, available=disponivel, equivalence=eq,
        equivalence_notes=(ln.get("observacao_equivalencia") or "").strip() or None)


def le_planilha(caminho, categorias, local):
    ok, erros = [], []
    with open(caminho, newline="", encoding="utf-8-sig") as f:
        leitor = csv.DictReader(f)
        faltam = [c for c in COLUNAS[:9] if c not in (leitor.fieldnames or [])]
        if faltam:
            raise SystemExit(f"Colunas ausentes: {', '.join(faltam)}. Rode o comando modelo.")
        for i, ln in enumerate(leitor, start=2):
            try:
                ok.append(valida_linha(ln, categorias, local))
            except ValueError as e:
                erros.append((i, str(e)))
    return ok, erros


def chamar(metodo, caminho, corpo=None, extra=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + caminho
    k = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    cab = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json", **(extra or {})}
    req = urllib.request.Request(url, data=json.dumps(corpo).encode() if corpo is not None else None, headers=cab, method=metodo)
    with urllib.request.urlopen(req, timeout=120) as r:
        t = r.read()
        return json.loads(t) if t else None


def nossas_categorias():
    r = chamar("GET", "pricing_occupancy_pace?select=payload&order=generated_at.desc&limit=1")
    if not r:
        raise SystemExit("Sem a lista de categorias publicada (rode ritmo.py --publicar).")
    return set(r[0]["payload"]["categorias"])


def importar(caminho, gravar, local):
    from hq import carregar_env
    carregar_env()
    cats = nossas_categorias()
    ok, erros = le_planilha(caminho, cats, local)
    print(f"{len(ok)} linhas válidas, {len(erros)} recusadas.")
    for i, motivo in erros[:30]:
        print(f"  linha {i}: {motivo}")
    if not gravar:
        print("Nada gravado (use --gravar).")
        return
    if not ok:
        return
    existentes = {c["name"]: c["id"] for c in chamar("GET", "competitors?select=id,name")}
    for nome in sorted({r["_concorrente"] for r in ok} - set(existentes)):
        novo = chamar("POST", "competitors", {"name": nome}, {"Prefer": "return=representation"})
        existentes[nome] = novo[0]["id"]
    # Evita duplicar ao reimportar o mesmo arquivo: chave concorrente + coleta + retirada + devolução + categoria + fonte.
    chaves = set()
    for cid in {existentes[r["_concorrente"]] for r in ok}:
        for e in chamar("GET", f"competitor_price_snapshots?select=collected_at,pickup_at,return_at,normalized_category,source&competitor_id=eq.{cid}&limit=100000"):
            chaves.add((cid, e["collected_at"][:16], e["pickup_at"][:16], e["return_at"][:16], e["normalized_category"], e["source"]))
    novas = []
    for r in ok:
        cid = existentes[r.pop("_concorrente")]
        chave = (cid, r["collected_at"][:16], r["pickup_at"][:16], r["return_at"][:16], r["normalized_category"], r["source"])
        if chave not in chaves:
            novas.append({**r, "competitor_id": cid})
    for i in range(0, len(novas), 500):
        chamar("POST", "competitor_price_snapshots", novas[i:i + 500], {"Prefer": "return=minimal"})
    print(f"Gravadas {len(novas)} coletas novas ({len(ok) - len(novas)} já existiam).")


def modelo():
    MODELO.parent.mkdir(parents=True, exist_ok=True)
    with open(MODELO, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(COLUNAS)
        w.writerow(["(exemplo: apague)", "cotação manual", "", "Midsize Suv", "SUV Intermediário", "2026-11-09 10:00",
                    "2026-12-20 10:00", "2026-12-25 10:00", "", "", "USD", "sim", "básica", "ilimitada", "grátis até 24h",
                    "no balcão", "sim", "", ""])
    print(f"Modelo gravado em {MODELO}. Datas AAAA-MM-DD HH:MM; preço em branco = sem preço (nunca 0); equivalência em branco = não avaliada.")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["modelo"]:
        modelo()
    elif a[:1] == ["importar"] and len(a) >= 2:
        loc = a[a.index("--local") + 1] if "--local" in a else "Orlando"
        importar(a[1], "--gravar" in a, loc)
    else:
        raise SystemExit(__doc__)
