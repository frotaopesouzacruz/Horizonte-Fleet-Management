-- =============================================================================
-- FIX — anonymous callers could reach the Administration RPCs
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function and `anon` inherits
-- that. Each function already refuses an unauthenticated caller on its own
-- (auth.uid() is null, so no permission matches), but an anonymous request
-- should not reach the function body at all.
--
-- Etapa 01 set ALTER DEFAULT PRIVILEGES for role `postgres`; the migration API
-- creates functions under a different role, so the default did not apply here.
-- Every migration that adds a SECURITY DEFINER function must revoke explicitly.
-- =============================================================================
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname <> 'rls_auto_enable'
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end
$$;

-- Application RPCs stay available to signed-in callers; each one performs its
-- own permission check and is listed in docs/modules/admin-users.md.
grant execute on function public.save_employee(uuid, jsonb)                                    to authenticated;
grant execute on function public.archive_employee(uuid, boolean)                               to authenticated;
grant execute on function public.restore_employee(uuid)                                        to authenticated;
grant execute on function public.prepare_employee_access(uuid, uuid[], uuid[])                 to authenticated;
grant execute on function public.grant_employee_access(uuid, uuid, uuid[], uuid[])             to authenticated;
grant execute on function public.set_employee_access_status(uuid, text)                        to authenticated;
grant execute on function public.set_membership_roles(uuid, uuid[])                            to authenticated;
grant execute on function public.set_membership_operation_scopes(uuid, uuid[])                 to authenticated;
grant execute on function public.log_user_export(uuid, text, integer, boolean)                 to authenticated;
grant execute on function public.employee_masked_identifiers(uuid)                             to authenticated;
grant execute on function public.validate_employee_import(uuid)                                to authenticated;
grant execute on function public.process_employee_import(uuid)                                 to authenticated;
grant execute on function public.create_organization(text, text, uuid, text, text, text, text) to authenticated;

-- Maintenance job: service_role only, never an application user.
grant execute on function public.purge_expired_import_batches() to service_role;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
