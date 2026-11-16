import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PickupPoint = {
  label: string;
  atual: number | null;
  esperada: number | null;
  n?: number;
  [k: string]: number | string | null | undefined;
};

export function PickupChart({
  title,
  data,
  note,
  esperadaNome = "Esperada (média da janela de 7 dias)",
  extras,
  marcas,
  hoje,
}: {
  title: string;
  data: PickupPoint[];
  note?: string;
  /** Nome da linha esperada (na tela da data: a referência usada, com a data). */
  esperadaNome?: string;
  /** Outras referências, desenhadas tracejadas e finas; passar (mesmo vazio) destaca a esperada como a referência usada. */
  extras?: {
    key: string;
    name: string;
    /** Cor e traço próprios da linha (e da legenda); sem eles, cinza tracejado. */ color?: string;
    dash?: string;
  }[];
  /** Pontos em que cada série chegou a 100% (chave da série e rótulo do eixo). */
  marcas?: { key: string; label: string }[];
  /** Rótulo do ponto da data-base: ganha uma linha vertical "hoje". */
  hoje?: string;
}) {
  const has = data.some((d) => d.atual != null || d.esperada != null);
  const destaque = extras !== undefined;
  return (
    <Card className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5">
        <h2 className="font-semibold">{title}</h2>
        {note ? (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Como ler a curva"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{note}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {!has ? (
        <p className="text-sm text-muted-foreground">Sem dados para este recorte.</p>
      ) : (
        <div className="h-64 w-full shrink-0">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, 100]} />
              {hoje ? (
                <ReferenceLine
                  x={hoje}
                  stroke="var(--foreground)"
                  strokeDasharray="4 3"
                  strokeOpacity={0.6}
                  label={{
                    value: "hoje",
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: "var(--foreground)",
                  }}
                />
              ) : null}
              <ChartTooltip
                formatter={(
                  v: number | string,
                  _n: string,
                  item: { dataKey?: string | number; payload?: Record<string, unknown> },
                ) => {
                  if (typeof v !== "number") return "—";
                  const c = item?.payload?.[`${item.dataKey}Carros`];
                  const cap = item?.payload?.["capacidade"];
                  return typeof c === "number" && typeof cap === "number"
                    ? `${v.toFixed(0)}% · ${c} de ${cap}`
                    : `${v.toFixed(0)}%`;
                }}
                contentStyle={{ fontSize: 12 }}
              />
              {(extras ?? []).map((e) => (
                <Line
                  key={e.key}
                  type="monotone"
                  dataKey={e.key}
                  name={e.name}
                  stroke={e.color ?? "var(--muted-foreground)"}
                  strokeDasharray={e.dash ?? "2 3"}
                  strokeWidth={e.color ? 1.75 : 1}
                  dot={{
                    r: 2,
                    fill: e.color ?? "var(--muted-foreground)",
                    stroke: e.color ?? "var(--muted-foreground)",
                  }}
                  connectNulls={false}
                />
              ))}
              <Line
                type="monotone"
                dataKey="esperada"
                name={esperadaNome}
                stroke="var(--muted-foreground)"
                {...(destaque ? {} : { strokeDasharray: "5 4" })}
                strokeWidth={destaque ? 3 : 2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="atual"
                name="Atual"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              {(marcas ?? []).map((m) => (
                <ReferenceDot
                  key={m.key}
                  x={m.label}
                  y={100}
                  r={6}
                  fill="var(--background)"
                  stroke="var(--foreground)"
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" />
          Atual
        </span>
        <span>
          <span
            className={`mr-1 inline-block w-4 align-middle ${destaque ? "h-1 bg-muted-foreground" : "h-0 border-t-2 border-dashed border-muted-foreground"}`}
          />
          {esperadaNome}
        </span>
        {(extras ?? []).map((e) => (
          <span key={e.key}>
            <svg width="22" height="6" className="mr-1 inline-block align-middle" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="22"
                y2="3"
                stroke={e.color ?? "var(--muted-foreground)"}
                strokeWidth={e.color ? 1.75 : 1}
                strokeDasharray={e.dash ?? "2 3"}
                strokeLinecap="round"
              />
            </svg>
            {e.name}
          </span>
        ))}
        {marcas?.length ? (
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-full border-2 border-foreground align-middle" />
            chegou a 100%:{" "}
            {marcas
              .map(
                (m) =>
                  `${m.key === "esperada" ? esperadaNome : ((extras ?? []).find((e) => e.key === m.key)?.name ?? m.key)} em ${m.label.replace(" (base)", "")}`,
              )
              .join("; ")}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
