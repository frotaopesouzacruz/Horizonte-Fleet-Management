-- =============================================================================
-- ADMINISTRATION — MANAGERIAL SUMMARY OF THE WORKFORCE
--
-- The Users screen shows five managerial indicators. Each one used to be a
-- separate question, and the honest way to answer five questions about ten
-- thousand people is one scan, not five round trips and never a download of the
-- whole directory into the browser.
--
-- security invoker: every policy of employees/employee_assignments still
-- applies, so the numbers are computed over exactly the rows the caller may
-- see — the same rows the list under them shows. Tenant and operation scope are
-- therefore enforced by RLS, not by the arguments.
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
      a.manager_employee_id
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
      -- Structural filters only. The free-text search is deliberately absent:
      -- it narrows the table, and re-counting the organization on every
      -- keystroke would make the cards flicker without telling anyone anything.
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
      count(*)                                                 as total,
      -- employment_status is the only situation the system keeps, so "ativo" and
      -- "inativo" are read from it literally. on_leave and terminated are
      -- neither, and are reported separately instead of being folded into one
      -- of the two — a colaborador afastado is not an inactive one.
      count(*) filter (where employment_status = 'active')     as active,
      count(*) filter (where employment_status = 'inactive')   as inactive,
      count(*) filter (where employment_status = 'on_leave')   as on_leave,
      count(*) filter (where employment_status = 'terminated') as terminated,
      count(*) filter (where manager_employee_id is not null)  as with_leader,
      count(*) filter (where manager_employee_id is null)      as without_leader,
      count(distinct operation_id)                             as operation_count,
      count(*) filter (where operation_id is null)             as without_operation
    from scoped
  ),
  by_operation as (
    -- Grouped by operations.id. The name is carried along as a label only:
    -- two operations may be renamed to the same text and would still be two.
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
    'by_operation', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'operation_id',   b.operation_id,
                  'operation_name', b.operation_name,
                  'operation_code', b.operation_code,
                  'employee_count', b.employee_count
                )
                -- biggest first; the unassigned bucket always last, whatever its size
                order by (b.operation_id is null), b.employee_count desc, b.operation_name
              )
         from by_operation b),
      '[]'::jsonb
    )
  )
  from totals t;
$$;

comment on function public.employee_summary(uuid, jsonb) is
  'Managerial indicators of the Users module in one pass: headcount, situation, leader link and distribution by operations.id. security invoker, so RLS decides which people are counted.';

revoke execute on function public.employee_summary(uuid, jsonb) from public, anon;
grant  execute on function public.employee_summary(uuid, jsonb) to authenticated;
