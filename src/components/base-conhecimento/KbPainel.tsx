// Painel do gestor (só administradores): o que perguntam à ORCI, quem pergunta, o que a base não
// respondeu, notas das respostas e o progresso de cada pessoa na trilha e no teste.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  CheckCircle2,
  GraduationCap,
  HelpCircle,
  MessageSquareWarning,
  ThumbsDown,
  Users,
} from "lucide-react";
import { fmtDate, TRILHA, useKbEngajamento, type KbAreaData } from "./kb-api";

const dias = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl bg-muted/25 p-4 ring-1 ring-border/60">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function KbPainel({ data }: { data: KbAreaData }) {
  const eng = useKbEngajamento(data.area);
  const [tab, setTab] = useState<"orci" | "equipe">("orci");
  const ai = eng.data?.ai;
  const team = eng.data?.team ?? [];
  const trilha = TRILHA[data.area].filter((id) => data.articles.some((a) => a.id === id));
  const ranking = eng.data?.ranking ?? [];

  if (!data.admin)
    return (
      <p className="p-10 text-center text-muted-foreground">Só administradores veem o painel.</p>
    );

  const tabs = [
    { id: "orci", label: "Perguntas à ORCI", icon: BarChart3 },
    { id: "equipe", label: "Equipe e onboarding", icon: Users },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Painel do gestor
        </h1>
        <p className="text-sm text-muted-foreground">
          Últimos 30 dias da área. Só administradores veem esta página.
        </p>
      </header>

      <div role="tablist" className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-foreground/80 hover:bg-muted/70"
            }`}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {eng.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {tab === "orci" && ai && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Perguntas" value={ai.total} />
            <Stat label="Respondidas pela base" value={`${ai.answeredPct}%`} />
            <Stat label="Respostas boas" value={ai.up} sub="👍 de quem perguntou" />
            <Stat label="Respostas ruins" value={ai.down} sub="👎 de quem perguntou" />
          </div>

          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <BarChart3 className="size-4 text-primary" /> O que mais perguntam
            </h2>
            {ai.top.length ? (
              <ol className="space-y-1.5 rounded-2xl bg-muted/20 p-3 ring-1 ring-border/60">
                {ai.top.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                    <span className="w-6 text-right text-sm font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 rounded bg-primary/15"
                        style={{ width: `${(t.n / ai.top[0]!.n) * 100}%` }}
                      />
                      <span className="relative block truncate px-2 py-1 text-sm text-foreground">
                        {t.q}
                      </span>
                    </span>
                    {t.unanswered > 0 && (
                      <span
                        title="Vezes em que a base não tinha a resposta"
                        className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500"
                      >
                        {t.unanswered} sem resposta
                      </span>
                    )}
                    <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                      {t.n}×
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma pergunta ainda. Elas aparecem aqui assim que o time usar a ORCI.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Users className="size-4 text-primary" /> Quem pergunta
            </h2>
            {ai.people.length ? (
              <div className="overflow-x-auto rounded-2xl ring-1 ring-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Pessoa</th>
                      <th className="px-3 py-2 text-right font-medium">Perguntas</th>
                      <th className="px-3 py-2 text-right font-medium">Sem resposta</th>
                      <th className="px-3 py-2 text-right font-medium">👍</th>
                      <th className="px-3 py-2 text-right font-medium">👎</th>
                      <th className="px-3 py-2 text-right font-medium">Última</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ai.people.map((p) => (
                      <tr key={p.name} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.unanswered}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.up}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.down}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {fmtDate(p.last)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguém perguntou ainda.</p>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <QList
              icon={<MessageSquareWarning className="size-4 text-amber-500" />}
              title="A base não tinha a resposta"
              hint="Bons assuntos para criar ou completar páginas."
              rows={ai.unanswered}
            />
            <QList
              icon={<ThumbsDown className="size-4 text-destructive" />}
              title="Respostas marcadas como ruins"
              hint="Confira se a página de origem está certa."
              rows={ai.disliked}
            />
          </div>
        </div>
      )}

      {tab === "equipe" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Pessoas na base" value={team.length} />
            <Stat
              label="Trilha concluída"
              value={team.filter((t) => trilha.every((id) => t.read.includes(id))).length}
            />
            <Stat
              label="Passaram no teste"
              value={team.filter((t) => t.quiz && t.quiz.best / t.quiz.total >= 0.75).length}
              sub="75% ou mais"
            />
            <Stat label="Etapas da trilha" value={trilha.length} />
          </div>
          {team.length ? (
            <div className="overflow-x-auto rounded-2xl ring-1 ring-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pessoa</th>
                    <th className="px-3 py-2 font-medium">Trilha</th>
                    <th className="px-3 py-2 text-right font-medium">Teste</th>
                    <th className="px-3 py-2 text-right font-medium">Na base há</th>
                    <th className="px-3 py-2 text-right font-medium">Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {[...team]
                    .map((t) => ({
                      ...t,
                      lidas: trilha.filter((id) => t.read.includes(id)).length,
                    }))
                    .sort((a, b) => b.lidas - a.lidas)
                    .map((t) => {
                      const pct = trilha.length ? t.lidas / trilha.length : 0;
                      const nota = t.quiz ? t.quiz.best / t.quiz.total : null;
                      return (
                        <tr key={t.name} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              {t.name}
                              {pct === 1 && nota !== null && nota >= 0.75 && (
                                <GraduationCap
                                  className="size-4 text-primary"
                                  aria-label="Onboarding concluído"
                                />
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-primary"
                                  style={{ width: `${pct * 100}%` }}
                                />
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {t.lidas}/{trilha.length}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.quiz ? (
                              <span
                                className={
                                  nota! >= 0.75 ? "font-semibold text-primary" : "text-amber-500"
                                }
                              >
                                {t.quiz.best}/{t.quiz.total}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">não fez</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {dias(t.firstAt)} dias
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {fmtDate(t.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O progresso começa a aparecer conforme cada pessoa abre a base.
            </p>
          )}
          {ranking.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <CheckCircle2 className="size-4 text-primary" /> Ranking do teste
              </h2>
              <ol className="space-y-1 rounded-2xl bg-muted/20 p-3 ring-1 ring-border/60">
                {ranking.map((r, i) => (
                  <li key={r.name} className="flex items-center gap-3 px-2 py-1 text-sm">
                    <span className="w-6 text-right font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-foreground">{r.name}</span>
                    <span className="tabular-nums text-foreground">
                      {r.best}/{r.total}
                    </span>
                    <span className="w-20 text-right text-xs text-muted-foreground">
                      {r.tries} {r.tries === 1 ? "tentativa" : "tentativas"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HelpCircle className="size-3.5" /> As perguntas só começaram a ser registradas agora; as
        anteriores não ficaram salvas.{" "}
        <Link to="/base-conhecimento/$area" params={{ area: data.area }} className="text-primary">
          Voltar ao início
        </Link>
      </p>
    </div>
  );
}

function QList({
  icon,
  title,
  hint,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  rows: { q: string; name: string; at: string }[];
}) {
  return (
    <section className="space-y-2 rounded-2xl bg-muted/20 p-4 ring-1 ring-border/60">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon} {title}
      </h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {rows.length ? (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg bg-background/40 px-3 py-2">
              <p className="text-sm text-foreground">{r.q}</p>
              <p className="text-xs text-muted-foreground">
                {r.name} · {fmtDate(r.at)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nada por aqui.</p>
      )}
    </section>
  );
}
