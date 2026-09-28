# HFC › Manutenção — mapeamento (somente leitura) e comparação com o HFM

Referência: projeto Lovable `e8a92f16-ab41-4b34-ada2-cddbed391b51` (HFC). A inspeção foi **somente leitura**, em 28/09/2026. Nada no HFC foi alterado: nenhum código, dado ou configuração mudou, nenhuma migration foi executada e nenhuma versão foi publicada. O módulo do HFM está descrito em [`maintenance.md`](./maintenance.md).

## O que foi inspecionado e o que não foi

| Fonte | Situação |
|---|---|
| Código de telas e serviços (`src/routes/app.manutencao*`, `src/components/manutencao/*`, `src/lib/manutencao-*`, `fleet-scope*`, GPAC) | Lido com `read_file`/`list_files` |
| 174 migrations SQL do HFC (20260605 → 20260917) | Todas lidas. Fórmulas extraídas da **última** definição de cada função. |
| Inventário do banco de produção (tabelas, estimativa de linhas, RLS ligada) | Coletado: **uma** consulta respondeu |
| Colunas, constraints, índices, políticas RLS, contagens exatas, valores distintos, jobs do pg_cron e grants no banco de produção | **Não coletado.** Depois da primeira consulta, todas as seguintes, inclusive `SELECT 1`, deram timeout de 60 s no `query_database` do Lovable, repetidamente, por ~50 min. O que o banco tem de diferente das migrations **não foi verificado** e não está descrito aqui. |

## Como o HFC funciona (resumo com evidência)

### Tabelas
- **Registro de manutenção:** `maintenance_records` (~2.429 linhas) guarda a identidade pela **placa em texto**. Contexto, tipo, categoria, situação e parceiro também são texto. Há FKs opcionais `servico_id`, `fornecedor_id` e `frota_id`.
- **Histórico:** `maintenance_events` (~5.643) e `maintenance_status_history`.
- **Cadastros:** `maintenance_services` (149), `maintenance_suppliers` (92) e `service_clusters`.
- **Preventiva:** `preventive_rules` e `preventive_cycles` (2.475).
- **Preditiva:** `predictive_plans`, `predictive_plan_items`, `predictive_item_checklist`, `predictive_vehicle_cycles` (792), `predictive_cycle_events`, `predictive_verifications`, `predictive_service_coverage`, `predictive_alerts`, `predictive_parameters` e `predictive_stats`.
- **KM:** `km_daily_readings` (72.554) e o ecossistema `km_*`.
- **Ponte com o Check List (GPAC):** `gpac_plan_maintenance_links` (1.336) e `gpac_question_service_mappings` (28).

### Fórmulas (migrations)
- **TMM** (`manut_compute_tmm`): vai de `data_entrada` + `horario_entrada` até `data_saida` + `horario_saida`.
  - Hora ausente vale 00:00 na entrada e 23:59 na saída, e o cálculo é feito em UTC.
  - Registros abertos recebem um TMM "corrente" até `now()` que **nunca é recalculado**.
  - Mudar só o horário não dispara recálculo.
- **Situação** (`manut_apply_status_change`): 7 valores (inclui "Reprogramado"). **Não há matriz de transição**: qualquer situação vai para qualquer outra.
- **Preventiva:** o marco é regra × ciclo. As situações são Não atingida / A programar / Vencida / Crítica / Realizada, e a geração é por `manut_schedule_preventive_cycle`, com bloqueio de duplicidade.
- **Preditiva:** as bandas de alerta, programação e tolerância são percentuais do intervalo (KM e dias). A referência segue esta precedência: verificação, depois manutenção, depois reinício manual, depois histórico. Um resultado não conforme gera manutenção.
- **KM de entrada** (`manut_resolve_km_entrada`): busca a data exata, senão a última leitura anterior, senão a primeira posterior.

### Telas
Dashboard, Base Geral, Programação & Execução, Preventiva, Preditiva, Cadastros e Importações, mais o wizard "Lançar nova manutenção" e a lista de planos GPAC com o botão "Abrir Manut.".

