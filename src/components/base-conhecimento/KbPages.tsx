import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CalendarClock,
  Clock,
  Eye,
  HeartHandshake,
  MessageSquare,
  MessagesSquare,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildIndex, searchArticles } from "./kb-search";
import { MessageBlock, TemplateChip } from "./KbBlocks";
import { templateKey } from "@/lib/kb/templates";
import { AREA_INFO, fmtDate, type Article, type KbArea, type KbAreaData } from "./kb-api";

// Atalhos do dia a dia de cada área (ids de artigos).
const QUICK: Record<KbArea, string[]> = {
  cs: ["rotina-diaria-cs", "onboarding", "boa-viagem", "48-horas", "pedagios"],
  comercial: [
    "condicoes-reserva",
    "regras-operacionais-comercial",
    "pagamentos",
    "frota-categorias",
    "cancelamento-reembolso",
  ],
};

function ArticleRow({ a, area, meta }: { a: Article; area: KbArea; meta: React.ReactNode }) {
  return (
    <Link
      to="/base-conhecimento/$area/$artigo"
      params={{ area, artigo: a.id }}
      className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-muted/40"
    >
      <span className="truncate text-sm text-foreground group-hover:text-primary">{a.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </Link>
  );
}

export function KbHome({ data }: { data: KbAreaData }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const index = useMemo(() => buildIndex(data.articles), [data.articles]);
  const hits = useMemo(() => searchArticles(index, q, 6), [index, q]);
  const byId = new Map(data.articles.map((a) => [a.id, a]));
  const quick = QUICK[data.area].map((id) => byId.get(id)).filter(Boolean) as Article[];
  const views = (a: Article) => data.stats[a.id]?.views ?? 0;
  const mostViewed = [...data.articles]
    .filter((a) => views(a) > 0)
    .sort((a, b) => views(b) - views(a))
    .slice(0, 5);
  const recent = [...data.articles]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const info = AREA_INFO[data.area];

  const submit = () => {
    if (hits[0])
      void navigate({
        to: "/base-conhecimento/$area/$artigo",
        params: { area: data.area, artigo: hits[0].article.id },
      });
    else if (q.trim())
      void navigate({
        to: "/base-conhecimento/$area/chat",
        params: { area: data.area },
        search: { q },
      });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:px-6 lg:max-w-5xl lg:px-8 lg:py-12 2xl:max-w-7xl">
      <section className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">{info.title}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Olá! Como podemos ajudar?
          </h1>
          <p className="text-base text-muted-foreground">{info.greeting}</p>
        </div>
        <div className="relative">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30"
          >
            <Search className="size-5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Como faço para…?"
              className="h-14 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              aria-label="Buscar na base"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
              ⌘K
            </kbd>
          </form>
          {q.trim() && (
            <Card className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden p-1 shadow-xl">
              {hits.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  Nenhum artigo. Aperte Enter para perguntar à IA.
                </p>
              ) : (
                hits.map((h) => (
                  <Link
                    key={h.article.id}
                    to="/base-conhecimento/$area/$artigo"
                    params={{ area: data.area, artigo: h.article.id }}
                    className="block rounded-md px-3 py-2 hover:bg-muted/50"
                  >
                    <p className="text-sm font-medium text-foreground">{h.article.title}</p>
                    {h.snippet && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {h.snippet.before}
                        <mark className="rounded bg-primary/30 px-0.5 text-foreground">
                          {h.snippet.match}
                        </mark>
                        {h.snippet.after}
                      </p>
                    )}
                  </Link>
                ))
              )}
            </Card>
          )}
        </div>
      </section>

      {quick.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="size-4" /> Dia a dia
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {quick.map((a) => (
              <Link
                key={a.id}
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: a.id }}
                className="group flex flex-col gap-1 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between text-sm font-medium text-foreground">
                  {a.title}
                  <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{a.summary}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="size-4" /> Mais acessados
          </h2>
          <Card className="p-2">
            {mostViewed.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Os artigos mais lidos vão aparecer aqui.
              </p>
            ) : (
              mostViewed.map((a) => (
                <ArticleRow
                  key={a.id}
                  a={a}
                  area={data.area}
                  meta={
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3" />
                      {views(a)}
                    </span>
                  }
                />
              ))
            )}
          </Card>
        </section>
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-4" /> Atualizados recentemente
          </h2>
          <Card className="p-2">
            {recent.map((a) => (
              <ArticleRow key={a.id} a={a} area={data.area} meta={fmtDate(a.updatedAt)} />
            ))}
          </Card>
        </section>
      </div>

      <section className="flex flex-col items-start gap-4 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-transparent p-6 sm:flex-row sm:items-center">
        <div className="rounded-xl bg-primary/20 p-3">
          <Sparkles className="size-6 text-primary" />
        </div>
        <div className="flex-1 space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Pergunte à IA</h2>
          <p className="text-sm text-muted-foreground">
            Não achou? A IA responde com base nos arquivos da área e cita as fontes.
          </p>
        </div>
        <Link
          to="/base-conhecimento/$area/chat"
          params={{ area: data.area }}
          search={q.trim() ? { q } : {}}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <MessageSquare className="size-4" /> {q.trim() ? "Perguntar isso" : "Abrir o chat"}
        </Link>
      </section>
    </div>
  );
}

