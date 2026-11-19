import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { guardPage } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/fila-leads")({
  head: () => ({
    meta: [
      { title: "Fila de Leads | Orlando Rent Car Analytics" },
      { name: "description", content: "Fila de distribuição de leads entre os vendedores." },
      { property: "og:title", content: "Fila de Leads | Orlando Rent Car Analytics" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => guardPage("fila-leads"),
  component: FilaLeadsPage,
});

type Vendedor = {
  id: number;
  cm_user_id: number;
  nome: string;
  email: string | null;
  ativo: boolean;
  ultimo_lead_at: string | null;
};
type Historico = {
  id: string;
  created_at: string;
  nome_lead: string | null;
  telefone: string | null;
  origem: string | null;
  vendedor_nome: string | null;
  status: string | null;
};

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api/fila/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${data.session?.access_token ?? ""}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.msg ?? "Erro na requisição");
  return json as T;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Mesma ordem da função SQL fila_proximo: quem nunca recebeu primeiro, depois o mais antigo.
function ordenarFila(vs: Vendedor[]) {
  return vs
    .filter((v) => v.ativo)
    .sort((a, b) => {
      if (!a.ultimo_lead_at !== !b.ultimo_lead_at) return a.ultimo_lead_at ? 1 : -1;
      const d = (a.ultimo_lead_at ?? "").localeCompare(b.ultimo_lead_at ?? "");
      return d || a.id - b.id;
    });
}

function badgeOrigem(h: Historico) {
  const origem = (h.origem ?? "").toLowerCase();
  if (origem === "ia" || h.status === "Distribuído")
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Distribuído (IA)</Badge>
    );
  if (origem.startsWith("depart"))
    return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Departamento</Badge>;
  return <Badge className="bg-sky-600 text-white hover:bg-sky-600">{h.origem ?? "Externo"}</Badge>;
}

const selectCls =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

