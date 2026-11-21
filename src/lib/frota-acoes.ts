// Central de Ações da Gestão de Frota: transforma transferências, reservas sem carro e casos < 5h numa
// fila única de ações priorizadas, e projeta o estoque por cidade + categoria.
//
// Prioridade da ação escolhida para cada caso:
//   troca na mesma categoria (carro já na cidade) > upgrade 1 nível > upgrade 2+ níveis
//   > transferência (se a janela ≥ 5h) > sem solução.
// As demais opções válidas ficam em `alternatives`.

import {
  TRANSFER_HOURS,
  TURNAROUND_HOURS,
  gapText,
  isSameCity,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
  type Region,
  type Shortage,
  type Transfer,
} from "@/lib/frota";
import { carName, type Suggestion } from "@/lib/frota-sugestao";
import { planFrota, type Plan } from "@/lib/frota-otimizador";
import { dayKeyOf } from "@/lib/frota-timeline";

const H = 3_600_000;

export type ActionType = "transferir" | "trocar" | "upgrade" | "sem_solucao";
export type Bucket = "hoje" | "amanha" | "programado";

export type ActionOption = {
  type: ActionType;
  text: string;
  instruction: string;
  vehicle: FrotaVehicle | null;
  /** Prazo de saída/ação (ms): retirada − 5h para transferir; retirada para troca/upgrade. */
  deadline: number;
};

export type Action = ActionOption & {
  /** Chave gravada em fleet_transfers_done ao marcar "Feito". */
  key: string;
  reservationId: string;
  reason: Suggestion["reason"];
  pickUpAt: number;
  /** Cidade de retirada (destino). */
  region: Region | null;
  /** Origem (só transferir). */
  fromRegion: Region | null;
  fromLocation: string | null;
  toLocation: string | null;
  /** Carro hoje escalado no HQ (null = reserva sem carro). */
  currentVehicle: FrotaVehicle | null;
  transfer: Transfer | null;
  suggestion: Suggestion;
  /** Upgrade: categoria original → nova. */
  fromClass: string | null;
  toClass: string | null;
  levels: number;
  /** A ação evita uma transferência (troca/upgrade num caso que era transferência). */
  avoidsTransfer: boolean;
  alternatives: ActionOption[];
  bucket: Bucket;
};

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function transferOption(t: Transfer): ActionOption {
  const needBy = Date.parse(t.needBy);
  const deadline = needBy - TRANSFER_HOURS * H;
  const car = `${carName(t.vehicle)} (${t.vehicle.plate ?? "sem placa"})`;
  return {
    type: "transferir",
    vehicle: t.vehicle,
    deadline,
    text: `Levar ${carName(t.vehicle)} de ${t.fromRegion} para ${t.toRegion} (tempo disponível: ${t.windowHours}h)`,
    instruction: `Transferir ${car} de ${t.fromLocation ?? t.fromRegion} para ${t.toLocation ?? t.toRegion}. Sair até ${fmtTime(deadline)} para chegar antes da retirada da reserva ${t.toReservation} (${fmtTime(needBy)}).${t.freeFrom ? ` Carro livre a partir de ${fmtTime(Date.parse(t.freeFrom))} (devolução ${t.fromReservation}).` : ""}`,
  };
}

function suggestionOption(s: Suggestion): ActionOption {
  const pick = Date.parse(s.pickUpAt);
  return {
    type: s.kind === "troca" ? "trocar" : s.kind === "upgrade" ? "upgrade" : "sem_solucao",
    vehicle: s.vehicle,
    deadline: pick,
    text: s.text,
    instruction: s.instruction,
  };
}

/** Prazos de madrugada (antes das 6h) contam como tarefa do dia anterior: é preciso agir na véspera. */
const MADRUGADA_H = 6;

export function bucketOf(deadline: number, now: number): Bucket {
  const today = dayKeyOf(now);
  const d = dayKeyOf(deadline - MADRUGADA_H * H);
  if (d <= today) return "hoje";
  if (d === dayKeyOf(Date.parse(`${today}T12:00:00Z`) + 86_400_000 + 6 * H)) return "amanha";
  return "programado";
}

