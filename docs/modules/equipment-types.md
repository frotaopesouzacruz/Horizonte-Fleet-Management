# Gestão de frota · Tipos de equipamento

Rota: `/frota/tipos-equipamento` · Permissão de entrada: `equipment_types.view`

O catálogo que classifica a frota. Um tipo de equipamento diz **o que o veículo
é**; a parametrização do tipo diz **onde ele pode ser usado e quem o enxerga**.
Nenhum módulo do HFM cria a sua própria lista de tipos: todos referenciam
`vehicle_types.id`.

---

## 1. Reaproveitamento, não um catálogo novo

A tabela `vehicle_types` já existia desde a Etapa 01 e já era referenciada por
`vehicles.vehicle_type_id`. A Etapa 07 **estendeu** essa tabela em vez de criar
um cadastro concorrente. Os veículos cadastrados na Etapa 06 continuam
classificados pelos mesmos registros, com os mesmos `id`.

O que a tabela ganhou:

| Coluna | Para quê |
|---|---|
| `organization_id` | nulo = catálogo base da plataforma; preenchido = tipo da organização |
| `description` | texto livre, até 500 caracteres |
| `created_by` / `updated_by` | autoria |
| `deleted_at` / `deleted_by` | arquivamento, nunca exclusão física |

O catálogo base (6 tipos, `organization_id is null`) é **compartilhado**: toda
organização o enxerga e pode parametrizá-lo para si, mas nenhuma pode renomeá-lo
ou descrevê-lo — isso mudaria o catálogo das outras.

---

## 2. Código

Gerado pelo sistema no formato `EQ-00001`, sequencial **por organização**, e
imutável depois de gravado.

A numeração não usa `MAX() + 1`. Vem de `private.next_entity_code`, que faz um
`insert ... on conflict do update ... returning` sobre `private.entity_code_counters`:
dois administradores cadastrando ao mesmo tempo recebem números diferentes
porque a segunda transação espera a primeira na mesma linha do contador.

A imutabilidade é do banco, não da tela: o gatilho
`vehicle_types_code_immutable` recusa qualquer `update` que mexa em `code`.

O `check` do código aceita as duas formas que existem de verdade — o slug do
catálogo base (`van`, `truck`, …) e o sequencial da organização (`EQ-00001`).

---

## 3. Nome

Único ignorando caixa, espaços repetidos e acentuação: `"Van"`, `"van"` e
`"Van "` são o mesmo nome. A comparação usa `private.normalize_label`, a mesma
do resto do sistema.

A unicidade tem duas camadas, porque uma só não bastava:

```
vehicle_types_global_name_key  unique (normalize_label(name)) where organization_id is null     and deleted_at is null
vehicle_types_org_name_key     unique (organization_id, normalize_label(name)) where ... is not null and deleted_at is null
```

Os dois índices cobrem cada escopo separadamente, e nenhum deles impediria uma
organização de criar "Van" ao lado da "Van" do catálogo base — para quem usa a
tela, seriam dois tipos com o mesmo nome na mesma lista. Por isso
`private.assert_type_name_available` confere os **dois escopos** antes de
gravar.

---

## 4. Tipo físico e finalidade de uso

São perguntas diferentes e o modelo as mantém separadas:

- **O tipo físico** é o registro em `vehicle_types`: Van, Caminhão, Moto. Não
  muda conforme o cliente, a operação ou o contrato.
- **A finalidade de uso** é a parametrização do tipo dentro da organização:
  quais operações o admitem (`vehicle_type_operations`), quais aplicativos o
  acompanham (`vehicle_type_apps`) e quais módulos o consideram
  (`vehicle_type_module_rules`).

A mesma Van é entrega numa operação e apoio administrativo noutra sem virar dois
tipos. A subcategoria (§5) detalha o tipo físico; a parametrização descreve o
uso.

---

## 5. Subcategorias

Uma subcategoria pertence a **um** tipo (`vehicle_subcategories.vehicle_type_id`)
e o vínculo é garantido no banco: `vehicle_subcategories` tem `unique (id, vehicle_type_id)`
e `vehicles` referencia o par `(vehicle_subcategory_id, vehicle_type_id)` por
chave estrangeira composta. Escolher "Van" + "Cavalo mecânico" é recusado pelo
banco, não apenas escondido pelo select.

Subcategorias são **opcionais**. A obrigatoriedade é uma regra explícita da
organização — `vehicle_type_settings.requires_subcategory` — e não a
consequência de existir alguma subcategoria cadastrada em algum momento.

Subcategoria em uso não é apagada. Ao remover uma da lista no formulário, ela é
**inativada** (`is_active = false`), continua classificando os veículos que já
classificava e some das listas de novo cadastro. A exclusão física é bloqueada
em duas camadas: não há política de `delete` (a RLS recusa, afetando 0 linhas) e
a chave estrangeira de `vehicles` recusaria de qualquer forma (`23503`).

