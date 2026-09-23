# Estrutura operacional · Filiais

Rota: `/estrutura/filiais` · Permissão de entrada: `branches.view`

A unidade organizacional que responde pelos colaboradores e pela frota. É a
dimensão que todos os módulos usam para perguntar "de quem é isto", e não se
confunde com a operação, que responde "o que a empresa faz".

---

## 1. Organização, filial, operação, estado e cidade

Cinco conceitos independentes, e a etapa existe em grande parte para mantê-los
separados:

| Conceito | O que é |
|---|---|
| **Organização** | a empresa cliente do SaaS; o isolamento multi-tenant |
| **Filial** | a unidade administrativa, jurídica ou operacional que responde |
| **Operação** | Last Mile MG, Merchandising, Redespacho — o que a empresa faz |
| **Estado / cidade** | duas coisas diferentes conforme o contexto (abaixo) |

O estado e a cidade **da filial** são o seu endereço físico. A cobertura
geográfica **da operação** é outra coisa, mora em `operation_cities` e foi
definida na Etapa 04. Uma filial em Contagem/MG pode atender uma operação que
cobre meia dúzia de estados, e nada nesta etapa liga uma coisa à outra.

Uma filial atende **várias operações**; uma operação é atendida por **várias
filiais**. A modelagem não impõe um-para-um em direção nenhuma.

---

## 2. Reaproveitamento, não um cadastro novo

`organization_units` já existia desde a fundação e já era referenciada por
`employee_assignments.organization_unit_id`, `vehicles.organization_unit_id`,
`drivers`, `cost_centers` e `work_locations`. A etapa **estendeu** essa tabela.

Criar uma `filiais` ao lado teria sido o cadastro concorrente que a §10 proíbe:
duas respostas para "de que filial é este veículo", e a divergência descoberta
por um relatório errado meses depois.

Colunas acrescentadas:

| Coluna | Para quê |
|---|---|
| `unit_type` | `branch` \| `headquarters` \| `operational` |
| `legal_name` | razão social, opcional |
| `document_number` | CNPJ em dígitos, sem máscara |
| `notes` | observações livres |
| `status_reason` | por que foi inativada ou reativada |
| `postal_code`, `street`, `street_number`, `complement`, `district` | endereço físico |
| `state_id`, `city_id` | município do endereço, provado por FK contra `cities` |

Não existe tabela de endereços reutilizável no HFM, e criar uma para uma única
entidade seria infraestrutura sem segundo usuário. Se outra entidade precisar de
endereço um dia, estas colunas migram juntas.

---

## 3. Código interno

Texto, manual, único dentro da organização. **Zeros à esquerda são
preservados**: `087` e `87` são códigos diferentes, e é assim que a frota
escreve.

A unicidade é `(organization_id, normalize_code(code))` — apara e sobe a caixa,
nada mais. `mg-01` e `MG-01` são o mesmo código; `087` e `87` não são. Duas
organizações independentes podem ter, cada uma, a sua filial `87`.

---

## 4. CNPJ

Opcional (§15): uma unidade operacional sem inscrição própria fatura sob o CNPJ
da matriz, e exigir um CNPJ exclusivo dela seria inventar um fato.

Quando informado: normalizado para dígitos, validado no tamanho e **nos dois
dígitos verificadores** por `private.is_valid_cnpj`, e exibido com máscara. Um
CNPJ inválido nunca vira registro válido — a constraint recusa, venha da tela,
da rotina ou de um POST montado à mão.

> Só o formato numérico vigente é aceito. O CNPJ alfanumérico previsto para 2026
> tem outro algoritmo; ele entra quando houver regra publicada para seguir.

### Unicidade

`unique (organization_id, document_number) where unit_type in ('branch','headquarters')`

Três decisões numa linha:

* **por organização, nunca global** — duas organizações independentes podem
  legitimamente representar a mesma entidade jurídica;
