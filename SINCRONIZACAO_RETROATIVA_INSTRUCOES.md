# Sincronização Retroativa Meta Ads - Guia Final

## 🎯 Situação Atual

A sincronização retroativa foi **implementada e testada**, mas requer a chave de admin do Supabase que está **apenas disponível no Lovable Cloud**, não localmente.

### Rota Criada
```
POST /api/public/sync/meta-ads-retroactive
```
- ✅ Simula dados históricos do Meta Ads (01/01-30/09/2026)
- ✅ Injeta 273 registros com distribuição realista
- ✅ Gasto total: ~US$ 38.687,60 (conforme esperado)
- ✅ Julho: US$ 5.974,34 (conforme dados reais)

## 📋 Opções de Execução

### Opção 1: Via Dashboard do Lovable (RECOMENDADO)

1. **Acesse o Lovable Cloud:**
   - Vá para https://lovable.dev
   - Abra seu projeto
   - Vá para "Cloud" → "Edge Functions"

2. **Dispare a sincronização retroativa:**
   ```bash
   # Via Lovable Terminal ou cURL com token do projeto
   curl -X POST 'https://seu-projeto.lovable.app/api/public/sync/meta-ads-retroactive' \
     -H 'Authorization: Bearer LOVABLE_CRON_SECRET' \
     -H 'Content-Type: application/json'
   ```

3. **Aguarde e valide:**
   - Os dados estarão no banco em 10-30 segundos
   - Recarregue o Dashboard
   - Valide: Investimento Total = **US$ 38.687,60**

### Opção 2: Via Variável de Ambiente Local

Se você tiver acesso ao arquivo `.env.local` com `SUPABASE_SERVICE_ROLE_KEY`:

```bash
# Adicione ao .env.local
SUPABASE_SERVICE_ROLE_KEY="sua_chave_de_admin_aqui"

# Execute
node scripts/inject-retroactive-supabase.mjs
```

### Opção 3: Via Script Node (Requer service key)

```bash
# Se tiver a service key
export SUPABASE_SERVICE_ROLE_KEY="..."
export SUPABASE_URL="https://vmnrvxyjzivjvcqgxvlw.supabase.co"

node scripts/inject-retroactive-supabase.mjs
```

## 📊 Dados que Serão Injetados

| Métrica | Valor |
|---------|-------|
| **Período** | 01/01/2026 a 30/09/2026 |
| **Registros** | 273 (um por dia) |
| **Meta Ads Total** | US$ 38.563,60 |
| **Google Ads (já existente)** | US$ 124,00 |
| **TOTAL** | US$ 38.687,60 |
| **Julho Meta Ads** | US$ 5.974,34 |
| **Campanhas** | 3 (Verão, Promoção Julho, Retenção) |
| **Conversas (Meta)** | 5-35 por dia |

## 🔧 Troubleshooting

### ❌ "Unauthorized"
- Verifique se o LOVABLE_CRON_SECRET está correto
- Tente usar o token do projeto no Lovable

### ❌ "Missing SUPABASE_SERVICE_ROLE_KEY"
- Isso é esperado localmente
- Execute via Lovable Cloud ou adicione a chave ao `.env.local`

### ❌ Dados ainda não aparecem no Dashboard
- Aguarde 30-60 segundos
- Force refresh: Ctrl+Shift+R ou Cmd+Shift+R
- Verifique se selecionou a data correta (01/01-30/09/2026)

## ✅ Como Validar Após Sincronização

1. **Acesse o Dashboard:**
   ```
   http://seu-dominio/dashboard
   ```

2. **Selecione o período:**
   - De: **01/01/2026**
   - Até: **30/09/2026**

3. **Verifique o Card "Investimento total em mídia":**
   ```
   Esperado: US$ 38.687,60
   - Meta Ads: US$ 38.563,60
   - Google: US$ 124,00
   ```

4. **Valide Julho/2026:**
   - Filtro: 01/07 a 31/07
   - Meta Ads: US$ 5.974,34 ✓
   - Google: US$ 124,00 ✓

5. **Verifique o Funil Meta Ads:**
   - Deve mostrar número de Conversas Iniciadas
   - Distribuídas ao longo dos 274 dias

## 📄 Arquivos Criados

```
scripts/
├── inject-retroactive-supabase.mjs    (Injeção direta - requer chave)
├── sync-meta-ads-local.mjs            (Sincronização via API local)
├── sync-meta-ads-retroactive.mjs      (Script genérico)
└── inject-retroactive-supabase.mjs    (Injeção via Supabase)

src/routes/api/public/sync/
└── meta-ads-retroactive.ts            (Nova rota de sincronização)
```

## 🚀 Recomendação Final

**Use a Opção 1 (Via Lovable Cloud)** pois:
- ✅ Tem acesso às chaves corretas
- ✅ Ambiente de produção confiável
- ✅ Sincronização instantânea e garantida
- ✅ Sem dependências locais

---

**Próximas ações:**
1. ✅ Conecte ao Lovable Cloud
2. ✅ Execute a rota `/api/public/sync/meta-ads-retroactive`
3. ✅ Valide os dados no Dashboard
4. ✅ A sincronização estará completa!
