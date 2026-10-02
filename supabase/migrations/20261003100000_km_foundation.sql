-- =============================================================================
-- Gestão de Frota › Gestão de KM Rodado — fundação
--
-- O KM do HFM passa a ter um razão diário oficial (`km_daily_readings`): uma
-- linha por veículo e dia, com o que a fonte informou (hodômetros e KM), o que
-- o HFM calculou, o que foi validado para consumo, o status de qualidade do
-- catálogo central e o contexto operacional vigente NA DATA (BR, local,
-- operação, liderança). A identidade técnica é o veículo (vehicle_id), nunca a
-- placa; a placa e a frota da fonte ficam como retrato.
--
-- Sem bases paralelas:
--   * veículos, tipos, subcategorias e modelos são os do Cadastro de Frotas;
--   * BR/local/operação vêm da Fidelização (vínculo vigente na data) e da
--     alocação; a liderança, das Lideranças (vigência na data);
--   * a importação usa a infraestrutura oficial de lotes (import_batches /
--     import_rows / import_errors), com o tipo novo `km`;
--   * o hodômetro do veículo continua sendo `vehicle_odometer_readings`, que a
--     Manutenção (preventiva, preditiva, KM de entrada) já lê: a consolidação
--     alimenta essa tabela com o hodômetro final de cada dia validado;
--   * eventos vão para `outbox_events`; auditoria das leituras em
--     `km_reading_audit` (só acréscimo).
--
-- Fontes (KmDataSource): toda leitura diz de onde veio (source_type,
-- source_id, source_reference, source_hash, ingested_at). A importação manual
-- (MANUAL_XLSX) é a primeira fonte; planilha conectada, telemetria e outras
-- entram pelo MESMO pipeline quando existirem.
--
-- Só cria; nada é removido nem reescrito. O CHECK de tipos de lote é
-- reconstruído como superconjunto (mesmo padrão de 20260924120000).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões (Administração › Perfis & Permissões)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('km.view',                       'km', 'Ver Gestão de KM',               'Acessa o módulo Gestão de KM Rodado.'),
  ('km.view_dashboard',             'km', 'Ver visão geral de KM',          'Indicadores consolidados de KM, cobertura e atualização.'),
  ('km.view_planner',               'km', 'Ver planner mês/dia',            'Planner de KM por veículo e dia.'),
  ('km.view_daily',                 'km', 'Ver visão diária',               'KM, ranking e inconsistências de um dia.'),
  ('km.view_history',               'km', 'Ver histórico por frota',        'Histórico diário e mensal de KM e hodômetro de um veículo.'),
  ('km.view_analysis',              'km', 'Ver análise gerencial',          'Operação, local, dispersão por coorte, outliers e projeções.'),
  ('km.view_quality',               'km', 'Ver qualidade de dados',         'Indicadores e pendências de qualidade da base de KM.'),
  ('km.import',                     'km', 'Importar KM',                    'Importa a base de KM (Controle KM Rodado) com prévia.'),
  ('km.export',                     'km', 'Exportar KM',                    'Exporta o Controle Mensal, a base consolidada e os relatórios.'),
  ('km.correct',                    'km', 'Corrigir leitura de KM',         'Corrige hodômetros de uma leitura, com motivo e auditoria.'),
  ('km.reprocess',                  'km', 'Reprocessar KM',                 'Reclassifica leituras e recalcula o contexto histórico.'),
  ('km.rotation.view',              'km', 'Ver plano de rodízio',           'Candidatos, simulações e planos de rodízio.'),
  ('km.rotation.create',            'km', 'Criar plano de rodízio',         'Salva planos de rodízio a partir das sugestões.'),
  ('km.rotation.approve',           'km', 'Aprovar rodízio',                'Aprova ou cancela planos e pares de rodízio.'),
  ('km.rotation.schedule',          'km', 'Programar rodízio',              'Programa a data de execução dos pares aprovados.'),
  ('km.rotation.execute',           'km', 'Executar rodízio',               'Registra a execução de um par de rodízio.'),
  ('km.rotation.apply_fidelization','km', 'Aplicar rodízio na Fidelização','Troca os veículos dos BRs na Fidelização, com prévia e auditoria.'),
  ('km.view_audit',                 'km', 'Ver auditoria de KM',            'Trilha de importações, correções e reprocessamentos.'),
  ('km.manage_parameters',          'km', 'Parâmetros de KM',               'Tolerâncias, limites de alta rodagem e regras de análise.')