* **só entre entidades jurídicas** — unidades `operational` ficam de fora, para
  que duas bases de uma mesma matriz possam declarar o CNPJ dela;
* **só entre as vivas** — arquivadas não bloqueiam.

---

## 5. Vínculo filial × operação

`organization_unit_operations`, com vigência.

* **Cross-tenant é impossível.** As duas FKs carregam `organization_id`, então
  uma filial da Organização A não alcança uma operação da Organização B nem com
  os ids montados à mão (§23). A validação não depende do front-end.
* **Sem operação é um estado válido** (§24). Uma filial em implantação aparece
  como "Sem vínculo". Ausência de vínculo **nunca** significa acesso a todas as
  operações.
* **Operação inativa não recebe vínculo novo** (§25), mas o vínculo histórico
  com ela continua de pé e consultável.
* **Desvincular data o fim** (§27). O relatório de agosto continua reconhecendo
  a associação de agosto.

### Edição por diferença

`save_branch` compara os vínculos atuais com os pedidos e mexe só na diferença
(§57). Apagar e recriar destruiria toda vigência e faria cada filial parecer
vinculada a todas as suas operações na data da última edição.

O fim é gravado na **véspera**, não em hoje. A vigência é inclusiva nas duas
pontas, então fechar "hoje" e reabrir "hoje" colidiria — e desmarcar uma operação
por engano e remarcá-la no mesmo minuto é o primeiro erro que qualquer pessoa
comete nesta tela. Quando a remarcação acontece logo em seguida, o vínculo
**volta a ficar aberto** em vez de nascer uma segunda linha: duas linhas
contariam a história de uma interrupção que não houve.

### Impacto antes de desvincular

`branch_operation_impact(filial, operação)` conta colaboradores e veículos
daquela combinação. A tela avisa antes de salvar. **Nada é transferido e nada é
apagado** (§26) — o aviso existe para a decisão ser informada.

---

## 6. Colaboradores

A filial do colaborador é `employee_assignments.organization_unit_id`, que já
existia. Nada aqui guarda o nome da filial como texto e nada duplica o cadastro
de pessoas.

A aba Colaboradores lê `employee_directory`, que é `security_invoker` — quem não
alcança a pessoa não a vê aqui, nem no contador.

Mudar alguém de filial **não altera o Perfil de Acesso** e não concede permissão
nenhuma (§30). O acesso continua vindo de roles, permissions e escopos.

---

## 7. Frotas e transferências

`vehicles.organization_unit_id` continua sendo a filial **de hoje** — é o que a
listagem de frota filtra. O histórico vive em `vehicle_unit_assignments`, com
vigência, motivo e — pela trilha de auditoria — o responsável.

`transfer_vehicle_branch` registra as seis coisas que a §34 pede: filial
anterior, nova filial, início, fim do vínculo anterior, motivo e responsável.
Sobrescrever a coluna sozinha apagaria cinco delas.

Duas regras que só aparecem quando se tenta:

* **§35 — compatibilidade.** A filial de destino precisa atender a operação em
  que o veículo está alocado. Um veículo de Last Mile MG não passa a ser
  responsabilidade de uma filial que só atende Merchandising; isso não é uma
  transferência, é uma inconsistência que ninguém descobriria até o primeiro
  relatório por filial.
* **A transferência vale a partir de hoje.** Datas futuras são recusadas. A
  versão anterior as aceitava, devolvia `scheduled: true` e prometia que "quando
  a data chegar, a linha de vigência responde" — não responde: `vehicle_directory`,
  `branch_vehicles`, o filtro por filial e `branch_impact` leem
  `vehicles.organization_unit_id`, e não existe rotina que promova a linha
  agendada. A transferência nunca acontecia, e ainda travava o veículo, porque a
  linha nova passava a ser a única aberta. Retroagir continua valendo: é o
  registro de algo que já ocorreu. Agendar de verdade é outra etapa — exige
  resolver a filial corrente a partir de `vehicle_unit_assignments` em todos os
  pontos de leitura, como a frota já faz para operações.

