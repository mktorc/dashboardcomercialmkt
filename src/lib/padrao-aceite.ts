/**
 * Padrão de aceite: aprende com as decisões registradas na Fila de decisões (pricing_decisions)
 * qual tipo de sugestão o usuário costuma aceitar, ajustar ou ignorar, e usa isso para
 * (1) reordenar a fila, (2) marcar tipos que ele costuma ignorar e (3) ajustar o preço sugerido
 * quando ele sempre aplica um preço diferente do sugerido. Nada aqui altera tarifa.
 */
import { grupoDe, type Bloco, type GrupoAcao } from "./decisao";

export type Tomada = "aceitou" | "ajustou" | "ignorou";

/** Uma linha de pricing_decisions (só o que o aprendizado usa). */
export type DecisaoRegistrada = {
  decided_at: string;
  recommended_action: string;
  occ_signal: string | null;
  market_signal: string | null;
  signals: { janela?: string | null } | null;
  decision: Tomada;
  applied_price: number | null;
  suggested_min: number | null;
  suggested_max: number | null;
};

/** Calibração do modelo (gravada em pricing_pattern_settings; sem a tabela, valem os padrões). */
export type ConfigPadrao = {
  /** Decisões (com peso) exigidas num tipo antes de ele influenciar a fila. */
  minDecisoes: number;
  /** Em quantos dias uma decisão passa a valer a metade (as recentes pesam mais). */
  meiaVidaDias: number;
  /** Aplica o ajuste de preço aprendido na sugestão. */
  ajustarPreco: boolean;
  /** Teto do ajuste de preço aprendido (fração, 0.25 = ±25%). */
  ajusteMax: number;
  /** Quanto o padrão pesa na ordem da fila (0 = não reordena, 1 = forte). */
  pesoOrdem: number;
  /** Decisões antes desta data são ignoradas ("zerar padrão"). */
  zeradoEm: string | null;
  /** Tipos que o usuário mandou não aprender (chaves de tipoChave). */
  desligados: string[];
};
export const CONFIG_PADRAO: ConfigPadrao = {
  minDecisoes: 5,
  meiaVidaDias: 90,
  ajustarPreco: true,
  ajusteMax: 0.25,
  pesoOrdem: 0.6,
  zeradoEm: null,
  desligados: [],
};

/** Partes de um tipo de sugestão: ação, janela, ocupação e mercado. */
export type TipoPartes = {
  grupo: GrupoAcao;
  janela: string;
  occ: string;
  merc: string;
};
export const tipoChave = (t: TipoPartes) => `${t.grupo}|${t.janela}|${t.occ}|${t.merc}`;
const chaveCurta = (t: TipoPartes) => `${t.grupo}|${t.janela}`;

export function tipoDoBloco(b: Bloco): TipoPartes {
  const d = b.itens.reduce((a, x) => (x.lead < a.lead ? x : a));
  return {
    grupo: grupoDe(b.acao),
    janela: b.janela ?? "-",
    occ: d.occ ?? "-",
    merc: d.sinalMerc ?? "-",
  };
}
export function tipoDoRegistro(r: DecisaoRegistrada): TipoPartes {
  return {
    grupo: grupoDe(r.recommended_action as Bloco["acao"]),
    janela: r.signals?.janela ?? "-",
    occ: r.occ_signal ?? "-",
    merc: r.market_signal ?? "-",
  };
}

/** Preço que o "Vou aplicar" grava: a ponta da sugestão mais próxima da tarifa atual. */
export function precoReferencia(
  grupo: GrupoAcao,
  sugMin: number | null,
  sugMax: number | null,
): number | null {
  if (sugMin == null || sugMax == null) return null;
  return grupo === "baixar" ? sugMax : sugMin;
}

export type EstatTipo = {
  chave: string;
  partes: TipoPartes;
  /** Nº de decisões e soma dos pesos. */
  n: number;
  peso: number;
  aceitou: number;
  ajustou: number;
  ignorou: number;
  /** Aceite ponderado: aceitou = 1, ajustou = 0,5, ignorou = 0. */
  taxa: number;
  /** Preço aplicado ÷ preço sugerido (mediana ponderada), quando há decisões com preço. */
  razaoPreco: number | null;
  nPreco: number;
};

