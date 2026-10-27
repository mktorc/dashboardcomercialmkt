export type StatusRepasse = 'pendente' | 'paga'

export interface Reserva {
  id: string
  hq_reservation_id: string
  commission_partner: string
  created_at: string
  total_price: number
  total_paid: number
  rack_rate: number
  commission_rate: number | null
  commission_amount: number | null
  commission_rate_manual: number | null
  desconto: number
  desconto_validado_em: string | null
  exige_validacao: boolean
  currency: string
  retida_agencia: boolean
  hq_status: string | null
  status_repasse: StatusRepasse
  paga_em: string | null
  liberada: boolean
  valor_comissao: number
  estorno_compensado_em: string | null
}

/** Status exibido na interface, derivado de status_repasse + liberada. */
export type StatusExibicao = 'retida' | 'paga' | 'liberada' | 'bloqueada'

export interface Filtros {
  parceiro: string
  dataInicio: string // yyyy-mm-dd
  dataFim: string // yyyy-mm-dd
}

export const statusDaReserva = (r: Reserva): StatusExibicao =>
  r.retida_agencia ? 'retida' : r.status_repasse === 'paga' ? 'paga' : r.liberada ? 'liberada' : 'bloqueada'

/** Há ajuste manual (valor fixo ou percentual) no lugar do percentual padrão do parceiro. */
export const temAjusteManual = (r: Reserva) => r.commission_amount != null || r.commission_rate_manual != null

/** Só reservas ainda não pagas e não retidas na agência podem ter a comissão ajustada. */
export const podeEditarComissao = (r: Reserva) => r.status_repasse === 'pendente' && !r.retida_agencia

/** Comissão com os parâmetros dados, na mesma ordem do banco: valor fixo > percentual manual > percentual padrão. */
export const calcularComissao = (r: Reserva, pctManual: number | null, valorFixo: number | null) =>
  valorFixo != null ? valorFixo : Math.round(r.rack_rate * (pctManual ?? r.commission_rate ?? 0)) / 100

/** Desconto sobre o rack rate original (rack_rate já vem com o desconto abatido), em %. */
export const descontoPct = (r: Reserva) => (r.desconto > 0 ? (r.desconto / (r.rack_rate + r.desconto)) * 100 : 0)

/** Reserva com desconto que ainda precisa do "ok" antes de ser paga. */
export const precisaValidar = (r: Reserva) => r.exige_validacao && !r.desconto_validado_em
