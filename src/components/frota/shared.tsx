import type { Urgency } from "@/lib/frota";

export const URG: Record<Urgency, { label: string; cls: string; color: string }> = {
  conflito: {
    label: "Menos de 12h",
    cls: "bg-red-600 text-white hover:bg-red-600",
    color: "#dc2626",
  },
  urgente: {
    label: "Urgente",
    cls: "bg-amber-500 text-white hover:bg-amber-500",
    color: "#f59e0b",
  },
  programar: {
    label: "Programar",
    cls: "bg-sky-600 text-white hover:bg-sky-600",
    color: "#0284c7",
  },
};

export const fmt = (iso: string | number) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
