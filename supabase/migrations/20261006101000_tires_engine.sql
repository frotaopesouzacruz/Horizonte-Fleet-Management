-- =============================================================================
-- Gestão de Pneus — motor autoritativo e leituras (paginadas e agregadas no banco)
--
-- Uma única função avalia a fotografia (private.tire_rows): prazo de medição e
-- de calibragem, saúde do sulco, regra de PSI aplicável (a mais específica),
-- status de pressão, alerta operacional de retirada/ressolagem e severidade.
-- Todas as telas leem dela; o navegador nunca recalcula regra nem recebe a
-- base inteira para filtrar.
--
-- Avaliação "na data": a fotografia mais recente é avaliada na data de hoje
-- (agenda operacional: a medição envelhece entre importações); fotografias
-- anteriores, na própria data de referência, com os parâmetros vigentes então.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Apoio
-- -----------------------------------------------------------------------------
create or replace function private.tire_require(p_organization_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function private.tire_params_at(p_organization_id uuid, p_date date)
returns public.tire_parameter_sets
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.tire_parameter_sets p
   where p.organization_id = p_organization_id
   order by (p.effective_from <= p_date and (p.effective_to is null or p.effective_to >= p_date)) desc,
            (p.effective_from <= p_date) desc, p.effective_from desc
   limit 1;
$$;

create or replace function private.tire_latest_reference(p_organization_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(b.reference_date) from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed';
$$;

create or replace function private.tire_actor_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.employee_name from private.checklist_actor(p_organization_id) a limit 1),
    (select u.email from auth.users u where u.id = auth.uid()),
    'Usuário autenticado');
$$;

create or replace function private.tire_audit(p_organization_id uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_summary text, p_previous jsonb default null, p_current jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tire_audit_events (organization_id, action, entity_type, entity_id, summary, previous_values, current_values, actor_user_id, actor_name)
  values (p_organization_id, p_action, p_entity_type, p_entity_id, p_summary, p_previous, p_current, auth.uid(), private.tire_actor_name(p_organization_id));
$$;

-- Layout esperado do veículo: configuração do veículo > padrão do tipo >
-- layout que coincide exatamente com as posições em uso na fotografia >
-- posições observadas na fotografia.
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
     and s.canonical_status = 'em_uso' and s.position_code is not null;

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
-- 2. Avaliação da fotografia (escopo + filtros + regras) — fonte única das telas
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
  v_all      boolean := private.is_platform_admin() or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
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
     where sn.organization_id = p_organization_id and sn.reference_date = v_ref
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

-- -----------------------------------------------------------------------------
-- 3. Opções de filtro (da própria fotografia, dentro do escopo)
-- -----------------------------------------------------------------------------
create or replace function public.tires_filter_options(p_organization_id uuid, p_reference_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  with r as materialized (
    select * from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', p_reference_date)))
  select jsonb_build_object(
    'reference_dates', coalesce((select jsonb_agg(jsonb_build_object('reference_date', b.reference_date, 'file_name', b.file_name,
                                   'confirmed_at', b.confirmed_at, 'batch_id', b.id) order by b.reference_date desc)
                                   from public.tire_import_batches b where b.organization_id = p_organization_id and b.status = 'confirmed'), '[]'::jsonb),
    'operations', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                              from (select distinct r.operation_id as id, r.operation_name as name from r where r.operation_id is not null) x), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'uf', x.uf) order by x.uf)
                          from (select distinct r.state_id as id, r.state_uf as uf from r where r.state_id is not null) x), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'state_id', x.state_id, 'uf', x.uf) order by x.name)
                          from (select distinct r.city_id as id, r.city_name as name, r.state_id, r.state_uf as uf from r where r.city_id is not null) x), '[]'::jsonb),
    'brs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'operation_id', x.op) order by x.code)
                       from (select distinct r.operation_br_id as id, r.br_code as code, r.operation_id as op from r where r.operation_br_id is not null) x), '[]'::jsonb),
    'leaders', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                           from (select distinct r.leader_employee_id as id, r.leader_name as name from r where r.leader_employee_id is not null) x), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                         from (select distinct r.organization_unit_id as id, r.unit_name as name from r where r.organization_unit_id is not null) x), '[]'::jsonb),
    'vehicle_types', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                                 from (select distinct r.vehicle_type_id as id, r.vehicle_type_name as name from r where r.vehicle_type_id is not null) x), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'plate', x.plate, 'fleet', x.fleet) order by x.fleet, x.plate)
                            from (select distinct r.vehicle_id as id, r.license_plate as plate, r.fleet_number as fleet from r where r.vehicle_id is not null) x), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct r.brand as v from r where r.brand is not null) x), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct r.model as v from r where r.model is not null) x), '[]'::jsonb),
    'dimensions', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l) order by x.l)
                              from (select r.dimension_key as k, min(r.dimension) as l from r where r.dimension_key is not null group by r.dimension_key) x), '[]'::jsonb),
    'lives', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct r.life as v from r where r.life is not null) x), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label) order by x.sort, x.code)
                             from (select distinct r.position_code as code, r.position_label as label, r.position_sort as sort from r where r.position_code is not null) x), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Visão Geral: KPIs, distribuições, prioridades, insights e tendência
