-- =============================================================================
-- Etapa 13.1 — Módulo BRs, resolvedor de contexto, estabilidade e motoristas
--
-- O que esta migration acrescenta (nada é destrutivo; nenhuma tabela nova de
-- BRs — `operation_brs` continua sendo a única identidade, §18/§20/§38):
--
-- 1. `resolve_operational_context(org, br, data)` — o serviço central da §45/§47:
--    operação, estado, cidade, BR, veículo, motorista, liderança, filial,
--    vigências e origem de cada vínculo, NA DATA pedida. Uma consulta
--    histórica usa o que valia na data (§54), nunca a placa atual.
-- 2. `br_directory` / `br_detail` / `vehicle_br_history` — o modelo de leitura
--    do módulo BRs (listagem paginada e ordenada no servidor, §24; detalhe
--    completo, §29; BR atual e anteriores de um veículo, §48).
-- 3. `br_planner_indicators` ganha "por liderança" e "com substituição no
--    período" (§22), sem contar a mesma BR duas vezes.
-- 4. `leadership_indicators` ganha locais sem liderança, cobertura, BRs,
--    veículos e motoristas sob responsabilidade (§12), e
--    `leadership_scope_summary` responde "o que este líder responde" (§35).
-- 5. `substitute_fidelization_driver` — substituição transacional de
--    motorista (§34/§35): fecha o anterior na véspera, abre o novo, mesmo
--    veículo, mesma BR, motivo e responsável.
-- 6. `replicate_fidelization_competence` — replicação de veículos e
--    motoristas de uma competência para outra, com prévia, sem sobrescrever o
--    destino (§37, CA16). Origem `replication` no vínculo.
-- 7. `fidelization_stability` — o Dashboard de Estabilidade com fórmulas
--    definidas (§41) e sem contagem dupla de mobilizações (§42): a
--    substituição e a inversão são eventos explícitos (linhas com
--    `replaces_assignment_id`); a troca observada na matriz que não tem
--    evento por trás é classificada como "movimentação inferida".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Origem de vínculo: a replicação declara o que é
-- -----------------------------------------------------------------------------
-- A constraint nasceu na Etapa 08 como `fidelization_source_check`; mantém o nome.
alter table public.fidelization_assignments drop constraint if exists fidelization_source_check;
alter table public.fidelization_assignments drop constraint if exists fidelization_assignments_source_check;
alter table public.fidelization_assignments
  add constraint fidelization_source_check
  check (source in ('manual', 'import', 'substitution', 'inversion', 'replication'));

