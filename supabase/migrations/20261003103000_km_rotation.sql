-- =============================================================================
-- GESTÃO DE KM RODADO · PLANO DE RODÍZIO
--
-- O rodízio só SUGERE. Nenhuma rotina daqui move frota, BR ou motorista por
-- conta própria: a sugestão vira plano por decisão de quem tem
-- km.rotation.create, o plano anda pelos status SUGERIDO → APROVADO →
-- PROGRAMADO → EXECUTADO (ou CANCELADO) com a permissão de cada passo, e a
-- Fidelização só muda por "Aplicar rodízio na Fidelização" — com prévia,
-- confirmação explícita, km.rotation.apply_fidelization E a permissão da
-- própria Fidelização (fidelization.change_vehicle), numa transação, usando a
-- rotina oficial de inversão (invert_fidelization_vehicles).
--
-- Compatibilidade: só veículos da mesma coorte técnica (tipo · subcategoria ·
-- modelo, com recuo para tipo · subcategoria e tipo quando a coorte é pequena),
-- com cobertura mínima de leitura no período. Escopo: mesma coorte e mesma
-- operação (padrão) ou mesma coorte em todas as operações; por padrão só
-- trocas entre locais (cidades) diferentes.
--
-- Simulação no horizonte h (30/60/90 dias), com G = hodômetro A − hodômetro B e
-- D = (KM/dia A − KM/dia B) · h:
--   gap sem rodízio = G + D
--   gap com rodízio = |G − D|        (A passa a rodar como B e vice-versa)
--   redução         = (G + D) − |G − D|,  redução % = redução / (G + D)
-- Prioridade pela redução %: ALTA ≥ 50%, MÉDIA ≥ 20%, BAIXA ≥ 5%, abaixo disso
-- SEM BENEFÍCIO (faixas do legado). Fora das sugestões: frota inativa, em
-- manutenção (em andamento) ou sem leitura há mais de 15 dias.
-- "Condicionado" quando um dos veículos tem preventiva vencida ou a vencer em
-- até 30 dias, ou manutenção programada/em andamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Formatação pt-BR para os textos determinísticos
-- -----------------------------------------------------------------------------
create or replace function private.km_fmt(p_value numeric, p_decimals integer default 0)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—'
              else translate(to_char(round(p_value, p_decimals),
                                     'FM999,999,999,990' || case when p_decimals > 0 then '.' || repeat('0', p_decimals) else '' end),
                             ',.', '.,') end;
$$;

revoke all on function private.km_fmt(numeric, integer) from public, anon;