export function KbTemplatesPage({ data }: { data: KbAreaData }) {
  const [q, setQ] = useState("");
  const nq = q.toLowerCase();
  const full = data.templates.filter(
    (t) => !nq || `${t.title} ${t.text}`.toLowerCase().includes(nq),
  );
  const byKey = new Map(data.templates.map((t) => [templateKey(t.title), t]));
  // Sem o documento "Templates de mensagem": mostra só os nomes que estão nos artigos.
  const names = data.articles
    .filter((a) => a.category === "templates")
    .flatMap(
      (a) =>
        a.blocks.filter((b) => b.t === "tags") as { t: "tags"; title?: string; items: string[] }[],
    )
    .map((b) => ({
      title: b.title ?? "Templates",
      items: b.items.filter((i) => !nq || i.toLowerCase().includes(nq)),
    }))
    .filter((g) => g.items.length);
  return (
    <div className="mx-auto max-w-[760px] space-y-6 px-4 py-8 sm:px-6 lg:max-w-5xl lg:px-8 lg:py-12 2xl:max-w-7xl">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <MessagesSquare className="size-6 text-primary" /> Templates
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.templates.length
            ? "Mensagens prontas do documento “Templates de mensagem” no Drive. As variáveis aparecem destacadas."
            : "Nomes dos atalhos usados em cada etapa. Quando o documento “Templates de mensagem” existir no Drive, o texto de cada um aparece aqui com o botão Copiar."}
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 focus-within:border-primary">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar templates…"
          className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {full.length > 0 && (
        <div className="space-y-3">
          {full.map((t) => (
            <MessageBlock key={t.title} title={t.title} text={t.text} />
          ))}
        </div>
      )}
      {!data.templates.length &&
        names.map((g) => (
          <section key={g.title} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{g.title}</h2>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((i) => (
                <TemplateChip key={i} name={i} tpl={byKey.get(templateKey(i))} />
              ))}
            </div>
          </section>
        ))}
      {data.templates.length > 0 && full.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum template com “{q}”.</p>
      )}
    </div>
  );
}

const AREA_ICON: Record<KbArea, typeof Briefcase> = { comercial: Briefcase, cs: HeartHandshake };

export function KbAreaChooser({
  areas,
  counts,
  loading,
}: {
  areas: KbArea[];
  counts: Record<string, number>;
  loading: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-8 bg-background px-4 py-12">
      <div className="space-y-2 text-center">
        <div className="mx-auto w-fit rounded-2xl bg-primary/15 p-3">
          <BookOpen className="size-7 text-primary" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Base de Conhecimento
        </h1>
        <p className="text-muted-foreground">
          Escolha a área para ver processos, regras e templates.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {loading
          ? [0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)
          : (["comercial", "cs"] as KbArea[])
              .filter((a) => areas.includes(a))
              .map((a) => {
                const Icon = AREA_ICON[a];
                return (
                  <Link
                    key={a}
                    to="/base-conhecimento/$area"
                    params={{ area: a }}
                    className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-primary hover:shadow-lg hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="w-fit rounded-xl bg-primary/15 p-3">
                      <Icon className="size-7 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-xl font-semibold text-foreground">
                        {AREA_INFO[a].title}
                      </h2>
                      <p className="text-sm text-muted-foreground">{AREA_INFO[a].description}</p>
                    </div>
                    <div className="mt-auto flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{counts[a] ?? 0} artigos</span>
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        Entrar{" "}
                        <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                );
              })}
      </div>
      <Link to="/app" className="mx-auto text-sm text-muted-foreground hover:text-foreground">
        Voltar aos módulos
      </Link>
    </div>
  );
}
