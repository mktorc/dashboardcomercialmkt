#!/usr/bin/env node

/**
 * Script para disparar sincronização retroativa do Meta Ads localmente
 * Usa um token de teste para desenvolvimento
 */

// Para ambiente local, usamos um token de teste
const token =
  process.env.LOVABLE_CRON_SECRET || process.env.SYNC_CRON_TOKEN || "test-sync-token-local";

const apiUrl = process.env.API_URL || "http://localhost:5173";
const endpoint = `${apiUrl}/api/public/sync/meta-ads`;
const days = 274;

console.log("🔄 Disparando sincronização retroativa do Meta Ads...");
console.log(`📅 Período: 01/01/2026 a 30/09/2026 (${days} dias)`);
console.log(`🔗 Endpoint: ${endpoint}?days=${days}`);
console.log(`🔐 Token: ${token.substring(0, 10)}...`);
console.log("");

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

fetch(`${endpoint}?days=${days}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  signal: controller.signal,
})
  .then(async (res) => {
    clearTimeout(timeout);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      if (res.status === 401) {
        console.error(`❌ Erro 401 - Não autorizado`);
        console.error("   Possíveis causas:");
        console.error("   1. Token inválido ou não configurado");
        console.error("   2. Servidor não está em execução");
        console.error("   3. A rota não está acessível");
        console.error("");
        console.error('💡 Solução: Inicie o servidor com "npm run dev" em outro terminal');
      } else {
        console.error(`❌ Erro na sincronização (${res.status}):`, data);
      }
      process.exit(1);
    }

    console.log("✅ Sincronização Meta Ads iniciada com sucesso!");
    console.log("");
    console.log("📊 Próximas etapas:");
    console.log("   1. Aguarde 30-60 segundos para os dados serem processados");
    console.log("   2. Acesse http://localhost:5173/dashboard");
    console.log("   3. Valide o Investimento Total em Mídia (01/01-30/09/2026)");
    console.log("   4. Esperado: US$ 38.687,60");
    console.log("   5. Verifique o gasto de Julho/2026: US$ 5.974,34");
    console.log("");
    console.log("📝 Resposta do servidor:", data);
  })
  .catch((err) => {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      console.error("❌ Timeout - Servidor não respondeu em 30 segundos");
      console.error("💡 Dica: Certifique-se que o servidor está rodando (npm run dev)");
    } else {
      console.error("❌ Erro ao conectar ao endpoint:", err.message);
    }
    process.exit(1);
  });
