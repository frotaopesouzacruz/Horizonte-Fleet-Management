-- =============================================================================
-- ADERÊNCIA · IMPORTAÇÃO DO HISTÓRICO DE CHECK LIST — PERGUNTA SEM RESPOSTA
--
-- Um arquivo que não traz coluna para alguma pergunta do formulário publicado
-- (o "11_Check List" do HFC tem 32 das 34 perguntas: faltam plataforma
-- hidráulica e controle auxiliar) derrubava TODA linha "Fez Check List" no
-- processamento: a rotina testava `v_ans not in ('yes','no')` com `v_ans`
-- nulo — em SQL isso não é verdadeiro nem falso — e tentava gravar a resposta
-- nula ("null value in column answer"). A pergunta sem resposta agora é
-- pulada, como a documentação sempre disse ("perguntas sem coluna ficam sem
-- resposta"). Mesma assinatura, mesma regra no resto.
-- =============================================================================
create or replace function private.checklist_history_create_execution(p_batch_id uuid, p_row public.import_rows)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n          jsonb := p_row.normalized_data;
  v_org      uuid := p_row.organization_id;
  v_app      record;
  v_version  record;
  v_vehicle  record;
  v_fleet    record;
  v_leader   uuid;
  v_op       uuid;
  v_date     date := (n ->> 'operational_date')::date;
  v_ctx      text := n ->> 'context';
  v_emp      record;
  v_started  timestamptz;
  v_exec     uuid;
  q          record;
  v_ans      text;
  v_cond     jsonb;
  v_applic   int := 0; v_answered int := 0; v_conf int := 0; v_nonconf int := 0; v_crit int := 0;
begin
  if exists (select 1 from public.checklist_executions e where e.organization_id = v_org and e.idempotency_key = n ->> 'idempotency_key') then
    return jsonb_build_object('status', 'skipped', 'code', 'already_imported');
  end if;
  if exists (select 1 from public.checklist_executions e
              where e.organization_id = v_org and e.vehicle_id = p_row.vehicle_id
                and e.operational_date = v_date and e.checklist_type = v_ctx and e.status = 'submitted') then
    return jsonb_build_object('status', 'skipped', 'code', 'already_done');
  end if;

  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  select v.* into v_version from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  if v_version.id is null then
    return jsonb_build_object('status', 'failed', 'code', 'no_version', 'message', 'O Check List de Frota nao possui versao publicada.');
  end if;

  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate, v.fleet_code, v.organization_unit_id
    into v_vehicle from public.vehicles v where v.id = p_row.vehicle_id;
  select e.id, e.employee_code, e.full_name into v_emp from public.employees e where e.id = (n ->> 'employee_id')::uuid;
  if v_emp.id is null then
    return jsonb_build_object('status', 'skipped', 'code', 'unknown_employee');
  end if;

  -- contexto operacional NA DATA: Fidelização → alocação do cadastro (§98, §99)
  select * into v_fleet from private.adherence_planned_fleet(v_org, v_date, null, v_vehicle.id) limit 1;
  v_op := v_fleet.operation_id;
  if v_op is null then
    select a.operation_id into v_op from public.vehicle_operation_assignments a
     where a.organization_id = v_org and a.vehicle_id = v_vehicle.id
     order by (a.effective_from <= v_date and (a.effective_to is null or a.effective_to >= v_date)) desc, a.effective_from desc
     limit 1;
  end if;
  if v_op is null then
    return jsonb_build_object('status', 'skipped', 'code', 'no_operation',
      'message', 'Veiculo sem operacao conhecida (Fidelizacao ou alocacao) nesta data; a execucao precisa de operacao.');
  end if;
  if v_fleet.operation_br_id is not null or v_fleet.operation_city_id is not null then
    select employee_id into v_leader from private.adherence_leader_at(v_fleet.operation_id, v_fleet.operation_city_id, v_fleet.operation_br_id, v_date);
  end if;

  v_started := private.adherence_local_ts(v_org, v_date, '06:00'::time, false);

  insert into public.checklist_executions (
    organization_id, app_id, version_id, user_id, employee_id,
    vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id, vehicle_subcategory_id,
    operation_id, state_id, city_id, operation_br_id, organization_unit_id, leader_employee_id,
    checklist_type, operational_date, started_at, status, idempotency_key,
    source, import_batch_id, employee_code_snapshot, employee_name_snapshot)
  values (
    v_org, v_app.id, v_version.id, auth.uid(), v_emp.id,
    v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id,
    v_op, v_fleet.state_id, v_fleet.city_id, v_fleet.operation_br_id, v_vehicle.organization_unit_id, v_leader,
    v_ctx, v_date, v_started, 'draft', n ->> 'idempotency_key',
    'import', p_batch_id, v_emp.employee_code, v_emp.full_name)
  returning id into v_exec;

  for q in
    select qu.id, qu.question_key, qu.question_text, qu.conforming_answer, qu.criticality, cl.cluster_key,
           cd.field_key, cd.trigger_answer,
           private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op) as applies
      from public.checklist_questions qu
      join public.checklist_clusters cl on cl.id = qu.cluster_id
      left join lateral (select k.field_key, k.trigger_answer from public.checklist_question_conditionals k
                          where k.question_id = qu.id order by k.sort_order limit 1) cd on true
     where qu.version_id = v_version.id and qu.status = 'active'
     order by cl.sort_order, qu.sort_order
  loop
    v_ans := n -> 'answers' ->> q.question_key;
    -- aplicável: o que a regra do formulário aplica a este veículo, exceto o que o
    -- arquivo marcou como N/A; o que foi respondido Sim/Não conta sempre.
    if v_ans in ('yes', 'no') or (q.applies and coalesce(v_ans, '') <> 'na') then
      v_applic := v_applic + 1;
    end if;
    -- sem resposta no arquivo (coluna ausente ou vazia) ou N/A: a pergunta fica sem resposta
    if v_ans is null or v_ans not in ('yes', 'no') then continue; end if;
    v_answered := v_answered + 1;
    v_cond := case when q.field_key is not null and v_ans = q.trigger_answer
                     and (n -> 'conditionals' -> q.question_key) is not null
                     and jsonb_typeof(n -> 'conditionals' -> q.question_key) <> 'null'
                   then n -> 'conditionals' -> q.question_key end;
    insert into public.checklist_execution_answers (
      organization_id, execution_id, version_id, question_id, question_key, cluster_key,
      question_text_snapshot, answer, is_conforming, criticality, conditional_value, note, answered_at)
    values (
      v_org, v_exec, v_version.id, q.id, q.question_key, q.cluster_key,
      q.question_text, v_ans, v_ans = q.conforming_answer, q.criticality, v_cond,
      nullif(btrim(coalesce(n -> 'notes' ->> q.question_key, '')), ''), v_started);
    if v_ans = q.conforming_answer then v_conf := v_conf + 1;
    else
      v_nonconf := v_nonconf + 1;
      if q.criticality = 'critica' then v_crit := v_crit + 1; end if;
    end if;
  end loop;

  insert into public.checklist_execution_clusters (
    organization_id, execution_id, cluster_id, cluster_key, cluster_name, sort_order,
    applicable_questions, answered_questions, non_conforming)
  select v_org, v_exec, cl.id, cl.cluster_key, cl.name, cl.sort_order,
         count(*) filter (where ans.id is not null or (private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op)
                                                      and coalesce(n -> 'answers' ->> qu.question_key, '') <> 'na')),
         count(ans.id), count(ans.id) filter (where ans.is_conforming = false)
    from public.checklist_questions qu
    join public.checklist_clusters cl on cl.id = qu.cluster_id
    left join public.checklist_execution_answers ans on ans.execution_id = v_exec and ans.question_id = qu.id
   where qu.version_id = v_version.id and qu.status = 'active'
   group by cl.id, cl.cluster_key, cl.name, cl.sort_order
  having count(ans.id) > 0 or bool_or(private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op));

  update public.checklist_executions
     set status = 'submitted', submitted_at = v_started, duration_seconds = 0,
         applicable_questions = v_applic, answered_questions = v_answered,
         conforming_answers = v_conf, non_conforming_answers = v_nonconf, critical_non_conforming = v_crit,
         updated_at = now()
   where id = v_exec;

  -- O mesmo evento do aplicativo: a Aderência concilia no BEFORE, os Planos de
  -- Ação ingerem no AFTER. Nenhum caminho paralelo.
  insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'checklist.execution.submitted', 'checklist_execution', v_exec,
          jsonb_build_object(
            'execution_id', v_exec, 'organization_id', v_org, 'vehicle_id', v_vehicle.id,
            'license_plate', v_vehicle.license_plate, 'operation_id', v_op, 'operation_br_id', v_fleet.operation_br_id,
            'employee_id', v_emp.id, 'checklist_type', v_ctx, 'operational_date', v_date, 'submitted_at', v_started,
            'version_id', v_version.id, 'version_label', v_version.label,
            'applicable_questions', v_applic, 'conforming', v_conf, 'non_conforming', v_nonconf,
            'critical_non_conforming', v_crit, 'execution_valid', true, 'source', 'import', 'import_batch_id', p_batch_id));

  return jsonb_build_object('status', 'created', 'execution_id', v_exec, 'answers', v_answered, 'non_conforming', v_nonconf);
end;
$$;
revoke execute on function private.checklist_history_create_execution(uuid, public.import_rows) from public, anon, authenticated;
