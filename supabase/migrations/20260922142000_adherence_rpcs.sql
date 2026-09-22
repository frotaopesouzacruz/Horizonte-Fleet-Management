-- =============================================================================
-- Etapa 11 — Aderência: rotinas públicas
--
-- LEITURA (security invoker): a view `adherence_obligation_status` já carrega
-- a RLS; toda consulta agrega sobre ela e herda o escopo. Uma fórmula, um
-- lugar: numerador = obrigações devidas com execução válida; denominador =
-- obrigações devidas (§34). Consolidação por soma, nunca por média (§37).
-- Denominador zero devolve `null` — a tela escreve "Sem base" (§35).
--
-- ESCRITA (security definer): permissão, organização, escopo de operação e
-- integridade dos ids verificados aqui, antes de qualquer gravação (§62).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recorte comum (§45): filtros por id, hierarquia respeitada pela tela
-- -----------------------------------------------------------------------------
create or replace function public.adherence_obligations_filtered(
  p_organization_id uuid, p_from date, p_to date,
  p_context text default null, p_filters jsonb default '{}'::jsonb)
returns setof public.adherence_obligation_status
language sql stable security invoker set search_path = ''
as $$
  select s.*
    from public.adherence_obligation_status s
   where s.organization_id = p_organization_id
     and s.operational_date between p_from and p_to
     and (p_context is null or s.checklist_context = p_context)
     and (nullif(p_filters->>'operation_id', '') is null or s.operation_id = (p_filters->>'operation_id')::uuid)
     and (nullif(p_filters->>'state_id', '') is null or s.state_id = (p_filters->>'state_id')::smallint)
     and (nullif(p_filters->>'city_id', '') is null or s.city_id = (p_filters->>'city_id')::integer)
     and (nullif(p_filters->>'organization_unit_id', '') is null or s.organization_unit_id = (p_filters->>'organization_unit_id')::uuid)
     and (nullif(p_filters->>'leader_employee_id', '') is null or s.leader_employee_id = (p_filters->>'leader_employee_id')::uuid)
     and (nullif(p_filters->>'operation_br_id', '') is null or s.operation_br_id = (p_filters->>'operation_br_id')::uuid)
     and (nullif(p_filters->>'vehicle_type_id', '') is null or s.vehicle_type_id = (p_filters->>'vehicle_type_id')::uuid)
     and (nullif(p_filters->>'vehicle_id', '') is null or s.vehicle_id = (p_filters->>'vehicle_id')::uuid)
     and (nullif(p_filters->>'status', '') is null or s.status_code = p_filters->>'status')
     and (nullif(p_filters->>'q', '') is null
          or s.fleet_code_snapshot ilike '%' || (p_filters->>'q') || '%'
          or replace(upper(s.license_plate_snapshot), '-', '') like '%' || replace(upper(p_filters->>'q'), '-', '') || '%');
$$;

-- -----------------------------------------------------------------------------
-- 2. Visão consolidada (§44) — totais e quebra por dimensão, mesma fórmula
-- -----------------------------------------------------------------------------
create or replace function public.adherence_summary(
  p_organization_id uuid, p_from date, p_to date,
  p_context text default 'saida', p_filters jsonb default '{}'::jsonb, p_group_by text default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_target numeric;
  v_pct numeric;
begin
  select jsonb_build_object(
      'obligations',      count(*),
      'done',             count(*) filter (where s.is_done),
      'not_done',         count(*) filter (where s.status_code = 'NAO_FEZ_CHECKLIST'),
      'pending_return',   count(*) filter (where s.status_code = 'RETORNO_PENDENTE'),
      'planned',          count(*) filter (where s.status_code = 'PLANEJADO'),
      'excluded',         count(*) filter (where s.is_excluded),
      'pending_requests', count(*) filter (where s.has_pending_request),
      'provisional',      count(*) filter (where s.is_provisional),
      'numerator',        count(*) filter (where s.is_done and s.is_due),
      'denominator',      count(*) filter (where s.is_due))
    into v
    from public.adherence_obligations_filtered(p_organization_id, p_from, p_to, p_context, p_filters) s;

  v_pct := case when (v->>'denominator')::int > 0
                then round((v->>'numerator')::numeric * 100 / (v->>'denominator')::numeric, 2) end;
  v_target := private.adherence_target_pct(
    p_organization_id, nullif(p_filters->>'operation_id', '')::uuid, p_context, p_to);

  v := v || jsonb_build_object(
    'adherence_pct', v_pct,
    'target_pct', v_target,
    'gap_pct', case when v_pct is not null and v_target is not null then round(v_pct - v_target, 2) end,
    'context', p_context, 'date_from', p_from, 'date_to', p_to);

  if p_group_by is not null then
    if p_group_by not in ('operation','state','city','branch','leader','br','vehicle_type','vehicle') then
      raise exception 'Agrupamento inválido: %', p_group_by using errcode = 'invalid_parameter_value';
    end if;

    select coalesce(jsonb_agg(g order by g->>'label'), '[]'::jsonb) into v_groups
      from (
        select jsonb_build_object(
                 'key', k.key, 'label', k.label,
                 'obligations', count(*),
                 'done', count(*) filter (where s.is_done),
                 'not_done', count(*) filter (where s.status_code = 'NAO_FEZ_CHECKLIST'),
                 'excluded', count(*) filter (where s.is_excluded),
                 'pending_requests', count(*) filter (where s.has_pending_request),
                 'numerator', count(*) filter (where s.is_done and s.is_due),
                 'denominator', count(*) filter (where s.is_due),
                 'adherence_pct', case when count(*) filter (where s.is_due) > 0
                   then round((count(*) filter (where s.is_done and s.is_due))::numeric * 100
                              / (count(*) filter (where s.is_due))::numeric, 2) end) as g
          from public.adherence_obligations_filtered(p_organization_id, p_from, p_to, p_context, p_filters) s
          cross join lateral (
            select case p_group_by
                     when 'operation'    then s.operation_id::text
                     when 'state'        then s.state_id::text
                     when 'city'         then s.city_id::text
                     when 'branch'       then s.organization_unit_id::text
                     when 'leader'       then s.leader_employee_id::text
                     when 'br'           then s.operation_br_id::text
                     when 'vehicle_type' then s.vehicle_type_id::text
                     else s.vehicle_id::text end as key,
                   case p_group_by
                     when 'operation'    then (select o.name from public.operations o where o.id = s.operation_id)
                     when 'state'        then (select st.uf from public.states st where st.id = s.state_id)
                     when 'city'         then (select c.name || '/' || st.uf from public.cities c join public.states st on st.id = c.state_id where c.id = s.city_id)
                     when 'branch'       then (select u.name from public.organization_units u where u.id = s.organization_unit_id)
                     when 'leader'       then (select e.full_name from public.employees e where e.id = s.leader_employee_id)
                     when 'br'           then (select b.code from public.operation_brs b where b.id = s.operation_br_id)
                     when 'vehicle_type' then (select t.name from public.vehicle_types t where t.id = s.vehicle_type_id)
                     else coalesce(s.fleet_code_snapshot, '') || ' · ' || coalesce(s.license_plate_snapshot, '') end as label) k
         group by k.key, k.label
      ) x;
    v := v || jsonb_build_object('group_by', p_group_by, 'groups', v_groups);
  end if;

  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Heatmap (§46) — um registro por dia da competência
-- -----------------------------------------------------------------------------
create or replace function public.adherence_heatmap(
  p_organization_id uuid, p_year integer, p_month integer,
  p_context text default 'saida', p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as d0,
           (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as d1,
           private.adherence_today(p_organization_id) as today
  ),
  days as (
    select d::date as d from bounds, generate_series(bounds.d0, bounds.d1, interval '1 day') d
  ),
  agg as (
    select s.operational_date as d,
           count(*) as obligations,
           count(*) filter (where s.is_done) as done,
           count(*) filter (where s.status_code = 'NAO_FEZ_CHECKLIST') as not_done,
           count(*) filter (where s.status_code = 'RETORNO_PENDENTE') as pending_return,
           count(*) filter (where s.is_excluded) as excluded,
           count(*) filter (where s.has_pending_request) as pending_requests,
           count(*) filter (where s.is_done and s.is_due) as numerator,
           count(*) filter (where s.is_due) as denominator
      from bounds, public.adherence_obligations_filtered(p_organization_id, bounds.d0, bounds.d1, p_context, p_filters) s
     group by s.operational_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', days.d,
           'day', extract(day from days.d)::int,
           'is_today', days.d = bounds.today,
           'is_future', days.d > bounds.today,
           'obligations', coalesce(a.obligations, 0),
           'done', coalesce(a.done, 0),
           'not_done', coalesce(a.not_done, 0),
           'pending_return', coalesce(a.pending_return, 0),
           'excluded', coalesce(a.excluded, 0),
           'pending_requests', coalesce(a.pending_requests, 0),
           'numerator', coalesce(a.numerator, 0),
           'denominator', coalesce(a.denominator, 0),
           'adherence_pct', case when coalesce(a.denominator, 0) > 0
                                 then round(a.numerator::numeric * 100 / a.denominator::numeric, 2) end,
           'target_pct', private.adherence_target_pct(p_organization_id, nullif(p_filters->>'operation_id', '')::uuid, p_context, days.d)
         ) order by days.d), '[]'::jsonb)
    from bounds, days
    left join agg a on a.d = days.d;
