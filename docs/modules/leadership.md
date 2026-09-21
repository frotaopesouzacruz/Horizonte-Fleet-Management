# Governança operacional · Lideranças

Rota: `/governanca/liderancas` · Permissão de entrada: `leadership.view`

Quem responde por cada parte da estrutura operacional, e desde quando. O módulo
responde cinco perguntas: quem é o responsável pela operação, quem lidera uma
cidade, quem responde por uma BR, o que está sob a responsabilidade de alguém, e
**quem era o responsável em uma competência anterior**.

---

## 1. Uma liderança é um colaborador

Não existe cadastro de liderança. Existe `leadership_assignments.employee_id`
apontando para o cadastro mestre, e tudo o mais — nome, matrícula, e-mail, cargo,
operação atual — é lido de lá.

A tabela **não guarda** nome, matrícula nem cargo. Um nome digitado seria uma
segunda verdade sobre a mesma pessoa, e a primeira vez que alguém corrigisse a
grafia no cadastro de colaboradores as duas passariam a discordar.

O seletor da tela busca por nome, matrícula ou operação atual (§18) e devolve ao
formulário o `id` — nunca o texto digitado.

---

## 2. Designar não concede acesso

Esta é a regra mais importante do módulo (§12, §28).

Incluir João no planejamento de lideranças **não altera** o Perfil de Acesso HFM
dele, não altera os seus escopos de operação e não lhe dá acesso a dado nenhum
que ele já não tivesse. Ele continua com o perfil que o fluxo administrativo da
Etapa 05 lhe deu.

Isso não é uma convenção de código: nenhuma das rotinas da Etapa 08 escreve em
`roles`, `membership_roles`, `access_profiles` ou `organization_memberships`.
Não existe caminho a partir deste módulo para nenhuma dessas tabelas.

Pela mesma razão, designar alguém como liderança operacional **não sobrescreve**
`employee_assignments.manager_employee_id` (§27). O responsável por uma BR e o
líder imediato de um motorista são duas pessoas diferentes com frequência, e
misturá-los faria o organograma mentir.

---

## 3. Três níveis de responsabilidade

| Nível | Campos preenchidos | Exemplo |
|---|---|---|
| Operação | `operation_id` | gestor de toda a Last Mile MG |
| Cidade | `operation_id` + `operation_city_id` | liderança de Contagem dentro da Last Mile MG |
| BR | `operation_id` + `operation_city_id` + `operation_br_id` | responsável por uma BR em Contagem |

A forma é garantida por constraint (`leadership_scope_shape_check`): uma
responsabilidade "por operação" não pode carregar uma BR que ninguém leria, e
uma "por BR" não pode existir sem a cidade.

A cidade é provada por chave estrangeira contra a cobertura da operação. Uma
responsabilidade em cidade fora da cobertura é recusada pelo banco, venha ela da
tela, da RPC ou de um POST direto.

Uma pessoa pode responder por várias cidades e várias BRs — são linhas
diferentes, e é assim que a aba **Por liderança** consegue mostrar tudo o que
está sob a responsabilidade de alguém sem inventar vínculo nenhum.

---

## 4. Vigência: início inclusivo, fim inclusivo

`effective_from` e `effective_to` são ambos **inclusivos**. "De 01/09 até 15/09"
grava exatamente `2026-09-01` e `2026-09-15`.

> **Decisão registrada.** A §17 sugere "preferencialmente intervalos com início
> inclusivo e fim exclusivo". O HFM grava o fim inclusivo aqui pelo mesmo motivo
> que já grava em `employee_assignments` e em `vehicle_operation_assignments`:
> uma única convenção no produto inteiro. Uma tabela com fim exclusivo ao lado de
> duas com fim inclusivo é exatamente o erro de um dia que a seção quer evitar.
> O requisito funcional da §17 é atendido: com A de 01/09 a 15/09 e B de 16/09 em
> diante, a consulta do dia 10 devolve A e a do dia 20 devolve B.

`effective_to` nulo significa responsabilidade em aberto.

### Estados

| Status | Significado |
|---|---|
| `active` | vale no período gravado |
| `ended` | encerrada; `effective_to` é o último dia em que valeu |
| `cancelled` | criada e desfeita sem nunca vigorar |

`cancelled` existe para o caso que `ended` não sabe representar: uma designação
substituída antes de valer um único dia. Datá-la seria mentir e apagá-la seria
perder o registro de que alguém a criou. Toda linha fora de `active` tem
`effective_to` preenchido (`leadership_dated_when_not_active_check`) — uma
vigência aberta e encerrada ao mesmo tempo apareceria para sempre nas consultas
por dia.

---

## 5. Um responsável principal por escopo e por dia

Garantido por EXCLUDE constraint, não por conferência:

```
leadership_primary_no_overlap
  EXCLUDE USING gist (organization_id =, scope_key =,
                      daterange(effective_from, effective_to, '[]') &&)
  WHERE (responsibility_type = 'principal' AND status <> 'cancelled')
```

Duas transações simultâneas designando responsáveis para a mesma BR leem, as
duas, que o escopo está livre. Só a constraint resolve isso, e é por ela que a
extensão `btree_gist` foi instalada.

