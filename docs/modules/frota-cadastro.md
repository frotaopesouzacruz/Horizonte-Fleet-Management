# Gestão de frota · Cadastro de frotas

Rota: `/frota/cadastro` · Permissão de entrada: `vehicles.view`

O cadastro mestre de veículos do HFM. É a fonte única da verdade sobre a frota:
manutenção, checklist, pneus, abastecimento e quilometragem, quando existirem,
referenciam um veículo pelo seu `id` e não recadastram nenhum.

---

## 1. O que identifica um veículo

Quatro campos, quatro responsabilidades diferentes, e nenhum deles é a chave
primária:

| Campo | O que identifica |
|---|---|
| `fleet_code` | o identificador operacional interno da empresa |
| `license_plate` | o veículo perante trânsito e circulação |
| `vin` | o veículo fisicamente |
| `renavam` | o registro nacional |

A chave primária é um `uuid` (`vehicles.id`). Placa e código de frota mudam;
identidade não.

**Código da frota** é alfanumérico e preserva zeros à esquerda: `000123` não é
`123`. O gatilho `private.tg_normalize_vehicle` aplica `normalize_code`, que
apenas apara e coloca em maiúsculas — nunca converte para número.

**Placa** é persistida normalizada (maiúsculas, sem hífen: `ABC1D23`) e exibida
formatada. A unicidade por organização é um índice parcial no banco, não uma
validação de tela:

```
vehicles_org_license_plate_key   unique (organization_id, license_plate) where license_plate is not null and deleted_at is null
vehicles_org_fleet_code_key      unique (organization_id, fleet_code)    where ...
vehicles_org_vin_key             unique (organization_id, vin)           where ...
vehicles_org_renavam_key         unique (organization_id, renavam)       where ...
```

---

## 2. Classificação

```
vehicle_types  (catálogo corporativo, global)
   └── vehicle_subcategories  (Baú, Sider, Van de carga, Furgão, …)
vehicle_makes
   └── vehicle_models
```

A subcategoria só pode pertencer ao tipo escolhido, e isso é uma FK composta —
não uma verificação de formulário:

```sql
constraint vehicle_subcategories_type_key unique (id, vehicle_type_id)
-- e em vehicles:
foreign key (vehicle_subcategory_id, vehicle_type_id)
  references vehicle_subcategories (id, vehicle_type_id)
```

Escolher "Sedã" para um caminhão não chega a ser gravado, venha de onde vier.

---

## 3. Situação cadastral ≠ situação operacional

`vehicles.status` é **cadastral**: `active` ou `inactive`. Nada mais.

"Em rota", "disponível", "em manutenção", "parado", "sinistrado" são situação
**operacional**, produzida por outros módulos, e o cadastro não a escreve nem a
sobrescreve. Um veículo cadastralmente ativo pode estar em manutenção; as duas
informações convivem porque moram em lugares diferentes.

Toda mudança de situação cadastral gera uma linha em `vehicle_status_history`
com situação anterior, nova, motivo, data e responsável — escrita pelo gatilho
`vehicles_status_history`, não pela aplicação.

---

## 4. Vínculo operacional

```
ORGANIZAÇÃO → OPERAÇÃO → ESTADO → CIDADE
```

A alocação vive em `vehicle_operation_assignments`, com vigência:

```sql
constraint vehicle_assignments_coverage_fkey
  foreign key (organization_id, operation_id, city_id)
  references operation_cities (organization_id, operation_id, city_id) on delete restrict

constraint vehicle_assignments_city_state_fkey
  foreign key (city_id, state_id) references cities (id, state_id) on delete restrict

create unique index vehicle_assignments_current_key
  on vehicle_operation_assignments (vehicle_id) where effective_to is null;

constraint vehicle_assignments_period_check
  check (effective_to is null or effective_to >= effective_from)
```

A primeira FK é o §23 inteiro: uma cidade fora da cobertura da operação não é
gravável, venha do formulário, da importação ou de um `INSERT` direto. A segunda
impede que a cidade e o estado discordem. O índice parcial garante uma única
vigência em aberto, e o gatilho `vehicle_assignments_no_overlap` recusa períodos
sobrepostos.

