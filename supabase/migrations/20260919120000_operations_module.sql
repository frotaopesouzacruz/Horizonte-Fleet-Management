-- =============================================================================
-- HFM · Operação como entidade central
--
-- The operation is the axis the whole product turns on: people, fleet, checklists,
-- maintenance and every indicator will hang off `operation_id` and, where it
-- matters, off the municipality inside it. This migration finishes the entity —
-- a description, an immutable code, granular permissions, and one transactional
-- entry point that saves the operation and its coverage together or not at all.
--
-- Geography stays what it already is: `operation_states.state_id` and
-- `operation_cities.city_id` hold the official IBGE codes, and the UF letters
-- come from the join. Storing 'MG' as text alongside them would be a second
-- source of truth for the same fact.
-- =============================================================================

alter table public.operations add column description text;
alter table public.operations
  add constraint operations_description_check
  check (description is null or length(btrim(description)) <= 500);

comment on column public.operations.description is
  'Free-text note about what the operation does. Never used as an identifier.';

-- ---------------------------------------------------------------------------
-- Granular permissions. `operations.manage` stays as the umbrella that already
-- guards the tables, so nothing that works today stops working; the new codes
-- let an organization hand out "may edit coverage" without also handing out
-- "may create and deactivate operations".
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('operations.create',            'operations', 'Create operations',
                                   'Register a new operation'),
  ('operations.update',            'operations', 'Edit operations',
                                   'Change name, description and status of an operation'),
  ('operations.deactivate',        'operations', 'Deactivate operations',
                                   'Take an operation out of use without losing its history'),
  ('operations.manage_geography',  'operations', 'Manage operation coverage',
                                   'Add and remove the states and municipalities an operation covers'),
  ('operations.view_audit',        'operations', 'View operation history',
                                   'Read the audit trail of an operation')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.code = 'org_admin'
   and p.code in ('operations.create', 'operations.update', 'operations.deactivate',
                  'operations.manage_geography', 'operations.view_audit')
on conflict do nothing;

-- Coverage may now also be changed by someone holding only the geography
-- permission. The existing `operations.manage` predicate is kept beside it.
do $$
declare t text;
begin
  foreach t in array array['operation_states', 'operation_cities'] loop
    execute format('drop policy %1$s_insert on public.%1$s', t);
    execute format('drop policy %1$s_update on public.%1$s', t);
    execute format('drop policy %1$s_delete on public.%1$s', t);

    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (
        organization_id in (select private.permitted_org_ids('operations.manage'))
        or organization_id in (select private.permitted_org_ids('operations.manage_geography'))
      )$f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated
      using (
        organization_id in (select private.permitted_org_ids('operations.manage'))
        or organization_id in (select private.permitted_org_ids('operations.manage_geography'))
      )
      with check (
        organization_id in (select private.permitted_org_ids('operations.manage'))
        or organization_id in (select private.permitted_org_ids('operations.manage_geography'))
      )$f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$s for delete to authenticated
      using (
        organization_id in (select private.permitted_org_ids('operations.manage'))
        or organization_id in (select private.permitted_org_ids('operations.manage_geography'))
      )$f$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- The operation code. Immutable once set, unique inside the organization, and