create or replace function private.km_rotation_priority(p_reduction_pct numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Faixas do legado (HFC): ganho abaixo de 5% não justifica a troca.
  select case when p_reduction_pct is null or p_reduction_pct < 5 then 'none'
              when p_reduction_pct >= 50 then 'high'
              when p_reduction_pct >= 20 then 'medium'
              else 'low' end;
$$;

revoke all on function private.km_rotation_priority(numeric) from public, anon;

-- -----------------------------------------------------------------------------
-- 2. Base: um retrato por veículo elegível (coorte, ritmo, hodômetro, contexto,
--    preventiva e manutenção aberta)
-- -----------------------------------------------------------------------------
create or replace function private.km_rotation_base(
  p_organization_id uuid, p_from date, p_to date, p_filters jsonb)
returns table (
  vehicle_id uuid, cohort_key text, cohort_label text, cohort_size integer,
  cohort_daily_median numeric, cohort_odometer_median numeric,
  operation_id uuid, city_id integer, operation_br_id uuid,
  odometer numeric, daily_avg numeric, km_period numeric, coverage_pct numeric, daily_percentile numeric,
  quadrant text, info jsonb, conditions text[], suggestible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select * from private.km_dispersion(p_organization_id, p_from, p_to, p_filters) x
     where x.eligible and x.odometer is not null and x.daily_avg is not null
  )
  select d.vehicle_id, d.cohort_key, d.cohort_label, d.cohort_size, d.cohort_daily_median, d.cohort_odometer_median,
         d.operation_id, d.city_id, d.operation_br_id,
         d.odometer, d.daily_avg, d.km_period, d.coverage_pct, d.daily_percentile, d.quadrant,
         private.km_vehicle_card(d.vehicle_id) || jsonb_build_object(
           'operation_id', d.operation_id,
           'operation', (select o.name from public.operations o where o.id = d.operation_id),
           'city_id', d.city_id,
           'local', (select c.name from public.cities c where c.id = d.city_id),
           'operation_br_id', d.operation_br_id,
           'br', (select b.code from public.operation_brs b where b.id = d.operation_br_id),
           'odometer', round(d.odometer), 'km_period', round(d.km_period, 1), 'daily_avg', round(d.daily_avg, 1),
           'km_month', round(d.daily_avg * 30), 'percentile', d.daily_percentile, 'coverage_pct', d.coverage_pct,
           'quadrant', d.quadrant,
           'preventive', pc.j,
           'maintenance_open', mo.status),
         array_remove(array[
           case when (pc.j ->> 'km_remaining')::numeric <= 0 then 'Preventiva vencida' end,
           case when (pc.j ->> 'km_remaining')::numeric > 0 and (pc.j ->> 'km_remaining')::numeric <= d.daily_avg * 30
                then 'Preventiva a vencer em até 30 dias' end,
           case when mo.status = 'in_progress' then 'Em manutenção' end,
           case when mo.status = 'scheduled' then 'Manutenção programada' end], null),
         -- entra nas sugestões: frota ativa, fora de manutenção em andamento e com
         -- leitura nos últimos 15 dias
         vs.status = 'active' and coalesce(mo.status, '') <> 'in_progress'
           and lr.last_day >= private.maintenance_today(p_organization_id) - 15
    from d
    join public.vehicles vs on vs.id = d.vehicle_id
    left join lateral (
      select max(r.reading_date) as last_day from public.km_daily_readings r
       where r.vehicle_id = d.vehicle_id
         and r.status not in ('no_reading', 'inconsistent')) lr on true
    left join lateral (
      select jsonb_build_object('cycle_number', c.cycle_number, 'milestone_km', c.milestone_km,
                                'km_remaining', round(c.milestone_km - d.odometer)) as j
        from public.maintenance_preventive_cycles c
       where c.vehicle_id = d.vehicle_id and c.completed_on is null
       order by c.cycle_number limit 1) pc on true
    left join lateral (
      select m.status from public.maintenances m
       where m.vehicle_id = d.vehicle_id and m.status in ('in_progress', 'scheduled')
       order by case m.status when 'in_progress' then 0 else 1 end limit 1) mo on true;
$$;

revoke all on function private.km_rotation_base(uuid, date, date, jsonb) from public, anon;

-- -----------------------------------------------------------------------------
-- 3. Avaliação de pares. p_pairs = null → todos os pares compatíveis do escopo
--    (A com hodômetro e ritmo maiores que B); senão, só os pares informados
--    ([{vehicle_a_id, vehicle_b_id}]), na direção informada.
-- -----------------------------------------------------------------------------
create or replace function private.km_rotation_evaluate(
  p_organization_id uuid, p_from date, p_to date, p_filters jsonb, p_horizon integer,
  p_scope_mode text, p_different_locations boolean, p_pairs jsonb)
returns table (
  vehicle_a_id uuid, vehicle_b_id uuid, cohort_key text, cohort_label text, same_cohort boolean,
  vehicle_a jsonb, vehicle_b jsonb, cohort jsonb,
  gap_current numeric, gap_without numeric, gap_with numeric, reduction_km numeric, reduction_pct numeric,
  intensity_reduction_a_pct numeric, priority text, conditioned boolean, condition_reasons text[],
  scenarios jsonb, justification text)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select * from private.km_rotation_base(p_organization_id, p_from, p_to, p_filters)),
  st as (select s.rotation_min_gap_km, s.min_cohort_size from private.km_settings_of(p_organization_id) s),
  req as (
    select (x ->> 'vehicle_a_id')::uuid as a, (x ->> 'vehicle_b_id')::uuid as b
      from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) x
  ),
  -- pares: todos os compatíveis (p_pairs nulo) ou só os informados
  cand as (
    select a.vehicle_id as a_id, bb.vehicle_id as b_id
      from b a
      join b bb on bb.cohort_key = a.cohort_key and bb.vehicle_id <> a.vehicle_id
      cross join st
     where p_pairs is null
       and a.cohort_size >= st.min_cohort_size
       and a.suggestible and bb.suggestible
       and a.odometer > bb.odometer and a.daily_avg > bb.daily_avg
       and a.odometer - bb.odometer >= st.rotation_min_gap_km
       and (p_scope_mode = 'same_cohort_global' or a.operation_id is not distinct from bb.operation_id)
       and (not coalesce(p_different_locations, true)
            or (a.city_id is not null and bb.city_id is not null and a.city_id <> bb.city_id))
    union all
    select req.a, req.b from req where p_pairs is not null and req.a <> req.b
  ),
  pr as (
    select a.*, bb.vehicle_id as b_id, bb.info as b_info, bb.conditions as b_conditions,
           bb.odometer as b_odometer, bb.daily_avg as b_daily, bb.cohort_key as b_cohort
      from cand
      join b a on a.vehicle_id = cand.a_id
      join b bb on bb.vehicle_id = cand.b_id
  ),
  calc as (
    select pr.*, (pr.odometer - pr.b_odometer) as g, (pr.daily_avg - pr.b_daily) as dr from pr
  )
  select c.vehicle_id, c.b_id, c.cohort_key, c.cohort_label, c.cohort_key = c.b_cohort,
         c.info, c.b_info,
         jsonb_build_object('key', c.cohort_key, 'label', c.cohort_label, 'size', c.cohort_size,
                            'daily_median', c.cohort_daily_median, 'km_month_median', round(c.cohort_daily_median * 30),
                            'odometer_median', c.cohort_odometer_median),
         round(c.g, 1),
         round(c.g + c.dr * p_horizon, 1),
         round(abs(c.g - c.dr * p_horizon), 1),
         round((c.g + c.dr * p_horizon) - abs(c.g - c.dr * p_horizon), 1),
         round(100 * ((c.g + c.dr * p_horizon) - abs(c.g - c.dr * p_horizon)) / nullif(c.g + c.dr * p_horizon, 0), 1),
         round(100 * (c.daily_avg - c.b_daily) / nullif(c.daily_avg, 0), 1),
         private.km_rotation_priority(
           100 * ((c.g + c.dr * p_horizon) - abs(c.g - c.dr * p_horizon)) / nullif(c.g + c.dr * p_horizon, 0)),
         cardinality(c.conditions || c.b_conditions) > 0,
         array(select c.info ->> 'plate' || ': ' || x from unnest(c.conditions) x
               union all select c.b_info ->> 'plate' || ': ' || y from unnest(c.b_conditions) y),
         (select jsonb_agg(jsonb_build_object(
                   'horizon_days', h,
                   'without', jsonb_build_object('odometer_a', round(c.odometer + c.daily_avg * h), 'odometer_b', round(c.b_odometer + c.b_daily * h),
                                                 'gap', round(c.g + c.dr * h)),
                   'with', jsonb_build_object('odometer_a', round(c.odometer + c.b_daily * h), 'odometer_b', round(c.b_odometer + c.daily_avg * h),
                                              'gap', round(abs(c.g - c.dr * h))),
                   'reduction_km', round((c.g + c.dr * h) - abs(c.g - c.dr * h)),
                   'reduction_pct', round(100 * ((c.g + c.dr * h) - abs(c.g - c.dr * h)) / nullif(c.g + c.dr * h, 0), 1)) order by h)
            from unnest(array[30, 60, 90]) h),
         format('Considerando a análise de utilização das frotas do grupo %s, propõe-se o rodízio entre as frotas %s e %s. '
                'A frota %s, atualmente alocada em %s, apresenta rodagem média de %s km/mês e hodômetro de %s km, %s (%s km/mês). '
                'A frota %s, alocada em %s, apresenta rodagem média de %s km/mês e hodômetro de %s km. '
                'A troca entre as frotas reduz o desequilíbrio estimado dos hodômetros em %s%% em %s dias, '
                'contribuindo para a equalização dos hodômetros do grupo.',
                c.cohort_label, c.info ->> 'plate', c.b_info ->> 'plate',
                c.info ->> 'plate', coalesce(c.info ->> 'local', 'local não informado'),
                private.km_fmt(c.daily_avg * 30), private.km_fmt(c.odometer),
                case when c.cohort_daily_median > 0 and c.daily_avg > c.cohort_daily_median then 'superior à média de utilização do grupo'
                     when c.cohort_daily_median > 0 then 'próxima à média de utilização do grupo'
                     else 'registrada no período analisado' end,
                private.km_fmt(c.cohort_daily_median * 30),
                c.b_info ->> 'plate', coalesce(c.b_info ->> 'local', 'local não informado'),
                private.km_fmt(c.b_daily * 30), private.km_fmt(c.b_odometer),
                private.km_fmt(100 * ((c.g + c.dr * p_horizon) - abs(c.g - c.dr * p_horizon)) / nullif(c.g + c.dr * p_horizon, 0), 1),
                p_horizon)
    from calc c;
$$;

revoke all on function private.km_rotation_evaluate(uuid, date, date, jsonb, integer, text, boolean, jsonb) from public, anon;

-- Parâmetros da simulação (horizonte, escopo, locais diferentes) a partir do payload
create or replace function private.km_rotation_params(p_payload jsonb)
returns table (horizon integer, scope_mode text, different_locations boolean)
language plpgsql
immutable
set search_path = ''
as $$
begin
  horizon := coalesce((p_payload ->> 'horizon_days')::integer, 90);
  scope_mode := coalesce(nullif(p_payload ->> 'scope_mode', ''), 'same_cohort_same_operation');
  different_locations := coalesce((p_payload ->> 'different_locations_only')::boolean, true);
  if horizon not in (30, 60, 90) then
    raise exception 'Horizonte inválido (30, 60 ou 90 dias).' using errcode = 'invalid_parameter_value';
  end if;
  if scope_mode not in ('same_cohort_same_operation', 'same_cohort_global') then
    raise exception 'Escopo inválido.' using errcode = 'invalid_parameter_value';
  end if;
  return next;
end;
$$;

