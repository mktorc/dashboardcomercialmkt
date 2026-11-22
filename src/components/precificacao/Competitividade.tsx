import { useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Info, SlidersHorizontal, X } from "lucide-react";
import { coletarPeriodo } from "@/lib/coleta-periodo.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rateKey } from "@/lib/categoria";
import { useCompetitorSnapshots, useOurRates, type SnapshotRow } from "@/lib/competitive-data";
import {
  dailyOf,
  diffPct,
  latestOffers,
  preferDirect,
  isDiscoverCars,
  totalOf,
  type Equivalence,
  type OurRate,
} from "@/lib/competitiveness";
import {
  addDays,
  ageDays,
  ageLabel,
  axisPos,
  buildCalendar,
  buildComparisons,
  cellKey,
  collectionAges,
  confidenceOf,
  datesWithoutQuotes,
  distributionOf,
  pickupDates,
  positionOf,
  summarizeCategories,
  symmetricAxis,
  usVsThem,
  STALE_AFTER_DAYS,
  VIEW_BANDS,
  type CalendarCell,
  type CategorySummary,
  type Comparison,
  type Position,
  type QuoteView,
  type ViewBands,
} from "@/lib/competitiveness-view";
import { ESPERADA_ESTATISTICA, buildModel, dayPace, usePace } from "@/lib/occupancy-pace";
import { matrizOcupacaoMercado, sinalMercado, sinalOcc } from "@/lib/decisao";
import { sinalOcupacao } from "@/lib/preco-analise";
import { MatrizOcupacaoPreco } from "@/components/precificacao/MatrizOcupacaoPreco";
import { PeriodFilter } from "@/components/precificacao/PeriodFilter";
import type { Range } from "@/lib/pricing-range";

const ALL = "__all__";
const money = (v: number | null, currency: string) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency });
const money0 = (v: number | null, currency: string) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 });
const pctAbs = (v: number) => `${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
const pctSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`;
const EQ_LABEL: Record<Equivalence, string> = {
  equivalente: "Equivalente",
  parcial: "Parcialmente equivalente",
  nao_equivalente: "Não equivalente",
  nao_avaliada: "Não avaliada",
};
const ALERT_TEXT =
  "Verificar equivalência: diferença grande ou poucos concorrentes; confira se o modelo é equivalente e se o preço inclui as mesmas taxas.";
type SortKey = "menor" | "maior" | "diferenca" | "concorrente" | "categoria";
type Comp = Comparison<SnapshotRow>;
type Quote = QuoteView<SnapshotRow>;
type Sel = { date: string; category: string } | null;
type CompPoint = {
  competitor: string;
  vsUs: number;
  min: number;
  max: number;
  dailyMin: number;
  dailyMax: number;
  n: number;
  dates: number;
  excluded: boolean;
  /** Todas as cotações deste ponto vêm do DiscoverCars. */
  viaDC: boolean;
  only: { q: Quote; c: Comp } | null;
  newest: string;
  oldest: string;
};

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const brShort = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
/** "preços de hoje", "preços de 6 dias atrás", "preços de hoje a 6 dias atrás", "preços de 1 a 6 dias atrás". */
const idadePrecos = (novo: number, velho: number) => {
  const d = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);
  if (velho === 0) return "preços de hoje";
  if (novo === velho) return `preços de ${d(velho)} atrás`;
  return `preços de ${novo === 0 ? "hoje" : novo} a ${d(velho)} atrás`;
};

/** Cores categóricas dos concorrentes (legíveis no tema escuro). 15 cores: cobre as locadoras diretas, as locais e as do
 * DiscoverCars sem repetir (só repete a partir do 16º concorrente). */
const COMP_COLORS = [
  "#60a5fa",
  "#f59e0b",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#22d3ee",
  "#fb923c",
  "#a3e635",
  "#facc15",
  "#e879f9",
  "#818cf8",
  "#94a3b8",
  "#14b8a6",
  "#d4a373",
  "#fb7185",
];
/** Cor fixa por locadora (pelo início do nome), para não mudar entre telas nem ficarem parecidas. */
const FIXED_COLORS: Record<string, string> = {
  alamo: "#60a5fa",
  allycar: "#f59e0b",
  avis: "#a78bfa",
  europcar: "#34d399",
  florida: "#f472b6",
  national: "#22d3ee",
  sixt: "#a3e635",
  up: "#e879f9",
  budget: "#fb7185",
  enterprise: "#94a3b8",
  hertz: "#facc15",
  thrifty: "#14b8a6",
  dollar: "#d4a373",
};
const POS_TEXT: Record<Position, string> = {
  acima: "text-red-400",
  alinhado: "text-muted-foreground",
  abaixo: "text-emerald-400",
};

