-- =============================================================================
-- Gestão de KM Rodado — leituras (visão geral, planner, visão diária,
-- histórico, análise gerencial, dispersão, projeções, qualidade) e correções
--
-- Uma base só para todas as telas e exportações: private.km_grid devolve TODOS
-- os veículos elegíveis × TODOS os dias do período, com a leitura do dia (ou a
-- ausência dela) e o contexto vigente na data. Tela, PDF e Excel leem o mesmo
-- conjunto com os mesmos filtros: os números não divergem.
--
--   * Veículo sem leitura continua aparecendo (Sem leitura ≠ 0 km).
--   * O contexto (operação, local, BR, liderança) é o da DATA: um veículo que
--     mudou de BR no mês não é reclassificado pelo BR atual; um filtro de BR
--     marca os outros dias como "fora do filtro", nunca como "sem leitura".
--   * Escopo: a pessoa vê o dia cujo contexto está nas suas operações (ou, sem
--     contexto, o veículo do seu escopo), como a RLS do razão.
--   * Médias sempre acompanhadas de medianas; estatística só com cobertura
--     mínima; benchmark só dentro da coorte técnica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Filtros e período
-- -----------------------------------------------------------------------------
create or replace function private.km_uuid_array(p jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array'
              then (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(p) x where x ~ '^[0-9a-f-]{36}$')
         end;
$$;

create or replace function private.km_int_array(p jsonb)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array'
              then (select coalesce(array_agg(x::integer), '{}') from jsonb_array_elements_text(p) x where x ~ '^\d+$')
         end;
$$;

-- Último dia com KM validado da organização (até hoje).
create or replace function private.km_last_valid_day(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(r.reading_date) from public.km_daily_readings r
   where r.organization_id = p_organization_id and r.distance_validated is not null
     and r.reading_date <= private.maintenance_today(p_organization_id);
$$;

-- Período do filtro: datas explícitas; senão a competência (YYYY-MM); senão a
-- competência do último dia com KM validado (não um mês ainda vazio).
create or replace function private.km_period(p_organization_id uuid, p_filters jsonb)
returns table (date_from date, date_to date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := nullif(p_filters ->> 'date_from', '')::date;
  v_to   date := nullif(p_filters ->> 'date_to', '')::date;
  v_comp text := nullif(p_filters ->> 'competence', '');
  v_ref  date;
begin
  if v_from is not null and v_to is not null then
    if v_to < v_from then
      raise exception 'Período inválido: a data final é anterior à inicial.' using errcode = 'invalid_parameter_value';
    end if;
    if v_to - v_from > 400 then
      raise exception 'Período acima de 400 dias. Reduza o intervalo.' using errcode = 'invalid_parameter_value';
    end if;
    return query select v_from, v_to;
    return;
  end if;
  if v_comp ~ '^\d{4}-\d{2}$' then
    v_ref := (v_comp || '-01')::date;
  else
    v_ref := coalesce(private.km_last_valid_day(p_organization_id), private.maintenance_today(p_organization_id));
  end if;
  return query select date_trunc('month', v_ref)::date, (date_trunc('month', v_ref) + interval '1 month - 1 day')::date;
end;
$$;

revoke all on function private.km_uuid_array(jsonb), private.km_int_array(jsonb), private.km_last_valid_day(uuid),
  private.km_period(uuid, jsonb) from public, anon;
grant execute on function private.km_uuid_array(jsonb), private.km_int_array(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. A grade veículo × dia
-- -----------------------------------------------------------------------------
create or replace function private.km_grid(p_organization_id uuid, p_from date, p_to date, p_filters jsonb)
returns table (
  vehicle_id uuid, day date, reading_id uuid, status text, has_reading boolean, counts boolean,
  odometer_start numeric, odometer_end numeric, km numeric, km_informed numeric, km_calculated numeric,
  alerts text[], is_corrected boolean, context_source text, operation_id uuid, operation_city_id uuid,
  state_id smallint, city_id integer, operation_br_id uuid, leader_employee_id uuid, organization_unit_id uuid,
  in_filter boolean, is_future boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f         jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today   date := private.maintenance_today(p_organization_id);
  v_all     boolean := private.is_platform_admin()
                       or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_ops     uuid[];
  v_veh     uuid[];
  f_ops     uuid[] := private.km_uuid_array(f -> 'operation_ids');
  f_brs     uuid[] := private.km_uuid_array(f -> 'br_ids');
  f_leaders uuid[] := private.km_uuid_array(f -> 'leader_ids');
  f_units   uuid[] := private.km_uuid_array(f -> 'unit_ids');
  f_states  integer[] := private.km_int_array(f -> 'state_ids');
  f_cities  integer[] := private.km_int_array(f -> 'city_ids');
  f_vehs    uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  f_types   uuid[] := private.km_uuid_array(f -> 'vehicle_type_ids');
  f_subs    uuid[] := private.km_uuid_array(f -> 'subcategory_ids');
  f_models  uuid[] := private.km_uuid_array(f -> 'model_ids');
  f_search  text := nullif(btrim(coalesce(f ->> 'search', '')), '');
  f_fleet   text := coalesce(nullif(f ->> 'fleet_status', ''), 'default');
  f_rstat   text[] := case when jsonb_typeof(f -> 'reading_statuses') = 'array'
                           then array(select jsonb_array_elements_text(f -> 'reading_statuses')) end;
  v_ctx_f   boolean;
  v_miss_v  uuid[];
  v_miss_d  date[];
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Período inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if not v_all then
    v_ops := array(select private.accessible_operation_ids());
    v_veh := array(select private.org_vehicle_scope_ids(p_organization_id));
  end if;
  v_ctx_f := coalesce(cardinality(f_ops), 0) + coalesce(cardinality(f_brs), 0) + coalesce(cardinality(f_leaders), 0)
             + coalesce(cardinality(f_units), 0) + coalesce(cardinality(f_states), 0) + coalesce(cardinality(f_cities), 0) > 0;

  -- pares sem leitura no razão: contexto calculado na hora (mesma regra)
  select array_agg(v.id), array_agg(d.day)
    into v_miss_v, v_miss_d
    from public.vehicles v
    cross join (select g::date as day from generate_series(p_from, p_to, interval '1 day') g) d
   where v.organization_id = p_organization_id and v.deleted_at is null
     and (f_vehs is null or v.id = any (f_vehs))
     and (f_types is null or v.vehicle_type_id = any (f_types))
     and (f_subs is null or v.vehicle_subcategory_id = any (f_subs))
     and (f_models is null or v.vehicle_model_id = any (f_models))
     and not exists (select 1 from public.km_daily_readings r
                      where r.organization_id = p_organization_id and r.vehicle_id = v.id and r.reading_date = d.day);

  return query
  with veh as (
    select v.id, v.status, v.license_plate, v.fleet_code
      from public.vehicles v
     where v.organization_id = p_organization_id and v.deleted_at is null
       and (f_vehs is null or v.id = any (f_vehs))
       and (f_types is null or v.vehicle_type_id = any (f_types))
       and (f_subs is null or v.vehicle_subcategory_id = any (f_subs))
       and (f_models is null or v.vehicle_model_id = any (f_models))
       and (f_search is null
            or private.normalize_plate(v.license_plate) like '%' || private.normalize_plate(f_search) || '%'
            or upper(coalesce(v.fleet_code, '')) like '%' || upper(f_search) || '%')
  ),
  miss as (select * from private.km_context_pairs(p_organization_id, coalesce(v_miss_v, '{}'), coalesce(v_miss_d, '{}'))),
  g as (
    select veh.id as vehicle_id, d.day, r.id as reading_id,
           coalesce(r.status, 'no_reading') as status,
           coalesce(s.has_reading, false) as has_reading,
           coalesce(s.counts_distance, false) and r.distance_validated is not null as counts,
           r.odometer_start, r.odometer_end, r.distance_validated as km, r.distance_imported as km_informed,
           r.distance_calculated as km_calculated, coalesce(r.alerts, '{}') as alerts, coalesce(r.is_corrected, false) as is_corrected,
           coalesce(r.context_source, m.context_source, 'none') as context_source,
           case when r.id is not null then r.operation_id else m.operation_id end as operation_id,
           case when r.id is not null then r.operation_city_id else m.operation_city_id end as operation_city_id,
           case when r.id is not null then r.state_id else m.state_id end as state_id,
           case when r.id is not null then r.city_id else m.city_id end as city_id,
           case when r.id is not null then r.operation_br_id else m.operation_br_id end as operation_br_id,
           case when r.id is not null then r.leader_employee_id else m.leader_employee_id end as leader_employee_id,
           case when r.id is not null then r.organization_unit_id else m.organization_unit_id end as organization_unit_id,
           d.day > v_today as is_future, veh.status as vehicle_status
      from veh
      cross join (select gs::date as day from generate_series(p_from, p_to, interval '1 day') gs) d
      left join public.km_daily_readings r
        on r.organization_id = p_organization_id and r.vehicle_id = veh.id and r.reading_date = d.day
      left join public.km_reading_statuses s on s.code = r.status
      left join miss m on r.id is null and m.vehicle_id = veh.id and m.day = d.day
  ),
  vis as (
    select g.*,
           (not v_ctx_f or (
              (f_ops is null or g.operation_id = any (f_ops))
              and (f_brs is null or g.operation_br_id = any (f_brs))
              and (f_leaders is null or g.leader_employee_id = any (f_leaders))
              and (f_units is null or g.organization_unit_id = any (f_units))
              and (f_states is null or g.state_id = any (f_states))
              and (f_cities is null or g.city_id = any (f_cities))))
           and (f_rstat is null or g.status = any (f_rstat)) as in_filter
      from g
     where v_all
        or (g.operation_id is not null and g.operation_id = any (v_ops))
        or (g.operation_id is null and g.vehicle_id = any (v_veh))
  ),
  elig as (
    select vis.vehicle_id
      from vis
     group by vis.vehicle_id
    having bool_or(vis.in_filter)
       and case f_fleet
             when 'all'      then true
             when 'active'   then bool_or(vis.vehicle_status = 'active')
             when 'inactive' then bool_or(vis.vehicle_status <> 'active')
             -- padrão: ativas + as que tiveram leitura no período
             else bool_or(vis.vehicle_status = 'active') or bool_or(vis.has_reading)
           end
       and (f_rstat is null or bool_or(vis.status = any (f_rstat)))
  )
  select vis.vehicle_id, vis.day, vis.reading_id, vis.status, vis.has_reading, vis.counts,
         vis.odometer_start, vis.odometer_end, vis.km, vis.km_informed, vis.km_calculated, vis.alerts, vis.is_corrected,
         vis.context_source, vis.operation_id, vis.operation_city_id, vis.state_id, vis.city_id, vis.operation_br_id,
         vis.leader_employee_id, vis.organization_unit_id, vis.in_filter, vis.is_future
    from vis join elig on elig.vehicle_id = vis.vehicle_id;
end;
$$;

revoke all on function private.km_grid(uuid, date, date, jsonb) from public, anon;
grant execute on function private.km_grid(uuid, date, date, jsonb) to authenticated, service_role;

-- Situação dos veículos: último dia com leitura, dias sem leitura até ontem e
-- KM vigente (hodômetro final da última leitura confiável).
create or replace function private.km_vehicle_freshness(p_organization_id uuid, p_vehicle_ids uuid[])
returns table (vehicle_id uuid, last_reading_date date, last_odometer numeric, missing_days integer, bucket text)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (select private.maintenance_today(p_organization_id) as today),
  last as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.reading_date, r.odometer_end
      from public.km_daily_readings r
      join public.km_reading_statuses s on s.code = r.status and s.has_reading
     where r.organization_id = p_organization_id and r.vehicle_id = any (p_vehicle_ids)
       and r.reading_date <= (select today from t)
     order by r.vehicle_id, r.reading_date desc
  )
  select v.id, l.reading_date, l.odometer_end,
         case when l.reading_date is null then null else greatest(0, (t.today - 1) - l.reading_date) end,
         case when l.reading_date is null then 'never'
              when (t.today - 1) - l.reading_date <= 0 then 'updated'
              when (t.today - 1) - l.reading_date = 1 then 'd1'
              when (t.today - 1) - l.reading_date <= 3 then 'd2_3'
              when (t.today - 1) - l.reading_date <= 7 then 'd4_7'
              else 'd7_plus' end
    from unnest(p_vehicle_ids) as v(id)
    cross join t
    left join last l on l.vehicle_id = v.id;
$$;

revoke all on function private.km_vehicle_freshness(uuid, uuid[]) from public, anon;

-- Saúde do hodômetro de um veículo (SAUDÁVEL / ATENÇÃO / CRÍTICO / SEM DADOS),
-- a partir de atualização, regressões, divergências e cobertura.
create or replace function private.km_odometer_health(
  p_missing_days integer, p_regressions integer, p_divergences integer, p_coverage_pct numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_missing_days is null then 'no_data'
    when p_missing_days > 7 or coalesce(p_regressions, 0) >= 2 or coalesce(p_coverage_pct, 0) < 30 then 'critical'
    when p_missing_days >= 2 or coalesce(p_regressions, 0) = 1 or coalesce(p_divergences, 0) > 0
         or coalesce(p_coverage_pct, 0) < 70 then 'attention'
    else 'healthy' end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Rótulos (operação, local, BR, liderança) e veículo
-- -----------------------------------------------------------------------------
create or replace function private.km_vehicle_card(p_vehicle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vehicle_id', v.id, 'plate', v.license_plate, 'fleet_code', v.fleet_code, 'status', v.status,
    'vehicle_type_id', v.vehicle_type_id, 'type', t.name,
    'subcategory_id', v.vehicle_subcategory_id, 'subcategory', s.name,
    'model_id', v.vehicle_model_id, 'model', m.name)
    from public.vehicles v
    left join public.vehicle_types t on t.id = v.vehicle_type_id
    left join public.vehicle_subcategories s on s.id = v.vehicle_subcategory_id
    left join public.vehicle_models m on m.id = v.vehicle_model_id
   where v.id = p_vehicle_id;
$$;

revoke all on function private.km_vehicle_card(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Visão geral
-- -----------------------------------------------------------------------------
create or replace function public.km_overview(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from   date;
  v_to     date;
  v_today  date := private.maintenance_today(p_organization_id);
  v_set    public.km_settings := private.km_settings_of(p_organization_id);
  v_result jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.view_dashboard') then
    raise exception 'Você não possui permissão para a visão geral de KM.' using errcode = 'insufficient_privilege';
  end if;
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, p_filters) p;

  -- dia de referência: o último com KM validado no período (não um dia em que
  -- todos estejam sem leitura)
  with g0 as materialized (select * from private.km_grid(p_organization_id, v_from, v_to, p_filters)),
  refd as (select max(x.day) as d from g0 x where x.in_filter and x.counts),
  g as (select * from g0 where g0.in_filter),
  veh as (
    select g.vehicle_id,
           sum(g.km) filter (where g.counts) as km,
           count(*) filter (where g.has_reading) as reading_days,
           count(*) filter (where not g.is_future) as elapsed_days,
           bool_or(g.status = 'no_movement' and g.day = (select refd.d from refd)) as no_movement_ref,
           bool_or(g.has_reading and g.day = (select refd.d from refd)) as reading_ref
      from g group by g.vehicle_id
  ),
  vs as (select v.id, v.status from public.vehicles v where v.id in (select veh.vehicle_id from veh)),
  fr as (select * from private.km_vehicle_freshness(p_organization_id, array(select veh.vehicle_id from veh))),
  daily as (
    select g.day, sum(g.km) filter (where g.counts) as km,
           count(*) filter (where g.has_reading) as with_reading,
           count(*) filter (where g.counts and g.km > v_set.no_movement_tolerance_km) as moving,
           count(*) filter (where not g.has_reading and not g.is_future) as without_reading
      from g group by g.day
  ),
  vd as (select d.km from daily d where d.km is not null and d.with_reading > 0)
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today, 'reference_day', (select refd.d from refd),
                                'competence', to_char(v_from, 'YYYY-MM')),
    'kpis', jsonb_build_object(
      'vehicles', (select count(*) from veh),
      'active_vehicles', (select count(*) from vs where vs.status = 'active'),
      'vehicles_updated', (select count(*) from fr where fr.bucket = 'updated'),
      'coverage_ref_count', (select count(*) from veh where veh.reading_ref),
      'coverage_ref_total', (select count(*) from veh join vs on vs.id = veh.vehicle_id where vs.status = 'active'),
      'coverage_period_pct', (select round(100.0 * sum(veh.reading_days) / nullif(sum(veh.elapsed_days), 0), 1) from veh),
      'vehicles_without_reading_ref', (select count(*) from veh join vs on vs.id = veh.vehicle_id
                                         where vs.status = 'active' and not coalesce(veh.reading_ref, false)),
      'vehicles_stale', (select count(*) from fr where fr.bucket in ('d2_3', 'd4_7', 'd7_plus', 'never')),
      'km_total', (select round(coalesce(sum(veh.km), 0), 1) from veh),
      'km_ref_day', (select round(d.km, 1) from daily d where d.day = (select refd.d from refd)),
      'avg_daily_fleet', (select round(avg(vd.km), 1) from vd),
      'median_daily_fleet', (select round(percentile_cont(0.5) within group (order by vd.km)::numeric, 1) from vd),
      'avg_per_vehicle', (select round(avg(veh.km), 1) from veh where veh.km is not null),
      'median_per_vehicle', (select round(percentile_cont(0.5) within group (order by veh.km)::numeric, 1) from veh where veh.km is not null),
      'avg_daily_per_vehicle', (select round(sum(veh.km) / nullif(sum(veh.reading_days), 0), 1) from veh),
      'no_movement_ref', (select count(*) from veh where veh.no_movement_ref),
      'high_mileage_days', (select count(*) from g where g.status = 'high_mileage' or 'high_mileage' = any (g.alerts)),
      'high_mileage_vehicles', (select count(distinct g.vehicle_id) from g where g.status = 'high_mileage' or 'high_mileage' = any (g.alerts)),
      'inconsistencies', (select count(*) from g where g.status in ('inconsistent', 'pending_review', 'km_divergence')
                                                  or 'odometer_regression' = any (g.alerts)),
      'valid_days', (select count(*) from daily d where d.with_reading > 0),
      'last_update', (select max(r.ingested_at) from public.km_daily_readings r where r.organization_id = p_organization_id),
      'high_mileage_km', v_set.high_mileage_km,
      'min_coverage_pct', v_set.min_coverage_pct),
    'freshness', (select jsonb_build_object(
                    'updated', count(*) filter (where fr.bucket = 'updated'),
                    'd1', count(*) filter (where fr.bucket = 'd1'),
                    'd2_3', count(*) filter (where fr.bucket = 'd2_3'),
                    'd4_7', count(*) filter (where fr.bucket = 'd4_7'),
                    'd7_plus', count(*) filter (where fr.bucket = 'd7_plus'),
                    'never', count(*) filter (where fr.bucket = 'never'))
                    from fr),
    'missing_vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                            'vehicle_id', v.id, 'plate', v.license_plate, 'fleet_code', v.fleet_code,
                            'last_reading_date', fr.last_reading_date, 'missing_days', fr.missing_days, 'bucket', fr.bucket)
                            order by fr.missing_days desc nulls first, v.license_plate), '[]'::jsonb)
                           from fr join public.vehicles v on v.id = fr.vehicle_id
                           left join veh on veh.vehicle_id = fr.vehicle_id
                          where v.status = 'active' and not coalesce(veh.reading_ref, false)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'km', round(d.km, 1), 'with_reading', d.with_reading,
                                                            'moving', d.moving, 'without_reading', d.without_reading) order by d.day), '[]'::jsonb)
                from daily d),
    'by_operation', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc nulls last), '[]'::jsonb) from (
                       select jsonb_build_object('operation_id', g.operation_id,
                                'operation', coalesce((select o.name from public.operations o where o.id = g.operation_id), 'Sem operação'),
                                'km', round(coalesce(sum(g.km) filter (where g.counts), 0), 1),
                                'vehicles', count(distinct g.vehicle_id)) as j
                         from g group by g.operation_id) q),
    'by_type', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc nulls last), '[]'::jsonb) from (
                  select jsonb_build_object('vehicle_type_id', v.vehicle_type_id,
                           'type', coalesce((select t.name from public.vehicle_types t where t.id = v.vehicle_type_id), '—'),
                           'km', round(coalesce(sum(g.km) filter (where g.counts), 0), 1),
                           'vehicles', count(distinct g.vehicle_id)) as j
                    from g join public.vehicles v on v.id = g.vehicle_id group by v.vehicle_type_id) q),
    'by_status', (select coalesce(jsonb_object_agg(q.status, q.n), '{}'::jsonb)
                    from (select g.status, count(*) as n from g where not g.is_future group by g.status) q),
    'top_vehicles', (select coalesce(jsonb_agg(q.j order by q.km desc), '[]'::jsonb) from (
                       select private.km_vehicle_card(veh.vehicle_id) || jsonb_build_object('km', round(veh.km, 1),
                                'reading_days', veh.reading_days, 'avg_daily', round(veh.km / nullif(veh.reading_days, 0), 1)) as j, veh.km
                         from veh where veh.km is not null order by veh.km desc limit 10) q),
    'bottom_vehicles', (select coalesce(jsonb_agg(q.j order by q.km), '[]'::jsonb) from (
                          select private.km_vehicle_card(veh.vehicle_id) || jsonb_build_object('km', round(veh.km, 1),
                                   'reading_days', veh.reading_days, 'avg_daily', round(veh.km / nullif(veh.reading_days, 0), 1)) as j, veh.km
                            from veh
                           where veh.km is not null
                             and veh.reading_days >= greatest(1, ceil(veh.elapsed_days * v_set.min_coverage_pct / 100.0))
                           order by veh.km limit 10) q)
  ) into v_result;

  return v_result || jsonb_build_object('insights', private.km_insights(p_organization_id, v_result, v_set));
