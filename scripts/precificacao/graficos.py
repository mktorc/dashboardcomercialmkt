"""Gráficos SVG embutidos (sem dependências), na paleta da marca."""
from html import escape
from tema import SERIES, CORES


def _fmt(v, dec=0):
    return f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def barras(titulo, categorias, series, formato=lambda v: _fmt(v, 1), largura=760, altura=300, nomes=None):
    """series: lista de listas (uma por série), valores alinhados a `categorias` (None = vazio)."""
    margem_e, margem_b, margem_t = 54, 58, 28
    vals = [v for s in series for v in s if v is not None]
    if not vals:
        return ""
    topo = max(vals) * 1.1 or 1
    area_w, area_h = largura - margem_e - 12, altura - margem_b - margem_t
    n, k = len(categorias), len(series)
    grupo = area_w / max(n, 1)
    larg = min(26, grupo * 0.8 / k)
    o = [f'<svg class="grafico" viewBox="0 0 {largura} {altura}" role="img" aria-label="{escape(titulo)}">',
         f'<text x="{margem_e}" y="16" style="fill:{CORES["fg"]};font-size:13px;font-weight:600">{escape(titulo)}</text>']
    for i in range(5):
        y = margem_t + area_h - area_h * i / 4
        o.append(f'<line x1="{margem_e}" x2="{largura-12}" y1="{y:.1f}" y2="{y:.1f}" stroke="{CORES["border"]}" stroke-width="1"/>')
        o.append(f'<text x="{margem_e-6}" y="{y+4:.1f}" text-anchor="end">{formato(topo*i/4)}</text>')
    for ci, cat in enumerate(categorias):
        x0 = margem_e + ci * grupo + (grupo - larg * k) / 2
        for si, serie in enumerate(series):
            v = serie[ci]
            if v is None:
                continue
            h = area_h * v / topo
            o.append(f'<rect x="{x0+si*larg:.1f}" y="{margem_t+area_h-h:.1f}" width="{larg-2:.1f}" height="{h:.1f}" rx="2" fill="{SERIES[si%5]}"><title>{escape(str(cat))}: {formato(v)}</title></rect>')
        o.append(f'<text x="{margem_e+ci*grupo+grupo/2:.1f}" y="{altura-margem_b+16}" text-anchor="middle">{escape(str(cat))[:14]}</text>')
    if nomes:
        for si, nm in enumerate(nomes):
            o.append(f'<rect x="{margem_e+si*130}" y="{altura-14}" width="10" height="10" rx="2" fill="{SERIES[si%5]}"/><text x="{margem_e+si*130+14}" y="{altura-5}">{escape(nm)}</text>')
    o.append("</svg>")
    return "".join(o)


def linhas(titulo, xs, series, nomes, formato=lambda v: _fmt(v, 1), largura=760, altura=300, cores=None):
    margem_e, margem_b, margem_t = 54, 58, 28
    vals = [v for s in series for v in s if v is not None]
    if not vals:
        return ""
    lo, hi = min(0, min(vals)), max(vals) * 1.08 or 1
    area_w, area_h = largura - margem_e - 14, altura - margem_b - margem_t
    n = max(len(xs) - 1, 1)
    X = lambda i: margem_e + area_w * i / n
    Y = lambda v: margem_t + area_h - area_h * (v - lo) / ((hi - lo) or 1)
    o = [f'<svg class="grafico" viewBox="0 0 {largura} {altura}" role="img" aria-label="{escape(titulo)}">',
         f'<text x="{margem_e}" y="16" style="fill:{CORES["fg"]};font-size:13px;font-weight:600">{escape(titulo)}</text>']
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        o.append(f'<line x1="{margem_e}" x2="{largura-14}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{CORES["border"]}"/>')
        o.append(f'<text x="{margem_e-6}" y="{Y(v)+4:.1f}" text-anchor="end">{formato(v)}</text>')
    passo = max(1, len(xs) // 12)
    for i, x in enumerate(xs):
        if i % passo == 0:
            o.append(f'<text x="{X(i):.1f}" y="{altura-margem_b+16}" text-anchor="middle">{escape(str(x))}</text>')
    for si, serie in enumerate(series):
        cor = (cores or SERIES)[si % len(cores or SERIES)]
        pts = [(X(i), Y(v)) for i, v in enumerate(serie) if v is not None]
        if len(pts) > 1:
            o.append(f'<polyline fill="none" stroke="{cor}" stroke-width="2.2" points="{" ".join(f"{a:.1f},{b:.1f}" for a, b in pts)}"/>')
        for i, v in enumerate(serie):
            if v is not None and len(xs) <= 40:
                o.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="2.6" fill="{cor}"><title>{escape(nomes[si])} · {escape(str(xs[i]))}: {formato(v)}</title></circle>')
        o.append(f'<rect x="{margem_e+si*140}" y="{altura-14}" width="10" height="10" rx="2" fill="{cor}"/><text x="{margem_e+si*140+14}" y="{altura-5}">{escape(nomes[si])}</text>')
    o.append("</svg>")
    return "".join(o)


def _cor_calor(v):
    """0..1 -> do fundo verde escuro ao verde vivo da marca."""
    v = max(0.0, min(1.0, v))
    a, b = (15, 31, 20), (68, 229, 0)
    return "#%02x%02x%02x" % tuple(round(a[i] + (b[i] - a[i]) * v) for i in range(3))


def calor(titulo, linhas_rot, colunas_rot, matriz, largura=760):
    """matriz[l][c] em 0..1 ou None."""
    celula, margem_e, margem_t = (largura - 70) / max(len(colunas_rot), 1), 62, 34
    altura = margem_t + 18 * len(linhas_rot) + 16
    o = [f'<svg class="grafico" viewBox="0 0 {largura} {altura}" role="img" aria-label="{escape(titulo)}">',
         f'<text x="{margem_e}" y="14" style="fill:{CORES["fg"]};font-size:13px;font-weight:600">{escape(titulo)}</text>']
    for c, cr in enumerate(colunas_rot):
        if c % 2 == 0:
            o.append(f'<text x="{margem_e+c*celula+celula/2:.1f}" y="{margem_t-6}" text-anchor="middle" style="font-size:9px">{escape(str(cr))}</text>')
    for l, lr in enumerate(linhas_rot):
        y = margem_t + 18 * l
        o.append(f'<text x="{margem_e-6}" y="{y+12}" text-anchor="end" style="font-size:10px">{escape(str(lr))}</text>')
        for c, v in enumerate(matriz[l]):
            if v is None:
                continue
            o.append(f'<rect x="{margem_e+c*celula:.1f}" y="{y}" width="{celula-1:.1f}" height="16" rx="2" fill="{_cor_calor(v)}"><title>{escape(str(lr))} dia {colunas_rot[c]}: {v*100:.0f}%</title></rect>')
    o.append("</svg>")
    return "".join(o)
