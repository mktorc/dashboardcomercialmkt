import { createFileRoute, redirect } from "@tanstack/react-router";
import { ModuleSelection } from "@/components/ModuleSelection";
import { getMyRole, HOME } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/app/")({
  beforeLoad: async () => {
    // O hub de módulos é exclusivo do superadmin; os demais perfis vão direto para a própria página.
    const role = await getMyRole();
    if (role && role !== "superadmin") throw redirect({ to: HOME[role] });
  },
  head: () => ({ meta: [{ title: "Módulos | Orlando Rent Car Analytics" }] }),
  component: ModuleSelection,
});
