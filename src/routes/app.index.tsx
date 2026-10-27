import { createFileRoute, redirect } from "@tanstack/react-router";
import { ModuleSelection } from "@/components/ModuleSelection";
import { getMyRole, HOME } from "@/lib/roles";

// Hub público: sem login o visitante escolhe entre entrar e o acesso público.
export const Route = createFileRoute("/app/")({
  beforeLoad: async () => {
    // Logado e não superadmin: vai direto para a própria página (só o superadmin vê todos os módulos).
    const role = await getMyRole();
    if (role && role !== "superadmin") throw redirect({ to: HOME[role] });
  },
  head: () => ({ meta: [{ title: "Módulos | Orlando Rent Car Analytics" }] }),
  component: ModuleSelection,
});
