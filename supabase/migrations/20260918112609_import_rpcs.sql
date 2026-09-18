-- =============================================================================
-- ADMINISTRATION — IMPORT PIPELINE
--
-- The file is parsed and normalized by the application (dates, Excel serials,
-- "code - name" splits, digit-only documents) and staged as import_rows. What
-- needs the database — uniqueness, conflicts against records that already
-- exist, master-data resolution, manager resolution — happens here.
--
-- An import moves people data. It never creates an auth user, never assigns a
-- role and never widens an operation scope.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.resolve_master_data(...)
-- Finds a catalogue row by code, then by normalized label, and creates it when
-- asked to. This is what keeps "Contagem", "contagem " and "CONTAGEM" from
-- becoming three locations.
-- -----------------------------------------------------------------------------
create or replace function private.resolve_master_data(
  p_organization_id uuid,
  p_kind            text,
  p_code            text,
  p_name            text,
  p_create          boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_code  text := private.normalize_code(p_code);
  v_name  text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_id    uuid;
begin
  v_table := case p_kind
    when 'job_position'      then 'job_positions'
    when 'employment_area'   then 'employment_areas'
    when 'operation'         then 'operations'
    when 'work_location'     then 'work_locations'
    when 'business_profile'  then 'business_profiles'
    when 'organization_unit' then 'organization_units'
  end;
  if v_table is null then
    raise exception 'unknown master data kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if v_name is null and v_code is null then
    return null;
  end if;

  if v_code is not null then
    execute format(
      'select id from public.%I where organization_id = $1 and code = $2 and deleted_at is null limit 1', v_table)
      into v_id using p_organization_id, v_code;
    if v_id is not null then return v_id; end if;
  end if;

  if v_name is not null then
    execute format(
      'select id from public.%I where organization_id = $1
         and private.normalize_label(name) = private.normalize_label($2)
         and deleted_at is null limit 1', v_table)
      into v_id using p_organization_id, v_name;
    if v_id is not null then return v_id; end if;
  end if;

  if not p_create then return null; end if;

  execute format(
    'insert into public.%I (organization_id, code, name) values ($1, $2, $3) returning id', v_table)
    into v_id using p_organization_id, v_code, coalesce(v_name, v_code);

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- public.validate_employee_import(uuid)
-- Turns staged rows into a preview: what is new, what is an update, what is
-- blocked and why. Writes nothing to the final tables.
-- -----------------------------------------------------------------------------
create or replace function public.validate_employee_import(p_batch_id uuid)
returns table (
  total_rows   integer,
  valid_rows   integer,
  warning_rows integer,
  error_rows   integer,
  create_rows  integer,
  update_rows  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_row     record;
  v_data    jsonb;
  v_code    text;
  v_email   text;
  v_cpf     text;
  v_errors  integer;
  v_warns   integer;
  v_employee uuid;
  v_msg     jsonb;
begin
  select b.organization_id into v_org from public.import_batches b where b.id = p_batch_id;
  if v_org is null then
    raise exception 'import batch not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.import') then
    raise exception 'permission users.import is required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.import_errors where batch_id = p_batch_id;

  for v_row in
    select r.id, r.row_number, r.normalized_data
      from public.import_rows r
     where r.batch_id = p_batch_id
     order by r.row_number
  loop
    v_data   := v_row.normalized_data;
    v_errors := 0;
    v_warns  := 0;
    v_code   := nullif(btrim(coalesce(v_data ->> 'employee_code', '')), '');
    v_email  := nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), '');
    v_cpf    := nullif(regexp_replace(coalesce(v_data ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
    v_employee := null;

    -- ---------------------------------------------------------------- blocking
    if v_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'employee_code', 'missing_code', 'Matrícula não informada.');
      v_errors := v_errors + 1;
    end if;

    if nullif(btrim(coalesce(v_data ->> 'full_name', '')), '') is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'full_name', 'missing_name', 'Nome não informado.');
      v_errors := v_errors + 1;
    end if;

    -- duplicates inside the file itself
    if v_code is not null and exists (
      select 1 from public.import_rows r2
       where r2.batch_id = p_batch_id and r2.id <> v_row.id
         and upper(btrim(coalesce(r2.normalized_data ->> 'employee_code', ''))) = upper(v_code)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'employee_code', 'duplicate_code_in_file',
              'Matrícula repetida dentro do arquivo.');
      v_errors := v_errors + 1;
    end if;

    if v_cpf is not null and exists (
      select 1 from public.import_rows r2
       where r2.batch_id = p_batch_id and r2.id <> v_row.id
         and regexp_replace(coalesce(r2.normalized_data ->> 'cpf', ''), '[^0-9]', '', 'g') = v_cpf
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'duplicate_cpf_in_file',
              'CPF repetido dentro do arquivo.');
      v_errors := v_errors + 1;
    end if;

    if v_cpf is not null and not private.is_valid_cpf(v_cpf) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'invalid_cpf', 'CPF inválido.');
      v_errors := v_errors + 1;
    end if;

    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'corporate_email', 'invalid_email', 'E-mail inválido.');
      v_errors := v_errors + 1;
    end if;

    -- values the application could not parse (dates, numbers)
    for v_msg in select * from jsonb_array_elements(coalesce(v_data -> 'parse_errors', '[]'::jsonb)) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number,
              coalesce(v_msg ->> 'level', 'error'), v_msg ->> 'field',
              coalesce(v_msg ->> 'code', 'parse_error'), v_msg ->> 'message');
      if coalesce(v_msg ->> 'level', 'error') = 'error' then v_errors := v_errors + 1;
      else v_warns := v_warns + 1; end if;
    end loop;

    -- existing record: matrícula is the business key
    if v_code is not null then
      select e.id into v_employee
        from public.employees e
       where e.organization_id = v_org and upper(e.employee_code) = upper(v_code) and e.deleted_at is null;
    end if;

    -- conflicts against what is already stored
    if v_cpf is not null and exists (
      select 1 from public.employee_private_data p
       where p.organization_id = v_org and p.cpf = v_cpf
         and (v_employee is null or p.employee_id <> v_employee)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'cpf_other_employee',
              'CPF já cadastrado para outra matrícula.');
      v_errors := v_errors + 1;
    end if;

    if v_email is not null and exists (
      select 1 from public.employees e
       where e.organization_id = v_org and e.corporate_email = v_email and e.deleted_at is null
         and (v_employee is null or e.id <> v_employee)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'corporate_email', 'email_other_employee',
              'E-mail já cadastrado para outra matrícula.');
      v_errors := v_errors + 1;
    end if;

    -- ---------------------------------------------------------------- warnings
    if nullif(btrim(coalesce(v_data ->> 'manager_name', '')), '') is not null
       and not exists (
         select 1 from public.employees e
          where e.organization_id = v_org and e.deleted_at is null
            and private.normalize_label(e.full_name) = private.normalize_label(v_data ->> 'manager_name')
       )
       and not exists (
         select 1 from public.import_rows r3
          where r3.batch_id = p_batch_id
            and private.normalize_label(r3.normalized_data ->> 'full_name')
              = private.normalize_label(v_data ->> 'manager_name')
       )
    then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'manager_name', 'manager_not_found',
              format('Líder "%s" não encontrado; o vínculo ficará sem líder.', v_data ->> 'manager_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'license_category', '') is not null
       and (v_data ->> 'license_category') !~ '^[A-E]{1,3}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'license_category', 'invalid_license_category',
              'Categoria de CNH não reconhecida; a CNH será ignorada.');
      v_warns := v_warns + 1;
    end if;

    -- master data that does not exist yet is created on confirmation, which the
    -- preview states explicitly instead of doing it silently
    if nullif(v_data ->> 'operation_name', '') is not null
       and private.resolve_master_data(v_org, 'operation', null, v_data ->> 'operation_name', false) is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'operation_name', 'new_operation',
              format('Operação "%s" será criada.', v_data ->> 'operation_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'work_location_name', '') is not null
       and private.resolve_master_data(v_org, 'work_location', null, v_data ->> 'work_location_name', false) is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'work_location_name', 'new_work_location',
              format('Localidade "%s" será criada.', v_data ->> 'work_location_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'unit_code', '') is not null or nullif(v_data ->> 'unit_name', '') is not null then
      if private.resolve_master_data(v_org, 'organization_unit', v_data ->> 'unit_code', v_data ->> 'unit_name', false) is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, v_row.row_number, 'warning', 'unit_name', 'new_unit',
                format('Filial "%s" será criada.', coalesce(v_data ->> 'unit_name', v_data ->> 'unit_code')));
        v_warns := v_warns + 1;
      end if;
    end if;

    update public.import_rows
       set status = case when v_errors > 0 then 'error'
                         when v_warns > 0 then 'warning'
                         else 'valid' end,
           action = case when v_errors > 0 then 'skip'
                         when v_employee is null then 'create'
                         else 'update' end,
           employee_id = v_employee
     where id = v_row.id;
  end loop;

  update public.import_batches b set
    status       = 'validated',
    total_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id),
    valid_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'valid'),
    warning_rows = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'warning'),
    error_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'error')
  where b.id = p_batch_id;

  return query
    select b.total_rows, b.valid_rows, b.warning_rows, b.error_rows,
           (select count(*)::integer from public.import_rows r where r.batch_id = p_batch_id and r.action = 'create'),
           (select count(*)::integer from public.import_rows r where r.batch_id = p_batch_id and r.action = 'update')
      from public.import_batches b where b.id = p_batch_id;
