import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type KbArea = "comercial" | "cs";

export const AREA_INFO: Record<
  KbArea,
  { title: string; short: string; description: string; greeting: string }
> = {
  comercial: {
    title: "Comercial",
    short: "Comercial",
    description: "Regras do time de vendas, condições de reserva, objeções e templates.",
    greeting: "Tudo o que o time comercial precisa para fechar a reserva.",
  },
  cs: {
    title: "Sucesso do Cliente (CS)",
    short: "CS",
    description: "Rotina do dia, etapas do acompanhamento do cliente e templates.",
    greeting: "O passo a passo do acompanhamento do cliente, da reserva à devolução.",
  },
};

export type Step = { title: string; text?: string; list?: string[] };
export type Block =
  | { t: "p" | "h" | "note" | "warn"; text: string }
  | { t: "list"; items: string[]; title?: string }
  | { t: "steps"; items: Step[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "img"; src: string; caption: string }
  | { t: "quote"; text: string; title?: string }
  | { t: "tags"; items: string[]; title?: string };

export type Article = {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywords: string;
  blocks: Block[];
  sources: string[];
  areas: KbArea[];
  shared: boolean;
  updatedAt: string;
};
export type Template = {
  title: string;
  text: string;
  variables: string[];
  source?: { name: string; link: string | null };
};
export type ArticleStats = { views: number; up: number; down: number; mine: number };
export type KbAreaData = {
  area: KbArea;
  areas: KbArea[];
  admin: boolean;
  generatedAt: string;
  categories: { id: string; title: string; description: string }[];
  sources: Record<string, { name: string; link: string }>;
  articles: Article[];
  images: Record<string, string>;
  stats: Record<string, ArticleStats>;
  templates: Template[];
};

export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export class KbHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function kbApi<T>(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`/api/kb/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      ...(await authHeader()),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new KbHttpError(json?.msg ?? "Erro na requisição", res.status);
  return json as T;
}

export const isArea = (v: string): v is KbArea => v === "comercial" || v === "cs";

export function useKbAreas() {
  return useQuery({
    queryKey: ["kb-areas"],
    queryFn: () =>
      kbApi<{ areas: KbArea[]; admin: boolean; counts: Record<string, number> }>("areas"),
    staleTime: 10 * 60_000,
  });
}

export function useKbArea(area: KbArea) {
  return useQuery({
    queryKey: ["kb-area", area],
    queryFn: () => kbApi<KbAreaData>(`articles?area=${area}`),
    staleTime: 15 * 60_000,
    retry: (n, e) => !(e instanceof KbHttpError && e.status === 403) && n < 2,
  });
}

export const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Link principal do Drive de um artigo (primeira fonte). */
export const driveLinkOf = (a: Article, data: KbAreaData) =>
  data.sources[a.sources[0] ?? ""]?.link ?? null;

/** Artigo que cita um arquivo do Drive (pelo id no link), para transformar fontes do chat em links. */
export function articleForFile(fileId: string, data: KbAreaData): Article | null {
  const keys = Object.entries(data.sources)
    .filter(([, s]) => s.link.includes(fileId))
    .map(([k]) => k);
  if (!keys.length) return null;
  // Prefere o artigo em que esse arquivo é a primeira fonte.
  return (
    data.articles.find((a) => keys.includes(a.sources[0] ?? "")) ??
    data.articles.find((a) => a.sources.some((s) => keys.includes(s))) ??
    null
  );
}
