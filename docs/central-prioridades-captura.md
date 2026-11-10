# Central de Prioridades — captura de reservas e janelas de antecedência

## Fonte e reconstrução histórica
- `scripts/precificacao/ritmo.py` publica, por data de retirada × categoria, `f` (frota) e `a` (antecedência, em dias, de cada diária
  vendida, calculada da **data de criação** da reserva; truncada em D-400). Só reservas confirmadas hoje (open/rental/completed).
- A posição em qualquer D-L é reconstruída contando as diárias com `a ≥ L` (`soldAt`). Isso vale para D-180, D-120, D-90, D-75 e D-60:
  **não há snapshots históricos nem tabela nova**; a reconstrução usa a data de criação.
- Captura (`src/lib/capture.ts`) = diárias vendidas em D-L ÷ diárias finais das datas comparáveis (razão agregada). **Não é a
  ocupação da frota.** Em datas abertas, a captura atual é diárias hoje ÷ (ocupação final típica × frota).
- Comparáveis: mesma regra do benchmark de ocupação (evento móvel: mesmo evento e posição; data comum: categoria, sazonalidade e dia da
  semana), só datas encerradas, mínimo de amostras (evento 2, demais 5) e diárias finais ≥ 3.

## Limitações
- **Cancelamentos (payload v3+):** `ritmo.py` publica `x`, as diárias das reservas hoje canceladas, com a antecedência da criação e do
  cancelamento (proxy: data da última atualização; indeterminada em ~10% dos casos, quando a atualização é posterior à retirada).
  Com isso a tela separa **captura líquida** (só confirmadas hoje), **bruta** (tudo que foi criado) e **ativa** (existia e ainda não
  tinha cancelado em D-L, o equivalente histórico de uma data aberta hoje). O benchmark usa a ativa; nenhum fator de correção é aplicado.
  Sem `x` (relatório antigo), só a líquida. **Alterações de data ou categoria não são rastreáveis** (o HQ guarda só o estado atual).
- **Início da base:** fotos em D-L cuja data de criação cai antes de `payload.de` (início da base) são descartadas (vendas truncadas).
- **Localidade:** a ocupação não tem dimensão de localidade; não há curva por localidade.
- **Ritmo recente:** em D-60+ usa janela de 14 dias (7 dias perto da retirada); sem ao menos 1 diária esperada na janela, não há tendência.
- Captura sobre "ocupação final típica" depende da média das datas comparáveis: com `n` baixo a confiança é menor.

## Estratégia futura (opcional)
Para medir cancelamentos e alterações, gravar periodicamente (ex.: semanalmente) um snapshot de `reservation_segments` por data de
retirada × categoria com status e data de criação. Não implementado: a reconstrução atual já cobre D-60+.

## Calibração dos níveis (segunda etapa)
Dados: `ritmo.json` v3 de 2026-11-09 (847 linhas data×categoria em D-60+). Backtest sem vazamento: cada data histórica
(2025-03 a 2026-09) avaliada na antecedência D-60/75/90/120 com `base = data − L`.

| Parâmetro | Padrão | Origem |
|---|---|---|
| `pRel` percentil histórico | 0,25 | no backtest, ocupação ≤ 0,25 do histórico ocorre em ~10% das datas normais (p10); a distribuição é deslocada para cima pelo crescimento ao longo dos anos |
| `capDef` déficit de captura | −15 p.p. | p25 do backtest (p10 = −25; mediana ≈ −2) |
| `faltamMin` | 3 diárias | entre p75 (1,9) e p90 (3,7) do backtest |
| `evidMin` | 2 | com 1 evidência o nível Crítica dobra; com 3 quase desaparece (sensibilidade abaixo) |
| `ritmoDisp` | 8 | var(z) das diárias novas com ±3 datas somadas: 7,8–8,5 em D-45/70/90 (1,0–1,35 numa data isolada: Poisson). Reservas de vários dias criam correlação entre datas vizinhas |
| `ritmoZ` | 1,28 | ~10% unilateral |

Níveis (sem quantidade fixa por classe): **Crítica** = desvio relevante (gap negativo e percentil ≤ `pRel`) + ≥ `evidMin` evidências
(captura, ritmo desacelerando com confiança média+, diárias faltantes, preço acima do mercado com confiança ≥ média), ao menos uma
sendo captura ou ritmo, referência não frágil e D-`leadRecup` ou mais. **Atenção** = desvio relevante sem esses requisitos.
**Monitoramento** = gap negativo com ocupação abaixo da mediana histórica, ou sinal isolado de captura/ritmo. **Dentro do esperado** =
compatível com o histórico (gap negativo só contra o melhor registro não basta).

Pontuação (0–100, explicável no drawer): gravidade 30%, diárias faltantes 20%, ritmo 15%, janela 15%, frota 10%, preço 10%;
fatores indisponíveis saem e os pesos são renormalizados; confiança da referência multiplica (1 / 0,9 / 0,75); preço de baixa
confiança vale metade.

Tendência de ritmo: soma de diárias novas e esperadas da data e das vizinhas (±3, mesma categoria), z = (novas − esperadas)/√(disp × esperadas).
Confiança: alta ≥ 10 esperadas, média ≥ 4, baixa ≥ 1; abaixo disso ou < 3 datas, **“Tendência indisponível”** (nunca “estável”).

## Concorrência (auditoria 2026-11-09)
Fonte integrada e atualizada (coletas do dia), mas: 100% das coletas estão como equivalência “parcial” (nenhuma “equivalente”), só 2
concorrentes, 1 localidade (MCO), 7 diárias, 31 datas de retirada e 62% das coletas sem categoria equivalente (Tesla, Mustang, Golf GTI…).
Quilometragem e política de cancelamento nunca vêm preenchidas. Consequência: a comparação de preço é sempre “parcial”, de confiança
baixa (1 concorrente) ou média (2 sem parcial exige equivalente); preço de baixa confiança não conta como evidência.

## Monitoramento da cadeia de dados
`scripts/precificacao/monitor.py`, rodado a cada 3 horas por `.github/workflows/monitor-precificacao.yml`, verifica quatro etapas separadas:

1. **Agendamento:** cada rotina (`previsao-ocupacao.yml`, `coleta-concorrentes.yml`) teve uma execução pelo evento `schedule` nas últimas 30 h?
   Execução por push ou manual não conta, e a rotina que simplesmente deixou de rodar vira falha.
2. **Execução:** a última execução (qualquer evento) terminou com sucesso?
3. **Publicação:** o dado está no banco e recente (≤ 26 h): ocupação, cancelamentos (relatório v3+ com cancelamentos), cada concorrente (UP e
   Allycar separados) e nossa tarifa.
4. **Aplicação:** o painel "Saúde dos dados" em Prioridades lê as mesmas tabelas e mostra a idade de cada dado (verde ≤ 26 h, âmbar ≤ 50 h,
   vermelho acima). O monitor não enxerga o navegador nem se o deploy está atualizado.

**Autocorreção:** se o agendamento falhou e a rotina ficou 24 h sem nenhuma execução (de qualquer evento), o monitor a dispara por
`workflow_dispatch` (no máximo uma vez por dia por rotina) e registra no resumo; a falha continua valendo, pois o agendador é o problema.

Falha do monitor = workflow vermelho + issue "Alerta: dados de precificação" (atualizada a cada rodada com falha e fechada sozinha quando tudo volta
ao normal). Avisos (ex.: nenhuma cotação equivalente) não falham. Limites: agendador do GitHub pode atrasar; o próprio monitor para se o repositório
ficar 60 dias sem atividade.
