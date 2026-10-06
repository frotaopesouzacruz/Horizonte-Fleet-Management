-- =============================================================================
-- Gestão de Frota › Gestão de Pneus + Aplicativos › Vistoria de Pneus
-- Fundação: permissões, modelo de dados, RLS, aplicativo e sementes.
--
-- Princípios (ver docs/modules/tire-management.md):
--   * Rodopar 10 é a fonte oficial: a fotografia (tire_daily_snapshots) só nasce
--     de uma importação confirmada. A vistoria de campo NUNCA grava na base.
--   * Cadastro (tires) ≠ fotografia (tire_daily_snapshots) ≠ evento (tire_events).
--   * Nº Fogo é texto (zeros à esquerda e identificadores longos preservados);
--     a identidade técnica é tire_id.
--   * Contexto histórico por IDs oficiais (operação, cidade, BR, liderança,
--     filial, tipo de equipamento) congelado na data da fotografia.
--   * Parâmetros versionados por vigência; nada de prazo, limite ou tolerância
--     fixo no código.
--   * Fora do escopo desta etapa: CPK, custo por vida, custo por km, ROI de
--     recapagem. Nenhuma tabela, coluna, rota ou permissão financeira de pneus.
--
-- Migração incremental e não destrutiva: só cria; nunca remove objeto ou dado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões (Perfis & Permissões) e padrões por perfil oficial
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('tires.view',               'tires', 'Ver Gestão de Pneus',               'Acessa Gestão de Frota › Gestão de Pneus.'),
  ('tires.dashboard.view',     'tires', 'Ver visão geral de pneus',          'Indicadores, distribuições, prioridades, insights e tendências das fotografias Rodopar.'),
  ('tires.base.view',          'tires', 'Ver base geral de pneus',           'Base por frota/placa, por Nº Fogo e fora da frota, e a ficha do pneu.'),
  ('tires.history.view',       'tires', 'Ver histórico de pneus',            'Movimentações, trocas de posição, mudanças de vida e de situação entre fotografias.'),
  ('tires.measurement.view',   'tires', 'Ver aderência de milimetragem',     'Cobertura e aderência de medição de sulco, quebras, ranking e pendências.'),
  ('tires.calibration.view',   'tires', 'Ver aderência de calibragem',       'Cobertura e aderência de calibragem, pressão (PSI) e lacunas de parâmetro.'),
  ('tires.schedule.view',      'tires', 'Ver cronograma de aferições',       'Cronograma por frota/placa e agenda de vencimentos.'),
  ('tires.inspection.review',  'tires', 'Analisar vistorias de pneus',       'Central de vistorias recebidas: aprovar para lançamento no Rodopar, retornar por divergência, confirmar sincronização.'),
  ('tires.import',             'tires', 'Importar Rodopar 10',               'Envia o relatório Rodopar 10, confere a prévia e confirma a nova fotografia oficial.'),
  ('tires.export',             'tires', 'Exportar pneus',                    'Exporta base, aderências, cronograma e vistorias.'),
  ('tires.parameters.manage',  'tires', 'Parâmetros de pneus',               'Prazos, limites, tolerâncias, regras de PSI, posições, layouts e mapeamento de serviços.'),
  ('tires.services.view',      'tires', 'Ver serviços de pneus',             'Consertos por Nº Fogo e alinhamento/balanceamento lidos da Gestão de Manutenção.'),
  ('tires.services.manage',    'tires', 'Registrar consertos de pneus',      'Registra e cancela consertos por Nº Fogo, com o veículo resolvido na data do serviço.'),
  ('tires.quality.view',       'tires', 'Ver qualidade da base de pneus',    'Inconsistências do relatório Rodopar e lacunas de configuração, com drill-down.'),
  ('tires.audit.view',         'tires', 'Ver auditoria de pneus',            'Trilha de importações, decisões das vistorias, parâmetros e exportações.'),
  ('applications.tires.execute','applications', 'Executar Vistoria de Pneus', 'Realiza a vistoria cega de pneus no aplicativo e acompanha as próprias vistorias.')
on conflict (code) do nothing;

-- Padrões por perfil oficial — num único comando (o gatilho de sincronização é
-- por comando). Nada concede acesso pelo nome do perfil: são os padrões da
-- matriz, ajustáveis em Perfis & Permissões.
insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('gestor_frota')) p(profile_code)
  cross join (select code from public.permissions where module = 'tires' or code = 'applications.tires.execute') c
union all
select v.profile_code, v.permission_code
  from (values
    ('gestao',              'tires.view'),
    ('gestao',              'tires.dashboard.view'),
    ('gestao',              'tires.base.view'),
    ('gestao',              'tires.history.view'),
    ('gestao',              'tires.measurement.view'),
    ('gestao',              'tires.calibration.view'),
    ('gestao',              'tires.schedule.view'),
    ('gestao',              'tires.services.view'),
    ('gestao',              'tires.quality.view'),
    ('gestao',              'tires.export'),
    ('gestao',              'tires.audit.view'),
    ('seguranca',           'tires.view'),
    ('seguranca',           'tires.dashboard.view'),
    ('seguranca',           'tires.base.view'),
    ('seguranca',           'tires.history.view'),
    ('seguranca',           'tires.measurement.view'),
    ('seguranca',           'tires.calibration.view'),
    ('seguranca',           'tires.schedule.view'),
    ('seguranca',           'tires.quality.view'),
    ('seguranca',           'tires.export'),
    ('lideranca_operacoes', 'tires.view'),
    ('lideranca_operacoes', 'tires.dashboard.view'),
    ('lideranca_operacoes', 'tires.base.view'),
    ('lideranca_operacoes', 'tires.history.view'),
    ('lideranca_operacoes', 'tires.measurement.view'),
    ('lideranca_operacoes', 'tires.calibration.view'),
    ('lideranca_operacoes', 'tires.schedule.view'),
    ('lideranca_operacoes', 'tires.services.view'),
    ('lideranca_operacoes', 'applications.tires.execute'),
    ('operacional',         'applications.tires.execute')) v(profile_code, permission_code)
on conflict do nothing;