## Fragilidades do HFC e como o HFM trata cada uma

| # | HFC (evidência) | HFM |
|---|---|---|
| 1 | Identidade pela **placa em texto**; contexto (operação, local, líder) em texto e agrupado pelo vínculo **vigente**, não pelo da data do fato | FK `vehicle_id` (uuid oficial); contexto resolvido **na data** (BR de fidelização → alocação; liderança vigente) e guardado em snapshot com os ids oficiais |
| 2 | Situação sem matriz de transição; edição da situação contorna a RPC | Máquina de estados no banco (`maintenance_transition_allowed`); toda mudança por RPC transacional com evento na trilha |
| 3 | Reprogramação em 3 chamadas não atômicas; valor anterior só em texto livre | `maintenance_reschedule` numa transação; evento com `before`/`after`, motivo e autor |
| 4 | Agendar/iniciar/concluir em duas chamadas cada, sem transação; multisserviço cria N registros sem transação | Cada ação é uma RPC; uma manutenção com N itens criada numa transação |
| 5 | TMM "corrente" congelado; hora ausente vira 00:00/23:59 em UTC | TMM só da entrada e saída reais das concluídas (coluna gerada); `exact` com hora, `date` sem hora (marcado "≈") |
| 6 | "Hoje" em UTC no front (depois das 21h BRT vira amanhã) | "Hoje" do banco pelo fuso da organização (`maintenance_today`) |
| 7 | Duplicidade só aviso no cliente, só o 1º serviço | Bloqueio no banco para qualquer serviço ou cluster equivalente em aberto; exceção só com justificativa gravada |
| 8 | KM manual sem justificativa obrigatória | Justificativa obrigatória (check no banco); divergência sinalizada, não bloqueia |
| 9 | Wizard descarta `preventive_cycle_id` (ciclo só pelo nome "MP3") | Vínculo por `preventive_cycle_id`; índice único impede duas abertas no mesmo ciclo |
| 10 | Prefill do GPAC grava `data_entrada = hoje` em "Há agendar" | Abertura a partir de apontamento não inventa entrada; entrada é sempre real e ≤ hoje |
| 11 | RBAC por nome de perfil (`capsFor`), fora da matriz de permissões; escopo da liderança só na Programação | 20 permissões na matriz oficial (Perfis & Permissões); RLS por organização + operação/veículo em todas as leituras; RPCs conferem permissão e escopo |
| 12 | Endpoint público `POST /api/public/hooks/manut-daily-job` roda o job com service role **sem autenticação** | Rotina diária no pg_cron dentro do banco (`hfm_maintenance_daily`), sem endpoint exposto |
| 13 | Base Geral carrega até 20.000 linhas no cliente e agrupa lá | Lista paginada e ordenada no servidor; hierarquia agregada no banco |
| 14 | Cache não invalidado (telas desatualizadas após editar) | Leitura por navegação/refresh do servidor após cada escrita |
| 15 | Histórico sem autor e sem visão consolidada do registro | Gaveta de detalhe com trilha (autor real, de → para, motivo, antes/depois), KM, serviços, apontamentos e reincidência |
| 16 | Horas de motor, criticidade e tempo padrão dos serviços carregados e não usados | Criticidade e horas previstas usadas (SLA e selos); horas de motor guardadas e declaradas como **pendência** |

## O que o HFM reaproveitou do HFC (comportamento, não código)
- **Semântica:** agendamento é previsto; entrada e saída são reais.
- **Vocabulário:** Há agendar / Agendado / Em execução / Concluído.
- **Ciclos MP1..n:** marco, faixa de alerta e tolerância.
- **Preditiva:** situação técnica separada da execução, verificação com roteiro e cobertura de serviço.
- **Mapeamento pergunta → serviço:** equivalente ao `gpac_question_service_mappings`, agora `maintenance_checklist_service_links` pela chave estável da pergunta.
- **Indicadores:** reincidência por veículo + cluster com janela de 30 dias; aging por faixas.
- **Importação:** por lotes, com prévia e idempotência.
