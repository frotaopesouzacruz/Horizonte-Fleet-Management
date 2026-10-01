-- =============================================================================
-- Gestão de Checklist › Planos de Ação — Plano de Ação de MANUTENÇÃO: fundação
--
-- O HFC (Lovable, GPAC) foi usado só como referência funcional. O desenho
-- corrige o que o mapeamento mostrou (docs/modules/checklist-maintenance-action-plans.md):
--
--   * Domínio explícito por pergunta (action_domain MAINTENANCE × DAMAGE),
--     por chave estável — nunca pelo texto. "Possui alguma avaria?" e o relato
--     da avaria são DAMAGE e nunca entram neste módulo.
--   * CHECKLIST → RESPOSTA INCONFORME → APONTAMENTO → PLANO. Toda inconformidade
--     elegível vira um apontamento com identidade própria (resposta + opção do
--     detalhe); o plano é o agrupamento gerencial por veículo + chave do
--     problema, e recorrências atualizam o plano aberto.
--   * Situação do plano DERIVADA dos apontamentos (nunca fechado com pendência,
--     nunca aberto sem pendência).
--   * Vínculo plano × manutenção N:N como fonte oficial; a manutenção é sempre
--     a do módulo oficial (Gestão de Frota › Manutenção).
--   * Contexto histórico congelado no apontamento (operação, cidade, BR,
--     liderança, filial, veículo e data operacional do checklist) — nunca a
--     alocação de hoje.
--   * Mapeamento Pergunta × Serviço: o MESMO de Manutenção
--     (maintenance_checklist_service_links). Não existe um segundo catálogo.
--
-- Esta migration cria permissões, tabelas, gatilhos padrão, RLS e o seed da
-- classificação do formulário atual. O motor (recebimento, consolidação,
-- situação derivada, integração com Manutenção) e as RPCs estão nas migrations
-- seguintes da mesma data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões (Administração › Perfis & Permissões)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('action_plans.view',                        'action_plans', 'Ver planos de ação',              'Acessa Gestão de Checklist › Planos de Ação: planos, apontamentos e histórico do escopo.'),
  ('action_plans.view_own',                    'action_plans', 'Acompanhar meus apontamentos',    'O colaborador acompanha o andamento dos problemas que ele mesmo reportou no Check List. Só leitura.'),
  ('action_plans.view_dashboard',              'action_plans', 'Ver visão geral',                 'Indicadores gerenciais dos planos de ação.'),
  ('action_plans.manage',                      'action_plans', 'Tratar planos',                   'Inicia a análise, define a tratativa, o prazo e registra observações.'),
  ('action_plans.assign',                      'action_plans', 'Atribuir responsável',            'Define o responsável atual pela tratativa do plano.'),
  ('action_plans.change_priority',             'action_plans', 'Alterar prioridade',              'Altera a prioridade do plano, com motivo e histórico.'),
  ('action_plans.open_maintenance',            'action_plans', 'Abrir manutenção pelo plano',     'Abre manutenção no módulo oficial a partir do plano. Exige também Manutenção › Abrir manutenção.'),
  ('action_plans.link_maintenance',            'action_plans', 'Vincular manutenção',             'Vincula ou desvincula manutenção existente ao plano.'),
  ('action_plans.resolve_without_maintenance', 'action_plans', 'Resolver sem manutenção',         'Registra solução sem intervenção técnica, com motivo e descrição da ação.'),
  ('action_plans.mark_improper',               'action_plans', 'Classificar improcedente',        'Classifica apontamento como improcedente, com motivo e justificativa.'),
  ('action_plans.cancel',                      'action_plans', 'Cancelar',                        'Cancela apontamento ou plano por motivo administrativo, com justificativa.'),
  ('action_plans.reopen',                      'action_plans', 'Reabrir plano',                   'Reabre plano encerrado, com motivo, preservando o ciclo anterior.'),
  ('action_plans.manage_parameters',           'action_plans', 'Gerir parâmetros',                'Domínio, papel, chave de ação, prioridade, prazo e demais parâmetros por pergunta.'),
  ('action_plans.manage_mappings',             'action_plans', 'Gerir mapeamento de serviços',    'Pergunta × Serviço do catálogo oficial da Manutenção.'),
  ('action_plans.reconcile',                   'action_plans', 'Conciliar com manutenções',       'Conciliação plano × manutenção: vincular candidatos, descartar e executar a conciliação automática.'),
  ('action_plans.import',                      'action_plans', 'Importar follow-up',              'Importa tratativas em lote (follow-up), com validação e prévia.'),
  ('action_plans.export',                      'action_plans', 'Exportar planos',                 'Exporta planos e apontamentos do escopo.'),
  ('action_plans.view_audit',                  'action_plans', 'Ver auditoria',                   'Qualidade & Auditoria, trilha completa e saúde da integração.'),
  ('action_plans.reprocess',                   'action_plans', 'Reprocessar',                     'Reprocessa checklists e a situação dos planos (idempotente).')
