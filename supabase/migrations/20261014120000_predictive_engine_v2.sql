-- =============================================================================
-- HFM · Manutenção Preditiva v2 — motor de saúde técnica da frota
--
-- Evolui a preditiva da Etapa 16 (planos versionados, ciclos por frota × item,
-- bandas paramétricas, verificação, cobertura, baixa manual) sem recriar
-- entidade nenhuma. O que entra:
--
--   PARTE 1  Esquema e parâmetros
--     * idade máxima do KM oficial, SLAs por criticidade e janelas de previsão
--       em `maintenance_settings`; vigência do plano (`valid_from/valid_to`);
--     * cache de situação do ciclo (`status_cache`, `status_changed_at`) para
--       o comparativo previsto × realizado;
--     * `maintenance_predictive_events` — a linha do tempo imutável de cada
--       ciclo (verificação, reinício por manutenção, baixa, monitoramento,
--       mudança de situação, referência histórica, versão do plano);
--     * `maintenance_predictive_submissions` — o envio do aplicativo
--       (protocolo, idempotência, contexto do veículo na data);
--     * `maintenance_predictive_quality_issues` — inconsistências de dados
--       persistidas (detectada/resolvida), nunca corrigidas em silêncio;
--     * `maintenance_predictive_snapshots` — foto diária dos indicadores
--       (tendências);
--     * capabilities granulares `maintenance.predictive.*` e o aplicativo
--       "Verificação Preditiva de Frota" (`applications.predictive.execute`).
--
--   PARTE 2  Motor (server-side)
--     * plano aplicável com vigência e detecção de ambiguidade;
--     * sincronização por veículo que registra eventos, reativa ciclos e
--       re-resolve a referência histórica (importações);
--     * estado v2 com idade do KM, KM desatualizado e "desde quando";
--     * registro de verificação compartilhado pelo portal e pelo aplicativo;
--     * eventos nas baixas, gerações, conclusões de manutenção;
--     * gatilho em `vehicles` (tipo, subcategoria, modelo, situação);
--     * qualidade de dados, snapshot diário e rotina diária v2.
--
-- Compatibilidade: nenhuma assinatura existente muda; as rotinas antigas
-- continuam válidas. Nada é apagado: ciclos saem de cena com `is_active`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARTE 1 · 1.1 Parâmetros
-- -----------------------------------------------------------------------------
alter table public.maintenance_settings
  add column if not exists predictive_km_max_age_days integer not null default 30,
  add column if not exists predictive_sla_days jsonb not null default '{"critical": 2, "high": 5, "medium": 10, "low": 20}'::jsonb,
  add column if not exists predictive_forecast_km_windows integer[] not null default '{1000,2500,5000,10000}',
  add column if not exists predictive_forecast_day_windows integer[] not null default '{7,15,30,60}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_settings_predictive_v2_check') then
    alter table public.maintenance_settings add constraint maintenance_settings_predictive_v2_check check (
      predictive_km_max_age_days between 1 and 365
      and jsonb_typeof(predictive_sla_days) = 'object'
      and cardinality(predictive_forecast_km_windows) between 1 and 8
      and cardinality(predictive_forecast_day_windows) between 1 and 8);
  end if;
end $$;

-- 1.2 Vigência do plano técnico
alter table public.maintenance_predictive_plans
  add column if not exists valid_from date,
  add column if not exists valid_to date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_predictive_plans_validity_check') then
    alter table public.maintenance_predictive_plans add constraint maintenance_predictive_plans_validity_check
      check (valid_from is null or valid_to is null or valid_from <= valid_to);
  end if;
end $$;

-- 1.3 Cache de situação do ciclo (para "desde quando", SLA e previsto × realizado)
alter table public.maintenance_predictive_cycles
  add column if not exists status_cache text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists evaluated_at timestamptz;

create index if not exists maintenance_predictive_cycles_item_idx
  on public.maintenance_predictive_cycles (organization_id, plan_item_id) where is_active;
create index if not exists maintenance_predictive_cycles_active_vehicle_idx
  on public.maintenance_predictive_cycles (organization_id, vehicle_id) where is_active;
create index if not exists maintenance_predictive_cycles_status_idx
  on public.maintenance_predictive_cycles (organization_id, status_cache) where is_active;

-- 1.4 Verificações: origem e envio do aplicativo
alter table public.maintenance_predictive_verifications
  add column if not exists source text not null default 'portal',
  add column if not exists submission_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_predictive_verifications_source_check') then
    alter table public.maintenance_predictive_verifications add constraint maintenance_predictive_verifications_source_check
      check (source in ('portal', 'app', 'import'));
  end if;
end $$;

create index if not exists maintenance_predictive_verifications_vehicle_idx
  on public.maintenance_predictive_verifications (organization_id, vehicle_id, verified_on desc);
create index if not exists maintenance_predictive_verifications_submission_idx
  on public.maintenance_predictive_verifications (organization_id, submission_id) where submission_id is not null;
create index if not exists maintenance_predictive_verifications_result_idx
  on public.maintenance_predictive_verifications (organization_id, result, verified_on desc);

-- 1.5 Envio do aplicativo (cabeçalho, protocolo, idempotência, contexto na data)
create table if not exists public.maintenance_predictive_submissions (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  protocol                 text not null,
  app_id                   uuid,
  vehicle_id               uuid not null,
  license_plate_snapshot   text,
  fleet_code_snapshot      text,
  vehicle_type_id          uuid,
  verified_on              date not null,
  verified_at              timestamptz not null default now(),
  operation_id             uuid,
  operation_city_id        uuid,
  state_id                 smallint,
  city_id                  integer,
  operation_br_id          uuid,
  leader_employee_id       uuid,
  operation_name_snapshot  text,
  city_name_snapshot       text,
  state_uf_snapshot        text,
  br_code_snapshot         text,
  leader_name_snapshot     text,
  inspector_user_id        uuid references auth.users (id) on delete set null,
  inspector_employee_id    uuid,
  inspector_name_snapshot  text not null,
  inspector_code_snapshot  text,
  km_official              integer,
  km_official_date         date,
  km_informed              integer,
  km_justification         text,
  general_observation      text,
  total_items              integer not null default 0,
  total_conforming         integer not null default 0,
  total_monitoring         integer not null default 0,
  total_non_conforming     integer not null default 0,
  total_not_performed      integer not null default 0,
  maintenances_opened      integer not null default 0,
  client_submission_id     uuid not null,
  created_at               timestamptz not null default now(),
  constraint maintenance_predictive_submissions_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_submissions_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_submissions_protocol_key unique (organization_id, protocol),
  constraint maintenance_predictive_submissions_client_key unique (organization_id, client_submission_id),
  constraint maintenance_predictive_submissions_name_check check (length(btrim(inspector_name_snapshot)) between 2 and 160),
  constraint maintenance_predictive_submissions_km_check check (
    (km_informed is null or km_informed between 0 and 9999999) and (km_official is null or km_official between 0 and 9999999)),
  constraint maintenance_predictive_submissions_text_check check (
    (km_justification is null or length(km_justification) <= 500) and (general_observation is null or length(general_observation) <= 2000))
);
create index if not exists maintenance_predictive_submissions_vehicle_idx
  on public.maintenance_predictive_submissions (organization_id, vehicle_id, verified_on desc);
create index if not exists maintenance_predictive_submissions_user_idx
  on public.maintenance_predictive_submissions (organization_id, inspector_user_id, created_at desc);

-- 1.6 Linha do tempo imutável do ciclo
create table if not exists public.maintenance_predictive_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  vehicle_id       uuid not null,
  cycle_id         uuid not null,
  plan_item_id     uuid not null,
  cluster_id       uuid,
  event_type       text not null,
  source           text not null default 'user',
  occurred_on      date not null,
  occurred_at      timestamptz not null default now(),
  km               integer,
  result           text,
  from_status      text,
  to_status        text,
  reference_type   text,
  coverage         text,
  maintenance_id   uuid,
  verification_id  uuid,
  submission_id    uuid,
  actor_user_id    uuid,
  actor_name       text,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint maintenance_predictive_events_org_id_key unique (organization_id, id),
  constraint maintenance_predictive_events_cycle_fkey foreign key (organization_id, cycle_id)
    references public.maintenance_predictive_cycles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_events_vehicle_fkey foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_predictive_events_type_check check (event_type in (
    'cycle_created', 'cycle_deactivated', 'cycle_reactivated', 'history_reference', 'verification',
    'monitoring_started', 'monitoring_closed', 'maintenance_generated', 'maintenance_restart', 'maintenance_reopened',
    'manual_reset', 'status_changed', 'plan_version')),
  constraint maintenance_predictive_events_source_check check (source in ('user', 'app', 'system', 'import')),
  constraint maintenance_predictive_events_details_check check (jsonb_typeof(details) = 'object')
);
create index if not exists maintenance_predictive_events_cycle_idx
  on public.maintenance_predictive_events (organization_id, cycle_id, occurred_at desc);
create index if not exists maintenance_predictive_events_vehicle_idx
  on public.maintenance_predictive_events (organization_id, vehicle_id, occurred_at desc);
create index if not exists maintenance_predictive_events_type_idx
  on public.maintenance_predictive_events (organization_id, event_type, occurred_on desc);