revoke all on function private.km_rotation_params(jsonb) from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Candidatos: pares compatíveis, escolha gulosa pela maior redução (cada
--    veículo em no máximo uma sugestão), resumo e grupos
-- -----------------------------------------------------------------------------
create or replace function public.km_rotation_candidates(p_organization_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from    date;
  v_to      date;
  v_filters jsonb := coalesce(p_payload -> 'filters', p_payload - 'horizon_days' - 'scope_mode' - 'different_locations_only');
  v_par     record;
  v_used    uuid[] := '{}';
  v_items   jsonb := '[]'::jsonb;
  r         record;
  v_n       integer := 0;
begin
  if not private.has_permission(p_organization_id, 'km.rotation.view') then
    raise exception 'Você não possui permissão para o plano de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_par from private.km_rotation_params(p_payload);
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, v_filters) p;

  for r in
    select e.* from private.km_rotation_evaluate(p_organization_id, v_from, v_to, v_filters, v_par.horizon,
                                                 v_par.scope_mode, v_par.different_locations, null) e
     where e.priority <> 'none'
     order by e.reduction_km desc, e.gap_current desc, e.vehicle_a ->> 'plate', e.vehicle_b ->> 'plate'
  loop
    continue when r.vehicle_a_id = any (v_used) or r.vehicle_b_id = any (v_used);
    v_used := v_used || r.vehicle_a_id || r.vehicle_b_id;
    v_n := v_n + 1;
    v_items := v_items || jsonb_build_object(
      'key', r.vehicle_a_id || '|' || r.vehicle_b_id,
      'vehicle_a_id', r.vehicle_a_id, 'vehicle_b_id', r.vehicle_b_id,
      'cohort_key', r.cohort_key, 'cohort_label', r.cohort_label, 'cohort', r.cohort,
      'vehicle_a', r.vehicle_a, 'vehicle_b', r.vehicle_b,
      'gap_current', r.gap_current, 'gap_without', r.gap_without, 'gap_with', r.gap_with,
      'reduction_km', r.reduction_km, 'reduction_pct', r.reduction_pct,
      'intensity_reduction_a_pct', r.intensity_reduction_a_pct,
      'priority', r.priority, 'conditioned', r.conditioned, 'condition_reasons', to_jsonb(r.condition_reasons),
      'scenarios', r.scenarios, 'justification', r.justification);
  end loop;

  return (
    with it as (select x from jsonb_array_elements(v_items) x),
    b as (select * from private.km_rotation_base(p_organization_id, v_from, v_to, v_filters))
    select jsonb_build_object(
      'period', jsonb_build_object('from', v_from, 'to', v_to),
      'horizon_days', v_par.horizon, 'scope_mode', v_par.scope_mode,
      'different_locations_only', v_par.different_locations,
      'data_as_of', private.km_last_valid_day(p_organization_id),
      'generated_at', now(),
      'summary', jsonb_build_object(
        'candidates', (select count(*) from it),
        'high', (select count(*) from it where it.x ->> 'priority' = 'high'),
        'medium', (select count(*) from it where it.x ->> 'priority' = 'medium'),
        'low', (select count(*) from it where it.x ->> 'priority' = 'low'),
        'conditioned', (select count(*) from it where (it.x ->> 'conditioned')::boolean),
        'reduction_km_total', (select round(coalesce(sum((it.x ->> 'reduction_km')::numeric), 0)) from it),
        'avg_gap_current', (select round(avg((it.x ->> 'gap_current')::numeric)) from it),
        'avg_reduction_pct', (select round(avg((it.x ->> 'reduction_pct')::numeric), 1) from it),
        'vehicles_analyzed', (select count(*) from b),
        'cohorts', (select count(distinct b.cohort_key) from b)),
      'groups', (select coalesce(jsonb_agg(g.j order by g.j ->> 'label'), '[]'::jsonb) from (
                   select jsonb_build_object(
                            'key', b.cohort_key, 'label', min(b.cohort_label), 'vehicles', count(*),
                            'odometer_avg', round(avg(b.odometer)), 'km_month_avg', round(avg(b.daily_avg) * 30),
                            'km_month_max', round(max(b.daily_avg) * 30), 'km_month_min', round(min(b.daily_avg) * 30),
                            'odometer_range', round(max(b.odometer) - min(b.odometer)),
                            'suggestions', (select count(*) from it where it.x ->> 'cohort_key' = b.cohort_key)) as j
                     from b group by b.cohort_key
                   having (select count(*) from it where it.x ->> 'cohort_key' = b.cohort_key) > 0) g),
      'items', v_items));
end;
$$;

revoke all on function public.km_rotation_candidates(uuid, jsonb) from public, anon;
grant execute on function public.km_rotation_candidates(uuid, jsonb) to authenticated, service_role;

-- Simulação de um par (drawer "Análise do rodízio A ⇄ B"): qualquer par, mesmo
-- fora das sugestões; avisa quando não são da mesma coorte.
create or replace function public.km_simulate_rotation(
  p_organization_id uuid, p_vehicle_a_id uuid, p_vehicle_b_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from    date;
  v_to      date;
  v_filters jsonb := coalesce(p_payload -> 'filters', p_payload - 'horizon_days' - 'scope_mode' - 'different_locations_only');
  v_par     record;
  r         record;
begin
  if not private.has_permission(p_organization_id, 'km.rotation.view') then
    raise exception 'Você não possui permissão para o plano de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_par from private.km_rotation_params(p_payload);
  select p.date_from, p.date_to into v_from, v_to from private.km_period(p_organization_id, v_filters - 'vehicle_ids') p;
  select e.* into r
    from private.km_rotation_evaluate(p_organization_id, v_from, v_to, v_filters - 'vehicle_ids', v_par.horizon,
                                      v_par.scope_mode, v_par.different_locations,
                                      jsonb_build_array(jsonb_build_object('vehicle_a_id', p_vehicle_a_id,
                                                                           'vehicle_b_id', p_vehicle_b_id))) e;
  if r.vehicle_a_id is null then
    return jsonb_build_object('error', 'Um dos veículos não tem leituras suficientes no período (ou está fora do seu escopo).');
  end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to), 'horizon_days', v_par.horizon,
    'same_cohort', r.same_cohort, 'cohort', r.cohort,
    'vehicle_a', r.vehicle_a, 'vehicle_b', r.vehicle_b,
    'gap_current', r.gap_current, 'gap_without', r.gap_without, 'gap_with', r.gap_with,
    'reduction_km', r.reduction_km, 'reduction_pct', r.reduction_pct,
    'intensity_reduction_a_pct', r.intensity_reduction_a_pct,
    'priority', r.priority, 'conditioned', r.conditioned, 'condition_reasons', to_jsonb(r.condition_reasons),
    'scenarios', r.scenarios, 'justification', r.justification);
end;
$$;

