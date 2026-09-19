-- =============================================================================
-- ADMINISTRATION — HFM ACCESS INSIDE THE MANAGERIAL SUMMARY
--
-- The access numbers stopped being the headline of the Users screen; they did
-- not stop mattering. The Total card carries "N com acesso ao HFM" as a quiet
-- second line, and that number has to come from the same scan as the other
-- five — asking the database a sixth question to print a subtitle is how a
-- screen gets slow one small addition at a time.
-- =============================================================================

create or replace function public.employee_summary(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select
      e.id,
      e.employment_status,
      a.operation_id,
      a.manager_employee_id,
      coalesce(m.status, 'none') as access_status
    from public.employees e
    -- is_current is the whole of "relacionamento atual": a closed assignment is
    -- history and never counts, for the leader link or for the operation.
    left join public.employee_assignments a
           on a.employee_id = e.id and a.is_current
    left join public.organization_memberships m
           on m.organization_id = e.organization_id and m.employee_id = e.id
    where e.organization_id = p_organization_id
      and case
            when coalesce((p_filters ->> 'archived')::boolean, false) then e.deleted_at is not null
            else e.deleted_at is null
          end
      and (p_filters ->> 'status'    is null or e.employment_status      = p_filters ->> 'status')
      and (p_filters ->> 'area'      is null or a.employment_area_id     = (p_filters ->> 'area')::uuid)
      and (p_filters ->> 'operation' is null or a.operation_id           = (p_filters ->> 'operation')::uuid)
      and (p_filters ->> 'profile'   is null or a.business_profile_id    = (p_filters ->> 'profile')::uuid)
      and (p_filters ->> 'location'  is null or a.work_location_id       = (p_filters ->> 'location')::uuid)
      and (p_filters ->> 'unit'      is null or a.organization_unit_id   = (p_filters ->> 'unit')::uuid)
      and (p_filters ->> 'manager'   is null or a.manager_employee_id    = (p_filters ->> 'manager')::uuid)
      and (p_filters ->> 'access'    is null
           or (    p_filters ->> 'access' =  'none' and coalesce(m.status, 'none') in ('none', 'removed'))
           or (    p_filters ->> 'access' <> 'none' and coalesce(m.status, 'none') =  p_filters ->> 'access'))
  ),
  totals as (
    select
      count(*)                                                   as total,
      count(*) filter (where employment_status = 'active')       as active,
      count(*) filter (where employment_status = 'inactive')     as inactive,
      count(*) filter (where employment_status = 'on_leave')     as on_leave,
      count(*) filter (where employment_status = 'terminated')   as terminated,
      count(*) filter (where manager_employee_id is not null)    as with_leader,
      count(*) filter (where manager_employee_id is null)        as without_leader,
      count(distinct operation_id)                               as operation_count,
      count(*) filter (where operation_id is null)               as without_operation,
      count(*) filter (where access_status = 'active')           as with_access,
      count(*) filter (where access_status in ('none','removed')) as without_access,
      count(*) filter (where access_status = 'suspended')        as suspended_access,
      count(*) filter (where access_status = 'invited')          as pending_access
    from scoped
  ),
  by_operation as (
    select
      s.operation_id                                as operation_id,
      max(o.name)                                   as operation_name,
      max(o.code)                                   as operation_code,
      count(*)                                      as employee_count
    from scoped s
    left join public.operations o on o.id = s.operation_id
    group by s.operation_id
  )
  select jsonb_build_object(
    'total',             t.total,
    'active',            t.active,
    'inactive',          t.inactive,
    'on_leave',          t.on_leave,
    'terminated',        t.terminated,
    'with_leader',       t.with_leader,
    'without_leader',    t.without_leader,
    'operation_count',   t.operation_count,
    'without_operation', t.without_operation,
    'with_access',       t.with_access,
    'without_access',    t.without_access,
    'suspended_access',  t.suspended_access,
    'pending_access',    t.pending_access,
    'by_operation', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'operation_id',   b.operation_id,
                  'operation_name', b.operation_name,
                  'operation_code', b.operation_code,
                  'employee_count', b.employee_count
                )
                order by (b.operation_id is null), b.employee_count desc, b.operation_name
              )
         from by_operation b),
      '[]'::jsonb
    )
  )
  from totals t;
$$;

revoke execute on function public.employee_summary(uuid, jsonb) from public, anon;
grant  execute on function public.employee_summary(uuid, jsonb) to authenticated;
