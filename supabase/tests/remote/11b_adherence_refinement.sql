-- =============================================================================
-- 11b · Aderência — refinamento da Etapa 11: consistência entre visões,
--       substituição de veículo, elegibilidade, conflito execução × expurgo,
--       decisões em lote, Retorno, dashboard mensal e segurança
--
-- Suíte transacional contra o banco COM DADOS (setembro/2026 materializado).
-- Não cria veículo, operação, BR nem colaborador; as execuções passam pela
-- rotina oficial do Check List de Frota; tudo é desfeito no fim.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- O que cada bloco protege:
--   R1  §105  o mesmo dia tem o mesmo numerador/denominador na consolidada, no
--             heatmap, no detalhe do dia e na matriz; o mês, no dashboard mensal
--   R2  §99   substituição de veículo: BR preservado, execução do veículo
--             anterior preservada, novo veículo com uma obrigação por contexto
--             no BR, a obrigação em aberto do anterior acompanha o planejamento
--   R3  §100  operação desabilitada para o aplicativo a partir de amanhã: nada
--             novo amanhã; as obrigações de hoje continuam íntegras
--   R4  §103  conflito: obrigação com execução válida recusa solicitação e
--             recusa aprovação (individual e em lote); a execução fica
--   R5  §57   decisões em lote com prévia por item; rejeitar exige motivo;
--             filtro por situação da justificativa
--   R6  §47   Retorno: saída feita não marca retorno; retorno no prazo é
--             "aguardando retorno", nunca falta; conta na fila, não no vencido
--   R7  §25   dashboard mensal: 12 meses, futuro sem resultado, mês vigente
--   R8  §108  sem vínculo: leituras vazias (RLS), rotinas privilegiadas recusam
--
-- Última execução: 8/8 PASS contra o projeto de desenvolvimento (23/09/2026).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_op uuid; v_merch uuid; v_app uuid; v_today date; v_yest date;
  a record; b record; c record; o record; o2 record;
  f jsonb; v_ans jsonb; v_res jsonb; j jsonb; j2 jsonb; j3 jsonb; v_key text; v_exec uuid;
  v_req uuid; v_req2 uuid; v_req3 uuid; v_ob_b uuid;
  n bigint; n2 bigint; n3 bigint; n4 bigint; ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  select id into v_op from public.operations where organization_id = v_org and code = 'OP-00004';
  select id into v_merch from public.operations where organization_id = v_org and code = 'OP-00005';
  select id into v_app from public.operational_apps where organization_id = v_org and code = 'checklist_frota' and deleted_at is null;
  v_today := private.adherence_today(v_org);
  v_yest := v_today - 1;

  -- Fixture: tres vans da mesma operacao com saida de hoje nao feita e sem solicitacao (A, B) e uma terceira (C) cujo veiculo sera liberado.
  select s.vehicle_id, s.id as obligation_id, s.operation_br_id, fa.id as assignment_id, s.fleet_code_snapshot as fleet into a
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
    join public.fidelization_assignments fa on fa.id = s.fidelization_assignment_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request
     and fa.end_date >= v_today + 3
   order by s.fleet_code_snapshot limit 1;
  select s.vehicle_id, s.id as obligation_id, s.operation_br_id, fa.id as assignment_id, s.fleet_code_snapshot as fleet into b
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
    join public.fidelization_assignments fa on fa.id = s.fidelization_assignment_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request and s.vehicle_id <> a.vehicle_id
   order by s.fleet_code_snapshot limit 1;
  select s.vehicle_id, s.id as obligation_id, s.operation_br_id, fa.id as assignment_id, s.fleet_code_snapshot as fleet into c
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
    join public.fidelization_assignments fa on fa.id = s.fidelization_assignment_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request
     and s.vehicle_id not in (a.vehicle_id, b.vehicle_id)
   order by s.fleet_code_snapshot limit 1;
  if a.vehicle_id is null or b.vehicle_id is null or c.vehicle_id is null then
    raise exception 'Fixture: a suite precisa de tres vans da Last Mille MG com saida de hoje em aberto';
  end if;

  -- R1: consistencia entre visoes (ontem)
  j := public.adherence_summary(v_org, v_yest, v_yest, 'saida', '{}'::jsonb, null);
  j2 := public.adherence_day_detail(v_org, v_yest, 'saida', '{}'::jsonb);
  select d into j3 from jsonb_array_elements(public.adherence_heatmap(v_org, extract(year from v_yest)::int, extract(month from v_yest)::int, 'saida', '{}'::jsonb)) d
   where (d->>'date')::date = v_yest;
  select count(*) into n from jsonb_array_elements(public.adherence_matrix(v_org, extract(year from v_yest)::int, extract(month from v_yest)::int, 'saida', '{}'::jsonb, 1, 5000)->'rows') row_
   where row_->'days'->(extract(day from v_yest)::int::text)->>'due' = 'true';
  ok  := (j->>'numerator') = (j2->>'numerator') and (j->>'denominator') = (j2->>'denominator');
  ok2 := (j->>'numerator') = (j3->>'numerator') and (j->>'denominator') = (j3->>'denominator');
  ok3 := n = (j->>'denominator')::int;
  j2 := public.adherence_monthly(v_org, extract(year from v_today)::int, 'saida', '{}'::jsonb);
  select m into j3 from jsonb_array_elements(j2->'months') m where (m->>'month')::int = extract(month from v_today)::int;
  j := public.adherence_summary(v_org, date_trunc('month', v_today)::date, (date_trunc('month', v_today) + interval '1 month - 1 day')::date, 'saida', '{}'::jsonb, null);
  ok4 := (j->>'numerator') = (j3->>'numerator') and (j->>'denominator') = (j3->>'denominator') and (j3->>'is_current')::boolean;
  r := r || format('R1  mesma base: consolidada=detalhe %s, =heatmap %s, =matriz (%s devidas) %s, mes=dashboard %s -> %s%s',
       ok, ok2, n, ok3, ok4, case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  -- R2: substituicao de veiculo (A recebe o veiculo de C a partir de hoje) apos A ter feito a saida
  f := public.checklist_fleet_form(v_org, a.vehicle_id, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') cl, jsonb_array_elements(cl->'questions') q;
  v_key := 'aderencia-11b-' || gen_random_uuid()::text;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', v_key, 'vehicle_id', a.vehicle_id, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
  v_exec := (v_res->>'execution_id')::uuid;
  perform public.end_fidelization_assignment(c.assignment_id, v_yest, 'Suite 11b: libera o veiculo');
  perform public.substitute_fidelization_vehicle(a.assignment_id, c.vehicle_id, v_today, 'Suite 11b: substituicao');
  j := private.adherence_generate(v_org, v_today, v_today, null, null, null, true, false, null, 'Suite 11b');
  select * into o from public.adherence_obligation_status where id = a.obligation_id;
  ok  := o.id is not null and o.is_done and o.execution_id = v_exec and o.operation_br_id = a.operation_br_id;
  select count(*) into n from public.adherence_obligation_status s
   where s.vehicle_id = c.vehicle_id and s.operational_date = v_today and s.checklist_context = 'saida';
  select count(*) into n2 from public.adherence_obligation_status s
   where s.vehicle_id = c.vehicle_id and s.operational_date = v_today and s.checklist_context = 'retorno' and s.operation_br_id = a.operation_br_id;
  ok2 := n = 1 and n2 = 1
     and exists (select 1 from public.adherence_obligation_status s where s.vehicle_id = c.vehicle_id and s.operational_date = v_today
                  and s.checklist_context = 'saida' and s.operation_br_id = a.operation_br_id and s.source = 'fidelization' and not s.is_done);
  -- o retorno do veiculo anterior nao estava protegido: acompanha o planejamento
  -- vigente (sem BR: o veiculo saiu da posicao e segue so pela alocacao) ou,
  -- sem alocacao, e aposentado — nunca duplicado
  select count(*) into n3 from public.checklist_obligations ob
   where ob.vehicle_id = a.vehicle_id and ob.operational_date = v_today and ob.checklist_context = 'retorno' and ob.is_active;
  select count(*) into n4 from public.checklist_obligations ob
   where ob.vehicle_id = a.vehicle_id and ob.operational_date = v_today and ob.checklist_context = 'retorno' and not ob.is_active and ob.retired_reason = 'Suite 11b';
  ok3 := (n3 = 1 and n4 = 0 and exists (select 1 from public.checklist_obligations ob where ob.vehicle_id = a.vehicle_id and ob.operational_date = v_today
             and ob.checklist_context = 'retorno' and ob.is_active and ob.operation_br_id is null and ob.source = 'allocation'))
      or (n3 = 0 and n4 = 1);
  -- a obrigacao do BR hoje: 1 feita (veiculo anterior) + 1 nova (veiculo novo); nenhuma linha duplicada por veiculo/contexto
  select count(*) into n from (select vehicle_id, checklist_context from public.checklist_obligations
     where organization_id = v_org and operational_date = v_today and operation_br_id = a.operation_br_id and is_active
     group by 1, 2 having count(*) > 1) x;
  ok4 := n = 0;
  r := r || format('R2  substituicao: execucao do anterior preservada no mesmo BR %s, novo veiculo com 1 saida + 1 retorno no BR %s, retorno do anterior acompanha o planejamento (sem BR) ou e aposentado %s, sem duplicidade por veiculo %s -> %s%s',
       ok, ok2, ok3, ok4, case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  -- R3: elegibilidade — Merchandising desabilitada a partir de amanha
  select count(*) into n from public.checklist_obligations where organization_id = v_org and operation_id = v_merch and operational_date = v_today and is_active;
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_merch, 'is_enabled', true, 'effective_to', v_today::text));
  j := private.adherence_generate(v_org, v_today + 1, v_today + 1, v_merch, null, null, true, true, null, null);
  j2 := private.adherence_generate(v_org, v_today, v_today, v_merch, null, null, true, true, null, null);
  select count(*) into n2 from public.checklist_obligations where organization_id = v_org and operation_id = v_merch and operational_date = v_today and is_active;
  ok  := (j->>'expected')::int = 0 and (j->>'create')::int = 0;
  ok2 := (j2->>'expected')::int > 0 and (j2->>'retire_candidates')::int = 0 and n2 = n and n > 0;
  r := r || format('R3  elegibilidade: amanha nada esperado para a operacao desabilitada %s, hoje intacto (%s obrigacoes, 0 a aposentar) %s -> %s%s',
       ok, n, ok2, case when ok and ok2 then 'PASS' else 'FAIL' end, chr(10));

  -- R4: conflito execucao valida x expurgo (veiculo B)
  v_req := (public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', b.obligation_id, 'reason_code', 'SEM_ROTA', 'justification', 'Suite 11b: sem rota'))->>'id')::uuid;
  f := public.checklist_fleet_form(v_org, b.vehicle_id, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') cl, jsonb_array_elements(cl->'questions') q;
  v_key := 'aderencia-11b-' || gen_random_uuid()::text;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', v_key, 'vehicle_id', b.vehicle_id, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '90 seconds')::text, 'answers', v_ans));
  select * into o from public.adherence_obligation_status where id = b.obligation_id;
  ok := o.is_done and o.has_pending_request;
  update public.adherence_requests set requested_by = null where id = v_req;
  ok2 := false;
  begin
    perform public.decide_adherence_request(v_org, jsonb_build_object('request_id', v_req, 'decision', 'approve'));
  exception when others then ok2 := sqlerrm like '%checklist v_lido%'; end;
  j := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req), 'decision', 'approve', 'dry_run', true));
  ok3 := (j->'counts'->>'has_execution')::int = 1;
  ok4 := false;
  begin
    perform public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', b.obligation_id, 'reason_code', 'SEM_ROTA', 'justification', 'Suite 11b: de novo'));
  exception when others then ok4 := sqlerrm like '%checklist v_lido%'; end;
  j := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req), 'decision', 'reject', 'note', 'Checklist realizado; solicitacao improcedente.', 'dry_run', false));
  select * into o from public.adherence_obligation_status where id = b.obligation_id;
  ok5 := (j->'counts'->>'applied')::int = 1 and o.is_done and not o.has_pending_request and not o.is_excluded and o.status_code = 'FEZ_CHECKLIST';
  r := r || format('R4  conflito: execucao chegou com solicitacao pendente %s, aprovar individual recusado %s, lote classifica has_execution %s, nova solicitacao recusada %s, rejeicao em lote preserva a execucao %s -> %s%s',
       ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- R5: decisoes em lote com previa (duas solicitacoes de ontem, de outro solicitante)
  select s.id into v_ob_b from public.adherence_obligation_status s where s.organization_id = v_org and s.operational_date = v_yest
     and s.checklist_context = 'saida' and s.operation_id = v_op and s.status_code = 'NAO_FEZ_CHECKLIST' and not s.has_pending_request order by s.fleet_code_snapshot limit 1;
  v_req2 := (public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', v_ob_b, 'reason_code', 'SEM_ROTA', 'justification', 'Suite 11b: lote 1'))->>'id')::uuid;
  select s.id into v_ob_b from public.adherence_obligation_status s where s.organization_id = v_org and s.operational_date = v_yest
     and s.checklist_context = 'saida' and s.operation_id = v_op and s.status_code = 'NAO_FEZ_CHECKLIST' and not s.has_pending_request order by s.fleet_code_snapshot limit 1;
  v_req3 := (public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', v_ob_b, 'reason_code', 'RESERVA', 'justification', 'Suite 11b: lote 2'))->>'id')::uuid;
  j := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req2, v_req3), 'decision', 'approve', 'dry_run', true));
  ok := (j->'counts'->>'own_request')::int = 2;
  update public.adherence_requests set requested_by = null where id in (v_req2, v_req3);
  j := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req2, v_req3, gen_random_uuid()), 'decision', 'approve', 'dry_run', true));
  select count(*) into n from public.adherence_requests where id in (v_req2, v_req3) and status = 'pending';
  ok2 := (j->'counts'->>'applicable')::int = 2 and (j->'counts'->>'not_found')::int = 1 and n = 2;
  ok3 := false;
  begin
    perform public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req2), 'decision', 'reject', 'dry_run', false));
  exception when invalid_parameter_value then ok3 := true; end;
  j := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req2), 'decision', 'reclassify', 'new_reason_code', 'EM_VIAGEM', 'note', 'Reclassificado em lote', 'dry_run', false));
  j2 := public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(v_req3), 'decision', 'reject', 'note', 'Sem base', 'dry_run', false));
  select count(*) into n from public.adherence_requests where id = v_req2 and status = 'approved' and status_code_applied = 'EM_VIAGEM' and reclassified_from_reason_id is not null and decided_by = v_user;
  select count(*) into n2 from public.adherence_requests where id = v_req3 and status = 'rejected';
  select count(*) into n3 from public.adherence_obligations_filtered(v_org, v_yest, v_yest, 'saida', jsonb_build_object('justification', 'approved', 'operation_id', v_op));
  select count(*) into n4 from public.adherence_obligations_filtered(v_org, v_yest, v_yest, 'saida', jsonb_build_object('justification', 'rejected', 'operation_id', v_op));
  ok4 := (j->'counts'->>'applied')::int = 1 and (j2->'counts'->>'applied')::int = 1 and n = 1 and n2 = 1;
  ok5 := n3 = 1 and n4 = 1;
  r := r || format('R5  lote: propria recusada na previa %s, previa nao grava (2 aplicaveis, 1 inexistente) %s, rejeitar sem motivo recusado %s, reclassificar e rejeitar aplicados com auditoria %s, filtro por situacao da justificativa %s -> %s%s',
       ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- R6: Retorno — B fez a saida; o retorno de hoje esta no prazo
  j := public.adherence_return_tracking(v_org, v_today, v_today, jsonb_build_object('operation_id', v_op), 500);
  select row_ into j2 from jsonb_array_elements(j->'rows') row_ where (row_->>'vehicle_id')::uuid = b.vehicle_id;
  select * into o from public.adherence_obligation_status s where s.vehicle_id = b.vehicle_id and s.operational_date = v_today and s.checklist_context = 'retorno';
  ok  := o.status_code = 'RETORNO_PENDENTE' and not o.is_done and not o.is_due;
  ok2 := j2->>'situation' = 'awaiting_return' and (j2->>'departure_done')::boolean and j2->>'status' = 'RETORNO_PENDENTE';
  ok3 := (j->'stats'->>'awaiting_return')::int >= 1 and (j->'stats'->>'overdue')::int = 0
     and (j->'stats'->>'done')::int = 0 and (j->'stats'->>'denominator')::int = 0;
  r := r || format('R6  retorno: saida feita nao marca retorno (pendente no prazo, fora do denominador) %s, fila diz "aguardando retorno" %s, nenhum vencido hoje e sem base ainda %s -> %s%s',
       ok, ok2, ok3, case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- R7: dashboard mensal
  j := public.adherence_monthly(v_org, extract(year from v_today)::int, 'saida', '{}'::jsonb);
  select count(*) into n from jsonb_array_elements(j->'months') m where (m->>'is_future')::boolean and ((m->>'denominator')::int > 0 or (m->>'adherence_pct') is not null);
  select count(*) into n2 from jsonb_array_elements(j->'months') m where (m->>'is_current')::boolean;
  ok := jsonb_array_length(j->'months') = 12 and n = 0 and n2 = 1;
  r := r || format('R7  dashboard mensal: 12 meses, futuro sem resultado, um mes vigente -> %s%s', case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- R8: sem vinculo — leituras vazias e rotinas privilegiadas recusam
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.adherence_select_obligations(v_org, jsonb_build_array(v_yest::text), 'saida', '{}'::jsonb, 50);
  j2 := public.adherence_day_detail(v_org, v_yest, 'saida', '{}'::jsonb);
  j3 := public.adherence_import_history(v_org, 5);
  n := 0; n2 := 0;
  begin
    perform public.decide_adherence_requests_bulk(v_org, jsonb_build_object('request_ids', jsonb_build_array(gen_random_uuid()), 'decision', 'approve', 'dry_run', true));
  exception when others then n := case when sqlstate = '42501' then 1 else 0 end; end;
  begin
    perform public.log_adherence_export(v_org, 'xlsx', 1, 'matriz');
  exception when others then n2 := case when sqlstate = '42501' then 1 else 0 end; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  ok := (j->>'total')::int = 0 and (j2->>'obligations')::int = 0 and jsonb_array_length(j3) = 0 and n = 1 and n2 = 1;
  r := r || format('R8  sem vinculo: selecao=0, detalhe=0, historico vazio, lote e exportacao recusados (42501) -> %s%s', case when ok then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