-- O módulo "Pneus" já existia no catálogo de módulos dos Tipos de Equipamento
-- como indisponível; agora ele existe.
insert into public.operational_modules (code, name, description, is_available, sort_order)
values ('tyres', 'Pneus', 'Gestão de Pneus: fotografia Rodopar, aderência de medição e calibragem, regras de PSI por dimensão e posição, layout de posições e Vistoria de Pneus.', true, 40)
on conflict (code) do update set is_available = true, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- 2. Funções puras de normalização (imutáveis: usadas em índices e filtros)
-- -----------------------------------------------------------------------------
create or replace function private.tire_fire_number(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Nº Fogo é identificador, nunca número: maiúsculas, sem espaços internos, sem
  -- o ".0" que o Excel acrescenta a células numéricas. Zeros à esquerda ficam.
  select nullif(regexp_replace(regexp_replace(upper(btrim(coalesce(p_value, ''))), '\s+', '', 'g'), '[.,]0+$', ''), '');
$$;

create or replace function private.tire_dimension_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- "225/75 R16" e "225/75R16" são a mesma medida.
  select nullif(regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9/.]', '', 'g'), '');
$$;

create or replace function private.tire_position_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

create or replace function private.tire_canonical_status(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Situação Pneu (Rodopar) → status técnico. A coluna "Condição" é uma
  -- recomendação do Rodopar (APROPRIADO/ALERTA/RECAPAR) e nunca decide a
  -- situação: "RECAPAR" não significa que o pneu está na recapagem.
  select case
    when p_value is null or btrim(p_value) = '' then 'outro'
    when private.normalize_label(p_value) ~ '(ressol|recap|reform)' then 'ressolagem'
    when private.normalize_label(p_value) ~ '(descart|sucata)' then 'descartado'
    when private.normalize_label(p_value) ~ 'baix' then 'baixado'
    when private.normalize_label(p_value) ~ '(^uso$|^em uso|^uso |montad|aplicad)' then 'em_uso'
    when private.normalize_label(p_value) ~ '(estoque|disponiv)' then 'estoque'
    else 'outro'
  end;
$$;

grant execute on function private.tire_fire_number(text), private.tire_dimension_key(text),
  private.tire_position_key(text), private.tire_canonical_status(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Parâmetros gerais com vigência (formulário em Parâmetros; nada fixo no código)
-- -----------------------------------------------------------------------------
create table if not exists public.tire_parameter_sets (
  id                                 uuid primary key default gen_random_uuid(),
  organization_id                    uuid not null references public.organizations (id) on delete restrict,
  effective_from                     date not null,
  effective_to                       date,
  -- prazos de aferição (dias desde a última medição/calibragem)
  measurement_ok_days                integer not null default 20,
  measurement_warning_days           integer not null default 25,
  calibration_ok_days                integer not null default 20,
  calibration_warning_days           integer not null default 25,
  -- saúde do sulco (mm) — o limite legal e a atenção por regra de PSI, quando
  -- cadastrados, prevalecem sobre estes para o pneu daquela regra
  tread_critical_mm                  numeric(5,2) not null default 3,
  tread_attention_mm                 numeric(5,2) not null default 5,
  -- limites técnicos de validação da importação e do aplicativo
  max_valid_tread_mm                 numeric(5,2) not null default 30,
  max_valid_psi                      numeric(6,2) not null default 200,
  future_date_tolerance_days         integer not null default 1,
  tread_min_divergence_tolerance_mm  numeric(4,2) not null default 0.10,
  -- tolerâncias da comparação cega (vistoria × fotografia oficial)
  inspection_tread_tolerance_mm      numeric(4,2) not null default 1.0,
  inspection_psi_tolerance           numeric(5,2) not null default 8,
  -- governança
  stale_update_days                  integer not null default 60,
  review_sla_days                    integer not null default 2,
  rodopar_sync_sla_days              integer not null default 7,
  repair_resolution_max_age_days     integer not null default 31,
  -- alerta operacional de retirada/ressolagem (NÃO é CPK): a recomendação
  -- "RECAPAR" do próprio Rodopar e, se aprovado, um limite de sulco
  retread_alert_use_rodopar_condition boolean not null default true,
  retread_alert_tread_mm             numeric(5,2),
  note                               text,
  created_at                         timestamptz not null default now(),
  created_by                         uuid references auth.users (id) on delete set null,
  updated_at                         timestamptz not null default now(),
  updated_by                         uuid references auth.users (id) on delete set null,
  constraint tire_parameter_sets_org_from_key unique (organization_id, effective_from),
  constraint tire_parameter_sets_dates_check check (effective_to is null or effective_to >= effective_from),
  constraint tire_parameter_sets_measurement_check check (measurement_ok_days between 1 and 365 and measurement_warning_days between measurement_ok_days and 730),
  constraint tire_parameter_sets_calibration_check check (calibration_ok_days between 1 and 365 and calibration_warning_days between calibration_ok_days and 730),
  constraint tire_parameter_sets_tread_check check (tread_critical_mm > 0 and tread_attention_mm >= tread_critical_mm and max_valid_tread_mm > tread_attention_mm),
  constraint tire_parameter_sets_psi_check check (max_valid_psi > 0),
  constraint tire_parameter_sets_tolerance_check check (future_date_tolerance_days between 0 and 30
    and tread_min_divergence_tolerance_mm >= 0 and inspection_tread_tolerance_mm >= 0 and inspection_psi_tolerance >= 0),
  constraint tire_parameter_sets_governance_check check (stale_update_days between 1 and 3650 and review_sla_days between 0 and 365
    and rodopar_sync_sla_days between 0 and 365 and repair_resolution_max_age_days between 1 and 365),
  constraint tire_parameter_sets_retread_check check (retread_alert_tread_mm is null or retread_alert_tread_mm > 0),
  constraint tire_parameter_sets_note_check check (note is null or length(note) <= 500)
);
comment on table public.tire_parameter_sets is
  'Parâmetros gerais de Pneus com vigência: uma alteração abre um novo conjunto a partir da data; fotografias anteriores continuam avaliadas com o conjunto vigente na sua data.';

-- -----------------------------------------------------------------------------
-- 4. Regras de pressão (PSI) e sulco por tipo de equipamento, dimensão, posição e eixo
-- -----------------------------------------------------------------------------
create table if not exists public.tire_pressure_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id     uuid references public.vehicle_types (id) on delete restrict,
  dimension           text,
  dimension_key       text,
  position_code       text,
  axle_group          text,
  min_psi             numeric(6,2) not null,
  ideal_psi           numeric(6,2) not null,
  max_psi             numeric(6,2) not null,
  min_legal_tread_mm  numeric(5,2),
  attention_tread_mm  numeric(5,2),
  is_active           boolean not null default true,
  valid_from          date not null,
  valid_to            date,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint tire_pressure_rules_psi_check check (min_psi >= 0 and min_psi <= ideal_psi and ideal_psi <= max_psi and max_psi <= 300),
  constraint tire_pressure_rules_tread_check check ((min_legal_tread_mm is null or min_legal_tread_mm > 0)
    and (attention_tread_mm is null or attention_tread_mm > 0)
    and (min_legal_tread_mm is null or attention_tread_mm is null or attention_tread_mm >= min_legal_tread_mm)),
  constraint tire_pressure_rules_axle_check check (axle_group is null or axle_group in ('front', 'rear', 'spare')),
  constraint tire_pressure_rules_dates_check check (valid_to is null or valid_to >= valid_from),
  constraint tire_pressure_rules_scope_check check (dimension_key is null or dimension is not null),
  constraint tire_pressure_rules_notes_check check (notes is null or length(notes) <= 500)
);
comment on table public.tire_pressure_rules is
  'Pressão mínima/ideal/máxima e sulco legal/atenção. Campo vazio = vale para todos. Vence a regra mais específica (dimensão > posição > eixo > tipo de equipamento). Sem regra aplicável o pneu é "sem parâmetro" — nunca "adequado".';
create index if not exists tire_pressure_rules_org_idx on public.tire_pressure_rules (organization_id, is_active);

-- -----------------------------------------------------------------------------
-- 5. Posições (dicionário dos códigos Rodopar) e layouts por tipo/veículo
-- -----------------------------------------------------------------------------
create table if not exists public.tire_positions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  code             text not null,
  label            text not null,
  axle_group       text not null,
  axle_index       smallint not null default 1,
  side             text not null,
  slot             text not null default 'single',
  sort_order       smallint not null default 100,
  aliases          text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  constraint tire_positions_code_key unique (organization_id, code),
  constraint tire_positions_code_check check (code ~ '^[A-Z0-9]{1,12}$'),
  constraint tire_positions_label_check check (length(btrim(label)) between 1 and 60),
  constraint tire_positions_axle_check check (axle_group in ('front', 'rear', 'spare', 'other') and axle_index between 1 and 9),
  constraint tire_positions_side_check check (side in ('left', 'right', 'center')),
  constraint tire_positions_slot_check check (slot in ('single', 'outer', 'inner'))
);
comment on table public.tire_positions is
  'Dicionário das posições Rodopar (EDE, ETDI4, ESTEP1…): rótulo, eixo, lado e rodado (simples/externo/interno). O esquema visual do veículo é desenhado a partir destes atributos — nenhum layout fixo no código.';

create table if not exists public.tire_layouts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  code             text not null,
  name             text not null,
  description      text,
  position_codes   text[] not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  constraint tire_layouts_code_key unique (organization_id, code),
  constraint tire_layouts_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint tire_layouts_name_check check (length(btrim(name)) between 1 and 80),
  constraint tire_layouts_positions_check check (cardinality(position_codes) between 1 and 40)
);
comment on table public.tire_layouts is
  'Conjunto de posições esperadas de uma configuração de eixos. Usado pela Vistoria de Pneus e pela qualidade (posição do layout sem pneu, pneu fora do layout).';

