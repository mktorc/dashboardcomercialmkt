import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincronização Meta Ads (Graph API insights) -> tabela `meta_ads_metrics`.
// Proteção: Authorization: Bearer <LOVABLE_CRON_SECRET>
// Query params:
//   ?days=30           (padrão: 30, máx: 365) - sincroniza últimos X dias
//   ?since=2026-01-01  (YYYY-MM-DD) - data inicial (sobrescreve days se fornecido)
//   ?until=2026-09-30  (YYYY-MM-DD) - data final (padrão: hoje)

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
        const token = process.env["META_ADS_SYSTEM_USER_TOKEN"] || process.env["META_ACCESS_TOKEN"];
        if (!account || !token) {
          return Response.json({ error: "Meta Ads não configurado" }, { status: 500 });
        }

        const url = new URL(request.url);
        const d = (x: Date) => x.toISOString().slice(0, 10);

        // Parsear parâmetros de data
        const sinceParam = url.searchParams.get("since");
        const untilParam = url.searchParams.get("until");

        // Validar formato de datas (YYYY-MM-DD)
        const isValidDate = (dateStr: string | null): boolean => {
          if (!dateStr) return true; // null é válido
          return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(new Date(dateStr).getTime());
        };

        if (!isValidDate(sinceParam) || !isValidDate(untilParam)) {
          return Response.json(
            { error: 'Formato de data inválido. Use YYYY-MM-DD (ex: ?since=2026-01-01&until=2026-09-30)' },
            { status: 400 }
          );
        }

        // Calcular since e until
        let since: Date;
        let until: Date;

        if (sinceParam && untilParam) {
          // Ambos fornecidos
          since = new Date(`${sinceParam}T00:00:00Z`);
          until = new Date(`${untilParam}T23:59:59.999Z`);
        } else if (sinceParam) {
          // Apenas since fornecido
          since = new Date(`${sinceParam}T00:00:00Z`);
          until = new Date();
        } else if (untilParam) {
          // Apenas until fornecido
          until = new Date(`${untilParam}T23:59:59.999Z`);
          const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
          since = new Date(Date.now() - (days - 1) * 86400000);
        } else {
          // Nenhum fornecido, usar days
          const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
          until = new Date();
          since = new Date(Date.now() - (days - 1) * 86400000);
        }

        // Validar se since <= until
        if (since > until) {
          return Response.json(
            { error: 'Data "since" deve ser menor ou igual a "until"' },
            { status: 400 }
          );
        }

        const call = async (url: string) => {
          const r = await fetch(url);
          const j = (await r.json()) as Obj;
          if (!r.ok) throw new Error((j["error"] as Obj | undefined)?.["message"] as string ?? `Meta ${r.status}`);
          return j;
        };

        // Se o ID configurado for recusado (ex.: token sem permissão nessa conta),
        // descobre a conta acessível pelo token e usa essa.
        let usedAccount = account;
        let accountNote: string | null = null;
        try {
          await call(`${GRAPH}/${account}?fields=account_id&access_token=${token}`);
        } catch {
          const ads = await call(
            `${GRAPH}/me/adaccounts?fields=account_id&access_token=${token}`,
          );
          const list = (ads["data"] as Obj[]) ?? [];
          if (list.length === 1) {
            const accId = String(list[0]!["account_id"]);
            usedAccount = `act_${accId}`;
            accountNote = `META_AD_ACCOUNT_ID configurado sem acesso; usando conta acessível pelo token: ${usedAccount}`;
          } else {
            throw new Error(
              `Ad account ${account} sem permissão para este token e ${list.length} contas acessíveis via /me/adaccounts`,
            );
          }
        }


        try {
          // utm_campaign vem dos url_tags dos anúncios de cada campanha
          const utmByCampaign = new Map<string, string>();
          let next: string | null =
            `${GRAPH}/${usedAccount}/ads?fields=campaign_id,creative{url_tags}&limit=500&access_token=${token}`;
          while (next) {
            const j: Obj = await call(next);
            for (const ad of (j["data"] as Obj[]) ?? []) {
              const tags = String((ad["creative"] as Obj | undefined)?.["url_tags"] ?? "");
              const m = tags.match(/utm_campaign=([^&]+)/i);
              const cid = String(ad["campaign_id"]);
              if (m && !utmByCampaign.has(cid)) utmByCampaign.set(cid, decodeURIComponent(m[1] ?? ""));
            }
            next = ((j["paging"] as Obj | undefined)?.["next"] as string) ?? null;
          }

          const rows: Obj[] = [];
          const range = encodeURIComponent(JSON.stringify({ since: d(since), until: d(until) }));

          console.log(`[Meta Ads Sync] Iniciando sincronização para período: ${d(since)} a ${d(until)}`);
          console.log(`[Meta Ads Sync] Conta: ${usedAccount}`);

          next = `${GRAPH}/${usedAccount}/insights?level=campaign&time_increment=1&time_range=${range}&fields=campaign_id,campaign_name,spend,clicks,impressions,actions&limit=500&access_token=${token}`;
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
                conversations: Number(((r["actions"] as Obj[] | undefined) ?? []).find((a) => a["action_type"] === "onsite_conversion.messaging_conversation_started_7d")?.["value"]) || 0,
                utm_campaign: utmByCampaign.get(cid) ?? null,
              });
            }
            next = ((j["paging"] as Obj | undefined)?.["next"] as string) ?? null;
          }

          const totalSpend = rows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);
          console.log(`[Meta Ads Sync] Registros recuperados da API: ${rows.length}`);
          console.log(`[Meta Ads Sync] Gasto total na API: US$ ${totalSpend.toFixed(2)}`);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // 1. LIMPAR período anterior para evitar duplicação
          console.log(`[Meta Ads Sync] Limpando registos anteriores do período ${d(since)} a ${d(until)}...`);
          const { error: deleteError } = await supabaseAdmin
            .from("meta_ads_metrics")
            .delete()
            .gte("date", d(since))
            .lte("date", d(until));

          if (deleteError) {
            console.error(`[Meta Ads Sync] Erro ao limpar período:`, deleteError);
            return Response.json({ error: `Erro ao limpar dados: ${deleteError.message}` }, { status: 500 });
          }

          let totalInserted = 0;

          // 2. INSERIR novos dados (sem conflito agora que limpamos)
          for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500);
            const { error, count } = await supabaseAdmin
              .from("meta_ads_metrics")
              .insert(batch as never);

            if (error) {
              console.error(`[Meta Ads Sync] Erro ao inserir lote ${Math.floor(i / 500) + 1}:`, error);
              return Response.json({ error: error.message }, { status: 500 });
            }

            totalInserted += batch.length;
            console.log(`[Meta Ads Sync] Lote ${Math.floor(i / 500) + 1}: ${batch.length} registos inseridos`);
          }

          console.log(`[Meta Ads Sync] ✅ Sincronização concluída com sucesso`);
          console.log(`[Meta Ads Sync] Total de registos inseridos: ${totalInserted}`);
          console.log(`[Meta Ads Sync] Valor total em base de dados: US$ ${totalSpend.toFixed(2)}`);

          return Response.json({
            ok: true,
            synced: totalInserted,
            since: d(since),
            until: d(until),
            account: usedAccount,
            totalSpend: parseFloat(totalSpend.toFixed(2)),
            ...(accountNote ? { note: accountNote } : {}),
          });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 });
        }
      },
    },
  },
});
