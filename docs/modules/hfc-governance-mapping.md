# HFC — Mapeamento funcional dos módulos de governança

Projeto de referência: **Horizonte Fleet Command (HFC)**, Lovable `e8a92f16-ab41-4b34-ada2-cddbed391b51` (inspeção somente leitura, 2026-09-22).
Objetivo: permitir que o HFM reproduza a lógica funcional de **BRs**, **Planner de Lideranças**, **Central de Fidelização**, **Planner de Frotas** e **Planner de Motoristas** sem reler o HFC.

Convenções: nomes de tabelas/colunas em `código`; "competência" = (ano, mês); "placa normalizada" = `upper` + remoção de tudo que não é `A-Z0-9` (mesma regra em `normalizePlaca` do cliente e `fleet_norm_placa` do banco).

---

## 0. Arquitetura comum (vale para todos os módulos)

**Stack.** TanStack Start (rotas em `src/routes/app.*.tsx`), React Query, shadcn/ui, Supabase (PostgreSQL + PostgREST).

**Acesso ao banco.** O navegador **não** fala com o Supabase diretamente. `src/integrations/supabase/db.ts` cria um client apontando para `/api/db/*`; a rota `src/routes/api/db.$.ts` valida o cookie de sessão própria do Horizon (`horizonte_session`, matrícula + CPF) e repassa a chamada ao Data API com a **service role key**. Migração `20260831121857` removeu todas as policies abertas, habilitou RLS em todas as tabelas e revogou `anon`/`authenticated`. Consequência verificada: `pg_policies` está **vazia** para todas as tabelas de governança (`relrowsecurity = true`, sem policies) → **toda autorização é de aplicação**, não de banco.

**Camadas de autorização (aplicação).**
1. Rotas: `src/lib/permissoes.ts` (`ROTAS_PERMITIDAS`/`ROTAS_BLOQUEADAS` por perfil). Liderança só acessa `/app/lideranca/*` + apps.
2. Capacidades: `src/lib/access-context.tsx` — `capabilitiesForProfile`: `administrador`/`gestor_frota` = todas; `rh` = ANALISTA (inclui `fidelizacao.frotas.edit`, `km.import`, `aderencia.import`); `lideranca` = `fidelizacao.frotas.view`, `fidelizacao.motoristas.view/edit`, `aderencia.view`, `km.view/export`, etc.; **qualquer outro perfil (ex.: `analista_frota`) recebe `[]`**.
3. Escopo de dados: `src/lib/access.server.ts` → `resolveAccessScope(ano, mes)`: perfis `administrador|gestor_frota|rh` = `GLOBAL`; `lideranca` = `LEADERSHIP_OPERATION` derivado de `planner_liderancas` (`lideranca-escopo.server.ts#getEscopoCompetencia`); demais = escopo vazio.
4. Leituras compartilhadas: `src/lib/scoped-queries.ts#useScopedData` — perfil global chama a API cliente direto; perfil escopado chama server functions (`scoped-data.functions.ts` → `scoped-data.server.ts`) que **filtram em memória** após ler tudo com service role.
5. Escrita escopada: só existe `saveFidMotorista` → `assertWithinScope` (consultiva: valida e devolve `{ok:true}`; a gravação real é feita depois pelo cliente).

**`getEscopoCompetencia(ano, mes)`** (fonte do escopo da liderança):
- `planner_liderancas` filtrado por competência e (se perfil ≠ administrador) `lideranca_user_id = usuário da sessão`.
- `operacoes` = nomes das `operations` dos `tipo_operacao_id`; `cidades/locais` = `"{cidade_nome}/{cidade_uf}"`; `pares` = operação + local.
- `brs` = `operation_brs` com `status='ativo'` cujas `city_id` ∈ `operation_cities` filtradas por `operation_id IN opIds AND ibge_code IN ibges` (filtro cruzado, não por par).
- `placas` = `operation_br_placas.placa` com `data_fim IS NULL` desses BRs.
- `vazio = true` quando não há linha no planner.

**`scopeMatchers`** (normalizações de comparação): BR por `normalizeBrCode` (sem acento, upper, espaços colapsados); local por `normalizeOperationalLocation` (remove sufixo de UF `"/MG"`, `"- MG"`, `"(MG)"`, sem acento, upper); placa normalizada; par `OPERACAO::LOCAL`.

**Invalidação de cache (cliente).** `src/lib/fleet-scope.ts#invalidateFleetScope(qc)` invalida toda query cujo primeiro elemento da chave contenha um dos prefixos (`planner_liderancas`, `fidelizacao`, `fidelization`, `aderencia`, `km`, `pneus`, `gpac`, `mtsr`, `manutencao`, `lideranca`, `escopo`…). No banco existe `fleet_scope_versions` (bump por competência), mas nenhum arquivo inspecionado a consome no cliente.

**Camada canônica de escopo (banco).** Ver §6. Resumo: `vw_lideranca_competencia` (planner × operations × app_users, com chaves normalizadas) e `vw_frota_escopo_competencia` (`fidelization_daily` × `operation_brs` × planner) são a "verdade"; colunas textuais `lideranca`, `gestor`, `lider_operacao` nos módulos são **cache regravável** por gatilhos.

---

## 1. BRs de Operação (cadastro oficial)

### Objetivo
Cadastrar os BRs (rotas/contratos) de cada Tipo de Operação por cidade e manter o vínculo cadastral **placa ↔ BR** com histórico de substituições. É a fonte usada para validar importações da fidelização e para derivar o escopo (BRs e placas) da liderança.

### Navegação / telas
`/app/operacoes/$id` → aba **"BRs de Operação"** (`src/components/operations/brs-tab.tsx`). Só perfis com acesso a `/app/operacoes` (administrador, gestor_frota). Não há tela para liderança.

### Componentes visuais
- Barra de filtros: `Cidade` (todas | cidades da operação), `Status` (todos | ativo | inativo), botão **Novo BR** (desabilitado sem cidades; aviso "Cadastre cidades na aba Estados e Cidades…").
- Tabela: Código BR (mono), Cidade, Liderança (`lideranca_nome`), Status (badge), Ações: **Gerenciar placas** (ícone caminhão), **Editar**, **Excluir** (`confirm("Remover BR X? Isto desfaz todos os vínculos de placa.")`).
- Rodapé: "N BR(s) cadastrado(s) nesta operação."
- **Dialog Novo/Editar BR**: Código BR* (placeholder `BR0024193`), Cidade* (select), Descrição, Liderança Operacional (texto livre → `lideranca_nome`), Status* (ativo/inativo). `lideranca_user_id` existe na tabela mas **nunca é preenchido pela UI**.
- **Dialog Gerenciar Placas** (`br-placas-dialog.tsx`): campo "Vincular nova placa" + botão; lista **Placas Ativas** (badge placa formatada, "desde dd/mm/aaaa", botões **Substituir** e **X** com `confirm`); `<details>` "Placas anteriores (n)" (vínculos com `data_fim`); `<details>` "Histórico de Substituições (n)" (antiga → nova, data/hora, justificativa, "por usuário · cidade").
- **Dialog Substituir Placa**: Local de Operação (ro), BR (ro), Placa Atual (ro), Nova Placa*, Justificativa* (mín. 5 caracteres na UI).

