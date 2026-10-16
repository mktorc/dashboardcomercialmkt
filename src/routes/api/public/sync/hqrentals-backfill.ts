import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";
import { extractAdditionalChargesPrice, extractMiscellaneousPrice } from "@/lib/hq-charges";

// Edge Function para re-sincronizar reservas existentes com os campos de taxas e cobranças
// GET /api/public/sync/hqrentals-backfill?days=N&limit=500
// Busca as últimas N dias (ou todas se não especificado) e re-sincroniza as colunas
// miscellaneous_price e additional_charges_price a partir da API do HQ

type HqReservation = Record<string, unknown>;

export const Route = createFileRoute("/api/public/sync/hqrentals-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const baseUrl = process.env["HQ_BASE_URL"];
        const tenant = process.env["HQ_TENANT_TOKEN"];
        const user = process.env["HQ_USER_TOKEN"];
        if (!baseUrl || !tenant || !user) {
          return Response.json({ error: "HQ Rentals credentials not configured" }, { status: 500 });
        }

        const basic = btoa(`${tenant}:${user}`);
        const base = `${baseUrl.replace(/\/$/, "")}/car-rental/reservations`;
        const url = new URL(request.url);
        const daysParam = Number(url.searchParams.get("days")) || 30; // Default 30 dias
        const limitParam = Number(url.searchParams.get("limit")) || 500; // Default 500 registos
        const cutoff = Date.now() - daysParam * 86400000;

        const all: HqReservation[] = [];
        let page = 1;
        let lastPage = 1;
        let totalProcessed = 0;

        console.log(`[HQ Backfill] Iniciando re-sincronização dos últimos ${daysParam} dias (limite: ${limitParam} registos)`);

        do {
          const hqRes = await fetch(`${base}?page=${page}`, {
            headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
          });
          if (!hqRes.ok) {
            const body = await hqRes.text();
            return Response.json(
              { error: `HQ Rentals respondeu ${hqRes.status}`, detail: body.slice(0, 500) },
              { status: 502 },
            );
          }
          const payload = (await hqRes.json()) as {
            data?: HqReservation[];
            last_page?: number;
          };
          const data = payload.data ?? [];
          lastPage = payload.last_page ?? 1;
          page += 1;

          const recent = data.filter((r) => Date.parse(String(r["created_at"] ?? "")) >= cutoff);
          all.push(...recent);
          totalProcessed += data.length;

          if (recent.length < data.length || all.length >= limitParam) break;
        } while (page <= lastPage);

        // Limita ao número máximo de registos para não sobrecarregar
        const rows = all.slice(0, limitParam).map((r) => ({
          reservation_id: String(r["prefixed_id"] ?? r["id"] ?? ""),
          miscellaneous_price: extractMiscellaneousPrice(r),
          additional_charges_price: extractAdditionalChargesPrice(r),
        })).filter((r) => r.reservation_id !== "");

        console.log(`[HQ Backfill] Encontrados ${rows.length} registos para backfill`);

        // Diagnosticar se há dados reais
        const withMisc = rows.filter(r => r.miscellaneous_price > 0).length;
        const withAddl = rows.filter(r => r.additional_charges_price > 0).length;
        console.log(`[HQ Backfill] Com Taxas Diversas: ${withMisc}, Com Cobranças Adicionais: ${withAddl}`);

        if (rows.length === 0) {
          return Response.json({
            ok: false,
            error: "Nenhum registo encontrado para backfill no período especificado",
            days: daysParam
          }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let updated = 0;
        let failed = 0;

        // Atualiza em lotes para melhor performance
        const BATCH = 100;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const { error, count } = await supabaseAdmin
            .from("reservations")
            .update({
              miscellaneous_price: null, // Will be set by the batch below
              additional_charges_price: null,
            })
            .in("reservation_id", batch.map(r => r.reservation_id));

          if (error) {
            console.error(`[HQ Backfill] Erro ao atualizar lote ${i / BATCH + 1}:`, error);
            failed += batch.length;
            continue;
          }

          // Agora atualiza com os valores reais
          for (const row of batch) {
            const { error: updateError } = await supabaseAdmin
              .from("reservations")
              .update({
                miscellaneous_price: row.miscellaneous_price,
                additional_charges_price: row.additional_charges_price,
              })
              .eq("reservation_id", row.reservation_id);

            if (updateError) {
              console.error(`[HQ Backfill] Erro ao atualizar ${row.reservation_id}:`, updateError);
              failed++;
            } else {
              updated++;
            }
          }
        }

        console.log(`[HQ Backfill] Concluído! Atualizados: ${updated}, Falhados: ${failed}`);

        return Response.json({
          ok: true,
          updated,
          failed,
          total: rows.length,
          period_days: daysParam,
          with_miscellaneous: withMisc,
          with_additional_charges: withAddl,
        });
      },
    },
  },
});
