-- =============================================================================
-- Gestão de Checklist › Planos de Ação — leituras (portal, visão geral,
-- detalhe, conciliação, qualidade, saúde, mapeamento, minha visão, histórico)
--
-- Tudo no servidor: filtro, ordenação, paginação e agregação. Nenhuma tela
-- carrega milhares de planos para calcular indicador no navegador. O escopo é
-- o do contexto gravado no plano (operação do 1º apontamento), o mesmo da RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O filtro único
-- -----------------------------------------------------------------------------
-- p_filters: search, date_from, date_to (período das ocorrências), statuses[],
--   status_group (open|closed), priorities[], operation_ids[], state_ids[],
--   city_ids[], unit_ids[], br_ids[], leader_ids[], vehicle_ids[],
--   vehicle_type_ids[], cluster_keys[], question_keys[], action_keys[],
--   responsible_ids[], unassigned, with_maintenance (true|false), deadline
--   (overdue|today|soon|upcoming = hoje ou em breve|on_time|no_due|treated_on_time|treated_late),
--   recurrence, fleet_status (active|inactive|all), mine, plan_ids[]
create or replace function private.action_plan_filtered(p_organization_id uuid, p_filters jsonb)
returns setof public.action_plans
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'search'), '')                  as search,
           nullif(p_filters ->> 'date_from', '')::date                as date_from,
           nullif(p_filters ->> 'date_to', '')::date                  as date_to,
           private.jsonb_text_array(p_filters -> 'statuses')          as statuses,
           nullif(p_filters ->> 'status_group', '')                   as status_group,
           private.jsonb_text_array(p_filters -> 'priorities')        as priorities,
           private.jsonb_uuid_array(p_filters -> 'operation_ids')     as operation_ids,
           private.jsonb_int_array(p_filters -> 'state_ids')          as state_ids,
           private.jsonb_int_array(p_filters -> 'city_ids')           as city_ids,
           private.jsonb_uuid_array(p_filters -> 'unit_ids')          as unit_ids,
           private.jsonb_uuid_array(p_filters -> 'br_ids')            as br_ids,
           private.jsonb_uuid_array(p_filters -> 'leader_ids')        as leader_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_ids')       as vehicle_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids')  as vehicle_type_ids,
           private.jsonb_text_array(p_filters -> 'cluster_keys')      as cluster_keys,
           private.jsonb_text_array(p_filters -> 'question_keys')     as question_keys,
           private.jsonb_text_array(p_filters -> 'action_keys')       as action_keys,
           private.jsonb_uuid_array(p_filters -> 'responsible_ids')   as responsible_ids,
           coalesce((p_filters ->> 'unassigned')::boolean, false)     as unassigned,
           (p_filters ->> 'with_maintenance')::boolean                as with_maintenance,
           nullif(p_filters ->> 'deadline', '')                       as deadline,
           coalesce((p_filters ->> 'recurrence')::boolean, false)     as recurrence,
           coalesce(nullif(p_filters ->> 'fleet_status', ''), 'all')  as fleet_status,
           coalesce((p_filters ->> 'mine')::boolean, false)           as mine,
           private.jsonb_uuid_array(p_filters -> 'plan_ids')          as plan_ids,
           private.maintenance_today(p_organization_id)               as today,
           coalesce((select s.due_soon_days from public.action_plan_settings s
                      where s.organization_id = p_organization_id), 3) as soon
  )
  select p.*
    from public.action_plans p
    cross join f
   where p.organization_id = p_organization_id
     and (p.operation_id in (select private.accessible_operation_ids())
          or (p.operation_id is null and private.vehicle_in_scope(p.organization_id, p.vehicle_id)))
     and (f.search is null
          or p.code ilike '%' || f.search || '%'
          or coalesce(p.license_plate_snapshot, '') ilike '%' || private.normalize_plate(f.search) || '%'
          or coalesce(p.fleet_code_snapshot, '') ilike '%' || f.search || '%'
          or p.title ilike '%' || f.search || '%'
          or coalesce(p.detail_label, '') ilike '%' || f.search || '%')
     and (f.date_from is null or p.last_operational_date >= f.date_from)
     and (f.date_to is null or p.first_operational_date <= f.date_to)
     and (f.statuses is null or p.status = any (f.statuses))
     and (f.status_group is null
          or (f.status_group = 'open' and not private.action_plan_terminal(p.status))
          or (f.status_group = 'closed' and private.action_plan_terminal(p.status)))
     and (f.priorities is null or p.priority = any (f.priorities))
     and (f.operation_ids is null or p.operation_id = any (f.operation_ids))
     and (f.state_ids is null or p.state_id = any (f.state_ids))
     and (f.city_ids is null or p.city_id = any (f.city_ids))
     and (f.unit_ids is null or p.organization_unit_id = any (f.unit_ids))
     and (f.br_ids is null or p.operation_br_id = any (f.br_ids))
     and (f.leader_ids is null or p.leader_employee_id = any (f.leader_ids))
     and (f.vehicle_ids is null or p.vehicle_id = any (f.vehicle_ids))
     and (f.vehicle_type_ids is null or p.vehicle_type_id = any (f.vehicle_type_ids))
     and (f.cluster_keys is null or p.cluster_key = any (f.cluster_keys))
     and (f.question_keys is null or p.question_key = any (f.question_keys))
     and (f.action_keys is null or p.action_key = any (f.action_keys) or p.plan_key = any (f.action_keys))
     and (f.plan_ids is null or p.id = any (f.plan_ids))
     and ((f.responsible_ids is null and not f.unassigned)
          or p.responsible_user_id = any (coalesce(f.responsible_ids, '{}'))
          or (f.unassigned and p.responsible_user_id is null))
     and (not f.mine or p.responsible_user_id = auth.uid())
     and (f.with_maintenance is null
          or f.with_maintenance = exists (select 1 from public.action_plan_maintenance_links l
                                           where l.plan_id = p.id and l.status = 'active' and l.resolutive))
     and (not f.recurrence or p.is_recurrence)
     and (f.deadline is null or f.deadline = case
            when private.action_plan_terminal(p.status) then
              case when p.status = 'cancelled' then 'cancelled'
                   when p.due_on is null then 'no_due'
                   when (p.closed_at at time zone 'America/Sao_Paulo')::date <= p.due_on then 'treated_on_time'
                   else 'treated_late' end
            when p.due_on is null then 'no_due'
            when p.due_on < f.today then 'overdue'
            when p.due_on = f.today then 'today'
            when p.due_on <= f.today + f.soon then 'soon'
            else 'on_time' end
          or (f.deadline = 'upcoming' and not private.action_plan_terminal(p.status)
              and p.due_on between f.today and f.today + f.soon))
     and (f.fleet_status = 'all'
          or (f.fleet_status = 'active') = private.maintenance_vehicle_active(p.vehicle_id));
$$;

-- Prazo de um plano, em uma palavra (as mesmas faixas do filtro).
create or replace function private.action_plan_deadline(p public.action_plans, p_today date, p_soon integer)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when private.action_plan_terminal(p.status) then
             case when p.status = 'cancelled' then 'cancelled'
                  when p.due_on is null then 'no_due'
                  when (p.closed_at at time zone 'America/Sao_Paulo')::date <= p.due_on then 'treated_on_time'
                  else 'treated_late' end
           when p.due_on is null then 'no_due'
           when p.due_on < p_today then 'overdue'
           when p.due_on = p_today then 'today'
           when p.due_on <= p_today + p_soon then 'soon'
           else 'on_time'
         end;
$$;

-- Uma linha pronta para a tela.
create or replace function private.action_plan_row_json(p public.action_plans, p_today date, p_soon integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'vehicle_id', p.vehicle_id,
    'license_plate', p.license_plate_snapshot, 'fleet_code', p.fleet_code_snapshot,
    'title', p.title, 'detail_label', p.detail_label,
    'plan_key', p.plan_key, 'action_key', p.action_key, 'question_key', p.question_key,
    'cluster_key', p.cluster_key, 'cluster_name', p.cluster_name, 'criticality', p.criticality,
    'status', p.status, 'analysis_state', p.analysis_state,
    'priority', p.priority, 'priority_source', p.priority_source,
    'due_on', p.due_on, 'due_source', p.due_source,
    'deadline', private.action_plan_deadline(p, p_today, p_soon),
    'days_overdue', case when not private.action_plan_terminal(p.status) and p.due_on < p_today then p_today - p.due_on end,
    'age_days', case when not private.action_plan_terminal(p.status) then p_today - p.first_operational_date end,
    'responsible_user_id', p.responsible_user_id,
    'responsible_name', private.org_member_name(p.organization_id, p.responsible_user_id),
    'first_occurrence_at', p.first_occurrence_at, 'last_occurrence_at', p.last_occurrence_at,
    'first_operational_date', p.first_operational_date, 'last_operational_date', p.last_operational_date,
    'occurrences', p.occurrences, 'open_items', p.open_items, 'resolved_items', p.resolved_items)
  || jsonb_build_object(
    'operation_id', p.operation_id, 'operation_name', (select o.name from public.operations o where o.id = p.operation_id),
    'state_id', p.state_id, 'state_uf', (select s.uf from public.states s where s.id = p.state_id),
    'city_id', p.city_id, 'city_name', (select c.name from public.cities c where c.id = p.city_id),
    'br_id', p.operation_br_id, 'br_code', (select b.code from public.operation_brs b where b.id = p.operation_br_id),
    'unit_id', p.organization_unit_id, 'unit_name', (select u.name from public.organization_units u where u.id = p.organization_unit_id),
    'leader_id', p.leader_employee_id, 'leader_name', (select e.full_name from public.employees e where e.id = p.leader_employee_id),
    'vehicle_type_id', p.vehicle_type_id, 'vehicle_type_name', (select t.name from public.vehicle_types t where t.id = p.vehicle_type_id),
    'maintenances', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status,
                                                                  'origin', l.origin, 'resolutive', l.resolutive)
                                               order by m.created_at), '[]'::jsonb)
                       from public.action_plan_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                      where l.plan_id = p.id and l.status = 'active'),
    'is_recurrence', p.is_recurrence, 'cycle_number', p.cycle_number, 'previous_plan_id', p.previous_plan_id,
    'reopened_count', p.reopened_count,
    'last_treatment', p.last_treatment, 'last_treatment_at', p.last_treatment_at,
    'closed_at', p.closed_at, 'auto_closed', p.auto_closed,
    'requires_maintenance', p.requires_maintenance,
    'tmr_days', case when p.status in ('resolved', 'resolved_without_maintenance', 'improper')
                     then round((extract(epoch from (p.closed_at - p.first_occurrence_at)) / 86400.0)::numeric, 1) end);
$$;

