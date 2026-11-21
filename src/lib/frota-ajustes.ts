// "Feito com ajuste": o operador resolveu a reserva de um jeito diferente do sugerido. O ajuste trava a
// reserva no plano (carro escolhido, ou fora do planejamento) e o otimizador replaneja as demais.
//
// Gravado em fleet_transfers_done (mesma tabela do "Feito", já com permissão e tempo real), numa chave
// própria por reserva:
//   key          = "ajuste|<reserva>"
//   vehicle_id   = carro usado (0 = resolvido fora do plano)
//   from_region  = tipo do ajuste
//   to_region    = JSON { n: observação, s: o que o painel sugeria }

export type AdjustmentKind = "outro_carro" | "mantido" | "fora";

export type Adjustment = {
  key: string;
  reservationId: string;
  kind: AdjustmentKind;
  /** Carro usado (null = resolvido fora do plano). */
  vehicleId: number | null;
  note: string;
  /** Texto da sugestão que o painel dava quando o ajuste foi feito. */
  suggested: string;
  doneAt: string;
};

export type DoneRow = {
  key: string;
  done_at: string;
  vehicle_id?: number | null;
  from_region?: string | null;
  to_region?: string | null;
};

export const ADJ_PREFIX = "ajuste|";
export const adjustmentKey = (reservationId: string) => `${ADJ_PREFIX}${reservationId}`;
export const isAdjustmentKey = (key: string) => key.startsWith(ADJ_PREFIX);

export const KIND_LABEL: Record<AdjustmentKind, string> = {
  outro_carro: "Usei outro carro",
  mantido: "Mantive o carro atual",
  fora: "Resolvi fora do plano",
};

export function toRow(adj: {
  reservationId: string;
  kind: AdjustmentKind;
  vehicleId: number | null;
  note: string;
  suggested: string;
}) {
  return {
    key: adjustmentKey(adj.reservationId),
    vehicle_id: adj.kind === "fora" ? 0 : (adj.vehicleId ?? 0),
    from_region: adj.kind,
    to_region: JSON.stringify({ n: adj.note.trim(), s: adj.suggested }),
  };
}

export function parseAdjustments(rows: DoneRow[]): Adjustment[] {
  const out: Adjustment[] = [];
  for (const r of rows) {
    if (!isAdjustmentKey(r.key)) continue;
    const kind = (["outro_carro", "mantido", "fora"] as const).find((k) => k === r.from_region);
    if (!kind) continue;
    let note = "";
    let suggested = "";
    try {
      const j = JSON.parse(r.to_region ?? "{}") as { n?: string; s?: string };
      note = j.n ?? "";
      suggested = j.s ?? "";
    } catch {
      note = r.to_region ?? "";
    }
    const vid = r.vehicle_id ?? 0;
    out.push({
      key: r.key,
      reservationId: r.key.slice(ADJ_PREFIX.length),
      kind,
      vehicleId: kind === "fora" || vid === 0 ? null : vid,
      note,
      suggested,
      doneAt: r.done_at,
    });
  }
  return out.sort((a, b) => b.doneAt.localeCompare(a.doneAt));
}

/** Travas para o otimizador: reserva → carro (ou "fora" do planejamento). */
export function pinsOf(adjs: Adjustment[]): Map<string, number | "fora"> {
  const m = new Map<string, number | "fora">();
  for (const a of adjs) {
    if (a.kind === "fora") m.set(a.reservationId, "fora");
    else if (a.vehicleId != null) m.set(a.reservationId, a.vehicleId);
  }
  return m;
}
