import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, ChevronDown, LayoutDashboard, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { key: "dashboard", label: "Marketing", icon: LayoutDashboard, to: "/dashboard" },
] as const;

type ActivePage = (typeof items)[number]["key"] | "comercial" | "comercial-operacional";

export function Sidebar({ active }: { active: ActivePage }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  return (
    <aside
      className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border p-4 lg:flex"
      style={{ background: "var(--brand-dark)" }}
    >
      <div className="mb-8 flex items-center gap-2">
        <img
          src="/logo-orc.png"
          alt="Orlando Rent Car"
          className="size-9 rounded-lg object-cover shadow-sm"
        />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">Orlando Rent Car</p>
          <p className="text-xs text-sidebar-foreground/70">Analytics & Growth</p>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active === item.key
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
              active === "comercial" || active === "comercial-operacional"
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <Briefcase className="size-4" />
            Comercial
            <ChevronDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            className="min-w-48 border-sidebar-border bg-[var(--brand-dark)] text-sidebar-foreground"
          >
            <DropdownMenuItem asChild>
              <Link
                to="/comercial"
                className={active === "comercial" ? "bg-sidebar-accent font-semibold" : ""}
              >
                Gerencial
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to="/comercial-operacional"
                className={
                  active === "comercial-operacional" ? "bg-sidebar-accent font-semibold" : ""
                }
              >
                Operacional
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <button
        onClick={signOut}
        className="mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
      >
        <LogOut className="size-4" /> Sair
      </button>
      <p className="mt-3 text-xs text-sidebar-foreground/60">
        Meta Ads · Google Ads · ClickMassa · HQ Rentals
      </p>
    </aside>
  );
}
