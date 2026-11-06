// Uso: node --env-file=.env.local scripts/comissoes/importar-parceiros.mjs parceiros.csv
// Importa as Internal Notes da aba Commission Partners do HQ (a API não expõe essa lista).
// CSV exportado do HQ: precisa das colunas "Name" e "Internal Notes".
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const arquivo = process.argv[2]
if (!arquivo || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Uso: informe o CSV e defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.')
  process.exit(1)
}

function linhasCsv(texto) {
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((x) => x !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  linha.push(campo)
  if (linha.some((x) => x !== '')) linhas.push(linha)
  return linhas
}

const [cab, ...dados] = linhasCsv(readFileSync(arquivo, 'utf8').replace(/^﻿/, ''))
const achar = (nome) => cab.findIndex((h) => h.trim().toLowerCase() === nome)
const iNome = achar('name'), iNotas = achar('internal notes')
if (iNome < 0 || iNotas < 0) {
  console.error(`Colunas "Name" e "Internal Notes" não encontradas. Cabeçalho: ${cab.join(' | ')}`)
  process.exit(1)
}

const linhas = dados
  .map((l) => ({ name: (l[iNome] ?? '').trim(), internal_notes: (l[iNotas] ?? '').trim() || null, updated_at: new Date().toISOString() }))
  .filter((l) => l.name)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { error } = await supabase.from('commission_partners').upsert(linhas, { onConflict: 'name' })
if (error) throw new Error(`Supabase: ${error.message}`)
console.log(`${linhas.length} parceiros gravados (${linhas.filter((l) => l.internal_notes).length} com notas).`)
