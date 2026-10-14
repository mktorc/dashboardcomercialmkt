import { describe, expect, it } from "vitest";
import {
  computeAttribution,
  computeKpis,
  computeOpportunityOrigins,
  normalizeOrigin,
  resolveLeadSource,
  type AnalyticsData,
  type OpportunityOriginRow,
} from "./analytics";

describe("origem de lead ClickMassa", () => {
  it("prioriza UTM/canal sobre Origem do Lead e usa a origem como fallback", () => {
    const source = resolveLeadSource("instagram", "Indicação");
    expect(source).toBe("instagram");
    expect(normalizeOrigin(source)).toBe("meta");
    expect(resolveLeadSource(null, "Meta Ads")).toBe("Meta Ads");
  });
});

describe("computeAttribution", () => {
  it("separa campanhas por origem e campanhas de anúncio sem UTM", () => {
    const data = {
      meta: [
        {
          date: "2026-10-01",
          campaign_name: "Meta sem tag A",
          spend: 10,
          clicks: 2,
          impressions: 20,
          utm_campaign: null,
        },
        {
          date: "2026-10-01",
          campaign_name: "Meta verão",
          spend: 20,
          clicks: 3,
          impressions: 30,
          utm_campaign: "verao",
        },
      ],
      google: [
        {
          date: "2026-10-01",
          campaign_name: "Google sem tag B",
          spend: 15,
          clicks: 4,
          impressions: 40,
          utm_campaign: null,
        },
        {
          date: "2026-10-01",
          campaign_name: "Google verão",
          spend: 25,
          clicks: 5,
          impressions: 50,
          utm_campaign: "verao",
        },
      ],
      opportunities: [
        {
          opportunity_id: "opp-meta",
          lead_id: "lead-meta",
          created_at: "2026-10-01T12:00:00Z",
          updated_at: "2026-10-01T12:00:00Z",
          stage_name: "Novo",
          status: "open",
          pipeline_step_id: 1,
          utm_source: "facebook",
          utm_campaign: "verao",
        },
        {
          opportunity_id: "opp-google",
          lead_id: "lead-google",
          created_at: "2026-10-01T13:00:00Z",
          updated_at: "2026-10-01T13:00:00Z",
          stage_name: "Novo",
          status: "open",
          pipeline_step_id: 1,
          utm_source: "google",
          utm_campaign: "verao",
        },
      ],
      reservations: [
        {
          created_at: "2026-10-01T14:00:00Z",
          car_category: "SUV",
          rental_days: 2,
          total_amount: 500,
          status: "confirmed",
          commission_partner: null,
          utm_campaign: "verao",
        },
      ],
      updatedOpportunities: [],
    } satisfies AnalyticsData;

    const rows = computeAttribution(data);
    const kpis = computeKpis(data);

    expect(rows.map((row) => row.utm)).toEqual(
      expect.arrayContaining([
        "Meta Ads / verao",
        "Sem origem / verao",
        "Meta Ads / todas as campanhas (por origem)",
        "Google Ads / todas as campanhas (por origem)",
      ]),
    );
    expect(rows.find((row) => row.utm === "Meta Ads / verao")?.leads).toBe(1);
    expect(rows.find((row) => row.utm === "Google Ads / verao")?.leads).toBe(1);
    expect(kpis.leads).toBe(2);
    expect(kpis.conversion).toBe(0.5);
    expect(rows.find((row) => row.utm === "Sem origem / verao")?.faturamento).toBe(500);
    expect(kpis.cac).toBe(70);
  });

  it("reservas sem UTM não são atribuídas à Meta", () => {
    const rows = computeAttribution({
      meta: [],
      google: [],
      reservations: [
        {
          created_at: "2026-10-01T14:00:00Z",
          car_category: "SUV",
          rental_days: 2,
          total_amount: 500,
          status: "confirmed",
          utm_campaign: null,
        },
      ],
      opportunities: [],
      updatedOpportunities: [],
    });
    expect(rows.map((row) => row.utm)).toEqual(["Sem origem / sem rastreamento"]);
  });
});

