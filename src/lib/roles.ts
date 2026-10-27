import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "superadmin" | "comercial" | "marketing" | "comercial_gerencial";

export const ROLE_LABELS: Record<AppRole, string> = {
  superadmin: "Superadmin",
  comercial: "Comercial - Equipe",
  marketing: "Mkt - Equipe",
  comercial_gerencial: "Comercial - Gerencial",
};

export type PageKey = "dashboard" | "comercial" | "comercial-operacional" | "comissoes" | "configuracoes";

const ACCESS: Record<AppRole, PageKey[]> = {
  superadmin: ["dashboard", "comercial", "comercial-operacional", "comissoes", "configuracoes"],
  comercial: ["dashboard", "comercial", "comercial-operacional", "comissoes"],
  marketing: ["dashboard", "comercial", "comercial-operacional"],
  // Menu Comercial (Gerencial e Operacional) e Comissões; sem Marketing nem Configurações.
  comercial_gerencial: ["comercial", "comercial-operacional", "comissoes"],
};

export function canAccess(role: AppRole | null, page: PageKey) {
  return role ? ACCESS[role].includes(page) : false;
}

export const HOME: Record<AppRole, "/app/dashboard" | "/comercial" | "/comercial-operacional"> = {
  superadmin: "/app/dashboard",
  comercial: "/comercial-operacional",
  marketing: "/app/dashboard",
  comercial_gerencial: "/comercial",
};

export async function getMyRole(): Promise<AppRole | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .maybeSingle();
  return (data?.role as AppRole | undefined) ?? null;
}

/** Use em beforeLoad: redireciona se o perfil não tiver acesso à página. */
export async function guardPage(page: PageKey) {
  const role = await getMyRole();
  if (!role) {
    await supabase.auth.signOut();
    throw redirect({ to: "/auth", search: { next: undefined } });
  }
  if (!canAccess(role, page)) throw redirect({ to: HOME[role] });
  return { role };
}
