# Sincronização Retroativa Meta Ads - Guia de Execução

## 📋 Resumo

Este guia fornece as instruções para executar a carga retroativa de dados do Meta Ads para o período de **01/01/2026 a 30/09/2026**, que inclui os dados de **Julho/2026** que estavam zerados no banco.

## 🎯 Objetivos

1. ✅ Sincronizar dados históricos do Meta Ads (274 dias)
2. ✅ Validar que o gasto de Julho/2026 = **US$ 5.974,34**
3. ✅ Confirmar investimento total em mídia = **US$ 38.687,60**
4. ✅ Validar que Google Ads (US$ 124,00 em Julho) está correto

## 🚀 Passo 1: Preparar o Ambiente

### Opção A: Injeção Direta no Supabase (Recomendado)

**Pré-requisito:** Obtenha a `SUPABASE_SERVICE_KEY` do dashboard Supabase

1. Acesse: https://app.supabase.com/project/vmnrvxyjzivjvcqgxvlw
2. Vá para Settings → API → Service Key (copie)
3. Execute:

```bash
# No terminal do projeto, na raiz
export SUPABASE_SERVICE_KEY="sua_service_key_aqui"
node scripts/inject-meta-ads-retroactive.mjs
```

### Opção B: Sincronização via API (Se servidor estiver rodando)

```bash
# Terminal 1: Inicie o servidor
npm run dev

# Terminal 2: Execute a sincronização
node scripts/sync-meta-ads-local.mjs
```

### Opção C: Chamar Manualmente via cURL

```bash
# Certifique-se que o servidor está rodando (npm run dev)
curl -X POST 'http://localhost:5173/api/public/sync/meta-ads?days=274' \
  -H 'Authorization: Bearer test-sync-token-local' \
  -H 'Content-Type: application/json'
```

### Opção D: Via Lovable Dashboard / Scheduled Functions

Se a sincronização está configurada como função agendada no Lovable, dispare-a manualmente a partir do painel de controle de Funções Agendadas com `days=274`.

## ⏳ Passo 2: Aguardar Processamento

- **Tempo esperado**: 30-60 segundos
- A sincronização consultará a Meta Graph API para todos os 274 dias
- Os dados serão gravados na tabela `meta_ads_metrics`

## 🔍 Passo 3: Validação no Painel

Após a sincronização:

### 3.1 Recarregue o Dashboard
```
http://localhost:5173/dashboard
```

### 3.2 Verifique o Investimento Total em Mídia
- **Período**: 01/01/2026 a 30/09/2026
- **Valor esperado**: US$ 38.687,60
- **Card KPI**: "Investimento total em mídia"

### 3.3 Valide o Breakdown por Canal
Clique em "Investimento total em mídia" → veja o breakdown:
- **Meta Ads**: US$ 38.563,60
- **Google Ads**: US$ 124,00
- **Total**: US$ 38.687,60

### 3.4 Verifique Julho/2026 Especificamente
Na Tabela de Atribuição e ROI ou no gráfico "Evolução Diária":
- Filtro de datas: **01/07/2026 a 31/07/2026**
- Valor esperado Meta Ads: **US$ 5.974,34**

## 📊 Validação Detalhada

### Checklist de Validação

```
[ ] Investimento Total = US$ 38.687,60
[ ] Meta Ads Julho = US$ 5.974,34
[ ] Google Ads Julho = US$ 124,00
[ ] Funil Meta Ads mostra número correto de conversas iniciadas
[ ] Leads do ClickMassa foram deduplicados corretamente
[ ] ROAS calculado com valores corretos
[ ] CPL refletido corretamente (Invest / Leads)
```

## 🔧 Troubleshooting

### Problema: "Unauthorized"
**Solução**: Verifique se o `LOVABLE_CRON_SECRET` está correto

### Problema: Dados ainda aparecem zerados
**Solução**: 
1. Aguarde 60 segundos completos
2. Force refresh do navegador (Ctrl+Shift+R ou Cmd+Shift+R)
3. Verifique no banco: `SELECT COUNT(*) FROM meta_ads_metrics WHERE date >= '2026-01-01'`

### Problema: Valor total diferente do esperado
**Solução**:
1. Verifique se há dados duplicados ou inconsistências
2. Revise o período selecionado no Dashboard
3. Confirme que a deduplicação de leads está funcionando

## 📝 Notas Importantes

- A sincronização é **idempotente**: pode ser executada múltiplas vezes sem causar duplicação (usa `onConflict: "date,campaign_id"`)
- O período de **274 dias** cobre 01/01/2026 a 30/09/2026 completamente
- A sincronização puxa dados do Meta Ads Manager, que é a fonte de verdade
- Os cálculos de KPI são recalculados automaticamente após a ingestão

## ✅ Conclusão

Após validar todos os checklist acima, a sincronização retroativa do Meta Ads estará **completa** e o Dashboard refletirá os valores corretos de investimento em mídia.
