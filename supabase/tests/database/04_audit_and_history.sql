-- =============================================================================
-- 04 · Audit trail, vehicle status history, outbox and the RPC surface
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-aud-admin@example.test')  as admin_u,
       tests.new_user('hfm-aud-viewer@example.test') as viewer_u;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx add column org uuid, add column car uuid;
update t_ctx set org = public.create_organization('Audit Org', 'audit-org-test', admin_u),
                 car = (select id from public.vehicle_types where code = 'car');
insert into public.organization_memberships (organization_id, user_id, status) select org, viewer_u, 'active' from t_ctx;
insert into public.membership_roles (membership_id, role_id)
  select m.id, r.id from public.organization_memberships m, public.roles r, t_ctx c
  where m.user_id = c.viewer_u and r.code = 'viewer' and r.organization_id is null;

-- ------------------------------------------------------- bootstrap is audited
select tests.check('organizations INSERT audited with tenant scope',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.organizations' and action = 'INSERT'
     and organization_id = (select org from t_ctx) and entity_id = (select org::text from t_ctx)));
select tests.check('membership and membership_roles audited with tenant scope',
  (select count(*) >= 2 from public.audit_logs where organization_id = (select org from t_ctx)
     and entity_type in ('public.organization_memberships','public.membership_roles')));
select tests.check('join table audit rows carry a composite entity_id',
  (select count(*) > 0 from public.audit_logs where entity_type = 'public.membership_roles'
     and organization_id = (select org from t_ctx) and entity_id like '%:%'));
select tests.check('settings INSERT audited with organization_id',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.organization_settings' and organization_id = (select org from t_ctx)));

-- ---------------------------------------------------------- vehicle lifecycle
select tests.as_user((select admin_u from t_ctx));
insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) select org, 'AUD-1', car from t_ctx;
create temp table t_v as select id from public.vehicles where fleet_code = 'AUD-1';
grant select on t_v to authenticated, anon, service_role;

select tests.check('vehicle INSERT audited with the actor',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.vehicles' and action = 'INSERT'
     and entity_id = (select id::text from t_v) and user_id = auth.uid() and organization_id = (select org from t_ctx)));
select tests.check('initial status row written to the history',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v) and previous_status is null and new_status = 'active'));

update public.vehicles set manufacture_year = 2022, model_year = 2023 where id = (select id from t_v);
select tests.check('UPDATE lists changed fields and ignores bookkeeping columns',
  (select changed_fields @> array['manufacture_year','model_year'] and not (changed_fields @> array['updated_at'])
     from public.audit_logs where entity_type = 'public.vehicles' and action = 'UPDATE' and entity_id = (select id::text from t_v)
     order by created_at desc limit 1));
select tests.check('old/new snapshots captured',
  (select (old_data ->> 'manufacture_year') is null and (new_data ->> 'manufacture_year') = '2022'
     from public.audit_logs where entity_type = 'public.vehicles' and action = 'UPDATE' and entity_id = (select id::text from t_v)
     order by created_at desc limit 1));

create temp table t_cnt as select count(*) as before_noop from public.audit_logs where entity_id = (select id::text from t_v);
grant select on t_cnt to authenticated, anon, service_role;
update public.vehicles set manufacture_year = 2022 where id = (select id from t_v);
select tests.check('no-op UPDATE not logged',
  (select count(*) = (select before_noop from t_cnt) from public.audit_logs where entity_id = (select id::text from t_v)));

select public.set_vehicle_status((select id from t_v), 'maintenance', 'Revisão programada');
select tests.check('status change records the reason and the actor',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v)
     and previous_status = 'active' and new_status = 'maintenance' and reason = 'Revisão programada' and changed_by = auth.uid()));
update public.vehicles set status = 'active' where id = (select id from t_v);
select tests.check('direct status update logged without a reason',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v)
     and previous_status = 'maintenance' and new_status = 'active' and reason is null));
select tests.check('three history rows in total', (select count(*) = 3 from public.vehicle_status_history where vehicle_id = (select id from t_v)));
select tests.throws('invalid status through the RPC rejected',
  format('select public.set_vehicle_status(%L, ''flying'')', (select id from t_v)), '23514');
select tests.throws('history not editable by authenticated', 'update public.vehicle_status_history set reason = ''x''', '42501');
select tests.throws('audit not editable by authenticated', 'update public.audit_logs set action = ''DELETE''', '42501');
select tests.throws('audit not deletable by authenticated', 'delete from public.audit_logs', '42501');
select tests.throws('audit not insertable by authenticated',
  'insert into public.audit_logs (entity_type, action) values (''x.y'', ''INSERT'')', '42501');

select tests.as_user((select viewer_u from t_ctx));
select tests.check('viewer sees the status history', (select count(*) = 3 from public.vehicle_status_history where vehicle_id = (select id from t_v)));
select tests.throws('viewer: set_vehicle_status denied by RLS',
  format('select public.set_vehicle_status(%L, ''inactive'')', (select id from t_v)), 'P0002');
select tests.check('viewer: audit hidden', (select count(*) = 0 from public.audit_logs));

-- ------------------------------------------------ append-only, even for owners
select tests.reset();
select tests.throws('audit append-only even for the owner session',
  'update public.audit_logs set action = ''DELETE'' where true', '42501');
select tests.throws('audit delete blocked without the purge flag',
  'delete from public.audit_logs where entity_type = ''public.vehicles''', '42501');
select set_config('hfm.allow_purge', 'on', true);
select tests.lives('purge allowed with hfm.allow_purge in a privileged session',
  'delete from public.audit_logs where entity_type = ''public.vehicles'' and created_at < now() - interval ''100 years''');
select set_config('hfm.allow_purge', 'off', true);

-- --------------------------------------------------------------------- outbox
select tests.lives('emit_event works from a privileged context',
  format('select private.emit_event(%L, ''vehicle.status_changed'', ''vehicle'', %L, ''{"status":"active"}'')', (select org from t_ctx), (select id from t_v)));
select tests.check('pending outbox row present',
  (select count(*) = 1 from public.outbox_events where aggregate_id = (select id from t_v) and status = 'pending'));
select tests.as_user((select admin_u from t_ctx));
select tests.throws('emit_event not callable by authenticated',
  format('select private.emit_event(%L, ''x.y'', ''x'', null)', (select org from t_ctx)), '42501');
select tests.throws('a vehicle with history cannot be hard deleted (RESTRICT)',
  format('delete from public.vehicles where id = %L', (select id from t_v)), '42501');

select tests.reset();
select * from tests.report();
rollback;
