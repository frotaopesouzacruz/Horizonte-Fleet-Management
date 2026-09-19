-- =============================================================================
-- ETAPA 05 · READ MODEL FOR ADMINISTRAÇÃO > PERFIS E PERMISSÕES
--
-- Everything the screen needs, answered by the database. security_invoker on
-- the view and security invoker on the functions, so a person only ever sees
-- the profiles and the people of an organization they belong to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- public.access_profile_overview
-- One row per official profile of an organization: the role behind it, how many
-- permissions it carries, how many accounts hold it, and whether an
-- administrator has moved it away from the official default.
-- -----------------------------------------------------------------------------
create or replace view public.access_profile_overview
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
  -- "customizado": the grants of this role are not the official default any more
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
  ) as removed_permissions
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
  'The Perfis e Permissões list: official profile, the role that carries it in this organization, its size and how far it drifted from the default.';

grant select on public.access_profile_overview to authenticated;

-- -----------------------------------------------------------------------------
-- public.access_profile_matrix(uuid)
-- The whole matrix in one round trip: every permission of the catalogue, and
-- for each one the profiles that hold it, plus whether the default holds it.
-- -----------------------------------------------------------------------------
create or replace function public.access_profile_matrix(p_organization_id uuid)
returns table (
  permission_code text,
  permission_name text,
  module          text,
  description     text,
  reserved        boolean,
  granted_codes   text[],
  default_codes   text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.code,
    p.name,
    p.module,
    p.description,
    private.is_reserved_access_permission(p.code),
    coalesce((
      select array_agg(r.code order by ap.sort_order)
        from public.role_permissions rp
        join public.roles r            on r.id = rp.role_id
        join public.access_profiles ap on ap.code = r.code
       where rp.permission_id = p.id
         and r.organization_id = p_organization_id
         and r.deleted_at is null
    ), array[]::text[]),
    coalesce((
      select array_agg(d.profile_code order by ap2.sort_order)
        from public.access_profile_defaults d
        join public.access_profiles ap2 on ap2.code = d.profile_code
       where d.permission_code = p.code
    ), array[]::text[])
  from public.permissions p
  order by p.module, p.code;
$$;

revoke execute on function public.access_profile_matrix(uuid) from public, anon;
grant  execute on function public.access_profile_matrix(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- public.access_inconsistencies(uuid)
-- The audit panel. Every row is a question somebody should answer, never an
-- automatic correction: this function only reads.
-- -----------------------------------------------------------------------------
create or replace function public.access_inconsistencies(p_organization_id uuid)
returns table (
  kind        text,
  severity    text,
  subject_id  uuid,
  subject     text,
  detail      text
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- An active account with no profile at all sees nothing and nobody knows why.
  select 'membership_without_profile', 'high', m.id, coalesce(e.full_name, 'Conta sem colaborador'),
         'Conta com acesso ativo e nenhum perfil atribuído.'
    from public.organization_memberships m
    left join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status in ('invited', 'active')
     and not exists (select 1 from public.membership_roles mr where mr.membership_id = m.id)

  union all
  -- More than one profile: the effective permission is the union, which is
  -- rarely what anybody intended.
  select 'membership_with_many_profiles', 'medium', m.id, coalesce(e.full_name, 'Conta sem colaborador'),
         'Conta com mais de um perfil de acesso: ' || (
           select string_agg(r.code, ', ' order by r.code)
             from public.membership_roles mr
             join public.roles r on r.id = mr.role_id
            where mr.membership_id = m.id
         )
    from public.organization_memberships m
    left join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status in ('invited', 'active')
     and (select count(*) from public.membership_roles mr where mr.membership_id = m.id) > 1

  union all
  -- Access still open for somebody who left the company.
  select 'access_without_employment', 'high', m.id, e.full_name,
         'Colaborador com situação "' || e.employment_status || '" e acesso ao HFM ainda ativo.'
    from public.organization_memberships m
    join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status = 'active'
     and (e.employment_status in ('terminated', 'inactive') or e.deleted_at is not null)

  union all
  -- A scoped profile with no operation sees no operation at all.
  select 'profile_without_operation_scope', 'medium', m.id, coalesce(e.full_name, 'Conta sem colaborador'),
         'Perfil restrito por operação, mas nenhuma operação atribuída à conta.'
    from public.organization_memberships m
    left join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status in ('invited', 'active')
     and exists (select 1 from public.membership_roles mr where mr.membership_id = m.id)
     and not exists (
       select 1
         from public.membership_roles mr
         join public.roles r             on r.id = mr.role_id
         join public.role_permissions rp on rp.role_id = r.id
         join public.permissions p       on p.id = rp.permission_id
        where mr.membership_id = m.id and p.code = 'operations.access_all'
     )
     and not exists (
       select 1 from public.membership_operation_scopes s where s.membership_id = m.id
     )

  union all
  -- A profile whose matrix no longer matches the official default.
  select 'profile_customised', 'low', v.role_id, v.catalog_name,
         'Matriz diferente do padrão oficial: ' ||
         cardinality(v.added_permissions) || ' adicionada(s), ' ||
         cardinality(v.removed_permissions) || ' removida(s).'
    from public.access_profile_overview v
   where v.organization_id = p_organization_id
     and (cardinality(v.added_permissions) > 0 or cardinality(v.removed_permissions) > 0)

  union all
  -- The organization has exactly one person who can administer access. Not an
  -- error, but the day that person is away it becomes one.
  select 'single_administrator', 'medium', null::uuid, 'Administração de acesso',
         'A organização possui apenas um Administrador ativo. Considere um segundo.'
   where (
     select count(*)
       from public.organization_memberships m
       join public.membership_roles mr on mr.membership_id = m.id
       join public.roles r             on r.id = mr.role_id
       join public.access_profiles ap  on ap.code = r.code and ap.is_administrator
      where m.organization_id = p_organization_id
        and m.status = 'active'
        and r.organization_id = p_organization_id
   ) = 1;
$$;

revoke execute on function public.access_inconsistencies(uuid) from public, anon;
grant  execute on function public.access_inconsistencies(uuid) to authenticated;

-- membership_profile_codes answers for any membership id, bypassing RLS by
-- design so the RPCs can record a before/after. Nothing reads it directly from
-- the client, and it stays that way.
revoke execute on function private.membership_profile_codes(uuid) from authenticated;
