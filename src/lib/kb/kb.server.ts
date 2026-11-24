// Base de Conhecimento: autenticação, sincronização com o Drive e índice de busca.
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chunkText } from "./chunk";
import { extractText, isMedia, isSupported, listAllFiles, type DriveFile } from "./drive.server";
import { Bm25Searcher, type KbChunk, type Searcher } from "./search";

// As tabelas kb_* (sql-para-gravar/base_conhecimento.sql) ainda não estão em types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabaseAdmin as any;

export const ok = (body: Record<string, unknown> = {}, status = 200) =>
  Response.json({ ok: true, ...body }, { status });
export const fail = (msg: string, status = 400) => Response.json({ ok: false, msg }, { status });

// ---------------------------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------------------------

/** Usuário logado (Bearer do Supabase) com o módulo Base de Conhecimento ou Admin. */
export async function requireKbUser(
  request: Request,
): Promise<{ userId: string } | { denied: Response }> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { denied: fail("Não autenticado", 401) };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { denied: fail("Não autenticado", 401) };
  const { data: acc } = await supabaseAdmin
    .from("user_access")
    .select("modules, is_admin")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!acc || !(acc.is_admin || acc.modules.includes("base-conhecimento")))
    return { denied: fail("Acesso negado", 403) };
  return { userId: data.user.id };
}

/** Cron: Bearer igual a KB_SYNC_SECRET (ou CRON_SECRET, que é o que o Vercel Cron envia). */
export function isSyncSecret(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return [process.env["KB_SYNC_SECRET"], process.env["CRON_SECRET"]].some(
    (s) => !!s && timingSafeEqual(h(token), h(s)),
  );
}

// ---------------------------------------------------------------------------------------------
// Limite de requisições do /ask
// ---------------------------------------------------------------------------------------------
const ASK_LIMIT = 20;
const ASK_WINDOW_MIN = 10;

