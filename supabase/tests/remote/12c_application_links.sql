-- =============================================================================
-- 12c · Aplicativos × Operações × Tipos de Equipamento — vínculos, elegibilidade
--       e fluxo do Check List de Frota (Refinamento da Etapa 12, §51–§58)
--
-- Suíte transacional contra o banco COM DADOS: usa as operações, os tipos, os
-- veículos fidelizados e a versão 1.0 publicada que existem de verdade. O único
-- registro criado é um aplicativo de teste (§55), dentro da transação — e a
-- transação termina em ROLLBACK, como sempre.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- O que cada bloco protege:
--   L1      §51  só as 4 operações habilitadas aparecem; Frota, Gente, Gestão e
--                Segurança não
--   L2/L2b  §52  Frota Leve ADM não aparece nos tipos nem nas placas; pedido
--                direto do formulário e envio manipulado são recusados
--   L3      §53  Van em Last Mille MG lista só vans elegíveis; Caminhão em
--                Redespacho - MG lista só caminhões elegíveis
--   L4      §54  habilitar Frota faz a operação aparecer; desabilitar a retira;
--                cada mudança fica na auditoria com valor anterior e novo
--   L5      §55  aplicativo novo não aparece em operação nem tipo algum até ser
--                vinculado; vinculado, aparece na leitura única; histórico lista
--   L6      §56  saída enviada: operação, tipo e BR corretos; obrigação de saída
--                conciliada; retorno NÃO marcado; Frota Leve ADM sem obrigação
--   L7      §57  manipulação de operation_id e vehicle_id recusada no servidor;
--                usuário sem permissão não altera vínculos
--   L8      §58  9 clusters, 34 perguntas, 7 condicionais, 2 invertidas intactos
--
-- Última execução: 9/9 PASS contra o projeto de desenvolvimento (22/09/2026).
-- As mensagens vão sem acento de propósito.
-- =============================================================================
do $t$
declare
  v_org uuid; v_admin uuid; v_plain uuid; v_app uuid;
  v_lmmg uuid; v_frota uuid; v_redmg uuid;
  v_van_t uuid; v_car_t uuid; v_truck_t uuid;
  v_van uuid; v_car uuid; v_truck uuid;
  v_test_app uuid; v_v10 uuid;
  j jsonb; j2 jsonb; f jsonb; v_ans jsonb; v_res jsonb; v_exec uuid;
  n bigint; n2 bigint; n3 bigint; n4 bigint; ok boolean; m record; o record; r text := '';
  t0 timestamptz := now(); -- os gatilhos de auditoria carimbam now(): o inicio da transacao
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  select id into v_lmmg  from public.operations where organization_id = v_org and lower(name) = 'last mille mg';
  select id into v_frota from public.operations where organization_id = v_org and lower(name) = 'frota';
  select id into v_redmg from public.operations where organization_id = v_org and lower(name) = 'redespacho - mg';
  select id into v_van_t   from public.vehicle_types where code = 'van'   and (organization_id = v_org or organization_id is null) and deleted_at is null limit 1;
  select id into v_car_t   from public.vehicle_types where code = 'car'   and (organization_id = v_org or organization_id is null) and deleted_at is null limit 1;
  select id into v_truck_t from public.vehicle_types where code = 'truck' and (organization_id = v_org or organization_id is null) and deleted_at is null limit 1;
  select v.id into v_v10 from public.checklist_app_versions v where v.app_id = v_app and v.status = 'published';

  for m in select mm.user_id from public.organization_memberships mm
            where mm.organization_id = v_org and mm.status = 'active' and mm.employee_id is not null
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', m.user_id, 'role', 'authenticated')::text, true);
    if v_admin is null
       and private.has_permission(v_org, 'applications.manage_operation_links')
       and private.has_permission(v_org, 'applications.manage_equipment_links')
       and private.has_permission(v_org, 'applications.checklist_fleet.execute')
       and private.has_permission(v_org, 'operations.access_all') then
      v_admin := m.user_id;
    elsif v_plain is null and not private.has_permission(v_org, 'applications.manage_operation_links') then
      v_plain := m.user_id;
    end if;
    exit when v_admin is not null and v_plain is not null;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select v.id into v_van from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.vehicle_type_id = v_van_t
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_lmmg, current_date) limit 1;
  select v.id into v_truck from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.vehicle_type_id = v_truck_t
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_redmg, current_date) limit 1;
  select v.id into v_car from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.vehicle_type_id = v_car_t
     and v.status = 'active' and private.vehicle_in_operation(v_org, v.id, v_lmmg, current_date) limit 1;

  if v_org is null or v_app is null or v_lmmg is null or v_frota is null or v_redmg is null
     or v_admin is null or v_van is null or v_truck is null or v_car is null then
    raise exception 'FIXTURE incompleta: app=% lmmg=% frota=% redmg=% admin=% van=% truck=% car=%',
      v_app, v_lmmg, v_frota, v_redmg, v_admin, v_van, v_truck, v_car;
  end if;

  -- L1 (§51)
  j := public.checklist_fleet_context(v_org);
  select count(*) into n from jsonb_array_elements(j -> 'operations');
  select count(*) into n2 from jsonb_array_elements(j -> 'operations') e
   where lower(e ->> 'name') in ('frota', 'gente', 'gestão', 'gestao', 'segurança', 'seguranca');
  select count(*) into n3 from jsonb_array_elements(j -> 'operations') e
   where lower(e ->> 'name') in ('last mille mg', 'merchandising', 'redespacho - mg', 'redespacho - belém/pa');
  r := r || format('L1  operacoes no app: %s (4 esperadas), proibidas presentes: %s -> %s%s', n, n2,
       case when n = 4 and n2 = 0 and n3 = 4 then 'PASS' else 'FAIL' end, chr(10));

  -- L2 (§52): Frota Leve ADM fora dos tipos e das placas
  j := public.checklist_equipment_options(v_org, v_lmmg);
  select count(*) into n from jsonb_array_elements(j) e where (e ->> 'id')::uuid = v_car_t;
  select count(*) into n2 from jsonb_array_elements(j) e where (e ->> 'id')::uuid = v_van_t;
  j2 := public.checklist_vehicle_options(v_org, v_lmmg, v_car_t);
  select count(*) into n3 from jsonb_array_elements(j2);
  r := r || format('L2  tipos em Last Mille MG: ADM presente=%s, Van presente=%s; placas ADM pedidas direto=%s -> %s%s',
       n, n2, n3, case when n = 0 and n2 = 1 and n3 = 0 then 'PASS' else 'FAIL' end, chr(10));

  -- L2b: pedido direto do formulario e envio manipulado com carro ADM
  ok := false;
  begin
    f := public.checklist_fleet_form(v_org, v_car, v_lmmg);
  exception when others then ok := sqlerrm like '%n%o est% dispon%vel%';
  end;
  n := 0;
  begin
    perform public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'l2b-' || gen_random_uuid()::text, 'vehicle_id', v_car, 'operation_id', v_lmmg,
      'checklist_type', 'saida', 'started_at', now() - interval '2 minutes', 'answers', '[]'::jsonb));
  exception when others then n := case when sqlerrm like '%n%o est% dispon%vel%' then 1 else 0 end;
  end;
  r := r || format('L2b formulario e envio com Frota Leve ADM recusados no servidor -> %s%s',
       case when ok and n = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- L3 (§53)
  j := public.checklist_vehicle_options(v_org, v_lmmg, v_van_t);
  select count(*) into n from jsonb_array_elements(j);
  select count(*) into n2 from jsonb_array_elements(j) e where (e ->> 'vehicle_type_id')::uuid = v_van_t;
  select count(*) into n3 from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.vehicle_type_id = v_van_t
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_lmmg, current_date)
     and private.vehicle_in_scope(v_org, v.id);
  j2 := public.checklist_vehicle_options(v_org, v_redmg, v_truck_t);
  select count(*) into n4 from jsonb_array_elements(j2) e where (e ->> 'vehicle_type_id')::uuid = v_truck_t;
  r := r || format('L3  vans em Last Mille MG: %s listadas, %s do tipo Van, %s elegiveis; caminhoes em Redespacho - MG: %s -> %s%s',
       n, n2, n3, n4, case when n > 0 and n = n2 and n = n3 and n4 > 0
                            and jsonb_array_length(j2) = n4 then 'PASS' else 'FAIL' end, chr(10));

  -- L4 (§54): habilitar e desabilitar Frota
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_frota, 'is_enabled', true));
  j := public.checklist_fleet_context(v_org);
  select count(*) into n from jsonb_array_elements(j -> 'operations') e where (e ->> 'id')::uuid = v_frota;
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_frota, 'is_enabled', false));
  j := public.checklist_fleet_context(v_org);
  select count(*) into n2 from jsonb_array_elements(j -> 'operations') e where (e ->> 'id')::uuid = v_frota;
  select count(*) into n3 from public.audit_logs l
   where l.organization_id = v_org and l.entity_type like '%checklist_app_operations' and l.created_at >= t0
     and (l.new_data ->> 'operation_id')::uuid = v_frota
     and l.old_data ->> 'is_enabled' is distinct from l.new_data ->> 'is_enabled';
  j2 := public.application_link_history(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_frota, 'limit', 5));
  r := r || format('L4  Frota habilitada aparece=%s, desabilitada aparece=%s, auditoria com antes/depois=%s, historico=%s -> %s%s',
       n, n2, n3, jsonb_array_length(j2),
       case when n = 1 and n2 = 0 and n3 = 2 and jsonb_array_length(j2) >= 2 then 'PASS' else 'FAIL' end, chr(10));

  -- L5 (§55): aplicativo de teste, criado e descartado nesta transacao
  insert into public.operational_apps
    (organization_id, code, name, slug, description, platform, is_active, is_official, is_configurable, allows_attachments)
  values (v_org, 'teste_vinculos', 'App de Teste (rollback)', 'app-teste-rollback', 'Criado pela suite 12c.',
          'mobile_responsive', true, false, false, false)
  returning id into v_test_app;
  j := public.application_links_overview(v_org, v_test_app);
  n := jsonb_array_length(j -> 'operation_links'); n2 := jsonb_array_length(j -> 'type_links');
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_test_app, 'operation_id', v_lmmg, 'is_enabled', true));
  perform public.set_application_vehicle_type_link(v_org, jsonb_build_object('app_id', v_test_app, 'vehicle_type_id', v_van_t, 'is_enabled', true));
  j := public.application_links_overview(v_org, v_test_app);
  select count(*) into n3 from jsonb_array_elements(j -> 'operation_links') e where (e ->> 'in_force')::boolean;
  select count(*) into n4 from jsonb_array_elements(j -> 'type_links') e where (e ->> 'in_force')::boolean;
  ok := private.app_vehicle_eligible(v_org, v_test_app, v_van, v_lmmg, current_date)
        and not private.app_vehicle_eligible(v_org, v_test_app, v_truck, v_redmg, current_date);
  r := r || format('L5  app novo: %s/%s vinculos ao nascer; apos vincular %s operacao e %s tipo vigentes; elegibilidade so na combinacao -> %s%s',
       n, n2, n3, n4, case when n = 0 and n2 = 0 and n3 = 1 and n4 = 1 and ok then 'PASS' else 'FAIL' end, chr(10));

  -- L6 (§56): saida enviada para uma van elegivel
  f := public.checklist_fleet_form(v_org, v_van, v_lmmg);
  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'answer', q ->> 'conforming_answer',
           'conditional_value', case when q -> 'conditional' ->> 'trigger_answer' = q ->> 'conforming_answer'
             then jsonb_build_object(q -> 'conditional' ->> 'field_key', 'Teste 12c.') else null end))
    into v_ans from jsonb_array_elements(f -> 'clusters') c, jsonb_array_elements(c -> 'questions') q;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', 'l6-' || gen_random_uuid()::text, 'vehicle_id', v_van, 'operation_id', v_lmmg,
    'checklist_type', 'saida', 'operational_date', current_date,
    'started_at', now() - interval '2 minutes', 'version_id', f ->> 'version_id', 'answers', v_ans));
  v_exec := (v_res ->> 'execution_id')::uuid;
  select e.operation_id, e.vehicle_type_id, e.operation_br_id, e.status into o from public.checklist_executions e where e.id = v_exec;
  select count(*) into n from public.adherence_obligation_status s
   where s.execution_id = v_exec and s.checklist_context = 'saida' and s.is_done;
  select count(*) into n2 from public.adherence_obligation_status s
   where s.vehicle_id = v_van and s.operational_date = current_date and s.checklist_context = 'retorno' and s.is_done;
  select count(*) into n3 from public.adherence_obligation_status s
   where s.vehicle_id = v_car and s.operational_date = current_date;
  select count(*) into n4 from private.adherence_expected(v_org, current_date + 1, current_date + 1, null, v_car);
  r := r || format('L6  execucao %s: operacao ok=%s, tipo ok=%s, BR=%s; saida conciliada=%s, retorno marcado=%s; ADM: obrigacoes hoje=%s, esperadas amanha=%s -> %s%s',
       o.status, o.operation_id = v_lmmg, o.vehicle_type_id = v_van_t, o.operation_br_id is not null, n, n2, n3, n4,
       case when o.status = 'submitted' and o.operation_id = v_lmmg and o.vehicle_type_id = v_van_t
             and o.operation_br_id is not null and n = 1 and n2 = 0 and n3 = 0 and n4 = 0 then 'PASS' else 'FAIL' end, chr(10));

  -- L7 (§57): manipulacao direta
  n := 0; n2 := 0; n3 := 0;
  begin
    perform public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'l7a-' || gen_random_uuid()::text, 'vehicle_id', v_van, 'operation_id', v_frota,
      'checklist_type', 'saida', 'started_at', now() - interval '2 minutes', 'answers', v_ans));
  exception when others then n := case when sqlerrm like '%n%o est% dispon%vel%' then 1 else 0 end;
  end;
  begin
    perform public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'l7b-' || gen_random_uuid()::text, 'vehicle_id', v_truck, 'operation_id', v_lmmg,
      'checklist_type', 'saida', 'started_at', now() - interval '2 minutes', 'answers', v_ans));
  exception when others then n2 := case when sqlerrm like '%n%o est% dispon%vel%' then 1 else 0 end;
  end;
  begin
    perform public.set_application_vehicle_type_link(v_org, jsonb_build_object('app_id', v_app, 'vehicle_type_id', gen_random_uuid(), 'is_enabled', true));
  exception when others then n3 := case when sqlerrm like '%n%o encontrad%' then 1 else 0 end;
  end;
  -- Sem permissao: se nao houver usuario comum na organizacao, o proprio ator e
  -- REBAIXADO dentro de um sub-bloco desfeito por excecao proposital (mesma
  -- tecnica da suite 12b, V9). Nada e inventado, nada persiste.
  n4 := 0;
  if v_plain is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_plain, 'role', 'authenticated')::text, true);
    begin
      perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_frota, 'is_enabled', true));
    exception when others then n4 := case when sqlstate = '42501' then 1 else 0 end;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  else
    begin
      perform set_config('hfm.access_change', 'on', true);
      update public.platform_admins set revoked_at = now() where user_id = v_admin and revoked_at is null;
      delete from public.role_permissions rp
       using public.permissions p, public.membership_roles mr, public.organization_memberships om
       where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
         and om.user_id = v_admin and om.organization_id = v_org
         and p.code in ('applications.manage_operation_links', 'applications.manage_equipment_links');
      perform set_config('hfm.access_change', '', true);
      begin
        perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_frota, 'is_enabled', true));
      exception when others then n4 := case when sqlstate = '42501' then 1 else 0 end;
      end;
      begin
        perform public.set_application_vehicle_type_link(v_org, jsonb_build_object('app_id', v_app, 'vehicle_type_id', v_car_t, 'is_enabled', true));
      exception when others then n4 := n4 + case when sqlstate = '42501' then 1 else 0 end;
      end;
      raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
    exception when sqlstate 'HF001' then null;
    end;
    if not private.has_permission(v_org, 'applications.manage_operation_links') then
      raise exception 'L7 nao restaurou o administrador';
    end if;
    n4 := case when n4 = 2 then 1 else 0 end;
  end if;
  r := r || format('L7  operacao desabilitada=%s, veiculo de outra operacao=%s, tipo inexistente=%s, sem permissao=%s -> %s%s',
       n, n2, n3, n4,
       case when n = 1 and n2 = 1 and n3 = 1 and n4 = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- L8 (§58): regressao da configuracao
  select count(*) into n from public.checklist_clusters where version_id = v_v10;
  select count(*) into n2 from public.checklist_questions where version_id = v_v10 and status = 'active';
  select count(*) into n3 from public.checklist_question_conditionals where version_id = v_v10;
  select count(*) into n4 from public.checklist_questions where version_id = v_v10 and conforming_answer = 'no';
  r := r || format('L8  versao 1.0: %s clusters, %s perguntas, %s condicionais, %s invertidas -> %s%s',
       n, n2, n3, n4, case when n = 9 and n2 = 34 and n3 = 7 and n4 = 2 then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
