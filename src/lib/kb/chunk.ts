// Divide o texto em trechos de ~800 tokens (≈ 4 caracteres por token) com sobreposição.
const CHUNK_CHARS = 3200;
const OVERLAP_CHARS = 480;

export function chunkText(raw: string): string[] {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return [];
  if (text.length <= CHUNK_CHARS) return [text];

  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    if (end < text.length) {
      // Corta num parágrafo, fim de frase ou espaço da segunda metade do trecho.
      const window = text.slice(start + CHUNK_CHARS / 2, end);
      const cut = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
        window.lastIndexOf(" "),
      );
      if (cut > 0) end = start + CHUNK_CHARS / 2 + cut + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return out;
}
