import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
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
        className="rounded bg-primary/25 px-1 font-medium text-primary-foreground not-italic"
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
export function MessageBlock({ title, text }: { title?: string | undefined; text: string }) {
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
        className={`rounded-md border px-2 py-0.5 text-left font-mono text-xs text-foreground transition hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          tpl ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40"
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

function Checklist({ items, storageKey }: { items: Block & { t: "steps" }; storageKey: string }) {
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
  return (
    <ol className="space-y-2">
      {items.items.map((s, i) => {
        const checked = done.has(i);
        return (
          <li key={i}>
            <label
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                checked
                  ? "border-primary/30 bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(i)}
                className="peer sr-only"
              />
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/60 text-primary"
                }`}
                aria-hidden
              >
                {checked ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 space-y-1">
                <span
                  className={`block text-sm font-medium ${checked ? "text-muted-foreground line-through" : "text-foreground"}`}
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
          </li>
        );
      })}
    </ol>
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
      return <h3 className="pt-2 text-base font-semibold text-foreground">{b.text}</h3>;
    case "file": {
      const Icon = b.kind === "video" ? PlayCircle : b.kind === "image" ? ImageIcon : FileText;
      const label =
        b.kind === "video" ? "Assistir vídeo" : b.kind === "image" ? "Ver foto" : "Abrir documento";
      return (
        <a
          href={b.link}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-primary hover:bg-muted/30"
        >
          <Icon className="size-6 shrink-0 text-primary" />
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
      return <Checklist items={b} storageKey={`kb-check:${articleId}:${index}`} />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
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
                <tr key={i} className="border-t border-border even:bg-muted/20">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2.5 align-top text-foreground/90">
                      {c}
                    </td>
                  ))}
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
    case "tags": {
      // Se o documento "Templates de mensagem" tiver o template, mostra o texto com "Copiar".
      const found = b.items.map((name) => ({ name, tpl: templates.get(templateKey(name)) }));
      return (
        <div className="space-y-2">
          {b.title && <p className="text-sm font-semibold text-foreground">{b.title}</p>}
          <div className="flex flex-wrap gap-1.5">
            {found.map((f) => (
              <TemplateChip key={f.name} name={f.name} tpl={f.tpl} />
            ))}
          </div>
        </div>
      );
    }
  }
}