### Indicadores
Nenhum KPI; apenas contagem de BRs. `buildHierarchy` (`operation-brs-api.ts`) monta árvore Operação → lideranças (distintas de `lideranca_nome`) → cidades → BRs → placas ativas, consumida por `hierarquia-tree.tsx` (componente existente; não encontrado montado nas rotas inspecionadas).

### Campos (tabelas)
- `operation_brs`: `id`, `operation_id` (FK `operations` **CASCADE**), `city_id` (FK `operation_cities` **CASCADE**), `codigo`, `descricao`, `lideranca_user_id` (FK `app_users` SET NULL), `lideranca_nome`, `status` (check `ativo|inativo`), `observacao`, `created_at`, `updated_at`. **Unique `(city_id, codigo)`** → o mesmo código pode existir em cidades diferentes.
- `operation_br_placas`: `id`, `br_id` (FK `operation_brs` **CASCADE**), `vehicle_id` (FK `vehicles` SET NULL), `placa` (normalizada), `data_inicio` (default `CURRENT_DATE`), `data_fim`, timestamps. **Índice único parcial `uniq_op_br_placas_ativo (placa) WHERE data_fim IS NULL`** → uma placa só pode ter um vínculo ativo em todo o sistema.
- `operation_br_substituicoes`: `id`, `br_id` (FK CASCADE), `cidade_nome` (texto), `placa_antiga`, `placa_nova`, `justificativa`, `usuario` (texto), `created_at`.

### Regras de edição
- `createBR`: trim do código; erro amigável se violar `operation_brs_codigo_cidade_unique`.
- `vincularPlaca(brId, placa)`: valida formato (`ABC1234` ou `ABC1D23` após normalizar); `findActivePlacaLink` (vínculo com `data_fim IS NULL` em qualquer BR, `maybeSingle`) → se for o mesmo BR: "Esta placa já está vinculada a este BR."; se outro: "…já possui vínculo ativo com o BR X. Utilize o processo de substituição…"; procura `vehicles.placa = placa` para `vehicle_id` (best-effort, pode ficar null); insere.
- `removerPlaca(id)`: **não apaga**; faz `update data_fim = hoje`.
- `substituirPlaca`: justificativa obrigatória; normaliza ambas; iguais → erro; nova placa ativa em **outro** BR → erro; localiza vínculo ativo da placa atual **neste** BR (senão erro); (1) `update data_fim = hoje` (**sem checagem de erro**), (2) insert novo vínculo (vehicle_id por lookup), (3) insert em `operation_br_substituicoes` com `usuario = currentUser ?? "Sistema"` (`currentUser = user.fullName ?? user.matricula` do contexto da rota). Três chamadas sequenciais, não transacionais.
- `deleteBR`: delete físico; cascata apaga placas e substituições.

### Relacionamentos e integrações
- `fidelization_daily.br_oficial_id` → `operation_brs` (SET NULL). Preenchido **apenas** pela importação (§4.7); nunca pela edição manual do grid.
- Escopo da liderança: BRs ativos por cidade + placas ativas (§0).
- `fetchRelatorioChecklistsPorUsuario` (lideranca-escopo.server) resolve o BR de um checklist pela placa e pela vigência `data_inicio..data_fim` de `operation_br_placas` (única leitura "histórica" desses vínculos).
- Importação da fidelização valida `(operação, cidade, código)` contra `operation_brs` (§4.7).
- O grid/dashboards de fidelização **não** leem `operation_br_placas`.

### Situações excepcionais
- BR sem placa: permitido; aparece com "Nenhuma placa vinculada".
- Placa em dois BRs: bloqueado (aplicação + índice parcial). Pode ocorrer historicamente com vínculos encerrados.
- Cidade removida do Tipo de Operação (`updateOperation` apaga `operation_cities` das cidades/UFs retiradas **sem aviso**) → cascata apaga BRs, placas e substituições da cidade.

### Problemas verificados
- Duas entidades de BR coexistem (`operation_brs` × `fidelization_brs`, §4). Confirmado.
- `lideranca_nome` textual e `lideranca_user_id` nunca usado. Confirmado.
- Substituição não transacional e sem checagem do primeiro `update`. Confirmado.
- Cascatas silenciosas por cidade/operação. Confirmado por `pg_constraint`.
- `usuario` da substituição é texto (nome/matrícula), sem FK. Confirmado.

---

## 2. Planner de Lideranças

### Objetivo
Definir, por competência, **qual liderança (usuário `profile='lideranca'`) responde por cada par Tipo de Operação × Cidade**. É a única fonte de "liderança do mês" para todos os módulos e a base do escopo de dados do perfil liderança.

### Navegação / telas
`/app/planner-liderancas` (`src/routes/app.planner-liderancas.tsx`). Bloqueada para liderança/operacional.

### Componentes visuais
- Cabeçalho "Módulo · Planejamento Operacional / Planner de Lideranças Operacionais".
- 3 KPIs: **Locais de operação**, **Atribuídos no mês** (`atribuídos/locais`), **Lideranças envolvidas**.
- Barra "Competência": selects Mês e Ano (`ano-1, ano, ano+1`); botão **Replicar planejamento** (AlertDialog com Mês/Ano de origem; texto: "Copia o planejamento de uma competência de origem para {mês/ano}. Tipos de operação já atribuídos no destino serão preservados.").
- Matriz "Tipos de Operação · Cidades — mês/ano": um bloco por `operations.status='ativo'` (nome, `code`, badge "n cidades"); dentro, uma linha por cidade (`operation_cities` da operação, ordenadas por nome): nome + UF | `Select` de liderança (usuários `profile='lideranca' AND status='ativo'`, rótulo `full_name` + `matricula`; placeholder = nome atual ou "Selecionar liderança") | botão lixeira (se existe atribuição).
- Painel **Auditoria — mês/ano**: últimas 200 linhas de `planner_liderancas_audit` da competência: `action · field`, data/hora, `de: <old> → para: <new>` (JSON).

### Indicadores (fórmulas)
- `totalLocais = Σ (cidades de cada operação ativa)`.
- `totalAtribuidos = count(planner_liderancas da competência)` (inclui linhas de operações/cidades hoje inativas/removidas).
- `totalLideres = count(distinct lideranca_user_id)`.

### Campos
`planner_liderancas`: `id`, `competencia_ano` (check 2020–2100), `competencia_mes` (check 1–12), `tipo_operacao_id` (FK `operations` **CASCADE**), `cidade_ibge_code`, `cidade_nome`, `cidade_uf` (snapshots textuais; **sem FK para `operation_cities`**), `lideranca_user_id` (FK `app_users` **RESTRICT**), `observacao`, `created_by` (FK `app_users`; nunca preenchido), timestamps. **Unique `(competencia_ano, competencia_mes, tipo_operacao_id, cidade_ibge_code)`**.
`planner_liderancas_audit`: `planner_id` (FK SET NULL), competência, `local_operacao_id` (legado, nunca usado), `tipo_operacao_id`, `cidade_ibge_code`, `cidade_nome`, `action`, `field`, `old_value`/`new_value` (jsonb), `origin` (`manual|replicacao`), `actor_user_id` (nunca preenchido), `actor_label` (sempre `"Sistema"`), `created_at`.

### Filtros
Apenas competência. Não há busca.