-- -----------------------------------------------------------------------------
create or replace function public.tires_overview(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  p        public.tire_parameter_sets;
  v_kpis jsonb; v_dist jsonb; v_prio jsonb; v_insights jsonb := '[]'::jsonb; v_trend jsonb := '[]'::jsonb;
  v_ops jsonb; v_gaps integer; v_gap_tires integer; v_batch jsonb; v_prev date; v_absent integer;
  v_insp jsonb; d record; t jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.dashboard.view');
  if v_ref is null then
    return jsonb_build_object('empty', true, 'reference_date', null, 'today', v_today);
  end if;
  v_as_of := case when v_ref = v_latest then greatest(v_today, v_ref) else v_ref end;
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_ref);

  select jsonb_build_object('batch_id', b.id, 'file_name', b.file_name, 'confirmed_at', b.confirmed_at,
                            'confirmed_by_name', b.confirmed_by_name, 'total_rows', b.total_rows, 'reference_date', b.reference_date)
    into v_batch
    from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_ref;
  select max(b.reference_date) into v_prev from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date < v_ref;
  select count(*) into v_absent from public.tires t where t.organization_id = p_organization_id and t.presence_status = 'absent'
     and private.tire_vehicle_visible(t.organization_id, t.current_vehicle_id);

  with r as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of)),
  u as materialized (select * from r where r.canonical_status = 'em_uso'),
  fl as (
    select coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k,
           bool_or(u.tread_class in ('abaixo_legal', 'critico')) as has_critical,
           bool_and(u.tread_class in ('adequado', 'atencao') and u.measurement_status in ('em_dia', 'proximo')
                    and u.calibration_status in ('em_dia', 'proximo') and u.psi_status = 'adequada') as compliant
      from u group by 1),
  ev as (
    select e.event_type from public.tire_events e
     where e.organization_id = p_organization_id and e.reference_date > v_ref - 30 and e.reference_date <= v_ref
       and e.tire_id in (select r.tire_id from r))
  select
    jsonb_build_object(
      'total', (select count(*) from r),
      'em_uso', (select count(*) from u),
      'estoque', (select count(*) from r where r.canonical_status = 'estoque'),
      'ressolagem', (select count(*) from r where r.canonical_status = 'ressolagem'),
      'descartado', (select count(*) from r where r.canonical_status = 'descartado'),
      'baixado', (select count(*) from r where r.canonical_status = 'baixado'),
      'outro', (select count(*) from r where r.canonical_status = 'outro'),
      'below_legal', (select count(*) from u where u.tread_class = 'abaixo_legal'),
      'critical', (select count(*) from u where u.tread_class in ('abaixo_legal', 'critico')),
      'attention', (select count(*) from u where u.tread_class = 'atencao'),
      'tread_unknown', (select count(*) from u where u.tread_class = 'sem_medicao'),
      'measurement_overdue', (select count(*) from u where u.measurement_status = 'vencido'),
      'measurement_due_soon', (select count(*) from u where u.measurement_status = 'proximo'),
      'measurement_missing', (select count(*) from u where u.measurement_status = 'sem_registro'),
      'measurement_ok', (select count(*) from u where u.measurement_status = 'em_dia'),
      'calibration_overdue', (select count(*) from u where u.calibration_status = 'vencido'),
      'calibration_due_soon', (select count(*) from u where u.calibration_status = 'proximo'),
      'calibration_missing', (select count(*) from u where u.calibration_status = 'sem_registro'),
      'calibration_ok', (select count(*) from u where u.calibration_status = 'em_dia'),
      'psi_low', (select count(*) from u where u.psi_status = 'baixa'),
      'psi_high', (select count(*) from u where u.psi_status = 'excesso'),
      'psi_adequate', (select count(*) from u where u.psi_status = 'adequada'),
      'psi_no_rule', (select count(*) from u where u.psi_status = 'sem_parametro'),
      'psi_missing', (select count(*) from u where u.psi_status = 'sem_calibragem'),
      'in_use_without_vehicle', (select count(*) from u where u.vehicle_id is null),
      'retread_alerts', (select count(*) from r where r.retread_alert),
      'quality_issue_tires', (select count(*) from r where cardinality(r.quality_flags) > 0),
      'stale', (select count(*) from r where r.stale_days > p.stale_update_days),
      'fleets', (select count(*) from fl),
      'fleets_compliant', (select count(*) from fl where fl.compliant),
      'fleets_with_critical', (select count(*) from fl where fl.has_critical),
      'tread_avg', (select round(avg(u.tread_min), 2) from u where u.tread_min is not null),
      'tread_median', (select round((percentile_cont(0.5) within group (order by u.tread_min))::numeric, 2) from u where u.tread_min is not null),
      'movements_30d', (select count(*) from ev where ev.event_type in ('TIRE_MOVED', 'TIRE_POSITION_CHANGED', 'TIRE_REMOVED', 'TIRE_RETURNED_TO_STOCK', 'TIRE_SENT_TO_RETREAD', 'TIRE_DISCARDED')),
      'life_changes_30d', (select count(*) from ev where ev.event_type = 'TIRE_LIFE_CHANGED'),
      'absent', v_absent
    ),
    jsonb_build_object(
      'status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc) from (select r.canonical_status as k, count(*) as n from r group by 1) x), '[]'::jsonb),
      'tread_class', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.tread_class as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'measurement_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.measurement_status as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'calibration_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.calibration_status as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'psi_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.psi_status as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'brand', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.k, 'count', x.n) order by x.n desc, x.k) from (select coalesce(r.brand, '—') as k, count(*) as n from r group by 1) x), '[]'::jsonb),
      'model', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.k, 'count', x.n) order by x.n desc, x.k) from (select coalesce(r.model, '—') as k, count(*) as n from r group by 1 order by 2 desc limit 12) x), '[]'::jsonb),
      'dimension', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n) order by x.n desc) from (select coalesce(r.dimension_key, '—') as k, min(coalesce(r.dimension, '—')) as l, count(*) as n from r group by 1) x), '[]'::jsonb),
      'life', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k) from (select coalesce(r.life::text, '—') as k, count(*) as n from r group by 1) x), '[]'::jsonb),
      'position', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n) order by x.s, x.k) from (select u.position_code as k, min(u.position_label) as l, min(u.position_sort) as s, count(*) as n from u where u.position_code is not null group by 1) x), '[]'::jsonb),
      'vehicle_type', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n) order by x.n desc) from (select coalesce(u.vehicle_type_id::text, '—') as k, coalesce(min(u.vehicle_type_name), 'Sem tipo') as l, count(*) as n from u group by 1) x), '[]'::jsonb),
      'operation', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'critical', x.c, 'overdue', x.o) order by x.n desc) from (select coalesce(u.operation_id::text, '—') as k, coalesce(min(u.operation_name), 'Sem operação') as l, count(*) as n, count(*) filter (where u.tread_class in ('abaixo_legal', 'critico')) as c, count(*) filter (where u.measurement_status = 'vencido') as o from u group by 1) x), '[]'::jsonb),
      'city', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'critical', x.c, 'overdue', x.o) order by x.n desc) from (select coalesce(u.city_id::text, '—') as k, coalesce(min(u.city_name) || ' · ' || min(u.state_uf), 'Sem local') as l, count(*) as n, count(*) filter (where u.tread_class in ('abaixo_legal', 'critico')) as c, count(*) filter (where u.measurement_status = 'vencido') as o from u group by 1) x), '[]'::jsonb),
      'br', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'critical', x.c, 'overdue', x.o) order by x.n desc) from (select coalesce(u.operation_br_id::text, '—') as k, coalesce(min(u.br_code), 'Sem BR') as l, count(*) as n, count(*) filter (where u.tread_class in ('abaixo_legal', 'critico')) as c, count(*) filter (where u.measurement_status = 'vencido') as o from u group by 1 order by 3 desc limit 15) x), '[]'::jsonb)
    ),
    coalesce((select jsonb_agg(to_jsonb(x) order by x.severity_score desc, x.tread_min nulls last, x.fire_number)
                from (select u.tire_id, u.fire_number, u.position_code, u.position_label, u.position_sort,
                             u.vehicle_id, u.license_plate, u.fleet_number, u.operation_id, u.operation_name,
                             u.city_id, u.city_name, u.state_uf, u.operation_br_id, u.br_code,
                             u.tread_min, u.tread_1, u.tread_2, u.tread_3, u.tread_4, u.tread_class, u.legal_tread_mm,
                             u.measurement_date, u.measurement_days, u.measurement_status,
                             u.psi, u.psi_min, u.psi_max, u.calibration_date, u.calibration_days, u.calibration_status, u.psi_status,
                             u.tread_divergence, u.retread_alert, u.severity_score, u.severity
                        from u where u.severity in ('critica', 'alta', 'media')
                       order by u.severity_score desc, u.tread_min nulls last limit 400) x), '[]'::jsonb),
    (select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'total', x.total, 'adherence', x.adh) order by x.adh nulls last)
       from (select u.operation_id as id, min(u.operation_name) as name, count(*) as total,
                    round(100.0 * count(*) filter (where u.measurement_status in ('em_dia', 'proximo'))
                          / nullif(count(*) filter (where u.measurement_status in ('em_dia', 'proximo', 'vencido')), 0), 1) as adh
               from u where u.operation_id is not null group by u.operation_id) x),
    (select count(*) from (select 1 from u where u.psi_status = 'sem_parametro'
                           group by u.vehicle_type_id, u.dimension_key, u.position_code) g),
    (select count(*) from u where u.psi_status = 'sem_parametro')
  into v_kpis, v_dist, v_prio, v_ops, v_gaps, v_gap_tires;

  -- taxas (calculadas aqui, uma vez)
  v_kpis := v_kpis || jsonb_build_object(
    'pct_em_uso', round(100.0 * (v_kpis ->> 'em_uso')::int / nullif((v_kpis ->> 'total')::int, 0), 1),
    'pct_estoque', round(100.0 * (v_kpis ->> 'estoque')::int / nullif((v_kpis ->> 'total')::int, 0), 1),
    'measurement_coverage_pct', round(100.0 * ((v_kpis ->> 'em_uso')::int - (v_kpis ->> 'measurement_missing')::int) / nullif((v_kpis ->> 'em_uso')::int, 0), 1),
    'measurement_adherence_pct', round(100.0 * ((v_kpis ->> 'measurement_ok')::int + (v_kpis ->> 'measurement_due_soon')::int)
        / nullif((v_kpis ->> 'measurement_ok')::int + (v_kpis ->> 'measurement_due_soon')::int + (v_kpis ->> 'measurement_overdue')::int, 0), 1),
    'calibration_coverage_pct', round(100.0 * ((v_kpis ->> 'em_uso')::int - (v_kpis ->> 'calibration_missing')::int) / nullif((v_kpis ->> 'em_uso')::int, 0), 1),
    'calibration_adherence_pct', round(100.0 * ((v_kpis ->> 'calibration_ok')::int + (v_kpis ->> 'calibration_due_soon')::int)
        / nullif((v_kpis ->> 'calibration_ok')::int + (v_kpis ->> 'calibration_due_soon')::int + (v_kpis ->> 'calibration_overdue')::int, 0), 1),
    'pressure_adequate_pct', round(100.0 * (v_kpis ->> 'psi_adequate')::int
        / nullif((v_kpis ->> 'psi_adequate')::int + (v_kpis ->> 'psi_low')::int + (v_kpis ->> 'psi_high')::int, 0), 1),
    'quality_score', round(100.0 * ((v_kpis ->> 'total')::int - (v_kpis ->> 'quality_issue_tires')::int) / nullif((v_kpis ->> 'total')::int, 0), 1),
    'psi_rule_gaps', v_gaps);

  select jsonb_build_object(
    'pending_review', count(*) filter (where i.status = 'pendente_revisao'),
    'pending_rodopar', count(*) filter (where i.status = 'pendente_rodopar'),
    'pending_rodopar_over_sla', count(*) filter (where i.status = 'pendente_rodopar' and i.approved_at < now() - make_interval(days => p.rodopar_sync_sla_days)),
    'returned', count(*) filter (where i.status = 'retornar_divergencia'),
    'persistent', count(*) filter (where i.status = 'pendente_rodopar' and i.persistent_divergence))
    into v_insp
    from public.tire_inspections i
   where i.organization_id = p_organization_id and private.tire_vehicle_visible(i.organization_id, i.vehicle_id);
  v_kpis := v_kpis || jsonb_build_object('inspections', v_insp);

  -- insights determinísticos: só aparecem quando o número existe
  if (v_kpis ->> 'measurement_overdue')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'measurement_overdue', 'tone', 'danger', 'count', (v_kpis ->> 'measurement_overdue')::int,
      'text', format('%s %s com medição de sulco vencida (mais de %s dias).', v_kpis ->> 'measurement_overdue',
                     case when (v_kpis ->> 'measurement_overdue')::int = 1 then 'pneu em uso está' else 'pneus em uso estão' end, p.measurement_warning_days));
  end if;
  if (v_kpis ->> 'fleets_with_critical')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'fleets_with_critical', 'tone', 'danger', 'count', (v_kpis ->> 'fleets_with_critical')::int,
      'text', format('%s %s ao menos um pneu com sulco crítico (até %s mm) ou abaixo do limite legal.', v_kpis ->> 'fleets_with_critical',
                     case when (v_kpis ->> 'fleets_with_critical')::int = 1 then 'frota possui' else 'frotas possuem' end,
                     replace(trim(to_char(p.tread_critical_mm, 'FM990.0')), '.', ',')));
  end if;
  if (v_kpis ->> 'below_legal')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'below_legal', 'tone', 'danger', 'count', (v_kpis ->> 'below_legal')::int,
      'text', format('%s %s abaixo do sulco mínimo legal da sua regra.', v_kpis ->> 'below_legal',
                     case when (v_kpis ->> 'below_legal')::int = 1 then 'pneu em uso está' else 'pneus em uso estão' end));
  end if;
  if v_ops is not null and jsonb_array_length(v_ops) > 1 and (v_ops -> 0 ->> 'adherence') is not null
     and (v_ops -> 0 ->> 'adherence')::numeric < 100 then
    v_insights := v_insights || jsonb_build_object('key', 'worst_operation', 'tone', 'warning', 'count', (v_ops -> 0 ->> 'total')::int,
      'text', format('A operação %s tem a menor aderência de medição: %s%%.', v_ops -> 0 ->> 'name', replace(v_ops -> 0 ->> 'adherence', '.', ',')));
  end if;
  if (v_kpis ->> 'psi_low')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'psi_low', 'tone', 'warning', 'count', (v_kpis ->> 'psi_low')::int,
      'text', format('%s %s com PSI abaixo do mínimo da regra.', v_kpis ->> 'psi_low', case when (v_kpis ->> 'psi_low')::int = 1 then 'pneu está' else 'pneus estão' end));
  end if;
  if (v_kpis ->> 'psi_high')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'psi_high', 'tone', 'warning', 'count', (v_kpis ->> 'psi_high')::int,
      'text', format('%s %s com PSI acima do máximo da regra.', v_kpis ->> 'psi_high', case when (v_kpis ->> 'psi_high')::int = 1 then 'pneu está' else 'pneus estão' end));
  end if;
  if v_gaps > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'psi_gaps', 'tone', 'info', 'count', v_gaps,
      'text', format('%s %s de tipo, dimensão e posição ainda sem parâmetro de PSI (%s %s).', v_gaps,
                     case when v_gaps = 1 then 'combinação' else 'combinações' end, v_gap_tires, case when v_gap_tires = 1 then 'pneu' else 'pneus' end));
  end if;
  if v_absent > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'absent', 'tone', 'warning', 'count', v_absent,
      'text', format('%s %s da fotografia anterior não %s no último relatório Rodopar.', v_absent,
                     case when v_absent = 1 then 'pneu' else 'pneus' end, case when v_absent = 1 then 'aparece' else 'aparecem' end));
  end if;
  if (v_insp ->> 'pending_rodopar_over_sla')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'rodopar_sla', 'tone', 'warning', 'count', (v_insp ->> 'pending_rodopar_over_sla')::int,
      'text', format('%s %s aguardando lançamento no Rodopar há mais de %s dias.', v_insp ->> 'pending_rodopar_over_sla',
                     case when (v_insp ->> 'pending_rodopar_over_sla')::int = 1 then 'vistoria aprovada está' else 'vistorias aprovadas estão' end, p.rodopar_sync_sla_days));
  end if;
  if (v_kpis ->> 'quality_issue_tires')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'quality', 'tone', 'info', 'count', (v_kpis ->> 'quality_issue_tires')::int,
      'text', format('%s %s inconsistência no relatório Rodopar (veja Qualidade de dados).', v_kpis ->> 'quality_issue_tires',
                     case when (v_kpis ->> 'quality_issue_tires')::int = 1 then 'pneu tem' else 'pneus têm' end));
  end if;

  -- tendência por fotografia (cada uma avaliada na própria data)
  for d in select b.reference_date from public.tire_import_batches b
            where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date <= v_ref
            order by b.reference_date desc limit 12 loop
    with r as materialized (select * from private.tire_rows(p_organization_id, f || jsonb_build_object('reference_date', d.reference_date), d.reference_date)),
    u as (select * from r where r.canonical_status = 'em_uso')
    select jsonb_build_object(
      'reference_date', d.reference_date,
      'total', (select count(*) from r),
      'in_use', (select count(*) from u),
      'critical', (select count(*) from u where u.tread_class in ('abaixo_legal', 'critico')),
      'psi_out', (select count(*) from u where u.psi_status in ('baixa', 'excesso')),
      'measurement_coverage_pct', (select round(100.0 * count(*) filter (where u.measurement_status <> 'sem_registro') / nullif(count(*), 0), 1) from u),
      'measurement_adherence_pct', (select round(100.0 * count(*) filter (where u.measurement_status in ('em_dia', 'proximo'))
                                      / nullif(count(*) filter (where u.measurement_status in ('em_dia', 'proximo', 'vencido')), 0), 1) from u),
      'calibration_coverage_pct', (select round(100.0 * count(*) filter (where u.calibration_status <> 'sem_registro') / nullif(count(*), 0), 1) from u),
      'calibration_adherence_pct', (select round(100.0 * count(*) filter (where u.calibration_status in ('em_dia', 'proximo'))
                                      / nullif(count(*) filter (where u.calibration_status in ('em_dia', 'proximo', 'vencido')), 0), 1) from u),
      'quality_score', (select round(100.0 * count(*) filter (where cardinality(r.quality_flags) = 0) / nullif(count(*), 0), 1) from r))
      into t;
    v_trend := t || v_trend;
  end loop;

  return jsonb_build_object(
    'empty', false, 'today', v_today, 'as_of', v_as_of, 'reference_date', v_ref, 'latest_reference_date', v_latest,
    'previous_reference_date', v_prev, 'is_latest', v_ref = v_latest, 'photo', v_batch,
    'parameters', to_jsonb(p), 'kpis', v_kpis, 'distributions', v_dist, 'priorities', coalesce(v_prio, '[]'::jsonb),
    'insights', v_insights, 'trend', v_trend);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Base Geral: por frota/placa, por Nº Fogo e fora da frota (paginado)
