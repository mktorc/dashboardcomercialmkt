import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// As tabelas da fila (sql-para-gravar/fila_leads.sql) ainda não estão em types.ts: cliente sem tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabaseAdmin as any;

const json = (body: unknown, status = 200) => Response.json(body, { status });
export const ok = (body: Record<string, unknown> = {}, status = 200) =>
  json({ ok: true, ...body }, status);
export const fail = (msg: string, status = 400) => json({ ok: false, msg }, status);

/** /api/fila/proximo: só a IA, pelo header x-api-key (FILA_API_KEY). */
export function checkApiKey(request: Request): boolean {
  const expected = process.env["FILA_API_KEY"];
  const got = request.headers.get("x-api-key") ?? "";
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ROLES_FILA = ["superadmin", "comercial", "comercial_gerencial"];

/** Demais endpoints: login do PWA (Bearer do Supabase) com perfil que enxerga a Fila de Leads. */
export async function requireUser(request: Request): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return fail("Não autenticado", 401);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return fail("Não autenticado", 401);
  const { data: role } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!role || !ROLES_FILA.includes(role.role)) return fail("Acesso negado", 403);
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = JSON.parse((await request.text()).slice(0, 8 * 1024));
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
};

export const intId = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};