-- -----------------------------------------------------------------------------
-- 1. Resolvedor central de contexto (§45, §47, §54)
-- -----------------------------------------------------------------------------
create or replace function public.resolve_operational_context(
  p_organization_id uuid, p_operation_br_id uuid, p_date date default current_date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with br as (
    select b.*, o.code as operation_code, o.name as operation_name, o.status as operation_status,
           st.uf::text as state_uf, st.name as state_name, ci.name as city_name
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.states st on st.id = b.state_id
      join public.cities ci on ci.id = b.city_id
     where b.id = p_operation_br_id and b.organization_id = p_organization_id and b.deleted_at is null
  ),
  veh as (
    select a.id as assignment_id, a.vehicle_id, a.start_date, a.end_date, a.status, a.source, a.reason,
           v.fleet_code, v.license_plate, v.organization_unit_id, v.vehicle_type_id,
           vt.name as vehicle_type_name, u.name as unit_name, u.code as unit_code
      from br
      join public.fidelization_assignments a on a.operation_br_id = br.id
      join public.vehicles v on v.id = a.vehicle_id
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
      left join public.organization_units u on u.id = v.organization_unit_id
     where a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= p_date and (a.end_date is null or a.end_date >= p_date)
     order by a.start_date desc limit 1
  ),
  drv as (
    select d.id as driver_id, d.employee_id, d.driver_role, d.start_date, d.end_date, d.status,
           e.full_name, e.employee_code
      from veh
      join public.fidelization_drivers d on d.fidelization_assignment_id = veh.assignment_id
      join public.employees e on e.id = d.employee_id
     where d.status <> 'cancelled' and d.start_date <= p_date and (d.end_date is null or d.end_date >= p_date)
     order by (d.driver_role = 'primary') desc, d.start_date desc limit 1
  ),
  lead as (
    select l.employee_id, l.employee_name, l.scope_level, l.leadership_assignment_id,
           la.effective_from, la.effective_to
      from br, lateral private.br_leadership_at(br.id, p_date) l
      left join public.leadership_assignments la on la.id = l.leadership_assignment_id
  )
  select case when not exists (select 1 from br) then null else jsonb_build_object(
    'date', p_date,
    'organization_id', p_organization_id,
    'operation', (select jsonb_build_object('id', br.operation_id, 'code', br.operation_code, 'name', br.operation_name, 'status', br.operation_status) from br),
    'state', (select jsonb_build_object('id', br.state_id, 'uf', br.state_uf, 'name', br.state_name) from br),
    'city', (select jsonb_build_object('id', br.city_id, 'name', br.city_name, 'operation_city_id', br.operation_city_id) from br),
    'br', (select jsonb_build_object('id', br.id, 'code', br.code, 'description', br.description, 'status', br.status) from br),
    'vehicle', (select jsonb_build_object('id', veh.vehicle_id, 'fleet_code', veh.fleet_code, 'license_plate', veh.license_plate,
                  'vehicle_type_id', veh.vehicle_type_id, 'vehicle_type_name', veh.vehicle_type_name,
                  'assignment_id', veh.assignment_id, 'effective_from', veh.start_date, 'effective_to', veh.end_date,
                  'status', veh.status, 'source', veh.source, 'reason', veh.reason) from veh),
    'driver', (select jsonb_build_object('employee_id', drv.employee_id, 'name', drv.full_name, 'employee_code', drv.employee_code,
                 'driver_id', drv.driver_id, 'role', drv.driver_role, 'effective_from', drv.start_date, 'effective_to', drv.end_date,
                 'status', drv.status) from drv),
    'leadership', (select jsonb_build_object('employee_id', lead.employee_id, 'name', lead.employee_name, 'scope_level', lead.scope_level,
                     'assignment_id', lead.leadership_assignment_id, 'effective_from', lead.effective_from, 'effective_to', lead.effective_to,
                     'rule', case lead.scope_level when 'br' then 'exceção do BR' when 'city' then 'operação + cidade + competência' else 'operação' end) from lead),
    'unit', (select case when veh.organization_unit_id is null then null
                    else jsonb_build_object('id', veh.organization_unit_id, 'code', veh.unit_code, 'name', veh.unit_name) end from veh),
    'origins', jsonb_build_object(
      'vehicle', (select veh.source from veh),
      'leadership', (select lead.scope_level from lead),
      'driver', (select drv.driver_role from drv))
  ) end;
$$;

comment on function public.resolve_operational_context(uuid, uuid, date) is
  'Serviço central de contexto operacional (Etapa 13.1 §45/§47): operação, estado, cidade, BR, veículo, motorista, liderança e filial vigentes NA DATA, com origem e vigência de cada vínculo. Security invoker: a RLS de operation_brs decide.';

-- -----------------------------------------------------------------------------
-- 2. Módulo BRs — listagem paginada e ordenada no servidor (§24)
--
-- Reaproveita `br_planner_rows` (a mesma resolução de liderança, veículo e
-- motorista na data-âncora da competência) e acrescenta a última movimentação
-- e a marca "com substituição no período". A CTE é materializada: a resolução
-- roda uma vez para contar e paginar.
-- -----------------------------------------------------------------------------
create or replace function public.br_directory(
  p_organization_id uuid, p_year integer default null, p_month integer default null,
  p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0,
  p_sort text default 'code', p_dir text default 'asc')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_year   integer := coalesce(p_year,  extract(year  from current_date)::integer);
  v_month  integer := coalesce(p_month, extract(month from current_date)::integer);
  v_start  date := make_date(v_year, v_month, 1);
  v_end    date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort   text := case when p_sort in ('code','operation','city','leader','vehicle','driver','last_movement','status') then p_sort else 'code' end;
  v_desc   boolean := lower(coalesce(p_dir, 'asc')) = 'desc';
  v_swapped text := nullif(p_filters ->> 'swapped', '');
  v_out    jsonb;
begin
  with base as materialized (
    select r.*,
           (select max(greatest(a.created_at, coalesce(a.updated_at, a.created_at)))
              from public.fidelization_assignments a where a.operation_br_id = r.id) as last_movement_at,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = r.id and a.replaces_assignment_id is not null
                      and a.status <> 'cancelled' and a.start_date between v_start and v_end) as swapped_in_period
      from public.br_planner_rows(p_organization_id, v_year, v_month, p_filters) r
  ),
  filtered as (
    select b.*,
           case v_sort
             when 'code' then b.code
             when 'operation' then b.operation_name || ' ' || b.code
             when 'city' then b.city_name || ' ' || b.code
             when 'leader' then b.leader_name
             when 'vehicle' then coalesce(b.fleet_code, b.license_plate)
             when 'driver' then b.driver_name
             when 'status' then b.status || ' ' || b.code
             when 'last_movement' then to_char(b.last_movement_at, 'YYYY-MM-DD HH24:MI:SS.US')
           end as sort_key
      from base b
     where v_swapped is null
        or (v_swapped = 'with' and b.swapped_in_period)
        or (v_swapped = 'without' and not b.swapped_in_period)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', v_limit, 'offset', v_offset,
    'competence', to_char(v_start, 'YYYY-MM'), 'period_start', v_start, 'period_end', v_end,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) - 'sort_key')
        from (select f.* from filtered f
               order by case when not v_desc then f.sort_key end asc nulls last,
                        case when v_desc then f.sort_key end desc nulls last,
                        f.code
               limit v_limit offset v_offset) t), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$$;

comment on function public.br_directory(uuid, integer, integer, jsonb, integer, integer, text, text) is
  'Módulo BRs (Etapa 13.1 §24): listagem paginada e ordenada no servidor, sobre a mesma resolução de br_planner_rows, com última movimentação e substituição no período. Security invoker.';

