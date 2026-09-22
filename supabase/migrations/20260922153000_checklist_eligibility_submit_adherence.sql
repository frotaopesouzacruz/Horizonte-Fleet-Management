-- =============================================================================
-- Refinamento da Etapa 12 — a elegibilidade chega ao envio e à Aderência
--
-- 1. `submit_checklist_execution` confere `private.app_vehicle_eligible` antes
--    de gravar (§23, §38): operação habilitada, tipo habilitado, veículo na
--    operação na data, situação ativa. A lista do executor e o envio obedecem
--    à MESMA rotina — não há como enviar o que a lista não mostraria.
--
-- 2. `private.adherence_expected` só espera checklist de veículo cujo tipo e
--    cuja operação estejam habilitados para o aplicativo NA DATA (§44–§46).
--    Nada do passado é apagado: a geração é por período e a aposentadoria
--    nunca alcança obrigação com execução conciliada ou solicitação em curso.
-- =============================================================================

create or replace function public.submit_checklist_execution(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     record;
  v_key       text := nullif(btrim(coalesce(p_payload ->> 'idempotency_key', '')), '');
  v_vehicle   record;
  v_op        uuid := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_type      text := nullif(p_payload ->> 'checklist_type', '');
  v_date      date := coalesce(nullif(p_payload ->> 'operational_date', '')::date, current_date);
  v_started   timestamptz := coalesce(nullif(p_payload ->> 'started_at', '')::timestamptz, now());
  v_answers   jsonb := coalesce(p_payload -> 'answers', '[]'::jsonb);
  v_app       record;
  v_version   record;
  v_form_ver  uuid := nullif(p_payload ->> 'version_id', '')::uuid;
  v_form      record;
  v_exec      uuid;
  v_existing  record;
  v_br        record;
  v_leader    uuid;
  v_duration  integer;
  r           record;
  a           jsonb;
  v_applic    int := 0;
  v_answered  int := 0;
  v_conf      int := 0;
  v_nonconf   int := 0;
  v_crit      int := 0;
  v_faltando  text := '';
begin
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.execute') then
    raise exception 'Você não possui permissão para executar o Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_key is null then
    raise exception 'A execução precisa de uma chave de idempotência.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_type not in ('saida', 'retorno') then
    raise exception 'Tipo de checklist inválido: %.', coalesce(v_type, '(vazio)')
      using errcode = 'invalid_parameter_value';
  end if;

  -- §52: reenvio da MESMA chave devolve o primeiro resultado. O motorista que
  -- perdeu a rede e tocou de novo não pode produzir um segundo checklist.
  select e.id, e.status, e.submitted_at, e.applicable_questions, e.conforming_answers,
         e.non_conforming_answers, e.critical_non_conforming
    into v_existing
    from public.checklist_executions e
   where e.organization_id = p_organization_id and e.idempotency_key = v_key;

  if v_existing.id is not null and v_existing.status = 'submitted' then
    return jsonb_build_object(
      'execution_id', v_existing.id, 'duplicate', true, 'status', 'submitted',
      'submitted_at', v_existing.submitted_at,
      'applicable', v_existing.applicable_questions,
      'conforming', v_existing.conforming_answers,
      'non_conforming', v_existing.non_conforming_answers,
      'critical_non_conforming', v_existing.critical_non_conforming);
  end if;

  select * into v_actor from private.checklist_actor(p_organization_id);
  if v_actor.employee_id is null then
    raise exception 'A sua conta não está vinculada a um colaborador desta organização.'
      using errcode = 'insufficient_privilege';
  end if;

  if not private.can_access_operation(v_op) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate,
         v.fleet_code, v.organization_unit_id
    into v_vehicle
    from public.vehicles v
   where v.id = nullif(p_payload ->> 'vehicle_id', '')::uuid
     and v.organization_id = p_organization_id and v.deleted_at is null;

  if v_vehicle.id is null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_vehicle.id) then
    raise exception 'Este veículo não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  select a2.id, a2.name into v_app
    from public.operational_apps a2
   where a2.organization_id = p_organization_id and a2.slug = 'check-list-frota'
     and a2.deleted_at is null;

  -- §23, §38: a combinação aplicativo × operação × tipo × veículo é conferida
  -- de novo no envio. Requisição alterada com veículo fora da lista é recusada.
  if not private.app_vehicle_eligible(p_organization_id, v_app.id, v_vehicle.id, v_op, v_date) then
    raise exception 'Este veículo não está disponível para o Check List de Frota nesta operação.'
      using errcode = 'insufficient_privilege';
  end if;

  select v.* into v_version
    from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc limit 1;

  if v_version.id is null then
    raise exception 'O Check List de Frota ainda não possui versão publicada.'
      using errcode = 'no_data_found';
  end if;

  -- §48: o formulário já iniciado continua na versão em que foi aberto. O
  -- cliente informa a versão do formulário; ela só é aceita se foi publicada
  -- um dia e se o checklist começou ANTES da publicação da versão atual. Um
  -- rascunho, ou uma versão arquivada antes de o checklist começar, é
  -- recusado — o motorista reinicia com o formulário vigente.
  if v_form_ver is not null and v_form_ver <> v_version.id then
    select v.* into v_form from public.checklist_app_versions v
     where v.id = v_form_ver and v.app_id = v_app.id;
    if v_form.id is null or v_form.published_at is null or v_form.status <> 'archived'
       or v_started >= v_version.published_at then
      raise exception 'O formulário foi atualizado para a versão % enquanto este checklist estava aberto. Reinicie o checklist.',
        v_version.label using errcode = 'invalid_parameter_value';
    end if;
    v_version := v_form;
  end if;

  -- §34: o BR é a posição; a placa é o recurso que estava nela naquele dia.
  -- Planejamento incompleto não impede o checklist (§33): o BR fica nulo e a
  -- conciliação trata o caso.
  select b.id, b.operation_id, b.state_id, b.city_id into v_br
    from public.fidelization_assignments fa
    join public.operation_brs b on b.id = fa.operation_br_id
   where fa.organization_id = p_organization_id
     and fa.vehicle_id = v_vehicle.id
     and fa.vehicle_role = 'primary'
     and fa.status <> 'cancelled'
     and fa.start_date <= v_date
     and (fa.end_date is null or fa.end_date >= v_date)
   order by fa.start_date desc limit 1;

  if v_br.id is not null then
    select employee_id into v_leader from private.br_leadership_at(v_br.id, v_date);
  end if;

  -- §39: o mínimo é recusa; o máximo é registrado e analisado. Recusar um
  -- checklist lento destruiria trabalho legítimo de quem foi interrompido.
  v_duration := greatest(0, extract(epoch from (now() - v_started))::integer);
  if v_duration < v_version.min_duration_seconds then
    raise exception 'O checklist foi concluído em % segundos; o mínimo configurado é %. Revise as respostas com atenção.',
      v_duration, v_version.min_duration_seconds using errcode = 'invalid_parameter_value';
  end if;

  insert into public.checklist_executions (
    organization_id, app_id, version_id, user_id, employee_id,
    vehicle_id, license_plate_snapshot, fleet_code_snapshot,
    vehicle_type_id, vehicle_subcategory_id,
    operation_id, state_id, city_id, operation_br_id, organization_unit_id, leader_employee_id,
    checklist_type, operational_date, started_at, status, idempotency_key)
  values (
    p_organization_id, v_app.id, v_version.id, v_actor.user_id, v_actor.employee_id,
    v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code,
    v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id,
    coalesce(v_br.operation_id, v_op), v_br.state_id, v_br.city_id, v_br.id,
    v_vehicle.organization_unit_id, v_leader,
    v_type, v_date, v_started, 'draft', v_key)
  returning id into v_exec;

  -- As perguntas aplicáveis a ESTE veículo. A validação é do servidor: uma
  -- requisição alterada que omita perguntas obrigatórias é recusada aqui.
  for r in
    select qu.id, qu.question_key, qu.question_text, qu.conforming_answer, qu.criticality,
           qu.is_required, cl.cluster_key, cl.name as cluster_name,
           cd.field_key, cd.trigger_answer, cd.is_required as cond_required, cd.field_type
      from public.checklist_questions qu
      join public.checklist_clusters cl on cl.id = qu.cluster_id
      left join public.checklist_question_conditionals cd on cd.question_id = qu.id
     where qu.version_id = v_version.id and qu.status = 'active'
       and private.checklist_question_applies(
             qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id,
             coalesce(v_br.operation_id, v_op))
     order by cl.sort_order, qu.sort_order
  loop
    v_applic := v_applic + 1;

    select value into a from jsonb_array_elements(v_answers) value
     where value ->> 'question_id' = r.id::text limit 1;

    if a is null or nullif(a ->> 'answer', '') is null then
      if r.is_required then
        v_faltando := v_faltando || format('%s · %s%s', r.cluster_name, r.question_text, chr(10));
      end if;
      continue;
    end if;

    if (a ->> 'answer') not in ('yes', 'no') then
      raise exception 'Resposta inválida para "%": %.', r.question_text, a ->> 'answer'
        using errcode = 'invalid_parameter_value';
    end if;

    -- §25: o condicional obrigatório só é exigido quando a resposta o aciona.
    if r.field_key is not null and r.cond_required
       and (a ->> 'answer') = r.trigger_answer then
      if a -> 'conditional_value' is null
         or a -> 'conditional_value' = 'null'::jsonb
         or (r.field_type = 'text'
             and nullif(btrim(coalesce(a -> 'conditional_value' ->> r.field_key, '')), '') is null)
         or (r.field_type in ('single_select', 'multi_select')
             and coalesce(jsonb_array_length(
                   case when jsonb_typeof(a -> 'conditional_value' -> r.field_key) = 'array'
                        then a -> 'conditional_value' -> r.field_key else '[]'::jsonb end), 0) = 0
             and nullif(btrim(coalesce(a -> 'conditional_value' ->> r.field_key, '')), '') is null)
      then
        v_faltando := v_faltando || format('%s · campo obrigatório de "%s"%s',
                                           r.cluster_name, r.question_text, chr(10));
        continue;
      end if;
    end if;

    v_answered := v_answered + 1;

    insert into public.checklist_execution_answers (
      organization_id, execution_id, version_id, question_id, question_key, cluster_key,
      question_text_snapshot, answer, is_conforming, criticality, conditional_value, note)
    values (
      p_organization_id, v_exec, v_version.id, r.id, r.question_key, r.cluster_key,
      r.question_text, a ->> 'answer',
      -- §11: a conformidade é por pergunta. As duas invertidas dependem disto.
      (a ->> 'answer') = r.conforming_answer,
      r.criticality,
      case when (a ->> 'answer') = coalesce(r.trigger_answer, '')
           then a -> 'conditional_value' else null end,
      nullif(btrim(coalesce(a ->> 'note', '')), ''));

    if (a ->> 'answer') = r.conforming_answer then
      v_conf := v_conf + 1;
    else
      v_nonconf := v_nonconf + 1;
      if r.criticality = 'critica' then v_crit := v_crit + 1; end if;
    end if;
  end loop;

  if v_faltando <> '' then
    raise exception 'Há perguntas obrigatórias sem resposta:%s%s', chr(10), v_faltando
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.checklist_execution_clusters (
    organization_id, execution_id, cluster_id, cluster_key, cluster_name, sort_order,
    applicable_questions, answered_questions, non_conforming)
  select p_organization_id, v_exec, cl.id, cl.cluster_key, cl.name, cl.sort_order,
         count(*), count(ans.id), count(ans.id) filter (where ans.is_conforming = false)
    from public.checklist_questions qu
    join public.checklist_clusters cl on cl.id = qu.cluster_id
    left join public.checklist_execution_answers ans
      on ans.execution_id = v_exec and ans.question_id = qu.id
   where qu.version_id = v_version.id and qu.status = 'active'
     and private.checklist_question_applies(
           qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id,
           coalesce(v_br.operation_id, v_op))
   group by cl.id, cl.cluster_key, cl.name, cl.sort_order;

  update public.checklist_executions
     set status = 'submitted',
         submitted_at = now(),
         duration_seconds = v_duration,
         applicable_questions = v_applic,
         answered_questions = v_answered,
         conforming_answers = v_conf,
         non_conforming_answers = v_nonconf,
         critical_non_conforming = v_crit,
         updated_at = now()
   where id = v_exec;

  -- §57: outbox transacional. O evento nasce na MESMA transação da execução —
  -- se o checklist gravou, o evento existe; se falhou, nenhum dos dois existe.
  -- A Aderência (Etapa 11) consome daqui. Enquanto ela não existir, o evento
  -- fica pendente e nada se perde: o motorista não refaz o que já enviou.
  insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organization_id, 'checklist.execution.submitted', 'checklist_execution', v_exec,
          jsonb_build_object(
            'execution_id', v_exec,
            'organization_id', p_organization_id,
            'vehicle_id', v_vehicle.id,
            'license_plate', v_vehicle.license_plate,
            'operation_id', coalesce(v_br.operation_id, v_op),
            'operation_br_id', v_br.id,
            'employee_id', v_actor.employee_id,
            'checklist_type', v_type,
            'operational_date', v_date,
            'submitted_at', now(),
            'version_id', v_version.id,
            'version_label', v_version.label,
            'applicable_questions', v_applic,
            'conforming', v_conf,
            'non_conforming', v_nonconf,
            'critical_non_conforming', v_crit,
            -- §58: aderência é realização, conformidade é resultado. O evento
            -- diz que o checklist FOI FEITO, mesmo trazendo inconformidades.
            'execution_valid', true));

  return jsonb_build_object(
    'execution_id', v_exec, 'duplicate', false, 'status', 'submitted',
    'applicable', v_applic, 'answered', v_answered,
    'conforming', v_conf, 'non_conforming', v_nonconf,
    'critical_non_conforming', v_crit,
    'duration_seconds', v_duration,
    'operation_br_id', v_br.id,
    'has_obligation_context', v_br.id is not null);
