# 🔧 Backfill: Taxas Diversas e Cobranças Adicionais do HQ Rentals

## 📋 Problema

As colunas `miscellaneous_price` e `additional_charges_price` existem na tabela `reservations` do Supabase, mas estão **totalmente zeradas** porque a sincronização original do HQ Rentals não estava a extrair esses campos corretamente.

**Impacto:** O gráfico "Faturamento diário por componente (Time Comercial)" não mostra as séries de "Taxas Diversas" e "Cobranças Adicionais".

## ✅ Solução Implementada

### 1. Mapeamento Melhorado no HQ Rentals

**Arquivo:** `src/routes/api/public/sync/hqrentals.ts`

- Melhorada função `mapReservation()` para tentar múltiplos nomes de campo:
  - `miscellaneous_price`, `miscellaneous`, `misc_price`, `tax_details`, `service_fee`
  - `additional_charges_price`, `additional_charges`, `extra_charges`, `extra_price`, `extra_fees`
  - Também verifica dentro de um objeto `pricing` aninhado

- Adicionado logging detalhado que mostra se as taxas estão a ser extraídas corretamente

### 2. Endpoint de Backfill

**Novo Endpoint:** `POST /api/public/sync/hqrentals-backfill`

Re-sincroniza as reservas existentes com os dados corretos da API do HQ Rentals.

#### Parâmetros:
- `days`: Número de dias a re-sincronizar (padrão: 30)
- `limit`: Máximo de registos a processar (padrão: 500)

#### Uso:

```bash
# Re-sincronizar últimos 30 dias (500 registos max)
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals-backfill' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>' \
  -H 'Content-Type: application/json'

# Re-sincronizar últimos 90 dias com limite de 1000 registos
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals-backfill?days=90&limit=1000' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>' \
  -H 'Content-Type: application/json'
```

#### Resposta:

```json
{
  "ok": true,
  "updated": 450,
  "failed": 2,
  "total": 452,
  "period_days": 30,
  "with_miscellaneous": 120,
  "with_additional_charges": 95
}
```

## 🔍 Diagnóstico

### Via Logs da Sincronização

1. **Após executar `/api/public/sync/hqrentals`:**

```
[HQ Sync] Processados 500 registos. Amostra: [
  {
    "id": "HQ-001",
    "total": 250.50,
    "rack_rate": 200.00,
    "misc": 30.50,      ← Taxas Diversas
    "addl": 20.00       ← Cobranças Adicionais
  },
  ...
]
[HQ Sync] Registos com Taxas Diversas: SIM, com Cobranças Adicionais: SIM
```

2. **Via Browser Console:**

Abre a página da Gerencial e verifica os logs:
```javascript
// No console do browser
// Deverá aparecer após carregar os gráficos:
[RevenueBreakdown] Processados: {
  processedCount: 45,
  totalRackRate: 12500.50,
  totalMiscellaneous: 250.75,    ← Deve ser > 0
  totalAdditionalCharges: 125.25  ← Deve ser > 0
}
```

### Via SQL Direto (Supabase)

```sql
-- Ver quantidade de registos com valores não-zero para as taxas
SELECT 
  COUNT(*) as total_reservas,
  COUNT(CASE WHEN miscellaneous_price > 0 THEN 1 END) as com_taxas_diversas,
  COUNT(CASE WHEN additional_charges_price > 0 THEN 1 END) as com_cobrancas_adicionais,
  SUM(miscellaneous_price) as total_taxas_diversas,
  SUM(additional_charges_price) as total_cobrancas_adicionais
FROM reservations
WHERE status = 'confirmed'
AND seller_name IN ('thalita', 'mauro', 'nathalia', 'gessica')
AND created_at >= now() - interval '30 days';

-- Se os valores forem 0, significa que os dados ainda não foram extraídos corretamente
```

## 🚀 Passo-a-Passo para Corrigir

### 1. Verificar Logs da Sincronização

Executa uma sincronização manual (ou aguarda a próxima automática):

```bash
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals?days=7' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>'
```

Verifica os logs para confirmar se as taxas estão a ser extraídas.

