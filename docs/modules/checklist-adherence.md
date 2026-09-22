# Gestão de Checklist › Aderência (Etapa 11)

O motor oficial de acompanhamento dos checklists obrigatórios da frota. A
regra central, na ordem em que o banco a aplica:

```
FROTA PREVISTA → OBRIGAÇÃO → EXECUÇÃO RECEBIDA → CONCILIAÇÃO → STATUS
              → JUSTIFICATIVAS / EXPURGOS → INDICADORES
```

A obrigação existe **antes** de qualquer checklist chegar. A ausência de um
checklist é identificada a partir da frota prevista para o dia, não a partir do
que o aplicativo enviou.

Rota: `/checklist/aderencia` · menu **Gestão de checklist › Aderência** ·
permissão de entrada `adherence.view`.

---

## 1. Modelo de obrigações

`checklist_obligations` — uma linha por **veículo × dia operacional × contexto
(saída | retorno) × jornada** (`journey_seq`, hoje sempre 1, preparado para mais
de uma jornada por dia). Identidade estável; nunca é apagada — quando deixa de
ser esperada é **aposentada** (`is_active = false`, `retired_reason`).

Cada obrigação congela o contexto da data (§9): `operation_id`,
`operation_city_id`, `state_id`, `city_id`, `operation_br_id`,
`organization_unit_id`, `vehicle_type_id`, `leader_employee_id`, placa e frota
como snapshot, `expected_at`, `deadline_at`, a fonte (`fidelization` |
`allocation` | `import`) e a **versão da regra** de elegibilidade que a gerou.
Uma transferência de Contagem para Betim em setembro não muda agosto.

## 2. Fontes da frota prevista e precedência

`private.adherence_planned_fleet(org, data)`:

1. **Fidelização** (`fidelization_assignments`, status `confirmed`/`executed`,
   papel `primary`) vigente na data → BR, operação, cidade.
2. Sem fidelização, **alocação operacional** (`vehicle_operation_assignments`)
   vigente na data → operação, estado, cidade, sem BR.
3. Sem nenhuma das duas, o veículo não está previsto e não gera obrigação.

Quando as duas existem e discordam de operação, a fidelização vence e o
conflito vira `adherence_inconsistencies.kind = 'planning_conflict'` (§25).
Veículos vendidos ou baixados na data não são frota. A situação do veículo **na
data** vem de `vehicle_status_history` (`private.vehicle_status_at`).

A obrigação pressupõe o aplicativo habilitado na operação
(`checklist_app_operations.is_enabled`, Etapa 12).

## 3. Elegibilidade

`adherence_eligibility_rules` — por id de operação, tipo, subcategoria e
situação do veículo, com contextos, dias da semana (`isodow`), janelas e
**vigência**. A regra mais específica vence; em empate, a menor `priority`.
Cada alteração relevante sobe `version`; a obrigação guarda a versão que a
gerou. Uma regra criada em setembro vale de sua vigência em diante — o
reprocessamento de agosto continua achando a regra que valia em agosto.

Regras iniciais (explícitas, reversíveis na tela):

| Regra | Efeito |
|---|---|
| Frota prevista: saída e retorno diários | exige, todos os dias, qualquer situação |
| Veículos inativos: sem obrigação | isenta situação `inactive` |
| Frota Leve ADM: sem obrigação | isenta o tipo `car` (por id) |

Manutenção **não** isenta: gera a obrigação com `detected_condition =
MANUTENCAO`, e o expurgo é decisão autorizada (§29).

## 4. Saída e retorno

Dois contextos, duas obrigações, dois prazos, dois indicadores. A execução de
saída satisfaz só a saída. Janelas (parâmetros em `adherence_settings`, com
override por regra): saída esperada 06:00, vence no fim do dia operacional;
retorno esperado 18:00, vence às 02:00 do dia seguinte
(`return_deadline_next_day`). Um retorno enviado depois da meia-noite, dentro
do prazo do dia anterior, é conciliado com a jornada do dia anterior (§18).

## 5. Data operacional e fuso

`America/Sao_Paulo` por organização (`adherence_settings.timezone`).
`private.adherence_today(org)` é a única fonte do "hoje"; `expected_at` e
`deadline_at` são construídos com `private.adherence_local_ts`. O timestamp
original da execução é preservado; a data operacional vem da execução (Etapa
12) e a conciliação aplica a regra do retorno após a meia-noite.

