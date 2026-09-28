-- =============================================================================
-- Etapa 16 — Manutenção: preventiva, preditiva, visão geral e rotina diária
--
-- Preventiva: parâmetros por tipo de equipamento (id oficial), ciclos MP1..MPn
-- materializados por veículo, situação calculada na leitura com o KM oficial
-- (nunca gravada, nunca velha) e geração idempotente da manutenção do ciclo.
--
-- Preditiva: plano técnico versionado (itens por cluster, intervalos em KM e/ou
-- dias, bandas de alerta/programação/tolerância), ciclo por veículo × item com
-- referência técnica rastreável, status técnico separado do status de
-- execução, verificações formais com decisão registrada e cobertura por
-- serviço.
--
-- As regras de situação ficam em UMA função cada
-- (private.maintenance_preventive_state e private.maintenance_predictive_state);
-- matriz, painel, alertas, visão geral e ficha do veículo leem delas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Preventiva — regra aplicável, sincronização dos ciclos, situação
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_preventive_rule_for(p_vehicle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
    from public.vehicles v
    join public.maintenance_preventive_rules r
      on r.organization_id = v.organization_id and r.vehicle_type_id = v.vehicle_type_id
   where v.id = p_vehicle_id
     and r.deleted_at is null and r.status = 'active'
     and (r.vehicle_subcategory_id is null or r.vehicle_subcategory_id = v.vehicle_subcategory_id)
     and (r.vehicle_model_id is null or r.vehicle_model_id = v.vehicle_model_id)
   order by (r.vehicle_model_id is not null) desc, (r.vehicle_subcategory_id is not null) desc, r.created_at
   limit 1;
$$;
comment on function private.maintenance_preventive_rule_for(uuid) is
  'Regra preventiva do veículo: a mais específica ativa (modelo > subcategoria > tipo de equipamento).';

-- Gera/ajusta MP1..MPn. Ciclo realizado é histórico e não muda; ciclo ainda
-- aberto acompanha a regra vigente. Nada é apagado se tiver manutenção ligada.
create or replace function private.maintenance_sync_preventive_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_rule    public.maintenance_preventive_rules;
  v_created integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  select * into v_rule from public.maintenance_preventive_rules
   where id = private.maintenance_preventive_rule_for(p_vehicle_id);
  if v_rule.id is null then
    return jsonb_build_object('rule_id', null, 'created', 0, 'updated', 0, 'removed', 0);
  end if;

  with wanted as (
    select n::smallint as cycle_number, v_rule.initial_km + n * v_rule.interval_km as milestone_km
      from generate_series(1, v_rule.cycle_count) n
  ), ins as (
    insert into public.maintenance_preventive_cycles
      (organization_id, vehicle_id, rule_id, cycle_number, milestone_km, interval_km, alert_before_pct, tolerance_after_pct)
    select v_org, p_vehicle_id, v_rule.id, w.cycle_number, w.milestone_km, v_rule.interval_km,
           v_rule.alert_before_pct, v_rule.tolerance_after_pct
      from wanted w
    on conflict (vehicle_id, cycle_number) do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  update public.maintenance_preventive_cycles c set
    rule_id = v_rule.id,
    milestone_km = v_rule.initial_km + c.cycle_number * v_rule.interval_km,
    interval_km = v_rule.interval_km,
    alert_before_pct = v_rule.alert_before_pct,
    tolerance_after_pct = v_rule.tolerance_after_pct
   where c.vehicle_id = p_vehicle_id and c.completed_on is null and c.cycle_number <= v_rule.cycle_count
     and (c.rule_id, c.milestone_km, c.interval_km, c.alert_before_pct, c.tolerance_after_pct)
         is distinct from (v_rule.id, v_rule.initial_km + c.cycle_number * v_rule.interval_km, v_rule.interval_km,
                           v_rule.alert_before_pct, v_rule.tolerance_after_pct);
  get diagnostics v_updated = row_count;

  -- A regra encolheu: sobras ainda abertas e sem manutenção saem.
  delete from public.maintenance_preventive_cycles c
   where c.vehicle_id = p_vehicle_id and c.completed_on is null and c.cycle_number > v_rule.cycle_count
     and not exists (select 1 from public.maintenances m where m.preventive_cycle_id = c.id);
  get diagnostics v_removed = row_count;

  return jsonb_build_object('rule_id', v_rule.id, 'created', v_created, 'updated', v_updated, 'removed', v_removed);
end;
$$;

-- Situação de um ciclo (a regra central da preventiva):
--   alerta = intervalo × alerta%   ·   tolerância = intervalo × tolerância%
--   realizado                                  → completed   (Realizada)
--   sem KM oficial                             → no_km
--   km < marco − alerta                        → not_reached (Não atingida)
--   marco − alerta ≤ km ≤ marco                → to_schedule (A programar)
--   marco < km ≤ marco + tolerância            → due         (Vencida)
--   km > marco + tolerância                    → critical    (Crítica)
-- (mesmas fronteiras do HFC; ciclos anteriores não realizados continuam
-- valendo por conta própria — um MP pulado aparece como Crítica.)
create or replace function private.maintenance_preventive_status(
  p_milestone integer, p_interval integer, p_alert_pct numeric, p_tolerance_pct numeric, p_km integer, p_completed boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_completed then 'completed'
           when p_km is null then 'no_km'
           when p_km < p_milestone - p_interval * p_alert_pct / 100.0 then 'not_reached'
           when p_km <= p_milestone then 'to_schedule'
           when p_km <= p_milestone + p_interval * p_tolerance_pct / 100.0 then 'due'
           else 'critical'
         end;
$$;

-- Aderência da execução ao marco: antecipada, no prazo ou atrasada.
create or replace function private.maintenance_preventive_adherence(
  p_milestone integer, p_interval integer, p_alert_pct numeric, p_tolerance_pct numeric, p_done_km integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_done_km is null then null
           when p_done_km < p_milestone - p_interval * p_alert_pct / 100.0 then 'early'
           when p_done_km <= p_milestone + p_interval * p_tolerance_pct / 100.0 then 'on_time'
           else 'late'
         end;
$$;

-- Estado de todos os ciclos da organização (escopo do usuário), com o KM oficial.
create or replace function private.maintenance_preventive_state(p_organization_id uuid)
returns table (
  cycle_id uuid, vehicle_id uuid, rule_id uuid, cycle_number smallint, milestone_km integer, interval_km integer,
  alert_before_pct numeric, tolerance_after_pct numeric, current_km integer, current_km_date date,
  status text, km_remaining integer, km_exceeded integer, completed_on date, completed_km integer,
  completed_maintenance_id uuid, adherence_km integer, adherence_pct numeric, adherence text,
  open_maintenance_id uuid, open_maintenance_code text, open_maintenance_status text, vehicle_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with km as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_km, r.reading_date
      from public.vehicle_odometer_readings r
     where r.organization_id = p_organization_id and r.superseded_by is null
     order by r.vehicle_id, r.reading_date desc, r.created_at desc
  )
  select c.id, c.vehicle_id, c.rule_id, c.cycle_number, c.milestone_km, c.interval_km,
         c.alert_before_pct, c.tolerance_after_pct, km.odometer_km, km.reading_date,
         private.maintenance_preventive_status(c.milestone_km, c.interval_km, c.alert_before_pct, c.tolerance_after_pct,
                                               km.odometer_km, c.completed_on is not null),
         case when c.completed_on is null and km.odometer_km is not null and km.odometer_km < c.milestone_km
              then c.milestone_km - km.odometer_km end,
         case when c.completed_on is null and km.odometer_km is not null and km.odometer_km > c.milestone_km
              then km.odometer_km - c.milestone_km end,
         c.completed_on, c.completed_km, c.completed_maintenance_id,
         c.completed_km - c.milestone_km,
         case when c.completed_km is not null then round((c.completed_km - c.milestone_km) * 100.0 / c.interval_km, 1) end,
         private.maintenance_preventive_adherence(c.milestone_km, c.interval_km, c.alert_before_pct, c.tolerance_after_pct, c.completed_km),
         om.id, om.code, om.status,
         (v.status = 'active' and v.deleted_at is null)
    from public.maintenance_preventive_cycles c
    join public.vehicles v on v.id = c.vehicle_id
    left join km on km.vehicle_id = c.vehicle_id
    left join lateral (
      select m.id, m.code, m.status from public.maintenances m
       where m.preventive_cycle_id = c.id and m.status in ('to_schedule', 'scheduled', 'in_progress')
       limit 1) om on true
   where c.organization_id = p_organization_id
     and private.has_permission(p_organization_id, 'maintenance.view')
     and private.vehicle_in_scope(p_organization_id, c.vehicle_id);
$$;

-- -----------------------------------------------------------------------------
-- 2. Preventiva — parâmetros (RPC) e sincronização
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_save_preventive_rule(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_type    uuid := nullif(p_payload ->> 'vehicle_type_id', '')::uuid;
  v_sub     uuid := nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid;
  v_model   uuid := nullif(p_payload ->> 'vehicle_model_id', '')::uuid;
  v_service uuid := nullif(p_payload ->> 'service_id', '')::uuid;
  v_vehicle uuid;
  v_synced  integer := 0;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_parameters');
  if v_type is null or not exists (select 1 from public.vehicle_types t where t.id = v_type
                                     and (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null) then
    raise exception 'Selecione o tipo de equipamento.' using errcode = 'invalid_parameter_value';
  end if;
  if v_service is not null and not exists (select 1 from public.maintenance_services s where s.id = v_service
                                             and s.organization_id = p_organization_id and s.deleted_at is null and s.status = 'active') then
    raise exception 'Serviço da preventiva inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(nullif(p_payload ->> 'interval_km', '')::integer, 0) < 100 then
    raise exception 'Informe o intervalo de KM (mínimo 100).' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is not null then
    update public.maintenance_preventive_rules set
      vehicle_type_id = v_type, vehicle_subcategory_id = v_sub, vehicle_model_id = v_model, service_id = v_service,
      interval_km = (p_payload ->> 'interval_km')::integer,
      initial_km = coalesce(nullif(p_payload ->> 'initial_km', '')::integer, 0),
      cycle_count = coalesce(nullif(p_payload ->> 'cycle_count', '')::smallint, 20),
      alert_before_pct = coalesce(nullif(p_payload ->> 'alert_before_pct', '')::numeric, 5),
      tolerance_after_pct = coalesce(nullif(p_payload ->> 'tolerance_after_pct', '')::numeric, 5),
      criticality = coalesce(nullif(p_payload ->> 'criticality', ''), criticality),
      status = coalesce(nullif(p_payload ->> 'status', ''), status),
      notes = nullif(btrim(p_payload ->> 'notes'), '')
    where id = v_id and organization_id = p_organization_id and deleted_at is null;
    if not found then
      raise exception 'Parâmetro não encontrado.' using errcode = 'no_data_found';
    end if;
  else
    insert into public.maintenance_preventive_rules
      (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, service_id, interval_km, initial_km,
       cycle_count, alert_before_pct, tolerance_after_pct, criticality, status, notes)
    values
      (p_organization_id, v_type, v_sub, v_model, v_service, (p_payload ->> 'interval_km')::integer,
       coalesce(nullif(p_payload ->> 'initial_km', '')::integer, 0),
       coalesce(nullif(p_payload ->> 'cycle_count', '')::smallint, 20),
       coalesce(nullif(p_payload ->> 'alert_before_pct', '')::numeric, 5),
       coalesce(nullif(p_payload ->> 'tolerance_after_pct', '')::numeric, 5),
       coalesce(nullif(p_payload ->> 'criticality', ''), 'medium'),
       coalesce(nullif(p_payload ->> 'status', ''), 'active'), nullif(btrim(p_payload ->> 'notes'), ''))
    returning id into v_id;
  end if;

  -- Salvar o parâmetro reprocessa os ciclos dos veículos do tipo (no HFC isso
  -- dependia de um "Recalcular" manual).
  for v_vehicle in
    select v.id from public.vehicles v
     where v.organization_id = p_organization_id and v.vehicle_type_id = v_type and v.deleted_at is null
  loop
    perform private.maintenance_sync_preventive_vehicle(v_vehicle);
    v_synced := v_synced + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'vehicles_synced', v_synced);
exception
  when unique_violation then
    raise exception 'Já existe um parâmetro para este tipo/subcategoria/modelo.' using errcode = 'unique_violation';
end;
$$;

create or replace function public.maintenance_archive_preventive_rule(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.maintenance_preventive_rules;
begin
  select * into v_rule from public.maintenance_preventive_rules where id = p_rule_id for update;
  if v_rule.id is null then
    raise exception 'Parâmetro não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_rule.organization_id, 'maintenance.manage_parameters');
  -- Arquivar mantém os ciclos (histórico); só deixa de gerar novos.
  update public.maintenance_preventive_rules set status = 'inactive', deleted_at = now(), deleted_by = auth.uid()
   where id = p_rule_id;
end;
$$;

create or replace function public.maintenance_sync_preventive(p_organization_id uuid, p_vehicle_id uuid default null)
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
begin
  if not (private.has_permission(p_organization_id, 'maintenance.manage_preventive')
          or private.has_permission(p_organization_id, 'maintenance.reprocess')) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;
  for v_vehicle in
    select v.id from public.vehicles v
     where v.organization_id = p_organization_id and v.deleted_at is null and v.status = 'active'
       and (p_vehicle_id is null or v.id = p_vehicle_id)
  loop
    v_res := private.maintenance_sync_preventive_vehicle(v_vehicle);
    v_count := v_count + 1;
    if v_res ->> 'rule_id' is not null then
      v_with := v_with + 1;
    end if;
  end loop;
  return jsonb_build_object('vehicles', v_count, 'with_rule', v_with, 'without_rule', v_count - v_with);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Preventiva — matriz / painel (uma leitura só)
-- -----------------------------------------------------------------------------
-- p_filters: situation (active|inactive), search, vehicle_type_ids[], model_ids[],
--            operation_ids[], city_ids[], br_ids[], statuses[]
create or replace function public.maintenance_preventive_matrix(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today    date;
  v_active   boolean := coalesce(nullif(p_filters ->> 'situation', ''), 'active') = 'active';
  v_search   text := nullif(btrim(p_filters ->> 'search'), '');
  v_types    uuid[] := private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids');
  v_models   uuid[] := private.jsonb_uuid_array(p_filters -> 'model_ids');
  v_ops      uuid[] := private.jsonb_uuid_array(p_filters -> 'operation_ids');
  v_cities   integer[] := private.jsonb_int_array(p_filters -> 'city_ids');
  v_brs      uuid[] := private.jsonb_uuid_array(p_filters -> 'br_ids');
  v_statuses text[] := private.jsonb_text_array(p_filters -> 'statuses');
  v_rows     jsonb;
  v_summary  jsonb;
begin
  if not private.has_permission(p_organization_id, 'maintenance.view') then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
  v_today := private.maintenance_today(p_organization_id);

  with st as (select * from private.maintenance_preventive_state(p_organization_id)),
  plan as (select * from private.adherence_planned_fleet(p_organization_id, v_today, null, null)),
  km as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_km, r.reading_date
      from public.vehicle_odometer_readings r
     where r.organization_id = p_organization_id and r.superseded_by is null
     order by r.vehicle_id, r.reading_date desc, r.created_at desc
  ),
  veh as (
    select v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_model_id, v.status, v.deleted_at,
           vt.name as type_name, sc.name as subcategory_name, vm.name as model_name,
           p.operation_id, p.city_id, p.operation_br_id,
           (select o.name from public.operations o where o.id = p.operation_id) as operation_name,
           (select c.name from public.cities c where c.id = p.city_id) as city_name,
           (select b.code from public.operation_brs b where b.id = p.operation_br_id) as br_code,
           km.odometer_km, km.reading_date,
           private.maintenance_preventive_rule_for(v.id) as rule_id
      from public.vehicles v
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
      left join public.vehicle_subcategories sc on sc.id = v.vehicle_subcategory_id
      left join public.vehicle_models vm on vm.id = v.vehicle_model_id
      left join plan p on p.vehicle_id = v.id
      left join km on km.vehicle_id = v.id
     where v.organization_id = p_organization_id
       and ((v_active and v.status = 'active' and v.deleted_at is null) or (not v_active and (v.status <> 'active' or v.deleted_at is not null)))
       and private.vehicle_in_scope(p_organization_id, v.id)
       and (v_search is null or v.license_plate ilike '%' || private.normalize_plate(v_search) || '%'
            or coalesce(v.fleet_code, '') ilike '%' || v_search || '%')
       and (v_types is null or v.vehicle_type_id = any (v_types))
       and (v_models is null or v.vehicle_model_id = any (v_models))
       and (v_ops is null or p.operation_id = any (v_ops))
       and (v_cities is null or p.city_id = any (v_cities))
       and (v_brs is null or p.operation_br_id = any (v_brs))
       -- Inativa só entra se tiver histórico preventivo.
       and (v_active or exists (select 1 from public.maintenance_preventive_cycles c where c.vehicle_id = v.id))
  ),
  rows as (
    select veh.*,
           (select coalesce(jsonb_agg(jsonb_build_object(
               'id', st.cycle_id, 'number', st.cycle_number, 'milestone_km', st.milestone_km,
               'status', st.status, 'km_remaining', st.km_remaining, 'km_exceeded', st.km_exceeded,
               'completed_on', st.completed_on, 'completed_km', st.completed_km,
               'completed_maintenance_id', st.completed_maintenance_id,
               'adherence_km', st.adherence_km, 'adherence_pct', st.adherence_pct, 'adherence', st.adherence,
               'open_maintenance', case when st.open_maintenance_id is not null then jsonb_build_object(
                   'id', st.open_maintenance_id, 'code', st.open_maintenance_code, 'status', st.open_maintenance_status) end)
               order by st.cycle_number), '[]'::jsonb)
              from st where st.vehicle_id = veh.id) as cycles
      from veh
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vehicle_id', r.id, 'license_plate', r.license_plate, 'fleet_code', r.fleet_code,
           'vehicle_status', r.status, 'type_name', r.type_name, 'subcategory_name', r.subcategory_name,
           'model_name', r.model_name, 'operation_id', r.operation_id, 'operation_name', r.operation_name,
           'city_name', r.city_name, 'br_code', r.br_code, 'current_km', r.odometer_km, 'current_km_date', r.reading_date,
           'has_rule', r.rule_id is not null,
           'diagnostics', to_jsonb(array_remove(array[
               case when r.rule_id is null then 'no_rule' end,
               case when r.odometer_km is null then 'no_km' end,
               case when jsonb_array_length(r.cycles) = 0 then 'no_cycles' end], null)),
           'cycles', r.cycles) order by r.license_plate), '[]'::jsonb)
    into v_rows
    from rows r
   where v_statuses is null
      or exists (select 1 from jsonb_array_elements(r.cycles) c where c ->> 'status' = any (v_statuses));

  select jsonb_build_object(
           'vehicles', jsonb_array_length(v_rows),
           'no_rule', count(*) filter (where not (r ->> 'has_rule')::boolean),
           'no_km',   count(*) filter (where r ->> 'current_km' is null),
           'critical',    (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c ->> 'status' = 'critical'),
           'due',         (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c ->> 'status' = 'due'),
           'to_schedule', (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c ->> 'status' = 'to_schedule'),
           'not_reached', (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c ->> 'status' = 'not_reached'),
           'completed',   (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c ->> 'status' = 'completed'),
           'programmed',  (select count(*) from jsonb_array_elements(v_rows) x, jsonb_array_elements(x -> 'cycles') c where c -> 'open_maintenance' is not null and c -> 'open_maintenance' <> 'null'::jsonb))
    into v_summary
    from jsonb_array_elements(v_rows) r;

  return jsonb_build_object('today', v_today, 'situation', case when v_active then 'active' else 'inactive' end,
                            'summary', v_summary, 'rows', v_rows);
end;
$$;

-- Gera a manutenção do ciclo. Idempotente: se já há manutenção aberta para o
-- ciclo, devolve a existente (e o índice único garante isso sob concorrência).
create or replace function public.maintenance_schedule_preventive(p_cycle_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle   public.maintenance_preventive_cycles;
  v_rule    public.maintenance_preventive_rules;
  v_open    record;
  v_org     uuid;
  v_res     jsonb;
  v_date    date := nullif(p_payload ->> 'scheduled_date', '')::date;
begin
  select * into v_cycle from public.maintenance_preventive_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then
    raise exception 'Ciclo preventivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.manage_preventive', true);
  if v_cycle.completed_on is not null then
    raise exception 'O ciclo MP% já foi realizado.', v_cycle.cycle_number using errcode = 'invalid_parameter_value';
  end if;
  select m.id, m.code, m.status into v_open from public.maintenances m
   where m.preventive_cycle_id = v_cycle.id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1;
  if v_open.id is not null then
    return jsonb_build_object('created', false, 'id', v_open.id, 'code', v_open.code, 'status', v_open.status,
                              'message', 'Já existe manutenção aberta para este ciclo.');
  end if;
  select * into v_rule from public.maintenance_preventive_rules where id = v_cycle.rule_id;
  if v_rule.service_id is null then
    raise exception 'Configure o serviço da preventiva no parâmetro deste tipo de equipamento.' using errcode = 'invalid_parameter_value';
  end if;

  v_res := private.maintenance_create_internal(v_org, jsonb_build_object(
    'vehicle_id', v_cycle.vehicle_id, 'maintenance_type_code', 'preventive',
    'priority', case v_rule.criticality when 'critical' then 'critical' when 'high' then 'high' else 'medium' end,
    'service_ids', jsonb_build_array(v_rule.service_id),
    'preventive_cycle_id', v_cycle.id,
    'status', case when v_date is not null and private.has_permission(v_org, 'maintenance.schedule') then 'scheduled' else 'to_schedule' end,
    'scheduled_date', v_date, 'scheduled_time', p_payload ->> 'scheduled_time',
    'supplier_id', p_payload ->> 'supplier_id',
    'description', format('Preventiva MP%s — marco %s km', v_cycle.cycle_number, v_cycle.milestone_km),
    'scheduling_notes', p_payload ->> 'notes',
    -- Preventiva não bloqueia por "equivalente": o ciclo é a identidade dela.
    'duplicate_justification', 'Preventiva programada do ciclo MP' || v_cycle.cycle_number),
    'preventive_schedule');
  return v_res || jsonb_build_object('created', true);
exception
  when unique_violation then
    select m.id, m.code, m.status into v_open from public.maintenances m
     where m.preventive_cycle_id = p_cycle_id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1;
    if v_open.id is null then
      raise;
    end if;
    return jsonb_build_object('created', false, 'id', v_open.id, 'code', v_open.code, 'status', v_open.status,
                              'message', 'Já existe manutenção aberta para este ciclo.');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Preditiva — versões, plano aplicável, sincronização dos ciclos
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_predictive_snapshot(p_plan_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.maintenance_predictive_plans;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id;
  insert into public.maintenance_predictive_plan_versions (organization_id, plan_id, version, approval_status, snapshot, reason)
  values (v_plan.organization_id, v_plan.id, v_plan.version, v_plan.approval_status,
          to_jsonb(v_plan) || jsonb_build_object('items',
            (select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order, i.name), '[]')
               from public.maintenance_predictive_plan_items i where i.plan_id = v_plan.id)),
          nullif(btrim(p_reason), ''))
  on conflict (plan_id, version) do update set snapshot = excluded.snapshot, approval_status = excluded.approval_status;
end;
$$;

create or replace function private.maintenance_predictive_plan_for(p_vehicle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.vehicles v
    left join public.vehicle_models vm on vm.id = v.vehicle_model_id
    join public.maintenance_predictive_plans p
      on p.organization_id = v.organization_id and p.vehicle_type_id = v.vehicle_type_id
   where v.id = p_vehicle_id
     and p.deleted_at is null and p.is_active and p.approval_status = 'approved'
     and (p.vehicle_subcategory_id is null or p.vehicle_subcategory_id = v.vehicle_subcategory_id)
     and (p.vehicle_model_id is null or p.vehicle_model_id = v.vehicle_model_id)
     and (p.vehicle_make_id is null or p.vehicle_make_id = vm.vehicle_make_id)
     and (p.year_from is null or coalesce(v.model_year, v.manufacture_year) >= p.year_from)
     and (p.year_to is null or coalesce(v.model_year, v.manufacture_year) <= p.year_to)
   order by (p.vehicle_model_id is not null) desc, (p.vehicle_make_id is not null) desc,
            (p.vehicle_subcategory_id is not null) desc, (p.year_from is not null or p.year_to is not null) desc,
            p.updated_at desc
   limit 1;
$$;

-- Última manutenção real concluída do cluster do item (ou de serviço que cobre o
-- item) — a referência "histórica" de quem ainda não tem verificação formal.
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
                      where cv.plan_item_id = pi.id and cv.service_id = mi.service_id))
   order by m.exit_date desc nulls last, m.created_at desc
   limit 1;
$$;

create or replace function private.maintenance_sync_predictive_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_plan    public.maintenance_predictive_plans;
  v_item    record;
  v_ref     record;
  v_created integer := 0;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  select * into v_plan from public.maintenance_predictive_plans where id = private.maintenance_predictive_plan_for(p_vehicle_id);

  -- Itens que saíram do plano (ou plano que deixou de valer) ficam inativos:
  -- o ciclo e as verificações continuam no histórico.
  update public.maintenance_predictive_cycles c set is_active = false
   where c.vehicle_id = p_vehicle_id and c.is_active
     and (v_plan.id is null or c.plan_id <> v_plan.id
          or not exists (select 1 from public.maintenance_predictive_plan_items i where i.id = c.plan_item_id and i.is_active));

  if v_plan.id is null then
    return jsonb_build_object('plan_id', null, 'created', 0);
  end if;

  for v_item in
    select i.* from public.maintenance_predictive_plan_items i where i.plan_id = v_plan.id and i.is_active
  loop
    if exists (select 1 from public.maintenance_predictive_cycles c where c.vehicle_id = p_vehicle_id and c.plan_item_id = v_item.id) then
      update public.maintenance_predictive_cycles set is_active = true, plan_version = v_plan.version, plan_id = v_plan.id
       where vehicle_id = p_vehicle_id and plan_item_id = v_item.id
         and (not is_active or plan_version <> v_plan.version or plan_id <> v_plan.id);
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
       v_ref.maintenance_id);
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('plan_id', v_plan.id, 'created', v_created);
end;
$$;

-- Status técnico de um ciclo preditivo (a regra central da preditiva).
-- Base = intervalo do item, ou o alvo reduzido do monitoramento quando ativo.
-- Restante até o próximo marco (KM e/ou dias), comparado às bandas do item:
--   intervalo em KM e sem KM oficial     → no_km             (SEM KM)
--   sem referência                       → initial_inspection (INSPEÇÃO INICIAL)
--   passou do marco além da tolerância   → critical          (CRÍTICO)
--   passou do marco dentro da tolerância → due               (VENCIDO)
--   restante ≤ base × programação%       → to_schedule       (A PROGRAMAR)
--   restante ≤ base × alerta%            → upcoming          (PRÓXIMO)
--   senão                                → ok                (EM DIA)
-- Com KM e dias, vale a pior das duas leituras. Última verificação não
-- conforme (sem manutenção concluída depois) sobe o status a, no mínimo,
-- A PROGRAMAR — a mesma regra do HFC.
create or replace function private.maintenance_predictive_band(
  p_remaining numeric, p_base numeric, p_alert_pct numeric, p_schedule_pct numeric, p_tolerance_pct numeric)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
           when p_remaining is null or p_base is null then null
           when p_remaining < -(p_base * p_tolerance_pct / 100.0) then 5
           when p_remaining < 0 then 4
           when p_remaining <= p_base * p_schedule_pct / 100.0 then 3
           when p_remaining <= p_base * p_alert_pct / 100.0 then 2
           else 1
         end::smallint;
$$;

create or replace function private.maintenance_predictive_state(p_organization_id uuid)
returns table (
  cycle_id uuid, vehicle_id uuid, plan_id uuid, plan_name text, plan_version integer, item_id uuid, item_name text,
  cluster_id uuid, cluster_name text, criticality text, interval_km integer, interval_days integer,
  reference_type text, reference_date date, reference_km integer, monitoring_active boolean,
  current_km integer, current_km_date date, next_km integer, next_date date,
  km_remaining integer, days_remaining integer, technical_status text, execution_status text,
  conformity text, open_maintenance_id uuid, open_maintenance_code text, last_verification_on date,
  severity smallint, vehicle_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with km as (
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
           (v.status = 'active' and v.deleted_at is null) as vehicle_active
      from public.maintenance_predictive_cycles c
      join public.maintenance_predictive_plan_items i on i.id = c.plan_item_id
      join public.maintenance_predictive_plans p on p.id = c.plan_id
      join public.maintenance_clusters cl on cl.id = i.cluster_id
      join public.vehicles v on v.id = c.vehicle_id
      left join km on km.vehicle_id = c.vehicle_id
     where c.organization_id = p_organization_id and c.is_active
       and private.has_permission(p_organization_id, 'maintenance.view')
       and private.vehicle_in_scope(p_organization_id, c.vehicle_id)
  ),
  calc as (
    select b.*,
           case when b.reference_km is not null and b.km_base is not null then b.reference_km + b.km_base end as next_km,
           case when b.reference_date is not null and b.day_base is not null then b.reference_date + b.day_base end as next_date,
           private.maintenance_today(p_organization_id) as today
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
  )
  select g.id, g.vehicle_id, g.plan_id, g.plan_name, g.plan_version, g.plan_item_id, g.item_name, g.cluster_id, g.cluster_name,
         g.criticality, g.interval_km, g.interval_days, g.reference_type, g.reference_date, g.reference_km, g.monitoring_active,
         g.odometer_km, g.reading_date, g.next_km, g.next_date,
         case when g.next_km is not null and g.odometer_km is not null then g.next_km - g.odometer_km end,
         case when g.next_date is not null then g.next_date - g.today end,
         g.tech_status,
         case
           when g.open_m is not null then g.open_m ->> 'status'
           when g.last_result = 'non_conforming' then 'awaiting_corrective'
           else 'not_programmed'
         end,
         coalesce(g.last_result, 'no_verification'),
         (g.open_m ->> 'id')::uuid, g.open_m ->> 'code', g.last_verif,
         (case g.tech_status when 'critical' then 6 when 'due' then 5 when 'to_schedule' then 4
                              when 'initial_inspection' then 3 when 'upcoming' then 2 when 'ok' then 1 else 0 end)::smallint,
         g.vehicle_active
    from (
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
    ) g;
$$;

-- -----------------------------------------------------------------------------
-- 5. Preditiva — planos e itens (RPC), versões, cobertura
-- -----------------------------------------------------------------------------
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
  v_code   text;
  v_key_changed boolean;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_predictive');
  if length(btrim(coalesce(p_payload ->> 'name', ''))) < 2 then
    raise exception 'Informe o nome do plano.' using errcode = 'invalid_parameter_value';
  end if;
  if v_type is null then
    raise exception 'Selecione o tipo de equipamento.' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    v_code := private.next_entity_code(p_organization_id, 'predictive_plan', 'PPT-', 4);
    insert into public.maintenance_predictive_plans
      (organization_id, code, name, description, vehicle_type_id, vehicle_subcategory_id, vehicle_make_id, vehicle_model_id,
       year_from, year_to, source, reference_document, oem_reference, notes)
    values
      (p_organization_id, v_code, btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''), v_type,
       nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid, nullif(p_payload ->> 'vehicle_make_id', '')::uuid,
       nullif(p_payload ->> 'vehicle_model_id', '')::uuid, nullif(p_payload ->> 'year_from', '')::smallint,
       nullif(p_payload ->> 'year_to', '')::smallint, coalesce(nullif(p_payload ->> 'source', ''), 'internal'),
       nullif(btrim(p_payload ->> 'reference_document'), ''), nullif(btrim(p_payload ->> 'oem_reference'), ''),
       nullif(btrim(p_payload ->> 'notes'), ''))
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
                    nullif(p_payload ->> 'year_to', '')::smallint)
                   is distinct from (v_old.vehicle_type_id, v_old.vehicle_subcategory_id, v_old.vehicle_make_id,
                                     v_old.vehicle_model_id, v_old.year_from, v_old.year_to);
  if v_old.approval_status = 'approved' and v_key_changed and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alterar a aplicabilidade de um plano aprovado exige motivo (gera nova versão).' using errcode = 'invalid_parameter_value';
  end if;

  update public.maintenance_predictive_plans set
    name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''),
    vehicle_type_id = v_type, vehicle_subcategory_id = nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid,
    vehicle_make_id = nullif(p_payload ->> 'vehicle_make_id', '')::uuid, vehicle_model_id = nullif(p_payload ->> 'vehicle_model_id', '')::uuid,
    year_from = nullif(p_payload ->> 'year_from', '')::smallint, year_to = nullif(p_payload ->> 'year_to', '')::smallint,
    source = coalesce(nullif(p_payload ->> 'source', ''), source),
    reference_document = nullif(btrim(p_payload ->> 'reference_document'), ''),
    oem_reference = nullif(btrim(p_payload ->> 'oem_reference'), ''),
    notes = nullif(btrim(p_payload ->> 'notes'), ''),
    version = case when v_old.approval_status = 'approved' and v_key_changed then version + 1 else version end
  where id = v_id;
  if v_old.approval_status = 'approved' and v_key_changed then
    perform private.maintenance_predictive_snapshot(v_id, p_reason);
  end if;
  return v_id;
