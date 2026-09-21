-- =============================================================================
-- Etapa 13 — correção de tipos no planner de BRs
--
-- Defeito meu em 20260922120000: declarei `state_id` e `city_id` como uuid nas
-- duas funções do planner. Não são. Estado e município vêm do IBGE e o HFM
-- guarda os códigos oficiais deles — `states.id` é smallint e `cities.id` é
-- integer —, justamente para que "3106200" continue sendo Belo Horizonte fora
-- daqui também.
--
-- O erro não aparece ao criar a função: PL/pgSQL só confere o tipo do retorno
-- quando ela executa. Ou seja, o planner teria falhado na primeira abertura da
-- tela, com "structure of query does not match function result type" — e não
-- em nenhum teste de migração.
-- =============================================================================

-- `create or replace` não muda a assinatura de uma função que devolve tabela:
-- para o PostgreSQL aquelas colunas são parâmetros OUT, e trocá-las é trocar o
-- tipo de retorno. Só o DROP resolve. É seguro porque a função nunca executou —
-- nada depende dela, e os grants são refeitos logo abaixo.
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
           b.state_id, st.uf as state_uf, b.city_id, ci.name as city_name, b.operation_city_id
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

create or replace function public.br_planner_indicators(
  p_organization_id uuid,
  p_year            integer default null,
  p_month           integer default null,
  p_filters         jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
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
    select b.id, b.status
      from public.operation_brs b
     where b.organization_id = p_organization_id
       and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  ocupacao as (
    select b.id,
           exists (
             select 1 from public.fidelization_assignments a
              where a.operation_br_id = b.id
                and a.vehicle_role = 'primary'
                and a.status <> 'cancelled'
                and a.start_date <= v_anchor
                and (a.end_date is null or a.end_date >= v_anchor)
           ) as com_veiculo_hoje,
           exists (
             select 1 from public.fidelization_assignments a
              where a.operation_br_id = b.id
                and a.status <> 'cancelled'
                and a.start_date <= v_end
                and (a.end_date is null or a.end_date >= v_start)
           ) as com_veiculo_na_competencia,
           exists (
             select 1
               from public.fidelization_assignments a
               join public.fidelization_drivers d on d.fidelization_assignment_id = a.id
              where a.operation_br_id = b.id
                and a.status <> 'cancelled'
                and d.status <> 'cancelled'
                and d.start_date <= v_anchor
                and (d.end_date is null or d.end_date >= v_anchor)
           ) as com_motorista_hoje
      from base b
  )
  select jsonb_build_object(
    'competence',              to_char(make_date(v_year, v_month, 1), 'YYYY-MM'),
    'anchor_date',             v_anchor,
    -- cadastrais: o que existe, independentemente da competência
    'total',                   (select count(*) from base),
    'active',                  (select count(*) from base where status = 'active'),
    'inactive',                (select count(*) from base where status <> 'active'),
    -- da competência: o que está ocupado
    'with_vehicle',            (select count(*) from ocupacao where com_veiculo_hoje),
    'without_vehicle',         (select count(*) from ocupacao where not com_veiculo_hoje),
    'with_vehicle_in_period',  (select count(*) from ocupacao where com_veiculo_na_competencia),
    'with_driver',             (select count(*) from ocupacao where com_motorista_hoje),
    'without_driver',          (select count(*) from ocupacao where not com_motorista_hoje),
    'by_operation', (
      select coalesce(jsonb_agg(x order by x ->> 'operation_name'), '[]'::jsonb)
        from (
          select jsonb_build_object('operation_id', b.operation_id,
                                    'operation_name', o.name,
                                    'total', count(*)) as x
            from public.operation_brs b
            join public.operations o on o.id = b.operation_id
           where b.organization_id = p_organization_id and b.deleted_at is null
             and (v_op is null or b.operation_id = v_op)
             and (v_state is null or b.state_id = v_state)
             and (v_city is null or b.city_id = v_city)
           group by b.operation_id, o.name
        ) s
    ),
    'by_city', (
      select coalesce(jsonb_agg(x order by x ->> 'city_name'), '[]'::jsonb)
        from (
          select jsonb_build_object('city_id', b.city_id,
                                    'city_name', ci.name,
                                    'state_uf', st.uf,
                                    'total', count(*)) as x
            from public.operation_brs b
            join public.cities ci on ci.id = b.city_id
            join public.states st on st.id = b.state_id
           where b.organization_id = p_organization_id and b.deleted_at is null
             and (v_op is null or b.operation_id = v_op)
             and (v_state is null or b.state_id = v_state)
             and (v_city is null or b.city_id = v_city)
           group by b.city_id, ci.name, st.uf
        ) s
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.br_planner_indicators(uuid, integer, integer, jsonb) from public, anon;
grant  execute on function public.br_planner_indicators(uuid, integer, integer, jsonb) to authenticated;
