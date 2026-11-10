import { Card } from "@/components/ui/card";
import {
  EVENT_LABEL,
  dayPace,
  referenceDates,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { dataBR, pct } from "@/lib/pricing-format";

/**
 * Ocupação das datas históricas de referência na mesma antecedência: o mesmo dia da semana 1 e 2 anos antes, ou, em datas de
 * evento móvel, a mesma posição do evento nas edições anteriores.
 */
export function ReferenciasAnteriores({
  model,
  date,
  base,
  lead,
  leadLabel,
  rowsFor,
}: {
  model: PaceModel;
  date: string;
  base: string;
  lead: number;
  leadLabel: string;
  /** Linhas (data × categoria) de uma data histórica: as categorias da análise atual. */
  rowsFor: (date: string) => PaceRow[];
}) {
  const ref = referenceDates(model, date, base);
  const itens = ref.datas.map((dt) => ({ dt, p: dayPace(model, rowsFor(dt), dt, base, lead) }));
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
        itens.map(({ dt, p }, i) => (
          <div key={dt} className="flex justify-between">
            <span className="text-muted-foreground">
              {ref.evento
                ? `Edição de ${dt.slice(0, 4)}`
                : i === 0
                  ? "1 ano antes"
                  : "2 anos antes"}{" "}
              ({dataBR(dt)})
            </span>
            <span className="tabular-nums">
              {pct(p.atual)}
              {p.atual == null ? " · sem dado" : ""}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}
