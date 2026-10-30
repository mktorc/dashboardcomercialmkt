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

/**
 * Página oculta "Precificação": acesso por e-mail, fora do mapa ACCESS (nenhum perfil, nem superadmin, a enxerga).
 * A proteção real é a RLS de pricing_study_report (migração 0042); isto só esconde menu e rota.
 */
export const PRICING_STUDY_EMAIL = "marketing@orlandorentcar.com";

export function canSeePricing(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase() === PRICING_STUDY_EMAIL;
}

export async function getMyEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

/** Use em beforeLoad da rota /precificacao: quem não for o e-mail autorizado volta para a sua home. */
export async function guardPricingPage() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw redirect({ to: "/auth", search: { next: undefined } });
  if (canSeePricing(data.user.email)) return;
  const role = await getMyRole();
  throw redirect(role ? { to: HOME[role] } : { to: "/auth", search: { next: undefined } });
}
