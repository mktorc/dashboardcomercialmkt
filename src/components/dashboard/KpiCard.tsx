import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { goalProgress } from "@/lib/commercial-goals";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight,
  goal,
  pace,
  footer,
  compact = false,
  tight = false,
  aligned = false,
  wrapHint = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: LucideIcon;
  highlight?: boolean | undefined;
  goal?: { actual: number; target?: number | undefined; label: string; kind?: "target" | "limit" } | undefined;
  pace?: { expected: string; actual: string; monthPercent: number; delta?: { label: string; positive: boolean } } | undefined;
  footer?: string | undefined;
  compact?: boolean;
  tight?: boolean;
  aligned?: boolean;
  /** Permite o subtítulo quebrar em várias linhas (aceita \n) em vez de truncar. */
  wrapHint?: boolean;
  className?: string | undefined;
}) {
  const progress = goal ? goalProgress(goal.actual, goal.target) : null;
  const isLimit = goal?.kind === "limit";
  const overLimit = isLimit && progress !== null && progress.percent > 100;
  // Cor pelo atingimento: verde na meta, âmbar perto, laranja longe; no limite, vermelho ao estourar.
  const tone = overLimit
    ? { text: "text-destructive", bar: "[&>div]:bg-destructive" }
    : progress === null || isLimit || progress.percent >= 100
      ? { text: "text-accent", bar: "[&>div]:bg-accent" }
      : progress.percent >= 75
        ? { text: "text-amber-400", bar: "[&>div]:bg-amber-400" }
        : { text: "text-orange-500", bar: "[&>div]:bg-orange-500" };
  const goalLabelDetails = goal ? (
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{isLimit ? "Limite" : "Meta"}</p>
        <p className={cn("truncate font-semibold leading-5 text-foreground", compact ? "text-sm" : "text-base")}>
          {progress ? goal.label : "Não definida"}
        </p>
      </div>
      {progress ? (
        <div className="shrink-0 text-right">
          <p className={cn("font-bold leading-none", compact ? "text-xl" : "text-2xl", tone.text)}>
            {progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </p>
          <p className="mt-0.5 text-[10px] leading-3 text-muted-foreground">{isLimit ? "do limite" : "da meta"}</p>
        </div>
      ) : null}
    </div>
  ) : null;
  const goalProgressDetails = goal ? (
    <Progress
      aria-label={`${label} — progresso ${isLimit ? "do limite" : "da meta"}`}
      value={progress?.bar ?? 0}
      className={cn(compact ? "h-2.5" : "h-3", "bg-secondary", tone.bar)}
    />
  ) : null;
  const goalDetails = goal ? (
    <div className={cn(aligned ? "space-y-1" : tight ? "mt-auto space-y-1 pt-1" : compact ? "mt-2 space-y-1.5" : "mt-4 space-y-2")}>
      {goalLabelDetails}
      {goalProgressDetails}
    </div>
  ) : null;
  const paceDetails = pace ? (
    <div className="rounded-md bg-secondary/60 px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Ritmo · {pace.monthPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do mês
        </span>
        {pace.delta ? (
          <span className={cn("text-[11px] font-bold", pace.delta.positive ? "text-accent" : "text-orange-500")}>{pace.delta.label}</span>
        ) : null}
      </div>
      <p className="text-[11px] leading-4 text-foreground/90">
        <span className="font-semibold">{pace.actual}</span> realizado · <span className="font-semibold">{pace.expected}</span> esperado
      </p>
    </div>
  ) : null;
  const footerDetails = footer ? (
    <p className={cn("text-muted-foreground", aligned ? "line-clamp-2 text-[10px] leading-3" : tight ? "mt-auto pt-0.5 text-[9px] leading-3" : compact ? "mt-auto line-clamp-2 pt-1 text-[10px] leading-3" : "mt-auto pt-2 text-[11px] leading-4")}>
      {footer}
    </p>
  ) : null;
  return (
    <Card className={cn("relative overflow-hidden border-border bg-card p-4", className)}>
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: highlight ? "var(--brand-vivid)" : "var(--brand-dark)" }}
      />
      <div className={cn("flex shrink-0 items-start justify-between gap-3", tight ? "h-7" : compact ? "h-8" : "h-9")}>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        </div>
        <span className={cn("rounded-lg bg-secondary text-accent", tight ? "p-1" : compact ? "p-1.5" : "p-2")}>
          <Icon className="size-5" />
        </span>
      </div>
      <div className={cn("flex flex-col", tight ? "mt-0.5 flex-none" : compact ? "mt-1 flex-none" : "mt-2 flex-1")}>
        <p className={cn("truncate font-semibold", tight ? "text-[22px] leading-7" : "text-2xl", highlight ? "text-accent" : "text-foreground")}>
          {value}
        </p>
        {hint ? <p className={cn("text-muted-foreground", wrapHint ? "mt-1 whitespace-pre-line text-xs leading-4" : compact ? "mt-0.5 truncate text-[10px] leading-3" : "mt-1 text-xs")}>{hint}</p> : null}
      </div>
      {aligned ? (
        <div className="mt-auto flex w-full flex-col justify-end gap-1">
          {goalLabelDetails}
          <div className="flex flex-col gap-0.5">
            {goalProgressDetails}
            {paceDetails ?? footerDetails}
          </div>
        </div>
      ) : (
        <>
          {goalDetails}
          {paceDetails}
          {footerDetails}
        </>
      )}
    </Card>
  );
}
