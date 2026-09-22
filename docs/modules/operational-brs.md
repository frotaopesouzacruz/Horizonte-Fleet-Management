# Governança Operacional › BRs (Etapa 13.1)

Rota: `/governanca/brs` · Menu: Governança operacional → Lideranças, **BRs**,
Fidelização · Permissão de entrada: `fidelization.view`.

Este documento descreve o módulo independente de BRs: por que ele existe, o que
ele é (e o que deliberadamente não é), o modelo de leitura que o sustenta, as
integrações com os demais módulos, a segurança e os testes. O mapeamento do HFC
que serviu de referência está em [`hfc-governance-mapping.md`](./hfc-governance-mapping.md).

---

## 1. Uma BR, uma identidade, uma casa

A BR é a posição operacional permanente. O veículo passa por ela; o motorista
passa por ela; a liderança responde por ela. Nada disso muda o que a BR é.

No HFC essa identidade estava repartida em três lugares — `operation_brs`
(cadastro por cidade), `fidelization_brs` (uma por código) e BRs sintéticas
derivadas dos códigos do grid diário — e o grid ainda gravava o código como
texto em cada célula. A mesma posição podia existir três vezes e divergir
(mapeamento §7, problemas 01–07).

No HFM a regra é uma só, e esta etapa não a relaxou:

* **`operation_brs` continua sendo a única entidade de BR.** Nenhuma tabela nova
  de BR foi criada; a chave natural continua `organização + operação + cidade +
  código normalizado` (Etapa 08/13).
* **O módulo BRs é a única casa administrativa** da posição: criar, editar,
  cadastrar em lote, importar, exportar, inativar e reativar acontecem aqui.
* **Operações e Fidelização só apontam para cá.** O detalhe da operação ganhou
  o atalho "Consultar BRs desta operação"; a aba *Planner de locais e BRs* da
  Fidelização virou consulta e planejamento, com um aviso e um link para o
  módulo. Os três drawers de cadastro (`BrFormDrawer`, `BrBatchDrawer`,
  `BrHistoryDrawer`) foram movidos para `src/components/governance/brs/` e são
  os mesmos componentes — não há um segundo formulário.

Não existem `brs.*` como permissões novas. O prompt pedia "criar ou
reutilizar"; reutilizar é o que mantém um perfil de acesso só. O mapa está na
§8.

---

## 2. O que a tela mostra

### Cabeçalho e ações
Nova BR · Cadastrar em lote · Importar (planilha de BRs, prévia da §58 da
Etapa 13) · Exportar (XLSX/CSV, com os filtros em tela, auditado) — cada uma
condicionada à permissão (§8).

### Filtros (todos na URL; encadeados)
Competência · Busca por código/descrição (no Enter) · Operação → Estado →
Cidade (a cobertura da operação decide o que aparece) · Liderança · Situação ·
Veículo (com/sem) · Motorista (com/sem) · Substituição no período (com/sem).
Qualquer mudança de filtro volta à primeira página.

### Indicadores
Cadastrais (não dependem da competência): posições, ativas, inativas.
Da competência (resolvidos na data-âncora — hoje, se o mês é o corrente; o
último dia, se já passou; o primeiro, se ainda vem): com/sem veículo, com/sem
motorista, com/sem liderança, com substituição no período. E três recortes:
por operação, por local, por liderança.

Nenhuma BR conta duas vezes: "com substituição no período" conta a BR uma vez
mesmo que ela tenha trocado de placa três vezes no mês, e "por liderança" soma
exatamente "com liderança".

### Listagem
Paginada e ordenada **no servidor** (50 por página): código e descrição,
operação, estado/cidade, situação, liderança vigente (e de onde ela veio:
exceção do BR, cidade ou operação), veículo atual, motorista atual, início da
alocação, última movimentação (com a marca "substituição" quando houve no mês)
e ações. Abaixo de `lg` a tabela vira cartões por BR, com as mesmas ações.

