# Gestão de Checklist › Planos de Ação — Plano de Ação de Manutenção

Módulo gerencial das inconformidades técnicas recebidas pelo **Check List de
Frota**. Ele transforma cada apontamento operacional em tratativa rastreável,
manutenção real (sempre a do módulo oficial **Gestão de Frota › Manutenção**) e
indicadores confiáveis, **sem misturar o fluxo de Avarias com o de Manutenção**.

- Rota: `/checklist/planos-acao` (abas: Visão geral, Planos de manutenção,
  Conciliação × Manutenções, Parâmetros & Mapeamento, Qualidade & Auditoria,
  Minha visão, Histórico de checklists) e `/checklist/planos-acao/meus-apontamentos`
  (feedback do motorista).
- Banco: `supabase/migrations/20261002100000_action_plans_foundation.sql`,
  `…101000_action_plans_engine.sql`, `…102000_action_plans_actions.sql`,
  `…103000_action_plans_reads.sql`.
- Testes: `supabase/tests/remote/25_action_plans.sql` (91–103 + correção e
  leituras) e `tests/ui/action-plans.spec.ts`.
- Referência funcional: HFC (Lovable), GPAC — mapeado **somente leitura**; nada
  foi alterado no HFC.

## 1. Segregação Avaria × Manutenção

A separação é por **configuração da chave estável da pergunta**, nunca pelo
texto. Cada pergunta (e cada campo condicional) do Check List tem uma linha em
`checklist_action_parameters`, identificada por `(app, question_key, field_key)`
— as chaves que atravessam as versões publicadas do formulário (o id da
pergunta muda a cada versão; a chave não).

| Campo | Significado |
|---|---|
| `action_domain` | `maintenance` alimenta este módulo; `damage` vai para o fluxo de Sinistros/Avarias |
| `question_role` | `trigger` (pergunta com detalhe), `standalone`, `detail` (campo de seleção que especializa), `description` (relato livre) |
| `generates_plan`, `status` | elegibilidade |
| `plan_grouping` | detalhe de seleção: `option` (um plano por opção) ou `question` (um plano, um apontamento por opção) |
| `action_title`, `default_priority`, `sla_days` | título do problema, prioridade e prazo padrão |
| `requires_maintenance`, `requires_manual_analysis`, `driver_visible` | tratativa esperada, análise obrigatória, visível no feedback do motorista |

