import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@lovable.dev/mcp-js";

// ---------- Supabase falso em memória: aplica os filtros e registra tudo o que é chamado ----------

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const touched = new Set<string>();
const writes: string[] = [];
const created: { headers?: Record<string, string> | undefined }[] = [];

class FakeQuery {
  private preds: ((r: Row) => boolean)[] = [];
  private orders: [string, boolean][] = [];
  private from = 0;
  private to = Infinity;
  private cols = "*";
  private count = false;
  private head = false;
  private single = false;
  constructor(private view: string) {}
  select(cols: string, opts?: { count?: string; head?: boolean }) {
    this.cols = cols;
    this.count = !!opts?.count;
    this.head = !!opts?.head;
    return this;
  }
  private add(p: (r: Row) => boolean) {
    this.preds.push(p);
    return this;
  }
  gte(c: string, v: string) {
    return this.add((r) => r[c] != null && String(r[c]) >= v);
  }
  lte(c: string, v: string) {
    return this.add((r) => r[c] != null && String(r[c]) <= v);
  }
  lt(c: string, v: string) {
    return this.add((r) => r[c] != null && String(r[c]) < v);
  }
  eq(c: string, v: unknown) {
    return this.add((r) => r[c] === v);
  }
  in(c: string, vs: unknown[]) {
    return this.add((r) => vs.includes(r[c]));
  }
  ilike(c: string, p: string) {
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    return this.add((r) => re.test(String(r[c] ?? "")));
  }
  not(c: string, op: string, p: string) {
    if (op !== "ilike") throw new Error(`not.${op} não suportado no fake`);
    const q = new FakeQuery(this.view).ilike(c, p);
    return this.add((r) => !q.preds[0]!(r));
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orders.push([c, o?.ascending !== false]);
    return this;
  }
  range(a: number, b: number) {
    this.from = a;
    this.to = b;
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  // Métodos de escrita: nunca devem ser chamados.
  insert() {
    writes.push(`insert:${this.view}`);
    return this;
  }
  update() {
    writes.push(`update:${this.view}`);
    return this;
  }
  upsert() {
    writes.push(`upsert:${this.view}`);
    return this;
  }
  delete() {
    writes.push(`delete:${this.view}`);
    return this;
  }
  then<A, B>(ok?: ((v: unknown) => A) | null, ko?: ((e: unknown) => B) | null) {
    return Promise.resolve(this.run()).then(ok, ko);
  }
  private run() {
    let rows = (db[this.view] ?? []).filter((r) => this.preds.every((p) => p(r)));
    const total = rows.length;
    rows = [...rows].sort((x, y) => {
      for (const [c, asc] of this.orders) {
        const a = String(x[c] ?? "");
        const b = String(y[c] ?? "");
        if (a !== b) return (a < b ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    rows = rows.slice(this.from, this.to + 1);
    const cols = this.cols.split(",").map((c) => c.trim());
    const proj = cols.includes("*")
      ? rows
      : rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    if (this.head) return { data: null, error: null, count: total };
    if (this.single) return { data: proj[0] ?? null, error: null };
    return { data: proj, error: null, count: this.count ? total : null };
  }
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    _key: string,
    opts: { global?: { headers?: Record<string, string> } },
  ) => {
    created.push({ headers: opts.global?.headers });
    return {
      from: (view: string) => {
        touched.add(view);
        return new FakeQuery(view);
      },
      rpc: () => {
        writes.push("rpc");
        throw new Error("rpc proibido");
      },
    };
  },
}));

const { MCP_VIEWS, mcpDb, assertMcpAccess } = await import("./supabase");
const { TOOLS } = await import("./tools");
const { DATASETS, RELATIONSHIPS } = await import("./catalog");
const mcpDef = (await import("./index")).default;

const USER = "11111111-1111-1111-1111-111111111111";
const ctx = (
  over: Partial<{ auth: boolean; user: string; role: string; token: string | undefined }> = {},
) => {
  const o = { auth: true, user: USER, role: "mcp_reader", token: "jwt-token", ...over };
  return {
    isAuthenticated: () => o.auth,
    getToken: () => o.token,
    getUserId: () => o.user,
    getClaims: () => ({ sub: o.user, role: o.role }),
  } as unknown as AuthContext;
};

type AnyTool = {
  name: string;
  handler: (a: unknown, c: AuthContext) => Promise<{ structuredContent?: Record<string, unknown> }>;
};
const tool = (name: string) => {
  const t = (TOOLS as unknown as AnyTool[]).find((x) => x.name === name);
  if (!t) throw new Error(`ferramenta ${name} não registrada`);
  return t;
};
/** Executa a ferramenta como o servidor MCP faria: valida os argumentos com o schema zod. */
async function call(name: string, args: Record<string, unknown> = {}, c = ctx()) {
  const t = (
    TOOLS as unknown as (AnyTool & { inputSchema?: Record<string, import("zod").ZodType> })[]
  ).find((x) => x.name === name)!;
  const { z } = await import("zod");
  const parsed = z
    .object(t.inputSchema ?? {})
    .strict()
    .parse(args);
  const r = await t.handler(parsed, c);
  return r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    mcp_meta_ads_metrics: [
      {
        id: "m1",
        date: "2026-01-05",
        campaign_name: "Meta Orlando",
        campaign_id: "1",
        spend: 100,
        clicks: 50,
        impressions: 1000,
        utm_campaign: "orl",
      },
      {
        id: "m2",
        date: "2026-02-05",
        campaign_name: "Meta Orlando",
        campaign_id: "1",
        spend: 999,
        clicks: 1,
        impressions: 1,
        utm_campaign: "orl",
      },
    ],
    mcp_google_ads_metrics: [
      {
        id: "g1",
        date: "2026-01-31",
        campaign_name: "Search",
        campaign_id: "2",
        spend: 50,
        clicks: 25,
        impressions: 500,
        utm_campaign: "search",
        conversions: 3,
        created_at: "2026-02-01T00:00:00Z",
      },
    ],
    mcp_marketing_team_costs: [
      { month: "2026-01", amount: 3100, updated_at: "2026-01-01T00:00:00Z" },
    ],
    mcp_crm_leads: [
      {
        id: "l1",
        lead_id: "L1",
        name: "Lead 1",
        stage_name: "Novo",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "orl",
        lead_origin: "Meta Ads",
        first_connection_name: null,
        seller_name: "Ana",
        created_at: "2026-01-02T10:00:00Z",
        updated_at: "2026-01-02T10:00:00Z",
        first_response_at: "2026-01-02T10:30:00Z",
      },
      {
        id: "l2",
        lead_id: "L2",
        name: "Lead 2",
        stage_name: "Novo",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "search",
        lead_origin: "Google Ads",
        first_connection_name: null,
        seller_name: "Bruno",
        created_at: "2026-01-31T23:00:00Z",
        updated_at: "2026-01-31T23:00:00Z",
        first_response_at: null,
      },
      {
        id: "l3",
        lead_id: "L3",
        name: "Lead 3",
        stage_name: "Ganho",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "orl",
        lead_origin: "Meta Ads",
        first_connection_name: null,
        seller_name: "Ana",
        created_at: "2026-01-15T12:00:00Z",
        updated_at: "2026-01-20T12:00:00Z",
        first_response_at: "2026-01-15T13:00:00Z",
      },
      {
        id: "l4",
        lead_id: "L4",
        name: "Fora",
        stage_name: "Novo",
        utm_source: "meta",
        utm_medium: "cpc",
        utm_campaign: "orl",
        lead_origin: "Meta Ads",
        first_connection_name: null,
        seller_name: "Ana",
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        first_response_at: null,
      },
    ],
    mcp_crm_opportunities: [
      {
        id: "o1",
        opportunity_id: "O1",
        lead_id: "L1",
        name: "Op 1",
        stage_name: "Proposta",
        status: "open",
        seller_name: "Ana",
        value: 500,
        pending_tasks: 1,
        total_tasks: 2,
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
        pipeline_step_id: 1,
        pipeline_name: "Vendas",
      },
      {
        id: "o2",
        opportunity_id: "O2",
        lead_id: "L3",
        name: "Op 3",
        stage_name: "Ganho",
        status: "won",
        seller_name: "Ana",
        value: 1500,
        pending_tasks: 0,
        total_tasks: 1,
        created_at: "2026-01-16T00:00:00Z",
        updated_at: "2026-01-20T00:00:00Z",
        pipeline_step_id: 2,
        pipeline_name: "Vendas",
      },
      {
        id: "o3",
        opportunity_id: "O3",
        lead_id: "Lx",
        name: "Sem lead",
        stage_name: "Ganho",
        status: "won",
        seller_name: "Bruno",
        value: 99,
        pending_tasks: 0,
        total_tasks: 0,
        created_at: "2026-01-16T00:00:00Z",
        updated_at: "2026-01-20T00:00:00Z",
        pipeline_step_id: 2,
        pipeline_name: "Vendas",
      },
    ],
    mcp_crm_tasks: [
      {
        id: "t1",
        task_id: "T1",
        user_name: "Ana",
        lead_id: "L1",
        completed: false,
        due_date: "2026-01-04",
        created_at: "2026-01-02T00:00:00Z",
        completed_at: null,
      },
      {
        id: "t2",
        task_id: "T2",
        user_name: "Ana",
        lead_id: "L3",
        completed: true,
        due_date: "2026-01-17",
        created_at: "2026-01-15T00:00:00Z",
        completed_at: "2026-01-16T00:00:00Z",
      },
    ],
    mcp_reservations: [
      {
        id: "r1",
        reservation_id: "ORC-1",
        customer_key: "kA",
        car_category: "SUV",
        rental_days: 5,
        total_amount: 1000,
        discount_amount: 50,
        rack_rate: 1050,
        miscellaneous_price: 0,
        additional_charges_price: 0,
        status: "confirmed",
        utm_campaign: "orl",
        seller_name: "Ana",
        commission_partner: null,
        created_at: "2026-01-10T12:00:00Z",
        pick_up_at: "2026-03-01T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
      },
      {
        id: "r2",
        reservation_id: "ORC-2",
        customer_key: "kB",
        car_category: "Minivan",
        rental_days: 10,
        total_amount: 3000,
        discount_amount: 0,
        rack_rate: 3000,
        miscellaneous_price: 0,
        additional_charges_price: 0,
        status: "open",
        utm_campaign: "search",
        seller_name: "Bruno",
        commission_partner: "Gio Concierge",
        created_at: "2026-01-31T23:30:00Z",
        pick_up_at: "2026-03-02T10:00:00Z",
        return_at: "2026-03-12T10:00:00Z",
      },
      {
        id: "r3",
        reservation_id: "ORC-3",
        customer_key: "kA",
        car_category: "SUV",
        rental_days: 3,
        total_amount: 700,
        discount_amount: 0,
        rack_rate: 700,
        miscellaneous_price: 0,
        additional_charges_price: 0,
        status: "cancelled",
        utm_campaign: "orl",
        seller_name: "Ana",
        commission_partner: null,
        created_at: "2026-01-20T12:00:00Z",
        pick_up_at: "2026-03-03T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
      },
      {
        id: "r4",
        reservation_id: "ORC-4",
        customer_key: "kA",
        car_category: "SUV",
        rental_days: 2,
        total_amount: 400,
        discount_amount: 0,
        rack_rate: 400,
        miscellaneous_price: 0,
        additional_charges_price: 0,
        status: "confirmed",
        utm_campaign: null,
        seller_name: null,
        commission_partner: null,
        created_at: "2026-02-01T00:00:00Z",
        pick_up_at: "2026-04-01T10:00:00Z",
        return_at: "2026-04-03T10:00:00Z",
      },
    ],
    mcp_reservation_segments: [
      {
        reservation_id: "ORC-1",
        seq: 0,
        status: "confirmed",
        pick_up_at: "2026-03-01T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
      },
      {
        reservation_id: "ORC-2",
        seq: 0,
        status: "open",
        pick_up_at: "2026-03-02T10:00:00Z",
        return_at: "2026-03-12T10:00:00Z",
      },
      {
        reservation_id: "ORC-4",
        seq: 0,
        status: "confirmed",
        pick_up_at: "2026-04-01T10:00:00Z",
        return_at: "2026-04-03T10:00:00Z",
      },
    ],
    mcp_reservation_status_history: [
      {
        id: 1,
        reservation_id: "ORC-3",
        from_status: null,
        to_status: "open",
        changed_at: "2026-01-20T12:00:00Z",
      },
      {
        id: 2,
        reservation_id: "ORC-3",
        from_status: "open",
        to_status: "cancelled",
        changed_at: "2026-01-25T12:00:00Z",
      },
      {
        id: 3,
        reservation_id: "ORC-1",
        from_status: null,
        to_status: "confirmed",
        changed_at: "2026-01-10T12:00:00Z",
      },
    ],
    mcp_reservation_onboarding: [
      {
        reservation_id: "ORC-1",
        realizado: true,
        responsavel: "Lizie",
        updated_at: "2026-02-20T00:00:00Z",
      },
    ],
    mcp_reservas: [
      {
        id: "c1",
        hq_reservation_id: "2",
        commission_partner: "Gio Concierge",
        seller_name: "Bruno",
        created_at: "2026-01-31T23:30:00Z",
        total_price: 3000,
        total_paid: 3000,
        rack_rate: 3000,
        commission_rate: 10,
        valor_comissao: 300,
        valor_repasse: 300,
        desconto: 0,
        manual_charge: 0,
        status_repasse: "pendente",
        paga_em: null,
        hq_status: "open",
        liberada: true,
        retida_agencia: false,
        exige_validacao: false,
        currency: "USD",
      },
    ],
    mcp_commission_partners: [
      { name: "Gio Concierge", updated_at: "2026-01-01T00:00:00Z" },
      { name: "Sem reservas", updated_at: "2026-01-01T00:00:00Z" },
    ],
    mcp_our_rate_snapshots: [
      {
        id: "q1",
        collected_at: "2026-01-01T00:00:00Z",
        pickup_date: "2026-03-01",
        category: "SUV",
        daily_rate: 80,
        season: "alta",
        source: "hq_tabela",
        currency: "USD",
      },
      {
        id: "q2",
        collected_at: "2026-01-10T00:00:00Z",
        pickup_date: "2026-03-01",
        category: "SUV",
        daily_rate: 90,
        season: "alta",
        source: "hq_tabela",
        currency: "USD",
      },
      {
        id: "q3",
        collected_at: "2026-01-10T00:00:00Z",
        pickup_date: "2026-03-01",
        category: "Minivan",
        daily_rate: 120,
        season: "alta",
        source: "hq_tabela",
        currency: "USD",
      },
    ],
    mcp_pricing_occupancy_forecast: [
      {
        id: "f1",
        generated_at: "2026-01-01T00:00:00Z",
        as_of: "2026-01-01",
        payload: { categorias: ["SUV"], linhas: [] },
      },
      {
        id: "f2",
        generated_at: "2026-01-10T00:00:00Z",
        as_of: "2026-01-10",
        payload: {
          categorias: ["SUV", "Minivan"],
          linhas: [
            {
              d: "2026-03-01",
              c: "SUV",
              f: 10,
              v: 5,
              o: 0.5,
              e: 0.8,
              lo: 0.7,
              hi: 0.9,
              n: 30,
              b: "saz",
              s: "alta",
            },
            {
              d: "2026-03-01",
              c: "Minivan",
              f: 30,
              v: 15,
              o: 0.5,
              e: 0.4,
              lo: 0.3,
              hi: 0.5,
              n: 30,
              b: "saz",
              s: "alta",
            },
          ],
        },
      },
    ],
    mcp_pricing_occupancy_pace: [
      {
        id: "p1",
        generated_at: "2026-01-10T00:00:00Z",
        as_of: "2026-01-10",
        payload: {
          versao: 7,
          categorias: ["SUV"],
          linhas: [
            { d: "2026-03-01", c: "SUV", f: 10, a: [10, 20, 30], m: [80, 90, 100], x: [[5, 2]] },
          ],
        },
      },
    ],
    mcp_pricing_study_report: [
      {
        id: "s1",
        generated_at: "2026-01-05T00:00:00Z",
        period_start: "2026-03-01",
        period_end: "2026-03-31",
      },
    ],
    mcp_fleet_vehicles: [
      {
        id: 1,
        entry_date: "2025-06-01T00:00:00Z",
        exit_date: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        entry_date: "2026-01-15T00:00:00Z",
        exit_date: null,
        updated_at: "2026-01-15T00:00:00Z",
      },
      {
        id: 3,
        entry_date: "2025-01-01T00:00:00Z",
        exit_date: "2026-01-20T00:00:00Z",
        updated_at: "2026-01-20T00:00:00Z",
      },
    ],
    mcp_fleet_stats: [{ id: 1, vehicles: 2, updated_at: "2026-01-20T00:00:00Z" }],
    mcp_competitors: [
      {
        id: "c-a",
        name: "Alamo",
        kind: "tradicional",
        active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c-f",
        name: "Florida",
        kind: "direto",
        active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    mcp_competitor_category_map: [
      { competitor_id: "c-a", source_category: "Midsize SUV", normalized_category: "SUV" },
    ],
    mcp_competitor_price_snapshots: [
      {
        id: "x1",
        competitor_id: "c-a",
        source: "api",
        source_url: null,
        location: "MCO",
        source_category: "Midsize SUV",
        normalized_category: "SUV",
        collected_at: "2026-01-10T00:00:00Z",
        pickup_at: "2026-03-01T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
        total_price: 500,
        daily_price: 100,
        currency: "USD",
        taxes_included: false,
        protections: null,
        mileage: null,
        cancellation_policy: null,
        payment_conditions: null,
        available: true,
        equivalence: "equivalente",
        equivalence_notes: null,
        created_at: "2026-01-10T00:00:00Z",
      },
      {
        id: "x2",
        competitor_id: "c-a",
        source: "api",
        source_url: null,
        location: "MCO",
        source_category: "Midsize SUV",
        normalized_category: "SUV",
        collected_at: "2026-01-11T00:00:00Z",
        pickup_at: "2026-03-01T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
        total_price: 600,
        daily_price: 120,
        currency: "USD",
        taxes_included: false,
        protections: null,
        mileage: null,
        cancellation_policy: null,
        payment_conditions: null,
        available: true,
        equivalence: "equivalente",
        equivalence_notes: null,
        created_at: "2026-01-11T00:00:00Z",
      },
      {
        id: "x3",
        competitor_id: "c-f",
        source: "site",
        source_url: null,
        location: "MCO",
        source_category: "Van",
        normalized_category: "Minivan",
        collected_at: "2026-01-11T00:00:00Z",
        pickup_at: "2026-03-01T10:00:00Z",
        return_at: "2026-03-06T10:00:00Z",
        total_price: null,
        daily_price: null,
        currency: "USD",
        taxes_included: null,
        protections: null,
        mileage: null,
        cancellation_policy: null,
        payment_conditions: null,
        available: false,
        equivalence: "nao_avaliada",
        equivalence_notes: null,
        created_at: "2026-01-11T00:00:00Z",
      },
    ],
    mcp_sales_goals: [
      {
        id: "sg1",
        seller_name: "Ana",
        month: "2026-01",
        revenue_goal: 2000,
        ticket_goal: 800,
        conversion_goal: 0.2,
        discount_goal: 0.05,
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "sg2",
        seller_name: "__orc_global_goal__",
        month: "2026-01",
        revenue_goal: 8000,
        ticket_goal: 900,
        conversion_goal: null,
        discount_goal: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    mcp_sync_runs: [
      { service: "hqrentals", last_success_at: new Date(Date.now() - 2 * 3_600_000).toISOString() },
      { service: "kommo", last_success_at: new Date(Date.now() - 48 * 3_600_000).toISOString() },
    ],
  });
}

/** Argumentos de exemplo que exercitam cada ferramenta (inclusive cruzamentos). */
const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  list_available_datasets: {},
  describe_dataset: { dataset: "mcp_reservations" },
  marketing_summary: { from: "2026-01-01", to: "2026-01-31" },
  ads_performance: {
    from: "2026-01-01",
    to: "2026-01-31",
    group_by: "utm_campaign",
    include_funnel: true,
  },
  marketing_team_costs: { from_month: "2026-01" },
  crm_leads: { from: "2026-01-01", to: "2026-01-31" },
  crm_opportunities: { from: "2026-01-01", to: "2026-01-31", group_by: "status" },
  crm_tasks: { from: "2026-01-01", to: "2026-01-31" },
  crm_funnel: { from: "2026-01-01", to: "2026-01-31" },
  crm_lead_journey: { lead_id: "L1" },
  sales_by_seller: { from: "2026-01-01", to: "2026-01-31" },
  reservations_report: { from: "2026-01-01", to: "2026-01-31" },
  reservation_details: { reservation_id: "ORC-1" },
  reservation_segments: { from: "2026-03-05", to: "2026-03-05" },
  reservation_status_changes: { from: "2026-01-01", to: "2026-01-31" },
  reservation_onboarding_report: { from: "2026-03-01", to: "2026-03-31" },
  commissions_report: { from: "2026-01-01", to: "2026-01-31" },
  commission_partners: {},
  our_rates: { from: "2026-03-01", to: "2026-03-31" },
  occupancy_forecast: { from: "2026-03-01", to: "2026-03-31" },
  occupancy_pace: {},
  pricing_study_reports: {},
  fleet_overview: { date: "2026-01-31", from: "2026-01-01", to: "2026-01-31" },
  competitors: { include_category_map: true },
  competitor_prices: { pickup_from: "2026-03-01", pickup_to: "2026-03-01" },
  sales_goals_progress: { from_month: "2026-01" },
  sync_status: {},
  customers_summary: {},
};

beforeEach(() => {
  seed();
  touched.clear();
  writes.length = 0;
  created.length = 0;
  vi.stubEnv("MCP_ALLOWED_USER_ID", USER);
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk_test");
});
afterEach(() => vi.unstubAllEnvs());

// ---------- 1 e 2: cobertura e registro ----------

describe("cobertura e registro", () => {
  it("as 23 views estão no catálogo e na whitelist", () => {
    expect(MCP_VIEWS).toHaveLength(23);
    expect(DATASETS.map((d) => d.view).sort()).toEqual([...MCP_VIEWS].sort());
  });

  it("todas as ferramentas estão registradas no servidor MCP, sem nomes repetidos", () => {
    const names = (mcpDef.tools as readonly { name: string }[]).map((t) => t.name);
    expect(names).toEqual((TOOLS as readonly { name: string }[]).map((t) => t.name));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "marketing_summary",
        "sales_by_seller",
        "list_available_datasets",
        "describe_dataset",
      ]),
    );
    expect(Object.keys(SAMPLE_ARGS).sort()).toEqual([...names].sort());
  });

  it("toda ferramenta citada no catálogo existe e toda ferramenta é somente leitura", () => {
    const names = new Set((TOOLS as readonly { name: string }[]).map((t) => t.name));
    for (const d of DATASETS)
      for (const t of d.tools) expect(names.has(t), `${d.view} → ${t}`).toBe(true);
    for (const t of TOOLS as readonly { name: string; annotations?: { readOnlyHint?: boolean } }[])
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
  });

  it("executar todas as ferramentas consulta as 23 views e nenhuma outra", async () => {
    for (const [name, args] of Object.entries(SAMPLE_ARGS)) await call(name, args);
    expect([...touched].sort()).toEqual([...MCP_VIEWS].sort());
  });

  it("relacionamentos citam apenas colunas existentes no catálogo", () => {
    const cols = new Set(DATASETS.flatMap((d) => d.columns.map(([c]) => `${d.view}.${c}`)));
    for (const r of RELATIONSHIPS) {
      for (const ref of [r.from, ...r.to.split(" / ")])
        expect(cols.has(ref.trim()), ref).toBe(true);
    }
  });

  it("describe_dataset devolve colunas reais", async () => {
    const r = await call("describe_dataset", { dataset: "mcp_reservations" });
    expect(r["columns"].map((c: { name: string }) => c.name)).toContain("car_category");
    expect(r["columns"].map((c: { name: string }) => c.name)).not.toContain("customer_email");
  });
});

