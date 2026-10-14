# HFC › Gestão Preditiva — mapeamento (somente leitura) e comparação com o HFM

Referência: projeto Lovable `e8a92f16-ab41-4b34-ada2-cddbed391b51` (Horizonte
Fleet Command), commit `0ea34206…` de 13/10/2026. Inspeção **somente leitura**
em 14/10/2026 (`read_file`, `list_files`, `list_edits`): nenhum código, dado,
migration, parâmetro ou publicação do HFC foi alterado. Complementa o
mapeamento geral de Manutenção de 28/09 (`hfc-maintenance-mapping.md`); o
histórico de edições do HFC não registra mudança no módulo preditivo depois
de 10/09/2026 ("Atualizou Matriz Preditiva", migration `20260910123321`), e as
duas migrations de outubro tratam de fidelização e aderência.

## 1. Telas e aplicativo

| Tela (rota) | Conteúdo |
|---|---|
| `/app/manutencao/preditiva` (`gestao-preditiva.tsx`) | 3 abas: **Painel** (`painel-preditivo.tsx`), **Matriz por cluster** (`matriz-preditiva-clusters.tsx`), **Alertas e ações** (`alertas-preditivos.tsx`); botão "Recalcular motor" (`canManageParametros`) |
| Painel | cartões por situação (Em dia, Próximos, A programar, Vencidos, Críticos, Inspeção inicial, Sem KM, Programadas); "Cobertura do plano técnico" (% frotas cobertas, itens monitorados, frotas sem plano); previsões **5.000 km** e **30 dias**; rankings por frota, cluster, operação e local (críticos). Cada cartão abre Alertas filtrado. |
| Matriz | linhas = placas; colunas = **nome do cluster** (duas inspeções do mesmo cluster colapsam numa célula); célula = situação técnica colorida, ícones de referência histórica / monitoramento / não conforme, saldo ou excedente; filtros texto, situação da frota (ativa/todas) e tipo de referência (formal, histórica, sem). Clique abre o drawer. |
| Drawer (`drawer-cluster.tsx`) | Resumo (referência: origem, tipo, data, KM, descrição, cobertura; KM atual, KM desde a referência, próximo marco, próxima data, saldo, execução; última manutenção real do cluster; última verificação; "Abrir manutenção do cluster"), Histórico (`manut_get_cluster_history`: manutenções + verificações) e Verificação (formulário de um ciclo) |
| Alertas | agrupados por placa (críticos primeiro), colunas frota/cluster, inspeção, KM atual, última execução, próximo marco, faltante/excedido, situação técnica, execução; ações Histórico, Verificar no app, Gerar verificação preditiva, Baixa manual |
| Cadastros › Planos Preditivos (`planos-preditivos.tsx`) | cabeçalho (nome, descrição, fonte, documento, OEM, versão, situação de aprovação como select livre), itens (cluster, inspeção, intervalos KM/dias/horas, alerta/programação/tolerância %, criticidade, ordem, ativo) com confirmação ao mudar campo sensível; checklist por item (`predictive_item_checklist`: descrição, tipo de resposta, obrigatório, aplicabilidade, ordem); duplicar plano no navegador (não atômico) |
| App `/app/verificacao-preditiva` | 4 passos: Identificação (placa) › Roteiro (responsável obrigatório; matrícula, data e KM opcionais; seleção de ciclos ordenados pela gravidade) › Verificação (checklist CONFORME / NÃO CONFORME / N/A por linha; desfecho CONFORME, MONITORAMENTO, NÃO CONFORME, NÃO REALIZADA; monitoramento com reavaliar em KM/dias) › Conclusão (totais e aviso de clusters não conformes). Não abre manutenção. |

## 2. Vocabulário (verbatim de `status.ts` / `preditiva-api.ts`)