create or replace function private.action_plan_assert_view(p_organization_id uuid, p_permission text default 'action_plans.view')
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Portal — lista paginada no servidor
-- -----------------------------------------------------------------------------
-- p_sort: priority | due | first | last | occurrences | open_items | code | plate | status | age
create or replace function public.action_plan_list(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb,
  p_sort            text default 'priority',
  p_dir             text default 'desc',
  p_limit           integer default 50,
  p_offset          integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_soon   integer := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = p_organization_id), 3);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort   text := coalesce(p_sort, 'priority');
  v_desc   boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  v_total  bigint;
  v_rows   jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id);
  select count(*) into v_total from private.action_plan_filtered(p_organization_id, p_filters);

  select coalesce(jsonb_agg(private.action_plan_row_json(x.p, v_today, v_soon) order by x.rn), '[]'::jsonb)
    into v_rows
    from (
      select t as p, row_number() over (order by
               case when v_sort = 'priority' then
                 case t.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end end
                 * case when v_desc then -1 else 1 end asc nulls last,
               case when v_sort in ('priority', 'due') and not v_desc then t.due_on end asc nulls last,
               case when v_sort in ('priority', 'due') and v_desc then t.due_on end asc nulls last,
               case when not v_desc then case v_sort when 'first' then t.first_occurrence_at when 'last' then t.last_occurrence_at end end asc nulls last,
               case when v_desc then case v_sort when 'first' then t.first_occurrence_at when 'last' then t.last_occurrence_at end end desc nulls last,
               case when not v_desc then case v_sort when 'occurrences' then t.occurrences when 'open_items' then t.open_items
                                                     when 'age' then v_today - t.first_operational_date end end asc nulls last,
               case when v_desc then case v_sort when 'occurrences' then t.occurrences when 'open_items' then t.open_items
                                                 when 'age' then v_today - t.first_operational_date end end desc nulls last,
               case when not v_desc then case v_sort when 'code' then t.code when 'plate' then t.license_plate_snapshot
                                                     when 'status' then t.status end end asc nulls last,
               case when v_desc then case v_sort when 'code' then t.code when 'plate' then t.license_plate_snapshot
                                                 when 'status' then t.status end end desc nulls last,
               t.last_occurrence_at desc, t.id) as rn
        from private.action_plan_filtered(p_organization_id, p_filters) t
    ) x
   where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'limit', v_limit, 'offset', v_offset, 'today', v_today);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Portal — agrupamentos (Operação, Cluster, Veículo, Prioridade, Responsável)
