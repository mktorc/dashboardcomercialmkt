import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

export async function fetchAllFrom<T>(
  sb: SupabaseClient,
  table: string,
  cols: string,
  filter: (q: Q) => Q,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await filter(sb.from(table).select(cols)).range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}