revoke all on function public.km_simulate_rotation(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.km_simulate_rotation(uuid, uuid, uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Planos: criar, incluir itens, editar
-- -----------------------------------------------------------------------------
create or replace function private.km_rotation_event(
  p_plan public.km_rotation_plans, p_item_id uuid, p_type text, p_from text, p_to text, p_reason text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.km_rotation_events
    (organization_id, plan_id, item_id, event_type, from_status, to_status, reason, payload, actor_user_id, actor_name)
  values (p_plan.organization_id, p_plan.id, p_item_id, p_type, p_from, p_to, p_reason,
          coalesce(p_payload, '{}'::jsonb), auth.uid(), private.km_actor_name());
$$;

revoke all on function private.km_rotation_event(public.km_rotation_plans, uuid, text, text, text, text, jsonb) from public, anon;

-- Grava (ou atualiza) os itens de um plano a partir da avaliação do servidor:
-- os números nunca vêm do navegador.
create or replace function private.km_rotation_store_items(p_plan public.km_rotation_plans, p_pairs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_next  integer;
  v_count integer := 0;
  v_busy  text;
begin
  if jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) = 0 then
    raise exception 'Selecione ao menos um rodízio.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_pairs) > 300 then
    raise exception 'No máximo 300 rodízios por vez.' using errcode = 'invalid_parameter_value';
  end if;
  -- os dois veículos têm de estar no escopo de quem planeja
  select string_agg(v.license_plate, ', ') into v_busy
    from jsonb_array_elements(p_pairs) x
    cross join lateral unnest(array[(x ->> 'vehicle_a_id')::uuid, (x ->> 'vehicle_b_id')::uuid]) vid
    join public.vehicles v on v.id = vid
   where v.organization_id <> p_plan.organization_id
      or not private.vehicle_in_scope(p_plan.organization_id, vid);
  if v_busy is not null then
    raise exception 'Veículo(s) fora do seu escopo: %.', v_busy using errcode = 'insufficient_privilege';
  end if;
  -- um veículo não pode estar em dois rodízios ativos do mesmo plano
  select string_agg(distinct v.license_plate, ', ') into v_busy
    from jsonb_array_elements(p_pairs) x
    cross join lateral unnest(array[(x ->> 'vehicle_a_id')::uuid, (x ->> 'vehicle_b_id')::uuid]) vid
    join public.vehicles v on v.id = vid
   where exists (select 1 from public.km_rotation_plan_items i
                  where i.plan_id = p_plan.id and i.status <> 'cancelled'
                    and vid in (i.vehicle_a_id, i.vehicle_b_id)
                    and not ((x ->> 'vehicle_a_id')::uuid = i.vehicle_a_id and (x ->> 'vehicle_b_id')::uuid = i.vehicle_b_id));
  if v_busy is not null then
    raise exception 'Veículo(s) já em outro rodízio deste plano: %.', v_busy using errcode = 'unique_violation';
  end if;

  select coalesce(max(i.item_number), 0) into v_next from public.km_rotation_plan_items i where i.plan_id = p_plan.id;

  for r in
    select e.* from private.km_rotation_evaluate(p_plan.organization_id, p_plan.period_from, p_plan.period_to, p_plan.filters,
                                                 p_plan.horizon_days, p_plan.scope_mode, p_plan.different_locations_only, p_pairs) e
     order by e.cohort_label, e.reduction_km desc
  loop
    if exists (select 1 from public.km_rotation_plan_items i
                where i.plan_id = p_plan.id and i.vehicle_a_id = r.vehicle_a_id and i.vehicle_b_id = r.vehicle_b_id
                  and i.status <> 'cancelled') then
      continue;
    end if;
    if not r.same_cohort then
      raise exception 'As frotas % e % não são da mesma coorte técnica.', r.vehicle_a ->> 'plate', r.vehicle_b ->> 'plate'
        using errcode = 'invalid_parameter_value';
    end if;
    v_next := v_next + 1;
    insert into public.km_rotation_plan_items as i
      (organization_id, plan_id, item_number, vehicle_a_id, vehicle_b_id, cohort_key, cohort_label, snapshot,
       gap_current_km, gap_future_without_km, gap_future_with_km, reduction_km, reduction_pct, priority, justification)
    values (p_plan.organization_id, p_plan.id, v_next, r.vehicle_a_id, r.vehicle_b_id, r.cohort_key, r.cohort_label,
            jsonb_build_object('vehicle_a', r.vehicle_a, 'vehicle_b', r.vehicle_b, 'cohort', r.cohort,
                               'scenarios', r.scenarios, 'conditioned', r.conditioned,
                               'condition_reasons', to_jsonb(r.condition_reasons),
                               'intensity_reduction_a_pct', r.intensity_reduction_a_pct),
            r.gap_current, r.gap_without, r.gap_with, r.reduction_km, coalesce(r.reduction_pct, 0), r.priority, r.justification)
    on conflict (plan_id, vehicle_a_id, vehicle_b_id) do update set
      status = 'suggested', snapshot = excluded.snapshot, gap_current_km = excluded.gap_current_km,
      gap_future_without_km = excluded.gap_future_without_km, gap_future_with_km = excluded.gap_future_with_km,
      reduction_km = excluded.reduction_km, reduction_pct = excluded.reduction_pct, priority = excluded.priority,
      justification = excluded.justification, cancelled_reason = null, updated_at = now(),
      item_number = i.item_number;
    v_count := v_count + 1;
    perform private.km_rotation_event(p_plan, null, 'item_added', null, 'suggested', null,
      jsonb_build_object('vehicle_a', r.vehicle_a ->> 'plate', 'vehicle_b', r.vehicle_b ->> 'plate',
                         'reduction_pct', r.reduction_pct));
  end loop;

  if v_count = 0 then
    raise exception 'Nenhum rodízio pôde ser incluído: os veículos não têm leituras suficientes no período ou já estão no plano.'
      using errcode = 'invalid_parameter_value';
  end if;
  return v_count;
end;
$$;

revoke all on function private.km_rotation_store_items(public.km_rotation_plans, jsonb) from public, anon;

-- Situação do plano a partir dos itens ativos (não cancelados)
create or replace function private.km_rotation_refresh_plan(p_plan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p        public.km_rotation_plans;
  v_status text;
begin
  select * into p from public.km_rotation_plans where id = p_plan_id;
  select case
           when count(*) filter (where i.status <> 'cancelled') = 0 then 'cancelled'
           when bool_and(i.status = 'executed') filter (where i.status <> 'cancelled') then 'executed'
           when bool_and(i.status in ('scheduled', 'executed')) filter (where i.status <> 'cancelled') then 'scheduled'
           when bool_and(i.status in ('approved', 'scheduled', 'executed')) filter (where i.status <> 'cancelled') then 'approved'
           else 'suggested' end
    into v_status
    from public.km_rotation_plan_items i where i.plan_id = p_plan_id;
  v_status := coalesce(v_status, 'suggested');
  if v_status is distinct from p.status then
    update public.km_rotation_plans set status = v_status, updated_at = now(), updated_by = auth.uid(),
           approved_at = case when v_status in ('approved', 'scheduled', 'executed') then coalesce(approved_at, now()) else approved_at end,
           approved_by = case when v_status in ('approved', 'scheduled', 'executed') then coalesce(approved_by, auth.uid()) else approved_by end
     where id = p_plan_id;
    perform private.km_rotation_event(p, null, 'status_changed', p.status, v_status, null, '{}'::jsonb);
  end if;
  return v_status;
end;
$$;

revoke all on function private.km_rotation_refresh_plan(uuid) from public, anon;

create or replace function public.km_create_rotation_plan(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par     record;
  v_from    date;
  v_to      date;
  v_filters jsonb := coalesce(p_payload -> 'filters', '{}'::jsonb);
  v_name    text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  p         public.km_rotation_plans;
  v_items   integer;
begin
  if not private.has_permission(p_organization_id, 'km.rotation.create') then
    raise exception 'Você não possui permissão para criar planos de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_par from private.km_rotation_params(p_payload);
  select x.date_from, x.date_to into v_from, v_to from private.km_period(p_organization_id, v_filters) x;
  v_name := coalesce(v_name, 'Plano de Rodízio — ' || to_char(v_to, 'MM/YYYY'));

  insert into public.km_rotation_plans
    (organization_id, code, name, notes, period_from, period_to, horizon_days, scope_mode, different_locations_only,
     filters, data_as_of, created_by, updated_by)
  values (p_organization_id, private.next_entity_code(p_organization_id, 'km_rotation_plan', 'ROD-', 5),
          v_name, nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_from, v_to, v_par.horizon, v_par.scope_mode,
          v_par.different_locations, v_filters,
          coalesce(private.km_last_valid_day(p_organization_id), v_to), auth.uid(), auth.uid())
  returning * into p;

  perform private.km_rotation_event(p, null, 'created', null, 'suggested', null,
    jsonb_build_object('period_from', v_from, 'period_to', v_to, 'horizon_days', v_par.horizon,
                       'scope_mode', v_par.scope_mode, 'different_locations_only', v_par.different_locations));
  v_items := private.km_rotation_store_items(p, p_payload -> 'items');
  perform private.emit_event(p_organization_id, 'km.rotation_plan_created', 'km_rotation_plan', p.id,
    jsonb_build_object('code', p.code, 'items', v_items));
  return jsonb_build_object('plan_id', p.id, 'code', p.code, 'items', v_items);
end;
$$;

revoke all on function public.km_create_rotation_plan(uuid, jsonb) from public, anon;
grant execute on function public.km_create_rotation_plan(uuid, jsonb) to authenticated;

create or replace function public.km_add_rotation_items(p_plan_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p       public.km_rotation_plans;
  v_items integer;
begin
  select * into p from public.km_rotation_plans where id = p_plan_id for update;
  if p.id is null or not private.has_permission(p.organization_id, 'km.rotation.create') then
    raise exception 'Você não possui permissão para alterar planos de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  if p.status in ('executed', 'cancelled') then
    raise exception 'O plano está %; não recebe novos rodízios.',
      case p.status when 'executed' then 'executado' else 'cancelado' end using errcode = 'invalid_parameter_value';
  end if;
  v_items := private.km_rotation_store_items(p, p_items);
  perform private.km_rotation_refresh_plan(p.id);
  return jsonb_build_object('plan_id', p.id, 'items', v_items);
end;
$$;

revoke all on function public.km_add_rotation_items(uuid, jsonb) from public, anon;
grant execute on function public.km_add_rotation_items(uuid, jsonb) to authenticated;

create or replace function public.km_update_rotation_plan(p_plan_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.km_rotation_plans;
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
begin
  select * into p from public.km_rotation_plans where id = p_plan_id for update;
  if p.id is null or not private.has_permission(p.organization_id, 'km.rotation.create') then
    raise exception 'Você não possui permissão para alterar planos de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  update public.km_rotation_plans set
    name = coalesce(v_name, name),
    notes = case when p_payload ? 'notes' then nullif(btrim(coalesce(p_payload ->> 'notes', '')), '') else notes end,
    updated_at = now(), updated_by = auth.uid()
  where id = p.id;
  perform private.km_rotation_event(p, null, 'updated', null, null, null,
    jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_name is not null and v_name <> p.name then jsonb_build_object('from', p.name, 'to', v_name) end,
      'notes', case when p_payload ? 'notes' then jsonb_build_object('from', p.notes, 'to', p_payload ->> 'notes') end)));
  return jsonb_build_object('plan_id', p.id);
end;
$$;

revoke all on function public.km_update_rotation_plan(uuid, jsonb) from public, anon;
grant execute on function public.km_update_rotation_plan(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Status do item (e do plano por consequência)
--    SUGERIDO → APROVADO (km.rotation.approve) → PROGRAMADO (km.rotation.schedule,
--    exige data prevista) → EXECUTADO (km.rotation.execute; grava os hodômetros
--    do dia, base da avaliação pós-rodízio). CANCELADO a partir de qualquer
--    status não executado (km.rotation.approve; motivo obrigatório).
-- -----------------------------------------------------------------------------
create or replace function public.km_set_rotation_item(p_item_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i        public.km_rotation_plan_items;
  p        public.km_rotation_plans;
  v_to     text := nullif(p_payload ->> 'status', '');
  v_reason text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_date   date;
  v_resp   uuid;
  v_exec   date;
  v_odo_a  numeric;
  v_odo_b  numeric;
  v_perm   text;
begin
  select * into i from public.km_rotation_plan_items where id = p_item_id for update;
  if i.id is null then
    raise exception 'Rodízio não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into p from public.km_rotation_plans where id = i.plan_id for update;

  -- campos operacionais (data prevista, responsável, observação)
  if p_payload ? 'effective_date' or p_payload ? 'responsible_employee_id' or p_payload ? 'notes' then
    if not (private.has_permission(i.organization_id, 'km.rotation.schedule')
            or private.has_permission(i.organization_id, 'km.rotation.create')) then
      raise exception 'Você não possui permissão para programar rodízios.' using errcode = 'insufficient_privilege';
    end if;
    if i.status in ('executed', 'cancelled') then
      raise exception 'Rodízio % não pode ser alterado.', case i.status when 'executed' then 'executado' else 'cancelado' end
        using errcode = 'invalid_parameter_value';
    end if;
    v_date := case when p_payload ? 'effective_date' then nullif(p_payload ->> 'effective_date', '')::date else i.effective_date end;
    v_resp := case when p_payload ? 'responsible_employee_id' then nullif(p_payload ->> 'responsible_employee_id', '')::uuid
                   else i.responsible_employee_id end;
    if v_resp is not null and not exists (select 1 from public.employees e
                                          where e.id = v_resp and e.organization_id = i.organization_id
                                            and e.deleted_at is null and e.employment_status = 'active') then
      raise exception 'Responsável inválido ou inativo.' using errcode = 'invalid_parameter_value';
    end if;
    update public.km_rotation_plan_items set
      effective_date = v_date, responsible_employee_id = v_resp,
      notes = case when p_payload ? 'notes' then nullif(btrim(coalesce(p_payload ->> 'notes', '')), '') else notes end,
      updated_at = now()
    where id = i.id;
    perform private.km_rotation_event(p, i.id, 'item_updated', null, null, null,
      jsonb_strip_nulls(jsonb_build_object(
        'effective_date', case when v_date is distinct from i.effective_date then jsonb_build_object('from', i.effective_date, 'to', v_date) end,
        'responsible_employee_id', case when v_resp is distinct from i.responsible_employee_id
                                        then jsonb_build_object('from', i.responsible_employee_id, 'to', v_resp) end,
        'notes', case when p_payload ? 'notes' then jsonb_build_object('from', i.notes, 'to', p_payload ->> 'notes') end)));
    select * into i from public.km_rotation_plan_items where id = p_item_id;
  end if;

  if v_to is null or v_to = i.status then
    return jsonb_build_object('item_id', i.id, 'status', i.status, 'plan_status', private.km_rotation_refresh_plan(p.id));
  end if;

  if not (
       (i.status = 'suggested' and v_to in ('approved', 'cancelled'))
    or (i.status = 'approved' and v_to in ('scheduled', 'cancelled', 'suggested'))
    or (i.status = 'scheduled' and v_to in ('executed', 'cancelled', 'approved'))) then
    raise exception 'Transição de status não permitida (% → %).', i.status, v_to using errcode = 'invalid_parameter_value';
  end if;
  v_perm := case v_to when 'approved' then 'km.rotation.approve' when 'suggested' then 'km.rotation.approve'
                      when 'scheduled' then 'km.rotation.schedule' when 'executed' then 'km.rotation.execute'
                      when 'cancelled' then 'km.rotation.approve' end;
  if not private.has_permission(i.organization_id, v_perm) then
    raise exception 'Você não possui permissão para esta etapa do rodízio.' using errcode = 'insufficient_privilege';
  end if;
  if v_to = 'cancelled' and (v_reason is null or length(v_reason) < 5) then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to = 'scheduled' and i.effective_date is null then
    raise exception 'Informe a data prevista antes de programar o rodízio.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to = 'executed' then
    v_exec := coalesce(nullif(p_payload ->> 'execution_date', '')::date, i.effective_date,
                       private.maintenance_today(i.organization_id));
    if v_exec > private.maintenance_today(i.organization_id) then
      raise exception 'A data de execução não pode estar no futuro.' using errcode = 'invalid_parameter_value';
    end if;
    -- hodômetro oficial de cada veículo até o dia da execução
    select o.odometer_km into v_odo_a from public.vehicle_odometer_readings o
     where o.vehicle_id = i.vehicle_a_id and o.reading_date <= v_exec and o.superseded_by is null order by o.reading_date desc, o.created_at desc limit 1;
    select o.odometer_km into v_odo_b from public.vehicle_odometer_readings o
     where o.vehicle_id = i.vehicle_b_id and o.reading_date <= v_exec and o.superseded_by is null order by o.reading_date desc, o.created_at desc limit 1;
  end if;

  update public.km_rotation_plan_items set
    status = v_to,
    cancelled_reason = case when v_to = 'cancelled' then v_reason else cancelled_reason end,
    executed_at = case when v_to = 'executed' then now() else executed_at end,
    executed_by = case when v_to = 'executed' then auth.uid() else executed_by end,
    execution_date = case when v_to = 'executed' then v_exec else execution_date end,
    execution_odometer_a = case when v_to = 'executed' then v_odo_a else execution_odometer_a end,
    execution_odometer_b = case when v_to = 'executed' then v_odo_b else execution_odometer_b end,
    updated_at = now()
  where id = i.id;

  perform private.km_rotation_event(p, i.id, case when v_to = 'executed' then 'executed' else 'item_status_changed' end,
    i.status, v_to, v_reason,
    case when v_to = 'executed' then jsonb_build_object('execution_date', v_exec, 'odometer_a', v_odo_a, 'odometer_b', v_odo_b)
         else '{}'::jsonb end);
  perform private.emit_event(i.organization_id, 'km.rotation_item_status_changed', 'km_rotation_item', i.id,
    jsonb_build_object('plan_id', p.id, 'from', i.status, 'to', v_to));
  return jsonb_build_object('item_id', i.id, 'status', v_to, 'plan_status', private.km_rotation_refresh_plan(p.id));
end;
$$;

revoke all on function public.km_set_rotation_item(uuid, jsonb) from public, anon;
grant execute on function public.km_set_rotation_item(uuid, jsonb) to authenticated;

-- Ação no plano inteiro: aprovar todos os sugeridos ou cancelar os não executados
create or replace function public.km_set_rotation_plan_status(p_plan_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p        public.km_rotation_plans;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_n      integer;
begin
  select * into p from public.km_rotation_plans where id = p_plan_id for update;
  if p.id is null or not private.has_permission(p.organization_id, 'km.rotation.approve') then
    raise exception 'Você não possui permissão para aprovar ou cancelar planos de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'approved' then
    with up as (
      update public.km_rotation_plan_items set status = 'approved', updated_at = now()
       where plan_id = p.id and status = 'suggested' returning id)
    select count(*) into v_n from up;
  elsif p_status = 'cancelled' then
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'Informe o motivo do cancelamento.' using errcode = 'invalid_parameter_value';
    end if;
    with up as (
      update public.km_rotation_plan_items set status = 'cancelled', cancelled_reason = v_reason, updated_at = now()
       where plan_id = p.id and status in ('suggested', 'approved', 'scheduled') returning id)
    select count(*) into v_n from up;
    update public.km_rotation_plans set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
     where id = p.id;
  else
    raise exception 'Ação inválida para o plano.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.km_rotation_event(p, null, 'status_changed', p.status, p_status, v_reason, jsonb_build_object('items', v_n));
  return jsonb_build_object('plan_id', p.id, 'items', v_n, 'plan_status', private.km_rotation_refresh_plan(p.id));
end;
$$;

revoke all on function public.km_set_rotation_plan_status(uuid, text, text) from public, anon;
grant execute on function public.km_set_rotation_plan_status(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Revalidação: recalcula os itens não executados com os dados atuais (mesma
--    duração de período, terminando no último dia com leitura)
-- -----------------------------------------------------------------------------
create or replace function public.km_revalidate_rotation_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p          public.km_rotation_plans;
  v_last     date;
  v_from     date;
  v_to       date;
  v_pairs    jsonb;
  v_updated  integer := 0;
  v_none     integer := 0;
  v_missing  integer := 0;
  r          record;
begin
  select * into p from public.km_rotation_plans where id = p_plan_id for update;
  if p.id is null or not (private.has_permission(p.organization_id, 'km.rotation.create')
                          or private.has_permission(p.organization_id, 'km.rotation.approve')) then
    raise exception 'Você não possui permissão para revalidar planos de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  v_last := coalesce(private.km_last_valid_day(p.organization_id), p.period_to);
  v_to := greatest(v_last, p.period_to);
  v_from := v_to - (p.period_to - p.period_from);

  select jsonb_agg(jsonb_build_object('vehicle_a_id', i.vehicle_a_id, 'vehicle_b_id', i.vehicle_b_id))
    into v_pairs
    from public.km_rotation_plan_items i
   where i.plan_id = p.id and i.status in ('suggested', 'approved', 'scheduled');

  if v_pairs is not null then
    for r in
      select i.id as item_id, i.priority as old_priority, i.reduction_pct as old_pct, e.*
        from public.km_rotation_plan_items i
        left join private.km_rotation_evaluate(p.organization_id, v_from, v_to, p.filters, p.horizon_days,
                                               p.scope_mode, p.different_locations_only, v_pairs) e
          on e.vehicle_a_id = i.vehicle_a_id and e.vehicle_b_id = i.vehicle_b_id
       where i.plan_id = p.id and i.status in ('suggested', 'approved', 'scheduled')
    loop
      if r.vehicle_a_id is null then
        v_missing := v_missing + 1;
        update public.km_rotation_plan_items set revalidated_at = now(),
               snapshot = snapshot || jsonb_build_object('revalidation_note', 'Sem leituras suficientes no período revalidado.'),
               updated_at = now()
         where id = r.item_id;
        continue;
      end if;
      update public.km_rotation_plan_items set
        snapshot = jsonb_build_object('vehicle_a', r.vehicle_a, 'vehicle_b', r.vehicle_b, 'cohort', r.cohort,
                                      'scenarios', r.scenarios, 'conditioned', r.conditioned,
                                      'condition_reasons', to_jsonb(r.condition_reasons),
                                      'intensity_reduction_a_pct', r.intensity_reduction_a_pct,
                                      'previous', jsonb_build_object('priority', r.old_priority, 'reduction_pct', r.old_pct)),
        gap_current_km = r.gap_current, gap_future_without_km = r.gap_without, gap_future_with_km = r.gap_with,
        reduction_km = r.reduction_km, reduction_pct = coalesce(r.reduction_pct, 0), priority = r.priority,
        justification = r.justification, revalidated_at = now(), updated_at = now()
      where id = r.item_id;
      v_updated := v_updated + 1;
      if r.priority = 'none' then v_none := v_none + 1; end if;
    end loop;
  end if;

  update public.km_rotation_plans set period_from = v_from, period_to = v_to, data_as_of = v_last,
         analyzed_at = now(), revalidated_at = now(), updated_at = now(), updated_by = auth.uid()
   where id = p.id;
  perform private.km_rotation_event(p, null, 'revalidated', null, null, null,
    jsonb_build_object('period_from', v_from, 'period_to', v_to, 'updated', v_updated, 'no_benefit', v_none,
                       'without_data', v_missing));
  return jsonb_build_object('updated', v_updated, 'no_benefit', v_none, 'without_data', v_missing,
                            'period_from', v_from, 'period_to', v_to);
end;
$$;

revoke all on function public.km_revalidate_rotation_plan(uuid) from public, anon;
grant execute on function public.km_revalidate_rotation_plan(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Leitura: lista de planos e detalhe (itens, eventos, dados antigos e
--    avaliação pós-rodízio dos executados)
-- -----------------------------------------------------------------------------
create or replace function public.km_rotation_plans_list(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'km.rotation.view') then
    raise exception 'Você não possui permissão para o plano de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'code', p.code, 'name', p.name, 'notes', p.notes, 'status', p.status,
             'period_from', p.period_from, 'period_to', p.period_to, 'horizon_days', p.horizon_days,
             'scope_mode', p.scope_mode, 'different_locations_only', p.different_locations_only,
             'data_as_of', p.data_as_of, 'analyzed_at', p.analyzed_at, 'revalidated_at', p.revalidated_at,
             'created_at', p.created_at,
             'created_by_name', (select coalesce(e.full_name, u.email) from auth.users u
                                   left join public.employees e on lower(e.corporate_email) = lower(u.email)
                                                              and e.organization_id = p.organization_id
                                  where u.id = p.created_by limit 1),
             'items', (select count(*) from public.km_rotation_plan_items i where i.plan_id = p.id and i.status <> 'cancelled'),
             'executed', (select count(*) from public.km_rotation_plan_items i where i.plan_id = p.id and i.status = 'executed'),
             'avg_reduction_pct', (select round(avg(i.reduction_pct), 1) from public.km_rotation_plan_items i
                                    where i.plan_id = p.id and i.status <> 'cancelled'),
             'reduction_km', (select round(sum(i.reduction_km)) from public.km_rotation_plan_items i
                               where i.plan_id = p.id and i.status <> 'cancelled'),
             'stale_days', greatest(0, private.maintenance_today(p.organization_id) - p.analyzed_at::date))
           order by p.created_at desc), '[]'::jsonb)
      from public.km_rotation_plans p
     where p.organization_id = p_organization_id
       -- só planos com ao menos um veículo visível (ou vazios, do próprio autor)
       and (exists (select 1 from public.km_rotation_plan_items i
                     where i.plan_id = p.id and private.vehicle_in_scope(p.organization_id, i.vehicle_a_id))
            or p.created_by = auth.uid()));
end;
$$;

revoke all on function public.km_rotation_plans_list(uuid) from public, anon;
grant execute on function public.km_rotation_plans_list(uuid) to authenticated, service_role;

create or replace function public.km_rotation_plan_detail(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p     public.km_rotation_plans;
  v_set public.km_settings;
  v_today date;
begin
  select * into p from public.km_rotation_plans where id = p_plan_id;
  if p.id is null or not private.has_permission(p.organization_id, 'km.rotation.view') then
    raise exception 'Você não possui permissão para o plano de rodízio.' using errcode = 'insufficient_privilege';
  end if;
  v_set := private.km_settings_of(p.organization_id);
  v_today := private.maintenance_today(p.organization_id);
  return jsonb_build_object(
    'plan', to_jsonb(p) || jsonb_build_object(
              'stale_days', greatest(0, v_today - p.analyzed_at::date),
              'stale', v_today - p.analyzed_at::date > v_set.rotation_stale_days,
              'stale_limit_days', v_set.rotation_stale_days,
              'created_by_name', (select coalesce(e.full_name, u.email) from auth.users u
                                    left join public.employees e on lower(e.corporate_email) = lower(u.email)
                                                               and e.organization_id = p.organization_id
                                   where u.id = p.created_by limit 1)),
    'permissions', jsonb_build_object(
      'create', private.has_permission(p.organization_id, 'km.rotation.create'),
      'approve', private.has_permission(p.organization_id, 'km.rotation.approve'),
      'schedule', private.has_permission(p.organization_id, 'km.rotation.schedule'),
      'execute', private.has_permission(p.organization_id, 'km.rotation.execute'),
      'apply_fidelization', private.has_permission(p.organization_id, 'km.rotation.apply_fidelization')),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
                'responsible_name', (select e.full_name from public.employees e where e.id = i.responsible_employee_id),
                'in_scope', private.vehicle_in_scope(i.organization_id, i.vehicle_a_id)
                            and private.vehicle_in_scope(i.organization_id, i.vehicle_b_id),
                'evaluation', case when i.status = 'executed' then private.km_rotation_item_evaluation(i.id) end)
                order by i.cohort_label, i.item_number), '[]'::jsonb)
                from public.km_rotation_plan_items i where i.plan_id = p.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', ev.id, 'item_id', ev.item_id, 'event_type', ev.event_type, 'from_status', ev.from_status,
                 'to_status', ev.to_status, 'reason', ev.reason, 'payload', ev.payload, 'actor_name', ev.actor_name,
                 'occurred_at', ev.occurred_at) order by ev.occurred_at desc), '[]'::jsonb)
                 from public.km_rotation_events ev where ev.plan_id = p.id));
