# Mapeamento funcional — Motor de Aderência (HFC → HFM)

> **Fonte**: projeto Lovable "Horizonte Fleet Command (HFC)", id `e8a92f16-ab41-4b34-ada2-cddbed391b51`, inspecionado em 2026-09-23 em modo somente-leitura (código em `HEAD` + banco de produção via `SELECT`/catálogo).
> **Objetivo**: permitir que o time HFM reproduza a lógica funcional do módulo sem reler o HFC.
> **Versão**: 2 (telas + camada cliente + engine de banco). Itens não verificáveis estão em §13.

---

## 1. Visão geral do módulo

| Item | Valor verificado |
|---|---|
| Rotas | `src/routes/app.operacao.aderencia.tsx` (`/app/operacao/aderencia`, admin/gestor) e `src/routes/app.lideranca.aderencia.tsx` (`/app/lideranca/aderencia`). Ambas renderizam o mesmo `AderenciaModule` e validam os search params (`tab, contexto, data, tipoOperacao, local, lideranca, placa, statusFiltro`) |
| Shell | `src/components/aderencia/aderencia-module.tsx` (`AderenciaModule`) |
| Abas montadas | `consolidado` ("Visão Consolidada"), `heatmap`, `mesdia` ("Mês / Dia"), `justificativas` ("Expurgos", só com `aderencia.expurgos.manage`), `importar` ("Importação", só com `aderencia.import`) |
| Abas aceitas na URL mas não montadas | `retorno` e `jornada` (constam em `ABAS` das rotas e no tipo `AderenciaTab`, mas `visiveis` no shell não as inclui → caem em `consolidado`). "Acompanhamento do Retorno" e "Jornada" são **seções dentro da aba Consolidado** |
| "Solicitações das Lideranças" | Não é aba: painel `SolicitacoesLiderancaPanel` renderizado **dentro da aba Expurgos** |
| Estado de navegação | Search params da rota (`AderenciaSearch`) via `AderenciaSearchProvider` / `useAderenciaSearch()` |
| Mesma tela para Admin e Liderança | Sim. Liderança (`acc.isScoped`) vê banner "Minha operação"; leitura global; não importa nem gerencia expurgos, mas pode **solicitar** alteração |
| Capabilities (`src/lib/access-context.tsx`) | `administrador`, `gestor_frota` → todas (`aderencia.view/import/expurgos.manage/status.solicitar`); `rh` → `aderencia.view`, `aderencia.import`, `aderencia.status.solicitar`; `lideranca` → `aderencia.view`, `aderencia.status.solicitar`. **Somente UI**: ver §11 P-01 |
| Meta | Constante `META = 90` hard-coded em `visao-consolidada.tsx` e `heatmap-calendar.tsx`. `aderencia_metas` existe (default `meta_pct = 90.00`, colunas `tipo_operacao, lideranca, local_operacao, vigencia_inicio/fim`) mas está **vazia** e **não é lida** por nenhum componente |
| Faixas de cor (pct) | `>= 90` sucesso · `70–89,99` atenção · `< 70` crítico · `null` neutro ("—"). Exceção: `acompanhamento-retorno.tsx` usa `>= 95 / >= 85 / < 85` |
| Acesso a dados | Cliente `@/integrations/supabase/db` → proxy `/api/db/*` (`src/routes/api/db.$.ts`) que valida o cookie de sessão Horizon e encaminha ao PostgREST com a **chave service-role**. Todas as tabelas têm RLS ligado com **0 policies** (exceto `aderencia_expurgo_motivos`, 2) — o RLS é irrelevante para o cliente. Server functions (`*.server.ts`) usam `supabaseAdmin` |

### 1.1 Contexto global Saída / Retorno

* Toggle no header (`Saída de Rota` | `Retorno de Rota`) → `search.contexto` (`"saida"` default | `"retorno"`). Persistido apenas na URL.
* Efeitos verificados:
  * **Consolidada**: retorno → view `vw_kpis_diarios_aderencia_retorno`; saída → `kpis_diarios_aderencia`.
  * **Heatmap** e **Mês/Dia**: `getMatrixRange(..., contexto)` seleciona colunas `retorno_*` e as **renomeia** para os campos canônicos (`status_original`, `checklist_realizado`, `elegivel_checklist`, `expurgo_automatico`, `motivo_expurgo`, `manual_override`, `override_*`, `importado_por`). `classify` é idêntico nos dois contextos.
  * **Aba Consolidado**: em retorno monta a seção "Acompanhamento do Retorno — placa × dia".
  * **Expurgos**: em retorno monta "Expurgos herdados no Retorno"; a lista de expurgos **não muda de contexto** (P-05).
  * **Importação**: em retorno troca o upload XLSX por "Importação / Reconciliação — Retorno" (RPC `aderencia_sync_retorno`).
  * **Lançamento manual / solicitação**: `contexto` viaja em `setManualStatus`, `setManualStatusBulk`, `criarSolicitacao`; em retorno tudo passa pela RPC `aderencia_set_retorno_manual`.
  * Jornada e Acompanhamento do Retorno **não** leem o contexto.

---

## 2. Camada de acesso a dados (cliente) — `src/lib/aderencia-api.ts`

| Função | Fonte | Observações |
|---|---|---|
| `hojeOperacional()` | `Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"})` | Data operacional (YYYY-MM-DD). Nem todos os componentes a usam (P-02) |
| `getKpisRange` | `kpis_diarios_aderencia` paginado 1000 | |
| `getKpisRetornoRange` | view `vw_kpis_diarios_aderencia_retorno` | on-the-fly |
| `getMatrixRange(ini,fim,filters,contexto)` | `frota_status_diario` (placa,data) | remove placas excluídas do módulo (`getPlacasExcludedFromModule`) |
| `getFidelizationBindingsRange` | `fidelization_daily` (placa,data,tipo_operacao,local_operacao,lideranca,gestor,status_operacional,codigo_br) | `lideranca` vazia → `gestor`; remove placas excluídas |
| `getPlacasExcludedFromModule("aderencia")` | `modules` → `equipment_type_modules` → `vehicles` | placa **com** `equipment_type_id` cujo tipo não está vinculado ao módulo é excluída; placa sem tipo **não** é excluída. Mesma regra existe em SQL (`recalc_aderencia`, `aderencia_build_referencia`, view de retorno) |
| `getRetornoRange` | `frota_status_diario` colunas `retorno_*` | Acompanhamento do Retorno / Expurgos herdados |
| `buildReferenciaAderencia` | RPC `aderencia_build_referencia` | `[{dia, base, criados, atualizados}]` |
| `recalcAderencia` | RPC `recalc_aderencia` | |
| `syncRetornoAderencia` | RPC `aderencia_sync_retorno` | jsonb com contadores |
| `setManualStatus` | Saída: upsert `frota_status_diario` (`placa,data`) + insert `frota_status_audit` + `recalc_aderencia(d,d)`. Retorno: RPC `aderencia_set_retorno_manual` | `arquivo_origem="MANUAL_OVERRIDE"`, `manual_override=true` |
| `setManualStatusBulk` | Saída: upsert lotes 300 + audit por linha + 1 linha `aderencia_expurgos_audit` (`acao="MASSA_STATUS"`) + recalc(ini,fim). Retorno: RPC por linha + 1 linha audit (`contexto='retorno'`) | `preserveExistingChecklist` pula placa-dia já realizado |
| `listExpurgosPendentes` | `frota_status_diario` com `expurgo_automatico=true` no período (+motivo,+br) | retorna todas as situações; filtro de situação no cliente |
| `decideJustificativa` | insert `aderencia_justificativas` + update `frota_status_diario.justificativa_status` + recalc(d,d) | `solicitado_por = revisado_por = usuário` |
| `decideJustificativasBulk` | idem lotes 300 + 1 linha `aderencia_expurgos_audit` + recalc(ini,fim) | RECLASSIFICADA também troca `motivo_expurgo` |
| `listExpurgosAudit` | `aderencia_expurgos_audit` | |
| `listMotivosExpurgo` / `setMotivoReplica` | `aderencia_expurgo_motivos` | switch de herança |
| `fetchUserNames`, `fetchChecklistAutor` | `app_users`; `checklist_execucoes` (`placa` + `data_inicio` entre `T00:00:00` e `T23:59:59` sem TZ) | autoria no drawer |
| `uploadChecklistBatch`, `uploadRelatosBatch`, `listUploadLogs` | §9 | |

