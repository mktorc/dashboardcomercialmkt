import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpDown,
  CheckCircle2,
  Clock,
  ClipboardX,
  DollarSign,
  Search,
  Target,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Sidebar } from "@/components/dashboard/Sidebar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brl, pct } from "@/lib/analytics";
import {
  computeComercial,
  fetchComercial,
  saveGoals,
  type SellerRow,
} from "@/lib/comercial";

export const Route = createFileRoute("/_authenticated/comercial")({
  head: () => ({
    meta: [
      { title: "Comercial | Orlando Rent Car Analytics" },
      {
        name: "description",
        content: "Desempenho individual e da equipe de vendas: oportunidades, conversão, ticket, tarefas e metas.",
      },
      { property: "og:title", content: "Comercial | Orlando Rent Car Analytics" },
      {
        property: "og:description",
        content: "Vendas por vendedor cruzando ClickMassa e HQ Rentals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Comercial,
});

const COLORS = ["#44E500", "#2f9c5a", "#9be870", "#0f7a3d", "#c6f5a8", "#5fbf86", "#e8f9d9", "#1d5e38", "#7ad64a", "#3fae6a"];
const axis = { stroke: "oklch(0.74 0.03 150)", fontSize: 12 };
const tooltipStyle = {
  background: "oklch(0.22 0.03 155)",
  border: "1px solid oklch(0.34 0.045 155)",
  borderRadius: 12,
  color: "#fff",
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const duration = (minutes: number) =>
  minutes < 60 ? `${Math.round(minutes)} min` : `${(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;

type SortKey = keyof Pick<SellerRow, "name" | "oportunidades" | "tasksTotal" | "overdue" | "done" | "noTask" | "reservas" | "conversao" | "ticket" | "faturamento">;

function Comercial() {
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(ymd(now));
  const [seller, setSeller] = useState("all");
  const [search, setSearch] = useState("");
  const [noTaskOpen, setNoTaskOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "faturamento", dir: -1 });

  const { data, isLoading, error } = useQuery({
    queryKey: ["comercial", from, to],
    queryFn: () => fetchComercial(from, to),
  });
  const view = useMemo(() => (data ? computeComercial(data, from, to, seller) : null), [data, from, to, seller]);
  const k = view?.kpis;

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (view?.rows ?? [])
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
      });
  }, [view, search, sort]);

  const goalRows = (view?.rows ?? []).filter((r) => r.key !== "sem_vendedor" && r.key !== "venda_direta" && (r.faturamento || r.revenueGoal));
  const chartH = Math.max(220, goalRows.length * 34);

  const Th = ({ k: key, label, left }: { k: SortKey; label: string; left?: boolean }) => (
    <th className={`px-4 py-3 font-medium ${left ? "text-left" : "text-right"}`}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : -1 }))}
      >
        {label}
        <ArrowUpDown className={`size-3 ${sort.key === key ? "text-accent" : ""}`} />
      </button>
    </th>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar active="comercial" />
      <main className="flex-1 overflow-x-hidden">
        <header
          className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5"
          style={{ background: "var(--gradient-brand)" }}
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">Comercial</h1>
            <p className="text-sm text-foreground/70">Equipe de vendas — ClickMassa + HQ Rentals</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-foreground/70">
              De
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="mt-1 h-9 w-40 bg-card" />
            </label>
            <label className="text-xs text-foreground/70">
              Até
              <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="mt-1 h-9 w-40 bg-card" />
            </label>
            <div className="text-xs text-foreground/70">
              Vendedor
              <Select value={seller} onValueChange={setSeller}>
                <SelectTrigger className="mt-1 h-9 w-48 bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Visão global (equipe)</SelectItem>
                  {view?.sellers.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {view ? <GoalsDialog sellers={view.sellers} month={view.goalMonth} goals={data?.goals ?? []} /> : null}
          </div>
        </header>

        <div className="space-y-6 p-6">
          {error ? (
            <Card className="border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar os dados comerciais agora.
            </Card>
          ) : null}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard icon={Target} label="Oportunidades" value={k ? k.oportunidades.toLocaleString("pt-BR") : "—"} hint="Oportunidades criadas no funil do ClickMassa" />
            <KpiCard icon={UserCheck} label="Taxa de conversão" value={k ? pct(k.conversao) : "—"} hint={k ? `${k.reservas} reservas concluídas` : undefined} highlight />
            <KpiCard icon={DollarSign} label="Ticket médio" value={k ? brl(k.ticket) : "—"} hint={k ? `Faturamento ${brl(k.faturamento)}` : undefined} />
            <button type="button" className="text-left" onClick={() => setNoTaskOpen(true)}>
              <KpiCard icon={ClipboardX} label="Oportunidades sem tarefa" value={k ? k.leadsNoTask.toLocaleString("pt-BR") : "—"} hint="Clique para ver a lista" highlight />
            </button>
            <KpiCard icon={CheckCircle2} label="Taxa de execução de tarefas" value={k ? k.taskExecutionRateFormatted : "—"} hint="Relação de concluídas vs. total" highlight />
            <KpiCard icon={Clock} label="Tempo médio de resposta (SLA)" value={k ? k.slaFormatted : "—"} hint="Lead criado → 1ª interação" />
          </section>

          <section className="grid gap-4 xl:grid-cols-1">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">Oportunidades criadas por dia</h2>
              <p className="text-xs text-muted-foreground">Atendimentos ativos no funil — {seller === "all" ? "equipe inteira" : "vendedor selecionado"}</p>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view?.daily ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                    <XAxis dataKey="dia" {...axis} />
                    <YAxis {...axis} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="oportunidades" name="Oportunidades" fill="#2f9c5a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </section>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-foreground">Valor fechado por vendedor ao mês</h2>
            <p className="text-xs text-muted-foreground">Últimos 6 meses até o fim do período, pela data de criação da reserva</p>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={view?.monthly ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
                  <XAxis dataKey="mes" {...axis} />
                  <YAxis {...axis} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => brl(v)} />
                  <Legend />
                  {view?.stackKeys.map((n, i) => (
                    <Bar key={n} dataKey={n} stackId="a" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <section className="grid gap-4 xl:grid-cols-3">
            <GoalChart title="Receita provisionada" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="faturamento" b="revenueGoal" fmt={brl} />
            <GoalChart title="Ticket médio" subtitle="Alcançado vs. meta" data={goalRows} h={chartH} a="ticket" b="ticketGoal" fmt={brl} />
            <GoalChart title="Desconto médio (%)" subtitle="Desconto ÷ valor antes do desconto" data={goalRows} h={chartH} a="descontoPct" fmt={pct} />
          </section>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Detalhamento por vendedor</h2>
                <p className="text-xs text-muted-foreground">Clique no título da coluna para ordenar</p>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input placeholder="Buscar vendedor" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56 pl-8" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <Th k="name" label="Vendedor" left />
                    <Th k="oportunidades" label="Oportunidades" />
                    <Th k="tasksTotal" label="Tarefas totais" />
                    <Th k="overdue" label="Atrasadas" />
                    <Th k="done" label="Concluídas" />
                    <Th k="noTask" label="Sem tarefa" />
                    <Th k="reservas" label="Reservas" />
                    <Th k="conversao" label="Conversão" />
                    <Th k="ticket" label="Ticket médio" />
                    <Th k="faturamento" label="Valor fechado" />
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                      <td className="px-4 py-3 text-right">{r.oportunidades.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right">{r.tasksTotal}</td>
                      <td className="px-4 py-3 text-right">{r.overdue}</td>
                      <td className="px-4 py-3 text-right">{r.done}</td>
                      <td className="px-4 py-3 text-right">{r.noTask}</td>
                      <td className="px-4 py-3 text-right">{r.reservas}</td>
                      <td className="px-4 py-3 text-right">{r.key === "venda_direta" ? "—" : pct(r.conversao)}</td>
                      <td className="px-4 py-3 text-right">{brl(r.ticket)}</td>
                      <td className="px-4 py-3 text-right font-medium text-accent">{brl(r.faturamento)}</td>
                    </tr>
                  ))}
                  {!tableRows.length ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                        {isLoading ? "Carregando…" : "Nenhum dado no período."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
      <Dialog open={noTaskOpen} onOpenChange={setNoTaskOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Oportunidades sem tarefa ({view?.noTaskList.length ?? 0})</DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 text-left">Criado em</th>
                <th className="py-2 text-left">Contato</th>
                <th className="py-2 text-left">Etapa</th>
                <th className="py-2 text-left">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {(view?.noTaskList ?? []).slice(0, 500).map((l, i) => (
                <tr key={(l.lead_id ?? "") + i} className="border-t border-border">
                  <td className="py-2">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="py-2 text-foreground">{l.name ?? "—"}</td>
                  <td className="py-2">{l.stage_name ?? "—"}</td>
                  <td className="py-2">{l.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(view?.noTaskList.length ?? 0) > 500 ? <p className="text-xs text-muted-foreground">Mostrando os 500 mais recentes.</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GoalChart({
  title,
  subtitle,
  data,
  h,
  a,
  b,
  fmt,
}: {
  title: string;
  subtitle: string;
  data: SellerRow[];
  h: number;
  a: keyof SellerRow;
  b?: keyof SellerRow;
  fmt: (v: number) => string;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-4" style={{ height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.34 0.045 155)" />
            <XAxis type="number" {...axis} tickFormatter={(v: number) => (a === "descontoPct" ? pct(v) : `$${Math.round(v / 1000)}k`)} />
            <YAxis type="category" dataKey="name" width={90} {...axis} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
            <Legend />
            <Bar dataKey={a} name="Alcançado" fill="#44E500" radius={[0, 4, 4, 0]} />
            {b ? <Bar dataKey={b} name="Meta" fill="#2f9c5a" radius={[0, 4, 4, 0]} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function GoalsDialog({
  sellers,
  month,
  goals,
}: {
  sellers: SellerRow[];
  month: string;
  goals: { seller_name: string; month: string; revenue_goal: number; ticket_goal: number }[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(month);
  const [vals, setVals] = useState<Record<string, { r: string; t: string }>>({});

  const load = (mm: string) => {
    const next: Record<string, { r: string; t: string }> = {};
    sellers.forEach((s) => {
      const g = goals.find((x) => x.month === mm && x.seller_name === s.name);
      next[s.name] = { r: g ? String(g.revenue_goal) : "", t: g ? String(g.ticket_goal) : "" };
    });
    setVals(next);
  };

  const mut = useMutation({
    mutationFn: () =>
      saveGoals(
        Object.entries(vals)
          .filter(([, v]) => v.r !== "" || v.t !== "")
          .map(([name, v]) => ({ seller_name: name, month: m, revenue_goal: Number(v.r) || 0, ticket_goal: Number(v.t) || 0 })),
      ),
    onSuccess: () => {
      toast.success("Metas salvas");
      qc.invalidateQueries({ queryKey: ["comercial"] });
      setOpen(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setM(month);
          load(month);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Target className="mr-1 size-4" /> Metas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Metas mensais por vendedor</DialogTitle>
        </DialogHeader>
        <Input
          type="month"
          value={m}
          onChange={(e) => {
            setM(e.target.value);
            load(e.target.value);
          }}
        />
        <div className="grid grid-cols-[1fr_7rem_7rem] gap-2 text-xs text-muted-foreground">
          <span>Vendedor</span>
          <span>Receita (US$)</span>
          <span>Ticket (US$)</span>
          {sellers.map((s) => (
            <div key={s.key} className="contents">
              <span className="self-center text-sm text-foreground">{s.name}</span>
              <Input inputMode="decimal" value={vals[s.name]?.r ?? ""} onChange={(e) => setVals((v) => ({ ...v, [s.name]: { r: e.target.value, t: v[s.name]?.t ?? "" } }))} />
              <Input inputMode="decimal" value={vals[s.name]?.t ?? ""} onChange={(e) => setVals((v) => ({ ...v, [s.name]: { t: e.target.value, r: v[s.name]?.r ?? "" } }))} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            Salvar metas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