* Situação técnica: `CRÍTICO`, `VENCIDO`, `A PROGRAMAR`, `PRÓXIMO`, `EM DIA`, `INSPEÇÃO INICIAL`, `SEM KM` (ordem de gravidade `manut_predictive_rank` 1…7).
* Execução: `NÃO PROGRAMADA`, `HÁ AGENDAR`, `AGENDADA`, `EM EXECUÇÃO`, `AGUARDANDO CORRETIVA`.
* Conformidade: `CONFORME`, `MONITORAMENTO`, `NÃO CONFORME`, `NÃO REALIZADA`, `SEM VERIFICAÇÃO FORMAL`.
* Referência: `VERIFICAÇÃO PREDITIVA`, `MANUTENÇÃO COM COBERTURA TOTAL`, `MEDIÇÃO MM PNEUS`, `BAIXA MANUAL`, `HISTÓRICO DO CLUSTER`, `SEM REFERÊNCIA` (rótulos curtos VERIF, MANUT, MM PNEUS, BAIXA, HIST, —).
* Cobertura: `TOTAL`, `PARCIAL`, `NENHUMA`, `HISTÓRICO`. Criticidade: Crítica, Alta, Média, Baixa.

## 3. Motor (migrations, última definição de cada função)

* **Plano aplicável** (`manut_predictive_resolve_plan`): aprovado e ativo, do mesmo tipo de equipamento; subcategoria, modelo e marca nulos ou iguais; modelo específico › subcategoria › maior versão. Ambiguidade resolvida em silêncio.
* **Referência** (`manut_predictive_resolve_cycle_reference`, `20260910123321`): (1) cluster "Pneus%": última medição MM (`tire_daily_snapshots`) com KM na data; (2) último evento com `reseta_ciclo` e KM — verificação, baixa manual ou manutenção com cobertura total; (3) última manutenção Concluída do cluster (histórico, não formal); (4) sem referência.
* **KM**: `vw_km_latest_vehicle` (KM e data da última leitura). Sem KM → `SEM KM`. Não há parâmetro de idade máxima do KM.
* **Cálculo** (`manut_predictive_sync_vehicle`, `20260729142306`): marco = KM ref + intervalo; faltante/excedido; bandas por percentual do intervalo (`EM DIA` acima do alerta, `PRÓXIMO`, `A PROGRAMAR` até 0, `VENCIDO` dentro da tolerância, `CRÍTICO` além); dias idem com `CURRENT_DATE` (UTC); **pior dos dois**; monitoramento ativo substitui o intervalo pelo alvo reduzido; `NÃO CONFORME` sem manutenção concluída depois eleva a no mínimo `A PROGRAMAR`. Execução pela última `maintenance_records` não concluída do item; `AGUARDANDO CORRETIVA` se houver corretiva aberta do item. Grava tudo em `predictive_vehicle_cycles` (upsert por placa × item); veículo inativo ou sem plano → ciclos **apagados**.
* **Verificação** (`manut_register_predictive_verification`): evento em `predictive_cycle_events`; `CONFORME`/`MONITORAMENTO` com KM reiniciam; `MONITORAMENTO` cria `predictive_monitoring_conditions` (km_alvo = KM + monitor_km, data_alvo = data + monitor_dias); `NÃO CONFORME` não reinicia e sinaliza manutenção; `NÃO REALIZADA` só registra. App: `manut_submit_predictive_verification` (cabeçalho em `predictive_verifications`, totais) e `manut_get_verification_context`.
* **Manutenção** (`manut_generate_predictive_maintenance`): idempotente por placa × item não concluída; insere Preditiva 'Gestão Preditiva' 'Há Agendar' com KM da Base KM e vínculos `predictive_cycle_id` / `predictive_plan_item_id`. Conclusão com cobertura: `trg_mr_predictive` → `manut_predictive_apply_coverage` (ignora o tipo Preditiva — só `manut_complete_predictive_inspection`, sem chamador no front, reinicia).
* **Baixa manual** (`manut_register_predictive_reset`): data, KM, motivo, responsável e origem "Manual Autorizada"; evento com `reseta_ciclo`.
* **Planos**: `manut_update_predictive_plan_item` incrementa a versão em campo sensível e recalcula (`placas_afetadas`, `ciclos_recalculados`); `predictive_plan_change_log` (campo, valor anterior/novo, versão, usuário, motivo).
* **Job**: `POST /api/public/hooks/manut-daily-job` (service role, **sem autenticação**) → `manut_job_diario` → resolve KM, vincula preventivas, estatísticas/alertas legados (10%/20%), `manut_predictive_sync_all`. Sem pg_cron.
* **Legado coexistente**: `predictive_parameters`, `predictive_stats`, `predictive_alerts` (Comparativo × Realidade, importação "Param. Preditiva").

