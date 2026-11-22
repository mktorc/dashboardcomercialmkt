import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  CONFIG_PADRAO,
  construirPerfil,
  tipoTexto,
  type ConfigPadrao,
  type DecisaoRegistrada,
  type Perfil,
} from "@/lib/padrao-aceite";

// Tabelas fora dos tipos gerados do Supabase.
type Solta = {
  select: (c: string) => {
    order: (c: string, o: object) => Promise<{ data: unknown[] | null; error: unknown }>;
    eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
  };
  upsert: (row: object) => Promise<{ error: { message: string } | null }>;
};
const de = (t: string) => (supabase as unknown as { from: (t: string) => Solta }).from(t);

type LinhaConfig = {
  min_decisoes: number;
  meia_vida_dias: number;
  ajustar_preco: boolean;
  ajuste_max: number;
  peso_ordem: number;
  zerado_em: string | null;
  desligados: string[];
};
const daLinha = (r: LinhaConfig): ConfigPadrao => ({
  minDecisoes: Number(r.min_decisoes),
  meiaVidaDias: Number(r.meia_vida_dias),
  ajustarPreco: r.ajustar_preco,
  ajusteMax: Number(r.ajuste_max),
  pesoOrdem: Number(r.peso_ordem),
  zeradoEm: r.zerado_em,
  desligados: r.desligados ?? [],
});
const paraLinha = (c: ConfigPadrao): LinhaConfig & { id: string; updated_at: string } => ({
  id: "padrao",
  min_decisoes: c.minDecisoes,
  meia_vida_dias: c.meiaVidaDias,
  ajustar_preco: c.ajustarPreco,
  ajuste_max: c.ajusteMax,
  peso_ordem: c.pesoOrdem,
  zerado_em: c.zeradoEm,
  desligados: c.desligados,
  updated_at: new Date().toISOString(),
});

const CHAVE = ["padrao-aceite"];

/** Decisões registradas + calibração salva → perfil de aceite. */
export function usePadraoAceite() {
  return useQuery({
    queryKey: CHAVE,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const [dec, cfg] = await Promise.all([
        de("pricing_decisions")
          .select(
            "decided_at,recommended_action,occ_signal,market_signal,signals,decision,applied_price,suggested_min,suggested_max",
          )
          .order("decided_at", { ascending: true }),
        de("pricing_pattern_settings").select("*").eq("id", "padrao").maybeSingle(),
      ]);
      const registros = ((dec.data ?? []) as DecisaoRegistrada[]).map((r) => ({
        ...r,
        applied_price: r.applied_price == null ? null : Number(r.applied_price),
        suggested_min: r.suggested_min == null ? null : Number(r.suggested_min),
        suggested_max: r.suggested_max == null ? null : Number(r.suggested_max),
      }));
      const salvo = !cfg.error && cfg.data ? daLinha(cfg.data as LinhaConfig) : null;
      return {
        registros,
        config: salvo ?? CONFIG_PADRAO,
        // Sem a tabela de calibração (SQL ainda não rodado), não dá para salvar.
        podeSalvar: !cfg.error,
        perfil: construirPerfil(registros, salvo ?? CONFIG_PADRAO),
      };
    },
  });
}

