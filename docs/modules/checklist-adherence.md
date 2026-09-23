# Gestão de Checklist › Aderência (Etapa 11 · refinamento de 23/09/2026)

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

O mapeamento integral do Motor de Aderência do HFC (telas, camada cliente,
tabelas, funções, catálogo de status, 21 problemas verificados e os contratos
funcionais) está em [`hfc-adherence-mapping.md`](./hfc-adherence-mapping.md).
A seção 18 deste documento registra o diagnóstico do HFM frente a esse
mapeamento e o que o refinamento acrescentou.

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

**Contexto congelado ≠ contexto errado para sempre.** Enquanto a obrigação não
está protegida (sem execução conciliada, sem solicitação pendente ou
aprovada), a rodada do motor sobre o período (§11) **atualiza** o contexto
quando o planejamento vigente naquela data mudou — operação, cidade, BR,
unidade, liderança, fonte e vínculo de fidelização. É o que faz uma
substituição de veículo ou uma correção de liderança aparecer na obrigação do
dia sem criar uma segunda obrigação. Obrigações com execução ou decisão ficam
como estavam: o que já foi julgado não muda de contexto (suíte 11b, R2).

## 2. Fontes da frota prevista e precedência

`private.adherence_planned_fleet(org, data)`:

1. **Fidelização** (`fidelization_assignments`, qualquer status exceto
   `cancelled`, papel `primary`) vigente na data → BR, operação, cidade. Um
   vínculo `planned` — o que a substituição de veículo cria para o titular
   novo — já é frota prevista: a obrigação nasce no dia da substituição.
2. Sem fidelização, **alocação operacional** (`vehicle_operation_assignments`)
   vigente na data → operação, estado, cidade, sem BR.
3. Sem nenhuma das duas, o veículo não está previsto e não gera obrigação.

Quando as duas existem e discordam de operação, a fidelização vence e o
conflito vira `adherence_inconsistencies.kind = 'planning_conflict'` (§25).
Veículos vendidos ou baixados na data não são frota. A situação do veículo **na
data** vem de `vehicle_status_history` (`private.vehicle_status_at`).

A obrigação pressupõe o aplicativo habilitado na operação e no tipo de
equipamento **na data** (`private.app_operation_enabled`,
`private.app_vehicle_type_enabled`, Etapa 12): desabilitar o aplicativo numa
operação a partir de amanhã zera a expectativa de amanhã e deixa hoje intacto
(suíte 11b, R3).

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
12) e a conciliação aplica a regra do retorno após a meia-noite. A tela nunca
usa o relógio do navegador para decidir "vencido": o dia vigente vem do
servidor em toda consulta.

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

A mesma em `adherence_summary`, `adherence_heatmap`, `adherence_matrix`,
`adherence_journey`, `adherence_monthly`, `adherence_day_detail`,
`adherence_return_tracking` e `adherence_insights` — todas leem
`adherence_obligations_filtered`, que lê a view. Consolidação sempre por soma
(§37): 1/2 + 8/8 = 9/10 = 90%, nunca a média 75%. Denominador zero devolve
`null`; a tela escreve **Sem base** (§35). Teste da §68 (10 obrigações, 8
feitas, 1 expurgo aprovado) = 8/9 = 88,89% em todas as visões; a suíte 11b
(R1) confere que consolidada, detalhe do dia, heatmap, matriz e dashboard
mensal devolvem o mesmo numerador e o mesmo denominador para o mesmo recorte.

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

**Substituição de veículo** (§18 do refinamento): o veículo substituído
mantém a execução já conciliada na obrigação dele; o substituto ganha a
obrigação própria na BR a partir do dia da substituição; ninguém é contado
duas vezes no denominador (suíte 11b, R2).

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
Alteração em massa (`bulk_adherence_override`, `adherence.bulk_update` +
`adherence.override`) tem prévia obrigatória e só aplica ao que é elegível.

