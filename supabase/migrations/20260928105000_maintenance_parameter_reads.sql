-- =============================================================================
-- Etapa 16 — Manutenção · leituras de parâmetros e apontamentos do Check List
--
-- Aditiva: só cria funções de leitura. Nada aqui grava.
--
-- 1. maintenance_parameters — as regras preventivas e os planos técnicos
--    preditivos (com itens, cobertura e versões) já com os nomes oficiais de
--    tipo, subcategoria, marca, modelo, cluster e serviço. A tela de Cadastros
--    lê por aqui em vez de embutir relações pela API, e o escopo é o mesmo da
--    RLS: quem tem maintenance.view na organização.
-- 2. maintenance_vehicle_findings — os apontamentos inconformes do Check List
--    de um veículo numa janela de dias, com as manutenções que já os tratam e
--    os serviços sugeridos pelo mapeamento Serviços × Check List (a mesma
--    relação que o Plano de Ação vai usar). Permissão e escopo do veículo são
--    conferidos pela mesma função das mutações de frota.
-- 3. maintenance_checklist_questions — as perguntas do Check List por
--    aplicativo, para o editor do mapeamento Serviços × Check List.
-- 4. private.maintenance_filtered ganha a chave `queue` (agendadas hoje,
--    atrasadas para entrada, previsão de saída vencida, vencidas sem
--    agendamento, acima do SLA, concluídas hoje) com as definições exatas de
--    maintenance_schedule_kpis. Substituição compatível, não destrutiva.
-- 5. log_maintenance_export — auditoria da exportação da base.
-- =============================================================================

