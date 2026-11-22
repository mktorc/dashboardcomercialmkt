/**
 * Importação de cotações da Rentcars capturadas no navegador do próprio usuário (botão de favoritos), sem robô: a pessoa faz a
 * busca normalmente e o botão manda o texto da página (com o nome dos logos como "[logo:Europcar]") para o painel.
 *
 * Duas telas:
 *  - lista (/reserva/listar/...): uma cotação por carro (locadora, modelo, lugares, total do período, itens inclusos);
 *  - oferta (/reserva/configurar/...): preço da cadeirinha (e do motorista adicional, se aparecer) e as taxas da locadora,
 *    que viram os extras da locadora naquela busca.
 */

export type RentcarsSearch = { pickupAt: string; returnAt: string; days: number };

export type RentcarsOffer = {
  locadora: string;
  modelo: string;
  lugares: number | null;
  total: number;
  dias: number;
  motoristaIncluso: boolean;
  protecoesInclusas: boolean;
  categoria: string | null;
};

export type RentcarsExtras = {
  locadora: string | null;
  modelo: string | null;
  cadeirinha: number | null; // US$ por dia
  motorista: number | null; // US$ por dia
  taxas: number | null; // US$ no período
  valorVeiculo: number | null;
};

const BRT = -3 * 3600; // os números do link são horário de Brasília (ex.: 1807794000 = 15/04/2027 10:00)

const isoBRT = (epoch: number) => {
  const d = new Date((epoch + BRT) * 1000);
  return d.toISOString().slice(0, 19);
};

/** "…/listar/621-1807794000-621-1808398800-…" ou "…/configurar/621-…-621-…-…" → retirada, devolução e diárias. */
export function parseRentcarsUrl(url: string): RentcarsSearch | null {
  const m = /\/reserva\/(?:listar|configurar)\/\d+-(\d{9,11})-\d+-(\d{9,11})/.exec(url);
  if (!m) return null;
  const ini = Number(m[1]);
  const fim = Number(m[2]);
  if (!(fim > ini)) return null;
  return { pickupAt: isoBRT(ini), returnAt: isoBRT(fim), days: Math.round((fim - ini) / 86400) };
}

export const pageKind = (url: string): "lista" | "oferta" | null =>
  /\/reserva\/listar\//.test(url) ? "lista" : /\/reserva\/configurar\//.test(url) ? "oferta" : null;

