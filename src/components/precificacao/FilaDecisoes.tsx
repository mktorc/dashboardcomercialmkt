import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Info, Megaphone, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import {
  BASE_TXT,
  JANELA_BORDA,
  JANELA_DICA,
  JANELA_TXT,
  capturaEm,
  type CapturaDecisao,
} from "@/lib/captura-categoria";
import {
  DECISAO_PADRAO,
  DICA_REVISAR,
  GRUPOS,
  GRUPO_TXT,
  RULE_VERSION,
  carrosDiaTxt,
  dataCurta,
  decidirHoje,
  dinheiro,
  frases,
  grupoDe,
  proximaAbertura,
  avisos,
  movimentoPct,
  explicarConfianca,
  difFaixaPct,
  blocosPilares,
  cabecalho,
  contexto,
  etiquetaAcao,
  COR_BARRA,
  ETIQUETA_BLOCO,
  type BlocoPilar,
  type IconeAcao,
  linhaCompacta,
  separarFila,
  type Bloco,
  type Decisao,
  type GrupoAcao,
  type ResumoDia,
} from "@/lib/decisao";

const GRUPO_TOM: Record<GrupoAcao, string> = {
  baixar: "text-sky-700 dark:text-sky-300",
  subir: "text-emerald-700 dark:text-emerald-300",
  "acao-comercial": "text-amber-700 dark:text-amber-300",
  verificar: "text-muted-foreground",
  manter: "text-muted-foreground",
};
const FEITO_TXT = { aceitou: "vou aplicar", ajustou: "outro preço", ignorou: "não vou mexer" };

/* ───────────────────────── cards do topo ───────────────────────── */

