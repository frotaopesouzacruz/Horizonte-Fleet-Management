-- =============================================================================
-- 03 · Integrity, uniqueness, cross-tenant references and soft delete
-- =============================================================================
begin;
\ir ../helpers/_helpers.sql

create temp table t_ctx as
select pg_temp.t_user('hfm-int-a@example.test') as user_a,
       pg_temp.t_user('hfm-int-b@example.test') as user_b;
grant select on t_ctx to authenticated;
alter table t_ctx add column org_a uuid, add column org_b uuid, add column car uuid;
update t_ctx set org_a = public.create_organization('Int A', 'int-a-test', user_a),
                 org_b = public.create_organization('Int B', 'int-b-test', user_b),
                 car   = (select id from public.vehicle_types where code = 'car');

-- ---------------------------------------------------------------- bootstrap invariants
select pg_temp.t_check('settings row auto-created (1:1)',
  (select count(*) = 2 from public.organization_settings where organization_id in (select org_a from t_ctx union select org_b from t_ctx)));
select pg_temp.t_check('owner membership active with joined_at',
  (select count(*) = 1 from public.organization_memberships where organization_id = (select org_a from t_ctx) and status = 'active' and joined_at is not null));
select pg_temp.t_check('owner holds org_admin',
  (select count(*) = 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id where r.code = 'org_admin'
     and mr.membership_id = (select id from public.organization_memberships where organization_id = (select org_a from t_ctx))));
select pg_temp.t_check('profile auto-created by auth trigger with full_name',
  (select count(*) = 1 from public.profiles where user_id = (select user_a from t_ctx) and full_name = 'hfm-int-a@example.test'));
select pg_temp.t_throws('duplicate slug rejected', 'select public.create_organization(''Dup'', ''int-a-test'', (select user_a from t_ctx))', '23505');
select pg_temp.t_throws('invalid slug rejected',   'select public.create_organization(''Bad'', ''Bad Slug!'', (select user_a from t_ctx))', '23514');
select pg_temp.t_throws('membership unique (org,user)',
  format('insert into public.organization_memberships (organization_id, user_id) values (%L, %L)', (select org_a from t_ctx), (select user_a from t_ctx)), '23505');
select pg_temp.t_throws('invalid status rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id, status) values (%L, ''S1'', (select car from t_ctx), ''flying'')', (select org_a from t_ctx)), '23514');
select pg_temp.t_throws('vehicle needs at least one identifier',
  format('insert into public.vehicles (organization_id, vehicle_type_id) values (%L, (select car from t_ctx))', (select org_a from t_ctx)), '23514');
select pg_temp.t_throws('model_year must be manufacture_year or +1',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id, manufacture_year, model_year) values (%L, ''Y1'', (select car from t_ctx), 2020, 2023)', (select org_a from t_ctx)), '23514');

-- ---------------------------------------------------------------- normalization + uniqueness (as org A admin)
select pg_temp.t_as((select user_a from t_ctx));
insert into public.vehicles (organization_id, fleet_code, license_plate, vin, renavam, vehicle_type_id)
  select org_a, ' a-01 ', 'abc-1d23', 'ngr7yl3zvmj0g2f4a'::text, '123.456.789-01', car from t_ctx;
select pg_temp.t_check('identifiers normalized (upper, no separators)',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and license_plate = 'ABC1D23' and vin = 'NGR7YL3ZVMJ0G2F4A' and renavam = '12345678901'));
select pg_temp.t_throws('duplicate plate in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-02'', ''ABC1D23'', (select car from t_ctx))', (select org_a from t_ctx)), '23505');
select pg_temp.t_throws('duplicate VIN in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vin, vehicle_type_id) values (%L, ''A-03'', ''NGR7YL3ZVMJ0G2F4A'', (select car from t_ctx))', (select org_a from t_ctx)), '23505');
select pg_temp.t_throws('duplicate fleet_code in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''a-01'', (select car from t_ctx))', (select org_a from t_ctx)), '23505');
select pg_temp.t_throws('VIN with letter O rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vin, vehicle_type_id) values (%L, ''A-04'', ''OGR7YL3ZVMJ0G2F4A'', (select car from t_ctx))', (select org_a from t_ctx)), '23514');
insert into public.organization_units (organization_id, code, name) select org_a, 'u1', 'Unit 1' from t_ctx;
select pg_temp.t_throws('duplicate unit code in same org rejected',
  format('insert into public.organization_units (organization_id, code, name) values (%L, ''U1'', ''Unit 1 again'')', (select org_a from t_ctx)), '23505');
insert into public.cost_centers (organization_id, organization_unit_id, code, name)
  select org_a, (select id from public.organization_units where code = 'U1'), 'cc1', 'CC 1' from t_ctx;
select pg_temp.t_lives('vehicle may reference own unit and cost center',
  format('insert into public.vehicles (organization_id, organization_unit_id, cost_center_id, fleet_code, vehicle_type_id) values (%L, (select id from public.organization_units where code = ''U1''), (select id from public.cost_centers where code = ''CC1''), ''A-05'', (select car from t_ctx))', (select org_a from t_ctx)));
insert into public.drivers (organization_id, employee_code, full_name) select org_a, 'e1', '  Driver One ' from t_ctx;
select pg_temp.t_check('driver normalized', (select count(*) = 1 from public.drivers where employee_code = 'E1' and full_name = 'Driver One'));
select pg_temp.t_throws('duplicate employee_code in same org rejected',
  format('insert into public.drivers (organization_id, employee_code, full_name) values (%L, ''E1'', ''Dup'')', (select org_a from t_ctx)), '23505');

