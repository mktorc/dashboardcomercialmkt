// Leitura do Google Drive com a conta de serviço (somente leitura).
import { drive_v3, drive as makeDrive } from "@googleapis/drive";
import { Readable } from "stream";
import { JWT } from "google-auth-library";
import { hasGemini, mediaToText } from "./gemini-media.server";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  size: number | null;
  folder: string; // caminho: "Pasta raiz / Subpasta"
  area: FileArea; // de qual variável de pasta veio
  category: string; // primeira subpasta abaixo da raiz ("Geral" se estiver na raiz)
};

export type FileArea = "comercial" | "cs" | "compartilhado";

const FOLDER = "application/vnd.google-apps.folder";
const MAX_BYTES = 100 * 1024 * 1024; // PDFs cheios de imagem passam de 50 MB e ainda cabem na função

const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PLAIN = new Set(["text/plain", "text/markdown", "text/x-markdown", "text/csv"]);
const PLAIN_EXT = /\.(txt|md|markdown|csv)$/i;

// Vídeo e imagem viram texto pelo Gemini (precisa de GEMINI_API_KEY).
const VIDEO = new Set([
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-ms-wmv",
  "video/3gpp",
  "video/x-flv",
]);
const IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024; // 1 GB por vídeo
// PDF com menos que isso de texto por página é tratado como escaneado e lido pelo Gemini.
const PDF_MIN_CHARS_PER_PAGE = 300;

export function isMedia(f: Pick<DriveFile, "mimeType">): boolean {
  return VIDEO.has(f.mimeType) || IMAGE.has(f.mimeType);
}

export function isSupported(f: Pick<DriveFile, "mimeType" | "name">): boolean {
  return (
    (isMedia(f) && hasGemini()) ||
    f.mimeType in EXPORTS ||
    f.mimeType === "application/pdf" ||
    f.mimeType === DOCX ||
    PLAIN.has(f.mimeType) ||
    PLAIN_EXT.test(f.name)
  );
}

const ids = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Pastas por área. DRIVE_FOLDERS_COMERCIAL e DRIVE_FOLDERS_CS valem direto. DRIVE_FOLDER_IDS é uma
 * pasta raiz com subpastas "COMERCIAL" e "CS": a área vem do nome da subpasta, e o que estiver
 * fora delas não entra em nenhuma área. */
export function areaFolders(): { area: FileArea; id: string }[] {
  return [
    ...ids(process.env["DRIVE_FOLDERS_COMERCIAL"]).map((id) => ({
      area: "comercial" as const,
      id,
    })),
    ...ids(process.env["DRIVE_FOLDERS_CS"]).map((id) => ({ area: "cs" as const, id })),
    ...ids(process.env["DRIVE_FOLDER_IDS"]).map((id) => ({ area: "compartilhado" as const, id })),
  ];
}

export function folderIds(): string[] {
  return areaFolders().map((f) => f.id);
}

