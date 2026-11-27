import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangle,
  Calculator,
  CarFront,
  MapPinned,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { slug, type Block, type Template } from "./kb-api";
import { templateKey, VARIABLE_RE } from "@/lib/kb/templates";
import { namedIcon } from "./kb-icons";
import { ChegadasAmanha, DriveThumb, FleetPicker, MapaBases, Quiz, QuoteCalc } from "./KbWidgets";

// Renderização do conteúdo dos artigos.

/** Destaca variáveis de template: [NOME], {data}, {{valor}}, (Nome do cliente). */
export function HighlightVars({ text }: { text: string }) {
  const re = new RegExp(`${VARIABLE_RE.source}|\\((?:Nome|nome)[^)]{0,30}\\)`, "g");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark
        key={m.index}
        className="rounded bg-primary/20 px-1 font-medium text-primary not-italic"
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          toast.error("Não foi possível copiar");
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-live="polite"
    >
      {done ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      {done ? "Copiado!" : label}
    </button>
  );
}

/** Mensagem pronta para enviar ao cliente: bloco com "Copiar" e variáveis destacadas. */
// ───── Nome do cliente: preenchido uma vez no topo da página, entra em todas as mensagens ─────
let clientName = "";
const nameSubs = new Set<() => void>();
export function setClientName(v: string) {
  clientName = v;
  nameSubs.forEach((f) => f());
}
export function useClientName() {
  return useSyncExternalStore(
    (f) => {
      nameSubs.add(f);
      return () => nameSubs.delete(f);
    },
    () => clientName,
    () => "",
  );
}
const NAME_RE = /\(nome do cliente\)|\[nome[^\]]*\]|\{\{?\s*nome\s*\}?\}/gi;
/** Põe o nome do cliente: troca o marcador ou abre com a saudação no idioma. */
export function personalize(text: string, name: string, lang: "pt" | "es" = "pt") {
  const n = name.trim();
  if (!n) return text;
  if (new RegExp(NAME_RE.source, "i").test(text))
    return text.replace(new RegExp(NAME_RE.source, "gi"), n);
  return `${lang === "es" ? "¡Hola" : "Olá"}, ${n}!\n\n${text}`;
}

/** Campo do topo da página: "Nome do cliente". */
export function ClientNameInput() {
  const name = useClientName();
  return (
    <label className="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 ring-1 ring-primary/25">
      <span className="text-sm font-medium text-foreground">Nome do cliente</span>
      <input
        value={name}
        onChange={(e) => setClientName(e.target.value.slice(0, 40))}
        placeholder="Ex.: Ana"
        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <span className="w-full text-xs text-muted-foreground">
        Entra em todas as mensagens prontas desta página antes de copiar.
      </span>
    </label>
  );
}

export function MessageBlock({ title, text: raw }: { title?: string | undefined; text: string }) {
  const name = useClientName();
  const text = personalize(raw, name, /español|espanhol|\bES\b/i.test(title ?? "") ? "es" : "pt");
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {title ?? "Mensagem"}
        </span>
        <CopyButton text={text} />
      </div>
      <p className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-foreground">
        <HighlightVars text={text} />
      </p>
    </div>
  );
}

