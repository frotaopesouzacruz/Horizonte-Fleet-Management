-- =============================================================================
-- HFM · 002 · Identity and tenancy
-- organizations, organization_settings, organization_units, cost_centers,
-- profiles (auth.users mirror), organization_memberships, platform_admins.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations (tenant root)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  legal_name      text,
  document_number text,                       -- CNPJ (kept as text: alphanumeric CNPJ from 2026)
  slug            text not null,
  status          text not null default 'active',
  timezone        text not null default 'America/Sao_Paulo',
  locale          text not null default 'pt-BR',
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users (id) on delete set null,

  constraint organizations_name_check
    check (length(btrim(name)) between 2 and 200),
  constraint organizations_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 63),
  constraint organizations_status_check
    check (status in ('active', 'suspended', 'archived')),
  constraint organizations_document_number_check
    check (document_number is null or length(document_number) between 8 and 20),
  constraint organizations_timezone_check
    check (length(timezone) between 3 and 64),
  constraint organizations_locale_check
    check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- one lifecycle fact, one encoding: archived <=> deleted_at is set
  constraint organizations_lifecycle_check
    check ((status = 'archived') = (deleted_at is not null))
);

create unique index organizations_slug_key on public.organizations (slug);
create index organizations_document_number_idx on public.organizations (document_number)
  where document_number is not null;

comment on table public.organizations is
  'Tenant root. Every customer company of the SaaS is one organization.';

create trigger organizations_set_stamps
  before insert or update on public.organizations
  for each row execute function private.tg_set_stamps();

-- Normalizes the tenant identity fields and protects the tenant lifecycle:
-- suspending or archiving an organization would lock every member out, so it
-- is reserved for the platform (service_role / platform admins), never for a
-- tenant administrator holding organization.manage.
create or replace function private.tg_organizations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name            := btrim(new.name);
  new.legal_name      := nullif(btrim(coalesce(new.legal_name, '')), '');
  new.document_number := nullif(regexp_replace(upper(coalesce(new.document_number, '')), '[^A-Z0-9]', '', 'g'), '');
  new.slug            := lower(btrim(new.slug));

  if tg_op = 'UPDATE'
     and (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at)
     and not private.is_privileged_context()
     and not private.is_platform_admin() then
    raise exception 'organization lifecycle (status/deleted_at) is managed by the platform'
      using errcode = 'insufficient_privilege';
  end if;

  if new.deleted_at is not null then
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  else
    new.deleted_by := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_organizations_guard() from public;

create trigger organizations_guard
  before insert or update on public.organizations
  for each row execute function private.tg_organizations_guard();

-- -----------------------------------------------------------------------------
-- organization_settings (1:1)
-- Relational settings only. Modules add columns through migrations.
-- -----------------------------------------------------------------------------
create table public.organization_settings (
  organization_id          uuid primary key
                           references public.organizations (id) on delete cascade,
  distance_unit            text not null default 'km',
  fuel_volume_unit         text not null default 'l',
  currency_code            text not null default 'BRL',
  fiscal_year_start_month  smallint not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id) on delete set null,

  constraint organization_settings_distance_unit_check
    check (distance_unit in ('km', 'mi')),
  constraint organization_settings_fuel_volume_unit_check
    check (fuel_volume_unit in ('l', 'gal')),
  constraint organization_settings_currency_code_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint organization_settings_fiscal_year_start_month_check
    check (fiscal_year_start_month between 1 and 12)
);

comment on table public.organization_settings is
  'Organization-level configuration (1:1 with organizations). Created automatically.';

create trigger organization_settings_set_stamps
  before insert or update on public.organization_settings
  for each row execute function private.tg_set_stamps();

create trigger organization_settings_prevent_tenant_change
  before update on public.organization_settings
  for each row execute function private.tg_prevent_tenant_change();

-- Guarantees the 1:1 invariant: every organization gets a settings row.
create or replace function private.tg_create_organization_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_settings (organization_id, updated_by)
  values (new.id, new.created_by)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.tg_create_organization_settings() from public;

create trigger organizations_create_settings
  after insert on public.organizations
  for each row execute function private.tg_create_organization_settings();

-- -----------------------------------------------------------------------------
-- organization_units (branches / operations / bases)
-- -----------------------------------------------------------------------------
create table public.organization_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code            text,
  name            text not null,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users (id) on delete set null,

  constraint organization_units_name_check
    check (length(btrim(name)) between 1 and 200),
  constraint organization_units_code_check
    check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint organization_units_status_check
    check (status in ('active', 'inactive')),
  -- lets child tables reference (organization_id, id) and stay inside the tenant
  constraint organization_units_org_id_key unique (organization_id, id)
);

create unique index organization_units_org_code_key
  on public.organization_units (organization_id, code)
  where code is not null and deleted_at is null;
-- a unit without a code still needs to be distinguishable inside the tenant
create unique index organization_units_org_name_key
  on public.organization_units (organization_id, lower(name))
  where deleted_at is null;

comment on table public.organization_units is
  'Operational units of an organization (branch, base, operation). Master data.';

create trigger organization_units_set_stamps
  before insert or update on public.organization_units
  for each row execute function private.tg_set_stamps();

create trigger organization_units_prevent_tenant_change
  before update on public.organization_units
  for each row execute function private.tg_prevent_tenant_change();

create trigger organization_units_normalize
  before insert or update on public.organization_units
  for each row execute function private.tg_normalize_org_code();

