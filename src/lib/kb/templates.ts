// Documento "Templates de mensagem" no Drive: cada título (Título 1/2/3 no Google Docs, que vira
// "#", "##"... no export em Markdown) é o nome do template; o texto até o próximo título é a mensagem.

export type KbTemplate = { title: string; text: string; variables: string[] };

/** Nome do documento que a sincronização procura em cada pasta de área. */
export const TEMPLATES_DOC_RE = /templates?\s+de\s+mensage(m|ns)/i;

/** Variáveis no texto: [NOME], {data}, {{valor}}. */
export const VARIABLE_RE = /\{\{[^{}\n]{1,40}\}\}|\{[^{}\n]{1,40}\}|\[[^[\]\n]{1,40}\]/g;

/** Tira o escape que o Google Docs coloca no Markdown (\[, \*, \_ ...) e espaços sobrando. */
function unescapeMd(s: string): string {
  return s
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function parseTemplatesMarkdown(md: string): KbTemplate[] {
  const out: KbTemplate[] = [];
  let title: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (!title) return;
    const text = unescapeMd(body.join("\n")).replace(/\n{3,}/g, "\n\n");
    if (text) {
      const variables = [...new Set(text.match(VARIABLE_RE) ?? [])];
      out.push({ title, text, variables });
    }
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      title = unescapeMd(h[1]!.replace(/\*\*/g, ""));
      body = [];
    } else if (title) {
      body.push(line);
    }
  }
  flush();
  return out;
}

/** Normaliza nome de template para casar "/Boa viagem CS" com "Boa viagem CS". */
export const templateKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^\//, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
