import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Telas que se atualizam sozinhas.
// 1) Tempo real: o Supabase Realtime avisa quando os webhooks/syncs gravam nestas tabelas e as consultas da tela
//    são recarregadas. Requer as tabelas na publicação supabase_realtime (sql-para-gravar/realtime_telas.sql).
// 2) Reserva: a cada 5 min, com a aba visível, recarrega tudo (cobre o Realtime desligado ou a conexão caída).
// Os webhooks do ClickMassa chegam em rajadas (vários por minuto): as recargas são agrupadas e espaçadas.
const TABELAS = [
  "crm_leads",
  "crm_opportunities",
  "reservations",
  "reservation_segments",
  "reservas",
] as const;
const AGRUPAR_MS = 5_000; // espera a rajada terminar
const INTERVALO_MIN_MS = 30_000; // no máximo uma recarga a cada 30 s
const RESERVA_MS = 5 * 60_000;

export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ultima = 0;
    const recarregar = () => {
      timer = null;
      ultima = Date.now();
      // Só as consultas ativas (da tela aberta) são refeitas; as outras ficam marcadas como velhas.
      void qc.invalidateQueries();
    };
    const agendar = () => {
      if (timer) return;
      const espera = Math.max(AGRUPAR_MS, ultima + INTERVALO_MIN_MS - Date.now());
      timer = setTimeout(recarregar, espera);
    };

    let canal = supabase.channel("telas-ao-vivo");
    for (const table of TABELAS)
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table }, agendar);
    canal.subscribe();

    const reserva = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - ultima >= RESERVA_MS) agendar();
    }, RESERVA_MS);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(reserva);
      void supabase.removeChannel(canal);
    };
  }, [qc]);
}