on conflict (code) do nothing;

-- Padrões por perfil oficial — TODOS num único comando: o gatilho de
-- sincronização é por comando e só entrega código que a organização nunca teve
-- (a Manutenção precisou de 20260928106000 por inserir em dois comandos).
-- Nada aqui concede acesso pelo nome do perfil: são os padrões da matriz, que o
-- administrador ajusta depois. Como no HFC, a Liderança acompanha (leitura do
-- escopo) e a tratativa é da gestão de frota; Gente não recebe nada.
insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('gestor_frota')) p(profile_code)
  cross join (select code from public.permissions where module = 'action_plans') c
union all
select v.profile_code, v.permission_code
  from (values
    ('gestao',              'action_plans.view'),
    ('gestao',              'action_plans.view_dashboard'),
    ('gestao',              'action_plans.export'),
    ('gestao',              'action_plans.view_audit'),
    ('lideranca_operacoes', 'action_plans.view'),
    ('lideranca_operacoes', 'action_plans.view_dashboard'),
    ('lideranca_operacoes', 'action_plans.export'),
    ('seguranca',           'action_plans.view'),
    ('seguranca',           'action_plans.view_dashboard'),
    ('operacional',         'action_plans.view_own')) v(profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Parâmetros de ação por pergunta (e por campo condicional)
-- -----------------------------------------------------------------------------
-- Identidade = (app, question_key, field_key): as chaves estáveis do Check List,
-- que atravessam as versões (o id da pergunta muda a cada versão publicada).
-- A action_key tem a MESMA forma da de maintenance_checklist_service_links, e é
-- por ela que o plano encontra os serviços mapeados.
create table if not exists public.checklist_action_parameters (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  app_id                   uuid not null references public.operational_apps (id) on delete restrict,
  question_key             text not null,
  field_key                text,
  action_key               text generated always as ('q:' || question_key || coalesce(':' || field_key, '')) stored,
  -- MAINTENANCE alimenta este módulo; DAMAGE vai para o fluxo de Avarias.
  action_domain            text not null default 'maintenance',
  -- trigger: pergunta com detalhe que a especializa; standalone: sem detalhe;
  -- detail: campo de seleção que especializa o gatilho (não gera plano próprio);
  -- description: relato livre (informativo, nunca gera plano).
  question_role            text not null default 'standalone',
  generates_plan           boolean not null default true,
  -- Só para detalhe de seleção: option = um plano por opção marcada ("Farol
  -- esquerdo com falha"); question = um plano da pergunta com um apontamento
  -- por opção.
  plan_grouping            text not null default 'option',
  action_title             text,
  default_priority         text,
  sla_days                 integer,
  requires_maintenance     boolean not null default true,
  requires_manual_analysis boolean not null default false,
  driver_visible           boolean not null default true,
  status                   text not null default 'active',
  notes                    text,
  created_at               timestamptz not null default now(),
  created_by               uuid references auth.users (id) on delete set null,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id) on delete set null,
  constraint checklist_action_parameters_key unique (organization_id, app_id, question_key, field_key),
  constraint checklist_action_parameters_question_check check (question_key ~ '^[a-z0-9_.-]{1,80}$'),
  constraint checklist_action_parameters_field_check check (field_key is null or field_key ~ '^[a-z0-9_.-]{1,80}$'),
  constraint checklist_action_parameters_domain_check check (action_domain in ('maintenance', 'damage')),
  constraint checklist_action_parameters_role_check check (
    (field_key is null and question_role in ('trigger', 'standalone'))
    or (field_key is not null and question_role in ('detail', 'description'))),
  constraint checklist_action_parameters_grouping_check check (plan_grouping in ('option', 'question')),
  constraint checklist_action_parameters_priority_check check (
    default_priority is null or default_priority in ('low', 'medium', 'high', 'critical')),
  constraint checklist_action_parameters_sla_check check (sla_days is null or sla_days between 0 and 365),
  constraint checklist_action_parameters_title_check check (action_title is null or length(action_title) between 2 and 160),
  constraint checklist_action_parameters_status_check check (status in ('active', 'inactive'))
);
create unique index if not exists checklist_action_parameters_nullfield_key
  on public.checklist_action_parameters (organization_id, app_id, question_key) where field_key is null;
comment on table public.checklist_action_parameters is
  'Parâmetros de ação por pergunta/campo do Check List, pela chave estável (nunca pelo texto). action_domain separa MANUTENÇÃO de AVARIA; os serviços vêm de maintenance_checklist_service_links (mesma action_key).';

-- -----------------------------------------------------------------------------
-- 3. Configurações do módulo por organização
-- -----------------------------------------------------------------------------
create table if not exists public.action_plan_settings (
  organization_id            uuid primary key references public.organizations (id) on delete cascade,
  -- Prazo padrão (dias corridos a partir do 1º apontamento) por prioridade.
  sla_days_critical          integer not null default 1,
  sla_days_high              integer not null default 3,
  sla_days_medium            integer not null default 7,
  sla_days_low               integer not null default 15,
  due_soon_days              integer not null default 3,
  -- Reincidência: mesmo veículo + mesma chave até N dias após o fechamento.
  recurrence_window_days     integer not null default 30,
  -- Conciliação: manutenções até N dias após o último apontamento.
  reconciliation_window_days integer not null default 30,
  auto_reconcile             boolean not null default true,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users (id) on delete set null,
  constraint action_plan_settings_sla_check check (
    sla_days_critical between 0 and 365 and sla_days_high between 0 and 365
    and sla_days_medium between 0 and 365 and sla_days_low between 0 and 365),
  constraint action_plan_settings_soon_check check (due_soon_days between 1 and 30),
  constraint action_plan_settings_windows_check check (
    recurrence_window_days between 1 and 365 and reconciliation_window_days between 1 and 180)
);
comment on table public.action_plan_settings is
  'Parâmetros do Plano de Ação de Manutenção por organização: prazo por prioridade, janela de "vence em breve", de reincidência e de conciliação, e se a conciliação automática (só alta confiança) está ligada.';

-- -----------------------------------------------------------------------------
-- 4. Plano de ação
-- -----------------------------------------------------------------------------
create table if not exists public.action_plans (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  code                      text not null,
  app_id                    uuid not null references public.operational_apps (id) on delete restrict,
  vehicle_id                uuid not null,
  -- Identidade do problema no veículo: q:<pergunta>[:<campo>=<opção>].
  plan_key                  text not null,
  -- A chave de ação dos parâmetros e do mapeamento de serviços: q:<pergunta>[:<campo>].
  action_key                text not null,
  question_key              text not null,
  field_key                 text,
  option_value              text,
  action_domain             text not null default 'maintenance',
  title                     text not null,
  detail_label              text,
  cluster_key               text,
  cluster_name              text,
  criticality               text,
  status                    text not null default 'new',
  -- A decisão de análise (o que o usuário define); a situação é derivada dela
  -- e dos apontamentos.
  analysis_state            text not null default 'new',
  priority                  text not null default 'medium',
  priority_source           text not null default 'parameter',
  due_on                    date,
  due_source                text not null default 'sla',
  responsible_user_id       uuid references auth.users (id) on delete set null,
  responsible_assigned_at   timestamptz,
  requires_maintenance      boolean not null default true,
  requires_manual_analysis  boolean not null default false,
  first_occurrence_at       timestamptz not null,
  last_occurrence_at        timestamptz not null,
  first_operational_date    date not null,
  last_operational_date     date not null,
  occurrences               integer not null default 0,
  open_items                integer not null default 0,
  resolved_items            integer not null default 0,
  -- Contexto histórico do 1º apontamento (congelado do checklist, nunca a
  -- alocação de hoje). Cada apontamento guarda também o seu.
  first_execution_id        uuid references public.checklist_executions (id) on delete restrict,
  license_plate_snapshot    text,
  fleet_code_snapshot       text,
  vehicle_type_id           uuid,
  vehicle_subcategory_id    uuid,
  operation_id              uuid,
  state_id                  smallint,
  city_id                   integer,
  operation_br_id           uuid,
  organization_unit_id      uuid,
  leader_employee_id        uuid,
  -- Ciclos: o plano encerrado nunca é reaproveitado por uma nova ocorrência;
  -- nasce um novo ciclo ligado ao anterior.
  previous_plan_id          uuid references public.action_plans (id) on delete restrict,
  cycle_number              integer not null default 1,
  is_recurrence             boolean not null default false,
  reopened_count            integer not null default 0,
  last_treatment_at         timestamptz,
  last_treatment            text,
  closed_at                 timestamptz,
  closed_by                 uuid references auth.users (id) on delete set null,
  auto_closed               boolean not null default false,
  created_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id) on delete set null,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null,
  constraint action_plans_code_key unique (organization_id, code),
  constraint action_plans_org_id_key unique (organization_id, id),
  constraint action_plans_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint action_plans_domain_check check (action_domain = 'maintenance'),
  constraint action_plans_status_check check (status in (
    'new', 'in_analysis', 'awaiting_maintenance', 'maintenance_open', 'maintenance_scheduled',
    'maintenance_in_progress', 'pending_new_action', 'resolved_without_maintenance', 'improper',
    'resolved', 'cancelled')),
  constraint action_plans_analysis_check check (analysis_state in ('new', 'in_analysis', 'awaiting_maintenance')),
  constraint action_plans_priority_check check (priority in ('low', 'medium', 'high', 'critical')),
  constraint action_plans_priority_source_check check (priority_source in ('parameter', 'criticality', 'user')),
  constraint action_plans_due_source_check check (due_source in ('sla', 'user')),
  constraint action_plans_counts_check check (occurrences >= 0 and open_items >= 0 and resolved_items >= 0),
  constraint action_plans_closed_check check (
    (status in ('resolved_without_maintenance', 'improper', 'resolved', 'cancelled')) = (closed_at is not null))
);
-- Um único plano ABERTO por veículo + problema: é o que faz a recorrência
-- atualizar o plano em vez de criar outro.
create unique index if not exists action_plans_open_key
  on public.action_plans (organization_id, vehicle_id, plan_key)
  where status not in ('resolved_without_maintenance', 'improper', 'resolved', 'cancelled');
