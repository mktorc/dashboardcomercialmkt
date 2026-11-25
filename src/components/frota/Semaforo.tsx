import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Region } from "@/lib/frota";
import { REGION_COLOR, categoryRank } from "@/lib/frota-config";
import type { CityStatus, StockProjection } from "@/lib/frota-acoes";

const dia = (key: string) =>
  new Date(`${key}T12:00:00`)
    .toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
    .replace(".", "");

const prazo = (ms: number) =>
  new Date(ms)
    .toLocaleString("pt-BR", {
      timeZone: "America/New_York",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", "");

/** Um card por cidade: verde "Ok nos próximos X dias" ou vermelho "Falta N [categoria] em [data]". */
export function Semaforo({
  status,
  days,
  selected,
  onSelect,
}: {
  status: CityStatus[];
  days: string[];
  selected: Region | "todas";
  onSelect: (r: Region | "todas") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {status.map((c) => {
        const bad = c.shortage != null;
        const sel = selected === c.region;
        const pend = c.pending;
        const warn = !bad && pend.chegam + pend.saem + pend.outras > 0;
        const partes = [
          ...Object.entries(pend.saemPara).map(([c, n]) => `${n} ${n! > 1 ? "vão" : "vai"} p/ ${c}`),
          ...Object.entries(pend.chegamDe).map(([c, n]) => `${n} ${n! > 1 ? "vêm" : "vem"} de ${c}`),
          pend.outras && `${pend.outras} troca/upgrade`,
        ].filter(Boolean);
        return (
          <button
            key={c.region}
            onClick={() => onSelect(sel ? "todas" : c.region)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              bad
                ? "border-red-500/50 bg-red-500/10 hover:bg-red-500/15"
                : warn
                  ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/15"
                  : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15"
            } ${sel ? "ring-2 ring-foreground" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: REGION_COLOR[c.region] }}
                />
                {c.region}
              </span>
              <span className="text-xs text-muted-foreground">pátio {c.yard}</span>
            </div>
            <div
              className={`mt-1 text-sm font-medium ${bad ? "text-red-400" : warn ? "text-amber-400" : "text-emerald-400"}`}
            >
              {bad
                ? `Falta ${c.shortage!.missing} ${c.shortage!.classLabel} em ${dia(c.shortage!.day)}`
                : warn
                  ? `Só fica ok se fizer as ações`
                  : `Ok nos próximos ${days.length} dias`}
            </div>
            {partes.length > 0 && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pendente: {partes.join(" · ")}
                {pend.nextDeadline != null && (
                  <> · próxima {prazo(pend.nextDeadline)}</>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Bloco recolhido com o estoque acumulado por cidade + categoria, destacando só os negativos. */
export function EstoqueDetalhe({
  projection,
  regions,
  days,
}: {
  projection: StockProjection;
  regions: Region[];
  days: string[];
}) {
  const [open, setOpen] = useState(false);
  const rows = regions.flatMap((r) =>
    [...(projection.get(r) ?? new Map<string, number[]>()).entries()]
      .sort(([a], [b]) => (categoryRank(a) ?? 99) - (categoryRank(b) ?? 99) || a.localeCompare(b))
      .map(([cls, s]) => ({ r, cls, s })),
  );
  return (
    <Card className="p-0">
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Ver detalhe por dia
        <span className="text-xs font-normal text-muted-foreground">
          · estoque projetado acumulado (pátio + devoluções − retiradas ± transferências)
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t p-2">
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card" />
                {days.map((d) => {
                  const dt = new Date(`${d}T12:00:00`);
                  return (
                    <th
                      key={d}
                      className="min-w-8 px-0.5 text-center font-normal text-muted-foreground"
                    >
                      <div className="capitalize">
                        {dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                      </div>
                      <div>
                        {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, cls, s }) => (
                <tr key={`${r}|${cls}`}>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-card pr-2 text-left font-normal">
                    <span
                      className="mr-1 inline-block size-2 rounded-full"
                      style={{ background: REGION_COLOR[r] }}
                    />
                    {r} · <span className="text-muted-foreground">{cls}</span>
                  </th>
                  {s.map((v, i) => (
                    <td
                      key={i}
                      className={`h-6 min-w-8 rounded-sm text-center tabular-nums ${
                        v < 0
                          ? "bg-red-600/70 font-semibold text-white"
                          : "text-muted-foreground/70"
                      }`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
