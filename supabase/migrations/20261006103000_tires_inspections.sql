-- =============================================================================
-- Aplicativos › Vistoria de Pneus (leitura cega) e Gestão de Pneus › Vistorias
-- recebidas, com reconciliação automática na importação do Rodopar 10.
--
-- Regras:
--   * O servidor entrega ao campo apenas o veículo e as posições a verificar —
--     nunca Nº Fogo esperado, sulcos, PSI ou PSI recomendado.
--   * A comparação com a fotografia oficial acontece no servidor, depois do
--     envio. A vistoria NUNCA altera a fotografia, o cadastro ou os eventos.
--   * Workflow: pendente_revisao → pendente_rodopar | retornar_divergencia;
--     retornar_divergencia → pendente_revisao; pendente_rodopar →
--     sincronizado_rodopar | retornar_divergencia. Uma nova medição enviada
--     sobre uma vistoria retornada a marca como "substituida".
--   * Reconciliação: ao confirmar uma nova fotografia, cada vistoria pendente
--     de Rodopar é comparada com ela (Nº Fogo, sulcos, PSI e datas): se os
--     valores medidos chegaram, vira sincronizado_rodopar; se a fotografia já
--     é posterior à vistoria e continua diferente, divergência persistente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Apoio: aplicativo, posições esperadas do veículo
-- -----------------------------------------------------------------------------
create or replace function private.tire_app(p_organization_id uuid)
returns public.operational_apps
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.operational_apps a
   where a.organization_id = p_organization_id and a.code = 'vistoria_pneus' and a.deleted_at is null;
$$;

-- Posições a verificar: layout do veículo ∪ posições ocupadas na fotografia
-- oficial (com atributos para o esquema de eixos). Sem nenhum dado do pneu.
create or replace function private.tire_expected_positions(p_organization_id uuid, p_vehicle_id uuid, p_reference_date date)
returns table (code text, label text, axle_group text, axle_index smallint, side text, slot text, sort_order smallint, in_layout boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select * from private.tire_vehicle_layout(p_organization_id, p_vehicle_id, p_reference_date)),
  codes as (
    select unnest(coalesce((select l.position_codes from l), '{}')) as code, true as in_layout
    union
    select s.position_code, false
      from public.tire_daily_snapshots s
     where s.organization_id = p_organization_id and s.vehicle_id = p_vehicle_id and s.reference_date = p_reference_date
       and s.canonical_status = 'em_uso' and s.position_code is not null),
  dedup as (select c.code, bool_or(c.in_layout) as in_layout from codes c where c.code is not null group by c.code)
  select d.code, coalesce(pos.label, d.code), coalesce(pos.axle_group, 'other'), coalesce(pos.axle_index, 9::smallint),
         coalesce(pos.side, 'center'), coalesce(pos.slot, 'single'), coalesce(pos.sort_order, 999::smallint), d.in_layout
    from dedup d
    left join public.tire_positions pos on pos.organization_id = p_organization_id and pos.code = d.code;
$$;

create or replace function private.tire_inspection_vehicle_check(p_organization_id uuid, p_vehicle_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app   public.operational_apps := private.tire_app(p_organization_id);
  v_veh   record;
  v_ctx   jsonb;
begin
  if v_app.id is null or not v_app.is_active then
    raise exception 'O aplicativo Vistoria de Pneus não está disponível nesta organização.' using errcode = 'invalid_parameter_value';
  end if;
  select v.id, v.status, v.license_plate, v.fleet_code, v.vehicle_type_id into v_veh
    from public.vehicles v where v.id = p_vehicle_id and v.organization_id = p_organization_id and v.deleted_at is null;
  if v_veh.id is null then raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found'; end if;
  if v_veh.status <> 'active' then raise exception 'Frota inativa: a vistoria só é registrada para frotas ativas.' using errcode = 'invalid_parameter_value'; end if;
  if not private.vehicle_in_scope(p_organization_id, v_veh.id) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  v_ctx := private.maintenance_context(p_organization_id, v_veh.id, p_date);
  if (v_ctx ->> 'operation_id') is null then
    raise exception 'Veículo sem operação vigente na data: não é elegível para a vistoria.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_operation((v_ctx ->> 'operation_id')::uuid) then
    raise exception 'Operação do veículo fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  if not private.app_vehicle_eligible(p_organization_id, v_app.id, v_veh.id, (v_ctx ->> 'operation_id')::uuid, p_date) then
    raise exception 'Operação ou tipo de equipamento não habilitado para a Vistoria de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  return v_ctx || jsonb_build_object('app_id', v_app.id, 'license_plate', v_veh.license_plate, 'fleet_code', v_veh.fleet_code,
                                     'vehicle_type_id', v_veh.vehicle_type_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Aplicativo: contexto, frotas elegíveis e posições (cego)
-- -----------------------------------------------------------------------------
create or replace function public.tire_inspection_context(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app   public.operational_apps := private.tire_app(p_organization_id);
  v_today date := private.maintenance_today(p_organization_id);
  v_actor record;
  p       public.tire_parameter_sets := private.tire_params_at(p_organization_id, private.maintenance_today(p_organization_id));
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  select * into v_actor from private.checklist_actor(p_organization_id) limit 1;
  return jsonb_build_object(
    'today', v_today,
    'app', case when v_app.id is null then null else jsonb_build_object('id', v_app.id, 'name', v_app.name, 'is_active', v_app.is_active) end,
    'actor', jsonb_build_object('user_id', auth.uid(), 'name', coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)),
                                'code', v_actor.employee_code, 'has_employee', v_actor.employee_id is not null),
    'limits', jsonb_build_object('max_tread_mm', p.max_valid_tread_mm, 'max_psi', p.max_valid_psi,
                                 'fire_number_pattern', '^[0-9A-Z][0-9A-Z./_-]{0,29}$'),
    'has_official_photo', private.tire_latest_reference(p_organization_id) is not null,
    'counts', jsonb_build_object(
      'mine_pending', (select count(*) from public.tire_inspections i where i.organization_id = p_organization_id
                         and i.inspector_user_id = auth.uid() and i.status in ('pendente_revisao', 'pendente_rodopar')),
      'mine_returned', (select count(*) from public.tire_inspections i where i.organization_id = p_organization_id
                          and i.inspector_user_id = auth.uid() and i.status = 'retornar_divergencia')));
