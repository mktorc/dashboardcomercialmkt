// "Aplicar no HQ": troca o carro de uma reserva direto no HQ Rentals, a partir da Gestão de Frota.
//
// API do HQ (Basic base64(tenant:user)), sempre conferir `success` (erros de negócio vêm com HTTP 200):
//   GET  /car-rental/reservations/{id}/available-vehicles       carros que o HQ aceita atribuir
//   GET  /car-rental/reservations/{id}/free-vehicle-class-upgrades  classes disponíveis como upgrade
//   POST /car-rental/reservations/{id}/free-vehicle-class-upgrades  { vehicle_class_id } — mantém a
//        classe/preço contratados, registra o upgrade e DESATRIBUI o carro
//   POST /car-rental/reservations/{id}/assign-vehicle/{vehicle_id} — substitui o carro atual
// Depois de aplicar, sincroniza a reserva no banco (syncReservationById) para o painel atualizar.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncReservationById } from "@/lib/hq-reservation";

type HqResp = {
  success?: boolean;
  status_code?: number;
  errors?: unknown;
  data?: unknown;
};

export type AplicarResult = {
  ok: boolean;
  /** Mensagem para o operador (sucesso ou motivo da falha). */
  message: string;
  /** O upgrade foi aplicado mas o carro não foi atribuído: reserva ficou sem carro no HQ. */
  partial?: boolean;
};

function hq() {
  const base = process.env["HQ_BASE_URL"]?.replace(/\/$/, "");
  const tenant = process.env["HQ_TENANT_TOKEN"];
  const user = process.env["HQ_USER_TOKEN"];
  if (!base || !tenant || !user) throw new Error("Credenciais do HQ não configuradas no servidor.");
  const auth = `Basic ${Buffer.from(`${tenant}:${user}`).toString("base64")}`;
  return async (path: string, init?: { method?: "GET" | "POST"; body?: unknown }) => {
    const r = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
    let j: HqResp = {};
    try {
      j = (await r.json()) as HqResp;
    } catch {
      /* corpo vazio */
    }
    if (!r.ok && j.success == null) j = { success: false, status_code: r.status };
    return j;
  };
}

/** Texto do erro do HQ ({ errors: { error_message } } ou lista). */
function errText(j: HqResp): string {
  const e = j.errors as Record<string, unknown> | unknown[] | undefined;
  if (e && !Array.isArray(e) && typeof e["error_message"] === "string") return e["error_message"];
  if (j.status_code === 403) return "o usuário da integração não tem permissão para isso no HQ";
  if (j.status_code === 401) return "credenciais do HQ recusadas";
  if (j.status_code === 404) return "reserva ou carro não encontrado no HQ";
  return `erro ${j.status_code ?? "desconhecido"} do HQ`;
}

const ids = (data: unknown): number[] =>
  Array.isArray(data)
    ? data.map((v) => Number((v as Record<string, unknown>)["id"])).filter((n) => n > 0)
    : [];

export const aplicarNoHq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { reservationId: string; vehicleId: number; upgradeClassId?: number | null }) => {
      if (!/^\d+$/.test(String(d.reservationId))) throw new Error("Reserva inválida");
      if (!Number.isInteger(d.vehicleId) || d.vehicleId <= 0) throw new Error("Carro inválido");
      if (
        d.upgradeClassId != null &&
        (!Number.isInteger(d.upgradeClassId) || d.upgradeClassId <= 0)
      )
        throw new Error("Categoria inválida");
      return d;
    },
  )
  .handler(async ({ data, context }): Promise<AplicarResult> => {
    // Só quem tem o módulo Frota (ou admin).
    const { data: acc } = await context.supabase
      .from("user_access")
      .select("modules, is_admin")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!acc || !(acc.is_admin || (acc.modules ?? []).includes("frota")))
      return { ok: false, message: "Sem acesso ao módulo Gestão de Frota." };

    const call = hq();
    const r = data.reservationId;
    const vid = data.vehicleId;

    // 1) Upgrade grátis (se a categoria do carro é acima da reservada).
    if (data.upgradeClassId != null) {
      const ups = await call(`/car-rental/reservations/${r}/free-vehicle-class-upgrades`);
      if (!ups.success)
        return { ok: false, message: `Não deu para consultar upgrades: ${errText(ups)}.` };
      const ok = Array.isArray(ups.data)
        ? ups.data.some(
            (c) =>
              Number(
                (c as Record<string, unknown>)["vehicle_class_id"] ??
                  (c as Record<string, unknown>)["id"],
              ) === data.upgradeClassId,
          )
        : false;
      if (!ok)
        return {
          ok: false,
          message:
            "O HQ não tem essa categoria disponível como upgrade para as datas da reserva. Nada foi alterado.",
        };
      const ap = await call(`/car-rental/reservations/${r}/free-vehicle-class-upgrades`, {
        method: "POST",
        body: { vehicle_class_id: data.upgradeClassId },
      });
      if (!ap.success)
        return {
          ok: false,
          message: `Upgrade recusado pelo HQ: ${errText(ap)}. Nada foi alterado.`,
        };
    }

    // 2) O HQ só atribui carro que ele lista como disponível para a reserva.
    const av = await call(`/car-rental/reservations/${r}/available-vehicles`);
    if (!av.success || !ids(av.data).includes(vid)) {
      await syncReservationById(r).catch(() => undefined);
      return {
        ok: false,
        partial: data.upgradeClassId != null,
        message:
          (data.upgradeClassId != null
            ? "Upgrade grátis aplicado, mas o HQ não lista este carro como disponível: a reserva ficou SEM carro no HQ. Atribua o carro manualmente."
            : "O HQ não lista este carro como disponível para a reserva (ocupado ou em outra situação no HQ). Nada foi alterado.") +
          (av.success ? "" : ` (${errText(av)})`),
      };
    }

    // 3) Atribui o carro (substitui o anterior).
    const as = await call(`/car-rental/reservations/${r}/assign-vehicle/${vid}`, {
      method: "POST",
    });
    if (!as.success) {
      await syncReservationById(r).catch(() => undefined);
      return {
        ok: false,
        partial: data.upgradeClassId != null,
        message: `O HQ recusou a troca do carro: ${errText(as)}.${data.upgradeClassId != null ? " O upgrade já foi aplicado: atribua o carro manualmente." : ""}`,
      };
    }

    // 4) Atualiza o banco já, sem esperar o sync.
    await syncReservationById(r).catch(() => undefined);
    return {
      ok: true,
      message:
        data.upgradeClassId != null
          ? `Reserva ${r}: upgrade grátis registrado e carro atribuído no HQ.`
          : `Reserva ${r}: carro trocado no HQ.`,
    };
  });
