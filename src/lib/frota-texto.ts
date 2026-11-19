// Textos em linguagem simples para os cards da Central de Ações:
// frase da linha fechada, "Problema", "Solução", passo a passo "No HQ" e a mini linha do tempo.

import { TRANSFER_HOURS, type FrotaVehicle, type Region, type Urgency } from "@/lib/frota";
import { carName } from "@/lib/frota-sugestao";
import type { Action } from "@/lib/frota-acoes";

const H = 3_600_000;

export type ResInfo = {
  customer: string | null;
  pickLocation: string | null;
  retLocation: string | null;
  pickRegion: Region | null;
  retRegion: Region | null;
  start: number;
  end: number;
};

export const fmtDia = (ms: number | string) =>
  new Date(ms)
    .toLocaleString("pt-BR", {
      timeZone: "America/New_York",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", "")
    .replace(/,/g, "");

const fmtCurto = (ms: number | string) =>
  new Date(ms)
    .toLocaleString("pt-BR", {
      timeZone: "America/New_York",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/,/g, "");

/** "faltam 3h", "faltam 1d", "atrasado 2h"; vermelho com menos de 6h. */
export function countdown(deadline: number, now: number) {
  const ms = deadline - now;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / H);
  const m = Math.floor((abs % H) / 60_000);
  const txt =
    d > 0 ? `${d}d${h ? ` ${h}h` : ""}` : h > 0 ? `${h}h${m ? ` ${m}min` : ""}` : `${m}min`;
  return { text: ms < 0 ? `atrasado ${txt}` : `faltam ${txt}`, red: ms < 6 * H };
}

const car = (v: FrotaVehicle) => carName(v);
const plate = (v: FrotaVehicle) => v.plate ?? carName(v);

export type MiniTimeline = {
  /** Reserva anterior do carro envolvido (de onde ele sai). null = carro parado. */
  prev: {
    reservationId: string;
    region: Region | null;
    location: string | null;
    at: number;
  } | null;
  /** Onde o carro está parado quando não há reserva anterior. */
  parkedAt: Region | null;
  /** Viagem entre cidades (null = mesma cidade). */
  travel: { from: Region; to: Region; hours: number; urgency: Urgency } | null;
  next: { reservationId: string; region: Region | null; location: string | null; at: number };
};

export type ActionText = {
  /** Frase da linha fechada (sem a contagem regressiva). */
  headline: string;
  /** "de [onde o carro está] → para [onde precisa estar]". */
  from: Region | null;
  to: Region | null;
  problem: string;
  solution: string;
  steps: string[];
  /** Exatamente o bloco "No HQ" (o que "Copiar instrução" copia). */
  instruction: string;
  /** Carro original (riscado) e carro novo (destacado), em troca/upgrade. */
  originalCar: FrotaVehicle | null;
  newCar: FrotaVehicle | null;
  mini: MiniTimeline;
};

export function describeAction(a: Action, resInfo: Map<string, ResInfo>, now: number): ActionText {
  const t = a.transfer;
  const res = resInfo.get(a.reservationId);
  const city = a.region;
  const cityTxt = city ?? res?.pickLocation ?? "?";
  const pick = a.pickUpAt;
  const next = {
    reservationId: a.reservationId,
    region: city,
    location: res?.pickLocation ?? null,
    at: pick,
  };
  const prevOf = (resId: string | null) => {
    if (!resId) return null;
    const r = resInfo.get(resId);
    return r
      ? { reservationId: resId, region: r.retRegion, location: r.retLocation, at: r.end }
      : null;
  };
  const hours = t?.windowHours ?? 0;

  if (a.type === "transferir" && t) {
    const v = t.vehicle;
    const livre = t.freeFrom ? ` (fica livre em ${fmtDia(t.freeFrom)})` : "";
    const problem =
      a.reason === "sem_carro" || t.kind === "sugerido"
        ? `A reserva ${a.reservationId} começa em ${t.toRegion} ${fmtDia(pick)} e ainda não tem carro; não há nenhum livre lá. O ${car(v)} está em ${t.fromRegion}${livre}.`
        : `O ${car(v)} está em ${t.fromRegion}${livre}, mas a reserva ${a.reservationId} começa em ${t.toRegion} ${fmtDia(pick)}.`;
    const solution = `Levar o ${car(v)} de ${t.fromRegion} para ${t.toRegion}. Tempo disponível: ${hours}h; a viagem leva ${TRANSFER_HOURS}h, então ele precisa sair até ${fmtDia(a.deadline)}.`;
    const steps = [
      `Combinar a viagem do ${car(v)} de ${t.fromLocation ?? t.fromRegion} para ${t.toLocation ?? t.toRegion}, saindo até ${fmtDia(a.deadline)}`,
      t.kind === "sugerido"
        ? `Abrir a reserva ${a.reservationId} e atribuir o veículo ${plate(v)}`
        : `Abrir a reserva ${a.reservationId} e conferir que o veículo é ${plate(v)}`,
      `Quando o carro chegar, atualizar a localização dele para ${t.toLocation ?? t.toRegion}`,
    ];
    return finish({
      headline: `Levar ${car(v)} de ${t.fromRegion} para ${t.toRegion} — sair até ${fmtDia(a.deadline)}`,
      from: t.fromRegion,
      to: t.toRegion,
      problem,
      solution,
      steps,
      originalCar: null,
      newCar: null,
      mini: {
        prev: prevOf(t.fromReservation),
        parkedAt: t.fromRegion,
        travel: { from: t.fromRegion, to: t.toRegion, hours, urgency: t.urgency },
        next,
      },
    });
  }

  if ((a.type === "trocar" || a.type === "upgrade") && a.vehicle) {
    const novo = a.vehicle;
    const orig = a.currentVehicle;
    const s = a.suggestion;
    const desde = s.freeSince ? ` desde ${fmtCurto(s.freeSince)}` : "";
    const problem = t
      ? t.urgency === "conflito"
        ? `O ${car(t.vehicle)} está em ${t.fromRegion}, mas a reserva ${a.reservationId} começa em ${t.toRegion} ${fmtDia(pick)}: só sobram ${hours}h, menos que as ${TRANSFER_HOURS}h da viagem.`
        : `O ${car(t.vehicle)} está em ${t.fromRegion}, mas a reserva ${a.reservationId} começa em ${t.toRegion} ${fmtDia(pick)}.`
      : `A reserva ${a.reservationId} (${a.fromClass ?? "categoria ?"}) começa em ${cityTxt} ${fmtDia(pick)} e não há carro da categoria livre a tempo.`;
    const evita = t ? `evita uma transferência de ${t.fromRegion}` : "resolve a reserva sem carro";
    const depois = s.transferAfter
      ? ` Depois desta reserva ele precisará viajar para a próxima (há tempo, mais de ${TRANSFER_HOURS}h).`
      : "";
    const solution =
      a.type === "trocar"
        ? `O ${car(novo)} (${novo.class_label ?? "—"}) já está livre em ${cityTxt}${desde}. Trocar ${evita}.${depois}`
        : `O ${car(novo)} (${novo.class_label ?? "—"}) já está livre em ${cityTxt}${desde}. Dar upgrade ${evita}.${a.levels > 1 ? ` É um upgrade de ${a.levels} níveis porque não há carro livre na categoria logo acima.` : ""}${depois}`;
    const trocaPasso = orig
      ? `Trocar o veículo de ${plate(orig)} para ${plate(novo)}`
      : `Atribuir o veículo ${plate(novo)}`;
    const steps =
      a.type === "trocar"
        ? [`Abrir a reserva ${a.reservationId}`, trocaPasso, "Salvar"]
        : [
            `Abrir a reserva ${a.reservationId}`,
            trocaPasso,
            `Registrar como upgrade grátis (manter o preço de ${a.fromClass ?? "categoria original"})`,
          ];
    const headline =
      a.type === "trocar"
        ? orig
          ? `Reserva ${a.reservationId}: trocar ${car(orig)} por ${car(novo)}, que já está em ${cityTxt}`
          : `Reserva ${a.reservationId}: colocar ${car(novo)}, que já está em ${cityTxt}`
        : `Reserva ${a.reservationId} (${a.fromClass ?? "—"}): entregar ${car(novo)} (${novo.class_label ?? "—"}) como upgrade grátis — até ${fmtDia(a.deadline)}`;
    return finish({
      headline,
      from: city,
      to: city,
      problem,
      solution,
      steps,
      originalCar: orig,
      newCar: novo,
      mini: { prev: prevOf(s.freeSinceReservation), parkedAt: city, travel: null, next },
    });
  }

  // Sem solução.
  const ligar = res?.customer ? ` (${res.customer})` : "";
  const problem = t
    ? `O ${car(t.vehicle)} está em ${t.fromRegion}, mas a reserva ${a.reservationId} começa em ${t.toRegion} ${fmtDia(pick)}: só sobram ${hours}h, menos que as ${TRANSFER_HOURS}h da viagem.`
    : `A reserva ${a.reservationId} (${a.fromClass ?? "categoria ?"}) começa em ${cityTxt} ${fmtDia(pick)} e nenhum carro da categoria fica livre a tempo.`;
  const chegaria = t
    ? Math.max(t.freeFrom ? Date.parse(t.freeFrom) : 0, now) + TRANSFER_HOURS * H
    : null;
  const solution = `Nenhum carro da mesma categoria ou superior está livre em ${cityTxt} a tempo. Ligar para o cliente e renegociar o horário${t ? `, ou mandar o ${car(t.vehicle)} com urgência` : ""}.`;
  const steps = [
    `Abrir a reserva ${a.reservationId} e ligar para o cliente${ligar}`,
    chegaria
      ? `Renegociar a retirada para depois de ${fmtDia(chegaria)} (quando o ${car(t!.vehicle)} consegue chegar em ${t!.toRegion})`
      : "Renegociar o horário ou oferecer outra data",
    "Atualizar o horário de retirada na reserva",
  ];
  return finish({
    headline: `Reserva ${a.reservationId}: nenhum carro chega a tempo em ${cityTxt} — ${a.deadline <= now ? "ligar para o cliente agora" : `ligar para o cliente até ${fmtDia(a.deadline)}`}`,
    from: t?.fromRegion ?? null,
    to: city,
    problem,
    solution,
    steps,
    originalCar: null,
    newCar: null,
    mini: {
      prev: prevOf(t?.fromReservation ?? null),
      parkedAt: t?.fromRegion ?? null,
      travel: t ? { from: t.fromRegion, to: t.toRegion, hours, urgency: t.urgency } : null,
      next,
    },
  });
}

function finish(x: Omit<ActionText, "instruction">): ActionText {
  return { ...x, instruction: x.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") };
}
