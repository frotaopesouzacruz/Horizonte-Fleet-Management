-- =============================================================================
-- Refinamento da Etapa 11 — Aderência: leituras gerenciais, Retorno, decisões
-- em lote, seleção por dias, histórico de importação e exportação auditada
--
-- Nada aqui cria um segundo motor: todas as leituras saem de
-- `adherence_obligations_filtered` (a mesma view de status, a mesma fórmula),
-- e todas as escritas passam pelas rotinas já existentes. O que muda:
--
-- 1. `adherence_obligations_filtered` ganha o filtro `justification`
--    (pending | approved | rejected | none) — a matriz filtra pela situação
--    da justificativa sem uma segunda consulta (§36).
-- 2. `adherence_monthly` — o dashboard mês a mês do ano (§25): numerador,
--    denominador, expurgos, percentual e meta por mês; futuro sem resultado.
-- 3. `adherence_day_detail` — o painel do dia do Heatmap (§31): indicadores,
--    quebras por operação/cidade/liderança, veículos sem checklist e expurgos.
-- 4. `adherence_return_tracking` — Acompanhamento do Retorno (§46–§50):
--    retornos previstos, realizados, no prazo, vencidos, por liderança, e a
--    fila de quem ainda não voltou, com o prazo exigível.
-- 5. `adherence_insights` — os Insights Gerenciais (§27), calculados dos
--    dados reais do período: variação mensal, desvio da meta, pendências,
--    operações e localidades abaixo da meta, dias abaixo da meta.
-- 6. `adherence_select_obligations` — os ids das obrigações de dias
--    selecionados na matriz, para a alteração em massa com prévia (§40).
-- 7. `decide_adherence_requests_bulk` — aprovar/rejeitar/reclassificar em
--    lote com prévia e resultado por item; cada item passa pelas mesmas
--    validações da decisão individual (§57).
-- 8. `adherence_import_history` — o histórico de importações (§67).
-- 9. `log_adherence_export` — exportação registrada na auditoria.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Filtro por situação da justificativa
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
          or replace(upper(s.license_plate_snapshot), '-', '') like '%' || replace(upper(p_filters->>'q'), '-', '') || '%')
     -- §36: situação da justificativa — separada do status da obrigação.
     and (nullif(p_filters->>'justification', '') is null
          or (p_filters->>'justification' = 'pending'  and s.has_pending_request)
          or (p_filters->>'justification' = 'approved' and s.approved_request_id is not null)
          or (p_filters->>'justification' = 'rejected' and s.approved_request_id is null and not s.has_pending_request
              and exists (select 1 from public.adherence_requests r where r.obligation_id = s.id and r.status = 'rejected'))
          or (p_filters->>'justification' = 'none' and s.approved_request_id is null and not s.has_pending_request
              and not exists (select 1 from public.adherence_requests r where r.obligation_id = s.id and r.status = 'rejected')));
$$;

