-- =============================================================================
-- Etapa 16 — Gestão de Frota › Manutenção: fundação
--
-- O HFC (Lovable) foi usado só como referência funcional; nada daqui copia a
-- estrutura dele. As diferenças que motivam o desenho estão em
-- docs/modules/maintenance.md e docs/modules/hfc-maintenance-mapping.md. Em
-- resumo:
--
--   * Identidade por UUID e por FKs compostas com o tenant — nunca por placa,
--     nome de operação, de cidade, de líder ou texto de serviço. Os textos
--     existem como snapshot histórico, para exibição.
--   * Uma manutenção é uma entrada em oficina; os serviços são ITENS dela
--     (no HFC, cada serviço virava um registro independente).
--   * Situação com máquina de estados no banco; toda transição é um evento
--     numa trilha append-only. Reprogramar é um evento, não uma situação.
--   * Catálogo único: clusters técnicos e serviços são a mesma fonte para a
--     abertura, a preventiva, a preditiva e o vínculo com o Check List.
--   * KM vem do hodômetro oficial (vehicle_odometer_readings); a manutenção
--     guarda o KM que usou, a origem e o status da validação, sem nunca
--     reescrever a leitura oficial.
--   * Leitura por RLS (permissão + escopo de operação); escrita só por RPCs
--     SECURITY DEFINER, que conferem permissão e escopo de novo.
--
-- Esta migration cria tabelas, permissões, RLS e gatilhos. As regras (máquina
-- de estados, KM, preventiva, preditiva, indicadores e importação) estão nas
-- migrations seguintes da mesma data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões (Administração › Perfis & Permissões)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('maintenance.view',               'maintenance', 'Ver manutenção',                 'Acessa o módulo Manutenção.'),
  ('maintenance.view_dashboard',     'maintenance', 'Ver visão geral',                'Indicadores gerenciais da manutenção.'),
  ('maintenance.view_base',          'maintenance', 'Ver base geral',                 'Consulta a base de manutenções e o histórico por veículo.'),
  ('maintenance.create',             'maintenance', 'Abrir manutenção',               'Abre manutenção e complementa serviços de uma manutenção aberta.'),
  ('maintenance.schedule',           'maintenance', 'Agendar manutenção',             'Programa a entrada em oficina (Há agendar → Agendado).'),
  ('maintenance.reschedule',         'maintenance', 'Reprogramar manutenção',         'Altera data, horário, fornecedor ou previsão de uma programação, com motivo.'),
  ('maintenance.start',              'maintenance', 'Registrar entrada',              'Registra a entrada real em oficina (→ Em execução).'),
  ('maintenance.complete',           'maintenance', 'Concluir manutenção',            'Registra a saída e o resultado dos serviços (→ Concluído).'),
  ('maintenance.reopen',             'maintenance', 'Reabrir manutenção',             'Reabre manutenção concluída, cancelada ou não realizada, com justificativa.'),
  ('maintenance.edit',               'maintenance', 'Editar manutenção',              'Altera dados descritivos, cancela ou marca como não realizada.'),
  ('maintenance.manage_preventive',  'maintenance', 'Gerir preventiva',               'Gera manutenção a partir de ciclo preventivo e sincroniza ciclos.'),
  ('maintenance.manage_predictive',  'maintenance', 'Gerir preditiva',                'Planos técnicos, verificações e manutenção a partir do motor preditivo.'),
  ('maintenance.manage_services',    'maintenance', 'Gerir serviços',                 'Cadastro de serviços e vínculo com o Check List.'),
  ('maintenance.manage_clusters',    'maintenance', 'Gerir clusters técnicos',        'Cadastro de clusters técnicos.'),
  ('maintenance.manage_suppliers',   'maintenance', 'Gerir fornecedores',             'Cadastro de fornecedores de manutenção.'),
  ('maintenance.manage_parameters',  'maintenance', 'Gerir parâmetros',               'Parâmetros preventivos, origens e configurações do módulo.'),
  ('maintenance.import',             'maintenance', 'Importar manutenção',            'Importa a base de manutenções e cadastros.'),
  ('maintenance.export',             'maintenance', 'Exportar manutenção',            'Exporta a base de manutenções.'),
  ('maintenance.view_audit',         'maintenance', 'Ver trilha da manutenção',       'Consulta a trilha completa de eventos e alterações.'),
  ('maintenance.reprocess',          'maintenance', 'Reprocessar manutenção',         'Reprocessa KM, ciclos preventivos e preditivos.')
on conflict (code) do nothing;

-- Padrões por perfil oficial. Nada aqui concede acesso pelo nome do perfil: são
-- os padrões que Administração › Perfis & Permissões aplica e que o
-- administrador pode ajustar depois. Operacional e Gente não recebem nada.
insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('gestor_frota')) p(profile_code)
  cross join (select code from public.permissions where module = 'maintenance') c
on conflict do nothing;

insert into public.access_profile_defaults (profile_code, permission_code) values
  ('gestao',              'maintenance.view'),
  ('gestao',              'maintenance.view_dashboard'),
  ('gestao',              'maintenance.view_base'),
  ('gestao',              'maintenance.export'),
  ('gestao',              'maintenance.view_audit'),
  ('lideranca_operacoes', 'maintenance.view'),
  ('lideranca_operacoes', 'maintenance.view_dashboard'),
  ('lideranca_operacoes', 'maintenance.view_base'),
  ('lideranca_operacoes', 'maintenance.create'),
  ('seguranca',           'maintenance.view'),
  ('seguranca',           'maintenance.view_base')
on conflict do nothing;

-- O módulo existe no catálogo de módulos operacionais desde a Etapa 07.
update public.operational_modules set is_available = true where code = 'maintenance';

-- -----------------------------------------------------------------------------
-- 2. Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_today(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
            (select nullif(o.timezone, '') from public.organizations o where o.id = p_organization_id),
            'America/Sao_Paulo'))::date;
$$;
comment on function private.maintenance_today(uuid) is
  'O "hoje" da organização (fuso de organizations.timezone). Nunca o dia UTC — no HFC, depois das 21h em Brasília o "hoje" virava amanhã.';

-- -----------------------------------------------------------------------------
-- 3. Catálogos de referência
-- -----------------------------------------------------------------------------

-- 3.1 Tipos de manutenção — catálogo global, extensível por migration.
create table if not exists public.maintenance_types (
  code        text primary key,
  name        text not null,
  description text,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  constraint maintenance_types_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$')
);
comment on table public.maintenance_types is
  'Tipos de manutenção (Preventiva, Corretiva, Preditiva). Código estável; nunca texto livre no registro.';

insert into public.maintenance_types (code, name, description, sort_order) values
  ('preventive', 'Preventiva', 'Revisão programada por marco de KM (ciclos MP).',             1),
  ('corrective', 'Corretiva',  'Correção de falha ou inconformidade identificada.',          2),
  ('predictive', 'Preditiva',  'Intervenção indicada pelo plano técnico preditivo.',         3)