O predicado exclui **apenas o cancelado**, nunca o encerrado. Um vínculo
encerrado continua ocupando os dias que ocupou, e é isso que impede a correção
retroativa silenciosa: esticar o fim de A para além do início de B faria os dois
responderem pelo dia 20, e o banco recusa.

Substitutos e apoio não entram no índice — pode haver quantos o planejamento
precisar.

---

## 6. Competência e replicação

A competência (ano/mês) é uma **janela sobre os períodos**, nunca uma coluna.
Uma responsabilidade iniciada em julho e sem fim aparece em setembro porque
continua verdadeira em setembro.

`replicate_leadership_competence(org, ano_origem, mês_origem, ano_destino,
mês_destino, operação, sobrescrever, prévia)` copia o planejamento entre
competências com duas garantias que andam juntas:

* **Não sobrescreve** (§24). Um escopo que já tem responsável do mesmo tipo no
  destino é preservado e aparece na prévia como preservado. Substituir exige
  `p_overwrite`, que **encerra** o vínculo do destino e cria o novo — nada é
  apagado. Quando o vínculo do destino começava dentro do próprio mês, ele é
  cancelado em vez de datado: não há véspera onde encerrá-lo.
* **É idempotente.** O que define "já existe" é escopo + tipo de
  responsabilidade intersectando o mês de destino, inclusive o que a própria
  rotina criou antes. Rodar duas vezes produz o resultado da primeira.

A prévia e a execução são **a mesma rotina chamada duas vezes**, com `p_dry_run`
ligado e desligado. Uma segunda consulta que apenas contasse o que aconteceria
seria uma segunda implementação da regra, e no dia em que as duas discordassem a
pessoa confirmaria uma coisa e receberia outra.

---

## 7. Aviso, não bloqueio

Designar alguém sem vínculo funcional com a operação escolhida é **permitido** e
**avisado** (§19). Atuar em mais de uma operação é legítimo; o que não pode é
acontecer sem que ninguém perceba.

O mesmo vale para colaborador com situação diferente de ativa. A rotina devolve
`{id, warnings[]}` e a tela mostra os avisos depois de salvar, porque nenhum deles
é motivo para recusar a gravação.

Nada disso transfere o colaborador de operação nem altera os seus escopos.

---

## 8. Encerramento e histórico

Encerrar é datar o fim (`end_leadership_assignment`), nunca apagar a linha.
`DELETE` na tabela é recusado pelo banco — gatilho `leadership_block_delete` —, o
que vale para a tela, para a RPC e para um `DELETE` direto pelo PostgREST.

O histórico guarda responsável anterior, responsável atual, início, fim, motivo
da alteração (`end_reason`) e, pela trilha de auditoria, quem fez a mudança e
quando.

---

## 9. Permissões, RLS e escrita

| Código | Para quê |
|---|---|
| `leadership.view` | consultar responsáveis e histórico |
| `leadership.manage` | criar, editar e encerrar vínculos |
| `leadership.assign` | escolher **quem** é o responsável |
| `leadership.replicate` | copiar planejamento entre competências |
| `leadership.audit` | ler a trilha de auditoria |

`manage` e `assign` são separadas de propósito: quem corrige datas e observações
não necessariamente decide quem responde por uma operação. Trocar a pessoa de um
vínculo existente exige `assign`, mesmo em uma edição.

**Escopo.** Toda leitura e toda escrita passam por
`private.can_access_operation`. Quem não alcança a operação não vê as suas
responsabilidades — na listagem, nos indicadores ou em um GET direto.

**Escrita.** A tabela não tem política de INSERT, UPDATE ou DELETE, e
`insert, update, delete` estão revogados de `authenticated`. Toda alteração passa
pelas rotinas, que são transacionais, conferem permissão e deixam auditoria.

---

## 10. Auditoria

Gatilho `leadership_audit` (`private.tg_audit`) grava em `public.audit_logs`
cada INSERT e UPDATE com organização, usuário, dados anteriores, dados novos e
campos alterados. `audit_logs` é append-only.

---

## 11. Migrations desta etapa

| Arquivo | O que faz |
|---|---|
| `…_operational_governance_foundation.sql` | `btree_gist`, chaves candidatas em `operation_cities`, `operation_brs`, `leadership_assignments`, `fidelization_assignments`, `fidelization_drivers` |
| `…_operational_governance_rbac_rls.sql` | 13 permissões, matriz padrão, `private.br_in_scope`, RLS e grants |
| `…_leadership_rpcs.sql` | `competence_range`, `assert_governance_access`, `save_leadership_assignment`, `end_leadership_assignment`, `replicate_leadership_competence` |
| `…_governance_read_model.sql` | `leadership_directory`, `leadership_indicators` |

---

## 12. Pendências

* Exportação de lideranças (§20 prevê "Exportar, quando autorizado"). A
  permissão de exportação não foi criada para este módulo; a da fidelização
  (`fidelization.export`) existe. Definir se Lideranças terá a sua.
* Responsabilidade "de apoio" está no modelo (`responsibility_type = 'support'`)
  e na tela, mas nenhuma regra de negócio a distingue de substituto ainda.