export type Perfil = {
  config: ConfigPadrao;
  total: number;
  porTipo: Map<string, EstatTipo>;
  porCurto: Map<string, EstatTipo>;
};

function medianaPonderada(xs: { v: number; w: number }[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a.v - b.v);
  const tot = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= tot / 2) return x.v;
  }
  return s.at(-1)!.v;
}

function acumular(
  regs: { r: DecisaoRegistrada; w: number; partes: TipoPartes }[],
  chave: (t: TipoPartes) => string,
): Map<string, EstatTipo> {
  const grupos = new Map<string, typeof regs>();
  for (const x of regs) {
    const k = chave(x.partes);
    grupos.set(k, [...(grupos.get(k) ?? []), x]);
  }
  const out = new Map<string, EstatTipo>();
  for (const [k, xs] of grupos) {
    const soma = (t: Tomada) => xs.filter((x) => x.r.decision === t).reduce((a, x) => a + x.w, 0);
    const peso = xs.reduce((a, x) => a + x.w, 0);
    const [ac, aj, ig] = [soma("aceitou"), soma("ajustou"), soma("ignorou")];
    const razoes = xs.flatMap((x) => {
      if (x.r.decision === "ignorou") return [];
      const ref = precoReferencia(x.partes.grupo, x.r.suggested_min, x.r.suggested_max);
      if (ref == null || ref <= 0) return [];
      // suggested_min/max guardam a sugestão original (sem o ajuste do padrão); applied_price, o que foi aplicado.
      const ap = x.r.applied_price ?? (x.r.decision === "aceitou" ? ref : null);
      return ap != null && ap > 0 ? [{ v: ap / ref, w: x.w }] : [];
    });
    out.set(k, {
      chave: k,
      partes: xs[0]!.partes,
      n: xs.length,
      peso,
      aceitou: ac,
      ajustou: aj,
      ignorou: ig,
      taxa: peso ? (ac + 0.5 * aj) / peso : 0,
      razaoPreco: medianaPonderada(razoes),
      nPreco: razoes.reduce((a, x) => a + x.w, 0),
    });
  }
  return out;
}

export function construirPerfil(
  registros: DecisaoRegistrada[],
  config: ConfigPadrao = CONFIG_PADRAO,
  agora: Date = new Date(),
): Perfil {
  const desl = new Set(config.desligados);
  const regs = registros
    .filter((r) => !config.zeradoEm || r.decided_at >= config.zeradoEm)
    .map((r) => {
      const dias = Math.max(0, (agora.getTime() - new Date(r.decided_at).getTime()) / 86_400_000);
      return {
        r,
        w: Math.pow(0.5, dias / Math.max(1, config.meiaVidaDias)),
        partes: tipoDoRegistro(r),
      };
    })
    .filter((x) => !desl.has(tipoChave(x.partes)));
  return {
    config,
    total: regs.length,
    porTipo: acumular(regs, tipoChave),
    porCurto: acumular(regs, chaveCurta),
  };
}

export type Leitura = {
  /** Estatística usada (o tipo exato ou, sem decisões suficientes, ação + janela). */
  est: EstatTipo;
  exato: boolean;
  /** Multiplicador de ordem (1 = neutro). */
  fator: number;
  /** "aceita" / "ajusta" / "ignora": o comportamento dominante. */
  tendencia: "aceita" | "ajusta" | "ignora";
  texto: string;
};

/** Como o usuário costuma decidir sugestões deste tipo, se já há decisões suficientes. */
export function lerPadrao(perfil: Perfil, t: TipoPartes): Leitura | null {
  const c = perfil.config;
  if (c.desligados.includes(tipoChave(t))) return null;
  const exato = perfil.porTipo.get(tipoChave(t));
  const curto = perfil.porCurto.get(chaveCurta(t));
  const est =
    exato && exato.peso >= c.minDecisoes
      ? exato
      : curto && curto.peso >= c.minDecisoes
        ? curto
        : null;
  if (!est) return null;
  const fator = 1 + c.pesoOrdem * (est.taxa - 0.5) * 2;
  const maior = Math.max(est.aceitou, est.ajustou, est.ignorou);
  const tendencia = maior === est.ignorou ? "ignora" : maior === est.ajustou ? "ajusta" : "aceita";
  const pct = Math.round(est.taxa * 100);
  const base = est === exato ? "sugestões deste tipo" : "sugestões desta ação nesta janela";
  const texto =
    tendencia === "ignora"
      ? `Você costuma não mexer em ${base} (${Math.round((est.ignorou / est.peso) * 100)}% de ${est.n} decisões).`
      : tendencia === "ajusta"
        ? `Você costuma aplicar outro preço em ${base} (${est.n} decisões).`
        : `Você aceita ${pct}% das ${base} (${est.n} decisões).`;
  return { est, exato: est === exato, fator: Math.max(0.1, fator), tendencia, texto };
}

