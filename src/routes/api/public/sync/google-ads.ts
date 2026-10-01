import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincronização Google Ads (REST + GAQL) -> tabela `google_ads_metrics`.
// Proteção: Authorization: Bearer <segredo cron>. Query opcional: ?days=30

type Obj = Record<string, unknown>;
const API = "https://googleads.googleapis.com/v21";

export const Route = createFileRoute("/api/public/sync/google-ads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const env = (k: string) => process.env[k];
        const customer = env("GOOGLE_ADS_CUSTOMER_ID")?.replace(/-/g, "");
        const devToken = env("GOOGLE_ADS_DEVELOPER_TOKEN");
        const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
        const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
        const refresh = env("GOOGLE_ADS_REFRESH_TOKEN");
        if (!customer || !devToken || !clientId || !clientSecret || !refresh) {
          return Response.json({ error: "Google Ads não configurado" }, { status: 500 });
        }
        const loginId = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID")?.replace(/-/g, "") || customer;
        const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const until = new Date();
        const since = new Date(Date.now() - (days - 1) * 86400000);

        try {
          const tr = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refresh,
              grant_type: "refresh_token",
            }),
          });
          const tj = (await tr.json()) as Obj;
          if (!tr.ok) {
            return Response.json({ error: `OAuth ${tr.status}: ${JSON.stringify(tj)}` }, { status: 502 });
          }
          const accessToken = String(tj["access_token"]);

          const query = `SELECT segments.date, campaign.id, campaign.name, campaign.tracking_url_template, campaign.final_url_suffix, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${d(since)}' AND '${d(until)}'`;
          const rows: Obj[] = [];
          let pageToken: string | undefined;
          do {
            const r = await fetch(`${API}/customers/${customer}/googleAds:search`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": devToken,
                "login-customer-id": loginId,
                "Content-Type": "application/json",
              },
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
          return Response.json({ ok: true, synced: rows.length, since: d(since), until: d(until) });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 });
        }
      },
    },
  },
});