on conflict (code) do nothing;

-- Padrões por perfil oficial — num único comando (o gatilho de sincronização é
-- por comando). Nada concede acesso pelo nome do perfil: são os padrões da
-- matriz, que o administrador ajusta depois. Liderança acompanha o próprio
-- escopo; Operacional e Gente não recebem nada.
insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('gestor_frota')) p(profile_code)
  cross join (select code from public.permissions where module = 'km') c
union all
select v.profile_code, v.permission_code
  from (values
    ('gestao',              'km.view'),
    ('gestao',              'km.view_dashboard'),
    ('gestao',              'km.view_planner'),
    ('gestao',              'km.view_daily'),
    ('gestao',              'km.view_history'),
    ('gestao',              'km.view_analysis'),
    ('gestao',              'km.view_quality'),
    ('gestao',              'km.export'),
    ('gestao',              'km.rotation.view'),
    ('gestao',              'km.rotation.approve'),
    ('gestao',              'km.view_audit'),
    ('lideranca_operacoes', 'km.view'),
    ('lideranca_operacoes', 'km.view_dashboard'),
    ('lideranca_operacoes', 'km.view_planner'),
    ('lideranca_operacoes', 'km.view_daily'),
    ('lideranca_operacoes', 'km.view_history'),
    ('lideranca_operacoes', 'km.view_analysis'),
    ('lideranca_operacoes', 'km.rotation.view'),
    ('lideranca_operacoes', 'km.export'),
    ('seguranca',           'km.view'),
    ('seguranca',           'km.view_dashboard')) v(profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Catálogo central de status (um só, para todas as telas)
-- -----------------------------------------------------------------------------
create table if not exists public.km_reading_statuses (
  code            text primary key,
  label           text not null,
  description     text not null,
  -- reading: status de uma leitura diária; alert: sinal adicional de uma
  -- leitura; import: achado que impede a linha de virar leitura.
  kind            text not null,
  tone            text not null,
  -- a leitura tem hodômetro confiável (entra na cobertura)
  has_reading     boolean not null default false,
  -- o KM validado entra nos totais
  counts_distance boolean not null default false,
  sort_order      smallint not null,
  constraint km_reading_statuses_code_check check (code ~ '^[a-z][a-z_]{1,39}$'),
  constraint km_reading_statuses_kind_check check (kind in ('reading', 'alert', 'import')),
  constraint km_reading_statuses_tone_check check (tone in ('success', 'neutral', 'info', 'warning', 'danger'))
);

comment on table public.km_reading_statuses is
  'Catálogo central dos status de qualidade do KM (leitura, alerta e achado de importação). Telas, relatórios e indicadores usam estes códigos.';

insert into public.km_reading_statuses (code, label, description, kind, tone, has_reading, counts_distance, sort_order) values
  ('validated',           'Validado',              'Leitura com hodômetro inicial e final coerentes; o KM entra nos totais.',                      'reading', 'success', true,  true,  10),
  ('no_movement',         'Sem movimento',         'Leitura válida e deslocamento zero ou dentro da tolerância configurada.',                       'reading', 'neutral', true,  true,  20),
  ('high_mileage',        'Alta rodagem',          'KM do dia acima do limite de alta rodagem; é rodagem real, apresentada para análise.',          'reading', 'warning', true,  true,  30),
  ('km_divergence',       'Divergência de KM',     'O KM informado difere do calculado pelos hodômetros além da tolerância; vale o calculado.',     'reading', 'warning', true,  true,  40),
  ('pending_review',      'Pendente de análise',   'Hodômetro regrediu em relação ao dia anterior além da tolerância; KM do dia mantido para análise.', 'reading', 'warning', true, true,  50),
  ('inconsistent',        'Inconsistente',         'Hodômetro final menor que o inicial ou só um dos hodômetros informado; KM não entra nos totais.', 'reading', 'danger', false, false, 60),
  ('no_reading',          'Sem leitura',           'Não há informação confiável de hodômetro no dia. Não é 0 km.',                                  'reading', 'neutral', false, false, 70),
  ('registry_divergence', 'Divergência cadastral', 'Frota, tipo ou modelo da fonte diferente do Cadastro de Frotas; o cadastro não é alterado.',   'alert',   'info',    false, false, 80),
  ('odometer_jump',       'Salto de hodômetro',    'Hodômetro inicial muito acima do final do dia anterior (deslocamento não atribuído).',          'alert',   'warning', false, false, 85),
  ('odometer_regression', 'Hodômetro regressivo',  'Hodômetro inicial abaixo do final do dia anterior.',                                            'alert',   'danger',  false, false, 86),
  ('unregistered_plate',  'Placa não cadastrada',  'A placa da fonte não corresponde a nenhum veículo do Cadastro de Frotas; a linha não é gravada.', 'import', 'danger', false, false, 90)
on conflict (code) do nothing;

alter table public.km_reading_statuses enable row level security;
drop policy if exists km_reading_statuses_select on public.km_reading_statuses;
create policy km_reading_statuses_select on public.km_reading_statuses for select to authenticated using (true);
grant select on public.km_reading_statuses to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Parâmetros por organização
-- -----------------------------------------------------------------------------
create table if not exists public.km_settings (
  organization_id          uuid primary key references public.organizations (id) on delete restrict,
  -- deslocamento até este valor (km) num dia com leitura = Sem movimento
  no_movement_tolerance_km numeric(6,2) not null default 1.0,
  -- |KM informado − KM calculado| acima disto = Divergência de KM
  divergence_tolerance_km  numeric(6,2) not null default 1.0,
  -- KM do dia acima disto = Alta rodagem
  high_mileage_km          numeric(7,1) not null default 800,
  -- hodômetro inicial − final do dia anterior acima disto = Salto
  odometer_jump_km         numeric(7,1) not null default 500,
  -- hodômetro inicial abaixo do final anterior por mais que isto = Regressão
  regression_tolerance_km  numeric(6,2) not null default 5,
  -- análises estatísticas: cobertura mínima (% dos dias do período com leitura)
  min_coverage_pct         numeric(5,2) not null default 50,
  -- coorte técnica: mínimo de veículos para estatística e benchmark
  min_cohort_size          smallint not null default 3,
  -- outlier: fora de Q1 − k·IQR / Q3 + k·IQR
  outlier_iqr_factor       numeric(4,2) not null default 1.5,
  -- rodízio: gap mínimo de hodômetro para sugerir um par e validade da análise
  rotation_min_gap_km      numeric(9,1) not null default 5000,
  rotation_stale_days      smallint not null default 7,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id) on delete set null,
  constraint km_settings_values_check check (
    no_movement_tolerance_km >= 0 and divergence_tolerance_km >= 0 and high_mileage_km > 0
    and odometer_jump_km > 0 and regression_tolerance_km >= 0
    and min_coverage_pct between 0 and 100 and min_cohort_size between 2 and 50
    and outlier_iqr_factor between 0.5 and 5 and rotation_min_gap_km >= 0 and rotation_stale_days between 1 and 180)
);

