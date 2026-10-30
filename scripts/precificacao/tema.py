"""Identidade visual Orlando Rent Car para o relatório HTML (espelha src/styles.css)."""
import base64
from math import cos, sin, radians
from pathlib import Path

LOGO = Path("public/logo-orc.png")


def oklch(l, c, h):
    a, b = c * cos(radians(h)), c * sin(radians(h))
    l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
           -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
           -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    g = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return "#" + "".join(f"{round(min(1, max(0, g(x))) * 255):02x}" for x in rgb)


# Mesmos tokens do tema escuro oficial (src/styles.css :root)
CORES = {
    "bg": oklch(0.18, 0.022, 156), "card": oklch(0.22, 0.03, 155), "fg": oklch(0.97, 0.012, 150),
    "muted": oklch(0.74, 0.03, 150), "border": oklch(0.34, 0.045, 155), "primary": oklch(0.42, 0.115, 152),
    "accent": oklch(0.85, 0.27, 135), "danger": oklch(0.62, 0.21, 25),
    "brand_dark": "#005c29", "brand_vivid": "#44e500",
}
# Paleta de gráficos (chart-1..5)
SERIES = [oklch(0.85, 0.27, 135), oklch(0.55, 0.13, 152), oklch(0.78, 0.16, 95), oklch(0.70, 0.13, 200), oklch(0.65, 0.18, 30)]
# Sazonalidade: do mais quente ao mais frio, mantendo a paleta da marca
SAZONALIDADE = {"Altíssima": "#44e500", "Alta": "#2fb34a", "Média": oklch(0.78, 0.16, 95), "Baixa": oklch(0.70, 0.13, 200), "Baixíssima": "#5b6b76"}


