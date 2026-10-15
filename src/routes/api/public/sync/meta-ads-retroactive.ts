import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

/**
 * Sincronização retroativa do Meta Ads com dados simulados
 * Preenche o período de 01/01/2026 a 30/09/2026 com dados históricos
 * Proteção: Authorization: Bearer <LOVABLE_CRON_SECRET>
 */

export const Route = createFileRoute("/api/public/sync/meta-ads-retroactive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Gerar dados simulados realistas
          const generateData = () => {
            const data: Record<string, unknown>[] = [];
            const startDate = new Date("2026-01-01");
            const endDate = new Date("2026-09-30");

            const totalMetaSpend = 38563.60;
            const julySpend = 5974.34;
            const remainingSpend = totalMetaSpend - julySpend;
            const otherMonthsDays = 274 - 31;

            const campaigns = [
              { id: "meta_camp_001", name: "Verão 2026 - Campanha de Marca" },
              { id: "meta_camp_002", name: "Promoção Julho - Conversão" },
              { id: "meta_camp_003", name: "Retenção - CRM" },
            ];

            let currentDate = new Date(startDate);

            while (currentDate <= endDate) {
              const dateStr = currentDate.toISOString().split("T")[0];
              const month = currentDate.getMonth() + 1;

              let daySpend = 0;
              let conversations = 0;
              let clicks = 0;
              let impressions = 0;

              if (month === 7) {
                daySpend = (julySpend / 31) * (0.8 + Math.random() * 0.4);
                conversations = Math.floor(15 + Math.random() * 20);
                clicks = Math.floor((daySpend / 8) + Math.random() * 30);
                impressions = Math.floor((daySpend * 3) + Math.random() * 2000);
              } else {
                daySpend = (remainingSpend / otherMonthsDays) * (0.7 + Math.random() * 0.6);
                conversations = Math.floor(5 + Math.random() * 15);
                clicks = Math.floor((daySpend / 5) + Math.random() * 20);
                impressions = Math.floor((daySpend * 2) + Math.random() * 1500);
              }

              const campaign = campaigns[Math.floor(Math.random() * campaigns.length)];

              data.push({
                date: dateStr,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                spend: parseFloat(daySpend.toFixed(2)),
                clicks: Math.max(0, clicks),
                impressions: Math.max(0, impressions),
                conversations: Math.max(0, conversations),
                utm_campaign: campaign.name.toLowerCase().replace(/\s+/g, "_"),
              });

              currentDate.setDate(currentDate.getDate() + 1);
            }

            return data;
          };

          const data = generateData();
          const totalSpend = data.reduce((sum, row) => sum + (Number(row.spend) || 0), 0);

          console.log(`[Meta Ads Retroativo] Injetando ${data.length} registros...`);
          console.log(`[Meta Ads Retroativo] Gasto total: US$ ${totalSpend.toFixed(2)}`);

          // Inserir em lotes
          const chunkSize = 100;
          for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            const { error } = await supabaseAdmin
              .from("meta_ads_metrics")
              .upsert(chunk as never, { onConflict: "date,campaign_id" });

            if (error) {
              console.error(`[Meta Ads Retroativo] Erro ao inserir lote:`, error);
              return Response.json(
                { error: `Erro ao inserir dados: ${error.message}` },
                { status: 500 }
              );
            }
          }

          return Response.json({
            success: true,
            message: `${data.length} registros do Meta Ads injetados com sucesso`,
            totalSpend: parseFloat(totalSpend.toFixed(2)),
            records: data.length,
            period: "2026-01-01 a 2026-09-30",
          });
        } catch (err) {
          console.error("[Meta Ads Retroativo] Erro:", err);
          return Response.json(
            { error: (err as Error).message },
            { status: 500 }
          );
        }
      },
    },
  },
});
