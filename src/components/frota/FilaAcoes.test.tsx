import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeFrota,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
} from "@/lib/frota";
import { buildActions, type Action, type ActionType } from "@/lib/frota-acoes";
import { describeAction, type ResInfo } from "@/lib/frota-texto";
import { FilaAcoes, groupActions } from "./FilaAcoes";

const LOCS: FrotaLocation[] = [
  { id: 1, name: "MCO", region: "Orlando" },
  { id: 2, name: "MIA", region: "Miami" },
  { id: 3, name: "FLL", region: "FLL" },
  { id: 4, name: "TPA", region: "Tampa" },
];
const NOW = new Date("2026-11-19T12:00:00Z");
const CLS: Record<number, string> = { 2: "Midsize Suv", 5: "Fullsize Suv" };
const car = (id: number, loc: number, cls = 2): FrotaVehicle => ({
  id,
  plate: `P${id}`,
  label: `Carro ${id}`,
  vehicle_class_id: cls,
  class_label: CLS[cls]!,
  current_location_id: loc,
  exit_date: null,
});
const seg = (
  id: string,
  vehicle: number | null,
  from: string,
  to: string,
  pick: number,
  ret: number,
  cls = 2,
): FrotaSegment => ({
  reservation_id: id,
  seq: 0,
  status: "confirmed",
  pick_up_at: from,
  return_at: to,
  vehicle_id: vehicle,
  vehicle_class_id: cls,
  pick_up_location_id: pick,
  return_location_id: ret,
});

// Um cenário com os 4 tipos de ação, em hoje, amanhã e programado.
const vehicles = [
  car(1, 2), // transferir MIA → FLL (programado)
  car(2, 2), // sem solução (< 12h, ninguém em Tampa)
  car(3, 2), // troca: carro 4 já está em FLL
  car(4, 3),
  car(5, 1, 5), // upgrade: Fullsize em Orlando
  car(6, 2),
];
const segments = [
  seg("T1", 1, "2026-11-15T10:00:00Z", "2026-11-20T10:00:00Z", 2, 2),
  seg("T2", 1, "2026-11-24T10:00:00Z", "2026-11-30T10:00:00Z", 3, 3),
  seg("S1", 2, "2026-11-15T10:00:00Z", "2026-11-19T20:00:00Z", 2, 2),
  seg("S2", 2, "2026-11-20T02:00:00Z", "2026-11-23T10:00:00Z", 4, 4),
  seg("X1", 3, "2026-11-15T10:00:00Z", "2026-11-20T10:00:00Z", 2, 2),
  seg("X2", 3, "2026-11-20T20:00:00Z", "2026-11-25T10:00:00Z", 3, 3),
  seg("U1", 6, "2026-11-15T10:00:00Z", "2026-11-21T10:00:00Z", 2, 2),
  seg("U2", 6, "2026-11-21T14:00:00Z", "2026-11-25T10:00:00Z", 1, 1),
];
const frota = computeFrota(vehicles, segments, LOCS, NOW, 60);
const actions: Action[] = buildActions({ vehicles, segments, locations: LOCS, ...frota, now: NOW });
const resInfo = new Map<string, ResInfo>(
  segments.map((s) => [
    s.reservation_id,
    {
      customer: `${s.reservation_id.toLowerCase()}@x.com`,
      pickLocation: LOCS.find((l) => l.id === s.pick_up_location_id)!.name,
      retLocation: LOCS.find((l) => l.id === s.return_location_id)!.name,
      pickRegion: LOCS.find((l) => l.id === s.pick_up_location_id)!.region,
      retRegion: LOCS.find((l) => l.id === s.return_location_id)!.region,
      start: Date.parse(s.pick_up_at),
      end: Date.parse(s.return_at),
    },
  ]),
);

const TYPES: ActionType[] = ["transferir", "trocar", "upgrade", "sem_solucao"];

describe("cenário", () => {
  it("tem os 4 tipos", () => {
    expect(new Set(actions.map((a) => a.type))).toEqual(new Set(TYPES));
  });
});

describe("filtro por tipo", () => {
  it.each(TYPES)(
    "groupActions(%s): grupos só com o tipo, contagens filtradas, sem grupos vazios",
    (t) => {
      const { groups } = groupActions(actions, t, "todas");
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.list.length).toBeGreaterThan(0);
        for (const a of g.list) expect(a.type).toBe(t);
      }
      expect(groups.reduce((n, g) => n + g.list.length, 0)).toBe(
        actions.filter((a) => a.type === t).length,
      );
    },
  );

  it.each(TYPES)("render com filtro %s: todos os cards renderizados são desse tipo", (t) => {
    const html = renderToStaticMarkup(
      <FilaAcoes
        actions={actions}
        now={NOW.getTime()}
        resInfo={resInfo}
        onDone={() => {}}
        typeFilter={t}
        onTypeFilter={() => {}}
        regionFilter="todas"
        dayResolved={false}
        defaultOpen={{ hoje: true, amanha: true, programado: true }}
      />,
    );
    const rendered = [...html.matchAll(/data-action-type="([a-z_]+)"/g)].map((m) => m[1]);
    expect(rendered.length).toBe(actions.filter((a) => a.type === t).length);
    for (const r of rendered) expect(r).toBe(t);
  });
});

describe("textos do card", () => {
  const get = (t: ActionType) =>
    describeAction(
      actions.find((a) => a.type === t)!,
      resInfo,
      NOW.getTime(),
    );

  it("transferir: frase simples, de → para e sem jargão", () => {
    const x = get("transferir");
    expect(x.headline).toMatch(/^Levar Carro 1 de Miami para FLL — sair até /);
    expect([x.from, x.to]).toEqual(["Miami", "FLL"]);
    expect(x.mini.travel).toMatchObject({ from: "Miami", to: "FLL" });
  });

  it("trocar: carro original e novo; localização do carro novo", () => {
    const x = get("trocar");
    expect(x.headline).toBe("Reserva X2: trocar Carro 3 por Carro 4, que já está em FLL");
    expect(x.originalCar?.id).toBe(3);
    expect(x.newCar?.id).toBe(4);
    expect(x.steps[1]).toBe("Trocar o veículo de P3 para P4");
  });

  it("upgrade: categoria original e nova, registrar como upgrade grátis", () => {
    const x = get("upgrade");
    expect(x.headline).toMatch(
      /^Reserva U2 \(Midsize Suv\): entregar Carro 5 \(Fullsize Suv\) como upgrade grátis — até /,
    );
    expect(x.steps[2]).toContain("upgrade grátis");
  });

  it("sem solução: de onde o carro está para onde precisa estar (nunca só o destino)", () => {
    const x = get("sem_solucao");
    expect(x.headline).toMatch(
      /^Reserva S2: nenhum carro chega a tempo em Tampa — ligar para o cliente até /,
    );
    expect([x.from, x.to]).toEqual(["Miami", "Tampa"]);
    expect(x.steps[0]).toContain("s2@x.com");
  });

  it("'Copiar instrução' = exatamente o bloco No HQ numerado", () => {
    for (const t of TYPES) {
      const x = get(t);
      expect(x.instruction).toBe(x.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
    }
  });

  it("não usa os termos antigos; frase principal com nome de cidade, não sigla", () => {
    for (const t of TYPES) {
      const x = get(t);
      const all = [x.headline, x.problem, x.solution, ...x.steps].join(" ");
      expect(all).not.toMatch(/janela|Livre na origem|Deslocamento|Escalado no HQ/);
      expect(x.headline).not.toMatch(/\bMCO\b|\bMIA\b|\bTPA\b/);
    }
  });
});