-- -----------------------------------------------------------------------------
-- 2. Dashboard mensal (§25): o ano, mês a mês, mesma fórmula
-- -----------------------------------------------------------------------------
create or replace function public.adherence_monthly(
  p_organization_id uuid, p_year integer, p_context text default 'saida', p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with months as (
    select m, make_date(p_year, m, 1) as d0, (make_date(p_year, m, 1) + interval '1 month - 1 day')::date as d1
      from generate_series(1, 12) m
  ),
  t as (select private.adherence_today(p_organization_id) as today),
  agg as (
    select extract(month from s.operational_date)::int as m,
           count(*) as obligations,
           count(*) filter (where s.is_done) as done,
           count(*) filter (where s.status_code = 'NAO_FEZ_CHECKLIST') as not_done,
           count(*) filter (where s.is_excluded) as excluded,
           count(*) filter (where s.has_pending_request) as pending_requests,
           count(*) filter (where s.is_done and s.is_due) as numerator,
           count(*) filter (where s.is_due) as denominator
      from public.adherence_obligations_filtered(p_organization_id, make_date(p_year, 1, 1), make_date(p_year, 12, 31), p_context, p_filters) s
     group by 1
  ),
  rows_ as (
    select months.m, months.d0, months.d1,
           months.d0 > t.today as is_future,
           t.today between months.d0 and months.d1 as is_current,
           coalesce(a.obligations, 0) as obligations, coalesce(a.done, 0) as done, coalesce(a.not_done, 0) as not_done,
           coalesce(a.excluded, 0) as excluded, coalesce(a.pending_requests, 0) as pending_requests,
           coalesce(a.numerator, 0) as numerator, coalesce(a.denominator, 0) as denominator,
           private.adherence_target_pct(p_organization_id, nullif(p_filters->>'operation_id', '')::uuid, p_context, least(months.d1, t.today)) as target_pct
      from months cross join t
      left join agg a on a.m = months.m
  )
  select jsonb_build_object(
    'year', p_year, 'context', p_context,
    'months', (select jsonb_agg(jsonb_build_object(
        'month', r.m, 'is_future', r.is_future, 'is_current', r.is_current,
        'obligations', r.obligations, 'done', r.done, 'not_done', r.not_done, 'excluded', r.excluded,
        'pending_requests', r.pending_requests, 'numerator', r.numerator, 'denominator', r.denominator,
        'adherence_pct', case when r.denominator > 0 then round(r.numerator::numeric * 100 / r.denominator, 2) end,
        'target_pct', r.target_pct,
        'gap_pct', case when r.denominator > 0 and r.target_pct is not null
                        then round(r.numerator::numeric * 100 / r.denominator - r.target_pct, 2) end
      ) order by r.m) from rows_ r),
    'total', (select jsonb_build_object(
        'numerator', sum(r.numerator), 'denominator', sum(r.denominator), 'excluded', sum(r.excluded),
        'adherence_pct', case when sum(r.denominator) > 0 then round(sum(r.numerator)::numeric * 100 / sum(r.denominator), 2) end)
      from rows_ r));
$$;

-- -----------------------------------------------------------------------------
-- 3. Detalhe do dia (§31): o que o Heatmap abre ao selecionar uma data
-- -----------------------------------------------------------------------------
create or replace function public.adherence_day_detail(
  p_organization_id uuid, p_date date, p_context text default 'saida', p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with t as (select private.adherence_today(p_organization_id) as today),
  base as (
    select s.* from public.adherence_obligations_filtered(p_organization_id, p_date, p_date, p_context, p_filters) s
  ),
  grp as (
    select dim, key, label,
           count(*) as obligations,
           count(*) filter (where is_done) as done,
           count(*) filter (where status_code = 'NAO_FEZ_CHECKLIST') as not_done,
           count(*) filter (where is_excluded) as excluded,
           count(*) filter (where is_done and is_due) as numerator,
           count(*) filter (where is_due) as denominator
      from (
        select b.*, 'operation' as dim, b.operation_id::text as key,
               (select o.name from public.operations o where o.id = b.operation_id) as label from base b
        union all
        select b.*, 'city', b.city_id::text,
               (select c.name || '/' || st.uf from public.cities c join public.states st on st.id = c.state_id where c.id = b.city_id) from base b
        union all
        select b.*, 'leader', coalesce(b.leader_employee_id::text, 'none'),
               coalesce((select e.full_name from public.employees e where e.id = b.leader_employee_id), 'Sem liderança') from base b
      ) x
     group by dim, key, label
  )
  select jsonb_build_object(
    'date', p_date, 'context', p_context,
    'is_today', p_date = t.today, 'is_future', p_date > t.today,
    'obligations', (select count(*) from base),
    'done', (select count(*) filter (where is_done) from base),
    'not_done', (select count(*) filter (where status_code = 'NAO_FEZ_CHECKLIST') from base),
    'pending_return', (select count(*) filter (where status_code = 'RETORNO_PENDENTE') from base),
    'planned', (select count(*) filter (where status_code = 'PLANEJADO') from base),
    'excluded', (select count(*) filter (where is_excluded) from base),
    'pending_requests', (select count(*) filter (where has_pending_request) from base),
    'provisional', (select count(*) filter (where is_provisional) from base),
    'numerator', (select count(*) filter (where is_done and is_due) from base),
    'denominator', (select count(*) filter (where is_due) from base),
    'adherence_pct', (select case when count(*) filter (where is_due) > 0
                        then round((count(*) filter (where is_done and is_due))::numeric * 100 / (count(*) filter (where is_due)), 2) end from base),
    'target_pct', private.adherence_target_pct(p_organization_id, nullif(p_filters->>'operation_id', '')::uuid, p_context, p_date),
    'by_operation', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'label', g.label, 'obligations', g.obligations, 'done', g.done,
                       'not_done', g.not_done, 'excluded', g.excluded, 'numerator', g.numerator, 'denominator', g.denominator,
                       'adherence_pct', case when g.denominator > 0 then round(g.numerator::numeric * 100 / g.denominator, 2) end) order by g.label)
                     from grp g where g.dim = 'operation'), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'label', g.label, 'obligations', g.obligations, 'done', g.done,
                       'not_done', g.not_done, 'excluded', g.excluded, 'numerator', g.numerator, 'denominator', g.denominator,
                       'adherence_pct', case when g.denominator > 0 then round(g.numerator::numeric * 100 / g.denominator, 2) end) order by g.label)
                     from grp g where g.dim = 'city'), '[]'::jsonb),
    'by_leader', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'label', g.label, 'obligations', g.obligations, 'done', g.done,
                       'not_done', g.not_done, 'excluded', g.excluded, 'numerator', g.numerator, 'denominator', g.denominator,
                       'adherence_pct', case when g.denominator > 0 then round(g.numerator::numeric * 100 / g.denominator, 2) end) order by g.label)
                     from grp g where g.dim = 'leader'), '[]'::jsonb),
    'not_done_vehicles', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', b.id, 'vehicle_id', b.vehicle_id, 'fleet_code', b.fleet_code_snapshot, 'license_plate', b.license_plate_snapshot,
                       'operation_name', (select o.name from public.operations o where o.id = b.operation_id),
                       'city_name', (select c.name from public.cities c where c.id = b.city_id),
                       'br_code', (select br.code from public.operation_brs br where br.id = b.operation_br_id),
                       'leader_name', (select e.full_name from public.employees e where e.id = b.leader_employee_id),
                       'provisional', b.is_provisional, 'pending_request', b.has_pending_request, 'condition', b.detected_condition)
                       order by b.fleet_code_snapshot nulls last, b.license_plate_snapshot)
                     from (select * from base where status_code = 'NAO_FEZ_CHECKLIST' order by fleet_code_snapshot nulls last limit 200) b), '[]'::jsonb),
    'excluded_vehicles', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', b.id, 'fleet_code', b.fleet_code_snapshot, 'license_plate', b.license_plate_snapshot,
                       'status', b.status_code,
                       'reason_name', (select rs.name from public.adherence_exclusion_reasons rs where rs.id = b.approved_reason_id))
                       order by b.fleet_code_snapshot nulls last)
                     from (select * from base where is_excluded order by fleet_code_snapshot nulls last limit 200) b), '[]'::jsonb)
  ) from t;
