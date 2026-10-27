import type { StatusExibicao } from '@/lib/comissoes/types'

const ESTILOS: Record<StatusExibicao, { texto: string; classe: string }> = {
  retida: { texto: 'Retido na Agência / Quitado', classe: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  paga: { texto: 'Paga', classe: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  liberada: {
    texto: 'Aguardando Pagamento / Liberada',
    classe: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  },
  bloqueada: {
    texto: 'Pendente - Abaixo do Rack Rate',
    classe: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  },
}

export function StatusBadge({ status }: { status: StatusExibicao }) {
  const { texto, classe } = ESTILOS[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classe}`}>
      {texto}
    </span>
  )
}
