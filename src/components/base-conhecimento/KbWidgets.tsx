// Ferramentas interativas da Base de Conhecimento: seletor de carro e calculadora de taxas.
// Usam só os valores que já estão na base (Base operacional e manuais internos).
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Car, Luggage, Minus, Plus, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CopyButton } from "./KbBlocks";
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
};
export const FLEET: Fleet[] = [
  {
    key: "sedan",
    name: "Sedan",
    models: "Toyota Corolla",
    es: "Sedan",
    cap: [[5, 2, 2]],
    franquia: 1000,
    tanque: 50,
  },
  {
    key: "suv-media",
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
                <span className="min-w-0">
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

export function Quiz({ items, area }: { items: QuizQ[]; area: string }) {
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
  if (done)
    return (
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
        <button
          type="button"
          onClick={() => {
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
                  <span className="tabular-nums text-muted-foreground">
                    {r.best}/{r.total}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
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
const TOUR = [
  {
    title: "Busque e receba a resposta",
    text: 'Digite na busca (ou aperte ⌘K) algo como "franquia van" ou "taxa tampa": o valor aparece no topo, antes da lista de páginas.',
  },
  {
    title: "Comece pela trilha",
    text: "Na página inicial, a Trilha de onboarding mostra o que ler em ordem e termina num teste rápido. Cada página lida ganha um ✓.",
  },
  {
    title: "Execute com o modo guiado",
    text: 'Nas páginas de processo, as seções vêm recolhidas: abra só o que precisa. Em qualquer lista de passos, o botão "Modo guiado" mostra um passo por vez.',
  },
];

export function WelcomeTour() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    try {
      if (!localStorage.getItem("kb-tour-done")) setStep(0);
    } catch {
      /* sem armazenamento: não mostra */
    }
  }, []);
  const close = () => {
    setStep(null);
    try {
      localStorage.setItem("kb-tour-done", "1");
    } catch {
      /* ignora */
    }
  };
  if (step === null) return null;
  const s = TOUR[step]!;
  const last = step === TOUR.length - 1;
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <div className="space-y-4">
          <img src="/logo-orc.png" alt="" className="size-12 rounded-xl" />
          <div className="flex gap-1" aria-hidden>
            {TOUR.map((_, j) => (
              <span
                key={j}
                className={`h-1.5 flex-1 rounded-full ${j <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <DialogTitle className="text-xl">{s.title}</DialogTitle>
          <DialogDescription className="text-[15px] leading-7 text-foreground/85">
            {s.text}
          </DialogDescription>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              Pular
            </button>
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {last ? "Começar" : "Próximo"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
