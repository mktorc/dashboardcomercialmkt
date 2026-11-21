// Configuração editável da Gestão de Frota.
import type { Region } from "@/lib/frota";

// Hierarquia de upgrade, do menor para o maior. Cada nível lista os nomes EXATOS das categorias no HQ
// (campo class_label de fleet_vehicles). O upgrade sugerido é sempre para o nível imediatamente acima;
// sem carro livre nele, tenta o seguinte ("upgrade de 2 níveis") e assim por diante.
//
// Categorias no MESMO nível são intercambiáveis: trocar uma pela outra conta como troca, não upgrade.
// Fora da hierarquia (não dá nem recebe upgrade): "Van 12 Seats" (público de grupos).
export const CATEGORY_RANK: { label: string; hq: string[] }[] = [
  { label: "Sedan", hq: ["Midsize Sedan"] },
  { label: "SUV Médio", hq: ["Midsize Suv"] },
  { label: "Fullsize", hq: ["Fullsize Suv"] },
  { label: "Minivan", hq: ["Mini Van 8 Seats"] },
  { label: "SUV Executive", hq: ["SUV Executive 8 Seats", "SUV Executive 7 Seats"] },
  { label: "Luxury", hq: ["Luxury"] },
];

/** Posição da categoria na hierarquia (0 = menor) ou null se ela está fora. */
export function categoryRank(classLabel: string | null | undefined): number | null {
  if (!classLabel) return null;
  const k = classLabel.trim().toLowerCase();
  const i = CATEGORY_RANK.findIndex((lvl) => lvl.hq.some((n) => n.toLowerCase() === k));
  return i < 0 ? null : i;
}

/** Cor de cada cidade na linha do tempo e no saldo. */
export const REGION_COLOR: Record<Region, string> = {
  Orlando: "#8b5cf6", // violeta
  Miami: "#ec4899", // rosa
};

/** Sigla curta usada nas setas ("MIA → MCO"). */
export const REGION_SHORT: Record<Region, string> = {
  Orlando: "MCO",
  Miami: "MIA",
};