-- 1.7 Qualidade de dados (detectada → resolvida; nada corrigido em silêncio)
create table if not exists public.maintenance_predictive_quality_issues (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  issue_type       text not null,
  severity         text not null,
  vehicle_id       uuid,
  cycle_id         uuid,
  plan_id          uuid,
  plan_item_id     uuid,
  cluster_id       uuid,
  message          text not null,
  details          jsonb not null default '{}'::jsonb,
  detected_at      timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  constraint maintenance_predictive_quality_type_check check (issue_type in (
    'vehicle_no_plan', 'plan_ambiguous', 'vehicle_no_km', 'km_stale', 'cluster_without_rule', 'service_without_coverage',
    'cycle_without_reference', 'maintenance_without_km', 'verification_without_km', 'reference_in_future',
    'reference_km_above_current', 'negative_cycle')),
  constraint maintenance_predictive_quality_severity_check check (severity in ('low', 'medium', 'high', 'critical')),
  constraint maintenance_predictive_quality_details_check check (jsonb_typeof(details) = 'object')
);
create unique index if not exists maintenance_predictive_quality_open_key
  on public.maintenance_predictive_quality_issues (
    organization_id, issue_type,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(plan_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where resolved_at is null;
create index if not exists maintenance_predictive_quality_open_idx
  on public.maintenance_predictive_quality_issues (organization_id, severity, issue_type) where resolved_at is null;

-- 1.8 Foto diária dos indicadores (tendências)
create table if not exists public.maintenance_predictive_snapshots (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  snapshot_date    date not null,
  operation_id     uuid,
  metrics          jsonb not null,
  created_at       timestamptz not null default now(),
  constraint maintenance_predictive_snapshots_metrics_check check (jsonb_typeof(metrics) = 'object')
);
create unique index if not exists maintenance_predictive_snapshots_key
  on public.maintenance_predictive_snapshots (organization_id, snapshot_date, coalesce(operation_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 1.9 RLS: leitura pela permissão de manutenção e pelo escopo do veículo
alter table public.maintenance_predictive_submissions    enable row level security;
alter table public.maintenance_predictive_events         enable row level security;
alter table public.maintenance_predictive_quality_issues enable row level security;
alter table public.maintenance_predictive_snapshots      enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'maintenance_predictive_submissions'
                   and policyname = 'maintenance_predictive_submissions_select') then
    create policy maintenance_predictive_submissions_select on public.maintenance_predictive_submissions
      for select to authenticated
      using ((organization_id in (select private.permitted_org_ids('maintenance.view'))
              and private.vehicle_in_scope(organization_id, vehicle_id))
             or inspector_user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'maintenance_predictive_events'
                   and policyname = 'maintenance_predictive_events_select') then
    create policy maintenance_predictive_events_select on public.maintenance_predictive_events
      for select to authenticated
      using (organization_id in (select private.permitted_org_ids('maintenance.view'))
             and private.vehicle_in_scope(organization_id, vehicle_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'maintenance_predictive_quality_issues'
                   and policyname = 'maintenance_predictive_quality_issues_select') then
    create policy maintenance_predictive_quality_issues_select on public.maintenance_predictive_quality_issues
      for select to authenticated
      using (organization_id in (select private.permitted_org_ids('maintenance.view'))
             and (vehicle_id is null or private.vehicle_in_scope(organization_id, vehicle_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'maintenance_predictive_snapshots'
                   and policyname = 'maintenance_predictive_snapshots_select') then
    create policy maintenance_predictive_snapshots_select on public.maintenance_predictive_snapshots
      for select to authenticated
      using (organization_id in (select private.permitted_org_ids('maintenance.view'))
             and (operation_id is null or operation_id in (select private.accessible_operation_ids())));
  end if;
end $$;

-- Carimbos e auditoria nas tabelas que mudam (os eventos e as fotos são imutáveis).
create or replace trigger maintenance_predictive_submissions_audit
  after insert or update on public.maintenance_predictive_submissions
  for each row execute function private.tg_audit();

-- 1.10 Capabilities granulares (compatíveis com `maintenance.manage_predictive`)
insert into public.permissions (code, module, name, description) values
  ('maintenance.predictive.view',                 'maintenance', 'Ver Preditiva',                       'Painel, matriz, alertas, qualidade e histórico da manutenção preditiva.'),
  ('maintenance.predictive.verify',               'maintenance', 'Registrar verificação preditiva',     'Registra o resultado técnico de um ciclo (conforme, monitoramento, não conforme, não realizada) pelo portal.'),
  ('maintenance.predictive.generate_maintenance', 'maintenance', 'Gerar manutenção preditiva',          'Abre a manutenção do item técnico a partir do ciclo ou da não conformidade.'),
  ('maintenance.predictive.manual_reset',         'maintenance', 'Baixa manual autorizada (preditiva)', 'Reinicia um ciclo sem verificação nem manutenção, com data, KM e motivo auditados.'),
  ('maintenance.predictive.plans.manage',         'maintenance', 'Gerir planos preditivos',             'Planos técnicos, itens, roteiros, coberturas, aprovação e versões.'),
  ('maintenance.predictive.recalculate',          'maintenance', 'Recalcular motor preditivo',          'Sincroniza ciclos, re-resolve referências e reprocessa a qualidade de dados.'),
  ('maintenance.predictive.audit.view',           'maintenance', 'Ver auditoria preditiva',             'Linha do tempo de eventos do motor preditivo (verificações, reinícios, baixas, situações).'),
  ('applications.predictive.execute',             'applications','Executar Verificação Preditiva',      'Realiza verificações preditivas no aplicativo de campo e acompanha os próprios envios.')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('gestor_frota')) p(profile_code)
  cross join (select code from public.permissions where code like 'maintenance.predictive.%' or code = 'applications.predictive.execute') c
union all
select v.profile_code, v.permission_code
  from (values
    ('gestao',              'maintenance.predictive.view'),
    ('gestao',              'maintenance.predictive.audit.view'),
    ('seguranca',           'maintenance.predictive.view'),
    ('lideranca_operacoes', 'maintenance.predictive.view'),
    ('lideranca_operacoes', 'maintenance.predictive.verify'),
    ('lideranca_operacoes', 'maintenance.predictive.generate_maintenance'),
    ('lideranca_operacoes', 'applications.predictive.execute'),
    ('operacional',         'applications.predictive.execute')) v(profile_code, permission_code)
on conflict do nothing;

-- 1.11 Aplicativo "Verificação Preditiva de Frota" (vínculos espelhados do Check List)
do $app$
declare o record; v_app uuid; v_src uuid;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active' loop
    insert into public.operational_apps
      (organization_id, code, name, slug, description, platform, is_active, is_official, is_configurable, allows_attachments)
    values (o.id, 'verificacao_preditiva', 'Verificação Preditiva de Frota', 'verificacao-preditiva',
            'Inspeção técnica dos clusters do plano preditivo (roteiro automático por frota, desfecho por cluster e abertura de manutenção).',
            'mobile_responsive', true, true, false, false)
    on conflict (organization_id, code) do update
      set slug = excluded.slug, name = excluded.name, description = excluded.description, is_active = true, deleted_at = null, updated_at = now()
    returning id into v_app;
    select a.id into v_src from public.operational_apps a
     where a.organization_id = o.id and a.code = 'checklist_frota' and a.deleted_at is null;
    if v_src is not null then
      insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled, effective_from, effective_to)
      select o.id, v_app, l.operation_id, l.is_enabled, l.effective_from, l.effective_to
        from public.checklist_app_operations l where l.app_id = v_src
      on conflict (app_id, operation_id) do nothing;
      insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled, effective_from, effective_to)
      select o.id, l.vehicle_type_id, v_app, l.is_enabled, l.effective_from, l.effective_to
        from public.vehicle_type_apps l where l.app_id = v_src
      on conflict (organization_id, vehicle_type_id, app_id) do nothing;
    end if;
  end loop;
end $app$;

-- 1.12 Verificação de capability (o código novo OU o legado equivalente)
create or replace function private.maintenance_predictive_can(p_organization_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_action
    when 'view'        then private.has_permission(p_organization_id, 'maintenance.predictive.view')
                            or private.has_permission(p_organization_id, 'maintenance.view')
    when 'verify'      then private.has_permission(p_organization_id, 'maintenance.predictive.verify')
                            or private.has_permission(p_organization_id, 'maintenance.manage_predictive')
    when 'generate'    then private.has_permission(p_organization_id, 'maintenance.predictive.generate_maintenance')
                            or private.has_permission(p_organization_id, 'maintenance.manage_predictive')
    when 'reset'       then private.has_permission(p_organization_id, 'maintenance.predictive.manual_reset')
                            or private.has_permission(p_organization_id, 'maintenance.manage_predictive')
    when 'plans'       then private.has_permission(p_organization_id, 'maintenance.predictive.plans.manage')
                            or private.has_permission(p_organization_id, 'maintenance.manage_predictive')
    when 'recalculate' then private.has_permission(p_organization_id, 'maintenance.predictive.recalculate')
                            or private.has_permission(p_organization_id, 'maintenance.manage_predictive')
                            or private.has_permission(p_organization_id, 'maintenance.reprocess')
    when 'audit'       then private.has_permission(p_organization_id, 'maintenance.predictive.audit.view')
                            or private.has_permission(p_organization_id, 'maintenance.view_audit')
    when 'app'         then private.has_permission(p_organization_id, 'applications.predictive.execute')
    else false
  end;
$$;
revoke execute on function private.maintenance_predictive_can(uuid, text) from public, anon;
grant  execute on function private.maintenance_predictive_can(uuid, text) to authenticated, service_role;

create or replace function private.maintenance_predictive_require(p_organization_id uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.maintenance_predictive_can(p_organization_id, p_action) then
    raise exception 'Você não possui permissão para esta ação na manutenção preditiva.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke execute on function private.maintenance_predictive_require(uuid, text) from public, anon;
grant  execute on function private.maintenance_predictive_require(uuid, text) to authenticated, service_role;

-- 1.13 Escritor de eventos (linha do tempo imutável)
create or replace function private.maintenance_predictive_event(
  p_cycle_id uuid, p_event_type text, p_source text default 'user', p_details jsonb default '{}'::jsonb,
  p_occurred_on date default null, p_km integer default null, p_result text default null,
  p_from_status text default null, p_to_status text default null, p_reference_type text default null, p_coverage text default null,
  p_maintenance_id uuid default null, p_verification_id uuid default null, p_submission_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle  public.maintenance_predictive_cycles;
  v_item   public.maintenance_predictive_plan_items;
  v_id     uuid;
  v_actor  text;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    return null;
  end if;
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  v_actor := case when auth.uid() is null then case when p_source = 'import' then 'Importação' else 'Rotina automática' end
                  else private.maintenance_actor_name(v_cycle.organization_id) end;
  insert into public.maintenance_predictive_events
    (organization_id, vehicle_id, cycle_id, plan_item_id, cluster_id, event_type, source, occurred_on, km, result,
     from_status, to_status, reference_type, coverage, maintenance_id, verification_id, submission_id, actor_user_id, actor_name, details)
  values
    (v_cycle.organization_id, v_cycle.vehicle_id, v_cycle.id, v_cycle.plan_item_id, v_item.cluster_id, p_event_type, p_source,
     coalesce(p_occurred_on, private.maintenance_today(v_cycle.organization_id)), p_km, p_result,
     p_from_status, p_to_status, p_reference_type, p_coverage, p_maintenance_id, p_verification_id, p_submission_id,
     auth.uid(), v_actor, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function private.maintenance_predictive_event(uuid, text, text, jsonb, date, integer, text, text, text, text, text, uuid, uuid, uuid) from public, anon;
grant  execute on function private.maintenance_predictive_event(uuid, text, text, jsonb, date, integer, text, text, text, text, text, uuid, uuid, uuid) to authenticated, service_role;

-- =============================================================================
-- PARTE 2 · Motor
-- =============================================================================

-- 2.1 Plano aplicável: + vigência. Empate na especificidade máxima = ambiguidade
-- (detectada em `maintenance_predictive_plan_ambiguous` e na qualidade de dados).
create or replace function private.maintenance_predictive_plan_candidates(p_vehicle_id uuid)
returns table (plan_id uuid, specificity integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         (case when p.vehicle_model_id is not null then 8 else 0 end)
         + (case when p.vehicle_make_id is not null then 4 else 0 end)
         + (case when p.vehicle_subcategory_id is not null then 2 else 0 end)
         + (case when p.year_from is not null or p.year_to is not null then 1 else 0 end),
         p.updated_at
    from public.vehicles v
    left join public.vehicle_models vm on vm.id = v.vehicle_model_id
    join public.maintenance_predictive_plans p
      on p.organization_id = v.organization_id and p.vehicle_type_id = v.vehicle_type_id
   where v.id = p_vehicle_id
     and p.deleted_at is null and p.is_active and p.approval_status = 'approved'
     and (p.valid_from is null or p.valid_from <= private.maintenance_today(v.organization_id))
     and (p.valid_to is null or p.valid_to >= private.maintenance_today(v.organization_id))
     and (p.vehicle_subcategory_id is null or p.vehicle_subcategory_id = v.vehicle_subcategory_id)
     and (p.vehicle_model_id is null or p.vehicle_model_id = v.vehicle_model_id)
     and (p.vehicle_make_id is null or p.vehicle_make_id = vm.vehicle_make_id)
     and (p.year_from is null or coalesce(v.model_year, v.manufacture_year) >= p.year_from)
     and (p.year_to is null or coalesce(v.model_year, v.manufacture_year) <= p.year_to);
$$;
revoke execute on function private.maintenance_predictive_plan_candidates(uuid) from public, anon;
grant  execute on function private.maintenance_predictive_plan_candidates(uuid) to authenticated, service_role;

create or replace function private.maintenance_predictive_plan_for(p_vehicle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.plan_id from private.maintenance_predictive_plan_candidates(p_vehicle_id) c
   order by c.specificity desc, c.updated_at desc
   limit 1;
$$;

create or replace function private.maintenance_predictive_plan_ambiguous(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select count(*) > 1
                     from private.maintenance_predictive_plan_candidates(p_vehicle_id) c
                    where c.specificity = (select max(specificity) from private.maintenance_predictive_plan_candidates(p_vehicle_id))), false);
$$;
revoke execute on function private.maintenance_predictive_plan_ambiguous(uuid) from public, anon;
grant  execute on function private.maintenance_predictive_plan_ambiguous(uuid) to authenticated, service_role;

-- 2.2 Sincronização por veículo: cria, reativa, desativa (nunca apaga) e
-- re-resolve a referência histórica quando uma manutenção concluída do cluster
-- chegou depois (importação, por exemplo). Cada mudança vira evento.
create or replace function private.maintenance_sync_predictive_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_plan      public.maintenance_predictive_plans;
  v_item      record;
  v_ref       record;
  v_cycle     public.maintenance_predictive_cycles;
  v_created   integer := 0;
  v_reactived integer := 0;
  v_deact     integer := 0;
  v_refreshed integer := 0;
  v_source    text := case when auth.uid() is null then 'system' else 'user' end;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null then
    return jsonb_build_object('plan_id', null, 'created', 0);
  end if;
  select * into v_plan from public.maintenance_predictive_plans where id = private.maintenance_predictive_plan_for(p_vehicle_id);

  for v_cycle in
    select c.* from public.maintenance_predictive_cycles c
     where c.vehicle_id = p_vehicle_id and c.is_active
       and (v_plan.id is null or c.plan_id <> v_plan.id
            or not exists (select 1 from public.maintenance_predictive_plan_items i where i.id = c.plan_item_id and i.is_active))
  loop
    update public.maintenance_predictive_cycles set is_active = false, updated_at = now() where id = v_cycle.id;
    perform private.maintenance_predictive_event(v_cycle.id, 'cycle_deactivated', v_source,
      jsonb_build_object('reason', case when v_plan.id is null then 'sem_plano_aplicavel' else 'item_fora_do_plano' end, 'plan_id', v_plan.id));
    v_deact := v_deact + 1;
  end loop;

  if v_plan.id is null then
    return jsonb_build_object('plan_id', null, 'created', 0, 'reactivated', 0, 'deactivated', v_deact, 'refreshed', 0);
  end if;

  for v_item in
    select i.* from public.maintenance_predictive_plan_items i where i.plan_id = v_plan.id and i.is_active
  loop
    select * into v_cycle from public.maintenance_predictive_cycles c where c.vehicle_id = p_vehicle_id and c.plan_item_id = v_item.id;
    if v_cycle.id is not null then
      if not v_cycle.is_active or v_cycle.plan_version <> v_plan.version or v_cycle.plan_id <> v_plan.id then
        update public.maintenance_predictive_cycles
           set is_active = true, plan_version = v_plan.version, plan_id = v_plan.id, updated_at = now()
         where id = v_cycle.id;
        if not v_cycle.is_active then
          perform private.maintenance_predictive_event(v_cycle.id, 'cycle_reactivated', v_source,
            jsonb_build_object('plan_version', v_plan.version));
          v_reactived := v_reactived + 1;
        elsif v_cycle.plan_version <> v_plan.version then
          perform private.maintenance_predictive_event(v_cycle.id, 'plan_version', v_source,
            jsonb_build_object('from_version', v_cycle.plan_version, 'to_version', v_plan.version));
        end if;
      end if;
      -- Referência não formal acompanha a manutenção concluída mais recente do cluster.
      if v_cycle.reference_type in ('history', 'none') then
        select * into v_ref from private.maintenance_predictive_history_reference(p_vehicle_id, v_item.id);
        if v_ref.maintenance_id is not null and v_ref.ref_date is not null
           and (v_cycle.reference_date is null or v_ref.ref_date > v_cycle.reference_date
                or v_cycle.reference_maintenance_id is distinct from v_ref.maintenance_id) then
          update public.maintenance_predictive_cycles
             set reference_type = 'history', reference_date = v_ref.ref_date,
                 reference_km = coalesce(v_ref.ref_km, reference_km), reference_maintenance_id = v_ref.maintenance_id, updated_at = now()
           where id = v_cycle.id;
          perform private.maintenance_predictive_event(v_cycle.id, 'history_reference', v_source,
            jsonb_build_object('previous', jsonb_build_object('reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date,
                                                              'reference_km', v_cycle.reference_km)),
            v_ref.ref_date, v_ref.ref_km, null, null, null, 'history', null, v_ref.maintenance_id);
          v_refreshed := v_refreshed + 1;
        end if;
      end if;
      continue;
    end if;

    select * into v_ref from private.maintenance_predictive_history_reference(p_vehicle_id, v_item.id);
    insert into public.maintenance_predictive_cycles
      (organization_id, vehicle_id, plan_id, plan_item_id, plan_version, reference_type, reference_date, reference_km,
       reference_maintenance_id)
    values
      (v_org, p_vehicle_id, v_plan.id, v_item.id, v_plan.version,
       case when v_ref.maintenance_id is not null and v_ref.ref_date is not null then 'history' else 'none' end,
       case when v_ref.maintenance_id is not null then v_ref.ref_date end,
       case when v_ref.maintenance_id is not null then v_ref.ref_km end,
       v_ref.maintenance_id)
    returning * into v_cycle;
    perform private.maintenance_predictive_event(v_cycle.id, 'cycle_created', v_source,
      jsonb_build_object('plan_id', v_plan.id, 'plan_version', v_plan.version),
      v_cycle.reference_date, v_cycle.reference_km, null, null, null, v_cycle.reference_type, null, v_cycle.reference_maintenance_id);
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('plan_id', v_plan.id, 'created', v_created, 'reactivated', v_reactived, 'deactivated', v_deact, 'refreshed', v_refreshed);
end;
$$;

-- 2.3 Estado v2: o cálculo central com idade do KM e "desde quando".
--   p_internal = true (rotinas do servidor) ignora permissão e escopo;
--   as leituras públicas passam false e recebem só o escopo da pessoa.
create or replace function private.maintenance_predictive_state_v2(p_organization_id uuid, p_internal boolean default false)
returns table (
  cycle_id uuid, vehicle_id uuid, plan_id uuid, plan_name text, plan_version integer, item_id uuid, item_name text,
  cluster_id uuid, cluster_name text, criticality text, interval_km integer, interval_days integer,
  alert_pct numeric, schedule_pct numeric, tolerance_pct numeric, km_base integer, day_base integer,
  reference_type text, reference_date date, reference_km integer, reference_maintenance_id uuid, reference_verification_id uuid,
  monitoring_active boolean, monitoring_km integer, monitoring_days integer,
  current_km integer, current_km_date date, km_age_days integer, km_stale boolean,
  next_km integer, next_date date, km_remaining integer, days_remaining integer, pct_consumed numeric,
  technical_status text, execution_status text, conformity text,
  open_maintenance_id uuid, open_maintenance_code text, open_maintenance_status text,
  last_verification_id uuid, last_verification_on date, last_result text,
  status_cache text, status_changed_at timestamptz,
  severity smallint, vehicle_active boolean, license_plate text, fleet_code text,
  vehicle_type_id uuid, vehicle_subcategory_id uuid, vehicle_model_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select coalesce(s.predictive_km_max_age_days, 30) as max_age
      from (select 1) x left join public.maintenance_settings s on s.organization_id = p_organization_id
  ),
  scope as (
    select private.org_vehicle_scope_ids(p_organization_id) as vehicle_id
  ),
  km as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_km, r.reading_date
      from public.vehicle_odometer_readings r
     where r.organization_id = p_organization_id and r.superseded_by is null
     order by r.vehicle_id, r.reading_date desc, r.created_at desc
  ),
  base as (
    select c.*, i.name as item_name, i.cluster_id, cl.name as cluster_name, i.criticality,
           i.interval_km, i.interval_days, i.alert_pct, i.schedule_pct, i.tolerance_pct,
           p.name as plan_name, km.odometer_km, km.reading_date,
           case when c.monitoring_active and c.monitoring_km is not null then c.monitoring_km else i.interval_km end as km_base,
           case when c.monitoring_active and c.monitoring_days is not null then c.monitoring_days else i.interval_days end as day_base,
           (v.status = 'active' and v.deleted_at is null) as vehicle_active,
           v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_subcategory_id, v.vehicle_model_id,
           private.maintenance_today(p_organization_id) as today,
           (select max_age from settings) as max_age
      from public.maintenance_predictive_cycles c
      join public.maintenance_predictive_plan_items i on i.id = c.plan_item_id
      join public.maintenance_predictive_plans p on p.id = c.plan_id
      join public.maintenance_clusters cl on cl.id = i.cluster_id
      join public.vehicles v on v.id = c.vehicle_id
      left join km on km.vehicle_id = c.vehicle_id
     where c.organization_id = p_organization_id and c.is_active
       and (p_internal or (private.has_permission(p_organization_id, 'maintenance.view')
                           and c.vehicle_id in (select vehicle_id from scope)))
  ),
  calc as (
    select b.*,
           case when b.reference_km is not null and b.km_base is not null then b.reference_km + b.km_base end as next_km,
           case when b.reference_date is not null and b.day_base is not null then b.reference_date + b.day_base end as next_date,
           case when b.reading_date is not null then greatest(0, b.today - b.reading_date) end as km_age_days
      from base b
  ),
  graded as (
    select c.*,
           greatest(
             private.maintenance_predictive_band(c.next_km - c.odometer_km, c.km_base, c.alert_pct, c.schedule_pct, c.tolerance_pct),
             private.maintenance_predictive_band(c.next_date - c.today, c.day_base, c.alert_pct, c.schedule_pct, c.tolerance_pct)) as band,
           (select jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status)
              from public.maintenances m
             where m.predictive_cycle_id = c.id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1) as open_m,
           (select pv.verified_on from public.maintenance_predictive_verifications pv where pv.id = c.last_verification_id) as last_verif
      from calc c
  ),
  typed as (
    select gr.*,
           case
             when gr.interval_km is not null and gr.odometer_km is null and gr.interval_days is null then 'no_km'
             when gr.reference_type = 'none' then
               case when gr.interval_km is not null and gr.odometer_km is null then 'no_km' else 'initial_inspection' end
             when gr.band = 5 then 'critical'
             when gr.band = 4 then 'due'
             when gr.band = 3 or (gr.last_result = 'non_conforming') then 'to_schedule'
             when gr.band = 2 then 'upcoming'
             when gr.band = 1 then 'ok'
             else 'no_km'
           end as tech_status
      from graded gr
  )
  select g.id, g.vehicle_id, g.plan_id, g.plan_name, g.plan_version, g.plan_item_id, g.item_name, g.cluster_id, g.cluster_name,
         g.criticality, g.interval_km, g.interval_days, g.alert_pct, g.schedule_pct, g.tolerance_pct, g.km_base, g.day_base,
         g.reference_type, g.reference_date, g.reference_km, g.reference_maintenance_id, g.reference_verification_id,
         g.monitoring_active, g.monitoring_km, g.monitoring_days,
         g.odometer_km, g.reading_date, g.km_age_days, coalesce(g.km_age_days > g.max_age, false),
         g.next_km, g.next_date,
         case when g.next_km is not null and g.odometer_km is not null then g.next_km - g.odometer_km end,
         case when g.next_date is not null then g.next_date - g.today end,
         case when g.km_base is not null and g.km_base > 0 and g.reference_km is not null and g.odometer_km is not null
              then round((g.odometer_km - g.reference_km) * 100.0 / g.km_base, 1) end,
         g.tech_status,
         case
           when g.open_m is not null then g.open_m ->> 'status'
           when g.last_result = 'non_conforming' then 'awaiting_corrective'
           else 'not_programmed'
         end,
         coalesce(g.last_result, 'no_verification'),
         (g.open_m ->> 'id')::uuid, g.open_m ->> 'code', g.open_m ->> 'status',
         g.last_verification_id, g.last_verif, g.last_result,
         g.status_cache, g.status_changed_at,
         (case g.tech_status when 'critical' then 6 when 'due' then 5 when 'to_schedule' then 4
                              when 'initial_inspection' then 3 when 'upcoming' then 2 when 'ok' then 1 else 0 end)::smallint,
         g.vehicle_active, g.license_plate, g.fleet_code, g.vehicle_type_id, g.vehicle_subcategory_id, g.vehicle_model_id
    from typed g;
$$;
revoke execute on function private.maintenance_predictive_state_v2(uuid, boolean) from public, anon;
grant  execute on function private.maintenance_predictive_state_v2(uuid, boolean) to authenticated, service_role;

-- 2.4 Cache de situação: registra "mudou de situação" (quando o motor indicou).
create or replace function private.maintenance_predictive_touch(p_organization_id uuid, p_vehicle_id uuid default null, p_source text default 'system')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     record;
  v_changed integer := 0;
  v_now     timestamptz := now();
begin
  for v_row in
    select s.* from private.maintenance_predictive_state_v2(p_organization_id, true) s
     where p_vehicle_id is null or s.vehicle_id = p_vehicle_id
  loop
    if v_row.status_cache is distinct from v_row.technical_status then
      update public.maintenance_predictive_cycles
         set status_cache = v_row.technical_status, status_changed_at = v_now, evaluated_at = v_now
       where id = v_row.cycle_id;
      perform private.maintenance_predictive_event(v_row.cycle_id, 'status_changed', p_source,
        jsonb_build_object('next_km', v_row.next_km, 'next_date', v_row.next_date, 'km_remaining', v_row.km_remaining,
                           'days_remaining', v_row.days_remaining, 'km_stale', v_row.km_stale, 'execution', v_row.execution_status),
        null, v_row.current_km, null, v_row.status_cache, v_row.technical_status, v_row.reference_type);
      v_changed := v_changed + 1;
    elsif v_row.status_changed_at is null or v_row.status_changed_at < v_now - interval '12 hours' then
      update public.maintenance_predictive_cycles set evaluated_at = v_now
       where id = v_row.cycle_id and (evaluated_at is null or evaluated_at < v_now - interval '12 hours');
    end if;
  end loop;
  return v_changed;
end;
$$;
revoke execute on function private.maintenance_predictive_touch(uuid, uuid, text) from public, anon;
grant  execute on function private.maintenance_predictive_touch(uuid, uuid, text) to authenticated, service_role;

-- 2.5 Roteiro técnico: normalização dos passos (tipo de resposta, critério,
-- aplicabilidade, obrigatório, ativo). Passos antigos (key/description/required)
-- continuam válidos.
create or replace function private.maintenance_predictive_normalize_checklist(p_checklist jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_step jsonb;
  v_i    integer := 0;
  v_type text;
  v_key  text;
begin
  if p_checklist is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_checklist) <> 'array' then
    raise exception 'Roteiro técnico inválido.' using errcode = 'invalid_parameter_value';
  end if;
  for v_step in select value from jsonb_array_elements(p_checklist) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_step) <> 'object' or length(btrim(coalesce(v_step ->> 'description', ''))) < 2 then
      raise exception 'Passo % do roteiro técnico sem descrição.', v_i using errcode = 'invalid_parameter_value';
    end if;
    v_type := coalesce(nullif(v_step ->> 'response_type', ''), 'conformity');
    if v_type not in ('conformity', 'yes_no', 'number', 'text', 'choice', 'photo') then
      raise exception 'Tipo de resposta inválido no passo %: %.', v_i, v_type using errcode = 'invalid_parameter_value';
    end if;
    if v_type = 'choice' and (jsonb_typeof(v_step -> 'options') <> 'array' or jsonb_array_length(v_step -> 'options') < 2) then
      raise exception 'O passo % (seleção) precisa de ao menos duas opções.', v_i using errcode = 'invalid_parameter_value';
    end if;
    v_key := coalesce(nullif(btrim(v_step ->> 'key'), ''), 'p' || v_i::text);
    v_out := v_out || jsonb_build_object(
      'key', v_key,
      'description', left(btrim(v_step ->> 'description'), 300),
      'response_type', v_type,
      'approval_criteria', nullif(left(btrim(coalesce(v_step ->> 'approval_criteria', '')), 300), ''),
      'applicability', nullif(left(btrim(coalesce(v_step ->> 'applicability', '')), 120), ''),
      'required', coalesce((v_step ->> 'required')::boolean, true),
      'active', coalesce((v_step ->> 'active')::boolean, true),
      'options', case when v_type = 'choice' then v_step -> 'options' else null end,
      'sequence', coalesce(nullif(v_step ->> 'sequence', '')::integer, v_i));
  end loop;
  return v_out;
end;
$$;

create or replace function public.maintenance_save_predictive_item(p_plan_id uuid, p_payload jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan      public.maintenance_predictive_plans;
  v_id        uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_old       public.maintenance_predictive_plan_items;
  v_cluster   uuid := nullif(p_payload ->> 'cluster_id', '')::uuid;
  v_sensitive boolean := true;
  v_new_row   public.maintenance_predictive_plan_items;
  v_vehicle   uuid;
  v_synced    integer := 0;
  v_checklist jsonb;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id and deleted_at is null for update;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_predictive_require(v_plan.organization_id, 'plans');
  if v_cluster is null or not exists (select 1 from public.maintenance_clusters c where c.id = v_cluster
                                        and c.organization_id = v_plan.organization_id and c.deleted_at is null) then
    raise exception 'Selecione o cluster técnico do item.' using errcode = 'invalid_parameter_value';
  end if;
  v_checklist := case when p_payload ? 'checklist' then private.maintenance_predictive_normalize_checklist(p_payload -> 'checklist') end;

  if v_id is not null then
    select * into v_old from public.maintenance_predictive_plan_items where id = v_id and plan_id = p_plan_id for update;
    if v_old.id is null then
      raise exception 'Item não encontrado.' using errcode = 'no_data_found';
    end if;
    v_sensitive := (v_cluster, nullif(p_payload ->> 'interval_km', '')::integer, nullif(p_payload ->> 'interval_days', '')::integer,
                    nullif(p_payload ->> 'interval_engine_hours', '')::integer,
                    coalesce(nullif(p_payload ->> 'alert_pct', '')::numeric, v_old.alert_pct),
                    coalesce(nullif(p_payload ->> 'schedule_pct', '')::numeric, v_old.schedule_pct),
                    coalesce(nullif(p_payload ->> 'tolerance_pct', '')::numeric, v_old.tolerance_pct),
                    coalesce((p_payload ->> 'is_active')::boolean, v_old.is_active))
                   is distinct from (v_old.cluster_id, v_old.interval_km, v_old.interval_days, v_old.interval_engine_hours,
                                     v_old.alert_pct, v_old.schedule_pct, v_old.tolerance_pct, v_old.is_active);
  end if;
  if v_plan.approval_status = 'approved' and v_sensitive and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alterar um item de plano aprovado exige motivo: gera nova versão e recalcula os ciclos.' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.maintenance_predictive_plan_items
      (organization_id, plan_id, cluster_id, service_id, name, technical_description, interval_km, interval_days,
       interval_engine_hours, alert_pct, schedule_pct, tolerance_pct, criticality, sort_order, is_active, checklist)
    values
      (v_plan.organization_id, p_plan_id, v_cluster, nullif(p_payload ->> 'service_id', '')::uuid,
       btrim(coalesce(p_payload ->> 'name', '')), nullif(btrim(p_payload ->> 'technical_description'), ''),
       nullif(p_payload ->> 'interval_km', '')::integer, nullif(p_payload ->> 'interval_days', '')::integer,
       nullif(p_payload ->> 'interval_engine_hours', '')::integer,
       coalesce(nullif(p_payload ->> 'alert_pct', '')::numeric, 20), coalesce(nullif(p_payload ->> 'schedule_pct', '')::numeric, 10),
       coalesce(nullif(p_payload ->> 'tolerance_pct', '')::numeric, 10),
       coalesce(nullif(p_payload ->> 'criticality', ''), 'medium'), coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, 100),
       coalesce((p_payload ->> 'is_active')::boolean, true), coalesce(v_checklist, '[]'::jsonb))
    returning * into v_new_row;
  else
    update public.maintenance_predictive_plan_items set
      cluster_id = v_cluster, service_id = nullif(p_payload ->> 'service_id', '')::uuid,
      name = btrim(coalesce(p_payload ->> 'name', name)), technical_description = nullif(btrim(p_payload ->> 'technical_description'), ''),
      interval_km = nullif(p_payload ->> 'interval_km', '')::integer, interval_days = nullif(p_payload ->> 'interval_days', '')::integer,
      interval_engine_hours = nullif(p_payload ->> 'interval_engine_hours', '')::integer,
      alert_pct = coalesce(nullif(p_payload ->> 'alert_pct', '')::numeric, alert_pct),
      schedule_pct = coalesce(nullif(p_payload ->> 'schedule_pct', '')::numeric, schedule_pct),
      tolerance_pct = coalesce(nullif(p_payload ->> 'tolerance_pct', '')::numeric, tolerance_pct),
      criticality = coalesce(nullif(p_payload ->> 'criticality', ''), criticality),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, sort_order),
      is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
      checklist = coalesce(v_checklist, checklist)
    where id = v_id
    returning * into v_new_row;
  end if;

  if v_plan.approval_status = 'approved' and v_sensitive then
    update public.maintenance_predictive_plans set version = version + 1 where id = p_plan_id;
    perform private.maintenance_predictive_snapshot(p_plan_id, p_reason);
    for v_vehicle in
      select distinct c.vehicle_id from public.maintenance_predictive_cycles c where c.plan_id = p_plan_id
      union
      select v.id from public.vehicles v where v.organization_id = v_plan.organization_id and v.vehicle_type_id = v_plan.vehicle_type_id
         and v.deleted_at is null and v.status = 'active'
    loop
      perform private.maintenance_sync_predictive_vehicle(v_vehicle);
      v_synced := v_synced + 1;
    end loop;
    perform private.maintenance_predictive_touch(v_plan.organization_id, null, 'user');
  end if;
  return jsonb_build_object('id', v_new_row.id, 'version_changed', v_plan.approval_status = 'approved' and v_sensitive,
                            'vehicles_synced', v_synced);
end;
$$;

-- 2.6 Geração de manutenção (núcleo compartilhado + RPC com capability)
create or replace function private.maintenance_generate_predictive_internal(p_cycle_id uuid, p_payload jsonb, p_source text default 'user')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle    public.maintenance_predictive_cycles;
  v_item     public.maintenance_predictive_plan_items;
  v_open     record;
  v_org      uuid;
  v_services jsonb;
  v_res      jsonb;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := v_cycle.organization_id;
  select m.id, m.code, m.status into v_open from public.maintenances m
   where m.predictive_cycle_id = v_cycle.id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1;
  if v_open.id is not null then
    return jsonb_build_object('created', false, 'id', v_open.id, 'code', v_open.code, 'status', v_open.status,
                              'message', 'Já existe manutenção aberta para este item técnico.');
  end if;
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  v_services := case when jsonb_array_length(coalesce(p_payload -> 'service_ids', '[]')) > 0 then p_payload -> 'service_ids'
                     when v_item.service_id is not null then jsonb_build_array(v_item.service_id) end;
  if v_services is null then
    raise exception 'Selecione o serviço da manutenção (o item do plano não tem serviço padrão).' using errcode = 'invalid_parameter_value';
  end if;
  v_res := private.maintenance_create_internal(v_org, jsonb_build_object(
    'vehicle_id', v_cycle.vehicle_id, 'maintenance_type_code', 'predictive',
    'priority', case v_item.criticality when 'critical' then 'critical' when 'high' then 'high' else 'medium' end,
    'service_ids', v_services, 'predictive_cycle_id', v_cycle.id, 'predictive_plan_item_id', v_item.id,
    'predictive_verification_id', p_payload ->> 'verification_id',
    'status', case when nullif(p_payload ->> 'scheduled_date', '') is not null and private.has_permission(v_org, 'maintenance.schedule')
                   then 'scheduled' else 'to_schedule' end,
    'scheduled_date', p_payload ->> 'scheduled_date',
    'description', coalesce(nullif(p_payload ->> 'description', ''), 'Preditiva — ' || v_item.name),
    'duplicate_justification', 'Gerada pelo motor preditivo (' || v_item.name || ')'),
    'predictive');
  perform private.maintenance_predictive_event(v_cycle.id, 'maintenance_generated', p_source,
    jsonb_build_object('code', v_res ->> 'code', 'status', v_res ->> 'status', 'scheduled_date', p_payload ->> 'scheduled_date'),
    null, null, null, null, null, null, null, (v_res ->> 'id')::uuid, nullif(p_payload ->> 'verification_id', '')::uuid,
    nullif(p_payload ->> 'submission_id', '')::uuid);
  perform private.maintenance_predictive_touch(v_org, v_cycle.vehicle_id, p_source);
  return v_res || jsonb_build_object('created', true);
exception
  when unique_violation then
    select m.id, m.code, m.status into v_open from public.maintenances m
     where m.predictive_cycle_id = p_cycle_id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1;
    if v_open.id is null then
      raise;
    end if;
    return jsonb_build_object('created', false, 'id', v_open.id, 'code', v_open.code, 'status', v_open.status,
                              'message', 'Já existe manutenção aberta para este item técnico.');
end;
$$;
revoke execute on function private.maintenance_generate_predictive_internal(uuid, jsonb, text) from public, anon;
grant  execute on function private.maintenance_generate_predictive_internal(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.maintenance_generate_predictive(p_cycle_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.maintenance_predictive_cycles;
  v_org   uuid;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.view', true);
  perform private.maintenance_predictive_require(v_org, 'generate');
  return private.maintenance_generate_predictive_internal(p_cycle_id, coalesce(p_payload, '{}'::jsonb), 'user');
end;
$$;

-- 2.7 Verificação: o núcleo (portal e aplicativo) — valida o roteiro, resolve o
-- KM oficial, decide o ciclo, grava a verificação imutável, o evento e, na não
-- conformidade, a manutenção (quando pedida).
create or replace function private.maintenance_predictive_register(p_cycle_id uuid, p_payload jsonb, p_source text default 'portal', p_submission_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle    public.maintenance_predictive_cycles;
  v_item     public.maintenance_predictive_plan_items;
  v_org      uuid;
  v_result   text := p_payload ->> 'result';
  v_date     date := coalesce(nullif(p_payload ->> 'verified_on', '')::date, null);
  v_km       integer := nullif(p_payload ->> 'km', '')::integer;
  v_km_src   text := 'informed';
  v_auto     jsonb;
  v_decision text;
  v_ver_id   uuid;
  v_maint    jsonb;
  v_missing  integer;
  v_today    date;
  v_event    text := case when p_source = 'app' then 'app' else 'user' end;
  v_prev     jsonb;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := v_cycle.organization_id;
  if not v_cycle.is_active then
    raise exception 'Este ciclo não está mais ativo no plano técnico.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  v_today := private.maintenance_today(v_org);
  v_date := coalesce(v_date, v_today);

  if v_result not in ('conforming', 'monitor', 'non_conforming', 'not_performed') then
    raise exception 'Resultado da verificação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date > v_today then
    raise exception 'A verificação não pode estar no futuro.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < v_today - 60 then
    raise exception 'A verificação não pode ter mais de 60 dias.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_payload ->> 'responsible_name', ''))) < 2 then
    raise exception 'Informe o responsável pela verificação.' using errcode = 'invalid_parameter_value';
  end if;
  if v_result in ('non_conforming', 'not_performed') and length(btrim(coalesce(p_payload ->> 'notes', ''))) < 5 then
    raise exception 'Descreva a não conformidade ou o motivo da não realização.' using errcode = 'invalid_parameter_value';
  end if;
  if v_result = 'monitor' and nullif(p_payload ->> 'monitor_km', '') is null and nullif(p_payload ->> 'monitor_days', '') is null then
    raise exception 'Monitoramento exige o alvo reduzido (KM e/ou dias).' using errcode = 'invalid_parameter_value';
  end if;
  -- Passos obrigatórios e ativos do roteiro precisam de resposta (salvo não realizada).
  if v_result <> 'not_performed' then
    select count(*) into v_missing
      from jsonb_array_elements(v_item.checklist) q
     where coalesce((q ->> 'required')::boolean, true) and coalesce((q ->> 'active')::boolean, true)
       and not exists (select 1 from jsonb_array_elements(coalesce(p_payload -> 'checklist', '[]')) a
                        where a ->> 'key' = q ->> 'key' and nullif(a ->> 'answer', '') is not null);
    if v_missing > 0 then
      raise exception 'Responda os % item(ns) obrigatório(s) do roteiro técnico.', v_missing using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_km is null then
    v_auto := private.maintenance_resolve_km(v_org, v_cycle.vehicle_id, v_date);
    v_km := (v_auto ->> 'km')::integer;
    v_km_src := coalesce(v_auto ->> 'status', 'not_found');
  end if;

  v_decision := case v_result
                  when 'conforming' then case when v_cycle.monitoring_active then 'close_monitoring' else 'restart_cycle' end
                  when 'monitor' then case when v_cycle.monitoring_active then 'continue_monitoring' else 'reduce_interval' end
                  when 'non_conforming' then 'open_maintenance'
                  else 'none'
                end;
  v_prev := jsonb_build_object('reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date,
                               'reference_km', v_cycle.reference_km, 'monitoring_active', v_cycle.monitoring_active,
                               'status_cache', v_cycle.status_cache, 'status_changed_at', v_cycle.status_changed_at);

  insert into public.maintenance_predictive_verifications
    (organization_id, vehicle_id, cycle_id, plan_item_id, result, decision, verified_on, km, km_source,
     responsible_employee_id, responsible_name, checklist, notes, monitor_km, monitor_days, source, submission_id)
  values
    (v_org, v_cycle.vehicle_id, v_cycle.id, v_cycle.plan_item_id, v_result, v_decision, v_date, v_km, v_km_src,
     nullif(p_payload ->> 'responsible_employee_id', '')::uuid, btrim(p_payload ->> 'responsible_name'),
     coalesce(p_payload -> 'checklist', '[]'), nullif(btrim(p_payload ->> 'notes'), ''),
     nullif(p_payload ->> 'monitor_km', '')::integer, nullif(p_payload ->> 'monitor_days', '')::integer,
     case when p_source = 'app' then 'app' else 'portal' end, p_submission_id)
  returning id into v_ver_id;

  if v_result in ('conforming', 'monitor') then
    update public.maintenance_predictive_cycles set
      reference_type = 'verification', reference_date = v_date, reference_km = coalesce(v_km, reference_km),
      reference_verification_id = v_ver_id, reference_maintenance_id = null,
      monitoring_active = (v_result = 'monitor'),
      monitoring_km = case when v_result = 'monitor' then nullif(p_payload ->> 'monitor_km', '')::integer end,
      monitoring_days = case when v_result = 'monitor' then nullif(p_payload ->> 'monitor_days', '')::integer end,
      last_verification_id = v_ver_id, last_result = v_result, updated_at = now()
    where id = v_cycle.id;
  else
    update public.maintenance_predictive_cycles set last_verification_id = v_ver_id, last_result = v_result, updated_at = now()
     where id = v_cycle.id;
  end if;

  perform private.maintenance_predictive_event(v_cycle.id, 'verification', v_event,
    jsonb_build_object('decision', v_decision, 'km_source', v_km_src, 'previous', v_prev,
                       'monitor_km', nullif(p_payload ->> 'monitor_km', '')::integer, 'monitor_days', nullif(p_payload ->> 'monitor_days', '')::integer,
                       'responsible', btrim(p_payload ->> 'responsible_name')),
    v_date, v_km, v_result, v_cycle.status_cache, null,
    case when v_result in ('conforming', 'monitor') then 'verification' else v_cycle.reference_type end,
    case when v_result in ('conforming', 'monitor') then 'full' else 'none' end, null, v_ver_id, p_submission_id);
  if v_result = 'monitor' then
    perform private.maintenance_predictive_event(v_cycle.id, 'monitoring_started', v_event,
      jsonb_build_object('monitor_km', nullif(p_payload ->> 'monitor_km', '')::integer, 'monitor_days', nullif(p_payload ->> 'monitor_days', '')::integer),
      v_date, v_km, v_result, null, null, 'verification', null, null, v_ver_id, p_submission_id);
  elsif v_result = 'conforming' and v_cycle.monitoring_active then
    perform private.maintenance_predictive_event(v_cycle.id, 'monitoring_closed', v_event, '{}'::jsonb,
      v_date, v_km, v_result, null, null, 'verification', null, null, v_ver_id, p_submission_id);
  end if;

  if v_result = 'non_conforming' and coalesce((p_payload ->> 'open_maintenance')::boolean, true) then
    v_maint := private.maintenance_generate_predictive_internal(v_cycle.id, jsonb_build_object(
      'verification_id', v_ver_id, 'submission_id', p_submission_id, 'service_ids', coalesce(p_payload -> 'service_ids', '[]'),
      'scheduled_date', p_payload ->> 'scheduled_date',
      'description', 'Não conformidade na verificação preditiva — ' || v_item.name || ': ' || btrim(p_payload ->> 'notes')), v_event);
  end if;

  perform private.maintenance_predictive_touch(v_org, v_cycle.vehicle_id, v_event);

  return jsonb_build_object('verification_id', v_ver_id, 'decision', v_decision, 'km', v_km, 'km_source', v_km_src,
                            'maintenance', v_maint, 'result', v_result);
end;
$$;
revoke execute on function private.maintenance_predictive_register(uuid, jsonb, text, uuid) from public, anon;
grant  execute on function private.maintenance_predictive_register(uuid, jsonb, text, uuid) to authenticated, service_role;

create or replace function public.maintenance_register_predictive_verification(p_cycle_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.maintenance_predictive_cycles;
  v_org   uuid;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.view', true);
  perform private.maintenance_predictive_require(v_org, 'verify');
  if (p_payload ->> 'result') = 'non_conforming' and coalesce((p_payload ->> 'open_maintenance')::boolean, true)
     and not private.maintenance_predictive_can(v_org, 'generate') then
    raise exception 'Você pode registrar a não conformidade, mas não abrir a manutenção: desmarque "Abrir manutenção" ou peça a permissão.'
      using errcode = 'insufficient_privilege';
  end if;
  return private.maintenance_predictive_register(p_cycle_id, p_payload, 'portal', null);
end;
$$;

-- 2.8 Baixa manual autorizada (evento + auditoria)
create or replace function public.maintenance_predictive_reset(p_cycle_id uuid, p_date date, p_km integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.maintenance_predictive_cycles;
  v_org   uuid;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.view', true);
  perform private.maintenance_predictive_require(v_org, 'reset');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A baixa manual exige motivo (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if p_date is null or p_date > private.maintenance_today(v_org) then
    raise exception 'Data da baixa inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if p_km is null then
    raise exception 'Informe o KM da baixa.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_predictive_cycles set
    reference_type = 'manual_reset', reference_date = p_date, reference_km = p_km,
    reference_maintenance_id = null, reference_verification_id = null, monitoring_active = false,
    monitoring_km = null, monitoring_days = null, updated_at = now()
  where id = p_cycle_id;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, old_data, new_data, changed_fields)
  values (v_org, auth.uid(), 'public.maintenance_predictive_cycles', p_cycle_id::text, 'UPDATE',
          jsonb_build_object('reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date,
                             'reference_km', v_cycle.reference_km),
          jsonb_build_object('reference_type', 'manual_reset', 'reference_date', p_date, 'reference_km', p_km, 'reason', p_reason,
                             'actor', private.maintenance_actor_name(v_org)),
          array['reference_type', 'reference_date', 'reference_km']);
  perform private.maintenance_predictive_event(p_cycle_id, 'manual_reset', 'user',
    jsonb_build_object('reason', btrim(p_reason), 'previous', jsonb_build_object('reference_type', v_cycle.reference_type,
                       'reference_date', v_cycle.reference_date, 'reference_km', v_cycle.reference_km, 'monitoring_active', v_cycle.monitoring_active)),
    p_date, p_km, null, v_cycle.status_cache, null, 'manual_reset', 'full');
  perform private.maintenance_predictive_touch(v_org, v_cycle.vehicle_id, 'user');
end;
$$;

-- 2.9 Ganchos da conclusão/reabertura: + eventos e cache de situação
create or replace function private.maintenance_on_completed(p_maintenance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m          public.maintenances;
  v_done       boolean;
  v_resets     jsonb := '[]'::jsonb;
  v_cycle      record;
  v_preventive jsonb;
  v_source     text := case when auth.uid() is null then 'system' else 'user' end;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id;
  v_done := exists (select 1 from public.maintenance_items i where i.maintenance_id = v_m.id and i.status = 'done');
  if not v_done then
    return jsonb_build_object('preventive', null, 'predictive', '[]'::jsonb);
  end if;

  if v_m.preventive_cycle_id is not null then
    update public.maintenance_preventive_cycles set
      completed_on = v_m.exit_date, completed_km = v_m.entry_km, completed_maintenance_id = v_m.id,
      completion_source = 'maintenance'
    where id = v_m.preventive_cycle_id and completed_on is null;
    if found then
      v_preventive := jsonb_build_object('cycle_id', v_m.preventive_cycle_id, 'completed_on', v_m.exit_date,
                                         'completed_km', v_m.entry_km);
      perform private.maintenance_log(v_m.organization_id, v_m.id, 'preventive_updated', null, null, null, v_preventive, 'system');
    end if;
  end if;

  -- Preditiva: reinicia o ciclo da própria manutenção e os ciclos cujos itens
  -- são cobertos (cobertura total) pelos serviços realizados.
  for v_cycle in
    select c.* from public.maintenance_predictive_cycles c
     where c.vehicle_id = v_m.vehicle_id and c.is_active
       and (c.id = v_m.predictive_cycle_id
            or exists (select 1 from public.maintenance_items i
                         join public.maintenance_predictive_coverage cv on cv.service_id = i.service_id and cv.coverage = 'full' and cv.is_active
                        where i.maintenance_id = v_m.id and i.status = 'done' and cv.plan_item_id = c.plan_item_id))
     for update
  loop
    v_resets := v_resets || jsonb_build_object('cycle_id', v_cycle.id, 'previous', jsonb_build_object(
      'reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date, 'reference_km', v_cycle.reference_km,
      'reference_maintenance_id', v_cycle.reference_maintenance_id, 'reference_verification_id', v_cycle.reference_verification_id,
      'monitoring_active', v_cycle.monitoring_active, 'monitoring_km', v_cycle.monitoring_km, 'monitoring_days', v_cycle.monitoring_days,
      'last_result', v_cycle.last_result));
    update public.maintenance_predictive_cycles set
      reference_type = 'maintenance', reference_date = v_m.exit_date, reference_km = coalesce(v_m.entry_km, reference_km),
      reference_maintenance_id = v_m.id, reference_verification_id = null,
      monitoring_active = false, monitoring_km = null, monitoring_days = null,
      last_result = case when last_result = 'non_conforming' then null else last_result end, updated_at = now()
    where id = v_cycle.id;
    perform private.maintenance_predictive_event(v_cycle.id, 'maintenance_restart', v_source,
      jsonb_build_object('code', v_m.code, 'own_cycle', v_cycle.id = v_m.predictive_cycle_id, 'previous_reference', v_cycle.reference_type),
      v_m.exit_date, v_m.entry_km, null, v_cycle.status_cache, null, 'maintenance', 'full', v_m.id);
    if v_cycle.monitoring_active then
      perform private.maintenance_predictive_event(v_cycle.id, 'monitoring_closed', v_source,
        jsonb_build_object('reason', 'manutencao_concluida', 'code', v_m.code), v_m.exit_date, v_m.entry_km, null, null, null, 'maintenance', 'full', v_m.id);
    end if;
  end loop;
  -- Referência "histórico do cluster" (não formal) acompanha a manutenção real
  -- mais recente do cluster; referências formais não mudam aqui.
  for v_cycle in
    select c.* from public.maintenance_predictive_cycles c
      join public.maintenance_predictive_plan_items pi on pi.id = c.plan_item_id
     where c.vehicle_id = v_m.vehicle_id and c.is_active and c.reference_type in ('history', 'none')
       and c.reference_maintenance_id is distinct from v_m.id
       and exists (select 1 from public.maintenance_items i
                    where i.maintenance_id = v_m.id and i.status = 'done' and i.cluster_id = pi.cluster_id)
       and (c.reference_date is null or c.reference_date <= v_m.exit_date)
     for update of c
  loop
    v_resets := v_resets || jsonb_build_object('cycle_id', v_cycle.id, 'previous', jsonb_build_object(
      'reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date, 'reference_km', v_cycle.reference_km,
      'reference_maintenance_id', v_cycle.reference_maintenance_id, 'reference_verification_id', v_cycle.reference_verification_id,
      'monitoring_active', v_cycle.monitoring_active, 'monitoring_km', v_cycle.monitoring_km, 'monitoring_days', v_cycle.monitoring_days,
      'last_result', v_cycle.last_result));
    update public.maintenance_predictive_cycles set
      reference_type = 'history', reference_date = v_m.exit_date, reference_km = coalesce(v_m.entry_km, reference_km),
      reference_maintenance_id = v_m.id, updated_at = now()
    where id = v_cycle.id;
    perform private.maintenance_predictive_event(v_cycle.id, 'history_reference', v_source,
      jsonb_build_object('code', v_m.code, 'previous_reference', v_cycle.reference_type),
      v_m.exit_date, v_m.entry_km, null, null, null, 'history', 'partial', v_m.id);
  end loop;
  if jsonb_array_length(v_resets) > 0 then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'predictive_updated', null, null, null,
      jsonb_build_object('resets', v_resets), 'system');
    perform private.maintenance_predictive_touch(v_m.organization_id, v_m.vehicle_id, v_source);
  end if;

  return jsonb_build_object('preventive', v_preventive, 'predictive', v_resets);
end;
$$;

create or replace function private.maintenance_on_reopened(p_maintenance_id uuid, p_completion jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset  jsonb;
  v_prev   jsonb;
  v_m      public.maintenances;
  v_source text := case when auth.uid() is null then 'system' else 'user' end;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id;
  update public.maintenance_preventive_cycles set
    completed_on = null, completed_km = null, completed_maintenance_id = null, completion_source = null
  where completed_maintenance_id = p_maintenance_id;

  for v_reset in select * from jsonb_array_elements(coalesce(p_completion -> 'effects' -> 'predictive', '[]'))
  loop
    v_prev := v_reset -> 'previous';
    update public.maintenance_predictive_cycles set
      reference_type = coalesce(v_prev ->> 'reference_type', 'none'),
      reference_date = (v_prev ->> 'reference_date')::date,
      reference_km = (v_prev ->> 'reference_km')::integer,
      reference_maintenance_id = (v_prev ->> 'reference_maintenance_id')::uuid,
      reference_verification_id = (v_prev ->> 'reference_verification_id')::uuid,
      monitoring_active = coalesce((v_prev ->> 'monitoring_active')::boolean, false),
      monitoring_km = (v_prev ->> 'monitoring_km')::integer,
      monitoring_days = (v_prev ->> 'monitoring_days')::integer,
      last_result = v_prev ->> 'last_result', updated_at = now()
    where id = (v_reset ->> 'cycle_id')::uuid and reference_maintenance_id = p_maintenance_id;
    if found then
      perform private.maintenance_predictive_event((v_reset ->> 'cycle_id')::uuid, 'maintenance_reopened', v_source,
        jsonb_build_object('code', v_m.code, 'restored', v_prev), null, null, null, null, null, v_prev ->> 'reference_type', null, p_maintenance_id);
    end if;
  end loop;
  if v_m.id is not null then
    perform private.maintenance_predictive_touch(v_m.organization_id, v_m.vehicle_id, v_source);
  end if;
end;
$$;

-- 2.10 Gatilho: mudanças do veículo que alteram o plano aplicável
create or replace function private.tg_maintenance_predictive_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.maintenance_sync_predictive_vehicle(new.id);
  elsif new.vehicle_type_id is distinct from old.vehicle_type_id
     or new.vehicle_subcategory_id is distinct from old.vehicle_subcategory_id
     or new.vehicle_model_id is distinct from old.vehicle_model_id
     or new.model_year is distinct from old.model_year
     or new.manufacture_year is distinct from old.manufacture_year
     or new.status is distinct from old.status
     or new.deleted_at is distinct from old.deleted_at then
    perform private.maintenance_sync_predictive_vehicle(new.id);
  end if;
  return new;
end;
$$;
create or replace trigger vehicles_predictive_sync
  after insert or update on public.vehicles
  for each row execute function private.tg_maintenance_predictive_vehicle();

-- 2.11 Qualidade de dados: detecta, mantém e resolve — nunca corrige em silêncio.
create or replace function private.maintenance_predictive_refresh_quality(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_today   date := private.maintenance_today(p_organization_id);
  v_max_age integer := coalesce((select s.predictive_km_max_age_days from public.maintenance_settings s where s.organization_id = p_organization_id), 30);
  v_has_plan boolean := exists (select 1 from public.maintenance_predictive_plans p
                                 where p.organization_id = p_organization_id and p.approval_status = 'approved' and p.deleted_at is null);
  v_open    integer;
  v_closed  integer;
begin
  with vehicles as (
    select v.id, v.license_plate, v.fleet_code, private.maintenance_predictive_plan_ambiguous(v.id) as ambiguous,
           private.maintenance_predictive_plan_for(v.id) as plan_id
      from public.vehicles v
     where v.organization_id = p_organization_id and v.deleted_at is null and v.status = 'active' and v_has_plan
  ),
  st as (
    select s.* from private.maintenance_predictive_state_v2(p_organization_id, true) s where s.vehicle_active
  ),
  computed as (
    -- frota ativa sem plano aplicável / com plano ambíguo
    select case when v.ambiguous then 'plan_ambiguous' else 'vehicle_no_plan' end as issue_type,
           case when v.ambiguous then 'high' else 'medium' end as severity,
           v.id as vehicle_id, null::uuid as cycle_id, null::uuid as plan_id, null::uuid as plan_item_id, null::uuid as cluster_id,
           case when v.ambiguous
                then 'Mais de um plano técnico com a mesma especificidade se aplica a ' || v.license_plate || '.'
                else 'Frota ativa sem plano técnico preditivo aplicável: ' || v.license_plate || '.' end as message,
           jsonb_build_object('license_plate', v.license_plate, 'fleet_code', v.fleet_code) as details
      from vehicles v
     where v.ambiguous or v.plan_id is null
    union all
    -- ciclos: sem KM, KM desatualizado, sem referência, referência futura, referência acima do KM, ciclo negativo
    select x.issue_type, x.severity, s.vehicle_id, s.cycle_id, s.plan_id, s.item_id, s.cluster_id, x.message,
           jsonb_build_object('license_plate', s.license_plate, 'item', s.item_name, 'cluster', s.cluster_name,
                              'current_km', s.current_km, 'current_km_date', s.current_km_date, 'reference_km', s.reference_km,
                              'reference_date', s.reference_date, 'km_remaining', s.km_remaining)
      from st s
      cross join lateral (
        select * from (values
          ('vehicle_no_km', 'high', s.technical_status = 'no_km' and s.current_km is null,
            'Sem KM oficial para calcular o ciclo de ' || s.item_name || ' em ' || s.license_plate || '.'),
          ('km_stale', 'medium', s.km_stale,
            'KM oficial de ' || s.license_plate || ' com ' || coalesce(s.km_age_days, 0)::text || ' dias (limite ' || v_max_age::text || '): a situação de ' || s.item_name || ' é uma estimativa.'),
          ('cycle_without_reference', 'medium', s.reference_type = 'none' and s.technical_status = 'initial_inspection',
            'Sem referência para ' || s.item_name || ' em ' || s.license_plate || ': aguarda inspeção inicial.'),
          ('reference_in_future', 'high', s.reference_date is not null and s.reference_date > v_today,
            'Referência de ' || s.item_name || ' em ' || s.license_plate || ' está no futuro (' || to_char(s.reference_date, 'DD/MM/YYYY') || ').'),
          ('reference_km_above_current', 'high', s.reference_km is not null and s.current_km is not null and s.reference_km > s.current_km,
            'KM de referência de ' || s.item_name || ' (' || s.reference_km::text || ') maior que o KM atual (' || s.current_km::text || ') em ' || s.license_plate || '.'),
          ('negative_cycle', 'medium', s.km_remaining is not null and s.km_base is not null and s.km_remaining < -s.km_base,
            s.item_name || ' em ' || s.license_plate || ' passou de um ciclo inteiro do marco (' || abs(s.km_remaining)::text || ' km além).')
        ) as v(issue_type, severity, hit, message) where v.hit) x
    union all
    -- cluster ativo sem item em nenhum plano aprovado
    select 'cluster_without_rule', 'low', null::uuid, null::uuid, null::uuid, null::uuid, c.id,
           'Cluster "' || c.name || '" sem item em nenhum plano preditivo aprovado.', jsonb_build_object('cluster', c.name)
      from public.maintenance_clusters c
     where c.organization_id = p_organization_id and c.deleted_at is null and c.status = 'active' and v_has_plan
       and not exists (select 1 from public.maintenance_predictive_plan_items i
                         join public.maintenance_predictive_plans p on p.id = i.plan_id
                        where i.cluster_id = c.id and i.is_active and p.approval_status = 'approved' and p.deleted_at is null)
    union all
    -- serviço preditivo sem cobertura definida
    select 'service_without_coverage', 'low', null::uuid, null::uuid, null::uuid, null::uuid, sv.cluster_id,
           'Serviço preditivo "' || sv.name || '" sem cobertura definida em nenhum item de plano.',
           jsonb_build_object('service_id', sv.id, 'service', sv.name)
      from public.maintenance_services sv
     where sv.organization_id = p_organization_id and sv.deleted_at is null and sv.is_predictive and v_has_plan
       and not exists (select 1 from public.maintenance_predictive_coverage cv where cv.service_id = sv.id and cv.is_active)
    union all
    -- manutenção concluída do cluster sem KM (365 dias)
    select 'maintenance_without_km', 'low', m.vehicle_id, null::uuid, null::uuid, null::uuid, null::uuid,
           'Manutenção ' || m.code || ' concluída sem KM de entrada: não serve de referência confiável.',
           jsonb_build_object('maintenance_id', m.id, 'code', m.code, 'exit_date', m.exit_date)
      from public.maintenances m
     where m.organization_id = p_organization_id and m.status = 'completed' and m.entry_km is null
       and m.exit_date >= v_today - 365
       and exists (select 1 from public.maintenance_items i join public.maintenance_predictive_plan_items pi on pi.cluster_id = i.cluster_id
                    where i.maintenance_id = m.id and i.status = 'done' and pi.is_active)
    union all
    -- verificação formal sem KM (365 dias)
    select 'verification_without_km', 'low', pv.vehicle_id, pv.cycle_id, null::uuid, pv.plan_item_id, null::uuid,
           'Verificação de ' || to_char(pv.verified_on, 'DD/MM/YYYY') || ' sem KM: a referência usa só a data.',
           jsonb_build_object('verification_id', pv.id, 'verified_on', pv.verified_on, 'result', pv.result)
      from public.maintenance_predictive_verifications pv
     where pv.organization_id = p_organization_id and pv.km is null and pv.verified_on >= v_today - 365
       and pv.result in ('conforming', 'monitor')
  )
  insert into public.maintenance_predictive_quality_issues
    (organization_id, issue_type, severity, vehicle_id, cycle_id, plan_id, plan_item_id, cluster_id, message, details, detected_at, last_seen_at)
  select p_organization_id, t.issue_type, t.severity, t.vehicle_id, t.cycle_id, t.plan_id, t.plan_item_id, t.cluster_id, t.message, t.details, v_started, v_started
    from computed t
  on conflict (organization_id, issue_type,
               coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(cycle_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(plan_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null
  do update set last_seen_at = v_started, message = excluded.message, details = excluded.details, severity = excluded.severity;

  update public.maintenance_predictive_quality_issues q
     set resolved_at = v_started
   where q.organization_id = p_organization_id and q.resolved_at is null and q.last_seen_at < v_started;
  get diagnostics v_closed = row_count;
  select count(*) into v_open from public.maintenance_predictive_quality_issues q
   where q.organization_id = p_organization_id and q.resolved_at is null;
  return jsonb_build_object('open', v_open, 'resolved_now', v_closed, 'ran_at', now());
end;
$$;
revoke execute on function private.maintenance_predictive_refresh_quality(uuid) from public, anon;
grant  execute on function private.maintenance_predictive_refresh_quality(uuid) to authenticated, service_role;

-- 2.12 Foto diária dos indicadores (organização e por operação)
create or replace function private.maintenance_predictive_snapshot_daily(p_organization_id uuid, p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, private.maintenance_today(p_organization_id));
  v_rows integer := 0;
begin
  with ctx as (
    select p.vehicle_id, p.operation_id from private.adherence_planned_fleet(p_organization_id, v_date, null, null) p
  ),
  st as (
    select s.*, c.operation_id
      from private.maintenance_predictive_state_v2(p_organization_id, true) s
      left join ctx c on c.vehicle_id = s.vehicle_id
     where s.vehicle_active
  ),
  groups as (
    select null::uuid as operation_id
    union
    select distinct s.operation_id from st s where s.operation_id is not null
  ),
  ver as (
    select pv.vehicle_id, pv.result from public.maintenance_predictive_verifications pv
     where pv.organization_id = p_organization_id and pv.verified_on > v_date - 7 and pv.verified_on <= v_date
  )
  insert into public.maintenance_predictive_snapshots (organization_id, snapshot_date, operation_id, metrics)
  select p_organization_id, v_date, g.operation_id, jsonb_build_object(
           'items', count(s.cycle_id),
           'ok', count(*) filter (where s.technical_status = 'ok'),
           'upcoming', count(*) filter (where s.technical_status = 'upcoming'),
           'to_schedule', count(*) filter (where s.technical_status = 'to_schedule'),
           'due', count(*) filter (where s.technical_status = 'due'),
           'critical', count(*) filter (where s.technical_status = 'critical'),
           'initial_inspection', count(*) filter (where s.technical_status = 'initial_inspection'),
           'no_km', count(*) filter (where s.technical_status = 'no_km'),
           'km_stale', count(*) filter (where s.km_stale),
           'monitoring', count(*) filter (where s.monitoring_active),
           'awaiting_corrective', count(*) filter (where s.execution_status = 'awaiting_corrective'),
           'open_maintenances', count(*) filter (where s.open_maintenance_id is not null),
           'backlog', count(*) filter (where s.technical_status in ('critical', 'due') or s.execution_status = 'awaiting_corrective'),
           'vehicles', count(distinct s.vehicle_id),
           'verifications_7d', (select count(*) from ver v
                                 where g.operation_id is null or v.vehicle_id in (select t.vehicle_id from st t where t.operation_id = g.operation_id)),
           'non_conforming_7d', (select count(*) from ver v
                                  where v.result = 'non_conforming'
                                    and (g.operation_id is null or v.vehicle_id in (select t.vehicle_id from st t where t.operation_id = g.operation_id))))
    from groups g
    left join st s on (g.operation_id is null or s.operation_id = g.operation_id)
   group by g.operation_id
  on conflict (organization_id, snapshot_date, coalesce(operation_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set metrics = excluded.metrics, created_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke execute on function private.maintenance_predictive_snapshot_daily(uuid, date) from public, anon;
grant  execute on function private.maintenance_predictive_snapshot_daily(uuid, date) to authenticated, service_role;

-- 2.13 Rotina diária v2: KM pendente, ciclos, situações, qualidade e foto
create or replace function private.maintenance_daily_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      record;
  v_km       jsonb;
  v_km_done  integer := 0;
  v_vehicle  record;
  v_vehicles integer := 0;
  v_org      record;
  v_changes  integer := 0;
  v_quality  jsonb;
  v_snaps    integer := 0;
begin
  for v_row in
    select m.id, m.organization_id, m.vehicle_id, m.entry_date, m.entry_km_status, m.entry_km
      from public.maintenances m
     where m.entry_date is not null
       and coalesce(m.entry_km_source, '') <> 'manual'
       and m.entry_km_status in ('pending_future', 'not_found', 'to_review')
     limit 2000
  loop
    v_km := private.maintenance_resolve_km(v_row.organization_id, v_row.vehicle_id, v_row.entry_date);
    if (v_km ->> 'status') is distinct from v_row.entry_km_status or (v_km ->> 'km')::integer is distinct from v_row.entry_km then
      perform private.maintenance_apply_entry_km(v_row.id, v_km, null);
      perform private.maintenance_log(v_row.organization_id, v_row.id, 'km_changed', null, null, 'Rotina diária: KM reprocessado',
        jsonb_build_object('before', jsonb_build_object('km', v_row.entry_km, 'status', v_row.entry_km_status), 'after', v_km), 'system');
      v_km_done := v_km_done + 1;
    end if;
  end loop;

  for v_vehicle in select v.id from public.vehicles v where v.deleted_at is null and v.status = 'active' loop
    perform private.maintenance_sync_preventive_vehicle(v_vehicle.id);
    perform private.maintenance_sync_predictive_vehicle(v_vehicle.id);
    v_vehicles := v_vehicles + 1;
  end loop;

  for v_org in select o.id from public.organizations o where o.deleted_at is null and o.status = 'active' loop
    v_changes := v_changes + private.maintenance_predictive_touch(v_org.id, null, 'system');
    v_quality := private.maintenance_predictive_refresh_quality(v_org.id);
    v_snaps := v_snaps + private.maintenance_predictive_snapshot_daily(v_org.id, null);
  end loop;
  return jsonb_build_object('km_reprocessed', v_km_done, 'vehicles_synced', v_vehicles, 'status_changes', v_changes,
                            'snapshots', v_snaps, 'ran_at', now());
end;
$$;

-- =============================================================================
-- PARTE 3 · Leituras (uma consulta por tela; filtros e paginação no servidor)
-- =============================================================================

-- 3.1 Filtros em comum: recorte do estado pelo contexto do veículo
create or replace function private.maintenance_predictive_filtered(p_organization_id uuid, p_filters jsonb)
returns table (
  cycle_id uuid, vehicle_id uuid, plan_id uuid, plan_name text, plan_version integer, item_id uuid, item_name text,
  cluster_id uuid, cluster_name text, criticality text, interval_km integer, interval_days integer,
  km_base integer, day_base integer, reference_type text, reference_date date, reference_km integer,
  monitoring_active boolean, monitoring_km integer, monitoring_days integer,
  current_km integer, current_km_date date, km_age_days integer, km_stale boolean,
  next_km integer, next_date date, km_remaining integer, days_remaining integer, pct_consumed numeric,
  technical_status text, execution_status text, conformity text,
  open_maintenance_id uuid, open_maintenance_code text, open_maintenance_status text,
  last_verification_on date, last_result text, status_changed_at timestamptz, severity smallint, vehicle_active boolean,
  license_plate text, fleet_code text, vehicle_type_id uuid, vehicle_subcategory_id uuid, vehicle_model_id uuid,
  type_name text, model_name text, make_id uuid, make_name text,
  operation_id uuid, operation_name text, city_id integer, city_name text, state_id smallint, state_uf text,
  operation_br_id uuid, br_code text, leader_employee_id uuid, leader_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'search'), '') as search,
           coalesce((p_filters ->> 'include_inactive')::boolean, false) as include_inactive,
           private.jsonb_uuid_array(p_filters -> 'cluster_ids') as cluster_ids,
           private.jsonb_uuid_array(p_filters -> 'operation_ids') as operation_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_ids') as vehicle_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids') as vehicle_type_ids,
           private.jsonb_uuid_array(p_filters -> 'subcategory_ids') as subcategory_ids,
           private.jsonb_uuid_array(p_filters -> 'make_ids') as make_ids,
           private.jsonb_uuid_array(p_filters -> 'model_ids') as model_ids,
           private.jsonb_uuid_array(p_filters -> 'br_ids') as br_ids,
           private.jsonb_uuid_array(p_filters -> 'leader_ids') as leader_ids,
           private.jsonb_uuid_array(p_filters -> 'plan_ids') as plan_ids,
           (select array_agg((x)::integer) from jsonb_array_elements_text(case when jsonb_typeof(p_filters -> 'city_ids') = 'array' then p_filters -> 'city_ids' else '[]'::jsonb end) x) as city_ids,
           (select array_agg((x)::smallint) from jsonb_array_elements_text(case when jsonb_typeof(p_filters -> 'state_ids') = 'array' then p_filters -> 'state_ids' else '[]'::jsonb end) x) as state_ids,
           private.jsonb_text_array(p_filters -> 'criticality') as criticality,
           private.jsonb_text_array(p_filters -> 'conformity') as conformity,
           private.jsonb_text_array(p_filters -> 'reference_types') as reference_types,
           (p_filters ->> 'monitoring')::boolean as monitoring,
           (p_filters ->> 'km_stale')::boolean as km_stale
  ),
  st as (
    select s.* from private.maintenance_predictive_state_v2(p_organization_id, false) s
  ),
  ids as (select coalesce(array_agg(distinct s.vehicle_id), '{}'::uuid[]) as v from st s),
  ctx as (
    select c.* from ids, private.km_context_pairs(p_organization_id, ids.v, array_fill(private.maintenance_today(p_organization_id), array[cardinality(ids.v)])) c
     where cardinality(ids.v) > 0
  )
  select s.cycle_id, s.vehicle_id, s.plan_id, s.plan_name, s.plan_version, s.item_id, s.item_name,
         s.cluster_id, s.cluster_name, s.criticality, s.interval_km, s.interval_days,
         s.km_base, s.day_base, s.reference_type, s.reference_date, s.reference_km,
         s.monitoring_active, s.monitoring_km, s.monitoring_days,
         s.current_km, s.current_km_date, s.km_age_days, s.km_stale,
         s.next_km, s.next_date, s.km_remaining, s.days_remaining, s.pct_consumed,
         s.technical_status, s.execution_status, s.conformity,
         s.open_maintenance_id, s.open_maintenance_code, s.open_maintenance_status,
         s.last_verification_on, s.last_result, s.status_changed_at, s.severity, s.vehicle_active,
         s.license_plate, s.fleet_code, s.vehicle_type_id, s.vehicle_subcategory_id, s.vehicle_model_id,
         vt.name, vm.name, vm.vehicle_make_id, mk.name,
         c.operation_id, o.name, c.city_id, ci.name, c.state_id, st_.uf::text,
         c.operation_br_id, b.code, c.leader_employee_id, le.full_name
    from st s
    cross join f
    left join ctx c on c.vehicle_id = s.vehicle_id
    left join public.vehicle_types vt on vt.id = s.vehicle_type_id
    left join public.vehicle_models vm on vm.id = s.vehicle_model_id
    left join public.vehicle_makes mk on mk.id = vm.vehicle_make_id
    left join public.operations o on o.id = c.operation_id
    left join public.cities ci on ci.id = c.city_id
    left join public.states st_ on st_.id = c.state_id
    left join public.operation_brs b on b.id = c.operation_br_id
    left join public.employees le on le.id = c.leader_employee_id
   where (f.include_inactive or s.vehicle_active)
     and (f.search is null or s.license_plate ilike '%' || private.normalize_plate(f.search) || '%'
          or coalesce(s.fleet_code, '') ilike '%' || f.search || '%' or s.cluster_name ilike '%' || f.search || '%'
          or s.item_name ilike '%' || f.search || '%')
     and (f.cluster_ids is null or s.cluster_id = any (f.cluster_ids))
     and (f.operation_ids is null or c.operation_id = any (f.operation_ids))
     and (f.vehicle_ids is null or s.vehicle_id = any (f.vehicle_ids))
     and (f.vehicle_type_ids is null or s.vehicle_type_id = any (f.vehicle_type_ids))
     and (f.subcategory_ids is null or s.vehicle_subcategory_id = any (f.subcategory_ids))
     and (f.make_ids is null or vm.vehicle_make_id = any (f.make_ids))
     and (f.model_ids is null or s.vehicle_model_id = any (f.model_ids))
     and (f.city_ids is null or c.city_id = any (f.city_ids))
     and (f.state_ids is null or c.state_id = any (f.state_ids))
     and (f.br_ids is null or c.operation_br_id = any (f.br_ids))
     and (f.leader_ids is null or c.leader_employee_id = any (f.leader_ids))
     and (f.plan_ids is null or s.plan_id = any (f.plan_ids))
     and (f.criticality is null or s.criticality = any (f.criticality))
     and (f.conformity is null or s.conformity = any (f.conformity))
     and (f.reference_types is null or s.reference_type = any (f.reference_types))
     and (f.monitoring is null or s.monitoring_active = f.monitoring)
     and (f.km_stale is null or s.km_stale = f.km_stale);
$$;
revoke execute on function private.maintenance_predictive_filtered(uuid, jsonb) from public, anon;
grant  execute on function private.maintenance_predictive_filtered(uuid, jsonb) to authenticated, service_role;

-- 3.2 Visão geral v2: resumo, cobertura, janelas de previsão, rankings, insights
-- determinísticos, saúde preditiva (fórmula documentada), matriz e alertas
-- paginados. As chaves da v1 continuam.
-- p_filters: os de `maintenance_predictive_filtered` + statuses[], execution[],
--            rows_page, rows_page_size, alerts_page, alerts_page_size
create or replace function public.maintenance_predictive_overview(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today      date;
  v_settings   public.maintenance_settings;
  v_statuses   text[] := private.jsonb_text_array(p_filters -> 'statuses');
  v_exec       text[] := private.jsonb_text_array(p_filters -> 'execution');
  v_rows_page  integer := greatest(1, coalesce(nullif(p_filters ->> 'rows_page', '')::integer, 1));
  v_rows_size  integer := least(200, greatest(1, coalesce(nullif(p_filters ->> 'rows_page_size', '')::integer, 50)));
  v_al_page    integer := greatest(1, coalesce(nullif(p_filters ->> 'alerts_page', '')::integer, 1));
  v_al_size    integer := least(200, greatest(1, coalesce(nullif(p_filters ->> 'alerts_page_size', '')::integer, 50)));
  v_km_windows integer[];
  v_day_windows integer[];
  v_result     jsonb;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  v_today := private.maintenance_today(p_organization_id);
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;
  v_km_windows := coalesce(v_settings.predictive_forecast_km_windows, '{1000,2500,5000,10000}');
  v_day_windows := coalesce(v_settings.predictive_forecast_day_windows, '{7,15,30,60}');

  with st as (
    select * from private.maintenance_predictive_filtered(p_organization_id, p_filters)
  ),
  filtered as (
    select * from st
     where (v_statuses is null or st.technical_status = any (v_statuses))
       and (v_exec is null or st.execution_status = any (v_exec))
  ),
  fleet as (
    select count(*) as active_vehicles,
           count(*) filter (where private.maintenance_predictive_plan_for(v.id) is not null) as covered_vehicles
      from public.vehicles v
     where v.organization_id = p_organization_id and v.status = 'active' and v.deleted_at is null
       and v.id in (select private.org_vehicle_scope_ids(p_organization_id))
  ),
  nc as (
    select pv.cycle_id, s.cluster_name
      from public.maintenance_predictive_verifications pv
      join st s on s.cycle_id = pv.cycle_id
     where pv.organization_id = p_organization_id and pv.result = 'non_conforming' and pv.verified_on >= v_today - 365
  ),
  summary as (
    select count(*) as items,
           count(*) filter (where technical_status = 'ok') as ok,
           count(*) filter (where technical_status = 'upcoming') as upcoming,
           count(*) filter (where technical_status = 'to_schedule') as to_schedule,
           count(*) filter (where technical_status = 'due') as due,
           count(*) filter (where technical_status = 'critical') as critical,
           count(*) filter (where technical_status = 'initial_inspection') as initial_inspection,
           count(*) filter (where technical_status = 'no_km') as no_km,
           count(*) filter (where km_stale) as km_stale,
           count(*) filter (where execution_status in ('to_schedule', 'scheduled')) as scheduled,
           count(*) filter (where execution_status = 'in_progress') as in_progress,
           count(*) filter (where execution_status = 'awaiting_corrective') as awaiting_corrective,
           count(*) filter (where monitoring_active) as monitoring,
           count(*) filter (where reference_type in ('verification', 'maintenance', 'manual_reset')) as formal_reference,
           count(*) filter (where reference_type = 'history') as history_reference,
           count(distinct vehicle_id) as vehicles,
           count(distinct vehicle_id) filter (where technical_status in ('critical', 'due')) as vehicles_critical,
           count(distinct vehicle_id) filter (where technical_status = 'no_km' or km_stale) as vehicles_km_unreliable,
           count(distinct vehicle_id) filter (where monitoring_active) as vehicles_monitoring
      from st
  ),
  health as (
    select s.items,
           (s.critical * 10 + s.due * 6 + s.to_schedule * 3 + s.awaiting_corrective * 8 + s.no_km * 4 + s.km_stale * 2 + s.monitoring * 1) as penalty,
           f.active_vehicles, f.covered_vehicles
      from summary s cross join fleet f
  )
  select jsonb_build_object(
    'today', v_today,
    'summary', (select jsonb_build_object(
        'ok', ok, 'upcoming', upcoming, 'to_schedule', to_schedule, 'due', due, 'critical', critical,
        'initial_inspection', initial_inspection, 'no_km', no_km, 'km_stale', km_stale,
        'scheduled', scheduled, 'in_progress', in_progress, 'awaiting_corrective', awaiting_corrective,
        'monitoring', monitoring, 'items_monitored', items, 'vehicles', vehicles,
        'formal_reference', formal_reference, 'history_reference', history_reference,
        'formal_reference_pct', case when items > 0 then round(formal_reference * 100.0 / items, 1) end,
        'history_reference_pct', case when items > 0 then round(history_reference * 100.0 / items, 1) end,
        'backlog', critical + due + awaiting_corrective,
        'forecast_km', (select count(*) from st where km_remaining between 0 and coalesce(v_settings.predictive_forecast_km, 5000)),
        'forecast_days', (select count(*) from st where days_remaining between 0 and coalesce(v_settings.predictive_forecast_days, 30)),
        'forecast_km_window', coalesce(v_settings.predictive_forecast_km, 5000),
        'forecast_days_window', coalesce(v_settings.predictive_forecast_days, 30),
        'km_max_age_days', coalesce(v_settings.predictive_km_max_age_days, 30))
      from summary),
    'coverage', (select jsonb_build_object('active_vehicles', f.active_vehicles, 'covered_vehicles', f.covered_vehicles,
                                           'uncovered_vehicles', f.active_vehicles - f.covered_vehicles,
                                           'coverage_pct', case when f.active_vehicles > 0 then round(f.covered_vehicles * 100.0 / f.active_vehicles, 1) end)
                   from fleet f),
    'forecast', jsonb_build_object(
      'km', (select coalesce(jsonb_agg(jsonb_build_object('window', w, 'count', (select count(*) from st where km_remaining between 0 and w)) order by w), '[]')
               from unnest(v_km_windows) w),
      'days', (select coalesce(jsonb_agg(jsonb_build_object('window', w, 'count', (select count(*) from st where days_remaining between 0 and w)) order by w), '[]')
                 from unnest(v_day_windows) w)),
    'critical_clusters', (select coalesce(jsonb_agg(x order by (x ->> 'critical')::int desc, x ->> 'cluster'), '[]') from (
                            select jsonb_build_object('cluster', cluster_name, 'cluster_id', cluster_id,
                                                      'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                                      'to_schedule', count(*) filter (where technical_status = 'to_schedule')) as x
                              from st group by cluster_id, cluster_name
                            having count(*) filter (where technical_status in ('critical', 'due', 'to_schedule')) > 0) q),
    'rankings', jsonb_build_object(
      'fleets', (select coalesce(jsonb_agg(x), '[]') from (
                   select jsonb_build_object('key', vehicle_id, 'label', license_plate, 'detail', fleet_code,
                                             'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                             'to_schedule', count(*) filter (where technical_status = 'to_schedule')) as x
                     from st group by vehicle_id, license_plate, fleet_code
                   having count(*) filter (where technical_status in ('critical', 'due')) > 0
                    order by count(*) filter (where technical_status in ('critical', 'due')) desc, license_plate limit 8) r),
      'clusters', (select coalesce(jsonb_agg(x), '[]') from (
                     select jsonb_build_object('key', cluster_id, 'label', cluster_name,
                                               'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                               'to_schedule', count(*) filter (where technical_status = 'to_schedule')) as x
                       from st group by cluster_id, cluster_name
                     having count(*) filter (where technical_status in ('critical', 'due')) > 0
                      order by count(*) filter (where technical_status in ('critical', 'due')) desc, cluster_name limit 8) r),
      'models', (select coalesce(jsonb_agg(x), '[]') from (
                   select jsonb_build_object('key', vehicle_model_id, 'label', coalesce(model_name, 'Sem modelo'),
                                             'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                             'vehicles', count(distinct vehicle_id)) as x
                     from st group by vehicle_model_id, model_name
                   having count(*) filter (where technical_status in ('critical', 'due')) > 0
                    order by count(*) filter (where technical_status in ('critical', 'due')) desc, model_name limit 8) r),
      'types', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('key', vehicle_type_id, 'label', coalesce(type_name, 'Sem tipo'),
                                            'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                            'vehicles', count(distinct vehicle_id)) as x
                    from st group by vehicle_type_id, type_name
                  having count(*) filter (where technical_status in ('critical', 'due')) > 0
                   order by count(*) filter (where technical_status in ('critical', 'due')) desc, type_name limit 8) r),
      'operations', (select coalesce(jsonb_agg(x), '[]') from (
                       select jsonb_build_object('key', operation_id, 'label', coalesce(operation_name, 'Sem operação'),
                                                 'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                                 'vehicles', count(distinct vehicle_id)) as x
                         from st group by operation_id, operation_name
                       having count(*) filter (where technical_status in ('critical', 'due')) > 0
                        order by count(*) filter (where technical_status in ('critical', 'due')) desc, operation_name limit 8) r),
      'cities', (select coalesce(jsonb_agg(x), '[]') from (
                   select jsonb_build_object('key', city_id, 'label', coalesce(city_name || '/' || state_uf, 'Sem local'),
                                             'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                             'vehicles', count(distinct vehicle_id)) as x
                     from st group by city_id, city_name, state_uf
                   having count(*) filter (where technical_status in ('critical', 'due')) > 0
                    order by count(*) filter (where technical_status in ('critical', 'due')) desc, city_name limit 8) r),
      'brs', (select coalesce(jsonb_agg(x), '[]') from (
                select jsonb_build_object('key', operation_br_id, 'label', coalesce(br_code, 'Sem BR'),
                                          'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                          'vehicles', count(distinct vehicle_id)) as x
                  from st group by operation_br_id, br_code
                having count(*) filter (where technical_status in ('critical', 'due')) > 0
                 order by count(*) filter (where technical_status in ('critical', 'due')) desc, br_code limit 8) r),
      'leaders', (select coalesce(jsonb_agg(x), '[]') from (
                    select jsonb_build_object('key', leader_employee_id, 'label', coalesce(leader_name, 'Sem liderança'),
                                              'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                              'vehicles', count(distinct vehicle_id)) as x
                      from st group by leader_employee_id, leader_name
                    having count(*) filter (where technical_status in ('critical', 'due')) > 0
                     order by count(*) filter (where technical_status in ('critical', 'due')) desc, leader_name limit 8) r)),
    'insights', (select coalesce(jsonb_agg(i order by (i ->> 'rank')::int), '[]') from (
        select jsonb_build_object('key', 'critical_fleets', 'tone', 'critical', 'rank', 1,
                 'title', s.vehicles_critical::text || case when s.vehicles_critical = 1 then ' frota possui' else ' frotas possuem' end || ' inspeções críticas ou vencidas',
                 'text', (s.critical + s.due)::text || ' itens técnicos passaram do marco pelo plano aprovado.',
                 'filter', jsonb_build_object('statuses', jsonb_build_array('critical', 'due'))) as i
          from summary s where s.vehicles_critical > 0
        union all
        select jsonb_build_object('key', 'nc_cluster', 'tone', 'warning', 'rank', 2,
                 'title', q.cluster_name || ' concentra ' || q.pct::text || '% das não conformidades',
                 'text', q.n::text || ' de ' || q.total::text || ' não conformidades dos últimos 12 meses.',
                 'filter', jsonb_build_object('cluster_names', jsonb_build_array(q.cluster_name)))
          from (select cluster_name, count(*) as n, sum(count(*)) over () as total,
                       round(count(*) * 100.0 / sum(count(*)) over (), 0) as pct
                  from nc group by cluster_name order by count(*) desc limit 1) q
         where q.total >= 3
        union all
        select jsonb_build_object('key', 'km_unreliable', 'tone', 'warning', 'rank', 3,
                 'title', s.vehicles_km_unreliable::text || case when s.vehicles_km_unreliable = 1 then ' veículo está' else ' veículos estão' end || ' sem KM confiável',
                 'text', s.no_km::text || ' itens sem KM e ' || s.km_stale::text || ' com KM além de ' || coalesce(v_settings.predictive_km_max_age_days, 30)::text || ' dias.',
                 'filter', jsonb_build_object('km_stale', true))
          from summary s where s.vehicles_km_unreliable > 0
        union all
        select jsonb_build_object('key', 'due_soon', 'tone', 'info', 'rank', 4,
                 'title', w.n::text || case when w.n = 1 then ' ciclo vencerá' else ' ciclos vencerão' end || ' nos próximos ' || to_char(w.window, 'FM999G999') || ' km',
                 'text', 'Programe as inspeções antes do marco para não virarem vencidas.',
                 'filter', jsonb_build_object('statuses', jsonb_build_array('upcoming', 'to_schedule')))
          from (select v_km_windows[least(2, cardinality(v_km_windows))] as window,
                       (select count(*) from st where km_remaining between 0 and v_km_windows[least(2, cardinality(v_km_windows))]) as n) w
         where w.n > 0
        union all
        select jsonb_build_object('key', 'monitoring', 'tone', 'info', 'rank', 5,
                 'title', s.vehicles_monitoring::text || case when s.vehicles_monitoring = 1 then ' frota está' else ' frotas estão' end || ' em monitoramento reduzido',
                 'text', s.monitoring::text || ' itens com alvo de reverificação menor que o intervalo do plano.',
                 'filter', jsonb_build_object('monitoring', true))
          from summary s where s.vehicles_monitoring > 0
        union all
        select jsonb_build_object('key', 'uncovered', 'tone', 'warning', 'rank', 6,
                 'title', (f.active_vehicles - f.covered_vehicles)::text || case when f.active_vehicles - f.covered_vehicles = 1 then ' frota ativa sem' else ' frotas ativas sem' end || ' plano técnico',
                 'text', 'Sem plano aprovado aplicável, nada é monitorado nessas frotas.',
                 'filter', jsonb_build_object('quality', 'vehicle_no_plan'))
          from fleet f where f.active_vehicles - f.covered_vehicles > 0) ins),
    'health', (select jsonb_build_object(
        'score', greatest(0, least(100, round(100 - (case when h.items > 0 then h.penalty * 10.0 / h.items else 0 end)
                                                   - (case when h.active_vehicles > 0 then (h.active_vehicles - h.covered_vehicles) * 20.0 / h.active_vehicles else 0 end), 1))),
        'penalty_per_item', case when h.items > 0 then round(h.penalty * 1.0 / h.items, 2) else 0 end,
        'components', jsonb_build_array(
          jsonb_build_object('key', 'critical', 'weight', 10, 'count', s.critical),
          jsonb_build_object('key', 'due', 'weight', 6, 'count', s.due),
          jsonb_build_object('key', 'to_schedule', 'weight', 3, 'count', s.to_schedule),
          jsonb_build_object('key', 'awaiting_corrective', 'weight', 8, 'count', s.awaiting_corrective),
          jsonb_build_object('key', 'no_km', 'weight', 4, 'count', s.no_km),
          jsonb_build_object('key', 'km_stale', 'weight', 2, 'count', s.km_stale),
          jsonb_build_object('key', 'monitoring', 'weight', 1, 'count', s.monitoring),
          jsonb_build_object('key', 'uncovered_fleet', 'weight', 20, 'count', h.active_vehicles - h.covered_vehicles)),
        'formula', '100 − 10 × (Σ peso × itens ÷ itens monitorados) − 20 × (frotas sem plano ÷ frotas ativas), limitado a 0–100')
      from health h cross join summary s),
    'quality', (select jsonb_build_object('open', count(*),
                   'critical', count(*) filter (where severity = 'critical'), 'high', count(*) filter (where severity = 'high'),
                   'medium', count(*) filter (where severity = 'medium'), 'low', count(*) filter (where severity = 'low'))
                  from public.maintenance_predictive_quality_issues q
                 where q.organization_id = p_organization_id and q.resolved_at is null
                   and (q.vehicle_id is null or q.vehicle_id in (select distinct vehicle_id from st))),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.item_id, 'item', c.item_name, 'cluster_id', c.cluster_id,
                                                             'cluster', c.cluster_name) order by c.cluster_name, c.item_name), '[]')
                  from (select distinct item_id, item_name, cluster_id, cluster_name from filtered) c),
    'rows_total', (select count(distinct vehicle_id) from filtered),
    'rows_page', v_rows_page, 'rows_page_size', v_rows_size,
    'rows', (select coalesce(jsonb_agg(r order by (r ->> 'worst')::int desc, r ->> 'license_plate'), '[]') from (
               select jsonb_build_object(
                 'vehicle_id', f.vehicle_id, 'license_plate', max(f.license_plate), 'fleet_code', max(f.fleet_code),
                 'type_name', max(f.type_name), 'model_name', max(f.model_name), 'operation_name', max(f.operation_name),
                 'city_name', max(f.city_name), 'br_code', max(f.br_code), 'leader_name', max(f.leader_name),
                 'current_km', max(f.current_km), 'current_km_date', max(f.current_km_date), 'km_stale', bool_or(f.km_stale),
                 'plan_name', max(f.plan_name), 'worst', max(f.severity),
                 'cells', jsonb_object_agg(f.item_id::text, jsonb_build_object(
                    'cycle_id', f.cycle_id, 'status', f.technical_status, 'execution', f.execution_status,
                    'conformity', f.conformity, 'criticality', f.criticality, 'next_km', f.next_km, 'next_date', f.next_date,
                    'km_remaining', f.km_remaining, 'days_remaining', f.days_remaining, 'pct_consumed', f.pct_consumed,
                    'reference_type', f.reference_type, 'reference_date', f.reference_date, 'reference_km', f.reference_km,
                    'monitoring', f.monitoring_active, 'km_stale', f.km_stale, 'open_maintenance_id', f.open_maintenance_id,
                    'open_maintenance_code', f.open_maintenance_code, 'last_verification_on', f.last_verification_on,
                    'status_changed_at', f.status_changed_at))) as r
                 from filtered f group by f.vehicle_id
                order by max(f.severity) desc, max(f.license_plate)
                offset (v_rows_page - 1) * v_rows_size limit v_rows_size) z),
    'alerts_total', (select count(*) from filtered f
                      where f.technical_status in ('critical', 'due', 'to_schedule', 'upcoming', 'initial_inspection')
                         or f.execution_status = 'awaiting_corrective'),
    'alerts_page', v_al_page, 'alerts_page_size', v_al_size,
    'alerts', (select coalesce(jsonb_agg(a), '[]') from (
                 select jsonb_build_object(
                   'cycle_id', f.cycle_id, 'vehicle_id', f.vehicle_id, 'license_plate', f.license_plate, 'fleet_code', f.fleet_code,
                   'operation_name', f.operation_name, 'city_name', f.city_name, 'br_code', f.br_code, 'leader_name', f.leader_name,
                   'plan_name', f.plan_name, 'item', f.item_name, 'cluster', f.cluster_name, 'cluster_id', f.cluster_id,
                   'criticality', f.criticality, 'status', f.technical_status, 'execution', f.execution_status,
                   'conformity', f.conformity, 'current_km', f.current_km, 'current_km_date', f.current_km_date, 'km_stale', f.km_stale,
                   'next_km', f.next_km, 'next_date', f.next_date, 'km_remaining', f.km_remaining, 'days_remaining', f.days_remaining,
                   'pct_consumed', f.pct_consumed, 'reference_type', f.reference_type, 'reference_date', f.reference_date,
                   'reference_km', f.reference_km, 'monitoring', f.monitoring_active, 'open_maintenance_id', f.open_maintenance_id,
                   'open_maintenance_code', f.open_maintenance_code, 'last_verification_on', f.last_verification_on,
                   'status_changed_at', f.status_changed_at, 'severity', f.severity) as a
                   from filtered f
                  where f.technical_status in ('critical', 'due', 'to_schedule', 'upcoming', 'initial_inspection')
                     or f.execution_status = 'awaiting_corrective'
                  order by f.severity desc, f.km_remaining nulls last, f.license_plate, f.item_name
                 offset (v_al_page - 1) * v_al_size limit v_al_size) q))
    into v_result;
  return v_result;
end;
$$;

-- 3.3 Resumo leve (Home da Manutenção e Início da Liderança)
create or replace function public.maintenance_predictive_summary(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  select coalesce(s.predictive_forecast_km, 5000) into v_window from public.maintenance_settings s where s.organization_id = p_organization_id;
  return (select jsonb_build_object(
    'items', count(*), 'critical', count(*) filter (where technical_status = 'critical'),
    'due', count(*) filter (where technical_status = 'due'), 'to_schedule', count(*) filter (where technical_status = 'to_schedule'),
    'monitoring', count(*) filter (where monitoring_active), 'awaiting_corrective', count(*) filter (where execution_status = 'awaiting_corrective'),
    'no_km', count(*) filter (where technical_status = 'no_km'), 'km_stale', count(*) filter (where km_stale),
    'forecast_km', count(*) filter (where km_remaining between 0 and coalesce(v_window, 5000)), 'forecast_km_window', coalesce(v_window, 5000),
    'vehicles_critical', count(distinct vehicle_id) filter (where technical_status in ('critical', 'due')))
    from private.maintenance_predictive_filtered(p_organization_id, coalesce(p_filters, '{}'::jsonb)));
end;
$$;
revoke execute on function public.maintenance_predictive_summary(uuid, jsonb) from public, anon;
grant  execute on function public.maintenance_predictive_summary(uuid, jsonb) to authenticated;

-- 3.4 Indicadores gerenciais (período e recorte), recorrência, efetividade, SLA
-- p_filters: os do recorte + date_from, date_to (padrão: últimos 365 dias)
create or replace function public.maintenance_predictive_indicators(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today    date;
  v_from     date;
  v_to       date;
  v_settings public.maintenance_settings;
  v_sla      jsonb;
  v_result   jsonb;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  v_today := private.maintenance_today(p_organization_id);
  v_to := coalesce(nullif(p_filters ->> 'date_to', '')::date, v_today);
  v_from := coalesce(nullif(p_filters ->> 'date_from', '')::date, v_to - 365);
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;
  v_sla := coalesce(v_settings.predictive_sla_days, '{"critical": 2, "high": 5, "medium": 10, "low": 20}'::jsonb);

  with st as (
    select * from private.maintenance_predictive_filtered(p_organization_id, p_filters)
  ),
  scope_cycles as (
    select distinct c.id as cycle_id, c.vehicle_id, c.plan_item_id
      from public.maintenance_predictive_cycles c
     where c.organization_id = p_organization_id
       and c.vehicle_id in (select distinct vehicle_id from st)
       and (private.jsonb_uuid_array(p_filters -> 'cluster_ids') is null
            or exists (select 1 from public.maintenance_predictive_plan_items i where i.id = c.plan_item_id
                        and i.cluster_id = any (private.jsonb_uuid_array(p_filters -> 'cluster_ids'))))
  ),
  ver as (
    select pv.*, i.cluster_id, cl.name as cluster_name, i.criticality, v.license_plate, v.fleet_code, v.vehicle_model_id,
           (select e.from_status from public.maintenance_predictive_events e
             where e.verification_id = pv.id and e.event_type = 'verification' limit 1) as status_before,
           (select m.id from public.maintenances m where m.predictive_verification_id = pv.id limit 1) as linked_maintenance_id,
           (select m.status from public.maintenances m where m.predictive_verification_id = pv.id limit 1) as maintenance_status,
           (select m.created_at from public.maintenances m where m.predictive_verification_id = pv.id limit 1) as maintenance_created_at,
           (select m.exit_date from public.maintenances m where m.predictive_verification_id = pv.id limit 1) as maintenance_exit_date
      from public.maintenance_predictive_verifications pv
      join scope_cycles sc on sc.cycle_id = pv.cycle_id
      join public.maintenance_predictive_plan_items i on i.id = pv.plan_item_id
      join public.maintenance_clusters cl on cl.id = i.cluster_id
      join public.vehicles v on v.id = pv.vehicle_id
     where pv.organization_id = p_organization_id and pv.verified_on between v_from and v_to
  ),
  nc_pairs as (
    select vehicle_id, cluster_id, verified_on, km,
           lag(verified_on) over (partition by vehicle_id, cluster_id order by verified_on, created_at) as prev_on,
           lag(km) over (partition by vehicle_id, cluster_id order by verified_on, created_at) as prev_km
      from ver where result = 'non_conforming'
  ),
  flagged as (
    -- quando o motor indicou (primeira mudança para a programar/vencido/crítico) → próxima verificação do ciclo
    select e.cycle_id, e.occurred_at as flagged_at,
           (select min(pv.created_at) from public.maintenance_predictive_verifications pv
             where pv.cycle_id = e.cycle_id and pv.created_at > e.occurred_at) as verified_at
      from public.maintenance_predictive_events e
      join scope_cycles sc on sc.cycle_id = e.cycle_id
     where e.organization_id = p_organization_id and e.event_type = 'status_changed'
       and e.to_status in ('to_schedule', 'due', 'critical') and coalesce(e.from_status, 'ok') in ('ok', 'upcoming', 'initial_inspection', 'no_km')
       and e.occurred_on between v_from and v_to
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'verifications', (select jsonb_build_object(
        'total', count(*), 'conforming', count(*) filter (where result = 'conforming'), 'monitor', count(*) filter (where result = 'monitor'),
        'non_conforming', count(*) filter (where result = 'non_conforming'), 'not_performed', count(*) filter (where result = 'not_performed'),
        'from_app', count(*) filter (where source = 'app'),
        'nc_rate_pct', case when count(*) filter (where result <> 'not_performed') > 0
                            then round(count(*) filter (where result = 'non_conforming') * 100.0 / count(*) filter (where result <> 'not_performed'), 1) end,
        'monitoring_rate_pct', case when count(*) filter (where result <> 'not_performed') > 0
                                    then round(count(*) filter (where result = 'monitor') * 100.0 / count(*) filter (where result <> 'not_performed'), 1) end,
        'with_km_pct', case when count(*) > 0 then round(count(*) filter (where km is not null) * 100.0 / count(*), 1) end,
        'on_time', count(*) filter (where status_before is not null and status_before not in ('due', 'critical') and result <> 'not_performed'),
        'late', count(*) filter (where status_before in ('due', 'critical') and result <> 'not_performed'),
        'on_time_pct', case when count(*) filter (where status_before is not null and result <> 'not_performed') > 0
                            then round(count(*) filter (where status_before is not null and status_before not in ('due', 'critical') and result <> 'not_performed') * 100.0
                                       / count(*) filter (where status_before is not null and result <> 'not_performed'), 1) end)
      from ver),
    'conversion', (select jsonb_build_object(
        'nc_total', count(*), 'nc_with_maintenance', count(*) filter (where coalesce(linked_maintenance_id, maintenance_id) is not null),
        'conversion_pct', case when count(*) > 0 then round(count(*) filter (where coalesce(linked_maintenance_id, maintenance_id) is not null) * 100.0 / count(*), 1) end,
        'anticipations', count(*) filter (where maintenance_status = 'completed'),
        'anticipation_pct', case when count(*) > 0 then round(count(*) filter (where maintenance_status = 'completed') * 100.0 / count(*), 1) end,
        'open', count(*) filter (where coalesce(linked_maintenance_id, maintenance_id) is not null and maintenance_status in ('to_schedule', 'scheduled', 'in_progress')),
        'without_maintenance', count(*) filter (where coalesce(linked_maintenance_id, maintenance_id) is null))
      from ver where result = 'non_conforming'),
    'sla', (select jsonb_build_object(
        'days', v_sla,
        'nc_treated', count(*) filter (where maintenance_status = 'completed'),
        'nc_within_sla', count(*) filter (where maintenance_status = 'completed'
                                            and maintenance_exit_date <= verified_on + coalesce((v_sla ->> criticality)::integer, 10)),
        'within_sla_pct', case when count(*) filter (where maintenance_status = 'completed') > 0
                               then round(count(*) filter (where maintenance_status = 'completed'
                                                             and maintenance_exit_date <= verified_on + coalesce((v_sla ->> criticality)::integer, 10)) * 100.0
                                          / count(*) filter (where maintenance_status = 'completed'), 1) end,
        'nc_open_beyond_sla', count(*) filter (where maintenance_status is distinct from 'completed'
                                                 and v_today > verified_on + coalesce((v_sla ->> criticality)::integer, 10)))
      from ver where result = 'non_conforming'),
    'lead_times_days', (select jsonb_build_object(
        'flagged_to_verified', (select round(avg(extract(epoch from (verified_at - flagged_at)) / 86400.0), 1) from flagged where verified_at is not null),
        'flagged_pending', (select count(*) from flagged where verified_at is null),
        'nc_to_maintenance_open', (select round(avg(extract(epoch from (maintenance_created_at - created_at)) / 86400.0), 1) from ver where result = 'non_conforming' and maintenance_created_at is not null),
        'maintenance_open_to_done', (select round(avg(maintenance_exit_date - maintenance_created_at::date), 1) from ver where result = 'non_conforming' and maintenance_status = 'completed'))),
    'current', (select jsonb_build_object(
        'backlog', count(*) filter (where technical_status in ('critical', 'due') or execution_status = 'awaiting_corrective'),
        'avg_overdue_km', round(avg(-km_remaining) filter (where km_remaining < 0), 0),
        'max_overdue_km', max(-km_remaining) filter (where km_remaining < 0),
        'avg_overdue_days', round(avg(-days_remaining) filter (where days_remaining < 0), 0),
        'max_overdue_days', max(-days_remaining) filter (where days_remaining < 0),
        'formal_reference_pct', case when count(*) > 0 then round(count(*) filter (where reference_type in ('verification', 'maintenance', 'manual_reset')) * 100.0 / count(*), 1) end,
        'history_only_pct', case when count(*) > 0 then round(count(*) filter (where reference_type = 'history') * 100.0 / count(*), 1) end)
      from st),
    'recurrence', jsonb_build_object(
      'by_vehicle_cluster', (select coalesce(jsonb_agg(x), '[]') from (
          select jsonb_build_object('vehicle_id', vehicle_id, 'license_plate', license_plate, 'fleet_code', fleet_code, 'cluster', cluster_name,
                                    'cluster_id', cluster_id, 'non_conforming', count(*)) as x
            from ver where result = 'non_conforming' group by vehicle_id, license_plate, fleet_code, cluster_id, cluster_name
          having count(*) >= 2 order by count(*) desc, license_plate limit 10) r),
      'by_cluster', (select coalesce(jsonb_agg(x), '[]') from (
          select jsonb_build_object('cluster', cluster_name, 'cluster_id', cluster_id, 'non_conforming', count(*),
                                    'share_pct', round(count(*) * 100.0 / sum(count(*)) over (), 0)) as x
            from ver where result = 'non_conforming' group by cluster_id, cluster_name order by count(*) desc limit 8) r),
      'by_model', (select coalesce(jsonb_agg(x), '[]') from (
          select jsonb_build_object('model', coalesce(vm.name, 'Sem modelo'), 'non_conforming', count(*), 'vehicles', count(distinct ver.vehicle_id)) as x
            from ver left join public.vehicle_models vm on vm.id = ver.vehicle_model_id
           where result = 'non_conforming' group by vm.name order by count(*) desc limit 8) r),
      'by_operation', (select coalesce(jsonb_agg(x), '[]') from (
          select jsonb_build_object('operation', coalesce(s.operation_name, 'Sem operação'), 'non_conforming', count(*)) as x
            from ver join (select distinct vehicle_id, operation_name from st) s on s.vehicle_id = ver.vehicle_id
           where result = 'non_conforming' group by s.operation_name order by count(*) desc limit 8) r),
      'mean_km_between_nc', (select round(avg(km - prev_km), 0) from nc_pairs where prev_km is not null and km is not null and km > prev_km),
      'mean_days_between_nc', (select round(avg(verified_on - prev_on), 0) from nc_pairs where prev_on is not null)))
    into v_result;
  return v_result;
end;
$$;
revoke execute on function public.maintenance_predictive_indicators(uuid, jsonb) from public, anon;
grant  execute on function public.maintenance_predictive_indicators(uuid, jsonb) to authenticated;

-- 3.5 Tendências (fotos diárias) e verificações por semana
create or replace function public.maintenance_predictive_trends(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_days  integer := least(366, greatest(7, coalesce(nullif(p_filters ->> 'days', '')::integer, 90)));
  v_op    uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  v_today := private.maintenance_today(p_organization_id);
  if v_op is not null and not private.can_access_operation(v_op) then
    raise exception 'Operação fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'days', v_days,
    'operation_id', v_op,
    'series', (select coalesce(jsonb_agg(jsonb_build_object('date', s.snapshot_date) || s.metrics order by s.snapshot_date), '[]')
                 from public.maintenance_predictive_snapshots s
                where s.organization_id = p_organization_id and s.snapshot_date >= v_today - v_days
                  and s.operation_id is not distinct from v_op),
    'weekly_verifications', (select coalesce(jsonb_agg(w order by w ->> 'week_start'), '[]') from (
        select jsonb_build_object('week_start', date_trunc('week', pv.verified_on)::date,
                                  'verifications', count(*),
                                  'non_conforming', count(*) filter (where pv.result = 'non_conforming'),
                                  'monitoring', count(*) filter (where pv.result = 'monitor'),
                                  'from_app', count(*) filter (where pv.source = 'app')) as w
          from public.maintenance_predictive_verifications pv
         where pv.organization_id = p_organization_id and pv.verified_on >= v_today - v_days
           and pv.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id))
           and (v_op is null or pv.vehicle_id in (select p.vehicle_id from private.adherence_planned_fleet(p_organization_id, v_today, v_op, null) p))
         group by date_trunc('week', pv.verified_on)) q));
end;
$$;
revoke execute on function public.maintenance_predictive_trends(uuid, jsonb) from public, anon;
grant  execute on function public.maintenance_predictive_trends(uuid, jsonb) to authenticated;

-- 3.6 Qualidade de dados (lista) e reprocessamento sob demanda
create or replace function public.maintenance_predictive_quality(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
                                                                 p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_types    text[] := private.jsonb_text_array(p_filters -> 'issue_types');
  v_sev      text[] := private.jsonb_text_array(p_filters -> 'severity');
  v_vehicles uuid[] := private.jsonb_uuid_array(p_filters -> 'vehicle_ids');
  v_resolved boolean := coalesce((p_filters ->> 'include_resolved')::boolean, false);
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  return (
    with q as (
      select i.*, v.license_plate, v.fleet_code, cl.name as cluster_name
        from public.maintenance_predictive_quality_issues i
        left join public.vehicles v on v.id = i.vehicle_id
        left join public.maintenance_clusters cl on cl.id = i.cluster_id
       where i.organization_id = p_organization_id
         and (v_resolved or i.resolved_at is null)
         and (i.vehicle_id is null or i.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id)))
         and (v_types is null or i.issue_type = any (v_types))
         and (v_sev is null or i.severity = any (v_sev))
         and (v_vehicles is null or i.vehicle_id = any (v_vehicles))
    )
    select jsonb_build_object(
      'total', (select count(*) from q),
      'by_severity', (select jsonb_build_object('critical', count(*) filter (where severity = 'critical'), 'high', count(*) filter (where severity = 'high'),
                                                'medium', count(*) filter (where severity = 'medium'), 'low', count(*) filter (where severity = 'low'))
                        from q where resolved_at is null),
      'by_type', (select coalesce(jsonb_object_agg(issue_type, n), '{}'::jsonb) from (select issue_type, count(*) as n from q where resolved_at is null group by issue_type) t),
      'last_run', (select max(last_seen_at) from public.maintenance_predictive_quality_issues i where i.organization_id = p_organization_id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'issue_type', issue_type, 'severity', severity, 'vehicle_id', vehicle_id, 'license_plate', license_plate,
                  'fleet_code', fleet_code, 'cycle_id', cycle_id, 'plan_id', plan_id, 'plan_item_id', plan_item_id, 'cluster_id', cluster_id,
                  'cluster', cluster_name, 'message', message, 'details', details, 'detected_at', detected_at, 'last_seen_at', last_seen_at,
                  'resolved_at', resolved_at) order by (case severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) desc, detected_at desc), '[]')
                  from (select * from q order by (case severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) desc, detected_at desc
                        offset greatest(0, p_offset) limit least(500, greatest(1, p_limit))) p)));
end;
$$;
revoke execute on function public.maintenance_predictive_quality(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.maintenance_predictive_quality(uuid, jsonb, integer, integer) to authenticated;

create or replace function public.maintenance_predictive_quality_refresh(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.maintenance_predictive_require(p_organization_id, 'recalculate');
  return private.maintenance_predictive_refresh_quality(p_organization_id);
end;
$$;
revoke execute on function public.maintenance_predictive_quality_refresh(uuid) from public, anon;
grant  execute on function public.maintenance_predictive_quality_refresh(uuid) to authenticated;

-- 3.7 Recalcular motor (universo ou um veículo): sincroniza, reavalia situações e a qualidade
create or replace function public.maintenance_sync_predictive(p_organization_id uuid, p_vehicle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle uuid;
  v_count   integer := 0;
  v_with    integer := 0;
  v_res     jsonb;
  v_changes integer;
  v_quality jsonb;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'recalculate');
  for v_vehicle in
    select v.id from public.vehicles v
     where v.organization_id = p_organization_id and v.deleted_at is null
       and (p_vehicle_id is null or v.id = p_vehicle_id)
  loop
    v_res := private.maintenance_sync_predictive_vehicle(v_vehicle);
    v_count := v_count + 1;
    if v_res ->> 'plan_id' is not null then
      v_with := v_with + 1;
    end if;
  end loop;
  v_changes := private.maintenance_predictive_touch(p_organization_id, p_vehicle_id, 'user');
  if p_vehicle_id is null then
    v_quality := private.maintenance_predictive_refresh_quality(p_organization_id);
  end if;
  return jsonb_build_object('vehicles', v_count, 'with_plan', v_with, 'without_plan', v_count - v_with,
                            'status_changes', v_changes, 'quality', v_quality);
end;
$$;

-- 3.8 Eventos (auditoria do motor) — por ciclo, veículo, tipo e período
create or replace function public.maintenance_predictive_events(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
                                                                p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cycle    uuid := nullif(p_filters ->> 'cycle_id', '')::uuid;
  v_vehicle  uuid := nullif(p_filters ->> 'vehicle_id', '')::uuid;
  v_types    text[] := private.jsonb_text_array(p_filters -> 'event_types');
  v_from     date := nullif(p_filters ->> 'date_from', '')::date;
  v_to       date := nullif(p_filters ->> 'date_to', '')::date;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'audit');
  return (
    with e as (
      select ev.*, v.license_plate, v.fleet_code, i.name as item_name, cl.name as cluster_name
        from public.maintenance_predictive_events ev
        join public.vehicles v on v.id = ev.vehicle_id
        join public.maintenance_predictive_plan_items i on i.id = ev.plan_item_id
        left join public.maintenance_clusters cl on cl.id = ev.cluster_id
       where ev.organization_id = p_organization_id
         and ev.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id))
         and (v_cycle is null or ev.cycle_id = v_cycle)
         and (v_vehicle is null or ev.vehicle_id = v_vehicle)
         and (v_types is null or ev.event_type = any (v_types))
         and (v_from is null or ev.occurred_on >= v_from)
         and (v_to is null or ev.occurred_on <= v_to)
    )
    select jsonb_build_object(
      'total', (select count(*) from e),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'cycle_id', cycle_id, 'vehicle_id', vehicle_id, 'license_plate', license_plate, 'fleet_code', fleet_code,
                  'item', item_name, 'cluster', cluster_name, 'event_type', event_type, 'source', source, 'occurred_on', occurred_on,
                  'occurred_at', occurred_at, 'km', km, 'result', result, 'from_status', from_status, 'to_status', to_status,
                  'reference_type', reference_type, 'coverage', coverage, 'maintenance_id', maintenance_id, 'verification_id', verification_id,
                  'submission_id', submission_id, 'actor_name', actor_name, 'details', details) order by occurred_at desc), '[]')
                  from (select * from e order by occurred_at desc offset greatest(0, p_offset) limit least(500, greatest(1, p_limit))) p)));
end;
$$;
revoke execute on function public.maintenance_predictive_events(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.maintenance_predictive_events(uuid, jsonb, integer, integer) to authenticated;

-- 3.9 Histórico técnico do ciclo v2: contexto, situação, última manutenção,
-- última verificação, verificações, manutenções e a linha do tempo.
create or replace function public.maintenance_predictive_cycle_history(p_cycle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cycle public.maintenance_predictive_cycles;
  v_item  public.maintenance_predictive_plan_items;
  v_today date;
  v_ctx   jsonb;
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id;
  if v_cycle.id is null or not private.maintenance_predictive_can(v_cycle.organization_id, 'view')
     or not private.vehicle_in_scope(v_cycle.organization_id, v_cycle.vehicle_id) then
    raise exception 'Ciclo não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  v_today := private.maintenance_today(v_cycle.organization_id);
  v_ctx := private.maintenance_context(v_cycle.organization_id, v_cycle.vehicle_id, v_today);
  return jsonb_build_object(
    'item', jsonb_build_object('id', v_item.id, 'name', v_item.name, 'technical_description', v_item.technical_description,
                               'interval_km', v_item.interval_km, 'interval_days', v_item.interval_days, 'interval_engine_hours', v_item.interval_engine_hours,
                               'alert_pct', v_item.alert_pct, 'schedule_pct', v_item.schedule_pct, 'tolerance_pct', v_item.tolerance_pct,
                               'criticality', v_item.criticality, 'checklist', v_item.checklist, 'service_id', v_item.service_id,
                               'cluster_id', v_item.cluster_id,
                               'cluster', (select c.name from public.maintenance_clusters c where c.id = v_item.cluster_id),
                               'coverage', (select coalesce(jsonb_agg(jsonb_build_object('service_id', cv.service_id, 'service', s.name, 'coverage', cv.coverage)), '[]')
                                              from public.maintenance_predictive_coverage cv join public.maintenance_services s on s.id = cv.service_id
                                             where cv.plan_item_id = v_item.id and cv.is_active)),
    'plan', (select jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'version', v_cycle.plan_version, 'source', p.source)
               from public.maintenance_predictive_plans p where p.id = v_cycle.plan_id),
    'context', jsonb_build_object(
      'vehicle_id', v_cycle.vehicle_id,
      'license_plate', (select v.license_plate from public.vehicles v where v.id = v_cycle.vehicle_id),
      'fleet_code', (select v.fleet_code from public.vehicles v where v.id = v_cycle.vehicle_id),
      'type_name', (select vt.name from public.vehicles v join public.vehicle_types vt on vt.id = v.vehicle_type_id where v.id = v_cycle.vehicle_id),
      'model_name', (select vm.name from public.vehicles v join public.vehicle_models vm on vm.id = v.vehicle_model_id where v.id = v_cycle.vehicle_id),
      'operation_name', v_ctx ->> 'operation_name', 'city_name', v_ctx ->> 'city_name', 'state_uf', v_ctx ->> 'state_uf',
      'br_code', v_ctx ->> 'br_code', 'leader_name', v_ctx ->> 'leader_name', 'unit_name', v_ctx ->> 'unit_name'),
    'state', (select to_jsonb(s) from private.maintenance_predictive_state_v2(v_cycle.organization_id, true) s where s.cycle_id = v_cycle.id),
    'last_maintenance', (select jsonb_build_object('id', m.id, 'code', m.code, 'type', m.maintenance_type_code, 'status', m.status,
                                 'entry_date', m.entry_date, 'exit_date', m.exit_date, 'entry_km', m.entry_km,
                                 'service_order_number', m.service_order_number,
                                 'supplier', (select sp.name from public.maintenance_suppliers sp where sp.id = m.supplier_id),
                                 'services', (select string_agg(i.service_name_snapshot, ', ') from public.maintenance_items i
                                               where i.maintenance_id = m.id and i.status <> 'cancelled'))
                           from public.maintenances m
                          where m.vehicle_id = v_cycle.vehicle_id and m.status = 'completed'
                            and (m.predictive_cycle_id = v_cycle.id
                                 or exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.status = 'done' and i.cluster_id = v_item.cluster_id))
                          order by m.exit_date desc nulls last, m.created_at desc limit 1),
    'last_verification', (select jsonb_build_object('id', pv.id, 'result', pv.result, 'decision', pv.decision, 'verified_on', pv.verified_on, 'km', pv.km,
                                  'responsible', pv.responsible_name, 'notes', pv.notes, 'source', pv.source)
                            from public.maintenance_predictive_verifications pv where pv.cycle_id = v_cycle.id
                           order by pv.verified_on desc, pv.created_at desc limit 1),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', pv.id, 'result', pv.result, 'decision', pv.decision, 'verified_on', pv.verified_on, 'km', pv.km,
                         'km_source', pv.km_source, 'responsible', pv.responsible_name, 'notes', pv.notes, 'monitor_km', pv.monitor_km,
                         'monitor_days', pv.monitor_days, 'checklist', pv.checklist, 'maintenance_id', pv.maintenance_id, 'source', pv.source,
                         'submission_id', pv.submission_id, 'created_at', pv.created_at) order by pv.verified_on desc, pv.created_at desc), '[]')
                        from public.maintenance_predictive_verifications pv where pv.cycle_id = v_cycle.id),
    'maintenances', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', m.id, 'code', m.code, 'type', m.maintenance_type_code, 'status', m.status,
                        'entry_date', m.entry_date, 'exit_date', m.exit_date, 'entry_km', m.entry_km,
                        'service_order_number', m.service_order_number,
                        'supplier', (select sp.name from public.maintenance_suppliers sp where sp.id = m.supplier_id),
                        'services', (select string_agg(i.service_name_snapshot, ', ') from public.maintenance_items i
                                      where i.maintenance_id = m.id and i.status <> 'cancelled'))
                        order by coalesce(m.exit_date, m.entry_date, m.requested_on) desc), '[]')
                       from public.maintenances m
                      where m.vehicle_id = v_cycle.vehicle_id
                        and (m.predictive_cycle_id = v_cycle.id
                             or exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id
                                          and i.status <> 'cancelled' and i.cluster_id = v_item.cluster_id))),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'event_type', e.event_type, 'source', e.source, 'occurred_on', e.occurred_on, 'occurred_at', e.occurred_at,
                  'km', e.km, 'result', e.result, 'from_status', e.from_status, 'to_status', e.to_status, 'reference_type', e.reference_type,
                  'coverage', e.coverage, 'maintenance_id', e.maintenance_id, 'verification_id', e.verification_id,
                  'actor_name', e.actor_name, 'details', e.details) order by e.occurred_at desc), '[]')
                 from public.maintenance_predictive_events e where e.cycle_id = v_cycle.id));
