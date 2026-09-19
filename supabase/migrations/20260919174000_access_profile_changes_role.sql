-- =============================================================================
-- ETAPA 05 · THE CHANGE LOG SAYS WHICH PROFILE CHANGED
--
-- A matrix change is a change to one profile, and the record had nowhere to say
-- which. Without it the Perfis list cannot show "última alteração" and the
-- audit tab cannot be filtered by profile — both of which are the point of
-- keeping the log at all.
-- =============================================================================

alter table public.access_profile_changes
  add column if not exists role_id uuid;

create index if not exists access_profile_changes_role_idx
  on public.access_profile_changes (role_id, created_at desc);

comment on column public.access_profile_changes.role_id is
  'The profile whose matrix changed. Null for a change to somebody''s assigned profile, which membership_id identifies instead.';

-- set_role_permissions now stamps role_id. Body identical to the previous
-- version apart from that column; re-issued because a function cannot be
-- patched in place.
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
    (organization_id, role_id, membership_id, target_user_id, actor_user_id, previous_codes, new_codes, reason)
  values
    (v_org, p_role_id, null, null, (select auth.uid()), v_before, v_after, v_reason);

  perform private.emit_event(v_org, 'role.permissions_changed', 'role', p_role_id,
    jsonb_build_object('previous', v_before, 'new', v_after));
end;
$$;

revoke execute on function public.set_role_permissions(uuid, text[], text) from public, anon;
grant  execute on function public.set_role_permissions(uuid, text[], text) to authenticated;

-- The list needs the last time each profile's matrix moved. A view cannot gain
-- a column through CREATE OR REPLACE, so it is dropped and rebuilt.
drop view if exists public.access_profile_overview;

create view public.access_profile_overview
with (security_invoker = on) as
select
  r.organization_id,
  r.id                as role_id,
  ap.code,
  ap.name             as catalog_name,
  r.name              as role_name,
  ap.description,
  ap.sort_order,
  ap.is_administrator,
  coalesce(pc.permission_count, 0) as permission_count,
  coalesce(mc.member_count, 0)     as member_count,
  (
    select coalesce(array_agg(code order by code), array[]::text[])
      from (
        select p.code
          from public.role_permissions rp
          join public.permissions p on p.id = rp.permission_id
         where rp.role_id = r.id
        except
        select d.permission_code
          from public.access_profile_defaults d
         where d.profile_code = ap.code
      ) added (code)
  ) as added_permissions,
  (
    select coalesce(array_agg(code order by code), array[]::text[])
      from (
        select d.permission_code
          from public.access_profile_defaults d
         where d.profile_code = ap.code
        except
        select p.code
          from public.role_permissions rp
          join public.permissions p on p.id = rp.permission_id
         where rp.role_id = r.id
      ) removed (code)
  ) as removed_permissions,
  (select max(c.created_at) from public.access_profile_changes c where c.role_id = r.id) as last_changed_at
from public.roles r
join public.access_profiles ap on ap.code = r.code
left join lateral (
  select count(*) as permission_count
    from public.role_permissions rp where rp.role_id = r.id
) pc on true
left join lateral (
  select count(*) as member_count
    from public.membership_roles mr
    join public.organization_memberships m on m.id = mr.membership_id
   where mr.role_id = r.id and m.status in ('invited', 'active', 'suspended')
) mc on true
where r.organization_id is not null
  and r.deleted_at is null;

comment on view public.access_profile_overview is
  'The Perfis e Permissões list: official profile, the role that carries it in this organization, its size, how far it drifted from the default and when it last moved.';

grant select on public.access_profile_overview to authenticated;