**Conflito execução válida × expurgo** (§57): uma solicitação pendente sobre
obrigação que recebe execução válida depois não pode mais ser aprovada
("checklist válido registrado"); em lote, sai como `has_execution`; nova
solicitação para a mesma obrigação é recusada; rejeitar a pendente preserva a
execução (suíte 11b, R4). A obrigação original nunca é apagada pelo expurgo:
o status do motivo se sobrepõe, a linha e a execução ficam.

**Decisão em lote** (`decide_adherence_requests_bulk`, `adherence.approve`):
até 200 solicitações por chamada, decisão `approve` | `reject` |
`reclassify`, `dry_run` obrigatório na tela antes de aplicar. Rejeitar exige
nota; reclassificar exige motivo válido. Cada item volta com o próprio
resultado — `applicable`/`applied`, `not_found`, `not_pending`,
`own_request`, `out_of_scope`, `reason_not_applicable`, `has_execution`,
`evidence_missing`, `failed` — e a aplicação real chama
`decide_adherence_request` por item, dentro de bloco de exceção: um item
recusado não derruba os outros, e cada decisão fica na auditoria como se
fosse individual (suíte 11b, R5).

Herança saída → retorno (§33, §49) só quando o motivo tem
`inherits_to_return` ("Replica no Retorno" do HFC), o retorno está sem
execução e sem solicitação, e quem pede marca a opção; a solicitação herdada
guarda `inherited_from_request_id`.

## 10. Metas

`adherence_targets` com precedência organização › operação › contexto e
vigência. Sem meta cadastrada a tela mostra "Não definida" — 90% não é
implícito (§36). O dashboard mensal e os insights usam a meta vigente em cada
mês.

## 11. Rotina, reconciliação e idempotência

`pg_cron` executa `private.adherence_cron_tick()` a cada 15 minutos: para cada
organização ativa, gera ontem e hoje (podendo aposentar o que deixou de ser
esperado e não está protegido, e **atualizando o contexto** do que não está
protegido — §1), o horizonte à frente (`generation_horizon_days`, 7) só
criando, e consome o outbox pendente. Cada rodada fica em `adherence_runs`
com o diff.

`reconcile_adherence_period` (`adherence.reconcile`): prévia obrigatória
(`preview = true` devolve o diff sem gravar), motivo obrigatório para aplicar,
até 93 dias por chamada. Reprocessar sem mudança nas fontes não cria, não
aposenta e não altera contexto (teste T10). Obrigação com execução conciliada
ou solicitação pendente/aprovada é **protegida**: nunca é aposentada nem
muda de contexto.

## 12. Importação

`stage_adherence_import` valida linha a linha (veículo por frota ou placa,
data ≤ hoje, contexto, status reconhecido, obrigação existente, evidência
quando o motivo exige) e devolve a prévia; `process_adherence_import` abre
solicitações **pendentes** sem solicitante (o arquivo não decide) e registra
inconsistências para status/veículo desconhecidos. Nunca cria veículo,
operação, cidade, BR, colaborador ou obrigação; nunca sobrescreve execução
oficial, expurgo aprovado ou solicitação pendente; nunca toca em perfis de
acesso. O mesmo arquivo (hash) é reconhecido e não duplica.

`adherence_import_history` (`adherence.import` ou `adherence.view_audit`)
lista os lotes do módulo com totais (linhas, válidas, avisos, erros, criadas,
ignoradas), responsável e os erros por linha (até 50), para a seção
"Histórico de importações".

## 13. RBAC e RLS

Permissões (módulo `adherence`): `view`, `view_audit`, `request`, `approve`,
`override`, `bulk_update`, `import`, `export`, `reconcile`, `manage_rules`,
`manage_targets`. Matriz padrão: Administrador e Gestor de Frota, tudo;
Liderança, `view` + `request` + `export`; Gestão, `view` + `view_audit` +
`export`; Segurança, `view` + `view_audit`; Operacional e Gente, nada por
padrão.

