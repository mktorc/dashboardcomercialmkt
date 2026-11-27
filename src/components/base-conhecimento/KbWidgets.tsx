// Ferramentas interativas da Base de Conhecimento: seletor de carro e calculadora de taxas.
// Usam só os valores que já estão na base (Base operacional e manuais internos).
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Car, GraduationCap, Luggage, Minus, Plus, Search, Sparkles, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyButton } from "./KbBlocks";
import { Certificado } from "./KbCertificado";
import { kbApi, useKbEngajamento, type KbArea } from "./kb-api";

// ───────────── Frota ─────────────
type Fleet = {
  key: string;
  name: string;
  models: string;
  es: string;
  /** [pessoas, malas grandes, malas pequenas] */
  cap: [number, number, number][];
  franquia: number;
  tanque: number | null;
  thumb?: string;
};
export const FLEET: Fleet[] = [
  {
    key: "sedan",
    thumb: "1sFkWgPAGmIENFGnC6il_BcOWQMHR3OVl",
    name: "Sedan",
    models: "Toyota Corolla",
    es: "Sedan",
    cap: [[5, 2, 2]],
    franquia: 1000,
    tanque: 50,
  },
  {
    key: "suv-media",
    thumb: "1CHg6uZ1e6rS3x80dUM32tJCZf2Wxl9F-",
    name: "SUV Média",
    models: "Sportage, Tucson, RAV4",
    es: "SUV Mediana",
    cap: [
      [2, 7, 3],
      [3, 6, 2],
      [4, 4, 2],
      [5, 3, 2],
    ],
    franquia: 1000,
    tanque: 60,
  },
  {
    key: "suv-grande",
    thumb: "1fnf73GrEGz0jVBhSu54rm0Jl1DUxbYyA",
    name: "SUV Grande (Full Size)",
    models: "Sorento, Highlander, Palisade",
    es: "SUV Grande",
    cap: [
      [5, 4, 2],
      [6, 4, 2],
      [7, 1, 2],
    ],
    franquia: 1000,
    tanque: 65,
  },
  {
    key: "minivan",
    thumb: "1BP9lT8Q-5BYBxfAS-kQFyYSbM4Bslo-R",
    name: "Minivan",
    models: "Kia Carnival",
    es: "Minivan",
    cap: [
      [5, 9, 3],
      [6, 7, 3],
      [7, 6, 3],
      [8, 4, 2],
    ],
    franquia: 1000,
    tanque: null,
  },
  {
    key: "suv-executive",
    thumb: "1oxSBiD46H4F3un_1lJuLZ_SWiKUExF_O",
    name: "SUV Executive",
    models: "Suburban, Yukon XL",
    es: "SUV Executive",
    cap: [
      [5, 11, 5],
      [6, 9, 4],
      [7, 8, 4],
      [8, 6, 2],
    ],
    franquia: 3000,
    tanque: 98,
  },
  {
    key: "van",
    name: "Van 12 lugares",
    models: "Ford Transit",
    es: "Furgoneta de 12 plazas",
    cap: [[12, 7, 5]],
    franquia: 3000,
    tanque: 95,
  },
  {
    key: "luxury",
    thumb: "1LZ8JUnjKBPMZAidnhRpX2KDlOk7y1iXx",
    name: "Luxury",
    models: "Cadillac Escalade ESV",
    es: "Luxury",
    cap: [
      [5, 11, 5],
      [6, 9, 4],
      [7, 8, 4],
    ],
    franquia: 3000,
    tanque: null,
  },
];

/** Linha de capacidade para p pessoas (menos gente que o mínimo da tabela usa a 1ª linha). */
function rowFor(f: Fleet, p: number) {
  return f.cap.find((r) => r[0] >= p) ?? null;
}
/** Cabe? Mala grande que sobra pode virar espaço de mala pequena. */
function fits(f: Fleet, p: number, big: number, small: number) {
  const r = rowFor(f, p);
  if (!r) return false;
  return big <= r[1] && small <= r[2] + (r[1] - big);
}