export function useRecarregarPadrao() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function SeuPadrao({
  perfil,
  config,
  podeSalvar,
}: {
  perfil: Perfil;
  config: ConfigPadrao;
  podeSalvar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rasc, setRasc] = useState<ConfigPadrao>(config);
  const [salvando, setSalvando] = useState(false);
  const recarregar = useRecarregarPadrao();
  const salvar = async (c: ConfigPadrao, msg = "Calibração salva.") => {
    setSalvando(true);
    const { error } = await de("pricing_pattern_settings").upsert(paraLinha(c));
    setSalvando(false);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setRasc(c);
    toast.success(msg);
    void recarregar();
  };
  const tipos = [...perfil.porTipo.values()].sort((a, b) => b.peso - a.peso);
  const desligados = config.desligados;
  const alternar = (k: string) =>
    salvar(
      {
        ...config,
        desligados: desligados.includes(k) ? desligados.filter((x) => x !== k) : [...desligados, k],
      },
      desligados.includes(k) ? "Tipo volta a ser aprendido." : "Tipo deixa de ser aprendido.",
    );
  const num = (k: keyof ConfigPadrao, label: string, dica: string, step = 1, fator = 1) => (
    <label className="flex flex-col gap-1 text-xs" title={dica}>
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        className="h-8 w-24"
        value={Math.round((rasc[k] as number) * fator * 100) / 100}
        onChange={(e) => setRasc({ ...rasc, [k]: Number(e.target.value) / fator })}
      />
    </label>
  );
  return (
    <section className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-3 text-sm">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-1 text-left font-semibold"
      >
        <span>{aberto ? "▾" : "▸"}</span> Seu padrão
        <span className="font-normal text-muted-foreground">
          {" "}
          · aprendido de {perfil.total} decis{perfil.total === 1 ? "ão" : "ões"}
          {config.zeradoEm
            ? ` desde ${config.zeradoEm.slice(8, 10)}/${config.zeradoEm.slice(5, 7)}`
            : ""}
        </span>
      </button>
      {aberto ? (
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted-foreground">
            Cada "Vou aplicar", "Outro preço" e "Não vou mexer" ensina o modelo. Com pelo menos{" "}
            {config.minDecisoes} decisões num tipo de sugestão, ele reordena a fila (o que você
            costuma aceitar sobe, o que costuma ignorar desce e ganha um aviso) e ajusta o preço
            sugerido quando você sempre aplica outro valor. Decisões recentes pesam mais. Nada
            altera tarifa.
          </p>
          {!podeSalvar ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A calibração ainda não pode ser salva: rode
              sql-para-gravar/pricing_pattern_settings.sql no Supabase. Até lá valem os valores
              padrão.
            </p>
          ) : null}
          {tipos.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2 font-normal">Tipo de sugestão</th>
                    <th className="px-2 font-normal">Decisões</th>
                    <th className="px-2 font-normal">Aceita</th>
                    <th className="px-2 font-normal">Outro preço</th>
                    <th className="px-2 font-normal">Não mexe</th>
                    <th className="px-2 font-normal">Preço aplicado × sugerido</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tipos.map((t) => (
                    <tr key={t.chave} className="border-t border-border">
                      <td className="py-1 pr-2">
                        {tipoTexto(t.partes)}
                        {t.peso < config.minDecisoes ? (
                          <span className="text-muted-foreground"> · aprendendo</span>
                        ) : null}
                      </td>
                      <td className="px-2 tabular-nums">{t.n}</td>
                      <td className="px-2 tabular-nums">{pct(t.aceitou / t.peso)}</td>
                      <td className="px-2 tabular-nums">{pct(t.ajustou / t.peso)}</td>
                      <td className="px-2 tabular-nums">{pct(t.ignorou / t.peso)}</td>
                      <td className="px-2 tabular-nums">
                        {t.razaoPreco == null
                          ? "—"
                          : `${t.razaoPreco >= 1 ? "+" : ""}${Math.round((t.razaoPreco - 1) * 100)}%`}
                      </td>
                      <td className="px-2 text-right">
                        <button
                          type="button"
                          disabled={!podeSalvar || salvando}
                          onClick={() => alternar(t.chave)}
                          className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          não aprender
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhuma decisão registrada ainda. Use os botões dos cartões da fila.
            </p>
          )}
          {desligados.length ? (
            <div className="space-y-1 text-xs">
              <p className="text-muted-foreground">Tipos que não são aprendidos:</p>
              {desligados.map((k) => {
                const [grupo, janela, occ, merc] = k.split("|") as [never, string, string, string];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span>{tipoTexto({ grupo, janela, occ, merc })}</span>
                    <button
                      type="button"
                      disabled={!podeSalvar || salvando}
                      onClick={() => alternar(k)}
                      className="text-muted-foreground underline-offset-2 hover:underline"
                    >
                      voltar a aprender
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            {num(
              "minDecisoes",
              "Mínimo de decisões",
              "Decisões num tipo antes de ele influenciar a fila e o preço.",
            )}
            {num(
              "meiaVidaDias",
              "Meia-vida (dias)",
              "Depois desse número de dias, uma decisão passa a valer a metade.",
            )}
            {num(
              "pesoOrdem",
              "Peso na ordem (%)",
              "Quanto o padrão muda a ordem da fila. 0 = não reordena.",
              5,
              100,
            )}
            {num(
              "ajusteMax",
              "Ajuste de preço máx. (%)",
              "Teto do ajuste de preço aprendido, para cima ou para baixo.",
              5,
              100,
            )}
            <label className="flex items-center gap-1.5 pb-2 text-xs">
              <input
                type="checkbox"
                checked={rasc.ajustarPreco}
                onChange={(e) => setRasc({ ...rasc, ajustarPreco: e.target.checked })}
              />
              Ajustar o preço sugerido
            </label>
            <Button
              size="sm"
              disabled={!podeSalvar || salvando}
              onClick={() =>
                salvar({
                  ...rasc,
                  minDecisoes: Math.max(1, rasc.minDecisoes),
                  meiaVidaDias: Math.max(1, Math.round(rasc.meiaVidaDias)),
                  pesoOrdem: Math.min(1, Math.max(0, rasc.pesoOrdem)),
                  ajusteMax: Math.min(0.5, Math.max(0, rasc.ajusteMax)),
                })
              }
            >
              Salvar calibração
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRasc({ ...CONFIG_PADRAO, zeradoEm: config.zeradoEm, desligados })}
            >
              Valores padrão
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!podeSalvar || salvando || !perfil.total}
              onClick={() => {
                if (
                  window.confirm(
                    "Zerar o padrão? As decisões continuam registradas, mas o modelo passa a aprender só com as próximas.",
                  )
                )
                  salvar({ ...config, zeradoEm: new Date().toISOString() }, "Padrão zerado.");
              }}
            >
              Zerar padrão
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