end;
$$;

-- 3.10 Histórico de verificações (portal): placa, cluster, período, responsável, resultado, origem
create or replace function public.maintenance_predictive_verifications_search(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
                                                                               p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search   text := nullif(btrim(p_filters ->> 'search'), '');
  v_resp     text := nullif(btrim(p_filters ->> 'responsible'), '');
  v_clusters uuid[] := private.jsonb_uuid_array(p_filters -> 'cluster_ids');
  v_vehicles uuid[] := private.jsonb_uuid_array(p_filters -> 'vehicle_ids');
  v_results  text[] := private.jsonb_text_array(p_filters -> 'results');
  v_sources  text[] := private.jsonb_text_array(p_filters -> 'sources');
  v_from     date := nullif(p_filters ->> 'date_from', '')::date;
  v_to       date := nullif(p_filters ->> 'date_to', '')::date;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  return (
    with q as (
      select pv.*, v.license_plate, v.fleet_code, i.name as item_name, cl.name as cluster_name, cl.id as cl_id,
             (select m.code from public.maintenances m where m.predictive_verification_id = pv.id limit 1) as maintenance_code,
             (select s.protocol from public.maintenance_predictive_submissions s where s.id = pv.submission_id) as protocol
        from public.maintenance_predictive_verifications pv
        join public.vehicles v on v.id = pv.vehicle_id
        join public.maintenance_predictive_plan_items i on i.id = pv.plan_item_id
        join public.maintenance_clusters cl on cl.id = i.cluster_id
       where pv.organization_id = p_organization_id
         and pv.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id))
         and (v_search is null or v.license_plate ilike '%' || private.normalize_plate(v_search) || '%'
              or coalesce(v.fleet_code, '') ilike '%' || v_search || '%')
         and (v_resp is null or pv.responsible_name ilike '%' || v_resp || '%')
         and (v_clusters is null or cl.id = any (v_clusters))
         and (v_vehicles is null or pv.vehicle_id = any (v_vehicles))
         and (v_results is null or pv.result = any (v_results))
         and (v_sources is null or pv.source = any (v_sources))
         and (v_from is null or pv.verified_on >= v_from)
         and (v_to is null or pv.verified_on <= v_to)
    )
    select jsonb_build_object(
      'total', (select count(*) from q),
      'summary', (select jsonb_build_object('conforming', count(*) filter (where result = 'conforming'), 'monitor', count(*) filter (where result = 'monitor'),
                    'non_conforming', count(*) filter (where result = 'non_conforming'), 'not_performed', count(*) filter (where result = 'not_performed')) from q),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'cycle_id', cycle_id, 'vehicle_id', vehicle_id, 'license_plate', license_plate, 'fleet_code', fleet_code,
                  'item', item_name, 'cluster', cluster_name, 'cluster_id', cl_id, 'result', result, 'decision', decision,
                  'verified_on', verified_on, 'km', km, 'km_source', km_source, 'responsible', responsible_name, 'notes', notes,
                  'monitor_km', monitor_km, 'monitor_days', monitor_days, 'source', source, 'protocol', protocol,
                  'maintenance_code', maintenance_code, 'created_at', created_at) order by verified_on desc, created_at desc), '[]')
                  from (select * from q order by verified_on desc, created_at desc offset greatest(0, p_offset) limit least(500, greatest(1, p_limit))) p)));
