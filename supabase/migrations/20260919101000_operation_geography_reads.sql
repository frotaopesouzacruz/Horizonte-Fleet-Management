-- =============================================================================
-- HFM · reading an operation's footprint
--
-- One row per municipality an operation covers, carrying the state it sits in
-- and how many people are currently assigned there. The headcount is the whole
-- point of the screen: "Last Mille MG has 101 people" is a number, "Last Mille
-- MG has 38 in Contagem and 12 in Uberlândia" is an operation.
--
-- security_invoker, so the operation scopes still decide which rows come back,
-- and the headcount is counted under the caller's own visibility of the
-- directory rather than the view owner's.
-- =============================================================================
create view public.operation_geography
with (security_invoker = true) as
select oc.id,
       oc.organization_id,
       oc.operation_id,
       oc.state_id,
       s.uf,
       s.name   as state_name,
       s.region,
       oc.city_id,
       c.name   as city_name,
       c.is_capital,
       c.ddd,
       c.latitude,
       c.longitude,
       (
         select count(*)
           from public.employee_assignments a
           join public.employees e      on e.id = a.employee_id and e.deleted_at is null
           join public.work_locations w on w.id = a.work_location_id
          where a.is_current
            and a.operation_id = oc.operation_id
            and w.city_id = oc.city_id
       ) as employee_count
  from public.operation_cities oc
  join public.states s on s.id = oc.state_id
  join public.cities c on c.id = oc.city_id;

comment on view public.operation_geography is
  'Municipalities covered by each operation, with the state and the headcount currently assigned there.';

revoke all on public.operation_geography from anon, authenticated;
grant select on public.operation_geography to authenticated;

-- ---------------------------------------------------------------------------
-- The operation list gains its footprint, so the index screen can say where an
-- operation runs without a query per row.
-- ---------------------------------------------------------------------------
create or replace view public.operation_summary
with (security_invoker = true) as
select o.id,
       o.organization_id,
       o.name,
       o.status,
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
 group by o.id, o.organization_id, o.name, o.status;

comment on view public.operation_summary is
  'Operations with headcount, how many of those people hold an HFM account, how many work locations they span, and the size of their geographic footprint.';

revoke all on public.operation_summary from anon, authenticated;
grant select on public.operation_summary to authenticated;
