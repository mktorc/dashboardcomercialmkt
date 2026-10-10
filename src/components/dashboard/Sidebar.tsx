import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canAccess, getMyRole } from "@/lib/roles";
import { useState } from "react";
import { Briefcase, ChevronDown, LayoutDashboard, LogOut, PanelLeftClose, Settings, PanelLeftOpen } from "lucide-react";
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

type ActivePage = (typeof items)[number]["key"] | "comercial" | "comercial-operacional" | "configuracoes";

export function Sidebar({ active }: { active: ActivePage }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const { data: role = null } = useQuery({ queryKey: ["my-role"], queryFn: getMyRole });
  const showGer = canAccess(role, "comercial");
  const showOp = canAccess(role, "comercial-operacional");

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-sidebar-border transition-[width,padding] duration-200 lg:flex ${collapsed ? "w-16 p-2" : "w-60 p-4"}`}
      style={{ background: "var(--brand-dark)" }}
    >
      <div className={`mb-8 flex items-center gap-2 ${collapsed ? "flex-col" : "justify-between"}`}>
        <img
          src="/logo-orc.png"
          alt="Orlando Rent Car"
          className="size-9 rounded-lg object-cover shadow-sm"
        />
        {!collapsed ? <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">Orlando Rent Car</p>
          <p className="text-xs text-sidebar-foreground/70">Analytics & Growth</p>
        </div> : null}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          title={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <nav className="flex flex-col gap-1">
        {items.filter((i) => canAccess(role, i.key)).map((item) => (
          <Link
            key={item.key}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${
              active === item.key
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <item.icon className="size-4" />
            {!collapsed ? item.label : null}
          </Link>
        ))}
        {showGer || showOp ? <DropdownMenu>
          <DropdownMenuTrigger
            title={collapsed ? "Comercial" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${collapsed ? "justify-center px-0" : "px-3"} ${
              active === "comercial" || active === "comercial-operacional"
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <Briefcase className="size-4" />
            {!collapsed ? <>Comercial<ChevronDown className="ml-auto size-4" /></> : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            className="min-w-48 border-sidebar-border bg-[var(--brand-dark)] text-sidebar-foreground"
          >
            {showGer ? <DropdownMenuItem asChild>
              <Link
                to="/comercial"
                className={active === "comercial" ? "bg-sidebar-accent font-semibold" : ""}
              >
                Gerencial
              </Link>
            </DropdownMenuItem> : null}
            {showOp ? <DropdownMenuItem asChild>
              <Link
                to="/comercial-operacional"
                className={
                  active === "comercial-operacional" ? "bg-sidebar-accent font-semibold" : ""
                }
              >
                Operacional
              </Link>
            </DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu> : null}
        {canAccess(role, "configuracoes") ? (
          <Link
            to="/configuracoes"
            title={collapsed ? "Configurações" : undefined}
            className={`flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${
              active === "configuracoes"
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
            }`}
          >
            <Settings className="size-4" />
            {!collapsed ? "Configurações" : null}
          </Link>
        ) : null}
      </nav>
      <button
        onClick={signOut}
        title={collapsed ? "Sair" : undefined}
        aria-label="Sair"
        className={`mt-auto flex items-center gap-2 rounded-lg py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent ${collapsed ? "justify-center px-0" : "px-3"}`}
      >
        <LogOut className="size-4" /> {!collapsed ? "Sair" : null}
      </button>
      {!collapsed ? <p className="mt-3 text-xs text-sidebar-foreground/60">
        Meta Ads · Google Ads · ClickMassa · HQ Rentals
      </p> : null}
    </aside>
  );
}
