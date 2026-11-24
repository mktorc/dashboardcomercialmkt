import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export type PageKey =
  | "dashboard"
  | "comercial"
  | "comercial-operacional"
  | "comissoes"
  | "configuracoes"
  | "fila-leads"
  | "frota"
  | "kb-comercial"
  | "kb-cs"
  // Página da Base de Conhecimento: liberada para quem tem qualquer uma das duas áreas.
  | "base-conhecimento";

/** Módulos que dá para marcar por usuário em Configurações (Configurações em si vem do Admin). */
export type ModuleKey = Exclude<PageKey, "configuracoes" | "base-conhecimento">;

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Marketing (Dashboard)",
  comercial: "Comercial - Gerencial",
  "comercial-operacional": "Comercial - Operacional",
  comissoes: "Comissões",
  "fila-leads": "Fila de Leads",
  frota: "Gestão de Frota",
  "kb-comercial": "Base de Conhecimento - Comercial",
  "kb-cs": "Base de Conhecimento - CS",
};
export const MODULE_KEYS = Object.keys(MODULE_LABELS) as ModuleKey[];

/** Acesso de um usuário: módulos marcados + Admin (tudo, inclusive Configurações) + pagar comissões. */
export type Access = { modules: ModuleKey[]; admin: boolean; canPay: boolean };

export function canAccess(access: Access | null, page: PageKey) {
  if (!access) return false;
  if (access.admin) return true;
  if (page === "configuracoes") return false;
  if (page === "base-conhecimento")
    return access.modules.includes("kb-comercial") || access.modules.includes("kb-cs");
  return access.modules.includes(page);
}

const HOME_ORDER: [ModuleKey, HomePath][] = [
  ["dashboard", "/app/dashboard"],
  ["comercial", "/comercial"],
  ["comercial-operacional", "/comercial-operacional"],
  ["fila-leads", "/fila-leads"],
  ["comissoes", "/app/comissoes/a-pagar"],
  ["frota", "/frota"],
  ["kb-comercial", "/base-conhecimento"],
  ["kb-cs", "/base-conhecimento"],
];
type HomePath =
  | "/app/dashboard"
  | "/comercial"
  | "/comercial-operacional"
  | "/fila-leads"
  | "/app/comissoes/a-pagar"
  | "/frota"
  | "/base-conhecimento";

/** Página inicial: o primeiro módulo liberado; sem nenhum, o hub. */
export function homeOf(access: Access): HomePath | "/app" {
  if (access.admin) return "/app";
  return HOME_ORDER.find(([m]) => access.modules.includes(m))?.[1] ?? "/app";
}

/** Áreas da Base de Conhecimento que o usuário pode abrir. */
export type KbArea = "comercial" | "cs";
export function kbAreasOf(access: Access | null): KbArea[] {
  if (!access) return [];
  if (access.admin) return ["comercial", "cs"];
  return (["comercial", "cs"] as const).filter((a) => access.modules.includes(`kb-${a}`));
}

export async function getMyAccess(): Promise<Access | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase
    .from("user_access")
    .select("modules, is_admin, can_pay")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    modules: (data.modules ?? []).filter((m): m is ModuleKey =>
      (MODULE_KEYS as string[]).includes(m),
    ),
    admin: data.is_admin,
    canPay: data.can_pay,
  };
}

/** Use em beforeLoad: redireciona se o usuário não tiver o módulo. */
export async function guardPage(page: PageKey) {
  const access = await getMyAccess();
  if (!access) {
    await supabase.auth.signOut();
    throw redirect({ to: "/auth", search: { next: undefined } });
  }
  if (!canAccess(access, page)) throw redirect({ to: homeOf(access) });
  return { access };
}

/**
 * Página oculta "Precificação": acesso por e-mail, fora dos módulos (nem o Admin a enxerga).
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
  const access = await getMyAccess();
  throw redirect(access ? { to: homeOf(access) } : { to: "/auth", search: { next: undefined } });
}
