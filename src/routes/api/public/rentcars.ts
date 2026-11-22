import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  pageKind,
  parseLista,
  parseOferta,
  parseRentcarsUrl,
  rentcarsCompetitor,
  type RentcarsOffer,
} from "@/lib/rentcars-import";

// Recebe a página da Rentcars capturada pelo botão de favoritos no navegador do usuário (a busca é feita por uma pessoa; nada
// aqui acessa a Rentcars). Lista → grava uma cotação por locadora × categoria; oferta → grava a cadeirinha/motorista nas
// cotações daquela locadora para a mesma busca. Corpo em text/plain (JSON) para não exigir preflight de CORS.
// Proteção: o token do agendamento (SYNC_CRON_TOKEN) vai no corpo.

// As tabelas de concorrência não estão nos tipos gerados do Supabase: cliente sem tipos.
const supabaseAdmin = admin as unknown as SupabaseClient;

const ORIGENS = ["https://www.rentcars.com", "https://rentcars.com"];
const LOCAL = "Orlando (Aeroporto MCO)";
const FONTE = "captura no navegador (Rentcars, busca feita pelo usuário)";

const cors = (request: Request) => {
  const o = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0]!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
};

const resp = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors(request) });

async function competitorId(name: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("competitors")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (data?.id) return data.id as string;
  const { data: novo, error } = await supabaseAdmin
    .from("competitors")
    .insert({ name, kind: "direto" })
    .select("id")
    .single();
  if (error) throw error;
  return novo!.id as string;
}

/** Uma oferta por locadora e categoria nossa (a mais barata); sem par, uma por modelo. */
function maisBaratas(ofertas: RentcarsOffer[]) {
  const m = new Map<string, RentcarsOffer>();
  for (const o of ofertas) {
    const k = `${o.locadora}|${o.categoria ?? o.modelo}`;
    const cur = m.get(k);
    if (!cur || o.total < cur.total) m.set(k, o);
  }
  return [...m.values()];
}

async function gravarLista(url: string, text: string) {
  const busca = parseRentcarsUrl(url);
  if (!busca) return { ok: false, erro: "link da busca não reconhecido" };
  const ofertas = maisBaratas(parseLista(text, busca.days));
  if (!ofertas.length)
    return { ok: false, erro: "nenhum carro com preço em US$ encontrado na página" };
  const agora = new Date().toISOString();
  const linhas = [];
  for (const o of ofertas) {
    linhas.push({
      competitor_id: await competitorId(rentcarsCompetitor(o.locadora)),
      source: FONTE,
      source_url: url,
      location: LOCAL,
      source_category: o.modelo,
      normalized_category: o.categoria,
      collected_at: agora,
      pickup_at: busca.pickupAt,
      return_at: busca.returnAt,
      total_price: o.total,
      daily_price: Math.round((o.total / o.dias) * 100) / 100,
      currency: "USD",
      taxes_included: true,
      protections: o.protecoesInclusas
        ? "proteções da locadora inclusas (Rentcars)"
        : "não informadas",
      available: true,
      equivalence: "parcial",
      equivalence_notes: [
        "Preço total da Rentcars (USD, residente no Brasil): taxas da locadora inclusas",
        o.protecoesInclusas ? "proteções inclusas" : null,
        o.motoristaIncluso ? "motorista adicional incluso" : "motorista adicional não incluso",
        "cadeirinha: abra a oferta e clique no botão para ler",
        `${o.modelo}${o.lugares ? `, ${o.lugares} lugares` : ""}`,
      ]
        .filter(Boolean)
        .join("; "),
    });
  }
  const { error } = await supabaseAdmin.from("competitor_price_snapshots").insert(linhas);
  if (error) return { ok: false, erro: error.message };
  return {
    ok: true,
    tela: "lista",
    gravadas: linhas.length,
    pareadas: ofertas
      .filter((o) => o.categoria)
      .map((o) => `${o.locadora}: ${o.modelo} → ${o.categoria}`),
  };
}

