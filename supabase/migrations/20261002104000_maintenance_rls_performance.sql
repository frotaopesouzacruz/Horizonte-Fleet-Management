-- =============================================================================
-- Manutenção — RLS por escopo avaliada uma vez por consulta
--
-- Sintoma em produção (01/10/2026): Gestão de Frota › Manutenção › Visão geral
-- mostrava "Não foi possível carregar a visão geral". O log do banco registra
-- `canceling statement due to statement timeout` em
-- `/rest/v1/rpc/maintenance_dashboard` (limite de 8 s do papel authenticated).
--
-- Causa medida (EXPLAIN ANALYZE como a pessoa real, 1.892 manutenções, 2.475
-- serviços, 2.450 ciclos preventivos): 11,5 s como authenticated contra 1,5 s
-- sem RLS. A política de `maintenances` chama
-- `private.maintenance_in_scope(org, operação, veículo)` — `security definer`,
-- que o planejador não consegue desdobrar — UMA VEZ POR LINHA, e cada chamada
-- refaz `accessible_operation_ids()` / `vehicle_in_scope()`. As políticas de
-- serviços, eventos e apontamentos fazem um EXISTS em `maintenances` que chama a
-- mesma função de novo (e a política de `maintenances` por cima): duas vezes por
-- linha. O painel lê `maintenances` ~9 vezes. É o mesmo padrão corrigido na
-- Aderência por 20260924160000_operation_scope_rls_performance.sql.
--
-- Correção — o mesmo resultado, calculado uma vez por consulta:
--  1. `maintenances`: com operação no contexto, `operation_id in (select
--     accessible_operation_ids())`; sem operação, o veículo no conjunto
--     `private.vehicle_scope_ids('maintenance.view')` (veículos das organizações
--     com maintenance.view que estão no escopo da pessoa). É a definição literal
--     de `maintenance_in_scope`, escrita onde o planejador avalia o conjunto uma
--     vez (subplano com hash). `vehicle_scope_ids` é a regra de
--     `vehicle_in_scope` reescrita como conjunto: uma consulta, não uma chamada
--     por veículo.
--  2. Serviços, eventos e apontamentos: `maintenance_id in (select id from
--     maintenances)` — a política da manutenção, aplicada uma vez.
--  3. Ciclos preventivos/preditivos e verificações: o veículo no mesmo conjunto,
--     em vez de `vehicle_in_scope` por linha. Idem para as leituras de hodômetro
--     (Cadastro de Frotas, vehicles.view), que a matriz preventiva lê inteiras.
--  4. `private.maintenance_filtered`: os parâmetros do filtro num CTE
--     materializado — calculados uma vez, não a cada linha.
--
-- Quem vê o quê não muda (a suíte 20 compara os conjuntos por perfil). Nada é
-- apagado; nenhuma tabela criada; nenhuma permissão concedida além da execução
-- da função nova por authenticated (que só devolve ids que a pessoa já vê).
-- `private.maintenance_in_scope` continua existindo para quem a chama fora da RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Veículos no escopo, uma vez por consulta
-- -----------------------------------------------------------------------------
create or replace function private.vehicle_scope_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- A definição de private.vehicle_in_scope(organização, veículo), escrita como
  -- conjunto: cada subconsulta é avaliada uma vez, não uma vez por veículo.
  select v.id
    from public.vehicles v
   where v.organization_id in (select private.permitted_org_ids(p_permission))
     and ((select private.is_platform_admin())
          or v.organization_id in (select private.permitted_org_ids('operations.access_all'))
          or exists (select 1 from public.vehicle_operation_assignments a
                      where a.vehicle_id = v.id
                        and (a.effective_to is null or a.effective_to >= current_date)
                        and a.operation_id in (select private.accessible_operation_ids()))
          or (v.organization_id in (select private.permitted_org_ids('vehicles.view_unassigned'))
              and not exists (select 1 from public.vehicle_operation_assignments a
                               where a.vehicle_id = v.id
                                 and (a.effective_to is null or a.effective_to >= current_date))));
$$;

revoke execute on function private.vehicle_scope_ids(text) from public, anon;
grant  execute on function private.vehicle_scope_ids(text) to authenticated;

comment on function private.vehicle_scope_ids(text) is
  'Veículos das organizações em que a pessoa tem a permissão informada e que estão no seu escopo de operação — a mesma regra de private.vehicle_in_scope, como conjunto. Usada nas políticas para avaliar o escopo uma vez por consulta.';