**Autoria**: `supabase.auth.getUser()` é chamado no cliente-proxy que **não tem sessão Supabase** (`persistSession:false`) → `userId` é sempre `null` nos writes do navegador (`importado_por`, `override_por`, `alterado_por`, `solicitado_por/revisado_por` em justificativas). Só os fluxos server-side (solicitações) gravam `user.userId`. Ver P-03.

### 2.1 Mapeamento do XLSX — `aderencia-mapping.ts` (`mapStatus`)

Normalização: NFD sem acentos, trim, lower-case.

| Texto normalizado | realizado | elegível | expurgo | motivo | just. requerida | just. status |
|---|---|---|---|---|---|---|
| `fez check list` / `fez checklist` / `fez` | true | true | false | null | false | null |
| `nao fez check list` / `nao fez checklist` / `nao fez` | false | true | false | null | false | null |
| `sem rota` / `operacao nao realizada` | false | false | true | `SEM_ROTA` | true | `PENDENTE` |
| `manutencao` / `em manutencao` | false | false | true | `MANUTENCAO` | true | `PENDENTE` |
| `frota reserva` / `reserva` / `reserva_*` | false | false | true | `RESERVA` | true | `PENDENTE` |
| `em viagem` / `viagem` | false | false | true | `EM_VIAGEM` | true | `PENDENTE` |
| `""` / `-` / `sem informacao` | false | false | true | `SEM_INFORMACAO` | true | `PENDENTE` |
| outro | false | false | true | `DESCONHECIDO` | true | `PENDENTE` |

### 2.2 Mapa canônico de status manuais — `aderencia-status-map.ts` (`STATUS_TO_DERIVED`)

| Kind | `status_original` | realizado | elegível | expurgo | motivo | just. req. | just. status |
|---|---|---|---|---|---|---|---|
| `FEZ_CHECKLIST` | Fez Check List | true | true | false | null | false | null |
| `NAO_FEZ_CHECKLIST` | Não Fez Check List | false | true | false | null | false | null |
| `FROTA_RESERVA` | Frota Reserva | false | false | true | `RESERVA` | true | `APROVADA` |
| `MANUTENCAO` | Manutenção | false | false | true | `MANUTENCAO` | true | `APROVADA` |
| `SEM_ROTA` | Sem Rota | false | false | true | `SEM_ROTA` | true | `APROVADA` |
| `EM_VIAGEM` | Em Viagem | false | false | true | `EM_VIAGEM` | true | `APROVADA` |
| `FROTA_NAO_ATIVA` | Frota Não Ativa | false | false | true | **`SEM_INFORMACAO`** | true | `APROVADA` |

* `SOLICITAVEL_KINDS` (liderança) = `EDITABLE_KINDS` (gestor) = todos exceto `FEZ_CHECKLIST` ("Fez" só nasce do app).
* Lançamento manual grava `justificativa_status='APROVADA'` **sem** linha em `aderencia_justificativas`; XLSX grava `PENDENTE`. Para o KPI isso é indiferente (ver §10.5): o que tira do denominador é `elegivel_checklist=false`.

---

## 3. Tela: Visão Consolidada (`visao-consolidada.tsx`)

**Objetivo**: painel do ano corrente (relógio do navegador) com meta, acumulado, gap, gráfico mensal, insights e quebras por Tipo/Local/Liderança × 12 meses.

**Fluxo**
1. `["aderencia-consolidado-materializa", year]` → `buildReferenciaAderencia(1º dia do mês, hojeOperacional())` (best-effort, `retry:false`, `staleTime 5 min`). **Abrir a tela materializa a base do mês e recalcula KPIs** (write em tela de leitura, qualquer perfil com `aderencia.view`).
2. `["aderencia-consolidado", contexto, ini, fim, materializaQ.isFetched]` → KPIs de `01/01` a `31/12`.

**KPIs (6 cards)** — `agg(rows)`: `num=Σnumerador`, `den=Σdenominador`, `exp=Σexpurgos`, `pct = den===0 ? null : num/den*100`, `naoAderente=max(0,den−num)`.

| Card | Fórmula |
|---|---|
| Meta de Aderência | `90%` |
| Aderência {ano} | `pct` acumulado (Σnum ÷ Σden, não média de médias) |
| Gap para Meta | `pct − 90` p.p. |
| Checklists Esperados | `den` |
| Checklists Realizados | `num` |
| Não Aderências | `den − num` |

**Gráfico**: recharts BarChart 12 meses, `domain [0,100]`, `ReferenceLine y=90` tracejada, cor por faixa; meses futuros (`m > mês atual`) em `--muted` opacidade 0.3; tooltip com Aderência/Meta/Gap/Esperados/Realizados/Não aderências/Status.

**Insights** (máx. 5 + "Ver mais"): acumulado vs meta (`gap<−0.5` crítico, `>0.5` ok, senão "No limite"), pior mês com `den>0`, primeiro tipo/local/liderança abaixo da meta (ordem Crítico→Atenção→OK, depois menor pct); `critico` se `<70`.

**Matrizes de quebra** (3 tabelas `min-w-[1024px]`, 1ª coluna sticky): linha por `tipo_operacao` / `local_operacao` / `lideranca` (chave nula descartada); colunas Aderência Ano, Gap, Status (badge OK/Atenção/Crítico), 12 meses (`pct` 0 casas; "—" sem dado; futuro `bg-muted/10`).

**Estados**: loading "Carregando visão consolidada…"; vazio → card "Sem dados de aderência no ano" + instrução de importar `Base Check List.xlsx`. Erro de query não tratado (cai em vazio). **Filtros**: nenhum. **Responsivo**: cards `md:2/lg:3/xl:6`; tabelas `overflow-x-auto`.

---

## 4. Tela: Heatmap (`heatmap-calendar.tsx`)

**Objetivo**: 3 meses (âncora = mês atual, navegável ±1) com % por dia e drawer de diagnóstico.

**Fluxo**: `getMatrixRange(ini,fim,undefined,contexto)` + `getFidelizationBindingsRange(ini,fim)`; `ini` = 1º dia de (âncora−2), `fim` = último dia da âncora. **Não lê `kpis_diarios_aderencia`** — recalcula no cliente (P-04).

**Cálculo (`buildDayRows`/`aggByDate`)**
* Universo = chaves `placa|data` de células ∪ bindings da Fidelização; `data > hojeOperacional()` descartada.
* Com célula: `justificado = justificativa_status==="APROVADA"`; `eleg = elegivel && !justificado`; `fez = checklist_realizado`; `expurgo = expurgo_automatico || justificado`.
* Sem célula, planejada, data ≤ hoje: `eleg=true, fez=false, expurgo=false` (**Não Fez**).
* `den = Σ(eleg && !expurgo)`, `num = Σ(… && fez)`, `pct = den===0 ? null : num/den*100`.

**Célula**: botão quadrado com dia + `round(pct)%` ou "—", cor por faixa, ponto no canto, `title`, seleção `ring-gold`. Legenda ≥90 / 70–89 / <70 / sem dado.

