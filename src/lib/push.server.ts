import { buildPushPayload } from "@block65/webcrypto-web-push";
import { VAPID_PUBLIC_KEY } from "@/lib/push-config";

type Sub = { endpoint: string; p256dh: string; auth: string };

/**
 * Notifica os aparelhos inscritos sobre reservas que passaram de pending para confirmed (open no HQ) ou foram canceladas (canceled no HQ)
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
      .select("id, reservation_id, from_status, to_status")
      .or("and(from_status.eq.pending,to_status.eq.confirmed),to_status.eq.cancelled")
      .gt("id", last)
      .order("id")
      .limit(1000);
    if (error) throw error;
    if (!changes?.length) return { sent: 0, reservations: 0 };

    // Avança o marcador antes de enviar: melhor perder um aviso do que repetir a rajada.
    const maxId = Math.max(...changes.map((c) => c.id));
    await db.from("push_state").update({ last_history_id: maxId }).eq("id", 1);

    const build = (
      ids: string[],
      um: string,
      varios: string,
      tag: string,
    ): { title: string; body: string; url: string; tag: string } => {
      const shown = ids
        .slice(0, 5)
        .map((id) => `#${id}`)
        .join(", ");
      return {
        title: "Controle de Reservas",
        body:
          ids.length === 1
            ? `Reserva #${ids[0]} ${um}`
            : `${ids.length} reservas ${varios}: ${shown}${ids.length > 5 ? "…" : ""}`,
        url: "/controle-reservas",
        tag,
      };
    };
    const opened = [
      ...new Set(changes.filter((c) => c.to_status === "confirmed").map((c) => c.reservation_id)),
    ];
    const canceled = [
      ...new Set(changes.filter((c) => c.to_status === "cancelled").map((c) => c.reservation_id)),
    ];
    // Vendedor das canceladas, para entrar no texto do aviso.
    const sellers = new Map<string, string>();
    if (canceled.length) {
      const { data: rows } = await db
        .from("reservations")
        .select("reservation_id, seller_name")
        .in("reservation_id", canceled.slice(0, 50));
      for (const r of rows ?? [])
        if (r.seller_name && r.reservation_id) sellers.set(r.reservation_id, r.seller_name);
    }
    const cancelMessage = () => {
      const um = canceled.length === 1;
      const vend = (id: string) => sellers.get(id);
      if (um) {
        const v = vend(canceled[0]!);
        return {
          title: "Controle de Reservas",
          body: `Reserva #${canceled[0]} foi cancelada${v ? ` · Vendedor: ${v}` : ""}`,
          url: "/controle-reservas",
          tag: "reserva-cancelada",
        };
      }
      const lista = canceled
        .slice(0, 5)
        .map((id) => (vend(id) ? `#${id} (${vend(id)})` : `#${id}`))
        .join(", ");
      return {
        title: "Controle de Reservas",
        body: `${canceled.length} reservas foram canceladas: ${lista}${canceled.length > 5 ? "…" : ""}`,
        url: "/controle-reservas",
        tag: "reserva-cancelada",
      };
    };
    const messages = [
      ...(opened.length
        ? [build(opened, "com sinal pago (open)", "com sinal pago (open)", "reserva-open")]
        : []),
      ...(canceled.length ? [cancelMessage()] : []),
    ];
    const ids = [...opened, ...canceled];

    const { data: subs } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
    const vapid = {
      subject: process.env["VAPID_SUBJECT"] ?? "mailto:contato@orlandorentcar.com",
      publicKey: VAPID_PUBLIC_KEY,
      privateKey,
    };
    const expired: string[] = [];
    let sent = 0;
    const targets = ((subs ?? []) as Sub[]).flatMap((s) => messages.map((m) => ({ s, m })));
    await Promise.all(
      targets.map(async ({ s, m }) => {
        try {
          const payload = await buildPushPayload(
            { data: JSON.stringify(m), options: { ttl: 6 * 3600 } },
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