end;
$$;

create or replace function public.tire_inspection_vehicles(p_organization_id uuid, p_search text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app    public.operational_apps := private.tire_app(p_organization_id);
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_search text := nullif(btrim(p_search), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ids    uuid[];
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  if v_app.id is null or not v_app.is_active then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'total', 0, 'app_available', false);
  end if;
  select coalesce(array_agg(v.id), '{}') into v_ids
    from public.vehicles v
   where v.organization_id = p_organization_id and v.deleted_at is null and v.status = 'active'
     and private.vehicle_in_scope(p_organization_id, v.id)
     and (v_search is null or v.license_plate like '%' || coalesce(private.normalize_plate(v_search), '#') || '%'
          or upper(coalesce(v.fleet_code, '')) like '%' || upper(v_search) || '%');
  with c as (
    select c.* from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_today, array[cardinality(v_ids)])) c),
  e as (
    select v.id, v.license_plate, v.fleet_code, vt.name as vehicle_type_name, c.operation_id, o.name as operation_name,
           ci.name as city_name, st.uf::text as state_uf, b.code as br_code
      from public.vehicles v
      join c on c.vehicle_id = v.id
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
      left join public.operations o on o.id = c.operation_id
      left join public.cities ci on ci.id = c.city_id
      left join public.states st on st.id = c.state_id
      left join public.operation_brs b on b.id = c.operation_br_id
     where c.operation_id is not null and private.can_access_operation(c.operation_id)
       and private.app_vehicle_eligible(p_organization_id, v_app.id, v.id, c.operation_id, v_today))
  select jsonb_build_object(
    'app_available', true,
    'total', (select count(*) from e),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'license_plate', e.license_plate, 'fleet_code', e.fleet_code, 'vehicle_type_name', e.vehicle_type_name,
        'operation_name', e.operation_name, 'city_name', e.city_name, 'state_uf', e.state_uf, 'br_code', e.br_code,
        'positions', (select count(*) from private.tire_expected_positions(p_organization_id, e.id, v_latest)),
        'returned_inspection_id', (select i.id from public.tire_inspections i where i.organization_id = p_organization_id
                                    and i.vehicle_id = e.id and i.inspector_user_id = auth.uid() and i.status = 'retornar_divergencia'
                                    order by i.submitted_at desc limit 1),
        'last_inspection_date', (select max(i.inspection_date) from public.tire_inspections i where i.organization_id = p_organization_id
                                   and i.vehicle_id = e.id and i.status <> 'substituida'))
        order by e.fleet_code nulls last, e.license_plate)
        from (select * from e order by e.fleet_code nulls last, e.license_plate limit v_limit) e), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;

create or replace function public.tire_inspection_positions(p_organization_id uuid, p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ctx    jsonb;
  v_layout record;
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  v_ctx := private.tire_inspection_vehicle_check(p_organization_id, p_vehicle_id, v_today);
  select * into v_layout from private.tire_vehicle_layout(p_organization_id, p_vehicle_id, v_latest) limit 1;
  -- leitura cega: só veículo e posições; nenhum Nº Fogo, sulco ou PSI
  return jsonb_build_object(
    'vehicle', jsonb_build_object('id', p_vehicle_id, 'license_plate', v_ctx ->> 'license_plate', 'fleet_code', v_ctx ->> 'fleet_code',
                                  'operation_name', v_ctx ->> 'operation_name', 'city_name', v_ctx ->> 'city_name',
                                  'state_uf', v_ctx ->> 'state_uf', 'br_code', v_ctx ->> 'br_code', 'leader_name', v_ctx ->> 'leader_name',
                                  'vehicle_type_name', (select vt.name from public.vehicle_types vt where vt.id = (v_ctx ->> 'vehicle_type_id')::uuid)),
    'layout', jsonb_build_object('source', v_layout.layout_source, 'name', v_layout.layout_name),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'axle_group', x.axle_group,
                              'axle_index', x.axle_index, 'side', x.side, 'slot', x.slot, 'sort_order', x.sort_order)
                              order by x.sort_order, x.code)
                            from private.tire_expected_positions(p_organization_id, p_vehicle_id, v_latest) x), '[]'::jsonb),
    'returned_inspection', (select jsonb_build_object('id', i.id, 'protocol', i.protocol, 'review_note', i.review_note, 'reviewed_at', i.reviewed_at)
                              from public.tire_inspections i where i.organization_id = p_organization_id and i.vehicle_id = p_vehicle_id
                               and i.inspector_user_id = auth.uid() and i.status = 'retornar_divergencia'
                             order by i.submitted_at desc limit 1));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Envio: idempotente, validado e comparado no servidor (nunca toca a base)
