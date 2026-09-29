import { BarChart3, Car, LayoutDashboard, LineChart, Megaphone, Users } from "lucide-react";

const items = [
  { label: "Visão geral", icon: LayoutDashboard, active: true },
  { label: "Mídia paga", icon: Megaphone },
  { label: "Leads CRM", icon: Users },
  { label: "Reservas", icon: Car },
  { label: "Atribuição", icon: BarChart3 },
  { label: "Evolução", icon: LineChart },
];

export function Sidebar() {
  return (
    <aside
      className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border p-4 lg:flex"
      style={{ background: "var(--brand-dark)" }}
    >
      <div className="mb-8 flex items-center gap-2">
        <span
          className="flex size-9 items-center justify-center rounded-lg font-bold text-[color:var(--brand-dark)]"
          style={{ background: "var(--brand-vivid)" }}
        >
          O
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">Orlando Rent Car</p>
          <p className="text-xs text-sidebar-foreground/70">Analytics & Growth</p>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={item.label}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              item.active
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
      </nav>
      <p className="mt-auto text-xs text-sidebar-foreground/60">
        Meta Ads · Google Ads · ClickMassa · HQ Rentals
      </p>
    </aside>
  );
}