## 6. Classificação — uma regra, um lugar

`private.adherence_status_code(...)` é pura e imutável; a view
`public.adherence_obligation_status` (security invoker) a aplica a cada
obrigação ativa e **todo indicador lê da view**. Ordem:

1. execução válida conciliada, ou decisão aprovada com efeito `count_done` → `FEZ_CHECKLIST`
2. decisão aprovada com efeito `exclude` → o status do motivo (`SEM_ROTA`, `MANUTENCAO`, …)
3. data futura → `PLANEJADO`
4. retorno ainda no prazo → `RETORNO_PENDENTE`
5. senão → `NAO_FEZ_CHECKLIST`

**Dia vigente**: saída sem execução é `NAO_FEZ_CHECKLIST` desde o início do
dia, marcada como provisória (`is_provisional`) — nunca "Sem dados" (§15).
**Sem dados** é a ausência de obrigação conhecida (veículo não previsto), não
a ausência de execução (§21).

Denominador (`is_due`): obrigação não expurgada cuja data já chegou e, no
retorno, cujo prazo venceu. Numerador: devidas e feitas. Expurgada não entra
em nenhum dos dois. Solicitação pendente ou rejeitada não muda nada (§31).

## 7. Fórmula

```
Aderência (%) = Σ numerador ÷ Σ denominador × 100
```

A mesma em `adherence_summary`, `adherence_heatmap`, `adherence_matrix` e
`adherence_journey`. Consolidação sempre por soma (§37): 1/2 + 8/8 = 9/10 =
90%, nunca a média 75%. Denominador zero devolve `null`; a tela escreve **Sem
base** (§35). Teste da §68 (10 obrigações, 8 feitas, 1 expurgo aprovado) =
8/9 = 88,89% em todas as visões.

## 8. Conciliação com o Check List de Frota (Etapa 12)

O envio do checklist grava `outbox_events` (`checklist.execution.submitted`)
na própria transação. O gatilho `outbox_adherence_consume` (BEFORE INSERT)
chama `private.adherence_match_execution` ali mesmo: o evento sai `processed`
e a obrigação fica `FEZ_CHECKLIST` antes de o motorista ver a confirmação. Se
algo falhar, o evento fica pendente e a rotina tenta de novo; o checklist do
motorista nunca é recusado por causa da aderência.

Regras da conciliação (§22): saída ↔ saída, retorno ↔ retorno; uma execução
casa com no máximo uma obrigação; a segunda execução do mesmo contexto no dia
é registrada como **duplicidade** (`is_valid = false`) e não conta duas vezes;
sem obrigação materializada, o motor pede ao planejamento pela obrigação
daquele veículo naquele dia — não inventa; sem resposta, vira
`execution_without_obligation`. Execução conciliada a obrigação já expurgada
vira `execution_after_exclusion` para revisão.

## 9. Expurgos e solicitações

Toda justificativa é uma **solicitação** (`adherence_requests`) com decisão.
Motivos (`adherence_exclusion_reasons`, configuráveis por organização) têm
`effect`: `exclude` (sai do denominador), `count_done` (entra no numerador —
execução comprovada por fonte alternativa, exige evidência) ou `none` (só
registra). Nem todo motivo expurga: `OUTROS` nasce com `none`.

Na aprovação, o efeito e o status do motivo são **copiados para a decisão**
(`decision_effect`, `status_code_applied`): editar o motivo depois não
reclassifica o passado (§40).

Segregação (§32): `decided_by <> requested_by`, verificado na rotina e por
CHECK. A exceção autorizada é a **correção administrativa**
(`override_adherence_status`, permissão `adherence.override`): cria e aprova
na mesma ação, exige justificativa de 10+ caracteres, sai marcada
`is_override` na auditoria, e **não pode** contar como feito, tocar obrigação
com execução válida, com expurgo aprovado ou com solicitação pendente.
Alteração em massa (`bulk_adherence_override`, `adherence.bulk_update`) tem
prévia obrigatória e só aplica ao que é elegível.

Herança saída → retorno (§33) só quando o motivo tem `inherits_to_return`, o
retorno está sem execução e sem solicitação, e quem pede marca a opção; a
solicitação herdada guarda `inherited_from_request_id`.

## 10. Metas

`adherence_targets` com precedência organização › operação › contexto e
vigência. Sem meta cadastrada a tela mostra "Não definida" — 90% não é
implícito (§36).

