import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, FileText, RefreshCw, Send, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { guardPage } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/base-conhecimento")({
  head: () => ({
    meta: [
      { title: "Base de Conhecimento | Orlando Rent Car Analytics" },
      { name: "description", content: "Dúvidas do time respondidas com os arquivos do Drive." },
      { property: "og:title", content: "Base de Conhecimento | Orlando Rent Car Analytics" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => guardPage("base-conhecimento"),
  component: BaseConhecimentoPage,
});

type Source = { name: string; link: string | null; folder: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean };
type KbFile = {
  file_id: string;
  name: string;
  folder: string;
  web_view_link: string | null;
  mime_type: string;
  modified_time: string | null;
  status: "indexado" | "ignorado" | "vazio" | "erro";
  detail: string | null;
  chunks: number;
  indexed_at: string;
};
type SyncRun = {
  started_at: string;
  finished_at: string | null;
  status: string;
  origem: string;
  stats: Record<string, unknown>;
};

const SUGESTOES = [
  "Qual é a política de cancelamento?",
  "Quais documentos o cliente precisa apresentar na retirada?",
  "Como funciona o seguro incluso nas reservas?",
  "Qual o procedimento para devolução fora do horário?",
];

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

async function api<T>(path: string, method = "GET"): Promise<T> {
  const res = await fetch(`/api/kb/${path}`, { method, headers: await authHeader() });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.msg ?? "Erro na requisição");
  return json as T;
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const HISTORY_KEY = "kb-chat";

function BaseConhecimentoPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Base de Conhecimento</h1>
          <p className="text-sm text-muted-foreground">
            Pergunte e a IA responde só com o que está nos arquivos das pastas do Drive.
          </p>
        </div>
        <Tabs defaultValue="chat">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="arquivos">Arquivos</TabsTrigger>
          </TabsList>
          <TabsContent value="chat">
            <ChatTab />
          </TabsContent>
          <TabsContent value="arquivos">
            <ArquivosTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------

/** Mostra a resposta com links markdown [texto](url) clicáveis (só http/https). */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={m.index}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </div>
  );
}

function ChatTab() {
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-20)));
    } catch {
      /* sem armazenamento: segue só em memória */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

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
        body: JSON.stringify({ question: q, history }),
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
      patch((m) => ({
        ...m,
        content: (e as Error).message || "Erro ao perguntar",
        error: true,
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      {msgs.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Sugestões para começar:</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-md border border-border bg-muted/30 p-3 text-left text-sm text-foreground transition hover:border-primary hover:bg-muted/60"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                    : `max-w-[95%] space-y-2 rounded-lg border px-3 py-2 ${
                        m.error
                          ? "border-destructive/50 text-destructive"
                          : "border-border bg-muted/30"
                      }`
                }
              >
                {m.role === "assistant" && !m.content && busy && i === msgs.length - 1 ? (
                  <span className="text-sm text-muted-foreground">Procurando nos arquivos…</span>
                ) : (
                  <RichText text={m.content} />
                )}
                {m.role === "assistant" && !!m.sources?.length && !m.error && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">
                      Trechos consultados ({m.sources.length} arquivo
                      {m.sources.length > 1 ? "s" : ""})
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {m.sources.map((s) => (
                        <li key={`${s.name}-${s.link}`} className="flex items-center gap-1">
                          <FileText className="size-3 shrink-0" />
                          {s.link ? (
                            <a
                              href={s.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-primary underline underline-offset-2"
                            >
                              {s.name}
                            </a>
                          ) : (
                            <span className="truncate">{s.name}</span>
                          )}
                          <span className="truncate opacity-70">· {s.folder}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua pergunta…"
          maxLength={2000}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Enviar">
          <Send className="size-4" />
        </Button>
        {msgs.length > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setMsgs([])}
            aria-label="Limpar conversa"
            title="Limpar conversa"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Arquivos
// ---------------------------------------------------------------------------------------------

const STATUS: Record<KbFile["status"], { label: string; cls: string }> = {
  indexado: { label: "Indexado", cls: "bg-primary/20 text-primary border-primary/30" },
  vazio: { label: "Sem texto", cls: "bg-muted text-muted-foreground" },
  ignorado: { label: "Ignorado", cls: "bg-muted text-muted-foreground" },
  erro: { label: "Erro", cls: "bg-destructive/20 text-destructive border-destructive/30" },
};

const RUN_LABEL: Record<string, string> = {
  ok: "concluída",
  parcial: "parcial (o restante entra na próxima)",
  erro: "com erro",
  rodando: "em andamento",
};

function ArquivosTab() {
  const qc = useQueryClient();
  const files = useQuery({
    queryKey: ["kb-files"],
    queryFn: () => api<{ files: KbFile[]; lastSync: SyncRun | null }>("files"),
  });
  const sync = useMutation({
    mutationFn: () => api<{ status: string; stats: Record<string, number> }>("sync", "POST"),
    onSuccess: (r) => {
      const s = r.stats;
      toast.success(
        `Sincronização ${RUN_LABEL[r.status] ?? r.status}: ${s["indexados"] ?? 0} atualizado(s), ${s["sem_mudanca"] ?? 0} sem mudança, ${s["erros"] ?? 0} erro(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["kb-files"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = files.data?.files ?? [];
  const last = files.data?.lastSync;
  const indexados = list.filter((f) => f.status === "indexado").length;

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="text-foreground">
            {indexados} arquivo{indexados === 1 ? "" : "s"} indexado{indexados === 1 ? "" : "s"} de{" "}
            {list.length}
          </p>
          <p className="text-muted-foreground">
            Última sincronização:{" "}
            {last
              ? `${fmt(last.finished_at ?? last.started_at)} (${last.origem === "cron" ? "automática" : "manual"}, ${RUN_LABEL[last.status] ?? last.status})`
              : "nunca"}
          </p>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`mr-1 size-4 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Sincronizando…" : "Sincronizar agora"}
        </Button>
      </div>

      {files.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : files.isError ? (
        <p className="text-sm text-destructive">{(files.error as Error).message}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum arquivo ainda. Clique em "Sincronizar agora" para ler as pastas do Drive.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((f) => (
            <li
              key={f.file_id}
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {f.web_view_link ? (
                    <a
                      href={f.web_view_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium text-foreground hover:text-primary"
                    >
                      {f.name}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-medium text-foreground">{f.name}</span>
                  )}
                  {f.web_view_link && (
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {f.folder} · alterado em {fmt(f.modified_time)}
                </p>
                {f.detail && f.status !== "indexado" && (
                  <p className="truncate text-xs text-muted-foreground" title={f.detail}>
                    {f.detail}
                  </p>
                )}
              </div>
              <Badge variant="outline" className={`w-fit ${STATUS[f.status].cls}`}>
                {STATUS[f.status].label}
                {f.status === "indexado" ? ` · ${f.chunks} trecho${f.chunks === 1 ? "" : "s"}` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
