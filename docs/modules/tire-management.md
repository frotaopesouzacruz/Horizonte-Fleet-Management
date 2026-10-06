# Gestão de Frota › Gestão de Pneus

Rota: `/frota/pneus` (ficha do pneu: `/frota/pneus/<tire_id>`) · Menu:
**Gestão de frota → Gestão de Pneus** · Permissão de entrada: `tires.view` ·
Migrations: `supabase/migrations/20261006100000_tires_foundation.sql` …
`20261006105000_tires_repair_lookup.sql` (base) e
`20261007100000_tires_sharepoint_sync.sql` … `20261007104000_tires_language.sql`
(evolução: sincronização, conformidade, histórico de KPIs, auditoria e
linguagem) · Testes de banco: `supabase/tests/remote/32_tires.sql` e
`33_tires_evolution.sql` · Integração: `tests/integration/tires-sync.spec.ts`.

Documentos irmãos: [`tire-sync-sharepoint.md`](./tire-sync-sharepoint.md)
(sincronização automática com a planilha oficial no SharePoint),
[`rodopar-import.md`](./rodopar-import.md) (pipeline oficial Rodopar 10 —
sincronização e envio manual de contingência) e
[`tire-inspection-app.md`](./tire-inspection-app.md) (aplicativo Vistoria de
Pneus e conciliação).

A fonte oficial dos pneus é a planilha **Base Geral Pneus Rodorpar.xlsx**
(relatório Rodopar 10) no SharePoint, sincronizada automaticamente. Cada
sincronização confirmada gera os **dados da data de referência**; a tela
sempre lê os dados de uma data (os mais recentes por padrão, ou outra
escolhida no filtro "Data dos dados"). Tudo o que a tela mostra — classe do
sulco, prazos, regra de PSI, criticidade, conformidade, auditoria — é
calculado no banco a partir de `private.tire_rows` e das definições
centralizadas; o navegador só apresenta. O termo "fotografia" não é mais
usado na interface (textos antigos gravados na trilha são exibidos com a
linguagem atual, sem reescrever o registro).

---

## 1. Modelo de dados

| Tabela | Papel |
|---|---|
| `tires` | Identidade do pneu (`id` = `tire_id`, Nº Fogo **texto** único por organização), marca/modelo/dimensão, situação/posição/veículo correntes, presença (`present`/`absent` + `absent_since`). |
| `tire_daily_snapshots` | Dados diários: uma linha por pneu × data de referência, com os valores brutos do Rodopar preservados e os normalizados (situação canônica, sulcos 1–4, menor informado × calculado, PSI, datas, KM, contexto operacional na data, flags de qualidade). Somente inserção — a única atualização permitida é a revisão do mesmo dia, que arquiva a versão anterior. |
| `tire_snapshot_revisions` | Versões anteriores das linhas do dia substituídas por uma revisão do mesmo dia (linha completa). |
| `tire_events` | Linha do tempo derivada da comparação entre as datas dos dados (criação, medição, calibragem, posição, frota, vida, situação, ressolagem, descarte, estoque, ausente, reaparecido). Sem custo. |
| `tire_import_batches` / `tire_import_staging` | Lote (origem `sharepoint` ou `upload`, vínculo com a execução da sincronização, `superseded` quando revisado no mesmo dia) e área de preparação (nada vai para `tires` antes da confirmação). |
| `tire_sync_sources` / `tire_sync_runs` | Fonte oficial no SharePoint (site, biblioteca, caminho, ids resolvidos, última versão lida — sem segredo) e cada execução da sincronização (status, etapa, arquivo, eTag, hash, estrutura, contadores, erro, log). |
| `tire_kpi_schedules` / `tire_kpi_runs` / `tire_kpi_values` | Agenda da captura de indicadores (padrão semanal, sexta 22h), execuções e valores imutáveis por indicador × dimensão (numerador, denominador, %, quantidade). |
| `tire_audit_rules` / `tire_data_findings` / `tire_audit_scans` | Central de Auditoria dos Dados: catálogo de regras, achados com ciclo de vida (aberto/resolvido, primeira/última detecção, reaberturas) e registro de cada varredura. |
| `tire_parameter_sets` | Parâmetros gerais **com vigência** (prazos, limites, tolerâncias, SLAs). |
| `tire_pressure_rules` | Regras de PSI (mín/ideal/máx) e sulco legal/atenção por tipo de equipamento × dimensão × posição/eixo, com vigência. |
| `tire_positions`, `tire_layouts`, `tire_vehicle_type_layouts`, `tire_vehicle_layouts` | Dicionário de posições (grupo/índice do eixo, lado, rodado, ordem) e layouts por tipo de equipamento ou por veículo. O diagrama de eixos é derivado daqui — nada fixo no código. |
| `tire_inspections`, `tire_inspection_items`, `tire_inspection_status_history` | Vistorias de campo (leitura cega), itens por posição com a referência e as divergências, e o histórico de situações. |
| `tire_repairs` | Consertos por Nº Fogo, com o veículo resolvido na data do serviço. |
| `tire_maintenance_service_kinds` | Quais serviços do catálogo da Gestão de Manutenção são alinhamento, balanceamento, ambos ou serviço de pneu. |
| `tire_audit_events` | Trilha do módulo (importações, decisões, parâmetros, consertos, exportações) com a pessoa autenticada como autora. |

