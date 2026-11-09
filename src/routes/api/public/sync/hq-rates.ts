import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";
import { recordSyncRun } from "@/lib/sync-runs";
import { changedRates, dailyRatesOf, type OurRateRow } from "@/lib/hq-rate-calendar";

// Sincronização do Rate Calendar do HQ -> tabela `our_rate_snapshots` (nossa tarifa de tabela por categoria e data de retirada).
// Cada dia programado é uma temporada de um dia; GET car-rental/seasons/{id} já traz as tarifas aninhadas (~1 chamada por dia).
// Só insere o que mudou desde a última tarifa guardada (histórico preservado, nunca sobrescreve).
// Proteção: Authorization: Bearer <segredo do cron>.

const MAX_CALLS = 700; // folga sob o limite de subchamadas por execução e de 1.000 requisições da API do HQ
const MAX_MISSES = 20; // fim do calendário: ids seguidos que não são dia programado
const CONCURRENCY = 4; // baixo de propósito: o HQ limita a 1.000 chamadas por janela e outros syncs dividem a mesma cota
const MAX_RETRIES = 4;

export const Route = createFileRoute("/api/public/sync/hq-rates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        const baseUrl = process.env["HQ_BASE_URL"];
        const tenant = process.env["HQ_TENANT_TOKEN"];
        const user = process.env["HQ_USER_TOKEN"];
        if (!baseUrl || !tenant || !user)
          return Response.json({ error: "HQ Rentals credentials not configured" }, { status: 500 });

        const base = baseUrl.replace(/\/$/, "");
        const headers = {
          Authorization: `Basic ${btoa(`${tenant}:${user}`)}`,
          Accept: "application/json",
        };
        let calls = 0;
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        // 429 (Too Many Attempts): espera o tempo que o HQ indicar (ou um recuo crescente) e tenta de novo.
        const get = async (path: string) => {
          for (let attempt = 0; ; attempt++) {
            calls += 1;
            const r = await fetch(`${base}/${path}`, { headers });
            if (r.status === 404) return null;
            if (r.status === 429 && attempt < MAX_RETRIES) {
              const retryAfter = Number(r.headers.get("retry-after"));
              await sleep(Math.min(45, retryAfter > 0 ? retryAfter : 10 * (attempt + 1)) * 1000);
              continue;
            }
            if (!r.ok)
              throw new Error(`HQ ${r.status} em ${path}: ${(await r.text()).slice(0, 200)}`);
            return (await r.json()) as unknown;
          }
        };

        try {
          const cls = (await get("fleets/vehicle-classes?limit=100")) as {
            fleets_vehicle_classes?: { id: number; name: string; active: boolean }[];
          } | null;
          // Categorias 1 e 7 são inativas no HQ e ficam de fora, como nas demais análises de precificação.
          const categories = new Map(
            (cls?.fleets_vehicle_classes ?? [])
              .filter((c) => c.active && c.id !== 1 && c.id !== 7)
              .map((c) => [c.id, c.name] as [number, string]),
          );
          if (categories.size === 0) throw new Error("Nenhuma categoria ativa devolvida pelo HQ");

          // Os dias programados são as temporadas seguintes à última da lista de temporadas (cadastradas em sequência).
          const list = await get("car-rental/seasons?limit=100");
          const seasons = (
            Array.isArray(list) ? list : ((list as { data?: unknown[] } | null)?.data ?? [])
          ) as {
            id: number;
          }[];
          let id = Math.max(0, ...seasons.map((s) => Number(s.id))) + 1;

          const fresh: OurRateRow[] = [];
          let misses = 0;
          // Falha no meio da varredura (por exemplo, 429 persistente): o que já foi lido ainda é gravado e o erro é devolvido.
          let scanError: string | null = null;
          try {
            while (misses < MAX_MISSES && calls < MAX_CALLS) {
              const ids = Array.from({ length: CONCURRENCY }, (_, i) => id + i);
              id += CONCURRENCY;
              const got = await Promise.all(
                ids.map(async (i) => {
                  const j = (await get(`car-rental/seasons/${i}`)) as {
                    car_rental_season?: unknown;
                  } | null;
                  return dailyRatesOf(j?.car_rental_season, categories);
                }),
              );
              for (const rows of got) {
                if (rows.length) {
                  fresh.push(...rows);
                  misses = 0;
                } else misses += 1;
              }
            }
          } catch (e) {
            scanError = (e as Error).message;
          }
          if (fresh.length === 0)
            throw new Error("Nenhuma tarifa diária encontrada no calendário do HQ");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const latest = new Map<string, { daily_rate: number; currency: string }>();
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseAdmin
              .from("our_rate_snapshots" as never)
              .select("pickup_date,category,daily_rate,currency")
              .eq("source", "hq_rate_calendar")
              .order("collected_at", { ascending: false })
              .order("id")
              .range(from, from + 999);
            if (error) throw error;
            const page = (data ?? []) as unknown as {
              pickup_date: string;
              category: string;
              daily_rate: number;
              currency: string;
            }[];
            for (const r of page) {
              const k = `${r.pickup_date}|${r.category}`;
              if (!latest.has(k)) latest.set(k, r);
            }
            if (page.length < 1000) break;
          }

          const novas = changedRates(fresh, latest);
          for (let i = 0; i < novas.length; i += 500) {
            const { error } = await supabaseAdmin
              .from("our_rate_snapshots" as never)
              .insert(novas.slice(i, i + 500) as never);
            if (error) throw error;
          }
          await recordSyncRun("hq-rates");
          const days = new Set(fresh.map((r) => r.pickup_date));
          if (scanError)
            return Response.json(
              {
                ok: false,
                partial: true,
                error: scanError,
                rates: fresh.length,
                inserted: novas.length,
                calls,
              },
              { status: 502 },
            );
          return Response.json({
            ok: true,
            days: days.size,
            from: [...days].sort()[0],
            to: [...days].sort().at(-1),
            rates: fresh.length,
            inserted: novas.length,
            calls,
          });
        } catch (e) {
          console.error("[hq-rates]", e);
          return Response.json({ error: (e as Error).message, calls }, { status: 502 });
        }
      },
    },
  },
});