end;
$$;

revoke all on function public.km_overview(uuid, jsonb) from public, anon;
grant execute on function public.km_overview(uuid, jsonb) to authenticated, service_role;

-- Insights determinísticos da visão geral: só fatos calculados, sem texto genérico.
create or replace function private.km_insights(p_organization_id uuid, p_overview jsonb, p_set public.km_settings)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  k   jsonb := p_overview -> 'kpis';
  out jsonb := '[]'::jsonb;
  v_top jsonb;
  v_total numeric := nullif((k ->> 'km_total')::numeric, 0);
  fmt text;
begin
  if (k ->> 'coverage_ref_total')::integer > 0 and p_overview -> 'period' ->> 'reference_day' is not null then
    out := out || jsonb_build_object('tone', case when (k ->> 'coverage_ref_count')::numeric / (k ->> 'coverage_ref_total')::numeric >= 0.9
                                                  then 'success' else 'warning' end,
      'text', format('%s de %s frotas ativas têm leitura válida em %s (%s%%).',
                     k ->> 'coverage_ref_count', k ->> 'coverage_ref_total',
                     to_char((p_overview -> 'period' ->> 'reference_day')::date, 'DD/MM/YYYY'),
                     replace(round(100.0 * (k ->> 'coverage_ref_count')::numeric / (k ->> 'coverage_ref_total')::numeric, 1)::text, '.', ',')));
  end if;
  if ((p_overview -> 'freshness' ->> 'd4_7')::integer + (p_overview -> 'freshness' ->> 'd7_plus')::integer) > 0 then
    out := out || jsonb_build_object('tone', 'warning',
      'text', format('%s veículos estão há mais de 3 dias sem leitura.',
                     (p_overview -> 'freshness' ->> 'd4_7')::integer + (p_overview -> 'freshness' ->> 'd7_plus')::integer));
  end if;
  select q into v_top from jsonb_array_elements(p_overview -> 'by_operation') q
   order by (q ->> 'km')::numeric desc nulls last limit 1;
  if v_top is not null and v_total is not null and jsonb_array_length(p_overview -> 'by_operation') > 1 then
    out := out || jsonb_build_object('tone', 'info',
      'text', format('%s concentra %s%% do KM do período.', v_top ->> 'operation',
                     replace(round(100 * (v_top ->> 'km')::numeric / v_total, 1)::text, '.', ',')));
  end if;
  if (k ->> 'high_mileage_days')::integer > 0 then
    out := out || jsonb_build_object('tone', 'warning',
      'text', format('%s dias de alta rodagem (acima de %s km) em %s veículos.',
                     k ->> 'high_mileage_days', round(p_set.high_mileage_km), k ->> 'high_mileage_vehicles'));
  end if;
  if (k ->> 'avg_per_vehicle') is not null and (k ->> 'median_per_vehicle')::numeric > 0 then
    out := out || jsonb_build_object('tone', 'info',
      'text', format('KM por veículo no período: média %s km e mediana %s km (a média fica %s%% %s da mediana).',
                     replace(to_char((k ->> 'avg_per_vehicle')::numeric, 'FM999G999G990'), ',', '.'),
                     replace(to_char((k ->> 'median_per_vehicle')::numeric, 'FM999G999G990'), ',', '.'),
                     replace(abs(round(100 * ((k ->> 'avg_per_vehicle')::numeric / (k ->> 'median_per_vehicle')::numeric - 1), 1))::text, '.', ','),
                     case when (k ->> 'avg_per_vehicle')::numeric >= (k ->> 'median_per_vehicle')::numeric then 'acima' else 'abaixo' end));
  end if;
  if (k ->> 'inconsistencies')::integer > 0 then
    out := out || jsonb_build_object('tone', 'danger',
      'text', format('%s leituras com inconsistência, divergência ou hodômetro regressivo aguardam análise em Qualidade de dados.',
                     k ->> 'inconsistencies'));
  end if;
  return out;
