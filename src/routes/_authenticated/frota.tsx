import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { guardPage } from "@/lib/roles";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { syncFrota } from "@/lib/sync-all.functions";
import {
  fleetPosition,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
  type Region,
} from "@/lib/frota";
import {
  actionsFromPlan,
  cityStatus,
  isAvoidedTransferKey,
  projectStock,
  type Action,
} from "@/lib/frota-acoes";
import { buildTimeline, dayKeyOf, hqWallToInstant, orlandoMidnight } from "@/lib/frota-timeline";
import { planFrota } from "@/lib/frota-otimizador";
import {
  KIND_LABEL,
  parseAdjustments,
  pinsOf,
  toRow,
  type Adjustment,
  type DoneRow,
} from "@/lib/frota-ajustes";
import { carName } from "@/lib/frota-sugestao";
import { AjusteDialog, type AjusteInput } from "@/components/frota/AjusteDialog";
import { aplicarNoHq } from "@/lib/hq-frota.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  ISSUE_LABEL,
  chainOf,
  chainText,
  diffEffects,
  diffPlan,
  isUpgradeAction,
  hqIssues,
  snapshot,
  weekStats,
  type HqIssue,
  type Seen,
} from "@/lib/frota-extras";

const SEEN_KEY = "frota:plano-visto";
import { LinhaDoTempo } from "@/components/frota/LinhaDoTempo";
import { PainelFrota, type Selection } from "@/components/frota/PainelFrota";
import {
  FilaAcoes,
  StatusBar,
  groupActions,
  type ResInfo,
  type TypeFilter,
} from "@/components/frota/FilaAcoes";
import { EstoqueDetalhe, Semaforo } from "@/components/frota/Semaforo";