on conflict (code) do nothing;

-- 3.2 Origens — catálogo controlado. Linhas globais (organization_id nulo) são do
-- sistema; a organização pode acrescentar as suas.
create table if not exists public.maintenance_origins (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations (id) on delete restrict,
  code              text not null,
  name              text not null,
  description       text,
  is_system         boolean not null default false,
  -- Origem que o usuário pode escolher no assistente. As técnicas (preventiva
  -- programada, preditiva, plano de ação, importação) só são gravadas pelas
  -- rotinas que as produzem.
  manual_selectable boolean not null default true,
  is_active         boolean not null default true,
  sort_order        smallint not null default 100,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,
  constraint maintenance_origins_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint maintenance_origins_name_check check (length(btrim(name)) between 2 and 80)
);
create unique index if not exists maintenance_origins_code_key
  on public.maintenance_origins (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
comment on table public.maintenance_origins is
  'Origem da manutenção (Checklist, Relato do motorista, Socorro em rota, Preventiva programada…). Global = do sistema; com organization_id = acrescentada pela organização.';

insert into public.maintenance_origins (organization_id, code, name, description, is_system, manual_selectable, sort_order) values
  (null, 'operation',            'Operação',                'Abertura manual autorizada pelo time operacional.',            true, true,  10),
  (null, 'checklist',            'Checklist',               'Inconformidade do Check List de Frota.',                       true, true,  20),
  (null, 'action_plan',          'Plano de ação',           'Aberta a partir de um plano de ação do Check List.',           true, false, 30),
  (null, 'driver_report',        'Relato do motorista',     'Problema relatado pelo motorista.',                            true, true,  40),
  (null, 'roadside_assistance',  'Socorro em rota',         'Atendimento emergencial com o veículo em rota.',               true, true,  50),
  (null, 'risk_management',      'Gerenciamento de risco',  'Apontamento do gerenciamento de risco.',                       true, true,  60),
  (null, 'technical_inspection', 'Inspeção técnica',        'Inspeção técnica fora do plano preditivo.',                    true, true,  70),
  (null, 'technical_delivery',   'Entrega técnica',         'Preparação ou entrega técnica do veículo.',                    true, true,  80),
  (null, 'preventive_schedule',  'Preventiva programada',   'Gerada por um ciclo preventivo (MP).',                         true, false, 90),
  (null, 'predictive',           'Preditiva',               'Gerada pelo motor preditivo (ciclo e item técnico).',          true, false, 100),
  (null, 'import',               'Importação',              'Registro trazido por importação de base.',                     true, false, 110),
  (null, 'not_informed',         'Não informado',           'Origem ausente no registro importado.',                        true, false, 120)
on conflict do nothing;

-- 3.3 Clusters técnicos — sistemas/componentes (fonte única).
create table if not exists public.maintenance_clusters (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  code                text not null,
  name                text not null,
  description         text,
  default_criticality text not null default 'medium',
  status              text not null default 'active',
  sort_order          smallint not null default 100,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  deleted_at          timestamptz,
  deleted_by          uuid references auth.users (id) on delete set null,
  constraint maintenance_clusters_org_id_key unique (organization_id, id),
  constraint maintenance_clusters_code_check check (code ~ '^[A-Z0-9][A-Z0-9_]{1,39}$'),
  constraint maintenance_clusters_name_check check (length(btrim(name)) between 2 and 80),
  constraint maintenance_clusters_criticality_check check (default_criticality in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_clusters_status_check check (status in ('active', 'inactive')),
  constraint maintenance_clusters_description_check check (description is null or length(description) <= 500)
);
create unique index if not exists maintenance_clusters_code_key
  on public.maintenance_clusters (organization_id, code) where deleted_at is null;
create unique index if not exists maintenance_clusters_name_key
  on public.maintenance_clusters (organization_id, private.normalize_label(name)) where deleted_at is null;
comment on table public.maintenance_clusters is
  'Clusters técnicos (sistemas/componentes). Fonte única para abertura, preventiva, preditiva e vínculo com o Check List. O código é o identificador técnico estável; o nome pode mudar sem quebrar vínculos.';

-- 3.4 Serviços.
create table if not exists public.maintenance_services (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  cluster_id             uuid not null,
  name                   text not null,
  description            text,
  criticality            text not null default 'medium',
  -- Vazio = aplica a todos. Cada elemento é validado pela rotina de cadastro
  -- (códigos de maintenance_types e ids de vehicle_types).
  maintenance_type_codes text[] not null default '{}',
  vehicle_type_ids       uuid[] not null default '{}',
  expected_hours         numeric(8, 2),
  is_predictive          boolean not null default false,
  status                 text not null default 'active',
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  deleted_at             timestamptz,
  deleted_by             uuid references auth.users (id) on delete set null,
  constraint maintenance_services_org_id_key unique (organization_id, id),
  constraint maintenance_services_cluster_fkey foreign key (organization_id, cluster_id)
    references public.maintenance_clusters (organization_id, id) on delete restrict,
  constraint maintenance_services_name_check check (length(btrim(name)) between 2 and 120),
  constraint maintenance_services_criticality_check check (criticality in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_services_status_check check (status in ('active', 'inactive')),
  constraint maintenance_services_hours_check check (expected_hours is null or (expected_hours > 0 and expected_hours <= 2000)),
  constraint maintenance_services_description_check check (description is null or length(description) <= 1000)
);
create unique index if not exists maintenance_services_name_key
  on public.maintenance_services (organization_id, cluster_id, private.normalize_label(name)) where deleted_at is null;
create index if not exists maintenance_services_cluster_idx
  on public.maintenance_services (organization_id, cluster_id) where deleted_at is null;
comment on table public.maintenance_services is
  'Serviços de manutenção. Todo serviço pertence a um cluster técnico (FK obrigatória) — não há serviço ativo sem cluster.';

-- 3.5 Fornecedores.
create table if not exists public.maintenance_suppliers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  name             text not null,
  trade_name       text,
  document_number  text,
  address          text,
  state_id         smallint references public.states (id),
  city_id          integer references public.cities (id),
  cluster_ids      uuid[] not null default '{}',
  service_ids      uuid[] not null default '{}',
  served_city_ids  integer[] not null default '{}',
  status           text not null default 'active',
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  deleted_by       uuid references auth.users (id) on delete set null,
  constraint maintenance_suppliers_org_id_key unique (organization_id, id),
  constraint maintenance_suppliers_name_check check (length(btrim(name)) between 2 and 160),
  constraint maintenance_suppliers_status_check check (status in ('active', 'inactive')),
  constraint maintenance_suppliers_document_check check (document_number is null or document_number ~ '^[0-9]{11}$|^[0-9]{14}$'),
  constraint maintenance_suppliers_notes_check check (notes is null or length(notes) <= 2000),
  constraint maintenance_suppliers_address_check check (address is null or length(address) <= 300)
);
create unique index if not exists maintenance_suppliers_name_key
  on public.maintenance_suppliers (organization_id, private.normalize_label(name)) where deleted_at is null;
create unique index if not exists maintenance_suppliers_document_key
  on public.maintenance_suppliers (organization_id, document_number) where deleted_at is null and document_number is not null;
comment on table public.maintenance_suppliers is
  'Fornecedores (oficinas e parceiros). Categorias atendidas = clusters (ids), serviços atendidos = serviços (ids), locais atendidos = municípios IBGE. Sem custos nesta etapa.';

-- 3.6 Serviços × Check List — o mapeamento oficial. É a MESMA relação que o
-- módulo Planos de Ação usará: não existe um segundo mapeamento.
create table if not exists public.maintenance_checklist_service_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id          uuid not null references public.operational_apps (id) on delete restrict,
  question_key    text not null,
  field_key       text,
  -- Chave de ação estável: a pergunta (e o campo condicional) pela chave, não
  -- pelo id da versão — o id muda a cada versão publicada do Check List.
  action_key      text generated always as ('q:' || question_key || coalesce(':' || field_key, '')) stored,
  service_id      uuid not null,
  auto_resolve    boolean not null default true,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  constraint maintenance_checklist_links_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete cascade,
  constraint maintenance_checklist_links_key unique (organization_id, app_id, question_key, field_key, service_id),
  constraint maintenance_checklist_links_question_check check (question_key ~ '^[a-z0-9_.-]{1,80}$'),
  constraint maintenance_checklist_links_field_check check (field_key is null or field_key ~ '^[a-z0-9_.-]{1,80}$')
);
create unique index if not exists maintenance_checklist_links_nullfield_key
  on public.maintenance_checklist_service_links (organization_id, app_id, question_key, service_id) where field_key is null;
create index if not exists maintenance_checklist_links_action_idx
  on public.maintenance_checklist_service_links (organization_id, action_key) where is_active;
comment on table public.maintenance_checklist_service_links is
  'Pergunta do Check List (e campo condicional) → serviço de manutenção. auto_resolve = a conclusão desse serviço resolve o apontamento vinculado. Fonte única para Manutenção e Planos de Ação.';

-- 3.7 Configurações do módulo por organização.
create table if not exists public.maintenance_settings (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  aging_buckets            integer[] not null default '{2,5,10,20}',
  recurrence_window_days   integer not null default 30,
  km_compatible_days       integer not null default 3,
  km_estimated_max_days    integer not null default 30,
  default_sla_hours        numeric(8, 2) not null default 72,
  schedule_overdue_days    integer not null default 5,
  predictive_forecast_km   integer not null default 5000,
  predictive_forecast_days integer not null default 30,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id) on delete set null,
  constraint maintenance_settings_aging_check check (cardinality(aging_buckets) between 1 and 8),
  constraint maintenance_settings_recurrence_check check (recurrence_window_days between 1 and 365),
  constraint maintenance_settings_km_days_check check (km_compatible_days between 0 and 30 and km_estimated_max_days between 1 and 365),
  constraint maintenance_settings_sla_check check (default_sla_hours > 0 and default_sla_hours <= 2000),
  constraint maintenance_settings_overdue_check check (schedule_overdue_days between 1 and 90),
  constraint maintenance_settings_forecast_check check (predictive_forecast_km between 100 and 100000 and predictive_forecast_days between 1 and 365)
);
comment on table public.maintenance_settings is
  'Parâmetros do módulo por organização: faixas de aging (limites superiores, em dias), janela de reincidência, janelas de validação de KM, SLA padrão, prazo para "há agendar" virar vencida e horizonte de previsão preditiva.';