create or replace function public.maintenance_parameters(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.has_permission(p_organization_id, 'maintenance.view') then
    jsonb_build_object('preventive_rules', '[]'::jsonb, 'predictive_plans', '[]'::jsonb)
  else jsonb_build_object(
    'preventive_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'vehicle_type_id', r.vehicle_type_id, 'vehicle_type_name', t.name,
               'vehicle_subcategory_id', r.vehicle_subcategory_id, 'vehicle_subcategory_name', sc.name,
               'vehicle_model_id', r.vehicle_model_id, 'vehicle_model_name', vm.name,
               'service_id', r.service_id, 'service_name', s.name,
               'interval_km', r.interval_km, 'initial_km', r.initial_km, 'cycle_count', r.cycle_count,
               'alert_before_pct', r.alert_before_pct, 'tolerance_after_pct', r.tolerance_after_pct,
               'criticality', r.criticality, 'status', r.status, 'notes', r.notes,
               'vehicles', (select count(distinct c.vehicle_id) from public.maintenance_preventive_cycles c
                             where c.organization_id = r.organization_id and c.rule_id = r.id),
               'updated_at', r.updated_at)
             order by t.name, sc.name nulls first, vm.name nulls first)
        from public.maintenance_preventive_rules r
        join public.vehicle_types t on t.id = r.vehicle_type_id
        left join public.vehicle_subcategories sc on sc.id = r.vehicle_subcategory_id
        left join public.vehicle_models vm on vm.id = r.vehicle_model_id
        left join public.maintenance_services s on s.organization_id = r.organization_id and s.id = r.service_id
       where r.organization_id = p_organization_id and r.deleted_at is null), '[]'::jsonb),
    'predictive_plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description,
               'vehicle_type_id', p.vehicle_type_id, 'vehicle_type_name', t.name,
               'vehicle_subcategory_id', p.vehicle_subcategory_id, 'vehicle_subcategory_name', sc.name,
               'vehicle_make_id', p.vehicle_make_id, 'vehicle_make_name', mk.name,
               'vehicle_model_id', p.vehicle_model_id, 'vehicle_model_name', vm.name,
               'year_from', p.year_from, 'year_to', p.year_to, 'source', p.source,
               'reference_document', p.reference_document, 'oem_reference', p.oem_reference,
               'version', p.version, 'approval_status', p.approval_status, 'approved_at', p.approved_at,
               'approved_by_name', private.org_member_name(p.organization_id, p.approved_by),
               'is_active', p.is_active, 'notes', p.notes, 'updated_at', p.updated_at,
               'vehicles', (select count(distinct c.vehicle_id) from public.maintenance_predictive_cycles c
                             where c.organization_id = p.organization_id and c.plan_id = p.id and c.is_active),
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', i.id, 'cluster_id', i.cluster_id, 'cluster_name', cl.name,
                          'service_id', i.service_id, 'service_name', sv.name,
                          'name', i.name, 'technical_description', i.technical_description,
                          'interval_km', i.interval_km, 'interval_days', i.interval_days,
                          'interval_engine_hours', i.interval_engine_hours,
                          'alert_pct', i.alert_pct, 'schedule_pct', i.schedule_pct, 'tolerance_pct', i.tolerance_pct,
                          'criticality', i.criticality, 'sort_order', i.sort_order, 'is_active', i.is_active,
                          'checklist', i.checklist,
                          'coverage', coalesce((
                            select jsonb_agg(jsonb_build_object('service_id', cv.service_id, 'service_name', cs.name,
                                                                'coverage', cv.coverage) order by cs.name)
                              from public.maintenance_predictive_coverage cv
                              join public.maintenance_services cs on cs.organization_id = cv.organization_id and cs.id = cv.service_id
                             where cv.organization_id = i.organization_id and cv.plan_item_id = i.id), '[]'::jsonb))
                        order by i.sort_order, i.name)
                   from public.maintenance_predictive_plan_items i
                   join public.maintenance_clusters cl on cl.organization_id = i.organization_id and cl.id = i.cluster_id
                   left join public.maintenance_services sv on sv.organization_id = i.organization_id and sv.id = i.service_id
                  where i.organization_id = p.organization_id and i.plan_id = p.id), '[]'::jsonb),
               'versions', coalesce((
                 select jsonb_agg(jsonb_build_object('version', v.version, 'approval_status', v.approval_status,
                                                     'reason', v.reason, 'created_at', v.created_at,
                                                     'created_by_name', private.org_member_name(v.organization_id, v.created_by))
                                  order by v.version desc)
                   from public.maintenance_predictive_plan_versions v
                  where v.organization_id = p.organization_id and v.plan_id = p.id), '[]'::jsonb))
             order by p.is_active desc, p.name)
        from public.maintenance_predictive_plans p
        join public.vehicle_types t on t.id = p.vehicle_type_id
        left join public.vehicle_subcategories sc on sc.id = p.vehicle_subcategory_id
        left join public.vehicle_makes mk on mk.id = p.vehicle_make_id
        left join public.vehicle_models vm on vm.id = p.vehicle_model_id
       where p.organization_id = p_organization_id and p.deleted_at is null), '[]'::jsonb))
  end;
$$;

comment on function public.maintenance_parameters(uuid) is
  'Regras preventivas e planos técnicos preditivos (itens, cobertura, versões) com nomes oficiais. Leitura para a aba Cadastros; exige maintenance.view.';

