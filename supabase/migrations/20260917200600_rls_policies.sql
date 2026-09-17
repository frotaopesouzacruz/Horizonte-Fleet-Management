-- =============================================================================
-- HFM · 007 · Row Level Security, privileges and permission guards
--
-- Rules:
--   * RLS enabled on every public table.
--   * anon has no access to application tables or RPCs.
--   * Read access = active membership (+ specific *.view permission).
--   * Writes = specific permission through RBAC. Hard DELETE is never granted
--     to application users on master data (soft delete via deleted_at).
--   * Tenant helpers are evaluated once per query (InitPlan subqueries).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Tables that application users never write directly
revoke insert, update, delete on public.audit_logs             from authenticated;
revoke all on public.outbox_events from authenticated;
revoke insert, update, delete on public.permissions            from authenticated;
revoke insert, update, delete on public.vehicle_types          from authenticated;
revoke insert, update, delete on public.platform_admins        from authenticated;
revoke insert, update, delete on public.vehicle_status_history from authenticated;
revoke insert, update, delete on public.organization_settings  from authenticated;
grant  update on public.organization_settings to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant  update (full_name, display_name, avatar_url) on public.profiles to authenticated;

-- Hard delete is never available to application users on these tables
revoke delete on public.organizations, public.organization_units, public.cost_centers,
                 public.organization_memberships, public.roles, public.vehicle_makes,
                 public.vehicle_models, public.vehicles, public.drivers
  from authenticated;
-- organizations are created only through public.create_organization()
revoke insert on public.organizations from authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
alter table public.organizations            enable row level security;
alter table public.organization_settings    enable row level security;
alter table public.organization_units       enable row level security;
alter table public.cost_centers             enable row level security;
alter table public.profiles                 enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.platform_admins          enable row level security;
alter table public.permissions              enable row level security;
alter table public.roles                    enable row level security;
alter table public.role_permissions         enable row level security;
alter table public.membership_roles         enable row level security;
alter table public.vehicle_types            enable row level security;
alter table public.vehicle_makes            enable row level security;
alter table public.vehicle_models           enable row level security;
alter table public.vehicles                 enable row level security;
alter table public.vehicle_status_history   enable row level security;
alter table public.drivers                  enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.outbox_events            enable row level security;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select private.member_org_ids()));

create policy organizations_update on public.organizations
  for update to authenticated
  using      (id in (select private.permitted_org_ids('organization.manage')))
  with check (id in (select private.permitted_org_ids('organization.manage')));

-- -----------------------------------------------------------------------------
-- organization_settings
-- -----------------------------------------------------------------------------
create policy organization_settings_select on public.organization_settings
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

create policy organization_settings_update on public.organization_settings
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('organization.manage')))
  with check (organization_id in (select private.permitted_org_ids('organization.manage')));

-- -----------------------------------------------------------------------------
-- organization_units
-- -----------------------------------------------------------------------------
create policy organization_units_select on public.organization_units
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('units.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('units.manage')))
  );

create policy organization_units_insert on public.organization_units
  for insert to authenticated
  with check (organization_id in (select private.permitted_org_ids('units.manage')));

create policy organization_units_update on public.organization_units
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('units.manage')))
  with check (organization_id in (select private.permitted_org_ids('units.manage')));

create trigger organization_units_soft_delete_guard
  before update on public.organization_units
  for each row execute function private.tg_guard_soft_delete('units.manage');

-- -----------------------------------------------------------------------------
-- cost_centers
-- -----------------------------------------------------------------------------
create policy cost_centers_select on public.cost_centers
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('cost_centers.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('cost_centers.manage')))
  );

create policy cost_centers_insert on public.cost_centers
  for insert to authenticated
  with check (organization_id in (select private.permitted_org_ids('cost_centers.manage')));

create policy cost_centers_update on public.cost_centers
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('cost_centers.manage')))
  with check (organization_id in (select private.permitted_org_ids('cost_centers.manage')));

create trigger cost_centers_soft_delete_guard
  before update on public.cost_centers
  for each row execute function private.tg_guard_soft_delete('cost_centers.manage');

-- -----------------------------------------------------------------------------
-- profiles
-- Users read their own profile and the profiles of people sharing an
-- organization with them. Users update only their own row and only the
-- columns granted above (status is not user-editable).
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or user_id in (select private.visible_profile_user_ids())
  );

create policy profiles_update_own on public.profiles
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- organization_memberships
-- -----------------------------------------------------------------------------
create policy organization_memberships_select on public.organization_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (select private.permitted_org_ids('members.view'))
  );

create policy organization_memberships_insert on public.organization_memberships
  for insert to authenticated
  with check (organization_id in (select private.permitted_org_ids('members.manage')));

create policy organization_memberships_update on public.organization_memberships
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('members.manage')))
  with check (organization_id in (select private.permitted_org_ids('members.manage')));