end;
$$;

-- Item do plano. Em plano aprovado, mudar intervalo, bandas, cluster ou
-- ativação gera nova versão (com motivo) e recalcula os ciclos.
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
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id and deleted_at is null for update;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_plan.organization_id, 'maintenance.manage_predictive');
  if v_cluster is null or not exists (select 1 from public.maintenance_clusters c where c.id = v_cluster
                                        and c.organization_id = v_plan.organization_id and c.deleted_at is null) then
    raise exception 'Selecione o cluster técnico do item.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(coalesce(p_payload -> 'checklist', '[]')) <> 'array' then
    raise exception 'Roteiro técnico inválido.' using errcode = 'invalid_parameter_value';
  end if;

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
       coalesce((p_payload ->> 'is_active')::boolean, true), coalesce(p_payload -> 'checklist', '[]'))
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
      checklist = coalesce(p_payload -> 'checklist', checklist)
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
  end if;
  return jsonb_build_object('id', v_new_row.id, 'version_changed', v_plan.approval_status = 'approved' and v_sensitive,
                            'vehicles_synced', v_synced);
end;
$$;

-- Fluxo do plano: rascunho → em revisão → aprovado (publica versão) → arquivado.
create or replace function public.maintenance_set_predictive_plan_status(p_plan_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan    public.maintenance_predictive_plans;
  v_vehicle uuid;
  v_synced  integer := 0;
begin
  select * into v_plan from public.maintenance_predictive_plans where id = p_plan_id and deleted_at is null for update;
  if v_plan.id is null then
    raise exception 'Plano não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_plan.organization_id, 'maintenance.manage_predictive');
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

  update public.maintenance_predictive_plans set
    approval_status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    version = case when p_status = 'approved' and exists (select 1 from public.maintenance_predictive_plan_versions pv where pv.plan_id = p_plan_id)
                   then version + 1 else version end
  where id = p_plan_id;
  if p_status = 'approved' then
    perform private.maintenance_predictive_snapshot(p_plan_id, coalesce(p_reason, 'Aprovação do plano'));
  end if;

  -- Aprovar ou arquivar muda quais veículos o plano cobre.
  if p_status in ('approved', 'archived') then
    for v_vehicle in
      select v.id from public.vehicles v
       where v.organization_id = v_plan.organization_id and v.vehicle_type_id = v_plan.vehicle_type_id and v.deleted_at is null
      union
      select distinct c.vehicle_id from public.maintenance_predictive_cycles c where c.plan_id = p_plan_id
    loop
      perform private.maintenance_sync_predictive_vehicle(v_vehicle);
      v_synced := v_synced + 1;
    end loop;
  end if;
  return jsonb_build_object('status', p_status, 'vehicles_synced', v_synced);
end;
$$;

-- Duplicar um plano (atômico; o HFC fazia isso no navegador, item a item).
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
  perform private.maintenance_assert_permission(v_plan.organization_id, 'maintenance.manage_predictive');
  insert into public.maintenance_predictive_plans
    (organization_id, code, name, description, vehicle_type_id, vehicle_subcategory_id, vehicle_make_id, vehicle_model_id,
     year_from, year_to, source, reference_document, oem_reference, notes)
  values
    (v_plan.organization_id, private.next_entity_code(v_plan.organization_id, 'predictive_plan', 'PPT-', 4),
     coalesce(nullif(btrim(p_name), ''), v_plan.name || ' (cópia)'), v_plan.description, v_plan.vehicle_type_id,
     v_plan.vehicle_subcategory_id, v_plan.vehicle_make_id, v_plan.vehicle_model_id, v_plan.year_from, v_plan.year_to,
     v_plan.source, v_plan.reference_document, v_plan.oem_reference, v_plan.notes)
  returning id into v_new;
  for v_item in select * from public.maintenance_predictive_plan_items where plan_id = p_plan_id loop
    insert into public.maintenance_predictive_plan_items
      (organization_id, plan_id, cluster_id, service_id, name, technical_description, interval_km, interval_days,
       interval_engine_hours, alert_pct, schedule_pct, tolerance_pct, criticality, sort_order, is_active, checklist)
    values
      (v_item.organization_id, v_new, v_item.cluster_id, v_item.service_id, v_item.name, v_item.technical_description,
       v_item.interval_km, v_item.interval_days, v_item.interval_engine_hours, v_item.alert_pct, v_item.schedule_pct,
       v_item.tolerance_pct, v_item.criticality, v_item.sort_order, v_item.is_active, v_item.checklist)
    returning id into v_new_item;
    insert into public.maintenance_predictive_coverage (organization_id, plan_item_id, service_id, coverage)
    select c.organization_id, v_new_item, c.service_id, c.coverage
      from public.maintenance_predictive_coverage c where c.plan_item_id = v_item.id;
  end loop;
  return v_new;
end;
$$;

create or replace function public.maintenance_save_predictive_coverage(p_item_id uuid, p_services jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  public.maintenance_predictive_plan_items;
  v_count integer;
begin
  select * into v_item from public.maintenance_predictive_plan_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_item.organization_id, 'maintenance.manage_predictive');
  delete from public.maintenance_predictive_coverage where plan_item_id = p_item_id;
  insert into public.maintenance_predictive_coverage (organization_id, plan_item_id, service_id, coverage)
  select v_item.organization_id, p_item_id, (x ->> 'service_id')::uuid, coalesce(nullif(x ->> 'coverage', ''), 'full')
    from jsonb_array_elements(coalesce(p_services, '[]')) x
   where exists (select 1 from public.maintenance_services s
                  where s.id = (x ->> 'service_id')::uuid and s.organization_id = v_item.organization_id and s.deleted_at is null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
begin
  if not (private.has_permission(p_organization_id, 'maintenance.manage_predictive')
          or private.has_permission(p_organization_id, 'maintenance.reprocess')) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;
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
  return jsonb_build_object('vehicles', v_count, 'with_plan', v_with, 'without_plan', v_count - v_with);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Preditiva — matriz, alertas e painel (uma leitura só)
-- -----------------------------------------------------------------------------
-- p_filters: search, statuses[], execution[], cluster_ids[], operation_ids[], vehicle_ids[], include_inactive
create or replace function public.maintenance_predictive_overview(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today     date;
  v_settings  public.maintenance_settings;
  v_search    text := nullif(btrim(p_filters ->> 'search'), '');
  v_statuses  text[] := private.jsonb_text_array(p_filters -> 'statuses');
  v_exec      text[] := private.jsonb_text_array(p_filters -> 'execution');
  v_clusters  uuid[] := private.jsonb_uuid_array(p_filters -> 'cluster_ids');
  v_ops       uuid[] := private.jsonb_uuid_array(p_filters -> 'operation_ids');
  v_vehicles  uuid[] := private.jsonb_uuid_array(p_filters -> 'vehicle_ids');
  v_inactive  boolean := coalesce((p_filters ->> 'include_inactive')::boolean, false);
  v_result    jsonb;
begin
  if not private.has_permission(p_organization_id, 'maintenance.view') then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
  v_today := private.maintenance_today(p_organization_id);
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;

  with plan as (select * from private.adherence_planned_fleet(p_organization_id, v_today, null, null)),
  st as (
    select s.*, v.license_plate, v.fleet_code, p.operation_id,
           (select o.name from public.operations o where o.id = p.operation_id) as operation_name,
           (select c.name from public.cities c where c.id = p.city_id) as city_name,
           (select vt.name from public.vehicle_types vt where vt.id = v.vehicle_type_id) as type_name,
           (select vm.name from public.vehicle_models vm where vm.id = v.vehicle_model_id) as model_name
      from private.maintenance_predictive_state(p_organization_id) s
      join public.vehicles v on v.id = s.vehicle_id
      left join plan p on p.vehicle_id = s.vehicle_id
     where (v_inactive or s.vehicle_active)
       and (v_search is null or v.license_plate ilike '%' || private.normalize_plate(v_search) || '%'
            or coalesce(v.fleet_code, '') ilike '%' || v_search || '%' or s.cluster_name ilike '%' || v_search || '%'
            or s.item_name ilike '%' || v_search || '%')
       and (v_clusters is null or s.cluster_id = any (v_clusters))
       and (v_ops is null or p.operation_id = any (v_ops))
       and (v_vehicles is null or s.vehicle_id = any (v_vehicles))
  ),
  filtered as (
    select * from st
     where (v_statuses is null or st.technical_status = any (v_statuses))
       and (v_exec is null or st.execution_status = any (v_exec))
  ),
  fleet as (
    select count(*) filter (where v.status = 'active' and v.deleted_at is null) as active_vehicles,
           count(*) filter (where v.status = 'active' and v.deleted_at is null
                              and private.maintenance_predictive_plan_for(v.id) is not null) as covered_vehicles
      from public.vehicles v
     where v.organization_id = p_organization_id and private.vehicle_in_scope(p_organization_id, v.id)
  )
  select jsonb_build_object(
    'today', v_today,
    'summary', (select jsonb_build_object(
        'ok',                 count(*) filter (where technical_status = 'ok'),
        'upcoming',           count(*) filter (where technical_status = 'upcoming'),
        'to_schedule',        count(*) filter (where technical_status = 'to_schedule'),
        'due',                count(*) filter (where technical_status = 'due'),
        'critical',           count(*) filter (where technical_status = 'critical'),
        'initial_inspection', count(*) filter (where technical_status = 'initial_inspection'),
        'no_km',              count(*) filter (where technical_status = 'no_km'),
        'scheduled',          count(*) filter (where execution_status in ('to_schedule', 'scheduled')),
        'in_progress',        count(*) filter (where execution_status = 'in_progress'),
        'awaiting_corrective',count(*) filter (where execution_status = 'awaiting_corrective'),
        'monitoring',         count(*) filter (where monitoring_active),
        'items_monitored',    count(*),
        'forecast_km',        count(*) filter (where technical_status in ('ok', 'upcoming') and km_remaining between 0 and coalesce(v_settings.predictive_forecast_km, 5000)),
        'forecast_days',      count(*) filter (where technical_status in ('ok', 'upcoming') and days_remaining between 0 and coalesce(v_settings.predictive_forecast_days, 30)),
        'forecast_km_window', coalesce(v_settings.predictive_forecast_km, 5000),
        'forecast_days_window', coalesce(v_settings.predictive_forecast_days, 30))
      from st),
    'coverage', (select jsonb_build_object('active_vehicles', f.active_vehicles, 'covered_vehicles', f.covered_vehicles,
                                           'uncovered_vehicles', f.active_vehicles - f.covered_vehicles,
                                           'coverage_pct', case when f.active_vehicles > 0 then round(f.covered_vehicles * 100.0 / f.active_vehicles, 1) end)
                   from fleet f),
    'critical_clusters', (select coalesce(jsonb_agg(x order by (x ->> 'critical')::int desc, x ->> 'cluster'), '[]') from (
                            select jsonb_build_object('cluster', cluster_name, 'critical', count(*) filter (where technical_status in ('critical', 'due')),
                                                      'to_schedule', count(*) filter (where technical_status = 'to_schedule')) as x
                              from st group by cluster_name
                            having count(*) filter (where technical_status in ('critical', 'due', 'to_schedule')) > 0) q),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.item_id, 'item', c.item_name, 'cluster_id', c.cluster_id,
                                                             'cluster', c.cluster_name) order by c.cluster_name, c.item_name), '[]')
                  from (select distinct item_id, item_name, cluster_id, cluster_name from filtered) c),
    'rows', (select coalesce(jsonb_agg(r order by r ->> 'license_plate'), '[]') from (
               select jsonb_build_object(
                 'vehicle_id', f.vehicle_id, 'license_plate', max(f.license_plate), 'fleet_code', max(f.fleet_code),
                 'type_name', max(f.type_name), 'model_name', max(f.model_name), 'operation_name', max(f.operation_name),
                 'city_name', max(f.city_name), 'current_km', max(f.current_km), 'current_km_date', max(f.current_km_date),
                 'plan_name', max(f.plan_name), 'worst', max(f.severity),
                 'cells', jsonb_object_agg(f.item_id::text, jsonb_build_object(
                    'cycle_id', f.cycle_id, 'status', f.technical_status, 'execution', f.execution_status,
                    'conformity', f.conformity, 'next_km', f.next_km, 'next_date', f.next_date,
                    'km_remaining', f.km_remaining, 'days_remaining', f.days_remaining,
                    'reference_type', f.reference_type, 'reference_date', f.reference_date, 'reference_km', f.reference_km,
                    'monitoring', f.monitoring_active, 'open_maintenance_id', f.open_maintenance_id,
                    'open_maintenance_code', f.open_maintenance_code, 'last_verification_on', f.last_verification_on))) as r
                 from filtered f group by f.vehicle_id) z),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'cycle_id', f.cycle_id, 'vehicle_id', f.vehicle_id, 'license_plate', f.license_plate, 'fleet_code', f.fleet_code,
                 'operation_name', f.operation_name, 'plan_name', f.plan_name, 'item', f.item_name, 'cluster', f.cluster_name,
                 'criticality', f.criticality, 'status', f.technical_status, 'execution', f.execution_status,
                 'conformity', f.conformity, 'current_km', f.current_km, 'next_km', f.next_km, 'next_date', f.next_date,
                 'km_remaining', f.km_remaining, 'days_remaining', f.days_remaining, 'reference_type', f.reference_type,
                 'reference_date', f.reference_date, 'reference_km', f.reference_km, 'monitoring', f.monitoring_active,
                 'open_maintenance_id', f.open_maintenance_id, 'open_maintenance_code', f.open_maintenance_code)
                 order by f.severity desc, f.km_remaining nulls last, f.license_plate), '[]')
                 from filtered f
                where f.technical_status in ('critical', 'due', 'to_schedule', 'upcoming', 'initial_inspection')
                   or f.execution_status = 'awaiting_corrective'))
    into v_result;
  return v_result;
