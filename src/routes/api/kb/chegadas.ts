import { createFileRoute } from "@tanstack/react-router";

// CS: reservas que chegam amanhã (horário de Orlando), para a etapa Boa viagem. Vem da tabela
// reservations (sincronizada do HQ). Sem nome do cliente e sem pagamento confiável aqui: o painel
// mostra número, horário, local e categoria, e sugere o template pelo local e pelo horário.
const TZ = "America/New_York";

/** Data (AAAA-MM-DD) em Orlando, deslocada em `plus` dias. */
function dayInTz(plus: number) {
  const d = new Date(Date.now() + plus * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

export const Route = createFileRoute("/api/kb/chegadas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const u = await kb.requireArea(request, "cs");
        if ("denied" in u) return u.denied;
        const alvo = dayInTz(1);
        // Janela larga em UTC e filtro exato pelo dia em Orlando logo abaixo.
        const from = new Date(Date.now() - 12 * 3_600_000).toISOString();
        const to = new Date(Date.now() + 60 * 3_600_000).toISOString();
        const { data, error } = await kb.db
          .from("reservations")
          .select(
            "reservation_id, car_category, pick_up_at, return_at, status, pick_up_location_id",
          )
          .gte("pick_up_at", from)
          .lt("pick_up_at", to)
          .not("status", "in", "(cancelled,canceled,void,no_show)")
          .order("pick_up_at")
          .limit(200);
        if (error) return kb.fail("Falha ao ler as reservas", 500);
        const { data: locs } = await kb.db.from("fleet_locations").select("id, name").limit(200);
        const locName = new Map(
          ((locs ?? []) as { id: number; name: string }[]).map((l) => [String(l.id), l.name]),
        );
        const fmt = new Intl.DateTimeFormat("pt-BR", {
          timeZone: TZ,
          hour: "2-digit",
          minute: "2-digit",
        });
        const rows = ((data ?? []) as Record<string, unknown>[])
          .filter(
            (r) =>
              new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
                new Date(String(r["pick_up_at"])),
              ) === alvo,
          )
          .map((r) => {
            const at = new Date(String(r["pick_up_at"]));
            const hour = Number(
              new Intl.DateTimeFormat("en-US", {
                timeZone: TZ,
                hour: "numeric",
                hourCycle: "h23",
              }).format(at),
            );
            const local =
              locName.get(String(r["pick_up_location_id"] ?? "")) ?? "Local não informado";
            const cat = String(r["car_category"] ?? "");
            return {
              reserva: String(r["reservation_id"]),
              hora: fmt.format(at),
              local,
              categoria: cat,
              template: sugerir(local, cat, hour),
            };
          });
        return Response.json({ ok: true, dia: alvo, rows });
      },
    },
  },
});

/** Template de orientação pela regra do manual do CS (local, horário e Van). */
function sugerir(local: string, cat: string, hour: number): string {
  const l = local.toLowerCase();
  // Van 12 lugares (Ford Transit), não a Minivan ("Mini Van 8 Seats").
  const van = /transit|12/i.test(cat) && !/mini/i.test(cat);
  if (/mco|orlando international/.test(l))
    return van || hour < 7 || hour >= 19 ? "Ori.estacionamento -Mia/MCO" : "Ori.MCO Loun";
  if (/mia|miami international|fll|lauderdale/.test(l))
    return hour < 6 || hour >= 22 ? "Ori.estacionamento -Mia/MCO" : "Ori.Mia/FLL";
  if (/porto|port/.test(l)) return "Ori.Porto";
  if (/hotel|casa/.test(l)) return "Entrega em mãos no endereço";
  if (/lounge/.test(l)) return "Ori.MCO Loun";
  return "Conferir na reserva";
}
