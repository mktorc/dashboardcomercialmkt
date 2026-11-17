import { useState } from "react";
import { Ajuda, AjudaItem } from "@/components/precificacao/Ajuda";
import { Card } from "@/components/ui/card";
import type { CelulaMatriz } from "@/lib/decisao";
import { MARKET_BUCKETS, MARKET_LABEL, MATRIX_TEXT, OCC_BUCKETS } from "@/lib/prioridades";

type OccBucket = CelulaMatriz["occ"];
type MarketBucket = CelulaMatriz["market"];

const OCC_LABEL: Record<OccBucket, string> = {
  abaixo: "Abaixo do esperado",
  neutro: "Dentro do esperado",
  acima: "Acima do esperado",
};

const CELL_TONE: Record<OccBucket, Record<MarketBucket, string>> = {
  abaixo: {
    acima: "bg-red-500/20 border-red-500/50",
    alinhado: "bg-orange-400/15 border-orange-400/50",
    abaixo: "bg-orange-400/15 border-orange-400/50",
    "sem-dados": "bg-muted border-border",
  },
  neutro: {
    acima: "bg-card border-border",
    alinhado: "bg-card border-border",
    abaixo: "bg-card border-border",
    "sem-dados": "bg-card border-border",
  },
  acima: {
    acima: "bg-emerald-500/10 border-emerald-500/40",
    alinhado: "bg-emerald-500/10 border-emerald-500/40",
    abaixo: "bg-sky-500/20 border-sky-500/50",
    "sem-dados": "bg-muted border-border",
  },
};

function AjudaMatriz() {
  return (
    <Ajuda titulo="Ocupação × preço">
      <p>
        Cruza dois sinais de cada data × categoria: a <b>ocupação</b> contra o esperado (linhas) e o{" "}
        <b>preço</b> contra o mercado (colunas). Cada número é a quantidade de datas × categorias
        naquela combinação. Ocupação pela tolerância da Gestão de Ocupação; preço ±5% da mediana
        (diária de cada noite).
      </p>
      <p>Clique numa célula para ver a leitura sugerida e o que investigar:</p>
      <AjudaItem nome="Abaixo do esperado + preço acima">
        possível perda de competitividade: avaliar a tarifa, conferindo se as ofertas dos
        concorrentes são equivalentes.
      </AjudaItem>
      <AjudaItem nome="Abaixo + preço alinhado ou abaixo">
        o preço sozinho não explica: investigar demanda, canais e disponibilidade. Reduzir mais o
        preço não é o primeiro passo.
      </AjudaItem>
      <AjudaItem nome="Acima do esperado + preço abaixo">
        possível espaço para aumento gradual de tarifa (oportunidade).
      </AjudaItem>
      <AjudaItem nome="Acima + preço acima">
        demanda forte: preservar o posicionamento e monitorar.
      </AjudaItem>
      <AjudaItem nome="Sem dados de mercado">
        não há comparação de preço confiável: nenhuma conclusão sobre preço é tirada .
      </AjudaItem>
      <p>
        São hipóteses para investigar, não causas confirmadas. Datas sem benchmark de ocupação ficam
        fora da matriz.
      </p>
    </Ajuda>
  );
}

/** Matriz ocupação × preço (análise): clique numa célula para a leitura sugerida. */
export function MatrizOcupacaoPreco({
  mx,
}: {
  mx: { cells: CelulaMatriz[]; semBenchmark: number };
}) {
  const [pick, setPick] = useState<{ occ: OccBucket; market: MarketBucket } | null>(null);
  const cell = (o: OccBucket, m: MarketBucket) =>
    mx.cells.find((c) => c.occ === o && c.market === m)!;
  const cur = pick ?? mx.cells.filter((c) => c.count).sort((a, b) => b.count - a.count)[0] ?? null;
  const txt = cur ? MATRIX_TEXT[cur.occ][cur.market] : null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Ocupação × preço</h2>
        <AjudaMatriz />
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[420px] grid-cols-[110px_repeat(4,1fr)] gap-1.5 text-xs">
          <div />
          {MARKET_BUCKETS.map((m) => (
            <div key={m} className="px-1 text-center text-muted-foreground">
              {MARKET_LABEL[m]}
            </div>
          ))}
          {OCC_BUCKETS.map((o) => (
            <div key={o} className="contents">
              <div className="flex items-center text-muted-foreground">{OCC_LABEL[o]}</div>
              {MARKET_BUCKETS.map((m) => {
                const c = cell(o, m);
                const active = cur?.occ === o && cur.market === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPick({ occ: o, market: m })}
                    className={`rounded border p-2 text-center ${CELL_TONE[o][m]} ${active ? "ring-2 ring-foreground" : ""} ${c.count ? "" : "opacity-50"}`}
                  >
                    <div className="text-xl font-semibold tabular-nums">{c.count}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {txt && cur ? (
        <div className="space-y-1 rounded border border-border p-3 text-sm">
          <p className="font-medium">{txt.leitura}</p>
          <p className="text-muted-foreground">Investigar: {txt.investigar}</p>
          <p className="text-xs text-muted-foreground">
            Leitura sugerida a partir de dois sinais; não confirma causa.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem datas com benchmark neste recorte.</p>
      )}
      {mx.semBenchmark ? (
        <p className="text-xs text-muted-foreground">
          {mx.semBenchmark} data×categoria sem sinal de ocupação não entram na matriz.
        </p>
      ) : null}
    </Card>
  );
}
