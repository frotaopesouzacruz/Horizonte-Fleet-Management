-- =============================================================================
-- ADMINISTRATION — READ MODEL
--
-- One view the Users module reads from, with security_invoker so every
-- underlying policy still applies to the caller. It never carries CPF or birth
-- date: those need their own permission and are fetched one record at a time.
-- =============================================================================

create or replace view public.employee_directory
with (security_invoker = on) as
select
  e.id,
  e.organization_id,
  e.employee_code,
  e.full_name,
  e.corporate_email,
  e.employment_status,
  e.admission_date,
  e.termination_date,
  e.deleted_at,
  e.created_at,
  e.updated_at,
  -- normalized forms so search and ordering are accent-insensitive
  private.normalize_label(e.full_name) as search_name,

  a.id                   as assignment_id,
  a.job_position_id,
  jp.name                as job_position_name,
  jp.code                as job_position_code,
  a.employment_area_id,
  ar.name                as employment_area_name,
  a.operation_id,
  op.name                as operation_name,
  a.organization_unit_id,
  ou.name                as organization_unit_name,
  ou.code                as organization_unit_code,
  a.work_location_id,
  wl.name                as work_location_name,
  a.business_profile_id,
  bp.name                as business_profile_name,
  a.manager_employee_id,
  mg.full_name           as manager_name,

  dl.id                  as driver_license_id,
  dl.category            as license_category,
  dl.expiration_date     as license_expiration_date,
  dl.points              as license_points,
  case
    when dl.id is null or dl.expiration_date is null then null
    when dl.expiration_date < current_date then 'expired'
    when dl.expiration_date <= current_date + 60 then 'expiring'
    else 'valid'
  end                    as license_state,

  m.id                   as membership_id,
  m.user_id              as account_user_id,
  -- Employment situation and HFM access are different things and are reported
  -- separately on purpose.
  coalesce(m.status, 'none') as access_status,
  m.joined_at            as access_since,
  m.updated_at           as access_updated_at,
  coalesce(r.role_codes, array[]::text[]) as access_role_codes,
  coalesce(r.role_names, array[]::text[]) as access_role_names,
  coalesce(s.operation_count, 0)          as access_operation_count,
  coalesce(r.has_access_all, false)       as access_all_operations
from public.employees e
left join public.employee_assignments a
       on a.employee_id = e.id and a.is_current
left join public.job_positions      jp on jp.id = a.job_position_id
left join public.employment_areas   ar on ar.id = a.employment_area_id
left join public.operations         op on op.id = a.operation_id
left join public.organization_units ou on ou.id = a.organization_unit_id
left join public.work_locations     wl on wl.id = a.work_location_id
left join public.business_profiles  bp on bp.id = a.business_profile_id
left join public.employees          mg on mg.id = a.manager_employee_id
left join public.driver_licenses    dl on dl.employee_id = e.id and dl.deleted_at is null
left join public.organization_memberships m
       on m.organization_id = e.organization_id and m.employee_id = e.id
left join lateral (
  select array_agg(ro.code order by ro.code)  as role_codes,
         array_agg(ro.name order by ro.code)  as role_names,
         bool_or(exists (
           select 1 from public.role_permissions rp
             join public.permissions pe on pe.id = rp.permission_id
            where rp.role_id = ro.id and pe.code = 'operations.access_all'
         ))                                    as has_access_all
    from public.membership_roles mr
    join public.roles ro on ro.id = mr.role_id
   where mr.membership_id = m.id
) r on m.id is not null
left join lateral (
  select count(*) as operation_count
    from public.membership_operation_scopes sc
   where sc.membership_id = m.id
) s on m.id is not null;

comment on view public.employee_directory is
  'Read model of the Users module: employee, current assignment, licence summary and HFM access state. security_invoker: RLS of every base table still applies.';

grant select on public.employee_directory to authenticated;

-- -----------------------------------------------------------------------------
-- public.employee_directory_stats(uuid)
-- The compact indicator row. Counted server-side over the rows the caller may
-- actually see, so the numbers never contradict the list under them.
-- -----------------------------------------------------------------------------
create or replace function public.employee_directory_stats(p_organization_id uuid)
returns table (
  total_employees   bigint,
  with_access       bigint,
  without_access    bigint,
  suspended_access  bigint,
  pending_invites   bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where d.deleted_at is null),
    count(*) filter (where d.deleted_at is null and d.access_status = 'active'),
    count(*) filter (where d.deleted_at is null and d.access_status in ('none', 'removed')),
    count(*) filter (where d.deleted_at is null and d.access_status = 'suspended'),
    count(*) filter (where d.deleted_at is null and d.access_status = 'invited')
  from public.employee_directory d
  where d.organization_id = p_organization_id;
$$;
grant execute on function public.employee_directory_stats(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- public.employee_masked_identifiers(uuid)
-- The default interface shows a masked CPF, which everyone who may see the
-- employee is allowed to read; the full number stays behind
-- users.view_sensitive and is read from the table itself.
-- -----------------------------------------------------------------------------
create or replace function public.employee_masked_identifiers(p_employee_id uuid)
returns table (cpf_masked text, birth_year integer, has_cpf boolean, has_birth_date boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_cpf text;
  v_birth date;
begin
  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null then
    return;
  end if;

  if not private.has_permission(v_org, 'users.view')
     or not private.employee_in_scope(v_org, p_employee_id) then
    raise exception 'permission users.view is required' using errcode = 'insufficient_privilege';
  end if;

  select p.cpf, p.birth_date into v_cpf, v_birth
    from public.employee_private_data p
   where p.employee_id = p_employee_id;

  return query select
    case when v_cpf is null then null else '***.***.***-' || right(v_cpf, 2) end,
    extract(year from v_birth)::integer,
    v_cpf is not null,
    v_birth is not null;
end;
$$;
grant execute on function public.employee_masked_identifiers(uuid) to authenticated;
