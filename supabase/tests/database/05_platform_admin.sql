-- =============================================================================
-- 05 · Platform administration, kept separate from tenant administration
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-pa-admin@example.test') as pa_u,
       tests.new_user('hfm-pa-owner@example.test') as owner_u,
       tests.new_user('hfm-pa-plain@example.test') as plain_u;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx add column org uuid;
update t_ctx set org = public.create_organization('PA Org', 'pa-org-test', owner_u);

-- the only supported bootstrap: a privileged session / service_role
insert into public.platform_admins (user_id, note) select pa_u, 'test bootstrap' from t_ctx;
select tests.check('platform_admins insert audited at platform level (org null)',
  (select count(*) = 1 from public.audit_logs where entity_type = 'public.platform_admins' and organization_id is null));

-- ----------------------------------------------------------- platform admin
select tests.as_user((select pa_u from t_ctx));
select tests.check('pa: is_platform_admin()', (select private.is_platform_admin()));
select tests.check('pa: sees every organization',
  (select count(*) >= 1 and bool_or(id = (select org from t_ctx)) from public.organizations));
select tests.check('pa: sees the platform_admins roster', (select count(*) = 1 from public.platform_admins));
select tests.check('pa: sees platform-level audit rows', (select count(*) >= 1 from public.audit_logs where organization_id is null));
select tests.lives('pa: can create an organization for another owner',
  format('select public.create_organization(''PA Org 2'', ''pa-org2-test'', %L)', (select plain_u from t_ctx)));
select tests.check('pa: the new owner is org_admin',
  (select count(*) = 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id
     join public.organization_memberships m on m.id = mr.membership_id
     where r.code = 'org_admin' and m.user_id = (select plain_u from t_ctx)));
select tests.check('pa: holds every permission in any organization',
  (select count(*) = (select count(*) from public.permissions) from public.current_user_permissions((select org from t_ctx))));
select tests.throws('pa: still cannot write platform_admins through the API role',
  'insert into public.platform_admins (user_id) values (gen_random_uuid())', '42501');
select tests.lives('pa: can suspend an organization (platform lifecycle)',
  format('update public.organizations set status = ''suspended'' where id = %L', (select org from t_ctx)));
select tests.lives('pa: can reactivate the organization',
  format('update public.organizations set status = ''active'' where id = %L', (select org from t_ctx)));

-- ------------------------------------------- a tenant admin is not a platform admin
select tests.as_user((select owner_u from t_ctx));
select tests.check('owner: not a platform admin', (select not private.is_platform_admin()));
select tests.check('owner: platform_admins hidden', (select count(*) = 0 from public.platform_admins));
select tests.throws('owner: cannot create organizations',
  'select public.create_organization(''X'', ''x-owner-test'')', '42501');
select tests.check('owner: sees only its own organization', (select count(*) = 1 from public.organizations));

-- ------------------------------------------------------------ revoked admin
select tests.reset();
update public.platform_admins set revoked_at = now() where user_id = (select pa_u from t_ctx);
select tests.as_user((select pa_u from t_ctx));
select tests.check('revoked pa: no longer a platform admin', (select not private.is_platform_admin()));
select tests.check('revoked pa: sees no organizations', (select count(*) = 0 from public.organizations));

-- ------------------------------------------------------------- service_role
select tests.as_service();
select tests.check('service_role: privileged context', (select private.is_privileged_context()));
select tests.lives('service_role: can create an organization with an explicit owner',
  format('select public.create_organization(''SR Org'', ''sr-org-test'', %L)', (select plain_u from t_ctx)));
select tests.throws('service_role: owner is required',
  'select public.create_organization(''SR Org 2'', ''sr-org2-test'')', '22004');
select tests.check('service_role: bypasses RLS', (select count(*) >= 3 from public.organizations));

select tests.reset();
select * from tests.report();
rollback;
