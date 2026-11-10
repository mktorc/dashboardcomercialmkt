import { Card } from "@/components/ui/card";
import {
  EVENT_LABEL,
  referenceItems,
  referenceDates,
  revenueOf,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { dataBR, pct, usd } from "@/lib/pricing-format";

/**
 * Ocupação das datas históricas de referência na mesma antecedência: o mesmo dia da semana 1 e 2 anos antes, ou, em datas de
 * evento móvel, a mesma posição do evento nas edições anteriores. Mostra também diária média e faturamento por veículo de cada ano (lidos na mesma antecedência da ocupação).
 */
export function ReferenciasAnteriores({
  model,
  rows,
  date,
  base,
  lead,
  leadLabel,
  rowsFor,
}: {
  model: PaceModel;
  /** Linhas (data × categoria) da data analisada: as mesmas que a esperada usa. */
  rows: PaceRow[];
  date: string;
  base: string;
  lead: number;
  leadLabel: string;
  /** Linhas (data × categoria) de uma data histórica: as categorias da análise atual. */
  rowsFor: (date: string) => PaceRow[];
}) {
  const ref = referenceDates(model, date, base);
  // Os mesmos números e as mesmas referências que a esperada usa (ocupação ÷ frota da época, faturamento por veículo).
  const todos = referenceItems(model, rows, date, base, lead);
  const itens = ref.datas.map((dt) => ({
    dt,
    it: todos.find((i) => i.date === dt),
    r: revenueOf(rowsFor(dt), lead),
  }));
  const titulo = ref.evento
    ? `${EVENT_LABEL[ref.evento]} (${ref.posicao! > 0 ? "+" : ""}${ref.posicao} dias) em edições anteriores`
    : "Mesmo dia da semana em períodos anteriores";
  return (
    <Card className="space-y-1 p-4 text-sm">
      <h3 className="font-semibold">
        {titulo} · {leadLabel}
      </h3>
      {itens.length === 0 ? (
        <p className="text-muted-foreground">Sem edição anterior comparável.</p>
      ) : (
        itens.map(({ dt, it, r }, i) => (
          <div key={dt} className="space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {ref.evento
                  ? `Edição de ${dt.slice(0, 4)}`
                  : i === 0
                    ? "1 ano antes"
                    : "2 anos antes"}{" "}
                ({dataBR(dt)})
              </span>
              <span className="tabular-nums">
                {pct(it?.occ ?? null)}
                {it?.occ == null ? " · sem dado" : ""}
                {it?.chosen ? " · usada na esperada" : ""}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Diária média {usd(r.diaria)}</span>
              <span>Faturamento/veículo {usd(it?.rev ?? null)}</span>
            </div>
            {it && !it.eligible && it.motivo ? (
              <div className="text-xs text-amber-700 dark:text-amber-300">Fora da esperada: {it.motivo}</div>
            ) : null}
          </div>
        ))
      )}
    </Card>
  );
}