### Regras de edição (`planner-liderancas-api.ts`)
- **Selecionar liderança** (`upsertPlannerEntry`): `select` por (ano, mês, op, ibge) → se existe: `update {lideranca_user_id, observacao: input.observacao ?? null}` (a UI nunca envia `observacao` → **qualquer observação é apagada** na troca) e, **só se o líder mudou**, insere auditoria `lideranca_changed` (`field='lideranca_user_id'`, old/new = ids); se não existe: `insert` (com snapshot `cidade_nome/uf`) + auditoria `created` (`new_value={lideranca_user_id}`).
- **Remover** (`deletePlannerEntry`): `select` → `delete` → auditoria `deleted` (`planner_id=null`, `old_value={lideranca_user_id}`).
- Após cada mutação: `invalidateFleetScope`.

### Regras de planejamento — replicação (`replicarPlanner(origemAno, origemMes, destAno, destMes)`)
1. `origem = linhas da competência de origem`; se vazio → `{inserted:0, skipped:0}`.
2. `ocupados = Set("{tipo_operacao_id}|{cidade_ibge_code}")` das linhas **já existentes no destino**.
3. `toInsert = origem.filter(chave ∉ ocupados)`.
4. `insert` em lote de `toInsert` com `competencia = destino`, copiando `tipo_operacao_id`, `cidade_ibge_code`, `cidade_nome`, `cidade_uf`, `lideranca_user_id`, `observacao`.
5. `insert` em lote na auditoria: `action='replicated'`, `origin='replicacao'`, `new_value={lideranca_user_id, from:{ano,mes}}`, `planner_id=null`.
6. Retorna `inserted = toInsert.length`, `skipped = ocupados.size` (conta **todas** as linhas do destino, não só as colisões).
Propriedades: **nunca sobrescreve** nem apaga; não valida se operação/cidade/líder continuam ativos; não é transacional (insert + auditoria separados). Default da origem na UI: `origemMes = max(1, mêsAtual-1)` → em janeiro a origem padrão é janeiro (não dezembro do ano anterior).

### Funções / triggers
- `trg_planner_liderancas_propagar` (AFTER INSERT/UPDATE/DELETE, por linha) → `fleet_sync_competencia(ano, mes, tipo_operacao_id, cidade_ibge_code, 'planner_<op>')` → coleta as datas da competência em `vw_frota_escopo_competencia` para aquele par → `fleet_sync_datas(datas)` regrava `lideranca`/ids em `frota_status_diario`, `fidelization_daily`, `km_daily_readings`, `tire_daily_snapshots`, `gpac_checklist_records`, `maintenance_records`, `avaria_maintenance_records` (e `mtsr_vehicle_status`, `tires` se a data for hoje) → `fleet_scope_bump` → log em `fleet_scope_sync_log`.
- Ponto de atenção verificado no SQL: a propagação usa `lideranca = COALESCE(s.lideranca, t.lideranca)`; ao **remover** uma atribuição a view devolve `NULL` e o nome antigo **permanece** nos caches.

### Permissões / escopo
Somente perfis globais editam. A liderança **lê** o planner (client direto, sem escopo) para montar rótulos nos planners de fidelização.

### Integrações (quem lê `planner_liderancas`)
`vw_lideranca_competencia`/`fn_resolve_lideranca*` (banco); `getEscopoCompetencia` (escopo); `fidelizacao-module`, `planner-frotas-module` (rótulo/grupo "Liderança" e gráfico por liderança); `fleet-scope.server.ts` (`fn_fleet_scope_competencia`, cache 60 s); Aderência, GPAC, KM, Pneus, MTSR, Manutenção, Avarias via caches sincronizados.

### Regras históricas
Líder de um mês passado = linha do planner **daquela competência**. Não existe vigência por dia; a competência inteira tem um único líder por par. Resolução: por ids `(tipo_operacao_id, cidade_ibge_code)` quando o vínculo é oficial; senão textual `fleet_norm_txt(operação)` + `fleet_norm_local(cidade)` (minúsculas, sem acento, remove prefixo `redespacho `, remove sufixo `/UF` ou `-UF`). No cliente: `normKey` (lower + NFD) e `resolveLideranca` tenta `local` e `local sem "Redespacho "`.

### Situações excepcionais
- Cidade removida da operação: a linha do planner permanece (sem FK), não aparece na matriz, mas conta em "Atribuídos" e continua resolvendo por ibge/texto.
- Operação excluída: cascata apaga o planner (auditoria fica com `planner_id=null`).
- Usuário-líder não pode ser excluído enquanto referenciado (RESTRICT).
- Líder inativado: continua na linha; o select mostra o nome via `userMap` mas ele não consta nas opções.

### Problemas verificados
- Ator sempre `"Sistema"`; `actor_user_id`/`created_by` nunca gravados. Confirmado.
- Fluxos não transacionais (dado + auditoria). Confirmado.
- Replicação com `skipped` inflado e default de origem incorreto em janeiro. Confirmado.
- Cache de liderança não é limpo ao remover atribuição (COALESCE). Confirmado no SQL de `fleet_sync_datas`.
- Snapshot textual de cidade sem FK. Confirmado.

---

## 3. Central de Fidelização (Dashboard de Estabilidade)

### Objetivo
Visão gerencial mensal da estabilidade **BR × placa**: quantos BRs têm placa, quantos trocaram, taxa de estabilidade e distribuição das mobilizações por operação/liderança/local.

### Navegação / telas
`/app/fidelizacao/` (admin; `fidelizacao-module.tsx`) e `/app/lideranca/fidelizacao` (mesmo componente, com links para `/app/lideranca/planner-*`).

### Componentes visuais
- Cabeçalho "Módulo 07 · Central de Fidelização"; botão **Importar Base** (cap `fidelizacao.import`).
- Dois cards-link: **Planner de Frotas** ("Grid Mensal de Placas") e **Planner de Motoristas**.
- Barra "Competência": `<` `>` + selects mês/ano.
- Se liderança com escopo vazio: `EscopoVazioAviso`; senão `EstabilidadeDashboard`:
  - 5 KPIs: **BRs Fidelizadas**, **BRs sem Placa** (vermelho se >0), **Trocas de Placa**, **Mobilizações**, **Taxa de Estabilidade** (verde ≥90 %, dourado ≥70 %, vermelho abaixo).
  - Gráficos de barras horizontais: **Mobilizações por Operação**, **Mobilizações por Liderança** (barra ≥80 % do máximo em vermelho, ≥50 % dourado); **Ranking · Locais de Operação com maior rotatividade** (top 10).

### Dados de entrada
- `brs` = `sd.fid.brs(ano, mes)` → global: `listFidelizationBRs()` = **todas** as `fidelization_brs` (a competência é ignorada; `status` não filtrado); escopado: `fidBrsScoped` (§0).
- `daily` = `fidelization_daily` do mês (paginado de 1000 em 1000, `order by data`).
- `mobilizacoes` = `fidelization_mobilizacoes` com `data` no mês.
- `brsCombined` = mapa por `codigo` das `fidelization_brs` **+** códigos presentes em `daily` e ausentes do cadastro (`id = br_id ?? codigo_br`, tipo/local do primeiro registro diário).
- `placaByBrDay: Map<codigo_br, Map<dia, placa>>` — primeira placa encontrada por (BR, dia) na ordem da consulta; múltiplas placas no mesmo dia são ignoradas ("caso anômalo, pega a 1ª").
- `liderancaByTipoLocal: Map<"normKey(op.name)|normKey(cidade_nome)", full_name>` do planner da competência.

