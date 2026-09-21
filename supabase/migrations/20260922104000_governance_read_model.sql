-- =============================================================================
-- ETAPA 08 · READ MODEL DA GOVERNANÇA
--
-- Views com `security_invoker`: toda política das tabelas de baixo continua
-- valendo, inclusive o escopo por operação. A lista nunca mostra uma BR que a
-- política esconderia, porque é a mesma política.
--
-- As funções de calendário, indicadores e hierarquia são SECURITY INVOKER pelo
-- mesmo motivo. Nenhuma delas é `security definer`: uma função que devolvesse
-- contagens calculadas fora da RLS seria um vazamento por agregação — o total
-- de veículos de uma operação que a pessoa não alcança é informação sobre essa
-- operação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- leadership_directory
-- -----------------------------------------------------------------------------
create or replace view public.leadership_directory
with (security_invoker = on) as
select
  l.id,
  l.organization_id,
  l.employee_id,
  e.full_name                  as employee_name,
  e.employee_code,
  e.corporate_email            as employee_email,
  e.employment_status          as employee_status,

  l.scope_level,
  l.responsibility_type,
  l.is_primary,

  l.operation_id,
  o.name                       as operation_name,
  o.status                     as operation_status,
  l.operation_city_id,
  oc.state_id,
  st.uf                        as state_uf,
  oc.city_id,
  ci.name                      as city_name,
  l.operation_br_id,
  br.code                      as br_code,

  l.effective_from,
  l.effective_to,
  l.status,
  l.notes,
  l.end_reason,
  -- "Vigente hoje" é derivado, nunca gravado: um campo booleano gravado fica
  -- errado silenciosamente à meia-noite.
  (l.status = 'active'
   and l.effective_from <= current_date
   and (l.effective_to is null or l.effective_to >= current_date)) as is_current,

  l.created_at,
  l.created_by,
  l.updated_at,
  l.updated_by
from public.leadership_assignments l
join public.employees  e  on e.id  = l.employee_id
join public.operations o  on o.id  = l.operation_id
left join public.operation_cities oc on oc.id = l.operation_city_id
left join public.states st on st.id = oc.state_id
left join public.cities ci on ci.id = oc.city_id
left join public.operation_brs br on br.id = l.operation_br_id;

comment on view public.leadership_directory is
  'Read model de Lideranças: responsabilidade resolvida com colaborador, operação, cidade e BR. security_invoker.';

grant select on public.leadership_directory to authenticated;

-- -----------------------------------------------------------------------------
-- operation_br_directory
-- -----------------------------------------------------------------------------
create or replace view public.operation_br_directory
with (security_invoker = on) as
select
  b.id,
  b.organization_id,
  b.operation_id,
  o.name                    as operation_name,
  o.status                  as operation_status,
  b.operation_city_id,
  b.state_id,
  st.uf                     as state_uf,
  b.city_id,
  ci.name                   as city_name,
  b.code,
  b.description,
  b.status,
  b.notes,
  b.created_at,
  b.updated_at,

  -- O veículo de hoje e o responsável de hoje, resolvidos aqui para que a
  -- listagem não precise de uma consulta por linha.
  cur.vehicle_id            as current_vehicle_id,
  cur.fleet_code            as current_fleet_code,
  cur.license_plate         as current_license_plate,
  lead.employee_id          as current_leader_employee_id,
  lead.full_name            as current_leader_name
from public.operation_brs b
join public.operations o on o.id = b.operation_id
join public.states st    on st.id = b.state_id
join public.cities ci    on ci.id = b.city_id
left join lateral (
  select a.vehicle_id, v.fleet_code, v.license_plate
    from public.fidelization_assignments a
    join public.vehicles v on v.id = a.vehicle_id
   where a.operation_br_id = b.id
     and a.vehicle_role = 'primary'
     and a.status <> 'cancelled'
     and a.start_date <= current_date
     and (a.end_date is null or a.end_date >= current_date)
   order by a.start_date desc
   limit 1
) cur on true
left join lateral (
  select l.employee_id, e.full_name
    from public.leadership_assignments l
    join public.employees e on e.id = l.employee_id
   where l.operation_br_id = b.id
     and l.responsibility_type = 'principal'
     and l.status = 'active'
     and l.effective_from <= current_date
     and (l.effective_to is null or l.effective_to >= current_date)
   order by l.effective_from desc
   limit 1
) lead on true
where b.deleted_at is null;

