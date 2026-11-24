import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Bot, ExternalLink, FileText, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./KbBlocks";
import { articleForFile, authHeader, AREA_INFO, type KbAreaData } from "./kb-api";

type Source = { fileId?: string; name: string; link: string | null; folder: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean };

export const SUGGESTIONS: Record<KbAreaData["area"], string[]> = {
  cs: [
    "Qual a ordem das tarefas do dia no CS?",
    "O que enviar no boa viagem se o cliente ainda não pagou?",
    "Como cobrar pedágio quando tem gasolina junto?",
    "Quais templates usar no onboarding de cliente recorrente?",
  ],
  comercial: [
    "O que o cliente precisa enviar para confirmar a reserva?",
    "O que fazer com um lead que é agência?",
    "Qual a franquia do seguro da SUV Executive?",
    "Quantas malas cabem na SUV média com 4 pessoas?",
  ],
};

/** Resposta da IA sem a lista "Fontes:" do final (as fontes aparecem como chips). */
const stripSources = (t: string) => t.replace(/\n+\**Fontes:?\**[\s\S]*$/i, "").trim();

export function KbChat({
  data,
  initialQuestion,
}: {
  data: KbAreaData;
  initialQuestion?: string | undefined;
}) {
  const key = `kb-chat:${data.area}`;
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(msgs.slice(-20)));
    } catch {
      /* só em memória */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, key]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgs
      .filter((m) => !m.error)
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    setMsgs((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const patch = (fn: (m: Msg) => Msg) =>
      setMsgs((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1]!)]);
    try {
      const res = await fetch("/api/kb/ask", {
        method: "POST",
        headers: { ...(await authHeader()), "content-type": "application/json" },
        body: JSON.stringify({ question: q, history, area: data.area }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.msg ?? "Erro ao perguntar");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l);
          if (ev.type === "sources") patch((m) => ({ ...m, sources: ev.sources }));
          else if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "error") throw new Error(ev.msg);
        }
      }
    } catch (e) {
      patch((m) => ({ ...m, content: (e as Error).message || "Erro ao perguntar", error: true }));
    } finally {
      setBusy(false);
    }
  }

  // Pergunta vinda da busca, da página inicial ou de "Perguntar à IA sobre este artigo".
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-3xl flex-col px-4 lg:h-screen">
      <div className="flex items-center justify-between gap-2 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Chat com IA</h1>
          <p className="text-sm text-muted-foreground">
            Responde só com os arquivos da área {AREA_INFO[data.area].short}.
          </p>
        </div>
        {msgs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setMsgs([])}
            className="text-muted-foreground"
          >
            <Trash2 className="mr-1 size-4" /> Limpar
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto pb-4">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-5 pt-10 text-center">
            <div className="rounded-2xl bg-primary/15 p-4">
              <Sparkles className="size-7 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium text-foreground">Como posso ajudar?</p>
              <p className="text-sm text-muted-foreground">
                Pergunte sobre processos, regras ou templates. Escolha uma sugestão para começar.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS[data.area].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-xl border border-border bg-muted/20 p-3 text-left text-sm text-foreground transition hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Bot className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {!m.content && busy && i === msgs.length - 1 ? (
                  <div className="flex items-center gap-1.5 pt-2" aria-label="Procurando">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="size-2 animate-bounce rounded-full bg-primary/60"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                ) : m.error ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {m.content}
                  </p>
                ) : (
                  <div className="kb-md text-[15px] leading-7 text-foreground/90">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {children}
                          </a>
                        ),
                        ul: ({ children }) => (
                          <ul className="my-2 list-disc space-y-1 pl-5 marker:text-primary/70">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-primary/70">
                            {children}
                          </ol>
                        ),
                        p: ({ children }) => <p className="my-2 first:mt-0">{children}</p>,
                        strong: ({ children }) => (
                          <strong className="font-semibold text-foreground">{children}</strong>
                        ),
                        h1: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
                        h2: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
                        h3: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
                        code: ({ children }) => (
                          <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
                            {children}
                          </code>
                        ),
                      }}
                    >
                      {stripSources(m.content)}
                    </ReactMarkdown>
                  </div>
                )}
                {!m.error && m.content && !(busy && i === msgs.length - 1) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(m.sources ?? []).map((s) => {
                      const art = s.fileId ? articleForFile(s.fileId, data) : null;
                      const cls =
                        "inline-flex max-w-[260px] items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground transition hover:border-primary";
                      return art ? (
                        <Link
                          key={s.fileId ?? s.name}
                          to="/base-conhecimento/$area/$artigo"
                          params={{ area: data.area, artigo: art.id }}
                          className={cls}
                          title={`Abrir o artigo "${art.title}"`}
                        >
                          <FileText className="size-3 shrink-0 text-primary" />
                          <span className="truncate">{art.title}</span>
                        </Link>
                      ) : (
                        <a
                          key={s.fileId ?? s.name}
                          href={s.link ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cls}
                          title={s.folder}
                        >
                          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{s.name}</span>
                        </a>
                      );
                    })}
                    <CopyButton text={stripSources(m.content)} label="Copiar resposta" />
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 bg-background pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/20 p-2 focus-within:border-primary">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Escreva sua pergunta…"
            disabled={busy}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            className="rounded-xl"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          A IA responde só com o conteúdo da base e avisa quando não encontra.
        </p>
      </form>
    </div>
  );
}
