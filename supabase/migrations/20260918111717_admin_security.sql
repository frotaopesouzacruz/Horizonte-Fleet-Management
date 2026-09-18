-- =============================================================================
-- ADMINISTRATION — SECURITY HELPERS AND ROW LEVEL SECURITY
--
-- Two axes of isolation from here on:
--   organization_id  tenant (already established)
--   operation_id     scope inside the tenant (new, reused by every module)
--
-- The operation axis is expressed once, in private.accessible_operation_ids(),
-- so policies stay short and are evaluated as a single InitPlan per query
-- instead of once per row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.accessible_operation_ids()
-- Every operation the caller may read, across their organizations:
--   * platform admins: all of them
--   * operations.access_all in an organization: all of that organization's
--   * otherwise: exactly the ones assigned to one of their active memberships
-- Absence of scope rows means no operation. Never "all".
-- -----------------------------------------------------------------------------
create or replace function private.accessible_operation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.operations o
   where o.deleted_at is null
     and (
       private.is_platform_admin()
       or o.organization_id in (select private.permitted_org_ids('operations.access_all'))
     )
  union
  select s.operation_id
    from public.membership_operation_scopes s
    join public.organization_memberships m on m.id = s.membership_id
   where m.user_id = (select auth.uid())
     and m.status = 'active';
$$;
comment on function private.accessible_operation_ids() is
  'Operation ids readable by the caller. The single place the operation axis is defined; every module scopes through it.';