-- generated rather than typed so two administrators cannot invent the same one.
-- ---------------------------------------------------------------------------
create or replace function private.next_operation_code(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'OP-' || lpad(
    (coalesce(max((substring(code from '^OP-([0-9]+)$'))::integer), 0) + 1)::text, 5, '0')
    from public.operations
   where organization_id = p_organization_id
     and code ~ '^OP-[0-9]+$';
$$;

comment on function private.next_operation_code(uuid) is
  'Next OP-00000 code for an organization. Read inside save_operation, which holds the row lock.';

-- Existing operations have no code. Numbering follows creation order so the
-- codes read as a history rather than an alphabetical accident.
with numbered as (
  select id,
         organization_id,
         row_number() over (partition by organization_id order by created_at, name) as seq
    from public.operations
   where code is null
)
update public.operations o
   set code = 'OP-' || lpad(n.seq::text, 5, '0')
  from numbered n
 where o.id = n.id;

-- The code is an identifier, not a field: once issued it never changes.
create or replace function private.tg_operation_code_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.code is not null and new.code is distinct from old.code then
    raise exception 'O código da operação é imutável (% para %).', old.code, new.code
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger operations_code_immutable
  before update on public.operations
  for each row execute function private.tg_operation_code_immutable();

-- ---------------------------------------------------------------------------
-- Hard delete is not how an operation ends. Once anything references it, the
-- row is history and deleting it would take that history with it.
-- ---------------------------------------------------------------------------
create or replace function private.tg_operation_block_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refs integer;
begin
  select
      (select count(*) from public.employee_assignments where operation_id = old.id)
    + (select count(*) from public.membership_operation_scopes where operation_id = old.id)
  into v_refs;

  if v_refs > 0 then
    raise exception 'A operação % possui % vínculo(s) e não pode ser excluída. Inative-a.', old.name, v_refs
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

create trigger operations_block_delete
  before delete on public.operations
  for each row execute function private.tg_operation_block_delete();

create index if not exists operation_states_state_idx on public.operation_states (state_id);
create index if not exists operations_org_status_idx  on public.operations (organization_id, status)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- save_operation — the single entry point.
--
-- The operation and its coverage are saved together or not at all. The
-- alternative, which the application layer would otherwise drift into, is an
-- operation that saved and a coverage that did not.
--
-- Coverage is applied as a difference, not as a wipe-and-reinsert: rows that did
-- not change are not touched, so the audit trail records what actually happened
-- instead of a full rewrite every time someone fixes a typo in the name. A
-- payload without a `coverage` key leaves the coverage alone entirely.
-- ---------------------------------------------------------------------------
create or replace function public.save_operation(
  p_organization_id uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid    := nullif(p_payload->>'id', '')::uuid;
  v_is_new      boolean := v_id is null;
  v_name        text    := btrim(coalesce(p_payload->>'name', ''));
  v_description text    := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  v_status      text    := coalesce(nullif(p_payload->>'status', ''), 'active');
  v_coverage    jsonb   := coalesce(p_payload->'coverage', '[]'::jsonb);
  v_code        text;
  v_states_added   integer := 0;
  v_states_removed integer := 0;
  v_cities_added   integer := 0;
  v_cities_removed integer := 0;
  v_empty_state    text;
begin
  if not (
    private.has_permission(p_organization_id,
      case when v_is_new then 'operations.create' else 'operations.update' end)
    or private.has_permission(p_organization_id, 'operations.manage')
  ) then
    raise exception 'Você não possui permissão para salvar operações.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_name) < 1 or length(v_name) > 160 then
    raise exception 'Informe um nome de operação com até 160 caracteres.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('active', 'inactive') then
    raise exception 'Situação inválida para uma operação.' using errcode = 'check_violation';
  end if;

  if v_is_new then
    v_code := private.next_operation_code(p_organization_id);
    insert into public.operations (organization_id, code, name, description, status)
    values (p_organization_id, v_code, v_name, v_description, v_status)
    returning id into v_id;
  else
    update public.operations
       set name = v_name, description = v_description, status = v_status
     where id = v_id
       and organization_id = p_organization_id
       and deleted_at is null;
    if not found then
      raise exception 'Operação não encontrada nesta organização.' using errcode = 'no_data_found';
    end if;
  end if;

  -- -------------------------------------------------------------- coverage --
  if p_payload ? 'coverage' then
    if not (
      private.has_permission(p_organization_id, 'operations.manage_geography')
      or private.has_permission(p_organization_id, 'operations.manage')
    ) then
      raise exception 'Você não possui permissão para alterar a abrangência da operação.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Cities first: removing a state cascades to its cities, so doing states
    -- first would delete rows this diff never intended to count as removed.
    with wanted as (
      select (s->>'state_id')::smallint as state_id,
             (c #>> '{}')::integer      as city_id
        from jsonb_array_elements(v_coverage) s,
             jsonb_array_elements(coalesce(s->'cities', '[]'::jsonb)) c
    ),
    dropped as (
      delete from public.operation_cities oc
       where oc.operation_id = v_id
         and not exists (select 1 from wanted w where w.city_id = oc.city_id)
      returning 1
    )
    select count(*) into v_cities_removed from dropped;

    with wanted as (
      select distinct (s->>'state_id')::smallint as state_id
        from jsonb_array_elements(v_coverage) s
    ),
    dropped as (
      delete from public.operation_states os
       where os.operation_id = v_id
         and not exists (select 1 from wanted w where w.state_id = os.state_id)
      returning 1
    )
    select count(*) into v_states_removed from dropped;

    with wanted as (
      select distinct (s->>'state_id')::smallint as state_id
        from jsonb_array_elements(v_coverage) s
    ),
    added as (
      insert into public.operation_states (organization_id, operation_id, state_id)
      select p_organization_id, v_id, w.state_id from wanted w
      on conflict (operation_id, state_id) do nothing
      returning 1
    )
    select count(*) into v_states_added from added;

    with wanted as (
      select (s->>'state_id')::smallint as state_id,
             (c #>> '{}')::integer      as city_id
        from jsonb_array_elements(v_coverage) s,
             jsonb_array_elements(coalesce(s->'cities', '[]'::jsonb)) c
    ),
    added as (
      insert into public.operation_cities (organization_id, operation_id, state_id, city_id)
      select p_organization_id, v_id, w.state_id, w.city_id from wanted w
      on conflict (operation_id, city_id) do nothing
      returning 1
    )
    select count(*) into v_cities_added from added;
  end if;

  -- An active operation has to describe where it operates. An inactive one is
  -- history and is allowed to be incomplete.
  if v_status = 'active' then
    if not exists (select 1 from public.operation_states where operation_id = v_id) then
      raise exception 'Uma operação ativa precisa de ao menos um estado na abrangência.'
        using errcode = 'check_violation';
    end if;

    select s.name into v_empty_state
      from public.operation_states os
      join public.states s on s.id = os.state_id
     where os.operation_id = v_id
       and not exists (
         select 1 from public.operation_cities oc
          where oc.operation_id = v_id and oc.state_id = os.state_id
       )
     order by s.name
     limit 1;

    if v_empty_state is not null then
      raise exception 'O estado % não possui nenhum município selecionado.', v_empty_state
        using errcode = 'check_violation';
    end if;
  end if;

  perform private.emit_event(
    p_organization_id,
    case when v_is_new then 'operation.created' else 'operation.updated' end,
    'operation', v_id,
    jsonb_build_object('name', v_name, 'status', v_status)
  );

  if v_states_added   > 0 then perform private.emit_event(p_organization_id, 'operation.state_added',   'operation', v_id, jsonb_build_object('count', v_states_added));   end if;
  if v_states_removed > 0 then perform private.emit_event(p_organization_id, 'operation.state_removed', 'operation', v_id, jsonb_build_object('count', v_states_removed)); end if;
  if v_cities_added   > 0 then perform private.emit_event(p_organization_id, 'operation.city_added',    'operation', v_id, jsonb_build_object('count', v_cities_added));   end if;
  if v_cities_removed > 0 then perform private.emit_event(p_organization_id, 'operation.city_removed',  'operation', v_id, jsonb_build_object('count', v_cities_removed)); end if;

  return v_id;
end;
$$;

comment on function public.save_operation(uuid, jsonb) is
  'Creates or updates an operation together with its geographic coverage, applied as a difference, in one transaction.';

revoke all on function public.save_operation(uuid, jsonb) from public, anon;
grant execute on function public.save_operation(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Deactivation is how an operation ends. It keeps every assignment, scope and
-- indicator that ever pointed at it.
-- ---------------------------------------------------------------------------
create or replace function public.set_operation_status(
  p_operation_id uuid,
  p_status       text
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
    raise exception 'Situação inválida para uma operação.' using errcode = 'check_violation';
  end if;

  select organization_id into v_org
    from public.operations where id = p_operation_id and deleted_at is null;
  if v_org is null then
    raise exception 'Operação não encontrada.' using errcode = 'no_data_found';
  end if;

  if not (
    private.has_permission(v_org, 'operations.deactivate')
    or private.has_permission(v_org, 'operations.manage')
  ) then
    raise exception 'Você não possui permissão para alterar a situação da operação.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.operations set status = p_status where id = p_operation_id;

  perform private.emit_event(
    v_org,
    case when p_status = 'inactive' then 'operation.deactivated' else 'operation.reactivated' end,
    'operation', p_operation_id, jsonb_build_object('status', p_status)
  );
end;
$$;

revoke all on function public.set_operation_status(uuid, text) from public, anon;
grant execute on function public.set_operation_status(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One row per state an operation covers, for the cascading filters that every
-- future module will reuse: operation → state → city.
-- ---------------------------------------------------------------------------
create view public.operation_state_summary
with (security_invoker = true) as
select os.id,
       os.organization_id,
       os.operation_id,
       os.state_id,
       s.uf,
       s.name   as state_name,
       s.region,
       (select count(*) from public.operation_cities oc
         where oc.operation_id = os.operation_id and oc.state_id = os.state_id) as city_count
  from public.operation_states os
  join public.states s on s.id = os.state_id;

comment on view public.operation_state_summary is
  'States covered by each operation with their municipality count. Backs listStatesByOperation.';

revoke all on public.operation_state_summary from anon, authenticated;
grant select on public.operation_state_summary to authenticated;
