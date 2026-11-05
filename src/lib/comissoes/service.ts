import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as typedClient } from '@/integrations/supabase/client'
import type { Filtros, Reserva } from '@/lib/comissoes/types'

// A tabela `reservas` (módulo de comissões) não está nos tipos gerados do Supabase.
const supabase = typedClient as unknown as SupabaseClient

const PAGE = 1000
const COLUNAS =
  'id,hq_reservation_id,commission_partner,created_at,total_price,total_paid,rack_rate,commission_rate,commission_amount,commission_rate_manual,desconto,desconto_validado_em,exige_validacao,currency,retida_agencia,hq_status,status_repasse,paga_em,liberada,valor_comissao,manual_charge,incluir_manual_charge,valor_repasse,estorno_compensado_em,seller_name'

const num = (v: unknown) => Number(v ?? 0)

function normalizar(r: Reserva): Reserva {
  return {
    ...r,
    total_price: num(r.total_price),
    total_paid: num(r.total_paid),
    rack_rate: num(r.rack_rate),
    valor_comissao: num(r.valor_comissao),
    manual_charge: num(r.manual_charge),
    valor_repasse: num(r.valor_repasse),
    commission_rate: r.commission_rate == null ? null : num(r.commission_rate),
    commission_amount: r.commission_amount == null ? null : num(r.commission_amount),
    commission_rate_manual: r.commission_rate_manual == null ? null : num(r.commission_rate_manual),
    desconto: num(r.desconto),
  }
}

const base = () => supabase.from('reservas').select(COLUNAS)
type Query = ReturnType<typeof base>

async function buscar(filtros: Filtros, extra?: (q: Query) => Query): Promise<Reserva[]> {
  const linhas: Reserva[] = []
  // o PostgREST limita a 1000 linhas por requisição: pagina até acabar
  for (let from = 0; ; from += PAGE) {
    let q = base()
    if (filtros.parceiro) q = q.eq('commission_partner', filtros.parceiro)
    if (filtros.reserva.trim()) q = q.ilike('hq_reservation_id', `%${filtros.reserva.trim().replace(/[%_,()]/g, '')}%`)
    if (filtros.dataInicio) q = q.gte('created_at', `${filtros.dataInicio}T00:00:00`)
    if (filtros.dataFim) q = q.lte('created_at', `${filtros.dataFim}T23:59:59.999`)
    if (extra) q = extra(q)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    linhas.push(...(data as unknown as Reserva[]).map(normalizar))
    if (data.length < PAGE) return linhas
  }
}

/** Comissões liberadas (GioConcierge/TuristOrlando: na criação; demais: total_paid >= rack_rate) e ainda não repassadas. */
export const listarAPagar = (filtros: Filtros) =>
  buscar(filtros, (q) => q.eq('liberada', true).eq('status_repasse', 'pendente').eq('retida_agencia', false))

/** Comissões já pagas de reservas depois canceladas, ainda não descontadas de um repasse. */
export async function listarEstornos(parceiro: string): Promise<Reserva[]> {
  const linhas: Reserva[] = []
  for (let from = 0; ; from += PAGE) {
    let q = base().eq('status_repasse', 'paga').eq('hq_status', 'cancelled').is('estorno_compensado_em', null)
    if (parceiro) q = q.eq('commission_partner', parceiro)
    const { data, error } = await q.order('created_at').order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    linhas.push(...(data as unknown as Reserva[]).map(normalizar))
    if (data.length < PAGE) return linhas
  }
}

/** Todas as reservas importadas: pagas, liberadas e bloqueadas. */
export const listarHistorico = (filtros: Filtros) => buscar(filtros)

export async function listarParceiros(): Promise<string[]> {
  const set = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('reservas')
      .select('commission_partner')
      .order('commission_partner')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    data.forEach((d) => set.add(d.commission_partner))
    if (data.length < PAGE) break
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** Marca como paga apenas o que ainda é elegível e pendente; retorna quantas foram atualizadas. */
export async function marcarComoPagas(ids: string[], estornoIds: string[] = []): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase
    .from('reservas')
    .update({ status_repasse: 'paga', paga_em: new Date().toISOString() })
    .in('id', ids)
    .eq('liberada', true)
    .eq('status_repasse', 'pendente')
    .eq('retida_agencia', false)
    .select('id')
  if (error) throw new Error(error.message)
  if (estornoIds.length) {
    const { error: e2 } = await supabase
      .from('reservas')
      .update({ estorno_compensado_em: new Date().toISOString() })
      .in('id', estornoIds)
      .eq('status_repasse', 'paga')
      .eq('hq_status', 'cancelled')
      .is('estorno_compensado_em', null)
    if (e2) throw new Error(e2.message)
  }
  return data.length
}

/** Define (ou limpa, com null) o ajuste manual da comissão de uma reserva ainda não paga. */
export async function salvarComissaoManual(id: string, ajuste: { pct: number | null; valor: number | null }): Promise<void> {
  const { data, error } = await supabase
    .from('reservas')
    .update({ commission_rate_manual: ajuste.pct, commission_amount: ajuste.valor })
    .eq('id', id)
    .eq('status_repasse', 'pendente')
    .select('id')
  if (error) throw new Error(error.message)
  if (!data.length) throw new Error('Reserva não encontrada ou já paga: não é possível alterar a comissão.')
}

/** Dá o "ok" nos descontos das reservas informadas (ainda não pagas). Retorna quantas foram validadas. */
export async function validarDescontos(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const { data, error } = await supabase
    .from('reservas')
    .update({ desconto_validado_em: new Date().toISOString() })
    .in('id', ids)
    .eq('status_repasse', 'pendente')
    .select('id')
  if (error) throw new Error(error.message)
  return data.length
}

/** Define se o manual charge entra no repasse da reserva (ainda não paga). */
export async function definirIncluirManualCharge(id: string, incluir: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('reservas')
    .update({ incluir_manual_charge: incluir })
    .eq('id', id)
    .eq('status_repasse', 'pendente')
    .select('id')
  if (error) throw new Error(error.message)
  if (!data.length) throw new Error('Reserva não encontrada ou já paga: não é possível alterar o manual charge.')
}

/** Inclui (ou tira) o manual charge de várias reservas ainda não pagas de uma vez. */
export async function definirIncluirManualChargeEmLote(ids: string[], incluir: boolean): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('reservas')
    .update({ incluir_manual_charge: incluir })
    .in('id', ids)
    .eq('status_repasse', 'pendente')
  if (error) throw new Error(error.message)
}
