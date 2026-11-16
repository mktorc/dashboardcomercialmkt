// Uso: node --env-file=.env.local scripts/comissoes/importar-hq.mjs
// Importa as reservas do HQ Rentals (America 3) para public.reservas.
// Só entram reservas com parceiro (tour_operator) de comissão > 0%.
// Reservas com pagamento "Pagamento antecipado" (antes "Retenção de comissão") são marcadas como retida_agencia.
// O upsert não toca em status_repasse/paga_em, então repasses já feitos são preservados.
import { createClient } from "@supabase/supabase-js";

const { HQ_TENANT_TOKEN, HQ_USER_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const faltando = Object.entries({
  HQ_TENANT_TOKEN,
  HQ_USER_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (faltando.length) {
  console.error(
    `Variáveis ausentes ou vazias: ${faltando.join(", ")}. Localmente, defina no .env.local; no GitHub, em Settings > Secrets and variables > Actions.`,
  );
  process.exit(1);
}

// secrets colados no GitHub costumam vir com quebra de linha no fim, o que invalida a autenticação
const auth = Buffer.from(`${HQ_TENANT_TOKEN.trim()}:${HQ_USER_TOKEN.trim()}`).toString("base64");
const API = "https://api-america-3.caagcrm.com/api-america-3/car-rental";
const BASE = `${API}/reservations`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const n = (v) => Number(v ?? 0);

const semAcento = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
// método de pagamento "Pagamento antecipado" (novo nome no HQ) ou o antigo "Retenção de comissão"
// (tolerante a acento, caixa e variações de texto)
const ehRetencao = (tipo) => {
  const t = semAcento(tipo);
  return (
    (t.includes("pagamento") && t.includes("antecipad")) ||
    (t.includes("retencao") && t.includes("comiss"))
  );
};
const pagamentoValido = (p) => !/declin|fail|void|cancel/i.test(p.status ?? "");

async function metodosDePagamento(id) {
  const j = await hq(`${BASE}/${id}/payments`);
  return [
    ...new Set(
      (j.data.payments ?? [])
        .filter(pagamentoValido)
        .map((p) => p.payment_type)
        .filter(Boolean),
    ),
  ];
}

// Manual charge: valor que a agência cobrou acima do que vendemos, repassado junto com a comissão.
// Só vem no detalhe da reserva (item id 6 / is_manual_charge de selected_additional_charges).
async function manualCharge(id) {
  const j = await hq(`${BASE}/${id}`);
  const itens = j.data?.selected_additional_charges ?? [];
  return itens
    .filter((c) => c.id === 6 || c.is_manual_charge)
    .reduce((s, c) => s + n(c.total_price?.amount), 0);
}

// Parceiros que não recebem comissão, mesmo que o HQ tenha percentual cadastrado.
const SEM_COMISSAO = new Set(
  [
    "Google ADS",
    "Meta ADS",
    "Cliente Recorrente",
    "Camp.Hispana",
    "Influencer/Parceria",
    "Master Vacation",
    "Talu Concept",
    "Barbs Tour",
    "Theodoro",
  ].map(semAcento),
);

// id -> nome de quem criou a reserva (created_by)
async function carregarUsuarios() {
  const mapa = new Map();
  for (let p = 1; p <= 20; p++) {
    const j = await hq(`${API.replace(/\/car-rental$/, "")}/users?page=${p}`);
    const lista = j.data?.data ?? [];
    lista.forEach((u) => mapa.set(String(u.id), String(u.full_name ?? u.first_name ?? "").trim()));
    if (!lista.length || (j.data?.last_page && p >= j.data.last_page)) break;
  }
  return mapa;
}

function mapear(r, usuarios) {
  const parceiro = r.tour_operator;
  const pct = n(parceiro?.commission_percentage);
  if (!parceiro?.name || pct <= 0 || SEM_COMISSAO.has(semAcento(parceiro.name).trim())) return null;
  return {
    hq_reservation_id: String(r.id),
    commission_partner: parceiro.name,
    created_at: r.created_at,
    total_price: n(r.total_price?.amount),
    total_paid: n(r.total_paid),
    rack_rate: n(r.total_rack_rate),
    // desconto manual da reserva: exige validação antes do pagamento (ver migração 0040)
    desconto: n(r.discounts_amount),
    commission_rate: pct,
    currency: String(r.currency ?? "usd").toUpperCase(),
    hq_status: r.status ?? null,
    seller_name: usuarios.get(String(r.created_by ?? "")) || null,
  };
}

async function hq(url) {
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (res.ok) return res.json();
    if (tentativa >= 3) throw new Error(`HQ respondeu ${res.status} em ${url}`);
    await new Promise((ok) => setTimeout(ok, 1000 * tentativa));
  }
}
const pagina = (page) => hq(`${BASE}?limit=100&page=${page}`);

const usuarios = await carregarUsuarios().catch(() => new Map());
let page = 1,
  ultima = 1,
  lidas = 0,
  gravadas = 0;
do {
  const j = await pagina(page);
  // resposta sem paginação = o HQ não devolveu as reservas; falha em vez de "concluir" sem importar nada
  if (!Array.isArray(j.data) || !Number.isInteger(j.last_page)) {
    throw new Error(
      `Resposta inesperada do HQ na página ${page}: ${JSON.stringify(j).slice(0, 300)}`,
    );
  }
  ultima = j.last_page;
  lidas += j.data.length;
  const linhas = j.data.map((r) => mapear(r, usuarios)).filter(Boolean);
  // métodos de pagamento só das reservas que serão gravadas, 8 por vez
  for (let i = 0; i < linhas.length; i += 8) {
    await Promise.all(
      linhas.slice(i, i + 8).map(async (l) => {
        l.payment_methods = await metodosDePagamento(l.hq_reservation_id);
        l.retida_agencia = l.payment_methods.some(ehRetencao);
        l.manual_charge = await manualCharge(l.hq_reservation_id);
      }),
    );
  }
  if (linhas.length) {
    const { error } = await supabase
      .from("reservas")
      .upsert(linhas, { onConflict: "hq_reservation_id" });
    if (error) throw new Error(`Supabase: ${error.message}`);
    gravadas += linhas.length;
  }
  console.log(`página ${page}/${ultima}: ${linhas.length} gravadas`);
} while (++page <= ultima);

console.log(
  `Concluído: ${lidas} reservas lidas, ${gravadas} gravadas (as demais não têm parceiro com comissão > 0%).`,
);
if (lidas === 0) {
  console.error("Nenhuma reserva lida do HQ.");
  process.exit(1);
}
