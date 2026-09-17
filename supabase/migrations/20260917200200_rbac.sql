-- =============================================================================
-- HFM · 003 · RBAC
-- permissions (global catalog), roles (global or per organization),
-- role_permissions (N:N), membership_roles (N:N).
-- Authorization is always resolved through permission codes, never role names.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- permissions (platform catalog, seeded by migration)
-- -----------------------------------------------------------------------------
create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  description text,
  module      text not null,
  created_at  timestamptz not null default now(),

  constraint permissions_code_check
    check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint permissions_module_check
    check (module ~ '^[a-z][a-z0-9_]*$'),
  constraint permissions_name_check
    check (length(btrim(name)) between 1 and 120),
  constraint permissions_code_key unique (code)
);

comment on table public.permissions is
  'Catalog of granular permission codes (module.action). Managed by the platform through migrations.';

-- -----------------------------------------------------------------------------
-- roles
-- organization_id NULL  => global role provided by the platform (is_system)
-- organization_id set   => custom role owned by that organization
-- -----------------------------------------------------------------------------
create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  code            text not null,
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  is_editable     boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users (id) on delete set null,

  constraint roles_code_check
    check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint roles_name_check
    check (length(btrim(name)) between 1 and 120),
  -- global roles are system roles; organization roles never are
  constraint roles_scope_check
    check ((organization_id is null and is_system) or (organization_id is not null and not is_system)),
  constraint roles_org_id_key unique (organization_id, id)
);

-- Global codes are unique among global roles; custom codes unique per organization.
create unique index roles_global_code_key
  on public.roles (code) where organization_id is null;
create unique index roles_org_code_key
  on public.roles (organization_id, code) where organization_id is not null;

comment on table public.roles is
  'Roles group permissions. Global (organization_id null, system) or custom per organization.';

create trigger roles_set_stamps
  before insert or update on public.roles
  for each row execute function private.tg_set_stamps();

create trigger roles_prevent_tenant_change
  before update on public.roles
  for each row execute function private.tg_prevent_tenant_change();

-- Custom roles may not shadow a global code; non-editable roles are frozen.
create or replace function private.tg_roles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is not null
     and exists (select 1 from public.roles r
                  where r.organization_id is null and r.code = new.code
                    and r.id is distinct from new.id) then
    raise exception 'role code % is reserved by a platform role', new.code
      using errcode = 'unique_violation';
  end if;

  if tg_op = 'UPDATE' and not old.is_editable and not private.is_privileged_context() then
    raise exception 'role % is not editable', old.code using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and (new.is_system is distinct from old.is_system
                           or new.code is distinct from old.code) then
    raise exception 'is_system and code are immutable on roles' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger roles_guard
  before insert or update on public.roles
  for each row execute function private.tg_roles_guard();

-- -----------------------------------------------------------------------------
-- role_permissions (N:N)
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,

  constraint role_permissions_pkey primary key (role_id, permission_id)
);

comment on table public.role_permissions is
  'Permissions granted by a role.';

create trigger role_permissions_set_stamps
  before insert on public.role_permissions
  for each row execute function private.tg_set_stamps();

-- Permissions of non-editable (system) roles only change through migrations.
create or replace function private.tg_role_permissions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_id uuid := coalesce(new.role_id, old.role_id);
begin
  if private.is_privileged_context() then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.roles r
              where r.id = v_role_id and (not r.is_editable or r.organization_id is null)) then
    raise exception 'permissions of role % cannot be changed', v_role_id
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_guard
  before insert or update or delete on public.role_permissions
  for each row execute function private.tg_role_permissions_guard();

-- -----------------------------------------------------------------------------
-- membership_roles (N:N between memberships and roles)
-- -----------------------------------------------------------------------------
create table public.membership_roles (
  membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  role_id       uuid not null references public.roles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,

  constraint membership_roles_pkey primary key (membership_id, role_id)
);

comment on table public.membership_roles is
  'Roles held by a membership (a user inside one organization).';

create trigger membership_roles_set_stamps
  before insert on public.membership_roles
  for each row execute function private.tg_set_stamps();

-- A role assigned to a membership must be global or belong to the same organization.
-- SECURITY DEFINER: validation must see the real rows regardless of the caller's RLS.
create or replace function private.tg_membership_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_org uuid;
  v_role_org       uuid;
  v_role_deleted   timestamptz;
  v_role_found     boolean;
begin
  select m.organization_id into v_membership_org
    from public.organization_memberships m where m.id = new.membership_id;
  if v_membership_org is null then
    raise exception 'membership % not found', new.membership_id using errcode = 'foreign_key_violation';
  end if;

  select true, r.organization_id, r.deleted_at into v_role_found, v_role_org, v_role_deleted
    from public.roles r where r.id = new.role_id;
  if v_role_found is not true then
    raise exception 'role % not found', new.role_id using errcode = 'foreign_key_violation';
  end if;

  if v_role_deleted is not null then
    raise exception 'role % is archived', new.role_id using errcode = 'check_violation';
  end if;
  if v_role_org is not null and v_role_org is distinct from v_membership_org then
    raise exception 'role % does not belong to the membership organization', new.role_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_membership_roles_guard() from public;

create trigger membership_roles_guard
  before insert or update on public.membership_roles
  for each row execute function private.tg_membership_roles_guard();
