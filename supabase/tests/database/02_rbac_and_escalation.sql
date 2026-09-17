-- =============================================================================
-- 02 · RBAC and privilege escalation
--   Roles grant permissions; users without permission are blocked; nobody can
--   promote themselves (membership, roles, permissions, platform admin, profile).
-- =============================================================================
begin;
\ir ../helpers/_helpers.sql

create temp table t_ctx as
select pg_temp.t_user('hfm-rbac-admin@example.test')    as admin_u,
       pg_temp.t_user('hfm-rbac-viewer@example.test')   as viewer_u,
       pg_temp.t_user('hfm-rbac-operator@example.test') as operator_u,
       pg_temp.t_user('hfm-rbac-fleet@example.test')    as fleet_u,
       pg_temp.t_user('hfm-rbac-hr@example.test')       as hr_u,
       pg_temp.t_user('hfm-rbac-outsider@example.test') as outsider_u;
grant select on t_ctx to authenticated, anon;
alter table t_ctx add column org uuid, add column org2 uuid;
update t_ctx set org  = public.create_organization('RBAC Org',  'rbac-org-test',  admin_u),
                 org2 = public.create_organization('Other Org', 'rbac-org2-test', outsider_u);

-- privileged setup: memberships + roles for viewer / operator / fleet_manager
insert into public.organization_memberships (organization_id, user_id, status)
  select org, u, 'active' from t_ctx, unnest(array[viewer_u, operator_u, fleet_u, hr_u]) as u;
insert into public.membership_roles (membership_id, role_id)
  select m.id, r.id
  from public.organization_memberships m
  join t_ctx c on c.org = m.organization_id
  join public.roles r on r.organization_id is null
   and r.code = case m.user_id when c.viewer_u then 'viewer' when c.operator_u then 'operator'
                                when c.fleet_u then 'fleet_manager' end
  where m.user_id in (c.viewer_u, c.operator_u, c.fleet_u);
-- custom role for HR: manages members and roles, but has NO vehicle permissions
insert into public.roles (organization_id, code, name) select org, 'hr', 'HR' from t_ctx;
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p, t_ctx c
  where r.organization_id = c.org and r.code = 'hr'
    and p.code in ('members.view', 'members.manage', 'roles.view', 'roles.manage', 'organization.view');
insert into public.membership_roles (membership_id, role_id)
  select m.id, r.id from public.organization_memberships m join t_ctx c on c.org = m.organization_id
  join public.roles r on r.organization_id = c.org and r.code = 'hr'
  where m.user_id = c.hr_u;

create temp table t_types as select id as car from public.vehicle_types where code = 'car';
grant select on t_types to authenticated;

-- ---------------------------------------------------------------- viewer
select pg_temp.t_as((select viewer_u from t_ctx));
select pg_temp.t_check('viewer: sees organization', (select count(*) = 1 from public.organizations));
select pg_temp.t_throws('viewer: cannot create vehicle',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''V1'', (select car from t_types))', (select org from t_ctx)), '42501');
select pg_temp.t_throws('viewer: cannot create unit',
  format('insert into public.organization_units (organization_id, name) values (%L, ''U'')', (select org from t_ctx)), '42501');
select pg_temp.t_check('viewer: cannot see memberships of others (no members.view)',
  (select count(*) = 1 from public.organization_memberships));
select pg_temp.t_check('viewer: audit not visible (no audit.view)',
  (select count(*) = 0 from public.audit_logs));
select pg_temp.t_rows('viewer: cannot update organization (0 rows)',
  format('update public.organizations set name = ''hack'' where id = %L', (select org from t_ctx)), 0);

-- ---------------------------------------------------------------- operator
select pg_temp.t_as((select operator_u from t_ctx));
select pg_temp.t_lives('operator: can create vehicle',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''OP-1'', ''OPR1A23'', (select car from t_types))', (select org from t_ctx)));
select pg_temp.t_lives('operator: can update vehicle',
  'update public.vehicles set model_year = 2024, manufacture_year = 2024 where fleet_code = ''OP-1''');
select pg_temp.t_throws('operator: cannot archive vehicle (needs vehicles.archive)',
  'update public.vehicles set deleted_at = now() where fleet_code = ''OP-1''', '42501');
select pg_temp.t_lives('operator: can create driver',
  format('insert into public.drivers (organization_id, full_name) values (%L, ''Driver Op'')', (select org from t_ctx)));
select pg_temp.t_throws('operator: cannot create unit',
  format('insert into public.organization_units (organization_id, name) values (%L, ''U'')', (select org from t_ctx)), '42501');
select pg_temp.t_throws('operator: cannot add own membership to other org',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org2 from t_ctx), (select operator_u from t_ctx)), '42501');
select pg_temp.t_throws('operator: cannot assign org_admin to self',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.user_id = %L and r.code = ''org_admin''',
         (select operator_u from t_ctx)), '42501');
select pg_temp.t_throws('operator: cannot insert platform_admins',
  format('insert into public.platform_admins (user_id) values (%L)', (select operator_u from t_ctx)), '42501');
select pg_temp.t_throws('operator: cannot update own profile status',
  'update public.profiles set status = ''blocked'' where user_id = auth.uid()', '42501');
select pg_temp.t_lives('operator: can update own display_name',
  'update public.profiles set display_name = ''Op'' where user_id = auth.uid()');
select pg_temp.t_rows('operator: cannot update other profile (0 rows)',
  format('update public.profiles set display_name = ''x'' where user_id = %L', (select viewer_u from t_ctx)), 0);
select pg_temp.t_throws('operator: cannot call create_organization',
  'select public.create_organization(''X'', ''x-op-test'')', '42501');
select pg_temp.t_check('operator: hard delete not granted',
  (select not has_table_privilege('authenticated', 'public.vehicles', 'DELETE')));
select pg_temp.t_check('operator: cannot see platform_admins', (select count(*) = 0 from public.platform_admins));

-- ---------------------------------------------------------------- fleet manager
select pg_temp.t_as((select fleet_u from t_ctx));
select pg_temp.t_lives('fleet_manager: can archive vehicle',
  'update public.vehicles set deleted_at = now() where fleet_code = ''OP-1''');
