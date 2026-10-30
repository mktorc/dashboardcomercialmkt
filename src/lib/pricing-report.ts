// O relatório de precificação (scripts/precificacao/analisar.py) é um HTML único, com <style> e uma <section id="…"><h2>título</h2>…</section> por tema.
// A página /precificacao mostra cada seção em uma aba; este parser separa o HTML (gerado por nós, sem aninhar seções).

export type PricingTab = { id: string; title: string; label: string; html: string };

// Rótulos curtos para as abas; seção desconhecida cai no título inteiro.
const LABELS: Record<string, string> = {
  resumo: "Resumo",
  ocupacao: "Ocupação e frota",
  antecedencia: "Antecedência",
  preco: "Preço",
  relacao: "Preço × ocupação",
  elasticidade: "Elasticidade",
  regras: "Regras de ajuste",
  qualidade: "Qualidade dos dados",
  limitacoes: "Limitações",
};

export function splitPricingReport(html: string): { css: string; tabs: PricingTab[] } {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  const tabs: PricingTab[] = [];
  for (const m of html.matchAll(/<section id="([^"]+)"><h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/g)) {
    const id = m[1] ?? "";
    const title = m[2] ?? "";
    tabs.push({ id, title, label: LABELS[id] ?? title, html: m[3] ?? "" });
  }
  return { css, tabs };
}

/** Documento isolado de uma aba, para o iframe: mesmo CSS do relatório, sem script. */
export function pricingTabDocument(css: string, tab: PricingTab): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="wrap"><section><h2>${tab.title}</h2>${tab.html}</section></main></body></html>`;
}
