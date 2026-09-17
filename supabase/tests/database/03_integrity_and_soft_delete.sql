-- =============================================================================
-- 03 · Integrity, normalization, cross-tenant references and soft delete
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-int-a@example.test') as user_a,
       tests.new_user('hfm-int-b@example.test') as user_b;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx add column org_a uuid, add column org_b uuid, add column car uuid;
update t_ctx set org_a = public.create_organization('Int A', 'int-a-test', user_a),
                 org_b = public.create_organization('Int B', 'int-b-test', user_b),
                 car   = (select id from public.vehicle_types where code = 'car');

-- ------------------------------------------------------- bootstrap invariants
select tests.check('settings row auto-created (1:1)',
  (select count(*) = 2 from public.organization_settings where organization_id in (select org_a from t_ctx union select org_b from t_ctx)));
select tests.check('owner membership active with joined_at',
  (select count(*) = 1 from public.organization_memberships where organization_id = (select org_a from t_ctx) and status = 'active' and joined_at is not null));
select tests.check('owner holds org_admin',
  (select count(*) = 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id where r.code = 'org_admin'
     and mr.membership_id = (select id from public.organization_memberships where organization_id = (select org_a from t_ctx))));
select tests.check('profile auto-created by the auth trigger',
  (select count(*) = 1 from public.profiles where user_id = (select user_a from t_ctx) and full_name = 'hfm-int-a@example.test'));
select tests.throws('duplicate slug rejected',
  format('select public.create_organization(''Dup'', ''int-a-test'', %L)', (select user_a from t_ctx)), '23505');
select tests.throws('invalid slug rejected',
  format('select public.create_organization(''Bad'', ''Bad Slug!'', %L)', (select user_a from t_ctx)), '23514');
select tests.throws('membership unique (org,user)',
  format('insert into public.organization_memberships (organization_id, user_id) values (%L, %L)', (select org_a from t_ctx), (select user_a from t_ctx)), '23505');
select tests.throws('invalid vehicle status rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id, status) values (%L, ''S1'', %L, ''flying'')', (select org_a from t_ctx), (select car from t_ctx)), '23514');
select tests.throws('vehicle needs at least one identifier',
  format('insert into public.vehicles (organization_id, vehicle_type_id) values (%L, %L)', (select org_a from t_ctx), (select car from t_ctx)), '23514');
select tests.throws('model_year must follow manufacture_year',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id, manufacture_year, model_year) values (%L, ''Y1'', %L, 2020, 2023)', (select org_a from t_ctx), (select car from t_ctx)), '23514');

-- ------------------------------------------- tenant lifecycle is platform-only
select tests.as_user((select user_a from t_ctx));
select tests.throws('tenant admin cannot archive the organization',
  format('update public.organizations set status = ''archived'', deleted_at = now() where id = %L', (select org_a from t_ctx)), '42501');
select tests.throws('tenant admin cannot suspend the organization',
  format('update public.organizations set status = ''suspended'' where id = %L', (select org_a from t_ctx)), '42501');

-- ------------------------------------------------ normalization + uniqueness
insert into public.vehicles (organization_id, fleet_code, license_plate, vin, renavam, vehicle_type_id)
  select org_a, ' a-01 ', 'abc-1d23', 'ngr7yl3zvmj0g2f4a', '123.456.789-1', car from t_ctx;
select tests.check('identifiers normalized and RENAVAM zero-padded to 11',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and license_plate = 'ABC1D23'
      and vin = 'NGR7YL3ZVMJ0G2F4A' and renavam = '01234567891'));