-- -----------------------------------------------------------------------------
-- Uma linha por folha do agrupamento, com as chaves de cada nível e os totais;
-- a tela monta a árvore e abre a lista (paginada) do nó escolhido com o filtro
-- correspondente. Operação: operação → estado → cidade → BR → veículo.
-- Cluster: cluster → item (chave de ação) → operação → veículo.
create or replace function public.action_plan_groups(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_grouping text default 'operation')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  v_soon  integer := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = p_organization_id), 3);
  v_rows  jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id);
  if p_grouping not in ('operation', 'cluster', 'vehicle', 'priority', 'responsible') then
    raise exception 'Agrupamento inválido.' using errcode = 'invalid_parameter_value';
  end if;

  with p as (select * from private.action_plan_filtered(p_organization_id, p_filters)),
  leaf as (
    select case p_grouping
             when 'operation' then jsonb_build_array(
               jsonb_build_object('key', p.operation_id, 'label', coalesce((select o.name from public.operations o where o.id = p.operation_id), 'Sem operação')),
               jsonb_build_object('key', p.state_id, 'label', coalesce((select s.uf from public.states s where s.id = p.state_id), '—')),
               jsonb_build_object('key', p.city_id, 'label', coalesce((select c.name from public.cities c where c.id = p.city_id), 'Sem cidade')),
               jsonb_build_object('key', p.operation_br_id, 'label', coalesce((select b.code from public.operation_brs b where b.id = p.operation_br_id), 'Sem BR')),
               jsonb_build_object('key', p.vehicle_id, 'label', coalesce(p.license_plate_snapshot, '—'), 'sub', p.fleet_code_snapshot))
             when 'cluster' then jsonb_build_array(
               jsonb_build_object('key', p.cluster_key, 'label', coalesce(p.cluster_name, p.cluster_key, 'Sem cluster')),
               jsonb_build_object('key', p.plan_key, 'label', p.title || coalesce(' — ' || p.detail_label, '')),
               jsonb_build_object('key', p.operation_id, 'label', coalesce((select o.name from public.operations o where o.id = p.operation_id), 'Sem operação')),
               jsonb_build_object('key', p.vehicle_id, 'label', coalesce(p.license_plate_snapshot, '—'), 'sub', p.fleet_code_snapshot))
             when 'vehicle' then jsonb_build_array(
               jsonb_build_object('key', p.vehicle_id, 'label', coalesce(p.license_plate_snapshot, '—'), 'sub', p.fleet_code_snapshot))
             when 'priority' then jsonb_build_array(jsonb_build_object('key', p.priority, 'label', p.priority))
             else jsonb_build_array(jsonb_build_object('key', p.responsible_user_id,
                    'label', coalesce(private.org_member_name(p.organization_id, p.responsible_user_id), 'Sem responsável')))
           end as path,
           p.status, p.priority, p.open_items, p.occurrences, private.action_plan_deadline(p, v_today, v_soon) as deadline,
           p.is_recurrence
      from p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', l.path,
           'plans', l.plans, 'open', l.open, 'closed', l.closed, 'overdue', l.overdue, 'on_time', l.on_time,
           'critical', l.critical, 'open_items', l.open_items, 'occurrences', l.occurrences, 'recurrences', l.recurrences)
         order by l.overdue desc, l.open desc), '[]'::jsonb)
    into v_rows
    from (
      select path,
             count(*) as plans,
             count(*) filter (where not private.action_plan_terminal(status)) as open,
             count(*) filter (where private.action_plan_terminal(status)) as closed,
             count(*) filter (where deadline = 'overdue') as overdue,
             count(*) filter (where deadline in ('on_time', 'soon', 'today')) as on_time,
             count(*) filter (where priority = 'critical' and not private.action_plan_terminal(status)) as critical,
             sum(open_items) as open_items, sum(occurrences) as occurrences,
             count(*) filter (where is_recurrence) as recurrences
        from leaf group by path
    ) l;
  return jsonb_build_object('grouping', p_grouping, 'rows', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Visão geral (dashboard) — agregações no servidor
-- -----------------------------------------------------------------------------
-- Definições (docs/modules/checklist-maintenance-action-plans.md):
--   * Inconformidades recebidas: respostas inconformes dos checklists do
--     período (todas: manutenção, avaria e não elegíveis).
--   * Apontamentos: inconformidades de MANUTENÇÃO (uma por resposta/opção).
--   * Tratados: apontamentos resolvidos, resolvidos sem manutenção ou
--     improcedentes. Pendentes: pendente, em manutenção, pendente de nova
--     tratativa. Cancelados ficam fora das taxas.
--   * Aderência de Tratativa = tratados ÷ (apontamentos − cancelados) × 100.
--     Não confundir com a Aderência de Checklist (o checklist foi feito?).
--   * TMR = 1º apontamento → encerramento, dos planos resolvidos (média,
--     mediana e P90, em dias).
--   * % tratado no prazo = encerrados até o prazo ÷ encerrados com prazo.
create or replace function public.action_plan_dashboard(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today    date := private.maintenance_today(p_organization_id);
  v_soon     integer := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = p_organization_id), 3);
  v_from     date := nullif(p_filters ->> 'date_from', '')::date;
  v_to       date := nullif(p_filters ->> 'date_to', '')::date;
  v_bucket   text;
  v_result   jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id, 'action_plans.view_dashboard');
  v_to := coalesce(v_to, v_today);
  v_from := coalesce(v_from, v_to - 89);
  v_bucket := case when v_to - v_from <= 45 then 'day' when v_to - v_from <= 200 then 'week' else 'month' end;

  with
  pl as materialized (
    select t.*, private.action_plan_deadline(t, v_today, v_soon) as dl,
           exists (select 1 from public.action_plan_maintenance_links l
                    where l.plan_id = t.id and l.status = 'active' and l.resolutive) as with_m
      from private.action_plan_filtered(p_organization_id,
             p_filters || jsonb_build_object('date_from', v_from, 'date_to', v_to)) t),
  it as materialized (
    select i.* from public.action_plan_items i join pl p on p.id = i.plan_id
     where i.operational_date between v_from and v_to),
  received as (
    -- toda resposta inconforme do período no escopo (inclusive avaria e não elegíveis)
    select count(*) filter (where true) as total,
           count(*) filter (where private.action_plan_answer_route(a.id) = 'damage') as damage,
           count(*) filter (where private.action_plan_answer_route(a.id) = 'not_eligible') as not_eligible
      from public.checklist_execution_answers a
      join public.checklist_executions e on e.id = a.execution_id
     where e.organization_id = p_organization_id and e.status = 'submitted' and not a.is_conforming
       and e.operational_date between v_from and v_to
       and e.operation_id in (select private.accessible_operation_ids())
       and (private.jsonb_uuid_array(p_filters -> 'operation_ids') is null
            or e.operation_id = any (private.jsonb_uuid_array(p_filters -> 'operation_ids')))
       and (private.jsonb_uuid_array(p_filters -> 'br_ids') is null
            or e.operation_br_id = any (private.jsonb_uuid_array(p_filters -> 'br_ids')))
       and (private.jsonb_uuid_array(p_filters -> 'vehicle_ids') is null
            or e.vehicle_id = any (private.jsonb_uuid_array(p_filters -> 'vehicle_ids')))
       and (private.jsonb_int_array(p_filters -> 'city_ids') is null
            or e.city_id = any (private.jsonb_int_array(p_filters -> 'city_ids')))
       and (private.jsonb_uuid_array(p_filters -> 'leader_ids') is null
            or e.leader_employee_id = any (private.jsonb_uuid_array(p_filters -> 'leader_ids')))
  ),
  tmr as (
    select extract(epoch from (closed_at - first_occurrence_at)) / 86400.0 as d, priority, cluster_key, cluster_name, operation_id
      from pl where status in ('resolved', 'resolved_without_maintenance', 'improper') and closed_at is not null
  ),
  kpi as (
    select
      (select count(*) from it) as items,
      (select count(*) from it where status in ('pending', 'in_maintenance', 'needs_action')) as items_open,
      (select count(*) from it where status in ('resolved', 'resolved_without_maintenance', 'improper')) as items_treated,
      (select count(*) from it where status = 'resolved_without_maintenance') as items_rwm,
      (select count(*) from it where status = 'improper') as items_improper,
      (select count(*) from it where status = 'cancelled') as items_cancelled,
      (select count(*) from it where status = 'in_maintenance') as items_in_maintenance,
      (select count(*) from pl where not private.action_plan_terminal(status)) as plans_active,
      (select count(*) from pl where dl = 'overdue') as plans_overdue,
      (select count(*) from pl where not private.action_plan_terminal(status) and priority = 'critical') as plans_critical,
      (select count(*) from pl where not private.action_plan_terminal(status) and with_m) as plans_with_maintenance,
      (select count(*) from pl where not private.action_plan_terminal(status) and not with_m) as plans_without_maintenance,
      (select count(*) from pl where status = 'resolved_without_maintenance') as plans_rwm,
      (select count(*) from pl where status = 'improper') as plans_improper,
      (select count(*) from pl where status = 'resolved') as plans_resolved,
      (select count(*) from pl) as plans_total,
      (select count(distinct vehicle_id) from pl where not private.action_plan_terminal(status)) as vehicles_pending,
      (select count(*) from pl where dl = 'treated_on_time') as treated_on_time,
      (select count(*) from pl where dl = 'treated_late') as treated_late,
      (select round(avg(d)::numeric, 1) from tmr) as tmr_avg,
      (select round((percentile_cont(0.5) within group (order by d))::numeric, 1) from tmr) as tmr_median,
      (select round((percentile_cont(0.9) within group (order by d))::numeric, 1) from tmr) as tmr_p90,
      (select count(*) from pl where is_recurrence) as recurrences
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'bucket', v_bucket, 'today', v_today),
    'kpis', jsonb_build_object(
      'findings_received', (select total from received),
      'findings_damage', (select damage from received),
      'findings_not_eligible', (select not_eligible from received),
      'items', k.items, 'items_open', k.items_open, 'items_treated', k.items_treated,
      'items_rwm', k.items_rwm, 'items_improper', k.items_improper, 'items_cancelled', k.items_cancelled,
      'items_in_maintenance', k.items_in_maintenance,
      'plans_total', k.plans_total, 'plans_active', k.plans_active, 'plans_overdue', k.plans_overdue,
      'plans_critical', k.plans_critical, 'plans_with_maintenance', k.plans_with_maintenance,
      'plans_without_maintenance', k.plans_without_maintenance, 'plans_rwm', k.plans_rwm,
      'plans_improper', k.plans_improper, 'plans_resolved', k.plans_resolved,
      'vehicles_pending', k.vehicles_pending, 'recurrences', k.recurrences,
      'treatment_adherence', case when k.items - k.items_cancelled > 0
                                  then round(100.0 * k.items_treated / (k.items - k.items_cancelled), 1) end,
      'tmr_avg_days', k.tmr_avg, 'tmr_median_days', k.tmr_median, 'tmr_p90_days', k.tmr_p90,
      'on_time_pct', case when k.treated_on_time + k.treated_late > 0
                          then round(100.0 * k.treated_on_time / (k.treated_on_time + k.treated_late), 1) end),
    -- Funil, em apontamentos
    'funnel', jsonb_build_array(
      jsonb_build_object('key', 'received', 'value', (select total from received)),
      jsonb_build_object('key', 'classified', 'value', k.items),
      jsonb_build_object('key', 'in_plan', 'value', (select count(*) from it where plan_id is not null and status <> 'cancelled')),
      jsonb_build_object('key', 'treatment_defined', 'value',
        (select count(*) from it i join pl p on p.id = i.plan_id
          where i.status <> 'cancelled' and (i.status <> 'pending' or p.analysis_state = 'awaiting_maintenance'))),
      jsonb_build_object('key', 'maintenance_or_other', 'value',
        (select count(*) from it where status in ('in_maintenance', 'needs_action', 'resolved', 'resolved_without_maintenance', 'improper'))),
      jsonb_build_object('key', 'resolved', 'value', k.items_treated)),
    'deadline', (select jsonb_object_agg(dl, n) from (select dl, count(*) as n from pl group by dl) d),
    'aging', (select jsonb_build_array(
                jsonb_build_object('key', '0-7',   'value', count(*) filter (where v_today - first_operational_date <= 7)),
                jsonb_build_object('key', '8-30',  'value', count(*) filter (where v_today - first_operational_date between 8 and 30)),
                jsonb_build_object('key', '31-60', 'value', count(*) filter (where v_today - first_operational_date between 31 and 60)),
                jsonb_build_object('key', '61-90', 'value', count(*) filter (where v_today - first_operational_date between 61 and 90)),
                jsonb_build_object('key', '90+',   'value', count(*) filter (where v_today - first_operational_date > 90)))
                from pl where not private.action_plan_terminal(status)),
    'by_priority', (select coalesce(jsonb_agg(jsonb_build_object('key', priority, 'open', o, 'total', t)), '[]')
                      from (select priority, count(*) filter (where not private.action_plan_terminal(status)) o, count(*) t
                              from pl group by priority) x),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('key', status, 'value', n)), '[]')
                    from (select status, count(*) n from pl group by status) x),
    'by_operation', (select coalesce(jsonb_agg(jsonb_build_object('key', operation_id, 'label', label, 'open', o, 'overdue', ov, 'total', t)
                                               order by o desc, t desc), '[]')
                       from (select operation_id, coalesce((select op.name from public.operations op where op.id = pl.operation_id), 'Sem operação') label,
                                    count(*) filter (where not private.action_plan_terminal(status)) o,
                                    count(*) filter (where dl = 'overdue') ov, count(*) t
                               from pl group by operation_id) x),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('key', city_id, 'label', label, 'open', o, 'total', t)
                                          order by o desc, t desc), '[]')
                  from (select city_id, coalesce((select c.name || ' / ' || s.uf from public.cities c join public.states s on s.id = c.state_id
                                                    where c.id = pl.city_id), 'Sem cidade') label,
                               count(*) filter (where not private.action_plan_terminal(status)) o, count(*) t
                          from pl group by city_id order by 3 desc, 4 desc limit 15) x),
    'by_leader', (select coalesce(jsonb_agg(jsonb_build_object('key', leader_employee_id, 'label', label, 'open', o, 'total', t)
                                            order by o desc, t desc), '[]')
                    from (select leader_employee_id, coalesce((select e.full_name from public.employees e where e.id = pl.leader_employee_id), 'Sem liderança') label,
                                 count(*) filter (where not private.action_plan_terminal(status)) o, count(*) t
                            from pl group by leader_employee_id order by 3 desc, 4 desc limit 15) x),
    'by_cluster', (select coalesce(jsonb_agg(jsonb_build_object('key', cluster_key, 'label', label, 'open', o, 'total', t, 'items', n)
                                             order by o desc, t desc), '[]')
                     from (select cluster_key, coalesce(max(cluster_name), cluster_key, 'Sem cluster') label,
                                  count(*) filter (where not private.action_plan_terminal(status)) o, count(*) t,
                                  sum(occurrences) n
                             from pl group by cluster_key) x),
    'top_items', (select coalesce(jsonb_agg(jsonb_build_object('key', action_key, 'label', label, 'items', n, 'plans', pc, 'open', o)
                                            order by n desc), '[]')
                    from (select p.action_key, max(p.title) label, count(i.id) n, count(distinct p.id) pc,
                                 count(distinct p.id) filter (where not private.action_plan_terminal(p.status)) o
                            from pl p join it i on i.plan_id = p.id group by p.action_key order by 3 desc limit 10) x),
    'top_recurrent_vehicles', (select coalesce(jsonb_agg(jsonb_build_object('key', vehicle_id, 'label', plate, 'sub', fleet,
                                                                             'recurrences', r, 'occurrences', n, 'open', o)
                                                         order by r desc, n desc), '[]')
                                 from (select vehicle_id, max(license_plate_snapshot) plate, max(fleet_code_snapshot) fleet,
                                              count(*) filter (where is_recurrence) r, sum(occurrences) n,
                                              count(*) filter (where not private.action_plan_terminal(status)) o
                                         from pl group by vehicle_id
                                         having count(*) filter (where is_recurrence) > 0 or sum(occurrences) > 2
                                         order by 4 desc, 5 desc limit 10) x),
    'resolution_origin', (select coalesce(jsonb_agg(jsonb_build_object('key', k2, 'value', n)), '[]')
                            from (select case
                                           when i.status = 'resolved' and i.status_source = 'maintenance' then 'maintenance_auto'
                                           when i.status = 'resolved' then 'maintenance_validated'
                                           else i.status end k2, count(*) n
                                    from it i where i.status in ('resolved', 'resolved_without_maintenance', 'improper', 'cancelled')
                                   group by 1) x),
    'tmr_by_priority', (select coalesce(jsonb_agg(jsonb_build_object('key', priority, 'avg', a, 'median', md, 'n', n)), '[]')
                          from (select priority, round(avg(d)::numeric, 1) a,
                                       round((percentile_cont(0.5) within group (order by d))::numeric, 1) md, count(*) n
                                  from tmr group by priority) x),
    'tmr_by_cluster', (select coalesce(jsonb_agg(jsonb_build_object('key', cluster_key, 'label', label, 'avg', a, 'n', n) order by a desc), '[]')
                         from (select cluster_key, coalesce(max(cluster_name), cluster_key, 'Sem cluster') label,
                                      round(avg(d)::numeric, 1) a, count(*) n
                                 from tmr group by cluster_key) x),
    'trend', (
      with b as (
        select gs::date as bucket_start,
               (case v_bucket when 'day' then gs + interval '1 day' when 'week' then gs + interval '7 day'
                              else gs + interval '1 month' end)::date - 1 as bucket_end
          from generate_series(
                 case v_bucket when 'week' then date_trunc('week', v_from::timestamp)
                               when 'month' then date_trunc('month', v_from::timestamp) else v_from::timestamp end,
                 v_to::timestamp,
                 case v_bucket when 'day' then interval '1 day' when 'week' then interval '7 day' else interval '1 month' end) gs
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', b.bucket_start,
               'new_items', (select count(*) from it i where i.operational_date between b.bucket_start and b.bucket_end),
               'treated_items', (select count(*) from public.action_plan_items i join pl p on p.id = i.plan_id
                                  where i.status in ('resolved', 'resolved_without_maintenance', 'improper')
                                    and (i.resolved_at at time zone 'America/Sao_Paulo')::date between b.bucket_start and b.bucket_end),
               'new_plans', (select count(*) from pl p where p.first_operational_date between b.bucket_start and b.bucket_end),
               'closed_plans', (select count(*) from pl p where p.status <> 'cancelled' and p.closed_at is not null
                                  and (p.closed_at at time zone 'America/Sao_Paulo')::date between b.bucket_start and b.bucket_end),
               'backlog', (select count(*) from public.action_plans p
                            where p.id in (select id from pl)
                              and p.first_operational_date <= b.bucket_end
                              and (p.closed_at is null or (p.closed_at at time zone 'America/Sao_Paulo')::date > b.bucket_end)))
             order by b.bucket_start), '[]'::jsonb)
        from b),
    'coverage', private.action_plan_coverage(p_organization_id))
    into v_result
    from kpi k;
  return v_result;
end;
$$;