-- -----------------------------------------------------------------------------
-- 4. Preventiva — parâmetros e ciclos
-- -----------------------------------------------------------------------------
create table if not exists public.maintenance_preventive_rules (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id        uuid not null references public.vehicle_types (id) on delete restrict,
  vehicle_subcategory_id uuid,
  vehicle_model_id       uuid references public.vehicle_models (id) on delete restrict,
  service_id             uuid,
  interval_km            integer not null,
  initial_km             integer not null default 0,
  cycle_count            smallint not null default 20,
  alert_before_pct       numeric(5, 2) not null default 5,
  tolerance_after_pct    numeric(5, 2) not null default 5,
  criticality            text not null default 'medium',
  status                 text not null default 'active',
  notes                  text,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  deleted_at             timestamptz,
  deleted_by             uuid references auth.users (id) on delete set null,
  constraint maintenance_preventive_rules_org_id_key unique (organization_id, id),
  constraint maintenance_preventive_rules_subcategory_fkey foreign key (vehicle_subcategory_id, vehicle_type_id)
    references public.vehicle_subcategories (id, vehicle_type_id) on delete restrict,
  constraint maintenance_preventive_rules_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete restrict,
  constraint maintenance_preventive_rules_interval_check check (interval_km between 100 and 1000000),
  constraint maintenance_preventive_rules_initial_check check (initial_km between 0 and 9999999),
  constraint maintenance_preventive_rules_cycles_check check (cycle_count between 1 and 500),
  constraint maintenance_preventive_rules_alert_check check (alert_before_pct between 0 and 100),
  constraint maintenance_preventive_rules_tolerance_check check (tolerance_after_pct between 0 and 100),
  constraint maintenance_preventive_rules_criticality_check check (criticality in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_preventive_rules_status_check check (status in ('active', 'inactive'))
);
create unique index if not exists maintenance_preventive_rules_scope_key
  on public.maintenance_preventive_rules (
    organization_id, vehicle_type_id,
    coalesce(vehicle_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(vehicle_model_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;
comment on table public.maintenance_preventive_rules is
  'Parâmetros preventivos por tipo de equipamento (id oficial), opcionalmente por subcategoria e modelo. A regra mais específica ativa vence. Marcos: initial_km + n × interval_km, n = 1..cycle_count.';

create table if not exists public.maintenance_preventive_cycles (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  vehicle_id               uuid not null,
  rule_id                  uuid not null,
  cycle_number             smallint not null,
  milestone_km             integer not null,
  interval_km              integer not null,
  alert_before_pct         numeric(5, 2) not null,
  tolerance_after_pct      numeric(5, 2) not null,
  completed_maintenance_id uuid,
  completed_on             date,
  completed_km             integer,
  completion_source        text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint maintenance_preventive_cycles_org_id_key unique (organization_id, id),
  constraint maintenance_preventive_cycles_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_preventive_cycles_rule_fkey foreign key (organization_id, rule_id)
    references public.maintenance_preventive_rules (organization_id, id) on delete restrict,
  constraint maintenance_preventive_cycles_number_key unique (vehicle_id, cycle_number),
  constraint maintenance_preventive_cycles_number_check check (cycle_number between 1 and 500),
  constraint maintenance_preventive_cycles_milestone_check check (milestone_km between 1 and 99999999),
  constraint maintenance_preventive_cycles_source_check check (completion_source is null or completion_source in ('maintenance', 'import', 'manual')),
  constraint maintenance_preventive_cycles_completion_check check (
    (completed_on is null and completed_km is null and completed_maintenance_id is null and completion_source is null)
    or (completed_on is not null and completion_source is not null))
);
create index if not exists maintenance_preventive_cycles_vehicle_idx
  on public.maintenance_preventive_cycles (organization_id, vehicle_id, cycle_number);
comment on table public.maintenance_preventive_cycles is
  'Ciclos MP1..MPn por veículo. Guardam o marco e as bandas da regra vigente quando foram gerados e a execução que os realizou. A situação (Não atingida, A programar, Vencida, Crítica, Realizada) NÃO é gravada: é calculada por private.maintenance_preventive_status com o KM oficial do momento — nunca fica velha.';

-- -----------------------------------------------------------------------------
-- 5. Preditiva — planos técnicos, itens, versões, cobertura, ciclos, verificações
-- -----------------------------------------------------------------------------
create table if not exists public.maintenance_predictive_plans (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  code                   text not null,
  name                   text not null,
  description            text,
  vehicle_type_id        uuid not null references public.vehicle_types (id) on delete restrict,
  vehicle_subcategory_id uuid,
  vehicle_make_id        uuid references public.vehicle_makes (id) on delete restrict,
  vehicle_model_id       uuid references public.vehicle_models (id) on delete restrict,
  year_from              smallint,
  year_to                smallint,
  source                 text not null default 'internal',
  reference_document     text,
  oem_reference          text,
  version                integer not null default 1,
  approval_status        text not null default 'draft',
  approved_at            timestamptz,
  approved_by            uuid references auth.users (id) on delete set null,
  is_active              boolean not null default true,
  notes                  text,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  deleted_at             timestamptz,
  deleted_by             uuid references auth.users (id) on delete set null,
  constraint maintenance_predictive_plans_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_plans_subcategory_fkey foreign key (vehicle_subcategory_id, vehicle_type_id)
    references public.vehicle_subcategories (id, vehicle_type_id) on delete restrict,
  constraint maintenance_predictive_plans_name_check check (length(btrim(name)) between 2 and 160),
  constraint maintenance_predictive_plans_source_check check (source in ('oem', 'internal', 'history', 'other')),
  constraint maintenance_predictive_plans_status_check check (approval_status in ('draft', 'in_review', 'approved', 'archived')),
  constraint maintenance_predictive_plans_years_check check (
    (year_from is null or year_from between 1950 and 2100) and (year_to is null or year_to between 1950 and 2100)
    and (year_from is null or year_to is null or year_from <= year_to)),
  constraint maintenance_predictive_plans_version_check check (version >= 1)
);
create unique index if not exists maintenance_predictive_plans_code_key
  on public.maintenance_predictive_plans (organization_id, code) where deleted_at is null;
comment on table public.maintenance_predictive_plans is
  'Plano técnico preditivo por tipo/subcategoria/marca/modelo/faixa de ano. Só planos aprovados e ativos alimentam o motor. Toda aprovação e toda alteração sensível num plano aprovado gera nova versão (maintenance_predictive_plan_versions).';

create table if not exists public.maintenance_predictive_plan_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  plan_id               uuid not null,
  cluster_id            uuid not null,
  service_id            uuid,
  name                  text not null,
  technical_description text,
  interval_km           integer,
  interval_days         integer,
  interval_engine_hours integer,
  alert_pct             numeric(5, 2) not null default 20,
  schedule_pct          numeric(5, 2) not null default 10,
  tolerance_pct         numeric(5, 2) not null default 10,
  criticality           text not null default 'medium',
  sort_order            smallint not null default 100,
  is_active             boolean not null default true,
  checklist             jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id) on delete set null,
  constraint maintenance_predictive_items_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_items_plan_fkey foreign key (organization_id, plan_id)
    references public.maintenance_predictive_plans (organization_id, id) on delete cascade,
  constraint maintenance_predictive_items_cluster_fkey foreign key (organization_id, cluster_id)
    references public.maintenance_clusters (organization_id, id) on delete restrict,
  constraint maintenance_predictive_items_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete restrict,
  constraint maintenance_predictive_items_name_check check (length(btrim(name)) between 2 and 160),
  constraint maintenance_predictive_items_interval_check check (
    (interval_km is not null or interval_days is not null)
    and (interval_km is null or interval_km between 100 and 1000000)
    and (interval_days is null or interval_days between 1 and 3650)
    and (interval_engine_hours is null or interval_engine_hours between 1 and 100000)),
  -- As bandas são frações do intervalo: próximo (alerta) ≥ programar ≥ 0; a
  -- tolerância conta depois do marco.
  constraint maintenance_predictive_items_bands_check check (
    alert_pct between 0 and 100 and schedule_pct between 0 and 100 and tolerance_pct between 0 and 100
    and schedule_pct <= alert_pct),
  constraint maintenance_predictive_items_criticality_check check (criticality in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_predictive_items_checklist_check check (jsonb_typeof(checklist) = 'array')
);
create index if not exists maintenance_predictive_items_plan_idx
  on public.maintenance_predictive_plan_items (organization_id, plan_id, sort_order);
comment on table public.maintenance_predictive_plan_items is
  'Itens do plano técnico: cluster, inspeção, intervalos (KM e/ou dias; horas de motor registradas para uso futuro), bandas (alerta = PRÓXIMO, programação = A PROGRAMAR, tolerância depois do marco = VENCIDO; além dela, CRÍTICO) e o roteiro técnico da verificação.';

create table if not exists public.maintenance_predictive_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  plan_id         uuid not null,
  version         integer not null,
  approval_status text not null,
  snapshot        jsonb not null,
  reason          text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  constraint maintenance_predictive_versions_plan_fkey foreign key (organization_id, plan_id)
    references public.maintenance_predictive_plans (organization_id, id) on delete restrict,
  constraint maintenance_predictive_versions_key unique (plan_id, version)
);
comment on table public.maintenance_predictive_plan_versions is
  'Histórico de versões do plano técnico: fotografia completa (cabeçalho + itens) de cada versão publicada. Append-only.';

create table if not exists public.maintenance_predictive_coverage (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  plan_item_id    uuid not null,
  service_id      uuid not null,
  coverage        text not null default 'full',
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  constraint maintenance_predictive_coverage_item_fkey foreign key (organization_id, plan_item_id)
    references public.maintenance_predictive_plan_items (organization_id, id) on delete cascade,
  constraint maintenance_predictive_coverage_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete cascade,
  constraint maintenance_predictive_coverage_key unique (plan_item_id, service_id),
  constraint maintenance_predictive_coverage_check check (coverage in ('full', 'partial'))
);
comment on table public.maintenance_predictive_coverage is
  'Cobertura técnica: a conclusão de um serviço com cobertura total reinicia o ciclo preditivo do item (referência = manutenção).';

create table if not exists public.maintenance_predictive_cycles (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id) on delete restrict,
  vehicle_id                  uuid not null,
  plan_id                     uuid not null,
  plan_item_id                uuid not null,
  plan_version                integer not null,
  reference_type              text not null default 'none',
  reference_date              date,
  reference_km                integer,
  reference_maintenance_id    uuid,
  reference_verification_id   uuid,
  monitoring_active           boolean not null default false,
  monitoring_km               integer,
  monitoring_days             integer,
  last_verification_id        uuid,
  last_result                 text,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint maintenance_predictive_cycles_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_cycles_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_cycles_plan_fkey foreign key (organization_id, plan_id)
    references public.maintenance_predictive_plans (organization_id, id) on delete restrict,
  constraint maintenance_predictive_cycles_item_fkey foreign key (organization_id, plan_item_id)
    references public.maintenance_predictive_plan_items (organization_id, id) on delete restrict,
  constraint maintenance_predictive_cycles_key unique (vehicle_id, plan_item_id),
  constraint maintenance_predictive_cycles_reference_check check (
    reference_type in ('verification', 'maintenance', 'manual_reset', 'history', 'none')
    and ((reference_type = 'none') = (reference_date is null))),
  constraint maintenance_predictive_cycles_result_check check (
    last_result is null or last_result in ('conforming', 'monitor', 'non_conforming', 'not_performed')),
  constraint maintenance_predictive_cycles_monitoring_check check (
    not monitoring_active or monitoring_km is not null or monitoring_days is not null)
);
create index if not exists maintenance_predictive_cycles_vehicle_idx
  on public.maintenance_predictive_cycles (organization_id, vehicle_id) where is_active;
comment on table public.maintenance_predictive_cycles is
  'Ciclo preditivo por veículo × item do plano. Guarda a referência técnica (última verificação conforme, manutenção com cobertura, baixa manual ou histórico) e o monitoramento ativo. O status técnico é calculado na leitura, com o KM oficial.';

create table if not exists public.maintenance_predictive_verifications (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  vehicle_id            uuid not null,
  cycle_id              uuid not null,
  plan_item_id          uuid not null,
  result                text not null,
  decision              text not null,
  verified_on           date not null,
  km                    integer,
  km_source             text,
  responsible_employee_id uuid,
  responsible_name      text not null,
  checklist             jsonb not null default '[]'::jsonb,
  notes                 text,
  monitor_km            integer,
  monitor_days          integer,
  maintenance_id        uuid,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  constraint maintenance_predictive_verifications_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_verifications_cycle_fkey foreign key (organization_id, cycle_id)
    references public.maintenance_predictive_cycles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_verifications_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_verifications_employee_fkey foreign key (organization_id, responsible_employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint maintenance_predictive_verifications_result_check check (
    result in ('conforming', 'monitor', 'non_conforming', 'not_performed')),
  constraint maintenance_predictive_verifications_decision_check check (
    decision in ('restart_cycle', 'continue_monitoring', 'reduce_interval', 'open_maintenance', 'close_monitoring', 'none')),
  constraint maintenance_predictive_verifications_km_check check (km is null or km between 0 and 9999999),
  constraint maintenance_predictive_verifications_monitor_check check (
    (monitor_km is null or monitor_km between 1 and 1000000) and (monitor_days is null or monitor_days between 1 and 3650)),
  constraint maintenance_predictive_verifications_notes_check check (notes is null or length(notes) <= 2000),
  constraint maintenance_predictive_verifications_name_check check (length(btrim(responsible_name)) between 2 and 160)
);
create index if not exists maintenance_predictive_verifications_cycle_idx
  on public.maintenance_predictive_verifications (organization_id, cycle_id, verified_on desc);
comment on table public.maintenance_predictive_verifications is
  'Verificações preditivas formais (append-only): resultado (conforme, monitorar, não conforme, não realizada), decisão rastreável (reiniciar, continuar/reduzir monitoramento, abrir manutenção, encerrar monitoramento), responsável, KM, roteiro respondido.';

-- -----------------------------------------------------------------------------
-- 6. A manutenção
-- -----------------------------------------------------------------------------
create table if not exists public.maintenances (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete restrict,
  code                       text not null,

  -- Veículo (id oficial) + fotografia do cadastro no momento da abertura.
  vehicle_id                 uuid not null,
  license_plate_snapshot     text not null,
  fleet_code_snapshot        text,
  vehicle_type_id            uuid not null references public.vehicle_types (id) on delete restrict,
  vehicle_subcategory_id     uuid references public.vehicle_subcategories (id) on delete restrict,
  vehicle_model_id           uuid references public.vehicle_models (id) on delete restrict,

  maintenance_type_code      text not null references public.maintenance_types (code) on delete restrict,
  origin_id                  uuid not null references public.maintenance_origins (id) on delete restrict,
  priority                   text not null default 'medium',
  status                     text not null default 'to_schedule',

  -- Contexto operacional histórico: resolvido pelas fontes oficiais
  -- (Fidelização → alocação; Lideranças) na data de referência e congelado.
  -- Uma substituição posterior do veículo não reclassifica esta manutenção.
  context_date               date not null,
  context_source             text not null default 'none',
  operation_id               uuid,
  operation_city_id          uuid,
  state_id                   smallint references public.states (id),
  city_id                    integer references public.cities (id),
  operation_br_id            uuid,
  fidelization_assignment_id uuid,
  organization_unit_id       uuid,
  leader_employee_id         uuid,
  leadership_assignment_id   uuid,
  operation_name_snapshot    text,
  city_name_snapshot         text,
  state_uf_snapshot          text,
  br_code_snapshot           text,
  unit_name_snapshot         text,
  leader_name_snapshot       text,

  -- Datas. Solicitação ≠ agendamento ≠ entrada real ≠ saída real.
  requested_on               date not null,
  requested_at               timestamptz not null default now(),
  scheduled_date             date,
  scheduled_time             time,
  expected_exit_date         date,
  expected_exit_time         time,
  entry_date                 date,
  entry_time                 time,
  exit_date                  date,
  exit_time                  time,
  -- TMM: da entrada real à saída real. Com os dois horários, em horas exatas;
  -- sem algum horário, em dias de calendário (× 24). duration_precision diz
  -- qual das duas regras produziu o número.
  duration_hours             numeric(10, 2) generated always as (
    case
      when entry_date is null or exit_date is null then null
      when entry_time is not null and exit_time is not null then
        round((extract(epoch from ((exit_date + exit_time) - (entry_date + entry_time))) / 3600.0)::numeric, 2)
      else ((exit_date - entry_date) * 24)::numeric
    end) stored,
  duration_precision         text generated always as (
    case
      when entry_date is null or exit_date is null then null
      when entry_time is not null and exit_time is not null then 'exact'
      else 'date'
    end) stored,

  supplier_id                uuid,
  service_order_number       text,

  -- KM. current_km_* = KM oficial do veículo quando a manutenção foi aberta;
  -- entry_km_* = KM de entrada usado pela manutenção e como foi obtido.
  current_km_snapshot        integer,
  current_km_date            date,
  entry_km                   integer,
  entry_km_status            text,
  entry_km_source            text,
  entry_km_reference_date    date,
  entry_km_reading_id        uuid references public.vehicle_odometer_readings (id) on delete restrict,
  entry_km_official          integer,
  entry_km_difference        integer,
  entry_km_justification     text,
  entry_km_informed_by       uuid references auth.users (id) on delete set null,
  entry_km_informed_at       timestamptz,

  -- Vínculos técnicos de origem.
  preventive_cycle_id        uuid,
  predictive_cycle_id        uuid,
  predictive_plan_item_id    uuid,
  predictive_verification_id uuid,
  checklist_execution_id     uuid references public.checklist_executions (id) on delete restrict,

  description                text,
  scheduling_notes           text,
  completion_notes           text,
  notes                      text,
  duplicate_justification    text,

  import_batch_id            uuid,
  import_key                 text,
  imported_at                timestamptz,
  reopen_count               smallint not null default 0,

  created_at                 timestamptz not null default now(),
  created_by                 uuid references auth.users (id) on delete set null,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users (id) on delete set null,

  constraint maintenances_org_id_key unique (organization_id, id),
  constraint maintenances_code_key unique (organization_id, code),
  constraint maintenances_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenances_operation_fkey foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,
  constraint maintenances_br_fkey foreign key (organization_id, operation_br_id)
    references public.operation_brs (organization_id, id) on delete restrict,
  constraint maintenances_fidelization_fkey foreign key (organization_id, fidelization_assignment_id)
    references public.fidelization_assignments (organization_id, id) on delete restrict,
  constraint maintenances_unit_fkey foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict,
  constraint maintenances_leader_fkey foreign key (organization_id, leader_employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint maintenances_supplier_fkey foreign key (organization_id, supplier_id)
    references public.maintenance_suppliers (organization_id, id) on delete restrict,
  constraint maintenances_preventive_cycle_fkey foreign key (organization_id, preventive_cycle_id)
    references public.maintenance_preventive_cycles (organization_id, id) on delete restrict,
  constraint maintenances_predictive_cycle_fkey foreign key (organization_id, predictive_cycle_id)
    references public.maintenance_predictive_cycles (organization_id, id) on delete restrict,
  constraint maintenances_predictive_item_fkey foreign key (organization_id, predictive_plan_item_id)
    references public.maintenance_predictive_plan_items (organization_id, id) on delete restrict,
  constraint maintenances_predictive_verification_fkey foreign key (organization_id, predictive_verification_id)
    references public.maintenance_predictive_verifications (organization_id, id) on delete restrict,
  constraint maintenances_import_batch_fkey foreign key (organization_id, import_batch_id)
    references public.import_batches (organization_id, id) on delete set null (import_batch_id),

  constraint maintenances_code_check check (code ~ '^MAN-[0-9]{4}-[0-9]{6,}$'),
  constraint maintenances_status_check check (
    status in ('to_schedule', 'scheduled', 'in_progress', 'completed', 'cancelled', 'not_performed')),
  constraint maintenances_priority_check check (priority in ('low', 'medium', 'high', 'critical')),
  constraint maintenances_context_source_check check (context_source in ('fidelization', 'allocation', 'none')),
  -- A situação exige os fatos que a definem — também para a importação.
  constraint maintenances_status_facts_check check (
    (status <> 'scheduled' or scheduled_date is not null)
    and (status not in ('in_progress', 'completed') or entry_date is not null)
    and (status <> 'completed' or exit_date is not null)),
  constraint maintenances_dates_check check (
    (exit_date is null or entry_date is not null)
    and (exit_date is null or exit_date > entry_date
         or (exit_date = entry_date and (exit_time is null or entry_time is null or exit_time >= entry_time)))
    and (expected_exit_date is null or scheduled_date is null or expected_exit_date >= scheduled_date)),
  constraint maintenances_km_check check (
    (entry_km is null or entry_km between 0 and 9999999)
    and (current_km_snapshot is null or current_km_snapshot between 0 and 9999999)),
  constraint maintenances_km_status_check check (
    entry_km_status is null or entry_km_status in (
      'validated', 'compatible', 'estimated', 'manual', 'divergent', 'not_found', 'pending_future', 'to_review')),
  constraint maintenances_km_source_check check (
    entry_km_source is null or entry_km_source in ('official_reading', 'interpolated', 'manual', 'import')),
  constraint maintenances_km_manual_check check (
    entry_km_source is distinct from 'manual'
    or (entry_km is not null and length(btrim(coalesce(entry_km_justification, ''))) >= 5)),
  constraint maintenances_os_check check (service_order_number is null or length(service_order_number) <= 60),
  constraint maintenances_texts_check check (
    (description is null or length(description) <= 2000)
    and (scheduling_notes is null or length(scheduling_notes) <= 2000)
    and (completion_notes is null or length(completion_notes) <= 2000)
    and (notes is null or length(notes) <= 4000)
    and (duplicate_justification is null or length(duplicate_justification) <= 1000))
);

-- Uma manutenção aberta por ciclo: a geração pela preventiva e pela preditiva
-- é idempotente no próprio banco, não só na tela.
create unique index if not exists maintenances_open_preventive_cycle_key
  on public.maintenances (preventive_cycle_id)
  where preventive_cycle_id is not null and status in ('to_schedule', 'scheduled', 'in_progress');
create unique index if not exists maintenances_open_predictive_cycle_key
  on public.maintenances (predictive_cycle_id)
  where predictive_cycle_id is not null and status in ('to_schedule', 'scheduled', 'in_progress');
create unique index if not exists maintenances_import_key
  on public.maintenances (organization_id, import_key) where import_key is not null;

create index if not exists maintenances_vehicle_idx
  on public.maintenances (organization_id, vehicle_id, requested_on desc);
create index if not exists maintenances_status_idx
  on public.maintenances (organization_id, status);
create index if not exists maintenances_open_idx
  on public.maintenances (organization_id, status, scheduled_date)
  where status in ('to_schedule', 'scheduled', 'in_progress');
create index if not exists maintenances_reference_date_idx
  on public.maintenances (organization_id, (coalesce(entry_date, scheduled_date, requested_on)));
create index if not exists maintenances_operation_idx
  on public.maintenances (organization_id, operation_id);
create index if not exists maintenances_supplier_idx
  on public.maintenances (organization_id, supplier_id) where supplier_id is not null;
create index if not exists maintenances_plate_search_idx
  on public.maintenances using gin (license_plate_snapshot extensions.gin_trgm_ops);

comment on table public.maintenances is
  'A manutenção: uma entrada em oficina de um veículo, com seus itens de serviço. Identidade = id (UUID) e code (MAN-AAAA-NNNNNN). Situação: to_schedule (Há agendar) → scheduled (Agendado) → in_progress (Em execução) → completed (Concluído); cancelled e not_performed encerram sem execução. Só muda por RPC, e cada mudança é um evento em maintenance_events.';

create table if not exists public.maintenance_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  maintenance_id         uuid not null,
  service_id             uuid not null,
  cluster_id             uuid not null,
  service_name_snapshot  text not null,
  cluster_name_snapshot  text not null,
  criticality            text not null default 'medium',
  status                 text not null default 'pending',
  result                 text,
  notes                  text,
  sort_order             smallint not null default 100,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  constraint maintenance_items_org_id_key unique (organization_id, id),
  constraint maintenance_items_maintenance_fkey foreign key (organization_id, maintenance_id)
    references public.maintenances (organization_id, id) on delete restrict,
  constraint maintenance_items_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete restrict,
  constraint maintenance_items_cluster_fkey foreign key (organization_id, cluster_id)
    references public.maintenance_clusters (organization_id, id) on delete restrict,
  constraint maintenance_items_status_check check (status in ('pending', 'done', 'not_done', 'cancelled')),
  constraint maintenance_items_result_check check (
    (status = 'done' and result in ('resolved', 'partially_resolved'))
    or (status = 'not_done' and result in ('not_resolved'))
    or (status in ('pending', 'cancelled') and result is null)),
  constraint maintenance_items_criticality_check check (criticality in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_items_notes_check check (notes is null or length(notes) <= 2000)
);
create unique index if not exists maintenance_items_service_key
  on public.maintenance_items (maintenance_id, service_id) where status <> 'cancelled';
create index if not exists maintenance_items_maintenance_idx
  on public.maintenance_items (organization_id, maintenance_id, sort_order);
create index if not exists maintenance_items_cluster_idx
  on public.maintenance_items (organization_id, cluster_id, service_id);
comment on table public.maintenance_items is
  'Itens de serviço de uma manutenção: cluster, serviço, criticidade, situação (pendente, realizado, não realizado, cancelado), resultado e observação. Cluster e nome ficam em snapshot para o histórico.';

-- A trilha: toda transição de situação e todo fato relevante. Append-only.
create table if not exists public.maintenance_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  maintenance_id  uuid not null,
  event_type      text not null,
  from_status     text,
  to_status       text,
  reason          text,
  payload         jsonb not null default '{}'::jsonb,
  source          text not null default 'user',
  actor_user_id   uuid references auth.users (id) on delete set null,
  actor_name      text,
  occurred_at     timestamptz not null default now(),
  constraint maintenance_events_maintenance_fkey foreign key (organization_id, maintenance_id)
    references public.maintenances (organization_id, id) on delete restrict,
  constraint maintenance_events_type_check check (event_type in (
    'created', 'scheduled', 'rescheduled', 'started', 'completed', 'reopened', 'cancelled', 'not_performed',
    'unscheduled', 'supplier_changed', 'items_added', 'item_removed', 'item_updated', 'km_changed',
    'details_updated', 'finding_linked', 'finding_unlinked', 'finding_resolved', 'preventive_updated',
    'predictive_updated', 'imported', 'import_updated')),
  constraint maintenance_events_source_check check (source in ('user', 'import', 'system')),
  constraint maintenance_events_reason_check check (reason is null or length(reason) <= 2000)
);
create index if not exists maintenance_events_maintenance_idx
  on public.maintenance_events (organization_id, maintenance_id, occurred_at);
comment on table public.maintenance_events is
  'Trilha append-only da manutenção: solicitação, programação, reprogramação (valor anterior e novo, motivo), entrada, conclusão, reabertura, fornecedor, serviços, KM, vínculos. Autor = usuário autenticado; "sistema" só para rotinas automáticas.';

create or replace view public.maintenance_status_history
with (security_invoker = true) as
select e.id, e.organization_id, e.maintenance_id, e.from_status, e.to_status, e.reason,
       e.actor_user_id, e.actor_name, e.source, e.occurred_at
  from public.maintenance_events e
 where e.to_status is not null;
comment on view public.maintenance_status_history is
  'Histórico de situação = os eventos da trilha que mudaram a situação. Não existe uma segunda tabela a manter em sincronia.';

-- Vínculo N:N manutenção × apontamento do Check List. Um apontamento (resposta
-- inconforme) pode ser tratado por várias manutenções, e uma manutenção pode
-- tratar apontamentos de vários checklists — o mesmo nível em que o módulo
-- Planos de Ação vai trabalhar.
create table if not exists public.maintenance_finding_links (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  maintenance_id         uuid not null,
  checklist_execution_id uuid not null references public.checklist_executions (id) on delete restrict,
  checklist_answer_id    uuid not null references public.checklist_execution_answers (id) on delete restrict,
  question_key           text not null,
  field_key              text,
  link_origin            text not null default 'manual',
  resolution_status      text not null default 'pending',
  resolved_by_item_id    uuid,
  resolved_at            timestamptz,
  resolved_by            uuid references auth.users (id) on delete set null,
  notes                  text,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  constraint maintenance_finding_links_maintenance_fkey foreign key (organization_id, maintenance_id)
    references public.maintenances (organization_id, id) on delete restrict,
  constraint maintenance_finding_links_item_fkey foreign key (organization_id, resolved_by_item_id)
    references public.maintenance_items (organization_id, id) on delete restrict,
  constraint maintenance_finding_links_key unique (maintenance_id, checklist_answer_id),
  constraint maintenance_finding_links_origin_check check (link_origin in ('opened_from_finding', 'manual', 'auto')),
  constraint maintenance_finding_links_resolution_check check (
    resolution_status in ('pending', 'resolved', 'partially_resolved', 'not_resolved'))
);
create index if not exists maintenance_finding_links_answer_idx
  on public.maintenance_finding_links (organization_id, checklist_answer_id);
comment on table public.maintenance_finding_links is
  'Manutenção × apontamento do Check List (resposta inconforme). A conclusão resolve só os apontamentos cujo serviço foi realizado e está mapeado com baixa automática; os demais ficam pendentes (resolução parcial).';

-- -----------------------------------------------------------------------------
-- 7. Gatilhos padrão (carimbo, tenant imutável, auditoria, append-only)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'maintenance_origins', 'maintenance_clusters', 'maintenance_services', 'maintenance_suppliers',
    'maintenance_checklist_service_links', 'maintenance_settings', 'maintenance_preventive_rules',
    'maintenance_preventive_cycles', 'maintenance_predictive_plans', 'maintenance_predictive_plan_items',
    'maintenance_predictive_cycles', 'maintenances', 'maintenance_items', 'maintenance_finding_links']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_stamps', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.tg_set_stamps()',
                   t || '_set_stamps', t);
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.tg_audit()',
                   t || '_audit', t);
  end loop;

  foreach t in array array[
    'maintenance_clusters', 'maintenance_services', 'maintenance_suppliers', 'maintenance_checklist_service_links',
    'maintenance_preventive_rules', 'maintenance_preventive_cycles', 'maintenance_predictive_plans',
    'maintenance_predictive_plan_items', 'maintenance_predictive_cycles', 'maintenances', 'maintenance_items',
    'maintenance_finding_links']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_prevent_tenant_change', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.tg_prevent_tenant_change()',
                   t || '_prevent_tenant_change', t);
  end loop;

  foreach t in array array[
    'maintenance_events', 'maintenance_predictive_plan_versions', 'maintenance_predictive_verifications']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.tg_block_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 8. RLS — leitura por permissão e escopo; escrita só pelas RPCs