$$;

-- -----------------------------------------------------------------------------
-- 4. Acompanhamento do Retorno (§46–§50)
--
-- O retorno tem obrigação e execução próprias; a saída só informa a jornada.
-- "Aguardando retorno" é o veículo que saiu (saída feita) e cujo retorno ainda
-- está no prazo — nunca uma falta. "Vencido" é o retorno cujo prazo exigível
-- passou sem execução. Nada aqui herda expurgo: a herança é da solicitação.
-- -----------------------------------------------------------------------------
create or replace function public.adherence_return_tracking(
  p_organization_id uuid, p_from date, p_to date, p_filters jsonb default '{}'::jsonb, p_limit integer default 300)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with t as (select private.adherence_today(p_organization_id) as today),
  ret as (
    select s.* from public.adherence_obligations_filtered(p_organization_id, p_from, p_to, 'retorno', p_filters) s
  ),
  dep as (
    select s.vehicle_id, s.operational_date, s.status_code, s.is_done
      from public.adherence_obligations_filtered(p_organization_id, p_from, p_to, 'saida', p_filters) s
  ),
  joined as (
    select r.*, d.status_code as departure_status, coalesce(d.is_done, false) as departure_done
      from ret r left join dep d on d.vehicle_id = r.vehicle_id and d.operational_date = r.operational_date
  ),
  by_leader as (
    select coalesce(j.leader_employee_id::text, 'none') as key,
           coalesce((select e.full_name from public.employees e where e.id = j.leader_employee_id), 'Sem liderança') as label,
           count(*) as expected, count(*) filter (where j.is_done) as done,
           count(*) filter (where j.status_code = 'RETORNO_PENDENTE') as pending,
           count(*) filter (where j.status_code = 'NAO_FEZ_CHECKLIST') as overdue,
           count(*) filter (where j.is_excluded) as excluded,
           count(*) filter (where j.is_done and j.is_due) as numerator, count(*) filter (where j.is_due) as denominator
      from joined j group by 1, 2
  )
  select jsonb_build_object(
    'date_from', p_from, 'date_to', p_to, 'today', t.today,
    'stats', (select jsonb_build_object(
        'expected', count(*),
        'done', count(*) filter (where j.is_done),
        'pending_in_deadline', count(*) filter (where j.status_code = 'RETORNO_PENDENTE'),
        'awaiting_return', count(*) filter (where j.status_code = 'RETORNO_PENDENTE' and j.departure_done),
        'overdue', count(*) filter (where j.status_code = 'NAO_FEZ_CHECKLIST'),
        'excluded', count(*) filter (where j.is_excluded),
        'planned', count(*) filter (where j.status_code = 'PLANEJADO'),
        'pending_requests', count(*) filter (where j.has_pending_request),
        'departure_done_return_missing', count(*) filter (where j.departure_done and j.status_code = 'NAO_FEZ_CHECKLIST'),
        'numerator', count(*) filter (where j.is_done and j.is_due),
        'denominator', count(*) filter (where j.is_due),
        'adherence_pct', case when count(*) filter (where j.is_due) > 0
                           then round((count(*) filter (where j.is_done and j.is_due))::numeric * 100 / (count(*) filter (where j.is_due)), 2) end,
        'target_pct', private.adherence_target_pct(p_organization_id, nullif(p_filters->>'operation_id', '')::uuid, 'retorno', least(p_to, t.today)))
      from joined j),
    'by_leader', coalesce((select jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'expected', l.expected, 'done', l.done,
                    'pending', l.pending, 'overdue', l.overdue, 'excluded', l.excluded,
                    'adherence_pct', case when l.denominator > 0 then round(l.numerator::numeric * 100 / l.denominator, 2) end) order by l.label)
                  from by_leader l), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'vehicle_id', j.vehicle_id, 'fleet_code', j.fleet_code_snapshot, 'license_plate', j.license_plate_snapshot,
        'operational_date', j.operational_date,
        'operation_name', (select o.name from public.operations o where o.id = j.operation_id),
        'city_name', (select c.name from public.cities c where c.id = j.city_id),
        'br_code', (select br.code from public.operation_brs br where br.id = j.operation_br_id),
        'leader_name', (select e.full_name from public.employees e where e.id = j.leader_employee_id),
        'expected_at', j.expected_at, 'deadline_at', j.deadline_at,
        'status', j.status_code, 'departure_status', j.departure_status, 'departure_done', j.departure_done,
        'pending_request', j.has_pending_request, 'provisional', j.is_provisional,
        'situation', case
          when j.status_code = 'RETORNO_PENDENTE' and j.departure_done then 'awaiting_return'
          when j.status_code = 'RETORNO_PENDENTE' then 'not_departed'
          when j.status_code = 'NAO_FEZ_CHECKLIST' and j.departure_done then 'overdue_after_departure'
          else 'overdue' end)
        order by j.deadline_at, j.fleet_code_snapshot)
      from (select * from joined where status_code in ('RETORNO_PENDENTE', 'NAO_FEZ_CHECKLIST')
             order by deadline_at, fleet_code_snapshot limit greatest(p_limit, 1)) j), '[]'::jsonb),
    'rows_total', (select count(*) from joined where status_code in ('RETORNO_PENDENTE', 'NAO_FEZ_CHECKLIST'))
  ) from t;