comment on table public.km_settings is 'Parâmetros da Gestão de KM por organização (tolerâncias, alta rodagem, análise e rodízio).';

alter table public.km_settings enable row level security;
drop policy if exists km_settings_select on public.km_settings;
create policy km_settings_select on public.km_settings for select to authenticated
  using (organization_id in (select private.permitted_org_ids('km.view')));
grant select on public.km_settings to authenticated;

-- Os parâmetros de uma organização, com os padrões quando ainda não salvos.
create or replace function private.km_settings_of(p_organization_id uuid)
returns public.km_settings
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s from public.km_settings s where s.organization_id = p_organization_id),
    row(p_organization_id, 1.0, 1.0, 800, 500, 5, 50, 3, 1.5, 5000, 7, now(), null)::public.km_settings);
$$;

revoke all on function private.km_settings_of(uuid) from public, anon;
grant execute on function private.km_settings_of(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Fontes de dados (contrato KmDataSource)
-- -----------------------------------------------------------------------------
create table if not exists public.km_data_sources (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  source_type      text not null,
  name             text not null,
  description      text,
  -- prioridade entre fontes do mesmo veículo/dia (menor vence) — hoje há uma
  priority         smallint not null default 100,
  -- configuração não sensível (nome da aba, colunas); credenciais nunca aqui
  config           jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  last_ingested_at timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  constraint km_data_sources_type_check
    check (source_type in ('manual_xlsx', 'connected_spreadsheet', 'telematics_api', 'other_import', 'manual_entry')),
  constraint km_data_sources_name_check check (length(btrim(name)) between 1 and 120),
  constraint km_data_sources_org_id_key unique (organization_id, id),
  constraint km_data_sources_type_name_key unique (organization_id, source_type, name)
);

comment on table public.km_data_sources is
  'Fontes de KM (contrato KmDataSource). Toda leitura aponta a fonte; uma fonte automática futura entra pelo mesmo pipeline de staging, validação e consolidação da importação manual.';

alter table public.km_data_sources enable row level security;
drop policy if exists km_data_sources_select on public.km_data_sources;
create policy km_data_sources_select on public.km_data_sources for select to authenticated
  using (organization_id in (select private.permitted_org_ids('km.view')));
grant select on public.km_data_sources to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Razão diário oficial
-- -----------------------------------------------------------------------------
create table if not exists public.km_daily_readings (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete restrict,
  vehicle_id                 uuid not null,
  reading_date               date not null,

  -- retrato da fonte (não muda se o cadastro mudar depois)
  plate_snapshot             text not null,
  fleet_code_snapshot        text,
  type_informed              text,
  model_informed             text,
  -- cadastro na consolidação (coorte técnica)
  vehicle_type_id            uuid,
  vehicle_subcategory_id     uuid,
  vehicle_model_id           uuid,

  -- o que a fonte informou — nunca sobrescrito por correção
  odometer_start_imported    numeric(11,2),
  odometer_end_imported      numeric(11,2),
  distance_imported          numeric(9,2),
  -- calculado pelo HFM: final − inicial (informados)
  distance_calculated        numeric(9,2),
  -- valores vigentes (iguais aos informados até uma correção autorizada)
  odometer_start             numeric(11,2),
  odometer_end               numeric(11,2),
  -- aprovado para consumo pelos módulos; nulo = não entra em totais
  distance_validated         numeric(9,2),

  status                     text not null references public.km_reading_statuses (code),
  alerts                     text[] not null default '{}',
  alert_detail               jsonb not null default '{}'::jsonb,

  is_corrected               boolean not null default false,
  corrected_at               timestamptz,
  corrected_by               uuid references auth.users (id) on delete set null,

  -- contexto vigente NA DATA (Fidelização → alocação; Lideranças)
  context_source             text not null default 'none',
  operation_id               uuid references public.operations (id) on delete restrict,
  operation_city_id          uuid,
  state_id                   smallint,
  city_id                    integer,
  operation_br_id            uuid references public.operation_brs (id) on delete restrict,
  fidelization_assignment_id uuid,
  leader_employee_id         uuid references public.employees (id) on delete restrict,
  organization_unit_id       uuid,
  context_resolved_at        timestamptz,

  -- origem (KmDataSource)
  source_type                text not null,
  source_id                  uuid,
  source_reference           text,
  source_hash                text,
  ingested_at                timestamptz not null default now(),
  import_batch_id            uuid,

  created_at                 timestamptz not null default now(),
  created_by                 uuid references auth.users (id) on delete set null,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users (id) on delete set null,

  constraint km_daily_readings_key unique (organization_id, vehicle_id, reading_date),
  constraint km_daily_readings_org_id_key unique (organization_id, id),
  constraint km_daily_readings_vehicle_fkey
    foreign key (organization_id, vehicle_id) references public.vehicles (organization_id, id) on delete restrict,
  constraint km_daily_readings_source_fkey
    foreign key (organization_id, source_id) references public.km_data_sources (organization_id, id) on delete restrict,
  constraint km_daily_readings_source_type_check
    check (source_type in ('manual_xlsx', 'connected_spreadsheet', 'telematics_api', 'other_import', 'manual_entry')),
  constraint km_daily_readings_context_check check (context_source in ('fidelization', 'allocation', 'none')),
  constraint km_daily_readings_values_check check (
    (odometer_start_imported is null or odometer_start_imported between 0 and 9999999)
    and (odometer_end_imported is null or odometer_end_imported between 0 and 9999999)
    and (odometer_start is null or odometer_start between 0 and 9999999)
    and (odometer_end is null or odometer_end between 0 and 9999999)
    and (distance_validated is null or distance_validated >= 0)),
  -- Sem leitura nunca carrega KM: ausência de dado não é 0 km.
  constraint km_daily_readings_no_reading_check
    check (status <> 'no_reading' or (distance_validated is null and odometer_start is null and odometer_end is null))
);

comment on table public.km_daily_readings is
  'Razão diário oficial de KM: um registro por veículo e dia. Guarda o informado pela fonte, o calculado, o validado, o status do catálogo central e o contexto vigente na data. Escrita só pelas rotinas da Gestão de KM.';
comment on column public.km_daily_readings.distance_validated is
  'KM aprovado para consumo (totais, médias, projeções, preventiva). Nulo quando não há leitura confiável — nunca 0 por ausência.';

create index if not exists km_daily_readings_org_date_idx on public.km_daily_readings (organization_id, reading_date);
create index if not exists km_daily_readings_vehicle_date_idx on public.km_daily_readings (vehicle_id, reading_date desc);
create index if not exists km_daily_readings_org_status_idx on public.km_daily_readings (organization_id, status, reading_date);
create index if not exists km_daily_readings_operation_date_idx on public.km_daily_readings (operation_id, reading_date);
create index if not exists km_daily_readings_batch_idx on public.km_daily_readings (import_batch_id) where import_batch_id is not null;

drop trigger if exists km_daily_readings_prevent_tenant_change on public.km_daily_readings;
create trigger km_daily_readings_prevent_tenant_change before update on public.km_daily_readings
  for each row execute function private.tg_prevent_tenant_change();

-- -----------------------------------------------------------------------------
-- 6. Auditoria das leituras (só acréscimo)
-- -----------------------------------------------------------------------------
create table if not exists public.km_reading_audit (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  reading_id      uuid not null,
  vehicle_id      uuid not null,
  reading_date    date not null,
  action          text not null,
  -- {campo: {"from": …, "to": …}}
  changes         jsonb not null default '{}'::jsonb,
  reason          text,
  batch_id        uuid,
  actor_user_id   uuid references auth.users (id) on delete set null,
  actor_name      text,
  occurred_at     timestamptz not null default now(),
  constraint km_reading_audit_action_check
    check (action in ('import_update', 'correction', 'review', 'reprocess', 'context_refresh')),
  constraint km_reading_audit_reading_fkey
    foreign key (organization_id, reading_id) references public.km_daily_readings (organization_id, id) on delete restrict
);

comment on table public.km_reading_audit is
  'Trilha das leituras de KM: atualização por importação, correção manual (valor anterior, novo, campo, motivo, usuário), revisão e reprocessamento. Só acréscimo.';

create index if not exists km_reading_audit_reading_idx on public.km_reading_audit (reading_id, occurred_at);
create index if not exists km_reading_audit_org_idx on public.km_reading_audit (organization_id, occurred_at desc);

create or replace function private.tg_km_audit_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'A trilha de KM é só acréscimo.' using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function private.tg_km_audit_append_only() from public;

drop trigger if exists km_reading_audit_append_only on public.km_reading_audit;
create trigger km_reading_audit_append_only
  before update or delete on public.km_reading_audit
  for each row execute function private.tg_km_audit_append_only();

-- Quem fez: o usuário autenticado (nunca um genérico "Sistema" quando há um).
create or replace function private.km_actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.full_name from public.employees e
      join public.organization_memberships m on m.employee_id = e.id
     where m.user_id = auth.uid() and e.deleted_at is null limit 1),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    'Rotina do sistema');