end;
$$;
revoke execute on function public.maintenance_predictive_verifications_search(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.maintenance_predictive_verifications_search(uuid, jsonb, integer, integer) to authenticated;

-- =============================================================================
-- PARTE 4 · Aplicativo "Verificação Preditiva de Frota" (APLICATIVOS)
--   Fluxo: identificação → roteiro técnico → verificação → conclusão (protocolo).
--   O app nunca grava KM na base oficial: o KM informado é validado contra o KM
--   oficial (Gestão de KM Rodado) e, divergindo, exige justificativa.
-- =============================================================================

create or replace function private.predictive_app(p_organization_id uuid)
returns public.operational_apps
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.operational_apps a
   where a.organization_id = p_organization_id and a.code = 'verificacao_preditiva' and a.deleted_at is null
   limit 1;
$$;
revoke execute on function private.predictive_app(uuid) from public, anon;
grant  execute on function private.predictive_app(uuid) to authenticated, service_role;

-- Regra de divergência de KM: tolera o maior entre 500 km e 5% do KM oficial.
create or replace function private.predictive_km_tolerance(p_official integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(500, ceil(coalesce(p_official, 0) * 0.05))::integer;
$$;
grant execute on function private.predictive_km_tolerance(integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4.1 Contexto do app (disponibilidade, responsável automático, vocabulário)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_predictive_app_context(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app   public.operational_apps;
  v_actor record;
  v_today date := private.maintenance_today(p_organization_id);
  v_set   public.maintenance_settings;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'app');
  v_app := private.predictive_app(p_organization_id);
  select * into v_actor from private.checklist_actor(p_organization_id);
  select * into v_set from public.maintenance_settings where organization_id = p_organization_id;
  return jsonb_build_object(
    'available', v_app.id is not null and v_app.is_active,
    'reason', case when v_app.id is null then 'nao_cadastrado' when not v_app.is_active then 'inativo' else null end,
    'today', v_today,
    'app', case when v_app.id is null then null else jsonb_build_object('id', v_app.id, 'name', v_app.name, 'slug', v_app.slug) end,
    'actor', jsonb_build_object('user_id', auth.uid(), 'employee_id', v_actor.employee_id,
                                'name', coalesce(v_actor.employee_name, private.org_member_name(p_organization_id, auth.uid())),
                                'employee_code', v_actor.employee_code),
    'rules', jsonb_build_object(
      'max_days_back', 60,
      'km_max_age_days', coalesce(v_set.predictive_km_max_age_days, 30),
      'km_tolerance_min', 500, 'km_tolerance_pct', 5,
      'notes_min_length', 5, 'justification_min_length', 5),
    'results', jsonb_build_array(
      jsonb_build_object('code', 'conforming',     'label', 'Conforme',       'decision', 'Reinicia o ciclo a partir desta verificação'),
      jsonb_build_object('code', 'monitor',        'label', 'Monitoramento',  'decision', 'Mantém a referência e reduz o alvo (KM e/ou dias)'),
      jsonb_build_object('code', 'non_conforming', 'label', 'Não conforme',   'decision', 'Abre manutenção corretiva; o ciclo só reinicia na conclusão'),
      jsonb_build_object('code', 'not_performed',  'label', 'Não realizada',  'decision', 'Registra o motivo e não altera o ciclo')));
end;
$$;
revoke execute on function public.maintenance_predictive_app_context(uuid) from public, anon;
grant  execute on function public.maintenance_predictive_app_context(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4.2 Veículos elegíveis (escopo + elegibilidade do aplicativo + resumo do estado)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_predictive_app_vehicles(p_organization_id uuid, p_search text default null, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app    public.operational_apps;
  v_today  date := coalesce(p_date, private.maintenance_today(p_organization_id));
  v_ids    uuid[];
  v_search text := nullif(btrim(p_search), '');
begin
  perform private.maintenance_predictive_require(p_organization_id, 'app');
  v_app := private.predictive_app(p_organization_id);
  if v_app.id is null or not v_app.is_active then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'today', v_today, 'available', false);
  end if;
  select coalesce(array_agg(v.id), '{}') into v_ids
    from public.vehicles v
   where v.organization_id = p_organization_id and v.deleted_at is null and v.status = 'active'
     and private.vehicle_in_scope(p_organization_id, v.id)
     and (v_search is null or v.license_plate like '%' || private.normalize_plate(v_search) || '%'
          or upper(coalesce(v.fleet_code, '')) like '%' || upper(v_search) || '%');
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'today', v_today, 'available', true);
  end if;
  return jsonb_build_object('today', v_today, 'available', true, 'vehicles', coalesce((
    with ctx as (select * from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_today, array[cardinality(v_ids)]))),
    st as (
      select s.vehicle_id,
             count(*)::integer as items,
             max(s.severity)::integer as worst_severity,
             count(*) filter (where s.technical_status = 'critical')::integer as critical,
             count(*) filter (where s.technical_status = 'due')::integer as due,
             count(*) filter (where s.technical_status = 'to_schedule')::integer as to_schedule,
             count(*) filter (where s.technical_status = 'upcoming')::integer as upcoming,
             count(*) filter (where s.technical_status = 'ok')::integer as ok,
             count(*) filter (where s.technical_status = 'initial_inspection')::integer as initial_inspection,
             count(*) filter (where s.technical_status = 'no_km')::integer as no_km,
             count(*) filter (where s.execution_status = 'awaiting_corrective')::integer as awaiting_corrective,
             count(*) filter (where s.monitoring_active)::integer as monitoring,
             bool_or(s.km_stale) as km_stale,
             max(s.current_km) as current_km, max(s.current_km_date) as current_km_date,
             max(s.last_verification_on) as last_verification_on,
             min(s.plan_name) as plan_name
        from private.maintenance_predictive_state_v2(p_organization_id, true) s
       where s.vehicle_id = any (v_ids)
       group by s.vehicle_id)
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'license_plate', v.license_plate, 'fleet_code', v.fleet_code,
             'vehicle_type_id', v.vehicle_type_id, 'vehicle_type_name', vt.name, 'model_name', vm.name, 'make_name', mk.name,
             'operation_id', c.operation_id, 'operation_name', o.name, 'city_name', ci.name, 'state_uf', s.uf::text,
             'br_code', b.code, 'leader_name', le.full_name,
             'plan_name', st.plan_name, 'items', coalesce(st.items, 0),
             'worst_status', case coalesce(st.worst_severity, 0) when 5 then 'critical' when 4 then 'due' when 3 then 'to_schedule' when 2 then 'upcoming' when 1 then 'ok'
                                  else case when st.initial_inspection > 0 then 'initial_inspection' when st.no_km > 0 then 'no_km' when st.items is null then 'no_plan' else 'ok' end end,
             'critical', coalesce(st.critical, 0), 'due', coalesce(st.due, 0), 'to_schedule', coalesce(st.to_schedule, 0),
             'upcoming', coalesce(st.upcoming, 0), 'ok', coalesce(st.ok, 0),
             'initial_inspection', coalesce(st.initial_inspection, 0), 'no_km', coalesce(st.no_km, 0),
             'awaiting_corrective', coalesce(st.awaiting_corrective, 0), 'monitoring', coalesce(st.monitoring, 0),
             'km_stale', coalesce(st.km_stale, false), 'current_km', st.current_km, 'current_km_date', st.current_km_date,
             'last_verification_on', st.last_verification_on,
             'last_submission_on', (select max(sb.verified_on) from public.maintenance_predictive_submissions sb where sb.vehicle_id = v.id))
           order by coalesce(st.worst_severity, 0) desc, st.items is null, v.license_plate)
      from public.vehicles v
      join ctx c on c.vehicle_id = v.id
      left join st on st.vehicle_id = v.id
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
      left join public.vehicle_models vm on vm.id = v.vehicle_model_id
      left join public.vehicle_makes mk on mk.id = vm.vehicle_make_id
      left join public.operations o on o.id = c.operation_id
      left join public.cities ci on ci.id = c.city_id
      left join public.states s on s.id = c.state_id
      left join public.operation_brs b on b.id = c.operation_br_id
      left join public.employees le on le.id = c.leader_employee_id
     where c.operation_id is not null
       and private.can_access_operation(c.operation_id)
       and private.app_vehicle_eligible(p_organization_id, v_app.id, v.id, c.operation_id, v_today)), '[]'::jsonb));