O seed classifica o formulário atual: **`funilaria.avaria` ("Possui alguma
avaria?") e o seu relato `descricao_avaria` são `damage`**; todas as demais
inconformidades são `maintenance`. Uma pergunta marcada como avaria contamina os
seus detalhes. O administrador ajusta em Parâmetros & Mapeamento; o servidor
recusa mapear serviços de manutenção para perguntas de avaria.

Respostas de avaria **não** geram apontamento nem plano: o recebimento publica o
evento oficial `checklist.damage.reported` no outbox (uma vez por resposta),
para o módulo de Sinistros/Avarias consumir. A Saúde da integração mostra quantas
foram encaminhadas e quantos eventos aguardam consumo.

## 2. Fluxo

```
CHECKLIST CONCLUÍDO (submit_checklist_execution)
  → EVENTO checklist.execution.submitted (outbox, mesma transação)
  → CLASSIFICAÇÃO de cada resposta inconforme (private.action_plan_answer_route)
      avaria        → evento checklist.damage.reported (fluxo de Avarias)
      não elegível  → registrado nas contagens do recebimento
      manutenção    → APONTAMENTO → PLANO (aberto do mesmo problema, ou novo ciclo)
```

- **Recebimento**: gatilho `AFTER INSERT` no outbox (a Aderência consome no
  `BEFORE` e marca o evento; este módulo tem o seu próprio controle,
  `action_plan_ingestions`, um por execução). Falha nunca derruba o checklist:
  o controle fica `failed` e a rotina `hfm_action_plans_tick` (pg_cron, 20 min)
  tenta de novo, varre checklists sem controle e roda a conciliação automática.
- **Correção administrativa** do checklist (não emite evento): gatilho na
  resposta reclassifica — cria o apontamento que passou a existir; cancela, com
  registro, o que só estava pendente; o que já tinha tratativa fica e aparece
  em Qualidade (`correction_conflict`). A resposta original nunca é alterada
  nem apagada por este módulo.
- **Idempotência**: um apontamento por `(resposta, opção)` (índice único);
  um plano aberto por `(veículo, plan_key)` (índice único parcial); evento de
  avaria uma vez por resposta. Reprocessar não duplica nada (teste T102).
- **Recebimento inicial**: a migration processa os checklists já enviados, em
  ordem cronológica.

## 3. Action key, apontamento e plano

- `action_key = q:<question_key>[:<field_key>]` — a mesma forma de
  `maintenance_checklist_service_links.action_key`: é por ela que o plano
  encontra os serviços mapeados.
- `plan_key` = identidade do problema no veículo:
  `q:<pergunta>` ou, com detalhe agrupado por opção,
  `q:<pergunta>:<campo>=<opção>` ("Faróis com falha — Farol esquerdo").
- **Gatilho × detalhe**: o detalhe especializa o gatilho, nunca os dois. Faróis
  = NÃO + "Farol esquerdo" → 1 problema lógico. Multisseleção (esquerdo +
  direito) → um plano por opção (padrão) ou um plano com dois apontamentos
  (`plan_grouping = question`). Gatilho sem detalhe marcado → plano da pergunta,
  sinalizado em Qualidade (`trigger_without_detail`).
- **Apontamento** (`action_plan_items`): uma ocorrência individual, com o
  contexto histórico congelado do checklist — operação, estado, cidade, BR,
  filial, liderança, veículo, placa, data operacional, tipo de checklist,
  colaborador — e o relato.
- **Plano** (`action_plans`): agrupamento gerencial por veículo + problema.
  Guarda o contexto do 1º apontamento (escopo e agrupamentos), código
  `PA-AAAA-NNNNNN`, prioridade, prazo, responsável, contadores e ciclo.
- **Recorrência**: o mesmo problema ainda aberto atualiza o plano (1 plano, N
  apontamentos). Com manutenção aberta no plano, a nova ocorrência entra na
  mesma manutenção (não abre outra). Plano já encerrado → **novo ciclo**
  ligado ao anterior (`previous_plan_id`, `cycle_number`); se o anterior foi
  resolvido dentro da janela (`recurrence_window_days`, padrão 30), o novo é
  marcado **possível reincidência** — indicador para análise, sem afirmar falha
  da manutenção.

## 4. Situações (máquina de estados)

Situação do **apontamento**: `pending`, `in_maintenance`, `needs_action`
(manutenção terminou sem resolver), `resolved`, `resolved_without_maintenance`,
`improper`, `cancelled`.

Situação do **plano** — sempre **derivada** dos apontamentos por
`private.action_plan_refresh`:

| Situação | Quando |
|---|---|
| Novo / Em análise / Aguardando manutenção | há pendência sem manutenção; vem da decisão de análise (`analysis_state`) |
| Manutenção aberta / agendada / em execução | há apontamento coberto por manutenção vinculada aberta (pela situação mais avançada) |
| Pendente de nova tratativa | a manutenção vinculada terminou (concluída sem resolver, cancelada, não realizada) e há apontamento sem solução |
| Resolvido | sem pendência e ao menos um apontamento resolvido |
| Resolvido sem manutenção | sem pendência, resolvidos sem manutenção (e improcedentes) |
| Improcedente | sem pendência, todos improcedentes |
| Cancelado | todos cancelados |

Não há plano encerrado com pendência nem aberto sem pendência (teste T100;
verificações em Qualidade). Encerramento pelo motor grava
`auto_closed = true` (fechamento automático) e o evento `auto_closed`; pelo
usuário, `closed`. O encerramento usa a data da última resolução (respeita a
baixa com data retroativa).

## 5. Prioridade, prazo (SLA) e responsável

- Prioridade inicial: a do parâmetro; sem parâmetro, pela criticidade da
  pergunta (crítica → Alta, demais → Média). Seed: freios e pneus críticos →
  Crítica. Alteração por `action_plans.change_priority`, com motivo e
  histórico; recalcula o prazo quando o prazo é o do SLA.
- Prazo = 1º apontamento + dias do parâmetro, ou do SLA por prioridade
  (`action_plan_settings`: crítica 1, alta 3, média 7, baixa 15 dias corridos).
  Alteração manual com motivo (`due_source = user`).
- Faixas: No prazo, Vence hoje, Vence em breve (N dias), Vencido, Sem prazo;
  encerrados: Tratado no prazo / fora do prazo.
- Responsável atual (`responsible_user_id`) é distinto da liderança histórica do
  checklist.

## 6. Mapeamento Pergunta × Serviço e cobertura

Fonte única: `maintenance_checklist_service_links` (o mesmo cadastro da
Manutenção; não existe catálogo paralelo). Editado por pergunta/campo em
Parâmetros & Mapeamento (`action_plans.manage_mappings`) ou por serviço no
Cadastro de Serviços. Serviço que sai é desativado, nunca apagado.
`auto_resolve` = a conclusão desse serviço resolve o apontamento.

**Cobertura** (`private.action_plan_coverage`): ações geradoras (perguntas de
manutenção que geram plano e os seus detalhes), mapeadas, não mapeadas,
conflitantes (mapeamento para serviço inativo/arquivado), inativas, com baixa
automática e %. Sem serviço mapeado o apontamento é recebido normalmente
(pendente de classificação técnica) — só não há baixa automática nem
conciliação de alta confiança. Um novo mapeamento não reescreve o histórico das
manutenções; os pendentes podem ser conciliados depois, pela Conciliação.

## 7. Abertura de manutenção

"Abrir manutenção" no plano usa o **assistente oficial** da Manutenção,
pré-preenchido: veículo, tipo corretiva, origem **Plano de ação**
(`action_plan`), serviços mapeados, apontamentos selecionados, prioridade e
descrição. Antes, o plano mostra as **candidatas** (manutenções ativas do mesmo
veículo e serviço) para vincular em vez de duplicar. A gravação passa por
`public.action_plan_open_maintenance`, que confere `action_plans.open_maintenance`
e chama `public.maintenance_create` (que exige `maintenance.create`, acesso ao
veículo e contexto histórico, e recusa equivalente aberta sem justificativa —
hint `maintenance_duplicate`). Os apontamentos vão para a manutenção
(`maintenance_finding_links`) e o vínculo plano × manutenção nasce com origem
`opened_from_plan`.

Abrir manutenção com apontamentos pelo próprio módulo Manutenção também vincula
o plano (origem `maintenance_module`), pelo gatilho no vínculo do apontamento.

## 8. Vínculo N:N e conciliação

`action_plan_maintenance_links` é a fonte oficial: um plano pode ter várias
manutenções e uma manutenção pode tratar vários planos. Cada vínculo guarda
origem (`opened_from_plan`, `linked_manual`, `maintenance_module`,
`auto_reconciliation`, `reconciliation_manual`), confiança, regra, se é
resolutivo, motivo, autor e data. Desvincular e descartar candidata mantêm a
linha (`unlinked`/`discarded`) — nada é apagado.

**Candidatas** (`private.action_plan_candidates`): manutenções do mesmo
`vehicle_id` (nunca placa em texto), não canceladas, abertas ou com referência
entre o 1º apontamento e a janela de conciliação após o último:

| Confiança | Regra |
|---|---|
| Alta | item com serviço mapeado (ativo) para a chave do plano, sem conflito (uma só candidata assim e nenhum outro plano aberto do veículo disputando o serviço) |
| Média | serviço mapeado com conflito, ou mesmo cluster técnico dos serviços mapeados |
| Revisão manual | mesmo veículo e período, sem correspondência técnica (ou item sem mapeamento) |
| Sem correspondência | nenhuma candidata |

Conciliação automática: só **alta confiança** (`service_mapping_specific`), na
rotina e sob demanda (`action_plans.reconcile`), registrando origem
`auto_reconciliation`, confiança, regra e data.

## 9. Resolução por apontamento

A resolução é no nível do **apontamento**; uma manutenção não resolve o plano
inteiro.

- **Pela manutenção**: concluída a manutenção, `maintenance_resolve_findings`
  marca resolvido o apontamento cujo serviço realizado está mapeado com baixa
  automática. O plano resolve o apontamento quando a correspondência é
  específica (a resposta tem só este apontamento no plano e, se a mesma resposta
  gerou outros apontamentos, a manutenção foi vinculada a este plano por decisão
  explícita). Fora disso → "Pendente de nova tratativa", com **validação** pelo
  responsável (`validated_by_maintenance`).
- **Parcial**: 3 apontamentos, manutenção trata 2 → 2 resolvidos, 1 pendente,
  plano aberto (teste T97).
- O recálculo após operações da Manutenção roda em **gatilhos adiados** (fim da
  transação): concluir a manutenção muda a situação e só depois resolve os
  apontamentos — o plano vê só o estado final. O recálculo nunca derruba a
  operação da Manutenção; a rotina refaz o que falhar.
- **Resolvido sem manutenção** (`action_plans.resolve_without_maintenance`):
  motivo padronizado + descrição da ação (≥ 10) + responsável; data retroativa
  opcional. Nenhuma manutenção é criada (T99).
- **Improcedente** (`action_plans.mark_improper`): motivo + justificativa
  (≥ 10); a resposta do motorista fica intacta (T98).
- Bloqueio: sem manutenção/improcedente não são aceitos enquanto há manutenção
  **aberta** tratando o apontamento (como no HFC).
- **Cancelamento** (`action_plans.cancel`): motivo administrativo (≥ 10),
  distinto de improcedência; nada é apagado.
- **Reabertura** (`action_plans.reopen`): plano resolvido/sem
  manutenção/improcedente volta a ter os apontamentos pendentes (registro
  "reaberto"); manutenções já terminadas deixam de contar como tratativa e
  continuam como histórico. Se já existe outro plano aberto do mesmo problema,
  a tratativa segue nele. Nova ocorrência depois do encerramento abre novo
  ciclo relacionado.

Todo o histórico fica em `action_plan_item_resolutions` e `action_plan_events`
(append-only), com autor real (nunca "Sistema" quando há usuário autenticado).

## 10. Indicadores (Visão geral)

Calculados no servidor (`public.action_plan_dashboard`), sobre o mesmo filtro e
escopo da lista:

- **Inconformidades recebidas**: respostas inconformes do período (inclui avaria
  e não elegíveis, mostradas à parte).
- **Apontamentos** pendentes/tratados; **planos** ativos, vencidos, críticos,
  com/sem manutenção, resolvidos sem manutenção, improcedentes; veículos com
  pendência; reincidências.
- **Aderência de Tratativa** = apontamentos tratados (resolvidos, sem
  manutenção, improcedentes) ÷ (apontamentos − cancelados) × 100. **Não é** a
  Aderência de Checklist (que mede se o checklist foi feito) e nada aqui altera
  a Aderência.
- **TMR** = 1º apontamento → encerramento dos planos resolvidos: média,
  mediana e P90 (dias), por prioridade e cluster.
- **% tratado no prazo** = encerrados até o prazo ÷ encerrados com prazo.
- Funil (recebidas → classificadas → em plano → tratativa definida →
  manutenção/outra resolução → resolvidas), faixas de prazo, aging, evolução
  (novos × tratados, backlog), distribuição por operação, cidade, liderança,
  cluster, top itens, top veículos com reincidência, origem das resoluções,
  cobertura do mapeamento. Todo indicador abre a lista filtrada (drill-down).

## 11. Qualidade & Auditoria e Saúde da integração

Verificações (`public.action_plan_quality`), cada uma com classe de correção:
**correção automática segura** (recalcular situação/contadores, reprocessar
recebimento — `action_plan_quality_fix`), **revisão necessária** ou
**bloqueada**. Inclui: inconformidade sem apontamento, plano sem apontamentos,
encerrado com pendência, aberto sem pendência, contadores desatualizados, item
sem serviço mapeado, mapeamento para serviço inativo, gatilho sem detalhe,
aberto há 30+ dias sem manutenção, vínculo com manutenção cancelada, vínculo de
outro veículo, plano sem contexto histórico, correção do checklist em conflito,
falhas de recebimento, múltiplas candidatas. Nada é corrigido em silêncio.

Saúde (`public.action_plan_health`): checklists enviados/processados/falhos/
pendentes, inconformidades por rota, apontamentos e planos criados/atualizados,
reprocessamentos, eventos de avaria pendentes, falhas recentes, série diária.

## 12. Integrações

| Módulo | Integração |
|---|---|
| Check List de Frota | fonte única (evento do outbox; sem fotos ou anexos; nenhum formulário novo) |
| Manutenção | abertura pelo assistente oficial, vínculo N:N, resolução pelos apontamentos da manutenção, gatilhos de situação |
| Cadastro de Frotas | aba "Planos de ação" na gaveta do veículo (ativos, ciclos, reincidências, manutenções) |
| BRs, Fidelização, Lideranças | contexto histórico congelado do checklist (BR, operação, cidade, liderança da data); trocas posteriores não movem o plano (T101) |
| Aderência | não é alterada por inconformidades; consome o mesmo evento, no seu próprio gatilho |

## 13. RBAC e RLS

Permissões (`action_plans.*`): `view`, `view_own`, `view_dashboard`, `manage`,
`assign`, `change_priority`, `open_maintenance`, `link_maintenance`,
`resolve_without_maintenance`, `mark_improper`, `cancel`, `reopen`,
`manage_parameters`, `manage_mappings`, `reconcile`, `import`, `export`,
`view_audit`, `reprocess`.

Padrões da matriz (ajustáveis em Administração › Perfis & Permissões):
Administrador e Gestor de Frota — todas; Gestão — ver, visão geral, exportar,
auditoria; Liderança de Operações — ver, visão geral, exportar (acompanha o
escopo, como no HFC); Segurança — ver e visão geral; Operacional — só os
próprios apontamentos (`view_own`); Gente — nada.

RLS em todas as tabelas: leitura por permissão e **escopo do contexto gravado**
(operação do 1º apontamento; sem operação, o escopo atual do veículo); tabelas
filhas pelo plano. Escrita só por RPCs `SECURITY DEFINER` que conferem permissão
e escopo de novo — esconder botão não é controle. Multi-tenant por
`organization_id` em toda chave estrangeira composta. Planos, apontamentos e
vínculos não podem ser apagados (gatilho); resoluções e eventos são
append-only.

## 14. Importação de follow-up

`action_plans.import`: planilha com código do plano (ou placa + item, quando
há um único plano aberto), ação (`SEM_MANUTENCAO`, `IMPROCEDENTE`, `CANCELAR`,
`MANTER`), motivo, justificativa e data da resolução. Prévia (sem gravar) e
aplicação linha a linha pela mesma rotina das tratativas, com as mesmas
validações e permissões. Nunca cria veículo/operação, nunca altera perfil de
acesso e nunca reescreve histórico de manutenção.

## 15. Diferenças em relação ao HFC (GPAC)

| HFC | HFM |
|---|---|
| Avaria decidida por texto da pergunta | domínio por chave estável e parâmetro |
| Nova redação = nova action key, planos duplicados | chave estável atravessa as versões |
| Situação não derivada; fechado com pendência | situação sempre derivada, sem contradição |
| Filtros no navegador, limite de 500 | filtros, ordenação, paginação e agregação no servidor |
| Contexto pela alocação atual da placa | contexto histórico congelado no apontamento |
| `maintenance_record_id` legado | vínculo N:N como fonte oficial |
| Sem tela de responsável; prioridade sem histórico | responsável, prioridade e prazo com trilha |
| Baixas administrativas contam como "Resolvidos" ambíguo | situações distintas e indicadores explícitos |
