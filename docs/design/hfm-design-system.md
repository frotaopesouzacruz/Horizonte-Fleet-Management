# HFM Design System — Enterprise Industrial Tech (Etapa 17)

> Complementa `docs/design-system.md` (Etapa 02). Aquele documento descreve as
> fundações. Este registra o refinamento global da Etapa 17: novos papéis de
> token, hierarquia, elevação, componentes de dado e a narrativa das páginas.
> Visualização de dados está em `hfm-data-visualization.md`.

## 1. Conceito

**Enterprise Industrial Tech.** Um produto de operação de frota: denso, preciso e
calmo. A marca Horizonte conduz, a cor semântica só aparece para julgar
(meta, crítico, pendente) e o número é sempre o protagonista.

Referências conceituais (sem copiar identidade): Fluent 2 (hierarquia de
superfícies e elevação), Carbon (densidade de dados e grade), Atlassian
(semântica de status) e Linear/Vercel/Stripe (tipografia contida, tooltips e
gráficos limpos). O HFC (Lovable) foi consultado somente para leitura.

### Marca (inalterada)

| Papel | Valor | Uso |
|---|---|---|
| Azul Horizonte | `#1F4B93` | ação primária, navegação ativa, série principal dos gráficos |
| Ciano | `#008CCB` | foco, informação, série secundária |
| Dourado | `#F4B223` | destaque estratégico, **meta/benchmark** (nunca em série comum) |
| Branco | `#FFFFFF` | superfícies elevadas no tema claro |
| Gelo | `#F1F4F8` | canvas (`--background` = `#F2F4F8`) |
| Grafite | `#1F2937` | texto principal (`--text-primary` = `#1B2537`) |

A logo oficial continua em `src/components/brand/`.

## 2. Tokens

Arquivos: `src/design-system/tokens/{colors,shape,typography}.css`, mapeados
para utilitários em `src/design-system/theme/tailwind-theme.css`. Os componentes
não usam hex. A auditoria da Etapa 17 encontrou apenas 2 hex fora dos tokens:
o `themeColor` de `layout.tsx`, que espelha `--background`.

### 2.1 Superfícies (níveis)

| Token | Utilitário | Claro | Escuro | Uso |
|---|---|---|---|---|
| `--background` | `bg-background` | `#F2F4F8` | `#0B1426` | canvas |
| `--surface-raised` | `bg-surface-raised` | `#FFFFFF` | `#122039` | cartões, KPIs, gráficos |
| `--surface-secondary` | `bg-surface-secondary` | `#F6F8FB` | `#172440` | cabeçalho de tabela, faixas |
| `--surface-sunken` | `bg-surface-sunken` | `#EEF1F6` | `#0D172B` | trilhos, barras de fundo, poços |
| `--surface-elevated` | `bg-surface-elevated` | `#FFFFFF` | `#1A2946` | menus, diálogos, gavetas |
| `--surface-header` | `bg-surface-header` | `#FFFFFF` | `#0F1A30` | faixa do PageHeader |

O tema escuro é uma paleta própria em azul-marinho, não uma inversão. Os níveis
sobem de luminosidade e as bordas carregam a hierarquia, porque sombra quase
não aparece no escuro.

### 2.2 Texto

`fg` › `fg-secondary` › `fg-muted` › `fg-subtle` › `fg-disabled`. O
`fg-subtle` (`--text-subtle`) foi criado nesta etapa: a auditoria achou 10 usos
sem token definido. Todos os pares de texto passam AA:

| Token | Claro | Escuro |
|---|---|---|
| `fg-muted` | 5,4:1 | 5,1:1 |
| `fg-subtle` | 4,9:1 | 5,3:1 |

### 2.3 Variação (delta)

O sentido de um número não é o seu julgamento. `--delta-positive`,
`--delta-negative` e `--delta-neutral` (texto e fundo) são resolvidos pelo
`goodWhen` da métrica:

| `goodWhen` | Exemplos | Subiu | Caiu |
|---|---|---|---|
| `up` | aderência, disponibilidade | verde | vermelho |
| `down` | custo, não realizados, pendências, tempo parado | vermelho | verde |
| `neutral` | volume, obrigações previstas | cinza | cinza |

### 2.4 Tipografia

A fonte é Montserrat Variable. Os tamanhos são em px para não depender do rem.

| Papel | Token | Tamanho/linha | Peso |
|---|---|---|---|
| KPI grande | `text-kpi-lg` | 34/38 | 600 |
| KPI | `text-kpi` | 30/34 | 600 |
| KPI compacto | `text-kpi-sm` | 26/30 | 600 |
| Título da página | `text-page-title` | 26/32 | 600 |
| Título de seção | `text-section-title` | 18/24 | 600 |
| Título de cartão | `text-card-title` | 15/20 | 600 |
| Corpo | `text-body` / `text-body-sm` | 14/20 · 13/18 | 400–500 |
| Rótulo | `text-label` | 13/16 | 500–600 |
| Legenda | `text-caption` | 12/16 | 400–600 |
| Overline | `text-overline` | 11/14 | 600, caixa alta |

- Nenhum texto fica abaixo de 11px. A auditoria achou 7 usos de `text-[10px]`, que foram trocados por `text-overline`.
- Os numerais KPI usam `tracking-kpi` (−0,02em) e `tabular-nums`.
- Células `td/th.text-right` ganham `tabular-nums` globalmente.

### 2.5 Forma e elevação

| Nível | Token | Uso |
|---|---|---|
| 0 | `none` | canvas, regiões planas |
| 1 | `shadow-card` | Card, KpiCard, ChartCard, tabelas soltas |
| 2 | `shadow-card-hover` | cartão em hover, barras fixas |
| 3 | `shadow-md` | popover, menu, tooltip de gráfico |
| 4 | `shadow-xl` | diálogo, gaveta |