-- -----------------------------------------------------------------------------
-- 3. Indicadores do módulo BRs (§22): por liderança e com substituição
-- -----------------------------------------------------------------------------
create or replace function public.br_planner_indicators(p_organization_id uuid, p_year integer default null, p_month integer default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_year   integer := coalesce(p_year,  extract(year  from current_date)::integer);
  v_month  integer := coalesce(p_month, extract(month from current_date)::integer);
  v_anchor date    := private.competence_anchor(v_year, v_month);
  v_start  date    := make_date(v_year, v_month, 1);
  v_end    date    := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_op     uuid    := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state  smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city   integer  := nullif(p_filters ->> 'city_id', '')::integer;
  v_result jsonb;
begin
  with base as (
    select b.id, b.status, b.operation_id, b.city_id, b.state_id
      from public.operation_brs b
     where b.organization_id = p_organization_id
       and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  ocupacao as (
    select b.id, b.status,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                      and a.start_date <= v_anchor and (a.end_date is null or a.end_date >= v_anchor)) as com_veiculo_hoje,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.status <> 'cancelled'
                      and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)) as com_veiculo_na_competencia,
           exists (select 1 from public.fidelization_assignments a
                     join public.fidelization_drivers d on d.fidelization_assignment_id = a.id
                    where a.operation_br_id = b.id and a.status <> 'cancelled' and d.status <> 'cancelled'
                      and d.start_date <= v_anchor and (d.end_date is null or d.end_date >= v_anchor)) as com_motorista_hoje,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.replaces_assignment_id is not null
                      and a.status <> 'cancelled' and a.start_date between v_start and v_end) as com_substituicao,
           (select l.employee_id from private.br_leadership_at(b.id, v_anchor) l) as leader_employee_id
      from base b
  )
  select jsonb_build_object(
    'competence',              to_char(v_start, 'YYYY-MM'),
    'anchor_date',             v_anchor,
    'total',                   (select count(*) from base),
    'active',                  (select count(*) from base where status = 'active'),
    'inactive',                (select count(*) from base where status <> 'active'),
    'with_vehicle',            (select count(*) from ocupacao where com_veiculo_hoje),
    'without_vehicle',         (select count(*) from ocupacao where not com_veiculo_hoje),
    'with_vehicle_in_period',  (select count(*) from ocupacao where com_veiculo_na_competencia),
    'with_driver',             (select count(*) from ocupacao where com_motorista_hoje),
    'without_driver',          (select count(*) from ocupacao where not com_motorista_hoje),
    'with_leader',             (select count(*) from ocupacao where leader_employee_id is not null),
    'without_leader',          (select count(*) from ocupacao where leader_employee_id is null and status = 'active'),
    'with_vehicle_swap_in_period', (select count(*) from ocupacao where com_substituicao),
    'by_operation', (
      select coalesce(jsonb_agg(x order by x ->> 'operation_name'), '[]'::jsonb)
        from (select jsonb_build_object('operation_id', b.operation_id, 'operation_name', o.name, 'total', count(*)) as x
                from base b join public.operations o on o.id = b.operation_id
               group by b.operation_id, o.name) s),
    'by_city', (
      select coalesce(jsonb_agg(x order by x ->> 'city_name'), '[]'::jsonb)
        from (select jsonb_build_object('city_id', b.city_id, 'city_name', ci.name, 'state_uf', st.uf, 'total', count(*)) as x
                from base b join public.cities ci on ci.id = b.city_id join public.states st on st.id = b.state_id
               group by b.city_id, ci.name, st.uf) s),
    'by_leader', (
      select coalesce(jsonb_agg(x order by x ->> 'leader_name'), '[]'::jsonb)
        from (select jsonb_build_object('employee_id', oc.leader_employee_id, 'leader_name', e.full_name, 'total', count(*)) as x
                from ocupacao oc join public.employees e on e.id = oc.leader_employee_id
               group by oc.leader_employee_id, e.full_name) s)
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Detalhe do BR (§29) e BR do veículo (§48)
-- -----------------------------------------------------------------------------
create or replace function public.br_detail(
  p_organization_id uuid, p_operation_br_id uuid, p_year integer default null, p_month integer default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_year   integer := coalesce(p_year,  extract(year  from current_date)::integer);
  v_month  integer := coalesce(p_month, extract(month from current_date)::integer);
  v_anchor date    := private.competence_anchor(v_year, v_month);
  v_start  date    := make_date(v_year, v_month, 1);
  v_end    date    := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_br     record;
  v_out    jsonb;
begin
  select b.id, b.code, b.description, b.status, b.status_reason, b.notes, b.operation_id, o.name as operation_name, o.code as operation_code,
         b.operation_city_id, b.state_id, st.uf::text as state_uf, b.city_id, ci.name as city_name,
         b.created_at, b.updated_at
    into v_br
    from public.operation_brs b
    join public.operations o on o.id = b.operation_id
    join public.states st on st.id = b.state_id
    join public.cities ci on ci.id = b.city_id
   where b.id = p_operation_br_id and b.organization_id = p_organization_id and b.deleted_at is null;
  if v_br.id is null then
    return null;
  end if;

  select jsonb_build_object(
    'br', jsonb_build_object('id', v_br.id, 'code', v_br.code, 'description', v_br.description, 'status', v_br.status,
                             'status_reason', v_br.status_reason, 'notes', v_br.notes,
                             'operation_id', v_br.operation_id, 'operation_name', v_br.operation_name, 'operation_code', v_br.operation_code,
                             'operation_city_id', v_br.operation_city_id, 'state_id', v_br.state_id, 'state_uf', v_br.state_uf,
                             'city_id', v_br.city_id, 'city_name', v_br.city_name,
                             'created_at', v_br.created_at, 'updated_at', v_br.updated_at),
    'competence', to_char(v_start, 'YYYY-MM'), 'anchor_date', v_anchor,
    'context', public.resolve_operational_context(p_organization_id, v_br.id, v_anchor),
    -- Lideranças que alcançam esta BR: exceções do próprio BR, principais da cidade e da operação.
    'leadership_history', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'employee_id', l.employee_id, 'employee_name', e.full_name,
                         'scope_level', l.scope_level, 'responsibility_type', l.responsibility_type,
                         'effective_from', l.effective_from, 'effective_to', l.effective_to, 'status', l.status, 'notes', l.notes)
                       order by l.effective_from desc, case l.scope_level when 'br' then 1 when 'city' then 2 else 3 end)
        from public.leadership_assignments l join public.employees e on e.id = l.employee_id
       where l.organization_id = p_organization_id
         and ((l.scope_level = 'br' and l.operation_br_id = v_br.id)
              or (l.scope_level = 'city' and l.operation_city_id = v_br.operation_city_id)
              or (l.scope_level = 'operation' and l.operation_id = v_br.operation_id))), '[]'::jsonb),
    'vehicle_history', coalesce((
      select jsonb_agg(jsonb_build_object('assignment_id', h.assignment_id, 'vehicle_id', h.vehicle_id, 'fleet_code', h.fleet_code,
                         'license_plate', h.license_plate, 'vehicle_role', h.vehicle_role, 'start_date', h.start_date, 'end_date', h.end_date,
                         'status', h.status, 'source', h.source, 'reason', h.reason, 'end_reason', h.end_reason,
                         'replaces_assignment_id', h.replaces_assignment_id, 'created_at', h.created_at)
                       order by h.start_date desc)
        from public.br_vehicle_history(v_br.id) h), '[]'::jsonb),
    'driver_history', coalesce((
      select jsonb_agg(jsonb_build_object('driver_id', d.id, 'assignment_id', d.fidelization_assignment_id, 'employee_id', d.employee_id,
                         'employee_name', e.full_name, 'employee_code', e.employee_code, 'driver_role', d.driver_role,
                         'start_date', d.start_date, 'end_date', d.end_date, 'status', d.status, 'reason', d.reason, 'end_reason', d.end_reason,
                         'vehicle_id', a.vehicle_id, 'fleet_code', v.fleet_code, 'license_plate', v.license_plate)
                       order by d.start_date desc)
        from public.fidelization_drivers d
        join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
        join public.vehicles v on v.id = a.vehicle_id
        join public.employees e on e.id = d.employee_id
       where a.operation_br_id = v_br.id), '[]'::jsonb),
    -- Movimentações explícitas: cada substituição/inversão é UMA linha com o vínculo que substituiu.
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'kind', a.source, 'effective_from', a.start_date,
                         'new_vehicle_id', a.vehicle_id, 'new_fleet_code', v.fleet_code, 'new_license_plate', v.license_plate,
                         'previous_assignment_id', p.id, 'previous_vehicle_id', p.vehicle_id, 'previous_fleet_code', pv.fleet_code,
                         'previous_license_plate', pv.license_plate, 'reason', a.reason, 'created_at', a.created_at, 'created_by', a.created_by,
                         'actor_name', (select prof.full_name from public.profiles prof where prof.user_id = a.created_by))
                       order by a.start_date desc, a.created_at desc)
        from public.fidelization_assignments a
        join public.vehicles v on v.id = a.vehicle_id
        left join public.fidelization_assignments p on p.id = a.replaces_assignment_id
        left join public.vehicles pv on pv.id = p.vehicle_id
       where a.operation_br_id = v_br.id and a.replaces_assignment_id is not null), '[]'::jsonb),
    'indicators', jsonb_build_object(
      'days_with_vehicle', (
        select count(distinct d)::int
          from generate_series(v_start, least(v_end, current_date), interval '1 day') d
         where exists (select 1 from public.fidelization_assignments a
                        where a.operation_br_id = v_br.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                          and a.start_date <= d::date and (a.end_date is null or a.end_date >= d::date))),
      'days_in_period', (v_end - v_start + 1),
      'vehicle_swaps_in_period', (select count(*) from public.fidelization_assignments a
                                   where a.operation_br_id = v_br.id and a.replaces_assignment_id is not null
                                     and a.status <> 'cancelled' and a.start_date between v_start and v_end),
      'driver_changes_in_period', (select count(*) from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
                                    where a.operation_br_id = v_br.id and d.status <> 'cancelled' and d.start_date between v_start and v_end
                                      and exists (select 1 from public.fidelization_drivers d0 join public.fidelization_assignments a0 on a0.id = d0.fidelization_assignment_id
                                                   where a0.operation_br_id = v_br.id and d0.id <> d.id and d0.status <> 'cancelled' and d0.end_date = d.start_date - 1)),
      'checklists_in_period', (select count(*) from public.checklist_executions x
                                where x.operation_br_id = v_br.id and x.operational_date between v_start and v_end),
      'adherence_expected_in_period', (select count(*) from public.adherence_obligation_status s
                                        where s.operation_br_id = v_br.id and s.operational_date between v_start and v_end),
      'adherence_done_in_period', (select count(*) from public.adherence_obligation_status s
                                    where s.operation_br_id = v_br.id and s.operational_date between v_start and v_end and s.is_done))
  ) into v_out;
  return v_out;
