import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  PhoneCall,
  Repeat,
  Truck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TRANSFER_HOURS, type FrotaVehicle, type Region } from "@/lib/frota";
import { REGION_COLOR } from "@/lib/frota-config";
import { carName } from "@/lib/frota-sugestao";
import type { Action, ActionOption, ActionType, Bucket } from "@/lib/frota-acoes";
import {
  countdown,
  describeAction,
  fmtDia,
  type MiniTimeline,
  type ResInfo,
} from "@/lib/frota-texto";
import { URG } from "@/components/frota/shared";

export type { ResInfo };

export const TYPE: Record<ActionType, { verb: string; icon: typeof Truck; cls: string }> = {
  transferir: { verb: "Transferir", icon: Truck, cls: "bg-sky-600 text-white hover:bg-sky-600" },
  trocar: {
    verb: "Trocar carro",
    icon: Repeat,
    cls: "bg-emerald-600 text-white hover:bg-emerald-600",
  },
  upgrade: {
    verb: "Dar upgrade",
    icon: ArrowUpCircle,
    cls: "bg-violet-600 text-white hover:bg-violet-600",
  },
  sem_solucao: {
    verb: "Sem solução",
    icon: PhoneCall,
    cls: "bg-red-600 text-white hover:bg-red-600",
  },
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Instrução copiada");
  } catch {
    toast.error("Não foi possível copiar");
  }
}

const colorOf = (r: Region | null) => (r ? REGION_COLOR[r] : "#64748b");

/** "de Miami → para Orlando" — sempre de onde o carro está para onde precisa estar. */
function Rota({ from, to }: { from: Region | null; to: Region | null }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-xs">
      <span className="text-muted-foreground">de</span>
      <span className="font-medium" style={{ color: colorOf(from) }}>
        {from ?? "sem carro"}
      </span>
      <ArrowRight className="size-3" />
      <span className="text-muted-foreground">para</span>
      <span className="font-medium" style={{ color: colorOf(to) }}>
        {to ?? "?"}
      </span>
      {from && from === to && <span className="text-muted-foreground">(já está lá)</span>}
    </span>
  );
}

function CarroTroca({ orig, novo }: { orig: FrotaVehicle | null; novo: FrotaVehicle }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {orig ? (
        <span className="rounded border border-border px-2 py-1 text-muted-foreground line-through opacity-70">
          {carName(orig)} · {orig.class_label ?? "—"}
        </span>
      ) : (
        <span className="rounded border border-dashed border-border px-2 py-1 text-muted-foreground">
          sem carro
        </span>
      )}
      <ArrowRight className="size-3.5" />
      <span className="rounded border border-emerald-500/60 bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-300">
        {carName(novo)} · {novo.class_label ?? "—"}
      </span>
    </div>
  );
}

const curto = (ms: number) =>
  new Date(ms)
    .toLocaleString("pt-BR", {
      timeZone: "America/New_York",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/,/g, "");

/** [reserva anterior] → [viagem] → [próxima reserva], com a cor da cidade. */
export function MiniLinhaTempo({ m }: { m: MiniTimeline }) {
  const travelColor = m.travel ? URG[m.travel.urgency].color : null;
  return (
    <div className="flex flex-wrap items-stretch gap-1 text-[11px]">
      {m.prev ? (
        <div
          className="rounded px-2 py-1 text-white"
          style={{ background: colorOf(m.prev.region) }}
        >
          <div className="font-semibold">Reserva anterior {m.prev.reservationId}</div>
          <div>
            devolução em {m.prev.region ?? m.prev.location ?? "?"} {curto(m.prev.at)}
          </div>
        </div>
      ) : (
        <div
          className="rounded border-2 border-dashed px-2 py-1"
          style={{ borderColor: colorOf(m.parkedAt) }}
        >
          parado em {m.parkedAt ?? "?"}
        </div>
      )}
      {m.travel && travelColor ? (
        <div
          className="flex min-w-24 flex-col justify-center rounded border px-2 py-1 font-semibold"
          style={{ borderColor: travelColor, background: `${travelColor}33`, color: travelColor }}
        >
          <div className="flex items-center gap-1">
            {m.travel.from} <ArrowRight className="size-3" /> {m.travel.to}
          </div>
          <div className="font-normal">
            viagem {TRANSFER_HOURS}h · tempo disponível: {m.travel.hours}h
          </div>
        </div>
      ) : (
        <div className="flex items-center px-1 text-muted-foreground">
          <span className="h-0.5 w-6 bg-muted-foreground/40" />
          <span className="ml-1">mesma cidade</span>
        </div>
      )}
      <div
        className="rounded border-2 border-dashed border-white/60 px-2 py-1 text-white"
        style={{ background: `${colorOf(m.next.region)}cc` }}
      >
        <div className="font-semibold">Reserva {m.next.reservationId}</div>
        <div>
          retirada em {m.next.region ?? m.next.location ?? "?"} {curto(m.next.at)}
        </div>
      </div>
    </div>
  );
}

function OptionLine({ o }: { o: ActionOption }) {
  const T = TYPE[o.type];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-xs">
      <T.icon className="size-3.5" />
      <span className="min-w-0 flex-1">{o.text}</span>
      <span className="text-muted-foreground">até {fmtDia(o.deadline)}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={() => copy(o.instruction)}
      >
        <Copy className="mr-1 size-3" /> Copiar
      </Button>
    </div>
  );
}

