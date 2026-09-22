# Governança operacional · Fidelização

Rota: `/governanca/fidelizacao` · Permissão de entrada: `fidelization.view`

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
| BR com troca | BR com pelo menos uma troca no mês — conta **uma** vez |
| estabilidade da frota | 1 − BRs com troca / BRs com veículo |
| troca de motorista | motorista principal iniciado no mês cujo antecessor no mesmo BR terminou na véspera |
| estabilidade de motoristas | 1 − BRs com troca de motorista / BRs com motorista |
| cobertura de lideranças | BRs ativas com liderança na data-âncora / BRs ativas |
| movimentação inferida | troca de titular observada entre vínculos consecutivos **sem** `replaces_assignment_id` — mostrada à parte, nunca somada às mobilizações |

Por que a distinção: no HFC, "mobilizações" misturava linhas explícitas com
trocas derivadas do grid, uma edição de N dias gerava N linhas idênticas, e
sob filtro a taxa podia ficar negativa (mapeamento §3 e §7, problemas 04 e
05). Aqui a substituição e a inversão são as únicas fontes de "mobilização",
cada uma é **uma** transação e **uma** linha por BR, e a base histórica — que
chegou por importação e tem 16 trocas de titular sem evento — aparece como
"inferida", em número separado, para ninguém somar duas vezes.

Nos recortes por operação, local e liderança, cada grupo conta os eventos que o
tocaram; uma inversão entre BRs de cidades diferentes aparece nas duas cidades
(cada uma teve uma BR trocada), então a soma dos recortes pode exceder o total.

Faixas de cor (a mesma escala nos três cartões): ≥ 95 % verde, ≥ 85 % atenção,
abaixo, alerta. Quando o denominador é zero, o cartão mostra "—", não 0 %.

Prova: suíte 13c, C9 — uma substituição mais uma inversão (duas linhas) dão
2 mobilizações, 3 BRs com troca, e as 16 inferidas ficam de fora.

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
Nunca sobrescreve: o destino já planejado é **preservado**, o veículo já usado
em outra BR no destino é **conflito**, BR ou veículo inativo é **ignorado**;
só o resto é **novo**. A prévia (`dry_run`) não grava e devolve as mesmas
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