end;
$$;
revoke execute on function public.maintenance_predictive_app_vehicles(uuid, text, date) from public, anon;
grant  execute on function public.maintenance_predictive_app_vehicles(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4.3 Roteiro técnico do veículo (itens por cluster, checklist, estado e KM oficial)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_predictive_app_roadmap(p_organization_id uuid, p_vehicle_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app     public.operational_apps;
  v_today   date := private.maintenance_today(p_organization_id);
  v_date    date := coalesce(p_date, private.maintenance_today(p_organization_id));
  v_vehicle record;
  v_ctx     jsonb;
  v_km      jsonb;
  v_set     public.maintenance_settings;
  v_plan    record;
  v_amb     boolean;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'app');
  v_app := private.predictive_app(p_organization_id);
  if v_app.id is null or not v_app.is_active then
    raise exception 'O aplicativo Verificação Preditiva de Frota não está disponível nesta organização.' using errcode = 'invalid_parameter_value';
  end if;
  select v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.status, v.deleted_at, vt.name as type_name, vm.name as model_name, mk.name as make_name, v.model_year
    into v_vehicle
    from public.vehicles v
    left join public.vehicle_types vt on vt.id = v.vehicle_type_id
    left join public.vehicle_models vm on vm.id = v.vehicle_model_id
    left join public.vehicle_makes mk on mk.id = vm.vehicle_make_id
   where v.id = p_vehicle_id and v.organization_id = p_organization_id;
  if v_vehicle.id is null or v_vehicle.deleted_at is not null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_vehicle.id) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  if v_date > v_today then
    raise exception 'A data da verificação não pode ser futura.' using errcode = 'invalid_parameter_value';
  end if;
  v_ctx := private.maintenance_context(p_organization_id, v_vehicle.id, v_date);
  v_km  := private.maintenance_resolve_km(p_organization_id, v_vehicle.id, v_date);
  select * into v_set from public.maintenance_settings where organization_id = p_organization_id;
  select p.id, p.code, p.name, p.version, p.approval_status into v_plan
    from private.maintenance_predictive_plan_for(v_vehicle.id) f
    join public.maintenance_predictive_plans p on p.id = f;
  v_amb := private.maintenance_predictive_plan_ambiguous(v_vehicle.id);

  return jsonb_build_object(
    'today', v_today, 'date', v_date,
    'vehicle', jsonb_build_object('id', v_vehicle.id, 'license_plate', v_vehicle.license_plate, 'fleet_code', v_vehicle.fleet_code,
                                  'vehicle_type_id', v_vehicle.vehicle_type_id, 'vehicle_type_name', v_vehicle.type_name,
                                  'model_name', v_vehicle.model_name, 'make_name', v_vehicle.make_name, 'model_year', v_vehicle.model_year,
                                  'active', v_vehicle.status = 'active'),
    'context', jsonb_build_object('operation_id', v_ctx ->> 'operation_id', 'operation_name', v_ctx ->> 'operation_name',
                                  'city_name', v_ctx ->> 'city_name', 'state_uf', v_ctx ->> 'state_uf', 'br_code', v_ctx ->> 'br_code',
                                  'leader_name', v_ctx ->> 'leader_name', 'unit_name', v_ctx ->> 'unit_name'),
    'eligible', (v_ctx ->> 'operation_id') is not null
                and private.can_access_operation((v_ctx ->> 'operation_id')::uuid)
                and private.app_vehicle_eligible(p_organization_id, v_app.id, v_vehicle.id, (v_ctx ->> 'operation_id')::uuid, v_date),
    'km', jsonb_build_object(
      'official', (v_km ->> 'km')::integer, 'status', v_km ->> 'status', 'source', v_km ->> 'source',
      'reading_date', coalesce(v_km ->> 'reading_date', v_km ->> 'reference_date'),
      'age_days', case when (v_km ->> 'reading_date') is not null then v_date - (v_km ->> 'reading_date')::date end,
      'stale', case when (v_km ->> 'reading_date') is not null then (v_date - (v_km ->> 'reading_date')::date) > coalesce(v_set.predictive_km_max_age_days, 30) else (v_km ->> 'km') is null end,
      'tolerance', private.predictive_km_tolerance((v_km ->> 'km')::integer),
      'max_age_days', coalesce(v_set.predictive_km_max_age_days, 30)),
    'plan', case when v_plan.id is null then null else jsonb_build_object('id', v_plan.id, 'code', v_plan.code, 'name', v_plan.name, 'version', v_plan.version, 'approval_status', v_plan.approval_status) end,
    'plan_ambiguous', v_amb,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cycle_id', s.cycle_id, 'item_id', s.item_id, 'item_name', s.item_name,
               'cluster_id', s.cluster_id, 'cluster_name', s.cluster_name, 'criticality', s.criticality,
               'interval_km', s.interval_km, 'interval_days', s.interval_days,
               'technical_status', s.technical_status, 'execution_status', s.execution_status, 'conformity', s.conformity,
               'reference_type', s.reference_type, 'reference_date', s.reference_date, 'reference_km', s.reference_km,
               'monitoring_active', s.monitoring_active, 'monitoring_km', s.monitoring_km, 'monitoring_days', s.monitoring_days,
               'next_km', s.next_km, 'next_date', s.next_date, 'km_remaining', s.km_remaining, 'days_remaining', s.days_remaining,
               'pct_consumed', s.pct_consumed, 'severity', s.severity,
               'open_maintenance_id', s.open_maintenance_id, 'open_maintenance_code', s.open_maintenance_code, 'open_maintenance_status', s.open_maintenance_status,
               'last_verification_on', s.last_verification_on, 'last_result', s.last_result,
               'checklist', coalesce((select jsonb_agg(q order by (q ->> 'sequence')::integer nulls last)
                                        from jsonb_array_elements(coalesce(i.checklist, '[]'::jsonb)) q
                                       where coalesce((q ->> 'active')::boolean, true)), '[]'::jsonb),
               'services', coalesce((select jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.name, 'coverage', cv.coverage) order by sv.name)
                                       from public.maintenance_predictive_coverage cv join public.maintenance_services sv on sv.id = cv.service_id
                                      where cv.plan_item_id = s.item_id and cv.is_active), '[]'::jsonb))
             order by s.severity desc, s.cluster_name, s.item_name)
        from private.maintenance_predictive_state_v2(p_organization_id, true) s
        join public.maintenance_predictive_plan_items i on i.id = s.item_id
       where s.vehicle_id = v_vehicle.id), '[]'::jsonb),
    'recent_submissions', coalesce((
      select jsonb_agg(jsonb_build_object('id', sb.id, 'protocol', sb.protocol, 'verified_on', sb.verified_on, 'inspector', sb.inspector_name_snapshot,
                                          'total_items', sb.total_items, 'total_non_conforming', sb.total_non_conforming) order by sb.verified_on desc, sb.created_at desc)
        from (select * from public.maintenance_predictive_submissions where vehicle_id = v_vehicle.id order by verified_on desc, created_at desc limit 5) sb), '[]'::jsonb));
