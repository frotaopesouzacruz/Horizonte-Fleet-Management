-- =============================================================================
-- ADMINISTRATION — EMPLOYEE DIRECTORY
--
-- An employee is a person in the corporate base. It is NOT a system account:
-- most of them have no e-mail at all. The optional path to access is
--   employees → organization_memberships.employee_id → auth.users
-- and it is only ever walked by an explicit, authorized provisioning action.
--
-- Restricted personal data (CPF, birth date) lives in a separate table with its
-- own permission, and driver licence data has its own table too, so ordinary
-- operational queries never carry either.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- employees
-- -----------------------------------------------------------------------------
create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  employee_code     text not null,
  full_name         text not null,
  corporate_email   text,
  employment_status text not null default 'active',
  admission_date    date,
  termination_date  date,
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,

  constraint employees_code_check check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$'),
  constraint employees_full_name_check check (length(btrim(full_name)) between 2 and 200),
  -- stored lowercase; the shape check is deliberately permissive, the product
  -- validates before it ever gets here
  constraint employees_email_check
    check (corporate_email is null or (corporate_email = lower(corporate_email) and corporate_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(corporate_email) <= 254)),
  constraint employees_status_check
    check (employment_status in ('active', 'on_leave', 'terminated', 'inactive')),
  constraint employees_termination_check
    check (termination_date is null or admission_date is null or termination_date >= admission_date),
  constraint employees_org_id_key unique (organization_id, id)
);
comment on table public.employees is
  'Corporate people base. An employee exists independently of any system account; access is granted separately through organization_memberships.';
comment on column public.employees.employee_code is 'Registration number (matrícula). Unique per organization among live rows.';

-- Registration number is the business key of an import; e-mail, when present,
-- is the key of an account, so both are unique per tenant.
create unique index employees_org_code_key on public.employees
  (organization_id, upper(employee_code)) where deleted_at is null;
create unique index employees_org_email_key on public.employees
  (organization_id, corporate_email) where deleted_at is null and corporate_email is not null;

create index employees_org_status_idx on public.employees
  (organization_id, employment_status) where deleted_at is null;
create index employees_org_name_idx on public.employees
  (organization_id, private.normalize_label(full_name)) where deleted_at is null;
-- Search: substring match on name/code/e-mail stays index-backed at scale.
create index employees_name_trgm_idx on public.employees
  using gin (private.normalize_label(full_name) extensions.gin_trgm_ops) where deleted_at is null;
create index employees_code_trgm_idx on public.employees
  using gin (employee_code extensions.gin_trgm_ops) where deleted_at is null;
create index employees_email_trgm_idx on public.employees
  using gin (corporate_email extensions.gin_trgm_ops) where deleted_at is null and corporate_email is not null;

-- -----------------------------------------------------------------------------
-- employee_private_data — restricted personal data (LGPD)
-- Separate table, separate permission, redacted from the audit trail.
-- -----------------------------------------------------------------------------
create table public.employee_private_data (
  employee_id     uuid primary key references public.employees (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  cpf             text,
  birth_date      date,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint employee_private_data_cpf_check check (cpf is null or cpf ~ '^[0-9]{11}$'),
  constraint employee_private_data_birth_check
    check (birth_date is null or (birth_date > date '1900-01-01' and birth_date < current_date)),
  constraint employee_private_data_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete cascade
);
comment on table public.employee_private_data is
  'Restricted personal data (CPF, birth date). Requires users.view_sensitive; the default interface only ever shows a masked CPF.';

-- The same CPF cannot belong to two registration numbers in one organization.
create unique index employee_private_data_org_cpf_key on public.employee_private_data
  (organization_id, cpf) where cpf is not null;

-- -----------------------------------------------------------------------------
-- driver_licenses — CNH. Optional, and never required of administrative staff.
-- -----------------------------------------------------------------------------
create table public.driver_licenses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  employee_id        uuid not null,
  category           text,
  license_number     text,
  expiration_date    date,
  first_license_date date,
  points             smallint,
  status             text not null default 'active',
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null,
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users (id) on delete set null,

  constraint driver_licenses_category_check check (category is null or category ~ '^[A-E]{1,3}$'),
  constraint driver_licenses_number_check check (license_number is null or license_number ~ '^[0-9]{9,11}$'),
  constraint driver_licenses_points_check check (points is null or points between 0 and 40),
  constraint driver_licenses_status_check check (status in ('active', 'inactive')),
  constraint driver_licenses_dates_check
    check (expiration_date is null or first_license_date is null or expiration_date >= first_license_date),
  constraint driver_licenses_org_id_key unique (organization_id, id),
  constraint driver_licenses_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete cascade
);
comment on table public.driver_licenses is
  'Driver licence (CNH) of an employee. One live record per employee; full management arrives with its own module.';