-- -----------------------------------------------------------------------------
alter table public.maintenance_types                      enable row level security;
alter table public.maintenance_origins                    enable row level security;
alter table public.maintenance_clusters                   enable row level security;
alter table public.maintenance_services                   enable row level security;
alter table public.maintenance_suppliers                  enable row level security;
alter table public.maintenance_checklist_service_links    enable row level security;
alter table public.maintenance_settings                   enable row level security;
alter table public.maintenance_preventive_rules           enable row level security;
alter table public.maintenance_preventive_cycles          enable row level security;
alter table public.maintenance_predictive_plans           enable row level security;
alter table public.maintenance_predictive_plan_items      enable row level security;
alter table public.maintenance_predictive_plan_versions   enable row level security;
alter table public.maintenance_predictive_coverage        enable row level security;
alter table public.maintenance_predictive_cycles          enable row level security;
alter table public.maintenance_predictive_verifications   enable row level security;
alter table public.maintenances                           enable row level security;
alter table public.maintenance_items                      enable row level security;
alter table public.maintenance_events                     enable row level security;
alter table public.maintenance_finding_links              enable row level security;

drop policy if exists maintenance_types_select on public.maintenance_types;
create policy maintenance_types_select on public.maintenance_types
  for select to authenticated using (true);

drop policy if exists maintenance_origins_select on public.maintenance_origins;
create policy maintenance_origins_select on public.maintenance_origins
  for select to authenticated
  using (organization_id is null or organization_id in (select private.permitted_org_ids('maintenance.view')));

