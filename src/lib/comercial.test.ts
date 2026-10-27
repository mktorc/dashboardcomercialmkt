import { describe, expect, it } from "vitest";
import { computeComercial, computeMonthlyCommercial, computeOpportunityTotalsBySeller, filterOperationalData, getPreviousPeriod, type ComercialData } from "./comercial";

describe("computeMonthlyCommercial", () => {
  it("calcula conversão, faturamento, reservas, ticket e desconto nos cinco meses", () => {
    const opportunities = [
      { created_at: "2026-10-02T12:00:00Z", seller_name: "Naty" },
      { created_at: "2026-10-03T12:00:00Z", seller_name: "Naty" },
      { created_at: "2026-10-04T12:00:00Z", seller_name: "Thay" },
    ];
    const reservations = [
      { created_at: "2026-10-05T12:00:00Z", seller_name: "Naty", status: "confirmed", total_amount: 900, discount_amount: 100, rack_rate: 800 },
      { created_at: "2026-10-06T12:00:00Z", seller_name: "Naty", status: "confirmed", total_amount: 1100, discount_amount: 100, rack_rate: 1000 },
      { created_at: "2026-10-07T12:00:00Z", seller_name: "Naty", status: "cancelled", total_amount: 500, discount_amount: 500, rack_rate: 0 },
    ];
    const months = computeMonthlyCommercial(opportunities, reservations, "nathalia", "2026-06-01", "2026-10-08");
    const october = months[4];
    expect(months.map((month) => month.mes)).toEqual(["jun/2026", "jul/2026", "ago/2026", "set/2026", "out/2026"]);
    expect(october).toMatchObject({ oportunidades: 2, reservas: 2, faturamento: 1800, conversao: 1, ticket: 900, descontoPct: 200 / 2200 });
  });
});

const stackedData = {
  leads: [],
  opportunities: [],
  reservations: [
    { created_at: "2026-06-15T12:00:00Z", total_amount: 1000, discount_amount: 0, rack_rate: 1000, status: "confirmed", seller_name: "Naty" },
    { created_at: "2026-10-05T12:00:00Z", total_amount: 2000, discount_amount: 0, rack_rate: 2000, status: "confirmed", seller_name: "Naty" },
  ],
  tasks: [],
  goals: [],
  yearReservations: [],
  yearOpportunities: [],
  prevData: { leads: [], reservations: [], opportunities: [] },
} as unknown as ComercialData;