### Detalhe (gaveta)
Abas **Dados** (cadastro + contexto na data-âncora: veículo, motorista,
liderança com a regra que respondeu, filial), **Liderança** (todas as
designações que alcançam a BR), **Veículos** (histórico da posição),
**Motoristas**, **Movimentações** (cada substituição/inversão com veículo
anterior → novo, motivo, quem registrou e quando — o ator real, lido do perfil)
e **Indicadores** (dias com veículo, trocas, checklists e aderência do mês).
Atalhos para a Fidelização e para as Lideranças já filtrados.

Editar pela linha lê o detalhe antes de abrir o formulário: a linha da listagem
não carrega observações nem `updated_at`, e abrir o formulário só com ela
apagaria as observações e desligaria a conferência de concorrência.

### Inativação
Não existe exclusão física. Inativar mostra o impacto real — veículos vigentes,
motoristas planejados, lideranças responsáveis, vínculos no histórico — pede
confirmação e grava o motivo. O que estava vigente continua vigente; a BR só
deixa de receber planejamento novo. Reativar é o caminho de volta.

---

## 3. O modelo de leitura (`20260922170000_governance_brs_module.sql`)

Tudo `security invoker`, `stable`, `search_path = ''`: a RLS de
`operation_brs`, `fidelization_assignments`, `fidelization_drivers` e
`leadership_assignments` decide o que cada pessoa vê, e nenhuma função abre
porta mais larga que a tabela.

| Rotina | Responde | Notas |
|---|---|---|
| `br_directory(org, ano, mês, filtros, limit, offset, sort, dir)` | a listagem | CTE materializada sobre `br_planner_rows` (a mesma resolução do Planner de Locais) + última movimentação + `swapped_in_period`; `limit` ≤ 200; ordenação em `code`, `operation`, `city`, `leader`, `vehicle`, `driver`, `last_movement`, `status` |
| `br_planner_indicators` (mesma assinatura) | os cartões | ganhou `with_leader`, `without_leader` (só BRs ativas), `with_vehicle_swap_in_period`, `by_leader` |
| `br_detail(org, br, ano, mês)` | a gaveta | `null` quando a BR não existe ou está fora do escopo; `movements` carrega `actor_name` de `profiles` |
| `vehicle_br_history(org, veículo)` | a aba Fidelização do Cadastro de Frotas | `current`, `history`, `substitutions`; lê pelo `vehicle_id`, nunca pela placa |
| `resolve_operational_context(org, br, data)` | o serviço central (§4) | |

A listagem resolve as 88 posições em **uma** consulta. Uma tela que
perguntasse liderança, veículo e motorista por linha faria 264 idas ao banco.

---

## 4. Serviço central de contexto (`resolve_operational_context`)

A §45/§47 pedia um lugar só onde os módulos perguntassem "o que valia para esta
BR nesta data" — em vez de cada um resolver veículo, liderança e motorista à sua
maneira e divergir. É isto:

```
resolve_operational_context(org, br, data) →
  { date, operation{id,code,name,status}, state{id,uf,name}, city{id,name,operation_city_id},
    br{id,code,description,status},
    vehicle{id,fleet_code,license_plate,vehicle_type…,assignment_id,effective_from,effective_to,status,source,reason} | null,
    driver{employee_id,name,employee_code,driver_id,role,effective_from,effective_to,status} | null,
    leadership{employee_id,name,scope_level,assignment_id,effective_from,effective_to,rule} | null,
    unit{id,code,name} | null,
    origins{vehicle,leadership,driver} }
```

Três regras:

1. **A data manda.** Uma consulta de 15/09 devolve o veículo que ocupava a BR em
   15/09, mesmo que hoje seja outro (§54). A suíte 13c prova isso substituindo
   um veículo a partir de amanhã e perguntando hoje.