create table if not exists public.tire_vehicle_type_layouts (
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id  uuid not null references public.vehicle_types (id) on delete restrict,
  -- nulo = o tipo não tem layout padrão (há mais de uma configuração de eixos)
  layout_id        uuid references public.tire_layouts (id) on delete restrict,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  primary key (organization_id, vehicle_type_id)
);

create table if not exists public.tire_vehicle_layouts (
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  vehicle_id       uuid not null references public.vehicles (id) on delete restrict,
  -- nulo = volta a usar o padrão do tipo (a configuração anterior fica na auditoria)
  layout_id        uuid references public.tire_layouts (id) on delete restrict,
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  primary key (organization_id, vehicle_id),
  constraint tire_vehicle_layouts_reason_check check (reason is null or length(reason) <= 300)
);

-- -----------------------------------------------------------------------------
-- 6. Importação Rodopar 10: lote e staging independente da base oficial
-- -----------------------------------------------------------------------------
create table if not exists public.tire_import_batches (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  file_name                 text not null,
  file_hash                 text not null,
  file_size                 bigint,
  sheet_name                text,
  header_row                integer,
  layout_version            text not null default 'rodopar10_v1',
  window_start              text,
  window_end                text,
  recognized_columns        text[] not null default '{}',
  unrecognized_columns      text[] not null default '{}',
  ignored_columns           text[] not null default '{}',
  reference_date            date not null,
  suggested_reference_date  date,
  previous_reference_date   date,
  status                    text not null default 'staging',
  total_rows                integer not null default 0,
  valid_rows                integer not null default 0,
  warning_rows              integer not null default 0,
  error_rows                integer not null default 0,
  new_tires                 integer not null default 0,
  updated_tires             integer not null default 0,
  unchanged_tires           integer not null default 0,
  absent_tires              integer not null default 0,
  reappeared_tires          integer not null default 0,
  counters                  jsonb not null default '{}'::jsonb,
  reconciliation            jsonb not null default '{}'::jsonb,
  block_reason              text,
  created_by                uuid references auth.users (id) on delete set null,
  created_by_name           text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  validated_at              timestamptz,
  confirmed_by              uuid references auth.users (id) on delete set null,
  confirmed_by_name         text,
  confirmed_at              timestamptz,
  cancelled_by              uuid references auth.users (id) on delete set null,
  cancelled_at              timestamptz,
  cancel_reason             text,
  constraint tire_import_batches_org_id_key unique (organization_id, id),
  constraint tire_import_batches_hash_check check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint tire_import_batches_status_check check (status in ('staging', 'validated', 'blocked', 'confirmed', 'cancelled')),
  constraint tire_import_batches_name_check check (length(btrim(file_name)) between 1 and 255),
  constraint tire_import_batches_cancel_check check (cancel_reason is null or length(cancel_reason) <= 300)
);
comment on table public.tire_import_batches is
  'Lote de importação do Rodopar 10. Uma fotografia confirmada por data de referência; o mesmo arquivo (hash) nunca é confirmado duas vezes.';
create unique index if not exists tire_import_batches_hash_confirmed_uidx
  on public.tire_import_batches (organization_id, file_hash) where status = 'confirmed';
create unique index if not exists tire_import_batches_ref_confirmed_uidx
  on public.tire_import_batches (organization_id, reference_date) where status = 'confirmed';
create index if not exists tire_import_batches_org_created_idx on public.tire_import_batches (organization_id, created_at desc);

create table if not exists public.tire_import_staging (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  batch_id                 uuid not null,
  row_number               integer not null,
  raw                      jsonb not null default '{}'::jsonb,
  cells                    jsonb not null default '{}'::jsonb,
  client_flags             text[] not null default '{}',
  -- tipado (preenchido na validação; o bruto continua em raw/values)
  fire_number              text,
  serial_number            text,
  rodopar_tire_branch      text,
  unit_code                text,
  cost_code                text,
  purchase_date            date,
  rodopar_status_raw       text,
  canonical_status         text,
  fleet_number_raw         text,
  fleet_branch             text,
  brand                    text,
  model                    text,
  dimension                text,
  position_code            text,
  tread_min_raw            numeric(7,2),
  tread_1                  numeric(7,2),
  tread_2                  numeric(7,2),
  tread_3                  numeric(7,2),
  tread_4                  numeric(7,2),
  tread_min_calculated     numeric(7,2),
  measurement_at           timestamp,
  psi                      numeric(7,2),
  calibration_at           timestamp,
  km_rodado                bigint,
  km_real                  bigint,
  dot                      text,
  life                     smallint,
  rodopar_condition        text,
  rodopar_classification   text,
  rodopar_status_label     text,
  registration_at          timestamp,
  rodopar_created_by       text,
  rodopar_updated_by       text,
  rodopar_updated_at       timestamp,
  drawing                  text,
  rubber                   text,
  -- enriquecimento e comparação
  vehicle_id               uuid,
  tire_id                  uuid,
  action                   text,
  changes                  text[] not null default '{}',
  severity                 text not null default 'pending',
  issues                   jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  constraint tire_import_staging_row_key unique (batch_id, row_number),
  constraint tire_import_staging_batch_fkey foreign key (organization_id, batch_id)
    references public.tire_import_batches (organization_id, id) on delete restrict,
  constraint tire_import_staging_severity_check check (severity in ('pending', 'ok', 'warning', 'error')),
  constraint tire_import_staging_action_check check (action is null or action in ('new', 'updated', 'unchanged'))
);
create index if not exists tire_import_staging_batch_idx on public.tire_import_staging (batch_id, severity);
create index if not exists tire_import_staging_fire_idx on public.tire_import_staging (batch_id, fire_number);

