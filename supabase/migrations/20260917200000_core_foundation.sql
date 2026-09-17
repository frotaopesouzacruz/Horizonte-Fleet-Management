-- =============================================================================
-- HFM · 001 · Core foundation
-- Schemas, extensions and reusable trigger functions shared by every module.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- `private` holds security helpers and trigger functions. It is NOT exposed by
-- PostgREST (see supabase/config.toml [api].schemas), but `authenticated` needs
-- USAGE so RLS policies can call the helpers.
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Functions created in `private` are never executable by PUBLIC/anon by default;
-- each function grants EXECUTE explicitly.
alter default privileges in schema private revoke execute on functions from public;

comment on schema private is
  'HFM internal helpers (security, triggers). Not exposed through the API.';

-- -----------------------------------------------------------------------------
-- private.tg_set_stamps()
-- Maintains created_at/created_by/updated_at/updated_by in one place. Works on
-- any table: only the columns that exist on the target table are touched.
-- created_* are immutable after insert.
-- -----------------------------------------------------------------------------
create or replace function private.tg_set_stamps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new   jsonb := to_jsonb(new);
  v_patch jsonb := '{}'::jsonb;
  v_uid   uuid  := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_new ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', now());
    end if;
    if v_new ? 'created_by' and (v_new ->> 'created_by') is null then
      v_patch := v_patch || jsonb_build_object('created_by', v_uid);
    end if;
    if v_new ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;
    if v_new ? 'updated_by' and (v_new ->> 'updated_by') is null then
      v_patch := v_patch || jsonb_build_object('updated_by', v_uid);
    end if;
  else -- UPDATE
    if v_new ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', (to_jsonb(old) ->> 'created_at'));
    end if;
    if v_new ? 'created_by' then
      v_patch := v_patch || jsonb_build_object('created_by', (to_jsonb(old) ->> 'created_by'));
    end if;
    if v_new ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;
    if v_new ? 'updated_by' then
      v_patch := v_patch || jsonb_build_object('updated_by', coalesce(v_uid, (v_new ->> 'updated_by')::uuid));
    end if;
  end if;

  if v_patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_patch);
  end if;
  return new;
end;
$$;

comment on function private.tg_set_stamps() is
  'BEFORE INSERT/UPDATE trigger: maintains created_at/created_by/updated_at/updated_by when present.';

-- -----------------------------------------------------------------------------
-- private.tg_prevent_tenant_change()
-- Rows never move between organizations. Blocks UPDATE of organization_id.
-- -----------------------------------------------------------------------------
create or replace function private.tg_prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable on %.%', tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.tg_guard_soft_delete(permission_code)
-- Archiving (deleted_at NULL -> value) or restoring (value -> NULL) requires
-- the permission passed as trigger argument. Also stamps deleted_by and keeps
-- deleted_at from being silently rewritten once set.
-- Platform admins and privileged (service_role / maintenance) contexts pass.
-- -----------------------------------------------------------------------------
create or replace function private.tg_guard_soft_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_permission text := tg_argv[0];
begin
  if new.deleted_at is not distinct from old.deleted_at then
    -- keep deleted_by stable when deleted_at did not change
    new.deleted_by := old.deleted_by;
    return new;
  end if;

  if not private.is_privileged_context()
     and not private.has_permission(new.organization_id, v_permission) then
    raise exception 'permission % is required to archive/restore %.%',
      v_permission, tg_table_schema, tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  if new.deleted_at is null then
    new.deleted_by := null;          -- restore
  else
    new.deleted_at := now();         -- archive: server-side timestamp
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.tg_block_mutation()
-- Makes a table append-only (audit logs, history tables).
-- Maintenance jobs may purge by setting `hfm.allow_purge = on` for the
-- transaction (only reachable from privileged connections).
-- -----------------------------------------------------------------------------
create or replace function private.tg_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('hfm.allow_purge', true) = 'on'
     and private.is_privileged_context() then
    return old;
  end if;
  raise exception '%.% is append-only (% not allowed)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- -----------------------------------------------------------------------------
-- private.is_privileged_context()
-- True when the caller is service_role, or a direct database session that did
-- not come through the API (migrations, SQL editor, maintenance jobs).
-- API requests always run through the `authenticator` login role.
-- -----------------------------------------------------------------------------
create or replace function private.is_privileged_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.role() is null and auth.uid() is null and session_user <> 'authenticator');
$$;

grant execute on function private.is_privileged_context() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.normalize_code(text)
-- Trims and upper-cases business codes (fleet codes, unit codes...).
-- -----------------------------------------------------------------------------
create or replace function private.normalize_code(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(btrim(p_value)), '');
$$;

grant execute on function private.normalize_code(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.tg_normalize_org_code()
-- Normalizes `code` (upper/trim) and `name` (trim) on master data tables.
-- -----------------------------------------------------------------------------
create or replace function private.tg_normalize_org_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := private.normalize_code(new.code);
  new.name := btrim(new.name);
  return new;
end;
$$;
