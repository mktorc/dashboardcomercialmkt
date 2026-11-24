import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guardPage, kbAreasOf } from "@/lib/roles";
import { isArea, KbHttpError, useKbArea, type KbArea } from "@/components/base-conhecimento/kb-api";
import { KbLayout, KbLayoutSkeleton } from "@/components/base-conhecimento/KbLayout";
import { KbAreaContext } from "@/components/base-conhecimento/kb-context";

// Layout de uma área: barra lateral + conteúdo. A área sem permissão nem carrega
// (o servidor também devolve 403 em /api/kb/articles e /api/kb/ask).
export const Route = createFileRoute("/_authenticated/base-conhecimento/$area")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento | Orlando Rent Car Analytics" },
      { name: "description", content: "Processos, regras e templates do time, com chat de IA." },
    ],
  }),
  beforeLoad: async ({ params }) => {
    const { access } = await guardPage("base-conhecimento");
    if (!isArea(params.area) || !kbAreasOf(access).includes(params.area))
      throw redirect({ to: "/base-conhecimento" });
  },
  component: AreaLayout,
});

function AreaLayout() {
  const { area } = Route.useParams();
  const q = useKbArea(area as KbArea);
  if (q.isLoading) return <KbLayoutSkeleton />;
  if (q.isError) {
    const denied = q.error instanceof KbHttpError && q.error.status === 403;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <Lock className="size-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">
          {denied ? "Você não tem acesso a esta área" : "Não foi possível carregar a base"}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {denied
            ? "Peça a um administrador para liberar a área em Configurações."
            : (q.error as Error).message}
        </p>
        <Button asChild variant="outline">
          <Link to="/base-conhecimento">Voltar</Link>
        </Button>
      </div>
    );
  }
  return (
    <KbAreaContext.Provider value={q.data!}>
      <KbLayout data={q.data!}>
        <Outlet />
      </KbLayout>
    </KbAreaContext.Provider>
  );
}
