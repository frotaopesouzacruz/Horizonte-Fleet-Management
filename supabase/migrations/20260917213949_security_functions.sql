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

-- =============================================================================
-- Policy helpers for the RBAC join tables.
--
-- RLS policies run under the caller's own privileges, so an EXISTS subquery
-- inside a policy is itself filtered by the policies of the table it reads.
-- A member manager without `members.view`, or a role manager without
-- `roles.view`, would silently fail. These SECURITY DEFINER helpers answer the
-- whole question against the real rows instead.
-- =============================================================================

-- Can the caller see the roles assigned to this membership?
create or replace function private.can_view_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.id = p_membership_id
      and (m.user_id = auth.uid()
           or m.organization_id in (select private.permitted_org_ids('members.view')))
  );
$$;

grant execute on function private.can_view_membership(uuid) to authenticated, service_role;

-- Does the caller hold every permission granted by this role, inside p_organization_id?
-- Prevents a members.manage holder from handing out a role more powerful than
-- their own (e.g. granting org_admin to a colleague and being promoted back).
create or replace function private.role_within_actor_permissions(
  p_organization_id uuid,
  p_role_id         uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
      or not exists (
        select 1
        from public.role_permissions rp
        join public.permissions perm on perm.id = rp.permission_id
        where rp.role_id = p_role_id
          and p_organization_id not in (select private.permitted_org_ids(perm.code))
      );
$$;

grant execute on function private.role_within_actor_permissions(uuid, uuid) to authenticated, service_role;

-- Can the caller assign/remove this role on this membership?
--   * members.manage in the membership's organization;
--   * never on their own membership (no self-promotion);
--   * only roles they could grant themselves (no escalation);
--   * global roles and same-organization roles only, never archived.
create or replace function private.can_manage_membership_role(
  p_membership_id uuid,
  p_role_id       uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.roles r on r.id = p_role_id
    where m.id = p_membership_id
      and m.user_id <> auth.uid()
      and m.organization_id in (select private.permitted_org_ids('members.manage'))
      and r.deleted_at is null
      and (r.organization_id is null or r.organization_id = m.organization_id)
      and private.role_within_actor_permissions(m.organization_id, p_role_id)
  );
$$;

grant execute on function private.can_manage_membership_role(uuid, uuid) to authenticated, service_role;

-- Can the caller read this role's permission grants?
create or replace function private.can_view_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = p_role_id
      and (r.organization_id is null
           or r.organization_id in (select private.permitted_org_ids('roles.view')))
  );
$$;

grant execute on function private.can_view_role(uuid) to authenticated, service_role;

-- Can the caller change this role's permission grants?
-- Custom, editable, non-archived roles of an organization where the caller
-- holds roles.manage. Platform roles are never editable through the API.
create or replace function private.can_manage_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = p_role_id
      and r.organization_id is not null
      and r.is_editable
      and r.deleted_at is null
      and r.organization_id in (select private.permitted_org_ids('roles.manage'))
  );
$$;

grant execute on function private.can_manage_role(uuid) to authenticated, service_role;

-- Can the caller grant this specific permission to this role?
-- Adds the anti-escalation rule: you cannot grant what you do not hold.
create or replace function private.can_grant_permission(
  p_role_id       uuid,
  p_permission_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_role(p_role_id)
     and exists (
       select 1
       from public.roles r
       join public.permissions perm on perm.id = p_permission_id
       where r.id = p_role_id
         and r.organization_id in (select private.permitted_org_ids(perm.code))
     );
$$;

grant execute on function private.can_grant_permission(uuid, uuid) to authenticated, service_role;
