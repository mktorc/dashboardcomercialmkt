import { ArrowRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TODAS, nomeCategoria, type Alerta } from "@/lib/demanda-preco";
import { InfoTip } from "@/components/precificacao/DemandaPreco";
import { useDemandaPreco } from "@/components/precificacao/useDemandaPreco";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesTxt = (m: string) =>
  /^\d{4}-\d{2}$/.test(m) ? `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}` : m;

/** Ordem de leitura: primeiro o que mexe em preço/abertura de um mês, depois os padrões de 12 meses. */
const ORDEM_ACAO: Record<string, number> = {
  "Subir preço da categoria": 0,
  "Parar de vender o carro mais barato": 1,
  "Fazer promoção (vendas fracas)": 2,
  "Revisar preço / testar redução": 3,
  "Revisar desconto de última hora": 4,
};

/**
 * Ações da análise Demanda & Preço (Orlando) no topo da Prioridades. Cada ação de um mês leva a fila
 * para aquela categoria e mês; as de padrão (últimos 12 meses) só informam.
 */
export function SinaisDemanda({
  onVer,
  periodo,
  categoria,
}: {
  onVer: (categoria: string | null, mes: string) => void;
  periodo: { from: string; to: string };
  categoria: string | null;
}) {
  const q = useDemandaPreco();
  if (q.isLoading || q.error || !q.dados || q.dados.al.length === 0) return null;
  const lista: Alerta[] = [...q.dados.al].sort(
    (a, b) => (ORDEM_ACAO[a.acao] ?? 9) - (ORDEM_ACAO[b.acao] ?? 9) || a.mes.localeCompare(b.mes),
  );
  const catTxt = (c: string) => (c === TODAS ? "todas as categorias" : nomeCategoria(c));
  // Acompanha o filtro: meses que o período de retirada cobre e, se houver, a categoria filtrada.
  const janela: string[] = [];
  for (let m = periodo.from.slice(0, 7); m <= periodo.to.slice(0, 7); ) {
    janela.push(m);
    const [y, mm] = m.split("-").map(Number) as [number, number];
    m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
  }
  const daCat = (c: string) =>
    !categoria || c === TODAS || nomeCategoria(c) === nomeCategoria(categoria);
  const mensais = lista.filter((a) => janela.includes(a.mes) && daCat(a.categoria));
  // Números do mês sem gatilho, para mostrar por que não houve sinal (vs mesma data do ano anterior).
  const resumoMes = (m: string) => {
    const p = q.dados!.pk.find(
      (x) =>
        x.mes === m &&
        (categoria
          ? x.categoria !== TODAS && nomeCategoria(x.categoria) === nomeCategoria(categoria)
          : x.categoria === TODAS),
    );
    if (!p) return null;
    if (p.otbAnoAnterior == null) return `${p.otb} reservas · sem ano anterior para comparar`;
    const adr =
      p.adr != null && p.adrAnoAnterior
        ? ` · ADR ${p.adr >= p.adrAnoAnterior ? "+" : ""}${((p.adr / p.adrAnoAnterior - 1) * 100).toFixed(0)}%`
        : "";
    return `${p.otb} reservas vs ${p.otbAnoAnterior} no ano anterior${adr}`;
  };
  const semSinal = janela.filter((m) => !mensais.some((a) => a.mes === m));
  // Padrões de 12 meses: agrupa a mesma ação numa linha só, com as categorias e os motivos juntos.
  const padroes = new Map<string, Alerta[]>();
  for (const a of lista) {
    if (/^\d{4}-\d{2}$/.test(a.mes) || !daCat(a.categoria)) continue;
    padroes.set(a.acao, [...(padroes.get(a.acao) ?? []), a]);
  }
  return (
    <TooltipProvider delayDuration={100}>
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="size-4 text-primary" />
          <h2 className="font-semibold">Sinais de demanda e preço</h2>
          <span className="text-xs text-muted-foreground">Orlando</span>
          <InfoTip>
            Vêm da aba Demanda & Preço: reservas por categoria vs a mesma data do ano anterior, ADR,
            sazonalidade do mercado (NTTO), share e antecedência. São sinais de mês/categoria; a
            fila abaixo continua decidindo data a data. &quot;Ver na fila&quot; filtra a fila na
            categoria e no mês do sinal.
          </InfoTip>
        </div>

        {janela.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              No período filtrado
            </p>
            <ul className="divide-y divide-border text-sm">
              {mensais.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-1.5">
                  <span className="w-14 shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-xs font-medium">
                    {mesTxt(a.mes)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{a.acao}</b>
                    <span className="text-muted-foreground"> · {catTxt(a.categoria)}</span>
                  </span>
                  <InfoTip label="Por quê">{a.motivo}</InfoTip>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => onVer(a.categoria === TODAS ? null : a.categoria, a.mes)}
                  >
                    Ver na fila <ArrowRight className="ml-1 size-3" />
                  </Button>
                </li>
              ))}
              {semSinal.map((m) => (
                <li key={m} className="flex items-center gap-3 py-1.5 text-muted-foreground">
                  <span className="w-14 shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-xs font-medium text-foreground">
                    {mesTxt(m)}
                  </span>
                  <span className="flex-1 truncate">
                    Sem sinal · seguir a fila
                    {resumoMes(m) && <span className="text-xs"> · {resumoMes(m)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {padroes.size > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Padrões dos últimos 12 meses
            </p>
            <ul className="divide-y divide-border text-sm">
              {[...padroes.entries()].map(([acao, itens]) => (
                <li key={acao} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <b>{acao}</b>
                    <span className="text-muted-foreground">
                      {" "}
                      · {itens.length === 1 ? catTxt(itens[0]?.categoria ?? TODAS) : `${itens.length} categorias`}
                    </span>
                  </span>
                  <InfoTip label="Por quê">
                    {itens.map((a, i) => (
                      <span key={i} className="block">
                        {itens.length > 1 && <b>{catTxt(a.categoria)}: </b>}
                        {a.motivo}
                      </span>
                    ))}
                  </InfoTip>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </TooltipProvider>
  );
}
