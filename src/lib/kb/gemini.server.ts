// Escolha de modelo do Gemini com reserva: se o principal estiver sobrecarregado (503) ou no
// limite (429), tenta os outros modelos "flash" que a chave aceita (lista vinda da própria API).
// Principal: gemini-4-hydrogen, o padrão do AI Studio para esta conta (o 3.8-flash vivia em 503).

const API = "https://generativelanguage.googleapis.com";

export const primaryModel = () => process.env["GEMINI_MODEL"] || "gemini-4-hydrogen";
// Reserva fixa testada no AI Studio desta conta; depois vêm os outros flash da lista da API.
const KNOWN_FALLBACK = "gemini-3.5-flash-lite";

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

/** Ordem de tentativa: principal, reserva fixa e até 6 outros da lista. */
export async function modelChain(apiKey: string): Promise<string[]> {
  const primary = primaryModel();
  const listed = await availableFlashModels(apiKey);
  const others = listed.filter((m) => m !== primary && m !== KNOWN_FALLBACK);
  // Até 6 outros: os mais novos costumam estar em 503 juntos com o principal.
  return [...new Set([primary, KNOWN_FALLBACK, ...others.slice(0, 6)])];
}

/**
 * Chama o Gemini percorrendo os modelos: em 503/429 tenta de novo uma vez e depois passa para o
 * próximo modelo; em 404 (modelo indisponível) pula direto. Devolve a primeira resposta boa.
 */
// Modelos que estouraram a cota (429) ficam de fora até a hora indicada pelo Google.
const exhausted = new Map<string, number>();

/** "Please retry in 14h17m34s" / "retryDelay": "38s" → milissegundos (padrão 1 h). */
function retryAfterMs(body: string): number {
  const m = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(body);
  if (m && (m[1] || m[2] || m[3]))
    return ((+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 1000;
  const d = /"retryDelay":\s*"([\d.]+)s"/.exec(body);
  return d ? +d[1]! * 1000 : 60 * 60_000;
}

export async function callWithFallback(
  apiKey: string,
  makeRequest: (model: string) => Promise<Response>,
  waitMs = 4_000,
): Promise<Response> {
  let last: Response | null = null;
  const chain = (await modelChain(apiKey)).filter((m) => (exhausted.get(m) ?? 0) < Date.now());
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, waitMs));
      last = await makeRequest(model);
      if (last.ok) return last;
      if (last.status === 404) break; // modelo não existe para esta chave
      if (last.status === 429) {
        // Cota do modelo acabou: não adianta insistir nele, vai para o próximo.
        const body = await last
          .clone()
          .text()
          .catch(() => "");
        exhausted.set(model, Date.now() + retryAfterMs(body));
        break;
      }
      if (last.status !== 503) return last; // erro de verdade: não insiste
    }
  }
  if (!last) {
    // Todos os modelos esgotados nesta instância: devolve um 429 explicativo.
    return new Response(
      JSON.stringify({
        error: { code: 429, message: "Cota diária gratuita esgotada em todos os modelos" },
      }),
      { status: 429 },
    );
  }
  return last;
}
