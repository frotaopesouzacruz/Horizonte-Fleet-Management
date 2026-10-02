# HFM Design System — Premium Enterprise UI 2.0

> Fundações da Etapa 02 em `docs/design-system.md`; refinamento da Etapa 17
> incorporado aqui. Visualização de dados: `hfm-data-visualization.md`.
> Layout, grade, cabeçalho, filtros e responsividade: `hfm-layout-guidelines.md`.

## 1. Conceito

**Premium, corporativo, tecnológico, profundo e hierárquico.** O HFM é um
produto de operação de frota: denso e preciso, mas com profundidade (níveis de
superfície, sombras difusas tingidas de azul, brilho tonal no canvas) e uma
hierarquia que conduz a leitura — resultado, tendência, onde está o desvio,
detalhe.

As quatro referências visuais da UI 2.0 foram usadas **só como linguagem**
(nenhum layout, cor, logo ou marca copiados):

| Referência | O que inspirou |
|---|---|
| App mobile escuro | profundidade no dark, controles segmentados, superfícies em camadas, microinterações |
| Dashboard claro lavanda | canvas tonal com cartões brancos, organização em blocos, KPIs e gráficos respirando |
| Dashboard escuro de dados | gauges, hierarquia de KPIs, gráficos no escuro sem neon |
| Sidebar expandida/recolhida | trilho recolhido com tooltips, item ativo forte, submenus com linha-guia |

### Marca (inalterada)

| Papel | Valor | Uso |
|---|---|---|
| Azul Horizonte | `#1F4B93` | ação primária, navegação ativa, série principal |
| Ciano | `#008CCB` | foco, informação, série secundária |
| Dourado | `#F4B223` | **meta/benchmark**, acento estratégico (barra do overline). Nunca botão primário global |
| Branco | `#FFFFFF` | cartões no claro |
| Gelo | `#F1F4F8` | base da escala neutra |
| Grafite | `#1F2937` | base do texto |

## 2. Tokens

Arquivos: `src/design-system/tokens/{colors,shape,typography,spacing,motion}.css`,
mapeados para utilitários em `src/design-system/theme/tailwind-theme.css`.
**Componentes não usam hex**: só tokens (`bg-surface-raised`, `text-fg-muted`,
`var(--chart-1)`…).

### 2.1 Escalas derivadas da paleta

| Escala | Passos | Âncora |
|---|---|---|
| `--blue-50…950` | 11 | `--blue-600` = `#1F4B93` |
| `--cyan-50…900` | 10 | `--cyan-500` = `#008CCB` |
| `--gold-50…900` | 10 | `--gold-400` = `#F4B223` |
| `--neutral-0…950` | 12 | `--neutral-100` = `#F1F4F8`, `--neutral-800` ≈ grafite |
| `--green/amber/red-*` | semânticas | sucesso, atenção, crítico |

Os papéis (abaixo) apontam para as escalas; nenhum componente usa a escala
diretamente, exceto gráficos e mapas de calor via `--chart-*` / `--heat-*`.

### 2.2 Superfícies — níveis de profundidade 0–4

| Nível | Token | Claro | Escuro | Uso |
|---|---|---|---|---|
| 0 | `--surface-canvas` (`bg-background`) | `#EDF1F7` + `--canvas-glow` | `#0A111F` + glow | fundo da página; o cabeçalho fica **sobre o canvas** |
| 1 | `--surface-raised` | `#FFFFFF` | `#111A2C` | cartões, KPIs, gráficos, barra de filtros (`--surface-toolbar`) |
| 2 | `--surface-interactive` / `--surface-secondary` | `#F3F6FA` / `#F6F8FB` | `#172238` / `#152035` | controles dentro do cartão, cabeçalho de tabela, trilhos segmentados |
| 3 | `--surface-elevated` | `#FFFFFF` | `#18243B` | popover, menu, tooltip |
| 4 | `--surface-elevated` + `shadow-xl` | — | — | diálogo, gaveta |

