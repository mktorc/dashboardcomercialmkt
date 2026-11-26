import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";
import { recordSyncRun } from "@/lib/sync-runs";
import { fetchAll } from "@/lib/fetch-all";
import { clickMassaBase, getClickMassaToken } from "@/lib/clickmassa-auth.server";

// Sincroniza oportunidades do ClickMassa buscando GET /opportunity/:id
// (a API não tem listagem). Varre uma faixa de IDs e faz upsert em crm_opportunities.
// Query opcional: ?from=<id>&to=<id>. Padrão: (maior ID salvo - 1500) até +400.

type Obj = Record<string, unknown>;
const s = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Obj) : {});

function toRow(p: Obj) {
  const tc = obj(p["tasksCount"]);
  const stepId =
    p["pipelineStepId"] != null && Number.isFinite(Number(p["pipelineStepId"]))
      ? Number(p["pipelineStepId"])
      : null;
  return {
    opportunity_id: String(p["id"]),
    lead_id: p["contactId"] ? `cm-${p["contactId"]}` : null,
    name: s(p["name"]) ?? s(obj(p["contact"])["name"]),
    stage_name: s(obj(p["pipelineStep"])["name"]),
    pipeline_step_id: stepId,
    pipeline_name: stepId == null ? null : stepId <= 6 ? "Comercial" : "Sucesso do Cliente",
    status: s(p["status"]),
    seller_name: s(obj(p["responsible"])["name"]) ?? s(obj(p["user"])["name"]),
    value: num(p["value"]),
    pending_tasks:
      num(tc["countSchendule"]) + num(tc["countDelayed"]) + num(tc["countRequiredPending"]),
    delayed_tasks: num(tc["countDelayed"]),
    total_tasks:
      num(tc["countSchendule"]) +
      num(tc["countDelayed"]) +
      num(tc["countRequiredPending"]) +
      num(tc["countComplete"]),
    created_at: s(p["createdAt"]) ?? new Date().toISOString(),
    updated_at: s(p["updatedAt"]) ?? new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/public/sync/clickmassa-opportunities")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request))
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        const base = clickMassaBase();
        let token: string;
        try {
          token = await getClickMassaToken();
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const url = new URL(request.url);
        let from = Number(url.searchParams.get("from")) || 0;
        let to = Number(url.searchParams.get("to")) || 0;
        if (!from || !to) {
          const { data } = await supabaseAdmin
            .from("crm_opportunities")
            .select("opportunity_id")
            .order("created_at", { ascending: false })
            .limit(50);
          const max = Math.max(0, ...(data ?? []).map((r) => Number(r.opportunity_id) || 0));
          from = from || Math.max(1, max - 1500);
          to = to || max + 400;
        }
        if (to - from > 5000)
          return Response.json({ error: "Faixa máxima: 5000 IDs" }, { status: 400 });

        const rows: ReturnType<typeof toRow>[] = [];
        // Origem do Lead: o contato da oportunidade traz leadOriginId; o nome vem de /lead-origin
        const originNames = new Map<number, string>();
        try {
          const lo = await fetch(`${base}/lead-origin`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          });
          if (lo.ok)
            for (const o of (await lo.json()) as Obj[])
              originNames.set(Number(o["id"]), String(o["name"]).trim());
        } catch {
          /* segue sem origem */
        }
        const originByLead = new Map<string, string>();
        let errors = 0;
        const errorReasons: Record<string, number> = {}; // motivo → contagem, para diagnóstico
        const noteError = (k: string) => (errorReasons[k] = (errorReasons[k] ?? 0) + 1);
        const notFound: string[] = []; // excluídas no ClickMassa
        // Do mais novo ao mais antigo: se o tempo acabar, o que fica sem varrer é o mais antigo
        const ids = Array.from({ length: to - from + 1 }, (_, i) => to - i);
        // Oportunidades abertas fora da faixa: criar/concluir tarefa não muda o updatedAt nem o id,
        // então sem isto a contagem de tarefas delas fica diferente do ClickMassa. Entram depois da
        // faixa, em ordem aleatória, para que execuções seguidas cubram todas dentro do orçamento.
        if (!url.searchParams.get("from")) {
          const { data: open } = await fetchAll((a, b) =>
            supabaseAdmin
              .from("crm_opportunities")
              .select("opportunity_id")
              .eq("status", "open")
              .order("opportunity_id")
              .range(a, b),
          );
          const extra = (open as { opportunity_id: string }[])
            .map((r) => Number(r.opportunity_id))
            .filter((n) => Number.isFinite(n) && n > 0 && n < from);
          for (let i = extra.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [extra[i], extra[j]] = [extra[j]!, extra[i]!];
          }
          ids.push(...extra);
        }
        // Orçamento de tempo: para antes do limite da função (300s) e ainda grava o que leu
        // 120s de leitura deixa folga para os upserts e para o limite de 300s da função
        const deadline = Date.now() + 120_000;
        let skipped = 0;
        let authFailed = false;
        const worker = async () => {
          while (ids.length) {
            if (Date.now() > deadline) {
              skipped += ids.length;
              ids.length = 0;
              break;
            }
            const id = ids.shift()!;
            // Retenta falhas temporárias (limite de requisições / erro do servidor)
            let ok = false;
            for (let attempt = 0; attempt < 4 && !ok; attempt++) {
              try {
                const r = await fetch(`${base}/opportunity/${id}`, {
                  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                  signal: AbortSignal.timeout(15_000),
                });
                if (r.status === 404 || r.status === 400) {
                  notFound.push(String(id));
                  ok = true;
                  break;
                }
                if (r.status === 401 || r.status === 403) {
                  // Token recusado: retentar não resolve e só gasta o orçamento. Para tudo e
                  // guarda a mensagem da API para diagnóstico.
                  const body = (await r.text().catch(() => "")).slice(0, 200);
                  noteError(`HTTP ${r.status}: ${body}`);
                  authFailed = true;
                  skipped += ids.length;
                  ids.length = 0;
                  break;
                }
                if (!r.ok) {
                  noteError(`HTTP ${r.status}`);
                  await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
                  continue;
                }
                const p = (await r.json()) as Obj;
                if (p["id"] != null) {
                  rows.push(toRow(p));
                  const oid = Number(obj(p["contact"])["leadOriginId"]);
                  const name = originNames.get(oid);
                  if (p["contactId"] && name) originByLead.set(`cm-${p["contactId"]}`, name);
                }
                ok = true;
              } catch (e) {
                noteError(e instanceof Error ? e.name : "erro");
                await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
              }
            }
            if (!ok) errors++;
          }
        };
        await Promise.all(Array.from({ length: 8 }, worker));

        // Nada lido com sucesso: não é sucesso e NUNCA apaga (404 em tudo = URL/token errado, não
        // "excluídas"). O workflow fica vermelho e o último sucesso não avança.
        if (authFailed || (rows.length === 0 && (errors > 0 || notFound.length > 0)))
          return Response.json(
            {
              ok: false,
              ...(authFailed
                ? {
                    error:
                      "ClickMassa recusou o token (401/403): confira CLICKMASSA_EMAIL/CLICKMASSA_PASSWORD na Vercel",
                  }
                : {}),
              from,
              to,
              found: 0,
              errors,
              skipped,
              notFound: notFound.length,
              errorReasons,
            },
            { status: 502 },
          );

        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabaseAdmin
            .from("crm_opportunities")
            .upsert(rows.slice(i, i + 500), { onConflict: "opportunity_id" });
          if (error) return Response.json({ error: error.message }, { status: 500 });
        }
        // Grava a Origem do Lead nos leads do ClickMassa
        const byOrigin = new Map<string, string[]>();
        originByLead.forEach((name, lead) =>
          byOrigin.set(name, [...(byOrigin.get(name) ?? []), lead]),
        );
        let originsUpdated = 0;
        for (const [name, leads] of byOrigin) {
          for (let i = 0; i < leads.length; i += 300) {
            const { error } = await supabaseAdmin
              .from("crm_leads")
              .update({ lead_origin: name })
              .in("lead_id", leads.slice(i, i + 300));
            if (!error) originsUpdated += Math.min(300, leads.length - i);
          }
        }
        // Remove oportunidades que foram excluídas no ClickMassa
        for (let i = 0; i < notFound.length; i += 500) {
          await supabaseAdmin
            .from("crm_opportunities")
            .delete()
            .in("opportunity_id", notFound.slice(i, i + 500));
        }
        await recordSyncRun("clickmassa-opportunities");
        return Response.json({
          ok: true,
          from,
          to,
          found: rows.length,
          originsUpdated,
          removed: notFound.length,
          errors,
          skipped,
          errorReasons,
        });
      },
    },
  },
});
