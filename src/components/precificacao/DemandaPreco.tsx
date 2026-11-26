import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CFG, TODAS, adrAntecedencia, nomeCategoria, type LinhaPickup } from "@/lib/demanda-preco";
import { useDemandaPreco } from "@/components/precificacao/useDemandaPreco";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesTxt = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const usd = (v: number | null) => (v == null ? "—" : `US$ ${v.toFixed(0)}`);
const varTxt = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
const tom = (v: number | null) =>
  v == null
    ? "text-muted-foreground"
    : v > 0.02
      ? "text-green-700 dark:text-green-300"
      : v < -0.02
        ? "text-red-700 dark:text-red-300"
        : "";

// Três séries com matizes bem distintos (azul, verde, laranja), legíveis no claro e no escuro.
const COR = { mercado: "#3b82f6", locacoes: "#16a34a", adr: "#f97316" };

export function InfoTip({ children, label = "Como ler" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

function Titulo({
  texto,
  info,
  children,
}: {
  texto: string;
  info: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <h2 className="font-semibold">{texto}</h2>
        <InfoTip>{info}</InfoTip>
      </div>
      {children}
    </div>
  );
}

/** Cor da célula do mapa de calor pela variação do pickup vs ano anterior (±40% satura). */
function corCelula(p: LinhaPickup | undefined): string {
  if (!p || p.razao == null) return "var(--muted)";
  const v = Math.max(-0.4, Math.min(0.4, p.razao - 1));
  const a = 0.15 + (Math.abs(v) / 0.4) * 0.75;
  return v >= 0 ? `rgb(22 163 74 / ${a})` : `rgb(220 38 38 / ${a})`;
}

export function DemandaPreco({ onAbrirPrioridades }: { onAbrirPrioridades?: () => void }) {
  const q = useDemandaPreco();
  const { hoje, dados: m } = q;
  const [catFaixa, setCatFaixa] = useState<string>(TODAS);
  const [verDados, setVerDados] = useState(false);
  // Séries ocultas pelo clique na legenda do gráfico de sazonalidade.
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const alternar = (serie: string) =>
    setOcultas((o) => {
      const n = new Set(o);
      if (n.has(serie)) n.delete(serie);
      else n.add(serie);
      return n;
    });

  if (q.isLoading)
    return <Card className="p-6 text-sm text-muted-foreground">Carregando reservas e NTTO…</Card>;
  if (q.error) {
    const msg = (q.error as { message?: string }).message ?? "";
    return (
      <Card className="p-6 text-sm text-destructive">
        {/pick_up_location_id|ntto_chegadas/.test(msg)
          ? "Falta rodar sql-para-gravar/demanda_preco.sql no Supabase."
          : `Não foi possível carregar a aba: ${msg}`}
      </Card>
    );
  }
  if (!m || !m.rs.length)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma reserva com loja de Orlando.
      </Card>
    );

  const r = m.resumo;
  const faixas = adrAntecedencia(m.rs, hoje, catFaixa);
  const mesesPk = [...new Set(m.pk.map((p) => p.mes))];
  const catsPk = [TODAS, ...m.categorias].filter((c) =>
    m.pk.some((p) => p.categoria === c && (p.otb > 0 || (p.otbAnoAnterior ?? 0) > 0)),
  );
  const dadosSaz = m.saz.map((s) => ({
    mes: MESES[s.mes - 1],
    Mercado: s.mercado,
    "Nossas locações": s.locacoes,
    ADR: s.adr,
  }));
  const periodo = `${mesTxt(r.meses[0]!)} a ${mesTxt(r.meses.at(-1)!)}`;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <span>
            ADR on the books <b className={tom(r.varAdr)}>{varTxt(r.varAdr)}</b>
          </span>
          <span className="text-muted-foreground">·</span>
          <span>
            Pickup <b className={tom(r.varPickup)}>{varTxt(r.varPickup)}</b>
          </span>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={onAbrirPrioridades}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {m.al.length} {m.al.length === 1 ? "ação" : "ações"} em Prioridades{" "}
            <ArrowRight className="size-3.5" />
          </button>
          <span className="ml-auto">
            <InfoTip label="Sobre os números">
              Retiradas de {periodo} em Orlando, comparadas com o mesmo período do ano anterior na
              mesma data. ADR {usd(r.adr)} vs {usd(r.adrAnoAnterior)}; {r.otb} reservas vs{" "}
              {r.otbAnoAnterior}. ADR = valor da locação já com desconto, sem taxas e extras, só
              reservas pagas.
            </InfoTip>
          </span>
        </Card>

        <Card className="space-y-3 p-4">
          <Titulo
            texto="Pickup por categoria · próximos 6 meses"
            info={
              <>
                Cor = reservas já feitas hoje vs as do mesmo mês do ano anterior feitas até a mesma
                data (verde à frente, vermelho atrás; satura em ±40%). Cinza = menos de{" "}
                {CFG.minBase} reservas no ano anterior. Passe o mouse para ver reservas e ADR.
              </>
            }
          />
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[520px] gap-1 text-xs"
              style={{
                gridTemplateColumns: `minmax(140px, 1.4fr) repeat(${mesesPk.length}, minmax(48px, 1fr))`,
              }}
            >
              <div />
              {mesesPk.map((mes) => (
                <div key={mes} className="text-center text-muted-foreground">
                  {mesTxt(mes)}
                </div>
              ))}
              {catsPk.map((c) => (
                <div key={c} className="contents">
                  <div className={`truncate py-1.5 pr-2 ${c === TODAS ? "font-semibold" : ""}`}>
                    {nomeCategoria(c)}
                  </div>
                  {mesesPk.map((mes) => {
                    const p = m.pk.find((x) => x.categoria === c && x.mes === mes);
                    return (
                      <Tooltip key={mes}>
                        <TooltipTrigger asChild>
                          <div
                            className="h-8 cursor-default rounded-md"
                            style={{ background: corCelula(p) }}
                            aria-label={`${nomeCategoria(c)} ${mesTxt(mes)}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          <p className="font-medium">
                            {nomeCategoria(c)} · {mesTxt(mes)}
                          </p>
                          <p>
                            Reservas: {p?.otb ?? 0} vs {p?.otbAnoAnterior ?? "—"} (
                            {varTxt(p?.razao != null ? p.razao - 1 : null)})
                          </p>
                          <p>
                            ADR: {usd(p?.adr ?? null)} vs {usd(p?.adrAnoAnterior ?? null)} (
                            {varTxt(p?.varAdr ?? null)})
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-3 p-4 lg:col-span-2">
            <Titulo
              texto="Demanda × preço por mês do ano"
              info={
                <>
                  Índice = mês ÷ média do ano (1,00 = mês médio). Mercado: brasileiros entrando pelo
                  aeroporto de Orlando (NTTO, 2017–2019 e 2022+). Nossas locações e ADR: anos
                  completos desde ago/2023. ADR abaixo da demanda no pico = preço sobe menos que a
                  procura.
                  {m.ultimoNtto
                    ? ` Último mês do NTTO: ${mesTxt(m.ultimoNtto.mes)}${m.ultimoNtto.preliminar ? " (preliminar)" : ""}.`
                    : ""}
                </>
              }
            >
              <Button variant="ghost" size="sm" onClick={() => setVerDados((v) => !v)}>
                {verDados ? "Ocultar dados" : "Ver dados"}
              </Button>
            </Titulo>
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <LineChart data={dadosSaz} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    domain={[0.6, "auto"]}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
                  <ChartTooltip
                    formatter={(v: number) => (typeof v === "number" ? v.toFixed(2) : "—")}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                    onClick={(e: { dataKey?: unknown }) => alternar(String(e.dataKey))}
                    formatter={(valor: string) => (
                      <span
                        style={{ opacity: ocultas.has(valor) ? 0.35 : 1 }}
                        title={ocultas.has(valor) ? "Clique para mostrar" : "Clique para ocultar"}
                      >
                        {valor}
                      </span>
                    )}
                  />
                  {(
                    [
                      ["Mercado", COR.mercado],
                      ["Nossas locações", COR.locacoes],
                      ["ADR", COR.adr],
                    ] as const
                  ).map(([serie, cor]) => (
                    <Line isAnimationActive={false}
                      key={serie}
                      dataKey={serie}
                      stroke={cor}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: cor }}
                      hide={ocultas.has(serie)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {verDados ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      <TableHead className="text-right">Mercado</TableHead>
                      <TableHead className="text-right">Flórida</TableHead>
                      <TableHead className="text-right">Nossas locações</TableHead>
                      <TableHead className="text-right">Nossas diárias</TableHead>
                      <TableHead className="text-right">ADR</TableHead>
                      <TableHead>Leitura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.saz.map((s) => (
                      <TableRow key={s.mes}>
                        <TableCell>{MESES[s.mes - 1]}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.mercado?.toFixed(2) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.florida?.toFixed(2) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.locacoes?.toFixed(2) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.diarias?.toFixed(2) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {s.adr?.toFixed(2) ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {s.leitura}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </Card>

          <Card className="space-y-3 p-4">
            <Titulo
              texto="ADR por antecedência"
              info={
                <>
                  Dias entre a reserva e a retirada, últimos 12 meses realizados, só reservas pagas.
                  Passe o mouse para ver reservas, desconto e a diferença para quem reserva com 0–7
                  dias.
                </>
              }
            />
            <Select value={catFaixa} onValueChange={setCatFaixa}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[TODAS, ...m.categorias].map((c) => (
                  <SelectItem key={c} value={c}>
                    {nomeCategoria(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="h-44 w-full">
              <ResponsiveContainer>
                <BarChart data={faixas} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{ fontSize: 12 }}
                    labelFormatter={(l: string) => `${l} dias antes`}
                    formatter={(v: number, _n, item: { payload?: (typeof faixas)[number] }) => {
                      const f = item.payload;
                      const extra = f
                        ? ` · ${f.reservas} reservas · desconto ${f.descontoPct == null ? "—" : `${(f.descontoPct * 100).toFixed(1)}%`}${f.faixa === "0–7" ? "" : ` · ${varTxt(f.premio)} vs 0–7`}`
                        : "";
                      return [`${usd(v)}${extra}`, "ADR"];
                    }}
                  />
                  <Bar isAnimationActive={false} dataKey="adr" fill={COR.adr} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
