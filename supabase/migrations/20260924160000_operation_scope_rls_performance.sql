-- =============================================================================
-- Desempenho da RLS por operação e do relógio da Aderência
--
-- Sintoma em produção (24/09/2026): Aderência e Fidelização abriam com "This
-- page couldn't load". Os logs do banco mostram `canceling statement due to
-- statement timeout` nas RPCs da Aderência (summary, heatmap, matrix,
-- monthly, insights, return_tracking) — cada uma ~2–13 s sozinha; em paralelo,
-- como a página as chama, todas passavam dos 8 s de `authenticated`.
--
-- Causa medida (EXPLAIN ANALYZE como a pessoa real, 2.460 obrigações):
--   * 1,63 s de 2,05 s no filtro da RLS `private.can_access_operation(operation_id)`,
--     uma função `security definer` chamada UMA VEZ POR LINHA, e cada chamada
--     refaz `private.accessible_operation_ids()` (~0,66 ms);
--   * ~0,3 s em `private.adherence_today(o.organization_id)`, também por linha,
--     dentro da view `adherence_obligation_status`.
--
-- Correção — o mesmo resultado, calculado uma vez por consulta:
--  1. As quatro políticas que usavam `private.can_access_operation(operation_id)`
--     passam a dizer `operation_id is not null and operation_id in (select
--     private.accessible_operation_ids())`. É a definição literal da função
--     (`p_operation_id is not null and p_operation_id in (select
--     private.accessible_operation_ids())`), escrita onde o planejador consegue
--     avaliar o conjunto uma vez só (subplano com hash), como já faz com
--     `permitted_org_ids`. Quem vê o quê não muda — a suíte 17 compara, linha
--     a linha, o conjunto antigo com o novo para perfis diferentes.
--  2. A view `adherence_obligation_status` passa a obter "hoje" e "agora" de
--     `private.adherence_org_clock()` — uma linha por organização, calculada
--     uma vez — em vez de chamar `adherence_today` para cada obrigação. As
--     colunas, a ordem e as fórmulas são as mesmas.
--
-- Medido (sequencial, pessoa real, setembro/2026): summary 4.582→136 ms,
-- heatmap 2.116→56, matrix 2.249→124, monthly 2.212→56, insights 12.893→344,
-- return_tracking 4.388→257, journey 204→66.
--
-- Nada é apagado; nenhuma tabela criada; nenhuma permissão concedida.
-- `private.can_access_operation` continua existindo para quem a chama fora da RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS por operação, avaliada uma vez por consulta
-- -----------------------------------------------------------------------------
alter policy checklist_obligations_select on public.checklist_obligations
  using (
    organization_id in (select private.permitted_org_ids('adherence.view'))
    and operation_id is not null
    and operation_id in (select private.accessible_operation_ids())
  );

alter policy leadership_assignments_select on public.leadership_assignments
  using (
    organization_id in (select private.permitted_org_ids('leadership.view'))
    and operation_id is not null
    and operation_id in (select private.accessible_operation_ids())
  );

alter policy operation_brs_select on public.operation_brs
  using (
    (organization_id in (select private.permitted_org_ids('fidelization.view'))
     or organization_id in (select private.permitted_org_ids('leadership.view')))
    and operation_id is not null
    and operation_id in (select private.accessible_operation_ids())
  );

alter policy checklist_executions_select on public.checklist_executions
  using (
    -- O próprio: comparado pelo colaborador da SESSÃO, nunca por um id vindo
    -- do cliente (§31).
    (organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_own'))
     and employee_id in (
       select m.employee_id from public.organization_memberships m
        where m.user_id = auth.uid() and m.organization_id = checklist_executions.organization_id
          and m.status = 'active'))
    or
    (organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_details'))
     and operation_id is not null
     and operation_id in (select private.accessible_operation_ids()))
  );

-- -----------------------------------------------------------------------------
-- 2. "Hoje" da Aderência, uma vez por organização
-- -----------------------------------------------------------------------------
create or replace function private.adherence_org_clock()
returns table (organization_id uuid, today date, ts timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select org.id, private.adherence_today(org.id), now()
    from public.organizations org;
$$;

comment on function private.adherence_org_clock() is
  'Data de hoje (fuso da Aderência) e o instante atual por organização; usada pela view adherence_obligation_status para não recalcular por linha.';

revoke execute on function private.adherence_org_clock() from public, anon;
grant execute on function private.adherence_org_clock() to authenticated, service_role;

-- Mesmas colunas, mesma ordem, mesmas fórmulas; só a origem de `t` mudou.
create or replace view public.adherence_obligation_status
with (security_invoker = true) as
select
  o.id, o.organization_id, o.vehicle_id, o.operational_date, o.checklist_context, o.journey_seq,
  o.operation_id, o.operation_city_id, o.state_id, o.city_id, o.operation_br_id, o.organization_unit_id,
  o.vehicle_type_id, o.vehicle_subcategory_id, o.leader_employee_id, o.leadership_assignment_id,
  o.fleet_code_snapshot, o.license_plate_snapshot, o.vehicle_status_snapshot,
  o.expected_at, o.deadline_at, o.source, o.fidelization_assignment_id,
  o.eligibility_rule_id, o.eligibility_rule_version, o.detected_condition, o.generation_run_id,
  o.created_at, o.updated_at,
  m.execution_id, m.id as match_id,
  ap.id as approved_request_id, ap.reason_id as approved_reason_id, ap.decision_effect, ap.status_code_applied,
  pr.id as pending_request_id,
  t.today,
  d.is_done,
  (coalesce(ap.decision_effect = 'exclude', false) and not d.is_done) as is_excluded,
  s.status_code,
  case
    when coalesce(ap.decision_effect = 'exclude', false) and not d.is_done then false
    when d.is_done then true
    when o.operational_date <= t.today and (o.checklist_context = 'saida' or t.ts >= o.deadline_at) then true
    else false
  end as is_due,
  (s.status_code = 'NAO_FEZ_CHECKLIST' and o.operational_date = t.today) as is_provisional,
  (pr.id is not null) as has_pending_request
from public.checklist_obligations o
left join public.checklist_obligation_matches m on m.obligation_id = o.id and m.is_valid
left join lateral (
  select r.id, r.reason_id, r.decision_effect, r.status_code_applied
    from public.adherence_requests r
   where r.obligation_id = o.id and r.status = 'approved'
   order by r.decided_at desc limit 1) ap on true
left join lateral (
  select r.id from public.adherence_requests r
   where r.obligation_id = o.id and r.status = 'pending' limit 1) pr on true
join private.adherence_org_clock() t on t.organization_id = o.organization_id
cross join lateral (select (m.execution_id is not null or coalesce(ap.decision_effect = 'count_done', false)) as is_done) d
cross join lateral (select private.adherence_status_code(
  d.is_done, ap.decision_effect, ap.status_code_applied, o.checklist_context,
  o.operational_date, t.today, o.deadline_at, t.ts) as status_code) s
where o.is_active;

grant select on public.adherence_obligation_status to authenticated;