-- -----------------------------------------------------------------------------
create or replace function public.tire_inspection_submit(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub      uuid;
  v_existing public.tire_inspections;
  v_vehicle  uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_parent   uuid := nullif(p_payload ->> 'parent_inspection_id', '')::uuid;
  v_today    date := private.maintenance_today(p_organization_id);
  v_at       timestamptz := coalesce(nullif(p_payload ->> 'inspected_at', '')::timestamptz, now());
  v_date     date;
  v_latest   date := private.tire_latest_reference(p_organization_id);
  v_ctx      jsonb;
  v_actor    record;
  v_layout   record;
  v_protocol text;
  v_id       uuid;
  v_parent_r public.tire_inspections;
  p          public.tire_parameter_sets;
  it         jsonb;
  v_pos      text;
  v_fire     text;
  n_expected integer; n_measured integer; n_div integer; n_divs integer;
  v_tz       text;
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  begin
    v_sub := nullif(p_payload ->> 'client_submission_id', '')::uuid;
  exception when others then v_sub := null; end;
  if v_sub is null then raise exception 'Identificador do envio ausente.' using errcode = 'invalid_parameter_value'; end if;

  select * into v_existing from public.tire_inspections i where i.organization_id = p_organization_id and i.client_submission_id = v_sub;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'protocol', v_existing.protocol, 'submitted_at', v_existing.submitted_at,
                              'positions_expected', v_existing.positions_expected, 'positions_measured', v_existing.positions_measured,
                              'duplicate', true);
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_organization_id;
  v_date := (v_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date;
  if v_date > v_today then raise exception 'A data da vistoria não pode ser futura.' using errcode = 'invalid_parameter_value'; end if;
  if v_date < v_today - 30 then raise exception 'A vistoria não pode ter mais de 30 dias.' using errcode = 'invalid_parameter_value'; end if;
  if v_vehicle is null then raise exception 'Selecione o veículo.' using errcode = 'invalid_parameter_value'; end if;
  v_ctx := private.tire_inspection_vehicle_check(p_organization_id, v_vehicle, v_date);
  p := private.tire_params_at(p_organization_id, v_date);

  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Nenhuma posição informada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(coalesce(p_payload ->> 'general_observation', '')) > 1000 then
    raise exception 'Observação geral acima de 1.000 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  -- validação de cada posição: pertence ao veículo, valores dentro dos limites técnicos
  for it in select x from jsonb_array_elements(p_payload -> 'items') x loop
    v_pos := private.tire_position_key(it ->> 'position_code');
    if v_pos is null or not exists (select 1 from private.tire_expected_positions(p_organization_id, v_vehicle, v_latest) e where e.code = v_pos) then
      raise exception 'Posição "%" não pertence a este veículo.', coalesce(it ->> 'position_code', '')
        using errcode = 'invalid_parameter_value', hint = 'POSICAO_NAO_ENCONTRADA';
    end if;
    v_fire := private.tire_fire_number(it ->> 'fire_number_read');
    if v_fire is not null and v_fire !~ '^[0-9A-Z][0-9A-Z./_-]{0,29}$' then
      raise exception 'Nº Fogo inválido na posição %.', v_pos using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from unnest(array[it ->> 'tread_1', it ->> 'tread_2', it ->> 'tread_3', it ->> 'tread_4']) x
                where x is not null and btrim(x) <> ''
                  and (private.tire_cell_num(to_jsonb(x)) = 'NaN' or private.tire_cell_num(to_jsonb(x)) < 0
                       or private.tire_cell_num(to_jsonb(x)) > p.max_valid_tread_mm)) then
      raise exception 'Sulco inválido na posição % (aceito de 0 a % mm).', v_pos, p.max_valid_tread_mm using errcode = 'invalid_parameter_value';
    end if;
    if nullif(btrim(it ->> 'psi_read'), '') is not null and (private.tire_cell_num(it -> 'psi_read') = 'NaN'
        or private.tire_cell_num(it -> 'psi_read') < 0 or private.tire_cell_num(it -> 'psi_read') > p.max_valid_psi) then
      raise exception 'PSI inválido na posição % (aceito de 0 a %).', v_pos, p.max_valid_psi using errcode = 'invalid_parameter_value';
    end if;
    if length(coalesce(it ->> 'observation', '')) > 500 then
      raise exception 'Observação da posição % acima de 500 caracteres.', v_pos using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  if v_parent is not null then
    select * into v_parent_r from public.tire_inspections i where i.id = v_parent and i.organization_id = p_organization_id for update;
    if v_parent_r.id is null or v_parent_r.vehicle_id <> v_vehicle or v_parent_r.status <> 'retornar_divergencia' then
      raise exception 'A vistoria de origem não está retornada para nova medição deste veículo.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  select * into v_actor from private.checklist_actor(p_organization_id) limit 1;
  select * into v_layout from private.tire_vehicle_layout(p_organization_id, v_vehicle, v_latest) limit 1;
  v_protocol := private.next_entity_code(p_organization_id, 'tire_inspection:' || to_char(v_date, 'YYYY'), 'PNEU-' || to_char(v_date, 'YYYY') || '-', 6);

  insert into public.tire_inspections (
    organization_id, protocol, client_submission_id, app_id, parent_inspection_id, vehicle_id, license_plate_snapshot, fleet_code_snapshot,
    vehicle_type_id, context_date, context_source, operation_id, operation_city_id, state_id, city_id, operation_br_id,
    fidelization_assignment_id, organization_unit_id, leader_employee_id, operation_name_snapshot, city_name_snapshot,
    state_uf_snapshot, br_code_snapshot, unit_name_snapshot, leader_name_snapshot, vehicle_type_name_snapshot,
    inspector_user_id, inspector_employee_id, inspector_name_snapshot, inspector_code_snapshot,
    inspection_date, started_at, inspected_at, reference_snapshot_date, reference_batch_id, layout_source, layout_id,
    general_observation, status)
  values (
    p_organization_id, v_protocol, v_sub, (v_ctx ->> 'app_id')::uuid, v_parent, v_vehicle, v_ctx ->> 'license_plate', v_ctx ->> 'fleet_code',
    (v_ctx ->> 'vehicle_type_id')::uuid, v_date, v_ctx ->> 'source', (v_ctx ->> 'operation_id')::uuid, (v_ctx ->> 'operation_city_id')::uuid,
    (v_ctx ->> 'state_id')::smallint, (v_ctx ->> 'city_id')::integer, (v_ctx ->> 'operation_br_id')::uuid,
    (v_ctx ->> 'fidelization_assignment_id')::uuid, (v_ctx ->> 'organization_unit_id')::uuid, (v_ctx ->> 'leader_employee_id')::uuid,
    v_ctx ->> 'operation_name', v_ctx ->> 'city_name', v_ctx ->> 'state_uf', v_ctx ->> 'br_code', v_ctx ->> 'unit_name', v_ctx ->> 'leader_name',
    (select vt.name from public.vehicle_types vt where vt.id = (v_ctx ->> 'vehicle_type_id')::uuid),
    auth.uid(), v_actor.employee_id, coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)), v_actor.employee_code,
    v_date, nullif(p_payload ->> 'started_at', '')::timestamptz, v_at, v_latest,
    (select b.id from public.tire_import_batches b where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_latest),
    coalesce(v_layout.layout_source, 'snapshot'), v_layout.layout_id,
    nullif(btrim(p_payload ->> 'general_observation'), ''), 'pendente_revisao')
  returning id into v_id;

  -- itens: todas as posições esperadas (as não medidas também), com a
  -- referência oficial congelada e as divergências calculadas aqui
  with exp as (select * from private.tire_expected_positions(p_organization_id, v_vehicle, v_latest)),
  sent as (
    select private.tire_position_key(x ->> 'position_code') as code,
           private.tire_fire_number(x ->> 'fire_number_read') as fire,
           private.tire_cell_num(x -> 'tread_1') as t1, private.tire_cell_num(x -> 'tread_2') as t2,
           private.tire_cell_num(x -> 'tread_3') as t3, private.tire_cell_num(x -> 'tread_4') as t4,
           private.tire_cell_num(x -> 'psi_read') as psi, nullif(btrim(x ->> 'observation'), '') as obs
      from jsonb_array_elements(p_payload -> 'items') x),
  j as (
    select exp.code, exp.label, exp.sort_order, sent.fire, sent.t1, sent.t2, sent.t3, sent.t4, sent.psi, sent.obs,
           (sent.fire is not null or sent.t1 is not null or sent.t2 is not null or sent.t3 is not null or sent.t4 is not null or sent.psi is not null) as measured,
           ref.id as ref_id, ref.tire_id as ref_tire, ref.fire_number as ref_fire, ref.tread_1 as r1, ref.tread_2 as r2, ref.tread_3 as r3,
           ref.tread_4 as r4, ref.tread_min as rmin, ref.psi as rpsi, ref.measurement_date as rmd, ref.calibration_date as rcd,
           elsewhere.label as found_at
      from exp
      left join sent on sent.code = exp.code
      left join lateral (select s.* from public.tire_daily_snapshots s
                          where s.organization_id = p_organization_id and s.reference_date = v_latest and s.vehicle_id = v_vehicle
                            and s.position_code = exp.code and s.canonical_status = 'em_uso'
                          order by s.fire_number limit 1) ref on true
      left join lateral (select coalesce('frota ' || coalesce(s.fleet_number_snapshot, s.fleet_number_raw) || ', posição ' || s.position_code,
                                         'situação ' || s.canonical_status) as label
                           from public.tire_daily_snapshots s
                          where s.organization_id = p_organization_id and s.reference_date = v_latest and sent.fire is not null
                            and s.fire_number = sent.fire and not (s.vehicle_id is not distinct from v_vehicle and s.position_code = exp.code)
                          limit 1) elsewhere on true),
  d as (
    select j.*,
      to_jsonb(array_remove(array[
        case when j.measured and j.ref_id is null then jsonb_build_object('type', 'SEM_REFERENCIA',
             'detail', 'A fotografia oficial não tem pneu em uso nesta posição.') end,
        case when j.measured and j.ref_id is not null and j.fire is not null and j.fire <> j.ref_fire then jsonb_build_object('type', 'PNEU_DIFERENTE',
             'detail', format('Nº Fogo lido %s difere do esperado %s.', j.fire, j.ref_fire)) end,
        case when j.measured and j.found_at is not null then jsonb_build_object('type', 'POSICAO_NAO_ENCONTRADA',
             'detail', format('Na fotografia oficial o Nº Fogo %s está em %s.', j.fire, j.found_at)) end,
        case when j.measured and j.ref_id is not null and (
               (j.t1 is not null and j.r1 is not null and abs(j.t1 - j.r1) > p.inspection_tread_tolerance_mm)
            or (j.t2 is not null and j.r2 is not null and abs(j.t2 - j.r2) > p.inspection_tread_tolerance_mm)
            or (j.t3 is not null and j.r3 is not null and abs(j.t3 - j.r3) > p.inspection_tread_tolerance_mm)
            or (j.t4 is not null and j.r4 is not null and abs(j.t4 - j.r4) > p.inspection_tread_tolerance_mm))
             then jsonb_build_object('type', 'SULCO_DIVERGENTE', 'detail', concat_ws(' · ',
               case when j.t1 is not null and j.r1 is not null and abs(j.t1 - j.r1) > p.inspection_tread_tolerance_mm then format('S1: %s × %s mm', j.t1, j.r1) end,
               case when j.t2 is not null and j.r2 is not null and abs(j.t2 - j.r2) > p.inspection_tread_tolerance_mm then format('S2: %s × %s mm', j.t2, j.r2) end,
               case when j.t3 is not null and j.r3 is not null and abs(j.t3 - j.r3) > p.inspection_tread_tolerance_mm then format('S3: %s × %s mm', j.t3, j.r3) end,
               case when j.t4 is not null and j.r4 is not null and abs(j.t4 - j.r4) > p.inspection_tread_tolerance_mm then format('S4: %s × %s mm', j.t4, j.r4) end)) end,
        case when j.measured and j.ref_id is not null and j.psi is not null and j.rpsi is not null and abs(j.psi - j.rpsi) > p.inspection_psi_tolerance
             then jsonb_build_object('type', 'PSI_DIVERGENTE', 'detail', format('PSI lido %s × oficial %s.', j.psi, j.rpsi)) end,
        case when not j.measured then jsonb_build_object('type', 'MEDICAO_INCOMPLETA', 'detail', 'Posição não medida.')
             when j.fire is null or j.t1 is null or j.t2 is null or j.t3 is null or j.t4 is null or j.psi is null
             then jsonb_build_object('type', 'MEDICAO_INCOMPLETA', 'detail', 'Faltou: ' || concat_ws(', ',
               case when j.fire is null then 'Nº Fogo' end, case when j.t1 is null then 'S1' end, case when j.t2 is null then 'S2' end,
               case when j.t3 is null then 'S3' end, case when j.t4 is null then 'S4' end, case when j.psi is null then 'PSI' end)) end
      ], null)) as divs
      from j)
  insert into public.tire_inspection_items (
    organization_id, inspection_id, position_code, position_label_snapshot, sort_order, measured, fire_number_read,
    tread_1, tread_2, tread_3, tread_4, psi_read, observation, expected_tire_id, expected_fire_number, ref_snapshot_id,
    ref_tread_1, ref_tread_2, ref_tread_3, ref_tread_4, ref_tread_min, ref_psi, ref_measurement_date, ref_calibration_date,
    divergences, has_divergence, sync_status)
  select p_organization_id, v_id, d.code, d.label, d.sort_order, d.measured, d.fire, d.t1, d.t2, d.t3, d.t4, d.psi, d.obs,
         d.ref_tire, d.ref_fire, d.ref_id, d.r1, d.r2, d.r3, d.r4, d.rmin, d.rpsi, d.rmd, d.rcd,
         coalesce(d.divs, '[]'::jsonb),
         exists (select 1 from jsonb_array_elements(coalesce(d.divs, '[]'::jsonb)) x where x ->> 'type' <> 'MEDICAO_INCOMPLETA'),
         case when d.measured then 'pending' else 'not_applicable' end
    from d;

  select count(*), count(*) filter (where i.measured), count(*) filter (where i.has_divergence),
         coalesce(sum(jsonb_array_length(i.divergences)), 0)
    into n_expected, n_measured, n_div, n_divs
    from public.tire_inspection_items i where i.inspection_id = v_id;
  if n_measured = 0 then
    raise exception 'Meça ao menos uma posição antes de enviar.' using errcode = 'invalid_parameter_value';
  end if;
  update public.tire_inspections set positions_expected = n_expected, positions_measured = n_measured,
         positions_divergent = n_div, divergence_count = n_divs
   where id = v_id;

  insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, actor_user_id, actor_name)
  values (p_organization_id, v_id, null, 'pendente_revisao', 'Vistoria enviada pelo aplicativo (leitura cega).', 'user', auth.uid(),
          coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)));

  if v_parent_r.id is not null then
    update public.tire_inspections set status = 'substituida', updated_at = now() where id = v_parent_r.id;
    insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, actor_user_id, actor_name)
    values (p_organization_id, v_parent_r.id, 'retornar_divergencia', 'substituida', format('Nova medição enviada: protocolo %s.', v_protocol),
            'system', auth.uid(), coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)));
  end if;

  perform private.emit_event(p_organization_id, 'tires.inspection.submitted', 'tire_inspection', v_id,
    jsonb_build_object('protocol', v_protocol, 'vehicle_id', v_vehicle, 'positions_measured', n_measured));

  -- o retorno ao campo é cego: nenhum valor oficial e nenhuma divergência
  return jsonb_build_object('id', v_id, 'protocol', v_protocol, 'submitted_at', now(),
                            'positions_expected', n_expected, 'positions_measured', n_measured, 'duplicate', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Minhas vistorias (executor): leituras próprias, situação e motivo — sem
--    valores oficiais, para não viciar uma nova medição
-- -----------------------------------------------------------------------------
create or replace function public.tire_my_inspections(p_organization_id uuid, p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  return jsonb_build_object(
    'total', (select count(*) from public.tire_inspections i where i.organization_id = p_organization_id and i.inspector_user_id = auth.uid()),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'protocol', i.protocol, 'vehicle_id', i.vehicle_id, 'license_plate', i.license_plate_snapshot, 'fleet_code', i.fleet_code_snapshot,
        'inspection_date', i.inspection_date, 'submitted_at', i.submitted_at, 'status', i.status,
        'positions_expected', i.positions_expected, 'positions_measured', i.positions_measured,
        'review_note', case when i.status = 'retornar_divergencia' then i.review_note end, 'reviewed_at', i.reviewed_at)
        order by i.submitted_at desc)
        from (select * from public.tire_inspections i where i.organization_id = p_organization_id and i.inspector_user_id = auth.uid()
               order by i.submitted_at desc limit v_limit offset v_offset) i), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.tire_my_inspection_detail(p_organization_id uuid, p_inspection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare i public.tire_inspections;
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  select * into i from public.tire_inspections x
   where x.id = p_inspection_id and x.organization_id = p_organization_id and x.inspector_user_id = auth.uid();
  if i.id is null then return null; end if;
  return jsonb_build_object(
    'id', i.id, 'protocol', i.protocol, 'status', i.status, 'vehicle_id', i.vehicle_id, 'license_plate', i.license_plate_snapshot,
    'fleet_code', i.fleet_code_snapshot, 'operation_name', i.operation_name_snapshot, 'city_name', i.city_name_snapshot,
    'inspection_date', i.inspection_date, 'submitted_at', i.submitted_at, 'general_observation', i.general_observation,
    'review_note', case when i.status = 'retornar_divergencia' then i.review_note end, 'reviewed_at', i.reviewed_at,
    'positions_expected', i.positions_expected, 'positions_measured', i.positions_measured,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'position_code', it.position_code, 'position_label', it.position_label_snapshot, 'measured', it.measured,
        'fire_number_read', it.fire_number_read, 'tread_1', it.tread_1, 'tread_2', it.tread_2, 'tread_3', it.tread_3, 'tread_4', it.tread_4,
        'psi_read', it.psi_read, 'observation', it.observation,
        -- só o tipo da divergência, e só quando a vistoria volta para o campo
        'divergence_types', case when i.status = 'retornar_divergencia'
                                 then coalesce((select jsonb_agg(distinct d ->> 'type') from jsonb_array_elements(it.divergences) d), '[]'::jsonb)
                                 else '[]'::jsonb end) order by it.sort_order, it.position_code)
        from public.tire_inspection_items it where it.inspection_id = i.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status,
        'reason', case when h.to_status = 'retornar_divergencia' or h.from_status is null then h.reason end, 'created_at', h.created_at)
        order by h.created_at) from public.tire_inspection_status_history h where h.inspection_id = i.id), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Vistorias recebidas (portal): fila, detalhe e decisões