### Indicadores — fórmulas exatas (`estabilidade-dashboard.tsx`)
```
brsComPlaca  = brs com placaByBrDay[codigo].size > 0
brsSemPlaca  = brs.length − brsComPlaca

derived = para cada BR: percorre dias crescentes com placa não vazia;
          se placa ≠ última placa vista → troca {codigo_br, tipo, local, placa_anterior=última, placa_nova=atual}
          (dias sem placa são pulados: A, —, B conta troca; A, —, A não conta)

explicit = mobilizações do mês com placa_anterior E placa_nova não nulas
           (remoções/novas fidelizações com um lado nulo NÃO entram nos KPIs)

seen = Set("{codigo_br}|{placa_anterior}|{placa_nova}")
all  = [ ...todas as explicit (cada linha é adicionada; a chave entra em seen) ,
         ...derived cuja chave ∉ seen ]

trocas   = all.length            (KPI "Trocas de Placa")
totalMob = all.length            (KPI "Mobilizações" — mesmo número)
brsComTroca = distinct codigo_br em all
taxa = brsComPlaca > 0 ? (brsComPlaca − |brsComTroca|) / brsComPlaca × 100 : 0
```
Agrupamentos: por `tipo_operacao` da linha (explicit usa o texto gravado na mobilização; derived usa o BR); por liderança `m.lideranca ?? resolveLideranca(map, tipo, local) ?? "— Sem liderança —"`; ranking por `local_operacao`.

**Dupla contagem — verificado:** a deduplicação só ocorre entre `derived` e `explicit` (mesma chave). Linhas `explicit` **não são deduplicadas entre si**. Como a edição de um período de N dias no Planner de Frotas gera **N** linhas em `fidelization_mobilizacoes` com a mesma chave (§4), uma única troca real conta N vezes em "Trocas"/"Mobilizações" e nos gráficos. `|brsComTroca|` (e portanto a taxa) não é afetado por essa inflação. Já uma mobilização explícita com `placa_anterior` nula (nova fidelização) é ignorada, mas a troca derivada correspondente pode ser contada.

### Filtros
Só competência. No Planner de Frotas o mesmo dashboard recebe `brsFiltered` (filtros de tipo/liderança/local) mas `mobilizacoes` **não filtradas** → `brsComTroca` pode conter BRs fora do filtro e a taxa pode ficar **negativa**.

### Permissões / escopo
Leitura. Liderança: BRs/diário/mobilizações passam por `fidBrsScoped`, `fidDailyMonthScoped` (`hasBr || hasLocal || hasPlaca`) e `fidMobilizacoesMonthScoped` (`hasBr || hasPlaca`; a linha de mobilização não tem `placa`, logo efetivamente por BR).

### Problemas verificados
- Universo de BRs não é mensal (todas as `fidelization_brs`, sem `status`) → "BRs sem Placa" inclui BRs antigos. Confirmado.
- KPIs "Trocas" e "Mobilizações" são idênticos. Confirmado.
- Inflação por mobilizações diárias repetidas. Confirmado (ver §4).

---

## 4. Planner de Frotas (Grid Mensal de Placas)

### Objetivo
Registrar/visualizar, por BR e por dia do mês, qual placa está fidelizada; permitir trocas por período com registro de mobilização e inversão automática entre BRs; importar a base diária por planilha.

### Navegação / telas
`/app/fidelizacao/planner-frotas` (admin/gestor/rh editam) e `/app/lideranca/planner-frotas` (somente leitura: `fidelizacao.frotas.edit` ausente). `/app/fidelizacao/importar` (cap `fidelizacao.import`).

### Componentes visuais (`planner-frotas-module.tsx`)
- Link "Voltar para a Central de Fidelização"; título "Grid Mensal de Placas"; botão **Importar Base** ou chip "Somente leitura".
- Barra: navegação de mês; `MultiSelectFilter` **Tipo de Operação**, **Liderança**, **Local de Operação**; "Limpar filtros"; contador "N BR(s) · M tipo(s) de operação".
- **Legenda** "Período 1..4" (cores cíclicas indicam trocas de placa por BR).
- `EstabilidadeDashboard` (com `brsFiltered`).
- **Histórico de mobilizações do mês** (colapsável): Data, Hora (`created_at`), BR, Placa anterior, Nova placa, Motivo, Usuário (`actor`).
- Agrupamento **Tipo de Operação → Liderança → Local de Operação → `FidelizacaoGrid`** (uma tabela por local).
- **`FidelizacaoGrid`**: cabeçalho fixo com dias (`dd` + `Dom..Sáb`, fim de semana sombreado); 1ª coluna fixa BR + local; célula = botão com placa ou "—"; cor por `periodIdx` (incrementa quando a placa muda em relação ao último dia **com** placa; 6 cores cíclicas); tooltip "Período N · placa" / "Sem placa". Clique só quando `podeEditar`.
- **`MobilizacaoDialog`** "Editar fidelização do dia" (descrição: `BR X · data · Placa atual: Y`):
  - **Início do período** / **Fim do período** (date; min = dia 1, max = último dia do mês exibido; fim ≥ início).
  - **Buscar placa ou frota** (filtra `vehicles` por placa normalizada contida ou `frota`; 50 primeiros).
  - **Selecionar placa**: `— Sem placa (remover) —` + veículos (`ABC-1234 · frota · modelo`).
  - Se a placa escolhida já está em outro(s) BR(s) no período (`buscarOcupacao`): caixa **Inversão automática de placas** ("X está fidelizada em BR A, BR B no período. Ao confirmar, Y assume a BR de origem — as placas são invertidas." ou "…a BR de origem fica sem placa no período.") + checkbox **Inverter as placas entre as BRs** (default marcado).
  - Se houve troca: caixa com rótulo `Removendo placa fidelizada` | `Troca de placa detectada` | `Nova fidelização` + `Textarea` **Motivo** (opcional).
  - Botões Cancelar / Salvar (desabilitado se período inválido).

### Campos
`fidelization_daily`: `id`, `data`, `br_id` (FK `fidelization_brs` SET NULL), `br_oficial_id` (FK `operation_brs` SET NULL), `codigo_br`, `tipo_operacao`, `local_operacao`, `gestor`, `lideranca` (cache), `placa`, `placa_norm` (cache), `vehicle_id` (FK `vehicles` SET NULL), `frota`, `modelo`, `motorista_1`, `motorista_2` (nunca escritos pela UI), `status_operacional` (default `ativa`), `origem` (`import_excel|manual`), `observacoes`, `tipo_operacao_id`, `cidade_ibge_code` (caches), timestamps. **Unique `(data, codigo_br, placa)`** → várias placas por BR/dia são permitidas pelo esquema.
`fidelization_mobilizacoes`: `id`, `data`, `br_id`, `codigo_br`, `tipo_operacao`, `local_operacao`, `lideranca`, `placa_anterior`, `placa_nova`, `motivo`, `actor`, timestamps (sem FKs; índices por `codigo_br` e `data`).
`fidelization_brs`: `id`, `codigo`, `tipo_operacao`, `local_operacao`, `gestor`, `lideranca`, `status` (default `ativo`, nunca filtrado), `mes_referencia`/`ano_referencia` (int default 0), `observacoes`. **Unique `(codigo, mes_referencia, ano_referencia)`** — como ambos são sempre 0, na prática 1 registro por código.
`fidelization_audit`: `entity`, `entity_id`, `action`, `severity`, `details` jsonb, `actor` (default lógico `"Sistema"`).