---

## 6. Operações vinculadas

`vehicle_type_operations` liga o tipo a operações por `operations.id`. A chave
estrangeira é composta — `(organization_id, operation_id)` → `operations (organization_id, id)`
— então um tipo da organização A não consegue apontar para uma operação da
organização B: o banco recusa com `23503`.

**A ausência de vínculos não é autorização implícita.** O significado de "nenhuma
operação vinculada" é dito em voz alta por `vehicle_type_settings.operation_restriction_enabled`:

| `operation_restriction_enabled` | Significado |
|---|---|
| `false` (padrão) | sem restrição: o tipo pode ser alocado em qualquer operação |
| `true` | só as operações listadas admitem o tipo — lista vazia significa nenhuma |

`public.vehicle_type_allows_operation(org, type, operation)` é a função que
responde, e é ela que a alocação consulta.

---

## 7. Aplicativos

`operational_apps` é o cadastro oficial de aplicativos da organização e foi
criado **vazio**. O Gerenciador de Aplicativos não existe nesta etapa e nenhum
aplicativo fictício foi inventado para preencher a interface: a aba mostra um
estado vazio honesto.

`vehicle_type_apps` já é o vínculo que o módulo futuro reutilizará, com chave
estrangeira composta `(app_id, organization_id)` para que o aplicativo e o tipo
sejam sempre da mesma organização. O vínculo é opcional.

---

## 8. Elegibilidade dos módulos

Um único checkbox "usa o módulo" seria uma resposta para três perguntas
diferentes. `vehicle_type_module_rules.capability` distingue:

| Capacidade | Pergunta |
|---|---|
| `visibility` | o módulo **pode consultar** os veículos deste tipo? |
| `operation` | os veículos deste tipo são **elegíveis** às rotinas do módulo? |
| `indicator` | os veículos deste tipo **entram no indicador** calculado pelo módulo? |

Uma não implica a outra: um veículo administrativo pode ser consultável pelo
Checklist sem entrar no cálculo de aderência.

**Nenhum módulo é vinculado automaticamente.** Sem regra configurada,
`public.vehicle_type_module_eligibility` responde `false`: nada é elegível por
omissão.

`operational_modules` lista os cinco módulos previstos (`checklist`,
`adherence`, `maintenance`, `tyres`, `fueling`), todos com
`is_available = false` — a regra pode ser configurada hoje, e a tela diz que o
módulo ainda não existe em vez de prometer um comportamento que ninguém
implementou.

### Vigência

Mudar a regra hoje não reescreve o indicador de agosto. Cada regra tem
`effective_from` / `effective_to`:

- ao alterar uma regra, a anterior é **fechada** em `current_date - 1` e uma
  nova é aberta em `current_date` (se a alteração é do mesmo dia, a linha é
  corrigida no lugar, sem criar um período de duração zero);
- `vehicle_type_module_eligibility(..., p_on_date)` lê a regra que valia na data
  pedida;
- um índice único parcial garante uma única regra vigente por
  `(organização, tipo, módulo, capacidade)`, e um gatilho recusa períodos
  sobrepostos.

---

## 9. Análise de impacto

A análise é real: conta linhas. Nenhuma das funções devolve `[]`, `0` ou `null`
como resultado fictício.

| Função | Responde |
|---|---|
| `equipment_type_impact(org, type)` | veículos do tipo, por situação, por operação atual, subcategorias em uso |
| `equipment_subcategory_impact(org, subcategory)` | veículos que usam a subcategoria |
| `equipment_type_operation_impact(org, type, operation_ids[])` | veículos que seriam afetados ao remover operações do vínculo |

Quando a dependência não existe nesta etapa — checklist, manutenção, pneus,
abastecimento — o resultado não é zero. É **"Não disponível nesta etapa"**:
dependências desconhecidas não são dependências ausentes, e a tela diz isso em
vez de tranquilizar quem está prestes a inativar um tipo.

---

## 10. Inativação e exclusão

| Situação | O que acontece |
|---|---|
| Tipo da organização inativado | `vehicle_types.is_active = false` |
| Tipo do catálogo base desligado | `vehicle_type_settings.is_enabled = false` — só para essa organização |
| Subcategoria removida da lista | `is_active = false`, nunca `delete` |

Inativar um tipo **não muda a situação de nenhum veículo**. O tipo sai das
listas de cadastro novo e continua classificando quem já classificava. Isso vale
em todos os caminhos:

- `private.assert_type_usable` recusa um tipo inativo num cadastro novo e o
  aceita na edição de um veículo que já o usava;
- `private.tg_vehicle_type_rules` (gatilho em `vehicles`) só cobra a regra na
  inserção ou quando a classificação muda;
