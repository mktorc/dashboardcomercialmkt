import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Trash2, KeyRound, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { guardPage, MODULE_KEYS, MODULE_LABELS, type Access, type ModuleKey } from "@/lib/roles";
import { createUser, deleteUser, listUsers, updateUser } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Orlando Rent Car Analytics" },
      { name: "description", content: "Gerenciamento de usuários e permissões do painel." },
      { property: "og:title", content: "Configurações | Orlando Rent Car Analytics" },
      { property: "og:description", content: "Gerenciamento de usuários e permissões do painel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => guardPage("configuracoes"),
  component: SettingsPage,
});

const SEM_ACESSO: Access = { modules: [], admin: false, canPay: false };

function resumo(a: Access | null) {
  if (!a) return "Sem acesso";
  if (a.admin) return "Admin (todos os módulos)";
  const mods = a.modules.map((m) => MODULE_LABELS[m]);
  if (a.canPay) mods.push("pode pagar comissões");
  return mods.length ? mods.join(" · ") : "Sem acesso";
}

/** Caixas de marcar: um módulo por linha, mais Admin e "pode pagar comissões". */
function AccessEditor({
  id,
  value,
  onChange,
  lockAdmin,
}: {
  id: string;
  value: Access;
  onChange: (a: Access) => void;
  lockAdmin?: boolean;
}) {
  const toggle = (m: ModuleKey, on: boolean) =>
    onChange({
      ...value,
      modules: on ? [...value.modules, m] : value.modules.filter((x) => x !== m),
    });
  const item = (
    key: string,
    label: string,
    checked: boolean,
    set: (v: boolean) => void,
    disabled?: boolean,
    hint?: string,
  ) => (
    <label
      key={key}
      htmlFor={`${id}-${key}`}
      className="flex items-start gap-2 text-sm text-foreground"
    >
      <Checkbox
        id={`${id}-${key}`}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => set(v === true)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Módulos</p>
        {MODULE_KEYS.map((m) =>
          item(
            m,
            MODULE_LABELS[m],
            value.admin || value.modules.includes(m),
            (v) => toggle(m, v),
            value.admin,
          ),
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Permissões extras</p>
        {item(
          "admin",
          "Admin",
          value.admin,
          (v) => onChange({ ...value, admin: v }),
          lockAdmin,
          "Todos os módulos, Configurações e validar descontos",
        )}
        {item(
          "pay",
          "Pode pagar comissões",
          value.admin || value.canPay,
          (v) => onChange({ ...value, canPay: v }),
          value.admin,
          "Marcar como paga e compensar estorno",
        )}
      </div>
    </div>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newAccess, setNewAccess] = useState<Access>(SEM_ACESSO);
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Access>(SEM_ACESSO);

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const onErr = (e: Error) => toast.error(e.message);

  const create = useMutation({
    mutationFn: () => createUser({ data: { email, password, access: newAccess } }),
    onSuccess: () => {
      toast.success("Usuário criado");
      setEmail("");
      setPassword("");
      setNewAccess(SEM_ACESSO);
      refresh();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: (d: { id: string; access?: Access; password?: string }) => updateUser({ data: d }),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      refresh();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteUser({ data: { id } }),
    onSuccess: () => {
      toast.success("Usuário excluído");
      refresh();
    },
    onError: onErr,
  });

  const costs = useQuery({
    queryKey: ["team-costs-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_team_costs")
        .select("month, amount")
        .order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const [costMonth, setCostMonth] = useState(new Date().toISOString().slice(0, 7));
  const [costAmount, setCostAmount] = useState("");
  const [costOpen, setCostOpen] = useState(false);
  const refreshCosts = () => {
    qc.invalidateQueries({ queryKey: ["team-costs-admin"] });
    qc.invalidateQueries({ queryKey: ["team-costs"] });
  };
  const saveCost = useMutation({
    mutationFn: async () => {
      const amount = Number(costAmount.replace(/\./g, "").replace(",", "."));
      if (!costMonth || !Number.isFinite(amount) || amount < 0)
        throw new Error("Informe mês e valor válidos");
      const { error } = await supabase
        .from("marketing_team_costs")
        .upsert(
          { month: costMonth, amount, updated_at: new Date().toISOString() },
          { onConflict: "month" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Investimento salvo");
      setCostAmount("");
      refreshCosts();
    },
    onError: onErr,
  });
  const removeCost = useMutation({
    mutationFn: async (month: string) => {
      const { error } = await supabase.from("marketing_team_costs").delete().eq("month", month);
      if (error) throw error;
    },
    onSuccess: refreshCosts,
    onError: onErr,
  });

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/app">
            <ArrowLeft className="mr-1 size-4" /> Voltar aos Módulos
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Só acessa o painel quem estiver cadastrado aqui.
          </p>
        </div>

        <Card className="p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            aria-expanded={costOpen}
            onClick={() => setCostOpen((o) => !o)}
          >
            <h2 className="font-semibold text-foreground">Investimento na equipe de marketing</h2>
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${costOpen ? "rotate-180" : ""}`}
            />
          </button>
          {costOpen ? (
            <div className="mt-1">
              <p className="mb-4 text-xs text-muted-foreground">
                Valor mensal (USD). No dashboard, marque "Incluir equipe de marketing" para somá-lo
                ao investimento do CAC, rateado pelos dias do período.
              </p>
              <form
                className="grid gap-4 md:grid-cols-[180px_200px_auto] md:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCost.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="tc-month">Mês</Label>
                  <Input
                    id="tc-month"
                    type="month"
                    required
                    value={costMonth}
                    onChange={(e) => setCostMonth(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tc-amount">Valor mensal</Label>
                  <Input
                    id="tc-amount"
                    inputMode="decimal"
                    required
                    placeholder="15000"
                    value={costAmount}
                    onChange={(e) => setCostAmount(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={saveCost.isPending}>
                  Salvar
                </Button>
              </form>
              {costs.data?.length ? (
                <table className="mt-4 w-full text-sm">
                  <tbody>
                    {costs.data.map((c) => (
                      <tr key={c.month} className="border-t border-border">
                        <td className="py-2 text-foreground">
                          {c.month.slice(5)}/{c.month.slice(0, 4)}
                        </td>
                        <td className="text-foreground">
                          {Number(c.amount).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "USD",
                          })}
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Excluir"
                            onClick={() => removeCost.mutate(c.month)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-foreground">Novo usuário</h2>
          <form
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nu-email">E-mail</Label>
              <Input
                id="nu-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-pass">Senha</Label>
              <Input
                id="nu-pass"
                type="text"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Cadastrar
            </Button>
            <div className="md:col-span-3">
              <AccessEditor id="nu" value={newAccess} onChange={setNewAccess} />
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-foreground">Usuários</h2>
          {users.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : users.error ? (
            <p className="text-sm text-destructive">{(users.error as Error).message}</p>
          ) : (
            <ul className="divide-y divide-border">
              {users.data?.map((u) => {
                const isOpen = aberto === u.id;
                return (
                  <li key={u.id} className="py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted"
                        aria-expanded={isOpen}
                        onClick={() => {
                          setAberto(isOpen ? null : u.id);
                          setRascunho(u.access ?? SEM_ACESSO);
                        }}
                      >
                        <ChevronRight
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {u.email}
                            {u.isSelf ? " (você)" : ""}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {resumo(u.access)} · último acesso{" "}
                            {u.lastSignIn ? new Date(u.lastSignIn).toLocaleString("pt-BR") : "—"}
                          </span>
                        </span>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Trocar senha"
                        onClick={() => {
                          const p = window.prompt(
                            `Nova senha para ${u.email} (mín. 6 caracteres):`,
                          );
                          if (p) update.mutate({ id: u.id, password: p });
                        }}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      {!u.isSelf ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Excluir"
                          onClick={() => {
                            if (window.confirm(`Excluir ${u.email}?`)) remove.mutate(u.id);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                    {isOpen ? (
                      <div className="mt-3 space-y-4 rounded-md border border-border p-4">
                        <AccessEditor
                          id={`u-${u.id}`}
                          value={rascunho}
                          onChange={setRascunho}
                          lockAdmin={u.isSelf}
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setAberto(null)}>
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            disabled={update.isPending}
                            onClick={() =>
                              update.mutate(
                                { id: u.id, access: rascunho },
                                { onSuccess: () => setAberto(null) },
                              )
                            }
                          >
                            Salvar acesso
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
