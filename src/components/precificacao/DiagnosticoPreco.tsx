import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DIAGNOSTICO_LABEL,
  FAIXAS_ANTECEDENCIA,
  TOL_PADRAO,
  type Diagnostico,
  type QuebraAntecedencia,
  type Tolerancias,
} from "@/lib/preco-analise";
import { pct, usd } from "@/lib/pricing-format";

export const DIAG_STYLE: Record<Diagnostico, string> = {
  "preco-alto": "bg-red-500/15 text-red-700 dark:text-red-300",
  "avaliar-preco": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  aguardar: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "demanda-fraca": "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "no-ritmo": "bg-muted text-muted-foreground",
  "vendendo-barato": "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  forte: "bg-green-500/15 text-green-700 dark:text-green-300",
};

/** Selo discreto do diagnóstico (calendário e detalhe). */
export function SeloDiagnostico({ d, grande }: { d: Diagnostico; grande?: boolean }) {
  return (
    <span
      className={`inline-block truncate rounded px-1 font-medium ${grande ? "px-2 py-0.5 text-xs" : "text-[9px] leading-4"} ${DIAG_STYLE[d]}`}
    >
      {DIAGNOSTICO_LABEL[d]}
    </span>
  );
}

/** Limites configuráveis do diagnóstico. */
export function ToleranciasConfig({
  tol,
  onChange,
}: {
  tol: Tolerancias;
  onChange: (t: Tolerancias) => void;
}) {
  const set = (k: keyof Tolerancias, v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) onChange({ ...tol, [k]: n });
  };
  const campo = (k: keyof Tolerancias, label: string) => (
    <label className="block space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" min={0} value={tol[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1 size-4" /> Diagnóstico
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm">
        <p className="text-muted-foreground">
          Limites dos sinais do diagnóstico de preço (inclusivos).
        </p>
        {campo("ocupPp", "Ocupação no ritmo: ± p.p.")}
        {campo("ocupCarros", "…ou ± carros (vale o maior)")}
        {campo("precoPct", "Preço alinhado: ± %")}
        {campo("ritmoCarros", "Ritmo igual: ± carros")}
        {campo("ritmoPct", "…ou ± % do ritmo da referência (vale o maior)")}
        {campo("lotacaoDias", "Avisar que a referência lotou só antes de D-… (dias)")}
        <Button size="sm" variant="ghost" onClick={() => onChange(TOL_PADRAO)}>
          Restaurar padrão
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Referências e a data atual lado a lado: carros, % do total e diária média por faixa de antecedência de criação. */
export function TabelaFaixasAntecedencia({
  colunas,
}: {
  colunas: { titulo: string; q: QuebraAntecedencia | null }[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">Preço por faixa de antecedência de criação</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Faixa</th>
              {colunas.map((c) => (
                <th key={c.titulo} className="px-2 py-1 font-medium text-foreground">
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FAIXAS_ANTECEDENCIA.map((f, i) => (
              <tr key={f.label} className="border-t">
                <td className="py-1 pr-2 text-muted-foreground">{f.label}</td>
                {colunas.map((c) => {
                  const x = c.q?.faixas[i];
                  return (
                    <td key={c.titulo} className="px-2 py-1">
                      {x
                        ? x.carros
                          ? `${x.carros} · ${pct(x.pct)} · ${usd(x.diaria)}`
                          : "—"
                        : "indisp."}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t font-medium">
              <td className="py-1 pr-2">Total</td>
              {colunas.map((c) => (
                <td key={c.titulo} className="px-2 py-1">
                  {c.q ? `${c.q.total.carros} · ${usd(c.q.total.diaria)}` : "indisp."}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cada célula: carros · % do total · diária média. Referências: reservas não canceladas
        (composição final). Data atual: reservas ativas hoje, criadas até a data-base. A unidade é a
        diária (carro × dia).
      </p>
    </div>
  );
}
