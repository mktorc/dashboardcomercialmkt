import { Card } from "@/components/ui/card";
import {
  EVENT_LABEL,
  avisoFrota,
  ganhoAteData,
  referenceItems,
  referenceDates,
  revenueOf,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import { dataBR, pct, usd } from "@/lib/pricing-format";

const ganho = (pp: number | null) => (pp == null ? "—" : `${pp >= 0 ? "+" : ""}${pp.toFixed(1).replace(".", ",")} p.p.`);

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

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
    <Card className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold">
        {titulo} · {leadLabel}
      </h3>
      {itens.length === 0 ? (
        <p className="text-muted-foreground">Sem edição anterior comparável.</p>
      ) : (
        <div className="space-y-3">
          {itens.map(({ dt, it, r }, i) => {
            const aviso = it ? avisoFrota(it.fleet, it.fleetAtual) : null;
            return (
              <div
                key={dt}
                className={`space-y-2 rounded-md border p-3 ${it?.chosen ? "border-primary/60 bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {ref.evento ? `Edição de ${dt.slice(0, 4)}` : i === 0 ? "1 ano antes" : "2 anos antes"}
                    <span className="ml-1 font-normal text-muted-foreground">({dataBR(dt)})</span>
                  </span>
                  {it?.chosen ? (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                      usada na esperada
                    </span>
                  ) : null}
                </div>
                {it?.occ == null ? (
                  <p className="text-xs text-muted-foreground">Sem dado</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    <Campo rotulo={`Ocupação ${leadLabel}`} valor={pct(it.occ)} />
                    <Campo rotulo="Ocupação final" valor={pct(it.occFinal)} />
                    <Campo rotulo="Ganho até a data" valor={ganho(ganhoAteData(it))} />
                    <Campo rotulo="Diária média" valor={usd(r.diaria)} />
                    <Campo rotulo="Fat./veículo final" valor={usd(it.revFinal)} />
                    <Campo rotulo={`Fat./veículo ${leadLabel}`} valor={usd(it.rev)} />
                    <Campo rotulo="Frota (época)" valor={String(it.fleet)} />
                    <Campo rotulo="Frota atual" valor={String(it.fleetAtual)} />
                  </dl>
                )}
                {aviso ? <div className="text-xs text-amber-700 dark:text-amber-300">Atenção: {aviso}</div> : null}
                {it && !it.eligible && it.motivo ? (
                  <div className="text-xs text-amber-700 dark:text-amber-300">Fora da esperada: {it.motivo}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
