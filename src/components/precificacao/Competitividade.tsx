import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  marketOf,
  priceLevel,
  type Equivalence,
  type OurRate,
} from "@/lib/competitiveness";
import { formatLastUpdate } from "@/lib/pricing-forecast";
import { usePace } from "@/lib/occupancy-pace";
import { PeriodFilter } from "@/components/precificacao/PeriodFilter";
import type { Range } from "@/lib/pricing-range";

const ALL = "__all__";
const money = (v: number | null, currency: string) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency });
const pctTxt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const EQ_LABEL: Record<Equivalence, string> = {
  equivalente: "Equivalente",
  parcial: "Parcialmente equivalente",
  nao_equivalente: "Não equivalente",
  nao_avaliada: "Não avaliada",
};
type SortKey = "menor" | "maior" | "diferenca" | "concorrente" | "categoria";

/** Nossa diária para a data de retirada e categoria da coleta; sem tarifa publicada = null (nunca zero). */
function ourRateFor(ours: Map<string, number>, s: SnapshotRow) {
  return ours.get(rateKey(s.pickupAt.slice(0, 10), s.category)) ?? null;
}

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

  // Só a coleta mais recente de cada oferta: coletas repetidas ou antigas não aparecem como atuais.
  const rows = useMemo(() => latestOffers(snaps.data ?? []), [snaps.data]);
  // Moeda da nossa tarifa (HQ): concorrentes só entram na referência se estiverem nela, sem conversão cambial.
  const moeda = (rates.data ?? [])[0]?.currency.toUpperCase() ?? "USD";
  const ours = useMemo(
    () =>
      new Map(
        (rates.data ?? []).map((r: OurRate) => [rateKey(r.pickupDate, r.category), r.dailyRate]),
      ),
    [rates.data],
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

  // Categorias do filtro: as nossas (lista publicada na Gestão de Ocupação; sem ela, as da nossa tarifa).
  const categorias = [
    ...(pace.data?.payload.categorias ?? [...new Set((rates.data ?? []).map((r) => r.category))]),
  ].sort();
  const concorrentes = [...new Set(rows.map((r) => r.competitor))].sort();
  const mapped = rows.filter((r) => r.category);
  const filtered = mapped.filter((r) => {
    const d = r.pickupAt.slice(0, 10);
    return (
      d >= range.from &&
      d <= range.to &&
      (cat === ALL || r.category === cat) &&
      (comp === ALL || r.competitor === comp)
    );
  });
  const now = new Date().toISOString();

  // Posicionamento: cada data de retirada e categoria é um mercado; contamos onde estamos acima/alinhado/abaixo.
  const groups = new Map<string, SnapshotRow[]>();
  for (const r of filtered) {
    const k = rateKey(r.pickupAt.slice(0, 10), r.category);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let acima = 0;
  let alinhado = 0;
  let abaixo = 0;
  const diffs: number[] = [];
  const ourDaily: number[] = [];
  const medians: number[] = [];
  const allPrices: number[] = [];
  const nameSet = new Set<string>();
  for (const [k, g] of groups) {
    const m = marketOf(g, now, moeda);
    g.forEach((r) => {
      const d = dailyOf(r);
      if (d != null && r.currency.toUpperCase() === moeda) {
        allPrices.push(d);
        nameSet.add(r.competitor);
      }
    });
    const mine = ours.get(k);
    if (m.median == null || mine == null) continue;
    ourDaily.push(mine);
    medians.push(m.median);
    const p = diffPct(mine, m.median);
    const lvl = priceLevel(p, m.n);
    if (lvl === "sem-dados" || p == null) continue;
    diffs.push(p);
    if (lvl === "alinhado") alinhado++;
    else if (p > 0) acima++;
    else abaixo++;
  }
  const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
  const classified = acima + alinhado + abaixo;
  const share = (n: number) => (classified ? `${Math.round((n / classified) * 100)}%` : "—");
  const medianAll = medians.length
    ? [...medians].sort((a, b) => a - b)[medians.length >> 1]!
    : null;

  const table = filtered
    .map((r) => {
      const mine = ourRateFor(ours, r);
      const theirs = dailyOf(r);
      return {
        r,
        mine,
        theirs,
        abs: mine != null && theirs != null ? mine - theirs : null,
        pct: diffPct(mine ?? 0, theirs),
      };
    })
    .sort((a, b) => {
      if (sort === "concorrente") return a.r.competitor.localeCompare(b.r.competitor);
      if (sort === "categoria") return (a.r.category ?? "").localeCompare(b.r.category ?? "");
      const x = sort === "diferenca" ? Math.abs(b.pct ?? -1) - Math.abs(a.pct ?? -1) : 0;
      if (sort === "menor") return (a.theirs ?? Infinity) - (b.theirs ?? Infinity);
      if (sort === "maior") return (b.theirs ?? -Infinity) - (a.theirs ?? -Infinity);
      return x;
    })
    .slice(0, 200);

  const kpis: [string, string, string?][] = [
    [
      "Nossa diária média (tabela HQ)",
      money(avg(ourDaily), moeda),
      `${ourDaily.length} datas com tarifa e mercado`,
    ],
    ["Mediana dos concorrentes", money(medianAll, moeda), "referência principal"],
    ["Média dos concorrentes", money(avg(medians), moeda)],
    ["Menor preço", money(allPrices.length ? Math.min(...allPrices) : null, moeda)],
    ["Maior preço", money(allPrices.length ? Math.max(...allPrices) : null, moeda)],
    ["Concorrentes monitorados", String(nameSet.size)],
    ["Nossa tarifa vs. mediana", pctTxt(avg(diffs)), "média das datas classificadas"],
    [
      "Acima / alinhado / abaixo",
      `${share(acima)} / ${share(alinhado)} / ${share(abaixo)}`,
      `${classified} datas classificadas`,
    ],
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <PeriodFilter
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
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-3 text-sm text-muted-foreground">
          Nenhuma coleta de concorrente para este período, categoria e concorrente. Ausência de
          coleta não significa preço zero.
        </Card>
      ) : null}
      {(rates.data ?? []).length === 0 ? (
        <Card className="p-3 text-sm text-muted-foreground">
          Nossa tarifa de tabela do HQ ainda não foi publicada: sem ela não há comparação, só os
          preços dos concorrentes.
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
          </Card>
        ))}
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Comparativo por concorrente</h2>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {[
                  "Concorrente",
                  "Modelo",
                  "Categoria",
                  "Tarifa deles",
                  "Nossa tarifa",
                  "Dif. R$",
                  "Dif. %",
                  "Retirada",
                  "Devolução",
                  "Coleta",
                  "Fonte",
                  "Equivalência",
                ].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map(({ r, mine, theirs, abs, pct }) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-1">{r.competitor}</td>
                  <td className="px-2 py-1">{r.sourceCategory ?? "—"}</td>
                  <td className="px-2 py-1">{r.category ?? "—"}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {r.available === false
                      ? "Indisponível"
                      : money(theirs, r.currency.toUpperCase())}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{money(mine, moeda)}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {abs == null ? "—" : money(abs, moeda)}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{pctTxt(pct)}</td>
                  <td className="px-2 py-1">
                    {r.pickupAt.slice(0, 10).split("-").reverse().join("/")}
                  </td>
                  <td className="px-2 py-1">
                    {r.returnAt.slice(0, 10).split("-").reverse().join("/")}
                  </td>
                  <td className="px-2 py-1">{formatLastUpdate(r.collectedAt)}</td>
                  <td className="px-2 py-1">{r.source}</td>
                  <td className="px-2 py-1">{EQ_LABEL[r.equivalence]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Só coletas equivalentes ou parciais, na mesma moeda da nossa tarifa (sem conversão
          cambial), com até 7 dias entram na referência de mercado (a mediana usa quantos
          concorrentes houver; com menos de 3, a confiança é menor). Mostrando até 200 linhas.
        </p>
      </Card>
    </div>
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
