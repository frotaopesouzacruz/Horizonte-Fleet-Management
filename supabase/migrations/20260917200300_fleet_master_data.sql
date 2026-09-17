-- =============================================================================
-- HFM · 004 · Fleet master data
-- vehicle_types (global), vehicle_makes / vehicle_models (global catalog with
-- optional per-organization entries), vehicles, vehicle_status_history, drivers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vehicle_types (global classification, seeded)
-- -----------------------------------------------------------------------------
create table public.vehicle_types (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text not null,
  sort_order smallint not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vehicle_types_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint vehicle_types_name_check check (length(btrim(name)) between 1 and 80),
  constraint vehicle_types_code_key unique (code)
);

comment on table public.vehicle_types is
  'Global vehicle classification (car, van, truck...). Managed by the platform.';

create trigger vehicle_types_set_stamps
  before insert or update on public.vehicle_types
  for each row execute function private.tg_set_stamps();

-- -----------------------------------------------------------------------------
-- vehicle_makes
-- organization_id NULL => curated global catalog; set => tenant-specific entry
-- -----------------------------------------------------------------------------
create table public.vehicle_makes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_makes_name_check check (length(btrim(name)) between 1 and 80)
);

create unique index vehicle_makes_global_name_key
  on public.vehicle_makes (lower(name)) where organization_id is null;
create unique index vehicle_makes_org_name_key
  on public.vehicle_makes (organization_id, lower(name)) where organization_id is not null;

comment on table public.vehicle_makes is
  'Vehicle manufacturers. Global catalog (organization_id null) plus per-organization entries.';

create trigger vehicle_makes_set_stamps
  before insert or update on public.vehicle_makes
  for each row execute function private.tg_set_stamps();

create trigger vehicle_makes_prevent_tenant_change
  before update on public.vehicle_makes
  for each row execute function private.tg_prevent_tenant_change();

-- -----------------------------------------------------------------------------
-- vehicle_models
-- -----------------------------------------------------------------------------
create table public.vehicle_models (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  vehicle_make_id uuid not null references public.vehicle_makes (id) on delete restrict,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_models_name_check check (length(btrim(name)) between 1 and 120)
);

create unique index vehicle_models_global_name_key
  on public.vehicle_models (vehicle_make_id, lower(name)) where organization_id is null;
create unique index vehicle_models_org_name_key
  on public.vehicle_models (organization_id, vehicle_make_id, lower(name)) where organization_id is not null;
create index vehicle_models_make_idx on public.vehicle_models (vehicle_make_id);

comment on table public.vehicle_models is
  'Vehicle models of a make. Global catalog (organization_id null) plus per-organization entries.';

create trigger vehicle_models_set_stamps
  before insert or update on public.vehicle_models
  for each row execute function private.tg_set_stamps();

create trigger vehicle_models_prevent_tenant_change
  before update on public.vehicle_models
  for each row execute function private.tg_prevent_tenant_change();

-- A tenant model may sit on a global make or on a make of the same tenant.
-- A global model must sit on a global make.
create or replace function private.tg_vehicle_models_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_make_org uuid;
  v_found    boolean;
begin
  select true, m.organization_id into v_found, v_make_org
    from public.vehicle_makes m where m.id = new.vehicle_make_id;
  if v_found is not true then
    raise exception 'vehicle make % not found', new.vehicle_make_id using errcode = 'foreign_key_violation';
  end if;
  if v_make_org is not null and v_make_org is distinct from new.organization_id then
    raise exception 'vehicle make % belongs to another organization', new.vehicle_make_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_vehicle_models_guard() from public;

create trigger vehicle_models_guard
  before insert or update on public.vehicle_models
  for each row execute function private.tg_vehicle_models_guard();