end;
$$;

revoke all on function private.km_insights(uuid, jsonb, public.km_settings) from public, anon;

-- -----------------------------------------------------------------------------
-- 5. Planner mês/dia (também a base do Controle Mensal exportado)
-- -----------------------------------------------------------------------------
create or replace function public.km_planner(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to   date;
  v_result jsonb;
begin
  if not (private.has_permission(p_organization_id, 'km.view_planner') or private.has_permission(p_organization_id, 'km.export')) then
    raise exception 'Você não possui permissão para o planner de KM.' using errcode = 'insufficient_privilege';
  end if;
  select p.date_from, p.date_to into v_from, v_to
    from private.km_period(p_organization_id, p_filters - 'date_from' - 'date_to') p;

  with g as materialized (
    select x.*, v.vehicle_type_id, v.license_plate
      from private.km_grid(p_organization_id, v_from, v_to, p_filters) x
      join public.vehicles v on v.id = x.vehicle_id
  ),
  days as (select d::date as day from generate_series(v_from, v_to, interval '1 day') d),
  type_day as (
    select g.vehicle_type_id, g.day, sum(g.km) filter (where g.counts) as km
      from g where g.in_filter group by g.vehicle_type_id, g.day
  ),
  local_day as (
    select g.city_id, g.day, sum(g.km) filter (where g.counts) as km
      from g where g.in_filter group by g.city_id, g.day
  ),
  ctx as (
    select g.vehicle_id,
           array_agg(distinct b.code) filter (where b.code is not null) as brs,
           array_agg(distinct coalesce(c.name, o.name)) filter (where coalesce(c.name, o.name) is not null) as locals,
           array_agg(distinct o.name) filter (where o.name is not null) as operations,
           array_agg(distinct e.full_name) filter (where e.full_name is not null) as leaders,
           (array_agg(b.code order by g.day desc) filter (where b.code is not null))[1] as br_last,
           (array_agg(coalesce(c.name, o.name) order by g.day desc) filter (where coalesce(c.name, o.name) is not null))[1] as local_last,
           (array_agg(o.name order by g.day desc) filter (where o.name is not null))[1] as operation_last,
           (array_agg(e.full_name order by g.day desc) filter (where e.full_name is not null))[1] as leader_last
      from g
      left join public.operation_brs b on b.id = g.operation_br_id
      left join public.cities c on c.id = g.city_id
      left join public.operations o on o.id = g.operation_id
      left join public.employees e on e.id = g.leader_employee_id
     where g.in_filter
     group by g.vehicle_id
  ),
  rows as (
    select g.vehicle_id, min(g.license_plate) as license_plate,
           sum(g.km) filter (where g.counts and g.in_filter) as total_km,
           count(*) filter (where g.has_reading and g.in_filter) as reading_days,
           jsonb_agg(jsonb_build_array(
             case when g.is_future then 'future' when not g.in_filter then 'out_of_filter' else g.status end,
             g.odometer_start, g.odometer_end, g.km) order by g.day) as cells
      from g group by g.vehicle_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'competence', to_char(v_from, 'YYYY-MM'),
                                 'today', private.maintenance_today(p_organization_id)),
    'days', (select jsonb_agg(jsonb_build_object('date', d.day, 'dow', extract(isodow from d.day)::int) order by d.day)
               from days d),
    'rows', (select coalesce(jsonb_agg(private.km_vehicle_card(r.vehicle_id) || jsonb_build_object(
                     'br', c.br_last, 'brs', coalesce(to_jsonb(c.brs), '[]'), 'local', c.local_last,
                     'locals', coalesce(to_jsonb(c.locals), '[]'), 'operation', c.operation_last,
                     'leader', c.leader_last, 'multi_br', coalesce(cardinality(c.brs), 0) > 1,
                     'total_km', round(r.total_km, 1), 'reading_days', r.reading_days, 'cells', r.cells)
                   order by c.local_last nulls last, c.br_last nulls last, r.license_plate), '[]'::jsonb)
               from rows r left join ctx c on c.vehicle_id = r.vehicle_id),
    'day_totals', (select jsonb_agg(q.km order by q.day) from (
                     select g.day, round(coalesce(sum(g.km) filter (where g.counts and g.in_filter), 0), 1) as km
                       from g group by g.day) q),
    'day_readings', (select jsonb_agg(q.n order by q.day) from (
                       select g.day, count(*) filter (where g.has_reading and g.in_filter) as n from g group by g.day) q),
    'by_type', (select coalesce(jsonb_agg(q.j order by q.j ->> 'type'), '[]'::jsonb) from (
                  select jsonb_build_object('type', coalesce(t.name, '—'), 'vehicle_type_id', tg.vehicle_type_id,
                           'km', round(coalesce(tg.km, 0), 1),
                           'vehicles', tg.vehicles,
                           'days', (select jsonb_agg(round(coalesce(td.km, 0), 1) order by d.day)
                                      from days d
                                      left join type_day td on td.day = d.day
                                       and td.vehicle_type_id is not distinct from tg.vehicle_type_id)) as j
                    from (select g.vehicle_type_id, sum(g.km) filter (where g.counts) as km,
                                 count(distinct g.vehicle_id) as vehicles
                            from g where g.in_filter group by g.vehicle_type_id) tg
                    left join public.vehicle_types t on t.id = tg.vehicle_type_id) q),
    'by_local', (select coalesce(jsonb_agg(q.j order by q.j ->> 'local'), '[]'::jsonb) from (
                   select jsonb_build_object('local', coalesce(c.name, 'Sem local'), 'city_id', lg.city_id,
                            'km', round(coalesce(lg.km, 0), 1),
                            'vehicles', lg.vehicles,
                            'days', (select jsonb_agg(round(coalesce(ld.km, 0), 1) order by d.day)
                                       from days d
                                       left join local_day ld on ld.day = d.day
                                        and ld.city_id is not distinct from lg.city_id)) as j
                     from (select g.city_id, sum(g.km) filter (where g.counts) as km,
                                  count(distinct g.vehicle_id) as vehicles
                             from g where g.in_filter group by g.city_id) lg
                     left join public.cities c on c.id = lg.city_id) q),
    'totals', (select jsonb_build_object(
                 'km', round(coalesce(sum(g.km) filter (where g.counts and g.in_filter), 0), 1),
                 'vehicles', count(distinct g.vehicle_id),
                 'vehicles_with_reading', count(distinct g.vehicle_id) filter (where g.has_reading and g.in_filter),
                 'reading_days', count(*) filter (where g.has_reading and g.in_filter),
                 'elapsed_vehicle_days', count(*) filter (where not g.is_future and g.in_filter),
                 'days_with_km', count(distinct g.day) filter (where g.counts and g.in_filter))
                 from g),
    'generated_at', now()
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.km_planner(uuid, jsonb) from public, anon;
grant execute on function public.km_planner(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Visão diária
-- -----------------------------------------------------------------------------
create or replace function public.km_daily(p_organization_id uuid, p_date date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day   date := coalesce(p_date, private.km_last_valid_day(p_organization_id), private.maintenance_today(p_organization_id));
  v_month_avg numeric;
  v_result jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.view_daily') then
    raise exception 'Você não possui permissão para a visão diária de KM.' using errcode = 'insufficient_privilege';
  end if;

  -- média diária do mês até o dia (para comparar o dia)
  select avg(q.km) into v_month_avg from (
    select g.day, sum(g.km) filter (where g.counts) as km
      from private.km_grid(p_organization_id, date_trunc('month', v_day)::date, v_day, p_filters) g
     where g.in_filter group by g.day having count(*) filter (where g.has_reading) > 0) q;

  with g as (
    select g.*, private.km_vehicle_card(g.vehicle_id) as card,
           (select b.code from public.operation_brs b where b.id = g.operation_br_id) as br,
           (select c.name from public.cities c where c.id = g.city_id) as local,
           (select o.name from public.operations o where o.id = g.operation_id) as operation,
           (select e.full_name from public.employees e where e.id = g.leader_employee_id) as leader
      from private.km_grid(p_organization_id, v_day, v_day, p_filters) g
     where g.in_filter
  )
  select jsonb_build_object(
    'date', v_day,
    'today', private.maintenance_today(p_organization_id),
    'kpis', jsonb_build_object(
      -- sem nenhuma leitura válida no dia, o KM do dia é desconhecido (nulo), não 0
      'km_total', round(sum(g.km) filter (where g.counts), 1),
      'vehicles', count(*),
      'vehicles_used', count(*) filter (where g.counts and g.status <> 'no_movement'),
      'no_movement', count(*) filter (where g.status = 'no_movement'),
      'no_reading', count(*) filter (where not g.has_reading and g.status <> 'inconsistent'),
      -- mesmo critério da lista de inconsistências abaixo (paridade KPI × lista)
      'inconsistencies', count(*) filter (where g.status in ('inconsistent', 'km_divergence', 'pending_review', 'high_mileage')
                                             or g.alerts && array['odometer_regression', 'odometer_jump', 'registry_divergence']),
      'high_mileage', count(*) filter (where g.status = 'high_mileage'),
      'avg_per_vehicle', round(avg(g.km) filter (where g.counts and g.status <> 'no_movement'), 1),
      'median_per_vehicle', round((percentile_cont(0.5) within group (order by g.km) filter (where g.counts and g.status <> 'no_movement'))::numeric, 1),
      'month_daily_avg', round(v_month_avg, 1),
      'diff_vs_month_avg_pct', case when v_month_avg > 0
                                   then round(100 * (coalesce(sum(g.km) filter (where g.counts), 0) / v_month_avg - 1), 1) end),
    -- ranking só com leitura válida (Sem leitura nunca é "menor rodagem")
    'ranking', (select coalesce(jsonb_agg(g2.card || jsonb_build_object('km', round(g2.km, 1), 'status', g2.status,
                                  'br', g2.br, 'local', g2.local, 'operation', g2.operation, 'leader', g2.leader,
                                  'odometer_start', g2.odometer_start, 'odometer_end', g2.odometer_end) order by g2.km desc), '[]'::jsonb)
                  from g g2 where g2.counts),
    -- distribuição por faixa de KM no dia (só quem tem KM validado)
    'bands', (select coalesce(jsonb_agg(jsonb_build_object('band', q.band, 'label', q.label, 'vehicles', q.n) order by q.ord), '[]'::jsonb)
                from (select b.ord, b.band, b.label,
                             (select count(*) from g g2 where g2.counts
                                and g2.km >= b.lo and (b.hi is null or g2.km < b.hi)
                                and (b.band <> 'b0' or g2.status = 'no_movement')
                                and (b.band = 'b0' or g2.status <> 'no_movement')) as n
                        from (values (1, 'b0', 'Sem movimento', 0::numeric, null::numeric),
                                     (2, 'b1', 'Até 50 km', 0, 50), (3, 'b2', '50–100 km', 50, 100),
                                     (4, 'b3', '100–200 km', 100, 200), (5, 'b4', '200–400 km', 200, 400),
                                     (6, 'b5', '400 km ou mais', 400, null)) b(ord, band, label, lo, hi)) q),
    'without_reading', (select coalesce(jsonb_agg(g2.card || jsonb_build_object('status', g2.status, 'br', g2.br, 'local', g2.local)
                                         order by g2.card ->> 'plate'), '[]'::jsonb)
                          from g g2 where not g2.has_reading and g2.status <> 'inconsistent'),
    'by_operation', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc), '[]'::jsonb) from (
                       select jsonb_build_object('label', coalesce(g2.operation, 'Sem operação'),
                                'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1), 'vehicles', count(*),
                                'with_reading', count(*) filter (where g2.has_reading)) as j
                         from g g2 group by g2.operation) q),
    'by_local', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc), '[]'::jsonb) from (
                   select jsonb_build_object('label', coalesce(g2.local, 'Sem local'),
                            'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1), 'vehicles', count(*),
                            'with_reading', count(*) filter (where g2.has_reading)) as j
                     from g g2 group by g2.local) q),
    'by_br', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc), '[]'::jsonb) from (
                select jsonb_build_object('label', coalesce(g2.br, 'Sem BR'),
                         'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1), 'vehicles', count(*),
                         'with_reading', count(*) filter (where g2.has_reading)) as j
                  from g g2 group by g2.br) q),
    'by_leader', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc), '[]'::jsonb) from (
                    select jsonb_build_object('label', coalesce(g2.leader, 'Sem liderança'),
                             'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1), 'vehicles', count(*),
                             'with_reading', count(*) filter (where g2.has_reading)) as j
                      from g g2 group by g2.leader) q),
    'by_type', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc), '[]'::jsonb) from (
                  select jsonb_build_object('label', coalesce(g2.card ->> 'type', '—'),
                           'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1), 'vehicles', count(*),
                           'with_reading', count(*) filter (where g2.has_reading)) as j
                    from g g2 group by g2.card ->> 'type') q),
    'inconsistencies', (select coalesce(jsonb_agg(g2.card || jsonb_build_object(
                           'reading_id', g2.reading_id, 'status', g2.status, 'alerts', to_jsonb(g2.alerts),
                           'odometer_start', g2.odometer_start, 'odometer_end', g2.odometer_end,
                           'km_informed', g2.km_informed, 'km_calculated', g2.km_calculated,
                           'diff', case when g2.km_informed is not null and g2.km_calculated is not null
                                        then round(g2.km_informed - g2.km_calculated, 2) end,
                           'br', g2.br, 'local', g2.local) order by g2.card ->> 'plate'), '[]'::jsonb)
                          from g g2
                         where g2.status in ('inconsistent', 'km_divergence', 'pending_review', 'high_mileage')
                            or g2.alerts && array['odometer_regression', 'odometer_jump', 'registry_divergence'])
  ) into v_result
  from g;
  return v_result;