-- -----------------------------------------------------------------------------
-- 7. Cadastro do pneu (identidade histórica) — sem nenhum campo financeiro
-- -----------------------------------------------------------------------------
create table if not exists public.tires (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  fire_number             text not null,
  serial_number           text,
  brand                   text,
  model                   text,
  dimension               text,
  dimension_key           text,
  dot                     text,
  drawing                 text,
  rubber                  text,
  purchase_date           date,
  registration_date       date,
  current_life            smallint,
  current_status          text not null default 'outro',
  rodopar_status_raw      text,
  current_vehicle_id      uuid references public.vehicles (id) on delete restrict,
  current_position_code   text,
  current_snapshot_id     uuid,
  first_reference_date    date not null,
  last_reference_date     date not null,
  last_import_batch_id    uuid references public.tire_import_batches (id) on delete restrict,
  presence_status         text not null default 'present',
  absent_since            date,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id) on delete set null,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users (id) on delete set null,
  constraint tires_org_id_key unique (organization_id, id),
  constraint tires_fire_number_key unique (organization_id, fire_number),
  constraint tires_fire_number_check check (fire_number ~ '^[0-9A-Z][0-9A-Z./_-]{0,29}$'),
  constraint tires_status_check check (current_status in ('em_uso', 'estoque', 'ressolagem', 'descartado', 'baixado', 'outro')),
  constraint tires_presence_check check (presence_status in ('present', 'absent') and (presence_status = 'present') = (absent_since is null)),
  constraint tires_life_check check (current_life is null or current_life between 0 and 20)
);
comment on table public.tires is
  'Cadastro do pneu: identidade histórica por Nº Fogo (texto). A situação vigente é a da última fotografia Rodopar; um pneu ausente no relatório mais recente fica "ausente na fotografia atual" — nunca é excluído.';
create index if not exists tires_org_status_idx on public.tires (organization_id, current_status);
create index if not exists tires_vehicle_idx on public.tires (current_vehicle_id) where current_vehicle_id is not null;
create index if not exists tires_life_idx on public.tires (organization_id, current_life);

-- -----------------------------------------------------------------------------
-- 8. Fotografia (uma por pneu e data de referência)
-- -----------------------------------------------------------------------------
create table if not exists public.tire_daily_snapshots (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id) on delete restrict,
  tire_id                     uuid not null,
  reference_date              date not null,
  import_batch_id             uuid not null,
  row_number                  integer,
  fire_number                 text not null,
  -- dados oficiais do Rodopar (tipados; o bruto fica em raw)
  rodopar_tire_branch         text,
  unit_code                   text,
  cost_code                   text,
  purchase_date               date,
  rodopar_status_raw          text,
  canonical_status            text not null,
  fleet_number_raw            text,
  fleet_branch                text,
  brand                       text,
  model                       text,
  dimension                   text,
  dimension_key               text,
  position_code               text,
  tread_min_raw               numeric(7,2),
  tread_1                     numeric(7,2),
  tread_2                     numeric(7,2),
  tread_3                     numeric(7,2),
  tread_4                     numeric(7,2),
  tread_min_calculated        numeric(7,2),
  tread_min                   numeric(7,2),
  tread_divergence            boolean not null default false,
  measurement_at              timestamp,
  measurement_date            date,
  psi                         numeric(7,2),
  calibration_at              timestamp,
  calibration_date            date,
  km_rodado                   bigint,
  km_real                     bigint,
  dot                         text,
  life                        smallint,
  rodopar_condition           text,
  rodopar_classification      text,
  rodopar_status_label        text,
  registration_at             timestamp,
  serial_number               text,
  rodopar_created_by          text,
  rodopar_updated_by          text,
  rodopar_updated_at          timestamp,
  drawing                     text,
  rubber                      text,
  raw                         jsonb not null default '{}'::jsonb,
  -- contexto HFM na data da fotografia (IDs oficiais + snapshot de exibição)
  vehicle_id                  uuid references public.vehicles (id) on delete restrict,
  vehicle_plate_snapshot      text,
  fleet_number_snapshot       text,
  vehicle_type_id             uuid,
  context_source              text,
  operation_id                uuid,
  operation_city_id           uuid,
  state_id                    smallint,
  city_id                     integer,
  operation_br_id             uuid,
  fidelization_assignment_id  uuid,
  leader_employee_id          uuid,
  organization_unit_id        uuid,
  enrichment_status           text not null default 'ok',
  quality_flags               text[] not null default '{}',
  data_quality_status         text not null default 'ok',
  created_at                  timestamptz not null default now(),
  constraint tire_daily_snapshots_org_id_key unique (organization_id, id),
  constraint tire_daily_snapshots_tire_ref_key unique (tire_id, reference_date),
  constraint tire_daily_snapshots_tire_fkey foreign key (organization_id, tire_id)
    references public.tires (organization_id, id) on delete restrict,
  constraint tire_daily_snapshots_batch_fkey foreign key (organization_id, import_batch_id)
    references public.tire_import_batches (organization_id, id) on delete restrict,
  constraint tire_daily_snapshots_status_check check (canonical_status in ('em_uso', 'estoque', 'ressolagem', 'descartado', 'baixado', 'outro')),
  constraint tire_daily_snapshots_enrichment_check check (enrichment_status in ('ok', 'sem_frota', 'frota_nao_encontrada', 'sem_contexto')),
  constraint tire_daily_snapshots_quality_check check (data_quality_status in ('ok', 'warning'))
);
comment on table public.tire_daily_snapshots is
  'Fotografia oficial: a situação de cada pneu na data de referência de uma importação Rodopar confirmada. Imutável depois de gravada; o contexto (operação, cidade, BR, liderança, filial, tipo) é o vigente na data — mudanças futuras não reclassificam o passado.';
create index if not exists tire_daily_snapshots_org_ref_idx on public.tire_daily_snapshots (organization_id, reference_date);
create index if not exists tire_daily_snapshots_vehicle_idx on public.tire_daily_snapshots (vehicle_id, reference_date) where vehicle_id is not null;
create index if not exists tire_daily_snapshots_status_idx on public.tire_daily_snapshots (organization_id, reference_date, canonical_status);
create index if not exists tire_daily_snapshots_operation_idx on public.tire_daily_snapshots (organization_id, reference_date, operation_id);
create index if not exists tire_daily_snapshots_br_idx on public.tire_daily_snapshots (organization_id, reference_date, operation_br_id);
create index if not exists tire_daily_snapshots_type_idx on public.tire_daily_snapshots (organization_id, reference_date, vehicle_type_id);
create index if not exists tire_daily_snapshots_measurement_idx on public.tire_daily_snapshots (organization_id, reference_date, measurement_date);
create index if not exists tire_daily_snapshots_calibration_idx on public.tire_daily_snapshots (organization_id, reference_date, calibration_date);
create index if not exists tire_daily_snapshots_fire_idx on public.tire_daily_snapshots (organization_id, fire_number);
create index if not exists tire_daily_snapshots_batch_idx on public.tire_daily_snapshots (import_batch_id);