**O histórico não depende de quem escreve.** `save_vehicle` e
`apply_vehicle_import` gravam `vehicles.organization_unit_id` direto, e podem:
o gatilho `vehicles_sync_unit` abre, encerra ou corrige a linha de vigência
correspondente. Sem ele, o primeiro veículo que recebesse uma filial pelo
formulário de frota produziria `active_vehicles: 1, total_vehicles: 0` — a
coluna e o histórico contando coisas diferentes na mesma tela, que é o contador
fictício da §51. O gatilho decide pela linha que **cobre hoje**: a que começou
hoje é corrigida no lugar (é assim que tirar e repor a filial no mesmo dia
funciona), a anterior encerra ontem.

Fidelizar um veículo numa BR **não** muda a sua filial: são perguntas
diferentes, em tabelas diferentes (Etapa 08, §38).

---

## 8. Inativação, reativação e exclusão

Inativar consulta as dependências reais primeiro — `branch_impact` conta
colaboradores ativos, veículos ativos, operações vigentes, centros de custo e
locais de trabalho **das tabelas**. Nenhum número é estimado (§51).

Uma filial inativa continua cadastrada, continua respondendo pelo histórico e
some apenas das listas de vínculo novo. Nada é apagado: colaboradores, veículos,
operações e fidelização ficam como estão (§52).

Reativar **não** restaura vínculos operacionais encerrados (§54). Quem quiser a
operação de volta vincula de novo, e a nova vigência começa ali.

**Exclusão física é bloqueada pelo banco** — gatilho `organization_units_block_delete`,
que vale para a tela, para a rotina e para um `DELETE` direto pelo PostgREST.
Nenhuma FK desta etapa usa `ON DELETE CASCADE`.

O motivo da mudança de situação vai para `status_reason`, coluna própria — nunca
para dentro de Observações, que é campo livre e pode ser apagado por quem estiver
editando o endereço sem perceber o que apagou (§20).

---

## 9. Permissões, RLS e escrita

| Código | Para quê |
|---|---|
| `branches.view` | listar filiais, endereços, vínculos e indicadores |
| `branches.create` | criar |
| `branches.update` | editar e transferir veículos entre filiais |
| `branches.deactivate` | inativar e reativar |
| `branches.manage_operations` | vincular e desvincular operações |
| `branches.view_employees` | aba Colaboradores |
| `branches.view_vehicles` | aba Frotas |
| `branches.import` | importar pelo fluxo validado |
| `branches.export` | exportar |
| `branches.view_audit` | aba Histórico |

`units.view` e `units.manage`, da fundação, continuam existindo e continuam
valendo para leitura — outros módulos precisam do nome da filial para desenhar
uma linha de tabela.

**Escrita.** As políticas diretas de INSERT e UPDATE em `organization_units`
foram **removidas**: vinham de quando não havia módulo nem rotina, e eram uma
segunda porta para o mesmo dado, sem transação, sem validação de CNPJ, sem
vínculos atômicos e sem análise de impacto. `insert`, `update`, `delete` e
`truncate` estão revogados de `authenticated` nas três tabelas.

A importação de colaboradores não foi afetada: `private.resolve_master_data`
roda dentro de rotinas `SECURITY DEFINER` e nunca dependeu dessas políticas.

---

### Os indicadores param no escopo

`branch_impact` e `branch_operation_impact` são `security definer`, e isso
atravessa dois eixos diferentes que é preciso não confundir.

O eixo de **permissão** elas atravessam de propósito: quem tem `branches.view`
vê o tamanho da filial sem precisar de `users.view`, `vehicles.view` ou
`cost_centers.view`. Se dependessem dessas permissões, o painel de inativação
mostraria zero para quem não as tem — e um zero falso antes de inativar é
exatamente o contador fictício que a §51 proíbe.

