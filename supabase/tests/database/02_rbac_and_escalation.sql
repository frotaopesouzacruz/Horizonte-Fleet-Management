-- =============================================================================
-- 02 · RBAC and privilege escalation
--   Roles grant permissions; a user without the permission is blocked; nobody
--   can promote themselves or hand out more power than they hold.
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-rbac-admin@example.test')    as admin_u,
       tests.new_user('hfm-rbac-viewer@example.test')   as viewer_u,
       tests.new_user('hfm-rbac-operator@example.test') as operator_u,
       tests.new_user('hfm-rbac-fleet@example.test')    as fleet_u,
       tests.new_user('hfm-rbac-hr@example.test')       as hr_u,
       tests.new_user('hfm-rbac-outsider@example.test') as outsider_u;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx add column org uuid, add column org2 uuid, add column car uuid;
update t_ctx set org  = public.create_organization('RBAC Org',  'rbac-org-test',  admin_u),
                 org2 = public.create_organization('Other Org', 'rbac-org2-test', outsider_u),
                 car  = (select id from public.vehicle_types where code = 'car');

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

-- custom role: manages members and roles, holds no vehicle permission
insert into public.roles (organization_id, code, name) select org, 'hr', 'HR' from t_ctx;
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r, public.permissions p, t_ctx c
  where r.organization_id = c.org and r.code = 'hr'
    and p.code in ('members.view','members.manage','roles.view','roles.manage','organization.view');
insert into public.membership_roles (membership_id, role_id)
  select m.id, r.id from public.organization_memberships m join t_ctx c on c.org = m.organization_id
  join public.roles r on r.organization_id = c.org and r.code = 'hr'
  where m.user_id = c.hr_u;

-- ------------------------------------------------------------------- viewer
select tests.as_user((select viewer_u from t_ctx));
select tests.check('viewer: sees organization', (select count(*) = 1 from public.organizations));
select tests.throws('viewer: cannot create vehicle',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''V1'', %L)', (select org from t_ctx), (select car from t_ctx)), '42501');
select tests.throws('viewer: cannot create unit',
  format('insert into public.organization_units (organization_id, name) values (%L, ''U'')', (select org from t_ctx)), '42501');
select tests.check('viewer: cannot list other memberships', (select count(*) = 1 from public.organization_memberships));
select tests.check('viewer: audit hidden', (select count(*) = 0 from public.audit_logs));
select tests.rows_affected('viewer: cannot update organization (0 rows)',
  format('update public.organizations set name = ''hack'' where id = %L', (select org from t_ctx)), 0);

-- ----------------------------------------------------------------- operator
select tests.as_user((select operator_u from t_ctx));
select tests.lives('operator: can create vehicle',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''OP-1'', ''OPR1A23'', %L)', (select org from t_ctx), (select car from t_ctx)));
select tests.lives('operator: can update vehicle',
  'update public.vehicles set model_year = 2024, manufacture_year = 2024 where fleet_code = ''OP-1''');
select tests.throws('operator: cannot archive vehicle',
  'update public.vehicles set deleted_at = now() where fleet_code = ''OP-1''', '42501');
select tests.lives('operator: can create driver',
  format('insert into public.drivers (organization_id, full_name) values (%L, ''Driver Op'')', (select org from t_ctx)));
select tests.throws('operator: cannot create unit',
  format('insert into public.organization_units (organization_id, name) values (%L, ''U'')', (select org from t_ctx)), '42501');
select tests.throws('operator: cannot add own membership elsewhere',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org2 from t_ctx), (select operator_u from t_ctx)), '42501');
select tests.throws('operator: cannot assign org_admin to self',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.user_id = %L and r.code = ''org_admin'' and r.organization_id is null', (select operator_u from t_ctx)), '42501');
select tests.throws('operator: cannot insert platform_admins',
  format('insert into public.platform_admins (user_id) values (%L)', (select operator_u from t_ctx)), '42501');
select tests.throws('operator: cannot change own profile status',
  'update public.profiles set status = ''blocked'' where user_id = auth.uid()', '42501');
select tests.lives('operator: can update own display_name',
  'update public.profiles set display_name = ''Op'' where user_id = auth.uid()');
select tests.rows_affected('operator: cannot update another profile (0 rows)',
  format('update public.profiles set display_name = ''x'' where user_id = %L', (select viewer_u from t_ctx)), 0);
select tests.throws('operator: cannot call create_organization',
  'select public.create_organization(''X'', ''x-op-test'')', '42501');
select tests.check('operator: no DELETE privilege on vehicles',
  (select not has_table_privilege('authenticated', 'public.vehicles', 'DELETE')));
select tests.check('operator: no TRUNCATE privilege on vehicles',
  (select not has_table_privilege('authenticated', 'public.vehicles', 'TRUNCATE')));
select tests.check('operator: platform_admins hidden', (select count(*) = 0 from public.platform_admins));

-- ------------------------------------------------------------ fleet manager
select tests.as_user((select fleet_u from t_ctx));
select tests.lives('fleet_manager: can archive vehicle',
  'update public.vehicles set deleted_at = now() where fleet_code = ''OP-1''');
select tests.check('fleet_manager: archived row stamped with deleted_by',
  (select count(*) = 1 from public.vehicles where fleet_code = 'OP-1' and deleted_at is not null and deleted_by = auth.uid()));
select tests.lives('fleet_manager: can create unit',
  format('insert into public.organization_units (organization_id, code, name) values (%L, ''fm1'', ''FM Unit'')', (select org from t_ctx)));
select tests.check('fleet_manager: sees audit', (select count(*) > 0 from public.audit_logs));
select tests.throws('fleet_manager: cannot create custom role',
  format('insert into public.roles (organization_id, code, name) values (%L, ''x1'', ''X'')', (select org from t_ctx)), '42501');
select tests.throws('fleet_manager: cannot invite members',
  format('insert into public.organization_memberships (organization_id, user_id) values (%L, %L)',
         (select org from t_ctx), (select outsider_u from t_ctx)), '42501');

select tests.as_user((select operator_u from t_ctx));
select tests.check('operator: archived vehicle hidden',
  (select count(*) = 0 from public.vehicles where fleet_code = 'OP-1'));

-- ------------------------------------------- custom role (members + roles only)
select tests.as_user((select hr_u from t_ctx));
select tests.check('hr: vehicles hidden', (select count(*) = 0 from public.vehicles));
select tests.lives('hr: can invite outsider',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org from t_ctx), (select outsider_u from t_ctx)));
select tests.throws('hr: cannot grant viewer role it does not hold (escalation)',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''viewer'' and r.organization_id is null',
         (select org from t_ctx), (select outsider_u from t_ctx)), '42501');
