// Busca todas as linhas paginando de 1000 em 1000 (limite padrão do banco).
type Page = PromiseLike<{ data: unknown[] | null; error: unknown }>;

export async function fetchAll(
  query: (from: number, to: number) => Page,
): Promise<{ data: unknown[]; error: Error | null }> {
  const size = 1000;
  const out: unknown[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query(from, from + size - 1);
    if (error) return { data: out, error: error as Error };
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return { data: out, error: null };
}
