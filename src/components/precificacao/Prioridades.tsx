import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Gauge,
  Settings2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { PeriodFilter } from "@/components/precificacao/PeriodFilter";
import { Kpi, PickupChart } from "@/components/precificacao/GestaoOcupacao";
import { LEVEL, dataBR, gapTxt, pct } from "@/lib/pricing-format";
import { useCompetitorSnapshots, useOurRates, type SnapshotRow } from "@/lib/competitive-data";
import { dailyOf, diffPct, marketOf, priceLevel, type Equivalence } from "@/lib/competitiveness";
import {
  BENCH_LEVEL_LABEL,
  ESPERADA_ESTATISTICA,
  EVENT_LABEL,
  addDays,
  buildModel,
  dayPace,
  gapLevel,
  pickupCurve,
  usePace,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { formatLastUpdate } from "@/lib/pricing-forecast";
import type { Range } from "@/lib/pricing-range";
import {
  DEFAULT_CRIT,
  NO_PRICE,
  byPriority,
  fatos,
  hipoteses,
  isOportunidade,
  priorityRows,
  recommend,
  resumir,
  rhythm,
  type Confianca,
  type CritConfig,
  type Criticidade,
  type PriceCtx,
  type PriorityRow,
} from "@/lib/prioridades";

const ALL = "__all__";
const PAGE = 50;
const LEADS: { key: string; label: string; min: number; max: number }[] = [
  { key: "all", label: "Todas as antecedências", min: 0, max: 400 },
  { key: "0-7", label: "D-0 a D-7", min: 0, max: 7 },
  { key: "8-14", label: "D-8 a D-14", min: 8, max: 14 },
  { key: "15-30", label: "D-15 a D-30", min: 15, max: 30 },
  { key: "31-60", label: "D-31 a D-60", min: 31, max: 60 },
  { key: "61-90", label: "D-61 a D-90", min: 61, max: 90 },
  { key: "91+", label: "D-91 ou mais", min: 91, max: 400 },
];
const CRIT_STYLE: Record<Criticidade, { label: string; cls: string }> = {
  critica: {
    label: "Crítica",
    cls: "border-red-500/60 bg-red-500/20 text-red-700 dark:text-red-300",
  },
  atencao: {
    label: "Atenção",
    cls: "border-orange-400/50 bg-orange-400/15 text-orange-700 dark:text-orange-300",
  },
  monitorar: {
    label: "Monitorar",
    cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  },
  ok: { label: "Dentro do esperado", cls: "border-border bg-card text-muted-foreground" },
  "sem-dados": { label: "Sem benchmark", cls: "border-border bg-card text-muted-foreground" },
};
const CONF_LABEL: Record<Confianca, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PRIO_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
const EQ_LABEL: Record<Equivalence, string> = {
  equivalente: "Equivalente",
  parcial: "Parcialmente equivalente",
  nao_equivalente: "Não equivalente",
  nao_avaliada: "Não avaliada",
};
const money = (v: number | null, cur: string) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: cur });
const pctTxt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

function Badge({ c }: { c: Criticidade }) {
  const s = CRIT_STYLE[c];
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}