## 2. Regras de cálculo (`private.tire_rows`)

| Regra | Definição |
|---|---|
| Situação | `em_uso`, `estoque`, `ressolagem`, `descartado`, `baixado`, `outro` (da coluna *Situação Pneu*; a *Condição* é só recomendação). |
| Sulco mínimo | O **informado** pelo Rodopar; o **calculado** (menor dos sulcos 1–4) é guardado ao lado e a divergência além da tolerância é sinalizada. |
| Classe do sulco | sem medição → `sem_medicao`; ≤ sulco legal da regra aplicável → `abaixo_legal`; ≤ crítico → `critico`; ≤ atenção → `atencao`; senão `adequado`. |
| Prazo de medição / calibragem | sem data → `sem_registro`; dias desde a data ≤ "em dia até" → `em_dia`; ≤ "próximo até" → `proximo`; acima → `vencido` (dias contados até a data dos dados/hoje). |
| PSI | sem leitura → `sem_calibragem`; sem regra aplicável → **`sem_parametro` (nunca adequado)**; abaixo do mínimo → `baixa`; acima do máximo → `excesso`; senão `adequada`. Vence a regra mais específica (dimensão > posição > eixo > tipo) vigente na data. **Não existe PSI universal.** |
| Alerta de ressolagem | Alerta **operacional** (não financeiro): condição "RECAPAR" do Rodopar (se o parâmetro mandar usar) e/ou sulco ≤ limite configurado. |
| KM | KM Rodado/KM Real guardados como vieram; KM Real negativo é inconsistência de qualidade e nunca é somado. Não substitui a Gestão de KM. |
| Severidade | Pontuação por pneu em uso (sulco abaixo do legal/crítico/atenção, prazos, PSI fora, divergência de sulco, alerta de ressolagem) → `critica` ≥ 100, `alta` ≥ 50, `media` ≥ 20, `baixa` > 0, `ok`. |

### Definições centralizadas (uma regra, um lugar)

Funções do banco usadas por todas as telas, exportações e capturas
(`20261007101000_tires_conformity_reads.sql`; `tires_definitions` devolve o
texto com os parâmetros vigentes):

| Conceito | Definição |
|---|---|
| Pneu em uso | Situação canônica `em_uso`. **Base de todos os percentuais de conformidade.** |
| Fora da frota | Qualquer situação diferente de em uso. |
| Disponível | Em estoque com sulco adequado ou em atenção (apto para montagem). |
| Sulco OK (MM conforme) | Classe `adequado` ou `atencao` (acima do crítico e do legal da regra). Sem medição = não conforme. |
| Prazo de medição / calibragem OK | `em_dia` ou `proximo` (dentro do prazo); `vencido` e `sem_registro` = não conforme. |
| Próximo do vencimento | Entre o "em dia até" e o "próximo até" — ainda é prazo OK. |
| Prazo vencido | Além do "próximo até"; dias de atraso contados a partir desse limite. |
| PSI OK | `adequada` (faixa da regra mais específica). Sem regra = sem parâmetro (nunca adequado); sem leitura = não conforme. |
| **Conformidade Geral de Calibragem** | Prazo de calibragem OK **E** PSI OK. Calibragem no prazo com pressão inadequada **não** é conforme. |
| **Conformidade Geral dos Pneus** | Sulco OK **E** Prazo de medição OK **E** Prazo de calibragem OK **E** PSI OK. Basta um falhar. |
| Motivos | Código por critério que falhou (sulco abaixo do legal/crítico/sem medição, medição vencida/sem registro, calibragem vencida/sem registro, PSI baixa/excesso/sem parâmetro/sem leitura). |
| Criticidade | A severidade documentada acima: Crítico ≥ 100, Alto ≥ 50, Médio ≥ 20, Baixo > 0. Grupo (Prioridades) = pior pneu; ordem = críticos, altos, médios, não conformes. |

