import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Region } from "@/lib/frota";
import { REGION_COLOR, REGION_SHORT } from "@/lib/frota-config";
import { carName, type Suggestion } from "@/lib/frota-sugestao";
import {
  dayKeyOf,
  type Bar,
  type Gap,
  type Timeline,
  type TimelineGroup,
} from "@/lib/frota-timeline";
import { URG, fmt } from "@/components/frota/shared";

const DAY = 86_400_000;
const ROW_H = 30;
const LANE_H = 24;

const colorOf = (r: Region | null) => (r ? REGION_COLOR[r] : "#64748b");

export function LinhaDoTempo({
  timeline,
  horizonDays,
  regionFilter,
  focus,
  suggestions,
  customers,
  now,
  onSelectCar,
  onSelectReservation,
}: {
  timeline: Timeline;
  horizonDays: number;
  regionFilter: Region | "todas";
  /** Foco: só os carros com ação pendente e só as reservas sem carro livre. null = toda a frota. */
  focus: Set<number> | null;
  suggestions: Map<string, Suggestion>;
  customers: Map<string, string>;
  now: number;
  onSelectCar: (vehicleId: number) => void;
  onSelectReservation: (reservationId: string) => void;
}) {
  const dayPx = horizonDays <= 14 ? 72 : horizonDays <= 30 ? 48 : 32;
  const width = ((timeline.end - timeline.start) / DAY) * dayPx;
  const x = (ms: number) =>
    ((Math.min(Math.max(ms, timeline.start), timeline.end) - timeline.start) / DAY) * dayPx;
  const nowX = x(now);

  const groups = useMemo(() => {
    const keepBars = (bars: Bar[], gaps: Gap[]) => {
      if (regionFilter === "todas") return true;
      return (
        bars.some((b) => b.pickRegion === regionFilter || b.retRegion === regionFilter) ||
        gaps.some((g) => g.from === regionFilter || g.to === regionFilter)
      );
    };
    return timeline.groups
      .map((g): TimelineGroup => ({
        ...g,
        rows: g.rows.filter((r) => (!focus || focus.has(r.vehicle.id)) && keepBars(r.bars, r.gaps)),
        unassigned: g.unassigned.filter((u) => (!focus || u.shortage) && keepBars([u.bar], [])),
      }))
      .filter((g) => g.rows.length || g.unassigned.length);
  }, [timeline, regionFilter, focus]);

  const gridBg = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayPx - 1}px, hsl(var(--border) / 0.5) ${dayPx - 1}px, hsl(var(--border) / 0.5) ${dayPx}px)`,
    backgroundPosition: `${x(timeline.days[0]!.start)}px 0`,
  };

  const Track = ({ children, h = ROW_H }: { children: React.ReactNode; h?: number }) => (
    <div className="relative shrink-0" style={{ width, height: h, ...gridBg }}>
      {children}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
        style={{ left: nowX }}
      />
    </div>
  );

  const BarEl = ({ b, onClick }: { b: Bar; onClick: () => void }) => {
    const left = x(b.start);
    const w = Math.max(4, x(b.end) - left);
    const bg = `linear-gradient(90deg, ${colorOf(b.pickRegion)}, ${colorOf(b.retRegion)})`;
    const cli = customers.get(b.reservationId);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={`absolute top-1 bottom-1 overflow-hidden rounded px-1 text-left text-[10px] font-medium leading-[22px] text-white ${
              b.started ? "" : "border-2 border-dashed border-white/60 opacity-60"
            }`}
            style={{ left, width: w, background: bg }}
          >
            <span className="truncate drop-shadow">{w > 40 ? `#${b.reservationId}` : ""}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <div className="font-semibold">Reserva {b.reservationId}</div>
          <div>Cliente: {cli ?? "—"}</div>
          <div>
            Retirada: {b.pickLocation ?? "—"} · {fmt(b.start)}
          </div>
          <div>
            Devolução: {b.retLocation ?? "—"} · {fmt(b.end)}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const GapEl = ({ g, onClick }: { g: Gap; onClick: () => void }) => {
    const left = x(g.start);
    const w = x(g.end) - left;
    if (w <= 0) return null;
    if (!g.transfer || !g.urgency || !g.from || !g.to) {
      return (
        <div
          className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 bg-muted-foreground/30"
          style={{ left, width: w }}
        />
      );
    }
    const c = URG[g.urgency].color;
    const label = `${REGION_SHORT[g.from]} → ${REGION_SHORT[g.to]} · ${g.transfer.windowHours}h disponíveis`;
    // Prazo de saída: retirada − 5h.
    const saida = Date.parse(g.transfer.needBy) - 12 * 3_600_000;
    return (
      <>
        {saida > timeline.start && saida < timeline.end && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-[1] w-0.5"
            style={{ left: x(saida), background: c }}
            title={`Prazo de saída: ${fmt(saida)}`}
          >
            <div
              className="absolute -top-0.5 -left-[3px] size-2 rotate-45"
              style={{ background: c }}
            />
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClick}
              className="absolute top-1.5 bottom-1.5 flex items-center overflow-hidden whitespace-nowrap rounded-sm border px-1 text-[10px] font-semibold"
              style={{
                left,
                width: Math.max(w, 6),
                borderColor: c,
                background: `${c}33`,
                color: c,
              }}
            >
              {w > 60 ? label : w > 16 ? "→" : ""}
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            <div className="font-semibold">{label}</div>
            <div>{URG[g.urgency].label}</div>
            <div>Sair até: {fmt(saida)}</div>
            <div>
              Precisa chegar: {fmt(g.transfer.needBy)} (reserva {g.transfer.toReservation})
            </div>
          </TooltipContent>
        </Tooltip>
      </>
    );
  };

  // Faixa "sem carro": empilha as reservas que se sobrepõem em linhas (lanes).
  const lanes = (items: TimelineGroup["unassigned"]) => {
    const ends: number[] = [];
    return items.map((u) => {
      let i = ends.findIndex((e) => e <= u.bar.start);
      if (i < 0) i = ends.push(0) - 1;
      ends[i] = u.bar.end;
      return { u, lane: i };
    });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(REGION_COLOR) as Region[]).map((r) => (
          <span key={r} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: REGION_COLOR[r] }}
            />
            {r}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-slate-400" /> Reserva atual
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-white/70 bg-slate-400/50" />
          Próxima
        </span>
        {(["conflito", "urgente", "programar"] as const).map((u) => (
          <span key={u} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-4 rounded-sm border"
              style={{ borderColor: URG[u].color, background: `${URG[u].color}33` }}
            />
            {URG[u].label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 bg-red-500" /> agora
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rotate-45 bg-slate-300" /> prazo de saída
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="max-h-[75vh] overflow-auto">
          <div style={{ width: width + 176 }} className="min-w-full">
            {/* Cabeçalho dos dias */}
            <div className="sticky top-0 z-20 flex border-b bg-card">
              <div className="sticky left-0 z-30 w-28 shrink-0 border-r bg-card p-1 text-xs font-medium sm:w-44">
                Carro
              </div>
              <div className="relative shrink-0" style={{ width, height: 34 }}>
                {timeline.days.map((d) => {
                  const dt = new Date(`${d.key}T12:00:00`);
                  const today = d.key === dayKeyOf(now);
                  return (
                    <div
                      key={d.key}
                      className={`absolute top-0 border-l border-border/50 px-1 text-[10px] leading-tight ${today ? "font-semibold text-red-400" : "text-muted-foreground"}`}
                      style={{ left: x(d.start), width: dayPx }}
                    >
                      <div className="capitalize">
                        {dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                      </div>
                      <div>
                        {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </div>
                    </div>
                  );
                })}
                <div className="absolute bottom-0 h-1.5 w-px bg-red-500" style={{ left: nowX }} />
              </div>
            </div>

            {groups.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhum carro com movimento para esse filtro.
              </div>
            )}

            {groups.map((g) => {
              const laid = lanes(g.unassigned);
              const nLanes = Math.max(0, ...laid.map((l) => l.lane + 1));
              const faltas = g.unassigned.filter((u) => u.shortage).length;
              return (
                <div key={g.classLabel}>
                  <div className="border-b bg-muted/60 py-1 text-xs font-semibold">
                    <span className="sticky left-0 px-2">
                      {g.classLabel}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {g.rows.length} carros
                      </span>
                    </span>
                  </div>

                  {nLanes > 0 && (
                    <div className="flex border-b bg-muted/30">
                      <div
                        className={`sticky left-0 z-10 flex w-28 shrink-0 items-start gap-1 border-r bg-muted p-1 text-xs sm:w-44 ${faltas ? "text-red-400" : "text-muted-foreground"}`}
                      >
                        {faltas > 0 && <AlertTriangle className="mt-0.5 size-3" />}
                        Sem carro ({g.unassigned.length})
                      </div>
                      <Track h={nLanes * LANE_H + 4}>
                        {laid.map(({ u, lane }) => {
                          const left = x(u.bar.start);
                          const w = Math.max(6, x(u.bar.end) - left);
                          const s = suggestions.get(u.bar.reservationId);
                          return (
                            <Tooltip key={u.bar.reservationId}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => onSelectReservation(u.bar.reservationId)}
                                  className={`absolute overflow-hidden whitespace-nowrap rounded px-1 text-left text-[10px] leading-[18px] ${
                                    u.shortage
                                      ? "border border-red-500 bg-red-600/30 font-semibold text-red-200"
                                      : "border border-dashed border-muted-foreground/50 bg-muted-foreground/15 text-muted-foreground"
                                  }`}
                                  style={{
                                    left,
                                    width: w,
                                    top: 2 + lane * LANE_H,
                                    height: LANE_H - 4,
                                  }}
                                >
                                  {w > 40 &&
                                    `#${u.bar.reservationId}${u.suggested ? ` → ${carName(u.suggested.vehicle)}` : ""}${s && s.kind !== "nenhuma" ? " 💡" : ""}`}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                <div className="font-semibold">
                                  Reserva {u.bar.reservationId} · sem carro
                                </div>
                                <div>Cliente: {customers.get(u.bar.reservationId) ?? "—"}</div>
                                <div>
                                  Retirada: {u.bar.pickLocation ?? "—"} · {fmt(u.bar.start)}
                                </div>
                                <div>
                                  Devolução: {u.bar.retLocation ?? "—"} · {fmt(u.bar.end)}
                                </div>
                                <div className="mt-1">
                                  {u.shortage
                                    ? "Nenhum carro da categoria livre a tempo"
                                    : u.suggested
                                      ? `Escalação sugerida: ${carName(u.suggested.vehicle)}`
                                      : "Há carro livre na cidade"}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </Track>
                    </div>
                  )}

                  {g.rows.map((r) => {
                    const critical = r.gaps.some((x) => x.urgency === "conflito");
                    return (
                      <div
                        key={r.vehicle.id}
                        className="flex border-b border-border/50 hover:bg-muted/20"
                      >
                        <button
                          onClick={() => onSelectCar(r.vehicle.id)}
                          className="sticky left-0 z-10 w-28 shrink-0 truncate border-r bg-card px-1 text-left text-xs hover:bg-muted sm:w-44"
                          style={{ height: ROW_H }}
                          title={`${carName(r.vehicle)} · ${r.vehicle.plate ?? "sem placa"}`}
                        >
                          {critical && (
                            <span className="mr-1 inline-block size-1.5 rounded-full bg-red-500 align-middle" />
                          )}
                          <span className="font-medium">{carName(r.vehicle)}</span>
                          <span className="ml-1 text-muted-foreground">{r.vehicle.plate}</span>
                        </button>
                        <Track>
                          {r.gaps.map((gp, i) => (
                            <GapEl key={i} g={gp} onClick={() => onSelectCar(r.vehicle.id)} />
                          ))}
                          {r.bars.map((b) => (
                            <BarEl
                              key={b.reservationId}
                              b={b}
                              onClick={() => onSelectCar(r.vehicle.id)}
                            />
                          ))}
                        </Track>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </TooltipProvider>
  );
}