export function Prioridades({
  range,
  onRangeChange,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const q = usePace();
  if (q.isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (q.error || !q.data)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Sem dados de ocupação para calcular prioridades (rode ritmo.py --publicar em
        scripts/precificacao).
      </Card>
    );
  return <Painel payload={q.data.payload} range={range} onRangeChange={onRangeChange} />;
}

function Painel({
  payload,
  range,
  onRangeChange,
}: {
  payload: NonNullable<ReturnType<typeof usePace>["data"]>["payload"];
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const snaps = useCompetitorSnapshots();
  const rates = useOurRates();
  const [cat, setCat] = useState(ALL);
  const [leadKey, setLeadKey] = useState("all");
  const [crit, setCrit] = useState<CritConfig>(DEFAULT_CRIT);
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<PriorityRow | null>(null);

  // Antecedência atual: a data-base é sempre hoje (nunca se compara uma data em D-49 com a ocupação histórica de D-7).
  const base = payload.hoje;
  const model = useMemo(() => buildModel(payload, ESPERADA_ESTATISTICA), [payload]);
  // O ritmo recente (reservas novas na semana) é comparado com o histórico típico (média), não com o melhor registro.
  const modelRitmo = useMemo(() => buildModel(payload, "media"), [payload]);
  const lead = LEADS.find((l) => l.key === leadKey) ?? LEADS[0]!;
  const all = useMemo(
    () =>
      priorityRows(
        model,
        base,
        {
          from: range.from,
          to: range.to,
          category: cat === ALL ? null : cat,
          minLead: lead.min,
          maxLead: lead.max,
        },
        crit,
      ),
    [model, base, range, cat, lead, crit],
  );

  const moeda = (rates.data ?? [])[0]?.currency.toUpperCase() ?? "USD";
  const ours = useMemo(
    () => new Map((rates.data ?? []).map((r) => [`${r.pickupDate}|${r.category}`, r.dailyRate])),
    [rates.data],
  );
  const groups = useMemo(() => {
    const g = new Map<string, SnapshotRow[]>();
    for (const r of snaps.data ?? []) {
      if (!r.category) continue;
      const k = `${r.pickupAt.slice(0, 10)}|${r.category}`;
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return g;
  }, [snaps.data]);
  const now = useMemo(() => new Date().toISOString(), []);
  const priceOf = useMemo(() => {
    const cache = new Map<string, PriceCtx>();
    return (date: string, category: string): PriceCtx => {
      const k = `${date}|${category}`;
      const hit = cache.get(k);
      if (hit) return hit;
      const mine = ours.get(k) ?? null;
      const m = marketOf(groups.get(k) ?? [], now, moeda);
      const pct_ = mine != null ? diffPct(mine, m.median) : null;
      const ctx: PriceCtx =
        mine == null || m.median == null
          ? { ...NO_PRICE, ourRate: mine, currency: moeda, n: m.n }
          : {
              level: priceLevel(pct_, m.n),
              pct: pct_,
              n: m.n,
              median: m.median,
              min: m.min,
              max: m.max,
              reliable: m.reliable,
              partial: m.partial,
              ourRate: mine,
              currency: moeda,
            };
      cache.set(k, ctx);
      return ctx;
    };
  }, [ours, groups, now, moeda]);

  const ranking = useMemo(
    () =>
      all
        .filter((r) => ["critica", "atencao", "monitorar"].includes(r.criticidade))
        .sort(byPriority),
    [all],
  );
  const sum = useMemo(
    () => resumir(all, crit, (r) => isOportunidade(r, priceOf(r.date, r.category), crit)),
    [all, crit, priceOf],
  );
  const dadosSuf = sum.total ? Math.round((sum.analisadas / sum.total) * 100) : null;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <PeriodFilter
          from={range.from}
          to={range.to}
          onChange={(from, to) => from && to && from <= to && onRangeChange({ from, to })}
          actions={<CritConfigPopover crit={crit} onChange={setCrit} />}
        >
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Categoria</span>
            <Select value={cat} onValueChange={(v) => (setCat(v), setShown(PAGE))}>
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
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Antecedência atual</span>
            <Select value={leadKey} onValueChange={(v) => (setLeadKey(v), setShown(PAGE))}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEADS.map((l) => (
                  <SelectItem key={l.key} value={l.key}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </PeriodFilter>
      </Card>
      <p className="text-xs text-muted-foreground">
        Análise por data de retirada, em {dataBR(base)} (antecedência atual de cada data). Esperada
        = melhor ocupação já registrada em datas passadas comparáveis, na mesma antecedência (não é
        previsão da ocupação final).
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi icon={TrendingDown} label="Datas abaixo do esperado" value={String(sum.below)} />
        <Kpi icon={TrendingUp} label="Datas acima do esperado" value={String(sum.above)} />
        <Kpi
          icon={Gauge}
          label="Gap médio"
          value={sum.gapMedio == null ? "—" : gapTxt(sum.gapMedio)}
          hint="datas com benchmark"
        />
        <Kpi
          icon={AlertTriangle}
          label="Categorias críticas"
          value={String(sum.criticalCategories)}
        />
        <Kpi
          icon={TrendingUp}
          label="Oportunidades de preço"
          value={String(sum.opportunities)}
          hint="acima do esperado e tarifa abaixo do mercado"
        />
        <Kpi
          icon={CalendarClock}
          label="Com dados suficientes"
          value={dadosSuf == null ? "—" : `${dadosSuf}%`}
          hint={`${sum.analisadas} de ${sum.total}`}
        />
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">Datas que precisam de atenção</h2>
          <span className="text-xs text-muted-foreground">{ranking.length} no ranking</span>
        </div>
        {ranking.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma data com gap negativo relevante neste recorte (ou sem benchmark suficiente).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Retirada",
                    "Categoria",
                    "Antec.",
                    "Atual",
                    "Esperada",
                    "Gap",
                    "Veículos",
                    "Sazonalidade",
                    "Criticidade",
                    "Preço vs. mercado",
                  ].map((h) => (
                    <th key={h} className="px-2 py-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranking.slice(0, shown).map((r) => {
                  const p = priceOf(r.date, r.category);
                  return (
                    <tr
                      key={`${r.date}|${r.category}`}
                      className="cursor-pointer border-t border-border hover:bg-muted/40"
                      onClick={() => setSel(r)}
                    >
                      <td className="px-2 py-1.5">{dataBR(r.date)}</td>
                      <td className="px-2 py-1.5">{r.category}</td>
                      <td className="px-2 py-1.5 tabular-nums">D-{r.lead}</td>
                      <td className="px-2 py-1.5 tabular-nums">{pct(r.atual)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{pct(r.esperada)}</td>
                      <td
                        className={`px-2 py-1.5 font-medium tabular-nums ${LEVEL[gapLevel(r.gap!, { strong: crit.gapStrong, mild: crit.gapMild })].text}`}
                      >
                        {gapTxt(r.gap)}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {r.booked}/{r.capacity}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.event ? EVENT_LABEL[r.event] : (r.season ?? "—")}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge c={r.criticidade} />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {p.pct != null ? pctTxt(p.pct) : "sem dados"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ranking.length > shown ? (
          <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            Mostrar mais ({ranking.length - shown} restantes)
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Criticidade combina intensidade do gap, antecedência, veículos ainda livres e relevância
          do período, e é limitada a "Atenção" quando a referência histórica é pouco confiável.
          Clique em uma linha para o diagnóstico.
        </p>
      </Card>

      <Detalhe
        row={sel}
        onClose={() => setSel(null)}
        model={model}
        modelRitmo={modelRitmo}
        base={base}
        crit={crit}
        priceOf={priceOf}
        groups={groups}
        moeda={moeda}
      />
    </div>
  );
}

function CritConfigPopover({
  crit,
  onChange,
}: {
  crit: CritConfig;
  onChange: (c: CritConfig) => void;
}) {
  const campos: { k: keyof CritConfig; label: string }[] = [
    { k: "gapMild", label: "Gap que entra no radar (p.p.)" },
    { k: "gapStrong", label: "Gap de intensidade máxima (p.p.)" },
    { k: "leadUrgent", label: "Urgente até (dias)" },
    { k: "leadNear", label: "Próxima até (dias)" },
    { k: "leadFar", label: "Intermediária até (dias)" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Settings2 className="mr-1 size-4" /> Criticidade
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <p className="text-xs text-muted-foreground">
          Limiares da classificação de criticidade (não alteram a ocupação nem as tarifas).
        </p>
        {campos.map(({ k, label }) => (
          <label key={k} className="flex items-center justify-between gap-2 text-sm">
            <span>{label}</span>
            <Input
              type="number"
              min={1}
              value={crit[k]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) onChange({ ...crit, [k]: v });
              }}
              className="w-20"
            />
          </label>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_CRIT)}>
          Restaurar padrão
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Detalhe({
  row,
  onClose,
  model,
  modelRitmo,
  base,
  crit,
  priceOf,
  groups,
  moeda,
}: {
  row: PriorityRow | null;
  onClose: () => void;
  model: PaceModel;
  modelRitmo: PaceModel;
  base: string;
  crit: CritConfig;
  priceOf: (date: string, category: string) => PriceCtx;
  groups: Map<string, SnapshotRow[]>;
  moeda: string;
}) {
  const paceRow: PaceRow | undefined = useMemo(
    () =>
      row ? model.payload.linhas.find((l) => l.d === row.date && l.c === row.category) : undefined,
    [row, model],
  );
  const p = row ? priceOf(row.date, row.category) : NO_PRICE;
  const r = row && paceRow ? rhythm(modelRitmo, paceRow, row.date, base, row.lead) : null;
  const recs = row ? recommend(row, p, r, crit) : [];
  const curve = useMemo(
    () =>
      row && paceRow
        ? pickupCurve(model, [paceRow], row.date, base).map((c) => ({
            label: c.effective ? `D-${c.L} (hoje)` : `D-${c.L}`,
            atual: c.atual != null ? Math.round(c.atual * 1000) / 10 : null,
            esperada: c.esperada != null ? Math.round(c.esperada * 1000) / 10 : null,
          }))
        : [],
    [row, paceRow, model, base],
  );
  const hist =
    row && paceRow
      ? [364, 728].map((n) => {
          const dt = addDays(row.date, -n);
          const hr = model.payload.linhas.find((l) => l.d === dt && l.c === row.category);
          return dayPace(model, hr ? [hr] : [], dt, base, row.lead);
        })
      : [];
  // Preços individuais: a coleta mais recente de cada concorrente para a data e a categoria.
  const concorrentes = useMemo(() => {
    if (!row) return [];
    const list = groups.get(`${row.date}|${row.category}`) ?? [];
    const last = new Map<string, string>();
    for (const s of list)
      if (!last.get(s.competitor) || s.collectedAt > last.get(s.competitor)!)
        last.set(s.competitor, s.collectedAt);
    return list.filter((s) => s.collectedAt === last.get(s.competitor));
  }, [row, groups]);
  const fts = row ? fatos(row, p, r) : [];
  const hips = row ? hipoteses(row, p, r, crit) : [];
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full space-y-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            Retirada em {row ? dataBR(row.date) : ""} · {row?.category}
          </SheetTitle>
          <SheetDescription>
            {row ? `D-${row.lead} em ${dataBR(base)}` : ""}
            {row ? ` · ${row.event ? EVENT_LABEL[row.event] : row.season}` : ""}
          </SheetDescription>
        </SheetHeader>
        {row ? (
          <>
            <div className="flex items-center gap-2">
              <Badge c={row.criticidade} />
              <span className="text-xs text-muted-foreground">
                Confiança da referência: {CONF_LABEL[row.confianca]}
                {row.level ? ` · ${BENCH_LEVEL_LABEL[row.level]} (${row.n} datas)` : ""}
              </span>
            </div>

            <Card className="space-y-2 p-4">
              <h3 className="font-semibold">O que fazer agora</h3>
              {recs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {row.criticidade === "sem-dados"
                    ? "Sem benchmark histórico para esta data: nenhuma recomendação é feita."
                    : "Sem ação sugerida: ocupação dentro do esperado."}
                </p>
              ) : (
                recs.map((rc, i) => (
                  <div key={i} className="space-y-1 rounded border border-border p-3 text-sm">
                    <p className="font-medium">{rc.problema}</p>
                    <p>
                      <span className="text-muted-foreground">Ação sugerida: </span>
                      {rc.acao}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Prioridade {PRIO_LABEL[rc.prioridade]} · Confiança {CONF_LABEL[rc.confianca]}
                    </p>
                    {rc.impacto ? <p className="text-xs">Impacto potencial: {rc.impacto}</p> : null}
                  </div>
                ))
              )}
              <p className="text-xs text-muted-foreground">
                Evidências: fatos observados no Diagnóstico abaixo. Sugestões para avaliação:
                nenhuma tarifa é alterada automaticamente.
              </p>
            </Card>

            <Card className="space-y-2 p-4 text-sm">
              <h3 className="font-semibold">Diagnóstico</h3>
              <p className="text-xs font-medium text-muted-foreground">Fatos observados</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {fts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {hips.length ? (
                <>
                  <p className="pt-1 text-xs font-medium text-muted-foreground">
                    Hipóteses (não são causas confirmadas)
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {hips.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>

            <div className="grid grid-cols-3 gap-2">
              <Kpi icon={Gauge} label="Atual" value={pct(row.atual)} />
              <Kpi icon={TrendingUp} label="Esperada" value={pct(row.esperada)} />
              <Kpi icon={TrendingDown} label="Gap" value={gapTxt(row.gap)} />
            </div>

            <PickupChart
              title="Curva de pickup da data"
              data={curve}
              note="Esperada = melhor ocupação já registrada por datas comparáveis em cada antecedência. A curva atual só tem pontos até a antecedência de hoje; depois dela nada é previsto."
            />

            <Card className="space-y-1 p-4 text-sm">
              <h3 className="font-semibold">Posicionamento comercial</h3>
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-muted-foreground">Nossa tarifa (tabela HQ)</dt>
                  <dd className="font-medium tabular-nums">{money(p.ourRate, moeda)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mediana dos concorrentes</dt>
                  <dd className="font-medium tabular-nums">{money(p.median, moeda)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Menor / maior preço</dt>
                  <dd className="font-medium tabular-nums">
                    {money(p.min, moeda)} / {money(p.max, moeda)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Diferença vs. mediana</dt>
                  <dd className="font-medium tabular-nums">{pctTxt(p.pct)}</dd>
                </div>
              </dl>
              {p.level === "sem-dados" ? (
                <p className="text-xs text-muted-foreground">
                  {p.n < 3 && p.n > 0
                    ? `Só ${p.n} concorrente(s) comparável(is): mínimo de 3 para posicionar.`
                    : "Sem dados de concorrência (ou sem nossa tarifa) para esta data: nenhum posicionamento é assumido."}
                </p>
              ) : null}
              {concorrentes.length ? (
                <div className="pt-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Preços individuais (coleta mais recente)
                  </p>
                  {concorrentes.map((c) => (
                    <div key={c.id} className="flex justify-between gap-2 text-xs">
                      <span>{c.competitor}</span>
                      <span className="tabular-nums">
                        {money(dailyOf(c), c.currency.toUpperCase())} · {EQ_LABEL[c.equivalence]} ·{" "}
                        {formatLastUpdate(c.collectedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="space-y-1 p-4 text-sm">
              <h3 className="font-semibold">Disponibilidade</h3>
              <p>
                Frota {row.capacity} · reservados {row.booked ?? "—"} · sem reserva {row.vacant}.
              </p>
              <p className="text-xs text-muted-foreground">
                Bloqueios operacionais já estão descontados da frota disponível (não detalhados
                aqui). Cancelamentos: sem dados confiáveis, não são exibidos.
              </p>
            </Card>

            <Card className="space-y-1 p-4 text-sm">
              <h3 className="font-semibold">
                Mesmo dia da semana em períodos anteriores · D-{row.lead}
              </h3>
              {hist.map((h, i) => (
                <div key={h.date} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {i === 0 ? "1 ano antes" : "2 anos antes"} ({dataBR(h.date)})
                  </span>
                  <span className="tabular-nums">
                    {pct(h.atual)}
                    {h.atual == null ? " · sem dado" : ""}
                  </span>
                </div>
              ))}
            </Card>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