### Vigente é quem cobre hoje

`vehicle_directory` resolve a alocação **vigente** pelo intervalo que contém
`current_date`, e expõe separadamente a **programada**:

| Coluna | Significado |
|---|---|
| `operation_id`, `city_name`, `state_uf`, `assigned_since` | onde o veículo está hoje |
| `scheduled_operation_name`, `scheduled_city_name`, `scheduled_from` | para onde vai, e a partir de quando |

Tratar "vigente" como "a linha em aberto" fazia uma transferência agendada para
o dia seguinte aparecer como se já tivesse acontecido.

### Transferência

`set_vehicle_assignment(vehicle, operation, state, city, from, reason)` encerra
a vigência anterior em `from - 1` e abre a nova, na mesma transação, com a linha
do veículo travada (`for update`). Se a nova falhar — cobertura inválida,
período sobreposto, data retroativa — a anterior continua de pé. Nunca existe um
instante em que o veículo não está em lugar nenhum.

### Sem alocação ≠ inativo

Um veículo pode ser cadastrado sem operação (§24). Isso é diferente de estar
inativo: ele existe, está ativo, e apenas não pertence a nenhuma operação hoje.
Veículos assim não entram em indicadores que exigem operação definida, e o
acesso a eles é regido por `vehicles.view_unassigned` — ausência de alocação
nunca significa acesso irrestrito.

### Remover uma cidade da cobertura

`vehicles_blocking_coverage_removal(operation, city_ids[])` responde quais
veículos estão hoje — ou já estão programados — nas cidades que se pretende
remover. A FK `on delete restrict` já recusaria a remoção; esta função permite
explicar o motivo antes de alguém tentar e receber um erro de integridade.
Alocações históricas em cidades removidas depois **não** são apagadas.

---

## 5. Quilometragem

O KM atual não é um campo editável. É derivado de `vehicle_odometer_readings`
pela regra determinística "a leitura mais recente que ninguém corrigiu"
(`superseded_by is null`).

A tabela é *append-only* por gatilho: `UPDATE` e `DELETE` são recusados, e a
única coluna que pode mudar é `superseded_by`.

| Fluxo | O que acontece |
|---|---|
| Cadastro com KM inicial | grava uma leitura `source = 'initial_registration'` |
| Cadastro sem KM | **nenhuma leitura**. Ausência não vira zero |
| Correção | grava a leitura certa (`manual_correction`), marca a anterior como superada, exige motivo com ao menos 3 caracteres |
| Importação de um veículo existente | **não altera nada**; divergência vira aviso |

O valor errado continua visível. É o que permite responder "por que o KM caiu
4.000 em março".

---

## 6. Importação

Reaproveita a arquitetura da Etapa 03 — `import_batches` (tipo `vehicles`),
`import_rows`, `import_errors` — em vez de criar um segundo framework.

Fluxo: upload → mapeamento automático por cabeçalho → normalização →
`validate_vehicle_import` → pré-visualização → confirmação →
`process_vehicle_import`. Nada toca `vehicles` antes da confirmação.

### O que a importação NÃO faz

| Não altera | O que acontece em vez disso |
|---|---|
| Identidade técnica de um veículo existente | erro `identity_change` / `identity_conflict`; a linha não entra |
| Alocação operacional | aviso `assignment_divergence` com o valor do arquivo ao lado do vigente |
| Última leitura homologada de KM | aviso `odometer_divergence`, idem |
| Operações, marcas, modelos, centros de custo | erro ou aviso; nada é criado por diferença de escrita |
| Permissões e escopos de usuários | fora do alcance da rotina |

Correspondência com a base usa regra explícita: casa por placa e por código de
frota; se os dois apontam para veículos diferentes, ou se um bate e o outro
diverge, é conflito de identidade e a linha é recusada. Não há aproximação por
semelhança de texto.

### Valores numéricos

`1.234,56`, `1234,56` e `1234.56` são o mesmo valor. O separador que vier por
último é o decimal. Um ponto isolado com exatamente três dígitos depois —
`1.234` — é ambíguo entre pt-BR e en-US: o valor é preservado como está e a
linha recebe um aviso, em vez de o sistema adivinhar.

