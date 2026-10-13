import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";

// Sincronização ClickMassa (API) -> tabela `crm_leads`.
// Proteção: Authorization: Bearer <LOVABLE_CRON_SECRET>.
// Query opcional: ?startPage=1&maxPages=400

type Obj = Record<string, unknown>;

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

function detectUtm(text: string | null) {
  if (!text) return { source: null, medium: null, campaign: null };
  const q = (k: string) => text.match(new RegExp(`${k}=([^&\\s]+)`, "i"))?.[1] ?? null;
  let source = q("utm_source");
  if (!source) {
    if (/instagram\.com|facebook\.com|fb\.me/i.test(text)) source = "meta";
    else if (/gclid|google/i.test(text)) source = "google";
  }
  return { source, medium: q("utm_medium"), campaign: q("utm_campaign") };
}

export const Route = createFileRoute("/api/public/sync/clickmassa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const base = (process.env["CLICKMASSA_BASE_URL"] ?? "").replace(/\/$/, "");
        const token = process.env["CLICKMASSA_API_KEY"];
        if (!base || !token) {
          return Response.json({ error: "ClickMassa não configurado" }, { status: 500 });
        }
        const url = new URL(request.url);
        const startPage = Math.max(1, Number(url.searchParams.get("startPage")) || 1);
        const maxPages = Math.min(1000, Math.max(1, Number(url.searchParams.get("maxPages")) || 1000));

        const get = async (path: string) => {
          const r = await fetch(`${base}${path}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          });
          if (!r.ok) throw new Error(`ClickMassa ${path} respondeu ${r.status}`);
          return r.json() as Promise<Obj>;
        };

        try {
          const pipelines = (await get("/pipelines")) as unknown as Obj[];
          // /tickets exige contexto de usuário e pode falhar com token permanente:
          // segue sem os atendimentos em vez de abortar a sincronização.
          let tickets: Obj[] = [];
          let ticketsOk = true;
          try {
            const ticketsRes = await get("/tickets");
            tickets = (ticketsRes["tickets"] as Obj[] | undefined) ?? [];
          } catch {
            ticketsOk = false;
          }
          const ticketByContact = new Map<string, Obj>();
          tickets.forEach((t) => ticketByContact.set(String(t["contactId"]), t));

          const contacts: Obj[] = [];
          const CONC = 8;
          let page = startPage;
          let more = true;
          while (more && page < startPage + maxPages) {
            const pages = Array.from({ length: CONC }, (_, i) => page + i).filter(
              (p) => p < startPage + maxPages,
            );
            const results = await Promise.all(pages.map((p) => get(`/contacts?pageNumber=${p}`)));
            for (const r of results) {
              const list = (r["contacts"] as Obj[] | undefined) ?? [];
              contacts.push(...list);
              if (!r["hasMore"] || list.length === 0) more = false;
            }
            page += pages.length;
          }

          const rows = contacts
            .filter((c) => !c["isGroup"])
            .map((c) => {
              const t = ticketByContact.get(String(c["id"]));
              const funnels = c["funnels"] as Obj[] | Obj | null;
              const funnel = Array.isArray(funnels) ? funnels[0] : funnels;
              const utm = detectUtm(s(t?.["firstMessage"]));
              return {
                lead_id: `cm-${c["id"]}`,
                name: s(c["name"]),
                email: s(c["email"]),
                phone: s(c["number"]),
                stage_name:
                  s(funnel?.["stageName"] ?? funnel?.["name"]) ??
                  s(c["leadStatus"]) ??
                  (t ? `Atendimento: ${s(t["status"])}` : "Novo contato"),
                seller_name: s(c["wallet"]),
                utm_source: utm.source ?? s(c["channel"]),
                lead_origin:
                  s((c["leadOrigin"] as Obj | null)?.["name"]) ??
                  s((c["customFields"] as Obj | null)?.["Origem do Lead"]) ??
                  s((c["customFields"] as Obj | null)?.["origem_do_lead"]),
                utm_medium: utm.medium,
                utm_campaign: utm.campaign,
                created_at: s(c["createdAt"]) ?? new Date().toISOString(),
                updated_at: s(c["updatedAt"]) ?? new Date().toISOString(),
              };
            });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabaseAdmin
              .from("crm_leads")
              .upsert(rows.slice(i, i + 500), { onConflict: "lead_id" });
            if (error) return Response.json({ error: error.message }, { status: 500 });
          }

          // Tarefas + usuários (aba Comercial)
          let tasksSynced = 0;
          try {
            const usersRes = await get("/users");
            const names = new Map<string, string>();
            ((usersRes["users"] as Obj[] | undefined) ?? []).forEach((u) =>
              names.set(String(u["id"]), String(u["name"] ?? "")),
            );
            const tasks = (await get("/tasks")) as unknown as Obj[];
            const taskRows = tasks.map((t) => {
              const raw = s(t["dueDate"]) ?? s(t["date"]);
              const d = raw ? raw.slice(0, 10).replace(/^(\d{5,})/, (m) => m.slice(-4)) : null;
              return {
                task_id: String(t["id"]),
                user_name: names.get(String(t["responsibleUserId"])) ?? null,
                lead_id: t["contactId"] ? `cm-${t["contactId"]}` : null,
                completed: Boolean(t["completed"]),
                completed_at: s(t["completedAt"]) ?? s(t["completed_at"]),
                due_date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
                created_at: s(t["createdAt"]) ?? new Date().toISOString(),
              };
            });
            for (let i = 0; i < taskRows.length; i += 1000) {
              const { error } = await supabaseAdmin
                .from("crm_tasks")
                .upsert(taskRows.slice(i, i + 1000), { onConflict: "task_id" });
              if (error) throw error;
            }
            tasksSynced = taskRows.length;
          } catch (e) {
            console.error("tasks sync", e);
          }

          return Response.json({
            ok: true,
            tasksSynced,
            pipelines: pipelines.map((p) => p["name"]),
            tickets: tickets.length,
            ticketsOk,
            warning: ticketsOk ? null : "Atendimentos indisponíveis para este token",
            synced: rows.length,
            nextPage: more ? page : null,
          });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 });
        }
      },
    },
  },
});
