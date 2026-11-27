import { createFileRoute } from "@tanstack/react-router";
import { isSyncAuthorized } from "@/lib/sync-auth";
import { recordSyncRun } from "@/lib/sync-runs";
import { clickMassaBase, getClickMassaToken } from "@/lib/clickmassa-auth.server";

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

function dueAt(raw: string | null, day: string | null, time: string | null, fullDay: boolean) {
  if (raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !isNaN(Date.parse(raw)))
    return new Date(raw).toISOString();
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const hm = !fullDay && time && /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : "23:59:59";
  const iso = `${day}T${hm.length === 5 ? `${hm}:00` : hm}-03:00`;
  return isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

export const Route = createFileRoute("/api/public/sync/clickmassa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSyncAuthorized(request)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const base = clickMassaBase();
        let token: string;
        try {
          token = await getClickMassaToken();
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
        const url = new URL(request.url);
        const startPage = Math.max(1, Number(url.searchParams.get("startPage")) || 1);
        const maxPages = Math.min(
          1000,
          Math.max(1, Number(url.searchParams.get("maxPages")) || 1000),
        );

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
          // A listagem de contatos traz só o id da conexão (firstConnection); o nome vem de /whatsapp.
          const connectionNames = new Map<string, string>();
          try {
            const conns = (await get("/whatsapp")) as unknown as Obj[];
            (Array.isArray(conns) ? conns : []).forEach((w) => {
              const name = s(w["name"]) ?? s(w["nome"]) ?? s(w["description"]);
              if (w["id"] != null && name) connectionNames.set(String(w["id"]), name);
            });
          } catch (e) {
            console.error("connections", e);
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
                first_connection_name:
                  s(c["firstConnectionName"]) ??
                  (c["firstConnection"] != null
                    ? (connectionNames.get(String(c["firstConnection"])) ?? null)
                    : null),
                utm_medium: utm.medium,
                utm_campaign: utm.campaign,
                created_at: s(c["createdAt"]) ?? new Date().toISOString(),
                updated_at: s(c["updatedAt"]) ?? new Date().toISOString(),
              };
            });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // A lista de contatos não traz a Origem do Lead: nunca apaga a origem já gravada
          // (ela vem da sincronização de oportunidades e do webhook).
          const withOrigin = rows.filter((r) => r.lead_origin);
          const withoutOrigin = rows
            .filter((r) => !r.lead_origin)
            .map(({ lead_origin: _omit, ...rest }) => rest);
          for (const group of [withOrigin, withoutOrigin] as Obj[][]) {
            for (let i = 0; i < group.length; i += 500) {
              const { error } = await supabaseAdmin
                .from("crm_leads")
                .upsert(group.slice(i, i + 500) as never, { onConflict: "lead_id" });
              if (error) return Response.json({ error: error.message }, { status: 500 });
            }
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
                opportunity_id: t["opportunityId"] != null ? String(t["opportunityId"]) : null,
                // Cancelada não conta como pendente nem atrasada no ClickMassa.
                completed: Boolean(t["completed"]) || Boolean(t["canceledAt"]),
                completed_at: s(t["completedAt"]) ?? s(t["completed_at"]),
                due_date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
                // Vencimento com hora: o ClickMassa já conta como atrasada a tarefa de hoje cujo horário passou.
                // Sem dueDate, o vencimento é date + time no horário de Brasília (é assim que o
                // ClickMassa decide "vencida": conferido contra o countDelayed das oportunidades).
                due_at: dueAt(raw, d, s(t["time"]), Boolean(t["fullDay"])),
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

          await recordSyncRun("clickmassa");
          return Response.json({
            ok: true,
            tasksSynced,
            pipelines: pipelines.map((p) => p["name"]),
            tickets: tickets.length,
            ticketsOk,
            warning: ticketsOk ? null : "Atendimentos indisponíveis para este token",
            synced: rows.length,
            connectionsMapped: connectionNames.size,
            withConnection: rows.filter((r) => r.first_connection_name).length,
            nextPage: more ? page : null,
          });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 });
        }
      },
    },
  },
});