-- -----------------------------------------------------------------------------
-- 2. Manutenções: escopo do contexto gravado, sem função por linha
-- -----------------------------------------------------------------------------
alter policy maintenances_select on public.maintenances
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and (
      (operation_id is not null and operation_id in (select private.accessible_operation_ids()))
      or (operation_id is null and vehicle_id in (select private.vehicle_scope_ids('maintenance.view')))
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Filhos da manutenção: a política da manutenção, aplicada uma vez
-- -----------------------------------------------------------------------------
alter policy maintenance_items_select on public.maintenance_items
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and maintenance_id in (select m.id from public.maintenances m)
  );

alter policy maintenance_events_select on public.maintenance_events
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and maintenance_id in (select m.id from public.maintenances m)
  );

alter policy maintenance_finding_links_select on public.maintenance_finding_links
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and maintenance_id in (select m.id from public.maintenances m)
  );

-- -----------------------------------------------------------------------------
-- 4. Dados por veículo (ciclos e verificações): o mesmo conjunto de veículos
-- -----------------------------------------------------------------------------
alter policy maintenance_preventive_cycles_select on public.maintenance_preventive_cycles
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and vehicle_id in (select private.vehicle_scope_ids('maintenance.view'))
  );

alter policy maintenance_predictive_cycles_select on public.maintenance_predictive_cycles
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and vehicle_id in (select private.vehicle_scope_ids('maintenance.view'))
  );

alter policy maintenance_predictive_verifications_select on public.maintenance_predictive_verifications
  using (
    organization_id in (select private.permitted_org_ids('maintenance.view'))
    and vehicle_id in (select private.vehicle_scope_ids('maintenance.view'))
  );

-- -----------------------------------------------------------------------------
-- 5. Leituras de hodômetro (Cadastro de Frotas): o mesmo conjunto de veículos
-- -----------------------------------------------------------------------------
alter policy vehicle_odometer_select on public.vehicle_odometer_readings
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and vehicle_id in (select private.vehicle_scope_ids('vehicles.view'))
  );

