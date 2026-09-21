-- =============================================================================
-- ETAPA 06 · `set_vehicle_assignment` recebe o estado como integer
--
-- A coluna `states.id` é smallint, e a rotina foi declarada com o mesmo tipo.
-- O problema está em quem chama: tanto um literal SQL (`31`) quanto um número
-- JSON vindo do PostgREST chegam como `integer`, e o Postgres não resolve
-- sobrecarga para baixo. A chamada falha com "function does not exist" antes
-- de qualquer verificação de permissão ou de cobertura — um erro de resolução
-- de tipo disfarçado de rotina inexistente.
--
-- A assinatura passa a receber `integer` e a conversão para smallint acontece
-- na fronteira do INSERT, que é onde ela pertence. Aceitar um inteiro maior
-- não afrouxa validação nenhuma: quem garante a coerência continua sendo a FK
-- composta (cidade↔estado, e organização↔operação↔cidade na cobertura).
--
-- `save_vehicle` continua declarando a variável como smallint e chamando a
-- rotina: smallint→integer é conversão implícita, então a resolução funciona
-- na direção que importa.
-- =============================================================================

drop function if exists public.set_vehicle_assignment(uuid, uuid, smallint, integer, date, text);

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