create unique index driver_licenses_employee_key on public.driver_licenses
  (employee_id) where deleted_at is null;
create index driver_licenses_org_expiration_idx on public.driver_licenses
  (organization_id, expiration_date) where deleted_at is null and expiration_date is not null;

-- -----------------------------------------------------------------------------
-- employee_assignments — where the person sits in the organization, over time.
-- Position, area, operation, unit, location and manager are assignment facts,
-- not permanent attributes of a person, so movements keep their history.
-- -----------------------------------------------------------------------------
create table public.employee_assignments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  employee_id          uuid not null,
  job_position_id      uuid,
  employment_area_id   uuid,
  operation_id         uuid,
  organization_unit_id uuid,
  work_location_id     uuid,
  business_profile_id  uuid,
  manager_employee_id  uuid,
  effective_from       date not null default current_date,
  effective_to         date,
  is_current           boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,

  constraint employee_assignments_period_check
    check (effective_to is null or effective_to >= effective_from),
  -- a closed assignment is never the current one, and vice versa
  constraint employee_assignments_current_check
    check ((is_current and effective_to is null) or (not is_current)),
  constraint employee_assignments_self_manager_check
    check (manager_employee_id is null or manager_employee_id <> employee_id),
  constraint employee_assignments_org_id_key unique (organization_id, id),

  constraint employee_assignments_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete cascade,
  constraint employee_assignments_manager_fk
    foreign key (organization_id, manager_employee_id)
    references public.employees (organization_id, id) on delete set null,
  constraint employee_assignments_position_fk
    foreign key (organization_id, job_position_id)
    references public.job_positions (organization_id, id) on delete restrict,
  constraint employee_assignments_area_fk
    foreign key (organization_id, employment_area_id)
    references public.employment_areas (organization_id, id) on delete restrict,
  constraint employee_assignments_operation_fk
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,
  constraint employee_assignments_unit_fk
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict,
  constraint employee_assignments_location_fk
    foreign key (organization_id, work_location_id)
    references public.work_locations (organization_id, id) on delete restrict,
  constraint employee_assignments_profile_fk
    foreign key (organization_id, business_profile_id)
    references public.business_profiles (organization_id, id) on delete restrict
);
comment on table public.employee_assignments is
  'Organizational assignment of an employee over time. Exactly one row per employee is is_current; the others are history.';
comment on column public.employee_assignments.operation_id is
  'Where the person works. NOT the set of operations their HFM account may read — that is membership_operation_scopes.';

create unique index employee_assignments_current_key on public.employee_assignments
  (employee_id) where is_current;
create index employee_assignments_org_operation_idx on public.employee_assignments
  (organization_id, operation_id) where is_current;
create index employee_assignments_org_unit_idx on public.employee_assignments
  (organization_id, organization_unit_id) where is_current;
create index employee_assignments_org_location_idx on public.employee_assignments
  (organization_id, work_location_id) where is_current;
create index employee_assignments_org_manager_idx on public.employee_assignments
  (organization_id, manager_employee_id) where is_current;
create index employee_assignments_org_position_idx on public.employee_assignments
  (organization_id, job_position_id) where is_current;
create index employee_assignments_employee_history_idx on public.employee_assignments
  (employee_id, effective_from desc);