### Filtros
Tipo de Operação, Liderança (resolvida via planner), Local de Operação — sobre `brsCombined`. A busca textual interna do grid ("Filtrar BR ou local") só aparece quando `hideMonthNav=false` (não é o caso aqui).

### Regras de edição — clique na célula → confirmação (`handleConfirm`)
```
datas = dias de [dataIni..dataFim] recortados ao mês exibido (máx. 62)
para cada data (sequencial, await):
  placaAtualDoDia = placaByBrDay[brAlvo][dia] ?? null          // snapshot da query antes do loop
  origemCodigo    = brPorPlacaEData[data][placaNova]           // BR que hoje tem a placa nova nesse dia
  se inverter && origemCodigo && origemCodigo ≠ brAlvo:
      fid_set_daily_cell(data, brOrigem, placaAnterior=placaNova, placaNova=placaAtualDoDia (pode ser null),
                         motivo, lideranca=resolveLideranca(origem), actor="Sistema")
  fid_set_daily_cell(data, brAlvo, placaAnterior=placaAtualDoDia, placaNova, motivo,
                     lideranca=dialog.lideranca, actor="Sistema")
invalida ["fidelization_daily_month", ano, mes] e ["fidelization_mobilizacoes", ano, mes]   // não chama invalidateFleetScope
toast "Placa atualizada|removida em N dias"
```
Erro em qualquer dia interrompe o loop e mantém os dias já gravados.

**RPC `fid_set_daily_cell(p_data, p_codigo_br, p_br_id, p_tipo_operacao, p_local_operacao, p_placa_nova, p_placa_anterior, p_motivo, p_actor='Sistema', p_lideranca)`** (SECURITY DEFINER, só `service_role`; versão vigente = migração `20260917145426`):
1. Normaliza placas; exige data e código.
2. `set_config('app.fid_skip_sync','on', true)` (desliga os gatilhos de propagação na transação).
3. `DELETE FROM fidelization_daily WHERE data = p_data AND codigo_br = v_codigo` (por **texto do código**, todas as placas daquele BR/dia).
4. Se há placa nova: busca `vehicles` por `fleet_norm_placa(placa)` (LIMIT 1) e insere linha com `br_id = p_br_id`, `codigo_br`, `tipo_operacao`/`local_operacao` do BR informado, `placa` normalizada, `vehicle_id/frota/modelo` do veículo (nulos se não cadastrado), `status_operacional='ativa'`, `origem='manual'`. **`br_oficial_id` não é gravado** (fica NULL).
5. Se `placa_anterior ≠ placa_nova` (normalizadas): insere `fidelization_mobilizacoes` (`lideranca = p_lideranca`, `actor = coalesce(p_actor,'Sistema')`).
6. Se alguma placa envolvida: `fleet_sync_placas_datas([data], [anterior, nova], 'central_fidelizacao')` (§6) e `fleet_scope_bump(ano, mes)`.
7. Retorna `{removidas, placa, sincronizacao}`.

### Regras de planejamento
Não há competência/vigência além do dia; não existe replicação de frotas. Período = intervalo de dias dentro do mês exibido.

### Consultas / serviços
`listFidelizationDailyMonth`, `listMobilizacoesMonth`, `listFidelizationBRs`, `upsertFidelizationDailyCell` (chama a RPC), `registerMobilizacao` (insert direto; não usado pela UI inspecionada), `audit`. Chaves textuais em todas: `codigo_br`, `placa`, `tipo_operacao`, `local_operacao`.

### 4.7 Importação (`/app/fidelizacao/importar`, `fidelization-import.ts`, `commitFidelizationImport`)
Passos: Upload (.xlsx/.xls, 1ª aba) → Mapeamento (auto-map por aliases: `data`, `codigo_br`*, `tipo_operacao`, `local_operacao`, `gestor`, `placa`*, `status`, `frota`, `modelo`; layouts salvos em `fidelization_import_layouts`) → Pré-validação → Auditoria (abas Todas/Erros/Alertas/Válidas; erros: data inválida, BR vazio, placa vazia; alerta: placa fora do padrão, duplicidade `data|br|placa` "última prevalece") → Gravação.
`commitFidelizationImport(rows)`:
1. Carrega `operation_brs` com nomes de operação e cidade; indexa por `norm(op)|norm(cidade)|norm(codigo)` e, como fallback, por `norm(codigo)` (primeiro encontrado). Linha sem correspondência → **toda a carga é rejeitada** (`fidelization_audit` `import_rejected_invalid_brs`).
2. Cria em lote as `fidelization_brs` ausentes (chave `codigo.toLowerCase()`, `tipo/local` da 1ª linha, `status='ativo'`); fallback linha a linha.
3. `vehicles` por `placa` exata (chunks de 500) → `vehicle_id`.
4. `upsert` em lotes de 500 `onConflict (data,codigo_br,placa)` com `br_id`, `br_oficial_id`, `origem='import_excel'`; fallback linha a linha; `fidelization_audit` `import_excel`.
Observação: o upsert **não remove** linhas do mesmo BR/dia com outra placa → reimportações acumulam múltiplas placas por dia (o grid mostra a primeira).

### Funções / triggers de `fidelization_daily`
`trg_fid_daily_propagar_ins/upd` (statement, tabela de transição `_fid_changed`) e `trg_fid_daily_propagar_upd_row/del` (linha; `upd_row` só se placa/data/BR/tipo/local mudaram) → `fleet_sync_placas_datas(datas, placas, 'central_fidelizacao')` + `fleet_scope_bump`; todos ignoram se `pg_trigger_depth() > 1` ou `app.fid_skip_sync = 'on'`. `trg_fid_daily_updated` mantém `updated_at`.

### Permissões / escopo
Edição: `administrador`, `gestor_frota`, `rh`. Liderança: leitura filtrada (§0/§3). A importação não valida escopo.

### Integrações (quem lê `fidelization_daily`)
`vw_frota_escopo_competencia` (todos os módulos via `fn_resolve_fleet_scope`/`fn_fleet_scope_competencia`); Aderência (`aderencia_build_referencia` cria `frota_status_diario` por dia a partir da view); GPAC (`gpac_sync_app_execution`); KM (`km_resync_fidelization` casa `placa_norm+data`, guarda `vinculos_fidelizacao` = nº de linhas do mesmo dia); Pneus/MTSR/Manutenção/Avarias (caches); `allowedFleetFor` (escopo de placas da liderança = placas de `fidelization_daily` do mês cujo par operação+local ∈ `pares`); `fetchFidelizacaoLideranca` (por `br_oficial_id` — **não vê linhas manuais**).

### Regras históricas
- Placa do BR num dia passado = linha `(data, codigo_br)`; mês passado é editável igual ao atual (não há trava).
- Placa → contexto numa data (outros módulos): `fn_resolve_fleet_scope(data, placa)` = linha da placa **no mesmo mês**, priorizando data exata, depois a última anterior, depois a primeira posterior; desempate `status_operacional='ativa'` e `updated_at` desc. Nunca cruza competência.
- Liderança do dia = planner da competência (§2), gravada como cache em `lideranca`.