describe("computeOpportunityOrigins", () => {
  it("agrega oportunidades por origem, mês de atualização e etapa do funil", () => {
    const opportunities: OpportunityOriginRow[] = [
      {
        opportunity_id: "1",
        lead_id: "lead-1",
        created_at: "2026-10-01T12:00:00Z",
        updated_at: "2026-10-01T12:00:00Z",
        stage_name: "Novo",
        status: "open",
        pipeline_step_id: 1,
        utm_source: "facebook",
      },
      {
        opportunity_id: "2",
        lead_id: "lead-2",
        created_at: "2026-10-02T12:00:00Z",
        updated_at: "2026-10-02T12:00:00Z",
        stage_name: "Agência de viagem",
        status: "open",
        pipeline_step_id: 2,
        utm_source: "meta",
      },
      {
        opportunity_id: "4",
        lead_id: "lead-4",
        created_at: "2026-10-03T12:00:00Z",
        updated_at: "2026-10-03T12:00:00Z",
        stage_name: "Proposta enviada",
        status: "open",
        pipeline_step_id: 3,
        utm_source: "meta",
      },
      {
        opportunity_id: "3",
        lead_id: "lead-3",
        created_at: "2026-10-04T12:00:00Z",
        updated_at: "2026-10-04T12:00:00Z",
        stage_name: "Novo",
        status: "open",
        pipeline_step_id: 1,
        utm_source: "google",
      },
      {
        opportunity_id: "5",
        lead_id: "lead-5",
        created_at: "2026-10-05T12:00:00Z",
        updated_at: "2026-10-05T12:00:00Z",
        stage_name: "Novo",
        status: "open",
        pipeline_step_id: 1,
        utm_source: "google",
      },
    ];
    const updatedOpportunities: OpportunityOriginRow[] = [
      {
        ...opportunities[2]!,
        updated_at: "2026-10-15T12:00:00Z",
        stage_name: "Ganho",
        status: "closed",
      },
      {
        ...opportunities[3]!,
        updated_at: "2026-10-20T12:00:00Z",
        stage_name: "Ganho",
        status: "closed",
      },
      {
        ...opportunities[4]!,
        updated_at: "2026-10-20T12:00:00Z",
        stage_name: "Ganho",
        status: "closed",
      },
    ];

    const result = computeOpportunityOrigins(
      opportunities,
      updatedOpportunities,
      "2026-10-01",
      "2026-10-31",
    );
    const meta = result.sources.find((source) => source.label === "Meta Ads")!;
    const metaFunnel = result.funnel.find((row) => row.key === meta.key)!;
    const allFunnel = result.funnel.find((row) => row.key === "all")!;

    expect(result.byOrigin.find((row) => row.origin === "Meta Ads")?.opportunities).toBe(3);
    expect(result.createdMonthly[0]?.[meta.key]).toBe(3);
    expect(result.closedMonthly[0]?.[meta.key]).toBe(1);
    expect(result.stages.map((stage) => stage.label)).toEqual([
      "Novo",
      "Agência de viagem / Proposta enviada",
      "Ganhos / Reservas Fechadas",
    ]);
    expect(metaFunnel.stages.map((stage) => [stage.count, stage.conversion])).toEqual([
      [3, null],
      [2, 2 / 3],
      [1, 1 / 3],
    ]);
    expect(allFunnel.stages.map((stage) => [stage.count, stage.conversion])).toEqual([
      [5, null],
      [2, 0.4],
      [3, 0.6],
    ]);
    expect(
      result.closedMonthly[0]?.[
        result.sources.find((source) => source.label === "Google Ads")!.key
      ],
    ).toBe(2);
  });

  it("sem UTM, usa Origem do Lead e Commission Partner para atribuir ao canal", () => {
    const rows = computeAttribution({
      meta: [
        {
          date: "2026-10-01",
          campaign_name: "A",
          spend: 100,
          clicks: 1,
          impressions: 1,
          utm_campaign: null,
        },
      ],
      google: [],
      opportunities: [
        {
          opportunity_id: "opp-meta",
          lead_id: "lead-meta",
          created_at: "2026-10-01T12:00:00Z",
          updated_at: "2026-10-01T12:00:00Z",
          stage_name: null,
          status: "open",
          pipeline_step_id: 1,
          value: 0,
          utm_source: "Meta Ads",
          utm_campaign: null,
        },
        {
          opportunity_id: "opp-partner",
          lead_id: "lead-partner",
          created_at: "2026-10-01T12:00:00Z",
          updated_at: "2026-10-01T12:00:00Z",
          stage_name: null,
          status: "open",
          pipeline_step_id: 1,
          value: 0,
          utm_source: "Turistorlando",
          utm_campaign: null,
        },
      ],
      reservations: [
        {
          created_at: "2026-10-01T14:00:00Z",
          car_category: null,
          rental_days: 2,
          total_amount: 300,
          status: "confirmed",
          utm_campaign: null,
          commission_partner: "Meta ADS",
        },
        {
          created_at: "2026-10-01T14:00:00Z",
          car_category: null,
          rental_days: 2,
          total_amount: 200,
          status: "confirmed",
          utm_campaign: null,
          commission_partner: "Turistorlando",
        },
      ],
      updatedOpportunities: [],
    });
    const meta = rows.find((r) => r.utm === "Meta Ads / todas as campanhas (por origem)");
    expect(meta).toMatchObject({ investimento: 100, leads: 1, reservas: 1, faturamento: 300 });
    expect(rows.find((r) => r.utm === "Turistorlando / por origem")).toMatchObject({
      leads: 1,
      faturamento: 200,
    });
  });
});

describe("origem das reservas do HQ", () => {
  it("usa o Commission Partner ao atribuir faturamento sem UTM", () => {
    const rows = computeAttribution({
      meta: [],
      google: [],
      opportunities: [],
      updatedOpportunities: [],
      reservations: [
        {
          created_at: "2026-10-01T14:00:00Z",
          car_category: null,
          rental_days: 2,
          total_amount: 400,
          status: "confirmed",
          utm_campaign: null,
          commission_partner: "Meta Ads",
        },
      ],
    });
    expect(rows.map((r) => r.utm)).toEqual(["Meta Ads / todas as campanhas (por origem)"]);
  });
});
