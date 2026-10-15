# 🔐 Autenticação - Sincronização Meta Ads

## 🔍 Como Funciona

**Arquivo:** `src/lib/sync-auth.ts`

```typescript
export function isSyncAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return [process.env["LOVABLE_CRON_SECRET"], process.env["SYNC_CRON_TOKEN"]].some(
    (s) => !!s && auth === `Bearer ${s}`,
  );
}
```

---

## 🎯 Chave Esperada no Header

### **Formato Requerido:**
```
Authorization: Bearer <CHAVE_SECRETA>
```

### **Valores Aceitos (em ordem de prioridade):**

1. **`LOVABLE_CRON_SECRET`** (variável de ambiente)
   - Chave principal do Lovable
   - Usado para agendamento de cron jobs

2. **`SYNC_CRON_TOKEN`** (variável de ambiente)
   - Token alternativo de sincronização
   - Fallback se `LOVABLE_CRON_SECRET` não estiver configurado

### **Lógica:**
```typescript
// Verifica se uma das duas chaves está configurada E corresponde ao header
[LOVABLE_CRON_SECRET, SYNC_CRON_TOKEN].some((s) => 
  !!s && auth === `Bearer ${s}`
)
```

✅ **Autorizado se:**
- Pelo menos uma das chaves está definida no `.env`
- O header `Authorization` contém exatamente `Bearer {chave}`

❌ **Rejeitado se:**
- Nenhuma chave está configurada no `.env`
- O header está vazio ou mal formatado
- O valor após `Bearer ` não corresponde a nenhuma chave

---

## 📋 Exemplos

### ✅ **Requisição Autorizada**

```bash
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads?days=274' \
  -H 'Authorization: Bearer seu-cron-secret-aqui' \
  -H 'Content-Type: application/json'
```

**Resposta (sucesso 200):**
```json
{
  "ok": true,
  "synced": 273,
  "since": "2026-01-01",
  "until": "2026-09-30"
}
```

---

### ❌ **Requisição Não Autorizada**

#### Caso 1: Header ausente
```bash
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads'
```

**Resposta (401):**
```json
{
  "error": "Unauthorized"
}
```

---

#### Caso 2: Header mal formatado
```bash
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads' \
  -H 'Authorization: seu-cron-secret-aqui'  # ← Falta "Bearer "
```

**Resposta (401):**
```json
{
  "error": "Unauthorized"
}
```

---

#### Caso 3: Chave incorreta
```bash
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads' \
  -H 'Authorization: Bearer chave-errada'
```

**Resposta (401):**
```json
{
  "error": "Unauthorized"
}
```

---

#### Caso 4: Chave não configurada no .env
```bash
# Se LOVABLE_CRON_SECRET e SYNC_CRON_TOKEN não estão no .env
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads' \
  -H 'Authorization: Bearer qualquer-coisa'
```

**Resposta (401):**
```json
{
  "error": "Unauthorized"
}
```

---

## 🔧 Configuração

### **Local Development (.env.local)**

```env
# Escolha UM destes:
LOVABLE_CRON_SECRET=seu-secret-aqui
# OU
SYNC_CRON_TOKEN=seu-token-aqui
# OU ambos (LOVABLE_CRON_SECRET tem prioridade)
```

### **Lovable Cloud**

1. Vá para **Settings → Environment Variables**
2. Configure:
   ```
   LOVABLE_CRON_SECRET = seu-valor-aqui
   ```

---

## 🚀 Uso Recomendado

### **Para Teste Local**

```bash
# 1. Configure no .env.local
export LOVABLE_CRON_SECRET="test-sync-key"

# 2. Use a mesma chave no header
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads?since=2026-01-01&until=2026-09-30' \
  -H 'Authorization: Bearer test-sync-key'
```

---

### **Para Agendamento no Lovable**

```
Endpoint: https://seu-projeto.lovable.app/api/public/sync/meta-ads
Method: POST
Header: Authorization: Bearer ${LOVABLE_CRON_SECRET}
Params: ?since=2026-01-01&until=2026-09-30
```

---

## 📊 Fluxo de Autenticação

```
Request recebido
    ↓
Extrai header "Authorization"
    ↓
Valida formato "Bearer {chave}"
    ↓
Compara com LOVABLE_CRON_SECRET
    ↓
Se não encontrar, compara com SYNC_CRON_TOKEN
    ↓
Se alguma corresponder → ✅ Autorizado
Se nenhuma corresponder → ❌ Retorna 401 Unauthorized
```

---

## ⚠️ **Segurança**

- ✅ Use valores **únicos e aleatórios** para as chaves
- ✅ Revogue chaves antigas regularmente
- ✅ **Nunca** exponha as chaves em logs ou commits
- ✅ Use `.env.local` (gitignored) para desenvolvimento
- ✅ Configure no Lovable Cloud para produção

---

## 🧪 Teste de Conectividade

```bash
# 1. Configure a chave
export LOVABLE_CRON_SECRET="test-key"

# 2. Teste com a chave correta
curl -X POST 'http://localhost:8080/api/public/sync/meta-ads?days=1' \
  -H 'Authorization: Bearer test-key' \
  -v

# Esperado: 200 OK ou 500 (Meta Ads não configurado)
# NÃO deve ser 401 Unauthorized
```

Se retornar **401**, significa:
- ❌ Chave não está no `.env`
- ❌ Formato do header está errado
- ❌ Chave não corresponde
