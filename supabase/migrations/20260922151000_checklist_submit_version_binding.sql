-- =============================================================================
-- Etapa 12 — execução e versão (§48), Meus Checklists (§59) e histórico do
-- escopo (§64)
--
-- 1. `submit_checklist_execution` passa a aceitar `version_id` no payload: o
--    checklist aberto sob a versão 1.0 continua em 1.0 mesmo que a 1.1 seja
--    publicada no meio. Sem isso, os ids de pergunta do formulário aberto
--    deixariam de casar com a versão vigente e o envio falharia como
--    "perguntas obrigatórias sem resposta" — o motorista perderia tudo.
--
-- 2. `checklist_my_executions` passa a ser SÓ do colaborador da sessão. A RLS
--    já permitia que a liderança visse o escopo; "Meus Checklists" não é o
--    lugar disso.
--
-- 3. `checklist_scope_executions` é o histórico do escopo, com filtros, para
--    quem tem `view_details`. A RLS decide o alcance; a rotina só filtra.
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

-- -----------------------------------------------------------------------------
-- §59: Meus Checklists — só o colaborador da sessão (§31).
-- -----------------------------------------------------------------------------
create or replace function public.checklist_my_executions(
  p_organization_id uuid,
  p_limit           integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'operational_date', e.operational_date,
           'checklist_type', e.checklist_type,
           'license_plate', e.license_plate_snapshot,
           'fleet_code', e.fleet_code_snapshot,
           'operation_name', op.name,
           'br_code', b.code,
           'submitted_at', e.submitted_at,
           'duration_seconds', e.duration_seconds,
           'applicable', e.applicable_questions,
           'conforming', e.conforming_answers,
           'non_conforming', e.non_conforming_answers,
           'critical_non_conforming', e.critical_non_conforming,
           'status', e.status
         ) order by e.operational_date desc, e.submitted_at desc), '[]'::jsonb)
    from (
      select * from public.checklist_executions x
       where x.organization_id = p_organization_id and x.status = 'submitted'
         and x.employee_id in (select a.employee_id from private.checklist_actor(p_organization_id) a)
       order by x.operational_date desc, x.submitted_at desc
       limit greatest(1, least(p_limit, 200))
    ) e
    join public.operations op on op.id = e.operation_id
    left join public.operation_brs b on b.id = e.operation_br_id;
$$;

-- -----------------------------------------------------------------------------
-- §64: histórico do escopo. Filtros opcionais em `p_filters`:
--   date_from, date_to, operation_id, checklist_type, search, limit.
-- -----------------------------------------------------------------------------
create or replace function public.checklist_scope_executions(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select nullif(p_filters ->> 'date_from', '')::date          as date_from,
           nullif(p_filters ->> 'date_to', '')::date            as date_to,
           nullif(p_filters ->> 'operation_id', '')::uuid       as operation_id,
           nullif(p_filters ->> 'checklist_type', '')           as checklist_type,
           nullif(btrim(coalesce(p_filters ->> 'search', '')), '') as search,
           greatest(1, least(coalesce((p_filters ->> 'limit')::integer, 100), 200)) as lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'operational_date', e.operational_date,
           'checklist_type', e.checklist_type,
           'license_plate', e.license_plate_snapshot,
           'fleet_code', e.fleet_code_snapshot,
           'operation_name', op.name,
           'br_code', b.code,
           'employee_name', emp.full_name,
           'employee_code', emp.employee_code,
           'submitted_at', e.submitted_at,
           'duration_seconds', e.duration_seconds,
           'applicable', e.applicable_questions,
           'conforming', e.conforming_answers,
           'non_conforming', e.non_conforming_answers,
           'critical_non_conforming', e.critical_non_conforming,
           'status', e.status
         ) order by e.operational_date desc, e.submitted_at desc), '[]'::jsonb)
    from (
      select x.* from public.checklist_executions x
      cross join f
      left join public.employees em on em.id = x.employee_id
       where x.organization_id = p_organization_id and x.status = 'submitted'
         and (f.date_from is null or x.operational_date >= f.date_from)
         and (f.date_to is null or x.operational_date <= f.date_to)
         and (f.operation_id is null or x.operation_id = f.operation_id)
         and (f.checklist_type is null or x.checklist_type = f.checklist_type)
         and (f.search is null
              or x.license_plate_snapshot ilike '%' || f.search || '%'
              or x.fleet_code_snapshot ilike '%' || f.search || '%'
              or em.full_name ilike '%' || f.search || '%'
              or em.employee_code ilike '%' || f.search || '%')
       order by x.operational_date desc, x.submitted_at desc
       limit (select lim from f)
    ) e
    join public.operations op on op.id = e.operation_id
    left join public.operation_brs b on b.id = e.operation_br_id
    left join public.employees emp on emp.id = e.employee_id;
$$;

revoke execute on function public.checklist_scope_executions(uuid, jsonb) from public, anon;
grant execute on function public.checklist_scope_executions(uuid, jsonb) to authenticated;