create index if not exists action_plans_status_idx on public.action_plans (organization_id, status, priority);
create index if not exists action_plans_due_idx on public.action_plans (organization_id, due_on)
  where status not in ('resolved_without_maintenance', 'improper', 'resolved', 'cancelled');
create index if not exists action_plans_vehicle_idx on public.action_plans (organization_id, vehicle_id, plan_key, closed_at);
create index if not exists action_plans_action_idx on public.action_plans (organization_id, action_key);
create index if not exists action_plans_cluster_idx on public.action_plans (organization_id, cluster_key);
create index if not exists action_plans_operation_idx on public.action_plans (organization_id, operation_id, first_operational_date);
create index if not exists action_plans_occurrence_idx on public.action_plans (organization_id, first_operational_date, last_operational_date);
create index if not exists action_plans_responsible_idx on public.action_plans (organization_id, responsible_user_id)
  where responsible_user_id is not null;
comment on table public.action_plans is
  'Plano de Ação de Manutenção: agrupamento gerencial de um problema do veículo (vehicle + plan_key). Situação derivada dos apontamentos; um aberto por veículo + problema; ciclos encerrados preservados.';

-- -----------------------------------------------------------------------------
-- 5. Apontamentos — uma ocorrência individual de inconformidade
-- -----------------------------------------------------------------------------
create table if not exists public.action_plan_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  plan_id                uuid not null,
  checklist_execution_id uuid not null references public.checklist_executions (id) on delete restrict,
  checklist_answer_id    uuid not null references public.checklist_execution_answers (id) on delete restrict,
  question_id            uuid not null,
  question_key           text not null,
  field_key              text,
  option_value           text,
  option_label           text,
  action_key             text not null,
  cluster_key            text,
  criticality            text,
  question_text_snapshot text not null,
  answer                 text not null,
  conditional_value      jsonb,
  detail_text            text,
  note                   text,
  checklist_type         text,
  operational_date       date not null,
  occurred_at            timestamptz not null,
  employee_id            uuid,
  user_id                uuid,
  vehicle_id             uuid not null,
  license_plate_snapshot text,
  operation_id           uuid,
  state_id               smallint,
  city_id                integer,
  operation_br_id        uuid,
  organization_unit_id   uuid,
  leader_employee_id     uuid,
  status                 text not null default 'pending',
  -- Quem decidiu a situação atual: o motor (a partir das manutenções) ou um
  -- usuário. Decisão de usuário nunca é recalculada pelo motor.
  status_source          text not null default 'system',
  resolved_at            timestamptz,
  resolved_by            uuid references auth.users (id) on delete set null,
  resolved_maintenance_id uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint action_plan_items_plan_fkey foreign key (organization_id, plan_id)
    references public.action_plans (organization_id, id) on delete restrict,
  constraint action_plan_items_status_check check (status in (
    'pending', 'in_maintenance', 'needs_action', 'resolved', 'resolved_without_maintenance', 'improper', 'cancelled')),
  constraint action_plan_items_source_check check (status_source in ('system', 'user', 'maintenance', 'correction')),
  constraint action_plan_items_answer_check check (answer in ('yes', 'no'))
);
-- Idempotência: uma resposta (e opção do detalhe) vira UM apontamento, por mais
-- que o checklist seja reprocessado.
create unique index if not exists action_plan_items_answer_key
  on public.action_plan_items (checklist_answer_id, coalesce(option_value, ''));