$$;

-- -----------------------------------------------------------------------------
-- 4. Matriz mês/dia (§47) — veículos nas linhas, dias nas colunas, paginada
-- -----------------------------------------------------------------------------
create or replace function public.adherence_matrix(
  p_organization_id uuid, p_year integer, p_month integer,
  p_context text default 'saida', p_filters jsonb default '{}'::jsonb,
  p_page integer default 1, p_page_size integer default 50)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with bounds as (
    select make_date(p_year, p_month, 1) as d0,
           (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as d1
  ),
  base as (
    select s.* from bounds, public.adherence_obligations_filtered(p_organization_id, bounds.d0, bounds.d1, p_context, p_filters) s
  ),
  vehicles as (
    select distinct on (b.vehicle_id)
           b.vehicle_id, b.fleet_code_snapshot, b.license_plate_snapshot,
           b.operation_id, b.city_id, b.state_id, b.operation_br_id, b.leader_employee_id, b.vehicle_type_id
      from base b
     order by b.vehicle_id, b.operational_date desc
  ),
  page as (
    select v.*, count(*) over () as total
      from vehicles v
     order by v.fleet_code_snapshot nulls last, v.license_plate_snapshot
     limit greatest(p_page_size, 1) offset greatest(p_page - 1, 0) * greatest(p_page_size, 1)
  ),
  cells as (
    select b.vehicle_id,
           jsonb_object_agg(extract(day from b.operational_date)::int::text, jsonb_build_object(
             'id', b.id, 'status', b.status_code, 'due', b.is_due, 'done', b.is_done,
             'excluded', b.is_excluded, 'provisional', b.is_provisional,
             'pending_request', b.has_pending_request, 'condition', b.detected_condition)) as days
      from base b
     where b.vehicle_id in (select vehicle_id from page)
     group by b.vehicle_id
  )
  select jsonb_build_object(
    'total', coalesce((select max(total) from page), 0),
    'page', p_page, 'page_size', p_page_size,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'vehicle_id', p.vehicle_id,
      'fleet_code', p.fleet_code_snapshot,
      'license_plate', p.license_plate_snapshot,
      'operation_name', (select o.name from public.operations o where o.id = p.operation_id),
      'city_name', (select c.name from public.cities c where c.id = p.city_id),
      'state_uf', (select st.uf from public.states st where st.id = p.state_id),
      'br_code', (select br.code from public.operation_brs br where br.id = p.operation_br_id),
      'leader_name', (select e.full_name from public.employees e where e.id = p.leader_employee_id),
      'vehicle_type_name', (select t.name from public.vehicle_types t where t.id = p.vehicle_type_id),
      'days', coalesce(c.days, '{}'::jsonb)
    ) order by p.fleet_code_snapshot nulls last, p.license_plate_snapshot)
      from page p left join cells c on c.vehicle_id = p.vehicle_id), '[]'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- 5. Detalhe da obrigação (§48) — tudo que a célula precisa contar
-- -----------------------------------------------------------------------------
create or replace function public.adherence_obligation_detail(p_organization_id uuid, p_obligation_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'obligation', to_jsonb(s) || jsonb_build_object(
      'operation_name', (select o.name from public.operations o where o.id = s.operation_id),
      'city_name', (select c.name from public.cities c where c.id = s.city_id),
      'state_uf', (select st.uf from public.states st where st.id = s.state_id),
      'br_code', (select br.code from public.operation_brs br where br.id = s.operation_br_id),
      'branch_name', (select u.name from public.organization_units u where u.id = s.organization_unit_id),
      'leader_name', (select e.full_name from public.employees e where e.id = s.leader_employee_id),
      'vehicle_type_name', (select t.name from public.vehicle_types t where t.id = s.vehicle_type_id),
      'rule_name', (select r.name from public.adherence_eligibility_rules r where r.id = s.eligibility_rule_id),
      'status_label', (select c.label from public.checklist_status_catalog c where c.code = s.status_code),
      'status_tone', (select c.tone from public.checklist_status_catalog c where c.code = s.status_code)),
    'execution', (select jsonb_build_object(
        'id', e.id, 'submitted_at', e.submitted_at, 'started_at', e.started_at,
        'duration_seconds', e.duration_seconds, 'operational_date', e.operational_date,
        'employee_name', (select emp.full_name from public.employees emp where emp.id = e.employee_id),
        'version_label', (select v.label from public.checklist_app_versions v where v.id = e.version_id),
        'applicable_questions', e.applicable_questions, 'conforming_answers', e.conforming_answers,
        'non_conforming_answers', e.non_conforming_answers, 'critical_non_conforming', e.critical_non_conforming,
        'match_source', m.match_source)
      from public.checklist_obligation_matches m join public.checklist_executions e on e.id = m.execution_id
      where m.obligation_id = s.id and m.is_valid),
    'other_executions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'submitted_at', e.submitted_at, 'invalid_reason', m.invalid_reason))
      from public.checklist_obligation_matches m join public.checklist_executions e on e.id = m.execution_id
      where m.obligation_id = s.id and not m.is_valid), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'source', r.source, 'is_override', r.is_override,
        'reason_code', rs.code, 'reason_name', rs.name, 'effect', rs.effect,
        'justification', r.justification, 'evidence_reference', r.evidence_reference,
        'requested_at', r.requested_at,
        'requested_by_name', (select emp.full_name from public.employees emp where emp.id = r.requested_employee_id),
        'decided_at', r.decided_at, 'decision_note', r.decision_note,
        'decided_by_name', (select p.full_name from public.profiles p where p.user_id = r.decided_by),
        'decision_effect', r.decision_effect, 'status_code_applied', r.status_code_applied)
        order by r.requested_at desc)
      from public.adherence_requests r join public.adherence_exclusion_reasons rs on rs.id = r.reason_id
      where r.obligation_id = s.id), '[]'::jsonb),
    'sibling', (select jsonb_build_object('id', o2.id, 'context', o2.checklist_context, 'status', o2.status_code)
      from public.adherence_obligation_status o2
      where o2.organization_id = s.organization_id and o2.vehicle_id = s.vehicle_id
        and o2.operational_date = s.operational_date and o2.checklist_context <> s.checklist_context
      limit 1))
    from public.adherence_obligation_status s
   where s.id = p_obligation_id and s.organization_id = p_organization_id;
