// Revisão humana da Base de Conhecimento. A IA gera os artigos a partir do Drive, mas erra:
// repete frases, mistura idiomas, traduz o material em espanhol e solta frases de marketing sem
// contexto. Aqui ficam as páginas revisadas, que substituem a versão da IA pelo mesmo id (o id
// final, depois de estrutura.ts juntar as partes). Páginas que só repetiam outra são escondidas.
// O texto para o cliente fica como mensagem pronta (botão Copiar), em português e em espanhol.

type Block = { t: string } & Record<string, unknown>;
type SubStep = { title: string; text?: string; tpl?: string[] };
type Step = { title: string; text?: string; list?: string[]; sub?: SubStep[]; tpl?: string[] };

export type CPage = {
  id: string;
  title: string;
  summary: string;
  blocks: Block[];
  /** Categoria (id) para criar a página quando ela ainda não existe. */
  cat?: string;
  keywords?: string;
};
export type Curadoria = { pages: CPage[]; hide: string[] };

// ───────────── blocos ─────────────
const p = (text: string): Block => ({ t: "p", text });
const h = (text: string): Block => ({ t: "h", text });
const sub = (text: string): Block => ({ t: "sub", text });
const note = (text: string): Block => ({ t: "note", text });
const warn = (text: string): Block => ({ t: "warn", text });
const list = (items: string[], title?: string): Block => ({
  t: "list",
  items,
  ...(title ? { title } : {}),
});
const steps = (items: Step[]): Block => ({ t: "steps", items });
const table = (head: string[], rows: string[][]): Block => ({ t: "table", head, rows });
const msg = (title: string, text: string): Block => ({ t: "quote", title, text });
const tags = (title: string, items: string[]): Block => ({ t: "tags", title, items });
const drive = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const video = (name: string, id: string): Block => ({
  t: "file",
  name,
  link: drive(id),
  kind: "video",
});
const foto = (name: string, id: string): Block => ({
  t: "file",
  name,
  link: drive(id),
  kind: "image",
});

// ───────────── Frota (igual no Comercial e no CS) ─────────────

const VID = {
  sedan: "1sFkWgPAGmIENFGnC6il_BcOWQMHR3OVl",
  suvMedia: "1CHg6uZ1e6rS3x80dUM32tJCZf2Wxl9F-",
  fullSize: "1fnf73GrEGz0jVBhSu54rm0Jl1DUxbYyA",
  minivan: "1BP9lT8Q-5BYBxfAS-kQFyYSbM4Bslo-R",
  sub7: "1oxSBiD46H4F3un_1lJuLZ_SWiKUExF_O",
  sub8: "1sOnDA9Y9x6tp44iiOtFI5ctl_h3T25nH",
  cadillac: "1LZ8JUnjKBPMZAidnhRpX2KDlOk7y1iXx",
};

type Cap = [string, string, string][];
const capTable = (rows: Cap, malas = ["Malas grandes (23 kg)", "Malas pequenas (10 kg)"]) =>
  table(["Pessoas", ...malas], rows);

function fleetPage(o: {
  key: string;
  title: string;
  modelos: string;
  es: string;
  cap: Cap;
  malas?: string[];
  franquia: string;
  tanque: string;
  media: Block[];
  regras?: Block[];
  extra?: Block[];
}) {
  return (area: string): CPage => ({
    id: `frota-${o.key}-${area}`,
    title: o.title,
    summary: `${o.modelos}: capacidade, franquia, taxa de combustível${o.media.length ? " e vídeo" : ""}.`,
    keywords: `${o.title} ${o.modelos} ${o.es} frota categoria malas passageiros`,
    blocks: [
      p(
        `Modelos da categoria: ${o.modelos}. O cliente reserva a categoria, não o modelo: ele recebe um dos modelos listados.`,
      ),
      h("Pessoas e malas"),
      capTable(o.cap, o.malas),
      note(
        "Quanto mais pessoas, menos malas cabem: os bancos extras ocupam o espaço do porta-malas.",
      ),
      h("Valores da categoria"),
      table(
        ["Item", "Valor"],
        [
          ["Franquia do seguro", o.franquia],
          ["Taxa de reabastecimento (devolução sem tanque cheio)", o.tanque],
        ],
      ),
      ...(o.regras?.length ? [h("Regras da categoria"), ...o.regras] : []),
      ...(o.media.length ? [h("Vídeo e fotos"), ...o.media] : []),
      ...(o.extra ?? []),
      h("Nome no material em espanhol"),
      p(`No material para clientes de língua espanhola, esta categoria aparece como "${o.es}".`),
    ],
  });
}

const FROTA = [
  fleetPage({
    key: "sedan",
    title: "Sedan",
    modelos: "Toyota Corolla",
    es: "Categoría Sedan",
    cap: [["5", "2", "2"]],
    franquia: "US$ 1.000",
    tanque: "US$ 50",
    media: [
      video("Sedan (Toyota Corolla)", VID.sedan),
      p(
        "Vídeo sem fala mostrando o Corolla por dentro e por fora. Pode ser enviado ao cliente que quer ver o carro.",
      ),
    ],
  }),
  fleetPage({
    key: "suv-media",
    title: "SUV Média",
    modelos: "Kia Sportage, Hyundai Tucson ou Toyota RAV4",
    es: "Categoría SUV Mediana",
    cap: [
      ["2", "7", "3"],
      ["3", "6", "2"],
      ["4", "4", "2"],
      ["5", "3", "2"],
    ],
    franquia: "US$ 1.000",
    tanque: "US$ 60",
    media: [
      video("SUV Média", VID.suvMedia),
      p("Vídeo sem fala: 5 lugares e central multimídia com CarPlay."),
    ],
  }),
  fleetPage({
    key: "suv-grande",
    title: "SUV Grande (Full Size)",
    modelos: "Kia Sorento, Toyota Highlander ou Hyundai Palisade",
    es: "Categoría SUV Grande",
    cap: [
      ["5", "4", "2"],
      ["6", "4", "2"],
      ["7", "1", "2"],
    ],
    franquia: "US$ 1.000",
    tanque: "US$ 65",
    media: [
      video("SUV Full Size", VID.fullSize),
      p("Vídeo sem fala: 7 lugares, interior e CarPlay."),
    ],
    extra: [
      warn(
        "Com 7 pessoas só cabe 1 mala grande. Para família de 7 com bagagem, ofereça Minivan ou SUV Executive.",
      ),
    ],
  }),
  fleetPage({
    key: "minivan",
    title: "Minivan",
    modelos: "Kia Carnival (8 lugares)",
    es: "Categoría Minivan",
    cap: [
      ["5", "9", "3"],
      ["6", "7", "3"],
      ["7", "6", "3"],
      ["8", "4", "2"],
    ],
    franquia: "US$ 1.000",
    tanque: "Não informado no manual: confirme com a gestão",
    media: [video("Minivan (Kia Carnival)", VID.minivan), p("Vídeo sem fala da Kia Carnival.")],
  }),
  fleetPage({
    key: "suv-executive",
    title: "SUV Executive",
    modelos: "Chevrolet Suburban ou GMC Yukon XL (7 ou 8 lugares)",
    es: "Categoría SUV Executive",
    cap: [
      ["5", "11", "5"],
      ["6", "9", "4"],
      ["7", "8", "4"],
      ["8", "6", "2"],
    ],
    franquia: "US$ 3.000",
    tanque: "US$ 98",
    regras: [
      warn("Não temos a versão 4x4 nem a versão com bancos reclináveis na segunda fileira."),
      note(
        "O CS pergunta ao cliente quantas pessoas vão viajar e anota na observação da reserva no HQ (7 ou 8 lugares).",
      ),
    ],
    media: [
      video("Suburban 7 lugares", VID.sub7),
      video("Suburban 8 lugares", VID.sub8),
      p(
        "Vídeos sem fala: bancos de couro, terceira fileira rebatível (porta-malas plano) e CarPlay.",
      ),
    ],
  }),
  fleetPage({
    key: "van",
    title: "Van 12 lugares",
    modelos: "Ford Transit (teto baixo)",
    es: "Categoría Furgoneta de 12 plazas",
    cap: [["12", "7", "5"]],
    malas: ["Malas médias", "Malas pequenas"],
    franquia: "US$ 3.000",
    tanque: "US$ 95",
    regras: [
      note("A Van é teto baixo (low roof)."),
      warn(
        "A Van sempre fica no estacionamento: o CS envia o template de estacionamento, exceto em horário comercial em Orlando.",
      ),
    ],
    media: [],
  }),
  fleetPage({
    key: "luxury",
    title: "Luxury",
    modelos: "Cadillac Escalade ESV",
    es: "Categoría Luxury",
    cap: [
      ["5", "11", "5"],
      ["6", "9", "4"],
      ["7", "8", "4"],
    ],
    franquia: "US$ 3.000",
    tanque: "Não informado no manual: confirme com a gestão",
    media: [foto("Cadillac Escalade ESV", VID.cadillac)],
  }),
];

const visaoFrota = (area: string): CPage => ({
  id: `frota-visao-geral-${area}`,
  title: "Visão geral da frota",
  summary:
    "As 7 categorias, quantas pessoas cabem, franquia e as regras que valem para toda a frota.",
  keywords: "frota categorias modelos capacidade flota",
  blocks: [
    p(
      "Alugamos por categoria, não por modelo: o cliente garante a categoria e recebe um dos modelos dela. Todos os carros são novos.",
    ),
    { t: "widget", name: "fleet", area },
    h("Categorias"),
    table(
      ["Categoria", "Modelos", "Pessoas", "Franquia"],
      [
        ["Sedan", "Toyota Corolla", "até 5", "US$ 1.000"],
        ["SUV Média", "Sportage, Tucson, RAV4", "até 5", "US$ 1.000"],
        ["SUV Grande (Full Size)", "Sorento, Highlander, Palisade", "até 7", "US$ 1.000"],
        ["Minivan", "Kia Carnival", "até 8", "US$ 1.000"],
        ["SUV Executive", "Suburban, Yukon XL", "até 8", "US$ 3.000"],
        ["Van 12 lugares", "Ford Transit", "até 12", "US$ 3.000"],
        ["Luxury", "Cadillac Escalade ESV", "até 7", "US$ 3.000"],
      ],
    ),
    h("Pessoas e malas"),
    p("Malas grandes (23 kg) / pequenas (10 kg) que cabem conforme o número de pessoas."),
    table(
      ["Categoria", "Pessoas: malas grandes / pequenas"],
      [
        ["Sedan", "5p: 2/2"],
        ["SUV Média", "2p: 7/3 · 3p: 6/2 · 4p: 4/2 · 5p: 3/2"],
        ["SUV Grande (Full Size)", "5p: 4/2 · 6p: 4/2 · 7p: 1/2"],
        ["Minivan", "5p: 9/3 · 6p: 7/3 · 7p: 6/3 · 8p: 4/2"],
        ["SUV Executive", "5p: 11/5 · 6p: 9/4 · 7p: 8/4 · 8p: 6/2"],
        ["Van 12 lugares", "12p: 7 médias / 5 pequenas"],
        ["Luxury", "5p: 11/5 · 6p: 9/4 · 7p: 8/4"],
      ],
    ),
    note(
      "Abra a página da categoria para ver a taxa de combustível, as regras e o vídeo do carro.",
    ),
    h("Regras de toda a frota"),
    {
      t: "cards",
      items: [
        {
          icon: "route",
          title: "Quilometragem livre",
          text: "Sem limite, mas é proibido sair da Flórida (o seguro só vale lá).",
        },
        {
          icon: "users",
          title: "Condutor adicional",
          text: "Sem custo. Idade mínima de 21 anos para todos os motoristas.",
        },
        {
          icon: "baby",
          title: "Cadeirinhas grátis",
          text: "Bebê conforto, cadeirinha e booster, quantos forem necessários.",
        },
        {
          icon: "fuel",
          title: "Tanque cheio",
          text: "Entregue cheio, devolve cheio. Senão, taxa de reabastecimento.",
        },
        {
          icon: "calendar",
          title: "Mínimo de 5 diárias",
          text: "Consecutivas. Pode haver exceção para cliente com 2 reservas.",
        },
        {
          icon: "car",
          title: "Carros novos",
          text: "Aluguel por categoria: o cliente recebe um dos modelos dela.",
        },
      ],
    },
    h("Nomes no material em espanhol"),
    table(
      ["Categoria", "No material em espanhol"],
      [
        ["Sedan", "Categoría Sedan"],
        ["SUV Média", "Categoría SUV Mediana"],
        ["SUV Grande (Full Size)", "Categoría SUV Grande"],
        ["Minivan", "Categoría Minivan"],
        ["SUV Executive", "Categoría SUV Executive"],
        ["Van 12 lugares", "Categoría Furgoneta de 12 plazas"],
        ["Luxury", "Categoría Luxury"],
      ],
    ),
  ],
});

