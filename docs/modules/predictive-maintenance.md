# Gestão de Frota › Manutenção › Manutenção Preditiva (motor v2)

Rota: `/frota/manutencao?aba=preditiva` · Menu: **Gestão de frota → Manutenção → aba
Preditiva** · Aplicativo de campo: **Aplicativos → Verificação Preditiva**
(`/aplicativos/verificacao-preditiva`) · Permissões: `maintenance.predictive.*` e
`applications.predictive.execute` (seção 10).

A manutenção preditiva do HFM é um **motor de ciclos técnicos**: para cada frota e
cada item do plano técnico aplicável existe um ciclo, com uma **referência**
(a última verificação, manutenção com cobertura total, baixa manual ou o histórico
do cluster), um **marco** (referência + intervalo em KM e/ou dias) e uma
**situação técnica** calculada no servidor a partir do KM oficial da Gestão de KM
Rodado. A situação técnica é uma coisa; a **execução** (há manutenção aberta?) é
outra; a **conformidade** (o que a última verificação disse) é uma terceira. As
três aparecem lado a lado e nunca se misturam.

Não é um módulo paralelo: usa `maintenances`, `maintenance_clusters`,
`maintenance_services`, `vehicles`, `vehicle_types`, operações, BRs, fidelização,
lideranças e a leitura oficial de KM. Não há aprendizado de máquina: as regras são
determinísticas, parametrizadas e auditáveis. Preventiva e preditiva não se
confundem: a preventiva segue em `maintenance_preventive_*`; aqui ela entra apenas
como **referência** quando a manutenção preventiva concluída inclui um serviço com
cobertura total do item.

Como o HFC (a referência funcional, lida somente para leitura) foi mapeado e o que
o HFM reaproveita ou melhora: [`hfc-predictive-mapping.md`](./hfc-predictive-mapping.md).
O módulo de Manutenção como um todo: [`maintenance.md`](./maintenance.md).

---

## 1. Cadastros: clusters, plano técnico, itens, roteiro e cobertura

| Entidade | Tabela | O que guarda |
|---|---|---|
| Cluster técnico | `maintenance_clusters` | Agrupador do item (Freios, Motor, Elétrica…). O mesmo cadastro da Base Geral. |
| Plano técnico | `maintenance_predictive_plans` | Nome, código, descrição, fonte/documento/OEM, **aplicabilidade** (tipo de equipamento obrigatório; subcategoria, marca, modelo, anos opcionais), **vigência** (`valid_from` / `valid_to`), situação (`draft` → `in_review` → `approved` → `archived`), versão. |
| Versão | `maintenance_predictive_plan_versions` | Snapshot imutável (itens, roteiros, coberturas) com motivo e autor a cada mudança sensível de plano aprovado e ao arquivar. Append-only. |
| Item | `maintenance_predictive_plan_items` | Cluster, nome, intervalos (`interval_km`, `interval_days`, `interval_engine_hours` — guardado, fora do cálculo), percentuais de **alerta**, **programação** e **tolerância**, criticidade (`low`…`critical`), ordem, ativo e o **roteiro técnico** (`checklist` JSON). |
| Roteiro técnico | coluna `checklist` do item | Passos com `key`, `description`, `required`, `response_type` (`conformity`, `yes_no`, `number`, `text`, `choice` + `options`, `photo`), `approval_criteria`, `applicability`, `active`, `sequence`. Normalizado por `private.maintenance_predictive_normalize_checklist`; um passo desativado não aparece no app nem é exigido. |
| Cobertura | `maintenance_predictive_coverage` | Serviço × item com `coverage` **`full`** (reinicia o ciclo) ou **`partial`** (só informa). Um serviço sem linha é **informativo**. As linhas nunca são apagadas: `is_active = false` (`maintenance_save_predictive_coverage`). |