## 11. Rotina, reconciliação e idempotência

`pg_cron` executa `private.adherence_cron_tick()` a cada 15 minutos: para cada
organização ativa, gera ontem e hoje (podendo aposentar o que deixou de ser
esperado e não está protegido), o horizonte à frente (`generation_horizon_days`,
7) só criando, e consome o outbox pendente. Cada rodada fica em
`adherence_runs` com o diff.

`reconcile_adherence_period` (`adherence.reconcile`): prévia obrigatória
(`preview = true` devolve o diff sem gravar), motivo obrigatório para aplicar,
até 93 dias por chamada. Reprocessar sem mudança nas fontes não cria, não
aposenta e não altera contexto (teste T10). Obrigação com execução conciliada
ou solicitação pendente/aprovada é **protegida**: nunca é aposentada.

## 12. Importação

`stage_adherence_import` valida linha a linha (veículo por frota ou placa,
data ≤ hoje, contexto, status reconhecido, obrigação existente, evidência
quando o motivo exige) e devolve a prévia; `process_adherence_import` abre
solicitações **pendentes** sem solicitante (o arquivo não decide) e registra
inconsistências para status/veículo desconhecidos. Nunca cria veículo,
operação, cidade, BR, colaborador ou obrigação; nunca sobrescreve execução
oficial, expurgo aprovado ou solicitação pendente; nunca toca em perfis de
acesso. O mesmo arquivo (hash) é reconhecido e não duplica.

## 13. RBAC e RLS

Permissões (módulo `adherence`): `view`, `view_audit`, `request`, `approve`,
`override`, `bulk_update`, `import`, `export`, `reconcile`, `manage_rules`,
`manage_targets`. Matriz padrão: Administrador e Gestor de Frota, tudo;
Liderança, `view` + `request` + `export`; Gestão, `view` + `view_audit` +
`export`; Segurança, `view` + `view_audit`; Operacional e Gente, nada por
padrão.

RLS: a obrigação é lida por quem tem `adherence.view` **e** alcança a operação
congelada nela (`private.can_access_operation`) — a liderança de Contagem não
lê Belém. Solicitações e conciliações herdam pela obrigação. Escrita só por
rotina `security definer` com `search_path = ''`, permissão, organização e
escopo verificados antes de gravar. O motor (`private.adherence_generate`,
`_match_execution`, `_consume_outbox`, `_cron_tick`) não é executável por
`authenticated`.

## 14. Auditoria

`private.tg_audit` em solicitações, conciliações, motivos, regras, metas,
parâmetros e rodadas; em obrigações, só update/delete (aposentar, atualizar
condição) — a rotina cria aos milhares.

## 15. Interface

Contexto global Saída / Retorno no cabeçalho (§43). Filtros Operação → Estado
→ Cidade (cobertura da operação), filial, liderança, tipo, status, frota ou
placa. Abas: Visão consolidada (8 indicadores + quebra por dimensão), Heatmap
(percentual escrito por dia, futuro = planejado), Mês / Dia (matriz com
primeira coluna e cabeçalho fixos; no celular, visão por veículo), Jornada
(Previsto → Saída → Em rota → Retorno), Expurgos, Solicitações, Importação e
reconciliação (reconciliar com prévia, metas, regras, motivos, inconsistências,
rodadas, importação). Detalhe da célula em drawer com as ações autorizadas.

## 16. Testes

- `supabase/tests/remote/11_adherence.sql`: 23 + 4 blocos, com rollback
  (§67–§69 e §54–§56). Última execução: 27/27 PASS (22/09/2026).
- `tests/ui/adherence.spec.ts`: 8 cenários sobre `/dev/preview-aderencia`.

## 17. Pendências conhecidas

- Anexo de evidência: a solicitação guarda **referência** (OS, chamado,
  documento); upload de arquivo em bucket privado fica para uma etapa própria.
- Exportação: permissão `adherence.export` existe; a exportação XLSX/CSV da
  matriz e dos indicadores ainda não foi construída.
- Consulta "da própria situação" pelo perfil Operacional (§63) não foi
  habilitada: exigiria uma visão por colaborador; hoje o perfil não recebe
  `adherence.view`.
- Setembro/2026 foi materializado do dia 1º: o período anterior à entrada do
  aplicativo aparece como Não fez por regra. O PO pode expurgar por período com
  alteração em massa ou ajustar a vigência das regras.
