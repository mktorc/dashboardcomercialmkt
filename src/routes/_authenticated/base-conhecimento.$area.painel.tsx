import { createFileRoute } from "@tanstack/react-router";
import { useKbAreaData } from "@/components/base-conhecimento/kb-context";
import { KbPainel } from "@/components/base-conhecimento/KbPainel";

// Painel do gestor: o servidor só manda os dados de ORCI e equipe para administradores.
export const Route = createFileRoute("/_authenticated/base-conhecimento/$area/painel")({
  component: PainelPage,
});

function PainelPage() {
  return <KbPainel data={useKbAreaData()} />;
}
