-- =============================================================================
-- HFM · Home por perfil — Início do Operacional v2
--
-- A Home do Operacional responde "o que preciso fazer agora?". Para isso a
-- rotina do Início (my_operational_home) passa a devolver, além do que já
-- devolvia (checklists, execuções do mês, apontamentos):
--
--   * today_actions — as obrigações de HOJE da própria pessoa (saída e
--     retorno da BR em que é motorista titular fidelizado, mais as
--     conciliadas com checklists que ela enviou hoje), com o status oficial
--     do Motor de Aderência (view adherence_obligation_status). Só com
--     adherence.view_own; sem a permissão, null.
--   * vehicle — o veículo fidelizado de hoje (placa, frota, tipo, modelo,
--     BR, operação, cidade, situação, hodômetro oficial), o último checklist
--     dele, os apontamentos em aberto (quando a conta vê apontamentos) e a
--     manutenção aberta, se houver. Sem fidelização vigente: null.
--   * pending — o que só a própria pessoa resolve: vistorias devolvidas ao
--     campo (MTSR "retornada", Pneus "retornar_divergencia") de sua autoria.
--   * recent — as últimas 5 atividades da pessoa (checklists, vistorias MTSR
--     e de pneus), para o "Histórico recente".
--   * apps — os aplicativos oficiais da organização e se cada um está
--     habilitado para a operação do vínculo da pessoa (a tela cruza com a
--     permissão de executar; app sem permissão ou desabilitado não aparece).
--
-- Mesma assinatura, mesmas permissões e mesmo contrato anterior (as chaves
-- antigas continuam): nenhum chamador quebra. Só leitura.
-- =============================================================================
create or replace function public.my_operational_home(
  p_organization_id uuid, p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_employee    uuid;
  v_operation   uuid;
  v_from        date;
  v_to          date;
  v_today       date;
  v_report_from date;
  v_checklists  jsonb;
  v_executions  jsonb := '[]'::jsonb;
  v_reports     jsonb;
  v_can_reports boolean := false;
  v_actions     jsonb;
  v_vehicle_id  uuid;
  v_br_id       uuid;
  v_vehicle     jsonb;
  v_pending     jsonb := '[]'::jsonb;
  v_recent      jsonb := '[]'::jsonb;
  v_apps        jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_year is null or p_month is null
     or p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;

  v_employee := private.portal_member(p_organization_id);

  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.view_own') then
    raise exception 'Você não tem autorização para consultar os próprios checklists.'
      using errcode = 'insufficient_privilege';
  end if;

  v_from  := make_date(p_year, p_month, 1);
  v_to    := (v_from + interval '1 month' - interval '1 day')::date;
  v_today := private.adherence_today(p_organization_id);
  v_can_reports := private.has_permission(p_organization_id, 'action_plans.view_own')
                   or private.has_permission(p_organization_id, 'action_plans.view');

  if v_employee is null then
    v_checklists := jsonb_build_object('total', 0, 'month_total', 0, 'last_30_days', 0,
                                       'last_submitted_at', null, 'last_date', null);
  else
    select a.operation_id into v_operation
      from public.employee_assignments a
     where a.employee_id = v_employee and a.organization_id = p_organization_id and a.is_current
     order by a.effective_from desc
     limit 1;

    select jsonb_build_object(
             'total',             count(*),
             'month_total',       count(*) filter (where e.operational_date between v_from and v_to),
             'last_30_days',      count(*) filter (where e.operational_date > v_today - 30 and e.operational_date <= v_today),
             'last_submitted_at', max(e.submitted_at),
             'last_date',         max(e.operational_date))
      into v_checklists
      from public.checklist_executions e
     where e.organization_id = p_organization_id
       and e.employee_id = v_employee
       and e.status = 'submitted';

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id,
             'date', x.operational_date,
             'context', x.checklist_type,
             'license_plate', x.license_plate_snapshot,
             'fleet_code', x.fleet_code_snapshot,
             'operation_name', op.name,
             'br_code', b.code,
             'started_at', x.started_at,
             'submitted_at', x.submitted_at,
             'duration_seconds', x.duration_seconds,
             'non_conforming', x.non_conforming_answers,
             'critical_non_conforming', x.critical_non_conforming,
             'source', x.source)
           order by x.operational_date, x.submitted_at), '[]'::jsonb)
      into v_executions
      from (
        select e.* from public.checklist_executions e
         where e.organization_id = p_organization_id
           and e.employee_id = v_employee
           and e.status = 'submitted'
           and e.operational_date between v_from and v_to
         order by e.operational_date, e.submitted_at
         limit 400
      ) x
      left join public.operations op on op.id = x.operation_id
      left join public.operation_brs b on b.id = x.operation_br_id;

    -- ------------------------------------------------------------------
    -- Ações de hoje: as obrigações oficiais da pessoa no dia operacional.
    -- Mesma regra de "Minha situação" (§63), recortada a hoje.
    -- ------------------------------------------------------------------
    if private.has_permission(p_organization_id, 'adherence.view_own') then
      with links as (
        select fa.operation_br_id, fa.vehicle_id
          from public.fidelization_drivers fd
          join public.fidelization_assignments fa
            on fa.organization_id = fd.organization_id and fa.id = fd.fidelization_assignment_id
         where fd.organization_id = p_organization_id
           and fd.employee_id = v_employee
           and fd.driver_role = 'primary'
           and fd.status <> 'cancelled'
           and fa.status <> 'cancelled'
           and fd.start_date <= v_today and coalesce(fd.end_date, 'infinity'::date) >= v_today
           and fa.start_date <= v_today and coalesce(fa.end_date, 'infinity'::date) >= v_today
      ),
      mine as (
        select m.obligation_id
          from public.checklist_obligation_matches m
          join public.checklist_executions e on e.id = m.execution_id
         where m.organization_id = p_organization_id
           and m.is_valid
           and e.employee_id = v_employee
           and e.status = 'submitted'
           and e.operational_date between v_today - 1 and v_today + 1
      ),
      obligations as (
        select s.*
          from public.adherence_obligation_status s
         where s.organization_id = p_organization_id
           and s.operational_date = v_today
           and (exists (select 1 from links l where l.operation_br_id = s.operation_br_id and l.vehicle_id = s.vehicle_id)
                or s.id in (select obligation_id from mine))
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'obligation_id', o.id,
               'context', o.checklist_context,
               'journey', o.journey_seq,
               'status', o.status_code,
               'due', o.is_due,
               'done', o.is_done,
               'excluded', o.is_excluded,
               'provisional', o.is_provisional,
               'pending_request', o.has_pending_request,
               'expected_at', o.expected_at,
               'deadline_at', o.deadline_at,
               'vehicle_id', o.vehicle_id,
               'license_plate', o.license_plate_snapshot,
               'fleet_code', o.fleet_code_snapshot,
               'br_code', br.code,
               'operation_name', op.name,
               'city_name', c.name)
             order by o.journey_seq, case o.checklist_context when 'saida' then 0 else 1 end, br.code), '[]'::jsonb)
        into v_actions
        from obligations o
        left join public.operation_brs br on br.id = o.operation_br_id
        left join public.operations op on op.id = o.operation_id
        left join public.cities c on c.id = o.city_id;
    end if;

    -- ------------------------------------------------------------------
    -- Meu veículo: a fidelização vigente de hoje (motorista titular).
    -- ------------------------------------------------------------------
    select fa.vehicle_id, fa.operation_br_id into v_vehicle_id, v_br_id
      from public.fidelization_drivers fd
      join public.fidelization_assignments fa
        on fa.organization_id = fd.organization_id and fa.id = fd.fidelization_assignment_id
      join public.operation_brs br on br.id = fa.operation_br_id
     where fd.organization_id = p_organization_id
       and fd.employee_id = v_employee
       and fd.driver_role = 'primary'
       and fd.status <> 'cancelled'
       and fa.status <> 'cancelled'
       and fd.start_date <= v_today and coalesce(fd.end_date, 'infinity'::date) >= v_today
       and fa.start_date <= v_today and coalesce(fa.end_date, 'infinity'::date) >= v_today
     order by fd.start_date desc, br.code
     limit 1;

    if v_vehicle_id is not null then
      select jsonb_build_object(
               'id', v.id,
               'license_plate', v.license_plate,
               'fleet_code', v.fleet_code,
               'type_name', vt.name,
               'model_name', vmo.name,
               'status', v.status,
               'br_code', br.code,
               'operation_name', op.name,
               'city_name', c.name,
               'uf', st.uf,
               'odometer_km', o.odometer_km,
               'odometer_date', o.reading_date,
               'last_checklist', (select jsonb_build_object('date', x.operational_date, 'context', x.checklist_type,
                                                            'submitted_at', x.submitted_at, 'mine', x.employee_id = v_employee)
                                    from public.checklist_executions x
                                   where x.organization_id = p_organization_id and x.vehicle_id = v.id and x.status = 'submitted'
                                   order by x.operational_date desc, x.submitted_at desc
                                   limit 1),
               'open_reports', case when v_can_reports then
                                 (select count(*) from public.action_plan_items i
                                   where i.organization_id = p_organization_id and i.vehicle_id = v.id
                                     and i.status in ('pending', 'in_maintenance', 'needs_action'))
                               end,
               'maintenance', (select jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status,
                                                         'scheduled_date', m.scheduled_date, 'entry_date', m.entry_date,
                                                         'expected_exit_date', m.expected_exit_date)
                                 from public.maintenances m
                                where m.organization_id = p_organization_id and m.vehicle_id = v.id
                                  and m.status in ('to_schedule', 'scheduled', 'in_progress')
                                order by case m.status when 'in_progress' then 0 when 'scheduled' then 1 else 2 end,
                                         m.scheduled_date nulls last, m.created_at desc
                                limit 1))
        into v_vehicle
        from public.vehicles v
        join public.vehicle_types vt on vt.id = v.vehicle_type_id
        left join public.vehicle_models vmo on vmo.id = v.vehicle_model_id
        left join public.operation_brs br on br.id = v_br_id
        left join public.operations op on op.id = br.operation_id
        left join public.cities c on c.id = br.city_id
        left join public.states st on st.id = br.state_id
        left join lateral (
          select r.odometer_km, r.reading_date
            from public.vehicle_odometer_readings r
           where r.vehicle_id = v.id
           order by r.reading_date desc, r.created_at desc
           limit 1
        ) o on true
       where v.id = v_vehicle_id;
    end if;

    -- ------------------------------------------------------------------
    -- Pendências que só a pessoa resolve: vistorias devolvidas ao campo.
    -- ------------------------------------------------------------------
    select coalesce(jsonb_agg(p.val order by p.sort desc), '[]'::jsonb)
      into v_pending
      from (
        select i.submitted_at as sort,
               jsonb_build_object('kind', 'mtsr', 'id', i.id, 'protocol', i.protocol,
                                  'license_plate', i.license_plate_snapshot, 'date', i.inspection_date,
                                  'status', i.status, 'reason', i.review_reason, 'reviewed_at', i.reviewed_at) as val
          from public.mtsr_inspections i
         where i.organization_id = p_organization_id
           and i.status = 'retornada'
           and (i.inspector_employee_id = v_employee or i.inspector_user_id = v_uid)
        union all
        select t.submitted_at,
               jsonb_build_object('kind', 'tires', 'id', t.id, 'protocol', t.protocol,
                                  'license_plate', t.license_plate_snapshot, 'date', t.inspection_date,
                                  'status', t.status, 'reason', t.review_note, 'reviewed_at', t.reviewed_at)
          from public.tire_inspections t
         where t.organization_id = p_organization_id
           and t.status = 'retornar_divergencia'
           and (t.inspector_employee_id = v_employee or t.inspector_user_id = v_uid)
      ) p;

    -- ------------------------------------------------------------------
    -- Histórico recente: as últimas 5 atividades da pessoa.
    -- ------------------------------------------------------------------
    select coalesce(jsonb_agg(r.val order by r.sort desc), '[]'::jsonb)
      into v_recent
      from (
        select * from (
          select e.submitted_at as sort,
                 jsonb_build_object('kind', 'checklist', 'id', e.id, 'date', e.operational_date,
                                    'submitted_at', e.submitted_at, 'license_plate', e.license_plate_snapshot,
                                    'context', e.checklist_type, 'status', 'submitted',
                                    'non_conforming', e.non_conforming_answers) as val
            from public.checklist_executions e
           where e.organization_id = p_organization_id and e.employee_id = v_employee and e.status = 'submitted'
           order by e.submitted_at desc nulls last
           limit 5
        ) a
        union all
        select * from (
          select i.submitted_at,
                 jsonb_build_object('kind', 'mtsr', 'id', i.id, 'date', i.inspection_date,
                                    'submitted_at', i.submitted_at, 'license_plate', i.license_plate_snapshot,
                                    'protocol', i.protocol, 'status', i.status)
            from public.mtsr_inspections i
           where i.organization_id = p_organization_id
             and (i.inspector_employee_id = v_employee or i.inspector_user_id = v_uid)
           order by i.submitted_at desc
           limit 5
        ) b
        union all
        select * from (
          select t.submitted_at,
                 jsonb_build_object('kind', 'tires', 'id', t.id, 'date', t.inspection_date,
                                    'submitted_at', t.submitted_at, 'license_plate', t.license_plate_snapshot,
                                    'protocol', t.protocol, 'status', t.status)
            from public.tire_inspections t
           where t.organization_id = p_organization_id
             and (t.inspector_employee_id = v_employee or t.inspector_user_id = v_uid)
           order by t.submitted_at desc
           limit 5
        ) c
        order by sort desc nulls last
        limit 5
      ) r;

    -- ------------------------------------------------------------------
    -- Aplicativos da organização e se valem para a operação do vínculo.
    -- ------------------------------------------------------------------
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'slug', a.slug, 'name', a.name,
             'enabled', case when v_operation is null then null
                             else private.app_operation_enabled(a.id, v_operation, v_today) end)
           order by a.name), '[]'::jsonb)
      into v_apps
      from public.operational_apps a
     where a.organization_id = p_organization_id
       and a.deleted_at is null
       and a.is_active;
  end if;

  if v_can_reports then
    v_report_from := private.maintenance_today(p_organization_id) - 90;
    select jsonb_build_object(
             'window_days',   90,
             'total',         count(*),
             'open',          count(*) filter (where i.status in ('pending', 'in_maintenance', 'needs_action')),
             'resolved',      count(*) filter (where i.status in ('resolved', 'resolved_without_maintenance')),
             'closed_other',  count(*) filter (where i.status in ('improper', 'cancelled')))
      into v_reports
      from public.action_plan_items i
      join public.action_plans p on p.id = i.plan_id
     where i.organization_id = p_organization_id
       and i.operational_date >= v_report_from
       and ((v_employee is not null and i.employee_id = v_employee) or i.user_id = v_uid)
       and coalesce((select prm.driver_visible from public.checklist_action_parameters prm
                      where prm.organization_id = p.organization_id and prm.app_id = p.app_id
                        and prm.question_key = p.question_key and prm.field_key is null), true);
  end if;

  return jsonb_build_object(
    'today', v_today,
    'year', p_year, 'month', p_month, 'date_from', v_from, 'date_to', v_to,
    'employee', case when v_employee is null then null else private.portal_identity(p_organization_id, v_employee) end,
    'operation_id', v_operation,
    'checklists', v_checklists,
    'executions', v_executions,
    'executions_truncated', coalesce((v_checklists ->> 'month_total')::int, 0) > jsonb_array_length(v_executions),
    'reports', v_reports,
    'today_actions', v_actions,
    'vehicle', v_vehicle,
    'pending', v_pending,
    'recent', v_recent,
    'apps', v_apps);
