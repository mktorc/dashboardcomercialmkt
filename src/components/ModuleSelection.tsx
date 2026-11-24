import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  ClipboardList,
  Megaphone,
  Users,
  HandCoins,
  LineChart,
  LogIn,
  LogOut,
  Globe,
  Search,
  Settings,
  ListOrdered,
  Car,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { canAccess, canSeePricing, getMyEmail, getMyAccess, type PageKey } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

// Com login (superadmin): todos os módulos.
const MODULES = [
  {
    page: "dashboard" as PageKey,
    to: "/app/dashboard",
    icon: Megaphone,
    title: "Marketing",
    description:
      "Mídia paga, oportunidades ClickMassa e reservas HQ: investimento, CPL, CAC e ROAS.",
    cta: "Acessar Marketing",
  },
  {
    page: "comercial" as PageKey,
    to: "/comercial",
    icon: Briefcase,
    title: "Comercial Gerencial",
    description: "Visão gerencial da equipe de vendas: desempenho, metas e remuneração variável.",
    cta: "Acessar Gerencial",
  },
  {
    page: "comercial-operacional" as PageKey,
    to: "/comercial-operacional",
    icon: Users,
    title: "Comercial Operacional",
    description: "Visão operacional: desempenho individual e da equipe de vendas.",
    cta: "Acessar Operacional",
  },
  {
    page: "comissoes" as PageKey,
    to: "/app/comissoes/a-pagar",
    icon: HandCoins,
    title: "Gerenciamento de Comissões",
    description: "Controle de repasses e comissões de parceiros: o que está a pagar e o histórico.",
    cta: "Acessar Comissões",
  },
  {
    page: "fila-leads" as PageKey,
    to: "/fila-leads",
    icon: ListOrdered,
    title: "Fila de Leads",
    description: "Ordem de distribuição dos leads entre vendedores e registro de leads externos.",
    cta: "Acessar Fila de Leads",
  },
  {
    page: "frota" as PageKey,
    to: "/frota",
    icon: Car,
    title: "Gestão de Frota",
    description: "Carros que precisam mudar de região (Orlando e Miami) antes da próxima reserva.",
    cta: "Acessar Gestão de Frota",
  },
  {
    page: "base-conhecimento" as PageKey,
    to: "/base-conhecimento",
    icon: BookOpen,
    title: "Base de Conhecimento",
    description: "Tire dúvidas com a IA usando os arquivos das pastas do Drive do time.",
    cta: "Acessar Base de Conhecimento",
  },
] as const;

// Marketing, Gerencial e Operacional ficam agrupados no card "Dashboards" (página /dashboards).
const DASH_PAGES: readonly string[] = ["/app/dashboard", "/comercial", "/comercial-operacional"];
const DASHBOARDS_MODULE = {
  to: "/dashboards",
  icon: LayoutDashboard,
  title: "Dashboards",
  description: "Acesse os dashboards disponíveis para o seu perfil.",
  cta: "Acessar Dashboards",
} as const;
const agruparDashboards = <T extends { to: string }>(lista: readonly T[]) =>
  lista.some((m) => DASH_PAGES.includes(m.to))
    ? [...lista.filter((m) => !DASH_PAGES.includes(m.to)), DASHBOARDS_MODULE]
    : [...lista];

// Controle de Reservas: visível a quem entra no hub, com ou sem login.
const RESERVAS_MODULE = {
  to: "/controle-reservas",
  icon: ClipboardList,
  title: "Controle de Reservas",
  description: "Reservas que passaram de pending para open (sinal pago), por dia.",
  cta: "Acessar Controle de Reservas",
} as const;

// Módulo oculto: só aparece para o e-mail autorizado (a proteção real é a RLS da migração 0042).
const PRICING_MODULE = {
  to: "/precificacao",
  icon: LineChart,
  title: "Gestor de Precificação Dinâmico",
  description: "Ocupação atual e esperada por categoria, data a data. Acesso restrito.",
  cta: "Acessar Precificação",
} as const;

