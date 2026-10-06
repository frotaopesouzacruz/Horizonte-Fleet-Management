-- =============================================================================
-- Gestão de Pneus — histórico de indicadores (snapshots periódicos imutáveis)
--
-- Toda sexta-feira às 22h (horário de Brasília — periodicidade configurável
-- em Parâmetros) o banco fotografa os indicadores: uma execução
-- (`tire_kpi_runs`) e os valores (`tire_kpi_values`) por indicador e
-- dimensão (Geral, Operação, Local de Operação, Liderança, Tipo de
-- Equipamento, Perfil/medida), com numerador, denominador, percentual e
-- quantidade. A série histórica NÃO depende de alterações posteriores da
-- planilha: os valores gravados nunca são atualizados nem recalculados
-- (gatilhos bloqueiam UPDATE/DELETE); uma revisão posterior dos dados só
-- aparece na próxima captura.
--
--   * agenda por organização (`tire_kpi_schedules`), conferida a cada 15 min
--     pelo pg_cron (`hfm_tires_kpi_tick`);
--   * no máximo UMA captura concluída por período (índice único) e uma em
--     andamento por organização — execução duplicada não duplica a série;
--   * falha parcial: os valores são gravados numa subtransação; se algo
--     falha, nenhum valor fica e a execução registra `falhou` com o motivo;
--   * janela de recuperação: se o banco ficou indisponível no horário, a
--     captura roda depois (até `catch_up_days`), avaliando os dados como
--     estavam na data do período (fotografia diária ≤ data, prazos contados
--     até a data); passou a janela → `ignorada`, sem inventar valor;
--   * reprocessamento controlado só de período sem captura concluída.
--
-- Aditiva: tabelas novas, `create or replace` de tire_rows (mesma assinatura,
-- leitura da organização inteira durante a captura).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Agenda, execuções e valores
-- -----------------------------------------------------------------------------
create table if not exists public.tire_kpi_schedules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  is_active        boolean not null default true,
  frequency        text not null default 'weekly',
  weekday          smallint not null default 5,
  month_day        smallint not null default 1,
  run_time         time not null default '22:00',
  timezone         text not null default 'America/Sao_Paulo',
  catch_up_days    smallint not null default 3,
  last_slot_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_by       uuid references auth.users (id) on delete set null,
  constraint tire_kpi_schedules_org_key unique (organization_id),
  constraint tire_kpi_schedules_frequency_check check (frequency in ('daily', 'weekly', 'monthly')),
  constraint tire_kpi_schedules_weekday_check check (weekday between 0 and 6),
  constraint tire_kpi_schedules_month_day_check check (month_day between 1 and 28),
  constraint tire_kpi_schedules_catch_up_check check (catch_up_days between 0 and 14)
);
comment on table public.tire_kpi_schedules is
  'Agenda da captura dos indicadores de pneus (padrão: semanal, sexta-feira 22h, America/Sao_Paulo).';

create table if not exists public.tire_kpi_runs (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  trigger                text not null,
  period_kind            text not null,
  period_key             text not null,
  slot_at                timestamptz not null,
  competence             date not null,
  iso_year               smallint not null,
  iso_week               smallint not null,
  month                  smallint not null,
  year                   smallint not null,
  status                 text not null default 'em_andamento',
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  executed_late          boolean not null default false,
  source_reference_date  date,
  source_batch_id        uuid references public.tire_import_batches (id) on delete restrict,
  tires_total            integer,
  tires_in_use           integer,
  values_count           integer not null default 0,
  error_message          text,
  requested_by           uuid references auth.users (id) on delete set null,
  requested_by_name      text,
  reprocess_of           uuid references public.tire_kpi_runs (id) on delete restrict,
  log                    jsonb not null default '[]'::jsonb,
  constraint tire_kpi_runs_trigger_check check (trigger in ('agendada', 'reprocessamento')),
  constraint tire_kpi_runs_kind_check check (period_kind in ('dia', 'semana', 'mes')),
  constraint tire_kpi_runs_status_check check (status in ('em_andamento', 'concluida', 'falhou', 'ignorada'))
);
comment on table public.tire_kpi_runs is
  'Execuções da captura de indicadores de pneus: período, horário planejado e real, dados de origem usados, resultado e log.';
create unique index if not exists tire_kpi_runs_period_uidx on public.tire_kpi_runs (organization_id, period_kind, period_key) where status = 'concluida';
create unique index if not exists tire_kpi_runs_running_uidx on public.tire_kpi_runs (organization_id) where status = 'em_andamento';
create index if not exists tire_kpi_runs_org_idx on public.tire_kpi_runs (organization_id, competence desc);

