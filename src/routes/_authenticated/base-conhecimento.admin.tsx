import { createFileRoute, redirect } from "@tanstack/react-router";
import { getMyAccess, guardPage } from "@/lib/roles";
import { KbAdmin } from "@/components/base-conhecimento/KbAdmin";

// Administração da base (arquivos indexados por área e sincronização): só Admin.
// O servidor também exige Admin em /api/kb/files e /api/kb/sync.
export const Route = createFileRoute("/_authenticated/base-conhecimento/admin")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento | Orlando Rent Car Analytics" },
      { name: "description", content: "Processos, regras e templates do time, com chat de IA." },
    ],
  }),
  beforeLoad: async () => {
    await guardPage("base-conhecimento");
    const access = await getMyAccess();
    if (!access?.admin) throw redirect({ to: "/base-conhecimento" });
  },
  component: KbAdmin,
});