end;
$$;

-- Histórico técnico de um ciclo (verificações + manutenções do cluster).
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
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id;
  if v_cycle.id is null or not private.has_permission(v_cycle.organization_id, 'maintenance.view')
     or not private.vehicle_in_scope(v_cycle.organization_id, v_cycle.vehicle_id) then
    raise exception 'Ciclo não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  return jsonb_build_object(
    'item', jsonb_build_object('id', v_item.id, 'name', v_item.name, 'technical_description', v_item.technical_description,
                               'interval_km', v_item.interval_km, 'interval_days', v_item.interval_days,
                               'checklist', v_item.checklist, 'service_id', v_item.service_id),
    'verifications', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', pv.id, 'result', pv.result, 'decision', pv.decision, 'verified_on', pv.verified_on, 'km', pv.km,
                         'responsible', pv.responsible_name, 'notes', pv.notes, 'monitor_km', pv.monitor_km,
                         'monitor_days', pv.monitor_days, 'checklist', pv.checklist, 'maintenance_id', pv.maintenance_id,
                         'created_at', pv.created_at) order by pv.verified_on desc, pv.created_at desc), '[]')
                        from public.maintenance_predictive_verifications pv where pv.cycle_id = v_cycle.id),
    'maintenances', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', m.id, 'code', m.code, 'type', m.maintenance_type_code, 'status', m.status,
                        'entry_date', m.entry_date, 'exit_date', m.exit_date, 'entry_km', m.entry_km,
                        'service_order_number', m.service_order_number,
                        'services', (select string_agg(i.service_name_snapshot, ', ') from public.maintenance_items i
                                      where i.maintenance_id = m.id and i.status <> 'cancelled'))
                        order by coalesce(m.exit_date, m.entry_date, m.requested_on) desc), '[]')
                       from public.maintenances m
                      where m.vehicle_id = v_cycle.vehicle_id
                        and (m.predictive_cycle_id = v_cycle.id
                             or exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id
                                          and i.status <> 'cancelled' and i.cluster_id = v_item.cluster_id))));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Preditiva — verificação formal, geração de manutenção, baixa manual
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_generate_predictive(p_cycle_id uuid, p_payload jsonb default '{}'::jsonb)
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
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.manage_predictive', true);
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