-- -----------------------------------------------------------------------------
create or replace function public.tire_inspections_received(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
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
  f_status  text[] := private.jsonb_text_array(f -> 'statuses');
  f_from    date := nullif(f ->> 'date_from', '')::date;
  f_to      date := nullif(f ->> 'date_to', '')::date;
  f_ops     uuid[] := private.km_uuid_array(f -> 'operation_ids');
  f_cities  integer[] := private.km_int_array(f -> 'city_ids');
  f_brs     uuid[] := private.km_uuid_array(f -> 'br_ids');
  f_leaders uuid[] := private.km_uuid_array(f -> 'leader_ids');
  f_veh     uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  f_insp    uuid := nullif(f ->> 'inspector_user_id', '')::uuid;
  f_div     text := nullif(f ->> 'divergence', '');
  f_search  text := nullif(btrim(f ->> 'search'), '');
  p         public.tire_parameter_sets := private.tire_params_at(p_organization_id, private.maintenance_today(p_organization_id));
  v_res     jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  with base as (
    select i.* from public.tire_inspections i
     where i.organization_id = p_organization_id and private.tire_vehicle_visible(i.organization_id, i.vehicle_id)),
  q as (
    select base.* from base
     where (f_status is null or cardinality(f_status) = 0 or base.status = any (f_status))
       and (f_from is null or base.inspection_date >= f_from) and (f_to is null or base.inspection_date <= f_to)
       and (f_ops is null or cardinality(f_ops) = 0 or base.operation_id = any (f_ops))
       and (f_cities is null or cardinality(f_cities) = 0 or base.city_id = any (f_cities))
       and (f_brs is null or cardinality(f_brs) = 0 or base.operation_br_id = any (f_brs))
       and (f_leaders is null or cardinality(f_leaders) = 0 or base.leader_employee_id = any (f_leaders))
       and (f_veh is null or cardinality(f_veh) = 0 or base.vehicle_id = any (f_veh))
       and (f_insp is null or base.inspector_user_id = f_insp)
       and (f_div is null or (f_div = 'com' and base.positions_divergent > 0) or (f_div = 'sem' and base.positions_divergent = 0)
            or (f_div = 'persistente' and base.persistent_divergence))
       and (f_search is null or base.protocol ilike '%' || f_search || '%'
            or base.license_plate_snapshot like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
            or upper(coalesce(base.fleet_code_snapshot, '')) like '%' || upper(f_search) || '%')),
  o as (select q.*, row_number() over (order by q.submitted_at desc) as rn from q)
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'pendente_revisao', (select count(*) from base where base.status = 'pendente_revisao'),
      'pendente_rodopar', (select count(*) from base where base.status = 'pendente_rodopar'),
      'sincronizado_rodopar', (select count(*) from base where base.status = 'sincronizado_rodopar'),
      'retornar_divergencia', (select count(*) from base where base.status = 'retornar_divergencia'),
      'substituida', (select count(*) from base where base.status = 'substituida'),
      'pending_with_divergence', (select count(*) from base where base.status = 'pendente_revisao' and base.positions_divergent > 0),
      'review_over_sla', (select count(*) from base where base.status = 'pendente_revisao'
                            and base.submitted_at < now() - make_interval(days => p.review_sla_days)),
      'rodopar_over_sla', (select count(*) from base where base.status = 'pendente_rodopar'
                             and base.approved_at < now() - make_interval(days => p.rodopar_sync_sla_days)),
      'persistent', (select count(*) from base where base.status = 'pendente_rodopar' and base.persistent_divergence),
      'avg_review_hours', (select round(avg(extract(epoch from (base.reviewed_at - base.submitted_at)) / 3600.0)::numeric, 1)
                             from base where base.reviewed_at is not null and base.submitted_at > now() - interval '90 days'),
      'review_sla_days', p.review_sla_days, 'rodopar_sync_sla_days', p.rodopar_sync_sla_days),
    'inspectors', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                              from (select distinct base.inspector_user_id as id, base.inspector_name_snapshot as name from base) x), '[]'::jsonb),
    'total', (select count(*) from o),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'protocol', o.protocol, 'status', o.status, 'vehicle_id', o.vehicle_id, 'license_plate', o.license_plate_snapshot,
        'fleet_code', o.fleet_code_snapshot, 'vehicle_type_name', o.vehicle_type_name_snapshot, 'operation_name', o.operation_name_snapshot,
        'city_name', o.city_name_snapshot, 'state_uf', o.state_uf_snapshot, 'br_code', o.br_code_snapshot, 'leader_name', o.leader_name_snapshot,
        'inspector_name', o.inspector_name_snapshot, 'inspection_date', o.inspection_date, 'submitted_at', o.submitted_at,
        'positions_expected', o.positions_expected, 'positions_measured', o.positions_measured, 'positions_divergent', o.positions_divergent,
        'reviewed_by_name', o.reviewed_by_name, 'reviewed_at', o.reviewed_at, 'approved_at', o.approved_at, 'synced_at', o.synced_at,
        'persistent_divergence', o.persistent_divergence, 'parent_inspection_id', o.parent_inspection_id,
        'waiting_days', case when o.status = 'pendente_revisao' then (current_date - o.submitted_at::date)
                             when o.status = 'pendente_rodopar' then (current_date - coalesce(o.approved_at, o.submitted_at)::date) end)
        order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