create index if not exists action_plan_items_plan_idx on public.action_plan_items (plan_id, status);
create index if not exists action_plan_items_execution_idx on public.action_plan_items (checklist_execution_id);
create index if not exists action_plan_items_org_date_idx on public.action_plan_items (organization_id, operational_date);
create index if not exists action_plan_items_employee_idx on public.action_plan_items (organization_id, employee_id);
comment on table public.action_plan_items is
  'Apontamento: uma resposta inconforme (e a opção marcada no detalhe) de um checklist, com o contexto histórico congelado. A resposta original do motorista nunca é alterada nem apagada.';

-- -----------------------------------------------------------------------------
-- 6. Resoluções — histórico das decisões por apontamento (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.action_plan_item_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  plan_id             uuid not null,
  item_id             uuid not null references public.action_plan_items (id) on delete restrict,
  resolution_type     text not null,
  from_status         text,
  to_status           text not null,
  maintenance_id      uuid,
  maintenance_link_id uuid,
  source              text not null default 'user',
  confidence          text,
  reason_code         text,
  reason              text,
  observation         text,
  resolved_by         uuid references auth.users (id) on delete set null,
  resolved_by_name    text,
  resolved_at         timestamptz not null default now(),
  constraint action_plan_item_resolutions_plan_fkey foreign key (organization_id, plan_id)
    references public.action_plans (organization_id, id) on delete restrict,
  constraint action_plan_item_resolutions_type_check check (resolution_type in (
    'resolved_by_maintenance', 'validated_by_maintenance', 'resolved_without_maintenance', 'improper',
    'cancelled', 'reopened', 'returned_to_pending', 'maintenance_status')),
  constraint action_plan_item_resolutions_source_check check (source in ('user', 'maintenance_auto', 'system', 'correction', 'import')),
  constraint action_plan_item_resolutions_confidence_check check (confidence is null or confidence in ('high', 'medium', 'manual_review'))
);
create index if not exists action_plan_item_resolutions_item_idx on public.action_plan_item_resolutions (item_id, resolved_at);
create index if not exists action_plan_item_resolutions_plan_idx on public.action_plan_item_resolutions (plan_id, resolved_at);
comment on table public.action_plan_item_resolutions is
  'Histórico append-only das decisões sobre cada apontamento (resolução por manutenção, validação, sem manutenção, improcedente, cancelamento, reabertura). Motivo, justificativa, fonte e responsável.';

