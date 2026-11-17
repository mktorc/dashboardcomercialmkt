import { useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PickupChart } from "@/components/precificacao/PickupChart";
import { BASE_TXT } from "@/lib/captura-categoria";
import { dinheiro } from "@/lib/decisao";
import {
  FAIXAS_LEAD,
  analisarMesa,
  corRecorrencia,
  curvaVendas,
  mapaAno,
  faixaLeadDe,
  curvasComparacao,
  datasAcima,
  porqueMesa,
  ordenarPadroes,
  previsoes,
  separarPorGanho,
  tarifaProximasDoMes,
  padroesRecorrentes,
  precoMinimo,
  resumoMesa,
  rotuloMeses,
  type Faixa,
  type Perda,
} from "@/lib/dinheiro-mesa";
import { usePace, type PacePayload } from "@/lib/occupancy-pace";
import { useOurRates } from "@/lib/competitive-data";

/** Ganho mínimo (%) do preço possível sobre o cobrado para um padrão virar cartão. */
const GANHO_MIN_PCT = 5;
import type { Range } from "@/lib/pricing-range";

const ALL_CAT = "__all__";
/** Opções "Próximos N meses" (valores que não colidem com o número de um mês). */
const PRESETS = [3, 6, 9, 12].map((n) => ({
  value: `proximos-${n}`,
  n,
  label: `Próximos ${n} meses`,
}));
const PROXIMOS = "proximos-6";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const faixaTxt = (f: Faixa | null) =>
  !f
    ? "—"
    : Math.round(f.min) === Math.round(f.max)
      ? dinheiro(f.min)
      : `${dinheiro(f.min)} a ${dinheiro(f.max).replace("US$ ", "")}`;

export type AbrirPrioridades = (category: string, range: Range) => void;

export function DinheiroNaMesa({ onAbrirPrioridades }: { onAbrirPrioridades?: AbrirPrioridades }) {
  const q = usePace();
  if (q.isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (q.error || !q.data)
    return (
      <Card className="p-6 text-sm text-muted-foreground">Sem dados de ocupação publicados.</Card>
    );
  if (!q.data.payload.linhas.some((l) => l.m))
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        O payload publicado não traz o preço de cada diária (precisa de v6 ou mais).
      </Card>
    );
  return <Painel payload={q.data.payload} onAbrirPrioridades={onAbrirPrioridades} />;
}

