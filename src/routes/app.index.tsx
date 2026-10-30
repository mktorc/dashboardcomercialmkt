import { createFileRoute, redirect } from "@tanstack/react-router";
import { ModuleSelection } from "@/components/ModuleSelection";
import { canSeePricing, getMyEmail, getMyRole, HOME } from "@/lib/roles";

// Hub público: sem login o visitante escolhe entre entrar e o acesso público.
export const Route = createFileRoute("/app/")({
  beforeLoad: async () => {
    // Logado e não superadmin: vai direto para a própria página (só o superadmin vê todos os módulos; o e-mail do estudo de precificação também entra, para ver o módulo oculto).
    const role = await getMyRole();
    if (role && role !== "superadmin" && !canSeePricing(await getMyEmail())) throw redirect({ to: HOME[role] });
  },
  head: () => ({ meta: [{ title: "Módulos | Orlando Rent Car Analytics" }] }),
  component: ModuleSelection,
});
