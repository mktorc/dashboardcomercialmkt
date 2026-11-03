import { createFileRoute } from "@tanstack/react-router";
import { ControleReservas } from "@/components/reservas/ControleReservas";

// Acesso público (sem login), como o Operacional.
export const Route = createFileRoute("/controle-reservas")({
  head: () => ({
    meta: [
      { title: "Controle de Reservas | Orlando Rent Car Analytics" },
      { name: "description", content: "Reservas que passaram de pending para open." },
    ],
  }),
  component: () => <ControleReservas />,
});