-- -----------------------------------------------------------------------------
-- 6. Filtro da Manutenção: parâmetros calculados uma vez (CTE materializado)
-- -----------------------------------------------------------------------------
-- Mesma definição de 20260928105000_maintenance_parameter_reads.sql; só o CTE `f`
-- passa a ser materializado. Sem isso o planejador desdobra o CTE e reavalia,
-- para cada manutenção, os ~20 parâmetros do filtro e o "hoje" da organização.
create or replace function private.maintenance_filtered(p_organization_id uuid, p_filters jsonb)
returns setof public.maintenances
language sql
stable
set search_path = ''
as $$
  with f as materialized (
    select nullif(btrim(p_filters ->> 'search'), '')                    as search,
           private.jsonb_text_array(p_filters -> 'statuses')           as statuses,
           private.jsonb_text_array(p_filters -> 'types')              as types,
           private.jsonb_uuid_array(p_filters -> 'origin_ids')         as origin_ids,
           private.jsonb_text_array(p_filters -> 'priorities')         as priorities,
           private.jsonb_uuid_array(p_filters -> 'vehicle_ids')        as vehicle_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids')   as vehicle_type_ids,
           private.jsonb_uuid_array(p_filters -> 'operation_ids')      as operation_ids,
           private.jsonb_int_array(p_filters -> 'state_ids')           as state_ids,
           private.jsonb_int_array(p_filters -> 'city_ids')            as city_ids,
           private.jsonb_uuid_array(p_filters -> 'br_ids')             as br_ids,
           private.jsonb_uuid_array(p_filters -> 'leader_ids')         as leader_ids,
           private.jsonb_uuid_array(p_filters -> 'unit_ids')           as unit_ids,
           private.jsonb_uuid_array(p_filters -> 'supplier_ids')       as supplier_ids,
           private.jsonb_uuid_array(p_filters -> 'cluster_ids')        as cluster_ids,
           private.jsonb_uuid_array(p_filters -> 'service_ids')        as service_ids,
           private.jsonb_text_array(p_filters -> 'km_statuses')        as km_statuses,
           nullif(p_filters ->> 'date_from', '')::date                 as date_from,
           nullif(p_filters ->> 'date_to', '')::date                   as date_to,
           coalesce(nullif(p_filters ->> 'fleet_status', ''), 'all')   as fleet_status,
           coalesce((p_filters ->> 'open_only')::boolean, false)       as open_only,
           nullif(p_filters ->> 'queue', '')                           as queue,
           private.maintenance_today(p_organization_id)                as today,
           coalesce((select s.schedule_overdue_days from public.maintenance_settings s
                      where s.organization_id = p_organization_id), 5) as overdue_days,
           coalesce((select s.default_sla_hours from public.maintenance_settings s
                      where s.organization_id = p_organization_id), 72) as sla_default
  )
  select m.*
    from public.maintenances m
    cross join f
   where m.organization_id = p_organization_id
     and (f.search is null
          or m.code ilike '%' || f.search || '%'
          or m.license_plate_snapshot ilike '%' || private.normalize_plate(f.search) || '%'
          or coalesce(m.fleet_code_snapshot, '') ilike '%' || f.search || '%'
          or coalesce(m.service_order_number, '') ilike '%' || f.search || '%')
     and (f.statuses is null or m.status = any (f.statuses))
     and (f.types is null or m.maintenance_type_code = any (f.types))
     and (f.origin_ids is null or m.origin_id = any (f.origin_ids))
     and (f.priorities is null or m.priority = any (f.priorities))
     and (f.vehicle_ids is null or m.vehicle_id = any (f.vehicle_ids))
     and (f.vehicle_type_ids is null or m.vehicle_type_id = any (f.vehicle_type_ids))
     and (f.operation_ids is null or m.operation_id = any (f.operation_ids))
     and (f.state_ids is null or m.state_id = any (f.state_ids))
     and (f.city_ids is null or m.city_id = any (f.city_ids))
     and (f.br_ids is null or m.operation_br_id = any (f.br_ids))
     and (f.leader_ids is null or m.leader_employee_id = any (f.leader_ids))
     and (f.unit_ids is null or m.organization_unit_id = any (f.unit_ids))
     and (f.supplier_ids is null or m.supplier_id = any (f.supplier_ids))
     and (f.km_statuses is null or m.entry_km_status = any (f.km_statuses))
     and (f.cluster_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.cluster_id = any (f.cluster_ids)))
     and (f.service_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.service_id = any (f.service_ids)))
     and (f.date_from is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) >= f.date_from)
     and (f.date_to is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) <= f.date_to)
     and (not f.open_only or m.status in ('to_schedule', 'scheduled', 'in_progress'))
     and (f.fleet_status = 'all'
          or (f.fleet_status = 'active') = private.maintenance_vehicle_active(m.vehicle_id))
     -- Filas da Programação: as mesmas definições de maintenance_schedule_kpis,
     -- para que o cartão e a lista que ele abre contem a mesma coisa.
     and (f.queue is null or case f.queue
           when 'scheduled_today' then m.status = 'scheduled' and m.scheduled_date = f.today
           when 'late_entry' then m.status = 'scheduled' and m.scheduled_date < f.today
           when 'exit_overdue' then m.status = 'in_progress' and m.expected_exit_date < f.today
           when 'unscheduled_overdue' then m.status = 'to_schedule' and m.requested_on <= f.today - f.overdue_days
           when 'completed_today' then m.status = 'completed' and m.exit_date = f.today
           when 'over_sla' then m.status = 'in_progress'
             and extract(epoch from (private.maintenance_now(p_organization_id)
                                     - (m.entry_date + coalesce(m.entry_time, time '00:00')))) / 3600
                 > coalesce((select sum(s.expected_hours) from public.maintenance_items i
                               join public.maintenance_services s on s.id = i.service_id
                              where i.maintenance_id = m.id and i.status <> 'cancelled'), f.sla_default)
           else true end);
$$;

-- -----------------------------------------------------------------------------
-- 7. Veículos e alocações (Cadastro de Frotas): o mesmo conjunto
-- -----------------------------------------------------------------------------
-- As leituras da Manutenção juntam `vehicles` a cada ciclo/manutenção; com
-- `vehicle_in_scope(organization_id, id)` na política, a regra roda a cada
-- veículo buscado (milhares de vezes na matriz preventiva). Mesma regra, como
-- conjunto avaliado uma vez.
alter policy vehicles_select on public.vehicles
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('vehicles.archive')))
    and id in (select private.vehicle_scope_ids('vehicles.view'))
  );

alter policy vehicle_assignments_select on public.vehicle_operation_assignments
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and vehicle_id in (select private.vehicle_scope_ids('vehicles.view'))
  );