O eixo de **operação** elas não atravessam, e a primeira versão atravessava.
Como a função pertence a `postgres`, que tem `rolbypassrls`, as políticas
`employee_assignments_select` e `vehicles_select` não rodavam: um Liderança de
Operações escopado em Merchandising recebia o efetivo e a frota da filial
inteira. `branch_operation_impact` era pior — `p_operation_id` não era conferido
contra nada, então com os ids que `unit_operations_select` devolve virava um
oráculo operação a operação. Hoje os contadores repetem literalmente os
predicados de escopo das políticas, e a operação é conferida contra a
organização e contra `private.can_access_operation` antes de qualquer contagem
(§64).

Não é hipótese: `lideranca_operacoes` e `gestor_frota` recebem `branches.view`
por padrão e nenhum dos dois tem `operations.access_all`.

---

## 10. Transação

Criar uma filial com operações vinculadas é **uma** chamada e **uma** transação
(§56). Não existe o estado "filial salva, vínculos não".

---

## 11. Auditoria

Gatilhos `private.tg_audit` em `organization_units`,
`organization_unit_operations` e `vehicle_unit_assignments` gravam em
`audit_logs`: quem, quando, valor anterior, valor novo e campos alterados.

`branch_audit_trail` reúne os três numa aba só e confere `branches.view_audit`
antes de devolver qualquer linha. Desde a §13 ela traz também as linhas
`branch_import` (uma por filial importada) e as de `cost_centers` que tocam a
filial — estas só para quem tem `cost_centers.view`. Eventos de domínio (`branch.deactivated`,
`branch.activated`, `branch.vehicle_transferred`, `branch.imported`,
`branch.operation_added` pela importação, `branch.exported`,
`branch.cost_center_added`, `branch.cost_center_removed`) são emitidos em
`outbox_events`.

---

## 12. Migrations desta etapa

| Arquivo | O que faz |
|---|---|
| `…_br_status_reason.sql` | `status_reason` nas BRs da Etapa 08, mesmo defeito de Observações |
| `…_branches_foundation.sql` | colunas, `is_valid_cnpj`, unicidades, `organization_unit_operations`, `vehicle_unit_assignments` |
| `…_branches_rbac_rls.sql` | 10 permissões, matriz padrão, RLS, fim da escrita direta |
| `…_branches_rpcs.sql` | `save_branch`, `set_branch_status`, impactos, `transfer_vehicle_branch` |
| `…_branches_read_model.sql` | `branch_directory`, `branch_operation_directory`, indicadores, abas |
| `…_branch_audit_trail_fix.sql` | `id` ambíguo — a aba Histórico não abria |
| `…_branches_hardening.sql` | escopo por operação nos indicadores, fim da transferência agendada, gatilho `vehicles_sync_unit`, índices duplicados |
| `…_access_profile_defaults_sync.sql` | o catálogo padrão volta a chegar aos papéis (32 permissões de quatro módulos estavam em papel nenhum) |
| `…_vehicle_unit_sync_same_day.sql` | tirar e repor a filial no mesmo dia deixa de violar a constraint de sobreposição |
| `20260924120000_branches_import_export.sql` | importação (`stage_`/`process_branch_import`), `log_branch_export`, `set_branch_cost_center`, `branch_cost_center_directory`, `branch_audit_trail` com importação e centros de custo, tipo de lote `branches` (§13) |

No ledger do banco ela entrou como `branches_import_export`, seguida de duas
correções já refletidas no arquivo: `branches_import_type_check_format` (o
CHECK de `import_batches.type` reescrito na forma `IN (…)`, que as outras
migrations leem) e `branches_import_snapshot_check` (prévia desatualizada
detectada pelo retrato dos campos, não por `updated_at`).

---

## 13. Importação, exportação e centros de custo

