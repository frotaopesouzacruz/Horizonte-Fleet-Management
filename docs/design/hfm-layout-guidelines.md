# HFM — Diretrizes de layout (UI 2.0)

Como montar uma tela do HFM para que todas pareçam partes do mesmo produto.
Tokens e componentes: `hfm-design-system.md`. Gráficos:
`hfm-data-visualization.md`.

## 1. Moldura

| Elemento | Medida | Token |
|---|---|---|
| Sidebar expandida | 284px | `--sidebar-width` |
| Sidebar recolhida | 68px (só ícones, tooltip à direita) | `--sidebar-width-collapsed` |
| Topbar | 56px, fixa | `--topbar-height` |
| Conteúdo | até 1760px, gutter 16px (celular) / 24px (≥ sm) | `--content-max-width` |
| Canvas | `bg-background` + `--canvas-glow` (brilho tonal fixo) | nível 0 |

Prioridade de validação: **1366×768** (notebook corporativo), depois 1440,
1920, 1280, 1024, tablet 768 e celular 390.

## 2. Ordem de leitura de toda página

1. **Cabeçalho** (`PageHeader`) — sobre o canvas, sem faixa própria:
   overline do módulo (barra dourada), título 28px, descrição em uma frase,
   ações à direita (primária azul + secundárias). `meta` ao lado do título para
   seletores de contexto (ex.: Saída/Retorno de rota). `context` para chips
   de recorte (competência, período, atualização).
2. **Abas da tela** (`Tabs appearance="underline"`), acima dos filtros quando
   a aba escolhe a tela (`tabsPlacement="top"`).
3. **Filtros** — num cartão de ferramentas (`data-slot="page-toolbar"`), ver §4.
4. **Contexto da visão** — uma linha: período, dia de referência, "hoje".
5. **Resultado** — KPIs principais (`KpiCard`) e composição (`MetricStrip`).
6. **Tendência** — `SectionHeader` + `ChartCard`.
7. **Onde está o desvio** — quebras, rankings, mapas de calor.
8. **Detalhe** — tabelas, leituras (`InsightCard`), gavetas.

Espaçamento vertical entre blocos: `gap-5` (20px); entre cartões de uma grade:
`gap-3` (KPIs) ou `gap-4` (gráficos e tabelas).

## 3. Grade de KPIs

| Quantidade | Grade |
|---|---|
| 3–4 | `sm:grid-cols-2 xl:grid-cols-4` (ou 3) |
| 5 | `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5` — cinco lado a lado a 1366 |
| 6 | `sm:grid-cols-2 lg:grid-cols-3` (2 linhas cheias) |
| 8 | `sm:grid-cols-2 lg:grid-cols-4` |
| 10 | `xl:grid-cols-5` (2 linhas cheias) |

Regra: **nenhuma linha órfã** (um cartão sozinho na última linha) na largura
de referência. O número do KPI nunca encolhe; a legenda vai a até 2 linhas.

## 4. Barra de filtros

- Campos com rótulo acima (`text-caption`), controles `size="sm"`.
- Os campos **crescem juntos** (`flex-[grow_shrink_basis]`, controle `w-full`)
  e só quebram linha quando não cabem. Campos curtos têm base fixa
  (Competência 10,5rem, UF 5,75rem); busca por placa/frota cresce mais.
- Ações (`Mais filtros`, `Limpar filtros`) ficam num grupo à direita da
  primeira linha — nunca um botão sozinho numa linha.
- Filtros técnicos por **ID** (nunca por nome).
- Filtros aplicados viram **chips** abaixo da barra (`FilterChip`), cada um
  removível, com "Limpar filtros".
- Filtros secundários vão para o popover "Mais filtros" com contador.

## 5. Abas

- `underline`: telas do módulo. Quando não cabem, a lista rola com bordas
  esmaecidas e setas; a aba ativa entra sozinha na área visível.
- `segmented`: alternância de visão dentro da tela (Por operação / Por
  localização / Dispersão / Projeções; Top 10 / Top 20 / Todos).
- `container`: sub-abas dentro de um cartão.
- Modos de exibição que não trocam de painel usam `SegmentedControl`;
  opções liga/desliga usam `ToggleChip`.

## 6. Cartões e tabelas

- Cartão padrão: `rounded-lg`, `border`, `shadow-card`, padding 16px
  (`px-4 py-3.5` em KPI). Cartões aninhados: `outlined` ou `inset`.
- Duas colunas a partir de `xl` para pares (gráfico + gráfico, top + bottom).
  Um terceiro cartão de uma grade de 2 colunas ocupa a linha inteira
  (`lg:col-span-2`) em vez de ficar órfão.
- Tabelas em cartão estreito: primeiro **células de duas linhas** (dado +
  contexto: "VA174 · SNU9C19 / Van · 417 Sprinter F"; "Local / BR 0123"),
  cabeçalhos curtos com `<abbr title>` ("KM", "Dias"). Rolagem horizontal só
  dentro do contêiner da tabela e só para tabelas de auditoria (lotes, base).
- Títulos de coluna nunca truncam.

## 7. Estados

| Estado | Componente | Regra |
|---|---|---|
| Carregando | `Skeleton` no formato final | sem "0" provisório |
| Vazio | `EmptyState variant="panel"` | diz o porquê e a ação ("Ajuste a competência…") |
| Erro | `ErrorState` com "Tentar novamente" | falha de consulta nunca vira 0 |
| Sem leitura / sem base | "—" ou "Sem leitura (não é 0 km)" | ausência ≠ zero |
| Futuro | hachura, sem valor | futuro não é resultado |

## 8. Responsividade

- **1366×768**: filtros em 1–2 linhas cheias, KPIs sem órfãos, 10 abas com
  rolagem visível, nenhuma rolagem horizontal da página.
- **≤ 1024**: grades caem para 2 colunas; sidebar vira gaveta.
- **Celular (390)**: 1 coluna, KPIs empilhados, tabelas largas rolam dentro do
  cartão, planner rola sem colunas fixas, alvos de toque ≥ 36px.

## 9. Dark mode

Mesmo layout; superfícies sobem de luminosidade por nível, bordas mais
presentes, sombras viram realce interno. Gráficos usam as variantes claras
dos papéis (`--chart-*` do tema escuro). Conferir sempre os dois temas.

## 10. Checklist de revisão de tela

- [ ] Overline + título + descrição + ações no `PageHeader`.
- [ ] Abas/filters sem botão órfão; chips dos filtros aplicados.
- [ ] KPIs sem linha órfã; número inteiro visível; delta com `goodWhen`.
- [ ] Gráficos sem rótulo cortado; tooltip; tabela gêmea.
- [ ] Tabelas sem rolagem lateral evitável; títulos inteiros.
- [ ] Nenhum HEX novo; nenhum 0 como fallback; nenhum insight genérico.
- [ ] Claro e escuro conferidos a 1366×768 e no celular.
