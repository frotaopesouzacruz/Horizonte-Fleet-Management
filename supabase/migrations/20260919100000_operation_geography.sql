-- =============================================================================
-- HFM · the geographic footprint of an operation
--
-- An operation is where the company actually works, and until now it was only a
-- name. "Last Mille MG" has people in Contagem, Uberlândia and Governador
-- Valadares; "Redespacho - Belém" has people in Belém. Nothing in the schema
-- said so, so nothing could be planned, filtered or reported by place.
--
-- Two levels, because that is how the operation is actually described: the
-- states it covers, and inside each state the municipalities. The second level
-- is not merely derived from the first — an operation can cover a state before
-- anyone has decided which cities, and that half-built state is a real and
-- useful thing to record.
--
-- Every relationship here is enforced structurally rather than by trigger:
--   · a city belongs to the state it is filed under   (composite FK to cities)
--   · a state belongs to the operation it is filed under (composite FK)
--   · both belong to the organization that owns the operation (composite FK)
-- A wrong row is not rejected at write time by application code; it cannot be
-- represented at all.
-- =============================================================================

-- cities.id is already unique as the primary key, but a composite foreign key
-- needs a constraint that names both columns. This is the anchor that makes
-- "this city is in this state" impossible to get wrong downstream.
alter table public.cities
  add constraint cities_id_state_key unique (id, state_id);

-- ---------------------------------------------------------------------------
-- operation_states — the federative units an operation covers.
-- ---------------------------------------------------------------------------
create table public.operation_states (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  operation_id    uuid not null,
  state_id        smallint not null references public.states (id) on delete restrict,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  -- The operation has to belong to the same organization as this row. Carrying
  -- organization_id in the key is what makes that checkable by the database.
  constraint operation_states_operation_fk
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete cascade,

  constraint operation_states_unique unique (operation_id, state_id),
  -- The key operation_cities points at, so a city inherits both the tenant and
  -- the operation from its state rather than repeating the claim.
  constraint operation_states_scope_key unique (organization_id, operation_id, state_id)
);

comment on table public.operation_states is
  'Federative units covered by an operation. A state may be listed before any of its municipalities are chosen.';

-- ---------------------------------------------------------------------------
-- operation_cities — the municipalities an operation covers, inside a state it
-- already covers.
-- ---------------------------------------------------------------------------
create table public.operation_cities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  operation_id    uuid not null,
  state_id        smallint not null,
  city_id         integer not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  -- Tenant, operation and state all arrive through one key: a city cannot be
  -- attached to a state the operation does not cover, and dropping the state
  -- drops its cities with it.
  constraint operation_cities_state_fk
    foreign key (organization_id, operation_id, state_id)
    references public.operation_states (organization_id, operation_id, state_id) on delete cascade,

  -- And the municipality really is in that state. Without this pair the row
  -- could claim Uberlândia is in Pará and nothing would object.
  constraint operation_cities_city_fk
    foreign key (city_id, state_id)
    references public.cities (id, state_id) on delete restrict,

  constraint operation_cities_unique unique (operation_id, city_id)
);

comment on table public.operation_cities is
  'Municipalities covered by an operation. The composite keys guarantee the city is in the declared state and the state is covered by the declared operation.';

create index operation_states_operation_idx on public.operation_states (operation_id);
create index operation_states_org_idx       on public.operation_states (organization_id);
create index operation_cities_operation_idx on public.operation_cities (operation_id, state_id);
create index operation_cities_city_idx      on public.operation_cities (city_id);
create index operation_cities_org_idx       on public.operation_cities (organization_id);

-- ---------------------------------------------------------------------------
-- Triggers. Stamps and tenant immutability as everywhere else, plus the audit
-- trail — adding or removing a city from an operation is an administrative act
-- and is recorded as one. No soft delete: these are links, and a link that was
-- removed is simply gone, with the audit row as its history.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['operation_states', 'operation_cities'] loop
    execute format(
      'create trigger %1$s_set_stamps before insert or update on public.%1$s
         for each row execute function private.tg_set_stamps()', t);
    execute format(
      'create trigger %1$s_prevent_tenant_change before update on public.%1$s
         for each row execute function private.tg_prevent_tenant_change()', t);
    execute format(
      'create trigger %1$s_audit after insert or update or delete on public.%1$s
         for each row execute function private.tg_audit()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Access. Reading the geography of an operation is reading the operation, so
-- the predicate mirrors operations_select: the caller needs operations.view,
-- and the operation itself has to be one they are scoped to. Writing needs
-- operations.manage, exactly like renaming the operation would.
-- ---------------------------------------------------------------------------
alter table public.operation_states enable row level security;
alter table public.operation_cities enable row level security;

do $$
declare t text;
begin
  foreach t in array array['operation_states', 'operation_cities'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
      using (
        organization_id in (select private.permitted_org_ids('operations.view'))
        and (
          organization_id in (select private.permitted_org_ids('operations.access_all'))
          or operation_id in (select private.accessible_operation_ids())
          or organization_id in (select private.permitted_org_ids('users.manage_operation_scope'))
        )
      )$f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (organization_id in (select private.permitted_org_ids('operations.manage')))$f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated
      using (organization_id in (select private.permitted_org_ids('operations.manage')))
      with check (organization_id in (select private.permitted_org_ids('operations.manage')))$f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$s for delete to authenticated
      using (organization_id in (select private.permitted_org_ids('operations.manage')))$f$, t);

    execute format('revoke all on public.%1$s from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
    execute format('grant select, insert, update, delete on public.%1$s to service_role', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Backfill from what the operation already does.
--
-- Every current assignment names an operation and a work location, and a work
-- location now names a municipality. That is the footprint the company already
-- has, so the structure starts populated with it rather than empty — nothing
-- invented, only what the assignments already assert. Locations whose city is
-- still unresolved contribute nothing.
-- ---------------------------------------------------------------------------
with alocacao as (
  select distinct a.organization_id, a.operation_id, c.state_id, c.id as city_id
    from public.employee_assignments a
    join public.employees e       on e.id = a.employee_id and e.deleted_at is null
    join public.work_locations w  on w.id = a.work_location_id and w.deleted_at is null
    join public.cities c          on c.id = w.city_id
   where a.is_current
     and a.operation_id is not null
)
insert into public.operation_states (organization_id, operation_id, state_id)
select distinct organization_id, operation_id, state_id from alocacao
on conflict (operation_id, state_id) do nothing;

with alocacao as (
  select distinct a.organization_id, a.operation_id, c.state_id, c.id as city_id
    from public.employee_assignments a
    join public.employees e       on e.id = a.employee_id and e.deleted_at is null
    join public.work_locations w  on w.id = a.work_location_id and w.deleted_at is null
    join public.cities c          on c.id = w.city_id
   where a.is_current
     and a.operation_id is not null
)
insert into public.operation_cities (organization_id, operation_id, state_id, city_id)
select organization_id, operation_id, state_id, city_id from alocacao
on conflict (operation_id, city_id) do nothing;