create or replace function public.tire_inspection_detail(p_organization_id uuid, p_inspection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i        public.tire_inspections;
  v_review boolean := private.has_permission(p_organization_id, 'tires.inspection.review');
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  select * into i from public.tire_inspections x where x.id = p_inspection_id and x.organization_id = p_organization_id;
  if i.id is null or not private.tire_vehicle_visible(i.organization_id, i.vehicle_id) then return null; end if;
  return to_jsonb(i) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(it) order by it.sort_order, it.position_code)
                         from public.tire_inspection_items it where it.inspection_id = i.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at)
                           from public.tire_inspection_status_history h where h.inspection_id = i.id), '[]'::jsonb),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'protocol', c.protocol, 'status', c.status, 'submitted_at', c.submitted_at))
                            from public.tire_inspections c where c.parent_inspection_id = i.id), '[]'::jsonb),
    'can_review', v_review,
    'transitions', case when not v_review then '[]'::jsonb else
       case i.status when 'pendente_revisao' then '["pendente_rodopar", "retornar_divergencia"]'::jsonb
                     when 'retornar_divergencia' then '["pendente_revisao"]'::jsonb
                     when 'pendente_rodopar' then '["sincronizado_rodopar", "retornar_divergencia"]'::jsonb
                     else '[]'::jsonb end end);