**Drawer "Detalhe — dd/mm/aaaa"**: 6 mini-cards (Aderência, Meta, Gap, Esperados, Realizados, Não aderências); "Diagnóstico do dia" (tipo/local/liderança de maior impacto = menor pct, desempate por mais faltas); árvore Tipo → Liderança → Local → placas Não Fez (chips). Ações: "Ver na Matriz Mês/Dia" (deep-link `tab=mesdia,data,tipoOperacao,local,lideranca` dos piores + `statusFiltro=NAO_FEZ_CHECKLIST`) e clique na placa (`tab=mesdia,data,placa`).

**Estados**: sem loading/erro explícitos. **Responsivo**: `lg:grid-cols-3`; drawer `sm:max-w-xl`.

---

## 5. Tela: Mês / Dia (`visao-mes-dia.tsx`)

**Objetivo**: matriz placa × dia com status por célula, filtros, edição manual (gestor), solicitação (liderança), aplicação em massa.

**Permissões**: `podeEditar = useCan("aderencia.expurgos.manage")`; `podeSolicitar = useCan("aderencia.status.solicitar")`. Célula clicável se qualquer um; gestor → `EditDrawer`; liderança → `SolicitarDrawer`.

**Fluxo** (mês `ini..fim`)
1. `["aderencia-materializa", ini, fim]` → `buildReferenciaAderencia(ini, min(fim,hoje))` se `ini<=hoje`; ao concluir invalida matrix/kpis/consolidado.
2. `["aderencia-matrix", contexto, ini, fim]` → `getMatrixRange`.
3. `["aderencia-solicitacoes-pendentes", ini, fim]` → `listarSolicitacoesPendentesRangeFn` (se pode editar/solicitar) → ponto âmbar.
4. `["aderencia-fid-bindings", ini, fim]` → `getFidelizationBindingsRange`.

**Binding por dia**: célula primeiro, Fidelização **sobrescreve** (canônica por data). `placaMeta` = binding mais recente da placa no mês (colunas fixas).

**Classificação (`classify`) e hierarquia visual**

| # | Kind | Label | Tom | Condição |
|---|---|---|---|---|
| 1 | `FROTA_NAO_ATIVA` | Frota Não Ativa | neutral/strong | `expurgo_automatico` e motivo ∈ {`SEM_INFORMACAO`,`DESCONHECIDO`, outro, null} |
| 2 | `MANUTENCAO` | Manutenção | warning | expurgo e motivo `MANUTENCAO` |
| 3 | `FROTA_RESERVA` | Frota Reserva | neutral | expurgo e `RESERVA` |
| 4 | `SEM_ROTA` | Sem Rota | info | expurgo e `SEM_ROTA` |
| 5 | `EM_VIAGEM` | Em Viagem | brand | expurgo e `EM_VIAGEM` |
| 6 | `FEZ_CHECKLIST` | Fez Checklist | success | `!expurgo && checklist_realizado` |
| 7 | `NAO_FEZ_CHECKLIST` | Não Fez Checklist | danger/strong | `!expurgo && !realizado && elegivel` **ou** sem célula + planejada na Fidelização + `data <= hojeOperacional()` |
| 8 | `SEM_DADO` | Sem dado | neutral/subtle | sem célula e (não planejada ou futuro); ou célula `!elegivel && !expurgo` |

`justificativa_status` **não** altera a classificação (P-06). Marcadores: ponto dourado `manual_override`; ponto âmbar solicitação pendente. Tooltip: data, label (+"(manual)"), Tipo/Local/Liderança, solicitação pendente, "Clique para solicitar alteração".

**Filtros** (client-side, independentes; opções do dataset do mês): Placa (substring), De/Até (recorta dias; reset ao trocar mês), Tipo (multi), Local (multi), Liderança (multi), Status (multi; placa entra se algum dia tem o status). Binding avaliado dia a dia com fallback `placaMeta`. "Limpar filtros" zera também os search params. Deep-link inicializa filtros; `search.data` destaca a coluna (`bg-gold/20`).

**Ordenação**: placas da "minha operação" (liderança: `allowedPlacas` ou `allowedLocais`) primeiro, depois alfabético; badge "Minha operação" na coluna Local.

**Legenda/resumo**: contagem de células por Kind sobre `placasFiltradas × daysInMonth`.

**Layout**: tabela `border-separate`, header sticky, 4 colunas fixas (Placa 110px, Tipo 140, Liderança 140, Local 140), dia 110px (dd + dow; fim de semana em warning), célula = botão 100×28px; `maxHeight 70vh`. Loading "Carregando matriz…"; vazio "Nenhuma placa encontrada…".

**EditDrawer (gestor)**: status atual, Tipo/Local/Liderança/Original, "Lançado por" (`importado_por`→`app_users`; fallback `checklist_execucoes` se Fez) e "Alterado por". Se `FEZ_CHECKLIST` bloqueia. Senão select `EDITABLE_KINDS` (default `MANUTENCAO`) + justificativa obrigatória → `setManualStatus({…,contexto})`.

**SolicitarDrawer (liderança)**: select `SOLICITAVEL_KINDS` (default `MANUTENCAO`), justificativa obrigatória → `criarSolicitacaoStatusFn` (`statusAtual = cell.status_original ?? label`, `motivoAtual`, binding, `contexto`). Erro 23505 → "Já existe uma solicitação pendente idêntica…".

**BulkApplyDrawer (gestor)**: status (default `SEM_ROTA`), justificativa (default "Sábado/Domingo/Feriado sem operação"), escopo (placas filtradas | todas do mês), dias-alvo (presets Sábados/Domingos/Sáb+Dom/Limpar + grade), checkbox preservar Fez (default true) → `setManualStatusBulk` (`origem MASSA|MASSA_TODOS`, `filtros`, `preserveExistingChecklist`, `contexto`).

---

## 6. Seção: Jornada do Checklist (`visao-jornada.tsx`)

* Fonte: view `vw_checklist_jornada` com `data = dia` (limite 2000). Dia = `search.data ?? new Date().toISOString().slice(0,10)` (**UTC**).
* Busca textual (placa/liderança/local). Resumo: `frotas · saídas · em rota · retornos` (em rota = `saida_realizada && retorno_previsto && !retorno_realizado`).
* Tabela: Placa, Operação, Liderança, Local, BR, Etapas (badges Prevista/Saída/Em rota/Retorno — Retorno em tom "info" se `retorno_expurgo_herdado`), Situação (`situacao_jornada` + "Expurgo: motivo").
* View (verificada): `prevista = COALESCE(elegivel_checklist,true)`; `saida_realizada = checklist_realizado`; `retorno_previsto = retorno_elegivel_checklist`; `retorno_realizado = retorno_checklist_realizado`; `situacao_jornada`: `expurgo_automatico OR NOT elegivel` → "Expurgo / Sem operação"; saída+retorno → "Jornada completa"; só saída → "Retorno pendente"; senão "Saída não realizada". **Não** exclui placas por tipo de equipamento; não aplica contexto.

---

## 7. Seção: Acompanhamento do Retorno (`acompanhamento-retorno.tsx`)

* Só em contexto **retorno** (aba Consolidado). Fonte `getRetornoRange(ini,fim)` (default 1º dia do mês → hoje **UTC**). Filtros multi (Tipo, Liderança, Local, BR) client-side.
* KPIs: `elegiveis = Σ retorno_elegivel`; `feitos = Σ(elegível && retorno_realizado)`; `pctRetorno = feitos/elegiveis` (null se 0); `pendentes = elegiveis−feitos`; `expurgos = base−elegiveis`; `saidaFeita` (não exibido). Faixas 95/85.
* "Ranking de retorno por liderança" (pct desc; "Sem liderança") e "Frotas aguardando check list de retorno" (elegíveis não realizados, data desc, máx. 400; coluna Saída "Feita"|"Sem saída").
* "Reconciliar retorno" (só `aderencia.import`) → `aderencia_sync_retorno(ini,fim,null)`.
* Não exclui datas futuras no cliente: linhas futuras têm `retorno_status_original=NULL` mas `retorno_elegivel=true`, então entram como pendentes se o intervalo passar de hoje (P-07).