-- Cobertura do mapeamento: chaves de ação que geram plano × serviços ativos.
create or replace function private.action_plan_coverage(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with keys as (
    -- As chaves que geram plano: pergunta ativa de manutenção que gera plano
    -- e, quando ela tem detalhe de seleção, a chave do detalhe.
    select distinct p.app_id, p.question_key, d.field_key,
           'q:' || p.question_key || coalesce(':' || d.field_key, '') as action_key
      from public.checklist_action_parameters p
      left join public.checklist_action_parameters d
        on d.organization_id = p.organization_id and d.app_id = p.app_id and d.question_key = p.question_key
       and d.field_key is not null and d.question_role = 'detail' and d.status = 'active'
     where p.organization_id = p_organization_id and p.field_key is null
       and p.action_domain = 'maintenance' and p.generates_plan and p.status = 'active'
  ),
  m as (
    select k.*,
           (select count(*) from public.maintenance_checklist_service_links s
              join public.maintenance_services sv on sv.id = s.service_id
             where s.organization_id = p_organization_id and s.app_id = k.app_id and s.question_key = k.question_key
               and (s.field_key is null or s.field_key is not distinct from k.field_key)
               and s.is_active and sv.deleted_at is null and sv.status = 'active') as active_services,
           (select count(*) from public.maintenance_checklist_service_links s
             where s.organization_id = p_organization_id and s.app_id = k.app_id and s.question_key = k.question_key
               and s.field_key is not distinct from k.field_key and not s.is_active) as inactive_links,
           (select count(*) from public.maintenance_checklist_service_links s
              join public.maintenance_services sv on sv.id = s.service_id
             where s.organization_id = p_organization_id and s.app_id = k.app_id and s.question_key = k.question_key
               and (s.field_key is null or s.field_key is not distinct from k.field_key)
               and s.is_active and (sv.deleted_at is not null or sv.status <> 'active')) as archived_services,
           (select count(*) from public.maintenance_checklist_service_links s
             where s.organization_id = p_organization_id and s.app_id = k.app_id and s.question_key = k.question_key
               and (s.field_key is null or s.field_key is not distinct from k.field_key)
               and s.is_active and s.auto_resolve) as auto_resolve_services
      from keys k
  )
  select jsonb_build_object(
    'action_keys', count(*),
    'mapped', count(*) filter (where active_services > 0),
    'unmapped', count(*) filter (where active_services = 0),
    'conflicting', count(*) filter (where archived_services > 0),
    'inactive', count(*) filter (where active_services = 0 and inactive_links > 0),
    'auto_resolve', count(*) filter (where auto_resolve_services > 0),
    'pct', case when count(*) > 0 then round(100.0 * count(*) filter (where active_services > 0) / count(*), 1) end)
    from m;
$$;

-- -----------------------------------------------------------------------------
-- 5. Detalhe do plano
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_detail(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p     public.action_plans;
  v_today date;
  v_soon  integer;
begin
  select * into v_p from public.action_plans where id = p_plan_id;
  if not found then
    raise exception 'Plano de ação não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.action_plan_assert_view(v_p.organization_id);
  if not private.action_plan_in_scope(v_p) then
    raise exception 'Este plano não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  v_today := private.maintenance_today(v_p.organization_id);
  v_soon := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = v_p.organization_id), 3);

  return private.action_plan_row_json(v_p, v_today, v_soon) || jsonb_build_object(
    'app_id', v_p.app_id, 'field_key', v_p.field_key, 'option_value', v_p.option_value,
    'first_execution_id', v_p.first_execution_id,
    'can_reopen', private.action_plan_terminal(v_p.status) and v_p.status <> 'cancelled'
                  and not exists (select 1 from public.action_plans o
                                   where o.organization_id = v_p.organization_id and o.vehicle_id = v_p.vehicle_id
                                     and o.plan_key = v_p.plan_key and o.id <> v_p.id
                                     and not private.action_plan_terminal(o.status)),
    'open_plan_same_problem', (select jsonb_build_object('id', o.id, 'code', o.code) from public.action_plans o
                                where o.organization_id = v_p.organization_id and o.vehicle_id = v_p.vehicle_id
                                  and o.plan_key = v_p.plan_key and o.id <> v_p.id
                                  and not private.action_plan_terminal(o.status) limit 1),
    'previous_plan', (select jsonb_build_object('id', o.id, 'code', o.code, 'status', o.status, 'closed_at', o.closed_at)
                        from public.action_plans o where o.id = v_p.previous_plan_id),
    'next_plans', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'status', o.status,
                                                                'first_operational_date', o.first_operational_date)
                                             order by o.created_at), '[]'::jsonb)
                     from public.action_plans o where o.previous_plan_id = v_p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('service_id', sv.id, 'name', sv.name,
                                                              'cluster_id', sv.cluster_id,
                                                              'cluster', (select c.name from public.maintenance_clusters c where c.id = sv.cluster_id),
                                                              'auto_resolve', s.auto_resolve, 'field_key', s.field_key)
                                           order by sv.name), '[]'::jsonb)
                   from public.maintenance_checklist_service_links s
                   join public.maintenance_services sv on sv.id = s.service_id
                  where s.organization_id = v_p.organization_id and s.app_id = v_p.app_id and s.is_active
                    and s.question_key = v_p.question_key
                    and (s.field_key is null or s.field_key is not distinct from v_p.field_key)
                    and sv.deleted_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'execution_id', i.checklist_execution_id, 'answer_id', i.checklist_answer_id,
                'question_key', i.question_key, 'question', i.question_text_snapshot, 'answer', i.answer,
                'field_key', i.field_key, 'option_value', i.option_value, 'option_label', i.option_label,
                'conditional_value', i.conditional_value, 'detail_text', i.detail_text, 'note', i.note,
                'checklist_type', i.checklist_type, 'operational_date', i.operational_date, 'occurred_at', i.occurred_at,
                'employee_id', i.employee_id,
                'employee_name', (select e.full_name from public.employees e where e.id = i.employee_id),
                'employee_code', (select e.employee_code from public.employees e where e.id = i.employee_id),
                'user_name', private.org_member_name(i.organization_id, i.user_id),
                'license_plate', i.license_plate_snapshot,
                'operation_name', (select o.name from public.operations o where o.id = i.operation_id),
                'br_code', (select b.code from public.operation_brs b where b.id = i.operation_br_id),
                'leader_name', (select e.full_name from public.employees e where e.id = i.leader_employee_id),
                'status', i.status, 'status_source', i.status_source, 'resolved_at', i.resolved_at,
                'resolved_by_name', private.org_member_name(i.organization_id, i.resolved_by),
                'resolved_maintenance_id', i.resolved_maintenance_id,
                'resolved_maintenance_code', (select m.code from public.maintenances m where m.id = i.resolved_maintenance_id),
                'maintenances', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status,
                                                                              'resolution_status', f.resolution_status)
                                                           order by m.created_at), '[]'::jsonb)
                                   from public.maintenance_finding_links f join public.maintenances m on m.id = f.maintenance_id
                                  where f.checklist_answer_id = i.checklist_answer_id),
                'last_resolution', (select jsonb_build_object('type', r.resolution_type, 'reason_code', r.reason_code,
                                                              'reason', r.reason, 'observation', r.observation,
                                                              'by', r.resolved_by_name, 'at', r.resolved_at, 'source', r.source)
                                      from public.action_plan_item_resolutions r where r.item_id = i.id
                                     order by r.resolved_at desc limit 1))
              order by i.operational_date desc, i.occurred_at desc), '[]'::jsonb)
                from public.action_plan_items i where i.plan_id = v_p.id),
    'resolutions', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', r.id, 'item_id', r.item_id, 'type', r.resolution_type, 'from', r.from_status, 'to', r.to_status,
                      'maintenance_id', r.maintenance_id,
                      'maintenance_code', (select m.code from public.maintenances m where m.id = r.maintenance_id),
                      'source', r.source, 'confidence', r.confidence, 'reason_code', r.reason_code, 'reason', r.reason,
                      'observation', r.observation, 'by', r.resolved_by_name, 'at', r.resolved_at,
                      'option_label', (select i.option_label from public.action_plan_items i where i.id = r.item_id),
                      'operational_date', (select i.operational_date from public.action_plan_items i where i.id = r.item_id))
                    order by r.resolved_at desc), '[]'::jsonb)
                      from public.action_plan_item_resolutions r where r.plan_id = v_p.id),
    'maintenance_links', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', l.id, 'maintenance_id', m.id, 'code', m.code, 'status', m.status,
                            'type', m.maintenance_type_code,
                            'origin_name', (select o.name from public.maintenance_origins o where o.id = m.origin_id),
                            'requested_on', m.requested_on, 'scheduled_date', m.scheduled_date, 'entry_date', m.entry_date,
                            'exit_date', m.exit_date, 'service_order_number', m.service_order_number,
                            'supplier_name', (select s.name from public.maintenance_suppliers s where s.id = m.supplier_id),
                            'services', (select string_agg(i.service_name_snapshot, ', ' order by i.sort_order)
                                           from public.maintenance_items i where i.maintenance_id = m.id and i.status <> 'cancelled'),
                            'link_status', l.status, 'origin', l.origin, 'confidence', l.confidence, 'rule', l.rule,
                            'resolutive', l.resolutive, 'reason', l.reason,
                            'linked_by', private.org_member_name(l.organization_id, l.linked_by), 'linked_at', l.linked_at,
                            'unlinked_by', private.org_member_name(l.organization_id, l.unlinked_by), 'unlinked_at', l.unlinked_at,
                            'answers', (select count(*) from public.maintenance_finding_links f
                                         where f.maintenance_id = m.id
                                           and f.checklist_answer_id in (select i.checklist_answer_id from public.action_plan_items i where i.plan_id = v_p.id)),
                            'answers_resolved', (select count(*) from public.maintenance_finding_links f
                                                  where f.maintenance_id = m.id and f.resolution_status = 'resolved'
                                                    and f.checklist_answer_id in (select i.checklist_answer_id from public.action_plan_items i where i.plan_id = v_p.id)))
                          order by l.linked_at desc), '[]'::jsonb)
                            from public.action_plan_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                           where l.plan_id = v_p.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', e.id, 'type', e.event_type, 'from', e.from_status, 'to', e.to_status, 'reason', e.reason,
                 'payload', e.payload, 'source', e.source, 'actor', e.actor_name, 'at', e.created_at)
               order by e.created_at desc), '[]'::jsonb)
                 from public.action_plan_events e where e.plan_id = v_p.id),
    'executions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', x.id, 'operational_date', x.operational_date, 'checklist_type', x.checklist_type,
                     'submitted_at', x.submitted_at, 'employee_name', (select e.full_name from public.employees e where e.id = x.employee_id),
                     'employee_code', (select e.employee_code from public.employees e where e.id = x.employee_id),
                     'non_conforming', x.non_conforming_answers, 'license_plate', x.license_plate_snapshot)
                   order by x.operational_date desc, x.submitted_at desc), '[]'::jsonb)
                     from public.checklist_executions x
                    where x.id in (select i.checklist_execution_id from public.action_plan_items i where i.plan_id = v_p.id)));
end;
$$;

-- Candidatas para vincular (no detalhe e antes de abrir nova manutenção).
create or replace function public.action_plan_maintenance_candidates(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.action_plans;
begin
  select * into v_p from public.action_plans where id = p_plan_id;
  if not found then
    raise exception 'Plano de ação não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.action_plan_assert_view(v_p.organization_id);
  if not private.action_plan_in_scope(v_p) then
    raise exception 'Este plano não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  return private.action_plan_candidates(p_plan_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Conciliação × Manutenções
-- -----------------------------------------------------------------------------
-- Planos abertos sem manutenção aberta que os cubra, com a melhor candidata e a
-- confiança: high | medium | manual_review | none (sem correspondência).
create or replace function public.action_plan_reconciliation(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_confidence text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_soon   integer := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = p_organization_id), 3);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_counts jsonb;
  v_total  bigint;
