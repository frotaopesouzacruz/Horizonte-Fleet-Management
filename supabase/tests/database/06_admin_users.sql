-- =============================================================================
-- 06 · Administration / Users
--   Employee vs auth user, restricted personal data, the operation scope axis,
--   privilege escalation, and the import pipeline end to end.
--
--   The scope rules are the point of this file: no scope means no operation,
--   never "all", and nobody widens their own access.
-- =============================================================================
begin;
\ir ../helpers/install.sql
select tests.init();

create temp table t_ctx as
select tests.new_user('hfm-admin@example.test',  'Admin')  as user_admin,
       tests.new_user('hfm-scoped@example.test', 'Scoped') as user_scoped,
       tests.new_user('hfm-outside@example.test','Outside') as user_outside;
grant select on t_ctx to authenticated, anon, service_role;
alter table t_ctx
  add column org_a uuid, add column org_b uuid,
  add column op_north uuid, add column op_south uuid,
  add column emp_north uuid, add column emp_south uuid,
  add column ms_scoped uuid, add column batch uuid;

update t_ctx set org_a = public.create_organization('Org A', 'org-a-admin-test', user_admin),
                 org_b = public.create_organization('Org B', 'org-b-admin-test', user_outside);

-- -----------------------------------------------------------------------------
-- Master data and two employees, created by the administrator through RLS
-- -----------------------------------------------------------------------------
select tests.as_user((select user_admin from t_ctx));

insert into public.operations (organization_id, code, name)
  select org_a, 'NORTH', 'Operação Norte' from t_ctx;
insert into public.operations (organization_id, code, name)
  select org_a, 'SOUTH', 'Operação Sul' from t_ctx;
update t_ctx set
  op_north = (select id from public.operations where code = 'NORTH'),
  op_south = (select id from public.operations where code = 'SOUTH');

-- An employee with no e-mail: most of a corporate base has none, and that must
-- never block the registration.
select tests.lives('employee without e-mail can be registered',
  format('select public.save_employee(%L, %L::jsonb)', (select org_a from t_ctx),
    json_build_object('employee_code','N001','full_name','Colaborador Norte',
                      'assignment', json_build_object('operation_id', (select op_north from t_ctx)))::text));

select tests.lives('employee with restricted data can be registered',
  format('select public.save_employee(%L, %L::jsonb)', (select org_a from t_ctx),
    json_build_object('employee_code','S001','full_name','Colaborador Sul',
                      'corporate_email','sul@example.test',
                      'private', json_build_object('cpf','11144477735','birth_date','1990-05-04'),
                      'assignment', json_build_object('operation_id', (select op_south from t_ctx)))::text));

update t_ctx set
  emp_north = (select id from public.employees where employee_code = 'N001'),
  emp_south = (select id from public.employees where employee_code = 'S001');

select tests.check('employee exists without any auth user',
  (select count(*) = 0 from public.organization_memberships m
    where m.employee_id = (select emp_north from t_ctx)),
  'registering a person must not create an account');

select tests.throws('duplicate registration number is rejected',
  format('select public.save_employee(%L, %L::jsonb)', (select org_a from t_ctx),
    json_build_object('employee_code','N001','full_name','Outro Colaborador')::text), '23505');

select tests.throws('invalid CPF is rejected',
  format('select public.save_employee(%L, %L::jsonb)', (select org_a from t_ctx),
    json_build_object('employee_code','X001','full_name','CPF Invalido',
                      'private', json_build_object('cpf','12345678901'))::text), '23514');

select tests.check('CPF is stored digits-only in its own table',
  (select cpf = '11144477735' from public.employee_private_data
    where employee_id = (select emp_south from t_ctx)));

select tests.check('the directory never carries CPF',
  not exists (select 1 from information_schema.columns
               where table_name = 'employee_directory' and column_name in ('cpf','birth_date')));

-- -----------------------------------------------------------------------------
-- The scoped account: users.view, no operations.access_all, no scope rows
-- -----------------------------------------------------------------------------
insert into public.organization_memberships (organization_id, user_id, status, joined_at)
  select org_a, user_scoped, 'active', now() from t_ctx;
update t_ctx set ms_scoped = (select id from public.organization_memberships
                               where user_id = (select user_scoped from t_ctx));
insert into public.membership_roles (membership_id, role_id)
  select ms_scoped, (select id from public.roles where code = 'fleet_manager' and organization_id is null)
    from t_ctx;

select tests.as_user((select user_scoped from t_ctx));

select tests.check('no scope means no employees (fails closed)',
  (select count(*) = 0 from public.employee_directory),
  'an account with no operation scope must not see anyone');

select tests.check('no scope means no operations either',
  (select count(*) = 0 from public.operations));

select tests.check('users.view_sensitive is required for CPF',
  (select count(*) = 0 from public.employee_private_data));