-- -----------------------------------------------------------------------------
-- 7. Vínculo plano × manutenção (N:N) — a fonte oficial
-- -----------------------------------------------------------------------------
create table if not exists public.action_plan_maintenance_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  plan_id         uuid not null,
  maintenance_id  uuid not null,
  -- active = vínculo vigente; unlinked = desfeito (com motivo); discarded =
  -- candidato descartado na conciliação (não volta a ser sugerido).
  status          text not null default 'active',
  origin          text not null,
  confidence      text,
  rule            text,
  resolutive      boolean not null default true,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  linked_by       uuid references auth.users (id) on delete set null,
  linked_at       timestamptz not null default now(),
  unlinked_by     uuid references auth.users (id) on delete set null,
  unlinked_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint action_plan_maintenance_links_plan_fkey foreign key (organization_id, plan_id)
    references public.action_plans (organization_id, id) on delete restrict,
  constraint action_plan_maintenance_links_maintenance_fkey foreign key (organization_id, maintenance_id)
    references public.maintenances (organization_id, id) on delete restrict,
  constraint action_plan_maintenance_links_key unique (plan_id, maintenance_id),
  constraint action_plan_maintenance_links_status_check check (status in ('active', 'unlinked', 'discarded')),
  constraint action_plan_maintenance_links_origin_check check (origin in (
    'opened_from_plan', 'linked_manual', 'maintenance_module', 'auto_reconciliation', 'reconciliation_manual')),
  constraint action_plan_maintenance_links_confidence_check check (
    confidence is null or confidence in ('high', 'medium', 'manual_review'))
);
create index if not exists action_plan_maintenance_links_maintenance_idx
  on public.action_plan_maintenance_links (maintenance_id) where status = 'active';