$$;

-- -----------------------------------------------------------------------------
-- 5. Insights gerenciais (§27): dos dados reais do período, nunca genéricos
-- -----------------------------------------------------------------------------
create or replace function public.adherence_insights(
  p_organization_id uuid, p_year integer, p_month integer, p_context text default 'saida', p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_d0 date := make_date(p_year, p_month, 1);
  v_d1 date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_p0 date := (make_date(p_year, p_month, 1) - interval '1 month')::date;
  v_p1 date := (make_date(p_year, p_month, 1) - interval '1 day')::date;
  v_today date := private.adherence_today(p_organization_id);
  v_cur jsonb; v_prev jsonb; v_ops jsonb; v_cities jsonb; v_heat jsonb; v_today_stats jsonb;
  v_target numeric;
  v_days_below int := 0; v_days_with_base int := 0;
begin
  v_cur := public.adherence_summary(p_organization_id, v_d0, v_d1, p_context, p_filters, null);
  v_prev := public.adherence_summary(p_organization_id, v_p0, v_p1, p_context, p_filters, null);
  v_ops := public.adherence_summary(p_organization_id, v_d0, v_d1, p_context, p_filters, 'operation') -> 'groups';
  v_cities := public.adherence_summary(p_organization_id, v_d0, v_d1, p_context, p_filters, 'city') -> 'groups';
  v_heat := public.adherence_heatmap(p_organization_id, p_year, p_month, p_context, p_filters);
  v_target := (v_cur ->> 'target_pct')::numeric;

  select count(*) filter (where (d ->> 'denominator')::int > 0 and (d ->> 'target_pct') is not null
                            and (d ->> 'adherence_pct')::numeric < (d ->> 'target_pct')::numeric),
         count(*) filter (where (d ->> 'denominator')::int > 0)
    into v_days_below, v_days_with_base
    from jsonb_array_elements(v_heat) d;

  if v_today between v_d0 and v_d1 then
    v_today_stats := public.adherence_summary(p_organization_id, v_today, v_today, p_context, p_filters, null);
  end if;

  return jsonb_build_object(
    'competence', to_char(v_d0, 'YYYY-MM'), 'context', p_context, 'today', v_today,
    'is_future_month', v_d0 > v_today,
    'current', jsonb_build_object('adherence_pct', v_cur -> 'adherence_pct', 'numerator', v_cur -> 'numerator',
                 'denominator', v_cur -> 'denominator', 'target_pct', v_cur -> 'target_pct', 'gap_pct', v_cur -> 'gap_pct',
                 'not_done', v_cur -> 'not_done', 'excluded', v_cur -> 'excluded', 'pending_requests', v_cur -> 'pending_requests'),
    'previous', jsonb_build_object('competence', to_char(v_p0, 'YYYY-MM'), 'adherence_pct', v_prev -> 'adherence_pct',
                 'numerator', v_prev -> 'numerator', 'denominator', v_prev -> 'denominator'),
    'variation_pts', case when (v_cur ->> 'adherence_pct') is not null and (v_prev ->> 'adherence_pct') is not null
                          then round((v_cur ->> 'adherence_pct')::numeric - (v_prev ->> 'adherence_pct')::numeric, 2) end,
    'today', case when v_today_stats is null then null else jsonb_build_object(
                 'obligations', v_today_stats -> 'obligations', 'done', v_today_stats -> 'done',
                 'not_done', v_today_stats -> 'not_done', 'provisional', v_today_stats -> 'provisional',
                 'pending_requests', v_today_stats -> 'pending_requests') end,
    'days_with_base', v_days_with_base, 'days_below_target', v_days_below,
    'operations_below_target', coalesce((select jsonb_agg(g order by (g ->> 'adherence_pct')::numeric)
                                  from (select g from jsonb_array_elements(v_ops) g
                                         where v_target is not null and (g ->> 'adherence_pct') is not null
                                           and (g ->> 'adherence_pct')::numeric < v_target
                                         order by (g ->> 'adherence_pct')::numeric limit 5) x), '[]'::jsonb),
    'cities_below_target', coalesce((select jsonb_agg(g order by (g ->> 'adherence_pct')::numeric)
                                  from (select g from jsonb_array_elements(v_cities) g
                                         where v_target is not null and (g ->> 'adherence_pct') is not null
                                           and (g ->> 'adherence_pct')::numeric < v_target
                                         order by (g ->> 'adherence_pct')::numeric limit 5) x), '[]'::jsonb),
    'operations_with_pending', coalesce((select jsonb_agg(g order by (g ->> 'not_done')::int desc)
                                  from (select g from jsonb_array_elements(v_ops) g
                                         where (g ->> 'not_done')::int > 0 order by (g ->> 'not_done')::int desc limit 5) x), '[]'::jsonb),
    'best_operation', (select g from jsonb_array_elements(v_ops) g where (g ->> 'adherence_pct') is not null
                        order by (g ->> 'adherence_pct')::numeric desc limit 1),
    'worst_operation', (select g from jsonb_array_elements(v_ops) g where (g ->> 'adherence_pct') is not null
                         order by (g ->> 'adherence_pct')::numeric asc limit 1));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Seleção de dias na matriz (§40): os ids que uma ação em lote alcançaria
-- -----------------------------------------------------------------------------
create or replace function public.adherence_select_obligations(
  p_organization_id uuid, p_dates jsonb, p_context text default 'saida',
  p_filters jsonb default '{}'::jsonb, p_limit integer default 500)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with dates as (select (d #>> '{}')::date as d from jsonb_array_elements(coalesce(p_dates, '[]'::jsonb)) d),
  base as (
    select s.* from public.adherence_obligations_filtered(
             p_organization_id, (select min(d) from dates), (select max(d) from dates), p_context, p_filters) s
     where s.operational_date in (select d from dates)
  ),
  picked as (select b.* from base b order by b.operational_date, b.fleet_code_snapshot limit greatest(p_limit, 1))
  select jsonb_build_object(
    'total', (select count(*) from base),
    'selected', (select count(*) from picked),
    'truncated', (select count(*) from base) > greatest(p_limit, 1),
    'ids', coalesce((select jsonb_agg(p.id) from picked p), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(k, n) from (select status_code k, count(*) n from picked group by 1) x), '{}'::jsonb),
    'eligible', (select count(*) from picked p where not p.is_done and not p.is_excluded and not p.has_pending_request and p.operational_date <= p.today));
$$;

-- -----------------------------------------------------------------------------
-- 7. Decisões em lote (§57): prévia + resultado por item, mesmas validações
-- -----------------------------------------------------------------------------
create or replace function public.decide_adherence_requests_bulk(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_decision text := coalesce(p_payload ->> 'decision', 'approve');
  v_note text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_new_code text := nullif(upper(coalesce(p_payload ->> 'new_reason_code', '')), '');
  v_dry boolean := coalesce((p_payload ->> 'dry_run')::boolean, true);
  v_ids uuid[]; v_id uuid;
  v_req record; v_obl record; v_reason record;
  v_out text; v_msg text;
  v_items jsonb := '[]'::jsonb; v_counts jsonb := '{}'::jsonb;
begin
  if not private.has_permission(p_organization_id, 'adherence.approve') then
    raise exception 'Você não possui permissão para decidir solicitações.' using errcode = 'insufficient_privilege';
  end if;
  if v_decision not in ('approve', 'reject', 'reclassify') then
    raise exception 'Decisão inválida.' using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_payload -> 'request_ids', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Selecione ao menos uma solicitação.' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_ids) > 200 then
    raise exception 'Decida no máximo 200 solicitações por vez.' using errcode = 'invalid_parameter_value';
  end if;
  if v_decision = 'reject' and v_note is null then
    raise exception 'Informe o motivo da rejeição.' using errcode = 'invalid_parameter_value';
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
  end if;

  foreach v_id in array v_ids loop
    v_msg := null;
    select r.* into v_req from public.adherence_requests r where r.id = v_id and r.organization_id = p_organization_id;
    if v_req.id is null then
      v_out := 'not_found';
    elsif v_req.status <> 'pending' then
      v_out := 'not_pending';
    elsif v_req.requested_by = auth.uid() then
      v_out := 'own_request';
    else
      select s.* into v_obl from public.adherence_obligation_status s where s.id = v_req.obligation_id;
      if v_obl.id is null or not private.can_access_operation(v_obl.operation_id) then
        v_out := 'out_of_scope';
      elsif v_decision = 'reject' then
        v_out := 'applicable';
      else
        if v_decision = 'approve' then
          select r.* into v_reason from public.adherence_exclusion_reasons r where r.id = v_req.reason_id;
        end if;
        if (v_req.checklist_context = 'saida' and not v_reason.applies_to_departure)
           or (v_req.checklist_context = 'retorno' and not v_reason.applies_to_return) then
          v_out := 'reason_not_applicable';
        elsif v_reason.effect in ('exclude', 'count_done') and v_obl.is_done then
          -- §59: execução válida nunca é descartada por uma aprovação em lote.
          v_out := 'has_execution';
        elsif v_reason.requires_evidence and v_req.evidence_reference is null then
          v_out := 'evidence_missing';
        else
          v_out := 'applicable';
        end if;
      end if;
    end if;

    if v_out = 'applicable' and not v_dry then
      begin
        perform public.decide_adherence_request(p_organization_id, jsonb_build_object(
          'request_id', v_id, 'decision', v_decision, 'note', v_note, 'new_reason_code', v_new_code));
        v_out := 'applied';
      exception when others then
        v_out := 'failed'; v_msg := sqlerrm;
      end;
    end if;

    v_counts := jsonb_set(v_counts, array[v_out], to_jsonb(coalesce((v_counts ->> v_out)::int, 0) + 1));
    v_items := v_items || jsonb_build_object('id', v_id, 'outcome', v_out, 'message', v_msg);
  end loop;

  return jsonb_build_object('preview', v_dry, 'decision', v_decision, 'total', cardinality(v_ids),
                            'counts', v_counts, 'items', v_items);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Histórico de importações (§67)
-- -----------------------------------------------------------------------------
create or replace function public.adherence_import_history(p_organization_id uuid, p_limit integer default 20)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not (private.has_permission(p_organization_id, 'adherence.import') or private.has_permission(p_organization_id, 'adherence.view_audit'))
      then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'file_name', b.file_name, 'status', b.status, 'total_rows', b.total_rows, 'valid_rows', b.valid_rows,
        'warning_rows', b.warning_rows, 'error_rows', b.error_rows, 'created_rows', b.created_rows,
        'skipped_rows', b.skipped_rows, 'summary', b.summary, 'error_message', b.error_message,
        'created_at', b.created_at, 'processed_at', b.processed_at,
        'created_by_name', (select p.full_name from public.profiles p where p.user_id = b.created_by),
        'errors', coalesce((select jsonb_agg(jsonb_build_object('row', e.row_number, 'message', e.message) order by e.row_number)
                             from (select * from public.import_errors x where x.batch_id = b.id order by x.row_number limit 50) e), '[]'::jsonb))
        order by b.created_at desc)
      from (select * from public.import_batches x where x.organization_id = p_organization_id and x.type = 'adherence'
             order by x.created_at desc limit greatest(p_limit, 1)) b), '[]'::jsonb)
  end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Exportação auditada
