-- =============================================================================
-- HFM · one row per operation, for the Operações screen
--
-- The eight operations are the spine of this company: every employee, every work
-- location and eventually every vehicle hangs off one. Counting them from the
-- application would mean pulling the whole directory to the server just to
-- produce eight numbers, and it would quietly stop being cheap as the base grows.
--
-- security_invoker, so operation scopes still decide which operations a person
-- sees. Someone scoped to two operations gets two rows here, not eight with the
-- others zeroed — a zero would still be a disclosure that the operation exists.
-- =============================================================================
create view public.operation_summary
with (security_invoker = true) as
select o.id,
       o.organization_id,
       o.name,
       o.status,
       count(d.id)                                              as employee_count,
       count(d.id) filter (where d.access_status <> 'none')      as access_count,
       count(distinct d.work_location_id)                        as location_count
  from public.operations o
  left join public.employee_directory d
         on d.operation_id = o.id
        and d.deleted_at is null
 where o.deleted_at is null
 group by o.id, o.organization_id, o.name, o.status;

comment on view public.operation_summary is
  'Operations with headcount, how many of those people hold an HFM account, and how many work locations they span.';

revoke all on public.operation_summary from anon, authenticated;
grant select on public.operation_summary to authenticated;
