import { createFileRoute, Navigate } from "@tanstack/react-router";
import { guardPage } from "@/lib/roles";
import { useKbAreas } from "@/components/base-conhecimento/kb-api";
import { KbAreaChooser } from "@/components/base-conhecimento/KbPages";

// Entrada do módulo: escolha da área. Quem só tem uma área vai direto para ela.
export const Route = createFileRoute("/_authenticated/base-conhecimento/")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento | Orlando Rent Car Analytics" },
      { name: "description", content: "Processos, regras e templates do time, com chat de IA." },
    ],
  }),
  beforeLoad: () => guardPage("base-conhecimento"),
  component: AreaChooserPage,
});

function AreaChooserPage() {
  const q = useKbAreas();
  const areas = q.data?.areas ?? [];
  if (areas.length === 1)
    return <Navigate to="/base-conhecimento/$area" params={{ area: areas[0]! }} replace />;
  return <KbAreaChooser areas={areas} counts={q.data?.counts ?? {}} loading={q.isLoading} />;
}