### Situações excepcionais
- BR sem placa no dia: célula "—"; conta em "BRs sem Placa" se sem placa no mês inteiro.
- Placa em dois BRs no mesmo dia: permitido pelo esquema; a UI oferece a inversão (opcional). Sem inversão, a placa fica nos dois BRs.
- BR presente só no diário (sem `fidelization_brs`): `brsCombined` cria `id = codigo_br`; ao editar, `p_br_id` recebe o **texto do código** em parâmetro `uuid` → erro do Postgres (toast). Verificado por leitura de código.
- Turnos: inexistentes.

### Problemas verificados
- Chaves textuais (`codigo_br`, `placa`, nomes de operação/local). Confirmado.
- Linhas sem referência de BR: `br_id` e `br_oficial_id` anuláveis; edição manual **sempre** grava `br_oficial_id = NULL`. Confirmado no SQL da RPC.
- Mobilização gravada por dia (N linhas por período). Confirmado.
- Ator fixo `"Sistema"` na edição manual (o nome do usuário logado não é enviado). Confirmado.
- Fluxo por período não transacional (2 RPCs × N dias). Confirmado.
- Inversão só considera a **primeira** BR que tem a placa no dia (`brPorPlacaEData` guarda uma). Confirmado.
- Tabelas `planner_frotas_diario`/`planner_motoristas_diario` e `planner-api.ts`/`month-grid.tsx` não têm consumidores nas rotas inspecionadas (legado). FK `br_id → fidelization_brs` **CASCADE**.

---

## 5. Planner de Motoristas

### Objetivo
Fidelizar motoristas a um BR/placa por mês de referência, com período (início/fim), status, substituição (encadeada) e encerramento; a liderança edita dentro do seu escopo.

### Navegação / telas
`/app/fidelizacao/planner-motoristas` e `/app/lideranca/planner-motoristas` (`planner-motoristas-module.tsx`).

### Componentes visuais
- Cabeçalho "Grid Mensal de Motoristas"; botões **Importar Base** (cap import), **Replicar mês anterior**, **Cadastrar Motoristas** (cap `fidelizacao.motoristas.edit`).
- Barra "Mês de referência" (`<` `>` + selects).
- Tabela de grupos por BR: chevron | **BR / Local** | **Motoristas ativos** (badge = linhas `status='ativo'`) | **Total registros** | Ações (**+ Motorista**). Estado vazio: `scopeStatus.mensagem` ou "Nenhum BR/Local encontrado para o mês.".
- Linha expandida: Frota (placa), Motorista, Matrícula, Mês ref. (`YYYY-MM`), Período (`inicio → fim|—`), Status (badge: ativo verde, pendente âmbar, substituido cinza, encerrado vermelho), Ações: **Editar**, **Substituir**, **Encerrar** (sem confirmação), **Remover** (`confirm`).
- **Dialog** ("Cadastrar Motoristas Fidelizados" | "Editar fidelização" | "Substituir {nome}"; subtítulo "Mês de referência: mês/ano. Preencha uma ou mais linhas…"). Cada `DraftRow`:
  - **BR / Local** (select `codigo · local` de `sd.fid.brs`).
  - **Motorista (nome ou matrícula)** — typeahead (6 sugestões) sobre `listDriversFromUsers()` = `app_users` `status='ativo' AND deleted_at IS NULL` e (`profile='operacional'` OU `position ~* 'motorist'`).
  - **Frota (placa) · automática** (somente leitura): placa do BR no dia de início em `placaByBrDay`; senão dia mais próximo com placa; senão placa mais frequente no mês; senão vazio + aviso "Sem frota vinculada ao local no mês — o registro ficará como pendente." `frota_id` = `vehicles.id` da placa.
  - Switch **Fidelizar durante todo o mês** (default ligado; força início/fim = limites do mês e desabilita os calendários).
  - **Data início** / **Data fim** (calendários limitados ao mês).
  - **Observações**.
  - Botão **Adicionar linha** (desabilitado em edição/substituição); **Salvar (n)**.

### Campos
`fidelization_motoristas`: `id`, `codigo_br`, `br_id` (uuid **sem FK**), `placa` (texto, pode ser `''`), `frota_id`, `driver_user_id` (sem FK declarada), `motorista_nome`, `matricula`, `mes_referencia` (date, dia 1), `data_inicio`, `data_fim`, `status` (check `ativo|pendente|substituido|encerrado`), `substituido_por_id` (FK self SET NULL), `observacoes`, `created_by`/`updated_by` (nunca preenchidos), timestamps. **Sem unique**. Índices: `(codigo_br, mes_referencia)`, `(driver_user_id, data_inicio, data_fim)`, `(placa, data_inicio, data_fim)`, `(status)`.

### Filtros
Só mês (linhas com `mes_referencia` entre dia 1 e último dia).

### Regras de edição (`saveM`, por rascunho, sequencial)
1. Validações: BR, motorista, `data_inicio` obrigatórios; início e fim dentro do mês; fim ≥ início.
2. Payload: `codigo_br, br_id, placa (''|placa), frota_id, driver_user_id, motorista_nome, matricula, mes_referencia = dia 1, data_inicio, data_fim (null se vazio), status = placa ? 'ativo' : 'pendente', observacoes, id (edição)`.
3. `saveFidMotorista` (server) → `assertWithinScope({ano, mes, codigo_br, br_id, placa})`: global passa; escopo vazio → erro; autoriza se `hasBr(codigo_br)` ou se alguma `fidelization_brs` com esse código tem `local` no escopo (e operação, se houver); `br_id` deve bater com um dos registros. **Não grava nada.**
4. Se `placa` ≠ `''`: `checkConflicts` (cliente, sem filtro de mês nem escopo): (a) mesmo motorista (`driver_user_id` ou `matricula`) em outra placa com período sobreposto e status ∉ {encerrado, substituido} → "Motorista já está fidelizado à placa X entre…"; (b) mesma placa com outro motorista sobreposto → "Placa X já possui o motorista Y no período." (`data_fim` nulo = `9999-12-31`).
5. Substituição (`substituirFidelizacao(oldId, novo)`): `insert` do novo → `update` do antigo `{status:'substituido', substituido_por_id: novo.id, data_fim: novo.data_inicio}`. Edição/criação: `update`/`insert` direto.
6. Sucesso: toast "n vínculo(s) salvo(s)"; invalida `["fidelization_motoristas"]`. Falha no meio: rascunhos anteriores permanecem gravados.
- **Encerrar**: `update {status:'encerrado', data_fim: hoje}` (mesmo fora do mês; sem escopo).
- **Remover**: `delete` (sem escopo).

### Regras de planejamento — replicação (`replicarMesAnterior(ano, mes)`)
```
prev = linhas com mes_referencia no mês anterior (client, sem escopo)
toInsert = prev.filter(status === 'ativo').map(copiar codigo_br, br_id, placa, frota_id, driver_user_id,
            motorista_nome, matricula; mes_referencia = dia 1 do alvo; data_inicio = dia 1; data_fim = último dia;
            status 'ativo'; observacoes 'Replicado do mês anterior')
insert em lote; retorna toInsert.length
```
Não deduplica (rodar duas vezes duplica), não re-deriva a placa do grid, não checa conflitos nem escopo. Não sobrescreve.

### Funções / triggers
Só `trg_fidelization_motoristas_updated_at`. Nenhum gatilho de propagação.