let client: drive_v3.Drive | null = null;
export function driveClient(): drive_v3.Drive {
  if (client) return client;
  const b64 = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!b64) {
    // Diagnóstico sem expor valores: quais variáveis da base o servidor enxerga (e o tamanho).
    const seen = [
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "DRIVE_FOLDER_IDS",
      "GEMINI_API_KEY",
      "KB_SYNC_SECRET",
    ]
      .map((k) => `${k}: ${process.env[k] ? `sim (${process.env[k]!.length})` : "não"}`)
      .join(", ");
    const similar = Object.keys(process.env).filter((k) => /GOOGLE|SERVICE|KB_|DRIVE/i.test(k));
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON não configurada. Vistas: ${seen}. Nomes parecidos: ${similar.join(", ") || "nenhum"}. Ambiente: ${process.env["VERCEL_ENV"] ?? "?"}`,
    );
  }
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  client = makeDrive({ version: "v3", auth });
  return client;
}

/** Lista todos os arquivos das pastas configuradas, descendo pelas subpastas. */
export async function listAllFiles(): Promise<DriveFile[]> {
  const drive = driveClient();
  const out: DriveFile[] = [];
  const seenFolders = new Set<string>();

  async function walk(folderId: string, path: string, area: FileArea, category: string | null) {
    if (seenFolders.has(folderId)) return;
    seenFolders.add(folderId);
    let pageToken: string | undefined;
    do {
      const params: drive_v3.Params$Resource$Files$List = {
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)",
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };
      const res = await drive.files.list(params);
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue;
        if (f.mimeType === FOLDER) {
          if (area === "compartilhado") {
            // Raiz compartilhada: a subpasta COMERCIAL ou CS define a área; as outras são ignoradas.
            const n = f.name.trim().toLowerCase();
            const sub: FileArea | null = n === "comercial" ? "comercial" : n === "cs" ? "cs" : null;
            if (sub) await walk(f.id, `${path} / ${f.name}`, sub, null);
            continue;
          }
          await walk(f.id, `${path} / ${f.name}`, area, category ?? f.name);
          continue;
        }
        if (area === "compartilhado") continue; // arquivo solto na raiz: sem área, não indexa
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? null,
          webViewLink: f.webViewLink ?? null,
          size: f.size ? Number(f.size) : null,
          folder: path,
          area,
          category: category ?? "Geral",
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  for (const { id, area } of areaFolders()) {
    const root = await drive.files.get({ fileId: id, fields: "name", supportsAllDrives: true });
    await walk(id, root.data.name ?? id, area, null);
  }
  return out;
}

/** Extrai o texto de um arquivo suportado. */
export async function extractText(f: DriveFile): Promise<string> {
  const drive = driveClient();
  const exportMime = EXPORTS[f.mimeType];
  if (exportMime) {
    const res = await drive.files.export(
      { fileId: f.id, mimeType: exportMime },
      { responseType: "text" },
    );
    return String(res.data ?? "");
  }
  if (VIDEO.has(f.mimeType)) {
    if (!f.size) throw new Error("Tamanho do vídeo desconhecido");
    if (f.size > MAX_MEDIA_BYTES) throw new Error("Vídeo maior que 1 GB");
    // Vai do Drive direto para o Gemini, sem carregar o vídeo inteiro na memória.
    const res = await drive.files.get(
      { fileId: f.id, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    const body = Readable.toWeb(res.data as Readable) as ReadableStream<Uint8Array>;
    const text = await mediaToText({
      kind: "video",
      body,
      size: f.size,
      mimeType: f.mimeType,
      name: f.name,
    });
    return text ? `[Vídeo: ${f.name}]\n${text}` : "";
  }
  if (f.size && f.size > MAX_BYTES) throw new Error("Arquivo maior que 100 MB");
  const res = await drive.files.get(
    { fileId: f.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const buf = Buffer.from(res.data as ArrayBuffer);
  if (f.mimeType === "application/pdf") {
    // unpdf: pdf.js empacotado para serverless (o pdf-parse quebrava no bundle do Vercel).
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text: pdfContent } = await pdfText(doc, { mergePages: true });
    const parsed = { numpages: totalPages, text: pdfContent };
    const pages = Math.max(1, parsed.numpages || 1);
    if (hasGemini() && parsed.text.trim().length / pages < PDF_MIN_CHARS_PER_PAGE) {
      // Conteúdo em imagem: o Gemini lê as páginas.
      const text = await mediaToText({
        kind: "pdf",
        body: buf,
        size: buf.length,
        mimeType: "application/pdf",
        name: f.name,
      });
      return text ? `[PDF lido pela IA: ${f.name}]\n${text}` : parsed.text;
    }
    return parsed.text;
  }
  if (IMAGE.has(f.mimeType)) {
    const text = await mediaToText({
      kind: "image",
      body: buf,
      size: buf.length,
      mimeType: f.mimeType,
      name: f.name,
    });
    return text ? `[Imagem: ${f.name}]\n${text}` : "";
  }
  if (f.mimeType === DOCX) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  return buf.toString("utf8");
}