end;
$$;

revoke all on function public.km_daily(uuid, date, jsonb) from public, anon;
grant execute on function public.km_daily(uuid, date, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Histórico por frota
-- -----------------------------------------------------------------------------
create or replace function public.km_vehicle_history(p_vehicle_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_today date;
  v_from  date;
  v_to    date;
  v_set   public.km_settings;
  v_rate  numeric;
  v_cov   numeric;
  v_cur   numeric;
  v_result jsonb;
begin
  select v.organization_id into v_org from public.vehicles v where v.id = p_vehicle_id and v.deleted_at is null;
  if v_org is null or not private.has_permission(v_org, 'km.view_history') then
    raise exception 'Você não possui permissão para o histórico de KM deste veículo.' using errcode = 'insufficient_privilege';
  end if;
  -- escopo: o veículo precisa estar no escopo da pessoa (ou um dia dele estar)
  if not (private.vehicle_in_scope(v_org, p_vehicle_id)
          or exists (select 1 from public.km_daily_readings r
                      where r.vehicle_id = p_vehicle_id and r.operation_id in (select private.accessible_operation_ids()))) then
    raise exception 'Veículo fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  v_today := private.maintenance_today(v_org);
  v_set := private.km_settings_of(v_org);
  v_to := coalesce(p_to, least(v_today, coalesce((select max(r.reading_date) from public.km_daily_readings r where r.vehicle_id = p_vehicle_id), v_today)));
  v_from := coalesce(p_from, (date_trunc('month', v_to) - interval '5 months')::date);
  if v_to - v_from > 400 then v_from := v_to - 400; end if;

  -- ritmo recente: mediana do KM/dia dos dias com leitura nos últimos 30 dias
  select percentile_cont(0.5) within group (order by r.distance_validated),
         count(*) filter (where r.distance_validated is not null) * 100.0 / 30
    into v_rate, v_cov
    from public.km_daily_readings r
   where r.vehicle_id = p_vehicle_id and r.reading_date between v_to - 29 and v_to and r.distance_validated is not null;
  select f.last_odometer into v_cur from private.km_vehicle_freshness(v_org, array[p_vehicle_id]) f;

  with g as (select * from private.km_grid(v_org, v_from, v_to, jsonb_build_object('vehicle_ids', jsonb_build_array(p_vehicle_id), 'fleet_status', 'all'))),
  fr as (select * from private.km_vehicle_freshness(v_org, array[p_vehicle_id]))
  select jsonb_build_object(
    'vehicle', private.km_vehicle_card(p_vehicle_id),
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'kpis', jsonb_build_object(
      'current_km', v_cur,
      'last_reading_date', (select fr.last_reading_date from fr),
      'missing_days', (select fr.missing_days from fr),
      'freshness', (select fr.bucket from fr),
      'reading_days', count(*) filter (where g.has_reading),
      'no_reading_days', count(*) filter (where not g.has_reading and not g.is_future),
      'no_movement_days', count(*) filter (where g.status = 'no_movement'),
      'km_period', round(coalesce(sum(g.km) filter (where g.counts), 0), 1),
      'avg_daily', round(avg(g.km) filter (where g.counts), 1),
      'median_daily', round((percentile_cont(0.5) within group (order by g.km) filter (where g.counts))::numeric, 1),
      'max_daily', max(g.km) filter (where g.counts),
      'regressions', count(*) filter (where 'odometer_regression' = any (g.alerts)),
      'jumps', count(*) filter (where 'odometer_jump' = any (g.alerts)),
      'divergences', count(*) filter (where g.status = 'km_divergence'),
      'coverage_pct', round(100.0 * count(*) filter (where g.has_reading) / nullif(count(*) filter (where not g.is_future), 0), 1),
      'health', private.km_odometer_health((select fr.missing_days from fr),
                                           (count(*) filter (where 'odometer_regression' = any (g.alerts)))::integer,
                                           (count(*) filter (where g.status = 'km_divergence'))::integer,
                                           round(100.0 * count(*) filter (where g.has_reading) / nullif(count(*) filter (where not g.is_future), 0), 1))),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', g2.day, 'status', case when g2.is_future then 'future' else g2.status end,
                'odometer_start', g2.odometer_start, 'odometer_end', g2.odometer_end, 'km', g2.km,
                'km_informed', g2.km_informed, 'alerts', to_jsonb(g2.alerts), 'reading_id', g2.reading_id,
                'corrected', g2.is_corrected,
                'br', (select b.code from public.operation_brs b where b.id = g2.operation_br_id),
                'local', (select c.name from public.cities c where c.id = g2.city_id)) order by g2.day), '[]'::jsonb)
                from g g2),
    'monthly', (select coalesce(jsonb_agg(q.j order by q.j ->> 'month'), '[]'::jsonb) from (
                  select jsonb_build_object('month', to_char(date_trunc('month', g2.day), 'YYYY-MM'),
                           'km', round(coalesce(sum(g2.km) filter (where g2.counts), 0), 1),
                           'reading_days', count(*) filter (where g2.has_reading),
                           'no_reading_days', count(*) filter (where not g2.has_reading and not g2.is_future),
                           'no_movement_days', count(*) filter (where g2.status = 'no_movement'),
                           'avg_daily', round(avg(g2.km) filter (where g2.counts), 1),
                           'median_daily', round((percentile_cont(0.5) within group (order by g2.km) filter (where g2.counts))::numeric, 1)) as j
                    from g g2 group by date_trunc('month', g2.day)) q),
    'projection', jsonb_build_object(
      'rate_km_day', round(v_rate, 1), 'coverage_30d_pct', round(v_cov, 1),
      'confidence', case when v_rate is null then 'none' when v_cov >= 70 then 'high' when v_cov >= 40 then 'medium' else 'low' end,
      'horizons', (select jsonb_agg(jsonb_build_object('days', h, 'km', round(v_rate * h), 'odometer', round(v_cur + v_rate * h)))
                     from unnest(array[30, 60, 90]) h where v_rate is not null and v_cur is not null)),
    'preventive', (select jsonb_build_object('cycle_number', c.cycle_number, 'milestone_km', c.milestone_km,
                     'km_remaining', round(c.milestone_km - v_cur),
                     'days_estimate', case when v_rate > 0 and c.milestone_km > v_cur then ceil((c.milestone_km - v_cur) / v_rate) end,
                     'date_estimate', case when v_rate > 0 and c.milestone_km > v_cur then v_to + ceil((c.milestone_km - v_cur) / v_rate)::integer end,
                     'overdue', c.milestone_km <= v_cur)
                     from public.maintenance_preventive_cycles c
                    where c.vehicle_id = p_vehicle_id and c.completed_on is null
                    order by c.cycle_number limit 1),
    'audit', case when private.has_permission(v_org, 'km.view_audit') then (
               select coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'day', a.reading_date, 'action', a.action,
                        'changes', a.changes, 'reason', a.reason, 'actor', a.actor_name) order by a.occurred_at desc), '[]'::jsonb)
                 from (select * from public.km_reading_audit a where a.vehicle_id = p_vehicle_id
                        order by a.occurred_at desc limit 100) a) end,
    'can_correct', private.has_permission(v_org, 'km.correct')
  ) into v_result
  from g;
  return v_result;
end;
$$;

