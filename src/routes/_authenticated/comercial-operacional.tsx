import { createFileRoute } from "@tanstack/react-router";
import { guardPage } from "@/lib/roles";
import { ComercialPage } from "./comercial";

export const Route = createFileRoute("/_authenticated/comercial-operacional")({
  beforeLoad: () => guardPage("comercial-operacional"),
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
  component: () => <ComercialPage title="Operacional" active="comercial-operacional" />,
});