Correspondência com os nomes do refinamento (nenhuma permissão nova foi
criada; o catálogo existente cobre cada uma):

| Nome pedido | Permissão do HFM |
|---|---|
| `aderencia.view` | `adherence.view` |
| `aderencia.view_consolidated` | `adherence.view` (a consolidada não é separada da entrada) |
| `aderencia.view_operational_scope` | `adherence.view` + RLS por operação alcançada (`private.can_access_operation`) |
| `aderencia.view_execution_details` | `adherence.view` na gaveta da obrigação; o histórico completo do checklist segue as permissões da Etapa 12 |
| `aderencia.request_justification` | `adherence.request` |
| `aderencia.review_justification` | `adherence.approve` |
| `aderencia.manage_expurgos` | `adherence.override` + `adherence.bulk_update` |
| `aderencia.import` | `adherence.import` |
| `aderencia.export` | `adherence.export` |
| `aderencia.reprocess` | `adherence.reconcile` |
| `aderencia.manage_parameters` | `adherence.manage_rules` + `adherence.manage_targets` |
| `aderencia.view_audit` | `adherence.view_audit` |

RLS: a obrigação é lida por quem tem `adherence.view` **e** alcança a operação
congelada nela (`private.can_access_operation`) — a liderança de Contagem não
lê Belém. Solicitações e conciliações herdam pela obrigação. Escrita só por
rotina `security definer` com `search_path = ''`, permissão, organização e
escopo verificados antes de gravar. O motor (`private.adherence_generate`,
`_match_execution`, `_consume_outbox`, `_cron_tick`) não é executável por
`authenticated`. Usuário sem vínculo: seleção de obrigações e detalhe do dia
devolvem 0, histórico de importações devolve vazio, lote e exportação
recusam com `42501` (suíte 11b, R8).

## 14. Auditoria

`private.tg_audit` em solicitações, conciliações, motivos, regras, metas,
parâmetros e rodadas; em obrigações, só update/delete (aposentar, atualizar
condição) — a rotina cria aos milhares. Cada exportação é registrada por
`log_adherence_export` (`audit_logs`, entidade `adherence_export`, ação
`EXPORT`, com formato, tipo e número de linhas); sem registro não há arquivo.

## 15. Interface

Contexto global **Saída / Retorno** no cabeçalho (§43), vivo na URL
(`contexto`) e aplicado a todas as abas, à exportação e ao detalhe do dia.
Filtros Operação → Estado → Cidade (cobertura da operação), filial,
liderança, tipo, status, **justificativa** (pendente, aprovada, rejeitada,
sem justificativa — `justificativa` na URL, filtro
`adherence_obligations_filtered.justification`), frota ou placa. Competência
com setas (mês anterior / próximo).

* **Visão consolidada** — 8 indicadores; quebra por operação, estado, cidade,
  filial, liderança, BR, tipo ou veículo, com gráfico de barras (SVG inline,
  sem biblioteca) e linha da meta; **dashboard mensal** (`adherence_monthly`)
  com os doze meses do ano escolhido (`ano_dash`, independente da
  competência), meses futuros hachurados e sem resultado, total do ano por
  soma; **insights gerenciais** (`adherence_insights`) — variação sobre o mês
  anterior, desvio para a meta e dias abaixo dela, situação do dia vigente,
  operações e localidades abaixo da meta com os números, justificativas
  pendentes por operação, melhor e pior operação. Nada genérico: sem dado, a
  frase não aparece.
* **Heatmap** — três meses (anterior, corrente, próximo; o corrente maior, os
  vizinhos compactos), percentual do dia escrito na célula, legenda em
  palavras (na meta, até 10 pontos abaixo, abaixo, sem base, futuro, dia
  vigente), pendências do dia como contador, navegação de mês e "Mês atual".
  Selecionar o dia abre o **detalhe do dia** (`adherence_day_detail`):
  indicadores, quebras por operação, cidade e liderança, veículos sem
  checklist e expurgados; dali, "Abrir Mês/Dia neste dia" e "Ver jornada do
  dia" preservam competência, contexto e filtros.