create table if not exists public.tire_kpi_values (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.tire_kpi_runs (id) on delete restrict,
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  period_kind      text not null,
  period_key       text not null,
  competence       date not null,
  captured_at      timestamptz not null,
  iso_year         smallint not null,
  iso_week         smallint not null,
  month            smallint not null,
  year             smallint not null,
  dimension        text not null,
  dimension_id     text not null default '',
  dimension_label  text,
  operation_id     uuid,
  city_id          integer,
  leader_id        uuid,
  indicator        text not null,
  numerator        integer,
  denominator      integer,
  percentage       numeric(6, 2),
  quantity         integer,
  constraint tire_kpi_values_dimension_check check (dimension in ('geral', 'operation', 'city', 'leader', 'vehicle_type', 'dimension')),
  constraint tire_kpi_values_key unique (run_id, dimension, dimension_id, indicator)
);
comment on table public.tire_kpi_values is
  'Valores imutáveis dos indicadores de pneus por captura, indicador e dimensão. Nunca atualizados nem recalculados.';
create index if not exists tire_kpi_values_series_idx on public.tire_kpi_values (organization_id, indicator, dimension, dimension_id, competence desc);

-- imutabilidade: valores nunca mudam; execução só sai de "em andamento" uma vez
create or replace function private.tg_tire_kpi_run_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'public.tire_kpi_runs é histórico: exclusão não permitida.' using errcode = 'insufficient_privilege';
  end if;
  if old.status <> 'em_andamento' then
    raise exception 'Execução de indicadores encerrada não pode ser alterada.' using errcode = 'insufficient_privilege';
  end if;
  if new.period_kind <> old.period_kind or new.period_key <> old.period_key or new.slot_at <> old.slot_at
     or new.organization_id <> old.organization_id then
    raise exception 'O período de uma execução de indicadores é imutável.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace trigger tire_kpi_runs_guard before update or delete on public.tire_kpi_runs
  for each row execute function private.tg_tire_kpi_run_guard();
create or replace trigger tire_kpi_values_append_only before update or delete on public.tire_kpi_values
  for each row execute function private.tg_block_mutation();
create or replace trigger tire_kpi_schedules_stamps before insert or update on public.tire_kpi_schedules
  for each row execute function private.tg_set_stamps();
create or replace trigger tire_kpi_schedules_prevent_tenant_change before update on public.tire_kpi_schedules
  for each row execute function private.tg_prevent_tenant_change();