// ───────────── Textos para o cliente (PT e ES), do Manual ORC ─────────────

const CLI = {
  pagamentoPT:
    "Você não precisa pagar tudo agora! Basta um sinal de US$ 100 e o restante pode ser pago na retirada do veículo.\n\nFormas de pagamento: cartão de crédito, cartão de débito, PIX e dinheiro.\n\nTambém é possível parcelar no cartão de crédito brasileiro, sem IOF. Nesse caso, o valor é convertido em reais com acréscimo de juros e da taxa de conversão da plataforma.",
  pagamentoES:
    "¡No necesitas pagar todo ahora! Solo se requiere un depósito de US$ 100 y el resto puede pagarse al retirar el vehículo.\n\nFormas de pago: tarjeta de crédito, tarjeta de débito y efectivo.\n\nTambién es posible dividir el monto con una tarjeta de crédito brasileña sin IOF. En este caso, el valor se convierte a reales con un incremento de intereses y la tarifa de conversión de la plataforma.",
  cancelPT:
    "Na Orlando Rent Car prezamos pela transparência. Nossa política de cancelamento:\n\n1. Cancelamento com 60 dias ou mais de antecedência: reembolso total do valor pago.\n2. Cancelamento com menos de 60 dias de antecedência: o valor não é reembolsado, mas vira crédito para uso em futuras viagens.",
  cancelES:
    "En Orlando Rent Car valoramos la transparencia. Nuestra política de cancelación:\n\n1. Cancelación con 60 días o más de anticipación: reembolso total del importe pagado.\n2. Cancelación con menos de 60 días de anticipación: el importe no se reembolsa, pero se convierte en crédito para futuros viajes.",
  seguroPT:
    "Sobre o nosso seguro:\n\n• Sem caução: em caso de sinistro, a franquia é cobrada diretamente.\n• Franquia de US$ 1.000 (US$ 3.000 para SUV Executive Suburban e Van Ford Transit).\n• Cobertura total da frota: clientes assegurados em até US$ 20.000 e terceiros em até US$ 1 milhão.\n• O seguro vale somente dentro do estado da Flórida.\n• Em caso de sinistro, é obrigatório chamar a polícia (911) e ligar imediatamente para o nosso suporte por chamada de WhatsApp: +1 (689) 226-3641.",
  seguroES:
    "Sobre nuestro seguro:\n\n• Sin depósito: en caso de siniestro, la franquicia se cobra directamente.\n• Franquicia de US$ 1.000 (US$ 3.000 para la SUV Ejecutiva Suburban y la Van Ford Transit).\n• Cobertura total de la flota: clientes asegurados hasta US$ 20.000 y terceros hasta US$ 1 millón.\n• El seguro es válido únicamente dentro del estado de Florida.\n• En caso de siniestro, es obligatorio llamar a la policía (911) y a nuestro soporte de inmediato por llamada de WhatsApp: +1 (689) 226-3641.",
  dicasPT:
    "Dicas importantes para a viagem:\n\n• Quilometragem ilimitada: dirija à vontade, só não pode sair do estado da Flórida.\n• Documentação: o documento do carro e o cartão do seguro ficam no porta-luvas e devem ser apresentados se você for parado pela polícia.\n• Tanque cheio: o carro é entregue com o tanque cheio e deve ser devolvido assim, para evitar a taxa de reabastecimento.\n• Pedágios: o carro tem a TAG do SunPass, com passagem livre. Não cobramos nada antecipado, só repassamos os pedágios usados no fim da reserva.",
  dicasES:
    "Consejos importantes para el viaje:\n\n• Kilometraje ilimitado: puedes conducir todo lo que desees, siempre que te mantengas dentro del estado de Florida.\n• Documentación: los documentos del vehículo y la tarjeta del seguro están en la guantera y deben presentarse si es necesario.\n• Devolución y depósito lleno: el vehículo debe devolverse en la fecha y hora reservadas, con el depósito lleno, para evitar cargos de repostaje. La extensión del alquiler depende de la disponibilidad.\n• Peajes: el vehículo tiene un TAG SunPass. Solo pagas los peajes utilizados, al final de la reserva.",
  beneficiosPT:
    "Mais benefícios para você!\n\n• Condutores adicionais com tarifa zero: adicione outros motoristas sem pagar nada a mais.\n• Cadeirinha sem custo: é obrigatório o uso de cadeirinha até os 4 anos e de assento elevado (booster) de 5 a 7 anos. Colocamos quantas cadeirinhas forem necessárias, sem custo adicional (bebê conforto, cadeirinha e booster).",
  beneficiosES:
    "¡Más beneficios para ti!\n\n• Conductores adicionales sin costo: puedes agregar otros conductores sin pagar nada extra.\n• Sillas de bebé gratuitas: es obligatorio el uso de silla infantil hasta los 4 años y de asiento elevado (booster) de 5 a 7 años. Proporcionamos todas las sillas necesarias sin costo adicional (sillita de coche, asiento de bebé y booster).",
  mcoPT:
    "Orlando (MCO): o veículo fica disponível no estacionamento e o time de logística entra em contato perto da sua chegada com todas as orientações. O estacionamento de saída (até US$ 25) é por conta do cliente. Entrega em mãos no Lounge até as 21h, por US$ 40.",
  mcoES:
    "Orlando (MCO): el vehículo estará disponible en el estacionamiento y el equipo de logística se pondrá en contacto cerca de su llegada con todas las instrucciones. El estacionamiento de salida (hasta US$ 25) corre por cuenta del cliente. Entrega en mano en el Lounge hasta las 21:00, por US$ 40.",
  miaPT:
    "Miami (MIA) e Fort Lauderdale (FLL): nosso time fará o possível para entregar o veículo em mãos. Se a logística do dia não permitir, o carro fica no estacionamento do aeroporto e enviamos todas as informações, com fotos e vídeos. Nesse caso, o estacionamento de saída é por conta do cliente.",
  miaES:
    "Miami (MIA) y Fort Lauderdale (FLL): nuestro equipo hará todo lo posible para entregar el vehículo en persona. Si la logística del día no lo permite, el vehículo estará en el estacionamiento del aeropuerto y enviaremos toda la información, con fotos y videos. En ese caso, el estacionamiento de salida corre por cuenta del cliente.",
  outrosPT:
    "Tampa (TPA) e Sanford (SFB): taxa de deslocamento de US$ 120 por trecho, porque nossa base é em Orlando. Entrega em mãos ou retirada no estacionamento, com instruções do time de logística.\n\nHotéis em Orlando: US$ 80 por trecho (casa de férias: US$ 120), com horário combinado.\n\nHotéis ou porto de Miami e de Fort Lauderdale: US$ 120 por trecho.",
  outrosES:
    "Tampa (TPA) y Sanford (SFB): tarifa de desplazamiento de US$ 120 por trayecto, debido a nuestra base en Orlando. Entrega en persona o recogida en el estacionamiento, con instrucciones del equipo de logística.\n\nHoteles en Orlando: US$ 80 por tramo (casas de vacaciones: US$ 120), con horario acordado.\n\nHoteles o puertos de Miami y de Fort Lauderdale: US$ 120 por tramo.",
};

const textoCliente = (pt: string, es: string): Block[] => [
  h("Texto para o cliente"),
  msg("Português", pt),
  msg("Español", es),
];

const TAXAS_ENTREGA = table(
  ["Local", "Taxa por trecho"],
  [
    ["Aeroporto de Orlando (MCO), Aeroporto de Miami (MIA), trem Brightline", "Sem taxa"],
    ["Entrega em mãos no Lounge ORC (Orlando)", "US$ 40"],
    ["Aeroporto de Fort Lauderdale (FLL)", "US$ 60"],
    ["Hotel em Orlando", "US$ 80"],
    ["Casa de férias em Orlando, Porto Canaveral", "US$ 120"],
    ["Aeroportos de Tampa (TPA) e Sanford (SFB)", "US$ 120"],
    ["Hotel ou porto em Miami e em Fort Lauderdale", "US$ 120"],
    ["Transfer de malas/pessoas em Orlando", "US$ 100"],
    ["One way (devolver em outra cidade)", "US$ 99"],
  ],
);

const combustivel = (): Block[] => [
  p(
    "O carro é entregue com tanque cheio e deve voltar com tanque cheio. Se não voltar, cobramos a taxa de reabastecimento, que pode chegar a 1,5 vez o valor do posto.",
  ),
  table(
    ["Categoria", "Taxa de reabastecimento"],
    [
      ["Sedan", "US$ 50"],
      ["SUV Média", "US$ 60"],
      ["SUV Grande (Full Size)", "US$ 65"],
      ["Van 12 lugares", "US$ 95"],
      ["SUV Executive", "US$ 98"],
    ],
  ),
  note(
    'O posto mais próximo do aeroporto de Orlando é o 7-Eleven. Para mostrar ao cliente como abastecer, use a página "Como abastecer nos EUA".',
  ),
];

const seguroBlocks = (): Block[] => [
  table(
    ["Item", "Regra"],
    [
      ["Caução", "Não cobramos. Em caso de sinistro, a franquia é cobrada diretamente."],
      [
        "Franquia",
        "US$ 1.000 (Sedan a Minivan) · US$ 3.000 (SUV Executive, Van 12 lugares e Luxury)",
      ],
      ["Passageiros", "Até US$ 20.000 por passageiro"],
      ["Terceiros", "Até US$ 1.000.000"],
      ["Veículo", "Cobertura total"],
      ["Onde vale", "Somente no estado da Flórida"],
    ],
  ),
  h("Roubo, furto e arrombamento"),
  list([
    "Carro roubado ou furtado que desaparece: perda total, coberta pelo seguro. Não há franquia, desde que haja boletim de ocorrência.",
    "Carro arrombado com pertences levados: a franquia é cobrada quando o reparo fica abaixo do valor dela (US$ 1.000, ou US$ 3.000 na Executive e na Van).",
  ]),
  h("Em caso de acidente"),
  steps([
    { title: "Chamar a polícia", text: "Ligue 911. É obrigatório." },
    {
      title: "Avisar o suporte ORC",
      text: "Ligação de WhatsApp (só ligação) para +1 (689) 226-3641.",
    },
  ]),
  note("O certificado do seguro só pode ser enviado depois que o cliente fecha a reserva."),
];

const abastecer = (): Block[] => [
  p(
    "Nos EUA o próprio cliente abastece e paga na bomba. Envie este passo a passo (ou o vídeo) para quem nunca abasteceu lá.",
  ),
  steps([
    { title: "Inserir o cartão", text: "Crédito ou débito, no leitor da bomba." },
    {
      title: "Digitar senha ou ZIP code",
      text: "Se pedir ZIP code e o cartão for brasileiro, tente o pagamento no caixa da loja.",
    },
    { title: "Retirar o cartão", text: "Quando a tela aprovar." },
    { title: "Recusar o programa de fidelidade", text: "Aperte NO." },
    { title: "Escolher a gasolina", text: "Regular 87 é a comum, serve para todos os carros." },
    {
      title: "Abastecer",
      text: "Coloque a pistola no tanque e aperte o gatilho. Ela trava sozinha quando o tanque enche.",
    },
    { title: "Finalizar", text: "Devolva a pistola ao suporte." },
  ]),
];

