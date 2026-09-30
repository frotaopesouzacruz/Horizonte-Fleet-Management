# HFM — Visualização de dados (Etapa 17)

Kit: `src/components/charts/`. São SVGs desenhados à mão, sem biblioteca de
gráficos (nenhuma foi adicionada). O kit tem estas peças:

- `TrendChart`
- `ColumnChart`, simples ou empilhada
- `HBarChart`
- `Sparkline`
- `ChartCard`
- `ChartLegend`
- `ChartFrame` e `ChartTooltipCard`
- `SrTable`
- `chartFormat` e os utilitários de escala

Os papéis de cor ficam em `src/design-system/tokens/chart.ts` (`chartTheme`) e
nos tokens `--chart-*`.

## 1. Princípios

1. **O gráfico responde uma pergunta.** O título do `ChartCard` diz qual, e a leitura (`insight`) responde em uma frase factual.
2. **A marca conduz.** A série principal é `--chart-brand-primary`. Cor semântica só entra quando o dado é um julgamento (abaixo da meta = `--chart-danger`).
3. **A meta é a única linha tracejada.** É dourada (`--chart-target`), com o valor escrito ("Meta 90%"). O tracejado significa limiar, nunca grade.
4. **Sem cara de Excel.**
   - A grade é só horizontal, em hairline (`--chart-grid`), sem traços de eixo nem linhas verticais.
   - Barras e colunas têm canto arredondado de 4px e base reta no eixo.
   - Linhas têm 2,5px, com área suave (gradiente de 14% a 0%).
   - Os valores permanentes aparecem só onde decidem: no ponto corrente da linha e no total das colunas. O resto está no tooltip.
5. **A cor nunca carrega a informação sozinha.** Todo ponto tem tooltip, todo gráfico tem tabela gêmea (visível ao lado ou `SrTable`), e o texto usa os tokens de texto, nunca a cor da série.
6. **Futuro não é resultado.** Períodos futuros ficam numa faixa hachurada com o rótulo "Futuro", sem ponto e sem valor.

## 2. Papéis de cor

| Papel | Token | Claro | Escuro | Uso |
|---|---|---|---|---|
| brandPrimary | `--chart-brand-primary` | `#1F4B93` | `#6C9DE0` | série principal, linha, barras |
| brandSecondary | `--chart-brand-secondary` | `#008CCB` | `#38B6F0` | segunda série (ex.: preditiva) |
| accent | `--chart-accent` | `#F4B223` | `#F4B223` | terceira série de marca (ex.: corretiva) |
| success | `--chart-success` | `#1E8E5A` | `#3DBB7F` | julgamento positivo |
| warning | `--chart-warning` | `#C27C0E` | `#F0B33A` | atenção |
| danger | `--chart-danger` | `#C93636` | `#F06565` | abaixo da meta, crítico |
| neutral | `--chart-neutral` | `#8A96A8` | `#7F8EAB` | outros, sem classificação |
| target | `--chart-target` | `#C68600` | `#F4B223` | meta, benchmark |

A estrutura do gráfico também tem tokens: `--chart-grid`, `--chart-axis-line`,
`--chart-label`, `--chart-crosshair`, `--chart-hover-band`, `--chart-future`,
`--chart-tooltip-surface`, `--chart-tooltip-border`, `--chart-area-primary` e
`--chart-area-primary-fade`.

**Ordem fixa por entidade.** Uma entidade tem sempre a mesma cor em qualquer
gráfico da tela. Na Manutenção:

| Tipo | Cor |
|---|---|
| preventiva | brandPrimary |
| corretiva | accent |
| preditiva | brandSecondary |
| outros | neutral |

## 3. Tooltip

`ChartTooltipCard`: fica em `surface` elevada, com borda e `shadow-md`, e se
posiciona ao lado da marca, virando para dentro na metade direita. O conteúdo
segue esta ordem:

1. Título: o período ou o item.
2. Subtítulo: o contexto ("Mês corrente", "Dia vigente · resultado provisório").
3. Linhas rótulo/valor, cada uma com a amostra da série (quadrado, ponto, linha ou tracejado). A métrica principal fica em `emphasis`.
4. Rodapé opcional com a ação ("Clique para ver o detalhe do dia.").

O desvio sempre sai com sinal, em **p.p.** (pontos percentuais). O mesmo
componente é usado no heatmap.

## 4. Tipos

### TrendChart (tendência contra meta)
- **Domínio percentual** (`kind="percent"`): recorta a faixa útil (ex.: 80–100%), sempre incluindo a meta e nunca saindo de 0–100. Uma linha não mede área, então o zero não é obrigatório.
- **Pontos abaixo da meta** ficam em vermelho (`flagBelowTarget`). O ponto do período corrente é maior e tem o valor escrito.
- **Interação:** o hover mostra uma banda na coluna, uma linha-guia vertical e o tooltip.

### ColumnChart (volume por período)
- Com `kind="count"`, começa em zero e usa passo inteiro. Com `segments`, as colunas são empilhadas na ordem da legenda, com 1,5px de superfície entre as fatias.
- Mostra o total acima da coluna. A composição fica no tooltip.

### HBarChart (ranking / quebra por dimensão)
- **Trilho:** cada barra tem um trilho de fundo (`surface-sunken`), então 100% é legível sem eixo.
- **Rótulo lateral:** traz o valor e o detalhe ("· 5/6", "· 12,5%").
- **Meta:** linha vertical tracejada, com o rótulo embaixo.

### Sparkline (tendência no KPI)
- Mede 96×28px, com a última marca em ponto e a meta tracejada opcional.
- É decorativa por padrão (`aria-hidden`), porque o valor e a variação estão escritos no cartão.

### Heatmap (calendário de taxa)
- **Escala `--heat-*`:** três faixas contra a meta (na meta, até 10 p.p. abaixo, abaixo), mais "sem base" (`heat-empty`) e "futuro" (borda tracejada). O texto de cada faixa tem contraste de 7:1 ou mais.
- **Legenda:** uma faixa "Escala" acima dos calendários.
- **Tooltip:** o `ChartTooltipCard` aparece no hover e no foco. O nome acessível da célula resume a mesma informação.
- **Drill-down:** o clique abre a gaveta do dia, com links para Mês/Dia e Jornada.

## 5. Acessibilidade

- Cada gráfico é um `role="img"` com `aria-label` descritivo, dentro de uma moldura focável (`role="group"`).
- **Teclado:**

| Tecla | Ação |
|---|---|
| ← / → (↑ / ↓ nas barras horizontais) | percorre os itens |
| Home / End | vai ao primeiro / último item |
| Enter | drill-down, quando existe |
| Esc | fecha o tooltip |

- Uma região `aria-live="polite"` anuncia o item ativo.
- Uma tabela gêmea acompanha cada gráfico: visível (Aderência) ou `SrTable` (Manutenção).
- As marcas gráficas têm 3:1 ou mais sobre a superfície nos dois temas.

## 6. Aplicação atual

| Tela | Gráfico |
|---|---|
| Aderência › Visão consolidada | `TrendChart` mensal com meta, `HBarChart` de ranking por dimensão e sparklines nos KPIs |
| Aderência › Heatmap | escala `--heat-*`, legenda e tooltip rico |
| Manutenção › Visão geral | `ColumnChart` empilhado (volume por tipo), `HBarChart` (mix e situação), `ColumnChart` (aging) e `InlineBar` |
| `/dev/design-system` | exemplos de todos os tipos |

As demais telas não tinham gráficos: usam KPIs, tabelas e barras em linha
(`InlineBar`, planners em grade), e herdam os tokens e componentes refinados.
