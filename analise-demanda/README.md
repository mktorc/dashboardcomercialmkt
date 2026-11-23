# Análise de demanda e preço — Orlando

Cruza as chegadas de brasileiros (NTTO / I-94) com o histórico de reservas do HQ para apoiar o gestor de
classificação em **Orlando**, com foco em preço: ADR por categoria, ADR × sazonalidade, ADR por antecedência,
desconto, ritmo de vendas (pickup) por categoria e um motor de gatilhos configurável.

**No painel:** aba **Demanda & Preço** do módulo Precificação (`src/components/precificacao/DemandaPreco.tsx`,
regras em `src/lib/demanda-preco.ts`), lendo `reservations` e `ntto_chegadas` direto do banco. Este projeto
Python continua sendo o coletor do NTTO (grava `ntto_chegadas`) e a referência das regras: mantenha as duas
implementações iguais.

**Escopo atual:** só Orlando (`destinos.ativos` no config). Miami e EUA continuam no código e no config,
desativados; a Flórida aparece só como linha de referência de contexto (chegadas e sazonalidade).

## Rodar

```bash
cd analise-demanda
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # uma vez
.venv/bin/python -I main.py                 # coleta tudo (NTTO, banco, HQ) e processa
.venv/bin/python -I main.py --sem-coleta    # só reprocessa data/raw
.venv/bin/python -I main.py --hoje 2026-11-23   # data de corte fixa (reprodutível)
.venv/bin/python -I -m pytest -q tests
```

Banco (uma vez): rodar `sql-para-gravar/demanda_preco.sql` no SQL Editor do Supabase — cria `ntto_chegadas`
e a coluna `reservations.pick_up_location_id` (o sync do HQ passa a gravá-la).

Credenciais: lidas de `../.env.local` (service role do Supabase e tokens do HQ). **Todas as chamadas são de
leitura (GET)**. A exportação não traz dados pessoais (sem e-mail, telefone, nome de cliente ou vendedor).

## Estrutura

```
config.yaml            regras, destinos, status de demanda, anos excluídos, limites dos gatilhos
main.py                pipeline único
src/demanda/
  coleta.py            NTTO (resumos mensais + série nacional), Supabase, HQ  → data/raw
  limpeza.py           padronização, data de reserva do HQ, destino, flags
  base.py              base unificada mês × destino
  analises.py          sazonalidade, market share, curva de pickup, ritmo (genérico por destino/categoria)
  preco.py             ADR por mês e categoria, ADR × sazonal, ADR por antecedência, pickup por categoria
  gatilhos.py          motor de regras → alertas
  qualidade.py         relatório de qualidade (nada é descartado em silêncio)
data/raw/              fontes brutas (fora do git)
data/processed/        base_unificada, sazonalidade, market_share, pickup_*, preco_*, alertas, reservas_limpas (.parquet/.csv)
relatorios/            qualidade.md + CSVs de cada checagem; dashboard.html
tests/                 testes com dados sintéticos
```

## Fontes

| Fonte | O que entra | Período |
|---|---|---|
| NTTO série mensal por país (COR) | Brasil, total EUA | 2000 → último mês |
| NTTO resumos mensais, Tabela I.1 | Brasil: total EUA e estado de 1º endereço (Flórida) | 2017–2019, 2022 → (sem 2020/21) |
| NTTO resumos mensais, Tabela Q.1 | Brasil: porto aéreo Orlando, Miami, Fort Lauderdale | idem |
| Supabase `reservations` | status, retirada, devolução, categoria, diárias, valores | mai/2023 → |
| HQ `car-rental/reservations` (GET) | data de criação real, loja de retirada | idem |

## Definições

- **Destino Orlando**: lojas da região Orlando no cadastro — MCO, TPA, SFB, Port Canaveral, hotéis, casa de
  férias, lounge e trem de Orlando (ids em `destinos.lojas`). Reservas sem loja ficam fora. Denominador: chegadas de brasileiros pelo porto aéreo de Orlando (Tabela Q.1).
- **Referência**: Flórida (estado de 1º endereço, Tabela I.1), só contexto; não entra em share nem alertas.
- **Demanda** = status `confirmed` + `cancelled-paid`. `cancelled` e `pending` ficam fora.
- **Taxa de cancelamento** = (`cancelled` + `cancelled-paid`) ÷ (`confirmed` + `cancelled` + `cancelled-paid` + `no-show`).
- **Data da reserva** = `created_at` do HQ (UTC convertido para horário de Orlando); é o mesmo valor gravado em
  `reservations.created_at` (conferido nas 7.867 reservas). Reserva sem par no HQ ou criada depois da retirada fica fora do pickup.
- **Situação do mês**: `realizado` (antes do mês de corte), `on_the_books` (mês corrente e futuros: só pickup),
  `implantacao` (antes de `inicio_historico_confiavel`, migração do HQ em 01/07/2023), `sem_dado_interno`.
- **Market share** = locações ÷ chegadas, só em meses realizados.
- **Locações pagas** = demanda com `total_amount` > 0. Total 0 (cortesias/internas) conta em `locacoes`,
  mas fica fora de receita, ADR e desconto.
- **ADR** = `rack_rate` ÷ diárias, só nas pagas. No HQ, `total_rack_rate` é o valor da locação **já com
  desconto, sem taxas e extras** (a taxa de 6,5% vem em `miscellaneous_price`). `receita_total` (com taxas e
  extras) também fica na base, mas o preço é lido pelo rack.
