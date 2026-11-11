import type { Faixa } from "@/lib/occupancy-detail";
import { dataBR, pct } from "@/lib/pricing-format";

/** Faixa entre a menor e a maior ocupação das referências, com a posição da atual (escala 0–100%). */
export function FaixaReferencias({ faixa, atual }: { faixa: Faixa; atual: number | null }) {
  const pos = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className="space-y-1 text-xs">
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className="absolute h-2 rounded-full bg-muted-foreground/40"
          style={{ left: pos(faixa.min.occ), width: `${(faixa.max.occ - faixa.min.occ) * 100}%` }}
        />
        {atual != null ? (
          <div
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
            style={{ left: pos(atual) }}
            title={`Atual ${pct(atual)}`}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>
          {faixa.min.date.slice(0, 4)}: {pct(faixa.min.occ)} <span className="opacity-70">({dataBR(faixa.min.date)})</span>
        </span>
        <span>
          {faixa.max.date.slice(0, 4)}: {pct(faixa.max.occ)} <span className="opacity-70">({dataBR(faixa.max.date)})</span>
        </span>
      </div>
    </div>
  );
}
