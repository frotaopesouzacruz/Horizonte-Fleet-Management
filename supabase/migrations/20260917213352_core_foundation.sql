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
-- private.is_privileged_context()
-- True when the caller is service_role, or a direct database session that did
-- not come through the API (migrations, SQL editor, maintenance jobs, the
-- internal sessions that run auth.users deletions and FK actions).
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
-- private.tg_set_stamps()
-- Maintains created_at/created_by/updated_at/updated_by in one place. Works on
-- any table: only the columns that exist on the target table are touched.
--
-- * created_at is immutable.
-- * created_by/updated_by are taken from auth.uid() whenever there is an
--   authenticated caller, so API clients cannot forge authorship. Privileged
--   contexts (service_role, migrations, seeds) may set them explicitly.
-- * created_by may only change on UPDATE from a privileged context, which is
--   what lets `auth.users` deletions run their ON DELETE SET NULL actions.
-- -----------------------------------------------------------------------------
create or replace function private.tg_set_stamps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new        jsonb := to_jsonb(new);
  v_old        jsonb;
  v_patch      jsonb := '{}'::jsonb;
  v_uid        uuid  := auth.uid();
  v_privileged boolean := private.is_privileged_context();
begin
  if tg_op = 'INSERT' then
    if v_new ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', now());
    end if;
    if v_new ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;
    -- authorship always belongs to the authenticated caller when there is one
    if v_uid is not null then
      if v_new ? 'created_by' then
        v_patch := v_patch || jsonb_build_object('created_by', v_uid);
      end if;
      if v_new ? 'updated_by' then
        v_patch := v_patch || jsonb_build_object('updated_by', v_uid);
      end if;
    end if;
  else -- UPDATE
    v_old := to_jsonb(old);

    if v_new ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', (v_old ->> 'created_at'));
    end if;

    if v_new ? 'created_by'
       and (v_new -> 'created_by') is distinct from (v_old -> 'created_by')
       and not v_privileged then
      -- application users never rewrite authorship; privileged contexts may
      -- (FK ON DELETE SET NULL when an auth user is removed)
      v_patch := v_patch || jsonb_build_object('created_by', (v_old ->> 'created_by'));
    end if;

    if v_new ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;

    if v_new ? 'updated_by' and v_uid is not null then
      v_patch := v_patch || jsonb_build_object('updated_by', v_uid);
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
-- the permission passed as trigger argument, on INSERT as well as on UPDATE.
-- Also stamps deleted_by and forces a server-side deleted_at.
-- Platform admins and privileged (service_role / maintenance) contexts pass.
-- -----------------------------------------------------------------------------
create or replace function private.tg_guard_soft_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_permission text := tg_argv[0];
  v_privileged boolean := private.is_privileged_context();
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      new.deleted_by := null;
      return new;
    end if;
    -- creating a row already archived still requires the archive permission
    if not v_privileged and not private.has_permission(new.organization_id, v_permission) then
      raise exception 'permission % is required to archive %.%',
        v_permission, tg_table_schema, tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    new.deleted_at := now();
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
    return new;
  end if;

  -- UPDATE
  if new.deleted_at is not distinct from old.deleted_at then
    -- keep deleted_by stable when deleted_at did not change; privileged
    -- contexts may still clear it (auth.users deletion, ON DELETE SET NULL)
    if not v_privileged then
      new.deleted_by := old.deleted_by;
    end if;
    return new;
  end if;

  if not v_privileged and not private.has_permission(new.organization_id, v_permission) then
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
  if current_setting('hfm.allow_purge', true) = 'on'
     and private.is_privileged_context() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception '%.% is append-only (% not allowed)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

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

-- -----------------------------------------------------------------------------
-- private.assert_parent_active(org, unit_id, cost_center_id, p_skip)
-- Composite FKs guarantee the parent belongs to the same tenant; this also
-- guarantees the parent is not archived. `p_skip` lets an UPDATE that does not
-- touch the references pass without extra lookups (e.g. a status change).
-- -----------------------------------------------------------------------------
create or replace function private.assert_parent_active(
  p_organization_id      uuid,
  p_organization_unit_id uuid,
  p_cost_center_id       uuid,
  p_skip                 boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_skip then
    return;
  end if;
  if p_organization_unit_id is not null
     and exists (select 1 from public.organization_units u
                  where u.id = p_organization_unit_id and u.deleted_at is not null) then
    raise exception 'organization unit % is archived', p_organization_unit_id
      using errcode = 'check_violation';
  end if;
  if p_cost_center_id is not null
     and exists (select 1 from public.cost_centers c
                  where c.id = p_cost_center_id and c.deleted_at is not null) then
    raise exception 'cost center % is archived', p_cost_center_id
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function private.assert_parent_active(uuid, uuid, uuid, boolean) from public;