comment on table public.action_plan_maintenance_links is
  'Plano × manutenção do módulo oficial (N:N). origin/confidence/rule registram como o vínculo nasceu (abertura pelo plano, vínculo manual, módulo Manutenção, conciliação automática ou manual). resolutive = a manutenção trata os apontamentos do plano.';

-- -----------------------------------------------------------------------------
-- 8. Eventos do plano (trilha append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.action_plan_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  plan_id         uuid not null,
  event_type      text not null,
  from_status     text,
  to_status       text,
  reason          text,
  payload         jsonb not null default '{}'::jsonb,
  source          text not null default 'user',
  actor_user_id   uuid references auth.users (id) on delete set null,
  actor_name      text,
  created_at      timestamptz not null default now(),
  constraint action_plan_events_plan_fkey foreign key (organization_id, plan_id)
    references public.action_plans (organization_id, id) on delete restrict,
  constraint action_plan_events_type_check check (event_type ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint action_plan_events_source_check check (source in ('user', 'system', 'checklist', 'maintenance', 'correction', 'import'))
);
create index if not exists action_plan_events_plan_idx on public.action_plan_events (plan_id, created_at);
create index if not exists action_plan_events_org_idx on public.action_plan_events (organization_id, created_at);
comment on table public.action_plan_events is
  'Trilha append-only do plano: criação, novas ocorrências, mudanças de situação, prioridade, prazo, responsável, vínculos, resoluções, reabertura e reprocessamentos. Autor real quando há usuário autenticado.';

-- -----------------------------------------------------------------------------
-- 9. Recebimento — o "offset" deste consumidor do evento do checklist
-- -----------------------------------------------------------------------------
-- O outbox tem um status por linha e a Aderência já marca o evento como
-- processado. Este registro é o controle próprio do Plano de Ação: um por
-- execução, com tentativas e erro — a rotina tenta de novo o que falhou e o
-- checklist do motorista nunca é recusado por causa deste módulo.
create table if not exists public.action_plan_ingestions (
  execution_id    uuid primary key references public.checklist_executions (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  status          text not null default 'pending',
  source          text not null default 'trigger',
  attempts        integer not null default 0,
  last_error      text,
  findings        integer not null default 0,
  maintenance_findings integer not null default 0,
  damage_findings integer not null default 0,
  not_eligible    integer not null default 0,
  items_created   integer not null default 0,
  plans_created   integer not null default 0,
  plans_updated   integer not null default 0,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint action_plan_ingestions_status_check check (status in ('pending', 'processed', 'failed')),
  constraint action_plan_ingestions_source_check check (source in ('trigger', 'cron', 'reprocess', 'correction', 'backfill'))
);
create index if not exists action_plan_ingestions_status_idx on public.action_plan_ingestions (organization_id, status, updated_at);
comment on table public.action_plan_ingestions is
  'Controle do recebimento de cada checklist pelo Plano de Ação (consumidor do evento checklist.execution.submitted): situação, tentativas, erro e contagens (inconformidades, de manutenção, de avaria, não elegíveis, apontamentos e planos).';

-- -----------------------------------------------------------------------------
-- 10. Gatilhos padrão (carimbo, tenant imutável, auditoria, append-only)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'checklist_action_parameters', 'action_plan_settings', 'action_plans', 'action_plan_items',
    'action_plan_maintenance_links', 'action_plan_ingestions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_stamps', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.tg_set_stamps()',
                   t || '_set_stamps', t);
  end loop;

  -- Auditoria genérica só onde a trilha própria não cobre (parâmetros,
  -- configurações e vínculos); plano e apontamento têm trilha própria.
  foreach t in array array['checklist_action_parameters', 'action_plan_settings', 'action_plan_maintenance_links']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.tg_audit()',
                   t || '_audit', t);
  end loop;

  foreach t in array array[
    'checklist_action_parameters', 'action_plans', 'action_plan_items', 'action_plan_maintenance_links', 'action_plan_ingestions']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_prevent_tenant_change', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.tg_prevent_tenant_change()',
                   t || '_prevent_tenant_change', t);
  end loop;

  foreach t in array array['action_plan_item_resolutions', 'action_plan_events']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.tg_block_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- Planos, apontamentos e vínculos nunca são apagados: encerram, cancelam ou
