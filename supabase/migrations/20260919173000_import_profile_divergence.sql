-- =============================================================================
-- ETAPA 05 · WHEN THE SPREADSHEET DISAGREES WITH HFM
--
-- The file cannot change anybody's access — that is already structural: the
-- access guard refuses every write to membership_roles that does not come from
-- an audited administration routine, so an import physically cannot promote or
-- demote anyone.
--
-- What was missing is the other half: saying so. A base that declares
-- "Administrador" for somebody HFM knows as Operacional is not an error and not
-- a security incident; it is a question for a person. It is recorded as a
-- warning on the row, and as a pending review an Administrador can settle.
--
-- The HFM profile always wins. The file is never applied.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.official_profile_from_text(text)
-- The profile a free-text column is *talking about*, for comparison only.
-- Recognising the word grants nothing: the result of this function is never
-- written to membership_roles, only compared and reported.
-- -----------------------------------------------------------------------------
create or replace function private.official_profile_from_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case private.normalize_label(coalesce(p_value, ''))
    when ''                        then null
    when 'admin'                   then 'administrador'
    when 'administrador'           then 'administrador'
    when 'administradora'          then 'administrador'
    when 'administrator'           then 'administrador'
    when 'gestor de frota'         then 'gestor_frota'
    when 'gestor frota'            then 'gestor_frota'
    when 'gestao de frota'         then 'gestor_frota'
    when 'frota'                   then 'gestor_frota'
    when 'gestao'                  then 'gestao'
    when 'gestor'                  then 'gestao'
    when 'diretoria'               then 'gestao'
    when 'lideranca'               then 'lideranca_operacoes'
    when 'lideranca operacoes'     then 'lideranca_operacoes'
    when 'lideranca de operacoes'  then 'lideranca_operacoes'
    when 'lider'                   then 'lideranca_operacoes'
    when 'coordenacao'             then 'lideranca_operacoes'
    when 'gente'                   then 'gente'
    when 'rh'                      then 'gente'
    when 'recursos humanos'        then 'gente'
    when 'gente e gestao'          then 'gente'
    when 'seguranca'               then 'seguranca'
    when 'sesmt'                   then 'seguranca'
    when 'seguranca do trabalho'   then 'seguranca'
    when 'operacional'             then 'operacional'
    when 'operacao'                then 'operacional'
    when 'operador'                then 'operacional'
    else null
  end;
$$;

grant execute on function private.official_profile_from_text(text) to authenticated, service_role;

comment on function private.official_profile_from_text(text) is
  'Best-effort reading of a free-text profile column, for comparison and reporting only. Never a grant.';

-- -----------------------------------------------------------------------------
-- public.flag_import_profile_divergences(uuid)
-- Records, per row, that the declared profile differs from the HFM one — and
-- that HFM was preserved. Idempotent: re-running replaces its own findings.
-- -----------------------------------------------------------------------------
create or replace function public.flag_import_profile_divergences(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_count integer := 0;
begin
  select b.organization_id into v_org from public.import_batches b where b.id = p_batch_id;
  if v_org is null then
    raise exception 'import batch not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.import') then
    raise exception 'permission users.import is required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.import_errors
   where batch_id = p_batch_id and code = 'profile_mismatch';

  insert into public.import_errors
    (organization_id, batch_id, row_number, level, field, code, message)
  select
    v_org,
    p_batch_id,
    r.row_number,
    'warning',
    'business_profile',
    'profile_mismatch',
    format(
      'O perfil informado na base ("%s") difere do Perfil de Acesso HFM ("%s"). Nenhuma alteração de acesso foi realizada.',
      r.normalized_data ->> 'business_profile_name',
      current_codes.codes
    )
  from public.import_rows r
  join public.organization_memberships m
    on m.organization_id = v_org and m.employee_id = r.employee_id
  cross join lateral (
    select coalesce(string_agg(ro.code, ', ' order by ro.code), 'sem perfil') as codes
      from public.membership_roles mr
      join public.roles ro on ro.id = mr.role_id
     where mr.membership_id = m.id
  ) current_codes
  where r.batch_id = p_batch_id
    and r.employee_id is not null
    and r.status <> 'error'
    and private.official_profile_from_text(r.normalized_data ->> 'business_profile_name') is not null
    and not exists (
      select 1
        from public.membership_roles mr
        join public.roles ro on ro.id = mr.role_id
       where mr.membership_id = m.id
         and ro.code = private.official_profile_from_text(r.normalized_data ->> 'business_profile_name')
    );

  get diagnostics v_count = row_count;

  -- A divergence never blocks a row; it only moves a clean row to "warning" so
  -- the preview shows it.
  update public.import_rows r
     set status = 'warning'
   where r.batch_id = p_batch_id
     and r.status = 'valid'
     and exists (
       select 1 from public.import_errors e
        where e.batch_id = p_batch_id and e.code = 'profile_mismatch' and e.row_number = r.row_number
     );

  update public.import_batches b set
    valid_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'valid'),
    warning_rows = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'warning')
  where b.id = p_batch_id;

  -- One pending review per person, for an Administrador to settle deliberately.
  -- There is no "apply everything from the file" anywhere in this system: that
  -- button is a mass privilege escalation with a friendly label.
  insert into public.access_profile_reviews
    (organization_id, membership_id, employee_id, reason_code, details)
  select distinct
    v_org,
    m.id,
    r.employee_id,
    'import_declared_profile_ignored',
    jsonb_build_object(
      'declared',  r.normalized_data ->> 'business_profile_name',
      'interpreted_as', private.official_profile_from_text(r.normalized_data ->> 'business_profile_name'),
      'batch_id',  p_batch_id
    )
  from public.import_rows r
  join public.organization_memberships m
    on m.organization_id = v_org and m.employee_id = r.employee_id
  join public.import_errors e
    on e.batch_id = p_batch_id and e.code = 'profile_mismatch' and e.row_number = r.row_number
  where r.batch_id = p_batch_id
    and not exists (
      select 1 from public.access_profile_reviews ar
       where ar.membership_id = m.id
         and ar.reason_code = 'import_declared_profile_ignored'
         and ar.status = 'pending'
    );

  return v_count;
end;
$$;

revoke execute on function public.flag_import_profile_divergences(uuid) from public, anon;
grant  execute on function public.flag_import_profile_divergences(uuid) to authenticated;