**Aplicabilidade determinística.** `private.maintenance_predictive_plan_for` escolhe,
entre os planos **aprovados e vigentes na data** do mesmo tipo de equipamento cuja
subcategoria/marca/modelo/anos são nulos ou iguais aos do veículo, o de maior
**especificidade** (modelo 8 + marca 4 + subcategoria 2 + anos 1). Dois planos
empatados na especificidade máxima são **ambiguidade**: o motor segue com o de
versão/atualização mais recente **e** registra a inconsistência `plan_ambiguous`
(nunca em silêncio). `maintenance_parameters` devolve `ambiguous_vehicles` por
plano.

**Governança.** Só plano **aprovado** alimenta o motor. Em plano aprovado, mudar
intervalo, percentuais, criticidade, aplicabilidade ou vigência exige motivo (≥ 10
caracteres), cria uma versão e dispara o recálculo controlado dos ciclos
(`private.maintenance_predictive_sync_plan_fleet`): ciclos de veículos que saíram
da aplicabilidade são **desativados**, nunca apagados; o histórico de verificações,
manutenções e eventos permanece. Arquivar exige motivo (≥ 5), gera versão e
snapshot. Duplicar (`maintenance_duplicate_predictive_plan`) é atômico e copia
itens, roteiros, vigência e coberturas ativas.

---

## 2. Ciclo por frota × item e referência

`maintenance_predictive_cycles`: um por veículo × item ativo do plano aplicável.
`private.maintenance_sync_predictive_vehicle` cria, reativa ou desativa (`is_active`)
e re-resolve a referência; roda ao mudar o veículo (gatilho `vehicles_predictive_sync`
em tipo, subcategoria, marca/modelo, ano, status), ao aprovar/alterar um plano, ao
concluir ou reabrir uma manutenção, na rotina diária e em "Recalcular ciclos".

Prioridade da referência (`reference_type`):

1. `verification` — última verificação **conforme** (ou monitoramento) com KM;
2. `maintenance` — última manutenção concluída com serviço de **cobertura total**;
3. `manual_reset` — baixa manual autorizada (entra na ordem cronológica das anteriores);
4. `history` — última manutenção concluída do **cluster**, sem cobertura formal
   (referência **não formal**: mostrada como "Histórico" e contada à parte);
5. `none` — sem referência: situação **Inspeção inicial**.

Cada mudança relevante do ciclo vira uma linha em `maintenance_predictive_events`
(seção 8).

---

## 3. KM oficial

O KM vem **exclusivamente** da Gestão de KM Rodado (`private.km_context_pairs`:
leitura oficial validada/compatível/estimada na data). O aplicativo e o portal
**nunca** gravam KM na base oficial; o KM informado numa verificação fica na
verificação (`km`, `km_source = 'informed'`) e no envio.

- Sem leitura → situação **Sem KM** (`no_km`); a dimensão dias segue calculada e
  aparece como estimativa.
- Leitura com idade > `maintenance_settings.predictive_km_max_age_days` (padrão 30)
  → `km_stale = true`: a situação continua calculada, a célula/linha recebe o aviso
  **KM desatualizado** e a inconsistência `km_stale` é registrada.

---

## 4. Cálculo da situação técnica

Para cada dimensão com intervalo (`private.maintenance_predictive_state_v2`):

```
marco_km   = km_referência  + intervalo_km          saldo_km   = marco_km   − km_oficial
marco_data = data_referência + intervalo_dias       saldo_dias = marco_data − hoje
```

Banda (`private.maintenance_predictive_band`, sobre a base = intervalo):

| Banda | Condição sobre o saldo | Situação |
|---|---|---|
| 5 | saldo < −tolerância % | **Crítico** |
| 4 | saldo < 0 | **Vencido** |
| 3 | saldo ≤ programação % | **A programar** |
| 2 | saldo ≤ alerta % | **Próximo** |
| 1 | acima do alerta | **Em dia** |

Precedência: `no_km` (sem leitura e com intervalo em KM) → `initial_inspection`
(sem referência) → **pior** entre KM e dias. **Monitoramento** ativo substitui o
intervalo pelo alvo reduzido (`monitoring_km` / `monitoring_days` a partir da
verificação). Uma **não conformidade** sem manutenção concluída depois eleva a
situação a pelo menos **A programar**. `status_cache` / `status_changed_at` guardam
"desde quando" (SLA e previsto × realizado) e emitem `status_changed`.

