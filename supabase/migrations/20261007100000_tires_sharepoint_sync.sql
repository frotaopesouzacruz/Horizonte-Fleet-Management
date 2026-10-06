-- =============================================================================
-- Gestão de Pneus — fonte oficial no SharePoint (sincronização automática)
--
-- A planilha "Base Geral Pneus Rodorpar.xlsx" (SharePoint do Horizonte Fleet
-- Management, pasta Gestão de Pneus) passa a ser a fonte operacional oficial.
-- O HFM busca o arquivo pela Microsoft Graph (aplicativo registrado no Entra
-- ID, credenciais de aplicativo só no servidor — nunca a URL pública da
-- interface), e o envia pelo MESMO pipeline da importação manual
-- (tire_import_start → stage → validate → confirm). Esta migration traz:
--
--   1. Contexto de integração: `private.tire_require` aceita o contexto
--      privilegiado (service_role / rotina do banco) e `tire_actor_name`
--      identifica a integração como autora quando não há pessoa.
--   2. Lotes com origem (`upload` | `sharepoint`), vínculo com a execução de
--      sincronização e REVISÃO DO MESMO DIA: quando a planilha muda de novo na
--      mesma data de referência, um novo lote substitui o anterior
--      (`superseded`) — nada é apagado:
--        * cada linha alterada dos dados do dia é arquivada por gatilho em
--          `tire_snapshot_revisions` (linha completa) antes da atualização;
--        * pneu que saiu da planilha na revisão fica com a linha do dia
--          marcada `removed_in_revision` (arquivada) e passa a ausente;
--        * datas anteriores nunca são tocadas.
--   3. `tire_sync_sources` (local do arquivo, sem segredo) e `tire_sync_runs`
--      (status, etapa, arquivo, contadores, estrutura, falhas e log), com
--      trava contra execução simultânea, expiração de execução presa,
--      intervalo mínimo e reprocessamento controlado.
--   4. Leitura e importação ajustadas à revisão (fonte única das telas segue
--      `private.tire_rows`).
--
-- Aditiva: nenhuma tabela é recriada, nenhum dado é apagado. A única
-- constraint substituída é a de situação do lote (ganha `superseded`), e o
-- gatilho somente-inserção dos dados diários passa a permitir exclusivamente a
-- revisão do mesmo dia, arquivando a versão anterior.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contexto de integração
-- -----------------------------------------------------------------------------
create or replace function private.tire_require(p_organization_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  -- service_role (servidor do HFM: sincronização agendada) e rotinas do banco
  if private.is_privileged_context() then
    if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
      raise exception 'Organização inexistente.' using errcode = 'no_data_found';
    end if;
    return;
  end if;
  if not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function private.tire_actor_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.employee_name from private.checklist_actor(p_organization_id) a where auth.uid() is not null limit 1),
    (select u.email from auth.users u where u.id = auth.uid()),
    case when auth.uid() is null and private.is_privileged_context()
         then coalesce(nullif(current_setting('hfm.tire_actor', true), ''), 'Sincronização automática (SharePoint)') end,
    'Usuário autenticado');
$$;

