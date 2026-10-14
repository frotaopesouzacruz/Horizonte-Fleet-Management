-- =============================================================================
-- 39 · Manutenção Preditiva v2 — motor de ciclos, histórico, KM, inspeções e app
--      (migration 20261014120000_predictive_engine_v2.sql)
--
-- Suíte transacional e autossuficiente: cria a própria frota de teste (marca e
-- modelo "Suite39", 6 veículos, 2 operações com cidade/BR, alocações, leituras
-- de KM, clusters, serviços, plano técnico, regra preventiva), quatro contas
-- de teste (Gestor de Frota com escopo A+B, Liderança com escopo A, Operacional
-- e Gente) e termina SEMPRE em `raise exception 'ROLLBACK_TESTES …'`: nada
-- persiste. O resultado sai no texto da exceção, uma linha PASS/FAIL por teste.
--
--   T1  Ciclo normal: ref. 100.000 / intervalo 10.000 / KM 105.000 → marco 110.000, saldo 5.000, EM DIA
--   T2  Marco ultrapassado: KM 111.500 → excedido 1.500 (além da tolerância de 10% = CRÍTICO; com 20% seria VENCIDO)
--   T3  KM dentro do ciclo e prazo temporal vencido → VENCIDO (pior caso KM × dias)
--   T4  Plano aplicado sem KM oficial → SEM KM (+ inconsistência vehicle_no_km)
--   T5  Plano aplicado sem referência válida → INSPEÇÃO INICIAL
--   T6  Conforme → novo ciclo no KM/data da inspeção
--   T7  Monitoramento → alvo temporário reduzido (2.000 km)
--   T8  Não conforme → ciclo não reinicia; execução AGUARDANDO CORRETIVA
--   T9  Corretiva gerada e vinculada ao ciclo e ao item
--   T10 Conclusão com cobertura total → ciclo reinicia na manutenção
--   T11 Cobertura parcial → não reinicia o ciclo
--   T12 Preventiva com serviço de cobertura total → referência atualizada
--   T13 Histórico do cluster como referência não formal
--   T14 Baixa manual: data, KM, motivo e responsável obrigatórios; auditoria com autor
--   T15 Alteração de plano: versiona, recalcula e preserva histórico
--   T16 Escopo: Liderança A não consulta a frota exclusiva da operação B
--   T17 Multi-tenant: nada da organização A aparece para a B
--   T18 Idempotência: gerar de novo e reenviar o app não duplicam
--   T19 KM desatualizado sinalizado (flag + inconsistência), status ainda calculado
--   T20 Regressão: preventiva, corretiva, base geral, programação e KM seguem funcionando
--   TA  App Verificação Preditiva: contexto, veículos, roteiro, envio (protocolo, KM, NC → corretiva), meus envios, detalhe, buscas
--   TO  Painel: paginação/filtros no servidor, previsão, rankings, insights, saúde, indicadores, tendências, eventos, qualidade, histórico
--   TP  Ambiguidade de plano sinalizada (não escolhe em silêncio) e recuperação ao inativar
--   TS  RBAC: Operacional (app sim, painel não), Gente (nada), Gestão (lê, não verifica)
-- =============================================================================

do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_today date; v_claims text;
  v_type uuid; v_sub uuid; v_make uuid; v_model uuid; v_app uuid;
  op_a uuid; op_b uuid; oc_a uuid; oc_b uuid; br_a uuid; br_b uuid;
  va1 uuid; va2 uuid; vb1 uuid; vc uuid; vh uuid; vk uuid;
  e_gf uuid; e_lid uuid; e_op uuid; e_ge uuid; u_gf uuid := gen_random_uuid(); u_lid uuid := gen_random_uuid();
  u_op uuid := gen_random_uuid(); u_ge uuid := gen_random_uuid(); u_gs uuid := gen_random_uuid();
  m_gf uuid; m_lid uuid; m_op uuid; m_ge uuid; m_gs uuid;
  c_fre uuid; c_mot uuid; s_pas uuid; s_dis uuid; s_oil uuid; s_filt uuid;
  v_plan uuid; v_plan2 uuid; i1 uuid; i2 uuid; i3 uuid;
  cy record; st record; st2 record; m record;
  j jsonb; k jsonb; jx jsonb; jy jsonb; r1 uuid; r2 uuid; r3 uuid; v_items jsonb; v_it record;
  n int; n2 int; n3 int; n4 int; txt text; ok boolean; ok2 boolean; ok3 boolean; ok4 boolean;
  v_org2 uuid; sub1 uuid := gen_random_uuid(); sub2 uuid := gen_random_uuid(); sub3 uuid := gen_random_uuid();
  ids uuid[]; ev0 int; ver0 int; ver_ids uuid[];
  r text := '';
  function_ok boolean;