select tests.throws('cannot create an employee without users.create',
  format('insert into public.employees (organization_id, employee_code, full_name) values (%L, ''Z001'', ''Nao'')',
         (select org_a from t_ctx)), '42501');

select tests.throws('cannot import without users.import',
  format('select public.validate_employee_import(%L)', gen_random_uuid()), '42501');

select tests.throws('cannot widen its own operation scope',
  format('insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (%L,%L,%L)',
         (select org_a from t_ctx), (select ms_scoped from t_ctx), (select op_north from t_ctx)), '42501');

select tests.throws('cannot grant itself a role',
  format('select public.set_membership_roles(%L, array[%L]::uuid[])',
         (select ms_scoped from t_ctx),
         (select id from public.roles where code = 'org_admin' and organization_id is null)), '42501');

select tests.throws('cannot export restricted data without the permission',
  format('select public.log_user_export(%L, ''test'', 1, true)', (select org_a from t_ctx)), '42501');

-- -----------------------------------------------------------------------------
-- One operation granted: the scope must restrict, not open
-- -----------------------------------------------------------------------------
select tests.as_user((select user_admin from t_ctx));
select public.set_membership_operation_scopes((select ms_scoped from t_ctx),
                                              array[(select op_north from t_ctx)]);

select tests.as_user((select user_scoped from t_ctx));

select tests.check('sees exactly the employees of its operation',
  (select count(*) = 1 from public.employee_directory),
  'one scoped operation, one employee');

select tests.check('no row leaks from another operation',
  (select count(*) = 0 from public.employee_directory
    where operation_id is distinct from (select op_north from t_ctx)));

select tests.check('the operations catalogue is scoped too',
  (select count(*) = 1 from public.operations));

select tests.throws('still cannot change its own scope after being granted one',
  format('select public.set_membership_operation_scopes(%L, array[%L,%L]::uuid[])',
         (select ms_scoped from t_ctx), (select op_north from t_ctx), (select op_south from t_ctx)), '42501');

select tests.throws('cannot grant HFM access without users.manage_access',
  format('select public.grant_employee_access(%L, %L)',
         (select emp_north from t_ctx), (select user_scoped from t_ctx)), '42501');

-- -----------------------------------------------------------------------------
-- Tenant isolation, with real data on both sides
-- -----------------------------------------------------------------------------
select tests.as_user((select user_outside from t_ctx));
insert into public.employees (organization_id, employee_code, full_name)
  select org_b, 'B001', 'Colaborador Org B' from t_ctx;

select tests.check('org B sees only its own employee',
  (select count(*) = 1 from public.employees where organization_id = (select org_b from t_ctx)));

select tests.check('org B sees nothing of org A',
  (select count(*) = 0 from public.employees where organization_id = (select org_a from t_ctx)));

select tests.as_user((select user_admin from t_ctx));
select tests.check('org A sees nothing of org B',
  (select count(*) = 0 from public.employees where organization_id = (select org_b from t_ctx)));

-- -----------------------------------------------------------------------------
-- Access provisioning
-- -----------------------------------------------------------------------------
select tests.throws('access cannot be granted without a corporate e-mail',
  format('select * from public.prepare_employee_access(%L)', (select emp_north from t_ctx)), '22023');

select tests.lives('access can be prepared for an employee with an e-mail',
  format('select * from public.prepare_employee_access(%L)', (select emp_south from t_ctx)));

select public.grant_employee_access(
  (select emp_south from t_ctx), (select user_scoped from t_ctx),
  array[(select id from public.roles where code = 'viewer' and organization_id is null)],
  array[(select op_south from t_ctx)]);

select tests.check('granting access binds the employee to the membership',
  (select employee_id = (select emp_south from t_ctx) from public.organization_memberships
    where user_id = (select user_scoped from t_ctx)));

select tests.check('a granted account starts as invited, never active',
  (select status = 'invited' from public.organization_memberships
    where user_id = (select user_scoped from t_ctx)));

-- -----------------------------------------------------------------------------
-- Import: staging, validation, idempotent persistence, and no account creation
-- -----------------------------------------------------------------------------
insert into public.import_batches (organization_id, type, mode, status, file_name)
  select org_a, 'employees', 'create_update', 'draft', 'test.xlsx' from t_ctx;
update t_ctx set batch = (select id from public.import_batches where file_name = 'test.xlsx');

insert into public.import_rows (organization_id, batch_id, row_number, normalized_data)
select org_a, batch, r.row_number, r.data::jsonb from t_ctx,
  (values
    (2, '{"employee_code":"I001","full_name":"Importado Um","operation_name":"Operação Norte","work_location_name":"Contagem","manager_name":"Importado Dois"}'),
    (3, '{"employee_code":"I002","full_name":"Importado Dois","operation_name":"Operação Norte","cpf":"11144477735"}'),
    (4, '{"employee_code":"","full_name":"Sem Matricula"}'),
    (5, '{"employee_code":"I004","full_name":"Nascimento Futuro","birth_date":"2999-01-01"}'),
    (6, '{"employee_code":"I001","full_name":"Matricula Repetida"}')
  ) as r(row_number, data);

