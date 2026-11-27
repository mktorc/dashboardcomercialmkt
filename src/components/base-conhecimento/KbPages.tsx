import { useEffect, useMemo, useState } from "react";
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
import { buildIndex, quickAnswer, searchArticles } from "./kb-search";
import { MessageBlock, TemplateChip } from "./KbBlocks";
import { WelcomeTour } from "./KbWidgets";
import { templateKey } from "@/lib/kb/templates";
import { catIcon } from "./kb-icons";
import {
  AREA_INFO,
  isRecent,
  readPages,
  useKbEngajamento,
  TRILHA,
  recentViews,
  fmtDate,
  type Article,
  type KbArea,
  type KbAreaData,
} from "./kb-api";

// Atalhos do dia a dia de cada área (ids de artigos).
const QUICK: Record<KbArea, string[]> = {
  cs: [
    "rotina-de-dias-uteis",
    "rotina-de-sabado",
    "retirada-em-orlando",
    "formas-de-pagamento",
    "templates-de-atendimento",
  ],
  comercial: [
    "reserva-lancamento-hq",
    "pagamento-condicoes",
    "frota-visao-geral-comercial",
    "retirada-regras-gerais",
    "crm-templates",
    "regras-operacionais",
  ],
};

// Jornada do cliente no CS: as etapas em ordem, para atravessar de uma em uma.
const JORNADA_CS: { id: string; title: string; when: string }[] = [
  { id: "processo-de-onboarding", title: "Onboarding", when: "reserva nova" },
  { id: "conferencia-e-orientacoes", title: "Conferência", when: "7 a 10 dias antes" },
  { id: "boa-viagem", title: "Boa viagem", when: "1 dia antes" },
  { id: "boas-vindas-cs", title: "Boas-vindas", when: "chegou ontem" },
  { id: "processo-48-horas", title: "48 horas", when: "devolve em 2 dias" },
  { id: "pedagios-pos-devolucao", title: "Pedágios", when: "devolveu há 3 dias" },
];