// Perguntas que o cliente mais faz, com a resposta pronta em PT e ES (do Manual ORC).
const FAQ: { q: string; a: string; pt: string; es: string }[] = [
  {
    q: "Posso sair da Flórida com o carro?",
    a: "Não. A quilometragem é livre, mas só dentro da Flórida; o seguro não cobre fora do estado.",
    pt: "A quilometragem é livre, você pode dirigir à vontade, mas só dentro do estado da Flórida. O seguro não cobre viagens para fora do estado.",
    es: "El kilometraje es ilimitado, puedes conducir todo lo que desees, pero solo dentro del estado de Florida. El seguro no cubre viajes fuera del estado.",
  },
  {
    q: "Precisa deixar caução?",
    a: "Não. Em caso de sinistro, a franquia é cobrada diretamente.",
    pt: "Não cobramos caução, porque entendemos que isso pode causar transtornos durante a viagem. Em caso de sinistro, a franquia é cobrada de forma direta.",
    es: "No solicitamos depósito, porque entendemos que puede causar inconvenientes durante el viaje. En caso de siniestro, la franquicia se cobra directamente.",
  },
  {
    q: "Cadeirinha e condutor adicional são pagos?",
    a: "Não. Os dois são sem custo.",
    pt: "Não! Você pode adicionar outros motoristas sem pagar nada a mais, e colocamos quantas cadeirinhas forem necessárias (bebê conforto, cadeirinha e booster), sem custo adicional.",
    es: "¡No! Puedes agregar otros conductores sin pagar nada extra y proporcionamos todas las sillas infantiles necesarias (sillita de coche, asiento de bebé y booster), sin costo adicional.",
  },
  {
    q: "Preciso pagar tudo agora?",
    a: "Não. Sinal de US$ 100; o restante na retirada.",
    pt: "Você não precisa pagar tudo agora! Basta um sinal de US$ 100 e o restante pode ser pago na retirada do veículo.",
    es: "¡No necesitas pagar todo ahora! Solo se requiere un depósito de US$ 100 y el resto puede pagarse al retirar el vehículo.",
  },
  {
    q: "Vou receber exatamente o modelo da foto?",
    a: "O aluguel é por categoria: o cliente recebe um dos modelos da categoria.",
    pt: "O aluguel é feito por categoria de veículo, e não por modelo específico. Você recebe um dos modelos da categoria reservada.",
    es: "El alquiler se realiza por categoría de vehículo, no por modelo específico. Recibirás uno de los modelos de la categoría reservada.",
  },
  {
    q: "Como funcionam os pedágios?",
    a: "O carro tem SunPass; cobramos só os pedágios usados, no fim.",
    pt: "O carro tem a TAG do SunPass, com passagem livre nas estradas. Não cobramos nada antecipado: só repassamos os pedágios usados, ao final da reserva.",
    es: "El vehículo tiene un TAG SunPass para peajes electrónicos. No cobramos nada por adelantado: solo pagas los peajes utilizados, al final de la reserva.",
  },
  {
    q: "Tenho que devolver com tanque cheio?",
    a: "Sim. Senão há taxa de reabastecimento (até 1,5x o valor do posto).",
    pt: "Sim. O carro é entregue com o tanque cheio e pedimos que seja devolvido assim, para evitar a taxa de reabastecimento.",
    es: "Sí. El vehículo se entrega con el depósito lleno y solicitamos que sea devuelto de la misma manera, para evitar cargos de repostaje.",
  },
  {
    q: "E se eu precisar cancelar?",
    a: "60 dias ou mais: reembolso total. Menos de 60: vira crédito.",
    pt: CLI.cancelPT,
    es: CLI.cancelES,
  },
  {
    q: "E se acontecer um acidente?",
    a: "Chamar a polícia (911) e ligar para o suporte pelo WhatsApp.",
    pt: "Em caso de sinistro, é obrigatório chamar a polícia (911) e ligar imediatamente para o nosso suporte por chamada de WhatsApp: +1 (689) 226-3641.",
    es: "En caso de siniestro, es obligatorio llamar a la policía (911) y a nuestro soporte de inmediato por llamada de WhatsApp: +1 (689) 226-3641.",
  },
];
const faqPage = (cat: string, id: string): CPage => ({
  id,
  cat,
  title: "Perguntas frequentes do cliente",
  summary:
    "As dúvidas que mais chegam no WhatsApp, com a resposta curta e a mensagem pronta em PT e ES.",
  keywords:
    "faq duvidas perguntas cliente caucao florida cadeirinha pedagio tanque cancelar acidente",
  blocks: [{ t: "faq", items: FAQ }],
});

// Quiz de treino: perguntas tiradas da própria base. `page` leva à página da resposta.
type Q = { q: string; options: string[]; correct: number; why: string; page: string };
const quizPage = (area: "comercial" | "cs", cat: string): CPage => {
  const pg = (com: string, cs: string) => (area === "comercial" ? com : cs);
  const items: Q[] = [
    {
      q: "Qual é a franquia da SUV Executive (Suburban)?",
      options: ["US$ 1.000", "US$ 2.000", "US$ 3.000", "Não tem franquia"],
      correct: 2,
      why: "SUV Executive, Van 12 lugares e Luxury têm franquia de US$ 3.000. As demais, US$ 1.000.",
      page: pg("seguro-e-franquia", "politica-de-seguro-es"),
    },
    {
      q: "Quanto custa entregar o carro no aeroporto de Tampa?",
      options: ["Sem taxa", "US$ 60 por trecho", "US$ 80 por trecho", "US$ 120 por trecho"],
      correct: 3,
      why: "Tampa e Sanford: US$ 120 por trecho, porque a base é em Orlando.",
      page: pg("retirada-tampa-sanford", "retirada-em-orlando"),
    },
    {
      q: "O cliente cancelou faltando 40 dias. O que acontece?",
      options: [
        "Reembolso total",
        "Reembolso de 50%",
        "O valor vira crédito para a próxima viagem",
        "Perde tudo",
      ],
      correct: 2,
      why: "Com 60 dias ou mais, reembolso total. Com menos de 60, o valor vira crédito.",
      page: pg("cancelamento-e-alteracoes", "politica-de-cancelamento-es"),
    },
    {
      q: "Família de 7 pessoas com 6 malas grandes. Qual categoria serve?",
      options: ["SUV Grande (Full Size)", "Minivan", "SUV Média", "Sedan"],
      correct: 1,
      why: "Com 7 pessoas a Minivan leva 6 malas grandes e 3 pequenas. A Full Size leva só 1 grande.",
      page: `frota-visao-geral-${area}`,
    },
    {
      q: "Quanto o cliente paga para confirmar a reserva?",
      options: ["Nada", "Sinal de US$ 100", "50% do total", "O valor total"],
      correct: 1,
      why: "Sinal de US$ 100; o restante é pago na retirada.",
      page: pg("pagamento-condicoes", "formas-de-pagamento"),
    },
    {
      q: "O cliente pode viajar com o carro para a Geórgia?",
      options: [
        "Sim, a quilometragem é livre",
        "Sim, pagando taxa",
        "Não: só dentro da Flórida",
        "Só com o seguro extra",
      ],
      correct: 2,
      why: "A quilometragem é livre, mas só na Flórida. O seguro não vale fora do estado.",
      page: pg("dicas-de-viagem", "dicas-de-viagem-e-condicao-es"),
    },
    {
      q: "Voo chega às 18h. Qual horário de retirada lançar no HQ?",
      options: ["18h", "18h30", "19h", "20h"],
      correct: 2,
      why: "Retirada 1 hora depois do pouso, para imigração e atrasos.",
      page: pg("reserva-lancamento-hq", "conferencia-e-orientacoes"),
    },
    {
      q: "O Sedan voltou sem tanque cheio. Qual é a taxa?",
      options: ["US$ 30", "US$ 50", "US$ 65", "US$ 98"],
      correct: 1,
      why: "Taxa de reabastecimento do Sedan: US$ 50 (pode chegar a 1,5x o valor do posto).",
      page: pg("politica-de-combustivel", "taxas-de-combustivel"),
    },
  ];
  return {
    id: `quiz-${area}`,
    cat,
    title: "Teste seus conhecimentos",
    summary:
      "8 perguntas rápidas sobre frota, taxas, seguro e regras. Cada resposta leva à página certa.",
    keywords: "quiz teste treino onboarding perguntas",
    blocks: [{ t: "quiz", area, items }],
  };
};

// ───────────── Comercial ─────────────

const TPL_COMERCIAL: [string, string[]][] = [
  ["Parcerias", ["Parceria carrinho", "Parceria casa", "Parceria influenciadores", "Transfer P"]],
  [
    "Follow-up",
    [
      "com_confirmar_necessidade",
      "com_criterioedecisao",
      "com_decisao",
      "com_dica",
      "com_localizar_objecao",
      "com_percepcao",
      "com_sinal2",
      "com_viagem_pro",
      "Com_visu_sem_resposta",
      "Com_parc",
      "Com_lembrete_cotacao",
      "Com_follow_material",
      "Reserva_agencia",
      "Com_de_pe_viagem",
      "Com_fazsentido_pt",
      "Com_contato_pt",
      "Com_viagem_pt",
      "Com_sem_passagem",
      "Com_sem_visto",
    ],
  ],
  [
    "Follow-up via API (janela fechada)",
    [
      "Follow COM – escassez 2 API",
      "Follow com – escassez API",
      "Follow COM API",
      "Contato COM – UTI API",
      "Follow utility 2 API",
      "Contato Utility API",
      "Follow Utility API",
      "Follow UP API",
      "Novo modelo WhatsApp API",
      "Follow 2 mais antigo COM API",
      "Follow up mais antigo com API",
      "Indicação Comercial API",
      "Follow 2 API",
      "Sinal RA COM API",
      "Preparativos API",
    ],
  ],
  [
    "Campanhas e várias tentativas",
    [
      "Disc.Ped",
      "Dez COm",
      "Julho COM",
      "Varias Tent.COM 1",
      "Varias tent.COM 2",
      "Varias Tent.COM 3",
      "Upgrade COM",
      "Dis COM",
    ],
  ],
  [
    "Fechamento",
    [
      "Condições de reserva",
      "Cadeira ou booster",
      "Fechamento cobrança Port",
      "Envio contrato fechamento",
      "Validação de contr.COM",
      "Entrega e devolução",
      "Margem H. COM",
      "Vídeo GP",
    ],
  ],
  [
    "Objeções",
    [
      "Objeção Pesquisa COM",
      "Locadora convencional",
      "Locadora convencional 2",
      "Locadora convencional 3",
      "Quebra de objeção",
      "Quebra de objeções Preço alto Cont.",
      "Entendo e Entendo 2",
    ],
  ],
  [
    "Boas-vindas",
    [
      "Boas vindas 2 API",
      "Boas vindas Port API",
      "Boas vindas 3 API",
      "Boas vindas 1 ES API",
      "Boas vindas 2 ES API",
      "Boas vindas 3 ES API",
      "BV Mauro",
      "Nathalia Agencia -API",
      "Canal de origem",
    ],
  ],
  [
    "Informações sobre o serviço",
    [
      "Malas – Transfer",
      "Van Chegada",
      "Van 12 lugares",
      "Pedágio",
      "Recb. Loun",
      "Recb.Estac.",
      "Retirada COM",
      "Horário Mia/FLL",
      "Zelle",
      "Proposta",
      "Perdido",
      "Indisponibilidade",
      "Cancelamento Politica",
      "Endereço",
      "Diaria",
      "Seguro",
      "Formas de pagamento",
      "Carro",
    ],
  ],
];

