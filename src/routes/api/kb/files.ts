import { createFileRoute } from "@tanstack/react-router";

// Aba "Arquivos": o que está no índice e a última sincronização.
export const Route = createFileRoute("/api/kb/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kb = await import("@/lib/kb/kb.server");
        const u = await kb.requireKbUser(request);
        if ("denied" in u) return u.denied;
        const [files, runs] = await Promise.all([
          kb.db
            .from("kb_files")
            .select(
              "file_id, name, folder, web_view_link, mime_type, modified_time, status, detail, chunks, indexed_at",
            )
            .order("folder")
            .order("name")
            .limit(5000),
          kb.db
            .from("kb_sync_runs")
            .select("id, started_at, finished_at, status, origem, stats")
            .order("id", { ascending: false })
            .limit(1),
        ]);
        if (files.error) return kb.fail("Falha ao consultar", 500);
        return kb.ok({ files: files.data ?? [], lastSync: runs.data?.[0] ?? null });
      },
    },
  },
});