create or replace function public.maintenance_vehicle_findings(p_vehicle_id uuid, p_days integer default 60)
returns jsonb
language plpgsql
-- Volátil: chama private.assert_vehicle_access, que é volátil.
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_from date;
begin
  -- Mesma porta das mutações: permissão E escopo por operação do veículo.
  v_org := private.assert_vehicle_access(p_vehicle_id, 'maintenance.view', false);
  v_from := private.maintenance_today(v_org) - least(greatest(coalesce(p_days, 60), 1), 365);

  return coalesce((
    select jsonb_agg(f order by f ->> 'operational_date' desc, f ->> 'question_text')
      from (
        select jsonb_build_object(
                 'answer_id', a.id, 'execution_id', e.id, 'app_id', e.app_id,
                 'operational_date', e.operational_date, 'submitted_at', e.submitted_at,
                 'checklist_type', e.checklist_type,
                 'question_key', a.question_key, 'cluster_key', a.cluster_key,
                 'question_text', a.question_text_snapshot, 'answer', a.answer,
                 'criticality', a.criticality, 'note', a.note,
                 'links', coalesce((
                   select jsonb_agg(jsonb_build_object('link_id', l.id, 'maintenance_id', m.id, 'code', m.code,
                                                       'status', m.status, 'resolution_status', l.resolution_status)
                                    order by m.created_at desc)
                     from public.maintenance_finding_links l
                     join public.maintenances m on m.id = l.maintenance_id
                    where l.organization_id = v_org and l.checklist_answer_id = a.id), '[]'::jsonb),
                 'suggested_service_ids', coalesce((
                   select jsonb_agg(distinct k.service_id)
                     from public.maintenance_checklist_service_links k
                     join public.maintenance_services s on s.organization_id = k.organization_id and s.id = k.service_id
                    where k.organization_id = v_org and k.app_id = e.app_id and k.question_key = a.question_key
                      and k.is_active and s.status = 'active' and s.deleted_at is null
                      and (k.field_key is null
                           or (a.conditional_value is not null and a.conditional_value ? k.field_key))), '[]'::jsonb)) as f
          from public.checklist_executions e
          join public.checklist_execution_answers a on a.execution_id = e.id
         where e.organization_id = v_org and e.vehicle_id = p_vehicle_id
           and e.status = 'submitted' and e.operational_date >= v_from
           and not a.is_conforming
      ) x), '[]'::jsonb);
end;
$$;

comment on function public.maintenance_vehicle_findings(uuid, integer) is
  'Apontamentos inconformes do Check List do veículo na janela (padrão 60 dias), com as manutenções vinculadas e os serviços sugeridos pelo mapeamento Serviços × Check List. Exige maintenance.view e o veículo no escopo.';

-- 3. Perguntas do Check List para o mapeamento Serviços × Check List: por
--    aplicativo, a chave estável da pergunta (que atravessa versões) com o
--    texto e os campos condicionais da versão mais recente em que aparece.
create or replace function public.maintenance_checklist_questions(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not (private.has_permission(p_organization_id, 'maintenance.manage_services')
                        or private.has_permission(p_organization_id, 'maintenance.view')) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'app_id', q.app_id, 'app_name', q.app_name, 'question_key', q.question_key,
             'question_text', q.question_text, 'cluster_name', q.cluster_name, 'version_label', q.version_label,
             'fields', q.fields)
           order by q.app_name, q.cluster_sort, q.sort_order, q.question_key)
      from (
        select distinct on (v.app_id, qu.question_key)
               v.app_id, a.name as app_name, qu.question_key, qu.question_text, qu.sort_order,
               cl.name as cluster_name, cl.sort_order as cluster_sort, v.label as version_label,
               coalesce((select jsonb_agg(jsonb_build_object('field_key', c.field_key, 'label', c.label) order by c.sort_order)
                           from public.checklist_question_conditionals c where c.question_id = qu.id), '[]'::jsonb) as fields
          from public.checklist_questions qu
          join public.checklist_app_versions v on v.id = qu.version_id
          join public.operational_apps a on a.id = v.app_id
          left join public.checklist_clusters cl on cl.id = qu.cluster_id
         where qu.organization_id = p_organization_id and v.status in ('published', 'archived')
         order by v.app_id, qu.question_key, (v.status = 'published') desc, v.major desc, v.minor desc
      ) q), '[]'::jsonb)
  end;
$$;

comment on function public.maintenance_checklist_questions(uuid) is
  'Perguntas do Check List por aplicativo (chave estável + texto e campos condicionais da versão mais recente) para o mapeamento Serviços × Check List.';