---

## 8. Tela: Expurgos + Solicitações da Liderança

**Permissão**: aba só com `aderencia.expurgos.manage`. Blocos, de cima para baixo:

1. **Expurgos herdados no Retorno** (só contexto retorno): `getRetornoRange(1º dia do mês, hoje)` filtrando `retorno_expurgo_automatico && !retorno_elegivel`; Data/Placa/Status do Retorno/Motivo.
2. **Herança Saída → Retorno**: `Switch` por linha de `aderencia_expurgo_motivos` → `setMotivoReplica`.
3. **Filtros**: De (1º dia do mês anterior) / Até (hoje UTC) / Motivo (`SEM_ROTA, MANUTENCAO, RESERVA, EM_VIAGEM, SEM_INFORMACAO, DESCONHECIDO` — server-side) / Situação (Pendentes default; Aprovadas; Rejeitadas; Reclassificadas; Todas — client-side, `null`=PENDENTE) / Placa / Operação / Liderança (client-side). Sem filtro de Local.
4. **Toolbar**: Aprovar/Rejeitar/Reclassificar selecionados; "Aprovar todos filtrados" (`MASSA_TODOS`). Diálogo: "Novo motivo" ao reclassificar (`FROTA_NAO_ATIVA, MANUTENCAO, RESERVA, SEM_ROTA, EM_VIAGEM`), justificativa obrigatória exceto aprovar; aviso de auditoria.
5. **Tabela**: Data, Placa, BR, Motivo, Operação, Local, Liderança, Situação (badge), Ações (3 botões → `DecideDialog`). Toast trata mensagem de RLS (vestigial, pois o proxy usa service-role).
6. **Solicitações da Liderança**: filtro Situação (Pendentes/Aprovadas/Rejeitadas/Todas), `listarSolicitacoesFn({status, limit:300})`. Colunas Data, Placa, Local, Alteração (`status_atual → novo_status_label`), Justificativa, Solicitante, Situação, Ações (Aprovar/Rejeitar se PENDENTE; senão `revisor_nome`). Rejeição exige observação. Sem lote.
7. **Auditoria** (últimas 30 de `aderencia_expurgos_audit`): Quando, Ação, Origem, Qtd, Motivo novo, Observação.

**Fluxo Solicitação → Decisão** (`aderencia-solicitacoes.server.ts`, server functions com `supabaseAdmin`)
* `criarSolicitacao`: `requireUser`; `novoStatus ∈ ManualStatusKind \ {FEZ_CHECKLIST}`; justificativa obrigatória; placa upper. Insere `aderencia_status_solicitacoes` (`status='PENDENTE'`, `contexto`, `solicitante_id/nome/perfil`). Índice único parcial `(placa,data,novo_status) WHERE status='PENDENTE'`.
* `listarSolicitacoes`: revisor (`perfil ∈ {administrador, gestor_frota}`) vê todas; demais só as próprias.
* `listarPendentesRange`: pares placa|data pendentes (≤5000) para o badge.
* `decidirSolicitacao`: só revisor; idempotente (mesma decisão repetida → ok; diferente → erro "já foi …"); revisor ≠ solicitante. **APROVADA/saída** → upsert `frota_status_diario` (STATUS_TO_DERIVED + binding da solicitação + `manual_override=true`, `override_motivo="Solicitação da liderança (nome): justificativa"`, `arquivo_origem="SOLICITACAO_LIDERANCA"`, `override_por=user`) + `frota_status_audit` + `recalc_aderencia(d,d)`. **APROVADA/retorno** → RPC `aderencia_set_retorno_manual`. Depois atualiza a solicitação com guarda `status='PENDENTE'`. **REJEITADA** → só a solicitação.

---

## 9. Tela: Importação (`ImportPanel`, `ReferenciaPanel`, `LogsPanel`, `ImportRetornoPanel`; parser `aderencia-xlsx.ts`)

**Permissão**: `aderencia.import` (admin, gestor_frota, rh).

**Upload XLSX (contexto saída)**
* Tipo de base: `CHECKLIST` ("Base Check List (status diário)") | `RELATOS` ("Base Histórico Relatos Check List"). Aceita `.xlsx,.xls`. Parse no navegador (SheetJS `cellDates:true`, `defval:null`); preview total/válidas/rejeitadas (até 50 "Linha N: motivo"); "Importar" só com preview.
* **CHECKLIST**: aba `Planilha1` (fallback 1ª). Cabeçalhos (case-insensitive, NBSP→espaço): `Placa`, `Data`, `Status`, `Tipo Operação|Tipo Operacao`, `Liderança Operacional|Lideranca Operacional`, `Local Operação|Local Operacao`, `Codigo_BR|Código BR|Codigo BR`. Rejeita placa vazia / data inválida. Status vazio → `"-"`. Data: `Date` → `toISOString().slice(0,10)` (**UTC**, risco de −1 dia); `dd/mm/aa|aaaa` (aa≥70→19xx); `yyyy-mm-dd`; senão `new Date(s)`.
  * Commit: `mapStatus` + campos → **upsert** `frota_status_diario` lotes 500 `onConflict:"placa,data"` (sobrescreve "Fez Check List" do app e overrides manuais — P-08); placa não normalizada (P-09); log em `aderencia_upload_logs {tipo_base:'CHECKLIST', arquivo_nome, total_linhas, linhas_validas, linhas_rejeitadas, rejeicoes, importado_por}`; depois `aderencia_build_referencia(minData,maxData)` (fallback `recalc_aderencia`). Toast "N registros importados" (N = linhas enviadas). Idempotente por chave, não por conteúdo (reimportar sobrescreve).
* **RELATOS**: aba `Modelo_Checklists`. Cabeçalhos: `Placa`, `Data registro Check List:` (variações), `Tipo Check List:`, `Matricula`, `Usuario`, `Informe sua Operação`; demais colunas → `respostas` (jsonb). Rejeita placa/data/tipo vazios. Dedup `placa|data_registro|tipo_checklist` → upsert `checklist_relatos` lotes 300 (UK `checklist_relatos_uk`). **Não** afeta KPIs.

**Modelo de referência**: De (1º dia do mês)/Até (hoje UTC) → `aderencia_build_referencia`; mostra base, complementadas, dias.

**Histórico de importações**: 50 últimos de `aderencia_upload_logs`.

**Contexto retorno**: Início/Fim/Placa opcional → `aderencia_sync_retorno` ("idempotente" — ver P-12).

---

## 10. Engine (banco)

### 10.1 Tabelas (colunas verificadas via `information_schema`; RLS ligado em todas)

**`frota_status_diario`** — 1 linha por `(placa, data)` (UK `frota_status_diario_placa_data_uk`). Índices: `data`, `br_codigo`, `tipo_operacao`, `(tipo_operacao_id, cidade_ibge_code)`, `(upper(regexp_replace(placa,'[^A-Za-z0-9]','','g')), data)`, `(data, retorno_elegivel_checklist, retorno_checklist_realizado)`. FK `retorno_execucao_id → checklist_execucoes(id) ON DELETE SET NULL`.