select tests.throws('duplicate plate in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-02'', ''ABC1D23'', %L)', (select org_a from t_ctx), (select car from t_ctx)), '23505');
select tests.throws('duplicate VIN in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vin, vehicle_type_id) values (%L, ''A-03'', ''NGR7YL3ZVMJ0G2F4A'', %L)', (select org_a from t_ctx), (select car from t_ctx)), '23505');
select tests.throws('duplicate fleet_code in same org rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) values (%L, ''a-01'', %L)', (select org_a from t_ctx), (select car from t_ctx)), '23505');
select tests.throws('VIN containing O rejected',
  format('insert into public.vehicles (organization_id, fleet_code, vin, vehicle_type_id) values (%L, ''A-04'', ''OGR7YL3ZVMJ0G2F4A'', %L)', (select org_a from t_ctx), (select car from t_ctx)), '23514');
insert into public.organization_units (organization_id, code, name) select org_a, 'u1', 'Unit 1' from t_ctx;
select tests.throws('duplicate unit code rejected',
  format('insert into public.organization_units (organization_id, code, name) values (%L, ''U1'', ''Unit 1 again'')', (select org_a from t_ctx)), '23505');
select tests.throws('duplicate unit name rejected',
  format('insert into public.organization_units (organization_id, code, name) values (%L, ''U9'', ''unit 1'')', (select org_a from t_ctx)), '23505');
insert into public.cost_centers (organization_id, organization_unit_id, code, name)
  select org_a, (select id from public.organization_units where code = 'U1'), 'cc1', 'CC 1' from t_ctx;
select tests.lives('vehicle may reference own unit and cost center',
  format('insert into public.vehicles (organization_id, organization_unit_id, cost_center_id, fleet_code, vehicle_type_id) values (%L, (select id from public.organization_units where code = ''U1''), (select id from public.cost_centers where code = ''CC1''), ''A-05'', %L)', (select org_a from t_ctx), (select car from t_ctx)));
insert into public.drivers (organization_id, employee_code, full_name) select org_a, 'e1', '  Driver One ' from t_ctx;
select tests.check('driver normalized', (select count(*) = 1 from public.drivers where employee_code = 'E1' and full_name = 'Driver One'));
select tests.throws('duplicate employee_code rejected',
  format('insert into public.drivers (organization_id, employee_code, full_name) values (%L, ''E1'', ''Dup'')', (select org_a from t_ctx)), '23505');

insert into public.vehicle_makes (organization_id, name) select org_a, 'Marca A' from t_ctx;
insert into public.vehicle_models (organization_id, vehicle_make_id, name)
  select org_a, (select id from public.vehicle_makes where name = 'Marca A'), 'Modelo A' from t_ctx;
select tests.throws('duplicate make name (case-insensitive) rejected',
  format('insert into public.vehicle_makes (organization_id, name) values (%L, ''marca a'')', (select org_a from t_ctx)), '23505');
select tests.throws('tenant cannot create a global make',
  'insert into public.vehicle_makes (organization_id, name) values (null, ''Global Make'')', '42501');
select tests.lives('vehicle can use tenant model',
  'update public.vehicles set vehicle_model_id = (select id from public.vehicle_models where name = ''Modelo A'') where fleet_code = ''A-01''');

-- ----------------------------------------- identifiers are unique per tenant
select tests.as_user((select user_b from t_ctx));
select tests.lives('same plate allowed in another org',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-01'', ''ABC1D23'', %L)', (select org_b from t_ctx), (select car from t_ctx)));
insert into public.organization_units (organization_id, code, name) select org_b, 'u1', 'Unit 1 B' from t_ctx;

-- A's ids are invisible to B through RLS; fetch them from a privileged context
select tests.reset();
create temp table t_a_ids as
  select (select id from public.organization_units where organization_id = (select org_a from t_ctx) and code = 'U1') as unit_a,
         (select id from public.cost_centers      where organization_id = (select org_a from t_ctx) and code = 'CC1') as cc_a,
         (select id from public.vehicle_models    where name = 'Modelo A') as model_a;
grant select on t_a_ids to authenticated, anon, service_role;

select tests.as_user((select user_b from t_ctx));
select tests.throws('B cannot reference A unit (composite FK)',
  format('insert into public.vehicles (organization_id, organization_unit_id, fleet_code, vehicle_type_id) values (%L, (select unit_a from t_a_ids), ''B-X1'', %L)', (select org_b from t_ctx), (select car from t_ctx)), '23503');
