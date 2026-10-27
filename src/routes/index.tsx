import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Painel | Orlando Rent Car Analytics" },
      { name: "description", content: "Painel de performance e vendas da Orlando Rent Car." },
      { property: "og:title", content: "Painel | Orlando Rent Car Analytics" },
      { property: "og:description", content: "Mídia paga, CRM, reservas e desempenho comercial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
});