| Grupo | Colunas |
|---|---|
| Chave/contexto | `id uuid`, `placa text`, `data date`, `tipo_operacao`, `lideranca_operacional`, `local_operacao`, `br_codigo`, `tipo_operacao_id uuid`, `cidade_ibge_code int` |
| Saída | `status_original`, `checklist_realizado bool=false`, `elegivel_checklist bool=false`, `expurgo_automatico bool=false`, `motivo_expurgo`, `justificativa_requerida bool=false`, `justificativa_status`, `manual_override bool=false`, `override_motivo`, `override_por uuid`, `override_em` |
| Retorno | `retorno_status_original`, `retorno_checklist_realizado=false`, `retorno_elegivel_checklist=true`, `retorno_expurgo_automatico=false`, `retorno_motivo_expurgo`, `retorno_realizado_em`, `retorno_execucao_id`, `retorno_origem`, `retorno_importado_por`, `retorno_expurgo_herdado=false`, `retorno_manual_override=false`, `retorno_override_motivo/por/em` |
| Proveniência | `importado_por uuid`, `importado_em=now()`, `arquivo_origem` (valores vistos: nome do XLSX, `MODELO_REFERENCIA`, `App Checklist de Frota`, `MANUAL_OVERRIDE`, `MANUAL_BULK`, `SOLICITACAO_LIDERANCA`), `created_at`, `updated_at` |

Triggers: `trg_fsd_derive_retorno BEFORE INSERT OR UPDATE → aderencia_derive_retorno()`; `trg_fsd_updated BEFORE UPDATE → update_updated_at_column()`.

**`kpis_diarios_aderencia`**: `data, tipo_operacao, lideranca, local_operacao, br_codigo, numerador int, denominador int, expurgos int, pct numeric, atualizado_em`; UK `(data,tipo_operacao,lideranca,local_operacao,br_codigo) NULLS NOT DISTINCT`. Materializada por `recalc_aderencia` (delete+insert).

**`aderencia_expurgo_motivos`** (PK `codigo`): `codigo, label, replica_no_retorno bool=false, ordem int=100, ativo bool=true, created_at, updated_at`. Conteúdo atual (todos `ativo=true`, todos `replica_no_retorno=true`): `MANUTENCAO` "Manutenção" (10), `RESERVA` "Frota Reserva" (20), `SEM_ROTA` "Sem Rota" (30), `EM_VIAGEM` "Em Viagem" (40), `FROTA_NAO_ATIVA` "Frota Não Ativa" (50), `SEM_INFORMACAO` "Sem Informação" (60), `DESCONHECIDO` "Motivo Desconhecido" (90).

**`aderencia_justificativas`**: `id, frota_status_id → frota_status_diario ON DELETE CASCADE, motivo_codigo, motivo_descricao, evidencia_url, status='PENDENTE', solicitado_por, solicitado_em, revisado_por, revisado_em, observacao_revisor, created_at, updated_at`; índices `status`, `frota_status_id`. Só recebe inserts na decisão (nunca há "solicitação" de justificativa de fato).

**`aderencia_expurgos_audit`**: `id, acao, origem='INDIVIDUAL', status_anterior, status_novo, motivo_anterior, motivo_novo, qtd_registros=1, frota_status_ids uuid[], filtros jsonb, observacao, alterado_por → auth.users, created_at, contexto='saida'`. `acao` ∈ {`APROVADA`,`REJEITADA`,`RECLASSIFICADA`,`MASSA_STATUS`}; `origem` ∈ {`INDIVIDUAL`,`MASSA`,`MASSA_TODOS`}.

**`aderencia_status_solicitacoes`**: `id, frota_status_id (FK SET NULL), data, placa, tipo_operacao, local_operacao, lideranca, br_codigo, status_atual, motivo_atual, novo_status, novo_status_label, justificativa, solicitante_id/nome/perfil, status='PENDENTE', revisor_id/nome, observacao_decisao, reviewed_at, created_at, updated_at, contexto='saida'` (CHECK saida|retorno). Índices: UK parcial `(placa,data,novo_status) WHERE status='PENDENTE'`, `data`, `status`.

**`aderencia_upload_logs`**: `id, tipo_base, arquivo_nome, total_linhas, linhas_validas, linhas_rejeitadas, rejeicoes jsonb='[]', importado_por, importado_em` (idx `importado_em desc`).

**`aderencia_metas`**: `id, tipo_operacao, lideranca, local_operacao, meta_pct numeric=90.00, vigencia_inicio, vigencia_fim, created_at, updated_at`. **Vazia e não usada.**

**`checklist_relatos`**: `id, matricula, usuario, placa, data_registro date, operacao, tipo_checklist, respostas jsonb, arquivo_origem, importado_por, importado_em, created_at`; UK `(placa,data_registro,tipo_checklist)`. Não participa do KPI.

**`checklist_execucoes`** (envios do app): `id, checklist_uuid (UK), app_id → checklist_apps, usuario_id → app_users, nome_usuario, matricula, tipo_checklist CHECK (saida|retorno), operation_id, tipo_operacao_nome, equipment_type_id, tipo_equipamento_nome, vehicle_id → vehicles, placa, data_inicio timestamptz, data_finalizacao, tempo_total_segundos, status_envio CHECK (rascunho|enviado|reprovado|aprovado|ressalva), total_perguntas/conformes/inconformes, created_at, versao_*`. Índice `(placa, data_inicio desc)`.

**`frota_status_audit`** (auxiliar): `frota_status_id, placa, data, status_anterior, status_novo, motivo_anterior, motivo_novo, observacao, alterado_por, contexto`; idx `(placa,data)`.

### 10.2 `aderencia_hoje()` e datas

```sql
SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date
```
Usada por `build_referencia`, `recalc`, `derive_retorno`, `sync_retorno` e pela view de retorno. **Não há corte horário**: a partir de 00:00 (SP) o dia corrente já é materializado e cobrado.

### 10.3 Frota prevista — `aderencia_build_referencia(p_data_ini, p_data_fim)` (SECURITY DEFINER)

1. `v_fim = LEAST(p_data_fim, aderencia_hoje())`. Se `p_data_ini > v_fim` → só `recalc_aderencia(ini,fim)` e retorna. **Nunca materializa futuro.**
2. Para cada dia `v_d` em `[ini, v_fim]`:
   * Base = `vw_frota_escopo_competencia` com `data_referencia = v_d`, `DISTINCT ON (upper(frota))` preferindo `status_operacional='ativa'` e `updated_at` mais recente; campos `placa_norm, status_operacional, tipo_operacao_nome, local_operacao, lideranca_nome, codigo_br, tipo_operacao_id, cidade_ibge_code`. Exclui veículos cujo `equipment_type_id` não está em `equipment_type_modules` do módulo `aderencia`.
   * `INSERT … ON CONFLICT (placa,data) DO NOTHING` de **todas** as placas da base como `status_original='Não Fez Check List'`, `checklist_realizado=false`, `elegivel_checklist=true`, `expurgo=false`, `retorno_status_original='Não Fez Check List'`, `retorno_elegivel=true`, `arquivo_origem='MODELO_REFERENCIA'`. **A função não gera expurgo para Reserva/inativo** (o comentário em `aderencia-api.ts` diz que sim — P-10; a coluna temporária `inativo` é sempre `false`).
   * `UPDATE` das colunas de contexto (`tipo_operacao, local_operacao, tipo_operacao_id, cidade_ibge_code, lideranca_operacional, br_codigo`) com `COALESCE(canônico, atual)` — "cache, nunca fonte".
   * Linhas do dia com retorno `NULL`/`'Aguardando Check List Retorno'`, elegíveis, não realizadas, sem expurgo/override → `retorno_status_original='Não Fez Check List'`.
   * Retorna `(dia, base, criados, atualizados)`.
