import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpDb } from "../supabase";
import {
  assertPeriod,
  compose,
  dateArg,
  dayKey,
  fetchAllFrom,
  fetchIn,
  fetchPage,
  groupSum,
  label,
  likeTerm,
  monthKey,
  num,
  ok,
  pagingArgs,
  range,
  ratio,
  readOnly,
  round2,
  slicePage,
  textArg,
  type Filter,
} from "./paginate";

const eq = (col: string, v?: string | boolean): Filter | undefined =>
  v === undefined ? undefined : (q) => q.eq(col, v);
const ilike = (col: string, v?: string): Filter | undefined =>
  v ? (q) => q.ilike(col, likeTerm(v)) : undefined;

const LEAD_COLS =
  "lead_id,name,stage_name,utm_source,utm_medium,utm_campaign,lead_origin,first_connection_name,seller_name,created_at,updated_at,first_response_at";
type Lead = {
  lead_id: string;
  stage_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  lead_origin: string | null;
  seller_name: string | null;
  created_at: string;
  first_response_at: string | null;
};

const responseMinutes = (l: Lead) =>
  l.first_response_at ? (Date.parse(l.first_response_at) - Date.parse(l.created_at)) / 60000 : null;

export const crmLeads = defineTool({
  name: "crm_leads",
  title: "Leads do CRM",
  description:
    "Leads criados no período, com filtros por vendedor, etapa, origem e UTMs. Sem group_by devolve a lista paginada; com group_by devolve contagem e tempo médio de primeira resposta (min) por grupo.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    seller: textArg.optional().describe("Trecho do nome do vendedor"),
    stage: textArg.optional(),
    utm_source: textArg.optional(),
    utm_medium: textArg.optional(),
    utm_campaign: textArg.optional().describe("utm_campaign exato"),
    lead_origin: textArg.optional(),
    group_by: z
      .enum([
        "none",
        "seller_name",
        "stage_name",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "lead_origin",
        "day",
        "month",
      ])
      .default("none"),
    sort_by: z.enum(["created_at", "updated_at", "first_response_at"]).default("created_at"),
    ascending: z.boolean().default(false),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      range("created_at", a.from, a.to),
      ilike("seller_name", a.seller),
      ilike("stage_name", a.stage),
      ilike("utm_source", a.utm_source),
      ilike("utm_medium", a.utm_medium),
      eq("utm_campaign", a.utm_campaign),
      ilike("lead_origin", a.lead_origin),
    );
    if (a.group_by === "none") {
      return ok(
        await fetchPage(sb, "mcp_crm_leads", LEAD_COLS, f, {
          sortBy: a.sort_by,
          ascending: a.ascending,
          limit: a.limit,
          offset: a.offset,
        }),
      );
    }
    const rows = await fetchAllFrom<Lead>(sb, "mcp_crm_leads", LEAD_COLS, f, "id");
    const gb = a.group_by;
    const key = (l: Lead) =>
      gb === "day" ? dayKey(l.created_at) : gb === "month" ? monthKey(l.created_at) : label(l[gb]);
    const map = new Map<string, { leads: number; responded: number; minutes: number }>();
    for (const l of rows) {
      const e = map.get(key(l)) ?? { leads: 0, responded: 0, minutes: 0 };
      e.leads++;
      const m = responseMinutes(l);
      if (m != null && m >= 0) {
        e.responded++;
        e.minutes += m;
      }
      map.set(key(l), e);
    }
    const groups = [...map.entries()]
      .map(([k, e]) => ({
        key: k,
        leads: e.leads,
        responded: e.responded,
        avg_first_response_min: ratio(e.minutes, e.responded),
      }))
      .sort((x, y) =>
        gb === "day" || gb === "month" ? x.key.localeCompare(y.key) : y.leads - x.leads,
      );
    return ok({ total_leads: rows.length, ...slicePage(groups, a.limit, a.offset) });
  },
});

const OPP_COLS =
  "opportunity_id,lead_id,name,stage_name,status,pipeline_name,seller_name,value,pending_tasks,total_tasks,created_at,updated_at";
