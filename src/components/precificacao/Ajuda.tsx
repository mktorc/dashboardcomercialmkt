import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Interrogação ao lado de um filtro: abre uma explicação curta (clique, funciona também no celular). */
export function Ajuda({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ajuda: ${titulo}`}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-1.5 text-xs leading-snug">
        <p className="text-sm font-semibold">{titulo}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Linha "nome: explicação" das listas de ajuda. */
export function AjudaItem({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <p>
      <b>{nome}:</b> {children}
    </p>
  );
}