function Bloco({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-semibold">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function ActionCard({
  a,
  now,
  resInfo,
  onDone,
}: {
  a: Action;
  now: number;
  resInfo: Map<string, ResInfo>;
  onDone: (a: Action) => void;
}) {
  const [open, setOpen] = useState(false);
  const [alts, setAlts] = useState(false);
  const [det, setDet] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const T = TYPE[a.type];
  const cd = countdown(a.deadline, now);
  const tx = describeAction(a, resInfo, now);
  const res = resInfo.get(a.reservationId);

  const done = () => {
    setLeaving(true);
    setTimeout(() => onDone(a), 280);
  };

  return (
    <div
      data-action-type={a.type}
      className={`grid transition-all duration-300 ease-out ${
        leaving ? "grid-rows-[0fr] -translate-x-6 opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      <div className="overflow-hidden">
        <Card className="mb-2 p-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Detalhes"
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            <Badge className={`${T.cls} gap-1`}>
              <T.icon className="size-3.5" /> {T.verb}
            </Badge>
            <div className="min-w-[220px] flex-1 leading-snug">
              <button className="text-left text-sm" onClick={() => setOpen((o) => !o)}>
                {tx.headline}{" "}
                <span
                  className={`font-semibold ${cd.red ? "text-red-400" : "text-muted-foreground"}`}
                >
                  ({cd.text})
                </span>
              </button>
              <Rota from={tx.from} to={tx.to} />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => copy(tx.instruction)}>
                <Copy className="mr-1 size-4" />
                <span className="hidden sm:inline">Copiar instrução</span>
              </Button>
              <Button size="sm" onClick={done} disabled={leaving}>
                <Check className="mr-1 size-4" /> Feito
              </Button>
            </div>
          </div>

          {open && (
            <div className="mt-2 space-y-3 border-t pt-3">
              <Bloco title="❓ Problema">{tx.problem}</Bloco>
              <Bloco title="✅ Solução">
                <p>{tx.solution}</p>
                {tx.newCar && (
                  <div className="mt-1.5">
                    <CarroTroca orig={tx.originalCar} novo={tx.newCar} />
                  </div>
                )}
              </Bloco>
              <Bloco title="🛠 No HQ">
                <ol className="list-decimal space-y-0.5 pl-5">
                  {tx.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </Bloco>
              <MiniLinhaTempo m={tx.mini} />

              {a.alternatives.length > 0 && (
                <div className="text-xs">
                  <button
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setAlts((x) => !x)}
                  >
                    {alts ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    Ver outras opções ({a.alternatives.length})
                  </button>
                  {alts && (
                    <div className="mt-1 space-y-1">
                      {a.alternatives.map((o, i) => (
                        <OptionLine key={i} o={o} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs">
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setDet((x) => !x)}
                >
                  {det ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Detalhes
                </button>
                {det && (
                  <div className="mt-1 grid gap-0.5 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Reserva:</span> {a.reservationId}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cliente (e-mail):</span>{" "}
                      {res?.customer ?? "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Retirada:</span>{" "}
                      {res?.pickLocation ?? "—"} · {fmtDia(a.pickUpAt)}
                    </div>
                    {res && (
                      <div>
                        <span className="text-muted-foreground">Devolução:</span>{" "}
                        {res.retLocation ?? "—"} · {fmtDia(res.end)}
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Carro atual da reserva:</span>{" "}
                      {a.currentVehicle
                        ? `${carName(a.currentVehicle)} (${a.currentVehicle.plate ?? "sem placa"})`
                        : "nenhum"}
                    </div>
                    {a.transfer && (
                      <>
                        <div>
                          <span className="text-muted-foreground">Fica livre em:</span>{" "}
                          {a.transfer.fromLocation ?? a.transfer.fromRegion} ·{" "}
                          {a.transfer.freeFrom ? fmtDia(a.transfer.freeFrom) : "já está parado"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Viagem:</span>{" "}
                          {a.transfer.fromLocation ?? a.transfer.fromRegion} →{" "}
                          {a.transfer.toLocation ?? a.transfer.toRegion}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tempo disponível:</span>{" "}
                          {a.transfer.windowHours}h
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export type TypeFilter = ActionType | "todas";

const GROUPS: { id: Bucket; title: string }[] = [
  { id: "hoje", title: "Fazer hoje" },
  { id: "amanha", title: "Fazer amanhã" },
  { id: "programado", title: "Programado" },
];

/**
 * Filtra (região e tipo) ANTES de agrupar por prazo. Com filtro de tipo ativo, grupos vazios somem;
 * sem filtro, "Fazer hoje" fica sempre (mostra o estado vazio).
 */
export function groupActions(
  actions: Action[],
  typeFilter: TypeFilter,
  regionFilter: Region | "todas",
) {
  const byRegion = actions.filter(
    (a) => regionFilter === "todas" || a.region === regionFilter || a.fromRegion === regionFilter,
  );
  const filtered = byRegion.filter((a) => typeFilter === "todas" || a.type === typeFilter);
  const counts = Object.fromEntries(
    (Object.keys(TYPE) as ActionType[]).map((t) => [
      t,
      byRegion.filter((a) => a.type === t).length,
    ]),
  ) as Record<ActionType, number>;
  const groups = GROUPS.map((g) => ({
    ...g,
    list: filtered.filter((a) => a.bucket === g.id),
  })).filter((g) => g.list.length > 0 || (typeFilter === "todas" && g.id === "hoje"));
  return { total: byRegion.length, counts, groups };
}

export function FilaAcoes({
  actions,
  now,
  resInfo,
  onDone,
  typeFilter,
  onTypeFilter,
  regionFilter,
  dayResolved,
  onClearRegion,
  defaultOpen = { hoje: true, amanha: true, programado: false },
}: {
  actions: Action[];
  now: number;
  resInfo: Map<string, ResInfo>;
  onDone: (a: Action) => void;
  typeFilter: TypeFilter;
  onTypeFilter: (t: TypeFilter) => void;
  regionFilter: Region | "todas";
  dayResolved: boolean;
  onClearRegion?: () => void;
  defaultOpen?: Record<Bucket, boolean>;
}) {
  const [openGroups, setOpenGroups] = useState<Record<Bucket, boolean>>(defaultOpen);
  const { total, counts, groups } = groupActions(actions, typeFilter, regionFilter);

  return (
    <div className="space-y-3">
      {regionFilter !== "todas" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300">
          Mostrando só ações de {regionFilter} ({total} de {actions.length})
          {onClearRegion && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={onClearRegion}
            >
              Ver todas as regiões
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={typeFilter === "todas" ? "default" : "outline"}
          onClick={() => onTypeFilter("todas")}
        >
          {regionFilter === "todas" ? "Todas" : `Todas em ${regionFilter}`} ({total})
        </Button>
        {(Object.keys(TYPE) as ActionType[]).map((t) => {
          const X = TYPE[t];
          return (
            <Button
              key={t}
              size="sm"
              variant={typeFilter === t ? "default" : "outline"}
              onClick={() => onTypeFilter(typeFilter === t ? "todas" : t)}
            >
              <X.icon className="mr-1 size-3.5" /> {X.verb} ({counts[t]})
            </Button>
          );
        })}
      </div>

      {groups.length === 0 && (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          Nenhuma ação deste tipo.
        </Card>
      )}

      {groups.map((g) => {
        const isOpen = openGroups[g.id];
        return (
          <section key={`${typeFilter}|${g.id}`}>
            <button
              className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"
              onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !s[g.id] }))}
            >
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {g.title}
              <Badge variant="outline">{g.list.length}</Badge>
            </button>
            {isOpen && g.list.length === 0 && (
              <Card className="p-4 text-center text-sm text-emerald-400">
                {dayResolved ? "✅ Dia resolvido" : "✅ Nada para fazer hoje"}
              </Card>
            )}
            {isOpen &&
              g.list.map((a) => (
                <ActionCard key={a.key} a={a} now={now} resInfo={resInfo} onDone={onDone} />
              ))}
          </section>
        );
      })}
    </div>
  );
}

export function StatusBar({
  actions,
  regions,
  dayResolved,
}: {
  actions: Action[];
  regions: Region[];
  dayResolved: boolean;
}) {
  const n = (b: Bucket) => actions.filter((a) => a.bucket === b).length;
  const hoje = n("hoje");
  const ok = regions.filter((r) => !actions.some((a) => a.region === r || a.fromRegion === r));
  return (
    <div className="space-y-2">
      {hoje === 0 && (
        <Card className="flex items-center justify-center gap-3 border-emerald-500/40 bg-emerald-500/10 p-6 text-xl font-semibold text-emerald-400">
          ✅ {dayResolved ? "Dia resolvido" : "Nada para fazer hoje"}
        </Card>
      )}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
        <span className={hoje ? "font-semibold text-red-400" : "text-muted-foreground"}>
          🔴 {hoje} {hoje === 1 ? "ação" : "ações"} para hoje
        </span>
        <span className="text-muted-foreground">·</span>
        <span className={n("amanha") ? "font-semibold text-amber-400" : "text-muted-foreground"}>
          🟠 {n("amanha")} até amanhã
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-sky-400">🔵 {n("programado")} programadas</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-emerald-400">
          ✅ {ok.length ? ok.join(", ") : "nenhuma cidade"} sem pendência
        </span>
      </Card>
    </div>
  );
}