revoke all on function public.km_vehicle_history(uuid, date, date) from public, anon;
grant execute on function public.km_vehicle_history(uuid, date, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Análise gerencial: operação, local, coortes, dispersão, quadrantes,
--    projeções e preventiva
-- -----------------------------------------------------------------------------
-- Métricas por veículo no período (base da dispersão, das projeções e do
-- rodízio). Intensidade = KM/dia nos dias com leitura; estatística só com
-- cobertura mínima.
create or replace function private.km_vehicle_metrics(p_organization_id uuid, p_from date, p_to date, p_filters jsonb)
returns table (
  vehicle_id uuid, vehicle_type_id uuid, vehicle_subcategory_id uuid, vehicle_model_id uuid,
  km_period numeric, reading_days integer, elapsed_days integer, coverage_pct numeric,
  daily_avg numeric, daily_median numeric, odometer numeric, last_reading_date date,
  operation_id uuid, operation_br_id uuid, city_id integer, state_id smallint, leader_employee_id uuid, eligible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (select * from private.km_grid(p_organization_id, p_from, p_to, p_filters) where in_filter),
  last_ctx as (
    select distinct on (g.vehicle_id) g.vehicle_id, g.operation_id, g.operation_br_id, g.city_id, g.state_id, g.leader_employee_id
      from g where g.operation_id is not null or g.operation_br_id is not null
     order by g.vehicle_id, g.day desc
  ),
  agg as (
    select g.vehicle_id,
           sum(g.km) filter (where g.counts) as km_period,
           (count(*) filter (where g.has_reading))::integer as reading_days,
           (count(*) filter (where not g.is_future))::integer as elapsed_days,
           avg(g.km) filter (where g.counts) as daily_avg,
           percentile_cont(0.5) within group (order by g.km) filter (where g.counts) as daily_median
      from g group by g.vehicle_id
  ),
  odo as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_end, r.reading_date
      from public.km_daily_readings r
      join public.km_reading_statuses s on s.code = r.status and s.has_reading
     where r.organization_id = p_organization_id and r.vehicle_id in (select agg.vehicle_id from agg)
       and r.reading_date <= p_to and r.odometer_end is not null
     order by r.vehicle_id, r.reading_date desc
  )
  select a.vehicle_id, v.vehicle_type_id, v.vehicle_subcategory_id, v.vehicle_model_id,
         round(a.km_period, 1), a.reading_days, a.elapsed_days,
         round(100.0 * a.reading_days / nullif(a.elapsed_days, 0), 1),
         round(a.daily_avg, 1), round(a.daily_median::numeric, 1), o.odometer_end, o.reading_date,
         lc.operation_id, lc.operation_br_id, lc.city_id, lc.state_id, lc.leader_employee_id,
         a.reading_days > 0 and 100.0 * a.reading_days / nullif(a.elapsed_days, 0)
           >= (select s.min_coverage_pct from private.km_settings_of(p_organization_id) s)
    from agg a
    join public.vehicles v on v.id = a.vehicle_id
    left join odo o on o.vehicle_id = a.vehicle_id
    left join last_ctx lc on lc.vehicle_id = a.vehicle_id;
$$;

revoke all on function private.km_vehicle_metrics(uuid, date, date, jsonb) from public, anon;

-- Coorte técnica com níveis: N1 tipo+subcategoria+modelo; com poucos veículos,
-- N2 tipo+subcategoria; depois N3 tipo. Nunca compara tipos diferentes.
create or replace function private.km_cohorts(p_organization_id uuid, p_from date, p_to date, p_filters jsonb)
returns table (
  vehicle_id uuid, cohort_key text, cohort_level text, cohort_label text, km_period numeric, reading_days integer,
  coverage_pct numeric, daily_avg numeric, daily_median numeric, odometer numeric, last_reading_date date,
  operation_id uuid, operation_br_id uuid, city_id integer, state_id smallint, leader_employee_id uuid, eligible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (select * from private.km_vehicle_metrics(p_organization_id, p_from, p_to, p_filters)),
  st as (select s.min_cohort_size from private.km_settings_of(p_organization_id) s),
  n1 as (select m.vehicle_type_id, m.vehicle_subcategory_id, m.vehicle_model_id, count(*) filter (where m.eligible) as n
           from m group by 1, 2, 3),
  n2 as (select m.vehicle_type_id, m.vehicle_subcategory_id, count(*) filter (where m.eligible) as n from m group by 1, 2)
  select m.vehicle_id,
         case when n1.n >= st.min_cohort_size then concat_ws(':', m.vehicle_type_id, m.vehicle_subcategory_id, m.vehicle_model_id)
              when n2.n >= st.min_cohort_size then concat_ws(':', m.vehicle_type_id, m.vehicle_subcategory_id)
              else coalesce(m.vehicle_type_id::text, 'sem-tipo') end,
         case when n1.n >= st.min_cohort_size then 'N1' when n2.n >= st.min_cohort_size then 'N2' else 'N3' end,
         case when n1.n >= st.min_cohort_size
              then concat_ws(' · ', t.name, s.name, md.name)
              when n2.n >= st.min_cohort_size then concat_ws(' · ', t.name, s.name)
              else coalesce(t.name, 'Sem tipo') end,
         m.km_period, m.reading_days, m.coverage_pct, m.daily_avg, m.daily_median, m.odometer, m.last_reading_date,
         m.operation_id, m.operation_br_id, m.city_id, m.state_id, m.leader_employee_id, m.eligible
    from m
    cross join st
    left join n1 on n1.vehicle_type_id is not distinct from m.vehicle_type_id
                and n1.vehicle_subcategory_id is not distinct from m.vehicle_subcategory_id
                and n1.vehicle_model_id is not distinct from m.vehicle_model_id
    left join n2 on n2.vehicle_type_id is not distinct from m.vehicle_type_id
                and n2.vehicle_subcategory_id is not distinct from m.vehicle_subcategory_id
    left join public.vehicle_types t on t.id = m.vehicle_type_id
    left join public.vehicle_subcategories s on s.id = m.vehicle_subcategory_id
    left join public.vehicle_models md on md.id = m.vehicle_model_id;
$$;

revoke all on function private.km_cohorts(uuid, date, date, jsonb) from public, anon;

-- Dispersão por coorte: estatísticas, posição de cada veículo, faixa, outlier
-- e quadrante (hodômetro acumulado × intensidade de rodagem).
create or replace function private.km_dispersion(p_organization_id uuid, p_from date, p_to date, p_filters jsonb)
returns table (
  vehicle_id uuid, cohort_key text, cohort_level text, cohort_label text, eligible boolean,
  km_period numeric, reading_days integer, coverage_pct numeric, daily_avg numeric, odometer numeric,
  operation_id uuid, operation_br_id uuid, city_id integer, leader_employee_id uuid,
  cohort_size integer, cohort_daily_median numeric, cohort_daily_mean numeric, cohort_odometer_median numeric,
  daily_percentile numeric, odometer_percentile numeric, robust_z numeric, band text,
  outlier text, quadrant text, deviation_from_median_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from private.km_cohorts(p_organization_id, p_from, p_to, p_filters)),
  st as (select s.outlier_iqr_factor, s.min_cohort_size from private.km_settings_of(p_organization_id) s),
  cs as (
    select c.cohort_key,
           count(*) filter (where c.eligible) as n,
           percentile_cont(0.5) within group (order by c.daily_avg) filter (where c.eligible) as med,
           avg(c.daily_avg) filter (where c.eligible) as mean,
           percentile_cont(0.25) within group (order by c.daily_avg) filter (where c.eligible) as q1,
           percentile_cont(0.75) within group (order by c.daily_avg) filter (where c.eligible) as q3,
           percentile_cont(0.5) within group (order by c.odometer) filter (where c.eligible and c.odometer is not null) as odo_med,
           percentile_cont(0.75) within group (order by c.odometer) filter (where c.eligible and c.odometer is not null) as odo_q3,
           percentile_cont(0.25) within group (order by c.odometer) filter (where c.eligible and c.odometer is not null) as odo_q1
      from c group by c.cohort_key
  ),
  mad as (
    select c.cohort_key, percentile_cont(0.5) within group (order by abs(c.daily_avg - cs.med)) as mad
      from c join cs on cs.cohort_key = c.cohort_key where c.eligible group by c.cohort_key
  ),
  rk as (
    select c.vehicle_id,
           case when c.eligible then percent_rank() over (partition by c.cohort_key, c.eligible order by c.daily_avg) end as p_daily,
           case when c.eligible and c.odometer is not null
                then percent_rank() over (partition by c.cohort_key, c.eligible, (c.odometer is not null) order by c.odometer) end as p_odo
      from c
  ),
  z as (
    select c.*, cs.n, cs.med, cs.mean, cs.q1, cs.q3, cs.odo_med, cs.odo_q1, cs.odo_q3, mad.mad, rk.p_daily, rk.p_odo,
           case when c.eligible and mad.mad > 0 then 0.6745 * (c.daily_avg - cs.med) / mad.mad end as rz
      from c
      join cs on cs.cohort_key = c.cohort_key
      left join mad on mad.cohort_key = c.cohort_key
      left join rk on rk.vehicle_id = c.vehicle_id
  )
  select z.vehicle_id, z.cohort_key, z.cohort_level, z.cohort_label, z.eligible,
         z.km_period, z.reading_days, z.coverage_pct, z.daily_avg, z.odometer,
         z.operation_id, z.operation_br_id, z.city_id, z.leader_employee_id,
         z.n::integer, round(z.med::numeric, 1), round(z.mean, 1), round(z.odo_med::numeric),
         round(100 * z.p_daily::numeric, 0), round(100 * z.p_odo::numeric, 0), round(z.rz::numeric, 2),
         case when not z.eligible then 'insufficient_coverage'
              when z.n < st.min_cohort_size then 'small_cohort'
              when z.rz is null then 'within'
              when z.rz <= -2 then 'far_below' when z.rz <= -1 then 'below'
              when z.rz >= 2 then 'far_above' when z.rz >= 1 then 'above'
              else 'within' end,
         case when not z.eligible then 'low_coverage'
              when z.n >= st.min_cohort_size and z.daily_avg > z.q3 + st.outlier_iqr_factor * (z.q3 - z.q1) then 'above_cohort'
              when z.n >= st.min_cohort_size and z.daily_avg < z.q1 - st.outlier_iqr_factor * (z.q3 - z.q1) then 'below_cohort'
              when z.n >= st.min_cohort_size and z.odometer > z.odo_q3 + st.outlier_iqr_factor * (z.odo_q3 - z.odo_q1) then 'high_odometer'
              when z.n >= st.min_cohort_size and z.p_daily <= 0.1 and z.daily_avg < z.med * 0.5 then 'underused'
              end,
         case when not z.eligible or z.odometer is null or z.n < st.min_cohort_size then null
              when z.odometer >= z.odo_med and z.daily_avg >= z.med then 'high_km_high_use'
              when z.odometer >= z.odo_med then 'high_km_low_use'
              when z.daily_avg >= z.med then 'low_km_high_use'
              else 'low_km_low_use' end,
         case when z.med > 0 and z.eligible then round(100 * (z.daily_avg / z.med::numeric - 1), 1) end
    from z cross join st;
$$;

revoke all on function private.km_dispersion(uuid, date, date, jsonb) from public, anon;

create or replace function public.km_analysis(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to   date;
  v_prev_from date;
  v_prev_to   date;
  v_result jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.view_analysis') then
    raise exception 'Você não possui permissão para a análise gerencial de KM.' using errcode = 'insufficient_privilege';
  end if;
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, p_filters) p;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - (v_to - v_from);

  with g as (select * from private.km_grid(p_organization_id, v_from, v_to, p_filters) where in_filter),
  d as (select * from private.km_dispersion(p_organization_id, v_from, v_to, p_filters)),
  dprev as (select * from private.km_dispersion(p_organization_id, v_prev_from, v_prev_to, p_filters)),
  tot as (select sum(g.km) filter (where g.counts) as km, count(distinct g.vehicle_id) as vehicles,
                 count(distinct g.day) filter (where g.counts) as days from g),
  pv as (select g.vehicle_id, g.operation_id, sum(g.km) filter (where g.counts) as km,
                count(*) filter (where g.has_reading) as rd, count(*) filter (where not g.is_future) as ed
           from g group by g.vehicle_id, g.operation_id),
  overall as (select avg(pv.km) as mean_vehicle from pv where pv.km is not null)
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'previous_from', v_prev_from, 'previous_to', v_prev_to),
    'totals', (select jsonb_build_object('km', round(coalesce(tot.km, 0), 1), 'vehicles', tot.vehicles, 'days', tot.days) from tot),
    'by_operation', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'km')::numeric desc nulls last), '[]'::jsonb) from (
       select jsonb_build_object(
                'operation_id', pv.operation_id,
                'operation', coalesce((select o.name from public.operations o where o.id = pv.operation_id), 'Sem operação'),
                'km', round(coalesce(sum(pv.km), 0), 1),
                'vehicles', count(distinct pv.vehicle_id),
                'avg_per_vehicle', round(avg(pv.km), 1),
                'median_per_vehicle', round((percentile_cont(0.5) within group (order by pv.km))::numeric, 1),
                'p90_per_vehicle', round((percentile_cont(0.9) within group (order by pv.km))::numeric, 1),
                'km_per_day', round(sum(pv.km) / nullif((select tot.days from tot), 0), 1),
                'coverage_pct', round(100.0 * sum(pv.rd) / nullif(sum(pv.ed), 0), 1),
                'deviation_vs_overall_pct', round(100 * (avg(pv.km) / nullif((select overall.mean_vehicle from overall), 0) - 1), 1),
                'share_pct', round(100 * coalesce(sum(pv.km), 0) / nullif((select tot.km from tot), 0), 1)) as j
         from pv group by pv.operation_id) q),
    'by_location', (select coalesce(jsonb_agg(q.j order by q.j ->> 'operation', q.j ->> 'state', q.j ->> 'city', q.j ->> 'br'), '[]'::jsonb) from (
       select jsonb_build_object(
                'operation_id', x.operation_id,
                'operation', coalesce((select o.name from public.operations o where o.id = x.operation_id), 'Sem operação'),
                'state', (select s.uf::text from public.states s where s.id = x.state_id),
                'city', coalesce((select c.name from public.cities c where c.id = x.city_id), 'Sem local'),
                'br', (select b.code from public.operation_brs b where b.id = x.operation_br_id),
                'km', round(coalesce(sum(x.km), 0), 1), 'vehicles', count(distinct x.vehicle_id),
                'avg_per_vehicle', round(avg(x.km), 1),
                'median_per_vehicle', round((percentile_cont(0.5) within group (order by x.km))::numeric, 1),
                'km_per_day', round(sum(x.km) / nullif((select tot.days from tot), 0), 1),
                'coverage_pct', round(100.0 * sum(x.rd) / nullif(sum(x.ed), 0), 1),
                'share_pct', round(100 * coalesce(sum(x.km), 0) / nullif((select tot.km from tot), 0), 1)) as j
         from (select g.vehicle_id, g.operation_id, g.state_id, g.city_id, g.operation_br_id,
                      sum(g.km) filter (where g.counts) as km, count(*) filter (where g.has_reading) as rd,
                      count(*) filter (where not g.is_future) as ed
                 from g group by 1, 2, 3, 4, 5) x
        group by grouping sets ((x.operation_id), (x.operation_id, x.state_id), (x.operation_id, x.state_id, x.city_id),
                                (x.operation_id, x.state_id, x.city_id, x.operation_br_id))) q),
    'cohorts', (select coalesce(jsonb_agg(q.j order by q.j ->> 'label'), '[]'::jsonb) from (
       select jsonb_build_object(
                'key', d.cohort_key, 'level', d.cohort_level, 'label', d.cohort_label,
                'vehicles', count(*), 'eligible', count(*) filter (where d.eligible),
                'sufficient', count(*) filter (where d.eligible) >= (select st.min_cohort_size from private.km_settings_of(p_organization_id) st),
                'mean', round(avg(d.daily_avg) filter (where d.eligible), 1),
                'median', round((percentile_cont(0.5) within group (order by d.daily_avg) filter (where d.eligible))::numeric, 1),
                'q1', round((percentile_cont(0.25) within group (order by d.daily_avg) filter (where d.eligible))::numeric, 1),
                'q3', round((percentile_cont(0.75) within group (order by d.daily_avg) filter (where d.eligible))::numeric, 1),
                'p10', round((percentile_cont(0.1) within group (order by d.daily_avg) filter (where d.eligible))::numeric, 1),
                'p90', round((percentile_cont(0.9) within group (order by d.daily_avg) filter (where d.eligible))::numeric, 1),
                'min', min(d.daily_avg) filter (where d.eligible), 'max', max(d.daily_avg) filter (where d.eligible),
                'range', max(d.daily_avg) filter (where d.eligible) - min(d.daily_avg) filter (where d.eligible),
                'iqr', round(((percentile_cont(0.75) within group (order by d.daily_avg) filter (where d.eligible))
                              - (percentile_cont(0.25) within group (order by d.daily_avg) filter (where d.eligible)))::numeric, 1),
                'cv_pct', round(100 * stddev_samp(d.daily_avg) filter (where d.eligible) / nullif(avg(d.daily_avg) filter (where d.eligible), 0), 1),
                'odometer_median', round((percentile_cont(0.5) within group (order by d.odometer) filter (where d.eligible))::numeric),
                'odometer_iqr', round(((percentile_cont(0.75) within group (order by d.odometer) filter (where d.eligible))
                                       - (percentile_cont(0.25) within group (order by d.odometer) filter (where d.eligible)))::numeric),
                'odometer_iqr_previous', (select round(((percentile_cont(0.75) within group (order by dp.odometer) filter (where dp.eligible))
                                                        - (percentile_cont(0.25) within group (order by dp.odometer) filter (where dp.eligible)))::numeric)
                                            from dprev dp where dp.cohort_key = d.cohort_key),
                'above_p90', count(*) filter (where d.eligible and d.daily_percentile >= 90),
                'outliers', count(*) filter (where d.outlier is not null and d.outlier <> 'low_coverage')) as j
         from d group by d.cohort_key, d.cohort_level, d.cohort_label) q),
    'vehicles', (select coalesce(jsonb_agg(private.km_vehicle_card(d.vehicle_id) || jsonb_build_object(
                    'cohort_key', d.cohort_key, 'cohort_label', d.cohort_label, 'cohort_level', d.cohort_level,
                    'eligible', d.eligible, 'km_period', d.km_period, 'reading_days', d.reading_days,
                    'coverage_pct', d.coverage_pct, 'daily_avg', d.daily_avg, 'odometer', d.odometer,
                    'cohort_size', d.cohort_size, 'cohort_daily_median', d.cohort_daily_median,
                    'cohort_odometer_median', d.cohort_odometer_median, 'daily_percentile', d.daily_percentile,
                    'odometer_percentile', d.odometer_percentile, 'robust_z', d.robust_z, 'band', d.band,
                    'outlier', d.outlier, 'quadrant', d.quadrant, 'deviation_pct', d.deviation_from_median_pct,
                    'operation', (select o.name from public.operations o where o.id = d.operation_id),
                    'br', (select b.code from public.operation_brs b where b.id = d.operation_br_id),
                    'local', (select c.name from public.cities c where c.id = d.city_id),
                    'projection', case when d.daily_avg is not null and d.odometer is not null then jsonb_build_object(
                                    'd30', round(d.odometer + d.daily_avg * 30), 'd60', round(d.odometer + d.daily_avg * 60),
                                    'd90', round(d.odometer + d.daily_avg * 90),
                                    'confidence', case when d.coverage_pct >= 70 then 'high' when d.coverage_pct >= 40 then 'medium' else 'low' end) end,
                    'preventive', (select jsonb_build_object('cycle_number', c.cycle_number, 'milestone_km', c.milestone_km,
                                     'km_remaining', round(c.milestone_km - d.odometer),
                                     'days_estimate', case when d.daily_avg > 0 and c.milestone_km > d.odometer
                                                           then ceil((c.milestone_km - d.odometer) / d.daily_avg) end)
                                     from public.maintenance_preventive_cycles c
                                    where c.vehicle_id = d.vehicle_id and c.completed_on is null
                                    order by c.cycle_number limit 1))
                  order by d.cohort_label, d.daily_avg desc nulls last), '[]'::jsonb)
                   from d),
    'quadrants', (select coalesce(jsonb_object_agg(q.quadrant, q.n), '{}'::jsonb)
                    from (select d.quadrant, count(*) as n from d where d.quadrant is not null group by 1) q),
    'insights', (select coalesce(jsonb_agg(i.j), '[]'::jsonb) from (
       select jsonb_build_object('tone', 'warning', 'text',
                format('%s veículos rodaram acima do P90 da própria coorte técnica no período.', count(*))) as j
         from d where d.eligible and d.daily_percentile >= 90 and d.cohort_size >= 3 having count(*) > 0
       union all
       select jsonb_build_object('tone', 'info', 'text',
                format('%s veículos com cobertura abaixo do mínimo ficaram fora das estatísticas (não são tratados como baixa utilização).', count(*)))
         from d where not d.eligible having count(*) > 0
       union all
       select jsonb_build_object('tone', case when cur.iqr > prev.iqr then 'warning' else 'success' end, 'text',
                format('A dispersão dos hodômetros de %s %s %s%% em relação ao período anterior.', cur.label,
                       case when cur.iqr > prev.iqr then 'aumentou' else 'diminuiu' end,
                       replace(abs(round((100 * (cur.iqr / prev.iqr - 1))::numeric, 1))::text, '.', ',')))
         from (select d.cohort_key, min(d.cohort_label) as label,
                      (percentile_cont(0.75) within group (order by d.odometer) filter (where d.eligible))
                      - (percentile_cont(0.25) within group (order by d.odometer) filter (where d.eligible)) as iqr
                 from d group by d.cohort_key having count(*) filter (where d.eligible) >= 3) cur
         join (select dp.cohort_key,
                      (percentile_cont(0.75) within group (order by dp.odometer) filter (where dp.eligible))
                      - (percentile_cont(0.25) within group (order by dp.odometer) filter (where dp.eligible)) as iqr
                 from dprev dp group by dp.cohort_key having count(*) filter (where dp.eligible) >= 3) prev
           on prev.cohort_key = cur.cohort_key
        where prev.iqr > 0 and cur.iqr is not null and abs(cur.iqr / prev.iqr - 1) >= 0.05
       union all
       select jsonb_build_object('tone', 'warning', 'text',
                format('%s veículos devem atingir o próximo marco preventivo em até 30 dias (estimativa pelo ritmo do período).', count(*)))
         from d
         join lateral (select c.milestone_km from public.maintenance_preventive_cycles c
                        where c.vehicle_id = d.vehicle_id and c.completed_on is null order by c.cycle_number limit 1) pc on true
        where d.daily_avg > 0 and d.odometer is not null and pc.milestone_km > d.odometer
          and (pc.milestone_km - d.odometer) / d.daily_avg <= 30
       having count(*) > 0) i)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.km_analysis(uuid, jsonb) from public, anon;