-- p_payload: result, verified_on, km, responsible_name, responsible_employee_id, checklist[],
--            notes, monitor_km, monitor_days, open_maintenance (bool, default true p/ não conforme),
--            service_ids[], scheduled_date
create or replace function public.maintenance_register_predictive_verification(p_cycle_id uuid, p_payload jsonb)
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
begin
  select * into v_cycle from public.maintenance_predictive_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then
    raise exception 'Ciclo preditivo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.manage_predictive', true);
  select * into v_item from public.maintenance_predictive_plan_items where id = v_cycle.plan_item_id;
  v_today := private.maintenance_today(v_org);
  v_date := coalesce(v_date, v_today);

  if v_result not in ('conforming', 'monitor', 'non_conforming', 'not_performed') then
    raise exception 'Resultado da verificação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date > v_today then
    raise exception 'A verificação não pode estar no futuro.' using errcode = 'invalid_parameter_value';
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
  -- Itens obrigatórios do roteiro precisam de resposta (salvo não realizada).
  if v_result <> 'not_performed' then
    select count(*) into v_missing
      from jsonb_array_elements(v_item.checklist) q
     where coalesce((q ->> 'required')::boolean, true)
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

  insert into public.maintenance_predictive_verifications
    (organization_id, vehicle_id, cycle_id, plan_item_id, result, decision, verified_on, km, km_source,
     responsible_employee_id, responsible_name, checklist, notes, monitor_km, monitor_days)
  values
    (v_org, v_cycle.vehicle_id, v_cycle.id, v_cycle.plan_item_id, v_result, v_decision, v_date, v_km, v_km_src,
     nullif(p_payload ->> 'responsible_employee_id', '')::uuid, btrim(p_payload ->> 'responsible_name'),
     coalesce(p_payload -> 'checklist', '[]'), nullif(btrim(p_payload ->> 'notes'), ''),
     nullif(p_payload ->> 'monitor_km', '')::integer, nullif(p_payload ->> 'monitor_days', '')::integer)
  returning id into v_ver_id;

  if v_result in ('conforming', 'monitor') then
    update public.maintenance_predictive_cycles set
      reference_type = 'verification', reference_date = v_date, reference_km = coalesce(v_km, reference_km),
      reference_verification_id = v_ver_id, reference_maintenance_id = null,
      monitoring_active = (v_result = 'monitor'),
      monitoring_km = case when v_result = 'monitor' then nullif(p_payload ->> 'monitor_km', '')::integer end,
      monitoring_days = case when v_result = 'monitor' then nullif(p_payload ->> 'monitor_days', '')::integer end,
      last_verification_id = v_ver_id, last_result = v_result
    where id = v_cycle.id;
  else
    update public.maintenance_predictive_cycles set last_verification_id = v_ver_id, last_result = v_result
     where id = v_cycle.id;
  end if;

  if v_result = 'non_conforming' and coalesce((p_payload ->> 'open_maintenance')::boolean, true) then
    v_maint := public.maintenance_generate_predictive(v_cycle.id, jsonb_build_object(
      'verification_id', v_ver_id, 'service_ids', coalesce(p_payload -> 'service_ids', '[]'),
      'scheduled_date', p_payload ->> 'scheduled_date',
      'description', 'Não conformidade na verificação preditiva — ' || v_item.name || ': ' || btrim(p_payload ->> 'notes')));
    -- A verificação é imutável: o vínculo com a manutenção fica na manutenção
    -- (predictive_verification_id) e no resultado desta chamada.
  end if;

  return jsonb_build_object('verification_id', v_ver_id, 'decision', v_decision, 'km', v_km, 'km_source', v_km_src,
                            'maintenance', v_maint);