-- -----------------------------------------------------------------------------
-- 8. Estado preventivo/preditivo: o escopo do veículo como conjunto
-- -----------------------------------------------------------------------------
-- `maintenance_preventive_state` e `maintenance_predictive_state` (security
-- definer) filtravam cada ciclo com `vehicle_in_scope(organização, veículo)` —
-- 2.450 chamadas por leitura da matriz. `org_vehicle_scope_ids` devolve, de uma
-- vez, os veículos da organização no escopo da pessoa: a mesma regra.
create or replace function private.org_vehicle_scope_ids(p_organization_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
    from public.vehicles v
   where v.organization_id = p_organization_id
     and ((select private.is_platform_admin())
          or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
          or exists (select 1 from public.vehicle_operation_assignments a
                      where a.vehicle_id = v.id
                        and (a.effective_to is null or a.effective_to >= current_date)
                        and a.operation_id in (select private.accessible_operation_ids()))
          or (p_organization_id in (select private.permitted_org_ids('vehicles.view_unassigned'))
              and not exists (select 1 from public.vehicle_operation_assignments a
                               where a.vehicle_id = v.id
                                 and (a.effective_to is null or a.effective_to >= current_date))));
$$;

revoke execute on function private.org_vehicle_scope_ids(uuid) from public, anon;
grant  execute on function private.org_vehicle_scope_ids(uuid) to authenticated;

create or replace function private.maintenance_preventive_state(p_organization_id uuid)
returns table (
  cycle_id uuid, vehicle_id uuid, rule_id uuid, cycle_number smallint, milestone_km integer, interval_km integer,
  alert_before_pct numeric, tolerance_after_pct numeric, current_km integer, current_km_date date,
  status text, km_remaining integer, km_exceeded integer, completed_on date, completed_km integer,
  completed_maintenance_id uuid, adherence_km integer, adherence_pct numeric, adherence text,
  open_maintenance_id uuid, open_maintenance_code text, open_maintenance_status text, vehicle_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with km as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_km, r.reading_date
      from public.vehicle_odometer_readings r
     where r.organization_id = p_organization_id and r.superseded_by is null
     order by r.vehicle_id, r.reading_date desc, r.created_at desc
  )
  select c.id, c.vehicle_id, c.rule_id, c.cycle_number, c.milestone_km, c.interval_km,
         c.alert_before_pct, c.tolerance_after_pct, km.odometer_km, km.reading_date,
         private.maintenance_preventive_status(c.milestone_km, c.interval_km, c.alert_before_pct, c.tolerance_after_pct,
                                               km.odometer_km, c.completed_on is not null),
         case when c.completed_on is null and km.odometer_km is not null and km.odometer_km < c.milestone_km
              then c.milestone_km - km.odometer_km end,
         case when c.completed_on is null and km.odometer_km is not null and km.odometer_km > c.milestone_km
              then km.odometer_km - c.milestone_km end,
         c.completed_on, c.completed_km, c.completed_maintenance_id,
         c.completed_km - c.milestone_km,
         case when c.completed_km is not null then round((c.completed_km - c.milestone_km) * 100.0 / c.interval_km, 1) end,
         private.maintenance_preventive_adherence(c.milestone_km, c.interval_km, c.alert_before_pct, c.tolerance_after_pct, c.completed_km),
         om.id, om.code, om.status,
         (v.status = 'active' and v.deleted_at is null)
    from public.maintenance_preventive_cycles c
    join public.vehicles v on v.id = c.vehicle_id
    left join km on km.vehicle_id = c.vehicle_id
    left join lateral (
      select m.id, m.code, m.status from public.maintenances m
       where m.preventive_cycle_id = c.id and m.status in ('to_schedule', 'scheduled', 'in_progress')
       limit 1) om on true
   where c.organization_id = p_organization_id
     and private.has_permission(p_organization_id, 'maintenance.view')
     and c.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id));
$$;

