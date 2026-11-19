import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ManualSyncButton } from "@/components/ManualSyncButton";
import { Button } from "@/components/ui/button";
import { usePerfil } from "@/lib/comissoes/hooks";
import { homeOf } from "@/lib/roles";

const ABAS = [
  { to: "/app/comissoes/a-pagar", rotulo: "Comissões a Pagar" },
  { to: "/app/comissoes/historico", rotulo: "Histórico" },
] as const;

export function ComissoesLayout({ children }: { children: ReactNode }) {
  const { access } = usePerfil();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/app", replace: true });
  }
  // Admin, visitante sem login e quem tem mais de um módulo voltam ao hub; os demais, à própria página
  const voltar = !access || access.admin || access.modules.length > 1 ? "/app" : homeOf(access);
  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6"
        style={{ background: "var(--gradient-brand)" }}
      >
        <div>
          <h1 className="text-lg font-semibold text-foreground">Gerenciamento de Comissões</h1>
          <p className="text-sm text-foreground/70">Comissões de parceiros</p>
        </div>
        <div className="flex items-center gap-2">
          <ManualSyncButton />
          {voltar ? (
            <Button asChild variant="outline" size="sm">
              <Link to={voltar}>
                <ArrowLeft className="mr-1 size-4" />{" "}
                {voltar === "/app" ? "Voltar aos Módulos" : "Voltar"}
              </Link>
            </Button>
          ) : null}
          {access ? (
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-1 size-4" /> Sair
            </Button>
          ) : null}
        </div>
      </header>
      <nav className="flex gap-2 border-b border-border px-4 py-3 sm:px-6">
        {ABAS.map((a) => (
          <Button key={a.to} asChild size="sm" variant="outline">
            <Link to={a.to} activeProps={{ className: "bg-primary text-primary-foreground" }}>
              {a.rotulo}
            </Link>
          </Button>
        ))}
      </nav>
      <main className="space-y-6 p-4 sm:p-6">{children}</main>
    </div>
  );
}
