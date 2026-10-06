-- =============================================================================
-- Gestão de Pneus — serviços (consertos por Nº Fogo e alinhamento/balanceamento
-- lidos da Gestão de Manutenção), cadastros administrativos com auditoria e
-- registro de exportações.
--
-- Nada financeiro: consertos não têm valor nesta etapa (CPK é etapa futura).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Veículo do pneu numa data (consertos): fotografia exata > fotografia
--    anterior > evento de movimentação > não resolvido (nunca a placa atual)
-- -----------------------------------------------------------------------------
create or replace function private.tire_resolve_vehicle_at(p_organization_id uuid, p_tire_id uuid, p_date date)
returns table (vehicle_id uuid, license_plate text, fleet_code text, position_code text, resolution text,
               reference_date date, confidence text, message text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s  public.tire_daily_snapshots;
  ev public.tire_events;
  p  public.tire_parameter_sets := private.tire_params_at(p_organization_id, p_date);
begin
  select x.* into s from public.tire_daily_snapshots x
   where x.tire_id = p_tire_id and x.organization_id = p_organization_id and x.reference_date <= p_date
   order by x.reference_date desc limit 1;
  if s.id is not null and s.vehicle_id is not null and s.canonical_status = 'em_uso' then
    return query select s.vehicle_id, v.license_plate, v.fleet_code, s.position_code,
      case when s.reference_date = p_date then 'snapshot_exact' else 'snapshot_previous' end, s.reference_date,
      case when s.reference_date = p_date or p_date - s.reference_date <= p.repair_resolution_max_age_days then 'high' else 'medium' end,
      case when s.reference_date = p_date then 'Fotografia Rodopar da própria data.'
           else format('Fotografia Rodopar de %s (%s dias antes).', to_char(s.reference_date, 'DD/MM/YYYY'), p_date - s.reference_date) end
      from public.vehicles v where v.id = s.vehicle_id;
    return;
  end if;
  -- sem fotografia anterior em uso: o veículo de onde o pneu saiu no primeiro
  -- movimento posterior à data
  select x.* into ev from public.tire_events x
   where x.tire_id = p_tire_id and x.organization_id = p_organization_id and x.reference_date > p_date
     and x.event_type in ('TIRE_MOVED', 'TIRE_REMOVED', 'TIRE_RETURNED_TO_STOCK', 'TIRE_SENT_TO_RETREAD', 'TIRE_DISCARDED')
     and x.previous_vehicle_id is not null
   order by x.reference_date limit 1;
  if ev.id is not null and s.id is null then
    return query select ev.previous_vehicle_id, v.license_plate, v.fleet_code, ev.previous_position_code, 'event', ev.reference_date,
      'medium', format('Movimentação registrada em %s: o pneu saiu deste veículo.', to_char(ev.reference_date, 'DD/MM/YYYY'))
      from public.vehicles v where v.id = ev.previous_vehicle_id;
    return;
  end if;
  return query select null::uuid, null::text, null::text, null::text, 'unresolved'::text, s.reference_date, null::text,
    case when s.id is null then 'Nenhuma fotografia do pneu até esta data.'
         else format('Na fotografia de %s o pneu não estava em uso em um veículo (%s).', to_char(s.reference_date, 'DD/MM/YYYY'), s.canonical_status) end;
end;
$$;

create or replace function public.tire_repair_resolve(p_organization_id uuid, p_fire_number text, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tires;
  r record;
begin
  perform private.tire_require(p_organization_id, 'tires.services.view');
  select * into t from public.tires x where x.organization_id = p_organization_id and x.fire_number = private.tire_fire_number(p_fire_number);
  if t.id is null then return jsonb_build_object('found', false); end if;
  select * into r from private.tire_resolve_vehicle_at(p_organization_id, t.id, coalesce(p_date, private.maintenance_today(p_organization_id)));
  return jsonb_build_object('found', true, 'tire', jsonb_build_object('id', t.id, 'fire_number', t.fire_number, 'brand', t.brand,
                              'model', t.model, 'dimension', t.dimension, 'current_status', t.current_status),
                            'suggestion', to_jsonb(r));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Consertos: registrar/editar, cancelar (com motivo; nada é apagado) e listar
-- -----------------------------------------------------------------------------
create or replace function public.tire_repair_save(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_old      public.tire_repairs;
  t          public.tires;
  v_date     date;
  v_type     text := nullif(btrim(p_payload ->> 'repair_type'), '');
  v_service  uuid := nullif(p_payload ->> 'service_id', '')::uuid;
  v_supplier uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
  v_sup_name text;
  v_override uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_reason   text := nullif(btrim(p_payload ->> 'override_reason'), '');
  r          record;
  v_vehicle  record;
  v_res      public.tire_repairs;
  v_name     text := private.tire_actor_name(p_organization_id);
begin
  perform private.tire_require(p_organization_id, 'tires.services.manage');
  -- sem troca manual o registro fica "vazio" (estrutura definida) para as leituras abaixo
  select null::uuid as id, null::text as license_plate, null::text as fleet_code into v_vehicle;
  if v_id is not null then
    select * into v_old from public.tire_repairs x where x.id = v_id and x.organization_id = p_organization_id for update;
    if v_old.id is null then raise exception 'Conserto não encontrado.' using errcode = 'no_data_found'; end if;
    if v_old.status = 'voided' then raise exception 'Conserto cancelado não pode ser editado.' using errcode = 'invalid_parameter_value'; end if;
  end if;
  select * into t from public.tires x
   where x.organization_id = p_organization_id
     and (x.id = nullif(p_payload ->> 'tire_id', '')::uuid or x.fire_number = private.tire_fire_number(p_payload ->> 'fire_number'));
  if t.id is null then raise exception 'Nº Fogo não encontrado no cadastro de pneus.' using errcode = 'no_data_found'; end if;
  begin
    v_date := (p_payload ->> 'service_date')::date;
  exception when others then
    raise exception 'Data do serviço inválida.' using errcode = 'invalid_parameter_value';
  end;
  if v_date is null or v_date > private.maintenance_today(p_organization_id) then
    raise exception 'Informe a data do serviço (não pode ser futura).' using errcode = 'invalid_parameter_value';
  end if;
  if v_type is null or length(v_type) not between 2 and 80 then
    raise exception 'Informe o tipo de conserto (2 a 80 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v_service is not null and not exists (select 1 from public.maintenance_services s where s.id = v_service and s.organization_id = p_organization_id) then
    raise exception 'Serviço não encontrado no catálogo da Manutenção.' using errcode = 'no_data_found';
  end if;
  if v_supplier is not null then
    select s.name into v_sup_name from public.maintenance_suppliers s where s.id = v_supplier and s.organization_id = p_organization_id;
    if v_sup_name is null then raise exception 'Fornecedor não encontrado no cadastro da Manutenção.' using errcode = 'no_data_found'; end if;
  end if;

  select * into r from private.tire_resolve_vehicle_at(p_organization_id, t.id, v_date);
  if v_override is not null and v_override is distinct from r.vehicle_id then
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'O veículo informado difere do resolvido pela fotografia: justifique (mínimo de 5 caracteres).'
        using errcode = 'invalid_parameter_value', hint = 'tire_repair_override_reason';
    end if;
    select v.id, v.license_plate, v.fleet_code into v_vehicle from public.vehicles v where v.id = v_override and v.organization_id = p_organization_id;
    if v_vehicle.id is null then raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found'; end if;
  end if;

  if v_id is null then
    insert into public.tire_repairs (organization_id, tire_id, fire_number_snapshot, service_date, repair_type, service_id, supplier_id,
      supplier_name_snapshot, service_order_number, notes, vehicle_id, license_plate_snapshot, fleet_code_snapshot, position_code_snapshot,
      vehicle_resolution, resolution_reference_date, resolution_confidence, override_reason, created_by, created_by_name)
    values (p_organization_id, t.id, t.fire_number, v_date, v_type, v_service, v_supplier, v_sup_name,
      nullif(btrim(p_payload ->> 'service_order_number'), ''), nullif(btrim(p_payload ->> 'notes'), ''),
      case when v_vehicle.id is not null then v_vehicle.id else r.vehicle_id end,
      case when v_vehicle.id is not null then v_vehicle.license_plate else r.license_plate end,
      case when v_vehicle.id is not null then v_vehicle.fleet_code else r.fleet_code end,
      case when v_vehicle.id is not null then null else r.position_code end,
      case when v_vehicle.id is not null then 'manual' else r.resolution end, r.reference_date,
      case when v_vehicle.id is not null then 'manual' else r.confidence end,
      case when v_vehicle.id is not null then v_reason end, auth.uid(), v_name)
    returning * into v_res;
  else
    update public.tire_repairs set tire_id = t.id, fire_number_snapshot = t.fire_number, service_date = v_date, repair_type = v_type,
      service_id = v_service, supplier_id = v_supplier, supplier_name_snapshot = v_sup_name,
      service_order_number = nullif(btrim(p_payload ->> 'service_order_number'), ''), notes = nullif(btrim(p_payload ->> 'notes'), ''),
      vehicle_id = case when v_vehicle.id is not null then v_vehicle.id else r.vehicle_id end,
      license_plate_snapshot = case when v_vehicle.id is not null then v_vehicle.license_plate else r.license_plate end,
      fleet_code_snapshot = case when v_vehicle.id is not null then v_vehicle.fleet_code else r.fleet_code end,
      position_code_snapshot = case when v_vehicle.id is not null then null else r.position_code end,
      vehicle_resolution = case when v_vehicle.id is not null then 'manual' else r.resolution end,
      resolution_reference_date = r.reference_date,
      resolution_confidence = case when v_vehicle.id is not null then 'manual' else r.confidence end,
      override_reason = case when v_vehicle.id is not null then v_reason end, updated_by = auth.uid(), updated_at = now()
     where id = v_id
    returning * into v_res;
  end if;
  perform private.tire_audit(p_organization_id, case when v_id is null then 'repair.created' else 'repair.updated' end, 'tire_repair', v_res.id,
    format('Conserto %s do pneu %s em %s.', v_type, t.fire_number, to_char(v_date, 'DD/MM/YYYY')),
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_res));
  return to_jsonb(v_res);
end;
$$;

create or replace function public.tire_repair_void(p_organization_id uuid, p_repair_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.tire_repairs; v_reason text := nullif(btrim(p_reason), '');
begin
  perform private.tire_require(p_organization_id, 'tires.services.manage');
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'Informe o motivo do cancelamento (mínimo de 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  update public.tire_repairs set status = 'voided', void_reason = left(v_reason, 300), voided_by = auth.uid(), voided_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_repair_id and organization_id = p_organization_id and status = 'active'
  returning * into r;
  if r.id is null then raise exception 'Conserto não encontrado ou já cancelado.' using errcode = 'no_data_found'; end if;
  perform private.tire_audit(p_organization_id, 'repair.voided', 'tire_repair', r.id,
    format('Conserto do pneu %s cancelado: %s', r.fire_number_snapshot, v_reason));
  return to_jsonb(r);
end;
$$;

create or replace function public.tire_repairs_list(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
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
  f_from   date := nullif(f ->> 'date_from', '')::date;
  f_to     date := nullif(f ->> 'date_to', '')::date;
  f_search text := nullif(btrim(f ->> 'search'), '');
  f_status text := coalesce(nullif(f ->> 'status', ''), 'active');
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.services.view');
  with q as (
    select r.* from public.tire_repairs r
     where r.organization_id = p_organization_id and private.tire_vehicle_visible(r.organization_id, r.vehicle_id)
       and (f_status = 'all' or r.status = f_status)
       and (f_from is null or r.service_date >= f_from) and (f_to is null or r.service_date <= f_to)
       and (f_search is null or r.fire_number_snapshot like '%' || upper(f_search) || '%'
            or coalesce(r.license_plate_snapshot, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
            or upper(coalesce(r.fleet_code_snapshot, '')) like '%' || upper(f_search) || '%'
            or coalesce(r.service_order_number, '') ilike '%' || f_search || '%'
            or coalesce(r.supplier_name_snapshot, '') ilike '%' || f_search || '%'
            or r.repair_type ilike '%' || f_search || '%')),
  o as (select q.*, row_number() over (order by q.service_date desc, q.created_at desc) as rn from q)
  select jsonb_build_object(
    'kpis', jsonb_build_object('total', (select count(*) from q), 'tires', (select count(distinct q.tire_id) from q),
      'unresolved', (select count(*) from q where q.vehicle_resolution = 'unresolved'),
      'manual', (select count(*) from q where q.vehicle_resolution = 'manual'),
      'top_types', coalesce((select jsonb_agg(jsonb_build_object('type', x.t, 'count', x.n) order by x.n desc)
                               from (select q.repair_type as t, count(*) as n from q group by 1 order by 2 desc limit 5) x), '[]'::jsonb)),
    'total', (select count(*) from o),
    'rows', coalesce((select jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
                             from public.maintenance_suppliers s where s.organization_id = p_organization_id and s.status = 'active'), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
                            from public.tire_maintenance_service_kinds k join public.maintenance_services s on s.id = k.service_id
                           where k.organization_id = p_organization_id and k.is_active and k.kind = 'tire_service'), '[]'::jsonb),
    'known_types', coalesce((select jsonb_agg(x.t order by x.t) from (select distinct r.repair_type as t from public.tire_repairs r
                               where r.organization_id = p_organization_id) x), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Alinhamento, balanceamento e serviços de pneu — fonte: Gestão de Manutenção
-- -----------------------------------------------------------------------------
create or replace function public.tire_maintenance_services(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
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
  f_kinds  text[] := private.jsonb_text_array(f -> 'kinds');
  f_status text[] := private.jsonb_text_array(f -> 'statuses');
  f_from   date := nullif(f ->> 'date_from', '')::date;
  f_to     date := nullif(f ->> 'date_to', '')::date;
  f_search text := nullif(btrim(f ->> 'search'), '');
  f_veh    uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.services.view');
  with k as (select * from public.tire_maintenance_service_kinds k where k.organization_id = p_organization_id and k.is_active),
  m as (
    select mt.id, mt.code, mt.vehicle_id, mt.license_plate_snapshot, mt.fleet_code_snapshot, mt.status, mt.priority,
           mt.requested_on, mt.scheduled_date, mt.entry_date, mt.exit_date, mt.service_order_number,
           mt.operation_id, mt.operation_name_snapshot, mt.city_name_snapshot, mt.state_uf_snapshot, mt.maintenance_type_code,
           sp.name as supplier_name,
           array_agg(distinct k.kind) as kinds, string_agg(distinct it.service_name_snapshot, ' · ') as services,
           case when bool_or(k.kind = 'alignment_balancing') or (bool_or(k.kind = 'alignment') and bool_or(k.kind = 'balancing')) then 'alignment_balancing'
                when bool_or(k.kind = 'alignment') then 'alignment' when bool_or(k.kind = 'balancing') then 'balancing'
                else 'tire_service' end as kind
      from public.maintenances mt
      join public.maintenance_items it on it.maintenance_id = mt.id
      join k on k.service_id = it.service_id
      left join public.maintenance_suppliers sp on sp.id = mt.supplier_id
     where mt.organization_id = p_organization_id
       and private.maintenance_in_scope(p_organization_id, mt.operation_id, mt.vehicle_id)
     group by mt.id, sp.name),
  q as (
    select m.* from m
     where (f_kinds is null or cardinality(f_kinds) = 0 or m.kind = any (f_kinds))
       and (f_status is null or cardinality(f_status) = 0 or m.status = any (f_status))
       and (f_from is null or m.requested_on >= f_from) and (f_to is null or m.requested_on <= f_to)
       and (f_veh is null or cardinality(f_veh) = 0 or m.vehicle_id = any (f_veh))
       and (f_search is null or m.code ilike '%' || f_search || '%'
            or coalesce(m.license_plate_snapshot, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
            or upper(coalesce(m.fleet_code_snapshot, '')) like '%' || upper(f_search) || '%'
            or coalesce(m.service_order_number, '') ilike '%' || f_search || '%')),
  o as (select q.*, row_number() over (order by q.requested_on desc, q.code desc) as rn from q)
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total', (select count(*) from q),
      'alignment', (select count(*) from q where q.kind = 'alignment'),
      'balancing', (select count(*) from q where q.kind = 'balancing'),
      'alignment_balancing', (select count(*) from q where q.kind = 'alignment_balancing'),
      'tire_service', (select count(*) from q where q.kind = 'tire_service'),
      'open', (select count(*) from q where q.status in ('to_schedule', 'scheduled', 'in_progress')),
      'completed', (select count(*) from q where q.status = 'completed'),
      'avg_days', (select round(avg(q.exit_date - q.entry_date)::numeric, 1) from q where q.exit_date is not null and q.entry_date is not null)),
    'mapped_services', (select count(*) from k),
    'total', (select count(*) from o),
    'rows', coalesce((select jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Cadastros (Parâmetros) — sempre auditados
-- -----------------------------------------------------------------------------
create or replace function public.tire_save_parameters(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  cur     public.tire_parameter_sets := private.tire_params_at(p_organization_id, private.maintenance_today(p_organization_id));
  n       public.tire_parameter_sets;
  v_note  text := nullif(btrim(p_payload ->> 'note'), '');
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  n := cur;
  n.measurement_ok_days               := coalesce(nullif(p_payload ->> 'measurement_ok_days', '')::integer, cur.measurement_ok_days);
  n.measurement_warning_days          := coalesce(nullif(p_payload ->> 'measurement_warning_days', '')::integer, cur.measurement_warning_days);
  n.calibration_ok_days               := coalesce(nullif(p_payload ->> 'calibration_ok_days', '')::integer, cur.calibration_ok_days);
  n.calibration_warning_days          := coalesce(nullif(p_payload ->> 'calibration_warning_days', '')::integer, cur.calibration_warning_days);
  n.tread_critical_mm                 := coalesce(nullif(p_payload ->> 'tread_critical_mm', '')::numeric, cur.tread_critical_mm);
  n.tread_attention_mm                := coalesce(nullif(p_payload ->> 'tread_attention_mm', '')::numeric, cur.tread_attention_mm);
  n.max_valid_tread_mm                := coalesce(nullif(p_payload ->> 'max_valid_tread_mm', '')::numeric, cur.max_valid_tread_mm);
  n.max_valid_psi                     := coalesce(nullif(p_payload ->> 'max_valid_psi', '')::numeric, cur.max_valid_psi);
  n.future_date_tolerance_days        := coalesce(nullif(p_payload ->> 'future_date_tolerance_days', '')::integer, cur.future_date_tolerance_days);
  n.tread_min_divergence_tolerance_mm := coalesce(nullif(p_payload ->> 'tread_min_divergence_tolerance_mm', '')::numeric, cur.tread_min_divergence_tolerance_mm);
  n.inspection_tread_tolerance_mm     := coalesce(nullif(p_payload ->> 'inspection_tread_tolerance_mm', '')::numeric, cur.inspection_tread_tolerance_mm);
  n.inspection_psi_tolerance          := coalesce(nullif(p_payload ->> 'inspection_psi_tolerance', '')::numeric, cur.inspection_psi_tolerance);
  n.stale_update_days                 := coalesce(nullif(p_payload ->> 'stale_update_days', '')::integer, cur.stale_update_days);
  n.review_sla_days                   := coalesce(nullif(p_payload ->> 'review_sla_days', '')::integer, cur.review_sla_days);
  n.rodopar_sync_sla_days             := coalesce(nullif(p_payload ->> 'rodopar_sync_sla_days', '')::integer, cur.rodopar_sync_sla_days);
  n.repair_resolution_max_age_days    := coalesce(nullif(p_payload ->> 'repair_resolution_max_age_days', '')::integer, cur.repair_resolution_max_age_days);
  n.retread_alert_use_rodopar_condition := coalesce(nullif(p_payload ->> 'retread_alert_use_rodopar_condition', '')::boolean, cur.retread_alert_use_rodopar_condition);
  n.retread_alert_tread_mm            := case when p_payload ? 'retread_alert_tread_mm'
                                              then nullif(p_payload ->> 'retread_alert_tread_mm', '')::numeric else cur.retread_alert_tread_mm end;
  n.note := coalesce(v_note, cur.note);

  if cur.effective_from = v_today then
    -- mesma data: corrige o conjunto vigente (as checagens da tabela validam)
    update public.tire_parameter_sets set
      measurement_ok_days = n.measurement_ok_days, measurement_warning_days = n.measurement_warning_days,
      calibration_ok_days = n.calibration_ok_days, calibration_warning_days = n.calibration_warning_days,
      tread_critical_mm = n.tread_critical_mm, tread_attention_mm = n.tread_attention_mm,
      max_valid_tread_mm = n.max_valid_tread_mm, max_valid_psi = n.max_valid_psi,
      future_date_tolerance_days = n.future_date_tolerance_days, tread_min_divergence_tolerance_mm = n.tread_min_divergence_tolerance_mm,
      inspection_tread_tolerance_mm = n.inspection_tread_tolerance_mm, inspection_psi_tolerance = n.inspection_psi_tolerance,
      stale_update_days = n.stale_update_days, review_sla_days = n.review_sla_days, rodopar_sync_sla_days = n.rodopar_sync_sla_days,
      repair_resolution_max_age_days = n.repair_resolution_max_age_days,
      retread_alert_use_rodopar_condition = n.retread_alert_use_rodopar_condition, retread_alert_tread_mm = n.retread_alert_tread_mm,
      note = n.note
     where id = cur.id
    returning * into n;
  else
    update public.tire_parameter_sets set effective_to = v_today - 1 where id = cur.id;
    n.id := gen_random_uuid(); n.effective_from := v_today; n.effective_to := null;
    insert into public.tire_parameter_sets select n.*;
    select * into n from public.tire_parameter_sets where id = n.id;
  end if;
  perform private.tire_audit(p_organization_id, 'parameters.saved', 'tire_parameter_set', n.id,
    format('Parâmetros de Pneus vigentes a partir de %s.', to_char(n.effective_from, 'DD/MM/YYYY')), to_jsonb(cur), to_jsonb(n));
  return to_jsonb(n);
end;
$$;

create or replace function public.tire_save_pressure_rule(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_old  public.tire_pressure_rules;
  r      public.tire_pressure_rules;
  v_dim  text := nullif(btrim(p_payload ->> 'dimension'), '');
  v_pos  text := private.tire_position_key(p_payload ->> 'position_code');
  v_type uuid := nullif(p_payload ->> 'vehicle_type_id', '')::uuid;
  v_axle text := nullif(p_payload ->> 'axle_group', '');
  v_from date := coalesce(nullif(p_payload ->> 'valid_from', '')::date, private.maintenance_today(p_organization_id));
  v_to   date := nullif(p_payload ->> 'valid_to', '')::date;
  v_act  boolean := coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true);
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if v_id is not null then
    select * into v_old from public.tire_pressure_rules x where x.id = v_id and x.organization_id = p_organization_id for update;
    if v_old.id is null then raise exception 'Regra não encontrada.' using errcode = 'no_data_found'; end if;
  end if;
  if v_pos is not null and not exists (select 1 from public.tire_positions x where x.organization_id = p_organization_id and x.code = v_pos) then
    raise exception 'Posição % não existe no dicionário de posições.', v_pos using errcode = 'invalid_parameter_value';
  end if;
  if v_type is not null and not exists (select 1 from public.vehicle_types vt where vt.id = v_type
                                         and (vt.organization_id = p_organization_id or vt.organization_id is null)) then
    raise exception 'Tipo de equipamento não encontrado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_act and exists (select 1 from public.tire_pressure_rules x
                        where x.organization_id = p_organization_id and x.is_active and x.id is distinct from v_id
                          and x.vehicle_type_id is not distinct from v_type
                          and x.dimension_key is not distinct from private.tire_dimension_key(v_dim)
                          and x.position_code is not distinct from v_pos and x.axle_group is not distinct from v_axle
                          and daterange(x.valid_from, x.valid_to, '[]') && daterange(v_from, v_to, '[]')) then
    raise exception 'Já existe uma regra ativa para a mesma combinação e vigência.' using errcode = 'unique_violation';
  end if;

  if v_id is null then
    insert into public.tire_pressure_rules (organization_id, vehicle_type_id, dimension, dimension_key, position_code, axle_group,
      min_psi, ideal_psi, max_psi, min_legal_tread_mm, attention_tread_mm, is_active, valid_from, valid_to, notes)
    values (p_organization_id, v_type, v_dim, private.tire_dimension_key(v_dim), v_pos, v_axle,
      (p_payload ->> 'min_psi')::numeric, (p_payload ->> 'ideal_psi')::numeric, (p_payload ->> 'max_psi')::numeric,
      nullif(p_payload ->> 'min_legal_tread_mm', '')::numeric, nullif(p_payload ->> 'attention_tread_mm', '')::numeric,
      v_act, v_from, v_to, nullif(btrim(p_payload ->> 'notes'), ''))
    returning * into r;
  else
    update public.tire_pressure_rules set vehicle_type_id = v_type, dimension = v_dim, dimension_key = private.tire_dimension_key(v_dim),
      position_code = v_pos, axle_group = v_axle, min_psi = (p_payload ->> 'min_psi')::numeric, ideal_psi = (p_payload ->> 'ideal_psi')::numeric,
      max_psi = (p_payload ->> 'max_psi')::numeric, min_legal_tread_mm = nullif(p_payload ->> 'min_legal_tread_mm', '')::numeric,
      attention_tread_mm = nullif(p_payload ->> 'attention_tread_mm', '')::numeric, is_active = v_act, valid_from = v_from, valid_to = v_to,
      notes = nullif(btrim(p_payload ->> 'notes'), '')
     where id = v_id
    returning * into r;
  end if;
  perform private.tire_audit(p_organization_id, case when v_id is null then 'pressure_rule.created' else 'pressure_rule.updated' end,
    'tire_pressure_rule', r.id, format('Regra de PSI %s/%s/%s (%s).', r.min_psi, r.ideal_psi, r.max_psi, coalesce(r.dimension, 'todas as dimensões')),
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

create or replace function public.tire_save_position(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.tire_position_key(p_payload ->> 'code');
  v_old  public.tire_positions;
  r      public.tire_positions;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if v_code is null then raise exception 'Informe o código da posição.' using errcode = 'invalid_parameter_value'; end if;
  select * into v_old from public.tire_positions x where x.organization_id = p_organization_id and x.code = v_code;
  insert into public.tire_positions (organization_id, code, label, axle_group, axle_index, side, slot, sort_order, is_active)
  values (p_organization_id, v_code, btrim(p_payload ->> 'label'), coalesce(nullif(p_payload ->> 'axle_group', ''), 'other'),
          coalesce(nullif(p_payload ->> 'axle_index', '')::smallint, 1), coalesce(nullif(p_payload ->> 'side', ''), 'center'),
          coalesce(nullif(p_payload ->> 'slot', ''), 'single'), coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, 100),
          coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true))
  on conflict (organization_id, code) do update set label = excluded.label, axle_group = excluded.axle_group, axle_index = excluded.axle_index,
    side = excluded.side, slot = excluded.slot, sort_order = excluded.sort_order, is_active = excluded.is_active
  returning * into r;
  perform private.tire_audit(p_organization_id, 'position.saved', 'tire_position', r.id, format('Posição %s — %s.', r.code, r.label),
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

create or replace function public.tire_save_layout(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_codes text[] := array(select distinct private.tire_position_key(x) from jsonb_array_elements_text(coalesce(p_payload -> 'position_codes', '[]'::jsonb)) x
                           where private.tire_position_key(x) is not null);
  v_bad   text[];
  v_old   public.tire_layouts;
  r       public.tire_layouts;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if cardinality(v_codes) = 0 then raise exception 'Selecione ao menos uma posição.' using errcode = 'invalid_parameter_value'; end if;
  select array(select c from unnest(v_codes) c where not exists (select 1 from public.tire_positions x
                 where x.organization_id = p_organization_id and x.code = c and x.is_active)) into v_bad;
  if cardinality(v_bad) > 0 then
    raise exception 'Posições inexistentes ou inativas: %.', array_to_string(v_bad, ', ') using errcode = 'invalid_parameter_value';
  end if;
  if v_id is null then
    insert into public.tire_layouts (organization_id, code, name, description, position_codes, is_active)
    values (p_organization_id, lower(btrim(p_payload ->> 'code')), btrim(p_payload ->> 'name'), nullif(btrim(p_payload ->> 'description'), ''),
            v_codes, coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true))
    returning * into r;
  else
    select * into v_old from public.tire_layouts x where x.id = v_id and x.organization_id = p_organization_id for update;
    if v_old.id is null then raise exception 'Layout não encontrado.' using errcode = 'no_data_found'; end if;
    update public.tire_layouts set name = btrim(p_payload ->> 'name'), description = nullif(btrim(p_payload ->> 'description'), ''),
           position_codes = v_codes, is_active = coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true)
     where id = v_id returning * into r;
  end if;
  perform private.tire_audit(p_organization_id, 'layout.saved', 'tire_layout', r.id, format('Layout %s com %s posições.', r.name, cardinality(r.position_codes)),
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

create or replace function public.tire_set_vehicle_type_layout(p_organization_id uuid, p_vehicle_type_id uuid, p_layout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_old uuid;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if p_layout_id is not null and not exists (select 1 from public.tire_layouts l where l.id = p_layout_id and l.organization_id = p_organization_id) then
    raise exception 'Layout não encontrado.' using errcode = 'no_data_found';
  end if;
  select tl.layout_id into v_old from public.tire_vehicle_type_layouts tl where tl.organization_id = p_organization_id and tl.vehicle_type_id = p_vehicle_type_id;
  insert into public.tire_vehicle_type_layouts (organization_id, vehicle_type_id, layout_id)
  values (p_organization_id, p_vehicle_type_id, p_layout_id)
  on conflict (organization_id, vehicle_type_id) do update set layout_id = excluded.layout_id;
  perform private.tire_audit(p_organization_id, 'layout.vehicle_type', 'vehicle_type', p_vehicle_type_id,
    'Layout padrão de pneus do tipo de equipamento alterado.', jsonb_build_object('layout_id', v_old), jsonb_build_object('layout_id', p_layout_id));
  return jsonb_build_object('vehicle_type_id', p_vehicle_type_id, 'layout_id', p_layout_id);
end;
$$;

create or replace function public.tire_set_vehicle_layout(p_organization_id uuid, p_vehicle_id uuid, p_layout_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_old uuid;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if not exists (select 1 from public.vehicles v where v.id = p_vehicle_id and v.organization_id = p_organization_id) then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if p_layout_id is not null and not exists (select 1 from public.tire_layouts l where l.id = p_layout_id and l.organization_id = p_organization_id) then
    raise exception 'Layout não encontrado.' using errcode = 'no_data_found';
  end if;
  select vl.layout_id into v_old from public.tire_vehicle_layouts vl where vl.organization_id = p_organization_id and vl.vehicle_id = p_vehicle_id;
  insert into public.tire_vehicle_layouts (organization_id, vehicle_id, layout_id, reason)
  values (p_organization_id, p_vehicle_id, p_layout_id, left(nullif(btrim(p_reason), ''), 300))
  on conflict (organization_id, vehicle_id) do update set layout_id = excluded.layout_id, reason = excluded.reason;
  perform private.tire_audit(p_organization_id, 'layout.vehicle', 'vehicle', p_vehicle_id,
    coalesce(nullif(btrim(p_reason), ''), 'Layout de pneus do veículo alterado.'), jsonb_build_object('layout_id', v_old), jsonb_build_object('layout_id', p_layout_id));
  return jsonb_build_object('vehicle_id', p_vehicle_id, 'layout_id', p_layout_id);
end;
$$;

create or replace function public.tire_save_service_kind(p_organization_id uuid, p_service_id uuid, p_kind text, p_active boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_old public.tire_maintenance_service_kinds; r public.tire_maintenance_service_kinds;
begin
  perform private.tire_require(p_organization_id, 'tires.parameters.manage');
  if not exists (select 1 from public.maintenance_services s where s.id = p_service_id and s.organization_id = p_organization_id) then
    raise exception 'Serviço não encontrado no catálogo da Manutenção.' using errcode = 'no_data_found';
  end if;
  select * into v_old from public.tire_maintenance_service_kinds k where k.organization_id = p_organization_id and k.service_id = p_service_id;
  insert into public.tire_maintenance_service_kinds (organization_id, service_id, kind, is_active)
  values (p_organization_id, p_service_id, coalesce(p_kind, coalesce(v_old.kind, 'tire_service')), coalesce(p_active, true))
  on conflict (organization_id, service_id) do update set kind = excluded.kind, is_active = excluded.is_active
  returning * into r;
  perform private.tire_audit(p_organization_id, 'service_kind.saved', 'maintenance_service', p_service_id,
    'Mapeamento de serviço da Manutenção para Pneus alterado.', case when v_old.service_id is null then null else to_jsonb(v_old) end, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Exportação auditada e trilha de auditoria
-- -----------------------------------------------------------------------------
create or replace function public.log_tire_export(p_organization_id uuid, p_kind text, p_filters jsonb, p_rows integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.tire_require(p_organization_id, 'tires.export');
  perform private.tire_audit(p_organization_id, 'export.' || left(coalesce(p_kind, 'base'), 40), 'export', null,
    format('Exportação "%s" com %s linhas.', p_kind, coalesce(p_rows, 0)), null,
    jsonb_build_object('kind', p_kind, 'filters', coalesce(p_filters, '{}'::jsonb), 'rows', p_rows));
end;
$$;

create or replace function public.tires_audit_list(p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
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
  f_action text := nullif(f ->> 'action', '');
  f_search text := nullif(btrim(f ->> 'search'), '');
begin
  perform private.tire_require(p_organization_id, 'tires.audit.view');
  return (
    with q as (
      select a.* from public.tire_audit_events a
       where a.organization_id = p_organization_id
         and (f_action is null or a.action like f_action || '%')
         and (f_search is null or coalesce(a.summary, '') ilike '%' || f_search || '%' or coalesce(a.actor_name, '') ilike '%' || f_search || '%')),
    o as (select q.*, row_number() over (order by q.created_at desc) as rn from q)
    select jsonb_build_object(
      'total', (select count(*) from o),
      'actions', coalesce((select jsonb_agg(x.a order by x.a) from (select distinct split_part(a.action, '.', 1) as a
                             from public.tire_audit_events a where a.organization_id = p_organization_id) x), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
      'limit', v_limit, 'offset', v_offset));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_resolve_vehicle_at(uuid, uuid, date) from public, anon;
grant execute on function private.tire_resolve_vehicle_at(uuid, uuid, date) to authenticated, service_role;
revoke execute on function public.tire_repair_resolve(uuid, text, date), public.tire_repair_save(uuid, jsonb), public.tire_repair_void(uuid, uuid, text),
  public.tire_repairs_list(uuid, jsonb, integer, integer), public.tire_maintenance_services(uuid, jsonb, integer, integer),
  public.tire_save_parameters(uuid, jsonb), public.tire_save_pressure_rule(uuid, jsonb), public.tire_save_position(uuid, jsonb),
  public.tire_save_layout(uuid, jsonb), public.tire_set_vehicle_type_layout(uuid, uuid, uuid), public.tire_set_vehicle_layout(uuid, uuid, uuid, text),
  public.tire_save_service_kind(uuid, uuid, text, boolean), public.log_tire_export(uuid, text, jsonb, integer),
  public.tires_audit_list(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.tire_repair_resolve(uuid, text, date), public.tire_repair_save(uuid, jsonb), public.tire_repair_void(uuid, uuid, text),
  public.tire_repairs_list(uuid, jsonb, integer, integer), public.tire_maintenance_services(uuid, jsonb, integer, integer),
  public.tire_save_parameters(uuid, jsonb), public.tire_save_pressure_rule(uuid, jsonb), public.tire_save_position(uuid, jsonb),
  public.tire_save_layout(uuid, jsonb), public.tire_set_vehicle_type_layout(uuid, uuid, uuid), public.tire_set_vehicle_layout(uuid, uuid, uuid, text),
  public.tire_save_service_kind(uuid, uuid, text, boolean), public.log_tire_export(uuid, text, jsonb, integer),
  public.tires_audit_list(uuid, jsonb, integer, integer) to authenticated, service_role;