-- -----------------------------------------------------------------------------
create or replace function public.log_adherence_export(
  p_organization_id uuid, p_format text, p_row_count integer, p_kind text default 'matriz')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'adherence.export') then
    raise exception 'Você não possui permissão para exportar a aderência.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, (select auth.uid()), 'adherence_export', null, 'EXPORT',
          jsonb_build_object('format', p_format, 'row_count', p_row_count, 'kind', coalesce(p_kind, 'matriz')));
end;
$$;


-- -----------------------------------------------------------------------------
-- 10. Frota prevista: o planejamento oficial da Fidelização, planejado ou
--     confirmado (§71). Só o cancelado não conta. Antes, um vínculo criado
--     pela substituição de veículo nascia `planned` e o veículo novo ficava
--     sem obrigação até alguém confirmar — a substituição de hoje sumia da
--     Aderência de hoje.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_planned_fleet(
  p_organization_id uuid, p_date date, p_operation_id uuid default null, p_vehicle_id uuid default null)
returns table (
  vehicle_id uuid, operation_id uuid, operation_city_id uuid, state_id smallint, city_id integer,
  operation_br_id uuid, fidelization_assignment_id uuid, organization_unit_id uuid,
  vehicle_type_id uuid, vehicle_subcategory_id uuid, fleet_code text, license_plate text,
  vehicle_status text, source text, planning_conflict boolean, conflict_operation_id uuid)
