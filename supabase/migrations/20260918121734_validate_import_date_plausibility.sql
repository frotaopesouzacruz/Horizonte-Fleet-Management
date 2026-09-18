-- =============================================================================
-- FIX — date plausibility belongs in validation, not in persistence
--
-- Found by importing the reference QLP file: one row carries a birth date in
-- the future. The employees table rejects it (correctly), but the rejection
-- surfaced as a failed batch instead of a reported row. Validation now catches
-- it, so the row is skipped with a message and the other 143 still land.
-- =============================================================================

create or replace function private.import_date_findings(p_data jsonb)
returns table (level text, field text, code text, message text)
language sql
immutable
set search_path = ''
as $$
  with d(birth, admission, expiry, first_license) as (
    select nullif(p_data ->> 'birth_date', '')::date,
           nullif(p_data ->> 'admission_date', '')::date,
           nullif(p_data ->> 'license_expiration_date', '')::date,
           nullif(p_data ->> 'license_first_date', '')::date
  )
  select 'error', 'birth_date', 'birth_date_future',
         format('Data de nascimento %s está no futuro.', to_char(birth, 'DD/MM/YYYY'))
    from d where birth is not null and birth >= current_date
  union all
  select 'error', 'birth_date', 'birth_date_too_old',
         format('Data de nascimento %s é anterior a 1900.', to_char(birth, 'DD/MM/YYYY'))
    from d where birth is not null and birth <= date '1900-01-01'
  union all
  select 'warning', 'admission_date', 'admission_before_birth',
         'Data de admissão anterior à data de nascimento.'
    from d where birth is not null and admission is not null and admission < birth
  union all
  select 'warning', 'license_expiration_date', 'license_dates_inverted',
         'Validade da CNH anterior à primeira habilitação; a CNH será ignorada.'
    from d where expiry is not null and first_license is not null and expiry < first_license;
$$;

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
  v_org      uuid;
  v_row      record;
  v_data     jsonb;
  v_code     text;
  v_email    text;
  v_cpf      text;
  v_errors   integer;
  v_warns    integer;
  v_employee uuid;
  v_msg      jsonb;
  v_finding  record;
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

    -- dates the application parsed but the domain rejects
    for v_finding in select * from private.import_date_findings(v_data) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, v_finding.level, v_finding.field, v_finding.code, v_finding.message);
      if v_finding.level = 'error' then v_errors := v_errors + 1; else v_warns := v_warns + 1; end if;
    end loop;

    for v_msg in select * from jsonb_array_elements(coalesce(v_data -> 'parse_errors', '[]'::jsonb)) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number,
              coalesce(v_msg ->> 'level', 'error'), v_msg ->> 'field',
              coalesce(v_msg ->> 'code', 'parse_error'), v_msg ->> 'message');
      if coalesce(v_msg ->> 'level', 'error') = 'error' then v_errors := v_errors + 1;
      else v_warns := v_warns + 1; end if;
    end loop;

    if v_code is not null then
      select e.id into v_employee
        from public.employees e
       where e.organization_id = v_org and upper(e.employee_code) = upper(v_code) and e.deleted_at is null;
    end if;

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
