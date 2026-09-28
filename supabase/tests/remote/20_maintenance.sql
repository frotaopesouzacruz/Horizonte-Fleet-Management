-- =============================================================================
-- 20 · Manutenção (Etapa 16) — testes obrigatórios 93–105
--      (migrations 20260928100000 … 20260928105000_maintenance_*)
--
-- Suíte transacional contra o banco COM DADOS: usa a organização, os veículos
-- ativos, a fidelização (BR, operação, liderança) e o KM oficial reais. Tudo o
-- que ela cria — clusters, serviços, fornecedor, regra preventiva, plano
-- preditivo, manutenções, leituras de KM de teste, uma execução de Check List
-- de teste, um veículo sem leitura, uma segunda organização e os perfis
-- simulados — existe só dentro da transação: o bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, e nada persiste.
--
-- O único membro real é personificado por `request.jwt.claims`; os perfis
-- (Operacional, Liderança com escopo, Gestor de Frota, Gestão, Gente/sem
-- permissão) são simulados trocando o papel dele DENTRO da transação, com a
-- marca das rotinas de administração de acesso, como na suíte 17. As leituras
-- que dependem de RLS rodam como `authenticated`.
--
--   T93  Corretiva: abrir → agendar → iniciar → concluir; trilha completa
--        (∅→Há agendar→Agendado→Em execução→Concluído) e TMM pela entrada e
--        saída REAIS (nunca pela solicitação)
--   T94  Reprogramação: motivo obrigatório; evento com antes/depois e motivo
--   T95  Preventiva: veículo perto do marco = A programar; gerar; gerar de
--        novo não duplica
--   T96  Preventiva crítica: KM além da tolerância = Crítica, e o destaque
--        gerencial (preventive_critical) a conta
--   T97  Preditiva: item em A programar; gerar; manutenção ligada ao ciclo e
--        ao item; gerar de novo não duplica
--   T98  Plano de Ação / inconformidade: apontamento inconforme do Check List →
--        serviço sugerido pelo mapeamento Serviços × Check List → manutenção
--        com veículo, cluster, serviço, BR e contexto histórico; conclusão
--        resolve o apontamento
--   T99  KM: automático (validado e estimado), manual, divergente (não
--        bloqueia), ausente e data futura
--   T100 Duplicidade: equivalente em aberto bloqueia; justificativa libera;
--        complemento via add_items
--   T101 Multisserviços: itens persistidos com cluster/serviço e rastreáveis
--   T102 Fornecedor: vinculado, concluído, presente nos indicadores
--   T103 Reincidência: mesmo veículo + cluster na janela = possível
--        reincidência (detalhe, painel e histórico do veículo)
--   T104 Importação: importar, reimportar, idempotência
--   T105 Segurança: Operacional, Liderança (escopo), Gestor de Frota, Gestão,
--        Administrador, sem permissão e outro tenant
--   (T106, regressão, é coberta pelas suítes 09–19 e pelo Playwright.)
-- =============================================================================

do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_admin_role uuid; v_today date;
  v_a record; v_b record; v_c record; v_f record;
  c_fre uuid; c_mot uuid; s_pas uuid; s_dis uuid; s_rev uuid; s_insp uuid; v_sup uuid;
  j jsonb; k jsonb; r1 uuid; r2 uuid; r3 uuid; v_id uuid; v_cycle uuid; v_plan uuid; v_item uuid; v_pc uuid;
  v_items jsonb; v_it record; v_app uuid; v_ver uuid; v_q record; v_emp uuid; v_exec uuid; v_ans uuid;
  v_org2 uuid; v_novo uuid; n int; n2 int; txt text; ok boolean; ok2 boolean; ok3 boolean;
  v_role uuid; v_batch uuid; v_rows jsonb; v_exec_status text;
  r text := '';