3. `recalc_aderencia(p_data_ini, p_data_fim)`.

Quem chama: Consolidada (mês corrente, ao abrir), Mês/Dia (mês visível, ao abrir), importação CHECKLIST (intervalo do arquivo), envio de checklist pelo app (dia do envio), painel "Modelo de referência".

Semântica da view `vw_frota_escopo_competencia` (definição **não** verificada — banco indisponível; descrição pelo comentário de `src/lib/fleet-scope.server.ts`): Central de Fidelização define placa → tipo de operação → local; Planner de Lideranças define a liderança por (tipo + local + competência); colunas textuais legadas (`gestor`, `lideranca`, `lideranca_operacional`) são cache. O **cliente** (Heatmap/Mês-Dia) usa `fidelization_daily` diretamente, com fallback `gestor` — pode divergir do canônico (P-11).

### 10.4 Casamento execução → obrigação

Chave: **placa normalizada** (`fleet_norm_placa`, corpo não verificado; índice `idx_fsd_placa_norm_data` sugere `upper(regexp_replace(placa,'[^A-Za-z0-9]','','g'))`) + **data operacional** = `(COALESCE(data_finalizacao, data_inicio) AT TIME ZONE 'America/Sao_Paulo')::date` + **tipo** (`saida` | `retorno`). Não usa `vehicle_id`, não há vínculo de jornada (um retorno finalizado após 00:00 cai no **dia seguinte**, não no dia da saída — P-13).

Caminhos que marcam "Fez":
* **DB** — `checklist_frota_after_respostas()` (trigger statement-level com `FROM inserted`, presumivelmente em `checklist_execucao_respostas`; vínculo **não verificado**) → `checklist_frota_aderencia_apply(execucao_id)`: ignora apps ≠ `check-list-frota`; calcula `v_data` SP; se não há linha, resolve escopo por `fn_resolve_fleet_scope(v_data, placa)` e insere "Não Fez"; `retorno` → seta `retorno_*` realizado (`retorno_origem='App Checklist de Frota'`, limpa expurgo herdado); `saida` → `status_original='Fez Check List'`, realizado, elegível, **limpa expurgo/justificativa** (um dia "Manutenção" vira "Fez" se o app enviar); `recalc(v_data,v_data)`; grava em `checklist_gpac_sync_log`.
* **Cliente** — `enviarChecklist` (`src/lib/checklist-frota-api.ts`) → `marcarChecklistNoMotorAderencia`: upsert em `frota_status_diario` com `status_original='Fez Check List'` **para qualquer `tipo_checklist`, inclusive `retorno`**, e `data = data_finalizacao.slice(0,10)` (**UTC** se ISO) — depois `aderencia_build_referencia(d,d)`. Ver P-14.
* **Reconciliação** — `aderencia_sync_retorno` (§10.7).

### 10.5 Fórmula da aderência — `recalc_aderencia(p_data_ini, p_data_fim)` (SECURITY DEFINER)

```
DELETE kpis WHERE data BETWEEN ini AND fim;
INSERT … SELECT data, tipo_operacao, lideranca_operacional, local_operacao, br_codigo,
  numerador   = Σ CASE WHEN checklist_realizado THEN 1 END,
  denominador = Σ CASE WHEN elegivel_checklist
                       AND NOT EXISTS (aderencia_justificativas aj WHERE aj.frota_status_id = fsd.id AND aj.status='APROVADA') THEN 1 END,
  expurgos    = Σ CASE WHEN expurgo_automatico THEN 1 END,
  pct         = ROUND(numerador / NULLIF(denominador,0) * 100, 2)   -- NULL se denominador 0
FROM frota_status_diario
WHERE data BETWEEN ini AND LEAST(fim, aderencia_hoje())
  AND placa não excluída do módulo (equipment_type_modules)
GROUP BY data, tipo_operacao, lideranca_operacional, local_operacao, br_codigo;
```
* Datas futuras: KPIs são apagados e **não** reinseridos.
* Numerador conta `checklist_realizado` mesmo se `elegivel=false` (não ocorre na saída porque o app força elegível).
* Exclusão do denominador = `elegivel_checklist=false` **ou** justificativa APROVADA. Como todo expurgo (XLSX ou manual) já nasce com `elegivel=false`, **rejeitar** um expurgo (`REJEITADA`) não devolve a placa ao denominador (P-06).
* Agregação no cliente sempre recompõe `Σnum/Σden` (não usa `pct` armazenado).

### 10.6 Retorno — `aderencia_derive_retorno()` (trigger BEFORE INSERT/UPDATE em `frota_status_diario`)

```
v_saida_expurgada = expurgo_automatico OR NOT elegivel_checklist
v_replica         = aderencia_motivo_replica(motivo_expurgo)   -- replica_no_retorno do motivo ativo (default false)
v_label           = aderencia_motivo_label_cfg(motivo, status)  -- label da tabela, fallback fixo
IF v_saida_expurgada AND (v_replica OR motivo_expurgo IS NULL) THEN   -- herança tem precedência (inclusive sobre override manual)
   retorno_elegivel=false; retorno_expurgo=true; retorno_expurgo_herdado=true; retorno_motivo=motivo_expurgo
   retorno_status = realizado ? 'Fez Check List Retorno · fora da elegibilidade' : 'Herdado da Saída — '||v_label
ELSIF retorno_manual_override THEN
   retorno_expurgo_herdado=false; IF realizado THEN retorno_status='Fez Check List Retorno'
ELSE
   retorno_elegivel=true; retorno_expurgo=false; herdado=false; retorno_motivo=NULL
   retorno_status = realizado ? 'Fez Check List Retorno' : (data <= hoje ? 'Não Fez Check List' : NULL)
END IF
IF NOT realizado THEN retorno_realizado_em/execucao_id/origem/importado_por := NULL
```
`aderencia_motivo_label` (fallback fixo): MANUTENCAO→"Manutenção", SEM_ROTA→"Sem Rota", EM_VIAGEM→"Em Viagem", RESERVA→"Frota Reserva", SEM_INFORMACAO→"Frota Não Ativa", senão `status_original` ou "Saída não elegível".

Consequências: com todos os motivos em `replica=true`, **todo expurgo da saída expurga o retorno**; um lançamento manual de retorno em dia com saída expurgada é silenciosamente sobrescrito pela herança (P-15); o `retorno_status_original='Fez Check List'` gravado por `apply`/`sync`/`normalizar` é reescrito pelo trigger como `'Fez Check List Retorno'`.

**`aderencia_set_retorno_manual(placa, data, status, realizado, elegivel, expurgo, motivo, observacao)`**: localiza a linha por placa normalizada; se não existir retorna `{'status':'sem_linha'}` **sem inserir** (o cliente ignora o retorno → no-op silencioso, P-16); atualiza `retorno_*` + `retorno_manual_override=true` + `retorno_override_por=auth.uid()` (null via proxy); insere `frota_status_audit (contexto='retorno')`; `recalc(data,data)`.

### 10.7 `aderencia_sync_retorno(p_data_ini, p_data_fim, p_placa)` (SECURITY DEFINER)