-- desvinculam, com motivo.
create or replace function private.tg_action_plan_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Registros do Plano de Ação não são excluídos: cancele ou desvincule, com justificativa.'
    using errcode = 'restrict_violation';
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['action_plans', 'action_plan_items', 'action_plan_maintenance_links']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.tg_action_plan_no_delete()',
                   t || '_no_delete', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 11. RLS — leitura por permissão e escopo; escrita só pelas RPCs
-- -----------------------------------------------------------------------------
alter table public.checklist_action_parameters    enable row level security;
alter table public.action_plan_settings           enable row level security;
alter table public.action_plans                   enable row level security;
alter table public.action_plan_items              enable row level security;
alter table public.action_plan_item_resolutions   enable row level security;
alter table public.action_plan_maintenance_links  enable row level security;
alter table public.action_plan_events             enable row level security;
alter table public.action_plan_ingestions         enable row level security;

drop policy if exists checklist_action_parameters_select on public.checklist_action_parameters;
create policy checklist_action_parameters_select on public.checklist_action_parameters
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('action_plans.view')));

drop policy if exists action_plan_settings_select on public.action_plan_settings;
create policy action_plan_settings_select on public.action_plan_settings
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('action_plans.view')));

-- O plano é lido pelo escopo do CONTEXTO em que o problema foi apontado (a
-- operação gravada do 1º apontamento), não pela alocação de hoje. Sem operação
-- no contexto, vale o escopo atual do veículo.
drop policy if exists action_plans_select on public.action_plans;
create policy action_plans_select on public.action_plans
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('action_plans.view'))
         and (operation_id in (select private.accessible_operation_ids())
              or (operation_id is null and private.vehicle_in_scope(organization_id, vehicle_id))));

do $$
declare
  t text;
begin
  foreach t in array array['action_plan_items', 'action_plan_item_resolutions', 'action_plan_maintenance_links', 'action_plan_events']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.action_plans p where p.id = plan_id))
    $p$, t || '_select', t);
  end loop;
end $$;

drop policy if exists action_plan_ingestions_select on public.action_plan_ingestions;
create policy action_plan_ingestions_select on public.action_plan_ingestions
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('action_plans.view_audit')));

-- O Supabase concede ALL (inclusive TRUNCATE, que a RLS não cobre) a anon e
-- authenticated em tabelas novas do schema public. Aqui só se lê.
do $$
declare
  t text;
begin
  foreach t in array array[
    'checklist_action_parameters', 'action_plan_settings', 'action_plans', 'action_plan_items',
    'action_plan_item_resolutions', 'action_plan_maintenance_links', 'action_plan_events', 'action_plan_ingestions']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 12. Seed — classificação do formulário atual (Check List de Frota v1.x)
-- -----------------------------------------------------------------------------
-- Por chave estável. A pergunta de avaria (funilaria.avaria) e o relato dela
-- (descricao_avaria) são DAMAGE. Todas as demais inconformidades são de
-- MANUTENÇÃO. Detalhes de seleção especializam o gatilho (um plano por opção);
-- relatos de texto são informativos. Prioridade inicial: pergunta crítica →
-- Alta; demais → Média (freios e pneus críticos → Crítica). O administrador
-- ajusta em Planos de Ação › Parâmetros.
insert into public.action_plan_settings (organization_id)
select o.id from public.organizations o where o.deleted_at is null
on conflict (organization_id) do nothing;

