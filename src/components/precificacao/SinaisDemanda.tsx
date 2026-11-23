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
  "Fechar categoria de entrada": 1,
  "Abrir categorias / promoção": 2,
  "Revisar preço / testar redução": 3,
  "Revisar desconto de última hora": 4,
};

/**
 * Ações da análise Demanda & Preço (Orlando) no topo da Prioridades. Cada ação de um mês leva a fila
 * para aquela categoria e mês; as de padrão (últimos 12 meses) só informam.
 */
export function SinaisDemanda({
  onVer,
}: {
  onVer: (categoria: string | null, mes: string) => void;
}) {
  const q = useDemandaPreco();
  if (q.isLoading || q.error || !q.dados || q.dados.al.length === 0) return null;
  const lista: Alerta[] = [...q.dados.al].sort(
    (a, b) => (ORDEM_ACAO[a.acao] ?? 9) - (ORDEM_ACAO[b.acao] ?? 9) || a.mes.localeCompare(b.mes),
  );
  return (
    <TooltipProvider delayDuration={100}>
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="size-4 text-primary" />
          <h2 className="font-semibold">Sinais de demanda e preço</h2>
          <span className="text-xs text-muted-foreground">Orlando · {lista.length}</span>
          <InfoTip>
            Vêm da aba Demanda & Preço: pickup por categoria vs o mesmo ponto do ano anterior, ADR,
            sazonalidade do mercado (NTTO), share e antecedência. São sinais de mês/categoria; a
            fila abaixo continua decidindo data a data. &quot;Ver na fila&quot; filtra a fila na
            categoria e no mês do sinal.
          </InfoTip>
        </div>
        <ul className="divide-y divide-border text-sm">
          {lista.map((a, i) => {
            const mensal = /^\d{4}-\d{2}$/.test(a.mes);
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{mesTxt(a.mes)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b>{a.acao}</b>
                  <span className="text-muted-foreground">
                    {" "}
                    · {a.categoria === TODAS ? "todas as categorias" : nomeCategoria(a.categoria)}
                  </span>
                </span>
                <InfoTip label="Motivo">{a.motivo}</InfoTip>
                {mensal ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onVer(a.categoria === TODAS ? null : a.categoria, a.mes)}
                  >
                    Ver na fila <ArrowRight className="ml-1 size-3" />
                  </Button>
                ) : (
                  <span className="w-[88px]" />
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </TooltipProvider>
  );
}