/** Nome de template clicável: abre o texto com "Copiar", ou avisa que o texto ainda não foi cadastrado. */
export function TemplateChip({ name, tpl }: { name: string; tpl?: Template | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-left text-[13px] transition hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          tpl ? "bg-primary/15 text-foreground" : "bg-muted/50 text-foreground/75"
        }`}
      >
        <HighlightVars text={name} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogTitle className="pr-6 text-base">{name}</DialogTitle>
          <DialogDescription className="sr-only">Texto do template</DialogDescription>
          {tpl ? (
            <MessageBlock title={tpl.title} text={tpl.text} />
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              O texto deste template ainda não foi cadastrado na base. Ele aparece aqui, com o botão
              Copiar, quando existir no documento “Templates de mensagem” do Drive.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Mesmo texto em vários idiomas: abas e um botão Copiar para o idioma aberto. */
function LangTabs({ items }: { items: { label: string; text: string }[] }) {
  const [i, setI] = useState(0);
  const name = useClientName();
  const it = items[i]!;
  const cur = { ...it, text: personalize(it.text, name, /espa/i.test(it.label) ? "es" : "pt") };
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div role="tablist" aria-label="Idioma" className="flex gap-1">
          {items.map((l, j) => (
            <button
              key={l.label}
              type="button"
              role="tab"
              aria-selected={j === i}
              onClick={() => setI(j)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                j === i
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <CopyButton text={cur.text} label={`Copiar em ${cur.label.toLowerCase()}`} />
      </div>
      <p
        role="tabpanel"
        className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-foreground"
      >
        <HighlightVars text={cur.text} />
      </p>
    </div>
  );
}

function Callout({ kind, children }: { kind: "tip" | "warn"; children: ReactNode }) {
  const tip = kind === "tip";
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3.5 text-sm leading-relaxed ${
        tip ? "border-primary/30 bg-primary/10" : "border-amber-500/40 bg-amber-500/10"
      }`}
      role="note"
    >
      {tip ? (
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      )}
      <div className="text-foreground">
        <span className={`mr-1 font-semibold ${tip ? "text-primary" : "text-amber-400"}`}>
          {tip ? "Dica:" : "Atenção:"}
        </span>
        {children}
      </div>
    </div>
  );
}

const startsWithLabel = (t: string) => /^(aten[cç][aã]o|importante|dica)\s*[:\-–]/i.exec(t);

/** Nomes de template clicáveis (abre o texto com "Copiar" quando ele está cadastrado). */
function Templates({ names, templates }: { names: string[]; templates: Map<string, Template> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Templates:</span>
      {names.map((n) => (
        <TemplateChip key={n} name={n} tpl={templates.get(templateKey(n))} />
      ))}
    </div>
  );
}