-- -----------------------------------------------------------------------------
-- platform_admins (read-only roster for platform admins; writes via service_role)
-- -----------------------------------------------------------------------------
create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using ((select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- permissions / vehicle_types (global catalogs, read-only)
-- -----------------------------------------------------------------------------
create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy vehicle_types_select on public.vehicle_types
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
create policy roles_select on public.roles
  for select to authenticated
  using (
    (organization_id is null and deleted_at is null)
    or (organization_id in (select private.permitted_org_ids('roles.view'))
        and (deleted_at is null or organization_id in (select private.permitted_org_ids('roles.manage'))))
  );

create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('roles.manage'))
  );

create policy roles_update on public.roles
  for update to authenticated
  using (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('roles.manage'))
  )
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('roles.manage'))
  );

create trigger roles_soft_delete_guard
  before update on public.roles
  for each row execute function private.tg_guard_soft_delete('roles.manage');

-- -----------------------------------------------------------------------------
-- role_permissions
-- Granting a permission to a custom role requires roles.manage AND holding
-- that permission yourself (no privilege escalation through role editing).
-- -----------------------------------------------------------------------------
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and (r.organization_id is null
             or r.organization_id in (select private.permitted_org_ids('roles.view')))
    )
  );

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id is not null
        and r.is_editable
        and r.deleted_at is null
        and r.organization_id in (select private.permitted_org_ids('roles.manage'))
        and private.has_permission_id(r.organization_id, role_permissions.permission_id)
    )
  );

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.organization_id is not null
        and r.is_editable
        and r.organization_id in (select private.permitted_org_ids('roles.manage'))
    )
  );

-- -----------------------------------------------------------------------------
-- membership_roles
-- Users see their own roles; members.view sees roles of the organization.
-- Assigning/removing roles requires members.manage and is never allowed on
-- the actor's own membership (no self-promotion).
-- -----------------------------------------------------------------------------
create policy membership_roles_select on public.membership_roles
  for select to authenticated
  using (
    membership_id in (select private.own_membership_ids())
    or exists (
      select 1 from public.organization_memberships m
      where m.id = membership_roles.membership_id
        and m.organization_id in (select private.permitted_org_ids('members.view'))
    )
  );

create policy membership_roles_insert on public.membership_roles
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.id = membership_roles.membership_id
        and m.user_id <> (select auth.uid())
        and m.organization_id in (select private.permitted_org_ids('members.manage'))
    )
  );

create policy membership_roles_delete on public.membership_roles
  for delete to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.id = membership_roles.membership_id
        and m.user_id <> (select auth.uid())
        and m.organization_id in (select private.permitted_org_ids('members.manage'))
    )
  );

-- -----------------------------------------------------------------------------
-- vehicle_makes / vehicle_models
-- Global catalog readable by every authenticated user; tenant entries by members.
-- -----------------------------------------------------------------------------
create policy vehicle_makes_select on public.vehicle_makes
  for select to authenticated
  using (organization_id is null or organization_id in (select private.member_org_ids()));

create policy vehicle_makes_insert on public.vehicle_makes
  for insert to authenticated
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  );

create policy vehicle_makes_update on public.vehicle_makes
  for update to authenticated
  using (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  )
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  );

create policy vehicle_models_select on public.vehicle_models
  for select to authenticated
  using (organization_id is null or organization_id in (select private.member_org_ids()));

create policy vehicle_models_insert on public.vehicle_models
  for insert to authenticated
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  );

create policy vehicle_models_update on public.vehicle_models
  for update to authenticated
  using (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  )
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  );

-- -----------------------------------------------------------------------------
-- vehicles
-- -----------------------------------------------------------------------------
create policy vehicles_select on public.vehicles
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('vehicles.archive')))
  );

create policy vehicles_insert on public.vehicles
  for insert to authenticated
  with check (organization_id in (select private.permitted_org_ids('vehicles.create')));

create policy vehicles_update on public.vehicles
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('vehicles.update')))
  with check (organization_id in (select private.permitted_org_ids('vehicles.update')));

create trigger vehicles_soft_delete_guard
  before update on public.vehicles
  for each row execute function private.tg_guard_soft_delete('vehicles.archive');

-- -----------------------------------------------------------------------------
-- vehicle_status_history (read with vehicles.view; written by trigger only)
-- -----------------------------------------------------------------------------
create policy vehicle_status_history_select on public.vehicle_status_history
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('vehicles.view')));

-- -----------------------------------------------------------------------------
-- drivers
-- -----------------------------------------------------------------------------
create policy drivers_select on public.drivers
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('drivers.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('drivers.archive')))
  );

create policy drivers_insert on public.drivers
  for insert to authenticated
  with check (organization_id in (select private.permitted_org_ids('drivers.create')));

create policy drivers_update on public.drivers
  for update to authenticated
  using      (organization_id in (select private.permitted_org_ids('drivers.update')))
  with check (organization_id in (select private.permitted_org_ids('drivers.update')));

create trigger drivers_soft_delete_guard
  before update on public.drivers
  for each row execute function private.tg_guard_soft_delete('drivers.archive');

-- -----------------------------------------------------------------------------
-- audit_logs (read with audit.view; platform admins read platform-level rows)
-- -----------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (organization_id is not null
     and organization_id in (select private.permitted_org_ids('audit.view')))
    or (select private.is_platform_admin())
  );

-- outbox_events: no policies. Only service_role (workers) reads or writes.
