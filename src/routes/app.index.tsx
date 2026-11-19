import { createFileRoute, redirect } from "@tanstack/react-router";
import { ModuleSelection } from "@/components/ModuleSelection";
import {
  canAccess,
  type Access,
  canSeePricing,
  getMyEmail,
  getMyAccess,
  homeOf,
} from "@/lib/roles";

const PAGINAS = ["dashboard", "comercial", "comercial-operacional", "comissoes"] as const;
// Sem a barra lateral, o hub é o único jeito de trocar de módulo: perfis com mais de um (o Controle de Reservas também conta) ficam nele.
const temVariosModulos = (access: Access) => PAGINAS.filter((p) => canAccess(access, p)).length > 1;

// Hub público: sem login o visitante escolhe entre entrar e o acesso público.
export const Route = createFileRoute("/app/")({
  beforeLoad: async () => {
    // Logado e não Admin: vai direto para a própria página (só o Admin vê todos os módulos; o e-mail do estudo de precificação também entra, para ver o módulo oculto).
    const access = await getMyAccess();
    if (
      access &&
      !access.admin &&
      !temVariosModulos(access) &&
      homeOf(access) !== "/app" &&
      !canSeePricing(await getMyEmail())
    )
      throw redirect({ to: homeOf(access) });
  },
  head: () => ({ meta: [{ title: "Módulos | Orlando Rent Car Analytics" }] }),
  component: ModuleSelection,
});
