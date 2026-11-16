import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EVENT_LABEL,
  avisoFrota,
  ganhoAteData,
  windowAnalysis,
  referenceDates,
  revenueOf,
  type PaceModel,
  type PaceRow,
} from "@/lib/occupancy-pace";
import {
  type PrecoVenda,
  carros,
  difDiariaPct,
  diariaEmL,
  lotacaoAvisavel,
  metaCarros,
  projecaoFechamento,
  ritmoRecente,
} from "@/lib/occupancy-detail";
import { dataBR, pct, usd } from "@/lib/pricing-format";
import { quebraAntecedencia, vendasRecentes } from "@/lib/preco-analise";
import { TabelaFaixasAntecedencia } from "@/components/precificacao/DiagnosticoPreco";

const ganho = (pp: number | null) =>
  pp == null ? "—" : `${pp >= 0 ? "+" : ""}${pp.toFixed(1).replace(".", ",")} p.p.`;
const sinal = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}`);
/** Dólar com centavos: a escolha do ano pode se decidir em centavos, que o valor inteiro esconde. */
const usd2 = (v: number | null) =>
  v == null
    ? "—"
    : `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dif = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`);

const Aviso = ({ children }: { children: ReactNode }) => (
  <li className="text-amber-700 dark:text-amber-300">{children}</li>
);

/** Tabela comparativa: uma coluna por ano, uma linha por medida. */
function Tabela({
  colunas,
  linhas,
}: {
  colunas: { chave: string; titulo: ReactNode }[];
  linhas: { rotulo: string; celulas: ReactNode[]; forte?: boolean }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left">
            <th className="py-1 pr-3 font-normal text-muted-foreground" />
            {colunas.map((c) => (
              <th key={c.chave} className="px-2 py-1 font-medium">
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t">
              <td className="py-1.5 pr-3 text-muted-foreground">{l.rotulo}</td>
              {l.celulas.map((c, i) => (
                <td
                  key={colunas[i]!.chave}
                  className={`px-2 py-1.5 ${l.forte ? "font-medium" : ""}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Secao = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <section className="space-y-1.5">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {titulo}
    </h4>
    {children}
  </section>
);

