-- =============================================================================
-- ETAPA 05 · A PERMISSION THAT CANNOT BE USED IS NOT A PERMISSION
--
-- `users.create` without `users.view` describes an account that may register a
-- colaborador and then cannot see the screen it would register them on. It is
-- not dangerous — it is incoherent, and an incoherent matrix is one an
-- administrator cannot reason about.
--
-- The rule is one line: every action on a resource requires that resource's
-- own `view`, when the catalogue has one. The interface greys the dependents
-- out; this is what makes the rule true regardless of the interface.
-- =============================================================================

-- The `<resource>.view` a code depends on, or null when it has none.
create or replace function private.permission_dependency(p_code text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p_code is null then null
           when split_part(p_code, '.', 2) = 'view' then null
           when exists (
             select 1 from public.permissions p
              where p.code = split_part(p_code, '.', 1) || '.view'
           ) then split_part(p_code, '.', 1) || '.view'
           else null
         end;
$$;

grant execute on function private.permission_dependency(text) to authenticated, service_role;

comment on function private.permission_dependency(text) is
  'The <resource>.view a permission code requires, when the catalogue defines one.';

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
  v_dep     text;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_perm_id uuid;
  v_before  text[];
  v_after   text[];
  v_codes   text[] := coalesce(p_permission_codes, array[]::text[]);
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

  foreach v_code in array v_codes loop
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

    v_dep := private.permission_dependency(v_code);
    if v_dep is not null and not (v_dep = any (v_codes)) then
      raise exception 'A permissão % depende de %, que não está concedida neste perfil.', v_code, v_dep
        using errcode = 'check_violation';
    end if;
  end loop;

  perform private.access_change_begin();

  delete from public.role_permissions rp
   where rp.role_id = p_role_id
     and rp.permission_id not in (select p.id from public.permissions p where p.code = any (v_codes));

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, p.id from public.permissions p where p.code = any (v_codes)
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