select pg_temp.t_check('fleet_manager: sees archived vehicle with deleted_by stamped',
  (select count(*) = 1 from public.vehicles where fleet_code = 'OP-1' and deleted_at is not null and deleted_by = auth.uid()));
select pg_temp.t_lives('fleet_manager: can create unit',
  format('insert into public.organization_units (organization_id, code, name) values (%L, ''fm1'', ''FM Unit'')', (select org from t_ctx)));
select pg_temp.t_check('fleet_manager: sees audit (audit.view)', (select count(*) > 0 from public.audit_logs));
select pg_temp.t_throws('fleet_manager: cannot create custom role (no roles.manage)',
  format('insert into public.roles (organization_id, code, name) values (%L, ''x'', ''X'')', (select org from t_ctx)), '42501');
select pg_temp.t_throws('fleet_manager: cannot invite members (no members.manage)',
  format('insert into public.organization_memberships (organization_id, user_id) values (%L, %L)',
         (select org from t_ctx), (select outsider_u from t_ctx)), '42501');

-- operator no longer sees archived vehicle
select pg_temp.t_as((select operator_u from t_ctx));
select pg_temp.t_check('operator: archived vehicle hidden (no vehicles.archive)',
  (select count(*) = 0 from public.vehicles where fleet_code = 'OP-1'));

-- ---------------------------------------------------------------- HR (custom role): members + roles, no vehicles
select pg_temp.t_as((select hr_u from t_ctx));
select pg_temp.t_check('hr: vehicles hidden (no vehicles.view)', (select count(*) = 0 from public.vehicles));
select pg_temp.t_lives('hr: can invite outsider',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org from t_ctx), (select outsider_u from t_ctx)));
select pg_temp.t_lives('hr: can assign viewer role to outsider',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''viewer'' and r.organization_id is null',
         (select org from t_ctx), (select outsider_u from t_ctx)));
select pg_temp.t_throws('hr: cannot assign a role to own membership (self-promotion)',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''org_admin''',
         (select org from t_ctx), (select hr_u from t_ctx)), '42501');
select pg_temp.t_lives('hr: can create custom role',
  format('insert into public.roles (organization_id, code, name) values (%L, ''auditor'', ''Auditor'')', (select org from t_ctx)));
select pg_temp.t_lives('hr: can grant a permission it holds (members.view) to custom role',
  format('insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.organization_id = %L and r.code = ''auditor'' and p.code = ''members.view''', (select org from t_ctx)));
select pg_temp.t_throws('hr: cannot grant a permission it does not hold (vehicles.archive) - escalation',
  format('insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.organization_id = %L and r.code = ''auditor'' and p.code = ''vehicles.archive''', (select org from t_ctx)), '42501');
select pg_temp.t_throws('hr: cannot add permissions to a global role',
  'insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.code = ''viewer'' and r.organization_id is null and p.code = ''audit.view''', null);
select pg_temp.t_rows('hr: cannot edit a global role (0 rows)',
  'update public.roles set name = ''hack'' where code = ''viewer'' and organization_id is null', 0);
select pg_temp.t_throws('hr: cannot create a custom role shadowing a global code',
  format('insert into public.roles (organization_id, code, name) values (%L, ''viewer'', ''Fake viewer'')', (select org from t_ctx)), '23505');
select pg_temp.t_throws('hr: cannot create a role in another organization',
  format('insert into public.roles (organization_id, code, name) values (%L, ''zz'', ''ZZ'')', (select org2 from t_ctx)), '42501');
select pg_temp.t_throws('hr: cannot assign a custom role of another org',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, (select id from public.roles where code = ''hr'' and organization_id = %L) from public.organization_memberships m where m.organization_id = %L and m.user_id = %L',
         (select org from t_ctx), (select org from t_ctx), (select outsider_u from t_ctx)), null);
select pg_temp.t_throws('hr: cannot move a membership to another org',
  format('update public.organization_memberships set organization_id = %L where user_id = %L',
         (select org2 from t_ctx), (select outsider_u from t_ctx)), null);

-- ---------------------------------------------------------------- admin removes outsider -> access gone
select pg_temp.t_as((select admin_u from t_ctx));
select pg_temp.t_lives('admin: can suspend outsider',
  format('update public.organization_memberships set status = ''suspended'' where organization_id = %L and user_id = %L',
         (select org from t_ctx), (select outsider_u from t_ctx)));
select pg_temp.t_as((select outsider_u from t_ctx));
select pg_temp.t_check('outsider suspended: sees only own org2',
  (select count(*) = 1 and bool_and(id = (select org2 from t_ctx)) from public.organizations));

select pg_temp.t_reset();
select * from pg_temp.t_tap();
rollback;
