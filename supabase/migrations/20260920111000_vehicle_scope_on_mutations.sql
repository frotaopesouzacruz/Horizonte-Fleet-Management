-- =============================================================================
-- ETAPA 06 · O ESCOPO POR OPERAÇÃO TAMBÉM VALE PARA ESCRITA
--
-- Os testes de segurança encontraram uma brecha real: um Gestor de Frota com
-- escopo apenas em Merchandising não enxergava um veículo do Last Mille MG —
-- o RLS fazia o seu trabalho na leitura — mas conseguia inativá-lo. As rotinas
-- de mutação verificavam `has_permission(organização, 'vehicles.update')`, que
-- é uma permissão de organização, e nunca perguntavam se aquele veículo em
-- particular estava dentro do escopo do chamador.
--
-- Permissão e escopo respondem perguntas diferentes: "esta pessoa pode alterar
-- veículos?" e "esta pessoa pode alterar ESTE veículo?". O §65 exige as duas, e
-- exige que a segunda valha no servidor, não no filtro da tela.
--
-- `private.assert_vehicle_access` passa a ser o único caminho: carrega a
-- organização do veículo, trava a linha, confere a permissão e confere o
-- escopo. Quem chamava `select organization_id ... for update` seguido de um
-- `has_permission` agora chama uma função só, e não há como esquecer a metade.
--
-- Efeito colateral deliberado: um veículo SEM alocação só é alcançado por quem
-- tem `vehicles.view_unassigned`. A ausência de alocação nunca significa acesso
-- irrestrito (§65) — significa que só a administração o alcança.
-- =============================================================================

create or replace function private.assert_vehicle_access(
  p_vehicle_id uuid,
  p_permission text,
  p_lock       boolean default true
)
returns uuid
language plpgsql
-- Volátil de propósito: `select ... for update` trava linha, e o PostgreSQL
-- recusa isso dentro de uma função marcada como estável.
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_lock then
    -- Trava a linha: duas alterações simultâneas do mesmo veículo esperam uma
    -- pela outra em vez de decidirem sobre o mesmo estado ao mesmo tempo.
    select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  else
    select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  end if;

  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;

  if not private.has_permission(v_org, p_permission) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;

  -- A mesma função que decide a leitura decide a escrita. Se as duas pudessem
  -- discordar, uma delas estaria errada.
  if not private.vehicle_in_scope(v_org, p_vehicle_id) then
    raise exception 'Este veículo não pertence às operações do seu acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  return v_org;
end;
$$;

comment on function private.assert_vehicle_access(uuid, text, boolean) is
  'Organização do veículo, com permissão E escopo por operação conferidos. Único caminho das mutações de frota: separar as duas verificações foi como um veículo fora do escopo pôde ser inativado.';

