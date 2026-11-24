import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, LayoutDashboard, Megaphone, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { canAccess, getMyAccess, type PageKey } from "@/lib/roles";

// Escolha do dashboard, no mesmo estilo da Base de Conhecimento. Sem login, só o Operacional (que é público).
const DASHBOARDS = [
  {
    page: "dashboard" as PageKey,
    to: "/app/dashboard",
    icon: Megaphone,
    title: "Marketing",
    description:
      "Mídia paga, oportunidades ClickMassa e reservas HQ: investimento, CPL, CAC e ROAS.",
    publico: false,
  },
  {
    page: "comercial" as PageKey,
    to: "/comercial",
    icon: Briefcase,
    title: "Comercial Gerencial",
    description: "Visão gerencial da equipe de vendas: desempenho, metas e remuneração variável.",
    publico: false,
  },
  {
    page: "comercial-operacional" as PageKey,
    to: "/comercial-operacional",
    icon: Users,
    title: "Comercial Operacional",
    description: "Visão operacional: desempenho individual e da equipe de vendas.",
    publico: true,
  },
] as const;

export const Route = createFileRoute("/dashboards")({
  head: () => ({ meta: [{ title: "Dashboards | Orlando Rent Car Analytics" }] }),
  component: DashboardsPage,
});

function DashboardsPage() {
  const { data: access = null, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: getMyAccess,
  });
  const lista = DASHBOARDS.filter((d) => (access ? canAccess(access, d.page) : d.publico));

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 bg-background px-4 py-12">
      <div className="space-y-2 text-center">
        <div className="mx-auto w-fit rounded-2xl bg-primary/15 p-3">
          <LayoutDashboard className="size-7 text-primary" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Dashboards</h1>
        <p className="text-muted-foreground">Escolha o dashboard que deseja acessar.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)
          : lista.map((d) => (
              <Link
                key={d.to}
                to={d.to}
                className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-primary hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="w-fit rounded-xl bg-primary/15 p-3">
                  <d.icon className="size-7 text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-foreground">{d.title}</h2>
                  <p className="text-sm text-muted-foreground">{d.description}</p>
                </div>
                <div className="mt-auto flex items-center justify-end text-sm">
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    Entrar <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
      </div>
      {!isLoading && lista.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Nenhum dashboard disponível para o seu perfil.
        </p>
      ) : null}
      <Link to="/app" className="mx-auto text-sm text-muted-foreground hover:text-foreground">
        Voltar aos módulos
      </Link>
    </div>
  );
}