-- Catálogo e parâmetros: toda a organização que vê manutenção vê o catálogo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'maintenance_clusters', 'maintenance_services', 'maintenance_suppliers', 'maintenance_checklist_service_links',
    'maintenance_settings', 'maintenance_preventive_rules', 'maintenance_predictive_plans',
    'maintenance_predictive_plan_items', 'maintenance_predictive_plan_versions', 'maintenance_predictive_coverage']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select private.permitted_org_ids(%L)))',
      t || '_select', t, 'maintenance.view');
  end loop;
end $$;

-- Dados por veículo: permissão + o veículo no escopo de operação do usuário.
drop policy if exists maintenance_preventive_cycles_select on public.maintenance_preventive_cycles;
create policy maintenance_preventive_cycles_select on public.maintenance_preventive_cycles
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('maintenance.view'))
         and private.vehicle_in_scope(organization_id, vehicle_id));

drop policy if exists maintenance_predictive_cycles_select on public.maintenance_predictive_cycles;
create policy maintenance_predictive_cycles_select on public.maintenance_predictive_cycles
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('maintenance.view'))
         and private.vehicle_in_scope(organization_id, vehicle_id));

drop policy if exists maintenance_predictive_verifications_select on public.maintenance_predictive_verifications;
create policy maintenance_predictive_verifications_select on public.maintenance_predictive_verifications
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('maintenance.view'))
         and private.vehicle_in_scope(organization_id, vehicle_id));