$$;

revoke all on function private.km_actor_name() from public, anon;

-- -----------------------------------------------------------------------------
-- 7. Plano de rodízio
-- -----------------------------------------------------------------------------
create table if not exists public.km_rotation_plans (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  code                    text not null,
  name                    text not null,
  notes                   text,
  period_from             date not null,
  period_to               date not null,
  horizon_days            smallint not null,
  scope_mode              text not null,
  -- só trocas entre locais (cidade/BR) diferentes
  different_locations_only boolean not null default true,
  -- filtros da análise que gerou o plano (IDs)
  filters                 jsonb not null default '{}'::jsonb,
  status                  text not null default 'suggested',
  responsible_employee_id uuid references public.employees (id) on delete restrict,
  planned_date            date,
  -- dados analisados (até que dia havia leitura) e quando a análise foi feita
  data_as_of              date not null,
  analyzed_at             timestamptz not null default now(),
  revalidated_at          timestamptz,
  summary                 jsonb not null default '{}'::jsonb,
  approved_at             timestamptz,
  approved_by             uuid references auth.users (id) on delete set null,
  cancelled_at            timestamptz,
  cancelled_by            uuid references auth.users (id) on delete set null,
  cancel_reason           text,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id) on delete set null,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users (id) on delete set null,
  constraint km_rotation_plans_org_id_key unique (organization_id, id),
  constraint km_rotation_plans_code_key unique (organization_id, code),
  constraint km_rotation_plans_name_check check (length(btrim(name)) between 3 and 120),
  constraint km_rotation_plans_period_check check (period_to >= period_from),
  constraint km_rotation_plans_horizon_check check (horizon_days in (30, 60, 90)),
  constraint km_rotation_plans_scope_check
    check (scope_mode in ('same_cohort_same_operation', 'same_cohort_global')),
  constraint km_rotation_plans_status_check
    check (status in ('suggested', 'approved', 'scheduled', 'executed', 'cancelled'))
);

