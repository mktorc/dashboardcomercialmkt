import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, HandCoins, LogIn, LogOut, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { canAccess, getMyRole, type PageKey } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

// Com login (superadmin): todos os módulos.
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

// Acesso público (sem login): Operacional e Comissões sem as ações de pagar e validar.
const PUBLIC_MODULES = [
  {
    to: "/comercial-operacional",
    icon: BarChart3,
    title: "Dashboard Comercial",
    description: "Visão operacional: desempenho individual e da equipe de vendas.",
    cta: "Acessar Operacional",
  },
  {
    to: "/app/comissoes/a-pagar",
    icon: HandCoins,
    title: "Gerenciamento de Comissões",
    description: "Visualização e ajuste das comissões de parceiros. Pagar e validar descontos exige login de superadmin.",
    cta: "Acessar Comissões",
  },
] as const;

const CHAVE = "hub-acesso-publico";

export function ModuleSelection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: role = null, isLoading } = useQuery({ queryKey: ["my-role"], queryFn: getMyRole });
  const [publico, setPublicoState] = useState(() => {
    try {
      return sessionStorage.getItem(CHAVE) === "1";
    } catch {
      return false;
    }
  });
  const setPublico = (v: boolean) => {
    setPublicoState(v);
    try {
      sessionStorage.setItem(CHAVE, v ? "1" : "0");
    } catch {
      /* sem storage: só não lembra a escolha */
    }
  };

  const irParaLogin = () => navigate({ to: "/auth", search: { next: "/app" } });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    setPublico(false);
    navigate({ to: "/app", replace: true });
  }

  if (isLoading) return <div className="min-h-screen bg-background" />;

  const logado = role != null;
  const modulos = logado ? MODULES.filter((m) => canAccess(role, m.page)) : publico ? PUBLIC_MODULES : [];

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
            <p className="text-sm text-foreground/70">
              {logado ? "Escolha um módulo para começar." : publico ? "Acesso público: escolha um módulo." : "Como deseja acessar?"}
            </p>
          </div>
        </div>
        {logado ? (
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="mr-1 size-4" /> Sair
          </Button>
        ) : publico ? (
          <Button variant="outline" size="sm" onClick={irParaLogin}>
            <LogIn className="mr-1 size-4" /> Fazer login
          </Button>
        ) : null}
      </header>

      <main className="mx-auto grid max-w-4xl grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2">
        {!logado && !publico ? (
          <>
            <Card className="flex flex-col justify-between gap-6 p-6">
              <div className="space-y-3">
                <LogIn className="size-8 text-accent" />
                <h2 className="text-lg font-semibold text-foreground">Fazer login</h2>
                <p className="text-sm text-muted-foreground">Entre com o seu usuário para acessar todos os módulos do seu perfil.</p>
              </div>
              <Button onClick={irParaLogin}>Fazer login</Button>
            </Card>
            <Card className="flex flex-col justify-between gap-6 p-6">
              <div className="space-y-3">
                <Globe className="size-8 text-accent" />
                <h2 className="text-lg font-semibold text-foreground">Acesso público</h2>
                <p className="text-sm text-muted-foreground">
                  Sem login: Comercial Operacional e Comissões (visualização e edição da comissão).
                </p>
              </div>
              <Button variant="outline" onClick={() => setPublico(true)}>Acessar publicamente</Button>
            </Card>
          </>
        ) : (
          modulos.map((m) => (
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
          ))
        )}
        {logado && modulos.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground md:col-span-2">Nenhum módulo disponível para o seu perfil.</Card>
        ) : null}
        {!logado && publico ? (
          <p className="text-center text-sm text-muted-foreground md:col-span-2">
            <button className="underline" onClick={() => setPublico(false)}>Voltar à escolha de acesso</button>
          </p>
        ) : null}
      </main>
    </div>
  );
}