describe("computeComercial", () => {
  it("counts seller opportunities across all dates", () => {
    expect(computeOpportunityTotalsBySeller([
      { seller_name: "Thalita Lima" },
      { seller_name: "Thalita Lima" },
      { seller_name: "Mauro Silva" },
    ])).toEqual([
      { key: "thalita", name: "Thalita Lima", oportunidades: 2, reservas: 0 },
      { key: "mauro", name: "Mauro Silva", oportunidades: 1, reservas: 0 },
    ]);
  });

  it("computes monthly comparison values for the same months in the prior year", () => {
    const data = {
      ...stackedData,
      yearOpportunities: [
        { opportunity_id: "prior", lead_id: "prior", name: null, stage_name: null, status: "open", seller_name: "Naty", pending_tasks: 0, total_tasks: 0, created_at: "2025-10-03T12:00:00Z" },
      ],
      yearReservations: [
        { created_at: "2025-10-04T12:00:00Z", total_amount: 300, discount_amount: 20, rack_rate: 280, status: "confirmed", seller_name: "Naty" },
      ],
    } as unknown as ComercialData;

    const view = computeComercial(data, "2026-10-01", "2026-10-15", "all");

    expect(view.monthlyKpisPreviousYear[0]).toMatchObject({
      monthKey: "2025-10",
      oportunidades: 1,
      reservas: 1,
      faturamento: 280,
      ticket: 280,
    });
  });

  it("filters Operational data to the commercial team and uses HQ rack rate", () => {
    const data = {
      ...stackedData,
      opportunities: [
        { opportunity_id: "nathy", lead_id: "nathy", name: null, stage_name: null, status: "open", seller_name: "Nathy Lima", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T09:00:00Z" },
        { opportunity_id: "mauro", lead_id: "mauro", name: null, stage_name: null, status: "open", seller_name: "Mauro Silva", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T10:00:00Z" },
        { opportunity_id: "gessica", lead_id: "gessica", name: null, stage_name: null, status: "open", seller_name: "Gessica Souza", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T11:00:00Z" },
        { opportunity_id: "thalita", lead_id: "thalita", name: null, stage_name: null, status: "open", seller_name: "Thalita Lima", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
        { opportunity_id: "external", lead_id: "external", name: null, stage_name: null, status: "open", seller_name: "Ana Souza", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T13:00:00Z" },
      ],
      reservations: [
        { created_at: "2026-10-02T09:30:00Z", total_amount: 500, discount_amount: 50, rack_rate: 50, status: "confirmed", seller_name: "Nathy Lima" },
        { created_at: "2026-10-02T10:30:00Z", total_amount: 500, discount_amount: 50, rack_rate: 60, status: "confirmed", seller_name: "Mauro Silva" },
        { created_at: "2026-10-02T11:30:00Z", total_amount: 500, discount_amount: 50, rack_rate: 70, status: "confirmed", seller_name: "Gessica Souza" },
        { created_at: "2026-10-02T14:00:00Z", total_amount: 500, discount_amount: 50, rack_rate: 321, status: "confirmed", seller_name: "Thalita Lima" },
        { created_at: "2026-10-02T15:00:00Z", total_amount: 900, discount_amount: 0, rack_rate: 777, status: "confirmed", seller_name: "Ana Souza" },
      ],
    } as unknown as ComercialData;

    const operationalData = filterOperationalData(data);
    const view = computeComercial(operationalData, "2026-10-01", "2026-10-03", "all", true);

    expect(operationalData.opportunities.map((opportunity) => opportunity.seller_name)).toEqual([
      "Nathy Lima",
      "Mauro Silva",
      "Gessica Souza",
      "Thalita Lima",
    ]);
    expect(view.kpis.faturamento).toBe(501);
    expect(view.dailyRevenueBySeller[1]?.["Thalita Lima"]).toBe(321);
    expect(view.rows.map((row) => row.name)).toContain("Thalita Lima");
    expect(view.rows.map((row) => row.name)).not.toContain("Ana Souza");
  });

  it("usa oportunidades abertas e ganhas do pipeline como base dos leads", () => {
    const data = {
      ...stackedData,
      leads: [
        { lead_id: "outside-pipeline", created_at: "2026-10-01T12:00:00Z", seller_name: "Ana" },
      ],
      opportunities: [
        { opportunity_id: "open", lead_id: "cm-open", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-01T12:00:00Z" },
        { opportunity_id: "won", lead_id: "cm-won", name: null, stage_name: null, status: "won", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
      ],
      tasks: [
        { lead_id: "cm-open", user_name: "Ana", completed: false, due_date: null, created_at: "2026-10-01T12:05:00Z" },
        { lead_id: "cm-won", user_name: "Ana", completed: false, due_date: null, created_at: "2026-10-02T12:15:00Z" },
      ],
    } as unknown as ComercialData;

    const view = computeComercial(data, "2026-10-01", "2026-10-02", "all");
    expect(view.kpis.leads).toBe(2);
    expect(view.kpis.oportunidades).toBe(2);
    expect(view.daily.reduce((total, day) => total + day.leads, 0)).toBe(2);
    expect(view.kpis.slaFormatted).toBe("10 min");
  });

  it("compara oportunidades sem tarefas nos mesmos dias do mês anterior", () => {
    const makeOpportunity = (opportunity_id: string, created_at: string) => ({
      opportunity_id,
      lead_id: opportunity_id,
      name: null,
      stage_name: null,
      status: "open",
      seller_name: "Ana",
      pending_tasks: 0, total_tasks: 0,
      created_at,
    });
    const data = {
      ...stackedData,
      opportunities: [
        makeOpportunity("old", "2026-08-31T12:00:00Z"),
        makeOpportunity("current-1", "2026-10-01T12:00:00Z"),
        makeOpportunity("current-2", "2026-10-02T12:00:00Z"),
        makeOpportunity("current-3", "2026-10-02T13:00:00Z"),
      ],
      prevData: {
        ...stackedData.prevData,
        opportunities: [
          makeOpportunity("previous-1", "2026-09-01T12:00:00Z"),
          makeOpportunity("previous-2", "2026-09-02T12:00:00Z"),
        ],
      },
    } as unknown as ComercialData;

    const view = computeComercial(data, "2026-10-01", "2026-10-02", "all");
    expect(view.kpis.leadsNoTask).toBe(4);
    expect(view.kpis.leadsNoTaskVar).toBe(50);
  });

  it("mantém as datas equivalentes ao mover a janela para o mês anterior", () => {
    expect(getPreviousPeriod("2026-10-01", "2026-10-09")).toEqual({ prevFrom: "2026-09-01", prevTo: "2026-09-09" });
    expect(getPreviousPeriod("2026-03-31", "2026-03-31")).toEqual({ prevFrom: "2026-02-28", prevTo: "2026-02-28" });
  });

  it("agrupa o rack rate por vendedor em cinco meses", () => {
    const view = computeComercial(stackedData, "2026-06-01", "2026-10-08", "all");
    expect(view.monthly.map((month) => month["mes"])).toEqual(["2026/06", "2026/07", "2026/08", "2026/09", "2026/10"]);
    expect(view.monthly[4]?.["Naty"]).toBe(2000);
  });

  it("limita as séries mensais aos meses do período selecionado", () => {
    const view = computeComercial(stackedData, "2026-10-01", "2026-10-08", "all");
    expect(view.monthlyKpis.map((month) => month.mes)).toEqual(["out/2026"]);
    expect(view.monthly.map((month) => month["mes"])).toEqual(["2026/10"]);
    expect(view.monthly[0]?.["Naty"]).toBe(2000);
  });

  it("agrupa oportunidades e faturamento por vendedor e dia dentro do período", () => {
    const data = {
      ...stackedData,
      opportunities: [
        { opportunity_id: "1", lead_id: "1", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-09-30T12:00:00Z" },
        { opportunity_id: "2", lead_id: "2", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-01T12:00:00Z" },
        { opportunity_id: "3", lead_id: "3", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
        { opportunity_id: "4", lead_id: "4", name: null, stage_name: null, status: "open", seller_name: "Bia", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-02T12:00:00Z" },
        { opportunity_id: "5", lead_id: "5", name: null, stage_name: null, status: "open", seller_name: "Ana", pending_tasks: 0, total_tasks: 0, created_at: "2026-10-05T12:00:00Z" },
      ],
      reservations: [
        { created_at: "2026-10-01T12:00:00Z", total_amount: 100, discount_amount: 10, rack_rate: 90, status: "confirmed", seller_name: "Ana" },
        { created_at: "2026-10-02T12:00:00Z", total_amount: 200, discount_amount: 20, rack_rate: 180, status: "confirmed", seller_name: "Bia" },
        { created_at: "2026-10-03T12:00:00Z", total_amount: 300, discount_amount: 0, rack_rate: 300, status: "confirmed", seller_name: "Ana" },
      ],
      prevData: {
        ...stackedData.prevData,
        reservations: [
          { created_at: "2026-09-01T12:00:00Z", total_amount: 100, discount_amount: 10, rack_rate: 90, status: "confirmed", seller_name: "Ana" },
        ],
      },
    } as unknown as ComercialData;

    const view = computeComercial(data, "2026-10-01", "2026-10-02", "all");
    expect(view.dailyOpportunityKeys).toEqual(["Ana", "Bia"]);
    expect(view.dailyOpportunitiesBySeller.map((day) => [day["dia"], day["Ana"] ?? 0, day["Bia"] ?? 0])).toEqual([
      ["01/10", 1, 0],
      ["02/10", 1, 1],
    ]);
    expect(view.dailyRevenueBySeller.map((day) => [day["dia"], day["Ana"] ?? 0, day["Bia"] ?? 0])).toEqual([
      ["01/10", 90, 0],
      ["02/10", 0, 180],
    ]);
    expect(view.kpis.faturamento).toBe(270);
    expect(view.kpis.faturamentoVar).toBe(200);
    expect(view.rows.find((row) => row.key === "ana")?.faturamento).toBe(90);
    expect(view.monthlyKpis[0]?.faturamento).toBe(570);
    expect(view.monthly[0]?.["Ana"]).toBe(390);
    expect(view.kpis.conversao).toBe(2 / 3);
    // Inclui a de 30/09 (criada antes do período) e exclui a de 05/10 (criada depois do fim)
    expect(view.kpis.leadsNoTask).toBe(4);
  });
});
