-- =============================================================================
-- ADMINISTRATION — IMPORT STAGING
--
-- A file never touches the final tables. It lands here first:
--   upload → staging → validation → normalization → dedup → preview →
--   approval → persistence → audit
--
-- Staging rows carry raw personal data, so they are readable only with
-- users.import, are excluded from the audit trail, and expire.
-- =============================================================================

create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  type            text not null default 'employees',
  mode            text not null default 'create_update',
  status          text not null default 'draft',
  file_name       text not null,
  file_hash       text,
  file_size       bigint,
  storage_path    text,
  column_mapping  jsonb not null default '{}'::jsonb,
  total_rows      integer not null default 0,
  valid_rows      integer not null default 0,
  warning_rows    integer not null default 0,
  error_rows      integer not null default 0,
  created_rows    integer not null default 0,
  updated_rows    integer not null default 0,
  skipped_rows    integer not null default 0,
  summary         jsonb not null default '{}'::jsonb,
  error_message   text,
  expires_at      timestamptz not null default now() + interval '30 days',
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint import_batches_type_check check (type in ('employees')),
  constraint import_batches_mode_check check (mode in ('validate', 'create', 'create_update')),
  constraint import_batches_status_check
    check (status in ('draft', 'validated', 'processing', 'completed', 'failed', 'cancelled')),
  constraint import_batches_file_name_check check (length(btrim(file_name)) between 1 and 300),
  constraint import_batches_file_hash_check check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  constraint import_batches_org_id_key unique (organization_id, id)
);
comment on table public.import_batches is
  'One import run. file_hash makes a repeated upload recognisable; expires_at is the retention limit for the staged personal data.';

create index import_batches_org_created_idx on public.import_batches (organization_id, created_at desc);
create index import_batches_org_hash_idx on public.import_batches (organization_id, file_hash)
  where file_hash is not null;

-- -----------------------------------------------------------------------------
-- import_rows — JSONB is right here and only here: this is a transient payload
-- whose shape is the file's, not the product's.
-- -----------------------------------------------------------------------------
create table public.import_rows (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  batch_id        uuid not null,
  row_number      integer not null,
  raw_data        jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  status          text not null default 'pending',
  action          text not null default 'skip',
  employee_id     uuid,
  created_at      timestamptz not null default now(),

  constraint import_rows_status_check
    check (status in ('pending', 'valid', 'warning', 'error', 'created', 'updated', 'skipped', 'failed')),
  constraint import_rows_action_check check (action in ('create', 'update', 'skip')),
  constraint import_rows_key unique (batch_id, row_number),
  constraint import_rows_batch_fk
    foreign key (organization_id, batch_id)
    references public.import_batches (organization_id, id) on delete cascade,
  constraint import_rows_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete set null
);
comment on table public.import_rows is
  'Staged row of an import file. Holds personal data in transit: readable only with users.import and dropped with the batch.';

create index import_rows_batch_status_idx on public.import_rows (batch_id, status);
create index import_rows_batch_action_idx on public.import_rows (batch_id, action);

-- -----------------------------------------------------------------------------
-- import_errors — the inconsistency report, one row per finding
-- -----------------------------------------------------------------------------
create table public.import_errors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  batch_id        uuid not null,
  row_number      integer,
  level           text not null default 'error',
  field           text,
  code            text not null,
  message         text not null,
  created_at      timestamptz not null default now(),

  constraint import_errors_level_check check (level in ('error', 'warning')),
  constraint import_errors_batch_fk
    foreign key (organization_id, batch_id)
    references public.import_batches (organization_id, id) on delete cascade
);
comment on table public.import_errors is 'Findings of an import run, split into blocking errors and warnings.';

create index import_errors_batch_idx on public.import_errors (batch_id, level, row_number);

create trigger import_batches_set_stamps before insert or update on public.import_batches
  for each row execute function private.tg_set_stamps();
create trigger import_batches_prevent_tenant_change before update on public.import_batches
  for each row execute function private.tg_prevent_tenant_change();
-- The batch itself is auditable (who imported what, when); its rows are not,
-- because they carry raw personal data.
create trigger import_batches_audit after insert or update or delete on public.import_batches
  for each row execute function private.tg_audit('column_mapping');