**Execução** (`execution_status`): `not_programmed`, `to_schedule`, `scheduled`,
`in_progress` pela manutenção aberta vinculada ao ciclo/item; `awaiting_corrective`
quando há corretiva aberta de uma não conformidade.

**Conformidade** (`conformity`): `conforming`, `monitor`, `non_conforming`,
`not_performed` pela última verificação; `no_verification` sem verificação formal.

---

## 5. Verificação, monitoramento, não conformidade e baixa manual

`private.maintenance_predictive_register(cycle, payload, source, submission_id)` é o
núcleo do portal (`maintenance_register_predictive_verification`, origem `portal`)
e do aplicativo (origem `app`). Valida o roteiro (passos obrigatórios respondidos,
tipo `number` numérico), exige descrição ≥ 5 caracteres em **não conforme** e
**não realizada**, exige alvo (KM e/ou dias) em **monitoramento**, e decide:

| Resultado | Decisão gravada | Efeito |
|---|---|---|
| Conforme | `restart_cycle` (ou `close_monitoring`) | Nova referência = esta verificação; monitoramento encerrado. |
| Monitoramento | `reduce_interval` / `continue_monitoring` | Referência mantida; marco passa a KM + alvo e/ou data + alvo. |
| Não conforme | `open_maintenance` (ou `await_corrective`) | Ciclo **não** reinicia; situação ≥ A programar; abre a corretiva de origem **Preditiva** (idempotente: uma manutenção aberta por veículo × item é reaproveitada) na **mesma transação**. |
| Não realizada | `none` | Só registra o motivo. |

**Conclusão e reabertura de manutenção** (`private.maintenance_on_completed` /
`_on_reopened`): serviço com cobertura total → reinicia o ciclo e emite
`maintenance_restart`; cobertura parcial → não reinicia; reabrir desfaz a
referência e emite `maintenance_reopened`. Vale para corretiva e para preventiva.

**Baixa manual autorizada** (`maintenance_predictive_reset`): data, **KM
obrigatório**, motivo ≥ 10 caracteres e o responsável da sessão; grava
`audit_logs` e o evento `manual_reset`; referência `manual_reset`.

---

## 6. Telas do portal (aba Preditiva)

Barra de filtros compartilhada com o módulo (operação, cidade/UF, placa, cluster,
período) mais os da preditiva: situação técnica, execução, conformidade,
criticidade, tipo de referência, tipo/subcategoria/marca/modelo, BR, liderança,
plano, frota ativa/inativa, **monitoramento** e **KM desatualizado**. Tudo na URL
(`pd_visao`, `pd_situacao`, `pd_execucao`, `pd_conformidade`, `pd_criticidade`,
`pd_referencia`, `pd_monitoramento`, `pd_km`, `plano`, `frota`, `pagina`,
`por_pagina`…). Os azulejos de situação (Em dia, Próximo, A programar, Vencido,
Crítico, Inspeção inicial, Sem KM) e de execução filtram e levam aos Alertas.