revoke execute on function private.assert_vehicle_access(uuid, text, boolean) from public, anon;
grant  execute on function private.assert_vehicle_access(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- As rotinas passam a usá-la
-- -----------------------------------------------------------------------------
create or replace function public.set_vehicle_assignment(
  p_vehicle_id     uuid,
  p_operation_id   uuid,
  p_state_id       integer,
  p_city_id        integer,
  p_effective_from date default current_date,
  p_reason         text default null
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
  v_state   smallint := p_state_id::smallint;
begin
  v_org := private.assert_vehicle_access(p_vehicle_id, 'vehicles.manage_assignment');

  -- Alocar é também escolher a operação de destino: quem não tem acesso a ela
  -- não pode mandar um veículo para lá.
  if not (private.is_platform_admin()
          or v_org in (select private.permitted_org_ids('operations.access_all'))
          or p_operation_id in (select private.accessible_operation_ids())) then
    raise exception 'Você não possui acesso à operação de destino.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_current
    from public.vehicle_operation_assignments
   where vehicle_id = p_vehicle_id and effective_to is null;

  if v_current.id is not null then
    if v_current.operation_id = p_operation_id
       and v_current.state_id = v_state
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
    (v_org, p_vehicle_id, p_operation_id, v_state, p_city_id, p_effective_from, p_reason)
  returning id into v_new;

  perform private.emit_event(v_org, 'vehicle.assignment_changed', 'vehicle', p_vehicle_id,
    jsonb_build_object('operation_id', p_operation_id, 'city_id', p_city_id,
                       'effective_from', p_effective_from, 'reason', p_reason));
  return v_new;
end;
$$;

revoke execute on function public.set_vehicle_assignment(uuid, uuid, integer, integer, date, text) from public, anon;
grant  execute on function public.set_vehicle_assignment(uuid, uuid, integer, integer, date, text) to authenticated;

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
  v_org := private.assert_vehicle_access(p_vehicle_id, 'vehicles.manage_assignment');

  update public.vehicle_operation_assignments
     set effective_to = greatest(coalesce(p_effective_to, current_date), effective_from),
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

  v_org := private.assert_vehicle_access(p_vehicle_id, 'vehicles.correct_odometer');

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
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Situação cadastral inválida.' using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_vehicle_access(p_vehicle_id, 'vehicles.update');

  perform set_config('hfm.vehicle_status_reason', coalesce(p_reason, ''), true);
  update public.vehicles set status = p_status where id = p_vehicle_id;
end;
$$;

revoke execute on function public.set_vehicle_registration_status(uuid, text, text) from public, anon;
grant  execute on function public.set_vehicle_registration_status(uuid, text, text) to authenticated;

create or replace function public.archive_vehicle(p_vehicle_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.assert_vehicle_access(p_vehicle_id, 'vehicles.archive');

  update public.vehicle_operation_assignments
     set effective_to = greatest(current_date, effective_from),
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
  -- Um cadastro arquivado não tem alocação vigente, então o escopo por operação
  -- não o alcança: restaurar é, por construção, uma decisão administrativa.
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.archive') then
    raise exception 'Você não possui permissão para restaurar veículos.' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(v_org, 'vehicles.view_unassigned') then
    raise exception 'Restaurar um cadastro arquivado exige permissão de acesso a veículos sem alocação.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.vehicles
     set deleted_at = null, deleted_by = null
   where id = p_vehicle_id;

  perform private.emit_event(v_org, 'vehicle.restored', 'vehicle', p_vehicle_id, '{}'::jsonb);
end;
$$;

revoke execute on function public.restore_vehicle(uuid) from public, anon;
grant  execute on function public.restore_vehicle(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- `save_vehicle`: escopo na edição, alocação inicial com a sua própria permissão
--
-- Na criação não há escopo a verificar — o veículo acabou de nascer e ainda não
-- pertence a operação nenhuma. O que existe é a alocação inicial, e essa é uma
-- alocação como qualquer outra: exige `vehicles.manage_assignment`. A inserção
-- é direta, e não pela rotina de transferência, justamente porque a rotina
-- verificaria o escopo de um veículo que ainda não tem alocação e recusaria a
-- primeira.
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
  v_from      date    := coalesce(nullif(p_payload ->> 'assigned_from', '')::date, current_date);
  v_org       uuid;
begin
  if v_is_new then
    if not private.has_permission(p_organization_id, 'vehicles.create') then
      raise exception 'Você não possui permissão para cadastrar veículos.' using errcode = 'insufficient_privilege';
    end if;
  else
    v_org := private.assert_vehicle_access(v_id, 'vehicles.update');
    if v_org <> p_organization_id then
      raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
    end if;
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

  if v_is_new then
    if v_op is not null and v_city is not null and v_state is not null then
      if not private.has_permission(p_organization_id, 'vehicles.manage_assignment') then
        raise exception 'Você não possui permissão para alocar veículos. Cadastre o veículo sem alocação.'
          using errcode = 'insufficient_privilege';
      end if;
      if not (private.is_platform_admin()
              or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
              or v_op in (select private.accessible_operation_ids())) then
        raise exception 'Você não possui acesso à operação informada.' using errcode = 'insufficient_privilege';
      end if;

      insert into public.vehicle_operation_assignments
        (organization_id, vehicle_id, operation_id, state_id, city_id, effective_from, reason)
      values
        (p_organization_id, v_id, v_op, v_state, v_city,
         v_from,
         nullif(p_payload ->> 'assignment_reason', ''));

      perform private.emit_event(p_organization_id, 'vehicle.assignment_changed', 'vehicle', v_id,
        jsonb_build_object('operation_id', v_op, 'city_id', v_city, 'effective_from', v_from));
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
-- Matriz padrão: regularizar veículos sem alocação é trabalho do Gestor de Frota
--
-- Só o PADRÃO muda. Os perfis já existentes não são alterados aqui: elevar
-- acesso durante uma migration é exatamente o que a Etapa 05 proíbe. Um
-- Administrador que queira esse comportamento concede a permissão na tela de
-- Perfis e Permissões, e a alteração fica auditada com o motivo.
-- -----------------------------------------------------------------------------
insert into public.access_profile_defaults (profile_code, permission_code)
values ('gestor_frota', 'vehicles.view_unassigned')
on conflict do nothing;