2. **Cada vínculo diz de onde veio.** `origins.vehicle` é a origem do vínculo
   (`manual`, `import`, `substitution`, `inversion`, `replication`);
   `origins.leadership` é o nível que respondeu (`br`, `city`, `operation`, na
   precedência da §43); `leadership.rule` é a frase que a tela mostra.
3. **Escopo é da tabela.** A função é `security invoker`; quem não enxerga a BR
   recebe `null`, não uma versão parcial.

No TypeScript: `getOperationalContext(orgId, brId, date?)` em
`src/lib/governance/brs.ts`. É o contrato que Aderência, Check List, Planos de
Ação e Manutenção devem consumir — sem novos módulos nesta etapa, o contrato
existe e está testado; a adoção por cada módulo é evolução deles.

---

## 5. Integrações

| Módulo | O que mudou | Fonte |
|---|---|---|
| **Operações** | formulário em abas *Dados gerais* / *Aplicativos* (mesma lógica de Tipos de Equipamento, mesma fonte `application_links`); atalho "Consultar BRs desta operação" → `/governanca/brs?operacao=…` | `application_links_overview`, `operation_brs` |
| **Fidelização** | Planner de locais e BRs em modo consulta + aviso e link; importação de BRs saiu daqui (só alocações); Visão geral com o Dashboard de Estabilidade; Planner de motoristas com substituição transacional; "Replicar competência" (veículos e motoristas, com prévia); histórico rotula `replication` | `fidelization_*`, `br_planner_rows` |
| **Lideranças** | cartões de cobertura (locais sem liderança, %), "sob responsabilidade" (BRs, veículos, motoristas) e a gaveta "o que esta liderança responde" | `leadership_indicators`, `leadership_scope_summary` |
| **Cadastro de Frotas** | aba *Fidelização* no detalhe do veículo: BR atual e anteriores, períodos, origem, substituições; link para o módulo | `vehicle_br_history` |
| **Aderência / Check List** | continuam gravando `operation_br_id`; o detalhe da BR conta checklists e obrigações do mês por esse id | `checklist_executions`, `adherence_obligation_status` |

Nenhuma dessas integrações copia dado. Cada uma lê a mesma linha de
`operation_brs` pelo mesmo `id`.

---

## 6. Regras que valem no banco, não só na tela

* **Unicidade** da BR por organização + operação + cidade + código normalizado
  (Etapa 08).
* **Ocupação** — uma BR tem um titular por dia; um veículo ocupa uma BR por dia;
  um motorista principal ocupa uma posição por dia — são constraints de
  exclusão (`btree_gist`), não conferências.
* **Substituição e inversão** são uma transação cada (Etapa 08), e agora a
  **substituição de motorista** também: `substitute_fidelization_driver` fecha
  o anterior na véspera (ou cancela, se não começou), abre o novo no mesmo
  vínculo e falha inteira quando o novo motorista conflita — a suíte 13c força
  o conflito e confere que o anterior continua intacto.
* **Replicação** (`replicate_fidelization_competence`) nunca sobrescreve o
  destino: o que já está planejado lá é "preservado", veículo já usado em outra
  BR é "conflito", BR ou veículo inativo é "ignorado", e só o resto é "novo". A
  prévia (`dry_run = true`) não grava nada; a gravação devolve os mesmos
  números da prévia; repetir devolve zero novos. Vínculos replicados nascem com
  `source = 'replication'` e `reason = 'Replicado de MM/AAAA'`.
* **Nada é apagado.** `fidelization_block_delete`,
  `fidelization_drivers_block_delete` e o soft delete guardado de
  `operation_brs` continuam valendo. Inativar é situação, não exclusão.
* **Histórico não é reclassificado.** Nenhuma rotina desta etapa atualiza uma
  linha passada além do `end_date`/`end_reason` que a própria movimentação
  exige.

---

## 7. Dashboard de Estabilidade — definições