$$;

-- -----------------------------------------------------------------------------
-- 6. Jornada (§53): Previsto → Saída → Em rota → Retorno, por veículo e dia
-- -----------------------------------------------------------------------------
create or replace function public.adherence_journey(
  p_organization_id uuid, p_date date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with base as (
    select s.* from public.adherence_obligations_filtered(p_organization_id, p_date, p_date, null, p_filters) s
  ),
  per_vehicle as (
    select b.vehicle_id,
           max(b.fleet_code_snapshot) as fleet_code, max(b.license_plate_snapshot) as license_plate,
           max(b.operation_id::text)::uuid as operation_id, max(b.city_id) as city_id,
           max(b.operation_br_id::text)::uuid as operation_br_id, max(b.leader_employee_id::text)::uuid as leader_employee_id,
           max(case when b.checklist_context = 'saida' then b.status_code end) as departure_status,
           max(case when b.checklist_context = 'saida' then b.id::text end)::uuid as departure_id,
           max(case when b.checklist_context = 'retorno' then b.status_code end) as return_status,
           max(case when b.checklist_context = 'retorno' then b.id::text end)::uuid as return_id,
           bool_or(b.is_excluded) as any_excluded,
           bool_or(b.status_code = 'PLANEJADO') as any_planned
      from base b
     group by b.vehicle_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle_id', v.vehicle_id, 'fleet_code', v.fleet_code, 'license_plate', v.license_plate,
    'operation_name', (select o.name from public.operations o where o.id = v.operation_id),
    'city_name', (select c.name from public.cities c where c.id = v.city_id),
    'br_code', (select br.code from public.operation_brs br where br.id = v.operation_br_id),
    'leader_name', (select e.full_name from public.employees e where e.id = v.leader_employee_id),
    'departure_status', v.departure_status, 'departure_id', v.departure_id,
    'return_status', v.return_status, 'return_id', v.return_id,
    'journey', case
      when v.any_planned then 'prevista'
      when v.any_excluded then 'excecao'
      when v.departure_status = 'FEZ_CHECKLIST' and v.return_status = 'FEZ_CHECKLIST' then 'completa'
      when v.departure_status = 'FEZ_CHECKLIST' and v.return_status = 'RETORNO_PENDENTE' then 'em_rota'
      when v.departure_status = 'FEZ_CHECKLIST' and v.return_status is null then 'completa'
      when v.departure_status = 'FEZ_CHECKLIST' or v.return_status = 'FEZ_CHECKLIST' then 'incompleta'
      when v.departure_status is null and v.return_status = 'RETORNO_PENDENTE' then 'em_rota'
      else 'nao_realizada' end
  ) order by v.fleet_code nulls last, v.license_plate), '[]'::jsonb)
  from per_vehicle v;
$$;

