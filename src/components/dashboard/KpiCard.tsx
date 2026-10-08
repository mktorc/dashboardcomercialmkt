import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { goalProgress } from "@/lib/commercial-goals";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight,
  goal,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: LucideIcon;
  highlight?: boolean | undefined;
  goal?: { actual: number; target?: number | undefined; label: string } | undefined;
}) {
  const progress = goal ? goalProgress(goal.actual, goal.target) : null;
  return (
    <Card className="relative overflow-hidden border-border bg-card p-5">
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: highlight ? "var(--brand-vivid)" : "var(--brand-dark)" }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p
            className={`mt-2 truncate text-2xl font-semibold ${highlight ? "text-accent" : "text-foreground"}`}
          >
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className="rounded-lg bg-secondary p-2 text-accent">
          <Icon className="size-5" />
        </span>
      </div>
      {goal ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">{progress ? `Meta: ${goal.label}` : "Meta não definida"}</span>
            {progress ? <span className="font-medium text-accent">{progress.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta</span> : null}
          </div>
          <Progress aria-label={`${label} — progresso da meta`} value={progress?.bar ?? 0} className="bg-secondary [&>div]:bg-accent" />
        </div>
      ) : null}
    </Card>
  );
}