As fórmulas estão em [`fidelization.md`](./fidelization.md) §15 e no rodapé do
próprio dashboard ("Como os indicadores são calculados"). O ponto que mais
importa, porque era o defeito 04 do HFC (mapeamento §7): **mobilização é evento
explícito**. Substituição e inversão são linhas com `replaces_assignment_id`;
a inversão gera duas linhas e conta como **um** evento; a BR com troca conta
**uma** vez. A troca de titular observada entre dois vínculos consecutivos sem
evento por trás (típica da carga histórica) é "movimentação inferida" — mostrada
à parte, nunca somada.

Nos recortes por operação/local/liderança, cada grupo conta os eventos que o
tocaram; uma inversão entre BRs de cidades diferentes aparece em cada cidade
(cada uma teve uma BR trocada), então a soma dos recortes pode exceder o total.
A tela diz isso.

---

## 8. Segurança

### Permissões (reutilizadas)

| Ação do prompt | Permissão no HFM |
|---|---|
| `brs.view` | `fidelization.view` (a RLS de `operation_brs` também aceita `leadership.view`) |
| `brs.create`, `brs.update`, `brs.deactivate`, `brs.reactivate` | `fidelization.manage_brs` |
| `brs.import` | `fidelization.import` **e** `fidelization.manage_brs` |
| `brs.export` | `fidelization.export` |
| `brs.manage_vehicle_assignments` | `fidelization.plan` / `fidelization.change_vehicle` |
| `brs.manage_leadership_overrides` | `leadership.assign` (exceção por BR, Etapa 13) |
| `brs.view_history` | `fidelization.view` |
| `brs.view_audit` | `fidelization.audit` |

O menu esconde por cortesia; a rota reconfere `fidelization.view` no servidor;
as rotinas `security definer` conferem a permissão **antes** de qualquer
leitura (a substituição de motorista, em especial, recusa sem dizer se o
vínculo existe); as leituras são `security invoker` e a RLS decide.

### Escopo e multi-tenancy
Toda rotina recebe `p_organization_id` e o confere contra a linha; a RLS de
`operation_brs` exige a permissão **e** `private.can_access_operation`. Um
veículo, motorista ou liderança de outra organização não entra: as chaves
estrangeiras compostas da Etapa 08 continuam valendo.

### Auditoria
Os gatilhos `operation_brs_audit`, `fidelization_audit` e
`fidelization_drivers_audit` gravam cada INSERT/UPDATE com o usuário da
sessão. A gaveta de Movimentações mostra `actor_name` a partir de
`created_by` → `profiles` — nunca um nome digitado.

---

## 9. Desempenho e responsividade

* Listagem: uma consulta (`br_directory`) com CTE materializada; indicadores em
  outra; opções de filtro em outra. Sem N+1 (§67).
* Detalhe e histórico: carregados ao abrir a gaveta, não junto com a página.
* Abaixo de `lg`: cartões por BR; abaixo de `md`: filtros empilhados; a tabela
  não gera rolagem horizontal da página (teste em 390px).

---

## 10. Testes

**`supabase/tests/remote/13c_governance_brs_module.sql` — 11/11 PASS** contra o
projeto de desenvolvimento em 22/09/2026 (bloco transacional desfeito no fim;
usa BRs, veículos e colaboradores reais; não cria nada fora da transação):

