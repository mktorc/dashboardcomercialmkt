import { createFileRoute } from "@tanstack/react-router";
import { ComissoesLayout } from "@/components/comissoes/ComissoesLayout";
import ComissoesAPagar from "@/components/comissoes/ComissoesAPagar";

export const Route = createFileRoute("/app/comissoes/a-pagar")({
  head: () => ({ meta: [{ title: "Comissões a Pagar | Orlando Rent Car Analytics" }] }),
  component: () => (
    <ComissoesLayout>
      <ComissoesAPagar />
    </ComissoesLayout>
  ),
});