select tests.throws('B cannot reference A cost center (composite FK)',
  format('insert into public.vehicles (organization_id, cost_center_id, fleet_code, vehicle_type_id) values (%L, (select cc_a from t_a_ids), ''B-X2'', %L)', (select org_b from t_ctx), (select car from t_ctx)), '23503');
select tests.throws('B cannot use A tenant model',
  format('insert into public.vehicles (organization_id, vehicle_model_id, fleet_code, vehicle_type_id) values (%L, (select model_a from t_a_ids), ''B-X3'', %L)', (select org_b from t_ctx), (select car from t_ctx)), '23514');
select tests.throws('B cannot attach a cost center to A unit',
  format('insert into public.cost_centers (organization_id, organization_unit_id, code, name) values (%L, (select unit_a from t_a_ids), ''X'', ''X'')', (select org_b from t_ctx)), '23503');
select tests.throws('organization_id immutable on vehicles',
  format('update public.vehicles set organization_id = %L where fleet_code = ''A-01''', (select org_a from t_ctx)), null);

-- ------------------------------------------------------- soft delete lifecycle
select tests.as_user((select user_a from t_ctx));
select tests.lives('archive vehicle A-01', 'update public.vehicles set deleted_at = ''2000-01-01'' where fleet_code = ''A-01''');
select tests.check('archive timestamp is server-side and deleted_by stamped',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and deleted_at > now() - interval '1 minute' and deleted_by = auth.uid()));
select tests.lives('archived plate can be reused',
  format('insert into public.vehicles (organization_id, fleet_code, license_plate, vehicle_type_id) values (%L, ''A-06'', ''ABC1D23'', %L)', (select org_a from t_ctx), (select car from t_ctx)));
select tests.throws('restore blocked while an active duplicate exists',
  'update public.vehicles set deleted_at = null where fleet_code = ''A-01''', '23505');
select tests.lives('archive the duplicate', 'update public.vehicles set deleted_at = now() where fleet_code = ''A-06''');
select tests.lives('restore original', 'update public.vehicles set deleted_at = null where fleet_code = ''A-01''');
select tests.check('restored row has deleted_by cleared',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and deleted_at is null and deleted_by is null));
select tests.throws('hard delete not permitted', 'delete from public.vehicles where fleet_code = ''A-06''', '42501');
select tests.lives('archive unit U1', 'update public.organization_units set deleted_at = now() where code = ''U1''');
select tests.check('archived unit still referenced by an active vehicle (no cascade)',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-05' and organization_unit_id is not null));
select tests.throws('new vehicle cannot reference an archived unit',
  format('insert into public.vehicles (organization_id, organization_unit_id, fleet_code, vehicle_type_id) values (%L, (select unit_a from t_a_ids), ''A-07'', %L)', (select org_a from t_ctx), (select car from t_ctx)), '23514');
select tests.rows_affected('global role not updatable by a tenant admin (0 rows)',
  'update public.roles set name = ''x'' where code = ''org_admin'' and organization_id is null', 0);

-- ------------------------------------------------------------ authorship stamps
select tests.lives('attempt to rewrite created_by', 'update public.vehicles set created_by = null, created_at = ''1999-01-01'' where fleet_code = ''A-01''');
select tests.check('created_by/created_at preserved by the trigger',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-01' and created_by = auth.uid() and created_at > now() - interval '1 minute'));
select tests.lives('attempt to forge created_by on insert',
  format('insert into public.vehicles (organization_id, fleet_code, vehicle_type_id, created_by) values (%L, ''A-08'', %L, %L)', (select org_a from t_ctx), (select car from t_ctx), (select user_b from t_ctx)));
select tests.check('created_by forced to the real caller',
  (select count(*) = 1 from public.vehicles where fleet_code = 'A-08' and created_by = auth.uid()));

select tests.reset();
select * from tests.report();
rollback;