-- -----------------------------------------------------------------------------
create or replace function public.tires_base(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_view text default 'frota',
  p_sort text default null, p_dir text default 'asc', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_desc   boolean := coalesce(p_dir, 'asc') = 'desc';
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.base.view');
  if v_ref is null then
    return jsonb_build_object('empty', true, 'total', 0, 'rows', '[]'::jsonb, 'groups', '[]'::jsonb, 'limit', v_limit, 'offset', v_offset);
  end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  f := f || jsonb_build_object('reference_date', v_ref);

  if p_view = 'frota' then
    with r as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
    g as (
      select coalesce(r.vehicle_id::text, 'fleet:' || coalesce(r.fleet_number, '?')) as k,
             (array_agg(r.vehicle_id))[1] as vehicle_id, min(r.license_plate) as license_plate, min(r.fleet_number) as fleet_number,
             min(r.vehicle_type_name) as vehicle_type_name, min(r.operation_name) as operation_name, min(r.city_name) as city_name,
             min(r.state_uf) as state_uf, min(r.br_code) as br_code, min(r.leader_name) as leader_name, min(r.unit_name) as unit_name,
             count(*) as tires,
             count(*) filter (where r.tread_class = 'abaixo_legal') as below_legal,
             count(*) filter (where r.tread_class in ('abaixo_legal', 'critico')) as critical,
             count(*) filter (where r.tread_class = 'atencao') as attention,
             count(*) filter (where r.psi_status in ('baixa', 'excesso')) as psi_out,
             count(*) filter (where r.psi_status = 'sem_parametro') as psi_no_rule,
             count(*) filter (where r.measurement_status = 'vencido') as measurement_overdue,
             count(*) filter (where r.measurement_status = 'sem_registro') as measurement_missing,
             count(*) filter (where r.calibration_status = 'vencido') as calibration_overdue,
             count(*) filter (where r.calibration_status = 'sem_registro') as calibration_missing,
             min(r.measurement_date) as oldest_measurement, min(r.calibration_date) as oldest_calibration,
             min(r.tread_min) as worst_tread, max(r.severity_score) as worst_score,
             jsonb_agg(to_jsonb(r) - 'as_of' order by r.position_sort, r.position_code) as tire_rows
        from r group by 1),
    g2 as (
      select g.*,
             case when g.critical > 0 or g.measurement_overdue > 0 then 'critico'
                  when g.attention > 0 or g.psi_out > 0 or g.calibration_overdue > 0 or g.measurement_missing > 0 or g.calibration_missing > 0 then 'atencao'
                  else 'ok' end as status,
             row_number() over (order by
               case when not v_desc then case p_sort when 'fleet' then g.fleet_number when 'plate' then g.license_plate when 'operation' then g.operation_name end end asc nulls last,
               case when v_desc then case p_sort when 'fleet' then g.fleet_number when 'plate' then g.license_plate when 'operation' then g.operation_name end end desc nulls last,
               case when p_sort = 'tread' then g.worst_tread end asc nulls last,
               g.worst_score desc, g.fleet_number) as rn,
             count(*) over () as total
        from g)
    select jsonb_build_object(
      'view', 'frota', 'reference_date', v_ref, 'as_of', v_as_of, 'limit', v_limit, 'offset', v_offset,
      'total', coalesce(max(g2.total), 0),
      'summary', jsonb_build_object(
        'fleets', coalesce(max(g2.total), 0),
        'critical', count(*) filter (where g2.status = 'critico'),
        'attention', count(*) filter (where g2.status = 'atencao'),
        'ok', count(*) filter (where g2.status = 'ok'),
        'tires', coalesce(sum(g2.tires), 0)),
      'groups', coalesce(jsonb_agg(jsonb_build_object(
          'key', g2.k, 'vehicle_id', g2.vehicle_id, 'license_plate', g2.license_plate, 'fleet_number', g2.fleet_number,
          'vehicle_type_name', g2.vehicle_type_name, 'operation_name', g2.operation_name, 'city_name', g2.city_name,
          'state_uf', g2.state_uf, 'br_code', g2.br_code, 'leader_name', g2.leader_name, 'unit_name', g2.unit_name,
          'tires', g2.tires, 'below_legal', g2.below_legal, 'critical', g2.critical, 'attention', g2.attention,
          'psi_out', g2.psi_out, 'psi_no_rule', g2.psi_no_rule, 'measurement_overdue', g2.measurement_overdue,
          'measurement_missing', g2.measurement_missing, 'calibration_overdue', g2.calibration_overdue,
          'calibration_missing', g2.calibration_missing, 'oldest_measurement', g2.oldest_measurement,
          'oldest_calibration', g2.oldest_calibration, 'worst_tread', g2.worst_tread, 'status', g2.status,
          'layout', (select to_jsonb(l) from private.tire_vehicle_layout(p_organization_id, g2.vehicle_id, v_ref) l where g2.vehicle_id is not null),
          'tire_rows', g2.tire_rows) order by g2.rn) filter (where g2.rn > v_offset and g2.rn <= v_offset + v_limit), '[]'::jsonb))
      into v_res from g2;
    -- resumo calculado sobre todos os grupos (não só a página)
    return v_res;
  end if;

  with r as materialized (
    select * from private.tire_rows(p_organization_id, f, v_as_of) x
     where (p_view = 'fora' and x.canonical_status <> 'em_uso') or (p_view <> 'fora')),
  o as (
    select r.*, row_number() over (order by
      case when not v_desc then case p_sort
        when 'fire_number' then r.fire_number when 'status' then r.canonical_status when 'plate' then r.license_plate
        when 'fleet' then r.fleet_number when 'brand' then r.brand when 'position' then lpad(r.position_sort::text, 4, '0') end end asc nulls last,
      case when v_desc then case p_sort
        when 'fire_number' then r.fire_number when 'status' then r.canonical_status when 'plate' then r.license_plate
        when 'fleet' then r.fleet_number when 'brand' then r.brand when 'position' then lpad(r.position_sort::text, 4, '0') end end desc nulls last,
      case when not v_desc then case p_sort when 'tread' then r.tread_min when 'measurement' then r.measurement_days::numeric
        when 'calibration' then r.calibration_days::numeric when 'psi' then r.psi when 'life' then r.life::numeric when 'km' then r.km_real::numeric end end asc nulls last,
      case when v_desc then case p_sort when 'tread' then r.tread_min when 'measurement' then r.measurement_days::numeric
        when 'calibration' then r.calibration_days::numeric when 'psi' then r.psi when 'life' then r.life::numeric when 'km' then r.km_real::numeric end end desc nulls last,
      r.fire_number) as rn
      from r)
  select jsonb_build_object(
    'view', p_view, 'reference_date', v_ref, 'as_of', v_as_of, 'limit', v_limit, 'offset', v_offset,
    'total', (select count(*) from o),
    'status_counts', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc)
                                 from (select o.canonical_status as k, count(*) as n from o group by 1) x), '[]'::jsonb),
    'summary', jsonb_build_object(
      'total', (select count(*) from o),
      'in_use', (select count(*) from o where o.canonical_status = 'em_uso'),
      'measurement_overdue', (select count(*) from o where o.canonical_status = 'em_uso' and o.measurement_status = 'vencido'),
      'measurement_due_soon', (select count(*) from o where o.canonical_status = 'em_uso' and o.measurement_status = 'proximo'),
      'measurement_missing', (select count(*) from o where o.measurement_date is null),
      'psi_out', (select count(*) from o where o.canonical_status = 'em_uso' and o.psi_status in ('baixa', 'excesso')),
      'without_vehicle', (select count(*) from o where o.canonical_status = 'em_uso' and o.vehicle_id is null),
      'tread_divergence', (select count(*) from o where o.tread_divergence),
      'km_real_negative', (select count(*) from o where o.km_real < 0),
      'retread_alerts', (select count(*) from o where o.retread_alert)),
    'rows', coalesce((select jsonb_agg(to_jsonb(o) - 'as_of' - 'rn' order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Ficha do pneu (identificação, situação, saúde, fotografias, eventos,
--    serviços, vistorias e qualidade)
-- -----------------------------------------------------------------------------
create or replace function public.tire_sheet(p_organization_id uuid, p_tire_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t        public.tires;
  v_last   public.tire_daily_snapshots;
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_cur    jsonb;
  v_layout jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.base.view');
  select * into t from public.tires x where x.id = p_tire_id and x.organization_id = p_organization_id;
  if t.id is null then return null; end if;
  select * into v_last from public.tire_daily_snapshots s where s.tire_id = t.id order by s.reference_date desc limit 1;
  -- escopo: o veículo da última fotografia do pneu
  if not private.tire_vehicle_visible(p_organization_id, v_last.vehicle_id)
     and not (v_last.operation_id is not null and v_last.operation_id in (select private.accessible_operation_ids())) then
    return null;
  end if;

  select to_jsonb(x) - 'as_of' into v_cur
    from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', v_last.reference_date, 'search', t.fire_number),
                           case when v_last.reference_date = v_latest then greatest(private.maintenance_today(p_organization_id), v_last.reference_date) else v_last.reference_date end) x
   where x.tire_id = t.id;
  if v_last.vehicle_id is not null then
    select to_jsonb(l) into v_layout from private.tire_vehicle_layout(p_organization_id, v_last.vehicle_id, v_last.reference_date) l;
  end if;

  return jsonb_build_object(
    'tire', to_jsonb(t),
    'latest_reference_date', v_latest,
    'current', v_cur,
    'layout', v_layout,
    'rodopar', jsonb_build_object(
      'rodopar_tire_branch', v_last.rodopar_tire_branch, 'unit_code', v_last.unit_code, 'cost_code', v_last.cost_code,
      'fleet_branch', v_last.fleet_branch, 'fleet_number_raw', v_last.fleet_number_raw, 'rodopar_status_raw', v_last.rodopar_status_raw,
      'rodopar_status_label', v_last.rodopar_status_label, 'rodopar_condition', v_last.rodopar_condition,
      'rodopar_classification', v_last.rodopar_classification, 'registration_at', v_last.registration_at,
      'rodopar_created_by', v_last.rodopar_created_by, 'rodopar_updated_by', v_last.rodopar_updated_by,
      'rodopar_updated_at', v_last.rodopar_updated_at, 'measurement_at', v_last.measurement_at, 'calibration_at', v_last.calibration_at,
      'km_rodado', v_last.km_rodado, 'km_real', v_last.km_real, 'quality_flags', v_last.quality_flags, 'enrichment_status', v_last.enrichment_status,
      'reference_date', v_last.reference_date, 'import_batch_id', v_last.import_batch_id),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object(
        'reference_date', s.reference_date, 'canonical_status', s.canonical_status, 'rodopar_status_raw', s.rodopar_status_raw,
        'vehicle_id', s.vehicle_id, 'license_plate', coalesce(v.license_plate, s.vehicle_plate_snapshot),
        'fleet_number', coalesce(s.fleet_number_snapshot, s.fleet_number_raw), 'position_code', s.position_code, 'life', s.life,
        'tread_min', s.tread_min, 'tread_1', s.tread_1, 'tread_2', s.tread_2, 'tread_3', s.tread_3, 'tread_4', s.tread_4,
        'measurement_date', s.measurement_date, 'psi', s.psi, 'calibration_date', s.calibration_date,
        'operation_name', o.name, 'city_name', ci.name, 'br_code', b.code, 'quality_flags', s.quality_flags) order by s.reference_date desc)
        from public.tire_daily_snapshots s
        left join public.vehicles v on v.id = s.vehicle_id
        left join public.operations o on o.id = s.operation_id
        left join public.cities ci on ci.id = s.city_id
        left join public.operation_brs b on b.id = s.operation_br_id
       where s.tire_id = t.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'reference_date', e.reference_date, 'occurred_at', e.occurred_at,
        'previous', e.previous_values, 'current', e.current_values, 'vehicle_id', e.vehicle_id, 'previous_vehicle_id', e.previous_vehicle_id,
        'position_code', e.position_code, 'previous_position_code', e.previous_position_code, 'source', e.source, 'note', e.note,
        'import_batch_id', e.import_batch_id) order by e.reference_date desc, e.occurred_at desc)
        from public.tire_events e where e.tire_id = t.id
         and p_organization_id in (select private.permitted_org_ids('tires.history.view'))), '[]'::jsonb),
    'repairs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'service_date', rp.service_date, 'repair_type', rp.repair_type, 'supplier_name', rp.supplier_name_snapshot,
        'service_order_number', rp.service_order_number, 'notes', rp.notes, 'license_plate', rp.license_plate_snapshot,
        'fleet_code', rp.fleet_code_snapshot, 'vehicle_resolution', rp.vehicle_resolution, 'resolution_confidence', rp.resolution_confidence,
        'status', rp.status) order by rp.service_date desc)
        from public.tire_repairs rp where rp.tire_id = t.id
         and p_organization_id in (select private.permitted_org_ids('tires.services.view'))), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object(
        'inspection_id', i.id, 'protocol', i.protocol, 'status', i.status, 'inspection_date', i.inspection_date,
        'position_code', it.position_code, 'fire_number_read', it.fire_number_read, 'tread_1', it.tread_1, 'tread_2', it.tread_2,
        'tread_3', it.tread_3, 'tread_4', it.tread_4, 'psi_read', it.psi_read, 'divergences', it.divergences, 'sync_status', it.sync_status,
        'inspector_name', i.inspector_name_snapshot) order by i.inspection_date desc)
        from public.tire_inspection_items it join public.tire_inspections i on i.id = it.inspection_id
       where i.organization_id = p_organization_id and (it.expected_tire_id = t.id or it.fire_number_read = t.fire_number)), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Aderência de milimetragem e de calibragem