end;
$$;

create or replace function public.tire_inspection_transition(p_organization_id uuid, p_inspection_id uuid, p_to text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i        public.tire_inspections;
  v_reason text := nullif(btrim(p_reason), '');
  v_name   text := private.tire_actor_name(p_organization_id);
  v_ok     boolean;
begin
  perform private.tire_require(p_organization_id, 'tires.inspection.review');
  select * into i from public.tire_inspections x where x.id = p_inspection_id and x.organization_id = p_organization_id for update;
  if i.id is null or not private.tire_vehicle_visible(i.organization_id, i.vehicle_id) then
    raise exception 'Vistoria não encontrada no seu escopo.' using errcode = 'no_data_found';
  end if;
  if i.status = p_to then
    return to_jsonb(i) || jsonb_build_object('unchanged', true);
  end if;
  v_ok := (i.status = 'pendente_revisao' and p_to in ('pendente_rodopar', 'retornar_divergencia'))
       or (i.status = 'retornar_divergencia' and p_to = 'pendente_revisao')
       or (i.status = 'pendente_rodopar' and p_to in ('sincronizado_rodopar', 'retornar_divergencia'));
  if not v_ok then
    raise exception 'Transição não permitida: % → %.', i.status, p_to using errcode = 'invalid_parameter_value';
  end if;
  if p_to = 'retornar_divergencia' and (v_reason is null or length(v_reason) < 5) then
    raise exception 'Informe o motivo do retorno (mínimo de 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if p_to = 'sincronizado_rodopar' and (v_reason is null or length(v_reason) < 5) then
    raise exception 'Informe como o lançamento no Rodopar foi confirmado (mínimo de 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason is not null and length(v_reason) > 1000 then
    raise exception 'Motivo acima de 1.000 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  update public.tire_inspections set
    status = p_to, reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now(), review_note = v_reason,
    approved_at = case when p_to = 'pendente_rodopar' then now() else approved_at end,
    synced_at = case when p_to = 'sincronizado_rodopar' then now() else synced_at end,
    sync_result = case when p_to = 'sincronizado_rodopar'
                       then sync_result || jsonb_build_object('manual', true, 'note', v_reason) else sync_result end,
    updated_at = now()
   where id = i.id
  returning * into i;
  insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, actor_user_id, actor_name)
  values (p_organization_id, i.id, (select h.to_status from public.tire_inspection_status_history h where h.inspection_id = i.id order by h.created_at desc limit 1),
          p_to, v_reason, 'user', auth.uid(), v_name);

  if p_to = 'retornar_divergencia' then
    -- alerta para a liderança responsável (outbox) e para o executor (Minhas vistorias)
    perform private.emit_event(p_organization_id, 'tires.inspection.returned', 'tire_inspection', i.id,
      jsonb_build_object('protocol', i.protocol, 'vehicle_id', i.vehicle_id, 'license_plate', i.license_plate_snapshot,
                         'leader_employee_id', i.leader_employee_id, 'inspector_user_id', i.inspector_user_id, 'reason', v_reason));
  end if;
  perform private.tire_audit(p_organization_id, 'inspection.' || p_to, 'tire_inspection', i.id,
    format('Vistoria %s (%s): %s.', i.protocol, i.license_plate_snapshot, p_to), null, jsonb_build_object('status', p_to, 'reason', v_reason));
  return to_jsonb(i);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Reconciliação automática com a nova fotografia (chamada pela confirmação)