1. Para cada linha de `frota_status_diario` no período (e placa, se informada): candidata (a) última `checklist_execucoes` com `app_id = checklist_frota_app_id()` (slug `check-list-frota`), `tipo_checklist='retorno'`, placa normalizada igual, data SP de `COALESCE(data_finalizacao,data_inicio)` = `fsd.data`; (b) último `gpac_checklist_records` `tipo_checklist='retorno'` com `data_checklist = fsd.data` (`realizado_em = hora_conclusao` ou `data+12:00`, `origem = origem_importacao` ou "Importação canônica"). Prefere (a).
2. `UPDATE` → `retorno_checklist_realizado=true`, `retorno_status_original='Fez Check List'`, `retorno_execucao_id`, `retorno_realizado_em`, `retorno_origem`, `retorno_importado_por` — quando algo difere (`marcados`).
3. Linhas elegíveis, não realizadas, sem expurgo/override e `data <= hoje` → `'Não Fez Check List'`.
4. `UPDATE … SET updated_at=now()` em todas as linhas do período (`recomputados`) — força o trigger a re-derivar.
5. Retorna `{linhas, elegiveis, realizados, realizados_elegiveis, nao_fez (data<=hoje), expurgados, marcados, recomputados}`. **Não** cria linhas para retornos sem linha de saída; **não** chama `recalc` (KPI de retorno é view).

**`aderencia_normalizar_retorno_realizado(ini,fim)`**: força `'Fez Check List'` onde realizado (função utilitária; não chamada pelas telas).

### 10.8 KPI de retorno — view `vw_kpis_diarios_aderencia_retorno`

```
numerador   = count(*) FILTER (retorno_checklist_realizado AND retorno_elegivel_checklist)
denominador = count(*) FILTER (retorno_elegivel_checklist)
expurgos    = count(*) FILTER (NOT retorno_elegivel_checklist)
pct         = round(numerador / NULLIF(denominador,0) * 100, 2)
WHERE data <= aderencia_hoje() AND placa não excluída do módulo
GROUP BY data, tipo_operacao, lideranca_operacional, local_operacao, br_codigo
```
Não considera `aderencia_justificativas`.

### 10.9 Catálogo de status (valores de `status_original` / `retorno_status_original`)

| Contexto | Valor | Origem | Classificação visual |
|---|---|---|---|
| Saída | `Fez Check List` | app (`apply`, cliente), XLSX "Fez…" | Fez Checklist (verde) |
| Saída | `Não Fez Check List` | `build_referencia`, XLSX, manual `NAO_FEZ_CHECKLIST` | Não Fez (vermelho) |
| Saída | `Manutenção` / `Sem Rota` / `Em Viagem` / `Frota Reserva` / `Frota Não Ativa` | manual (`STATUS_TO_DERIVED`) | por `motivo_expurgo` |
| Saída | texto bruto do XLSX (`Reserva_Contagem_2`, `-`, …) | importação | por `motivo_expurgo` derivado |
| Retorno | `NULL` | futuro (trigger) | Sem dado |
| Retorno | `Não Fez Check List` | trigger/`build`/`sync` (data ≤ hoje) | Não Fez |
| Retorno | `Fez Check List Retorno` | trigger quando realizado | Fez |
| Retorno | `Fez Check List Retorno · fora da elegibilidade` | realizado + saída expurgada herdada | expurgo (por motivo) |
| Retorno | `Herdado da Saída — <label>` | herança | expurgo (por motivo) |
| Retorno | labels manuais (`Manutenção`, …) | `aderencia_set_retorno_manual` (se não sobrescrito por herança) | por motivo |
| Retorno | `Aguardando Check List Retorno` | legado (só tratado como NULL) | — |

**Regra de hoje**: uma placa prevista sem checklist hoje aparece como **"Não Fez"** (não "Sem dados"), tanto por materialização no banco (`build_referencia` até `aderencia_hoje()`, disparada ao abrir as telas) quanto pelo `classify` no cliente (`data <= hojeOperacional()`); entra no denominador do KPI de hoje desde 00:00 SP. **Futuro**: nunca materializado, nunca em KPI, célula "Sem dado", mês futuro apagado no gráfico.

**Denominador zero**: `pct = null` → "—" e tom neutro em todas as telas.

---

## 11. Problemas verificados no HFC

| # | Problema | Evidência |
|---|---|---|
| P-01 | Permissões são só de UI. O proxy `/api/db/*` usa service-role para qualquer usuário logado; qualquer perfil pode fazer upsert em `frota_status_diario`, chamar `recalc_aderencia`, editar `aderencia_expurgo_motivos`, etc. via PostgREST | `src/routes/api/db.$.ts` (`Authorization: Bearer <service-role>`); RLS com 0 policies em todas as tabelas do módulo; `useCan` só condiciona render |
| P-02 | Datas "hoje" inconsistentes: `hojeOperacional()` (SP) em Consolidada/Heatmap/Mês-Dia, mas `new Date().toISOString().slice(0,10)` (UTC) em Jornada, Acompanhamento do Retorno, Expurgos, Importação, Referência; `toLocaleDateString`/`getFullYear` do navegador para ano/mês | `visao-jornada.tsx#hoje`, `acompanhamento-retorno.tsx`, `expurgos-panel.tsx#fmt`, `aderencia-module.tsx` |
| P-03 | Autoria perdida: `supabase.auth.getUser()` no cliente-proxy sempre retorna `null` → `importado_por/override_por/alterado_por/solicitado_por/revisado_por` nulos nos writes do navegador; `auth.uid()` nulo nas RPCs | `db.ts` (`persistSession:false`, sem auth); `aderencia-api.ts` usa `userResp.user?.id ?? null` |
| P-04 | Três fórmulas diferentes de aderência: `recalc_aderencia` (KPI/Consolidada), `buildDayRows` (Heatmap, inclui placas da Fidelização sem célula), `vw_kpis_diarios_aderencia_retorno` (retorno, sem justificativas) → valores podem divergir entre telas para o mesmo dia | §10.5, §4, §10.8 |
| P-05 | Aba Expurgos ignora o contexto retorno na lista principal (sempre `expurgo_automatico` da saída); só acrescenta a tabela informativa de herdados | `expurgos-panel.tsx` (`listExpurgosPendentes` sem `contexto`) |
| P-06 | Rejeitar um expurgo não tem efeito no KPI nem na matriz: `elegivel_checklist` continua `false` e `classify` ignora `justificativa_status` | `recalc_aderencia` (denominador), `decideJustificativa` (só `justificativa_status`), `visao-mes-dia.tsx#classify` |
| P-07 | Acompanhamento do Retorno conta linhas futuras como pendentes se o intervalo passar de hoje (`retorno_elegivel=true`, status NULL) | `acompanhamento-retorno.tsx#kpi`; `aderencia_derive_retorno` (futuro mantém elegível) |
| P-08 | Importação XLSX sobrescreve "Fez Check List" vindo do app e overrides manuais (upsert cego por placa+data); `manual_override` não é resetado | `uploadChecklistBatch` |
| P-09 | Placa do XLSX não é normalizada (upper/sem hífen) no cliente; o resto do sistema compara por `fleet_norm_placa`/`upper` → risco de linhas duplicadas por variação de grafia | `parseChecklistXlsx` (`clean` apenas trim) vs UK `(placa,data)` |
| P-10 | Documentação no código diz que `build_referencia` gera expurgo para Reserva/inativo; a função insere tudo como "Não Fez" (coluna `inativo` sempre `false`) | `aderencia-api.ts` comentário vs corpo de `aderencia_build_referencia` |
| P-11 | Cliente lê `fidelization_daily` diretamente (com fallback `gestor`) enquanto o servidor declara que só o resolver canônico (`vw_frota_escopo_competencia`) vale → liderança/local podem divergir entre matriz e KPI | `getFidelizationBindingsRange` vs `fleet-scope.server.ts` |
| P-12 | `aderencia_sync_retorno` não é idempotente nos contadores: grava `'Fez Check List'` que o trigger reescreve para `'Fez Check List Retorno'`, então a condição `IS DISTINCT FROM 'Fez Check List'` é sempre verdadeira e `marcados` repete a cada execução | corpos de `aderencia_sync_retorno` e `aderencia_derive_retorno` |
| P-13 | Retorno após a meia-noite (SP) é atribuído ao dia seguinte (data SP de `data_finalizacao`), não à jornada da saída; não existe vínculo saída↔retorno | `checklist_frota_aderencia_apply`, `aderencia_sync_retorno` |
| P-14 | Caminho cliente `enviarChecklist` marca **saída** como "Fez" mesmo para `tipo_checklist='retorno'` e usa data UTC; concorre com o trigger do banco (que usa SP e distingue tipo) | `checklist-frota-api.ts#marcarChecklistNoMotorAderencia` |
| P-15 | Lançamento manual de retorno em dia com saída expurgada (motivo com réplica) é sobrescrito pela herança no mesmo UPDATE | `aderencia_derive_retorno` (herança tem precedência sobre `retorno_manual_override`) |
| P-16 | `aderencia_set_retorno_manual` retorna `sem_linha` sem inserir; cliente/servidor ignoram o retorno → edição/aprovação "com sucesso" sem efeito | corpo da RPC; `setManualStatus`, `decidirSolicitacao` |
| P-17 | Catálogo de motivos inconsistente: `FROTA_NAO_ATIVA` existe na tabela e no dropdown de reclassificação, mas o status manual "Frota Não Ativa" grava `SEM_INFORMACAO`; o filtro "Motivo" da aba Expurgos não lista `FROTA_NAO_ATIVA` | `aderencia_expurgo_motivos`, `STATUS_TO_DERIVED`, `expurgos-panel.tsx#MOTIVOS` |
| P-18 | Meta 90% hard-coded; `aderencia_metas` vazia e não lida | `visao-consolidada.tsx`, `heatmap-calendar.tsx`; `SELECT * FROM aderencia_metas` → 0 linhas |
| P-19 | Telas de leitura disparam escrita (`aderencia_build_referencia` + `recalc`) a cada abertura/5 min, para qualquer perfil | `visao-consolidada.tsx`, `visao-mes-dia.tsx` |
| P-20 | `tab=retorno|jornada` aceitos na URL mas não existem como abas (caem em Consolidado) | rotas `ABAS` vs `aderencia-module.tsx#visiveis` |
| P-21 | Toasts de importação reportam linhas enviadas, não linhas efetivamente alteradas; `aderencia_upload_logs` não registra intervalo de datas nem contagem de upserts | `uploadChecklistBatch` |