end;
$$;
revoke execute on function public.maintenance_predictive_app_roadmap(uuid, uuid, date) from public, anon;
grant  execute on function public.maintenance_predictive_app_roadmap(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4.4 Envio da verificação (idempotente por client_submission_id; transacional)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_predictive_app_submit(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app       public.operational_apps;
  v_sub       uuid := nullif(p_payload ->> 'client_submission_id', '')::uuid;
  v_existing  public.maintenance_predictive_submissions;
  v_vehicle   record;
  v_ctx       jsonb;
  v_km        jsonb;
  v_actor     record;
  v_name      text;
  v_today     date := private.maintenance_today(p_organization_id);
  v_date      date := coalesce(nullif(p_payload ->> 'verified_on', '')::date, private.maintenance_today(p_organization_id));
  v_km_inf    integer := nullif(p_payload ->> 'km_informed', '')::integer;
  v_km_off    integer;
  v_km_use    integer;
  v_just      text := nullif(btrim(coalesce(p_payload ->> 'km_justification', '')), '');
  v_obs       text := nullif(btrim(coalesce(p_payload ->> 'general_observation', '')), '');
  v_id        uuid;
  v_protocol  text;
  v_item      jsonb;
  v_cycle     public.maintenance_predictive_cycles;
  v_given     uuid[] := '{}';
  v_res       jsonb;
  v_n         integer := 0;
  v_conf      integer := 0;
  v_mon       integer := 0;
  v_nc        integer := 0;
  v_np        integer := 0;
  v_opened    integer := 0;
  v_maints    jsonb := '[]'::jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_can_gen   boolean;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'app');
  if v_sub is null then
    raise exception 'Identificador do envio ausente.' using errcode = 'invalid_parameter_value';
  end if;
  select s.* into v_existing from public.maintenance_predictive_submissions s
   where s.organization_id = p_organization_id and s.client_submission_id = v_sub;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'protocol', v_existing.protocol, 'submitted_at', v_existing.created_at,
                              'total_items', v_existing.total_items, 'total_conforming', v_existing.total_conforming,
                              'total_monitoring', v_existing.total_monitoring, 'total_non_conforming', v_existing.total_non_conforming,
                              'total_not_performed', v_existing.total_not_performed, 'maintenances_opened', v_existing.maintenances_opened,
                              'maintenances', coalesce((select jsonb_agg(distinct jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status))
                                                          from public.maintenance_predictive_verifications pv join public.maintenances m on m.id = pv.maintenance_id
                                                         where pv.submission_id = v_existing.id), '[]'::jsonb),
                              'duplicate', true);
  end if;

  v_app := private.predictive_app(p_organization_id);
  if v_app.id is null or not v_app.is_active then
    raise exception 'O aplicativo Verificação Preditiva de Frota não está disponível nesta organização.' using errcode = 'invalid_parameter_value';
  end if;

  select v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle
    from public.vehicles v where v.id = nullif(p_payload ->> 'vehicle_id', '')::uuid and v.organization_id = p_organization_id
    for update;
  if v_vehicle.id is null or v_vehicle.deleted_at is not null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_vehicle.status <> 'active' then
    raise exception 'Frota inativa: a verificação só é registrada para frotas ativas.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_vehicle.id) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  if v_date > v_today then
    raise exception 'A verificação não pode estar no futuro.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < v_today - 60 then
    raise exception 'A verificação não pode ter mais de 60 dias.' using errcode = 'invalid_parameter_value';
  end if;

  v_ctx := private.maintenance_context(p_organization_id, v_vehicle.id, v_date);
  if (v_ctx ->> 'operation_id') is null then
    raise exception 'Veículo sem operação vigente na data: não é elegível para a verificação.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_operation((v_ctx ->> 'operation_id')::uuid) then
    raise exception 'Operação do veículo fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  if not private.app_vehicle_eligible(p_organization_id, v_app.id, v_vehicle.id, (v_ctx ->> 'operation_id')::uuid, v_date) then
    raise exception 'Veículo não elegível para a Verificação Preditiva (operação ou tipo de equipamento não habilitado).' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Informe ao menos um item do roteiro técnico.' using errcode = 'invalid_parameter_value';
  end if;

  -- KM: fonte oficial é a Gestão de KM Rodado; o KM informado é validado e nunca grava na base.
  v_km := private.maintenance_resolve_km(p_organization_id, v_vehicle.id, v_date);
  v_km_off := (v_km ->> 'km')::integer;
  if v_km_inf is not null and (v_km_inf < 0 or v_km_inf > 9999999) then
    raise exception 'KM informado inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_km_inf is not null and v_km_off is not null and abs(v_km_inf - v_km_off) > private.predictive_km_tolerance(v_km_off)
     and (v_just is null or length(v_just) < 5) then
    raise exception 'O KM informado (%) diverge do KM oficial (%): justifique a diferença.', v_km_inf, v_km_off using errcode = 'invalid_parameter_value';
  end if;
  if v_km_inf is null and v_km_off is null and v_just is null then
    raise exception 'Sem KM oficial para a data: informe o KM do hodômetro.' using errcode = 'invalid_parameter_value';
  end if;
  v_km_use := coalesce(v_km_inf, v_km_off);

  select * into v_actor from private.checklist_actor(p_organization_id);
  v_name := coalesce(v_actor.employee_name, private.org_member_name(p_organization_id, auth.uid()));
  if length(btrim(coalesce(v_name, ''))) < 2 then
    raise exception 'Não foi possível identificar o responsável pela verificação.' using errcode = 'invalid_parameter_value';
  end if;
  v_can_gen := private.maintenance_predictive_can(p_organization_id, 'generate');

  v_protocol := private.next_entity_code(p_organization_id, 'predictive_verification:' || to_char(v_date, 'YYYY'), 'VPF-' || to_char(v_date, 'YYYY') || '-', 6);

  insert into public.maintenance_predictive_submissions
    (organization_id, protocol, app_id, vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id,
     verified_on, verified_at, operation_id, operation_city_id, state_id, city_id, operation_br_id, leader_employee_id,
     operation_name_snapshot, city_name_snapshot, state_uf_snapshot, br_code_snapshot, leader_name_snapshot,
     inspector_user_id, inspector_employee_id, inspector_name_snapshot, inspector_code_snapshot,
     km_official, km_official_date, km_informed, km_justification, general_observation, client_submission_id)
  values
    (p_organization_id, v_protocol, v_app.id, v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code, v_vehicle.vehicle_type_id,
     v_date, now(), (v_ctx ->> 'operation_id')::uuid, (v_ctx ->> 'operation_city_id')::uuid, (v_ctx ->> 'state_id')::smallint,
     (v_ctx ->> 'city_id')::integer, (v_ctx ->> 'operation_br_id')::uuid, (v_ctx ->> 'leader_employee_id')::uuid,
     v_ctx ->> 'operation_name', v_ctx ->> 'city_name', v_ctx ->> 'state_uf', v_ctx ->> 'br_code', v_ctx ->> 'leader_name',
     auth.uid(), v_actor.employee_id, v_name, v_actor.employee_code,
     v_km_off, coalesce(v_km ->> 'reading_date', v_km ->> 'reference_date')::date, v_km_inf, v_just, v_obs, v_sub)
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    select c.* into v_cycle from public.maintenance_predictive_cycles c
     where c.id = nullif(v_item ->> 'cycle_id', '')::uuid and c.organization_id = p_organization_id;
    if v_cycle.id is null then
      raise exception 'Item do roteiro inválido (ciclo não encontrado).' using errcode = 'invalid_parameter_value';
    end if;
    if v_cycle.vehicle_id <> v_vehicle.id then
      raise exception 'Item do roteiro pertence a outro veículo.' using errcode = 'invalid_parameter_value';
    end if;
    if v_cycle.id = any (v_given) then
      raise exception 'Item do roteiro informado mais de uma vez.' using errcode = 'invalid_parameter_value';
    end if;
    v_given := v_given || v_cycle.id;
    if (v_item ->> 'result') = 'non_conforming' and coalesce((v_item ->> 'open_maintenance')::boolean, true) and not v_can_gen then
      -- Sem permissão para gerar manutenção: registra a NC sem abrir corretiva (fica AGUARDANDO CORRETIVA pelo portal).
      v_item := v_item || jsonb_build_object('open_maintenance', false);
    end if;
    v_res := private.maintenance_predictive_register(v_cycle.id,
      (v_item - 'cycle_id') || jsonb_build_object(
        'verified_on', v_date, 'km', v_km_use,
        'responsible_name', v_name, 'responsible_employee_id', v_actor.employee_id),
      'app', v_id);
    v_n := v_n + 1;
    case v_res ->> 'result'
      when 'conforming' then v_conf := v_conf + 1;
      when 'monitor' then v_mon := v_mon + 1;
      when 'non_conforming' then v_nc := v_nc + 1;
      else v_np := v_np + 1;
    end case;
    if (v_res -> 'maintenance') is not null and jsonb_typeof(v_res -> 'maintenance') = 'object' then
      if coalesce((v_res -> 'maintenance' ->> 'created')::boolean, false) then v_opened := v_opened + 1; end if;
      v_maints := v_maints || jsonb_build_object('id', v_res -> 'maintenance' ->> 'id', 'code', v_res -> 'maintenance' ->> 'code',
                                                 'status', v_res -> 'maintenance' ->> 'status', 'created', coalesce((v_res -> 'maintenance' ->> 'created')::boolean, false));
    end if;
    v_results := v_results || jsonb_build_object('cycle_id', v_cycle.id, 'verification_id', v_res ->> 'verification_id',
                                                 'result', v_res ->> 'result', 'decision', v_res ->> 'decision');
  end loop;

  update public.maintenance_predictive_submissions
     set total_items = v_n, total_conforming = v_conf, total_monitoring = v_mon, total_non_conforming = v_nc,
         total_not_performed = v_np, maintenances_opened = v_opened
   where id = v_id;

  perform private.emit_event(p_organization_id, 'maintenance.predictive.submitted', 'maintenance_predictive_submission', v_id,
    jsonb_build_object('protocol', v_protocol, 'vehicle_id', v_vehicle.id, 'total_items', v_n, 'total_non_conforming', v_nc,
                       'maintenances_opened', v_opened, 'operation_id', v_ctx ->> 'operation_id'));

  return jsonb_build_object('id', v_id, 'protocol', v_protocol, 'submitted_at', now(),
                            'total_items', v_n, 'total_conforming', v_conf, 'total_monitoring', v_mon,
                            'total_non_conforming', v_nc, 'total_not_performed', v_np, 'maintenances_opened', v_opened,
                            'maintenances', v_maints, 'items', v_results,
                            'km', jsonb_build_object('used', v_km_use, 'official', v_km_off, 'informed', v_km_inf,
                                                     'divergent', v_km_inf is not null and v_km_off is not null and abs(v_km_inf - v_km_off) > private.predictive_km_tolerance(v_km_off)),
                            'duplicate', false);