end;
$$;

revoke execute on function public.submit_checklist_execution(uuid, jsonb) from public, anon;
grant execute on function public.submit_checklist_execution(uuid, jsonb) to authenticated;

create or replace function private.adherence_expected(
  p_organization_id uuid, p_from date, p_to date,
  p_operation_id uuid default null, p_vehicle_id uuid default null, p_context text default null)
returns table (
  vehicle_id uuid, operational_date date, checklist_context text,
  operation_id uuid, operation_city_id uuid, state_id smallint, city_id integer, operation_br_id uuid,
  fidelization_assignment_id uuid, organization_unit_id uuid, vehicle_type_id uuid, vehicle_subcategory_id uuid,
  leader_employee_id uuid, leadership_assignment_id uuid, fleet_code text, license_plate text, vehicle_status text,
  expected_at timestamptz, deadline_at timestamptz, source text,
  eligibility_rule_id uuid, eligibility_rule_version integer, detected_condition text,
  planning_conflict boolean, conflict_operation_id uuid)
language sql stable security definer set search_path = ''
as $$
  with days as (
    select d::date as d from generate_series(p_from, p_to, interval '1 day') d
  ),
  s as (
    select * from public.adherence_settings where organization_id = p_organization_id
  ),
  fleet as (
    select days.d, f.*
      from days
      cross join lateral private.adherence_planned_fleet(p_organization_id, days.d, p_operation_id, p_vehicle_id) f
     where f.vehicle_status not in ('sold', 'decommissioned')
       -- a obrigação pressupõe o aplicativo habilitado na operação E no tipo
       -- de equipamento NA DATA (Refinamento da Etapa 12, §44–§46). O que já
       -- foi gerado no passado não é apagado por esta condição: a geração é
       -- por período, e obrigações protegidas nunca são aposentadas.
       and exists (
         select 1 from public.operational_apps a
          where a.organization_id = p_organization_id and a.code = 'checklist_frota'
            and a.deleted_at is null and a.is_active
            and private.app_operation_enabled(a.id, f.operation_id, days.d)
            and private.app_vehicle_type_enabled(p_organization_id, a.id, f.vehicle_type_id, days.d))
  ),
  ruled as (
    select fl.*, r.*
      from fleet fl
      cross join lateral private.adherence_resolve_rule(
        p_organization_id, fl.d, fl.operation_id, fl.vehicle_type_id, fl.vehicle_subcategory_id, fl.vehicle_status) r
     where r.requires_checklist
       and extract(isodow from fl.d)::smallint = any (r.weekdays)
  ),
  ctx as (
    select c.context from (values ('saida'), ('retorno')) as c(context)
     where p_context is null or c.context = p_context
  )
  select ru.vehicle_id, ru.d, ctx.context,
         ru.operation_id, ru.operation_city_id, ru.state_id, ru.city_id, ru.operation_br_id,
         ru.fidelization_assignment_id, ru.organization_unit_id, ru.vehicle_type_id, ru.vehicle_subcategory_id,
         ld.employee_id, ld.leadership_assignment_id, ru.fleet_code, ru.license_plate, ru.vehicle_status,
         case ctx.context
           when 'saida' then private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.departure_expected_time, s.departure_expected_time, '06:00'::time), false)
           else private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.return_expected_time, s.return_expected_time, '18:00'::time), false)
         end,
         case ctx.context
           -- a saída vence no fim do dia operacional; durante o dia já é "não fez" provisório (§15)
           when 'saida' then private.adherence_local_ts(p_organization_id, ru.d, '00:00'::time, true)
           else private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.return_deadline_time, s.return_deadline_time, '02:00'::time),
                               coalesce(ru.return_deadline_next_day, s.return_deadline_next_day, true))
         end,
         ru.source, ru.rule_id, ru.rule_version,
         case ru.vehicle_status when 'maintenance' then 'MANUTENCAO' when 'inactive' then 'FROTA_NAO_ATIVA' end,
         ru.planning_conflict, ru.conflict_operation_id
    from ruled ru
    cross join ctx
    left join lateral private.adherence_leader_at(ru.operation_id, ru.operation_city_id, ru.operation_br_id, ru.d) ld on true
    left join s on true
   where (ctx.context = 'saida' and ru.applies_to_departure)
      or (ctx.context = 'retorno' and ru.applies_to_return);
$$;