-- -----------------------------------------------------------------------------
-- 9. Eventos do pneu (linha do tempo derivada da comparação entre fotografias)
-- -----------------------------------------------------------------------------
create table if not exists public.tire_events (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  tire_id                uuid not null,
  event_type             text not null,
  reference_date         date not null,
  occurred_at            timestamptz not null default now(),
  import_batch_id        uuid,
  snapshot_id            uuid,
  previous_values        jsonb not null default '{}'::jsonb,
  current_values         jsonb not null default '{}'::jsonb,
  vehicle_id             uuid,
  previous_vehicle_id    uuid,
  position_code          text,
  previous_position_code text,
  source                 text not null default 'rodopar_import',
  actor_user_id          uuid references auth.users (id) on delete set null,
  note                   text,
  constraint tire_events_tire_fkey foreign key (organization_id, tire_id)
    references public.tires (organization_id, id) on delete restrict,
  constraint tire_events_type_check check (event_type in (
    'TIRE_CREATED', 'TIRE_IMPORTED', 'TIRE_MOVED', 'TIRE_POSITION_CHANGED', 'TIRE_MEASURED',
    'TIRE_PRESSURE_UPDATED', 'TIRE_LIFE_CHANGED', 'TIRE_STATUS_CHANGED', 'TIRE_REMOVED',
    'TIRE_RETURNED_TO_STOCK', 'TIRE_SENT_TO_RETREAD', 'TIRE_DISCARDED', 'TIRE_ABSENT', 'TIRE_REAPPEARED')),
  constraint tire_events_source_check check (source in ('rodopar_import', 'system')),
  constraint tire_events_idem_key unique (tire_id, event_type, reference_date)
);
comment on table public.tire_events is
  'Eventos operacionais do pneu, gerados pela comparação de uma fotografia com a anterior (um por tipo, pneu e data — reimportar não duplica). Não há evento financeiro.';
create index if not exists tire_events_org_ref_idx on public.tire_events (organization_id, reference_date desc);
create index if not exists tire_events_tire_idx on public.tire_events (tire_id, reference_date desc);
create index if not exists tire_events_vehicle_idx on public.tire_events (vehicle_id) where vehicle_id is not null;

-- -----------------------------------------------------------------------------
-- 10. Vistoria de Pneus (leitura cega) — nunca altera a fotografia oficial
-- -----------------------------------------------------------------------------
create table if not exists public.tire_inspections (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id) on delete restrict,
  protocol                    text not null,
  client_submission_id        uuid not null,
  app_id                      uuid,
  parent_inspection_id        uuid,
  vehicle_id                  uuid not null references public.vehicles (id) on delete restrict,
  license_plate_snapshot      text not null,
  fleet_code_snapshot         text,
  vehicle_type_id             uuid,
  context_date                date not null,
  context_source              text,
  operation_id                uuid,
  operation_city_id           uuid,
  state_id                    smallint,
  city_id                     integer,
  operation_br_id             uuid,
  fidelization_assignment_id  uuid,
  organization_unit_id        uuid,
  leader_employee_id          uuid,
  operation_name_snapshot     text,
  city_name_snapshot          text,
  state_uf_snapshot           text,
  br_code_snapshot            text,
  unit_name_snapshot          text,
  leader_name_snapshot        text,
  vehicle_type_name_snapshot  text,
  inspector_user_id           uuid not null references auth.users (id) on delete restrict,
  inspector_employee_id       uuid,
  inspector_name_snapshot     text not null,
  inspector_code_snapshot     text,
  inspection_date             date not null,
  started_at                  timestamptz,
  inspected_at                timestamptz not null,
  submitted_at                timestamptz not null default now(),
  reference_snapshot_date     date,
  reference_batch_id          uuid,
  layout_source               text not null,
  layout_id                   uuid,
  positions_expected          integer not null default 0,
  positions_measured          integer not null default 0,
  positions_divergent         integer not null default 0,
  divergence_count            integer not null default 0,
  general_observation         text,
  status                      text not null default 'pendente_revisao',
  reviewed_by                 uuid references auth.users (id) on delete set null,
  reviewed_by_name            text,
  reviewed_at                 timestamptz,
  review_note                 text,
  approved_at                 timestamptz,
  synced_batch_id             uuid,
  synced_at                   timestamptz,
  sync_result                 jsonb not null default '{}'::jsonb,
  persistent_divergence       boolean not null default false,
  last_reconciled_batch_id    uuid,
  last_reconciled_at          timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint tire_inspections_org_id_key unique (organization_id, id),
  constraint tire_inspections_protocol_key unique (organization_id, protocol),
  constraint tire_inspections_submission_key unique (organization_id, client_submission_id),
  constraint tire_inspections_parent_fkey foreign key (organization_id, parent_inspection_id)
    references public.tire_inspections (organization_id, id) on delete restrict,
  constraint tire_inspections_status_check check (status in ('pendente_revisao', 'pendente_rodopar', 'sincronizado_rodopar', 'retornar_divergencia', 'substituida')),
  constraint tire_inspections_layout_check check (layout_source in ('vehicle', 'vehicle_type', 'inferred', 'snapshot')),
  constraint tire_inspections_obs_check check (general_observation is null or length(general_observation) <= 1000),
  constraint tire_inspections_review_check check (review_note is null or length(review_note) <= 1000)
);
comment on table public.tire_inspections is
  'Vistoria de Pneus feita em campo com leitura cega. Fica pendente de revisão; aprovada vira "pendente de lançamento no Rodopar" e só é sincronizada quando uma nova importação Rodopar trouxer os valores medidos.';
create index if not exists tire_inspections_org_status_idx on public.tire_inspections (organization_id, status, submitted_at desc);
create index if not exists tire_inspections_vehicle_idx on public.tire_inspections (vehicle_id, submitted_at desc);
create index if not exists tire_inspections_inspector_idx on public.tire_inspections (inspector_user_id, submitted_at desc);