begin
  perform private.action_plan_assert_view(p_organization_id);
  with rec as materialized (
    select p as plan, c.cand as candidates,
           coalesce((select x ->> 'confidence' from jsonb_array_elements(c.cand) x
                      order by case x ->> 'confidence' when 'high' then 0 when 'medium' then 1 else 2 end limit 1), 'none') as best
      from private.action_plan_filtered(p_organization_id, p_filters) p
      cross join lateral (select private.action_plan_candidates(p.id) as cand) c
     where p.status in ('new', 'in_analysis', 'awaiting_maintenance', 'pending_new_action')
  )
  select (select jsonb_object_agg(best, n) from (select best, count(*) n from rec group by best) x),
         (select count(*) from rec where p_confidence is null or best = p_confidence),
         (select coalesce(jsonb_agg(private.action_plan_row_json(r.plan, v_today, v_soon)
                                    || jsonb_build_object('best_confidence', r.best, 'candidates', r.candidates)
                                    order by case r.best when 'high' then 0 when 'medium' then 1 when 'manual_review' then 2 else 3 end,
                                             (r.plan).first_operational_date), '[]'::jsonb)
            from (select * from rec where p_confidence is null or best = p_confidence
                   order by case best when 'high' then 0 when 'medium' then 1 when 'manual_review' then 2 else 3 end,
                            (plan).first_operational_date
                   limit v_limit offset v_offset) r)
    into v_counts, v_total, v_rows;
  return jsonb_build_object('total', v_total, 'counts', coalesce(v_counts, '{}'::jsonb), 'rows', v_rows,
                            'coverage', private.action_plan_coverage(p_organization_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Mapeamento Pergunta × Serviço e parâmetros
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_mapping(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id);
  with q as (
    -- A versão mais recente de cada pergunta e campo (texto e rótulo vigentes).
    select distinct on (qq.question_key, coalesce(cc.field_key, ''))
           v.app_id, qq.question_key, cc.field_key, qq.question_text, qq.criticality, qq.conforming_answer,
           cl.cluster_key, cl.name as cluster_name, cl.sort_order as cluster_order, qq.sort_order as question_order,
           cc.label as field_label, cc.field_type, cc.options, v.status as version_status, v.label as version_label
      from public.checklist_questions qq
      join public.checklist_app_versions v on v.id = qq.version_id
      join public.operational_apps a on a.id = v.app_id and a.organization_id = p_organization_id and a.code = 'checklist_frota'
      join public.checklist_clusters cl on cl.id = qq.cluster_id
      left join lateral (select null::text as field_key, null::text as label, null::text as field_type, null::jsonb as options
                         union all
                         select c.field_key, c.label, c.field_type, c.options
                           from public.checklist_question_conditionals c where c.question_id = qq.id) cc on true
     order by qq.question_key, coalesce(cc.field_key, ''), (v.status = 'published') desc, v.major desc, v.minor desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'app_id', q.app_id, 'question_key', q.question_key, 'field_key', q.field_key,
           'action_key', 'q:' || q.question_key || coalesce(':' || q.field_key, ''),
           'question', q.question_text, 'field_label', q.field_label, 'field_type', q.field_type, 'options', q.options,
           'criticality', q.criticality, 'cluster_key', q.cluster_key, 'cluster_name', q.cluster_name,
           'version_label', q.version_label,
           'parameter', (select to_jsonb(p) - 'organization_id' - 'created_by' - 'updated_by'
                           from public.checklist_action_parameters p
                          where p.organization_id = p_organization_id and p.app_id = q.app_id
                            and p.question_key = q.question_key and p.field_key is not distinct from q.field_key),
           'services', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'service_id', sv.id, 'name', sv.name, 'auto_resolve', s.auto_resolve, 'is_active', s.is_active,
                                 'service_status', sv.status, 'archived', sv.deleted_at is not null,
                                 'cluster', (select c.name from public.maintenance_clusters c where c.id = sv.cluster_id))
                               order by s.is_active desc, sv.name), '[]'::jsonb)
                          from public.maintenance_checklist_service_links s
                          join public.maintenance_services sv on sv.id = s.service_id
                         where s.organization_id = p_organization_id and s.app_id = q.app_id
                           and s.question_key = q.question_key and s.field_key is not distinct from q.field_key),
           'open_plans', (select count(*) from public.action_plans p
                           where p.organization_id = p_organization_id and p.question_key = q.question_key
                             and (q.field_key is null or p.field_key = q.field_key)
                             and not private.action_plan_terminal(p.status)))
         order by q.cluster_order, q.question_order, q.field_key nulls first), '[]'::jsonb)
    into v_rows
    from q;
  return jsonb_build_object('rows', v_rows, 'coverage', private.action_plan_coverage(p_organization_id),
                            'settings', (select to_jsonb(s) - 'organization_id' from public.action_plan_settings s
                                          where s.organization_id = p_organization_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Qualidade & Auditoria
-- -----------------------------------------------------------------------------
-- Cada verificação: chave, quantidade, classe de correção (safe = correção
-- automática segura, review = revisão necessária, blocked = bloqueada) e
-- amostra. Nada aqui corrige dado histórico sozinho.
create or replace function public.action_plan_quality(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_checks jsonb := '[]'::jsonb;
  v_n      bigint;
  v_sample jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id, 'action_plans.view_audit');

  -- Inconformidade de manutenção sem apontamento.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('execution_id', a.execution_id, 'answer_id', a.id,
                                                         'question_key', a.question_key, 'date', a.operational_date,
                                                         'plate', a.license_plate_snapshot)) filter (where rn <= 20), '[]')
    into v_n, v_sample
    from (select a.id, a.execution_id, a.question_key, e.operational_date, e.license_plate_snapshot,
                 row_number() over (order by e.operational_date desc, e.submitted_at desc) rn
            from public.checklist_execution_answers a
            join public.checklist_executions e on e.id = a.execution_id
           where a.organization_id = p_organization_id and not a.is_conforming
             and not exists (select 1 from public.action_plan_items i where i.checklist_answer_id = a.id)
             and private.action_plan_answer_route(a.id) = 'maintenance') a;
  v_checks := v_checks || jsonb_build_object('key', 'finding_without_item', 'count', v_n, 'class', 'safe', 'sample', v_sample);

  -- Plano sem apontamentos.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code)) filter (where true), '[]')
    into v_n, v_sample
    from public.action_plans p where p.organization_id = p_organization_id
     and not exists (select 1 from public.action_plan_items i where i.plan_id = p.id);
  v_checks := v_checks || jsonb_build_object('key', 'plan_without_items', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Plano encerrado com apontamento pendente / aberto sem pendência.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'status', p.status)), '[]')
    into v_n, v_sample
    from public.action_plans p where p.organization_id = p_organization_id and private.action_plan_terminal(p.status)
     and exists (select 1 from public.action_plan_items i where i.plan_id = p.id and i.status in ('pending', 'in_maintenance', 'needs_action'));
  v_checks := v_checks || jsonb_build_object('key', 'closed_with_pending', 'count', v_n, 'class', 'review', 'sample', v_sample);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'status', p.status)), '[]')
    into v_n, v_sample
    from public.action_plans p where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status)
     and not exists (select 1 from public.action_plan_items i where i.plan_id = p.id and i.status in ('pending', 'in_maintenance', 'needs_action'));
  v_checks := v_checks || jsonb_build_object('key', 'open_without_pending', 'count', v_n, 'class', 'safe', 'sample', v_sample);

  -- Situação gravada ≠ contadores (recalcular resolve).
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code)), '[]')
    into v_n, v_sample
    from public.action_plans p where p.organization_id = p_organization_id
     and p.open_items <> (select count(*) from public.action_plan_items i where i.plan_id = p.id and i.status in ('pending', 'in_maintenance', 'needs_action'));
  v_checks := v_checks || jsonb_build_object('key', 'stale_counters', 'count', v_n, 'class', 'safe', 'sample', v_sample);

  -- Chaves de ação que geram plano sem serviço mapeado.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('action_key', k.action_key, 'open_plans', k.open_plans)), '[]')
    into v_n, v_sample
    from (select p.action_key, count(*) filter (where not private.action_plan_terminal(p.status)) as open_plans
            from public.action_plans p
           where p.organization_id = p_organization_id
             and not exists (select 1 from public.maintenance_checklist_service_links s
                              where s.organization_id = p.organization_id and s.app_id = p.app_id and s.is_active
                                and s.question_key = p.question_key
                                and (s.field_key is null or s.field_key is not distinct from p.field_key))
           group by p.action_key) k;
  v_checks := v_checks || jsonb_build_object('key', 'action_key_without_service', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Mapeamento ativo para serviço arquivado/inativo.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('action_key', s.action_key, 'service', sv.name)), '[]')
    into v_n, v_sample
    from public.maintenance_checklist_service_links s join public.maintenance_services sv on sv.id = s.service_id
   where s.organization_id = p_organization_id and s.is_active and (sv.deleted_at is not null or sv.status <> 'active');
  v_checks := v_checks || jsonb_build_object('key', 'mapping_inactive_service', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Gatilho sem detalhe: a pergunta tem detalhe de seleção, mas o apontamento
  -- veio sem opção (plano genérico da pergunta).
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'title', p.title)), '[]')
    into v_n, v_sample
    from public.action_plans p
   where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status) and p.field_key is null
     and exists (select 1 from public.checklist_action_parameters d
                  where d.organization_id = p.organization_id and d.app_id = p.app_id and d.question_key = p.question_key
                    and d.field_key is not null and d.question_role = 'detail' and d.status = 'active');
  v_checks := v_checks || jsonb_build_object('key', 'trigger_without_detail', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Plano aberto há mais de 30 dias sem manutenção.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'days', v_today - p.first_operational_date)), '[]')
    into v_n, v_sample
    from public.action_plans p
   where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status)
     and v_today - p.first_operational_date > 30
     and not exists (select 1 from public.action_plan_maintenance_links l where l.plan_id = p.id and l.status = 'active');
  v_checks := v_checks || jsonb_build_object('key', 'old_open_without_maintenance', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Vínculo ativo com manutenção cancelada.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'maintenance_code', m.code)), '[]')
    into v_n, v_sample
    from public.action_plan_maintenance_links l
    join public.action_plans p on p.id = l.plan_id
    join public.maintenances m on m.id = l.maintenance_id
   where l.organization_id = p_organization_id and l.status = 'active' and m.status in ('cancelled', 'not_performed')
     and not private.action_plan_terminal(p.status);
  v_checks := v_checks || jsonb_build_object('key', 'link_cancelled_maintenance', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Vínculo de manutenção de outro veículo (não deveria existir).
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code, 'maintenance_code', m.code)), '[]')
    into v_n, v_sample
    from public.action_plan_maintenance_links l
    join public.action_plans p on p.id = l.plan_id
    join public.maintenances m on m.id = l.maintenance_id
   where l.organization_id = p_organization_id and l.status = 'active' and m.vehicle_id <> p.vehicle_id;
  v_checks := v_checks || jsonb_build_object('key', 'link_other_vehicle', 'count', v_n, 'class', 'blocked', 'sample', v_sample);

  -- Plano sem contexto histórico (sem operação no checklist de origem).
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', p.id, 'code', p.code)), '[]')
    into v_n, v_sample
    from public.action_plans p where p.organization_id = p_organization_id and p.operation_id is null;
  v_checks := v_checks || jsonb_build_object('key', 'plan_without_context', 'count', v_n, 'class', 'blocked', 'sample', v_sample);

  -- Apontamento com correção do checklist em conflito com a tratativa.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', e.plan_id, 'item_id', e.payload ->> 'item_id')), '[]')
    into v_n, v_sample
    from public.action_plan_events e where e.organization_id = p_organization_id and e.event_type = 'correction_conflict';
  v_checks := v_checks || jsonb_build_object('key', 'correction_conflict', 'count', v_n, 'class', 'review', 'sample', v_sample);

  -- Falhas de recebimento.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('execution_id', g.execution_id, 'error', g.last_error, 'attempts', g.attempts)), '[]')
    into v_n, v_sample
    from public.action_plan_ingestions g where g.organization_id = p_organization_id and g.status = 'failed';
  v_checks := v_checks || jsonb_build_object('key', 'ingestion_failed', 'count', v_n, 'class', 'safe', 'sample', v_sample);

  -- Mais de uma candidata de alta/média confiança (revisão manual).
  select count(*), coalesce(jsonb_agg(jsonb_build_object('plan_id', x.id, 'code', x.code, 'candidates', x.n)), '[]')
    into v_n, v_sample
    from (select p.id, p.code,
                 (select count(*) from jsonb_array_elements(private.action_plan_candidates(p.id)) c
                   where c ->> 'confidence' in ('high', 'medium')) n
            from public.action_plans p
           where p.organization_id = p_organization_id
             and p.status in ('new', 'in_analysis', 'awaiting_maintenance', 'pending_new_action')) x
   where x.n > 1;
  v_checks := v_checks || jsonb_build_object('key', 'multiple_candidates', 'count', v_n, 'class', 'review', 'sample', v_sample);

  return jsonb_build_object('checks', v_checks,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'plan_id', e.plan_id,
                                                            'code', (select p.code from public.action_plans p where p.id = e.plan_id),
                                                            'type', e.event_type, 'reason', e.reason, 'source', e.source,
                                                            'actor', e.actor_name, 'at', e.created_at)
                                         order by e.created_at desc), '[]'::jsonb)
                 from (select * from public.action_plan_events e where e.organization_id = p_organization_id
                        order by e.created_at desc limit 200) e));
