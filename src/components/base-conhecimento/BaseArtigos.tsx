import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ExternalLink, Info, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Aba "Base": artigos organizados por categoria, com etapas, tabelas e imagens.

type Step = { title: string; text?: string; list?: string[] };
type Block =
  | { t: "p" | "h" | "note" | "warn"; text: string }
  | { t: "list"; items: string[]; title?: string }
  | { t: "steps"; items: Step[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "img"; src: string; caption: string }
  | { t: "quote"; text: string; title?: string }
  | { t: "tags"; items: string[]; title?: string };
type Article = {
  id: string;
  category: string;
  title: string;
  summary: string;
  keywords: string;
  blocks: Block[];
  sources: string[];
};
type KbBase = {
  generatedAt: string;
  categories: { id: string; title: string; description: string }[];
  sources: Record<string, { name: string; link: string }>;
  articles: Article[];
  images: Record<string, string>;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function blockText(b: Block): string {
  switch (b.t) {
    case "steps":
      return b.items.map((s) => `${s.title} ${s.text ?? ""} ${(s.list ?? []).join(" ")}`).join(" ");
    case "list":
    case "tags":
      return `${b.title ?? ""} ${b.items.join(" ")}`;
    case "table":
      return [...b.head, ...b.rows.flat()].join(" ");
    case "img":
      return b.caption;
    default:
      return b.text;
  }
}

export function BaseArtigos({ fetchBase }: { fetchBase: () => Promise<KbBase> }) {
  const base = useQuery({ queryKey: ["kb-base"], queryFn: fetchBase, staleTime: 20 * 60_000 });
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const index = useMemo(
    () =>
      (base.data?.articles ?? []).map((a) => ({
        a,
        text: norm(`${a.title} ${a.summary} ${a.keywords} ${a.blocks.map(blockText).join(" ")}`),
      })),
    [base.data],
  );

  if (base.isLoading) return <Card className="p-5 text-sm text-muted-foreground">Carregando…</Card>;
  if (base.isError)
    return <Card className="p-5 text-sm text-destructive">{(base.error as Error).message}</Card>;
  const data = base.data!;

  const terms = norm(q).split(/\s+/).filter(Boolean);
  const list = index
    .filter(({ a, text }) => (!cat || a.category === cat) && terms.every((t) => text.includes(t)))
    .map(({ a }) => a);
  const open = data.articles.find((a) => a.id === openId) ?? null;
  const catTitle = (id: string) => data.categories.find((c) => c.id === id)?.title ?? id;

  if (open) {
    return (
      <ArticleView
        article={open}
        category={catTitle(open.category)}
        data={data}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar processo, regra ou template…"
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <CatChip active={!cat} onClick={() => setCat(null)}>
          Todos ({data.articles.length})
        </CatChip>
        {data.categories.map((c) => (
          <CatChip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
            {c.title} ({data.articles.filter((a) => a.category === c.id).length})
          </CatChip>
        ))}
      </div>

      {list.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Nada encontrado. Tente outra palavra ou pergunte no Chat.
        </Card>
      ) : (
        (cat ? [cat] : data.categories.map((c) => c.id))
          .filter((cid) => list.some((a) => a.category === cid))
          .map((cid) => (
            <section key={cid} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {catTitle(cid)}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {list
                  .filter((a) => a.category === cid)
                  .map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setOpenId(a.id);
                        window.scrollTo({ top: 0 });
                      }}
                      className="rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary hover:bg-muted/40"
                    >
                      <p className="font-medium text-foreground">{a.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{a.summary}</p>
                    </button>
                  ))}
              </div>
            </section>
          ))
      )}
      <p className="text-xs text-muted-foreground">
        Base organizada a partir dos arquivos do Drive em{" "}
        {new Date(`${data.generatedAt}T12:00:00`).toLocaleDateString("pt-BR")}. Para corrigir algo,
        ajuste o arquivo de origem no Drive e peça a atualização da base.
      </p>
    </div>
  );
}

function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ArticleView({
  article,
  category,
  data,
  onBack,
}: {
  article: Article;
  category: string;
  data: KbBase;
  onBack: () => void;
}) {
  return (
    <Card className="space-y-5 p-4 sm:p-6">
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 size-4" /> Voltar à base
      </Button>
      <div className="space-y-1">
        <Badge variant="outline" className="border-primary/40 text-primary">
          {category}
        </Badge>
        <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{article.title}</h2>
        <p className="text-sm text-muted-foreground">{article.summary}</p>
      </div>
      <div className="space-y-4">
        {article.blocks.map((b, i) => (
          <BlockView key={i} block={b} images={data.images} />
        ))}
      </div>
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Fontes</p>
        <ul className="space-y-1">
          {article.sources.map((s) => {
            const src = data.sources[s];
            if (!src) return null;
            return (
              <li key={s}>
                <a
                  href={src.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
                >
                  {src.name} <ExternalLink className="size-3" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function BlockView({ block: b, images }: { block: Block; images: Record<string, string> }) {
  switch (b.t) {
    case "h":
      return <h3 className="pt-2 text-base font-semibold text-foreground">{b.text}</h3>;
    case "p":
      return <p className="text-sm leading-relaxed text-foreground">{b.text}</p>;
    case "note":
      return (
        <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{b.text}</span>
        </div>
      );
    case "warn":
      return (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>{b.text}</span>
        </div>
      );
    case "list":
      return (
        <div className="space-y-1">
          {b.title && <p className="text-sm font-medium text-foreground">{b.title}</p>}
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {b.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      );
    case "steps":
      return (
        <ol className="space-y-3">
          {b.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-1 pt-0.5">
                <p className="text-sm font-medium text-foreground">{s.title}</p>
                {s.text && <p className="text-sm text-muted-foreground">{s.text}</p>}
                {s.list && (
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {s.list.map((it, j) => (
                      <li key={j}>{it}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top text-foreground">
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
        <figure className="space-y-1">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={b.caption}
              loading="lazy"
              className="max-h-[520px] w-auto max-w-full rounded-md border border-border"
            />
          </a>
          <figcaption className="text-xs text-muted-foreground">{b.caption}</figcaption>
        </figure>
      );
    }
    case "quote":
      return (
        <div className="space-y-1">
          {b.title && <p className="text-xs font-medium text-muted-foreground">{b.title}</p>}
          <blockquote className="rounded-md border-l-4 border-primary bg-muted/40 p-3 text-sm italic text-foreground">
            {b.text}
          </blockquote>
        </div>
      );
    case "tags":
      return (
        <div className="space-y-1.5">
          {b.title && <p className="text-sm font-medium text-foreground">{b.title}</p>}
          <div className="flex flex-wrap gap-1.5">
            {b.items.map((it, i) => (
              <code
                key={i}
                className="rounded border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground"
              >
                {it}
              </code>
            ))}
          </div>
        </div>
      );
  }
}