| Visão (`pd_visao`) | Conteúdo | Leitura |
|---|---|---|
| **Painel** (padrão) | KPIs: índice de saúde preditiva, backlog técnico, previsão de demanda, referência formal, KM desatualizado, em monitoramento; **previsão por janelas** (1.000 / 2.500 / 5.000 / 10.000 km e 7 / 15 / 30 / 60 dias, parametrizáveis); cobertura do plano técnico; **rankings** (frotas, clusters, modelos, tipos, operações, cidades, BRs, lideranças — só quem tem crítico + vencido > 0; cada barra abre os Alertas filtrados); clusters em atenção; **insights determinísticos** com "Ver recorte"; componentes do índice de saúde; tendência do backlog; verificações por semana; efetividade (verificações no prazo, NC → corretiva, dentro do SLA). | `maintenance_predictive_overview`, `_indicators`, `_trends` |
| **Alertas e ações** | Itens que pedem atenção, priorizados pelo servidor e **agrupados por placa** (linha da frota com contexto; itens abaixo), com situação, execução, conformidade, referência, marco, saldo/excedido e as ações Histórico, Registrar verificação, Gerar manutenção, Baixa manual. Paginado no servidor. | `_overview.alerts` |
| **Matriz** | Frota × item (colunas por item, agrupadas por cluster), cabeçalho e primeira coluna fixos; célula = situação com ícones de não conformidade, monitoramento, referência histórica e manutenção aberta, saldo/excedente e % consumido; clique abre o drawer. Paginada no servidor. | `_overview.rows` |
| **Indicadores** | Período: verificações por resultado e origem, conversão NC → corretiva, lead times, SLA por criticidade, recorrência (mesmo veículo × item não conforme de novo), previsto × realizado. | `_indicators` |
| **Qualidade** | Inconsistências abertas/resolvidas por tipo e severidade, com placa, item e mensagem; botão **Reprocessar** (capability `recalculate`). | `_quality`, `_quality_refresh` |
| **Auditoria** | Linha do tempo de eventos do motor por ciclo, veículo, tipo e período (quem, quando, origem, de → para, KM, resultado). | `_events` |
| **Envios** | Envios do aplicativo (protocolo, placa, responsável, totais, KM divergente) com detalhe, e a busca de verificações (placa, cluster, responsável, resultado, origem, período). | `_submissions_search`, `_verifications_search`, `_submission_detail` |

**Drawer do ciclo** (`maintenance_predictive_cycle_history`): situação técnica,
execução e conformidade; contexto da frota (tipo, modelo, operação, cidade/UF, BR,
liderança, KM oficial e idade); item (intervalos, bandas, criticidade, cobertura
por serviço, roteiro com tipos de resposta); referência; última manutenção e
última verificação em destaque; verificações (com origem e protocolo),
manutenções (com fornecedor), **linha do tempo** de eventos; ações Registrar
verificação, Gerar manutenção e Baixa manual conforme as capabilities.

**Home da Manutenção** (`Visão geral`) recebe de `maintenance_predictive_summary`:
preditivas críticas e vencidas, aguardando corretiva e previstas na janela de KM. O
Início da Liderança usa a mesma leitura.

Design: HFM Premium Design System (KpiCard, ChartCard, HBarChart, ColumnChart,
TrendChart, GaugeChart, InsightCard, StatusBadge, Table com cabeçalho fixo,
EmptyState/ErrorState). Falha em uma leitura mostra o erro naquele painel; nunca
zero como fallback.

---

## 7. Aplicativo › Verificação Preditiva de Frota

Rota `/aplicativos/verificacao-preditiva`, mobile-first (largura máxima de um
celular, alvos de toque ≥ 44 px, barra de ação fixa), mesmo padrão do Check List,
da Vistoria MTSR e da Vistoria de Pneus. Permissão de entrada `applications.view`;
para executar `applications.predictive.execute`. Quem só consulta vê a tela com
**Nova verificação** desabilitada e o motivo.

Fluxo: **início** (responsável = a própria conta, nunca digitado; verificação em
andamento; meus envios) → **frota** (só frotas ativas **do escopo** da pessoa e
**habilitadas** para o aplicativo na operação/tipo — `private.app_vehicle_eligible`,
mesma regra do Check List — ordenadas da pior situação para a melhor; busca no
servidor) → **identificação** (placa, frota, tipo/modelo, operação, responsável,
data, plano aplicável; KM oficial e sua idade; **KM do hodômetro** opcional quando
há oficial e obrigatório quando não há; divergência acima da tolerância — maior
entre 500 km e 5 % — exige justificativa; o KM oficial **não é alterado**) →
**roteiro** por cluster (um cartão por item com situação, marco, referência,
monitoramento e manutenção aberta; resultado Conforme / Monitorar / Não conforme /
Não realizada; passos do roteiro conforme o tipo; alvo do monitoramento;
descrição obrigatória em NC e não realizada; "abrir corretiva agora" marcado por
padrão) → **revisão** (totais, KM informado × oficial, observação geral) →
**envio** → **conclusão** (protocolo **VPF-AAAA-NNNNNN**, totais, corretivas
abertas/reaproveitadas, aviso de KM divergente) → **meus envios** com detalhe por
item (resultado, decisão do servidor, respostas, corretiva).