-- 4. Filtro de fila da Programação (chave `queue`), somado ao filtro comum.
--    Mesma assinatura e mesmas chaves de antes: só acrescenta a condição.
create or replace function private.maintenance_filtered(p_organization_id uuid, p_filters jsonb)
returns setof public.maintenances
language sql
stable
set search_path = ''
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'search'), '')                    as search,
           private.jsonb_text_array(p_filters -> 'statuses')           as statuses,
           private.jsonb_text_array(p_filters -> 'types')              as types,
           private.jsonb_uuid_array(p_filters -> 'origin_ids')         as origin_ids,
           private.jsonb_text_array(p_filters -> 'priorities')         as priorities,
           private.jsonb_uuid_array(p_filters -> 'vehicle_ids')        as vehicle_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids')   as vehicle_type_ids,
           private.jsonb_uuid_array(p_filters -> 'operation_ids')      as operation_ids,
           private.jsonb_int_array(p_filters -> 'state_ids')           as state_ids,
           private.jsonb_int_array(p_filters -> 'city_ids')            as city_ids,
           private.jsonb_uuid_array(p_filters -> 'br_ids')             as br_ids,
           private.jsonb_uuid_array(p_filters -> 'leader_ids')         as leader_ids,
           private.jsonb_uuid_array(p_filters -> 'unit_ids')           as unit_ids,
           private.jsonb_uuid_array(p_filters -> 'supplier_ids')       as supplier_ids,
           private.jsonb_uuid_array(p_filters -> 'cluster_ids')        as cluster_ids,
           private.jsonb_uuid_array(p_filters -> 'service_ids')        as service_ids,
           private.jsonb_text_array(p_filters -> 'km_statuses')        as km_statuses,
           nullif(p_filters ->> 'date_from', '')::date                 as date_from,
           nullif(p_filters ->> 'date_to', '')::date                   as date_to,
           coalesce(nullif(p_filters ->> 'fleet_status', ''), 'all')   as fleet_status,
           coalesce((p_filters ->> 'open_only')::boolean, false)       as open_only,
           nullif(p_filters ->> 'queue', '')                           as queue,
           private.maintenance_today(p_organization_id)                as today,
           coalesce((select s.schedule_overdue_days from public.maintenance_settings s
                      where s.organization_id = p_organization_id), 5) as overdue_days,
           coalesce((select s.default_sla_hours from public.maintenance_settings s
                      where s.organization_id = p_organization_id), 72) as sla_default
  )
  select m.*
    from public.maintenances m
    cross join f
   where m.organization_id = p_organization_id
     and (f.search is null
          or m.code ilike '%' || f.search || '%'
          or m.license_plate_snapshot ilike '%' || private.normalize_plate(f.search) || '%'
          or coalesce(m.fleet_code_snapshot, '') ilike '%' || f.search || '%'
          or coalesce(m.service_order_number, '') ilike '%' || f.search || '%')
     and (f.statuses is null or m.status = any (f.statuses))
     and (f.types is null or m.maintenance_type_code = any (f.types))
     and (f.origin_ids is null or m.origin_id = any (f.origin_ids))
     and (f.priorities is null or m.priority = any (f.priorities))
     and (f.vehicle_ids is null or m.vehicle_id = any (f.vehicle_ids))
     and (f.vehicle_type_ids is null or m.vehicle_type_id = any (f.vehicle_type_ids))
     and (f.operation_ids is null or m.operation_id = any (f.operation_ids))
     and (f.state_ids is null or m.state_id = any (f.state_ids))
     and (f.city_ids is null or m.city_id = any (f.city_ids))
     and (f.br_ids is null or m.operation_br_id = any (f.br_ids))
     and (f.leader_ids is null or m.leader_employee_id = any (f.leader_ids))
     and (f.unit_ids is null or m.organization_unit_id = any (f.unit_ids))
     and (f.supplier_ids is null or m.supplier_id = any (f.supplier_ids))
     and (f.km_statuses is null or m.entry_km_status = any (f.km_statuses))
     and (f.cluster_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.cluster_id = any (f.cluster_ids)))
     and (f.service_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.service_id = any (f.service_ids)))
     and (f.date_from is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) >= f.date_from)
     and (f.date_to is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) <= f.date_to)
     and (not f.open_only or m.status in ('to_schedule', 'scheduled', 'in_progress'))
     and (f.fleet_status = 'all'
          or (f.fleet_status = 'active') = private.maintenance_vehicle_active(m.vehicle_id))
     -- Filas da Programação: as mesmas definições de maintenance_schedule_kpis,
     -- para que o cartão e a lista que ele abre contem a mesma coisa.
     and (f.queue is null or case f.queue
           when 'scheduled_today' then m.status = 'scheduled' and m.scheduled_date = f.today
           when 'late_entry' then m.status = 'scheduled' and m.scheduled_date < f.today
           when 'exit_overdue' then m.status = 'in_progress' and m.expected_exit_date < f.today
           when 'unscheduled_overdue' then m.status = 'to_schedule' and m.requested_on <= f.today - f.overdue_days
           when 'completed_today' then m.status = 'completed' and m.exit_date = f.today
           when 'over_sla' then m.status = 'in_progress'
             and extract(epoch from (private.maintenance_now(p_organization_id)
                                     - (m.entry_date + coalesce(m.entry_time, time '00:00')))) / 3600
                 > coalesce((select sum(s.expected_hours) from public.maintenance_items i
                               join public.maintenance_services s on s.id = i.service_id
                              where i.maintenance_id = m.id and i.status <> 'cancelled'), f.sla_default)
           else true end);
