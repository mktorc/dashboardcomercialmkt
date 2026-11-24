import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight,
  Clock,
  ExternalLink,
  FileQuestion,
  MessageSquare,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KbBlock } from "./KbBlocks";
import { templateKey } from "@/lib/kb/templates";
import {
  AREA_INFO,
  driveLinkOf,
  fmtDate,
  kbApi,
  slug,
  type Article,
  type KbAreaData,
  type Template,
} from "./kb-api";

function Toc({ article }: { article: Article }) {
  const heads = article.blocks.filter((b) => b.t === "h") as { t: "h"; text: string }[];
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = heads
      .map((h) => document.getElementById(slug(h.text)))
      .filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.id]);
  if (heads.length < 2) return null;
  return (
    <nav aria-label="Nesta página" className="sticky top-8 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Nesta página
      </p>
      <ul className="space-y-1 border-l border-border">
        {heads.map((h) => {
          const id = slug(h.text);
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                className={`-ml-px block border-l-2 py-1 pl-3 text-sm transition ${
                  active === id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Helpful({ article, data }: { article: Article; data: KbAreaData }) {
  const qc = useQueryClient();
  const mine = data.stats[article.id]?.mine ?? 0;
  const vote = useMutation({
    mutationFn: (v: number) =>
      kbApi("feedback", {
        method: "POST",
        body: { area: data.area, articleId: article.id, action: "vote", vote: v },
      }),
    onMutate: (v) => {
      // Atualiza na hora (voto único por usuário: trocar o voto move a contagem).
      qc.setQueryData<KbAreaData>(["kb-area", data.area], (old) => {
        if (!old) return old;
        const s = { ...(old.stats[article.id] ?? { views: 0, up: 0, down: 0, mine: 0 }) };
        if (s.mine === 1) s.up--;
        if (s.mine === -1) s.down--;
        if (v === 1) s.up++;
        if (v === -1) s.down++;
        s.mine = v;
        return { ...old, stats: { ...old.stats, [article.id]: s } };
      });
    },
    onSuccess: (_r, v) => {
      if (v) toast.success("Obrigado pelo retorno!");
    },
    onError: () => {
      toast.error("Não foi possível registrar o voto");
      void qc.invalidateQueries({ queryKey: ["kb-area", data.area] });
    },
  });
  const btn = (v: 1 | -1) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      mine === v
        ? "border-primary bg-primary/15 text-foreground"
        : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-foreground">Isso ajudou?</span>
      <button
        type="button"
        className={btn(1)}
        onClick={() => vote.mutate(mine === 1 ? 0 : 1)}
        aria-pressed={mine === 1}
      >
        <ThumbsUp className="size-4" /> Sim
      </button>
      <button
        type="button"
        className={btn(-1)}
        onClick={() => vote.mutate(mine === -1 ? 0 : -1)}
        aria-pressed={mine === -1}
      >
        <ThumbsDown className="size-4" /> Não
      </button>
    </div>
  );
}

export function KbArticle({ data, articleId }: { data: KbAreaData; articleId: string }) {
  const article = data.articles.find((a) => a.id === articleId);
  const viewed = useRef<string | null>(null);

  useEffect(() => {
    if (!article || viewed.current === article.id) return;
    viewed.current = article.id;
    window.scrollTo({ top: 0 });
    void kbApi("feedback", {
      method: "POST",
      body: { area: data.area, articleId: article.id, action: "view" },
    }).catch(() => {});
  }, [article, data.area]);

  const templates = useMemo(
    () => new Map<string, Template>(data.templates.map((t) => [templateKey(t.title), t])),
    [data.templates],
  );

  if (!article)
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-24 text-center">
        <FileQuestion className="size-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">Artigo não encontrado nesta área</p>
        <Button asChild variant="outline">
          <Link to="/base-conhecimento/$area" params={{ area: data.area }}>
            Ir para o início
          </Link>
        </Button>
      </div>
    );

  const cat = data.categories.find((c) => c.id === article.category);
  const drive = driveLinkOf(article, data);
  const related = data.articles
    .filter((a) => a.category === article.category && a.id !== article.id)
    .slice(0, 4);

  return (
    <div className="flex gap-10 px-4 py-6 sm:px-8 lg:py-10">
      <article className="min-w-0 max-w-[720px] flex-1">
        <nav
          aria-label="Trilha"
          className="mb-5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          <Link
            to="/base-conhecimento/$area"
            params={{ area: data.area }}
            className="hover:text-foreground"
          >
            {AREA_INFO[data.area].short}
          </Link>
          <ChevronRight className="size-3.5" />
          <span>{cat?.title ?? article.category}</span>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-foreground">{article.title}</span>
        </nav>

        <header className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap gap-2">
            {article.shared && (
              <Badge variant="outline" className="gap-1 border-sky-400/40 text-sky-300">
                <Share2 className="size-3" /> Compartilhado
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {article.title}
          </h1>
          <p className="text-base leading-7 text-muted-foreground">{article.summary}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" /> Atualizado em {fmtDate(article.updatedAt)}
            </span>
            {drive && (
              <a
                href={drive}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <ExternalLink className="size-4" /> Abrir no Drive
              </a>
            )}
          </div>
        </header>

        <div className="space-y-5 py-6">
          {article.blocks.map((b, i) => (
            <KbBlock
              key={i}
              block={b}
              index={i}
              articleId={article.id}
              images={data.images}
              templates={templates}
            />
          ))}
        </div>

        <div className="space-y-6 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Helpful article={article} data={data} />
            <Button asChild variant="outline" size="sm">
              <Link
                to="/base-conhecimento/$area/chat"
                params={{ area: data.area }}
                search={{ q: `Sobre "${article.title}": ` }}
              >
                <MessageSquare className="mr-1.5 size-4" /> Perguntar à IA sobre este artigo
              </Link>
            </Button>
          </div>

          {related.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Artigos relacionados
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {related.map((a) => (
                  <Link
                    key={a.id}
                    to="/base-conhecimento/$area/$artigo"
                    params={{ area: data.area, artigo: a.id }}
                    className="group rounded-lg border border-border p-3 transition hover:border-primary hover:bg-muted/30"
                  >
                    <p className="text-sm font-medium text-foreground group-hover:text-primary">
                      {a.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.summary}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="text-xs text-muted-foreground">
            Fontes:{" "}
            {article.sources
              .map((s) => data.sources[s])
              .filter(Boolean)
              .map((s, i) => (
                <span key={s!.link}>
                  {i > 0 && " · "}
                  <a
                    href={s!.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {s!.name}
                  </a>
                </span>
              ))}
          </div>
        </div>
      </article>
      <aside className="hidden w-56 shrink-0 xl:block">
        <Toc article={article} />
      </aside>
    </div>
  );
}
