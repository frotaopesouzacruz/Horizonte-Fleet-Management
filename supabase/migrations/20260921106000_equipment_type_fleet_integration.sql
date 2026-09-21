-- =============================================================================
-- ETAPA 07 · O CADASTRO DE FROTAS PASSA A OBEDECER O CATÁLOGO
--
-- Três regras da Etapa 07 valem sobre veículos, e todas as três precisam valer
-- em qualquer caminho — formulário, importação ou SQL direto. Por isso estão em
-- gatilhos sobre `vehicles` e sobre as alocações, e não dentro de uma rotina
-- que alguém poderia não chamar:
--
--   §10/§56  um tipo inativo continua classificando quem já classificava, e não
--            entra em cadastro novo;
--   §13      subcategoria obrigatória quando a organização configurou isso;
--   §20      o tipo precisa ser admitido na operação, quando a restrição está
--            ligada.
--
-- A alocação existente nunca é desfeita por uma regra criada depois dela (§68):
-- a verificação de elegibilidade roda só no INSERT.
-- =============================================================================

create or replace function private.assert_type_usable(
  p_organization_id uuid,
  p_vehicle_type_id uuid,
  p_subcategory_id  uuid,
  p_is_new          boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active   boolean;
  v_owner    uuid;
  v_enabled  boolean;
  v_requires boolean;
  v_name     text;
begin
  select t.is_active, t.organization_id, t.name into v_active, v_owner, v_name
    from public.vehicle_types t where t.id = p_vehicle_type_id and t.deleted_at is null;

  if v_name is null then
    raise exception 'Tipo de equipamento não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_owner is not null and v_owner <> p_organization_id then
    raise exception 'Este tipo de equipamento pertence a outra organização.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(s.is_enabled, true), coalesce(s.requires_subcategory, false)
    into v_enabled, v_requires
    from public.vehicle_type_settings s
   where s.organization_id = p_organization_id and s.vehicle_type_id = p_vehicle_type_id;

  v_enabled  := coalesce(v_enabled, true);
  v_requires := coalesce(v_requires, false);

  if p_is_new and not (v_active and v_enabled) then
    raise exception 'O tipo % está inativo e não pode ser usado em novos cadastros.', v_name
      using errcode = 'invalid_parameter_value';
  end if;

  if v_requires and p_subcategory_id is null then
    raise exception 'O tipo % exige uma subcategoria.', v_name
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function private.assert_type_usable(uuid, uuid, uuid, boolean) from public, anon;
grant  execute on function private.assert_type_usable(uuid, uuid, uuid, boolean) to authenticated;

create or replace function private.tg_vehicle_type_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Na edição só interessa se a classificação mudou: um tipo inativado depois
  -- do cadastro continua valendo para quem já o usava.
  if tg_op = 'INSERT'
     or new.vehicle_type_id is distinct from old.vehicle_type_id
     or new.vehicle_subcategory_id is distinct from old.vehicle_subcategory_id then
    perform private.assert_type_usable(
      new.organization_id,
      new.vehicle_type_id,
      new.vehicle_subcategory_id,
      tg_op = 'INSERT' or new.vehicle_type_id is distinct from old.vehicle_type_id);
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_vehicle_type_rules() from public, anon;

drop trigger if exists vehicles_type_rules on public.vehicles;
create trigger vehicles_type_rules
  before insert or update on public.vehicles
  for each row execute function private.tg_vehicle_type_rules();

create or replace function private.tg_assignment_type_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type uuid;
  v_type_name text;
  v_op_name text;
begin
  select vehicle_type_id into v_type from public.vehicles where id = new.vehicle_id;

  if not public.vehicle_type_allows_operation(new.organization_id, v_type, new.operation_id) then
    select name into v_type_name from public.vehicle_types where id = v_type;
    select name into v_op_name from public.operations where id = new.operation_id;
    raise exception 'O tipo % não está habilitado para a operação %.',
      coalesce(v_type_name, 'informado'), coalesce(v_op_name, 'selecionada')
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_assignment_type_eligibility() from public, anon;

drop trigger if exists vehicle_assignments_type_eligibility on public.vehicle_operation_assignments;
create trigger vehicle_assignments_type_eligibility
  before insert on public.vehicle_operation_assignments
  for each row execute function private.tg_assignment_type_eligibility();

-- `set_vehicle_assignment` repete a verificação antes de encerrar a vigência
-- anterior: assim a transferência recusada não chega a mexer no que já estava
-- gravado, e a mensagem sai com o nome do tipo e da operação.
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
  v_type    uuid;
  v_type_name text;
  v_op_name text;
begin
  v_org := private.assert_vehicle_access(p_vehicle_id, 'vehicles.manage_assignment');

  if not (private.is_platform_admin()
          or v_org in (select private.permitted_org_ids('operations.access_all'))
          or p_operation_id in (select private.accessible_operation_ids())) then
    raise exception 'Você não possui acesso à operação de destino.' using errcode = 'insufficient_privilege';
  end if;

  select v.vehicle_type_id into v_type from public.vehicles v where v.id = p_vehicle_id;
  if not public.vehicle_type_allows_operation(v_org, v_type, p_operation_id) then
    select name into v_type_name from public.vehicle_types where id = v_type;
    select name into v_op_name from public.operations where id = p_operation_id;
    raise exception 'O tipo % não está habilitado para a operação %.',
      coalesce(v_type_name, 'informado'), coalesce(v_op_name, 'selecionada')
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_current
    from public.vehicle_operation_assignments
   where vehicle_id = p_vehicle_id and effective_to is null;

  if v_current.id is not null then
    if v_current.operation_id = p_operation_id
       and v_current.state_id = v_state
       and v_current.city_id = p_city_id then
      return v_current.id;
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