export async function checkAskLimit(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - ASK_WINDOW_MIN * 60_000).toISOString();
  const { count } = await db
    .from("kb_ask_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if ((count ?? 0) >= ASK_LIMIT) return false;
  await db.from("kb_ask_log").insert({ user_id: userId });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------------------------
const TIME_BUDGET_MS = 200_000; // a função tem 300 s; para antes e o resto fica para a próxima
// Vídeo (e PDF escaneado) pode levar ~2 min no Gemini: só começa se ainda sobrar tempo.
const MEDIA_START_MS = 100_000;

type FileRow = { file_id: string; modified_time: string | null; status: string };

export async function runSync(origem: "manual" | "cron") {
  const started = Date.now();
  const { data: run } = await db.from("kb_sync_runs").insert({ origem }).select("id").single();
  const stats = {
    encontrados: 0,
    indexados: 0,
    sem_mudanca: 0,
    ignorados: 0,
    erros: 0,
    removidos: 0,
    pendentes: 0,
    tipos_ignorados: {} as Record<string, number>,
  };
  let status = "ok";
  try {
    const files = await listAllFiles();
    stats.encontrados = files.length;

    const { data: existing } = await db
      .from("kb_files")
      .select("file_id, modified_time, status")
      .limit(100_000);
    const known = new Map<string, FileRow>(
      ((existing ?? []) as FileRow[]).map((r) => [r.file_id, r]),
    );

    // Arquivos que saíram das pastas (ou foram apagados): remove do índice.
    const seen = new Set(files.map((f) => f.id));
    const gone = [...known.keys()].filter((id) => !seen.has(id));
    if (gone.length) {
      await db.from("kb_files").delete().in("file_id", gone);
      stats.removidos = gone.length;
    }

    // Documentos primeiro, vídeos e imagens por último (são os mais lentos).
    files.sort((a, b) => Number(isMedia(a)) - Number(isMedia(b)));
    for (const f of files) {
      const prev = known.get(f.id);
      const unchanged =
        prev &&
        prev.status !== "erro" &&
        !(prev.status === "ignorado" && isSupported(f)) &&
        prev.modified_time &&
        f.modifiedTime &&
        new Date(prev.modified_time).getTime() === new Date(f.modifiedTime).getTime();
      if (unchanged) {
        if (prev.status === "ignorado") stats.ignorados++;
        else stats.sem_mudanca++;
        continue;
      }
      const elapsed = Date.now() - started;
      const slow = isMedia(f) || f.mimeType === "application/pdf";
      if (elapsed > TIME_BUDGET_MS || (slow && elapsed > MEDIA_START_MS)) {
        stats.pendentes++;
        continue;
      }
      if (!isSupported(f)) {
        console.log(`[kb] ignorado (${f.mimeType}): ${f.folder} / ${f.name}`);
        stats.ignorados++;
        stats.tipos_ignorados[f.mimeType] = (stats.tipos_ignorados[f.mimeType] ?? 0) + 1;
        await saveFile(f, "ignorado", `Tipo não suportado: ${f.mimeType}`, []);
        continue;
      }
      try {
        const chunks = chunkText(await extractText(f));
        await saveFile(f, chunks.length ? "indexado" : "vazio", null, chunks);
        stats.indexados++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[kb] erro em ${f.name}: ${msg}`);
        await saveFile(f, "erro", msg.slice(0, 500), []);
        stats.erros++;
      }
    }
    if (stats.pendentes) status = "parcial";
  } catch (e) {
    status = "erro";
    (stats as Record<string, unknown>)["erro"] = e instanceof Error ? e.message : String(e);
    console.error("[kb] sync falhou", e);
  }
  if (run?.id)
    await db
      .from("kb_sync_runs")
      .update({ status, stats, finished_at: new Date().toISOString() })
      .eq("id", run.id);
  invalidateIndex();
  return { status, stats };
}

async function saveFile(f: DriveFile, status: string, detail: string | null, chunks: string[]) {
  const { error } = await db.from("kb_files").upsert({
    file_id: f.id,
    name: f.name,
    folder: f.folder,
    web_view_link: f.webViewLink,
    mime_type: f.mimeType,
    modified_time: f.modifiedTime,
    status,
    detail,
    chunks: chunks.length,
    indexed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao gravar arquivo: ${error.message}`);
  await db.from("kb_chunks").delete().eq("file_id", f.id);
  for (let i = 0; i < chunks.length; i += 200) {
    const rows = chunks
      .slice(i, i + 200)
      .map((content, j) => ({ file_id: f.id, idx: i + j, content }));
    const { error: e2 } = await db.from("kb_chunks").insert(rows);
    if (e2) throw new Error(`Falha ao gravar trechos: ${e2.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Índice em memória (recarrega quando houver sincronização mais nova)
// ---------------------------------------------------------------------------------------------
let cache: { version: string; searcher: Searcher } | null = null;

function invalidateIndex() {
  cache = null;
}

async function indexVersion(): Promise<string> {
  const { data } = await db
    .from("kb_sync_runs")
    .select("id, finished_at")
    .not("finished_at", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? `${data.id}:${data.finished_at}` : "vazio";
}

export async function getSearcher(): Promise<Searcher> {
  const version = await indexVersion();
  if (cache?.version === version) return cache.searcher;

  const { data: files } = await db
    .from("kb_files")
    .select("file_id, name, folder, web_view_link, modified_time")
    .eq("status", "indexado")
    .limit(100_000);
  const meta = new Map<
    string,
    { name: string; folder: string; link: string | null; mod: string | null }
  >(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (files ?? []).map((f: any) => [
      f.file_id,
      { name: f.name, folder: f.folder, link: f.web_view_link, mod: f.modified_time },
    ]),
  );

  const chunks: KbChunk[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("kb_chunks")
      .select("id, file_id, idx, content")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      const m = meta.get(c.file_id);
      if (!m) continue;
      chunks.push({
        id: c.id,
        fileId: c.file_id,
        idx: c.idx,
        content: c.content,
        name: m.name,
        folder: m.folder,
        link: m.link,
        modifiedTime: m.mod,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  const searcher = new Bm25Searcher(chunks);
  cache = { version, searcher };
  return searcher;
}
