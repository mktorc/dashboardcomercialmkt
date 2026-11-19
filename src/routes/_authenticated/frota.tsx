import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { guardPage } from "@/lib/roles";
import {
  computeFrota,
  fleetPosition,
  type FrotaLocation,
  type FrotaSegment,
  type FrotaVehicle,
  type Region,
  type Transfer,
  type Urgency,
} from "@/lib/frota";

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

const REGIONS: Region[] = ["Orlando", "Miami", "FLL", "Tampa"];
const HORIZONTES = [14, 30, 60] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do Supabase sem tipos
type Query = any;

async function fetchAll<T>(
  table: string,
  cols: string,
  filter?: (q: Query) => Query,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from(table)
      .select(cols)
      .range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type Done = { key: string; done_at: string };

async function loadFrota() {
  const desde = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [locations, vehicles, segments, done] = await Promise.all([
    fetchAll<FrotaLocation>("fleet_locations", "id, name, region"),
    fetchAll<FrotaVehicle>(
      "fleet_vehicles",
      "id, plate, label, vehicle_class_id, class_label, current_location_id, exit_date",
    ),
    fetchAll<FrotaSegment>(
      "reservation_segments",
      "reservation_id, seq, status, pick_up_at, return_at, vehicle_id, vehicle_class_id, pick_up_location_id, return_location_id",
      (q) => q.gte("return_at", desde).eq("status", "confirmed"),
    ),
    fetchAll<Done>("fleet_transfers_done", "key, done_at"),
  ]);
  return { locations, vehicles, segments, done };
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

const URG: Record<Urgency, { label: string; cls: string }> = {
  conflito: { label: "Menos de 12h", cls: "bg-red-600 text-white hover:bg-red-600" },
  urgente: { label: "Urgente", cls: "bg-amber-500 text-white hover:bg-amber-500" },
  programar: { label: "Programar", cls: "bg-sky-600 text-white hover:bg-sky-600" },
};

/** Nome do carro sem o local que o HQ põe no fim do label. */
function carName(v: FrotaVehicle) {
  const label = v.label ?? "";
  const i = label.indexOf("]");
  return (i > 0 ? label.slice(0, i + 1) : label) || v.plate || `#${v.id}`;
}

function FrotaPage() {
  const qc = useQueryClient();
  const [horizonte, setHorizonte] = useState<(typeof HORIZONTES)[number]>(30);
  const [regiao, setRegiao] = useState<Region | "todas">("todas");
  const [verFeitas, setVerFeitas] = useState(false);
  const q = useQuery({ queryKey: ["frota"], queryFn: loadFrota });

  const result = useMemo(() => {
    if (!q.data) return null;
    const now = new Date();
    return {
      ...computeFrota(q.data.vehicles, q.data.segments, q.data.locations, now, horizonte),
      position: fleetPosition(q.data.vehicles, q.data.segments, q.data.locations, now),
    };
  }, [q.data, horizonte]);

  const doneKeys = useMemo(() => new Set((q.data?.done ?? []).map((d) => d.key)), [q.data]);
  const classNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of q.data?.vehicles ?? [])
      if (v.vehicle_class_id && v.class_label) m.set(v.vehicle_class_id, v.class_label);
    return m;
  }, [q.data]);

  const marcar = useMutation({
    mutationFn: async ({ t, feito }: { t: Transfer; feito: boolean }) => {
      const { error } = feito
        ? await supabase.from("fleet_transfers_done").insert({
            key: t.key,
            vehicle_id: t.vehicle.id,
            from_region: t.fromRegion,
            to_region: t.toRegion,
          })
        : await supabase.from("fleet_transfers_done").delete().eq("key", t.key);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["frota"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const filtroRegiao = (t: Transfer) =>
    regiao === "todas" || t.fromRegion === regiao || t.toRegion === regiao;
  const transfers = (result?.transfers ?? []).filter(filtroRegiao);
  const pendentes = transfers.filter((t) => !doneKeys.has(t.key));
  const feitas = transfers.filter((t) => doneKeys.has(t.key));
  const visiveis = verFeitas ? transfers : pendentes;
  const shortages = (result?.shortages ?? []).filter(
    (s) => regiao === "todas" || s.region === regiao,
  );

  const porDia = new Map<string, Transfer[]>();
  for (const t of visiveis) {
    const k = dayKey(t.needBy);
    porDia.set(k, [...(porDia.get(k) ?? []), t]);
  }

  const cont = (u: Urgency) => pendentes.filter((t) => t.urgency === u).length;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Gestão de Frota</h1>
          <p className="text-sm text-muted-foreground">
            Carros que precisam mudar de região (Orlando, Miami, FLL, Tampa) antes da próxima
            reserva. Transferência entre regiões: mínimo de 12h. Horários de Orlando.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Próximos</span>
          {HORIZONTES.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={horizonte === h ? "default" : "outline"}
              onClick={() => setHorizonte(h)}
            >
              {h} dias
            </Button>
          ))}
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

        {result && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Menos de 12h" value={cont("conflito")} tone="text-red-600" />
              <Stat label="Urgentes (até 2 dias)" value={cont("urgente")} tone="text-amber-600" />
              <Stat label="Programar" value={cont("programar")} tone="text-sky-600" />
              <Stat label="Reservas sem carro livre" value={shortages.length} tone="text-red-600" />
            </div>

            <Tabs defaultValue="transferencias">
              <TabsList>
                <TabsTrigger value="transferencias">Transferências</TabsTrigger>
                <TabsTrigger value="faltas">Sem carro ({shortages.length})</TabsTrigger>
                <TabsTrigger value="patio">Onde está a frota</TabsTrigger>
              </TabsList>

              <TabsContent value="transferencias" className="space-y-4">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={verFeitas}
                    onChange={(e) => setVerFeitas(e.target.checked)}
                  />
                  Mostrar as já feitas ({feitas.length})
                </label>
                {porDia.size === 0 && (
                  <Card className="p-6 text-center text-sm text-muted-foreground">
                    Nenhuma transferência pendente nesse período.
                  </Card>
                )}
                {[...porDia.entries()].map(([dia, lista]) => (
                  <div key={dia} className="space-y-2">
                    <h2 className="text-sm font-semibold capitalize text-muted-foreground">
                      Chegar até {dayLabel(dia)}
                    </h2>
                    {lista.map((t) => (
                      <TransferCard
                        key={t.key}
                        t={t}
                        feito={doneKeys.has(t.key)}
                        onToggle={(feito) => marcar.mutate({ t, feito })}
                        disabled={marcar.isPending}
                      />
                    ))}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="faltas" className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Reservas ainda sem carro no HQ para as quais nenhum carro da categoria fica livre
                  a tempo (considerando também as transferências sugeridas). Possível overbooking:
                  conferir no calendário do HQ.
                </p>
                {shortages.length === 0 && (
                  <Card className="p-6 text-center text-sm text-muted-foreground">
                    Todas as reservas têm carro disponível.
                  </Card>
                )}
                {shortages.map((s) => (
                  <Card key={s.reservation_id} className="flex flex-wrap items-center gap-3 p-3">
                    <AlertTriangle className="size-4 text-red-600" />
                    <span className="font-medium">Reserva {s.reservation_id}</span>
                    <Badge variant="outline">
                      {(s.vehicle_class_id && classNames.get(s.vehicle_class_id)) ?? "Categoria ?"}
                    </Badge>
                    <span className="text-sm">
                      {s.location ?? "—"} · {fmt(s.pickUpAt)} → {fmt(s.returnAt)}
                    </span>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="patio">
                <Patio position={result.position} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${value > 0 ? tone : ""}`}>{value}</div>
    </Card>
  );
}

function TransferCard({
  t,
  feito,
  onToggle,
  disabled,
}: {
  t: Transfer;
  feito: boolean;
  onToggle: (feito: boolean) => void;
  disabled: boolean;
}) {
  return (
    <Card
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${feito ? "opacity-50" : ""}`}
    >
      <Badge className={URG[t.urgency].cls}>{URG[t.urgency].label}</Badge>
      <div className="min-w-[180px]">
        <div className="font-medium">{carName(t.vehicle)}</div>
        <div className="text-xs text-muted-foreground">
          {t.vehicle.class_label ?? "—"} · {t.vehicle.plate ?? "sem placa"}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <div>
          <div className="font-medium">{t.fromRegion}</div>
          <div className="text-xs text-muted-foreground">{t.fromLocation ?? "—"}</div>
        </div>
        <ArrowRight className="size-4" />
        <div>
          <div className="font-medium">{t.toRegion}</div>
          <div className="text-xs text-muted-foreground">{t.toLocation ?? "—"}</div>
        </div>
      </div>
      <div className="text-xs">
        <div>
          Livre: {t.freeFrom ? fmt(t.freeFrom) : "já está parado"}
          {t.fromReservation ? ` (devolução ${t.fromReservation})` : ""}
        </div>
        <div>
          Precisa chegar: <span className="font-medium">{fmt(t.needBy)}</span> (reserva{" "}
          {t.toReservation}) · janela {t.windowHours}h
        </div>
      </div>
      <Badge variant="outline">
        {t.kind === "escalado" ? "Carro escalado no HQ" : "Sugestão (reserva sem carro)"}
      </Badge>
      <Button
        size="sm"
        variant={feito ? "outline" : "default"}
        className="ml-auto"
        disabled={disabled}
        onClick={() => onToggle(!feito)}
      >
        {feito ? (
          <>
            <Undo2 className="mr-1 size-4" /> Desfazer
          </>
        ) : (
          <>
            <Check className="mr-1 size-4" /> Feito
          </>
        )}
      </Button>
    </Card>
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