type Opp = {
  lead_id: string | null;
  status: string | null;
  stage_name: string | null;
  pipeline_name: string | null;
  seller_name: string | null;
  value: number | null;
  created_at: string;
  updated_at: string;
};

export const crmOpportunities = defineTool({
  name: "crm_opportunities",
  title: "Oportunidades do CRM",
  description:
    "Oportunidades por período (criação ou última atualização), vendedor, status, etapa e pipeline. Lista paginada ou agregação (quantidade, valor total e médio) por grupo.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    date_field: z.enum(["created_at", "updated_at"]).default("created_at"),
    seller: textArg.optional(),
    status: textArg.optional().describe("Status exato (ex.: valor existente na coluna status)"),
    stage: textArg.optional(),
    pipeline: textArg.optional(),
    group_by: z
      .enum(["none", "seller_name", "status", "stage_name", "pipeline_name", "month"])
      .default("none"),
    sort_by: z.enum(["created_at", "updated_at", "value"]).default("created_at"),
    ascending: z.boolean().default(false),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const f = compose(
      range(a.date_field, a.from, a.to),
      ilike("seller_name", a.seller),
      eq("status", a.status),
      ilike("stage_name", a.stage),
      ilike("pipeline_name", a.pipeline),
    );
    if (a.group_by === "none") {
      return ok(
        await fetchPage(sb, "mcp_crm_opportunities", OPP_COLS, f, {
          sortBy: a.sort_by,
          ascending: a.ascending,
          limit: a.limit,
          offset: a.offset,
        }),
      );
    }
    const rows = await fetchAllFrom<Opp>(sb, "mcp_crm_opportunities", OPP_COLS, f, "id");
    const gb = a.group_by;
    const groups = groupSum(
      rows,
      (o) => (gb === "month" ? monthKey(o[a.date_field]) : label(o[gb])),
      { value: (o) => num(o.value) },
    )
      .map((g) => ({ ...g, avg_value: ratio(num(g["value"]), g.count) }))
      .sort((x, y) => y.count - x.count);
    return ok({
      total_opportunities: rows.length,
      total_value: round2(rows.reduce((s, o) => s + num(o.value), 0)),
      ...slicePage(groups, a.limit, a.offset),
    });
  },
});

const TASK_COLS = "task_id,user_name,lead_id,completed,due_date,created_at,completed_at";
type Task = {
  user_name: string | null;
  completed: boolean | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
};