-- -----------------------------------------------------------------------------
create or replace function private.tire_breakdowns(p_rows jsonb, p_status_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- quebras por operação, estado, local (cidade), BR, filial, liderança e tipo,
  -- todas a partir das mesmas linhas
  with r as (select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x),
  dims(dim, id_key, name_key) as (values
    ('operation', 'operation_id', 'operation_name'), ('state', 'state_id', 'state_uf'), ('city', 'city_id', 'city_name'),
    ('br', 'operation_br_id', 'br_code'), ('unit', 'organization_unit_id', 'unit_name'),
    ('leader', 'leader_employee_id', 'leader_name'), ('vehicle_type', 'vehicle_type_id', 'vehicle_type_name')),
  agg as (
    select d.dim, coalesce(r.x ->> d.id_key, '') as id, coalesce(min(r.x ->> d.name_key), '') as name,
           count(*) as total,
           count(*) filter (where r.x ->> p_status_key = 'em_dia') as em_dia,
           count(*) filter (where r.x ->> p_status_key = 'proximo') as proximo,
           count(*) filter (where r.x ->> p_status_key = 'vencido') as vencido,
           count(*) filter (where r.x ->> p_status_key = 'sem_registro') as sem_registro
      from dims d cross join r group by d.dim, 2)
  select coalesce(jsonb_object_agg(z.dim, z.items), '{}'::jsonb) from (
    select a.dim, jsonb_agg(jsonb_build_object(
             'id', nullif(a.id, ''), 'name', nullif(a.name, ''), 'total', a.total, 'em_dia', a.em_dia, 'proximo', a.proximo,
             'vencido', a.vencido, 'sem_registro', a.sem_registro,
             'coverage_pct', round(100.0 * (a.total - a.sem_registro) / nullif(a.total, 0), 1),
             'adherence_pct', round(100.0 * (a.em_dia + a.proximo) / nullif(a.em_dia + a.proximo + a.vencido, 0), 1))
             order by a.total desc, a.name) as items
      from agg a group by a.dim) z;
$$;

create or replace function public.tires_adherence(
  p_organization_id uuid, p_kind text, p_filters jsonb default '{}'::jsonb,
  p_pending_filter text default 'all', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_cal    boolean := p_kind = 'calibration';
  p        public.tire_parameter_sets;
  v_res    jsonb;
begin
  if p_kind not in ('measurement', 'calibration') then
    raise exception 'Tipo de aderência inválido.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.tire_require(p_organization_id, case when v_cal then 'tires.calibration.view' else 'tires.measurement.view' end);
  if v_ref is null then return jsonb_build_object('empty', true); end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_ref);

  with u as materialized (
    select x.*, case when v_cal then x.calibration_status else x.measurement_status end as st,
                case when v_cal then x.calibration_days else x.measurement_days end as days,
                case when v_cal then x.calibration_date else x.measurement_date end as last_date,
                case when v_cal then x.calibration_due_date else x.measurement_due_date end as due_date
      from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  pend as (
    select u.* from u
     where (u.st <> 'em_dia' or (v_cal and u.psi_status in ('baixa', 'excesso', 'sem_parametro')))
       and (coalesce(p_pending_filter, 'all') = 'all'
            or (p_pending_filter = 'vencido' and u.st = 'vencido')
            or (p_pending_filter = 'proximo' and u.st = 'proximo')
            or (p_pending_filter = 'sem_registro' and u.st = 'sem_registro')
            or (p_pending_filter = 'pressao' and u.psi_status in ('baixa', 'excesso'))
            or (p_pending_filter = 'sem_parametro' and u.psi_status = 'sem_parametro'))),
  pend_o as (select pend.*, row_number() over (order by pend.days desc nulls first, pend.city_name, pend.fleet_number, pend.position_sort) as rn from pend),
  veh as (
    select coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k, (array_agg(u.vehicle_id))[1] as vehicle_id,
           min(u.license_plate) as license_plate, min(u.fleet_number) as fleet_number, min(u.operation_name) as operation_name,
           min(u.city_name) as city_name, count(*) as tires,
           count(*) filter (where u.st = 'vencido') as overdue, count(*) filter (where u.st = 'sem_registro') as missing,
           max(u.days) as worst_days,
           round(100.0 * count(*) filter (where u.st in ('em_dia', 'proximo')) / nullif(count(*) filter (where u.st in ('em_dia', 'proximo', 'vencido')), 0), 1) as adherence_pct
      from u group by 1)
  select jsonb_build_object(
    'kind', p_kind, 'reference_date', v_ref, 'as_of', v_as_of, 'is_latest', v_ref = v_latest,
    'parameters', jsonb_build_object('ok_days', case when v_cal then p.calibration_ok_days else p.measurement_ok_days end,
                                     'warning_days', case when v_cal then p.calibration_warning_days else p.measurement_warning_days end),
    'kpis', jsonb_build_object(
      'eligible', (select count(*) from u),
      'with_record', (select count(*) from u where u.st <> 'sem_registro'),
      'em_dia', (select count(*) from u where u.st = 'em_dia'),
      'proximo', (select count(*) from u where u.st = 'proximo'),
      'vencido', (select count(*) from u where u.st = 'vencido'),
      'sem_registro', (select count(*) from u where u.st = 'sem_registro'),
      'coverage_pct', (select round(100.0 * count(*) filter (where u.st <> 'sem_registro') / nullif(count(*), 0), 1) from u),
      'adherence_pct', (select round(100.0 * count(*) filter (where u.st in ('em_dia', 'proximo')) / nullif(count(*) filter (where u.st in ('em_dia', 'proximo', 'vencido')), 0), 1) from u),
      'psi_adequate', (select count(*) from u where u.psi_status = 'adequada'),
      'psi_low', (select count(*) from u where u.psi_status = 'baixa'),
      'psi_high', (select count(*) from u where u.psi_status = 'excesso'),
      'psi_no_rule', (select count(*) from u where u.psi_status = 'sem_parametro'),
      'psi_missing', (select count(*) from u where u.psi_status = 'sem_calibragem'),
      'pressure_adequate_pct', (select round(100.0 * count(*) filter (where u.psi_status = 'adequada') / nullif(count(*) filter (where u.psi_status in ('adequada', 'baixa', 'excesso')), 0), 1) from u),
      'tread_critical', (select count(*) from u where u.tread_class in ('abaixo_legal', 'critico')),
      'tread_attention', (select count(*) from u where u.tread_class = 'atencao')),
    'breakdowns', private.tire_breakdowns((select jsonb_agg(jsonb_build_object(
        'operation_id', u.operation_id, 'operation_name', u.operation_name, 'state_id', u.state_id, 'state_uf', u.state_uf,
        'city_id', u.city_id, 'city_name', u.city_name, 'operation_br_id', u.operation_br_id, 'br_code', u.br_code,
        'organization_unit_id', u.organization_unit_id, 'unit_name', u.unit_name, 'leader_employee_id', u.leader_employee_id,
        'leader_name', u.leader_name, 'vehicle_type_id', u.vehicle_type_id, 'vehicle_type_name', u.vehicle_type_name, 'st', u.st)) from u), 'st'),
    'ranking', coalesce((select jsonb_agg(to_jsonb(v) - 'k' order by v.worst_days desc nulls first, v.overdue desc)
                           from (select * from veh where veh.overdue > 0 or veh.missing > 0 order by veh.worst_days desc nulls first, veh.overdue desc limit 20) v), '[]'::jsonb),
    'gaps', case when v_cal then coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_id', g.vehicle_type_id, 'vehicle_type_name', g.vehicle_type_name,
                                   'dimension', g.dimension, 'dimension_key', g.dimension_key, 'position_code', g.position_code, 'tires', g.n) order by g.n desc)
                                   from (select u.vehicle_type_id, min(u.vehicle_type_name) as vehicle_type_name, min(u.dimension) as dimension, u.dimension_key,
                                                u.position_code, count(*) as n
                                           from u where u.psi_status = 'sem_parametro' group by u.vehicle_type_id, u.dimension_key, u.position_code) g), '[]'::jsonb)
                 else '[]'::jsonb end,
    'pending_total', (select count(*) from pend),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'tire_id', pend_o.tire_id, 'fire_number', pend_o.fire_number, 'position_code', pend_o.position_code, 'position_label', pend_o.position_label,
        'position_sort', pend_o.position_sort, 'vehicle_id', pend_o.vehicle_id, 'license_plate', pend_o.license_plate, 'fleet_number', pend_o.fleet_number,
        'operation_name', pend_o.operation_name, 'city_id', pend_o.city_id, 'city_name', pend_o.city_name, 'state_uf', pend_o.state_uf,
        'unit_name', pend_o.unit_name, 'leader_name', pend_o.leader_name, 'br_code', pend_o.br_code,
        'tread_min', pend_o.tread_min, 'tread_1', pend_o.tread_1, 'tread_2', pend_o.tread_2, 'tread_3', pend_o.tread_3, 'tread_4', pend_o.tread_4,
        'tread_class', pend_o.tread_class, 'psi', pend_o.psi, 'psi_min', pend_o.psi_min, 'psi_ideal', pend_o.psi_ideal, 'psi_max', pend_o.psi_max,
        'psi_status', pend_o.psi_status, 'last_date', pend_o.last_date, 'days', pend_o.days, 'status', pend_o.st, 'due_date', pend_o.due_date)
        order by pend_o.rn) from pend_o where pend_o.rn > v_offset and pend_o.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Cronograma por frota/placa e agenda de vencimentos (o pior pneu manda)