### Permissões / escopo
Liderança pode criar/editar (validação consultiva em `saveFidMotorista`); **replicar, encerrar e remover chamam a API cliente sem validação de escopo**. Leitura escopada: `fidMotoristasMonthScoped` (`hasBr(codigo_br) || hasPlaca(placa)`).

### Integrações
Nenhum outro módulo inspecionado lê `fidelization_motoristas`. O módulo lê `fidelization_daily` (placa automática) e `fidelization_brs`.

### Regras históricas
A placa é snapshot textual no registro do mês; não há reprocessamento se o grid mudar depois. Não há liderança gravada.

### Situações excepcionais
- Motorista em dois veículos: bloqueado por `checkConflicts` quando há placa; registros **pendentes** (sem placa) não passam pela checagem (um motorista pode ficar pendente em vários BRs).
- Dois motoristas na mesma placa: bloqueado (não há suporte a dupla/turno; `motorista_2` nunca é usado).
- Turnos: inexistentes na tabela usada (`turno` só existe nas tabelas legadas `planner_*_diario`).

### Problemas verificados
- `br_id`/`driver_user_id` sem FK; `codigo_br`/`placa`/`matricula` textuais. Confirmado.
- Replicação sem dedup e sem escopo; encerrar/remover sem escopo. Confirmado.
- Substituição não transacional; substituto e substituído se sobrepõem no dia da troca. Confirmado.
- Mapeamento de erro "row-level security" no toast é código morto (não há policies). Confirmado.

---

## 6. Camada canônica de escopo (banco) — referência para o HFM

Funções de normalização: `fleet_norm_placa(p)` (upper, `[^A-Za-z0-9]` removido); `fleet_norm_txt(p)` (lower, sem acento, espaços colapsados); `fleet_norm_local(p)` = `fleet_norm_txt` sem prefixo `redespacho ` e sem sufixo `/uf` ou `-uf`.

`vw_lideranca_competencia` (`planner_liderancas p JOIN operations o JOIN app_users u`): `ano, mes, tipo_operacao_id, operacao_nome, cidade_ibge_code, cidade_nome, cidade_uf, lideranca_user_id, lideranca_nome, op_key = fleet_norm_txt(o.name), cidade_key = fleet_norm_local(p.cidade_nome)`.

`vw_operacao_local_keys`: `(op_key, cidade_key) → op_id, ibge_code, cidade_nome` (DISTINCT ON, 1ª operação por nome).

`vw_frota_escopo_competencia` (versão `20260901155041`, `security_invoker`): para cada `fidelization_daily` com placa:
- `tipo_operacao_id = COALESCE(operation_brs.operation_id [via br_oficial_id], keys.op_id [via texto])`; idem `cidade_ibge_code`, `tipo_operacao_nome`, `local_operacao`, `codigo_br = COALESCE(operation_brs.codigo, f.codigo_br)`.
- `lideranca_* = COALESCE(join por ids (ano, mes, tipo_operacao_id, cidade_ibge_code), join textual (op_key, cidade_key))`.
- `fonte_vinculo = 'br_oficial' | 'textual' | 'nao_resolvido'`.
- Expõe `status_operacional`, `updated_at`, `placa_norm`, `frota` (placa original), `vehicle_id`.

Resolvedores: `fn_resolve_fleet_scope(data, placa)` (regra do §4 "Regras históricas"); `fn_fleet_scope_competencia(ano, mes)` (1 linha por placa: ativa primeiro, data mais recente); `fn_resolve_lideranca(ano|data, tipo_txt, local_txt)`; `fn_resolve_lideranca_full(data, op_id, ibge, tipo_txt, local_txt)` (ids antes de texto).

Propagação: `fleet_sync_placas_datas(datas[], placas[], origem)` (versão `20260917145426`; temp table `_fscope_target` com `DELETE … WHERE true` em vez de `TRUNCATE`) regrava em `frota_status_diario`, `fidelization_daily` (só ids + `lideranca`), `km_daily_readings`, `tire_daily_snapshots`, `gpac_checklist_records`, `maintenance_records`, `avaria_maintenance_records`, e (data = hoje) `mtsr_vehicle_status`, `tires`; sempre com `COALESCE(novo, atual)`; loga em `fleet_scope_sync_log`. `fleet_sync_datas(datas[])` (usado pelo planner) faz o mesmo para todas as placas das datas. `fleet_sync_competencia(ano, mes, op_id, ibge, origem)` coleta datas na view e delega. `fleet_scope_bump` incrementa `fleet_scope_versions(competencia_ano, competencia_mes)`.

`km_resync_fidelization(ini, fim, placa)`: para `km_daily_readings`, escolhe **uma** linha de `fidelization_daily` por (`placa_norm`, `data`) (mais recente por `updated_at`) e grava `vinculos_fidelizacao = count(*)` (diagnóstico de placa em vários BRs).

---

## 7. Consolidação dos problemas existentes (com evidência)

| # | Problema | Existe? | Evidência |
|---|---|---|---|
| 1 | Chaves textuais em vez de ids | Sim | `fidelization_daily.codigo_br/placa/tipo_operacao/local_operacao`; `fidelization_mobilizacoes` sem FKs; `fidelization_motoristas.codigo_br/placa/matricula`; resolução de liderança por nomes (`resolveLideranca`, `fleet_norm_*`); import por nomes normalizados |
| 2 | Cascade deletes | Sim | `operation_cities→operation_brs→operation_br_placas/substituicoes` (CASCADE); `operations→planner_liderancas` (CASCADE); `fidelization_brs→planner_*_diario` (CASCADE); `updateOperation` apaga cidades sem aviso |
| 3 | Fluxos multi-chamada não transacionais | Sim | `upsertPlannerEntry`, `deletePlannerEntry`, `replicarPlanner`, `substituirPlaca` (3 passos, 1º sem check), `substituirFidelizacao`, `handleConfirm` (2×N RPCs), `saveM` multi-linha, `commitFidelizationImport` |
| 4 | Entidade BR duplicada | Sim | `operation_brs` (unique `city_id+codigo`) × `fidelization_brs` (unique `codigo+0+0`) × BRs sintéticos de `brsCombined`; `fidelization_daily` tem `br_id` e `br_oficial_id` |
| 5 | "Sistema" como ator | Sim | `planner_liderancas_audit.actor_label='Sistema'` sempre; `fid_set_daily_cell(... p_actor='Sistema')` chamado com `"Sistema"`; `fidelization_audit`/`operation_audit` default; única exceção `operation_br_substituicoes.usuario` |
| 6 | Linhas diárias sem referência de BR | Sim (estrutural) | `br_id`/`br_oficial_id` anuláveis (SET NULL); RPC manual nunca grava `br_oficial_id`; import deixa `br_id` null se o insert do BR falhar. Contagem real não pôde ser medida (ver §9) |
| 7 | Dupla contagem de mobilizações | Sim | N linhas por período + ausência de dedup entre linhas explícitas (§3) |
| 8 | Cache de liderança não limpo ao remover do planner | Sim | `COALESCE(s.lideranca, t.lideranca)` em `fleet_sync_datas/placas_datas` |
| 9 | Escrita da liderança sem escopo (replicar/encerrar/remover motoristas) | Sim | `planner-motoristas-module.tsx` chama APIs cliente direto |
| 10 | `p_br_id` recebe texto quando BR só existe no diário | Sim (latente) | `brsCombined.id = r.br_id ?? r.codigo_br` → RPC `uuid` |
| 11 | Perfil `analista_frota` sem capacidades | Sim | `capabilitiesForProfile` só trata `rh` como analista |
| 12 | Universo de BRs do dashboard não é mensal | Sim | `listFidelizationBRs()` sem filtro |

