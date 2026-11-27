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
  ChevronRight,
  GraduationCap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildIndex, quickAnswer, searchArticles } from "./kb-search";
import { MessageBlock, TemplateChip } from "./KbBlocks";
import { WelcomeTour } from "./KbWidgets";
import { Certificado } from "./KbCertificado";
import { supabase } from "@/integrations/supabase/client";
import { templateKey } from "@/lib/kb/templates";
import { catIcon } from "./kb-icons";
import {
  AREA_INFO,
  isRecent,
  readPages,
  useKbEngajamento,
  useLogMiss,
  CURADORIA_EM,
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
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </Link>
  );
}

export function KbHome({ data }: { data: KbAreaData }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const index = useMemo(() => buildIndex(data.articles), [data.articles]);
  const hits = useMemo(() => searchArticles(index, q, 6), [index, q]);
  const answer = useMemo(() => quickAnswer(data.articles, q), [data.articles, q]);
  useLogMiss(data.area, q, !hits.length && !answer);
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
  const piores = [...data.articles]
    .filter((a) => (data.stats[a.id]?.down ?? 0) > 0)
    .sort((a, b) => (data.stats[b.id]?.down ?? 0) - (data.stats[a.id]?.down ?? 0))
    .slice(0, 5);
  const driveMudou = data.articles.filter(
    (a) => a.curated && a.updatedAt.slice(0, 10) > CURADORIA_EM,
  );
  const tplNomes = [
    ...new Set(
      data.articles.flatMap((a) => a.blocks.flatMap((b) => (b.t === "tags" ? b.items : []))),
    ),
  ];
  const tplKeys = new Set(data.templates.map((t) => templateKey(t.title)));
  const semTexto = tplNomes.filter((n) => !tplKeys.has(templateKey(n))).length;
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
  const proxTrilha = trilha.find((a) => !lidasSet.has(a.id));
  const catById = new Map(data.categories.map((c) => [c.id, c]));
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
      <WelcomeTour area={data.area} firstId={trilha[0]?.id} />
      <section className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {saudacao}! O que você precisa?
          </h1>
          <p className="text-sm text-muted-foreground">{info.greeting}</p>
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
                  Nenhum artigo. Aperte Enter para perguntar à ORCI.
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

      {/* Um único próximo passo: a trilha enquanto não termina; depois, a página do dia. */}
      <section className="space-y-3">
        {proxTrilha ? (
          <Link
            to="/base-conhecimento/$area/$artigo"
            params={{ area: data.area, artigo: proxTrilha.id }}
            className="group flex items-center gap-4 rounded-2xl bg-primary p-4 text-primary-foreground transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
              <GraduationCap className="size-6" />
            </span>
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block text-xs font-medium text-primary-foreground/75">
                {lidas === 0
                  ? "Comece sua trilha de onboarding"
                  : "Continue sua trilha de onboarding"}{" "}
                · etapa {trilha.indexOf(proxTrilha) + 1} de {trilha.length}
              </span>
              <span className="block truncate text-lg font-bold leading-tight sm:text-xl">
                {proxTrilha.title}
              </span>
              <span className="block h-1.5 max-w-xs overflow-hidden rounded-full bg-primary-foreground/20">
                <span
                  className="block h-full rounded-full bg-primary-foreground"
                  style={{ width: `${(lidas / trilha.length) * 100}%` }}
                />
              </span>
            </span>
            <ArrowRight className="size-6 shrink-0 transition group-hover:translate-x-1 motion-reduce:transition-none" />
          </Link>
        ) : (
          agora && (
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area: data.area, artigo: agora.id }}
              className="group flex items-center gap-4 rounded-2xl bg-primary p-4 text-primary-foreground transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15">
                <CalendarClock className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-primary-foreground/75">
                  Comece por aqui hoje
                </span>
                <span className="block truncate text-lg font-bold leading-tight sm:text-xl">
                  {agora.title}
                </span>
              </span>
              <ArrowRight className="size-6 shrink-0 transition group-hover:translate-x-1 motion-reduce:transition-none" />
            </Link>
          )
        )}
        {continuar.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Vistas por último:</span>
            {continuar.slice(0, 3).map((a) => (
              <Link
                key={a.id}
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: a.id }}
                className="inline-flex min-h-8 max-w-[16rem] items-center gap-1.5 rounded-full bg-muted/50 px-3 text-[13px] text-foreground/90 transition hover:bg-primary/15 hover:text-foreground"
              >
                <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.title}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {quick.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Atalhos do dia a dia</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {quick.map((a) => {
              const c = catById.get(a.category);
              const top = c?.parent ? catById.get(c.parent) : c;
              return (
                <Link
                  key={a.id}
                  to="/base-conhecimento/$area/$artigo"
                  params={{ area: data.area, artigo: a.id }}
                  title={a.summary}
                  className="group flex min-h-16 items-center gap-3 rounded-xl bg-muted/25 p-3 ring-1 ring-border/60 transition hover:bg-muted/40 hover:ring-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {catIcon(top?.title ?? "", "size-[18px]")}
                  </span>
                  <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:text-primary">
                    {a.title}
                  </span>
                </Link>
              );
            })}
          </div>
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
        <h2 className="text-base font-semibold text-foreground">Por assunto</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.categories
            .filter((c) => !c.parent)
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
                    {arts.slice(0, 4).map((a) => (
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
                    {arts.length > 4 && (
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
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
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
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Clock className="size-4" /> Atualizados recentemente
          </h2>
          <Card className="p-2">
            {recent.map((a) => (
              <ArticleRow key={a.id} a={a} area={data.area} meta={fmtDate(a.updatedAt)} />
            ))}
          </Card>
        </section>
      </div>

      {data.admin && (
        <details className="group space-y-3 rounded-2xl bg-muted/15 p-4 ring-1 ring-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
            Saúde da base
            <span className="text-xs font-normal text-muted-foreground">só administradores</span>
          </summary>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-2xl bg-muted/25 p-4">
              <p className="font-semibold text-foreground">Mais votos &ldquo;Não ajudou&rdquo;</p>
              {piores.length ? (
                piores.map((a) => (
                  <ArticleRow
                    key={a.id}
                    a={a}
                    area={data.area}
                    meta={`${data.stats[a.id]?.down ?? 0} não`}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum voto negativo ainda.</p>
              )}
            </div>
            <div className="space-y-2 rounded-2xl bg-muted/25 p-4">
              <p className="font-semibold text-foreground">Buscas que não acharam nada</p>
              {eng.data?.misses.length ? (
                <div className="flex flex-wrap gap-2">
                  {eng.data.misses.slice(0, 12).map((m) => (
                    <span
                      key={m.q}
                      className="rounded-full bg-muted/60 px-3 py-1 text-sm text-foreground/90"
                    >
                      {m.q} <span className="text-xs text-muted-foreground">×{m.hits}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma ainda: as buscas sem resultado aparecem aqui.
                </p>
              )}
            </div>
            <div className="space-y-2 rounded-2xl bg-muted/25 p-4">
              <p className="font-semibold text-foreground">Revisar: o arquivo do Drive mudou</p>
              {driveMudou.length ? (
                driveMudou.map((a) => (
                  <ArticleRow key={a.id} a={a} area={data.area} meta={fmtDate(a.updatedAt)} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma página revisada teve o arquivo alterado depois.
                </p>
              )}
            </div>
            <div className="space-y-2 rounded-2xl bg-muted/25 p-4">
              <p className="font-semibold text-foreground">Templates sem texto</p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {semTexto}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  de {tplNomes.length}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Ficam cinza na base. Cadastre o texto no documento &ldquo;Templates de
                mensagem&rdquo; do Drive.
              </p>
            </div>
          </div>
        </details>
      )}

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

      <Link
        to="/base-conhecimento/$area/chat"
        params={{ area: data.area }}
        search={q.trim() ? { q } : {}}
        className="group flex items-center gap-3 rounded-2xl bg-muted/25 p-4 ring-1 ring-border/60 transition hover:ring-primary/50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            Não achou? Pergunte à ORCI
          </span>
          <span className="block text-xs text-muted-foreground">
            Ela responde com base nos arquivos da área e mostra as fontes.
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </Link>
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
  // Sem o documento "Templates de mensagem": junta os nomes citados nas páginas (listas de
  // templates e chips das etapas), agrupados pela página onde aparecem, sem repetir.
  const seen = new Set<string>();
  const names = data.articles
    .map((a) => {
      const raw = a.blocks.flatMap((b) =>
        b.t === "tags"
          ? b.items
          : b.t === "steps"
            ? b.items.flatMap((st) => [
                ...(st.tpl ?? []),
                ...(st.sub ?? []).flatMap((x) => x.tpl ?? []),
              ])
            : [],
      );
      const items = raw.filter((i) => {
        const k = templateKey(i);
        if (seen.has(k)) return false;
        seen.add(k);
        return !nq || i.toLowerCase().includes(nq);
      });
      return { title: a.title, id: a.id, items };
    })
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
          <section key={g.id} className="space-y-2 rounded-xl bg-muted/20 p-4">
            <Link
              to="/base-conhecimento/$area/$artigo"
              params={{ area: data.area, artigo: g.id }}
              className="text-sm font-semibold text-foreground hover:text-primary"
            >
              {g.title}
            </Link>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((i) => (
                <TemplateChip key={i} name={i} tpl={byKey.get(templateKey(i))} />
              ))}
            </div>
          </section>
        ))}
      {!data.templates.length && names.length === 0 && q.trim() && (
        <p className="text-sm text-muted-foreground">Nenhum template com “{q}”.</p>
      )}
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

/** Trilha de onboarding: a ordem de leitura para quem está começando, com o progresso. */
export function KbTrilhaPage({ data }: { data: KbAreaData }) {
  const byId = new Map(data.articles.map((a) => [a.id, a]));
  const trilha = TRILHA[data.area].map((id) => byId.get(id)).filter((a): a is Article => !!a);
  const [lidasSet, setLidasSet] = useState<Set<string>>(new Set());
  useEffect(() => setLidasSet(new Set(readPages(data.area))), [data.area]);
  const lidas = trilha.filter((a) => lidasSet.has(a.id)).length;
  const prox = trilha.find((a) => !lidasSet.has(a.id));
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <GraduationCap className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Trilha de onboarding
          </h1>
          <p className="text-sm text-muted-foreground">
            Para quem está começando: leia nesta ordem e termine com o teste. Cada página aberta
            conta como lida.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${(lidas / Math.max(1, trilha.length)) * 100}%` }}
              />
            </div>
            <span className="text-sm font-semibold tabular-nums text-primary">
              {lidas} de {trilha.length}
            </span>
          </div>
        </div>
      </header>

      <ol className="relative space-y-2 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-0.5 before:bg-border">
        {trilha.map((a, i) => {
          const ok = lidasSet.has(a.id);
          const atual = a.id === prox?.id;
          return (
            <li key={a.id} className="relative">
              <Link
                to="/base-conhecimento/$area/$artigo"
                params={{ area: data.area, artigo: a.id }}
                className={`group flex items-center gap-4 rounded-xl p-2 pr-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  atual ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/40"
                }`}
              >
                <span
                  className={`relative z-10 flex size-6 shrink-0 translate-x-[7px] items-center justify-center rounded-full text-xs font-semibold ring-4 ring-background ${
                    ok || atual
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ok ? "✓" : i + 1}
                </span>
                <span className="min-w-0 flex-1 pl-2">
                  <span
                    className={`block text-sm font-medium ${ok ? "text-muted-foreground" : "text-foreground"} group-hover:text-primary`}
                  >
                    {a.title}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{a.summary}</span>
                </span>
                {atual ? (
                  <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    {lidas === 0 ? "Começar" : "Continuar"}
                  </span>
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      {!prox && trilha.length > 0 && <Certificado area={data.area} />}
    </div>
  );
}