/** Escolhe a melhor ação de um caso a partir da sugestão do motor (scope "all"). */
export function chooseAction(s: Suggestion, now: number): Action {
  const pick = Date.parse(s.pickUpAt);
  const t = s.transfer;
  const transferValid = t != null && t.urgency !== "conflito";
  const options: ActionOption[] = [];
  if (s.kind !== "nenhuma") {
    options.push(suggestionOption(s));
    options.push(...s.alternatives.map(suggestionOption));
  }
  if (t && transferValid) options.push(transferOption(t));
  if (options.length === 0) {
    // Sem solução: o prazo para agir é quando o carro teria que sair (retirada − 5h), não a retirada.
    const same = t != null && isSameCity(t);
    const base = {
      ...suggestionOption(s),
      deadline: pick - (t && !same ? TRANSFER_HOURS * H : 0),
    };
    options.push(
      t && same
        ? {
            ...base,
            text: `Sem solução — só ${gapText(t)} entre a devolução e a retirada em ${t.toRegion} (mínimo ${TURNAROUND_HOURS}h): renegociar o horário ou ligar para o cliente`,
            instruction: `Reserva ${s.reservationId}: o carro ${carName(t.vehicle)} (${t.vehicle.plate ?? "sem placa"}) é devolvido ${gapText(t)} antes da retirada em ${t.toLocation ?? t.toRegion} (${fmtTime(pick)}), menos que o intervalo mínimo de ${TURNAROUND_HOURS}h, e não há outro carro livre na cidade. Ligar para o cliente e renegociar o horário.`,
          }
        : t
          ? {
              ...base,
              text: `Sem solução — tempo disponível de ${t.windowHours}h (< ${TRANSFER_HOURS}h) para ${t.fromRegion} → ${t.toRegion}: renegociar o horário ou ligar para o cliente`,
              instruction: `Reserva ${s.reservationId}: o carro ${carName(t.vehicle)} (${t.vehicle.plate ?? "sem placa"}) só fica livre em ${t.fromLocation ?? t.fromRegion} com ${t.windowHours}h até a retirada em ${t.toLocation ?? t.toRegion} (${fmtTime(pick)}), e não há carro livre na cidade para trocar ou dar upgrade. Ligar para o cliente e renegociar o horário, ou transferir com urgência.`,
            }
          : {
              ...base,
              text: "Sem solução — nenhum carro livre: renegociar o horário ou ligar para o cliente",
            },
    );
  }
  const [best, ...alternatives] = options;
  const primary = best!;
  const vehicleId = primary.vehicle?.id ?? s.currentVehicle?.id ?? 0;
  const key =
    primary.type === "transferir" && t
      ? t.key // mesma chave de antes: "Feito" já gravados continuam valendo
      : `acao|${primary.type}|${s.reservationId}|${vehicleId}${t ? "|t" : ""}`;
  return {
    ...primary,
    key,
    reservationId: s.reservationId,
    reason: s.reason,
    pickUpAt: pick,
    region: s.region,
    fromRegion: primary.type === "transferir" && t ? t.fromRegion : null,
    fromLocation: t?.fromLocation ?? null,
    toLocation: t?.toLocation ?? null,
    currentVehicle: s.currentVehicle,
    transfer: t,
    suggestion: s,
    fromClass: s.fromClass,
    toClass: primary.type === "upgrade" ? (primary.vehicle?.class_label ?? null) : s.fromClass,
    levels:
      primary.type === "upgrade"
        ? ([s, ...s.alternatives].find((x) => x.vehicle?.id === primary.vehicle?.id)?.levels ?? 1)
        : 0,
    avoidsTransfer: t != null && (primary.type === "trocar" || primary.type === "upgrade"),
    alternatives,
    bucket: bucketOf(primary.deadline, now),
  };
}

/** Ações a partir do plano global (frota-otimizador). */
export function actionsFromPlan(plan: Plan, now: Date): Action[] {
  const t = now.getTime();
  return plan.suggestions
    .map((s) => chooseAction(s, t))
    .sort((a, b) => a.deadline - b.deadline || a.key.localeCompare(b.key));
}

/** Plano global de toda a janela + ações. `transfers`/`shortages` são ignorados (legado). */
export function buildActions(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  transfers?: Transfer[];
  shortages?: Shortage[];
  now: Date;
  horizonDays?: number;
}): Action[] {
  return actionsFromPlan(planFrota(input), input.now);
}

/** Chave "Feito" de uma ação de troca/upgrade que evitou uma transferência. */
export const isAvoidedTransferKey = (key: string) => /^acao\|(trocar|upgrade)\|.*\|t$/.test(key);

// ---- Estoque projetado -------------------------------------------------------------------------

export type StockProjection = Map<Region, Map<string, number[]>>;

/**
 * Estoque projetado ACUMULADO por cidade + categoria, no fim de cada dia:
 *   carros no pátio hoje + devoluções − retiradas (a partir de agora),
 *   já considerando as transferências a fazer (sai da origem e entra no destino no prazo de saída)
 *   e os upgrades sugeridos (a reserva passa a consumir a categoria superior).
 */
