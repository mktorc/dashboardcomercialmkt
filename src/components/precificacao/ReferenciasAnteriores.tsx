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
import { type PrecoVenda, carros, difDiariaPct, diariaEmL, lotouEm, projecaoFechamento, ritmoRecente } from "@/lib/occupancy-detail";
import { dataBR, pct, usd } from "@/lib/pricing-format";

const ganho = (pp: number | null) => (pp == null ? "—" : `${pp >= 0 ? "+" : ""}${pp.toFixed(1).replace(".", ",")} p.p.`);
const sinal = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}`);
const dif = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`);

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

const Aviso = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs text-amber-700 dark:text-amber-300">{children}</div>
);

/**
 * Ocupação das datas históricas de referência na mesma antecedência: o mesmo dia da semana 1 e 2 anos antes, ou, em datas de
 * evento móvel, a mesma posição do evento nas edições anteriores. Mostra ocupação (% e carros), ganho, preço, projeção simples de
 * fechamento, ritmo recente e avisos. Só leitura: não altera a esperada.
 */
export function ReferenciasAnteriores({
  model,
  rows,
  date,
  base,
  lead,
  closed,
  booked,
  capacity,
  diariaAtual,
  precoVenda,
  leadLabel,
  rowsFor,
}: {
  model: PaceModel;
  /** Linhas (data × categoria) da data analisada: as mesmas que a esperada usa. */
  rows: PaceRow[];
  date: string;
  base: string;
  lead: number;
  /** Data já encerrada (D-0): sem projeção nem ritmo recente. */
  closed: boolean;
  /** Veículos reservados hoje e frota atual da data (para projetar o fechamento). */
  booked: number | null;
  capacity: number;
  /** Diária média de hoje (do que já foi vendido). */
  diariaAtual: number | null;
  /** Nossa tarifa de venda atual para a data (e categorias); null/ausente = ainda sem tarifa lida. */
  precoVenda?: PrecoVenda | null;
  leadLabel: string;
  /** Linhas (data × categoria) de uma data histórica: as categorias da análise atual. */
  rowsFor: (date: string) => PaceRow[];
}) {
  const ref = referenceDates(model, date, base);
  // Os mesmos números e as mesmas referências que a esperada usa (ocupação ÷ frota da época, faturamento por veículo).
  const todos = referenceItems(model, rows, date, base, lead);
  const de = model.payload.de;
  const itens = ref.datas.map((dt) => ({
    dt,
    it: todos.find((i) => i.date === dt),
    r: revenueOf(rowsFor(dt), lead),
  }));
  const titulo = ref.evento
    ? `${EVENT_LABEL[ref.evento]} (${ref.posicao! > 0 ? "+" : ""}${ref.posicao} dias) em edições anteriores`
    : "Mesmo dia da semana em períodos anteriores";
  const usada = todos.find((i) => i.chosen);
  const diariaUsada = usada ? diariaEmL(usada.hist, lead) : null;
  const ritmo = (dias: number) => ({
    hoje: closed ? null : ritmoRecente(rows, lead, dias),
    refs: itens.map(({ dt, it }) => ({
      ano: dt.slice(0, 4),
      v: closed || !it ? null : ritmoRecente(it.hist, lead, dias, { date: dt, de }),
    })),
  });
  return (
    <Card className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold">
        {titulo} · {leadLabel}
      </h3>
      {itens.length === 0 ? (
        <p className="text-muted-foreground">Sem edição anterior comparável.</p>
      ) : (
        <div className="space-y-3">
          {itens.map(({ dt, it }, i) => {
            const aviso = it ? avisoFrota(it.fleet, it.fleetAtual) : null;
            const proj = it && !closed && booked != null ? projecaoFechamento(it, booked, capacity, diariaAtual) : null;
            const diariaRef = it ? diariaEmL(it.hist, lead) : null;
            const lotou = it?.chosen ? lotouEm(it.hist) : null;
            const fora = it ? rows.filter((r) => !it.hist.some((h) => h.c === r.c)).map((r) => r.c) : [];
            const ano = dt.slice(0, 4);
            return (
              <div
                key={dt}
                className={`space-y-2 rounded-md border p-3 ${it?.chosen ? "border-primary/60 bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {ref.evento ? `Edição de ${ano}` : i === 0 ? "1 ano antes" : "2 anos antes"}
                    <span className="ml-1 font-normal text-muted-foreground">({dataBR(dt)})</span>
                  </span>
                  {it?.chosen ? (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                      usada na esperada
                    </span>
                  ) : null}
                </div>
                {it?.occ == null || it.occFinal == null ? (
                  <p className="text-xs text-muted-foreground">Sem dado</p>
                ) : (
                  <>
                    <div className="tabular-nums">
                      <span className="font-medium">{pct(it.occ)}</span> · {carros(it.occ, it.fleet)} de {it.fleet} em{" "}
                      {leadLabel} →{" "}
                      <span className="font-medium">{pct(it.occFinal)}</span> · {carros(it.occFinal, it.fleet)} de {it.fleet}{" "}
                      final
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                      <Campo rotulo="Ganho até a data" valor={ganho(ganhoAteData(it))} />
                      <Campo rotulo="Diária média final" valor={usd(it.revFinal != null ? revenueOf(it.hist).diaria : null)} />
                      <Campo rotulo={`Diária média ${leadLabel}`} valor={usd(diariaRef)} />
                      <Campo rotulo="Fat./veículo final" valor={usd(it.revFinal)} />
                      <Campo rotulo={`Fat./veículo ${leadLabel}`} valor={usd(it.rev)} />
                      <Campo rotulo={`Diária de hoje vs ${leadLabel}`} valor={dif(difDiariaPct(diariaAtual, diariaRef))} />
                    </dl>
                    <div className="text-xs text-muted-foreground">
                      Frota: {it.fleet} na época · {it.fleetAtual} hoje (mesmas categorias)
                      {fora.length ? ` · sem: ${fora.join(", ")}` : ""}
                    </div>
                    {proj ? (
                      <div className="rounded bg-muted/50 p-2 text-xs">
                        <div>
                          No ritmo de {ano} ({sinal(proj.ganhoCarros)} carros): fecha em ~{proj.fechaCarros} de {capacity} (
                          {pct(proj.fechaOcc)})
                          {proj.revPorVeiculo != null ? ` · fat./veículo projetado ${usd(proj.revPorVeiculo)}` : ""}
                        </div>
                        <div className="text-muted-foreground">
                          Projeção simples (ocupação atual + ganho dessa referência), não é uma previsão.
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
                {aviso ? <Aviso>Atenção: {aviso}</Aviso> : null}
                {lotou != null ? (
                  <Aviso>
                    Referência lotou em D-{lotou}: pode indicar preço baixo ou demanda reprimida.
                  </Aviso>
                ) : null}
                {it && !it.eligible && it.motivo ? <Aviso>Fora da esperada: {it.motivo}</Aviso> : null}
              </div>
            );
          })}
          <div className="space-y-0.5 text-xs">
            <div className="font-medium">Ritmo recente (diárias ativas criadas, em carros)</div>
            {closed ? (
              <div className="text-muted-foreground">Dados indisponíveis: data já encerrada.</div>
            ) : (
              [7, 14].map((dias) => {
                const r = ritmo(dias);
                return (
                  <div key={dias} className="tabular-nums text-muted-foreground">
                    Últimos {dias} dias: <span className="text-foreground">{sinal(r.hoje)}</span>
                    {r.refs.map((x) => (
                      <span key={x.ano}>
                        {" "}
                        · {x.ano}: {x.v == null ? "indisponível" : sinal(x.v)}
                      </span>
                    ))}
                  </div>
                );
              })
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {precoVenda ? (
              <>
                Preço de venda atual (tarifa do site): <span className="text-foreground">{usd(precoVenda.valor)}</span>
                {precoVenda.total > 1
                  ? ` (média pela frota, ${precoVenda.cobertas} de ${precoVenda.total} categorias com tarifa)`
                  : ""}
                {diariaAtual != null ? ` · ${dif(difDiariaPct(precoVenda.valor, diariaAtual))} contra a diária já vendida` : ""}
                {usada && diariaUsada != null
                  ? ` · ${dif(difDiariaPct(precoVenda.valor, diariaUsada))} contra ${usada.date.slice(0, 4)} em ${leadLabel}`
                  : ""}
              </>
            ) : (
              "Preço de venda atual: sem tarifa lida para esta data."
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