-- A manutenção é lida pelo escopo do CONTEXTO em que aconteceu (a operação
-- gravada), não pela alocação de hoje: quem responde pela operação X vê o
-- histórico de X mesmo que o veículo tenha mudado de operação depois. Sem
-- operação no contexto, vale o escopo atual do veículo.
create or replace function private.maintenance_in_scope(p_organization_id uuid, p_operation_id uuid, p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_operation_id is not null then p_operation_id in (select private.accessible_operation_ids())
           else private.vehicle_in_scope(p_organization_id, p_vehicle_id)
         end;
$$;

drop policy if exists maintenances_select on public.maintenances;
create policy maintenances_select on public.maintenances
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('maintenance.view'))
         and private.maintenance_in_scope(organization_id, operation_id, vehicle_id));

do $$
declare
  t text;
begin
  foreach t in array array['maintenance_items', 'maintenance_events', 'maintenance_finding_links']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using (organization_id in (select private.permitted_org_ids('maintenance.view'))
             and exists (select 1 from public.maintenances m
                          where m.id = maintenance_id
                            and private.maintenance_in_scope(m.organization_id, m.operation_id, m.vehicle_id)))
    $p$, t || '_select', t);
  end loop;
end $$;

-- O Supabase concede por padrão ALL (inclusive TRUNCATE, que a RLS não cobre)
-- a anon e authenticated em tabelas novas do schema public. Aqui só se lê;
-- toda escrita passa pelas RPCs.
revoke all on
  public.maintenance_types, public.maintenance_origins, public.maintenance_clusters, public.maintenance_services,
  public.maintenance_suppliers, public.maintenance_checklist_service_links, public.maintenance_settings,
  public.maintenance_preventive_rules, public.maintenance_preventive_cycles, public.maintenance_predictive_plans,
  public.maintenance_predictive_plan_items, public.maintenance_predictive_plan_versions,
  public.maintenance_predictive_coverage, public.maintenance_predictive_cycles,
  public.maintenance_predictive_verifications, public.maintenances, public.maintenance_items,
  public.maintenance_events, public.maintenance_finding_links, public.maintenance_status_history