def css() -> str:
    c = CORES
    return f"""
:root{{--bg:{c['bg']};--card:{c['card']};--fg:{c['fg']};--muted:{c['muted']};--border:{c['border']};--primary:{c['primary']};
--accent:{c['accent']};--danger:{c['danger']};--brand-dark:{c['brand_dark']};--brand-vivid:{c['brand_vivid']};--radius:12px}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
header.topo{{background:linear-gradient(135deg,#005c29 0%,#0b130e 100%);border-bottom:1px solid var(--border);padding:28px 16px}}
.wrap{{max-width:1120px;margin:0 auto;padding:0 16px}}
.marca{{display:flex;align-items:center;gap:16px}}.marca img{{width:56px;height:56px;border-radius:12px}}
.marca h1{{margin:0;font-size:1.5rem}}.marca p{{margin:2px 0 0;color:var(--muted)}}
nav.indice{{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--border);overflow-x:auto;white-space:nowrap}}
nav.indice a{{display:inline-block;padding:12px 14px;color:var(--muted);text-decoration:none;font-size:.9rem}}
nav.indice a:hover{{color:var(--accent)}}
section{{padding:32px 0 8px}}h2{{margin:0 0 4px;font-size:1.3rem;color:var(--accent)}}h3{{margin:24px 0 8px;font-size:1.05rem}}
.sub{{color:var(--muted);margin:0 0 16px}}
.card{{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin:12px 0}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}}
.kpis .card{{margin:0}}.kpi b{{display:block;font-size:1.6rem;color:var(--brand-vivid)}}.kpi span{{color:var(--muted);font-size:.85rem}}
.aviso{{border-left:4px solid var(--accent);background:color-mix(in oklab,var(--card) 85%,var(--brand-vivid) 15%)}}
.alerta{{border-left:4px solid var(--danger)}}
table{{width:100%;border-collapse:collapse;font-size:.88rem;font-variant-numeric:tabular-nums}}
th{{text-align:left;color:var(--accent);border-bottom:2px solid var(--border);padding:8px 10px;white-space:nowrap}}
td{{padding:7px 10px;border-bottom:1px solid var(--border)}}tr:hover td{{background:color-mix(in oklab,var(--card) 90%,var(--brand-vivid) 10%)}}
td.n,th.n{{text-align:right}}.fraca{{color:var(--muted);font-style:italic}}
.tabela{{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius)}}
.tag{{display:inline-block;padding:1px 8px;border-radius:99px;font-size:.78rem;color:#0b130e;font-weight:600}}
svg text{{fill:var(--muted);font-size:11px}}.grafico{{width:100%;height:auto}}
footer{{color:var(--muted);font-size:.8rem;padding:32px 0;border-top:1px solid var(--border);margin-top:40px}}
details.item{{border:1px solid var(--border);border-radius:var(--radius);margin:12px 0;background:color-mix(in oklab,var(--card) 70%,var(--bg) 30%)}}
details.item>summary{{cursor:pointer;list-style:none;padding:12px 14px;font-weight:600;display:flex;gap:10px;align-items:center;min-height:44px}}
details.item>summary::-webkit-details-marker{{display:none}}
details.item>summary::before{{content:"▸";color:var(--accent);transition:transform .15s;flex:none}}
details.item[open]>summary::before{{transform:rotate(90deg)}}
details.item>summary:hover{{color:var(--accent)}}
details.item>.corpo{{padding:0 14px 14px}}
details.analise{{border-color:var(--brand-vivid)}}details.analise>summary{{color:var(--accent);font-size:1.05rem}}
.corpo>.sub:first-child{{margin-top:0}}
.analise h4{{margin:20px 0 6px;color:var(--accent);font-size:.98rem}}.analise p{{margin:6px 0}}.analise ul{{margin:6px 0;padding-left:20px}}.analise li{{margin:4px 0}}
.analise .tabela,.corpo .tabela{{margin:10px 0}}
.grafwrap{{overflow-x:auto;-webkit-overflow-scrolling:touch}}svg.grafico{{min-width:540px}}
.tabela{{-webkit-overflow-scrolling:touch}}img,svg{{max-width:100%}}
.nota-data{{color:var(--muted);font-size:.8rem;margin:0 0 8px}}
@media(max-width:720px){{
body{{font-size:14px}}header.topo{{padding:18px 8px}}.wrap{{padding:0 10px}}h2{{font-size:1.15rem}}h3{{font-size:1rem}}
.marca{{gap:10px}}.marca img{{width:44px;height:44px}}.marca h1{{font-size:1.15rem}}.marca p{{font-size:.85rem}}
.kpis{{grid-template-columns:repeat(2,minmax(0,1fr))}}.kpi b{{font-size:1.25rem}}
th,td{{padding:6px 8px;font-size:.8rem}}nav.indice a{{padding:10px}}
details.item>summary{{padding:10px 12px}}details.item>.corpo{{padding:0 10px 12px}}.card{{padding:12px}}
.tabela table{{min-width:max(100%,calc(var(--cols,6)*96px))}}
}}
@media print{{nav.indice{{display:none}}body{{background:#fff;color:#111}}}}
"""


def logo_base64() -> str:
    return base64.b64encode(LOGO.read_bytes()).decode()


def pagina(titulo: str, subtitulo: str, secoes: list[tuple[str, str, str]], rodape: str = "") -> str:
    """secoes = [(id, titulo, html)] -> HTML único, com CSS e logo embutidos."""
    indice = "".join(f'<a href="#{i}">{t}</a>' for i, t, _ in secoes)
    corpo = "".join(f'<section id="{i}"><h2>{t}</h2>{h}</section>' for i, t, h in secoes)
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{titulo}</title><link rel="icon" href="data:image/png;base64,{logo_base64()}"><style>{css()}</style></head><body>
<header class="topo"><div class="wrap marca"><img alt="Orlando Rent Car" src="data:image/png;base64,{logo_base64()}"><div><h1>{titulo}</h1><p>{subtitulo}</p></div></div></header>
<nav class="indice"><div class="wrap">{indice}</div></nav><main class="wrap">{corpo}</main>
<footer><div class="wrap">{rodape}</div></footer></body></html>"""