/**
 * Detalhes da data em três abas: (1) referências lado a lado (o mesmo dia da semana 1 e 2 anos antes, ou, em evento móvel, a mesma
 * posição nas edições anteriores) com o resumo da janela que escolhe o ano; (2) vendas por antecedência, ritmo e diária das vendas
 * recentes; (3) preço de venda atual e os dados da data. Só leitura: nenhum cálculo novo.
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
  lotacaoLimite = 14,
  dadosDaData,
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
  /** Linhas de uma data histórica (não é mais usado aqui; mantido para os chamadores). */
  rowsFor?: (date: string) => PaceRow[];
  /** Só avisa que a referência lotou em D-X quando X é maior que isto (dias). */
  lotacaoLimite?: number;
  /** Bloco de dados da data (reservados, capacidade, sazonalidade…), mostrado na última aba. */
  dadosDaData?: ReactNode;
}) {
  const ref = referenceDates(model, date, base);
  const { items: todos, janela } = windowAnalysis(model, rows, date, base, lead);
  const de = model.payload.de;
  const itens = ref.datas.map((dt) => ({
    dt,
    ano: dt.slice(0, 4),
    it: todos.find((i) => i.date === dt),
  }));
  const titulo = ref.evento
    ? `${EVENT_LABEL[ref.evento]} (${ref.posicao! > 0 ? "+" : ""}${ref.posicao} dias) em edições anteriores`
    : "Mesmo dia da semana em períodos anteriores";
  const usada = todos.find((i) => i.chosen);
  const diariaUsada = usada ? diariaEmL(usada.hist, lead) : null;

  const colRefs = itens.map(({ dt, ano, it }) => ({
    chave: dt,
    titulo: (
      <span>
        {ano} <span className="font-normal text-muted-foreground">({dataBR(dt).slice(0, 5)})</span>
        {it?.chosen ? (
          <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary">
            escolhido
          </span>
        ) : null}
      </span>
    ),
  }));
  const colHojeRefs = [{ chave: "hoje", titulo: "Hoje" }, ...colRefs];

  // 1. Referências lado a lado
  const sem = (it: (typeof itens)[number]["it"]) => !it || it.occ == null || it.occFinal == null;
  const linhasRefs = [
    {
      rotulo: `Ocupação em ${leadLabel}`,
      forte: true,
      celulas: itens.map(({ it }) =>
        sem(it) ? "—" : `${pct(it!.occ)} · ${carros(it!.occ!, it!.fleet)} de ${it!.fleet}`,
      ),
    },
    {
      rotulo: "Ocupação final",
      celulas: itens.map(({ it }) =>
        sem(it)
          ? "—"
          : `${pct(it!.occFinal)} · ${carros(it!.occFinal!, it!.fleet)} de ${it!.fleet}`,
      ),
    },
    {
      rotulo: "Ganho até a data",
      celulas: itens.map(({ it }) => (sem(it) ? "—" : ganho(ganhoAteData(it!)))),
    },
    {
      rotulo: "Diária média final",
      celulas: itens.map(({ it }) =>
        sem(it) ? "—" : usd(it!.revFinal != null ? revenueOf(it!.hist).diaria : null),
      ),
    },
    {
      rotulo: `Diária média ${leadLabel}`,
      celulas: itens.map(({ it }) => (sem(it) ? "—" : usd(diariaEmL(it!.hist, lead)))),
    },
    {
      rotulo: "Fat./veículo final",
      celulas: itens.map(({ it }) => (sem(it) ? "—" : usd(it!.revFinal))),
    },
    {
      rotulo: `Fat./veículo ${leadLabel}`,
      celulas: itens.map(({ it }) => (sem(it) ? "—" : usd(it!.rev))),
    },
    // Média da semana (janela): é o que decide o ano escolhido e a esperada, não o dia sozinho.
    {
      rotulo: `Fat./veículo final · média da janela (${janela.diasComuns} dias comuns)`,
      forte: true,
      celulas: itens.map(({ ano }) =>
        usd2(janela.anos.find((a) => a.label === ano)?.revMedio ?? null),
      ),
    },
    {
      rotulo: `Ocupação em ${leadLabel} · média da janela`,
      forte: true,
      celulas: itens.map(({ ano }) => {
        const o = janela.anos.find((a) => a.label === ano)?.occMedia ?? null;
        return o == null ? "—" : pct(o);
      }),
    },
    {
      rotulo: `Diária vendida vs ref. ${leadLabel}`,
      celulas: itens.map(({ it }) =>
        sem(it) ? "—" : dif(difDiariaPct(diariaAtual, diariaEmL(it!.hist, lead))),
      ),
    },
    {
      rotulo: "Frota (época · hoje)",
      celulas: itens.map(({ it }) => (it && it.fleet ? `${it.fleet} · ${it.fleetAtual}` : "—")),
    },
    {
      rotulo: "Meta em carros (só informação)",
      celulas: itens.map(({ it }) => {
        const m = it ? metaCarros(it.carros, it.fleetAtual) : null;
        return m ? `${m.carros} carros = ${pct(m.pct)} da frota atual (${m.frota})` : "—";
      }),
    },
    ...(closed
      ? []
      : [
          {
            rotulo: "Projeção de fechamento",
            celulas: itens.map(({ it }) => {
              const p =
                it && booked != null ? projecaoFechamento(it, booked, capacity, diariaAtual) : null;
              return p
                ? `~${p.fechaCarros} de ${capacity} (${pct(p.fechaOcc)})${p.ganhoCarros ? ` · ${sinal(p.ganhoCarros)} carros` : ""}`
                : "—";
            }),
          },
        ]),
  ];
  const avisos = itens.flatMap(({ ano, it }) => {
    if (!it) return [];
    const out: string[] = [];
    const a = avisoFrota(it.fleet, it.fleetAtual);
    if (a) out.push(`${ano}: ${a}.`);
    const lotou = it.chosen ? lotacaoAvisavel(it.hist, lotacaoLimite) : null;
    if (lotou != null)
      out.push(
        `${ano}: referência lotou em D-${lotou}; pode indicar preço baixo ou demanda reprimida.`,
      );
    if (!it.eligible && it.motivo) out.push(`${ano}: fora da esperada (${it.motivo}).`);
    const fora = rows.filter((r) => !it.hist.some((h) => h.c === r.c)).map((r) => r.c);
    if (fora.length) out.push(`${ano}: sem dados de ${fora.join(", ")}.`);
    return out;
  });

  // 2. Vendas: ritmo e diária das vendas recentes
  const ritmoLinha = (dias: number) => ({
    rotulo: `Últimos ${dias} dias`,
    celulas: [
      closed ? "—" : sinal(ritmoRecente(rows, lead, dias)),
      ...itens.map(({ dt, it }) =>
        closed || !it ? "—" : sinal(ritmoRecente(it.hist, lead, dias, { date: dt, de })),
      ),
    ],
  });
  const txtVendas = (x: { carros: number; diaria: number | null } | null) =>
    x == null ? "—" : `${usd(x.diaria)} (${x.carros} ${x.carros === 1 ? "carro" : "carros"})`;
  const vendasLinha = (dias: number) => ({
    rotulo: `Últimos ${dias} dias`,
    celulas: [
      closed ? "—" : txtVendas(vendasRecentes(rows, lead, dias)),
      ...itens.map(({ dt, it }) =>
        closed || !it ? "—" : txtVendas(vendasRecentes(it.hist, lead, dias, { date: dt, de })),
      ),
    ],
  });
  const colunasFaixas = [
    { titulo: "Atual", q: rows.length ? quebraAntecedencia(rows, closed ? 0 : lead) : null },
    ...itens.map(({ ano, it }) => ({
      titulo: ano,
      q: it && it.hist.length ? quebraAntecedencia(it.hist) : null,
    })),
  ];

  return (
    <Card className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold">
        {titulo} · {leadLabel}
      </h3>
      <Tabs defaultValue="refs">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="refs">Referências</TabsTrigger>
          <TabsTrigger value="vendas">Vendas e ritmo</TabsTrigger>
          <TabsTrigger value="preco">Preço e data</TabsTrigger>
        </TabsList>

        <TabsContent value="refs" className="space-y-4 pt-3">
          {janela.escolhido ? (
            <div className="space-y-0.5 rounded-md bg-muted/50 p-2 text-xs tabular-nums">
              <div>
                Ano escolhido pela janela {dataBR(janela.dias[0]!).slice(0, 5)}–
                {dataBR(janela.dias[janela.dias.length - 1]!).slice(0, 5)}:{" "}
                <span className="font-medium">{janela.escolhido.label}</span>{" "}
                {janela.criterio === "faturamento"
                  ? `(fat./veículo médio ${usd2(janela.escolhido.revMedio)}${janela.outro ? ` contra ${usd2(janela.outro.revMedio)}` : ""}, em ${janela.diasComuns} dias comuns)`
                  : `(sem faturamento em todos os anos: ocupação final média ${pct(janela.escolhido.occFinalMedia)}${janela.outro ? ` contra ${pct(janela.outro.occFinalMedia)}` : ""})`}
              </div>
              <div>
                Esperada = média de {janela.usados.length}{" "}
                {janela.usados.length === 1 ? "dia" : "dias"} da janela
                {janela.esperada != null ? ` (${pct(janela.esperada)})` : ""}
              </div>
              {(() => {
                const m = metaCarros(janela.carros, janela.fleetAtual);
                return m ? (
                  <div className="text-muted-foreground">
                    Meta em carros (só informação): {janela.escolhido.label} teve em média{" "}
                    {m.carros} carros nos dias da janela; repetir isso daria {pct(m.pct)} da frota
                    atual ({m.frota})
                  </div>
                ) : null;
              })()}
            </div>
          ) : null}
          {itens.length === 0 ? (
            <p className="text-muted-foreground">Sem edição anterior comparável.</p>
          ) : (
            <>
              <Secao titulo="Referências do próprio dia, lado a lado">
                <Tabela colunas={colRefs} linhas={linhasRefs} />
                <p className="text-[11px] text-muted-foreground">
                  As linhas em negrito "média da janela" são o que decide: o ano escolhido é o de
                  maior fat./veículo final médio nos dias comuns da janela, e a esperada é a
                  ocupação média dele. As demais linhas são só o dia {dataBR(date)}.
                </p>
              </Secao>
              {avisos.length ? (
                <Secao titulo="Avisos">
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">
                    {avisos.map((a) => (
                      <Aviso key={a}>{a}</Aviso>
                    ))}
                  </ul>
                </Secao>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="vendas" className="space-y-4 pt-3">
          <Secao titulo="Vendas por faixa de antecedência">
            <TabelaFaixasAntecedencia colunas={colunasFaixas} />
          </Secao>
          <Secao titulo="Ritmo recente (reservas ativas criadas, em carros)">
            {closed ? (
              <p className="text-xs text-muted-foreground">
                Dados indisponíveis: data já encerrada.
              </p>
            ) : (
              <Tabela colunas={colHojeRefs} linhas={[ritmoLinha(7), ritmoLinha(14)]} />
            )}
          </Secao>
          <Secao titulo="Diária das vendas recentes (reservas criadas nos últimos dias, confirmadas hoje)">
            {closed ? (
              <p className="text-xs text-muted-foreground">
                Dados indisponíveis: data já encerrada.
              </p>
            ) : (
              <Tabela colunas={colHojeRefs} linhas={[vendasLinha(7), vendasLinha(14)]} />
            )}
          </Secao>
        </TabsContent>

        <TabsContent value="preco" className="space-y-4 pt-3">
          <Secao titulo="Preço de venda atual">
            {precoVenda ? (
              <div className="space-y-0.5 text-xs">
                <div>
                  Tarifa de tabela do site:{" "}
                  <span className="text-sm font-medium">{usd(precoVenda.valor)}</span>
                  {precoVenda.total > 1
                    ? ` (média pela frota, ${precoVenda.cobertas} de ${precoVenda.total} categorias com tarifa)`
                    : ""}
                </div>
                {diariaAtual != null ? (
                  <div className="tabular-nums text-muted-foreground">
                    Já vendido em média: {usd(diariaAtual)} · tarifa{" "}
                    {dif(difDiariaPct(precoVenda.valor, diariaAtual))}
                  </div>
                ) : null}
                {usada && diariaUsada != null ? (
                  <div className="tabular-nums text-muted-foreground">
                    {usada.date.slice(0, 4)} em {leadLabel} (ano escolhido): {usd(diariaUsada)} ·
                    tarifa {dif(difDiariaPct(precoVenda.valor, diariaUsada))}
                  </div>
                ) : null}
                <div className="text-muted-foreground">
                  A tarifa é preço de tabela e a diária vendida é o valor pago: a comparação mostra
                  a direção, não a diferença exata.
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem tarifa lida para esta data.</p>
            )}
          </Secao>
          {dadosDaData ? <Secao titulo="Dados da data">{dadosDaData}</Secao> : null}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