comment on view public.operation_br_directory is
  'Read model das posições operacionais: BR com operação, geografia, veículo vigente e liderança vigente. security_invoker.';

grant select on public.operation_br_directory to authenticated;

-- -----------------------------------------------------------------------------
-- fidelization_directory
-- -----------------------------------------------------------------------------
create or replace view public.fidelization_directory
with (security_invoker = on) as
select
  a.id,
  a.organization_id,
  a.operation_br_id,
  b.code                    as br_code,
  b.operation_id,
  o.name                    as operation_name,
  b.state_id,
  st.uf                     as state_uf,
  b.city_id,
  ci.name                   as city_name,

  a.vehicle_id,
  v.fleet_code,
  v.license_plate,
  vt.name                   as vehicle_type_name,
  vmk.name                  as vehicle_make_name,
  vmo.name                  as vehicle_model_name,

  a.vehicle_role,
  a.start_date,
  a.end_date,
  a.status,
  a.source,
  a.reason,
  a.replaces_assignment_id,
  (a.status <> 'cancelled'
   and a.start_date <= current_date
   and (a.end_date is null or a.end_date >= current_date)) as is_current,

  a.created_at,
  a.created_by,
  a.updated_at,
  a.updated_by
from public.fidelization_assignments a
join public.operation_brs b on b.id = a.operation_br_id
join public.operations    o on o.id = b.operation_id
join public.states       st on st.id = b.state_id
join public.cities       ci on ci.id = b.city_id
join public.vehicles      v on v.id = a.vehicle_id
left join public.vehicle_types  vt  on vt.id  = v.vehicle_type_id
left join public.vehicle_models vmo on vmo.id = v.vehicle_model_id
left join public.vehicle_makes  vmk on vmk.id = vmo.vehicle_make_id;

comment on view public.fidelization_directory is
  'Read model da fidelização: vínculo com BR, geografia e identidade oficial do veículo. security_invoker.';

grant select on public.fidelization_directory to authenticated;

-- =============================================================================
-- public.fidelization_calendar — a matriz BRs × dias (§42)
--
-- Uma linha por BR, com os dias da competência num objeto jsonb. O cliente
-- desenha a matriz sem fazer conta: cada dia já vem com o veículo, o estado e
-- se aquele dia é o primeiro de um vínculo — que é o que permite mostrar uma
-- substituição como substituição, e não como dois blocos soltos (§44).
-- =============================================================================
create or replace function public.fidelization_calendar(
  p_organization_id uuid,
  p_year            integer,
  p_month           integer,
  p_operation_id    uuid    default null,
  p_state_id        smallint default null,
  p_city_id         integer default null,
  p_br_id           uuid    default null
)
returns table (
  operation_br_id      uuid,
  br_code              text,
  br_status            text,
  operation_id         uuid,
  operation_name       text,
  state_uf             text,
  city_name            text,
  leader_name          text,
  days                 jsonb,
  days_with_vehicle    integer,
  days_without_vehicle integer,
  substitutions        integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as last_day
  ),
  calendar as (
    select d::date as day from bounds, generate_series(first_day, last_day, interval '1 day') d
  ),
  brs as (
    select b.id, b.code, b.status, b.operation_id, b.operation_name,
           b.state_uf, b.city_name, b.current_leader_name
      from public.operation_br_directory b
     where b.organization_id = p_organization_id
       and (p_operation_id is null or b.operation_id = p_operation_id)
       and (p_state_id     is null or b.state_id     = p_state_id)
       and (p_city_id      is null or b.city_id      = p_city_id)
       and (p_br_id        is null or b.id           = p_br_id)
  ),
  cells as (
    select
      brs.id as br_id,
      cal.day,
      a.id          as assignment_id,
      a.vehicle_id,
      v.fleet_code,
      v.license_plate,
      a.status,
      a.source,
      a.start_date
    from brs
    cross join calendar cal
    left join lateral (
      select a.*
        from public.fidelization_assignments a
       where a.operation_br_id = brs.id
         and a.vehicle_role = 'primary'
         and a.status <> 'cancelled'
         and a.start_date <= cal.day
         and (a.end_date is null or a.end_date >= cal.day)
       order by a.start_date desc
       limit 1
    ) a on true
    left join public.vehicles v on v.id = a.vehicle_id
  )
  select
    brs.id,
    brs.code,
    brs.status,
    brs.operation_id,
    brs.operation_name,
    brs.state_uf,
    brs.city_name,
    brs.current_leader_name,
    coalesce(jsonb_object_agg(
      extract(day from cells.day)::text,
      jsonb_build_object(
        'date',           cells.day,
        'assignment_id',  cells.assignment_id,
        'vehicle_id',     cells.vehicle_id,
        'fleet_code',     cells.fleet_code,
        'license_plate',  cells.license_plate,
        'status',         coalesce(cells.status, 'unplanned'),
        'source',         cells.source,
        -- O primeiro dia do vínculo. Sem isto não há como distinguir "o mesmo
        -- veículo continua" de "entrou um vínculo novo com o mesmo veículo".
        'starts_here',    cells.assignment_id is not null and cells.start_date = cells.day,
        'weekend',        extract(isodow from cells.day) in (6, 7)
      )
    ) filter (where cells.day is not null), '{}'::jsonb),
    count(*) filter (where cells.assignment_id is not null)::integer,
    count(*) filter (where cells.assignment_id is null)::integer,
    count(distinct cells.assignment_id) filter (where cells.source = 'substitution')::integer
  from brs
  join cells on cells.br_id = brs.id
  group by brs.id, brs.code, brs.status, brs.operation_id, brs.operation_name,
           brs.state_uf, brs.city_name, brs.current_leader_name
  order by brs.operation_name, brs.city_name, brs.code;
