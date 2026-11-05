import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Role = "superadmin" | "comercial" | "marketing" | "comercial_gerencial" | "financeiro";
const ROLES: Role[] = ["superadmin", "comercial", "marketing", "comercial_gerencial", "financeiro"];

async function assertSuperadmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
  if (error || !data) throw new Error("Acesso negado");
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const map = new Map((roles ?? []).map((r) => [r.user_id, r.role as Role]));
    return data.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: map.get(u.id) ?? null,
      lastSignIn: u.last_sign_in_at ?? null,
      isSelf: u.id === context.userId,
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; role: Role }) => {
    if (!d?.email?.includes("@")) throw new Error("E-mail inválido");
    if (!d.password || d.password.length < 6) throw new Error("Senha precisa de 6+ caracteres");
    if (!ROLES.includes(d.role)) throw new Error("Perfil inválido");
    return { email: d.email.trim().toLowerCase(), password: d.password, role: d.role };
  })
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Erro ao criar usuário");
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { ok: true };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; role?: Role; password?: string }) => {
    if (!d?.id) throw new Error("Usuário inválido");
    if (d.role && !ROLES.includes(d.role)) throw new Error("Perfil inválido");
    if (d.password && d.password.length < 6) throw new Error("Senha precisa de 6+ caracteres");
    return d;
  })
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context.supabase, context.userId);
    if (data.id === context.userId && data.role && data.role !== "superadmin")
      throw new Error("Você não pode remover seu próprio acesso de superadmin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.id, role: data.role }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    }
    if (data.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { password: data.password });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context.supabase, context.userId);
    if (data.id === context.userId) throw new Error("Você não pode excluir sua própria conta");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