language sql stable security definer set search_path = ''
as $$
  with fid as (
    select distinct on (fa.vehicle_id)
           fa.vehicle_id, fa.id as assignment_id, b.operation_id, b.operation_city_id, b.state_id, b.city_id, b.id as br_id
      from public.fidelization_assignments fa
      join public.operation_brs b on b.id = fa.operation_br_id and b.deleted_at is null
     where fa.organization_id = p_organization_id
       and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
       and fa.start_date <= p_date and (fa.end_date is null or fa.end_date >= p_date)
     order by fa.vehicle_id, fa.start_date desc, fa.created_at desc
  ),
  alloc as (
    select distinct on (a.vehicle_id)
           a.vehicle_id, a.operation_id, a.state_id, a.city_id,
           (select oc.id from public.operation_cities oc
             where oc.operation_id = a.operation_id and oc.city_id = a.city_id limit 1) as operation_city_id
      from public.vehicle_operation_assignments a
     where a.organization_id = p_organization_id
       and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
     order by a.vehicle_id, a.effective_from desc
  )
  select v.id,
         coalesce(f.operation_id, al.operation_id),
         coalesce(f.operation_city_id, al.operation_city_id),
         coalesce(f.state_id, al.state_id),
         coalesce(f.city_id, al.city_id),
         f.br_id, f.assignment_id,
         v.organization_unit_id, v.vehicle_type_id, v.vehicle_subcategory_id, v.fleet_code, v.license_plate,
         private.vehicle_status_at(v.id, p_date, private.adherence_tz(p_organization_id)),
         case when f.vehicle_id is not null then 'fidelization' else 'allocation' end,
         (f.vehicle_id is not null and al.vehicle_id is not null and f.operation_id <> al.operation_id),
         case when f.vehicle_id is not null and al.vehicle_id is not null and f.operation_id <> al.operation_id
              then al.operation_id end
    from public.vehicles v
    left join fid f on f.vehicle_id = v.id
    left join alloc al on al.vehicle_id = v.id
   where v.organization_id = p_organization_id and v.deleted_at is null
     and (f.vehicle_id is not null or al.vehicle_id is not null)
     and (p_vehicle_id is null or v.id = p_vehicle_id)
     and (p_operation_id is null or coalesce(f.operation_id, al.operation_id) = p_operation_id);
