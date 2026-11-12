import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Lightbulb,
  Settings2,
  Tag,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Ajuda, AjudaItem } from "@/components/precificacao/Ajuda";
import { PeriodFilter } from "@/components/precificacao/PeriodFilter";
import { rateKey } from "@/lib/categoria";
import { DetalheData, EtiquetaFrota } from "@/components/precificacao/DetalheData";
import { TOL_PADRAO } from "@/lib/preco-analise";
import { CapturaReservas } from "@/components/precificacao/CapturaReservas";
import { Kpi, PickupChart } from "@/components/precificacao/GestaoOcupacao";
import { LEVEL, dataBR, gapTxt, pct } from "@/lib/pricing-format";
import {
  useCompetitorSnapshots,
  useOurRateFreshness,
  useOurRates,
  type SnapshotRow,
} from "@/lib/competitive-data";
import {
  DEFAULT_PRICE_BANDS,
  dailyOf,
  extrasCost,
  latestExtrasByCompetitor,
  withKnownExtras,
  diffPct,
  marketOf,
  priceLevel,
  type Equivalence,
} from "@/lib/competitiveness";
import {
  BENCH_LEVEL_LABEL,
  ESPERADA_ESTATISTICA,
  EVENT_LABEL,
  addDays,
  buildModel,
  daysBetween,
  gapLevel,
  dayPace,
  DEFAULT_BANDS,
  usePace,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { captureCurve, captureInfo } from "@/lib/capture";
import { formatLastUpdate } from "@/lib/pricing-forecast";
import { todayIso, type Range } from "@/lib/pricing-range";
import {
  DEFAULT_CRIT,
  MARKET_BUCKETS,
  MARKET_LABEL,
  MATRIX_TEXT,
  NIVEIS_RANKING,
  NIVEL_LABEL,
  NIVEL_ORDEM,
  NO_PRICE,
  OCC_BUCKETS,
  acompanhamento,
  JANELA_LABEL,
  JANELA_ORDEM,
  janelaRange,
  TENDENCIA_LABEL,
  byRank,
  enrich,
  fatos,
  hipoteses,
  matrix,
  occBucket,
  priorityRows,
  priceConfidence,
  recommend,
  rhythmPooled,
  histContext,
  worstByDate,
  type Confianca,
  type CritConfig,
  type EnrichedRow,
  type Janela,
  type MarketBucket,
  type Nivel,
  type OccBucket,
  type PriceCtx,
} from "@/lib/prioridades";

const ALL = "__all__";
const PAGE = 24;
/** Faixas de antecedência em ordem crescente, só com os Ds (sem os nomes das janelas). */
const leadBands = (c: CritConfig) => {
  const rangeLabel = (j: Janela) => (j === "plan" ? `D-${c.leadPlan} ou mais` : janelaRange(j, c));
  const faixas = [
    { key: "curto", min: 0, max: c.leadRecup - 1, label: rangeLabel("curto") },
    { key: "recup", min: c.leadRecup, max: c.leadInterv - 1, label: rangeLabel("recup") },
    { key: "p60", min: c.leadInterv, max: 400, label: `D-${c.leadInterv} ou mais` },
    { key: "interv", min: c.leadInterv, max: c.leadAtenc - 1, label: rangeLabel("interv") },
    { key: "atenc", min: c.leadAtenc, max: c.leadStrat - 1, label: rangeLabel("atenc") },
    { key: "estrat", min: c.leadStrat, max: c.leadPlan - 1, label: rangeLabel("estrat") },
    { key: "plan", min: c.leadPlan, max: 400, label: rangeLabel("plan") },
  ].sort((a, b) => a.min - b.min || b.max - a.max);
  return [{ key: "all", label: "Todas as antecedências", min: 0, max: 400 }, ...faixas];
};
const NIVEL_STYLE: Record<Nivel, { badge: string; bar: string; cell: string }> = {
  critica: {
    badge: "border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300",
    bar: "bg-red-500",
    cell: "bg-red-500/80 text-white border-red-600",
  },
  atencao: {
    badge: "border-orange-400/60 bg-orange-400/15 text-orange-700 dark:text-orange-300",
    bar: "bg-orange-400",
    cell: "bg-orange-400/80 text-black border-orange-500",
  },
  monitorar: {
    badge: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
    bar: "bg-yellow-400",
    cell: "bg-yellow-300/70 text-black border-yellow-500",
  },
  oportunidade: {
    badge: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500",
    cell: "bg-sky-500/70 text-white border-sky-600",
  },
  ok: {
    badge: "border-border bg-card text-muted-foreground",
    bar: "bg-emerald-500/60",
    cell: "bg-emerald-500/15 text-foreground border-emerald-500/30",
  },
  "sem-dados": {
    badge: "border-border bg-card text-muted-foreground",
    bar: "bg-muted-foreground/40",
    cell: "bg-muted text-muted-foreground border-dashed border-border",
  },
};
const CONF_LABEL: Record<Confianca, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PRIO_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
const EQ_LABEL: Record<Equivalence, string> = {
  equivalente: "Equivalente",
  parcial: "Parcialmente equivalente",
  nao_equivalente: "Não equivalente",
  nao_avaliada: "Não avaliada",
};
const OCC_LABEL: Record<OccBucket, string> = {
  abaixo: "Abaixo do esperado",
  neutro: "Dentro do esperado",
  acima: "Acima do esperado",
};
const money = (v: number | null, cur: string) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: cur });
const pctTxt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
const rowKey = (r: { date: string; category: string }) => `${r.date}|${r.category}`;

