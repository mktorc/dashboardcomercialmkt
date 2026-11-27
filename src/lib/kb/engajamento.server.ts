// Engajamento da Base de Conhecimento (sql-para-gravar/base_conhecimento_engajamento.sql):
// visualizações por dia (kb_register_view já soma no dia), motivos do "Isso ajudou? Não"
// (kb_feedback_notes) e melhor nota do quiz por pessoa (kb_quiz_results).
import { db } from "./kb.server";

export type Note = {
  articleId: string;
  name?: string | undefined;
  reason: string;
  note: string;
  at: string;
};
export type QuizEntry = { name: string; best: number; total: number; tries: number };

const day = (d: Date) => d.toISOString().slice(0, 10);

async function nameOf(userId: string): Promise<string> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const u = data.user;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    const n = String(meta["full_name"] ?? meta["name"] ?? "").trim();
    return n || (u?.email ?? "").split("@")[0] || "Colaborador";
  } catch {
    return "Colaborador";
  }
}

/** Visualizações dos últimos 7 dias e dos 7 anteriores, por artigo. */
export async function viewTrend(): Promise<Record<string, { now: number; before: number }>> {
  const now = Date.now();
  const cut7 = day(new Date(now - 7 * 86_400_000));
  const cut14 = day(new Date(now - 14 * 86_400_000));
  const { data } = await db
    .from("kb_article_views_daily")
    .select("article_id, day, views")
    .gt("day", cut14)
    .limit(20_000);
  const out: Record<string, { now: number; before: number }> = {};
  for (const r of (data ?? []) as { article_id: string; day: string; views: number }[]) {
    const o = (out[r.article_id] ??= { now: 0, before: 0 });
    if (r.day > cut7) o.now += r.views;
    else o.before += r.views;
  }
  return out;
}

export async function addNote(n: {
  area: string;
  articleId: string;
  userId: string;
  reason: string;
  note: string;
}) {
  const { error } = await db.from("kb_feedback_notes").insert({
    area: n.area,
    article_id: n.articleId,
    user_id: n.userId,
    user_name: await nameOf(n.userId),
    reason: n.reason,
    note: n.note,
  });
  if (error) throw new Error(error.message);
}

export async function listNotes(area: string): Promise<Note[]> {
  const { data } = await db
    .from("kb_feedback_notes")
    .select("article_id, user_name, reason, note, created_at")
    .eq("area", area)
    .order("created_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as Record<string, string>[]).map((r) => ({
    articleId: r["article_id"]!,
    name: r["user_name"] ?? undefined,
    reason: r["reason"] ?? "",
    note: r["note"] ?? "",
    at: r["created_at"]!,
  }));
}

export async function saveQuiz(area: string, userId: string, score: number, total: number) {
  const { data: prev } = await db
    .from("kb_quiz_results")
    .select("best, tries")
    .eq("area", area)
    .eq("user_id", userId)
    .maybeSingle();
  const { error } = await db.from("kb_quiz_results").upsert({
    area,
    user_id: userId,
    user_name: await nameOf(userId),
    best: Math.max(prev?.best ?? 0, score),
    total,
    tries: (prev?.tries ?? 0) + 1,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function quizRanking(area: string): Promise<QuizEntry[]> {
  const { data } = await db
    .from("kb_quiz_results")
    .select("user_name, best, total, tries")
    .eq("area", area)
    .limit(200);
  return (
    (data ?? []) as { user_name: string | null; best: number; total: number; tries: number }[]
  )
    .map((r) => ({
      name: r.user_name ?? "Colaborador",
      best: r.best,
      total: r.total,
      tries: r.tries,
    }))
    .sort((a, b) => b.best / b.total - a.best / a.total || a.tries - b.tries);
}

export async function listMisses(area: string): Promise<{ q: string; hits: number; at: string }[]> {
  const { data } = await db
    .from("kb_search_misses")
    .select("q, hits, last_at")
    .eq("area", area)
    .order("hits", { ascending: false })
    .limit(30);
  return ((data ?? []) as { q: string; hits: number; last_at: string }[]).map((r) => ({
    q: r.q,
    hits: r.hits,
    at: r.last_at,
  }));
}
