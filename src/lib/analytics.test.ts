import { describe, expect, it } from "vitest";
import {
  computeAttribution,
  computeOpportunityOrigins,
  type AnalyticsData,
  type OpportunityOriginRow,
} from "./analytics";

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
      leads: [
        {
          created_at: "2026-10-01T12:00:00Z",
          stage_name: "Novo",
          utm_source: "facebook",
          utm_campaign: "verao",
        },
        {
          created_at: "2026-10-01T13:00:00Z",
          stage_name: "Novo",
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
          utm_campaign: "verao",
        },
      ],
      opportunities: [],
      updatedOpportunities: [],
    } satisfies AnalyticsData;

    const rows = computeAttribution(data);

    expect(rows.map((row) => row.utm)).toEqual(
      expect.arrayContaining([
        "Meta / verao",
        "Google / verao",
        "Sem origem / verao",
        "Meta / sem_utm · Meta sem tag A",
        "Google / sem_utm · Google sem tag B",
      ]),
    );
    expect(rows.find((row) => row.utm === "Meta / verao")?.leads).toBe(1);
    expect(rows.find((row) => row.utm === "Google / verao")?.leads).toBe(1);
    expect(rows.find((row) => row.utm === "Sem origem / verao")?.faturamento).toBe(500);
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
        stage_name: "Proposta",
        status: "open",
        pipeline_step_id: 2,
        utm_source: "meta",
      },
      {
        opportunity_id: "3",
        lead_id: "lead-3",
        created_at: "2026-10-03T12:00:00Z",
        updated_at: "2026-10-03T12:00:00Z",
        stage_name: "Novo",
        status: "open",
        pipeline_step_id: 1,
        utm_source: "google",
      },
    ];
    const updatedOpportunities: OpportunityOriginRow[] = [
      {
        ...opportunities[1]!,
        updated_at: "2026-10-15T12:00:00Z",
        stage_name: "Ganho",
        status: "closed",
      },
      {
        ...opportunities[2]!,
        updated_at: "2026-10-20T12:00:00Z",
        stage_name: "Perdido",
        status: "closed",
      },
    ];

    const result = computeOpportunityOrigins(
      opportunities,
      updatedOpportunities,
      "2026-10-01",
      "2026-10-31",
    );
    const meta = result.sources.find((source) => source.label === "Meta")!;
    const metaFunnel = result.funnel.find((row) => row.key === meta.key)!;

    expect(result.byOrigin.find((row) => row.origin === "Meta")?.opportunities).toBe(2);
    expect(result.createdMonthly[0]?.[meta.key]).toBe(2);
    expect(result.closedMonthly[0]?.[meta.key]).toBe(1);
    expect(metaFunnel.stages.map((stage) => [stage.count, stage.conversion])).toEqual([
      [2, null],
      [1, 0.5],
    ]);
    expect(
      result.closedMonthly[0]?.[result.sources.find((source) => source.label === "Google")!.key],
    ).toBeUndefined();
  });
});