- `private.tg_assignment_type_eligibility` roda **apenas no insert** de
  `vehicle_operation_assignments`, para que nenhuma alocação histórica seja
  desfeita por uma configuração feita depois.

Exclusão física é bloqueada enquanto houver dependência, pelas chaves
estrangeiras `on delete restrict` e pela ausência de políticas de `delete`.

---

## 11. Integração com o cadastro de frotas

| Ponto | Comportamento |
|---|---|
| Formulário de veículo | lista apenas tipos utilizáveis; um tipo inativo continua visível se já é o tipo daquele veículo |
| Subcategoria | o campo vira obrigatório quando `requires_subcategory` está ligado, validado no servidor |
| Tipo × subcategoria | chave estrangeira composta no banco |
| Alocação | `set_vehicle_assignment` consulta `vehicle_type_allows_operation` e recusa com mensagem que nomeia o tipo e a operação |

A mensagem de recusa diz qual tipo e qual operação, porque "não permitido"
sozinho não ajuda ninguém a resolver.

---

## 12. Permissões, RLS e escrita

Nove permissões, todas com prefixo `equipment_types.`:

```
equipment_types.view                 ver o catálogo
equipment_types.create               criar tipo
equipment_types.update               editar tipo
equipment_types.deactivate           inativar / reativar
equipment_types.manage_subcategories manter subcategorias
equipment_types.manage_operations    vincular operações
equipment_types.manage_apps          vincular aplicativos
equipment_types.manage_eligibility   configurar elegibilidade de módulos
equipment_types.view_audit           ver o histórico
```

Matriz padrão: Gestor de Frota e Administrador recebem todas; Liderança de
Operações e Gestão recebem leitura.

As tabelas têm RLS ligada e **apenas políticas de `select`**. Não existe
política de `insert`, `update` ou `delete` para `authenticated`: toda escrita
passa pelas rotinas `security definer`, que conferem a permissão da seção
correspondente antes de tocar em cada bloco. Um `insert` direto no vínculo é
recusado com `42501`.

A leitura é multi-tenant: o catálogo base é visível para todos, o tipo de uma
organização é visível só para ela. A política anterior de `vehicle_types` era
`using (true)` — correta enquanto a tabela só tinha linhas globais, e um
vazamento no instante em que passasse a ter linhas de organização. Foi
reescrita.

---

## 13. Transação e concorrência

`public.save_equipment_type(org, payload)` grava **tudo numa transação**:
identificação, parâmetros, subcategorias, operações, aplicativos e regras de
módulo. Se qualquer bloco falha, nada é gravado.

- Uma chave **ausente** no payload significa "não mexa nisso"; uma chave
  presente com lista vazia significa "esvazie".
- Bloqueio otimista: o payload carrega `expected_updated_at`; se o registro
  mudou desde que a tela o carregou, a rotina levanta `serialization_failure`
  em vez de sobrescrever o trabalho de outra pessoa.

---

## 14. Auditoria

Todas as tabelas do módulo têm gatilho `private.tg_audit`, que grava em
`audit_logs` quem mudou, o que mudou e quando. `public.equipment_type_history`
lê esse histórico para a aba do formulário.

Ver o catálogo não é ver quem o mudou: a aba **Histórico** exige
`equipment_types.view_audit`, conferida no servidor antes da chamada, e some
para quem não a tem. Por cima disso a função é `security invoker` — a política
de `audit_logs` exige `audit.view` na organização, e quem não enxerga a
auditoria não passa a enxergá-la por este caminho.

---

## 15. Migrations desta etapa

```
20260921100000_equipment_types_foundation.sql      colunas, código imutável, contador, unicidade, política de leitura
20260921101000_equipment_type_parameters.sql       settings, operações, aplicativos, módulos, regras com vigência
20260921102000_equipment_types_rbac_rls.sql        9 permissões, matriz padrão, políticas de select
20260921103000_equipment_type_impact.sql           análises de impacto e funções de elegibilidade
20260921103500_equipment_type_name_guard.sql       unicidade de nome entre os dois escopos
20260921104000_equipment_type_rpcs.sql             save_equipment_type e as rotinas de situação
20260921105000_equipment_type_read_model.sql       listagem, KPIs, detalhe e histórico
20260921106000_equipment_type_fleet_integration.sql gatilhos em vehicles e a alocação com elegibilidade
```

---

## 16. Pendências

- **Aplicativos**: `operational_apps` está vazia por decisão. O Gerenciador de
  Aplicativos é de outra etapa; até lá a aba mostra estado vazio.
- **Módulos**: os cinco estão marcados `is_available = false`. As regras são
  configuráveis e ainda não há consumidor que as leia.
- **Impacto de módulos**: enquanto os módulos não existem, a análise responde
  "Não disponível nesta etapa" — e não zero.