end;
$$;

-- Correção automática segura: recalcula a situação e os contadores dos planos
-- (derivação dos apontamentos) e reprocessa recebimentos que falharam. Nunca
-- altera resposta do checklist, decisão de usuário ou manutenção.
create or replace function public.action_plan_quality_fix(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p   record;
  v_n   integer := 0;
  v_r   jsonb;
  v_ing integer := 0;
begin
  if not private.has_permission(p_organization_id, 'action_plans.reprocess') then
    raise exception 'Você não possui permissão para reprocessar.' using errcode = 'insufficient_privilege';
  end if;
  for v_p in select p.id from public.action_plans p where p.organization_id = p_organization_id loop
    perform private.action_plan_refresh(v_p.id, 'system');
    v_n := v_n + 1;
  end loop;
  for v_p in
    select e.id from public.checklist_executions e
     where e.organization_id = p_organization_id and e.status = 'submitted'
       and (exists (select 1 from public.action_plan_ingestions g where g.execution_id = e.id and g.status = 'failed')
            or exists (select 1 from public.checklist_execution_answers a
                        where a.execution_id = e.id and not a.is_conforming
                          and not exists (select 1 from public.action_plan_items i where i.checklist_answer_id = a.id)
                          and private.action_plan_answer_route(a.id) = 'maintenance'))
  loop
    v_r := private.action_plan_ingest_safe(v_p.id, 'reprocess');
    v_ing := v_ing + 1;
  end loop;
  return jsonb_build_object('plans_refreshed', v_n, 'executions_reprocessed', v_ing);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Saúde da integração
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_health(p_organization_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := private.maintenance_today(p_organization_id) - greatest(coalesce(p_days, 30), 1) + 1;
begin
  perform private.action_plan_assert_view(p_organization_id, 'action_plans.view_audit');
  return jsonb_build_object(
    'days', p_days, 'from', v_from,
    'executions_submitted', (select count(*) from public.checklist_executions e
                              where e.organization_id = p_organization_id and e.status = 'submitted' and e.operational_date >= v_from),
    'executions_with_findings', (select count(*) from public.checklist_executions e
                                  where e.organization_id = p_organization_id and e.status = 'submitted'
                                    and e.operational_date >= v_from and e.non_conforming_answers > 0),
    'processed', (select count(*) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                   where g.organization_id = p_organization_id and g.status = 'processed' and e.operational_date >= v_from),
    'failed', (select count(*) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                where g.organization_id = p_organization_id and g.status = 'failed' and e.operational_date >= v_from),
    'pending', (select count(*) from public.checklist_executions e
                 where e.organization_id = p_organization_id and e.status = 'submitted' and e.operational_date >= v_from
                   and e.non_conforming_answers > 0
                   and not exists (select 1 from public.action_plan_ingestions g where g.execution_id = e.id and g.status = 'processed')),
    'findings', (select coalesce(sum(g.findings), 0) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                  where g.organization_id = p_organization_id and e.operational_date >= v_from),
    'maintenance_findings', (select coalesce(sum(g.maintenance_findings), 0) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                              where g.organization_id = p_organization_id and e.operational_date >= v_from),
    'damage_findings', (select coalesce(sum(g.damage_findings), 0) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                         where g.organization_id = p_organization_id and e.operational_date >= v_from),
    'not_eligible', (select coalesce(sum(g.not_eligible), 0) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                      where g.organization_id = p_organization_id and e.operational_date >= v_from),
    'items_created', (select count(*) from public.action_plan_items i
                       where i.organization_id = p_organization_id and i.operational_date >= v_from),
    'plans_created', (select count(*) from public.action_plans p
                       where p.organization_id = p_organization_id and p.first_operational_date >= v_from),
    'plans_updated', (select count(distinct e.plan_id) from public.action_plan_events e
                       where e.organization_id = p_organization_id and e.event_type = 'occurrence_added'
                         and e.created_at >= v_from::timestamptz),
    'reprocessed', (select count(*) from public.action_plan_ingestions g join public.checklist_executions e on e.id = g.execution_id
                     where g.organization_id = p_organization_id and g.source in ('reprocess', 'cron') and e.operational_date >= v_from),
    'damage_events_pending', (select count(*) from public.outbox_events x
                               where x.organization_id = p_organization_id and x.event_type = 'checklist.damage.reported'
                                 and x.status = 'pending'),
    'last_processed_at', (select max(g.processed_at) from public.action_plan_ingestions g where g.organization_id = p_organization_id),
    'recent_failures', (select coalesce(jsonb_agg(jsonb_build_object('execution_id', g.execution_id, 'error', g.last_error,
                                                                     'attempts', g.attempts, 'at', g.updated_at)
                                                  order by g.updated_at desc), '[]'::jsonb)
                          from (select * from public.action_plan_ingestions g where g.organization_id = p_organization_id
                                   and g.status = 'failed' order by g.updated_at desc limit 20) g),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'executions', n, 'items', it) order by d), '[]'::jsonb)
                 from (select e.operational_date d, count(distinct e.id) n,
                              (select count(*) from public.action_plan_items i where i.organization_id = p_organization_id
                                 and i.operational_date = e.operational_date) it
                         from public.checklist_executions e
                        where e.organization_id = p_organization_id and e.status = 'submitted' and e.operational_date >= v_from
                        group by e.operational_date) x));
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Minha visão (liderança/gestão do escopo) e feedback do motorista
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_my_view(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  v_soon  integer := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = p_organization_id), 3);
begin
  perform private.action_plan_assert_view(p_organization_id);
  return (with tmp_ap_my as materialized (
            select * from private.action_plan_filtered(p_organization_id, '{"status_group":"open"}'::jsonb))
  select jsonb_build_object(
    'today', v_today,
    'scope', jsonb_build_object(
      'plans_open', (select count(*) from tmp_ap_my),
      'items_open', (select coalesce(sum(open_items), 0) from tmp_ap_my),
      'overdue', (select count(*) from tmp_ap_my t where private.action_plan_deadline(t, v_today, v_soon) = 'overdue'),
      'due_soon', (select count(*) from tmp_ap_my t where private.action_plan_deadline(t, v_today, v_soon) in ('today', 'soon')),
      'critical', (select count(*) from tmp_ap_my where priority = 'critical'),
      'in_maintenance', (select count(*) from tmp_ap_my where status in ('maintenance_open', 'maintenance_scheduled', 'maintenance_in_progress')),
      'pending_new_action', (select count(*) from tmp_ap_my where status = 'pending_new_action'),
      'without_treatment', (select count(*) from tmp_ap_my where status in ('new', 'in_analysis'))),
    'mine', jsonb_build_object(
      'plans_open', (select count(*) from tmp_ap_my where responsible_user_id = auth.uid()),
      'overdue', (select count(*) from tmp_ap_my t where responsible_user_id = auth.uid()
                    and private.action_plan_deadline(t, v_today, v_soon) = 'overdue')),
    'attention', (select coalesce(jsonb_agg(private.action_plan_row_json(t, v_today, v_soon) order by
                     case private.action_plan_deadline(t, v_today, v_soon) when 'overdue' then 0 when 'today' then 1 when 'soon' then 2 else 3 end,
                     case t.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
                     t.due_on nulls last), '[]'::jsonb)
                    from (select * from tmp_ap_my t
                           order by case private.action_plan_deadline(t, v_today, v_soon) when 'overdue' then 0 when 'today' then 1 when 'soon' then 2 else 3 end,
                                    case t.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
                                    t.due_on nulls last
                           limit 12) t),
    'by_operation', (select coalesce(jsonb_agg(jsonb_build_object('key', operation_id, 'label', label, 'open', n, 'overdue', ov)
                                               order by n desc), '[]'::jsonb)
                       from (select t.operation_id, coalesce((select o.name from public.operations o where o.id = t.operation_id), 'Sem operação') label,
                                    count(*) n,
                                    count(*) filter (where private.action_plan_deadline(t, v_today, v_soon) = 'overdue') ov
                               from tmp_ap_my t group by t.operation_id) x)));
end;
$$;

