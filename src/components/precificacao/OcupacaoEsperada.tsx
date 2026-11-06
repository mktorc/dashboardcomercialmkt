import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { forecastTotal, useForecast } from "@/lib/pricing-forecast";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

export function OcupacaoEsperada() {
  const q = useForecast();
  const payload = q.data?.payload ?? null;
  const [date, setDate] = useState("");
  const min = payload ? payload.linhas[0]?.d : undefined;
  const dia =
    date || (payload ? payload.linhas.find((l) => l.d >= addDays(payload.hoje, 90))?.d : "") || "";
  const rows = useMemo(
    () =>
      payload
        ? payload.linhas.filter((l) => l.d === dia).sort((a, b) => a.c.localeCompare(b.c))
        : [],
    [payload, dia],
  );
  const total = useMemo(() => forecastTotal(rows), [rows]);

  if (q.isLoading)
    return <Card className="p-6 text-sm text-muted-foreground">Carregando previsão…</Card>;
  if (q.error)
    return (
      <Card className="p-6 text-sm text-destructive">Não foi possível carregar a previsão.</Card>
    );
  if (!payload)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma previsão publicada ainda. Rode previsao.py --publicar em scripts/precificacao.
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Data a consultar</span>
          <Input
            type="date"
            value={dia}
            min={min}
            max={payload.ate}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </label>
        <p className="text-sm text-muted-foreground">
          Posição de {dataBR(payload.hoje)} (gerada em{" "}
          {new Date(q.data!.generated_at).toLocaleDateString("pt-BR")}). Reservas open, rental e
          concluídas; canceladas fora.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Sem previsão para {dia ? dataBR(dia) : "esta data"}: fora do período calculado ou sem
          histórico suficiente.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="p-3">Categoria</th>
                <th className="p-3 text-right">Carros</th>
                <th className="p-3 text-right">Diárias vendidas</th>
                <th className="p-3 text-right">Ocupação hoje</th>
                <th className="p-3 text-right">Ocupação esperada</th>
                <th
                  className="p-3 text-right"
                  title="Pessimista: só 1 em cada 4 datas parecidas do passado ficou abaixo. Otimista: só 1 em cada 4 ficou acima."
                >
                  Cenário (pessimista – otimista)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.c}
                  className="border-b border-border/60"
                  title={`${r.n} datas passadas · base: ${r.b}`}
                >
                  <td className="p-3">{r.c}</td>
                  <td className="p-3 text-right tabular-nums">{r.f}</td>
                  <td className="p-3 text-right tabular-nums">{r.v}</td>
                  <td className="p-3 text-right tabular-nums">{pct(r.o)}</td>
                  <td className="p-3 text-right font-medium tabular-nums">{pct(r.e)}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {pct(r.lo)} – {pct(r.hi)}
                  </td>
                </tr>
              ))}
              {total ? (
                <tr className="font-semibold">
                  <td className="p-3">Total</td>
                  <td className="p-3 text-right tabular-nums">{total.f}</td>
                  <td className="p-3 text-right tabular-nums">{total.v}</td>
                  <td className="p-3 text-right tabular-nums">{pct(total.o)}</td>
                  <td className="p-3 text-right tabular-nums">{pct(total.e)}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {pct(total.lo)} – {pct(total.hi)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Esperada = ocupação de hoje + quanto, em média, a ocupação de datas passadas da mesma
        categoria e sazonalidade cresceu entre esta antecedência e o dia. Passe o mouse na linha
        para ver quantas datas passadas sustentam o número.
      </p>
      <p className="text-xs text-muted-foreground">
        Cenário pessimista – otimista: em datas parecidas do passado, só 1 em cada 4 ficou abaixo do
        pessimista e só 1 em cada 4 ficou acima do otimista; o esperado fica no meio. Faixa estreita
        indica histórico consistente; faixa larga, previsão menos firme (comum em categorias com
        poucos carros). Não é garantia.
      </p>
    </div>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
