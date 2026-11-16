import { ToolError, type JsonValue, type ToolHandlerResult } from "@lovable.dev/mcp-js";
import { z } from "zod";
import type { McpDb, McpView } from "../supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Q = any;
export type Filter = (q: Q) => Q;

export const PAGE = 1000;
/** Teto de linhas lidas para agregações: acima disso a ferramenta pede um período menor. */
export const MAX_SCAN_ROWS = 50_000;
export const MAX_LIMIT = 500;

export const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const monthArg = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
export const textArg = z.string().trim().min(1).max(200);
export const pagingArgs = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(50)
    .describe(`Máx. de linhas (1–${MAX_LIMIT})`),
  offset: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .default(0)
    .describe("Deslocamento para a próxima página"),
};

export const endOfDay = (d: string) => `${d}T23:59:59.999Z`;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
export const ratio = (a: number, b: number) => (b ? round2(a / b) : null);

/** Termo para ilike sem curingas ou separadores do PostgREST. */
export const likeTerm = (v: string) => `%${v.replace(/[%_,()*\\]/g, "")}%`;

/** Intervalo de datas inclusivo (UTC) sobre uma coluna date ou timestamptz. */
export function range(col: string, from?: string, to?: string, timestamp = true): Filter {
  return (q) => {
    if (from) q = q.gte(col, from);
    if (to) q = timestamp ? q.lte(col, endOfDay(to)) : q.lte(col, to);
    return q;
  };
}

export const compose =
  (...fs: (Filter | false | "" | undefined)[]): Filter =>
  (q) =>
    fs.reduce<Q>((acc, f) => (f ? f(acc) : acc), q);

export function assertPeriod(from?: string, to?: string) {
  if (from && to && from > to) throw new ToolError("'from' deve ser anterior ou igual a 'to'");
}

/**
 * Lê todas as linhas que passam no filtro, em blocos de 1000 com ordem estável
 * (orderBy: coluna única ou lista "a,b" que identifique a linha).
 * Recusa passar de MAX_SCAN_ROWS para não sobrecarregar o banco.
 */
export async function fetchAllFrom<T>(
  sb: McpDb,
  view: McpView,
  cols: string,
  filter: Filter,
  orderBy: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += PAGE) {
    let q = filter(sb.from(view).select(cols));
    for (const c of orderBy.split(",")) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(i, i + PAGE - 1);
    if (error) throw new ToolError(`Erro ao consultar ${view}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    if (out.length >= MAX_SCAN_ROWS)
      throw new ToolError(
        `Consulta excede ${MAX_SCAN_ROWS} linhas em ${view}; reduza o período ou use filtros.`,
      );
  }
}

/** Busca linhas cuja coluna está numa lista de valores (em lotes, para não estourar a URL). */
export async function fetchIn<T>(
  sb: McpDb,
  view: McpView,
  cols: string,
  col: string,
  values: string[],
  orderBy: string,
): Promise<T[]> {
  const uniq = [...new Set(values.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 200) {
    const chunk = uniq.slice(i, i + 200);
    out.push(...(await fetchAllFrom<T>(sb, view, cols, (q) => q.in(col, chunk), orderBy)));
  }
  return out;
}

export type Page<T> = {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  rows: T[];
};

/** Uma página de linhas com total exato, ordenada por coluna permitida. */
export async function fetchPage<T>(
  sb: McpDb,
  view: McpView,
  cols: string,
  filter: Filter,
  opts: { sortBy: string; ascending: boolean; limit: number; offset: number },
): Promise<Page<T>> {
  const limit = Math.min(Math.max(1, opts.limit), MAX_LIMIT);
  const { data, error, count } = await filter(sb.from(view).select(cols, { count: "exact" }))
    .order(opts.sortBy, { ascending: opts.ascending, nullsFirst: false })
    .range(opts.offset, opts.offset + limit - 1);
  if (error) throw new ToolError(`Erro ao consultar ${view}: ${error.message}`);
  const rows = (data ?? []) as T[];
  return paginateMeta(rows, count ?? rows.length, limit, opts.offset);
}

export function paginateMeta<T>(rows: T[], total: number, limit: number, offset: number): Page<T> {
  const has_more = offset + rows.length < total;
  return {
    total,
    limit,
    offset,
    has_more,
    next_offset: has_more ? offset + rows.length : null,
    rows,
  };
}

/** Paginação em memória (para resultados já agregados). */
export function slicePage<T>(all: T[], limit: number, offset: number): Page<T> {
  return paginateMeta(all.slice(offset, offset + limit), all.length, limit, offset);
}

/** Agrupa e soma métricas numéricas. */
export function groupSum<T>(
  rows: T[],
  key: (r: T) => string,
  metrics: Record<string, (r: T) => number>,
): { key: string; count: number; [m: string]: number | string }[] {
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = key(r);
    const e =
      map.get(k) ?? Object.fromEntries([["count", 0], ...Object.keys(metrics).map((m) => [m, 0])]);
    e["count"]! += 1;
    for (const [m, f] of Object.entries(metrics)) e[m]! += f(r);
    map.set(k, e);
  }
  return [...map.entries()].map(([k, v]) => ({
    key: k,
    ...Object.fromEntries(Object.entries(v).map(([m, x]) => [m, round2(x)])),
    count: v["count"]!,
  }));
}

export const dayKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "(sem data)");
export const monthKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : "(sem data)");
export const label = (v: unknown, empty = "(vazio)") =>
  v == null || String(v).trim() === "" ? empty : String(v).trim();

export function ok(result: object): ToolHandlerResult {
  // Ida e volta por JSON: garante conteúdo serializável (sem undefined/Date) no structuredContent.
  const json = JSON.stringify(result);
  return {
    content: [{ type: "text", text: json }],
    structuredContent: JSON.parse(json) as { [key: string]: JsonValue },
  };
}

export const readOnly = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;