export function ResumoDecisoes({ r, moeda }: { r: ResumoDia; moeda: string }) {
  const por = r.paraDecidirPor;
  const div = [
    por.baixar && `${por.baixar} baixar`,
    por.subir && `${por.subir} subir`,
    por["acao-comercial"] && `${por["acao-comercial"]} revisar canais`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Para decidir agora</div>
          <div className="text-2xl font-semibold tabular-nums">{r.paraDecidir}</div>
          <div className="text-xs text-muted-foreground">
            {div || "nenhuma em Agora/Última chance"}
            {r.aindaCedo ? ` · +${r.aindaCedo} ainda cedo` : ""}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Carros faltando</div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-fit cursor-help text-2xl font-semibold tabular-nums">
                {carrosDiaTxt(r.carrosAbaixoDia)} carros/dia · {r.datasAbaixo}{" "}
                {r.datasAbaixo === 1 ? "dia" : "dias"}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Faltam em média {carrosDiaTxt(r.carrosAbaixoDia)} carros por dia em {r.datasAbaixo}{" "}
              dias que ainda dá para recuperar (Agora e Última chance), comparado com o que
              costumava estar reservado nesta mesma antecedência; cada dia × categoria conta
              separado.
            </TooltipContent>
          </Tooltip>
          <div className="text-xs text-muted-foreground">abaixo do esperado, na janela de ação</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Receita em risco</div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-fit cursor-help text-2xl font-semibold tabular-nums text-red-700 dark:text-red-300">
                {dinheiro(r.receitaRisco, moeda)}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Quanto deixamos de faturar se os carros que faltam nesses dias não forem vendidos:
              carros abaixo do esperado × tarifa de hoje, só nas decisões de agora (Baixar e Revisar
              canais). Contando também as datas ainda cedo: {dinheiro(r.receitaRiscoTotal, moeda)}.
            </TooltipContent>
          </Tooltip>
          <div className="text-xs text-muted-foreground">
            se os carros que faltam não forem vendidos
          </div>
          {r.receitaPotencial > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-1 w-fit cursor-help text-xs text-emerald-600 dark:text-emerald-400">
                  + {dinheiro(r.receitaPotencial, moeda)} se aplicar as subidas sugeridas
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Ganho extra ao subir o preço nas datas que estão vendendo acima do esperado: carros
                acima do esperado × (preço sugerido − preço de hoje). É pequeno porque cada sugestão
                sobe só um passo de cada vez (5% a 10%, conforme a antecedência).
                {r.receitaPotencialTotal > r.receitaPotencial
                  ? ` Contando as datas ainda cedo: ${dinheiro(r.receitaPotencialTotal, moeda)}.`
                  : ""}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </Card>
      </div>
    </TooltipProvider>
  );
}

/* ───────────────────────── detalhes de tooltip ───────────────────────── */

const OCC_TXT = {
  abaixo: "abaixo da esperada",
  dentro: "dentro da esperada",
  acima: "acima da esperada",
};

function detalheOcupacao(d: Decisao) {
  return `Ocupação ${d.occ ? OCC_TXT[d.occ] : "—"}${d.gapPp != null ? ` (${d.gapPp > 0 ? "+" : ""}${d.gapPp.toFixed(0)} p.p.)` : ""}. Tolerância: ±5 p.p. ou ±1 carro. Frota ${d.frota}, ${d.vagos} livres. Ritmo 14 dias: ${d.ritmoAtual ?? "—"} contra ${d.ritmoRef?.toFixed(1) ?? "—"} na referência.`;
}
function detalheHistorico(d: Decisao, cur: string) {
  const f = d.hist.faixa;
  if (!f)
    return "Sem histórico suficiente: nenhuma faixa de diária com pelo menos 5 dias de amostra no mês nem na sazonalidade.";
  const ep = d.hist.rotulo ?? "nesta época";
  const pct = d.tarifa != null ? difFaixaPct(d.tarifa, f) : null;
  const pos =
    pct == null
      ? ""
      : pct === 0
        ? " Sua tarifa de hoje está dentro dessa faixa: o histórico não pede para mexer."
        : ` Sua tarifa de hoje está ${Math.abs(Math.round(pct))}% ${pct > 0 ? "acima" : "abaixo"} dessa faixa.`;
  return `Nos dias de ${ep} de anos anteriores, quando a diária paga ficou entre ${dinheiro(f.de, cur)} e ${Math.round(f.ate)}, cada carro faturou mais no dia (${dinheiro(f.revVeic, cur)} por carro, em ${f.datas} dias).${pos} Compara a tarifa de tabela de hoje com a diária efetivamente paga no passado; "dentro" aceita 5% de folga.`;
}
function detalheMercado(d: Decisao, cur: string) {
  const m = d.mercado;
  if (d.sinalMerc === "sem-mercado") return "Nenhuma cotação válida de concorrente para esta data.";
  return `Mediana ${m.mediana != null ? dinheiro(m.mediana, cur) : "—"} com ${m.n} concorrente(s); coleta ${m.idadeDias == null ? "—" : m.idadeDias === 0 ? "de hoje" : `há ${m.idadeDias} dia(s)`}. Alinhado = ±5%.`;
}

/** Curva de captura em miniatura, com a antecedência atual marcada. */
function MiniCurva({ c, lead }: { c: CapturaDecisao; lead: number }) {
  const W = 220;
  const H = 70;
  const maxL = Math.max(180, lead);
  const x = (L: number) => W - (Math.min(L, maxL) / maxL) * W;
  const y = (v: number) => H - v * H;
  const pts = Array.from({ length: 46 }, (_, i) => (maxL * i) / 45)
    .map((L) => `${x(L).toFixed(1)},${y(capturaEm(c, L)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={W}
      height={H + 14}
      className="text-foreground"
      role="img"
      aria-label="Curva de captura"
    >
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1={x(lead)} x2={x(lead)} y1={0} y2={H} stroke="rgb(239 68 68)" strokeDasharray="3 2" />
      <circle cx={x(lead)} cy={y(c.atual)} r="3" fill="rgb(239 68 68)" />
      <text x={0} y={H + 12} fontSize="9" fill="currentColor">
        D-{maxL}
      </text>
      <text x={W - 20} y={H + 12} fontSize="9" fill="currentColor">
        D-0
      </text>
      <text
        x={Math.min(Math.max(x(lead) - 14, 0), W - 40)}
        y={10}
        fontSize="9"
        fill="rgb(239 68 68)"
      >
        hoje D-{lead}
      </text>
    </svg>
  );
}

const AJUDA_CONFIANCA =
  "Mede só se os sinais concordam com a ação: alta quando ocupação, mercado e histórico apontam para ela; média quando um é neutro ou falta; baixa quando um contradiz. Problemas de dados (coleta antiga, equivalência, sazonalidade, evento) aparecem como avisos em âmbar.";

/* ───────────────────────── registro ───────────────────────── */

/**
 * Liga os botões "Vou aplicar", "Outro preço" e "Não vou mexer" (gravam em pricing_decisions).
 * Mude para true depois de rodar drizzle/migrations/0060_pricing_decisions.sql no Supabase.
 * Desligado, os botões aparecem desabilitados com "em breve".
 */
export const REGISTRO_DECISOES_ATIVO = true;

// pricing_decisions ainda não está nos tipos gerados do Supabase (migração 0060).
type TabelaSolta = {
  select: (c: string, o: object) => { limit: (n: number) => Promise<{ error: unknown }> };
  insert: (row: object) => Promise<{ error: { message: string } | null }>;
};
const tabela = {
  from: (t: string) => (supabase as unknown as { from: (t: string) => TabelaSolta }).from(t),
};

/** A tabela existe e é legível? Enquanto a migração 0060 não roda, os botões ficam desabilitados ("em breve"). */
function useRegistroDisponivel() {
  return useQuery({
    queryKey: ["pricing-decisions-disponivel"],
    enabled: REGISTRO_DECISOES_ATIVO,
    queryFn: async () => {
      const { error } = await tabela
        .from("pricing_decisions")
        .select("id", { head: true, count: "exact" })
        .limit(1);
      return !error;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

type Tomada = "aceitou" | "ajustou" | "ignorou";

async function salvar(
  b: Bloco,
  decisao: Tomada,
  preco: number | null,
  motivo: string | null,
  tarifaEm: string | null,
) {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  const row = {
    pickup_date_start: b.de,
    pickup_date_end: b.ate,
    category: b.category,
    lead_days: b.lead,
    occ_signal: d.occ,
    hist_signal: d.sinalHist,
    market_signal: d.sinalMerc,
    signals: {
      datas: b.itens.map((x) => ({
        date: x.date,
        lead: x.lead,
        occ: x.occ,
        gapPp: x.gapPp,
        gapCarros: x.gapCarros,
        ritmo: x.ritmo,
        ritmoAtual: x.ritmoAtual,
        ritmoRef: x.ritmoRef,
        hist: x.sinalHist,
        faixa: x.hist.faixa,
        histFonte: x.hist.fonte,
        evento: x.evento,
        mercado: x.sinalMerc,
        mediana: x.mercado.mediana,
        pct: x.mercado.pct,
        concorrentes: x.mercado.n,
        idadeColeta: x.mercado.idadeDias,
        tarifa: x.tarifa,
        sugerido: x.sugerido ? [x.sugerido.min, x.sugerido.max] : null,
        confianca: x.confianca,
        urgencia: x.urgencia,
        captura: x.captura
          ? {
              base: x.captura.base,
              datas: x.captura.datas,
              atual: x.captura.atual,
              falta: x.captura.falta,
              prox14: x.captura.prox14,
              janela: x.captura.janela,
              abre: x.captura.abre,
            }
          : null,
      })),
      janela: b.janela,
      carros: b.carros,
      receita: b.receita,
      urgencia: b.urgencia,
      config: DECISAO_PADRAO,
    },
    recommended_action: b.acao,
    confidence: b.confianca,
    rule_version: RULE_VERSION,
    current_rate: d.tarifa,
    tariff_snapshot_at: tarifaEm,
    suggested_min: b.sugMin,
    suggested_max: b.sugMax,
    decision: decisao,
    applied_price: preco,
    reason: motivo || null,
  };
  const { error } = await tabela.from("pricing_decisions").insert(row);
  if (error) throw error;
}

const NOTA_REGISTRO = "Só registra a decisão; não altera tarifas.";

function Acoes({
  b,
  ativo,
  tarifaEm,
  feito,
  onFeito,
  moeda,
}: {
  b: Bloco;
  ativo: boolean;
  tarifaEm: string | null;
  feito: Tomada | undefined;
  onFeito: (t: Tomada) => void;
  moeda: string;
}) {
  const [preco, setPreco] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  // "Vou aplicar" grava a ponta da sugestão mais próxima da tarifa atual (o movimento mais conservador).
  const aceitoPreco = b.sugMin == null ? null : grupoDe(b.acao) === "baixar" ? b.sugMax : b.sugMin;
  const go = async (t: Tomada, p: number | null, m: string | null) => {
    setEnviando(true);
    try {
      await salvar(b, t, p, m, tarifaEm);
      onFeito(t);
      toast.success("Decisão registrada (nenhuma tarifa foi alterada).");
    } catch (e) {
      toast.error(`Não foi possível registrar: ${(e as Error).message}`);
    } finally {
      setEnviando(false);
    }
  };
  if (feito)
    return (
      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
        ✓ {FEITO_TXT[feito]}
      </span>
    );
  const off = !ativo || enviando;
  const dica = (t: string) =>
    ativo ? `${t} ${NOTA_REGISTRO}` : "Em breve: o registro de decisões ainda não foi ligado.";
  const mov = movimentoPct(b);
  const sug =
    b.sugMin != null
      ? b.sugMin === b.sugMax
        ? dinheiro(b.sugMin, moeda)
        : `${mov != null && mov < 0 ? "−" : "+"}${Math.abs(Math.round(mov ?? 0))}%`
      : null;
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        disabled={off}
        title={dica(
          aceitoPreco != null
            ? `Registra que você vai aplicar ${dinheiro(aceitoPreco, moeda)} (preço sugerido).`
            : "Registra que você vai seguir a recomendação.",
        )}
        onClick={() => go("aceitou", aceitoPreco, null)}
      >
        {sug ? `Vou aplicar ${sug}` : "Vou seguir"}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={off} title={dica("Registra outro preço.")}>
            Outro preço
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2">
          <label className="block text-xs text-muted-foreground">Preço aplicado (diária)</label>
          <Input type="number" min={1} value={preco} onChange={(e) => setPreco(e.target.value)} />
          <Input
            placeholder="Motivo (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!(Number(preco) > 0) || enviando}
            onClick={() => go("ajustou", Number(preco), motivo)}
          >
            Registrar
          </Button>
          <p className="text-[11px] text-muted-foreground">{NOTA_REGISTRO}</p>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={off}
            title={dica("Registra que você não vai mexer, com motivo opcional.")}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            Não vou mexer
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2">
          <Input
            placeholder="Motivo (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={enviando}
            onClick={() => go("ignorou", null, motivo)}
          >
            Registrar
          </Button>
          <p className="text-[11px] text-muted-foreground">{NOTA_REGISTRO}</p>
        </PopoverContent>
      </Popover>
      {!ativo ? <span className="text-[11px] text-muted-foreground">em breve</span> : null}
    </div>
  );
}

/* ───────────────────────── fila ───────────────────────── */

const ICONE: Record<IconeAcao, typeof ArrowDown> = {
  baixar: ArrowDown,
  subir: ArrowUp,
  canais: Megaphone,
  verificar: AlertTriangle,
  manter: Minus,
};

function BlocoSinal({ p, detalheTooltip }: { p: BlocoPilar; detalheTooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="cursor-help overflow-hidden rounded-md border border-border bg-background/40"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`h-1 ${COR_BARRA[p.tom]}`} />
          <div className="space-y-0.5 p-2.5">
            <div className="text-[11px] text-muted-foreground">{p.nome}</div>
            <span
              className={`inline-block rounded border px-1.5 py-px text-[10px] font-medium ${ETIQUETA_BLOCO[p.tom].cor}`}
            >
              {ETIQUETA_BLOCO[p.tom].texto}
            </span>
            <div className="text-lg font-semibold tabular-nums leading-tight">{p.valor}</div>
            <div className="text-xs font-medium text-foreground">{p.conclusao}</div>
            {p.detalhe ? (
              <div className="truncate text-[11px] text-muted-foreground">{p.detalhe}</div>
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{detalheTooltip}</TooltipContent>
    </Tooltip>
  );
}

function Cartao({
  b,
  moeda,
  onOpen,
  ativo,
  tarifaEm,
  feito,
  onFeito,
}: {
  b: Bloco;
  moeda: string;
  onOpen: (d: Decisao) => void;
  ativo: boolean;
  tarifaEm: string | null;
  feito: Tomada | undefined;
  onFeito: (t: Tomada) => void;
}) {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  const f = frases(b, moeda);
  const av = avisos(d);
  const cab = cabecalho(b);
  const acao = etiquetaAcao(b, moeda);
  const Icone = ICONE[acao.icone];
  const [po, pm, ph] = blocosPilares(b, moeda);
  const borda = b.janela ? JANELA_BORDA[b.janela] : "border-border";
  const totalTxt = `Total do bloco: ${b.carros > 0 ? "+" : ""}${b.carros} carro-dias${b.receitaRisco ? ` · ${dinheiro(b.receitaRisco, moeda)} em risco` : ""}${b.receitaPotencial ? ` · ${dinheiro(b.receitaPotencial, moeda)} potencial` : ""}.`;
  const confTxt = f.confianca.split(":")[0]!;
  const explicacao = explicarConfianca(d);
  const etiqueta = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium ${acao.cor}`}
    >
      <Icone className="size-4" />
      {acao.texto}
    </span>
  );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(d)}
      className={`cursor-pointer rounded-lg border-2 p-4 text-sm hover:bg-muted/40 ${borda}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-semibold">{cab.titulo}</span>{" "}
          <span className="text-xs text-muted-foreground">{cab.sub}</span>
        </div>
        {b.janela ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`shrink-0 cursor-help rounded border px-1.5 py-0.5 text-[11px] font-medium ${borda}`}
                onClick={(e) => e.stopPropagation()}
              >
                {JANELA_TXT[b.janela]}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{JANELA_DICA[b.janela]}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="mt-2">
        {acao.icone === "canais" || d.verificarMotivo ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help" onClick={(e) => e.stopPropagation()}>
                {etiqueta}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {acao.icone === "canais" ? DICA_REVISAR : d.verificarMotivo}
            </TooltipContent>
          </Tooltip>
        ) : (
          etiqueta
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <BlocoSinal p={po} detalheTooltip={`${detalheOcupacao(d)} ${totalTxt}`} />
        <BlocoSinal p={pm} detalheTooltip={detalheMercado(d, moeda)} />
        <BlocoSinal p={ph} detalheTooltip={detalheHistorico(d, moeda)} />
      </div>
      {b.captura ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <p
              className="mt-2 w-fit cursor-help text-xs text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              {contexto(b, moeda)}
            </p>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            <MiniCurva c={b.captura} lead={b.itens[0]!.lead} />
            <div>
              Curva da categoria ({BASE_TXT[b.captura.base]}, {b.captura.datas} datas encerradas).
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{contexto(b, moeda)}</p>
      )}
      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help font-medium" onClick={(e) => e.stopPropagation()}>
                {confTxt}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              <p className="font-medium">{explicacao.resumo}</p>
              {explicacao.linhas.map((l) => (
                <p key={l}>{l}</p>
              ))}
              <p className="mt-1 text-muted-foreground">
                Confiança mede só se os sinais concordam; problemas de dados aparecem nos avisos em
                âmbar.
              </p>
            </TooltipContent>
          </Tooltip>
          {av.principais.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-help text-amber-600 dark:text-amber-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  · ⚠ {av.principais.join(" · ")}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Qualidade dos dados (não muda a confiança).
                {av.permanentes.length ? ` Também: ${av.permanentes.join(", ")}.` : ""}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="self-end md:self-auto">
          <Acoes
            b={b}
            ativo={ativo}
            tarifaEm={tarifaEm}
            feito={feito}
            onFeito={onFeito}
            moeda={moeda}
          />
        </div>
      </div>
    </div>
  );
}

/** Uma linha para "Ainda cedo" e "Janela passou": sem preço e sem botões. */
function LinhaCompacta({ b, onOpen }: { b: Bloco; onOpen: (d: Decisao) => void }) {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  return (
    <button
      type="button"
      onClick={() => onOpen(d)}
      className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50"
      title={linhaCompacta(b)}
    >
      {linhaCompacta(b)}
    </button>
  );
}

const PAGINA = 15;

export function FilaDecisoes({
  blocos,
  moeda,
  onOpen,
  tarifaEm,
  filtroAtivo,
  onLimparFiltro,
}: {
  blocos: Bloco[];
  moeda: string;
  onOpen: (d: Decisao) => void;
  tarifaEm: string | null;
  filtroAtivo: string | null;
  onLimparFiltro: () => void;
}) {
  const reg = useRegistroDisponivel();
  const [feitos, setFeitos] = useState<Record<string, Tomada>>({});
  const [abertos, setAbertos] = useState<Record<string, number>>({});
  const [nHoje, setNHoje] = useState(10);
  const hoje = decidirHoje(blocos, nHoje);
  const fila = separarFila(blocos);
  const abre = proximaAbertura(blocos);
  const cartao = (b: Bloco) => (
    <Cartao
      key={b.key}
      b={b}
      moeda={moeda}
      onOpen={onOpen}
      ativo={REGISTRO_DECISOES_ATIVO && !!reg.data}
      tarifaEm={tarifaEm}
      feito={feitos[b.key]}
      onFeito={(t) => setFeitos((f) => ({ ...f, [b.key]: t }))}
    />
  );
  const compacta = (b: Bloco) => <LinhaCompacta key={b.key} b={b} onOpen={onOpen} />;
  const grupo = (
    key: string,
    titulo: React.ReactNode,
    lista: Bloco[],
    render: (b: Bloco) => React.ReactNode,
    tom = "",
    pagina = PAGINA,
  ) => {
    if (!lista.length) return null;
    const lim = abertos[key] ?? 0;
    return (
      <section key={key} className="space-y-3 border-t border-border pt-3">
        <button
          type="button"
          className={`flex w-full items-center gap-1 text-left text-sm font-semibold ${tom}`}
          onClick={() => setAbertos((a) => ({ ...a, [key]: lim ? 0 : pagina }))}
        >
          <span>{lim ? "▾" : "▸"}</span>
          {titulo} <span className="font-normal text-muted-foreground">({lista.length})</span>
        </button>
        {lim ? <div className="space-y-3">{lista.slice(0, lim).map(render)}</div> : null}
        {lim && lista.length > lim ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAbertos((a) => ({ ...a, [key]: lim + pagina }))}
          >
            Mostrar mais {Math.min(pagina, lista.length - lim)} de {lista.length - lim}
          </Button>
        ) : null}
      </section>
    );
  };
  // Base da curva de captura usada em cada categoria (pode variar por mês).
  const bases = new Map<string, Set<string>>();
  for (const b of blocos) {
    const s = bases.get(b.category) ?? new Set<string>();
    s.add(b.captura ? BASE_TXT[b.captura.base] : "sem curva");
    bases.set(b.category, s);
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold">Fila de decisões</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info
                  className="size-4 cursor-help text-muted-foreground"
                  aria-label="Sobre a fila"
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-md space-y-1.5 text-xs">
                <p>
                  Borda vermelha = janela Agora; âmbar = Última chance. Grupos de ação só com Agora
                  e Última chance; Cedo e Tarde ficam nos grupos de baixo, sem botões.
                </p>
                <p>
                  Datas consecutivas da mesma categoria com a mesma ação e a mesma janela formam um
                  bloco. Regra {RULE_VERSION}. Nenhuma tarifa é alterada automaticamente.
                </p>
                {bases.size ? (
                  <p>
                    Base da curva de captura:{" "}
                    {[...bases]
                      .sort(([a], [b]) => (a < b ? -1 : 1))
                      .map(([c, st]) => `${c}: ${[...st].join(" / ")}`)
                      .join(" · ")}
                    .
                  </p>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {filtroAtivo ? (
              <>
                <span>Filtro: {filtroAtivo}</span>
                <Button size="sm" variant="outline" onClick={onLimparFiltro}>
                  Limpar filtro
                </Button>
              </>
            ) : null}
            <span>{blocos.length} blocos</span>
          </div>
        </div>
        {blocos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma data com sinal de ocupação neste recorte.
          </p>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Decidir hoje</h3>
                  <p className="text-xs text-muted-foreground">
                    Decisões em que o preço ainda tem mais efeito agora, pelo perfil de compra de
                    cada categoria
                  </p>
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Mostrar
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={nHoje}
                    onChange={(e) =>
                      setNHoje(Math.max(1, Math.min(50, Number(e.target.value) || 10)))
                    }
                    className="h-7 w-16"
                  />
                </label>
              </div>
              {hoje.length ? (
                hoje.map(cartao)
              ) : (
                <p className="rounded border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Nada na janela de ação agora.
                  {abre ? ` A próxima janela abre em ${dataCurta(abre)}.` : ""}
                </p>
              )}
            </section>
            {GRUPOS.map((g) => grupo(g, GRUPO_TXT[g], fila.porGrupo[g], cartao, GRUPO_TOM[g]))}
            {grupo(
              "cedo",
              <>
                Ainda cedo
                {abre ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · primeira janela abre em {dataCurta(abre)}
                  </span>
                ) : null}
              </>,
              fila.cedo,
              compacta,
              "",
              40,
            )}
            {grupo("passou", "Janela passou", fila.passou, compacta, "text-muted-foreground", 40)}
          </>
        )}
      </Card>
    </TooltipProvider>
  );
}