end;
$$;

create or replace function public.vehicle_br_history(p_organization_id uuid, p_vehicle_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with rows as (
    select a.id as assignment_id, a.operation_br_id, b.code as br_code, b.description as br_description, b.status as br_status,
           o.id as operation_id, o.name as operation_name, ci.name as city_name, st.uf::text as state_uf,
           a.vehicle_role, a.start_date, a.end_date, a.status, a.source, a.reason, a.end_reason, a.replaces_assignment_id,
           (a.status <> 'cancelled' and a.start_date <= current_date and (a.end_date is null or a.end_date >= current_date)) as is_current
      from public.fidelization_assignments a
      join public.operation_brs b on b.id = a.operation_br_id
      join public.operations o on o.id = b.operation_id
      join public.cities ci on ci.id = b.city_id
      join public.states st on st.id = b.state_id
     where a.organization_id = p_organization_id and a.vehicle_id = p_vehicle_id
  )
  select jsonb_build_object(
    'current', (select to_jsonb(r) from rows r where r.is_current order by r.start_date desc limit 1),
    'history', coalesce((select jsonb_agg(to_jsonb(r) order by r.start_date desc) from rows r), '[]'::jsonb),
    'substitutions', (select count(*) from rows r where r.replaces_assignment_id is not null and r.status <> 'cancelled'));
$$;

comment on function public.vehicle_br_history(uuid, uuid) is
  'Cadastro de Frotas (Etapa 13.1 §48): BR atual e BRs anteriores de um veículo, com períodos, operação e origem. Security invoker.';

-- -----------------------------------------------------------------------------
-- 5. Lideranças: cobertura e responsabilidade (§12, §35)
-- -----------------------------------------------------------------------------
create or replace function public.leadership_indicators(p_organization_id uuid, p_year integer, p_month integer, p_operation_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as last_day,
           private.competence_anchor(p_year, p_month) as anchor
  ),
  inrange as (
    select l.* from public.leadership_directory l cross join bounds
     where l.organization_id = p_organization_id
       and (p_operation_id is null or l.operation_id = p_operation_id)
       and l.status = 'active'
       and daterange(l.effective_from, l.effective_to, '[]') && daterange(bounds.first_day, bounds.last_day, '[]')
  ),
  places as (
    select c.id as operation_city_id, c.operation_id
      from public.operation_cities c join public.operations o on o.id = c.operation_id
     where c.organization_id = p_organization_id and o.deleted_at is null and o.status = 'active'
       and (p_operation_id is null or c.operation_id = p_operation_id)
  ),
  places_led as (
    select p.operation_city_id from places p
     where exists (select 1 from inrange i where i.responsibility_type = 'principal'
                    and ((i.scope_level = 'city' and i.operation_city_id = p.operation_city_id)
                         or (i.scope_level = 'operation' and i.operation_id = p.operation_id)))
  ),
  covered as (
    select b.id, b.operation_id,
           (select l.employee_id from private.br_leadership_at(b.id, (select anchor from bounds)) l) as leader_employee_id
      from public.operation_brs b
     where b.organization_id = p_organization_id and b.deleted_at is null and b.status = 'active'
       and (p_operation_id is null or b.operation_id = p_operation_id)
  ),
  covered_led as (
    select c.id from covered c where c.leader_employee_id is not null
  ),
  vehicles_led as (
    select a.vehicle_id from public.fidelization_assignments a cross join bounds
     where a.operation_br_id in (select id from covered_led) and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= bounds.anchor and (a.end_date is null or a.end_date >= bounds.anchor)
  ),
  drivers_led as (
    select d.employee_id from public.fidelization_drivers d
      join public.fidelization_assignments a on a.id = d.fidelization_assignment_id cross join bounds
     where a.operation_br_id in (select id from covered_led) and a.status <> 'cancelled' and d.status <> 'cancelled'
       and d.start_date <= bounds.anchor and (d.end_date is null or d.end_date >= bounds.anchor)
  )
  select jsonb_build_object(
    'assignments',        (select count(*) from inrange),
    'leaders',            (select count(distinct employee_id) from inrange),
    'by_operation_scope', (select count(*) from inrange where scope_level = 'operation'),
    'by_city_scope',      (select count(*) from inrange where scope_level = 'city'),
    'by_br_scope',        (select count(*) from inrange where scope_level = 'br'),
    'substitutes',        (select count(*) from inrange where responsibility_type <> 'principal'),
    'brs_total',          (select count(*) from covered),
    'brs_with_leader',    (select count(*) from covered_led),
    -- §12
    'places_total',       (select count(*) from places),
    'places_with_leader', (select count(*) from places_led),
    'places_without_leader', (select count(*) from places) - (select count(*) from places_led),
    'coverage_pct',       case when (select count(*) from places) = 0 then null
                               else round(100.0 * (select count(*) from places_led) / (select count(*) from places), 1) end,
    'brs_under_leadership', (select count(*) from covered_led),
    'vehicles_linked',    (select count(distinct vehicle_id) from vehicles_led),
    'drivers_linked',     (select count(distinct employee_id) from drivers_led)
  );
$$;

create or replace function public.leadership_scope_summary(
  p_organization_id uuid, p_employee_id uuid, p_year integer, p_month integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as last_day,
           private.competence_anchor(p_year, p_month) as anchor
  ),
  mine as (
    select l.* from public.leadership_directory l cross join bounds
     where l.organization_id = p_organization_id and l.employee_id = p_employee_id and l.status = 'active'
       and daterange(l.effective_from, l.effective_to, '[]') && daterange(bounds.first_day, bounds.last_day, '[]')
  ),
  brs as (
    select b.id, b.code, b.operation_id, o.name as operation_name, ci.name as city_name, st.uf::text as state_uf,
           l.scope_level
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.cities ci on ci.id = b.city_id
      join public.states st on st.id = b.state_id
      cross join bounds
      cross join lateral private.br_leadership_at(b.id, bounds.anchor) l
     where b.organization_id = p_organization_id and b.deleted_at is null and b.status = 'active'
       and l.employee_id = p_employee_id
  ),
  veh as (
    select a.operation_br_id, a.vehicle_id, v.fleet_code, v.license_plate, a.id as assignment_id
      from public.fidelization_assignments a join public.vehicles v on v.id = a.vehicle_id cross join bounds
     where a.operation_br_id in (select id from brs) and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= bounds.anchor and (a.end_date is null or a.end_date >= bounds.anchor)
  ),
  drv as (
    select d.employee_id, e.full_name, veh.operation_br_id
      from veh join public.fidelization_drivers d on d.fidelization_assignment_id = veh.assignment_id
      join public.employees e on e.id = d.employee_id cross join bounds
     where d.status <> 'cancelled' and d.start_date <= bounds.anchor and (d.end_date is null or d.end_date >= bounds.anchor)
  )
  select jsonb_build_object(
    'employee_id', p_employee_id,
    'competence', to_char((select first_day from bounds), 'YYYY-MM'),
    'anchor_date', (select anchor from bounds),
    'operations', coalesce((select jsonb_agg(distinct jsonb_build_object('operation_id', m.operation_id, 'operation_name', m.operation_name)) from mine m where m.operation_id is not null), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(distinct jsonb_build_object('operation_city_id', m.operation_city_id, 'city_name', m.city_name, 'state_uf', m.state_uf, 'operation_name', m.operation_name)) from mine m where m.operation_city_id is not null), '[]'::jsonb),
    'brs_total', (select count(*) from brs),
    'brs', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'operation_name', b.operation_name, 'city_name', b.city_name, 'state_uf', b.state_uf,
                        'scope_level', b.scope_level,
                        'fleet_code', (select veh.fleet_code from veh where veh.operation_br_id = b.id limit 1),
                        'license_plate', (select veh.license_plate from veh where veh.operation_br_id = b.id limit 1),
                        'driver_name', (select drv.full_name from drv where drv.operation_br_id = b.id limit 1))
                      order by b.operation_name, b.city_name, b.code) from brs b), '[]'::jsonb),
    'vehicles_total', (select count(distinct vehicle_id) from veh),
    'drivers_total', (select count(distinct employee_id) from drv));