end;
$$;

-- Baixa manual autorizada: reinicia o ciclo sem verificação nem manutenção,
-- com motivo e responsável registrados.
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
  v_org := private.assert_vehicle_access(v_cycle.vehicle_id, 'maintenance.manage_predictive', true);
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A baixa manual exige motivo (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if p_date is null or p_date > private.maintenance_today(v_org) then
    raise exception 'Data da baixa inválida.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_predictive_cycles set
    reference_type = 'manual_reset', reference_date = p_date, reference_km = p_km,
    reference_maintenance_id = null, reference_verification_id = null, monitoring_active = false,
    monitoring_km = null, monitoring_days = null
  where id = p_cycle_id;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, old_data, new_data, changed_fields)
  values (v_org, auth.uid(), 'public.maintenance_predictive_cycles', p_cycle_id::text, 'UPDATE',
          jsonb_build_object('reference_type', v_cycle.reference_type, 'reference_date', v_cycle.reference_date,
                             'reference_km', v_cycle.reference_km),
          jsonb_build_object('reference_type', 'manual_reset', 'reference_date', p_date, 'reference_km', p_km, 'reason', p_reason,
                             'actor', private.maintenance_actor_name(v_org)),
          array['reference_type', 'reference_date', 'reference_km']);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Ganchos da conclusão/reabertura (substituem os vazios do núcleo)
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_on_completed(p_maintenance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m          public.maintenances;
  v_done       boolean;
  v_prev_prev  jsonb;
  v_resets     jsonb := '[]'::jsonb;
  v_cycle      record;
  v_preventive jsonb;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id;
  v_done := exists (select 1 from public.maintenance_items i where i.maintenance_id = v_m.id and i.status = 'done');
  if not v_done then
    return jsonb_build_object('preventive', null, 'predictive', '[]'::jsonb);
  end if;

  -- Preventiva: o ciclo da manutenção fica realizado (data de saída, KM de entrada).
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
  -- são cobertos (cobertura total) pelos serviços realizados. A referência
  -- anterior vai para a trilha, para a reabertura poder restaurá-la.
  for v_cycle in
    select c.* from public.maintenance_predictive_cycles c
     where c.vehicle_id = v_m.vehicle_id and c.is_active
       and (c.id = v_m.predictive_cycle_id
            or exists (select 1 from public.maintenance_items i
                         join public.maintenance_predictive_coverage cv on cv.service_id = i.service_id and cv.coverage = 'full'
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
      last_result = case when last_result = 'non_conforming' then null else last_result end
    where id = v_cycle.id;
  end loop;
  -- Referência "histórico do cluster" (não formal) acompanha a manutenção real
  -- mais recente do cluster, como no HFC; referências formais não mudam aqui.
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
      reference_maintenance_id = v_m.id
    where id = v_cycle.id;
  end loop;
  if jsonb_array_length(v_resets) > 0 then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'predictive_updated', null, null, null,
      jsonb_build_object('resets', v_resets), 'system');
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
  v_reset jsonb;
  v_prev  jsonb;
begin
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
      last_result = v_prev ->> 'last_result'
    where id = (v_reset ->> 'cycle_id')::uuid and reference_maintenance_id = p_maintenance_id;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Abertura guiada — contexto do veículo para o assistente
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_vehicle_context(p_vehicle_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_vehicle record;
  v_date    date;
  v_current record;
begin
  select v.*, vt.name as type_name, sc.name as subcategory_name, vm.name as model_name, mk.name as make_name
    into v_vehicle
    from public.vehicles v
    left join public.vehicle_types vt on vt.id = v.vehicle_type_id
    left join public.vehicle_subcategories sc on sc.id = v.vehicle_subcategory_id
    left join public.vehicle_models vm on vm.id = v.vehicle_model_id
    left join public.vehicle_makes mk on mk.id = vm.vehicle_make_id
   where v.id = p_vehicle_id;
  v_org := v_vehicle.organization_id;
  if v_org is null or not (private.has_permission(v_org, 'maintenance.create') or private.has_permission(v_org, 'maintenance.view_base')) then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.vehicle_in_scope(v_org, p_vehicle_id) then
    raise exception 'Este veículo não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  v_date := coalesce(p_date, private.maintenance_today(v_org));
  select * into v_current from private.vehicle_current_km(p_vehicle_id);

  return jsonb_build_object(
    'vehicle', jsonb_build_object('id', v_vehicle.id, 'license_plate', v_vehicle.license_plate, 'fleet_code', v_vehicle.fleet_code,
                                  'status', v_vehicle.status, 'archived', v_vehicle.deleted_at is not null,
                                  'vehicle_type_id', v_vehicle.vehicle_type_id, 'type_name', v_vehicle.type_name,
                                  'subcategory_name', v_vehicle.subcategory_name, 'model_name', v_vehicle.model_name,
                                  'make_name', v_vehicle.make_name),
    'context', private.maintenance_context(v_org, p_vehicle_id, v_date),
    'current_km', jsonb_build_object('km', v_current.km, 'date', v_current.reading_date),
    'km_at_date', private.maintenance_resolve_km(v_org, p_vehicle_id, v_date),
    'open', private.maintenance_open_equivalents(p_vehicle_id, null),
    'preventive_cycles', (select coalesce(jsonb_agg(jsonb_build_object(
                             'id', s.cycle_id, 'number', s.cycle_number, 'milestone_km', s.milestone_km, 'status', s.status,
                             'km_remaining', s.km_remaining, 'km_exceeded', s.km_exceeded,
                             'open_maintenance_code', s.open_maintenance_code) order by s.cycle_number), '[]')
                            from private.maintenance_preventive_state(v_org) s
                           where s.vehicle_id = p_vehicle_id and s.status <> 'completed'),
    'preventive_rule', private.maintenance_preventive_rule_for(p_vehicle_id) is not null,
    'predictive_attention', (select coalesce(jsonb_agg(jsonb_build_object(
                                'cycle_id', s.cycle_id, 'item', s.item_name, 'cluster', s.cluster_name,
                                'status', s.technical_status, 'execution', s.execution_status)), '[]')
                               from private.maintenance_predictive_state(v_org) s
                              where s.vehicle_id = p_vehicle_id and s.technical_status in ('critical', 'due', 'to_schedule')));
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Visão geral — indicadores gerenciais (tudo no servidor)
-- -----------------------------------------------------------------------------
-- Período: data de referência (entrada real → agendamento → solicitação) entre
-- date_from e date_to. Período anterior: mesma duração, imediatamente antes.
-- TMM = saída real − entrada real (duration_hours), só manutenções concluídas.
create or replace function private.maintenance_period_kpis(p_organization_id uuid, p_filters jsonb, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with m as (
    select * from private.maintenance_filtered(p_organization_id,
             coalesce(p_filters, '{}'::jsonb) - 'date_from' - 'date_to'
             || jsonb_build_object('date_from', p_from, 'date_to', p_to))
  ),
  done as (
    select * from private.maintenance_filtered(p_organization_id, coalesce(p_filters, '{}'::jsonb) - 'date_from' - 'date_to')
     where status = 'completed' and exit_date between p_from and p_to and duration_hours is not null
  )
  select jsonb_build_object(
    'volume',            (select count(*) from m where m.status not in ('cancelled')),
    'preventive',        (select count(*) from m where m.maintenance_type_code = 'preventive' and m.status <> 'cancelled'),
    'corrective',        (select count(*) from m where m.maintenance_type_code = 'corrective' and m.status <> 'cancelled'),
    'predictive',        (select count(*) from m where m.maintenance_type_code = 'predictive' and m.status <> 'cancelled'),
    'completed',         (select count(*) from done),
    'cancelled',         (select count(*) from m where m.status = 'cancelled'),
    'not_performed',     (select count(*) from m where m.status = 'not_performed'),
    'tmm_hours',         (select round(avg(duration_hours), 1) from done),
    'tmm_days',          (select round(avg(duration_hours) / 24.0, 2) from done),
    'tmm_corrective_days', (select round(avg(duration_hours) / 24.0, 2) from done where maintenance_type_code = 'corrective'),
    'tmm_corrective_p90_days', (select round((percentile_cont(0.9) within group (order by duration_hours) / 24.0)::numeric, 2)
                                  from done where maintenance_type_code = 'corrective'),
    'downtime_hours',    (select round(coalesce(sum(duration_hours), 0), 1) from done),
    'sla_within',        (select count(*) from done d
                           where d.duration_hours <= coalesce(
                                   (select sum(s.expected_hours) from public.maintenance_items i
                                      join public.maintenance_services s on s.id = i.service_id
                                     where i.maintenance_id = d.id and i.status <> 'cancelled'),
                                   (select ms.default_sla_hours from public.maintenance_settings ms where ms.organization_id = p_organization_id),
                                   72)));
$$;

create or replace function public.maintenance_dashboard(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today    date := private.maintenance_today(p_organization_id);
  v_now      timestamp := private.maintenance_now(p_organization_id);
  v_to       date := coalesce(nullif(p_filters ->> 'date_to', '')::date, v_today);
  v_from     date := coalesce(nullif(p_filters ->> 'date_from', '')::date, (date_trunc('month', v_to) - interval '5 months')::date);
  v_days     integer;
  v_settings public.maintenance_settings;
  v_window   integer;
  v_buckets  integer[];
  v_base     jsonb := coalesce(p_filters, '{}'::jsonb) - 'date_from' - 'date_to';
  v_period   jsonb;
  v_result   jsonb;
begin
  if not private.has_permission(p_organization_id, 'maintenance.view_dashboard') then
    raise exception 'Você não possui permissão para a visão geral.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;
  v_window  := coalesce(nullif(p_filters ->> 'recurrence_days', '')::integer, v_settings.recurrence_window_days, 30);
  v_buckets := coalesce(v_settings.aging_buckets, '{2,5,10,20}');
  v_days    := v_to - v_from + 1;
  v_period  := v_base || jsonb_build_object('date_from', v_from, 'date_to', v_to);

  with m as (select * from private.maintenance_filtered(p_organization_id, v_period)),
  open_now as (select * from private.maintenance_filtered(p_organization_id, v_base || '{"open_only": true}'::jsonb)),
  done as (
    select * from private.maintenance_filtered(p_organization_id, v_base)
     where status = 'completed' and exit_date between v_from and v_to and duration_hours is not null
  ),
  items as (
    select i.*, m.id as m_id, m.status as m_status, m.duration_hours, m.exit_date, m.supplier_id
      from m join public.maintenance_items i on i.maintenance_id = m.id and i.status <> 'cancelled'
     where m.status <> 'cancelled'
  ),
  rec as (select * from private.maintenance_recurrences(p_organization_id, v_window, v_period)),
  prev_state as (select * from private.maintenance_preventive_state(p_organization_id) where vehicle_active),
  pred_state as (select * from private.maintenance_predictive_state(p_organization_id) where vehicle_active)
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days,
                                 'previous_from', v_from - v_days, 'previous_to', v_from - 1, 'today', v_today),
    'kpis', private.maintenance_period_kpis(p_organization_id, v_base, v_from, v_to) || jsonb_build_object(
      'open',              (select count(*) from open_now),
      'to_schedule',       (select count(*) from open_now where status = 'to_schedule'),
      'scheduled',         (select count(*) from open_now where status = 'scheduled'),
      'in_progress',       (select count(*) from open_now where status = 'in_progress'),
      'scheduled_today',   (select count(*) from open_now where status = 'scheduled' and scheduled_date = v_today),
      'late_entry',        (select count(*) from open_now where status = 'scheduled' and scheduled_date < v_today),
      'exit_overdue',      (select count(*) from open_now where status = 'in_progress' and expected_exit_date < v_today),
      'unscheduled_overdue', (select count(*) from open_now where status = 'to_schedule'
                                and requested_on <= v_today - coalesce(v_settings.schedule_overdue_days, 5)),
      'backlog_7d',        (select count(*) from open_now where v_today - coalesce(entry_date, requested_on) > 7),
      'ongoing_downtime_hours', (select round(coalesce(sum(extract(epoch from (v_now - (entry_date + coalesce(entry_time, time '00:00')))) / 3600), 0)::numeric, 1)
                                   from open_now where status = 'in_progress'),
      'immobilized_vehicles', (select count(distinct vehicle_id) from open_now where status = 'in_progress'),
      'active_vehicles',   (select count(*) from public.maintenance_vehicles_in_scope(p_organization_id)),
      'recurrences',       (select count(distinct maintenance_id) from rec),
      'recurrent_vehicles', (select count(distinct vehicle_id) from rec),
      'preventive_critical', (select count(*) from prev_state where status = 'critical'),
      'preventive_due',      (select count(*) from prev_state where status = 'due'),
      'preventive_to_schedule', (select count(*) from prev_state where status = 'to_schedule'),
      'preventive_on_time',  (select count(*) from prev_state where completed_on between v_from and v_to and adherence = 'on_time'),
      'preventive_early',    (select count(*) from prev_state where completed_on between v_from and v_to and adherence = 'early'),
      'preventive_late',     (select count(*) from prev_state where completed_on between v_from and v_to and adherence = 'late'),
      'predictive_critical', (select count(*) from pred_state where technical_status in ('critical', 'due'))),
    'previous', private.maintenance_period_kpis(p_organization_id, v_base, v_from - v_days, v_from - 1)
                || jsonb_build_object('recurrences', (select count(distinct r.maintenance_id)
                                                        from private.maintenance_recurrences(p_organization_id, v_window,
                                                             v_base || jsonb_build_object('date_from', v_from - v_days, 'date_to', v_from - 1)) r)),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', x.month, 'preventive', x.preventive, 'corrective', x.corrective,
                                                             'predictive', x.predictive, 'total', x.total) order by x.month), '[]')
                  from (select to_char(date_trunc('month', coalesce(entry_date, scheduled_date, requested_on)), 'YYYY-MM') as month,
                               count(*) filter (where maintenance_type_code = 'preventive') as preventive,
                               count(*) filter (where maintenance_type_code = 'corrective') as corrective,
                               count(*) filter (where maintenance_type_code = 'predictive') as predictive,
                               count(*) as total
                          from m where status <> 'cancelled' group by 1) x),
    'mix', (select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'count', x.cnt) order by x.cnt desc), '[]')
              from (select maintenance_type_code as type, count(*) as cnt from m where status <> 'cancelled' group by 1) x),
    'statuses', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'count', x.cnt) order by x.cnt desc), '[]')
                   from (select status, count(*) as cnt from m group by 1) x),
    'aging', (select coalesce(jsonb_agg(jsonb_build_object('bucket', b.label, 'upper', b.upper, 'count',
                 (select count(*) from open_now o
                   where (v_today - coalesce(o.entry_date, o.requested_on)) > b.lower
                     and (b.upper is null or (v_today - coalesce(o.entry_date, o.requested_on)) <= b.upper))) order by b.ord), '[]')
                from (select ord, case when ord = 1 then -1 else v_buckets[ord - 1] end as lower,
                             case when ord <= cardinality(v_buckets) then v_buckets[ord] end as upper,
                             case when ord = 1 then '0–' || v_buckets[1]
                                  when ord <= cardinality(v_buckets) then (v_buckets[ord - 1] + 1) || '–' || v_buckets[ord]
                                  else '>' || v_buckets[cardinality(v_buckets)] end || ' dias' as label
                        from generate_series(1, cardinality(v_buckets) + 1) ord) b),
    'clusters', (select coalesce(jsonb_agg(jsonb_build_object('cluster', x.cluster, 'count', x.cnt, 'completed', x.completed,
                                                              'tmm_days', x.tmm, 'tmm_median_days', x.median)
                                           order by x.cnt desc), '[]')
                   from (select cluster_name_snapshot as cluster, count(distinct m_id) as cnt,
                                count(distinct m_id) filter (where m_status = 'completed') as completed,
                                round(avg(duration_hours) filter (where m_status = 'completed') / 24.0, 2) as tmm,
                                round((percentile_cont(0.5) within group (order by duration_hours) filter (where m_status = 'completed') / 24.0)::numeric, 2) as median
                           from items group by cluster_name_snapshot) x),
    'services', (select coalesce(jsonb_agg(x order by (x ->> 'count')::int desc), '[]') from (
                   select jsonb_build_object('service', service_name_snapshot, 'cluster', max(cluster_name_snapshot),
                                             'count', count(*), 'tmm_days', round(avg(duration_hours) filter (where m_status = 'completed') / 24.0, 2)) as x
                     from items group by service_name_snapshot order by count(*) desc limit 10) q),
    'suppliers', (select coalesce(jsonb_agg(x order by (x ->> 'count')::int desc), '[]') from (
                    select jsonb_build_object('supplier', s.name, 'count', count(*),
                                              'completed', count(*) filter (where m.status = 'completed'),
                                              'open', count(*) filter (where m.status in ('to_schedule', 'scheduled', 'in_progress')),
                                              'tmm_days', round(avg(m.duration_hours) filter (where m.status = 'completed') / 24.0, 2)) as x
                      from m join public.maintenance_suppliers s on s.id = m.supplier_id
                     where m.status <> 'cancelled'
                     group by s.name order by count(*) desc limit 10) q),
    'recurrence', (select coalesce(jsonb_agg(x order by (x ->> 'recurrences')::int desc, x ->> 'license_plate'), '[]') from (
                     select jsonb_build_object(
                              'vehicle_id', r.vehicle_id,
                              'license_plate', (select mm.license_plate_snapshot from public.maintenances mm where mm.id = max(r.maintenance_id::text)::uuid),
                              'cluster', r.cluster_name, 'recurrences', count(*), 'same_service', count(*) filter (where r.same_service),
                              'avg_interval_days', round(avg(r.days_between), 1), 'last', max(r.reference_date)) as x
                       from rec r group by r.vehicle_id, r.cluster_name order by count(*) desc limit 30) q),
    'recurrence_window_days', v_window,
    'aging_buckets', to_jsonb(v_buckets))
    into v_result;
  return v_result;
