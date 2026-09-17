-- =============================================================================
-- HFM · 006 · Security helper functions (schema private)
-- Used by RLS policies, triggers and RPCs. SECURITY DEFINER is used only where
-- the function must read tables that are themselves protected by RLS
-- (memberships, roles, platform_admins) without recursion.
--
-- Policy pattern (evaluated once per query as an InitPlan, not per row):
--   organization_id in (select private.permitted_org_ids('vehicles.view'))
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.is_platform_admin()
-- -----------------------------------------------------------------------------
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.revoked_at is null
  );
$$;

grant execute on function private.is_platform_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.member_org_ids()
-- Organizations the current user can access: active membership in an active
-- organization, with an active profile. Platform admins: every organization.
-- -----------------------------------------------------------------------------
create or replace function private.member_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.organizations o
  where private.is_platform_admin()
  union
  select m.organization_id
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.user_id = m.user_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and o.status = 'active'
    and o.deleted_at is null
    and p.status = 'active';
$$;

grant execute on function private.member_org_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.permitted_org_ids(permission_code)
-- Organizations where the current user holds the permission (through any role
-- of an active membership). Platform admins: every organization.
-- -----------------------------------------------------------------------------
create or replace function private.permitted_org_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.organizations o
  where private.is_platform_admin()
  union
  select m.organization_id
  from public.organization_memberships m
  join public.organizations o   on o.id = m.organization_id
  join public.profiles p        on p.user_id = m.user_id
  join public.membership_roles mr on mr.membership_id = m.id
  join public.roles r           on r.id = mr.role_id
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions perm  on perm.id = rp.permission_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and o.status = 'active'
    and o.deleted_at is null
    and p.status = 'active'
    and r.deleted_at is null
    and perm.code = p_permission;
$$;

grant execute on function private.permitted_org_ids(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.is_org_member(organization_id) / private.has_permission(org, code)
-- Scalar variants for triggers, RPCs and application logic.
-- -----------------------------------------------------------------------------
create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and p_organization_id in (select private.member_org_ids());
$$;

grant execute on function private.is_org_member(uuid) to authenticated, service_role;

create or replace function private.has_permission(p_organization_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and p_organization_id in (select private.permitted_org_ids(p_permission));
$$;

grant execute on function private.has_permission(uuid, text) to authenticated, service_role;

-- Same check by permission id (used when granting permissions to custom roles:
-- nobody can grant a permission they do not hold themselves).
create or replace function private.has_permission_id(p_organization_id uuid, p_permission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.permissions perm
    where perm.id = p_permission_id
      and private.has_permission(p_organization_id, perm.code)
  );
$$;

grant execute on function private.has_permission_id(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.own_membership_ids()
-- Memberships of the current user (any status), used for self-visibility.
-- -----------------------------------------------------------------------------
create or replace function private.own_membership_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.organization_memberships m where m.user_id = auth.uid();
$$;

grant execute on function private.own_membership_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.visible_profile_user_ids()
-- Users sharing at least one accessible organization with the current user
-- (member directories). Platform admins: every user with a membership.
-- -----------------------------------------------------------------------------
create or replace function private.visible_profile_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.user_id
  from public.organization_memberships m
  where m.organization_id in (select private.member_org_ids())
    and m.status in ('invited', 'active', 'suspended');
$$;

grant execute on function private.visible_profile_user_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.user_permission_codes(organization_id)
-- Permission codes of the current user in one organization (for UIs/RPCs).
-- -----------------------------------------------------------------------------
create or replace function private.user_permission_codes(p_organization_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select perm.code
  from public.permissions perm
  where private.is_platform_admin()
    and p_organization_id in (select private.member_org_ids())
  union
  select distinct perm.code
  from public.organization_memberships m
  join public.organizations o     on o.id = m.organization_id
  join public.profiles p          on p.user_id = m.user_id
  join public.membership_roles mr on mr.membership_id = m.id
  join public.roles r             on r.id = mr.role_id
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions perm    on perm.id = rp.permission_id
  where m.user_id = auth.uid()
    and m.organization_id = p_organization_id
    and m.status = 'active'
    and o.status = 'active'
    and o.deleted_at is null
    and p.status = 'active'
    and r.deleted_at is null;
$$;

grant execute on function private.user_permission_codes(uuid) to authenticated, service_role;