const COMERCIAL: Curadoria = {
  hide: [],
  pages: [
    // Sistemas → HQ
    {
      id: "hq-introducao",
      title: "Introdução ao HQ",
      summary: "O painel inicial do HQ: manifesto do dia, disponibilidade e frota.",
      blocks: [
        video("Introdução ao HQ", "1UxVqdZPBTd1Iu_q6XOgzPxhSc39GjB01"),
        p(
          "O HQ Rental Software é onde ficam as reservas, os clientes e a disponibilidade da frota. Ao entrar, o painel inicial mostra o Manifesto Diário.",
        ),
        table(
          ["Área", "Para que serve"],
          [
            ["Manifesto Diário", "Retiradas e devoluções do dia e o status de cada uma."],
            ["Disponibilidade", "Quantos carros há em cada categoria no período escolhido."],
            ["Frota", "Taxa de utilização. Usada pela gestão para planejar campanhas."],
          ],
        ),
        warn(
          "Na Disponibilidade, escolha sempre um dia a mais no fim do período: o gráfico zera no último dia selecionado.",
        ),
      ],
    },
    {
      id: "hq-observacoes-de-contato",
      title: "Observações de contato no HQ",
      summary: "Onde registrar com quem falar e quem paga, principalmente em reserva de agência.",
      blocks: [
        video("Lançamento de agência", "1fn8HOy6mzKuV1UocyT5JbADMBJdwKNv6"),
        steps([
          { title: "Abrir a reserva no HQ", text: "Role até a seção de comentários." },
          {
            title: "Registrar as regras de contato",
            text: "Escreva com quem o time deve falar (cliente ou agência) e quem recebe a cobrança.",
          },
        ]),
        note(
          "Sem essa observação, o CS pode cobrar o cliente final de uma reserva que a agência paga.",
        ),
      ],
    },
    // Sistemas → CRM
    {
      id: "crm-atendimento",
      title: "Atendimento e mensagens",
      summary:
        "Assumir conversas da IA, encerrar, devolver à fila e mandar mensagem com a janela fechada.",
      blocks: [
        h("Assumir o atendimento"),
        p("Quando a IA transfere a conversa ou para de responder, o atendimento passa a ser seu."),
        steps([
          {
            title: "Aceitar a conversa",
            text: "Na aba Pendentes, clique em Aceitar conversa. Ela vai para a sua aba Ativos.",
          },
          {
            title: "Preencher o painel lateral",
            list: [
              "Origem do lead",
              "Etiqueta",
              "Atendente padrão (você)",
              "Departamento padrão: Comercial",
            ],
          },
        ]),
        warn(
          "Nunca encerre sem preencher o atendente padrão: o próximo contato do cliente vai cair para outro colega.",
        ),
        h("Encerrar e devolver à fila"),
        steps([
          {
            title: "Encerrar quando o cliente não responde",
            text: "Se não houver resposta 10 a 30 minutos depois do follow-up, clique no X no canto superior direito do chat e escolha o motivo (Sem resposta ou Atendimento finalizado).",
          },
          {
            title: "Devolver à fila para escrever livre",
            text: "Com a janela de 24 horas aberta, em Atendimentos clique em Retornar à fila e confirme. A conversa vai para Pendentes; aceite de novo para escrever.",
          },
        ]),
        note(
          "Deixe na aba Ativos só quem está conversando agora. Quando o cliente responder, a conversa volta sozinha para Pendentes.",
        ),
        h("Janela de 24 horas"),
        list([
          "Janela aberta (o cliente falou nas últimas 24 horas): pode mandar mensagem livre.",
          "Janela fechada: só template aprovado.",
          "Se a mensagem de uma tarefa não foi enviada, abra a oportunidade (três pontos) e use Criar atendimento: o CRM puxa o canal e o departamento da última conversa.",
        ]),
        note("Notas internas registram informações na conversa e o cliente não vê."),
      ],
    },
    {
      id: "crm-oportunidades",
      title: "Oportunidades e funil de vendas",
      summary: "Criar e atualizar a oportunidade em cada etapa, filtrar o funil e lead de agência.",
      blocks: [
        h("Criar a oportunidade"),
        steps([
          { title: "Abrir pelo chat", text: "Clique no ícone de oportunidade no painel lateral." },
          {
            title: "Preencher",
            list: [
              "Nome do cliente",
              "Pipeline Comercial e etapa atual",
              "Previsão de fechamento = data de chegada do cliente",
              "Produtos = categorias cotadas (ex.: SUV Média e Full Size)",
            ],
          },
          { title: "Salvar" },
        ]),
        note(
          "O campo Previsão de Fechamento guarda a data de chegada do cliente, não a data provável da venda.",
        ),
        h("Etapas do funil"),
        table(
          ["Etapa", "Quando usar"],
          [
            ["Aguardando proposta", "Lead novo, sem proposta enviada."],
            ["Proposta enviada", "Cotação entregue ao cliente."],
            ["Aguardando sinal", "Reserva lançada, esperando o sinal de US$ 100."],
            ["Ganho / Perdido", "Resultado final."],
          ],
        ),
        h("Quando o cliente fecha"),
        steps([
          {
            title: "Mudar a etapa",
            text: "De Proposta enviada para Aguardando pagamento do sinal.",
          },
          {
            title: "Renomear",
            text: "Coloque o número da reserva e o nome do cliente. Ex.: RA 7261 Thayanne Belarmino.",
          },
        ]),
        h("Filtrar o funil"),
        steps([
          {
            title: "Abrir o pipeline",
            text: "Ícone de funil na barra lateral e funil Comercial no topo.",
          },
          {
            title: "Aplicar filtros",
            text: "Botão Filtros: escolha o tipo de data (criação ou previsão de fechamento) e o período. Dá para filtrar também por responsável, etiqueta, tickets sem resposta e mensagens não lidas.",
          },
        ]),
        h("Lead de agência"),
        p(
          "Toda agência é atendida pela Nathalia: transfira na hora o lead que se identificar como agência.",
        ),
        list([
          "Origem do lead: a agência",
          "Etiqueta: quem fez o primeiro atendimento",
          "Atendente padrão: Nathalia",
          "Departamento: Comercial",
        ]),
      ],
    },
    {
      id: "crm-tarefas",
      title: "Tarefas e follow-up",
      summary: "Nenhum cliente sem tarefa: como criar, acompanhar e concluir follow-ups.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "24h", label: "janela para o follow-up" },
            { value: "0", label: "clientes sem tarefa" },
          ],
        },
        warn(
          "Nenhuma oportunidade pode ficar sem tarefa ou com tarefa atrasada. Todo follow-up é feito por tarefa.",
        ),
        h("Criar a tarefa"),
        steps([
          { title: "Abrir a oportunidade", text: "No card, menu de três pontos > Nova tarefa." },
          {
            title: "Preencher",
            list: [
              "Tipo: 24h ou follow combinado",
              "Descrição: o que vai ser feito",
              "Data e hora: antes de a janela de 24 horas fechar",
              "Prioridade: baixa, média, alta ou urgente",
              "Observações: condições especiais ou descontos combinados",
            ],
          },
          {
            title: "Acoplar mensagem de WhatsApp (opcional)",
            text: "Ative a opção, escolha a mesma conexão que o cliente usa e o template. Templates com_ são do Comercial; cs_ são do CS.",
          },
          {
            title: "Salvar",
            text: "Não marque Notificar lead, Concluída nem Notificar responsável.",
          },
        ]),
        warn("Notificar lead manda um aviso automático para o cliente. Deixe desmarcado."),
        h("No dia da tarefa"),
        steps([
          {
            title: "Ver as tarefas do dia",
            text: "Ícone de lista na barra lateral, filtre pelo período e por você como responsável.",
          },
          {
            title: "Conferir o envio",
            text: "Abra a oportunidade e veja se a mensagem automática saiu. Se não saiu, use Criar atendimento.",
          },
          {
            title: "Concluir e criar a próxima",
            text: "Clique no check verde e já agende o próximo follow-up.",
          },
        ]),
        note(
          "Se o cliente responde, a janela ganha mais 24 horas. Visualizações disponíveis: Lista, Kanban, Foco, Calendário e Painel de Gestão.",
        ),
        h("Regras do time"),
        list([
          "Quem fizer um follow-up atrasado de outro colega fica com o lead.",
          "Responsável e quem fez o follow-up têm até 24 horas cada um para negociar, com contato que faça sentido na conversa.",
        ]),
      ],
    },
    {
      id: "crm-templates",
      title: "Templates comerciais",
      summary: "Todos os templates do Comercial, separados por momento da venda.",
      blocks: [
        p(
          'Clique no nome para ver o texto e copiar. Os que estão em cinza ainda não têm o texto cadastrado no documento "Templates de mensagem" do Drive.',
        ),
        ...TPL_COMERCIAL.map(([t, items]) => tags(t, items)),
        note("Com_fazsentido_pt e Com_contato_pt também existem em espanhol e inglês."),
      ],
    },
    {
      id: "crm-fechamento",
      title: "Fechamento no ClickMassa",
      summary:
        "Últimos passos depois do pagamento: passar o cliente para o CS e marcar como ganho.",
      blocks: [
        steps([
          {
            title: "Enviar as informações finais",
            text: "Texto de entrega e devolução e o PDF com as dicas.",
          },
          {
            title: "Passar para o CS",
            text: "Tire suas informações da etiqueta, deixe o atendente padrão em branco e mude o departamento para Sucesso do Cliente.",
          },
          {
            title: "Marcar como ganho",
            text: "Confira o número da reserva (RA), marque Ganho e encerre o ticket com o motivo Encerramento (Pesquisa) Comercial.",
          },
        ]),
        note("O CS faz o primeiro contato pelo menos 24 horas depois do ganho."),
      ],
    },
    // Reservas e Vendas
    {
      id: "reserva-cotacao",
      title: "Cotação de reserva",
      summary: "Montar a cotação no HQ e gerar o PDF para o cliente.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "3 dias", label: "validade da cotação em PDF" },
            { value: "8h", label: "horário padrão sem informação" },
            { value: "5", label: "diárias mínimas" },
          ],
        },
        steps([
          { title: "Nova reserva", text: "Central de Reservas > Nova Reserva." },
          {
            title: "Datas e locais",
            text: "Data e hora de retirada e devolução, e os locais. Sem horário informado, use 8h.",
          },
          {
            title: "Categoria",
            text: "Escolha a categoria disponível e clique em Alugar este veículo.",
          },
          {
            title: "Adicionais e descontos",
            text: "Marque adicionais, taxas de entrega, cupons ou cobranças manuais.",
          },
          {
            title: "Gerar o PDF",
            text: "Atualizar Reserva (recalcula) > Cotação > Imprimir cotação.",
          },
        ]),
        note("A cotação em PDF vale 3 dias."),
      ],
    },
    {
      id: "reserva-lancamento-hq",
      title: "Lançamento da reserva no HQ",
      summary: "Documentos, horários de voo, validação com o cliente e conclusão da reserva.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "+1h", label: "retirada depois do pouso" },
            { value: "−3h", label: "devolução antes do voo" },
            { value: "US$ 100", label: "sinal para confirmar" },
          ],
        },
        h("1. Documentos"),
        p(
          "Para confirmar a reserva o cliente envia: passagem aérea, CNH válida, endereços, e-mail e o sinal de US$ 100.",
        ),
        warn(
          "Sem o print da passagem, avise antes que uma mudança no horário do voo pode mudar o valor, para mais ou para menos.",
        ),
        h("2. Horários pelo voo"),
        table(
          ["", "Regra", "Exemplo"],
          [
            [
              "Retirada",
              "1 hora depois da chegada do voo (imigração e atrasos). Voo doméstico: pode ser 30 minutos.",
              "Voo chega 18h → retirada 19h",
            ],
            ["Devolução", "3 horas antes da partida do voo de volta.", "Voo sai 8h → devolução 5h"],
          ],
        ),
        h("3. Validação"),
        p(
          "Confira os dados nos campos personalizados do CRM e no HQ, compare com os documentos e envie a mensagem de validação. Só siga depois da confirmação do cliente.",
        ),
        h("4. Conclusão no CRM"),
        steps([
          {
            title: "Renomear a oportunidade",
            text: "RA + número + nome. Ex.: RA 7261 Thayanne Belarmino.",
          },
          { title: "Valor", text: "Valor da diária arredondado (ex.: 443). É a base da comissão." },
          { title: "Marcar como ganho", text: "Isso cria automaticamente as oportunidades do CS." },
          {
            title: "Passar o contato",
            text: "Tire a etiqueta e o atendente padrão e mude o departamento para Sucesso do Cliente.",
          },
        ]),
      ],
    },
    {
      id: "reserva-lancamentos-incompletos",
      title: "Lançamentos incompletos",
      summary: "O que fazer quando a reserva foi lançada pela metade e o responsável está offline.",
      blocks: [
        p(
          "Se a reserva foi lançada sem informações importantes e o responsável está offline, quem está no turno relança a reserva completa e continua o atendimento.",
        ),
        note(
          "Exemplo: a Nathalia lançou a reserva só com nome e e-mail e saiu. O cliente volta com os documentos no turno do Pedro: o Pedro relança completa e segue.",
        ),
        steps([
          { title: "Confirmar que o responsável está offline" },
          { title: "Ver o que falta", text: "Documentos, datas, voo, endereço, categoria." },
          {
            title: "Relançar a reserva completa",
            text: "Com todos os dados corretos, e continuar o atendimento.",
          },
        ]),
      ],
    },
    {
      id: "regras-operacionais",
      cat: "comercial-reservas-e-vendas",
      title: "Regras operacionais do time",
      summary:
        "Follow-up de outro colega, agências, última hora, tempo de resposta e leads duplicados.",
      blocks: [
        table(
          ["Regra", "O que fazer"],
          [
            [
              "Follow-up atrasado",
              "Quem faz o follow-up atrasado de outro colega fica com o lead. Filtre as tarefas atrasadas em Proposta enviada, faça o contato e reagende.",
            ],
            [
              "Dois responsáveis",
              "Responsável e quem fez o follow-up têm até 24 horas cada um. O contato precisa fazer sentido na conversa, não só segurar a vez.",
            ],
            ["Agências", "Todas as agências são da Nathalia. Transfira na hora."],
            [
              "Conferência",
              "Depois do sinal, confira os dados no CRM e no HQ com os documentos e envie o template Contrato COM.",
            ],
            [
              "Tempo de resposta",
              "Pode atender fora do expediente se não atrasar o cliente. Passou de 30 minutos sem resposta, quem está no turno assume.",
            ],
          ],
        ),
        h("Reserva de última hora"),
        list([
          "Mesmo dia ou dia seguinte: acione o Aleiko na hora.",
          "Até 3 dias antes da chegada: alinhe com o líder, o diretor comercial ou o diretor de logística.",
          "Confira chegada e devolução com cuidado e garanta que o CS sabe da entrega.",
        ]),
        h("Lead em mais de um canal"),
        list([
          "Segue com quem recebeu o lead no primeiro canal.",
          "Cliente recorrente: atende quem está na vez da distribuição.",
          "Disparo comercial: o responsável (ou quem está seguindo o lead) continua, se estiver online.",
        ]),
      ],
    },
    // Pagamentos
    {
      id: "pagamento-condicoes",
      title: "Condições de pagamento",
      summary:
        "O que confirma a reserva, formas de pagamento e o texto pronto em português e espanhol.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 100", label: "sinal para confirmar" },
            { value: "3x", label: "sem juros no link em reais" },
            { value: "5", label: "formas de pagamento" },
          ],
        },
        h("Para confirmar a reserva"),
        list([
          "Passagem aérea",
          "CNH válida",
          "Endereços",
          "E-mail",
          "Sinal de US$ 100 (o restante é pago na retirada)",
        ]),
        h("Formas de pagamento"),
        table(
          ["Forma", "Moeda"],
          [
            ["Cartão", "Reais ou dólar"],
            ["PIX", "Reais"],
            ["Zelle", "Dólar (transferência americana)"],
            ["Dinheiro", "Dólar em espécie (ver regras do pagamento em dinheiro)"],
            ["Wise", "Transferência"],
          ],
        ),
        note(
          "Parcelamento no cartão brasileiro sem IOF: o valor é convertido em reais com juros e taxa de conversão. Até 3x sem juros pelo link do Global Pays.",
        ),
        ...textoCliente(CLI.pagamentoPT, CLI.pagamentoES),
      ],
    },
    {
      id: "pagamento-em-reais-global-pays",
      title: "Pagamento em reais (Global Pays)",
      summary: "Gerar o link em reais, conferir o pagamento e lançar no HQ.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "3x", label: "sem juros" },
            { value: "4x a 12x", label: "com juros" },
            { value: "0", label: "IOF" },
          ],
        },
        list([
          "A cotação do dólar não é congelada: vale a do momento do pagamento.",
          "Não tem IOF, só taxa de conversão.",
          "Até 3x sem juros; de 4x a 12x com juros.",
          "Pode pagar com cartão de outra pessoa, desde que os dados no link sejam do titular real do cartão ou da conta.",
        ]),
        h("1. Gerar o link"),
        steps([
          { title: "Entrar no Global Pays", text: "POS ou Painel." },
          {
            title: "Preencher",
            list: [
              "Valor em dólar (ex.: 100.00)",
              "Invoice: número da reserva (ex.: 7261)",
              "Descrição: Sinal reserva",
            ],
          },
          {
            title: "Escolher Link de pagamento",
            text: "Nunca PIX ou Cartão direto. Clique em Gerar link e envie ao cliente.",
          },
        ]),
        h("2. Conferir"),
        p("Na aba Vendas, confira nome, invoice, data, valor e status Aprovado."),
        warn("Status Em análise: fale com o suporte do Global Pays na hora."),
        h("3. Lançar no HQ"),
        steps([
          { title: "Abrir a reserva > Pagamentos > Adicionar pagamento offline" },
          {
            title: "Preencher",
            text: "Método Global Pays, valor exato pago em dólar (o HQ sugere o total da reserva: troque) e status Approved. Salve.",
          },
        ]),
        note("Até lançar o pagamento offline, a reserva paga em reais fica como pendente no HQ."),
      ],
    },
    {
      id: "pagamento-link-parcelado",
      title: "Link parcelado sem juros",
      summary: "Link do Global Pays em que a loja assume a taxa do parcelamento.",
      blocks: [
        p(
          "Use quando o parcelamento sem juros foi negociado com o cliente. A taxa fica com a ORC.",
        ),
        steps([
          {
            title: "Conferir a conta",
            text: "No canto superior direito, veja se está na conta certa.",
          },
          {
            title: "Novo link",
            text: "Menu Gerar venda > Link de pagamento > Novo link de pagamento.",
          },
          {
            title: "Taxa por conta da loja",
            text: "Ative Personalizar quem paga a taxa e, em Cartão parcelado, deixe Loja assume a taxa.",
          },
          {
            title: "Parcelas",
            text: "Ative Personalizar parcelas sem juros e escolha a quantidade negociada.",
          },
          { title: "Dados", text: "Moeda, valor, invoice (número da reserva) e descrição." },
          { title: "Gerar link", text: "Botão verde no rodapé. Envie ao cliente." },
        ]),
      ],
    },
    // Retirada
    {
      id: "retirada-regras-gerais",
      title: "Retirada e entrega: regras gerais",
      summary: "Taxas por local, exceções fora do horário e como registrar no HQ.",
      blocks: [
        { t: "widget", name: "calc", area: "" },
        h("Taxas por local"),
        TAXAS_ENTREGA,
        warn("Toda taxa incluída na proposta tem 6,5% de imposto."),
        h("Orlando"),
        list([
          "Fora do horário da logística, o carro fica no estacionamento (saída de até US$ 25, por conta do cliente).",
          "Entrega em mãos no Lounge: US$ 40, para voos que pousam até 20h.",
          "Na devolução, mesmo quem não pagou os US$ 40, tentamos receber no Lounge e levar ao aeroporto, dentro do horário da logística.",
        ]),
        h("Exceções fora do horário: registrar no HQ"),
        table(
          ["Situação", "Anotar no HQ"],
          [
            ["Cliente recebe direto no desembarque", "Entregar no desembarque"],
            [
              "Cliente recebe no Lounge fora do horário",
              "Pegar na van fora do horário e entregar no Lounge",
            ],
          ],
        ),
      ],
    },
    {
      id: "retirada-orlando",
      title: "Retirada em Orlando (MCO)",
      summary: "Estacionamento ou Lounge, valores e texto para o cliente.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 25", label: "estacionamento de saída (máx.)" },
            { value: "US$ 40", label: "entrega no Lounge" },
            { value: "21h", label: "Lounge até" },
          ],
        },
        list([
          "Carro disponível no estacionamento do aeroporto; a logística chama o cliente perto da chegada.",
          "Estacionamento de saída: até US$ 25, por conta do cliente.",
          "Entrega em mãos no Lounge: US$ 40.",
        ]),
        ...textoCliente(CLI.mcoPT, CLI.mcoES),
      ],
    },
    {
      id: "retirada-miami-fll",
      title: "Retirada em Miami e Fort Lauderdale",
      summary: "Em mãos quando possível; senão, estacionamento por conta do cliente.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 36", label: "estacionamento (máx.)" },
            { value: "US$ 60", label: "taxa FLL por trecho" },
            { value: "Sem taxa", label: "Miami" },
          ],
        },
        list([
          "Tentamos entregar em mãos na área de desembarque.",
          "Se não der, o carro fica no estacionamento (até US$ 36) e mandamos fotos e vídeos.",
          "Fort Lauderdale tem taxa de US$ 60 por trecho; Miami não tem.",
        ]),
        ...textoCliente(CLI.miaPT, CLI.miaES),
      ],
    },
    {
      id: "retirada-tampa-sanford",
      title: "Retirada em Tampa e Sanford",
      summary: "US$ 120 por trecho, porque a base é em Orlando.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 120", label: "Tampa por trecho" },
            { value: "US$ 120", label: "Sanford por trecho" },
          ],
        },
        table(
          ["Aeroporto", "Taxa por trecho"],
          [
            ["Tampa (TPA)", "US$ 120"],
            ["Sanford (SFB)", "US$ 120"],
          ],
        ),
        p(
          "Entrega em mãos ou no estacionamento, com instruções da logística. O estacionamento de saída é por conta do cliente.",
        ),
        ...textoCliente(CLI.outrosPT, CLI.outrosES),
      ],
    },
    {
      id: "retirada-hoteis-casas",
      title: "Entrega em hotéis, casas e portos",
      summary: "Valores para entregar fora do aeroporto.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 80", label: "hotel em Orlando" },
            { value: "US$ 120", label: "casa de férias e portos" },
          ],
        },
        table(
          ["Local", "Taxa por trecho"],
          [
            ["Hotel em Orlando", "US$ 80"],
            ["Casa de férias em Orlando", "US$ 120"],
            ["Porto Canaveral", "US$ 120"],
            ["Hotel ou porto em Miami", "US$ 120"],
            ["Hotel ou porto em Fort Lauderdale", "US$ 120"],
          ],
        ),
        p("O horário é combinado antes com o cliente; a logística cuida dos detalhes."),
      ],
    },
    // Seguros e Regras
    {
      id: "seguro-e-franquia",
      title: "Seguro e franquia",
      summary: "Coberturas, franquia por categoria, roubo e o que fazer em acidente.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 1.000", label: "franquia Sedan a Minivan" },
            { value: "US$ 3.000", label: "Executive, Van e Luxury" },
            { value: "US$ 1 mi", label: "cobertura a terceiros" },
            { value: "Só FL", label: "onde o seguro vale" },
          ],
        },
        ...seguroBlocks(),
        ...textoCliente(CLI.seguroPT, CLI.seguroES),
      ],
    },
    {
      id: "cancelamento-e-alteracoes",
      title: "Cancelamento e alterações",
      summary: "Reembolso com 60 dias, crédito com menos e a regra dos 7 dias para alterar.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "60 dias+", label: "reembolso total" },
            { value: "< 60 dias", label: "vira crédito" },
            { value: "7 dias", label: "valor vira mínimo" },
          ],
        },
        table(
          ["Quando cancela", "O que acontece"],
          [
            ["60 dias ou mais antes da viagem", "Reembolso total"],
            ["Menos de 60 dias", "Sem reembolso; o valor vira crédito para a próxima viagem"],
          ],
        ),
        warn(
          "A partir de 7 dias antes da retirada, o valor da locação naquele momento passa a ser o mínimo: qualquer alteração só pode aumentar o total.",
        ),
        ...textoCliente(CLI.cancelPT, CLI.cancelES),
      ],
    },
    {
      id: "politica-de-combustivel",
      title: "Política de combustível",
      summary: "Tanque cheio na entrega e na devolução; taxa por categoria.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "1,5x", label: "até o valor do posto" },
            { value: "US$ 50", label: "Sedan" },
            { value: "US$ 98", label: "SUV Executive" },
          ],
        },
        ...combustivel(),
      ],
    },
    // Dicas e Benefícios
    {
      id: "beneficios-inclusos",
      title: "Benefícios inclusos",
      summary: "Condutor adicional e cadeirinhas sem custo, com o texto para o cliente.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 0", label: "condutor adicional" },
            { value: "US$ 0", label: "cadeirinhas e booster" },
          ],
        },
        table(
          ["Benefício", "Regra"],
          [
            ["Condutor adicional", "Sem custo. Idade mínima de 21 anos."],
            [
              "Cadeirinhas",
              "Sem custo, quantas forem necessárias: bebê conforto, cadeirinha e booster.",
            ],
          ],
        ),
        note(
          "Lei da Flórida: cadeirinha até 4 anos e booster de 5 a 7 anos. Confira no HQ se os itens já foram incluídos na reserva.",
        ),
        ...textoCliente(CLI.beneficiosPT, CLI.beneficiosES),
      ],
    },
    {
      id: "dicas-de-viagem",
      title: "Dicas de viagem",
      summary: "Quilometragem, documentos, tanque e pedágios, com o texto para o cliente.",
      blocks: [
        table(
          ["Assunto", "O que dizer"],
          [
            ["Quilometragem", "Livre, sem limite, desde que não saia da Flórida."],
            ["Documentos", "Documento do carro e cartão do seguro ficam no porta-luvas."],
            ["Combustível", "Entregue cheio, devolve cheio."],
            [
              "Pedágios",
              "TAG SunPass no carro. Cobramos só os pedágios usados, no fim da reserva, sem taxa da TAG.",
            ],
            ["Categoria", "O aluguel é por categoria, não por modelo."],
          ],
        ),
        ...textoCliente(CLI.dicasPT, CLI.dicasES),
      ],
    },
    {
      id: "como-abastecer",
      title: "Como abastecer nos EUA",
      summary: "Passo a passo do autoatendimento na bomba.",
      blocks: [
        video("Aprenda como abastecer", "1s0vBds_lclSIoeEFgzAzjVMI2I7ioKqT"),
        ...abastecer(),
      ],
    },
  ],
};

