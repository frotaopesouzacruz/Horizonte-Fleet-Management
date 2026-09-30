-- =============================================================================
-- Mobilizações contam também as trocas inferidas
--
-- Pedido do usuário depois da correção da estabilidade (20260930100000): as
-- 16 trocas de Setembro/2026 vindas da importação de 21/09 são mobilizações e
-- devem entrar no número. Sem contagem dupla:
--   * troca inferida = vínculo titular sem `replaces_assignment_id` que começa
--     no dia seguinte ao fim do titular anterior da BR, com outro veículo;
--     a troca com evento registrado nunca é inferida;
--   * troca inferida recíproca — no mesmo dia, a outra BR recebe o veículo que
--     saiu daqui e o que entrou aqui saiu de lá — é UMA inversão (duas linhas);
--   * as demais são substituições.
-- Setembro/2026: 16 linhas = 8 pares = 8 inversões.
--
-- Saídas novas: explicit_* (só eventos registrados), inferred_substitutions,
-- inferred_inversions e vehicle_change_links (vínculos que entraram por
-- troca). vehicle_substitutions, vehicle_inversions e mobilizations passam a
-- somar explícitas + inferidas; os recortes também. A estabilidade não muda.
-- =============================================================================

create or replace function public.fidelization_stability(
  p_organization_id uuid, p_year integer, p_month integer, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start  date := make_date(p_year, p_month, 1);
  v_end    date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_anchor date := private.competence_anchor(p_year, p_month);
  v_op     uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state  smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city   integer := nullif(p_filters ->> 'city_id', '')::integer;
  v_leader uuid := nullif(p_filters ->> 'leader_employee_id', '')::uuid;
  v_out    jsonb;
begin
  with brs as (
    select b.id, b.code, b.operation_id, o.name as operation_name, b.city_id, ci.name as city_name, st.uf::text as state_uf,
           (select l.employee_id from private.br_leadership_at(b.id, v_anchor) l) as leader_employee_id
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.cities ci on ci.id = b.city_id
      join public.states st on st.id = b.state_id
     where b.organization_id = p_organization_id and b.deleted_at is null and b.status = 'active'
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  brs_f as (
    select b.*, e.full_name as leader_name,
           (select v.vehicle_type_id from public.fidelization_assignments a join public.vehicles v on v.id = a.vehicle_id
             where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)
             order by (a.start_date <= v_anchor and (a.end_date is null or a.end_date >= v_anchor)) desc, a.start_date desc
             limit 1) as vehicle_type_id
      from brs b left join public.employees e on e.id = b.leader_employee_id
     where v_leader is null or b.leader_employee_id = v_leader
  ),
  veh as (
    select b.id as br_id,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                      and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)) as with_vehicle,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                      and a.start_date <= v_anchor and (a.end_date is null or a.end_date >= v_anchor)) as with_vehicle_now,
           exists (select 1 from public.fidelization_assignments a join public.fidelization_drivers d on d.fidelization_assignment_id = a.id
                    where a.operation_br_id = b.id and a.status <> 'cancelled' and d.status <> 'cancelled' and d.driver_role = 'primary'
                      and d.start_date <= v_end and (d.end_date is null or d.end_date >= v_start)) as with_driver,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.replaces_assignment_id is not null and a.status <> 'cancelled'
               and a.start_date between v_start and v_end and a.source <> 'inversion') as substitutions,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.replaces_assignment_id is not null and a.status <> 'cancelled'
               and a.start_date between v_start and v_end and a.source = 'inversion') as inversion_rows,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and a.replaces_assignment_id is null and a.start_date between v_start and v_end
               and exists (select 1 from public.fidelization_assignments p
                            where p.operation_br_id = b.id and p.vehicle_role = 'primary' and p.status <> 'cancelled'
                              and p.end_date = a.start_date - 1 and p.vehicle_id <> a.vehicle_id)) as inferred_changes,
           -- Troca inferida recíproca: no mesmo dia, outra BR recebe o veículo que saiu
           -- daqui e o que entrou aqui saiu de lá — as duas linhas são UMA inversão.
           (select count(*) from public.fidelization_assignments a
              join public.fidelization_assignments p
                on p.operation_br_id = b.id and p.vehicle_role = 'primary' and p.status <> 'cancelled'
               and p.end_date = a.start_date - 1 and p.vehicle_id <> a.vehicle_id
             where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and a.replaces_assignment_id is null and a.start_date between v_start and v_end
               and exists (select 1 from public.fidelization_assignments a2
                             join public.fidelization_assignments p2
                               on p2.operation_br_id = a2.operation_br_id and p2.vehicle_role = 'primary'
                              and p2.status <> 'cancelled' and p2.end_date = a2.start_date - 1 and p2.vehicle_id = a.vehicle_id
                            where a2.operation_br_id <> b.id and a2.vehicle_role = 'primary' and a2.status <> 'cancelled'
                              and a2.replaces_assignment_id is null
                              and a2.start_date = a.start_date and a2.vehicle_id = p.vehicle_id)) as inferred_pair_rows,
           (select count(*) from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
             where a.operation_br_id = b.id and d.status <> 'cancelled' and d.driver_role = 'primary' and d.start_date between v_start and v_end
               and exists (select 1 from public.fidelization_drivers d0 join public.fidelization_assignments a0 on a0.id = d0.fidelization_assignment_id
                            where a0.operation_br_id = b.id and d0.id <> d.id and d0.status <> 'cancelled' and d0.driver_role = 'primary'
                              and d0.end_date = d.start_date - 1 and d0.employee_id <> d.employee_id)) as driver_changes
      from brs_f b
  ),
  agg as (
    select count(*) as brs_total,
           count(*) filter (where v.with_vehicle) as brs_with_vehicle,
           count(*) filter (where v.with_vehicle_now) as brs_with_vehicle_now,
           count(*) filter (where not v.with_vehicle_now) as brs_without_vehicle_now,
           count(*) filter (where v.with_driver) as brs_with_driver,
           count(*) filter (where not v.with_driver) as brs_without_driver,
           count(*) filter (where b.leader_employee_id is not null) as brs_with_leader,
           coalesce(sum(v.substitutions), 0) as substitutions,
           coalesce(sum(v.inversion_rows), 0) as inversion_rows,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_vehicle_change,
           coalesce(sum(v.inferred_changes), 0) as inferred_changes,
           coalesce(sum(v.inferred_pair_rows), 0) as inferred_pair_rows,
           coalesce(sum(v.driver_changes), 0) as driver_changes,
           count(*) filter (where v.driver_changes > 0) as brs_with_driver_change
      from brs_f b join veh v on v.br_id = b.id
  ),
  fleet as (
    select count(distinct a.vehicle_id) as vehicles_fidelized
      from public.fidelization_assignments a join brs_f b on b.id = a.operation_br_id
     where a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)
  ),
  people as (
    select count(distinct d.employee_id) as drivers_fidelized
      from public.fidelization_drivers d
      join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
      join brs_f b on b.id = a.operation_br_id
     where a.status <> 'cancelled' and d.status <> 'cancelled'
       and d.start_date <= v_end and (d.end_date is null or d.end_date >= v_start)
  ),
  registered as (
    select count(*) as brs_registered
      from public.operation_brs b
     where b.organization_id = p_organization_id and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  by_state as (
    select b.state_uf, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0)
             + coalesce(sum(v.inferred_changes - v.inferred_pair_rows), 0) + ceil(coalesce(sum(v.inferred_pair_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.state_uf
  ),
  by_type as (
    select b.vehicle_type_id, vt.name as vehicle_type_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0)
             + coalesce(sum(v.inferred_changes - v.inferred_pair_rows), 0) + ceil(coalesce(sum(v.inferred_pair_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id left join public.vehicle_types vt on vt.id = b.vehicle_type_id
     group by b.vehicle_type_id, vt.name
  ),
  by_op as (
    select b.operation_id, b.operation_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0)
             + coalesce(sum(v.inferred_changes - v.inferred_pair_rows), 0) + ceil(coalesce(sum(v.inferred_pair_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_id, b.operation_name
  ),
  by_city as (
    select b.operation_name, b.city_id, b.city_name, b.state_uf, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0)
             + coalesce(sum(v.inferred_changes - v.inferred_pair_rows), 0) + ceil(coalesce(sum(v.inferred_pair_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_name, b.city_id, b.city_name, b.state_uf
  ),
  by_leader as (
    select b.leader_employee_id, b.leader_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0)
             + coalesce(sum(v.inferred_changes - v.inferred_pair_rows), 0) + ceil(coalesce(sum(v.inferred_pair_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows + v.inferred_changes > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.leader_employee_id, b.leader_name
  )
  select jsonb_build_object(
    'competence', to_char(v_start, 'YYYY-MM'), 'anchor_date', v_anchor, 'period_start', v_start, 'period_end', v_end,
    'brs_total', a.brs_total,
    'brs_registered', (select r.brs_registered from registered r),
    'vehicles_fidelized', (select f.vehicles_fidelized from fleet f),
    'drivers_fidelized', (select pp.drivers_fidelized from people pp),
    'brs_with_vehicle', a.brs_with_vehicle,
    'brs_with_vehicle_now', a.brs_with_vehicle_now,
    'brs_without_vehicle_now', a.brs_without_vehicle_now,
    'brs_with_driver', a.brs_with_driver,
    'brs_without_driver', a.brs_without_driver,
    'brs_with_leader', a.brs_with_leader,
    -- Eventos registrados (substituição/inversão pela tela ou pela importação)…
    'explicit_substitutions', a.substitutions,
    'explicit_inversions', ceil(a.inversion_rows / 2.0)::int,
    'explicit_mobilizations', a.substitutions + ceil(a.inversion_rows / 2.0)::int,
    -- …e as trocas inferidas: a recíproca vira inversão, a demais, substituição.
    'inferred_substitutions', a.inferred_changes - a.inferred_pair_rows,
    'inferred_inversions', ceil(a.inferred_pair_rows / 2.0)::int,
    'vehicle_substitutions', a.substitutions + (a.inferred_changes - a.inferred_pair_rows),
    'vehicle_inversions', ceil(a.inversion_rows / 2.0)::int + ceil(a.inferred_pair_rows / 2.0)::int,
    'mobilizations', a.substitutions + ceil(a.inversion_rows / 2.0)::int
                     + (a.inferred_changes - a.inferred_pair_rows) + ceil(a.inferred_pair_rows / 2.0)::int,
    -- Vínculos que entraram por troca (a inversão abre dois).
    'vehicle_change_links', a.substitutions + a.inversion_rows + a.inferred_changes,
    'brs_with_vehicle_change', a.brs_with_vehicle_change,
    'inferred_vehicle_changes', a.inferred_changes,
    'driver_changes', a.driver_changes,
    'brs_with_driver_change', a.brs_with_driver_change,
    'fleet_stability_pct', case when a.brs_with_vehicle = 0 then null
                                else round(100.0 * (1 - a.brs_with_vehicle_change::numeric / a.brs_with_vehicle), 1) end,
    'driver_stability_pct', case when a.brs_with_driver = 0 then null
                                 else round(100.0 * (1 - a.brs_with_driver_change::numeric / a.brs_with_driver), 1) end,
    'leadership_coverage_pct', case when a.brs_total = 0 then null
                                    else round(100.0 * a.brs_with_leader::numeric / a.brs_total, 1) end,
    'by_operation', coalesce((select jsonb_agg(jsonb_build_object('operation_id', o.operation_id, 'operation_name', o.operation_name, 'brs', o.brs,
                                 'with_vehicle', o.with_vehicle, 'mobilizations', o.mobilizations, 'brs_with_change', o.brs_with_change,
                                 'stability_pct', case when o.with_vehicle = 0 then null else round(100.0 * (1 - o.brs_with_change::numeric / o.with_vehicle), 1) end)
                               order by o.operation_name) from by_op o), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('operation_name', c.operation_name, 'city_id', c.city_id, 'city_name', c.city_name, 'state_uf', c.state_uf,
                            'brs', c.brs, 'with_vehicle', c.with_vehicle, 'mobilizations', c.mobilizations, 'brs_with_change', c.brs_with_change,
                            'stability_pct', case when c.with_vehicle = 0 then null else round(100.0 * (1 - c.brs_with_change::numeric / c.with_vehicle), 1) end)
                          order by c.operation_name, c.city_name) from by_city c), '[]'::jsonb),
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('state_uf', s.state_uf, 'brs', s.brs,
                             'with_vehicle', s.with_vehicle, 'mobilizations', s.mobilizations, 'brs_with_change', s.brs_with_change,
                             'stability_pct', case when s.with_vehicle = 0 then null else round(100.0 * (1 - s.brs_with_change::numeric / s.with_vehicle), 1) end)
                           order by s.state_uf) from by_state s), '[]'::jsonb),
    'by_vehicle_type', coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_id', t.vehicle_type_id,
                             'vehicle_type_name', coalesce(t.vehicle_type_name, 'Sem veículo'), 'brs', t.brs,
                             'with_vehicle', t.with_vehicle, 'mobilizations', t.mobilizations, 'brs_with_change', t.brs_with_change,
                             'stability_pct', case when t.with_vehicle = 0 then null else round(100.0 * (1 - t.brs_with_change::numeric / t.with_vehicle), 1) end)
                           order by (t.vehicle_type_name is null), t.vehicle_type_name) from by_type t), '[]'::jsonb),
    'by_leader', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.leader_employee_id, 'leader_name', coalesce(l.leader_name, 'Sem liderança'),
                              'brs', l.brs, 'with_vehicle', l.with_vehicle, 'mobilizations', l.mobilizations, 'brs_with_change', l.brs_with_change,
                              'stability_pct', case when l.with_vehicle = 0 then null else round(100.0 * (1 - l.brs_with_change::numeric / l.with_vehicle), 1) end)
                            order by (l.leader_name is null), l.leader_name) from by_leader l), '[]'::jsonb)
  ) into v_out from agg a;
  return v_out;
end;
$$;

comment on function public.fidelization_stability(uuid, integer, integer, jsonb) is
  'Dashboard de Estabilidade: estabilidade de frota = 1 − BRs com troca de titular no mês (explícita ou inferida, '
  'cada BR uma vez) / BRs com veículo; mobilizações = substituições + inversões, explícitas (replaces_assignment_id) '
  'e inferidas (troca recíproca no mesmo dia entre duas BRs = 1 inversão), sem contagem dupla; estabilidade de '
  'motoristas = 1 − BRs com troca de motorista / BRs com motorista. Security invoker.';