-- -----------------------------------------------------------------------------
create or replace function public.tires_schedule(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_window text default 'todos',
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_as_of  date;
  p        public.tire_parameter_sets;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.schedule.view');
  if v_latest is null then return jsonb_build_object('empty', true); end if;
  v_as_of := greatest(v_today, v_latest);
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_latest);

  with u as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  g as (
    select coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k, (array_agg(u.vehicle_id))[1] as vehicle_id,
           min(u.license_plate) as license_plate, min(u.fleet_number) as fleet_number, min(u.vehicle_type_name) as vehicle_type_name,
           min(u.operation_name) as operation_name, min(u.city_name) as city_name, min(u.state_uf) as state_uf,
           min(u.br_code) as br_code, min(u.leader_name) as leader_name, count(*) as tires,
           bool_or(u.measurement_date is null) as m_missing, min(u.measurement_date) as last_measurement,
           bool_or(u.calibration_date is null) as c_missing, min(u.calibration_date) as last_calibration,
           jsonb_agg(jsonb_build_object('tire_id', u.tire_id, 'fire_number', u.fire_number, 'position_code', u.position_code,
                                        'position_label', u.position_label, 'measurement_date', u.measurement_date,
                                        'measurement_status', u.measurement_status, 'calibration_date', u.calibration_date,
                                        'calibration_status', u.calibration_status) order by u.position_sort) as tire_rows
      from u group by 1),
  s as (
    select g.*,
           g.last_measurement + p.measurement_warning_days as next_measurement,
           g.last_calibration + p.calibration_warning_days as next_calibration,
           case when g.m_missing then 'sem_registro'
                when v_as_of - g.last_measurement <= p.measurement_ok_days then 'em_dia'
                when v_as_of - g.last_measurement <= p.measurement_warning_days then 'proximo' else 'vencido' end as measurement_status,
           case when g.c_missing then 'sem_registro'
                when v_as_of - g.last_calibration <= p.calibration_ok_days then 'em_dia'
                when v_as_of - g.last_calibration <= p.calibration_warning_days then 'proximo' else 'vencido' end as calibration_status
      from g),
  s2 as (
    select s.*, least(s.next_measurement, s.next_calibration) as next_due,
           case when 'vencido' in (s.measurement_status, s.calibration_status) then 0
                when 'sem_registro' in (s.measurement_status, s.calibration_status) then 1
                when 'proximo' in (s.measurement_status, s.calibration_status) then 2 else 3 end as worst
      from s),
  w as (
    select s2.* from s2
     where case coalesce(p_window, 'todos')
             when 'vencidos' then 'vencido' in (s2.measurement_status, s2.calibration_status)
             when 'proximos' then 'proximo' in (s2.measurement_status, s2.calibration_status)
             when 'sem_medicao' then s2.measurement_status = 'sem_registro'
             when 'sem_calibragem' then s2.calibration_status = 'sem_registro'
             when 'hoje' then s2.next_measurement = v_today or s2.next_calibration = v_today
             when '7d' then s2.next_measurement between v_today and v_today + 7 or s2.next_calibration between v_today and v_today + 7
             when '15d' then s2.next_measurement between v_today and v_today + 15 or s2.next_calibration between v_today and v_today + 15
             else true end),
  wo as (select w.*, row_number() over (order by w.worst, w.next_due nulls first, w.fleet_number) as rn from w)
  select jsonb_build_object(
    'reference_date', v_latest, 'as_of', v_as_of, 'today', v_today, 'window', coalesce(p_window, 'todos'),
    'parameters', jsonb_build_object('measurement_ok_days', p.measurement_ok_days, 'measurement_warning_days', p.measurement_warning_days,
                                     'calibration_ok_days', p.calibration_ok_days, 'calibration_warning_days', p.calibration_warning_days),
    'kpis', jsonb_build_object(
      'units', (select count(*) from s2),
      'measurement_overdue', (select count(*) from s2 where s2.measurement_status = 'vencido'),
      'measurement_due_soon', (select count(*) from s2 where s2.measurement_status = 'proximo'),
      'measurement_missing', (select count(*) from s2 where s2.measurement_status = 'sem_registro'),
      'calibration_overdue', (select count(*) from s2 where s2.calibration_status = 'vencido'),
      'calibration_due_soon', (select count(*) from s2 where s2.calibration_status = 'proximo'),
      'calibration_missing', (select count(*) from s2 where s2.calibration_status = 'sem_registro')),
    'agenda', jsonb_build_object(
      'vencidos', (select count(*) from s2 where 'vencido' in (s2.measurement_status, s2.calibration_status)),
      'hoje', (select count(*) from s2 where s2.next_measurement = v_today or s2.next_calibration = v_today),
      'proximos_7', (select count(*) from s2 where s2.next_measurement between v_today and v_today + 7 or s2.next_calibration between v_today and v_today + 7),
      'proximos_15', (select count(*) from s2 where s2.next_measurement between v_today and v_today + 15 or s2.next_calibration between v_today and v_today + 15),
      'sem_medicao', (select count(*) from s2 where s2.measurement_status = 'sem_registro'),
      'sem_calibragem', (select count(*) from s2 where s2.calibration_status = 'sem_registro')),
    'total', (select count(*) from wo),
    'rows', coalesce((select jsonb_agg(to_jsonb(wo) - 'k' - 'rn' - 'm_missing' - 'c_missing' order by wo.rn)
                        from wo where wo.rn > v_offset and wo.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Qualidade de dados (relatório Rodopar + lacunas de configuração)
-- -----------------------------------------------------------------------------
create or replace function public.tires_quality(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_issue text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f         jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_latest  date := private.tire_latest_reference(p_organization_id);
  v_as_of   date;
  v_last    public.tire_import_batches;
  v_res     jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.quality.view');
  if v_latest is null then return jsonb_build_object('empty', true); end if;
  v_as_of := greatest(private.maintenance_today(p_organization_id), v_latest);
  f := f || jsonb_build_object('reference_date', v_latest);
  select * into v_last from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status in ('confirmed', 'blocked', 'validated')
   order by b.created_at desc limit 1;

  with r as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of)),
  lay as (
    select v.vehicle_id, l.layout_source, l.position_codes
      from (select distinct r.vehicle_id from r where r.vehicle_id is not null and r.canonical_status = 'em_uso') v
      cross join lateral private.tire_vehicle_layout(p_organization_id, v.vehicle_id, v_latest) l),
  issues as (
    -- inconsistências gravadas pela importação (o valor bruto está no pneu)
    select r.tire_id, r.fire_number, r.vehicle_id, r.license_plate, r.fleet_number, r.position_code, x.code, null::text as detail
      from r cross join lateral unnest(r.quality_flags) x(code)
    union all
    select r.tire_id, r.fire_number, r.vehicle_id, r.license_plate, r.fleet_number, r.position_code, 'sem_medicao', null
      from r where r.canonical_status = 'em_uso' and r.measurement_date is null
    union all
    select r.tire_id, r.fire_number, r.vehicle_id, r.license_plate, r.fleet_number, r.position_code, 'sem_calibragem', null
      from r where r.canonical_status = 'em_uso' and r.calibration_date is null
    union all
    select r.tire_id, r.fire_number, r.vehicle_id, r.license_plate, r.fleet_number, r.position_code, 'sem_parametro_psi', r.dimension
      from r where r.canonical_status = 'em_uso' and r.pressure_rule_id is null
    union all
    select r.tire_id, r.fire_number, r.vehicle_id, r.license_plate, r.fleet_number, r.position_code, 'posicao_fora_layout',
           array_to_string(lay.position_codes, ', ')
      from r join lay on lay.vehicle_id = r.vehicle_id
     where r.canonical_status = 'em_uso' and lay.layout_source <> 'snapshot' and r.position_code is not null
       and not (r.position_code = any (lay.position_codes))
    union all
    select null::uuid, null::text, lay.vehicle_id, (select min(r.license_plate) from r where r.vehicle_id = lay.vehicle_id),
           (select min(r.fleet_number) from r where r.vehicle_id = lay.vehicle_id), pc, 'posicao_layout_vazia', null
      from lay cross join lateral unnest(lay.position_codes) pc
     where lay.layout_source <> 'snapshot'
       and not exists (select 1 from r where r.vehicle_id = lay.vehicle_id and r.canonical_status = 'em_uso' and r.position_code = pc)
    union all
    select t.id, t.fire_number, t.current_vehicle_id, null, null, t.current_position_code, 'ausente_ultima_importacao',
           to_char(t.absent_since, 'YYYY-MM-DD')
      from public.tires t
     where t.organization_id = p_organization_id and t.presence_status = 'absent'
       and private.tire_vehicle_visible(t.organization_id, t.current_vehicle_id)),
  counts as (select i.code, count(*) as n, count(distinct i.tire_id) as tires from issues i group by i.code),
  sel as (
    select i.*, row_number() over (order by i.fleet_number nulls last, i.position_code, i.fire_number) as rn
      from issues i where p_issue is not null and i.code = p_issue)
  select jsonb_build_object(
    'reference_date', v_latest, 'as_of', v_as_of,
    'total_tires', (select count(*) from r),
    'tires_with_rodopar_issue', (select count(*) from r where cardinality(r.quality_flags) > 0),
    'quality_score', (select round(100.0 * count(*) filter (where cardinality(r.quality_flags) = 0) / nullif(count(*), 0), 1) from r),
    'issues', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'count', c.n, 'tires', c.tires) order by c.n desc) from counts c), '[]'::jsonb),
    'last_batch', case when v_last.id is null then null else jsonb_build_object(
        'id', v_last.id, 'status', v_last.status, 'file_name', v_last.file_name, 'reference_date', v_last.reference_date,
        'error_rows', v_last.error_rows, 'warning_rows', v_last.warning_rows, 'total_rows', v_last.total_rows,
        'counters', v_last.counters, 'block_reason', v_last.block_reason, 'created_at', v_last.created_at) end,
    'issue', p_issue,
    'issue_total', (select count(*) from sel),
    'rows', coalesce((select jsonb_agg(to_jsonb(sel) - 'rn' order by sel.rn) from sel where sel.rn > v_offset and sel.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Histórico: movimentações e eventos (paginado)
-- -----------------------------------------------------------------------------
create or replace function public.tires_events_list(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  f_types  text[] := private.jsonb_text_array(f -> 'event_types');
  f_from   date := nullif(f ->> 'date_from', '')::date;
  f_to     date := nullif(f ->> 'date_to', '')::date;
  f_search text := nullif(btrim(f ->> 'search'), '');
  f_veh    uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.history.view');
  with e as (
    select ev.*, t.fire_number,
           coalesce(v.license_plate, ev.current_values ->> 'license_plate') as license_plate,
           coalesce(pv.license_plate, ev.previous_values ->> 'license_plate') as previous_license_plate,
           coalesce(ev.current_values ->> 'fleet_number', v.fleet_code) as fleet_number,
           coalesce(ev.previous_values ->> 'fleet_number', pv.fleet_code) as previous_fleet_number
      from public.tire_events ev
      join public.tires t on t.id = ev.tire_id
      left join public.vehicles v on v.id = ev.vehicle_id
      left join public.vehicles pv on pv.id = ev.previous_vehicle_id
     where ev.organization_id = p_organization_id
       and (private.tire_vehicle_visible(ev.organization_id, coalesce(ev.vehicle_id, ev.previous_vehicle_id, t.current_vehicle_id)))
       and (f_types is null or cardinality(f_types) = 0 or ev.event_type = any (f_types))
       and (f_from is null or ev.reference_date >= f_from)
       and (f_to is null or ev.reference_date <= f_to)
       and (f_veh is null or cardinality(f_veh) = 0 or ev.vehicle_id = any (f_veh) or ev.previous_vehicle_id = any (f_veh))
       and (f_search is null or t.fire_number like '%' || upper(f_search) || '%'
            or coalesce(v.license_plate, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
            or coalesce(pv.license_plate, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
            or upper(coalesce(v.fleet_code, '')) like '%' || upper(f_search) || '%')),
  o as (select e.*, row_number() over (order by e.reference_date desc, e.occurred_at desc, e.fire_number) as rn from e)
  select jsonb_build_object(
    'total', (select count(*) from o),
    'counts', coalesce((select jsonb_object_agg(x.event_type, x.n) from (select o.event_type, count(*) as n from o group by 1) x), '{}'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'tire_id', o.tire_id, 'fire_number', o.fire_number, 'event_type', o.event_type, 'reference_date', o.reference_date,
        'occurred_at', o.occurred_at, 'vehicle_id', o.vehicle_id, 'license_plate', o.license_plate, 'fleet_number', o.fleet_number,
        'previous_vehicle_id', o.previous_vehicle_id, 'previous_license_plate', o.previous_license_plate,
        'previous_fleet_number', o.previous_fleet_number, 'position_code', o.position_code,
        'previous_position_code', o.previous_position_code, 'previous', o.previous_values, 'current', o.current_values,
        'source', o.source, 'import_batch_id', o.import_batch_id) order by o.rn)
        from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Resumo do veículo (aba Pneus da ficha da frota)
-- -----------------------------------------------------------------------------
create or replace function public.tires_vehicle_summary(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_latest date;
  v_rows   jsonb;
  v_layout jsonb;
begin
  select v.organization_id into v_org from public.vehicles v where v.id = p_vehicle_id;
  if v_org is null then return null; end if;
  perform private.tire_require(v_org, 'tires.view');
  if not private.tire_vehicle_visible(v_org, p_vehicle_id)
     and not exists (select 1 from public.tire_daily_snapshots s where s.vehicle_id = p_vehicle_id
                       and s.operation_id in (select private.accessible_operation_ids())) then
    return null;
  end if;
  v_latest := private.tire_latest_reference(v_org);
  if v_latest is null then return jsonb_build_object('empty', true); end if;
  select coalesce(jsonb_agg(to_jsonb(x) - 'as_of' order by x.position_sort, x.position_code), '[]'::jsonb) into v_rows
    from private.tire_rows(v_org, jsonb_build_object('reference_date', v_latest, 'vehicle_ids', jsonb_build_array(p_vehicle_id)),
                           greatest(private.maintenance_today(v_org), v_latest)) x;
  select to_jsonb(l) into v_layout from private.tire_vehicle_layout(v_org, p_vehicle_id, v_latest) l;
  return jsonb_build_object(
    'empty', false, 'organization_id', v_org, 'reference_date', v_latest, 'layout', v_layout, 'tires', v_rows,
    'positions', coalesce((select jsonb_agg(jsonb_build_object('code', pos.code, 'label', pos.label, 'axle_group', pos.axle_group,
                              'axle_index', pos.axle_index, 'side', pos.side, 'slot', pos.slot, 'sort_order', pos.sort_order) order by pos.sort_order)
                            from public.tire_positions pos where pos.organization_id = v_org and pos.is_active
                             and (pos.code = any (coalesce(array(select jsonb_array_elements_text(v_layout -> 'position_codes')), '{}'))
                                  or pos.code in (select x ->> 'position_code' from jsonb_array_elements(v_rows) x))), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'protocol', i.protocol, 'status', i.status,
                                'inspection_date', i.inspection_date, 'positions_measured', i.positions_measured,
                                'positions_divergent', i.positions_divergent) order by i.submitted_at desc)
                               from (select * from public.tire_inspections i where i.vehicle_id = p_vehicle_id order by i.submitted_at desc limit 5) i), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Cadastros (Parâmetros): leitura completa para os formulários
-- -----------------------------------------------------------------------------
create or replace function public.tires_catalog(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  return jsonb_build_object(
    'today', v_today,
    'latest_reference_date', v_latest,
    'parameters', to_jsonb(private.tire_params_at(p_organization_id, v_today)),
    'parameter_history', coalesce((select jsonb_agg(to_jsonb(p) order by p.effective_from desc)
                                     from public.tire_parameter_sets p where p.organization_id = p_organization_id), '[]'::jsonb),
    'pressure_rules', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('vehicle_type_name', vt.name) order by r.is_active desc, r.dimension_key nulls last, r.position_code nulls last)
                                  from public.tire_pressure_rules r left join public.vehicle_types vt on vt.id = r.vehicle_type_id
                                 where r.organization_id = p_organization_id), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(to_jsonb(pos) order by pos.sort_order, pos.code)
                             from public.tire_positions pos where pos.organization_id = p_organization_id), '[]'::jsonb),
    'layouts', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
                             'vehicle_types', coalesce((select jsonb_agg(jsonb_build_object('id', vt.id, 'name', vt.name) order by vt.name)
                                                          from public.tire_vehicle_type_layouts tl join public.vehicle_types vt on vt.id = tl.vehicle_type_id
                                                         where tl.organization_id = p_organization_id and tl.layout_id = l.id), '[]'::jsonb),
                             'vehicles', (select count(*) from public.tire_vehicle_layouts vl where vl.organization_id = p_organization_id and vl.layout_id = l.id))
                             order by l.code)
                           from public.tire_layouts l where l.organization_id = p_organization_id), '[]'::jsonb),
    'vehicle_type_layouts', coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_id', vt.id, 'vehicle_type_name', vt.name,
                                        'layout_id', tl.layout_id) order by vt.name)
                                        from public.vehicle_types vt
                                        left join public.tire_vehicle_type_layouts tl on tl.organization_id = p_organization_id and tl.vehicle_type_id = vt.id
                                       where (vt.organization_id = p_organization_id or vt.organization_id is null)
                                         and exists (select 1 from public.vehicles v where v.organization_id = p_organization_id and v.vehicle_type_id = vt.id)), '[]'::jsonb),
    'vehicle_layouts', coalesce((select jsonb_agg(jsonb_build_object('vehicle_id', vl.vehicle_id, 'license_plate', v.license_plate,
                                   'fleet_code', v.fleet_code, 'layout_id', vl.layout_id, 'reason', vl.reason, 'updated_at', vl.updated_at) order by v.fleet_code)
                                   from public.tire_vehicle_layouts vl join public.vehicles v on v.id = vl.vehicle_id
                                  where vl.organization_id = p_organization_id), '[]'::jsonb),
    'service_kinds', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'service_name', s.name, 'cluster_name', c.name,
                                 'kind', k.kind, 'is_active', k.is_active) order by c.name, s.name)
                                 from public.tire_maintenance_service_kinds k
                                 join public.maintenance_services s on s.id = k.service_id
                                 left join public.maintenance_clusters c on c.id = s.cluster_id
                                where k.organization_id = p_organization_id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'cluster_name', c.name) order by c.name, s.name)
                            from public.maintenance_services s left join public.maintenance_clusters c on c.id = s.cluster_id
                           where s.organization_id = p_organization_id and s.deleted_at is null and s.status = 'active'), '[]'::jsonb),
    'vehicle_types', coalesce((select jsonb_agg(jsonb_build_object('id', vt.id, 'name', vt.name) order by vt.name)
                                 from public.vehicle_types vt
                                where (vt.organization_id = p_organization_id or vt.organization_id is null)
                                  and exists (select 1 from public.vehicles v where v.organization_id = p_organization_id and v.vehicle_type_id = vt.id)), '[]'::jsonb),
    'observed_dimensions', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'tires', x.n) order by x.n desc)
                                       from (select s.dimension_key as k, min(s.dimension) as l, count(*) as n from public.tire_daily_snapshots s
                                              where s.organization_id = p_organization_id and s.reference_date = v_latest and s.dimension_key is not null
                                              group by s.dimension_key) x), '[]'::jsonb),
    'observed_positions', coalesce((select jsonb_agg(jsonb_build_object('code', x.k, 'tires', x.n) order by x.k)
                                      from (select s.position_code as k, count(*) as n from public.tire_daily_snapshots s
                                             where s.organization_id = p_organization_id and s.reference_date = v_latest and s.position_code is not null
                                             group by s.position_code) x), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_require(uuid, text), private.tire_params_at(uuid, date), private.tire_latest_reference(uuid),
  private.tire_actor_name(uuid), private.tire_audit(uuid, text, text, uuid, text, jsonb, jsonb),
  private.tire_vehicle_layout(uuid, uuid, date), private.tire_rows(uuid, jsonb, date), private.tire_breakdowns(jsonb, text) from public, anon;
grant execute on function private.tire_require(uuid, text), private.tire_params_at(uuid, date), private.tire_latest_reference(uuid),
  private.tire_actor_name(uuid), private.tire_audit(uuid, text, text, uuid, text, jsonb, jsonb),
  private.tire_vehicle_layout(uuid, uuid, date), private.tire_rows(uuid, jsonb, date), private.tire_breakdowns(jsonb, text) to authenticated, service_role;

revoke execute on function public.tires_filter_options(uuid, date), public.tires_overview(uuid, jsonb),
  public.tires_base(uuid, jsonb, text, text, text, integer, integer), public.tire_sheet(uuid, uuid),
  public.tires_adherence(uuid, text, jsonb, text, integer, integer), public.tires_schedule(uuid, jsonb, text, integer, integer),
  public.tires_quality(uuid, jsonb, text, integer, integer), public.tires_events_list(uuid, jsonb, integer, integer),
  public.tires_vehicle_summary(uuid), public.tires_catalog(uuid) from public, anon;
grant execute on function public.tires_filter_options(uuid, date), public.tires_overview(uuid, jsonb),
  public.tires_base(uuid, jsonb, text, text, text, integer, integer), public.tire_sheet(uuid, uuid),
  public.tires_adherence(uuid, text, jsonb, text, integer, integer), public.tires_schedule(uuid, jsonb, text, integer, integer),
  public.tires_quality(uuid, jsonb, text, integer, integer), public.tires_events_list(uuid, jsonb, integer, integer),
  public.tires_vehicle_summary(uuid), public.tires_catalog(uuid) to authenticated, service_role;
