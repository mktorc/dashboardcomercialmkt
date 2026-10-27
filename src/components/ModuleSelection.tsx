import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, HandCoins, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { canAccess, getMyRole, type PageKey } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

const MODULES = [
  {
    page: "dashboard" as PageKey,
    to: "/app/dashboard",
    icon: BarChart3,
    title: "Dashboard Comercial",
    description: "Indicadores comerciais e de mídia: reservas do HQ Rentals, Meta Ads e Google Ads.",
    cta: "Acessar Dashboard",
  },
  {
    page: "comissoes" as PageKey,
    to: "/app/comissoes/a-pagar",
    icon: HandCoins,
    title: "Gerenciamento de Comissões",
    description: "Controle de repasses e comissões de parceiros: o que está a pagar e o histórico.",
    cta: "Acessar Comissões",
  },
] as const;

export function ModuleSelection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: role = null } = useQuery({ queryKey: ["my-role"], queryFn: getMyRole });
  const modules = MODULES.filter((m) => canAccess(role, m.page));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: undefined }, replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6"
        style={{ background: "var(--gradient-brand)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo-orc.png" alt="Orlando Rent Car" className="size-9 rounded-lg object-cover" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Bem-vindo(a)</h1>
            <p className="text-sm text-foreground/70">Escolha um módulo para começar.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>
          <LogOut className="mr-1 size-4" /> Sair
        </Button>
      </header>
      <main className="mx-auto grid max-w-4xl grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2">
        {modules.map((m) => (
          <Card key={m.to} className="flex flex-col justify-between gap-6 p-6">
            <div className="space-y-3">
              <m.icon className="size-8 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">{m.title}</h2>
              <p className="text-sm text-muted-foreground">{m.description}</p>
            </div>
            <Button asChild>
              <Link to={m.to}>{m.cta}</Link>
            </Button>
          </Card>
        ))}
        {role && modules.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground md:col-span-2">
            Nenhum módulo disponível para o seu perfil.
          </Card>
        ) : null}
      </main>
    </div>
  );
}