// ───────────── CS ─────────────

const TPL_CS: [string, string[]][] = [
  [
    "Onboarding",
    [
      "Onboar.PT L",
      "Onboar.ES L",
      "Onboar.PT V",
      "Onboar.ES V",
      "Onboar.Rec.PT L",
      "Onboar.Rec.PT V",
      "Onboar.Rec.ES L",
      "Onboar.Rec.ES V",
      "Assinatura contrato",
      "Ass vídeo",
    ],
  ],
  [
    "Conferência e orientações",
    [
      "Previa da viagem",
      "Previa da viagem ES",
      "Previa da Viagem EN",
      "Previa 2",
      "Previa 2 ES",
      "Previa 2 EN",
      "Adicionais - cs",
      "Ag. Conferência B1",
      "Ag. Conferência B2",
      "Conferência 1",
      "Conferência 2",
    ],
  ],
  [
    "Orientações de retirada",
    [
      "Ori.estacionamento -Mia/MCO",
      "Ori.ES Estacionamento Mia/MCO",
      "Ori.EN -Estacionamento Mia/MCO",
      "Ori.MCO Loun",
      "Ori.MCO LOUN ESP",
      "Ori.MCO LOUN EN",
      "Ori.Mia/FLL",
      "Ori.Mia/Fll ES",
      "Ori.Mia/FLL EN",
      "Ori.Porto",
      "Ori.Porto ES",
      "Ori.Porto EN",
      "Rec.Orientações",
      "Rec.Retirada",
      "Sunpass",
      "1 dia antes contato",
      "Documento do carro",
      "Num.Confirmação",
    ],
  ],
  [
    "Boa viagem",
    [
      "BV Mauro",
      "Boa viagem CS",
      "Boa viagem ES",
      "Boa viagem EN",
      "PagoBv PT",
      "PagoBv ESP",
      "PagoBv EN",
    ],
  ],
  [
    "Pagamentos",
    [
      "Pagamento confirmação- cs",
      "Pagamento retirada -CS",
      "PG confirmação -CS",
      "Modelo 2 – Pg confirmação",
      "Pg cartão-instrução",
      "Titular PG",
      "Link pagamento",
      "CobrançaPgt PT",
      "CobrançaPgt ESP",
      "CobrançaPgt ENG",
    ],
  ],
  [
    "Chegada (boas-vindas)",
    [
      "Boas vindas cs- utility",
      "Chegada cont. CS",
      "Boas vindas ES utility",
      "Chegada cont. es – Utility",
      "Boas vindas – EN utility",
      "Chegada Cont.EN-cs",
    ],
  ],
  [
    "48 horas antes da devolução",
    [
      "48h antes -CS",
      "48h antes cont. – cs",
      "48h antes ES- utility",
      "48h antes cont. ES utility",
      "48h antes EN Utility",
      "48h antes cont. EN utility",
    ],
  ],
  [
    "Pedágios",
    [
      "Recibo Pedagios CS",
      "Recibo pedagios ESP",
      "recibo pedagios ENG",
      "Recibo Pedagios 2",
      "PedagioEmDelayComCartão",
      "PedagioEmDelaySemCartão",
    ],
  ],
  [
    "Avaliação e pós-venda",
    [
      "Avaliação",
      "Avaliação cont. -cs",
      "Nps 5",
      "Nps4321",
      "cs credito avaliaçao",
      "indicação cashback cs",
      "Agradecimento - cs",
      "Cupom Orc - cs",
    ],
  ],
  [
    "Extras",
    [
      "Contato CS",
      "Contato cs - ES",
      "Contato En CS",
      "Solicitação de contato -CS",
      "Multa utility",
      "Documento comercial -utility",
      "TransferPessoas",
      "Lizie CS",
    ],
  ],
  [
    "Aprovados na Meta (pt, en e es)",
    [
      "cs_inicio",
      "cs_boasvindas",
      "cs_boaviagem",
      "cs_contato",
      "cs_conferência",
      "cs_conferencia 2",
      "48h_cs",
      "cs_48h_temp",
      "cs_recibo_pedagios",
      "cs_multa",
      "cs_modelo2_pg",
      "cs_pg_retirada",
      "cs_cobranca_pg",
    ],
  ],
];