-- -----------------------------------------------------------------------------
-- private.tg_employees_guard() — normalization + tenant sanity for employees
-- -----------------------------------------------------------------------------
create or replace function private.tg_employees_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.employee_code := nullif(btrim(new.employee_code), '');
  new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  new.corporate_email := nullif(lower(btrim(new.corporate_email)), '');
  new.notes := nullif(btrim(new.notes), '');

  if new.employment_status = 'terminated' and new.termination_date is null then
    new.termination_date := coalesce(new.termination_date, current_date);
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.tg_employee_child_guard() — keeps a child row inside the tenant and
-- normalizes the values the product stores unformatted.
-- -----------------------------------------------------------------------------
create or replace function private.tg_employee_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = new.employee_id;
  if v_org is null then
    raise exception 'employee % does not exist', new.employee_id using errcode = 'foreign_key_violation';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'employee % belongs to another organization', new.employee_id using errcode = 'check_violation';
  end if;

  if tg_table_name = 'employee_private_data' then
    new.cpf := nullif(regexp_replace(coalesce(new.cpf, ''), '[^0-9]', '', 'g'), '');
  elsif tg_table_name = 'driver_licenses' then
    new.category := nullif(upper(btrim(coalesce(new.category, ''))), '');
    new.license_number := nullif(regexp_replace(coalesce(new.license_number, ''), '[^0-9]', '', 'g'), '');
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.tg_assignment_guard() — one current assignment per employee.
-- Inserting a new current assignment closes the previous one instead of
-- failing on the unique index, which is what a movement actually means.
-- -----------------------------------------------------------------------------
create or replace function private.tg_assignment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org from public.employees e where e.id = new.employee_id;
  if v_org is null then
    raise exception 'employee % does not exist', new.employee_id using errcode = 'foreign_key_violation';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'employee % belongs to another organization', new.employee_id using errcode = 'check_violation';
  end if;

  if new.is_current then
    update public.employee_assignments
       set is_current = false,
           effective_to = greatest(effective_from, new.effective_from - 1)
     where employee_id = new.employee_id
       and is_current
       and id is distinct from new.id;
  end if;

  return new;
end;
$$;

create trigger employees_guard before insert or update on public.employees
  for each row execute function private.tg_employees_guard();
create trigger employees_set_stamps before insert or update on public.employees
  for each row execute function private.tg_set_stamps();
create trigger employees_prevent_tenant_change before update on public.employees
  for each row execute function private.tg_prevent_tenant_change();
create trigger employees_guard_soft_delete before insert or update on public.employees
  for each row execute function private.tg_guard_soft_delete('users.archive');
create trigger employees_audit after insert or update or delete on public.employees
  for each row execute function private.tg_audit();

create trigger employee_private_data_guard before insert or update on public.employee_private_data
  for each row execute function private.tg_employee_child_guard();
create trigger employee_private_data_set_stamps before insert or update on public.employee_private_data
  for each row execute function private.tg_set_stamps();
create trigger employee_private_data_prevent_tenant_change before update on public.employee_private_data
  for each row execute function private.tg_prevent_tenant_change();
-- CPF and birth date never reach the audit trail in clear text.
create trigger employee_private_data_audit after insert or update or delete on public.employee_private_data
  for each row execute function private.tg_audit('cpf', 'birth_date');

create trigger driver_licenses_guard before insert or update on public.driver_licenses
  for each row execute function private.tg_employee_child_guard();
create trigger driver_licenses_set_stamps before insert or update on public.driver_licenses
  for each row execute function private.tg_set_stamps();
create trigger driver_licenses_prevent_tenant_change before update on public.driver_licenses
  for each row execute function private.tg_prevent_tenant_change();
create trigger driver_licenses_guard_soft_delete before insert or update on public.driver_licenses
  for each row execute function private.tg_guard_soft_delete('users.update');
create trigger driver_licenses_audit after insert or update or delete on public.driver_licenses
  for each row execute function private.tg_audit('license_number');

create trigger employee_assignments_guard before insert or update on public.employee_assignments
  for each row execute function private.tg_assignment_guard();
create trigger employee_assignments_set_stamps before insert or update on public.employee_assignments
  for each row execute function private.tg_set_stamps();
create trigger employee_assignments_prevent_tenant_change before update on public.employee_assignments
  for each row execute function private.tg_prevent_tenant_change();
create trigger employee_assignments_audit after insert or update or delete on public.employee_assignments
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- drivers ↔ employees — compatibility, not a migration.
-- The fleet foundation already has a drivers table with its own person fields.
-- A driver is an operational specialization of an employee, so the link is
-- added as an optional column; nothing existing is rewritten or dropped.
-- -----------------------------------------------------------------------------
alter table public.drivers
  add column if not exists employee_id uuid,
  add constraint drivers_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete set null;

create unique index if not exists drivers_employee_key on public.drivers
  (organization_id, employee_id) where employee_id is not null and deleted_at is null;

comment on column public.drivers.employee_id is
  'Optional link to the corporate employee record. Nullable while legacy drivers exist without one; the Drivers module makes it the source of identity.';