* **Mês / Dia** — matriz com primeira coluna e cabeçalho fixos, navegação de
  mês, legenda dos estados, ponto de solicitação pendente na célula; no
  celular, visão por veículo. Detalhe da célula em gaveta com as ações
  autorizadas. **Seleção de dias**: "Selecionar dias" liga caixas no cabeçalho
  (ou no celular, uma lista), "Alterar em massa…" abre a prévia
  (`adherence_select_obligations` com os mesmos filtros da tela, depois
  `bulk_adherence_override` em `dry_run`) com as contagens do que é elegível,
  tem execução, já está expurgado, tem solicitação pendente ou é futuro, e
  só então aplica, com motivo e justificativa obrigatórios. Trocar de mês
  descarta a seleção; nunca há "todos os dias" por omissão.
* **Jornada** — Previsto → Saída → Em rota → Retorno para o dia escolhido, e
  o **Acompanhamento do retorno** (`adherence_return_tracking`) da
  competência: retornos previstos, realizados, aguardando retorno (saída
  feita, dentro do prazo), no prazo sem saída, vencidos (com quantos tinham
  saída feita), expurgados, aderência do retorno com denominador próprio;
  tabela por liderança; fila de retorno com a situação de cada linha
  (aguardando retorno · sem saída registrada · retorno vencido · retorno
  vencido (saiu)), o prazo e a saída correspondente. Um retorno no prazo
  nunca é falta (§50).
* **Expurgos** e **Solicitações** — estados pendente, aprovada, rejeitada e
  reclassificada; coluna de seleção só nas pendentes; aprovar, rejeitar e
  reclassificar **em lote** com prévia (resultado por item) e confirmação;
  rejeitar exige motivo; auditoria por decisão.
* **Importação e reconciliação** — reconciliar com prévia e motivo, metas,
  regras, motivos (com "herda para o retorno"), inconsistências, histórico
  de importações (lotes e erros por linha), rodadas.
* **Exportar** (`adherence.export`) — consolidada (com a quebra escolhida),
  matriz mês/dia ou acompanhamento do retorno, em XLSX ou CSV, sempre no
  contexto e nos filtros em tela (`/checklist/aderencia/export`); o arquivo
  é o que se vê, e a exportação fica na auditoria.

## 16. Testes

- `supabase/tests/remote/11_adherence.sql`: 23 + 4 blocos, com rollback
  (§67–§69 e §54–§56). Última execução: 27/27 PASS (23/09/2026, após o
  refinamento; a fixture de T16 passou a habilitar o tipo no aplicativo
  dentro da transação, por causa do vínculo App × Tipo da Etapa 12).
- `supabase/tests/remote/11b_adherence_refinement.sql`: 8 blocos R1–R8 —
  consistência entre visões, substituição de veículo, elegibilidade por
  aplicativo na data, conflito execução × expurgo, decisão em lote e filtro
  de justificativa, retorno com denominador próprio, dashboard mensal,
  usuário sem vínculo. Última execução: 8/8 PASS (23/09/2026).
- `tests/ui/adherence.spec.ts`: 16 cenários sobre `/dev/preview-aderencia`
  (fórmula e meta, contexto na URL, matriz do dia vigente/futuro/sem dados,
  heatmap de três meses com detalhe do dia, dashboard mensal, insights,
  jornada e retorno, expurgos individuais e em lote, seleção de dias,
  governança, histórico de importações, celular sem rolagem horizontal).

## 17. Pendências conhecidas

- Anexo de evidência: a solicitação guarda **referência** (OS, chamado,
  documento); upload de arquivo em bucket privado fica para uma etapa própria
  (sem fotografia nem vídeo, por regra).