-- -----------------------------------------------------------------------------
-- 2. Lotes: origem e revisão do mesmo dia
-- -----------------------------------------------------------------------------
alter table public.tire_import_batches
  add column if not exists source_kind text not null default 'upload',
  add column if not exists sync_run_id uuid,
  add column if not exists supersedes_batch_id uuid,
  add column if not exists superseded_by_batch_id uuid,
  add column if not exists superseded_at timestamptz;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'tire_import_batches_source_check') then
    alter table public.tire_import_batches
      add constraint tire_import_batches_source_check check (source_kind in ('upload', 'sharepoint'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tire_import_batches_supersedes_fkey') then
    alter table public.tire_import_batches
      add constraint tire_import_batches_supersedes_fkey foreign key (supersedes_batch_id)
      references public.tire_import_batches (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tire_import_batches_superseded_by_fkey') then
    alter table public.tire_import_batches
      add constraint tire_import_batches_superseded_by_fkey foreign key (superseded_by_batch_id)
      references public.tire_import_batches (id) on delete restrict;
  end if;
end $c$;

-- a situação ganha `superseded` (versão do dia substituída por uma revisão)
alter table public.tire_import_batches drop constraint if exists tire_import_batches_status_check;
alter table public.tire_import_batches add constraint tire_import_batches_status_check
  check (status in ('staging', 'validated', 'blocked', 'confirmed', 'cancelled', 'superseded'));

create index if not exists tire_import_batches_sync_run_idx on public.tire_import_batches (sync_run_id) where sync_run_id is not null;

comment on column public.tire_import_batches.source_kind is
  'Origem do arquivo: upload (envio manual pela tela, contingência) ou sharepoint (sincronização automática da fonte oficial).';
comment on column public.tire_import_batches.supersedes_batch_id is
  'Revisão do mesmo dia: lote confirmado da mesma data de referência que este substitui (que passa a superseded).';

-- -----------------------------------------------------------------------------
-- 3. Revisões dos dados do dia (nunca se perde uma versão)
-- -----------------------------------------------------------------------------
alter table public.tire_daily_snapshots
  add column if not exists revision smallint not null default 1,
  add column if not exists revised_at timestamptz,
  add column if not exists removed_in_revision boolean not null default false;

comment on column public.tire_daily_snapshots.removed_in_revision is
  'O pneu saiu da planilha numa revisão do mesmo dia: a linha fica (arquivada em tire_snapshot_revisions) e deixa de ser lida como situação da data.';

create table if not exists public.tire_snapshot_revisions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  snapshot_id            uuid not null,
  tire_id                uuid not null,
  reference_date         date not null,
  import_batch_id        uuid not null,
  revision               smallint not null,
  reason                 text not null,
  row_data               jsonb not null,
  superseded_by_batch_id uuid not null,
  archived_at            timestamptz not null default now(),
  constraint tire_snapshot_revisions_reason_check check (reason in ('updated', 'removed'))
);
comment on table public.tire_snapshot_revisions is
  'Versões anteriores dos dados diários de pneus substituídas por uma revisão do mesmo dia (linha completa). Somente inserção.';
create index if not exists tire_snapshot_revisions_snapshot_idx on public.tire_snapshot_revisions (snapshot_id, revision);
create index if not exists tire_snapshot_revisions_org_ref_idx on public.tire_snapshot_revisions (organization_id, reference_date desc);

-- O gatilho somente-inserção passa a aceitar UMA forma de atualização: a
-- revisão do mesmo dia feita pela confirmação do lote (GUC local com o id do
-- lote), e sempre arquivando a versão anterior. Todo o resto segue bloqueado.
create or replace function private.tg_tire_snapshot_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_batch text := coalesce(current_setting('hfm.tire_snapshot_revision', true), '');
begin
  if current_setting('hfm.allow_purge', true) = 'on' and private.is_privileged_context() then
    return new;
  end if;
  if v_batch = ''
     or not (new.import_batch_id::text = v_batch
             or (new.removed_in_revision and not old.removed_in_revision and new.import_batch_id = old.import_batch_id)) then
    raise exception '%.% is append-only (% not allowed)', tg_table_schema, tg_table_name, tg_op
      using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.tire_id <> old.tire_id or new.reference_date <> old.reference_date
     or new.organization_id <> old.organization_id then
    raise exception 'A revisão do dia não muda pneu, data nem organização.' using errcode = 'check_violation';
  end if;
  insert into public.tire_snapshot_revisions (organization_id, snapshot_id, tire_id, reference_date, import_batch_id,
                                              revision, reason, row_data, superseded_by_batch_id)
  values (old.organization_id, old.id, old.tire_id, old.reference_date, old.import_batch_id, old.revision,
          case when new.removed_in_revision and not old.removed_in_revision then 'removed' else 'updated' end,
          to_jsonb(old), v_batch::uuid);
  new.revision := old.revision + 1;
  new.revised_at := now();
  return new;
end;
$$;

create or replace trigger tire_daily_snapshots_append_only
  before update on public.tire_daily_snapshots
  for each row execute function private.tg_tire_snapshot_revision();

create or replace trigger tire_snapshot_revisions_append_only
  before update on public.tire_snapshot_revisions
  for each row execute function private.tg_block_mutation();
create or replace trigger tire_snapshot_revisions_prevent_tenant_change
  before update on public.tire_snapshot_revisions
  for each row execute function private.tg_prevent_tenant_change();

-- -----------------------------------------------------------------------------
-- 4. Fonte oficial e execuções de sincronização
-- -----------------------------------------------------------------------------
create table if not exists public.tire_sync_sources (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  code                  text not null default 'rodopar_sharepoint',
  name                  text not null default 'Base Geral Pneus Rodopar (SharePoint)',
  provider              text not null default 'microsoft_graph',
  site_hostname         text not null,
  site_path             text not null,
  drive_name            text not null,
  file_path             text not null,
  web_url               text,
  is_active             boolean not null default true,
  min_interval_minutes  integer not null default 60,
  schedule_label        text not null default 'Diária, às 21h (horário de Brasília)',
  resolved_site_id      text,
  resolved_drive_id     text,
  resolved_item_id      text,
  last_etag             text,
  last_ctag             text,
  last_file_modified_at timestamptz,
  last_file_hash        text,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_change_at        timestamptz,
  last_status           text,
  last_error            text,
  last_run_id           uuid,
  consecutive_failures  integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  updated_by            uuid references auth.users (id) on delete set null,
  constraint tire_sync_sources_org_code_key unique (organization_id, code),
  constraint tire_sync_sources_provider_check check (provider in ('microsoft_graph')),
  constraint tire_sync_sources_host_check check (site_hostname ~ '^[a-z0-9-]+\.sharepoint\.com$'),
  constraint tire_sync_sources_path_check check (site_path ~ '^/sites/[^/]+$' and length(file_path) between 5 and 400
                                                 and file_path ~* '\.xlsx$' and length(drive_name) between 1 and 120),
  constraint tire_sync_sources_interval_check check (min_interval_minutes between 5 and 10080)
);
comment on table public.tire_sync_sources is
  'Fonte oficial dos pneus no SharePoint (site, biblioteca e caminho do arquivo). Sem segredo: as credenciais do aplicativo ficam só nas variáveis do servidor.';

create table if not exists public.tire_sync_runs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  source_id           uuid not null references public.tire_sync_sources (id) on delete restrict,
  trigger             text not null,
  status              text not null default 'em_andamento',
  step                text not null default 'conectando',
  requested_by        uuid references auth.users (id) on delete set null,
  requested_by_name   text,
  reprocess_of        uuid references public.tire_sync_runs (id) on delete restrict,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  file_name           text,
  file_web_url        text,
  file_etag           text,
  file_ctag           text,
  file_last_modified  timestamptz,
  file_size           bigint,
  file_hash           text,
  reference_date      date,
  batch_id            uuid references public.tire_import_batches (id) on delete restrict,
  same_day_revision   boolean not null default false,
  structure           jsonb not null default '{}'::jsonb,
  counters            jsonb not null default '{}'::jsonb,
  error_code          text,
  error_message       text,
  log                 jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tire_sync_runs_trigger_check check (trigger in ('agendada', 'manual', 'reprocessamento')),
  constraint tire_sync_runs_status_check check (status in ('em_andamento', 'concluida', 'concluida_com_avisos', 'sem_alteracao', 'bloqueada', 'falhou')),
  constraint tire_sync_runs_step_check check (step in ('conectando', 'localizando', 'baixando', 'lendo', 'validando_estrutura',
                                                       'enviando', 'validando', 'confirmando', 'finalizado')),
  constraint tire_sync_runs_hash_check check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  constraint tire_sync_runs_error_check check (error_message is null or length(error_message) <= 1000)
);
comment on table public.tire_sync_runs is
  'Cada execução da sincronização com a fonte oficial: quem/quando disparou, arquivo lido (eTag, hash, data), estrutura, contadores, resultado, falha e log por etapa.';
create unique index if not exists tire_sync_runs_running_uidx on public.tire_sync_runs (source_id) where status = 'em_andamento';
create index if not exists tire_sync_runs_org_started_idx on public.tire_sync_runs (organization_id, started_at desc);

do $trg$
declare t text;
begin
  foreach t in array array['tire_sync_sources', 'tire_sync_runs'] loop
    execute format('create or replace trigger %1$s_stamps before insert or update on public.%1$s for each row execute function private.tg_set_stamps()', t);
    execute format('create or replace trigger %1$s_prevent_tenant_change before update on public.%1$s for each row execute function private.tg_prevent_tenant_change()', t);
  end loop;
  foreach t in array array['tire_sync_sources', 'tire_sync_runs', 'tire_snapshot_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $trg$;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_sync_sources' and policyname = 'tire_sync_sources_select') then
    create policy tire_sync_sources_select on public.tire_sync_sources for select to authenticated
      using (private.has_permission(organization_id, 'tires.import') or private.has_permission(organization_id, 'tires.audit.view')
             or private.has_permission(organization_id, 'tires.parameters.manage'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_sync_runs' and policyname = 'tire_sync_runs_select') then
    create policy tire_sync_runs_select on public.tire_sync_runs for select to authenticated
      using (private.has_permission(organization_id, 'tires.import') or private.has_permission(organization_id, 'tires.audit.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_snapshot_revisions' and policyname = 'tire_snapshot_revisions_select') then
    create policy tire_snapshot_revisions_select on public.tire_snapshot_revisions for select to authenticated
      using (private.has_permission(organization_id, 'tires.audit.view') or private.has_permission(organization_id, 'tires.import'));
  end if;
end $pol$;

-- A fonte oficial informada pela operação (uma por organização com o módulo).
insert into public.tire_sync_sources (organization_id, site_hostname, site_path, drive_name, file_path, web_url)
select p.organization_id, 'grupohorizonte.sharepoint.com', '/sites/HorizonteFleetManagement', 'Documentos Compartilhados',
       'Gestão de Pneus/Base Geral Pneus Rodorpar.xlsx',
       'https://grupohorizonte.sharepoint.com/sites/HorizonteFleetManagement/Documentos%20Compartilhados/Gest%C3%A3o%20de%20Pneus/Base%20Geral%20Pneus%20Rodorpar.xlsx'
  from (select distinct organization_id from public.tire_parameter_sets) p
on conflict (organization_id, code) do nothing;

-- Gancho pós-confirmação (auditoria dos dados e afins ligam-se aqui).
create or replace function private.tire_after_confirm(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;
revoke execute on function private.tire_after_confirm(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Leitura: linhas removidas numa revisão do dia não são situação da data;
--    rotinas do banco (captura de indicadores) leem a organização inteira
-- -----------------------------------------------------------------------------
create or replace function private.tire_rows(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_as_of date default null)
returns table (
  snapshot_id uuid, tire_id uuid, fire_number text, reference_date date, import_batch_id uuid,
  canonical_status text, rodopar_status_raw text, rodopar_status_label text, rodopar_condition text,
  brand text, model text, dimension text, dimension_key text, serial_number text, dot text, drawing text, rubber text,
  life smallint, position_code text, position_label text, position_sort smallint, axle_group text,
  vehicle_id uuid, license_plate text, fleet_number text, fleet_number_raw text, vehicle_type_id uuid, vehicle_type_name text,
  context_source text, operation_id uuid, operation_name text, operation_city_id uuid,
  state_id smallint, state_uf text, city_id integer, city_name text,
  operation_br_id uuid, br_code text, leader_employee_id uuid, leader_name text,
  organization_unit_id uuid, unit_name text, enrichment_status text,
  tread_1 numeric, tread_2 numeric, tread_3 numeric, tread_4 numeric,
  tread_min_raw numeric, tread_min_calculated numeric, tread_min numeric, tread_divergence boolean,
  tread_class text, legal_tread_mm numeric,
  measurement_date date, measurement_days integer, measurement_status text, measurement_due_date date,
  psi numeric, calibration_date date, calibration_days integer, calibration_status text, calibration_due_date date,
  pressure_rule_id uuid, psi_min numeric, psi_ideal numeric, psi_max numeric, psi_status text,
  km_rodado bigint, km_real bigint, rodopar_updated_at timestamp, stale_days integer,
  retread_alert boolean, quality_flags text[], severity_score integer, severity text, as_of date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f          jsonb := coalesce(p_filters, '{}'::jsonb);
  v_ref      date := coalesce(nullif(f ->> 'reference_date', '')::date, private.tire_latest_reference(p_organization_id));
  v_as_of    date := coalesce(p_as_of, private.maintenance_today(p_organization_id));
  p          public.tire_parameter_sets;
  f_search   text := nullif(btrim(f ->> 'search'), '');
  f_status   text[] := private.jsonb_text_array(f -> 'statuses');
  f_ops      uuid[] := private.km_uuid_array(f -> 'operation_ids');
  f_states   integer[] := private.km_int_array(f -> 'state_ids');
  f_cities   integer[] := private.km_int_array(f -> 'city_ids');
  f_brs      uuid[] := private.km_uuid_array(f -> 'br_ids');
  f_leaders  uuid[] := private.km_uuid_array(f -> 'leader_ids');
  f_units    uuid[] := private.km_uuid_array(f -> 'unit_ids');
  f_types    uuid[] := private.km_uuid_array(f -> 'vehicle_type_ids');
  f_vehicles uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  f_brands   text[] := private.jsonb_text_array(f -> 'brands');
  f_models   text[] := private.jsonb_text_array(f -> 'models');
  f_dims     text[] := private.jsonb_text_array(f -> 'dimensions');
  f_lives    integer[] := private.km_int_array(f -> 'lives');
  f_pos      text[] := private.jsonb_text_array(f -> 'positions');
  f_tread    text[] := private.jsonb_text_array(f -> 'tread_classes');
  f_meas     text[] := private.jsonb_text_array(f -> 'measurement_statuses');
  f_cal      text[] := private.jsonb_text_array(f -> 'calibration_statuses');
  f_psi      text[] := private.jsonb_text_array(f -> 'psi_statuses');
  f_sev      text[] := private.jsonb_text_array(f -> 'severities');
  f_quality  boolean := coalesce(nullif(f ->> 'quality_only', '')::boolean, false);
  f_retread  boolean := coalesce(nullif(f ->> 'retread_only', '')::boolean, false);
  v_all      boolean := private.is_platform_admin() or private.is_privileged_context()
                        or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_scope    uuid[] := '{}';
  v_ops      uuid[] := '{}';
  -- regras cadastradas na implantação valem também para fotografias anteriores
  -- (não existe versão anterior que as contradiga); regras criadas depois só
  -- valem a partir da própria vigência — mesmo critério de tire_params_at
  v_rule_floor date := (select min(x.valid_from) from public.tire_pressure_rules x
                         where x.organization_id = p_organization_id and x.is_active);
begin
  if v_ref is null then return; end if;
  p := private.tire_params_at(p_organization_id, v_as_of);
  if p.id is null then return; end if;
  if not v_all then
    select coalesce(array_agg(x), '{}') into v_scope from private.org_vehicle_scope_ids(p_organization_id) x;
    select coalesce(array_agg(x), '{}') into v_ops from private.accessible_operation_ids() x;
  end if;

  return query
  with s as (
    select sn.* from public.tire_daily_snapshots sn
     where sn.organization_id = p_organization_id and sn.reference_date = v_ref and not sn.removed_in_revision
       and (v_all
            or (sn.operation_id is not null and sn.operation_id = any (v_ops))
            or (sn.operation_id is null and sn.vehicle_id is not null and sn.vehicle_id = any (v_scope)))
  ),
  e as (
    select s.*, pos.label as pos_label, pos.sort_order as pos_sort, pos.axle_group as pos_axle,
           r.id as rule_id, r.min_psi as r_min, r.ideal_psi as r_ideal, r.max_psi as r_max, r.min_legal_tread_mm as r_legal,
           (v_as_of - s.measurement_date) as m_days, (v_as_of - s.calibration_date) as c_days
      from s
      left join public.tire_positions pos on pos.organization_id = s.organization_id and pos.code = s.position_code
      left join lateral (
        select r.* from public.tire_pressure_rules r
         where r.organization_id = s.organization_id and r.is_active
           and r.valid_from <= greatest(v_as_of, v_rule_floor) and (r.valid_to is null or r.valid_to >= v_as_of)
           and (r.vehicle_type_id is null or r.vehicle_type_id = s.vehicle_type_id)
           and (r.dimension_key is null or r.dimension_key = s.dimension_key)
           and (r.position_code is null or r.position_code = s.position_code)
           and (r.axle_group is null or r.axle_group = pos.axle_group)
         order by ((r.dimension_key is not null)::int * 8 + (r.position_code is not null)::int * 4
                 + (r.axle_group is not null)::int * 2 + (r.vehicle_type_id is not null)::int) desc,
                  r.valid_from desc, r.created_at desc
         limit 1) r on true
  ),
  c as (
    select e.*,
      case when e.tread_min is null then 'sem_medicao'
           when e.r_legal is not null and e.tread_min <= e.r_legal then 'abaixo_legal'
           when e.tread_min <= p.tread_critical_mm then 'critico'
           when e.tread_min <= p.tread_attention_mm then 'atencao'
           else 'adequado' end as t_class,
      case when e.measurement_date is null then 'sem_registro'
           when e.m_days <= p.measurement_ok_days then 'em_dia'
           when e.m_days <= p.measurement_warning_days then 'proximo'
           else 'vencido' end as m_status,
      case when e.calibration_date is null then 'sem_registro'
           when e.c_days <= p.calibration_ok_days then 'em_dia'
           when e.c_days <= p.calibration_warning_days then 'proximo'
           else 'vencido' end as c_status,
      case when e.psi is null then 'sem_calibragem'
           when e.rule_id is null then 'sem_parametro'
           when e.psi < e.r_min then 'baixa'
           when e.psi > e.r_max then 'excesso'
           else 'adequada' end as p_status,
      (e.canonical_status in ('em_uso', 'estoque') and (
         (p.retread_alert_use_rodopar_condition and coalesce(private.normalize_label(e.rodopar_condition), '') like 'recap%')
         or (p.retread_alert_tread_mm is not null and e.tread_min is not null and e.tread_min <= p.retread_alert_tread_mm))) as retread
      from e
  ),
  sc as (
    select c.*,
      case when c.canonical_status <> 'em_uso' then 0 else
        (case c.t_class when 'abaixo_legal' then 120
                        when 'critico' then 100 + greatest(0, round((p.tread_critical_mm - c.tread_min) * 10))::int
                        when 'atencao' then 40 else 0 end)
      + (case c.m_status when 'vencido' then 30 when 'sem_registro' then 20 when 'proximo' then 10 else 0 end)
      + (case c.c_status when 'vencido' then 30 when 'sem_registro' then 20 when 'proximo' then 10 else 0 end)
      + (case c.p_status when 'baixa' then 25 when 'excesso' then 25 when 'sem_parametro' then 5 else 0 end)
      + (case when c.tread_divergence then 12 else 0 end)
      + (case when c.retread then 15 else 0 end) end as score
      from c
  )
  select sc.id, sc.tire_id, sc.fire_number, sc.reference_date, sc.import_batch_id,
         sc.canonical_status, sc.rodopar_status_raw, sc.rodopar_status_label, sc.rodopar_condition,
         sc.brand, sc.model, sc.dimension, sc.dimension_key, sc.serial_number, sc.dot, sc.drawing, sc.rubber,
         sc.life, sc.position_code, coalesce(sc.pos_label, sc.position_code), coalesce(sc.pos_sort, 999::smallint), sc.pos_axle,
         sc.vehicle_id, coalesce(v.license_plate, sc.vehicle_plate_snapshot), coalesce(sc.fleet_number_snapshot, sc.fleet_number_raw), sc.fleet_number_raw,
         sc.vehicle_type_id, vt.name,
         sc.context_source, sc.operation_id, o.name, sc.operation_city_id,
         sc.state_id, st.uf::text, sc.city_id, ci.name,
         sc.operation_br_id, b.code, sc.leader_employee_id, le.full_name,
         sc.organization_unit_id, u.name, sc.enrichment_status,
         sc.tread_1, sc.tread_2, sc.tread_3, sc.tread_4,
         sc.tread_min_raw, sc.tread_min_calculated, sc.tread_min, sc.tread_divergence,
         sc.t_class, sc.r_legal,
         sc.measurement_date, sc.m_days, sc.m_status, sc.measurement_date + p.measurement_warning_days,
         sc.psi, sc.calibration_date, sc.c_days, sc.c_status, sc.calibration_date + p.calibration_warning_days,
         sc.rule_id, sc.r_min, sc.r_ideal, sc.r_max, sc.p_status,
         sc.km_rodado, sc.km_real, sc.rodopar_updated_at, (v_as_of - sc.rodopar_updated_at::date),
         sc.retread, sc.quality_flags, sc.score,
         case when sc.score >= 100 then 'critica' when sc.score >= 50 then 'alta' when sc.score >= 20 then 'media'
              when sc.score > 0 then 'baixa' else 'ok' end,
         v_as_of
    from sc
    left join public.vehicles v on v.id = sc.vehicle_id
    left join public.vehicle_types vt on vt.id = sc.vehicle_type_id
    left join public.operations o on o.id = sc.operation_id
    left join public.states st on st.id = sc.state_id
    left join public.cities ci on ci.id = sc.city_id
    left join public.operation_brs b on b.id = sc.operation_br_id
    left join public.employees le on le.id = sc.leader_employee_id
    left join public.organization_units u on u.id = sc.organization_unit_id
   where (f_search is null
          or sc.fire_number like '%' || upper(f_search) || '%'
          or coalesce(v.license_plate, sc.vehicle_plate_snapshot, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
          or upper(coalesce(sc.fleet_number_snapshot, sc.fleet_number_raw, '')) like '%' || upper(f_search) || '%'
          or coalesce(sc.brand, '') ilike '%' || f_search || '%'
          or coalesce(sc.model, '') ilike '%' || f_search || '%'
          or coalesce(sc.serial_number, '') ilike '%' || f_search || '%')
     and (f_status is null or cardinality(f_status) = 0 or sc.canonical_status = any (f_status))
     and (f_ops is null or cardinality(f_ops) = 0 or sc.operation_id = any (f_ops))
     and (f_states is null or cardinality(f_states) = 0 or sc.state_id = any (f_states))
     and (f_cities is null or cardinality(f_cities) = 0 or sc.city_id = any (f_cities))
     and (f_brs is null or cardinality(f_brs) = 0 or sc.operation_br_id = any (f_brs))
     and (f_leaders is null or cardinality(f_leaders) = 0 or sc.leader_employee_id = any (f_leaders))
     and (f_units is null or cardinality(f_units) = 0 or sc.organization_unit_id = any (f_units))
     and (f_types is null or cardinality(f_types) = 0 or sc.vehicle_type_id = any (f_types))
     and (f_vehicles is null or cardinality(f_vehicles) = 0 or sc.vehicle_id = any (f_vehicles))
     and (f_brands is null or cardinality(f_brands) = 0 or sc.brand = any (f_brands))
     and (f_models is null or cardinality(f_models) = 0 or sc.model = any (f_models))
     and (f_dims is null or cardinality(f_dims) = 0 or sc.dimension_key = any (f_dims))
     and (f_lives is null or cardinality(f_lives) = 0 or sc.life = any (f_lives))
     and (f_pos is null or cardinality(f_pos) = 0 or sc.position_code = any (f_pos))
     and (f_tread is null or cardinality(f_tread) = 0 or sc.t_class = any (f_tread))
     and (f_meas is null or cardinality(f_meas) = 0 or sc.m_status = any (f_meas))
     and (f_cal is null or cardinality(f_cal) = 0 or sc.c_status = any (f_cal))
     and (f_psi is null or cardinality(f_psi) = 0 or sc.p_status = any (f_psi))
     and (f_sev is null or cardinality(f_sev) = 0
          or (case when sc.score >= 100 then 'critica' when sc.score >= 50 then 'alta' when sc.score >= 20 then 'media'
                   when sc.score > 0 then 'baixa' else 'ok' end) = any (f_sev))
     and (not f_quality or cardinality(sc.quality_flags) > 0)
     and (not f_retread or sc.retread);
end;
$$;

create or replace function private.tire_vehicle_layout(p_organization_id uuid, p_vehicle_id uuid, p_reference_date date)
returns table (layout_id uuid, layout_code text, layout_name text, layout_source text, position_codes text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type uuid;
  v_observed text[];
  v_ref date := coalesce(p_reference_date, private.tire_latest_reference(p_organization_id));
begin
  return query
  select l.id, l.code, l.name, 'vehicle'::text, l.position_codes
    from public.tire_vehicle_layouts vl join public.tire_layouts l on l.id = vl.layout_id
   where vl.organization_id = p_organization_id and vl.vehicle_id = p_vehicle_id and l.is_active;
  if found then return; end if;

  select v.vehicle_type_id into v_type from public.vehicles v where v.id = p_vehicle_id and v.organization_id = p_organization_id;
  return query
  select l.id, l.code, l.name, 'vehicle_type'::text, l.position_codes
    from public.tire_vehicle_type_layouts tl join public.tire_layouts l on l.id = tl.layout_id
   where tl.organization_id = p_organization_id and tl.vehicle_type_id = v_type and l.is_active;
  if found then return; end if;

  select coalesce(array_agg(distinct s.position_code order by s.position_code), '{}') into v_observed
    from public.tire_daily_snapshots s
   where s.organization_id = p_organization_id and s.vehicle_id = p_vehicle_id and s.reference_date = v_ref
     and s.canonical_status = 'em_uso' and s.position_code is not null and not s.removed_in_revision;

  if cardinality(v_observed) > 0 then
    return query
    select l.id, l.code, l.name, 'inferred'::text, l.position_codes
      from public.tire_layouts l
     where l.organization_id = p_organization_id and l.is_active
       and l.position_codes @> v_observed and l.position_codes <@ v_observed
     order by l.code
     limit 1;
    if found then return; end if;
  end if;

  return query select null::uuid, null::text, null::text, 'snapshot'::text, v_observed;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Importação: origem, revisão do mesmo dia e mensagens sem "fotografia"
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_start(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text := lower(nullif(btrim(p_payload ->> 'file_hash'), ''));
  v_name    text := nullif(btrim(p_payload ->> 'file_name'), '');
  v_source  text := coalesce(nullif(btrim(p_payload ->> 'source_kind'), ''), 'upload');
  v_run     uuid;
  v_replace boolean := coalesce(nullif(p_payload ->> 'replace_same_day', '')::boolean, false);
  v_ref     date;
  v_today   date := private.maintenance_today(p_organization_id);
  v_latest  date := private.tire_latest_reference(p_organization_id);
  v_prev    date;
  v_super   uuid;
  v_dup     public.tire_import_batches;
  v_id      uuid;
  v_name_by text := private.tire_actor_name(p_organization_id);
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  if v_name is null then raise exception 'Nome do arquivo ausente.' using errcode = 'invalid_parameter_value'; end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Assinatura (hash) do arquivo inválida.' using errcode = 'invalid_parameter_value'; end if;
  if v_source not in ('upload', 'sharepoint') then raise exception 'Origem do arquivo inválida.' using errcode = 'invalid_parameter_value'; end if;
  begin
    v_run := nullif(p_payload ->> 'sync_run_id', '')::uuid;
    v_ref := (p_payload ->> 'reference_date')::date;
  exception when others then
    raise exception 'Data de referência inválida.' using errcode = 'invalid_parameter_value';
  end;
  if v_ref is null then raise exception 'Informe a data de referência dos dados.' using errcode = 'invalid_parameter_value'; end if;
  if v_ref > v_today then raise exception 'A data de referência não pode ser futura.' using errcode = 'invalid_parameter_value'; end if;
  if v_run is not null and not exists (select 1 from public.tire_sync_runs r where r.id = v_run and r.organization_id = p_organization_id
                                                                           and r.status = 'em_andamento') then
    raise exception 'Execução de sincronização inexistente ou já encerrada.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_dup from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.file_hash = v_hash and b.status = 'confirmed';
  if v_dup.id is not null then
    raise exception 'Este arquivo já foi importado e confirmado como dados de %.', to_char(v_dup.reference_date, 'DD/MM/YYYY')
      using errcode = 'unique_violation', hint = 'tire_duplicate_file', detail = v_dup.id::text;
  end if;
  if v_latest is not null and v_ref < v_latest then
    raise exception 'Já existem dados confirmados em %. A data de referência não pode ser anterior.', to_char(v_latest, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value', hint = 'tire_reference_not_after_latest';
  end if;
  if v_latest is not null and v_ref = v_latest then
    if not v_replace then
      raise exception 'Já existem dados confirmados em %. Para atualizar a mesma data, use a revisão do dia.', to_char(v_latest, 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value', hint = 'tire_reference_not_after_latest';
    end if;
    select b.id into v_super from public.tire_import_batches b
     where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_ref;
  end if;
  select max(b.reference_date) into v_prev from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date < v_ref;

  -- uma sincronização nova encerra os lotes abertos de sincronizações anteriores
  if v_source = 'sharepoint' then
    update public.tire_import_batches x set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now(),
           cancel_reason = 'Encerrado por uma sincronização mais recente.'
     where x.organization_id = p_organization_id and x.source_kind = 'sharepoint' and x.status in ('staging', 'validated', 'blocked');
  end if;

  insert into public.tire_import_batches (
    organization_id, file_name, file_hash, file_size, sheet_name, header_row, layout_version, window_start, window_end,
    recognized_columns, unrecognized_columns, ignored_columns, reference_date, suggested_reference_date, previous_reference_date,
    status, total_rows, created_by, created_by_name, source_kind, sync_run_id, supersedes_batch_id)
  values (
    p_organization_id, left(v_name, 255), v_hash, nullif(p_payload ->> 'file_size', '')::bigint, left(p_payload ->> 'sheet_name', 120),
    nullif(p_payload ->> 'header_row', '')::integer, coalesce(nullif(p_payload ->> 'layout_version', ''), 'rodopar10_v1'),
    left(p_payload ->> 'window_start', 60), left(p_payload ->> 'window_end', 60),
    coalesce(private.jsonb_text_array(p_payload -> 'recognized_columns'), '{}'),
    coalesce(private.jsonb_text_array(p_payload -> 'unrecognized_columns'), '{}'),
    coalesce(private.jsonb_text_array(p_payload -> 'ignored_columns'), '{}'),
    v_ref, nullif(p_payload ->> 'suggested_reference_date', '')::date, v_prev,
    'staging', coalesce(nullif(p_payload ->> 'total_rows', '')::integer, 0), auth.uid(), v_name_by, v_source, v_run, v_super)
  returning id into v_id;

  return jsonb_build_object('batch_id', v_id, 'reference_date', v_ref, 'previous_reference_date', v_prev,
                            'same_day_revision', v_super is not null, 'supersedes_batch_id', v_super);
end;
$$;

create or replace function private.tire_import_run_validation(p_organization_id uuid, p_batch_id uuid)
returns public.tire_import_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  b          public.tire_import_batches;
  p          public.tire_parameter_sets;
  v_latest   date;
  v_prev     date;
  v_required text[] := array['fire_number', 'status_raw', 'fleet_number', 'position', 'tread_1', 'tread_2', 'tread_3', 'tread_4',
                             'measurement_at', 'psi', 'calibration_at', 'life'];
  v_missing  text[];
  v_limit_ts timestamp;
  v_block    text[] := '{}';
  v_counters jsonb;
  v_dup      uuid;
  n_total integer; n_err integer; n_warn integer; n_new integer; n_upd integer; n_same integer; n_absent integer; n_back integer;
begin
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id for update;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;
  if b.status in ('confirmed', 'cancelled') then
    raise exception 'Este lote já foi % e não pode ser revalidado.', case b.status when 'confirmed' then 'confirmado' else 'cancelado' end
      using errcode = 'invalid_parameter_value';
  end if;
  p := private.tire_params_at(p_organization_id, b.reference_date);
  if p.id is null then raise exception 'Parâmetros de Pneus não cadastrados.' using errcode = 'no_data_found'; end if;
  v_latest := private.tire_latest_reference(p_organization_id);
  -- revisão do mesmo dia compara com a data ANTERIOR (nunca com a versão que substitui)
  select max(x.reference_date) into v_prev from public.tire_import_batches x
   where x.organization_id = p_organization_id and x.status = 'confirmed' and x.reference_date < b.reference_date;
  v_limit_ts := (b.reference_date + p.future_date_tolerance_days + 1)::timestamp;

  -- ---------------------------------------------------------- passo 1: tipagem e regras por linha
  with cv as (
    select s.id,
      private.tire_fire_number(private.tire_cell_text(s.cells -> 'fire_number')) as fire_number,
      private.tire_cell_text(s.cells -> 'fire_number') as fire_raw,
      private.tire_cell_text(s.cells -> 'serial_number') as serial_number,
      private.tire_cell_text(s.cells -> 'tire_branch') as tire_branch,
      private.tire_cell_text(s.cells -> 'unit_code') as unit_code,
      private.tire_cell_text(s.cells -> 'cost_code') as cost_code,
      private.tire_cell_text(s.cells -> 'status_raw') as status_raw,
      upper(private.tire_cell_text(s.cells -> 'fleet_number')) as fleet_number,
      private.tire_cell_text(s.cells -> 'fleet_branch') as fleet_branch,
      private.tire_cell_text(s.cells -> 'brand') as brand,
      private.tire_cell_text(s.cells -> 'model') as model,
      private.tire_cell_text(s.cells -> 'dimension') as dimension,
      private.tire_position_key(private.tire_cell_text(s.cells -> 'position')) as position_code,
      private.tire_cell_text(s.cells -> 'dot') as dot,
      private.tire_cell_text(s.cells -> 'condition') as condition,
      private.tire_cell_text(s.cells -> 'classification') as classification,
      private.tire_cell_text(s.cells -> 'status_label') as status_label,
      private.tire_cell_text(s.cells -> 'created_by_user') as created_by_user,
      private.tire_cell_text(s.cells -> 'updated_by_user') as updated_by_user,
      private.tire_cell_text(s.cells -> 'drawing') as drawing,
      private.tire_cell_text(s.cells -> 'rubber') as rubber,
      private.tire_cell_num(s.cells -> 'tread_min') as n_tmin,
      private.tire_cell_num(s.cells -> 'tread_1') as n_t1,
      private.tire_cell_num(s.cells -> 'tread_2') as n_t2,
      private.tire_cell_num(s.cells -> 'tread_3') as n_t3,
      private.tire_cell_num(s.cells -> 'tread_4') as n_t4,
      private.tire_cell_num(s.cells -> 'psi') as n_psi,
      private.tire_cell_num(s.cells -> 'km_rodado') as n_kmr,
      private.tire_cell_num(s.cells -> 'km_real') as n_kmreal,
      private.tire_cell_num(s.cells -> 'life') as n_life,
      private.tire_cell_ts(s.cells -> 'purchase_date') as d_purchase,
      private.tire_cell_ts(s.cells -> 'measurement_at') as d_meas,
      private.tire_cell_ts(s.cells -> 'calibration_at') as d_cal,
      private.tire_cell_ts(s.cells -> 'registration_at') as d_reg,
      private.tire_cell_ts(s.cells -> 'updated_at') as d_upd,
      s.client_flags, s.cells
    from public.tire_import_staging s where s.batch_id = b.id
  ),
  ok as (
    select cv.*,
      (cv.n_tmin is not null and (cv.n_tmin = 'NaN' or cv.n_tmin < 0 or cv.n_tmin > p.max_valid_tread_mm)) as bad_tmin,
      (cv.n_t1 is not null and (cv.n_t1 = 'NaN' or cv.n_t1 < 0 or cv.n_t1 > p.max_valid_tread_mm)) as bad_t1,
      (cv.n_t2 is not null and (cv.n_t2 = 'NaN' or cv.n_t2 < 0 or cv.n_t2 > p.max_valid_tread_mm)) as bad_t2,
      (cv.n_t3 is not null and (cv.n_t3 = 'NaN' or cv.n_t3 < 0 or cv.n_t3 > p.max_valid_tread_mm)) as bad_t3,
      (cv.n_t4 is not null and (cv.n_t4 = 'NaN' or cv.n_t4 < 0 or cv.n_t4 > p.max_valid_tread_mm)) as bad_t4,
      (cv.n_psi is not null and (cv.n_psi = 'NaN' or cv.n_psi < 0 or cv.n_psi > p.max_valid_psi)) as bad_psi,
      (cv.n_kmr is not null and (cv.n_kmr = 'NaN' or cv.n_kmr < 0 or cv.n_kmr > 99999999)) as bad_kmr,
      (cv.n_kmreal is not null and (cv.n_kmreal = 'NaN' or abs(cv.n_kmreal) > 99999999)) as bad_kmreal,
      (cv.n_life is not null and (cv.n_life = 'NaN' or cv.n_life < 0 or cv.n_life > 20 or cv.n_life <> trunc(cv.n_life))) as bad_life,
      (cv.d_purchase = '-infinity' or (cv.d_purchase is not null and cv.d_purchase < timestamp '1980-01-01')) as inv_purchase,
      (cv.d_meas = '-infinity' or (cv.d_meas is not null and cv.d_meas < timestamp '1980-01-01')) as inv_meas,
      (cv.d_cal = '-infinity' or (cv.d_cal is not null and cv.d_cal < timestamp '1980-01-01')) as inv_cal,
      (cv.d_reg = '-infinity' or (cv.d_reg is not null and cv.d_reg < timestamp '1980-01-01')) as inv_reg,
      (cv.d_upd = '-infinity' or (cv.d_upd is not null and cv.d_upd < timestamp '1980-01-01')) as inv_upd,
      (cv.d_purchase is not null and cv.d_purchase <> '-infinity' and cv.d_purchase >= v_limit_ts) as fut_purchase,
      (cv.d_meas is not null and cv.d_meas <> '-infinity' and cv.d_meas >= v_limit_ts) as fut_meas,
      (cv.d_cal is not null and cv.d_cal <> '-infinity' and cv.d_cal >= v_limit_ts) as fut_cal,
      (cv.d_reg is not null and cv.d_reg <> '-infinity' and cv.d_reg >= v_limit_ts) as fut_reg,
      (cv.d_upd is not null and cv.d_upd <> '-infinity' and cv.d_upd >= v_limit_ts) as fut_upd,
      private.tire_canonical_status(cv.status_raw) as canonical
    from cv
  ),
  fx as (
    select ok.*,
      case when ok.bad_tmin then null else ok.n_tmin end as v_tmin,
      case when ok.bad_t1 then null else ok.n_t1 end as v_t1,
      case when ok.bad_t2 then null else ok.n_t2 end as v_t2,
      case when ok.bad_t3 then null else ok.n_t3 end as v_t3,
      case when ok.bad_t4 then null else ok.n_t4 end as v_t4,
      case when ok.bad_psi then null else ok.n_psi end as v_psi,
      case when ok.inv_meas or ok.fut_meas then null else ok.d_meas end as v_meas,
      case when ok.inv_cal or ok.fut_cal then null else ok.d_cal end as v_cal
    from ok
  ),
  calc as (
    select fx.*, least(fx.v_t1, fx.v_t2, fx.v_t3, fx.v_t4) as v_tcalc from fx
  ),
  iss as (
    select calc.*,
      array_remove(array[
        case when calc.fire_number is null then jsonb_build_object('code', 'fogo_ausente', 'severity', 'error', 'field', 'fire_number',
             'message', 'Linha com dados e sem Nº Fogo: o pneu não pode ser identificado.') end,
        case when calc.fire_number is not null and calc.fire_number !~ '^[0-9A-Z][0-9A-Z./_-]{0,29}$' then jsonb_build_object('code', 'fogo_invalido', 'severity', 'error',
             'field', 'fire_number', 'value', calc.fire_raw, 'message', format('Nº Fogo "%s" contém caracteres inválidos.', calc.fire_raw)) end,
        case when calc.bad_tmin then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_min', 'value', calc.n_tmin::text,
             'message', format('Menor milimetragem %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_tmin, p.max_valid_tread_mm)) end,
        case when calc.bad_t1 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_1', 'value', calc.n_t1::text,
             'message', format('Sulco 1 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t1, p.max_valid_tread_mm)) end,
        case when calc.bad_t2 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_2', 'value', calc.n_t2::text,
             'message', format('Sulco 2 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t2, p.max_valid_tread_mm)) end,
        case when calc.bad_t3 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_3', 'value', calc.n_t3::text,
             'message', format('Sulco 3 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t3, p.max_valid_tread_mm)) end,
        case when calc.bad_t4 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_4', 'value', calc.n_t4::text,
             'message', format('Sulco 4 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t4, p.max_valid_tread_mm)) end,
        case when calc.v_tmin is not null and calc.v_tcalc is not null and abs(calc.v_tmin - calc.v_tcalc) > p.tread_min_divergence_tolerance_mm
             then jsonb_build_object('code', 'menor_mm_divergente', 'severity', 'warning', 'field', 'tread_min', 'value', calc.v_tmin::text,
             'message', format('Menor milimetragem informada (%s mm) difere do menor sulco medido (%s mm).', calc.v_tmin, calc.v_tcalc)) end,
        case when calc.canonical = 'em_uso' and calc.v_tmin is null and calc.v_tcalc is null then jsonb_build_object('code', 'sem_milimetragem',
             'severity', 'warning', 'field', 'tread_1', 'message', 'Pneu em uso sem nenhuma milimetragem válida.') end,
        case when calc.bad_psi then jsonb_build_object('code', 'psi_invalido', 'severity', 'warning', 'field', 'psi', 'value', calc.n_psi::text,
             'message', format('Calibragem %s fora do limite técnico (0 a %s PSI): valor ignorado.', calc.n_psi, p.max_valid_psi)) end,
        case when 'psi:date_serial' = any (calc.client_flags) and not calc.bad_psi then jsonb_build_object('code', 'numero_formatado_como_data', 'severity', 'warning',
             'field', 'psi', 'value', calc.n_psi::text, 'message', format('Calibragem gravada como data no Rodopar; valor recuperado: %s PSI.', calc.n_psi)) end,
        case when calc.inv_meas then jsonb_build_object('code', 'data_invalida', 'severity', 'warning', 'field', 'measurement_at',
             'value', calc.cells ->> 'measurement_at', 'message', 'Data de medição inválida: ignorada.') end,
        case when calc.fut_meas then jsonb_build_object('code', 'data_futura', 'severity', 'warning', 'field', 'measurement_at', 'value', calc.d_meas::text,
             'message', format('Data de medição %s posterior à data de referência: ignorada.', to_char(calc.d_meas, 'DD/MM/YYYY'))) end,
        case when calc.inv_cal then jsonb_build_object('code', 'data_invalida', 'severity', 'warning', 'field', 'calibration_at',
             'value', calc.cells ->> 'calibration_at', 'message', 'Data de calibragem inválida: ignorada.') end,
        case when calc.fut_cal then jsonb_build_object('code', 'data_futura', 'severity', 'warning', 'field', 'calibration_at', 'value', calc.d_cal::text,
             'message', format('Data de calibragem %s posterior à data de referência: ignorada.', to_char(calc.d_cal, 'DD/MM/YYYY'))) end,
        case when calc.inv_purchase or calc.fut_purchase then jsonb_build_object('code', case when calc.inv_purchase then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'purchase_date', 'message', 'Data de compra inválida ou futura: ignorada.') end,
        case when calc.inv_reg or calc.fut_reg then jsonb_build_object('code', case when calc.inv_reg then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'registration_at', 'message', 'Data de cadastro inválida ou futura: ignorada.') end,
        case when calc.inv_upd or calc.fut_upd then jsonb_build_object('code', case when calc.inv_upd then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'updated_at', 'message', 'Data da última alteração inválida ou futura: ignorada.') end,
        case when calc.bad_kmr then jsonb_build_object('code', 'km_rodado_invalido', 'severity', 'warning', 'field', 'km_rodado', 'value', calc.n_kmr::text,
             'message', 'KM Rodado negativo ou inválido: ignorado.') end,
        case when calc.n_kmreal is not null and not calc.bad_kmreal and calc.n_kmreal < 0 then jsonb_build_object('code', 'km_real_negativo', 'severity', 'warning',
             'field', 'km_real', 'value', calc.n_kmreal::text, 'message', format('KM Real negativo (%s) no relatório: preservado como diagnóstico.', calc.n_kmreal)) end,
        case when calc.bad_life then jsonb_build_object('code', 'vida_invalida', 'severity', 'warning', 'field', 'life', 'value', calc.n_life::text,
             'message', 'Nº da vida inválido: ignorado.') end,
        case when calc.status_raw is not null and calc.canonical = 'outro' then jsonb_build_object('code', 'situacao_nao_reconhecida', 'severity', 'warning',
             'field', 'status_raw', 'value', calc.status_raw, 'message', format('Situação "%s" não reconhecida: classificada como Outro.', calc.status_raw)) end,
        case when calc.canonical = 'em_uso' and calc.fleet_number is null then jsonb_build_object('code', 'em_uso_sem_frota', 'severity', 'warning',
             'field', 'fleet_number', 'message', 'Pneu em uso sem frota informada.') end,
        case when calc.canonical = 'em_uso' and calc.fleet_number is not null and calc.position_code is null then jsonb_build_object('code', 'em_uso_sem_posicao',
             'severity', 'warning', 'field', 'position', 'message', 'Pneu em uso sem posição informada.') end,
        case when calc.canonical <> 'em_uso' and (calc.fleet_number is not null or calc.position_code is not null) then jsonb_build_object('code', 'fora_de_uso_com_frota',
             'severity', 'warning', 'field', 'fleet_number', 'message', 'Pneu fora de uso com frota ou posição preenchida.') end,
        case when calc.position_code is not null and not exists (select 1 from public.tire_positions tp where tp.organization_id = p_organization_id
                                                                  and tp.code = calc.position_code and tp.is_active)
             then jsonb_build_object('code', 'posicao_desconhecida', 'severity', 'warning', 'field', 'position', 'value', calc.position_code,
             'message', format('Posição "%s" não está no dicionário de posições.', calc.position_code)) end,
        case when calc.canonical = 'em_uso' and calc.v_meas is null and not calc.inv_meas and not calc.fut_meas then jsonb_build_object('code', 'sem_data_medicao',
             'severity', 'warning', 'field', 'measurement_at', 'message', 'Pneu em uso sem data de medição.') end,
        case when calc.canonical = 'em_uso' and calc.v_cal is null and not calc.inv_cal and not calc.fut_cal then jsonb_build_object('code', 'sem_data_calibragem',
             'severity', 'warning', 'field', 'calibration_at', 'message', 'Pneu em uso sem data de calibragem.') end
      ], null) as issue_list
    from calc
  )
  update public.tire_import_staging s set
    fire_number = iss.fire_number, serial_number = iss.serial_number, rodopar_tire_branch = iss.tire_branch,
    unit_code = iss.unit_code, cost_code = iss.cost_code,
    purchase_date = case when iss.inv_purchase or iss.fut_purchase then null else iss.d_purchase::date end,
    rodopar_status_raw = iss.status_raw, canonical_status = iss.canonical,
    fleet_number_raw = iss.fleet_number, fleet_branch = iss.fleet_branch, brand = iss.brand, model = iss.model,
    dimension = iss.dimension, position_code = iss.position_code,
    tread_min_raw = iss.v_tmin, tread_1 = iss.v_t1, tread_2 = iss.v_t2, tread_3 = iss.v_t3, tread_4 = iss.v_t4,
    tread_min_calculated = iss.v_tcalc,
    measurement_at = iss.v_meas, psi = iss.v_psi, calibration_at = iss.v_cal,
    km_rodado = case when iss.bad_kmr then null else round(iss.n_kmr)::bigint end,
    km_real = case when iss.bad_kmreal then null else round(iss.n_kmreal)::bigint end,
    dot = iss.dot, life = case when iss.bad_life then null else iss.n_life::smallint end,
    rodopar_condition = iss.condition, rodopar_classification = iss.classification, rodopar_status_label = iss.status_label,
    registration_at = case when iss.inv_reg or iss.fut_reg then null else iss.d_reg end,
    rodopar_created_by = iss.created_by_user, rodopar_updated_by = iss.updated_by_user,
    rodopar_updated_at = case when iss.inv_upd or iss.fut_upd then null else iss.d_upd end,
    drawing = iss.drawing, rubber = iss.rubber,
    vehicle_id = null, tire_id = null, action = null, changes = '{}',
    issues = coalesce(to_jsonb(iss.issue_list), '[]'::jsonb)
  from iss
  where s.id = iss.id;

  -- ---------------------------------------------------------- passo 2: Nº Fogo duplicado no arquivo
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'fogo_duplicado', 'severity', 'error', 'field', 'fire_number',
           'value', s.fire_number, 'message', format('Nº Fogo %s aparece %s vezes no arquivo.', s.fire_number, d.n)))
    from (select x.fire_number, count(*) as n from public.tire_import_staging x
           where x.batch_id = b.id and x.fire_number is not null group by x.fire_number having count(*) > 1) d
   where s.batch_id = b.id and s.fire_number = d.fire_number;

  -- ---------------------------------------------------------- passo 3: veículo do HFM (frota → placa); nunca cria veículo
  update public.tire_import_staging s
     set vehicle_id = coalesce(
           (select v.id from public.vehicles v
             where v.organization_id = p_organization_id and v.deleted_at is null and upper(btrim(v.fleet_code)) = s.fleet_number_raw
             order by (v.status = 'active') desc, v.created_at limit 1),
           (select v.id from public.vehicles v
             where v.organization_id = p_organization_id and v.deleted_at is null
               and length(coalesce(private.normalize_plate(s.fleet_number_raw), '')) >= 7
               and v.license_plate = private.normalize_plate(s.fleet_number_raw)
             order by (v.status = 'active') desc, v.created_at limit 1))
   where s.batch_id = b.id and s.fleet_number_raw is not null;
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'frota_nao_encontrada', 'severity', 'warning', 'field', 'fleet_number',
           'value', s.fleet_number_raw, 'message', format('Frota "%s" não existe no Cadastro de Frotas do HFM: pneu importado sem veículo (nenhum veículo é criado).', s.fleet_number_raw)))
   where s.batch_id = b.id and s.fleet_number_raw is not null and s.vehicle_id is null;

  -- ---------------------------------------------------------- passo 4: dois pneus em uso na mesma frota + posição
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'colisao_posicao', 'severity', 'error', 'field', 'position',
           'value', s.position_code, 'message', format('Frota %s, posição %s: %s pneus em uso (%s).', s.fleet_number_raw, s.position_code, d.n, d.fires)))
    from (select coalesce(x.vehicle_id::text, x.fleet_number_raw) as k, x.position_code, count(distinct x.fire_number) as n,
                 string_agg(distinct x.fire_number, ', ') as fires
            from public.tire_import_staging x
           where x.batch_id = b.id and x.canonical_status = 'em_uso' and x.position_code is not null and x.fleet_number_raw is not null
           group by 1, 2 having count(distinct x.fire_number) > 1) d
   where s.batch_id = b.id and s.canonical_status = 'em_uso' and s.position_code = d.position_code
     and coalesce(s.vehicle_id::text, s.fleet_number_raw) = d.k;

  -- ---------------------------------------------------------- passo 5: comparação com o cadastro e a fotografia anterior
  update public.tire_import_staging s set tire_id = t.id
    from public.tires t
   where s.batch_id = b.id and t.organization_id = p_organization_id and t.fire_number = s.fire_number;

  with c as (
    select s.id, ps.id as ps_id, ps.canonical_status as ps_status, ps.life as ps_life,
      array_remove(array[
        case when ps.id is not null and ps.canonical_status is distinct from s.canonical_status then 'status' end,
        case when ps.id is not null and coalesce(ps.vehicle_id::text, ps.fleet_number_raw) is distinct from coalesce(s.vehicle_id::text, s.fleet_number_raw) then 'vehicle' end,
        case when ps.id is not null and coalesce(ps.vehicle_id::text, ps.fleet_number_raw) is not distinct from coalesce(s.vehicle_id::text, s.fleet_number_raw)
                  and ps.position_code is distinct from s.position_code then 'position' end,
        case when ps.id is not null and ps.life is distinct from s.life then 'life' end,
        case when ps.id is not null and (ps.measurement_at is distinct from s.measurement_at or ps.tread_1 is distinct from s.tread_1
                  or ps.tread_2 is distinct from s.tread_2 or ps.tread_3 is distinct from s.tread_3 or ps.tread_4 is distinct from s.tread_4
                  or ps.tread_min_raw is distinct from s.tread_min_raw) then 'measurement' end,
        case when ps.id is not null and (ps.calibration_at is distinct from s.calibration_at or ps.psi is distinct from s.psi) then 'calibration' end,
        case when ps.id is not null and (ps.brand is distinct from s.brand or ps.model is distinct from s.model
                  or ps.dimension_key is distinct from private.tire_dimension_key(s.dimension) or ps.dot is distinct from s.dot
                  or ps.drawing is distinct from s.drawing or ps.rubber is distinct from s.rubber
                  or ps.serial_number is distinct from s.serial_number) then 'attributes' end], null) as ch
      from public.tire_import_staging s
      left join lateral (select x.* from public.tire_daily_snapshots x where x.tire_id = s.tire_id
                            and x.reference_date < b.reference_date and not x.removed_in_revision
                          order by x.reference_date desc limit 1) ps on s.tire_id is not null
     where s.batch_id = b.id)
  update public.tire_import_staging s set
    changes = c.ch,
    action = case when s.tire_id is null then 'new' when cardinality(c.ch) > 0 then 'updated' else 'unchanged' end,
    issues = s.issues
      || case when c.ps_life is not null and s.life is not null and s.life < c.ps_life then jsonb_build_array(jsonb_build_object(
             'code', 'vida_regrediu', 'severity', 'warning', 'field', 'life', 'value', s.life::text,
             'message', format('Vida passou de %s para %s: vida não regride.', c.ps_life, s.life))) else '[]'::jsonb end
      || case when c.ps_status in ('descartado', 'baixado') and s.canonical_status in ('em_uso', 'estoque') then jsonb_build_array(jsonb_build_object(
             'code', 'reativado_apos_baixa', 'severity', 'warning', 'field', 'status_raw', 'value', s.rodopar_status_raw,
             'message', format('Pneu que estava %s voltou como %s.', c.ps_status, s.canonical_status))) else '[]'::jsonb end
  from c where s.id = c.id;

  -- ---------------------------------------------------------- passo 6: severidade
  update public.tire_import_staging s set severity =
    case when exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'severity' = 'error') then 'error'
         when jsonb_array_length(s.issues) > 0 then 'warning' else 'ok' end
   where s.batch_id = b.id;

  -- ---------------------------------------------------------- passo 7: contadores, ausentes, bloqueio
  select count(*), count(*) filter (where s.severity = 'error'), count(*) filter (where s.severity = 'warning'),
         count(*) filter (where s.severity <> 'error' and s.action = 'new'),
         count(*) filter (where s.severity <> 'error' and s.action = 'updated'),
         count(*) filter (where s.severity <> 'error' and s.action = 'unchanged')
    into n_total, n_err, n_warn, n_new, n_upd, n_same
    from public.tire_import_staging s where s.batch_id = b.id;
  select count(*) into n_absent from public.tires t
   where t.organization_id = p_organization_id and t.presence_status = 'present'
     and not exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number);
  select count(*) into n_back from public.tires t
   where t.organization_id = p_organization_id and t.presence_status = 'absent'
     and exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number);

  select array(select x from unnest(v_required) x where not (x = any (b.recognized_columns))) into v_missing;
  if cardinality(v_missing) > 0 then
    v_block := v_block || format('Colunas oficiais não reconhecidas no arquivo: %s.', array_to_string(v_missing, ', '));
  end if;
  if n_err > 0 then
    v_block := v_block || format('%s %s com erro bloqueante: nenhuma linha será aplicada.', n_err, case when n_err = 1 then 'linha' else 'linhas' end);
  end if;
  if n_total = 0 or n_total = n_err then v_block := v_block || 'Nenhuma linha válida no arquivo.'::text; end if;
  if v_latest is not null and (b.reference_date < v_latest or (b.reference_date = v_latest and b.supersedes_batch_id is null)) then
    v_block := v_block || format('Já existem dados confirmados em %s: a data de referência precisa ser posterior (ou uma revisão do mesmo dia).', to_char(v_latest, 'DD/MM/YYYY'));
  end if;
  select x.id into v_dup from public.tire_import_batches x
   where x.organization_id = p_organization_id and x.file_hash = b.file_hash and x.status = 'confirmed' and x.id <> b.id;
  if v_dup is not null then v_block := v_block || 'Este arquivo já foi importado e confirmado.'::text; end if;

  select jsonb_build_object(
    'status', coalesce((select jsonb_object_agg(x.k, x.n) from (select s.canonical_status as k, count(*) as n from public.tire_import_staging s
                          where s.batch_id = b.id and s.canonical_status is not null group by 1) x), '{}'::jsonb),
    'changes', coalesce((select jsonb_object_agg(x.k, x.n) from (select c as k, count(*) as n from public.tire_import_staging s
                           cross join lateral unnest(s.changes) c where s.batch_id = b.id and s.severity <> 'error' group by 1) x), '{}'::jsonb),
    'issues', coalesce((select jsonb_object_agg(x.k, x.n) from (select i ->> 'code' as k, count(*) as n from public.tire_import_staging s
                          cross join lateral jsonb_array_elements(s.issues) i where s.batch_id = b.id group by 1) x), '{}'::jsonb),
    'vehicles_resolved', (select count(distinct s.vehicle_id) from public.tire_import_staging s where s.batch_id = b.id and s.vehicle_id is not null),
    'fleets_in_file', (select count(distinct s.fleet_number_raw) from public.tire_import_staging s where s.batch_id = b.id and s.fleet_number_raw is not null),
    'fleets_not_found', (select count(distinct s.fleet_number_raw) from public.tire_import_staging s where s.batch_id = b.id and s.fleet_number_raw is not null and s.vehicle_id is null),
    'max_updated_at', (select max(s.rodopar_updated_at) from public.tire_import_staging s where s.batch_id = b.id),
    'reference_before_last_change', coalesce((select max(s.rodopar_updated_at)::date > b.reference_date from public.tire_import_staging s where s.batch_id = b.id), false),
    'missing_columns', to_jsonb(v_missing),
    'block_reasons', to_jsonb(v_block))
    into v_counters;

  update public.tire_import_batches x set
    status = case when cardinality(v_block) > 0 then 'blocked' else 'validated' end,
    total_rows = n_total, error_rows = n_err, warning_rows = n_warn, valid_rows = n_total - n_err,
    new_tires = n_new, updated_tires = n_upd, unchanged_tires = n_same, absent_tires = n_absent, reappeared_tires = n_back,
    counters = v_counters, block_reason = nullif(array_to_string(v_block, ' '), ''),
    previous_reference_date = v_prev, validated_at = now(), updated_at = now()
   where x.id = b.id
  returning * into b;
  return b;
end;
$$;

create or replace function public.tire_import_confirm(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        public.tire_import_batches;
  v_ref    date;
  v_prev   date;
  v_ids    uuid[];
  n_new integer := 0; n_snap integer := 0; n_events integer := 0; n_absent integer := 0; n_back integer := 0;
  v_recon  jsonb := '{}'::jsonb;
  v_name   text := private.tire_actor_name(p_organization_id);
  v_replace boolean := false;
  v_old    public.tire_import_batches;
  v_removed uuid[] := '{}';
  n_removed integer := 0;
  v_after  jsonb := '{}'::jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  -- revalida tudo no banco: a confirmação nunca confia na prévia já exibida
  b := private.tire_import_run_validation(p_organization_id, p_batch_id);
  if b.status <> 'validated' then
    raise exception 'Importação bloqueada: %', coalesce(b.block_reason, 'há inconsistências bloqueantes.')
      using errcode = 'check_violation', hint = 'tire_import_blocked';
  end if;
  v_ref := b.reference_date;
  v_prev := b.previous_reference_date;

  -- ---------------------------------------------------------- revisão do mesmo dia
  v_replace := b.supersedes_batch_id is not null;
  if v_replace then
    select * into v_old from public.tire_import_batches x where x.id = b.supersedes_batch_id for update;
    if v_old.id is null or v_old.status <> 'confirmed' or v_old.reference_date <> v_ref then
      raise exception 'Os dados desta data mudaram durante a validação: sincronize novamente.'
        using errcode = 'serialization_failure', hint = 'tire_revision_conflict';
    end if;
    update public.tire_import_batches x set status = 'superseded', superseded_by_batch_id = b.id, superseded_at = now(), updated_at = now()
     where x.id = v_old.id;
    perform set_config('hfm.tire_snapshot_revision', b.id::text, true);
  end if;

  -- ---------------------------------------------------------- cadastro: novos pneus
  insert into public.tires (organization_id, fire_number, serial_number, brand, model, dimension, dimension_key, dot, drawing, rubber,
                            purchase_date, registration_date, current_life, current_status, rodopar_status_raw,
                            first_reference_date, last_reference_date, last_import_batch_id)
  select p_organization_id, s.fire_number, s.serial_number, s.brand, s.model, s.dimension, private.tire_dimension_key(s.dimension),
         s.dot, s.drawing, s.rubber, s.purchase_date, s.registration_at::date, s.life, s.canonical_status, s.rodopar_status_raw,
         v_ref, v_ref, b.id
    from public.tire_import_staging s
   where s.batch_id = b.id and s.severity <> 'error' and s.action = 'new'
  on conflict (organization_id, fire_number) do nothing;
  get diagnostics n_new = row_count;
  update public.tire_import_staging s set tire_id = t.id
    from public.tires t
   where s.batch_id = b.id and s.tire_id is null and t.organization_id = p_organization_id and t.fire_number = s.fire_number;

  -- ---------------------------------------------------------- fotografia (contexto oficial na data)
  select coalesce(array_agg(distinct s.vehicle_id), '{}') into v_ids
    from public.tire_import_staging s where s.batch_id = b.id and s.vehicle_id is not null and s.severity <> 'error';

  with ctx as (
    select c.* from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_ref, array[cardinality(v_ids)])) c)
  insert into public.tire_daily_snapshots (
    organization_id, tire_id, reference_date, import_batch_id, row_number, fire_number,
    rodopar_tire_branch, unit_code, cost_code, purchase_date, rodopar_status_raw, canonical_status, fleet_number_raw, fleet_branch,
    brand, model, dimension, dimension_key, position_code, tread_min_raw, tread_1, tread_2, tread_3, tread_4, tread_min_calculated,
    tread_min, tread_divergence, measurement_at, measurement_date, psi, calibration_at, calibration_date, km_rodado, km_real, dot, life,
    rodopar_condition, rodopar_classification, rodopar_status_label, registration_at, serial_number, rodopar_created_by,
    rodopar_updated_by, rodopar_updated_at, drawing, rubber, raw,
    vehicle_id, vehicle_plate_snapshot, fleet_number_snapshot, vehicle_type_id, context_source, operation_id, operation_city_id,
    state_id, city_id, operation_br_id, fidelization_assignment_id, leader_employee_id, organization_unit_id,
    enrichment_status, quality_flags, data_quality_status)
  select p_organization_id, s.tire_id, v_ref, b.id, s.row_number, s.fire_number,
         s.rodopar_tire_branch, s.unit_code, s.cost_code, s.purchase_date, s.rodopar_status_raw, s.canonical_status, s.fleet_number_raw, s.fleet_branch,
         s.brand, s.model, s.dimension, private.tire_dimension_key(s.dimension), s.position_code, s.tread_min_raw, s.tread_1, s.tread_2, s.tread_3, s.tread_4,
         s.tread_min_calculated,
         -- saúde usa o menor entre o informado e o medido (conservador); os dois ficam guardados
         least(s.tread_min_raw, s.tread_min_calculated),
         exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'code' = 'menor_mm_divergente'),
         s.measurement_at, s.measurement_at::date, s.psi, s.calibration_at, s.calibration_at::date, s.km_rodado, s.km_real, s.dot, s.life,
         s.rodopar_condition, s.rodopar_classification, s.rodopar_status_label, s.registration_at, s.serial_number, s.rodopar_created_by,
         s.rodopar_updated_by, s.rodopar_updated_at, s.drawing, s.rubber, s.raw,
         s.vehicle_id, v.license_plate, v.fleet_code, v.vehicle_type_id, ctx.context_source, ctx.operation_id, ctx.operation_city_id,
         ctx.state_id, ctx.city_id, ctx.operation_br_id, ctx.fidelization_assignment_id, ctx.leader_employee_id,
         coalesce(ctx.organization_unit_id, v.organization_unit_id),
         case when s.fleet_number_raw is null then 'sem_frota' when s.vehicle_id is null then 'frota_nao_encontrada'
              when coalesce(ctx.context_source, 'none') = 'none' then 'sem_contexto' else 'ok' end,
         array(select distinct i ->> 'code' from jsonb_array_elements(s.issues) i
                where i ->> 'severity' = 'warning' and i ->> 'code' not in ('sem_data_medicao', 'sem_data_calibragem') order by 1),
         case when exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'severity' = 'warning'
                            and i ->> 'code' not in ('sem_data_medicao', 'sem_data_calibragem')) then 'warning' else 'ok' end
    from public.tire_import_staging s
    left join public.vehicles v on v.id = s.vehicle_id
    left join ctx on ctx.vehicle_id = s.vehicle_id
   where s.batch_id = b.id and s.severity <> 'error' and s.tire_id is not null
  on conflict (tire_id, reference_date) do update set
    import_batch_id = excluded.import_batch_id,
    row_number = excluded.row_number,
    fire_number = excluded.fire_number,
    rodopar_tire_branch = excluded.rodopar_tire_branch,
    unit_code = excluded.unit_code,
    cost_code = excluded.cost_code,
    purchase_date = excluded.purchase_date,
    rodopar_status_raw = excluded.rodopar_status_raw,
    canonical_status = excluded.canonical_status,
    fleet_number_raw = excluded.fleet_number_raw,
    fleet_branch = excluded.fleet_branch,
    brand = excluded.brand,
    model = excluded.model,
    dimension = excluded.dimension,
    dimension_key = excluded.dimension_key,
    position_code = excluded.position_code,
    tread_min_raw = excluded.tread_min_raw,
    tread_1 = excluded.tread_1,
    tread_2 = excluded.tread_2,
    tread_3 = excluded.tread_3,
    tread_4 = excluded.tread_4,
    tread_min_calculated = excluded.tread_min_calculated,
    tread_min = excluded.tread_min,
    tread_divergence = excluded.tread_divergence,
    measurement_at = excluded.measurement_at,
    measurement_date = excluded.measurement_date,
    psi = excluded.psi,
    calibration_at = excluded.calibration_at,
    calibration_date = excluded.calibration_date,
    km_rodado = excluded.km_rodado,
    km_real = excluded.km_real,
    dot = excluded.dot,
    life = excluded.life,
    rodopar_condition = excluded.rodopar_condition,
    rodopar_classification = excluded.rodopar_classification,
    rodopar_status_label = excluded.rodopar_status_label,
    registration_at = excluded.registration_at,
    serial_number = excluded.serial_number,
    rodopar_created_by = excluded.rodopar_created_by,
    rodopar_updated_by = excluded.rodopar_updated_by,
    rodopar_updated_at = excluded.rodopar_updated_at,
    drawing = excluded.drawing,
    rubber = excluded.rubber,
    raw = excluded.raw,
    vehicle_id = excluded.vehicle_id,
    vehicle_plate_snapshot = excluded.vehicle_plate_snapshot,
    fleet_number_snapshot = excluded.fleet_number_snapshot,
    vehicle_type_id = excluded.vehicle_type_id,
    context_source = excluded.context_source,
    operation_id = excluded.operation_id,
    operation_city_id = excluded.operation_city_id,
    state_id = excluded.state_id,
    city_id = excluded.city_id,
    operation_br_id = excluded.operation_br_id,
    fidelization_assignment_id = excluded.fidelization_assignment_id,
    leader_employee_id = excluded.leader_employee_id,
    organization_unit_id = excluded.organization_unit_id,
    enrichment_status = excluded.enrichment_status,
    quality_flags = excluded.quality_flags,
    data_quality_status = excluded.data_quality_status,
    removed_in_revision = false
    where v_replace;
  get diagnostics n_snap = row_count;

  -- revisão: pneu que saiu da planilha no mesmo dia → linha arquivada e marcada
  if v_replace then
    with rem as (
      update public.tire_daily_snapshots x set removed_in_revision = true
       where x.organization_id = p_organization_id and x.reference_date = v_ref
         and x.import_batch_id <> b.id and not x.removed_in_revision
      returning x.tire_id)
    select coalesce(array_agg(rem.tire_id), '{}') into v_removed from rem;
    n_removed := cardinality(v_removed);
  end if;

  -- ---------------------------------------------------------- eventos (comparação com a fotografia anterior do pneu)
  with cur as (
    select ns.*, s.action, prev.id as p_id, prev.canonical_status as p_status, prev.vehicle_id as p_vehicle, prev.fleet_number_raw as p_fleet,
           coalesce(prev.fleet_number_snapshot, prev.fleet_number_raw) as p_fleet_label, prev.vehicle_plate_snapshot as p_plate,
           prev.position_code as p_position, prev.life as p_life, prev.tread_min as p_tread_min, prev.tread_1 as p_t1, prev.tread_2 as p_t2,
           prev.tread_3 as p_t3, prev.tread_4 as p_t4, prev.tread_min_raw as p_tmin_raw, prev.measurement_at as p_meas_at,
           prev.measurement_date as p_meas, prev.psi as p_psi, prev.calibration_at as p_cal_at, prev.calibration_date as p_cal,
           prev.brand as p_brand, prev.model as p_model, prev.dimension as p_dimension, prev.dimension_key as p_dim_key, prev.dot as p_dot,
           prev.drawing as p_drawing, prev.rubber as p_rubber, prev.serial_number as p_serial,
           t.presence_status as t_presence
      from public.tire_daily_snapshots ns
      join public.tire_import_staging s on s.batch_id = b.id and s.tire_id = ns.tire_id
      join public.tires t on t.id = ns.tire_id
      left join lateral (select x.* from public.tire_daily_snapshots x where x.tire_id = ns.tire_id and x.reference_date < v_ref
                          order by x.reference_date desc limit 1) prev on true
     where ns.import_batch_id = b.id),
  cand as (
    select cur.*, e.event_type
      from cur
      cross join lateral (values
        ('TIRE_CREATED', cur.p_id is null),
        ('TIRE_REAPPEARED', cur.p_id is not null and cur.t_presence = 'absent'),
        ('TIRE_RETURNED_TO_STOCK', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status = 'estoque'),
        ('TIRE_SENT_TO_RETREAD', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status = 'ressolagem'),
        ('TIRE_DISCARDED', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status in ('descartado', 'baixado')),
        ('TIRE_STATUS_CHANGED', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status
                                and (cur.canonical_status = 'outro'
                                     or (cur.canonical_status = 'em_uso' and coalesce(cur.p_vehicle::text, cur.p_fleet) is not distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)))),
        ('TIRE_MOVED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.fleet_number_raw is not null
                       and coalesce(cur.p_vehicle::text, cur.p_fleet) is distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)),
        ('TIRE_REMOVED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.p_status = 'em_uso'
                         and cur.p_fleet is not null and cur.fleet_number_raw is null),
        ('TIRE_POSITION_CHANGED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.p_status = 'em_uso'
                                  and coalesce(cur.p_vehicle::text, cur.p_fleet) is not distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)
                                  and cur.p_position is distinct from cur.position_code),
        ('TIRE_LIFE_CHANGED', cur.p_id is not null and cur.p_life is distinct from cur.life),
        ('TIRE_MEASURED', cur.p_id is not null and (cur.p_meas_at is distinct from cur.measurement_at or cur.p_t1 is distinct from cur.tread_1
                          or cur.p_t2 is distinct from cur.tread_2 or cur.p_t3 is distinct from cur.tread_3 or cur.p_t4 is distinct from cur.tread_4
                          or cur.p_tmin_raw is distinct from cur.tread_min_raw)),
        ('TIRE_PRESSURE_UPDATED', cur.p_id is not null and (cur.p_cal_at is distinct from cur.calibration_at or cur.p_psi is distinct from cur.psi)),
        ('TIRE_IMPORTED', cur.p_id is not null and (cur.p_brand is distinct from cur.brand or cur.p_model is distinct from cur.model
                          or cur.p_dim_key is distinct from cur.dimension_key or cur.p_dot is distinct from cur.dot or cur.p_drawing is distinct from cur.drawing
                          or cur.p_rubber is distinct from cur.rubber or cur.p_serial is distinct from cur.serial_number))
      ) e(event_type, happened)
     where e.happened)
  insert into public.tire_events (organization_id, tire_id, event_type, reference_date, import_batch_id, snapshot_id,
                                  previous_values, current_values, vehicle_id, previous_vehicle_id, position_code, previous_position_code, source, actor_user_id)
  select p_organization_id, cand.tire_id, cand.event_type, v_ref, b.id, cand.id,
         case when cand.p_id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
           'status', cand.p_status, 'license_plate', cand.p_plate, 'fleet_number', cand.p_fleet_label, 'position_code', cand.p_position,
           'life', cand.p_life, 'tread_min', cand.p_tread_min, 'tread_1', cand.p_t1, 'tread_2', cand.p_t2, 'tread_3', cand.p_t3, 'tread_4', cand.p_t4,
           'measurement_date', cand.p_meas, 'psi', cand.p_psi, 'calibration_date', cand.p_cal,
           'brand', cand.p_brand, 'model', cand.p_model, 'dimension', cand.p_dimension, 'dot', cand.p_dot, 'drawing', cand.p_drawing,
           'rubber', cand.p_rubber, 'serial_number', cand.p_serial)) end,
         jsonb_strip_nulls(jsonb_build_object(
           'status', cand.canonical_status, 'license_plate', cand.vehicle_plate_snapshot, 'fleet_number', coalesce(cand.fleet_number_snapshot, cand.fleet_number_raw),
           'position_code', cand.position_code, 'life', cand.life, 'tread_min', cand.tread_min, 'tread_1', cand.tread_1, 'tread_2', cand.tread_2,
           'tread_3', cand.tread_3, 'tread_4', cand.tread_4, 'measurement_date', cand.measurement_date, 'psi', cand.psi,
           'calibration_date', cand.calibration_date, 'brand', cand.brand, 'model', cand.model, 'dimension', cand.dimension, 'dot', cand.dot,
           'drawing', cand.drawing, 'rubber', cand.rubber, 'serial_number', cand.serial_number)),
         cand.vehicle_id, cand.p_vehicle, cand.position_code, cand.p_position, 'rodopar_import', auth.uid()
    from cand
  on conflict (tire_id, event_type, reference_date) do nothing;
  get diagnostics n_events = row_count;

  -- ---------------------------------------------------------- cadastro: situação vigente
  update public.tires t set
    serial_number = ns.serial_number, brand = ns.brand, model = ns.model, dimension = ns.dimension, dimension_key = ns.dimension_key,
    dot = ns.dot, drawing = ns.drawing, rubber = ns.rubber,
    purchase_date = coalesce(ns.purchase_date, t.purchase_date), registration_date = coalesce(ns.registration_at::date, t.registration_date),
    current_life = ns.life, current_status = ns.canonical_status, rodopar_status_raw = ns.rodopar_status_raw,
    current_vehicle_id = ns.vehicle_id, current_position_code = ns.position_code, current_snapshot_id = ns.id,
    last_reference_date = v_ref, last_import_batch_id = b.id, presence_status = 'present', absent_since = null
    from public.tire_daily_snapshots ns
   where ns.import_batch_id = b.id and ns.tire_id = t.id;

  -- ---------------------------------------------------------- saíram na revisão do dia: ausentes desde a data
  if n_removed > 0 then
    with gone as (
      update public.tires t set presence_status = 'absent', absent_since = v_ref
       where t.id = any (v_removed) and t.presence_status = 'present'
      returning t.id, t.current_snapshot_id, t.current_vehicle_id, t.current_position_code, t.current_status)
    insert into public.tire_events (organization_id, tire_id, event_type, reference_date, import_batch_id, snapshot_id,
                                    previous_values, current_values, vehicle_id, previous_vehicle_id, position_code, previous_position_code, source, actor_user_id, note)
    select p_organization_id, gone.id, 'TIRE_ABSENT', v_ref, b.id, gone.current_snapshot_id,
           jsonb_build_object('status', gone.current_status, 'position_code', gone.current_position_code), '{}'::jsonb,
           null, gone.current_vehicle_id, null, gone.current_position_code, 'rodopar_import', auth.uid(),
           'Pneu fora da planilha na revisão do mesmo dia: mantido no cadastro com a última situação conhecida.'
      from gone
    on conflict (tire_id, event_type, reference_date) do nothing;
  end if;

  -- ---------------------------------------------------------- ausentes no novo relatório (nunca excluídos)
  with gone as (
    update public.tires t set presence_status = 'absent', absent_since = v_ref
     where t.organization_id = p_organization_id and t.presence_status = 'present' and t.last_reference_date < v_ref
    returning t.id, t.current_snapshot_id, t.current_vehicle_id, t.current_position_code, t.current_status)
  insert into public.tire_events (organization_id, tire_id, event_type, reference_date, import_batch_id, snapshot_id,
                                  previous_values, current_values, vehicle_id, previous_vehicle_id, position_code, previous_position_code, source, actor_user_id, note)
  select p_organization_id, gone.id, 'TIRE_ABSENT', v_ref, b.id, gone.current_snapshot_id,
         jsonb_build_object('status', gone.current_status, 'position_code', gone.current_position_code), '{}'::jsonb,
         null, gone.current_vehicle_id, null, gone.current_position_code, 'rodopar_import', auth.uid(),
         'Pneu ausente no relatório Rodopar desta data: mantido no cadastro com a última situação conhecida.'
    from gone
  on conflict (tire_id, event_type, reference_date) do nothing;
  get diagnostics n_absent = row_count;
  n_absent := n_absent + n_removed;

  -- ---------------------------------------------------------- lote confirmado + reconciliação das vistorias
  update public.tire_import_batches x set status = 'confirmed', confirmed_by = auth.uid(), confirmed_by_name = v_name,
         confirmed_at = now(), updated_at = now(), absent_tires = n_absent
   where x.id = b.id;

  v_recon := private.tire_reconcile_inspections(p_organization_id, b.id);
  update public.tire_import_batches x set reconciliation = v_recon where x.id = b.id;

  if v_replace then perform set_config('hfm.tire_snapshot_revision', '', true); end if;
  v_after := private.tire_after_confirm(p_organization_id, b.id);

  perform private.tire_audit(p_organization_id, case when v_replace then 'import.revised' else 'import.confirmed' end, 'tire_import_batch', b.id,
    format('Dados Rodopar de %s %s (%s pneus, %s novos, %s eventos, %s ausentes)%s.', to_char(v_ref, 'DD/MM/YYYY'),
           case when v_replace then 'revisados no mesmo dia' else 'confirmados' end, n_snap, n_new, n_events, n_absent,
           case when b.source_kind = 'sharepoint' then ' — sincronização com o SharePoint' else ' — envio manual' end),
    case when v_replace then jsonb_build_object('superseded_batch_id', v_old.id, 'file_name', v_old.file_name, 'file_hash', v_old.file_hash) end,
    jsonb_build_object('file_name', b.file_name, 'file_hash', b.file_hash, 'reference_date', v_ref, 'snapshots', n_snap,
                       'new_tires', n_new, 'events', n_events, 'absent', n_absent, 'removed_in_revision', n_removed,
                       'source_kind', b.source_kind, 'sync_run_id', b.sync_run_id, 'reconciliation', v_recon, 'after', v_after));
  perform private.emit_event(p_organization_id, 'tires.snapshot.confirmed', 'tire_import_batch', b.id,
    jsonb_build_object('reference_date', v_ref, 'snapshots', n_snap, 'previous_reference_date', v_prev,
                       'same_day_revision', v_replace, 'source_kind', b.source_kind));

  return jsonb_build_object('batch_id', b.id, 'reference_date', v_ref, 'snapshots', n_snap, 'new_tires', n_new,
                            'updated_tires', b.updated_tires, 'unchanged_tires', b.unchanged_tires, 'events', n_events,
                            'absent', n_absent, 'removed_in_revision', n_removed, 'same_day_revision', v_replace,
                            'reconciliation', v_recon, 'after', v_after);
