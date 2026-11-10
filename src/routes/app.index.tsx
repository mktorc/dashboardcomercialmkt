import { createFileRoute, redirect } from "@tanstack/react-router";
import { ModuleSelection } from "@/components/ModuleSelection";
import { canAccess, type AppRole, canSeePricing, getMyEmail, getMyRole, HOME } from "@/lib/roles";

const PAGINAS = ["dashboard", "comercial", "comercial-operacional", "comissoes"] as const;
// Sem a barra lateral, o hub é o único jeito de trocar de módulo: perfis com mais de um (o Controle de Reservas também conta) ficam nele.
const temVariosModulos = (role: AppRole) => PAGINAS.some((p) => canAccess(role, p)) && PAGINAS.filter((p) => canAccess(role, p)).length > 1;

// Hub público: sem login o visitante escolhe entre entrar e o acesso público.
export const Route = createFileRoute("/app/")({
  beforeLoad: async () => {
    // Logado e não superadmin: vai direto para a própria página (só o superadmin vê todos os módulos; o e-mail do estudo de precificação também entra, para ver o módulo oculto).
    const role = await getMyRole();
    if (role && role !== "superadmin" && !temVariosModulos(role) && !canSeePricing(await getMyEmail())) throw redirect({ to: HOME[role] });
  },
  head: () => ({ meta: [{ title: "Módulos | Orlando Rent Car Analytics" }] }),
  component: ModuleSelection,
});