---

## 7. Exportação

XLSX e CSV, respeitando os filtros ativos. As linhas vêm do mesmo read model
`security_invoker` da tela, então o arquivo só pode conter o que o chamador já
enxergava — a exportação não é uma segunda porta, mais larga, para os dados.
Toda exportação é registrada em `audit_logs` por `log_vehicle_export`.

Também há o **modelo de importação**: um XLSX vazio com as colunas reconhecidas.

---

## 8. Permissões e escopo

| Permissão | O que libera |
|---|---|
| `vehicles.view` | ver a lista e o detalhe |
| `vehicles.create` | cadastrar |
| `vehicles.update` | editar dados cadastrais e situação |
| `vehicles.archive` | arquivar e restaurar |
| `vehicles.import` | importar |
| `vehicles.export` | exportar |
| `vehicles.audit` | ver a auditoria do cadastro |
| `vehicles.manage_assignment` | alocar e transferir |
| `vehicles.correct_odometer` | corrigir quilometragem |
| `vehicles.view_unassigned` | alcançar veículos sem alocação |

### Permissão e escopo são perguntas diferentes

`has_permission(organização, 'vehicles.update')` responde "esta pessoa pode
alterar veículos?". `vehicle_in_scope(organização, veículo)` responde "esta
pessoa pode alterar **este** veículo?". As duas são exigidas, e as duas valem no
servidor.

Separá-las foi um defeito real, encontrado nos testes desta etapa: um Gestor de
Frota com escopo em Merchandising não *enxergava* um veículo do Last Mille MG —
o RLS fazia o seu trabalho na leitura — mas conseguia **inativá-lo**, porque a
rotina de mutação só conferia a permissão de organização. Hoje toda mutação
passa por `private.assert_vehicle_access`, que carrega a organização, trava a
linha e confere as duas coisas. Não há como chamar uma metade.

A mesma auditoria encontrou outras três portas para o mesmo lugar, e elas não
estavam nas rotinas:

- `vehicles_update` conferia só a permissão de organização, então um `UPDATE`
  direto pelo PostgREST — ou a rotina antiga `public.set_vehicle_status`,
  SECURITY INVOKER e concedida a `authenticated` — contornava o escopo. A
  política passou a exigir `vehicle_in_scope`, e a rotina antiga deixou de ser
  executável por `authenticated`.
- `vehicle_assignments_select`, `vehicle_odometer_select` e
  `vehicle_status_history_select` conferiam só `vehicles.view` na organização. O
  veículo sumia da listagem e o seu histórico de alocação, as suas leituras e as
  suas mudanças de situação continuavam legíveis consultando as tabelas
  diretamente. As três políticas passaram a exigir `vehicle_in_scope`.

Fechar a rotina e deixar a política aberta é fechar a porta e deixar a janela.

O escopo de leitura (`private.vehicle_in_scope`) concede acesso quando:

1. o chamador é platform admin; **ou**
2. tem `operations.access_all` na organização; **ou**
3. o veículo tem alocação vigente **ou programada** em uma operação do seu escopo; **ou**
4. o veículo não tem alocação nenhuma **e** o chamador tem `vehicles.view_unassigned`.

Alocação encerrada não devolve acesso: quem teve o veículo no ano passado não o
enxerga hoje.

---

## 9. Exclusão

Não existe exclusão física como fluxo. `archive_vehicle` encerra a alocação
vigente, marca `deleted_at` e preserva tudo: histórico de alocação, leituras,
situação. As FKs `on delete restrict` garantem que também não é possível por
baixo — um `DELETE` direto em `vehicles` com histórico é recusado pelo banco.

`restore_vehicle` traz o cadastro de volta **sem** realocar: reativar o cadastro
é uma decisão, recolocá-lo numa operação é outra. Como um cadastro arquivado não
tem alocação vigente, o escopo por operação não o alcança — restaurar exige
`vehicles.view_unassigned` além de `vehicles.archive`.

---