select tests.throws('hr: cannot grant org_admin to another member (escalation)',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''org_admin'' and r.organization_id is null',
         (select org from t_ctx), (select outsider_u from t_ctx)), '42501');
select tests.lives('hr: can grant its own hr role to another member',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.organization_id = %L and r.code = ''hr''',
         (select org from t_ctx), (select outsider_u from t_ctx), (select org from t_ctx)));
select tests.throws('hr: cannot assign a role to own membership (self-promotion)',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''org_admin'' and r.organization_id is null',
         (select org from t_ctx), (select hr_u from t_ctx)), '42501');
select tests.lives('hr: can create custom role',
  format('insert into public.roles (organization_id, code, name) values (%L, ''auditor'', ''Auditor'')', (select org from t_ctx)));
select tests.lives('hr: can grant a permission it holds',
  format('insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.organization_id = %L and r.code = ''auditor'' and p.code = ''members.view''', (select org from t_ctx)));
select tests.throws('hr: cannot grant a permission it does not hold (escalation)',
  format('insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.organization_id = %L and r.code = ''auditor'' and p.code = ''vehicles.archive''', (select org from t_ctx)), '42501');
select tests.throws('hr: cannot add permissions to a global role',
  'insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.code = ''viewer'' and r.organization_id is null and p.code = ''audit.view''', null);
select tests.rows_affected('hr: cannot edit a global role (0 rows)',
  'update public.roles set name = ''hack'' where code = ''viewer'' and organization_id is null', 0);
select tests.throws('hr: cannot shadow a global role code',
  format('insert into public.roles (organization_id, code, name) values (%L, ''viewer'', ''Fake viewer'')', (select org from t_ctx)), '23505');
select tests.throws('hr: cannot create a role in another organization',
  format('insert into public.roles (organization_id, code, name) values (%L, ''zz'', ''ZZ'')', (select org2 from t_ctx)), '42501');
select tests.throws('hr: cannot move a membership to another org',
  format('update public.organization_memberships set organization_id = %L where user_id = %L',
         (select org2 from t_ctx), (select outsider_u from t_ctx)), null);
select tests.throws('hr: cannot freeze a role via is_editable',
  format('update public.roles set is_editable = false where organization_id = %L and code = ''auditor''', (select org from t_ctx)), '42501');

-- -------------------------------------------------------------------- admin
select tests.as_user((select admin_u from t_ctx));
select tests.lives('admin: can suspend outsider',
  format('update public.organization_memberships set status = ''suspended'' where organization_id = %L and user_id = %L',
         (select org from t_ctx), (select outsider_u from t_ctx)));
select tests.lives('admin: can assign org_admin (holds every permission)',
  format('insert into public.membership_roles (membership_id, role_id) select m.id, r.id from public.organization_memberships m, public.roles r where m.organization_id = %L and m.user_id = %L and r.code = ''org_admin'' and r.organization_id is null',
         (select org from t_ctx), (select viewer_u from t_ctx)));
select tests.as_user((select outsider_u from t_ctx));
select tests.check('outsider suspended: only own org2 visible',
  (select count(*) = 1 and bool_and(id = (select org2 from t_ctx)) from public.organizations));

-- ----------------------------------------------- role revocation on lifecycle
select tests.reset();
update public.organization_memberships set status = 'removed'
 where organization_id = (select org from t_ctx) and user_id = (select outsider_u from t_ctx);
select tests.check('removed membership drops its role assignments',
  (select count(*) = 0 from public.membership_roles mr
    join public.organization_memberships m on m.id = mr.membership_id
   where m.organization_id = (select org from t_ctx) and m.user_id = (select outsider_u from t_ctx)));
update public.roles set deleted_at = now() where organization_id = (select org from t_ctx) and code = 'hr';
select tests.check('archiving a role revokes it from every membership',
  (select count(*) = 0 from public.membership_roles mr join public.roles r on r.id = mr.role_id
    where r.organization_id = (select org from t_ctx) and r.code = 'hr'));

select * from tests.report();
rollback;
