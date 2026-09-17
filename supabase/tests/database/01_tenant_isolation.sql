-- =============================================================================
-- 01 · Tenant isolation
--   User A -> Org A, User B -> Org B, User C -> no membership.
--   A sees A, A does not see B, B sees B, B does not see A, C sees nothing.
--   Inactive membership / suspended organization grant nothing. anon gets nothing.
-- =============================================================================
begin;
\ir ../helpers/_helpers.sql

create temp table t_ctx as
select pg_temp.t_user('hfm-test-a@example.test', 'User A') as user_a,
       pg_temp.t_user('hfm-test-b@example.test', 'User B') as user_b,
       pg_temp.t_user('hfm-test-c@example.test', 'User C') as user_c;
grant select on t_ctx to authenticated, anon;

-- organizations bootstrapped from a privileged (direct SQL) context
alter table t_ctx add column org_a uuid, add column org_b uuid;
update t_ctx set org_a = public.create_organization('Org A', 'org-a-test', user_a),
                 org_b = public.create_organization('Org B', 'org-b-test', user_b);

-- master data in both tenants (as owner, through RLS)
select pg_temp.t_as((select user_a from t_ctx));
insert into public.organization_units (organization_id, code, name)
  select org_a, 'ua1', 'Unit A1' from t_ctx;
insert into public.cost_centers (organization_id, code, name)
  select org_a, 'cc-a1', 'CC A1' from t_ctx;
insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id)
  select org_a, 'A-001', 'abc1d23', (select id from public.vehicle_types where code = 'car') from t_ctx;
insert into public.drivers (organization_id, employee_code, full_name)
  select org_a, 'EA1', 'Driver A' from t_ctx;

select pg_temp.t_as((select user_b from t_ctx));
insert into public.organization_units (organization_id, code, name)
  select org_b, 'ub1', 'Unit B1' from t_ctx;
insert into public.cost_centers (organization_id, code, name)
  select org_b, 'cc-b1', 'CC B1' from t_ctx;
insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id)
  select org_b, 'B-001', 'xyz9e87', (select id from public.vehicle_types where code = 'truck') from t_ctx;
insert into public.drivers (organization_id, employee_code, full_name)
  select org_b, 'EB1', 'Driver B' from t_ctx;

-- ---------------------------------------------------------------- A sees A only
select pg_temp.t_as((select user_a from t_ctx));
select pg_temp.t_check('A: organizations -> only A',
  (select count(*) = 1 and bool_and(id = (select org_a from t_ctx)) from public.organizations));
