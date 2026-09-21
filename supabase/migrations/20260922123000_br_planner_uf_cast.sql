-- =============================================================================
-- Etapa 13 — a sigla do estado é char(2), não text
--
-- Segundo desencaixe da mesma família do anterior, e encontrado do mesmo jeito:
-- executando. `states.uf` é `character(2)` — largura fixa, porque uma UF tem
-- exatamente duas letras —, e a função declarava `text`. O PostgreSQL recusa a
-- linha inteira por causa de uma coluna: "Returned type character(2) does not
-- match expected type text in column 8".
--
-- A correção é converter na consulta, não afrouxar a declaração: quem consome
-- `state_uf` quer texto, e `char(2)` carrega espaços de preenchimento que
-- apareceriam em comparações e concatenações mais tarde.
--
-- Conferi as 23 colunas de saída contra `information_schema` de uma vez em vez
-- de descobrir uma por erro: `states.uf` era a única fora do lugar.
-- =============================================================================

drop function if exists public.br_planner_rows(uuid, integer, integer, jsonb);

create or replace function public.br_planner_rows(
  p_organization_id uuid,
  p_year            integer default null,
  p_month           integer default null,
  p_filters         jsonb   default '{}'::jsonb
)
returns table (
  id                    uuid,
  code                  text,
  description           text,
  status                text,
  operation_id          uuid,
  operation_name        text,
  state_id              smallint,
  state_uf              text,
  city_id               integer,
  city_name             text,
  operation_city_id     uuid,
  leader_employee_id    uuid,
  leader_name           text,
  leader_scope          text,
  vehicle_id            uuid,
  fleet_code            text,
  license_plate         text,
  assignment_id         uuid,
  assignment_start      date,
  assignment_end        date,
  driver_employee_id    uuid,
  driver_name           text,
  anchor_date           date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_year   integer := coalesce(p_year,  extract(year  from current_date)::integer);
  v_month  integer := coalesce(p_month, extract(month from current_date)::integer);
  v_anchor date    := private.competence_anchor(v_year, v_month);
  v_op     uuid    := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state  smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city   integer  := nullif(p_filters ->> 'city_id', '')::integer;
  v_status text    := nullif(p_filters ->> 'status', '');
  v_leader uuid    := nullif(p_filters ->> 'leader_employee_id', '')::uuid;
  v_veh    text    := nullif(p_filters ->> 'vehicle', '');   -- 'with' | 'without'
  v_drv    text    := nullif(p_filters ->> 'driver', '');    -- 'with' | 'without'
  v_q      text    := nullif(btrim(coalesce(p_filters ->> 'q', '')), '');
begin
  return query
  with base as (
    select b.id, b.code, b.description, b.status, b.operation_id, o.name as operation_name,
           b.state_id, st.uf::text as state_uf, b.city_id, ci.name as city_name, b.operation_city_id
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.states st    on st.id = b.state_id
      join public.cities ci    on ci.id = b.city_id
     where b.organization_id = p_organization_id
       and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
       and (v_status is null or b.status = v_status)
       and (v_q is null or b.code ilike '%' || v_q || '%' or b.description ilike '%' || v_q || '%')
  ),
  resolved as (
    select base.*,
           lead.employee_id as leader_employee_id,
           lead.employee_name as leader_name,
           lead.scope_level as leader_scope,
           veh.vehicle_id, veh.fleet_code, veh.license_plate,
           veh.assignment_id, veh.assignment_start, veh.assignment_end,
           drv.employee_id as driver_employee_id,
           drv.full_name   as driver_name
      from base
      left join lateral private.br_leadership_at(base.id, v_anchor) lead on true
      left join lateral (
        select a.id as assignment_id, a.vehicle_id, v.fleet_code, v.license_plate,
               a.start_date as assignment_start, a.end_date as assignment_end
          from public.fidelization_assignments a
          join public.vehicles v on v.id = a.vehicle_id
         where a.operation_br_id = base.id
           and a.vehicle_role = 'primary'
           and a.status <> 'cancelled'
           and a.start_date <= v_anchor
           and (a.end_date is null or a.end_date >= v_anchor)
         order by a.start_date desc
         limit 1
      ) veh on true
      left join lateral (
        select e.id as employee_id, e.full_name
          from public.fidelization_drivers d
          join public.employees e on e.id = d.employee_id
         where d.fidelization_assignment_id = veh.assignment_id
           and d.status <> 'cancelled'
           and d.start_date <= v_anchor
           and (d.end_date is null or d.end_date >= v_anchor)
         order by d.start_date desc
         limit 1
      ) drv on true
  )
  select r.id, r.code, r.description, r.status, r.operation_id, r.operation_name,
         r.state_id, r.state_uf, r.city_id, r.city_name, r.operation_city_id,
         r.leader_employee_id, r.leader_name, r.leader_scope,
         r.vehicle_id, r.fleet_code, r.license_plate,
         r.assignment_id, r.assignment_start, r.assignment_end,
         r.driver_employee_id, r.driver_name,
         v_anchor
    from resolved r
   where (v_leader is null or r.leader_employee_id = v_leader)
     and (v_veh is null
          or (v_veh = 'with' and r.vehicle_id is not null)
          or (v_veh = 'without' and r.vehicle_id is null))
     and (v_drv is null
          or (v_drv = 'with' and r.driver_employee_id is not null)
          or (v_drv = 'without' and r.driver_employee_id is null))
   order by r.operation_name, r.state_uf, r.city_name, r.code;
end;
$$;

revoke execute on function public.br_planner_rows(uuid, integer, integer, jsonb) from public, anon;
grant  execute on function public.br_planner_rows(uuid, integer, integer, jsonb) to authenticated;