function Checklist({
  items,
  storageKey,
  templates,
}: {
  items: Block & { t: "steps" };
  storageKey: string;
  templates: Map<string, Template>;
}) {
  const [done, setDone] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as number[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* sem armazenamento: só em memória */
      }
      return next;
    });
  const total = items.items.length;
  const [guide, setGuide] = useState<number | null>(null);
  const pct = Math.round((done.size / total) * 100);
  return (
    <div className="space-y-2.5">
      {total > 2 && (
        <div className="flex items-center gap-3" aria-live="polite">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {done.size === total ? "Tudo feito" : `${done.size} de ${total} feitos`}
          </span>
          <button
            type="button"
            onClick={() => {
              const first = items.items.findIndex((_, j) => !done.has(j));
              setGuide(first < 0 ? 0 : first);
            }}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlayCircle className="size-4" /> Modo guiado
          </button>
        </div>
      )}
      <Dialog open={guide !== null} onOpenChange={(o) => !o && setGuide(null)}>
        <DialogContent className="max-w-lg">
          {guide !== null &&
            items.items[guide] &&
            (() => {
              const s = items.items[guide]!;
              const lastStep = guide === total - 1;
              return (
                <div className="space-y-4">
                  <div className="flex gap-1" aria-hidden>
                    {items.items.map((_, j) => (
                      <span
                        key={j}
                        className={`h-1.5 flex-1 rounded-full ${done.has(j) ? "bg-primary/60" : j === guide ? "bg-primary" : "bg-muted"}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Passo {guide + 1} de {total}
                  </p>
                  <DialogTitle className="text-xl leading-snug">{s.title}</DialogTitle>
                  <DialogDescription className="sr-only">Passo guiado</DialogDescription>
                  {s.text && (
                    <p className="text-[15px] leading-7 text-foreground/90">
                      <HighlightVars text={s.text} />
                    </p>
                  )}
                  {s.list && (
                    <ul className="list-disc space-y-1 pl-5 text-[15px] leading-7 text-foreground/90 marker:text-primary/70">
                      {s.list.map((it, j) => (
                        <li key={j}>{it}</li>
                      ))}
                    </ul>
                  )}
                  {!!s.tpl?.length && <Templates names={s.tpl} templates={templates} />}
                  {!!s.sub?.length && (
                    <ol className="space-y-2 rounded-xl bg-muted/30 p-3">
                      {s.sub.map((ss, j) => (
                        <li key={j} className="space-y-1 text-sm leading-relaxed">
                          <span className="font-medium text-foreground">
                            <span className="mr-1.5 font-semibold text-primary">{j + 1}.</span>
                            {ss.title}
                          </span>
                          {ss.text && (
                            <span className="block text-muted-foreground">{ss.text}</span>
                          )}
                          {!!ss.tpl?.length && <Templates names={ss.tpl} templates={templates} />}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button
                      type="button"
                      disabled={guide === 0}
                      onClick={() => setGuide(guide - 1)}
                      className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!done.has(guide)) toggle(guide);
                        setGuide(lastStep ? null : guide + 1);
                        if (lastStep) toast.success("Tudo feito!");
                      }}
                      className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {lastStep ? "Feito, concluir" : "Feito, próximo passo"}
                    </button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
      <ol>
        {items.items.map((s, i) => {
          const checked = done.has(i);
          const last = i === items.items.length - 1;
          return (
            <li key={i} className="relative pb-5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={`absolute left-[15px] top-9 bottom-1 w-px ${checked ? "bg-primary/60" : "bg-border"}`}
                />
              )}
              <label className="group/step flex cursor-pointer gap-4 rounded-lg py-1 pr-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(i)}
                  className="peer sr-only"
                />
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/50 bg-background text-primary group-hover/step:border-primary"
                  }`}
                  aria-hidden
                >
                  {checked ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 space-y-1 pt-1">
                  <span
                    className={`block text-[15px] font-semibold ${checked ? "text-muted-foreground line-through" : "text-foreground"}`}
                  >
                    {s.title}
                  </span>
                  {s.text && (
                    <span className="block text-sm leading-relaxed text-muted-foreground">
                      <HighlightVars text={s.text} />
                    </span>
                  )}
                  {s.list && (
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary/70">
                      {s.list.map((it, j) => (
                        <li key={j}>{it}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </label>
              {(s.tpl?.length || s.sub?.length) && (
                <div className="ml-12 mt-2 space-y-2">
                  {!!s.tpl?.length && <Templates names={s.tpl} templates={templates} />}
                  {!!s.sub?.length && (
                    <details className="group/sub">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-primary transition hover:border-primary [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="size-3.5 transition-transform group-open/sub:rotate-90" />
                        <span className="group-open/sub:hidden">
                          Ver passo a passo ({s.sub.length})
                        </span>
                        <span className="hidden group-open/sub:inline">Esconder passo a passo</span>
                      </summary>
                      <ol className="mt-2 space-y-1.5 border-l-2 border-primary/30 pl-3">
                        {s.sub.map((ss, j) => (
                          <li key={j} className="space-y-1 text-sm leading-relaxed">
                            <span className="font-medium text-foreground">
                              <span className="mr-1.5 font-semibold text-primary">
                                {i + 1}.{j + 1}
                              </span>
                              {ss.title}
                            </span>
                            {ss.text && (
                              <span className="block text-muted-foreground">
                                <HighlightVars text={ss.text} />
                              </span>
                            )}
                            {!!ss.tpl?.length && <Templates names={ss.tpl} templates={templates} />}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function KbBlock({
  block: b,
  index,
  articleId,
  images,
  templates,
}: {
  block: Block;
  index: number;
  articleId: string;
  images: Record<string, string>;
  templates: Map<string, Template>;
}) {
  switch (b.t) {
    case "h":
      return (
        <h2
          id={slug(b.text)}
          className="scroll-mt-24 pt-4 text-lg font-semibold tracking-tight text-foreground"
        >
          {b.text}
        </h2>
      );
    case "sub":
      return <h3 className="pt-3 text-base font-semibold text-foreground">{b.text}</h3>;
    case "file": {
      const Icon = b.kind === "video" ? PlayCircle : b.kind === "image" ? ImageIcon : FileText;
      const label =
        b.kind === "video" ? "Assistir vídeo" : b.kind === "image" ? "Ver foto" : "Abrir documento";
      return (
        <a
          href={b.link}
          target="_blank"
          rel="noopener noreferrer"
          className={`group flex items-center gap-3 rounded-lg border p-3 transition hover:border-primary ${
            b.kind === "video"
              ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
              : "border-border hover:bg-muted/30"
          }`}
        >
          {b.kind === "video" ? (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition group-hover:scale-105 motion-reduce:transition-none">
              <Icon className="size-6" />
            </span>
          ) : (
            <Icon className="size-6 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{label}</span>
            <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
              {b.name}
            </span>
          </span>
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
        </a>
      );
    }
    case "p": {
      const label = startsWithLabel(b.text);
      if (label)
        return (
          <Callout kind={/dica/i.test(label[1]!) ? "tip" : "warn"}>
            {b.text.slice(label[0].length).trim()}
          </Callout>
        );
      return <p className="text-[15px] leading-7 text-foreground/90">{b.text}</p>;
    }
    case "note":
      return <Callout kind="tip">{b.text}</Callout>;
    case "warn":
      return <Callout kind="warn">{b.text}</Callout>;
    case "list":
      return (
        <div className="space-y-2">
          {b.title && <p className="text-sm font-semibold text-foreground">{b.title}</p>}
          <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-foreground/90 marker:text-primary/70">
            {b.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      );
    case "steps":
      return (
        <Checklist items={b} storageKey={`kb-check:${articleId}:${index}`} templates={templates} />
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg bg-muted/15 ring-1 ring-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="px-3 py-2.5 text-left font-semibold text-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-t border-border transition-colors even:bg-muted/20 hover:bg-primary/[0.06]"
                >
                  {r.map((c, j) => {
                    // Valores curtos (US$ 40, 6,5%, Sem taxa) ganham destaque e alinham os números.
                    const valor =
                      j > 0 &&
                      c.length <= 24 &&
                      /^(US\$|R\$|\$|Sem taxa|Grátis|Isento|\d)/i.test(c.trim());
                    return (
                      <td
                        key={j}
                        className={`px-3 py-2.5 align-top ${
                          valor
                            ? "whitespace-nowrap font-semibold tabular-nums text-primary"
                            : j === 0 && r.length > 1
                              ? "text-foreground"
                              : "text-foreground/85"
                        }`}
                      >
                        {c}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "img": {
      const url = images[b.src];
      if (!url) return null;
      return (
        <figure className="space-y-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block">
            <img
              src={url}
              alt={b.caption}
              loading="lazy"
              className="max-h-[560px] w-auto max-w-full rounded-lg border border-border transition hover:opacity-90"
            />
          </a>
          <figcaption className="text-xs text-muted-foreground">{b.caption}</figcaption>
        </figure>
      );
    }
    case "quote":
      return <MessageBlock title={b.title} text={b.text} />;
    case "langs":
      return <LangTabs items={b.items} />;
    case "widget":
      if (b.name === "arrivals") return <ChegadasAmanha />;
      return (
        <details className="group/w space-y-3 rounded-2xl bg-primary/10 ring-1 ring-primary/30 open:bg-transparent open:ring-0">
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {b.name === "fleet" ? (
                <CarFront className="size-6" />
              ) : b.name === "map" ? (
                <MapPinned className="size-6" />
              ) : (
                <Calculator className="size-6" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">
                {b.name === "fleet"
                  ? "Qual carro serve para o cliente?"
                  : b.name === "map"
                    ? "Mapa das bases de retirada"
                    : "Calcular taxas de entrega"}
              </span>
              <span className="block text-sm text-muted-foreground">
                {b.name === "fleet"
                  ? "Informe pessoas e malas e veja as categorias que servem."
                  : b.name === "map"
                    ? "Clique na base e veja taxa, como entregamos e o template."
                    : "Escolha retirada e devolução e copie o total com imposto."}
              </span>
            </span>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              <span className="group-open/w:hidden">Abrir</span>
              <span className="hidden group-open/w:inline">Fechar</span>
            </span>
          </summary>
          {b.name === "fleet" ? (
            <FleetPicker area={b.area} />
          ) : b.name === "map" ? (
            <MapaBases />
          ) : (
            <QuoteCalc />
          )}
        </details>
      );
    case "quiz":
      return <Quiz items={b.items} area={b.area} />;
    case "faq":
      return (
        <div className="space-y-2">
          {b.items.map((f, i) => (
            <details
              key={i}
              className="group/faq rounded-xl bg-muted/25 open:bg-muted/15 open:ring-1 open:ring-primary/30"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  ?
                </span>
                <span className="flex-1 font-semibold text-foreground">{f.q}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/faq:rotate-90" />
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <p className="text-[15px] font-medium text-primary">{f.a}</p>
                <LangTabs
                  items={[
                    { label: "Português", text: f.pt },
                    { label: "Español", text: f.es },
                  ]}
                />
              </div>
            </details>
          ))}
        </div>
      );
    case "thumb":
      return <DriveThumb id={b.id} alt={b.alt} className="aspect-video w-full max-w-xl" />;
    case "keys":
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {b.items.map((x, i) => (
            <button
              key={i}
              type="button"
              title="Clique para copiar"
              onClick={async () => {
                const txt = `${x.label.charAt(0).toUpperCase()}${x.label.slice(1)}: ${x.value}`;
                try {
                  await navigator.clipboard.writeText(txt);
                  toast.success(`Copiado: ${txt}`);
                } catch {
                  toast.error("Não foi possível copiar");
                }
              }}
              className="group/key relative rounded-xl bg-muted/30 p-3.5 text-left transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Copy className="absolute right-2.5 top-2.5 size-3.5 text-muted-foreground opacity-0 transition group-hover/key:opacity-100 group-focus-visible/key:opacity-100" />
              <span className="block text-2xl font-bold leading-tight tracking-tight text-foreground tabular-nums">
                {x.value}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {x.label}
              </span>
            </button>
          ))}
        </div>
      );
    case "cards":
      return (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {b.items.map((c, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-muted/30 p-4 transition-colors hover:bg-muted/50"
            >
              {c.icon && (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  {namedIcon(c.icon)}
                </span>
              )}
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-semibold text-foreground">{c.title}</span>
                <span className="block text-sm leading-relaxed text-muted-foreground">
                  <HighlightVars text={c.text} />
                </span>
              </span>
            </div>
          ))}
        </div>
      );
    case "flow":
      return (
        <ol className="flex flex-wrap items-stretch gap-2">
          {b.items.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
                <span className="block text-sm font-semibold text-foreground">
                  <span className="mr-1 text-primary">{i + 1}.</span>
                  {f.title}
                </span>
                {f.when && <span className="block text-xs text-muted-foreground">{f.when}</span>}
              </span>
              {i < b.items.length - 1 && (
                <span className="text-primary" aria-hidden>
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      );
    case "tags": {
      // Se o documento "Templates de mensagem" tiver o template, mostra o texto com "Copiar".
      const found = b.items.map((name) => ({ name, tpl: templates.get(templateKey(name)) }));
      const chips = (
        <div className="flex flex-wrap gap-2">
          {found.map((f) => (
            <TemplateChip key={f.name} name={f.name} tpl={f.tpl} />
          ))}
        </div>
      );
      if (!b.title) return chips;
      // Grupo grande vem fechado: a página vira um índice de grupos, não um muro de nomes.
      return (
        <details
          open={b.items.length <= 6}
          className="group/tags rounded-lg border border-border bg-muted/10 open:bg-transparent"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/tags:rotate-90" />
            <span className="flex-1 text-sm font-semibold text-foreground">{b.title}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {b.items.length}
            </span>
          </summary>
          <div className="px-3 pb-3">{chips}</div>
        </details>
      );
    }
  }
}
