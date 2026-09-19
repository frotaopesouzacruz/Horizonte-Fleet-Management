-- =============================================================================
-- ETAPA 05 · ACCESS PROFILES — THE ROUTINES THAT MAY MOVE PRIVILEGE
--
-- Every function here opens the gate installed by the previous migration, does
-- one well-defined thing, and writes down who did it and why. Nothing else in
-- the system can move privilege, so this file is the whole attack surface.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.membership_profile_codes(uuid)
-- The profile codes a membership holds right now, for the before/after record.
-- -----------------------------------------------------------------------------
create or replace function private.membership_profile_codes(p_membership_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.code order by r.code), array[]::text[])
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
   where mr.membership_id = p_membership_id;
$$;

grant execute on function private.membership_profile_codes(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.set_membership_roles(uuid, uuid[], text)
--
-- Replaces the 2-argument version: a profile change without a reason is not
-- something this system accepts any more.
-- -----------------------------------------------------------------------------
drop function if exists public.set_membership_roles(uuid, uuid[]);

create or replace function public.set_membership_roles(
  p_membership_id uuid,
  p_role_ids      uuid[],
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_user     uuid;
  v_role     uuid;
  v_before   text[];
  v_after    text[];
  v_reason   text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 then
    raise exception 'Informe o motivo da alteração do perfil de acesso.'
      using errcode = 'invalid_parameter_value';
  end if;

  select m.organization_id, m.user_id into v_org, v_user
    from public.organization_memberships m where m.id = p_membership_id;
  if v_org is null then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;

  perform private.assert_can_assign_roles(v_org, v_user, p_role_ids);

  v_before := private.membership_profile_codes(p_membership_id);

  perform private.access_change_begin();

  delete from public.membership_roles mr
   where mr.membership_id = p_membership_id
     and mr.role_id <> all (coalesce(p_role_ids, array[]::uuid[]));

  foreach v_role in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.membership_roles (membership_id, role_id)
    values (p_membership_id, v_role)
    on conflict (membership_id, role_id) do nothing;
  end loop;

  v_after := private.membership_profile_codes(p_membership_id);

  insert into public.access_profile_changes
    (organization_id, membership_id, target_user_id, actor_user_id, previous_codes, new_codes, reason)
  values
    (v_org, p_membership_id, v_user, (select auth.uid()), v_before, v_after, v_reason);

  perform private.emit_event(v_org, 'user.role_changed', 'membership', p_membership_id,
    jsonb_build_object('previous', v_before, 'new', v_after));
end;
$$;

revoke execute on function public.set_membership_roles(uuid, uuid[], text) from public, anon;
grant  execute on function public.set_membership_roles(uuid, uuid[], text) to authenticated;

comment on function public.set_membership_roles(uuid, uuid[], text) is
  'The only way an account''s HFM access profile changes. Requires users.manage_roles, a reason, and never applies to the caller''s own account.';

-- -----------------------------------------------------------------------------
-- public.set_role_permissions(uuid, text[], text)
-- The permission matrix editor. Anti-escalation is inherited from
-- private.can_grant_permission: nobody grants what they do not hold.
-- -----------------------------------------------------------------------------
create or replace function public.set_role_permissions(
  p_role_id          uuid,
  p_permission_codes text[],
  p_reason           text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_code    text;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_perm_id uuid;
  v_before  text[];
  v_after   text[];
begin
  if length(v_reason) < 3 then
    raise exception 'Informe o motivo da alteração da matriz de permissões.'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.organization_id into v_org
    from public.roles r where r.id = p_role_id and r.deleted_at is null;
  if v_org is null then
    raise exception 'Perfil não encontrado ou não editável nesta organização.'
      using errcode = 'no_data_found';
  end if;

  if not private.can_manage_role(p_role_id) then
    raise exception 'Somente o Administrador pode editar a matriz de permissões.'
      using errcode = 'insufficient_privilege';
  end if;

  -- An administrator profile always holds the whole catalogue. Letting somebody
  -- carve permissions out of it is how an organization locks itself out.
  if exists (
    select 1 from public.roles r
      join public.access_profiles ap on ap.code = r.code and ap.is_administrator
     where r.id = p_role_id
  ) then
    raise exception 'O perfil Administrador possui todas as permissões por definição e não pode ser reduzido.'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(p.code order by p.code), array[]::text[]) into v_before
    from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
   where rp.role_id = p_role_id;

  foreach v_code in array coalesce(p_permission_codes, array[]::text[]) loop
    select p.id into v_perm_id from public.permissions p where p.code = v_code;
    if v_perm_id is null then
      raise exception 'Permissão % não existe.', v_code using errcode = 'invalid_parameter_value';
    end if;
    if not private.can_grant_permission(p_role_id, v_perm_id) then
      raise exception 'Você não pode conceder a permissão % porque não a possui.', v_code
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  perform private.access_change_begin();

  delete from public.role_permissions rp
   where rp.role_id = p_role_id
     and rp.permission_id not in (
       select p.id from public.permissions p
        where p.code = any (coalesce(p_permission_codes, array[]::text[]))
     );

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, p.id from public.permissions p
   where p.code = any (coalesce(p_permission_codes, array[]::text[]))
  on conflict do nothing;

  select coalesce(array_agg(p.code order by p.code), array[]::text[]) into v_after
    from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
   where rp.role_id = p_role_id;

  insert into public.access_profile_changes
    (organization_id, membership_id, target_user_id, actor_user_id, previous_codes, new_codes, reason)
  values
    (v_org, null, null, (select auth.uid()), v_before, v_after, v_reason);

  perform private.emit_event(v_org, 'role.permissions_changed', 'role', p_role_id,
    jsonb_build_object('previous', v_before, 'new', v_after));
end;
$$;

revoke execute on function public.set_role_permissions(uuid, text[], text) from public, anon;
grant  execute on function public.set_role_permissions(uuid, text[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.restore_role_defaults(uuid, text)
-- Back to the official matrix for one profile.
-- -----------------------------------------------------------------------------
create or replace function public.restore_role_defaults(p_role_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code  text;
  v_codes text[];
begin
  select r.code into v_code from public.roles r where r.id = p_role_id and r.deleted_at is null;
  if v_code is null then
    raise exception 'Perfil não encontrado.' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.access_profiles ap where ap.code = v_code) then
    raise exception 'Somente os perfis oficiais possuem um padrão a restaurar.'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(d.permission_code), array[]::text[]) into v_codes
    from public.access_profile_defaults d where d.profile_code = v_code;

  perform public.set_role_permissions(p_role_id, v_codes, p_reason);
end;
$$;

revoke execute on function public.restore_role_defaults(uuid, text) from public, anon;
grant  execute on function public.restore_role_defaults(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The remaining privilege-moving routines, re-issued so they open the gate.
-- Their logic is unchanged; only private.access_change_begin() is new.
-- -----------------------------------------------------------------------------
create or replace function public.grant_employee_access(
  p_employee_id   uuid,
  p_user_id       uuid,
  p_role_ids      uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_membership uuid;
  v_role       uuid;
  v_op         uuid;
begin
  select e.organization_id into v_org
    from public.employees e where e.id = p_employee_id and e.deleted_at is null;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;

  perform private.assert_can_assign_roles(v_org, p_user_id, p_role_ids);
  perform private.access_change_begin();

  insert into public.organization_memberships (organization_id, user_id, employee_id, status, joined_at)
  values (v_org, p_user_id, p_employee_id, 'invited', null)
  on conflict (organization_id, user_id) do update
    set employee_id = excluded.employee_id,
        status = case when public.organization_memberships.status = 'removed'
                      then 'invited' else public.organization_memberships.status end
  returning id into v_membership;

  delete from public.membership_roles mr
   where mr.membership_id = v_membership
     and mr.role_id <> all (coalesce(p_role_ids, array[]::uuid[]));

  foreach v_role in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.membership_roles (membership_id, role_id)
    values (v_membership, v_role)
    on conflict (membership_id, role_id) do nothing;
  end loop;

  delete from public.membership_operation_scopes s
   where s.membership_id = v_membership
     and s.operation_id <> all (coalesce(p_operation_ids, array[]::uuid[]));

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id)
    values (v_org, v_membership, v_op)
    on conflict (membership_id, operation_id) do nothing;
  end loop;

  insert into public.access_profile_changes
    (organization_id, membership_id, target_user_id, actor_user_id, previous_codes, new_codes, reason)
  values
    (v_org, v_membership, p_user_id, (select auth.uid()),
     array[]::text[], private.membership_profile_codes(v_membership),
     'Concessão inicial de acesso ao HFM.');

  perform private.emit_event(
    v_org, 'user.access_granted', 'employee', p_employee_id,
    jsonb_build_object('membership_id', v_membership, 'role_count', coalesce(array_length(p_role_ids, 1), 0))
  );

  return v_membership;
end;
$$;
grant execute on function public.grant_employee_access(uuid, uuid, uuid[], uuid[]) to authenticated;

create or replace function public.set_membership_operation_scopes(p_membership_id uuid, p_operation_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_user uuid;
  v_op   uuid;
begin
  select m.organization_id, m.user_id into v_org, v_user
    from public.organization_memberships m where m.id = p_membership_id;
  if v_org is null then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_operation_scope') then
    raise exception 'permission users.manage_operation_scope is required' using errcode = 'insufficient_privilege';
  end if;
  if v_user = (select auth.uid()) and not private.is_platform_admin() then
    raise exception 'an account cannot change its own operation scope' using errcode = 'insufficient_privilege';
  end if;

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.operations o
                    where o.id = v_op and o.organization_id = v_org and o.deleted_at is null) then
      raise exception 'operation % is not available in this organization', v_op using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  perform private.access_change_begin();

  delete from public.membership_operation_scopes s
   where s.membership_id = p_membership_id
     and s.operation_id <> all (coalesce(p_operation_ids, array[]::uuid[]));

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id)
    values (v_org, p_membership_id, v_op)
    on conflict (membership_id, operation_id) do nothing;
  end loop;

  perform private.emit_event(v_org, 'user.operation_scope_changed', 'membership', p_membership_id,
    jsonb_build_object('operation_count', coalesce(array_length(p_operation_ids, 1), 0)));
end;
$$;
grant execute on function public.set_membership_operation_scopes(uuid, uuid[]) to authenticated;

-- Archiving a role still strips it from every membership; the gate has to be
-- open for that cascade, and the last-administrator check still applies.
create or replace function private.tg_roles_revoke_on_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform private.access_change_begin();
    delete from public.membership_roles mr where mr.role_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.tg_roles_revoke_on_archive() from public;

-- Provisioning writes role_permissions, so it opens the gate too.
create or replace function private.provision_access_profiles(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_profile record;
  v_role_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = 'invalid_parameter_value';
  end if;

  perform private.access_change_begin();

  for v_profile in
    select code, name, description from public.access_profiles order by sort_order
  loop
    select r.id into v_role_id
      from public.roles r
     where r.organization_id = p_organization_id and r.code = v_profile.code;

    if v_role_id is not null then
      update public.roles
         set deleted_at = null, deleted_by = null
       where id = v_role_id and deleted_at is not null;
      continue;
    end if;

    insert into public.roles (organization_id, code, name, description, is_system, is_editable)
    values (p_organization_id, v_profile.code, v_profile.name, v_profile.description, false, true)
    returning id into v_role_id;

    insert into public.role_permissions (role_id, permission_id)
    select v_role_id, p.id
      from public.access_profile_defaults d
      join public.permissions p on p.code = d.permission_code
     where d.profile_code = v_profile.code
    on conflict do nothing;

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke execute on function private.provision_access_profiles(uuid) from public, anon, authenticated;

-- A new organization is born with the seven official profiles and an owner who
-- holds Administrador — not with a platform role nobody can see or edit.
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

  insert into public.organizations
    (name, legal_name, document_number, slug, timezone, locale, created_by, updated_by)
  values
    (btrim(p_name), nullif(btrim(p_legal_name), ''), nullif(btrim(p_document_number), ''),
     lower(btrim(p_slug)), coalesce(p_timezone, 'America/Sao_Paulo'), coalesce(p_locale, 'pt-BR'),
     v_actor, v_actor)
  returning id into v_org_id;

  perform private.provision_access_profiles(v_org_id);

  select r.id into v_admin_role_id
    from public.roles r
    join public.access_profiles ap on ap.code = r.code and ap.is_administrator
   where r.organization_id = v_org_id and r.deleted_at is null;

  if v_admin_role_id is null then
    raise exception 'administrator profile missing after provisioning';
  end if;

  insert into public.organization_memberships
    (organization_id, user_id, status, joined_at, created_by, updated_by)
  values
    (v_org_id, v_owner, 'active', now(), v_actor, v_actor)
  returning id into v_membership_id;

  perform private.access_change_begin();
  insert into public.membership_roles (membership_id, role_id, created_by)
  values (v_membership_id, v_admin_role_id, v_actor);

  return v_org_id;
end;
$$;

revoke execute on function public.create_organization(text, text, uuid, text, text, text, text) from public, anon;
grant  execute on function public.create_organization(text, text, uuid, text, text, text, text) to authenticated, service_role;

comment on function public.create_organization(text, text, uuid, text, text, text, text) is
  'Atomic tenant bootstrap: organization + settings + the seven official access profiles + owner membership holding Administrador.';
