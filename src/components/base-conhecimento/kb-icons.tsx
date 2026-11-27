// Um só conjunto de ícones (Lucide, o mesmo do resto do painel) para a Base de Conhecimento:
// categorias, cartões e títulos de seção.
import {
  AlertTriangle,
  Baby,
  Banknote,
  CalendarDays,
  Car,
  Check,
  ClipboardList,
  Compass,
  CreditCard,
  Database,
  DollarSign,
  FileText,
  Fuel,
  Handshake,
  Headset,
  Landmark,
  ListChecks,
  Lock,
  Luggage,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Moon,
  Palmtree,
  PlaneLanding,
  PlayCircle,
  Pin,
  Route,
  ShieldCheck,
  Tags,
  Undo2,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const CAT: [RegExp, LucideIcon][] = [
  [/sistema|rotina/, Compass],
  [/^hq$/, Database],
  [/^crm$/, MessagesSquare],
  [/frota/, Car],
  [/reserva/, ClipboardList],
  [/pagamento/, CreditCard],
  [/retirada|logistica|locais/, MapPin],
  [/seguro/, ShieldCheck],
  [/dica|beneficio/, Palmtree],
  [/atendimento/, Handshake],
];

/** Ícone da categoria pelo assunto do nome. */
export function catIcon(title: string, className = "size-4") {
  const I = CAT.find(([re]) => re.test(norm(title)))?.[1] ?? FileText;
  return <I className={className} aria-hidden />;
}

// Ícones dos cartões (bloco "cards"): o nome vem do conteúdo revisado.
const NAMED: Record<string, LucideIcon> = {
  route: Route,
  users: Users,
  baby: Baby,
  fuel: Fuel,
  calendar: CalendarDays,
  car: Car,
  pin: Pin,
  lock: Lock,
  check: Check,
  x: X,
  card: CreditCard,
  zap: Zap,
  bank: Landmark,
  cash: Banknote,
  plane: PlaneLanding,
  moon: Moon,
  undo: Undo2,
};

export function namedIcon(name: string | undefined, className = "size-5") {
  const I = name ? NAMED[name] : undefined;
  return I ? <I className={className} aria-hidden /> : null;
}

// Títulos de seção: um ícone pelo assunto, para a página ter âncoras visuais e não só texto.
const SECTION: [RegExp, LucideIcon][] = [
  [/texto para o cliente|mensage/, MessageSquare],
  [/video|foto/, PlayCircle],
  [/pessoas e malas|malas/, Luggage],
  [/valor|taxa|preco|franquia/, DollarSign],
  [/regra|condic|confirmar/, ListChecks],
  [/excec|atencao|acidente|roubo/, AlertTriangle],
  [/como atender|atendimento|assumir/, Headset],
  [/template/, Tags],
  [/categoria|frota/, Car],
  [/pagamento|forma/, CreditCard],
  [/local|retirada|orlando|miami/, MapPin],
  [/seguro/, ShieldCheck],
  [/espanhol|nome/, Tags],
];

export function sectionIcon(text: string, className = "size-5") {
  const I = SECTION.find(([re]) => re.test(norm(text)))?.[1] ?? ListChecks;
  return <I className={className} aria-hidden />;
}