-- -----------------------------------------------------------------------------
-- 7. Pendências do escopo (§30) — o que a liderança pode justificar
-- -----------------------------------------------------------------------------
create or replace function public.adherence_pending_list(
  p_organization_id uuid, p_from date, p_to date,
  p_context text default null, p_filters jsonb default '{}'::jsonb, p_limit integer default 200)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'vehicle_id', s.vehicle_id, 'fleet_code', s.fleet_code_snapshot, 'license_plate', s.license_plate_snapshot,
    'operational_date', s.operational_date, 'context', s.checklist_context, 'status', s.status_code,
    'provisional', s.is_provisional, 'pending_request', s.has_pending_request, 'condition', s.detected_condition,
    'operation_name', (select o.name from public.operations o where o.id = s.operation_id),
    'city_name', (select c.name from public.cities c where c.id = s.city_id),
    'br_code', (select br.code from public.operation_brs br where br.id = s.operation_br_id),
    'leader_name', (select e.full_name from public.employees e where e.id = s.leader_employee_id)
  ) order by s.operational_date desc, s.fleet_code_snapshot), '[]'::jsonb)
  from (
    select * from public.adherence_obligations_filtered(p_organization_id, p_from, p_to, p_context, p_filters) x
     where x.status_code = 'NAO_FEZ_CHECKLIST'
     order by x.operational_date desc, x.fleet_code_snapshot
     limit greatest(p_limit, 1)
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- 8. Solicitações (§51, §52) — lista e estatísticas
-- -----------------------------------------------------------------------------
create or replace function public.adherence_requests_list(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb,
  p_page integer default 1, p_page_size integer default 50)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with base as (
    select r.*, s.vehicle_id, s.fleet_code_snapshot, s.license_plate_snapshot, s.operational_date,
           s.operation_id, s.city_id, s.operation_br_id, s.leader_employee_id, s.status_code as obligation_status,
           rs.code as reason_code, rs.name as reason_name, rs.effect as reason_effect
      from public.adherence_requests r
      join public.adherence_obligation_status s on s.id = r.obligation_id
      join public.adherence_exclusion_reasons rs on rs.id = r.reason_id
     where r.organization_id = p_organization_id
       and (nullif(p_filters->>'status', '') is null or r.status = p_filters->>'status')
       and (nullif(p_filters->>'context', '') is null or r.checklist_context = p_filters->>'context')
       and (nullif(p_filters->>'reason_code', '') is null or rs.code = p_filters->>'reason_code')
       and (nullif(p_filters->>'operation_id', '') is null or s.operation_id = (p_filters->>'operation_id')::uuid)
       and (nullif(p_filters->>'city_id', '') is null or s.city_id = (p_filters->>'city_id')::integer)
       and (nullif(p_filters->>'leader_employee_id', '') is null or s.leader_employee_id = (p_filters->>'leader_employee_id')::uuid)
       and (nullif(p_filters->>'date_from', '') is null or s.operational_date >= (p_filters->>'date_from')::date)
       and (nullif(p_filters->>'date_to', '') is null or s.operational_date <= (p_filters->>'date_to')::date)
       and (nullif(p_filters->>'q', '') is null
            or s.fleet_code_snapshot ilike '%' || (p_filters->>'q') || '%'
            or replace(upper(s.license_plate_snapshot), '-', '') like '%' || replace(upper(p_filters->>'q'), '-', '') || '%')
  ),
  stats as (
    select jsonb_build_object(
      'total', count(*),
      'pending', count(*) filter (where status = 'pending'),
      'approved', count(*) filter (where status = 'approved'),
      'rejected', count(*) filter (where status = 'rejected'),
      'avg_wait_hours', round(coalesce(avg(extract(epoch from (coalesce(decided_at, now()) - requested_at)) / 3600) filter (where status <> 'cancelled'), 0)::numeric, 1),
      'by_operation', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'label', (select o.name from public.operations o where o.id = k), 'total', n, 'pending', np))
                        from (select operation_id k, count(*) n, count(*) filter (where status = 'pending') np from base group by operation_id) x), '[]'::jsonb),
      'by_leader', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'label', (select e.full_name from public.employees e where e.id = k), 'total', n, 'pending', np))
                     from (select leader_employee_id k, count(*) n, count(*) filter (where status = 'pending') np from base group by leader_employee_id) x), '[]'::jsonb)
    ) as s
    from base
  ),
  page as (
    select b.*, count(*) over () as total from base b
     order by (b.status = 'pending') desc, b.requested_at desc
     limit greatest(p_page_size, 1) offset greatest(p_page - 1, 0) * greatest(p_page_size, 1)
  )
  select jsonb_build_object(
    'stats', (select s from stats),
    'total', coalesce((select max(total) from page), 0),
    'page', p_page, 'page_size', p_page_size,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'obligation_id', p.obligation_id, 'status', p.status, 'source', p.source, 'is_override', p.is_override,
      'context', p.checklist_context, 'operational_date', p.operational_date,
      'vehicle_id', p.vehicle_id, 'fleet_code', p.fleet_code_snapshot, 'license_plate', p.license_plate_snapshot,
      'operation_name', (select o.name from public.operations o where o.id = p.operation_id),
      'city_name', (select c.name from public.cities c where c.id = p.city_id),
      'br_code', (select br.code from public.operation_brs br where br.id = p.operation_br_id),
      'leader_name', (select e.full_name from public.employees e where e.id = p.leader_employee_id),
      'reason_code', p.reason_code, 'reason_name', p.reason_name, 'reason_effect', p.reason_effect,
      'justification', p.justification, 'evidence_reference', p.evidence_reference,
      'requested_at', p.requested_at,
      'requested_by_name', coalesce((select e.full_name from public.employees e where e.id = p.requested_employee_id),
                                    (select pr.full_name from public.profiles pr where pr.user_id = p.requested_by)),
      'decided_at', p.decided_at, 'decision_note', p.decision_note,
      'decided_by_name', (select pr.full_name from public.profiles pr where pr.user_id = p.decided_by),
      'obligation_status', p.obligation_status,
      'wait_hours', round((extract(epoch from (coalesce(p.decided_at, now()) - p.requested_at)) / 3600)::numeric, 1)
    ) order by (p.status = 'pending') desc, p.requested_at desc) from page p), '[]'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- 9. Opções e parâmetros da tela
-- -----------------------------------------------------------------------------
create or replace function public.adherence_options(p_organization_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'statuses', (select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'tone', c.tone, 'description', c.description) order by c.sort_order)
                 from public.checklist_status_catalog c where c.is_active),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'code', r.code, 'name', r.name, 'description', r.description, 'effect', r.effect,
                  'status_code', r.status_code, 'requires_evidence', r.requires_evidence,
                  'requires_approval', r.requires_approval, 'applies_to_departure', r.applies_to_departure,
                  'applies_to_return', r.applies_to_return, 'inherits_to_return', r.inherits_to_return,
                  'is_active', r.is_active) order by r.sort_order)
                 from public.adherence_exclusion_reasons r where r.organization_id = p_organization_id), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'name', r.name, 'description', r.description, 'priority', r.priority,
                  'operation_id', r.operation_id, 'vehicle_type_id', r.vehicle_type_id,
                  'vehicle_subcategory_id', r.vehicle_subcategory_id, 'vehicle_status', r.vehicle_status,
                  'requires_checklist', r.requires_checklist, 'applies_to_departure', r.applies_to_departure,
                  'applies_to_return', r.applies_to_return, 'weekdays', r.weekdays,
                  'valid_from', r.valid_from, 'valid_to', r.valid_to, 'version', r.version, 'is_active', r.is_active,
                  'operation_name', (select o.name from public.operations o where o.id = r.operation_id),
                  'vehicle_type_name', (select t.name from public.vehicle_types t where t.id = r.vehicle_type_id))
                  order by r.priority, r.name)
                 from public.adherence_eligibility_rules r where r.organization_id = p_organization_id), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', t.id, 'operation_id', t.operation_id, 'context', t.checklist_context, 'target_pct', t.target_pct,
                  'valid_from', t.valid_from, 'valid_to', t.valid_to, 'notes', t.notes,
                  'operation_name', (select o.name from public.operations o where o.id = t.operation_id))
                  order by t.valid_from desc)
                 from public.adherence_targets t where t.organization_id = p_organization_id), '[]'::jsonb),
    'settings', (select to_jsonb(s) from public.adherence_settings s where s.organization_id = p_organization_id),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'kind', r.kind, 'date_from', r.date_from, 'date_to', r.date_to, 'reason', r.reason,
                  'is_preview', r.is_preview, 'status', r.status, 'stats', r.stats, 'error_message', r.error_message,
                  'started_at', r.started_at, 'finished_at', r.finished_at,
                  'requested_by_name', (select p.full_name from public.profiles p where p.user_id = r.requested_by))
                  order by r.started_at desc)
                 from (select * from public.adherence_runs x where x.organization_id = p_organization_id and not x.is_preview
                        order by x.started_at desc limit 12) r), '[]'::jsonb),
    'inconsistencies', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', i.id, 'kind', i.kind, 'vehicle_id', i.vehicle_id, 'operational_date', i.operational_date,
                  'context', i.checklist_context, 'details', i.details, 'created_at', i.created_at,
                  'fleet_code', (select v.fleet_code from public.vehicles v where v.id = i.vehicle_id))
                  order by i.created_at desc)
                 from (select * from public.adherence_inconsistencies x where x.organization_id = p_organization_id and x.status = 'open'
                        order by x.created_at desc limit 50) i), '[]'::jsonb),
    'today', private.adherence_today(p_organization_id));
$$;

