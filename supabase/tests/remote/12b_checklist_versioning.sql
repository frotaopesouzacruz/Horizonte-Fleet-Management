-- =============================================================================
-- 12b · Check List de Frota — versionamento, editor, publicação e histórico
--
-- Suíte transacional contra o banco COM DADOS: usa a organização, a versão 1.0
-- publicada, os tipos de equipamento, as operações e os veículos reais. Não
-- cria veículo, operação nem colaborador.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: é assim que
-- devolve o resultado e desfaz tudo o que fez.
--
-- O que cada bloco protege (§77):
--   V1/V1b  a versão de trabalho nasce da última publicada com TUDO copiado
--           (9/34/7/7) e é única por aplicativo (§43)
--   V2/V2b  editar o texto preserva a identidade; nova identidade só quando
--           declarada e com chave nova (§47)
--   V3      condicional de escolha exige >= 2 opções; um por pergunta (§25, §46)
--   V4      regra com alvo inexistente é recusada; alvo repetido também (§23)
--   V5      validação da publicação: cluster vazio bloqueia; corrigido, passa (§46)
--   V6      a prévia do rascunho usa o MESMO construtor do executor (§45)
--   V7/V7b  publicar arquiva a anterior; publicada é imutável pela rotina e
--           pelo gatilho (§43, CA18)
--   V8/V8b  §48: checklist aberto na 1.0 é aceito depois da publicação da
--           1.1 e fica vinculado à 1.0; aberto DEPOIS da publicação, é recusado
--   V9      usuário sem `configure` não cria versão nem valida (§63) — o ator
--           é rebaixado só dentro do bloco, sem criar conta
--   V10     descartar rascunho; publicada não se descarta
--   V11     auditoria de cluster e de habilitação por operação (§62) — a
--           habilitação passa pela rotina genérica de vínculo
--           `set_application_operation_link` (Refinamento, mesma fonte para
--           Operações, Tipos de Equipamento e gerenciador do aplicativo)
--   V12     Meus Checklists é só do colaborador; histórico do escopo filtra
--           por placa e traz o nome (§59, §64)
--
-- Última execução: 16/16 PASS contra o projeto de desenvolvimento (22/09/2026).
-- As mensagens vão sem acento de propósito: voltam dentro de uma mensagem de
-- erro do PostgreSQL, que atravessa clientes de codificação incerta.
-- =============================================================================
do $t$
declare
  v_org    uuid;
  v_admin  uuid;
  v_plain  uuid;
  v_app    uuid;
  v_v10    uuid;
  v_v11    uuid;
  v_v12    uuid;
  v_op     uuid;
  v_van    uuid;
  v_van_t  uuid;
  v_van_s  uuid;
  v_plate  text;
  v_cl     uuid;
  v_q      uuid;
  v_q2     uuid;
  v_cond   uuid;
  v_rule   uuid;
  v_exec   uuid;
  j        jsonb;
  j2       jsonb;
  n        bigint; n2 bigint; n3 bigint; n4 bigint;
  m        record;
  r        text := '';
  ok       boolean;
  msg      text;
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  select v.id into v_v10 from public.checklist_app_versions v
   where v.app_id = v_app and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  select id into v_op from public.operations where organization_id = v_org and code = 'OP-00004';
  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate
    into v_van, v_van_t, v_van_s, v_plate
    from public.vehicles v join public.vehicle_types t on t.id = v.vehicle_type_id
   where v.organization_id = v_org and v.deleted_at is null and v.status = 'active' and t.code = 'van'
   limit 1;

  -- Quem configura e quem so executa: escolhidos pela PERMISSAO, nunca pelo nome.
  for m in select mm.user_id from public.organization_memberships mm
            where mm.organization_id = v_org and mm.status = 'active' and mm.employee_id is not null
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', m.user_id, 'role', 'authenticated')::text, true);
    if v_admin is null
       and private.has_permission(v_org, 'applications.checklist_fleet.configure')
       and private.has_permission(v_org, 'applications.checklist_fleet.publish')
       and private.has_permission(v_org, 'applications.checklist_fleet.create_version')
       and private.has_permission(v_org, 'applications.checklist_fleet.manage_rules')
       and private.has_permission(v_org, 'applications.checklist_fleet.execute') then
      v_admin := m.user_id;
    elsif v_plain is null
       and not private.has_permission(v_org, 'applications.checklist_fleet.configure') then
      v_plain := m.user_id;
    end if;
    exit when v_admin is not null and v_plain is not null;
  end loop;

  if v_org is null or v_app is null or v_v10 is null or v_admin is null or v_van is null then
    raise exception 'FIXTURE incompleta: org=% app=% v10=% admin=% van=%', v_org, v_app, v_v10, v_admin, v_van;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- V1: nova versao de trabalho copia tudo da 1.0
  j := public.create_checklist_version(v_org, '{"bump":"minor","notes":"teste"}');
  v_v11 := (j ->> 'id')::uuid;
  select count(*) into n  from public.checklist_clusters where version_id = v_v11;
  select count(*) into n2 from public.checklist_questions where version_id = v_v11;
  select count(*) into n3 from public.checklist_question_conditionals where version_id = v_v11;
  select count(*) into n4 from public.checklist_question_rules where version_id = v_v11;
  r := r || format('V1  nova versao %s a partir de %s: %s clusters, %s perguntas, %s condicionais, %s regras -> %s%s',
       j ->> 'label', j ->> 'base_label', n, n2, n3, n4,
       case when j ->> 'label' = '1.1' and n = 9 and n2 = 34 and n3 = 7 and n4 = 7
             and (select status from public.checklist_app_versions where id = v_v10) = 'published'
            then 'PASS' else 'FAIL' end, chr(10));

  -- V1b: segunda versao de trabalho e recusada
  ok := false;
  begin
    perform public.create_checklist_version(v_org, '{}');
  exception when others then ok := sqlerrm like '%Ja existe uma vers%' or sqlerrm like '%Já existe uma vers%';
  end;
  r := r || format('V1b segundo rascunho recusado -> %s%s', case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- V2: editar texto preserva a identidade (§47)
  select q.id, q.cluster_id into v_q, v_cl from public.checklist_questions q
   where q.version_id = v_v11 and q.question_key = '5s.limpeza_externa';
  j := public.save_checklist_question(v_org, jsonb_build_object(
         'id', v_q, 'version_id', v_v11, 'cluster_id', v_cl,
         'question_text', 'A frota esta limpa externamente, incluindo o teto?',
         'conforming_answer', 'yes', 'criticality', 'media', 'is_required', true,
         'generates_action_plan', true, 'allows_note', true, 'note_required', false, 'status', 'active'));
  select question_text into msg from public.checklist_questions where id = v_q;
  r := r || format('V2  texto editado, chave %s preservada; 1.0 intacta -> %s%s', j ->> 'question_key',
       case when j ->> 'question_key' = '5s.limpeza_externa' and msg like '%incluindo o teto%'
             and (select question_text from public.checklist_questions
                   where version_id = v_v10 and question_key = '5s.limpeza_externa') not like '%teto%'
            then 'PASS' else 'FAIL' end, chr(10));

  -- V2b: nova identidade so quando declarada, com chave nova
  ok := false;
  begin
    perform public.save_checklist_question(v_org, jsonb_build_object(
      'id', v_q, 'version_id', v_v11, 'cluster_id', v_cl, 'new_identity', true,
      'question_text', 'A frota esta limpa externamente, incluindo o teto?'));
  exception when others then ok := sqlerrm like '%nova identidade%';
  end;
  j := public.save_checklist_question(v_org, jsonb_build_object(
         'id', v_q, 'version_id', v_v11, 'cluster_id', v_cl, 'new_identity', true,
         'question_key', '5s.limpeza_externa_teto',
         'question_text', 'A frota esta limpa externamente, incluindo o teto?'));
  r := r || format('V2b sem chave recusa; com chave nova vira %s -> %s%s', j ->> 'question_key',
       case when ok and j ->> 'question_key' = '5s.limpeza_externa_teto' then 'PASS' else 'FAIL' end, chr(10));

  -- V3: condicional de escolha com 1 opcao recusado; com 2 aceito; segundo recusado
  select q.id into v_q2 from public.checklist_questions q
   where q.version_id = v_v11 and q.question_key = '5s.limpeza_interna';
  ok := false;
  begin
    perform public.save_checklist_conditional(v_org, jsonb_build_object(
      'question_id', v_q2, 'trigger_answer', 'no', 'label', 'Onde esta sujo?',
      'field_type', 'single_select', 'options', '["Cabine"]'::jsonb));
  exception when others then ok := sqlerrm like '%pelo menos duas op%';
  end;
  j := public.save_checklist_conditional(v_org, jsonb_build_object(
         'question_id', v_q2, 'trigger_answer', 'no', 'label', 'Onde esta sujo?',
         'field_type', 'single_select', 'options', '["Cabine", "Bau"]'::jsonb));
  v_cond := (j ->> 'id')::uuid;
  n := 0;
  begin
    perform public.save_checklist_conditional(v_org, jsonb_build_object(
      'question_id', v_q2, 'trigger_answer', 'no', 'label', 'Outro campo', 'field_type', 'text'));
  exception when others then n := case when sqlerrm like '%um por pergunta%' then 1 else 0 end;
  end;
  r := r || format('V3  1 opcao recusada; 2 opcoes aceitas (%s); segundo condicional recusado -> %s%s',
       j -> 'options', case when ok and v_cond is not null and jsonb_array_length(j -> 'options') = 2 and n = 1
                            then 'PASS' else 'FAIL' end, chr(10));

  -- V4: regra com alvo inexistente e regra repetida
  ok := false;
  begin
    perform public.save_checklist_rule(v_org, jsonb_build_object(
      'question_id', v_q2, 'rule_kind', 'operation', 'mode', 'include', 'target_id', gen_random_uuid()));
  exception when others then ok := sqlerrm like '%Opera%n%o encontrada%';
  end;
  j := public.save_checklist_rule(v_org, jsonb_build_object(
         'question_id', v_q2, 'rule_kind', 'vehicle_type', 'mode', 'include', 'target_id', v_van_t));
  v_rule := (j ->> 'id')::uuid;
  n := 0;
  begin
    perform public.save_checklist_rule(v_org, jsonb_build_object(
      'question_id', v_q2, 'rule_kind', 'vehicle_type', 'mode', 'exclude', 'target_id', v_van_t));
  exception when others then n := case when sqlerrm like '%J% existe uma regra%' then 1 else 0 end;
  end;
  r := r || format('V4  alvo inexistente recusado; regra Van criada; repetida recusada -> %s%s',
       case when ok and v_rule is not null and n = 1 then 'PASS' else 'FAIL' end, chr(10));
  perform public.delete_checklist_rule(v_org, jsonb_build_object('id', v_rule));

  -- V5: validacao — cluster vazio bloqueia; removido, passa
  j := public.validate_checklist_version(v_org, v_v11);
  ok := (j ->> 'ok')::boolean;
  j2 := public.save_checklist_cluster(v_org, jsonb_build_object('version_id', v_v11, 'name', 'Cluster vazio'));
  j := public.validate_checklist_version(v_org, v_v11);
  n := (select count(*) from jsonb_array_elements(j -> 'errors') e where e ->> 'code' = 'cluster_vazio');
  perform public.delete_checklist_cluster(v_org, jsonb_build_object('id', j2 ->> 'id'));
  j := public.validate_checklist_version(v_org, v_v11);
  r := r || format('V5  valida antes: %s; com cluster vazio: %s erro(s); depois: %s (%s avisos) -> %s%s',
       ok, n, j ->> 'ok', jsonb_array_length(j -> 'warnings'),
       case when ok and n = 1 and (j ->> 'ok')::boolean then 'PASS' else 'FAIL' end, chr(10));

  -- V6: previa do rascunho == formulario do executor (mesmo construtor)
  j := public.checklist_version_preview(v_org, v_v11, v_op, v_van_t, v_van_s);
  j2 := public.checklist_fleet_form(v_org, v_van, v_op);
  select count(*) into n from jsonb_array_elements(j -> 'clusters') c, jsonb_array_elements(c -> 'questions') q;
  select count(*) into n2 from jsonb_array_elements(j2 -> 'clusters') c, jsonb_array_elements(c -> 'questions') q;
  r := r || format('V6  previa do rascunho (Van): %s perguntas; executor 1.0 (Van): %s -> %s%s', n, n2,
       case when n = n2 and n > 0 and j ->> 'version_status' = 'draft' then 'PASS' else 'FAIL' end, chr(10));

  -- V7: publicar
  j := public.publish_checklist_version(v_org, jsonb_build_object('version_id', v_v11));
  j2 := public.checklist_fleet_context(v_org);
  r := r || format('V7  publicada %s, arquivada %s; contexto serve %s -> %s%s',
       j ->> 'label', j ->> 'archived_label', j2 -> 'version' ->> 'label',
       case when j ->> 'label' = '1.1' and j ->> 'archived_label' = '1.0'
             and (select status from public.checklist_app_versions where id = v_v10) = 'archived'
             and (select status from public.checklist_app_versions where id = v_v11) = 'published'
             and (select published_at is not null from public.checklist_app_versions where id = v_v11)
             and j2 -> 'version' ->> 'label' = '1.1'
            then 'PASS' else 'FAIL' end, chr(10));

  -- V7b: publicada e imutavel — pela rotina e pelo gatilho
  ok := false;
  begin
    perform public.save_checklist_question(v_org, jsonb_build_object(
      'id', v_q, 'version_id', v_v11, 'cluster_id', v_cl, 'question_text', 'Tentativa de editar publicada'));
  exception when others then ok := sqlerrm like '%imut%';
  end;
  n := 0;
  begin
    update public.checklist_questions set question_text = 'x' where id = v_q;
  exception when others then n := case when sqlerrm like '%imut%' then 1 else 0 end;
  end;
  r := r || format('V7b edicao da publicada recusada pela rotina e pelo gatilho -> %s%s',
       case when ok and n = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- V8 (§48): checklist aberto na 1.0 antes da publicacao e aceito e fica na 1.0
  j := public.checklist_version_preview(v_org, v_v10, v_op, v_van_t, v_van_s);
  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'answer', q ->> 'conforming_answer'))
    into j2
    from jsonb_array_elements(j -> 'clusters') c, jsonb_array_elements(c -> 'questions') q;
  j := public.submit_checklist_execution(v_org, jsonb_build_object(
         'idempotency_key', 'teste-v8-' || gen_random_uuid()::text,
         'vehicle_id', v_van, 'operation_id', v_op, 'checklist_type', 'saida',
         'operational_date', current_date, 'started_at', now() - interval '2 minutes',
         'version_id', v_v10, 'answers', j2));
  v_exec := (j ->> 'execution_id')::uuid;
  r := r || format('V8  envio com formulario 1.0 aberto antes da publicacao: execucao na versao %s -> %s%s',
       (select v.label from public.checklist_executions e join public.checklist_app_versions v on v.id = e.version_id where e.id = v_exec),
       case when (select version_id from public.checklist_executions where id = v_exec) = v_v10
             and (j ->> 'status') = 'submitted' then 'PASS' else 'FAIL' end, chr(10));

  -- V8b: aberto DEPOIS da publicacao com a versao antiga -> recusado
  ok := false;
  begin
    perform public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'teste-v8b-' || gen_random_uuid()::text,
      'vehicle_id', v_van, 'operation_id', v_op, 'checklist_type', 'retorno',
      'operational_date', current_date, 'started_at', now() + interval '1 second',
      'version_id', v_v10, 'answers', j2));
  exception when others then ok := sqlerrm like '%foi atualizado para a vers%';
  end;
  r := r || format('V8b formulario antigo aberto depois da publicacao recusado -> %s%s',
       case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- V12: Meus Checklists e historico do escopo
  j := public.checklist_my_executions(v_org, 50);
  select count(*) into n from jsonb_array_elements(j) e where (e ->> 'id')::uuid = v_exec;
  j2 := public.checklist_scope_executions(v_org, jsonb_build_object('search', v_plate));
  select count(*) into n2 from jsonb_array_elements(j2) e where (e ->> 'id')::uuid = v_exec and e ->> 'employee_name' is not null;
  r := r || format('V12 execucao aparece em Meus Checklists (%s) e no escopo por placa com nome (%s) -> %s%s',
       n, n2, case when n = 1 and n2 = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- V9: usuario sem configure/create_version/publish.
  -- O banco de desenvolvimento so tem o administrador (platform admin). Em vez
  -- de inventar uma conta, o proprio ator e REBAIXADO temporariamente dentro de
  -- um sub-bloco que termina em excecao proposital: o rebaixamento e desfeito
  -- ali mesmo, e os blocos seguintes voltam a rodar como administrador. A flag
  -- hfm.access_change e a mesma que as rotinas oficiais de acesso usam.
  ok := false; n := 0;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_admin and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_admin and om.organization_id = v_org
       and p.code in ('applications.checklist_fleet.configure',
                      'applications.checklist_fleet.create_version',
                      'applications.checklist_fleet.publish');
    perform set_config('hfm.access_change', '', true);
    if private.has_permission(v_org, 'applications.checklist_fleet.configure') then
      raise exception 'rebaixamento nao surtiu efeito' using errcode = 'HF002';
    end if;
    begin
      perform public.create_checklist_version(v_org, '{}');
    exception when others then ok := sqlstate = '42501';
    end;
    begin
      perform public.validate_checklist_version(v_org, v_v11);
    exception when others then n := case when sqlstate = '42501' then 1 else 0 end;
    end;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  r := r || format('V9  usuario sem configure: criar versao e validar recusados -> %s%s',
       case when ok and n = 1 then 'PASS' else 'FAIL' end, chr(10));
  if not private.has_permission(v_org, 'applications.checklist_fleet.configure') then
    raise exception 'V9 nao restaurou o administrador';
  end if;

  -- V10: descartar rascunho; publicada nao se descarta
  j := public.create_checklist_version(v_org, '{"bump":"major"}');
  v_v12 := (j ->> 'id')::uuid;
  j2 := public.discard_checklist_version(v_org, jsonb_build_object('id', v_v12));
  ok := not exists (select 1 from public.checklist_app_versions where id = v_v12);
  n := 0;
  begin
    perform public.discard_checklist_version(v_org, jsonb_build_object('id', v_v11));
  exception when others then n := case when sqlerrm like '%imut%' then 1 else 0 end;
  end;
  r := r || format('V10 rascunho %s descartado; publicada nao se descarta -> %s%s', j ->> 'label',
       case when j ->> 'label' = '2.0' and ok and n = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- V11: auditoria de cluster e de operacao habilitada
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_op, 'is_enabled', false));
  perform public.set_application_operation_link(v_org, jsonb_build_object('app_id', v_app, 'operation_id', v_op, 'is_enabled', true));
  select count(*) into n from public.audit_logs where entity_type like '%checklist_clusters' and created_at >= now();
  select count(*) into n2 from public.audit_logs where entity_type like '%checklist_app_operations' and created_at >= now();
  r := r || format('V11 auditoria: %s eventos de cluster, %s de operacao habilitada -> %s%s', n, n2,
       case when n > 0 and n2 >= 2 then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