// ---------- 3: filtros e datas ----------

describe("filtros e intervalos de datas", () => {
  it("período inclusivo até 23:59:59 do último dia e exclui canceladas por padrão", async () => {
    const r = await call("reservations_report", { from: "2026-01-01", to: "2026-01-31" });
    expect(r["totals"]).toMatchObject({
      reservations: 2,
      revenue: 4000,
      rental_days: 15,
      avg_ticket: 2000,
    });
    expect(r["rows"].map((x: { reservation_id: string }) => x.reservation_id).sort()).toEqual([
      "ORC-1",
      "ORC-2",
    ]);
  });

  it("filtra por categoria, vendedor, status e data de retirada", async () => {
    const suv = await call("reservations_report", {
      from: "2026-01-01",
      to: "2026-12-31",
      category: "SUV",
      status_mode: "all",
    });
    expect(suv["totals"].reservations).toBe(3);
    const ana = await call("reservations_report", {
      from: "2026-01-01",
      to: "2026-12-31",
      seller: "an",
      status_mode: "cancelled",
    });
    expect(ana["rows"].map((x: { reservation_id: string }) => x.reservation_id)).toEqual(["ORC-3"]);
    const pickup = await call("reservations_report", {
      from: "2026-04-01",
      to: "2026-04-30",
      date_field: "pick_up_at",
    });
    expect(pickup["totals"].reservations).toBe(1);
  });

  it("agrupa por categoria com métricas corretas", async () => {
    const r = await call("reservations_report", {
      from: "2026-01-01",
      to: "2026-01-31",
      group_by: "car_category",
    });
    expect(r["rows"]).toEqual([
      expect.objectContaining({
        key: "Minivan",
        reservations: 1,
        revenue: 3000,
        avg_daily_rate: 300,
      }),
      expect.objectContaining({ key: "SUV", reservations: 1, revenue: 1000, discount: 50 }),
    ]);
  });

  it("marketing_summary soma só o período e rateia o custo da equipe", async () => {
    const { summary } = await call("marketing_summary", { from: "2026-01-01", to: "2026-01-31" });
    expect(summary).toMatchObject({
      meta_spend: 100,
      google_spend: 50,
      total_spend: 150,
      team_cost: 3100,
      leads: 3,
      reservations: 2,
      cancelled_reservations: 1,
      revenue: 4000,
      cpl: 50,
      roas: 26.67,
    });
  });

  it("sales_by_seller separa canceladas e agrupa venda direta", async () => {
    const { sellers } = await call("sales_by_seller", { from: "2026-01-01", to: "2026-02-28" });
    expect(sellers).toEqual([
      expect.objectContaining({ seller: "Bruno", reservations: 1, revenue: 3000 }),
      expect.objectContaining({
        seller: "Ana",
        reservations: 1,
        revenue: 1000,
        cancelled: 1,
        cancellation_rate: 50,
      }),
      expect.objectContaining({ seller: "Venda Direta / Site", reservations: 1, revenue: 400 }),
    ]);
  });

  it("our_rates usa a coleta mais recente por data e categoria", async () => {
    const r = await call("our_rates", { from: "2026-03-01", to: "2026-03-01", category: "SUV" });
    expect(r["rows"]).toEqual([expect.objectContaining({ daily_rate: 90 })]);
  });

  it("occupancy_forecast usa a geração mais recente e pondera o total do dia pela frota", async () => {
    const r = await call("occupancy_forecast", { group_by: "date" });
    expect(r["as_of"]).toBe("2026-01-10");
    expect(r["rows"]).toEqual([
      {
        date: "2026-03-01",
        fleet: 40,
        sold_days: 20,
        occupancy: 0.5,
        expected: 0.5,
        expected_low: 0.4,
        expected_high: 0.6,
      },
    ]);
  });

  it("occupancy_pace resume antecedência, cancelamentos e receita", async () => {
    const r = await call("occupancy_pace", {});
    expect(r["rows"]).toEqual([
      expect.objectContaining({
        sold_days: 3,
        avg_lead_time_days: 20,
        cancelled_days: 1,
        revenue: 270,
        occupancy: 0.3,
      }),
    ]);
  });

  it("fleet_overview conta veículos ativos na data e movimentação", async () => {
    const r = await call("fleet_overview", {
      date: "2026-01-31",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(r["active_vehicles"]).toBe(2);
    expect(r["movement_by_month"]).toEqual([{ month: "2026-01", entries: 1, exits: 1 }]);
  });

  it("crm_tasks com overdue_only traz só pendentes vencidas", async () => {
    const r = await call("crm_tasks", { overdue_only: true });
    expect(r["rows"].map((t: { task_id: string }) => t.task_id)).toEqual(["T1"]);
  });

  it("sync_status marca integrações desatualizadas", async () => {
    const r = await call("sync_status", { stale_after_hours: 24 });
    expect(r["rows"]).toEqual([
      expect.objectContaining({ service: "hqrentals", stale: false }),
      expect.objectContaining({ service: "kommo", stale: true }),
    ]);
  });

  it("recusa datas inválidas, período invertido e colunas de ordenação fora da lista", async () => {
    await expect(
      call("reservations_report", { from: "01/01/2026", to: "2026-01-31" }),
    ).rejects.toThrow();
    await expect(
      call("reservations_report", { from: "2026-02-01", to: "2026-01-01" }),
    ).rejects.toThrow(/anterior/);
    await expect(
      call("crm_leads", { from: "2026-01-01", to: "2026-01-31", sort_by: "name; drop table" }),
    ).rejects.toThrow();
    await expect(
      call("reservations_report", { from: "2026-01-01", to: "2026-01-31", raw_sql: "select 1" }),
    ).rejects.toThrow();
  });
});

describe("clientes", () => {
  it("customers_summary conta clientes únicos, novos e recorrentes sem expor dados pessoais", async () => {
    const all = await call("customers_summary", {});
    expect(all).toMatchObject({
      unique_customers: 2,
      reservations: 3,
      customers_with_more_than_one_reservation: 1,
    });
    const feb = await call("customers_summary", { from: "2026-02-01", to: "2026-02-28" });
    expect(feb).toMatchObject({ unique_customers: 1, new_customers: 0, returning_customers: 1 });
    const jan = await call("customers_summary", {
      from: "2026-01-01",
      to: "2026-01-31",
      include_cancelled: true,
    });
    expect(jan).toMatchObject({ unique_customers: 2, new_customers: 2, reservations: 3 });
  });
});

// ---------- 4: paginação ----------

describe("paginação", () => {
  it("lista paginada com total, has_more e next_offset", async () => {
    const p1 = await call("crm_leads", {
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 2,
      sort_by: "created_at",
      ascending: true,
    });
    expect(p1).toMatchObject({ total: 3, limit: 2, offset: 0, has_more: true, next_offset: 2 });
    expect(p1["rows"].map((r: { lead_id: string }) => r.lead_id)).toEqual(["L1", "L3"]);
    const p2 = await call("crm_leads", {
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 2,
      offset: 2,
      sort_by: "created_at",
      ascending: true,
    });
    expect(p2).toMatchObject({ total: 3, has_more: false, next_offset: null });
    expect(p2["rows"].map((r: { lead_id: string }) => r.lead_id)).toEqual(["L2"]);
  });

  it("limite máximo de 500 linhas", async () => {
    await expect(
      call("crm_leads", { from: "2026-01-01", to: "2026-01-31", limit: 501 }),
    ).rejects.toThrow();
  });

  it("varredura lê todos os blocos de 1000 e recusa passar do teto", async () => {
    const { fetchAllFrom, MAX_SCAN_ROWS } = await import("./tools/paginate");
    db["mcp_crm_tasks"] = Array.from({ length: 2500 }, (_, i) => ({
      id: String(i).padStart(5, "0"),
    }));
    const all = await fetchAllFrom(mcpDb(ctx()), "mcp_crm_tasks", "id", (q) => q, "id");
    expect(all).toHaveLength(2500);
    expect(new Set(all.map((r) => (r as { id: string }).id)).size).toBe(2500);
    db["mcp_crm_tasks"] = Array.from({ length: MAX_SCAN_ROWS + 1 }, (_, i) => ({
      id: String(i).padStart(6, "0"),
    }));
    await expect(fetchAllFrom(mcpDb(ctx()), "mcp_crm_tasks", "id", (q) => q, "id")).rejects.toThrow(
      /excede/,
    );
  });
});

// ---------- 5: cruzamentos ----------

describe("consultas cruzadas", () => {
  it("crm_funnel liga leads e oportunidades por lead_id (ignora oportunidade sem lead do período)", async () => {
    const r = await call("crm_funnel", {
      from: "2026-01-01",
      to: "2026-01-31",
      group_by: "seller_name",
    });
    expect(r["total_opportunities"]).toBe(2);
    const ana = r["rows"].find((g: { key: string }) => g.key === "Ana");
    expect(ana).toMatchObject({
      leads: 2,
      with_opportunity: 2,
      value: 2000,
      lead_to_opportunity_rate: 100,
      status: { open: 1, won: 1 },
    });
    expect(r["rows"].find((g: { key: string }) => g.key === "Bruno")).toMatchObject({
      leads: 1,
      with_opportunity: 0,
    });
  });

  it("crm_lead_journey junta lead, oportunidades e tarefas do mesmo lead_id", async () => {
    const r = await call("crm_lead_journey", { lead_id: "L1" });
    expect(r["lead"].lead_id).toBe("L1");
    expect(r["opportunities"]).toHaveLength(1);
    expect(r["tasks"]).toHaveLength(1);
  });

  it("reservation_details junta trechos, histórico e onboarding por reservation_id", async () => {
    const r = await call("reservation_details", { reservation_id: "ORC-1" });
    expect(r["segments"]).toHaveLength(1);
    expect(r["status_history"]).toHaveLength(1);
    expect(r["onboarding"]).toMatchObject({ realizado: true, responsavel: "Lizie" });
  });

  it("reservation_onboarding_report cruza reservas confirmadas com onboarding", async () => {
    const r = await call("reservation_onboarding_report", { from: "2026-03-01", to: "2026-03-31" });
    expect(r["summary"]).toEqual({
      reservations: 2,
      realizados: 1,
      pendentes: 1,
      by_responsavel: { Lizie: 1 },
    });
  });

  it("ads_performance com funil cruza por utm_campaign", async () => {
    const r = await call("ads_performance", {
      from: "2026-01-01",
      to: "2026-01-31",
      group_by: "utm_campaign",
      include_funnel: true,
    });
    const orl = r["rows"].find((g: { key: string }) => g.key === "orl");
    expect(orl).toMatchObject({
      spend: 100,
      leads: 2,
      reservations: 1,
      revenue: 1000,
      cpl: 50,
      roas: 10,
    });
  });

  it("sales_goals_progress compara meta do vendedor e meta geral com reservas do mês", async () => {
    const r = await call("sales_goals_progress", { from_month: "2026-01" });
    expect(r["goals"]).toEqual([
      expect.objectContaining({
        seller: "empresa (meta geral)",
        revenue_actual: 4000,
        revenue_attainment_pct: 50,
      }),
      expect.objectContaining({
        seller: "Ana",
        revenue_actual: 1000,
        revenue_attainment_pct: 50,
        reservations: 1,
      }),
    ]);
  });

  it("competitor_prices traz o nome do concorrente via competitor_id e resume a diária", async () => {
    const r = await call("competitor_prices", {
      pickup_from: "2026-03-01",
      pickup_to: "2026-03-01",
    });
    expect(r["rows"]).toEqual([
      expect.objectContaining({
        key: "Alamo | SUV",
        quotes: 2,
        min_daily: 100,
        avg_daily: 110,
        max_daily: 120,
      }),
      expect.objectContaining({
        key: "Florida | Minivan",
        quotes: 1,
        unavailable: 1,
        priced: 0,
        avg_daily: null,
      }),
    ]);
  });

  it("commission_partners conta reservas comissionadas pelo nome do parceiro", async () => {
    const r = await call("commission_partners", {});
    expect(r["partners"]).toEqual([
      expect.objectContaining({ name: "Gio Concierge", commissioned_reservations: 1 }),
      expect.objectContaining({ name: "Sem reservas", commissioned_reservations: 0 }),
    ]);
  });
});

// ---------- 6, 7 e 8: segurança ----------

describe("segurança", () => {
  const denied: [string, ReturnType<typeof ctx>][] = [
    ["sem autenticação", ctx({ auth: false })],
    ["outro usuário", ctx({ user: "22222222-2222-2222-2222-222222222222" })],
    ["role errada", ctx({ role: "authenticated" })],
    ["sem token", ctx({ token: undefined })],
  ];

  it.each(denied)("bloqueia %s em todas as ferramentas, sem tocar no banco", async (_label, c) => {
    for (const [name, args] of Object.entries(SAMPLE_ARGS))
      await expect(call(name, args, c), name).rejects.toThrow();
    expect(touched.size).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("falha fechado sem MCP_ALLOWED_USER_ID configurado", async () => {
    vi.stubEnv("MCP_ALLOWED_USER_ID", "");
    expect(() => assertMcpAccess(ctx())).toThrow(/não configurado/);
    await expect(call("sync_status")).rejects.toThrow();
  });

  it("usa o Bearer do próprio usuário (sem service role)", async () => {
    await call("sync_status");
    expect(created[0]?.headers).toEqual({ Authorization: "Bearer jwt-token" });
  });

  it("o cliente MCP só expõe `from` e recusa relações fora da whitelist", () => {
    const sb = mcpDb(ctx());
    expect(Object.keys(sb)).toEqual(["from"]);
    for (const t of [
      "reservations",
      "crm_leads",
      "user_roles",
      "mcp_unknown",
      "pg_catalog.pg_tables",
      "mcp_reservations;drop",
    ])
      expect(() => sb.from(t as never), t).toThrow("Consulta não permitida");
    expect(touched.size).toBe(0);
  });

  it("nenhuma ferramenta escreve ou chama rpc", async () => {
    for (const [name, args] of Object.entries(SAMPLE_ARGS)) await call(name, args);
    expect(writes).toEqual([]);
  });

  it("o código das ferramentas não contém escrita, rpc ou acesso a tabelas fora das views", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "tools");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src, f).not.toMatch(/service_role|SERVICE_ROLE/);
      for (const m of src.matchAll(/["'](mcp_[a-z_]+)["']/g))
        expect(MCP_VIEWS as readonly string[], `${f}: ${m[1]}`).toContain(m[1]);
    }
  });

  it("não expõe colunas de dados pessoais retiradas das views", async () => {
    const out: string[] = [];
    for (const [name, args] of Object.entries(SAMPLE_ARGS))
      out.push(JSON.stringify(await call(name, args)));
    const all = out.join("\n");
    for (const col of [
      "customer_email",
      "customer_phone",
      "email_lc",
      "phone8",
      "internal_notes",
      '"html"',
    ])
      expect(all).not.toContain(col);
  });
});
