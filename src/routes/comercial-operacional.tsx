import { createFileRoute } from "@tanstack/react-router";
import { ComercialPage } from "./_authenticated/comercial";

export const Route = createFileRoute("/comercial-operacional")({
  head: () => ({
    meta: [
      { title: "Operacional | Orlando Rent Car Analytics" },
      {
        name: "description",
        content: "Visão operacional do desempenho individual e da equipe de vendas.",
      },
      { property: "og:title", content: "Operacional | Orlando Rent Car Analytics" },
      { property: "og:description", content: "Visão operacional do desempenho individual e da equipe de vendas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <ComercialPage title="Operacional" active="comercial-operacional" publicView />,
});
