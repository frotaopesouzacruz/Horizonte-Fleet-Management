# Planner de Lideranças Operacionais (Etapa 13 — complementar)

Rota: `/governanca/liderancas` · Permissões: `leadership.view`, `leadership.assign`,
`leadership.manage`, `leadership.replicate`, `leadership.audit`.

O modelo de base — designação como vínculo colaborador × escopo × vigência,
três níveis (operação, cidade, BR), um responsável principal por escopo e por
dia, replicação por competência — está em [`leadership.md`](./leadership.md)
(Etapa 08) e a exceção por BR com a precedência de resolução em
[`fidelization-brs.md`](./fidelization-brs.md) §3 (Etapa 13). Este documento
registra o que a etapa complementar acrescentou e como o HFM difere do HFC nos
pontos em que o HFC errava.

---

## 1. O que o HFC fazia (resumo do mapeamento)

`planner_liderancas` guardava, por competência, uma linha por par
(tipo de operação, cidade) com o nome da liderança **em texto** e ids
opcionais; a resolução histórica caía em nomes normalizados quando o id
faltava; o ator ficava "Sistema"; gatilhos regravavam caches de nome em sete a
nove tabelas, e remover uma designação deixava o nome antigo nos caches
(mapeamento §2 e §7, problemas 01–03 e 06).

## 2. O que o HFM faz

* **Identidade oficial.** A liderança é `employees.id`; o escopo é
  `operations.id` / `operation_cities.id` / `operation_brs.id`. Não existe
  coluna de nome copiado: a tela lê `leadership_directory`, que junta na hora.
* **Regra de resolução** (§43): exceção do BR → cidade → operação, sempre na
  data pedida (`private.br_leadership_at`). A gaveta de detalhe da BR e o
  serviço central de contexto mostram **qual nível respondeu**.
* **Ator real.** `created_by`/`updated_by` vêm da sessão; `leadership_audit`
  grava antes/depois; nada é "Sistema".
* **Sem cache.** Remover ou encerrar uma designação muda a resposta na
  consulta seguinte, em todo módulo, porque ninguém copiou o nome.

---

## 3. Indicadores acrescentados (`leadership_indicators`)

| Campo | Definição |
|---|---|
| `places_total` | locais (operação × cidade) de operações ativas |
| `places_with_leader` | locais com um **principal** vigente na competência, por cidade ou pela operação inteira |
| `places_without_leader` | a diferença — o cartão "Locais sem liderança" (aviso quando > 0) |
| `coverage_pct` | 100 × com / total, 1 casa; `null` sem locais |
| `brs_under_leadership` | BRs ativas com liderança resolvida na data-âncora |
| `vehicles_linked` | veículos titulares dessas BRs na data-âncora |
| `drivers_linked` | motoristas dessas BRs na data-âncora |

Cobertura de **locais** e cobertura de **BRs** são perguntas diferentes: um
local sem liderança pode ter uma BR coberta por exceção, e o dashboard de
estabilidade mede a segunda (BRs). As duas aparecem, com nome.

---

## 4. "O que esta liderança responde" (`leadership_scope_summary`)

Na tela, cada nome abre uma gaveta com operações, cidades, BRs (com a regra
que respondeu por cada uma), veículos e motoristas sob a liderança na
competência. É a resposta à §35 e ao escopo que o HFC derivava do planner
(mapeamento §0): aqui a lista sai da mesma resolução que o Planner de Locais
usa, então nunca discorda dele — a suíte 13c (C7) confere que o total de BRs da
gaveta é igual ao planner filtrado pela mesma liderança.

---

## 5. Replicação

`replicate_leadership_competence(dry_run, overwrite)` já existia (Etapa 08):
prévia com contagens de novos, preservados e substituídos, nunca sobrescreve
sem `overwrite`, um registro por criação. A etapa complementar não a alterou;
o que mudou foi a **replicação da fidelização** (veículos e motoristas), que
segue o mesmo padrão e está em [`fidelization.md`](./fidelization.md) §16.

---

## 6. Edição histórica

Uma designação passada pode ser corrigida (`save_leadership_assignment` com
`id`) e encerrada com data e motivo; a auditoria guarda antes e depois. O
impacto de uma correção aparece na consulta seguinte de todo módulo, porque
nenhum módulo guarda o nome — é a garantia de que "corrigir a liderança de
julho" não exige regravar caches. Uma prévia de impacto dedicada (quantas
obrigações de aderência, checklists ou BRs mudam de liderança) não foi
construída nesta etapa; ver pendências.

---

## 7. Testes

Suíte 13 (Etapa 13) cobre a exceção por BR e a precedência; a suíte 13c cobre
os indicadores de cobertura (C7), a resolução na data (C1/C2) e o rebaixamento
sem `leadership.view` (C11). `tests/ui/leadership.spec.ts` cobre os cartões, a
gaveta de escopo (uma BR coberta por cidade e outra por exceção do BR) e a
ausência de rolagem horizontal em desktop e celular.

---

## 8. Pendências

* **Prévia de impacto da edição histórica** (quantos registros de outros
  módulos mudam de liderança ao corrigir uma vigência passada).
* **Exportação de lideranças** — permanece a pendência da Etapa 08.
* **Dois BRs de Belém sem liderança**, pelo gestor ausente do cadastro de
  colaboradores (`fidelization-brs.md` §7).
