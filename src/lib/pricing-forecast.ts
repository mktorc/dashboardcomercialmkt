/** Previsão de ocupação por categoria e data, gerada por scripts/precificacao/previsao.py (campos abreviados para caber no JSON). */
export type ForecastRow = {
  d: string; // data (AAAA-MM-DD)
  c: string; // categoria
  f: number; // carros disponíveis na data
  v: number; // diárias já vendidas hoje para a data
  o: number; // ocupação hoje
  e: number; // ocupação esperada (mediana)
  lo: number; // esperada, quartil inferior
  hi: number; // esperada, quartil superior
  n: number; // observações históricas usadas
  b: string; // base do histórico (sazonalidade ou categoria)
  s: string; // sazonalidade da data
};
export type ForecastPayload = { gerado_em: string; hoje: string; ate: string; categorias: string[]; linhas: ForecastRow[] };

/** Total do dia: frota e vendas somadas; esperado = soma das diárias esperadas (cada categoria × sua frota) ÷ frota total. */
export function forecastTotal(rows: ForecastRow[]) {
  const f = rows.reduce((s, r) => s + r.f, 0);
  if (!f) return null;
  const w = (k: "v" | "e" | "lo" | "hi") => rows.reduce((s, r) => s + (k === "v" ? r.v : r[k] * r.f), 0) / f;
  return { f, v: rows.reduce((s, r) => s + r.v, 0), o: w("v"), e: w("e"), lo: w("lo"), hi: w("hi") };
}