select pg_temp.t_check('A: organization_settings -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_settings));
select pg_temp.t_check('A: organization_units -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_units));
select pg_temp.t_check('A: cost_centers -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.cost_centers));
select pg_temp.t_check('A: vehicles -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.vehicles));
select pg_temp.t_check('A: vehicle_status_history -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.vehicle_status_history));
select pg_temp.t_check('A: drivers -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.drivers));
select pg_temp.t_check('A: memberships -> only A',
  (select count(*) = 1 and bool_and(organization_id = (select org_a from t_ctx)) from public.organization_memberships));
select pg_temp.t_check('A: membership_roles -> only own',
  (select count(*) = 1 from public.membership_roles));
select pg_temp.t_check('A: audit_logs -> only A',
  (select count(*) > 0 and bool_and(organization_id = (select org_a from t_ctx)) from public.audit_logs));
select pg_temp.t_check('A: profiles -> self only (no shared org with B/C)',
  (select count(*) = 1 and bool_and(user_id = (select user_a from t_ctx)) from public.profiles));
select pg_temp.t_check('A: cannot read B vehicle by id',
  (select count(*) = 0 from public.vehicles where fleet_code = 'B-001'));
select pg_temp.t_rows('A: cannot update B vehicle (0 rows)',
  'update public.vehicles set fleet_code = ''HACK'' where fleet_code = ''B-001''', 0);
select pg_temp.t_throws('A: cannot insert vehicle into B',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''A-HACK'', (select id from public.vehicle_types limit 1))', (select org_b from t_ctx)), '42501');
select pg_temp.t_throws('A: cannot insert unit into B',
  format('insert into public.organization_units (organization_id, name) values (%L, ''hack'')', (select org_b from t_ctx)), '42501');
select pg_temp.t_check('A: current_user_permissions(A) includes vehicles.view',
  (select 'vehicles.view' = any(array(select public.current_user_permissions((select org_a from t_ctx))))));
select pg_temp.t_check('A: current_user_permissions(B) is empty',
  (select count(*) = 0 from public.current_user_permissions((select org_b from t_ctx))));
select pg_temp.t_check('A: outbox_events not readable',
  (select not has_table_privilege('authenticated', 'public.outbox_events', 'SELECT')));

-- ---------------------------------------------------------------- B sees B only
select pg_temp.t_as((select user_b from t_ctx));
select pg_temp.t_check('B: organizations -> only B',
  (select count(*) = 1 and bool_and(id = (select org_b from t_ctx)) from public.organizations));
select pg_temp.t_check('B: vehicles -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.vehicles));
select pg_temp.t_check('B: drivers -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.drivers));
select pg_temp.t_check('B: units -> only B',
  (select count(*) = 1 and bool_and(organization_id = (select org_b from t_ctx)) from public.organization_units));
select pg_temp.t_check('B: audit_logs -> only B',
  (select count(*) > 0 and bool_and(organization_id = (select org_b from t_ctx)) from public.audit_logs));
select pg_temp.t_check('B: cannot read A vehicle',
  (select count(*) = 0 from public.vehicles where fleet_code = 'A-001'));

-- ---------------------------------------------------------------- C sees nothing
select pg_temp.t_as((select user_c from t_ctx));
select pg_temp.t_check('C: organizations empty', (select count(*) = 0 from public.organizations));
select pg_temp.t_check('C: vehicles empty',      (select count(*) = 0 from public.vehicles));
select pg_temp.t_check('C: drivers empty',       (select count(*) = 0 from public.drivers));
select pg_temp.t_check('C: units empty',         (select count(*) = 0 from public.organization_units));
select pg_temp.t_check('C: memberships empty',   (select count(*) = 0 from public.organization_memberships));
select pg_temp.t_check('C: audit empty',         (select count(*) = 0 from public.audit_logs));
select pg_temp.t_check('C: profiles -> self only',
  (select count(*) = 1 and bool_and(user_id = (select user_c from t_ctx)) from public.profiles));
select pg_temp.t_check('C: can read global catalogs (permissions, vehicle_types, global roles)',
  (select (select count(*) from public.permissions) > 0
      and (select count(*) from public.vehicle_types) > 0
      and (select count(*) from public.roles) = 5));
select pg_temp.t_throws('C: cannot create organization',
  'select public.create_organization(''Org C'', ''org-c-test'')', '42501');
select pg_temp.t_throws('C: cannot insert own membership into A',
  format('insert into public.organization_memberships (organization_id, user_id, status) values (%L, %L, ''active'')',
         (select org_a from t_ctx), (select user_c from t_ctx)), '42501');

-- ---------------------------------------------------------------- inactive membership
select pg_temp.t_reset();
update public.organization_memberships set status = 'suspended'
 where user_id = (select user_a from t_ctx);
select pg_temp.t_as((select user_a from t_ctx));
select pg_temp.t_check('A suspended: organizations empty', (select count(*) = 0 from public.organizations));
select pg_temp.t_check('A suspended: vehicles empty',      (select count(*) = 0 from public.vehicles));
select pg_temp.t_check('A suspended: still sees own membership row',
  (select count(*) = 1 from public.organization_memberships));
select pg_temp.t_reset();
update public.organization_memberships set status = 'active'
 where user_id = (select user_a from t_ctx);

-- ---------------------------------------------------------------- suspended organization
update public.organizations set status = 'suspended' where id = (select org_a from t_ctx);
select pg_temp.t_as((select user_a from t_ctx));
select pg_temp.t_check('Org A suspended: vehicles empty', (select count(*) = 0 from public.vehicles));
select pg_temp.t_check('Org A suspended: organizations empty', (select count(*) = 0 from public.organizations));
select pg_temp.t_reset();
update public.organizations set status = 'active' where id = (select org_a from t_ctx);

-- ---------------------------------------------------------------- blocked profile
update public.profiles set status = 'blocked' where user_id = (select user_a from t_ctx);
select pg_temp.t_as((select user_a from t_ctx));
select pg_temp.t_check('A blocked profile: vehicles empty', (select count(*) = 0 from public.vehicles));
select pg_temp.t_reset();
update public.profiles set status = 'active' where user_id = (select user_a from t_ctx);

-- ---------------------------------------------------------------- anon
select pg_temp.t_as_anon();
select pg_temp.t_throws('anon: no select on vehicles',      'select count(*) from public.vehicles', '42501');
select pg_temp.t_throws('anon: no select on organizations', 'select count(*) from public.organizations', '42501');
select pg_temp.t_throws('anon: no select on permissions',   'select count(*) from public.permissions', '42501');
select pg_temp.t_throws('anon: cannot call create_organization',
  'select public.create_organization(''x'', ''x-anon'')', '42501');
select pg_temp.t_throws('anon: cannot call private helpers',
  'select private.is_platform_admin()', '42501');

select pg_temp.t_reset();
select * from pg_temp.t_tap();
rollback;
