import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronLeft,
  ChevronRight,
  Settings2,
  TrendingDown,
  TrendingUp,
  Target,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PeriodFilter } from "@/components/precificacao/PeriodFilter";
import { ReferenciasAnteriores } from "@/components/precificacao/ReferenciasAnteriores";
import { LEVEL, dataBR, gapTxt, pct } from "@/lib/pricing-format";
import { addMonths, monthEnd, monthStart, type Range } from "@/lib/pricing-range";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DEFAULT_BANDS,
  ESPERADA_ESTATISTICA,
  BENCH_LEVEL_LABEL,
  CURVE_LEADS,
  EVENT_LABEL,
  addDays,
  buildModel,
  dailySeries,
  dayPace,
  gapLevel,
  pickupCurve,
  rowsByDate,
  summarize,
  usePace,
  type DayPace,
  type GapBands,
  type GapLevel,
  type PaceModel,
  type PacePayload,
  type PaceRow,
} from "@/lib/occupancy-pace";

const ALL = "__all__";
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function GestaoOcupacao({
  range,
  onRangeChange,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const q = usePace();
  if (q.isLoading)
    return <Card className="p-6 text-sm text-muted-foreground">Carregando ocupação…</Card>;
  if (q.error)
    return (
      <Card className="p-6 text-sm text-destructive">
        Não foi possível carregar os dados de ocupação.
      </Card>
    );
  if (!q.data)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhum dado de ritmo publicado ainda. Rode ritmo.py --publicar em scripts/precificacao.
      </Card>
    );
  if (q.data.payload.versao < 2)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Os dados publicados usam um formato antigo. Rode ritmo.py --publicar em scripts/precificacao
        para atualizar.
      </Card>
    );
  return <Painel payload={q.data.payload} range={range} onRangeChange={onRangeChange} />;
}