create table if not exists public.km_rotation_plan_items (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  plan_id                  uuid not null,
  item_number              smallint not null,
  vehicle_a_id             uuid not null,
  vehicle_b_id             uuid not null,
  cohort_key               text not null,
  cohort_label             text not null,
  -- retrato da análise: placa, frota, BR, local, operação, hodômetro, KM/mês,
  -- KM/dia, percentil e média da coorte de cada veículo
  snapshot                 jsonb not null default '{}'::jsonb,
  gap_current_km           numeric(10,1) not null,
  gap_future_without_km    numeric(10,1) not null,
  gap_future_with_km       numeric(10,1) not null,
  reduction_km             numeric(10,1) not null,
  reduction_pct            numeric(6,2) not null,
  priority                 text not null,
  justification            text not null,
  status                   text not null default 'suggested',
  effective_date           date,
  responsible_employee_id  uuid references public.employees (id) on delete restrict,
  notes                    text,
  revalidated_at           timestamptz,
  -- execução: hodômetros dos dois veículos no dia (base da avaliação pós-rodízio)
  executed_at              timestamptz,
  executed_by              uuid references auth.users (id) on delete set null,
  execution_date           date,
  execution_odometer_a     numeric(11,2),
  execution_odometer_b     numeric(11,2),
  fidelization_applied_at  timestamptz,
  fidelization_applied_by  uuid references auth.users (id) on delete set null,
  fidelization_payload     jsonb,
  cancelled_reason         text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint km_rotation_items_plan_fkey
    foreign key (organization_id, plan_id) references public.km_rotation_plans (organization_id, id) on delete restrict,
  constraint km_rotation_items_vehicle_a_fkey
    foreign key (organization_id, vehicle_a_id) references public.vehicles (organization_id, id) on delete restrict,
  constraint km_rotation_items_vehicle_b_fkey
    foreign key (organization_id, vehicle_b_id) references public.vehicles (organization_id, id) on delete restrict,
  constraint km_rotation_items_distinct_check check (vehicle_a_id <> vehicle_b_id),
  constraint km_rotation_items_priority_check check (priority in ('high', 'medium', 'low', 'none')),
  constraint km_rotation_items_status_check
    check (status in ('suggested', 'approved', 'scheduled', 'executed', 'cancelled')),
  constraint km_rotation_items_pair_key unique (plan_id, vehicle_a_id, vehicle_b_id),
  constraint km_rotation_items_number_key unique (plan_id, item_number)
);

