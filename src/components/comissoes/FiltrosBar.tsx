import type { Filtros } from '@/lib/comissoes/types'

interface Props {
  filtros: Filtros
  parceiros: string[]
  onChange: (f: Filtros) => void
}

const campo =
  'mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

export function FiltrosBar({ filtros, parceiros, onChange }: Props) {
  const set = (p: Partial<Filtros>) => onChange({ ...filtros, ...p })
  const invalido = !!filtros.dataInicio && !!filtros.dataFim && filtros.dataInicio > filtros.dataFim
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm font-medium text-foreground/80">
        Parceiro
        <select className={campo} value={filtros.parceiro} onChange={(e) => set({ parceiro: e.target.value })}>
          <option value="">Todos</option>
          {parceiros.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-foreground/80">
        Criação da reserva — de
        <input type="date" className={campo} value={filtros.dataInicio} max={filtros.dataFim || undefined}
          onChange={(e) => set({ dataInicio: e.target.value })} />
      </label>
      <label className="text-sm font-medium text-foreground/80">
        até
        <input type="date" className={campo} value={filtros.dataFim} min={filtros.dataInicio || undefined}
          onChange={(e) => set({ dataFim: e.target.value })} />
      </label>
      <div className="flex items-end">
        <button type="button" onClick={() => onChange({ parceiro: '', dataInicio: '', dataFim: '' })}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/40">
          Limpar filtros
        </button>
      </div>
      {invalido && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4">A data inicial é posterior à data final.</p>}
    </div>
  )
}