-- tenant-specific catalog
insert into public.vehicle_makes (organization_id, name) select org_a, 'Marca A' from t_ctx;
insert into public.vehicle_models (organization_id, vehicle_make_id, name)
  select org_a, (select id from public.vehicle_makes where name = 'Marca A'), 'Modelo A' from t_ctx;
select pg_temp.t_throws('duplicate make name (case-insensitive) in same org rejected',
  format('insert into public.vehicle_makes (organization_id, name) values (%L, ''marca a'')', (select org_a from t_ctx)), '23505');
select pg_temp.t_throws('global make cannot be created by tenant user',
  'insert into public.vehicle_makes (organization_id, name) values (null, ''Global Make'')', '42501');
select pg_temp.t_lives('vehicle can use tenant model',
  'update public.vehicles set vehicle_model_id = (select id from public.vehicle_models where name = ''Modelo A'') where fleet_code = ''A-01''');

-- ---------------------------------------------------------------- same identifiers allowed in another tenant
select pg_temp.t_as((select user_b from t_ctx));
select pg_temp.t_lives('same plate allowed in other org',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-01'', ''ABC1D23'', (select car from t_ctx))', (select org_b from t_ctx)));
insert into public.organization_units (organization_id, code, name) select org_b, 'u1', 'Unit 1 B' from t_ctx;
-- (A's ids are not visible to B through RLS; fetched from a privileged context)
select pg_temp.t_reset();
create temp table t_a_ids as
  select (select id from public.organization_units where organization_id = (select org_a from t_ctx) and code = 'U1') as unit_a,
         (select id from public.cost_centers where organization_id = (select org_a from t_ctx) and code = 'CC1') as cc_a,
         (select id from public.vehicle_models where name = 'Modelo A') as model_a;
grant select on t_a_ids to authenticated;
select pg_temp.t_as((select user_b from t_ctx));
select pg_temp.t_throws('B cannot reference A unit (composite FK, real id)',
  format('insert into public.vehicles (organization_id, organization_unit_id, fleet_code, vehicle_type_id) values (%L, (select unit_a from t_a_ids), ''B-X1'', (select car from t_ctx))', (select org_b from t_ctx)), '23503');
select pg_temp.t_throws('B cannot reference A cost center (composite FK)',
  format('insert into public.vehicles (organization_id, cost_center_id, fleet_code, vehicle_type_id) values (%L, (select cc_a from t_a_ids), ''B-X2'', (select car from t_ctx))', (select org_b from t_ctx)), '23503');
select pg_temp.t_throws('B cannot use A tenant model',
  format('insert into public.vehicles (organization_id, vehicle_model_id, fleet_code, vehicle_type_id) values (%L, (select model_a from t_a_ids), ''B-X3'', (select car from t_ctx))', (select org_b from t_ctx)), '23514');
select pg_temp.t_throws('B cannot attach a cost center to A unit',
  format('insert into public.cost_centers (organization_id, organization_unit_id, code, name) values (%L, (select unit_a from t_a_ids), ''X'', ''X'')', (select org_b from t_ctx)), '23503');
select pg_temp.t_throws('organization_id immutable on vehicles',
  format('update public.vehicles set organization_id = %L where fleet_code = ''A-01''', (select org_a from t_ctx)), null);

-- ---------------------------------------------------------------- soft delete lifecycle (org A admin)
select pg_temp.t_as((select user_a from t_ctx));
select pg_temp.t_lives('archive vehicle A-01', 'update public.vehicles set deleted_at = ''2000-01-01'' where fleet_code = ''A-01''');
select pg_temp.t_check('archive timestamp is server-side and deleted_by set',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and deleted_at > now() - interval '1 minute' and deleted_by = auth.uid()));
select pg_temp.t_lives('archived plate can be reused by a new active vehicle',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-06'', ''ABC1D23'', (select car from t_ctx))', (select org_a from t_ctx)));
select pg_temp.t_throws('restore blocked while an active duplicate exists',
  'update public.vehicles set deleted_at = null where fleet_code = ''A-01''', '23505');
select pg_temp.t_lives('archive the duplicate', 'update public.vehicles set deleted_at = now() where fleet_code = ''A-06''');
select pg_temp.t_lives('restore original', 'update public.vehicles set deleted_at = null where fleet_code = ''A-01''');
select pg_temp.t_check('restored row has deleted_by cleared',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and deleted_at is null and deleted_by is null));
select pg_temp.t_throws('hard delete not permitted', 'delete from public.vehicles where fleet_code = ''A-06''', '42501');
select pg_temp.t_lives('archive unit U1', 'update public.organization_units set deleted_at = now() where code = ''U1''');
select pg_temp.t_check('archived unit still referenced by active vehicle (no cascade)',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-05' and organization_unit_id is not null));
select pg_temp.t_rows('global role not updatable by tenant admin (0 rows)', 'update public.roles set code = ''x'' where code = ''org_admin''', 0);

-- created_* immutability through stamps trigger
select pg_temp.t_lives('attempt to rewrite created_by', 'update public.vehicles set created_by = null, created_at = ''1999-01-01'' where fleet_code = ''A-01''');
select pg_temp.t_check('created_by/created_at preserved by trigger',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and created_by = auth.uid() and created_at > now() - interval '1 minute'));

select pg_temp.t_reset();
select * from pg_temp.t_tap();
rollback;