create index if not exists km_rotation_items_plan_idx on public.km_rotation_plan_items (plan_id);
create index if not exists km_rotation_items_vehicles_idx on public.km_rotation_plan_items (vehicle_a_id, vehicle_b_id);

create table if not exists public.km_rotation_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  plan_id         uuid not null,
  item_id         uuid,
  event_type      text not null,
  from_status     text,
  to_status       text,
  reason          text,
  payload         jsonb not null default '{}'::jsonb,
  actor_user_id   uuid references auth.users (id) on delete set null,
  actor_name      text,
  occurred_at     timestamptz not null default now(),
  constraint km_rotation_events_plan_fkey
    foreign key (organization_id, plan_id) references public.km_rotation_plans (organization_id, id) on delete restrict,
  constraint km_rotation_events_type_check
    check (event_type in ('created', 'updated', 'status_changed', 'item_added', 'item_updated', 'item_status_changed',
                          'revalidated', 'executed', 'fidelization_applied'))
);

create index if not exists km_rotation_events_plan_idx on public.km_rotation_events (plan_id, occurred_at);

drop trigger if exists km_rotation_events_append_only on public.km_rotation_events;
create trigger km_rotation_events_append_only
  before update or delete on public.km_rotation_events
  for each row execute function private.tg_km_audit_append_only();

