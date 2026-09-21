-- =============================================================================
-- ETAPA 06 · AS ROTINAS QUE MOVEM A FROTA
--
-- Quatro coisas mudam de dono aqui, e cada uma tem a sua rotina com a sua
-- permissão:
--
--   save_vehicle              cadastro e edição
--   set_vehicle_assignment    alocação e transferência
--   correct_vehicle_odometer  correção da leitura oficial
--   set_vehicle_status        situação cadastral, arquivamento e restauração
--
-- `save_vehicle` deliberadamente NÃO toca alocação nem hodômetro numa edição.
-- Um formulário de cadastro que também transfere o veículo de cidade é
-- exatamente como se perde a vigência anterior sem ninguém perceber.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- public.save_vehicle(uuid, jsonb)
-- -----------------------------------------------------------------------------
create or replace function public.save_vehicle(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_is_new    boolean := v_id is null;
  v_km        integer := nullif(p_payload ->> 'initial_odometer_km', '')::integer;
  v_km_date   date    := coalesce(nullif(p_payload ->> 'initial_odometer_date', '')::date, current_date);
  v_op        uuid    := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_state     smallint := nullif(p_payload ->> 'state_id', '')::smallint;
  v_city      integer := nullif(p_payload ->> 'city_id', '')::integer;
begin
  if not private.has_permission(p_organization_id, case when v_is_new then 'vehicles.create' else 'vehicles.update' end) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;

  if nullif(p_payload ->> 'fleet_code', '') is null then
    raise exception 'Informe o código da frota.' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_payload ->> 'license_plate', '') is null then
    raise exception 'Informe a placa.' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_payload ->> 'vehicle_type_id', '') is null then
    raise exception 'Informe o tipo de equipamento.' using errcode = 'invalid_parameter_value';
  end if;

  if v_is_new then
    insert into public.vehicles (
      organization_id, fleet_code, license_plate, vin, renavam,
      vehicle_type_id, vehicle_subcategory_id, vehicle_model_id,
      manufacture_year, model_year, ownership_type, status,
      asset_value, antt_code, has_tachograph, tachograph_number, notes,
      organization_unit_id, cost_center_id
    ) values (
      p_organization_id,
      p_payload ->> 'fleet_code',
      p_payload ->> 'license_plate',
      nullif(p_payload ->> 'vin', ''),
      nullif(p_payload ->> 'renavam', ''),
      (p_payload ->> 'vehicle_type_id')::uuid,
      nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid,
      nullif(p_payload ->> 'vehicle_model_id', '')::uuid,
      nullif(p_payload ->> 'manufacture_year', '')::smallint,
      nullif(p_payload ->> 'model_year', '')::smallint,
      coalesce(nullif(p_payload ->> 'ownership_type', ''), 'owned'),
      coalesce(nullif(p_payload ->> 'status', ''), 'active'),
      nullif(p_payload ->> 'asset_value', '')::numeric,
      nullif(p_payload ->> 'antt_code', ''),
      coalesce((p_payload ->> 'has_tachograph')::boolean, false),
      nullif(p_payload ->> 'tachograph_number', ''),
      nullif(p_payload ->> 'notes', ''),
      nullif(p_payload ->> 'organization_unit_id', '')::uuid,
      nullif(p_payload ->> 'cost_center_id', '')::uuid
    )
    returning id into v_id;
  else
    -- Identidade técnica só muda com vehicles.update; o que ela não pode fazer
    -- é mudar de organização.
    update public.vehicles set
      fleet_code             = p_payload ->> 'fleet_code',
      license_plate          = p_payload ->> 'license_plate',
      vin                    = nullif(p_payload ->> 'vin', ''),
      renavam                = nullif(p_payload ->> 'renavam', ''),
      vehicle_type_id        = (p_payload ->> 'vehicle_type_id')::uuid,
      vehicle_subcategory_id = nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid,
      vehicle_model_id       = nullif(p_payload ->> 'vehicle_model_id', '')::uuid,
      manufacture_year       = nullif(p_payload ->> 'manufacture_year', '')::smallint,
      model_year             = nullif(p_payload ->> 'model_year', '')::smallint,
      ownership_type         = coalesce(nullif(p_payload ->> 'ownership_type', ''), 'owned'),
      asset_value            = nullif(p_payload ->> 'asset_value', '')::numeric,
      antt_code              = nullif(p_payload ->> 'antt_code', ''),
      has_tachograph         = coalesce((p_payload ->> 'has_tachograph')::boolean, false),
      tachograph_number      = nullif(p_payload ->> 'tachograph_number', ''),
      notes                  = nullif(p_payload ->> 'notes', ''),
      organization_unit_id   = nullif(p_payload ->> 'organization_unit_id', '')::uuid,
      cost_center_id         = nullif(p_payload ->> 'cost_center_id', '')::uuid
    where id = v_id and organization_id = p_organization_id;

    if not found then
      raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
    end if;
  end if;

  -- Alocação e hodômetro só entram por aqui na criação. Na edição, cada um tem
  -- a sua rotina, com a sua permissão e a sua vigência.
  if v_is_new then
    if v_op is not null and v_city is not null and v_state is not null then
      perform public.set_vehicle_assignment(
        v_id, v_op, v_state, v_city,
        coalesce(nullif(p_payload ->> 'assigned_from', '')::date, current_date),
        nullif(p_payload ->> 'assignment_reason', '')
      );
    end if;

    if v_km is not null then
      insert into public.vehicle_odometer_readings
        (organization_id, vehicle_id, reading_date, odometer_km, source, notes)
      values
        (p_organization_id, v_id, v_km_date, v_km, 'initial_registration',
         'Leitura informada no cadastro inicial.');
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_vehicle(uuid, jsonb) from public, anon;
grant  execute on function public.save_vehicle(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- public.set_vehicle_assignment(...)
--
-- Encerra a vigência anterior e abre a nova, na mesma transação. Se a nova
-- falhar — cidade fora da cobertura, período sobreposto — a anterior continua
-- de pé. Nunca existe um instante em que o veículo não está em lugar nenhum.
-- -----------------------------------------------------------------------------
create or replace function public.set_vehicle_assignment(
  p_vehicle_id   uuid,
  p_operation_id uuid,
  p_state_id     smallint,
  p_city_id      integer,
  p_effective_from date default current_date,
  p_reason       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_current record;
  v_new     uuid;
begin
  -- Trava a linha do veículo: duas transferências simultâneas do mesmo veículo
  -- esperam uma pela outra em vez de produzirem duas vigências abertas.
  select organization_id into v_org
    from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.manage_assignment') then
    raise exception 'Você não possui permissão para alocar veículos.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_current
    from public.vehicle_operation_assignments
   where vehicle_id = p_vehicle_id and effective_to is null;

  if v_current.id is not null then
    if v_current.operation_id = p_operation_id
       and v_current.state_id = p_state_id
       and v_current.city_id = p_city_id then
      return v_current.id;  -- já está onde se pediu
    end if;
    if p_effective_from <= v_current.effective_from then
      raise exception 'A nova alocação precisa começar depois do início da alocação atual (%).',
        to_char(v_current.effective_from, 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value';
    end if;
    update public.vehicle_operation_assignments
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  insert into public.vehicle_operation_assignments
    (organization_id, vehicle_id, operation_id, state_id, city_id, effective_from, reason)
  values
    (v_org, p_vehicle_id, p_operation_id, p_state_id, p_city_id, p_effective_from, p_reason)
  returning id into v_new;

  perform private.emit_event(v_org, 'vehicle.assignment_changed', 'vehicle', p_vehicle_id,
    jsonb_build_object('operation_id', p_operation_id, 'city_id', p_city_id,
                       'effective_from', p_effective_from, 'reason', p_reason));
  return v_new;
end;
$$;

revoke execute on function public.set_vehicle_assignment(uuid, uuid, smallint, integer, date, text) from public, anon;
grant  execute on function public.set_vehicle_assignment(uuid, uuid, smallint, integer, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.end_vehicle_assignment(uuid, date, text)
-- Tira o veículo da operação sem colocá-lo em outra. O histórico permanece.
-- -----------------------------------------------------------------------------
create or replace function public.end_vehicle_assignment(
  p_vehicle_id uuid,
  p_effective_to date default current_date,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.manage_assignment') then
    raise exception 'Você não possui permissão para alocar veículos.' using errcode = 'insufficient_privilege';
  end if;

  update public.vehicle_operation_assignments
     set effective_to = p_effective_to,
         reason = coalesce(p_reason, reason)
   where vehicle_id = p_vehicle_id and effective_to is null;

  if not found then
    raise exception 'Este veículo não possui alocação vigente.' using errcode = 'no_data_found';
  end if;

  perform private.emit_event(v_org, 'vehicle.assignment_ended', 'vehicle', p_vehicle_id,
    jsonb_build_object('effective_to', p_effective_to, 'reason', p_reason));
end;
$$;

revoke execute on function public.end_vehicle_assignment(uuid, date, text) from public, anon;
grant  execute on function public.end_vehicle_assignment(uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.correct_vehicle_odometer(...)
--
-- Uma correção não edita a leitura errada: registra a certa e marca a anterior
-- como superada, com motivo. O valor antigo continua lá, que é o que permite
-- responder "por que o KM caiu 4.000 em março".
-- -----------------------------------------------------------------------------
create or replace function public.correct_vehicle_odometer(
  p_vehicle_id   uuid,
  p_odometer_km  integer,
  p_reading_date date,
  p_reason       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_previous uuid;
  v_new      uuid;
  v_reason   text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 then
    raise exception 'Informe o motivo da correção de quilometragem.' using errcode = 'invalid_parameter_value';
  end if;

  select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.correct_odometer') then
    raise exception 'Você não possui permissão para corrigir a quilometragem.' using errcode = 'insufficient_privilege';
  end if;

  select id into v_previous
    from public.vehicle_odometer_readings
   where vehicle_id = p_vehicle_id and superseded_by is null
   order by reading_date desc, created_at desc
   limit 1;

  insert into public.vehicle_odometer_readings
    (organization_id, vehicle_id, reading_date, odometer_km, source, notes)
  values
    (v_org, p_vehicle_id, coalesce(p_reading_date, current_date), p_odometer_km, 'manual_correction', v_reason)
  returning id into v_new;

  if v_previous is not null then
    update public.vehicle_odometer_readings set superseded_by = v_new where id = v_previous;
  end if;

  perform private.emit_event(v_org, 'vehicle.odometer_corrected', 'vehicle', p_vehicle_id,
    jsonb_build_object('odometer_km', p_odometer_km, 'reason', v_reason, 'superseded', v_previous));
  return v_new;
end;
$$;

revoke execute on function public.correct_vehicle_odometer(uuid, integer, date, text) from public, anon;
grant  execute on function public.correct_vehicle_odometer(uuid, integer, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.set_vehicle_registration_status(uuid, text, text)
-- Situação cadastral. O histórico é escrito pelo gatilho que já existia.
-- -----------------------------------------------------------------------------
create or replace function public.set_vehicle_registration_status(
  p_vehicle_id uuid,
  p_status     text,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Situação cadastral inválida.' using errcode = 'invalid_parameter_value';
  end if;

  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.update') then
    raise exception 'Você não possui permissão para alterar a situação do veículo.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('hfm.vehicle_status_reason', coalesce(p_reason, ''), true);
  update public.vehicles set status = p_status where id = p_vehicle_id;
end;
$$;

revoke execute on function public.set_vehicle_registration_status(uuid, text, text) from public, anon;
grant  execute on function public.set_vehicle_registration_status(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.archive_vehicle / public.restore_vehicle
--
-- Arquivar tira o veículo das listas e mantém tudo: histórico de alocação,
-- leituras, situação. Excluir de verdade não é oferecido, e as FKs RESTRICT
-- garantem que também não é possível por baixo.
-- -----------------------------------------------------------------------------
create or replace function public.archive_vehicle(p_vehicle_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.archive') then
    raise exception 'Você não possui permissão para arquivar veículos.' using errcode = 'insufficient_privilege';
  end if;

  -- Um veículo arquivado não continua alocado a uma operação: seria um ativo
  -- fora do cadastro ocupando uma cidade nos indicadores de alguém.
  update public.vehicle_operation_assignments
     set effective_to = current_date,
         reason = coalesce(reason, 'Veículo arquivado.')
   where vehicle_id = p_vehicle_id and effective_to is null;

  perform set_config('hfm.vehicle_status_reason', coalesce(p_reason, 'Cadastro arquivado.'), true);
  update public.vehicles
     set status = 'inactive', deleted_at = now(), deleted_by = (select auth.uid())
   where id = p_vehicle_id and deleted_at is null;

  perform private.emit_event(v_org, 'vehicle.archived', 'vehicle', p_vehicle_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.archive_vehicle(uuid, text) from public, anon;
grant  execute on function public.archive_vehicle(uuid, text) to authenticated;

create or replace function public.restore_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.archive') then
    raise exception 'Você não possui permissão para restaurar veículos.' using errcode = 'insufficient_privilege';
  end if;

  -- Volta como inativo e sem alocação: reativar o cadastro é uma decisão,
  -- recolocá-lo numa operação é outra.
  update public.vehicles
     set deleted_at = null, deleted_by = null
   where id = p_vehicle_id;

  perform private.emit_event(v_org, 'vehicle.restored', 'vehicle', p_vehicle_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.restore_vehicle(uuid) from public, anon;
grant  execute on function public.restore_vehicle(uuid) to authenticated;