$$;

-- -----------------------------------------------------------------------------
-- 11. Geração: a obrigação em aberto acompanha o planejamento vigente (§17,
--     §20, §99); a cumprida ou decidida preserva o contexto em que aconteceu.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_generate(
  p_organization_id uuid, p_from date, p_to date,
  p_operation_id uuid default null, p_vehicle_id uuid default null, p_context text default null,
  p_allow_retire boolean default false, p_dry_run boolean default false,
  p_run_id uuid default null, p_retire_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected int := 0; v_create int := 0; v_reactivate int := 0; v_unchanged int := 0;
  v_retire int := 0; v_protected int := 0; v_conflicts int := 0; v_hints int := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido para geração de obrigações.' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 92 then
    raise exception 'Reprocesse no máximo 93 dias por vez.' using errcode = 'invalid_parameter_value';
  end if;
  if p_context is not null and p_context not in ('saida', 'retorno') then
    raise exception 'Contexto inválido: %', p_context using errcode = 'invalid_parameter_value';
  end if;

  drop table if exists pg_temp.adh_expected;
  create temp table adh_expected on commit drop as
    select * from private.adherence_expected(p_organization_id, p_from, p_to, p_operation_id, p_vehicle_id, p_context);

  select count(*) into v_expected from pg_temp.adh_expected;

  select count(*) filter (where o.id is null),
         count(*) filter (where o.id is not null and not o.is_active),
         count(*) filter (where o.id is not null and o.is_active)
    into v_create, v_reactivate, v_unchanged
    from pg_temp.adh_expected e
    left join public.checklist_obligations o
      on o.organization_id = p_organization_id and o.vehicle_id = e.vehicle_id
     and o.operational_date = e.operational_date and o.checklist_context = e.checklist_context
     and o.journey_seq = 1;

  select count(distinct (e.vehicle_id, e.operational_date)) into v_conflicts
    from pg_temp.adh_expected e where e.planning_conflict;

  select count(*) filter (where not c.protected), count(*) filter (where c.protected)
    into v_retire, v_protected
    from (
      select o.id,
             (exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
              or exists (select 1 from public.adherence_requests r where r.obligation_id = o.id and r.status in ('approved', 'pending'))
             ) as protected
        from public.checklist_obligations o
       where o.organization_id = p_organization_id and o.is_active
         and o.operational_date between p_from and p_to
         and (p_operation_id is null or o.operation_id = p_operation_id)
         and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
         and (p_context is null or o.checklist_context = p_context)
         and not exists (select 1 from pg_temp.adh_expected e
                          where e.vehicle_id = o.vehicle_id and e.operational_date = o.operational_date
                            and e.checklist_context = o.checklist_context)
    ) c;

  if p_dry_run then
    return jsonb_build_object(
      'preview', true, 'date_from', p_from, 'date_to', p_to,
      'expected', v_expected, 'create', v_create, 'reactivate', v_reactivate, 'unchanged', v_unchanged,
      'retire', case when p_allow_retire then v_retire else 0 end, 'retire_candidates', v_retire,
      'protected', v_protected, 'planning_conflicts', v_conflicts);
  end if;

  insert into public.checklist_obligations (
    organization_id, vehicle_id, operational_date, checklist_context, journey_seq,
    operation_id, operation_city_id, state_id, city_id, operation_br_id, organization_unit_id,
    vehicle_type_id, vehicle_subcategory_id, leader_employee_id, leadership_assignment_id,
    fleet_code_snapshot, license_plate_snapshot, vehicle_status_snapshot, expected_at, deadline_at,
    source, fidelization_assignment_id, eligibility_rule_id, eligibility_rule_version,
    detected_condition, generation_run_id)
  select p_organization_id, e.vehicle_id, e.operational_date, e.checklist_context, 1,
         e.operation_id, e.operation_city_id, e.state_id, e.city_id, e.operation_br_id, e.organization_unit_id,
         e.vehicle_type_id, e.vehicle_subcategory_id, e.leader_employee_id, e.leadership_assignment_id,
         e.fleet_code, e.license_plate, e.vehicle_status, e.expected_at, e.deadline_at,
         e.source, e.fidelization_assignment_id, e.eligibility_rule_id, e.eligibility_rule_version,
         e.detected_condition, p_run_id
    from pg_temp.adh_expected e
  on conflict (organization_id, vehicle_id, operational_date, checklist_context, journey_seq) do update
     set is_active = true, retired_at = null, retired_reason = null, updated_at = now(),
         generation_run_id = coalesce(p_run_id, public.checklist_obligations.generation_run_id)
   where not public.checklist_obligations.is_active;

  -- A condição detectada é dica para o expurgo, não história: acompanha o cadastro.
  update public.checklist_obligations o
     set detected_condition = e.detected_condition,
         vehicle_status_snapshot = e.vehicle_status,
         updated_at = now()
    from pg_temp.adh_expected e
   where o.organization_id = p_organization_id and o.is_active
     and o.vehicle_id = e.vehicle_id and o.operational_date = e.operational_date
     and o.checklist_context = e.checklist_context and o.journey_seq = 1
     and (o.detected_condition is distinct from e.detected_condition
          or o.vehicle_status_snapshot is distinct from e.vehicle_status);
  get diagnostics v_hints = row_count;

  -- Refinamento (§17, §20, §99): uma obrigação ainda não cumprida nem decidida
  -- acompanha o planejamento vigente — a substituição de veículo de hoje muda
  -- o BR/liderança da obrigação de hoje do veículo novo. A obrigação com
  -- execução ou decisão é protegida: o contexto em que foi cumprida não muda.
  update public.checklist_obligations o
     set operation_id = e.operation_id, operation_city_id = e.operation_city_id,
         state_id = e.state_id, city_id = e.city_id, operation_br_id = e.operation_br_id,
         organization_unit_id = e.organization_unit_id, vehicle_type_id = e.vehicle_type_id,
         vehicle_subcategory_id = e.vehicle_subcategory_id,
         leader_employee_id = e.leader_employee_id, leadership_assignment_id = e.leadership_assignment_id,
         fleet_code_snapshot = e.fleet_code, license_plate_snapshot = e.license_plate,
         expected_at = e.expected_at, deadline_at = e.deadline_at,
         source = e.source, fidelization_assignment_id = e.fidelization_assignment_id,
         eligibility_rule_id = e.eligibility_rule_id, eligibility_rule_version = e.eligibility_rule_version,
         updated_at = now()
    from pg_temp.adh_expected e
   where o.organization_id = p_organization_id and o.is_active
     and o.vehicle_id = e.vehicle_id and o.operational_date = e.operational_date
     and o.checklist_context = e.checklist_context and o.journey_seq = 1
     and (o.operation_id is distinct from e.operation_id
          or o.operation_br_id is distinct from e.operation_br_id
          or o.operation_city_id is distinct from e.operation_city_id
          or o.leader_employee_id is distinct from e.leader_employee_id
          or o.organization_unit_id is distinct from e.organization_unit_id
          or o.source is distinct from e.source
          or o.fidelization_assignment_id is distinct from e.fidelization_assignment_id)
     and not exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
     and not exists (select 1 from public.adherence_requests r where r.obligation_id = o.id and r.status in ('approved', 'pending'));

  if p_allow_retire then
    update public.checklist_obligations o
       set is_active = false, retired_at = now(),
           retired_reason = coalesce(p_retire_reason, 'planning_changed'), updated_at = now()
     where o.organization_id = p_organization_id and o.is_active
       and o.operational_date between p_from and p_to
       and (p_operation_id is null or o.operation_id = p_operation_id)
       and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
       and (p_context is null or o.checklist_context = p_context)
       and not exists (select 1 from pg_temp.adh_expected e
                        where e.vehicle_id = o.vehicle_id and e.operational_date = o.operational_date
                          and e.checklist_context = o.checklist_context)
       and not exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
       and not exists (select 1 from public.adherence_requests r where r.obligation_id = o.id and r.status in ('approved', 'pending'));
    get diagnostics v_retire = row_count;
  else
    v_retire := 0;
  end if;

  insert into public.adherence_inconsistencies (organization_id, kind, vehicle_id, operational_date, details)
  select distinct p_organization_id, 'planning_conflict', e.vehicle_id, e.operational_date,
         jsonb_build_object('fidelization_operation_id', e.operation_id, 'allocation_operation_id', e.conflict_operation_id)
    from pg_temp.adh_expected e
   where e.planning_conflict
     and not exists (select 1 from public.adherence_inconsistencies i
                      where i.organization_id = p_organization_id and i.kind = 'planning_conflict'
                        and i.vehicle_id = e.vehicle_id and i.operational_date = e.operational_date and i.status = 'open');

  return jsonb_build_object(
    'preview', false, 'date_from', p_from, 'date_to', p_to,
    'expected', v_expected, 'create', v_create, 'reactivate', v_reactivate, 'unchanged', v_unchanged,
    'retire', v_retire, 'protected', v_protected, 'hints_updated', v_hints, 'planning_conflicts', v_conflicts);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.decide_adherence_requests_bulk(uuid, jsonb) from public;
revoke all on function public.adherence_import_history(uuid, integer) from public;
revoke all on function public.log_adherence_export(uuid, text, integer, text) from public;
grant execute on function public.adherence_monthly(uuid, integer, text, jsonb) to authenticated;
grant execute on function public.adherence_day_detail(uuid, date, text, jsonb) to authenticated;
grant execute on function public.adherence_return_tracking(uuid, date, date, jsonb, integer) to authenticated;
grant execute on function public.adherence_insights(uuid, integer, integer, text, jsonb) to authenticated;
grant execute on function public.adherence_select_obligations(uuid, jsonb, text, jsonb, integer) to authenticated;
grant execute on function public.decide_adherence_requests_bulk(uuid, jsonb) to authenticated;
grant execute on function public.adherence_import_history(uuid, integer) to authenticated;
grant execute on function public.log_adherence_export(uuid, text, integer, text) to authenticated;
