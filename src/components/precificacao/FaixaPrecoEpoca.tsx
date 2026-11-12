import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip as ChartTooltip, XAxis, YAxis, Legend } from "recharts";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePace, type PacePayload } from "@/lib/occupancy-pace";
import { faixasPreco, pontosEpoca } from "@/lib/preco-analise";
import { dataBR, pct, usd } from "@/lib/pricing-format";

const ALL = "__all__";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Análise separada: que faixa da NOSSA diária final rendeu mais faturamento por veículo em uma época (datas passadas, 2024 em diante). */
export function FaixaPrecoEpoca() {
  const q = usePace();
  if (q.isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando ocupação…</Card>;
  if (q.error) return <Card className="p-6 text-sm text-destructive">Não foi possível carregar os dados de ocupação.</Card>;
  if (!q.data) return <Card className="p-6 text-sm text-muted-foreground">Nenhum dado de ritmo publicado ainda.</Card>;
  if (q.data.payload.versao < 6)
    return <Card className="p-6 text-sm text-muted-foreground">Dados indisponíveis: o payload publicado não traz o preço de cada diária (precisa de v6 ou mais).</Card>;
  return <Painel payload={q.data.payload} />;
}

function Painel({ payload }: { payload: PacePayload }) {
  const [cat, setCat] = useState(ALL);
  const [mes, setMes] = useState(ALL);
  const [saz, setSaz] = useState(ALL);
  const [largura, setLargura] = useState(5);
  const [minDatas, setMinDatas] = useState(5);
  const sazonalidades = useMemo(() => [...new Set(Object.values(payload.cal).map((c) => c[0]))].sort(), [payload.cal]);
  const pontos = useMemo(
    () => pontosEpoca(payload, { categoria: cat === ALL ? null : cat, mes: mes === ALL ? null : Number(mes), sazonalidade: saz === ALL ? null : saz }),
    [payload, cat, mes, saz],
  );
  const faixas = useMemo(() => faixasPreco(pontos, { largura, minDatas }), [pontos, largura, minDatas]);
  const anos = [...new Set(pontos.map((p) => p.ano))].sort();
  const destaque = faixas.find((f) => f.destaque);
  const num = (v: string, min: number, set: (n: number) => void) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min) set(n);
  };
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Campo label="Categoria">
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
        </Campo>
        <Campo label="Mês">
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os meses</SelectItem>
              {MESES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Sazonalidade">
          <Select value={saz} onValueChange={setSaz}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {sazonalidades.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label="Faixa de diária (US$)">
          <Input type="number" min={1} value={largura} onChange={(e) => num(e.target.value, 1, setLargura)} className="w-28" />
        </Campo>
        <Campo label="Mín. de datas para destacar">
          <Input type="number" min={1} value={minDatas} onChange={(e) => num(e.target.value, 1, setMinDatas)} className="w-28" />
        </Campo>
      </Card>
      <p className="text-xs text-muted-foreground">
        Cada ponto é uma data passada (2024 em diante, encerrada antes de {dataBR(payload.hoje)}): nossa diária média final contra o faturamento por veículo
        final (frota da época). Datas de evento (Carnaval, Semana Santa, Corpus Christi) e datas sem preço ficam de fora. Não usa preço de concorrente.
        {cat === ALL ? " Em todas as categorias a diária é faturamento ÷ diárias somando as categorias: o mix pode distorcer a faixa." : ""}
      </p>
      {pontos.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Sem datas passadas com preço nesta época.</Card>
      ) : (
        <>
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold">Diária média final × faturamento por veículo final</h2>
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" dataKey="diaria" name="Diária média" unit=" US$" tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <YAxis type="number" dataKey="revVeic" name="Fat./veículo" unit=" US$" tick={{ fontSize: 11 }} domain={[0, "auto"]} />
                  <ChartTooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number | string, n: string) => (typeof v === "number" ? (n === "Ocupação" ? pct(v) : usd(v)) : v)}
                    labelFormatter={() => ""}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {anos.map((a, i) => (
                    <Scatter key={a} name={a} data={pontos.filter((p) => p.ano === a)} fill={CORES[i % CORES.length]!} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold">Por faixa de diária</h2>
            {destaque ? (
              <p className="text-sm">
                Maior faturamento/veículo médio: <span className="font-medium">{usd(destaque.de)} a {usd(destaque.ate)}</span> ({usd(destaque.revVeicMedio)} por veículo,{" "}
                {destaque.datas} datas).
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma faixa com ao menos {minDatas} datas: sem destaque.</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-normal">Faixa de diária</th>
                    <th className="px-2 font-normal">Datas</th>
                    <th className="px-2 font-normal">Ocupação final média</th>
                    <th className="px-2 font-normal">Fat./veículo médio</th>
                    <th className="px-2 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {faixas.map((f) => (
                    <tr key={f.de} className={`border-t ${f.destaque ? "bg-primary/10 font-medium" : ""}`}>
                      <td className="py-1 pr-2">
                        {usd(f.de)} a {usd(f.ate)}
                      </td>
                      <td className="px-2">{f.datas}</td>
                      <td className="px-2">{pct(f.occMedia)}</td>
                      <td className="px-2">{usd(f.revVeicMedio)}</td>
                      <td className="px-2 text-xs text-muted-foreground">{f.destaque ? "maior fat./veículo" : f.pequena ? "amostra pequena" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
