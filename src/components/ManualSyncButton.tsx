import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getLastReservationsSync, syncReservations } from "@/lib/sync-reservations.functions";

function format(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Botão de sincronização manual (reservas do HQ) para as telas públicas; recarrega os dados ao terminar. */
export function ManualSyncButton() {
  const run = useServerFn(syncReservations);
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const readLast = useServerFn(getLastReservationsSync);
  const { data: last } = useQuery({
    queryKey: ["last-sync-reservations"],
    queryFn: () => readLast(),
    staleTime: 60_000,
  });

  async function onClick() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await queryClient.invalidateQueries();
      toast.success(
        result.throttled
          ? "Dados já estavam atualizados (sincronizado há instantes)."
          : "Dados sincronizados com sucesso!",
      );
    } catch (e) {
      toast.error((e as Error).message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {last?.at ? (
        <span className="text-xs text-foreground/60">Última atualização: {format(last.at)}</span>
      ) : null}
      <Button size="sm" variant="outline" onClick={onClick} disabled={syncing} className="bg-card">
        <RefreshCw className={`mr-1 size-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando..." : "Sincronizar"}
      </Button>
    </div>
  );
}