end;
$$;

create or replace function public.tire_import_cancel(p_organization_id uuid, p_batch_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare b public.tire_import_batches;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id for update;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;
  if b.status = 'confirmed' then
    raise exception 'Lote confirmado não pode ser cancelado: os dados já são oficiais.' using errcode = 'invalid_parameter_value';
  end if;
  if b.status = 'superseded' then
    raise exception 'Versão substituída por uma revisão do mesmo dia: fica guardada como histórico.' using errcode = 'invalid_parameter_value';
  end if;
  if b.status = 'cancelled' then return to_jsonb(b); end if;
  update public.tire_import_batches x set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = left(nullif(btrim(p_reason), ''), 300), updated_at = now()
   where x.id = b.id returning * into b;
  perform private.tire_audit(p_organization_id, 'import.cancelled', 'tire_import_batch', b.id,
    format('Lote %s (%s) descartado sem alterar a base.', b.file_name, to_char(b.reference_date, 'DD/MM/YYYY')));
  return to_jsonb(b);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Sincronização: abrir, registrar etapas, encerrar (o servidor do HFM faz o
--    download pela Microsoft Graph; o banco guarda estado, trava e trilha)
-- -----------------------------------------------------------------------------
create or replace function private.tire_sync_source_json(s public.tire_sync_sources)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'name', s.name, 'provider', s.provider, 'site_hostname', s.site_hostname,
    'site_path', s.site_path, 'drive_name', s.drive_name, 'file_path', s.file_path, 'web_url', s.web_url,
    'is_active', s.is_active, 'min_interval_minutes', s.min_interval_minutes, 'schedule_label', s.schedule_label,
    'resolved_site_id', s.resolved_site_id, 'resolved_drive_id', s.resolved_drive_id, 'resolved_item_id', s.resolved_item_id,
    'last_etag', s.last_etag, 'last_ctag', s.last_ctag, 'last_file_modified_at', s.last_file_modified_at,
    'last_file_hash', s.last_file_hash, 'last_attempt_at', s.last_attempt_at, 'last_success_at', s.last_success_at,
    'last_change_at', s.last_change_at, 'last_status', s.last_status, 'last_error', s.last_error, 'last_run_id', s.last_run_id,
    'consecutive_failures', s.consecutive_failures, 'updated_at', s.updated_at);
