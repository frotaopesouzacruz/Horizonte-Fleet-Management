-- =============================================================================
-- HFM · 010 · RPC surface (schema public)
-- create_organization       — atomic tenant bootstrap (platform admin / service_role)
-- set_vehicle_status        — status change with reason (RLS-enforced, invoker)
-- current_user_permissions  — permission codes of the caller in an organization
-- =============================================================================

-- -----------------------------------------------------------------------------
-- public.create_organization
-- Creates organization + settings (trigger) + active membership of the owner +
-- org_admin role, in one transaction. Never called automatically on signup.
-- Authorization: platform admin (authenticated) or privileged context
-- (service_role). When called from service_role, p_owner_user_id is required.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name            text,
  p_slug            text,
  p_owner_user_id   uuid default null,
  p_legal_name      text default null,
  p_document_number text default null,
  p_timezone        text default 'America/Sao_Paulo',
  p_locale          text default 'pt-BR'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner         uuid := coalesce(p_owner_user_id, auth.uid());
  v_actor         uuid := auth.uid();
  v_org_id        uuid;
  v_membership_id uuid;
  v_admin_role_id uuid;
begin
  if not (private.is_privileged_context() or private.is_platform_admin()) then
    raise exception 'only platform administrators can create organizations'
      using errcode = 'insufficient_privilege';
  end if;

  if v_owner is null then
    raise exception 'p_owner_user_id is required' using errcode = 'null_value_not_allowed';
  end if;

  if not exists (select 1 from auth.users u where u.id = v_owner) then
    raise exception 'owner user % does not exist', v_owner using errcode = 'foreign_key_violation';
  end if;

  select r.id into v_admin_role_id
  from public.roles r
  where r.organization_id is null and r.code = 'org_admin' and r.deleted_at is null;

  if v_admin_role_id is null then
    raise exception 'platform role org_admin is missing; run the seed migration';
  end if;

  insert into public.organizations
    (name, legal_name, document_number, slug, timezone, locale, created_by, updated_by)
  values
    (btrim(p_name), nullif(btrim(p_legal_name), ''), nullif(btrim(p_document_number), ''),
     lower(btrim(p_slug)), coalesce(p_timezone, 'America/Sao_Paulo'), coalesce(p_locale, 'pt-BR'),
     v_actor, v_actor)
  returning id into v_org_id;

  insert into public.organization_memberships
    (organization_id, user_id, status, joined_at, created_by, updated_by)
  values
    (v_org_id, v_owner, 'active', now(), v_actor, v_actor)
  returning id into v_membership_id;

  insert into public.membership_roles (membership_id, role_id, created_by)
  values (v_membership_id, v_admin_role_id, v_actor);

  return v_org_id;
end;
$$;

revoke execute on function public.create_organization(text, text, uuid, text, text, text, text) from public, anon;
grant  execute on function public.create_organization(text, text, uuid, text, text, text, text) to authenticated, service_role;

comment on function public.create_organization(text, text, uuid, text, text, text, text) is
  'Atomic tenant bootstrap: organization + settings + owner membership + org_admin. Platform admin or service_role only.';

-- -----------------------------------------------------------------------------
-- public.set_vehicle_status
-- SECURITY INVOKER: the UPDATE runs under the caller's RLS (vehicles.update).
-- The reason is handed to the history trigger through a transaction-local GUC.
-- -----------------------------------------------------------------------------
create or replace function public.set_vehicle_status(
  p_vehicle_id uuid,
  p_status     text,
  p_reason     text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform set_config('hfm.vehicle_status_reason', coalesce(left(p_reason, 1000), ''), true);

  update public.vehicles
     set status = p_status
   where id = p_vehicle_id
     and deleted_at is null;
  get diagnostics v_rows = row_count;

  perform set_config('hfm.vehicle_status_reason', '', true);

  if v_rows = 0 then
    raise exception 'vehicle % not found or not updatable', p_vehicle_id
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function public.set_vehicle_status(uuid, text, text) from public, anon;
grant  execute on function public.set_vehicle_status(uuid, text, text) to authenticated, service_role;

comment on function public.set_vehicle_status(uuid, text, text) is
  'Changes a vehicle status recording the reason in vehicle_status_history. Subject to RLS.';

-- -----------------------------------------------------------------------------
-- public.current_user_permissions
-- -----------------------------------------------------------------------------
create or replace function public.current_user_permissions(p_organization_id uuid)
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.user_permission_codes(p_organization_id);
$$;

revoke execute on function public.current_user_permissions(uuid) from public, anon;
grant  execute on function public.current_user_permissions(uuid) to authenticated, service_role;

comment on function public.current_user_permissions(uuid) is
  'Permission codes held by the caller in the given organization.';
