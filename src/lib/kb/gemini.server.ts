// Escolha de modelo do Gemini com reserva: se o principal estiver sobrecarregado (503) ou no
// limite (429), tenta os outros modelos "flash" que a chave aceita (lista vinda da própria API).

const API = "https://generativelanguage.googleapis.com";

export const primaryModel = () => process.env["GEMINI_MODEL"] || "gemini-3.8-flash";

let cached: { at: number; models: string[] } | null = null;

/** Modelos de texto/multimodal que a chave aceita, do mais novo para o mais antigo. */
async function availableFlashModels(apiKey: string): Promise<string[]> {
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.models;
  const names: string[] = [];
  let pageToken = "";
  try {
    do {
      const res = await fetch(
        `${API}/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`,
        { headers: { "x-goog-api-key": apiKey } },
      );
      if (!res.ok) break;
      const data = (await res.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of data.models ?? []) {
        const id = m.name.replace(/^models\//, "");
        if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
        if (!/flash/i.test(id)) continue;
        if (/image|tts|audio|live|embedding|thinking-exp|preview-\d{2}-\d{2}$/i.test(id)) continue;
        names.push(id);
      }
      pageToken = data.nextPageToken ?? "";
    } while (pageToken);
  } catch {
    /* sem lista: fica só com o principal */
  }
  // Mais novo primeiro (pelo número da versão), "lite" depois do normal da mesma versão.
  const version = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  names.sort((a, b) => version(b) - version(a) || Number(/lite/.test(a)) - Number(/lite/.test(b)));
  cached = { at: Date.now(), models: names };
  return names;
}

/** Ordem de tentativa: principal e depois até 3 reservas. */
export async function modelChain(apiKey: string): Promise<string[]> {
  const primary = primaryModel();
  const others = (await availableFlashModels(apiKey)).filter((m) => m !== primary);
  return [primary, ...others.slice(0, 3)];
}

/**
 * Chama o Gemini percorrendo os modelos: em 503/429 tenta de novo uma vez e depois passa para o
 * próximo modelo; em 404 (modelo indisponível) pula direto. Devolve a primeira resposta boa.
 */
export async function callWithFallback(
  apiKey: string,
  makeRequest: (model: string) => Promise<Response>,
  waitMs = 4_000,
): Promise<Response> {
  let last: Response | null = null;
  for (const model of await modelChain(apiKey)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, waitMs));
      last = await makeRequest(model);
      if (last.ok) return last;
      if (last.status === 404) break; // modelo não existe para esta chave
      if (last.status !== 503 && last.status !== 429) return last; // erro de verdade: não insiste
    }
  }
  return last!;
}