from anon, authenticated;

grant select on
  public.maintenance_types, public.maintenance_origins, public.maintenance_clusters, public.maintenance_services,
  public.maintenance_suppliers, public.maintenance_checklist_service_links, public.maintenance_settings,
  public.maintenance_preventive_rules, public.maintenance_preventive_cycles, public.maintenance_predictive_plans,
  public.maintenance_predictive_plan_items, public.maintenance_predictive_plan_versions,
  public.maintenance_predictive_coverage, public.maintenance_predictive_cycles,
  public.maintenance_predictive_verifications, public.maintenances, public.maintenance_items,
  public.maintenance_events, public.maintenance_finding_links, public.maintenance_status_history
to authenticated;

revoke all on function private.maintenance_today(uuid) from public, anon;
revoke all on function private.maintenance_in_scope(uuid, uuid, uuid) from public, anon;
grant execute on function private.maintenance_today(uuid) to authenticated, service_role;
grant execute on function private.maintenance_in_scope(uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Importação: o tipo de lote da manutenção
-- -----------------------------------------------------------------------------
do $$
declare
  v_def   text;
  v_types text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.import_batches'::regclass and conname = 'import_batches_type_check';
  select array_agg(distinct m[1]) into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_types := array(select distinct unnest(coalesce(v_types, '{}') || array['maintenance', 'maintenance_catalog']) order by 1);
  execute 'alter table public.import_batches drop constraint if exists import_batches_type_check';
  execute format('alter table public.import_batches add constraint import_batches_type_check check (type = any (%L::text[]))', v_types);
end $$;
