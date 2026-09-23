# HFC · Central de Fidelização — mapeamento verificado (Etapa 15)

Fonte: projeto Lovable `e8a92f16-ab41-4b34-ada2-cddbed391b51` (HFC), commit
`79a299c80fd8`, última edição do projeto em 17/09/2026 15:06 UTC. Inspeção
**somente leitura** feita em 23/09/2026: nenhum arquivo, registro, migration ou
publicação do HFC foi alterado.

O código do HFC não mudou desde o mapeamento da Etapa 13
([`hfc-governance-mapping.md`](./hfc-governance-mapping.md), 22/09/2026). Este
documento registra o que a Etapa 15 confirmou, corrigiu ou acrescentou àquele.

## Estado da inspeção

* **Código**: lidos por inteiro os 9 arquivos pedidos (`fidelizacao-module`,
  `estabilidade-dashboard`, `planner-frotas-module`, `fidelizacao-grid`,
  `mobilizacao-dialog`, `planner-motoristas-module`, `fidelization-api`,
  `fidelization-motoristas-api`, `fidelization-import`), as 7 rotas da Central e
  os módulos de apoio listados em [Limitações](#limitações).
* **Banco**: as 7 primeiras consultas responderam (contagens, colunas,
  constraints, índices, gatilhos). Das 11:44 às 12:16 UTC toda consulta, até
  `SELECT 1`, expirou em 60 s. O que dependia delas está em
  [Limitações](#limitações) como **não obtido** — nada ali foi presumido.
* **Execução**: a aplicação do HFC não foi executada. Os efeitos de tela
  descritos abaixo foram deduzidos do código.

## 1. Telas e navegação

| Rota | Componente | Observação |
|---|---|---|
| `/app/fidelizacao/` | `FidelizacaoModule` | links para `/app/fidelizacao/planner-*` |
| `/app/fidelizacao/planner-frotas` | `PlannerFrotasModule` | |
| `/app/fidelizacao/planner-motoristas` | `PlannerMotoristasModule` | |
| `/app/fidelizacao/importar` | `ImportFidPage` | **a página não confere capability** |
| `/app/lideranca/fidelizacao` | `FidelizacaoModule` | links para `/app/lideranca/planner-*` |
| `/app/lideranca/planner-frotas` | `PlannerFrotasModule` | |
| `/app/lideranca/planner-motoristas` | `PlannerMotoristasModule` | |

* A Central não tem abas: cabeçalho "Módulo 07 · Central de Fidelização", botão
  **Importar Base** (com `fidelizacao.import`), dois cartões-link (Planner de
  Frotas, Planner de Motoristas), barra de competência (`<` `>`, mês, ano entre
  ano−1 e ano+1) e o Dashboard de Estabilidade.
* O guarda de rota usa `ROTAS_PERMITIDAS` ou as linhas de `perfil_permissoes`;
  `ROTAS_BLOQUEADAS` não entra. Um perfil fora da lista recebe "todas".
* O aviso de escopo vazio usa a competência **corrente** do `AccessProvider`,
  não a selecionada na tela.

## 2. Dashboard de Estabilidade (HFC)

```ts
brsComPlaca = brs.filter(b => placaByBrDay.get(b.codigo)?.size > 0)
brsSemPlaca = brs.length - brsComPlaca.length
trocas = totalMob = all.length   // explícitas + derivadas não duplicadas
taxa = brsComPlaca.length > 0
  ? ((brsComPlaca.length - new Set(all.map(m => m.codigo_br)).size) / brsComPlaca.length) * 100
  : 0
```

* As mobilizações explícitas **não** são deduplicadas entre si: uma troca por
  período de N dias vira N linhas (a gravação é feita dia a dia).
* As trocas derivadas (placa do dia diferente da do dia anterior) são
  deduplicadas entre si e contra as explícitas, e são calculadas sobre todo o
  diário, não só sobre as BRs filtradas.
* Cores: taxa ≥ 90 verde, ≥ 70 dourado, abaixo vermelho. Gráficos e ranking:
  razão ≥ 0,8 vermelho, ≥ 0,5 dourado.

## 3. Planner de Frotas, grade e diálogo

* Grupos Tipo de operação → Liderança → Local, uma tabela por local; primeira
  coluna fixa; fim de semana sombreado; histórico de mobilizações recolhido.
* O chip "Somente leitura" depende de `fidelizacao.import`, não de
  `frotas.edit`.
* **Diálogo "Editar fidelização do dia"**: período limitado ao mês, busca de
  placa ou frota (50 primeiras, inclusive veículos inativos), opção
  "— Sem placa (remover) —", caixa de inversão quando a placa está em outro
  BR. Salvar sem mudança é permitido e regrava os dias.
* **Gravação**: um laço dia a dia chama `fid_set_daily_cell` (ator fixo
  `"Sistema"`). A RPC apaga **todas** as placas do BR no dia e insere a nova
  como `manual`, sem `br_oficial_id`. Se um dia falha, o laço para e o diálogo
  fecha mesmo assim.
* Versão vigente da RPC: migração `20260917150540` (corpo lido da migration; o
  corpo ao vivo não foi obtido). `REVOKE` de `authenticated`, `GRANT` a
  `service_role`.

## 4. Planner de Motoristas

* Status `ativo`, `pendente`, `substituido`, `encerrado` (CHECK no banco).
  Vários registros por BR; não existe turno.
* A placa do motorista é sempre recalculada a partir da grade; editar um
  registro encerrado ou substituído o reativa.
* A substituição tende a ser bloqueada pela própria checagem de conflito (o
  registro substituído não é excluído da busca).
* "Encerrar" usa a data UTC de hoje, sem confirmação e sem tratar erro; pode
  gerar `data_fim < data_inicio` (sem CHECK).
* "Replicar mês anterior" copia só os `ativo`, sem confirmação nem
  deduplicação.

## 5. Histórico de mobilizações

Existe só dentro do Planner de Frotas: bloco recolhido com Data, Hora, BR,
placa anterior, nova placa, motivo e usuário (`actor`, na prática sempre
"Sistema"). Os filtros da página não se aplicam; não há paginação nem
exportação.

## 6. Importação

Cinco passos; primeira aba da planilha; mapeamento automático por igualdade e
depois por *substring*; layouts salvos em `fidelization_import_layouts`
(0 linhas). Uma linha com BR não oficial rejeita **a carga inteira**; BRs de
`fidelization_brs` que faltam são criadas; o upsert (`data, codigo_br, placa`)
não remove outras placas do mesmo BR/dia; o número de linha dos erros não bate
com a planilha; auditoria com ator `"Sistema"`.

## 7. Banco (contagens ao vivo)

| Tabela | Linhas |
|---|---|
| `fidelization_brs` | 88 |
| `fidelization_daily` | 24.559 |
| `fidelization_motoristas` | 27 |
| `fidelization_mobilizacoes` | 94 |
| `fidelization_audit` | 7 |
| `fidelization_import_layouts` | 0 |
| `operation_brs` | 88 |
| `operation_br_placas` | 0 |
| `operation_br_substituicoes` | 0 |
| `planner_liderancas` | 198 |

`fidelization_mobilizacoes` só tem PK (nenhuma FK nem UNIQUE);
`fidelization_motoristas` não tem FK para BR, motorista ou frota. Há duas
identidades de BR (`fidelization_brs` e `operation_brs`, 88 cada).

## 8. Deltas em relação ao mapeamento da Etapa 13

1. A RPC vigente é da migração `20260917150540` (não `…145426`); chama
   `fleet_scope_bump` sempre.
2. As trocas derivadas também são deduplicadas entre si.
3. As trocas derivadas escapam dos filtros do Planner de Frotas.
4. Os limiares 80 % / 50 % valem para os dois gráficos e para o ranking.
5. `/app/fidelizacao/importar` não confere `fidelizacao.import`.
6. "Somente leitura" depende de `import`, não de `frotas.edit`.
7. Motoristas: edição reativa e troca a placa; a substituição é barrada pela
   própria checagem; pendentes participam da checagem.
8. O diálogo fecha mesmo com erro; salvar sem mudança zera `br_oficial_id`.
9. A ordem do histórico difere entre perfil global e liderança.
10. O aviso de escopo vazio usa a competência corrente.
11. O guarda de rota ignora `ROTAS_BLOQUEADAS`.
12. `operation_br_placas` e `operation_br_substituicoes` estão vazias.
13. O gatilho `_upd_row` ignora mudanças só em `status_operacional`.

## 9. Problemas verificados no HFC e como o HFM os trata

| # | Problema no HFC | No HFM (Etapa 15) |
|---|---|---|
| 1 | Substituição de motorista barrada pelo próprio registro | `substitute_fidelization_driver` fecha o anterior e abre o novo numa transação (suíte 15 M1) |
| 2 | Editar reativa registro encerrado | A situação do vínculo não é recalculada por edição; mudar datas que já passaram exige a permissão de correção histórica (P10) |
| 3 | Salvar célula sem mudança apaga dados da linha importada | Não há regravação por dia: a edição é por período e passa por prévia |
| 4 | Inversão apaga todas as placas do BR de origem | Inversão recorta só o período nos dois BRs e devolve cada veículo depois (P4) |
| 5 | Mobilização duplicada por dia | Um evento por alteração efetiva, com chave de deduplicação única (P2, P3) |
| 6 | Diálogo fecha com erro | Falha mantém o diálogo aberto com a mensagem; a gravação é uma transação só (P5) |
| 7 | Leitura sem paginação | Matriz e histórico calculados no banco; histórico paginado |
| 8 | Aviso de escopo pela competência corrente | Tudo segue a competência da tela |
| 9 | Importação sem capability; escritas com service role | Rotinas `security definer` conferem permissão e escopo no banco; a fidelização roda com o cliente da própria pessoa, nunca com service role |
| 10 | Linha dos erros não bate | Prévia de importação por linha da planilha (Etapa 13) |
| 11 | Duplicatas no lote forçam modo linha a linha | Prévia classifica duplicatas antes de gravar (Etapa 13) |
| 12 | Encerrar sem confirmação, data UTC | Encerramento com data e motivo obrigatórios; datas em America/Sao_Paulo |
| 13 | Escopo de placas da liderança sempre vazio | Escopo por operação (`membership_operation_scopes`) e liderança por BR com exceção |
| 14 | Conflito sem escopo nem tratamento | Conflito calculado no banco, nomeado na prévia, com inversão oferecida (P6) |
| 15 | Ator sempre "Sistema" | Todo evento grava o usuário autenticado (`actor_user_id`); "Sistema" só sem sessão |

## Limitações

* **Não obtidos (timeout do banco do HFC)**: flags de RLS, `pg_policies` e
  grants ao vivo; se `placa_norm` é coluna gerada; contagens de qualidade de
  dados (`br_id` nulo, placa em dois BRs no mesmo dia, ator "Sistema" ×
  outros, sobreposições de motoristas); volume mensal do diário; corpo ao vivo
  das funções `fid_*`; `perfil_permissoes`. Os corpos de função citados foram
  lidos das migrations `20260917150540`, `20260914105448`, `20260915112301`,
  `20260917145426`, `20260901151854`, `20260901154304` e `20260831121857`.
* **Código**: o Lovable não tem busca global; "quem mais lê X" vale só para os
  arquivos lidos. Não lidos: `types.ts`, KM, pneus, GPAC e
  `app.checklist-frota.tsx`.