$$;

revoke all on function public.maintenance_checklist_questions(uuid) from public, anon;
grant execute on function public.maintenance_checklist_questions(uuid) to authenticated, service_role;
revoke all on function public.maintenance_parameters(uuid) from public, anon;
revoke all on function public.maintenance_vehicle_findings(uuid, integer) from public, anon;
grant execute on function public.maintenance_parameters(uuid) to authenticated, service_role;
grant execute on function public.maintenance_vehicle_findings(uuid, integer) to authenticated, service_role;

-- 5. Auditoria da exportação: sem registro, o arquivo não sai (mesmo contrato
--    das demais exportações do HFM).
create or replace function public.log_maintenance_export(
  p_organization_id uuid,
  p_format          text,
  p_row_count       integer,
  p_filters         jsonb default '{}'::jsonb
)
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
  if not (private.has_permission(p_organization_id, 'maintenance.export')
          and private.has_permission(p_organization_id, 'maintenance.view')) then
    raise exception 'Você não possui permissão para exportar manutenções.' using errcode = 'insufficient_privilege';
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') then
    raise exception 'Formato de exportação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'Quantidade de linhas inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(v_filters) <> 'object' then
    v_filters := '{}'::jsonb;
  end if;
  -- Só os filtros da tela, e curtos: a auditoria não é depósito de texto livre.
  foreach k in array array['aba', 'de', 'ate', 'q', 'situacao', 'tipo', 'origem', 'prioridade', 'equipamento', 'operacao',
                           'uf', 'cidade', 'br', 'lideranca', 'filial', 'fornecedor', 'cluster', 'servico', 'veiculo',
                           'km', 'frota', 'fila', 'ordenar', 'dir'] loop
    if nullif(v_filters ->> k, '') is not null then
      v_clean := v_clean || jsonb_build_object(k, left(v_filters ->> k, 120));
    end if;
  end loop;

  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, (select auth.uid()), 'maintenance_export', null, 'EXPORT',
          jsonb_build_object('format', p_format, 'row_count', p_row_count, 'filters', v_clean));
end;
$$;

comment on function public.log_maintenance_export(uuid, text, integer, jsonb) is
  'Registra a exportação da base de manutenções (formato, linhas, filtros da tela) em audit_logs. Exige maintenance.view e maintenance.export.';
revoke all on function public.log_maintenance_export(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.log_maintenance_export(uuid, text, integer, jsonb) to authenticated, service_role;