grant execute on function public.km_analysis(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Qualidade de dados
-- -----------------------------------------------------------------------------
-- Score documentado (0–100), sem esconder problemas num denominador único:
--   cobertura   (peso 50) = dias-veículo com leitura confiável ÷ dias-veículo
--                           decorridos das frotas no escopo;
--   consistência(peso 30) = 1 − leituras com problema (inconsistente,
--                           divergência, pendente, regressão) ÷ leituras;
--   atualização (peso 20) = frotas ativas atualizadas (até ontem) ÷ frotas ativas.
-- Os três componentes são devolvidos junto com o score.
create or replace function public.km_quality(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to   date;
  v_result jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.view_quality') then
    raise exception 'Você não possui permissão para a qualidade de dados de KM.' using errcode = 'insufficient_privilege';
  end if;
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, p_filters) p;

  with g as (select * from private.km_grid(p_organization_id, v_from, v_to, p_filters) where in_filter),
  fr as (select * from private.km_vehicle_freshness(p_organization_id, array(select distinct g.vehicle_id from g))),
  vs as (select v.id, v.status from public.vehicles v where v.id in (select distinct g.vehicle_id from g)),
  c as (
    select count(*) filter (where not g.is_future) as elapsed,
           count(*) filter (where g.has_reading) as with_reading,
           count(*) filter (where g.reading_id is not null and not g.is_future) as readings,
           count(*) filter (where g.status in ('inconsistent', 'km_divergence', 'pending_review')
                                 or 'odometer_regression' = any (g.alerts)) as problems
      from g
  ),
  fx as (select count(*) filter (where vs.status = 'active') as active,
                count(*) filter (where vs.status = 'active' and fr.bucket = 'updated') as updated
           from vs left join fr on fr.vehicle_id = vs.id),
  last_batch as (
    select b.* from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'km' and b.status = 'completed'
     order by b.processed_at desc nulls last limit 1
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'score', (select round(50 * coalesce(c.with_reading::numeric / nullif(c.elapsed, 0), 0)
                           + 30 * (1 - coalesce(c.problems::numeric / nullif(c.readings, 0), 0))
                           + 20 * coalesce(fx.updated::numeric / nullif(fx.active, 0), 0), 1) from c, fx),
    'components', (select jsonb_build_object(
                     'coverage_pct', round(100 * c.with_reading::numeric / nullif(c.elapsed, 0), 1),
                     'consistency_pct', round(100 * (1 - c.problems::numeric / nullif(c.readings, 0)), 1),
                     'freshness_pct', round(100 * fx.updated::numeric / nullif(fx.active, 0), 1),
                     'elapsed_vehicle_days', c.elapsed, 'readings', c.readings, 'with_reading', c.with_reading,
                     'problems', c.problems, 'active_vehicles', fx.active, 'updated_vehicles', fx.updated) from c, fx),
    'indicators', (select jsonb_build_object(
                     'valid', count(*) filter (where g.status = 'validated'),
                     'no_reading', count(*) filter (where g.status = 'no_reading' and not g.is_future),
                     'no_reading_informed', count(*) filter (where g.status = 'no_reading' and g.reading_id is not null),
                     'no_movement', count(*) filter (where g.status = 'no_movement'),
                     'km_divergence', count(*) filter (where g.status = 'km_divergence'),
                     'high_mileage', count(*) filter (where g.status = 'high_mileage' or 'high_mileage' = any (g.alerts)),
                     'inconsistent', count(*) filter (where g.status = 'inconsistent'),
                     'pending_review', count(*) filter (where g.status = 'pending_review'),
                     'regression', count(*) filter (where 'odometer_regression' = any (g.alerts)),
                     'jump', count(*) filter (where 'odometer_jump' = any (g.alerts)),
                     'registry_divergence', count(distinct g.vehicle_id) filter (where 'registry_divergence' = any (g.alerts)),
                     'corrected', count(*) filter (where g.is_corrected),
                     'stale_vehicles', (select count(*) from fr where fr.bucket in ('d2_3', 'd4_7', 'd7_plus', 'never')),
                     'unregistered_plates', (select count(distinct e.message) from public.import_errors e, last_batch lb
                                              where e.batch_id = lb.id and e.code = 'unregistered_plate'),
                     'duplicates', (select count(*) from public.import_errors e, last_batch lb
                                     where e.batch_id = lb.id and e.code in ('duplicate_conflict', 'duplicate_identical')))
                     from g),
    'issues', (select coalesce(jsonb_agg(q.j order by q.j ->> 'day' desc, q.j ->> 'plate'), '[]'::jsonb) from (
                 select private.km_vehicle_card(g.vehicle_id) || jsonb_build_object(
                          'reading_id', g.reading_id, 'day', g.day, 'status', g.status, 'alerts', to_jsonb(g.alerts),
                          'odometer_start', g.odometer_start, 'odometer_end', g.odometer_end,
                          'km_informed', g.km_informed, 'km_calculated', g.km_calculated, 'km', g.km,
                          'corrected', g.is_corrected) as j
                   from g
                  where g.reading_id is not null
                    and (g.status in ('inconsistent', 'km_divergence', 'pending_review', 'high_mileage')
                         or g.alerts && array['odometer_regression', 'odometer_jump', 'registry_divergence'])
                  order by g.day desc limit 1000) q),
    'stale', (select coalesce(jsonb_agg(private.km_vehicle_card(fr.vehicle_id) || jsonb_build_object(
                'last_reading_date', fr.last_reading_date, 'missing_days', fr.missing_days, 'bucket', fr.bucket)
                order by fr.missing_days desc nulls first), '[]'::jsonb)
                from fr where fr.bucket in ('d2_3', 'd4_7', 'd7_plus', 'never')),
    'health', (select jsonb_object_agg(h.health, h.n) from (
                 select private.km_odometer_health(fr.missing_days, x.reg::integer, x.div::integer, x.cov) as health, count(*) as n
                   from fr
                   join (select g.vehicle_id, count(*) filter (where 'odometer_regression' = any (g.alerts)) as reg,
                                count(*) filter (where g.status = 'km_divergence') as div,
                                round(100.0 * count(*) filter (where g.has_reading) / nullif(count(*) filter (where not g.is_future), 0), 1) as cov
                           from g group by g.vehicle_id) x on x.vehicle_id = fr.vehicle_id
                  group by 1) h),
    'last_batch', (select jsonb_build_object('id', lb.id, 'file_name', lb.file_name, 'processed_at', lb.processed_at,
                                             'created_rows', lb.created_rows, 'updated_rows', lb.updated_rows,
                                             'error_rows', lb.error_rows, 'warning_rows', lb.warning_rows) from last_batch lb),
    'can_correct', private.has_permission(p_organization_id, 'km.correct')
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.km_quality(uuid, jsonb) from public, anon;
grant execute on function public.km_quality(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Lotes e base consolidada
-- -----------------------------------------------------------------------------
create or replace function public.km_import_batches(p_organization_id uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_organization_id, 'km.import') or private.has_permission(p_organization_id, 'km.view_quality')
          or private.has_permission(p_organization_id, 'km.view_audit')) then
    raise exception 'Você não possui permissão para ver os lotes de KM.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.import_batches b where b.organization_id = p_organization_id and b.type = 'km'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', b.id, 'file_name', b.file_name, 'status', b.status, 'created_at', b.created_at,
                'processed_at', b.processed_at, 'total_rows', b.total_rows, 'valid_rows', b.valid_rows,
                'warning_rows', b.warning_rows, 'error_rows', b.error_rows, 'created_rows', b.created_rows,
                'updated_rows', b.updated_rows, 'skipped_rows', b.skipped_rows, 'file_hash', b.file_hash,
                'sheet_name', b.summary ->> 'sheet_name', 'header_row', b.summary -> 'header_row',
                'period_from', b.summary ->> 'period_from', 'period_to', b.summary ->> 'period_to',
                'km_total', b.summary -> 'km_total', 'source_type', b.summary ->> 'source_type',
                'created_by', coalesce((select e.full_name from public.employees e
                                         join public.organization_memberships m on m.employee_id = e.id
                                        where m.user_id = b.created_by limit 1),
                                       (select u.email::text from auth.users u where u.id = b.created_by)))
                order by b.created_at desc), '[]'::jsonb)
               from (select * from public.import_batches b where b.organization_id = p_organization_id and b.type = 'km'
                      order by b.created_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) b));
