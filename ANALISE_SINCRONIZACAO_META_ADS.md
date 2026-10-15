# 📊 Análise Detalhada: Sincronização Oficial Meta Ads API

## 🔗 Localização do Código

**Arquivo:** `src/routes/api/public/sync/meta-ads.ts`  
**Rota:** `POST /api/public/sync/meta-ads?days=274`  
**API Base:** `https://graph.facebook.com/v19.0`

---

## 🔐 1. Autenticação e Configuração

### Credenciais Utilizadas
```typescript
const account = process.env["META_AD_ACCOUNT_ID"];      // ID da conta de anúncios
const token = process.env["META_ADS_SYSTEM_USER_TOKEN"]; // Token de acesso (fallback: META_ACCESS_TOKEN)
```

### Validação de Conta
```typescript
// Linha 39: Valida se o account_id tem acesso
await call(`${GRAPH}/${account}?fields=account_id&access_token=${token}`);

// Se falhar, descobre a conta disponível (linhas 41-53)
const ads = await call(`${GRAPH}/me/adaccounts?fields=account_id&access_token=${token}`);
```

---

## 📅 2. Cálculo do Período de Sincronização

### Parâmetro de Entrada
```typescript
const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
// Padrão: 30 dias | Máximo: 365 dias | Você pode usar ?days=274
```

### Cálculo das Datas
```typescript
const until = new Date();                                    // Hoje (data atual do servidor)
const since = new Date(Date.now() - (days - 1) * 86400000); // Hoje - X dias
const d = (x: Date) => x.toISOString().slice(0, 10);        // Formato YYYY-MM-DD

// Exemplo com ?days=274:
// desde: 01/01/2026 (274 dias atrás de hoje)
// até: 30/09/2026 (data atual)
```

### ⚠️ PROBLEMA IDENTIFICADO
```typescript
// Linha 23-24:
const until = new Date();  // ← USA A DATA ATUAL DO SERVIDOR
const since = new Date(Date.now() - (days - 1) * 86400000);

// Se hoje é 15/10/2026 e você usa ?days=274:
// desde: 01/01/2026 ✓
// até: 15/10/2026 (NÃO 30/09/2026!)
```

**👉 Solução:** A query está correta, mas captura ALÉM de 30/09 se hoje é depois dessa data.

---

## 🎯 3. Chamadas à Graph API Meta

### **Passo 1: Buscar UTM Campaigns** (Linhas 58-71)
```typescript
next = `${GRAPH}/${usedAccount}/ads?fields=campaign_id,creative{url_tags}&limit=500&access_token=${token}`;

// Extrai utm_campaign dos url_tags dos anúncios
// Exemplo: "https://exemplo.com?utm_campaign=orc_orlando_conversao"
```

**Parâmetros:**
- `fields`: `campaign_id`, `creative{url_tags}`
- `limit`: 500
- Pagina automaticamente (field `paging.next`)

---

### **Passo 2: Buscar Insights por Campanha** (Linhas 73-92) ⭐ **CRÍTICO**

```typescript
const range = encodeURIComponent(JSON.stringify({ 
  since: d(since),    // "2026-01-01"
  until: d(until)     // "2026-09-30" (ou data atual se após 30/09)
}));

next = `${GRAPH}/${usedAccount}/insights?level=campaign&time_increment=1&time_range=${range}&fields=campaign_id,campaign_name,spend,clicks,impressions,actions&limit=500&access_token=${token}`;
```

**Parâmetros da Query:**

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `level` | `campaign` | Agrupamento por campanha |
| `time_increment` | `1` | Um dia por linha |
| `time_range` | JSON | `{"since":"2026-01-01","until":"2026-09-30"}` |
| `fields` | Lista | Métricas a puxar |
| `limit` | `500` | Registros por página |

**Campos Solicitados:**
```typescript
{
  campaign_id,           // ID da campanha
  campaign_name,         // Nome da campanha
  spend,                 // Gasto em USD
  clicks,                // Cliques
  impressions,           // Impressões
  actions                // Array de ações (conversas, etc.)
}
```

---

## 💰 4. Extração de Dados (Linhas 78-89)