function FilaLeadsPage() {
  const qc = useQueryClient();
  const vendedores = useQuery({
    queryKey: ["fila-vendedores"],
    queryFn: async () => (await api<{ vendedores: Vendedor[] }>("vendedores")).vendedores,
  });
  const historico = useQuery({
    queryKey: ["fila-historico"],
    queryFn: async () => (await api<{ historico: Historico[] }>("historico")).historico,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fila-vendedores"] });
    qc.invalidateQueries({ queryKey: ["fila-historico"] });
  };
  const onErr = (e: Error) => toast.error(e.message);

  const lista = vendedores.data ?? [];
  const fila = ordenarFila([...lista]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Fila de Leads</h1>
          <p className="text-sm text-muted-foreground">
            Fila única de distribuição, alimentada pela IA e pelos vendedores.
          </p>
        </div>
        <Tabs defaultValue="externo">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="externo">Lead Externo</TabsTrigger>
            <TabsTrigger value="equipe">Equipe</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="externo">
            <ExternoTab ativos={fila} onDone={refresh} onErr={onErr} />
          </TabsContent>
          <TabsContent value="equipe">
            <EquipeTab
              lista={lista}
              fila={fila}
              loading={vendedores.isLoading}
              onDone={refresh}
              onErr={onErr}
            />
          </TabsContent>
          <TabsContent value="historico">
            <HistoricoTab rows={historico.data ?? []} loading={historico.isLoading} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ExternoTab({
  ativos,
  onDone,
  onErr,
}: {
  ativos: Vendedor[];
  onDone: () => void;
  onErr: (e: Error) => void;
}) {
  const [userId, setUserId] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const registrar = useMutation({
    mutationFn: () =>
      api("externo", { method: "POST", body: { userId: Number(userId), nome, telefone } }),
    onSuccess: () => {
      toast.success("Registrado. Você foi para o fim da fila.");
      setNome("");
      setTelefone("");
      onDone();
    },
    onError: onErr,
  });
  const pronto = userId && nome.trim() && telefone.trim();
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        Use quando você pegou um lead por fora (WhatsApp direto, indicação). Você vai pro final da
        fila.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="fila-vendedor">Vendedor</Label>
        <select
          id="fila-vendedor"
          className={selectCls}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Selecione…</option>
          {ativos.map((v) => (
            <option key={v.id} value={v.cm_user_id}>
              {v.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fila-nome">Nome do lead</Label>
        <Input id="fila-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fila-tel">Telefone do lead</Label>
        <Input
          id="fila-tel"
          type="tel"
          inputMode="tel"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
      </div>
      <Button
        className="w-full"
        disabled={!pronto || registrar.isPending}
        onClick={() => registrar.mutate()}
      >
        Registrar e ir pro fim da fila
      </Button>
    </Card>
  );
}

function EquipeTab({
  lista,
  fila,
  loading,
  onDone,
  onErr,
}: {
  lista: Vendedor[];
  fila: Vendedor[];
  loading: boolean;
  onDone: () => void;
  onErr: (e: Error) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [cm, setCm] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [remover, setRemover] = useState<Vendedor | null>(null);

  const toggle = useMutation({
    mutationFn: (v: Vendedor) => api("toggle", { method: "POST", body: { userId: v.cm_user_id } }),
    onSuccess: onDone,
    onError: onErr,
  });
  const criar = useMutation({
    mutationFn: () =>
      api("vendedores", {
        method: "POST",
        body: { cm_user_id: Number(cm), nome, email },
      }),
    onSuccess: () => {
      toast.success("Vendedor adicionado");
      setAberto(false);
      setCm("");
      setNome("");
      setEmail("");
      onDone();
    },
    onError: onErr,
  });
  const excluir = useMutation({
    mutationFn: (v: Vendedor) => api(`vendedores/${v.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Vendedor removido");
      setRemover(null);
      onDone();
    },
    onError: onErr,
  });

  const posicao = new Map(fila.map((v, i) => [v.id, i + 1]));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm font-medium text-foreground">
          {fila.length ? (
            <>Próximo → {fila.map((v) => v.nome).join(" → ")}</>
          ) : (
            "Nenhum vendedor ativo na fila."
          )}
        </p>
      </Card>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAberto(true)}>
          <Plus className="mr-1 size-4" /> Adicionar vendedor
        </Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {lista.map((v) => (
        <Card key={v.id} className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{v.nome}</span>
              {posicao.get(v.id) ? (
                <Badge variant={posicao.get(v.id) === 1 ? "default" : "secondary"}>
                  {posicao.get(v.id) === 1 ? "Próximo" : `${posicao.get(v.id)}º`}
                </Badge>
              ) : (
                <Badge variant="outline">Inativo</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Último lead: {v.ultimo_lead_at ? fmt(v.ultimo_lead_at) : "—"}
            </p>
          </div>
          <Switch
            checked={v.ativo}
            disabled={toggle.isPending}
            onCheckedChange={() => toggle.mutate(v)}
            aria-label={`${v.ativo ? "Desativar" : "Ativar"} ${v.nome}`}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remover ${v.nome}`}
            onClick={() => setRemover(v)}
          >
            <Trash2 className="size-4" />
          </Button>
        </Card>
      ))}
      {!loading && lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum vendedor cadastrado.</p>
      ) : null}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar vendedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-cm">ID do usuário no ClickMassa</Label>
              <Input
                id="v-cm"
                inputMode="numeric"
                value={cm}
                onChange={(e) => setCm(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-nome">Nome</Label>
              <Input id="v-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-email">E-mail</Label>
              <Input
                id="v-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!/^\d+$/.test(cm) || !nome.trim() || criar.isPending}
              onClick={() => criar.mutate()}
            >
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!remover} onOpenChange={(o) => !o && setRemover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover {remover?.nome}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O vendedor sai da fila. O histórico de leads já registrado é mantido.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemover(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={excluir.isPending}
              onClick={() => remover && excluir.mutate(remover)}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoricoTab({ rows, loading }: { rows: Historico[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhum lead registrado.</p>;
  return (
    <div className="space-y-3">
      {rows.map((h) => (
        <Card key={h.id} className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground">{h.nome_lead || "Sem nome"}</span>
            {badgeOrigem(h)}
          </div>
          <p className="text-sm text-muted-foreground">
            {h.telefone || "—"} · {h.vendedor_nome || "—"}
          </p>
          <p className="text-xs text-muted-foreground">{fmt(h.created_at)}</p>
        </Card>
      ))}
    </div>
  );
}
