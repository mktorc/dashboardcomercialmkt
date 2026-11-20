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
  "fleet_vehicles",
  "fleet_transfers_done",
] as const;
const AGRUPAR_MS = 5_000; // espera a rajada terminar
const INTERVALO_MIN_MS = 30_000; // no máximo uma recarga a cada 30 s
const RESERVA_MS = 5 * 60_000;
// Gestão de Frota: recarrega só a consulta da frota, com espera bem menor.
const TABELAS_FROTA = new Set<string>([
  "fleet_vehicles",
  "fleet_transfers_done",
  "reservation_segments",
]);
const FROTA_AGRUPAR_MS = 1_500;
const FROTA_INTERVALO_MIN_MS = 5_000;

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

    let timerFrota: ReturnType<typeof setTimeout> | null = null;
    let ultimaFrota = 0;
    const agendarFrota = () => {
      if (timerFrota) return;
      const espera = Math.max(FROTA_AGRUPAR_MS, ultimaFrota + FROTA_INTERVALO_MIN_MS - Date.now());
      timerFrota = setTimeout(() => {
        timerFrota = null;
        ultimaFrota = Date.now();
        void qc.invalidateQueries({ queryKey: ["frota"] });
      }, espera);
    };

    let canal = supabase.channel("telas-ao-vivo");
    for (const table of TABELAS)
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (TABELAS_FROTA.has(table)) agendarFrota();
        agendar();
      });
    canal.subscribe();

    const reserva = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - ultima >= RESERVA_MS) agendar();
    }, RESERVA_MS);

    return () => {
      if (timer) clearTimeout(timer);
      if (timerFrota) clearTimeout(timerFrota);
      clearInterval(reserva);
      void supabase.removeChannel(canal);
    };
  }, [qc]);
}
