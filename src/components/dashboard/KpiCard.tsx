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
  className?: string | undefined;
}) {
  const progress = goal ? goalProgress(goal.actual, goal.target) : null;
  const overLimit = goal?.kind === "limit" && progress !== null && progress.percent > 100;
  return (
    <Card className={cn("relative overflow-hidden border-border bg-card p-4", className)}>
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: highlight ? "var(--brand-vivid)" : "var(--brand-dark)" }}
      />
      <div className="flex h-9 shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        </div>
        <span className="rounded-lg bg-secondary p-2 text-accent">
          <Icon className="size-5" />
        </span>
      </div>
      <div className={`${compact ? "mt-1" : "mt-2"} flex flex-1 flex-col`}>
        <p className={`truncate text-2xl font-semibold ${highlight ? "text-accent" : "text-foreground"}`}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {goal ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              {progress ? `${goal.kind === "limit" ? "Limite" : "Meta"}: ${goal.label}` : `${goal.kind === "limit" ? "Limite" : "Meta"} não definida`}
            </span>
            {progress ? (
              <span className={`font-medium ${overLimit ? "text-destructive" : "text-accent"}`}>
                {progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% {goal.kind === "limit" ? "do limite" : "da meta"}
              </span>
            ) : null}
          </div>
          <Progress
            aria-label={`${label} — progresso ${goal.kind === "limit" ? "do limite" : "da meta"}`}
            value={progress?.bar ?? 0}
            className={overLimit ? "bg-secondary [&>div]:bg-destructive" : "bg-secondary [&>div]:bg-accent"}
          />
        </div>
      ) : null}
      {pace ? (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Ritmo ({pace.monthPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do mês): {pace.actual} realizado · {pace.expected} esperado
        </p>
      ) : null}
      {footer ? <p className="mt-auto pt-2 text-[11px] leading-4 text-muted-foreground">{footer}</p> : null}
    </Card>
  );
}
