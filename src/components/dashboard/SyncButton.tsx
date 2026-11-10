import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { syncAll } from "@/lib/sync-all.functions";

const KEY = "last-sync-at";

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function format(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

/** `fn` troca o conjunto de syncs disparado (padrão: todos); a precificação usa só HQ e Rate Calendar. */
export function SyncButton({
  fn = syncAll,
  ultimaAtualizacao,
}: {
  fn?: typeof syncAll;
  /** Quando informado, o horário exibido vem dos próprios dados (ex.: precificação) em vez do último sync registrado. */
  ultimaAtualizacao?: { value: string | null; loading: boolean; detalhe?: string };
} = {}) {
  const run = useServerFn(fn);
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [last, setLast] = useState<string | null>(readStored);

  // Última carga real (manual ou agendada): mais recente entre os syncs registrados em sync_runs.
  const { data: serverLast } = useQuery({
    queryKey: ["last-sync-server"],
    queryFn: async () => {
      const { data } = await supabase.from("sync_runs").select("last_success_at");
      const times = (data ?? [])
        .map((r) => Date.parse(r.last_success_at))
        .filter((t) => !Number.isNaN(t));
      return times.length ? new Date(Math.max(...times)).toISOString() : null;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!serverLast) return;
    const ts = Date.parse(serverLast);
    if (Number.isNaN(ts)) return;
    setLast((cur) => {
      if (cur && Date.parse(cur) >= ts) return cur;
      try {
        localStorage.setItem(KEY, serverLast);
      } catch {
        /* ignore */
      }
      return serverLast;
    });
  }, [serverLast]);

  async function onClick() {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { failed } = await run();
      if (failed.length) {
        console.error("Falhas no sync:", failed);
        toast.error(
          `Falha ao sincronizar: ${failed.map((x) => `${x.service}: ${x.error}`).join(" | ")}`,
        );
      } else {
        const now = new Date().toISOString();
        try {
          localStorage.setItem(KEY, now);
        } catch {
          /* ignore */
        }
        setLast(now);
        await queryClient.invalidateQueries();
        toast.success("Dados sincronizados com sucesso!");
      }
    } catch (e) {
      toast.error((e as Error).message || "Erro ao sincronizar");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {ultimaAtualizacao ? (
        <span className="text-xs text-foreground/60" title={ultimaAtualizacao.detalhe}>
          Última atualização:{" "}
          {ultimaAtualizacao.loading
            ? "…"
            : ultimaAtualizacao.value
              ? format(ultimaAtualizacao.value)
              : "sem dados"}
        </span>
      ) : last ? (
        <span className="text-xs text-foreground/60">Última atualização: {format(last)}</span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={isSyncing}
        className="bg-card"
      >
        <RefreshCw className={`mr-1 size-4 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Sincronizando..." : "Sincronizar"}
      </Button>
    </div>
  );
}