select tests.lives('validation runs', format('select public.validate_employee_import(%L)', (select batch from t_ctx)));

select tests.check('empty registration number is an error',
  exists (select 1 from public.import_errors
           where batch_id = (select batch from t_ctx) and code = 'missing_code' and level = 'error'));

select tests.check('a registration number repeated in the file is an error',
  exists (select 1 from public.import_errors
           where batch_id = (select batch from t_ctx) and code = 'duplicate_code_in_file'));

select tests.check('a CPF already used by another employee is an error',
  exists (select 1 from public.import_errors
           where batch_id = (select batch from t_ctx) and code = 'cpf_other_employee'));

select tests.check('a birth date in the future is an error, not a failed batch',
  exists (select 1 from public.import_errors
           where batch_id = (select batch from t_ctx) and code = 'birth_date_future' and level = 'error'));

select tests.check('new master data is announced as a warning',
  exists (select 1 from public.import_errors
           where batch_id = (select batch from t_ctx) and code = 'new_work_location' and level = 'warning'));

select tests.check('rows with errors are marked to be skipped',
  (select count(*) = 3 from public.import_rows
    where batch_id = (select batch from t_ctx) and action = 'skip'));

select tests.lives('processing runs', format('select public.process_employee_import(%L)', (select batch from t_ctx)));

select tests.check('only the sound rows were persisted',
  (select created_rows = 2 from public.import_batches where id = (select batch from t_ctx)));

select tests.check('the manager was resolved by name in the second pass',
  (select a.manager_employee_id = (select id from public.employees where employee_code = 'I002')
     from public.employee_assignments a
     join public.employees e on e.id = a.employee_id
    where e.employee_code = 'I001' and a.is_current));

select tests.check('the import created no auth user',
  (select count(*) = 3 from auth.users),
  'the three users of this test and nobody else');

select tests.check('the import granted no role',
  (select count(*) = 0 from public.membership_roles mr
     join public.organization_memberships m on m.id = mr.membership_id
    where m.organization_id = (select org_a from t_ctx)
      and m.user_id = (select user_scoped from t_ctx)
      and mr.role_id = (select id from public.roles where code = 'org_admin' and organization_id is null)));

-- The same file again updates instead of duplicating.
update public.import_rows set status = 'pending', action = 'skip'
 where batch_id = (select batch from t_ctx);
update public.import_batches set status = 'draft' where id = (select batch from t_ctx);
select public.validate_employee_import((select batch from t_ctx));

select tests.check('a second run recognises the records as updates',
  (select count(*) = 2 from public.import_rows
    where batch_id = (select batch from t_ctx) and action = 'update'));

-- -----------------------------------------------------------------------------
-- Archiving is never a delete
-- -----------------------------------------------------------------------------
select public.archive_employee((select emp_south from t_ctx), true);

select tests.check('archiving keeps the row',
  (select deleted_at is not null from public.employees where id = (select emp_south from t_ctx)));

select tests.check('archiving suspends the account but keeps it',
  (select status = 'suspended' from public.organization_memberships
    where employee_id = (select emp_south from t_ctx)));

select tests.throws('employees are never hard-deleted by an application user',
  format('delete from public.employees where id = %L', (select emp_north from t_ctx)), '42501');

-- -----------------------------------------------------------------------------
-- Restricted data never reaches the audit trail
-- -----------------------------------------------------------------------------
select tests.check('CPF is redacted in the audit trail',
  not exists (select 1 from public.audit_logs
               where entity_type = 'public.employee_private_data' and new_data ? 'cpf'));

select tests.check('the licence number is redacted in the audit trail',
  not exists (select 1 from public.audit_logs
               where entity_type = 'public.driver_licenses' and new_data ? 'license_number'));

-- -----------------------------------------------------------------------------
-- anon reaches nothing
-- -----------------------------------------------------------------------------
select tests.as_anon();
select tests.throws('anon: no employees',        'select count(*) from public.employees', '42501');
select tests.throws('anon: no directory',        'select count(*) from public.employee_directory', '42501');
select tests.throws('anon: no restricted data',  'select count(*) from public.employee_private_data', '42501');
select tests.throws('anon: no import staging',   'select count(*) from public.import_rows', '42501');
select tests.throws('anon: cannot call save_employee',
  'select public.save_employee(gen_random_uuid(), ''{}''::jsonb)', '42501');
select tests.throws('anon: cannot call grant_employee_access',
  'select public.grant_employee_access(gen_random_uuid(), gen_random_uuid())', '42501');

select tests.reset();
select * from tests.report();
rollback;
