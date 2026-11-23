import type { Json } from "@/integrations/supabase/types";

// Resumo do payload de um webhook para a auditoria em `webhook_logs`.
// Guarda só o que identifica o evento (tipo e ids), os nomes dos campos e o tamanho. Não guarda o corpo completo:
// ele pesava ~5 KB por evento (a tabela chegou a 1,2 GB) e traz dados pessoais (nome, e-mail, telefone) que ninguém lê aqui.
// O estado real fica nas tabelas de negócio (crm_leads, reservations etc.); o ID permite rebuscar o item na origem.

const TEXTOS = ["event", "event_type", "type", "action", "item"] as const;
const IDS: string[][] = [
  ["id"],
  ["contactId"],
  ["lead_id"],
  ["data", "id"],
  ["ticket", "id"],
  ["ticket", "contact", "id"],
];

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function caminho(obj: Record<string, unknown>, path: string[]): unknown {
  let atual: unknown = obj;
  for (const k of path) {
    if (!ehObjeto(atual)) return undefined;
    atual = atual[k];
  }
  return atual;
}

export function resumirPayload(payload: unknown, bytes: number): Json {
  if (!ehObjeto(payload)) return { bytes, formato: "invalido" };
  const resumo: Record<string, Json> = { bytes };
  for (const k of TEXTOS) {
    const v = payload[k];
    if (typeof v === "string" && v) resumo[k] = v.slice(0, 80);
  }
  const ids: Record<string, Json> = {};
  for (const path of IDS) {
    const v = caminho(payload, path);
    if (typeof v === "string" || typeof v === "number")
      ids[path.join(".")] = String(v).slice(0, 80);
  }
  if (Object.keys(ids).length) resumo["ids"] = ids;
  resumo["campos"] = Object.keys(payload).slice(0, 30);
  return resumo;
}
