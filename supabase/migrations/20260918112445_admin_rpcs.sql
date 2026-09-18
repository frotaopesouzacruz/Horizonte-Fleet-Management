-- =============================================================================
-- ADMINISTRATION — WRITE OPERATIONS
--
-- Multi-table writes go through these functions so a record is never half
-- saved: employee + restricted data + assignment + licence are one transaction,
-- and so is provisioning an account.
--
-- Every function is SECURITY DEFINER and states its own permission check. None
-- of them trusts a client-supplied organization_id: the tenant is always read
-- back from the record being touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.is_valid_cpf(text) — check digits, not just shape.
-- -----------------------------------------------------------------------------
create or replace function private.is_valid_cpf(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_sum    integer;
  v_check  integer;
  i        integer;
begin
  if length(v_digits) <> 11 then return false; end if;
  -- 000.000.000-00, 111.111.111-11 … are structurally valid but never issued
  if v_digits ~ '^(\d)\1{10}$' then return false; end if;

  for pass in 0..1 loop
    v_sum := 0;
    for i in 1..(9 + pass) loop
      v_sum := v_sum + substr(v_digits, i, 1)::integer * ((10 + pass) - i + 1);
    end loop;
    v_check := 11 - (v_sum % 11);
    if v_check >= 10 then v_check := 0; end if;
    if v_check <> substr(v_digits, 10 + pass, 1)::integer then return false; end if;
  end loop;

  return true;
end;
$$;
grant execute on function private.is_valid_cpf(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.save_employee(uuid, jsonb)
-- Creates or updates one employee with its restricted data, current assignment
-- and licence. Returns the employee id.
--
-- Reading CPF needs users.view_sensitive; writing it is part of users.create /
-- users.update, otherwise the registration form could not be filled by the
-- people who are supposed to fill it. Every write is audited with the value
-- redacted.
-- -----------------------------------------------------------------------------
create or replace function public.save_employee(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id           uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_is_new       boolean := v_id is null;
  v_cpf          text := nullif(regexp_replace(coalesce(p_payload #>> '{private,cpf}', ''), '[^0-9]', '', 'g'), '');
  v_birth        date := nullif(p_payload #>> '{private,birth_date}', '')::date;
  v_assignment   jsonb := p_payload -> 'assignment';
  v_license      jsonb := p_payload -> 'license';
  v_existing_org uuid;
  v_license_id   uuid;
begin
  if p_organization_id is null then
    raise exception 'organization is required' using errcode = 'invalid_parameter_value';
  end if;

  if v_is_new then
    if not private.has_permission(p_organization_id, 'users.create') then
      raise exception 'permission users.create is required' using errcode = 'insufficient_privilege';
    end if;
  else
    select e.organization_id into v_existing_org from public.employees e where e.id = v_id;
    if v_existing_org is null then
      raise exception 'employee not found' using errcode = 'no_data_found';
    end if;
    if v_existing_org <> p_organization_id then
      raise exception 'employee belongs to another organization' using errcode = 'insufficient_privilege';
    end if;
    if not private.has_permission(p_organization_id, 'users.update') then
      raise exception 'permission users.update is required' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_cpf is not null and not private.is_valid_cpf(v_cpf) then
    raise exception 'CPF inválido' using errcode = 'check_violation';
  end if;

  -- ---------------------------------------------------------------- employee
  if v_is_new then
    insert into public.employees (
      organization_id, employee_code, full_name, corporate_email,
      employment_status, admission_date, termination_date, notes
    ) values (
      p_organization_id,
      p_payload ->> 'employee_code',
      p_payload ->> 'full_name',
      nullif(p_payload ->> 'corporate_email', ''),
      coalesce(nullif(p_payload ->> 'employment_status', ''), 'active'),
      nullif(p_payload ->> 'admission_date', '')::date,
      nullif(p_payload ->> 'termination_date', '')::date,
      nullif(p_payload ->> 'notes', '')
    )
    returning id into v_id;
  else
    update public.employees set
      employee_code     = coalesce(p_payload ->> 'employee_code', employee_code),
      full_name         = coalesce(p_payload ->> 'full_name', full_name),
      corporate_email   = case when p_payload ? 'corporate_email'
                               then nullif(p_payload ->> 'corporate_email', '') else corporate_email end,
      employment_status = coalesce(nullif(p_payload ->> 'employment_status', ''), employment_status),
      admission_date    = case when p_payload ? 'admission_date'
                               then nullif(p_payload ->> 'admission_date', '')::date else admission_date end,
      termination_date  = case when p_payload ? 'termination_date'
                               then nullif(p_payload ->> 'termination_date', '')::date else termination_date end,
      notes             = case when p_payload ? 'notes'
                               then nullif(p_payload ->> 'notes', '') else notes end
    where id = v_id;
  end if;

  -- ------------------------------------------------------------ private data
  if p_payload ? 'private' then
    if v_cpf is null and v_birth is null then
      delete from public.employee_private_data where employee_id = v_id;
    else
      insert into public.employee_private_data (employee_id, organization_id, cpf, birth_date)
      values (v_id, p_organization_id, v_cpf, v_birth)
      on conflict (employee_id) do update
        set cpf = excluded.cpf, birth_date = excluded.birth_date;
    end if;
  end if;

  -- -------------------------------------------------------------- assignment
  if v_assignment is not null and v_assignment <> 'null'::jsonb then
    update public.employee_assignments set
      job_position_id      = nullif(v_assignment ->> 'job_position_id', '')::uuid,
      employment_area_id   = nullif(v_assignment ->> 'employment_area_id', '')::uuid,
      operation_id         = nullif(v_assignment ->> 'operation_id', '')::uuid,
      organization_unit_id = nullif(v_assignment ->> 'organization_unit_id', '')::uuid,
      work_location_id     = nullif(v_assignment ->> 'work_location_id', '')::uuid,
      business_profile_id  = nullif(v_assignment ->> 'business_profile_id', '')::uuid,
      manager_employee_id  = nullif(v_assignment ->> 'manager_employee_id', '')::uuid
    where employee_id = v_id and is_current;

    if not found then
      insert into public.employee_assignments (
        organization_id, employee_id, job_position_id, employment_area_id, operation_id,
        organization_unit_id, work_location_id, business_profile_id, manager_employee_id,
        effective_from, is_current
      ) values (
        p_organization_id, v_id,
        nullif(v_assignment ->> 'job_position_id', '')::uuid,
        nullif(v_assignment ->> 'employment_area_id', '')::uuid,
        nullif(v_assignment ->> 'operation_id', '')::uuid,
        nullif(v_assignment ->> 'organization_unit_id', '')::uuid,
        nullif(v_assignment ->> 'work_location_id', '')::uuid,
        nullif(v_assignment ->> 'business_profile_id', '')::uuid,
        nullif(v_assignment ->> 'manager_employee_id', '')::uuid,
        coalesce(nullif(p_payload ->> 'admission_date', '')::date, current_date),
        true
      );
    end if;
  end if;

  -- ----------------------------------------------------------------- licence
  if p_payload ? 'license' then
    select id into v_license_id from public.driver_licenses
      where employee_id = v_id and deleted_at is null;

    if v_license is null or v_license = 'null'::jsonb
       or coalesce(nullif(v_license ->> 'category', ''), nullif(v_license ->> 'license_number', '')) is null then
      if v_license_id is not null then
        update public.driver_licenses set deleted_at = now() where id = v_license_id;
      end if;
    elsif v_license_id is null then
      insert into public.driver_licenses (
        organization_id, employee_id, category, license_number,
        expiration_date, first_license_date, points
      ) values (
        p_organization_id, v_id,
        nullif(v_license ->> 'category', ''),
        nullif(v_license ->> 'license_number', ''),
        nullif(v_license ->> 'expiration_date', '')::date,
        nullif(v_license ->> 'first_license_date', '')::date,
        nullif(v_license ->> 'points', '')::smallint
      );
    else
      update public.driver_licenses set
        category           = nullif(v_license ->> 'category', ''),
        license_number     = nullif(v_license ->> 'license_number', ''),
        expiration_date    = nullif(v_license ->> 'expiration_date', '')::date,
        first_license_date = nullif(v_license ->> 'first_license_date', '')::date,
        points             = nullif(v_license ->> 'points', '')::smallint
      where id = v_license_id;
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    if sqlerrm like '%employees_org_code_key%' then
      raise exception 'Já existe um colaborador com esta matrícula.' using errcode = 'unique_violation';
    elsif sqlerrm like '%employees_org_email_key%' then
      raise exception 'Já existe um colaborador com este e-mail.' using errcode = 'unique_violation';
    elsif sqlerrm like '%employee_private_data_org_cpf_key%' then
      raise exception 'Este CPF já está cadastrado para outra matrícula.' using errcode = 'unique_violation';
    end if;
    raise;
end;
$$;
grant execute on function public.save_employee(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- public.archive_employee(uuid, boolean)
-- Deactivation, never deletion. The account is a separate decision, made
-- explicit here instead of happening silently.
-- -----------------------------------------------------------------------------
create or replace function public.archive_employee(p_employee_id uuid, p_suspend_access boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.archive') then
    raise exception 'permission users.archive is required' using errcode = 'insufficient_privilege';
  end if;

  update public.employees
     set deleted_at = now(), employment_status = 'terminated'
   where id = p_employee_id and deleted_at is null;

  update public.employee_assignments
     set is_current = false, effective_to = current_date
   where employee_id = p_employee_id and is_current;

  if p_suspend_access then
    update public.organization_memberships
       set status = 'suspended'
     where organization_id = v_org and employee_id = p_employee_id and status in ('active', 'invited');
  end if;
end;
$$;
grant execute on function public.archive_employee(uuid, boolean) to authenticated;

create or replace function public.restore_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.archive') then
    raise exception 'permission users.archive is required' using errcode = 'insufficient_privilege';
  end if;

  update public.employees
     set deleted_at = null, employment_status = 'active', termination_date = null
   where id = p_employee_id;
end;
$$;
grant execute on function public.restore_employee(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- private.assert_can_assign_roles(uuid, uuid, uuid[])
-- Nobody hands out a role carrying permissions they do not themselves hold, and
-- nobody edits their own access.
-- -----------------------------------------------------------------------------
create or replace function private.assert_can_assign_roles(
  p_organization_id uuid,
  p_target_user_id  uuid,
  p_role_ids        uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role uuid;
begin
  if not private.has_permission(p_organization_id, 'users.manage_roles') then
    raise exception 'permission users.manage_roles is required' using errcode = 'insufficient_privilege';
  end if;

  if p_target_user_id = (select auth.uid()) and not private.is_platform_admin() then
    raise exception 'an account cannot change its own access profile' using errcode = 'insufficient_privilege';
  end if;

  foreach v_role in array coalesce(p_role_ids, array[]::uuid[]) loop
    if not exists (
      select 1 from public.roles r
       where r.id = v_role
         and (r.organization_id is null or r.organization_id = p_organization_id)
         and r.deleted_at is null
    ) then
      raise exception 'role % is not available in this organization', v_role using errcode = 'invalid_parameter_value';
    end if;

    if not private.role_within_actor_permissions(p_organization_id, v_role) then
      raise exception 'cannot grant a role with permissions you do not hold' using errcode = 'insufficient_privilege';
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- public.prepare_employee_access(uuid, uuid[], uuid[])
-- Everything that can be checked before an auth user exists is checked here,
-- so provisioning never leaves an account behind without a membership.
-- -----------------------------------------------------------------------------
create or replace function public.prepare_employee_access(
  p_employee_id  uuid,
  p_role_ids     uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns table (organization_id uuid, email text, membership_id uuid, account_user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_email text;
  v_op    uuid;
begin
  select e.organization_id, e.corporate_email into v_org, v_email
    from public.employees e where e.id = p_employee_id and e.deleted_at is null;

  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null then
    raise exception 'Este colaborador não possui e-mail corporativo. Cadastre um e-mail válido antes de conceder acesso.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_can_assign_roles(v_org, null, p_role_ids);

  if coalesce(array_length(p_operation_ids, 1), 0) > 0
     and not private.has_permission(v_org, 'users.manage_operation_scope') then
    raise exception 'permission users.manage_operation_scope is required' using errcode = 'insufficient_privilege';
  end if;

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.operations o
                    where o.id = v_op and o.organization_id = v_org and o.deleted_at is null) then
      raise exception 'operation % is not available in this organization', v_op using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  return query
    select v_org, v_email, m.id, m.user_id
      from public.organization_memberships m
     where m.organization_id = v_org and m.employee_id = p_employee_id
     union all
    select v_org, v_email, null::uuid, null::uuid
     where not exists (
       select 1 from public.organization_memberships m2
        where m2.organization_id = v_org and m2.employee_id = p_employee_id
     );
end;
$$;
grant execute on function public.prepare_employee_access(uuid, uuid[], uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- public.grant_employee_access(uuid, uuid, uuid[], uuid[])
-- Second half of provisioning: binds the auth user to the employee, sets the
-- roles and the operation scope in one transaction.
-- -----------------------------------------------------------------------------
create or replace function public.grant_employee_access(
  p_employee_id   uuid,
  p_user_id       uuid,
  p_role_ids      uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_membership uuid;
  v_role       uuid;
  v_op         uuid;
begin
  select e.organization_id into v_org
    from public.employees e where e.id = p_employee_id and e.deleted_at is null;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;

  perform private.assert_can_assign_roles(v_org, p_user_id, p_role_ids);

  insert into public.organization_memberships (organization_id, user_id, employee_id, status, joined_at)
  values (v_org, p_user_id, p_employee_id, 'invited', null)
  on conflict (organization_id, user_id) do update
    set employee_id = excluded.employee_id,
        status = case when public.organization_memberships.status = 'removed'
                      then 'invited' else public.organization_memberships.status end
  returning id into v_membership;

  -- roles: replace the set
  delete from public.membership_roles mr
   where mr.membership_id = v_membership
     and mr.role_id <> all (coalesce(p_role_ids, array[]::uuid[]));

  foreach v_role in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.membership_roles (membership_id, role_id)
    values (v_membership, v_role)
    on conflict (membership_id, role_id) do nothing;
  end loop;

  -- operation scope: replace the set
  delete from public.membership_operation_scopes s
   where s.membership_id = v_membership
     and s.operation_id <> all (coalesce(p_operation_ids, array[]::uuid[]));

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id)
    values (v_org, v_membership, v_op)
    on conflict (membership_id, operation_id) do nothing;
  end loop;

  perform private.emit_event(
    v_org, 'user.access_granted', 'employee', p_employee_id,
    jsonb_build_object('membership_id', v_membership, 'role_count', coalesce(array_length(p_role_ids, 1), 0))
  );

  return v_membership;
end;
$$;
grant execute on function public.grant_employee_access(uuid, uuid, uuid[], uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- public.set_employee_access_status(uuid, text)
-- Suspend / reactivate / remove. Employment status is untouched: a person can
-- be active in the company with no access, and the reverse must be deliberate.
-- -----------------------------------------------------------------------------
create or replace function public.set_employee_access_status(p_employee_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_user uuid;
begin
  if p_status not in ('active', 'suspended', 'removed') then
    raise exception 'invalid access status %', p_status using errcode = 'invalid_parameter_value';
  end if;

  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;

  select m.user_id into v_user
    from public.organization_memberships m
   where m.organization_id = v_org and m.employee_id = p_employee_id;

  if v_user is null then
    raise exception 'Este colaborador não possui conta de acesso.' using errcode = 'no_data_found';
  end if;
  if v_user = (select auth.uid()) and not private.is_platform_admin() then
    raise exception 'an account cannot change its own access status' using errcode = 'insufficient_privilege';
  end if;

  update public.organization_memberships
     set status = p_status
   where organization_id = v_org and employee_id = p_employee_id;

  perform private.emit_event(
    v_org,
    case p_status when 'active' then 'user.access_reactivated'
                  when 'suspended' then 'user.access_suspended'
                  else 'user.access_removed' end,
    'employee', p_employee_id, jsonb_build_object('status', p_status)
  );
end;
$$;
grant execute on function public.set_employee_access_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- public.set_membership_roles / public.set_membership_operation_scopes
-- -----------------------------------------------------------------------------
create or replace function public.set_membership_roles(p_membership_id uuid, p_role_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_user uuid;
  v_role uuid;
begin
  select m.organization_id, m.user_id into v_org, v_user
    from public.organization_memberships m where m.id = p_membership_id;
  if v_org is null then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;

  perform private.assert_can_assign_roles(v_org, v_user, p_role_ids);

  delete from public.membership_roles mr
   where mr.membership_id = p_membership_id
     and mr.role_id <> all (coalesce(p_role_ids, array[]::uuid[]));

  foreach v_role in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.membership_roles (membership_id, role_id)
    values (p_membership_id, v_role)
    on conflict (membership_id, role_id) do nothing;
  end loop;

  perform private.emit_event(v_org, 'user.role_changed', 'membership', p_membership_id,
    jsonb_build_object('role_count', coalesce(array_length(p_role_ids, 1), 0)));
end;
$$;
grant execute on function public.set_membership_roles(uuid, uuid[]) to authenticated;

create or replace function public.set_membership_operation_scopes(p_membership_id uuid, p_operation_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_user uuid;
  v_op   uuid;
begin
  select m.organization_id, m.user_id into v_org, v_user
    from public.organization_memberships m where m.id = p_membership_id;
  if v_org is null then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_operation_scope') then
    raise exception 'permission users.manage_operation_scope is required' using errcode = 'insufficient_privilege';
  end if;
  if v_user = (select auth.uid()) and not private.is_platform_admin() then
    raise exception 'an account cannot change its own operation scope' using errcode = 'insufficient_privilege';
  end if;

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.operations o
                    where o.id = v_op and o.organization_id = v_org and o.deleted_at is null) then
      raise exception 'operation % is not available in this organization', v_op using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  delete from public.membership_operation_scopes s
   where s.membership_id = p_membership_id
     and s.operation_id <> all (coalesce(p_operation_ids, array[]::uuid[]));

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id)
    values (v_org, p_membership_id, v_op)
    on conflict (membership_id, operation_id) do nothing;
  end loop;

  perform private.emit_event(v_org, 'user.operation_scope_changed', 'membership', p_membership_id,
    jsonb_build_object('operation_count', coalesce(array_length(p_operation_ids, 1), 0)));
end;
$$;
grant execute on function public.set_membership_operation_scopes(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- public.log_user_export(uuid, text, integer, boolean)
-- An export leaves the system; it is recorded like any other access to data.
-- -----------------------------------------------------------------------------
create or replace function public.log_user_export(
  p_organization_id uuid,
  p_format          text,
  p_row_count       integer,
  p_with_sensitive  boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'users.export') then
    raise exception 'permission users.export is required' using errcode = 'insufficient_privilege';
  end if;
  if p_with_sensitive and not private.has_permission(p_organization_id, 'users.export_sensitive') then
    raise exception 'permission users.export_sensitive is required' using errcode = 'insufficient_privilege';
  end if;

  perform private.emit_event(
    p_organization_id, 'user.exported', 'organization', p_organization_id,
    jsonb_build_object('format', p_format, 'rows', p_row_count, 'sensitive', p_with_sensitive)
  );
end;
$$;
grant execute on function public.log_user_export(uuid, text, integer, boolean) to authenticated;
