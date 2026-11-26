// Busca todas as linhas paginando de 1000 em 1000 (limite padrão do banco).
// A primeira página vai sozinha; se vier cheia, as seguintes são pedidas em lotes paralelos.
type Page = PromiseLike<{ data: unknown[] | null; error: unknown }>;

const SIZE = 1000;
const PARALELO = 4;

export async function fetchAll(
  query: (from: number, to: number) => Page,
): Promise<{ data: unknown[]; error: Error | null }> {
  const out: unknown[] = [];
  const first = await query(0, SIZE - 1);
  if (first.error) return { data: out, error: first.error as Error };
  out.push(...(first.data ?? []));
  if (!first.data || first.data.length < SIZE) return { data: out, error: null };
  for (let page = 1; ; page += PARALELO) {
    const lote = await Promise.all(
      Array.from({ length: PARALELO }, (_, i) => {
        const from = (page + i) * SIZE;
        return query(from, from + SIZE - 1);
      }),
    );
    for (const { data, error } of lote) {
      if (error) return { data: out, error: error as Error };
      out.push(...(data ?? []));
      if (!data || data.length < SIZE) return { data: out, error: null };
    }
  }
}
