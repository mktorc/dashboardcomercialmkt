# Gráficos mensais da aba Comercial

## O que será criado

- Gráfico de ocupação com cinco meses: mês atual -2, mês atual -1, atual, +1 e +2.
- Quatro gráficos mensais para conversão, faturamento, reservas e ticket médio, cobrindo o mês atual e os cinco anteriores.
- Todos os gráficos comerciais respeitarão o vendedor selecionado; a ocupação continuará global por representar a frota inteira.

## Implementação

- Ampliar a consulta de ocupação para o intervalo histórico e futuro necessário, calculando dias-carro sobre a capacidade de cada mês.
- Consolidar oportunidades e reservas confirmadas em seis intervalos mensais completos, com correspondência de vendedor igual à usada nos indicadores atuais.
- Exibir os cinco gráficos em cartões de barras, com valores formatados em percentual, moeda e quantidade conforme cada métrica.
- Adicionar testes dos intervalos, rótulos mensais e cálculos consolidados.

## Verificação

- Executar os testes relacionados.
- Conferir a aba Comercial em tela, incluindo os filtros e a leitura dos rótulos.