begin
  -- ================================================================= setup --
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m0.user_id, m0.id into v_user, v_mem from public.organization_memberships m0
   where m0.organization_id = v_org and m0.status = 'active' order by m0.created_at limit 1;
  v_claims := json_build_object('sub', v_user, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  v_today := private.maintenance_today(v_org);
  if not private.has_permission(v_org, 'maintenance.manage_predictive') then
    raise exception 'FIXTURE: o primeiro membro ativo precisa ser Administrador';
  end if;

  select v.vehicle_type_id, v.vehicle_subcategory_id into v_type, v_sub
    from public.vehicles v where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null
   group by 1, 2 order by count(*) desc limit 1;
  select a.id into v_app from public.operational_apps a where a.organization_id = v_org and a.code = 'verificacao_preditiva' and a.deleted_at is null;
  if v_type is null or v_app is null then
    raise exception 'FIXTURE: tipo de equipamento ativo=% app verificacao_preditiva=%', v_type, v_app;
  end if;

  insert into public.vehicle_makes (organization_id, name) values (v_org, 'Suite39 Marca') returning id into v_make;
  insert into public.vehicle_models (organization_id, vehicle_make_id, name) values (v_org, v_make, 'Suite39 Modelo') returning id into v_model;

  insert into public.operations (organization_id, name, code) values (v_org, 'Suite39 Operação A', 'S39-OPA') returning id into op_a;
  insert into public.operations (organization_id, name, code) values (v_org, 'Suite39 Operação B', 'S39-OPB') returning id into op_b;
  insert into public.operation_states (organization_id, operation_id, state_id) values (v_org, op_a, 31), (v_org, op_b, 31);
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id) values (v_org, op_a, 31, 3118601) returning id into oc_a;
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id) values (v_org, op_b, 31, 3106705) returning id into oc_b;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, op_a, oc_a, 31, 3118601, 'S39-A1', 'active') returning id into br_a;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, op_b, oc_b, 31, 3106705, 'S39-B1', 'active') returning id into br_b;
  insert into public.vehicle_type_operations (organization_id, vehicle_type_id, operation_id)
  select v_org, v_type, o from unnest(array[op_a, op_b]) o
   where not exists (select 1 from public.vehicle_type_operations t where t.organization_id = v_org and t.vehicle_type_id = v_type and t.operation_id = o);
  insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled)
  select v_org, v_app, o, true from unnest(array[op_a, op_b]) o
   where not exists (select 1 from public.checklist_app_operations t where t.app_id = v_app and t.operation_id = o);
  insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled)
  select v_org, v_type, v_app, true
   where not exists (select 1 from public.vehicle_type_apps t where t.organization_id = v_org and t.vehicle_type_id = v_type and t.app_id = v_app);
  update public.vehicle_type_apps set is_enabled = true where organization_id = v_org and vehicle_type_id = v_type and app_id = v_app;
  update public.checklist_app_operations set is_enabled = true where app_id = v_app and operation_id in (op_a, op_b);

  insert into public.maintenance_settings (organization_id) select v_org where not exists (select 1 from public.maintenance_settings where organization_id = v_org);
  update public.maintenance_settings set predictive_km_max_age_days = 30 where organization_id = v_org;

  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-01', 'SUI3901', 'active') returning id into va1;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-02', 'SUI3902', 'active') returning id into va2;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-03', 'SUI3903', 'active') returning id into vb1;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-04', 'SUI3904', 'active') returning id into vc;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-05', 'SUI3905', 'active') returning id into vh;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S39-06', 'SUI3906', 'active') returning id into vk;
  insert into public.vehicle_operation_assignments (organization_id, vehicle_id, operation_id, state_id, city_id, effective_from) values
    (v_org, va1, op_a, 31, 3118601, v_today - 400), (v_org, va2, op_a, 31, 3118601, v_today - 400),
    (v_org, vc,  op_a, 31, 3118601, v_today - 400), (v_org, vh,  op_a, 31, 3118601, v_today - 400),
    (v_org, vk,  op_a, 31, 3118601, v_today - 400), (v_org, vb1, op_b, 31, 3106705, v_today - 400);
  insert into public.vehicle_odometer_readings (organization_id, vehicle_id, reading_date, odometer_km, source, notes) values
    (v_org, va1, v_today, 105000, 'telemetry', 'Suite39'), (v_org, va2, v_today, 111500, 'telemetry', 'Suite39'),
    (v_org, vb1, v_today, 50000, 'telemetry', 'Suite39'),  (v_org, vh,  v_today, 80000, 'telemetry', 'Suite39'),
    (v_org, vk,  v_today - 45, 90000, 'telemetry', 'Suite39: leitura antiga');

  -- contas de teste (Gestor com escopo A+B; Liderança com escopo A; Operacional; Gente; Gestão)
  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S39-GF', 'Suite39 Gestor de Frota') returning id into e_gf;
  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S39-LID', 'Suite39 Liderança A') returning id into e_lid;
  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S39-OP', 'Suite39 Operacional') returning id into e_op;
  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S39-GE', 'Suite39 Gente') returning id into e_ge;
  insert into auth.users (id) values (u_gf), (u_lid), (u_op), (u_ge), (u_gs);
  insert into public.profiles (user_id, full_name) values (u_gf, 'Suite39 Gestor de Frota'), (u_lid, 'Suite39 Liderança A'),
    (u_op, 'Suite39 Operacional'), (u_ge, 'Suite39 Gente'), (u_gs, 'Suite39 Gestão')
  on conflict (user_id) do update set full_name = excluded.full_name;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (v_org, u_gf, 'active', e_gf) returning id into m_gf;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (v_org, u_lid, 'active', e_lid) returning id into m_lid;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (v_org, u_op, 'active', e_op) returning id into m_op;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (v_org, u_ge, 'active', e_ge) returning id into m_ge;
  insert into public.organization_memberships (organization_id, user_id, status) values (v_org, u_gs, 'active') returning id into m_gs;
  perform set_config('hfm.access_change', 'on', true);
  insert into public.membership_roles (membership_id, role_id)
  select mm, (select ro.id from public.roles ro where ro.code = rc and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
    from (values (m_gf, 'gestor_frota'), (m_lid, 'lideranca_operacoes'), (m_op, 'operacional'), (m_ge, 'gente'), (m_gs, 'gestao')) t(mm, rc);
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values
    (v_org, m_gf, op_a), (v_org, m_gf, op_b), (v_org, m_lid, op_a), (v_org, m_op, op_a), (v_org, m_gs, op_a), (v_org, m_gs, op_b);
  perform set_config('hfm.access_change', '', true);
  -- a liderança é titular da operação A (contexto de liderança nos rankings)
  insert into public.leadership_assignments (organization_id, employee_id, scope_level, operation_id, responsibility_type, effective_from)
  values (v_org, e_lid, 'operation', op_a, 'principal', v_today - 365);

  -- catálogo técnico
  c_fre := public.maintenance_save_cluster(v_org, '{"name":"Suite39 Freios","default_criticality":"high"}');
  c_mot := public.maintenance_save_cluster(v_org, '{"name":"Suite39 Motor"}');
  s_pas := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_fre, 'name', 'Suite39 Pastilhas de freio', 'is_predictive', true));
  s_dis := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_fre, 'name', 'Suite39 Discos de freio'));
  s_oil := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_mot, 'name', 'Suite39 Troca de óleo',
             'maintenance_type_codes', jsonb_build_array('preventive', 'corrective')));
  s_filt := public.maintenance_save_service(v_org, jsonb_build_object('cluster_id', c_mot, 'name', 'Suite39 Filtro de ar'));

  -- VH: manutenção real anterior (cluster Freios, serviço parcial) ANTES do plano → referência "histórico"
  j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', vh, 'maintenance_type_code', 'corrective', 'origin_code', 'operation',
         'service_ids', jsonb_build_array(s_dis), 'description', 'Suite39: discos trocados há 100 dias', 'requested_on', v_today - 100));
  r1 := (j ->> 'id')::uuid;
  perform public.maintenance_schedule(r1, jsonb_build_object('scheduled_date', v_today - 100, 'scheduled_time', '08:00'));
  perform public.maintenance_start(r1, jsonb_build_object('entry_date', v_today - 100, 'entry_time', '08:00', 'entry_km', 70000, 'entry_km_justification', 'Suite39: hodômetro na entrada'));
  v_items := '[]';
  for v_it in select id from public.maintenance_items where maintenance_id = r1 loop
    v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
  end loop;
  perform public.maintenance_complete(r1, jsonb_build_object('exit_date', v_today - 99, 'exit_time', '17:00', 'items', v_items));

  -- plano técnico aplicável só ao modelo Suite39 (tipo + marca + modelo + vigência)
  v_plan := public.maintenance_save_predictive_plan(v_org, jsonb_build_object('name', 'Suite39 Plano Modelo', 'vehicle_type_id', v_type,
              'vehicle_make_id', v_make, 'vehicle_model_id', v_model, 'source', 'internal', 'valid_from', v_today - 365), null);
  j := public.maintenance_save_predictive_item(v_plan, jsonb_build_object('cluster_id', c_fre, 'service_id', s_pas, 'name', 'Suite39 Freios dianteiros',
         'interval_km', 10000, 'interval_days', 180, 'alert_pct', 20, 'schedule_pct', 10, 'tolerance_pct', 10, 'criticality', 'high',
         'checklist', jsonb_build_array(
           jsonb_build_object('key', 'pastilha', 'description', 'Espessura das pastilhas (mm)', 'response_type', 'number', 'approval_criteria', '≥ 3 mm', 'required', true),
           jsonb_build_object('key', 'disco', 'description', 'Estado dos discos', 'response_type', 'conformity', 'required', false))), null);
  i1 := (j ->> 'id')::uuid;
  j := public.maintenance_save_predictive_item(v_plan, jsonb_build_object('cluster_id', c_mot, 'service_id', s_oil, 'name', 'Suite39 Óleo do motor',
         'interval_km', 15000, 'interval_days', 365, 'criticality', 'medium',
         'checklist', jsonb_build_array(jsonb_build_object('key', 'nivel', 'description', 'Nível e aspecto do óleo', 'response_type', 'conformity'))), null);
  i2 := (j ->> 'id')::uuid;
  perform public.maintenance_save_predictive_coverage(i1, jsonb_build_array(jsonb_build_object('service_id', s_pas, 'coverage', 'full'), jsonb_build_object('service_id', s_dis, 'coverage', 'partial')));
  perform public.maintenance_save_predictive_coverage(i2, jsonb_build_array(jsonb_build_object('service_id', s_oil, 'coverage', 'full'), jsonb_build_object('service_id', s_filt, 'coverage', 'partial')));
  j := public.maintenance_set_predictive_plan_status(v_plan, 'approved', 'Suite39 primeira versão');
  select count(*) into n from public.maintenance_predictive_cycles where plan_id = v_plan and is_active;
  if n <> 12 then
    raise exception 'FIXTURE: esperava 12 ciclos ativos (6 veículos × 2 itens), obteve % (%)', n, j::text;
  end if;

  -- ---------------------------------------------------------------- T13 --
  begin
    select c.* into cy from public.maintenance_predictive_cycles c where c.vehicle_id = vh and c.plan_item_id = i1;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = cy.id;
    ok := cy.reference_type = 'history' and cy.reference_km = 70000 and cy.reference_date = v_today - 99 and cy.reference_maintenance_id = r1
          and st.conformity = 'no_verification' and st.reference_type = 'history';
    j := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI3905'));
    ok2 := (j -> 'summary' ->> 'history_reference')::int >= 1
           and (select x -> 'cells' -> i1::text ->> 'reference_type' from jsonb_array_elements(j -> 'rows') x where x ->> 'license_plate' = 'SUI3905') = 'history';
    r := r || format('%s T13 histórico do cluster: ciclo de VH com referência=%s km=%s (manutenção real, sem verificação formal); painel conta história=%s e célula marca "history"=%s%s',
      case when ok and ok2 then 'PASS' else 'FAIL' end, cy.reference_type, cy.reference_km, j -> 'summary' ->> 'history_reference', ok2, chr(10));
  exception when others then r := r || 'FAIL T13 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T1 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    perform public.maintenance_predictive_reset(r2, v_today - 30, 100000, 'Suite39: referência inicial de teste (T1)');
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := st.next_km = 110000 and st.km_remaining = 5000 and st.technical_status = 'ok' and st.pct_consumed = 50.0
          and st.execution_status = 'not_programmed' and st.conformity = 'no_verification' and st.current_km = 105000;
    r := r || format('%s T1 ciclo normal: marco=%s saldo=%s consumo=%s%% status=%s execução=%s conformidade=%s%s',
      case when ok then 'PASS' else 'FAIL' end, st.next_km, st.km_remaining, st.pct_consumed, st.technical_status, st.execution_status, st.conformity, chr(10));
  exception when others then r := r || 'FAIL T1 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T2 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va2 and c.plan_item_id = i1;
    perform public.maintenance_predictive_reset(r2, v_today - 30, 100000, 'Suite39: referência inicial de teste (T2)');
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := st.km_remaining = -1500 and st.technical_status = 'critical' and st.severity = 6
          and private.maintenance_predictive_band(-1500, 10000, 20, 10, 20) = 4;
    r := r || format('%s T2 marco ultrapassado: excedido=%s km status=%s (tolerância 10%% = 1.000 km → CRÍTICO; com 20%% seria VENCIDO=%s)%s',
      case when ok then 'PASS' else 'FAIL' end, -st.km_remaining, st.technical_status, private.maintenance_predictive_band(-1500, 10000, 20, 10, 20) = 4, chr(10));
  exception when others then r := r || 'FAIL T2 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T3 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i2;
    perform public.maintenance_predictive_reset(r2, v_today - 400, 100000, 'Suite39: referência antiga de teste (T3)');
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := st.km_remaining = 10000 and st.days_remaining = -35 and st.technical_status = 'due';
    r := r || format('%s T3 KM em dia (%s km) e prazo vencido (%s dias) → %s%s',
      case when ok then 'PASS' else 'FAIL' end, st.km_remaining, st.days_remaining, st.technical_status, chr(10));
  exception when others then r := r || 'FAIL T3 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T4 --
  begin
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.vehicle_id = vc and s.item_id = i1;
    j := private.maintenance_predictive_refresh_quality(v_org);
    ok := st.technical_status = 'no_km' and st.current_km is null
          and exists (select 1 from public.maintenance_predictive_quality_issues q where q.organization_id = v_org and q.vehicle_id = vc and q.issue_type = 'vehicle_no_km' and q.resolved_at is null);
    r := r || format('%s T4 sem KM: status=%s, inconsistência vehicle_no_km registrada=%s (abertas=%s)%s',
      case when ok then 'PASS' else 'FAIL' end, st.technical_status, ok, j ->> 'open', chr(10));
  exception when others then r := r || 'FAIL T4 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T5 --
  begin
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.vehicle_id = vb1 and s.item_id = i1;
    ok := st.reference_type = 'none' and st.technical_status = 'initial_inspection' and st.current_km = 50000;
    r := r || format('%s T5 sem referência: referência=%s status=%s%s', case when ok then 'PASS' else 'FAIL' end, st.reference_type, st.technical_status, chr(10));
  exception when others then r := r || 'FAIL T5 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T6 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = vb1 and c.plan_item_id = i1;
    j := public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'conforming', 'responsible_name', 'Suite39 Inspetor',
           'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '8'))));
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := cy.reference_type = 'verification' and cy.reference_km = 50000 and cy.reference_date = v_today and st.next_km = 60000
          and st.technical_status = 'ok' and st.conformity = 'conforming' and j ->> 'decision' = 'restart_cycle' and j ->> 'km_source' = 'validated'
          and exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'verification' and e.result = 'conforming');
    r := r || format('%s T6 conforme: ciclo reinicia em %s km / %s (fonte KM=%s), marco=%s, decisão=%s, evento registrado%s',
      case when ok then 'PASS' else 'FAIL' end, cy.reference_km, cy.reference_date, j ->> 'km_source', st.next_km, j ->> 'decision', chr(10));
  exception when others then r := r || 'FAIL T6 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T7 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    ok2 := false;
    begin
      perform public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'monitor', 'responsible_name', 'Suite39 Inspetor',
                'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '4'))));
    exception when others then ok2 := true;
    end;
    j := public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'monitor', 'monitor_km', 2000, 'responsible_name', 'Suite39 Inspetor',
           'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '4'))));
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := cy.monitoring_active and cy.monitoring_km = 2000 and cy.reference_km = 105000 and st.km_base = 2000 and st.next_km = 107000
          and st.km_remaining = 2000 and st.monitoring_active and st.conformity = 'monitor' and j ->> 'decision' = 'reduce_interval'
          and exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'monitoring_started');
    r := r || format('%s T7 monitoramento: sem alvo recusado=%s; alvo reduzido base=%s km, marco=%s, saldo=%s, decisão=%s%s',
      case when ok and ok2 then 'PASS' else 'FAIL' end, ok2, st.km_base, st.next_km, st.km_remaining, j ->> 'decision', chr(10));
  exception when others then r := r || 'FAIL T7 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- T8 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va2 and c.plan_item_id = i1;
    ok2 := false;
    begin
      perform public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'non_conforming', 'responsible_name', 'Suite39 Inspetor',
                'open_maintenance', false, 'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '1'))));
    exception when others then ok2 := true;
    end;
    j := public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'non_conforming', 'notes', 'Suite39: pastilhas no limite de desgaste',
           'responsible_name', 'Suite39 Inspetor', 'open_maintenance', false, 'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '1'))));
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := cy.reference_type = 'manual_reset' and cy.reference_km = 100000 and cy.last_result = 'non_conforming'
          and st.execution_status = 'awaiting_corrective' and st.conformity = 'non_conforming' and st.technical_status = 'critical'
          and coalesce(jsonb_typeof(j -> 'maintenance'), 'null') = 'null';
    r := r || format('%s T8 não conforme: sem descrição recusada=%s; referência preservada (%s @ %s km), execução=%s, conformidade=%s, situação técnica=%s%s',
      case when ok and ok2 then 'PASS' else 'FAIL' end, ok2, cy.reference_type, cy.reference_km, st.execution_status, st.conformity, st.technical_status, chr(10));
  exception when others then r := r || 'FAIL T8 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------ T9/T18 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va2 and c.plan_item_id = i1;
    j := public.maintenance_generate_predictive(r2, '{}');
    k := public.maintenance_generate_predictive(r2, '{}');
    r3 := (j ->> 'id')::uuid;
    select m0.* into m from public.maintenances m0 where m0.id = r3;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    select count(*) into n from public.maintenances where predictive_cycle_id = r2 and status in ('to_schedule', 'scheduled', 'in_progress');
    ok := (j ->> 'created')::boolean and m.predictive_cycle_id = r2 and m.predictive_plan_item_id = i1 and m.maintenance_type_code = 'predictive'
          and m.status = 'to_schedule' and st.execution_status = 'to_schedule' and st.open_maintenance_id = r3
          and exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'maintenance_generated' and e.maintenance_id = r3);
    ok2 := not (k ->> 'created')::boolean and k ->> 'id' = j ->> 'id' and n = 1;
    r := r || format('%s T9 corretiva: %s gerada (tipo=%s) ligada ao ciclo e ao item; execução=%s%s', case when ok then 'PASS' else 'FAIL' end, m.code, m.maintenance_type_code, st.execution_status, chr(10));
    r := r || format('%s T18 idempotência da geração: gerar de novo created=%s, mesma manutenção=%s, abertas no ciclo=%s%s',
      case when ok2 then 'PASS' else 'FAIL' end, k ->> 'created', k ->> 'id' = j ->> 'id', n, chr(10));
  exception when others then r := r || 'FAIL T9/T18 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T10 --
  begin
    perform public.maintenance_schedule(r3, jsonb_build_object('scheduled_date', v_today, 'scheduled_time', '08:00'));
    perform public.maintenance_start(r3, jsonb_build_object('entry_date', v_today, 'entry_time', '08:00', 'entry_km', 111600, 'entry_km_justification', 'Suite39: hodômetro na entrada'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = r3 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(r3, jsonb_build_object('exit_date', v_today, 'exit_time', '12:00', 'items', v_items));
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    ok := cy.reference_type = 'maintenance' and cy.reference_km = 111600 and cy.reference_date = v_today and cy.reference_maintenance_id = r3
          and cy.last_result is null and st.execution_status = 'not_programmed' and st.conformity = 'no_verification'
          and st.next_km = 121600 and st.technical_status = 'ok'
          and exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'maintenance_restart' and e.maintenance_id = r3);
    r := r || format('%s T10 conclusão com cobertura total: ciclo reinicia em %s km (%s), marco=%s, status=%s, execução=%s%s',
      case when ok then 'PASS' else 'FAIL' end, cy.reference_km, cy.reference_type, st.next_km, st.technical_status, st.execution_status, chr(10));
  exception when others then r := r || 'FAIL T10 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T11 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', va1, 'maintenance_type_code', 'corrective', 'origin_code', 'operation',
           'service_ids', jsonb_build_array(s_dis), 'description', 'Suite39: discos (cobertura parcial)', 'requested_on', v_today, 'duplicate_justification', 'Suite39'));
    r1 := (j ->> 'id')::uuid;
    perform public.maintenance_schedule(r1, jsonb_build_object('scheduled_date', v_today, 'scheduled_time', '09:00'));
    perform public.maintenance_start(r1, jsonb_build_object('entry_date', v_today, 'entry_time', '09:00', 'entry_km', 105000, 'entry_km_justification', 'Suite39: hodômetro na entrada'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = r1 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(r1, jsonb_build_object('exit_date', v_today, 'exit_time', '11:00', 'items', v_items));
    select c.* into st2 from public.maintenance_predictive_cycles c where c.id = r2;
    ok := st2.reference_type = cy.reference_type and st2.reference_km = cy.reference_km and st2.reference_date = cy.reference_date
          and st2.monitoring_active = cy.monitoring_active and st2.reference_maintenance_id is null
          and not exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'maintenance_restart' and e.maintenance_id = r1);
    r := r || format('%s T11 cobertura parcial: %s concluída não reinicia o ciclo (referência segue %s @ %s km, monitoramento=%s)%s',
      case when ok then 'PASS' else 'FAIL' end, j ->> 'code', st2.reference_type, st2.reference_km, st2.monitoring_active, chr(10));
  exception when others then r := r || 'FAIL T11 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T12 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = vb1 and c.plan_item_id = i2;
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    j := public.maintenance_save_preventive_rule(v_org, jsonb_build_object('vehicle_type_id', v_type, 'vehicle_model_id', v_model, 'service_id', s_oil,
           'interval_km', 50000, 'initial_km', 0, 'cycle_count', 2, 'alert_before_pct', 10, 'tolerance_after_pct', 10));
    select pc.id into r1 from public.maintenance_preventive_cycles pc where pc.vehicle_id = vb1 and pc.cycle_number = 1 and pc.completed_on is null;
    j := public.maintenance_schedule_preventive(r1, '{}');
    r1 := (j ->> 'id')::uuid;
    perform public.maintenance_schedule(r1, jsonb_build_object('scheduled_date', v_today, 'scheduled_time', '10:00'));
    perform public.maintenance_start(r1, jsonb_build_object('entry_date', v_today, 'entry_time', '10:00', 'entry_km', 50500, 'entry_km_justification', 'Suite39: hodômetro na entrada'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = r1 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(r1, jsonb_build_object('exit_date', v_today, 'exit_time', '15:00', 'items', v_items));
    select c.* into st2 from public.maintenance_predictive_cycles c where c.id = r2;
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    select m0.maintenance_type_code into txt from public.maintenances m0 where m0.id = r1;
    ok := cy.reference_type = 'none' and st2.reference_type = 'maintenance' and st2.reference_km = 50500 and st2.reference_maintenance_id = r1
          and txt = 'preventive' and st.technical_status = 'ok' and st.next_km = 65500;
    r := r || format('%s T12 preventiva com cobertura total: %s (%s) atualizou a referência de %s para %s @ %s km; status=%s%s',
      case when ok then 'PASS' else 'FAIL' end, j ->> 'code', txt, cy.reference_type, st2.reference_type, st2.reference_km, st.technical_status, chr(10));
  exception when others then r := r || 'FAIL T12 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T14 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = vh and c.plan_item_id = i1;
    perform set_config('request.jwt.claims', json_build_object('sub', u_gf, 'role', 'authenticated')::text, true);
    ok2 := false; begin perform public.maintenance_predictive_reset(r2, v_today - 10, null, 'Suite39: baixa manual sem KM'); exception when others then ok2 := true; end;
    ok3 := false; begin perform public.maintenance_predictive_reset(r2, v_today - 10, 79000, 'curto'); exception when others then ok3 := true; end;
    ok4 := false; begin perform public.maintenance_predictive_reset(r2, v_today + 1, 79000, 'Suite39: baixa manual no futuro'); exception when others then ok4 := true; end;
    perform public.maintenance_predictive_reset(r2, v_today - 10, 79000, 'Suite39: baixa manual após serviço externo');
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    select count(*) into n from public.audit_logs a where a.entity_id = r2::text and a.action = 'UPDATE' and a.new_data ->> 'reference_type' = 'manual_reset' and a.user_id = u_gf;
    select e.actor_name, e.actor_user_id into txt, r1 from public.maintenance_predictive_events e where e.cycle_id = r2 and e.event_type = 'manual_reset' order by e.created_at desc limit 1;
    perform set_config('request.jwt.claims', v_claims, true);
    ok := cy.reference_type = 'manual_reset' and cy.reference_km = 79000 and cy.reference_date = v_today - 10 and n >= 1
          and r1 = u_gf and txt = 'Suite39 Gestor de Frota';
    r := r || format('%s T14 baixa manual: sem KM recusada=%s, motivo curto recusado=%s, data futura recusada=%s; referência=%s @ %s km; auditoria=%s linha(s) com autor; evento por "%s"%s',
      case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, ok2, ok3, ok4, cy.reference_type, cy.reference_km, n, txt, chr(10));
  exception when others then perform set_config('request.jwt.claims', v_claims, true); r := r || 'FAIL T14 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T19 --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = vk and c.plan_item_id = i1;
    perform public.maintenance_predictive_reset(r2, v_today - 60, 85000, 'Suite39: referência de teste (T19)');
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    j := private.maintenance_predictive_refresh_quality(v_org);
    k := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'km_stale', true));
    ok := st.km_stale and st.km_age_days = 45 and st.technical_status = 'ok' and st.km_remaining = 5000
          and exists (select 1 from public.maintenance_predictive_quality_issues q where q.vehicle_id = vk and q.issue_type = 'km_stale' and q.resolved_at is null)
          and (k ->> 'rows_total')::int = 1 and (k -> 'summary' ->> 'km_stale')::int >= 1;
    r := r || format('%s T19 KM desatualizado: idade=%s dias (limite 30) flag=%s, status ainda calculado=%s, inconsistência km_stale=%s, filtro do painel=%s veículo(s)%s',
      case when ok then 'PASS' else 'FAIL' end, st.km_age_days, st.km_stale, st.technical_status, ok, k ->> 'rows_total', chr(10));
  exception when others then r := r || 'FAIL T19 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- TA --
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_lid, 'role', 'authenticated')::text, true);
    txt := '';
    j := public.maintenance_predictive_app_context(v_org);
    ok := (j ->> 'available')::boolean and j -> 'actor' ->> 'name' = 'Suite39 Liderança A' and (j -> 'rules' ->> 'km_max_age_days')::int = 30;
    txt := txt || format('contexto disponível=%s responsável=%s; ', j ->> 'available', j -> 'actor' ->> 'name');
    j := public.maintenance_predictive_app_vehicles(v_org, 'SUI39', v_today);
    select x into k from jsonb_array_elements(j -> 'vehicles') x where x ->> 'license_plate' = 'SUI3901';
    ok := ok and k is not null and (k ->> 'items')::int = 2 and k ->> 'operation_name' = 'Suite39 Operação A'
          and not exists (select 1 from jsonb_array_elements(j -> 'vehicles') x where x ->> 'license_plate' = 'SUI3903');
    txt := txt || format('veículos elegíveis no escopo=%s (SUI3901 itens=%s pior=%s, SUI3903 fora); ', jsonb_array_length(j -> 'vehicles'), k ->> 'items', k ->> 'worst_status');
    j := public.maintenance_predictive_app_roadmap(v_org, va1, null);
    ok := ok and jsonb_array_length(j -> 'items') = 2 and (j -> 'km' ->> 'official')::int = 105000 and (j ->> 'eligible')::boolean
          and j -> 'plan' ->> 'id' = v_plan::text and not (j ->> 'plan_ambiguous')::boolean
          and (select jsonb_array_length(x -> 'checklist') from jsonb_array_elements(j -> 'items') x where x ->> 'item_id' = i1::text) = 2;
    txt := txt || format('roteiro itens=%s KM oficial=%s tolerância=%s; ', jsonb_array_length(j -> 'items'), j -> 'km' ->> 'official', j -> 'km' ->> 'tolerance');
    -- envio: KM informado dentro da tolerância; óleo conforme; freios não conformes → corretiva
    select c.id into r1 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i2;
    j := public.maintenance_predictive_app_submit(v_org, jsonb_build_object('client_submission_id', sub1, 'vehicle_id', va1, 'km_informed', 105200,
           'general_observation', 'Suite39: verificação de campo',
           'items', jsonb_build_array(
             jsonb_build_object('cycle_id', r2, 'result', 'conforming', 'checklist', jsonb_build_array(jsonb_build_object('key', 'nivel', 'answer', 'conforme'))),
             jsonb_build_object('cycle_id', r1, 'result', 'non_conforming', 'notes', 'Suite39: ruído e desgaste nas pastilhas',
                                'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '2'))))));
    k := public.maintenance_predictive_app_submit(v_org, jsonb_build_object('client_submission_id', sub1, 'vehicle_id', va1, 'km_informed', 105200,
           'items', jsonb_build_array(jsonb_build_object('cycle_id', r2, 'result', 'conforming'))));
    ok2 := j ->> 'protocol' ~ '^VPF-[0-9]{4}-[0-9]{6}$' and (j ->> 'total_items')::int = 2 and (j ->> 'total_conforming')::int = 1
           and (j ->> 'total_non_conforming')::int = 1 and (j ->> 'maintenances_opened')::int = 1 and not (j ->> 'duplicate')::boolean
           and not (j -> 'km' ->> 'divergent')::boolean and (j -> 'km' ->> 'used')::int = 105200;
    ok3 := (k ->> 'duplicate')::boolean and k ->> 'protocol' = j ->> 'protocol' and k ->> 'id' = j ->> 'id' and (k ->> 'total_items')::int = 2;
    txt := txt || format('envio %s itens=%s conformes=%s NC=%s corretivas=%s; reenvio duplicado=%s mesmo protocolo=%s; ',
      j ->> 'protocol', j ->> 'total_items', j ->> 'total_conforming', j ->> 'total_non_conforming', j ->> 'maintenances_opened', k ->> 'duplicate', k ->> 'protocol' = j ->> 'protocol');
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r1;
    select s.* into st2 from private.maintenance_predictive_state_v2(v_org) s where s.cycle_id = r2;
    select count(*), count(*) filter (where pv.source = 'app' and pv.submission_id = (j ->> 'id')::uuid and pv.responsible_name = 'Suite39 Liderança A') into n, n2
      from public.maintenance_predictive_verifications pv where pv.cycle_id in (r1, r2) and pv.verified_on = v_today;
    ok4 := st.execution_status = 'to_schedule' and st.conformity = 'non_conforming' and st.open_maintenance_id is not null
           and st2.reference_type = 'verification' and st2.reference_km = 105200 and st2.technical_status = 'ok' and n2 = 2
           and exists (select 1 from public.maintenance_predictive_events e where e.submission_id = (j ->> 'id')::uuid and e.event_type = 'maintenance_generated');
    txt := txt || format('freios: execução=%s conformidade=%s corretiva=%s; óleo: referência=%s @ %s status=%s; verificações do app=%s; ',
      st.execution_status, st.conformity, st.open_maintenance_code, st2.reference_type, st2.reference_km, st2.technical_status, n2);
    jx := public.maintenance_predictive_my_submissions(v_org, 10);
    jy := public.maintenance_predictive_submission_detail(v_org, (j ->> 'id')::uuid);
    ok4 := ok4 and exists (select 1 from jsonb_array_elements(jx -> 'items') e where e ->> 'protocol' = j ->> 'protocol')
           and jsonb_array_length(jy -> 'items') = 2 and (jy -> 'km' ->> 'informed')::int = 105200 and (jy -> 'km' ->> 'official')::int = 105000
           and jy -> 'inspector' ->> 'name' = 'Suite39 Liderança A';
    -- divergência de KM: exige justificativa; com justificativa registra e marca divergente
    select c.id into r3 from public.maintenance_predictive_cycles c where c.vehicle_id = vb1 and c.plan_item_id = i1;
    perform set_config('request.jwt.claims', json_build_object('sub', u_gf, 'role', 'authenticated')::text, true);
    function_ok := false;
    begin
      perform public.maintenance_predictive_app_submit(v_org, jsonb_build_object('client_submission_id', sub2, 'vehicle_id', vb1, 'km_informed', 120000,
                'items', jsonb_build_array(jsonb_build_object('cycle_id', r3, 'result', 'conforming', 'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '7'))))));
    exception when others then function_ok := true;
    end;
    jx := public.maintenance_predictive_app_submit(v_org, jsonb_build_object('client_submission_id', sub3, 'vehicle_id', vb1, 'km_informed', 120000,
           'km_justification', 'Suite39: hodômetro substituído na oficina',
           'items', jsonb_build_array(jsonb_build_object('cycle_id', r3, 'result', 'conforming', 'checklist', jsonb_build_array(jsonb_build_object('key', 'pastilha', 'answer', '7'))))));
    perform set_config('request.jwt.claims', v_claims, true);
    ok4 := ok4 and function_ok and (jx -> 'km' ->> 'divergent')::boolean and (jx ->> 'total_items')::int = 1;
    txt := txt || format('KM divergente sem justificativa recusado=%s, com justificativa aceito e marcado=%s; ', function_ok, jx -> 'km' ->> 'divergent');
    jy := public.maintenance_predictive_verifications_search(v_org, jsonb_build_object('search', 'SUI3901'), 50, 0);
    jx := public.maintenance_predictive_submissions_search(v_org, jsonb_build_object('search', 'SUI39'), 50, 0);
    ok4 := ok4 and (jy ->> 'total')::int >= 3 and exists (select 1 from jsonb_array_elements(jy -> 'items') e where e ->> 'source' = 'app' and e ->> 'protocol' = j ->> 'protocol')
           and (jx ->> 'total')::int = 2;
    txt := txt || format('histórico pesquisável: verificações de SUI3901=%s, envios Suite39=%s', jy ->> 'total', jx ->> 'total');
    r := r || format('%s TA app de verificação: %s%s', case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, txt, chr(10));
    r := r || format('%s T18 idempotência do app: reenvio com o mesmo client_submission_id devolve o mesmo protocolo sem novas verificações (%s)%s',
      case when ok3 and n2 = 2 then 'PASS' else 'FAIL' end, n2, chr(10));
  exception when others then perform set_config('request.jwt.claims', v_claims, true); r := r || 'FAIL TA ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- TO --
  begin
    txt := '';
    j := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'rows_page', 1, 'rows_page_size', 2));
    k := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'rows_page', 2, 'rows_page_size', 2));
    ok := (j ->> 'rows_total')::int = 6 and jsonb_array_length(j -> 'rows') = 2 and jsonb_array_length(k -> 'rows') = 2
          and not exists (select 1 from jsonb_array_elements(j -> 'rows') a join jsonb_array_elements(k -> 'rows') b on a ->> 'vehicle_id' = b ->> 'vehicle_id')
          and jsonb_array_length(j -> 'columns') = 2 and jsonb_array_length(j -> 'forecast' -> 'km') = 4 and jsonb_array_length(j -> 'forecast' -> 'days') = 4
          and j -> 'rankings' ? 'fleets' and j -> 'rankings' ? 'clusters' and j -> 'rankings' ? 'operations' and j -> 'rankings' ? 'leaders'
          and jsonb_typeof(j -> 'insights') = 'array' and j -> 'health' ? 'score' and j -> 'quality' ? 'open' and j -> 'summary' ? 'formal_reference_pct'
          and (j ->> 'alerts_total')::int >= 1;
    txt := txt || format('paginação no servidor total=%s páginas de 2 distintas=%s; colunas=%s previsão km/dias=%s/%s janelas; rankings/insights/saúde(%s)/qualidade; alertas=%s; ',
      j ->> 'rows_total', ok, jsonb_array_length(j -> 'columns'), jsonb_array_length(j -> 'forecast' -> 'km'), jsonb_array_length(j -> 'forecast' -> 'days'), j -> 'health' ->> 'score', j ->> 'alerts_total');
    jx := public.maintenance_predictive_overview(v_org, jsonb_build_object('operation_ids', jsonb_build_array(op_b)));
    jy := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'cluster_ids', jsonb_build_array(c_fre), 'criticality', jsonb_build_array('high')));
    ok2 := (jx ->> 'rows_total')::int = 1 and jsonb_array_length(jy -> 'columns') = 1 and (jy -> 'columns' -> 0 ->> 'item_id') = i1::text;
    jx := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'conformity', jsonb_build_array('non_conforming')));
    jy := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39', 'leader_ids', jsonb_build_array(e_lid)));
    ok2 := ok2 and (jx ->> 'rows_total')::int >= 1 and exists (select 1 from jsonb_array_elements(jx -> 'rows') a where a ->> 'license_plate' = 'SUI3901')
           and (jy ->> 'rows_total')::int = 5;
    txt := txt || format('filtros: operação B=%s veículo, cluster+criticidade=1 coluna, não conforme inclui SUI3901, liderança A=%s veículos; ', (jx ->> 'rows_total'), jy ->> 'rows_total');
    jx := public.maintenance_predictive_summary(v_org, jsonb_build_object('search', 'SUI39'));
    jy := public.maintenance_predictive_indicators(v_org, jsonb_build_object('search', 'SUI39'));
    ok3 := (jx ->> 'items')::int = 12 and jy ? 'verifications' and jy ? 'recurrence' and jy ? 'sla' and jy ? 'conversion'
           and (jy -> 'verifications' ->> 'total')::int >= 5;
    txt := txt || format('resumo itens=%s; indicadores verificações=%s conversão/SLA/recorrência; ', jx ->> 'items', jy -> 'verifications' ->> 'total');
    perform private.maintenance_predictive_snapshot_daily(v_org, v_today);
    jx := public.maintenance_predictive_trends(v_org, jsonb_build_object('days', 30));
    jy := public.maintenance_predictive_events(v_org, jsonb_build_object('vehicle_ids', jsonb_build_array(va1)), 50, 0);
    ok3 := ok3 and jsonb_array_length(jx -> 'series') >= 1 and (jy ->> 'total')::int >= 5
           and exists (select 1 from jsonb_array_elements(jy -> 'items') e where e ->> 'event_type' = 'monitoring_started');
    txt := txt || format('tendência pontos=%s; eventos de SUI3901=%s; ', jsonb_array_length(jx -> 'series'), jy ->> 'total');
    jx := public.maintenance_predictive_quality(v_org, '{}'::jsonb, 200, 0);
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    jy := public.maintenance_predictive_cycle_history(r2);
    ok4 := exists (select 1 from jsonb_array_elements(jx -> 'items') e where e ->> 'issue_type' = 'vehicle_no_km' and e ->> 'vehicle_id' = vc::text)
           and exists (select 1 from jsonb_array_elements(jx -> 'items') e where e ->> 'issue_type' = 'km_stale' and e ->> 'vehicle_id' = vk::text)
           and exists (select 1 from jsonb_array_elements(jx -> 'items') e where e ->> 'issue_type' = 'reference_km_above_current' and e ->> 'vehicle_id' = vb1::text)
           and jsonb_array_length(jy -> 'events') >= 4 and jsonb_array_length(jy -> 'verifications') >= 2 and jsonb_array_length(jy -> 'maintenances') >= 1
           and jy ? 'last_verification' and jy ? 'last_maintenance' and jy ? 'context';
    txt := txt || format('qualidade: sem KM/KM desatualizado/referência acima do KM atual sinalizadas (abertas=%s); histórico do ciclo eventos=%s verificações=%s manutenções=%s',
      jx ->> 'total', jsonb_array_length(jy -> 'events'), jsonb_array_length(jy -> 'verifications'), jsonb_array_length(jy -> 'maintenances'));
    r := r || format('%s TO painel executivo: %s%s', case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL TO ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T15 --
  begin
    select array_agg(c.id order by c.id) into ids from public.maintenance_predictive_cycles c where c.plan_id = v_plan;
    select count(*) into ev0 from public.maintenance_predictive_events e where e.cycle_id = any (ids);
    select count(*), array_agg(pv.id) into ver0, ver_ids from public.maintenance_predictive_verifications pv where pv.cycle_id = any (ids);
    ok2 := false;
    begin
      perform public.maintenance_save_predictive_item(v_plan, jsonb_build_object('id', i1, 'cluster_id', c_fre, 'service_id', s_pas, 'name', 'Suite39 Freios dianteiros',
                'interval_km', 12000, 'interval_days', 180, 'alert_pct', 20, 'schedule_pct', 10, 'tolerance_pct', 10, 'criticality', 'high'), null);
    exception when others then ok2 := true;
    end;
    j := public.maintenance_save_predictive_item(v_plan, jsonb_build_object('id', i1, 'cluster_id', c_fre, 'service_id', s_pas, 'name', 'Suite39 Freios dianteiros',
           'interval_km', 12000, 'interval_days', 180, 'alert_pct', 20, 'schedule_pct', 10, 'tolerance_pct', 10, 'criticality', 'high'),
           'Suite39: intervalo revisado para 12.000 km');
    select p.version into n from public.maintenance_predictive_plans p where p.id = v_plan;
    select count(*) into n2 from public.maintenance_predictive_plan_versions pv where pv.plan_id = v_plan;
    select count(*) into n3 from public.maintenance_predictive_events e where e.cycle_id = any (ids);
    select count(*) into n4 from public.maintenance_predictive_verifications pv where pv.id = any (ver_ids);
    select s.* into st from private.maintenance_predictive_state_v2(v_org) s where s.vehicle_id = vb1 and s.item_id = i1;
    ok := (j ->> 'version_changed')::boolean and n = 2 and n2 = 2 and n3 > ev0 and n4 = ver0
          and (select count(*) from public.maintenance_predictive_cycles c where c.id = any (ids) and c.is_active) = 12
          and st.interval_km = 12000 and st.next_km = st.reference_km + 12000
          and exists (select 1 from public.maintenance_predictive_events e where e.cycle_id = any (ids) and e.event_type = 'plan_version');
    r := r || format('%s T15 alteração de plano: sem motivo recusada=%s; versão %s (snapshots=%s); ciclos recalculados (VB1 marco=%s = ref %s + 12.000) sem apagar ciclos (12 ativos), eventos %s→%s, verificações preservadas=%s%s',
      case when ok and ok2 then 'PASS' else 'FAIL' end, ok2, n, n2, st.next_km, st.reference_km, ev0, n3, n4 = ver0, chr(10));
  exception when others then r := r || 'FAIL T15 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- TP --
  begin
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va1 and c.plan_item_id = i1;
    select c.* into cy from public.maintenance_predictive_cycles c where c.id = r2;
    v_plan2 := public.maintenance_save_predictive_plan(v_org, jsonb_build_object('name', 'Suite39 Plano Concorrente', 'vehicle_type_id', v_type,
                 'vehicle_make_id', v_make, 'vehicle_model_id', v_model), null);
    j := public.maintenance_save_predictive_item(v_plan2, jsonb_build_object('cluster_id', c_fre, 'service_id', s_pas, 'name', 'Suite39 Freios (concorrente)', 'interval_km', 8000), null);
    i3 := (j ->> 'id')::uuid;
    j := public.maintenance_set_predictive_plan_status(v_plan2, 'approved', 'Suite39 plano concorrente');
    ok := private.maintenance_predictive_plan_ambiguous(va1) and (j ->> 'ambiguous_vehicles')::int >= 6
          and (public.maintenance_predictive_app_roadmap(v_org, va1, null) ->> 'plan_ambiguous')::boolean
          and exists (select 1 from public.maintenance_predictive_quality_issues q where q.vehicle_id = va1 and q.issue_type = 'plan_ambiguous' and q.resolved_at is null);
    ok2 := false;
    begin perform public.maintenance_set_predictive_plan_status(v_plan2, 'archived', ''); exception when others then ok2 := true; end;
    k := public.maintenance_set_predictive_plan_status(v_plan2, 'archived', 'Suite39: plano concorrente inativado');
    select c.* into st2 from public.maintenance_predictive_cycles c where c.id = r2;
    select count(*) into n from public.maintenance_predictive_cycles c where c.plan_id = v_plan and c.is_active;
    select count(*) into n2 from public.maintenance_predictive_cycles c where c.plan_id = v_plan2 and c.is_active;
    ok3 := not private.maintenance_predictive_plan_ambiguous(va1) and n = 12 and n2 = 0 and st2.is_active
           and st2.reference_type = cy.reference_type and st2.reference_km = cy.reference_km and st2.last_verification_id = cy.last_verification_id
           and (k ->> 'ambiguous_vehicles')::int = 0
           and not exists (select 1 from public.maintenance_predictive_quality_issues q where q.vehicle_id = va1 and q.issue_type = 'plan_ambiguous' and q.resolved_at is null);
    r := r || format('%s TP ambiguidade de plano: dois planos aprovados com a mesma especificidade → sinalizada (%s veículos, roteiro avisa, inconsistência aberta); inativar sem motivo recusado=%s; inativado → sem ambiguidade, 12 ciclos do plano original ativos com referência preservada (%s @ %s)%s',
      case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, j ->> 'ambiguous_vehicles', ok2, st2.reference_type, st2.reference_km, chr(10));
  exception when others then r := r || 'FAIL TP ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T16 --
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_lid, 'role', 'authenticated')::text, true);
    select count(*) filter (where s.vehicle_id = vb1), count(*) filter (where s.vehicle_id = va1) into n, n2 from private.maintenance_predictive_state_v2(v_org) s;
    j := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39'));
    k := public.maintenance_predictive_app_vehicles(v_org, 'SUI39', v_today);
    ok2 := false;
    begin perform public.maintenance_predictive_app_roadmap(v_org, vb1, null); exception when insufficient_privilege then ok2 := true; end;
    ok3 := false;
    begin perform public.maintenance_register_predictive_verification((select c.id from public.maintenance_predictive_cycles c where c.vehicle_id = vb1 and c.plan_item_id = i2),
             jsonb_build_object('result', 'conforming', 'responsible_name', 'Suite39 Liderança A'));
    exception when insufficient_privilege then ok3 := true; end;
    set local role authenticated;
    select count(*) filter (where c.vehicle_id = vb1), count(*) filter (where c.vehicle_id = va1) into n3, n4 from public.maintenance_predictive_cycles c where c.organization_id = v_org;
    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
    ok := n = 0 and n2 = 2 and (j ->> 'rows_total')::int = 5
          and not exists (select 1 from jsonb_array_elements(j -> 'rows') x where x ->> 'license_plate' = 'SUI3903')
          and not exists (select 1 from jsonb_array_elements(k -> 'vehicles') x where x ->> 'license_plate' = 'SUI3903')
          and ok2 and ok3 and n3 = 0 and n4 = 2;
    r := r || format('%s T16 escopo da Liderança A: motor VB1=%s/VA1=%s; painel %s veículos sem SUI3903; app sem SUI3903; roteiro de VB1 recusado=%s; verificação em VB1 recusada=%s; RLS ciclos VB1=%s/VA1=%s%s',
      case when ok then 'PASS' else 'FAIL' end, n, n2, j ->> 'rows_total', ok2, ok3, n3, n4, chr(10));
  exception when others then reset role; perform set_config('request.jwt.claims', v_claims, true); r := r || 'FAIL T16 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T17 --
  begin
    insert into public.organizations (name, slug) values ('Suite39 Outro Tenant', 'suite39-outro-tenant-' || substr(md5(random()::text), 1, 8)) returning id into v_org2;
    -- O Gestor de Frota de teste só tem vínculo na org A (um administrador da plataforma leria qualquer org por desenho).
    perform set_config('request.jwt.claims', json_build_object('sub', u_gf, 'role', 'authenticated')::text, true);
    ok2 := false; begin perform public.maintenance_predictive_overview(v_org2, '{}'); exception when insufficient_privilege then ok2 := true; end;
    ok3 := false; begin perform public.maintenance_predictive_app_submit(v_org2, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', va1, 'items', '[]'::jsonb)); exception when insufficient_privilege then ok3 := true; end;
    select count(*) into n from private.maintenance_predictive_state_v2(v_org2);
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    select (select count(*) from public.maintenance_predictive_cycles where organization_id = v_org2)
         + (select count(*) from public.maintenance_predictive_events where organization_id = v_org2)
         + (select count(*) from public.maintenance_predictive_submissions where organization_id = v_org2)
         + (select count(*) from public.maintenance_predictive_quality_issues where organization_id = v_org2) into n2;
    select (select count(*) from public.maintenance_predictive_cycles where organization_id = v_org and vehicle_id in (va1, vb1))
         + (select count(*) from public.maintenance_predictive_events where organization_id = v_org and vehicle_id = va1)
         + (select count(*) from public.maintenance_predictive_submissions where organization_id = v_org) into n3;
    reset role;
    ok := ok2 and ok3 and n = 0 and n2 = 0 and n3 >= 10;
    r := r || format('%s T17 multi-tenant: painel da org B recusado=%s, app na org B recusado=%s, motor da org B=%s linhas, RLS org B=%s linhas (org A visível=%s)%s',
      case when ok then 'PASS' else 'FAIL' end, ok2, ok3, n, n2, n3, chr(10));
  exception when others then reset role; perform set_config('request.jwt.claims', v_claims, true); r := r || 'FAIL T17 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- TS --
  begin
    txt := '';
    -- Operacional: executa o app, não acessa o painel
    perform set_config('request.jwt.claims', json_build_object('sub', u_op, 'role', 'authenticated')::text, true);
    j := public.maintenance_predictive_app_context(v_org);
    ok := (j ->> 'available')::boolean;
    ok2 := false; begin perform public.maintenance_predictive_overview(v_org, '{}'); exception when insufficient_privilege then ok2 := true; end;
    txt := txt || format('Operacional: app=%s painel recusado=%s; ', j ->> 'available', ok2);
    ok := ok and ok2;
    -- Gente: nada
    perform set_config('request.jwt.claims', json_build_object('sub', u_ge, 'role', 'authenticated')::text, true);
    ok2 := false; begin perform public.maintenance_predictive_app_context(v_org); exception when insufficient_privilege then ok2 := true; end;
    ok3 := false; begin perform public.maintenance_predictive_overview(v_org, '{}'); exception when insufficient_privilege then ok3 := true; end;
    txt := txt || format('Gente: app recusado=%s painel recusado=%s; ', ok2, ok3);
    ok := ok and ok2 and ok3;
    -- Gestão: lê painel e auditoria, não verifica nem gera
    perform set_config('request.jwt.claims', json_build_object('sub', u_gs, 'role', 'authenticated')::text, true);
    j := public.maintenance_predictive_overview(v_org, jsonb_build_object('search', 'SUI39'));
    k := public.maintenance_predictive_events(v_org, '{}'::jsonb, 5, 0);
    select c.id into r2 from public.maintenance_predictive_cycles c where c.vehicle_id = va2 and c.plan_item_id = i2;
    ok2 := false; begin perform public.maintenance_register_predictive_verification(r2, jsonb_build_object('result', 'conforming', 'responsible_name', 'Suite39 Gestão')); exception when insufficient_privilege then ok2 := true; end;
    ok3 := false; begin perform public.maintenance_generate_predictive(r2, '{}'); exception when insufficient_privilege then ok3 := true; end;
    ok4 := false; begin perform public.maintenance_predictive_reset(r2, v_today, 1, 'Suite39: gestão tenta baixa manual'); exception when insufficient_privilege then ok4 := true; end;
    txt := txt || format('Gestão: painel %s veículos, auditoria=%s eventos, verificar recusado=%s, gerar recusado=%s, baixa recusada=%s', j ->> 'rows_total', k ->> 'total', ok2, ok3, ok4);
    ok := ok and (j ->> 'rows_total')::int = 6 and (k ->> 'total')::int > 0 and ok2 and ok3 and ok4;
    perform set_config('request.jwt.claims', v_claims, true);
    r := r || format('%s TS RBAC por perfil: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then perform set_config('request.jwt.claims', v_claims, true); r := r || 'FAIL TS ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T20 --
  begin
    j := public.maintenance_dashboard(v_org, '{}');
    k := public.maintenance_list(v_org, jsonb_build_object('search', 'SUI39'), 'reference', 'desc', 50, 0);
    jx := public.maintenance_schedule_kpis(v_org, '{}');
    select count(*) into n from private.maintenance_preventive_state(v_org) s where s.vehicle_id in (va1, vb1);
    select km into n2 from private.vehicle_current_km(va1);
    jy := public.maintenance_parameters(v_org);
    ok := j ? 'kpis' and (k ->> 'total')::int >= 4 and jx is not null and n >= 2 and n2 = 105000
          and exists (select 1 from jsonb_array_elements(jy -> 'predictive_plans') p where p ->> 'id' = v_plan::text and (p -> 'items' -> 0 -> 'coverage') is not null)
          and exists (select 1 from jsonb_array_elements(jy -> 'preventive_rules') p where p ->> 'service_id' = s_oil::text);
    r := r || format('%s T20 regressão: painel geral ok, base geral lista %s manutenções Suite39, programação ok, preventiva %s ciclos, KM atual de VA1=%s, cadastros (planos com cobertura e regra preventiva) ok%s',
      case when ok then 'PASS' else 'FAIL' end, k ->> 'total', n, n2, chr(10));
  exception when others then r := r || 'FAIL T20 ' || sqlerrm || chr(10);
  end;

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end;
$t$;