| Bloco | Protege |
|---|---|
| C1 | contexto central: hierarquia, veículo com origem, liderança com regra; BR desconhecida → `null`; BR sem veículo → `vehicle: null` |
| C2 | histórico na data: após substituir a partir de amanhã, hoje responde o anterior e amanhã o novo (origem `substitution`) |
| C3 | diretório: total, paginação, ordem desc, filtro "com substituição no período" (a BR substituída vem primeiro por última movimentação), filtro por operação |
| C4 | indicadores sem contagem dupla: com + sem liderança ≤ total; por liderança soma = com liderança; com + sem veículo = total |
| C5 | detalhe: uma movimentação com anterior → novo, motivo, `created_by` e `actor_name` do perfil; BR desconhecida → `null` |
| C6 | BR do veículo: atual e anteriores pelo `vehicle_id`; `substitutions` |
| C7 | lideranças: locais com + sem = total; `coverage_pct` = fórmula; escopo da liderança = planner filtrado por ela |
| C8 | motorista: anterior fechado na véspera com motivo; novo planejado até o fim do vínculo; mesmo motorista recusado; sem motivo recusado; **conflito desfaz o fechamento** |
| C9 | estabilidade: 1 substituição + 1 inversão (2 linhas) = 2 mobilizações; 3 BRs com troca; fórmula da frota; cobertura; inferidas à parte |
| C10 | replicação: prévia não grava; prévia = 84 novos / 2 preservados / 1 conflito; real = prévia (veículos e motoristas); destino preservado; repetir não sobrescreve |
| C11 | sem permissão: substituir motorista e replicar recusados (42501); como `authenticated` sem `fidelization.view`/`leadership.view`, diretório vazio, contexto `null`, estabilidade zerada |

C11 rebaixa o próprio ator num sub-bloco desfeito por exceção (técnica das
suítes 12b/12c/13/13b) e lê como `authenticated`, porque o editor roda como
`postgres` e ignora RLS.

**Playwright** (`npm run build:ui-test` + `/dev/preview-*`): `tests/ui/brs.spec.ts`
(4 casos — cabeçalho, cartões, três estados de linha, ordenação pela URL, cartões
no celular sem rolagem horizontal, detalhe que falha em pé sem sessão),
`fidelization.spec.ts` (+ aviso do módulo BRs, dashboard com 96,6 % e trocas
inferidas, fórmulas), `leadership.spec.ts` (novo: cartões, gaveta de escopo,
exceção do BR, sem rolagem horizontal), `operations.spec.ts` (+ abas do
formulário, atalho para BRs). Suíte completa: **111 passed, 8 skipped**.

A suíte de UI descobriu um defeito do componente `TabsList`: dentro de uma
coluna flex (gaveta com corpo rolável) a lista de abas encolhia a 1px e os
botões ficavam fora da área clicável. Corrigido no componente (`shrink-0`),
para todas as gavetas.

---

## 11. Arquivos

Banco: `supabase/migrations/20260922170000_governance_brs_module.sql`,
`supabase/tests/remote/13c_governance_brs_module.sql`.
Dados: `src/lib/governance/brs.ts` (novo), `br-planner.ts`, `queries.ts`,
`actions.ts`, `import-actions.ts`, `src/types/database.types.ts`.
Tela: `src/app/(app)/governanca/brs/*` (página, view, filtros, indicadores,
tabela, gaveta de detalhe, histórico, rótulos), `src/components/governance/brs/*`
(drawers movidos), `src/components/layout/navigation.ts`,
`src/components/ui/tabs.tsx`.
Preview e testes: `src/app/dev/preview-brs/*`, `tests/ui/brs.spec.ts`.

---

## 12. Pendências

* **Exportação com o filtro "substituição no período".** A rota de exportação
  (`/governanca/fidelizacao/export?tipo=planner`) aplica todos os filtros do
  módulo menos esse, porque `br_planner_rows` não o conhece — o diretório o
  aplica depois. Estender a rota para ler `br_directory` sem limite de página é
  o próximo passo.
* **`fidelization.audit`** chega à tela mas ainda não abre a trilha de
  `audit_logs` da BR; a gaveta mostra as movimentações a partir das próprias
  tabelas, com ator real.
* **Adoção do serviço de contexto** por Aderência, Check List e módulos futuros
  (Planos de Ação, Manutenção): o contrato existe e está testado; cada módulo
  decide quando trocar sua resolução própria por ele.
