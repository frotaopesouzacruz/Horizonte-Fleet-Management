-- =============================================================================
-- HFM · the operation list needs the operation, not just its counts
--
-- The listing shows code, name, status and when it last changed alongside the
-- headcount and footprint. Reading those from `operations` in a second query,
-- per row, is how an eight-row table becomes seventeen round trips.
-- =============================================================================
create or replace view public.operation_summary
with (security_invoker = true) as
select o.id,
       o.organization_id,
       o.code,
       o.name,
       o.description,
       o.status,
       o.updated_at,
       count(d.id)                                         as employee_count,
       count(d.id) filter (where d.access_status <> 'none') as access_count,
       count(distinct d.work_location_id)                   as location_count,
       (select count(*) from public.operation_states os where os.operation_id = o.id) as state_count,
       (select count(*) from public.operation_cities oc where oc.operation_id = o.id) as city_count
  from public.operations o
  left join public.employee_directory d
         on d.operation_id = o.id
        and d.deleted_at is null
 where o.deleted_at is null
 group by o.id, o.organization_id, o.code, o.name, o.description, o.status, o.updated_at;

comment on view public.operation_summary is
  'One row per operation: identity, status, headcount, accounts and the size of its geographic footprint.';

revoke all on public.operation_summary from anon, authenticated;
grant select on public.operation_summary to authenticated;