function Stepper({
  label,
  icon,
  value,
  set,
  min,
  max,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  set: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Menos ${label.toLowerCase()}`}
          onClick={() => set(Math.max(min, value - 1))}
          disabled={value <= min}
          className="flex size-9 items-center justify-center rounded-lg bg-background text-foreground transition hover:bg-primary/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Minus className="size-4" />
        </button>
        <span
          className="w-8 text-center text-lg font-semibold tabular-nums text-foreground"
          aria-live="polite"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Mais ${label.toLowerCase()}`}
          onClick={() => set(Math.min(max, value + 1))}
          disabled={value >= max}
          className="flex size-9 items-center justify-center rounded-lg bg-background text-foreground transition hover:bg-primary/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" />
        </button>
      </span>
    </div>
  );
}

export function FleetPicker({ area }: { area: string }) {
  const [p, setP] = useState(4);
  const [big, setBig] = useState(4);
  const [small, setSmall] = useState(2);
  const ok = FLEET.filter((f) => fits(f, p, big, small));
  return (
    <div className="space-y-4 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20 sm:p-5">
      <div className="flex items-center gap-2">
        <Car className="size-5 text-primary" aria-hidden />
        <p className="font-semibold text-foreground">Qual carro serve para o cliente?</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stepper
          label="Pessoas"
          icon={<Users className="size-4" />}
          value={p}
          set={setP}
          min={1}
          max={12}
        />
        <Stepper
          label="Malas grandes"
          icon={<Luggage className="size-4" />}
          value={big}
          set={setBig}
          min={0}
          max={12}
        />
        <Stepper
          label="Malas pequenas"
          icon={<Luggage className="size-3.5" />}
          value={small}
          set={setSmall}
          min={0}
          max={8}
        />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {FLEET.map((f) => {
          const good = ok.includes(f);
          const r = rowFor(f, p);
          return (
            <li key={f.key}>
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area, artigo: `frota-${f.key}-${area}` }}
                className={`flex items-center justify-between gap-3 rounded-xl p-3 transition ${
                  good
                    ? "bg-primary/15 ring-1 ring-primary/40 hover:bg-primary/25"
                    : "bg-muted/20 opacity-50 hover:opacity-80"
                }`}
              >
                {f.thumb && (
                  <DriveThumb id={f.thumb} alt={f.models} className="h-12 w-16 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f.models}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {good ? (
                    <span className="font-medium text-primary">Serve</span>
                  ) : r ? (
                    `Com ${r[0]}: ${r[1]} grandes / ${r[2]} pequenas`
                  ) : (
                    `Até ${f.cap[f.cap.length - 1]![0]} pessoas`
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {!ok.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma categoria leva tudo isso. Considere dois carros ou reduzir malas.
        </p>
      )}
    </div>
  );
}

// ───────────── Calculadora de taxas ─────────────
const LOCAIS: { name: string; fee: number }[] = [
  { name: "Aeroporto de Orlando (MCO), estacionamento", fee: 0 },
  { name: "Lounge ORC, em mãos (Orlando)", fee: 40 },
  { name: "Aeroporto de Miami (MIA)", fee: 0 },
  { name: "Trem Brightline (Miami ou Orlando)", fee: 0 },
  { name: "Aeroporto de Fort Lauderdale (FLL)", fee: 60 },
  { name: "Hotel em Orlando", fee: 80 },
  { name: "Casa de férias em Orlando", fee: 120 },
  { name: "Porto Canaveral", fee: 120 },
  { name: "Aeroporto de Tampa (TPA)", fee: 120 },
  { name: "Aeroporto de Sanford (SFB)", fee: 120 },
  { name: "Hotel ou porto em Miami", fee: 120 },
  { name: "Hotel ou porto em Fort Lauderdale", fee: 120 },
];
const usd = (n: number) =>
  `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function QuoteCalc() {
  const [ret, setRet] = useState(0);
  const [dev, setDev] = useState(0);
  const [oneWay, setOneWay] = useState(false);
  const [transfer, setTransfer] = useState(0);
  const [cat, setCat] = useState("suv-media");
  const f = FLEET.find((x) => x.key === cat)!;
  const r = LOCAIS[ret]!;
  const d = LOCAIS[dev]!;
  const fees = r.fee + d.fee + (oneWay ? 99 : 0) + transfer * 100;
  const tax = Math.round(fees * 0.065 * 100) / 100;
  const total = fees + tax;
  const texto = useMemo(() => {
    const ls = [
      `Retirada: ${r.name}${r.fee ? ` (${usd(r.fee)})` : " (sem taxa)"}`,
      `Devolução: ${d.name}${d.fee ? ` (${usd(d.fee)})` : " (sem taxa)"}`,
      ...(oneWay ? ["One way: US$ 99"] : []),
      ...(transfer ? [`Transfer: ${transfer} trecho(s) x US$ 100`] : []),
      `Taxas: ${usd(fees)} + imposto de 6,5% (${usd(tax)}) = ${usd(total)}`,
      `Categoria ${f.name}: franquia de ${usd(f.franquia)}.`,
    ];
    return ls.join("\n");
  }, [r, d, oneWay, transfer, fees, tax, total, f]);
  const sel =
    "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
  return (
    <div className="space-y-4 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20 sm:p-5">
      <p className="font-semibold text-foreground">Calcular taxas de entrega</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Retirada</span>
          <select className={sel} value={ret} onChange={(e) => setRet(+e.target.value)}>
            {LOCAIS.map((l, i) => (
              <option key={l.name} value={i}>
                {l.name} {l.fee ? `· ${usd(l.fee)}` : "· sem taxa"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Devolução</span>
          <select className={sel} value={dev} onChange={(e) => setDev(+e.target.value)}>
            {LOCAIS.map((l, i) => (
              <option key={l.name} value={i}>
                {l.name} {l.fee ? `· ${usd(l.fee)}` : "· sem taxa"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Categoria</span>
          <select className={sel} value={cat} onChange={(e) => setCat(e.target.value)}>
            {FLEET.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Transfer de malas/pessoas em Orlando</span>
          <select className={sel} value={transfer} onChange={(e) => setTransfer(+e.target.value)}>
            <option value={0}>Nenhum</option>
            <option value={1}>1 trecho · US$ 100</option>
            <option value={2}>2 trechos · US$ 200</option>
          </select>
        </label>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={oneWay}
          onChange={(e) => setOneWay(e.target.checked)}
          className="size-4 accent-[hsl(var(--primary))]"
        />
        Devolve em outra cidade (one way, US$ 99)
      </label>
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ["Taxas", usd(fees)],
          ["Imposto 6,5%", usd(tax)],
          ["Total das taxas", usd(total)],
          ["Franquia", usd(f.franquia)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className={`rounded-xl p-3 ${i === 2 ? "bg-primary text-primary-foreground" : "bg-muted/30"}`}
          >
            <span
              className={`block text-xs ${i === 2 ? "text-primary-foreground/80" : "text-muted-foreground"}`}
            >
              {k}
            </span>
            <span className="block text-xl font-bold tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Valores da base. Taxa de combustível ({f.name}):{" "}
          {f.tanque ? usd(f.tanque) : "não informada no manual"}. Confira no HQ antes de enviar.
        </p>
        <CopyButton text={texto} label="Copiar resumo" />
      </div>
    </div>
  );
}

// ───────────── Quiz de treino ─────────────
export type QuizQ = { q: string; options: string[]; correct: number; why: string; page: string };

/** Sorteia até n perguntas, embaralhando também as alternativas. */
function draw(all: QuizQ[], n = 8): QuizQ[] {
  const pick = [...all].sort(() => Math.random() - 0.5).slice(0, n);
  return pick.map((q) => {
    const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
    return { ...q, options: order.map((i) => q.options[i]!), correct: order.indexOf(q.correct) };
  });
}

export function Quiz({ items: bank, area }: { items: QuizQ[]; area: string }) {
  const [items, setItems] = useState<QuizQ[]>(() => bank.slice(0, 8));
  useEffect(() => setItems(draw(bank)), [bank]);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const done = i >= items.length;
  const qc = useQueryClient();
  const rank = useKbEngajamento(area as KbArea);
  useEffect(() => {
    if (!done) return;
    void kbApi("feedback", {
      method: "POST",
      body: { area, articleId: `quiz-${area}`, action: "quiz", score, total: items.length },
    })
      .then(() => qc.invalidateQueries({ queryKey: ["kb-engajamento", area] }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const passou = done && score >= items.length * 0.75;
  if (done)
    return (
      <div className="space-y-6">
        {passou && <Certificado area={area as KbArea} />}
        <div className="space-y-4 rounded-2xl bg-primary/10 p-6 text-center ring-1 ring-primary/30">
          <p className="text-5xl font-bold tabular-nums text-primary">
            {score}/{items.length}
          </p>
          <p className="text-lg font-semibold text-foreground">
            {score === items.length
              ? "Gabaritou! Você domina o assunto."
              : score >= items.length * 0.7
                ? "Muito bem! Revise só as que errou."
                : "Vale revisar as páginas da trilha e tentar de novo."}
          </p>
          <p className="text-sm text-muted-foreground">
            {passou
              ? "Seu certificado está aí em cima. Pode imprimir ou salvar em PDF."
              : "Acerte 75% ou mais para ganhar o certificado da trilha."}
          </p>
          <button
            type="button"
            onClick={() => {
              setItems(draw(bank));
              setI(0);
              setPick(null);
              setScore(0);
            }}
            className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Fazer de novo
          </button>
          {!!rank.data?.ranking.length && (
            <div className="mx-auto max-w-sm space-y-2 pt-2 text-left">
              <p className="text-center text-sm font-semibold text-foreground">
                Melhores notas da equipe
              </p>
              <ol className="space-y-1">
                {rank.data.ranking.slice(0, 5).map((r, j) => (
                  <li
                    key={j}
                    className="flex items-center gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        j === 0
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {j + 1}
                    </span>
                    <span className="flex-1 truncate text-foreground">{r.name}</span>
                    {r.best / r.total >= 0.75 && (
                      <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Onboarding concluído
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {r.best}/{r.total}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    );
  const it = items[i]!;
  const answered = pick !== null;
  return (
    <div className="space-y-4 rounded-2xl bg-muted/20 p-4 ring-1 ring-border/60 sm:p-6">
      <div className="flex gap-1" aria-hidden>
        {items.map((_, j) => (
          <span
            key={j}
            className={`h-1.5 flex-1 rounded-full ${j < i ? "bg-primary/60" : j === i ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Pergunta {i + 1} de {items.length} · {score} acerto{score === 1 ? "" : "s"}
      </p>
      <p className="text-xl font-semibold leading-snug text-foreground">{it.q}</p>
      <div className="grid gap-2">
        {it.options.map((o, j) => {
          const right = j === it.correct;
          const state = !answered
            ? "bg-muted/40 hover:bg-primary/15"
            : right
              ? "bg-primary/25 ring-2 ring-primary"
              : j === pick
                ? "bg-destructive/20 ring-2 ring-destructive/60"
                : "bg-muted/20 opacity-60";
          return (
            <button
              key={j}
              type="button"
              disabled={answered}
              onClick={() => {
                setPick(j);
                if (right) setScore((s) => s + 1);
              }}
              className={`min-h-12 rounded-xl px-4 py-3 text-left text-[15px] text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${state}`}
            >
              {o}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="space-y-3 rounded-xl bg-background/60 p-4" aria-live="polite">
          <p className="font-semibold text-foreground">
            {pick === it.correct ? "Isso mesmo!" : "Não é essa."}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{it.why}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area, artigo: it.page }}
              className="text-sm text-primary hover:underline"
            >
              Ver na base
            </Link>
            <button
              type="button"
              onClick={() => {
                setI(i + 1);
                setPick(null);
              }}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {i + 1 < items.length ? "Próxima pergunta" : "Ver resultado"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────── Passeio de boas-vindas (primeiro acesso) ─────────────
const DICAS = [
  {
    icon: GraduationCap,
    text: "Siga a trilha: ela mostra o que ler, em ordem, e termina num teste rápido.",
  },
  { icon: Search, text: 'Busque (ou aperte ⌘K): "franquia van" já mostra o valor no topo.' },
  { icon: Sparkles, text: "Não achou? Pergunte à ORCI, a ORC Intelligence." },
];

/** Boas-vindas no primeiro acesso: saúda pelo nome e leva direto para a trilha de onboarding. */
export function WelcomeTour({ area, firstId }: { area: KbArea; firstId?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      if (localStorage.getItem("kb-tour-done")) return;
    } catch {
      return; /* sem armazenamento: não mostra */
    }
    setOpen(true);
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
      const full = String(meta["full_name"] ?? meta["name"] ?? "").trim();
      setName((full || "").split(" ")[0] ?? "");
    });
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem("kb-tour-done", "1");
    } catch {
      /* ignora */
    }
  };
  if (!open) return null;
  const hora = new Date().getHours();
  const saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="kb-orc max-w-md overflow-hidden p-0">
        <div className="relative flex flex-col items-center gap-3 bg-[radial-gradient(circle_at_50%_0%,var(--color-primary)_0%,transparent_70%)] px-6 pb-4 pt-10 text-center">
          <img
            src="/logo-orc.png"
            alt=""
            className="size-16 rounded-2xl shadow-lg motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:spin-in-12 motion-safe:duration-700"
          />
          <DialogTitle className="text-2xl font-bold motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:delay-200 motion-safe:duration-500 motion-safe:fill-mode-both">
            {saud}
            {name ? `, ${name}` : ""}! Seja bem-vindo 👋
          </DialogTitle>
          <DialogDescription className="text-[15px] leading-6 text-foreground/85 motion-safe:animate-in motion-safe:fade-in motion-safe:delay-300 motion-safe:duration-500 motion-safe:fill-mode-both">
            Esta é a Base de Conhecimento da ORC. Para começar com o pé direito, comece pela trilha
            de onboarding.
          </DialogDescription>
        </div>
        <ul className="space-y-2 px-6">
          {DICAS.map((d, i) => (
            <li
              key={i}
              style={{ animationDelay: `${450 + i * 120}ms` }}
              className="flex items-center gap-3 rounded-xl bg-muted/30 p-3 text-sm text-foreground/90 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-500 motion-safe:fill-mode-both"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <d.icon className="size-4" />
              </span>
              {d.text}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 p-6 pt-5 sm:flex-row-reverse">
          {firstId ? (
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area, artigo: firstId }}
              onClick={close}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GraduationCap className="size-4" /> Começar a trilha
            </Link>
          ) : null}
          <button
            type="button"
            onClick={close}
            className="min-h-11 rounded-xl px-4 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Explorar sozinho
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Mapa das bases de retirada ─────────────
// Contorno simplificado da Flórida (lat, lon) e os pontos de entrega, com valores da base.
const FL: [number, number][] = [
  [31.0, -87.6],
  [31.0, -85.0],
  [30.7, -84.9],
  [30.6, -82.2],
  [30.7, -81.5],
  [29.9, -81.3],
  [28.8, -80.6],
  [27.5, -80.2],
  [26.5, -80.05],
  [25.8, -80.12],
  [25.2, -80.4],
  [25.1, -81.1],
  [25.9, -81.7],
  [26.7, -82.1],
  [27.6, -82.7],
  [28.2, -82.8],
  [29.1, -82.9],
  [29.9, -83.7],
  [30.1, -84.3],
  [29.7, -85.3],
  [30.2, -86.5],
  [30.4, -87.4],
];
const proj = (lat: number, lon: number): [number, number] => [
  ((lon + 87.8) / 7.9) * 300,
  ((31.2 - lat) / 6.4) * 330,
];
const BASES: {
  code: string;
  name: string;
  lat: number;
  lon: number;
  fee: string;
  como: string;
  tpl: string;
}[] = [
  {
    code: "MCO",
    name: "Aeroporto de Orlando",
    lat: 28.43,
    lon: -81.31,
    fee: "Sem taxa (Lounge: US$ 40)",
    como: "7h às 18h30 em mãos no Lounge; depois, estacionamento (saída até US$ 25).",
    tpl: "Ori.MCO Loun / Ori.estacionamento -Mia/MCO",
  },
  {
    code: "SFB",
    name: "Aeroporto de Sanford",
    lat: 28.78,
    lon: -81.24,
    fee: "US$ 120 por trecho",
    como: "Em mãos ou estacionamento, com instruções da logística.",
    tpl: "—",
  },
  {
    code: "PCV",
    name: "Porto Canaveral",
    lat: 28.41,
    lon: -80.6,
    fee: "US$ 120 por trecho",
    como: "Em mãos, em horário comercial.",
    tpl: "Ori.Porto",
  },
  {
    code: "TPA",
    name: "Aeroporto de Tampa",
    lat: 27.98,
    lon: -82.53,
    fee: "US$ 120 por trecho",
    como: "Em mãos ou estacionamento, com instruções da logística.",
    tpl: "—",
  },
  {
    code: "FLL",
    name: "Fort Lauderdale (aeroporto)",
    lat: 26.07,
    lon: -80.15,
    fee: "US$ 60 por trecho (hotel/porto: US$ 120)",
    como: "Em mãos se possível; senão estacionamento (até US$ 36).",
    tpl: "Ori.Mia/FLL",
  },
  {
    code: "MIA",
    name: "Aeroporto de Miami",
    lat: 25.79,
    lon: -80.29,
    fee: "Sem taxa (hotel/porto: US$ 120)",
    como: "Em mãos se possível; senão estacionamento (até US$ 36).",
    tpl: "Ori.Mia/FLL",
  },
];

export function MapaBases() {
  const [sel, setSel] = useState("MCO");
  const b = BASES.find((x) => x.code === sel)!;
  const path = FL.map(([la, lo], i) => `${i ? "L" : "M"}${proj(la, lo).join(",")}`).join(" ") + "Z";
  return (
    <div className="grid gap-4 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:p-5">
      <svg
        viewBox="0 0 300 330"
        role="img"
        aria-label="Mapa da Flórida com as bases"
        className="w-full max-w-sm"
      >
        <path d={path} className="fill-primary/10 stroke-primary/50" strokeWidth={1.5} />
        {BASES.map((x) => {
          const [cx, cy] = proj(x.lat, x.lon);
          const on = x.code === sel;
          return (
            <g key={x.code} onClick={() => setSel(x.code)} className="cursor-pointer">
              <circle
                cx={cx}
                cy={cy}
                r={on ? 9 : 6}
                className={on ? "fill-primary" : "fill-primary/60 hover:fill-primary"}
              />
              <text x={cx + 11} y={cy + 4} className="fill-foreground text-[11px] font-semibold">
                {x.code}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Escolher base">
          {BASES.map((x) => (
            <button
              key={x.code}
              type="button"
              aria-pressed={x.code === sel}
              onClick={() => setSel(x.code)}
              className={`min-h-9 rounded-full px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                x.code === sel
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-foreground/80 hover:bg-primary/15"
              }`}
            >
              {x.code}
            </button>
          ))}
        </div>
        <div className="space-y-2 rounded-xl bg-background/60 p-4" aria-live="polite">
          <p className="text-lg font-semibold text-foreground">{b.name}</p>
          <p className="text-2xl font-bold text-primary">{b.fee}</p>
          <p className="text-sm leading-relaxed text-foreground/90">{b.como}</p>
          <p className="text-xs text-muted-foreground">Template: {b.tpl}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Toda taxa na proposta tem 6,5% de imposto. Mapa ilustrativo.
        </p>
      </div>
    </div>
  );
}

// ───────────── Foto do carro (miniatura do Drive) ─────────────
/** Miniatura de um arquivo do Drive; some se o navegador não tiver acesso ao arquivo. */
export function DriveThumb({
  id,
  alt,
  className = "",
}: {
  id: string;
  alt: string;
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      src={`https://drive.google.com/thumbnail?id=${id}&sz=w800`}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
      className={`rounded-xl object-cover ${className}`}
    />
  );
}

// ───────────── CS: quem chega amanhã ─────────────
type Chegada = {
  reserva: string;
  hora: string;
  local: string;
  categoria: string;
  template: string;
};

export function ChegadasAmanha() {
  const q = useQuery({
    queryKey: ["kb-chegadas"],
    queryFn: () => kbApi<{ dia: string; rows: Chegada[] }>("chegadas"),
    staleTime: 5 * 60_000,
  });
  const dia = q.data?.dia ? q.data.dia.split("-").reverse().join("/") : "";
  return (
    <div className="space-y-3 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="font-semibold text-foreground">Chegam amanhã {dia && `(${dia})`}</p>
        {q.data && (
          <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold tabular-nums text-primary-foreground">
            {q.data.rows.length} reserva{q.data.rows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando as reservas…</p>}
      {q.isError && (
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar agora. Filtre no HQ.
        </p>
      )}
      {q.data && !q.data.rows.length && (
        <p className="text-sm text-muted-foreground">Nenhuma reserva chega amanhã.</p>
      )}
      {!!q.data?.rows.length && (
        <ul className="space-y-1.5">
          {q.data.rows.map((r) => (
            <li
              key={r.reserva}
              className="grid gap-1 rounded-xl bg-background/60 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
            >
              <span className="text-lg font-bold tabular-nums text-foreground">{r.hora}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  RA {r.reserva} · {r.categoria || "categoria não informada"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{r.local}</span>
              </span>
              <span className="justify-self-start rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary sm:justify-self-end">
                {r.template}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Do HQ, sincronizado no painel. O template é sugerido pelo local e horário; confira o
        pagamento e a nota fixa antes de enviar.
      </p>
    </div>
  );
}
