import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePerfil } from "@/lib/comissoes/hooks";
import { HOME } from "@/lib/roles";

const ABAS = [
  { to: "/app/comissoes/a-pagar", rotulo: "Comissões a Pagar" },
  { to: "/app/comissoes/historico", rotulo: "Histórico" },
] as const;

export function ComissoesLayout({ children }: { children: ReactNode }) {
  const { role } = usePerfil();
  // superadmin e visitante sem login voltam ao hub; os demais perfis, à própria página
  const voltar = role === "superadmin" || !role ? "/app" : HOME[role];
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
        {voltar ? (
          <Button asChild variant="outline" size="sm">
            <Link to={voltar}><ArrowLeft className="mr-1 size-4" /> {role === "superadmin" || !role ? "Voltar aos Módulos" : "Voltar"}</Link>
          </Button>
        ) : null}
      </header>
      <nav className="flex gap-2 border-b border-border px-4 py-3 sm:px-6">
        {ABAS.map((a) => (
          <Button key={a.to} asChild size="sm" variant="outline">
            <Link to={a.to} activeProps={{ className: "bg-primary text-primary-foreground" }}>{a.rotulo}</Link>
          </Button>
        ))}
      </nav>
      <main className="space-y-6 p-4 sm:p-6">{children}</main>
    </div>
  );
}
