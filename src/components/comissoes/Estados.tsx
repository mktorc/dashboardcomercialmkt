export function Carregando() {
  return (
    <div
      className="flex items-center justify-center gap-3 p-12 text-muted-foreground"
      role="status"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
      Carregando...
    </div>
  );
}

export function Vazio({ mensagem }: { mensagem: string }) {
  return <div className="p-12 text-center text-sm text-muted-foreground">{mensagem}</div>;
}

export function Erro({ mensagem, onRetry }: { mensagem: string; onRetry: () => void }) {
  return (
    <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      <p>{mensagem}</p>
      <button onClick={onRetry} className="mt-2 font-medium underline">
        Tentar novamente
      </button>
    </div>
  );
}

export function Card({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{valor}</p>
    </div>
  );
}