// Passos das etapas do acompanhamento: usados na rotina do dia e nas páginas de cada etapa.
const ETAPA = {
  onboarding: {
    title: "Onboarding",
    text: "Continue do número em que o time parou.",
    sub: [
      {
        title: "Conferir a reserva",
        text: "Data de chegada e número da reserva corretos no CRM; dados do cliente preenchidos.",
      },
      {
        title: "Conferir a CNH",
        text: "Vencida ou vencendo antes da chegada? Anote na nota fixa da conversa.",
      },
      {
        title: "Ler a observação do HQ",
        text: "Informação importante (ex.: retirada em mãos) vai para a nota fixa da conversa.",
      },
      {
        title: "SUV Executive",
        text: "Pergunte quantas pessoas vão viajar e anote na observação da reserva no HQ.",
      },
      { title: "Datas, horários e locais", text: "Confira retirada e devolução." },
      {
        title: "Assinatura do contrato",
        text: "Veja na aba Retirada do HQ. Se não assinou:",
        tpl: ["Assinatura contrato", "Ass vídeo"],
      },
      {
        title: "Cliente sem número da reserva",
        text: "Fechou pelo site, por agência ou com Aleiko/Luiz: envie o documento informativo.",
        tpl: ["Documento comercial -utility"],
      },
      {
        title: "Mudar o status para Boas-vindas e enviar o onboarding",
        text: "Cliente novo ou recorrente:",
        tpl: ["Onboar.PT L", "Onboar.Rec.PT L"],
      },
      {
        title: "Se o template der erro",
        text: "Envie o de contato e reenvie o onboarding quando o cliente responder.",
        tpl: ["Contato CS"],
      },
    ],
  },
  conferencia: {
    title: "Conferência e orientações (7 a 10 dias antes)",
    sub: [
      { title: "Mudar o status para Prévia da viagem" },
      {
        title: "Enviar a prévia",
        text: "Na língua do cliente. Agende tarefa para chamar de novo 3 dias antes da viagem.",
        tpl: ["Previa da viagem", "Previa da viagem ES"],
      },
      { title: "Sem resposta no dia seguinte", tpl: ["Previa 2"] },
      {
        title: "Conferir voo e aeroportos",
        text: "Datas, horários e aeroportos de chegada e volta.",
      },
      {
        title: "Adicionais",
        text: "Veja no HQ cadeirinha, booster e motorista adicional e ajuste o template.",
        tpl: ["Adicionais - cs"],
      },
      {
        title: "Orientações (assim que o cliente responder)",
        text: "Mande todas de uma vez: retirada (conforme o local), documento do carro, SunPass, 1 dia antes e número de confirmação. Van 12 lugares: sempre o template de estacionamento, exceto em horário comercial em Orlando. Antes, veja na nota fixa se a entrega é em mãos.",
        tpl: [
          "Ori.estacionamento -Mia/MCO",
          "Ori.MCO Loun",
          "Sunpass",
          "Documento do carro",
          "1 dia antes contato",
          "Num.Confirmação",
        ],
      },
      {
        title: "Pagamento",
        text: "Se não pagou, pergunte a forma e anote na tarefa de Boa viagem.",
        tpl: ["Pagamento confirmação- cs"],
      },
    ],
  },
  boaViagem: {
    title: "Boa viagem (1 dia antes da chegada)",
    text: "Filtre no HQ quem chega amanhã (hoje 15/01 → filtre 16/01). Pode chamar mesmo que a tarefa esteja em outra data.",
    sub: [
      {
        title: "Conferir antes de enviar",
        text: "As orientações da conferência foram enviadas? Há saldo pendente no HQ? Qual forma de pagamento ficou combinada?",
      },
      { title: "Cliente que já pagou", tpl: ["BV Mauro"] },
      {
        title: "Não pagou e não disse a forma",
        text: "Boa viagem e, quando responder, o template de pagamento na retirada.",
        tpl: ["Boa viagem CS", "Pagamento retirada -CS"],
      },
      {
        title: "Não pagou e já disse a forma",
        text: "Boa viagem e, quando responder, o template de link com o link logo abaixo.",
        tpl: ["Boa viagem CS", "Link pagamento"],
      },
      {
        title: "Revisar o envio",
        text: "Só o primeiro nome do cliente; mensagem no canal oficial e sem erro.",
      },
      {
        title: "Sobras no calendário",
        text: "Terminou o filtro do HQ e ainda há tarefas de Boa viagem? Confira se a data de chegada bate.",
      },
      { title: "Concluir a tarefa" },
    ],
  },
  boasVindas: {
    title: "Boas-vindas (1 dia depois da chegada)",
    sub: [
      { title: "Ver o histórico", text: "Valores pendentes ou combinados antes." },
      { title: "Mudar o status para Reserva em andamento" },
      {
        title: "Enviar as boas-vindas",
        text: "Ajuste ao local de retirada (aeroporto, hotel ou outro).",
        tpl: ["Boas vindas cs- utility", "Chegada cont. CS"],
      },
      { title: "Recebeu o link e não pagou", tpl: ["Modelo 2 – Pg confirmação"] },
      { title: "Não pagou e não disse a forma", tpl: ["Pagamento retirada -CS"] },
      {
        title: "Pagamento pendente",
        text: 'Cobre e agende tarefa para o dia seguinte até pagar ("pagamento Lizie"). Se já há pedágios no saldo, cobre só a locação.',
      },
    ],
  },
  h48: {
    title: "48 horas antes da devolução",
    text: "Filtre no HQ quem devolve daqui a 2 dias (hoje 15/01 → 17/01).",
    sub: [
      { title: "Enviar os dois templates", tpl: ["48h antes -CS", "48h antes cont. – cs"] },
      {
        title: "Confirmar que o cliente sabe como devolver",
        text: "Reforce horário, local e tanque cheio.",
      },
      {
        title: "Sobras no calendário",
        text: "Terminou o filtro e ainda há tarefas de 48h? Pode enviar.",
      },
    ],
  },
  pedagio: {
    title: "Pedágios (3 dias depois da devolução)",
    text: "Filtre no HQ quem devolveu há 3 dias (hoje 15/01 → 12/01).",
    sub: [
      {
        title: "Avaliação",
        text: "Se o robô não pediu avaliação, envie.",
        tpl: ["Avaliação", "Avaliação cont. -cs"],
      },
      {
        title: "Conferir o saldo",
        text: "Pedágios, gasolina, limpeza, multa. Veja na observação do HQ e na nota fixa se algo não deve ser cobrado (ex.: estacionamento a abater).",
      },
      {
        title: "Cobrar",
        text: "Só pedágio: passe o cartão cadastrado no HQ. Com gasolina: envie link de pagamento.",
      },
      {
        title: "Enviar o recibo",
        text: "Cobrança automática: Recibo. Cobrança manual com link: Recibo 2 (edite se houver outras cobranças).",
        tpl: ["Recibo Pedagios CS", "Recibo Pedagios 2", "Pg cartão-instrução"],
      },
      {
        title: "Fechar",
        text: "Cartão passou: conclua. Link: reagende a tarefa até o cliente pagar e depois agradeça.",
        tpl: ["Agradecimento - cs"],
      },
    ],
  },
} satisfies Record<string, Step>;