create table if not exists public.tire_inspection_items (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  inspection_id           uuid not null,
  position_code           text not null,
  position_label_snapshot text,
  sort_order              smallint not null default 100,
  measured                boolean not null default false,
  fire_number_read        text,
  tread_1                 numeric(5,2),
  tread_2                 numeric(5,2),
  tread_3                 numeric(5,2),
  tread_4                 numeric(5,2),
  psi_read                numeric(6,2),
  observation             text,
  expected_tire_id        uuid,
  expected_fire_number    text,
  ref_snapshot_id         uuid,
  ref_tread_1             numeric(7,2),
  ref_tread_2             numeric(7,2),
  ref_tread_3             numeric(7,2),
  ref_tread_4             numeric(7,2),
  ref_tread_min           numeric(7,2),
  ref_psi                 numeric(7,2),
  ref_measurement_date    date,
  ref_calibration_date    date,
  divergences             jsonb not null default '[]'::jsonb,
  has_divergence          boolean not null default false,
  sync_status             text not null default 'pending',
  synced_snapshot_id      uuid,
  sync_note               text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tire_inspection_items_key unique (inspection_id, position_code),
  constraint tire_inspection_items_inspection_fkey foreign key (organization_id, inspection_id)
    references public.tire_inspections (organization_id, id) on delete restrict,
  constraint tire_inspection_items_tread_check check (coalesce(tread_1, 0) >= 0 and coalesce(tread_2, 0) >= 0 and coalesce(tread_3, 0) >= 0 and coalesce(tread_4, 0) >= 0),
  constraint tire_inspection_items_psi_check check (psi_read is null or psi_read >= 0),
  constraint tire_inspection_items_sync_check check (sync_status in ('pending', 'synced', 'persistent', 'not_applicable')),
  constraint tire_inspection_items_obs_check check (observation is null or length(observation) <= 500)
);
create index if not exists tire_inspection_items_inspection_idx on public.tire_inspection_items (inspection_id, sort_order);

create table if not exists public.tire_inspection_status_history (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  inspection_id    uuid not null,
  from_status      text,
  to_status        text not null,
  reason           text,
  source           text not null default 'user',
  import_batch_id  uuid,
  actor_user_id    uuid references auth.users (id) on delete set null,
  actor_name       text,
  created_at       timestamptz not null default now(),
  constraint tire_inspection_status_history_fkey foreign key (organization_id, inspection_id)
    references public.tire_inspections (organization_id, id) on delete restrict,
  constraint tire_inspection_status_history_source_check check (source in ('user', 'import', 'system'))
);
create index if not exists tire_inspection_status_history_idx on public.tire_inspection_status_history (inspection_id, created_at);

-- -----------------------------------------------------------------------------
-- 11. Consertos por Nº Fogo (sem valor: a gestão financeira de pneus é etapa futura)
-- -----------------------------------------------------------------------------
create table if not exists public.tire_repairs (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  tire_id                   uuid not null,
  fire_number_snapshot      text not null,
  service_date              date not null,
  repair_type               text not null,
  service_id                uuid,
  supplier_id               uuid,
  supplier_name_snapshot    text,
  service_order_number      text,
  notes                     text,
  vehicle_id                uuid references public.vehicles (id) on delete restrict,
  license_plate_snapshot    text,
  fleet_code_snapshot       text,
  position_code_snapshot    text,
  vehicle_resolution        text not null,
  resolution_reference_date date,
  resolution_confidence     text,
  override_reason           text,
  status                    text not null default 'active',
  void_reason               text,
  voided_by                 uuid references auth.users (id) on delete set null,
  voided_at                 timestamptz,
  created_by                uuid references auth.users (id) on delete set null,
  created_by_name           text,
  created_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null,
  updated_at                timestamptz not null default now(),
  constraint tire_repairs_tire_fkey foreign key (organization_id, tire_id)
    references public.tires (organization_id, id) on delete restrict,
  constraint tire_repairs_type_check check (length(btrim(repair_type)) between 2 and 80),
  constraint tire_repairs_resolution_check check (vehicle_resolution in ('snapshot_exact', 'snapshot_previous', 'event', 'manual', 'unresolved')),
  constraint tire_repairs_confidence_check check (resolution_confidence is null or resolution_confidence in ('high', 'medium', 'low', 'manual')),
  constraint tire_repairs_status_check check (status in ('active', 'voided')),
  constraint tire_repairs_text_check check ((notes is null or length(notes) <= 1000) and (service_order_number is null or length(service_order_number) <= 60)
    and (override_reason is null or length(override_reason) <= 300) and (void_reason is null or length(void_reason) <= 300))
);
create index if not exists tire_repairs_tire_idx on public.tire_repairs (tire_id, service_date desc);
create index if not exists tire_repairs_org_date_idx on public.tire_repairs (organization_id, service_date desc);

-- -----------------------------------------------------------------------------
-- 12. Serviços da Manutenção exibidos em Pneus (alinhamento, balanceamento,
--     serviços de pneu) — mapeamento configurável, nenhuma base paralela
-- -----------------------------------------------------------------------------
create table if not exists public.tire_maintenance_service_kinds (
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  service_id       uuid not null,
  kind             text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  primary key (organization_id, service_id),
  constraint tire_maintenance_service_kinds_service_fkey foreign key (organization_id, service_id)
    references public.maintenance_services (organization_id, id) on delete restrict,
  constraint tire_maintenance_service_kinds_kind_check check (kind in ('alignment', 'balancing', 'alignment_balancing', 'tire_service'))
);

-- -----------------------------------------------------------------------------
-- 13. Auditoria administrativa (parâmetros, layouts, importação, decisões, exportação)
-- -----------------------------------------------------------------------------
create table if not exists public.tire_audit_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  action           text not null,
  entity_type      text not null,
  entity_id        uuid,
  summary          text,
  previous_values  jsonb,
  current_values   jsonb,
  actor_user_id    uuid references auth.users (id) on delete set null,
  actor_name       text,
  created_at       timestamptz not null default now(),
  constraint tire_audit_events_action_check check (length(action) between 3 and 60)
);
create index if not exists tire_audit_events_org_idx on public.tire_audit_events (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 14. Gatilhos: carimbos, tenant imutável e trilhas somente-inserção
-- -----------------------------------------------------------------------------
do $trg$
declare t text;
begin
  foreach t in array array['tire_parameter_sets', 'tire_pressure_rules', 'tire_positions', 'tire_layouts',
                           'tire_vehicle_type_layouts', 'tire_vehicle_layouts', 'tire_import_batches',
                           'tires', 'tire_inspections', 'tire_inspection_items', 'tire_repairs',
                           'tire_maintenance_service_kinds'] loop
    execute format('create or replace trigger %1$s_stamps before insert or update on public.%1$s for each row execute function private.tg_set_stamps()', t);
  end loop;
  foreach t in array array['tire_parameter_sets', 'tire_pressure_rules', 'tire_positions', 'tire_layouts',
                           'tire_vehicle_type_layouts', 'tire_vehicle_layouts', 'tire_import_batches', 'tire_import_staging',
                           'tires', 'tire_daily_snapshots', 'tire_events', 'tire_inspections', 'tire_inspection_items',
                           'tire_inspection_status_history', 'tire_repairs', 'tire_maintenance_service_kinds', 'tire_audit_events'] loop
    execute format('create or replace trigger %1$s_prevent_tenant_change before update on public.%1$s for each row execute function private.tg_prevent_tenant_change()', t);
  end loop;
  foreach t in array array['tire_daily_snapshots', 'tire_events', 'tire_inspection_status_history', 'tire_audit_events'] loop
    execute format('create or replace trigger %1$s_append_only before update on public.%1$s for each row execute function private.tg_block_mutation()', t);
  end loop;
end $trg$;

-- -----------------------------------------------------------------------------
-- 15. RLS — leitura por permissão + escopo de veículo; escrita só por RPC
-- -----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['tire_parameter_sets', 'tire_pressure_rules', 'tire_positions', 'tire_layouts',
                           'tire_vehicle_type_layouts', 'tire_vehicle_layouts', 'tire_import_batches', 'tire_import_staging',
                           'tires', 'tire_daily_snapshots', 'tire_events', 'tire_inspections', 'tire_inspection_items',
                           'tire_inspection_status_history', 'tire_repairs', 'tire_maintenance_service_kinds', 'tire_audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $rls$;

-- Visibilidade de pneus: quem tem o módulo e enxerga a organização inteira
-- (operations.access_all) vê tudo, inclusive estoque/ressolagem/descarte; quem
-- tem escopo por operação vê os pneus montados nos veículos do seu escopo.
create or replace function private.tire_vehicle_visible(p_organization_id uuid, p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_platform_admin())
      or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
      or (p_vehicle_id is not null and p_vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id)));
