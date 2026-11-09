import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ptBR } from 'date-fns/locale'
import type { DateRange } from 'react-day-picker'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  inicio: string // yyyy-mm-dd
  fim: string
  onChange: (inicio: string, fim: string) => void
  className?: string
  atalhos?: Atalho[] // padrão: ATALHOS
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const doIso = (s: string) => (s ? new Date(`${s}T00:00:00`) : undefined)
const br = (s: string) => s.split('-').reverse().join('/')

const dia = (delta: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + delta)
  return d
}
const mes = (delta: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() + delta)
  return d
}

// mês de calendário inteiro (1º ao último dia), relativo ao mês atual
const mesCheio = (delta: number): [Date, Date] => {
  const h = new Date()
  return [new Date(h.getFullYear(), h.getMonth() + delta, 1), new Date(h.getFullYear(), h.getMonth() + delta + 1, 0)]
}

export type Atalho = { label: string; faixa: () => [Date, Date] }

const ATALHOS: Atalho[] = [
  { label: 'Hoje', faixa: () => [dia(0), dia(0)] },
  { label: 'Ontem', faixa: () => [dia(-1), dia(-1)] },
  { label: 'Últimos 7 dias', faixa: () => [dia(-6), dia(0)] },
  { label: 'Últimos 30 dias', faixa: () => [dia(-29), dia(0)] },
  { label: 'Último mês', faixa: () => [mesCheio(-1)[0], mesCheio(-1)[1]] },
  { label: 'Últimos 6 meses', faixa: () => [mes(-6), dia(0)] },
  { label: 'Último ano', faixa: () => [mes(-12), dia(0)] },
  { label: 'Próximos 7 dias', faixa: () => [dia(0), dia(6)] },
  { label: 'Próximos 30 dias', faixa: () => [dia(0), dia(29)] },
  { label: 'Próximo mês', faixa: () => [mesCheio(1)[0], mesCheio(1)[1]] },
]

// Atalhos da precificação: períodos de retirada à frente (mês atual e os próximos 30, 60, 90 e 120 dias)
export const ATALHOS_PRECIFICACAO: Atalho[] = [
  { label: 'Mês atual', faixa: () => mesCheio(0) },
  ...[30, 60, 90, 120].map((n): Atalho => ({ label: `Próximos ${n} dias`, faixa: () => [dia(0), dia(n - 1)] })),
]

export function PeriodoPicker({ inicio, fim, onChange, className = 'mt-1 w-full', atalhos = ATALHOS }: Props) {
  const [aberto, setAberto] = useState(false)
  const selecionado: DateRange | undefined = inicio || fim ? { from: doIso(inicio), to: doIso(fim) } : undefined
  const texto = inicio || fim ? `${inicio ? br(inicio) : '…'} – ${fim ? br(fim) : '…'}` : 'Todo o período'

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button"
          className={`${className} flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring`}>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {texto}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-fit overflow-y-auto p-0">
        <div className="flex flex-col md:flex-row">
          <div className="grid grid-cols-2 gap-1 border-b border-border p-2 md:flex md:w-40 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
            {atalhos.map((a) => (
              <button key={a.label} type="button"
                onClick={() => {
                  const [i, f] = a.faixa()
                  onChange(iso(i), iso(f))
                  setAberto(false)
                }}
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                {a.label}
              </button>
            ))}
          </div>
          <Calendar className="mx-auto" mode="range" locale={ptBR} numberOfMonths={1} {...(selecionado?.from ? { defaultMonth: selecionado.from } : {})} {...(selecionado ? { selected: selecionado } : {})}
            onSelect={(r) => onChange(r?.from ? iso(r.from) : '', r?.to ? iso(r.to) : r?.from ? iso(r.from) : '')} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