Construídos depois da entrega principal da etapa, sobre a mesma infraestrutura
das outras importações do HFM. Tela: botões **Exportar** e **Importar** no
cabeçalho (cada um só para quem tem a permissão), caixa de seleção por linha
para "exportar selecionadas" e a aba **Centros de custo** no detalhe da filial.

### 13.1 Importação (§58–§60, §62)

Fluxo oficial: `import_batches` (tipo `branches`) → `import_rows` /
`import_errors` → `stage_branch_import` (valida e devolve a prévia) →
`process_branch_import` (grava). A action da tela só lê a planilha
(`parseSpreadsheet`) e liga cabeçalhos a campos por alias; **toda regra vive no
banco**.

Colunas: Código*, Nome da Filial*, Razão Social, CNPJ, Situação, CEP, Estado,
Cidade, Endereço, Operações vinculadas, Observações — e, opcionais, Número,
Complemento e Bairro. "Endereço" é o logradouro; sem as três colunas a mais o
arquivo exportado não voltaria igual, e partir "Rua X, 120 — Centro" em três
campos seria adivinhar. "Operações vinculadas" aceita nomes ou códigos
separados por ponto e vírgula (a vírgula só separa quando nada mais separa).
O modelo vazio sai da exportação (`tipo=modelo`).

**Identidade.** A filial existente é a do **código interno** dentro da
organização (`normalize_code`: apara e sobe a caixa; `087` ≠ `87`). Um código
que veio como número numa célula de XLSX ganha aviso, porque o Excel pode ter
comido zeros à esquerda; CNPJ e CEP numéricos são completados com zeros
(tamanho fixo, não é palpite).

**O que a prévia recusa (erro, linha fica de fora):** código ausente ou fora do
formato; código repetido no arquivo (todas as ocorrências); código de filial
arquivada; nome ausente em filial nova; nome de **outra** filial (o nome é
único por organização) ou repetido no arquivo com códigos diferentes; CNPJ
inválido (tamanho e dígitos verificadores); CNPJ repetido no arquivo ou de
outra filial; CNPJ diferente do já cadastrado na filial; situação que não é
Ativa/Inativa; CEP sem 8 dígitos; estado inexistente; cidade sem estado;
cidade que não pertence ao estado (a mensagem diz onde ela existe); estado
trocado sem a cidade nova; textos acima do tamanho da coluna; operação
inexistente **nesta** organização; operação de outra organização (quando
informada por id — a mensagem não diz de quem é); operação inativa; operação
fora do escopo de quem importa; e qualquer ação sem a permissão própria
(`branches.create` para criar, `branches.update` para editar,
`branches.manage_operations` para vincular, `branches.deactivate` para criar
já inativa).

**Diferenças (§60).** Para a filial existente, a prévia lista campo a campo
**atual × recebido**. Coluna vazia é "não informado", nunca "apagar". A tela
mostra também as operações que viraram vínculo novo, as que já estavam
vinculadas e — como aviso — os vínculos atuais que não vieram no arquivo e
continuam de pé.

**O que a importação nunca faz:** desvincular ou reabrir vínculo operacional
(só acrescenta os que não existem, com início hoje e a nota "Importação:
arquivo"); inativar ou reativar filial (divergência de situação vira aviso —
situação muda pela tela, que mostra o impacto antes); trocar CNPJ já
cadastrado; recriar filial arquivada; mudar filial de colaborador ou de
veículo; tocar em Perfil de Acesso, roles, permissions, memberships ou escopos
(§62).

**Gravação.** Só quem validou o lote pode confirmá-lo. Criar e editar passam
por `save_branch` (mesma validação, mesmas permissões). Cada linha grava em
subtransação própria: se a filial mudou depois da prévia — comparada pelo
retrato dos campos, não por `updated_at`, que é o instante da transação — a
linha falha com o motivo e as outras seguem. Auditoria: uma linha
`branch_import` por filial (quem, quando, arquivo, mudanças, vínculos
acrescentados) além dos gatilhos de sempre; eventos `branch.imported` e
`branch.operation_added`. A aba Histórico mostra as importações.

