-- =============================================================================
-- Etapa 13 — Planner de Locais e BRs
--
-- A Etapa 08 já entregou a espinha dorsal que a §12 exige: `operation_brs` é a
-- fonte única do BR, e `fidelization_assignments` é o vínculo temporal BR ×
-- veículo que a §27 chama de `br_vehicle_assignments`. As duas constraints de
-- exclusão que a §31 pede já existem lá: um BR tem um titular por intervalo, e
-- um veículo não é titular de dois BRs ao mesmo tempo. Nada disso é recriado
-- aqui.
--
-- A §42 pede um "override de liderança por BR". Ele também já existe: o modelo
-- de lideranças nasceu com `scope_level in ('operation','city','br')`, então uma
-- exceção para um BR é uma designação de escopo `br`, com vigência e motivo
-- próprios — não uma segunda tabela. O que faltava era a REGRA que lê essa
-- hierarquia, e é o que esta migração acrescenta.
--
-- O que entra:
--   1. `private.br_leadership_at`  — a precedência da §43, em um lugar só
--   2. `public.br_planner_rows`     — a linha do planner na competência (§24)
--   3. `public.br_planner_indicators` — os indicadores da §26, sem contar duas vezes
--   4. `public.br_vehicle_history`  — o histórico da §34
--   5. `public.create_operation_brs_batch` — multicadastro e lote (§17/§18/§58)
--
-- Nenhuma permissão nova: as nove da §63 já têm equivalente no catálogo central
-- (`fidelization.view`, `.manage_brs`, `.plan`, `.change_vehicle`, `.import`,
-- `.export`, `.audit`), e criar sinônimos só faria a matriz mentir sobre o
-- tamanho dela.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.br_leadership_at — quem responde por este BR nesta data
--
-- §43, na ordem: exceção do próprio BR, depois o planejamento da cidade, depois
-- o da operação, depois ninguém. Devolve também DE ONDE veio a resposta, porque
-- "o líder é a Daniela" e "o líder é a Daniela porque ela responde pela cidade"
-- são informações diferentes na tela.
--
-- Só designações `principal` e `active` respondem: um substituto não assume por
-- omissão, e uma designação cancelada nunca vigorou.
-- -----------------------------------------------------------------------------
create or replace function private.br_leadership_at(
  p_operation_br_id uuid,
  p_date            date
)
returns table (
  employee_id             uuid,
  employee_name           text,
  scope_level             text,
  leadership_assignment_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with br as (
    select b.id, b.operation_id, b.operation_city_id
      from public.operation_brs b
     where b.id = p_operation_br_id
  )
  select l.employee_id, e.full_name, l.scope_level, l.id
    from public.leadership_assignments l
    join br on true
    join public.employees e on e.id = l.employee_id
   where l.status = 'active'
     and l.responsibility_type = 'principal'
     and l.effective_from <= p_date
     and (l.effective_to is null or l.effective_to >= p_date)
     and (
       (l.scope_level = 'br'        and l.operation_br_id   = br.id)
       or (l.scope_level = 'city'   and l.operation_city_id = br.operation_city_id)
       or (l.scope_level = 'operation' and l.operation_id   = br.operation_id)
     )
   order by case l.scope_level when 'br' then 1 when 'city' then 2 else 3 end,
            l.effective_from desc
   limit 1;
$$;

grant execute on function private.br_leadership_at(uuid, date) to authenticated, service_role;

comment on function private.br_leadership_at(uuid, date) is
  'Liderança vigente de um BR numa data, na precedência da §43: exceção do BR, '
  'planejamento da cidade, planejamento da operação, ninguém. Devolve o nível '
  'que respondeu para que a tela possa dizer de onde veio.';

-- -----------------------------------------------------------------------------
-- 2. private.competence_anchor — a data que representa a competência
--
-- O planner mostra "o veículo atual" e "a liderança vigente" de uma competência.
-- Para o mês corrente isso é hoje; para um mês que passou é o último dia dele
-- (o retrato de como terminou); para um mês futuro é o primeiro dia (o que já
-- está planejado para quando ele começar). Sem esta regra num lugar só, cada
-- consulta escolheria a sua e os números não fechariam entre si.
-- -----------------------------------------------------------------------------
create or replace function private.competence_anchor(p_year integer, p_month integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
           when current_date < make_date(p_year, p_month, 1)
             then make_date(p_year, p_month, 1)
           when current_date > (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
             then (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
           else current_date
         end;
$$;

grant execute on function private.competence_anchor(integer, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. public.br_planner_rows — a linha do planner (§24)
--
-- Uma linha por BR, com o que a §24 pede: código, descrição, situação, liderança
-- vigente, veículo atual, motorista atual e o início do vínculo. Tudo resolvido
-- na data-âncora da competência, em uma consulta só — a §67 proíbe N+1, e uma
-- tela que abre 88 BRs faria 264 consultas se cada recurso fosse por linha.
--
-- security invoker: a RLS de `operation_brs` decide quais BRs o chamador vê, e
-- um total calculado fora dela seria vazamento por agregação.
-- -----------------------------------------------------------------------------
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
  state_id              uuid,
  state_uf              text,
  city_id               uuid,
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
  v_state  uuid    := nullif(p_filters ->> 'state_id', '')::uuid;
  v_city   uuid    := nullif(p_filters ->> 'city_id', '')::uuid;
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

-- -----------------------------------------------------------------------------
-- 4. public.br_planner_indicators — §26
--
-- A §26 manda separar duas coisas que se parecem: o que existe no cadastro e o
-- que está ocupado na competência escolhida. E manda não contar o mesmo BR duas
-- vezes por ter vários registros históricos de veículo — por isso tudo aqui é
-- `count(distinct b.id)` sobre a existência de um vínculo, nunca `count(*)`
-- sobre os vínculos.
-- -----------------------------------------------------------------------------
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
  v_state  uuid    := nullif(p_filters ->> 'state_id', '')::uuid;
  v_city   uuid    := nullif(p_filters ->> 'city_id', '')::uuid;
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

-- -----------------------------------------------------------------------------
-- 5. public.br_vehicle_history — §34
--
-- Todo veículo que já passou pelo BR, com vigência, motivo e origem. É o que
-- responde "qual veículo estava neste BR em tal data" (§29) sem depender da
-- listagem do planner.
-- -----------------------------------------------------------------------------
create or replace function public.br_vehicle_history(p_operation_br_id uuid)
returns table (
  assignment_id   uuid,
  vehicle_id      uuid,
  fleet_code      text,
  license_plate   text,
  vehicle_role    text,
  start_date      date,
  end_date        date,
  status          text,
  source          text,
  reason          text,
  end_reason      text,
  replaces_assignment_id uuid,
  created_at      timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.vehicle_id, v.fleet_code, v.license_plate, a.vehicle_role,
         a.start_date, a.end_date, a.status, a.source, a.reason, a.end_reason,
         a.replaces_assignment_id, a.created_at
    from public.fidelization_assignments a
    join public.vehicles v on v.id = a.vehicle_id
   where a.operation_br_id = p_operation_br_id
   order by a.start_date desc, a.created_at desc;
$$;

revoke execute on function public.br_vehicle_history(uuid) from public, anon;
grant  execute on function public.br_vehicle_history(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. public.create_operation_brs_batch — §17, §18 e §58
--
-- Cadastrar vários BRs no mesmo local sem refazer a seleção de operação e
-- cidade a cada um. `p_dry_run` devolve a prévia que a §58 exige — o que já
-- existe, o que entra, o que colide — sem gravar nada; a execução repete a
-- mesma conta, para que a prévia não prometa um número e a gravação entregue
-- outro.
--
-- Não cria operação, cidade nem veículo: §56 é explícita, e a resolução é por
-- id, nunca por texto.
-- -----------------------------------------------------------------------------
create or replace function public.create_operation_brs_batch(
  p_organization_id   uuid,
  p_operation_id      uuid,
  p_operation_city_id uuid,
  p_codes             text[],
  p_description       text default null,
  p_dry_run           boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_city     record;
  v_code     text;
  v_norm     text;
  v_created  integer := 0;
  v_existing integer := 0;
  v_invalid  integer := 0;
  v_details  jsonb   := '[]'::jsonb;
  v_seen     text[]  := array[]::text[];
  v_id       uuid;
begin
  if not private.has_permission(p_organization_id, 'fidelization.manage_brs') then
    raise exception 'Você não possui permissão para cadastrar BRs.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §16: a cidade tem de pertencer à cobertura da operação, e as duas à
  -- organização. Conferir aqui evita 40 mensagens de constraint em sequência.
  select oc.id, oc.operation_id, oc.city_id, c.state_id
    into v_city
    from public.operation_cities oc
    join public.cities c on c.id = oc.city_id
   where oc.id = p_operation_city_id
     and oc.operation_id = p_operation_id;

  if v_city.id is null then
    raise exception 'A cidade informada não pertence à cobertura desta operação.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    raise exception 'Informe ao menos um código de BR.' using errcode = 'invalid_parameter_value';
  end if;

  foreach v_code in array p_codes loop
    v_norm := private.normalize_code(v_code);

    if v_norm is null or v_norm = '' then
      v_invalid := v_invalid + 1;
      v_details := v_details || jsonb_build_object('code', v_code, 'result', 'invalid',
                                                   'detail', 'Código vazio.');
      continue;
    end if;

    -- repetido dentro do próprio lote
    if v_norm = any (v_seen) then
      v_invalid := v_invalid + 1;
      v_details := v_details || jsonb_build_object('code', v_norm, 'result', 'duplicated_in_batch',
                                                   'detail', 'O código aparece mais de uma vez neste lote.');
      continue;
    end if;
    v_seen := v_seen || v_norm;

    -- Já cadastrado neste mesmo escopo. A conferência repete exatamente o
    -- índice `operation_brs_code_key` — (organização, operação, cidade, código
    -- normalizado) entre os não excluídos —, senão a prévia diria "entra" e a
    -- gravação devolveria violação de unicidade.
    if exists (
      select 1 from public.operation_brs b
       where b.organization_id = p_organization_id
         and b.operation_id = p_operation_id
         and b.city_id = v_city.city_id
         and private.normalize_code(b.code) = v_norm
         and b.deleted_at is null
    ) then
      v_existing := v_existing + 1;
      v_details := v_details || jsonb_build_object('code', v_norm, 'result', 'exists',
                                                   'detail', 'Já cadastrado neste local.');
      continue;
    end if;

    v_created := v_created + 1;
    v_details := v_details || jsonb_build_object('code', v_norm, 'result', 'create');

    if not p_dry_run then
      insert into public.operation_brs
        (organization_id, operation_id, operation_city_id, state_id, city_id,
         code, description, status)
      values
        (p_organization_id, p_operation_id, p_operation_city_id, v_city.state_id, v_city.city_id,
         v_norm, nullif(btrim(coalesce(p_description, '')), ''), 'active')
      returning id into v_id;
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run',  p_dry_run,
    'created',  v_created,
    'existing', v_existing,
    'invalid',  v_invalid,
    'details',  v_details);
end;
$$;

revoke execute on function public.create_operation_brs_batch(uuid, uuid, uuid, text[], text, boolean)
  from public, anon;
grant  execute on function public.create_operation_brs_batch(uuid, uuid, uuid, text[], text, boolean)
  to authenticated;

comment on function public.create_operation_brs_batch(uuid, uuid, uuid, text[], text, boolean) is
  'Multicadastro de BRs num mesmo local (§17/§18). p_dry_run devolve a prévia da '
  '§58 sem gravar; a execução repete a mesma contagem.';