- Raio: controles `rounded-sm` (6px), tabelas internas `rounded-md` (8px), cartões `rounded-lg` (10px), diálogos `rounded-xl` (12px).
- Bordas: `border-subtle` separa por dentro, `border` desenha o contorno do cartão e `border-strong` fica para hover e controles.
- Movimento: 120–220ms (`--duration-fast/base/chart`). `prefers-reduced-motion` zera tudo.

## 3. Narrativa da página

Toda página segue a mesma ordem de leitura:

1. **Cabeçalho** (`PageHeader`): overline do módulo (`eyebrow`), título de 26px, descrição e ações. O seletor de contexto fica ao lado do título (`meta`).
2. **Filtros** (`FilterBar`): campos rotulados, com os **chips de filtros ativos** abaixo (`FilterChip` + `FilterBarClear`).
3. **KPIs**: até 4 principais (`KpiCard`), com a composição logo abaixo (`MetricStrip`).
4. **Análises**: `SectionHeader` + `ChartCard`. Primeiro a tendência, depois onde está o desvio.
5. **Detalhes**: tabelas, leituras (insights) e gavetas.

## 4. Componentes

| Componente | Arquivo | Notas |
|---|---|---|
| `PageHeader` | `components/layout/page-header.tsx` | `eyebrow`, título `text-page-title`, faixa `surface-header`, filtros separados por hairline |
| `SectionHeader` | `components/layout/section-header.tsx` | abre um nível da narrativa; ícone opcional em chip |
| `KpiCard` | `components/ui/kpi-card.tsx` | detalhado abaixo |
| `TrendIndicator` | `components/ui/kpi-card.tsx` | seta, valor e cor de negócio; em KPI, tabela e tooltip |
| `MetricStrip` | `components/ui/kpi-card.tsx` | números de apoio numa faixa com divisórias |
| `ChartCard` | `components/charts/chart-card.tsx` | título, recorte, ações, legenda, desenho, leitura (`insight`), estados vazio e carregando |
| `Card` / `Panel` | `components/ui/card.tsx` | `rounded-lg`, `surface-raised`, elevação 1; `outlined` para cartões aninhados |
| `StatusBadge` | `components/ui/status-badge.tsx` | status único do produto (7 tons, ponto ou ícone, sempre com texto) |
| `FilterBar` / `FilterChip` / `FilterBarClear` | `components/ui/filter-bar.tsx` | chips de filtros ativos |
| `Table` | `components/ui/table.tsx` | cabeçalho em `surface-secondary`, título sem corte (`nowrap`), números à direita com `tabular-nums` |
| `Dialog` / `Drawer` | `components/ui/{dialog,drawer}.tsx` | elevação 4 |
| `Popover` / `DropdownMenu` | `components/ui/{popover,dropdown-menu}.tsx` | elevação 3, `rounded-lg` |

### 4.1 KpiCard

**Anatomia.**
- O rótulo vem primeiro, com um selo opcional (`badge`).
- Um ícone fica em chip suave no canto direito.
- O valor usa o numeral KPI e fica sempre na cor do texto. A cor nunca carrega o número.
- Abaixo do valor fica a sparkline (`sparkline`, com meta tracejada opcional).
- O rodapé traz a variação (`trend` com `goodWhen` e `comparison`), a comparação (`period`) e a meta (`target`).

**Variantes de `status`.**
- `primary`, `secondary`, `success`, `warning`, `danger`, `info`, `accent` e `highlight`.
- O tom aparece como uma linha de 2px no topo e no chip do ícone.
- `neutral` e `secondary` não levam linha.

**Tamanhos.** `compact` (26px), `default` (30px) e `hero` (34px).

**Compatibilidade.** `positiveIsGood` continua aceito, mas foi substituído por `goodWhen`.

### 4.2 Botões

A hierarquia é primary (azul), secondary, outline, ghost e danger. O dourado
(`highlight`) é reservado para a única ação decisiva de uma superfície
institucional (hoje, o "Entrar" do login). Não houve mudança nesta etapa.

## 5. Acessibilidade

- **Contraste.** Todo texto passa WCAG AA nos dois temas. As marcas de gráfico passam 3:1 (a meta usa `#C68600`, e o seu rótulo usa `#7A5300`, a 6,9:1).
- **Cor nunca sozinha.** O status vem sempre com texto ou ícone. O heatmap escreve o percentual e o gráfico tem tooltip e tabela gêmea.
- **Gráficos navegáveis por teclado.** Setas percorrem os pontos, Home/End vão ao primeiro e ao último, Esc fecha e Enter abre o detalhe. Uma região `aria-live` anuncia o ponto ativo.
- **Foco.** O anel `--shadow-focus` / `outline` fica em todo elemento interativo.

## 6. Responsividade

- As larguras de referência são 1920, 1440, 1366×768, 1280, 1024, tablet (768) e celular (390).
- Os KPIs ficam em 1 coluna no celular, 2 no tablet e 4 a partir de `xl`.
- Os gráficos medem a largura real do cartão (ResizeObserver), então nunca esticam o texto. Abaixo do mínimo, rolam na horizontal dentro do cartão, sem rolar a página.
- No heatmap, o mês em análise mostra percentual, numerador e denominador a partir de `2xl`. Abaixo disso mostra o percentual, e os meses vizinhos viram um calendário de cor.

## 7. Onde conferir

- `/dev/design-system`: tokens, escala, elevação, papéis de gráfico, KPIs com variação e sparkline, `MetricStrip`, `TrendIndicator` e exemplos de gráficos.
- `/dev/preview-aderencia`: o piloto (Gestão de Checklist › Aderência) com dados fixos.