Percentuais = itens OK ÷ pneus em uso (sem registro conta como não conforme e
aparece separado como lacuna). A "aderência" das telas e exportações antigas
usa a mesma base desde esta versão. **Cobertura** = pneus com registro ÷ em
uso; **índice de qualidade** = pneus sem inconsistência ÷ total.

Valores sem base (divisão por zero, leitura que falhou) aparecem como "—",
nunca como 0.

## 3. Telas (abas pela permissão)

O cabeçalho (título, abas, filtros e a origem dos dados — "Dados de dd/mm" e
"Atualizado … · SharePoint/envio manual") segue o padrão das demais telas do
sistema e rola com a página.

| Aba | Permissão | Conteúdo |
|---|---|---|
| Visão geral | `tires.dashboard.view` | **Dados Gerais dos Pneus** (recolhível; total, em uso, estoque, disponíveis, em manutenção, fora da frota, descartados) com "Perfil dos Pneus" e "Onde estão os pneus em uso" (gráficos com filtro cruzado); **Saúde e Prazos** (prazos e pressão dos pneus em uso + distribuições); **Conformidade** (Geral dos Pneus e Geral de Calibragem, motivos e critérios); **Prioridades** com "Agrupar por" Operação/Local de Operação/Liderança e drill-down dos pneus; alertas determinísticos (`tires_overview`, `tires_priorities`). |
| Base geral | `tires.base.view` | Por Frota (agrupada por Operação/Local/Liderança, grupos expansíveis — `tires_base_groups` — ou sem agrupamento), por Nº Fogo e fora da frota; conformidade e motivos por pneu; **croqui interativo** do veículo (o mesmo componente da ficha, da aba Pneus do veículo e do app Vistoria); ficha 360°. |
| Aderência MM | `tires.measurement.view` | Sub-visões **Sulco (MM)** e **Prazo de medição** (`tires_indicator`): cartões, distribuição (histograma de MM; dias de atraso), quebras por Operação/Local/Liderança/Tipo/Perfil, evolução semanal e pendências paginadas. |
| Aderência calibragem | `tires.calibration.view` | Sub-visões **Calibragem** (prazo + PSI, conformidade geral de calibragem), **Prazo de calibragem** e **Pressão (PSI)** (faixa por regra; distribuição do desvio %, ranking, lacunas de regra). |
| Evolução dos indicadores | `tires.dashboard.view` | Histórico imutável das capturas semanais (`tires_kpi_history`): semana × semana, mês × mês, atual × anterior, variação, tendência e ranking por dimensão. |
| Cronograma | `tires.schedule.view` | Próximas medições/calibragens por frota e agenda (vencidos, hoje, 7 e 15 dias, sem registro). |
| Vistorias recebidas | `tires.view` (decidir: `tires.inspection.review`) | Fila de revisão, gaveta com leitura × referência, transições. |
| Serviços | `tires.services.view` (registrar: `tires.services.manage`) | Consertos por Nº Fogo; alinhamento e balanceamento lidos da Gestão de Manutenção (sem base paralela). |
| Auditoria dos dados | `tires.quality.view` | **Central de Auditoria dos Dados de Pneus** (`tires_audit_center`): achados por regra/categoria/gravidade/operação/local/liderança, onde, campo, valor encontrado × esperado, primeira/última detecção, resolução; reexecução sob demanda. |
| Histórico | `tires.history.view` / `tires.audit.view` | Eventos dos pneus e trilha de auditoria (mantido: é a linha do tempo dos pneus e a trilha de decisões, não o histórico de importações). |
| Sincronização Rodopar | `tires.import` (ver: `tires.audit.view`) | Estado da fonte oficial, "Sincronizar agora", histórico de sincronizações com log e reprocessamento; envio manual como contingência (antiga "Importação Rodopar" — links `aba=importacao` continuam abrindo esta aba). |
| Parâmetros | `tires.view` (editar: `tires.parameters.manage`) | Prazos e limites, regras de PSI, posições, layouts, vínculos de layout, serviços da Manutenção, **fonte oficial (SharePoint)** e **agenda dos indicadores** — sempre por formulário. |