### 13.2 Exportação (§61)

`/estrutura/filiais/export?tipo=…&format=xlsx|csv`, com `tipo` =
`todas` (todas as autorizadas), `filtradas` (os filtros da tela), `selecionadas`
(até 500 ids marcados na lista), `operacoes` (a relação filial × operação, com
vigência, inclusive vínculos encerrados) ou `modelo` (só cabeçalhos; também
para quem só tem `branches.import`).

As linhas vêm de `branch_directory` e `branch_operation_directory`
(`security_invoker`) com o cliente de quem exporta: o arquivo nunca tem o que a
pessoa não via, inclusive nos contadores de colaboradores e veículos (escopo de
operação, §64) e nos vínculos com operações fora do escopo, que a RLS de
`operations` esconde. Um id selecionado que a pessoa não enxerga simplesmente
não aparece.

Antes de devolver o arquivo a rota chama `log_branch_export`, que confere a
permissão, grava `audit_logs` (`branch_export`, `EXPORT`, formato, tipo,
quantidade de linhas e filtros/seleção) e emite `branch.exported`. **Se o
registro falha, a resposta é 403 e nenhum arquivo é gerado.** O arquivo de
filiais usa as mesmas colunas do modelo (reimportável; as colunas só de
leitura aparecem como ignoradas na prévia).

### 13.3 Centros de custo (§38)

`cost_centers.organization_unit_id` já existia; nada foi fundido. Uma filial
pode ter vários centros; um centro responde por no máximo uma filial.
`set_branch_cost_center` associa ou desassocia um centro **existente** — nunca
cria —, confere a organização dos dois lados, exige `branches.update` +
`cost_centers.manage`, recusa filial inativa e centro inativo, e **não toma**
um centro que já responde por outra filial (é preciso desassociá-lo lá).
Eventos `branch.cost_center_added` / `branch.cost_center_removed`; o gatilho de
auditoria de `cost_centers` registra antes/depois e a aba Histórico da filial
mostra essas linhas para quem tem `cost_centers.view`.

A aba lê `branch_cost_center_directory` (`security_invoker`) e só aparece para
quem tem `cost_centers.view`. **Hoje a organização tem 0 centros de custo e o
HFM não tem tela de cadastro de centros de custo**: a aba mostra o estado vazio
("Nenhum centro de custo cadastrado") e nenhum centro fictício foi criado.

### 13.4 Testes

* SQL: `supabase/tests/remote/16a_branches_import_export.sql` (10 blocos, com
  a última execução registrada no cabeçalho).
* Tela: `tests/ui/branches-import-export.spec.ts` contra `/dev/preview-filiais`
  (dados fixos; `?perfil=leitura` e `?centros=vazio` para as variações).

---

## 14. Pendências

* **Cadastro de centros de custo.** A associação existe; o cadastro, não. Sem
  centros cadastrados a aba fica vazia de propósito.
* **Mapeamento manual de colunas e layouts salvos** (como na Fidelização,
  Etapa 15) não foram trazidos para a importação de filiais: as colunas são
  reconhecidas pelo nome. O modelo exportado sempre é reconhecido.
* **Operação de outra organização por nome ou código** aparece como "não
  encontrada nesta organização": distinguir esse caso exigiria revelar o
  cadastro de outra organização. Só um id de operação de fora é identificado
  como tal.
* **Consulta de CEP por serviço externo** (§19) não foi implementada. O endereço
  é digitado; a §19 é explícita em não tornar o cadastro dependente de uma API
  externa, e nenhuma foi escolhida.
* **Veículos sem filial.** A Etapa 06 não trouxe a filial dos veículos; desde
  então 87 dos 95 veículos ativos receberam filial (conferido em 23/09/2026). Os
  8 restantes seguem sem filial até serem atribuídos pela tela de frota ou por
  uma carga que informe a filial — a importação de filiais não faz isso.