-- O colaborador acompanha o andamento do que ELE reportou (o colaborador da
-- conta na organização ou o usuário que enviou o checklist) — só leitura, só
-- itens visíveis ao operacional.
create or replace function public.action_plan_my_reports(p_organization_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_employee uuid;
  v_from     date := private.maintenance_today(p_organization_id) - least(greatest(coalesce(p_days, 90), 1), 365);
begin
  if v_uid is null or not (private.has_permission(p_organization_id, 'action_plans.view_own')
                           or private.has_permission(p_organization_id, 'action_plans.view')) then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
  select m.employee_id into v_employee from public.organization_memberships m
   where m.organization_id = p_organization_id and m.user_id = v_uid and m.status = 'active' limit 1;
  return jsonb_build_object('employee_id', v_employee, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'operational_date', i.operational_date, 'checklist_type', i.checklist_type,
             'license_plate', i.license_plate_snapshot, 'question', i.question_text_snapshot,
             'title', p.title, 'detail', coalesce(i.option_label, p.detail_label), 'note', i.note, 'detail_text', i.detail_text,
             'cluster_name', p.cluster_name, 'item_status', i.status, 'plan_status', p.status, 'plan_code', p.code,
             'resolved_at', i.resolved_at,
             'maintenance', (select jsonb_build_object('code', m.code, 'status', m.status, 'scheduled_date', m.scheduled_date,
                                                       'entry_date', m.entry_date, 'exit_date', m.exit_date,
                                                       'service_order_number', m.service_order_number,
                                                       'supplier_name', (select s.name from public.maintenance_suppliers s where s.id = m.supplier_id),
                                                       'services', (select string_agg(mi.service_name_snapshot, ', ' order by mi.sort_order)
                                                                      from public.maintenance_items mi where mi.maintenance_id = m.id and mi.status <> 'cancelled'))
                               from public.maintenance_finding_links f join public.maintenances m on m.id = f.maintenance_id
                              where f.checklist_answer_id = i.checklist_answer_id
                              order by (m.status = 'completed') desc, m.created_at desc limit 1),
             'days_to_treat', case when i.resolved_at is not null
                                   then (i.resolved_at at time zone 'America/Sao_Paulo')::date - i.operational_date end)
           order by i.operational_date desc, i.occurred_at desc), '[]'::jsonb)
      from public.action_plan_items i
      join public.action_plans p on p.id = i.plan_id
     where i.organization_id = p_organization_id and i.operational_date >= v_from
       and ((v_employee is not null and i.employee_id = v_employee) or i.user_id = v_uid)
       and coalesce((select prm.driver_visible from public.checklist_action_parameters prm
                       where prm.organization_id = p.organization_id and prm.app_id = p.app_id
                         and prm.question_key = p.question_key and prm.field_key is null), true)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Histórico por veículo (Cadastro de Frotas) e cadeia ponta a ponta
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_today date;
  v_soon  integer;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.action_plan_assert_view(v_org);
  v_today := private.maintenance_today(v_org);
  v_soon := coalesce((select s.due_soon_days from public.action_plan_settings s where s.organization_id = v_org), 3);
  return jsonb_build_object('rows', (
    select coalesce(jsonb_agg(private.action_plan_row_json(p, v_today, v_soon)
                              order by private.action_plan_terminal(p.status), p.last_occurrence_at desc), '[]'::jsonb)
      from private.action_plan_filtered(v_org, jsonb_build_object('vehicle_ids', jsonb_build_array(p_vehicle_id))) p));
end;
$$;

-- Histórico de checklists com inconformidades: a lista (paginada) e, por
-- execução, a cadeia checklist → inconformidade → plano → manutenção → resolução.
-- p_filters: date_from, date_to, search (placa/frota), employee_ids[], vehicle_ids[], operation_ids[]
create or replace function public.action_plan_checklist_history(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_from   date := nullif(p_filters ->> 'date_from', '')::date;
  v_to     date := nullif(p_filters ->> 'date_to', '')::date;
  v_search text := nullif(btrim(p_filters ->> 'search'), '');
  v_emps   uuid[] := private.jsonb_uuid_array(p_filters -> 'employee_ids');
  v_vehs   uuid[] := private.jsonb_uuid_array(p_filters -> 'vehicle_ids');
  v_ops    uuid[] := private.jsonb_uuid_array(p_filters -> 'operation_ids');
  v_total  bigint;
  v_rows   jsonb;
begin
  perform private.action_plan_assert_view(p_organization_id);
  with tmp_ap_hist as materialized (
    select e.id, e.operational_date, e.submitted_at from public.checklist_executions e
     where e.organization_id = p_organization_id and e.status = 'submitted' and e.non_conforming_answers > 0
       and e.operation_id in (select private.accessible_operation_ids())
       and (v_from is null or e.operational_date >= v_from) and (v_to is null or e.operational_date <= v_to)
       and (v_emps is null or e.employee_id = any (v_emps))
       and (v_vehs is null or e.vehicle_id = any (v_vehs))
       and (v_ops is null or e.operation_id = any (v_ops))
       and (v_search is null or e.license_plate_snapshot ilike '%' || private.normalize_plate(v_search) || '%'
            or coalesce(e.fleet_code_snapshot, '') ilike '%' || v_search || '%'))
  select (select count(*) from tmp_ap_hist),
         (select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'operational_date', e.operational_date, 'checklist_type', e.checklist_type,
           'submitted_at', e.submitted_at, 'license_plate', e.license_plate_snapshot, 'fleet_code', e.fleet_code_snapshot,
           'vehicle_id', e.vehicle_id,
           'employee_name', (select x.full_name from public.employees x where x.id = e.employee_id),
           'employee_code', (select x.employee_code from public.employees x where x.id = e.employee_id),
           'operation_name', (select o.name from public.operations o where o.id = e.operation_id),
           'br_code', (select b.code from public.operation_brs b where b.id = e.operation_br_id),
           'non_conforming', e.non_conforming_answers, 'critical', e.critical_non_conforming,
           'items', (select count(*) from public.action_plan_items i where i.checklist_execution_id = e.id),
           'items_open', (select count(*) from public.action_plan_items i where i.checklist_execution_id = e.id
                            and i.status in ('pending', 'in_maintenance', 'needs_action')),
           'damage', (select g.damage_findings from public.action_plan_ingestions g where g.execution_id = e.id),
           'ingestion_status', (select g.status from public.action_plan_ingestions g where g.execution_id = e.id))
         order by e.operational_date desc, e.submitted_at desc), '[]'::jsonb)
    from (select h.id from tmp_ap_hist h order by h.operational_date desc, h.submitted_at desc
           limit v_limit offset v_offset) h
    join public.checklist_executions e on e.id = h.id)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.action_plan_execution_trace(p_execution_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e public.checklist_executions;
begin
  select * into v_e from public.checklist_executions where id = p_execution_id;
  if not found then
    raise exception 'Checklist não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.action_plan_assert_view(v_e.organization_id);
  if not (v_e.operation_id in (select private.accessible_operation_ids())) then
    raise exception 'Este checklist não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'execution', jsonb_build_object('id', v_e.id, 'operational_date', v_e.operational_date, 'checklist_type', v_e.checklist_type,
                                    'license_plate', v_e.license_plate_snapshot, 'submitted_at', v_e.submitted_at,
                                    'employee_name', (select x.full_name from public.employees x where x.id = v_e.employee_id),
                                    'non_conforming', v_e.non_conforming_answers),
    'ingestion', (select to_jsonb(g) - 'organization_id' from public.action_plan_ingestions g where g.execution_id = v_e.id),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object(
                   'answer_id', a.id, 'question_key', a.question_key, 'question', a.question_text_snapshot,
                   'answer', a.answer, 'conditional_value', a.conditional_value, 'note', a.note,
                   'route', private.action_plan_answer_route(a.id),
                   'items', (select coalesce(jsonb_agg(jsonb_build_object(
                               'item_id', i.id, 'option_label', i.option_label, 'status', i.status,
                               'plan_id', p.id, 'plan_code', p.code, 'plan_status', p.status, 'title', p.title,
                               'maintenances', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status,
                                                                                            'resolution_status', f.resolution_status)), '[]'::jsonb)
                                                  from public.maintenance_finding_links f join public.maintenances m on m.id = f.maintenance_id
                                                 where f.checklist_answer_id = a.id),
                               'resolution', (select jsonb_build_object('type', r.resolution_type, 'reason', r.reason, 'at', r.resolved_at, 'by', r.resolved_by_name)
                                                from public.action_plan_item_resolutions r where r.item_id = i.id
                                               order by r.resolved_at desc limit 1))
                             order by i.option_value), '[]'::jsonb)
                               from public.action_plan_items i join public.action_plans p on p.id = i.plan_id
                              where i.checklist_answer_id = a.id))
                 order by a.cluster_key, a.question_key), '[]'::jsonb)
                   from public.checklist_execution_answers a
                  where a.execution_id = v_e.id and (not a.is_conforming
                        or exists (select 1 from public.action_plan_items i where i.checklist_answer_id = a.id))));
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Catálogo (opções dos filtros e responsáveis) do escopo
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_catalog(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.action_plan_assert_view(p_organization_id);
  return (with tmp_ap_cat as materialized (select * from private.action_plan_filtered(p_organization_id, '{}'::jsonb))
  select jsonb_build_object(
    'app_id', (select a.id from public.operational_apps a where a.organization_id = p_organization_id and a.code = 'checklist_frota'),
    'operations', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name), '[]'::jsonb)
                     from public.operations o where o.organization_id = p_organization_id and o.deleted_at is null
                      and o.id in (select private.accessible_operation_ids())),
    'states', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', s.id, 'uf', s.uf)), '[]'::jsonb)
                 from tmp_ap_cat t join public.states s on s.id = t.state_id),
    'cities', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', c.id, 'name', c.name, 'state_id', c.state_id)), '[]'::jsonb)
                 from tmp_ap_cat t join public.cities c on c.id = t.city_id),
    'units', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', u.id, 'name', u.name)), '[]'::jsonb)
                from tmp_ap_cat t join public.organization_units u on u.id = t.organization_unit_id),
    'brs', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', b.id, 'code', b.code, 'operation_id', b.operation_id)), '[]'::jsonb)
              from tmp_ap_cat t join public.operation_brs b on b.id = t.operation_br_id),
    'leaders', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', e.id, 'name', e.full_name)), '[]'::jsonb)
                  from tmp_ap_cat t join public.employees e on e.id = t.leader_employee_id),
    'vehicle_types', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', vt.id, 'name', vt.name)), '[]'::jsonb)
                        from tmp_ap_cat t join public.vehicle_types vt on vt.id = t.vehicle_type_id),
    'clusters', (select coalesce(jsonb_agg(distinct jsonb_build_object('key', t.cluster_key, 'name', coalesce(t.cluster_name, t.cluster_key))), '[]'::jsonb)
                   from tmp_ap_cat t where t.cluster_key is not null),
    'action_keys', (select coalesce(jsonb_agg(jsonb_build_object('key', x.action_key, 'title', x.title, 'question_key', x.question_key,
                                                                 'cluster_key', x.cluster_key) order by x.title), '[]'::jsonb)
                      from (select t.action_key, max(t.title) title, max(t.question_key) question_key, max(t.cluster_key) cluster_key
                              from tmp_ap_cat t group by t.action_key) x),
    'responsibles', (select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id,
                                                                  'name', coalesce(private.org_member_name(p_organization_id, m.user_id), 'Usuário'))
                                               order by private.org_member_name(p_organization_id, m.user_id)), '[]'::jsonb)
                       from public.organization_memberships m
                      where m.organization_id = p_organization_id and m.status = 'active'
                        and exists (select 1 from public.membership_roles mr
                                      join public.role_permissions rp on rp.role_id = mr.role_id
                                      join public.permissions pe on pe.id = rp.permission_id
                                     where mr.membership_id = m.id and pe.code = 'action_plans.manage')),
    'settings', (select to_jsonb(s) - 'organization_id' from public.action_plan_settings s where s.organization_id = p_organization_id)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Importação de follow-up (tratativas em lote, com prévia)