Servidor (`maintenance_predictive_app_*`): `context` (disponibilidade, responsável,
regras, vocabulário), `vehicles`, `roadmap`, `submit`, `my_submissions`,
`submission_detail`. O envio é **transacional e idempotente** por
`client_submission_id` (gerado no aparelho ao escolher a frota e guardado em
`localStorage` com o rascunho até o protocolo): reenviar devolve o **mesmo
protocolo** sem registrar nada de novo. Cada item vira uma verificação formal
(`maintenance_predictive_register`, origem `app`); a decisão (reiniciar, monitorar,
abrir corretiva) é do banco. Quem não tem a capability de gerar manutenção envia a
não conformidade sem abrir a corretiva (fica **aguardando corretiva** para a
gestão). O envio emite `maintenance.predictive.submitted` no outbox.

---

## 8. Eventos, qualidade de dados, fotos diárias e rotina

**`maintenance_predictive_events`** (imutável; só a função
`private.maintenance_predictive_event` escreve): `cycle_created`,
`cycle_deactivated`, `cycle_reactivated`, `history_reference`, `verification`,
`monitoring_started`, `monitoring_closed`, `maintenance_generated`,
`maintenance_restart`, `maintenance_reopened`, `manual_reset`, `status_changed`,
`plan_version`; origem `user` / `app` / `system` / `import`; autor com o nome real
da sessão, ou "Rotina automática" / "Importação" quando não há sessão.

**`maintenance_predictive_quality_issues`** (`private.maintenance_predictive_refresh_quality`):
detectada → mantida (`last_seen_at`) → resolvida (`resolved_at`) quando a condição
desaparece; nada é corrigido em silêncio. Tipos: `vehicle_no_plan`,
`plan_ambiguous`, `vehicle_no_km`, `km_stale`, `cluster_without_rule`,
`service_without_coverage`, `cycle_without_reference`, `maintenance_without_km`,
`verification_without_km`, `reference_in_future`, `reference_km_above_current`,
`negative_cycle`; severidade `low`…`critical`.

**`maintenance_predictive_snapshots`** (`private.maintenance_predictive_snapshot_daily`):
uma foto por dia, por organização e por operação, com as contagens por situação,
backlog, cobertura e KM desatualizado — base das tendências.

**Rotina diária** (`private.maintenance_daily_tick` v2, agendada em `pg_cron`
como antes): KM pendente, sincronização incremental dos ciclos, cache de situação
(`status_changed`), qualidade de dados e foto diária. **Recalcular ciclos**
(`maintenance_sync_predictive`, capability `recalculate`) faz o mesmo sob demanda,
para o universo ou para um veículo.

**Parâmetros** (`maintenance_settings`): `predictive_km_max_age_days` (30),
`predictive_sla_days` (`{"critical": 2, "high": 5, "medium": 10, "low": 20}`),
`predictive_forecast_km_windows` (`{1000,2500,5000,10000}`),
`predictive_forecast_day_windows` (`{7,15,30,60}`).

---

## 9. Indicadores e índice de saúde

- **Previsão de demanda**: itens cujo marco cai em cada janela de KM (saldo ≤ janela)
  e de dias.
- **Rankings**: críticos e vencidos por frota, cluster, modelo, tipo, operação,
  cidade, BR e liderança (contexto oficial na data).
- **Efetividade**: verificações no prazo (antes de vencer), conversão NC →
  corretiva, lead time NC → abertura → conclusão, **SLA por criticidade** (dias
  entre vencer e abrir/concluir, contra `predictive_sla_days`), recorrência.