Filtros padronizados (URL): `data` (data dos dados; `foto` antigo ainda é
aceito), `operacao` → `local` → `lideranca` → `tipo` → `veiculo` (cascata pelas
combinações reais devolvidas pelo banco — trocar um nível limpa os de baixo),
`q` (Nº Fogo/placa/frota), e em "Mais filtros": `situacao`, `marca` →
`modelo`, `dimensao`, `conformidade`, `conf_calibragem`, `sulco`, `medicao`,
`calibragem`, `pressao`, `severidade`, `vida`, `posicao`, `uf`, `br`,
`filial`, `qualidade`, `ressolagem`; `sem` (grupos sem operação/local/
liderança). O banco recebe ids e códigos canônicos.

## 3.1 Histórico de indicadores (snapshots)

`20261007102000_tires_kpi_history.sql`. A cada 15 minutos o pg_cron
(`hfm_tires_kpi_tick`) confere a agenda; no horário (padrão **sexta-feira,
22:00, America/Sao_Paulo**) captura uma vez os indicadores — Conformidade
Geral dos Pneus, Conformidade Geral de Calibragem, Sulco, Prazo de Medição,
Prazo de Calibragem, PSI, Qualidade dos dados e quantidades — no Geral e por
Operação, Local de Operação, Liderança, Tipo de equipamento e Perfil (medida),
com competência, horário planejado e real, semana ISO, mês e ano.

- **Imutável**: valores nunca são atualizados nem excluídos (gatilhos); a
  série não muda quando a planilha muda depois — a mudança aparece na próxima
  captura.
- **Sem duplicidade**: uma captura concluída por período (índice único) e uma
  em andamento por organização.
- **Falha parcial**: valores numa subtransação; erro → `falhou` com motivo, sem
  valor pela metade; até 3 tentativas automáticas.
- **Recuperação**: se o horário passou sem captura, roda depois (até
  `catch_up_days`, padrão 3) avaliando os dados como estavam na data do
  período; passou a janela → `ignorada` (nunca inventa valor). Reprocessar só
  período sem captura concluída.
- **Mês × mês** = última captura semanal de cada mês.
- Escopo: quem enxerga só algumas operações vê as linhas dessas operações (o
  "Geral" vira a soma delas).

## 3.2 Central de Auditoria dos Dados

`20261007103000_tires_audit_center.sql`. 34 regras em 10 categorias (Cadastro,
Duplicidade, Relacionamento, Localização, Posição e eixo, Medição,
Calibragem, Datas, Configuração, Histórico) — entre elas: Nº Fogo duplicado e
posição duplicada (lote bloqueado), pneu duplicado (Nº Fogo que só difere por
zeros à esquerda), em uso sem veículo, frota sem correspondência no cadastro,
frota sem operação/local/liderança, pneu sem posição, posição inválida/fora
do layout/vazia, quantidade incompatível de pneus, eixo com medidas
diferentes, fabricante/modelo/medida ausentes, MM e PSI inválidos, medição e
calibragem inexistentes, sem parâmetro de PSI, datas futuras/inválidas/
inconsistentes, registro desatualizado, vida que regride, retorno após baixa,
pneu ausente na planilha. A varredura roda na confirmação dos dados,
diariamente (pg_cron `hfm_tires_audit_daily`, 06:20) e sob demanda; achados
que somem são resolvidos, e os que voltam são reabertos. Nada é corrigido
automaticamente — a correção é na origem.
Exportação XLSX (`tires.export`) em `/frota/pneus/exportar/<tipo>` com os mesmos
filtros, todas as páginas, registrada em `tire_audit_events` antes do download.

## 4. Permissões e perfis

Permissões oficiais (módulo `tires`): `tires.view`, `tires.dashboard.view`,
`tires.base.view`, `tires.history.view`, `tires.measurement.view`,
`tires.calibration.view`, `tires.schedule.view`, `tires.inspection.review`,
`tires.import`, `tires.export`, `tires.parameters.manage`,
`tires.services.view`, `tires.services.manage`, `tires.quality.view`,
`tires.audit.view`, mais `applications.tires.execute` (aplicativo).

Padrões da matriz (ajustáveis em **Administração › Perfis e Permissões**; nada
é concedido pelo nome do perfil): Administrador e Gestor de Frota — todas;
Gestão — leitura, qualidade, exportação e auditoria; Segurança — leitura,
qualidade e exportação; Liderança de Operações — leitura gerencial (visão,
base, histórico, aderências, cronograma, serviços) e o aplicativo; Operacional
— só o aplicativo.

## 5. Segurança

- RLS em todas as tabelas por organização; leitura de pneus/dados diários/eventos
  também pelo escopo de veículo/operação da pessoa
  (`private.tire_vehicle_visible`). O filtro do navegador nunca é a barreira.