```typescript
for (const r of (j["data"] as Obj[]) ?? []) {
  const cid = String(r["campaign_id"]);
  rows.push({
    date: r["date_start"],                    // Data do insight
    campaign_id: cid,
    campaign_name: String(r["campaign_name"]),
    spend: Number(r["spend"]) || 0,           // ← VALOR EM USD DIRETO DA API
    clicks: Number(r["clicks"]) || 0,
    impressions: Number(r["impressions"]) || 0,
    
    // Extrai conversas iniciadas (onsite_conversion.messaging_conversation_started_7d)
    conversations: Number(
      ((r["actions"] as Obj[] | undefined) ?? [])
        .find((a) => a["action_type"] === "onsite_conversion.messaging_conversation_started_7d")
        ?.["value"]
    ) || 0,
    
    utm_campaign: utmByCampaign.get(cid) ?? null
  });
}
```

### 📌 Ponto Importante: SPEND

```typescript
spend: Number(r["spend"]) || 0,  // ← VEM DIRETO DA META API EM USD
```

**O gasto retornado pela Meta Graph API já está em USD!**

---

## 💾 5. Armazenamento no Banco (Linhas 94-100)

```typescript
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabaseAdmin
    .from("meta_ads_metrics")
    .upsert(rows.slice(i, i + 500) as never, { 
      onConflict: "date,campaign_id"  // ← Atualiza se já existe
    });
}
```

**Detalhe:** Usa UPSERT com conflito em `(date, campaign_id)`.

---

## 🔍 6. Resposta da API

```typescript
return Response.json({
  ok: true,
  synced: rows.length,           // Quantos registros foram sincronizados
  since: d(since),               // Data inicial (ex: "2026-01-01")
  until: d(until),               // Data final (ex: "2026-09-30")
  account: usedAccount,          // Conta usada
  ...(accountNote ? { note: accountNote } : {}),  // Nota se houve fallback
});
```

---

## 🎯 7. Conclusão: Validação do Período 01/01-30/09/2026

### Você deve chamar a rota assim:

```bash
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads?days=274' \
  -H 'Authorization: Bearer meta-ads-sync-test-key'
```

### O que acontece internamente:

```typescript
days = 274
until = new Date()  // Data atual quando executar
since = until - 273 dias

// Se executar em 15/10/2026:
// since = 01/01/2026 ✓
// until = 15/10/2026 (inclui mais 15 dias após 30/09)

// Se executar em 30/09/2026:
// since = 01/01/2026 ✓
// until = 30/09/2026 ✓ EXATO!
```

### ⚠️ Desvio Encontrado

Se a data atual do servidor é **APÓS 30/09/2026**, a sincronização puxará dados além desse período. Para sincronizar EXATAMENTE até 30/09/2026, você tem 2 opções:

#### **Opção 1: Ajustar o parâmetro `days`**

Para sincronizar EXATAMENTE até uma data específica, use:

```bash
# Para sincronizar até 30/09/2026 (ajustando manualmente)
# days = diferença entre hoje e 30/09/2026

# Se hoje é 15/10/2026: days = 15
# Se hoje é 15/11/2026: days = 46
```

#### **Opção 2: Modificar o código para aceitar `until` explícito**

Proposta de melhoramento:

```typescript
// Adicionar após linha 22:
const until = new URL(request.url).searchParams.get("until")
  ? new Date(`${request.url.searchParams.get("until")}T23:59:59.999`)
  : new Date();

const since = new Date(request.url).searchParams.get("since")
  ? new Date(`${request.url.searchParams.get("since")}T00:00:00`)
  : new Date(Date.now() - (days - 1) * 86400000);

// Uso:
// ?since=2026-01-01&until=2026-09-30
```

---

## 📊 Valor Esperado: US$ 34.528,84

O código está **100% correto** em:
- ✅ Puxar spend em USD direto da Meta API
- ✅ Usar time_range com formato correto
- ✅ Level=campaign para dados por campanha
- ✅ Usar actions para conversas iniciadas

**Se o Dashboard mostra $0, é porque:**
1. ❌ Dados estão na tabela errada (`meta_ads_daily` vs `meta_ads_metrics`)
2. ❌ Credenciais não estão configuradas (`META_AD_ACCOUNT_ID`, `META_ADS_SYSTEM_USER_TOKEN`)
3. ❌ Período não bate (use `?days=274`)

---

## 🚀 Teste Final Recomendado

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Executar sincronização com período correto
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads?days=274' \
  -H 'Authorization: Bearer meta-ads-sync-test-key' \
  -H 'Content-Type: application/json' | jq .

# Resultado esperado:
# {
#   "ok": true,
#   "synced": 273,  (número de registros)
#   "since": "2026-01-01",
#   "until": "2026-09-30",
#   "account": "act_XXXXXXXXX"
# }
```

Se retornar `{"error":"Meta Ads não configurado"}`, as credenciais não estão no .env.