## 10. Histórico e auditoria

A linha do tempo (`vehicle_timeline`) é uma **view** sobre as quatro fontes que
já registram história, não uma quinta tabela:

| Fonte | O que traz |
|---|---|
| `audit_logs` | o que mudou no cadastro, campo a campo |
| `vehicle_status_history` | situação anterior → nova, com motivo |
| `vehicle_operation_assignments` | cada alocação e sua vigência |
| `vehicle_odometer_readings` | cada leitura, inclusive as superadas |

É `security_invoker`: quem não enxerga `audit_logs` não passa a enxergar por
causa de uma view. Criar uma tabela própria de "eventos do veículo" teria sido
criar uma auditoria concorrente.

---

## 11. Desempenho

- Listagem, filtros, ordenação e paginação são server-side (`range`, `count: exact`).
- Os indicadores são uma única varredura agregada: `vehicle_summary(organização, filtros)`.
- A busca usa `search_text`, já normalizado na view, cobrindo frota, placa, marca, modelo e tipo numa comparação só.
- Os cartões seguem os filtros estruturais e ignoram a busca livre: recontar a frota a cada tecla faria os números piscarem sem informar nada.

---

## 12. Migrations desta etapa

| Arquivo | O que faz |
|---|---|
| `20260920100000_fleet_registration.sql` | subcategorias, campos novos de `vehicles`, chave de cobertura |
| `20260920101000_vehicle_assignment_odometer.sql` | alocação com vigência e leituras append-only |
| `20260920102000_fleet_permissions_rls.sql` | permissões, matriz padrão e escopo de leitura |
| `20260920103000_fleet_read_model.sql` | `vehicle_directory` |
| `20260920104000_fleet_rpcs.sql` | `save_vehicle`, alocação, correção de KM, situação, arquivamento |
| `20260920105000_fleet_summary.sql` | `vehicle_summary`, impacto de cobertura, índices |
| `20260920106000_fleet_assignment_state_integer.sql` | `p_state_id` passa a `integer` (resolução de sobrecarga) |
| `20260920107000_fleet_assignment_validity.sql` | vigente = quem cobre hoje; período nunca invertido |
| `20260920108000_vehicle_import.sql` | staging tipo `vehicles`, validação e processamento |
| `20260920109000_fleet_history_views.sql` | `vehicle_assignment_history`, `vehicle_timeline` |
| `20260920110000_vehicle_export_audit.sql` | `log_vehicle_export` |
| `20260920111000_vehicle_scope_on_mutations.sql` | escopo por operação também na escrita |
| `20260920112000_vehicle_scope_on_policies.sql` | escopo nas políticas de `UPDATE` e nas leituras de histórico |

---

## 13. Pendências

- **`vehicles.view_unassigned` para Gestor de Frota.** A permissão foi acrescentada à **matriz padrão**, que vale para organizações novas e para "restaurar padrões". Os perfis já existentes **não** foram alterados: elevar acesso durante uma migration é o que a Etapa 05 proíbe. Um Administrador que queira que o Gestor de Frota regularize veículos sem alocação concede a permissão em *Administração → Perfis e permissões*, e a alteração fica auditada com o motivo.
- **Aliases de operação na importação.** Não existe tabela de aliases; a correspondência usa nome normalizado e código da operação. Nomes ambíguos viram conflito para resolução manual, nunca uma operação nova.
- **Fornecedor/locadora.** `ownership_type` já distingue próprio, alugado e arrendado, mas não há entidade de fornecedor para vincular. A gestão de contratos de locação não é desta etapa.
- **Custo do escopo em escala.** `private.vehicle_in_scope` é SECURITY DEFINER e portanto não é *inlined*: o planejador a executa por linha avaliada. Com a frota atual isso não aparece; acima de alguns milhares de veículos vale medir e, se necessário, materializar as operações acessíveis do chamador por transação.
- **Elegibilidade em aplicativos.** O cadastro informa os atributos que influenciam elegibilidade (situação, tipo, subcategoria, alocação) e deliberadamente **não** guarda nenhuma marcação própria. Quem resolve é o módulo do aplicativo.
