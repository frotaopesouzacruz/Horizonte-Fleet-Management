-- =============================================================================
-- 30 · Aderência — importação do histórico de Check List
--
-- Suíte transacional contra o banco COM DADOS: usa um veículo com obrigação
-- de saída em aberto nos últimos dias, um colaborador real e o catálogo
-- publicado. Não cria veículo, colaborador nem pergunta. Termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: devolve o resultado e
-- desfaz tudo o que fez.
--
--   H1  layout: catálogo publicado com perguntas, condicionais e status
--   H2  prévia: Fez com colaborador vira execução; Sem rota vira exceção
--       autorizada (quem tem override e pediu); Não fez não grava; placa e
--       status desconhecidos recusados; data futura recusada; Fez sem
--       colaborador vira solicitação pendente de execução comprovada
--   H3  processamento: execução oficial com respostas e conformidade por
--       pergunta, conciliada pelo gatilho (FEZ_CHECKLIST), evento processado,
--       Planos de Ação ingeriram a inconformidade; expurgo aplicado como
--       exceção autorizada com origem import; solicitação pendente aberta
--   H4  reimportar o mesmo dia não duplica a execução
--   H5  o que não foi entendido vira inconsistência
--   H6  histórico de importações lista o lote com o tipo
--
-- Última execução: 9/9 PASS contra o projeto de produção (02/10/2026), com
-- rollback. A execução importada teve 33 respostas (34 perguntas, 1 N/A).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_emp record; v_ob record; v_ob2 record; v_ob3 record;
  v_layout jsonb; v_res jsonb; v_res2 jsonb; v_batch uuid; v_exec uuid;
  v_q_freio text := 'luzes.freio'; v_q_pneus text := 'pneus.dianteiros';
  v_answers jsonb; v_rows jsonb;
  o record; e record;
  n bigint; n2 bigint; n3 bigint; r text := ''; i int;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null
   order by m.joined_at nulls last, m.created_at limit 1;
  v_today := private.adherence_today(v_org);
  select e2.id, e2.employee_code, e2.full_name into v_emp from public.employees e2
   where e2.organization_id = v_org and e2.deleted_at is null and e2.employee_code is not null order by e2.employee_code limit 1;

  -- três obrigações de saída em aberto, de veículos distintos, nos últimos dias
  select s.* into v_ob from public.adherence_obligation_status s
   where s.organization_id = v_org and s.checklist_context = 'saida' and s.status_code = 'NAO_FEZ_CHECKLIST'
     and s.operational_date between v_today - 20 and v_today - 2 and not s.has_pending_request
   order by s.operational_date desc, s.license_plate_snapshot limit 1;
  select s.* into v_ob2 from public.adherence_obligation_status s
   where s.organization_id = v_org and s.checklist_context = 'saida' and s.status_code = 'NAO_FEZ_CHECKLIST'
     and s.operational_date = v_ob.operational_date and s.vehicle_id <> v_ob.vehicle_id and not s.has_pending_request
   order by s.license_plate_snapshot limit 1;
  select s.* into v_ob3 from public.adherence_obligation_status s
   where s.organization_id = v_org and s.checklist_context = 'saida' and s.status_code = 'NAO_FEZ_CHECKLIST'
     and s.operational_date = v_ob.operational_date and s.vehicle_id not in (v_ob.vehicle_id, v_ob2.vehicle_id) and not s.has_pending_request
   order by s.license_plate_snapshot limit 1;
  if v_ob.id is null or v_ob2.id is null or v_ob3.id is null or v_emp.id is null then
    raise exception E'ROLLBACK_TESTES\nSEM FIXTURE: precisa de 3 obrigacoes de saida em aberto no mesmo dia e um colaborador.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- H1
  v_layout := public.checklist_history_import_layout(v_org);
  select count(*) into n from jsonb_array_elements(v_layout -> 'questions');
  select count(*) into n2 from jsonb_array_elements(v_layout -> 'questions') q where q -> 'conditional' <> 'null'::jsonb;
  if n >= 30 and n2 >= 5 and jsonb_array_length(v_layout -> 'statuses') = 8
     and exists (select 1 from jsonb_array_elements(v_layout -> 'questions') q where q ->> 'question_key' = v_q_freio) then
    r := r || format('PASS H1 layout: %s perguntas, %s condicionais, 8 status, versao %s', n, n2, v_layout -> 'version' ->> 'label')||chr(10);
  else r := r || format('FAIL H1 perguntas=%s cond=%s status=%s', n, n2, jsonb_array_length(v_layout -> 'statuses'))||chr(10); end if;

  -- respostas: tudo conforme, menos luzes de freio (nao, lado esquerdo) e pneus dianteiros N/A
  select jsonb_object_agg(q ->> 'question_key',
           case when q ->> 'question_key' = v_q_freio then 'no'
                when q ->> 'question_key' = v_q_pneus then 'na'
                else q ->> 'conforming_answer' end)
    into v_answers from jsonb_array_elements(v_layout -> 'questions') q;

  -- H2
  v_rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'license_plate', v_ob.license_plate_snapshot, 'operational_date', v_ob.operational_date, 'context', 'Saída',
                       'status', 'Fez Check List', 'employee_code', v_emp.employee_code, 'employee_name', v_emp.full_name,
                       'answers', v_answers, 'conditionals', jsonb_build_object(v_q_freio, jsonb_build_object('lado_falha', 'esquerdo')), 'notes', '{}'::jsonb),
    jsonb_build_object('row_number', 3, 'license_plate', v_ob2.license_plate_snapshot, 'operational_date', v_ob2.operational_date, 'status', 'Sem Rota'),
    jsonb_build_object('row_number', 4, 'license_plate', v_ob3.license_plate_snapshot, 'operational_date', v_ob3.operational_date, 'status', 'Não Fez Check List'),
    jsonb_build_object('row_number', 5, 'license_plate', 'ZZZ9Z99', 'operational_date', v_ob.operational_date, 'status', 'Fez Check List'),
    jsonb_build_object('row_number', 6, 'license_plate', v_ob.license_plate_snapshot, 'operational_date', v_ob.operational_date, 'status', 'talvez'),
    jsonb_build_object('row_number', 7, 'license_plate', v_ob.license_plate_snapshot, 'operational_date', v_today + 5, 'status', 'Sem Rota'),
    jsonb_build_object('row_number', 8, 'license_plate', v_ob3.license_plate_snapshot, 'operational_date', v_ob3.operational_date - 1, 'status', 'Fez Check List',
                       'employee_code', '000000', 'employee_name', 'Motorista Inexistente Teste', 'answers', v_answers));
  v_res := public.stage_checklist_history_import(v_org, jsonb_build_object(
    'file_name', 'historico-teste.xlsx', 'file_hash', repeat('b', 64), 'file_size', 999, 'apply_exclusions', true, 'rows', v_rows));
  v_batch := (v_res ->> 'batch_id')::uuid;
  if (v_res ->> 'total_rows')::int = 7 and (v_res ->> 'executions')::int = 1 and (v_res ->> 'overrides')::int = 1
     and (v_res ->> 'requests')::int = 1 and (v_res ->> 'no_change')::int = 1 and (v_res ->> 'error_rows')::int = 3
     and (v_res ->> 'apply_exclusions')::boolean and jsonb_array_length(v_res -> 'unknown_employees') = 1 then
    r := r || 'PASS H2 previa: 1 execucao, 1 expurgo autorizado, 1 solicitacao (colaborador desconhecido), 1 nao fez, 3 erros (placa, status, data futura)'||chr(10);
  else r := r || 'FAIL H2 ' || (v_res - 'findings' - 'sample')::text || chr(10); end if;

  -- H3
  i := 0;
  loop
    v_res2 := public.process_checklist_history_import(v_org, v_batch, 50);
    i := i + 1;
    exit when (v_res2 ->> 'done')::boolean or i > 20;
  end loop;
  select e2.* into e from public.checklist_executions e2 where e2.import_batch_id = v_batch;
  v_exec := e.id;
  select count(*) into n from public.checklist_execution_answers a where a.execution_id = v_exec;
  select count(*) into n2 from public.checklist_execution_answers a where a.execution_id = v_exec and not a.is_conforming;
  select o2.* into o from public.adherence_obligation_status o2 where o2.id = v_ob.id;
  reset role;
  select count(*) into n3 from public.outbox_events x where x.aggregate_id = v_exec and x.status = 'processed';
  set local role authenticated;
  if (v_res2 ->> 'done')::boolean and (v_res2 ->> 'executions_created')::int = 1 and e.status = 'submitted' and e.source = 'import'
     and e.employee_id = v_emp.id and n >= 25 and n2 = 1 and e.non_conforming_answers = 1 and e.critical_non_conforming = 1
     and o.status_code = 'FEZ_CHECKLIST' and o.is_done and o.execution_id = v_exec and n3 = 1 then
    r := r || format('PASS H3a execucao oficial: %s respostas, 1 inconforme critica, FEZ_CHECKLIST conciliado pelo gatilho, evento processado', n)||chr(10);
  else r := r || format('FAIL H3a res=%s status=%s src=%s ans=%s nc=%s obl=%s done=%s ev=%s', v_res2::text, e.status, e.source, n, n2, o.status_code, o.is_done, n3)||chr(10); end if;

  reset role;
  select count(*) into n from public.action_plan_ingestions g where g.execution_id = v_exec and g.status = 'processed' and g.findings = 1;
  select count(*) into n2 from public.action_plan_items it where it.checklist_execution_id = v_exec;
  set local role authenticated;
  if n = 1 and n2 >= 1 then
    r := r || format('PASS H3b Planos de Acao ingeriram a execucao importada: 1 inconformidade, %s apontamento(s)', n2)||chr(10);
  else r := r || format('FAIL H3b ingestions=%s items=%s', n, n2)||chr(10); end if;

  select o2.* into o from public.adherence_obligation_status o2 where o2.id = v_ob2.id;
  select count(*) into n from public.adherence_requests q where q.obligation_id = v_ob2.id and q.status = 'approved' and q.is_override and q.source = 'import' and q.import_batch_id is null and q.decided_by = v_user;
  if o.status_code = 'SEM_ROTA' and o.is_excluded and n = 1 and (v_res2 ->> 'overrides_applied')::int = 1 then
    r := r || 'PASS H3c expurgo aplicado como excecao autorizada (override, origem import, decidido pelo importador)'||chr(10);
  else r := r || format('FAIL H3c status=%s excl=%s req=%s res=%s', o.status_code, o.is_excluded, n, v_res2 ->> 'overrides_applied')||chr(10); end if;

  select count(*) into n from public.adherence_requests q join public.adherence_exclusion_reasons rs on rs.id = q.reason_id
   where q.import_batch_id = v_batch and q.status = 'pending' and q.requested_by is null and rs.code = 'EXECUCAO_COMPROVADA' and q.evidence_reference like 'Histórico de Check List%';
  select o2.* into o from public.adherence_obligation_status o2 where o2.id = v_ob3.id;
  if (v_res2 ->> 'requests_created')::int = 1 and n = 1 and o.status_code = 'NAO_FEZ_CHECKLIST' and not o.is_done then
    r := r || 'PASS H3d Fez sem colaborador: solicitacao pendente de execucao comprovada; Nao fez continua NAO_FEZ'||chr(10);
  else r := r || format('FAIL H3d req=%s n=%s ob3=%s', v_res2 ->> 'requests_created', n, o.status_code)||chr(10); end if;

  -- H4
  v_res := public.stage_checklist_history_import(v_org, jsonb_build_object(
    'file_name', 'historico-teste.xlsx', 'file_hash', repeat('b', 64), 'file_size', 999, 'apply_exclusions', true,
    'rows', jsonb_build_array(v_rows -> 0)));
  i := 0;
  loop
    v_res2 := public.process_checklist_history_import(v_org, (v_res ->> 'batch_id')::uuid, 50);
    i := i + 1;
    exit when (v_res2 ->> 'done')::boolean or i > 20;
  end loop;
  select count(*) into n from public.checklist_executions e2 where e2.vehicle_id = v_ob.vehicle_id and e2.operational_date = v_ob.operational_date and e2.checklist_type = 'saida';
  if (v_res ->> 'already_imported')::boolean and (v_res ->> 'warning_rows')::int = 1 and (v_res ->> 'executions')::int = 0 and n = 1 and (v_res2 ->> 'executions_created')::int = 0 then
    r := r || 'PASS H4 reimportar o mesmo dia: avisa que ja foi importado, nenhuma execucao duplicada'||chr(10);
  else r := r || format('FAIL H4 already=%s warn=%s exec=%s n=%s created=%s', v_res ->> 'already_imported', v_res ->> 'warning_rows', v_res ->> 'executions', n, v_res2 ->> 'executions_created')||chr(10); end if;

  -- H5
  reset role;
  select count(*) into n from public.adherence_inconsistencies x where x.details ->> 'batch_id' = v_batch::text and x.kind = 'import_unknown_vehicle';
  select count(*) into n2 from public.adherence_inconsistencies x where x.details ->> 'batch_id' = v_batch::text and x.kind = 'import_unknown_status';
  set local role authenticated;
  if n = 1 and n2 = 1 then r := r || 'PASS H5 placa e status desconhecidos viraram inconsistencias'||chr(10);
  else r := r || format('FAIL H5 veh=%s status=%s', n, n2)||chr(10); end if;

  -- H6
  v_res := public.adherence_import_history(v_org, 5);
  if exists (select 1 from jsonb_array_elements(v_res) b where (b ->> 'id')::uuid = v_batch and b ->> 'type' = 'checklist_history' and b ->> 'status' = 'completed'
                                                             and (b -> 'summary' ->> 'executions_created')::int = 1) then
    r := r || 'PASS H6 historico de importacoes lista o lote como Historico de Check List, concluido'||chr(10);
  else r := r || 'FAIL H6 ' || left(v_res::text, 300) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
