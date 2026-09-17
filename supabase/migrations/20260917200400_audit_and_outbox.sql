-- =============================================================================
-- HFM · 005 · Audit trail and outbox
-- audit_logs (append-only, written by a generic trigger) and outbox_events
-- (minimal event-driven infrastructure, no worker yet).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,                       -- null for platform-level entities
  user_id         uuid,                       -- actor (auth.uid()), null for system
  entity_type     text not null,              -- schema-qualified table name
  entity_id       text,                       -- primary key of the row as text
  action          text not null,
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  request_id      text,
  created_at      timestamptz not null default now(),

  constraint audit_logs_action_check check (action in ('INSERT', 'UPDATE', 'DELETE')),
  constraint audit_logs_entity_type_check check (length(entity_type) between 3 and 120),
  constraint audit_logs_request_id_check check (request_id is null or length(request_id) <= 128)
);

comment on table public.audit_logs is
  'Append-only audit trail written by private.tg_audit(). Not editable by application users.';

-- No FK to organizations/users on purpose: audit rows must outlive the entities.

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function private.tg_block_mutation();

-- -----------------------------------------------------------------------------
-- private.tg_audit()
-- Generic row-level audit trigger. Optional trigger arguments name columns to
-- redact from old_data/new_data (sensitive fields). Skips UPDATEs whose only
-- changes are bookkeeping columns. SECURITY DEFINER: the insert into audit_logs
-- must not depend on the caller's RLS privileges.
-- -----------------------------------------------------------------------------
create or replace function private.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_redact   text[] := tg_argv;
  v_org      uuid;
  v_entity   text;
  v_headers  jsonb;
  v_request  text;
  c_ignored  constant text[] := array['updated_at', 'updated_by'];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into v_changed
      from (
        select key from jsonb_each(v_new)
        where key <> all (c_ignored)
        union
        select key from jsonb_each(v_old)
        where key <> all (c_ignored)
      ) k
      where (v_old -> key) is distinct from (v_new -> key);
    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return null; -- nothing meaningful changed
    end if;
  end if;

  if v_redact is not null and array_length(v_redact, 1) > 0 then
    v_old := v_old - v_redact;
    v_new := v_new - v_redact;
  end if;

  v_org    := coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid);
  v_entity := coalesce(v_new ->> 'id', v_old ->> 'id',
                       v_new ->> 'user_id', v_old ->> 'user_id');

  -- PostgREST exposes request headers; the x-request-id header (when present)
  -- correlates audit rows with API logs.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_request := left(coalesce(v_headers ->> 'x-request-id', v_headers ->> 'cf-ray'), 128);
  exception when others then
    v_request := null;
  end;

  insert into public.audit_logs
    (organization_id, user_id, entity_type, entity_id, action,
     old_data, new_data, changed_fields, request_id)
  values
    (v_org, auth.uid(), tg_table_schema || '.' || tg_table_name, v_entity, tg_op,
     v_old, v_new, v_changed, v_request);

  return null; -- AFTER trigger
end;
$$;

revoke execute on function private.tg_audit() from public;

comment on function private.tg_audit() is
  'AFTER INSERT/UPDATE/DELETE audit trigger. Arguments: column names to redact.';

-- -----------------------------------------------------------------------------
-- Attach audit to core and master data tables
-- -----------------------------------------------------------------------------
create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.tg_audit();

create trigger organization_settings_audit
  after insert or update or delete on public.organization_settings
  for each row execute function private.tg_audit();

create trigger organization_units_audit
  after insert or update or delete on public.organization_units
  for each row execute function private.tg_audit();

create trigger cost_centers_audit
  after insert or update or delete on public.cost_centers
  for each row execute function private.tg_audit();

create trigger organization_memberships_audit
  after insert or update or delete on public.organization_memberships
  for each row execute function private.tg_audit();

create trigger membership_roles_audit
  after insert or update or delete on public.membership_roles
  for each row execute function private.tg_audit();

create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function private.tg_audit();

create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function private.tg_audit();

create trigger platform_admins_audit
  after insert or update or delete on public.platform_admins
  for each row execute function private.tg_audit();

create trigger vehicle_makes_audit
  after insert or update or delete on public.vehicle_makes
  for each row execute function private.tg_audit();

create trigger vehicle_models_audit
  after insert or update or delete on public.vehicle_models
  for each row execute function private.tg_audit();

create trigger vehicles_audit
  after insert or update or delete on public.vehicles
  for each row execute function private.tg_audit();

create trigger drivers_audit
  after insert or update or delete on public.drivers
  for each row execute function private.tg_audit();

-- profiles hold personal data only; not audited (LGPD minimization).

-- -----------------------------------------------------------------------------
-- outbox_events (transactional outbox; consumers/workers come later)
-- -----------------------------------------------------------------------------
create table public.outbox_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,
  event_type      text not null,
  aggregate_type  text not null,
  aggregate_id    uuid,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending',
  attempts        smallint not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,

  constraint outbox_events_event_type_check
    check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint outbox_events_aggregate_type_check
    check (aggregate_type ~ '^[a-z][a-z0-9_]*$'),
  constraint outbox_events_status_check
    check (status in ('pending', 'processing', 'processed', 'failed')),
  constraint outbox_events_attempts_check check (attempts >= 0),
  constraint outbox_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint outbox_events_last_error_check check (last_error is null or length(last_error) <= 2000)
);

comment on table public.outbox_events is
  'Transactional outbox for domain events. Written inside business transactions; consumed by future workers (service_role).';

-- Enqueues a domain event inside the current transaction.
create or replace function private.emit_event(
  p_organization_id uuid,
  p_event_type      text,
  p_aggregate_type  text,
  p_aggregate_id    uuid,
  p_payload         jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.outbox_events
    (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values
    (p_organization_id, p_event_type, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

revoke execute on function private.emit_event(uuid, text, text, uuid, jsonb) from public;

comment on function private.emit_event(uuid, text, text, uuid, jsonb) is
  'Internal: enqueue a domain event in outbox_events. Called from triggers/RPCs, never from clients.';