create temporary table tmp_action_titles (question_key text primary key, title text);
insert into tmp_action_titles values
  ('5s.limpeza_externa',                'Limpeza externa inadequada'),
  ('5s.limpeza_interna',                'Limpeza interna/cabine inadequada'),
  ('extintor.capacidade_8kg',           'Extintor de 8 kg ausente'),
  ('extintor.validade_pressao',         'Extintor vencido ou despressurizado'),
  ('implementos.camera_re',             'Câmera de ré com falha'),
  ('implementos.controle_auxiliar',     'Controle auxiliar (mão amiga) com falha'),
  ('implementos.plataforma_hidraulica', 'Plataforma hidráulica com falha'),
  ('implementos.prateleiras',           'Prateleiras em más condições'),
  ('implementos.sirene_re',             'Sirene de ré com falha'),
  ('implementos.tela_multimidia',       'Tela multimídia com falha'),
  ('luzes.farois',                      'Faróis com falha'),
  ('luzes.freio',                       'Luz de freio com falha'),
  ('luzes.re',                          'Luz de ré com falha'),
  ('luzes.setas',                       'Setas com falha'),
  ('mecanica.freio_estacionario',       'Freio estacionário com falha'),
  ('mecanica.freios_servico',           'Freios de serviço com falha'),
  ('mecanica.nivel_agua_radiador',      'Nível de água do radiador inadequado'),
  ('mecanica.nivel_arla',               'Nível de ARLA inadequado'),
  ('mecanica.nivel_oleo',               'Nível de óleo do motor inadequado'),
  ('mecanica.problema_mecanico',        'Problema mecânico relatado'),
  ('pneus.dianteiros',                  'Pneus dianteiros em más condições'),
  ('pneus.estepe',                      'Estepe ausente'),
  ('pneus.traseiros',                   'Pneus traseiros em más condições'),
  ('qualidade.embalagens',              'Embalagens inadequadas'),
  ('qualidade.inspecao_mercadoria',     'Mercadoria sem inspeção visual'),
  ('qualidade.verificacoes_previas',    'Verificações prévias não realizadas'),
  ('seguranca.alarme',                  'Alarme com falha'),
  ('seguranca.buzina',                  'Buzina com falha'),
  ('seguranca.carregador_celular',      'Carregador de celular com falha'),
  ('seguranca.chave_roda',              'Chave de roda ausente'),
  ('seguranca.cintos',                  'Travas dos cintos de segurança com falha'),
  ('seguranca.limpadores',              'Limpadores de para-brisa com falha'),
  ('seguranca.macaco',                  'Macaco hidráulico ausente');

do $seed$
declare
  o   record;
  q   record;
  c   record;
begin
  for o in
    select a.organization_id, a.id as app_id
      from public.operational_apps a
     where a.code = 'checklist_frota'
  loop
    -- A versão mais recente de cada chave de pergunta (texto e criticidade vigentes).
    for q in
      select distinct on (qq.question_key)
             qq.id, qq.question_key, qq.question_text, qq.criticality, qq.generates_action_plan,
             exists (select 1 from public.checklist_question_conditionals cc
                      where cc.question_id = qq.id and cc.field_type in ('single_select', 'multi_select')) as has_select
        from public.checklist_questions qq
        join public.checklist_app_versions v on v.id = qq.version_id
       where v.app_id = o.app_id
       order by qq.question_key, v.major desc, v.minor desc
    loop
      insert into public.checklist_action_parameters
        (organization_id, app_id, question_key, field_key, action_domain, question_role, generates_plan,
         action_title, default_priority, requires_maintenance, requires_manual_analysis, driver_visible, notes)
      values
        (o.organization_id, o.app_id, q.question_key, null,
         case when q.question_key = 'funilaria.avaria' then 'damage' else 'maintenance' end,
         case when q.has_select then 'trigger' else 'standalone' end,
         case when q.question_key = 'funilaria.avaria' then false else coalesce(q.generates_action_plan, true) end,
         (select t.title from tmp_action_titles t where t.question_key = q.question_key),
         case
           when q.question_key = 'funilaria.avaria' then null
           when q.question_key in ('mecanica.freios_servico', 'mecanica.freio_estacionario',
                                   'pneus.dianteiros', 'pneus.traseiros') then 'critical'
           when q.criticality = 'critica' then 'high'
           else 'medium'
         end,
         q.question_key not like '5s.%' and q.question_key not like 'qualidade.%',
         q.question_key like '5s.%' or q.question_key like 'qualidade.%',
         true,
         case when q.question_key = 'funilaria.avaria'
              then 'Domínio AVARIA: segue para o fluxo de Sinistros/Avarias; nunca gera Plano de Ação de Manutenção.' end)
      on conflict do nothing;

      for c in
        select cc.field_key, cc.field_type
          from public.checklist_question_conditionals cc
         where cc.question_id = q.id
      loop
        insert into public.checklist_action_parameters
          (organization_id, app_id, question_key, field_key, action_domain, question_role, generates_plan,
           plan_grouping, notes)
        values
          (o.organization_id, o.app_id, q.question_key, c.field_key,
           case when q.question_key = 'funilaria.avaria' then 'damage' else 'maintenance' end,
           case when c.field_type in ('single_select', 'multi_select') then 'detail' else 'description' end,
           false,
           'option',
           case when q.question_key = 'funilaria.avaria'
                then 'Relato da avaria: domínio AVARIA.' end)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;
end $seed$;

drop table if exists tmp_action_titles;