async function gravarOferta(url: string, text: string) {
  const busca = parseRentcarsUrl(url);
  const e = parseOferta(text);
  if (!busca || !e.locadora)
    return { ok: false, erro: "não achei a locadora ou as datas nesta tela" };
  if (e.cadeirinha == null && e.motorista == null)
    return {
      ok: false,
      erro: "não achei o preço da cadeirinha nem do motorista adicional nesta tela",
    };
  const { data: comp } = await supabaseAdmin
    .from("competitors")
    .select("id")
    .eq("name", rentcarsCompetitor(e.locadora))
    .maybeSingle();
  if (!comp)
    return {
      ok: false,
      erro: `grave primeiro a lista desta busca (${e.locadora} ainda não tem cotação)`,
    };
  const { data: rows, error } = await supabaseAdmin
    .from("competitor_price_snapshots")
    .select("id,equivalence_notes,total_price,return_at,pickup_at")
    .eq("competitor_id", comp.id)
    .eq("pickup_at", busca.pickupAt)
    .eq("return_at", busca.returnAt);
  if (error) return { ok: false, erro: error.message };
  if (!rows?.length) return { ok: false, erro: "grave primeiro a lista desta busca" };
  let n = 0;
  for (const r of rows) {
    const nota = (r.equivalence_notes ?? "")
      .replace(/; cadeirinha: abra a oferta[^;]*/, "")
      .replace(/; extras: [^;]*(; bebe=[^;]*)?(; bebe_nome=[^;]*)?(; dias=\d+)?/, "");
    const incluso = /motorista adicional incluso/.test(nota);
    const mot = incluso
      ? "0.00/uma_vez"
      : e.motorista != null
        ? `${e.motorista.toFixed(2)}/dia`
        : "0.00/uma_vez";
    const obsMot =
      !incluso && e.motorista == null
        ? "; motorista adicional não oferecido na Rentcars (não somado)"
        : "";
    const bebe = e.cadeirinha != null ? `${e.cadeirinha.toFixed(2)}/dia` : "0.00/dia";
    const taxas =
      e.taxas != null ? `; taxas da locadora nesta oferta: US$ ${e.taxas.toFixed(2)}` : "";
    const novo = `${nota}${obsMot}${taxas}; extras: motorista=${mot}; bebe=${bebe}; bebe_nome=Cadeirinha para Criança; dias=${busca.days}`;
    const { error: up } = await supabaseAdmin
      .from("competitor_price_snapshots")
      .update({ equivalence_notes: novo })
      .eq("id", r.id);
    if (!up) n++;
  }
  return {
    ok: true,
    tela: "oferta",
    locadora: e.locadora,
    cadeirinha: e.cadeirinha,
    motorista: e.motorista,
    atualizadas: n,
  };
}

export const Route = createFileRoute("/api/public/rentcars")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: cors(request) }),
      POST: async ({ request }) => {
        let body: { url?: string; text?: string; token?: string };
        try {
          body = JSON.parse(await request.text());
        } catch {
          return resp(request, { ok: false, erro: "corpo inválido" }, 400);
        }
        // Mesmos segredos aceitos pelas rotas de sincronização (sync-auth), sem espaços nas pontas.
        const tok = (body.token ?? "").trim();
        const ok = ["SYNC_CRON_TOKEN", "CRON_SECRET", "LOVABLE_CRON_SECRET"]
          .map((k) => (process.env[k] ?? "").trim())
          .some((s) => !!s && s === tok);
        if (!tok || !ok) return resp(request, { ok: false, erro: "não autorizado" }, 401);
        const url = body.url ?? "";
        const text = (body.text ?? "").slice(0, 2_000_000);
        const tipo = pageKind(url);
        try {
          if (tipo === "lista") return resp(request, await gravarLista(url, text));
          if (tipo === "oferta") return resp(request, await gravarOferta(url, text));
          return resp(
            request,
            { ok: false, erro: "abra a lista de resultados ou a tela de uma oferta da Rentcars" },
            400,
          );
        } catch (e) {
          return resp(request, { ok: false, erro: (e as Error).message }, 500);
        }
      },
    },
  },
});
