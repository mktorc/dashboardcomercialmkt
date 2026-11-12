import { useMemo, type ReactNode } from "react";
import { BadgeDollarSign, CheckCircle2, Clock, Flame, Info, Search, Tag, TrendingDown, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PickupChart } from "@/components/precificacao/PickupChart";
import { ReferenciasAnteriores } from "@/components/precificacao/ReferenciasAnteriores";
import { DIAG_STYLE } from "@/components/precificacao/DiagnosticoPreco";
import {
  BENCH_LEVEL_LABEL,
  EVENT_LABEL,
  gapLevel,
  pickupCurve,
  revenueOf,
  windowAnalysis,
  type DayPace,
  type GapBands,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { carros, curvaDetalhe, faixaJanela, gapCarros, projecaoFechamento, ritmoRecente, FAIXA_TXT, type PrecoVenda } from "@/lib/occupancy-detail";
import { DIAGNOSTICO_LABEL, FAIXAS_ANTECEDENCIA, quadranteDia, quebraAntecedencia, type Diagnostico, type Tolerancias } from "@/lib/preco-analise";
import { LEVEL, gapTxt, pct, usd } from "@/lib/pricing-format";

/* Apresentação do detalhe de uma data (Gestão de Ocupação e Prioridades). Nenhum cálculo novo: tudo vem de occupancy-pace,
   occupancy-detail e preco-analise. */

const ICONE: Record<Diagnostico, LucideIcon> = {
  "preco-alto": BadgeDollarSign,
  "avaliar-preco": Search,
  aguardar: Clock,
  "demanda-fraca": TrendingDown,
  "no-ritmo": CheckCircle2,
  "vendendo-barato": Tag,
  forte: Flame,
};
const BORDA: Record<Diagnostico, string> = {
  "preco-alto": "border-red-500/40",
  "avaliar-preco": "border-amber-500/40",
  aguardar: "border-sky-500/40",
  "demanda-fraca": "border-rose-500/40",
  "no-ritmo": "border-border",
  "vendendo-barato": "border-violet-500/40",
  forte: "border-green-500/40",
};
/** Faixas de antecedência, do mais cedo (escuro) ao mais perto da data (claro): uma cor só em degradê. */
const OUTROS_ANOS = ["#a78bfa", "#38bdf8", "#f472b6"];
const SEG_CORES = ["#1e3a8a", "#1d4ed8", "#3b82f6", "#60a5fa", "#93c5fd", "#dbeafe"];

const num1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const pos = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
const sinal = (n: number, casas = 0) => `${n > 0 ? "+" : ""}${n.toFixed(casas).replace(".", ",")}`;

/** Ícone de informação com a nota técnica no tooltip. */
export function InfoTip({ children, rotulo = "Mais informações" }: { children: ReactNode; rotulo?: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label={rotulo} className="text-muted-foreground hover:text-foreground">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1 text-left">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Etiqueta do cabeçalho: frota e quanto vale um carro em p.p. (a esperada oscila mais em frota pequena). */
export function EtiquetaFrota({ capacity }: { capacity: number }) {
  if (!capacity) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
      Frota {capacity} · 1 carro = {(100 / capacity).toFixed(1).replace(".", ",")} p.p.
      <InfoTip>
        <p>Cada carro vale {(100 / capacity).toFixed(1).replace(".", ",")} p.p. de ocupação.</p>
        <p>Em frota pequena a esperada e o gap oscilam muito.</p>
      </InfoTip>
    </span>
  );
}

function Indicador({ titulo, info, children }: { titulo: string; info?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{titulo}</span>
        {info}
      </div>
      {children}
    </Card>
  );
}

export type DetalheDataProps = {
  model: PaceModel;
  /** Linhas (data × categoria) da data analisada. */
  rows: PaceRow[];
  date: string;
  base: string;
  d: DayPace;
  bands: GapBands;
  tol: Tolerancias;
  /** Tarifa atual do site para a data e categoria(s); null sem tarifa. */
  tarifa: number | null;
  precoVenda: PrecoVenda | null;
  todas: boolean;
  /** Linhas (data × categoria) de uma data histórica: as categorias da análise atual. */
  rowsFor: (date: string) => PaceRow[];
};

export function DetalheData({ model, rows, date, base, d, bands, tol, tarifa, precoVenda, todas, rowsFor }: DetalheDataProps) {
  const de = model.payload.de;
  const wa = useMemo(() => windowAnalysis(model, rows, date, base, d.lead), [model, rows, date, base, d.lead]);
  const { items, janela } = wa;
  const q = useMemo(() => quadranteDia(d, rows, janela, de, tol, tarifa), [d, rows, janela, de, tol, tarifa]);
  const faixa = faixaJanela(janela.anos, d.atual);
  const rev = revenueOf(rows, d.lead);
  const usada = items.find((i) => i.chosen);
  const hojeLabel = `D-${d.lead} (hoje)`;
  const curva = useMemo(
    () =>
      curvaDetalhe(
        pickupCurve(model, rows, date, base).map((p) => ({
          label: p.effective ? hojeLabel : `D-${p.L}`,
          L: p.L,
          atual: p.atual,
          esperada: p.esperada,
        })),
        items,
        d.capacity,
      ),
    [model, rows, date, base, items, d.capacity, hojeLabel],
  );
  const lv = d.gap != null ? LEVEL[gapLevel(d.gap, bands)] : null;
  const capCov = (d.cobertura ?? 0) * d.capacity;
  const leadLabel = d.closed ? "D-0" : `D-${d.lead}`;

  const colunasVenda = [
    { titulo: "Atual", escolhido: false, fleet: d.capacity, q: rows.length ? quebraAntecedencia(rows, d.closed ? 0 : d.lead) : null },
    ...items
      .filter((i) => i.hist.length)
      .map((i) => ({ titulo: i.date.slice(0, 4), escolhido: i.chosen, fleet: i.fleet, q: quebraAntecedencia(i.hist) })),
  ];

  // Projeção de fechamento por referência (mesmo cálculo de sempre: ocupação atual + ganho da referência, em carros, limitada à frota).
  const projecoes =
    d.closed || d.booked == null
      ? []
      : items.flatMap((i) => {
          const proj = projecaoFechamento(i, d.booked!, d.capacity, rev.diaria);
          return proj ? [{ ano: i.date.slice(0, 4), escolhido: i.chosen, proj }] : [];
        });

  // Ritmo: hoje, ano escolhido (média da janela) e os outros anos (do próprio dia), em carros da frota atual.
  const outros = d.closed
    ? []
    : items
        .filter((i) => !i.chosen && i.hist.length && i.fleet > 0)
        .map((i) => {
          const r = ritmoRecente(i.hist, d.lead, 14, { date: i.date, de });
          return { rotulo: i.date.slice(0, 4), v: r == null ? null : (r / i.fleet) * d.capacity };
        });
  const barrasRitmo = q && !d.closed
    ? [
        { rotulo: "Hoje", v: q.ritmoAtual, destaque: true },
        ...(q.ano ? [{ rotulo: q.ano, v: q.ritmoRef, destaque: false }] : []),
        ...outros.map((o) => ({ ...o, destaque: false })),
      ]
    : [];
  const maxRitmo = Math.max(1, ...barrasRitmo.map((b) => Math.round(b.v ?? 0)));

  // Régua de preço: tarifa atual (o preço do diagnóstico, destacado), já vendido e referência (o que faltava vender): os dois últimos só informação.
  const semTarifa = q?.fontePreco == null;
  const pontos = (
    [
      { k: "vendido", nome: "já vendido", v: rev.diaria, cor: "bg-muted-foreground", usado: false },
      { k: "ref", nome: "referência", v: q?.diariaRef ?? null, cor: "bg-primary", usado: false },
      { k: "tarifa", nome: "tarifa atual", v: q?.diariaAtual ?? null, cor: "bg-amber-500", usado: true },
    ] as { k: string; nome: string; v: number | null; cor: string; usado: boolean }[]
  ).filter((p): p is typeof p & { v: number } => p.v != null);
  const lo = Math.min(...pontos.map((p) => p.v)) * 0.9;
  const hi = Math.max(...pontos.map((p) => p.v)) * 1.1;
  const posPreco = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  // Rótulo em cima de cada ponto; se ficar colado no anterior, desce para baixo da régua.
  const rotulos = (() => {
    const ord = [...pontos].sort((a, b) => a.v - b.v);
    let ultimoCima = -Infinity;
    return ord.map((p) => {
      const x = posPreco(p.v);
      const embaixo = x - ultimoCima < 0.17;
      if (!embaixo) ultimoCima = x;
      return { ...p, x, embaixo };
    });
  })();
  const corDif = q?.preco === "mais-caro" ? "text-amber-600 dark:text-amber-300" : q?.preco === "mais-barato" ? "text-sky-600 dark:text-sky-300" : "text-muted-foreground";

  return (
    <div className="@container space-y-4">
      {/* 2. Banner do diagnóstico */}
      {q?.diagnostico ? (
        (() => {
          const Icone = ICONE[q.diagnostico];
          return (
            <div className={`flex items-center gap-3 rounded-lg border p-3 ${DIAG_STYLE[q.diagnostico]} ${BORDA[q.diagnostico]}`}>
              <Icone className="size-6 shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-tight">{DIAGNOSTICO_LABEL[q.diagnostico]}</div>
                <div className="text-sm opacity-90">{q.frase}.</div>
              </div>
            </div>
          );
        })()
      ) : (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Sem diagnóstico.</span>{" "}
          {q ? `${q.frase}. Sem preço para comparar.` : "A data não tem esperada para comparar."}
        </div>
      )}

      {/* 3. Indicadores */}
      <div className="grid gap-3 @2xl:grid-cols-3">
        <Indicador
          titulo="Ocupação"
          info={
            <InfoTip>
              <p>Esperada = média, na janela de 7 dias, das ocupações do ano escolhido.</p>
              {d.semBenchmark && d.semBenchmark.length ? (
                <p>
                  {d.esperada != null
                    ? `Esperada e gap não incluem ${d.semBenchmark.join(", ")} (sem histórico comparável); cobertura de ${((d.cobertura ?? 0) * 100).toFixed(0)}% da frota.`
                    : `Sem esperada: ${d.semBenchmark.join(", ")} não tem histórico comparável e as demais categorias cobrem só ${((d.cobertura ?? 0) * 100).toFixed(0)}% da frota.`}
                </p>
              ) : null}
            </InfoTip>
          }
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {d.atual != null ? carros(d.atual, d.capacity) : "—"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">carros</span>
            </span>
            {d.esperada != null ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                meta {carros(d.esperada, d.capacity)} · frota {d.capacity}
              </span>
            ) : null}
          </div>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative h-3 rounded-full bg-muted" tabIndex={0} aria-label="Ocupação atual, esperada e faixa das referências">
                  {d.atual != null ? <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: pos(d.atual) }} /> : null}
                  {faixa ? (
                    <div
                      className="absolute inset-y-0 rounded-full bg-foreground/20"
                      style={{ left: pos(faixa.min.occ), width: `${(Math.min(1, faixa.max.occ) - Math.min(1, faixa.min.occ)) * 100}%` }}
                    />
                  ) : null}
                  {d.esperada != null ? <div className="absolute -inset-y-1 w-0.5 rounded bg-foreground" style={{ left: pos(d.esperada) }} /> : null}
                </div>
              </TooltipTrigger>
              <TooltipContent className="space-y-0.5">
                <div>
                  Atual {pct(d.atual)} · Esperada {pct(d.esperada)}
                  {janela.escolhido ? ` (média da semana de ${janela.escolhido.label})` : ""}
                </div>
                <div>Gap {gapTxt(d.gap)}</div>
                {faixa ? (
                  <>
                    <div>
                      Faixa: {faixa.min.label} {pct(faixa.min.occ)} a {faixa.max.label} {pct(faixa.max.occ)} (médias da semana)
                    </div>
                    {faixa.status ? <div>Atual {FAIXA_TXT[faixa.status]}</div> : null}
                  </>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
            <span>
              <span className="mr-1 inline-block h-1.5 w-3 rounded bg-primary align-middle" />
              atual
            </span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-0.5 bg-foreground align-middle" />
              esperada
            </span>
            {faixa ? (
              <span>
                <span className="mr-1 inline-block h-1.5 w-3 rounded bg-foreground/20 align-middle" />
                faixa das médias da semana
              </span>
            ) : null}
          </div>
          <div className={`text-xs tabular-nums ${lv?.text ?? "text-muted-foreground"}`}>
            {d.gap != null ? `gap ${gapTxt(d.gap)} (${sinal(gapCarros(d.gap, capCov))} carros)` : "sem esperada para esta data"}
          </div>
        </Indicador>

        <Indicador
          titulo="Preço (tarifa atual)"
          info={
            <InfoTip>
              <p>A tarifa é preço de tabela e a referência é valor pago: a comparação mostra a direção, não a diferença exata.</p>
              <p>Referência = o que {q?.ano ?? "o ano escolhido"} praticou do estágio atual até D-0 (média da janela, ponderada pelas diárias).</p>
              <p>O diagnóstico usa só a tarifa atual do site; sem tarifa para a data e categoria, usa só ocupação e ritmo. A diária já vendida e a referência aparecem como informação.</p>
              {todas ? <p>Todas as categorias: a diária é faturamento ÷ diárias somando as categorias; o mix de categorias pode afetar a comparação.</p> : null}
            </InfoTip>
          }
        >
          <div className="flex items-baseline gap-2">
            <span className={`font-semibold tabular-nums ${semTarifa ? "text-lg text-muted-foreground" : "text-2xl"}`}>{semTarifa ? "sem tarifa" : usd(q?.diariaAtual ?? null)}</span>
            {q?.precoPct != null ? <span className={`text-sm font-medium tabular-nums ${corDif}`}>{sinal(q.precoPct)}%</span> : null}
          </div>
          {pontos.length ? (
            <>
              <div className="relative h-14">
                <div className="absolute inset-x-0 top-7 h-1 rounded-full bg-muted" />
                {rotulos.map((p) => (
                  <div key={p.k}>
                    <span
                      title={`${p.nome}: ${usd(p.v)}`}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${p.cor} ${p.usado ? "size-4 ring-2 ring-foreground/60" : "size-3"}`}
                      style={{ left: pos(p.x), top: "30px" }}
                    />
                    <span
                      className={`absolute -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums ${p.usado ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      style={{ left: pos(Math.max(0.08, Math.min(0.92, p.x))), top: p.embaixo ? "42px" : "4px" }}
                    >
                      {usd(p.v)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                {pontos.map((p) => (
                  <span key={p.k} className={p.usado ? "font-medium text-foreground" : ""}>
                    <span className={`mr-1 inline-block size-2 rounded-full align-middle ${p.cor}`} />
                    {p.nome}
                  </span>
                ))}
                {semTarifa ? <span>(sem tarifa: já vendido e referência são só informação)</span> : null}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Sem preço para comparar.</div>
          )}
        </Indicador>

        <Indicador titulo="Ritmo (14 dias)">
          {d.closed ? (
            <>
              <div className="text-2xl font-semibold">—</div>
              <div className="text-xs text-muted-foreground">Não se aplica a data encerrada.</div>
            </>
          ) : q && q.ritmoAtual != null && q.ritmoRef != null ? (
            <>
              <div className="text-2xl font-semibold tabular-nums">
                {q.ritmoAtual} <span className="text-sm font-normal text-muted-foreground">contra</span> {Math.round(q.ritmoRef)}
              </div>
              <div className="space-y-1">
                {barrasRitmo.map((b) => (
                  <div key={b.rotulo} title={b.v == null ? undefined : `${b.rotulo}: ${num1(b.v)} (exato)`} className="flex items-center gap-2 text-[11px] tabular-nums">
                    <span className="w-9 shrink-0 text-muted-foreground">{b.rotulo}</span>
                    <div className="h-2 flex-1 rounded-full bg-muted">
                      {b.v != null ? <div className={`h-2 rounded-full ${b.destaque ? "bg-primary" : "bg-muted-foreground/60"}`} style={{ width: `${Math.max(2, (Math.round(b.v) / maxRitmo) * 100)}%` }} /> : null}
                    </div>
                    <span className="w-8 shrink-0 text-right text-muted-foreground">{b.v == null ? "—" : Math.round(b.v)}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">reservas criadas nos últimos 14 dias (referências na frota atual)</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-semibold">—</div>
              <div className="text-xs text-muted-foreground">Dados indisponíveis (sem histórico do estágio).</div>
            </>
          )}
        </Indicador>
      </div>

      {/* 4. Curva e quando cada ano vendeu */}
      <div className="grid gap-4 @3xl:grid-cols-2 @3xl:items-stretch">
        <PickupChart
          title="Curva de pickup"
          data={curva.data}
          hoje={hojeLabel}
          esperadaNome={usada ? `Esperada (${usada.date.slice(0, 4)})` : "Esperada"}
          extras={[
            // Ano escolhido, só o dia: âmbar tracejado; outros anos: violeta/azul/rosa pontilhado. Claros o bastante para o tema escuro.
            ...(curva.dia ? [{ key: curva.dia.key, name: `${curva.dia.date.slice(0, 4)} (só o dia)`, color: "#f59e0b", dash: "7 4" }] : []),
            ...curva.extras.map((e, i) => ({ key: e.key, name: e.date.slice(0, 4), color: OUTROS_ANOS[i % OUTROS_ANOS.length]!, dash: "1 4" })),
          ]}
          marcas={curva.marcas}
          note="A esperada é a média, na janela de 7 dias (a data ±3), das ocupações do ano com maior faturamento/veículo final médio (sem faturamento, maior ocupação final), cada dia lido na sua antecedência. As linhas finas são as referências do próprio dia, lidas na mesma antecedência. A atual não é prevista além da data-base."
        />
        <Card className="h-full space-y-3 p-4">
          <div className="flex items-center gap-1.5">
            <h2 className="font-semibold">Quando cada ano vendeu</h2>
            <InfoTip>
              <p>Todas as barras na mesma escala: cada segmento é a faixa de antecedência em que os carros foram criados, com largura = carros ÷ frota (frota da época nas referências, frota atual na atual). O cinza é o que não foi vendido.</p>
              <p>Referências: reservas não canceladas (composição final). Atual: reservas ativas hoje, criadas até a data-base. A unidade é a diária (carro × dia).</p>
            </InfoTip>
          </div>
          <TooltipProvider delayDuration={50}>
            <div className="space-y-2">
              {colunasVenda.map((c) => (
                <div key={c.titulo} className="flex items-center gap-2 text-xs tabular-nums">
                  <span className={`w-14 shrink-0 ${c.escolhido ? "font-semibold text-primary" : c.titulo === "Atual" ? "font-semibold" : "text-muted-foreground"}`}>{c.titulo}</span>
                  <div className="flex h-5 flex-1 overflow-hidden rounded bg-muted-foreground/15" title="cinza claro = não vendido">
                    {c.q && c.q.total.carros && c.fleet > 0
                      ? c.q.faixas.map((f, i) =>
                          f.carros ? (
                            <Tooltip key={f.label}>
                              <TooltipTrigger asChild>
                                <div tabIndex={0} className="h-full" style={{ width: `${(f.carros / c.fleet) * 100}%`, backgroundColor: SEG_CORES[i] }} aria-label={`${c.titulo} ${f.label}`} />
                              </TooltipTrigger>
                              <TooltipContent>
                                {c.titulo} · {f.label}: {f.carros} {f.carros === 1 ? "carro" : "carros"} · {pct(f.pct)} · {usd(f.diaria)}
                              </TooltipContent>
                            </Tooltip>
                          ) : null,
                        )
                      : null}
                  </div>
                  <span className="w-40 shrink-0 text-right">
                    {c.q?.total.carros ? `${c.q.total.carros} de ${c.fleet} carros · ${usd(c.q.total.diaria)}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </TooltipProvider>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {FAIXAS_ANTECEDENCIA.map((f, i) => (
              <span key={f.label}>
                <span className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ backgroundColor: SEG_CORES[i] }} />
                {f.label}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">Mais escuro = vendido mais cedo; cinza claro = não vendido. Ao lado de cada ano: carros vendidos de frota e diária total.</div>

          <div className="space-y-1.5 border-t pt-3">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold">Projeção de fechamento</h3>
              <InfoTip>
                <p>Projeção simples: ocupação atual + o ganho que cada referência teve até a data, em carros, limitada à frota atual. Não é previsão.</p>
                <p>Fat./veículo = ocupação projetada × diária média já vendida.</p>
              </InfoTip>
            </div>
            {d.closed ? (
              <p className="text-xs text-muted-foreground">Data encerrada: sem projeção.</p>
            ) : projecoes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem referência com dados para projetar.</p>
            ) : (
              projecoes.map((p) => (
                <p key={p.ano} className={`text-xs tabular-nums ${p.escolhido ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  No ritmo de {p.ano}: fecha com ~{p.proj.fechaCarros} de {d.capacity} carros ({pct(p.proj.fechaOcc)})
                  {p.proj.revPorVeiculo != null ? ` · fat./veículo ~${usd(p.proj.revPorVeiculo)}` : ""}
                </p>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* 5. Detalhes */}
      <details className="group rounded-lg border">
        <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Ver detalhes</summary>
        <div className="border-t p-3">
          <ReferenciasAnteriores
            model={model}
            rows={rows}
            date={date}
            base={base}
            lead={d.lead}
            closed={d.closed}
            booked={d.booked}
            capacity={d.capacity}
            diariaAtual={rev.diaria}
            precoVenda={precoVenda}
            leadLabel={leadLabel}
            rowsFor={rowsFor}
            lotacaoLimite={tol.lotacaoDias}
            dadosDaData={
              <div className="space-y-2">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <Campo r="Veículos reservados" v={String(d.booked ?? "—")} />
                  <Campo r="Capacidade disponível" v={String(d.capacity)} />
                  <Campo r="Sazonalidade" v={d.season ?? "—"} />
                  <Campo r="Diária média (hoje)" v={usd(rev.diaria)} />
                  <Campo r="Faturamento por veículo" v={usd(rev.porVeiculo)} />
                  <Campo r="Evento móvel" v={d.event ? `${EVENT_LABEL[d.event]} (${d.eventRel! > 0 ? "+" : ""}${d.eventRel} dias)` : "—"} />
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-muted-foreground">Base do benchmark</dt>
                    <dd className="font-medium">{d.level ? `${BENCH_LEVEL_LABEL[d.level]} · ${d.n} ${d.n === 1 ? "ano comparado" : "anos comparados"}` : "—"}</dd>
                  </div>
                </dl>
                {rev.semPreco.length > 0 && rev.semPreco.length < rows.length ? (
                  <p className="text-xs text-muted-foreground">Diária média e faturamento por veículo não incluem {rev.semPreco.join(", ")} (sem tarifa lançada).</p>
                ) : null}
              </div>
            }
          />
        </div>
      </details>
    </div>
  );
}

function Campo({ r, v }: { r: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{r}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
