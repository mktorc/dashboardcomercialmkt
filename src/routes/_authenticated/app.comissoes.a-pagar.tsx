import { createFileRoute } from "@tanstack/react-router";
import { ComissoesLayout } from "@/components/comissoes/ComissoesLayout";
import ComissoesAPagar from "@/components/comissoes/ComissoesAPagar";
import { guardPage } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/app/comissoes/a-pagar")({
  beforeLoad: () => guardPage("comissoes"),
  head: () => ({ meta: [{ title: "Comissões a Pagar | Orlando Rent Car Analytics" }] }),
  component: () => (
    <ComissoesLayout>
      <ComissoesAPagar />
    </ComissoesLayout>
  ),
});
