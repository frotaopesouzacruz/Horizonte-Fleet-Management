-- =============================================================================
-- 01 · Tenant isolation
--   User A -> Org A, User B -> Org B, User C -> no membership.
--   A sees A, A does not see B, B sees B, B does not see A, C sees nothing.
--   Inactive membership, suspended organization and blocked profile grant
--   nothing. anon reaches nothing at all.
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-test-a@example.test', 'User A') as user_a,
       tests.new_user('hfm-test-b@example.test', 'User B') as user_b,
       tests.new_user('hfm-test-c@example.test', 'User C') as user_c;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx add column org_a uuid, add column org_b uuid;
update t_ctx set org_a = public.create_organization('Org A', 'org-a-test', user_a),
                 org_b = public.create_organization('Org B', 'org-b-test', user_b);

-- master data created by each owner, through RLS
select tests.as_user((select user_a from t_ctx));
insert into public.organization_units (organization_id, code, name)
  select org_a, 'ua1', 'Unit A1' from t_ctx;
insert into public.cost_centers (organization_id, code, name)
  select org_a, 'cc-a1', 'CC A1' from t_ctx;
insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id)
  select org_a, 'A-001', 'abc1d23', (select id from public.vehicle_types where code = 'car') from t_ctx;
insert into public.drivers (organization_id, employee_code, full_name)
  select org_a, 'EA1', 'Driver A' from t_ctx;

select tests.as_user((select user_b from t_ctx));
insert into public.organization_units (organization_id, code, name)
  select org_b, 'ub1', 'Unit B1' from t_ctx;
insert into public.cost_centers (organization_id, code, name)
  select org_b, 'cc-b1', 'CC B1' from t_ctx;
insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id)
  select org_b, 'B-001', 'xyz9e87', (select id from public.vehicle_types where code = 'truck') from t_ctx;
insert into public.drivers (organization_id, employee_code, full_name)
  select org_b, 'EB1', 'Driver B' from t_ctx;

-- ------------------------------------------------------------- A sees A only
select tests.as_user((select user_a from t_ctx));
select tests.check('A: organizations -> only A',
  (select count(*) = 1 and bool_and(id = (select org_a from t_ctx)) from public.organizations));
