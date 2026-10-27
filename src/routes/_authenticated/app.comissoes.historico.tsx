import { createFileRoute } from "@tanstack/react-router";
import { ComissoesLayout } from "@/components/comissoes/ComissoesLayout";
import Historico from "@/components/comissoes/Historico";
import { guardPage } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/app/comissoes/historico")({
  beforeLoad: () => guardPage("comissoes"),
  head: () => ({ meta: [{ title: "Histórico de Comissões | Orlando Rent Car Analytics" }] }),
  component: () => (
    <ComissoesLayout>
      <Historico />
    </ComissoesLayout>
  ),
});
