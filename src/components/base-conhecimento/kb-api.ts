import { useEffect, useSyncExternalStore } from "react";
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

/** Passo de um procedimento. `sub`: passo a passo dentro do passo; `tpl`: templates a usar nele. */
export type Step = {
  title: string;
  text?: string;
  list?: string[];
  sub?: { title: string; text?: string; tpl?: string[] }[];
  tpl?: string[];
};
export type Block =
  | { t: "p" | "h" | "note" | "warn"; text: string }
  | { t: "list"; items: string[]; title?: string }
  | { t: "steps"; items: Step[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "img"; src: string; caption: string }
  | { t: "quote"; text: string; title?: string }
  | { t: "tags"; items: string[]; title?: string }
  | { t: "sub"; text: string }
  | { t: "cards"; items: { title: string; text: string; icon?: string }[] }
  | { t: "flow"; items: { title: string; when?: string }[] }
  | { t: "langs"; items: { label: string; text: string }[] }
  | { t: "keys"; items: { value: string; label: string }[] }
  | {
      t: "quiz";
      area: string;
      items: { q: string; options: string[]; correct: number; why: string; page: string }[];
    }
  | { t: "faq"; items: { q: string; a: string; pt: string; es: string }[] }
  | { t: "widget"; name: "fleet" | "calc" | "map" | "arrivals"; area: string }
  | { t: "thumb"; id: string; alt: string }
  | { t: "file"; name: string; link: string; kind: "video" | "image" | "doc" };

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
  /** Página revisada à mão (curadoria.ts). */
  curated?: boolean;
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
  categories: { id: string; title: string; description: string; parent?: string }[];
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

/** Atualizada nos últimos 7 dias (selo "Atualizado"). */
export const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() < 7 * 86_400_000;

/** Últimas páginas abertas neste navegador (só conveniência: pode vir vazio). */
export function recentViews(area: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`kb-recent:${area}`) ?? "[]") as string[];
  } catch {
    return [];
  }
}
export function pushRecentView(area: string, id: string) {
  try {
    const read = new Set(readPages(area));
    read.add(id);
    localStorage.setItem(`kb-read:${area}`, JSON.stringify([...read]));
    const list = [id, ...recentViews(area).filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(`kb-recent:${area}`, JSON.stringify(list));
  } catch {
    /* sem armazenamento: segue sem histórico */
  }
  void postProgress(area, { read: [id] });
}

/** Salva o progresso no servidor (vale em qualquer computador e alimenta o painel do gestor). */
export async function postProgress(area: string, p: { read?: string[]; favs?: string[] }) {
  try {
    const res = await fetch("/api/kb/feedback", {
      method: "POST",
      headers: { ...(await authHeader()), "content-type": "application/json" },
      body: JSON.stringify({ action: "progress", area, read: p.read ?? [], favs: p.favs }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { read: string[]; favs: string[] };
  } catch {
    return null;
  }
}

/** Ao abrir a área: junta o que está neste navegador com o que está salvo no servidor. */
export async function syncProgress(area: string) {
  const local = readPages(area);
  const merged = await postProgress(area, { read: local });
  if (!merged) return;
  try {
    localStorage.setItem(`kb-read:${area}`, JSON.stringify(merged.read));
    const favLocal = favRead(area);
    const favs = [...new Set([...favLocal, ...merged.favs])];
    if (favs.length !== favLocal.length) {
      favCache.set(area, favs);
      localStorage.setItem(`kb-fav:${area}`, JSON.stringify(favs));
      favSubs.forEach((f) => f());
      void postProgress(area, { favs });
    }
  } catch {
    /* ignora */
  }
}

/** Páginas já abertas neste navegador (trilha de onboarding). */
export function readPages(area: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`kb-read:${area}`) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Trilha de onboarding: o que o colaborador novo lê, em ordem. */
export const TRILHA: Record<KbArea, string[]> = {
  comercial: [
    "frota-visao-geral-comercial",
    "pagamento-condicoes",
    "retirada-regras-gerais",
    "seguro-e-franquia",
    "cancelamento-e-alteracoes",
    "reserva-cotacao",
    "reserva-lancamento-hq",
    "crm-tarefas",
    "regras-operacionais",
    "faq-cliente-comercial",
    "quiz-comercial",
  ],
  cs: [
    "rotina-de-dias-uteis",
    "processo-de-onboarding",
    "conferencia-e-orientacoes",
    "boa-viagem",
    "frota-visao-geral-cs",
    "formas-de-pagamento",
    "retirada-em-orlando",
    "politica-de-seguro-es",
    "politica-de-cancelamento-es",
    "faq-cliente-cs",
    "quiz-cs",
  ],
};

export type KbEngajamento = {
  trend: Record<string, { now: number; before: number }>;
  ranking: { name: string; best: number; total: number; tries: number }[];
  notes: { articleId: string; name?: string; reason: string; note: string; at: string }[];
  misses: { q: string; hits: number; at: string }[];
  ai: {
    total: number;
    answeredPct: number;
    up: number;
    down: number;
    top: { q: string; n: number; unanswered: number }[];
    unanswered: { q: string; name: string; at: string }[];
    disliked: { q: string; name: string; at: string }[];
    people: {
      name: string;
      total: number;
      unanswered: number;
      up: number;
      down: number;
      last: string;
    }[];
  } | null;
  team: {
    name: string;
    read: string[];
    firstAt: string;
    updatedAt: string;
    quiz: { best: number; total: number } | null;
  }[];
};
export function useKbEngajamento(area: KbArea) {
  return useQuery({
    queryKey: ["kb-engajamento", area],
    queryFn: () => kbApi<KbEngajamento>(`engajamento?area=${area}`),
    staleTime: 60_000,
  });
}

// ───── Favoritos (por navegador): estrela na página e seção no menu ─────
const favSubs = new Set<() => void>();
const favCache = new Map<string, string[]>();
function favRead(area: string): string[] {
  if (!favCache.has(area)) {
    try {
      favCache.set(area, JSON.parse(localStorage.getItem(`kb-fav:${area}`) ?? "[]") as string[]);
    } catch {
      favCache.set(area, []);
    }
  }
  return favCache.get(area)!;
}
export function toggleFavorite(area: string, id: string) {
  const cur = favRead(area);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  favCache.set(area, next);
  try {
    localStorage.setItem(`kb-fav:${area}`, JSON.stringify(next));
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
  favSubs.forEach((f) => f());
  void postProgress(area, { favs: next });
}
const EMPTY: string[] = [];
export function useFavorites(area: string): string[] {
  return useSyncExternalStore(
    (f) => {
      favSubs.add(f);
      return () => favSubs.delete(f);
    },
    () => favRead(area),
    () => EMPTY,
  );
}

/** Dia da revisão à mão (igual a CURADORIA_EM em src/lib/kb/curadoria.ts). */
export const CURADORIA_EM = "2026-11-27";

/** Busca sem nenhum resultado: registra o termo depois de 1,5 s parado (painel de saúde). */
export function useLogMiss(area: KbArea, q: string, empty: boolean) {
  useEffect(() => {
    const t = q.trim();
    if (!empty || t.length < 4) return;
    const h = setTimeout(() => {
      void kbApi("feedback", { method: "POST", body: { area, action: "miss", q: t } }).catch(
        () => {},
      );
    }, 1500);
    return () => clearTimeout(h);
  }, [area, q, empty]);
}
