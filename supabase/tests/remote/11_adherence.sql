-- =============================================================================
-- 11 · Aderência — motor de obrigações, conciliação, status, fórmula e segurança
--
-- Suíte transacional contra o banco COM DADOS: usa os veículos, operações,
-- regras e obrigações reais de setembro/2026. Não cria veículo, operação nem
-- colaborador. As execuções de checklist passam pela rotina oficial da
-- Etapa 12 — é assim que se prova a conciliação pelo gatilho do outbox.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: é assim que
-- devolve o resultado e desfaz tudo o que fez.
--
-- O que cada bloco protege:
--   T1/T1b  dia vigente sem execução = NÃO FEZ, devida, provisória, nas pendências (§15, §67)
--   T2      amanhã = PLANEJADO, fora do denominador, aderência "sem base" (§16, §35)
--   T3/T3b  saída enviada concilia na transação; segunda execução é duplicidade (§22, §24)
--   T4/T4b  retorno independente da saída; vencido o prazo vira NÃO FEZ (§13, §18)
--   T5–T8   pendente fica no denominador; auto-aprovação recusada; aprovada sai;
--           rejeitada continua elegível (§31, §32, §67)
--   T9/T9b  10 obrigações (Last Mille MG, o excedente do dia aposentado só na
--           transação), 8 feitas, 1 expurgo → 8/9 = 88,89% em consolidada,
--           heatmap e matriz (§68)
--   T9c     consolidação por soma: 1/2 + 8/8 = 9/10 = 90%, não a média 75% (§37)
--   T10     reprocessar sem mudança nas fontes: nada cria, nada aposenta; a
--           cidade congelada da obrigação passada não muda (§9, §40)
--   T11     regra nova válida de hoje não reclassifica ontem (§26, §67)
--   T12/b   usuário sem vínculo não vê nem solicita; RPC privilegiada recusa
--           organização fora do vínculo (§60, §62, §69)
--   T13/b   correção administrativa não fabrica execução; com motivo elegível
--           e justificativa, expurga e fica marcada (§23, §49)
--   T14     alteração em massa com prévia: só o que é elegível (§50)
--   T15     meta parametrizável e diferença para a meta (§36)
--   T16     execução sem obrigação vira inconsistência, nunca obrigação (§22);
--           o tipo do veículo é habilitado no aplicativo só dentro da transação
--   I1–I4   importação (2º bloco): prévia recusa status desconhecido, veículo
--           desconhecido, data futura e evidência ausente; processar abre só
--           solicitações PENDENTES sem solicitante; lote concluído não reprocessa;
--           mesmo arquivo é reconhecido (§54–§56)
--
-- Última execução: 23/23 (bloco 1) + 4/4 (bloco 2) PASS contra o projeto de
-- desenvolvimento (23/09/2026, após o refinamento da Etapa 11). Cada bloco é um `do` próprio e termina em
-- ROLLBACK_TESTES: rode um de cada vez.
-- As mensagens vão sem acento de propósito: voltam dentro de uma mensagem de
-- erro do PostgreSQL, que atravessa clientes de codificação incerta.
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_op uuid; v_merch uuid; v_van uuid; v_type uuid; v_today date;
  v_car uuid; v_car_op uuid; v_car_type uuid; v_app uuid;
  f jsonb; v_ans jsonb; v_res jsonb; v_res2 jsonb; v_key text; v_exec uuid; v_exec2 uuid;
  o record;
  v_ob uuid; v_ob_ret uuid; v_yest uuid; v_yest_ret uuid; v_req uuid; v_req2 uuid; v_old uuid;
  v_city int; v_city2 int;
  v_ids uuid[]; v_ids3 uuid[]; v_ids4 uuid[]; i int;
  n bigint; n2 bigint; r text := '';
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  select id into v_op from public.operations where organization_id = v_org and code = 'OP-00004';
  select id into v_merch from public.operations where organization_id = v_org and code = 'OP-00005';
  v_today := private.adherence_today(v_org);

  select s.vehicle_id, s.id, s.vehicle_type_id into v_van, v_ob, v_type
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request
   order by s.fleet_code_snapshot limit 1;
  select s.id into v_ob_ret from public.adherence_obligation_status s
   where s.organization_id = v_org and s.vehicle_id = v_van and s.operational_date = v_today and s.checklist_context = 'retorno';
  select s.id into v_yest from public.adherence_obligation_status s
   where s.organization_id = v_org and s.vehicle_id = v_van and s.operational_date = v_today - 1 and s.checklist_context = 'saida';
  select s.id into v_yest_ret from public.adherence_obligation_status s
   where s.organization_id = v_org and s.vehicle_id = v_van and s.operational_date = v_today - 1 and s.checklist_context = 'retorno';
  select v.id, a.operation_id into v_car, v_car_op
    from public.vehicles v
    join public.vehicle_types t on t.id = v.vehicle_type_id
    join public.vehicle_operation_assignments a on a.vehicle_id = v.id
     and a.effective_from <= v_today and (a.effective_to is null or a.effective_to >= v_today)
   where v.organization_id = v_org and v.deleted_at is null and v.status = 'active' and t.code = 'car'
   limit 1;

  if v_user is null or v_van is null or v_ob is null or v_ob_ret is null or v_yest is null or v_car is null then
    raise exception 'FIXTURE incompleta: user=% van=% ob=% ret=% ontem=% car=%', v_user, v_van, v_ob, v_ob_ret, v_yest, v_car;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T1
  select * into o from public.adherence_obligation_status where id = v_ob;
  if o.status_code = 'NAO_FEZ_CHECKLIST' and o.is_due and o.is_provisional and not o.is_done then
    r := r || 'PASS T1 dia vigente sem execucao: NAO_FEZ_CHECKLIST, devida e provisoria'||chr(10);
  else r := r || format('FAIL T1 status=%s due=%s prov=%s', o.status_code, o.is_due, o.is_provisional)||chr(10); end if;

  v_res := public.adherence_summary(v_org, v_today, v_today, 'saida', jsonb_build_object('vehicle_id', v_van));
  select count(*) into n from jsonb_array_elements(public.adherence_pending_list(v_org, v_today, v_today, 'saida', jsonb_build_object('vehicle_id', v_van))) x
   where (x->>'id')::uuid = v_ob;
  if (v_res->>'denominator')::int = 1 and (v_res->>'numerator')::int = 0 and n = 1 then
    r := r || 'PASS T1b pendencia listada e no denominador (0/1)'||chr(10);
  else r := r || format('FAIL T1b den=%s num=%s pend=%s', v_res->>'denominator', v_res->>'numerator', n)||chr(10); end if;

  -- T2
  select * into o from public.adherence_obligation_status
   where organization_id = v_org and vehicle_id = v_van and operational_date = v_today + 1 and checklist_context = 'saida';
  v_res := public.adherence_summary(v_org, v_today + 1, v_today + 1, 'saida', jsonb_build_object('vehicle_id', v_van));
  if o.status_code = 'PLANEJADO' and not o.is_due and (v_res->>'denominator')::int = 0 and (v_res->'adherence_pct') = 'null'::jsonb then
    r := r || 'PASS T2 amanha: PLANEJADO, denominador 0, aderencia sem base'||chr(10);
  else r := r || format('FAIL T2 status=%s due=%s den=%s pct=%s', o.status_code, o.is_due, v_res->>'denominator', v_res->>'adherence_pct')||chr(10); end if;

  -- T3
  f := public.checklist_fleet_form(v_org, v_van, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') c, jsonb_array_elements(c->'questions') q;
  v_key := 'aderencia-' || gen_random_uuid()::text;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', v_key, 'vehicle_id', v_van, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
  v_exec := (v_res->>'execution_id')::uuid;
  select * into o from public.adherence_obligation_status where id = v_ob;
  reset role;
  select count(*) into n from public.outbox_events where aggregate_id = v_exec and status = 'processed';
  set local role authenticated;
  if o.status_code = 'FEZ_CHECKLIST' and o.is_done and o.is_due and o.execution_id = v_exec and n = 1 then
    r := r || 'PASS T3 saida enviada: FEZ_CHECKLIST conciliado pelo gatilho, evento processado'||chr(10);
  else r := r || format('FAIL T3 status=%s done=%s exec=%s processed=%s', o.status_code, o.is_done, o.execution_id, n)||chr(10); end if;

  v_key := 'aderencia-' || gen_random_uuid()::text;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', v_key, 'vehicle_id', v_van, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
  v_exec2 := (v_res->>'execution_id')::uuid;
  v_res := public.adherence_summary(v_org, v_today, v_today, 'saida', jsonb_build_object('vehicle_id', v_van));
  select count(*) into n from public.checklist_obligation_matches where obligation_id = v_ob and not is_valid and invalid_reason = 'duplicate';
  select count(*) into n2 from public.adherence_inconsistencies where execution_id = v_exec2 and kind = 'duplicate_execution';
  if (v_res->>'numerator')::int = 1 and (v_res->>'denominator')::int = 1 and n = 1 and n2 = 1 then
    r := r || 'PASS T3b 1/1: segunda execucao registrada como duplicidade, sem contar duas vezes'||chr(10);
  else r := r || format('FAIL T3b num=%s den=%s dup=%s inc=%s', v_res->>'numerator', v_res->>'denominator', n, n2)||chr(10); end if;

  -- T4
  select * into o from public.adherence_obligation_status where id = v_ob_ret;
  if o.status_code in ('RETORNO_PENDENTE', 'NAO_FEZ_CHECKLIST') and not o.is_done then
    r := r || format('PASS T4 retorno nao herda a saida: %s (prazo %s)', o.status_code,
      to_char(o.deadline_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))||chr(10);
  else r := r || format('FAIL T4 status=%s done=%s', o.status_code, o.is_done)||chr(10); end if;

  reset role;
  update public.checklist_obligations set deadline_at = now() - interval '1 hour', expected_at = now() - interval '2 hours' where id = v_ob_ret;
  set local role authenticated;
  select * into o from public.adherence_obligation_status where id = v_ob_ret;
  v_res := public.adherence_summary(v_org, v_today, v_today, 'retorno', jsonb_build_object('vehicle_id', v_van));
  if o.status_code = 'NAO_FEZ_CHECKLIST' and o.is_due and (v_res->>'denominator')::int = 1 and (v_res->>'numerator')::int = 0 then
    r := r || 'PASS T4b retorno vencido: NAO_FEZ_CHECKLIST, 0/1 no contexto de retorno'||chr(10);
  else r := r || format('FAIL T4b status=%s due=%s den=%s', o.status_code, o.is_due, v_res->>'denominator')||chr(10); end if;

  -- T5
  v_res := public.request_adherence_exclusion(v_org, jsonb_build_object(
    'obligation_id', v_ob_ret, 'reason_code', 'SEM_ROTA', 'justification', 'Veiculo sem rota no periodo da tarde.'));
  v_req := (v_res->>'id')::uuid;
  select * into o from public.adherence_obligation_status where id = v_ob_ret;
  if o.status_code = 'NAO_FEZ_CHECKLIST' and o.is_due and o.has_pending_request then
    r := r || 'PASS T5 expurgo pendente: continua NAO_FEZ e devida'||chr(10);
  else r := r || format('FAIL T5 status=%s due=%s pend=%s', o.status_code, o.is_due, o.has_pending_request)||chr(10); end if;

  -- T6
  begin
    perform public.decide_adherence_request(v_org, jsonb_build_object('request_id', v_req, 'decision', 'approve'));
    r := r || 'FAIL T6 aprovou a propria solicitacao'||chr(10);
  exception when others then
    if sqlerrm like '%solicitante n_o pode decidir%' then r := r || 'PASS T6 recusou a auto-aprovacao'||chr(10);
    else r := r || 'FAIL T6 erro inesperado: ' || sqlerrm || chr(10); end if;
  end;

  -- T7
  reset role;
  update public.adherence_requests set requested_by = null where id = v_req;
  set local role authenticated;
  v_res := public.decide_adherence_request(v_org, jsonb_build_object('request_id', v_req, 'decision', 'approve', 'note', 'Confirmado com a operacao.'));
  select * into o from public.adherence_obligation_status where id = v_ob_ret;
  v_res := public.adherence_summary(v_org, v_today, v_today, 'retorno', jsonb_build_object('vehicle_id', v_van));
  select count(*) into n from public.adherence_requests
   where id = v_req and status = 'approved' and decision_effect = 'exclude' and status_code_applied = 'SEM_ROTA' and decided_by = v_user;
  if o.status_code = 'SEM_ROTA' and o.is_excluded and not o.is_due and (v_res->>'denominator')::int = 0 and n = 1 then
    r := r || 'PASS T7 expurgo aprovado: SEM_ROTA, fora do denominador, decisao registrada'||chr(10);
  else r := r || format('FAIL T7 status=%s excl=%s due=%s den=%s hist=%s', o.status_code, o.is_excluded, o.is_due, v_res->>'denominator', n)||chr(10); end if;

  -- T8
  v_res := public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', v_yest, 'reason_code', 'RESERVA', 'justification', 'Ficou de reserva.'));
  v_req2 := (v_res->>'id')::uuid;
  reset role; update public.adherence_requests set requested_by = null where id = v_req2; set local role authenticated;
  perform public.decide_adherence_request(v_org, jsonb_build_object('request_id', v_req2, 'decision', 'reject', 'note', 'Havia rota programada.'));
  select * into o from public.adherence_obligation_status where id = v_yest;
  if o.status_code = 'NAO_FEZ_CHECKLIST' and o.is_due and not o.has_pending_request then
    r := r || 'PASS T8 expurgo rejeitado: continua NAO_FEZ e elegivel'||chr(10);
  else r := r || format('FAIL T8 status=%s due=%s', o.status_code, o.is_due)||chr(10); end if;

  -- T9 (dia -2: 10 obrigacoes, 8 feitas, 1 expurgo, 1 sem nada)
  select array_agg(id order by fleet_code_snapshot) into v_ids from (
    select id, fleet_code_snapshot from public.adherence_obligation_status
     where organization_id = v_org and operation_id = v_op and operational_date = v_today - 2 and checklist_context = 'saida'
     order by fleet_code_snapshot) x;
  select array_agg(id order by fleet_code_snapshot) into v_ids3 from (
    select id, fleet_code_snapshot from public.adherence_obligation_status
     where organization_id = v_org and operation_id = v_op and operational_date = v_today - 3 and checklist_context = 'saida'
     order by fleet_code_snapshot) x;
  select array_agg(id order by fleet_code_snapshot) into v_ids4 from (
    select id, fleet_code_snapshot from public.adherence_obligation_status
     where organization_id = v_org and operation_id = v_op and operational_date = v_today - 4 and checklist_context = 'saida'
     order by fleet_code_snapshot) x;
  if cardinality(v_ids) < 10 or cardinality(v_ids3) < 2 or cardinality(v_ids4) < 8 then
    raise exception 'FIXTURE T9: Last Mille MG com %/%/% obrigacoes nos dias -2/-3/-4', cardinality(v_ids), cardinality(v_ids3), cardinality(v_ids4);
  end if;
  reset role;
  update public.checklist_obligations set is_active = false, retired_at = now(), retired_reason = 'teste' where id = any (v_ids[11:cardinality(v_ids)]);
  for i in 1..8 loop
    insert into public.adherence_requests (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference, source, status, requested_by, decided_by, decided_at, decision_effect, status_code_applied)
    select v_org, v_ids[i], rs.id, 'saida', 'Checklist em papel digitalizado.', 'DOC-' || i, 'import', 'approved', null, v_user, now(), 'count_done', 'FEZ_CHECKLIST'
      from public.adherence_exclusion_reasons rs where rs.organization_id = v_org and rs.code = 'EXECUCAO_COMPROVADA';
  end loop;
  insert into public.adherence_requests (organization_id, obligation_id, reason_id, checklist_context, justification, source, status, requested_by, decided_by, decided_at, decision_effect, status_code_applied)
  select v_org, v_ids[9], rs.id, 'saida', 'Em manutencao preventiva.', 'import', 'approved', null, v_user, now(), 'exclude', 'MANUTENCAO'
    from public.adherence_exclusion_reasons rs where rs.organization_id = v_org and rs.code = 'MANUTENCAO';
  set local role authenticated;
  v_res := public.adherence_summary(v_org, v_today - 2, v_today - 2, 'saida', jsonb_build_object('operation_id', v_op));
  if (v_res->>'numerator')::int = 8 and (v_res->>'denominator')::int = 9 and (v_res->>'adherence_pct')::numeric = 88.89 then
    r := r || 'PASS T9 formula: 8/9 = 88,89% na visao consolidada'||chr(10);
  else r := r || format('FAIL T9 num=%s den=%s pct=%s', v_res->>'numerator', v_res->>'denominator', v_res->>'adherence_pct')||chr(10); end if;

  select x into v_res from jsonb_array_elements(public.adherence_heatmap(v_org, extract(year from v_today - 2)::int, extract(month from v_today - 2)::int, 'saida', jsonb_build_object('operation_id', v_op))) x
   where (x->>'date')::date = v_today - 2;
  select count(*) into n from jsonb_array_elements(public.adherence_matrix(v_org, extract(year from v_today - 2)::int, extract(month from v_today - 2)::int, 'saida', jsonb_build_object('operation_id', v_op), 1, 50)->'rows') row_
   where row_->'days'->(extract(day from v_today - 2)::int::text)->>'status' = 'FEZ_CHECKLIST';
  if (v_res->>'numerator')::int = 8 and (v_res->>'denominator')::int = 9 and (v_res->>'adherence_pct')::numeric = 88.89 and n = 8 then
    r := r || 'PASS T9b heatmap 8/9 = 88,89% e matriz com 8 celulas FEZ_CHECKLIST no dia'||chr(10);
  else r := r || format('FAIL T9b heat num=%s den=%s pct=%s matriz_fez=%s', v_res->>'numerator', v_res->>'denominator', v_res->>'adherence_pct', n)||chr(10); end if;

  -- T9c (dia -4: 8/8; dia -3: 1/2) -> 9/10 = 90%
  reset role;
  update public.checklist_obligations set is_active = false, retired_at = now(), retired_reason = 'teste' where id = any (v_ids4[9:cardinality(v_ids4)]);
  for i in 1..8 loop
    insert into public.adherence_requests (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference, source, status, requested_by, decided_by, decided_at, decision_effect, status_code_applied)
    select v_org, v_ids4[i], rs.id, 'saida', 'Checklist em papel.', 'DOC-4' || i, 'import', 'approved', null, v_user, now(), 'count_done', 'FEZ_CHECKLIST'
      from public.adherence_exclusion_reasons rs where rs.organization_id = v_org and rs.code = 'EXECUCAO_COMPROVADA';
  end loop;
  update public.checklist_obligations set is_active = false, retired_at = now(), retired_reason = 'teste' where id = any (v_ids3[3:cardinality(v_ids3)]);
  insert into public.adherence_requests (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference, source, status, requested_by, decided_by, decided_at, decision_effect, status_code_applied)
  select v_org, v_ids3[1], rs.id, 'saida', 'Checklist em papel.', 'DOC-3', 'import', 'approved', null, v_user, now(), 'count_done', 'FEZ_CHECKLIST'
    from public.adherence_exclusion_reasons rs where rs.organization_id = v_org and rs.code = 'EXECUCAO_COMPROVADA';
  set local role authenticated;
  v_res := public.adherence_summary(v_org, v_today - 4, v_today - 3, 'saida', jsonb_build_object('operation_id', v_op));
  if (v_res->>'numerator')::int = 9 and (v_res->>'denominator')::int = 10 and (v_res->>'adherence_pct')::numeric = 90.00 then
    r := r || 'PASS T9c consolidado por soma: 1/2 + 8/8 = 9/10 = 90% (a media simples daria 75%)'||chr(10);
  else r := r || format('FAIL T9c num=%s den=%s pct=%s', v_res->>'numerator', v_res->>'denominator', v_res->>'adherence_pct')||chr(10); end if;

  -- T10
  select city_id, id into v_city, v_old from public.checklist_obligations
   where organization_id = v_org and vehicle_id = v_van and operational_date = v_today - 5 and checklist_context = 'saida';
  v_res := public.reconcile_adherence_period(v_org, jsonb_build_object(
    'date_from', v_today - 5, 'date_to', v_today - 5, 'operation_id', v_op, 'preview', false, 'reason', 'Teste de idempotencia.'));
  select city_id into v_city2 from public.checklist_obligations where id = v_old and is_active;
  if (v_res->>'create')::int = 0 and (v_res->>'retire')::int = 0 and (v_res->>'reactivate')::int = 0
     and (v_res->>'unchanged')::int = (v_res->>'expected')::int and v_city2 = v_city then
    r := r || format('PASS T10 reprocessar sem mudanca: %s esperadas, %s inalteradas, 0 criadas, 0 aposentadas; cidade preservada', v_res->>'expected', v_res->>'unchanged')||chr(10);
  else r := r || format('FAIL T10 %s cidade %s->%s', v_res::text, v_city, v_city2)||chr(10); end if;

  -- T11
  perform public.save_adherence_rule(v_org, jsonb_build_object(
    'name', 'Teste: vans sem obrigacao', 'vehicle_type_id', v_type, 'requires_checklist', false, 'priority', 1, 'valid_from', v_today));
  v_res := public.reconcile_adherence_period(v_org, jsonb_build_object('date_from', v_today - 1, 'date_to', v_today - 1, 'operation_id', v_op, 'preview', true));
  v_res2 := public.reconcile_adherence_period(v_org, jsonb_build_object('date_from', v_today, 'date_to', v_today, 'operation_id', v_op, 'preview', true));
  if (v_res->>'retire_candidates')::int = 0 and (v_res2->>'retire_candidates')::int > 0 and (v_res2->>'protected')::int >= 1 then
    r := r || format('PASS T11 regra valida de hoje: ontem intacto; hoje %s candidatas a aposentar e %s protegidas (execucao/decisao)', v_res2->>'retire_candidates', v_res2->>'protected')||chr(10);
  else r := r || format('FAIL T11 ontem=%s hoje=%s', v_res::text, v_res2::text)||chr(10); end if;

  -- T12
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into n from public.adherence_obligation_status where organization_id = v_org;
  v_res := public.adherence_summary(v_org, v_today, v_today, 'saida', '{}'::jsonb);
  begin
    perform public.request_adherence_exclusion(v_org, jsonb_build_object('obligation_id', v_yest_ret, 'reason_code', 'SEM_ROTA', 'justification', 'tentativa de fora'));
    r := r || 'FAIL T12 usuario sem vinculo solicitou'||chr(10);
  exception when others then
    if n = 0 and (v_res->>'obligations')::int = 0 then r := r || 'PASS T12 usuario sem vinculo: 0 obrigacoes visiveis e solicitacao recusada'||chr(10);
    else r := r || format('FAIL T12 visiveis=%s', n)||chr(10); end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.reconcile_adherence_period(gen_random_uuid(), jsonb_build_object('date_from', v_today, 'date_to', v_today, 'preview', true));
    r := r || 'FAIL T12b reconciliou organizacao fora do vinculo'||chr(10);
  exception when others then r := r || 'PASS T12b RPC privilegiada recusa organizacao fora do vinculo'||chr(10); end;

  -- T13
  begin
    perform public.override_adherence_status(v_org, jsonb_build_object('obligation_id', v_yest, 'reason_code', 'EXECUCAO_COMPROVADA', 'justification', 'Tentativa de marcar como feito sem evidencia.'));
    r := r || 'FAIL T13 correcao marcou como feito'||chr(10);
  exception when others then r := r || 'PASS T13 correcao administrativa recusa "contar como feito"'||chr(10); end;
  perform public.override_adherence_status(v_org, jsonb_build_object('obligation_id', v_yest, 'reason_code', 'EM_VIAGEM', 'justification', 'Veiculo em viagem interestadual, comprovado pelo roteiro.'));
  select * into o from public.adherence_obligation_status where id = v_yest;
  select count(*) into n from public.adherence_requests where obligation_id = v_yest and is_override and status = 'approved';
  if o.status_code = 'EM_VIAGEM' and o.is_excluded and n = 1 then
    r := r || 'PASS T13b correcao com motivo elegivel e justificativa: EM_VIAGEM, marcada como override'||chr(10);
  else r := r || format('FAIL T13b status=%s excl=%s n=%s', o.status_code, o.is_excluded, n)||chr(10); end if;

  -- T14
  v_res := public.bulk_adherence_override(v_org, jsonb_build_object(
    'obligation_ids', jsonb_build_array(v_ob, v_ob_ret, v_ids4[1], v_yest_ret),
    'reason_code', 'SEM_ROTA', 'justification', 'Regularizacao em massa de teste.', 'dry_run', true));
  if (v_res->>'preview')::boolean and (v_res->'counts'->>'applied')::int = 1 and (v_res->'counts'->>'has_execution')::int = 2
     and (v_res->'counts'->>'already_excluded')::int = 1 then
    v_res2 := public.bulk_adherence_override(v_org, jsonb_build_object(
      'obligation_ids', jsonb_build_array(v_ob, v_ob_ret, v_ids4[1], v_yest_ret),
      'reason_code', 'SEM_ROTA', 'justification', 'Regularizacao em massa de teste.', 'dry_run', false));
    select * into o from public.adherence_obligation_status where id = v_yest_ret;
    if (v_res2->'counts'->>'applied')::int = 1 and o.is_excluded then
      r := r || 'PASS T14 alteracao em massa: previa 1 elegivel/2 com execucao/1 ja expurgada; aplicou so a elegivel'||chr(10);
    else r := r || format('FAIL T14 aplicar %s', v_res2::text)||chr(10); end if;
  else r := r || format('FAIL T14 previa %s', v_res::text)||chr(10); end if;

  -- T15
  perform public.set_adherence_target(v_org, jsonb_build_object('target_pct', 90, 'valid_from', v_today - 10));
  v_res := public.adherence_summary(v_org, v_today - 4, v_today - 3, 'saida', jsonb_build_object('operation_id', v_op));
  if (v_res->>'target_pct')::numeric = 90 and (v_res->>'gap_pct')::numeric = 0 then
    r := r || 'PASS T15 meta parametrizada: 90% vs meta 90% = diferenca 0'||chr(10);
  else r := r || format('FAIL T15 target=%s gap=%s', v_res->>'target_pct', v_res->>'gap_pct')||chr(10); end if;

  -- T16
  -- Frota Leve ADM e isenta por regra (sem obrigacao). Desde a Etapa 12 o tipo
  -- precisa estar habilitado no aplicativo para o formulario abrir: o vinculo
  -- e ligado so nesta transacao, para a execucao chegar pelo caminho oficial.
  select a2.id into v_app from public.operational_apps a2
   where a2.organization_id = v_org and a2.slug = 'check-list-frota' and a2.deleted_at is null;
  select v.vehicle_type_id into v_car_type from public.vehicles v where v.id = v_car;
  perform public.set_application_vehicle_type_link(v_org, jsonb_build_object(
    'app_id', v_app, 'vehicle_type_id', v_car_type, 'is_enabled', true, 'effective_from', v_today));
  f := public.checklist_fleet_form(v_org, v_car, v_car_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') c, jsonb_array_elements(c->'questions') q;
  v_key := 'aderencia-' || gen_random_uuid()::text;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', v_key, 'vehicle_id', v_car, 'operation_id', v_car_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
  v_exec := (v_res->>'execution_id')::uuid;
  reset role;
  select count(*) into n from public.checklist_obligations where organization_id = v_org and vehicle_id = v_car and operational_date = v_today;
  select count(*) into n2 from public.adherence_inconsistencies where execution_id = v_exec and kind = 'execution_without_obligation' and status = 'open';
  if n = 0 and n2 = 1 then
    r := r || 'PASS T16 checklist de veiculo sem obrigacao: inconsistencia aberta, nenhuma obrigacao inventada'||chr(10);
  else r := r || format('FAIL T16 obrigacoes=%s inconsistencias=%s', n, n2)||chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 2 · Importação de bases externas (§54–§56)
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_ob record; v_res jsonb; v_res2 jsonb; n int; n2 int; n3 int; r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.adherence_today(v_org);
  select s.* into v_ob from public.adherence_obligation_status s
   where s.organization_id = v_org and s.operational_date = v_today - 1 and s.checklist_context = 'saida' and s.status_code = 'NAO_FEZ_CHECKLIST' and not s.has_pending_request
   order by s.fleet_code_snapshot limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_res := public.stage_adherence_import(v_org, jsonb_build_object(
    'file_name', 'teste.xlsx', 'file_hash', repeat('a', 64), 'file_size', 1234, 'column_mapping', '{}'::jsonb,
    'rows', jsonb_build_array(
      jsonb_build_object('row_number', 2, 'fleet_code', v_ob.fleet_code_snapshot, 'operational_date', v_today - 1, 'context', 'Saída', 'status', 'Sem rota', 'justification', 'Sem rota programada.'),
      jsonb_build_object('row_number', 3, 'fleet_code', v_ob.fleet_code_snapshot, 'operational_date', v_today - 1, 'context', 'retorno', 'status', 'xyz'),
      jsonb_build_object('row_number', 4, 'fleet_code', 'ZZZ999', 'operational_date', v_today - 1, 'status', 'Manutenção', 'evidence_reference', 'OS 1'),
      jsonb_build_object('row_number', 5, 'fleet_code', v_ob.fleet_code_snapshot, 'operational_date', v_today + 3, 'status', 'FEZ'),
      jsonb_build_object('row_number', 6, 'fleet_code', v_ob.fleet_code_snapshot, 'operational_date', v_today - 2, 'status', 'Manutenção')
    )));
  if (v_res->>'valid_rows')::int = 1 and (v_res->>'error_rows')::int = 4 and (v_res->>'total_rows')::int = 5 then
    r := r || 'PASS I1 previa: 1 valida, 4 erros (status desconhecido, veiculo desconhecido, data futura, evidencia obrigatoria)'||chr(10);
  else r := r || 'FAIL I1 ' || v_res::text || chr(10); end if;

  v_res2 := public.process_adherence_import(v_org, (v_res->>'batch_id')::uuid);
  select count(*) into n from public.adherence_requests q where q.import_batch_id = (v_res->>'batch_id')::uuid and q.status = 'pending' and q.requested_by is null and q.source = 'import';
  reset role;
  select count(*) into n2 from public.adherence_inconsistencies i where i.details ->> 'batch_id' = v_res->>'batch_id' and i.kind = 'import_unknown_status';
  select count(*) into n3 from public.adherence_inconsistencies i where i.details ->> 'batch_id' = v_res->>'batch_id' and i.kind = 'import_unknown_vehicle';
  set local role authenticated;
  if (v_res2->>'requests_created')::int = 1 and n = 1 and n2 = 1 and n3 = 1 then
    r := r || 'PASS I2 processamento: 1 solicitacao PENDENTE (sem solicitante), 1 inconsistencia de status, 1 de veiculo; nada aprovado'||chr(10);
  else r := r || format('FAIL I2 %s req=%s inc_status=%s inc_vehicle=%s', v_res2::text, n, n2, n3)||chr(10); end if;

  begin
    perform public.process_adherence_import(v_org, (v_res->>'batch_id')::uuid);
    r := r || 'FAIL I3 reprocessou lote concluido'||chr(10);
  exception when others then r := r || 'PASS I3 lote concluido nao reprocessa'||chr(10); end;
  v_res := public.stage_adherence_import(v_org, jsonb_build_object(
    'file_name', 'teste.xlsx', 'file_hash', repeat('a', 64), 'rows', jsonb_build_array(
      jsonb_build_object('row_number', 2, 'fleet_code', v_ob.fleet_code_snapshot, 'operational_date', v_today - 1, 'context', 'saida', 'status', 'Sem rota'))));
  if (v_res->>'already_imported')::boolean and (v_res->>'warning_rows')::int = 1 and (v_res->>'valid_rows')::int = 0 then
    r := r || 'PASS I4 mesmo arquivo de novo: avisa que ja foi importado e a linha vira conflito com pendente (idempotente)'||chr(10);
  else r := r || 'FAIL I4 ' || v_res::text || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
