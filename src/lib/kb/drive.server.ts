// Leitura do Google Drive com a conta de serviço (somente leitura).
import { drive_v3, drive as makeDrive } from "@googleapis/drive";
import { JWT } from "google-auth-library";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  size: number | null;
  folder: string; // caminho: "Pasta raiz / Subpasta"
};

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

export function isSupported(f: Pick<DriveFile, "mimeType" | "name">): boolean {
  return (
    f.mimeType in EXPORTS ||
    f.mimeType === "application/pdf" ||
    f.mimeType === DOCX ||
    PLAIN.has(f.mimeType) ||
    PLAIN_EXT.test(f.name)
  );
}

export function folderIds(): string[] {
  return (process.env["DRIVE_FOLDER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let client: drive_v3.Drive | null = null;
export function driveClient(): drive_v3.Drive {
  if (client) return client;
  const b64 = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada");
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

  async function walk(folderId: string, path: string) {
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
          await walk(f.id, `${path} / ${f.name}`);
          continue;
        }
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? null,
          webViewLink: f.webViewLink ?? null,
          size: f.size ? Number(f.size) : null,
          folder: path,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  for (const id of folderIds()) {
    const root = await drive.files.get({ fileId: id, fields: "name", supportsAllDrives: true });
    await walk(id, root.data.name ?? id);
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
  if (f.size && f.size > MAX_BYTES) throw new Error("Arquivo maior que 100 MB");
  const res = await drive.files.get(
    { fileId: f.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const buf = Buffer.from(res.data as ArrayBuffer);
  if (f.mimeType === "application/pdf") {
    // lib/pdf-parse.js direto: o index.js do pacote roda um teste ao ser importado como ESM.
    const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
    return (await pdf(buf)).text;
  }
  if (f.mimeType === DOCX) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  return buf.toString("utf8");
}