O escuro é **azul-grafite corporativo** (não "gamer"): níveis sobem de
luminosidade, bordas carregam a hierarquia e as sombras viram realce interno
(`inset 0 1px 0 rgb(255 255 255 / .04)`).

### 2.3 Bordas, texto e estados

- Bordas: `border-subtle` (divisórias internas) › `border` (contorno do cartão) › `border-strong` (hover de controle) › `border-emphasis` (selecionado).
- Texto: `fg` › `fg-secondary` › `fg-muted` › `fg-subtle` › `fg-disabled`; todos AA nos dois temas.
- Estados: `--surface-hover`, `--surface-selected`, `--hover-overlay`, `--selected-overlay`; semânticos com `*-soft` (fundo), `*-soft-fg` (texto) e `*-border`.

### 2.4 Variação (delta) — `goodWhen`

| `goodWhen` | Exemplos | Subiu | Caiu |
|---|---|---|---|
| `up` | aderência, cobertura, SLA, disponibilidade | verde | vermelho |
| `down` | TMM, downtime, não realizados, pendências, custo | vermelho | verde |
| `neutral` | volume, obrigações previstas, KM total | cinza | cinza |

### 2.5 Tipografia (Montserrat Variable, px)

| Papel | Token | Tamanho/linha | Peso |
|---|---|---|---|
| Título da página | `text-page-title` | 28/34, `--tracking-title` −0,018em | 600 |
| Título de seção | `text-section-title` / `text-h4` | 18/24 · 16/22 | 600 |
| Título de cartão | `text-card-title` | 15/20 | 600 |
| KPI grande / KPI / compacto | `text-kpi-lg` / `text-kpi` / `text-kpi-sm` | 36/40 · 31/36 · 26/30 | 600, `tracking-kpi`, `tabular-nums` |
| Cabeçalho de tabela | `text-table-head` | 12/16 | 600 |
| Corpo | `text-body` / `text-body-sm` | 14/20 · 13/18 | 400–500 |
| Legenda / meta | `text-caption` / `text-meta` | 12/16 · 11,5 | 400–600 |
| Overline | `text-overline` | 11/14, caixa alta | 600 |

Nenhum texto abaixo de 11px. Numerais de tabela à direita com `tabular-nums`.

### 2.6 Forma, elevação e movimento

- Raio: `xs 4` · `sm 6` (badges, chips) · `md 8` (controles, botões) · `lg 12` (cartões, tabelas) · `xl 16` (diálogos, toolbar) · `2xl 20`.
- Sombras: `shadow-xs` (controles) · `shadow-card` (nível 1, difusa e tingida de azul) · `shadow-card-hover` · `shadow-selected` (segmento ativo) · `shadow-md`/`shadow-overlay` (nível 3) · `shadow-xl` (nível 4) · `glow-primary`/`glow-highlight` (foco de destaque, uso raro).
- Acentos de canto: `hfm-corner-accent` + `--accent-tone` (KPI com status) — brilho radial suave no canto, nunca preenchimento.
- Movimento: 120–220ms (`--duration-fast/base/chart`); hover de cartão interativo sobe 1px; `prefers-reduced-motion` zera tudo.

## 3. Componentes base

