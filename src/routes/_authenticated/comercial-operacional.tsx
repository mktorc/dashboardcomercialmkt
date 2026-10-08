import { createFileRoute } from "@tanstack/react-router";
import { ComercialPage } from "./comercial";

export const Route = createFileRoute("/_authenticated/comercial-operacional")({
  head: () => ({
    meta: [
      { title: "Operacional | Orlando Rent Car Analytics" },
      {
        name: "description",
        content: "Visão operacional do desempenho individual e da equipe de vendas.",
      },
    ],
  }),
  component: () => <ComercialPage title="Operacional" active="comercial-operacional" />,
});