- **Índice de saúde preditiva** (0–100, documentado no próprio payload):
  `100 − 10 × (Σ peso × itens ÷ itens monitorados) − 20 × (frotas sem plano ÷ frotas ativas)`,
  com pesos crítico 10, aguardando corretiva 8, vencido 6, sem KM 4, a programar 3,
  KM desatualizado 2, monitoramento 1. Os componentes aparecem no painel.
- **Insights determinísticos**: regras fixas sobre o recorte atual (concentração em
  um cluster/operação, janela de vencimento próxima, KM desatualizado acima do
  limiar, frotas sem plano, referências históricas…). Cada um leva ao filtro que o
  gerou. Nada é gerado por IA.

---

## 10. Segurança

**Capabilities** (migração `20261014120000`, compatíveis com as antigas):

| Código | O quê | Equivalente legado |
|---|---|---|
| `maintenance.predictive.view` | painel, matriz, alertas, qualidade, envios | `maintenance.view` |
| `maintenance.predictive.verify` | registrar verificação pelo portal | `maintenance.manage_predictive` |
| `maintenance.predictive.generate_maintenance` | abrir manutenção do item/NC | `maintenance.manage_predictive` |
| `maintenance.predictive.manual_reset` | baixa manual autorizada | `maintenance.manage_predictive` |
| `maintenance.predictive.plans.manage` | planos, itens, roteiros, cobertura, aprovação | `maintenance.manage_predictive` |
| `maintenance.predictive.recalculate` | recalcular motor, reprocessar qualidade | `maintenance.reprocess` |
| `maintenance.predictive.audit.view` | eventos do motor | `maintenance.view_audit` |
| `applications.predictive.execute` | executar o aplicativo e ver os próprios envios | — |

Padrões (`access_profile_defaults`, ajustáveis em Perfis & Permissões):
Administrador e Gestor de Frota recebem todas; Gestão `view` + `audit.view`;
Segurança `view`; Liderança de Operações `view`, `verify`,
`generate_maintenance` e o aplicativo; Operacional só o aplicativo. Toda permissão
de aplicativo depende de `applications.view`. Nenhum perfil ganha acesso pelo nome.

`private.maintenance_predictive_can(org, ação)` aceita o código novo **ou** o
legado equivalente, e cada RPC de escrita chama
`private.maintenance_predictive_require` na mesma transação. Esconder um botão não
é segurança.

**RLS**: as tabelas novas seguem o veículo (`vehicle_scope_ids`) e a organização;
leitura só com permissão de manutenção (ou, nos envios, o próprio responsável);
escrita apenas pelas funções `SECURITY DEFINER` (`revoke` de `anon`/`authenticated`,
`grant select` para `authenticated`). Multi-tenancy por `organization_id` em toda
tabela e FK composta onde já existia. Escopo da Liderança: a frota fora das
operações do vínculo não aparece em nenhuma leitura (suíte 39, T16).

---

## 11. Testes

**SQL** — `supabase/tests/remote/39_predictive_engine_v2.sql` (25 verificações,
fixture própria, termina em `raise exception 'ROLLBACK_TESTES…'`, nada persiste):

