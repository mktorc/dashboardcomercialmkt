import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2, KeyRound } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { guardPage, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { createUser, deleteUser, listUsers, updateUser } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Orlando Rent Car Analytics" },
      { name: "description", content: "Gerenciamento de usuários e permissões do painel." },
    ],
  }),
  beforeLoad: () => guardPage("configuracoes"),
  component: SettingsPage,
});

const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as [AppRole, string][];
const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function SettingsPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("comercial");

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const onErr = (e: Error) => toast.error(e.message);

  const create = useMutation({
    mutationFn: () => createUser({ data: { email, password, role } }),
    onSuccess: () => {
      toast.success("Usuário criado");
      setEmail("");
      setPassword("");
      refresh();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: (d: { id: string; role?: AppRole; password?: string }) => updateUser({ data: d }),
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar active="configuracoes" />
      <main className="flex-1 space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Só acessa o painel quem estiver cadastrado aqui.
          </p>
        </div>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-foreground">Novo usuário</h2>
          <form
            className="grid gap-4 md:grid-cols-[1fr_1fr_200px_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nu-email">E-mail</Label>
              <Input id="nu-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-pass">Senha</Label>
              <Input id="nu-pass" type="text" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-role">Perfil</Label>
              <select id="nu-role" className={`${selectCls} w-full`} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                {ROLE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={create.isPending}>Cadastrar</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Comercial - Equipe: só Comercial Operacional · Mkt - Equipe: só Marketing · Superadmin: todas as abas.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-foreground">Usuários</h2>
          {users.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : users.error ? (
            <p className="text-sm text-destructive">{(users.error as Error).message}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2">E-mail</th>
                    <th>Perfil</th>
                    <th>Último acesso</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="py-2 text-foreground">{u.email}{u.isSelf ? " (você)" : ""}</td>
                      <td>
                        <select
                          className={selectCls}
                          value={u.role ?? ""}
                          disabled={u.isSelf}
                          onChange={(e) => update.mutate({ id: u.id, role: e.target.value as AppRole })}
                        >
                          {!u.role ? <option value="">Sem acesso</option> : null}
                          {ROLE_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-muted-foreground">
                        {u.lastSignIn ? new Date(u.lastSignIn).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="space-x-1 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Trocar senha"
                          onClick={() => {
                            const p = window.prompt(`Nova senha para ${u.email} (mín. 6 caracteres):`);
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