-- -----------------------------------------------------------------------------
create or replace function private.tire_reconcile_inspections(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b     public.tire_import_batches;
  p     public.tire_parameter_sets;
  r     record;
  n_checked integer := 0; n_synced integer := 0; n_persistent integer := 0; n_pending integer := 0;
begin
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id;
  if b.id is null then return '{}'::jsonb; end if;
  p := private.tire_params_at(p_organization_id, b.reference_date);

  -- itens medidos de vistorias aprovadas, comparados com a nova fotografia
  with it as (
    select it.id, it.inspection_id, i.inspection_date, it.fire_number_read, it.tread_1, it.tread_2, it.tread_3, it.tread_4, it.psi_read,
           ns.id as ns_id, ns.fire_number, ns.tread_1 as n1, ns.tread_2 as n2, ns.tread_3 as n3, ns.tread_4 as n4, ns.psi as npsi,
           ns.measurement_date, ns.calibration_date
      from public.tire_inspection_items it
      join public.tire_inspections i on i.id = it.inspection_id
      left join lateral (select s.* from public.tire_daily_snapshots s
                          where s.import_batch_id = b.id and s.vehicle_id = i.vehicle_id and s.position_code = it.position_code
                            and s.canonical_status = 'em_uso' order by s.fire_number limit 1) ns on true
     where i.organization_id = p_organization_id and i.status = 'pendente_rodopar' and it.measured),
  ev as (
    select it.*,
      (it.fire_number_read is null or it.fire_number_read = it.fire_number) as fire_ok,
      ((it.tread_1 is null or (it.n1 is not null and abs(it.tread_1 - it.n1) <= p.inspection_tread_tolerance_mm))
       and (it.tread_2 is null or (it.n2 is not null and abs(it.tread_2 - it.n2) <= p.inspection_tread_tolerance_mm))
       and (it.tread_3 is null or (it.n3 is not null and abs(it.tread_3 - it.n3) <= p.inspection_tread_tolerance_mm))
       and (it.tread_4 is null or (it.n4 is not null and abs(it.tread_4 - it.n4) <= p.inspection_tread_tolerance_mm))) as tread_ok,
      (it.psi_read is null or (it.npsi is not null and abs(it.psi_read - it.npsi) <= p.inspection_psi_tolerance)) as psi_ok,
      ((coalesce(it.tread_1, it.tread_2, it.tread_3, it.tread_4) is null or it.measurement_date >= it.inspection_date)
       and (it.psi_read is null or it.calibration_date >= it.inspection_date)) as launched
      from it),
  res as (
    select ev.id, ev.ns_id,
      case when ev.ns_id is null then 'pending'
           when ev.fire_ok and ev.tread_ok and ev.psi_ok then 'synced'
           when ev.launched or not ev.fire_ok then 'persistent'
           else 'pending' end as st,
      case when ev.ns_id is null then 'A nova fotografia não tem pneu em uso nesta posição.'
           when ev.fire_ok and ev.tread_ok and ev.psi_ok then 'Valores medidos encontrados na fotografia oficial.'
           when ev.launched or not ev.fire_ok then concat_ws(' · ', case when not ev.fire_ok then 'Nº Fogo continua diferente' end,
                 case when not ev.tread_ok then 'sulcos continuam diferentes' end, case when not ev.psi_ok then 'PSI continua diferente' end)
           else 'Medição ainda não lançada no Rodopar (datas da fotografia anteriores à vistoria).' end as note
      from ev)
  update public.tire_inspection_items x set sync_status = res.st, synced_snapshot_id = res.ns_id, sync_note = res.note, updated_at = now()
    from res where x.id = res.id;

  for r in
    select i.id, i.protocol, i.vehicle_id, i.leader_employee_id,
           count(*) filter (where it.measured) as measured,
           count(*) filter (where it.sync_status = 'synced') as synced,
           count(*) filter (where it.sync_status = 'persistent') as persistent,
           count(*) filter (where it.measured and it.sync_status = 'pending') as pending
      from public.tire_inspections i join public.tire_inspection_items it on it.inspection_id = i.id
     where i.organization_id = p_organization_id and i.status = 'pendente_rodopar'
     group by i.id
  loop
    n_checked := n_checked + 1;
    if r.measured > 0 and r.synced = r.measured then
      n_synced := n_synced + 1;
      update public.tire_inspections set status = 'sincronizado_rodopar', synced_batch_id = b.id, synced_at = now(),
             persistent_divergence = false, last_reconciled_batch_id = b.id, last_reconciled_at = now(), updated_at = now(),
             sync_result = jsonb_build_object('batch_id', b.id, 'reference_date', b.reference_date, 'synced', r.synced, 'manual', false)
       where id = r.id;
      insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, import_batch_id)
      values (p_organization_id, r.id, 'pendente_rodopar', 'sincronizado_rodopar',
              format('Sincronizada automaticamente pela fotografia Rodopar de %s.', to_char(b.reference_date, 'DD/MM/YYYY')), 'import', b.id);
    else
      if r.persistent > 0 then n_persistent := n_persistent + 1; else n_pending := n_pending + 1; end if;
      update public.tire_inspections set persistent_divergence = r.persistent > 0, last_reconciled_batch_id = b.id,
             last_reconciled_at = now(), updated_at = now(),
             sync_result = jsonb_build_object('batch_id', b.id, 'reference_date', b.reference_date, 'synced', r.synced,
                                              'persistent', r.persistent, 'pending', r.pending, 'manual', false)
       where id = r.id;
      if r.persistent > 0 then
        perform private.emit_event(p_organization_id, 'tires.inspection.persistent_divergence', 'tire_inspection', r.id,
          jsonb_build_object('protocol', r.protocol, 'vehicle_id', r.vehicle_id, 'leader_employee_id', r.leader_employee_id,
                             'batch_id', b.id, 'reference_date', b.reference_date));
      end if;
    end if;
  end loop;

  return jsonb_build_object('checked', n_checked, 'synced', n_synced, 'persistent', n_persistent, 'pending', n_pending);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_app(uuid), private.tire_expected_positions(uuid, uuid, date),
  private.tire_inspection_vehicle_check(uuid, uuid, date), private.tire_reconcile_inspections(uuid, uuid) from public, anon;