end;
$$;

-- Avaliação pós-rodízio: ritmo de cada veículo antes (período analisado) e
-- depois da execução, e o gap dos hodômetros na execução e hoje.
create or replace function private.km_rotation_item_evaluation(p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with i as (select * from public.km_rotation_plan_items where id = p_item_id),
  p as (select pl.* from public.km_rotation_plans pl join i on i.plan_id = pl.id),
  after_ as (
    select r.vehicle_id, sum(r.distance_validated) as km, count(*) filter (where r.distance_validated is not null) as days,
           max(r.odometer_end) as odometer
      from public.km_daily_readings r, i
     where r.vehicle_id in (i.vehicle_a_id, i.vehicle_b_id) and r.reading_date > i.execution_date
     group by r.vehicle_id
  ),
  cur as (
    select v.vid, (select o.odometer_km from public.vehicle_odometer_readings o
                    where o.vehicle_id = v.vid and o.superseded_by is null order by o.reading_date desc, o.created_at desc limit 1) as odometer
      from i, unnest(array[i.vehicle_a_id, i.vehicle_b_id]) v(vid)
  )
  select jsonb_build_object(
    'execution_date', i.execution_date,
    'days_since', (select private.maintenance_today(i.organization_id) - i.execution_date),
    'gap_at_execution', round(i.execution_odometer_a - i.execution_odometer_b),
    'gap_now', round((select c.odometer from cur c where c.vid = i.vehicle_a_id) - (select c.odometer from cur c where c.vid = i.vehicle_b_id)),
    'gap_change', round(((select c.odometer from cur c where c.vid = i.vehicle_a_id) - (select c.odometer from cur c where c.vid = i.vehicle_b_id))
                        - (i.execution_odometer_a - i.execution_odometer_b)),
    'a_daily_before', (i.snapshot -> 'vehicle_a' ->> 'daily_avg')::numeric,
    'b_daily_before', (i.snapshot -> 'vehicle_b' ->> 'daily_avg')::numeric,
    'a_daily_after', (select round(a.km / nullif(a.days, 0), 1) from after_ a where a.vehicle_id = i.vehicle_a_id),
    'b_daily_after', (select round(a.km / nullif(a.days, 0), 1) from after_ a where a.vehicle_id = i.vehicle_b_id),
    'a_days_after', (select a.days from after_ a where a.vehicle_id = i.vehicle_a_id),
    'b_days_after', (select a.days from after_ a where a.vehicle_id = i.vehicle_b_id),
    'result', case
      when coalesce((select a.days from after_ a where a.vehicle_id = i.vehicle_a_id), 0) < 7
        or coalesce((select a.days from after_ a where a.vehicle_id = i.vehicle_b_id), 0) < 7 then 'insufficient_data'
      when ((select c.odometer from cur c where c.vid = i.vehicle_a_id) - (select c.odometer from cur c where c.vid = i.vehicle_b_id))
           < (i.execution_odometer_a - i.execution_odometer_b) then 'converging'
      else 'not_converging' end)
    from i;
$$;

revoke all on function private.km_rotation_item_evaluation(uuid) from public, anon;
revoke all on function public.km_rotation_plan_detail(uuid) from public, anon;
grant execute on function public.km_rotation_plan_detail(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Aplicar o rodízio na Fidelização (nunca automático)
--    Prévia: os dois vínculos vigentes na data e o que acontece com cada um.
--    Aplicação: confirmação explícita + km.rotation.apply_fidelization; a rotina
--    oficial de inversão exige fidelization.change_vehicle nas duas BRs, fecha os
--    vínculos (e motoristas) e abre os novos; tudo na mesma transação.
-- -----------------------------------------------------------------------------
create or replace function private.km_rotation_fidelization_pair(p_item public.km_rotation_plan_items, p_date date)
returns table (assignment_a uuid, assignment_b uuid, info jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with fa as (
    select f.*, v.license_plate, b.code as br_code, o.name as operation_name, c.name as city_name
      from public.fidelization_assignments f
      join public.vehicles v on v.id = f.vehicle_id
      join public.operation_brs b on b.id = f.operation_br_id
      left join public.operations o on o.id = b.operation_id
      left join public.cities c on c.id = b.city_id
     where f.organization_id = p_item.organization_id
       and f.vehicle_id in (p_item.vehicle_a_id, p_item.vehicle_b_id)
       and f.status <> 'cancelled'
       and f.start_date <= p_date and (f.end_date is null or f.end_date >= p_date)
  ),
  a as (select * from fa where fa.vehicle_id = p_item.vehicle_a_id order by fa.start_date desc limit 1),
  b as (select * from fa where fa.vehicle_id = p_item.vehicle_b_id order by fa.start_date desc limit 1)
  select (select a.id from a), (select b.id from b),
         jsonb_build_object(
           'date', p_date,
           'vehicle_a', jsonb_build_object('plate', (select v.license_plate from public.vehicles v where v.id = p_item.vehicle_a_id),
                                           'assignment_id', (select a.id from a), 'br', (select a.br_code from a),
                                           'operation', (select a.operation_name from a), 'local', (select a.city_name from a),
                                           'start_date', (select a.start_date from a), 'end_date', (select a.end_date from a),
                                           'role', (select a.vehicle_role from a)),
           'vehicle_b', jsonb_build_object('plate', (select v.license_plate from public.vehicles v where v.id = p_item.vehicle_b_id),
                                           'assignment_id', (select b.id from b), 'br', (select b.br_code from b),
                                           'operation', (select b.operation_name from b), 'local', (select b.city_name from b),
                                           'start_date', (select b.start_date from b), 'end_date', (select b.end_date from b),
                                           'role', (select b.vehicle_role from b)));
$$;

revoke all on function private.km_rotation_fidelization_pair(public.km_rotation_plan_items, date) from public, anon;

create or replace function public.km_rotation_fidelization_preview(p_item_id uuid, p_effective_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i      public.km_rotation_plan_items;
  r      record;
  v_errs text[] := '{}';
begin
  select * into i from public.km_rotation_plan_items where id = p_item_id;
  if i.id is null or not private.has_permission(i.organization_id, 'km.rotation.apply_fidelization') then
    raise exception 'Você não possui permissão para aplicar rodízios na Fidelização.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from private.km_rotation_fidelization_pair(i, coalesce(p_effective_date, i.effective_date, i.execution_date));
  if i.status not in ('approved', 'scheduled', 'executed') then
    v_errs := v_errs || 'O rodízio precisa estar aprovado, programado ou executado.'::text;
  end if;
  if i.fidelization_applied_at is not null then
    v_errs := v_errs || 'Este rodízio já foi aplicado na Fidelização.'::text;
  end if;
  if r.assignment_a is null then
    v_errs := v_errs || format('A frota %s não tem vínculo de fidelização vigente na data.', r.info -> 'vehicle_a' ->> 'plate');
  end if;
  if r.assignment_b is null then
    v_errs := v_errs || format('A frota %s não tem vínculo de fidelização vigente na data.', r.info -> 'vehicle_b' ->> 'plate');
  end if;
  if r.assignment_a is not null and r.assignment_b is not null
     and (r.info -> 'vehicle_a' ->> 'br') = (r.info -> 'vehicle_b' ->> 'br') then
    v_errs := v_errs || 'As duas frotas estão na mesma BR — não há o que inverter.'::text;
  end if;
  return r.info || jsonb_build_object(
    'can_apply', cardinality(v_errs) = 0 and private.has_permission(i.organization_id, 'fidelization.change_vehicle'),
    'requires_fidelization_permission', not private.has_permission(i.organization_id, 'fidelization.change_vehicle'),
    'errors', to_jsonb(v_errs),
    'result', case when cardinality(v_errs) = 0 then jsonb_build_array(
      format('%s deixa a BR %s e passa para a BR %s.', r.info -> 'vehicle_a' ->> 'plate', r.info -> 'vehicle_a' ->> 'br', r.info -> 'vehicle_b' ->> 'br'),
      format('%s deixa a BR %s e passa para a BR %s.', r.info -> 'vehicle_b' ->> 'plate', r.info -> 'vehicle_b' ->> 'br', r.info -> 'vehicle_a' ->> 'br'),
      'Os vínculos atuais (e os motoristas vinculados) são encerrados no dia anterior e os novos vínculos começam na data informada, como uma inversão da Fidelização.') end);
end;
$$;

revoke all on function public.km_rotation_fidelization_preview(uuid, date) from public, anon;
grant execute on function public.km_rotation_fidelization_preview(uuid, date) to authenticated;

create or replace function public.km_apply_rotation_fidelization(p_item_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i        public.km_rotation_plan_items;
  p        public.km_rotation_plans;
  v_date   date := nullif(p_payload ->> 'effective_date', '')::date;
  v_reason text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_prev   jsonb;
  r        record;
  v_res    jsonb;
begin
  select * into i from public.km_rotation_plan_items where id = p_item_id for update;
  if i.id is null or not private.has_permission(i.organization_id, 'km.rotation.apply_fidelization') then
    raise exception 'Você não possui permissão para aplicar rodízios na Fidelização.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce((p_payload ->> 'confirm')::boolean, false) is not true then
    raise exception 'Confirme a aplicação do rodízio na Fidelização.' using errcode = 'invalid_parameter_value';
  end if;
  v_date := coalesce(v_date, i.effective_date, i.execution_date);
  if v_date is null then
    raise exception 'Informe a data a partir da qual o rodízio vale na Fidelização.' using errcode = 'invalid_parameter_value';
  end if;
  select * into p from public.km_rotation_plans where id = i.plan_id;
  v_prev := public.km_rotation_fidelization_preview(i.id, v_date);
  if jsonb_array_length(v_prev -> 'errors') > 0 then
    raise exception '%', v_prev -> 'errors' ->> 0 using errcode = 'invalid_parameter_value';
  end if;
  select * into r from private.km_rotation_fidelization_pair(i, v_date);
  v_reason := coalesce(v_reason, format('Rodízio de KM %s · item %s (%s ⇄ %s)', p.code, i.item_number,
                                        r.info -> 'vehicle_a' ->> 'plate', r.info -> 'vehicle_b' ->> 'plate'));

  -- rotina oficial da Fidelização (exige fidelization.change_vehicle nas duas BRs)
  v_res := public.invert_fidelization_vehicles(r.assignment_a, r.assignment_b, v_date, v_reason);

  update public.km_rotation_plan_items set
    fidelization_applied_at = now(), fidelization_applied_by = auth.uid(),
    fidelization_payload = jsonb_build_object('effective_date', v_date, 'reason', v_reason,
                                              'before', r.info, 'inversion', v_res),
    updated_at = now()
  where id = i.id;
  perform private.km_rotation_event(p, i.id, 'fidelization_applied', null, null, v_reason,
    jsonb_build_object('effective_date', v_date, 'before', r.info, 'inversion', v_res));
  perform private.emit_event(i.organization_id, 'km.rotation_applied_to_fidelization', 'km_rotation_item', i.id,
    jsonb_build_object('plan_id', p.id, 'effective_date', v_date, 'inversion', v_res));
  return jsonb_build_object('item_id', i.id, 'effective_date', v_date, 'inversion', v_res);
end;
$$;

revoke all on function public.km_apply_rotation_fidelization(uuid, jsonb) from public, anon;
grant execute on function public.km_apply_rotation_fidelization(uuid, jsonb) to authenticated;

comment on function public.km_rotation_candidates(uuid, jsonb) is
  'Gestão de KM: sugestões de rodízio por coorte técnica (só sugere; nada é movimentado).';
comment on function public.km_apply_rotation_fidelization(uuid, jsonb) is
  'Gestão de KM: aplica um rodízio aprovado na Fidelização pela inversão oficial, com confirmação explícita e auditoria.';