function Painel({
  payload,
  range,
  onRangeChange,
}: {
  payload: PacePayload;
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const { from, to } = range;
  const [cat, setCat] = useState(ALL);
  const [base, setBaseRaw] = useState(payload.hoje);
  const [bands, setBands] = useState<GapBands>(DEFAULT_BANDS);
  const [sel, setSel] = useState<string | null>(null);

  // Data-base: padrão hoje; nunca depois de hoje (o histórico do benchmark só vai até hoje) nem antes do início dos dados.
  const setBase = (v: string) =>
    v && setBaseRaw(v < payload.de ? payload.de : v > payload.hoje ? payload.hoje : v);
  const model = useMemo(() => buildModel(payload, ESPERADA_ESTATISTICA), [payload]);
  const byDate = useMemo(() => rowsByDate(payload, cat === ALL ? null : cat), [payload, cat]);
  const days = useMemo(
    () => dailySeries(model, byDate, from, to, base),
    [model, byDate, from, to, base],
  );
  const sum = useMemo(() => summarize(days, bands), [days, bands]);
  const outOfRange = from < payload.de || to > payload.ate;

  const setRange = (a: string, b: string) => {
    if (a && b && a <= b) onRangeChange({ from: a, to: b });
  };
  const fullMonth = from === monthStart(from) && to === monthEnd(from);
  const shift = (dir: 1 | -1) => {
    if (fullMonth) setRange(addMonths(from, dir), monthEnd(addMonths(from, dir)));
    else {
      const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      setRange(addDays(from, dir * len), addDays(to, dir * len));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <PeriodFilter
          from={from}
          to={to}
          onChange={setRange}
          actions={<BandsConfig bands={bands} onChange={setBands} />}
        >
          <Field label="Categoria">
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as categorias</SelectItem>
                {payload.categorias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Data-base da análise">
            <div className="flex gap-1">
              <Input
                type="date"
                value={base}
                min={payload.de}
                max={payload.hoje}
                onChange={(e) => setBase(e.target.value)}
                className="w-40"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={base === payload.hoje}
                onClick={() => setBase(payload.hoje)}
              >
                Hoje
              </Button>
            </div>
          </Field>
        </PeriodFilter>
      </Card>

      <p className="text-xs text-muted-foreground">
        A antecedência de cada data é a retirada menos a data-base ({dataBR(base)}): por exemplo,{" "}
        {dataBR(addDays(base, 49))} está em D-49. Esperada = a melhor ocupação já registrada em
        datas passadas comparáveis (mesma categoria; mesmo evento e posição relativa no Carnaval,
        Semana Santa e Corpus Christi; nas demais, mesma sazonalidade e dia da semana) na mesma
        antecedência, usando só datas encerradas antes da data-base. Não é previsão da ocupação
        final. Datas já encerradas aparecem em D-0, com a ocupação final.
      </p>
      {outOfRange ? (
        <Card className="p-3 text-sm text-muted-foreground">
          Há dados de {dataBR(payload.de)} a {dataBR(payload.ate)}; fora disso as datas ficam
          vazias.
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          icon={Gauge}
          label="Ocupação atual média"
          value={pct(sum.atual)}
          hint={`base ${dataBR(base).slice(0, 5)} · ${sum.compared} datas`}
        />
        <Kpi
          icon={Target}
          label="Ocupação esperada média"
          value={pct(sum.esperada)}
          hint="melhor já registrada"
        />
        <Kpi
          icon={sum.gap != null && sum.gap < 0 ? TrendingDown : TrendingUp}
          label="Gap de ocupação"
          value={gapTxt(sum.gap)}
          tone={sum.gap != null ? LEVEL[gapLevel(sum.gap, bands)].text : undefined}
          hint="atual − esperada"
        />
        <Kpi
          icon={TrendingDown}
          label="Datas abaixo do esperado"
          value={String(sum.below)}
          tone="text-red-600 dark:text-red-300"
          hint={`gap < −${bands.mild} p.p.`}
        />
        <Kpi
          icon={TrendingUp}
          label="Datas acima do esperado"
          value={String(sum.above)}
          tone="text-green-700 dark:text-green-300"
          hint={`gap > +${bands.mild} p.p.`}
        />
      </div>

      <Calendario
        days={days}
        from={from}
        to={to}
        bands={bands}
        base={base}
        onSelect={setSel}
        onShift={shift}
      />
      <Comparativo days={days} base={base} bands={bands} />
      <Pickup model={model} byDate={byDate} from={from} to={to} base={base} />

      <Detalhe
        model={model}
        date={sel}
        cat={cat}
        byDate={byDate}
        base={base}
        bands={bands}
        onClose={() => setSel(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: string | undefined;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

function BandsConfig({ bands, onChange }: { bands: GapBands; onChange: (b: GapBands) => void }) {
  const set = (key: keyof GapBands, v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) onChange({ ...bands, [key]: n });
  };
  const valid = bands.mild < bands.strong;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1 size-4" /> Faixas de cor
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 text-sm">
        <p className="text-muted-foreground">
          Limites do gap, em pontos percentuais, para as cores do calendário e das contagens.
        </p>
        <Field label="Neutro até ± (p.p.)">
          <Input
            type="number"
            min={0}
            value={bands.mild}
            onChange={(e) => set("mild", e.target.value)}
          />
        </Field>
        <Field label="Intenso a partir de ± (p.p.)">
          <Input
            type="number"
            min={0}
            value={bands.strong}
            onChange={(e) => set("strong", e.target.value)}
          />
        </Field>
        {!valid ? (
          <p className="text-destructive">O limite intenso deve ser maior que o neutro.</p>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_BANDS)}>
          Restaurar padrão
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Calendario({
  days,
  from,
  to,
  bands,
  base,
  onSelect,
  onShift,
}: {
  days: DayPace[];
  from: string;
  to: string;
  bands: GapBands;
  base: string;
  onSelect: (d: string) => void;
  onShift: (dir: 1 | -1) => void;
}) {
  const byDay = new Map(days.map((d) => [d.date, d]));
  const months: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) months.push(m);
  const title =
    months.length === 1
      ? `${MONTHS[Number(from.slice(5, 7)) - 1]} de ${from.slice(0, 4)}`
      : `${dataBR(from)} a ${dataBR(to)}`;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {title} · base {dataBR(base)}
        </h2>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Período anterior"
            onClick={() => onShift(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Próximo período"
            onClick={() => onShift(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      {months.map((m) => {
        const first = new Date(`${m}T00:00:00Z`).getUTCDay();
        const cells = Array.from({ length: first }, () => null as string | null);
        for (let d = m; d <= monthEnd(m); d = addDays(d, 1)) cells.push(d);
        return (
          <div key={m} className="space-y-1">
            {months.length > 1 ? (
              <div className="text-sm font-medium">
                {MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
              </div>
            ) : null}
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
              {WEEK.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                const d = date && date >= from && date <= to ? byDay.get(date) : undefined;
                if (!date) return <div key={`b${i}`} />;
                if (!d)
                  return (
                    <div
                      key={date}
                      className="min-h-20 rounded-lg border border-dashed border-border/40 p-1.5 text-xs text-muted-foreground/50"
                    >
                      {Number(date.slice(8))}
                    </div>
                  );
                const lv = d.gap != null ? LEVEL[gapLevel(d.gap, bands)] : null;
                return (
                  <button
                    key={date}
                    onClick={() => onSelect(date)}
                    title={`${dataBR(date)} · ${d.closed ? "encerrada (D-0)" : `D-${d.lead}`}${d.event ? ` · ${EVENT_LABEL[d.event]} (${d.eventRel! > 0 ? "+" : ""}${d.eventRel})` : ""} · ${lv ? lv.label : "sem benchmark (histórico insuficiente)"}`}
                    className={`min-h-20 rounded-lg border p-1.5 text-left transition hover:scale-[1.03] hover:shadow-md focus-visible:outline focus-visible:outline-2 ${lv?.card ?? "border-border bg-muted/30"}`}
                  >
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{Number(date.slice(8))}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {d.closed ? "D-0" : `D-${d.lead}`}
                      </span>
                    </div>
                    {d.event ? (
                      <div className="truncate text-[9px] text-muted-foreground">
                        {EVENT_LABEL[d.event]}
                      </div>
                    ) : null}
                    {d.atual == null && d.esperada == null ? (
                      <div className="mt-1 text-[10px] text-muted-foreground">sem dados</div>
                    ) : (
                      <>
                        <div className="text-base font-semibold leading-tight tabular-nums">
                          {pct(d.atual)}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          esp. {pct(d.esperada)}
                        </div>
                        <div
                          className={`text-[11px] font-semibold tabular-nums ${lv?.text ?? "text-muted-foreground"}`}
                        >
                          {gapTxt(d.gap)}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(LEVEL) as GapLevel[]).map((l) => (
          <span key={l} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded border ${LEVEL[l].card}`} />
            {LEVEL[l].label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function Comparativo({ days, base, bands }: { days: DayPace[]; base: string; bands: GapBands }) {
  const data = days.map((d) => ({
    date: d.date,
    label: d.date.slice(8) + "/" + d.date.slice(5, 7),
    atual: d.atual != null ? Math.round(d.atual * 1000) / 10 : null,
    esperada: d.esperada != null ? Math.round(d.esperada * 1000) / 10 : null,
    gap: d.gap,
    lead: d.lead,
    closed: d.closed,
  }));
  const has = data.some((d) => d.atual != null || d.esperada != null);
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-semibold">Ocupação atual vs. esperada · base {dataBR(base)}</h2>
      {!has ? (
        <p className="text-sm text-muted-foreground">
          Sem dados para o período e a data-base escolhidos.
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={16} />
              <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
              <ChartTooltip content={<LineTip bands={bands} />} />
              <ReferenceLine y={100} stroke="var(--border)" />
              <Line
                type="monotone"
                dataKey="esperada"
                name="Esperada"
                stroke="var(--muted-foreground)"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="atual"
                name="Atual"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={{ r: 2 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" />
          Atual
        </span>
        <span>
          <span className="mr-1 inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground align-middle" />
          Esperada
        </span>
      </div>
    </Card>
  );
}

function LineTip({
  active,
  payload,
  bands,
}: {
  active?: boolean;
  payload?: {
    payload: {
      date: string;
      atual: number | null;
      esperada: number | null;
      gap: number | null;
      lead: number;
      closed: boolean;
    };
  }[];
  bands: GapBands;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const lv = p.gap != null ? LEVEL[gapLevel(p.gap, bands)] : null;
  return (
    <div className="rounded-lg border border-border bg-popover p-2 text-xs shadow-md">
      <div className="font-medium">Retirada: {dataBR(p.date)}</div>
      <div>Ocupação atual: {p.atual != null ? `${p.atual.toFixed(0)}%` : "—"}</div>
      <div>Ocupação esperada: {p.esperada != null ? `${p.esperada.toFixed(0)}%` : "—"}</div>
      <div className={lv?.text}>
        Gap: {gapTxt(p.gap)}
        {lv ? ` · ${lv.label}` : ""}
      </div>
      <div className="text-muted-foreground">
        Antecedência: {p.closed ? "encerrada (D-0)" : `D-${p.lead}`}
      </div>
    </div>
  );
}

/** Pickup do período: por antecedência, média só das datas que já têm foto observada E benchmark. */
function Pickup({
  model,
  byDate,
  from,
  to,
  base,
}: {
  model: PaceModel;
  byDate: Map<string, PaceRow[]>;
  from: string;
  to: string;
  base: string;
}) {
  const data = useMemo(() => {
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (byDate.has(d)) dates.push(d);
    return CURVE_LEADS.map((L) => {
      const ds = dates
        .map((d) => dayPace(model, byDate.get(d)!, d, base, L))
        .filter((d) => d.atual != null && d.esperada != null);
      const avg = (f: (d: DayPace) => number) =>
        ds.length ? Math.round((ds.reduce((x, d) => x + f(d), 0) / ds.length) * 1000) / 10 : null;
      return {
        label: `D-${L}`,
        atual: avg((d) => d.atual!),
        esperada: avg((d) => d.esperada!),
        n: ds.length,
      };
    });
  }, [model, byDate, from, to, base]);
  return (
    <PickupChart
      title="Curva de pickup do período"
      data={data}
      note="Cada ponto usa só as datas do período que já alcançaram aquela antecedência na data-base; antecedências que ainda não chegaram ficam sem ocupação atual, sem previsão."
    />
  );
}

export function PickupChart({
  title,
  data,
  note,
}: {
  title: string;
  data: { label: string; atual: number | null; esperada: number | null; n?: number }[];
  note?: string;
}) {
  const has = data.some((d) => d.atual != null || d.esperada != null);
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-semibold">{title}</h2>
      {!has ? (
        <p className="text-sm text-muted-foreground">Sem dados para este recorte.</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
              <ChartTooltip
                formatter={(v: number | string) =>
                  typeof v === "number" ? `${v.toFixed(0)}%` : "—"
                }
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="esperada"
                name="Histórica média"
                stroke="var(--muted-foreground)"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="atual"
                name="Atual"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" />
          Atual (só até onde há dado observado)
        </span>
        <span>
          <span className="mr-1 inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground align-middle" />
          Histórica média
        </span>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

function Detalhe({
  model,
  date,
  cat,
  byDate,
  base,
  bands,
  onClose,
}: {
  model: PaceModel;
  date: string | null;
  cat: string;
  byDate: Map<string, PaceRow[]>;
  base: string;
  bands: GapBands;
  onClose: () => void;
}) {
  const rows = useMemo(() => (date ? (byDate.get(date) ?? []) : []), [byDate, date]);
  const d = date ? dayPace(model, rows, date, base) : null;
  const curve = useMemo(
    () =>
      date
        ? pickupCurve(model, rows, date, base).map((p) => ({
            label: p.effective ? `D-${p.L} (base)` : `D-${p.L}`,
            atual: p.atual != null ? Math.round(p.atual * 1000) / 10 : null,
            esperada: p.esperada != null ? Math.round(p.esperada * 1000) / 10 : null,
          }))
        : [],
    [model, rows, date, base],
  );
  const lv = d?.gap != null ? LEVEL[gapLevel(d.gap, bands)] : null;
  const leadTxt = d ? (d.closed ? "encerrada (D-0)" : `D-${d.lead}`) : "";
  return (
    <Sheet open={!!date} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full space-y-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Retirada em {date ? dataBR(date) : ""}</SheetTitle>
          <SheetDescription>
            {cat === ALL ? "Todas as categorias" : cat} · {leadTxt} na data-base {dataBR(base)}
          </SheetDescription>
        </SheetHeader>
        {d ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Kpi icon={Gauge} label="Atual" value={pct(d.atual)} />
              <Kpi icon={Target} label="Esperada" value={pct(d.esperada)} />
              <Kpi icon={TrendingUp} label="Gap" value={gapTxt(d.gap)} tone={lv?.text} />
            </div>
            {lv ? (
              <p className={`text-sm font-medium ${lv.text}`}>{lv.label}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Histórico comparável insuficiente: sem benchmark para esta data.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Veículos reservados</dt>
                <dd className="font-medium tabular-nums">{d.booked ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Capacidade disponível</dt>
                <dd className="font-medium tabular-nums">{d.capacity}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sazonalidade</dt>
                <dd className="font-medium">{d.season ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Evento móvel</dt>
                <dd className="font-medium">
                  {d.event
                    ? `${EVENT_LABEL[d.event]} (${d.eventRel! > 0 ? "+" : ""}${d.eventRel} dias)`
                    : "—"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Base do benchmark</dt>
                <dd className="font-medium">
                  {d.level ? `${BENCH_LEVEL_LABEL[d.level]} · ${d.n} datas passadas` : "—"}
                </dd>
              </div>
              {d.semBenchmark && d.semBenchmark.length ? (
                <div className="col-span-2 text-xs text-muted-foreground">
                  {d.esperada != null
                    ? `Esperado e gap não incluem ${d.semBenchmark.join(", ")} (sem histórico comparável); cobertura de ${((d.cobertura ?? 0) * 100).toFixed(0)}% da frota.`
                    : `Sem esperado: ${d.semBenchmark.join(", ")} não tem histórico comparável e as demais categorias cobrem só ${((d.cobertura ?? 0) * 100).toFixed(0)}% da frota.`}
                </div>
              ) : null}
            </dl>
            <PickupChart
              title="Curva de pickup da data"
              data={curve}
              note="Esperada = melhor ocupação já registrada por datas comparáveis em cada antecedência. A curva atual só tem pontos até a antecedência da data-base; depois dela não há observação e nada é previsto."
            />
            <ReferenciasAnteriores
              model={model}
              date={date!}
              base={base}
              lead={d.lead}
              leadLabel={d.closed ? "D-0" : `D-${d.lead}`}
              rowsFor={(dt) => byDate.get(dt) ?? []}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
