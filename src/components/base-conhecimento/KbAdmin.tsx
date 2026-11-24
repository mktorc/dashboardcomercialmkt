import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { kbApi } from "./kb-api";

type KbFile = {
  file_id: string;
  name: string;
  folder: string;
  area: "comercial" | "cs" | "compartilhado";
  category: string;
  web_view_link: string | null;
  modified_time: string | null;
  status: "indexado" | "ignorado" | "vazio" | "erro";
  detail: string | null;
  chunks: number;
};
type SyncRun = {
  started_at: string;
  finished_at: string | null;
  status: string;
  origem: string;
  stats: Record<string, unknown>;
};

const STATUS: Record<KbFile["status"], { label: string; cls: string }> = {
  indexado: { label: "Indexado", cls: "border-primary/40 bg-primary/15 text-primary" },
  vazio: { label: "Sem texto", cls: "text-muted-foreground" },
  ignorado: { label: "Ignorado", cls: "text-muted-foreground" },
  erro: { label: "Erro", cls: "border-destructive/40 bg-destructive/15 text-destructive" },
};
const RUN_LABEL: Record<string, string> = {
  ok: "concluída",
  parcial: "parcial (o restante entra na próxima)",
  erro: "com erro",
  rodando: "em andamento",
};
const AREA_LABEL = { comercial: "Comercial", cs: "CS", compartilhado: "Compartilhado" } as const;

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function KbAdmin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<KbFile["area"] | "todas">("todas");
  const files = useQuery({
    queryKey: ["kb-files"],
    queryFn: () => kbApi<{ files: KbFile[]; lastSync: SyncRun | null }>("files"),
  });
  const sync = useMutation({
    mutationFn: () =>
      kbApi<{ status: string; stats: Record<string, number | string> }>("sync", { method: "POST" }),
    onSuccess: (r) => {
      const s = r.stats;
      if (r.status === "erro")
        toast.error(`Sincronização com erro: ${s["erro"] ?? "motivo desconhecido"}`);
      else
        toast.success(
          `Sincronização ${RUN_LABEL[r.status] ?? r.status}: ${s["indexados"] ?? 0} atualizado(s), ${s["sem_mudanca"] ?? 0} sem mudança, ${s["erros"] ?? 0} erro(s).`,
        );
      void qc.invalidateQueries({ queryKey: ["kb-files"] });
      void qc.invalidateQueries({ queryKey: ["kb-area"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (files.data?.files ?? []).filter((f) => tab === "todas" || f.area === tab);
  const last = files.data?.lastSync;
  const groups = new Map<string, KbFile[]>();
  for (const f of list) {
    const k = `${AREA_LABEL[f.area] ?? f.area} › ${f.category}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const count = (a: KbFile["area"]) => (files.data?.files ?? []).filter((f) => f.area === a).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 bg-background px-4 py-8 sm:px-8">
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link to="/base-conhecimento">
          <ArrowLeft className="mr-1 size-4" /> Base de Conhecimento
        </Link>
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Administração da base
          </h1>
          <p className="text-sm text-muted-foreground">
            Última sincronização:{" "}
            {last
              ? `${fmt(last.finished_at ?? last.started_at)} (${last.origem === "cron" ? "automática" : "manual"}, ${RUN_LABEL[last.status] ?? last.status})`
              : "nunca"}
          </p>
          {last?.status === "erro" && typeof last.stats["erro"] === "string" && (
            <p className="text-sm text-destructive">Motivo: {last.stats["erro"]}</p>
          )}
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`mr-1.5 size-4 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Sincronizando…" : "Sincronizar"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["todas", "comercial", "cs", "compartilhado"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setTab(a)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              tab === a
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {a === "todas"
              ? `Todas (${files.data?.files.length ?? 0})`
              : `${AREA_LABEL[a]} (${count(a)})`}
          </button>
        ))}
      </div>

      {files.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : files.isError ? (
        <Card className="p-5 text-sm text-destructive">{(files.error as Error).message}</Card>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum arquivo aqui ainda. Clique em “Sincronizar” para ler as pastas do Drive.
          </p>
        </Card>
      ) : (
        [...groups.entries()].map(([g, fs]) => (
          <section key={g} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{g}</h2>
            <Card className="divide-y divide-border">
              {fs.map((f) => (
                <div
                  key={f.file_id}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.web_view_link ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
                    >
                      <span className="truncate">{f.name}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </a>
                    <p className="truncate text-xs text-muted-foreground">
                      Alterado em {fmt(f.modified_time)}
                    </p>
                    {f.detail && f.status !== "indexado" && (
                      <p className="line-clamp-2 text-xs text-muted-foreground" title={f.detail}>
                        {f.detail}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={`w-fit ${STATUS[f.status].cls}`}>
                    {STATUS[f.status].label}
                    {f.status === "indexado"
                      ? ` · ${f.chunks} trecho${f.chunks === 1 ? "" : "s"}`
                      : ""}
                  </Badge>
                </div>
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
