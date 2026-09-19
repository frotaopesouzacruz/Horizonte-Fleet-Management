-- =============================================================================
-- ETAPA 05 · WHAT ONE ACCOUNT CAN ACTUALLY DO
--
-- "Efective permissions" was being recomputed in three places with three
-- slightly different joins, which is how two screens end up disagreeing about
-- whether somebody can export a spreadsheet. This is the one answer.
--
-- It powers the simulation of a real account, which describes an account and
-- never becomes one: no session is touched, no action is executed on anybody's
-- behalf. An audit trail that cannot tell a simulation from the real person is
-- worth nothing.
-- =============================================================================

create or replace function public.membership_effective_access(p_membership_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Reading somebody's effective access is reading their access profile, so
    -- it needs the permission to see profiles in that organization. Without it
    -- the function does not error, it simply has nothing to say.
    when not exists (
      select 1 from public.organization_memberships m
       where m.id = p_membership_id
         and m.organization_id in (select private.permitted_org_ids('roles.view'))
    ) then null
    else (
      select jsonb_build_object(
        'membership_id', m.id,
        'status',        m.status,
        'employee_name', e.full_name,
        'email',         e.corporate_email,
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name) order by ap.sort_order)
            from public.membership_roles mr
            join public.roles r            on r.id = mr.role_id
            left join public.access_profiles ap on ap.code = r.code
           where mr.membership_id = m.id
        ), '[]'::jsonb),
        'permissions', coalesce((
          select jsonb_agg(distinct p.code)
            from public.membership_roles mr
            join public.roles r             on r.id = mr.role_id and r.deleted_at is null
            join public.role_permissions rp on rp.role_id = r.id
            join public.permissions p       on p.id = rp.permission_id
           where mr.membership_id = m.id
        ), '[]'::jsonb),
        'operations', coalesce((
          select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code) order by o.name)
            from public.membership_operation_scopes s
            join public.operations o on o.id = s.operation_id
           where s.membership_id = m.id
        ), '[]'::jsonb),
        'access_all_operations', exists (
          select 1
            from public.membership_roles mr
            join public.roles r             on r.id = mr.role_id and r.deleted_at is null
            join public.role_permissions rp on rp.role_id = r.id
            join public.permissions p       on p.id = rp.permission_id
           where mr.membership_id = m.id and p.code = 'operations.access_all'
        )
      )
      from public.organization_memberships m
      left join public.employees e on e.id = m.employee_id
      where m.id = p_membership_id
    )
  end;
$$;

comment on function public.membership_effective_access(uuid) is
  'The effective access of one membership: profiles, permission codes and operation scope. Read-only; simulating an account never assumes its identity.';

revoke execute on function public.membership_effective_access(uuid) from public, anon;
grant  execute on function public.membership_effective_access(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The accounts a simulation can be run against: everybody with a membership.
-- -----------------------------------------------------------------------------
create or replace function public.simulatable_memberships(p_organization_id uuid)
returns table (
  membership_id uuid,
  employee_name text,
  email         text,
  status        text,
  profile_codes text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    coalesce(e.full_name, 'Conta sem colaborador'),
    e.corporate_email,
    m.status,
    coalesce((
      select array_agg(r.code order by r.code)
        from public.membership_roles mr
        join public.roles r on r.id = mr.role_id
       where mr.membership_id = m.id
    ), array[]::text[])
  from public.organization_memberships m
  left join public.employees e on e.id = m.employee_id
  where m.organization_id = p_organization_id
    and m.status in ('invited', 'active', 'suspended')
  order by coalesce(e.full_name, '');
$$;

revoke execute on function public.simulatable_memberships(uuid) from public, anon;
grant  execute on function public.simulatable_memberships(uuid) to authenticated;