$$;
revoke execute on function private.tire_vehicle_visible(uuid, uuid) from public, anon;
grant execute on function private.tire_vehicle_visible(uuid, uuid) to authenticated, service_role;

do $pol$ begin
  -- configuração: quem vê o módulo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_parameter_sets' and policyname = 'tire_parameter_sets_select') then
    create policy tire_parameter_sets_select on public.tire_parameter_sets for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_pressure_rules' and policyname = 'tire_pressure_rules_select') then
    create policy tire_pressure_rules_select on public.tire_pressure_rules for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_positions' and policyname = 'tire_positions_select') then
    create policy tire_positions_select on public.tire_positions for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view'))
          or organization_id in (select private.permitted_org_ids('applications.tires.execute')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_layouts' and policyname = 'tire_layouts_select') then
    create policy tire_layouts_select on public.tire_layouts for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_vehicle_type_layouts' and policyname = 'tire_vehicle_type_layouts_select') then
    create policy tire_vehicle_type_layouts_select on public.tire_vehicle_type_layouts for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_vehicle_layouts' and policyname = 'tire_vehicle_layouts_select') then
    create policy tire_vehicle_layouts_select on public.tire_vehicle_layouts for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_maintenance_service_kinds' and policyname = 'tire_maintenance_service_kinds_select') then
    create policy tire_maintenance_service_kinds_select on public.tire_maintenance_service_kinds for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view')));
  end if;
  -- importação: quem importa ou audita
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_import_batches' and policyname = 'tire_import_batches_select') then
    create policy tire_import_batches_select on public.tire_import_batches for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.import'))
          or organization_id in (select private.permitted_org_ids('tires.audit.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_import_staging' and policyname = 'tire_import_staging_select') then
    create policy tire_import_staging_select on public.tire_import_staging for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.import')));
  end if;
  -- base oficial: módulo + escopo de veículo
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tires' and policyname = 'tires_select') then
    create policy tires_select on public.tires for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view'))
             and private.tire_vehicle_visible(organization_id, current_vehicle_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_daily_snapshots' and policyname = 'tire_daily_snapshots_select') then
    create policy tire_daily_snapshots_select on public.tire_daily_snapshots for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.view'))
             and private.tire_vehicle_visible(organization_id, vehicle_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_events' and policyname = 'tire_events_select') then
    create policy tire_events_select on public.tire_events for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.history.view'))
             and tire_id in (select t.id from public.tires t));
  end if;
  -- vistorias: escopo do módulo OU as próprias vistorias de quem executa o app
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_inspections' and policyname = 'tire_inspections_select') then
    create policy tire_inspections_select on public.tire_inspections for select to authenticated
      using ((organization_id in (select private.permitted_org_ids('tires.view'))
              and private.tire_vehicle_visible(organization_id, vehicle_id))
          or (organization_id in (select private.permitted_org_ids('applications.tires.execute'))
              and inspector_user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_inspection_items' and policyname = 'tire_inspection_items_select') then
    create policy tire_inspection_items_select on public.tire_inspection_items for select to authenticated
      using (inspection_id in (select i.id from public.tire_inspections i
                                where i.organization_id in (select private.permitted_org_ids('tires.view'))
                                  and private.tire_vehicle_visible(i.organization_id, i.vehicle_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_inspection_status_history' and policyname = 'tire_inspection_status_history_select') then
    create policy tire_inspection_status_history_select on public.tire_inspection_status_history for select to authenticated
      using (inspection_id in (select i.id from public.tire_inspections i));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_repairs' and policyname = 'tire_repairs_select') then
    create policy tire_repairs_select on public.tire_repairs for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.services.view'))
             and private.tire_vehicle_visible(organization_id, vehicle_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_audit_events' and policyname = 'tire_audit_events_select') then
    create policy tire_audit_events_select on public.tire_audit_events for select to authenticated
      using (organization_id in (select private.permitted_org_ids('tires.audit.view')));
  end if;
end $pol$;

-- -----------------------------------------------------------------------------
-- 16. Aplicativo "Vistoria de Pneus" (mesma arquitetura de elegibilidade dos
--     Aplicativos: operações e tipos de equipamento habilitados). Os vínculos
--     iniciais espelham o Check List de Frota e são ajustáveis em Operações e
--     Tipos de Equipamento › Aplicativos habilitados.
-- -----------------------------------------------------------------------------
do $app$
declare o record; v_app uuid; v_src uuid; n_ops integer; n_types integer;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active' loop
    insert into public.operational_apps
      (organization_id, code, name, slug, description, platform, is_active, is_official, is_configurable, allows_attachments)
    values (o.id, 'vistoria_pneus', 'Vistoria de Pneus', 'vistoria-pneus',
            'Vistoria cega dos pneus em campo (Nº Fogo, sulcos e PSI por posição), comparada no servidor com a fotografia oficial do Rodopar.',
            'mobile_responsive', true, true, false, false)
    on conflict (organization_id, code) do update
      set slug = excluded.slug, name = excluded.name, description = excluded.description,
          is_active = true, deleted_at = null, updated_at = now()
    returning id into v_app;

    select a.id into v_src from public.operational_apps a
     where a.organization_id = o.id and a.code = 'checklist_frota' and a.deleted_at is null;
    n_ops := 0; n_types := 0;
    if v_src is not null then
      insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled, effective_from, effective_to)
      select o.id, v_app, l.operation_id, l.is_enabled, l.effective_from, l.effective_to
        from public.checklist_app_operations l where l.app_id = v_src
      on conflict (app_id, operation_id) do nothing;
      get diagnostics n_ops = row_count;
      insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled, effective_from, effective_to)
      select o.id, l.vehicle_type_id, v_app, l.is_enabled, l.effective_from, l.effective_to
        from public.vehicle_type_apps l where l.app_id = v_src
      on conflict (organization_id, vehicle_type_id, app_id) do nothing;
      get diagnostics n_types = row_count;
    end if;
    raise notice 'Vistoria de Pneus em %: % vínculos de operação e % de tipo espelhados do Check List de Frota', o.name, n_ops, n_types;
  end loop;
end $app$;

-- -----------------------------------------------------------------------------
-- 17. Sementes por organização (dados editáveis em Parâmetros — nada fixo no código)
--   * parâmetros gerais = valores vigentes no HFC (Gestão de Pneus) em 06/10/2026
--   * regras de PSI = as 6 regras cadastradas e ativas no HFC na mesma data
--   * posições = os 13 códigos presentes no Rodopar 10; rótulos derivados da
--     convenção do código (E=eixo, D/T=dianteiro/traseiro, E/D=lado,
--     E/I=externo/interno, dígito=eixo) e ajustáveis
--   * layouts = as 3 configurações observadas; padrão por tipo só onde há uma
--     configuração única (Van, Frota Leve OPE, Frota Leve ADM); Caminhão fica
--     sem padrão (há frotas com 1 e com 2 eixos traseiros duplos)
--   * serviços da Manutenção: alinhamento/balanceamento pelo nome e serviços do
--     cluster de Pneus
-- -----------------------------------------------------------------------------
do $seed$
declare
  o record; v_today date; v_layout uuid; v_type uuid;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active' loop
    v_today := private.maintenance_today(o.id);

    insert into public.tire_parameter_sets (organization_id, effective_from, note)
    select o.id, v_today, 'Parâmetros iniciais = vigentes no HFC (medição e calibragem em dia até 20 dias, próximo até 25; sulco crítico 3 mm, atenção 5 mm; limites 30 mm e 200 PSI; tolerância de data futura 1 dia).'
     where not exists (select 1 from public.tire_parameter_sets p where p.organization_id = o.id);

    if not exists (select 1 from public.tire_pressure_rules r where r.organization_id = o.id) then
      insert into public.tire_pressure_rules
        (organization_id, dimension, dimension_key, min_psi, ideal_psi, max_psi, min_legal_tread_mm, attention_tread_mm, valid_from, notes)
      values
        (o.id, '175/70 R14',   private.tire_dimension_key('175/70 R14'),    30,  35,  40, 1.6, 2,    v_today, 'Regra vigente no HFC em 06/10/2026.'),
        (o.id, '175/65 R14',   private.tire_dimension_key('175/65 R14'),    30,  35,  40, 1.6, 2,    v_today, 'Regra vigente no HFC em 06/10/2026.'),
        (o.id, '205/75 R16',   private.tire_dimension_key('205/75 R16'),    65,  70,  75, 2,   2.75, v_today, 'Regra vigente no HFC em 06/10/2026.'),
        (o.id, '225/65 R16',   private.tire_dimension_key('225/65 R16'),    65,  70,  75, 2,   2.75, v_today, 'Regra vigente no HFC em 06/10/2026.'),
        (o.id, '225/75 R16',   private.tire_dimension_key('225/75 R16'),    65,  70,  75, 2,   2.75, v_today, 'Regra vigente no HFC em 06/10/2026.'),
        (o.id, '275/80 R22.5', private.tire_dimension_key('275/80 R22.5'), 105, 110, 115, 2.2, 3,    v_today, 'Regra vigente no HFC em 06/10/2026.');
    end if;

    insert into public.tire_positions (organization_id, code, label, axle_group, axle_index, side, slot, sort_order) values
      (o.id, 'EDE',    'Dianteiro esquerdo',                 'front', 1, 'left',   'single', 10),
      (o.id, 'EDD',    'Dianteiro direito',                  'front', 1, 'right',  'single', 11),
      (o.id, 'ETE',    'Traseiro esquerdo',                  'rear',  2, 'left',   'single', 20),
      (o.id, 'ETD',    'Traseiro direito',                   'rear',  2, 'right',  'single', 21),
      (o.id, 'ETEE3',  'Traseiro esquerdo externo (eixo 3)', 'rear',  3, 'left',   'outer',  30),
      (o.id, 'ETEI3',  'Traseiro esquerdo interno (eixo 3)', 'rear',  3, 'left',   'inner',  31),
      (o.id, 'ETDI3',  'Traseiro direito interno (eixo 3)',  'rear',  3, 'right',  'inner',  32),
      (o.id, 'ETDE3',  'Traseiro direito externo (eixo 3)',  'rear',  3, 'right',  'outer',  33),
      (o.id, 'ETEE4',  'Traseiro esquerdo externo (eixo 4)', 'rear',  4, 'left',   'outer',  40),
      (o.id, 'ETEI4',  'Traseiro esquerdo interno (eixo 4)', 'rear',  4, 'left',   'inner',  41),
      (o.id, 'ETDI4',  'Traseiro direito interno (eixo 4)',  'rear',  4, 'right',  'inner',  42),
      (o.id, 'ETDE4',  'Traseiro direito externo (eixo 4)',  'rear',  4, 'right',  'outer',  43),
      (o.id, 'ESTEP1', 'Estepe',                             'spare', 1, 'center', 'single', 90)
    on conflict (organization_id, code) do nothing;

    insert into public.tire_layouts (organization_id, code, name, description, position_codes) values
      (o.id, 'leve_2_eixos', 'Leve · 2 eixos simples + estepe', 'Vans e utilitários: dianteiro e traseiro simples.',
       array['EDE', 'EDD', 'ETE', 'ETD', 'ESTEP1']),
      (o.id, 'caminhao_1_traseiro_duplo', 'Caminhão · 1 eixo traseiro duplo + estepe', 'Dianteiro simples e um eixo traseiro com rodado duplo.',
       array['EDE', 'EDD', 'ETEE4', 'ETEI4', 'ETDI4', 'ETDE4', 'ESTEP1']),
      (o.id, 'caminhao_2_traseiros_duplos', 'Caminhão · 2 eixos traseiros duplos + estepe', 'Dianteiro simples e dois eixos traseiros com rodado duplo.',
       array['EDE', 'EDD', 'ETEE3', 'ETEI3', 'ETDI3', 'ETDE3', 'ETEE4', 'ETEI4', 'ETDI4', 'ETDE4', 'ESTEP1'])
    on conflict (organization_id, code) do nothing;

    select id into v_layout from public.tire_layouts where organization_id = o.id and code = 'leve_2_eixos';
    for v_type in select vt.id from public.vehicle_types vt
                   where vt.code in ('van', 'utility', 'car')
                     and (vt.organization_id = o.id or vt.organization_id is null) loop
      insert into public.tire_vehicle_type_layouts (organization_id, vehicle_type_id, layout_id)
      values (o.id, v_type, v_layout)
      on conflict (organization_id, vehicle_type_id) do nothing;
    end loop;

    insert into public.tire_maintenance_service_kinds (organization_id, service_id, kind)
    select s.organization_id, s.id,
           case when private.normalize_label(s.name) like '%alinhamento%' and private.normalize_label(s.name) like '%balanceamento%' then 'alignment_balancing'
                when private.normalize_label(s.name) like '%alinhamento%' then 'alignment'
                when private.normalize_label(s.name) like '%balanceamento%' then 'balancing'
                else 'tire_service' end
      from public.maintenance_services s
      left join public.maintenance_clusters c on c.id = s.cluster_id
     where s.organization_id = o.id and s.deleted_at is null
       and (private.normalize_label(s.name) like '%alinhamento%'
            or private.normalize_label(s.name) like '%balanceamento%'
            or private.normalize_label(c.name) ~ '(^| )pneus?( |$)')
    on conflict (organization_id, service_id) do nothing;
  end loop;
end $seed$;
