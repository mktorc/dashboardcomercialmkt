import { useMemo, useState } from 'react'
import { Carregando, Erro, Vazio } from './Estados'
import { Input } from '@/components/ui/input'
import { FiltrosBar } from './FiltrosBar'
import { StatusBadge } from './StatusBadge'
import { filtrosVazios, useParceiros, useReservas } from '@/lib/comissoes/hooks'
import { data, moeda } from '@/lib/comissoes/format'
import { listarHistorico } from '@/lib/comissoes/service'
import { statusDaReserva, type Filtros } from '@/lib/comissoes/types'

export default function Historico() {
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios)
  const parceiros = useParceiros()
  const { linhas: todas, carregando, erro, recarregar } = useReservas(listarHistorico, filtros)
  const [visao, setVisao] = useState<'reserva' | 'parceiro'>('reserva')
  const [busca, setBusca] = useState('')

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? todas.filter((r) => r.hq_reservation_id.toLowerCase().includes(q)) : todas
  }, [todas, busca])

  const porParceiro = useMemo(() => {
    const mapa = new Map<string, { parceiro: string; reservas: number; retida: number; paga: number; liberada: number; bloqueada: number }>()
    for (const r of linhas) {
      const g = mapa.get(r.commission_partner) ?? { parceiro: r.commission_partner, reservas: 0, retida: 0, paga: 0, liberada: 0, bloqueada: 0 }
      g.reservas++
      g[statusDaReserva(r)] += r.valor_comissao
      mapa.set(r.commission_partner, g)
    }
    return [...mapa.values()].sort((a, b) => a.parceiro.localeCompare(b.parceiro, 'pt-BR'))
  }, [linhas])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Histórico de Comissões</h1>
        <p className="text-sm text-muted-foreground">Todas as reservas importadas do HQ, com a checagem total pago × rack rate.</p>
      </header>

      <FiltrosBar filtros={filtros} parceiros={parceiros} onChange={setFiltros} />

      <div className="flex flex-wrap items-center gap-3">
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por reserva (nº do HQ)"
        aria-label="Buscar por reserva"
        className="h-9 w-64 bg-card"
      />
      <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
        {([['reserva', 'Por reserva'], ['parceiro', 'Por parceiro']] as const).map(([id, rotulo]) => (
          <button key={id} onClick={() => setVisao(id)} aria-pressed={visao === id}
            className={`rounded px-3 py-1.5 font-medium ${visao === id ? 'bg-primary text-white' : 'text-foreground/80 hover:bg-muted/40'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {carregando ? (
          <Carregando />
        ) : erro ? (
          <Erro mensagem={erro} onRetry={recarregar} />
        ) : linhas.length === 0 ? (
          <Vazio mensagem={busca.trim() ? "Nenhuma reserva encontrada para a busca." : "Nenhuma reserva encontrada com os filtros atuais."} />
        ) : visao === 'parceiro' ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Parceiro</th>
                  <th className="px-4 py-3 text-right">Reservas</th>
                  <th className="px-4 py-3 text-right">Retida na agência</th>
                  <th className="px-4 py-3 text-right">Paga</th>
                  <th className="px-4 py-3 text-right">Liberada (a pagar)</th>
                  <th className="px-4 py-3 text-right">Abaixo do rack rate</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {porParceiro.map((g) => (
                  <tr key={g.parceiro} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{g.parceiro}</td>
                    <td className="px-4 py-3 text-right">{g.reservas}</td>
                    <td className="px-4 py-3 text-right text-violet-400">{moeda(g.retida)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{moeda(g.paga)}</td>
                    <td className="px-4 py-3 text-right text-blue-400">{moeda(g.liberada)}</td>
                    <td className="px-4 py-3 text-right text-amber-400">{moeda(g.bloqueada)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{moeda(g.retida + g.paga + g.liberada + g.bloqueada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Reserva</th>
                  <th className="px-4 py-3">Parceiro</th>
                  <th className="px-4 py-3">Criada em</th>
                  <th className="px-4 py-3 text-right">Total price</th>
                  <th className="px-4 py-3 text-right">Total paid</th>
                  <th className="px-4 py-3 text-right">Rack rate</th>
                  <th className="px-4 py-3 text-right">Diferença</th>
                  <th className="px-4 py-3 text-right">Comissão</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paga em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linhas.map((r) => {
                  const dif = r.total_paid - r.rack_rate
                  return (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-mono">
                      {r.hq_reservation_id}
                      {r.hq_status === 'cancelled' && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-foreground/80">Cancelada</span>
                      )}
                    </td>
                      <td className="px-4 py-3">{r.commission_partner}</td>
                      <td className="px-4 py-3">{data(r.created_at)}</td>
                      <td className="px-4 py-3 text-right">{moeda(r.total_price)}</td>
                      <td className="px-4 py-3 text-right">{moeda(r.total_paid)}</td>
                      <td className="px-4 py-3 text-right">{moeda(r.rack_rate)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${dif >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                        {dif >= 0 ? '+' : ''}{moeda(dif)}
                      </td>
                      <td className="px-4 py-3 text-right">{moeda(r.valor_comissao)}</td>
                      <td className="px-4 py-3"><StatusBadge status={statusDaReserva(r)} /></td>
                      <td className="px-4 py-3">{r.paga_em ? data(r.paga_em) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
