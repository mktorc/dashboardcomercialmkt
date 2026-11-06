import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMyRole } from '@/lib/roles'
import type { Filtros, Reserva } from './types'
import { listarNotasParceiros, listarParceiros } from './service'

export const filtrosVazios: Filtros = { parceiro: '', reserva: '', dataInicio: '', dataFim: '' }

export function useReservas(carregar: (f: Filtros) => Promise<Reserva[]>, filtros: Filtros) {
  const [linhas, setLinhas] = useState<Reserva[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setLinhas(await carregar(filtros))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar dados.')
    } finally {
      setCarregando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar, filtros.parceiro, filtros.reserva, filtros.dataInicio, filtros.dataFim])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  return { linhas, carregando, erro, recarregar }
}

export function useParceiros() {
  const [parceiros, setParceiros] = useState<string[]>([])
  useEffect(() => {
    listarParceiros().then(setParceiros).catch(() => setParceiros([]))
  }, [])
  return parceiros
}

/** Permissões na tela de comissões. Pagar: superadmin e financeiro. Validar desconto: só superadmin. Editar comissão: qualquer pessoa. O banco impõe as mesmas regras. */
export function usePerfil() {
  const { data: role = null } = useQuery({ queryKey: ['my-role'], queryFn: getMyRole })
  return {
    role,
    podePagar: role === 'superadmin' || role === 'financeiro', // marcar como paga
    podeValidar: role === 'superadmin', // validar descontos
    podeEditar: true, // ajustar comissão: liberado a qualquer pessoa com o link (reservas não pagas)
  }
}

export function useNotasParceiros() {
  const [notas, setNotas] = useState<Record<string, string>>({})
  useEffect(() => {
    listarNotasParceiros().then(setNotas).catch(() => setNotas({}))
  }, [])
  return notas
}
