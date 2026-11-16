import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DATASETS, DOMAINS, RELATIONSHIPS } from "../catalog";
import { assertMcpAccess, MCP_VIEWS } from "../supabase";
import { ok, readOnly } from "./paginate";

/** Mesma checagem de mcpDb (usuário, role e Bearer presente), sem abrir conexão: o catálogo é estático. */
function guard(ctx: Parameters<typeof assertMcpAccess>[0]) {
  assertMcpAccess(ctx);
  if (!ctx.getToken()) throw new ToolError("Usuário não autenticado");
}

export const listAvailableDatasets = defineTool({
  name: "list_available_datasets",
  title: "Conjuntos de dados disponíveis",
  description:
    "Lista os conjuntos de dados (views somente leitura) da Orlando Rent Car por domínio, com a ferramenta que consulta cada um e os relacionamentos válidos para cruzamentos.",
  inputSchema: { domain: z.enum(DOMAINS).optional().describe("Filtra por domínio") },
  annotations: readOnly,
  handler: async ({ domain }, ctx) => {
    guard(ctx);
    const datasets = DATASETS.filter((d) => !domain || d.domain === domain).map((d) => ({
      dataset: d.view,
      domain: d.domain,
      description: d.description,
      tools: d.tools,
    }));
    return ok({ datasets, relationships: RELATIONSHIPS });
  },
});

export const describeDataset = defineTool({
  name: "describe_dataset",
  title: "Descrever conjunto de dados",
  description: "Colunas, tipos, descrição, relacionamentos e ferramentas de um conjunto de dados.",
  inputSchema: { dataset: z.enum(MCP_VIEWS).describe("Nome da view, ex.: mcp_reservations") },
  annotations: readOnly,
  handler: async ({ dataset }, ctx) => {
    guard(ctx);
    const d = DATASETS.find((x) => x.view === dataset);
    if (!d) throw new ToolError("Conjunto de dados desconhecido");
    return ok({
      dataset: d.view,
      domain: d.domain,
      description: d.description,
      columns: d.columns.map(([name, type, description]) => ({
        name,
        type,
        ...(description ? { description } : {}),
      })),
      relationships: RELATIONSHIPS.filter(
        (r) => r.from.startsWith(`${d.view}.`) || r.to.includes(`${d.view}.`),
      ),
      tools: d.tools,
    });
  },
});