$$;

revoke execute on function public.fidelization_calendar(uuid, integer, integer, uuid, smallint, integer, uuid)
  from public, anon;
grant  execute on function public.fidelization_calendar(uuid, integer, integer, uuid, smallint, integer, uuid)
  to authenticated;

-- =============================================================================
-- public.fidelization_indicators — §55
--
-- Sete números, todos da competência e do escopo pedidos, todos contados das
-- tabelas. Nenhum é estimado e nenhum é "estabilidade": o §56 pede a estrutura
-- para calculá-la e proíbe inventar a fórmula, então ficam aqui os insumos
-- (dias planejados, dias sem veículo, substituições) e a fórmula fica pendente
-- de validação funcional.
-- =============================================================================
create or replace function public.fidelization_indicators(
  p_organization_id uuid,
  p_year            integer,
  p_month           integer,
  p_operation_id    uuid     default null,
  p_state_id        smallint default null,
  p_city_id         integer  default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as last_day
  ),
  brs as (
    select b.*
      from public.operation_br_directory b
     where b.organization_id = p_organization_id
       and (p_operation_id is null or b.operation_id = p_operation_id)
       and (p_state_id     is null or b.state_id     = p_state_id)
       and (p_city_id      is null or b.city_id      = p_city_id)
  ),
  linked as (
    select distinct a.operation_br_id, a.vehicle_id, a.source, a.id
      from public.fidelization_assignments a
      join brs on brs.id = a.operation_br_id
      cross join bounds
     where a.status <> 'cancelled'
       and daterange(a.start_date, a.end_date, '[]')
           && daterange(bounds.first_day, bounds.last_day, '[]')
  )
  select jsonb_build_object(
    'total_brs',            (select count(*) from brs),
    'active_brs',           (select count(*) from brs where status = 'active'),
    'brs_with_vehicle',     (select count(distinct operation_br_id) from linked),
    'brs_without_vehicle',  (select count(*) from brs)
                            - (select count(distinct operation_br_id) from linked),
    'fidelized_vehicles',   (select count(distinct vehicle_id) from linked),
    'substitutions',        (select count(*) from linked where source = 'substitution'),
    'inversions',           (select count(*) from linked where source = 'inversion'),
    'by_operation',         coalesce((
      select jsonb_agg(x order by x ->> 'operation_name')
        from (
          select jsonb_build_object(
                   'operation_id',   brs.operation_id,
                   'operation_name', brs.operation_name,
                   'brs',            count(*),
                   'with_vehicle',   count(*) filter (
                     where exists (select 1 from linked l where l.operation_br_id = brs.id))
                 ) as x
            from brs
           group by brs.operation_id, brs.operation_name
        ) s
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.fidelization_indicators(uuid, integer, integer, uuid, smallint, integer)
  from public, anon;
grant  execute on function public.fidelization_indicators(uuid, integer, integer, uuid, smallint, integer)
  to authenticated;

-- =============================================================================
-- public.leadership_indicators
-- =============================================================================
create or replace function public.leadership_indicators(
  p_organization_id uuid,
  p_year            integer,
  p_month           integer,
  p_operation_id    uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as last_day
  ),
  inrange as (
    select l.*
      from public.leadership_directory l
      cross join bounds
     where l.organization_id = p_organization_id
       and (p_operation_id is null or l.operation_id = p_operation_id)
       and l.status = 'active'
       and daterange(l.effective_from, l.effective_to, '[]')
           && daterange(bounds.first_day, bounds.last_day, '[]')
  ),
  covered as (
    select b.id, b.operation_id
      from public.operation_br_directory b
     where b.organization_id = p_organization_id
       and b.status = 'active'
       and (p_operation_id is null or b.operation_id = p_operation_id)
  )
  select jsonb_build_object(
    'assignments',        (select count(*) from inrange),
    'leaders',            (select count(distinct employee_id) from inrange),
    'by_operation_scope', (select count(*) from inrange where scope_level = 'operation'),
    'by_city_scope',      (select count(*) from inrange where scope_level = 'city'),
    'by_br_scope',        (select count(*) from inrange where scope_level = 'br'),
    'substitutes',        (select count(*) from inrange where responsibility_type <> 'principal'),
    'brs_total',          (select count(*) from covered),
    'brs_with_leader',    (select count(*) from covered c
                            where exists (select 1 from inrange i
                                           where i.operation_br_id = c.id
                                             and i.responsibility_type = 'principal'))
  );
$$;

revoke execute on function public.leadership_indicators(uuid, integer, integer, uuid) from public, anon;
grant  execute on function public.leadership_indicators(uuid, integer, integer, uuid) to authenticated;

-- =============================================================================
-- public.eligible_fidelization_vehicles — §48
--
-- A busca acontece aqui, não no navegador. Noventa e cinco veículos hoje, e o
-- número só cresce; mandar a frota inteira para o cliente filtrar é a diferença
-- entre uma tela que abre e uma que trava no celular do supervisor.
-- =============================================================================
create or replace function public.eligible_fidelization_vehicles(
  p_operation_br_id uuid,
  p_start_date      date,
  p_end_date        date    default null,
  p_search          text    default null,
  p_exclude_id      uuid    default null,
  p_limit           integer default 30
)
returns table (
  vehicle_id      uuid,
  fleet_code      text,
  license_plate   text,
  make_name       text,
  model_name      text,
  vehicle_type    text,
  has_conflict    boolean,
  conflict_br     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with br as (
    select b.id, b.organization_id, b.operation_id
      from public.operation_brs b
     where b.id = p_operation_br_id and b.deleted_at is null
  ),
  term as (
    select private.normalize_label(nullif(btrim(coalesce(p_search, '')), '')) as q
  )
  select
    v.id, v.fleet_code, v.license_plate, mk.name, mo.name, vt.name,
    c.assignment_id is not null,
    c.br_code
  from br
  join public.vehicles v
    on v.organization_id = br.organization_id
   and v.deleted_at is null
   and v.status = 'active'
  left join public.vehicle_models mo on mo.id = v.vehicle_model_id
  left join public.vehicle_makes  mk on mk.id = mo.vehicle_make_id
  left join public.vehicle_types  vt on vt.id = v.vehicle_type_id
  cross join term
  left join lateral (
    select f.id as assignment_id, b2.code as br_code
      from public.fidelization_assignments f
      join public.operation_brs b2 on b2.id = f.operation_br_id
     where f.vehicle_id = v.id
       and f.status <> 'cancelled'
       and (p_exclude_id is null or f.id <> p_exclude_id)
       and daterange(f.start_date, f.end_date, '[]')
           && daterange(p_start_date, p_end_date, '[]')
     limit 1
  ) c on true
  where
    -- A restrição de tipo por operação da Etapa 07: um tipo sem nenhuma
    -- operação cadastrada não tem restrição; um tipo com operações cadastradas
    -- só entra nas que estão lá.
    (not exists (
       select 1 from public.vehicle_type_operations t
        where t.organization_id = br.organization_id
          and t.vehicle_type_id = v.vehicle_type_id)
     or exists (
       select 1 from public.vehicle_type_operations t
        where t.organization_id = br.organization_id
          and t.vehicle_type_id = v.vehicle_type_id
          and t.operation_id = br.operation_id))
    and (
      term.q is null
      or private.normalize_label(v.fleet_code)    like '%' || term.q || '%'
      or private.normalize_label(v.license_plate) like '%' || term.q || '%'
      or private.normalize_label(mk.name)         like '%' || term.q || '%'
      or private.normalize_label(mo.name)         like '%' || term.q || '%'
    )
  order by (c.assignment_id is not null), v.fleet_code nulls last, v.license_plate
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke execute on function public.eligible_fidelization_vehicles(uuid, date, date, text, uuid, integer)
  from public, anon;
grant  execute on function public.eligible_fidelization_vehicles(uuid, date, date, text, uuid, integer)
  to authenticated;

-- =============================================================================
-- public.operational_hierarchy — §54
--
-- Operação → Estado → Cidade → BR, com contadores reais e a liderança de cada
-- nível. Devolve uma árvore por operação; o §54 proíbe carregar a hierarquia
-- inteira de todas as organizações numa consulta só, então a organização é
-- obrigatória e a operação é filtrável.
-- =============================================================================
create or replace function public.operational_hierarchy(
  p_organization_id uuid,
  p_operation_id    uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with brs as (
    select b.*
      from public.operation_br_directory b
     where b.organization_id = p_organization_id
       and (p_operation_id is null or b.operation_id = p_operation_id)
  ),
  leaders as (
    select l.operation_id, l.operation_city_id, l.operation_br_id, l.scope_level, l.employee_name
      from public.leadership_directory l
     where l.organization_id = p_organization_id
       and l.is_current
       and l.responsibility_type = 'principal'
  ),
  by_city as (
    select
      brs.operation_id, brs.operation_name, brs.state_uf, brs.city_name, brs.operation_city_id,
      jsonb_agg(jsonb_build_object(
        'br_id',        brs.id,
        'code',         brs.code,
        'status',       brs.status,
        'vehicle',      brs.current_fleet_code,
        'license_plate', brs.current_license_plate,
        'leader',       brs.current_leader_name,
        'drivers',      (
          select count(distinct d.employee_id)
            from public.fidelization_drivers d
            join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
           where a.operation_br_id = brs.id
             and d.status <> 'cancelled'
             and (d.end_date is null or d.end_date >= current_date))
      ) order by brs.code) as br_list,
      count(*) as br_count,
      count(*) filter (where brs.current_vehicle_id is not null) as vehicle_count
    from brs
    group by brs.operation_id, brs.operation_name, brs.state_uf, brs.city_name, brs.operation_city_id
  )
  select coalesce(jsonb_agg(op order by op ->> 'operation_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'operation_id',   by_city.operation_id,
        'operation_name', by_city.operation_name,
        'leader',         (select employee_name from leaders
                            where scope_level = 'operation'
                              and operation_id = by_city.operation_id limit 1),
        'cities',         count(*),
        'brs',            sum(by_city.br_count),
        'vehicles',       sum(by_city.vehicle_count),
        'states', (
          select jsonb_agg(s order by s ->> 'uf')
            from (
              select jsonb_build_object(
                'uf', inner_city.state_uf,
                'cities', jsonb_agg(jsonb_build_object(
                  'city_name', inner_city.city_name,
                  'leader',    (select employee_name from leaders
                                 where scope_level = 'city'
                                   and operation_city_id = inner_city.operation_city_id limit 1),
                  'brs',       inner_city.br_list
                ) order by inner_city.city_name)
              ) as s
                from by_city inner_city
               where inner_city.operation_id = by_city.operation_id
               group by inner_city.state_uf
            ) t
        )
      ) as op
        from by_city
       group by by_city.operation_id, by_city.operation_name
    ) ops;
$$;

revoke execute on function public.operational_hierarchy(uuid, uuid) from public, anon;
grant  execute on function public.operational_hierarchy(uuid, uuid) to authenticated;
