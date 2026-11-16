#!/usr/bin/env node

/**
 * Script para disparar sincronização retroativa do Meta Ads
 * Puxa dados de 01/01/2026 a 30/09/2026 (274 dias)
 *
 * Uso: node scripts/sync-meta-ads-retroactive.mjs <LOVABLE_CRON_SECRET>
 */

const secret = process.argv[2];
if (!secret) {
  console.error("❌ Erro: Forneça o LOVABLE_CRON_SECRET como argumento");
  console.error("Uso: node scripts/sync-meta-ads-retroactive.mjs <LOVABLE_CRON_SECRET>");
  process.exit(1);
}

const apiUrl = process.env.API_URL || "http://localhost:5173";
const endpoint = `${apiUrl}/api/public/sync/meta-ads?days=274`;

console.log("🔄 Disparando sincronização retroativa do Meta Ads...");
console.log(`📅 Período: 01/01/2026 a 30/09/2026 (274 dias)`);
console.log(`🔗 Endpoint: ${endpoint}`);

fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
})
  .then(async (res) => {
    const data = await res.json();

    if (!res.ok) {
      console.error(`❌ Erro na sincronização (${res.status}):`, data);
      process.exit(1);
    }

    console.log("✅ Sincronização Meta Ads concluída com sucesso!");
    console.log("📊 Próximas etapas:");
    console.log("   1. Aguarde 30-60 segundos para propagação dos dados");
    console.log("   2. Recarregue o Dashboard no navegador");
    console.log(
      "   3. Valide se o Investimento Total em Mídia para 01/01-30/09/2026 = US$ 38.687,60",
    );
    console.log("   4. Verifique se o gasto de Julho/2026 = US$ 5.974,34");
  })
  .catch((err) => {
    console.error("❌ Erro ao conectar ao endpoint:", err.message);
    process.exit(1);
  });