| Componente | Arquivo | Notas UI 2.0 |
|---|---|---|
| `PageHeader` / `PageHeaderContext` | `components/layout/page-header.tsx` | sobre o canvas; overline com barra dourada; título 28px; `context` (chips de contexto); filtros num **toolbar card** (`data-slot="page-toolbar"`); abas acima ou abaixo |
| `SectionHeader` | `components/layout/section-header.tsx` | abre um nível da narrativa; ícone em chip |
| `Sidebar` (`SidebarItem`, `SidebarBranch`) | `components/layout/sidebar.tsx` | 248px expandida / 68px recolhida com tooltip; ativo com anel e barra; submenus com linha-guia; pai realçado quando o filho está ativo |
| `Card` | `components/ui/card.tsx` | variantes `default`, `outlined`, `elevated`, `inset`, `selected`, `interactive`; `accent` (linha superior + canto) |
| `KpiCard` / `MetricStrip` / `TrendIndicator` | `components/ui/kpi-card.tsx` | rótulo overline, ícone em chip 36px, número protagonista (nunca encolhe), sparkline que cede espaço, rodapé com delta, comparação (até 2 linhas) e meta; `MetricStrip` sem células vazias |
| `Tabs` | `components/ui/tabs.tsx` | `underline` (telas do módulo), `segmented` (alternâncias), `container` (sub-abas em cartão); rolagem lateral com bordas esmaecidas e setas; aba ativa entra na área visível |
| `SegmentedControl` / `ToggleChip` | `components/ui/segmented-control.tsx` | modo de exibição (radiogroup com setas) e opção liga/desliga com marca visível |
| `Button` | `components/ui/button.tsx` | `primary` = Azul Horizonte com sombra de marca; `secondary` = superfície elevada com borda (visível no canvas); `outline`, `ghost`, `danger`; `highlight` (dourado) só na ação institucional única (login) |
| `Badge` / `StatusBadge` | `components/ui/{badge,status-badge}.tsx` | `rounded-sm`, semibold, fundo suave com borda tonal; status sempre com texto ou ícone |
| `FilterBar` / `FilterChip` / `FilterBarClear` | `components/ui/filter-bar.tsx` | campos rotulados que crescem juntos, ações à direita, chips de filtros aplicados abaixo |
| `Input` / `NativeSelect` / `SearchField` / `DateInput` | `components/ui/*` | `rounded-md`, `shadow-xs`, borda que reage ao hover, anel de foco ciano |
| `Table` | `components/ui/table.tsx` | contêiner `rounded-lg` + `shadow-card`, cabeçalho tonal `text-table-head` sem corte, linhas 44px, hover tonal, seleção com barra interna, cabeçalho fixo opcional |
| `Dialog` / `Drawer` / `ConfirmDialog` | `components/ui/*`, `components/feedback/confirm-dialog.tsx` | nível 4, `rounded-xl`, scrim `--surface-overlay` |
| `EmptyState` / `ErrorState` / `Skeleton` | `components/feedback/*` | painel com chip tonal; erro nunca vira 0 |
| `InsightCard` / `InsightList` | `components/feedback/insight-card.tsx` | fato determinístico com tom (positivo, atenção, crítico, informativo): barra lateral + ícone; o texto fica na cor do texto |
| Gráficos (`ChartCard`, `TrendChart`, `ColumnChart`, `HBarChart`, `GaugeChart`, `DonutChart`, `Sparkline`) | `components/charts/*` | ver `hfm-data-visualization.md` |

### 3.1 Regras que valem para todos

- **Primário é azul.** Dourado nunca é botão primário global.
- **Sem HEX nos componentes.** Uma cor nova vira token antes de ser usada.
- **Ausência não é zero.** Falha de consulta → `ErrorState`; sem dado → "—" ou "Sem leitura", nunca `0`.
- **Insight só de dado real.** Cada frase é calculada pela rotina ou pelo carregador; nada genérico ou fictício.
- **Status com texto.** Cor acompanha, não carrega a informação.
- **Títulos de tabela sem corte.** Quando a tabela não cabe, primeiro duas linhas por célula (dado + contexto), depois rolagem dentro do contêiner — nunca rolagem da página.

## 4. Acessibilidade

- Texto AA nos dois temas; marcas de gráfico ≥ 3:1.
- Foco visível (`hfm-focus-ring`) em todo interativo; controles segmentados navegáveis por setas.
- Gráficos com tabela gêmea (`SrTable`), tooltip por teclado e região `aria-live`.
- `prefers-reduced-motion` respeitado.

## 5. Onde conferir

- `/dev/design-system` — tokens, escalas, elevação, componentes e gráficos.
- `/dev/preview-aderencia`, `/dev/preview-km`, `/dev/preview-manutencao` — os três pilotos com dados fixos, claro e escuro.
