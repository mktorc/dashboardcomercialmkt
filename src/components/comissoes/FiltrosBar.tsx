import { PeriodoPicker } from '@/components/PeriodoPicker'
import type { Filtros } from '@/lib/comissoes/types'

interface Props {
  filtros: Filtros
  parceiros: string[]
  onChange: (f: Filtros) => void
  padrao?: Filtros
}

const campo =
  'mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

export function FiltrosBar({ filtros, parceiros, onChange, padrao }: Props) {
  const set = (p: Partial<Filtros>) => onChange({ ...filtros, ...p })
  const invalido = !!filtros.dataInicio && !!filtros.dataFim && filtros.dataInicio > filtros.dataFim
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
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
        Nº da reserva
        <input type="search" inputMode="numeric" placeholder="Buscar reserva" className={campo} value={filtros.reserva}
          onChange={(e) => set({ reserva: e.target.value })} />
      </label>
      <div className="text-sm font-medium text-foreground/80">
        Criação da reserva
        <PeriodoPicker inicio={filtros.dataInicio} fim={filtros.dataFim} onChange={(dataInicio, dataFim) => set({ dataInicio, dataFim })} />
      </div>
      <div className="flex items-end">
        <button type="button" onClick={() => onChange(padrao ?? { parceiro: '', reserva: '', dataInicio: '', dataFim: '' })}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/40">
          Limpar filtros
        </button>
      </div>
      {invalido && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-5">A data inicial é posterior à data final.</p>}
    </div>
  )
}