export function Competitividade({
  range,
  onRangeChange,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const snaps = useCompetitorSnapshots();
  const pace = usePace();
  const rates = useOurRates();
  const [cat, setCat] = useState(ALL);
  const [comp, setComp] = useState(ALL);
  const [sort, setSort] = useState<SortKey>("diferenca");
  const [bands, setBands] = useState<ViewBands>(VIEW_BANDS);
  const [staleAfter, setStaleAfter] = useState(STALE_AFTER_DAYS);
  const [selRaw, setSel] = useState<Sel>(null);
  const coletar = useServerFn(coletarPeriodo);
  const [pedido, setPedido] = useState<string | null>(null);

  // Só a coleta mais recente de cada oferta: coletas repetidas ou antigas não aparecem como atuais.
  const rows = useMemo(() => preferDirect(latestOffers(snaps.data ?? [])), [snaps.data]);
  // Moeda da nossa tarifa (HQ): concorrentes só entram na referência se estiverem nela, sem conversão cambial.
  const moeda = (rates.data ?? [])[0]?.currency.toUpperCase() ?? "USD";
  const ours = useMemo(
    () =>
      new Map(
        (rates.data ?? []).map((r: OurRate) => [rateKey(r.pickupDate, r.category), r.dailyRate]),
      ),
    [rates.data],
  );
  const categorias = useMemo(
    () =>
      [
        ...(pace.data?.payload.categorias ?? [
          ...new Set((rates.data ?? []).map((r) => r.category)),
        ]),
      ].sort(),
    [pace.data, rates.data],
  );
  const shownCats = useMemo(
    () => (cat === ALL ? categorias : categorias.filter((c) => c === cat)),
    [categorias, cat],
  );
  const now = useMemo(() => new Date().toISOString(), [snaps.data]);
  // O filtro é UMA locação: retirada em range.from, devolução em range.to.
  const duration = Math.max(
    1,
    Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000),
  );
  const lastNight = addDays(range.from, duration - 1);
  // Calendário: cada noite da locação, com a diária daquela noite (cotação de 1 diária ou composta noite a noite).
  const comps: Comp[] = useMemo(
    () =>
      buildComparisons({
        rows: rows.filter((r) => r.category && (comp === ALL || r.competitor === comp)),
        categories: shownCats,
        from: range.from,
        to: lastNight,
        duration: 1,
        rateOf: (d, c) => ours.get(rateKey(d, c)),
        now,
        currency: moeda,
      }),
    [rows, comp, shownCats, range.from, lastNight, ours, now, moeda],
  );
  const cells = useMemo(() => buildCalendar(comps, now, bands), [comps, now, bands]);
  // Matriz ocupação × preço (análise): ocupação contra a esperada (mesma régua da Gestão) × nossa diária contra a mediana (±5%).
  const paceModel = useMemo(
    () => (pace.data ? buildModel(pace.data.payload, ESPERADA_ESTATISTICA) : null),
    [pace.data],
  );
  const matriz = useMemo(() => {
    if (!paceModel || !pace.data) return null;
    const hoje = pace.data.payload.hoje;
    return matrizOcupacaoMercado(
      comps.map((c) => {
        const row = c.date >= hoje ? paceModel.byKey.get(`${c.date}|${c.category}`) : undefined;
        const d = row ? dayPace(paceModel, [row], c.date, hoje) : null;
        return {
          occ:
            d && d.gap != null
              ? sinalOcc(sinalOcupacao(d.gap, (d.cobertura ?? 0) * d.capacity))
              : null,
          merc: sinalMercado(c.pct),
        };
      }),
    );
  }, [comps, paceModel, pace.data]);
  // Banner, régua e tabela: a locação inteira (total do período cheio).
  const fullNights = duration;
  const fullComps: Comp[] = useMemo(
    () =>
      buildComparisons({
        rows: rows.filter((r) => r.category && (comp === ALL || r.competitor === comp)),
        categories: shownCats,
        from: range.from,
        to: range.from,
        duration: fullNights,
        rateOf: (d, c) => ours.get(rateKey(d, c)),
        now,
        currency: moeda,
      }),
    [rows, comp, shownCats, range.from, fullNights, ours, now, moeda],
  );

  if (snaps.isLoading || rates.isLoading)
    return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (snaps.error || rates.error)
    return (
      <Card className="p-6 text-sm text-destructive">Não foi possível carregar os dados.</Card>
    );
  if (!rows.length)
    return (
      <Card className="space-y-2 p-6 text-sm">
        <p className="font-medium">Nenhuma coleta de preços de concorrentes ainda.</p>
        <p className="text-muted-foreground">
          Os dados dos concorrentes ainda não estão disponíveis: nenhuma fonte foi importada. Nada é
          estimado nem preenchido. Importe uma planilha de coletas para ver o posicionamento de
          mercado.
          {(rates.data ?? []).length
            ? ""
            : " Nossa tarifa de tabela do HQ também ainda não foi publicada."}
        </p>
      </Card>
    );

  const concorrentes = [...new Set(rows.map((r) => r.competitor))].sort();
  // Concorrentes cujas cotações vêm só do DiscoverCars (marcados com * na legenda).
  const dcNames = new Set(
    concorrentes.filter((c) => rows.filter((r) => r.competitor === c).every((r) => isDiscoverCars(r))),
  );
  const colorOf = (c: string) => {
    const k = Object.keys(FIXED_COLORS).find((n) => c.toLowerCase().startsWith(n));
    if (k) return FIXED_COLORS[k]!;
    const livres = COMP_COLORS.filter((x) => !Object.values(FIXED_COLORS).includes(x));
    const outros = concorrentes.filter((n) => !Object.keys(FIXED_COLORS).some((k) => n.toLowerCase().startsWith(k)));
    return livres[outros.indexOf(c) % livres.length]!;
  };
  const dates = pickupDates(range.from, lastNight);
  // Seleção (clique no calendário) só vale se ainda está no intervalo e nas categorias exibidas.
  const sel: Sel = selRaw && cells.has(cellKey(selRaw.date, selRaw.category)) ? selRaw : null;
  // Escopo de banner, régua e tabela: a célula selecionada ou o intervalo inteiro.
  const scope = sel
    ? comps.filter((c) => c.date === sel.date && c.category === sel.category)
    : fullComps;
  const summaries = summarizeCategories(scope);
  const intervalSummary = new Map(summarizeCategories(fullComps).map((s) => [s.category, s]));
  const single = sel != null || cat !== ALL;
  const dist = distributionOf(summaries, bands);
  const used = scope.flatMap((c) => c.quotes.filter((q) => q.reason == null));
  const ages = collectionAges(
    used.map((q) => q.row.collectedAt),
    now,
  );
  const nComp = new Set(used.map((q) => q.row.competitor)).size;
  const usedPrices = used.map((q) => dailyOf(q.row)!);
  const noQuote = datesWithoutQuotes(dates, cells);
  const calDates = dates.filter((d) => !noQuote.includes(d));

  const retirada = range.from;
  const devolucao = range.to;
  const pedirColeta = async () => {
    setPedido("Pedindo a coleta…");
    try {
      const r = await coletar({ data: { retirada, devolucao } });
      setPedido(
        r.ok
          ? `Coleta de ${br(retirada)} a ${br(devolucao)} pedida: leva alguns minutos; recarregue a página depois.`
          : `Não foi possível pedir a coleta: ${r.error}`,
      );
    } catch (e) {
      setPedido(`Não foi possível pedir a coleta: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const showCatCol = cat === ALL && !sel;
  const table = scope
    .flatMap((c) =>
      c.quotes.map((q) => ({
        c,
        q,
        theirs: dailyOf(q.row),
        theirTotal: totalOf(q.row),
        abs: c.oursTotal != null && totalOf(q.row) != null ? c.oursTotal - totalOf(q.row)! : null,
        pct: diffPct(c.ours ?? 0, dailyOf(q.row)),
      })),
    )
    .sort((a, b) => {
      if (sort === "concorrente") return a.q.row.competitor.localeCompare(b.q.row.competitor);
      if (sort === "categoria") return a.c.category.localeCompare(b.c.category);
      if (sort === "menor") return (a.theirs ?? Infinity) - (b.theirs ?? Infinity);
      if (sort === "maior") return (b.theirs ?? -Infinity) - (a.theirs ?? -Infinity);
      return Math.abs(b.pct ?? -1) - Math.abs(a.pct ?? -1);
    });
  const tableShown = table.slice(0, 200);

  const s1: CategorySummary | undefined = summaries[0];

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-4">
        <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
          <PeriodFilter
            label="Retirada → devolução"
            from={range.from}
            to={range.to}
            onChange={(from, to) => from && to && from <= to && onRangeChange({ from, to })}
          >
            <Filtro
              label="Categoria"
              value={cat}
              onChange={setCat}
              options={categorias}
              all="Todas"
            />
            <Filtro
              label="Concorrente"
              value={comp}
              onChange={setComp}
              options={concorrentes}
              all="Todos"
            />
          </PeriodFilter>
          <Ajustes
            bands={bands}
            setBands={setBands}
            staleAfter={staleAfter}
            setStaleAfter={setStaleAfter}
          />
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <span>
              Retirada <b>{br(range.from)}</b> → devolução{" "}
              <b>{br(addDays(range.from, duration))}</b> ·{" "}
              <b>{plural(duration, "diária", "diárias")}</b>
            </span>
            {sel ? (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs">
                noite de {br(sel.date)} · {sel.category}
                <button type="button" aria-label="Limpar seleção" onClick={() => setSel(null)}>
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
            {ages ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Selo tone={ages.oldest > staleAfter ? "amber" : "muted"}>
                      {idadePrecos(ages.newest, ages.oldest)}
                    </Selo>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Idade das cotações usadas: a mais nova é de {ageLabel(ages.newest)} e a mais
                  antiga de {ageLabel(ages.oldest)}. A coleta diária cota cada data de retirada uma
                  vez por semana, então até 7 dias é normal.
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Selo tone={nComp < 3 ? "amber" : "muted"}>
              {plural(nComp, "concorrente", "concorrentes")}
              {nComp < 3 ? " · confiança baixa" : ""}
            </Selo>
          </span>
          <span className="flex items-center gap-2">
            {pedido ? <span className="text-muted-foreground">{pedido}</span> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={pedirColeta}>
                  Buscar preço novo: {brShort(retirada)} → {brShort(devolucao)}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Pede agora aos concorrentes a cotação desta locação exata (retirada {br(retirada)},
                devolução {br(devolucao)}). Leva alguns minutos.
              </TooltipContent>
            </Tooltip>
          </span>
        </Card>
        {(rates.data ?? []).length === 0 ? (
          <Card className="p-3 text-sm text-muted-foreground">
            Nossa tarifa de tabela do HQ ainda não foi publicada: sem ela não há comparação, só os
            preços dos concorrentes.
          </Card>
        ) : null}

        {/* Banner */}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            {!summaries.length ? (
              <div>
                <div className="text-2xl font-semibold text-muted-foreground">
                  Sem comparação no período
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Falta cotação válida dos concorrentes ou nossa tarifa para esta locação (ausência
                  de coleta não é preço zero).
                </div>
              </div>
            ) : single && s1 ? (
              <div>
                <div className={`text-2xl font-semibold ${POS_TEXT[positionOf(s1.pct, bands)!]}`}>
                  {positionOf(s1.pct, bands) === "alinhado"
                    ? "Alinhados ao mercado"
                    : `Estamos ${pctAbs(s1.pct)} ${s1.pct > 0 ? "acima" : "abaixo"} da mediana`}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {s1.category}: nossa diária {money(s1.ours, moeda)} contra mediana de{" "}
                  {money(s1.median, moeda)} (mediana do menor preço de cada concorrente
                  {sel
                    ? `; noite de ${br(sel.date)}`
                    : `; locação de ${plural(duration, "diária", "diárias")}`}
                  )
                </div>
              </div>
            ) : (
              <div>
                <div className="text-2xl font-semibold">
                  <span className="text-red-400">
                    {plural(dist.acima, "categoria acima", "categorias acima")}
                  </span>
                  ,{" "}
                  <span className="text-muted-foreground">
                    {dist.alinhado} {dist.alinhado === 1 ? "alinhada" : "alinhadas"}
                  </span>
                  , <span className="text-emerald-400">{dist.abaixo} abaixo</span> do mercado
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {dist.topAcima.length ? (
                    <>
                      Mais acima:{" "}
                      {dist.topAcima.map((c) => `${c.category} ${pctSigned(c.pct)}`).join(", ")}
                    </>
                  ) : null}
                  {dist.topAcima.length && dist.topAbaixo.length ? " · " : null}
                  {dist.topAbaixo.length ? (
                    <>
                      Mais abaixo:{" "}
                      {dist.topAbaixo.map((c) => `${c.category} ${pctSigned(c.pct)}`).join(", ")}
                    </>
                  ) : null}
                  {!dist.topAcima.length && !dist.topAbaixo.length
                    ? `Todas dentro de ±${bands.close}% da mediana.`
                    : null}
                </div>
              </div>
            )}
            {summaries.length ? (
              <InfoTip>
                <div className="space-y-1">
                  {dist.mean != null ? (
                    <div>
                      Média geral: nós {pctSigned(dist.mean)} contra a mediana de cada categoria (
                      {plural(summaries.length, "categoria", "categorias")})
                    </div>
                  ) : null}
                  <div>
                    Menor / maior diária na mediana:{" "}
                    {money(usedPrices.length ? Math.min(...usedPrices) : null, moeda)} /{" "}
                    {money(usedPrices.length ? Math.max(...usedPrices) : null, moeda)}
                  </div>
                  <div>
                    Alinhado = dentro de ±{bands.close}%. Sem seleção, cada categoria usa a média
                    das datas de retirada com cotação.
                  </div>
                </div>
              </InfoTip>
            ) : null}
          </div>
        </Card>

        {/* Régua em eixo único de % */}
        {fullComps.length ? (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Régua de preços</h2>
              <span className="text-xs text-muted-foreground">
                período cheio {brShort(range.from)} → {brShort(addDays(range.from, fullNights))} (
                {plural(fullNights, "diária", "diárias")})
              </span>
              <InfoTip>
                O período do filtro como uma locação só: retirada no primeiro dia e devolução no
                último. Cada ponto é o preço total de um concorrente para esse período, contra o
                nosso (0% = nosso total, no centro). À direita, mais caro; à esquerda, mais barato.
                O traço cinza é a mediana do mercado. Pontos apagados não entram na mediana. Sem
                cotação exata do período, o total é composto noite a noite. Passe o mouse para os
                detalhes.
              </InfoTip>
              <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
                {concorrentes
                  .filter(
                    (c) =>
                      used.some((q) => q.row.competitor === c) ||
                      scope.some((s) => s.quotes.some((q) => q.row.competitor === c)),
                  )
                  .map((c) => (
                    <span key={c} className="flex items-center gap-1">
                      <span className="size-2 rounded-full" style={{ background: colorOf(c) }} />
                      {c}
                      {dcNames.has(c) ? <span className="text-amber-400">*</span> : null}
                    </span>
                  ))}
              </div>
              {concorrentes.some((c) => dcNames.has(c)) ? (
                <p className="w-full text-xs text-amber-400/90">
                  * Via DiscoverCars (a locadora não tem coleta pelo site próprio): preço com taxas
                  embutidas, sem cadeirinha e sem motorista adicional. Não é a mesma base das
                  outras.
                </p>
              ) : null}
            </div>
            <Regua
              summaries={summarizeCategories(fullComps)}
              scope={fullComps}
              moeda={moeda}
              colorOf={colorOf}
              now={now}
              duration={fullNights}
            />
          </Card>
        ) : null}

        {/* Calendário */}
        {shownCats.length ? (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Calendário de posição</h2>
              <InfoTip>
                Cada coluna é uma noite da locação, com a diária daquela noite. Verde abaixo, cinza
                alinhado (±{bands.close}%), vermelho acima; cor forte a partir de ±
                {bands.significant}%. Pontos: número de concorrentes (1, 2, 3 ou mais). Tracejado:
                sem cotação válida ou sem nossa tarifa. Clique para selecionar; clique de novo para
                voltar à locação inteira.
              </InfoTip>
              {noQuote.length ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground underline decoration-dotted">
                      {plural(noQuote.length, "noite sem cotação", "noites sem cotação")}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    {noQuote.map(brShort).join(", ")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            {calDates.length ? (
              <Calendario
                dates={calDates}
                categorias={shownCats}
                cells={cells}
                alertOf={(c) => intervalSummary.get(c)?.alert ?? false}
                selected={sel}
                onSelect={(c) =>
                  setSel(
                    sel && sel.date === c.date && sel.category === c.category
                      ? null
                      : { date: c.date, category: c.category },
                  )
                }
                moeda={moeda}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma noite da locação tem cotação válida.
              </p>
            )}
          </Card>
        ) : null}

        {shownCats.length && matriz ? <MatrizOcupacaoPreco mx={matriz} /> : null}

        {/* Tabela */}
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Cotações</h2>
              <InfoTip>
                A cotação exata da locação (retirada → devolução do filtro) quando existe; sem ela,
                composta noite a noite com a diária média das cotações já coletadas que cobrem cada
                noite (preferindo a que começa mais perto da noite). Nossa reserva é a soma da nossa
                diária de cada noite (sem tarifa em alguma noite, fica em branco). Só coletas
                equivalentes ou parciais, na mesma moeda da nossa tarifa (sem conversão cambial),
                com até 7 dias entram na mediana, uma por concorrente (a mais barata dele); com
                menos de 3 concorrentes, a confiança é baixa. Mostrando até 200 linhas
                {table.length > 200 ? ` de ${table.length}` : ""}.
              </InfoTip>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["diferenca", "Maior diferença"],
                  ["menor", "Menor preço"],
                  ["maior", "Maior preço"],
                  ["concorrente", "Concorrente"],
                  ["categoria", "Categoria"],
                ] as [SortKey, string][]
              ).map(([k, l]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={sort === k ? "default" : "outline"}
                  onClick={() => setSort(k)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">Concorrente</th>
                {showCatCol ? <th className="px-2 py-1 font-medium">Categoria</th> : null}
                <th className="px-2 py-1 font-medium">Modelo</th>
                <th className="w-[14%] px-2 py-1 font-medium">Diária deles</th>
                <th className="w-[20%] px-2 py-1 font-medium">Nós vs eles</th>
                <th className="w-[12%] px-2 py-1 font-medium">Coleta</th>
              </tr>
            </thead>
            <tbody>
              {tableShown.map(({ c, q, theirs, theirTotal, abs, pct }) => {
                const r = q.row;
                const vs = usVsThem(pct, bands);
                const cur = r.currency.toUpperCase();
                return (
                  <Tooltip key={`${c.date}|${r.id}|${r.sourceCategory ?? ""}`}>
                    <TooltipTrigger asChild>
                      <tr className={`border-t border-border ${q.reason ? "opacity-45" : ""}`}>
                        <td className="truncate px-2 py-1">
                          <span
                            className="mr-1.5 inline-block size-2 rounded-full"
                            style={{ background: colorOf(r.competitor) }}
                          />
                          {r.competitor}
                        </td>
                        {showCatCol ? <td className="truncate px-2 py-1">{c.category}</td> : null}
                        <td className="truncate px-2 py-1">{r.sourceCategory ?? "—"}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {r.available === false ? "Indisponível" : money(theirs, cur)}
                        </td>
                        <td className={`px-2 py-1 ${vs.position ? POS_TEXT[vs.position] : ""}`}>
                          {vs.text}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {ageLabel(ageDays(r.collectedAt, now))}
                        </td>
                      </tr>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm">
                      <QuoteDetails
                        q={q}
                        c={c}
                        moeda={moeda}
                        now={now}
                        extra={
                          <>
                            <div>Reserva final deles: {money(theirTotal, cur)}</div>
                            <div>Diferença na reserva: {abs == null ? "—" : money(abs, moeda)}</div>
                          </>
                        }
                      />
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function QuoteDetails({
  q,
  c,
  moeda,
  now,
  extra,
}: {
  q: Quote;
  c: Comp;
  moeda: string;
  now: string;
  extra?: ReactNode;
}) {
  const r = q.row;
  const cur = r.currency.toUpperCase();
  return (
    <div className="space-y-0.5">
      <div className="font-medium">
        {r.competitor} · {r.sourceCategory ?? "—"}
      </div>
      <div>
        {c.category} · retirada {br(c.date)} → {br(c.returnDate)}
      </div>
      <div>
        Diária {money(dailyOf(r), cur)} · reserva final {money(totalOf(r), cur)}
        {c.ours != null ? ` · nossa diária ${money(c.ours, moeda)}` : ""}
      </div>
      {extra}
      <div>
        Base:{" "}
        {r.composta
          ? `composta (${r.base?.map((b) => b.split(" → ").map(br).join(" → ")).join("; ")})`
          : "cotação exata"}
      </div>
      <div>
        {EQ_LABEL[r.equivalence]} · {r.source} · coleta {br(r.collectedAt)} (
        {ageLabel(ageDays(r.collectedAt, now))})
      </div>
      {q.reason ? <div className="font-medium">Fora da mediana: {q.reason}</div> : null}
    </div>
  );
}

function Selo({ tone, children }: { tone: "amber" | "muted"; children: ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${
        tone === "amber"
          ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Mais informações" className="text-muted-foreground">
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{children}</TooltipContent>
    </Tooltip>
  );
}

function AlertTip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label="Verificar equivalência" className="text-amber-400">
          <AlertTriangle className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{ALERT_TEXT}</TooltipContent>
    </Tooltip>
  );
}

function Regua({
  summaries,
  scope,
  moeda,
  colorOf,
  now,
  duration,
}: {
  summaries: CategorySummary[];
  scope: Comp[];
  moeda: string;
  colorOf: (c: string) => string;
  now: string;
  duration: number;
}) {
  // Um ponto por concorrente em cada categoria: mediana das cotações dele no escopo, com traço do menor ao maior.
  const points = new Map<string, CompPoint[]>();
  const byKey = new Map<string, { q: Quote; c: Comp }[]>();
  for (const c of scope)
    for (const q of c.quotes)
      if (q.vsUs != null) {
        const k = `${c.category}|${q.row.competitor}`;
        byKey.set(k, [...(byKey.get(k) ?? []), { q, c }]);
      }
  for (const [k, all] of byKey) {
    const [category, competitor] = k.split("|") as [string, string];
    const valid = all.filter((x) => x.q.reason == null);
    const base = valid.length ? valid : all;
    const vs = base.map((x) => x.q.vsUs!).sort((a, b) => a - b);
    const mid = vs.length >> 1;
    const med = vs.length % 2 ? vs[mid]! : (vs[mid - 1]! + vs[mid]!) / 2;
    const daily = base.map((x) => dailyOf(x.q.row)!).sort((a, b) => a - b);
    const newest = base
      .map((x) => x.q.row.collectedAt)
      .sort()
      .at(-1)!;
    const oldest = base.map((x) => x.q.row.collectedAt).sort()[0]!;
    points.set(category, [
      ...(points.get(category) ?? []),
      {
        competitor,
        vsUs: med,
        min: vs[0]!,
        max: vs.at(-1)!,
        dailyMin: daily[0]!,
        dailyMax: daily.at(-1)!,
        n: base.length,
        dates: new Set(base.map((x) => x.c.date)).size,
        excluded: !valid.length,
        viaDC: base.every((x) => isDiscoverCars(x.q.row)),
        only: base.length === 1 ? base[0]! : null,
        newest,
        oldest,
      },
    ]);
  }
  const extent = symmetricAxis([
    ...[...points.values()].flat().flatMap((p) => [p.min, p.max]),
    ...summaries.map((s) => s.medianVsUs),
  ]);
  const ticks = [-extent, -extent / 2, 0, extent / 2, extent];
  const left = (v: number) => `${axisPos(v, extent) * 100}%`;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(9rem,13rem)_1fr] gap-3">
        <div />
        <div className="relative h-4 text-[10px] text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: left(t) }}
            >
              {t === 0 ? "nós" : pctSigned(t)}
            </span>
          ))}
        </div>
      </div>
      {summaries.map((s) => (
        <div
          key={s.category}
          className="grid grid-cols-[minmax(9rem,13rem)_1fr] items-center gap-3"
        >
          <div className="min-w-0 text-xs leading-tight">
            <div className="flex items-center gap-1 font-medium">
              <span className="truncate">{s.category}</span>
              {s.alert ? <AlertTip /> : null}
            </div>
            <div className="text-muted-foreground">
              nós {money0(s.ours * duration, moeda)} · mediana {money0(s.median * duration, moeda)}{" "}
              <span className={POS_TEXT[positionOf(s.pct) ?? "alinhado"]}>
                ({pctSigned(s.pct)})
              </span>
            </div>
          </div>
          <div className="relative h-6">
            <div className="absolute left-0 right-0 top-1/2 border-t border-border" />
            <div className="absolute top-0 h-6 w-px bg-foreground/70" style={{ left: left(0) }} />
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="absolute top-0.5 h-5 w-[3px] -translate-x-1/2 rounded bg-muted-foreground"
                  style={{ left: left(s.medianVsUs) }}
                />
              </TooltipTrigger>
              <TooltipContent>
                Mediana do total {money(s.median * duration, moeda)} ({pctSigned(s.medianVsUs)}{" "}
                contra o nosso total de {money(s.ours * duration, moeda)})
              </TooltipContent>
            </Tooltip>
            {(points.get(s.category) ?? []).map((p) => (
              <Tooltip key={p.competitor}>
                <TooltipTrigger asChild>
                  <span className={p.excluded ? "opacity-25" : ""}>
                    {p.max > p.min ? (
                      <span
                        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded"
                        style={{
                          left: left(p.min),
                          width: `calc(${left(p.max)} - ${left(p.min)})`,
                          background: colorOf(p.competitor),
                          opacity: 0.45,
                        }}
                      />
                    ) : null}
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                      style={{ left: left(p.vsUs), background: colorOf(p.competitor) }}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  {p.only ? (
                    <>
                      <div className="mb-0.5">
                        {pctSigned(p.vsUs)} contra o nosso total (
                        {plural(duration, "diária", "diárias")})
                      </div>
                      <QuoteDetails q={p.only.q} c={p.only.c} moeda={moeda} now={now} />
                    </>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="font-medium">{p.competitor}</div>
                      {p.viaDC ? (
                        <div className="text-amber-400">
                          Via DiscoverCars: com taxas, sem cadeirinha e sem motorista adicional
                        </div>
                      ) : null}
                      <div>
                        {pctSigned(p.vsUs)} contra nossa diária (mediana de{" "}
                        {plural(p.dates, "data de retirada", "datas de retirada")})
                      </div>
                      <div>
                        Diária de {money(p.dailyMin, moeda)} a {money(p.dailyMax, moeda)} (
                        {pctSigned(p.min)} a {pctSigned(p.max)})
                      </div>
                      <div className="text-muted-foreground">
                        Cotações de {ageLabel(ageDays(p.newest, now))} a{" "}
                        {ageLabel(ageDays(p.oldest, now))}
                        {p.excluded ? " · fora da mediana" : ""}
                      </div>
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function cellClass(c: CalendarCell | undefined) {
  if (!c || c.empty) return "border border-dashed border-border text-muted-foreground/50";
  if (c.position === "acima") return c.strong ? "bg-red-600/80 text-white" : "bg-red-500/30";
  if (c.position === "abaixo")
    return c.strong ? "bg-emerald-600/80 text-white" : "bg-emerald-500/30";
  return "bg-muted text-muted-foreground";
}

function Calendario({
  dates,
  categorias,
  cells,
  alertOf,
  selected,
  onSelect,
  moeda,
}: {
  dates: string[];
  categorias: string[];
  cells: Map<string, CalendarCell>;
  alertOf: (category: string) => boolean;
  selected: Sel;
  onSelect: (c: CalendarCell) => void;
  moeda: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card" />
            {dates.map((d) => (
              <th key={d} className="px-0.5 font-normal text-muted-foreground">
                {brShort(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categorias.map((c) => (
            <tr key={c}>
              <th className="sticky left-0 whitespace-nowrap bg-card pr-2 text-left font-normal">
                <span className="flex items-center gap-1">
                  {c}
                  {alertOf(c) ? <AlertTip /> : null}
                </span>
              </th>
              {dates.map((d) => {
                const cell = cells.get(cellKey(d, c));
                const sel = selected?.date === d && selected.category === c;
                const dots = cell && !cell.empty ? Math.min(3, cell.n) : 0;
                return (
                  <td key={d} className="p-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => cell && !cell.empty && onSelect(cell)}
                          className={`flex h-8 w-11 flex-col items-center justify-center rounded tabular-nums leading-none ${cellClass(cell)} ${
                            sel ? "outline outline-2 outline-foreground" : ""
                          }`}
                        >
                          <span>
                            {cell && !cell.empty && cell.pct != null
                              ? `${cell.pct > 0 ? "+" : ""}${cell.pct.toFixed(0)}%`
                              : "·"}
                          </span>
                          {dots ? (
                            <span className="mt-0.5 flex gap-0.5">
                              {Array.from({ length: dots }, (_, i) => (
                                <span
                                  key={i}
                                  className="size-1 rounded-full bg-current opacity-70"
                                />
                              ))}
                            </span>
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-0.5">
                          <div className="font-medium">
                            {c} · retirada {br(d)}
                          </div>
                          {cell && cell.n ? (
                            <>
                              <div>
                                Nossa diária {money(cell.ours, moeda)} · mediana{" "}
                                {money(cell.median, moeda)}
                              </div>
                              <div>
                                {plural(cell.n, "concorrente", "concorrentes")} · confiança{" "}
                                {confidenceOf(cell.n)}
                                {cell.ageDays != null ? ` · coleta ${ageLabel(cell.ageDays)}` : ""}
                              </div>
                              {cell.ours == null ? (
                                <div>Sem nossa tarifa em alguma noite.</div>
                              ) : null}
                            </>
                          ) : (
                            <div>Sem cotação válida.</div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ajustes(p: {
  bands: ViewBands;
  setBands: (b: ViewBands) => void;
  staleAfter: number;
  setStaleAfter: (n: number) => void;
}) {
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const field = (label: string, value: number, set: (v: string) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        className="h-8 w-20"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto">
          <SlidersHorizontal className="mr-1 size-4" />
          Ajustes
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        {field("Alinhado até ±%", p.bands.close, (v) =>
          p.setBands({ ...p.bands, close: num(v, 0, 50, p.bands.close) }),
        )}
        {field("Significativo a partir de ±%", p.bands.significant, (v) =>
          p.setBands({ ...p.bands, significant: num(v, 0, 100, p.bands.significant) }),
        )}
        {field("Coleta antiga após (dias)", p.staleAfter, (v) =>
          p.setStaleAfter(num(v, 0, 30, p.staleAfter)),
        )}
      </PopoverContent>
    </Popover>
  );
}

function Filtro({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  all: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{all}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