/** Seta de tendência: visualizações dos últimos 7 dias contra os 7 anteriores. */
function TrendTag({ t }: { t?: { now: number; before: number } | undefined }) {
  if (!t || (t.now === 0 && t.before === 0)) return null;
  const up = t.now > t.before;
  const same = t.now === t.before;
  return (
    <span
      title={`${t.now} na semana · ${t.before} na anterior`}
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        same
          ? "bg-muted text-muted-foreground"
          : up
            ? "bg-primary/15 text-primary"
            : "bg-amber-500/15 text-amber-400"
      }`}
    >
      {same ? "=" : up ? "▲" : "▼"} {t.now}
    </span>
  );
}

function ArticleRow({ a, area, meta }: { a: Article; area: KbArea; meta: React.ReactNode }) {
  return (
    <Link
      to="/base-conhecimento/$area/$artigo"
      params={{ area, artigo: a.id }}
      className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm text-foreground group-hover:text-primary">{a.title}</span>
        {isRecent(a.updatedAt) && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            Novo
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </Link>
  );
}

export function KbHome({ data }: { data: KbAreaData }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const index = useMemo(() => buildIndex(data.articles), [data.articles]);
  const hits = useMemo(() => searchArticles(index, q, 6), [index, q]);
  const answer = useMemo(() => quickAnswer(data.articles, q), [data.articles, q]);
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
  const eng = useKbEngajamento(data.area);
  // "Agora": a página do dia. CS no sábado tem rotina própria.
  const hoje = new Date();
  const hora = hoje.getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const agoraId =
    data.area === "cs"
      ? hoje.getDay() === 6
        ? "rotina-de-sabado"
        : "rotina-de-dias-uteis"
      : "reserva-lancamento-hq";
  const agora = byId.get(agoraId);
  const [continuar, setContinuar] = useState<Article[]>([]);
  const trilha = TRILHA[data.area].map((id) => byId.get(id)).filter((a): a is Article => !!a);
  const [lidasSet, setLidasSet] = useState<Set<string>>(new Set());
  useEffect(() => setLidasSet(new Set(readPages(data.area))), [data.area]);
  const lidas = trilha.filter((a) => lidasSet.has(a.id)).length;
  useEffect(() => {
    setContinuar(
      recentViews(data.area)
        .map((id) => byId.get(id))
        .filter((a): a is Article => !!a && a.id !== agoraId)
        .slice(0, 4),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.area, data.articles]);

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
      <WelcomeTour />
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
              {answer && (
                <Link
                  to="/base-conhecimento/$area/$artigo"
                  params={{ area: data.area, artigo: answer.article.id }}
                  className="mb-1 flex items-center gap-3 rounded-lg bg-primary/15 px-3 py-3 hover:bg-primary/25"
                >
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    {answer.value}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {answer.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      em {answer.article.title}
                    </span>
                  </span>
                </Link>
              )}
              {hits.length === 0 && !answer ? (
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

      {(agora || continuar.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          {agora && (
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area: data.area, artigo: agora.id }}
              className="group flex flex-col justify-between gap-4 rounded-2xl bg-primary p-5 text-primary-foreground transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm text-primary-foreground/80">
                {saudacao}! Comece por aqui hoje
              </span>
              <span className="flex items-end justify-between gap-3">
                <span>
                  <span className="block text-2xl font-bold leading-tight">{agora.title}</span>
                  <span className="mt-1 block text-sm text-primary-foreground/85">
                    {agora.summary}
                  </span>
                </span>
                <ArrowRight className="size-6 shrink-0 transition group-hover:translate-x-1 motion-reduce:transition-none" />
              </span>
            </Link>
          )}
          {continuar.length > 0 && (
            <div className="rounded-2xl bg-muted/25 p-5">
              <p className="mb-2 text-sm font-semibold text-foreground">Continue de onde parou</p>
              <ul className="space-y-0.5">
                {continuar.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/base-conhecimento/$area/$artigo"
                      params={{ area: data.area, artigo: a.id }}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-foreground/90 transition hover:bg-muted/50 hover:text-primary"
                    >
                      <span className="truncate">{a.title}</span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {quick.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
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

      {trilha.length > 0 && (
        <section className="space-y-3 rounded-2xl bg-muted/20 p-5 ring-1 ring-border/60">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Trilha de onboarding</h2>
              <p className="text-sm text-muted-foreground">
                Para quem está começando: leia nesta ordem e termine com o teste.
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums text-primary">
              {lidas} de {trilha.length} lidas
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${(lidas / trilha.length) * 100}%` }}
            />
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {trilha.map((a, i) => {
              const ok = lidasSet.has(a.id);
              return (
                <li key={a.id}>
                  <Link
                    to="/base-conhecimento/$area/$artigo"
                    params={{ area: data.area, artigo: a.id }}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-muted/50"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        ok ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ok ? "✓" : i + 1}
                    </span>
                    <span className={ok ? "text-muted-foreground" : "text-foreground"}>
                      {a.title}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {data.area === "cs" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Jornada do cliente</h2>
          <p className="text-sm text-muted-foreground">
            Cada reserva passa por estas etapas. Clique para abrir o passo a passo da etapa.
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {JORNADA_CS.filter((j) => byId.has(j.id)).map((j, i) => (
              <li key={j.id}>
                <Link
                  to="/base-conhecimento/$area/$artigo"
                  params={{ area: data.area, artigo: j.id }}
                  className="group relative flex h-full flex-col gap-0.5 rounded-lg border border-primary/30 bg-primary/5 p-3 transition hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-sm font-semibold text-foreground group-hover:text-primary">
                    {j.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{j.when}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Tudo o que tem na base</h2>
        <div role="group" aria-label="Filtrar por categoria" className="flex flex-wrap gap-2">
          {[{ id: "", title: "Todas" }, ...data.categories.filter((c) => !c.parent)].map((c) => (
            <button
              key={c.id || "todas"}
              type="button"
              aria-pressed={catFilter === c.id}
              onClick={() => setCatFilter(c.id)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                catFilter === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-foreground/80 hover:bg-primary/15"
              }`}
            >
              {c.id && catIcon(c.title, "size-3.5")}
              {c.title}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.categories
            .filter((c) => !c.parent && (!catFilter || c.id === catFilter))
            .map((c) => {
              const kids = new Set([
                c.id,
                ...data.categories.filter((k) => k.parent === c.id).map((k) => k.id),
              ]);
              const arts = data.articles.filter((a) => kids.has(a.category));
              if (!arts.length) return null;
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-xl bg-muted/20 p-4 ring-1 ring-border/60 transition hover:ring-primary/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      {catIcon(c.title, "size-5")}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground">{c.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {arts.length} {arts.length === 1 ? "página" : "páginas"}
                      </span>
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {arts.slice(0, catFilter ? arts.length : 4).map((a) => (
                      <li key={a.id}>
                        <Link
                          to="/base-conhecimento/$area/$artigo"
                          params={{ area: data.area, artigo: a.id }}
                          className="block truncate rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-primary"
                        >
                          {a.title}
                        </Link>
                      </li>
                    ))}
                    {!catFilter && arts.length > 4 && (
                      <li className="px-1 text-xs text-muted-foreground">
                        e mais {arts.length - 4} no menu ao lado
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
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
                    <span className="inline-flex items-center gap-2">
                      <TrendTag t={eng.data?.trend[a.id]} />
                      <span className="inline-flex items-center gap-1">
                        <Eye className="size-3" />
                        {views(a)}
                      </span>
                    </span>
                  }
                />
              ))
            )}
          </Card>
        </section>
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Clock className="size-4" /> Atualizados recentemente
          </h2>
          <Card className="p-2">
            {recent.map((a) => (
              <ArticleRow key={a.id} a={a} area={data.area} meta={fmtDate(a.updatedAt)} />
            ))}
          </Card>
        </section>
      </div>

      {data.admin && !!eng.data?.notes.length && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">O que faltou nas páginas</h2>
          <p className="text-sm text-muted-foreground">
            Quem marcou &ldquo;Isso ajudou? Não&rdquo; e disse por quê. Só administradores veem.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {eng.data.notes.slice(0, 8).map((n, i) => (
              <Link
                key={i}
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: n.articleId }}
                className="space-y-1 rounded-xl bg-muted/25 p-3 transition hover:bg-muted/45"
              >
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{byId.get(n.articleId)?.title ?? n.articleId}</span>
                  <span className="shrink-0">{fmtDate(n.at)}</span>
                </span>
                {n.reason && (
                  <span className="block text-sm font-medium text-primary">{n.reason}</span>
                )}
                {n.note && <span className="block text-sm text-foreground/90">{n.note}</span>}
                {n.name && <span className="block text-xs text-muted-foreground">{n.name}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

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