- **Desconto** = `discount_amount` ÷ (`rack_rate` + `discount_amount`), ou seja, sobre o preço cheio.
- **Antecedência** = dias entre a reserva (HQ) e a retirada. Faixas: 0–7, 8–30, 31–60, 61–90, 90+.
- **Sazonalidade** = média, entre anos completos, de (mês ÷ média mensal do ano); exclui `anos_excluidos`.
  Longo prazo pela série nacional 2000→; por destino pelos resumos; também para nossas locações.
- **Ritmo atual**: reservas do mês já criadas hoje × as do mesmo mês um ano antes, criadas até a mesma data
  (e média de `anos_historico` anos). Razões só com base ≥ `min_reservas_base`.

## Análises de preço (`preco_*`)

| Arquivo | O que responde |
|---|---|
| `preco_adr_categoria` | ADR, desconto e volume por mês × categoria (+ "Todas"), realizado e on the books. Realizado compara com o ano anterior fechado; on the books, com o ano anterior **na mesma data** (`adr_referencia`). |
| `preco_adr_vs_sazonal` | Por mês do calendário: índice de ADR × índice de demanda (mercado NTTO e nossas locações). `captura` = quanto do pico de demanda vira preço; `leitura_*` marca pico com preço subindo menos que a demanda. |
| `preco_adr_antecedencia` | ADR e desconto por faixa de antecedência × categoria (últimos 12 meses e histórico); `premio_vs_ultima_hora` = ADR da faixa ÷ ADR de 0–7 dias − 1. |
| `preco_pickup_categoria` | Próximos 6 meses × categoria: on the books hoje vs ano anterior na mesma data, com ADR dos dois. |

## Gatilhos (config.yaml → `gatilhos`)

| Regra | Condição | Ação |
|---|---|---|
| fechar_entrada | índice sazonal do destino > 1,3 e ritmo > ano anterior (próximos 6 meses) | Fechar categoria de entrada |
| share_caindo | share abaixo do mesmo mês do ano anterior por 2 meses seguidos (`comparacao: yoy`; `mom` = vs mês anterior) | Revisar preço / testar redução |
| aereo_yoy | reservas aéreas futuras > +10% YoY — **desligado (sem dados aéreos)** | Antecipar fechamento |
| pickup_abaixo | mês que começa em ≤ 30 dias com ritmo < 90% do histórico | Abrir categorias / promoção |
| ultima_hora | faixa 0–7 dias com ADR abaixo da média das outras faixas (últimos 12 meses, ≥ 10 reservas pagas por faixa) | Revisar desconto de última hora |
| subir_preco_categoria | categoria com pickup acima do ano anterior e ADR on the books ≥ 2% abaixo do ano anterior (mesma data), próximos 6 meses | Subir preço da categoria |

`alertas` traz data, mês de referência, destino, categoria, sinal, valor, limite, ação, `ativo` e detalhe.

## Premissas e limitações

- **Frota cheia em dez/jan não pôde ser confirmada.** `fleet_vehicles` só tem a frota atual (nenhum carro com
  data de saída), então a capacidade histórica fica subestimada (ex.: out/2024 aparece com 109% de ocupação).
  Mesmo assim, a ocupação calculada pela regra do HQ dá 85,5% em dez/2025 e 91,2% em jan/2026, e é da frota
  toda (não só Orlando). Dezembro não aparenta ter lotado; janeiro ficou alto. O índice de "nossas locações"
  baixo em dezembro se explica em parte por locações mais longas — por isso a aba mostra também o índice de
  diárias.

- **O NTTO conta chegadas, não locações.** Share é um indicador relativo, não participação real no aluguel.
- Estado de 1º endereço subestima quem visita mais de um estado; porto de entrada ≠ destino (muitos entram
  por Miami e seguem para Orlando). Por isso a Flórida é a base principal.
- Todos os nossos clientes são tratados como brasileiros (não há país do cliente na base).
- O histórico de loja só vem do HQ atual; reservas sem loja (81) ficam fora.
- Meses sem arquivo do NTTO ficam vazios com aviso (`ntto_aviso`), sem interpolação; 2020–21 não são coletados.
- Categorias pequenas (Luxury, Van 12, Extra, Mini Van antiga) têm poucas reservas: as razões só aparecem com
  base ≥ `min_reservas_base`.
- Não há histórico de status: no ritmo do ano anterior, reservas canceladas depois não aparecem — o ano
  anterior tende a ficar um pouco subestimado.
- Nosso histórico confiável começa em ago/2023: sazonalidade própria e índice de ADR só têm 2 anos completos (2024–2025).
- O NTTO revisa meses por até 36 meses; set e out/2026 estão preliminares.

## Atualização mensal

O NTTO publica o mês M como preliminar por volta de M+1 e como final em M+2/M+3. Uma vez por mês:

```bash
.venv/bin/python -I main.py
```

Isso também grava `ntto_chegadas` no Supabase (service role) e preenche a loja das reservas que ainda estiverem
sem ela; `--sem-banco` pula a gravação. A aba do painel passa a mostrar o mês novo assim que a tabela é
atualizada. O coletor lê as duas páginas do NTTO (atual e histórico); meses que elas não listam são procurados pelo nome
padrão do arquivo. Preliminares são trocados pelo final assim que ele sai. Arquivos finais ficam em cache
(`data/raw/ntto/arquivos`); a série nacional é sempre baixada de novo.
