-- =============================================================================
-- GESTÃO DE KM RODADO · KM ATUAL DAS FROTAS
--
-- Uma linha por frota do recorte com o hodômetro oficial vigente — a leitura
-- mais recente de `vehicle_odometer_readings`, de qualquer origem (Gestão de
-- KM, manutenção, cadastro, correção manual, importação) — e o contexto de
-- hoje (Fidelização → alocação → Lideranças), para a tela "KM atual" e a
-- exportação. É a mesma leitura vigente que o Cadastro de Frotas
-- (`vehicle_directory`) e a Manutenção (`maintenance_resolve_km`, matriz
-- preventiva) usam: um só hodômetro para todos os módulos.
--
-- Atualização: `recent` = leitura de hoje ou de ontem; `stale` = 2 dias ou
-- mais; `never` = frota sem nenhuma leitura. Filtros por id e escopo iguais aos
-- das demais rotinas do KM; `p_filters.freshness` restringe por atualização.
-- =============================================================================
create or replace function public.km_fleet_current(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
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
  f_fresh   text[] := case when jsonb_typeof(f -> 'freshness') = 'array'
                           then array(select jsonb_array_elements_text(f -> 'freshness')) end;
  v_ids     uuid[];
  v_result  jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.view') then
    raise exception 'Você não possui permissão para a Gestão de KM.' using errcode = 'insufficient_privilege';
  end if;
  if not v_all then
    v_ops := array(select private.accessible_operation_ids());
    v_veh := array(select private.org_vehicle_scope_ids(p_organization_id));
  end if;

  -- frotas do recorte (padrão: ativas); os filtros de contexto entram depois,
  -- sobre o contexto de hoje
  select array_agg(v.id) into v_ids
    from public.vehicles v
   where v.organization_id = p_organization_id and v.deleted_at is null
     and case f_fleet when 'all' then true when 'inactive' then v.status <> 'active' else v.status = 'active' end
     and (f_vehs is null or v.id = any (f_vehs))
     and (f_types is null or v.vehicle_type_id = any (f_types))
     and (f_subs is null or v.vehicle_subcategory_id = any (f_subs))
     and (f_models is null or v.vehicle_model_id = any (f_models))
     and (f_search is null
          or private.normalize_plate(v.license_plate) like '%' || private.normalize_plate(f_search) || '%'
          or upper(coalesce(v.fleet_code, '')) like '%' || upper(f_search) || '%');
  v_ids := coalesce(v_ids, '{}');

  with ctx as (
    select * from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_today, array[cardinality(v_ids)]))
  ),
  odo as (
    -- a leitura vigente: a mais recente que ninguém corrigiu (mesma regra do Cadastro e da Manutenção)
    select distinct on (o.vehicle_id) o.vehicle_id, o.odometer_km, o.reading_date, o.source, o.km_reading_id
      from public.vehicle_odometer_readings o
     where o.organization_id = p_organization_id and o.vehicle_id = any (v_ids)
       and o.superseded_by is null and o.reading_date <= v_today + 1
     order by o.vehicle_id, o.reading_date desc, o.created_at desc
  ),
  kmr as (
    -- última leitura do próprio razão de KM, para comparação
    select distinct on (r.vehicle_id) r.vehicle_id, r.reading_date, r.odometer_end
      from public.km_daily_readings r
      join public.km_reading_statuses s on s.code = r.status and s.has_reading
     where r.organization_id = p_organization_id and r.vehicle_id = any (v_ids)
     order by r.vehicle_id, r.reading_date desc
  ),
  base as (
    select v.id as vehicle_id, v.license_plate,
           c.operation_id, c.state_id, c.city_id, c.operation_br_id, c.leader_employee_id, c.organization_unit_id,
           c.context_source,
           o.odometer_km, o.reading_date, o.source, (o.km_reading_id is not null) as from_km_module,
           k.reading_date as km_reading_date, k.odometer_end as km_odometer,
           case when o.reading_date is null then null else greatest(0, v_today - o.reading_date) end as days_since,
           case when o.reading_date is null then 'never'
                when v_today - o.reading_date <= 1 then 'recent'
                else 'stale' end as freshness
      from public.vehicles v
      left join ctx c on c.vehicle_id = v.id
      left join odo o on o.vehicle_id = v.id
      left join kmr k on k.vehicle_id = v.id
     where v.id = any (v_ids)
  ),
  vis as (
    select b.*
      from base b
     where (v_all
            or (b.operation_id is not null and b.operation_id = any (v_ops))
            or (b.operation_id is null and b.vehicle_id = any (v_veh)))
       and (f_ops is null or b.operation_id = any (f_ops))
       and (f_brs is null or b.operation_br_id = any (f_brs))
       and (f_leaders is null or b.leader_employee_id = any (f_leaders))
       and (f_units is null or b.organization_unit_id = any (f_units))
       and (f_states is null or b.state_id = any (f_states))
       and (f_cities is null or b.city_id = any (f_cities))
       and (f_fresh is null or b.freshness = any (f_fresh))
  )
  select jsonb_build_object(
    'today', v_today,
    'summary', (select jsonb_build_object(
       'vehicles', count(*),
       'recent', count(*) filter (where vis.freshness = 'recent'),
       'stale', count(*) filter (where vis.freshness = 'stale'),
       'never', count(*) filter (where vis.freshness = 'never'),
       'avg_days', round(avg(vis.days_since)::numeric, 1),
       'max_days', max(vis.days_since),
       'operations', count(distinct vis.operation_id) + (count(*) filter (where vis.operation_id is null) > 0)::int,
       'from_km_module', count(*) filter (where vis.from_km_module),
       'last_reading_date', max(vis.reading_date)) from vis),
    'rows', (select coalesce(jsonb_agg(private.km_vehicle_card(x.vehicle_id) || jsonb_build_object(
        'operation_id', x.operation_id,
        'operation', (select o.name from public.operations o where o.id = x.operation_id),
        'state', (select s.uf::text from public.states s where s.id = x.state_id),
        'city', (select c.name from public.cities c where c.id = x.city_id),
        'br', (select b2.code from public.operation_brs b2 where b2.id = x.operation_br_id),
        'leader', (select e.full_name from public.employees e where e.id = x.leader_employee_id),
        'context_source', x.context_source,
        'last_reading_date', x.reading_date, 'odometer_km', x.odometer_km, 'source', x.source,
        'from_km_module', x.from_km_module, 'days_since', x.days_since, 'freshness', x.freshness,
        'km_reading_date', x.km_reading_date, 'km_odometer', x.km_odometer)
        order by (select o.name from public.operations o where o.id = x.operation_id) nulls last, x.license_plate),
        '[]'::jsonb)
      from vis x)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.km_fleet_current(uuid, jsonb) from public, anon;
grant execute on function public.km_fleet_current(uuid, jsonb) to authenticated, service_role;

comment on function public.km_fleet_current(uuid, jsonb) is
  'Gestão de KM: KM atual das frotas — hodômetro oficial vigente (qualquer origem), contexto de hoje e atualização (recent/stale/never), com os filtros e o escopo do KM.';
