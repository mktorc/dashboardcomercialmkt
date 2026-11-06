import { buildPushPayload } from "@block65/webcrypto-web-push";
import { VAPID_PUBLIC_KEY } from "@/lib/push-config";

type Sub = { endpoint: string; p256dh: string; auth: string };

/**
 * Notifica os aparelhos inscritos sobre reservas que passaram de pending para confirmed (open no HQ)
 * desde a última notificação. Várias reservas viram uma só notificação. Só leva o número da reserva.
 * Chamado ao fim do sync do HQ; nunca lança erro para não derrubar o sync.
 */
export async function notifyReservationsOpened(): Promise<{ sent: number; reservations: number }> {
  try {
    const privateKey = process.env["VAPID_PRIVATE_KEY"];
    if (!privateKey) return { sent: 0, reservations: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin;

    const { data: state } = await db
      .from("push_state")
      .select("last_history_id")
      .eq("id", 1)
      .maybeSingle();
    if (!state) return { sent: 0, reservations: 0 };
    const last = Number(state.last_history_id);

    const { data: changes, error } = await supabaseAdmin
      .from("reservation_status_history")
      .select("id, reservation_id")
      .eq("from_status", "pending")
      .eq("to_status", "confirmed")
      .gt("id", last)
      .order("id")
      .limit(1000);
    if (error) throw error;
    if (!changes?.length) return { sent: 0, reservations: 0 };

    // Avança o marcador antes de enviar: melhor perder um aviso do que repetir a rajada.
    const maxId = Math.max(...changes.map((c) => c.id));
    await db.from("push_state").update({ last_history_id: maxId }).eq("id", 1);

    const ids = [...new Set(changes.map((c) => c.reservation_id))];
    const shown = ids
      .slice(0, 5)
      .map((id) => `#${id}`)
      .join(", ");
    const body =
      ids.length === 1
        ? `Reserva #${ids[0]} com sinal pago (open)`
        : `${ids.length} reservas com sinal pago (open): ${shown}${ids.length > 5 ? "…" : ""}`;
    const message = {
      title: "Controle de Reservas",
      body,
      url: "/controle-reservas",
      tag: "reserva-open",
    };

    const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
    const vapid = {
      subject: process.env["VAPID_SUBJECT"] ?? "mailto:contato@orlandorentcar.com",
      publicKey: VAPID_PUBLIC_KEY,
      privateKey,
    };
    const expired: string[] = [];
    let sent = 0;
    await Promise.all(
      ((subs ?? []) as Sub[]).map(async (s) => {
        try {
          const payload = await buildPushPayload(
            { data: JSON.stringify(message), options: { ttl: 6 * 3600 } },
            {
              endpoint: s.endpoint,
              expirationTime: null,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            vapid,
          );
          const res = await fetch(s.endpoint, payload);
          if (res.status === 404 || res.status === 410) expired.push(s.endpoint);
          else if (res.ok) sent++;
          else console.error("[push] HTTP", res.status, s.endpoint.slice(0, 60));
        } catch (e) {
          console.error("[push] envio falhou:", (e as Error).message);
        }
      }),
    );
    if (expired.length) await db.from("push_subscriptions").delete().in("endpoint", expired);
    return { sent, reservations: ids.length };
  } catch (e) {
    console.error("[push] notifyReservationsOpened:", e);
    return { sent: 0, reservations: 0 };
  }
}