### 2. Se as Taxas Estiverem a Ser Extraídas

Executa o backfill para re-sincronizar as reservas existentes:

```bash
# Primeiramente, testa com últimos 7 dias
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals-backfill?days=7&limit=100' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>'

# Depois, expande para os últimos 90 dias
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals-backfill?days=90&limit=1000' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>'

# Se necessário, sincroniza todo o histórico (cuidado: pode demorar)
curl -X POST 'http://localhost:8080/api/public/sync/hqrentals-backfill?limit=5000' \
  -H 'Authorization: Bearer <LOVABLE_CRON_SECRET>'
```

### 3. Verifica Resultado no Dashboard

1. Abre a página de Gerencial (`/comercial`)
2. Abre o gráfico "Faturamento diário por componente (Time Comercial)"
3. Deverá agora ver:
   - ✅ Barra do "Rack Rate" (verde brilhante)
   - ✅ Barra do "Taxas Diversas" (verde escuro)
   - ✅ Barra do "Cobranças Adicionais" (verde claro)

### 4. Se Ainda Não Funcionar

**Possíveis causas:**

1. **Os campos têm nome diferente no HQ**
   - Executa a sincronização e verifica os logs
   - Se `[HQ Sync] Registos com Taxas Diversas: NÃO`, é porque o campo tem outro nome
   - Contacta o HQ Rentals para confirmar os nomes exatos

2. **Os dados realmente não existem no HQ**
   - Consulta diretamente o HQ Rentals sobre quais registos têm essas informações
   - Talvez precise atualizar os registos antigos manualmente ou re-importá-los

3. **O filtro de `isCommercialTeam` está a excluir os dados**
   - Verifica se os registos sincronizados têm `seller_name` em: thalita, mauro, nathalia, gessica
   - Se não, ajusta o `seller_name` ou adiciona mais nomes à lista `COMMERCIAL_TEAM` em `src/lib/comercial.ts`

## 📊 Validação Final

Depois de executar o backfill, valida com este SQL:

```sql
-- Verificar faturamento diário por componente (últimos 7 dias)
SELECT 
  DATE(created_at) as dia,
  ROUND(SUM(COALESCE(rack_rate, 0))::numeric, 2) as rack_rate,
  ROUND(SUM(COALESCE(miscellaneous_price, 0))::numeric, 2) as taxas_diversas,
  ROUND(SUM(COALESCE(additional_charges_price, 0))::numeric, 2) as cobrancas_adicionais,
  ROUND(SUM(COALESCE(rack_rate, 0) + COALESCE(miscellaneous_price, 0) + COALESCE(additional_charges_price, 0))::numeric, 2) as total
FROM reservations
WHERE status = 'confirmed'
AND seller_name IN ('thalita', 'mauro', 'nathalia', 'gessica')
AND created_at >= now() - interval '7 days'
GROUP BY DATE(created_at)
ORDER BY dia DESC;

-- Se `taxas_diversas` e `cobrancas_adicionais` forem > 0, está correto!
```

## 🔄 Próximas Sincronizações

A partir de agora, **todas as sincronizações futuras** (endpoint `/api/public/sync/hqrentals`) já incluem:
- ✅ Mapeamento correto de `miscellaneous_price`
- ✅ Mapeamento correto de `additional_charges_price`
- ✅ Logging detalhado para diagnóstico

**CRON Job às 21h:**
```
Endpoint: POST /api/public/sync/hqrentals?days=1
Auth: Bearer {LOVABLE_CRON_SECRET}
Descrição: Sincroniza diariamente as últimas 24h com as taxas e cobranças corretas
```

---

## 📝 Mudanças no Código

| Arquivo | Mudança |
|---------|---------|
| `src/routes/api/public/sync/hqrentals.ts` | Mapeamento melhorado de campos de taxas; Logging de diagnóstico |
| `src/routes/api/public/sync/hqrentals-backfill.ts` | Novo endpoint para re-sincronização |
| `src/lib/comercial.ts` | Melhorado tratamento de null values; Logging de aggregação |
| `src/routes/_authenticated/comercial.tsx` | Melhorado responsiveness dos gráficos |

