-- =============================================================================
-- 04 · Audit trail, vehicle status history, RPC surface
-- =============================================================================
begin;
\ir ../helpers/_helpers.sql

create temp table t_ctx as
select pg_temp.t_user('hfm-aud-admin@example.test') as admin_u,
       pg_temp.t_user('hfm-aud-viewer@example.test') as viewer_u;
grant select on t_ctx to authenticated;
alter table t_ctx add column org uuid, add column car uuid;
update t_ctx set org = public.create_organization('Audit Org', 'audit-org-test', admin_u),
                 car = (select id from public.vehicle_types where code = 'car');
insert into public.organization_memberships (organization_id, user_id, status) select org, viewer_u, 'active' from t_ctx;
insert into public.membership_roles (membership_id, role_id)
  select m.id, r.id from public.organization_memberships m, public.roles r, t_ctx c
  where m.user_id = c.viewer_u and r.code = 'viewer' and r.organization_id is null;

select pg_temp.t_check('bootstrap audited: organizations INSERT',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.organizations' and action = 'INSERT' and entity_id = (select org::text from t_ctx)));
select pg_temp.t_check('bootstrap audited: membership + membership_roles INSERT',
  (select count(*) >= 2 from public.audit_logs where organization_id = (select org from t_ctx) and entity_type in ('public.organization_memberships', 'public.membership_roles')));
select pg_temp.t_check('bootstrap audited: settings INSERT carries organization_id',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.organization_settings' and organization_id = (select org from t_ctx)));

-- ---------------------------------------------------------------- vehicle lifecycle as admin
select pg_temp.t_as((select admin_u from t_ctx));
insert into public.vehicles (organization_id, fleet_code, vehicle_type_id) select org, 'AUD-1', car from t_ctx;
create temp table t_v as select id from public.vehicles where fleet_code = 'AUD-1';
grant select on t_v to authenticated;

select pg_temp.t_check('audit: vehicle INSERT logged with actor',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.vehicles' and action = 'INSERT'
     and entity_id = (select id::text from t_v) and user_id = auth.uid() and organization_id = (select org from t_ctx)));
select pg_temp.t_check('history: initial status row (previous null)',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v) and previous_status is null and new_status = 'active'));

update public.vehicles set manufacture_year = 2022, model_year = 2023 where id = (select id from t_v);
select pg_temp.t_check('audit: UPDATE logged with changed_fields',
  (select changed_fields @> array['manufacture_year', 'model_year'] and not (changed_fields @> array['updated_at'])
     from public.audit_logs where entity_type = 'public.vehicles' and action = 'UPDATE' and entity_id = (select id::text from t_v)
     order by created_at desc limit 1));
select pg_temp.t_check('audit: old/new data captured',
  (select (old_data ->> 'manufacture_year') is null and (new_data ->> 'manufacture_year') = '2022'
     from public.audit_logs where entity_type = 'public.vehicles' and action = 'UPDATE' and entity_id = (select id::text from t_v)
     order by created_at desc limit 1));

-- no-op update must not create audit noise
create temp table t_cnt as select count(*) as before_noop from public.audit_logs where entity_id = (select id::text from t_v);
grant select on t_cnt to authenticated;
update public.vehicles set manufacture_year = 2022 where id = (select id from t_v);
select pg_temp.t_check('audit: no-op UPDATE not logged',
  (select count(*) = (select before_noop from t_cnt) from public.audit_logs where entity_id = (select id::text from t_v)));

-- status change with reason via RPC
select public.set_vehicle_status((select id from t_v), 'maintenance', 'Revisão programada');
select pg_temp.t_check('history: status change with reason and actor',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v)
     and previous_status = 'active' and new_status = 'maintenance' and reason = 'Revisão programada' and changed_by = auth.uid()));
update public.vehicles set status = 'active' where id = (select id from t_v);
select pg_temp.t_check('history: direct status update logged without reason',
  (select count(*) = 1 from public.vehicle_status_history where vehicle_id = (select id from t_v)
     and previous_status = 'maintenance' and new_status = 'active' and reason is null));
select pg_temp.t_check('history: exactly 3 rows', (select count(*) = 3 from public.vehicle_status_history where vehicle_id = (select id from t_v)));
select pg_temp.t_throws('history: invalid status via RPC rejected',
  format('select public.set_vehicle_status(%L, ''flying'')', (select id from t_v)), '23514');
select pg_temp.t_throws('history: cannot be edited by authenticated', 'update public.vehicle_status_history set reason = ''x''', '42501');
select pg_temp.t_throws('audit: cannot be edited by authenticated', 'update public.audit_logs set action = ''DELETE''', '42501');
select pg_temp.t_throws('audit: cannot be deleted by authenticated', 'delete from public.audit_logs', '42501');
select pg_temp.t_throws('audit: cannot be inserted by authenticated',
  'insert into public.audit_logs (entity_type, action) values (''x.y'', ''INSERT'')', '42501');

-- ---------------------------------------------------------------- viewer
select pg_temp.t_as((select viewer_u from t_ctx));
select pg_temp.t_check('viewer: sees status history (vehicles.view)',
  (select count(*) = 3 from public.vehicle_status_history where vehicle_id = (select id from t_v)));
select pg_temp.t_throws('viewer: set_vehicle_status denied by RLS',
  format('select public.set_vehicle_status(%L, ''inactive'')', (select id from t_v)), 'P0002');
select pg_temp.t_check('viewer: audit hidden', (select count(*) = 0 from public.audit_logs));

-- ---------------------------------------------------------------- append-only holds even for privileged sessions
select pg_temp.t_reset();
select pg_temp.t_throws('audit: append-only even for owner session', 'update public.audit_logs set action = ''DELETE'' where false or true', '42501');
select pg_temp.t_throws('audit: delete blocked for owner without purge flag', 'delete from public.audit_logs where entity_type = ''public.vehicles''', '42501');
select set_config('hfm.allow_purge', 'on', true);
select pg_temp.t_lives('audit: purge allowed with hfm.allow_purge from privileged session',
  'delete from public.audit_logs where entity_type = ''public.vehicles'' and created_at < now() - interval ''100 years''');
select set_config('hfm.allow_purge', 'off', true);

-- ---------------------------------------------------------------- outbox
select pg_temp.t_lives('outbox: emit_event works from privileged context',
  format('select private.emit_event(%L, ''vehicle.status_changed'', ''vehicle'', %L, ''{"status":"active"}'')', (select org from t_ctx), (select id from t_v)));
select pg_temp.t_check('outbox: pending row present',
  (select count(*) = 1 from public.outbox_events where aggregate_id = (select id from t_v) and status = 'pending'));
select pg_temp.t_as((select admin_u from t_ctx));
select pg_temp.t_throws('outbox: not callable by authenticated',
  format('select private.emit_event(%L, ''x.y'', ''x'', null)', (select org from t_ctx)), '42501');

select pg_temp.t_reset();
select * from pg_temp.t_tap();
rollback;