end;
$$;

revoke all on function public.km_import_batches(uuid, integer, integer) from public, anon;
grant execute on function public.km_import_batches(uuid, integer, integer) to authenticated, service_role;

-- Base consolidada (exportação paginada; mesmos filtros e escopo da tela).
create or replace function public.km_readings_export(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 5000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to   date;
begin
  if not private.has_permission(p_organization_id, 'km.export') then
    raise exception 'Você não possui permissão para exportar KM.' using errcode = 'insufficient_privilege';
  end if;
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, p_filters) p;
  return (
    with g as (select * from private.km_grid(p_organization_id, v_from, v_to, p_filters) where in_filter and not is_future)
    select jsonb_build_object(
      'period', jsonb_build_object('from', v_from, 'to', v_to),
      'total', (select count(*) from g),
      'rows', (select coalesce(jsonb_agg(q.j order by q.day, q.plate), '[]'::jsonb) from (
                 select g.day, v.license_plate as plate, jsonb_build_object(
                   'day', g.day, 'plate', v.license_plate, 'fleet_code', v.fleet_code,
                   'type', (select t.name from public.vehicle_types t where t.id = v.vehicle_type_id),
                   'subcategory', (select s.name from public.vehicle_subcategories s where s.id = v.vehicle_subcategory_id),
                   'model', (select m.name from public.vehicle_models m where m.id = v.vehicle_model_id),
                   'operation', (select o.name from public.operations o where o.id = g.operation_id),
                   'state', (select s.uf::text from public.states s where s.id = g.state_id),
                   'city', (select c.name from public.cities c where c.id = g.city_id),
                   'br', (select b.code from public.operation_brs b where b.id = g.operation_br_id),
                   'leader', (select e.full_name from public.employees e where e.id = g.leader_employee_id),
                   'odometer_start', g.odometer_start, 'odometer_end', g.odometer_end,
                   'km_informed', g.km_informed, 'km_calculated', g.km_calculated, 'km_validated', g.km,
                   'status', g.status, 'alerts', array_to_string(g.alerts, ', '), 'corrected', g.is_corrected,
                   'context_source', g.context_source) as j
                   from g join public.vehicles v on v.id = g.vehicle_id
                  order by g.day, v.license_plate
                  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0)) q)));
end;
$$;

revoke all on function public.km_readings_export(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.km_readings_export(uuid, jsonb, integer, integer) to authenticated, service_role;

-- Exportar é tirar dados do sistema: cada relatório (controle mensal, base
-- consolidada, gerencial, rodízio, qualidade) deixa registro com tipo, formato,
-- quantidade de linhas e os filtros usados.
create or replace function public.log_km_export(
  p_organization_id uuid, p_kind text, p_format text, p_row_count integer, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'km.export') then
    raise exception 'Você não possui permissão para exportar KM.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, (select auth.uid()), 'km_export', null, 'EXPORT',
          jsonb_build_object('kind', p_kind, 'format', p_format, 'row_count', p_row_count,
                             'filters', coalesce(p_filters, '{}'::jsonb)));
end;
$$;