## 4. RBAC

`manutencao-rbac.ts` decide por **nome do perfil** (`capsFor`: `canCreate`, `canManageParametros`, …) e só no cliente; as RPCs não conferem permissão por escopo. Lideranças só são filtradas na Programação.

## 5. Limitações observadas (evidência nos arquivos lidos)

| # | HFC | Consequência |
|---|---|---|
| 1 | Identidade por **placa em texto** (`placa_norm`) em ciclos, eventos, verificações e manutenções | troca de placa ou erro de digitação quebra o histórico; sem FK com a frota |
| 2 | Ciclos **apagados** quando o veículo fica inativo ou perde o plano | histórico do ciclo some; "inspeção inicial" volta ao reativar |
| 3 | Matriz indexada pelo **nome** do cluster | duas inspeções do mesmo cluster colapsam; renomear cluster muda as colunas |
| 4 | Sem idade máxima do KM: leitura antiga vale como atual | status "em dia" com hodômetro parado |
| 5 | Datas em `CURRENT_DATE` (UTC) | depois das 21h BRT o "hoje" é amanhã |
| 6 | Concluir a manutenção preditiva pela Programação não reinicia o ciclo (`apply_coverage` ignora o tipo Preditiva); `manut_complete_predictive_inspection` sem chamador | ciclo fica vencido depois do serviço |
| 7 | Verificação pelo drawer sem campos obrigatórios; `predictive_origin_event_id` nunca preenchido; abertura manual grava `NÃO CONFORME` mesmo sem não conformidade | rastreabilidade fraca |
| 8 | Duplicar plano no navegador, item a item, sem transação; sem criar/excluir plano ou item; situação de aprovação é um select livre, sem fluxo | planos inconsistentes |
| 9 | `manut_get_predictive_alerts` devolve **todos** os ciclos e a UI filtra/agrupa no navegador; sem paginação | não escala |
| 10 | Endpoint público do job sem autenticação | risco operacional |
| 11 | RBAC pelo nome do perfil, no cliente | sem RLS por escopo nas leituras preditivas |
| 12 | Vocabulário duplicado (`MONITORAMENTO` × `MONITORAR`), checklist renderizado com campos inexistentes (`c.item`, `c.criterio_aprovacao`) | telas em branco / cores erradas |
| 13 | Dois modelos de parâmetros preditivos (legado e planos) | indicadores divergentes |

## 6. O que o HFM reaproveita (comportamento) e o que melhora

Reaproveita: plano técnico aprovado por tipo/subcategoria/marca/modelo; ciclo por frota × item; três bandas percentuais; pior cenário KM × dias; situação técnica separada da execução e da conformidade; monitoramento como alvo reduzido; não conforme não reinicia e abre corretiva; cobertura total reinicia; baixa manual auditada; matriz frota × cluster; app em quatro passos.

Melhora (ver `predictive-maintenance.md`): ids oficiais e FKs, ciclos desativados e nunca apagados, versões com snapshot e motivo, fluxo de aprovação com transições, RPCs transacionais e idempotentes, pg_cron interno, RBAC na matriz oficial com RLS por escopo, KM oficial com idade máxima parametrizada, eventos imutáveis por ciclo, qualidade de dados persistida, previsões em várias janelas, rankings, tendências, recorrência, comparativo previsto × realizado com SLA por criticidade, leituras paginadas no servidor e aplicativo `Aplicativos › Verificação Preditiva de Frota` com protocolo e idempotência.
