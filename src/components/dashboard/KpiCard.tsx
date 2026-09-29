import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: LucideIcon;
  highlight?: boolean | undefined;
}) {
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
    </Card>
  );
}