$$;

-- -----------------------------------------------------------------------------
-- 6. Substituição transacional de motorista (§34, §35)
-- -----------------------------------------------------------------------------
create or replace function public.substitute_fidelization_driver(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid := nullif(p_payload ->> 'driver_id', '')::uuid;
  v_employee  uuid := nullif(p_payload ->> 'new_employee_id', '')::uuid;
  v_from      date := nullif(p_payload ->> 'effective_from', '')::date;
  v_end       date := nullif(p_payload ->> 'end_date', '')::date;
  v_why       text := left(nullif(btrim(coalesce(p_payload ->> 'reason', '')), ''), 500);
  v_old       public.fidelization_drivers;
  v_assign    public.fidelization_assignments;
  v_emp       record;
  v_new       uuid;
begin
  -- Permissão antes de qualquer leitura: quem não pode trocar motorista não
  -- descobre, pela mensagem, se o vínculo existe ou em que estado está.
  if not private.has_permission(p_organization_id, 'fidelization.change_driver') then
    raise exception 'Você não possui permissão para substituir motoristas.' using errcode = 'insufficient_privilege';
  end if;
  if v_driver_id is null then
    raise exception 'Informe o vínculo de motorista a substituir.' using errcode = 'invalid_parameter_value';
  end if;
  if v_employee is null then
    raise exception 'Escolha o motorista que entra.' using errcode = 'invalid_parameter_value';
  end if;
  if v_from is null then
    raise exception 'Informe a data a partir da qual a substituição vale.' using errcode = 'invalid_parameter_value';
  end if;
  if v_why is null then
    raise exception 'Informe o motivo da substituição.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_old from public.fidelization_drivers
   where id = v_driver_id and organization_id = p_organization_id for update;
  if v_old.id is null then
    raise exception 'Vínculo de motorista não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'Este vínculo de motorista está cancelado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_old.employee_id = v_employee then
    raise exception 'O motorista escolhido já é o motorista atual.' using errcode = 'invalid_parameter_value';
  end if;
  if v_old.end_date is not null and v_from > v_old.end_date then
    raise exception 'A substituição (%) é posterior ao fim do vínculo (%).',
      to_char(v_from, 'DD/MM/YYYY'), to_char(v_old.end_date, 'DD/MM/YYYY') using errcode = 'invalid_parameter_value';
  end if;

  select * into v_assign from public.fidelization_assignments where id = v_old.fidelization_assignment_id for update;
  perform private.lock_br(v_assign.operation_br_id, 'fidelization.change_driver');

  if v_assign.end_date is not null and v_end is not null and v_end > v_assign.end_date then
    raise exception 'O fim do novo motorista (%) ultrapassa o fim do vínculo do veículo (%).',
      to_char(v_end, 'DD/MM/YYYY'), to_char(v_assign.end_date, 'DD/MM/YYYY') using errcode = 'invalid_parameter_value';
  end if;

  select e.id, e.full_name, e.employment_status, e.deleted_at into v_emp
    from public.employees e where e.id = v_employee and e.organization_id = p_organization_id;
  if v_emp.id is null or v_emp.deleted_at is not null then
    raise exception 'Colaborador não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_emp.employment_status <> 'active' then
    raise exception 'O colaborador % não está ativo no cadastro.', v_emp.full_name using errcode = 'invalid_parameter_value';
  end if;

  -- Fecha primeiro (a ocupação do motorista principal é constraint imediata).
  if v_from <= v_old.start_date then
    update public.fidelization_drivers set status = 'cancelled', end_reason = v_why where id = v_old.id;
  else
    update public.fidelization_drivers set end_date = v_from - 1, end_reason = v_why where id = v_old.id;
  end if;

  insert into public.fidelization_drivers
    (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status, reason)
  values
    (p_organization_id, v_old.fidelization_assignment_id, v_employee, v_old.driver_role,
     greatest(v_from, v_old.start_date), coalesce(v_end, v_old.end_date, v_assign.end_date), 'planned', v_why)
  returning id into v_new;

  return jsonb_build_object('previous_id', v_old.id, 'new_id', v_new, 'assignment_id', v_old.fidelization_assignment_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Replicação da fidelização (§37, CA16): veículos e motoristas, com prévia
-- -----------------------------------------------------------------------------
create or replace function public.replicate_fidelization_competence(
  p_organization_id uuid, p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer,
  p_operation_id uuid default null, p_include_drivers boolean default true, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_last date := (make_date(p_from_year, p_from_month, 1) + interval '1 month - 1 day')::date;
  v_to_start  date := make_date(p_to_year, p_to_month, 1);
  v_to_end    date := (make_date(p_to_year, p_to_month, 1) + interval '1 month - 1 day')::date;
  v_why       text := format('Replicado de %s/%s', lpad(p_from_month::text, 2, '0'), p_from_year);
  x           record;
  v_new       uuid;
  v_rows      jsonb := '[]'::jsonb;
  n_new integer := 0; n_kept integer := 0; n_conflict integer := 0; n_inactive integer := 0;
  d_new integer := 0; d_kept integer := 0; d_conflict integer := 0; d_inactive integer := 0;
  v_status text; v_note text; v_driver_status text; v_driver_note text;
begin
  if not private.has_permission(p_organization_id, 'fidelization.plan') then
    raise exception 'Você não possui permissão para replicar o planejamento da fidelização.' using errcode = 'insufficient_privilege';
  end if;
  if p_include_drivers and not private.has_permission(p_organization_id, 'fidelization.change_driver') then
    raise exception 'Você não possui permissão para replicar motoristas.' using errcode = 'insufficient_privilege';
  end if;
  if v_to_start <= make_date(p_from_year, p_from_month, 1) then
    raise exception 'A competência de destino precisa ser posterior à de origem.' using errcode = 'invalid_parameter_value';
  end if;
  if p_operation_id is not null and not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.' using errcode = 'insufficient_privilege';
  end if;

  for x in
    select b.id as br_id, b.code as br_code, b.status as br_status, b.operation_id,
           a.id as assignment_id, a.vehicle_id, v.fleet_code, v.license_plate, v.status as vehicle_status, v.deleted_at as vehicle_deleted,
           (select d.employee_id from public.fidelization_drivers d
             where d.fidelization_assignment_id = a.id and d.status <> 'cancelled' and d.driver_role = 'primary'
               and d.start_date <= v_from_last and (d.end_date is null or d.end_date >= v_from_last)
             order by d.start_date desc limit 1) as driver_employee_id
      from public.operation_brs b
      join public.fidelization_assignments a on a.operation_br_id = b.id
      join public.vehicles v on v.id = a.vehicle_id
     where b.organization_id = p_organization_id and b.deleted_at is null
       and (p_operation_id is null or b.operation_id = p_operation_id)
       and private.can_access_operation(b.operation_id)
       and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_from_last and (a.end_date is null or a.end_date >= v_from_last)
     order by b.code
  loop
    v_driver_status := null; v_driver_note := null; v_new := null;

    if x.br_status <> 'active' then
      v_status := 'skipped_inactive_br'; v_note := 'BR inativa'; n_inactive := n_inactive + 1;
    elsif x.vehicle_deleted is not null or x.vehicle_status <> 'active' then
      v_status := 'skipped_inactive_vehicle'; v_note := 'Veículo inativo ou arquivado'; n_inactive := n_inactive + 1;
    elsif exists (select 1 from public.fidelization_assignments a
                   where a.operation_br_id = x.br_id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                     and daterange(a.start_date, a.end_date, '[]') && daterange(v_to_start, v_to_end, '[]')) then
      -- O destino já tem planejamento: preservado, nunca sobrescrito.
      select a.id into v_new from public.fidelization_assignments a
       where a.operation_br_id = x.br_id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
         and daterange(a.start_date, a.end_date, '[]') && daterange(v_to_start, v_to_end, '[]')
       order by a.start_date limit 1;
      v_status := 'kept'; v_note := 'Destino já planejado'; n_kept := n_kept + 1;
    elsif exists (select 1 from public.fidelization_assignments a
                   where a.vehicle_id = x.vehicle_id and a.status <> 'cancelled' and a.operation_br_id <> x.br_id
                     and daterange(a.start_date, a.end_date, '[]') && daterange(v_to_start, v_to_end, '[]')) then
      v_status := 'conflict'; v_note := 'Veículo já planejado em outra BR no destino'; n_conflict := n_conflict + 1;
    else
      v_status := 'new'; v_note := null; n_new := n_new + 1;
      if not p_dry_run then
        insert into public.fidelization_assignments
          (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
        values (p_organization_id, x.br_id, x.vehicle_id, 'primary', v_to_start, v_to_end, 'planned', 'replication', v_why)
        returning id into v_new;
      end if;
    end if;

    -- Motoristas: só entram onde há (ou haverá) um vínculo de veículo no destino sem motorista principal.
    if p_include_drivers and x.driver_employee_id is not null and v_status in ('new', 'kept') then
      if not exists (select 1 from public.employees e where e.id = x.driver_employee_id and e.employment_status = 'active' and e.deleted_at is null) then
        v_driver_status := 'skipped_inactive_driver'; v_driver_note := 'Motorista inativo'; d_inactive := d_inactive + 1;
      elsif v_status = 'kept' and exists (select 1 from public.fidelization_drivers d
                                          where d.fidelization_assignment_id = v_new and d.status <> 'cancelled' and d.driver_role = 'primary'
                                            and daterange(d.start_date, d.end_date, '[]') && daterange(v_to_start, v_to_end, '[]')) then
        v_driver_status := 'kept'; v_driver_note := 'Destino já tem motorista'; d_kept := d_kept + 1;
      elsif exists (select 1 from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
                     where d.employee_id = x.driver_employee_id and d.status <> 'cancelled' and d.driver_role = 'primary'
                       and a.operation_br_id <> x.br_id
                       and daterange(d.start_date, d.end_date, '[]') && daterange(v_to_start, v_to_end, '[]')) then
        v_driver_status := 'conflict'; v_driver_note := 'Motorista já planejado em outra BR no destino'; d_conflict := d_conflict + 1;
      else
        v_driver_status := 'new'; d_new := d_new + 1;
        if not p_dry_run and v_new is not null then
          insert into public.fidelization_drivers
            (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status, reason)
          values (p_organization_id, v_new, x.driver_employee_id, 'primary',
                  greatest(v_to_start, (select a.start_date from public.fidelization_assignments a where a.id = v_new)),
                  least(v_to_end, coalesce((select a.end_date from public.fidelization_assignments a where a.id = v_new), v_to_end)),
                  'planned', v_why);
        end if;
      end if;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'br_id', x.br_id, 'br_code', x.br_code, 'vehicle_id', x.vehicle_id, 'fleet_code', x.fleet_code, 'license_plate', x.license_plate,
      'status', v_status, 'note', v_note,
      'driver_employee_id', x.driver_employee_id,
      'driver_name', (select e.full_name from public.employees e where e.id = x.driver_employee_id),
      'driver_status', v_driver_status, 'driver_note', v_driver_note);
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'from', to_char(make_date(p_from_year, p_from_month, 1), 'YYYY-MM'), 'to', to_char(v_to_start, 'YYYY-MM'),
    'vehicles', jsonb_build_object('new', n_new, 'kept', n_kept, 'conflicts', n_conflict, 'skipped', n_inactive),
    'drivers',  jsonb_build_object('new', d_new, 'kept', d_kept, 'conflicts', d_conflict, 'skipped', d_inactive),
    'rows', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Dashboard de Estabilidade (§39–§43)
--
-- Definições (documentadas em docs/modules/fidelization.md):
--   universo            BRs ativas da organização (filtros aplicados)
--   com veículo         BR com titular não cancelado que toca a competência
--   troca de veículo    vínculo com replaces_assignment_id (substituição,
--                       inversão ou importação-substituição) iniciado no mês —
--                       UM evento por linha; a inversão gera duas linhas e
--                       conta como UM evento (par)
--   BR com troca        BR com pelo menos uma troca no mês (conta uma vez)
--   estabilidade frota  1 − BRs com troca / BRs com veículo no mês
--   troca de motorista  motorista principal iniciado no mês cujo antecessor no
--                       mesmo BR terminou na véspera
--   estabilidade motor. 1 − BRs com troca de motorista / BRs com motorista no mês
--   cobertura lideranç. BRs ativas com liderança na data-âncora / BRs ativas
--   mov. inferida       troca de titular observada entre vínculos consecutivos
--                       SEM replaces_assignment_id — mostrada à parte, nunca
--                       somada às mobilizações confirmadas (§42)
-- -----------------------------------------------------------------------------
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
    select b.*, e.full_name as leader_name from brs b left join public.employees e on e.id = b.leader_employee_id
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
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_vehicle_change,
           coalesce(sum(v.inferred_changes), 0) as inferred_changes,
           coalesce(sum(v.driver_changes), 0) as driver_changes,
           count(*) filter (where v.driver_changes > 0) as brs_with_driver_change
      from brs_f b join veh v on v.br_id = b.id
  ),
  by_op as (
    select b.operation_id, b.operation_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_id, b.operation_name
  ),
  by_city as (
    select b.operation_name, b.city_id, b.city_name, b.state_uf, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_name, b.city_id, b.city_name, b.state_uf
  ),
  by_leader as (
    select b.leader_employee_id, b.leader_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.leader_employee_id, b.leader_name
  )
  select jsonb_build_object(
    'competence', to_char(v_start, 'YYYY-MM'), 'anchor_date', v_anchor, 'period_start', v_start, 'period_end', v_end,
    'brs_total', a.brs_total,
    'brs_with_vehicle', a.brs_with_vehicle,
    'brs_with_vehicle_now', a.brs_with_vehicle_now,
    'brs_without_vehicle_now', a.brs_without_vehicle_now,
    'brs_with_driver', a.brs_with_driver,
    'brs_without_driver', a.brs_without_driver,
    'brs_with_leader', a.brs_with_leader,
    'vehicle_substitutions', a.substitutions,
    'vehicle_inversions', ceil(a.inversion_rows / 2.0)::int,
    'mobilizations', a.substitutions + ceil(a.inversion_rows / 2.0)::int,
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
    'by_leader', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.leader_employee_id, 'leader_name', coalesce(l.leader_name, 'Sem liderança'),
                              'brs', l.brs, 'with_vehicle', l.with_vehicle, 'mobilizations', l.mobilizations, 'brs_with_change', l.brs_with_change,
                              'stability_pct', case when l.with_vehicle = 0 then null else round(100.0 * (1 - l.brs_with_change::numeric / l.with_vehicle), 1) end)
                            order by (l.leader_name is null), l.leader_name) from by_leader l), '[]'::jsonb)
  ) into v_out from agg a;
  return v_out;
end;
$$;

comment on function public.fidelization_stability(uuid, integer, integer, jsonb) is
  'Dashboard de Estabilidade (Etapa 13.1): estabilidade de frota = 1 − BRs com troca de titular / BRs com veículo no mês; estabilidade de motoristas = 1 − BRs com troca de motorista / BRs com motorista; mobilizações = substituições + pares de inversão (eventos explícitos, sem contagem dupla); trocas inferidas à parte. Security invoker.';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.substitute_fidelization_driver(uuid, jsonb) from public;
revoke all on function public.replicate_fidelization_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) from public;
grant execute on function public.resolve_operational_context(uuid, uuid, date) to authenticated;
grant execute on function public.br_directory(uuid, integer, integer, jsonb, integer, integer, text, text) to authenticated;
grant execute on function public.br_detail(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.vehicle_br_history(uuid, uuid) to authenticated;
grant execute on function public.leadership_scope_summary(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.substitute_fidelization_driver(uuid, jsonb) to authenticated;
grant execute on function public.replicate_fidelization_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) to authenticated;
grant execute on function public.fidelization_stability(uuid, integer, integer, jsonb) to authenticated;