grant execute on function private.accessible_operation_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.can_access_operation(uuid)
-- Convenience wrapper for application code and future module policies.
-- -----------------------------------------------------------------------------
create or replace function private.can_access_operation(p_operation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_operation_id is not null
     and p_operation_id in (select private.accessible_operation_ids());
$$;
grant execute on function private.can_access_operation(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.employee_in_scope(uuid)
-- An employee is visible when the caller may read every operation of the
-- tenant, or when the employee's current assignment sits in an operation the
-- caller is scoped to. An employee with no operation is visible only to the
-- first group: failing closed is the point.
-- -----------------------------------------------------------------------------
create or replace function private.employee_in_scope(p_organization_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
      or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
      or exists (
        select 1
          from public.employee_assignments a
         where a.employee_id = p_employee_id
           and a.is_current
           and a.operation_id in (select private.accessible_operation_ids())
      );
$$;
grant execute on function private.employee_in_scope(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

-- Master data and people records are archived, never hard-deleted.
revoke delete on public.employees, public.employment_areas, public.business_profiles,
                 public.job_positions, public.operations, public.work_locations,
                 public.driver_licenses, public.employee_assignments
  from authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
alter table public.employment_areas            enable row level security;
alter table public.business_profiles           enable row level security;
alter table public.job_positions               enable row level security;
alter table public.operations                  enable row level security;
alter table public.work_locations              enable row level security;
alter table public.employees                   enable row level security;
alter table public.employee_private_data       enable row level security;
alter table public.driver_licenses             enable row level security;
alter table public.employee_assignments        enable row level security;
alter table public.membership_operation_scopes enable row level security;
alter table public.access_profile_mappings     enable row level security;
alter table public.import_batches              enable row level security;
alter table public.import_rows                 enable row level security;
alter table public.import_errors               enable row level security;

-- -----------------------------------------------------------------------------
-- Master data: readable by any member of the tenant, written with an explicit
-- permission. Archived rows stay visible to whoever may archive them.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['employment_areas', 'business_profiles', 'job_positions', 'work_locations'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
      using (
        organization_id in (select private.member_org_ids())
        and (deleted_at is null
             or organization_id in (select private.permitted_org_ids('users.manage_master_data')))
      )$f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (organization_id in (select private.permitted_org_ids('users.manage_master_data')))$f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$s for update to authenticated
      using (organization_id in (select private.permitted_org_ids('users.manage_master_data')))
      with check (organization_id in (select private.permitted_org_ids('users.manage_master_data')))$f$, t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- operations: same shape, own permissions, and the list itself is scoped —
-- an account that may only read two operations does not get to enumerate the
-- other forty.
-- -----------------------------------------------------------------------------
create policy operations_select on public.operations for select to authenticated
using (
  organization_id in (select private.permitted_org_ids('operations.view'))
  and (deleted_at is null or organization_id in (select private.permitted_org_ids('operations.manage')))
  and (
    organization_id in (select private.permitted_org_ids('operations.access_all'))
    or id in (select private.accessible_operation_ids())
    or organization_id in (select private.permitted_org_ids('users.manage_operation_scope'))
  )
);

create policy operations_insert on public.operations for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('operations.manage')));

create policy operations_update on public.operations for update to authenticated
using (organization_id in (select private.permitted_org_ids('operations.manage')))
with check (organization_id in (select private.permitted_org_ids('operations.manage')));

-- -----------------------------------------------------------------------------
-- employees
-- -----------------------------------------------------------------------------
create policy employees_select on public.employees for select to authenticated
using (
  organization_id in (select private.permitted_org_ids('users.view'))
  and (deleted_at is null or organization_id in (select private.permitted_org_ids('users.archive')))
  and (
    organization_id in (select private.permitted_org_ids('operations.access_all'))
    or exists (
      select 1 from public.employee_assignments a
       where a.employee_id = employees.id
         and a.is_current
         and a.operation_id in (select private.accessible_operation_ids())
    )
  )
);

create policy employees_insert on public.employees for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.create')));

create policy employees_update on public.employees for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.update')))
with check (organization_id in (select private.permitted_org_ids('users.update')));

-- -----------------------------------------------------------------------------
-- employee_private_data — CPF and birth date. Reading needs its own permission
-- on top of seeing the employee at all.
-- -----------------------------------------------------------------------------
create policy employee_private_data_select on public.employee_private_data for select to authenticated
using (
  organization_id in (select private.permitted_org_ids('users.view_sensitive'))
  and private.employee_in_scope(organization_id, employee_id)
);

create policy employee_private_data_insert on public.employee_private_data for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.view_sensitive')));

create policy employee_private_data_update on public.employee_private_data for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.view_sensitive')))
with check (organization_id in (select private.permitted_org_ids('users.view_sensitive')));

create policy employee_private_data_delete on public.employee_private_data for delete to authenticated
using (organization_id in (select private.permitted_org_ids('users.view_sensitive')));

-- -----------------------------------------------------------------------------
-- driver_licenses — visible with users.view; the full number is masked by the
-- directory view unless the caller holds users.view_sensitive.
-- -----------------------------------------------------------------------------
create policy driver_licenses_select on public.driver_licenses for select to authenticated
using (
  organization_id in (select private.permitted_org_ids('users.view'))
  and (deleted_at is null or organization_id in (select private.permitted_org_ids('users.update')))
  and private.employee_in_scope(organization_id, employee_id)
);

create policy driver_licenses_insert on public.driver_licenses for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.create')));

create policy driver_licenses_update on public.driver_licenses for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.update')))
with check (organization_id in (select private.permitted_org_ids('users.update')));

-- -----------------------------------------------------------------------------
-- employee_assignments
-- -----------------------------------------------------------------------------
create policy employee_assignments_select on public.employee_assignments for select to authenticated
using (
  organization_id in (select private.permitted_org_ids('users.view'))
  and (
    organization_id in (select private.permitted_org_ids('operations.access_all'))
    or operation_id in (select private.accessible_operation_ids())
  )
);

create policy employee_assignments_insert on public.employee_assignments for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.create')));

create policy employee_assignments_update on public.employee_assignments for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.update')))
with check (organization_id in (select private.permitted_org_ids('users.update')));

-- -----------------------------------------------------------------------------
-- membership_operation_scopes — an account always sees its own scope; changing
-- any scope needs the permission, and the trigger blocks self-service.
-- -----------------------------------------------------------------------------
create policy membership_operation_scopes_select on public.membership_operation_scopes for select to authenticated
using (
  membership_id in (select private.own_membership_ids())
  or organization_id in (select private.permitted_org_ids('users.view'))
);

create policy membership_operation_scopes_insert on public.membership_operation_scopes for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.manage_operation_scope')));

create policy membership_operation_scopes_delete on public.membership_operation_scopes for delete to authenticated
using (organization_id in (select private.permitted_org_ids('users.manage_operation_scope')));

-- -----------------------------------------------------------------------------
-- access_profile_mappings
-- -----------------------------------------------------------------------------
create policy access_profile_mappings_select on public.access_profile_mappings for select to authenticated
using (organization_id in (select private.permitted_org_ids('users.view')));

create policy access_profile_mappings_insert on public.access_profile_mappings for insert to authenticated
with check (organization_id in (select private.permitted_org_ids('users.manage_roles')));

create policy access_profile_mappings_update on public.access_profile_mappings for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.manage_roles')))
with check (organization_id in (select private.permitted_org_ids('users.manage_roles')));

create policy access_profile_mappings_delete on public.access_profile_mappings for delete to authenticated
using (organization_id in (select private.permitted_org_ids('users.manage_roles')));

-- -----------------------------------------------------------------------------
-- Import staging — one permission gates the whole pipeline, because a staged
-- row is a spreadsheet full of personal data.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['import_batches', 'import_rows', 'import_errors'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
      using (organization_id in (select private.permitted_org_ids('users.import')))$f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (organization_id in (select private.permitted_org_ids('users.import')))$f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$s for delete to authenticated
      using (organization_id in (select private.permitted_org_ids('users.import')))$f$, t);
  end loop;
end
$$;

create policy import_batches_update on public.import_batches for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.import')))
with check (organization_id in (select private.permitted_org_ids('users.import')));

create policy import_rows_update on public.import_rows for update to authenticated
using (organization_id in (select private.permitted_org_ids('users.import')))
with check (organization_id in (select private.permitted_org_ids('users.import')));