export const crmTasks = defineTool({
  name: "crm_tasks",
  title: "Tarefas do CRM",
  description:
    "Tarefas por responsável, prazo ou criação, concluídas ou não, e atrasadas (prazo vencido sem conclusão). Lista ou agregação.",
  inputSchema: {
    from: dateArg.optional(),
    to: dateArg.optional(),
    date_field: z.enum(["due_date", "created_at", "completed_at"]).default("due_date"),
    user: textArg.optional().describe("Trecho do nome do responsável"),
    completed: z.boolean().optional(),
    overdue_only: z
      .boolean()
      .default(false)
      .describe("Só tarefas não concluídas com prazo anterior a hoje"),
    group_by: z.enum(["none", "user_name", "completed", "due_month"]).default("none"),
    sort_by: z.enum(["due_date", "created_at", "completed_at"]).default("due_date"),
    ascending: z.boolean().default(true),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    if (!a.from && !a.to && !a.overdue_only && !a.user)
      throw new ToolError("Informe um período, responsável ou overdue_only");
    const sb = mcpDb(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const f = compose(
      range(a.date_field, a.from, a.to, a.date_field !== "due_date"),
      ilike("user_name", a.user),
      eq("completed", a.overdue_only ? false : a.completed),
      a.overdue_only && ((q) => q.lt("due_date", today)),
    );
    if (a.group_by === "none") {
      return ok(
        await fetchPage(sb, "mcp_crm_tasks", TASK_COLS, f, {
          sortBy: a.sort_by,
          ascending: a.ascending,
          limit: a.limit,
          offset: a.offset,
        }),
      );
    }
    const rows = await fetchAllFrom<Task>(sb, "mcp_crm_tasks", TASK_COLS, f, "id");
    const key = (t: Task) =>
      a.group_by === "user_name"
        ? label(t.user_name)
        : a.group_by === "completed"
          ? String(!!t.completed)
          : monthKey(t.due_date);
    const groups = groupSum(rows, key, {
      completed: (t) => (t.completed ? 1 : 0),
      overdue: (t) => (!t.completed && t.due_date && t.due_date < today ? 1 : 0),
    }).sort((x, y) => y.count - x.count);
    return ok({ total_tasks: rows.length, ...slicePage(groups, a.limit, a.offset) });
  },
});

export const crmFunnel = defineTool({
  name: "crm_funnel",
  title: "Funil do CRM",
  description:
    "Leads criados no período e quantos viraram oportunidade (cruzamento crm_leads.lead_id = crm_opportunities.lead_id), com status e valor das oportunidades, agrupado por vendedor, origem ou UTM.",
  inputSchema: {
    from: dateArg,
    to: dateArg,
    group_by: z
      .enum([
        "seller_name",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "lead_origin",
        "stage_name",
      ])
      .default("seller_name"),
    seller: textArg.optional(),
    utm_campaign: textArg.optional(),
    ...pagingArgs,
  },
  annotations: readOnly,
  handler: async (a, ctx) => {
    assertPeriod(a.from, a.to);
    const sb = mcpDb(ctx);
    const leads = await fetchAllFrom<Lead>(
      sb,
      "mcp_crm_leads",
      LEAD_COLS,
      compose(
        range("created_at", a.from, a.to),
        ilike("seller_name", a.seller),
        eq("utm_campaign", a.utm_campaign),
      ),
      "id",
    );
    const opps = await fetchIn<Opp>(
      sb,
      "mcp_crm_opportunities",
      OPP_COLS,
      "lead_id",
      leads.map((l) => l.lead_id),
      "id",
    );
    const byLead = new Map<string, Opp[]>();
    for (const o of opps)
      if (o.lead_id) byLead.set(o.lead_id, [...(byLead.get(o.lead_id) ?? []), o]);
    const map = new Map<
      string,
      {
        leads: number;
        with_opportunity: number;
        opportunities: number;
        value: number;
        status: Record<string, number>;
      }
    >();
    for (const l of leads) {
      const k = label(l[a.group_by]);
      const e = map.get(k) ?? {
        leads: 0,
        with_opportunity: 0,
        opportunities: 0,
        value: 0,
        status: {},
      };
      e.leads++;
      const os = byLead.get(l.lead_id) ?? [];
      if (os.length) e.with_opportunity++;
      for (const o of os) {
        e.opportunities++;
        e.value += num(o.value);
        const s = label(o.status);
        e.status[s] = (e.status[s] ?? 0) + 1;
      }
      map.set(k, e);
    }
    const groups = [...map.entries()]
      .map(([k, e]) => ({
        key: k,
        ...e,
        value: round2(e.value),
        lead_to_opportunity_rate: e.leads ? round2((e.with_opportunity / e.leads) * 100) : null,
      }))
      .sort((x, y) => y.leads - x.leads);
    return ok({
      total_leads: leads.length,
      total_opportunities: opps.length,
      ...slicePage(groups, a.limit, a.offset),
    });
  },
});

export const crmLeadJourney = defineTool({
  name: "crm_lead_journey",
  title: "Jornada de um lead",
  description: "Lead, suas oportunidades e tarefas, cruzados por lead_id.",
  inputSchema: { lead_id: textArg.describe("lead_id do CRM") },
  annotations: readOnly,
  handler: async ({ lead_id }, ctx) => {
    const sb = mcpDb(ctx);
    const by = (q: Parameters<Filter>[0]) => q.eq("lead_id", lead_id);
    const [lead, opportunities, tasks] = await Promise.all([
      fetchAllFrom(sb, "mcp_crm_leads", LEAD_COLS, by, "id"),
      fetchAllFrom(sb, "mcp_crm_opportunities", OPP_COLS, by, "created_at"),
      fetchAllFrom(sb, "mcp_crm_tasks", TASK_COLS, by, "created_at"),
    ]);
    if (!lead.length && !opportunities.length && !tasks.length)
      throw new ToolError("Lead não encontrado");
    return ok({ lead: lead[0] ?? null, opportunities, tasks });
  },
});