select tests.check('A: organization_settings -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_settings));
select tests.check('A: organization_units -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_units));
select tests.check('A: cost_centers -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.cost_centers));
select tests.check('A: vehicles -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.vehicles));
select tests.check('A: vehicle_status_history -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.vehicle_status_history));
select tests.check('A: drivers -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.drivers));
select tests.check('A: memberships -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_memberships));
select tests.check('A: membership_roles -> only own',
  (select count(*) = 1 from public.membership_roles));
select tests.check('A: audit_logs -> only A',
  (select count(*) > 0 and bool_and(organization_id = (select org_a from t_ctx)) from public.audit_logs));
select tests.check('A: profiles -> self only',
  (select count(*) = 1 and bool_and(user_id = (select user_a from t_ctx)) from public.profiles));
select tests.check('A: cannot read B vehicle',
  (select count(*) = 0 from public.vehicles where fleet_code = 'B-001'));
select tests.rows_affected('A: cannot update B vehicle (0 rows)',
  'update public.vehicles set fleet_code = ''HACK'' where fleet_code = ''B-001''', 0);
select tests.throws('A: cannot insert vehicle into B',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''A-HACK'', (select id from public.vehicle_types limit 1))', (select org_b from t_ctx)), '42501');
select tests.throws('A: cannot insert unit into B',
  format('insert into public.organization_units (organization_id, name) values (%L, ''hack'')', (select org_b from t_ctx)), '42501');
select tests.check('A: current_user_permissions(A) includes vehicles.view',
  (select 'vehicles.view' = any(array(select public.current_user_permissions((select org_a from t_ctx))))));
select tests.check('A: current_user_permissions(B) is empty',
  (select count(*) = 0 from public.current_user_permissions((select org_b from t_ctx))));
select tests.check('A: outbox_events not readable',
  (select not has_table_privilege('authenticated', 'public.outbox_events', 'SELECT')));

-- ------------------------------------------------------------- B sees B only
select tests.as_user((select user_b from t_ctx));
select tests.check('B: organizations -> only B',
  (select count(*) = 1 and bool_and(id = (select org_b from t_ctx)) from public.organizations));
select tests.check('B: vehicles -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.vehicles));
select tests.check('B: drivers -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.drivers));
select tests.check('B: units -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.organization_units));
select tests.check('B: audit_logs -> only B',
  (select count(*) > 0 and bool_and(organization_id = (select org_b from t_ctx)) from public.audit_logs));
select tests.check('B: cannot read A vehicle',
  (select count(*) = 0 from public.vehicles where fleet_code = 'A-001'));

-- ------------------------------------------------------------- C sees nothing
select tests.as_user((select user_c from t_ctx));
select tests.check('C: organizations empty', (select count(*) = 0 from public.organizations));
select tests.check('C: vehicles empty',      (select count(*) = 0 from public.vehicles));
select tests.check('C: drivers empty',       (select count(*) = 0 from public.drivers));
select tests.check('C: units empty',         (select count(*) = 0 from public.organization_units));
select tests.check('C: memberships empty',   (select count(*) = 0 from public.organization_memberships));
select tests.check('C: audit empty',         (select count(*) = 0 from public.audit_logs));
select tests.check('C: profiles -> self only',
  (select count(*) = 1 and bool_and(user_id = (select user_c from t_ctx)) from public.profiles));
select tests.check('C: global catalogs readable',
  (select (select count(*) from public.permissions) > 0
      and (select count(*) from public.vehicle_types) > 0
      and (select count(*) from public.roles) = 5));
select tests.throws('C: cannot create organization',
  'select public.create_organization(''Org C'', ''org-c-test'')', '42501');
select tests.throws('C: cannot insert own membership into A',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org_a from t_ctx), (select user_c from t_ctx)), '42501');

-- --------------------------------------------------- inactive membership
select tests.reset();
update public.organization_memberships set status = 'suspended' where user_id = (select user_a from t_ctx);
select tests.as_user((select user_a from t_ctx));
select tests.check('A suspended: organizations empty', (select count(*) = 0 from public.organizations));
select tests.check('A suspended: vehicles empty',      (select count(*) = 0 from public.vehicles));
select tests.check('A suspended: still sees own membership row',
  (select count(*) = 1 from public.organization_memberships));
select tests.reset();
update public.organization_memberships set status = 'active' where user_id = (select user_a from t_ctx);

-- --------------------------------------------------- suspended organization
update public.organizations set status = 'suspended' where id = (select org_a from t_ctx);
select tests.as_user((select user_a from t_ctx));
select tests.check('Org A suspended: vehicles empty', (select count(*) = 0 from public.vehicles));
select tests.check('Org A suspended: organizations empty', (select count(*) = 0 from public.organizations));
select tests.reset();
update public.organizations set status = 'active' where id = (select org_a from t_ctx);

-- --------------------------------------------------- blocked profile
update public.profiles set status = 'blocked' where user_id = (select user_a from t_ctx);
select tests.as_user((select user_a from t_ctx));
select tests.check('A blocked profile: vehicles empty', (select count(*) = 0 from public.vehicles));
select tests.reset();
update public.profiles set status = 'active' where user_id = (select user_a from t_ctx);

-- --------------------------------------------------- anon
select tests.as_anon();
select tests.throws('anon: no select on vehicles',      'select count(*) from public.vehicles', '42501');
select tests.throws('anon: no select on organizations', 'select count(*) from public.organizations', '42501');
select tests.throws('anon: no select on permissions',   'select count(*) from public.permissions', '42501');
select tests.throws('anon: cannot call create_organization',
  'select public.create_organization(''x'', ''x-anon'')', '42501');
select tests.throws('anon: cannot call private helpers', 'select private.is_platform_admin()', '42501');

select tests.reset();
select * from tests.report();
rollback;