// Tabelas novas (sql-para-gravar/gestao_frota.sql) ainda não estão em types.ts: cliente sem tipos.
const supabase = typedClient as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/frota")({
  head: () => ({
    meta: [
      { title: "Gestão de Frota | Orlando Rent Car Analytics" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: () => guardPage("frota"),
  component: FrotaPage,
});

const REGIONS: Region[] = ["Orlando", "Miami"];
const HORIZONTE = 7;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do Supabase sem tipos
type Query = any;

async function fetchAll<T>(
  table: string,
  cols: string,
  order: string[],
  filter?: (q: Query) => Query,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from(table)
      .select(cols)
      .range(from, from + 999);
    // Ordem fixa: sem ela a paginação pode repetir/pular linhas e o cálculo muda a cada recarga.
    for (const c of order) q = q.order(c, { ascending: true });
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type Done = DoneRow;

async function loadFrota() {
  const desde = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [locations, vehicles, segments, done, clientes] = await Promise.all([
    fetchAll<FrotaLocation>("fleet_locations", "id, name, region", ["id"]),
    fetchAll<FrotaVehicle>(
      "fleet_vehicles",
      "id, plate, label, vehicle_class_id, class_label, current_location_id, exit_date, entry_date",
      ["id"],
    ),
    fetchAll<FrotaSegment>(
      "reservation_segments",
      "reservation_id, seq, status, pick_up_at, return_at, vehicle_id, vehicle_class_id, pick_up_location_id, return_location_id",
      ["reservation_id", "seq"],
      (q) => q.gte("return_at", desde).eq("status", "confirmed"),
    ),
    fetchAll<Done>("fleet_transfers_done", "key, done_at, vehicle_id, from_region, to_region", [
      "key",
    ]),
    // Só para o tooltip/painel (o HQ não grava o nome do cliente; usamos o e-mail).
    fetchAll<{ reservation_id: string; customer_email: string | null }>(
      "reservations",
      "reservation_id, customer_email",
      ["reservation_id"],
      (q) => q.gte("return_at", desde),
    ).catch(() => []),
  ]);
  // Horários do HQ são de Orlando sem fuso (gravados como UTC): converte para o instante real.
  const segmentsReal = segments.map((s) => ({
    ...s,
    pick_up_at: hqWallToInstant(s.pick_up_at),
    return_at: hqWallToInstant(s.return_at),
  }));
  const customers = new Map<string, string>();
  for (const c of clientes) if (c.customer_email) customers.set(c.reservation_id, c.customer_email);
  return { locations, vehicles, segments: segmentsReal, done, customers };
}

/** Relógio que avança a cada minuto (contagem regressiva). */
function useNow(stepMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/** Segunda-feira 00:00 de Orlando da semana atual. */
function startOfWeek(now: number) {
  const key = dayKeyOf(now);
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const back = (wd + 6) % 7;
  return orlandoMidnight(dayKeyOf(Date.parse(`${key}T12:00:00Z`) - back * 86_400_000));
}

function FrotaPage() {
  const qc = useQueryClient();
  const horizonte = HORIZONTE;
  const [regiao, setRegiao] = useState<Region | "todas">("todas");
  const [tipo, setTipo] = useState<TypeFilter>("todas");
  const [frotaToda, setFrotaToda] = useState(false);
  const [selecao, setSelecao] = useState<Selection>(null);
  const clock = useNow();
  const q = useQuery({ queryKey: ["frota"], queryFn: loadFrota });

  // Recalcula as ações quando os dados mudam (o relógio só mexe na contagem e nos grupos).
  const result = useMemo(() => {
    if (!q.data) return null;
    const now = new Date();
    const { vehicles, segments, locations, customers, done } = q.data;
    // Ajustes ("Feito com ajuste") travam a reserva no que foi feito; o resto se replaneja.
    const ajustes = parseAdjustments(done);
    // Plano global: todas as reservas da janela decididas juntas (não reserva por reserva).
    const plano = planFrota({
      vehicles,
      segments,
      locations,
      now,
      horizonDays: horizonte,
      pins: pinsOf(ajustes),
    });
    const frota = { transfers: plano.transfers, shortages: plano.shortages };
    const actions = actionsFromPlan(plano, now);
    const position = fleetPosition(vehicles, segments, locations, now);
    const timeline = buildTimeline({
      vehicles,
      segments,
      locations,
      ...frota,
      now,
      horizonDays: horizonte,
    });
    const dias = timeline.days
      .filter((d) => d.start + 86_400_000 > now.getTime())
      .map((d) => d.key)
      .slice(0, horizonte);
    const locName = new Map(locations.map((l) => [l.id, l.name]));
    const locRegion = new Map(locations.map((l) => [l.id, l.region]));
    const resInfo = new Map<string, ResInfo>();
    for (const s of segments)
      if (!resInfo.has(s.reservation_id))
        resInfo.set(s.reservation_id, {
          customer: customers.get(s.reservation_id) ?? null,
          pickLocation:
            s.pick_up_location_id == null ? null : (locName.get(s.pick_up_location_id) ?? null),
          retLocation:
            s.return_location_id == null ? null : (locName.get(s.return_location_id) ?? null),
          pickRegion:
            s.pick_up_location_id == null ? null : (locRegion.get(s.pick_up_location_id) ?? null),
          retRegion:
            s.return_location_id == null ? null : (locRegion.get(s.return_location_id) ?? null),
          start: Date.parse(s.pick_up_at),
          end: Date.parse(s.return_at),
        });
    return {
      ...frota,
      actions,
      plano,
      ajustes,
      position,
      timeline,
      dias,
      resInfo,
      vehicles,
      segments,
      locations,
      now,
    };
  }, [q.data, horizonte]);

  const doneKeys = useMemo(() => new Set((q.data?.done ?? []).map((d) => d.key)), [q.data]);

  // Pendentes (sem "Feito"), com o grupo hoje/amanhã/programado atualizado pelo relógio.
  const pendentes = useMemo(() => {
    if (!result) return [];
    return result.actions.filter((a) => !doneKeys.has(a.key));
  }, [result, doneKeys]);

  // Estoque projetado considerando as ações (transferências e upgrades sugeridos).
  const estoque = useMemo(() => {
    if (!result) return null;
    const projection = projectStock({
      vehicles: result.vehicles,
      segments: result.segments,
      locations: result.locations,
      position: result.position,
      actions: result.actions,
      days: result.dias,
      now: result.now,
      plan: result.plano,
    });
    return {
      projection,
      status: cityStatus(projection, REGIONS, result.dias, result.position, pendentes),
    };
  }, [result, pendentes]);

  // Dia resolvido: nada pendente para hoje e ao menos uma ação de hoje marcada como feita.
  const hojeKey = dayKeyOf(clock);
  const feitasHoje = (q.data?.done ?? []).filter(
    (d) => dayKeyOf(Date.parse(d.done_at)) === hojeKey,
  );
  const dayResolved =
    pendentes.every((a) => a.bucket !== "hoje") &&
    feitasHoje.some((d) => result?.actions.some((a) => a.key === d.key && a.bucket === "hoje"));
  const semana = startOfWeek(clock);
  const evitadas = (q.data?.done ?? []).filter(
    (d) => Date.parse(d.done_at) >= semana && isAvoidedTransferKey(d.key),
  ).length;

  const marcar = useMutation({
    mutationFn: async ({ a, feito }: { a: Action; feito: boolean }) => {
      const { error } = feito
        ? await supabase.from("fleet_transfers_done").insert({
            key: a.key,
            vehicle_id: a.vehicle?.id ?? a.currentVehicle?.id ?? 0,
            from_region: a.fromRegion ?? a.region ?? "—",
            to_region: a.region ?? "—",
          })
        : await supabase.from("fleet_transfers_done").delete().eq("key", a.key);
      if (error) throw new Error(error.message);
    },
    // Otimista: o card some na hora e a barra de status já atualiza.
    onMutate: async ({ a, feito }) => {
      await qc.cancelQueries({ queryKey: ["frota"] });
      const prev = qc.getQueryData<Awaited<ReturnType<typeof loadFrota>>>(["frota"]);
      if (prev)
        qc.setQueryData(["frota"], {
          ...prev,
          done: feito
            ? [...prev.done, { key: a.key, done_at: new Date().toISOString() }]
            : prev.done.filter((d) => d.key !== a.key),
        });
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["frota"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["frota"] }),
  });

  // "Feito com ajuste": grava o que foi feito e o plano trava a reserva assim.
  const [ajustando, setAjustando] = useState<Action | null>(null);
  const ajustar = useMutation({
    mutationFn: async (
      v: { kind: "salvar"; row: ReturnType<typeof toRow> } | { kind: "desfazer"; key: string },
    ) => {
      const key = v.kind === "salvar" ? v.row.key : v.key;
      // Sem permissão de UPDATE: troca = apaga e grava de novo.
      const del = await supabase.from("fleet_transfers_done").delete().eq("key", key);
      if (del.error) throw new Error(del.error.message);
      if (v.kind === "salvar") {
        const ins = await supabase.from("fleet_transfers_done").insert(v.row);
        if (ins.error) throw new Error(ins.error.message);
      }
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["frota"] });
      const prev = qc.getQueryData<Awaited<ReturnType<typeof loadFrota>>>(["frota"]);
      if (prev) {
        const key = v.kind === "salvar" ? v.row.key : v.key;
        const rest = prev.done.filter((d) => d.key !== key);
        qc.setQueryData(["frota"], {
          ...prev,
          done:
            v.kind === "salvar" ? [...rest, { ...v.row, done_at: new Date().toISOString() }] : rest,
        });
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["frota"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["frota"] }),
  });
  // "Aplicar no HQ": troca o carro da reserva direto no HQ (servidor) e recarrega.
  const aplicarFn = useServerFn(aplicarNoHq);
  const aplicarNoHqDe = async (
    reservationId: string,
    vehicle: FrotaVehicle,
    upgrade: boolean,
  ): Promise<boolean> => {
    const id = toast.loading(`Aplicando no HQ: reserva ${reservationId}…`);
    try {
      const r = await aplicarFn({
        data: {
          reservationId,
          vehicleId: vehicle.id,
          upgradeClassId: upgrade ? vehicle.vehicle_class_id : null,
        },
      });
      if (r.ok) toast.success(r.message, { id });
      else toast.error(r.message, { id, duration: r.partial ? 20_000 : 8_000 });
      return r.ok;
    } catch (e) {
      toast.error(`Falha ao falar com o HQ: ${(e as Error).message}`, { id });
      return false;
    } finally {
      void qc.invalidateQueries({ queryKey: ["frota"] });
    }
  };
  const aplicarAcao = (a: Action) =>
    a.vehicle
      ? aplicarNoHqDe(a.reservationId, a.vehicle, isUpgradeAction(a))
      : Promise.resolve(false);

  const salvarAjuste = (a: Action, input: AjusteInput) => {
    if (input.applyHq && input.vehicleId != null) {
      const v = result?.vehicles.find((x) => x.id === input.vehicleId);
      if (v && v.id !== a.currentVehicle?.id)
        void aplicarNoHqDe(
          a.reservationId,
          v,
          isUpgradeAction({ fromClass: a.fromClass, vehicle: v }),
        );
    }
    const row = toRow({ reservationId: a.reservationId, suggested: a.text, ...input });
    ajustar.mutate({ kind: "salvar", row });
    setAjustando(null);
    toast.success(`Ajuste salvo na reserva ${a.reservationId}: plano refeito`, {
      action: {
        label: "Desfazer",
        onClick: () => ajustar.mutate({ kind: "desfazer", key: row.key }),
      },
    });
  };
  // 7) Simulação do ajuste: o que muda nas outras reservas se eu salvar isto.
  const simular = (a: Action, input: AjusteInput): string[] => {
    if (!result || !q.data) return [];
    const pins = pinsOf(result.ajustes);
    if (input.kind === "fora") pins.set(a.reservationId, "fora");
    else if (input.vehicleId != null) pins.set(a.reservationId, input.vehicleId);
    else return [];
    const now = new Date();
    const plano = planFrota({
      vehicles: result.vehicles,
      segments: result.segments,
      locations: result.locations,
      now,
      horizonDays: horizonte,
      pins,
    });
    const depois = actionsFromPlan(plano, now).filter((x) => !doneKeys.has(x.key));
    return diffEffects(pendentes, depois, a.reservationId);
  };

  // 1) Plano alterado desde a última visita (por navegador).
  const [visto, setVisto] = useState<Seen | null>(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return raw ? (JSON.parse(raw) as Seen) : null;
    } catch {
      return null;
    }
  });
  const marcarVisto = () => {
    const snap = snapshot(pendentes);
    setVisto(snap);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(snap));
    } catch {
      /* sem armazenamento: só nesta sessão */
    }
  };
  useEffect(() => {
    if (result && visto == null && pendentes.length > 0) marcarVisto(); // 1ª visita: base silenciosa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, visto]);
  const mudancas = useMemo(() => diffPlan(pendentes, visto), [pendentes, visto]);

  // 2/3) Pendências para corrigir no HQ.
  const pendenciasHq = useMemo(
    () =>
      q.data
        ? hqIssues({
            vehicles: q.data.vehicles,
            segments: q.data.segments,
            locations: q.data.locations,
            done: q.data.done,
            now: new Date(clock),
            horizonDays: horizonte,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, Math.floor(clock / 600_000), horizonte],
  );

  // 5) Cadeia de reescalas de cada ação.
  const chainFor = (a: Action) => chainText(chainOf(a, pendentes));

  // 6) Números da semana.
  const semanaStats = weekStats(q.data?.done ?? [], semana);

  const regiaoDoCarro = useMemo(
    () => new Map((result?.position ?? []).map((p) => [p.vehicle.id, p.region])),
    [result],
  );

  const feito = (a: Action) => {
    marcar.mutate({ a, feito: true });
    toast.success("Ação concluída", {
      action: { label: "Desfazer", onClick: () => marcar.mutate({ a, feito: false }) },
    });
  };

  // Linha do tempo focada: carros envolvidos nas ações pendentes.
  const foco = useMemo(() => {
    if (frotaToda) return null;
    const ids = new Set<number>();
    for (const a of pendentes) {
      if (a.vehicle) ids.add(a.vehicle.id);
      if (a.currentVehicle) ids.add(a.currentVehicle.id);
      if (a.transfer) ids.add(a.transfer.vehicle.id);
    }
    return ids;
  }, [pendentes, frotaToda]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
          </Link>
        </Button>
        <div className="flex justify-end">
          <SyncButton fn={syncFrota} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Gestão de Frota · Central de Ações</h1>
          <p className="text-sm text-muted-foreground">
            O que fazer, até quando, e o que está ok. Viagem Orlando ↔ Miami: 5h. Mesma cidade: 1h
            entre reservas. Horários de Orlando.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Próximos {HORIZONTE} dias</span>
          <span className="ml-2 text-sm text-muted-foreground">Região</span>
          {(["todas", ...REGIONS] as const).map((r) => (
            <Button
              key={r}
              size="sm"
              variant={regiao === r ? "default" : "outline"}
              onClick={() => setRegiao(r)}
            >
              {r === "todas" ? "Todas" : r}
            </Button>
          ))}
        </div>

        {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {q.error && (
          <Card className="p-4 text-sm text-red-600">
            Erro ao carregar: {(q.error as Error).message}
          </Card>
        )}

        {result && estoque && (
          <>
            <StatusBar actions={pendentes} regions={REGIONS} dayResolved={dayResolved} />
            {mudancas.added + mudancas.changed + mudancas.removed > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                <span className="font-medium">O plano mudou desde a sua última visita:</span>
                {mudancas.added > 0 && <span>{mudancas.added} ação(ões) nova(s)</span>}
                {mudancas.changed > 0 && <span>· {mudancas.changed} alterada(s)</span>}
                {mudancas.removed > 0 && <span>· {mudancas.removed} não precisa(m) mais</span>}
                <span className="text-xs text-sky-300/80">(destacadas na fila)</span>
                <Button size="sm" variant="outline" className="ml-auto h-7" onClick={marcarVisto}>
                  Ok, vi
                </Button>
              </div>
            )}
            <PendenciasHq issues={pendenciasHq} />
            <Semaforo
              status={estoque.status}
              days={result.dias}
              selected={regiao}
              onSelect={setRegiao}
            />
            <EstoqueDetalhe
              projection={estoque.projection}
              regions={regiao === "todas" ? REGIONS : [regiao]}
              days={result.dias}
            />

            <Tabs defaultValue="acoes">
              <TabsList className="flex-wrap">
                <TabsTrigger value="acoes">
                  Ações ({groupActions(pendentes, "todas", regiao).total}
                  {regiao !== "todas" ? ` em ${regiao}` : ""})
                </TabsTrigger>
                <TabsTrigger value="linha">Linha do tempo</TabsTrigger>
                <TabsTrigger value="patio">Onde está a frota</TabsTrigger>
              </TabsList>

              <TabsContent value="acoes">
                <FilaAcoes
                  actions={pendentes}
                  now={clock}
                  resInfo={result.resInfo}
                  onDone={feito}
                  onAdjust={setAjustando}
                  changes={mudancas.change}
                  chainFor={chainFor}
                  onApply={aplicarAcao}
                  typeFilter={tipo}
                  onTypeFilter={setTipo}
                  regionFilter={regiao}
                  dayResolved={dayResolved}
                  onClearRegion={() => setRegiao("todas")}
                />
                <ListaAjustes
                  ajustes={result.ajustes}
                  vehicles={result.vehicles}
                  onUndo={(key) => ajustar.mutate({ kind: "desfazer", key })}
                />
              </TabsContent>

              <TabsContent value="linha" className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={frotaToda} onCheckedChange={setFrotaToda} />
                  Mostrar toda a frota
                  {!frotaToda && (
                    <span className="text-xs">
                      (só carros com ação pendente e reservas sem carro livre)
                    </span>
                  )}
                </label>
                <LinhaDoTempo
                  timeline={result.timeline}
                  horizonDays={horizonte}
                  regionFilter={regiao}
                  focus={foco}
                  suggestions={new Map(pendentes.map((a) => [a.reservationId, a.suggestion]))}
                  customers={q.data!.customers}
                  now={clock}
                  onSelectCar={(vehicleId) => setSelecao({ kind: "car", vehicleId })}
                  onSelectReservation={(reservationId) =>
                    setSelecao({ kind: "reservation", reservationId })
                  }
                />
              </TabsContent>

              <TabsContent value="patio">
                <Patio position={result.position} />
              </TabsContent>
            </Tabs>

            <p className="pt-2 text-center text-sm text-muted-foreground">
              Esta semana:{" "}
              <span className="font-semibold text-foreground">{semanaStats.asSuggested}</span>{" "}
              feitas como sugerido ·{" "}
              <span className="font-semibold text-foreground">{semanaStats.adjusted}</span> com
              ajuste
              {semanaStats.adjusted > 0 &&
                ` (${semanaStats.byKind.outro_carro} outro carro, ${semanaStats.byKind.mantido} manteve o atual, ${semanaStats.byKind.fora} fora do plano)`}{" "}
              · <span className="font-semibold text-emerald-400">{evitadas}</span>{" "}
              {evitadas === 1 ? "transferência evitada" : "transferências evitadas"} com
              troca/upgrade
            </p>

            <PainelFrota
              selection={selecao}
              onClose={() => setSelecao(null)}
              timeline={result.timeline}
              actions={pendentes}
              resInfo={result.resInfo}
              onDone={feito}
              onAdjust={setAjustando}
              onApply={aplicarAcao}
              now={clock}
            />
            <AjusteDialog
              action={ajustando}
              vehicles={result.vehicles.filter(
                (v) => !v.exit_date || Date.parse(v.exit_date) > clock,
              )}
              regionOf={regiaoDoCarro}
              onSave={salvarAjuste}
              simulate={simular}
              onClose={() => setAjustando(null)}
            />
          </>
        )}
      </main>
    </div>
  );
}

function Patio({ position }: { position: ReturnType<typeof fleetPosition> }) {
  const classes = [...new Set(position.map((p) => p.vehicle.class_label ?? "—"))].sort();
  const cell = (cls: string, r: Region, rented: boolean) =>
    position.filter(
      (p) => (p.vehicle.class_label ?? "—") === cls && p.region === r && p.rented === rented,
    ).length;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Categoria</th>
            {REGIONS.map((r) => (
              <th key={r} className="p-2 text-center">
                {r}
                <div className="text-xs font-normal text-muted-foreground">
                  pátio / volta de locação
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c} className="border-b last:border-0">
              <td className="p-2">{c}</td>
              {REGIONS.map((r) => (
                <td key={r} className="p-2 text-center tabular-nums">
                  <span className="font-medium">{cell(c, r, false)}</span>
                  <span className="text-muted-foreground"> / {cell(c, r, true)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Ajustes registrados ("Feito com ajuste"), com desfazer. Só os de reservas ainda na janela importam. */
function ListaAjustes({
  ajustes,
  vehicles,
  onUndo,
}: {
  ajustes: Adjustment[];
  vehicles: FrotaVehicle[];
  onUndo: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (ajustes.length === 0) return null;
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return (
    <Card className="mt-3 p-3">
      <button
        className="flex w-full items-center justify-between text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Ajustes feitos ({ajustes.length})</span>
        <span className="text-xs text-muted-foreground">{open ? "ocultar" : "ver"}</span>
      </button>
      {open && (
        <ul className="mt-2 divide-y text-sm">
          {ajustes.map((a) => {
            const v = a.vehicleId != null ? byId.get(a.vehicleId) : null;
            return (
              <li key={a.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-medium">Reserva {a.reservationId}</span> ·{" "}
                    {KIND_LABEL[a.kind]}
                    {v ? `: ${carName(v)}` : ""}
                  </div>
                  {a.note && <div className="text-muted-foreground">“{a.note}”</div>}
                  {a.suggested && (
                    <div className="text-xs text-muted-foreground">Sugestão era: {a.suggested}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {new Date(a.doneAt).toLocaleString("pt-BR", {
                      timeZone: "America/New_York",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onUndo(a.key)}>
                  Desfazer
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Quadro "Corrigir no HQ": dados que atrapalham o plano e "Feito" que o HQ ainda não mostra. */
function PendenciasHq({ issues }: { issues: HqIssue[] }) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;
  const kinds = [...new Set(issues.map((i) => i.kind))];
  return (
    <Card className="border-amber-500/40 bg-amber-500/5 p-3">
      <button
        className="flex w-full items-center justify-between gap-2 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium text-amber-300">⚠️ Corrigir no HQ ({issues.length})</span>
        <span className="text-xs text-muted-foreground">
          {kinds
            .map(
              (k) => `${issues.filter((i) => i.kind === k).length} ${ISSUE_LABEL[k].toLowerCase()}`,
            )
            .join(" · ")}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {kinds.map((k) => (
            <div key={k}>
              <div className="mb-1 font-medium">{ISSUE_LABEL[k]}</div>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {issues
                  .filter((i) => i.kind === k)
                  .map((i, n) => (
                    <li key={n}>{i.text}</li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
