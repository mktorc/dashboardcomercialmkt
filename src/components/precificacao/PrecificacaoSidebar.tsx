import { useState, type ComponentType } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

export type PricingNavItem<K extends string = string> = {
  key: K;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/** Barra lateral do hub de precificação, no mesmo visual das demais (recolhível no desktop, gaveta no celular). */
export function PrecificacaoSidebar<K extends string>({
  items,
  active,
  onSelect,
}: {
  items: PricingNavItem<K>[];
  active: K;
  onSelect: (key: K) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  const itemClass = (isActive: boolean, pad: string) =>
    `flex w-full items-center gap-3 rounded-lg text-left text-sm transition-colors ${pad} ${
      isActive
        ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
    }`;

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center gap-3 border-b border-sidebar-border px-4 py-3 lg:hidden"
        style={{ background: "var(--brand-dark)" }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="flex size-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Menu className="size-5" />
        </button>
        <img
          src="/logo-orc.png"
          alt="Orlando Rent Car"
          className="size-8 rounded-lg object-cover"
        />
        <p className="text-sm font-semibold text-sidebar-foreground">Orlando Rent Car</p>
      </header>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="flex w-72 flex-col border-sidebar-border p-4 text-sidebar-foreground [&>button]:text-sidebar-foreground"
          style={{ background: "var(--brand-dark)" }}
        >
          <SheetTitle className="mb-6 flex items-center gap-2 text-sidebar-foreground">
            <img src="/logo-orc.png" alt="" className="size-9 rounded-lg object-cover" />
            Orlando Rent Car
          </SheetTitle>
          <nav className="flex flex-col gap-1">
            <Link
              to="/app"
              onClick={() => setMobileOpen(false)}
              className={itemClass(false, "px-3 py-3")}
            >
              <ArrowLeft className="size-4" /> Voltar aos Módulos
            </Link>
            {items.map((i) => (
              <button
                key={i.key}
                type="button"
                onClick={() => {
                  onSelect(i.key);
                  setMobileOpen(false);
                }}
                className={itemClass(active === i.key, "px-3 py-3")}
              >
                <i.icon className="size-4" /> {i.label}
              </button>
            ))}
          </nav>
          <button
            onClick={signOut}
            className="mt-auto flex items-center gap-2 rounded-lg px-3 py-3 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
          >
            <LogOut className="size-4" /> Sair
          </button>
        </SheetContent>
      </Sheet>
      <aside
        className={`hidden shrink-0 flex-col border-r border-sidebar-border transition-[width,padding] duration-200 lg:flex ${collapsed ? "w-16 p-2" : "w-60 p-4"}`}
        style={{ background: "var(--brand-dark)" }}
      >
        <div
          className={`mb-8 flex items-center gap-2 ${collapsed ? "flex-col" : "justify-between"}`}
        >
          <img
            src="/logo-orc.png"
            alt="Orlando Rent Car"
            className="size-9 rounded-lg object-cover shadow-sm"
          />
          {!collapsed ? (
            <div className="leading-tight">
              <p className="text-sm font-semibold text-sidebar-foreground">Orlando Rent Car</p>
              <p className="text-xs text-sidebar-foreground/70">Analytics & Growth</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>
        <nav className="flex flex-col gap-1">
          <Link
            to="/app"
            title={collapsed ? "Voltar aos Módulos" : undefined}
            className={itemClass(false, collapsed ? "justify-center px-0 py-2" : "px-3 py-2")}
          >
            <ArrowLeft className="size-4" />
            {!collapsed ? "Voltar aos Módulos" : null}
          </Link>
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              title={collapsed ? i.label : undefined}
              onClick={() => onSelect(i.key)}
              className={itemClass(
                active === i.key,
                collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
              )}
            >
              <i.icon className="size-4" />
              {!collapsed ? i.label : null}
            </button>
          ))}
        </nav>
        <button
          onClick={signOut}
          title={collapsed ? "Sair" : undefined}
          aria-label="Sair"
          className={`mt-auto flex items-center gap-2 rounded-lg py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent ${collapsed ? "justify-center px-0" : "px-3"}`}
        >
          <LogOut className="size-4" /> {!collapsed ? "Sair" : null}
        </button>
      </aside>
    </>
  );
}
