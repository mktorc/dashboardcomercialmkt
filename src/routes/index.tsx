import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orlando Rent Car | Analytics, BI e Growth" },
      { name: "description", content: "Painel de performance e vendas da Orlando Rent Car." },
      { property: "og:title", content: "Orlando Rent Car | Analytics, BI e Growth" },
      { property: "og:description", content: "Mídia paga, CRM, reservas e desempenho comercial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