-- -----------------------------------------------------------------------------
-- 10. Solicitar justificativa / expurgo (§30)
-- -----------------------------------------------------------------------------
create or replace function private.adherence_actor_employee(p_organization_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.employee_id from public.organization_memberships m
   where m.user_id = auth.uid() and m.organization_id = p_organization_id and m.status = 'active'
   limit 1;
$$;

create or replace function public.request_adherence_exclusion(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_obl        record;
  v_reason     record;
  v_id         uuid;
  v_sibling    record;
  v_inherited  uuid;
  v_just       text := nullif(btrim(coalesce(p_payload ->> 'justification', '')), '');
  v_evidence   text := nullif(btrim(coalesce(p_payload ->> 'evidence_reference', '')), '');
  v_inherit    boolean := coalesce((p_payload ->> 'inherit_to_return')::boolean, false);
  v_employee   uuid := private.adherence_actor_employee(p_organization_id);
begin
  if not private.has_permission(p_organization_id, 'adherence.request') then
    raise exception 'Você não possui permissão para solicitar justificativas.' using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_obl from public.adherence_obligation_status s
   where s.id = nullif(p_payload ->> 'obligation_id', '')::uuid and s.organization_id = p_organization_id;
  if v_obl.id is null then
    raise exception 'Obrigação não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if not private.can_access_operation(v_obl.operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.' using errcode = 'insufficient_privilege';
  end if;
  if v_obl.is_done then
    raise exception 'Esta obrigação já possui checklist válido; não cabe justificativa.' using errcode = 'invalid_parameter_value';
  end if;
  if v_obl.is_excluded then
    raise exception 'Esta obrigação já possui expurgo aprovado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_obl.has_pending_request then
    raise exception 'Já existe uma solicitação pendente para esta obrigação.' using errcode = 'unique_violation';
  end if;
  if v_obl.operational_date > v_obl.today then
    raise exception 'Não é possível justificar uma obrigação futura.' using errcode = 'invalid_parameter_value';
  end if;

  select r.* into v_reason from public.adherence_exclusion_reasons r
   where r.organization_id = p_organization_id and r.code = upper(coalesce(p_payload ->> 'reason_code', '')) and r.is_active
     and (r.valid_from is null or r.valid_from <= v_obl.operational_date)
     and (r.valid_to is null or r.valid_to >= v_obl.operational_date);
  if v_reason.id is null then
    raise exception 'Motivo inválido ou fora de vigência.' using errcode = 'invalid_parameter_value';
  end if;
  if (v_obl.checklist_context = 'saida' and not v_reason.applies_to_departure)
     or (v_obl.checklist_context = 'retorno' and not v_reason.applies_to_return) then
    raise exception 'O motivo % não se aplica ao contexto de %.', v_reason.name,
      case v_obl.checklist_context when 'saida' then 'saída' else 'retorno' end using errcode = 'invalid_parameter_value';
  end if;
  if v_just is null or length(v_just) < 5 then
    raise exception 'Informe a justificativa (mínimo de 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason.requires_evidence and v_evidence is null then
    raise exception 'O motivo % exige referência de evidência (OS, chamado, documento).', v_reason.name
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.adherence_requests
    (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference,
     source, requested_by, requested_employee_id)
  values
    (p_organization_id, v_obl.id, v_reason.id, v_obl.checklist_context, v_just, v_evidence,
     'leadership', auth.uid(), v_employee)
  returning id into v_id;

  -- §33: herança para o retorno só quando o motivo permite e o retorno está em aberto.
  if v_inherit and v_obl.checklist_context = 'saida' and v_reason.inherits_to_return and v_reason.applies_to_return then
    select s.* into v_sibling from public.adherence_obligation_status s
     where s.organization_id = p_organization_id and s.vehicle_id = v_obl.vehicle_id
       and s.operational_date = v_obl.operational_date and s.checklist_context = 'retorno';
    if v_sibling.id is not null and not v_sibling.is_done and not v_sibling.is_excluded and not v_sibling.has_pending_request then
      insert into public.adherence_requests
        (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference,
         source, requested_by, requested_employee_id, inherited_from_request_id)
      values
        (p_organization_id, v_sibling.id, v_reason.id, 'retorno', v_just, v_evidence,
         'inherited', auth.uid(), v_employee, v_id)
      returning id into v_inherited;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'inherited_id', v_inherited);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Decidir (§31, §32): aprovar, rejeitar ou reclassificar — nunca a própria
-- -----------------------------------------------------------------------------
create or replace function public.decide_adherence_request(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_req      record;
  v_obl      record;
  v_reason   record;
  v_decision text := lower(coalesce(p_payload ->> 'decision', ''));
  v_note     text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_new_code text := nullif(upper(coalesce(p_payload ->> 'new_reason_code', '')), '');
begin
  if not private.has_permission(p_organization_id, 'adherence.approve') then
    raise exception 'Você não possui permissão para decidir solicitações.' using errcode = 'insufficient_privilege';
  end if;
  if v_decision not in ('approve', 'reject', 'reclassify') then
    raise exception 'Decisão inválida.' using errcode = 'invalid_parameter_value';
  end if;

  select r.* into v_req from public.adherence_requests r
   where r.id = nullif(p_payload ->> 'request_id', '')::uuid and r.organization_id = p_organization_id
   for update;
  if v_req.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Esta solicitação já foi decidida.' using errcode = 'invalid_parameter_value';
  end if;
  if v_req.requested_by is not null and v_req.requested_by = auth.uid() then
    raise exception 'O solicitante não pode decidir a própria solicitação.' using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_obl from public.adherence_obligation_status s where s.id = v_req.obligation_id;
  if not private.can_access_operation(v_obl.operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.' using errcode = 'insufficient_privilege';
  end if;

  if v_decision = 'reject' then
    if v_note is null then
      raise exception 'Informe o motivo da rejeição.' using errcode = 'invalid_parameter_value';
    end if;
    update public.adherence_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now()
     where id = v_req.id;
    return jsonb_build_object('id', v_req.id, 'status', 'rejected');
  end if;

  if v_decision = 'reclassify' then
    if v_new_code is null then
      raise exception 'Informe o novo motivo.' using errcode = 'invalid_parameter_value';
    end if;
    select r.* into v_reason from public.adherence_exclusion_reasons r
     where r.organization_id = p_organization_id and r.code = v_new_code and r.is_active;
    if v_reason.id is null then
      raise exception 'Novo motivo inválido.' using errcode = 'invalid_parameter_value';
    end if;
  else
    select r.* into v_reason from public.adherence_exclusion_reasons r where r.id = v_req.reason_id;
  end if;

  if (v_req.checklist_context = 'saida' and not v_reason.applies_to_departure)
     or (v_req.checklist_context = 'retorno' and not v_reason.applies_to_return) then
    raise exception 'O motivo % não se aplica a este contexto.', v_reason.name using errcode = 'invalid_parameter_value';
  end if;
  if v_reason.effect in ('exclude', 'count_done') and v_obl.is_done then
    raise exception 'A obrigação já possui checklist válido; a solicitação deve ser rejeitada ou registrada sem efeito.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_reason.requires_evidence and v_req.evidence_reference is null then
    raise exception 'O motivo % exige referência de evidência antes da aprovação.', v_reason.name
      using errcode = 'invalid_parameter_value';
  end if;

  update public.adherence_requests
     set status = 'approved',
         reason_id = v_reason.id,
         reclassified_from_reason_id = case when v_reason.id <> v_req.reason_id then v_req.reason_id end,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         decision_effect = v_reason.effect,
         status_code_applied = v_reason.status_code,
         updated_at = now()
   where id = v_req.id;

  return jsonb_build_object('id', v_req.id, 'status', 'approved', 'effect', v_reason.effect,
                            'status_code', v_reason.status_code);
end;
$$;

create or replace function public.cancel_adherence_request(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_req record;
begin
  select r.* into v_req from public.adherence_requests r
   where r.id = nullif(p_payload ->> 'request_id', '')::uuid and r.organization_id = p_organization_id for update;
  if v_req.id is null then
    raise exception 'Solicitação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Só solicitações pendentes podem ser canceladas.' using errcode = 'invalid_parameter_value';
  end if;
  if not (v_req.requested_by = auth.uid() or private.has_permission(p_organization_id, 'adherence.approve')) then
    raise exception 'Você não pode cancelar esta solicitação.' using errcode = 'insufficient_privilege';
  end if;
  update public.adherence_requests set status = 'cancelled', updated_at = now(),
         decision_note = nullif(btrim(coalesce(p_payload ->> 'note', '')), '')
   where id = v_req.id;
  return jsonb_build_object('id', v_req.id, 'status', 'cancelled');
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Correção administrativa (§49) e alteração em massa (§50)
--
-- A exceção autorizada da §32: uma pessoa com permissão própria cria e decide
-- na mesma ação, com justificativa obrigatória e marcação de override na
-- auditoria. O que ela NÃO pode: contar como feito (isso exigiria evidência e
-- aprovação por outra pessoa), tocar em obrigação com execução válida, nem
-- atropelar uma solicitação pendente.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_apply_override(
  p_organization_id uuid, p_obligation_id uuid, p_reason_id uuid, p_justification text, p_source text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_obl record;
  v_reason record;
begin
  select s.* into v_obl from public.adherence_obligation_status s
   where s.id = p_obligation_id and s.organization_id = p_organization_id;
  if v_obl.id is null then return 'not_found'; end if;
  if not private.can_access_operation(v_obl.operation_id) then return 'out_of_scope'; end if;
  if v_obl.is_done then return 'has_execution'; end if;
  if v_obl.is_excluded then return 'already_excluded'; end if;
  if v_obl.has_pending_request then return 'pending_request'; end if;
  if v_obl.operational_date > v_obl.today then return 'future'; end if;

  select r.* into v_reason from public.adherence_exclusion_reasons r where r.id = p_reason_id;
  if (v_obl.checklist_context = 'saida' and not v_reason.applies_to_departure)
     or (v_obl.checklist_context = 'retorno' and not v_reason.applies_to_return) then
    return 'reason_not_applicable';
  end if;

  insert into public.adherence_requests
    (organization_id, obligation_id, reason_id, checklist_context, justification, source, is_override,
     status, requested_by, requested_employee_id, decided_by, decided_at, decision_note,
     decision_effect, status_code_applied)
  values
    (p_organization_id, v_obl.id, v_reason.id, v_obl.checklist_context, p_justification, p_source, true,
     'approved', auth.uid(), private.adherence_actor_employee(p_organization_id), auth.uid(), now(),
     'Correção administrativa (exceção autorizada).', v_reason.effect, v_reason.status_code);
  return 'applied';
end;
$$;

create or replace function public.override_adherence_status(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason record;
  v_just text := nullif(btrim(coalesce(p_payload ->> 'justification', '')), '');
  v_out text;
begin
  if not private.has_permission(p_organization_id, 'adherence.override') then
    raise exception 'Você não possui permissão para correção administrativa.' using errcode = 'insufficient_privilege';
  end if;
  if v_just is null or length(v_just) < 10 then
    raise exception 'A correção administrativa exige justificativa (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  select r.* into v_reason from public.adherence_exclusion_reasons r
   where r.organization_id = p_organization_id and r.code = upper(coalesce(p_payload ->> 'reason_code', '')) and r.is_active;
  if v_reason.id is null then
    raise exception 'Motivo inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason.effect = 'count_done' then
    raise exception 'Uma correção administrativa não pode registrar checklist como feito. Use a solicitação com evidência e aprovação.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_out := private.adherence_apply_override(
    p_organization_id, nullif(p_payload ->> 'obligation_id', '')::uuid, v_reason.id, v_just, 'admin');
  if v_out <> 'applied' then
    raise exception '%', case v_out
      when 'not_found' then 'Obrigação não encontrada.'
      when 'out_of_scope' then 'Esta operação não faz parte do seu escopo de acesso.'
      when 'has_execution' then 'A obrigação já possui checklist válido e não pode ser corrigida.'
      when 'already_excluded' then 'A obrigação já possui expurgo aprovado.'
      when 'pending_request' then 'Há uma solicitação pendente. Decida-a antes de corrigir.'
      when 'future' then 'Não é possível corrigir uma obrigação futura.'
      else 'O motivo não se aplica a este contexto.' end
      using errcode = 'invalid_parameter_value';
  end if;
  return jsonb_build_object('status', 'applied');
end;
$$;

create or replace function public.bulk_adherence_override(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason record;
  v_just text := nullif(btrim(coalesce(p_payload ->> 'justification', '')), '');
  v_dry boolean := coalesce((p_payload ->> 'dry_run')::boolean, true);
  v_ids uuid[];
  v_id uuid;
  v_out text;
  v_counts jsonb := '{}'::jsonb;
  v_applied uuid[] := array[]::uuid[];
  v_obl record;
begin
  if not private.has_permission(p_organization_id, 'adherence.bulk_update')
     or not private.has_permission(p_organization_id, 'adherence.override') then
    raise exception 'Você não possui permissão para alteração em massa.' using errcode = 'insufficient_privilege';
  end if;
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_payload -> 'obligation_ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Selecione ao menos uma obrigação.' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Aplique no máximo 500 registros por vez.' using errcode = 'invalid_parameter_value';
  end if;
  if v_just is null or length(v_just) < 10 then
    raise exception 'A alteração em massa exige justificativa (mínimo de 10 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  select r.* into v_reason from public.adherence_exclusion_reasons r
   where r.organization_id = p_organization_id and r.code = upper(coalesce(p_payload ->> 'reason_code', '')) and r.is_active;
  if v_reason.id is null then
    raise exception 'Motivo inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason.effect = 'count_done' then
    raise exception 'Uma alteração em massa não pode registrar checklist como feito.' using errcode = 'invalid_parameter_value';
  end if;

  foreach v_id in array v_ids loop
    if v_dry then
      select s.* into v_obl from public.adherence_obligation_status s where s.id = v_id and s.organization_id = p_organization_id;
      v_out := case
        when v_obl.id is null then 'not_found'
        when not private.can_access_operation(v_obl.operation_id) then 'out_of_scope'
        when v_obl.is_done then 'has_execution'
        when v_obl.is_excluded then 'already_excluded'
        when v_obl.has_pending_request then 'pending_request'
        when v_obl.operational_date > v_obl.today then 'future'
        when (v_obl.checklist_context = 'saida' and not v_reason.applies_to_departure)
          or (v_obl.checklist_context = 'retorno' and not v_reason.applies_to_return) then 'reason_not_applicable'
        else 'applied' end;
    else
      v_out := private.adherence_apply_override(p_organization_id, v_id, v_reason.id, v_just, 'bulk');
    end if;
    v_counts := jsonb_set(v_counts, array[v_out], to_jsonb(coalesce((v_counts ->> v_out)::int, 0) + 1));
    if v_out = 'applied' then v_applied := v_applied || v_id; end if;
  end loop;

  return jsonb_build_object('preview', v_dry, 'total', cardinality(v_ids), 'reason_code', v_reason.code,
                            'counts', v_counts, 'applied_ids', to_jsonb(v_applied));
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Metas (§36), regras e motivos (§26, §28)
-- -----------------------------------------------------------------------------
create or replace function public.set_adherence_target(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_op uuid := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_ctx text := nullif(p_payload ->> 'context', '');
  v_pct numeric := nullif(p_payload ->> 'target_pct', '')::numeric;
  v_from date := coalesce(nullif(p_payload ->> 'valid_from', '')::date, private.adherence_today(p_organization_id));
  v_id uuid;
begin
  perform private.assert_governance_access(p_organization_id, v_op, 'adherence.manage_targets',
    'Você não possui permissão para administrar metas.');
  if v_pct is null or v_pct <= 0 or v_pct > 100 then
    raise exception 'Informe uma meta entre 0 e 100%%.' using errcode = 'invalid_parameter_value';
  end if;
  if v_ctx is not null and v_ctx not in ('saida', 'retorno') then
    raise exception 'Contexto inválido.' using errcode = 'invalid_parameter_value';
  end if;

  -- encerra a meta vigente do mesmo escopo no dia anterior, preservando o histórico
  update public.adherence_targets t
     set valid_to = v_from - 1, updated_at = now(), updated_by = auth.uid()
   where t.organization_id = p_organization_id
     and t.operation_id is not distinct from v_op and t.checklist_context is not distinct from v_ctx
     and t.valid_from < v_from and (t.valid_to is null or t.valid_to >= v_from);
  delete from public.adherence_targets t
   where t.organization_id = p_organization_id
     and t.operation_id is not distinct from v_op and t.checklist_context is not distinct from v_ctx
     and t.valid_from = v_from;

  insert into public.adherence_targets (organization_id, operation_id, checklist_context, target_pct, valid_from, notes, created_by, updated_by)
  values (p_organization_id, v_op, v_ctx, v_pct, v_from, nullif(p_payload ->> 'notes', ''), auth.uid(), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.save_adherence_rule(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_op uuid := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_weekdays smallint[];
begin
  perform private.assert_governance_access(p_organization_id, v_op, 'adherence.manage_rules',
    'Você não possui permissão para administrar a elegibilidade.');
  select array_agg(x::smallint) into v_weekdays from jsonb_array_elements_text(coalesce(p_payload -> 'weekdays', '[1,2,3,4,5,6,7]'::jsonb)) x;

  if v_id is null then
    insert into public.adherence_eligibility_rules
      (organization_id, name, description, priority, operation_id, vehicle_type_id, vehicle_subcategory_id, vehicle_status,
       requires_checklist, applies_to_departure, applies_to_return, weekdays,
       return_deadline_time, return_deadline_next_day, valid_from, valid_to, is_active, created_by, updated_by)
    values
      (p_organization_id, p_payload ->> 'name', nullif(p_payload ->> 'description', ''),
       coalesce(nullif(p_payload ->> 'priority', '')::smallint, 100), v_op,
       nullif(p_payload ->> 'vehicle_type_id', '')::uuid, nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid,
       nullif(p_payload ->> 'vehicle_status', ''),
       coalesce((p_payload ->> 'requires_checklist')::boolean, true),
       coalesce((p_payload ->> 'applies_to_departure')::boolean, true),
       coalesce((p_payload ->> 'applies_to_return')::boolean, true),
       coalesce(v_weekdays, '{1,2,3,4,5,6,7}'),
       nullif(p_payload ->> 'return_deadline_time', '')::time, (p_payload ->> 'return_deadline_next_day')::boolean,
       coalesce(nullif(p_payload ->> 'valid_from', '')::date, private.adherence_today(p_organization_id)),
       nullif(p_payload ->> 'valid_to', '')::date,
       coalesce((p_payload ->> 'is_active')::boolean, true), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.adherence_eligibility_rules r
       set name = coalesce(p_payload ->> 'name', r.name),
           description = case when p_payload ? 'description' then nullif(p_payload ->> 'description', '') else r.description end,
           priority = coalesce(nullif(p_payload ->> 'priority', '')::smallint, r.priority),
           operation_id = case when p_payload ? 'operation_id' then v_op else r.operation_id end,
           vehicle_type_id = case when p_payload ? 'vehicle_type_id' then nullif(p_payload ->> 'vehicle_type_id', '')::uuid else r.vehicle_type_id end,
           vehicle_subcategory_id = case when p_payload ? 'vehicle_subcategory_id' then nullif(p_payload ->> 'vehicle_subcategory_id', '')::uuid else r.vehicle_subcategory_id end,
           vehicle_status = case when p_payload ? 'vehicle_status' then nullif(p_payload ->> 'vehicle_status', '') else r.vehicle_status end,
           requires_checklist = coalesce((p_payload ->> 'requires_checklist')::boolean, r.requires_checklist),
           applies_to_departure = coalesce((p_payload ->> 'applies_to_departure')::boolean, r.applies_to_departure),
           applies_to_return = coalesce((p_payload ->> 'applies_to_return')::boolean, r.applies_to_return),
           weekdays = case when p_payload ? 'weekdays' then v_weekdays else r.weekdays end,
           valid_from = coalesce(nullif(p_payload ->> 'valid_from', '')::date, r.valid_from),
           valid_to = case when p_payload ? 'valid_to' then nullif(p_payload ->> 'valid_to', '')::date else r.valid_to end,
           is_active = coalesce((p_payload ->> 'is_active')::boolean, r.is_active),
           updated_by = auth.uid()
     where r.id = v_id and r.organization_id = p_organization_id;
    if not found then
      raise exception 'Regra não encontrada.' using errcode = 'no_data_found';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.save_adherence_reason(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
begin
  if not private.has_permission(p_organization_id, 'adherence.manage_rules') then
    raise exception 'Você não possui permissão para administrar motivos.' using errcode = 'insufficient_privilege';
  end if;
  if v_id is null then
    insert into public.adherence_exclusion_reasons
      (organization_id, code, name, description, effect, status_code, requires_evidence, requires_approval,
       applies_to_departure, applies_to_return, inherits_to_return, sort_order, is_active, created_by, updated_by)
    values
      (p_organization_id, upper(p_payload ->> 'code'), p_payload ->> 'name', nullif(p_payload ->> 'description', ''),
       coalesce(nullif(p_payload ->> 'effect', ''), 'exclude'), nullif(p_payload ->> 'status_code', ''),
       coalesce((p_payload ->> 'requires_evidence')::boolean, false), true,
       coalesce((p_payload ->> 'applies_to_departure')::boolean, true),
       coalesce((p_payload ->> 'applies_to_return')::boolean, true),
       coalesce((p_payload ->> 'inherits_to_return')::boolean, false),
       coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, 100),
       coalesce((p_payload ->> 'is_active')::boolean, true), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.adherence_exclusion_reasons r
       set name = coalesce(p_payload ->> 'name', r.name),
           description = case when p_payload ? 'description' then nullif(p_payload ->> 'description', '') else r.description end,
           effect = coalesce(nullif(p_payload ->> 'effect', ''), r.effect),
           status_code = case when p_payload ? 'status_code' then nullif(p_payload ->> 'status_code', '') else r.status_code end,
           requires_evidence = coalesce((p_payload ->> 'requires_evidence')::boolean, r.requires_evidence),
           applies_to_departure = coalesce((p_payload ->> 'applies_to_departure')::boolean, r.applies_to_departure),
           applies_to_return = coalesce((p_payload ->> 'applies_to_return')::boolean, r.applies_to_return),
           inherits_to_return = coalesce((p_payload ->> 'inherits_to_return')::boolean, r.inherits_to_return),
           sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, r.sort_order),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, r.is_active),
           updated_at = now(), updated_by = auth.uid()
     where r.id = v_id and r.organization_id = p_organization_id;
    if not found then
      raise exception 'Motivo não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
exception
  when unique_violation then
    raise exception 'Já existe um motivo com este código.' using errcode = 'unique_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Reconciliar período (§39, §40) — com prévia, motivo e diff registrado
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_adherence_period(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_from date := nullif(p_payload ->> 'date_from', '')::date;
  v_to date := nullif(p_payload ->> 'date_to', '')::date;
  v_op uuid := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_ctx text := nullif(p_payload ->> 'context', '');
  v_reason text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_preview boolean := coalesce((p_payload ->> 'preview')::boolean, true);
  v_today date := private.adherence_today(p_organization_id);
  v_run uuid;
  v_stats jsonb;
  v_matched int := 0;
  x record;
begin
  perform private.assert_governance_access(p_organization_id, v_op, 'adherence.reconcile',
    'Você não possui permissão para reconciliar períodos.');
  if v_from is null or v_to is null or v_to < v_from then
    raise exception 'Informe um período válido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to > v_today + 62 then
    raise exception 'O período não pode ultrapassar 62 dias à frente.' using errcode = 'invalid_parameter_value';
  end if;
  if not v_preview and (v_reason is null or length(v_reason) < 5) then
    raise exception 'Informe o motivo da reconciliação.' using errcode = 'invalid_parameter_value';
  end if;
  if v_ctx is not null and v_ctx not in ('saida', 'retorno') then
    raise exception 'Contexto inválido.' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.adherence_runs (organization_id, kind, date_from, date_to, operation_id, checklist_context, reason, is_preview, requested_by)
  values (p_organization_id, 'reconcile', v_from, v_to, v_op, v_ctx, v_reason, v_preview, auth.uid())
  returning id into v_run;

  begin
    v_stats := private.adherence_generate(p_organization_id, v_from, v_to, v_op, null, v_ctx, true, v_preview, v_run, v_reason);

    if not v_preview then
      -- execuções do período ainda sem conciliação (§22): tenta de novo
      for x in
        select e.id from public.checklist_executions e
         where e.organization_id = p_organization_id and e.status = 'submitted'
           and e.operational_date between v_from - 1 and v_to
           and (v_ctx is null or e.checklist_type = v_ctx)
           and (v_op is null or e.operation_id = v_op)
           and not exists (select 1 from public.checklist_obligation_matches m where m.execution_id = e.id)
      loop
        perform private.adherence_match_execution(x.id, 'reconcile', auth.uid());
        v_matched := v_matched + 1;
      end loop;
      v_stats := v_stats || jsonb_build_object('executions_rematched', v_matched,
                                               'outbox', private.adherence_consume_outbox(500));
    else
      select count(*) into v_matched from public.checklist_executions e
       where e.organization_id = p_organization_id and e.status = 'submitted'
         and e.operational_date between v_from - 1 and v_to
         and (v_ctx is null or e.checklist_type = v_ctx)
         and (v_op is null or e.operation_id = v_op)
         and not exists (select 1 from public.checklist_obligation_matches m where m.execution_id = e.id);
      v_stats := v_stats || jsonb_build_object('executions_to_rematch', v_matched);
    end if;

    update public.adherence_runs set status = 'completed', finished_at = now(), stats = v_stats where id = v_run;
  exception when others then
    update public.adherence_runs set status = 'failed', finished_at = now(), error_message = left(sqlerrm, 1000) where id = v_run;
    raise;
  end;

  return v_stats || jsonb_build_object('run_id', v_run);
end;
$$;

create or replace function public.resolve_adherence_inconsistency(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_status text := lower(coalesce(p_payload ->> 'status', 'resolved'));
begin
  if not private.has_permission(p_organization_id, 'adherence.reconcile') then
    raise exception 'Você não possui permissão para conciliar inconsistências.' using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('resolved', 'dismissed') then
    raise exception 'Situação inválida.' using errcode = 'invalid_parameter_value';
  end if;
  update public.adherence_inconsistencies i
     set status = v_status, resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = nullif(btrim(coalesce(p_payload ->> 'note', '')), '')
   where i.id = v_id and i.organization_id = p_organization_id and i.status = 'open';
  if not found then
    raise exception 'Inconsistência não encontrada ou já tratada.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Superfície de execução
-- -----------------------------------------------------------------------------
revoke execute on function
  public.adherence_obligations_filtered(uuid, date, date, text, jsonb),
  public.adherence_summary(uuid, date, date, text, jsonb, text),
  public.adherence_heatmap(uuid, integer, integer, text, jsonb),
  public.adherence_matrix(uuid, integer, integer, text, jsonb, integer, integer),
  public.adherence_obligation_detail(uuid, uuid),
  public.adherence_journey(uuid, date, jsonb),
  public.adherence_pending_list(uuid, date, date, text, jsonb, integer),
  public.adherence_requests_list(uuid, jsonb, integer, integer),
  public.adherence_options(uuid),
  public.request_adherence_exclusion(uuid, jsonb),
  public.decide_adherence_request(uuid, jsonb),
  public.cancel_adherence_request(uuid, jsonb),
  public.override_adherence_status(uuid, jsonb),
  public.bulk_adherence_override(uuid, jsonb),
  public.set_adherence_target(uuid, jsonb),
  public.save_adherence_rule(uuid, jsonb),
  public.save_adherence_reason(uuid, jsonb),
  public.reconcile_adherence_period(uuid, jsonb),
  public.resolve_adherence_inconsistency(uuid, jsonb)
from public, anon;

revoke execute on function
  private.adherence_apply_override(uuid, uuid, uuid, text, text),
  private.adherence_actor_employee(uuid)
from public, anon, authenticated;