-- -----------------------------------------------------------------------------
-- p_rows: [{row, plan_code, plate, action (SEM_MANUTENCAO | IMPROCEDENTE |
-- CANCELAR | MANTER), reason_code, reason, resolved_on}]. Uma linha sem código
-- é casada pela placa + item só quando há UM plano aberto (mais de um: recusa).
-- p_apply = false: só valida (prévia). Nunca altera perfil, veículo, operação
-- ou histórico de manutenção; cada baixa é a mesma de action_plan_resolve_items.
create or replace function public.action_plan_followup_import(p_organization_id uuid, p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      jsonb;
  v_plan   public.action_plans;
  v_n      integer;
  v_action text;
  v_res    text;
  v_out    jsonb := '[]'::jsonb;
  v_ok     integer := 0;
  v_err    integer := 0;
  v_msg    text;
begin
  if not private.has_permission(p_organization_id, 'action_plans.import') then
    raise exception 'Você não possui permissão para importar tratativas.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Envie até 2.000 linhas por vez.' using errcode = 'invalid_parameter_value';
  end if;
  for v_r in select * from jsonb_array_elements(p_rows) loop
    v_msg := null; v_plan := null;
    v_action := upper(btrim(coalesce(v_r ->> 'action', '')));
    v_res := case v_action when 'SEM_MANUTENCAO' then 'resolved_without_maintenance' when 'IMPROCEDENTE' then 'improper'
                           when 'CANCELAR' then 'cancelled' when 'MANTER' then 'keep' end;
    if v_res is null then
      v_msg := 'Ação inválida (use SEM_MANUTENCAO, IMPROCEDENTE, CANCELAR ou MANTER).';
    elsif nullif(btrim(v_r ->> 'plan_code'), '') is not null then
      select * into v_plan from public.action_plans
       where organization_id = p_organization_id and code = upper(btrim(v_r ->> 'plan_code'));
      if v_plan.id is null then v_msg := 'Plano não encontrado.'; end if;
    else
      select count(*) into v_n from public.action_plans p
       where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status)
         and p.license_plate_snapshot = private.normalize_plate(v_r ->> 'plate')
         and (p.title || coalesce(' — ' || p.detail_label, '')) ilike '%' || btrim(coalesce(v_r ->> 'item', '')) || '%';
      if v_n = 1 then
        select p.* into v_plan from public.action_plans p
         where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status)
           and p.license_plate_snapshot = private.normalize_plate(v_r ->> 'plate')
           and (p.title || coalesce(' — ' || p.detail_label, '')) ilike '%' || btrim(coalesce(v_r ->> 'item', '')) || '%';
      else
        v_msg := case when v_n = 0 then 'Nenhum plano aberto para a placa e o item.'
                      else 'Mais de um plano aberto para a placa e o item: informe o código.' end;
      end if;
    end if;
    if v_msg is null and v_plan.id is not null then
      if not private.action_plan_in_scope(v_plan) then
        v_msg := 'Plano fora do seu escopo.';
      elsif private.action_plan_terminal(v_plan.status) then
        v_msg := 'Plano já encerrado.';
      elsif v_res <> 'keep' and length(btrim(coalesce(v_r ->> 'reason', ''))) < 10 then
        v_msg := 'Justificativa obrigatória (mínimo de 10 caracteres).';
      elsif v_res in ('resolved_without_maintenance', 'improper') and v_plan.status in ('maintenance_open', 'maintenance_scheduled', 'maintenance_in_progress') then
        v_msg := 'Há manutenção aberta tratando o plano.';
      end if;
    end if;
    if v_msg is null and p_apply and v_res <> 'keep' then
      begin
        perform public.action_plan_resolve_items(v_plan.id, jsonb_build_object(
          'resolution', v_res, 'reason_code', coalesce(nullif(v_r ->> 'reason_code', ''), 'followup_import'),
          'reason', v_r ->> 'reason', 'observation', 'Importação de follow-up', 'resolved_on', nullif(v_r ->> 'resolved_on', '')));
      exception when others then
        v_msg := sqlerrm;
      end;
    end if;
    if v_msg is null then v_ok := v_ok + 1; else v_err := v_err + 1; end if;
    v_out := v_out || jsonb_build_object('row', v_r -> 'row', 'plan_code', v_plan.code, 'action', v_action,
                                         'ok', v_msg is null, 'message', v_msg);
  end loop;
  return jsonb_build_object('applied', p_apply, 'ok', v_ok, 'errors', v_err, 'rows', v_out);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13b. Exportação dos apontamentos (paginada no servidor; sem teto)
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_export_items(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 1000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.action_plan_assert_view(p_organization_id, 'action_plans.export');
  return (
    with p as materialized (select * from private.action_plan_filtered(p_organization_id, p_filters))
    select jsonb_build_object(
      'total', (select count(*) from public.action_plan_items i join p on p.id = i.plan_id),
      'rows', coalesce((
        select jsonb_agg(x.r order by x.d desc, x.o desc)
          from (
            select jsonb_build_object(
                     'plan_code', p.code, 'plan_status', p.status, 'priority', p.priority, 'title', p.title,
                     'detail_label', p.detail_label, 'cluster_name', p.cluster_name, 'action_key', p.action_key,
                     'license_plate', i.license_plate_snapshot, 'fleet_code', p.fleet_code_snapshot,
                     'operational_date', i.operational_date, 'checklist_type', i.checklist_type,
                     'question', i.question_text_snapshot, 'answer', i.answer, 'option_label', i.option_label,
                     'detail_text', i.detail_text, 'note', i.note,
                     'employee_name', (select e.full_name from public.employees e where e.id = i.employee_id),
                     'employee_code', (select e.employee_code from public.employees e where e.id = i.employee_id),
                     'operation_name', (select o.name from public.operations o where o.id = i.operation_id),
                     'city_name', (select c.name from public.cities c where c.id = i.city_id),
                     'br_code', (select b.code from public.operation_brs b where b.id = i.operation_br_id),
                     'leader_name', (select e.full_name from public.employees e where e.id = i.leader_employee_id),
                     'item_status', i.status, 'resolved_at', i.resolved_at,
                     'resolution', (select r.resolution_type from public.action_plan_item_resolutions r where r.item_id = i.id
                                     order by r.resolved_at desc limit 1),
                     'resolution_reason', (select r.reason from public.action_plan_item_resolutions r where r.item_id = i.id
                                            order by r.resolved_at desc limit 1),
                     'maintenances', (select string_agg(m.code || ' (' || m.status || ')', ', ' order by m.created_at)
                                        from public.maintenance_finding_links f join public.maintenances m on m.id = f.maintenance_id
                                       where f.checklist_answer_id = i.checklist_answer_id)) as r,
                   i.operational_date as d, i.occurred_at as o
              from public.action_plan_items i join p on p.id = i.plan_id
             order by i.operational_date desc, i.occurred_at desc, i.id
             limit v_limit offset v_offset) x), '[]'::jsonb)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 13c. Planos de ação de uma manutenção (o outro lado do vínculo, na gaveta
--      oficial da Manutenção)
-- -----------------------------------------------------------------------------
create or replace function public.action_plan_for_maintenance(p_maintenance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m public.maintenances;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id;
  if not found then
    raise exception 'Manutenção não encontrada.' using errcode = 'no_data_found';
  end if;
  if auth.uid() is null or not private.has_permission(v_m.organization_id, 'maintenance.view')
     or not private.maintenance_in_scope(v_m.organization_id, v_m.operation_id, v_m.vehicle_id) then
    raise exception 'Você não possui permissão para esta consulta.' using errcode = 'insufficient_privilege';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'plan_id', p.id, 'code', p.code, 'title', p.title, 'detail_label', p.detail_label, 'status', p.status,
             'priority', p.priority, 'origin', l.origin, 'resolutive', l.resolutive, 'open_items', p.open_items,
             'occurrences', p.occurrences,
             'can_view', private.has_permission(p.organization_id, 'action_plans.view') and private.action_plan_in_scope(p))
           order by l.linked_at), '[]'::jsonb)
      from public.action_plan_maintenance_links l join public.action_plans p on p.id = l.plan_id
     where l.maintenance_id = p_maintenance_id and l.status = 'active');
end;
$$;

-- -----------------------------------------------------------------------------
-- 13d. Registro da exportação (auditoria) — sem registro não há arquivo
-- -----------------------------------------------------------------------------
create or replace function public.log_action_plan_export(
  p_organization_id uuid, p_format text, p_scope text, p_row_count integer, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_clean   jsonb := '{}'::jsonb;
  k text;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente para continuar.' using errcode = 'insufficient_privilege';
  end if;
  if not (private.has_permission(p_organization_id, 'action_plans.export')
          and private.has_permission(p_organization_id, 'action_plans.view')) then
    raise exception 'Você não possui permissão para exportar planos de ação.' using errcode = 'insufficient_privilege';
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') or p_scope not in ('plans', 'items') then
    raise exception 'Formato de exportação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'Quantidade de linhas inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(v_filters) <> 'object' then
    v_filters := '{}'::jsonb;
  end if;
  foreach k in array array['aba', 'de', 'ate', 'q', 'situacao', 'grupo', 'prioridade', 'operacao', 'uf', 'cidade', 'filial',
                           'br', 'lideranca', 'veiculo', 'tipo', 'cluster', 'pergunta', 'item', 'responsavel',
                           'sem_responsavel', 'manutencao', 'prazo', 'reincidente', 'frota', 'meus', 'ordenar', 'dir'] loop
    if nullif(v_filters ->> k, '') is not null then
      v_clean := v_clean || jsonb_build_object(k, left(v_filters ->> k, 120));
    end if;
  end loop;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, (select auth.uid()), 'action_plan_export', null, 'EXPORT',
          jsonb_build_object('format', p_format, 'scope', p_scope, 'row_count', p_row_count, 'filters', v_clean));
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Permissões de execução
-- -----------------------------------------------------------------------------
revoke execute on function
  private.action_plan_filtered(uuid, jsonb),
  private.action_plan_deadline(public.action_plans, date, integer),
  private.action_plan_row_json(public.action_plans, date, integer),
  private.action_plan_assert_view(uuid, text),
  private.action_plan_coverage(uuid)
from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.action_plan_list(uuid, jsonb, text, text, integer, integer)',
    'public.action_plan_groups(uuid, jsonb, text)',
    'public.action_plan_dashboard(uuid, jsonb)',
    'public.action_plan_detail(uuid)',
    'public.action_plan_maintenance_candidates(uuid)',
    'public.action_plan_reconciliation(uuid, jsonb, text, integer, integer)',
    'public.action_plan_mapping(uuid)',
    'public.action_plan_quality(uuid)',
    'public.action_plan_quality_fix(uuid)',
    'public.action_plan_health(uuid, integer)',
    'public.action_plan_my_view(uuid)',
    'public.action_plan_my_reports(uuid, integer)',
    'public.action_plan_vehicle(uuid)',
    'public.action_plan_checklist_history(uuid, jsonb, integer, integer)',
    'public.action_plan_execution_trace(uuid)',
    'public.action_plan_catalog(uuid)',
    'public.action_plan_followup_import(uuid, jsonb, boolean)',
    'public.action_plan_export_items(uuid, jsonb, integer, integer)',
    'public.action_plan_for_maintenance(uuid)',
    'public.log_action_plan_export(uuid, text, text, integer, jsonb)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
