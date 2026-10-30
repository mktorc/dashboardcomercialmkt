"""Cliente HQ Rentals somente leitura (GET). Credenciais só de variáveis de ambiente."""
import base64, json, os, time, urllib.request, urllib.error
from pathlib import Path


def carregar_env(caminho=".env.local"):
    p = Path(caminho)
    if p.exists():
        for linha in p.read_text().splitlines():
            if "=" in linha and not linha.lstrip().startswith("#"):
                k, v = linha.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class HQ:
    def __init__(self):
        carregar_env()
        try:
            self.base = os.environ["HQ_BASE_URL"].rstrip("/")
            tok = f'{os.environ["HQ_TENANT_TOKEN"].strip()}:{os.environ["HQ_USER_TOKEN"].strip()}'
        except KeyError as e:
            raise SystemExit(f"Variável de ambiente ausente: {e}")
        self.auth = base64.b64encode(tok.encode()).decode()
        self.chamadas = 0

    def get(self, caminho, tentativas=5):
        url = f"{self.base}/{caminho}"
        for t in range(tentativas):
            req = urllib.request.Request(url, headers={"Authorization": f"Basic {self.auth}", "Accept": "application/json"}, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    restante = r.headers.get("X-RateLimit-Remaining")
                    corpo = json.loads(r.read())
                self.chamadas += 1
                if restante is not None and int(restante) < 20:
                    time.sleep(60)  # perto do limite de 1000: espera a janela renovar
                time.sleep(0.1)
                if isinstance(corpo, dict) and corpo.get("success") is False and corpo.get("status_code") not in (404, None):
                    raise RuntimeError(f"API success=false em {caminho}: {corpo.get('message')}")
                return corpo
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code in (429, 500, 502, 503, 504) and t < tentativas - 1:
                    time.sleep(min(60, 2 ** (t + 2)))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if t == tentativas - 1:
                    raise
                time.sleep(2 ** (t + 1))