- Toda escrita é rotina `security definer` com `private.tire_require` (permissão
  no banco) e trilha em `tire_audit_events` com o nome da pessoa autenticada.
- Paginação no servidor em todas as listas; nada carrega milhares de pneus para
  filtrar no navegador.

## 6. Integrações

| Módulo | Como |
|---|---|
| Cadastro de Frotas | N. Frota do Rodopar → `vehicles` (código de frota ou placa); **nenhum veículo é criado**. Aba **Pneus** na ficha do veículo (`tires_vehicle_summary`, pelo id). |
| Operações, BRs, Fidelização, Lideranças, Filiais | Contexto operacional resolvido na data dos dados/vistoria e congelado no registro; alimenta filtros e quebras. |
| Tipos de Equipamento | Layout de posições por tipo (`tire_vehicle_type_layouts`) e regras de PSI por tipo; o módulo "Pneus" passa a disponível no catálogo de módulos. |
| Aplicativos | Elegibilidade App × Operação × Tipo para a Vistoria de Pneus. |
| Gestão de Manutenção | Alinhamento/balanceamento lidos das manutenções oficiais pelo mapeamento de serviços; consertos podem citar o serviço e o fornecedor do catálogo da Manutenção. |
| Gestão de KM | Não há substituição: o KM do Rodopar fica só como dado do pneu. |
| SharePoint (Microsoft Graph) | Fonte oficial sincronizada — ver [`tire-sync-sharepoint.md`](./tire-sync-sharepoint.md). |
| Outbox | `tires.snapshot.confirmed`, `tires.sync.failed`, `tires.inspection.returned`, `tires.inspection.persistent_divergence`. |

## 7. Testes

- Banco: `supabase/tests/remote/32_tires.sql` (duas datas de dados sintéticas,
  eventos, ausentes/reaparecidos, regras de PSI, vistorias A–E, conciliação,
  RBAC/RLS, ausência de CPK; exige base de pneus vazia) e
  `33_tires_evolution.sql` (definições, amostra manual × telas para Sulco,
  Prazos, PSI e as duas conformidades, prioridades, captura semanal sem
  duplicar e imutável, semana × semana e mês × mês, auditoria idempotente e
  resolução, trava da sincronização; roda em qualquer base com dados e desfaz
  tudo).
- Integração: `tests/integration/tires-sync.spec.ts` (sincronização ponta a
  ponta em cópia do banco local + Graph simulada: credenciais ausentes, falha
  de conexão, planilha indisponível, sucesso, sem alteração, revisão do dia,
  estrutura alterada, planilha desatualizada, reprocessamento, trava,
  permissões e o cliente HTTP da Graph).
- Interface: `tests/ui/tires.spec.ts` e `tests/ui/tires-app.spec.ts` contra as
  prévias `/dev/preview-pneus` e `/dev/preview-vistoria-pneus`.

## 8. Situação em produção (06/10/2026)

- Migrations de sincronização, conformidade, histórico de indicadores,
  auditoria e linguagem aplicadas; pg_cron `hfm_tires_kpi_tick` (a cada 15 min)
  e `hfm_tires_audit_daily` (06:20) ativos. `33_tires_evolution.sql` passou em
  produção (43 verificações, desfeito ao final).
- Primeira varredura da Central de Auditoria (manual, Administrador): 120
  pendências abertas, a maioria de baixa severidade (KM Real negativo,
  número de calibragem formatado como data, datas inconsistentes) e 2 de
  severidade alta (sulco inválido).
- Evolução dos Indicadores: a primeira captura semanal é na sexta-feira
  09/10/2026, 22:00; a comparação semana × semana aparece a partir da segunda.
- Sincronização com o SharePoint: aguarda o aplicativo da TI e as variáveis
  descritas em [`tire-sync-sharepoint.md`](./tire-sync-sharepoint.md); até lá
  as execuções registram "credenciais ausentes" e a carga manual da planilha
  segue como contingência.

## Fora do Escopo Atual

### CPK DE PNEUS

Não implementado nesta etapa: custo por km (CPK), custo por vida, custo
acumulado de recapagens, ROI de pneus, controle financeiro por vida,
comparativo de custo entre 1ª, 2ª e 3ª vidas, custo de ressolagem por vida,
rentabilidade de recapagem e dashboard financeiro. Não existem tabelas, APIs,
rotas nem permissões de CPK, nenhuma planilha de CPK é importada e nenhum valor
de recapagem é solicitado. A vida, o KM e os eventos de ressolagem guardados
hoje são dados operacionais e não devem ser usados como CPK.
