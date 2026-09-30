import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincronização Meta Ads (Graph API insights) -> tabela `meta_ads_metrics`.
// Proteção: Authorization: Bearer <LOVABLE_CRON_SECRET>. Query opcional: ?days=30

type Obj = Record<string, unknown>;
const GRAPH = "https://graph.facebook.com/v19.0";

export const Route = createFileRoute("/api/public/sync/meta-ads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const account = process.env["META_AD_ACCOUNT_ID"];
        const token = process.env["META_ACCESS_TOKEN"];
        if (!account || !token) {
          return Response.json({ error: "Meta Ads não configurado" }, { status: 500 });
        }
        const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
        const until = new Date();
        const since = new Date(Date.now() - (days - 1) * 86400000);
        const d = (x: Date) => x.toISOString().slice(0, 10);

        const call = async (url: string) => {
          const r = await fetch(url);
          const j = (await r.json()) as Obj;
          if (!r.ok) throw new Error((j["error"] as Obj | undefined)?.["message"] as string ?? `Meta ${r.status}`);
          return j;
        };

        try {
          // utm_campaign vem dos url_tags dos anúncios de cada campanha
          const utmByCampaign = new Map<string, string>();
          let next: string | null =
            `${GRAPH}/${account}/ads?fields=campaign_id,creative{url_tags}&limit=500&access_token=${token}`;
          while (next) {
            const j: Obj = await call(next);
            for (const ad of (j["data"] as Obj[]) ?? []) {
              const tags = String((ad["creative"] as Obj | undefined)?.["url_tags"] ?? "");
              const m = tags.match(/utm_campaign=([^&]+)/i);
              const cid = String(ad["campaign_id"]);
              if (m && !utmByCampaign.has(cid)) utmByCampaign.set(cid, decodeURIComponent(m[1]));
            }
            next = ((j["paging"] as Obj | undefined)?.["next"] as string) ?? null;
          }

          const rows: Obj[] = [];
          const range = encodeURIComponent(JSON.stringify({ since: d(since), until: d(until) }));
          next = `${GRAPH}/${account}/insights?level=campaign&time_increment=1&time_range=${range}&fields=campaign_id,campaign_name,spend,clicks,impressions&limit=500&access_token=${token}`;
          while (next) {
            const j: Obj = await call(next);
            for (const r of (j["data"] as Obj[]) ?? []) {
              const cid = String(r["campaign_id"]);
              rows.push({
                date: r["date_start"],
                campaign_id: cid,
                campaign_name: String(r["campaign_name"] ?? cid),
                spend: Number(r["spend"]) || 0,
                clicks: Number(r["clicks"]) || 0,
                impressions: Number(r["impressions"]) || 0,
                utm_campaign: utmByCampaign.get(cid) ?? null,
              });
            }
            next = ((j["paging"] as Obj | undefined)?.["next"] as string) ?? null;
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabaseAdmin
              .from("meta_ads_metrics")
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
