// Transforma vídeo, imagem e PDF escaneado em texto com o Gemini, para entrar no índice.
// Arquivos grandes vão pela Files API do Gemini (upload resumível) e são apagados no final.

const API = "https://generativelanguage.googleapis.com";
const MODEL = () => process.env["GEMINI_MODEL"] || "gemini-2.5-flash";
const INLINE_MAX = 15 * 1024 * 1024; // até aqui a imagem vai direto no corpo da requisição

export const hasGemini = () => !!process.env["GEMINI_API_KEY"];

const PROMPT: Record<"video" | "image" | "pdf", string> = {
  video: `Este vídeo é material de treinamento interno de uma locadora de carros (Orlando Rent Car).
Gere um texto em português do Brasil que permita a alguém tirar dúvidas sem assistir ao vídeo:
1. "Resumo:" em 2 a 4 frases, dizendo o assunto do vídeo.
2. "Passo a passo:" com cada procedimento mostrado, na ordem, citando sistemas, telas, menus, botões e campos que aparecem.
3. "Transcrição:" com o que é falado, de forma fiel (pode limpar vícios de linguagem). Se não houver fala, escreva "sem fala".
4. "Textos na tela:" com informações relevantes que aparecem escritas (valores, regras, nomes).
Não invente nada que não esteja no vídeo.`,
  image: `Esta imagem faz parte da base de conhecimento interna de uma locadora de carros (Orlando Rent Car).
Em português do Brasil: transcreva todo o texto visível e descreva objetivamente o que a imagem mostra
(ex.: modelo do carro, informações de tabela, telas de sistema). Não invente nada.`,
  pdf: `Este PDF faz parte da base de conhecimento interna de uma locadora de carros (Orlando Rent Car) e tem
o conteúdo principalmente em imagens. Em português do Brasil, página por página ("Página N:"), transcreva todo o texto
visível e descreva tabelas, listas e informações relevantes. Não invente nada.`,
};

function key(): string {
  const k = process.env["GEMINI_API_KEY"];
  if (!k) throw new Error("GEMINI_API_KEY não configurada");
  return k;
}

async function geminiError(res: Response, what: string): Promise<Error> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`Gemini (${what}) ${res.status}: ${body}`);
}

/** Upload resumível para a Files API; devolve name e uri do arquivo no Gemini. */
async function uploadFile(
  body: Buffer | ReadableStream<Uint8Array>,
  size: number,
  mimeType: string,
  displayName: string,
): Promise<{ name: string; uri: string }> {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) throw await geminiError(start, "início do upload");

  const up = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: body as BodyInit,
    // Corpo em stream (vídeo vindo direto do Drive) exige duplex no fetch do Node.
    ...(body instanceof Buffer ? {} : { duplex: "half" }),
  } as RequestInit);
  if (!up.ok) throw await geminiError(up, "upload");
  const { file } = (await up.json()) as { file: { name: string; uri: string; state?: string } };

  // Vídeos ficam em PROCESSING por alguns segundos/minutos antes de poderem ser usados.
  let state = file.state;
  const deadline = Date.now() + 150_000;
  while (state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini demorou demais para processar o arquivo");
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`${API}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key() } });
    if (!st.ok) throw await geminiError(st, "status do arquivo");
    state = ((await st.json()) as { state?: string }).state;
  }
  if (state === "FAILED") throw new Error("Gemini não conseguiu processar o arquivo");
  return { name: file.name, uri: file.uri };
}

async function deleteFile(name: string) {
  await fetch(`${API}/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": key() },
  }).catch(() => {});
}

async function generate(part: Record<string, unknown>, prompt: string, lowRes: boolean) {
  const res = await fetch(`${API}/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [part, { text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
        // Resolução baixa: vídeo longo gasta ~1/3 dos tokens e cabe no limite gratuito.
        ...(lowRes ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw await geminiError(res, "leitura do arquivo");
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

/** Lê vídeo, imagem ou PDF com o Gemini e devolve o texto gerado. */
export async function mediaToText(opts: {
  kind: "video" | "image" | "pdf";
  body: Buffer | ReadableStream<Uint8Array>;
  size: number;
  mimeType: string;
  name: string;
}): Promise<string> {
  const { kind, body, size, mimeType, name } = opts;
  const prompt = `${PROMPT[kind]}\n\nNome do arquivo: ${name}`;
  if (kind === "image" && body instanceof Buffer && size <= INLINE_MAX) {
    return generate({ inlineData: { mimeType, data: body.toString("base64") } }, prompt, false);
  }
  const file = await uploadFile(body, size, mimeType, name);
  try {
    return await generate({ fileData: { mimeType, fileUri: file.uri } }, prompt, kind === "video");
  } finally {
    await deleteFile(file.name);
  }
}