const CS: Curadoria = {
  hide: [
    "condicoes-de-pagamento-es",
    "cancelamento-e-alteracoes",
    "condicoes-de-seguro",
    "regras-de-seguro-e-franquia",
    "regras-de-pedagios",
    "entrega-e-devolucao-no-mco-es",
    "retiradas-em-orlando",
    "retirada-em-miami-e-fll-es",
    "taxas-de-deslocamento-es",
    "taxas-de-retirada-e-locais",
    "retiradas-fll-e-miami",
    "entrega-em-hoteis-e-portos-es",
    "taxas-de-entrega",
    "dicas-de-viagem-pt-2",
    "templates-cs-orlando",
    "templates-de-atendimento-2",
  ],
  pages: [
    // Sistemas e Rotinas
    {
      id: "rotina-de-dias-uteis",
      title: "Rotina de dias úteis",
      summary:
        "A ordem do dia de segunda a sexta, com o passo a passo e os templates de cada etapa.",
      blocks: [
        {
          t: "flow",
          items: [
            { title: "Inbox", when: "primeiro" },
            { title: "Boa viagem", when: "chega amanhã" },
            { title: "Conferência", when: "7 a 10 dias antes" },
            { title: "Pedágios", when: "devolveu há 3 dias" },
            { title: "48h", when: "devolve em 2 dias" },
            { title: "Onboarding", when: "reservas novas" },
          ],
        },
        p(
          "Siga nesta ordem. Cada etapa tem o seu passo a passo numerado; clique no nome do template para ver o texto.",
        ),
        steps([
          { title: "Inbox", text: "Comece respondendo quem está esperando retorno." },
          ETAPA.boaViagem,
          ETAPA.conferencia,
          ETAPA.pedagio,
          ETAPA.h48,
          ETAPA.onboarding,
        ]),
        h("Links de pagamento"),
        list([
          "Link em dólar: mande junto o passo a passo (Pg cartão-instrução).",
          "Link em reais: mande o Titular PG.",
        ]),
      ],
    },
    {
      id: "rotina-de-sabado",
      title: "Rotina de sábado",
      summary: "No sábado: inbox e boas-vindas de quem chegou ontem.",
      blocks: [
        {
          t: "flow",
          items: [
            { title: "Inbox", when: "primeiro" },
            { title: "Boas-vindas", when: "chegou ontem" },
          ],
        },
        steps([
          { title: "Inbox", text: "Responda quem está esperando retorno." },
          { ...ETAPA.boasVindas, text: "Filtre no HQ quem chegou ontem." },
        ]),
      ],
    },
    {
      id: "controle-de-reservas",
      title: "Controle de reservas",
      summary:
        "Painel que mostra as reservas que saíram de pendente para aberta depois do pagamento.",
      blocks: [
        video("Controle de reservas", "1oFedkt4KiVJHVbh2bBdfJsETiCvuWMxv"),
        p(
          "O painel acompanha sozinho as reservas que mudaram de status depois do pagamento (pendente → aberta).",
        ),
        steps([
          { title: "Abrir Controle de Reservas" },
          { title: "Escolher o período", text: "Datas no topo da tela." },
          {
            title: "Ler os números",
            text: "Cards com a quantidade e a soma em dólar das reservas convertidas.",
          },
          { title: "Ver por dia", text: "Passe o mouse nas barras do gráfico." },
          { title: "Consultar a tabela", text: "Use a busca e os filtros." },
        ]),
        warn(
          "O histórico começa no dia em que o controle foi ligado. A data é a da sincronização com o HQ. Se a reserva pular mais de um status entre duas sincronizações, aparece só como pendente → confirmada.",
        ),
      ],
    },
    // Frota: igual ao Comercial (ver FROTA)
    // Reservas e Cancelamentos
    {
      id: "condicoes-de-reserva",
      title: "Condições de reserva",
      summary: "O que é preciso para confirmar a reserva e as diárias mínimas.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 100", label: "sinal" },
            { value: "5", label: "diárias mínimas" },
            { value: "21 anos", label: "idade mínima" },
          ],
        },
        list(
          ["Passagem aérea", "CNH válida", "Endereços", "E-mail", "Sinal de US$ 100"],
          "Para confirmar a reserva",
        ),
        list(
          [
            "Mínimo de 5 diárias consecutivas (pode haver exceção para cliente com 2 reservas).",
            "Idade mínima de 21 anos para motorista principal e adicional.",
          ],
          "Outras regras",
        ),
        note(
          "Troca de reserva: no ClickMassa, coloque os dois números no contato e indique na observação qual é a atual e qual é a troca.",
        ),
      ],
    },
    {
      id: "politica-de-cancelamento-es",
      title: "Política de cancelamento",
      summary:
        "Reembolso com 60 dias, crédito com menos, regra dos 7 dias e texto em português e espanhol.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "60 dias+", label: "reembolso total" },
            { value: "< 60 dias", label: "vira crédito" },
            { value: "7 dias", label: "valor vira mínimo" },
          ],
        },
        table(
          ["Quando cancela", "O que acontece"],
          [
            ["60 dias ou mais antes da retirada", "Reembolso total"],
            ["Menos de 60 dias", "Sem reembolso; o valor vira crédito para a próxima viagem"],
          ],
        ),
        warn(
          "Contrato: a partir de 7 dias antes da retirada, o valor da locação naquele momento passa a ser o mínimo; qualquer alteração só pode aumentar o total.",
        ),
        note('Para o passo a passo do atendimento, veja "Cancelamento de reserva".'),
        ...textoCliente(CLI.cancelPT, CLI.cancelES),
      ],
    },
    {
      id: "cancelamento-de-reserva",
      title: "Cancelamento de reserva",
      summary: "Como atender o pedido de cancelamento, oferecendo o crédito primeiro.",
      blocks: [
        steps([
          { title: "Perguntar o motivo", text: "Sempre." },
          {
            title: "Ver o prazo",
            text: "Faltam 60 dias ou mais para a retirada? Então tem direito ao reembolso.",
          },
          {
            title: "Oferecer as duas opções",
            text: "Com prioridade para o crédito, que congela o preço em dólar.",
          },
          { title: "Seguir com a escolha", text: 'Reembolso: veja "Procedimento de reembolso".' },
        ]),
        msg(
          "Mensagem para o cliente",
          "(Nome do cliente), você tem direito ao reembolso total do valor pago, conforme nossa política, ou ao crédito para a próxima viagem (recomendado): nós garantimos o valor da diária que você já pagou. É a melhor forma de congelar o preço atual das diárias (em dólar) e garantir que sua próxima locação não saia mais cara.\n\nQual dessas opções fica melhor para você?",
        ),
      ],
    },
    {
      id: "alteracao-de-data-de-retirada",
      title: "Alteração de data de retirada",
      summary: "Cliente que adia a retirada não ganha desconto: o carro ficou reservado para ele.",
      blocks: [
        {
          t: "cards",
          items: [
            {
              icon: "pin",
              title: "A regra",
              text: "Faltando menos de 60 dias, mantemos a tarifa contratada e não tiramos diária.",
            },
            {
              icon: "lock",
              title: "Por quê",
              text: "O carro ficou bloqueado só para esse cliente desde a data original.",
            },
          ],
        },
        h("Como atender"),
        steps([
          {
            title: "Ver a antecedência",
            text: "Faltam 60 dias ou mais? A reserva pode ser refeita. Menos de 60 dias? Siga a regra abaixo.",
          },
          {
            title: "Cliente vai retirar depois",
            text: "Ex.: ia retirar dia 01 e vai retirar dia 02. A diária do dia 01 continua cobrada.",
          },
          {
            title: "Cliente quer dias a mais",
            text: "A diária extra sai pelo valor que ele já contratou, não pela tarifa de hoje.",
          },
          { title: "Explicar ao cliente", text: "Use a mensagem abaixo." },
          {
            title: "Atualizar no HQ",
            text: "Ajuste as datas da reserva e registre a alteração na observação.",
          },
        ]),
        msg(
          "Mensagem para o cliente",
          "Nesse caso, não conseguimos reduzir uma diária da reserva, pois o veículo ficou bloqueado e reservado exclusivamente para a sua locação desde a data de retirada contratada.",
        ),
        note(
          'Para mudar a quantidade de diárias (reduzir ou recalcular), veja "Alteração na diária".',
        ),
      ],
    },
    {
      id: "alteracao-na-diaria",
      title: "Alteração na diária",
      summary: "Com 10 dias ou mais dá para recalcular; com 9 ou menos o contrato está travado.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "10 dias+", label: "pode recalcular" },
            { value: "9 dias ou menos", label: "contrato travado" },
          ],
        },
        table(
          ["Antecedência da retirada", "Pode recalcular?", "Quanto o cliente paga"],
          [
            [
              "10 dias ou mais",
              "Sim",
              "Nova cotação pela tarifa atual. Se diminuir diárias, recebe o desconto proporcional.",
            ],
            ["9 dias ou menos", "Não: contrato travado", "Valor integral da reserva original."],
          ],
        ),
        warn(
          "Com 9 dias ou menos, o cliente pode retirar mais tarde ou devolver antes, mas sem reembolso, estorno ou desconto pelas diárias não usadas.",
        ),
      ],
    },
    // Pagamentos e Taxas
    {
      id: "formas-de-pagamento",
      title: "Condições e formas de pagamento",
      summary: "Sinal de US$ 100, formas aceitas e o texto em português e espanhol.",
      blocks: [
        p("Para confirmar: sinal de US$ 100. O restante é pago até a retirada."),
        {
          t: "cards",
          items: [
            {
              icon: "card",
              title: "Cartão",
              text: "Reais ou dólar. Link em dólar sem taxa; link em reais pelo Global Pays (até 3x sem juros).",
            },
            { icon: "zap", title: "PIX", text: "Em reais." },
            { icon: "bank", title: "Zelle e Wise", text: "Transferência em dólar." },
            {
              icon: "cash",
              title: "Dinheiro",
              text: 'Dólar em espécie, só em alguns locais (veja "Pagamento em dinheiro").',
            },
          ],
        },
        list(
          [
            "Link em dólar: mande junto o Pg cartão-instrução.",
            "Link em reais (Global Pays): mande o Titular PG.",
          ],
          "Ao enviar um link",
        ),
        ...textoCliente(CLI.pagamentoPT, CLI.pagamentoES),
      ],
    },
    {
      id: "taxas-de-combustivel",
      title: "Taxa de combustível",
      summary: "Tanque cheio na entrega e na devolução; taxa por categoria.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "1,5x", label: "até o valor do posto" },
            { value: "US$ 50", label: "Sedan" },
            { value: "US$ 98", label: "SUV Executive" },
          ],
        },
        ...combustivel(),
      ],
    },
    {
      id: "pagamento-em-cash",
      title: "Pagamento em dinheiro",
      summary: "Onde aceitamos dinheiro e o que responder em cada caso.",
      blocks: [
        {
          t: "cards",
          items: [
            {
              icon: "check",
              title: "Aceita na retirada",
              text: "Entrega em mãos (desembarque ou van), hotel ou casa de férias, em Orlando e outras cidades.",
            },
            {
              icon: "x",
              title: "Não aceita",
              text: "Estacionamento no MCO, Miami/FLL ou outro local fora de Orlando sem entrega em mãos.",
            },
          ],
        },
        h("Como atender"),
        steps([
          {
            title: "Ver onde o cliente retira",
            text: "Na reserva do HQ e na nota fixa da conversa.",
          },
          {
            title: "Se aceita",
            text: "Confirme e peça o valor trocado e organizado.",
          },
          {
            title: "Se não aceita",
            text: "Ofereça o link em dólar, sem taxa, para cartão internacional. Mande o Pg cartão-instrução junto.",
            tpl: ["Pg cartão-instrução"],
          },
          {
            title: "Se o cliente insistir no dinheiro",
            text: "Ele leva o dinheiro ao Lounge em Orlando até o dia seguinte à retirada e avisa a logística.",
          },
        ]),
        h("Mensagens prontas"),
        msg(
          "Quando aceita",
          "O pagamento pode ser feito no momento da retirada do veículo. Só pedimos, por gentileza, que o valor seja entregue trocado e organizado.",
        ),
        msg(
          "Quando não aceita",
          "Infelizmente, não conseguimos receber o pagamento em dinheiro nesse caso. Podemos enviar o link de pagamento em dólar, que não tem taxa, e você pode usar um cartão internacional (como Wise, Nomad, Inter etc.). Pode ser?",
        ),
        msg(
          "Se o cliente insistir",
          "Verifiquei internamente e o pagamento poderá ser feito em dinheiro (em dólar), mas será preciso ir ao nosso lounge em Orlando até o dia seguinte à retirada para levar o valor. Pedimos que seja entregue trocado e organizado. Quando a logística entrar em contato sobre a retirada, avise que vai pagar em dinheiro para combinarem a entrega.",
        ),
      ],
    },
    {
      id: "procedimento-de-reembolso",
      title: "Procedimento de reembolso",
      summary: "Quem faz o reembolso e que dados pedir, conforme a forma de pagamento.",
      blocks: [
        table(
          ["Como o cliente pagou", "Reembolso", "O que fazer"],
          [
            [
              "Global Pays",
              "Total",
              "Peça ao Global Pays: nome completo de quem pagou, data e número da reserva.",
            ],
            [
              "Global Pays",
              "Parcial",
              "Peça os dados bancários abaixo e mande no grupo para o Luiz.",
            ],
            [
              "Link do HD",
              "Total ou parcial",
              "Peça no grupo para o Luiz ou a Thay. Não precisa de dados bancários.",
            ],
          ],
        ),
        list(
          [
            "Nome completo do titular da conta",
            "Nome do banco",
            "Endereço do banco",
            "Número da conta (Account Number)",
            "Routing Number (ABA), obrigatório para ACH",
            "SWIFT/BIC, se tiver (principalmente para Wire)",
          ],
          "Dados para transferência ACH/Wire em dólar",
        ),
        note(
          "Diga ao cliente que o app do banco costuma ter a opção de compartilhar esses dados de uma vez.",
        ),
      ],
    },
    // Retirada e Locais
    {
      id: "retirada-em-orlando",
      title: "Retirada e entrega por local",
      summary:
        "Orlando, Miami, Fort Lauderdale, Tampa, Sanford, hotéis e portos: como entregamos, taxa e template.",
      keywords:
        "retirada entrega mco miami fll tampa sanford hotel porto lounge estacionamento taxa",
      blocks: [
        { t: "widget", name: "calc", area: "" },
        h("Resumo por local"),
        table(
          ["Local", "Como entregamos", "Taxa por trecho", "Template"],
          [
            ["Orlando (MCO), 7h às 18h30", "Em mãos no Lounge", "US$ 40 (Lounge)", "Ori.MCO Loun"],
            [
              "Orlando (MCO), depois das 18h30",
              "Estacionamento (saída até US$ 25)",
              "Sem taxa",
              "Ori.estacionamento -Mia/MCO",
            ],
            [
              "Miami (MIA)",
              "Em mãos se possível; senão estacionamento (até US$ 36)",
              "Sem taxa",
              "Ori.Mia/FLL",
            ],
            [
              "Fort Lauderdale (FLL)",
              "Em mãos se possível; senão estacionamento (até US$ 36)",
              "US$ 60",
              "Ori.Mia/FLL",
            ],
            ["Miami/FLL de madrugada", "Estacionamento", "—", "Ori.estacionamento -Mia/MCO"],
            ["Tampa (TPA) e Sanford (SFB)", "Em mãos ou estacionamento", "US$ 120", "—"],
            ["Hotel em Orlando", "Em mãos no endereço", "US$ 80", "—"],
            ["Casa de férias em Orlando", "Em mãos no endereço", "US$ 120", "—"],
            ["Porto (Canaveral, Miami, FLL)", "Em mãos; horário comercial", "US$ 120", "Ori.Porto"],
            ["Hotel em Miami ou FLL", "Em mãos no endereço", "US$ 120", "—"],
          ],
        ),
        note(
          "Outras taxas: transfer de malas/pessoas em Orlando US$ 100 por trecho; one way US$ 99. Toda taxa na proposta tem 6,5% de imposto.",
        ),
        warn(
          "Van 12 lugares fica sempre no estacionamento, exceto em horário comercial em Orlando. Antes de mandar a orientação, veja na nota fixa se a entrega foi combinada em mãos.",
        ),
        h("Exceções: anotar no HQ"),
        {
          t: "cards",
          items: [
            {
              icon: "plane",
              title: "Cliente recebe no desembarque",
              text: 'Anotar no HQ: "Entregar no desembarque".',
            },
            {
              icon: "moon",
              title: "Lounge fora do horário",
              text: 'Anotar no HQ: "Pegar na van fora do horário e entregar no Lounge".',
            },
            {
              icon: "undo",
              title: "Devolução em Orlando",
              text: "Mesmo sem os US$ 40, tentamos receber no Lounge e levar ao aeroporto, dentro do horário da logística.",
            },
          ],
        },
        h("Texto para o cliente: Orlando"),
        msg("Português", CLI.mcoPT),
        msg("Español", CLI.mcoES),
        h("Texto para o cliente: Miami e Fort Lauderdale"),
        msg("Português", CLI.miaPT),
        msg("Español", CLI.miaES),
        h("Texto para o cliente: Tampa, Sanford, hotéis e portos"),
        msg("Português", CLI.outrosPT),
        msg("Español", CLI.outrosES),
      ],
    },
    // Seguros e Regras
    {
      id: "politica-de-seguro-es",
      title: "Seguro e franquia",
      summary:
        "Coberturas, franquia por categoria, roubo e acidente, com texto em português e espanhol.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "US$ 1.000", label: "franquia Sedan a Minivan" },
            { value: "US$ 3.000", label: "Executive, Van e Luxury" },
            { value: "US$ 1 mi", label: "cobertura a terceiros" },
            { value: "Só FL", label: "onde o seguro vale" },
          ],
        },
        ...seguroBlocks(),
        ...textoCliente(CLI.seguroPT, CLI.seguroES),
      ],
    },
    {
      id: "cobranca-de-pedagio",
      title: "Pedágios: regra e cobrança",
      summary: "Cobramos só os pedágios usados; como cobrar e qual recibo enviar.",
      blocks: [
        p(
          "O carro tem TAG do SunPass. Não cobramos a TAG nem nada antecipado: só os pedágios usados, no fim da locação.",
        ),
        steps([
          {
            title: "Ver o que está no saldo",
            text: "Só pedágio ou também gasolina, limpeza, multa?",
          },
          {
            title: "Tentar a cobrança automática",
            text: "No HQ, se houver cartão cadastrado (não passe se tiver gasolina: mande link).",
          },
          {
            title: "Abrir a janela",
            text: "Envie o recibo de pedágios para o cliente.",
            tpl: ["Recibo Pedagios CS"],
          },
          {
            title: "Enviar o recibo certo",
            text: "Automática: Recibo com o arquivo do HQ. Manual: Recibo 2 com o arquivo e o link.",
            tpl: ["Recibo Pedagios CS", "Recibo Pedagios 2"],
          },
        ]),
      ],
    },
    {
      id: "idade-minima-para-dirigir",
      title: "Idade mínima para dirigir",
      summary: "21 anos para motorista principal e adicional.",
      blocks: [
        {
          t: "keys",
          items: [
            { value: "21 anos", label: "motorista principal" },
            { value: "21 anos", label: "motorista adicional" },
          ],
        },
        table(
          ["Motorista", "Idade mínima"],
          [
            ["Principal", "21 anos"],
            ["Adicional", "21 anos"],
          ],
        ),
      ],
    },
    // Dicas e Viagem
    {
      id: "dicas-de-viagem-e-condicao-es",
      title: "Dicas de viagem e benefícios",
      summary:
        "Quilometragem, documentos, tanque, pedágios e benefícios, com o texto para o cliente.",
      blocks: [
        table(
          ["Assunto", "Regra"],
          [
            ["Quilometragem", "Livre, sem limite, desde que não saia da Flórida."],
            ["Documentos", "Documento do carro e cartão do seguro no porta-luvas."],
            ["Combustível", "Entregue cheio, devolve cheio."],
            ["Pedágios", "TAG SunPass; cobramos só os pedágios usados, no fim."],
            ["Devolução", "Na data e hora reservadas; estender depende de disponibilidade."],
          ],
        ),
        h("Benefícios inclusos"),
        table(
          ["Benefício", "Regra"],
          [
            ["Condutor adicional", "Sem custo (21 anos ou mais)."],
            [
              "Cadeirinhas",
              "Sem custo, quantas forem necessárias: bebê conforto, cadeirinha e booster.",
            ],
          ],
        ),
        h("Texto para o cliente: dicas"),
        msg("Português", CLI.dicasPT),
        msg("Español", CLI.dicasES),
        h("Texto para o cliente: benefícios"),
        msg("Português", CLI.beneficiosPT),
        msg("Español", CLI.beneficiosES),
      ],
    },
    {
      id: "como-abastecer-nos-eua-2",
      title: "Como abastecer nos EUA",
      summary: "Passo a passo do autoatendimento na bomba.",
      blocks: [
        video("Aprenda como abastecer", "1q_UHKO9gJ_g4hRFUOe0aoCgMgWRuDKAX"),
        ...abastecer(),
      ],
    },
    {
      id: "link-parcelado-sem-juros",
      title: "Link parcelado sem juros",
      summary: "Link do Global Pays em que a loja assume a taxa do parcelamento.",
      blocks: [
        video("Link sem juros em reais", "1y1bfrt0RRGcjKL3D3ZcUibI16jrNolez"),
        p(
          "Use quando o Comercial negociou parcelamento sem juros. Confirme com o vendedor quantas parcelas foram combinadas.",
        ),
        steps([
          {
            title: "Conferir a conta",
            text: "No canto superior direito, veja se está na conta certa.",
          },
          {
            title: "Novo link",
            text: "Menu Gerar venda > Link de pagamento > Novo link de pagamento.",
          },
          {
            title: "Taxa por conta da loja",
            text: "Ative Personalizar quem paga a taxa e, em Cartão parcelado, deixe Loja assume a taxa.",
          },
          {
            title: "Parcelas",
            text: "Ative Personalizar parcelas sem juros e escolha a quantidade combinada.",
          },
          { title: "Dados", text: "Moeda, valor, invoice (número da reserva) e descrição." },
          {
            title: "Gerar link",
            text: "Botão verde no rodapé. Envie ao cliente com o Titular PG.",
          },
        ]),
      ],
    },
    // Atendimento ao Cliente: na ordem da jornada
    {
      id: "processo-de-onboarding",
      title: "1. Onboarding",
      summary: "Conferir a reserva, o contrato e criar as tarefas da jornada.",
      blocks: [
        {
          t: "flow",
          items: [
            { title: "Onboarding", when: "reserva nova" },
            { title: "Conferência", when: "7 a 10 dias antes" },
            { title: "Boa viagem", when: "1 dia antes" },
            { title: "Boas-vindas", when: "1 dia depois da chegada" },
            { title: "48h", when: "2 dias antes da devolução" },
            { title: "Pedágios", when: "3 dias depois da devolução" },
          ],
        },
        steps([
          ETAPA.onboarding,
          {
            title: "Criar as tarefas da jornada",
            sub: [
              { title: "Confirmar dados", text: "7 a 10 dias antes da chegada" },
              { title: "Boa viagem", text: "1 dia antes da chegada" },
              { title: "Boas-vindas", text: "1 dia depois da chegada" },
              { title: "48 horas", text: "2 dias antes da devolução" },
              { title: "Pedágio", text: "3 dias depois da devolução" },
            ],
          },
        ]),
      ],
    },
    {
      id: "conferencia-e-orientacoes",
      title: "2. Conferência e orientações",
      summary: "Primeiro contato: prévia da viagem, adicionais e orientações de retirada.",
      blocks: [steps(ETAPA.conferencia.sub)],
    },
    {
      id: "boa-viagem",
      title: "3. Boa viagem",
      summary: "Um dia antes da chegada: mensagem de boa viagem e pagamento.",
      blocks: [p(ETAPA.boaViagem.text), steps(ETAPA.boaViagem.sub)],
    },
    {
      id: "boas-vindas-cs",
      title: "4. Boas-vindas",
      summary: "Um dia depois da chegada: boas-vindas e cobrança do saldo.",
      blocks: [steps(ETAPA.boasVindas.sub)],
    },
    {
      id: "processo-48-horas",
      title: "5. 48 horas antes da devolução",
      summary: "Lembrar como funciona a devolução.",
      blocks: [p(ETAPA.h48.text), steps(ETAPA.h48.sub)],
    },
    {
      id: "pedagios-pos-devolucao",
      cat: "cs-atendimento-ao-cliente",
      title: "6. Pedágios e avaliação",
      summary: "Três dias depois da devolução: avaliação, saldo e recibo.",
      blocks: [p(ETAPA.pedagio.text), steps(ETAPA.pedagio.sub)],
    },
    {
      id: "mensagem-automatica-de-pos-venda",
      title: "Mensagem automática (tarefa com WhatsApp)",
      summary: "Agendar mensagem pelo CRM: avaliação, 48 horas e outras etapas fixas.",
      blocks: [
        video("Mensagem automática no CRM", "1DYfINb8tJ9Uq6bJBGRnpAdQt4RCRPqLM"),
        p(
          "Serve para etapas com mensagem que não precisa de edição, como a avaliação no dia seguinte à devolução e o 48 horas.",
        ),
        steps([
          { title: "Abrir a oportunidade", text: "No ClickMassa, aba Tarefas > Nova." },
          { title: "Nome, data e hora", text: "Ex.: Avaliação, no dia seguinte à devolução." },
          {
            title: "Acoplar a mensagem",
            text: "No fim da tela, ative Mensagem de WhatsApp acoplada.",
          },
          {
            title: "Conexão e template",
            text: "A mesma conexão que o cliente usa e o template da etapa. Salve.",
          },
        ]),
      ],
    },
    {
      id: "templates-de-atendimento",
      title: "Templates do CS",
      summary: "Todos os templates do CS por etapa da jornada.",
      blocks: [
        p(
          'Clique no nome para ver o texto e copiar. Os que estão em cinza ainda não têm o texto cadastrado no documento "Templates de mensagem" do Drive. Quase todos existem em PT, ES e EN.',
        ),
        ...TPL_CS.map(([t, items]) => tags(t, items)),
      ],
    },
  ],
};

