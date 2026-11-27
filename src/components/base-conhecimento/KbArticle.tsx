import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  ExternalLink,
  FileQuestion,
  MessageSquare,
  Share2,
  Star,
  ThumbsDown,
  ThumbsUp,
  GraduationCap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientNameInput, KbBlock, TemplateChip } from "./KbBlocks";
import { catIcon, sectionIcon } from "./kb-icons";
import { templateKey } from "@/lib/kb/templates";
import {
  AREA_INFO,
  driveLinkOf,
  fmtDate,
  kbApi,
  slug,
  pushRecentView,
  TRILHA,
  toggleFavorite,
  CURADORIA_EM,
  useFavorites,
  isRecent,
  type Article,
  type KbArea,
  type KbAreaData,
  type Template,
} from "./kb-api";

/** Divide os blocos em seções: cada subtítulo ("h") abre uma seção recolhível até o próximo. */
function sections(blocks: Article["blocks"]) {
  const out: { head: number | null; body: number[] }[] = [{ head: null, body: [] }];
  blocks.forEach((b, i) => {
    if (b.t === "h") out.push({ head: i, body: [] });
    else out[out.length - 1]!.body.push(i);
  });
  return out.filter((s) => s.head !== null || s.body.length);
}

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
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(id);
                  const d = el?.parentElement;
                  if (d instanceof HTMLDetailsElement) d.open = true;
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  setActive(id);
                }}
                className={`-ml-px block border-l-2 py-1.5 pl-3 text-sm leading-snug transition ${
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
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ChevronRight className="size-3.5 -rotate-90" /> Voltar ao topo
      </button>
    </nav>
  );
}

/** "Algo mudou?": avisa o administrador que um valor ou regra desta página está desatualizado. */
function OutdatedButton({ article, data }: { article: Article; data: KbAreaData }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  const send = useMutation({
    mutationFn: () =>
      kbApi("feedback", {
        method: "POST",
        body: {
          area: data.area,
          articleId: article.id,
          action: "note",
          reason: "Informação desatualizada",
          note: txt.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Aviso enviado ao administrador. Obrigado!");
      setOpen(false);
      setTxt("");
    },
    onError: () => toast.error("Não foi possível enviar"),
  });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-muted/40 px-3 text-muted-foreground transition hover:text-foreground"
      >
        <AlertTriangle className="size-4" /> Algo mudou?
      </button>
      {open && (
        <div className="w-full space-y-2 rounded-xl bg-muted/25 p-3">
          <p className="text-sm text-foreground">O que está diferente do que acontece hoje?</p>
          <textarea
            autoFocus
            value={txt}
            onChange={(e) => setTxt(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Ex.: a taxa de Tampa agora é US$ 150"
            className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            disabled={!txt.trim() || send.isPending}
            onClick={() => send.mutate()}
            className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Avisar o administrador
          </button>
        </div>
      )}
    </>
  );
}

function Helpful({ article, data }: { article: Article; data: KbAreaData }) {
  const qc = useQueryClient();
  const mine = data.stats[article.id]?.mine ?? 0;
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () =>
      kbApi("feedback", {
        method: "POST",
        body: { area: data.area, articleId: article.id, action: "note", reason, note: note.trim() },
      }),
    onSuccess: () => {
      toast.success("Recebido! Vamos melhorar esta página.");
      setAsk(false);
      setReason("");
      setNote("");
    },
    onError: () => toast.error("Não foi possível enviar"),
  });
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
        onClick={() => {
          const v = mine === -1 ? 0 : -1;
          vote.mutate(v);
          setAsk(v === -1);
        }}
        aria-pressed={mine === -1}
      >
        <ThumbsDown className="size-4" /> Não
      </button>
      {ask && (
        <div className="w-full space-y-3 pt-1">
          <p className="text-sm font-medium text-foreground">O que faltou?</p>
          <div className="flex flex-wrap gap-2">
            {[
              "Informação errada",
              "Faltou informação",
              "Difícil de entender",
              "Não achei o que queria",
            ].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(reason === r ? "" : r)}
                className={`min-h-9 rounded-full px-3 text-sm transition ${
                  reason === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-foreground/85 hover:bg-primary/15"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Conte em uma frase (opcional)"
            className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={(!reason && !note.trim()) || send.isPending}
              onClick={() => send.mutate()}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={() => setAsk(false)}
              className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              Agora não
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function KbArticle({ data, articleId }: { data: KbAreaData; articleId: string }) {
  const article = data.articles.find((a) => a.id === articleId);
  const viewed = useRef<string | null>(null);
  const [tplFilter, setTplFilter] = useState("");
  const favs = useFavorites(data.area);
  useEffect(() => setTplFilter(""), [articleId]);

  useEffect(() => {
    if (!article || viewed.current === article.id) return;
    viewed.current = article.id;
    pushRecentView(data.area, article.id);
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
  const parentCat = cat?.parent ? data.categories.find((c) => c.id === cat.parent) : undefined;
  const drive = driveLinkOf(article, data);
  const relatedAll = data.articles.filter(
    (a) => a.category === article.category && a.id !== article.id,
  );
  // Página de templates: busca pelo nome.
  const tplNames = article.blocks.flatMap((b) => (b.t === "tags" ? b.items : []));
  const fold = (x: string) =>
    x
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const tplHits = tplNames.filter((n) => fold(n).includes(fold(tplFilter.trim())));
  const isFav = favs.includes(article.id);
  const hasMessages = article.blocks.some(
    (b) => b.t === "langs" || b.t === "quote" || b.t === "faq",
  );
  const heads = article.blocks.flatMap((b) => (b.t === "h" ? [b.text] : []));
  const words = JSON.stringify(article.blocks).split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  // Anterior/Próxima: as páginas da mesma categoria, na ordem do menu (etapas de um processo).
  const siblings = data.articles.filter((a) => a.category === article.category);
  const pos = siblings.findIndex((a) => a.id === article.id);
  // Página da trilha de onboarding: Anterior/Próxima seguem a ordem da trilha.
  const byId = new Map(data.articles.map((a) => [a.id, a]));
  const trilha = TRILHA[data.area].map((id) => byId.get(id)).filter((a): a is Article => !!a);
  const tPos = trilha.findIndex((a) => a.id === article.id);
  const inTrilha = tPos >= 0;
  const prev = inTrilha ? trilha[tPos - 1] : pos > 0 ? siblings[pos - 1] : undefined;
  const next = inTrilha ? trilha[tPos + 1] : pos >= 0 ? siblings[pos + 1] : undefined;
  const nextLabel = inTrilha ? "Próxima da trilha" : "Próxima";
  // Leia também: outras da categoria, sem repetir as que já estão em Anterior/Próxima.
  const related = relatedAll.filter((a) => a.id !== prev?.id && a.id !== next?.id).slice(0, 4);
  // Etapas numeradas ("1. Onboarding", "2. ..."): mostra a barra de progresso da jornada.
  const isJourney = /^\d+\.\s/.test(article.title);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] justify-center gap-8 px-4 py-6 sm:px-6 lg:gap-10 lg:px-8 lg:py-10 2xl:max-w-[1500px]">
      <ReadingProgress />
      <article
        key={article.id}
        className="min-w-0 max-w-[860px] flex-1 break-words motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 2xl:max-w-[1040px]"
      >
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
          {parentCat && (
            <>
              <span>{parentCat.title}</span>
              <ChevronRight className="size-3.5" />
            </>
          )}
          <span>{cat?.title ?? article.category}</span>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-foreground">{article.title}</span>
        </nav>

        {inTrilha && <TrilhaBar area={data.area} trilha={trilha} pos={tPos} />}

        <header className="space-y-3 border-b border-border pb-6">
          <div className="flex flex-wrap gap-2">
            {isRecent(article.updatedAt) && (
              <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                Atualizado esta semana
              </Badge>
            )}
            {article.shared && (
              <Badge variant="outline" className="gap-1 border-sky-400/40 text-sky-300">
                <Share2 className="size-3" /> Compartilhado
              </Badge>
            )}
          </div>
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex"
            >
              {catIcon(parentCat?.title ?? cat?.title ?? "", "size-7")}
            </span>
            <div className="min-w-0 space-y-2">
              <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                {article.title}
              </h1>
              <p className="max-w-[60ch] text-base leading-7 text-muted-foreground sm:text-lg">
                {article.summary}
              </p>
            </div>
          </div>
          {heads.length > 1 && (
            <nav aria-label="Nesta página" className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const all = [...document.querySelectorAll<HTMLDetailsElement>("details.kb-sec")];
                  const open = !all.every((d) => d.open);
                  all.forEach((d) => (d.open = open));
                }}
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Abrir / recolher tudo
              </button>
              <span className="text-xs text-muted-foreground xl:hidden">ou abra uma seção:</span>
              {heads.map((h) => (
                <a
                  key={h}
                  href={`#${slug(h)}`}
                  onClick={() => {
                    const d = document.getElementById(slug(h))?.parentElement;
                    if (d instanceof HTMLDetailsElement) d.open = true;
                  }}
                  className="inline-flex min-h-8 items-center rounded-full bg-muted/50 px-3 text-[13px] text-foreground/85 transition hover:bg-primary/15 hover:text-foreground xl:hidden"
                >
                  {h}
                </a>
              ))}
            </nav>
          )}
          {isJourney && siblings.length > 1 && (
            <nav aria-label="Etapas do processo" className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">
                {cat?.title ?? "Processo"}: etapa {pos + 1} de {siblings.length}
              </p>
              <ol className="flex gap-1">
                {siblings.map((s, i) => (
                  <li key={s.id} className="min-w-0 flex-1">
                    <Link
                      to="/base-conhecimento/$area/$artigo"
                      params={{ area: data.area, artigo: s.id }}
                      title={s.title}
                      aria-current={i === pos ? "step" : undefined}
                      className={`block h-1.5 rounded-full transition ${
                        i < pos
                          ? "bg-primary/60"
                          : i === pos
                            ? "bg-primary"
                            : "bg-muted hover:bg-primary/30"
                      }`}
                    >
                      <span className="sr-only">{s.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" /> {minutes} min de leitura · atualizado em{" "}
              {fmtDate(article.updatedAt)}
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
            <button
              type="button"
              onClick={() => toggleFavorite(data.area, article.id)}
              aria-pressed={isFav}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 transition ${
                isFav
                  ? "bg-primary/20 text-primary"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Star className={`size-4 ${isFav ? "fill-current" : ""}`} />
              {isFav ? "Nos favoritos" : "Favoritar"}
            </button>
            <OutdatedButton article={article} data={data} />
          </div>
        </header>

        {data.admin && article.curated && article.updatedAt.slice(0, 10) > CURADORIA_EM && (
          <div className="mt-4 flex gap-3 rounded-xl bg-amber-500/10 p-3 text-sm text-foreground ring-1 ring-amber-500/40">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <span>
              O arquivo do Drive desta página mudou em {fmtDate(article.updatedAt)}, depois da
              revisão. Confira se o texto daqui ainda está certo. (Só administradores veem este
              aviso.)
            </span>
          </div>
        )}
        <div className="space-y-5 py-6">
          {hasMessages && <ClientNameInput />}
          {tplNames.length > 15 && (
            <div className="space-y-3">
              <input
                type="search"
                value={tplFilter}
                onChange={(e) => setTplFilter(e.target.value)}
                placeholder={`Buscar entre ${tplNames.length} templates…`}
                aria-label="Buscar template"
                className="h-11 w-full rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              {tplFilter.trim() && (
                <div className="flex flex-wrap gap-2">
                  {tplHits.length ? (
                    tplHits.map((n) => (
                      <TemplateChip key={n} name={n} tpl={templates.get(templateKey(n))} />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum template com esse nome.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {!tplFilter.trim() &&
            sections(article.blocks).map((sec) => {
              const render = (i: number) => (
                <KbBlock
                  key={i}
                  block={article.blocks[i]!}
                  index={i}
                  articleId={article.id}
                  images={data.images}
                  templates={templates}
                />
              );
              if (sec.head === null) return sec.body.map(render);
              const text = (article.blocks[sec.head] as { text: string }).text;
              return (
                <details
                  key={sec.head}
                  className="kb-sec group space-y-5 rounded-xl [&:not([open])]:!mt-2.5"
                >
                  <summary
                    id={slug(text)}
                    className="flex min-h-14 cursor-pointer list-none items-center gap-3 scroll-mt-24 rounded-xl bg-muted/25 px-3 py-2 text-lg font-semibold tracking-tight text-foreground transition hover:bg-muted/45 group-open:bg-transparent group-open:px-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {sectionIcon(text, "size-[18px]")}
                    </span>
                    <span className="flex-1">{text}</span>
                    <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                      Abrir
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                  </summary>
                  <div className="space-y-5 sm:ml-[17px] sm:border-l-2 sm:border-primary/15 sm:pl-7">
                    {sec.body.map(render)}
                  </div>
                </details>
              );
            })}
        </div>

        {/* Celular: barra fixa no polegar com Anterior, Abrir tudo e Próxima. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-md items-center justify-between gap-2">
            {prev ? (
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: prev.id }}
                aria-label={`Anterior: ${prev.title}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-muted/50 px-3 text-sm text-foreground"
              >
                <ChevronRight className="size-5 rotate-180" />
              </Link>
            ) : (
              <span className="min-w-11" />
            )}
            {heads.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const all = [...document.querySelectorAll<HTMLDetailsElement>("details.kb-sec")];
                  const open = !all.every((d) => d.open);
                  all.forEach((d) => (d.open = open));
                }}
                className="min-h-11 flex-1 rounded-lg bg-muted/50 px-3 text-sm font-medium text-foreground"
              >
                Abrir / recolher tudo
              </button>
            )}
            {next ? (
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: next.id }}
                aria-label={`Próxima: ${next.title}`}
                className="flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
              >
                {inTrilha ? "Próxima etapa" : "Próxima"} <ChevronRight className="size-5" />
              </Link>
            ) : (
              <span className="min-w-11" />
            )}
          </div>
        </div>
        {inTrilha && !next && (
          <Link
            to="/base-conhecimento/$area/trilha"
            params={{ area: data.area }}
            className="mt-4 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm font-medium text-foreground transition hover:border-primary"
          >
            <GraduationCap className="size-5 text-primary" /> Trilha concluída. Ver a trilha
          </Link>
        )}
        {(prev || next) && (
          <nav aria-label="Etapas" className="mt-4 grid gap-3 sm:grid-cols-2">
            {prev ? (
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: prev.id }}
                className="group flex items-center gap-3 rounded-lg border border-border p-3 transition hover:border-primary hover:bg-muted/30"
              >
                <ChevronRight className="size-5 shrink-0 rotate-180 text-primary" />
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">
                    {inTrilha ? "Etapa anterior da trilha" : "Anterior"}
                  </span>
                  <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {prev.title}
                  </span>
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: next.id }}
                className="group flex items-center justify-end gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-right transition hover:border-primary"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">{nextLabel}</span>
                  <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {next.title}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-primary" />
              </Link>
            )}
          </nav>
        )}

        <div className="mt-12 space-y-12 pb-20 lg:pb-0">
          <div className="flex flex-col gap-4 rounded-2xl bg-muted/25 p-5 sm:flex-row sm:items-center sm:justify-between">
            <Helpful article={article} data={data} />
            <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
              <Link
                to="/base-conhecimento/$area/chat"
                params={{ area: data.area }}
                search={{ q: `Sobre "${article.title}": ` }}
              >
                <MessageSquare className="mr-1.5 size-4" /> Perguntar à ORCI sobre este artigo
              </Link>
            </Button>
          </div>

          {related.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Leia também</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {related.map((a) => (
                  <Link
                    key={a.id}
                    to="/base-conhecimento/$area/$artigo"
                    params={{ area: data.area, artigo: a.id }}
                    className="group rounded-xl bg-muted/15 p-4 transition hover:bg-muted/35"
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
      <aside className="hidden w-56 shrink-0 xl:block 2xl:w-64">
        <Toc article={article} />
      </aside>
    </div>
  );
}

/** Faixa da trilha de onboarding: em que etapa a pessoa está e atalho para cada uma. */
function TrilhaBar({ area, trilha, pos }: { area: KbArea; trilha: Article[]; pos: number }) {
  const next = trilha[pos + 1];
  return (
    <div className="mb-6 space-y-3 rounded-2xl bg-primary/[0.07] p-4 ring-1 ring-primary/25">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-5" />
          </span>
          <div className="leading-tight">
            <Link
              to="/base-conhecimento/$area/trilha"
              params={{ area }}
              className="text-sm font-semibold text-foreground hover:text-primary"
            >
              Trilha de onboarding
            </Link>
            <p className="text-xs text-muted-foreground">
              Etapa {pos + 1} de {trilha.length}
            </p>
          </div>
        </div>
        {next && (
          <Link
            to="/base-conhecimento/$area/$artigo"
            params={{ area, artigo: next.id }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="hidden sm:inline">Próxima:</span>
            <span className="max-w-[16rem] truncate">{next.title}</span>
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      <ol className="flex gap-1" aria-label="Etapas da trilha">
        {trilha.map((s, i) => (
          <li key={s.id} className="min-w-0 flex-1">
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area, artigo: s.id }}
              title={`${i + 1}. ${s.title}`}
              aria-current={i === pos ? "step" : undefined}
              className={`block h-2 rounded-full transition ${
                i < pos
                  ? "bg-primary/60"
                  : i === pos
                    ? "bg-primary"
                    : "bg-muted hover:bg-primary/30"
              }`}
            >
              <span className="sr-only">{s.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Barra fina no topo mostrando quanto da página já foi lido. */
function ReadingProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setP(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5">
      <div
        className="h-full origin-left bg-primary transition-transform duration-150 motion-reduce:transition-none"
        style={{ transform: `scaleX(${p})` }}
      />
    </div>
  );
}