end;
$$;

comment on function public.my_operational_home(uuid, integer, integer) is
  'Pós-login (Operacional): checklists do colaborador da conta (total, mês, último), os do mês para o '
  'calendário, os próprios apontamentos (90 dias), as obrigações de hoje (adherence.view_own), o veículo '
  'fidelizado de hoje, vistorias devolvidas ao campo, as 5 últimas atividades e os aplicativos habilitados '
  'para a operação do vínculo. Exige applications.checklist_fleet.view_own. Só leitura.';

revoke all on function public.my_operational_home(uuid, integer, integer) from public, anon;
grant execute on function public.my_operational_home(uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- public.my_apps(uuid)
-- Os aplicativos oficiais da organização e se cada um vale para a operação do
-- vínculo da própria pessoa — a mesma resposta do Início, para a tela
-- "Aplicativos" (índice) sem carregar o Início inteiro. A permissão de
-- executar cada app continua na matriz RBAC; a tela cruza as duas coisas.
-- -----------------------------------------------------------------------------
create or replace function public.my_apps(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee  uuid;
  v_operation uuid;
  v_today     date;
begin
  if not private.has_permission(p_organization_id, 'applications.view') then
    raise exception 'Você não tem autorização para consultar os aplicativos.'
      using errcode = 'insufficient_privilege';
  end if;

  v_employee := private.portal_member(p_organization_id);
  v_today    := private.adherence_today(p_organization_id);

  if v_employee is not null then
    select a.operation_id into v_operation
      from public.employee_assignments a
     where a.employee_id = v_employee and a.organization_id = p_organization_id and a.is_current
     order by a.effective_from desc
     limit 1;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', a.code, 'slug', a.slug, 'name', a.name,
             'enabled', case when v_operation is null then null
                             else private.app_operation_enabled(a.id, v_operation, v_today) end)
           order by a.name), '[]'::jsonb)
      from public.operational_apps a
     where a.organization_id = p_organization_id
       and a.deleted_at is null
       and a.is_active);
end;
$$;

comment on function public.my_apps(uuid) is
  'Aplicativos oficiais da organização e se cada um está habilitado para a operação do vínculo da própria '
  'pessoa (null sem operação no vínculo). Exige applications.view. Só leitura.';

revoke all on function public.my_apps(uuid) from public, anon;
grant execute on function public.my_apps(uuid) to authenticated;
