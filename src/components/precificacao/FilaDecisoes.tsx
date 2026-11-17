import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HelpCircle } from "lucide-react";
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
  etiquetas,
  linhaCompacta,
  separarFila,
  COR_ETIQUETA,
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
          <div className="text-2xl font-semibold tabular-nums text-red-700 dark:text-red-300">
            {dinheiro(r.receitaRisco, moeda)}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-fit cursor-help text-xs text-muted-foreground">
                potencial de alta: {dinheiro(r.receitaPotencial, moeda)}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              Risco: carro-dias abaixo da esperada × tarifa atual (Baixar e Revisar canais).
              Potencial: carro-dias acima × (sugerida − atual) em Subir.
              {r.potencialLimitado
                ? " O potencial fica pequeno porque as sugestões de subida estão limitadas pelo passo e pela antecedência."
                : ""}
            </TooltipContent>
          </Tooltip>
          <div className="text-[11px] text-muted-foreground">
            incluindo ainda cedo: {dinheiro(r.receitaRiscoTotal, moeda)} em risco ·{" "}
            {dinheiro(r.receitaPotencialTotal, moeda)} de alta
          </div>
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
  if (!f) return "Sem faixa de diária com 5 datas ou mais no mês nem na sazonalidade.";
  return `Faixa com maior fat./veículo (${d.hist.rotulo ?? d.hist.fonte}): ${dinheiro(f.de, cur)}–${Math.round(f.ate)}, ${f.datas} datas, ${dinheiro(f.revVeic, cur)}/veículo. "Dentro" = ±5% das bordas. Compara a tarifa de tabela de hoje com a diária média efetivamente paga no passado.`;
}
function detalheMercado(d: Decisao, cur: string) {
  const m = d.mercado;
  if (d.sinalMerc === "sem-mercado") return "Nenhuma cotação válida de concorrente para esta data.";
  return `Mediana ${m.mediana != null ? dinheiro(m.mediana, cur) : "—"} com ${m.n} concorrente(s); coleta ${m.idadeDias == null ? "—" : m.idadeDias === 0 ? "de hoje" : `há ${m.idadeDias} dia(s)`}. Alinhado = ±5%.`;
}

/** Etiquetas dos sinais (verde a favor, cinza neutro, âmbar contra, tracejada sem dado), com o número no tooltip. */
function Etiquetas({ d, detalhes }: { d: Decisao; detalhes: [string, string, string] }) {
  return (
    <>
      {etiquetas(d).map((e, i) => (
        <Tooltip key={e.nome}>
          <TooltipTrigger asChild>
            <span
              className={`cursor-help rounded border px-1.5 py-0.5 text-[11px] leading-none ${COR_ETIQUETA[e.tom]}`}
              onClick={(ev) => ev.stopPropagation()}
            >
              {e.nome}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{detalhes[i]}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
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
  const dica = (t: string) => (ativo ? `${t} ${NOTA_REGISTRO}` : "Em breve: rode a migração 0060.");
  const sug =
    b.sugMin != null
      ? b.sugMin === b.sugMax
        ? dinheiro(b.sugMin, moeda)
        : `${dinheiro(b.sugMin, moeda)}–${b.sugMax}`
      : null;
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        disabled={off}
        title={dica(
          aceitoPreco != null
            ? `Registra que você vai aplicar ${dinheiro(aceitoPreco, moeda)} (ponta mais conservadora).`
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
    </div>
  );
}

/* ───────────────────────── fila ───────────────────────── */

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
  const g = grupoDe(b.acao);
  const borda = b.janela ? JANELA_BORDA[b.janela] : "border-border";
  const totalTxt = `Total do bloco: ${b.carros > 0 ? "+" : ""}${b.carros} carro-dias${b.receitaRisco ? ` · ${dinheiro(b.receitaRisco, moeda)} em risco` : ""}${b.receitaPotencial ? ` · ${dinheiro(b.receitaPotencial, moeda)} potencial` : ""}.`;
  const confTxt = f.confianca.split(":")[0]!;
  const confMotivo = f.confianca.slice(confTxt.length + 1).trim();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(d)}
      className={`cursor-pointer rounded-lg border-2 p-4 text-sm hover:bg-muted/40 ${borda}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-medium leading-snug">
          {f.titulo}
          {g === "acao-comercial" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle
                  className="ml-1 inline size-3.5 text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{DICA_REVISAR}</TooltipContent>
            </Tooltip>
          ) : null}
        </h4>
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
      <div className="mt-2 space-y-1">
        <p className="text-muted-foreground" title={totalTxt}>
          {f.sinais}
        </p>
        {b.captura ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="w-fit cursor-help text-xs" onClick={(e) => e.stopPropagation()}>
                {f.captura}
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
          <p className="text-xs">{f.captura}</p>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help font-medium" onClick={(e) => e.stopPropagation()}>
                {confTxt}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {confMotivo ? `${confMotivo}. ` : ""}
              {AJUDA_CONFIANCA}
            </TooltipContent>
          </Tooltip>
          <Etiquetas
            d={d}
            detalhes={[
              `${detalheOcupacao(d)} ${totalTxt}`,
              detalheMercado(d, moeda),
              detalheHistorico(d, moeda),
            ]}
          />
          {av.principais.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-help text-amber-600 dark:text-amber-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⚠ {av.principais.join(" · ")}
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
      ativo={!!reg.data}
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
          <h2 className="text-lg font-semibold">Fila de decisões</h2>
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
        <p className="text-xs text-muted-foreground">
          Borda vermelha = janela Agora; âmbar = Última chance. Grupos de ação só com Agora e Última
          chance; Cedo e Tarde ficam nos grupos de baixo, sem botões. Datas consecutivas da mesma
          categoria com a mesma ação e a mesma janela formam um bloco. Regra {RULE_VERSION}. Nenhuma
          tarifa é alterada automaticamente.
        </p>
        {bases.size ? (
          <p className="text-xs text-muted-foreground">
            Base da curva de captura:{" "}
            {[...bases]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([c, s]) => `${c}: ${[...s].join(" / ")}`)
              .join(" · ")}
            .
          </p>
        ) : null}
      </Card>
    </TooltipProvider>
  );
}