export type AjustePreco = { razao: number; texto: string };

/** Ajuste aprendido do preço sugerido (aplicado − sugerido), se há decisões com preço suficientes. */
export function ajustePreco(perfil: Perfil, t: TipoPartes): AjustePreco | null {
  const c = perfil.config;
  if (!c.ajustarPreco || c.desligados.includes(tipoChave(t))) return null;
  const exato = perfil.porTipo.get(tipoChave(t));
  const curto = perfil.porCurto.get(chaveCurta(t));
  const est =
    exato && exato.nPreco >= c.minDecisoes
      ? exato
      : curto && curto.nPreco >= c.minDecisoes
        ? curto
        : null;
  if (!est || est.razaoPreco == null) return null;
  const r = Math.min(1 + c.ajusteMax, Math.max(1 - c.ajusteMax, est.razaoPreco));
  if (Math.abs(r - 1) < 0.01) return null;
  const pct = Math.round((r - 1) * 100);
  return {
    razao: r,
    texto: `Preço ajustado ${pct > 0 ? "+" : ""}${pct}% pelo seu padrão: nessas sugestões você costuma aplicar ${pct > 0 ? "acima" : "abaixo"} do sugerido.`,
  };
}

/** Aplica o ajuste de preço aprendido ao bloco (sugestão mín/máx). */
export function ajustarBloco(
  b: Bloco,
  perfil: Perfil,
): { bloco: Bloco; ajuste: AjustePreco | null } {
  const aj = b.sugMin == null ? null : ajustePreco(perfil, tipoDoBloco(b));
  if (!aj) return { bloco: b, ajuste: null };
  const f = (v: number | null) => (v == null ? v : Math.round(v * aj.razao));
  return { bloco: { ...b, sugMin: f(b.sugMin), sugMax: f(b.sugMax) }, ajuste: aj };
}

/** Reordena (ordem estável) pela posição original ponderada pelo fator do padrão. */
export function ordenarPorPadrao(lista: Bloco[], perfil: Perfil): Bloco[] {
  if (!perfil.config.pesoOrdem) return lista;
  const n = lista.length;
  return lista
    .map((b, i) => {
      const l = lerPadrao(perfil, tipoDoBloco(b));
      return { b, i, s: ((n - i) / n) * (l?.fator ?? 1) };
    })
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.b);
}

export const TIPO_TXT = {
  grupo: {
    baixar: "Baixar",
    subir: "Subir",
    "acao-comercial": "Revisar canais",
    verificar: "Verificar dados",
    manter: "Manter",
  } as Record<string, string>,
  janela: {
    agora: "agora",
    ultima: "última chance",
    cedo: "cedo",
    tarde: "tarde",
    "-": "sem janela",
  } as Record<string, string>,
  occ: {
    abaixo: "ocupação abaixo",
    dentro: "ocupação normal",
    acima: "ocupação acima",
    "-": "sem ocupação",
  } as Record<string, string>,
  merc: {
    acima: "nós mais caros",
    alinhado: "mercado alinhado",
    abaixo: "nós mais baratos",
    "sem-mercado": "sem mercado",
    "-": "sem mercado",
  } as Record<string, string>,
};
export const tipoTexto = (t: TipoPartes) =>
  `${TIPO_TXT.grupo[t.grupo] ?? t.grupo} · ${TIPO_TXT.janela[t.janela] ?? t.janela} · ${TIPO_TXT.occ[t.occ] ?? t.occ} · ${TIPO_TXT.merc[t.merc] ?? t.merc}`;
