-- =============================================================================
-- 05 · Platform administration (separate from tenant administration)
-- =============================================================================
begin;
\ir ../helpers/_helpers.sql

create temp table t_ctx as
select pg_temp.t_user('hfm-pa-admin@example.test') as pa_u,
       pg_temp.t_user('hfm-pa-owner@example.test') as owner_u,
       pg_temp.t_user('hfm-pa-plain@example.test') as plain_u;
grant select on t_ctx to authenticated;
alter table t_ctx add column org uuid;
update t_ctx set org = public.create_organization('PA Org', 'pa-org-test', owner_u);

-- bootstrap a platform admin from a privileged context (the only supported way)
insert into public.platform_admins (user_id, note) select pa_u, 'test bootstrap' from t_ctx;
select pg_temp.t_check('platform_admins insert audited (platform-level, org null)',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.platform_admins' and organization_id is null));

-- ---------------------------------------------------------------- platform admin
select pg_temp.t_as((select pa_u from t_ctx));
select pg_temp.t_check('pa: is_platform_admin()', (select private.is_platform_admin()));
select pg_temp.t_check('pa: sees every organization', (select count(*) >= 1 and bool_or(id = (select org from t_ctx)) from public.organizations));
select pg_temp.t_check('pa: sees platform_admins roster', (select count(*) = 1 from public.platform_admins));
select pg_temp.t_check('pa: sees platform-level audit rows', (select count(*) >= 1 from public.audit_logs where organization_id is null));
select pg_temp.t_lives('pa: can create an organization for another owner',
  format('select public.create_organization(''PA Org 2'', ''pa-org2-test'', %L)', (select plain_u from t_ctx)));
select pg_temp.t_check('pa: new org owner is org_admin',
  (select count(*) = 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id
     join public.organization_memberships m on m.id = mr.membership_id
     where r.code = 'org_admin' and m.user_id = (select plain_u from t_ctx)));
select pg_temp.t_check('pa: has every permission in any org',
  (select count(*) = (select count(*) from public.permissions) from public.current_user_permissions((select org from t_ctx))));
select pg_temp.t_throws('pa: still cannot write platform_admins through the API role',
  'insert into public.platform_admins (user_id) values (gen_random_uuid())', '42501');

-- ---------------------------------------------------------------- tenant admin is not platform admin
select pg_temp.t_as((select owner_u from t_ctx));
select pg_temp.t_check('owner: not platform admin', (select not private.is_platform_admin()));
select pg_temp.t_check('owner: platform_admins hidden', (select count(*) = 0 from public.platform_admins));
select pg_temp.t_throws('owner: cannot create organizations', 'select public.create_organization(''X'', ''x-owner-test'')', '42501');
select pg_temp.t_check('owner: sees only own org', (select count(*) = 1 from public.organizations));

-- ---------------------------------------------------------------- revoked platform admin
select pg_temp.t_reset();
update public.platform_admins set revoked_at = now() where user_id = (select pa_u from t_ctx);
select pg_temp.t_as((select pa_u from t_ctx));
select pg_temp.t_check('revoked pa: no longer platform admin', (select not private.is_platform_admin()));
select pg_temp.t_check('revoked pa: sees no organizations', (select count(*) = 0 from public.organizations));

-- ---------------------------------------------------------------- service_role
select pg_temp.t_as_service();
select pg_temp.t_check('service_role: is privileged context', (select private.is_privileged_context()));
select pg_temp.t_lives('service_role: can create organization with explicit owner',
  format('select public.create_organization(''SR Org'', ''sr-org-test'', %L)', (select plain_u from t_ctx)));
select pg_temp.t_throws('service_role: owner is required', 'select public.create_organization(''SR Org 2'', ''sr-org2-test'')', '22004');
select pg_temp.t_check('service_role: bypasses RLS (reads all orgs)', (select count(*) >= 3 from public.organizations));

select pg_temp.t_reset();
select * from pg_temp.t_tap();
rollback;