export function projectStock(input: {
  vehicles: FrotaVehicle[];
  segments: FrotaSegment[];
  locations: FrotaLocation[];
  /** Posição atual (fleetPosition): só os que não estão alugados contam como pátio. */
  position: { vehicle: FrotaVehicle; region: Region | null; rented: boolean }[];
  actions: Action[];
  days: string[];
  now: Date;
  /** Plano global: carro de cada reserva e transferências. Com ele o estoque segue o plano. */
  plan?: Pick<Plan, "assignment" | "transfers">;
}): StockProjection {
  const { vehicles, segments, locations, position, actions, days, now, plan } = input;
  const t0 = now.getTime();
  const loc = new Map(locations.map((l) => [l.id, l.region]));
  const regionOf = (id: number | null) => (id == null ? null : (loc.get(id) ?? null));
  const vClass = new Map(vehicles.map((v) => [v.id, v.class_label ?? "—"]));
  const idClass = new Map<number, string>();
  for (const v of vehicles)
    if (v.vehicle_class_id != null && v.class_label) idClass.set(v.vehicle_class_id, v.class_label);
  const dayIdx = new Map(days.map((d, i) => [d, i]));

  const upgradeTo = new Map<string, string>();
  for (const a of actions)
    if (a.type === "upgrade" && a.toClass) upgradeTo.set(a.reservationId, a.toClass);

  const out: StockProjection = new Map();
  const series = (r: Region, cls: string) => {
    const m = out.get(r) ?? new Map<string, number[]>();
    out.set(r, m);
    let s = m.get(cls);
    if (!s) {
      s = new Array(days.length).fill(0);
      m.set(cls, s);
    }
    return s;
  };
  // Deltas por dia (acumula no fim).
  const bump = (r: Region | null, cls: string, ms: number, delta: number) => {
    if (!r) return;
    const k = ms <= t0 ? days[0]! : dayKeyOf(ms);
    const i = dayIdx.get(k);
    if (i == null) return;
    series(r, cls)[i]! += delta;
  };

  for (const p of position)
    if (!p.rented && p.region) bump(p.region, p.vehicle.class_label ?? "—", t0, 1);

  for (const s of segments) {
    if (s.status !== "confirmed") continue;
    const a = Date.parse(s.pick_up_at);
    const b = Date.parse(s.return_at);
    if (Number.isNaN(a) || b <= t0) continue;
    const base =
      (s.vehicle_id != null ? vClass.get(s.vehicle_id) : undefined) ??
      (s.vehicle_class_id != null ? idClass.get(s.vehicle_class_id) : undefined) ??
      "—";
    const planned = plan?.assignment.get(s.reservation_id);
    const cls =
      planned != null
        ? (vClass.get(planned) ?? base)
        : plan?.assignment.has(s.reservation_id)
          ? ((s.vehicle_class_id != null ? idClass.get(s.vehicle_class_id) : undefined) ?? base)
          : (upgradeTo.get(s.reservation_id) ?? base);
    if (a > t0) bump(regionOf(s.pick_up_location_id), cls, a, -1);
    bump(regionOf(s.return_location_id), cls, b, +1);
  }

  const moves = plan
    ? plan.transfers.filter((t) => t.urgency !== "conflito" && t.fromRegion !== t.toRegion)
    : actions
        .filter((a) => a.transfer && a.type !== "trocar" && a.type !== "upgrade") // troca/upgrade evita a viagem
        .map((a) => a.transfer!);
  for (const t of moves) {
    const cls = t.vehicle.class_label ?? "—";
    const when = Date.parse(t.needBy) - TRANSFER_HOURS * H;
    bump(t.fromRegion, cls, when, -1);
    bump(t.toRegion, cls, when, +1);
  }

  for (const m of out.values())
    for (const s of m.values()) for (let i = 1; i < s.length; i++) s[i]! += s[i - 1]!;
  return out;
}

export type CityStatus = {
  region: Region;
  /** Total no pátio agora (todas as categorias). */
  yard: number;
  /** Primeira falta (estoque < 0) no horizonte, se houver. */
  shortage: { classLabel: string; missing: number; day: string } | null;
};

export function cityStatus(
  projection: StockProjection,
  regions: Region[],
  days: string[],
  position: { vehicle: FrotaVehicle; region: Region | null; rented: boolean }[],
  /** Ações pendentes: "sem solução" também acende a cidade (o saldo do fim do dia pode mascarar). */
  actions: Action[] = [],
): CityStatus[] {
  return regions.map((r) => {
    let shortage: CityStatus["shortage"] = null;
    for (let i = 0; i < days.length && !shortage; i++) {
      let worst: { cls: string; v: number } | null = null;
      for (const [cls, s] of projection.get(r) ?? []) {
        const v = s[i]!;
        if (v < 0 && (!worst || v < worst.v)) worst = { cls, v };
      }
      if (worst) shortage = { classLabel: worst.cls, missing: -worst.v, day: days[i]! };
    }
    // Reserva sem solução na cidade: vale a mais cedo entre ela e a falta do saldo projetado.
    const unsolved = actions
      .filter((a) => a.type === "sem_solucao" && a.region === r)
      .sort((a, b) => a.pickUpAt - b.pickUpAt);
    if (unsolved.length > 0) {
      const first = unsolved[0]!;
      const day = dayKeyOf(first.pickUpAt);
      if (!shortage || day < shortage.day) {
        const cls = first.fromClass ?? "carro";
        shortage = {
          classLabel: cls,
          missing: unsolved.filter(
            (a) => dayKeyOf(a.pickUpAt) === day && (a.fromClass ?? "carro") === cls,
          ).length,
          day,
        };
      }
    }
    return {
      region: r,
      yard: position.filter((p) => !p.rented && p.region === r).length,
      shortage,
    };
  });
}