revoke all on function public.log_km_export(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.log_km_export(uuid, text, text, integer, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Correção, revisão, reprocessamento e parâmetros
-- -----------------------------------------------------------------------------
-- Correção manual: só com km.correct e motivo; o informado pela fonte nunca é
-- apagado (fica em *_imported); a trilha guarda anterior, novo, campo, motivo,
-- usuário e momento; o hodômetro do veículo acompanha.
create or replace function public.km_correct_reading(p_reading_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.km_daily_readings;
  v_set    public.km_settings;
  v_start  numeric;
  v_end    numeric;
  v_reason text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_cls    jsonb;
  v_status text;
begin
  select * into r from public.km_daily_readings where id = p_reading_id for update;
  if r.id is null or not private.has_permission(r.organization_id, 'km.correct') then
    raise exception 'Você não possui permissão para corrigir leituras de KM.' using errcode = 'insufficient_privilege';
  end if;
  if not (private.vehicle_in_scope(r.organization_id, r.vehicle_id)
          or r.operation_id in (select private.accessible_operation_ids())) then
    raise exception 'Leitura fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Informe o motivo da correção (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  v_start := round(private.km_parse_number(p_payload -> 'odometer_start'), 2);
  v_end := round(private.km_parse_number(p_payload -> 'odometer_end'), 2);
  if v_start is null or v_end is null then
    raise exception 'Informe os hodômetros inicial e final.' using errcode = 'invalid_parameter_value';
  end if;
  if v_start < 0 or v_end < 0 or v_start > 9999999 or v_end > 9999999 then
    raise exception 'Hodômetro fora da faixa.' using errcode = 'invalid_parameter_value';
  end if;
  v_set := private.km_settings_of(r.organization_id);
  v_cls := private.km_classify(v_start, v_end, null, v_set);
  v_status := v_cls ->> 'status';

  insert into public.km_reading_audit
    (organization_id, reading_id, vehicle_id, reading_date, action, changes, reason, actor_user_id, actor_name)
  values (r.organization_id, r.id, r.vehicle_id, r.reading_date, 'correction',
          jsonb_strip_nulls(jsonb_build_object(
            'odometer_start', case when r.odometer_start is distinct from v_start then jsonb_build_object('from', r.odometer_start, 'to', v_start) end,
            'odometer_end', case when r.odometer_end is distinct from v_end then jsonb_build_object('from', r.odometer_end, 'to', v_end) end,
            'distance_validated', case when r.distance_validated is distinct from (v_cls ->> 'validated')::numeric
                                       then jsonb_build_object('from', r.distance_validated, 'to', (v_cls ->> 'validated')::numeric) end,
            'status', case when r.status is distinct from v_status then jsonb_build_object('from', r.status, 'to', v_status) end)),
          v_reason, auth.uid(), private.km_actor_name());

  update public.km_daily_readings set
    odometer_start = v_start, odometer_end = v_end,
    distance_validated = case when (select s.counts_distance from public.km_reading_statuses s where s.code = v_status)
                              then (v_cls ->> 'validated')::numeric end,
    status = v_status,
    alerts = array(select distinct a from unnest(r.alerts) a where a not in ('odometer_regression', 'odometer_jump', 'high_mileage', 'missing_odometer', 'end_before_start'))
             || coalesce((select array_agg(x) from jsonb_array_elements_text(v_cls -> 'alerts') x), '{}'),
    is_corrected = true, corrected_at = now(), corrected_by = auth.uid(),
    updated_at = now(), updated_by = auth.uid()
  where id = r.id;

  perform private.km_sync_odometer(array[r.id]);
  perform private.emit_event(r.organization_id, 'km.odometer_corrected', 'km_reading', r.id,
    jsonb_build_object('vehicle_id', r.vehicle_id, 'reading_date', r.reading_date,
                       'from', jsonb_build_object('start', r.odometer_start, 'end', r.odometer_end),
                       'to', jsonb_build_object('start', v_start, 'end', v_end), 'reason', v_reason));
  return jsonb_build_object('reading_id', r.id, 'status', v_status, 'km', v_cls -> 'validated');
end;
$$;

revoke all on function public.km_correct_reading(uuid, jsonb) from public, anon;
grant execute on function public.km_correct_reading(uuid, jsonb) to authenticated, service_role;

-- Revisão de uma leitura pendente (hodômetro regressivo analisado): mantém o
-- KM como validado, com o parecer na trilha.
create or replace function public.km_review_reading(p_reading_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.km_daily_readings;
  v_status text;
begin
  select * into r from public.km_daily_readings where id = p_reading_id for update;
  if r.id is null or not private.has_permission(r.organization_id, 'km.correct') then
    raise exception 'Você não possui permissão para revisar leituras de KM.' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'pending_review' then
    raise exception 'Só uma leitura pendente de análise pode ser revisada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Informe o parecer da análise (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  v_status := (private.km_classify(r.odometer_start, r.odometer_end, r.distance_imported,
                                   private.km_settings_of(r.organization_id))) ->> 'status';
  if v_status = 'inconsistent' then v_status := 'validated'; end if;
  insert into public.km_reading_audit
    (organization_id, reading_id, vehicle_id, reading_date, action, changes, reason, actor_user_id, actor_name)
  values (r.organization_id, r.id, r.vehicle_id, r.reading_date, 'review',
          jsonb_build_object('status', jsonb_build_object('from', r.status, 'to', v_status)), btrim(p_reason),
          auth.uid(), private.km_actor_name());
  update public.km_daily_readings set status = v_status, updated_at = now(), updated_by = auth.uid() where id = r.id;
  return jsonb_build_object('reading_id', r.id, 'status', v_status);
end;
$$;

revoke all on function public.km_review_reading(uuid, text) from public, anon;
grant execute on function public.km_review_reading(uuid, text) to authenticated, service_role;

-- Reprocessamento: reclassifica (parâmetros vigentes) e recalcula o contexto
-- da data das leituras do período. Correções manuais preservam os hodômetros
-- corrigidos. Cada mudança vai para a trilha.
create or replace function public.km_reprocess(p_organization_id uuid, p_from date, p_to date, p_vehicle_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set   public.km_settings := private.km_settings_of(p_organization_id);
  v_vids  uuid[];
  v_dates date[];
  v_status integer := 0;
  v_ctx   integer := 0;
begin
  if not private.has_permission(p_organization_id, 'km.reprocess') then
    raise exception 'Você não possui permissão para reprocessar KM.' using errcode = 'insufficient_privilege';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Período inválido (até 400 dias).' using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(r.vehicle_id), array_agg(r.reading_date) into v_vids, v_dates
    from public.km_daily_readings r
   where r.organization_id = p_organization_id and r.reading_date between p_from and p_to
     and (p_vehicle_ids is null or r.vehicle_id = any (p_vehicle_ids));
  if v_vids is null then
    return jsonb_build_object('status_changes', 0, 'context_changes', 0);
  end if;

  -- contexto da data
  with ctx as (select * from private.km_context_pairs(p_organization_id, v_vids, v_dates)),
  ch as (
    select r.id, r.vehicle_id, r.reading_date, r.operation_id as op_from, c.operation_id as op_to,
           r.operation_br_id as br_from, c.operation_br_id as br_to, r.leader_employee_id as ld_from, c.leader_employee_id as ld_to,
           c.context_source, c.operation_id, c.operation_city_id, c.state_id, c.city_id, c.operation_br_id,
           c.fidelization_assignment_id, c.leader_employee_id, c.organization_unit_id
      from public.km_daily_readings r
      join ctx c on c.vehicle_id = r.vehicle_id and c.day = r.reading_date
     where r.organization_id = p_organization_id
       and (r.operation_id is distinct from c.operation_id or r.operation_br_id is distinct from c.operation_br_id
            or r.leader_employee_id is distinct from c.leader_employee_id or r.city_id is distinct from c.city_id
            or r.context_source is distinct from c.context_source)
  ),
  aud as (
    insert into public.km_reading_audit
      (organization_id, reading_id, vehicle_id, reading_date, action, changes, reason, actor_user_id, actor_name)
    select p_organization_id, ch.id, ch.vehicle_id, ch.reading_date, 'context_refresh',
           jsonb_strip_nulls(jsonb_build_object(
             'operation_id', case when ch.op_from is distinct from ch.op_to then jsonb_build_object('from', ch.op_from, 'to', ch.op_to) end,
             'operation_br_id', case when ch.br_from is distinct from ch.br_to then jsonb_build_object('from', ch.br_from, 'to', ch.br_to) end,
             'leader_employee_id', case when ch.ld_from is distinct from ch.ld_to then jsonb_build_object('from', ch.ld_from, 'to', ch.ld_to) end)),
           'Reprocessamento do contexto da data (Fidelização, alocação e Lideranças).', auth.uid(), private.km_actor_name()
      from ch
    returning reading_id
  ),
  up as (
    update public.km_daily_readings r set
      context_source = ch.context_source, operation_id = ch.operation_id, operation_city_id = ch.operation_city_id,
      state_id = ch.state_id, city_id = ch.city_id, operation_br_id = ch.operation_br_id,
      fidelization_assignment_id = ch.fidelization_assignment_id, leader_employee_id = ch.leader_employee_id,
      organization_unit_id = ch.organization_unit_id, context_resolved_at = now(), updated_at = now(), updated_by = auth.uid()
      from ch where r.id = ch.id
    returning r.id
  )
  select count(*) into v_ctx from up;

  -- status com os parâmetros vigentes (hodômetros vigentes; informado intacto)
  with cl as (
    select r.id, r.vehicle_id, r.reading_date, r.status as st_from, r.distance_validated as km_from,
           private.km_classify(r.odometer_start, r.odometer_end, r.distance_imported, v_set) as cls
      from public.km_daily_readings r
     where r.organization_id = p_organization_id and r.reading_date between p_from and p_to
       and (p_vehicle_ids is null or r.vehicle_id = any (p_vehicle_ids))
       and r.status <> 'pending_review'
  ),
  ch as (
    select cl.*, cl.cls ->> 'status' as st_to,
           case when s.counts_distance then (cl.cls ->> 'validated')::numeric end as km_to
      from cl join public.km_reading_statuses s on s.code = cl.cls ->> 'status'
     where cl.st_from is distinct from cl.cls ->> 'status'
        or cl.km_from is distinct from case when s.counts_distance then (cl.cls ->> 'validated')::numeric end
  ),
  aud as (
    insert into public.km_reading_audit
      (organization_id, reading_id, vehicle_id, reading_date, action, changes, reason, actor_user_id, actor_name)
    select p_organization_id, ch.id, ch.vehicle_id, ch.reading_date, 'reprocess',
           jsonb_strip_nulls(jsonb_build_object(
             'status', case when ch.st_from is distinct from ch.st_to then jsonb_build_object('from', ch.st_from, 'to', ch.st_to) end,
             'distance_validated', case when ch.km_from is distinct from ch.km_to then jsonb_build_object('from', ch.km_from, 'to', ch.km_to) end)),
           'Reclassificação com os parâmetros vigentes.', auth.uid(), private.km_actor_name()
      from ch
    returning reading_id
  ),
  up as (
    update public.km_daily_readings r set status = ch.st_to, distance_validated = ch.km_to,
           alerts = array(select distinct a from unnest(r.alerts) a where a not in ('high_mileage', 'missing_odometer', 'end_before_start'))
                    || coalesce((select array_agg(x) from jsonb_array_elements_text(ch.cls -> 'alerts') x), '{}'),
           updated_at = now(), updated_by = auth.uid()
      from ch where r.id = ch.id
    returning r.id
  )
  select count(*) into v_status from up;

  return jsonb_build_object('status_changes', v_status, 'context_changes', v_ctx);
end;
$$;

revoke all on function public.km_reprocess(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.km_reprocess(uuid, date, date, uuid[]) to authenticated, service_role;

create or replace function public.km_save_settings(p_organization_id uuid, p_payload jsonb)
returns public.km_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.km_settings := private.km_settings_of(p_organization_id);
  v_new public.km_settings;
begin
  if not private.has_permission(p_organization_id, 'km.manage_parameters') then
    raise exception 'Você não possui permissão para os parâmetros de KM.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.km_settings as s (
    organization_id, no_movement_tolerance_km, divergence_tolerance_km, high_mileage_km, odometer_jump_km,
    regression_tolerance_km, min_coverage_pct, min_cohort_size, outlier_iqr_factor, rotation_min_gap_km,
    rotation_stale_days, updated_at, updated_by)
  values (
    p_organization_id,
    coalesce((p_payload ->> 'no_movement_tolerance_km')::numeric, v_old.no_movement_tolerance_km),
    coalesce((p_payload ->> 'divergence_tolerance_km')::numeric, v_old.divergence_tolerance_km),
    coalesce((p_payload ->> 'high_mileage_km')::numeric, v_old.high_mileage_km),
    coalesce((p_payload ->> 'odometer_jump_km')::numeric, v_old.odometer_jump_km),
    coalesce((p_payload ->> 'regression_tolerance_km')::numeric, v_old.regression_tolerance_km),
    coalesce((p_payload ->> 'min_coverage_pct')::numeric, v_old.min_coverage_pct),
    coalesce((p_payload ->> 'min_cohort_size')::smallint, v_old.min_cohort_size),
    coalesce((p_payload ->> 'outlier_iqr_factor')::numeric, v_old.outlier_iqr_factor),
    coalesce((p_payload ->> 'rotation_min_gap_km')::numeric, v_old.rotation_min_gap_km),
    coalesce((p_payload ->> 'rotation_stale_days')::smallint, v_old.rotation_stale_days),
    now(), auth.uid())
  on conflict (organization_id) do update set
    no_movement_tolerance_km = excluded.no_movement_tolerance_km, divergence_tolerance_km = excluded.divergence_tolerance_km,
    high_mileage_km = excluded.high_mileage_km, odometer_jump_km = excluded.odometer_jump_km,
    regression_tolerance_km = excluded.regression_tolerance_km, min_coverage_pct = excluded.min_coverage_pct,
    min_cohort_size = excluded.min_cohort_size, outlier_iqr_factor = excluded.outlier_iqr_factor,
    rotation_min_gap_km = excluded.rotation_min_gap_km, rotation_stale_days = excluded.rotation_stale_days,
    updated_at = now(), updated_by = auth.uid()
  returning * into v_new;
  perform private.emit_event(p_organization_id, 'km.settings_updated', 'organization', p_organization_id,
    jsonb_build_object('from', to_jsonb(v_old) - 'updated_at' - 'updated_by', 'to', to_jsonb(v_new) - 'updated_at' - 'updated_by'));
  return v_new;
end;
$$;

revoke all on function public.km_save_settings(uuid, jsonb) from public, anon;
grant execute on function public.km_save_settings(uuid, jsonb) to authenticated, service_role;

create or replace function public.km_settings_get(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'km.view') then
    raise exception 'Você não possui permissão para a Gestão de KM.' using errcode = 'insufficient_privilege';
  end if;
  return to_jsonb(private.km_settings_of(p_organization_id)) - 'organization_id'
         || jsonb_build_object('statuses', (select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.km_reading_statuses s));
end;
$$;

revoke all on function public.km_settings_get(uuid) from public, anon;
grant execute on function public.km_settings_get(uuid) to authenticated, service_role;