/** "US$ 1.395,20" / "1.395,20" → 1395.2 */
export function brNumber(s: string): number | null {
  const m = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Pareamento pelo modelo do carro, a mesma regra do coletor (scripts/precificacao/coletor.py: categoria_por_modelo). */
export function categoriaPorModelo(nome: string, seats: number | null, classe = ""): string | null {
  const s = seats ?? 0;
  if (/sorento|highlander|palisade/i.test(nome)) return "Fullsize Suv";
  if (/corolla/i.test(nome)) return "Midsize Sedan";
  if (/sportage|tucson|rav ?4/i.test(nome)) return "Midsize Suv";
  if (/escalade/i.test(nome)) return "Luxury";
  if (/yukon xl/i.test(nome)) return "SUV Executive 8 Seats";
  if (/suburban/i.test(nome)) return s === 7 ? "SUV Executive 7 Seats" : "SUV Executive 8 Seats";
  if (s <= 12 && (/transit/i.test(nome) || (s === 12 && /van/i.test(`${classe} ${nome}`))))
    return "Van 12 Seats";
  if (
    /pacifica|caravan|voyager|carnival|odyssey|sienna|minivan|mini van/i.test(`${nome} ${classe}`)
  )
    return "Mini Van 8 Seats";
  return null;
}

const LOGO = /^\[logo:(.+)\]$/;
const KNOWN = [
  "Europcar",
  "Hertz",
  "Avis",
  "Budget",
  "Alamo",
  "National",
  "Enterprise",
  "Sixt",
  "Thrifty",
  "Dollar",
  "Fox",
  "Payless",
  "Ace",
  "Advantage",
  "Routes",
  "NU Car",
  "Easirent",
  "Keddy",
  "Firefly",
  "Green Motion",
  "Dollar Thrifty",
  "Movida",
  "Localiza",
  "Economy",
  "Right Cars",
  "Sunnycars",
  "Rent-A-Wreck",
  "CarWiz",
  "AddCar",
];

/** Nome da locadora a partir do texto do logo ("logo-europcar.png", "Europcar", "Locadora Hertz"…). */
export function locadoraDoLogo(alt: string): string | null {
  const a = alt.replace(/[-_]+/g, " ").replace(/\.(png|svg|jpe?g|webp)$/i, "");
  const k = [...KNOWN]
    .sort((x, y) => y.length - x.length)
    .find((n) => new RegExp(`\\b${n}\\b`, "i").test(a));
  if (k) return k;
  const limpo = a.replace(/\b(logo|locadora|rent ?a ?car|car rental|imagem)\b/gi, "").trim();
  return limpo && limpo.length <= 30 ? limpo : null;
}

/** Locadora conhecida no texto do logo (sem adivinhar). */
const conhecida = (alt: string) => {
  const a = alt.replace(/[-_]+/g, " ");
  return (
    [...KNOWN]
      .sort((x, y) => y.length - x.length)
      .find((n) => new RegExp(`\\b${n}\\b`, "i").test(a)) ?? null
  );
};

/** Entre os logos de um cartão: primeiro uma locadora conhecida; senão, o primeiro texto que não seja o modelo do carro. */
export function escolherLocadora(logos: string[], modelo: string | null): string | null {
  const k = logos.map(conhecida).find(Boolean);
  if (k) return k;
  const esc = (modelo ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    logos
      .map(locadoraDoLogo)
      .find(
        (x) =>
          !!x && !(esc && new RegExp(esc, "i").test(x)) && !/carro|car|veículo|vehicle/i.test(x),
      ) ?? null
  );
}

const linhas = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** Lista de resultados → uma cotação por carro. Cada cartão termina no botão "Continuar". */
export function parseLista(text: string, dias: number): RentcarsOffer[] {
  const ls = linhas(text);
  const out: RentcarsOffer[] = [];
  let ini = 0;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i] !== "Continuar") continue;
    const card = ls.slice(ini, i);
    ini = i + 1;
    const iSim = card.findIndex((l) => /^ou .*similar$/i.test(l));
    if (iSim < 1) continue;
    const modelo = card[iSim - 1]!;
    // Total: "US$ 410,64" seguido de "Por 7 dias" (às vezes "US$" e o valor vêm em linhas separadas).
    const iPor = card.findIndex((l) => /^Por \d+ dias?$/i.test(l));
    if (iPor < 1) continue;
    const precoTxt = /US\$/.test(card[iPor - 1]!)
      ? card[iPor - 1]!
      : `${card[iPor - 2] ?? ""} ${card[iPor - 1]}`;
    if (!/US\$/.test(precoTxt)) continue; // só USD
    const total = brNumber(precoTxt.replace(/^.*US\$/, ""));
    if (!total) continue;
    const logos = card.map((l) => LOGO.exec(l)?.[1]).filter((x): x is string => !!x);
    const locadora = escolherLocadora(logos, modelo);
    if (!locadora) continue;
    const lugaresTxt = card.slice(iSim + 1, iSim + 4).find((l) => /^\d{1,2}$/.test(l));
    const lugares = lugaresTxt ? Number(lugaresTxt) : null;
    const classe = card[iSim]!.replace(/^ou /i, "").replace(/ similar$/i, "");
    out.push({
      locadora,
      modelo,
      lugares,
      total,
      dias: Number(/\d+/.exec(card[iPor]!)![0]) || dias,
      motoristaIncluso: card.some((l) => /^Condutor Adicional$/i.test(l)),
      protecoesInclusas: card.some((l) => /^Proteç(ões|ão) inclusas?$/i.test(l)),
      categoria: categoriaPorModelo(modelo, lugares, classe),
    });
  }
  return out;
}

/** Valor em US$ logo depois do rótulo (mesma linha ou nas 3 seguintes). */
function valorApos(ls: string[], rotulo: RegExp): number | null {
  const i = ls.findIndex((l) => rotulo.test(l));
  if (i < 0) return null;
  const janela = [ls[i]!.replace(rotulo, ""), ...ls.slice(i + 1, i + 4)].join(" ");
  const m = /US\$\s*([\d.,]+)/.exec(janela);
  return m ? brNumber(m[1]!) : null;
}

/** Tela da oferta → cadeirinha e motorista (US$/dia), taxas da locadora e valor do veículo. */
export function parseOferta(text: string): RentcarsExtras {
  const ls = linhas(text);
  const logos = ls.map((l) => LOGO.exec(l)?.[1]).filter((x): x is string => !!x);
  const iSim = ls.findIndex((l) => /^ou .*similar$/i.test(l));
  return {
    locadora: escolherLocadora(logos, iSim > 0 ? ls[iSim - 1]! : null),
    modelo: iSim > 0 ? ls[iSim - 1]! : null,
    cadeirinha: valorApos(ls, /^Cadeirinha para Criança/i) ?? valorApos(ls, /^Bebê Conforto/i),
    motorista: valorApos(ls, /^(Condutor|Motorista) Adicional/i),
    taxas: valorApos(ls, /^Taxas da Locadora$/i),
    valorVeiculo: valorApos(ls, /^Valor do veículo$/i),
  };
}

/** Nome do concorrente gravado: a locadora com o sufixo da fonte (agregador, como o DiscoverCars). */
export const rentcarsCompetitor = (locadora: string) => `${locadora} (Rentcars)`;