---

## 12. Contratos funcionais que o HFM deve reproduzir

* Grão do motor: **1 registro por (placa normalizada, data operacional)** com dois blocos independentes — Saída e Retorno — no mesmo registro; data operacional em `America/Sao_Paulo`.
* Frota prevista do dia = escopo canônico da competência (Fidelização → tipo/local; Planner → liderança), filtrada por tipo de equipamento vinculado ao módulo; toda placa prevista nasce **"Não Fez Check List"** e elegível; materialização apenas até hoje; contexto (tipo/local/liderança/BR) regravado a cada materialização a partir do canônico.
* Casamento execução → registro por placa normalizada + data SP de `COALESCE(data_finalizacao, data_inicio)` + tipo (`saida`/`retorno`); apenas app `check-list-frota`; "Fez" **só** nasce do app (nunca manual), e um envio do app limpa expurgo/justificativa da saída.
* Aderência (saída) = `Σ realizado ÷ Σ (elegível ∧ sem justificativa aprovada)`; denominador 0 → `null` ("—"); agregações sempre por soma de numeradores/denominadores; KPI materializado por dia × tipo × liderança × local × BR e recalculado no intervalo afetado após qualquer alteração.
* Aderência (retorno) = `Σ (realizado ∧ elegível) ÷ Σ elegível`, só datas ≤ hoje.
* Expurgo = registro com `elegivel=false` e `motivo_expurgo`; motivos `SEM_ROTA, MANUTENCAO, RESERVA, EM_VIAGEM, SEM_INFORMACAO, DESCONHECIDO` (+`FROTA_NAO_ATIVA` no catálogo); situação `PENDENTE|APROVADA|REJEITADA|RECLASSIFICADA`; decisão individual ou em massa (selecionados / todos filtrados) com justificativa obrigatória exceto aprovar; auditoria consolidada com filtros e quantidade.
* Herança Saída → Retorno por motivo (`replica_no_retorno`, configurável): saída expurgada ⇒ retorno expurgado com rótulo "Herdado da Saída — <label>"; herança prevalece sobre lançamento manual do retorno.
* Status manuais: `NAO_FEZ_CHECKLIST, FROTA_RESERVA, MANUTENCAO, SEM_ROTA, EM_VIAGEM, FROTA_NAO_ATIVA` com a tabela `STATUS_TO_DERIVED` (§2.2); gestor aplica direto (individual/massa por placas×dias, com "preservar Fez"); liderança apenas **solicita** (uma pendente por placa+data+novo_status), gestor/admin decide (revisor ≠ solicitante; idempotente), aprovação aplica exatamente a regra manual.
* Matriz Mês/Dia: hierarquia de exibição Frota Não Ativa > Manutenção > Reserva > Sem Rota > Em Viagem > Fez > Não Fez > Sem dado; placa prevista sem registro e data ≤ hoje = Não Fez; futuro = Sem dado; marcadores de override manual e solicitação pendente; filtros Placa/De/Até/Tipo/Local/Liderança/Status; deep-link a partir do Heatmap.
* Contexto global Saída/Retorno como estado de URL, aplicado a KPIs, matriz, heatmap, expurgos herdados, lançamentos e importação/reconciliação.
* Importação XLSX "Base Check List" com cabeçalhos e mapeamento de status de §9/§2.1, idempotente por (placa,data), log com rejeições; "Relatos" apenas histórico.
* Faixas: ≥ 90 OK · 70–89,99 Atenção · < 70 Crítico; meta parametrizável (o HFC não parametriza — recomenda-se ler de `aderencia_metas`).
* Recomendações ao reproduzir (não são comportamento atual): aplicar autorização no servidor (P-01); unificar a data "hoje" (P-02); um único caminho de marcação de "Fez" (P-14); tratar `REJEITADA` devolvendo elegibilidade (P-06); vincular retorno à jornada da saída ou definir corte horário (P-13); não sobrescrever "Fez"/override na importação (P-08).

---

## 13. Limitações da inspeção

* O banco ficou **indisponível** (timeouts de 60 s no `query_database`) a partir da metade da inspeção; falharam e não foram repetidas com sucesso: definição de `vw_frota_escopo_competencia`; corpos de `fleet_norm_placa` e `fn_resolve_fleet_scope`; confirmação de que `checklist_frota_after_respostas` está anexada como trigger (e em qual tabela); lista de policies RLS (só a contagem foi obtida); amostras de `status_original`/`retorno_status_original` em produção; contagens de linhas e `aderencia_hoje()` ao vivo.
* `supabase/migrations/` existe (≥ 46 arquivos com nomes opacos), mas não foi lido — os corpos de função acima vieram diretamente de `pg_get_functiondef` antes da indisponibilidade.
* Não foi verificado o `tgtype` (row vs statement) do trigger `trg_fsd_derive_retorno` além da definição textual `FOR EACH ROW`.
* Semântica de `fidelization_daily.status_operacional` (`ativa`/`reserva`/…) e como a view canônica trata "reserva" não foi confirmada.
* Comportamento de `MultiSelectFilter`, `semantic-tone` (classes exatas de cor) e do componente `Sheet` não foi inspecionado — apenas os tokens (`success/warning/danger/info/brand/neutral`) usados.
* Nenhuma amostra de dados pessoais foi copiada; placas citadas no código (`SNT8E36`, `ABC1D23`) são placeholders do próprio HFC.
* Não se validou o comportamento em runtime (sem execução da UI); tudo é leitura estática de código e catálogo.