$$;

create or replace function public.tire_sync_begin(p_organization_id uuid, p_trigger text, p_reprocess_of uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s     public.tire_sync_sources;
  v_run uuid;
  v_name text;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  if p_trigger not in ('agendada', 'manual', 'reprocessamento') then
    raise exception 'Gatilho de sincronização inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_trigger = 'agendada' and not private.is_privileged_context() then
    raise exception 'A sincronização agendada é disparada só pelo servidor.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.tire_sync_sources x
   where x.organization_id = p_organization_id and x.code = 'rodopar_sharepoint' for update;
  if s.id is null then
    raise exception 'A fonte oficial (SharePoint) não está configurada para esta organização.' using errcode = 'no_data_found', hint = 'tire_sync_no_source';
  end if;
  if p_reprocess_of is not null and not exists (select 1 from public.tire_sync_runs r where r.id = p_reprocess_of and r.source_id = s.id) then
    raise exception 'Execução a reprocessar não encontrada.' using errcode = 'no_data_found';
  end if;

  -- execução presa (servidor caiu no meio): encerrada como falha, com motivo
  update public.tire_sync_runs r set status = 'falhou', step = 'finalizado', finished_at = now(), error_code = 'tempo_esgotado',
         error_message = 'Execução interrompida sem conclusão (tempo limite de 20 minutos).',
         log = r.log || jsonb_build_array(jsonb_build_object('at', now(), 'level', 'error', 'step', r.step,
                                                             'message', 'Encerrada automaticamente: sem conclusão em 20 minutos.'))
   where r.source_id = s.id and r.status = 'em_andamento' and r.started_at < now() - interval '20 minutes';

  if p_trigger = 'agendada' then
    if not s.is_active then
      return jsonb_build_object('skipped', true, 'reason', 'inactive', 'source', private.tire_sync_source_json(s));
    end if;
    if s.last_attempt_at is not null and s.last_attempt_at > now() - make_interval(mins => s.min_interval_minutes) then
      return jsonb_build_object('skipped', true, 'reason', 'interval', 'source', private.tire_sync_source_json(s));
    end if;
  end if;

  v_name := private.tire_actor_name(p_organization_id);
  begin
    insert into public.tire_sync_runs (organization_id, source_id, trigger, requested_by, requested_by_name, reprocess_of, log)
    values (p_organization_id, s.id, p_trigger, auth.uid(), v_name, p_reprocess_of,
            jsonb_build_array(jsonb_build_object('at', now(), 'level', 'info', 'step', 'conectando',
              'message', case p_trigger when 'agendada' then 'Sincronização agendada iniciada.'
                                        when 'manual' then format('Sincronização solicitada por %s.', v_name)
                                        else format('Reprocessamento solicitado por %s.', v_name) end)))
    returning id into v_run;
  exception when unique_violation then
    raise exception 'Já existe uma sincronização em andamento. Aguarde a conclusão.' using errcode = 'lock_not_available', hint = 'tire_sync_running';
  end;
  update public.tire_sync_sources x set last_attempt_at = now(), last_run_id = v_run where x.id = s.id
  returning * into s;

  return jsonb_build_object('skipped', false, 'run_id', v_run, 'source', private.tire_sync_source_json(s),
                            'latest_reference_date', private.tire_latest_reference(p_organization_id),
                            'today', private.maintenance_today(p_organization_id), 'force', p_trigger = 'reprocessamento');
end;
$$;

create or replace function public.tire_sync_log(
  p_organization_id uuid, p_run_id uuid, p_step text, p_level text, p_message text, p_patch jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.tire_sync_runs;
  x jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  select * into r from public.tire_sync_runs t where t.id = p_run_id and t.organization_id = p_organization_id for update;
  if r.id is null then raise exception 'Execução de sincronização não encontrada.' using errcode = 'no_data_found'; end if;
  if r.status <> 'em_andamento' then raise exception 'Esta execução já foi encerrada.' using errcode = 'invalid_parameter_value'; end if;
  if p_level not in ('info', 'warning', 'error') then raise exception 'Nível de log inválido.' using errcode = 'invalid_parameter_value'; end if;

  update public.tire_sync_runs t set
    step = coalesce(p_step, t.step),
    -- o log tem teto (300 entradas); o encerramento sempre entra
    log = case when jsonb_array_length(t.log) >= 300 and coalesce(p_step, '') <> 'finalizado' then t.log
               else t.log || jsonb_build_array(jsonb_build_object('at', now(), 'level', p_level, 'step', coalesce(p_step, t.step),
                                                                  'message', left(p_message, 500))) end,
    file_name = coalesce(left(x ->> 'file_name', 255), t.file_name),
    file_web_url = coalesce(left(x ->> 'file_web_url', 1000), t.file_web_url),
    file_etag = coalesce(left(x ->> 'file_etag', 300), t.file_etag),
    file_ctag = coalesce(left(x ->> 'file_ctag', 300), t.file_ctag),
    file_last_modified = coalesce(nullif(x ->> 'file_last_modified', '')::timestamptz, t.file_last_modified),
    file_size = coalesce(nullif(x ->> 'file_size', '')::bigint, t.file_size),
    file_hash = coalesce(lower(nullif(x ->> 'file_hash', '')), t.file_hash),
    reference_date = coalesce(nullif(x ->> 'reference_date', '')::date, t.reference_date),
    batch_id = coalesce(nullif(x ->> 'batch_id', '')::uuid, t.batch_id),
    same_day_revision = coalesce(nullif(x ->> 'same_day_revision', '')::boolean, t.same_day_revision),
    structure = case when x ? 'structure' then x -> 'structure' else t.structure end,
    counters = case when x ? 'counters' then t.counters || (x -> 'counters') else t.counters end
   where t.id = r.id;

  if x ? 'resolved' then
    update public.tire_sync_sources s set
      resolved_site_id = coalesce(left(x -> 'resolved' ->> 'site_id', 300), s.resolved_site_id),
      resolved_drive_id = coalesce(left(x -> 'resolved' ->> 'drive_id', 300), s.resolved_drive_id),
      resolved_item_id = coalesce(left(x -> 'resolved' ->> 'item_id', 300), s.resolved_item_id)
     where s.id = r.source_id;
  end if;
end;
$$;

create or replace function public.tire_sync_finish(
  p_organization_id uuid, p_run_id uuid, p_status text, p_error_code text default null, p_error_message text default null,
  p_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.tire_sync_runs;
  v_ok   boolean := p_status in ('concluida', 'concluida_com_avisos', 'sem_alteracao');
  v_text text;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  if p_status not in ('concluida', 'concluida_com_avisos', 'sem_alteracao', 'bloqueada', 'falhou') then
    raise exception 'Resultado de sincronização inválido.' using errcode = 'invalid_parameter_value';
  end if;
  perform public.tire_sync_log(p_organization_id, p_run_id, 'finalizado',
    case when p_status = 'falhou' then 'error' when p_status in ('bloqueada', 'concluida_com_avisos') then 'warning' else 'info' end,
    coalesce(p_error_message, case p_status when 'concluida' then 'Sincronização concluída.'
                                            when 'concluida_com_avisos' then 'Sincronização concluída com avisos de qualidade.'
                                            when 'sem_alteracao' then 'A planilha não mudou desde a última sincronização.'
                                            else 'Sincronização encerrada.' end),
    coalesce(p_patch, '{}'::jsonb));

  update public.tire_sync_runs t set status = p_status, finished_at = now(), error_code = left(p_error_code, 60),
         error_message = left(p_error_message, 1000)
   where t.id = p_run_id
  returning * into r;

  update public.tire_sync_sources s set
    last_status = p_status,
    last_run_id = r.id,
    last_error = case when v_ok then null else coalesce(left(p_error_message, 1000), p_status) end,
    consecutive_failures = case when v_ok then 0 else s.consecutive_failures + 1 end,
    last_success_at = case when v_ok then now() else s.last_success_at end,
    last_change_at = case when p_status in ('concluida', 'concluida_com_avisos') then now() else s.last_change_at end,
    last_etag = case when v_ok and r.file_etag is not null then r.file_etag else s.last_etag end,
    last_ctag = case when v_ok and r.file_ctag is not null then r.file_ctag else s.last_ctag end,
    last_file_modified_at = case when v_ok and r.file_last_modified is not null then r.file_last_modified else s.last_file_modified_at end,
    last_file_hash = case when v_ok and r.file_hash is not null then r.file_hash else s.last_file_hash end
   where s.id = r.source_id;

  v_text := case p_status
    when 'concluida' then format('Sincronização com o SharePoint concluída: dados de %s.', to_char(r.reference_date, 'DD/MM/YYYY'))
    when 'concluida_com_avisos' then format('Sincronização com o SharePoint concluída com avisos: dados de %s.', to_char(r.reference_date, 'DD/MM/YYYY'))
    when 'sem_alteracao' then 'Sincronização com o SharePoint: planilha sem alteração.'
    when 'bloqueada' then format('Sincronização com o SharePoint bloqueada: %s', coalesce(p_error_message, p_error_code))
    else format('Sincronização com o SharePoint falhou: %s', coalesce(p_error_message, p_error_code)) end;
  perform private.tire_audit(p_organization_id, 'sync.' || p_status, 'tire_sync_run', r.id, left(v_text, 500), null,
    jsonb_build_object('trigger', r.trigger, 'status', p_status, 'error_code', p_error_code, 'file_name', r.file_name,
                       'file_etag', r.file_etag, 'file_hash', r.file_hash, 'reference_date', r.reference_date,
                       'batch_id', r.batch_id, 'counters', r.counters));
  if not v_ok then
    perform private.emit_event(p_organization_id, 'tires.sync.failed', 'tire_sync_run', r.id,
      jsonb_build_object('status', p_status, 'error_code', p_error_code, 'message', left(p_error_message, 500), 'trigger', r.trigger));
  end if;
  return to_jsonb(r) - 'log';
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Leitura da sincronização (tela Sincronização Rodopar) e configuração
-- -----------------------------------------------------------------------------
create or replace function public.tire_sync_overview(p_organization_id uuid, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s        public.tire_sync_sources;
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_cur    public.tire_import_batches;
  v_open   public.tire_import_batches;
begin
  if not (private.has_permission(p_organization_id, 'tires.import') or private.has_permission(p_organization_id, 'tires.audit.view')
          or private.is_privileged_context()) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  select * into s from public.tire_sync_sources x where x.organization_id = p_organization_id and x.code = 'rodopar_sharepoint';
  select * into v_cur from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_latest;
  select * into v_open from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status in ('staging', 'validated', 'blocked')
   order by b.created_at desc limit 1;

  return jsonb_build_object(
    'source', case when s.id is null then null else private.tire_sync_source_json(s) end,
    'latest_reference_date', v_latest,
    'today', private.maintenance_today(p_organization_id),
    'current_batch', case when v_cur.id is null then null else jsonb_build_object(
        'id', v_cur.id, 'file_name', v_cur.file_name, 'reference_date', v_cur.reference_date, 'source_kind', v_cur.source_kind,
        'confirmed_at', v_cur.confirmed_at, 'confirmed_by_name', v_cur.confirmed_by_name, 'total_rows', v_cur.total_rows,
        'warning_rows', v_cur.warning_rows, 'new_tires', v_cur.new_tires, 'updated_tires', v_cur.updated_tires,
        'unchanged_tires', v_cur.unchanged_tires, 'absent_tires', v_cur.absent_tires, 'reappeared_tires', v_cur.reappeared_tires,
        'supersedes_batch_id', v_cur.supersedes_batch_id, 'sync_run_id', v_cur.sync_run_id) end,
    'open_batch', case when v_open.id is null then null else jsonb_build_object(
        'id', v_open.id, 'file_name', v_open.file_name, 'reference_date', v_open.reference_date, 'status', v_open.status,
        'source_kind', v_open.source_kind, 'block_reason', v_open.block_reason, 'created_at', v_open.created_at,
        'error_rows', v_open.error_rows, 'warning_rows', v_open.warning_rows, 'total_rows', v_open.total_rows) end,
    'running', (select to_jsonb(r) - 'log' from public.tire_sync_runs r
                 where r.organization_id = p_organization_id and r.status = 'em_andamento' order by r.started_at desc limit 1),
    'stats_30d', (select jsonb_build_object(
        'runs', count(*),
        'succeeded', count(*) filter (where r.status in ('concluida', 'concluida_com_avisos')),
        'unchanged', count(*) filter (where r.status = 'sem_alteracao'),
        'blocked', count(*) filter (where r.status = 'bloqueada'),
        'failed', count(*) filter (where r.status = 'falhou'))
       from public.tire_sync_runs r where r.organization_id = p_organization_id and r.started_at > now() - interval '30 days'),
    'total', (select count(*) from public.tire_sync_runs r where r.organization_id = p_organization_id),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc)
                        from (select * from public.tire_sync_runs r where r.organization_id = p_organization_id
                               order by r.started_at desc limit v_limit offset v_offset) r), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.tire_sync_save_source(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.tire_sync_sources;
  n      public.tire_sync_sources;
  x      jsonb := coalesce(p_payload, '{}'::jsonb);
  v_host text := lower(nullif(btrim(x ->> 'site_hostname'), ''));
  v_site text := nullif(btrim(x ->> 'site_path'), '');
  v_drv  text := nullif(btrim(x ->> 'drive_name'), '');
  v_file text := nullif(btrim(btrim(x ->> 'file_path'), '/'), '');
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  select * into s from public.tire_sync_sources t where t.organization_id = p_organization_id and t.code = 'rodopar_sharepoint' for update;
  if v_host is null or v_host !~ '^[a-z0-9-]+\.sharepoint\.com$' then
    raise exception 'Informe o endereço do SharePoint (ex.: empresa.sharepoint.com).' using errcode = 'invalid_parameter_value';
  end if;
  if v_site is null or v_site !~ '^/sites/[^/]+$' then
    raise exception 'Informe o site no formato /sites/NomeDoSite.' using errcode = 'invalid_parameter_value';
  end if;
  if v_drv is null then raise exception 'Informe a biblioteca de documentos.' using errcode = 'invalid_parameter_value'; end if;
  if v_file is null or v_file !~* '\.xlsx$' then
    raise exception 'Informe o caminho do arquivo XLSX dentro da biblioteca.' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(nullif(x ->> 'min_interval_minutes', '')::integer, 60) not between 5 and 10080 then
    raise exception 'O intervalo mínimo entre sincronizações vai de 5 minutos a 7 dias.' using errcode = 'invalid_parameter_value';
  end if;

  if s.id is null then
    insert into public.tire_sync_sources (organization_id, site_hostname, site_path, drive_name, file_path, web_url, is_active, min_interval_minutes)
    values (p_organization_id, v_host, v_site, v_drv, v_file, left(nullif(btrim(x ->> 'web_url'), ''), 1000),
            coalesce(nullif(x ->> 'is_active', '')::boolean, true), coalesce(nullif(x ->> 'min_interval_minutes', '')::integer, 60))
    returning * into n;
  else
    update public.tire_sync_sources t set
      site_hostname = v_host, site_path = v_site, drive_name = v_drv, file_path = v_file,
      web_url = coalesce(left(nullif(btrim(x ->> 'web_url'), ''), 1000), t.web_url),
      is_active = coalesce(nullif(x ->> 'is_active', '')::boolean, t.is_active),
      min_interval_minutes = coalesce(nullif(x ->> 'min_interval_minutes', '')::integer, t.min_interval_minutes),
      -- outro arquivo/local: a localização resolvida e a última versão lida deixam de valer
      resolved_site_id = case when (v_host, v_site) is distinct from (t.site_hostname, t.site_path) then null else t.resolved_site_id end,
      resolved_drive_id = case when (v_host, v_site, v_drv) is distinct from (t.site_hostname, t.site_path, t.drive_name) then null else t.resolved_drive_id end,
      resolved_item_id = case when (v_host, v_site, v_drv, v_file) is distinct from (t.site_hostname, t.site_path, t.drive_name, t.file_path) then null else t.resolved_item_id end,
      last_etag = case when (v_host, v_site, v_drv, v_file) is distinct from (t.site_hostname, t.site_path, t.drive_name, t.file_path) then null else t.last_etag end,
      last_ctag = case when (v_host, v_site, v_drv, v_file) is distinct from (t.site_hostname, t.site_path, t.drive_name, t.file_path) then null else t.last_ctag end
     where t.id = s.id
    returning * into n;
  end if;
  perform private.tire_audit(p_organization_id, 'sync.source_saved', 'tire_sync_source', n.id,
    format('Fonte oficial dos pneus atualizada: %s%s · %s/%s (%s).', n.site_hostname, n.site_path, n.drive_name, n.file_path,
           case when n.is_active then 'ativa' else 'pausada' end),
    case when s.id is null then null else private.tire_sync_source_json(s) end, private.tire_sync_source_json(n));
  return private.tire_sync_source_json(n);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_sync_source_json(public.tire_sync_sources) from public, anon;
revoke execute on function private.tg_tire_snapshot_revision() from public, anon, authenticated;
revoke execute on function public.tire_sync_begin(uuid, text, uuid), public.tire_sync_log(uuid, uuid, text, text, text, jsonb),
  public.tire_sync_finish(uuid, uuid, text, text, text, jsonb), public.tire_sync_overview(uuid, integer, integer),
  public.tire_sync_save_source(uuid, jsonb)
  from public, anon;
grant execute on function public.tire_sync_begin(uuid, text, uuid), public.tire_sync_log(uuid, uuid, text, text, text, jsonb),
  public.tire_sync_finish(uuid, uuid, text, text, text, jsonb), public.tire_sync_overview(uuid, integer, integer),
  public.tire_sync_save_source(uuid, jsonb)
  to authenticated, service_role;