end;
$$;

-- Frota ativa no escopo (para disponibilidade). SECURITY DEFINER: lê vehicles.
create or replace function public.maintenance_vehicles_in_scope(p_organization_id uuid)
returns table (vehicle_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.vehicles v
   where v.organization_id = p_organization_id and v.status = 'active' and v.deleted_at is null
     and private.has_permission(p_organization_id, 'maintenance.view')
     and private.vehicle_in_scope(p_organization_id, v.id);
$$;

-- -----------------------------------------------------------------------------
-- 11. Rotina diária — reprocessar KM pendente e ciclos
-- -----------------------------------------------------------------------------
-- KM "pendente por data futura", "não encontrado" e "a revisar" são reavaliados
-- quando a data chega ou a base oficial recebe leituras; ciclos preventivos e
-- preditivos são sincronizados. Nunca toca KM manual.
create or replace function private.maintenance_daily_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     record;
  v_km      jsonb;
  v_km_done integer := 0;
  v_vehicle record;
  v_vehicles integer := 0;
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
  return jsonb_build_object('km_reprocessed', v_km_done, 'vehicles_synced', v_vehicles, 'ran_at', now());
end;
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('hfm_maintenance_daily', '15 6 * * *', 'select private.maintenance_daily_tick();');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 12. Grants
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.maintenance_preventive_rule_for(uuid)', 'private.maintenance_sync_preventive_vehicle(uuid)',
    'private.maintenance_predictive_snapshot(uuid, text)', 'private.maintenance_predictive_plan_for(uuid)',
    'private.maintenance_predictive_history_reference(uuid, uuid)', 'private.maintenance_sync_predictive_vehicle(uuid)',
    'private.maintenance_on_completed(uuid)', 'private.maintenance_on_reopened(uuid, jsonb)',
    'private.maintenance_daily_tick()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  -- Leitura: as funções de estado conferem permissão e escopo por dentro.
  foreach f in array array[
    'private.maintenance_preventive_status(integer, integer, numeric, numeric, integer, boolean)',
    'private.maintenance_preventive_adherence(integer, integer, numeric, numeric, integer)',
    'private.maintenance_preventive_state(uuid)', 'private.maintenance_predictive_band(numeric, numeric, numeric, numeric, numeric)',
    'private.maintenance_predictive_state(uuid)', 'private.maintenance_period_kpis(uuid, jsonb, date, date)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  foreach f in array array[
    'public.maintenance_save_preventive_rule(uuid, jsonb)', 'public.maintenance_archive_preventive_rule(uuid)',
    'public.maintenance_sync_preventive(uuid, uuid)', 'public.maintenance_preventive_matrix(uuid, jsonb)',
    'public.maintenance_schedule_preventive(uuid, jsonb)', 'public.maintenance_save_predictive_plan(uuid, jsonb, text)',
    'public.maintenance_save_predictive_item(uuid, jsonb, text)', 'public.maintenance_set_predictive_plan_status(uuid, text, text)',
    'public.maintenance_duplicate_predictive_plan(uuid, text)', 'public.maintenance_save_predictive_coverage(uuid, jsonb)',
    'public.maintenance_sync_predictive(uuid, uuid)', 'public.maintenance_predictive_overview(uuid, jsonb)',
    'public.maintenance_predictive_cycle_history(uuid)', 'public.maintenance_generate_predictive(uuid, jsonb)',
    'public.maintenance_register_predictive_verification(uuid, jsonb)', 'public.maintenance_predictive_reset(uuid, date, integer, text)',
    'public.maintenance_vehicle_context(uuid, date)', 'public.maintenance_dashboard(uuid, jsonb)',
    'public.maintenance_vehicles_in_scope(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
