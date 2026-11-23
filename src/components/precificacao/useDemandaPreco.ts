import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import {
  alertas,
  horaNY,
  pickup,
  prepararReservas,
  resumoProximos,
  sazonalidade,
  type NttoRow,
  type ReservaRow,
} from "@/lib/demanda-preco";

// ntto_chegadas e reservations.pick_up_location_id ainda não estão em types.ts (gerado).
const supabase = typedClient as unknown as SupabaseClient;

/** Reservas + NTTO e as análises de Orlando, compartilhadas pelas abas Demanda & Preço e Prioridades. */
export function useDemandaPreco() {
  const q = useQuery({
    queryKey: ["demanda-preco"],
    queryFn: async () => {
      const res = await fetchAll((a, b) =>
        supabase
          .from("reservations")
          .select(
            "reservation_id,created_at,pick_up_at,status,car_category,rental_days,total_amount,rack_rate,discount_amount,pick_up_location_id",
          )
          .order("id")
          .range(a, b),
      );
      if (res.error) throw res.error;
      const ntto = await supabase
        .from("ntto_chegadas")
        .select("mes,orlando,florida,preliminar")
        .order("mes");
      if (ntto.error) throw ntto.error;
      return { reservas: res.data as ReservaRow[], ntto: (ntto.data ?? []) as NttoRow[] };
    },
    staleTime: 5 * 60 * 1000,
  });
  const hoje = horaNY(new Date()).slice(0, 10);
  const dados = useMemo(() => {
    if (!q.data) return null;
    const rs = prepararReservas(q.data.reservas);
    const saz = sazonalidade(rs, q.data.ntto, hoje);
    const pk = pickup(rs, hoje);
    return {
      rs,
      saz,
      pk,
      al: alertas(rs, q.data.ntto, hoje, saz, pk),
      categorias: [...new Set(rs.map((r) => r.categoria))].sort(),
      resumo: resumoProximos(rs, hoje, 3),
      ultimoNtto: q.data.ntto.filter((n) => n.orlando != null).at(-1),
    };
  }, [q.data, hoje]);
  return { ...q, hoje, dados };
}