---

## 8. Oportunidades de melhoria (para o HFM)

1. Uma única entidade BR (`operation_brs`) referenciada por id em diário, mobilizações e motoristas; `codigo` só para exibição.
2. Gravar `br_oficial_id`, `vehicle_id`, `tipo_operacao_id`, `cidade_ibge_code` na origem (RPC/import), eliminando o join textual.
3. Uma mobilização por **período** (`data_inicio`, `data_fim`, `placa_anterior`, `placa_nova`) e KPI de trocas por BR distinta/período; separar "remoção" e "nova fidelização" de "troca".
4. Ator real (`actor_user_id` + label) vindo da sessão em todas as auditorias/RPCs.
5. Operações compostas em uma RPC transacional: substituição de placa cadastral, troca por período com inversão, substituição de motorista, replicações.
6. Replicações idempotentes (upsert por chave natural) e com validação de escopo/ativos; `skipped` = colisões reais; origem padrão = mês anterior real.
7. Ao remover atribuição do planner, limpar caches (`lideranca = NULL` quando não resolvido) ou parar de cachear.
8. Autorização de escrita no servidor para todas as mutações da liderança (ou policies RLS por sessão).
9. Restrições: unique parcial em `fidelization_motoristas` (motorista ativo × período), FK `br_id`, FK `driver_user_id`; decidir se `fidelization_daily` admite >1 placa/dia (se não, unique `(data, br_id)`).
10. Filtrar universo de BRs por competência/status no dashboard; aplicar os mesmos filtros às mobilizações; evitar taxa negativa.
11. Remover legado: `planner_frotas_diario`, `planner_motoristas_diario`, `planner-api.ts`, `month-grid.tsx`, `hierarquia-tree.tsx` (se não usados).
12. Consumir `fleet_scope_versions` (ou Realtime) em vez de invalidar por prefixo.

---

## 9. Limitações da inspeção

- **Banco de dados:** após a primeira rodada (colunas, constraints, índices, triggers, flags de RLS, assinaturas e corpos de `fid_set_daily_cell`, `trg_*`, `fleet_scope_bump`, `fn_fleet_scope_competencia`, `fn_resolve_fleet_scope`, `fn_resolve_lideranca*`, `km_resync_fidelization`, `fleet_norm_placa`), o `query_database` passou a expirar (60 s) em **todas** as chamadas, inclusive `SELECT 1`. Portanto **não** foram obtidos: contagens de linhas, amostras (LIMIT 5), verificações de qualidade (placa em dois BRs, BR/dia com várias placas, `br_id`/`br_oficial_id` nulos, distribuição de `actor`/`origem`/`status`), definição ao vivo das views e de `fleet_sync_*`/`fleet_norm_txt/local`. Esses últimos foram recuperados das migrações (`20260901151854`, `20260901154304`, `20260901155041`, `20260911180953`, `20260914105448`, `20260915112650`, `20260917145426`) e coincidem com os corpos lidos ao vivo onde houve sobreposição.
- `pg_policies` retornou vazio para as tabelas de governança; consistente com a migração `20260831121857`, mas não foi possível reconfirmar após a queda.
- Não foram lidos: `src/integrations/supabase/types.ts`, `users-api.ts`, `access.functions.ts`, `operacional.server.ts` (sessão), componentes de `src/components/lideranca/*`, nem verificado por busca global se `hierarquia-tree.tsx`, `month-grid.tsx` e `planner-api.ts` são referenciados em algum lugar fora das rotas/módulos inspecionados.
- Comportamento de UI descrito a partir do código; não houve execução da aplicação.

---

## 10. Resumo executivo — contratos funcionais que o HFM deve reproduzir

1. **BR oficial** = `codigo` único por cidade dentro de um Tipo de Operação; placa tem no máximo **um vínculo cadastral ativo** no sistema; substituição = encerra vínculo atual (data_fim=hoje) + cria novo + histórico com justificativa e usuário; remoção = encerrar, nunca apagar.
2. **Planner de Lideranças**: matriz Operação ativa × Cidade × competência; selecionar líder = upsert por `(ano, mes, operação, cidade)` com auditoria (`created`/`lideranca_changed`/`deleted`); lixeira remove a atribuição.
3. **Replicar planejamento**: copia da competência de origem apenas os pares **ainda não atribuídos** no destino; nunca sobrescreve; auditoria `replicated` com `from`.
4. **Líder de um mês** = atribuição daquela competência para (operação, cidade); resolução por ids e, em fallback, por nomes normalizados (sem acento/caixa, sem "Redespacho", sem UF).
5. **Escopo da liderança** = pares (operação, cidade) do planner da competência → BRs ativos dessas cidades, placas com vínculo cadastral ativo, locais; sem atribuição → telas mostram "Nenhum Local de Operação está atribuído…".
6. **Grid mensal**: uma placa por BR por dia (a 1ª se houver várias); cores mudam a cada troca de placa; clique na célula abre o diálogo com **período (início/fim no mês)**, **placa (ou remover)**, **motivo**, e **inversão automática** quando a placa já está em outro BR.
7. **Confirmar troca** → para cada dia do período: (opcional) BR de origem recebe a placa antiga; BR alvo: apaga linhas do dia, insere a nova placa (`origem='manual'`), registra mobilização `(data, br, placa_anterior, placa_nova, motivo, ator)` só se a placa mudou; sincroniza caches dos demais módulos.
8. **Importação** (upsert por `data+BR+placa`): valida cada linha contra o cadastro oficial de BRs (operação+cidade+código, fallback código); rejeita a carga inteira em caso de BR desconhecido; cria BRs de fidelização ausentes.
9. **Taxa de Estabilidade** = `(BRs com placa no mês − BRs com ≥1 troca) / BRs com placa × 100`; trocas = união (mobilizações explícitas com ambas as placas) ∪ (trocas derivadas do grid entre dias consecutivos com placa), deduplicadas por `BR|anterior|nova` apenas contra as explícitas.
10. **Planner de Motoristas**: registro por mês de referência com BR, motorista (usuário operacional), placa **derivada do grid** (dia de início → mais próximo → mais frequente), período dentro do mês, status `ativo` (com placa) ou `pendente` (sem placa).
11. **Conflitos**: bloquear motorista em outra placa e placa com outro motorista em período sobreposto (ignorando encerrados/substituídos).
12. **Substituir motorista** = novo registro + antigo vira `substituido` com `substituido_por_id` e `data_fim = início do novo`; **Encerrar** = `encerrado` + `data_fim = hoje`; **Remover** = delete.
13. **Replicar mês anterior (motoristas)**: copia todos os `ativo` do mês anterior para o mês inteiro do alvo com observação "Replicado do mês anterior".
14. **Central de Fidelização**: KPIs + gráficos por operação/liderança + ranking de locais, a partir do grid e das mobilizações do mês; mesma tela para liderança com dados filtrados.
15. **Perfis**: admin/gestor editam tudo; `rh` edita grid; liderança lê grid e edita motoristas do seu escopo; importação e planner de lideranças só para perfis globais.
