-- =============================================================================
-- Etapa 16 — Manutenção: núcleo transacional
--
-- Contexto histórico, KM, máquina de estados e as RPCs que abrem, programam,
-- executam, concluem, cancelam e reabrem uma manutenção. Toda RPC de escrita:
--   * trava a linha (for update) e confere permissão + escopo de operação;
--   * valida a transição contra a máquina de estados;
--   * grava o fato e o evento na mesma transação (nada fica pela metade);
--   * registra o autor real (auth.uid()); "Sistema" só sem usuário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rótulos, autor e trilha
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
           when 'to_schedule'   then 'Há agendar'
           when 'scheduled'     then 'Agendado'
           when 'in_progress'   then 'Em execução'
           when 'completed'     then 'Concluído'
           when 'cancelled'     then 'Cancelado'
           when 'not_performed' then 'Não realizada'
           else p_status
         end;
$$;

create or replace function private.maintenance_actor_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then 'Sistema'
              else coalesce(nullif(private.org_member_name(p_organization_id, auth.uid()), ''), 'Usuário autenticado')
         end;
$$;

create or replace function private.maintenance_log(
  p_organization_id uuid,
  p_maintenance_id  uuid,
  p_event_type      text,
  p_from_status     text,
  p_to_status       text,
  p_reason          text,
  p_payload         jsonb,
  p_source          text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.maintenance_events
    (organization_id, maintenance_id, event_type, from_status, to_status, reason, payload, source,
     actor_user_id, actor_name)
  values
    (p_organization_id, p_maintenance_id, p_event_type, p_from_status, p_to_status, nullif(btrim(p_reason), ''),
     coalesce(p_payload, '{}'::jsonb), coalesce(p_source, 'user'),
     auth.uid(), private.maintenance_actor_name(p_organization_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Máquina de estados — a única fonte das transições permitidas
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('to_schedule',   'scheduled'),
    ('to_schedule',   'in_progress'),   -- entrada sem agendamento prévio (socorro, oportunidade)
    ('to_schedule',   'cancelled'),
    ('scheduled',     'to_schedule'),   -- desprogramar
    ('scheduled',     'in_progress'),
    ('scheduled',     'cancelled'),
    ('scheduled',     'not_performed'), -- o veículo não compareceu
    ('in_progress',   'completed'),
    ('completed',     'in_progress'),   -- reabertura (maintenance.reopen)
    ('cancelled',     'to_schedule'),   -- reabertura (maintenance.reopen)
    ('not_performed', 'to_schedule')    -- reabertura (maintenance.reopen)
  );
$$;
comment on function private.maintenance_transition_allowed(text, text) is
  'Máquina de estados da manutenção: Há agendar → Agendado → Em execução → Concluído; cancelar/não realizada encerram sem execução; reabrir exige maintenance.reopen. Reprogramar não muda a situação (é um evento).';

create or replace function private.maintenance_assert_transition(p_from text, p_to text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not private.maintenance_transition_allowed(p_from, p_to) then
    raise exception 'Transição não permitida: % → %.',
      private.maintenance_status_label(p_from), private.maintenance_status_label(p_to)
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Carrega e trava a manutenção, conferindo permissão e escopo.
create or replace function private.maintenance_lock(p_maintenance_id uuid, p_permission text)
returns public.maintenances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.maintenances;
begin
  select * into v_row from public.maintenances where id = p_maintenance_id for update;
  if v_row.id is null then
    raise exception 'Manutenção não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_row.organization_id, p_permission) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;
  if not private.maintenance_in_scope(v_row.organization_id, v_row.operation_id, v_row.vehicle_id) then
    raise exception 'Esta manutenção não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Contexto operacional histórico (Fidelização → alocação; Lideranças)
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_context(p_organization_id uuid, p_vehicle_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan   record;
  v_leader record;
  v_unit   uuid;
begin
  select * into v_plan
    from private.adherence_planned_fleet(p_organization_id, p_date, null, p_vehicle_id)
   limit 1;

  if v_plan.vehicle_id is null then
    select v.organization_unit_id into v_unit from public.vehicles v where v.id = p_vehicle_id;
    return jsonb_build_object(
      'source', 'none', 'date', p_date, 'organization_unit_id', v_unit,
      'unit_name', (select u.name from public.organization_units u where u.id = v_unit));
  end if;

  select * into v_leader
    from private.adherence_leader_at(v_plan.operation_id, v_plan.operation_city_id, v_plan.operation_br_id, p_date)
   limit 1;

  return jsonb_build_object(
    'source',                     v_plan.source,
    'date',                       p_date,
    'operation_id',               v_plan.operation_id,
    'operation_city_id',          v_plan.operation_city_id,
    'state_id',                   v_plan.state_id,
    'city_id',                    v_plan.city_id,
    'operation_br_id',            v_plan.operation_br_id,
    'fidelization_assignment_id', v_plan.fidelization_assignment_id,
    'organization_unit_id',       v_plan.organization_unit_id,
    'leader_employee_id',         v_leader.employee_id,
    'leadership_assignment_id',   v_leader.leadership_assignment_id,
    'operation_name', (select o.name from public.operations o where o.id = v_plan.operation_id),
    'city_name',      (select c.name from public.cities c where c.id = v_plan.city_id),
    'state_uf',       (select s.uf::text from public.states s where s.id = v_plan.state_id),
    'br_code',        (select b.code from public.operation_brs b where b.id = v_plan.operation_br_id),
    'unit_name',      (select u.name from public.organization_units u where u.id = v_plan.organization_unit_id),
    'leader_name',    (select e.full_name from public.employees e where e.id = v_leader.employee_id));
end;
$$;
comment on function private.maintenance_context(uuid, uuid, date) is
  'Contexto oficial do veículo na data: operação, cidade, BR e vínculo vêm da Fidelização (titular vigente) e, na falta dela, da alocação; a liderança vem do planner (BR → cidade → operação). Mesma resolução usada pela Aderência.';

-- Grava o contexto na manutenção (as colunas de id e de snapshot).
create or replace function private.maintenance_apply_context(p_maintenance_id uuid, p_context jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.maintenances set
    context_date               = (p_context ->> 'date')::date,
    context_source             = coalesce(p_context ->> 'source', 'none'),
    operation_id               = (p_context ->> 'operation_id')::uuid,
    operation_city_id          = (p_context ->> 'operation_city_id')::uuid,
    state_id                   = (p_context ->> 'state_id')::smallint,
    city_id                    = (p_context ->> 'city_id')::integer,
    operation_br_id            = (p_context ->> 'operation_br_id')::uuid,
    fidelization_assignment_id = (p_context ->> 'fidelization_assignment_id')::uuid,
    organization_unit_id       = (p_context ->> 'organization_unit_id')::uuid,
    leader_employee_id         = (p_context ->> 'leader_employee_id')::uuid,
    leadership_assignment_id   = (p_context ->> 'leadership_assignment_id')::uuid,
    operation_name_snapshot    = p_context ->> 'operation_name',
    city_name_snapshot         = p_context ->> 'city_name',
    state_uf_snapshot          = p_context ->> 'state_uf',
    br_code_snapshot           = p_context ->> 'br_code',
    unit_name_snapshot         = p_context ->> 'unit_name',
    leader_name_snapshot       = p_context ->> 'leader_name'
  where id = p_maintenance_id;
$$;

-- -----------------------------------------------------------------------------
-- 4. KM — consumo do hodômetro oficial, sem nunca reescrevê-lo
-- -----------------------------------------------------------------------------
create or replace function private.vehicle_current_km(p_vehicle_id uuid)
returns table (km integer, reading_date date, reading_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.odometer_km, r.reading_date, r.id
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null
   order by r.reading_date desc, r.created_at desc
   limit 1;
$$;

-- KM oficial na data. Taxonomia (docs/modules/maintenance.md §KM):
--   validated      leitura oficial na própria data
--   compatible     leitura a até km_compatible_days da data
--   estimated      entre leituras mais distantes: interpolação linear (ou a
--                  leitura mais próxima, até km_estimated_max_days)
--   not_found      nenhuma leitura do veículo
--   pending_future data de referência no futuro
--   to_review      há leituras, mas todas longe demais para estimar
create or replace function private.maintenance_resolve_km(p_organization_id uuid, p_vehicle_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.maintenance_settings;
  v_compat   integer;
  v_max      integer;
  v_exact    record;
  v_prev     record;
  v_next     record;
  v_d_prev   integer;
  v_d_next   integer;
  v_km       integer;
begin
  if p_date is null then
    return jsonb_build_object('status', null);
  end if;
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;
  v_compat := coalesce(v_settings.km_compatible_days, 3);
  v_max    := coalesce(v_settings.km_estimated_max_days, 30);

  if p_date > private.maintenance_today(p_organization_id) then
    return jsonb_build_object('status', 'pending_future', 'reference_date', p_date);
  end if;

  select r.id, r.odometer_km as km, r.reading_date into v_exact
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null and r.reading_date = p_date
   order by r.created_at desc limit 1;
  if v_exact.id is not null then
    return jsonb_build_object('status', 'validated', 'km', v_exact.km, 'source', 'official_reading',
                              'reading_id', v_exact.id, 'reading_date', v_exact.reading_date,
                              'official_km', v_exact.km, 'reference_date', p_date);
  end if;

  select r.id, r.odometer_km as km, r.reading_date into v_prev
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null and r.reading_date < p_date
   order by r.reading_date desc, r.created_at desc limit 1;
  select r.id, r.odometer_km as km, r.reading_date into v_next
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null and r.reading_date > p_date
   order by r.reading_date asc, r.created_at desc limit 1;

  if v_prev.id is null and v_next.id is null then
    return jsonb_build_object('status', 'not_found', 'reference_date', p_date);
  end if;

  v_d_prev := case when v_prev.id is not null then p_date - v_prev.reading_date end;
  v_d_next := case when v_next.id is not null then v_next.reading_date - p_date end;

  if v_prev.id is not null and v_d_prev <= v_compat and (v_next.id is null or v_d_prev <= v_d_next) then
    return jsonb_build_object('status', 'compatible', 'km', v_prev.km, 'source', 'official_reading',
                              'reading_id', v_prev.id, 'reading_date', v_prev.reading_date,
                              'official_km', v_prev.km, 'reference_date', p_date);
  end if;
  if v_next.id is not null and v_d_next <= v_compat then
    return jsonb_build_object('status', 'compatible', 'km', v_next.km, 'source', 'official_reading',
                              'reading_id', v_next.id, 'reading_date', v_next.reading_date,
                              'official_km', v_next.km, 'reference_date', p_date);
  end if;

  if v_prev.id is not null and v_next.id is not null and v_next.km >= v_prev.km
     and (v_d_prev <= v_max or v_d_next <= v_max) then
    v_km := round(v_prev.km + (v_next.km - v_prev.km) * (v_d_prev::numeric / (v_d_prev + v_d_next)))::integer;
    return jsonb_build_object('status', 'estimated', 'km', v_km, 'source', 'interpolated',
                              'reading_id', v_prev.id, 'reading_date', v_prev.reading_date,
                              'official_km', v_km, 'reference_date', p_date,
                              'bounds', jsonb_build_array(v_prev.km, v_next.km));
  end if;
  if v_prev.id is not null and v_d_prev <= v_max then
    return jsonb_build_object('status', 'estimated', 'km', v_prev.km, 'source', 'official_reading',
                              'reading_id', v_prev.id, 'reading_date', v_prev.reading_date,
                              'official_km', v_prev.km, 'reference_date', p_date);
  end if;
  if v_next.id is not null and v_d_next <= v_max then
    return jsonb_build_object('status', 'estimated', 'km', v_next.km, 'source', 'official_reading',
                              'reading_id', v_next.id, 'reading_date', v_next.reading_date,
                              'official_km', v_next.km, 'reference_date', p_date);
  end if;

  return jsonb_build_object('status', 'to_review', 'reference_date', p_date,
                            'official_km', coalesce(v_prev.km, v_next.km),
                            'reading_id', coalesce(v_prev.id, v_next.id),
                            'reading_date', coalesce(v_prev.reading_date, v_next.reading_date));
end;
$$;

-- KM informado pelo usuário: comparado com a base oficial, sem bloquear.
--   manual     coerente com as leituras oficiais vizinhas (ou sem leituras)
--   divergent  menor que uma leitura anterior ou maior que uma posterior
create or replace function private.maintenance_check_manual_km(
  p_organization_id uuid, p_vehicle_id uuid, p_date date, p_km integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev   record;
  v_next   record;
  v_auto   jsonb;
  v_status text := 'manual';
  v_ref    integer;
begin
  select r.odometer_km as km, r.reading_date into v_prev
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null and r.reading_date <= p_date
   order by r.reading_date desc, r.created_at desc limit 1;
  select r.odometer_km as km, r.reading_date into v_next
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id and r.superseded_by is null and r.reading_date >= p_date
   order by r.reading_date asc, r.created_at desc limit 1;

  if (v_prev.km is not null and p_km < v_prev.km) or (v_next.km is not null and p_km > v_next.km) then
    v_status := 'divergent';
  end if;

  v_auto := private.maintenance_resolve_km(p_organization_id, p_vehicle_id, p_date);
  v_ref  := (v_auto ->> 'official_km')::integer;

  return jsonb_build_object(
    'status', v_status, 'km', p_km, 'source', 'manual', 'reference_date', p_date,
    'official_km', v_ref, 'difference', case when v_ref is not null then p_km - v_ref end,
    'reading_id', v_auto ->> 'reading_id');
end;
$$;

-- Aplica um KM de entrada (automático ou manual) à manutenção.
create or replace function private.maintenance_apply_entry_km(
  p_maintenance_id uuid, p_km_info jsonb, p_justification text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.maintenances set
    entry_km                = (p_km_info ->> 'km')::integer,
    entry_km_status         = p_km_info ->> 'status',
    entry_km_source         = p_km_info ->> 'source',
    entry_km_reference_date = (p_km_info ->> 'reference_date')::date,
    entry_km_reading_id     = (p_km_info ->> 'reading_id')::uuid,
    entry_km_official       = (p_km_info ->> 'official_km')::integer,
    entry_km_difference     = case when p_km_info ->> 'source' = 'manual' then (p_km_info ->> 'difference')::integer end,
    entry_km_justification  = case when p_km_info ->> 'source' = 'manual' then btrim(p_justification) end,
    entry_km_informed_by    = case when p_km_info ->> 'source' = 'manual' then auth.uid() end,
    entry_km_informed_at    = case when p_km_info ->> 'source' = 'manual' then now() end
  where id = p_maintenance_id;
$$;

-- -----------------------------------------------------------------------------
-- 5. Itens de serviço
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_insert_items(
  p_organization_id uuid, p_maintenance_id uuid, p_vehicle_type_id uuid, p_type_code text, p_service_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service record;
  v_added   jsonb := '[]'::jsonb;
  v_next    smallint;
begin
  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    return v_added;
  end if;
  select coalesce(max(sort_order), 0) into v_next from public.maintenance_items where maintenance_id = p_maintenance_id;

  for v_service in
    select s.id, s.name, s.criticality, s.status, s.deleted_at, s.maintenance_type_codes, s.vehicle_type_ids,
           c.id as cluster_id, c.name as cluster_name, c.status as cluster_status, c.deleted_at as cluster_deleted,
           u.ord
      from unnest(p_service_ids) with ordinality u(service_id, ord)
      left join public.maintenance_services s on s.id = u.service_id and s.organization_id = p_organization_id
      left join public.maintenance_clusters c on c.id = s.cluster_id
     order by u.ord
  loop
    if v_service.id is null then
      raise exception 'Serviço não encontrado nesta organização.' using errcode = 'foreign_key_violation';
    end if;
    if v_service.status <> 'active' or v_service.deleted_at is not null
       or v_service.cluster_status <> 'active' or v_service.cluster_deleted is not null then
      raise exception 'O serviço "%" (ou o seu cluster) está inativo.', v_service.name using errcode = 'invalid_parameter_value';
    end if;
    if cardinality(v_service.maintenance_type_codes) > 0 and not (p_type_code = any (v_service.maintenance_type_codes)) then
      raise exception 'O serviço "%" não se aplica a este tipo de manutenção.', v_service.name using errcode = 'invalid_parameter_value';
    end if;
    if cardinality(v_service.vehicle_type_ids) > 0 and not (p_vehicle_type_id = any (v_service.vehicle_type_ids)) then
      raise exception 'O serviço "%" não se aplica a este tipo de equipamento.', v_service.name using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from public.maintenance_items i
                where i.maintenance_id = p_maintenance_id and i.service_id = v_service.id and i.status <> 'cancelled') then
      continue;  -- o mesmo serviço duas vezes é o mesmo item
    end if;

    v_next := v_next + 1;
    insert into public.maintenance_items
      (organization_id, maintenance_id, service_id, cluster_id, service_name_snapshot, cluster_name_snapshot,
       criticality, sort_order)
    values
      (p_organization_id, p_maintenance_id, v_service.id, v_service.cluster_id, v_service.name, v_service.cluster_name,
       v_service.criticality, v_next);
    v_added := v_added || jsonb_build_object('service_id', v_service.id, 'service', v_service.name,
                                             'cluster_id', v_service.cluster_id, 'cluster', v_service.cluster_name);
  end loop;
  return v_added;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Duplicidade — manutenções abertas equivalentes
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_open_equivalents(
  p_vehicle_id uuid, p_service_ids uuid[], p_exclude uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select s.id as service_id, s.cluster_id
      from public.maintenance_services s
     where s.id = any (coalesce(p_service_ids, '{}'))
  )
  select coalesce(jsonb_agg(x order by x ->> 'requested_on' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', m.id, 'code', m.code, 'status', m.status,
               'status_label', private.maintenance_status_label(m.status),
               'type', m.maintenance_type_code, 'requested_on', m.requested_on,
               'scheduled_date', m.scheduled_date, 'entry_date', m.entry_date,
               'same_service', exists (select 1 from public.maintenance_items i join wanted w on w.service_id = i.service_id
                                        where i.maintenance_id = m.id and i.status <> 'cancelled'),
               'same_cluster', exists (select 1 from public.maintenance_items i join wanted w on w.cluster_id = i.cluster_id
                                        where i.maintenance_id = m.id and i.status <> 'cancelled'),
               'items', (select coalesce(jsonb_agg(jsonb_build_object('service', i.service_name_snapshot,
                                                                      'cluster', i.cluster_name_snapshot) order by i.sort_order), '[]')
                           from public.maintenance_items i where i.maintenance_id = m.id and i.status <> 'cancelled')) as x
        from public.maintenances m
       where m.vehicle_id = p_vehicle_id
         and m.status in ('to_schedule', 'scheduled', 'in_progress')
         and (p_exclude is null or m.id <> p_exclude)
    ) q;
$$;

-- -----------------------------------------------------------------------------
-- 7. Abertura
-- -----------------------------------------------------------------------------
-- p_payload:
--   vehicle_id, maintenance_type_code, origin_code | origin_id, priority,
--   service_ids[], description, requested_on,
--   status ('to_schedule' | 'scheduled' | 'in_progress'),
--   scheduled_date, scheduled_time, expected_exit_date, expected_exit_time,
--   supplier_id, service_order_number, scheduling_notes,
--   entry_date, entry_time, entry_km, entry_km_justification,
--   preventive_cycle_id, predictive_cycle_id, predictive_plan_item_id, predictive_verification_id,
--   checklist_answer_ids[], duplicate_justification
create or replace function private.maintenance_create_internal(p_organization_id uuid, p_payload jsonb, p_system_origin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle      record;
  v_type         text := p_payload ->> 'maintenance_type_code';
  v_origin       public.maintenance_origins;
  v_status       text := coalesce(nullif(p_payload ->> 'status', ''), 'to_schedule');
  v_today        date := private.maintenance_today(p_organization_id);
  v_requested    date := coalesce((p_payload ->> 'requested_on')::date, v_today);
  v_services     uuid[];
  v_answers      uuid[];
  v_equivalents  jsonb;
  v_dup_reason   text := nullif(btrim(p_payload ->> 'duplicate_justification'), '');
  v_id           uuid;
  v_code         text;
  v_context      jsonb;
  v_current      record;
  v_km           jsonb;
  v_items        jsonb;
  v_supplier     uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
  v_pcycle       record;
  v_pcycle_id    uuid;
  v_answer       record;
  v_entry_date   date := nullif(p_payload ->> 'entry_date', '')::date;
  v_sched_date   date := nullif(p_payload ->> 'scheduled_date', '')::date;
  v_linked       integer := 0;
  v_has_dup      boolean;
begin
  select v.id, v.organization_id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_subcategory_id,
         v.vehicle_model_id, v.status, v.deleted_at
    into v_vehicle
    from public.vehicles v where v.id = (p_payload ->> 'vehicle_id')::uuid;
  if v_vehicle.id is null or v_vehicle.organization_id <> p_organization_id then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_vehicle.deleted_at is not null or v_vehicle.status <> 'active' then
    raise exception 'Frota inativa: novas manutenções só podem ser abertas para frotas ativas. O histórico continua disponível.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.maintenance_types t where t.code = v_type and t.is_active) then
    raise exception 'Tipo de manutenção inválido.' using errcode = 'invalid_parameter_value';
  end if;

  -- Origem: do catálogo; as técnicas só pelas rotinas que as produzem.
  if p_system_origin is not null then
    select * into v_origin from public.maintenance_origins o
     where o.organization_id is null and o.code = p_system_origin;
  elsif p_payload ? 'origin_id' then
    select * into v_origin from public.maintenance_origins o
     where o.id = (p_payload ->> 'origin_id')::uuid
       and (o.organization_id is null or o.organization_id = p_organization_id);
  else
    select * into v_origin from public.maintenance_origins o
     where o.code = p_payload ->> 'origin_code'
       and (o.organization_id is null or o.organization_id = p_organization_id)
     order by o.organization_id nulls last limit 1;
  end if;
  if v_origin.id is null or not v_origin.is_active then
    raise exception 'Origem da manutenção inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if p_system_origin is null and not v_origin.manual_selectable
     and not (v_origin.code in ('checklist', 'action_plan') and jsonb_array_length(coalesce(p_payload -> 'checklist_answer_ids', '[]')) > 0) then
    raise exception 'A origem "%" é gravada apenas pela rotina que a produz.', v_origin.name
      using errcode = 'invalid_parameter_value';
  end if;

  if coalesce(p_payload ->> 'priority', 'medium') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridade inválida.' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_services
    from jsonb_array_elements_text(coalesce(p_payload -> 'service_ids', '[]')) x;

  -- Preventiva: sempre ligada a um ciclo do próprio veículo, ainda não realizado.
  if v_type = 'preventive' then
    select c.*, r.service_id as rule_service_id into v_pcycle
      from public.maintenance_preventive_cycles c
      join public.maintenance_preventive_rules r on r.id = c.rule_id
     where c.id = nullif(p_payload ->> 'preventive_cycle_id', '')::uuid;
    if v_pcycle.id is null or v_pcycle.vehicle_id <> v_vehicle.id then
      raise exception 'Manutenção preventiva exige o ciclo preventivo (MP) do veículo.' using errcode = 'invalid_parameter_value';
    end if;
    if v_pcycle.completed_on is not null then
      raise exception 'O ciclo MP% já foi realizado.', v_pcycle.cycle_number using errcode = 'invalid_parameter_value';
    end if;
    v_pcycle_id := v_pcycle.id;
    if cardinality(v_services) = 0 and v_pcycle.rule_service_id is not null then
      v_services := array[v_pcycle.rule_service_id];
    end if;
  elsif p_payload ? 'preventive_cycle_id' and nullif(p_payload ->> 'preventive_cycle_id', '') is not null then
    raise exception 'Ciclo preventivo só se aplica a manutenção preventiva.' using errcode = 'invalid_parameter_value';
  end if;

  if cardinality(v_services) = 0 then
    raise exception 'Selecione ao menos um serviço.' using errcode = 'invalid_parameter_value';
  end if;

  -- Situação inicial e os fatos que ela exige.
  if v_status not in ('to_schedule', 'scheduled', 'in_progress') then
    raise exception 'A manutenção nasce em Há agendar, Agendado ou Em execução.' using errcode = 'invalid_parameter_value';
  end if;
  if v_status = 'scheduled' then
    if not private.has_permission(p_organization_id, 'maintenance.schedule') then
      raise exception 'Você não possui permissão para agendar.' using errcode = 'insufficient_privilege';
    end if;
    if v_sched_date is null then
      raise exception 'Informe a data agendada.' using errcode = 'invalid_parameter_value';
    end if;
    if v_sched_date < v_requested then
      raise exception 'A data agendada não pode ser anterior à solicitação.' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if v_status = 'in_progress' then
    if not private.has_permission(p_organization_id, 'maintenance.start') then
      raise exception 'Você não possui permissão para registrar a entrada.' using errcode = 'insufficient_privilege';
    end if;
    if v_entry_date is null then
      raise exception 'Informe a data de entrada.' using errcode = 'invalid_parameter_value';
    end if;
    if v_entry_date > v_today then
      raise exception 'A entrada real não pode estar no futuro.' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if v_requested > v_today then
    raise exception 'A data da solicitação não pode estar no futuro.' using errcode = 'invalid_parameter_value';
  end if;

  if v_supplier is not null and not exists (
       select 1 from public.maintenance_suppliers s
        where s.id = v_supplier and s.organization_id = p_organization_id and s.status = 'active' and s.deleted_at is null) then
    raise exception 'Fornecedor inválido ou inativo.' using errcode = 'invalid_parameter_value';
  end if;

  -- Duplicidade: avisar é da tela; recusar sem justificativa é daqui.
  v_equivalents := private.maintenance_open_equivalents(v_vehicle.id, v_services);
  v_has_dup := exists (select 1 from jsonb_array_elements(v_equivalents) e
                        where (e ->> 'same_service')::boolean or (e ->> 'same_cluster')::boolean);
  if not v_has_dup then
    v_dup_reason := null;  -- só se guarda justificativa quando houve o que justificar
  end if;
  if v_has_dup and (v_dup_reason is null or length(v_dup_reason) < 10) then
    raise exception 'Já existe manutenção aberta equivalente para este veículo (%). Complemente a existente ou justifique a nova abertura.',
      (select string_agg(e ->> 'code', ', ') from jsonb_array_elements(v_equivalents) e
        where (e ->> 'same_service')::boolean or (e ->> 'same_cluster')::boolean)
      using errcode = 'unique_violation', hint = 'maintenance_duplicate';
  end if;

  v_code := private.next_entity_code(p_organization_id, 'maintenance:' || extract(year from v_requested)::int,
                                     'MAN-' || extract(year from v_requested)::int || '-', 6);
  select * into v_current from private.vehicle_current_km(v_vehicle.id);

  insert into public.maintenances
    (organization_id, code, vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id,
     vehicle_subcategory_id, vehicle_model_id, maintenance_type_code, origin_id, priority, status,
     context_date, requested_on, scheduled_date, scheduled_time, expected_exit_date, expected_exit_time,
     entry_date, entry_time, supplier_id, service_order_number,
     current_km_snapshot, current_km_date,
     preventive_cycle_id, predictive_cycle_id, predictive_plan_item_id, predictive_verification_id,
     checklist_execution_id, description, scheduling_notes, notes, duplicate_justification)
  values
    (p_organization_id, v_code, v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code, v_vehicle.vehicle_type_id,
     v_vehicle.vehicle_subcategory_id, v_vehicle.vehicle_model_id, v_type, v_origin.id,
     coalesce(p_payload ->> 'priority', 'medium'), v_status,
     coalesce(v_entry_date, v_requested), v_requested,
     v_sched_date, nullif(p_payload ->> 'scheduled_time', '')::time,
     nullif(p_payload ->> 'expected_exit_date', '')::date, nullif(p_payload ->> 'expected_exit_time', '')::time,
     case when v_status = 'in_progress' then v_entry_date end,
     case when v_status = 'in_progress' then nullif(p_payload ->> 'entry_time', '')::time end,
     v_supplier, nullif(btrim(p_payload ->> 'service_order_number'), ''),
     v_current.km, v_current.reading_date,
     v_pcycle_id,
     nullif(p_payload ->> 'predictive_cycle_id', '')::uuid,
     nullif(p_payload ->> 'predictive_plan_item_id', '')::uuid,
     nullif(p_payload ->> 'predictive_verification_id', '')::uuid,
     nullif(p_payload ->> 'checklist_execution_id', '')::uuid,
     nullif(btrim(p_payload ->> 'description'), ''),
     nullif(btrim(p_payload ->> 'scheduling_notes'), ''),
     nullif(btrim(p_payload ->> 'notes'), ''),
     v_dup_reason)
  returning id into v_id;

  -- Contexto histórico: onde o veículo estava na entrada (ou na solicitação).
  v_context := private.maintenance_context(p_organization_id, v_vehicle.id, coalesce(v_entry_date, v_requested));
  perform private.maintenance_apply_context(v_id, v_context);
  if (v_context ->> 'operation_id') is not null and not (
       (v_context ->> 'operation_id')::uuid in (select private.accessible_operation_ids())) then
    raise exception 'Este veículo não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;

  v_items := private.maintenance_insert_items(p_organization_id, v_id, v_vehicle.vehicle_type_id, v_type, v_services);

  if v_status = 'in_progress' then
    if nullif(p_payload ->> 'entry_km', '') is not null then
      v_km := private.maintenance_check_manual_km(p_organization_id, v_vehicle.id, v_entry_date, (p_payload ->> 'entry_km')::integer);
    else
      v_km := private.maintenance_resolve_km(p_organization_id, v_vehicle.id, v_entry_date);
    end if;
    perform private.maintenance_apply_entry_km(v_id, v_km, p_payload ->> 'entry_km_justification');
  end if;

  perform private.maintenance_log(p_organization_id, v_id, 'created', null, v_status,
    case when v_dup_reason is not null then 'Aberta com manutenção equivalente em aberto: ' || v_dup_reason end,
    jsonb_build_object('code', v_code, 'type', v_type, 'origin', v_origin.code, 'items', v_items,
                       'context', v_context, 'scheduled_date', v_sched_date, 'entry_date', v_entry_date,
                       'entry_km', v_km, 'supplier_id', v_supplier,
                       'equivalents', case when v_dup_reason is not null then v_equivalents end),
    case when p_system_origin = 'import' then 'import' else 'user' end);

  -- Apontamentos do Check List que esta manutenção vai tratar.
  select coalesce(array_agg(x::uuid), '{}') into v_answers
    from jsonb_array_elements_text(coalesce(p_payload -> 'checklist_answer_ids', '[]')) x;
  for v_answer in
    select a.id, a.execution_id, a.question_key, a.is_conforming, e.vehicle_id, e.organization_id,
           (select q.field_key from public.checklist_question_conditionals q
             where q.question_id = a.question_id and a.conditional_value is not null limit 1) as field_key
      from unnest(v_answers) u(answer_id)
      join public.checklist_execution_answers a on a.id = u.answer_id
      join public.checklist_executions e on e.id = a.execution_id
  loop
    if v_answer.organization_id <> p_organization_id or v_answer.vehicle_id <> v_vehicle.id then
      raise exception 'O apontamento do checklist não é deste veículo.' using errcode = 'invalid_parameter_value';
    end if;
    if v_answer.is_conforming then
      raise exception 'Só apontamentos inconformes podem originar manutenção.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.maintenance_finding_links
      (organization_id, maintenance_id, checklist_execution_id, checklist_answer_id, question_key, field_key, link_origin)
    values
      (p_organization_id, v_id, v_answer.execution_id, v_answer.id, v_answer.question_key, v_answer.field_key,
       'opened_from_finding');
    v_linked := v_linked + 1;
  end loop;
  if v_linked > 0 then
    perform private.maintenance_log(p_organization_id, v_id, 'finding_linked', null, null, null,
      jsonb_build_object('answers', to_jsonb(v_answers)));
  end if;
  if cardinality(v_answers) <> v_linked then
    raise exception 'Apontamento do checklist não encontrado.' using errcode = 'no_data_found';
  end if;

  perform private.emit_event(p_organization_id, 'maintenance.created', 'maintenance', v_id,
    jsonb_build_object('code', v_code, 'vehicle_id', v_vehicle.id, 'type', v_type, 'status', v_status));

  return jsonb_build_object('id', v_id, 'code', v_code, 'status', v_status, 'items', v_items);
end;
$$;

create or replace function public.maintenance_create(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.assert_vehicle_access((p_payload ->> 'vehicle_id')::uuid, 'maintenance.create', true);
  if v_org <> p_organization_id then
    raise exception 'Veículo de outra organização.' using errcode = 'insufficient_privilege';
  end if;
  if p_payload ->> 'maintenance_type_code' = 'preventive'
     and not private.has_permission(v_org, 'maintenance.manage_preventive') then
    raise exception 'Manutenção preventiva é gerada a partir do ciclo (permissão Gerir preventiva).'
      using errcode = 'insufficient_privilege';
  end if;
  return private.maintenance_create_internal(
    v_org, p_payload,
    case when p_payload ->> 'maintenance_type_code' = 'preventive' then 'preventive_schedule' end);
end;
$$;

-- Candidatas a duplicidade para a tela (antes de abrir).
create or replace function public.maintenance_find_open(p_vehicle_id uuid, p_service_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null or not (private.has_permission(v_org, 'maintenance.create') or private.has_permission(v_org, 'maintenance.view_base')) then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
  if not private.vehicle_in_scope(v_org, p_vehicle_id) then
    raise exception 'Este veículo não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  return private.maintenance_open_equivalents(p_vehicle_id, p_service_ids);
end;
$$;

-- Complementar serviços de uma manutenção aberta.
create or replace function public.maintenance_add_items(p_maintenance_id uuid, p_service_ids uuid[], p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     public.maintenances;
  v_added jsonb;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.create');
  if v_m.status not in ('to_schedule', 'scheduled', 'in_progress') then
    raise exception 'Só manutenção aberta recebe novos serviços.' using errcode = 'invalid_parameter_value';
  end if;
  v_added := private.maintenance_insert_items(v_m.organization_id, v_m.id, v_m.vehicle_type_id, v_m.maintenance_type_code, p_service_ids);
  if jsonb_array_length(v_added) > 0 then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'items_added', null, null, p_reason,
      jsonb_build_object('items', v_added));
  end if;
  return v_added;
end;
$$;

create or replace function public.maintenance_remove_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.maintenance_items;
  v_m    public.maintenances;
begin
  select * into v_item from public.maintenance_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Item não encontrado.' using errcode = 'no_data_found';
  end if;
  v_m := private.maintenance_lock(v_item.maintenance_id, 'maintenance.edit');
  if v_m.status not in ('to_schedule', 'scheduled', 'in_progress') then
    raise exception 'Só manutenção aberta tem serviços removidos.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo da remoção.' using errcode = 'invalid_parameter_value';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'Só itens pendentes podem ser removidos.' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from public.maintenance_items i
       where i.maintenance_id = v_m.id and i.status <> 'cancelled') <= 1 then
    raise exception 'A manutenção precisa de ao menos um serviço. Cancele a manutenção em vez disso.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_items set status = 'cancelled' where id = p_item_id;
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'item_removed', null, null, p_reason,
    jsonb_build_object('item_id', p_item_id, 'service', v_item.service_name_snapshot, 'cluster', v_item.cluster_name_snapshot));
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Programação
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_schedule(p_maintenance_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m        public.maintenances;
  v_date     date := nullif(p_payload ->> 'scheduled_date', '')::date;
  v_supplier uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.schedule');
  perform private.maintenance_assert_transition(v_m.status, 'scheduled');
  if v_date is null then
    raise exception 'Informe a data agendada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < v_m.requested_on then
    raise exception 'A data agendada não pode ser anterior à solicitação (%).', to_char(v_m.requested_on, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_supplier is not null and not exists (
       select 1 from public.maintenance_suppliers s
        where s.id = v_supplier and s.organization_id = v_m.organization_id and s.status = 'active' and s.deleted_at is null) then
    raise exception 'Fornecedor inválido ou inativo.' using errcode = 'invalid_parameter_value';
  end if;

  update public.maintenances set
    status               = 'scheduled',
    scheduled_date       = v_date,
    scheduled_time       = nullif(p_payload ->> 'scheduled_time', '')::time,
    expected_exit_date   = nullif(p_payload ->> 'expected_exit_date', '')::date,
    expected_exit_time   = nullif(p_payload ->> 'expected_exit_time', '')::time,
    supplier_id          = coalesce(v_supplier, supplier_id),
    service_order_number = coalesce(nullif(btrim(p_payload ->> 'service_order_number'), ''), service_order_number),
    scheduling_notes     = coalesce(nullif(btrim(p_payload ->> 'scheduling_notes'), ''), scheduling_notes)
  where id = v_m.id;

  perform private.maintenance_log(v_m.organization_id, v_m.id, 'scheduled', v_m.status, 'scheduled', null,
    jsonb_build_object('scheduled_date', v_date, 'scheduled_time', p_payload ->> 'scheduled_time',
                       'expected_exit_date', p_payload ->> 'expected_exit_date',
                       'supplier_id', coalesce(v_supplier, v_m.supplier_id),
                       'service_order_number', p_payload ->> 'service_order_number'));
end;
$$;

-- Reprogramar: data, horário, fornecedor e previsão — sempre com motivo, sempre
-- com o valor anterior e o novo na trilha. Não muda a situação.
create or replace function public.maintenance_reschedule(p_maintenance_id uuid, p_payload jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m        public.maintenances;
  v_before   jsonb;
  v_after    jsonb;
  v_date     date;
  v_supplier uuid;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.reschedule');
  if v_m.status not in ('scheduled', 'in_progress') then
    raise exception 'Só manutenção agendada ou em execução pode ser reprogramada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo da reprogramação.' using errcode = 'invalid_parameter_value';
  end if;

  v_date := case when v_m.status = 'scheduled' and p_payload ? 'scheduled_date'
                 then nullif(p_payload ->> 'scheduled_date', '')::date else v_m.scheduled_date end;
  if v_m.status = 'in_progress' and p_payload ? 'scheduled_date'
     and nullif(p_payload ->> 'scheduled_date', '')::date is distinct from v_m.scheduled_date then
    raise exception 'Em execução, só fornecedor e previsão de saída podem mudar.' using errcode = 'invalid_parameter_value';
  end if;
  if v_m.status = 'scheduled' and v_date is null then
    raise exception 'Informe a data agendada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date is not null and v_date < v_m.requested_on then
    raise exception 'A data agendada não pode ser anterior à solicitação.' using errcode = 'invalid_parameter_value';
  end if;
  v_supplier := case when p_payload ? 'supplier_id' then nullif(p_payload ->> 'supplier_id', '')::uuid else v_m.supplier_id end;
  if v_supplier is not null and v_supplier is distinct from v_m.supplier_id and not exists (
       select 1 from public.maintenance_suppliers s
        where s.id = v_supplier and s.organization_id = v_m.organization_id and s.status = 'active' and s.deleted_at is null) then
    raise exception 'Fornecedor inválido ou inativo.' using errcode = 'invalid_parameter_value';
  end if;

  v_before := jsonb_build_object('scheduled_date', v_m.scheduled_date, 'scheduled_time', v_m.scheduled_time,
                                 'supplier_id', v_m.supplier_id, 'expected_exit_date', v_m.expected_exit_date,
                                 'expected_exit_time', v_m.expected_exit_time);
  update public.maintenances set
    scheduled_date     = v_date,
    scheduled_time     = case when v_m.status = 'scheduled' and p_payload ? 'scheduled_time'
                              then nullif(p_payload ->> 'scheduled_time', '')::time else scheduled_time end,
    supplier_id        = v_supplier,
    expected_exit_date = case when p_payload ? 'expected_exit_date' then nullif(p_payload ->> 'expected_exit_date', '')::date else expected_exit_date end,
    expected_exit_time = case when p_payload ? 'expected_exit_time' then nullif(p_payload ->> 'expected_exit_time', '')::time else expected_exit_time end
  where id = v_m.id
  returning jsonb_build_object('scheduled_date', scheduled_date, 'scheduled_time', scheduled_time,
                               'supplier_id', supplier_id, 'expected_exit_date', expected_exit_date,
                               'expected_exit_time', expected_exit_time)
    into v_after;

  if v_after = v_before then
    raise exception 'Nada mudou na programação.' using errcode = 'invalid_parameter_value';
  end if;

  perform private.maintenance_log(v_m.organization_id, v_m.id, 'rescheduled', null, null, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  if v_supplier is distinct from v_m.supplier_id then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'supplier_changed', null, null, p_reason,
      jsonb_build_object('before', v_m.supplier_id, 'after', v_supplier));
  end if;
end;
$$;

create or replace function public.maintenance_unschedule(p_maintenance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.maintenances;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.reschedule');
  perform private.maintenance_assert_transition(v_m.status, 'to_schedule');
  if v_m.status <> 'scheduled' then
    raise exception 'Só manutenção agendada pode ser desprogramada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenances set status = 'to_schedule', scheduled_date = null, scheduled_time = null
   where id = v_m.id;
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'unscheduled', 'scheduled', 'to_schedule', p_reason,
    jsonb_build_object('before', jsonb_build_object('scheduled_date', v_m.scheduled_date, 'scheduled_time', v_m.scheduled_time)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Execução
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_start(p_maintenance_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m        public.maintenances;
  v_date     date := nullif(p_payload ->> 'entry_date', '')::date;
  v_today    date;
  v_context  jsonb;
  v_km       jsonb;
  v_supplier uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.start');
  perform private.maintenance_assert_transition(v_m.status, 'in_progress');
  if v_m.status = 'completed' then
    raise exception 'Use a reabertura para voltar uma manutenção concluída à execução.' using errcode = 'invalid_parameter_value';
  end if;
  v_today := private.maintenance_today(v_m.organization_id);
  if v_date is null then
    raise exception 'Informe a data real de entrada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date > v_today then
    raise exception 'A entrada real não pode estar no futuro.' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < v_m.requested_on then
    raise exception 'A entrada não pode ser anterior à solicitação (%).', to_char(v_m.requested_on, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_supplier is not null and not exists (
       select 1 from public.maintenance_suppliers s
        where s.id = v_supplier and s.organization_id = v_m.organization_id and s.status = 'active' and s.deleted_at is null) then
    raise exception 'Fornecedor inválido ou inativo.' using errcode = 'invalid_parameter_value';
  end if;

  update public.maintenances set
    status               = 'in_progress',
    entry_date           = v_date,
    entry_time           = nullif(p_payload ->> 'entry_time', '')::time,
    supplier_id          = coalesce(v_supplier, supplier_id),
    service_order_number = coalesce(nullif(btrim(p_payload ->> 'service_order_number'), ''), service_order_number),
    expected_exit_date   = coalesce(nullif(p_payload ->> 'expected_exit_date', '')::date, expected_exit_date),
    expected_exit_time   = coalesce(nullif(p_payload ->> 'expected_exit_time', '')::time, expected_exit_time)
  where id = v_m.id;

  -- A execução fixa o contexto: onde o veículo estava ao entrar em oficina.
  v_context := private.maintenance_context(v_m.organization_id, v_m.vehicle_id, v_date);
  perform private.maintenance_apply_context(v_m.id, v_context);

  if nullif(p_payload ->> 'entry_km', '') is not null then
    v_km := private.maintenance_check_manual_km(v_m.organization_id, v_m.vehicle_id, v_date, (p_payload ->> 'entry_km')::integer);
  else
    v_km := private.maintenance_resolve_km(v_m.organization_id, v_m.vehicle_id, v_date);
  end if;
  perform private.maintenance_apply_entry_km(v_m.id, v_km, p_payload ->> 'entry_km_justification');

  perform private.maintenance_log(v_m.organization_id, v_m.id, 'started', v_m.status, 'in_progress', null,
    jsonb_build_object('entry_date', v_date, 'entry_time', p_payload ->> 'entry_time',
                       'supplier_id', coalesce(v_supplier, v_m.supplier_id), 'entry_km', v_km,
                       'context', v_context,
                       'context_changed', (v_context ->> 'operation_br_id') is distinct from v_m.operation_br_id::text
                                          or (v_context ->> 'operation_id') is distinct from v_m.operation_id::text));
  return v_km;
end;
$$;

create or replace function public.maintenance_set_entry_km(p_maintenance_id uuid, p_km integer, p_justification text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m  public.maintenances;
  v_km jsonb;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.start');
  if v_m.entry_date is null then
    raise exception 'O KM de entrada só existe depois da entrada em oficina.' using errcode = 'invalid_parameter_value';
  end if;
  if v_m.status not in ('in_progress', 'completed') then
    raise exception 'Situação não permite alterar o KM de entrada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_justification, ''))) < 5 then
    raise exception 'KM manual exige justificativa.' using errcode = 'invalid_parameter_value';
  end if;
  v_km := private.maintenance_check_manual_km(v_m.organization_id, v_m.vehicle_id, v_m.entry_date, p_km);
  perform private.maintenance_apply_entry_km(v_m.id, v_km, p_justification);
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'km_changed', null, null, p_justification,
    jsonb_build_object('before', jsonb_build_object('km', v_m.entry_km, 'status', v_m.entry_km_status, 'source', v_m.entry_km_source),
                       'after', v_km));
  -- Preventiva já realizada por esta manutenção acompanha o KM corrigido.
  update public.maintenance_preventive_cycles c set completed_km = p_km
   where c.completed_maintenance_id = v_m.id;
  return v_km;
end;
$$;

create or replace function public.maintenance_reprocess_km(p_maintenance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m  public.maintenances;
  v_km jsonb;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.reprocess');
  if v_m.entry_date is null then
    return jsonb_build_object('status', null);
  end if;
  if v_m.entry_km_source = 'manual' then
    -- O manual é do usuário: reprocessar só reavalia a divergência.
    v_km := private.maintenance_check_manual_km(v_m.organization_id, v_m.vehicle_id, v_m.entry_date, v_m.entry_km);
    v_km := v_km || jsonb_build_object('justification_kept', true);
    update public.maintenances set entry_km_status = v_km ->> 'status',
                                   entry_km_official = (v_km ->> 'official_km')::integer,
                                   entry_km_difference = (v_km ->> 'difference')::integer
     where id = v_m.id;
  else
    v_km := private.maintenance_resolve_km(v_m.organization_id, v_m.vehicle_id, v_m.entry_date);
    perform private.maintenance_apply_entry_km(v_m.id, v_km, null);
  end if;
  if (v_km ->> 'status') is distinct from v_m.entry_km_status or (v_km ->> 'km')::integer is distinct from v_m.entry_km then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'km_changed', null, null, 'Reprocessamento do KM',
      jsonb_build_object('before', jsonb_build_object('km', v_m.entry_km, 'status', v_m.entry_km_status), 'after', v_km),
      'user');
    update public.maintenance_preventive_cycles c set completed_km = (v_km ->> 'km')::integer
     where c.completed_maintenance_id = v_m.id and (v_km ->> 'km') is not null;
  end if;
  return v_km;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Conclusão (e o que ela alimenta), cancelamento, reabertura
-- -----------------------------------------------------------------------------
-- A preventiva e a preditiva ganham a sua parte na migration seguinte; aqui a
-- conclusão chama os ganchos private.maintenance_on_completed/on_reopened, que
-- nascem vazios e são substituídos lá.
create or replace function private.maintenance_on_completed(p_maintenance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;

create or replace function private.maintenance_on_reopened(p_maintenance_id uuid, p_completion jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  null;
end;
$$;

-- Apontamentos do Check List: a conclusão resolve só o que foi tratado.
create or replace function private.maintenance_resolve_findings(p_maintenance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link   record;
  v_item   record;
  v_result jsonb := '[]'::jsonb;
  v_status text;
begin
  for v_link in
    select f.* from public.maintenance_finding_links f
     where f.maintenance_id = p_maintenance_id and f.resolution_status = 'pending'
  loop
    -- O item realizado cujo serviço está mapeado (com baixa automática) para a
    -- pergunta — e para o campo condicional, quando houver — deste apontamento.
    select i.id, i.status, i.result into v_item
      from public.maintenance_items i
      join public.maintenance_checklist_service_links l
        on l.service_id = i.service_id and l.organization_id = i.organization_id
       and l.is_active and l.auto_resolve
       and l.question_key = v_link.question_key
       and (l.field_key is null or l.field_key is not distinct from v_link.field_key)
     where i.maintenance_id = p_maintenance_id and i.status in ('done', 'not_done')
     order by (i.status = 'done') desc, (i.result = 'resolved') desc
     limit 1;

    if v_item.id is null then
      continue;  -- nenhum serviço mapeado tratou este apontamento: segue pendente
    end if;
    v_status := case
                  when v_item.status = 'done' and v_item.result = 'resolved' then 'resolved'
                  when v_item.status = 'done' then 'partially_resolved'
                  else 'not_resolved'
                end;
    update public.maintenance_finding_links
       set resolution_status = v_status, resolved_by_item_id = v_item.id,
           resolved_at = case when v_status = 'resolved' then now() end,
           resolved_by = case when v_status = 'resolved' then auth.uid() end
     where id = v_link.id;
    v_result := v_result || jsonb_build_object('link_id', v_link.id, 'answer_id', v_link.checklist_answer_id,
                                               'question_key', v_link.question_key, 'status', v_status);
  end loop;
  return v_result;
end;
$$;

-- p_payload: exit_date, exit_time, items [{item_id, status: done|not_done, result, notes}],
--            supplier_id, service_order_number, completion_notes
create or replace function public.maintenance_complete(p_maintenance_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m        public.maintenances;
  v_exit     date := nullif(p_payload ->> 'exit_date', '')::date;
  v_exit_t   time := nullif(p_payload ->> 'exit_time', '')::time;
  v_today    date;
  v_item     jsonb;
  v_row      public.maintenance_items;
  v_pending  integer;
  v_supplier uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
  v_effects  jsonb;
  v_findings jsonb;
  v_items    jsonb := '[]'::jsonb;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.complete');
  perform private.maintenance_assert_transition(v_m.status, 'completed');
  v_today := private.maintenance_today(v_m.organization_id);
  if v_exit is null then
    raise exception 'Informe a data real de saída.' using errcode = 'invalid_parameter_value';
  end if;
  if v_exit > v_today then
    raise exception 'A saída real não pode estar no futuro.' using errcode = 'invalid_parameter_value';
  end if;
  if v_exit < v_m.entry_date or (v_exit = v_m.entry_date and v_exit_t is not null and v_m.entry_time is not null and v_exit_t < v_m.entry_time) then
    raise exception 'A saída não pode ser anterior à entrada (%).', to_char(v_m.entry_date, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_supplier is not null and not exists (
       select 1 from public.maintenance_suppliers s
        where s.id = v_supplier and s.organization_id = v_m.organization_id and s.deleted_at is null) then
    raise exception 'Fornecedor inválido.' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'))
  loop
    select * into v_row from public.maintenance_items
     where id = (v_item ->> 'item_id')::uuid and maintenance_id = v_m.id for update;
    if v_row.id is null then
      raise exception 'Item não pertence a esta manutenção.' using errcode = 'invalid_parameter_value';
    end if;
    if v_row.status = 'cancelled' then
      continue;
    end if;
    if v_item ->> 'status' not in ('done', 'not_done') then
      raise exception 'Informe se o serviço "%" foi realizado.', v_row.service_name_snapshot using errcode = 'invalid_parameter_value';
    end if;
    if v_item ->> 'status' = 'not_done' and length(btrim(coalesce(v_item ->> 'notes', ''))) < 5 then
      raise exception 'Explique por que o serviço "%" não foi realizado.', v_row.service_name_snapshot using errcode = 'invalid_parameter_value';
    end if;
    update public.maintenance_items set
      status       = v_item ->> 'status',
      result       = case when v_item ->> 'status' = 'done'
                          then coalesce(nullif(v_item ->> 'result', ''), 'resolved') else 'not_resolved' end,
      notes        = coalesce(nullif(btrim(v_item ->> 'notes'), ''), notes),
      completed_at = now()
    where id = v_row.id;
    v_items := v_items || jsonb_build_object('item_id', v_row.id, 'service', v_row.service_name_snapshot,
                                             'status', v_item ->> 'status', 'result', v_item ->> 'result');
  end loop;

  select count(*) into v_pending from public.maintenance_items
   where maintenance_id = v_m.id and status = 'pending';
  if v_pending > 0 then
    raise exception 'Há % serviço(s) sem resultado. Informe, para cada um, se foi realizado.', v_pending
      using errcode = 'invalid_parameter_value';
  end if;

  update public.maintenances set
    status               = 'completed',
    exit_date            = v_exit,
    exit_time            = v_exit_t,
    supplier_id          = coalesce(v_supplier, supplier_id),
    service_order_number = coalesce(nullif(btrim(p_payload ->> 'service_order_number'), ''), service_order_number),
    completion_notes     = nullif(btrim(p_payload ->> 'completion_notes'), '')
  where id = v_m.id;

  v_effects  := private.maintenance_on_completed(v_m.id);
  v_findings := private.maintenance_resolve_findings(v_m.id);

  perform private.maintenance_log(v_m.organization_id, v_m.id, 'completed', 'in_progress', 'completed', null,
    jsonb_build_object('exit_date', v_exit, 'exit_time', v_exit_t, 'items', v_items,
                       'duration_hours', (select duration_hours from public.maintenances where id = v_m.id),
                       'effects', v_effects, 'findings', v_findings));
  if jsonb_array_length(v_findings) > 0 then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'finding_resolved', null, null, null,
      jsonb_build_object('findings', v_findings));
  end if;

  perform private.emit_event(v_m.organization_id, 'maintenance.completed', 'maintenance', v_m.id,
    jsonb_build_object('code', v_m.code, 'vehicle_id', v_m.vehicle_id, 'exit_date', v_exit));
  return jsonb_build_object('effects', v_effects, 'findings', v_findings);
end;
$$;

create or replace function public.maintenance_cancel(p_maintenance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.maintenances;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.edit');
  perform private.maintenance_assert_transition(v_m.status, 'cancelled');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenances set status = 'cancelled' where id = v_m.id;
  update public.maintenance_items set status = 'cancelled' where maintenance_id = v_m.id and status = 'pending';
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'cancelled', v_m.status, 'cancelled', p_reason, '{}'::jsonb);
end;
$$;

create or replace function public.maintenance_mark_not_performed(p_maintenance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.maintenances;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.edit');
  perform private.maintenance_assert_transition(v_m.status, 'not_performed');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenances set status = 'not_performed' where id = v_m.id;
  update public.maintenance_items set status = 'cancelled' where maintenance_id = v_m.id and status = 'pending';
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'not_performed', v_m.status, 'not_performed', p_reason, '{}'::jsonb);
end;
$$;

-- Reabrir preserva a conclusão anterior na trilha; nada é apagado.
create or replace function public.maintenance_reopen(p_maintenance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m          public.maintenances;
  v_to         text;
  v_completion jsonb;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.reopen');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reabertura exige justificativa (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  v_to := case v_m.status when 'completed' then 'in_progress' when 'cancelled' then 'to_schedule'
                          when 'not_performed' then 'to_schedule' end;
  if v_to is null then
    raise exception 'Só manutenção concluída, cancelada ou não realizada pode ser reaberta.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.maintenance_assert_transition(v_m.status, v_to);

  if v_m.status = 'completed' then
    -- A conclusão anterior (e o que ela alimentou) fica na trilha.
    select e.payload into v_completion from public.maintenance_events e
     where e.maintenance_id = v_m.id and e.event_type = 'completed'
     order by e.occurred_at desc limit 1;
    update public.maintenances set status = 'in_progress', exit_date = null, exit_time = null,
                                   reopen_count = reopen_count + 1
     where id = v_m.id;
    update public.maintenance_items set status = 'pending', result = null, completed_at = null
     where maintenance_id = v_m.id and status in ('done', 'not_done');
    update public.maintenance_finding_links
       set resolution_status = 'pending', resolved_by_item_id = null, resolved_at = null, resolved_by = null
     where maintenance_id = v_m.id and resolution_status <> 'pending';
    perform private.maintenance_on_reopened(v_m.id, v_completion);
  else
    update public.maintenances set status = 'to_schedule', scheduled_date = null, scheduled_time = null,
                                   reopen_count = reopen_count + 1
     where id = v_m.id;
    update public.maintenance_items set status = 'pending'
     where maintenance_id = v_m.id and status = 'cancelled'
       and not exists (select 1 from public.maintenance_items i2
                        where i2.maintenance_id = v_m.id and i2.service_id = maintenance_items.service_id
                          and i2.status <> 'cancelled' and i2.id <> maintenance_items.id);
  end if;

  perform private.maintenance_log(v_m.organization_id, v_m.id, 'reopened', v_m.status, v_to, p_reason,
    jsonb_build_object('previous_exit_date', v_m.exit_date, 'previous_exit_time', v_m.exit_time,
                       'previous_completion', v_completion));
end;
$$;

-- Dados descritivos (não mexe em situação, datas de execução nem KM).
create or replace function public.maintenance_update_details(p_maintenance_id uuid, p_payload jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.maintenances;
  v_before jsonb;
  v_after  jsonb;
  v_origin uuid;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.edit');
  if v_m.status in ('completed', 'cancelled', 'not_performed') then
    raise exception 'Manutenção encerrada não é editada; reabra-a primeiro.' using errcode = 'invalid_parameter_value';
  end if;
  if p_payload ? 'origin_id' then
    select o.id into v_origin from public.maintenance_origins o
     where o.id = (p_payload ->> 'origin_id')::uuid and o.is_active and o.manual_selectable
       and (o.organization_id is null or o.organization_id = v_m.organization_id);
    if v_origin is null then
      raise exception 'Origem inválida.' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_payload ? 'priority' and p_payload ->> 'priority' not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridade inválida.' using errcode = 'invalid_parameter_value';
  end if;

  v_before := jsonb_build_object('priority', v_m.priority, 'origin_id', v_m.origin_id, 'description', v_m.description,
                                 'notes', v_m.notes, 'scheduling_notes', v_m.scheduling_notes,
                                 'service_order_number', v_m.service_order_number);
  update public.maintenances set
    priority             = coalesce(p_payload ->> 'priority', priority),
    origin_id            = coalesce(v_origin, origin_id),
    description          = case when p_payload ? 'description' then nullif(btrim(p_payload ->> 'description'), '') else description end,
    notes                = case when p_payload ? 'notes' then nullif(btrim(p_payload ->> 'notes'), '') else notes end,
    scheduling_notes     = case when p_payload ? 'scheduling_notes' then nullif(btrim(p_payload ->> 'scheduling_notes'), '') else scheduling_notes end,
    service_order_number = case when p_payload ? 'service_order_number' then nullif(btrim(p_payload ->> 'service_order_number'), '') else service_order_number end
  where id = v_m.id
  returning jsonb_build_object('priority', priority, 'origin_id', origin_id, 'description', description,
                               'notes', notes, 'scheduling_notes', scheduling_notes,
                               'service_order_number', service_order_number)
    into v_after;
  if v_after <> v_before then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'details_updated', null, null, p_reason,
      jsonb_build_object('before', v_before, 'after', v_after));
  end if;
end;
$$;

-- Vincular/desvincular apontamentos do Check List a uma manutenção existente.
create or replace function public.maintenance_link_findings(p_maintenance_id uuid, p_answer_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.maintenances;
  v_answer record;
  v_count  integer := 0;
begin
  v_m := private.maintenance_lock(p_maintenance_id, 'maintenance.create');
  if v_m.status in ('cancelled', 'not_performed') then
    raise exception 'Manutenção encerrada sem execução não trata apontamentos.' using errcode = 'invalid_parameter_value';
  end if;
  for v_answer in
    select a.id, a.execution_id, a.question_key, a.is_conforming, e.vehicle_id, e.organization_id,
           (select q.field_key from public.checklist_question_conditionals q
             where q.question_id = a.question_id and a.conditional_value is not null limit 1) as field_key
      from unnest(p_answer_ids) u(answer_id)
      join public.checklist_execution_answers a on a.id = u.answer_id
      join public.checklist_executions e on e.id = a.execution_id
  loop
    if v_answer.organization_id <> v_m.organization_id or v_answer.vehicle_id <> v_m.vehicle_id then
      raise exception 'O apontamento do checklist não é deste veículo.' using errcode = 'invalid_parameter_value';
    end if;
    if v_answer.is_conforming then
      raise exception 'Só apontamentos inconformes podem ser vinculados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.maintenance_finding_links
      (organization_id, maintenance_id, checklist_execution_id, checklist_answer_id, question_key, field_key, link_origin)
    values
      (v_m.organization_id, v_m.id, v_answer.execution_id, v_answer.id, v_answer.question_key, v_answer.field_key, 'manual')
    on conflict (maintenance_id, checklist_answer_id) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count > 0 then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'finding_linked', null, null, p_reason,
      jsonb_build_object('answers', to_jsonb(p_answer_ids), 'linked', v_count));
  end if;
  return v_count;
end;
$$;

create or replace function public.maintenance_unlink_finding(p_link_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.maintenance_finding_links;
  v_m    public.maintenances;
begin
  select * into v_link from public.maintenance_finding_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'Vínculo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_m := private.maintenance_lock(v_link.maintenance_id, 'maintenance.edit');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Informe o motivo.' using errcode = 'invalid_parameter_value';
  end if;
  if v_link.resolution_status <> 'pending' then
    raise exception 'Apontamento já tratado não é desvinculado; reabra a manutenção.' using errcode = 'invalid_parameter_value';
  end if;
  -- O vínculo é um fato da trilha: registra-se o desfazer, e a linha sai.
  perform private.maintenance_log(v_m.organization_id, v_m.id, 'finding_unlinked', null, null, p_reason,
    jsonb_build_object('answer_id', v_link.checklist_answer_id, 'question_key', v_link.question_key));
  delete from public.maintenance_finding_links where id = p_link_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Grants
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.maintenance_status_label(text)',
    'private.maintenance_actor_name(uuid)',
    'private.maintenance_log(uuid, uuid, text, text, text, text, jsonb, text)',
    'private.maintenance_transition_allowed(text, text)',
    'private.maintenance_assert_transition(text, text)',
    'private.maintenance_lock(uuid, text)',
    'private.maintenance_context(uuid, uuid, date)',
    'private.maintenance_apply_context(uuid, jsonb)',
    'private.vehicle_current_km(uuid)',
    'private.maintenance_resolve_km(uuid, uuid, date)',
    'private.maintenance_check_manual_km(uuid, uuid, date, integer)',
    'private.maintenance_apply_entry_km(uuid, jsonb, text)',
    'private.maintenance_insert_items(uuid, uuid, uuid, text, uuid[])',
    'private.maintenance_open_equivalents(uuid, uuid[], uuid)',
    'private.maintenance_create_internal(uuid, jsonb, text)',
    'private.maintenance_on_completed(uuid)',
    'private.maintenance_on_reopened(uuid, jsonb)',
    'private.maintenance_resolve_findings(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.maintenance_create(uuid, jsonb)',
    'public.maintenance_find_open(uuid, uuid[])',
    'public.maintenance_add_items(uuid, uuid[], text)',
    'public.maintenance_remove_item(uuid, text)',
    'public.maintenance_schedule(uuid, jsonb)',
    'public.maintenance_reschedule(uuid, jsonb, text)',
    'public.maintenance_unschedule(uuid, text)',
    'public.maintenance_start(uuid, jsonb)',
    'public.maintenance_set_entry_km(uuid, integer, text)',
    'public.maintenance_reprocess_km(uuid)',
    'public.maintenance_complete(uuid, jsonb)',
    'public.maintenance_cancel(uuid, text)',
    'public.maintenance_mark_not_performed(uuid, text)',
    'public.maintenance_reopen(uuid, text)',
    'public.maintenance_update_details(uuid, jsonb, text)',
    'public.maintenance_link_findings(uuid, uuid[], text)',
    'public.maintenance_unlink_finding(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