function NivelBadge({ n }: { n: Nivel }) {
  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${NIVEL_STYLE[n].badge}`}
    >
      {NIVEL_LABEL[n]}
    </span>
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
  return (
    <Painel
      payload={q.data.payload}
      geradoEm={q.data.generated_at}
      range={range}
      onRangeChange={onRangeChange}
    />
  );
}

function Painel({
  payload,
  geradoEm,
  range,
  onRangeChange,
}: {
  payload: NonNullable<ReturnType<typeof usePace>["data"]>["payload"];
  geradoEm: string;
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const snaps = useCompetitorSnapshots();
  const rates = useOurRates();
  const nossaColeta = useOurRateFreshness();
  const [cat, setCat] = useState(ALL);
  // Preço com 1 motorista adicional e 1 bebê conforto (alguns concorrentes cobram): desligado = só o preço do veículo.
  const [comExtras, setComExtras] = useState(false);
  const [leadKey, setLeadKey] = useState("p60");
  // Faixa livre: quando o período escolhido não coincide com nenhuma faixa pronta, a antecedência vira "D-x a D-y".
  const [custom, setCustom] = useState<{ min: number; max: number } | null>(null);
  const [nivelF, setNivelF] = useState<string>(ALL);
  const [mktF, setMktF] = useState<string>(ALL);
  const [crit, setCrit] = useState<CritConfig>(DEFAULT_CRIT);
  // Muda a cada filtro: os grupos do ranking voltam ao tamanho inicial.
  const [filtroVersao, setFiltroVersao] = useState(0);
  const setShown = (_: number) => setFiltroVersao((v) => v + 1);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  // Antecedência atual: a data-base é sempre hoje (nunca se compara uma data em D-49 com a ocupação histórica de D-7).
  const base = payload.hoje;
  const model = useMemo(() => buildModel(payload, ESPERADA_ESTATISTICA), [payload]);
  // O ritmo recente (reservas novas na semana) é comparado com o histórico típico (média), não com o melhor registro.
  const modelRitmo = useMemo(() => buildModel(payload, "media"), [payload]);
  const bands = [
    ...leadBands(crit),
    ...(leadKey === "custom" && custom
      ? [
          {
            key: "custom",
            label: `D-${custom.min} a D-${custom.max}`,
            min: custom.min,
            max: custom.max,
          },
        ]
      : []),
  ];
  const lead = bands.find((b) => b.key === leadKey) ?? bands[0]!;
  // O período de retirada acompanha a antecedência escolhida: D-60+ = retiradas de base+60 até o fim da base de ocupação.
  // "Todas" não mexe no período.
  const periodoDaFaixa = (b: { min: number; max: number }): Range => ({
    from: addDays(base, b.min),
    to: b.max >= 400 ? payload.ate : addDays(base, Math.min(b.max, daysBetween(base, payload.ate))),
  });
  const aplicarAntecedencia = (key: string) => {
    setLeadKey(key);
    const b = bands.find((x) => x.key === key);
    if (b && key !== "all") onRangeChange(periodoDaFaixa(b));
  };
  // Mudar o período muda a antecedência: o mesmo intervalo, lido a partir da data de referência. Se coincide com uma faixa pronta,
  // seleciona a faixa; senão, cria a faixa livre "D-x a D-y".
  const aplicarPeriodo = (r: Range) => {
    onRangeChange(r);
    const min = Math.max(0, daysBetween(base, r.from));
    const max = Math.max(min, daysBetween(base, r.to));
    const aberto = r.to >= payload.ate;
    const hit = leadBands(crit).find(
      (b) => b.key !== "all" && b.min === min && (b.max >= 400 ? aberto : b.max === max),
    );
    if (hit) setLeadKey(hit.key);
    else {
      setCustom({ min, max: aberto ? Math.max(max, 400) : max });
      setLeadKey("custom");
    }
    setShown(PAGE);
  };
  // Ao abrir com a faixa padrão e um período que não alcança essa antecedência (ex.: o mês atual com D-60+), alinha o período.
  useEffect(() => {
    const b = bands.find((x) => x.key === leadKey);
    if (b && leadKey !== "all" && range.to < addDays(base, b.min)) onRangeChange(periodoDaFaixa(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const moeda = (rates.data ?? [])[0]?.currency.toUpperCase() ?? "USD";
  const ours = useMemo(
    () =>
      new Map(
        (rates.data ?? []).map((r) => {
          // Nossa cotação: com extras soma o que foi lido no nosso site (grátis hoje); sem leitura, nosso site não cobra esses extras.
          const dias = r.extras?.dias ?? 7;
          const extra = comExtras && r.extras ? extrasCost(r.extras, dias) / dias : 0;
          return [rateKey(r.pickupDate, r.category), r.dailyRate + extra] as [string, number];
        }),
      ),
    [rates.data, comExtras],
  );
  // Coletas de concorrência agrupadas por data × categoria.
  const groups = useMemo(() => {
    // Com extras, coleta antiga (sem leitura) usa o último valor lido do mesmo concorrente, marcado como estimado.
    const todas = snaps.data ?? [];
    const efetivas = comExtras ? withKnownExtras(todas, latestExtrasByCompetitor(todas)) : todas;
    const g = new Map<string, SnapshotRow[]>();
    for (const r of efetivas) {
      if (!r.category) continue;
      const k = rateKey(r.pickupAt.slice(0, 10), r.category);
      g.set(k, [...(g.get(k) ?? []), r]);
    }
    return g;
  }, [snaps.data, comExtras]);
  const now = useMemo(() => new Date().toISOString(), []);
  // Última coleta de cada concorrente esperado (uma fonte parada não pode ficar escondida pela outra).
  const fontes = useMemo(() => {
    const ult = new Map<string, string>();
    for (const r of snaps.data ?? [])
      if (!ult.get(r.competitor) || r.collectedAt > ult.get(r.competitor)!)
        ult.set(r.competitor, r.collectedAt);
    return [
      ...FONTES_ESPERADAS.map((n) => ({ nome: n, iso: ult.get(n) ?? null })),
      { nome: "Nosso site", iso: nossaColeta.data ?? null },
    ];
  }, [snaps.data, nossaColeta.data]);
  const priceOf = useMemo(() => {
    const cache = new Map<string, PriceCtx>();
    return (date: string, category: string): PriceCtx => {
      const k = rateKey(date, category);
      const hit = cache.get(k);
      if (hit) return hit;
      const mine = ours.get(k) ?? null;
      const m = marketOf(groups.get(k) ?? [], now, moeda, comExtras);
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
              lastCollectedAt: m.lastCollectedAt,
            };
      cache.set(k, ctx);
      return ctx;
    };
  }, [ours, groups, now, moeda, comExtras]);

  // Uma única lista filtrada alimenta resumo, ranking, matriz e calendário (mesmos critérios de agregação).
  const base_rows = useMemo(
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
      ).map((r) => {
        const pr = model.byKey.get(rowKey(r));
        const rh = pr ? rhythmPooled(modelRitmo, r.date, r.category, base, crit) : null;
        const hs = pr ? histContext(modelRitmo, pr, r.date, base) : null;
        const cp = pr ? captureInfo(modelRitmo, pr, r.date, base) : null;
        return enrich(r, priceOf(r.date, r.category), crit, rh, cp, hs);
      }),
    [model, modelRitmo, base, range, cat, lead, crit, priceOf],
  );
  // Só para explicar um recorte vazio: quantas datas existem se a antecedência não filtrasse.
  const semFiltroAntecedencia = useMemo(
    () =>
      base_rows.length
        ? base_rows.length
        : priorityRows(
            model,
            base,
            {
              from: range.from,
              to: range.to,
              category: cat === ALL ? null : cat,
              minLead: 0,
              maxLead: 400,
            },
            crit,
          ).length,
    [base_rows, model, base, range, cat, crit],
  );
  const rows = useMemo(
    () =>
      base_rows.filter(
        (r) => (nivelF === ALL || r.nivel === nivelF) && (mktF === ALL || r.market === mktF),
      ),
    [base_rows, nivelF, mktF],
  );
  const ranking = useMemo(
    () => rows.filter((r) => NIVEIS_RANKING.includes(r.nivel)).sort(byRank),
    [rows],
  );
  const mx = useMemo(() => matrix(rows, crit), [rows, crit]);
  const byDate = useMemo(() => worstByDate(rows), [rows]);
  const sel = selKey ? (base_rows.find((r) => rowKey(r) === selKey) ?? null) : null;

  // Indicadores: tudo respeita os mesmos filtros; "D-60+" = a partir do início da janela de intervenção.
  const noJanela = rows.filter((r) => r.lead >= crit.leadInterv);
  const gapJ = noJanela.filter((r) => r.gap != null);
  const problemas = rows.filter((r) => r.nivel === "critica" || r.nivel === "atencao");
  const resumo = {
    criticas: noJanela.filter((r) => r.nivel === "critica").length,
    criticas90: rows.filter((r) => r.nivel === "critica" && r.lead >= crit.leadStrat).length,
    abaixo: noJanela.filter((r) => occBucket(r, crit) === "abaixo").length,
    ritmo: rows.filter((r) => r.pickupAbaixo || r.tendencia === "desacelerando").length,
    gapMedio: gapJ.length ? gapJ.reduce((a, r) => a + r.gap!, 0) / gapJ.length : null,
    nGap: gapJ.length,
    oportunidades: rows.filter((r) => r.nivel === "oportunidade").length,
    precoDesfavoravel: rows.filter((r) => r.market === "acima" && occBucket(r, crit) === "abaixo")
      .length,
    pctNaJanela: problemas.length
      ? Math.round(
          (problemas.filter((r) => r.lead >= crit.leadInterv).length / problemas.length) * 100,
        )
      : null,
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <PeriodFilter
          from={range.from}
          to={range.to}
          onChange={(from, to) => from && to && from <= to && aplicarPeriodo({ from, to })}
          actions={<CritConfigPopover crit={crit} onChange={setCrit} />}
          ajuda={<AjudaPeriodo />}
        >
          <FilterSelect
            label="Antecedência atual"
            ajuda={<AjudaAntecedencia crit={crit} />}
            value={leadKey}
            onChange={(v) => (aplicarAntecedencia(v), setShown(PAGE))}
            options={bands.map((l) => [l.key, l.label] as [string, string])}
          />
          <FilterSelect
            label="Categoria"
            ajuda={<AjudaCategoria />}
            value={cat}
            onChange={(v) => (setCat(v), setShown(PAGE))}
            options={[
              [ALL, "Todas as categorias"],
              ...payload.categorias.map((c) => [c, c] as [string, string]),
            ]}
          />
          <FilterSelect
            label="Criticidade"
            ajuda={<AjudaCriticidade crit={crit} />}
            value={nivelF}
            onChange={(v) => (setNivelF(v), setShown(PAGE))}
            options={[
              [ALL, "Todos os níveis"],
              ...NIVEL_ORDEM.map((n) => [n, NIVEL_LABEL[n]] as [string, string]),
            ]}
          />
          <FilterSelect
            label="Situação de mercado"
            ajuda={<AjudaMercado />}
            value={mktF}
            onChange={(v) => (setMktF(v), setShown(PAGE))}
            options={[
              [ALL, "Todas"],
              ...MARKET_BUCKETS.map((m) => [m, MARKET_LABEL[m]] as [string, string]),
            ]}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox
              checked={comExtras}
              onCheckedChange={(v) => (setComExtras(v === true), setShown(PAGE))}
            />
            <span>Incluir motorista adicional e bebê conforto</span>
            <AjudaExtras />
          </label>
        </PeriodFilter>
      </Card>

      {base_rows.length === 0 ? (
        <RecorteVazio
          todas={semFiltroAntecedencia}
          leadKey={leadKey}
          range={range}
          base={base}
          crit={crit}
          onTodas={() => setLeadKey("all")}
          onProximos={() =>
            aplicarPeriodo({ from: addDays(base, crit.leadInterv), to: addDays(base, 180) })
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              icon={AlertTriangle}
              label={`Críticas em D-${crit.leadInterv}+`}
              value={String(resumo.criticas)}
              hint={`${resumo.criticas90} em D-${crit.leadStrat}+`}
              tone={resumo.criticas ? "text-red-600 dark:text-red-400" : undefined}
            />
            <Kpi
              icon={TrendingDown}
              label={`Abaixo do esperado em D-${crit.leadInterv}+`}
              value={String(resumo.abaixo)}
              hint={
                resumo.pctNaJanela == null
                  ? "—"
                  : `${resumo.pctNaJanela}% dos problemas ainda na janela`
              }
            />
            <Kpi
              icon={Gauge}
              label="Ritmo abaixo do histórico"
              value={String(resumo.ritmo)}
              hint="reservas novas na janela recente"
            />
            <Kpi
              icon={Gauge}
              label={`Gap médio em D-${crit.leadInterv}+`}
              value={resumo.gapMedio == null ? "—" : gapTxt(resumo.gapMedio)}
              hint={`${resumo.nGap} com benchmark`}
            />
            <Kpi
              icon={TrendingUp}
              label="Oportunidades"
              value={String(resumo.oportunidades)}
              hint="acima do esperado, tarifa abaixo do mercado"
              tone={resumo.oportunidades ? "text-sky-600 dark:text-sky-400" : undefined}
            />
            <Kpi
              icon={Tag}
              label="Preço desfavorável"
              value={String(resumo.precoDesfavoravel)}
              hint="abaixo do esperado e tarifa acima do mercado"
            />
          </div>

          <Card className="space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Prioridades de ação</h2>
              <span className="text-xs text-muted-foreground">{ranking.length} no ranking</span>
            </div>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma data exige atenção neste recorte (ou não há benchmark suficiente).
              </p>
            ) : (
              NIVEIS_RANKING.map((n) => {
                const grupo = ranking.filter((r) => r.nivel === n);
                if (!grupo.length) return null;
                return (
                  <GrupoNivel key={n} nivel={n} itens={grupo} versao={filtroVersao}>
                    {(r) => (
                      <PriorityCard
                        key={rowKey(r)}
                        r={r}
                        crit={crit}
                        model={model}
                        modelRitmo={modelRitmo}
                        base={base}
                        comExtras={comExtras}
                        onOpen={() => setSelKey(rowKey(r))}
                      />
                    )}
                  </GrupoNivel>
                );
              })
            )}
            <p className="text-xs text-muted-foreground">
              Ordem: nível de criticidade e, dentro dele, prioridade de ação (gap, antecedência,
              veículos livres, sazonalidade e evidência de mercado). Referência de baixa confiança
              nunca gera “Crítica”. Nenhuma tarifa é alterada automaticamente.
            </p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <DiagnosticMatrix mx={mx} />
            <CriticalityCalendar
              range={range}
              byDate={byDate}
              month={month}
              setMonth={setMonth}
              onOpen={(r) => setSelKey(rowKey(r))}
            />
          </div>
        </>
      )}

      <CapturaReservas
        rows={payload.linhas}
        base={base}
        historyStart={payload.de}
        category={cat === ALL ? null : cat}
        cal={payload.cal}
        from={range.from}
        to={range.to}
      />

      <StatusDados
        base={base}
        geradoEm={geradoEm}
        fontes={fontes}
        temCancelamentos={payload.versao >= 3 && payload.linhas.some((l) => l.x && l.x.length > 0)}
        coletasCarregando={snaps.isLoading || nossaColeta.isLoading}
        total={base_rows.length}
        aposFiltros={rows.length}
        comBenchmark={base_rows.filter((r) => r.gap != null).length}
      />

      <Detalhe
        row={sel}
        siblings={sel ? rows.filter((r) => r.date === sel.date) : []}
        onSwitch={(r) => setSelKey(rowKey(r))}
        onClose={() => setSelKey(null)}
        model={model}
        modelRitmo={modelRitmo}
        base={base}
        crit={crit}
        groups={groups}
        moeda={moeda}
        comExtras={comExtras}
      />
    </div>
  );
}

const FONTES_ESPERADAS = ["UP Rent a Car", "Allycar"];

/** Idade de um dado: até 26 h em dia; até 50 h atrasado; acima, parado. */
function nivelIdade(iso: string | null): "ok" | "atrasado" | "parado" {
  if (!iso) return "parado";
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  return h <= 26 ? "ok" : h <= 50 ? "atrasado" : "parado";
}
const txtIdade = (iso: string) => {
  const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3600000);
  return h < 48 ? `há ${Math.round(h)} h` : `há ${Math.round(h / 24)} dias`;
};
const COR_IDADE = {
  ok: "text-emerald-700 dark:text-emerald-300",
  atrasado: "text-amber-700 dark:text-amber-300",
  parado: "text-red-700 dark:text-red-300",
} as const;

const diasAtras = (iso: string) =>
  Math.max(
    0,
    Math.round(
      (Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) /
        86400000,
    ),
  );

/** Datas e atualizações separadas: referência da análise, geração dos dados de ocupação e última coleta de concorrentes. */
function StatusDados({
  base,
  geradoEm,
  fontes,
  temCancelamentos,
  coletasCarregando,
  total,
  aposFiltros,
  comBenchmark,
}: {
  base: string;
  geradoEm: string;
  fontes: { nome: string; iso: string | null }[];
  temCancelamentos: boolean;
  coletasCarregando: boolean;
  total: number;
  aposFiltros: number;
  comBenchmark: number;
}) {
  const defasagem = diasAtras(base);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          Referência da análise: <b className="text-foreground">{dataBR(base)}</b> (antecedências
          contadas a partir dessa data)
        </span>
        <span>
          Ocupação atualizada em: <b className="text-foreground">{formatLastUpdate(geradoEm)}</b>
        </span>
      </div>
      {defasagem > 0 ? (
        <p className="text-amber-700 dark:text-amber-300">
          Dados de ocupação defasados: a posição das reservas é de {defasagem} dia
          {defasagem > 1 ? "s" : ""} atrás. A análise não reflete reservas feitas desde então (rode
          ritmo.py --publicar).
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-foreground">Saúde dos dados:</span>
        <span className={COR_IDADE[nivelIdade(geradoEm)]}>Ocupação {txtIdade(geradoEm)}</span>
        <span className={temCancelamentos ? COR_IDADE.ok : COR_IDADE.atrasado}>
          Cancelamentos {temCancelamentos ? "publicados" : "ausentes no relatório"}
        </span>
        {coletasCarregando ? (
          <span>coletas: carregando…</span>
        ) : (
          fontes.map((f) => (
            <span key={f.nome} className={COR_IDADE[nivelIdade(f.iso)]}>
              {f.nome} {f.iso ? txtIdade(f.iso) : "sem coleta recente"}
            </span>
          ))
        )}
      </div>
      {!coletasCarregando && fontes.some((f) => nivelIdade(f.iso) !== "ok") ? (
        <p className="text-amber-700 dark:text-amber-300">
          Há coleta de preço com mais de 26 h (ou sem registro): a comparação de mercado pode estar
          desatualizada. Coletas com mais de 7 dias não entram no posicionamento.
        </p>
      ) : null}
      <p>
        Ocupação esperada representa o melhor resultado histórico comparável na mesma antecedência.
        Não é uma previsão.
      </p>
      {total > 0 ? (
        <p>
          {total} combinações de data × categoria no período ({comBenchmark} com benchmark)
          {aposFiltros !== total ? `; ${aposFiltros} após os filtros de criticidade e mercado` : ""}
          .
        </p>
      ) : null}
    </div>
  );
}

function RecorteVazio({
  todas,
  leadKey,
  range,
  base,
  crit,
  onTodas,
  onProximos,
}: {
  todas: number;
  leadKey: string;
  range: Range;
  base: string;
  crit: CritConfig;
  onTodas: () => void;
  onProximos: () => void;
}) {
  const porAntecedencia = leadKey !== "all" && todas > 0;
  return (
    <Card className="space-y-3 p-6 text-sm">
      <p className="font-medium">Nenhuma data no recorte selecionado.</p>
      {porAntecedencia ? (
        <p className="text-muted-foreground">
          Há {todas} combinações de data × categoria em {dataBR(range.from)} a {dataBR(range.to)},
          mas nenhuma na antecedência escolhida
          {leadKey === "p60"
            ? ` (D-${crit.leadInterv} ou mais): o período está a menos de ${crit.leadInterv} dias de ${dataBR(base)}`
            : ""}
          .
        </p>
      ) : (
        <p className="text-muted-foreground">
          Não há datas futuras com ocupação carregada entre {dataBR(range.from)} e{" "}
          {dataBR(range.to)} para a categoria escolhida (a base de ocupação é de {dataBR(base)}).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {porAntecedencia ? (
          <Button size="sm" variant="outline" onClick={onTodas}>
            Mostrar todas as antecedências
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onProximos}>
          Ver os próximos meses (D-{crit.leadInterv} em diante)
        </Button>
      </div>
    </Card>
  );
}

/** Grupos recolhíveis do ranking: todos começam recolhidos. */
function GrupoNivel({
  nivel,
  itens,
  versao,
  children,
}: {
  nivel: Nivel;
  itens: EnrichedRow[];
  versao: number;
  children: (r: EnrichedRow) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [limite, setLimite] = useState(PAGE);
  useEffect(() => setLimite(PAGE), [versao]);
  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="space-y-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded text-left text-sm font-medium hover:bg-muted/40">
        <ChevronRight className={`size-4 transition-transform ${aberto ? "rotate-90" : ""}`} />
        <span className={`size-2.5 rounded-full ${NIVEL_STYLE[nivel].bar}`} />
        {NIVEL_LABEL[nivel]}
        <span className="text-muted-foreground">({itens.length})</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {aberto ? "recolher" : "expandir"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {itens.slice(0, limite).map((r) => children(r))}
        </div>
        {itens.length > limite ? (
          <Button size="sm" variant="outline" onClick={() => setLimite((n) => n + PAGE)}>
            Mostrar mais ({itens.length - limite} restantes)
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function AjudaMatriz() {
  return (
    <Ajuda titulo="Ocupação × preço">
      <p>
        Cruza dois sinais de cada data × categoria: a <b>ocupação</b> contra o esperado (linhas) e o{" "}
        <b>preço</b> contra o mercado (colunas). Cada número é a quantidade de datas × categorias
        naquela combinação; “crít.” é quantas delas são Críticas.
      </p>
      <p>Clique numa célula para ver a leitura sugerida e o que investigar:</p>
      <AjudaItem nome="Abaixo do esperado + preço acima">
        possível perda de competitividade: avaliar a tarifa, conferindo se as ofertas dos
        concorrentes são equivalentes.
      </AjudaItem>
      <AjudaItem nome="Abaixo + preço alinhado ou abaixo">
        o preço sozinho não explica: investigar demanda, canais e disponibilidade. Reduzir mais o
        preço não é o primeiro passo.
      </AjudaItem>
      <AjudaItem nome="Acima do esperado + preço abaixo">
        possível espaço para aumento gradual de tarifa (oportunidade).
      </AjudaItem>
      <AjudaItem nome="Acima + preço acima">
        demanda forte: preservar o posicionamento e monitorar.
      </AjudaItem>
      <AjudaItem nome="Sem dados de mercado">
        não há comparação de preço confiável: nenhuma conclusão sobre preço é tirada (veja a ajuda
        de “Situação de mercado”).
      </AjudaItem>
      <p>
        São hipóteses para investigar, não causas confirmadas. Datas sem benchmark de ocupação ficam
        fora da matriz.
      </p>
    </Ajuda>
  );
}

function AjudaCalendario() {
  return (
    <Ajuda titulo="Calendário de criticidade">
      <p>
        Cada dia é uma data de retirada, colorida pelo <b>pior nível de criticidade</b> entre as
        categorias do recorte. Clique no dia para abrir o diagnóstico completo.
      </p>
      <p>
        A cor <b>não é o percentual de ocupação</b>: mostra o quanto a data está fora do padrão
        histórico comparável, na mesma antecedência.
      </p>
      <AjudaItem nome="Vermelho">Crítica</AjudaItem>
      <AjudaItem nome="Laranja">Atenção</AjudaItem>
      <AjudaItem nome="Amarelo">Monitoramento</AjudaItem>
      <AjudaItem nome="Azul">
        Oportunidade (acima do esperado com tarifa abaixo do mercado)
      </AjudaItem>
      <AjudaItem nome="Verde claro">dentro do esperado</AjudaItem>
      <AjudaItem nome="Cinza tracejado">sem benchmark histórico suficiente</AjudaItem>
      <p>
        Dias sem cor estão fora do período, dos filtros ou sem dados carregados. O calendário segue
        os mesmos filtros do ranking e os níveis são explicados na ajuda de “Criticidade”.
      </p>
    </Ajuda>
  );
}

function AjudaPeriodo() {
  return (
    <Ajuda titulo="Período de retirada">
      <p>
        Datas em que o cliente retira o veículo. A análise avalia cada data de retirada futura do
        período.
      </p>
      <p>
        Está ligado à antecedência: mudar o período ajusta a antecedência e escolher uma
        antecedência ajusta o período.
      </p>
    </Ajuda>
  );
}

function AjudaAntecedencia({ crit }: { crit: CritConfig }) {
  return (
    <Ajuda titulo="Antecedência atual">
      <p>
        Quantos dias faltam, hoje, para a retirada (D-60 = faltam 60 dias). Quanto mais longe, mais
        tempo para influenciar a demanda; perto da retirada entra pouca reserva nova.
      </p>
      {JANELA_ORDEM.slice()
        .reverse()
        .map((j) => (
          <AjudaItem key={j} nome={janelaRange(j, crit)}>
            {JANELA_LABEL[j].toLowerCase()}
          </AjudaItem>
        ))}
      <p>
        D-{crit.leadInterv} ou mais é a principal janela de atuação. As faixas são editáveis em
        “Níveis”.
      </p>
    </Ajuda>
  );
}

function AjudaCategoria() {
  return (
    <Ajuda titulo="Categoria">
      <p>Categoria de veículo do nosso catálogo (ex.: Midsize SUV).</p>
      <p>
        Ocupação esperada, captura de reservas e preços de concorrentes são sempre comparados dentro
        da mesma categoria.
      </p>
    </Ajuda>
  );
}

function AjudaCriticidade({ crit }: { crit: CritConfig }) {
  return (
    <Ajuda titulo="Criticidade">
      <p>
        Quão urgente é a data, considerando o histórico de datas comparáveis na mesma antecedência.
      </p>
      <AjudaItem nome="Crítica">
        ocupação entre as {Math.round(crit.pRel * 100)}% mais baixas do histórico comparável, com
        pelo menos {crit.evidMin} evidências (captura atrás do histórico, ritmo desacelerando,
        diárias faltando, preço acima do mercado), ainda com tempo de agir (D-{crit.leadRecup} ou
        mais) e referência confiável.
      </AjudaItem>
      <AjudaItem nome="Atenção">
        desvio relevante, mas sem evidências suficientes para ser crítica.
      </AjudaItem>
      <AjudaItem nome="Monitoramento">
        sinais iniciais: abaixo da mediana histórica ou um sinal isolado de captura ou ritmo.
      </AjudaItem>
      <AjudaItem nome="Oportunidade">
        ocupação acima do esperado com tarifa abaixo do mercado: possível espaço para aumento.
      </AjudaItem>
      <AjudaItem nome="Dentro do esperado">compatível com o histórico.</AjudaItem>
      <AjudaItem nome="Sem benchmark">
        sem histórico comparável suficiente; nada é afirmado.
      </AjudaItem>
      <p>Os critérios são editáveis em “Níveis”. Nenhuma tarifa é alterada automaticamente.</p>
    </Ajuda>
  );
}

function AjudaExtras() {
  return (
    <Ajuda titulo="Motorista adicional e bebê conforto">
      <p>
        Alguns concorrentes cobram motorista adicional e bebê conforto (ou cadeirinha); outros não.
        Por padrão os preços são só os do veículo (sem taxas e seguros).
      </p>
      <p>
        Marcado, soma 1 motorista adicional e 1 bebê conforto ao preço de cada concorrente (valor
        único ou por diária, como cobrado na data) e ao nosso (hoje grátis), para comparar o custo
        equivalente.
      </p>
      <p>
        Cotações antigas, que não leram os extras, usam o último valor lido do mesmo concorrente e
        aparecem como “estimados” (premissa: ele cobra o mesmo valor). Concorrente sem nenhuma
        leitura de extras fica de fora enquanto a opção estiver marcada: não se presume que seja
        grátis. As coletas novas leem os extras na própria data.
      </p>
    </Ajuda>
  );
}

function AjudaMercado() {
  const { close, significant } = DEFAULT_PRICE_BANDS;
  return (
    <Ajuda titulo="Situação de mercado">
      <p>
        Nossa tarifa comparada com a mediana dos concorrentes para a mesma data e categoria (coletas
        dos últimos 7 dias, na mesma moeda). Por padrão compara só o preço do veículo; marque
        “Incluir motorista adicional e bebê conforto” para somar esses extras, que alguns
        concorrentes cobram.
      </p>
      <AjudaItem nome="Acima do mercado">
        nossa tarifa está mais de {close}% acima da mediana.
      </AjudaItem>
      <AjudaItem nome="Alinhada ao mercado">dentro de ±{close}% da mediana.</AjudaItem>
      <AjudaItem nome="Abaixo do mercado">
        nossa tarifa está mais de {close}% abaixo da mediana.
      </AjudaItem>
      <AjudaItem nome="Sem dados de mercado">
        nenhum concorrente comparável (ou sem nossa tarifa): nenhuma posição é assumida.
      </AjudaItem>
      <p>
        Mais de {significant}% de diferença é tratado como desvio forte. Com 1 ou 2 concorrentes, ou
        ofertas só parcialmente equivalentes, a comparação é de baixa confiança e aparece como
        “(parcial)”.
      </p>
    </Ajuda>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  ajuda,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  ajuda?: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {ajuda}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function PriorityCard({
  r,
  crit,
  model,
  modelRitmo,
  base,
  comExtras,
  onOpen,
}: {
  r: EnrichedRow;
  crit: CritConfig;
  model: PaceModel;
  modelRitmo: PaceModel;
  base: string;
  comExtras: boolean;
  onOpen: () => void;
}) {
  const p = r.price;
  const rec = recommend(r, p, r.ritmo, crit)[0];
  const atual = r.atual == null ? 0 : Math.min(100, r.atual * 100);
  const esperada = r.esperada == null ? null : Math.min(100, r.esperada * 100);
  const lowConf = r.confianca === "baixa";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition hover:border-foreground/40 hover:shadow-sm focus-visible:outline-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {dataBR(r.date)}{" "}
            <span className="font-normal text-muted-foreground">{weekday(r.date)}</span>
          </div>
          <div className="text-sm text-muted-foreground">{r.category}</div>
        </div>
        <NivelBadge n={r.nivel} />
      </div>
      <div>
        <div className="relative h-2 rounded bg-muted">
          <div
            className={`h-2 rounded ${NIVEL_STYLE[r.nivel].bar}`}
            style={{ width: `${atual}%` }}
          />
          {esperada != null ? (
            <div
              className="absolute -top-0.5 h-3 w-0.5 bg-foreground"
              style={{ left: `${esperada}%` }}
              title="Ocupação esperada"
            />
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs tabular-nums">
          <span>
            Atual <b>{pct(r.atual)}</b> · Esperada <b>{pct(r.esperada)}</b>
          </span>
          <b
            className={
              LEVEL[gapLevel(r.gap ?? 0, { strong: crit.gapStrong, mild: crit.gapMild })].text
            }
          >
            {gapTxt(r.gap)}
          </b>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {r.capture ? (
            <>
              Captura{" "}
              <b className="text-foreground">
                {r.capture.atualShare == null ? "—" : pct(r.capture.atualShare)}
              </b>{" "}
              · histórico <b className="text-foreground">{pct(r.capture.histShare)}</b>
              {r.capture.faltam != null && r.capture.faltam >= 1
                ? ` · faltam ${Math.round(r.capture.faltam)} diárias`
                : ""}
            </>
          ) : (
            "Captura: sem referência histórica válida"
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded bg-muted px-1.5 py-0.5">D-{r.lead}</span>
        <span
          className={`rounded bg-muted px-1.5 py-0.5 ${r.tendencia === "desacelerando" ? "text-amber-700 dark:text-amber-300" : ""}`}
          title={r.ritmo?.confianca ? `Confiança ${r.ritmo.confianca}` : undefined}
        >
          {r.tendencia
            ? `Ritmo: ${TENDENCIA_LABEL[r.tendencia].toLowerCase()} (${r.ritmo?.confianca ?? ""})`
            : "Tendência indisponível"}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {r.vacant} de {r.capacity} livres
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {p.pct != null
            ? `${pctTxt(p.pct)} vs. mercado${p.partial ? " (parcial)" : ""}${p.n < 3 ? ` · ${p.n} conc.` : ""}${comExtras ? " · c/ extras" : ""}`
            : "sem dados de mercado"}
        </span>
        {lowConf ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
            referência frágil
          </span>
        ) : null}
      </div>
      {rec ? (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium leading-snug">{rec.problema}</p>
          <p className="text-muted-foreground leading-snug">
            <Lightbulb className="mr-1 inline size-3.5" />
            {rec.acao}
          </p>
        </div>
      ) : null}
    </button>
  );
}

const CELL_TONE: Record<OccBucket, Record<MarketBucket, string>> = {
  abaixo: {
    acima: "bg-red-500/20 border-red-500/50",
    alinhado: "bg-orange-400/15 border-orange-400/50",
    abaixo: "bg-orange-400/15 border-orange-400/50",
    "sem-dados": "bg-muted border-border",
  },
  neutro: {
    acima: "bg-card border-border",
    alinhado: "bg-card border-border",
    abaixo: "bg-card border-border",
    "sem-dados": "bg-card border-border",
  },
  acima: {
    acima: "bg-emerald-500/10 border-emerald-500/40",
    alinhado: "bg-emerald-500/10 border-emerald-500/40",
    abaixo: "bg-sky-500/20 border-sky-500/50",
    "sem-dados": "bg-muted border-border",
  },
};

function DiagnosticMatrix({ mx }: { mx: ReturnType<typeof matrix> }) {
  const [pick, setPick] = useState<{ occ: OccBucket; market: MarketBucket } | null>(null);
  const cell = (o: OccBucket, m: MarketBucket) =>
    mx.cells.find((c) => c.occ === o && c.market === m)!;
  const cur =
    pick ??
    mx.cells
      .filter((c) => c.count)
      .sort((a, b) => b.critical - a.critical || b.count - a.count)[0] ??
    null;
  const txt = cur ? MATRIX_TEXT[cur.occ][cur.market] : null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Ocupação × preço</h2>
        <AjudaMatriz />
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[420px] grid-cols-[110px_repeat(4,1fr)] gap-1.5 text-xs">
          <div />
          {MARKET_BUCKETS.map((m) => (
            <div key={m} className="px-1 text-center text-muted-foreground">
              {MARKET_LABEL[m]}
            </div>
          ))}
          {OCC_BUCKETS.map((o) => (
            <div key={o} className="contents">
              <div className="flex items-center text-muted-foreground">{OCC_LABEL[o]}</div>
              {MARKET_BUCKETS.map((m) => {
                const c = cell(o, m);
                const active = cur?.occ === o && cur.market === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPick({ occ: o, market: m })}
                    className={`rounded border p-2 text-center ${CELL_TONE[o][m]} ${active ? "ring-2 ring-foreground" : ""} ${c.count ? "" : "opacity-50"}`}
                  >
                    <div className="text-xl font-semibold tabular-nums">{c.count}</div>
                    {c.critical ? (
                      <div className="text-red-600 dark:text-red-400">{c.critical} crít.</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {txt && cur ? (
        <div className="space-y-1 rounded border border-border p-3 text-sm">
          <p className="font-medium">{txt.leitura}</p>
          <p className="text-muted-foreground">Investigar: {txt.investigar}</p>
          <p className="text-xs text-muted-foreground">
            Leitura sugerida a partir de dois sinais; não confirma causa.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem datas com benchmark neste recorte.</p>
      )}
      {mx.semBenchmark ? (
        <p className="text-xs text-muted-foreground">
          {mx.semBenchmark} data×categoria sem benchmark de ocupação não entram na matriz.
        </p>
      ) : null}
    </Card>
  );
}

const monthOf = (iso: string) => iso.slice(0, 7);
const addMonth = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function CriticalityCalendar({
  range,
  byDate,
  month,
  setMonth,
  onOpen,
}: {
  range: Range;
  byDate: ReturnType<typeof worstByDate>;
  month: string | null;
  setMonth: (m: string) => void;
  onOpen: (r: EnrichedRow) => void;
}) {
  const first = monthOf(range.from);
  const last = monthOf(range.to);
  const m = month && month >= first && month <= last ? month : first;
  const [y, mo] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  const lead = new Date(y, mo - 1, 1).getDay();
  const days = new Date(y, mo, 0).getDate();
  const title = new Date(y, mo - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Calendário de criticidade</h2>
          <AjudaCalendario />
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            disabled={m <= first}
            onClick={() => setMonth(addMonth(m, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-32 text-center text-sm capitalize">{title}</span>
          <Button
            size="icon"
            variant="ghost"
            disabled={m >= last}
            onClick={() => setMonth(addMonth(m, 1))}
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${m}-${String(i + 1).padStart(2, "0")}`;
          const w = byDate.get(iso);
          if (!w)
            return (
              <div
                key={iso}
                className="rounded border border-transparent py-2 text-center text-xs text-muted-foreground/40"
              >
                {i + 1}
              </div>
            );
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onOpen(w.row)}
              title={`${dataBR(iso)} · ${NIVEL_LABEL[w.nivel]}${w.count > 1 ? ` · ${w.count} categorias` : ""}`}
              className={`rounded border py-2 text-center text-xs font-medium hover:ring-2 hover:ring-foreground ${NIVEL_STYLE[w.nivel].cell}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {NIVEL_ORDEM.map((n) => (
          <span key={n} className="flex items-center gap-1">
            <span className={`size-3 rounded border ${NIVEL_STYLE[n].cell}`} />
            {NIVEL_LABEL[n]}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Cada dia mostra o pior nível entre as categorias do recorte; clique para o diagnóstico.
      </p>
    </Card>
  );
}

function CritConfigPopover({
  crit,
  onChange,
}: {
  crit: CritConfig;
  onChange: (c: CritConfig) => void;
}) {
  const campos: {
    k: keyof CritConfig;
    label: string;
    ajuda: string;
    step?: number;
    neg?: boolean;
  }[] = [
    {
      k: "gapMild",
      label: "Gap que entra no radar (p.p.)",
      ajuda:
        "Pontos percentuais abaixo da ocupação esperada (melhor registro histórico) a partir dos quais a data conta como abaixo do esperado. Também é o limite para considerar acima do esperado. Menor = mais sensível.",
    },
    {
      k: "gapStrong",
      label: "Gap de intensidade máxima (p.p.)",
      ajuda:
        "Gap em que a gravidade do desvio chega ao máximo na pontuação do ranking (e que separa abaixo de muito abaixo). Maior = o ranking diferencia melhor os desvios grandes.",
    },
    {
      k: "leadPlan",
      label: "Planejamento: a partir de D-",
      ajuda:
        "Dias de antecedência a partir dos quais a data é planejamento antecipado (ex.: 120 = D-120 ou mais). Mantenha as faixas em ordem: Planejamento > Estratégica > Atenção prioritária > Intervenção > Recuperação.",
    },
    {
      k: "leadStrat",
      label: "Estratégica: a partir de D-",
      ajuda:
        "Início da janela estratégica (ex.: 90 = D-90 a D-119). Deve ser menor que o início de Planejamento.",
    },
    {
      k: "leadAtenc",
      label: "Atenção prioritária: a partir de D-",
      ajuda:
        "Início da janela de atenção prioritária (ex.: 75 = D-75 a D-89). Deve ser menor que a Estratégica.",
    },
    {
      k: "leadInterv",
      label: "Intervenção: a partir de D-",
      ajuda:
        "Início da janela de intervenção (ex.: 60 = D-60 a D-74). Também define o “D-60 ou mais” dos indicadores e do filtro de antecedência.",
    },
    {
      k: "leadRecup",
      label: "Recuperação: a partir de D-",
      ajuda:
        "Início da janela de recuperação (ex.: 30 = D-30 a D-59). Abaixo disso é acompanhamento final: a data não pode ser Crítica, pois resta pouco tempo de conversão.",
    },
    {
      k: "pRel",
      label: "Desvio relevante: percentil histórico ≤",
      step: 0.05,
      ajuda:
        "Posição da ocupação entre os dias comparáveis do histórico (mesma categoria, época e antecedência). 0,25 = só é desvio relevante se estiver entre os 25% mais baixos. Menor = menos datas em Atenção e Crítica.",
    },
    {
      k: "capDef",
      label: "Evidência: déficit de captura (p.p.)",
      neg: true,
      ajuda:
        "Quantos pontos percentuais a captura atual pode estar abaixo da captura histórica na mesma antecedência para contar como evidência. Use valor negativo (ex.: −15).",
    },
    {
      k: "faltamMin",
      label: "Evidência: diárias faltantes ≥",
      ajuda:
        "Quantas diárias abaixo do padrão histórico contam como evidência. Em frotas pequenas, valores altos quase nunca são atingidos.",
    },
    {
      k: "evidMin",
      label: "Evidências para Crítica",
      ajuda:
        "Quantas evidências a data precisa ter (captura, ritmo, diárias faltantes, preço acima do mercado) para ser Crítica; captura ou ritmo é sempre exigido. Menor = mais críticas.",
    },
    {
      k: "ritmoZ",
      label: "Tendência: z mínimo",
      step: 0.1,
      ajuda:
        "Quão forte deve ser a diferença entre reservas novas e esperadas para declarar acelerando ou desacelerando. Maior = exige mais evidência (1,28 ≈ 90% de confiança).",
    },
    {
      k: "ritmoDisp",
      label: "Tendência: dispersão (var/média)",
      step: 0.5,
      ajuda:
        "Irregularidade das reservas novas: reservas longas cobrem várias datas e fazem as vizinhas variarem juntas. Maior = mais cautela para declarar tendência. O padrão (8) vem do histórico.",
    },
    {
      k: "ritmoVizinhos",
      label: "Tendência: datas vizinhas (±)",
      ajuda:
        "Quantas datas de cada lado (mesma categoria) são somadas para medir o ritmo. Mais vizinhas = mais dados e mais tendências disponíveis, mas mistura datas diferentes.",
    },
    {
      k: "wGrav",
      label: "Peso: gravidade",
      step: 0.05,
      ajuda:
        "Peso, na pontuação do ranking, da gravidade do desvio (gap e posição no histórico). Os pesos mudam a ordem dentro do nível, não o nível, e só a proporção entre eles importa.",
    },
    {
      k: "wFalt",
      label: "Peso: diárias faltantes",
      step: 0.05,
      ajuda:
        "Peso das diárias que faltam em relação ao padrão histórico de captura (impacto estimado).",
    },
    {
      k: "wRitmo",
      label: "Peso: ritmo",
      step: 0.05,
      ajuda:
        "Peso do ritmo recente de reservas. Sem tendência calculável, o fator sai e os pesos se reequilibram.",
    },
    {
      k: "wJanela",
      label: "Peso: janela",
      step: 0.05,
      ajuda:
        "Peso da antecedência: datas em D-60 ou mais ainda têm tempo de reação e pontuam mais.",
    },
    {
      k: "wFrota",
      label: "Peso: frota livre",
      step: 0.05,
      ajuda: "Peso dos veículos ainda sem reserva: com poucos livres há pouco em jogo.",
    },
    {
      k: "wPreco",
      label: "Peso: preço",
      step: 0.05,
      ajuda:
        "Peso do posicionamento de preço: tarifa acima do mercado sobe a data; abaixo do mercado desce. Comparação de baixa confiança vale metade.",
    },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Settings2 className="mr-1 size-4" /> Níveis
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-96 space-y-2 overflow-y-auto">
        <p className="text-xs text-muted-foreground">
          Janelas, critérios dos níveis e pesos da pontuação (não alteram a ocupação nem as
          tarifas). Padrões calibrados no histórico: docs/central-prioridades-captura.md.
        </p>
        {campos.map(({ k, label, ajuda, step, neg }) => (
          <label key={k} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1">
              {label}
              <Ajuda titulo={label}>
                <p>{ajuda}</p>
              </Ajuda>
            </span>
            <Input
              type="number"
              step={step ?? 1}
              value={crit[k]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (neg ? v < 0 : v > 0) onChange({ ...crit, [k]: v });
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
  siblings,
  onSwitch,
  onClose,
  model,
  modelRitmo,
  base,
  crit,
  groups,
  moeda,
  comExtras,
}: {
  row: EnrichedRow | null;
  siblings: EnrichedRow[];
  onSwitch: (r: EnrichedRow) => void;
  onClose: () => void;
  model: PaceModel;
  modelRitmo: PaceModel;
  base: string;
  crit: CritConfig;
  groups: Map<string, SnapshotRow[]>;
  moeda: string;
  comExtras: boolean;
}) {
  const paceRow: PaceRow | undefined = useMemo(
    () => (row ? model.byKey.get(rowKey(row)) : undefined),
    [row, model],
  );
  const p = row?.price ?? NO_PRICE;
  const r = row?.ritmo ?? null;
  const recs = row ? recommend(row, p, r, crit) : [];
  const dPace = useMemo(
    () => (row && paceRow ? dayPace(model, [paceRow], row.date, base) : null),
    [row, paceRow, model, base],
  );
  // Preços individuais: a coleta mais recente de cada oferta de concorrente para a data e a categoria.
  const concorrentes = useMemo(() => {
    if (!row) return [];
    const list = groups.get(rateKey(row.date, row.category)) ?? [];
    const last = new Map<string, string>();
    for (const s of list)
      if (!last.get(s.competitor) || s.collectedAt > last.get(s.competitor)!)
        last.set(s.competitor, s.collectedAt);
    return list.filter((s) => s.collectedAt === last.get(s.competitor));
  }, [row, groups]);
  const cap = row?.capture ?? null;
  const capCurve = useMemo(
    () =>
      row && paceRow
        ? captureCurve(modelRitmo, paceRow, row.date, base).map((c) => ({
            label: c.label,
            atual: c.atual,
            esperada: c.hist,
          }))
        : [],
    [row, paceRow, modelRitmo, base],
  );
  const fts = row ? fatos(row, p, r, cap) : [];
  const hips = row ? hipoteses(row, p, r, crit) : [];
  const occ = row ? occBucket(row, crit) : null;
  const leitura = occ ? MATRIX_TEXT[occ][row!.market] : null;
  const confGeral = row
    ? ((["baixa", "media", "alta"] as Confianca[]).find(
        (c) => c === row.confianca || c === priceConfidence(p),
      ) ?? row.confianca)
    : "baixa";
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full space-y-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row ? `${dataBR(row.date)} ${weekday(row.date)}` : ""} · {row?.category}
          </SheetTitle>
          <SheetDescription>
            {row ? `D-${row.lead} em ${dataBR(base)}` : ""}
            {row ? ` · ${row.event ? EVENT_LABEL[row.event] : row.season}` : ""}
          </SheetDescription>
        </SheetHeader>
        {row ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <NivelBadge n={row.nivel} />
              <span className="ml-auto">
                <EtiquetaFrota capacity={row.capacity} />
              </span>
              {siblings.length > 1
                ? siblings.map((s) => (
                    <Button
                      key={s.category}
                      size="sm"
                      variant={s.category === row.category ? "default" : "outline"}
                      onClick={() => onSwitch(s)}
                    >
                      {s.category}
                    </Button>
                  ))
                : null}
            </div>
            <Tabs defaultValue="demanda" key={rowKey(row)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="demanda">Demanda</TabsTrigger>
                <TabsTrigger value="concorrencia">Concorrência</TabsTrigger>
                <TabsTrigger value="diagnostico">Diagnóstico</TabsTrigger>
                <TabsTrigger value="plano">Plano</TabsTrigger>
              </TabsList>

              <TabsContent value="demanda" className="space-y-3">
                {paceRow && dPace ? (
                  <DetalheData
                    model={model}
                    rows={[paceRow]}
                    date={row.date}
                    base={base}
                    d={dPace}
                    bands={DEFAULT_BANDS}
                    tol={TOL_PADRAO}
                    tarifa={row.price.ourRate}
                    precoVenda={
                      row.price.ourRate != null ? { valor: row.price.ourRate, cobertas: 1, total: 1, faltam: [] } : null
                    }
                    todas={false}
                    rowsFor={(dt) => {
                      const h = model.byKey.get(`${dt}|${row.category}`);
                      return h ? [h] : [];
                    }}
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Referência: {CONF_LABEL[row.confianca]}
                  {row.level ? ` · ${BENCH_LEVEL_LABEL[row.level]} (${row.n} datas)` : ""}.
                  Benchmark = melhor registro comparável em D-{row.lead}.
                </p>
                <Card className="space-y-2 p-4 text-sm">
                  <h3 className="font-semibold">Captura de reservas</h3>
                  {cap ? (
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Esperado (histórico)</dt>
                        <dd className="font-medium tabular-nums">{pct(cap.histShare)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Atual</dt>
                        <dd className="font-medium tabular-nums">{pct(cap.atualShare)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Diferença</dt>
                        <dd className="font-medium tabular-nums">{gapTxt(cap.diffPp)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Faltam vs. padrão</dt>
                        <dd className="font-medium tabular-nums">
                          {cap.faltam == null ? "—" : `${Math.round(cap.faltam)} diárias`}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">
                      Sem referência histórica válida de captura para esta data (amostra
                      insuficiente): nada é estimado.
                    </p>
                  )}
                  <p className="text-xs">
                    {r && r.tendencia ? (
                      <>
                        Ritmo (janela de {r.dias ?? 7} dias, {r.datas ?? 1} datas vizinhas somadas):{" "}
                        {r.novas} diárias novas contra {r.esperadas!.toFixed(1)} esperadas
                        {r.anteriores != null ? ` (janela anterior: ${r.anteriores})` : ""} →{" "}
                        <b>{TENDENCIA_LABEL[r.tendencia].toLowerCase()}</b>, confiança {r.confianca}
                        .
                      </>
                    ) : (
                      <>
                        <b>Tendência indisponível</b>
                        {r?.esperadas != null
                          ? `: o histórico esperaria só ${r.esperadas.toFixed(1)} diárias na janela (amostra insuficiente); isso não significa ritmo estável.`
                          : ": sem referência histórica comparável."}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Captura = % da ocupação final típica já contratada; não é a ocupação da frota
                    acima.
                    {cap ? ` ${cap.n} datas comparáveis (${BENCH_LEVEL_LABEL[cap.level]}).` : ""}
                  </p>
                </Card>
                <PickupChart
                  title="Curva de captura (% da ocupação final)"
                  data={capCurve}
                  note={`A linha tracejada é a captura histórica em cada antecedência; a linha cheia é esta data, só até D-${row.lead} (hoje). Sem previsão além disso.`}
                />
              </TabsContent>

              <TabsContent value="concorrencia" className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-muted-foreground">Nossa tarifa (tabela HQ)</dt>
                    <dd className="font-medium tabular-nums">{money(p.ourRate, moeda)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Mediana do mercado</dt>
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
                    Sem dados de concorrência comparáveis (ou sem nossa tarifa) para esta data:
                    nenhum posicionamento é assumido.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {p.n} concorrente{p.n > 1 ? "s" : ""} comparável
                    {p.n > 1 ? "is" : ""}
                    {p.n < 3 || !p.reliable ? " · benchmark de baixa confiabilidade" : ""}
                    {p.lastCollectedAt
                      ? ` · última coleta ${formatLastUpdate(p.lastCollectedAt)}`
                      : ""}
                    . Só entram ofertas equivalentes, na mesma moeda e coletadas nos últimos 7 dias.
                  </p>
                )}
                {concorrentes.length ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Preços individuais (coleta mais recente)
                    </p>
                    {concorrentes.map((c) => (
                      <div key={c.id} className="flex justify-between gap-2 text-xs">
                        <span>{c.competitor}</span>
                        <span className="text-right tabular-nums">
                          {money(dailyOf(c, comExtras), c.currency.toUpperCase())}
                          {comExtras
                            ? c.extrasEstimados
                              ? " (c/ extras estimados)"
                              : " (c/ extras)"
                            : ""}{" "}
                          · {EQ_LABEL[c.equivalence]} · {formatLastUpdate(c.collectedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="diagnostico" className="space-y-3 text-sm">
                {leitura ? (
                  <div className="rounded border border-border p-3">
                    <p className="font-medium">{leitura.leitura}</p>
                    <p className="text-muted-foreground">Investigar: {leitura.investigar}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Fatos observados</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {fts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Possíveis causas (hipóteses, não confirmadas)
                  </p>
                  {hips.length ? (
                    <ul className="list-disc space-y-0.5 pl-5">
                      {hips.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma hipótese a levantar.</p>
                  )}
                </div>
                <p className="text-xs">
                  Nível de confiança do diagnóstico: <b>{CONF_LABEL[confGeral]}</b> (menor entre
                  referência de ocupação — {CONF_LABEL[row.confianca]} — e de preço —{" "}
                  {CONF_LABEL[priceConfidence(p)]}).
                </p>
              </TabsContent>

              <TabsContent value="plano" className="space-y-3 text-sm">
                <div className="space-y-1 rounded border border-border p-3">
                  <p className="font-medium">
                    Por que está nesta posição: {row.rank.toFixed(0)} pontos
                  </p>
                  {row.fatores.length ? (
                    row.fatores.map((f) => (
                      <div key={f.chave} className="text-xs">
                        <div className="flex justify-between gap-2">
                          <span>
                            {f.label}{" "}
                            <span className="text-muted-foreground">
                              (peso {(f.peso * 100).toFixed(0)}%)
                            </span>
                          </span>
                          <b className="tabular-nums">
                            {f.valor == null ? "indisponível" : `+${f.pontos.toFixed(1)}`}
                          </b>
                        </div>
                        <div className="text-muted-foreground">{f.detalhe}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Oportunidade: pontuação pela intensidade do gap positivo e pela janela.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Fatores indisponíveis saem e os pesos são renormalizados; referência frágil
                    reduz a pontuação.
                    {row.evidencias.length
                      ? ` Evidências: ${row.evidencias.join("; ")}.`
                      : " Nenhuma evidência adicional."}
                  </p>
                </div>
                {recs.length === 0 ? (
                  <p className="text-muted-foreground">
                    {row.nivel === "sem-dados"
                      ? "Sem benchmark histórico para esta data: nenhuma recomendação é feita."
                      : "Sem ação sugerida: ocupação dentro do esperado."}
                  </p>
                ) : (
                  recs.map((rc, i) => (
                    <div key={i} className="space-y-1 rounded border border-border p-3">
                      <p className="text-xs text-muted-foreground">
                        Prioridade {PRIO_LABEL[rc.prioridade]} · Confiança{" "}
                        {CONF_LABEL[rc.confianca]}
                      </p>
                      <p>
                        <b>Ação sugerida:</b> {rc.acao}
                      </p>
                      <p>
                        <b>Justificativa:</b> {rc.problema}
                      </p>
                      {rc.impacto ? (
                        <p className="text-xs">Impacto potencial: {rc.impacto}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Acompanhamento: {acompanhamento(row.lead, crit)}
                      </p>
                    </div>
                  ))
                )}
                <p className="text-xs text-muted-foreground">
                  Sugestões para avaliação: nenhuma tarifa é alterada automaticamente.
                </p>
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
