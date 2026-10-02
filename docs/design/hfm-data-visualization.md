# HFM — Visualização de dados (HFM Chart Theme · UI 2.0)

Kit: `src/components/charts/`. São SVGs desenhados à mão, sem biblioteca de
gráficos (nenhuma foi adicionada nem substituída). Peças:

| Peça | Uso |
|---|---|
| `TrendChart` | linha/área: tendência contra meta, hodômetro, séries diárias |
| `ColumnChart` | colunas simples ou empilhadas: volume por período, KM por dia, faixas |
| `HBarChart` | ranking e quebra por dimensão |
| `GaugeChart` | taxa com faixa conhecida (score DQ, cobertura, SLA) — **UI 2.0** |
| `DonutChart` | composição de um total em até ~6 fatias — **UI 2.0** |
| `Sparkline` | tendência dentro do KPI |
| `ChartCard`, `ChartLegend`, `ChartFrame`, `ChartTooltipCard`, `SrTable` | moldura, legenda, teclado, tooltip e tabela gêmea |

Os papéis de cor ficam em `src/design-system/tokens/chart.ts` (`chartTheme`) e
nos tokens `--chart-*` / `--heat-*`.

## 1. Princípios

1. **O gráfico responde uma pergunta.** O título do `ChartCard` diz qual; a leitura (`insight`) responde em uma frase factual.
2. **A marca conduz.** Série principal em `--chart-brand-primary`. Cor semântica só quando o dado é um julgamento (abaixo da meta, alta rodagem, crítico).
3. **A meta é a única linha tracejada** — dourada (`--chart-target`), com valor escrito ("Meta 90%").
4. **Sem cara de Excel.** Grade só horizontal em hairline, cantos de 4px com base reta, linha de 2,5px com área suave, valores permanentes só onde decidem (ponto corrente, total da coluna).
5. **Cor nunca sozinha.** Tooltip em todo ponto, tabela gêmea em todo gráfico, texto nos tokens de texto.
6. **Ausência não é zero.** Dia sem leitura não tem ponto nem barra (e o tooltip diz "Sem leitura (não é 0 km)"); futuro é hachurado, sem valor.
7. **Nada é cortado.** UI 2.0: margem do eixo pelo maior rótulo, rótulo de destaque contido na área do gráfico, coluna de valor das barras horizontais pelo texto mais longo, rótulos de eixo curtos quando o espaço é pouco (o tooltip mantém o nome completo).

## 2. Paleta

### 2.1 Papéis semânticos

| Papel | Token | Claro | Escuro | Uso |
|---|---|---|---|---|
| brandPrimary | `--chart-brand-primary` | `#1F4B93` | `#6C9DE0` | série principal |
| brandSecondary | `--chart-brand-secondary` | `#008CCB` | `#38B6F0` | segunda série |
| accent | `--chart-accent` | `#F4B223` | `#F4B223` | terceira série de marca |
| success / warning / danger | `--chart-success/warning/danger` | verde / âmbar / vermelho | versões claras | julgamento |
| neutral | `--chart-neutral` | slate | slate claro | outros, sem movimento |
| target | `--chart-target` | `#C68600` | `#F4B223` | meta |
| track | `--chart-track` | trilho tonal | trilho tonal | fundo de gauge/donut |

### 2.2 Categórica (ordem fixa, marca primeiro, sem vermelho/verde)

`--chart-1` Azul Horizonte · `--chart-2` Ciano · `--chart-3` Dourado ·
`--chart-4` Azul 400 · `--chart-5` Bronze · `--chart-6` Slate · `--chart-7`
Ciano 400 · `--chart-8` Azul 900. Uma entidade mantém a mesma cor em toda a
tela (ex.: Manutenção — preventiva `brandPrimary`, corretiva `accent`,
preditiva `brandSecondary`).

### 2.3 Intensidade (heatmap / planner)

`--heat-1…6`: rampa azul de intensidade (claro → escuro no tema claro; o
inverso no escuro). Usada no Planner mês/dia do KM (faixas 0 / ≤50 / 50–100 /
100–200 / 200–400 / 400+ km) com legenda visível e o número escrito na célula.
Taxas contra meta (heatmap da Aderência) continuam com as três faixas
semânticas + "sem base" + "futuro".

## 3. Tooltip

`ChartTooltipCard` — superfície elevada, `rounded-lg`, `shadow-lg`, título em
overline, linhas divididas:

1. Título (período/item) e subtítulo (contexto).
2. Linhas rótulo/valor com amostra da série; a métrica principal em `emphasis`.
3. Rodapé opcional com a ação ("Clique para abrir a Visão diária").

Desvio sempre com sinal, em p.p.

## 4. Tipos

### TrendChart
- `kind="percent"` recorta a faixa útil incluindo a meta; `zeroBaseline={false}` para grandezas absolutas que não começam em zero (hodômetro).
- Pontos abaixo da meta em vermelho (`flagBelowTarget`); ponto corrente maior, com valor.

### ColumnChart
- `kind="count"` começa em zero com passo inteiro; `segments` empilha na ordem da legenda.
- `emptyLabel` para o valor nulo ("Sem leitura"); coluna futura hachurada.

### HBarChart
- Trilho de fundo, rótulo lateral com valor e detalhe, meta vertical tracejada.

### GaugeChart
- Arco de 240°, trilho `--chart-track`, arco no tom de negócio com gradiente sutil, meta como marcador dourado. Valor nulo = trilho vazio e "—".
- Só para taxas 0–100 com significado de "quanto do total". Volumes absolutos vão em KPI ou barras.
- Tom padrão `primary`; tons semânticos só quando há limiar oficial (não inventar faixas).

### DonutChart
- Até ~6 fatias com respiro, total no centro, legenda com valor e percentual. Mais categorias → `HBarChart`.

### Sparkline
- 96×28px, último ponto marcado, meta tracejada opcional, decorativa (`aria-hidden`). Cede espaço ao número do KPI.

## 5. Acessibilidade

- `role="img"` com `aria-label` descritivo, moldura focável.
- Teclado: ←/→ (↑/↓ nas horizontais), Home/End, Enter (drill-down), Esc.
- `aria-live="polite"` anuncia o item ativo; tabela gêmea visível ou `SrTable`.
- Marcas ≥ 3:1 sobre a superfície nos dois temas.

## 6. Aplicação

| Tela | Gráficos |
|---|---|
| Aderência › Visão consolidada | `TrendChart` mensal com meta, `HBarChart` por dimensão, sparklines |
| Aderência › Heatmap | escala semântica, legenda, tooltip rico, drill-down |
| KM › Visão geral | `ColumnChart` KM por dia (dia de referência em destaque), `HBarChart` por operação, tipo e situação |
| KM › Visão diária | `ColumnChart` de faixas de KM (rótulos curtos) |
| KM › Histórico | `TrendChart` de hodômetro (`zeroBaseline={false}`), `ColumnChart` KM por dia com troca de mês |
| KM › Análise gerencial | dispersão por coorte, quadrantes, projeções 30/60/90 |
| KM › Planner | grade com rampa `--heat-*` |
| KM › Qualidade | `GaugeChart` do score DQ + barras dos componentes |
| Manutenção › Visão geral | `ColumnChart` empilhado, `HBarChart`, aging |
| `/dev/design-system` | todos os tipos, claro e escuro |
