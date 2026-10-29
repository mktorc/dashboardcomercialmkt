import { Fragment, useEffect, useMemo, useState } from 'react'
import { Card, Carregando, Erro, Vazio } from './Estados'
import { EditarComissaoDialog } from './EditarComissaoDialog'
import { FiltrosBar } from './FiltrosBar'
import { filtrosVazios, useParceiros, usePerfil, useReservas } from '@/lib/comissoes/hooks'
import { data, moeda } from '@/lib/comissoes/format'
import { definirIncluirManualCharge, listarAPagar, listarEstornos, marcarComoPagas, validarDescontos } from '@/lib/comissoes/service'
import { descontoPct, podeEditarComissao, precisaValidar, temAjusteManual, type Filtros, type Reserva } from '@/lib/comissoes/types'

interface GrupoParceiro {
  parceiro: string
  reservas: Reserva[]
  estornos: Reserva[]
  bruto: number
  desconto: number
  total: number // líquido: bruto - estornos
  travado: boolean // há reserva com desconto ainda não validada: pagamento do parceiro bloqueado
}

export default function ComissoesAPagar() {
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios)
  const parceiros = useParceiros()
  const { podePagar, podeEditar } = usePerfil()
  const { linhas, carregando, erro, recarregar } = useReservas(listarAPagar, filtros)
  const [estornos, setEstornos] = useState<Reserva[]>([])
  useEffect(() => {
    listarEstornos(filtros.parceiro).then(setEstornos).catch(() => setEstornos([]))
  }, [filtros.parceiro, linhas])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [editando, setEditando] = useState<Reserva | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const grupos = useMemo<GrupoParceiro[]>(() => {
    const mapa = new Map<string, GrupoParceiro>()
    const grupo = (p: string) => {
      const g = mapa.get(p) ?? { parceiro: p, reservas: [], estornos: [], bruto: 0, desconto: 0, total: 0, travado: false }
      mapa.set(p, g)
      return g
    }
    for (const r of linhas) {
      const g = grupo(r.commission_partner)
      g.reservas.push(r)
      g.bruto += r.valor_repasse
    }
    // só desconta estorno de parceiro que tem comissão a receber nesta lista
    for (const e of estornos) {
      const g = mapa.get(e.commission_partner)
      if (!g) continue
      g.estornos.push(e)
      g.desconto += e.valor_repasse
    }
    for (const g of mapa.values()) {
      g.total = g.bruto - g.desconto
      g.travado = g.reservas.some(precisaValidar)
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total)
  }, [linhas, estornos])

  const resumo = useMemo(
    () => ({ total: grupos.reduce((s, g) => s + g.total, 0), qtd: linhas.length, parceiros: grupos.length }),
    [grupos, linhas],
  )

  // descarta seleções de parceiros que saíram da lista (por filtro ou recarga)
  const marcados = grupos.filter((g) => selecionados.has(g.parceiro))
  const todos = grupos.length > 0 && marcados.length === grupos.length

  const alternar = (set: Set<string>, chave: string) => {
    const n = new Set(set)
    n.has(chave) ? n.delete(chave) : n.add(chave)
    return n
  }

  async function alternarManualCharge(r: Reserva) {
    setSalvando(true)
    setAviso(null)
    try {
      await definirIncluirManualCharge(r.id, !r.incluir_manual_charge)
      await recarregar()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao salvar.' })
    } finally {
      setSalvando(false)
    }
  }

  async function validar(rs: Reserva[]) {
    setSalvando(true)
    setAviso(null)
    try {
      const n = await validarDescontos(rs.map((r) => r.id))
      setAviso({ tipo: 'ok', texto: `${n} desconto(s) validado(s).` })
      await recarregar()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao validar.' })
    } finally {
      setSalvando(false)
    }
  }

  async function pagar(alvo: Reserva[], descricao: string, descontos: Reserva[] = []) {
    if (!alvo.length || !podePagar) return
    const travados = grupos.filter((g) => g.travado && alvo.some((r) => r.commission_partner === g.parceiro)).map((g) => g.parceiro)
    if (travados.length) {
      setAviso({ tipo: 'erro', texto: `Pagamento bloqueado: valide primeiro os descontos de ${travados.join(', ')}.` })
      return
    }
    const bruto = alvo.reduce((s, r) => s + r.valor_repasse, 0)
    const desc = descontos.reduce((s, r) => s + r.valor_repasse, 0)
    if (bruto - desc < 0) {
      setAviso({ tipo: 'erro', texto: `${descricao}: os estornos (${moeda(desc)}) superam as comissões (${moeda(bruto)}); nada a pagar agora.` })
      return
    }
    const detalhe = desc ? `\nComissões: ${moeda(bruto)} − estornos de canceladas: ${moeda(desc)}` : ''
    if (!window.confirm(`Marcar como paga(s) ${alvo.length} comissão(ões) — ${descricao}?${detalhe}\nTotal a pagar: ${moeda(bruto - desc)}`)) return
    setSalvando(true)
    setAviso(null)
    try {
      const n = await marcarComoPagas(alvo.map((r) => r.id), descontos.map((r) => r.id))
      setAviso({ tipo: 'ok', texto: `${n} comissão(ões) marcada(s) como paga(s).` })
      setSelecionados(new Set())
      await recarregar()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao salvar.' })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Comissões a Pagar</h1>
        <p className="text-sm text-muted-foreground">
          Um parceiro por linha, somando as reservas com total pago ≥ rack rate e repasse ainda não realizado.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card titulo="Total a pagar no período" valor={moeda(resumo.total)} />
        <Card titulo="Comissões liberadas" valor={String(resumo.qtd)} />
        <Card titulo="Parceiros a receber" valor={String(resumo.parceiros)} />
      </div>

      <FiltrosBar filtros={filtros} parceiros={parceiros} onChange={setFiltros} />

      {aviso && (
        <div role="alert" className={`rounded-md p-3 text-sm ${aviso.tipo === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
          {aviso.texto}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm text-muted-foreground">{marcados.length} parceiro(s) selecionado(s)</span>
          <button
            hidden={!podePagar}
            disabled={!marcados.length || salvando || marcados.some((g) => g.travado)}
            title={marcados.some((g) => g.travado) ? 'Há parceiro selecionado com desconto a validar' : undefined}
            onClick={() => pagar(marcados.flatMap((g) => g.reservas), `${marcados.length} parceiro(s)`, marcados.flatMap((g) => g.estornos))}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : 'Marcar selecionados como pagos'}
          </button>
        </div>

        {carregando ? (
          <Carregando />
        ) : erro ? (
          <Erro mensagem={erro} onRetry={recarregar} />
        ) : grupos.length === 0 ? (
          <Vazio mensagem="Nenhuma comissão liberada para pagamento com os filtros atuais." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" aria-label="Selecionar todos" disabled={!podePagar} checked={todos}
                      onChange={() => setSelecionados(todos ? new Set() : new Set(grupos.map((g) => g.parceiro)))} />
                  </th>
                  <th className="px-4 py-3">Parceiro</th>
                  <th className="px-4 py-3 text-right">Reservas</th>
                  <th className="px-4 py-3 text-right">Total a pagar</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grupos.map((g) => {
                  const aberto = abertos.has(g.parceiro)
                  return (
                    <Fragment key={g.parceiro}>
                      <tr className="hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <input type="checkbox" aria-label={`Selecionar ${g.parceiro}`}
                            disabled={!podePagar} checked={selecionados.has(g.parceiro)}
                            onChange={() => setSelecionados(alternar(selecionados, g.parceiro))} />
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <button onClick={() => setAbertos(alternar(abertos, g.parceiro))} aria-expanded={aberto}
                            className="flex items-center gap-2 text-left">
                            <span className="text-muted-foreground">{aberto ? '▾' : '▸'}</span>
                            {g.parceiro}
                          </button>
                          {g.travado && (
                            <div className="mt-1 text-xs font-normal text-amber-400">
                              Pagamento travado: {g.reservas.filter(precisaValidar).length} reserva(s) com desconto a validar
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{g.reservas.length}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {moeda(g.total)}
                          {g.desconto > 0 && (
                            <div className="text-xs font-normal text-destructive">
                              {moeda(g.bruto)} − {moeda(g.desconto)} de estornos
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {g.travado && (
                            <button hidden={!podePagar} disabled={salvando} onClick={() => validar(g.reservas.filter(precisaValidar))}
                              className="mr-3 text-amber-400 hover:underline disabled:opacity-50">Validar descontos</button>
                          )}
                          <button hidden={!podePagar} disabled={salvando || g.travado} onClick={() => pagar(g.reservas, g.parceiro, g.estornos)}
                            className="text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50">Marcar pago</button>
                        </td>
                      </tr>
                      {aberto && (
                        <tr>
                          <td colSpan={5} className="bg-muted/40 px-4 py-3">
                            <table className="min-w-full text-xs">
                              <thead className="text-left uppercase tracking-wide text-muted-foreground">
                                <tr>
                                  <th className="py-1 pr-4">Reserva</th>
                                  <th className="py-1 pr-4">Criada em</th>
                                  <th className="py-1 pr-4 text-right">Total pago</th>
                                  <th className="py-1 pr-4 text-right">Rack rate</th>
                                  <th className="py-1 pr-4 text-right">Comissão</th>
                                  <th className="py-1 pr-4 text-right">Manual charge</th>
                                  <th className="py-1 pr-4 text-right">Total a repassar</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {g.reservas.map((r) => (
                                  <tr key={r.id} className="border-t border-border">
                                    <td className="py-1.5 pr-4 font-mono">
                                      {r.hq_reservation_id}
                                      {r.hq_status === 'cancelled' && (
                                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-foreground/80">Cancelada</span>
                                      )}
                                      {r.exige_validacao && (
                                        <span className={`ml-2 rounded px-1.5 py-0.5 font-sans ${r.desconto_validado_em ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                                          Desconto {descontoPct(r).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%{' '}
                                          {r.desconto_validado_em ? 'validado' : temAjusteManual(r) ? '· a validar' : '· a validar, comissão não reduzida'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-4">{data(r.created_at)}</td>
                                    <td className="py-1.5 pr-4 text-right">{moeda(r.total_paid)}</td>
                                    <td className="py-1.5 pr-4 text-right">{moeda(r.rack_rate)}</td>
                                    <td className="py-1.5 pr-4 text-right font-medium">
                                      {moeda(r.valor_comissao)}
                                      {temAjusteManual(r) && <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 font-sans text-xs font-normal text-accent">Manual</span>}
                                    </td>
                                    <td className="py-1.5 pr-4 text-right">
                                      {r.manual_charge > 0 ? (
                                        <label className="inline-flex items-center gap-2" title="Repassar o manual charge junto com a comissão">
                                          <input type="checkbox" checked={r.incluir_manual_charge}
                                            disabled={salvando || !podeEditar || !podeEditarComissao(r)}
                                            onChange={() => alternarManualCharge(r)} />
                                          {moeda(r.manual_charge)}
                                        </label>
                                      ) : '—'}
                                    </td>
                                    <td className="py-1.5 pr-4 text-right font-semibold">{moeda(r.valor_repasse)}</td>
                                    <td className="py-1.5 text-right">
                                      {podeEditar && podeEditarComissao(r) && (
                                        <button disabled={salvando} onClick={() => setEditando(r)}
                                          className="mr-3 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50">Editar</button>
                                      )}
                                      {precisaValidar(r) && (
                                        <button hidden={!podePagar} disabled={salvando} onClick={() => validar([r])}
                                          className="mr-3 text-amber-400 hover:underline disabled:opacity-50">Validar</button>
                                      )}
                                      <button hidden={!podePagar} disabled={salvando || g.travado} onClick={() => pagar([r], r.hq_reservation_id)}
                                        className="text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50">Marcar paga</button>
                                    </td>
                                  </tr>
                                ))}
                                {g.estornos.map((r) => (
                                  <tr key={r.id} className="border-t border-border text-destructive">
                                    <td className="py-1.5 pr-4 font-mono">
                                      {r.hq_reservation_id}
                                      <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 font-sans">Estorno (cancelada, já paga)</span>
                                    </td>
                                    <td className="py-1.5 pr-4">{data(r.created_at)}</td>
                                    <td className="py-1.5 pr-4 text-right">{moeda(r.total_paid)}</td>
                                    <td className="py-1.5 pr-4 text-right">{moeda(r.rack_rate)}</td>
                                    <td className="py-1.5 pr-4 text-right font-medium">−{moeda(r.valor_comissao)}</td>
                                    <td className="py-1.5 pr-4 text-right">{r.incluir_manual_charge ? `−${moeda(r.manual_charge)}` : '—'}</td>
                                    <td className="py-1.5 pr-4 text-right font-medium">−{moeda(r.valor_repasse)}</td>
                                    <td />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <EditarComissaoDialog reserva={editando} onClose={() => setEditando(null)} onSalvo={recarregar} />
    </div>
  )
}
