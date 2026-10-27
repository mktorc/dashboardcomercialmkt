import { createFileRoute } from "@tanstack/react-router";
import { ComissoesLayout } from "@/components/comissoes/ComissoesLayout";
import Historico from "@/components/comissoes/Historico";

export const Route = createFileRoute("/app/comissoes/historico")({
  head: () => ({ meta: [{ title: "Histórico de Comissões | Orlando Rent Car Analytics" }] }),
  component: () => (
    <ComissoesLayout>
      <Historico />
    </ComissoesLayout>
  ),
});