end;
$$;
revoke execute on function public.maintenance_predictive_app_submit(uuid, jsonb) from public, anon;
grant  execute on function public.maintenance_predictive_app_submit(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4.5 Meus envios (histórico do responsável) e detalhe do envio
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_predictive_submission_json(p_sub public.maintenance_predictive_submissions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_sub.id, 'protocol', p_sub.protocol, 'vehicle_id', p_sub.vehicle_id,
    'license_plate', p_sub.license_plate_snapshot, 'fleet_code', p_sub.fleet_code_snapshot,
    'vehicle_type_name', (select vt.name from public.vehicle_types vt where vt.id = p_sub.vehicle_type_id),
    'verified_on', p_sub.verified_on, 'verified_at', p_sub.verified_at, 'created_at', p_sub.created_at,
    'operation_name', p_sub.operation_name_snapshot, 'city_name', p_sub.city_name_snapshot, 'state_uf', p_sub.state_uf_snapshot,
    'br_code', p_sub.br_code_snapshot, 'leader_name', p_sub.leader_name_snapshot,
    'inspector', jsonb_build_object('user_id', p_sub.inspector_user_id, 'employee_id', p_sub.inspector_employee_id,
                                    'name', p_sub.inspector_name_snapshot, 'employee_code', p_sub.inspector_code_snapshot),
    'km', jsonb_build_object('official', p_sub.km_official, 'official_date', p_sub.km_official_date, 'informed', p_sub.km_informed,
                             'justification', p_sub.km_justification,
                             'divergent', p_sub.km_informed is not null and p_sub.km_official is not null
                                          and abs(p_sub.km_informed - p_sub.km_official) > private.predictive_km_tolerance(p_sub.km_official)),
    'general_observation', p_sub.general_observation,
    'totals', jsonb_build_object('items', p_sub.total_items, 'conforming', p_sub.total_conforming, 'monitoring', p_sub.total_monitoring,
                                 'non_conforming', p_sub.total_non_conforming, 'not_performed', p_sub.total_not_performed,
                                 'maintenances_opened', p_sub.maintenances_opened),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'verification_id', pv.id, 'cycle_id', pv.cycle_id, 'item_id', pv.plan_item_id, 'item_name', i.name,
                'cluster_id', i.cluster_id, 'cluster_name', cl.name, 'criticality', i.criticality,
                'result', pv.result, 'decision', pv.decision, 'km', pv.km, 'km_source', pv.km_source, 'notes', pv.notes,
                'monitor_km', pv.monitor_km, 'monitor_days', pv.monitor_days, 'checklist', pv.checklist,
                'maintenance', case when m.id is null then null else jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status, 'label', private.maintenance_status_label(m.status)) end)
                order by cl.name, i.name)
               from public.maintenance_predictive_verifications pv
               join public.maintenance_predictive_plan_items i on i.id = pv.plan_item_id
               join public.maintenance_clusters cl on cl.id = i.cluster_id
               left join public.maintenances m on m.id = pv.maintenance_id
              where pv.submission_id = p_sub.id), '[]'::jsonb));
$$;
revoke execute on function private.maintenance_predictive_submission_json(public.maintenance_predictive_submissions) from public, anon;
grant  execute on function private.maintenance_predictive_submission_json(public.maintenance_predictive_submissions) to authenticated, service_role;

create or replace function public.maintenance_predictive_my_submissions(p_organization_id uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.maintenance_predictive_require(p_organization_id, 'app');
  return jsonb_build_object(
    'today', private.maintenance_today(p_organization_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'protocol', s.protocol, 'vehicle_id', s.vehicle_id, 'license_plate', s.license_plate_snapshot,
               'fleet_code', s.fleet_code_snapshot, 'verified_on', s.verified_on, 'created_at', s.created_at,
               'operation_name', s.operation_name_snapshot, 'city_name', s.city_name_snapshot,
               'total_items', s.total_items, 'total_conforming', s.total_conforming, 'total_monitoring', s.total_monitoring,
               'total_non_conforming', s.total_non_conforming, 'total_not_performed', s.total_not_performed,
               'maintenances_opened', s.maintenances_opened, 'km_divergent', s.km_informed is not null and s.km_official is not null
                 and abs(s.km_informed - s.km_official) > private.predictive_km_tolerance(s.km_official))
               order by s.created_at desc)
        from (select * from public.maintenance_predictive_submissions
               where organization_id = p_organization_id and inspector_user_id = auth.uid()
               order by created_at desc limit least(200, greatest(1, coalesce(p_limit, 30)))) s), '[]'::jsonb));
end;
$$;
revoke execute on function public.maintenance_predictive_my_submissions(uuid, integer) from public, anon;
grant  execute on function public.maintenance_predictive_my_submissions(uuid, integer) to authenticated;

