import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ManualSyncButton } from "@/components/ManualSyncButton";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { brl } from "@/lib/analytics";

const axis = { stroke: "oklch(0.74 0.03 150)", fontSize: 12 };
const tooltipStyle = {
  background: "oklch(0.22 0.03 155)",
  border: "1px solid oklch(0.34 0.045 155)",
  borderRadius: 12,
  color: "#fff",
};

type Change = { reservation_id: string; changed_at: string };
type ReservationInfo = {
  reservation_id: string;
  car_category: string | null;
  total_amount: number | string | null;
  seller_name: string | null;
  created_at: string;
  status: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmada (open)",
  cancelled: "Cancelada",
};
const statusLabel = (status: string | null | undefined) => (status ? STATUS_LABELS[status] ?? status : "—");

/** Dia local (YYYY-MM-DD) de um instante. */
const TZ = "America/Sao_Paulo";
const localDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const ymd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
const br = (day: string) => day.split("-").reverse().join("/");

/** Reservas que passaram de pending para confirmed (open no HQ) entre `from` e `to` (dias locais). */
async function fetchPendingToOpen(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const end = new Date(`${to}T23:59:59.999`).toISOString();
  const history = await fetchAll((a, b) =>
    supabase
      .from("reservation_status_history")
      .select("reservation_id, changed_at")
      .eq("from_status", "pending")
      .eq("to_status", "confirmed")
      .gte("changed_at", start)
      .lte("changed_at", end)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(a, b),
  );
  if (history.error) throw history.error;
  const changes = history.data as Change[];

  const ids = [...new Set(changes.map((c) => c.reservation_id))];
  const info = new Map<string, ReservationInfo>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from("reservations")
      .select("reservation_id, car_category, total_amount, seller_name, created_at, status")
      .in("reservation_id", ids.slice(i, i + 150));
    if (error) throw error;
    (data as ReservationInfo[]).forEach((r) => info.set(r.reservation_id, r));
  }
  return changes.map((c) => ({ ...c, info: info.get(c.reservation_id) }));
}

export function ControleReservas({ showBack = true }: { showBack?: boolean }) {
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)));
  const [to, setTo] = useState(ymd(today));

  const [statusFilter, setStatusFilter] = useState("all");
  const { data: allChanges, isLoading, error } = useQuery({
    queryKey: ["reservas-pending-open", from, to],
    queryFn: () => fetchPendingToOpen(from, to),
  });
  // Status atual de cada reserva (pode já ter mudado depois de virar open): filtro e coluna.
  const statusOptions = useMemo(
    () => [...new Set((allChanges ?? []).map((c) => c.info?.status).filter((v): v is string => Boolean(v)))].sort(),
    [allChanges],
  );
  const data = useMemo(
    () => (allChanges ?? []).filter((c) => statusFilter === "all" || c.info?.status === statusFilter),
    [allChanges, statusFilter],
  );

  const daily = useMemo(() => {
    const byDay = new Map<string, number>();
    (data ?? []).forEach((c) => byDay.set(localDay(c.changed_at), (byDay.get(localDay(c.changed_at)) ?? 0) + 1));
    const days: { day: string; label: string; reservas: number }[] = [];
    for (let t = Date.parse(`${from}T12:00:00`); t <= Date.parse(`${to}T12:00:00`); t += 86_400_000) {
      const day = ymd(new Date(t));
      days.push({ day, label: br(day).slice(0, 5), reservas: byDay.get(day) ?? 0 });
    }
    return days;
  }, [data, from, to]);

  const total = data?.length ?? 0;
  const amount = (data ?? []).reduce((s, c) => s + (Number(c.info?.total_amount) || 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6"
        style={{ background: "var(--gradient-brand)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo-orc.png" alt="Orlando Rent Car" className="size-9 rounded-lg object-cover" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Controle de Reservas</h1>
            <p className="text-sm text-foreground/70">Reservas que passaram de pending para open (sinal pago).</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-auto" aria-label="De" />
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-auto" aria-label="Até" />
          <ManualSyncButton />
          {showBack ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/app"><ArrowLeft className="mr-1 size-4" /> Módulos</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
        {error ? <Card className="border-destructive/40 p-4 text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</Card> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard icon={CalendarCheck} label="Pending → Open no período" value={isLoading ? "—" : total.toLocaleString("pt-BR")} highlight
            footer={`Média de ${(total / Math.max(1, daily.length)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia`} />
          <KpiCard icon={CalendarCheck} label="Valor dessas reservas" value={isLoading ? "—" : brl(amount)}
            footer="Soma do valor total atual das reservas" />
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-foreground">Reservas que viraram open por dia</h2>
          <p className="text-xs text-muted-foreground">Uma barra por dia do período. O dia é o da sincronização que detectou a mudança.</p>
          <div className="mt-4 h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                <XAxis dataKey="label" minTickGap={8} {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [v.toLocaleString("pt-BR"), "Reservas"]}
                  labelFormatter={(_, p) => br(String(p?.[0]?.payload?.day ?? ""))}
                />
                <Bar dataKey="reservas" name="Reservas" fill="#44E500" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Quais reservas ({total.toLocaleString("pt-BR")})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left">Virou open em</th>
                  <th className="px-3 py-2 text-left">Reserva</th>
                  <th className="px-3 py-2 text-left">Categoria</th>
                  <th className="px-3 py-2 text-left">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      aria-label="Filtrar por status atual"
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs font-medium uppercase text-foreground"
                    >
                      <option value="all">Status atual: todos</option>
                      {statusOptions.map((st) => (
                        <option key={st} value={st}>{statusLabel(st)}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-2 text-left">Vendedor</th>
                  <th className="px-3 py-2 text-left">Criada em</th>
                  <th className="px-5 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((c, i) => (
                  <tr key={c.reservation_id + i} className="border-t border-border">
                    <td className="px-5 py-2">{new Date(c.changed_at).toLocaleDateString("pt-BR", { timeZone: TZ })}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{c.reservation_id}</td>
                    <td className="px-3 py-2">{c.info?.car_category ?? "—"}</td>
                    <td className="px-3 py-2">{statusLabel(c.info?.status)}</td>
                    <td className="px-3 py-2">{c.info?.seller_name ?? "—"}</td>
                    <td className="px-3 py-2">{c.info ? new Date(c.info.created_at).toLocaleDateString("pt-BR", { timeZone: TZ }) : "—"}</td>
                    <td className="px-5 py-2 text-right">{c.info?.total_amount != null ? brl(Number(c.info.total_amount)) : "—"}</td>
                  </tr>
                ))}
                {!isLoading && !total ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">Nenhuma reserva mudou de pending para open no período.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-xs text-muted-foreground">
          O histórico começa na data em que o controle foi ativado e a hora é a da sincronização com o HQ, não a do pagamento. Se uma reserva avançar mais de um status entre duas sincronizações, ela aparece só como pending → confirmed.
        </p>
      </main>
    </div>
  );
}
