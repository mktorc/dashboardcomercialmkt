import { ATALHOS_PRECIFICACAO, PeriodoPicker } from "@/components/PeriodoPicker";

/** Filtro de período de retirada, igual nas abas Gestão de Ocupação e Competitividade (mesmo seletor do dashboard). */
export function PeriodFilter({
  from,
  to,
  onChange,
  children,
  actions,
  ajuda,
  label = "Período de retirada",
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Filtros extras, ao lado do período. */
  children?: React.ReactNode;
  /** Botões extras, depois dos filtros. */
  actions?: React.ReactNode;
  /** Ajuda (interrogação) ao lado do rótulo do período. */
  ajuda?: React.ReactNode;
  /** Rótulo do período. */
  label?: string;
}) {
  return (
    <>
      <div className="space-y-1 text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          {label}
          {ajuda}
        </span>
        <PeriodoPicker
          inicio={from}
          fim={to}
          onChange={(a, b) => a && b && a <= b && onChange(a, b)}
          atalhos={ATALHOS_PRECIFICACAO}
          className="w-64"
        />
      </div>
      {children}
      {actions}
    </>
  );
}
