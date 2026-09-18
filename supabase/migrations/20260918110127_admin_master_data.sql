-- =============================================================================
-- ADMINISTRATION — MASTER DATA
-- Structured catalogues behind the employee directory. Every one of them is
-- tenant-scoped, soft-deletable and deduplicated by a normalized label so an
-- import cannot create "Contagem", "contagem " and "CONTAGEM" as three rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.normalize_label(text)
-- Comparison form of a human label: casefolded, accent-free, single-spaced.
-- IMMUTABLE so it can back a unique index. Deliberately does not use unaccent()
-- — that extension is not immutable and would be unusable here.
-- -----------------------------------------------------------------------------
create or replace function private.normalize_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    lower(
      translate(
        regexp_replace(btrim(p_value), '\s+', ' ', 'g'),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
      )
    ),
    ''
  );
$$;
comment on function private.normalize_label(text) is
  'Accent- and case-insensitive comparison form of a label. Immutable: backs unique indexes and import deduplication.';
grant execute on function private.normalize_label(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- employment_areas — organizational classification (Administrativo/Operacional)
-- -----------------------------------------------------------------------------
create table public.employment_areas (
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

  constraint employment_areas_name_check check (length(btrim(name)) between 1 and 120),
  constraint employment_areas_code_check check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint employment_areas_status_check check (status in ('active', 'inactive')),
  constraint employment_areas_org_id_key unique (organization_id, id)
);
comment on table public.employment_areas is 'Organizational area of an employee (administrative, operational...). Master data.';

-- -----------------------------------------------------------------------------
-- business_profiles — the QLP "Perfil" column.
-- An organizational classification, NEVER an access level: granting privileges
-- from this value is what access_profile_mappings exists to make explicit.
-- -----------------------------------------------------------------------------
create table public.business_profiles (
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

  constraint business_profiles_name_check check (length(btrim(name)) between 1 and 120),
  constraint business_profiles_code_check check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint business_profiles_status_check check (status in ('active', 'inactive')),
  constraint business_profiles_org_id_key unique (organization_id, id)
);
comment on table public.business_profiles is
  'Organizational profile imported from the source base (QLP "Perfil"). Descriptive only: it grants no privilege by itself.';

-- -----------------------------------------------------------------------------
-- job_positions — "462 - Auxiliar De Estoque" split into code + name
-- -----------------------------------------------------------------------------
create table public.job_positions (
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

  constraint job_positions_name_check check (length(btrim(name)) between 1 and 160),
  constraint job_positions_code_check check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint job_positions_status_check check (status in ('active', 'inactive')),
  constraint job_positions_org_id_key unique (organization_id, id)
);
comment on table public.job_positions is 'Job positions (cargos). Code is optional: the source base does not always carry one.';

-- -----------------------------------------------------------------------------
-- operations — minimal master data. The Operations module comes later; this is
-- only what the user directory and the access scopes need.
-- -----------------------------------------------------------------------------
create table public.operations (
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

  constraint operations_name_check check (length(btrim(name)) between 1 and 160),
  constraint operations_code_check check (code is null or code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  constraint operations_status_check check (status in ('active', 'inactive')),
  constraint operations_org_id_key unique (organization_id, id)
);
comment on table public.operations is
  'Business operations of an organization. Master data only in this stage; it is the axis of the access scope reused by every future module.';

-- -----------------------------------------------------------------------------
-- work_locations — city/site where the employee works, optionally under a unit
-- -----------------------------------------------------------------------------
create table public.work_locations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  organization_unit_id uuid,
  name                 text not null,
  status               text not null default 'active',
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users (id) on delete set null,

  constraint work_locations_name_check check (length(btrim(name)) between 1 and 160),
  constraint work_locations_status_check check (status in ('active', 'inactive')),
  constraint work_locations_org_id_key unique (organization_id, id),
  -- composite FK: a location can only point at a unit of its own tenant
  constraint work_locations_unit_fk
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict
);
comment on table public.work_locations is 'Operational locations (city/site). Optionally tied to an organization unit.';

-- -----------------------------------------------------------------------------
-- Deduplication and lookup indexes
-- Uniqueness is enforced on the normalized label and on the code, and only for
-- rows that are still alive, so archiving frees the name again.
-- -----------------------------------------------------------------------------
create unique index employment_areas_org_label_key on public.employment_areas
  (organization_id, private.normalize_label(name)) where deleted_at is null;
create unique index employment_areas_org_code_key on public.employment_areas
  (organization_id, code) where deleted_at is null and code is not null;

create unique index business_profiles_org_label_key on public.business_profiles
  (organization_id, private.normalize_label(name)) where deleted_at is null;
create unique index business_profiles_org_code_key on public.business_profiles
  (organization_id, code) where deleted_at is null and code is not null;

create unique index job_positions_org_label_key on public.job_positions
  (organization_id, private.normalize_label(name)) where deleted_at is null;
create unique index job_positions_org_code_key on public.job_positions
  (organization_id, code) where deleted_at is null and code is not null;

create unique index operations_org_label_key on public.operations
  (organization_id, private.normalize_label(name)) where deleted_at is null;
create unique index operations_org_code_key on public.operations
  (organization_id, code) where deleted_at is null and code is not null;

create unique index work_locations_org_label_key on public.work_locations
  (organization_id, private.normalize_label(name)) where deleted_at is null;
create index work_locations_unit_idx on public.work_locations
  (organization_id, organization_unit_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Triggers: stamps, tenant immutability, code normalization, soft-delete guard
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  perm text;
begin
  foreach t in array array['employment_areas', 'business_profiles', 'job_positions', 'operations', 'work_locations'] loop
    perm := 'users.manage_master_data';

    execute format(
      'create trigger %1$s_set_stamps before insert or update on public.%1$s
         for each row execute function private.tg_set_stamps()', t);

    execute format(
      'create trigger %1$s_prevent_tenant_change before update on public.%1$s
         for each row execute function private.tg_prevent_tenant_change()', t);

    execute format(
      'create trigger %1$s_normalize before insert or update on public.%1$s
         for each row execute function private.tg_normalize_org_code()', t);

    execute format(
      'create trigger %1$s_guard_soft_delete before insert or update on public.%1$s
         for each row execute function private.tg_guard_soft_delete(%2$L)', t, perm);

    execute format(
      'create trigger %1$s_audit after insert or update or delete on public.%1$s
         for each row execute function private.tg_audit()', t);
  end loop;
end
$$;
