# Governança operacional · Fidelização

Rota: `/governanca/fidelizacao` · Permissão de entrada: `fidelization.view`

Desde a Etapa 15 a tela é a **Central de Fidelização** — ver [§17](#17-central-de-fidelização-etapa-15).

O planejamento das posições operacionais: qual veículo ocupa qual BR, em que
dias, e quem dirige. O módulo acrescenta os dois últimos degraus da hierarquia
oficial do HFM:

```
ORGANIZAÇÃO → OPERAÇÃO → ESTADO → CIDADE → BR → VEÍCULO / MOTORISTA
```

---

## 1. Fidelização não é alocação

Esta é a distinção crítica do módulo (§38), e a razão de existirem duas tabelas.

| | Responde | Tabela |
|---|---|---|
| Alocação operacional | onde o veículo **está lotado** | `vehicle_operation_assignments` |
| Fidelização | que posição ele **ocupa, e quando** | `fidelization_assignments` |

Um veículo alocado em Last Mile MG / Contagem pode ser fidelizado a uma BR por
duas semanas **sem que a sua operação ou cidade mudem**. Nenhuma linha das
rotinas da Etapa 08 escreve em `vehicle_operation_assignments`.

---

## 2. A BR é a fonte única

`operation_brs` é o cadastro oficial de posições operacionais (§34). Não existe
`fidelization_brs` e não deve existir: todos os módulos referenciam
`operation_brs.id`.

O código da BR **não é único no mundo**. Duas operações podem ter a sua "001", e
duas cidades da mesma operação também. A unicidade é

```
unique (organization_id, operation_id, city_id, normalize_code(code))
        where deleted_at is null
```

e a identidade técnica é `operation_brs.id`.

### A geografia é provada por chave estrangeira

A BR aponta para `operation_cities.id` e carrega `operation_id`, `state_id` e
`city_id` desnormalizados. Uma única FK composta prova os quatro de uma vez:

```
foreign key (operation_city_id, organization_id, operation_id, state_id, city_id)
  references operation_cities (id, organization_id, operation_id, state_id, city_id)
```

Não existe combinação inconsistente representável. Uma BR em cidade fora da
cobertura da operação é recusada pelo banco, venha de onde vier (§33).

`save_operation_br` nem sequer aceita operação, estado e cidade do payload: ele
recebe a cidade da cobertura e lê o resto dali.

A operação de uma BR **não muda** depois de criada — todo o histórico de
fidelização pendurado nela mudaria de significado. A cidade dentro da mesma
operação pode ser corrigida.

---

## 3. Ocupação é constraint, não conferência

Três regras, três EXCLUDE constraints, todas com `btree_gist`:

| Constraint | Impede |
|---|---|
| `fidelization_br_occupancy` | dois veículos principais na mesma BR no mesmo dia |
| `fidelization_vehicle_occupancy` | o mesmo veículo em duas BRs no mesmo dia |
| `fidelization_drivers_primary_occupancy` | dois motoristas principais no mesmo vínculo e dia |
| `fidelization_drivers_occupancy` | o mesmo motorista principal em duas posições no mesmo dia |

Duas pessoas planejando o mesmo veículo ao mesmo tempo passam por qualquer
`select ... where not exists`: as duas transações leem antes de qualquer uma
gravar. Só a constraint resolve (§47, §62).

> A restrição de motorista olha apenas `driver_role = 'primary'`. Um reserva
> listado como secundário em cinco BRs da mesma cidade é a escala normal de
> backup, não um conflito — uma constraint que a proibisse tornaria o
> planejamento de reserva impossível de representar.

Registros `cancelled` saem dos índices: por definição não ocuparam nada.

**Antes de bater na constraint**, a tela mostra o conflito com nome
(`fidelization_conflicts`): qual veículo, em qual BR, de qual operação, em que
período (§51). A mensagem "houve sobreposição" sozinha não ajuda ninguém.

---

## 4. Período, competência e calendário

`start_date` e `end_date` são **inclusivos**; `end_date` nulo é vínculo em
aberto. Um vínculo pode durar um dia, um mês ou atravessar competências (§46) —
nada no modelo é preso a um mês.

O calendário mensal é **uma visualização** dos vínculos cuja vigência intersecta
a competência. `fidelization_calendar` devolve uma linha por BR com os dias em um
objeto `jsonb`, e cada dia já traz veículo, estado, se é fim de semana e se
aquele dia é o **primeiro do vínculo**.

Esse último campo é o que permite desenhar uma substituição como substituição.
A matriz agrupa dias consecutivos do mesmo vínculo em um bloco único — o que
também é o que deixa espaço para escrever o código de frota em tamanho legível
em vez de encolher a fonte até caberem 31 colunas (§43).

Períodos separados por dias sem vínculo **nunca** são desenhados unidos (§44):
são duas decisões, e uni-las esconderia a lacuna que alguém tem de explicar.

### Estados

`planned` · `confirmed` · `executed` · `cancelled`, e a ausência de vínculo é
"sem planejamento". O padrão é `planned`: o sistema ainda não tem origem
confiável de confirmação, e §45 é explícito em não presumir execução.

---

## 5. Movimentações compostas são uma transação

**Substituir** (`substitute_fidelization_vehicle`) encerra o vínculo atual na
véspera e abre o novo apontando para o anterior (`replaces_assignment_id`). Se a
troca vale a partir do primeiro dia do vínculo, o original é **cancelado** — ele
nunca vigorou.

**Inverter** (`invert_fidelization_vehicles`) é uma função e uma transação
(§50). Feita como duas substituições independentes, entre a primeira e a segunda
um veículo estaria em duas BRs ao mesmo tempo, a constraint recusaria a segunda
metade e a primeira ficaria aplicada. A rotina fecha os dois vínculos — e os
motoristas dos dois — antes de abrir qualquer um, e trava os registros em ordem
de `id` para que duas inversões simultâneas em sentidos opostos não se travem
uma na outra.

Cada veículo é validado para a operação **de destino**, não a de origem: duas
BRs podem ser de operações diferentes.

**Motivo é obrigatório** em substituição, inversão e encerramento (§49).

### `reason` e `end_reason`

São colunas diferentes de propósito. `reason` diz por que o vínculo existe e
nunca é sobrescrito; `end_reason` diz por que acabou. Um veículo que entrou por
inversão e saiu por manutenção mantém as duas respostas — antes da correção da
migration `…_fidelization_reason_and_drivers`, a segunda apagava a primeira.

---

## 6. Motoristas

`fidelization_drivers` liga um `employee_id` do cadastro mestre a um vínculo, com
papel (`primary` / `secondary`) e período próprio (§40). Não são dois campos de
texto e não há cadastro paralelo de motorista.

O período do motorista tem de caber no período do vínculo, e a invariante vale
**nas duas direções**:

* na inserção do motorista, por gatilho `before` que trava o vínculo pai com
  `for share` — sem o lock, encurtar o vínculo em uma transação enquanto outra
  insere um motorista deixa as duas passarem;
* no vínculo, por `constraint trigger ... deferrable initially deferred`, que
  verifica no COMMIT. Diferido de propósito: as rotinas encurtam o vínculo e
  ajustam os motoristas na mesma transação, e um gatilho imediato dispararia
  contra um estado que a própria rotina consertaria duas linhas adiante.

Vincular alguém aqui **não cria colaborador, não cria conta de acesso e não
altera Perfil de Acesso** (§37, §52).

---

## 7. Elegibilidade do veículo

`eligible_fidelization_vehicles` busca **no servidor** (§48) e considera:

* situação cadastral ativa e não arquivado;
* escopo de acesso de quem consulta (`private.vehicle_in_scope`);
* o tipo de equipamento admitido na operação da BR, quando a Etapa 07 restringiu
  esse tipo a operações específicas. Um tipo sem nenhuma operação cadastrada é um
  tipo **sem restrição**, que é como o cadastro de frotas já o trata;
* conflitos no período — os veículos em conflito **aparecem**, marcados com a BR
  que os ocupa, em vez de sumirem sem explicação.

Noventa e cinco veículos hoje e o número só cresce: mandar a frota inteira para
o navegador filtrar é a diferença entre uma tela que abre e uma que trava no
celular do supervisor.

---

## 8. Indicadores e hierarquia

`fidelization_indicators` devolve total de BRs, ativas, com veículo, sem veículo,
veículos fidelizados, substituições, inversões e a distribuição por operação —
todos contados das tabelas, todos respeitando competência, filtros e escopo.

`operational_hierarchy` devolve Operação → Estado → Cidade → BR com contadores
reais e a liderança de cada nível. A organização é obrigatória e a operação é
filtrável: §54 proíbe carregar a hierarquia inteira de todas as organizações em
uma consulta só.

> **Estabilidade da fidelização (§56) está pendente de propósito.** A estrutura
> para calculá-la existe — dias planejados, dias com e sem veículo,
> substituições por BR — mas a fórmula não está documentada em lugar nenhum, e
> §56 proíbe inventá-la. Fica registrado como pendência funcional.

---

## 9. Permissões, RLS e escrita

| Código | Para quê |
|---|---|
| `fidelization.view` | calendário, BRs, motoristas e indicadores |
| `fidelization.manage_brs` | cadastrar, editar, inativar e reativar posições |
| `fidelization.plan` | criar e editar o planejamento de veículos |
| `fidelization.change_vehicle` | substituir, inverter e encerrar vínculos |
| `fidelization.change_driver` | vincular, substituir e encerrar motoristas |
| `fidelization.import` | importar planejamento pelo fluxo validado |
| `fidelization.export` | exportar planejamento e histórico |
| `fidelization.audit` | ler a trilha de auditoria |

**Escopo.** `private.br_in_scope` resolve a operação da BR e aplica
`private.can_access_operation`. As três tabelas usam a mesma definição de
"alcança" — a fidelização e os motoristas não carregam `operation_id` e chegam
lá pela BR.

A função é concedida a `authenticated` porque políticas RLS são avaliadas com os
privilégios de quem consulta, não os do dono da tabela.

**Escrita.** Nenhuma das quatro tabelas tem política de INSERT, UPDATE ou
DELETE, e essas permissões estão revogadas de `authenticated` explicitamente.
`DELETE` em `fidelization_assignments` e `fidelization_drivers` é recusado por
gatilho: histórico de mobilização não se apaga.

---

## 10. Auditoria

Gatilhos `private.tg_audit` em `operation_brs`, `fidelization_assignments` e
`fidelization_drivers` gravam em `public.audit_logs`: quem, quando, valor
anterior, valor novo, campos alterados, organização. O motivo e a origem
(`source`, `reason`, `end_reason`) são colunas, então aparecem no `new_data` de
cada evento — BR criada/alterada/inativada, veículo fidelizado/substituído/
removido, motorista vinculado/substituído (§61).

---

## 11. Inativação de BR

`set_operation_br_status` inativa e reativa. Uma BR inativa **deixa de receber
planejamento novo**; o que já estava vigente continua vigente e visível.

Antes de confirmar, a tela chama `operation_br_impact`, que conta das tabelas:
veículos com vínculo vigente, vínculos no histórico, motoristas planejados e
lideranças responsáveis. Números reais, nunca estimados.

---

## 12. Migrations desta etapa

| Arquivo | O que faz |
|---|---|
| `…_operational_governance_foundation.sql` | `btree_gist`, `operation_brs`, `fidelization_assignments`, `fidelization_drivers`, ocupação e invariantes |
| `…_operational_governance_rbac_rls.sql` | permissões, matriz padrão, `br_in_scope`, RLS, grants |
| `…_fidelization_rpcs.sql` | elegibilidade, `lock_br`, BRs, impacto, conflitos, planejamento, substituição, inversão, motoristas |
| `…_governance_read_model.sql` | `operation_br_directory`, `fidelization_directory`, calendário, indicadores, hierarquia, veículos elegíveis |
| `…_fidelization_reason_and_drivers.sql` | `end_reason`, `close_assignment_drivers`, correção da inversão |
| `…_governance_brs_module.sql` (13.1) | `resolve_operational_context`, `br_directory`, `br_detail`, `vehicle_br_history`, `substitute_fidelization_driver`, `replicate_fidelization_competence`, `fidelization_stability`, indicadores de cobertura; origem `replication` |

---

## 13. Continuação na Etapa 13

O **Planner de Locais e BRs** — cadastro em lote, visão por local, liderança
vigente por BR e histórico de veículos da posição — está em
[`fidelization-brs.md`](./fidelization-brs.md), junto com a carga da base
histórica (239 vigências, 88 posições) e os dois ajustes que ela exigiu em
`save_fidelization_assignment` e `assert_vehicle_fidelizable`.

---

## 14. Pendências

* **Confirmação e execução**: as transições planejado → confirmado → executado
  e o cancelamento com motivo existem (`set_fidelization_assignment_status`);
  o que falta é uma origem externa de confirmação.
* **Alocações de apoio (`support`)** entram pela importação e pelo formulário,
  mas o planner e a estabilidade seguem olhando só o titular.
* **Turnos** de motorista: o modelo tem `driver_role` principal/secundário; não
  há turno por horário, e o HFC também não o usava (mapeamento §5).
* **Planos de Ação** (Etapa 15, §68): o módulo ainda não existe no HFM. Quando
  existir, lê a BR, a liderança e o veículo gravados em cada execução de
  checklist — nenhuma mudança na fidelização é necessária para isso.

---

## 15. Dashboard de Estabilidade (Etapa 13.1)

Fica na aba *Visão geral* e lê `fidelization_stability(org, ano, mês, filtros)`.
Todas as definições valem no banco; a tela as repete no rodapé, palavra por
palavra.

| Termo | Definição |
|---|---|
| universo | BRs ativas da organização, com os filtros (operação, estado, cidade, liderança) |
| com veículo | BR com titular não cancelado que toca a competência |
| troca de veículo | vínculo com `replaces_assignment_id` iniciado no mês — substituição, inversão ou importação-substituição. **Um evento por linha; a inversão gera duas linhas e conta como um evento (par)** |
| BR com troca | BR com pelo menos uma troca no mês — explícita **ou inferida** — conta **uma** vez (desde 20260930100000) |
| estabilidade da frota | 1 − BRs com troca / BRs com veículo |
| troca de motorista | motorista principal iniciado no mês cujo antecessor no mesmo BR terminou na véspera |
| estabilidade de motoristas | 1 − BRs com troca de motorista / BRs com motorista |
| cobertura de lideranças | BRs ativas com liderança na data-âncora / BRs ativas |
| movimentação inferida | troca de titular observada entre vínculos consecutivos **sem** `replaces_assignment_id` (ex.: períodos consecutivos de importações anteriores a 20260930110000). **Entra nas mobilizações** desde 20260930120000: a troca recíproca entre duas BRs no mesmo dia conta como **uma** inversão; a troca sem par, como uma substituição. Conta para "BR com troca" e, portanto, para a estabilidade |
| mobilizações | substituições + inversões registradas (`explicit_*`) + substituições e inversões inferidas (`inferred_*`). Cada troca entra uma vez: a linha com `replaces_assignment_id` nunca é inferida |

Por que a distinção: no HFC, "mobilizações" misturava linhas explícitas com
trocas derivadas do grid, uma edição de N dias gerava N linhas idênticas, e
sob filtro a taxa podia ficar negativa (mapeamento §3 e §7, problemas 04 e
05). Aqui cada substituição e cada inversão é **uma** transação e **uma** linha
por BR. A base que chegou por importação antes de 20260930110000 tem trocas de
titular sem evento (16 em Setembro/2026, em 8 pares recíprocos); desde
20260930120000 elas **entram** nas mobilizações — o par recíproco vale uma
inversão, como o evento que teria sido registrado — e o painel mostra quantas
entraram (`inferred_substitutions`, `inferred_inversions`). Setembro/2026:
16 inferidas = 8 inversões; mobilizações = registradas + 8.

Saídas de `fidelization_stability` ligadas às trocas de veículo:

| Campo | Conteúdo |
|---|---|
| `explicit_substitutions`, `explicit_inversions`, `explicit_mobilizations` | só os eventos registrados |
| `inferred_vehicle_changes` | linhas inferidas (vínculos) |
| `inferred_substitutions`, `inferred_inversions` | as inferidas contadas como eventos (par recíproco = 1 inversão) |
| `vehicle_substitutions`, `vehicle_inversions`, `mobilizations` | registradas + inferidas |
| `vehicle_change_links` | vínculos que entraram por troca (substituições + linhas de inversão + inferidas) — o cartão "Substituições e inversões" |

Nos recortes por operação, local e liderança, cada grupo conta os eventos que o
tocaram; uma inversão entre BRs de cidades diferentes aparece nas duas cidades
(cada uma teve uma BR trocada), então a soma dos recortes pode exceder o total.

Faixas de cor (a mesma escala nos três cartões): ≥ 95 % verde, ≥ 85 % atenção,
abaixo, alerta. Quando o denominador é zero, o cartão mostra "—", não 0 %.

Prova: suíte 13c, C9 — uma substituição mais uma inversão (duas linhas) dão
2 mobilizações registradas e o total soma as inferidas uma vez; suíte 21 (S1–S5)
e suíte 22 (M1–M2) para as inferidas e Setembro/2026.

---

## 16. Substituição de motorista e replicação da fidelização (Etapa 13.1)

### Substituir motorista (`substitute_fidelization_driver`)
Uma transação: confere a permissão (`fidelization.change_driver`) antes de
qualquer leitura, trava a BR, fecha o vínculo anterior na véspera (ou o
cancela, se ainda não tinha começado), abre o novo no **mesmo** vínculo de
veículo com o mesmo papel, herdando o fim do anterior ou do vínculo do
veículo, e exige motivo. Se o novo motorista já é principal em outra posição
no período, a constraint de ocupação recusa e **nada** do fechamento persiste
(13c, C8). Na tela: ação por linha no *Planner de motoristas*, desabilitada
para vínculos cancelados ou já encerrados.

### Replicar competência (`replicate_fidelization_competence`)
Copia os titulares vigentes no último dia da competência de origem para a
competência de destino, e, opcionalmente, o motorista principal de cada um.
Nunca sobrescreve: a mesma placa já na mesma BR no destino é **já existente**;
a BR já planejada no destino com **outro** veículo, ou o veículo já usado em
outra BR no destino, é **conflito** (o destino fica como está); BR ou veículo
inativo é **ignorado**; só o resto é **novo**. (Até 20261002106000, a BR
planejada com outro veículo contava como "preservada"; ver §19.) A prévia (`dry_run`) não grava e devolve as mesmas
contagens e as mesmas linhas da gravação; repetir devolve zero novos. Os
vínculos criados nascem `planned`, `source = 'replication'`,
`reason = 'Replicado de MM/AAAA'`, e os motoristas entram só onde o vínculo de
destino existe e não tem principal. A tela ("Replicar competência", com
`fidelization.plan`; motoristas só com `fidelization.change_driver`) só
habilita "Replicar" depois de uma prévia calculada para os mesmos parâmetros.
Prova: 13c, C10.

O HFC replicava sem escopo, sem dedup e sem transação (mapeamento §5); aqui a
rotina respeita `private.can_access_operation` por BR e roda inteira ou não
roda.

---

## 17. Central de Fidelização (Etapa 15)

### 17.1 Mapeamento do HFC

O HFC foi lido sem alteração nenhuma; o que ele faz, os 13 deltas em relação ao
mapeamento da Etapa 13, os 15 problemas verificados e as limitações da
inspeção (o banco do HFC parou de responder às 11:44 UTC) estão em
[`hfc-fidelization-mapping.md`](./hfc-fidelization-mapping.md).

### 17.2 Diagnóstico do HFM antes da etapa

Já existiam e continuam sendo a fonte oficial: `operation_brs` (BR permanente,
Etapa 13.1), `fidelization_assignments` e `fidelization_drivers` com as
constraints de ocupação (§3), a liderança por BR com exceção
(`private.br_leadership_at`), a importação com prévia (Etapa 13), a
substituição de motorista e a replicação da competência (§16), o Dashboard de
Estabilidade (§15) e o Planner de Locais e BRs.

Faltavam:

* **Histórico de mobilizações**: as trocas eram deduzidas dos vínculos; não
  havia evento imutável com liderança na data, ator e origem.
* **Edição por período** a partir da célula do dia, com prévia, conflito
  nomeado e inversão numa transação.
* **Proteção de dados históricos**: qualquer quem planejava podia mexer em
  datas passadas.
* **Matriz agrupada** por operação → liderança → cidade e filtros por
  liderança, placa, tipo de equipamento e situação da alocação.
* **Indicadores** da §14 que o dashboard não trazia (BRs cadastradas,
  veículos e motoristas fidelizados, recortes por estado e tipo).
* **Mapeamento de colunas e layouts salvos** na importação.

Nada foi recriado: não há tabela paralela de BRs, veículos, motoristas,
operações ou lideranças. As tabelas novas são o histórico
(`fidelization_movements`) e os layouts de importação (`import_layouts`).

### 17.3 Áreas da tela

| Área (aba, `aba=`) | O que mostra | Parâmetros próprios na URL |
|---|---|---|
| Visão geral (padrão) | Dashboard de Estabilidade (volume, estabilidade e trocas do mês — "Substituições e inversões" entre elas) e hierarquia operacional | — |
| Planner de frotas (`frotas`) | como o Planner de motoristas: um quadro por operação → liderança (abre com um clique; já vem aberta com filtro) → matriz BR × dia da liderança, por local | `q`, `lideranca`, `placa`, `tipo_equipamento`, `alocacao` |
| Planner de motoristas (`motoristas`) | um quadro por operação → liderança (abre com um clique) → local → BR, com veículo(s) no mês, motoristas e "+ Motorista"; substituir e encerrar | — |
| Histórico de mobilizações (`historico`) | eventos imutáveis, paginados; vínculos da competência recolhidos abaixo | `mov_de`, `mov_ate`, `mov_tipo`, `mov_assunto`, `mov_veiculo`, `mov_motorista`, `mov_pagina`, `lideranca` |
| Importação (`importacao`) | histórico de lotes e entrada de arquivos | — |

* Não há cartões acima das abas: os números da competência ficam na Visão
  geral, e cada área tem os seus.
* O Planner de Locais e BRs saiu da Central (a posição é do módulo BRs, que
  tem a mesma listagem, filtros e exportação). Um link antigo com
  `aba=locais` abre a Visão geral.
* O cabeçalho (competência, operação, estado, cidade) vale para todas as
  áreas. Trocar de área não consulta o servidor e mantém a competência;
  trocar a competência mantém a área (`aba` segue na URL).
* `q` e `lideranca` têm o mesmo sentido nos dois planners e são
  compartilhados. A placa digitada é `placa`, porque `veiculo` já quer dizer
  "com / sem veículo" no Planner de Locais.
* Sem "De" e "Até", o histórico mostra a competência em tela.
* No celular, o Planner de Frotas vira um cartão por BR com os períodos
  escritos; nenhuma área rola a página na horizontal (390 e 1440 px, testado).
* O calendário da Etapa 8 (`calendar-matrix`) foi substituído pelo Planner de
  Frotas; o vínculo da BR continua abrindo pela gaveta de planejamento.

### 17.4 BR e hierarquia

A BR é a identidade permanente (`operation_brs.id`); nada na Central cria BR.
A hierarquia é Organização → Operação → Estado → Cidade → BR → Veículo →
Motorista. A liderança de cada BR numa data vem de `private.br_leadership_at`
(exceção da BR, depois cidade, depois operação); a matriz usa a data âncora da
competência (§4) e cada evento grava a liderança **da data efetiva**. Mudar a
liderança não reescreve eventos antigos (suíte 15, M5).

### 17.5 Edição por período (`apply_fidelization_period`)

`public.apply_fidelization_period(org, payload)` — `security definer`, confere
`fidelization.plan` ou `fidelization.change_vehicle`, o escopo da BR
(`private.br_in_scope`) e trava as BRs envolvidas em ordem de id.

Payload: `operation_br_id`, `vehicle_id` (nulo = remover), `date_from`,
`date_to` (nulo = em diante), `reason`, `notes`, `invert`, `keep_drivers`
(padrão verdadeiro) e `dry_run`.

| Modo | Quando | O que faz |
|---|---|---|
| `allocate` | a BR está sem veículo no período | cria o vínculo; motivo opcional |
| `substitute` | a BR tem outro veículo | recorta o atual, cria o novo ligado ao substituído (`replaces_assignment_id`) e devolve o anterior depois do período |
| `remove` | `vehicle_id` nulo | recorta o período; a BR fica sem veículo e continua na matriz |
| `invert` | o veículo está em outra BR e `invert=true` | troca as duas placas no período, numa transação, e devolve cada uma depois |
| `transfer` | o veículo está em outra BR e esta está vazia | tira de lá e põe aqui |
| `conflict` | o veículo está em outra BR e `invert=false` | só prévia: nomeia a BR, operação, cidade e período e diz se a inversão é possível; gravar é recusado |

* A prévia (`dry_run`) devolve as ações — `trim`, `cancel`, `continue`,
  `create` — com BR, veículo, datas e motoristas levados; nada é gravado.
  A tela só habilita "Confirmar" depois de uma prévia do mesmo período.
* Substituir, remover, inverter e transferir exigem motivo.
* Os motoristas da BR acompanham o veículo novo por padrão (`keep_drivers`);
  a troca temporária de veículo não gera evento de motorista (M2).
* Uma falha em qualquer passo desfaz tudo — inclusive a primeira metade de
  uma inversão (P5).

### 17.6 Datas passadas: correção histórica

`private.tg_fidelization_historical_guard` (antes de gravar em
`fidelization_assignments` e `fidelization_drivers`, só com usuário
autenticado) recusa, sem `fidelization.manage_historical_data`:

* criar vínculo que começa antes de hoje;
* cancelar vínculo já iniciado;
* mudar o início quando o início antigo ou o novo já passou;
* trocar o veículo ou o colaborador de um vínculo já iniciado;
* encurtar o fim para antes de ontem, ou estender um fim que já passou.

Encerrar ontem é operação do dia a dia e não conta como correção. A mesma
regra vale para a rotina de período e para qualquer outro caminho de escrita
(P10). "Hoje" é `America/Sao_Paulo` (`private.fidelization_today()`).

### 17.7 Motoristas

* O motorista é colaborador oficial (`employees`); planejar motorista não
  cria conta nem mexe no perfil de acesso de ninguém.
* Uma BR pode ter principal e secundário; o mesmo colaborador não pode ser
  principal em duas BRs no mesmo dia (M3).
* Substituir (`substitute_fidelization_driver`) encerra o anterior na
  véspera e abre o novo na mesma BR, numa transação (M1).
* Encerrar pede data e motivo; data anterior ao início cancela o vínculo em
  vez de encerrá-lo, e a tela avisa antes.

### 17.8 Replicação

`replicate_fidelization_competence` copia a competência de origem para a de
destino sem sobrescrever o que o destino já tem; o diálogo mostra a prévia
linha a linha (BR, veículo, situação) antes de gravar. Repetir não
duplica (M4: 88 vínculos na primeira vez, 0 na segunda) e replicar não gera
mobilização — o mesmo veículo continuando na mesma BR não é troca.

### 17.9 Histórico de mobilizações

Tabela `public.fidelization_movements`: um evento por alteração efetiva, com
BR, operação, estado, cidade, liderança na data, veículo e motorista
anteriores e novos, período, motivo, origem (`user`, `import`, `replication`,
`system`, `reconstructed`), ator (`actor_user_id`) e hora do registro.

Os eventos são escritos por gatilhos de constraint **diferidos para o
commit** — a classificação vê a transação inteira (uma inversão são duas
linhas com a mesma `correlation_key`) e uma chave de deduplicação única
impede o mesmo evento duas vezes.

| Tipo | Regra |
|---|---|
| Primeira alocação | a BR nunca teve titular antes |
| Alocação de veículo | a BR teve titular, mas não na véspera |
| Substituição de veículo | vínculo novo ligado ao substituído; ou, sem ligação, outro titular terminou na véspera (marcada como inferida) |
| Inversão de placas | vínculo novo de origem `inversion` |
| Retorno de veículo | o mesmo veículo já esteve na BR antes |
| Remoção de veículo | o titular sai e volta depois, sem ninguém no intervalo |
| Encerramento de vínculo | o titular sai e não há sucessor |
| Vinculação, substituição e encerramento de motorista | idem, para `fidelization_drivers` |
| Correção administrativa | troca de veículo/colaborador, início ou fim estendido num vínculo existente |
| Cancelamento de planejamento | vínculo cancelado sem sucessor |

* O mesmo veículo continuando no dia seguinte (divisão de período,
  replicação, base mensal) não é evento.
* **Imutável**: sem permissão de escrita para ninguém e um gatilho que recusa
  UPDATE e DELETE até para o dono da tabela (P9). Correção é um evento novo.
* Os 239 vínculos anteriores à etapa foram reconstruídos como eventos
  (88 primeiras alocações, 117 substituições inferidas, 34 retornos), com
  origem `reconstructed`; a tela mostra quantos há no recorte.
* Filtros: período, operação, estado, cidade, BR, liderança na data, tipo,
  assunto (veículo ou motorista), placa ou frota e motorista; 50 por página.
  Exportação XLSX/CSV com os mesmos filtros (`tipo=mobilizacoes`), auditada.

### 17.10 Indicadores e fórmulas

Recorte: competência + operação, estado e cidade do cabeçalho.

| Indicador | Fórmula |
|---|---|
| BRs cadastradas | BRs da organização no recorte, ativas ou não (`deleted_at is null`) |
| BRs (ativas) | BRs ativas no recorte |
| BRs com / sem veículo | com pelo menos um dia de titular na competência / o resto |
| BRs com / sem motorista | com pelo menos um motorista principal na competência / o resto |
| Veículos fidelizados | veículos distintos titulares em algum dia da competência |
| Motoristas fidelizados | colaboradores distintos vinculados em algum dia da competência |
| Trocas de veículo (substituições) | vínculos novos na competência ligados a um substituído, fora inversões |
| Inversões | ⌈linhas de inversão ÷ 2⌉ — uma inversão troca duas placas |
| Mobilizações | substituições + inversões, registradas e inferidas (par recíproco inferido = 1 inversão) |
| Trocas de motorista | motoristas principais que começam na competência logo após outro na mesma BR |
| Estabilidade da frota | 1 − BRs com troca de veículo (explícita ou inferida, cada BR uma vez) ÷ BRs com veículo |
| Estabilidade dos motoristas | 1 − BRs com troca de motorista ÷ BRs com motorista |
| Cobertura de liderança | BRs com liderança na data âncora ÷ BRs |

Os recortes por operação, cidade, liderança, estado e tipo de equipamento
usam as mesmas colunas. O retorno do veículo depois de uma substituição
temporária não conta como segunda mobilização (P3).

### 17.11 Importação

* XLSX ou CSV, validado antes de gravar (Etapa 13). Sem teto de linhas desde
  a migration `20260925100000`: o arquivo é lido no navegador e enviado,
  validado e gravado em partes — ver
  [`importacao-exportacao-sem-limite.md`](../architecture/importacao-exportacao-sem-limite.md).
* **Mapeamento de colunas (Etapa 15)**: ao escolher o arquivo, a gaveta lê
  os cabeçalhos (`inspectFidelizationFile`, no navegador), sugere o campo de cada coluna pelos
  nomes aceitos e deixa trocar, ignorar ou aplicar um layout salvo. Campos
  obrigatórios faltando ou um campo em duas colunas impedem validar.
* **Layouts salvos**: `public.import_layouts` (por organização e tipo de
  arquivo; chave = cabeçalho normalizado). Leitura pela RLS com
  `fidelization.import`; gravação só por `save_import_layout` (o mesmo nome
  atualiza) e `delete_import_layout`, com `fidelization.manage_brs` também
  para o arquivo de BRs. Auditados. O layout não grava dados.
* BRs, veículos e colaboradores desconhecidos não são criados; conflitos e
  sobreposições ficam de fora da gravação; o mesmo arquivo (mesmo hash)
  importado de novo é avisado na prévia (Etapa 13).
* A importação não altera perfil, papel nem permissão de ninguém.
* **Troca registrada (20260930110000)**: quando a linha importada é titular e
  a mesma BR tinha outro veículo titular até a véspera, o vínculo criado aponta
  o anterior (`replaces_assignment_id`) e nasce com `source = 'substitution'`
  — ou `'inversion'` quando o veículo novo saiu, na véspera, de uma BR que
  recebe o veículo antigo no mesmo dia (já gravado ou pendente no mesmo lote).
  O histórico registra "Substituição de veículo" / "Inversão de placas" com
  origem `import`, o lote e o arquivo nos detalhes. As linhas são gravadas em
  ordem de início, e o resumo do lote conta `linked_substitutions` e
  `linked_inversion_rows`. A importação não cria veículo nem vínculo fora do
  que o arquivo traz e não altera vínculos existentes além do que já fazia.
* A área Importação lista os lotes (`fidelization_import_history`, com
  `fidelization.import` ou `fidelization.audit`) com as contagens e os erros.

### 17.11b Exportar a base dos Planners

Menu **Exportar › Base dos Planners › Frotas ou motoristas, com filtros…**
(permissão `fidelization.export`). Um diálogo monta o recorte e baixa o arquivo
pela rota `/governanca/fidelizacao/export` (`tipo=base-frotas` ou
`base-motoristas`), com a mesma auditoria das outras exportações
(`log_fidelization_export`, tipo `base-frotas-periodos`, `base-frotas-diario`,
`base-motoristas-periodos` ou `base-motoristas-diario`).

| Filtro | Parâmetro | Regra |
|---|---|---|
| Período | `de`, `ate` (aaaa-mm-dd) | entra o vínculo cujo período toca o intervalo; sem datas, a base inteira |
| Placa ou frota | `placa` | parte da placa ou do código de frota, sem diferenciar caixa nem hífen |
| BR | `br_codigo` | código exato |
| Operação | `operacao` | a operação da BR |
| Local | `uf`, `cidade` | UF e cidade da BR |
| Arquivo | `format` | `xlsx` ou `csv` |

Dois formatos de linha (`layout`):

* **Um registro por vínculo** (`periodos`): o vínculo inteiro (início, fim,
  situação, origem, troca registrada, motivos) e o pedaço dele dentro do período
  (início, fim e dias no período). Frotas: operação, UF, cidade, BR,
  liderança no fim do período, frota, placa, tipo de equipamento, marca/modelo,
  titular ou apoio. Motoristas: matrícula, nome, função (principal ou
  secundário) e o veículo do vínculo.
* **Grade diária** (`diario`): uma linha por BR e dia, como o Planner mostra —
  para montar tabelas dinâmicas no Excel. Exige as duas datas e aceita até 366
  dias; vínculos cancelados ficam de fora.

As linhas vêm das mesmas leituras `security invoker` da Central
(`fidelization_directory` e `fidelization_drivers`), lidas página a página, sem
teto: o arquivo só traz o que o perfil de quem exporta enxerga.

### 17.12 Integrações

| Módulo | Integração |
|---|---|
| BRs | a Central só lê `operation_brs`; o cadastro continua em Governança › BRs |
| Lideranças | liderança por BR na data (`br_leadership_at`), gravada em cada evento |
| Frotas | veículo precisa estar ativo, do tipo admitido pela operação e na organização (`assert_vehicle_fidelizable`); fidelizar não muda a alocação do veículo |
| Usuários | motorista é colaborador; nada muda perfil de acesso |
| Aderência | as obrigações seguem o vínculo do dia: depois de uma inversão os dias seguintes trocam de BR e o dia anterior fica como estava (M6) |
| Check List | cada execução grava BR, liderança e veículo da data |
| Planos de Ação | módulo ainda não existe (§14) |

### 17.13 Permissões

As permissões pedidas na etapa foram ligadas às que o HFM já tinha — uma
nova só onde não havia equivalente:

| Pedido na etapa | Permissão no HFM |
|---|---|
| `fidelization.view`, `view_dashboard`, `view_vehicle_planner`, `view_driver_planner`, `view_movements` | `fidelization.view` |
| `edit_vehicle_planner`, `replicate_planning` | `fidelization.plan` |
| `swap_vehicles` | `fidelization.change_vehicle` |
| `edit_driver_planner`, `replace_driver` | `fidelization.change_driver` |
| `import` | `fidelization.import` |
| `export` | `fidelization.export` |
| `view_audit` | `fidelization.audit` |
| `manage_historical_data` | **`fidelization.manage_historical_data`** (nova; padrão em Administrador e Gestor de Frota) |

A tela esconde o que a pessoa não pode fazer, mas quem decide é o banco:
toda rotina confere a permissão e o escopo, e nenhum acesso é dado pelo nome
do perfil.

### 17.14 RLS e segurança

* `fidelization_movements`: leitura com `fidelization.view` **e** BR no
  escopo de operação; nenhuma permissão de escrita; imutável.
* `import_layouts`: leitura com `fidelization.import`; escrita só pelas
  rotinas.
* As leituras novas (`fidelization_planner_matrix`,
  `fidelization_movements_list`) rodam com o cliente da pessoa; as rotinas
  `security definer` (`apply_fidelization_period`,
  `fidelization_import_history`, `save_import_layout`,
  `delete_import_layout`) conferem permissão, organização e escopo antes de
  qualquer coisa.
* Organização trocada, BR de outra organização ou fora do escopo: "não
  encontrada" (S2, S3).

### 17.15 Testes

| Suíte | Resultado (23/09/2026) |
|---|---|
| SQL 15 — planner e mobilizações (P1–P10) | 10/10 |
| SQL 15 — motoristas, replicação, liderança, aderência (M1–M6) | 6/6 |
| SQL 15 — perfis, escopo e organização (S1–S6) | 6/6 |
| SQL 15 — layouts da importação (L1–L6) | 6/6 |
| SQL 11, 11b, 13, 13b, 13c (regressão) | 74/74 |
| Playwright — suíte completa (prévias sem sessão) | 152 aprovados, 8 pulados (exigem login real) |

### 17.16 Migrations

* `20260924100000_fidelization_central.sql` — histórico de mobilizações,
  correção histórica, edição por período, leituras, estabilidade, histórico
  de importações.
* `20260924110000_fidelization_import_layouts.sql` — layouts salvos.
* `20260930100000_fidelization_stability_inferred_changes.sql` — a BR com
  troca inferida conta para a estabilidade da frota.
* `20260930110000_fidelization_import_links_changes.sql` — a importação liga
  a troca ao vínculo anterior (substituição ou inversão, origem `import`).
* `20260930120000_fidelization_mobilizations_inferred.sql` — as trocas
  inferidas entram nas mobilizações (par recíproco = 1 inversão).

## 18. Correção: a Central não abria (24/09/2026)

`listDriverPlans` embutia `operations(name), cities(name), states(uf)` a partir
de `operation_brs`, que só tem chave estrangeira para `operation_cities` — o
PostgREST respondia 400 (PGRST200) e, como a leitura não tinha guarda, a página
inteira caía em "This page couldn't load". A leitura agora segue
`operation_brs → operation_cities → cities → states` pelas chaves existentes
(com o nome da chave explícito), e o nome da operação vem de uma consulta
própria. Se a leitura falhar de novo, só o Planner de Motoristas avisa — o
resto da página continua. Os selects novos foram validados num PostgREST
12.2.3 local com o mesmo grafo de chaves estrangeiras de produção.

A mesma causa (`states(uf)` a partir de `operation_cities`) deixava vazios os
filtros de Estado e Cidade da Fidelização, das BRs, das Lideranças e da
Aderência — `getGovernanceOptions` agora lê `cities → states` e registra o erro
em vez de engoli-lo.

---

## 19. Competência mensal contínua (Frota × BR × Local)

Migration `20261002106000_fidelization_competences.sql` · suíte SQL 27 ·
Playwright `fidelization-competence.spec.ts`.

### 19.1 A regra

* A competência é o **mês do calendário**. Ao virar o mês, a posição vigente
  no **último dia** do mês anterior vira a posição inicial do novo mês
  (30/09/2026 → Outubro/2026), em **vínculos mensais novos** (1º ao último
  dia). Nenhum vínculo anterior é estendido, alterado ou apagado.
* As mudanças do mês seguem pelas rotinas de sempre (substituir, inverter,
  encerrar, edição por período). A replicação seguinte lê o último dia
  (31/10 → Novembro): quem foi substituído em 15/10 sai, o substituto entra.
* **Lideranças não são lidas nem escritas** pela replicação.

### 19.2 Um motor, dois gatilhos

`private.fidelization_replicate(org, origem, destino, motoristas, prévia,
modo, situação, operação, escopo)` é a única implementação; não confere
permissão (quem chama confere) e trava a competência de destino
(`pg_advisory_xact_lock`).

| Gatilho | Como | Situação dos vínculos |
|---|---|---|
| **Automático** | `private.fidelization_competence_tick()` pelo pg_cron (`hfm_fidelization_competence_tick`, `7 3 * * *` = 00:07 BRT, diário). Para cada organização ativa, no mês corrente do fuso dela: só roda se **não existe cabeçalho** da competência e o mês anterior tem titulares no último dia. Uma vez criada, nunca roda de novo. | `confirmed` |
| **Manual** | "Replicar competência" → `replicate_fidelization_competence` (mesma assinatura e permissões de antes: `fidelization.plan`, `+change_driver` para motoristas, escopo de operação). | `confirmed` no mês corrente, `planned` nos demais |

Classificação (prévia = execução): **nova** · **já existente** (mesma placa na
mesma BR no destino) · **conflito** (BR ocupada por outro veículo, ou veículo
em outra BR) · **ignorada** (BR ou veículo inativo). A resposta traz também
`reference_date`, `plates_found` e `already_created`.

**Idempotência.** Nunca duplica placa × competência × BR. Se o destino já foi
criado, o diálogo diz quando, por quem e de que jeito ("A competência
Outubro/2026 já foi criada em 01/10/2026 00:07 por Rotina automática
(Replicação automática). Nenhum registro será duplicado.") e o botão vira
**Complementar (N placas)** — desabilitado com N = 0. Complementar mantém a
origem do cabeçalho, soma `runs` e troca `last_run`.

Mês corrente já começado: a complementação manual desde o dia 1º passa pelo
`fidelization_historical_guard` (exige `fidelization.manage_historical_data`).
A rotina automática não tem usuário e não passa por ele.

### 19.3 Origem

`source` continua `'replication'` para as duas replicações (a constraint
`fidelization_source_check` não mudou). Quem gravou distingue:

| Rótulo | Regra (`private.fidelization_origin_label`, `fidelizationOriginLabel`) |
|---|---|
| Importação histórica | `source = 'import'` |
| Replicação automática | `source = 'replication'` e `created_by` nulo (rotina) |
| Replicação manual | `source = 'replication'` e `created_by` preenchido |
| Alteração manual | `manual`, `substitution`, `inversion` (o tipo aparece junto) |

Auditoria: cada vínculo criado passa pelo `tg_audit` (quem, quando, BR,
veículo, origem); o cabeçalho também (cada execução, com as contagens); os
eventos do Histórico de Mobilizações carregam `details.replication = auto |
manual` e a competência, e a tela e a exportação dizem "Replicação
automática/manual".

### 19.4 Cabeçalho e situação

`public.fidelization_competences` (uma linha por organização × mês): tipo
(`historical` até 12/2025, `operational` a partir de 01/2026 — constraint),
origem (`historical_import`, `auto_replication`, `manual_replication`,
`manual`), competência de origem, data de referência, `last_run`, `runs`.
Sem DELETE (gatilho), competência/tipo/origem imutáveis, auditado, leitura
pela RLS com `fidelization.view`, escrita só pelas rotinas. As competências
01–09/2026 receberam cabeçalho `historical_import` (vieram da importação de
2026).

A **situação** é derivada, nunca gravada: Histórica (consulta) · Encerrada
(mês passado) · Em andamento (mês corrente) · Planejada (mês futuro) · Não
criada (sem cabeçalho e sem vínculos).

`fidelization_competence_summary(org, ano, mês)` devolve tipo, situação,
origem, competência de origem, data de referência, placas, BRs, locais
(operação × cidade) e operações **no escopo de quem consulta**, a última
atualização (cabeçalho, vínculos do mês e eventos do mês) com o nome de quem
fez, e o mês anterior (data de referência e placas encontradas). A Central
mostra isso na **faixa da competência**, abaixo do seletor, em todas as áreas.

### 19.5 Histórico 2024/2025 — somente consulta

`public.fidelization_history_positions`: a posição consolidada de cada placa
em cada mês (operação, UF, cidade, BR quando houver, primeiro e último dia,
dias), imutável (`tg_block_mutation`), com RLS por permissão **e** operação
(`operation_id in (select private.accessible_operation_ids())`, avaliado uma
vez por consulta). **Nunca recalculado e nunca usado para recriar vínculos**:
o motor recusa origem ou destino antes de 01/2026.

* **BR ausente é NULL de verdade** — `"-"`, `"BR 000"`, `"Sem BR"`, `"Não
  informado"` viram NULL na carga, e uma constraint recusa marcadores. A tela
  escreve "—".
* 2024 (sem BR): Operação → Cidade → Placas. 2025 (com BR): Operação → BR →
  Local/Cidade → Placas, com filtro por BR (inclusive "Sem BR"). O
  agrupamento segue o dado do mês.
* Na Central, uma competência histórica abre a área **Histórico
  consolidado** (no lugar do Planner de frotas), com filtros por operação,
  cidade, BR e placa, grupos recolhíveis e a **Evolução do ano**
  (`fidelization_history_evolution`: placas, BRs, locais e mudanças por mês).
* Carga: `import_fidelization_history(org, linhas, lote, prévia)` — exige
  `fidelization.import` **e** `fidelization.manage_historical_data`; linhas
  `{competence 'AAAA-MM', plate, fleet_code, operation, uf, city (nome ou
  IBGE), br_code, first_day, last_day, days}`; veículo pela placa normalizada
  (nunca cria veículo), operação pelo nome sem acento/caixa ou código, cidade
  pelo IBGE ou nome + UF, BR pelo código na operação + cidade (não achou:
  grava só o código e avisa); recusa 2026 em diante; idempotente (competência,
  veículo, primeiro dia); devolve inseridas, duplicadas, avisos e erros com
  exemplos. Nunca toca `fidelization_assignments`.

### 19.6 Testes

| Suíte | Resultado (01/10/2026, banco local) |
|---|---|
| SQL 27 — C1–C13 (prévia, rotina sem usuário, idempotência, complemento, troca no meio do mês, lideranças intactas, origem, histórico, RLS, permissões) | 13/13 |
| SQL 13c (C10 atualizado: BR planejada com outro veículo = conflito) e 15 (M4) em base sintética | iguais à base sem a migration, exceto C10 (mudança intencional) |
| Playwright `fidelization*.spec.ts` | 56/56 |
