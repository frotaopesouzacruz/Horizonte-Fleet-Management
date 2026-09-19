-- =============================================================================
-- ETAPA 05 · THE PERMISSIONS THAT ADMINISTER ACCESS STAY WITH THE ADMINISTRATOR
--
-- "Somente o Administrador pode alterar perfis de acesso, atribuir e remover
-- perfis, editar a matriz e restaurar padrões."
--
-- Read strictly, that is not a default to be nudged — it is a rule. Without
-- this, an Administrador could hand `users.manage_roles` to another profile and
-- the sentence above would quietly stop being true, with nobody noticing.
-- Delegating access administration is still possible, and there is exactly one
-- way to do it: give the person the Administrador profile, deliberately, with a
-- reason, where the audit trail can see it.
-- =============================================================================

create or replace function private.is_reserved_access_permission(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code in ('users.manage_roles', 'users.manage_operation_scope', 'roles.manage');
$$;

grant execute on function private.is_reserved_access_permission(text) to authenticated, service_role;

comment on function private.is_reserved_access_permission(text) is
  'Permissions that administer access itself. Only the administrator profile may hold them.';

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
    if private.is_reserved_access_permission(v_code) then
      raise exception 'A permissão % administra o próprio acesso e pertence somente ao perfil Administrador. Para delegar, atribua o perfil Administrador à pessoa.', v_code
        using errcode = 'insufficient_privilege';
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

-- Any non-administrator profile that already holds one of these loses it, and
-- the organization is told rather than left to discover it.
insert into public.access_profile_reviews
  (organization_id, membership_id, employee_id, reason_code, details)
select distinct r.organization_id, null::uuid, null::uuid, 'profile_outside_catalog',
       jsonb_build_object('profile', r.code, 'permission', p.code,
                          'action', 'removida: permissão reservada ao perfil Administrador')
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p       on p.id = rp.permission_id
  left join public.access_profiles ap on ap.code = r.code and ap.is_administrator
 where r.organization_id is not null
   and ap.code is null
   and private.is_reserved_access_permission(p.code);

delete from public.role_permissions rp
 using public.roles r, public.permissions p
 where rp.role_id = r.id
   and p.id = rp.permission_id
   and r.organization_id is not null
   and private.is_reserved_access_permission(p.code)
   and not exists (
     select 1 from public.access_profiles ap where ap.code = r.code and ap.is_administrator
   );

-- The default matrix must not offer them either.
delete from public.access_profile_defaults d
 where private.is_reserved_access_permission(d.permission_code)
   and d.profile_code not in (select code from public.access_profiles where is_administrator);
