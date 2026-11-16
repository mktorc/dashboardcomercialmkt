import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar | Orlando Rent Car Analytics" },
      { name: "description", content: "Acesso restrito ao painel da Orlando Rent Car." },
      { property: "og:title", content: "Entrar | Orlando Rent Car Analytics" },
      { property: "og:description", content: "Acesso restrito ao painel da Orlando Rent Car." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    next:
      typeof s["next"] === "string" && s["next"].startsWith("/") && !s["next"].startsWith("//")
        ? s["next"]
        : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error("E-mail ou senha inválidos.");
      if (next) window.location.assign(next);
      else navigate({ to: "/app" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <span
            className="flex size-9 items-center justify-center rounded-lg font-bold text-[color:var(--brand-dark)]"
            style={{ background: "var(--brand-vivid)" }}
          >
            O
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Orlando Rent Car</p>
            <p className="text-xs text-muted-foreground">Entre para ver o painel</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            Entrar
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Acesso apenas para usuários cadastrados pelo administrador.
        </p>
      </Card>
    </div>
  );
}