| Teste da especificação | Verificação na suíte |
|---|---|
| 1 Ciclo normal | T1 marco, saldo, % consumido, Em dia |
| 2 Marco ultrapassado | T2 excedido → Vencido (banda 4) |
| 3 KM + data | T3 pior cenário entre KM e dias |
| 4 Sem KM | T4 `no_km` + inconsistência |
| 5 Sem referência | T5 Inspeção inicial |
| 6 Conforme | T6 referência = verificação, ciclo reinicia |
| 7 Monitoramento | T7 sem alvo recusado; alvo reduz o marco |
| 8 Não conforme | T8 sem descrição recusada; ≥ A programar; corretiva |
| 9 Corretiva | T9 origem Preditiva, vínculo ciclo/item, execução |
| 10 Cobertura total | T10 conclusão reinicia (`maintenance_restart`) |
| 11 Cobertura parcial | T11 não reinicia |
| 12 Preventiva | T12 preventiva com cobertura total atualiza a referência |
| 13 Histórico | T13 referência "histórico" não formal |
| 14 Baixa manual | T14 KM/motivo obrigatórios, `audit_logs` com autor |
| 15 Alteração de plano | T15 motivo, versão, recálculo, histórico preservado |
| 16 Escopo | T16 Liderança A não vê a frota exclusiva da operação B |
| 17 Multi-tenant | T17 organização B não lê nada da A |
| 18 Idempotência | T18 gerar de novo não duplica; reenvio do app devolve o mesmo protocolo |
| 19 KM desatualizado | T19 flag + inconsistência, situação ainda calculada |
| 20 Regressão | T20 preventiva, corretiva, base geral, programação e KM seguem |
| — | TA app (contexto, veículos, roteiro, envio, detalhe), TO painel, TP ambiguidade de plano, TS RBAC por perfil |

**Playwright** — `tests/ui/maintenance.spec.ts` (aba Preditiva: painel, alertas
agrupados por placa, matriz, cadastros) e `tests/ui/predictive-app.spec.ts`
(início, perfil só consulta, escolha da frota com busca, KM divergente e sem KM
oficial, roteiro com tipos de resposta e bloqueios, revisão, protocolo com
corretiva, rascunho com a mesma chave após recarregar, detalhe do envio, Axe em
claro e escuro, celular sem rolagem horizontal), sobre as prévias
`/dev/preview-manutencao` e `/dev/preview-verificacao-preditiva`.

---

## 12. Código

- **Banco:** `supabase/migrations/20261014120000_predictive_engine_v2.sql`
  (Parte 1 estruturas e RBAC; 2 motor; 3 leituras; 4 aplicativo; 5 planos v2),
  sobre `20260928103000_maintenance_preventive_predictive.sql`.
- **Servidor:** `src/lib/maintenance/queries.ts` (`getPredictive*`,
  `searchPredictive*`), `actions.ts` (ações do portal com capability),
  `predictive-app.ts` e `predictive-app-actions.ts` (aplicativo), `types.ts`
  (vocabulário e rótulos).
- **Telas:** `src/app/(app)/frota/manutencao/predictive-*.tsx` (painel, executivo,
  alertas, matriz, indicadores, qualidade, auditoria, envios, drawer, diálogo de
  verificação), `catalog-forms-predictive.tsx` (planos, itens, roteiro, cobertura,
  vigência), `src/app/(app)/aplicativos/verificacao-preditiva/*`; prévias em
  `src/app/dev/preview-manutencao` e `src/app/dev/preview-verificacao-preditiva`.

---

## 13. Limitações reais (pendências)

- **Horas de motor**: guardadas no item, fora do cálculo (não há leitura oficial de
  horímetro no HFM).
- **Referência "medição MM de pneus"** do HFC não foi reproduzida: pneus têm o seu
  próprio motor em Gestão de Pneus; aqui o cluster de pneus segue as regras gerais.
- **Foto no roteiro** (`response_type = photo`) registra a identificação/descrição
  da foto; o upload de evidência fotográfica não faz parte desta etapa.
- **Previsto × realizado** começa a acumular a partir da ativação do cache de
  situação: ciclos antigos não têm "desde quando" retroativo.
- **CPK de pneus** continua fora do escopo, conforme a diretriz.
- **Índice duplicado em produção**: a migração v2 criou
  `maintenance_predictive_cycles_active_vehicle_idx`, idêntico ao índice
  `maintenance_predictive_cycles_vehicle_idx` que já existia. É inofensivo para
  as leituras e custa um pouco nas escritas; a limpeza (`drop index if exists
  public.maintenance_predictive_cycles_active_vehicle_idx;`) deve ser feita pelo
  SQL Editor, pois comandos `drop` não são enviados pela integração usada nas
  migrações.