- Consulta "da própria situação" pelo perfil Operacional (§63) não foi
  habilitada: exigiria uma visão por colaborador; hoje o perfil não recebe
  `adherence.view`.
- Setembro/2026 foi materializado do dia 1º: o período anterior à entrada do
  aplicativo aparece como Não fez por regra. O PO pode expurgar por período com
  alteração em massa ou ajustar a vigência das regras.
- Detalhe do dia e seleção em massa devolvem até 200 veículos por lista e 500
  obrigações por seleção (a tela avisa quando trunca); acima disso, refine o
  filtro.
- O mapeamento do HFC ficou com as limitações listadas em
  [`hfc-adherence-mapping.md`](./hfc-adherence-mapping.md) §13 (banco do HFC
  indisponível na segunda metade da inspeção).

## 18. Refinamento (23/09/2026): diagnóstico e o que mudou

**O que o HFM já tinha** antes do refinamento, verificado no código e na
suíte 11: motor de obrigações a partir do planejamento oficial, elegibilidade
versionada, data operacional em `America/Sao_Paulo`, catálogo de status com
dia vigente = Não fez provisório e futuro = Planejado, fórmula única por soma,
conciliação transacional com o Check List de Frota via outbox, solicitações
com decisão segregada, correção administrativa e alteração em massa com
prévia, herança para o retorno por motivo, metas por vigência, reconciliação
idempotente, importação com prévia e sem decisão automática, RLS por escopo,
auditoria.

**O que faltava** frente ao mapeamento do HFC e ao refinamento pedido — e foi
construído nesta etapa, sem segundo motor e sem cadastro paralelo:

| Lacuna | Onde ficou |
|---|---|
| Dashboard mensal com os doze meses | `adherence_monthly` · Visão consolidada |
| Insights gerenciais reais | `adherence_insights` · Visão consolidada |
| Heatmap com três meses e detalhe do dia | `adherence_day_detail` · Heatmap |
| Acompanhamento do retorno como visão própria | `adherence_return_tracking` · Jornada |
| Decisão de solicitações em lote com prévia | `decide_adherence_requests_bulk` · Solicitações |
| Seleção de múltiplos dias na matriz | `adherence_select_obligations` + `bulk_adherence_override` · Mês/Dia |
| Filtro por situação da justificativa | `adherence_obligations_filtered.justification` · filtros |
| Histórico de importações | `adherence_import_history` · Importação |
| Exportação XLSX/CSV auditada | `log_adherence_export` · `/checklist/aderencia/export` |
| Substituição de veículo sem duplicar denominador | `private.adherence_planned_fleet` (vínculo `planned`) e atualização de contexto em `private.adherence_generate` |

**Problemas do HFC que o HFM não reproduz** (numeração do mapeamento §11):
autorização só na interface (P-01) — aqui toda rotina confere permissão e a
RLS decide o escopo; "hoje" pelo relógio do navegador (P-02) — aqui só o
servidor; autoria perdida (P-03) — aqui `requested_by`, `decided_by`,
`created_by` vêm da sessão; três fórmulas diferentes (P-04) — aqui uma view;
rejeição sem efeito (P-06) — aqui rejeitada volta ao denominador; retorno
futuro contado como pendente (P-07) — aqui futuro é planejamento; importação
sobrescrevendo "Fez" e overrides (P-08) — aqui a importação só abre
solicitações pendentes; meta fixa em 90% (P-18) — aqui parâmetro com
vigência; telas de leitura disparando escrita (P-19) — aqui a materialização
é da rotina, e reprocessar é ação com prévia e motivo.

Migration desta etapa: `20260923100000_adherence_refinement.sql` (aditiva:
oito funções novas, um filtro novo na função de obrigações filtradas, duas
mudanças no motor; nenhuma tabela criada ou alterada, nenhum dado apagado).
