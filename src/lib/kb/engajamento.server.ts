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

// ───────────── ORCI: perguntas, notas e relatório do administrador ─────────────
export async function logQuestion(
  area: string,
  userId: string,
  question: string,
  answered: boolean,
): Promise<number | null> {
  const { data, error } = await db
    .from("kb_ai_questions")
    .insert({ area, user_id: userId, user_name: await nameOf(userId), question, answered })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: number }).id;
}

/** Nota 👍/👎 numa resposta: só quem perguntou pode dar. */
export async function rateQuestion(id: number, userId: string, rating: 1 | -1 | null) {
  const { error } = await db
    .from("kb_ai_questions")
    .update({ rating })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

const normQ = (q: string) =>
  q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type AiReport = {
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
};

export async function aiReport(area: string, days = 30): Promise<AiReport> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db
    .from("kb_ai_questions")
    .select("question, user_name, answered, rating, created_at")
    .eq("area", area)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(3000);
  const rows = (data ?? []) as {
    question: string;
    user_name: string | null;
    answered: boolean;
    rating: number | null;
    created_at: string;
  }[];
  const top = new Map<string, { q: string; n: number; unanswered: number }>();
  const people = new Map<string, AiReport["people"][number]>();
  for (const r of rows) {
    const k = normQ(r.question);
    const t = top.get(k) ?? { q: r.question, n: 0, unanswered: 0 };
    t.n++;
    if (!r.answered) t.unanswered++;
    top.set(k, t);
    const name = r.user_name ?? "Colaborador";
    const p = people.get(name) ?? {
      name,
      total: 0,
      unanswered: 0,
      up: 0,
      down: 0,
      last: r.created_at,
    };
    p.total++;
    if (!r.answered) p.unanswered++;
    if (r.rating === 1) p.up++;
    if (r.rating === -1) p.down++;
    people.set(name, p);
  }
  const answered = rows.filter((r) => r.answered).length;
  const pick = (f: (r: (typeof rows)[number]) => boolean) =>
    rows
      .filter(f)
      .slice(0, 20)
      .map((r) => ({ q: r.question, name: r.user_name ?? "Colaborador", at: r.created_at }));
  return {
    total: rows.length,
    answeredPct: rows.length ? Math.round((answered / rows.length) * 100) : 0,
    up: rows.filter((r) => r.rating === 1).length,
    down: rows.filter((r) => r.rating === -1).length,
    top: [...top.values()].sort((a, b) => b.n - a.n).slice(0, 15),
    unanswered: pick((r) => !r.answered),
    disliked: pick((r) => r.rating === -1),
    people: [...people.values()].sort((a, b) => b.total - a.total),
  };
}

// ───────────── Progresso por pessoa (trilha e favoritos) ─────────────
export async function getProgress(area: string, userId: string) {
  const { data } = await db
    .from("kb_progress")
    .select("read_ids, fav_ids")
    .eq("area", area)
    .eq("user_id", userId)
    .maybeSingle();
  return {
    read: (data?.read_ids as string[] | undefined) ?? [],
    favs: (data?.fav_ids as string[] | undefined) ?? [],
  };
}

/** Junta o que veio do navegador com o que está salvo: lidas somam; favoritos seguem o navegador. */
export async function saveProgress(
  area: string,
  userId: string,
  read: string[],
  favs: string[] | null,
) {
  const prev = await getProgress(area, userId);
  const merged = {
    read: [...new Set([...prev.read, ...read])].slice(0, 500),
    favs: (favs ?? prev.favs).slice(0, 200),
  };
  const { error } = await db.from("kb_progress").upsert({
    area,
    user_id: userId,
    user_name: await nameOf(userId),
    read_ids: merged.read,
    fav_ids: merged.favs,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return merged;
}

export type TeamRow = {
  name: string;
  read: string[];
  firstAt: string;
  updatedAt: string;
  quiz: { best: number; total: number } | null;
};

export async function teamProgress(area: string): Promise<TeamRow[]> {
  const [{ data: prog }, { data: quiz }] = await Promise.all([
    db
      .from("kb_progress")
      .select("user_id, user_name, read_ids, first_at, updated_at")
      .eq("area", area)
      .limit(500),
    db.from("kb_quiz_results").select("user_id, best, total").eq("area", area).limit(500),
  ]);
  const q = new Map(
    ((quiz ?? []) as { user_id: string; best: number; total: number }[]).map((r) => [r.user_id, r]),
  );
  return (
    (prog ?? []) as {
      user_id: string;
      user_name: string | null;
      read_ids: string[];
      first_at: string;
      updated_at: string;
    }[]
  ).map((r) => {
    const qq = q.get(r.user_id);
    return {
      name: r.user_name ?? "Colaborador",
      read: r.read_ids,
      firstAt: r.first_at,
      updatedAt: r.updated_at,
      quiz: qq ? { best: qq.best, total: qq.total } : null,
    };
  });
}
