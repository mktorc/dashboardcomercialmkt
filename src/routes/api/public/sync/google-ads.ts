import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";
import { recordSyncRun } from "@/lib/sync-runs";

// Sincronização Google Ads (REST + GAQL) -> tabela `google_ads_metrics`.
// Proteção: Authorization: Bearer <segredo cron>. Query opcional: ?days=30

type Obj = Record<string, unknown>;
const GATEWAY = "https://connector-gateway.lovable.dev/google_ads";
const DIRECT = "https://googleads.googleapis.com";

// Modo direto (fora do Lovable): OAuth com refresh token + developer token da API do Google Ads.
// Modo gateway (legado do Lovable): LOVABLE_API_KEY + GOOGLE_ADS_API_KEY.
async function googleAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`OAuth Google: ${j.error ?? r.status} ${j.error_description ?? ""}`.trim());
  return j.access_token;
}

export const Route = createFileRoute("/api/public/sync/google-ads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const env = (k: string) => process.env[k]?.trim() || undefined;
        const customer = env("GOOGLE_ADS_CUSTOMER_ID")?.replace(/-/g, "");
        const devToken = env("GOOGLE_ADS_DEVELOPER_TOKEN");
        const clientId = env("GOOGLE_ADS_CLIENT_ID");
        const clientSecret = env("GOOGLE_ADS_CLIENT_SECRET");
        const refreshToken = env("GOOGLE_ADS_REFRESH_TOKEN");
        const loginCustomer = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID")?.replace(/-/g, "");
        const version = env("GOOGLE_ADS_API_VERSION") ?? "v25";
        const lovableKey = env("LOVABLE_API_KEY");
        const connKey = env("GOOGLE_ADS_API_KEY");
        const direct = Boolean(devToken && clientId && clientSecret && refreshToken);
        if (!customer || (!direct && !(lovableKey && connKey))) {
          const missing = [
            !customer && "GOOGLE_ADS_CUSTOMER_ID",
            !devToken && "GOOGLE_ADS_DEVELOPER_TOKEN",
            !clientId && "GOOGLE_ADS_CLIENT_ID",
            !clientSecret && "GOOGLE_ADS_CLIENT_SECRET",
            !refreshToken && "GOOGLE_ADS_REFRESH_TOKEN",
          ].filter(Boolean);
          return Response.json({ error: "Google Ads não configurado", faltando: missing }, { status: 500 });
        }
        const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const until = new Date();
        const since = new Date(Date.now() - (days - 1) * 86400000);

        try {
          const query = `SELECT segments.date, campaign.id, campaign.name, campaign.tracking_url_template, campaign.final_url_suffix, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${d(since)}' AND '${d(until)}'`;
          const rows: Obj[] = [];
          const accessToken = direct ? await googleAccessToken(clientId!, clientSecret!, refreshToken!) : null;
          const endpoint = direct
            ? `${DIRECT}/${version}/customers/${customer}/googleAds:search`
            : `${GATEWAY}/${version}/customers/${customer}/googleAds:search`;
          const headers: Record<string, string> = direct
            ? {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": devToken!,
                ...(loginCustomer ? { "login-customer-id": loginCustomer } : {}),
                "Content-Type": "application/json",
              }
            : {
                Authorization: `Bearer ${lovableKey}`,
                "X-Connection-Api-Key": connKey!,
                "Content-Type": "application/json",
              };
          let pageToken: string | undefined;
          do {
            const r = await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ query, pageToken }),
            });
            const text = await r.text();
            if (!r.ok) return Response.json({ error: `Google Ads ${r.status}: ${text}` }, { status: 502 });
            const j = JSON.parse(text) as Obj;
            for (const row of (j["results"] as Obj[]) ?? []) {
              const c = row["campaign"] as Obj;
              const m = row["metrics"] as Obj;
              const s = row["segments"] as Obj;
              const urlBits = `${c["trackingUrlTemplate"] ?? ""}&${c["finalUrlSuffix"] ?? ""}`;
              const utm = urlBits.match(/utm_campaign=([^&{]+)/i);
              rows.push({
                date: s["date"],
                campaign_id: String(c["id"]),
                campaign_name: String(c["name"] ?? c["id"]),
                spend: (Number(m["costMicros"]) || 0) / 1e6,
                clicks: Number(m["clicks"]) || 0,
                impressions: Number(m["impressions"]) || 0,
                conversions: Number(m["conversions"]) || 0,
                utm_campaign: utm ? decodeURIComponent(utm[1] ?? "") : null,
              });
            }
            pageToken = (j["nextPageToken"] as string) || undefined;
          } while (pageToken);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabaseAdmin
              .from("google_ads_metrics")
              .upsert(rows.slice(i, i + 500) as never, { onConflict: "date,campaign_id" });
            if (error) return Response.json({ error: error.message }, { status: 500 });
          }
          await recordSyncRun("google-ads");
          return Response.json({ ok: true, synced: rows.length, since: d(since), until: d(until) });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 });
        }
      },
    },
  },
});