-- -----------------------------------------------------------------------------
-- 8. Lote de importação do tipo `km` (superconjunto do que estiver valendo)
-- -----------------------------------------------------------------------------
do $$
declare
  v_def    text;
  v_values text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.import_batches'::regclass
     and c.conname = 'import_batches_type_check';

  select coalesce(array_agg(distinct v order by v), '{}')
    into v_values
    from (
      select btrim(p, ' {}"') as v
        from regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') as t(m),
             regexp_split_to_table(t.m[1], ',') as p
      union
      select unnest(array['employees', 'vehicles', 'adherence', 'operation_brs', 'fidelization', 'branches',
                          'maintenance', 'maintenance_catalog', 'km'])
    ) q
   where v <> '';

  alter table public.import_batches drop constraint if exists import_batches_type_check;
  execute format(
    'alter table public.import_batches add constraint import_batches_type_check check (type in (%s))',
    (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_values) as x));
end;
$$;

-- O hodômetro do veículo aponta a leitura diária que o originou (a Manutenção
-- continua lendo vehicle_odometer_readings; agora com o KM oficial).
alter table public.vehicle_odometer_readings add column if not exists km_reading_id uuid;
create index if not exists vehicle_odometer_km_reading_idx
  on public.vehicle_odometer_readings (km_reading_id) where km_reading_id is not null;
comment on column public.vehicle_odometer_readings.km_reading_id is
  'Leitura diária da Gestão de KM que gerou este hodômetro (hodômetro final validado do dia).';

-- -----------------------------------------------------------------------------
-- 9. RLS — leitura pelo escopo; escrita só pelas rotinas
-- -----------------------------------------------------------------------------
alter table public.km_daily_readings      enable row level security;
alter table public.km_reading_audit       enable row level security;
alter table public.km_rotation_plans      enable row level security;
alter table public.km_rotation_plan_items enable row level security;
alter table public.km_rotation_events     enable row level security;

-- Com operação no contexto, a operação precisa estar no escopo; sem operação,
-- o veículo. Avaliado uma vez por consulta (mesmo padrão de 20261002104000).
drop policy if exists km_daily_readings_select on public.km_daily_readings;
create policy km_daily_readings_select on public.km_daily_readings for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('km.view'))
    and (
      (operation_id is not null and operation_id in (select private.accessible_operation_ids()))
      or (operation_id is null and vehicle_id in (select private.vehicle_scope_ids('km.view')))
    ));

drop policy if exists km_reading_audit_select on public.km_reading_audit;
create policy km_reading_audit_select on public.km_reading_audit for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('km.view_audit'))
    and reading_id in (select r.id from public.km_daily_readings r));

drop policy if exists km_rotation_plans_select on public.km_rotation_plans;
create policy km_rotation_plans_select on public.km_rotation_plans for select to authenticated
  using (organization_id in (select private.permitted_org_ids('km.rotation.view')));

drop policy if exists km_rotation_items_select on public.km_rotation_plan_items;
create policy km_rotation_items_select on public.km_rotation_plan_items for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('km.rotation.view'))
    and vehicle_a_id in (select private.vehicle_scope_ids('km.rotation.view'))
    and vehicle_b_id in (select private.vehicle_scope_ids('km.rotation.view')));

drop policy if exists km_rotation_events_select on public.km_rotation_events;
create policy km_rotation_events_select on public.km_rotation_events for select to authenticated
  using (organization_id in (select private.permitted_org_ids('km.rotation.view')));

revoke insert, update, delete on public.km_daily_readings, public.km_reading_audit, public.km_rotation_plans,
  public.km_rotation_plan_items, public.km_rotation_events, public.km_settings, public.km_data_sources,
  public.km_reading_statuses from authenticated, anon;
grant select on public.km_daily_readings, public.km_reading_audit, public.km_rotation_plans,
  public.km_rotation_plan_items, public.km_rotation_events to authenticated;