// Acesso público (sem login): Operacional e Comissões sem as ações de pagar e validar.
const PUBLIC_MODULES = [
  {
    to: "/comercial-operacional",
    icon: Users,
    title: "Comercial Operacional",
    description: "Visão operacional: desempenho individual e da equipe de vendas.",
    cta: "Acessar Operacional",
  },
  {
    to: "/app/comissoes/a-pagar",
    icon: HandCoins,
    title: "Gerenciamento de Comissões",
    description:
      "Visualização e ajuste das comissões de parceiros. Pagar e validar descontos exige login de superadmin.",
    cta: "Acessar Comissões",
  },
  {
    to: "/controle-reservas",
    icon: ClipboardList,
    title: "Controle de Reservas",
    description: "Reservas que passaram de pending para open (sinal pago), por dia.",
    cta: "Acessar Controle de Reservas",
  },
] as const;

const CHAVE = "hub-acesso-publico";

export function ModuleSelection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: access = null, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: getMyAccess,
  });
  const { data: email = null } = useQuery({ queryKey: ["my-email"], queryFn: getMyEmail });
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

  const [busca, setBusca] = useState("");
  const irParaLogin = () => navigate({ to: "/auth", search: { next: "/app" } });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    setPublico(false);
    navigate({ to: "/app", replace: true });
  }

  if (isLoading) return <div className="min-h-screen bg-background" />;

  const logado = access != null;
  const base = agruparDashboards<{
    to: string;
    icon: typeof Users;
    title: string;
    description: string;
    cta: string;
  }>(logado ? MODULES.filter((m) => canAccess(access, m.page)) : publico ? PUBLIC_MODULES : []);
  const comReservas = logado ? [...base, RESERVAS_MODULE] : base;
  const todos = logado && canSeePricing(email) ? [...comReservas, PRICING_MODULE] : comReservas;
  const termo = busca.trim().toLowerCase();
  const modulos = [...todos]
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
    .filter((m) => !termo || `${m.title} ${m.description}`.toLowerCase().includes(termo));

  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6"
        style={{ background: "var(--gradient-brand)" }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/logo-orc.png"
            alt="Orlando Rent Car"
            className="size-9 rounded-lg object-cover"
          />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Bem-vindo(a)</h1>
            <p className="text-sm text-foreground/70">
              {logado
                ? "Escolha um módulo para começar."
                : publico
                  ? "Acesso público: escolha um módulo."
                  : "Como deseja acessar?"}
            </p>
          </div>
        </div>
        {logado ? (
          <div className="flex items-center gap-2">
            {canAccess(access, "configuracoes") ? (
              <Button
                asChild
                variant="outline"
                size="icon"
                title="Configurações"
                aria-label="Configurações"
              >
                <Link to="/configuracoes">
                  <Settings className="size-4" />
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-1 size-4" /> Sair
            </Button>
          </div>
        ) : publico ? (
          <Button variant="outline" size="sm" onClick={irParaLogin}>
            <LogIn className="mr-1 size-4" /> Fazer login
          </Button>
        ) : null}
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        {(logado || publico) && todos.length > 0 ? (
          <div className="relative sm:col-span-2 lg:col-span-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar módulo…"
              aria-label="Pesquisar módulo"
              className="pl-9"
            />
          </div>
        ) : null}
        {!logado && !publico ? (
          <>
            <Card className="flex flex-col justify-between gap-6 p-6">
              <div className="space-y-3">
                <LogIn className="size-8 text-accent" />
                <h2 className="text-lg font-semibold text-foreground">Fazer login</h2>
                <p className="text-sm text-muted-foreground">
                  Entre com o seu usuário para acessar todos os módulos do seu perfil.
                </p>
              </div>
              <Button onClick={irParaLogin}>Fazer login</Button>
            </Card>
            <Card className="flex flex-col justify-between gap-6 p-6">
              <div className="space-y-3">
                <Globe className="size-8 text-accent" />
                <h2 className="text-lg font-semibold text-foreground">Acesso público</h2>
                <p className="text-sm text-muted-foreground">
                  Sem login: Comercial Operacional, Comissões (visualização e edição da comissão) e
                  Controle de Reservas.
                </p>
              </div>
              <Button variant="outline" onClick={() => setPublico(true)}>
                Acessar publicamente
              </Button>
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
        {(logado || publico) && modulos.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            {todos.length === 0
              ? "Nenhum módulo disponível para o seu perfil."
              : "Nenhum módulo encontrado para a pesquisa."}
          </Card>
        ) : null}
        {!logado && publico ? (
          <p className="text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            <button className="underline" onClick={() => setPublico(false)}>
              Voltar à escolha de acesso
            </button>
          </p>
        ) : null}
      </main>
    </div>
  );
}
