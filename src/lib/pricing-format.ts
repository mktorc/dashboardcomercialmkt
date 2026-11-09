import type { GapLevel } from "./occupancy-pace";

/** Formatação e cores compartilhadas pelas telas de precificação. */
export const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
export const gapTxt = (g: number | null) =>
  g == null ? "—" : `${g > 0 ? "+" : ""}${g.toFixed(0)} p.p.`;
export const dataBR = (iso: string) => iso.split("-").reverse().join("/");

export const LEVEL: Record<GapLevel, { card: string; text: string; label: string }> = {
  "muito-abaixo": {
    card: "border-red-500/60 bg-red-500/20",
    text: "text-red-700 dark:text-red-300",
    label: "Muito abaixo",
  },
  abaixo: {
    card: "border-orange-400/50 bg-orange-400/15",
    text: "text-orange-700 dark:text-orange-300",
    label: "Abaixo do esperado",
  },
  neutro: {
    card: "border-border bg-card",
    text: "text-muted-foreground",
    label: "Dentro do esperado",
  },
  acima: {
    card: "border-green-500/40 bg-green-500/10",
    text: "text-green-700 dark:text-green-300",
    label: "Acima do esperado",
  },
  "muito-acima": {
    card: "border-green-600/60 bg-green-600/25",
    text: "text-green-800 dark:text-green-200",
    label: "Muito acima",
  },
};
