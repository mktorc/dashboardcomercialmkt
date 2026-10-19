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
  pace?: { expected: string; actual: string; monthPercent: number } | undefined;
  footer?: string | undefined;
  compact?: boolean;
  tight?: boolean;
  aligned?: boolean;
  /** Permite o subtítulo quebrar em várias linhas (aceita \n) em vez de truncar. */
  wrapHint?: boolean;
  className?: string | undefined;
}) {
  const progress = goal ? goalProgress(goal.actual, goal.target) : null;
  const overLimit = goal?.kind === "limit" && progress !== null && progress.percent > 100;
  const goalLabelDetails = goal ? (
    <div className={cn("flex justify-between", compact ? "flex-nowrap gap-1 text-[10px] leading-3" : "flex-wrap gap-x-3 gap-y-1 text-xs")}>
      <span className={cn("text-muted-foreground", compact && "min-w-0 truncate")}>
        {progress ? `${goal.kind === "limit" ? "Limite" : "Meta"}: ${goal.label}` : `${goal.kind === "limit" ? "Limite" : "Meta"} não definida`}
      </span>
      {progress ? (
        <span className={cn("font-medium", compact && "shrink-0", overLimit ? "text-destructive" : "text-accent")}>
          {progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% {goal.kind === "limit" ? "do limite" : "da meta"}
        </span>
      ) : null}
    </div>
  ) : null;
  const goalProgressDetails = goal ? (
    <Progress
      aria-label={`${label} — progresso ${goal.kind === "limit" ? "do limite" : "da meta"}`}
      value={progress?.bar ?? 0}
      className={cn(compact && "h-1.5", overLimit ? "bg-secondary [&>div]:bg-destructive" : "bg-secondary [&>div]:bg-accent")}
    />
  ) : null;
  const goalDetails = goal ? (
    <div className={cn(aligned ? "space-y-0.5" : tight ? "mt-auto space-y-0.5 pt-1" : compact ? "mt-2 space-y-1" : "mt-4 space-y-2")}>
      {goalLabelDetails}
      {goalProgressDetails}
    </div>
  ) : null;
  const paceDetails = pace ? (
    <p className={cn("text-muted-foreground", aligned ? "line-clamp-2 text-[10px] leading-3" : tight ? "mt-0.5 line-clamp-2 text-[9px] leading-3" : compact ? "mt-1 line-clamp-2 text-[10px] leading-3" : "mt-2 text-[11px] leading-4")}>
      Ritmo ({pace.monthPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do mês): {pace.actual} realizado · {pace.expected} esperado
    </p>
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
        <div className="mt-auto flex h-14 w-full flex-col justify-end">
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