create or replace function private.maintenance_predictive_state(p_organization_id uuid)
returns table (
  cycle_id uuid, vehicle_id uuid, plan_id uuid, plan_name text, plan_version integer, item_id uuid, item_name text,
  cluster_id uuid, cluster_name text, criticality text, interval_km integer, interval_days integer,
  reference_type text, reference_date date, reference_km integer, monitoring_active boolean,
  current_km integer, current_km_date date, next_km integer, next_date date,
  km_remaining integer, days_remaining integer, technical_status text, execution_status text,
  conformity text, open_maintenance_id uuid, open_maintenance_code text, last_verification_on date,
  severity smallint, vehicle_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with km as (
    select distinct on (r.vehicle_id) r.vehicle_id, r.odometer_km, r.reading_date
      from public.vehicle_odometer_readings r
     where r.organization_id = p_organization_id and r.superseded_by is null
     order by r.vehicle_id, r.reading_date desc, r.created_at desc
  ),
  base as (
    select c.*, i.name as item_name, i.cluster_id, cl.name as cluster_name, i.criticality,
           i.interval_km, i.interval_days, i.alert_pct, i.schedule_pct, i.tolerance_pct,
           p.name as plan_name, km.odometer_km, km.reading_date,
           case when c.monitoring_active and c.monitoring_km is not null then c.monitoring_km else i.interval_km end as km_base,
           case when c.monitoring_active and c.monitoring_days is not null then c.monitoring_days else i.interval_days end as day_base,
           (v.status = 'active' and v.deleted_at is null) as vehicle_active
      from public.maintenance_predictive_cycles c
      join public.maintenance_predictive_plan_items i on i.id = c.plan_item_id
      join public.maintenance_predictive_plans p on p.id = c.plan_id
      join public.maintenance_clusters cl on cl.id = i.cluster_id
      join public.vehicles v on v.id = c.vehicle_id
      left join km on km.vehicle_id = c.vehicle_id
     where c.organization_id = p_organization_id and c.is_active
       and private.has_permission(p_organization_id, 'maintenance.view')
       and c.vehicle_id in (select private.org_vehicle_scope_ids(p_organization_id))
  ),
  calc as (
    select b.*,
           case when b.reference_km is not null and b.km_base is not null then b.reference_km + b.km_base end as next_km,
           case when b.reference_date is not null and b.day_base is not null then b.reference_date + b.day_base end as next_date,
           private.maintenance_today(p_organization_id) as today
      from base b
  ),
  graded as (
    select c.*,
           greatest(
             private.maintenance_predictive_band(c.next_km - c.odometer_km, c.km_base, c.alert_pct, c.schedule_pct, c.tolerance_pct),
             private.maintenance_predictive_band(c.next_date - c.today, c.day_base, c.alert_pct, c.schedule_pct, c.tolerance_pct)) as band,
           (select jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status)
              from public.maintenances m
             where m.predictive_cycle_id = c.id and m.status in ('to_schedule', 'scheduled', 'in_progress') limit 1) as open_m,
           (select pv.verified_on from public.maintenance_predictive_verifications pv where pv.id = c.last_verification_id) as last_verif
      from calc c
  )
  select g.id, g.vehicle_id, g.plan_id, g.plan_name, g.plan_version, g.plan_item_id, g.item_name, g.cluster_id, g.cluster_name,
         g.criticality, g.interval_km, g.interval_days, g.reference_type, g.reference_date, g.reference_km, g.monitoring_active,
         g.odometer_km, g.reading_date, g.next_km, g.next_date,
         case when g.next_km is not null and g.odometer_km is not null then g.next_km - g.odometer_km end,
         case when g.next_date is not null then g.next_date - g.today end,
         g.tech_status,
         case
           when g.open_m is not null then g.open_m ->> 'status'
           when g.last_result = 'non_conforming' then 'awaiting_corrective'
           else 'not_programmed'
         end,
         coalesce(g.last_result, 'no_verification'),
         (g.open_m ->> 'id')::uuid, g.open_m ->> 'code', g.last_verif,
         (case g.tech_status when 'critical' then 6 when 'due' then 5 when 'to_schedule' then 4
                              when 'initial_inspection' then 3 when 'upcoming' then 2 when 'ok' then 1 else 0 end)::smallint,
         g.vehicle_active
    from (
      select gr.*,
             case
               when gr.interval_km is not null and gr.odometer_km is null and gr.interval_days is null then 'no_km'
               when gr.reference_type = 'none' then
                 case when gr.interval_km is not null and gr.odometer_km is null then 'no_km' else 'initial_inspection' end
               when gr.band = 5 then 'critical'
               when gr.band = 4 then 'due'
               when gr.band = 3 or (gr.last_result = 'non_conforming') then 'to_schedule'
               when gr.band = 2 then 'upcoming'
               when gr.band = 1 then 'ok'
               else 'no_km'
             end as tech_status
        from graded gr
    ) g;
$$;