do $rls$
declare t text;
begin
  foreach t in array array['tire_kpi_schedules', 'tire_kpi_runs', 'tire_kpi_values'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_kpi_schedules' and policyname = 'tire_kpi_schedules_select') then
    create policy tire_kpi_schedules_select on public.tire_kpi_schedules for select to authenticated
      using (private.has_permission(organization_id, 'tires.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_kpi_runs' and policyname = 'tire_kpi_runs_select') then
    create policy tire_kpi_runs_select on public.tire_kpi_runs for select to authenticated
      using (private.has_permission(organization_id, 'tires.dashboard.view'));
  end if;
  -- valores por dimensão: quem enxerga a organização inteira vê tudo; quem tem
  -- escopo por operação vê só as linhas da(s) própria(s) operação(ões)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_kpi_values' and policyname = 'tire_kpi_values_select') then
    create policy tire_kpi_values_select on public.tire_kpi_values for select to authenticated
      using (private.has_permission(organization_id, 'tires.dashboard.view')
             and (private.is_platform_admin()
                  or organization_id in (select private.permitted_org_ids('operations.access_all'))
                  or (dimension = 'operation' and operation_id is not null and operation_id in (select private.accessible_operation_ids()))));
  end if;
end $rls$;

insert into public.tire_kpi_schedules (organization_id)
select distinct p.organization_id from public.tire_parameter_sets p
on conflict (organization_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Leitura da organização inteira durante a captura (GUC local, ligada só
--    pela própria captura — nunca exposta a quem chama)
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
  -- recortes da conformidade e grupos "sem operação/local/liderança"
  f_nulls    text[] := private.jsonb_text_array(f -> 'null_dims');
  f_conf     text := nullif(f ->> 'overall_conformity', '');
  f_calconf  text := nullif(f ->> 'calibration_conformity', '');
  v_all      boolean := private.is_platform_admin() or private.is_privileged_context()
                        or coalesce(current_setting('hfm.tire_org_wide', true), '') = 'on'
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
     and (not f_retread or sc.retread)
     and (f_nulls is null or cardinality(f_nulls) = 0 or (
            (not ('operation' = any (f_nulls)) or sc.operation_id is null)
        and (not ('city' = any (f_nulls)) or sc.city_id is null)
        and (not ('leader' = any (f_nulls)) or sc.leader_employee_id is null)))
     and (f_conf is null or (sc.canonical_status = 'em_uso'
          and private.tire_overall_conform(sc.t_class, sc.m_status, sc.c_status, sc.p_status) = (f_conf = 'conforme')))
     and (f_calconf is null or (sc.canonical_status = 'em_uso'
          and private.tire_calibration_conform(sc.c_status, sc.p_status) = (f_calconf = 'conforme')));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Catálogo dos indicadores históricos (rótulo, tipo e sentido de melhora)
-- -----------------------------------------------------------------------------
create or replace function private.tire_kpi_catalog()
returns table (indicator text, label text, kind text, higher_is_better boolean, sort smallint)
language sql
immutable
set search_path = ''
as $$
  values
    ('overall_conformity', 'Conformidade Geral dos Pneus', 'pct', true, 1::smallint),
    ('calibration_conformity', 'Conformidade Geral de Calibragem', 'pct', true, 2::smallint),
    ('tread_conformity', 'Conformidade de Sulco (MM)', 'pct', true, 3::smallint),
    ('measurement_deadline', 'Prazo de Medição', 'pct', true, 4::smallint),
    ('calibration_deadline', 'Prazo de Calibragem', 'pct', true, 5::smallint),
    ('psi_conformity', 'Pressão (PSI) adequada', 'pct', true, 6::smallint),
    ('data_quality', 'Qualidade dos dados', 'pct', true, 7::smallint),
    ('tires_in_use', 'Pneus em uso', 'qty', null::boolean, 8::smallint),
    ('tires_total', 'Total de pneus', 'qty', null::boolean, 9::smallint),
    ('tread_critical', 'Sulco crítico ou abaixo do legal', 'qty', false, 10::smallint),
    ('measurement_overdue', 'Medições vencidas', 'qty', false, 11::smallint),
    ('calibration_overdue', 'Calibragens vencidas', 'qty', false, 12::smallint),
    ('psi_out', 'PSI fora da faixa', 'qty', false, 13::smallint),
    ('critical_tires', 'Pneus em criticidade Crítica', 'qty', false, 14::smallint);
$$;

-- Último horário planejado (≤ p_at) e chave do período, pela agenda
create or replace function private.tire_kpi_slot(s public.tire_kpi_schedules, p_at timestamptz)
returns table (slot_at timestamptz, competence date, period_kind text, period_key text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone s.timezone;
  v_day   date;
  v_slot  timestamp;
begin
  if s.frequency = 'daily' then
    v_day := v_local::date;
    v_slot := v_day + s.run_time;
    if v_slot > v_local then v_day := v_day - 1; v_slot := v_day + s.run_time; end if;
    return query select v_slot at time zone s.timezone, v_day, 'dia'::text, to_char(v_day, 'YYYY-MM-DD');
  elsif s.frequency = 'monthly' then
    v_day := make_date(extract(year from v_local)::int, extract(month from v_local)::int, s.month_day);
    v_slot := v_day + s.run_time;
    if v_slot > v_local then v_day := (v_day - interval '1 month')::date; v_slot := v_day + s.run_time; end if;
    return query select v_slot at time zone s.timezone, v_day, 'mes'::text, to_char(v_day, 'YYYY-MM');
  else
    v_day := v_local::date - ((extract(dow from v_local)::int - s.weekday + 7) % 7);
    v_slot := v_day + s.run_time;
    if v_slot > v_local then v_day := v_day - 7; v_slot := v_day + s.run_time; end if;
    return query select v_slot at time zone s.timezone, v_day, 'semana'::text, to_char(v_day, 'IYYY-"W"IW');
  end if;
end;
$$;

-- Próximo horário planejado (> p_at)
create or replace function private.tire_kpi_next_slot(s public.tire_kpi_schedules, p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case s.frequency
           when 'daily' then x.slot_at + interval '1 day'
           when 'monthly' then ((x.competence + interval '1 month')::date + s.run_time) at time zone s.timezone
           else x.slot_at + interval '7 days' end
    from private.tire_kpi_slot(s, p_at) x;
$$;

-- -----------------------------------------------------------------------------
-- 4. Captura (uma execução = um período). Sem conferência de permissão: quem
--    chama decide (a rotina do pg_cron ou a RPC de reprocessamento).
-- -----------------------------------------------------------------------------
create or replace function private.tire_kpi_capture(
  p_organization_id uuid, p_slot_at timestamptz, p_competence date, p_period_kind text, p_period_key text,
  p_trigger text, p_reprocess_of uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run   uuid;
  v_ref   date;
  v_batch uuid;
  v_n     integer := 0;
  v_total integer;
  v_use   integer;
  v_late  boolean := now() - p_slot_at > interval '1 hour';
begin
  insert into public.tire_kpi_runs (organization_id, trigger, period_kind, period_key, slot_at, competence, iso_year, iso_week,
                                    month, year, executed_late, requested_by, requested_by_name, reprocess_of, log)
  values (p_organization_id, p_trigger, p_period_kind, p_period_key, p_slot_at, p_competence,
          extract(isoyear from p_competence)::smallint, extract(week from p_competence)::smallint,
          extract(month from p_competence)::smallint, extract(year from p_competence)::smallint, v_late,
          auth.uid(), case when auth.uid() is null then 'Captura agendada' else private.tire_actor_name(p_organization_id) end,
          p_reprocess_of,
          jsonb_build_array(jsonb_build_object('at', now(), 'level', 'info',
            'message', format('Captura do período %s (horário planejado %s)%s.', p_period_key,
                              to_char(p_slot_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                              case when v_late then ' — executada com atraso' else '' end))))
  returning id into v_run;

  -- dados de origem: a última data confirmada até a data do período
  select b.reference_date, b.id into v_ref, v_batch from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date <= p_competence
   order by b.reference_date desc limit 1;
  if v_ref is null then
    update public.tire_kpi_runs r set status = 'ignorada', finished_at = now(),
           error_message = 'Sem dados de pneus confirmados até a data do período.',
           log = r.log || jsonb_build_array(jsonb_build_object('at', now(), 'level', 'warning', 'message', 'Sem dados de pneus até a data: nada capturado.'))
     where r.id = v_run;
    return v_run;
  end if;

  perform set_config('hfm.tire_actor', 'Captura automática de indicadores', true);
  begin
    perform set_config('hfm.tire_org_wide', 'on', true);
    with r as materialized (
      select x.* from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', v_ref), p_competence) x),
    u as materialized (
      select r.*,
             private.tire_mm_ok(r.tread_class) as mm_ok,
             private.tire_deadline_ok(r.measurement_status) as meas_ok,
             private.tire_deadline_ok(r.calibration_status) as cal_ok,
             private.tire_psi_ok(r.psi_status) as psi_ok,
             private.tire_calibration_conform(r.calibration_status, r.psi_status) as cal_conf,
             private.tire_overall_conform(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status) as all_conf
        from r where r.canonical_status = 'em_uso'),
    -- quantidades por dimensão (pneus em uso) + agrupamento geral
    g as (
      select case when grouping(u.operation_id) = 0 then 'operation' when grouping(u.city_id) = 0 then 'city'
                  when grouping(u.leader_employee_id) = 0 then 'leader' when grouping(u.vehicle_type_id) = 0 then 'vehicle_type'
                  when grouping(u.dimension_key) = 0 then 'dimension' else 'geral' end as dim,
             case when grouping(u.operation_id) = 0 then coalesce(u.operation_id::text, '—')
                  when grouping(u.city_id) = 0 then coalesce(u.city_id::text, '—')
                  when grouping(u.leader_employee_id) = 0 then coalesce(u.leader_employee_id::text, '—')
                  when grouping(u.vehicle_type_id) = 0 then coalesce(u.vehicle_type_id::text, '—')
                  when grouping(u.dimension_key) = 0 then coalesce(u.dimension_key, '—') else '' end as did,
             case when grouping(u.operation_id) = 0 then coalesce(min(u.operation_name), 'Sem operação')
                  when grouping(u.city_id) = 0 then coalesce(min(u.city_name) || ' · ' || min(u.state_uf), 'Sem local')
                  when grouping(u.leader_employee_id) = 0 then coalesce(min(u.leader_name), 'Sem liderança')
                  when grouping(u.vehicle_type_id) = 0 then coalesce(min(u.vehicle_type_name), 'Sem tipo')
                  when grouping(u.dimension_key) = 0 then coalesce(min(u.dimension), 'Sem medida') else 'Geral' end as dlabel,
             case when grouping(u.operation_id) = 0 then u.operation_id end as op_id,
             case when grouping(u.city_id) = 0 then u.city_id end as ci_id,
             case when grouping(u.leader_employee_id) = 0 then u.leader_employee_id end as le_id,
             count(*)::int as in_use,
             count(*) filter (where u.mm_ok)::int as mm_ok, count(*) filter (where u.meas_ok)::int as meas_ok,
             count(*) filter (where u.cal_ok)::int as cal_ok, count(*) filter (where u.psi_ok)::int as psi_ok,
             count(*) filter (where u.cal_conf)::int as cal_conf, count(*) filter (where u.all_conf)::int as all_conf,
             count(*) filter (where u.tread_class in ('abaixo_legal', 'critico'))::int as tread_critical,
             count(*) filter (where u.measurement_status = 'vencido')::int as meas_over,
             count(*) filter (where u.calibration_status = 'vencido')::int as cal_over,
             count(*) filter (where u.psi_status in ('baixa', 'excesso'))::int as psi_out,
             count(*) filter (where u.severity = 'critica')::int as critical
        from u
       group by grouping sets ((), (u.operation_id), (u.city_id), (u.leader_employee_id), (u.vehicle_type_id), (u.dimension_key))),
    vals as (
      select g.*, x.indicator,
             case x.indicator when 'tread_conformity' then g.mm_ok when 'measurement_deadline' then g.meas_ok
                              when 'calibration_deadline' then g.cal_ok when 'psi_conformity' then g.psi_ok
                              when 'calibration_conformity' then g.cal_conf when 'overall_conformity' then g.all_conf end as num,
             case x.indicator when 'tires_in_use' then g.in_use when 'tread_critical' then g.tread_critical
                              when 'measurement_overdue' then g.meas_over when 'calibration_overdue' then g.cal_over
                              when 'psi_out' then g.psi_out when 'critical_tires' then g.critical end as qty
        from g cross join (values ('tread_conformity'), ('measurement_deadline'), ('calibration_deadline'), ('psi_conformity'),
                                  ('calibration_conformity'), ('overall_conformity'), ('tires_in_use'), ('tread_critical'),
                                  ('measurement_overdue'), ('calibration_overdue'), ('psi_out'), ('critical_tires')) x(indicator)),
    ins as (
      insert into public.tire_kpi_values (run_id, organization_id, period_kind, period_key, competence, captured_at, iso_year, iso_week,
                                          month, year, dimension, dimension_id, dimension_label, operation_id, city_id, leader_id,
                                          indicator, numerator, denominator, percentage, quantity)
      select v_run, p_organization_id, p_period_kind, p_period_key, p_competence, p_slot_at,
             extract(isoyear from p_competence)::smallint, extract(week from p_competence)::smallint,
             extract(month from p_competence)::smallint, extract(year from p_competence)::smallint,
             vals.dim, vals.did, vals.dlabel, vals.op_id, vals.ci_id, vals.le_id, vals.indicator,
             vals.num, case when vals.num is not null then vals.in_use end,
             case when vals.num is not null then round(100.0 * vals.num / nullif(vals.in_use, 0), 2) end,
             vals.qty
        from vals
      union all
      -- totais e qualidade sobre a base inteira (não só em uso)
      select v_run, p_organization_id, p_period_kind, p_period_key, p_competence, p_slot_at,
             extract(isoyear from p_competence)::smallint, extract(week from p_competence)::smallint,
             extract(month from p_competence)::smallint, extract(year from p_competence)::smallint,
             'geral', '', 'Geral', null, null, null, t.indicator, t.num, t.den,
             case when t.num is not null then round(100.0 * t.num / nullif(t.den, 0), 2) end, t.qty
        from (select 'tires_total' as indicator, null::int as num, null::int as den, count(*)::int as qty from r
              union all
              select 'data_quality', count(*) filter (where cardinality(r.quality_flags) = 0)::int, count(*)::int, null from r) t
      returning 1)
    select count(*) into v_n from ins;

    select count(*), count(*) filter (where x.canonical_status = 'em_uso') into v_total, v_use
      from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', v_ref), p_competence) x;
    perform set_config('hfm.tire_org_wide', '', true);

    update public.tire_kpi_runs r set status = 'concluida', finished_at = now(), source_reference_date = v_ref, source_batch_id = v_batch,
           values_count = v_n, tires_total = v_total, tires_in_use = v_use,
           log = r.log || jsonb_build_array(jsonb_build_object('at', now(), 'level', 'info',
             'message', format('%s valores gravados a partir dos dados Rodopar de %s (%s pneus, %s em uso).', v_n,
                               to_char(v_ref, 'DD/MM/YYYY'), v_total, v_use)))
     where r.id = v_run;
  exception when others then
    -- falha parcial: a subtransação desfaz os valores; a execução registra o motivo
    perform set_config('hfm.tire_org_wide', '', true);
    update public.tire_kpi_runs r set status = 'falhou', finished_at = now(), source_reference_date = v_ref,
           error_message = left(sqlerrm, 1000),
           log = r.log || jsonb_build_array(jsonb_build_object('at', now(), 'level', 'error', 'message', left(sqlerrm, 500)))
     where r.id = v_run;
  end;

  perform private.tire_audit(p_organization_id, 'kpi.captured', 'tire_kpi_run', v_run,
    format('Indicadores de pneus capturados (%s, %s): %s.', p_period_key, p_trigger,
           (select r.status from public.tire_kpi_runs r where r.id = v_run)));
  return v_run;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Rotina do pg_cron (a cada 15 min): captura o período devido, uma vez
-- -----------------------------------------------------------------------------
create or replace function private.tire_kpi_tick(p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s       public.tire_kpi_schedules;
  x       record;
  v_at    timestamptz := coalesce(p_at, now());
  v_done  jsonb := '[]'::jsonb;
  v_run   uuid;
begin
  for s in select * from public.tire_kpi_schedules k where k.is_active loop
    select * into x from private.tire_kpi_slot(s, v_at);
    -- horário anterior à criação da agenda: não existe dado "da época" a capturar
    if x.slot_at < s.created_at then continue; end if;
    if exists (select 1 from public.tire_kpi_runs r where r.organization_id = s.organization_id and r.period_kind = x.period_kind
                and r.period_key = x.period_key and r.status in ('concluida', 'ignorada', 'em_andamento')) then
      continue;
    end if;
    -- no máximo 3 tentativas automáticas por período
    if (select count(*) from public.tire_kpi_runs r where r.organization_id = s.organization_id and r.period_kind = x.period_kind
          and r.period_key = x.period_key and r.status = 'falhou') >= 3 then
      continue;
    end if;
    if v_at - x.slot_at > make_interval(days => s.catch_up_days) then
      insert into public.tire_kpi_runs (organization_id, trigger, period_kind, period_key, slot_at, competence, iso_year, iso_week,
                                        month, year, status, finished_at, executed_late, error_message, requested_by_name, log)
      values (s.organization_id, 'agendada', x.period_kind, x.period_key, x.slot_at, x.competence,
              extract(isoyear from x.competence)::smallint, extract(week from x.competence)::smallint,
              extract(month from x.competence)::smallint, extract(year from x.competence)::smallint,
              'ignorada', now(), true,
              format('Janela de captura perdida (mais de %s dias após o horário planejado). O histórico não é recalculado retroativamente.', s.catch_up_days),
              'Captura agendada', '[]'::jsonb);
      continue;
    end if;
    begin
      v_run := private.tire_kpi_capture(s.organization_id, x.slot_at, x.competence, x.period_kind, x.period_key, 'agendada');
      update public.tire_kpi_schedules k set last_slot_at = x.slot_at where k.id = s.id;
      v_done := v_done || jsonb_build_object('organization_id', s.organization_id, 'period_key', x.period_key, 'run_id', v_run);
    exception when unique_violation then
      null; -- outra execução simultânea já capturou ou está capturando este período
    end;
  end loop;
  return jsonb_build_object('at', v_at, 'captured', v_done);
end;
$$;

comment on function private.tire_kpi_tick(timestamptz) is
  'pg_cron hfm_tires_kpi_tick (a cada 15 min): captura, uma única vez, o período devido de cada agenda ativa de indicadores de pneus.';

-- -----------------------------------------------------------------------------
-- 6. Agenda (Parâmetros) e reprocessamento controlado
-- -----------------------------------------------------------------------------
create or replace function public.tire_kpi_schedule_save(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s  public.tire_kpi_schedules;
  n  public.tire_kpi_schedules;
  x  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_freq text := coalesce(nullif(x ->> 'frequency', ''), 'weekly');
  v_time time;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if v_freq not in ('daily', 'weekly', 'monthly') then raise exception 'Periodicidade inválida.' using errcode = 'invalid_parameter_value'; end if;
  begin
    v_time := coalesce(nullif(x ->> 'run_time', ''), '22:00')::time;
  exception when others then
    raise exception 'Horário inválido (use HH:MM).' using errcode = 'invalid_parameter_value';
  end;
  if coalesce(nullif(x ->> 'weekday', '')::int, 5) not between 0 and 6 then raise exception 'Dia da semana inválido.' using errcode = 'invalid_parameter_value'; end if;
  if coalesce(nullif(x ->> 'month_day', '')::int, 1) not between 1 and 28 then raise exception 'Dia do mês deve ser de 1 a 28.' using errcode = 'invalid_parameter_value'; end if;
  if coalesce(nullif(x ->> 'catch_up_days', '')::int, 3) not between 0 and 14 then raise exception 'Janela de recuperação de 0 a 14 dias.' using errcode = 'invalid_parameter_value'; end if;

  select * into s from public.tire_kpi_schedules k where k.organization_id = p_organization_id for update;
  if s.id is null then
    insert into public.tire_kpi_schedules (organization_id) values (p_organization_id) returning * into s;
  end if;
  update public.tire_kpi_schedules k set
    is_active = coalesce(nullif(x ->> 'is_active', '')::boolean, k.is_active),
    frequency = v_freq, run_time = v_time,
    weekday = coalesce(nullif(x ->> 'weekday', '')::smallint, k.weekday),
    month_day = coalesce(nullif(x ->> 'month_day', '')::smallint, k.month_day),
    catch_up_days = coalesce(nullif(x ->> 'catch_up_days', '')::smallint, k.catch_up_days)
   where k.id = s.id
  returning * into n;
  perform private.tire_audit(p_organization_id, 'kpi.schedule_saved', 'tire_kpi_schedule', n.id,
    format('Agenda dos indicadores de pneus: %s às %s (%s).',
           case n.frequency when 'daily' then 'diária' when 'monthly' then format('mensal, dia %s', n.month_day)
                else format('semanal, %s', (array['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'])[n.weekday + 1]) end,
           to_char(n.run_time, 'HH24:MI'), case when n.is_active then 'ativa' else 'pausada' end),
    to_jsonb(s), to_jsonb(n));
  return to_jsonb(n) || jsonb_build_object('next_slot_at', private.tire_kpi_next_slot(n, now()));
end;
$$;

create or replace function public.tire_kpi_reprocess(p_organization_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.tire_kpi_runs;
  s     public.tire_kpi_schedules;
  v_new uuid;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  select * into r from public.tire_kpi_runs x where x.id = p_run_id and x.organization_id = p_organization_id;
  if r.id is null then raise exception 'Execução não encontrada.' using errcode = 'no_data_found'; end if;
  if r.status not in ('falhou', 'ignorada') then
    raise exception 'Só uma captura que falhou ou foi ignorada pode ser reprocessada.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.tire_kpi_runs x where x.organization_id = p_organization_id and x.period_kind = r.period_kind
              and x.period_key = r.period_key and x.status = 'concluida') then
    raise exception 'Este período já tem captura concluída: o histórico não é recalculado.' using errcode = 'unique_violation';
  end if;
  select * into s from public.tire_kpi_schedules k where k.organization_id = p_organization_id;
  v_new := private.tire_kpi_capture(p_organization_id, r.slot_at, r.competence, r.period_kind, r.period_key, 'reprocessamento', r.id);
  return (select to_jsonb(x) - 'log' from public.tire_kpi_runs x where x.id = v_new);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Evolução dos indicadores: série semanal/mensal, atual × anterior,
--    variação, tendência e ranking das dimensões
-- -----------------------------------------------------------------------------
create or replace function public.tires_kpi_history(
  p_organization_id uuid, p_period text default 'semana', p_indicator text default 'overall_conformity',
  p_dimension text default 'geral', p_dimension_id text default null, p_limit integer default 26)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 26), 2), 104);
  v_all   boolean := private.is_platform_admin() or private.is_privileged_context()
                     or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_ops   uuid[] := '{}';
  c       record;
  s       public.tire_kpi_schedules;
  v_res   jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.dashboard.view');
  if p_period not in ('semana', 'mes') then raise exception 'Período inválido.' using errcode = 'invalid_parameter_value'; end if;
  if p_dimension not in ('geral', 'operation', 'city', 'leader', 'vehicle_type', 'dimension') then
    raise exception 'Dimensão inválida.' using errcode = 'invalid_parameter_value';
  end if;
  select * into c from private.tire_kpi_catalog() k where k.indicator = p_indicator;
  if c.indicator is null then raise exception 'Indicador inválido.' using errcode = 'invalid_parameter_value'; end if;
  if not v_all then
    select coalesce(array_agg(x), '{}') into v_ops from private.accessible_operation_ids() x;
    -- escopo por operação: só as próprias operações (o "geral" vira a soma delas)
    if p_dimension not in ('geral', 'operation') then
      raise exception 'Esta visão por dimensão exige acesso a todas as operações.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  select * into s from public.tire_kpi_schedules k where k.organization_id = p_organization_id;

  with runs as (
    -- semanal: cada captura semanal; mensal: a última captura semanal de cada mês
    select r.* from public.tire_kpi_runs r
     where r.organization_id = p_organization_id and r.status = 'concluida'
       and (p_period = 'semana' or r.id in (
             select distinct on (date_trunc('month', x.competence)) x.id from public.tire_kpi_runs x
              where x.organization_id = p_organization_id and x.status = 'concluida'
              order by date_trunc('month', x.competence), x.competence desc, x.slot_at desc))),
  pts_all as (
    select r.id as run_id, r.period_key, r.competence, r.slot_at, r.source_reference_date,
           case when p_period = 'mes' then to_char(r.competence, 'YYYY-MM') else r.period_key end as pkey,
           v.dimension_id, v.dimension_label, v.numerator, v.denominator, v.quantity, v.percentage
      from runs r
      join public.tire_kpi_values v on v.run_id = r.id and v.indicator = p_indicator
       and ((v_all and v.dimension = p_dimension)
            or (not v_all and v.dimension = 'operation' and v.operation_id = any (v_ops)))),
  -- série do recorte escolhido (geral para escopo restrito = soma das próprias operações)
  series as (
    select p.run_id, min(p.pkey) as pkey, min(p.competence) as competence, min(p.slot_at) as slot_at,
           min(p.source_reference_date) as source_reference_date,
           sum(p.numerator)::int as numerator, sum(p.denominator)::int as denominator, sum(p.quantity)::int as quantity,
           case when sum(p.denominator) is null then null
                else round(100.0 * sum(p.numerator) / nullif(sum(p.denominator), 0), 2) end as percentage
      from pts_all p
     where p_dimension = 'geral' or p.dimension_id = p_dimension_id
     group by p.run_id),
  ser as (select series.*, row_number() over (order by series.competence desc, series.slot_at desc) as rn from series),
  -- membros da dimensão: atual × anterior (as duas capturas mais recentes)
  last2 as (select r.id, row_number() over (order by r.competence desc, r.slot_at desc) as rn from runs r),
  mem as (
    select p.dimension_id as id, min(p.dimension_label) as label,
           max(case when l.rn = 1 then coalesce(p.percentage, p.quantity) end) as cur,
           max(case when l.rn = 2 then coalesce(p.percentage, p.quantity) end) as prev
      from pts_all p join last2 l on l.id = p.run_id and l.rn <= 2
     where p_dimension <> 'geral'
     group by p.dimension_id)
  select jsonb_build_object(
    'period', p_period, 'indicator', p_indicator, 'dimension', p_dimension, 'dimension_id', p_dimension_id,
    'label', c.label, 'kind', c.kind, 'higher_is_better', c.higher_is_better, 'scoped', not v_all,
    'schedule', case when s.id is null then null else to_jsonb(s) || jsonb_build_object('next_slot_at', private.tire_kpi_next_slot(s, now())) end,
    'catalog', (select jsonb_agg(jsonb_build_object('indicator', k.indicator, 'label', k.label, 'kind', k.kind, 'higher_is_better', k.higher_is_better) order by k.sort)
                  from private.tire_kpi_catalog() k),
    'series', coalesce((select jsonb_agg(jsonb_build_object('run_id', ser.run_id, 'period_key', ser.pkey, 'competence', ser.competence,
                                                            'slot_at', ser.slot_at, 'source_reference_date', ser.source_reference_date,
                                                            'numerator', ser.numerator, 'denominator', ser.denominator,
                                                            'percentage', ser.percentage, 'quantity', ser.quantity) order by ser.competence, ser.slot_at)
                          from ser where ser.rn <= v_limit), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', mem.id, 'label', mem.label, 'current', mem.cur, 'previous', mem.prev,
                                                             'delta', mem.cur - mem.prev) order by (mem.cur - mem.prev) nulls last, mem.label)
                           from mem), '[]'::jsonb),
    'summary', (select coalesce(jsonb_agg(jsonb_build_object('indicator', z.indicator, 'label', z.label, 'kind', z.kind,
                                                             'higher_is_better', z.hib, 'current', z.cur, 'previous', z.prev) order by z.sort), '[]'::jsonb)
                  from (select k.indicator, k.label, k.kind, k.higher_is_better as hib, k.sort,
                               (select case when k.kind = 'pct' then round(100.0 * sum(v.numerator) / nullif(sum(v.denominator), 0), 2) else sum(v.quantity) end
                                  from public.tire_kpi_values v join last2 l on l.id = v.run_id and l.rn = 1
                                 where v.indicator = k.indicator
                                   and ((v_all and v.dimension = 'geral') or (not v_all and v.dimension = 'operation' and v.operation_id = any (v_ops)))) as cur,
                               (select case when k.kind = 'pct' then round(100.0 * sum(v.numerator) / nullif(sum(v.denominator), 0), 2) else sum(v.quantity) end
                                  from public.tire_kpi_values v join last2 l on l.id = v.run_id and l.rn = 2
                                 where v.indicator = k.indicator
                                   and ((v_all and v.dimension = 'geral') or (not v_all and v.dimension = 'operation' and v.operation_id = any (v_ops)))) as prev
                          from private.tire_kpi_catalog() k) z),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) - 'log' order by r.slot_at desc)
                        from (select * from public.tire_kpi_runs r where r.organization_id = p_organization_id
                               order by r.slot_at desc, r.started_at desc limit 12) r), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. pg_cron e grants
-- -----------------------------------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'hfm_tires_kpi_tick') then
    perform cron.schedule('hfm_tires_kpi_tick', '*/15 * * * *', 'select private.tire_kpi_tick()');
  end if;
end $cron$;

revoke execute on function private.tire_kpi_capture(uuid, timestamptz, date, text, text, text, uuid),
  private.tire_kpi_tick(timestamptz), private.tg_tire_kpi_run_guard() from public, anon, authenticated;
revoke execute on function private.tire_kpi_catalog(), private.tire_kpi_slot(public.tire_kpi_schedules, timestamptz),
  private.tire_kpi_next_slot(public.tire_kpi_schedules, timestamptz) from public, anon;
revoke execute on function public.tire_kpi_schedule_save(uuid, jsonb), public.tire_kpi_reprocess(uuid, uuid),
  public.tires_kpi_history(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.tire_kpi_schedule_save(uuid, jsonb), public.tire_kpi_reprocess(uuid, uuid),
  public.tires_kpi_history(uuid, text, text, text, text, integer) to authenticated, service_role;