function Painel({
  payload,
  onAbrirPrioridades,
}: {
  payload: PacePayload;
  onAbrirPrioridades?: AbrirPrioridades | undefined;
}) {
  const [minAnos, setMinAnos] = useState(2);
  const [celula, setCelula] = useState<{ category: string; mes: number } | null>(null);
  const [exemploKey, setExemploKey] = useState<string | null>(null);
  const [verDatas, setVerDatas] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);
  const perdas = useMemo(() => analisarMesa(payload), [payload]);
  const resumo = useMemo(() => resumoMesa(perdas), [perdas]);
  const padroes = useMemo(
    () => ordenarPadroes(padroesRecorrentes(perdas, minAnos), payload.hoje),
    [perdas, minAnos, payload.hoje],
  );
  const separados = useMemo(() => separarPorGanho(padroes, GANHO_MIN_PCT), [padroes]);
  const cartoes = separados.comSinal;
  const [verSemSinal, setVerSemSinal] = useState(false);
  const rates = useOurRates();
  const tarifas = useMemo(
    () =>
      (rates.data ?? []).map((r) => ({
        date: r.pickupDate,
        category: r.category,
        rate: r.dailyRate,
      })),
    [rates.data],
  );
  const mapa = useMemo(() => mapaAno(perdas), [perdas]);
  const minimos = useMemo(() => precoMinimo(perdas, payload), [perdas, payload]);
  const filtradas = celula
    ? perdas.filter(
        (p) => p.category === celula.category && Number(p.date.slice(5, 7)) === celula.mes,
      )
    : perdas;
  const exemplo =
    (exemploKey && perdas.find((p) => `${p.date}|${p.category}` === exemploKey)) ||
    filtradas[0] ||
    null;
  const cats = [...new Set(perdas.map((p) => p.category))].sort();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <OndeRepete payload={payload} perdas={perdas} onAbrirPrioridades={onAbrirPrioridades} />

        <Card className="p-4">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-left font-semibold"
            onClick={() => setVerHistorico((v) => !v)}
          >
            <span>{verHistorico ? "▾" : "▸"}</span>
            Histórico completo{" "}
            <span className="font-normal text-muted-foreground">
              (mapa do ano, uma data de exemplo e a lista de todas as datas que esgotaram cedo)
            </span>
          </button>
        </Card>
        {verHistorico ? (
          <>
            <p className="px-1 text-xs text-muted-foreground">
              Total estimado deixado na mesa:{" "}
              <b>{faixaTxt(resumo.comPerda ? resumo.total : null)}</b> em {resumo.datas} datas que
              lotaram cedo desde 2024 (estimativa: com preço maior, parte das reservas poderia não
              acontecer).
            </p>
            {/* Mapa do ano */}
            {cats.length ? (
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Mapa do ano</h2>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-4 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Todos os anos juntos. Cor: em quantos anos aquele mês esgotou cedo (1, 2, 3
                        ou mais). Número: perda estimada somada (conservadora). Clique para ver o
                        exemplo e as datas daquela célula.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {celula ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => (setCelula(null), setExemploKey(null))}
                    >
                      Limpar filtro ({celula.category} · {MESES[celula.mes - 1]})
                    </Button>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-separate border-spacing-1 text-xs">
                    <thead>
                      <tr>
                        <th />
                        {MESES.map((m) => (
                          <th key={m} className="font-normal text-muted-foreground">
                            {m}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cats.map((c) => (
                        <tr key={c}>
                          <td className="whitespace-nowrap pr-2 text-muted-foreground">{c}</td>
                          {MESES.map((_, i) => {
                            const mes = i + 1;
                            const v = mapa.get(`${c}|${mes}`);
                            const ativo = celula?.category === c && celula.mes === mes;
                            return (
                              <td key={mes} className="p-0">
                                {v ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => (
                                          setCelula(ativo ? null : { category: c, mes }),
                                          setExemploKey(null)
                                        )}
                                        className={`h-9 w-full rounded px-1 tabular-nums ${corRecorrencia(v.anos.length)} ${ativo ? "ring-2 ring-foreground" : ""}`}
                                      >
                                        {v.min > 0 ? dinheiro(v.min) : ""}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                      {c} · {MESES[i]}: {v.anos.join(", ")} · {v.datas} datas ·
                                      perda {faixaTxt(v.max ? v : null)}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <div className="h-9 rounded bg-muted/30" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  {[1, 2, 3].map((n) => (
                    <span key={n} className="flex items-center gap-1">
                      <span className={`size-3 rounded ${corRecorrencia(n)}`} />
                      {n === 3 ? "3+ anos" : `${n} ano${n > 1 ? "s" : ""}`}
                    </span>
                  ))}
                </div>
              </Card>
            ) : null}

            {/* Exemplo */}
            {exemplo ? <Exemplo p={exemplo} payload={payload} /> : null}

            {/* Todas as datas */}
            <Card className="space-y-3 p-4">
              <button
                type="button"
                className="flex w-full items-center gap-1 text-left font-semibold"
                onClick={() => setVerDatas((v) => !v)}
              >
                <span>{verDatas ? "▾" : "▸"}</span>
                Ver todas as datas{" "}
                <span className="font-normal text-muted-foreground">
                  ({filtradas.length}
                  {celula ? ` em ${celula.category} · ${MESES[celula.mes - 1]}` : ""})
                </span>
              </button>
              {verDatas ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 font-normal">Data</th>
                        <th className="font-normal">Categoria</th>
                        <th className="font-normal">Lotou em</th>
                        <th className="font-normal">Maior adiantamento</th>
                        <th className="font-normal">Diária paga</th>
                        <th className="font-normal">Preço possível</th>
                        <th className="font-normal">Perda estimada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtradas.map((p) => {
                        const k = `${p.date}|${p.category}`;
                        return (
                          <tr
                            key={k}
                            className={`cursor-pointer border-t border-border hover:bg-muted/40 ${exemplo && `${exemplo.date}|${exemplo.category}` === k ? "bg-muted/50" : ""}`}
                            onClick={() => {
                              setExemploKey(k);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            <td className="py-1.5">{dataBR(p.date)}</td>
                            <td>{p.category}</td>
                            <td>D-{p.lotouEm}</td>
                            <td className="tabular-nums">
                              +{Math.round(p.ppMax)} p.p. em D-{p.ppEm}
                            </td>
                            <td className="tabular-nums">
                              {p.diariaPaga != null ? dinheiro(p.diariaPaga) : "—"}
                            </td>
                            <td className="tabular-nums">
                              {p.possivel
                                ? Math.round(p.possivel.conservador) ===
                                  Math.round(p.possivel.otimista)
                                  ? dinheiro(p.possivel.conservador)
                                  : `${dinheiro(p.possivel.conservador)}–${Math.round(p.possivel.otimista)}`
                                : "sem referência acima"}
                            </td>
                            <td className="font-medium tabular-nums">{faixaTxt(p.perda)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function Exemplo({ p, payload }: { p: Perda; payload: PacePayload }) {
  const row = payload.linhas.find((r) => r.d === p.date && r.c === p.category);
  if (!row) return null;
  const cv = curvaVendas(row, p.curva);
  const dados = cv.pontos.map((x) => ({
    label: x.L === p.lotouEm ? `D-${x.L} (esgotou)` : x.label,
    atual: x.atual != null ? Math.round(x.atual) : null,
    esperada: x.normal != null ? Math.round(x.normal) : null,
  }));
  const topo = Math.max(100, ...dados.flatMap((d) => [d.atual ?? 0, d.esperada ?? 0]));
  const yMax = topo > 100 ? Math.ceil(topo / 10) * 10 : 100;
  const EIXO = 180;
  const antes = Math.max(0, Math.min(1, (EIXO - Math.min(p.lotouEm, EIXO)) / EIXO));
  const pagaAntes = p.diariaPagaCedo ?? p.diariaPaga;
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">
          Exemplo: {dataBR(p.date)} · {p.category}
        </h2>
        <p className="text-xs text-muted-foreground">
          Esgotou em D-{p.lotouEm}, com até {Math.round(p.ppMax)} p.p. acima do ritmo normal (D-
          {p.ppEm}). Perda estimada {faixaTxt(p.perda)}.
        </p>
      </div>
      <PickupChart
        title="Ocupação da frota em cada antecedência"
        data={dados}
        yMax={yMax}
        esperadaNome={`Ritmo normal (${BASE_TXT[p.curva.base]})`}
        note={`Linha cheia: como esta data vendeu. Tracejada: o ritmo normal da categoria e mês, levado à ocupação final desta data. Esgotou em D-${p.lotouEm}.`}
      />
      <div>
        <div className="flex overflow-hidden rounded-md text-xs">
          <div
            className="bg-sky-500/20 px-2 py-2 text-sky-700 dark:text-sky-300"
            style={{ width: `${Math.max(antes * 100, 20)}%` }}
          >
            até D-{p.lotouEm}: vendido a {pagaAntes != null ? dinheiro(pagaAntes) : "—"}
          </div>
          <div className="flex-1 bg-red-500/15 px-2 py-2 text-red-700 dark:text-red-300">
            depois: sem carro para vender
            {p.possivel ? ` (clientes pagariam ~${dinheiro(p.possivel.conservador)})` : ""}
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>D-{EIXO}</span>
          <span>D-0</span>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── onde o erro pode se repetir ───────────────────────── */

const sinalPp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))} p.p.`;
const sinalPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;
const ORDEM_ACAO = {
  repetindo: 0,
  desacelerou: 1,
  acelerado: 2,
  risco: 3,
  passou: 4,
  "sem-padrao": 5,
} as const;

function OndeRepete({
  payload,
  perdas,
  onAbrirPrioridades,
}: {
  payload: PacePayload;
  perdas: Perda[];
  onAbrirPrioridades?: AbrirPrioridades | undefined;
}) {
  const hoje = payload.hoje;
  const proximosMeses = Array.from(
    { length: 12 },
    (_, i) => ((Number(hoje.slice(5, 7)) - 1 + i) % 12) + 1,
  );
  const [mesF, setMesF] = useState<string>(PROXIMOS);
  const [catF, setCatF] = useState<string>(ALL_CAT);
  const [sel, setSel] = useState<string | null>(null);
  const todas = useMemo(() => previsoes(perdas, payload), [perdas, payload]);
  const preset = PRESETS.find((p) => p.value === mesF);
  const mesesOk = preset ? proximosMeses.slice(0, preset.n) : [Number(mesF)];
  const lista = todas
    .filter(
      (x) =>
        x.acao.tipo !== "sem-padrao" &&
        mesesOk.includes(x.licao.mes) &&
        (catF === ALL_CAT || x.licao.category === catF),
    )
    .sort(
      (a, b) =>
        ORDEM_ACAO[a.acao.tipo] - ORDEM_ACAO[b.acao.tipo] || b.licao.perda.max - a.licao.perda.max,
    );
  const cats = [...new Set(todas.map((x) => x.licao.category))].sort();
  const escolhido = lista.find((x) => `${x.licao.category}|${x.licao.mes}` === sel) ?? null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Onde o erro pode se repetir</h2>
          <p className="text-xs text-muted-foreground">
            O que o passado ensina em ritmo e %, aplicado às próximas datas do mesmo mês. Só meses
            que esgotaram cedo em 2 anos ou mais.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded border-2 border-red-500/70" />
              <b>Vermelho:</b> repetindo o padrão, subir agora
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded border-2 border-amber-500/70" />
              <b>Âmbar:</b> mês que já esgotou cedo; não baixar e acompanhar
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded border-2 border-border" />
              <b>Cinza:</b> janela passou
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={mesF} onValueChange={setMesF}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
              {proximosMeses.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {MESES[m - 1]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={catF} onValueChange={setCatF}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CAT}>Todas as categorias</SelectItem>
              {cats.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {lista.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Nenhum mês com padrão recorrente de esgotar cedo neste recorte.
        </Card>
      ) : (
        lista.map((x) => {
          const k = `${x.licao.category}|${x.licao.mes}`;
          const { licao: l, sit, acao } = x;
          const borda =
            acao.tipo === "repetindo"
              ? "border-red-500/70"
              : acao.tipo === "risco" || acao.tipo === "acelerado" || acao.tipo === "desacelerou"
                ? "border-amber-500/70"
                : "border-border";
          return (
            <div
              key={k}
              role="button"
              tabIndex={0}
              onClick={() => setSel(sel === k ? null : k)}
              onKeyDown={(e) => e.key === "Enter" && setSel(sel === k ? null : k)}
              className={`cursor-pointer space-y-3 rounded-lg border-2 p-4 text-sm hover:bg-muted/40 ${borda}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">
                  {l.category} · {MESES[l.mes - 1]}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {sit ? `${sit.datas.length} datas · faltam ~${Math.round(sit.lead)} dias` : ""}
                  </span>
                </h3>
                {onAbrirPrioridades && sit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbrirPrioridades(l.category, {
                        from: sit.datas[0]!,
                        to: sit.datas[sit.datas.length - 1]!,
                      });
                    }}
                  >
                    Ver datas na Prioridades
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Bloco titulo="No passado">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="space-y-0.5" onClick={(e) => e.stopPropagation()}>
                        <p>
                          <b>{l.adiantamentoPp != null ? sinalPp(l.adiantamentoPp) : "—"}</b> acima
                          do normal em D-
                          {l.adiantamentoEm != null ? Math.round(l.adiantamentoEm) : "?"}
                        </p>
                        <p>esgotou em ~D-{l.esgotaEm != null ? Math.round(l.esgotaEm) : "?"}</p>
                        <p>
                          últimos clientes pagaram{" "}
                          <b>{l.premio != null ? sinalPct(l.premio) : "—"}</b>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {l.anos.join(", ")} · {l.datas} datas · perda{" "}
                          {faixaTxt(l.perda.max ? l.perda : null)}
                        </p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Medianas dos anos em que esgotou cedo. Diária paga{" "}
                      {l.paga != null ? dinheiro(l.paga) : "—"}; últimos 14 dias antes de esgotar{" "}
                      {l.ultimas != null ? dinheiro(l.ultimas) : "—"}.
                    </TooltipContent>
                  </Tooltip>
                </Bloco>
                <Bloco titulo="Agora">
                  {sit ? (
                    <div className="space-y-0.5">
                      <p>
                        <b>
                          {Math.abs(sit.pp) < 5
                            ? `no ritmo normal (${sinalPp(sit.pp)})`
                            : `${sinalPp(sit.pp)} ${sit.pp > 0 ? "acima" : "abaixo"} do normal`}
                        </b>
                      </p>
                      <p>
                        últimos 14 dias: {sit.ritmo.atual} reservas (normal ~
                        {Math.round(sit.ritmo.normal)})
                      </p>
                      <p>
                        {datasAcima(sit).length} de {sit.datas.length} datas acima do ritmo normal
                      </p>
                      <p className="text-xs text-muted-foreground">
                        faltam ~{Math.round(sit.lead)} dias · falta capturar{" "}
                        {Math.round(sit.falta * 100)}%
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">sem datas futuras</p>
                  )}
                </Bloco>
                <Bloco titulo="O que fazer">
                  {acao.tipo === "repetindo" ? (
                    <div className="space-y-0.5">
                      <p className="text-base font-semibold text-red-600 dark:text-red-400">
                        Subir ~{acao.subirPct}% agora
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Repetindo o padrão · nas {datasAcima(sit).length} datas acima do normal:
                      </p>
                      <p className="text-xs">
                        {datasAcima(sit)
                          .map((d) => dataBR(d).slice(0, 5))
                          .join(", ")}
                      </p>
                    </div>
                  ) : acao.tipo === "desacelerou" ? (
                    <div className="space-y-0.5">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">
                        Vendeu cedo, mas desacelerou
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Segurar preço, não subir agora
                      </p>
                    </div>
                  ) : acao.tipo === "acelerado" ? (
                    <div className="space-y-0.5">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">
                        Não baixar; vendendo rápido
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sem sinal de que aceitem preço maior
                      </p>
                    </div>
                  ) : acao.tipo === "risco" ? (
                    <div className="space-y-0.5">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">
                        Segurar preço; não baixar
                      </p>
                      <p className="text-xs text-muted-foreground">Risco de repetir · acompanhar</p>
                    </div>
                  ) : (
                    <p className="font-semibold text-muted-foreground">Janela passou</p>
                  )}
                  {sit && acao.tipo !== "repetindo" ? (
                    <p className="text-xs text-muted-foreground">
                      {dataBR(sit.datas[0]!).slice(0, 5)} a{" "}
                      {dataBR(sit.datas[sit.datas.length - 1]!).slice(0, 5)}
                    </p>
                  ) : null}
                </Bloco>
              </div>
              <p className="text-sm">{porqueMesa(l, sit, acao)}</p>
              {escolhido && sel === k && x.curva && x.fin != null ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <PickupChart
                    title="Ocupação da frota por antecedência"
                    data={curvasComparacao(payload.linhas, l, x.curva, x.fin, sit, hoje).map(
                      (p) => ({
                        label: p.label,
                        atual: p.atual,
                        esperada: p.normal,
                        tipica: p.tipica,
                      }),
                    )}
                    esperadaNome="Ritmo normal"
                    extras={[
                      {
                        key: "tipica",
                        name: "Anos que esgotaram cedo",
                        color: "rgb(239 68 68)",
                        dash: "4 3",
                      },
                    ]}
                    yMax={100}
                    note="Linha cheia: as próximas datas deste mês (média, até hoje). Tracejada: o ritmo normal. Vermelha: a média dos anos em que esgotou cedo."
                  />
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-2.5">
      <div className="mb-1 text-[11px] text-muted-foreground">{titulo}</div>
      {children}
    </div>
  );
}
