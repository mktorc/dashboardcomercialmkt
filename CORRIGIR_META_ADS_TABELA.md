# 🔴 Correção Urgente: Tabela Meta Ads Incorreta

## ⚠️ Problema Identificado

Você inseriu os dados em **`meta_ads_daily`**, mas o frontend procura em **`meta_ads_metrics`**.

### Por isso o Dashboard mostra $0 em Meta Ads!

---

## ✅ Solução em 3 Passos

### **Passo 1: Verificar se os dados estão em `meta_ads_daily`**

Abra o **SQL Editor do Supabase** e execute:

```sql
SELECT COUNT(*) FROM meta_ads_daily;
```

Se retornar um número > 0, seus dados estão lá.

---

### **Passo 2: Copiar dados para a tabela CORRETA**

Execute no **SQL Editor** (copie todo o bloco):

```sql
-- Inserir dados de meta_ads_daily em meta_ads_metrics
INSERT INTO public.meta_ads_metrics 
  (date, campaign_name, campaign_id, spend, clicks, impressions, utm_campaign, conversations)
SELECT 
  date,
  campaign_name,
  campaign_id,
  spend,
  clicks,
  impressions,
  utm_campaign,
  conversations
FROM meta_ads_daily
ON CONFLICT (date, campaign_id) DO UPDATE SET
  campaign_name = EXCLUDED.campaign_name,
  spend = EXCLUDED.spend,
  clicks = EXCLUDED.clicks,
  impressions = EXCLUDED.impressions,
  utm_campaign = EXCLUDED.utm_campaign,
  conversations = EXCLUDED.conversations;
```

**Isso irá:**
- ✅ Copiar todos os dados de `meta_ads_daily` para `meta_ads_metrics`
- ✅ Atualizar se duplicar (mesma data + campaign_id)
- ✅ Manter integridade dos dados

---

### **Passo 3: Validar**

Execute as queries de validação:

```sql
-- Verificar total de registros
SELECT COUNT(*) as total_records FROM public.meta_ads_metrics 
WHERE date >= '2026-01-01' AND date <= '2026-09-30';

-- Verificar gasto total (deve ser ~US$ 38.687,60)
SELECT SUM(spend) as total_spend FROM public.meta_ads_metrics 
WHERE date >= '2026-01-01' AND date <= '2026-09-30';

-- Verificar Julho (deve ser ~US$ 5.974,34)
SELECT SUM(spend) as july_spend FROM public.meta_ads_metrics 
WHERE EXTRACT(YEAR FROM date) = 2026 
  AND EXTRACT(MONTH FROM date) = 7;
```

---

## 🔄 Depois: Recarregue o Dashboard

Após copiar os dados:

1. **Abra o Dashboard:**
   ```
   http://localhost:8080/dashboard
   ```

2. **Force refresh:**
   - **Mac:** Cmd + Shift + R
   - **Windows/Linux:** Ctrl + Shift + R

3. **Selecione o período:**
   - De: **01/01/2026**
   - Até: **30/09/2026**

4. **Verifique o card "Investimento total em mídia":**
   - Deve mostrar: **US$ 38.687,60**
   - Meta Ads: **US$ 38.563,60**
   - Google: **US$ 124,00**

---

## 📊 Estrutura da Tabela CORRETA: `meta_ads_metrics`

| Coluna | Tipo | Requerido |
|--------|------|-----------|
| id | uuid | Sim (auto) |
| **date** | date | **Sim** |
| **campaign_name** | text | **Sim** |
| campaign_id | text | Não |
| **spend** | numeric(12,2) | **Sim** |
| clicks | integer | Não |
| impressions | integer | Não |
| utm_campaign | text | Não |
| conversations | integer | Não |
| created_at | timestamptz | Sim (auto) |

---

## ❌ Tabela INCORRETA: `meta_ads_daily` 
(Não é usada pelo frontend)

Você pode deletar após validar que os dados foram copiados:

```sql
DROP TABLE IF EXISTS meta_ads_daily;
```

---

## 📝 Resumo

| Item | Status |
|------|--------|
| Tabela correta | `meta_ads_metrics` ❌→✅ |
| Dados inseridos | `meta_ads_daily` ❌ |
| Frontend procura em | `meta_ads_metrics` ✅ |
| Solução | Copiar para tabela correta ⬇️ |

---

## 🚀 Próximos Passos

1. ✅ Execute o SQL de cópia no Supabase
2. ✅ Valide com as queries de verificação
3. ✅ Recarregue o Dashboard
4. ✅ Confirme: Investimento Total = **US$ 38.687,60**

**Pronto! O problema será resolvido em segundos.** ⚡