grant execute on function private.tire_app(uuid), private.tire_expected_positions(uuid, uuid, date),
  private.tire_inspection_vehicle_check(uuid, uuid, date), private.tire_reconcile_inspections(uuid, uuid) to authenticated, service_role;
revoke execute on function public.tire_inspection_context(uuid), public.tire_inspection_vehicles(uuid, text, integer),
  public.tire_inspection_positions(uuid, uuid), public.tire_inspection_submit(uuid, jsonb),
  public.tire_my_inspections(uuid, integer, integer), public.tire_my_inspection_detail(uuid, uuid),
  public.tire_inspections_received(uuid, jsonb, integer, integer), public.tire_inspection_detail(uuid, uuid),
  public.tire_inspection_transition(uuid, uuid, text, text) from public, anon;
grant execute on function public.tire_inspection_context(uuid), public.tire_inspection_vehicles(uuid, text, integer),
  public.tire_inspection_positions(uuid, uuid), public.tire_inspection_submit(uuid, jsonb),
  public.tire_my_inspections(uuid, integer, integer), public.tire_my_inspection_detail(uuid, uuid),
  public.tire_inspections_received(uuid, jsonb, integer, integer), public.tire_inspection_detail(uuid, uuid),
  public.tire_inspection_transition(uuid, uuid, text, text) to authenticated, service_role;
