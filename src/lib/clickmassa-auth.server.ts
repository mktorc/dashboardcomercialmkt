// Token para a API do ClickMassa.
// Desde 17/11/2026 o ClickMassa só aceita token de USUÁRIO em /opportunity, /lead-origin etc.
// (tokens de integração "API Push" passaram a dar 403 "Invalid token."). O token de usuário
// expira em ~8h, então fazemos login a cada execução com um usuário dedicado à integração
// (CLICKMASSA_EMAIL / CLICKMASSA_PASSWORD, sem MFA). Sem essas variáveis, cai no token fixo
// antigo (CLICKMASSA_API_TOKEN / CLICKMASSA_API_KEY).

export function clickMassaBase(): string {
  return (process.env["CLICKMASSA_BASE_URL"] ?? "").replace(/\/$/, "");
}

export function clickMassaConfigured(): boolean {
  return (
    !!clickMassaBase() &&
    !!(
      (process.env["CLICKMASSA_EMAIL"] && process.env["CLICKMASSA_PASSWORD"]) ||
      process.env["CLICKMASSA_API_TOKEN"] ||
      process.env["CLICKMASSA_API_KEY"]
    )
  );
}

/** Retorna o token, ou lança Error com o motivo (login recusado, MFA ligado, sem config). */
export async function getClickMassaToken(): Promise<string> {
  const base = clickMassaBase();
  const email = process.env["CLICKMASSA_EMAIL"];
  const password = process.env["CLICKMASSA_PASSWORD"];
  if (base && email && password) {
    const r = await fetch(`${base}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok)
      throw new Error(`Login no ClickMassa falhou (HTTP ${r.status}): ${JSON.stringify(body)}`);
    if (body["mfaRequired"] === true)
      throw new Error("Login no ClickMassa exige MFA: desative o MFA do usuário da integração");
    if (typeof body["token"] !== "string" || !body["token"])
      throw new Error("Login no ClickMassa não devolveu token");
    return body["token"];
  }
  const fixed = process.env["CLICKMASSA_API_TOKEN"] || process.env["CLICKMASSA_API_KEY"];
  if (base && fixed) return fixed;
  throw new Error("ClickMassa não configurado");
}