-- -----------------------------------------------------------------------------
-- cost_centers
-- -----------------------------------------------------------------------------
create table public.cost_centers (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  organization_unit_id uuid,
  code                 text,
  name                 text not null,
  status               text not null default 'active',
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users (id) on delete set null,

  constraint cost_centers_name_check
    check (length(btrim(name)) between 1 and 200),
  constraint cost_centers_code_check
    check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint cost_centers_status_check
    check (status in ('active', 'inactive')),
  constraint cost_centers_org_id_key unique (organization_id, id),
  -- composite FK: the unit must belong to the same organization
  constraint cost_centers_organization_unit_fkey
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict
);

create unique index cost_centers_org_code_key
  on public.cost_centers (organization_id, code)
  where code is not null and deleted_at is null;
create unique index cost_centers_org_name_key
  on public.cost_centers (organization_id, lower(name))
  where deleted_at is null;

comment on table public.cost_centers is
  'Cost centers of an organization, optionally tied to an organization unit. Master data.';

create trigger cost_centers_set_stamps
  before insert or update on public.cost_centers
  for each row execute function private.tg_set_stamps();

create trigger cost_centers_prevent_tenant_change
  before update on public.cost_centers
  for each row execute function private.tg_prevent_tenant_change();

create trigger cost_centers_normalize
  before insert or update on public.cost_centers
  for each row execute function private.tg_normalize_org_code();

-- an active cost center never points at an archived unit
-- SECURITY DEFINER: the guard calls a private helper the caller cannot execute
create or replace function private.tg_cost_centers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unchanged boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_unchanged := new.organization_unit_id is not distinct from old.organization_unit_id;
  end if;
  if new.deleted_at is null then
    perform private.assert_parent_active(new.organization_id, new.organization_unit_id, null, v_unchanged);
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_cost_centers_guard() from public;

create trigger cost_centers_guard
  before insert or update on public.cost_centers
  for each row execute function private.tg_cost_centers_guard();

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users, never the tenant link)
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  display_name text,
  avatar_url   text,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_full_name_check
    check (full_name is null or length(full_name) between 1 and 200),
  constraint profiles_display_name_check
    check (display_name is null or length(display_name) between 1 and 80),
  constraint profiles_avatar_url_check
    check (avatar_url is null or (avatar_url ~ '^https?://' and length(avatar_url) <= 2048)),
  constraint profiles_status_check
    check (status in ('active', 'blocked'))
);

comment on table public.profiles is
  'Application profile of an authenticated user. Identity lives in auth.users; tenancy lives in organization_memberships.';

create trigger profiles_set_stamps
  before insert or update on public.profiles
  for each row execute function private.tg_set_stamps();

-- Auto-create the profile when Supabase Auth creates a user.
-- Never fails the signup: errors are logged as warnings.
-- No organization, membership or privilege is ever created here.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                                           new.raw_user_meta_data ->> 'name', '')), '');
begin
  insert into public.profiles (user_id, full_name, display_name)
  values (new.id, left(v_full_name, 200), left(v_full_name, 80))
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_auth_user failed for user %: % (%)', new.id, sqlerrm, sqlstate;
    return new;
end;
$$;

revoke execute on function private.handle_new_auth_user() from public;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_auth_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- organization_memberships (the tenant access link)
-- -----------------------------------------------------------------------------
create table public.organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'invited',
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint organization_memberships_status_check
    check (status in ('invited', 'active', 'suspended', 'removed')),
  constraint organization_memberships_org_user_key unique (organization_id, user_id),
  constraint organization_memberships_org_id_key unique (organization_id, id)
);

comment on table public.organization_memberships is
  'Participation of an auth user in an organization. Only status = active grants access.';

create trigger organization_memberships_set_stamps
  before insert or update on public.organization_memberships
  for each row execute function private.tg_set_stamps();

create trigger organization_memberships_prevent_tenant_change
  before update on public.organization_memberships
  for each row execute function private.tg_prevent_tenant_change();

-- Membership lifecycle:
--  * user_id is immutable, joined_at is set once when the membership activates;
--  * every member has a profile row (the profile is what RLS joins on), so a
--    membership created before the auth trigger ran still grants access;
--  * removing a member drops their role assignments, so re-adding the same user
--    later never silently restores old privileges.
create or replace function private.tg_membership_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable on organization_memberships'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.joined_at is not null then
    new.joined_at := old.joined_at;            -- immutable once set
  end if;
  if new.status = 'active' and new.joined_at is null then
    new.joined_at := now();
  end if;

  if tg_op = 'INSERT' then
    insert into public.profiles (user_id)
    values (new.user_id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_membership_lifecycle() from public;

create trigger organization_memberships_lifecycle
  before insert or update on public.organization_memberships
  for each row execute function private.tg_membership_lifecycle();

create or replace function private.tg_membership_revoke_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'removed' and old.status is distinct from 'removed' then
    delete from public.membership_roles mr where mr.membership_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.tg_membership_revoke_roles() from public;

create trigger organization_memberships_revoke_roles
  after update of status on public.organization_memberships
  for each row execute function private.tg_membership_revoke_roles();

-- -----------------------------------------------------------------------------
-- platform_admins (global SaaS operators; separate from tenant admins)
-- Rows are only ever written from a privileged context (service_role / SQL).
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  note       text,

  constraint platform_admins_note_check check (note is null or length(note) <= 500)
);

comment on table public.platform_admins is
  'Global platform operators. Never created automatically; bootstrap through service_role only.';
