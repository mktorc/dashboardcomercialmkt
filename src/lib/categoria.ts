/**
 * Chave de comparação de categoria: sem acentos, minúsculas e só letras e números ("Fullsize Suv" = "Fullsize SUV" = "full size suv").
 * Casa a tarifa (our_rate_snapshots) com a ocupação (payload do HQ) e com as coletas de concorrentes; a categoria exibida segue como veio.
 */
export const normCategoria = (c: string | null | undefined) =>
  (c ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Chave "data|categoria normalizada" dos mapas de tarifa e de coletas. */
export const rateKey = (date: string, category: string | null | undefined) => `${date}|${normCategoria(category)}`;