end;
$$;
grant execute on function public.validate_employee_import(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- public.process_employee_import(uuid)
-- Persists the approved preview. One transaction: either the batch lands or
-- nothing does.
-- -----------------------------------------------------------------------------
create or replace function public.process_employee_import(p_batch_id uuid)
returns table (created_rows integer, updated_rows integer, skipped_rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_mode     text;
  v_status   text;
  v_row      record;
  v_data     jsonb;
  v_employee uuid;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_position uuid;
  v_area     uuid;
  v_operation uuid;
  v_location uuid;
  v_profile  uuid;
  v_unit     uuid;
  v_manager  uuid;
  v_license_id uuid;
  v_category text;
begin
  select b.organization_id, b.mode, b.status into v_org, v_mode, v_status
    from public.import_batches b where b.id = p_batch_id;
  if v_org is null then
    raise exception 'import batch not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.import') then
    raise exception 'permission users.import is required' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'validated' then
    raise exception 'batch must be validated before processing (current status: %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if v_mode = 'validate' then
    raise exception 'this batch was created in validation-only mode' using errcode = 'invalid_parameter_value';
  end if;

  update public.import_batches set status = 'processing' where id = p_batch_id;

  perform private.emit_event(v_org, 'user.import_started', 'import_batch', p_batch_id,
    jsonb_build_object('mode', v_mode));

  -- Pass 1 — people and their assignment
  for v_row in
    select r.* from public.import_rows r
     where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
     order by r.row_number
  loop
    v_data := v_row.normalized_data;

    if v_row.action = 'skip'
       or (v_row.action = 'update' and v_mode = 'create') then
      update public.import_rows set status = 'skipped' where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_position  := private.resolve_master_data(v_org, 'job_position', v_data ->> 'job_position_code', v_data ->> 'job_position_name');
    v_area      := private.resolve_master_data(v_org, 'employment_area', null, v_data ->> 'employment_area_name');
    v_operation := private.resolve_master_data(v_org, 'operation', null, v_data ->> 'operation_name');
    v_location  := private.resolve_master_data(v_org, 'work_location', null, v_data ->> 'work_location_name');
    v_profile   := private.resolve_master_data(v_org, 'business_profile', null, v_data ->> 'business_profile_name');
    v_unit      := private.resolve_master_data(v_org, 'organization_unit', v_data ->> 'unit_code', v_data ->> 'unit_name');

    if v_row.action = 'create' then
      insert into public.employees (
        organization_id, employee_code, full_name, corporate_email,
        employment_status, admission_date
      ) values (
        v_org,
        v_data ->> 'employee_code',
        v_data ->> 'full_name',
        nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), ''),
        coalesce(nullif(v_data ->> 'employment_status', ''), 'active'),
        nullif(v_data ->> 'admission_date', '')::date
      )
      returning id into v_employee;
      v_created := v_created + 1;
    else
      v_employee := v_row.employee_id;
      update public.employees set
        full_name         = coalesce(nullif(v_data ->> 'full_name', ''), full_name),
        corporate_email   = coalesce(nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), ''), corporate_email),
        employment_status = coalesce(nullif(v_data ->> 'employment_status', ''), employment_status),
        admission_date    = coalesce(nullif(v_data ->> 'admission_date', '')::date, admission_date)
      where id = v_employee;
      v_updated := v_updated + 1;
    end if;

    -- restricted data
    if nullif(v_data ->> 'cpf', '') is not null or nullif(v_data ->> 'birth_date', '') is not null then
      insert into public.employee_private_data (employee_id, organization_id, cpf, birth_date)
      values (
        v_employee, v_org,
        nullif(regexp_replace(coalesce(v_data ->> 'cpf', ''), '[^0-9]', '', 'g'), ''),
        nullif(v_data ->> 'birth_date', '')::date
      )
      on conflict (employee_id) do update set
        cpf = coalesce(excluded.cpf, public.employee_private_data.cpf),
        birth_date = coalesce(excluded.birth_date, public.employee_private_data.birth_date);
    end if;

    -- assignment (manager is resolved in pass 2)
    update public.employee_assignments set
      job_position_id      = coalesce(v_position, job_position_id),
      employment_area_id   = coalesce(v_area, employment_area_id),
      operation_id         = coalesce(v_operation, operation_id),
      organization_unit_id = coalesce(v_unit, organization_unit_id),
      work_location_id     = coalesce(v_location, work_location_id),
      business_profile_id  = coalesce(v_profile, business_profile_id)
    where employee_id = v_employee and is_current;

    if not found then
      insert into public.employee_assignments (
        organization_id, employee_id, job_position_id, employment_area_id, operation_id,
        organization_unit_id, work_location_id, business_profile_id, effective_from, is_current
      ) values (
        v_org, v_employee, v_position, v_area, v_operation, v_unit, v_location, v_profile,
        coalesce(nullif(v_data ->> 'admission_date', '')::date, current_date), true
      );
    end if;

    -- licence
    v_category := nullif(upper(btrim(coalesce(v_data ->> 'license_category', ''))), '');
    if v_category is not null and v_category ~ '^[A-E]{1,3}$' then
      select id into v_license_id from public.driver_licenses
        where employee_id = v_employee and deleted_at is null;

      if v_license_id is null then
        insert into public.driver_licenses (
          organization_id, employee_id, category, license_number,
          expiration_date, first_license_date, points
        ) values (
          v_org, v_employee, v_category,
          nullif(regexp_replace(coalesce(v_data ->> 'license_number', ''), '[^0-9]', '', 'g'), ''),
          nullif(v_data ->> 'license_expiration_date', '')::date,
          nullif(v_data ->> 'license_first_date', '')::date,
          nullif(v_data ->> 'license_points', '')::smallint
        );
      else
        update public.driver_licenses set
          category           = v_category,
          license_number     = coalesce(nullif(regexp_replace(coalesce(v_data ->> 'license_number', ''), '[^0-9]', '', 'g'), ''), license_number),
          expiration_date    = coalesce(nullif(v_data ->> 'license_expiration_date', '')::date, expiration_date),
          first_license_date = coalesce(nullif(v_data ->> 'license_first_date', '')::date, first_license_date),
          points             = coalesce(nullif(v_data ->> 'license_points', '')::smallint, points)
        where id = v_license_id;
      end if;
    end if;

    update public.import_rows
       set status = case when v_row.action = 'create' then 'created' else 'updated' end,
           employee_id = v_employee
     where id = v_row.id;
  end loop;

  -- Pass 2 — managers, now that every person in the file exists
  for v_row in
    select r.id, r.normalized_data, r.employee_id
      from public.import_rows r
     where r.batch_id = p_batch_id
       and r.status in ('created', 'updated')
       and nullif(btrim(coalesce(r.normalized_data ->> 'manager_name', '')), '') is not null
  loop
    select e.id into v_manager
      from public.employees e
     where e.organization_id = v_org and e.deleted_at is null
       and private.normalize_label(e.full_name)
         = private.normalize_label(v_row.normalized_data ->> 'manager_name')
       and e.id <> v_row.employee_id
     limit 1;

    if v_manager is not null then
      update public.employee_assignments
         set manager_employee_id = v_manager
       where employee_id = v_row.employee_id and is_current;
    end if;
  end loop;

  update public.import_batches set
    status       = 'completed',
    created_rows = v_created,
    updated_rows = v_updated,
    skipped_rows = v_skipped,
    processed_at = now(),
    summary = jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped)
  where id = p_batch_id;

  perform private.emit_event(v_org, 'user.import_completed', 'import_batch', p_batch_id,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return query select v_created, v_updated, v_skipped;
exception
  when others then
    -- the transaction is rolled back by the caller; record why it failed
    raise;
end;
$$;
grant execute on function public.process_employee_import(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- public.purge_expired_import_batches()
-- Retention: staged rows hold CPF and licence numbers and must not live
-- forever. Meant for a scheduled job (service_role).
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_import_batches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_privileged_context() and not private.is_platform_admin() then
    raise exception 'privileged context required' using errcode = 'insufficient_privilege';
  end if;

  with deleted as (
    delete from public.import_batches where expires_at < now() returning 1
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;
revoke execute on function public.purge_expired_import_batches() from authenticated;
grant execute on function public.purge_expired_import_batches() to service_role;