-- -----------------------------------------------------------------------------
-- vehicles (single source of truth of the fleet)
-- -----------------------------------------------------------------------------
create table public.vehicles (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  organization_unit_id uuid,
  cost_center_id       uuid,

  fleet_code           text,
  license_plate        text,
  vin                  text,
  renavam              text,

  vehicle_type_id      uuid not null references public.vehicle_types (id) on delete restrict,
  vehicle_model_id     uuid references public.vehicle_models (id) on delete restrict,

  manufacture_year     smallint,
  model_year           smallint,

  ownership_type       text,
  status               text not null default 'active',

  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users (id) on delete set null,

  constraint vehicles_fleet_code_check
    check (fleet_code is null or fleet_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  constraint vehicles_license_plate_check
    check (license_plate is null or license_plate ~ '^[A-Z0-9]{5,10}$'),
  constraint vehicles_vin_check
    check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  constraint vehicles_renavam_check
    check (renavam is null or renavam ~ '^[0-9]{9,11}$'),
  constraint vehicles_manufacture_year_check
    check (manufacture_year is null or manufacture_year between 1900 and 2100),
  constraint vehicles_model_year_check
    check (model_year is null or model_year between 1900 and 2100),
  constraint vehicles_years_check
    check (manufacture_year is null or model_year is null
           or model_year between manufacture_year and manufacture_year + 1),
  constraint vehicles_ownership_type_check
    check (ownership_type is null or ownership_type in ('owned', 'leased', 'rented', 'third_party')),
  constraint vehicles_status_check
    check (status in ('active', 'inactive', 'maintenance', 'sold', 'decommissioned')),
  constraint vehicles_identification_check
    check (fleet_code is not null or license_plate is not null or vin is not null),

  constraint vehicles_org_id_key unique (organization_id, id),
  constraint vehicles_organization_unit_fkey
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict,
  constraint vehicles_cost_center_fkey
    foreign key (organization_id, cost_center_id)
    references public.cost_centers (organization_id, id) on delete restrict
);

-- Business identifiers are unique per organization among non-archived rows.
create unique index vehicles_org_license_plate_key
  on public.vehicles (organization_id, license_plate)
  where license_plate is not null and deleted_at is null;
create unique index vehicles_org_vin_key
  on public.vehicles (organization_id, vin)
  where vin is not null and deleted_at is null;
create unique index vehicles_org_renavam_key
  on public.vehicles (organization_id, renavam)
  where renavam is not null and deleted_at is null;
create unique index vehicles_org_fleet_code_key
  on public.vehicles (organization_id, fleet_code)
  where fleet_code is not null and deleted_at is null;

comment on table public.vehicles is
  'Fleet master data. Modules reference vehicles by id and never copy plate/model/unit.';

create trigger vehicles_set_stamps
  before insert or update on public.vehicles
  for each row execute function private.tg_set_stamps();

create trigger vehicles_prevent_tenant_change
  before update on public.vehicles
  for each row execute function private.tg_prevent_tenant_change();

-- Normalizes identifiers and validates that the model is global or of the tenant.
create or replace function private.tg_vehicles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_org uuid;
  v_found     boolean;
begin
  new.fleet_code    := private.normalize_code(new.fleet_code);
  new.license_plate := nullif(regexp_replace(upper(coalesce(new.license_plate, '')), '[^A-Z0-9]', '', 'g'), '');
  new.vin           := nullif(regexp_replace(upper(coalesce(new.vin, '')), '[^A-Z0-9]', '', 'g'), '');
  new.renavam       := nullif(regexp_replace(coalesce(new.renavam, ''), '[^0-9]', '', 'g'), '');

  if new.vehicle_model_id is not null then
    select true, m.organization_id into v_found, v_model_org
      from public.vehicle_models m where m.id = new.vehicle_model_id;
    if v_found is not true then
      raise exception 'vehicle model % not found', new.vehicle_model_id using errcode = 'foreign_key_violation';
    end if;
    if v_model_org is not null and v_model_org is distinct from new.organization_id then
      raise exception 'vehicle model % belongs to another organization', new.vehicle_model_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_vehicles_guard() from public;

create trigger vehicles_guard
  before insert or update on public.vehicles
  for each row execute function private.tg_vehicles_guard();

-- -----------------------------------------------------------------------------
-- vehicle_status_history (append-only)
-- -----------------------------------------------------------------------------
create table public.vehicle_status_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_id      uuid not null references public.vehicles (id) on delete cascade,
  previous_status text,
  new_status      text not null,
  reason          text,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_status_history_reason_check check (reason is null or length(reason) <= 1000),
  constraint vehicle_status_history_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade
);

comment on table public.vehicle_status_history is
  'Every operational status change of a vehicle. Written by trigger; append-only.';

-- Writes history on insert and whenever status changes. SECURITY DEFINER so the
-- insert is not subject to the caller's RLS (history has no INSERT policy).
-- An optional reason can be supplied through public.set_vehicle_status().
create or replace function private.tg_vehicle_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.vehicle_status_history
    (organization_id, vehicle_id, previous_status, new_status, reason, changed_by)
  values
    (new.organization_id, new.id,
     case when tg_op = 'UPDATE' then old.status end,
     new.status,
     nullif(current_setting('hfm.vehicle_status_reason', true), ''),
     auth.uid());
  return new;
end;
$$;

revoke execute on function private.tg_vehicle_status_history() from public;

create trigger vehicles_status_history
  after insert or update of status on public.vehicles
  for each row execute function private.tg_vehicle_status_history();

create trigger vehicle_status_history_append_only
  before update or delete on public.vehicle_status_history
  for each row execute function private.tg_block_mutation();

-- -----------------------------------------------------------------------------
-- drivers (operational entity; not an auth user, optional link)
-- -----------------------------------------------------------------------------
create table public.drivers (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  organization_unit_id uuid,
  user_id              uuid references auth.users (id) on delete set null,
  employee_code        text,
  full_name            text not null,
  status               text not null default 'active',
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users (id) on delete set null,

  constraint drivers_full_name_check
    check (length(btrim(full_name)) between 2 and 200),
  constraint drivers_employee_code_check
    check (employee_code is null or employee_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  constraint drivers_status_check
    check (status in ('active', 'inactive', 'suspended')),
  constraint drivers_org_id_key unique (organization_id, id),
  constraint drivers_organization_unit_fkey
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict
);

create unique index drivers_org_employee_code_key
  on public.drivers (organization_id, employee_code)
  where employee_code is not null and deleted_at is null;
create unique index drivers_org_user_key
  on public.drivers (organization_id, user_id)
  where user_id is not null and deleted_at is null;

comment on table public.drivers is
  'Driver master data (minimal personal data). Documents/CNH live in future dedicated entities.';

create trigger drivers_set_stamps
  before insert or update on public.drivers
  for each row execute function private.tg_set_stamps();

create trigger drivers_prevent_tenant_change
  before update on public.drivers
  for each row execute function private.tg_prevent_tenant_change();

create or replace function private.tg_drivers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.employee_code := private.normalize_code(new.employee_code);
  new.full_name     := btrim(new.full_name);
  return new;
end;
$$;

create trigger drivers_guard
  before insert or update on public.drivers
  for each row execute function private.tg_drivers_guard();