create or replace function public.maintenance_predictive_submission_detail(p_organization_id uuid, p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sub public.maintenance_predictive_submissions;
begin
  select * into v_sub from public.maintenance_predictive_submissions where id = p_submission_id and organization_id = p_organization_id;
  if v_sub.id is null then
    raise exception 'Envio não encontrado.' using errcode = 'no_data_found';
  end if;
  if not (v_sub.inspector_user_id = auth.uid()
          or (private.maintenance_predictive_can(p_organization_id, 'view') and private.vehicle_in_scope(p_organization_id, v_sub.vehicle_id))) then
    raise exception 'Sem permissão para consultar este envio.' using errcode = 'insufficient_privilege';
  end if;
  return private.maintenance_predictive_submission_json(v_sub);
end;
$$;
revoke execute on function public.maintenance_predictive_submission_detail(uuid, uuid) from public, anon;
grant  execute on function public.maintenance_predictive_submission_detail(uuid, uuid) to authenticated;

-- Busca de envios (portal: histórico pesquisável por placa, protocolo, responsável, período)
create or replace function public.maintenance_predictive_submissions_search(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_filters ->> 'search', '')), '');
  v_from   date := nullif(p_filters ->> 'from', '')::date;
  v_to     date := nullif(p_filters ->> 'to', '')::date;
  v_ops    uuid[] := private.jsonb_uuid_array(p_filters -> 'operation_ids');
  v_nc     boolean := coalesce((p_filters ->> 'only_non_conforming')::boolean, false);
begin
  perform private.maintenance_predictive_require(p_organization_id, 'view');
  return (
    with q as (
      select s.*
        from public.maintenance_predictive_submissions s
       where s.organization_id = p_organization_id
         and s.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id))
         and (v_search is null or s.license_plate_snapshot like '%' || private.normalize_plate(v_search) || '%'
              or upper(coalesce(s.fleet_code_snapshot, '')) like '%' || upper(v_search) || '%'
              or upper(s.protocol) like '%' || upper(v_search) || '%'
              or s.inspector_name_snapshot ilike '%' || v_search || '%')
         and (v_from is null or s.verified_on >= v_from)
         and (v_to is null or s.verified_on <= v_to)
         and (v_ops is null or s.operation_id = any (v_ops))
         and (not v_nc or s.total_non_conforming > 0))
    select jsonb_build_object(
      'total', (select count(*) from q),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', id, 'protocol', protocol, 'vehicle_id', vehicle_id, 'license_plate', license_plate_snapshot, 'fleet_code', fleet_code_snapshot,
                  'verified_on', verified_on, 'created_at', created_at, 'inspector', inspector_name_snapshot,
                  'operation_name', operation_name_snapshot, 'city_name', city_name_snapshot, 'leader_name', leader_name_snapshot,
                  'total_items', total_items, 'total_conforming', total_conforming, 'total_monitoring', total_monitoring,
                  'total_non_conforming', total_non_conforming, 'total_not_performed', total_not_performed, 'maintenances_opened', maintenances_opened,
                  'km_official', km_official, 'km_informed', km_informed,
                  'km_divergent', km_informed is not null and km_official is not null and abs(km_informed - km_official) > private.predictive_km_tolerance(km_official))
                  order by verified_on desc, created_at desc), '[]'::jsonb)
                  from (select * from q order by verified_on desc, created_at desc offset greatest(0, p_offset) limit least(500, greatest(1, p_limit))) p)));
end;
$$;
revoke execute on function public.maintenance_predictive_submissions_search(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.maintenance_predictive_submissions_search(uuid, jsonb, integer, integer) to authenticated;

-- =============================================================================
-- PARTE 5 · Planos técnicos v2: vigência (valid_from/valid_to), capability
--   `maintenance.predictive.plans.manage`, cobertura sem exclusão física
--   (is_active) e recálculo ao mudar aplicabilidade.
-- =============================================================================

alter table public.maintenance_predictive_coverage add column if not exists is_active boolean not null default true;
alter table public.maintenance_predictive_coverage add column if not exists updated_at timestamptz;
alter table public.maintenance_predictive_coverage add column if not exists updated_by uuid;
create index if not exists maintenance_predictive_coverage_service_active_idx
  on public.maintenance_predictive_coverage (service_id) where is_active;

-- 5.1 Referência "histórico do cluster": só cobertura ativa
create or replace function private.maintenance_predictive_history_reference(p_vehicle_id uuid, p_item_id uuid)
returns table (maintenance_id uuid, ref_date date, ref_km integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.exit_date, m.entry_km
    from public.maintenances m
    join public.maintenance_items mi on mi.maintenance_id = m.id and mi.status = 'done'
    join public.maintenance_predictive_plan_items pi on pi.id = p_item_id
   where m.vehicle_id = p_vehicle_id and m.status = 'completed'
     and (mi.cluster_id = pi.cluster_id
          or exists (select 1 from public.maintenance_predictive_coverage cv
                      where cv.plan_item_id = pi.id and cv.service_id = mi.service_id and cv.is_active))
   order by m.exit_date desc nulls last, m.created_at desc
   limit 1;
$$;

-- 5.2 Cobertura: substitui o conjunto sem apagar linhas (desativa as ausentes)
create or replace function public.maintenance_save_predictive_coverage(p_item_id uuid, p_services jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  public.maintenance_predictive_plan_items;
  v_count integer := 0;
  v_ids   uuid[] := '{}';
  v_x     jsonb;
  v_sid   uuid;
  v_cov   text;
begin
  select * into v_item from public.maintenance_predictive_plan_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_predictive_require(v_item.organization_id, 'plans');
  if p_services is not null and jsonb_typeof(p_services) <> 'array' then
    raise exception 'Cobertura inválida.' using errcode = 'invalid_parameter_value';
  end if;
  for v_x in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
    v_sid := nullif(v_x ->> 'service_id', '')::uuid;
    v_cov := coalesce(nullif(v_x ->> 'coverage', ''), 'full');
    if v_sid is null or v_cov not in ('full', 'partial') then
      raise exception 'Cobertura inválida: informe o serviço e TOTAL ou PARCIAL.' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.maintenance_services s
                    where s.id = v_sid and s.organization_id = v_item.organization_id and s.deleted_at is null) then
      raise exception 'Serviço da cobertura não pertence a esta organização.' using errcode = 'invalid_parameter_value';
    end if;
    if v_sid = any (v_ids) then
      raise exception 'Serviço informado mais de uma vez na cobertura.' using errcode = 'invalid_parameter_value';
    end if;
    v_ids := v_ids || v_sid;
    insert into public.maintenance_predictive_coverage (organization_id, plan_item_id, service_id, coverage, is_active, created_by, updated_at, updated_by)
    values (v_item.organization_id, p_item_id, v_sid, v_cov, true, auth.uid(), now(), auth.uid())
    on conflict (plan_item_id, service_id) do update
      set coverage = excluded.coverage, is_active = true, updated_at = now(), updated_by = auth.uid();
    v_count := v_count + 1;
  end loop;
  update public.maintenance_predictive_coverage
     set is_active = false, updated_at = now(), updated_by = auth.uid()
   where plan_item_id = p_item_id and is_active and not (service_id = any (v_ids));
  return v_count;
end;
$$;
revoke execute on function public.maintenance_save_predictive_coverage(uuid, jsonb) from public, anon;
grant  execute on function public.maintenance_save_predictive_coverage(uuid, jsonb) to authenticated;

-- 5.3 Sincroniza os veículos candidatos de um plano (tipo + ciclos existentes)
create or replace function private.maintenance_predictive_sync_plan_fleet(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_plan public.maintenance_predictive_plans; v_vehicle uuid; v_n integer := 0;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id;
  if v_plan.id is null then return 0; end if;
  for v_vehicle in
    select v.id from public.vehicles v
     where v.organization_id = v_plan.organization_id and v.vehicle_type_id = v_plan.vehicle_type_id and v.deleted_at is null
    union
    select distinct c.vehicle_id from public.maintenance_predictive_cycles c where c.plan_id = p_plan_id
  loop
    perform private.maintenance_sync_predictive_vehicle(v_vehicle);
    v_n := v_n + 1;
  end loop;
  perform private.maintenance_predictive_touch(v_plan.organization_id, null, 'user');
  return v_n;
end;
$$;
revoke execute on function private.maintenance_predictive_sync_plan_fleet(uuid) from public, anon;
grant  execute on function private.maintenance_predictive_sync_plan_fleet(uuid) to authenticated, service_role;

-- 5.4 Plano técnico: vigência e recálculo ao mudar a aplicabilidade
create or replace function public.maintenance_save_predictive_plan(p_organization_id uuid, p_payload jsonb, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_old    public.maintenance_predictive_plans;
  v_type   uuid := nullif(p_payload ->> 'vehicle_type_id', '')::uuid;
  v_from   date := nullif(p_payload ->> 'valid_from', '')::date;
  v_to     date := nullif(p_payload ->> 'valid_to', '')::date;
  v_code   text;
  v_key_changed boolean;
begin
  perform private.maintenance_predictive_require(p_organization_id, 'plans');
  if length(btrim(coalesce(p_payload ->> 'name', ''))) < 2 then
    raise exception 'Informe o nome do plano.' using errcode = 'invalid_parameter_value';
  end if;
  if v_type is null then
    raise exception 'Selecione o tipo de equipamento.' using errcode = 'invalid_parameter_value';
  end if;
  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'A vigência final não pode ser anterior à inicial.' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_payload ->> 'year_from', '') is not null and nullif(p_payload ->> 'year_to', '') is not null
     and (p_payload ->> 'year_to')::int < (p_payload ->> 'year_from')::int then
    raise exception 'O ano final não pode ser anterior ao inicial.' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_payload ->> 'vehicle_model_id', '') is not null and nullif(p_payload ->> 'vehicle_make_id', '') is not null
     and not exists (select 1 from public.vehicle_models vm where vm.id = (p_payload ->> 'vehicle_model_id')::uuid
                        and vm.vehicle_make_id = (p_payload ->> 'vehicle_make_id')::uuid) then
    raise exception 'O modelo informado não pertence à marca selecionada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_id is null then
    v_code := private.next_entity_code(p_organization_id, 'predictive_plan', 'PPT-', 4);
    insert into public.maintenance_predictive_plans
      (organization_id, code, name, description, vehicle_type_id, vehicle_subcategory_id, vehicle_make_id, vehicle_model_id,
       year_from, year_to, source, reference_document, oem_reference, notes, valid_from, valid_to)
    values
      (p_organization_id, v_code, btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), v_type,
       nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid, nullif(p_payload ->> 'vehicle_make_id', '')::uuid,
       nullif(p_payload ->> 'vehicle_model_id', '')::uuid, nullif(p_payload ->> 'year_from', '')::smallint,
       nullif(p_payload ->> 'year_to', '')::smallint, coalesce(nullif(p_payload ->> 'source', ''), 'internal'),
       nullif(btrim(p_payload ->> 'reference_document'), ''), nullif(btrim(p_payload ->> 'oem_reference'), ''),
       nullif(btrim(p_payload ->> 'notes'), ''), v_from, v_to)
    returning id into v_id;
    return v_id;
  end if;
  select * into v_old from public.maintenance_predictive_plans
   where id = v_id and organization_id = p_organization_id and deleted_at is null for update;
  if v_old.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  v_key_changed := (v_type, nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid, nullif(p_payload ->> 'vehicle_make_id', '')::uuid,
                    nullif(p_payload ->> 'vehicle_model_id', '')::uuid, nullif(p_payload ->> 'year_from', '')::smallint,
                    nullif(p_payload ->> 'year_to', '')::smallint, v_from, v_to)
                   is distinct from (v_old.vehicle_type_id, v_old.vehicle_subcategory_id, v_old.vehicle_make_id,
                                     v_old.vehicle_model_id, v_old.year_from, v_old.year_to, v_old.valid_from, v_old.valid_to);
  if v_old.approval_status = 'approved' and v_key_changed and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alterar a aplicabilidade de um plano aprovado exige motivo (gera nova versão).' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_predictive_plans set
    name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''),
    vehicle_type_id = v_type, vehicle_subcategory_id = nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid,
    vehicle_make_id = nullif(p_payload ->> 'vehicle_make_id', '')::uuid, vehicle_model_id = nullif(p_payload ->> 'vehicle_model_id', '')::uuid,
    year_from = nullif(p_payload ->> 'year_from', '')::smallint, year_to = nullif(p_payload ->> 'year_to', '')::smallint,
    valid_from = v_from, valid_to = v_to,
    source = coalesce(nullif(p_payload ->> 'source', ''), source),
    reference_document = nullif(btrim(p_payload ->> 'reference_document'), ''),
    oem_reference = nullif(btrim(p_payload ->> 'oem_reference'), ''),
    notes = nullif(btrim(p_payload ->> 'notes'), ''),
    version = case when v_old.approval_status = 'approved' and v_key_changed then version + 1 else version end
  where id = v_id;
  if v_old.approval_status = 'approved' and v_key_changed then
    perform private.maintenance_predictive_snapshot(v_id, p_reason);
    -- A aplicabilidade mudou: ressincroniza a frota do tipo antigo e do novo.
    perform private.maintenance_predictive_sync_plan_fleet(v_id);
    if v_old.vehicle_type_id <> v_type then
      perform private.maintenance_sync_predictive_vehicle(v.id)
         from public.vehicles v where v.organization_id = p_organization_id and v.vehicle_type_id = v_old.vehicle_type_id and v.deleted_at is null;
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.maintenance_save_predictive_plan(uuid, jsonb, text) from public, anon;
grant  execute on function public.maintenance_save_predictive_plan(uuid, jsonb, text) to authenticated;

-- 5.5 Situação do plano (rascunho → em revisão → aprovado → inativo/arquivado)
create or replace function public.maintenance_set_predictive_plan_status(p_plan_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan    public.maintenance_predictive_plans;
  v_synced  integer := 0;
  v_amb     integer := 0;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id and deleted_at is null for update;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_predictive_require(v_plan.organization_id, 'plans');
  if p_status not in ('draft', 'in_review', 'approved', 'archived') then
    raise exception 'Situação inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if (v_plan.approval_status, p_status) not in (
       ('draft', 'in_review'), ('draft', 'approved'), ('in_review', 'draft'), ('in_review', 'approved'),
       ('approved', 'archived'), ('archived', 'draft')) then
    raise exception 'Mudança de situação do plano não permitida.' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'approved' and not exists (select 1 from public.maintenance_predictive_plan_items i where i.plan_id = p_plan_id and i.is_active) then
    raise exception 'O plano precisa de ao menos um item ativo para ser aprovado.' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'archived' and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo da inativação do plano.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_predictive_plans set
    approval_status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    version = case when p_status = 'approved' and exists (select 1 from public.maintenance_predictive_plan_versions pv where pv.plan_id = p_plan_id)
                   then version + 1
                   when p_status = 'archived' then version + 1
                   else version end
  where id = p_plan_id;
  if p_status = 'approved' then
    perform private.maintenance_predictive_snapshot(p_plan_id, coalesce(p_reason, 'Aprovação do plano'));
  elsif p_status = 'archived' then
    perform private.maintenance_predictive_snapshot(p_plan_id, p_reason);
  end if;
  if p_status in ('approved', 'archived') then
    v_synced := private.maintenance_predictive_sync_plan_fleet(p_plan_id);
    perform private.maintenance_predictive_refresh_quality(v_plan.organization_id);
    select count(*) into v_amb from public.maintenance_predictive_quality_issues q
     where q.organization_id = v_plan.organization_id and q.issue_type = 'plan_ambiguous' and q.resolved_at is null;
  end if;
  return jsonb_build_object('status', p_status, 'vehicles_synced', v_synced, 'ambiguous_vehicles', v_amb);
end;
$$;
revoke execute on function public.maintenance_set_predictive_plan_status(uuid, text, text) from public, anon;
grant  execute on function public.maintenance_set_predictive_plan_status(uuid, text, text) to authenticated;

-- 5.6 Duplicar plano (atômico; copia itens, roteiros e cobertura ativa)
create or replace function public.maintenance_duplicate_predictive_plan(p_plan_id uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.maintenance_predictive_plans;
  v_new  uuid;
  v_item public.maintenance_predictive_plan_items;
  v_new_item uuid;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id and deleted_at is null;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_predictive_require(v_plan.organization_id, 'plans');
  insert into public.maintenance_predictive_plans
    (organization_id, code, name, description, vehicle_type_id, vehicle_subcategory_id, vehicle_make_id, vehicle_model_id,
     year_from, year_to, source, reference_document, oem_reference, notes, valid_from, valid_to, approval_status, version)
  values
    (v_plan.organization_id, private.next_entity_code(v_plan.organization_id, 'predictive_plan', 'PPT-', 4),
     coalesce(nullif(btrim(p_name), ''), v_plan.name || ' (cópia)'), v_plan.description, v_plan.vehicle_type_id,
     v_plan.vehicle_subcategory_id, v_plan.vehicle_make_id, v_plan.vehicle_model_id, v_plan.year_from, v_plan.year_to,
     v_plan.source, v_plan.reference_document, v_plan.oem_reference, v_plan.notes, v_plan.valid_from, v_plan.valid_to, 'draft', 1)
  returning id into v_new;
  for v_item in select * from public.maintenance_predictive_plan_items where plan_id = p_plan_id order by sort_order, name loop
    insert into public.maintenance_predictive_plan_items
      (organization_id, plan_id, cluster_id, service_id, name, technical_description, interval_km, interval_days,
       interval_engine_hours, alert_pct, schedule_pct, tolerance_pct, criticality, sort_order, is_active, checklist)
    values
      (v_item.organization_id, v_new, v_item.cluster_id, v_item.service_id, v_item.name, v_item.technical_description,
       v_item.interval_km, v_item.interval_days, v_item.interval_engine_hours, v_item.alert_pct, v_item.schedule_pct,
       v_item.tolerance_pct, v_item.criticality, v_item.sort_order, v_item.is_active, v_item.checklist)
    returning id into v_new_item;
    insert into public.maintenance_predictive_coverage (organization_id, plan_item_id, service_id, coverage, is_active, created_by)
    select c.organization_id, v_new_item, c.service_id, c.coverage, true, auth.uid()
      from public.maintenance_predictive_coverage c where c.plan_item_id = v_item.id and c.is_active;
  end loop;
  return v_new;
end;
$$;
revoke execute on function public.maintenance_duplicate_predictive_plan(uuid, text) from public, anon;
grant  execute on function public.maintenance_duplicate_predictive_plan(uuid, text) to authenticated;

-- 5.7 Cadastros: planos com vigência e cobertura ativa (mesma assinatura)
create or replace function public.maintenance_parameters(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.has_permission(p_organization_id, 'maintenance.view') then
    jsonb_build_object('preventive_rules', '[]'::jsonb, 'predictive_plans', '[]'::jsonb)
  else jsonb_build_object(
    'preventive_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'vehicle_type_id', r.vehicle_type_id, 'vehicle_type_name', t.name,
               'vehicle_subcategory_id', r.vehicle_subcategory_id, 'vehicle_subcategory_name', sc.name,
               'vehicle_model_id', r.vehicle_model_id, 'vehicle_model_name', vm.name,
               'service_id', r.service_id, 'service_name', s.name,
               'interval_km', r.interval_km, 'initial_km', r.initial_km, 'cycle_count', r.cycle_count,
               'alert_before_pct', r.alert_before_pct, 'tolerance_after_pct', r.tolerance_after_pct,
               'criticality', r.criticality, 'status', r.status, 'notes', r.notes,
               'vehicles', (select count(distinct c.vehicle_id) from public.maintenance_preventive_cycles c
                             where c.organization_id = r.organization_id and c.rule_id = r.id),
               'updated_at', r.updated_at)
             order by t.name, sc.name nulls first, vm.name nulls first)
        from public.maintenance_preventive_rules r
        join public.vehicle_types t on t.id = r.vehicle_type_id
        left join public.vehicle_subcategories sc on sc.id = r.vehicle_subcategory_id
        left join public.vehicle_models vm on vm.id = r.vehicle_model_id
        left join public.maintenance_services s on s.organization_id = r.organization_id and s.id = r.service_id
       where r.organization_id = p_organization_id and r.deleted_at is null), '[]'::jsonb),
    'predictive_plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description,
               'vehicle_type_id', p.vehicle_type_id, 'vehicle_type_name', t.name,
               'vehicle_subcategory_id', p.vehicle_subcategory_id, 'vehicle_subcategory_name', sc.name,
               'vehicle_make_id', p.vehicle_make_id, 'vehicle_make_name', mk.name,
               'vehicle_model_id', p.vehicle_model_id, 'vehicle_model_name', vm.name,
               'year_from', p.year_from, 'year_to', p.year_to, 'source', p.source,
               'valid_from', p.valid_from, 'valid_to', p.valid_to,
               'reference_document', p.reference_document, 'oem_reference', p.oem_reference,
               'version', p.version, 'approval_status', p.approval_status, 'approved_at', p.approved_at,
               'approved_by_name', private.org_member_name(p.organization_id, p.approved_by),
               'is_active', p.is_active, 'notes', p.notes, 'updated_at', p.updated_at,
               'vehicles', (select count(distinct c.vehicle_id) from public.maintenance_predictive_cycles c
                             where c.organization_id = p.organization_id and c.plan_id = p.id and c.is_active),
               'ambiguous_vehicles', (select count(*) from public.maintenance_predictive_quality_issues q
                                       where q.organization_id = p.organization_id and q.plan_id = p.id
                                         and q.issue_type = 'plan_ambiguous' and q.resolved_at is null),
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', i.id, 'cluster_id', i.cluster_id, 'cluster_name', cl.name,
                          'service_id', i.service_id, 'service_name', sv.name,
                          'name', i.name, 'technical_description', i.technical_description,
                          'interval_km', i.interval_km, 'interval_days', i.interval_days,
                          'interval_engine_hours', i.interval_engine_hours,
                          'alert_pct', i.alert_pct, 'schedule_pct', i.schedule_pct, 'tolerance_pct', i.tolerance_pct,
                          'criticality', i.criticality, 'sort_order', i.sort_order, 'is_active', i.is_active,
                          'checklist', i.checklist,
                          'cycles', (select count(*) from public.maintenance_predictive_cycles c where c.plan_item_id = i.id and c.is_active),
                          'coverage', coalesce((
                            select jsonb_agg(jsonb_build_object('service_id', cv.service_id, 'service_name', cs.name,
                                                                'coverage', cv.coverage) order by cs.name)
                              from public.maintenance_predictive_coverage cv
                              join public.maintenance_services cs on cs.organization_id = cv.organization_id and cs.id = cv.service_id
                             where cv.organization_id = i.organization_id and cv.plan_item_id = i.id and cv.is_active), '[]'::jsonb))
                        order by i.sort_order, i.name)
                   from public.maintenance_predictive_plan_items i
                   join public.maintenance_clusters cl on cl.organization_id = i.organization_id and cl.id = i.cluster_id
                   left join public.maintenance_services sv on sv.organization_id = i.organization_id and sv.id = i.service_id
                  where i.organization_id = p.organization_id and i.plan_id = p.id), '[]'::jsonb),
               'versions', coalesce((
                 select jsonb_agg(jsonb_build_object('version', v.version, 'approval_status', v.approval_status,
                                                     'reason', v.reason, 'created_at', v.created_at,
                                                     'created_by_name', private.org_member_name(v.organization_id, v.created_by))
                                  order by v.version desc)
                   from public.maintenance_predictive_plan_versions v
                  where v.organization_id = p.organization_id and v.plan_id = p.id), '[]'::jsonb))
             order by p.is_active desc, p.name)
        from public.maintenance_predictive_plans p
        join public.vehicle_types t on t.id = p.vehicle_type_id
        left join public.vehicle_subcategories sc on sc.id = p.vehicle_subcategory_id
        left join public.vehicle_makes mk on mk.id = p.vehicle_make_id
        left join public.vehicle_models vm on vm.id = p.vehicle_model_id
       where p.organization_id = p_organization_id and p.deleted_at is null), '[]'::jsonb))
  end;
$$;

-- 5.8 Leitura pelas sessões autenticadas (a RLS filtra); escrita só pelas funções
grant select on public.maintenance_predictive_submissions, public.maintenance_predictive_events,
                public.maintenance_predictive_quality_issues, public.maintenance_predictive_snapshots to authenticated;
grant all    on public.maintenance_predictive_submissions, public.maintenance_predictive_events,
                public.maintenance_predictive_quality_issues, public.maintenance_predictive_snapshots to service_role;