/** Texto em português seguido do espanhol vira um bloco só, com abas (menos rolagem). */
function withLangTabs(c: Curadoria): Curadoria {
  const fold = (blocks: Block[]): Block[] => {
    const out: Block[] = [];
    for (const b of blocks) {
      const prev = out[out.length - 1];
      if (
        b.t === "quote" &&
        b["title"] === "Español" &&
        prev?.t === "quote" &&
        prev["title"] === "Português"
      )
        out[out.length - 1] = {
          t: "langs",
          items: [
            { label: "Português", text: prev["text"] },
            { label: "Español", text: b["text"] },
          ],
        };
      else out.push(b);
    }
    return out;
  };
  return { ...c, pages: c.pages.map((p) => ({ ...p, blocks: fold(p.blocks) })) };
}

export const CURADORIA: Record<string, Curadoria> = {
  comercial: withLangTabs({
    hide: COMERCIAL.hide,
    pages: [
      faqPage("comercial-dicas-e-beneficios", "faq-cliente-comercial"),
      visaoFrota("comercial"),
      ...FROTA.map((f) => f("comercial")),
      ...COMERCIAL.pages,
      quizPage("comercial", "comercial-reservas-e-vendas"),
    ],
  }),
  cs: withLangTabs({
    hide: CS.hide,
    pages: [
      faqPage("cs-dicas-e-viagem", "faq-cliente-cs"),
      ...CS.pages.slice(0, 3),
      visaoFrota("cs"),
      ...FROTA.map((f) => f("cs")),
      ...CS.pages.slice(3),
      quizPage("cs", "cs-sistemas-e-rotinas"),
    ],
  }),
};
