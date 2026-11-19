import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { MODULE_KEYS, type ModuleKey } from "@/lib/roles";

type AccessInput = { modules: ModuleKey[]; admin: boolean; canPay: boolean };

function validAccess(a: AccessInput | undefined): AccessInput {
  if (!a || !Array.isArray(a.modules)) throw new Error("Acesso inválido");
  const modules = [...new Set(a.modules)].filter((m) => MODULE_KEYS.includes(m));
  return { modules, admin: !!a.admin, canPay: !!a.canPay };
}

const toRow = (userId: string, a: AccessInput) => ({
  user_id: userId,
  modules: a.modules,
  is_admin: a.admin,
  can_pay: a.canPay,
  updated_at: new Date().toISOString(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente do middleware sem tipo exportado
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
    const { data: rows } = await supabaseAdmin
      .from("user_access")
      .select("user_id, modules, is_admin, can_pay");
    const map = new Map((rows ?? []).map((r) => [r.user_id, r]));
    return data.users.map((u) => {
      const r = map.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        access: r
          ? {
              modules: r.modules.filter((m): m is ModuleKey =>
                (MODULE_KEYS as string[]).includes(m),
              ),
              admin: r.is_admin,
              canPay: r.can_pay,
            }
          : null,
        lastSignIn: u.last_sign_in_at ?? null,
        isSelf: u.id === context.userId,
      };
    });
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; access: AccessInput }) => {
    if (!d?.email?.includes("@")) throw new Error("E-mail inválido");
    if (!d.password || d.password.length < 6) throw new Error("Senha precisa de 6+ caracteres");
    return {
      email: d.email.trim().toLowerCase(),
      password: d.password,
      access: validAccess(d.access),
    };
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
    const { error: aErr } = await supabaseAdmin
      .from("user_access")
      .insert(toRow(created.user.id, data.access));
    if (aErr) throw new Error(aErr.message);
    return { ok: true };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; access?: AccessInput; password?: string }) => {
    if (!d?.id) throw new Error("Usuário inválido");
    if (d.password && d.password.length < 6) throw new Error("Senha precisa de 6+ caracteres");
    return { id: d.id, password: d.password, access: d.access ? validAccess(d.access) : undefined };
  })
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context.supabase, context.userId);
    if (data.id === context.userId && data.access && !data.access.admin)
      throw new Error("Você não pode remover seu próprio acesso de Admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.access) {
      const { error } = await supabaseAdmin
        .from("user_access")
        .upsert(toRow(data.id, data.access), { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    }
    if (data.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
        password: data.password,
      });
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