begin
  -- ---------------------------------------------------------------- setup --
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' limit 1;
  select mr.role_id into v_admin_role from public.membership_roles mr where mr.membership_id = v_mem limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_today := private.maintenance_today(v_org);

  -- A: veículo ativo com BR titular vigente há ≥ 7 dias; B: outro veículo, de OUTRA operação.
  select v.id, v.fleet_code, v.license_plate, v.vehicle_type_id, b.id as br_id, b.code as br_code, b.operation_id
    into v_a
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id and b.deleted_at is null
    join public.vehicles v on v.id = a.vehicle_id and v.status = 'active' and v.deleted_at is null
   where a.organization_id = v_org and a.status <> 'cancelled' and a.vehicle_role = 'primary'
     and a.start_date <= v_today - 7 and (a.end_date is null or a.end_date >= v_today)
   order by b.code limit 1;
  select v.id, v.fleet_code, v.license_plate, v.vehicle_type_id, b.id as br_id, b.operation_id
    into v_b
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id and b.deleted_at is null
    join public.vehicles v on v.id = a.vehicle_id and v.status = 'active' and v.deleted_at is null
   where a.organization_id = v_org and a.status <> 'cancelled' and a.vehicle_role = 'primary'
     and a.start_date <= v_today - 7 and (a.end_date is null or a.end_date >= v_today)
     and b.operation_id <> v_a.operation_id
   order by b.code limit 1;
  -- C: veículo de outro tipo ou o de menor KM do tipo de A (preventiva); F: veículo para os casos de KM.
  select v.id, v.vehicle_type_id, r.odometer_km as km into v_c
    from public.vehicles v join public.vehicle_odometer_readings r on r.vehicle_id = v.id and r.superseded_by is null
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.id not in (v_a.id, v_b.id)
     and private.vehicle_in_scope(v_org, v.id) and r.odometer_km > 5000
   order by r.odometer_km limit 1;
  select v.id, r.odometer_km as km, r.reading_date into v_f
    from public.vehicles v join public.vehicle_odometer_readings r on r.vehicle_id = v.id and r.superseded_by is null
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.id not in (v_a.id, v_b.id, v_c.id)
     and private.vehicle_in_scope(v_org, v.id) and r.odometer_km > 10000
   order by r.odometer_km desc limit 1;
  if v_a.id is null or v_b.id is null or v_c.id is null or v_f.id is null then
    raise exception 'FIXTURE incompleta: A=% B=% C=% F=%', v_a.id, v_b.id, v_c.id, v_f.id;
  end if;

  c_fre := public.maintenance_save_cluster(v_org, '{"name":"Suite20 Freios","default_criticality":"critical"}');
  c_mot := public.maintenance_save_cluster(v_org, '{"name":"Suite20 Motor"}');
  s_pas := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_fre, 'name', 'Suite20 Troca de pastilhas', 'expected_hours', 3));
  s_dis := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_fre, 'name', 'Suite20 Retífica de discos', 'expected_hours', 5));
  s_rev := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_mot, 'name', 'Suite20 Revisão preventiva',
             'maintenance_type_codes', jsonb_build_array('preventive')));
  s_insp := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_mot, 'name', 'Suite20 Inspeção de correia', 'is_predictive', true));
  v_sup := public.maintenance_save_supplier(v_org, '{"name":"Suite20 Oficina Central","document_number":"11.222.333/0001-81"}');

  -- ------------------------------------------------------------ T93/T101 --
  begin
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_a.id, 'maintenance_type_code', 'corrective',
           'origin_code', 'operation', 'priority', 'high', 'service_ids', jsonb_build_array(s_pas, s_dis),
           'description', 'Suite20: ruído ao frear', 'requested_on', v_today - 6));
    r1 := (j ->> 'id')::uuid;
    perform public.maintenance_schedule(r1, jsonb_build_object('scheduled_date', v_today - 4, 'scheduled_time', '08:00',
             'supplier_id', v_sup, 'expected_exit_date', v_today - 2));
    perform public.maintenance_start(r1, jsonb_build_object('entry_date', v_today - 4, 'entry_time', '08:00'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = r1 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(r1, jsonb_build_object('exit_date', v_today - 2, 'exit_time', '17:00', 'items', v_items));
    select string_agg(coalesce(from_status, '∅') || '>' || to_status, ',' order by occurred_at, id) into txt
      from public.maintenance_status_history where maintenance_id = r1;
    select m.duration_hours = 57 and m.duration_precision = 'exact' and m.code ~ '^MAN-[0-9]{4}-[0-9]{6,}$'
           and m.operation_id = v_a.operation_id and m.operation_br_id = v_a.br_id into ok
      from public.maintenances m where m.id = r1;
    r := r || format('%s T93 corretiva %s: trilha=%s, TMM 57 h exato pela entrada/saída reais, contexto=operação+BR de A%s',
      case when ok and txt = '∅>to_schedule,to_schedule>scheduled,scheduled>in_progress,in_progress>completed' then 'PASS' else 'FAIL' end,
      j ->> 'code', txt, chr(10));
    select count(*) filter (where status = 'done'), count(distinct cluster_id) into n, n2
      from public.maintenance_items where maintenance_id = r1;
    ok := n = 2 and n2 = 1 and exists (select 1 from public.maintenance_events e where e.maintenance_id = r1 and e.event_type = 'created'
                                        and jsonb_array_length(e.payload -> 'items') = 2);
    r := r || format('%s T101 multisserviços: 2 itens executados no mesmo cluster, evento de abertura com os 2 serviços%s',
      case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL T93/T101 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T94 --
  begin
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_b.id, 'maintenance_type_code', 'corrective',
           'origin_code', 'driver_report', 'service_ids', jsonb_build_array(s_pas), 'requested_on', v_today - 1));
    r2 := (j ->> 'id')::uuid;
    perform public.maintenance_schedule(r2, jsonb_build_object('scheduled_date', v_today + 2, 'scheduled_time', '09:00'));
    ok := false;
    begin
      perform public.maintenance_reschedule(r2, jsonb_build_object('scheduled_date', v_today + 4), '');
    exception when others then ok := true;
    end;
    perform public.maintenance_reschedule(r2, jsonb_build_object('scheduled_date', v_today + 4, 'scheduled_time', '10:30'),
                                          'Oficina sem vaga no dia');
    select e.reason = 'Oficina sem vaga no dia'
           and (e.payload -> 'before' ->> 'scheduled_date')::date = v_today + 2
           and (e.payload -> 'after' ->> 'scheduled_date')::date = v_today + 4
           and e.actor_user_id = v_user and e.source = 'user'
      into ok2 from public.maintenance_events e where e.maintenance_id = r2 and e.event_type = 'rescheduled';
    r := r || format('%s T94 reprogramação: sem motivo recusada=%s; evento com antes/depois, motivo e autor=%s%s',
      case when ok and coalesce(ok2, false) then 'PASS' else 'FAIL' end, ok, ok2, chr(10));
  exception when others then r := r || 'FAIL T94 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------- T95/T96 --
  begin
    -- Marco MP1 = KM de C + 100, alerta 5%: C entra em "A programar".
    j := public.maintenance_save_preventive_rule(v_org, jsonb_build_object('vehicle_type_id', v_c.vehicle_type_id, 'service_id', s_rev,
           'interval_km', v_c.km + 100, 'initial_km', 0, 'cycle_count', 3, 'alert_before_pct', 5, 'tolerance_after_pct', 5));
    select c.id into v_cycle from public.maintenance_preventive_cycles c where c.vehicle_id = v_c.id and c.cycle_number = 1;
    select s.status into txt from private.maintenance_preventive_state(v_org) s where s.cycle_id = v_cycle;
    j := public.maintenance_schedule_preventive(v_cycle, '{}');
    k := public.maintenance_schedule_preventive(v_cycle, '{}');
    select count(*) into n from public.maintenances where preventive_cycle_id = v_cycle and status in ('to_schedule', 'scheduled', 'in_progress');
    r := r || format('%s T95 preventiva: MP1 %s; gerou %s (created=%s); gerar de novo created=%s e mesma manutenção=%s; abertas no ciclo=%s%s',
      case when txt = 'to_schedule' and (j ->> 'created')::boolean and not (k ->> 'created')::boolean and j ->> 'id' = k ->> 'id' and n = 1
           then 'PASS' else 'FAIL' end, txt, j ->> 'code', j ->> 'created', k ->> 'created', j ->> 'id' = k ->> 'id', n, chr(10));
    -- KM além da tolerância (marco + 5%): Crítica.
    insert into public.vehicle_odometer_readings (organization_id, vehicle_id, reading_date, odometer_km, source, notes)
    values (v_org, v_c.id, v_today, ((v_c.km + 100) * 1.2)::int, 'telemetry', 'Suite20: KM além da tolerância');
    select s.status into txt from private.maintenance_preventive_state(v_org) s where s.cycle_id = v_cycle;
    j := public.maintenance_dashboard(v_org, '{}');
    r := r || format('%s T96 preventiva crítica: MP1 %s; destaque gerencial preventive_critical=%s%s',
      case when txt = 'critical' and (j -> 'kpis' ->> 'preventive_critical')::int >= 1 then 'PASS' else 'FAIL' end,
      txt, j -> 'kpis' ->> 'preventive_critical', chr(10));
  exception when others then r := r || 'FAIL T95/T96 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T97 --
  begin
    v_plan := public.maintenance_save_predictive_plan(v_org, jsonb_build_object('name', 'Suite20 Plano',
                'vehicle_type_id', (select vehicle_type_id from public.vehicles where id = v_f.id)), null);
    j := public.maintenance_save_predictive_item(v_plan, jsonb_build_object('cluster_id', c_mot, 'service_id', s_insp,
           'name', 'Suite20 Correia', 'interval_km', 20000, 'alert_pct', 20, 'schedule_pct', 10, 'tolerance_pct', 10,
           'checklist', jsonb_build_array(jsonb_build_object('key', 'tensao', 'description', 'Tensão da correia', 'required', true))), null);
    v_item := (j ->> 'id')::uuid;
    perform public.maintenance_set_predictive_plan_status(v_plan, 'approved', 'Suite20 primeira versão');
    select id into v_pc from public.maintenance_predictive_cycles where vehicle_id = v_f.id and plan_item_id = v_item;
    -- Referência a 19.500 km do KM atual: faltam 500 de 20.000 (≤ 10%) = A programar.
    perform public.maintenance_predictive_reset(v_pc, v_today - 30, v_f.km - 19500, 'Suite20: referência de teste');
    select s.technical_status into txt from private.maintenance_predictive_state(v_org) s where s.cycle_id = v_pc;
    j := public.maintenance_generate_predictive(v_pc, '{}');
    k := public.maintenance_generate_predictive(v_pc, '{}');
    select m.predictive_cycle_id = v_pc and m.predictive_plan_item_id = v_item and m.maintenance_type_code = 'predictive'
      into ok from public.maintenances m where m.id = (j ->> 'id')::uuid;
    select s.execution_status into v_exec_status from private.maintenance_predictive_state(v_org) s where s.cycle_id = v_pc;
    r := r || format('%s T97 preditiva: item %s; gerou %s ligada ao ciclo e ao item=%s; gerar de novo created=%s (mesma=%s); execução=%s%s',
      case when txt in ('to_schedule', 'due') and (j ->> 'created')::boolean and ok
                and not (k ->> 'created')::boolean and j ->> 'id' = k ->> 'id' then 'PASS' else 'FAIL' end,
      txt, j ->> 'code', ok, k ->> 'created', j ->> 'id' = k ->> 'id', v_exec_status, chr(10));
  exception when others then r := r || 'FAIL T97 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T98 --
  begin
    select v.id, v.app_id into v_ver, v_app from public.checklist_app_versions v
     where v.organization_id = v_org and v.status = 'published' order by v.published_at desc limit 1;
    select q.id, q.question_key, q.question_text, q.criticality, q.conforming_answer, cl.cluster_key into v_q
      from public.checklist_questions q join public.checklist_clusters cl on cl.id = q.cluster_id
     where q.version_id = v_ver and q.status = 'active' order by cl.sort_order, q.sort_order limit 1;
    select e.id into v_emp from public.employees e where e.organization_id = v_org and e.deleted_at is null order by e.created_at limit 1;
    -- Mapeamento Serviços × Check List: a pergunta sugere a troca de pastilhas.
    perform public.maintenance_save_service_links(s_pas, jsonb_build_array(jsonb_build_object(
      'app_id', v_app, 'question_key', v_q.question_key, 'auto_resolve', true)));
    insert into public.checklist_executions (organization_id, app_id, version_id, user_id, employee_id, vehicle_id,
      operation_id, operation_br_id, checklist_type, operational_date, status, idempotency_key)
    values (v_org, v_app, v_ver, v_user, v_emp, v_a.id, v_a.operation_id, v_a.br_id, 'saida', v_today - 1, 'draft',
            'suite20-' || gen_random_uuid()) returning id into v_exec;
    insert into public.checklist_execution_answers (organization_id, execution_id, version_id, question_id, question_key,
      cluster_key, question_text_snapshot, answer, is_conforming, criticality, note)
    values (v_org, v_exec, v_ver, v_q.id, v_q.question_key, v_q.cluster_key, v_q.question_text,
            case when v_q.conforming_answer = 'yes' then 'no' else 'yes' end, false, v_q.criticality, 'Suite20: inconforme')
    returning id into v_ans;
    update public.checklist_executions set status = 'submitted', submitted_at = now(), duration_seconds = 120 where id = v_exec;

    j := public.maintenance_vehicle_findings(v_a.id, 60);
    select f -> 'suggested_service_ids' ? s_pas::text into ok
      from jsonb_array_elements(j) f where (f ->> 'answer_id')::uuid = v_ans;
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_a.id, 'maintenance_type_code', 'corrective',
           'origin_code', 'checklist', 'service_ids', jsonb_build_array(s_pas), 'checklist_answer_ids', jsonb_build_array(v_ans),
           'requested_on', v_today - 1));
    r3 := (j ->> 'id')::uuid;
    select m.vehicle_id = v_a.id and m.operation_br_id = v_a.br_id and m.operation_id = v_a.operation_id
           and m.br_code_snapshot is not null and m.context_source = 'fidelization'
           and exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = s_pas and i.cluster_id = c_fre)
           and exists (select 1 from public.maintenance_finding_links l where l.maintenance_id = m.id and l.checklist_answer_id = v_ans
                        and l.link_origin = 'opened_from_finding' and l.resolution_status = 'pending')
      into ok2 from public.maintenances m where m.id = r3;
    perform public.maintenance_start(r3, jsonb_build_object('entry_date', v_today, 'entry_time', '07:00'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = r3 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(r3, jsonb_build_object('exit_date', v_today, 'exit_time', '18:00', 'items', v_items));
    select l.resolution_status into txt from public.maintenance_finding_links l where l.maintenance_id = r3;
    r := r || format('%s T98 inconformidade→manutenção %s: serviço sugerido pelo mapeamento=%s; veículo+cluster+serviço+BR+contexto (fidelização)=%s; apontamento após concluir=%s%s',
      case when coalesce(ok, false) and coalesce(ok2, false) and txt = 'resolved' then 'PASS' else 'FAIL' end,
      j ->> 'code', ok, ok2, txt, chr(10));
  exception when others then r := r || 'FAIL T98 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T99 --
  begin
    insert into public.vehicle_odometer_readings (organization_id, vehicle_id, reading_date, odometer_km, source, notes) values
      (v_org, v_f.id, v_today - 27, v_f.km - 2000, 'telemetry', 'Suite20'),
      (v_org, v_f.id, v_today - 4, v_f.km + 300, 'telemetry', 'Suite20'),
      (v_org, v_f.id, v_today - 1, v_f.km + 700, 'telemetry', 'Suite20');
    txt := '';
    -- Automático: leitura oficial na própria data = validado; a 1 dia = compatível (entrada real).
    k := private.maintenance_resolve_km(v_org, v_f.id, v_today - 4);
    txt := txt || format('validado=%s/%s ', k ->> 'status', k ->> 'km');
    ok := k ->> 'status' = 'validated' and (k ->> 'km')::int = v_f.km + 300;
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_f.id, 'maintenance_type_code', 'corrective',
           'origin_code', 'operation', 'service_ids', jsonb_build_array(s_dis), 'requested_on', v_today - 5));
    v_id := (j ->> 'id')::uuid;
    k := public.maintenance_start(v_id, jsonb_build_object('entry_date', v_today - 3));
    txt := txt || format('entrada automática=%s/%s ', k ->> 'status', k ->> 'km');
    ok := ok and k ->> 'status' = 'compatible' and (k ->> 'km')::int = v_f.km + 300;
    -- Estimado: entre duas leituras distantes, interpolado.
    k := private.maintenance_resolve_km(v_org, v_f.id, v_today - 15);
    txt := txt || format('estimado=%s/%s ', k ->> 'status', k ->> 'source');
    ok := ok and k ->> 'status' = 'estimated' and k ->> 'source' = 'interpolated';
    -- Manual coerente.
    k := public.maintenance_set_entry_km(v_id, v_f.km + 350, 'Hodômetro lido na entrada');
    txt := txt || format('manual=%s ', k ->> 'status');
    ok := ok and k ->> 'status' = 'manual';
    -- Divergente: abaixo da leitura oficial anterior — grava e sinaliza, não bloqueia.
    k := public.maintenance_set_entry_km(v_id, v_f.km + 100, 'Hodômetro com defeito, lido no painel');
    select m.entry_km = v_f.km + 100 and m.entry_km_status = 'divergent' into ok2 from public.maintenances m where m.id = v_id;
    txt := txt || format('divergente=%s gravado=%s ', k ->> 'status', ok2);
    ok := ok and coalesce(ok2, false);
    -- Manual sem justificativa: recusado.
    ok2 := false;
    begin
      perform public.maintenance_set_entry_km(v_id, v_f.km + 360, '');
    exception when others then ok2 := true;
    end;
    txt := txt || format('manual sem justificativa recusado=%s ', ok2);
    ok := ok and ok2;
    -- Data futura: pendente; entrada futura recusada.
    k := public.maintenance_vehicle_context(v_f.id, v_today + 3);
    txt := txt || format('futura=%s ', k -> 'km_at_date' ->> 'status');
    ok := ok and k -> 'km_at_date' ->> 'status' = 'pending_future';
    -- Ausente: veículo de teste sem nenhuma leitura.
    insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, fleet_code, status)
    values (v_org, v_a.vehicle_type_id,
            (select sc.id from public.vehicle_subcategories sc
              where sc.vehicle_type_id = v_a.vehicle_type_id and sc.is_active and sc.deleted_at is null
                and (sc.organization_id = v_org or sc.organization_id is null)
              order by sc.sort_order limit 1),
            'SUITE20-SEMKM', 'active') returning id into v_novo;
    k := private.maintenance_resolve_km(v_org, v_novo, v_today - 1);
    txt := txt || format('ausente=%s', k ->> 'status');
    ok := ok and k ->> 'status' = 'not_found';
    r := r || format('%s T99 KM: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL T99 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T100 --
  begin
    ok := false;
    begin
      perform public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_b.id, 'maintenance_type_code', 'corrective',
               'origin_code', 'operation', 'service_ids', jsonb_build_array(s_pas)));
    exception when unique_violation then
      get stacked diagnostics txt = pg_exception_hint;
      ok := txt = 'maintenance_duplicate';
    end;
    j := public.maintenance_find_open(v_b.id, array[s_pas]);
    ok2 := jsonb_array_length(j) >= 1 and (j -> 0 ->> 'same_service')::boolean;
    perform public.maintenance_add_items(r2, array[s_dis], 'Suite20: complemento da existente');
    select count(*) into n from public.maintenance_items where maintenance_id = r2 and status <> 'cancelled';
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_b.id, 'maintenance_type_code', 'corrective',
           'origin_code', 'operation', 'service_ids', jsonb_build_array(s_pas),
           'duplicate_justification', 'Suite20: outro defeito no mesmo sistema'));
    select m.duplicate_justification is not null into ok3 from public.maintenances m where m.id = (j ->> 'id')::uuid;
    r := r || format('%s T100 duplicidade: equivalente bloqueia (hint maintenance_duplicate)=%s; alerta lista a existente=%s; complemento=%s itens; nova com justificativa registrada=%s%s',
      case when ok and ok2 and n = 2 and ok3 then 'PASS' else 'FAIL' end, ok, ok2, n, ok3, chr(10));
  exception when others then r := r || 'FAIL T100 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------- T102/T103 --
  begin
    j := public.maintenance_dashboard(v_org, jsonb_build_object('date_from', v_today - 30, 'date_to', v_today));
    select (s ->> 'completed')::int >= 1 into ok from jsonb_array_elements(j -> 'suppliers') s where s ->> 'supplier' = 'Suite20 Oficina Central';
    k := public.maintenance_list(v_org, jsonb_build_object('supplier_ids', jsonb_build_array(v_sup)), 'reference', 'desc', 50, 0);
    r := r || format('%s T102 fornecedor: nos indicadores com concluída=%s; filtro por fornecedor devolve %s manutenção(ões)%s',
      case when coalesce(ok, false) and (k ->> 'total')::int >= 1 then 'PASS' else 'FAIL' end, ok, k ->> 'total', chr(10));

    k := public.maintenance_detail(r3);
    select exists (select 1 from jsonb_array_elements(j -> 'recurrence') x where (x ->> 'vehicle_id')::uuid = v_a.id) into ok;
    j := public.vehicle_maintenance_history(v_a.id);
    r := r || format('%s T103 reincidência (mesmo veículo + cluster em %s dias): no detalhe=%s; no painel=%s; no histórico do veículo=%s%s',
      case when jsonb_array_length(k -> 'recurrence') >= 1 and ok and (j -> 'summary' ->> 'recurrences')::int >= 1 then 'PASS' else 'FAIL' end,
      k ->> 'recurrence_window_days', jsonb_array_length(k -> 'recurrence'), ok, j -> 'summary' ->> 'recurrences', chr(10));
  exception when others then r := r || 'FAIL T102/T103 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T104 --
  begin
    select jsonb_agg(x) into v_rows from (
      select jsonb_build_object('row_number', 2, 'license_plate', v_a.license_plate, 'fleet_code', v_a.fleet_code,
               'maintenance_type', 'Corretiva', 'status', 'Concluído', 'cluster', 'Suite20 Freios', 'service', 'Suite20 Troca de pastilhas',
               'supplier', 'Suite20 Oficina Central', 'service_order_number', 'OS-SUITE20-1',
               'requested_on', to_char(v_today - 60, 'DD/MM/YYYY'), 'entry_date', (v_today - 58)::text, 'exit_date', (v_today - 57)::text) as x
      union all
      select jsonb_build_object('row_number', 3, 'license_plate', v_a.license_plate, 'fleet_code', v_a.fleet_code,
               'maintenance_type', 'Corretiva', 'status', 'Concluído', 'cluster', 'Suite20 Freios', 'service', 'Suite20 Retífica de discos',
               'supplier', 'Suite20 Oficina Central', 'service_order_number', 'OS-SUITE20-1',
               'requested_on', to_char(v_today - 60, 'DD/MM/YYYY'), 'entry_date', (v_today - 58)::text, 'exit_date', (v_today - 57)::text)
      union all
      select jsonb_build_object('row_number', 4, 'license_plate', 'ZZZ9Z99', 'maintenance_type', 'Corretiva', 'status', 'Concluído',
               'service', 'Suite20 Troca de pastilhas', 'entry_date', (v_today - 10)::text, 'exit_date', (v_today - 9)::text)) q;
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', 'suite20.xlsx',
           'file_hash', md5('suite20') || md5('suite20-b'), 'rows', v_rows));
    v_batch := (j ->> 'batch_id')::uuid;
    k := public.process_maintenance_import(v_org, v_batch, null);
    select count(*) into n from public.maintenances where import_batch_id = v_batch;
    select count(*) into n2 from public.maintenance_items i join public.maintenances m on m.id = i.maintenance_id where m.import_batch_id = v_batch;
    ok := (j ->> 'error_rows')::int = 1 and (j -> 'categories' ->> 'unknown_vehicle')::int = 1 and n = 1 and n2 = 2
          and not exists (select 1 from public.vehicles v where v.license_plate = 'ZZZ9Z99');
    txt := format('1ª carga: erros=%s (veículo desconhecido não criado), manutenções=%s, itens=%s; ', j ->> 'error_rows', n, n2);
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', 'suite20.xlsx',
           'file_hash', md5('suite20') || md5('suite20-b'), 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select count(*) into n from public.maintenances m where m.service_order_number = 'OS-SUITE20-1';
    select count(*) into n2 from public.maintenance_items i join public.maintenances m on m.id = i.maintenance_id
     where m.service_order_number = 'OS-SUITE20-1';
    ok := ok and (j -> 'summary' ->> 'unchanged_rows')::int = 2 and (j -> 'summary' ->> 'already_imported')::boolean and n = 1 and n2 = 2;
    txt := txt || format('reimportação: sem mudança=%s, já importado=%s, manutenções=%s, itens=%s', j -> 'summary' ->> 'unchanged_rows',
                         j -> 'summary' ->> 'already_imported', n, n2);
    r := r || format('%s T104 importação idempotente: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL T104 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T105 --
  begin
    txt := '';
    insert into public.organizations (name, slug) values ('Suite20 Outro Tenant', 'suite20-outro-tenant-' || substr(md5(random()::text), 1, 8))
    returning id into v_org2;
    -- Administrador de plataforma enxerga todo tenant: revogado DENTRO da transação.
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    perform set_config('hfm.access_change', '', true);

    -- Administrador (papel da organização)
    ok := private.has_permission(v_org, 'maintenance.reopen') and private.has_permission(v_org, 'maintenance.manage_parameters');
    txt := txt || format('Administrador todas=%s; ', ok);

    -- Outro tenant
    ok2 := false;
    begin perform public.maintenance_save_cluster(v_org2, '{"name":"Suite20 Invasor"}');
    exception when others then ok2 := true; end;
    set local role authenticated;
    n := (public.maintenance_list(v_org2, '{}', 'reference', 'desc', 50, 0) ->> 'total')::int;
    select count(*) into n2 from public.maintenances where organization_id = v_org2;
    reset role;
    txt := txt || format('outro tenant: gravação recusada=%s, lista=%s, linhas=%s; ', ok2, n, n2);
    ok := ok and ok2 and n = 0 and n2 = 0;

    -- Gestor de Frota
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gestor_frota'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    begin
      j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_c.id, 'maintenance_type_code', 'corrective',
             'origin_code', 'operation', 'service_ids', jsonb_build_array(s_dis)));
      perform public.maintenance_schedule((j ->> 'id')::uuid, jsonb_build_object('scheduled_date', v_today + 1));
      perform public.maintenance_save_cluster(v_org, '{"name":"Suite20 Gestor"}');
      ok2 := true;
    exception when others then ok2 := false; txt := txt || 'gestor erro: ' || sqlerrm || '; ';
    end;
    txt := txt || format('Gestor de Frota cria/agenda/cadastra=%s; ', ok2);
    ok := ok and ok2;

    -- Gestão: lê base e painel; não cria
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gestao'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    ok2 := false;
    begin perform public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_c.id, 'maintenance_type_code', 'corrective',
               'origin_code', 'operation', 'service_ids', jsonb_build_array(s_pas), 'duplicate_justification', 'Suite20 gestao tenta'));
    exception when insufficient_privilege then ok2 := true; end;
    set local role authenticated;
    n := (public.maintenance_list(v_org, '{}', 'reference', 'desc', 50, 0) ->> 'total')::int;
    j := public.maintenance_dashboard(v_org, '{}');
    reset role;
    txt := txt || format('Gestão lê %s e painel, criação recusada=%s; ', n, ok2);
    ok := ok and ok2 and n >= 5 and j ? 'kpis';

    -- Operacional e Gente: nada
    foreach k in array array['"operacional"'::jsonb, '"gente"'::jsonb] loop
      perform set_config('hfm.access_change', 'on', true);
      update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = k #>> '{}'
        and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
       where membership_id = v_mem;
      perform set_config('hfm.access_change', '', true);
      set local role authenticated;
      select count(*) into n from public.maintenances where organization_id = v_org;
      n2 := (public.maintenance_list(v_org, '{}', 'reference', 'desc', 50, 0) ->> 'total')::int;
      reset role;
      ok2 := false;
      begin perform public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_a.id, 'maintenance_type_code', 'corrective',
                 'origin_code', 'operation', 'service_ids', jsonb_build_array(s_dis)));
      exception when insufficient_privilege then ok2 := true; end;
      ok3 := false;
      begin perform public.maintenance_dashboard(v_org, '{}');
      exception when insufficient_privilege then ok3 := true; end;
      txt := txt || format('%s: vê %s/%s, criação recusada=%s, painel recusado=%s; ', k #>> '{}', n, n2, ok2, ok3);
      ok := ok and n = 0 and n2 = 0 and ok2 and ok3;
    end loop;

    -- Liderança com escopo na operação de A. O escopo entra com o administrador
    -- de plataforma ainda ativo (a guarda recusa a pessoa mexer no próprio
    -- escopo), como na suíte 17; depois ele é revogado de novo.
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = v_admin_role where membership_id = v_mem;
    update public.platform_admins set revoked_at = null where user_id = v_user and revoked_at = now();
    delete from public.membership_operation_scopes where membership_id = v_mem;
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_a.operation_id);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'lideranca_operacoes'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    set local role authenticated;
    -- Fora do escopo = contexto numa operação diferente de A (contexto nulo cai no escopo do veículo).
    select count(*) filter (where operation_id = v_a.operation_id),
           count(*) filter (where operation_id is not null and operation_id <> v_a.operation_id)
      into n, n2 from public.maintenances where organization_id = v_org;
    reset role;
    ok2 := false;
    begin perform public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_b.id, 'maintenance_type_code', 'corrective',
               'origin_code', 'operation', 'service_ids', jsonb_build_array(s_dis), 'duplicate_justification', 'Suite20 lider fora do escopo'));
    exception when insufficient_privilege then ok2 := true; end;
    ok3 := false;
    begin
      j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_a.id, 'maintenance_type_code', 'corrective',
             'origin_code', 'operation', 'service_ids', jsonb_build_array(s_dis), 'duplicate_justification', 'Suite20 lider dentro do escopo'));
      begin perform public.maintenance_schedule((j ->> 'id')::uuid, jsonb_build_object('scheduled_date', v_today + 1));
      exception when insufficient_privilege then ok3 := true; end;
    exception when others then ok := false; txt := txt || 'criação no escopo FALHOU: ' || sqlerrm || '; ';
    end;
    txt := txt || format('Liderança (escopo A): vê A=%s fora=%s, criação fora do escopo recusada=%s, cria no escopo e agendar recusado=%s',
                         n, n2, ok2, ok3);
    ok := ok and n >= 1 and n2 = 0 and ok2 and ok3;
    r := r || format('%s T105 segurança: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL T105 ' || sqlerrm || chr(10);
  end;

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end;
$t$;
