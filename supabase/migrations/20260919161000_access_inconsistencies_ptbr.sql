-- =============================================================================
-- ETAPA 05 · THE AUDIT PANEL SPEAKS PORTUGUESE TOO
--
-- The panel was printing the raw `employment_status` inside its sentence:
-- 'Colaborador com situação "terminated" e acesso ao HFM ainda ativo.'
-- The column is English because the schema is; the sentence a person reads is
-- not, and a screen that leaks a storage value is asking its reader to know the
-- schema in order to understand the warning.
-- =============================================================================

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
  select 'membership_without_profile', 'high', m.id, coalesce(e.full_name, 'Conta sem colaborador'),
         'Conta com acesso ativo e nenhum perfil atribuído.'
    from public.organization_memberships m
    left join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status in ('invited', 'active')
     and not exists (select 1 from public.membership_roles mr where mr.membership_id = m.id)

  union all
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
  select 'access_without_employment', 'high', m.id, e.full_name,
         'Colaborador ' || case
              when e.deleted_at is not null           then 'com cadastro inativado'
              when e.employment_status = 'terminated' then 'desligado'
              else 'inativo'
            end || ' e com acesso ao HFM ainda ativo.'
    from public.organization_memberships m
    join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.status = 'active'
     and (e.employment_status in ('terminated', 'inactive') or e.deleted_at is not null)

  union all
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
  select 'profile_customised', 'low', v.role_id, v.catalog_name,
         'Matriz diferente do padrão oficial: ' ||
         cardinality(v.added_permissions) || ' adicionada(s), ' ||
         cardinality(v.removed_permissions) || ' removida(s).'
    from public.access_profile_overview v
   where v.organization_id = p_organization_id
     and (cardinality(v.added_permissions) > 0 or cardinality(v.removed_permissions) > 0)

  union all
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
