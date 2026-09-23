-- =============================================================================
-- 16c · Check List de Frota — correção administrativa de execução enviada
--       (§60, §62) e vigência na validação da publicação (§46)
--
-- Suíte transacional contra o banco COM DADOS. Usa a organização, a versão
-- publicada, a operação Last Mille MG, uma van elegível e o administrador que
-- existem de verdade. A única execução corrigida é criada AQUI, pelo envio
-- oficial, dentro da transação — nenhuma execução real é tocada — e tudo
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco (ou
-- `execute_sql` do MCP). O resultado volta na mensagem da exceção.
--
-- O que cada bloco protege:
--   C1   permissão `applications.checklist_fleet.correct` no catálogo, padrão
--        só em Administrador e Gestor de Frota
--   C2   correção sem motivo (vazio ou curto) recusada; nada gravado
--   C3   prévia (`dry_run`) devolve antes/depois e o resumo recalculado sem
--        gravar; condicional obrigatório acionado sem valor e opção fora da
--        lista recusados
--   C4   correção válida: valores originais preservados (antes/depois por
--        item), resposta invertida recalculada pela regra da pergunta, resumo
--        da execução e do cluster recalculados, identidade intacta
--   C5   auditoria oficial com o ATOR REAL (cabeçalho, itens e a execução)
--   C6   identidade não se corrige: veículo, data, tipo, BR e chave extra no
--        item recusados pela rotina; com o portão aberto, o gatilho ainda
--        recusa mudar data/tipo/veículo, trocar a pergunta ou excluir resposta
--   C7   registro de correção imutável, inclusive para o dono da tabela
--   C8   UPDATE/DELETE direto do usuário normal não altera nada (RLS);
--        INSERT direto no registro de correção negado; sem o portão, nem o
--        dono da tabela altera o resumo de uma execução enviada
--   C9   segunda correção: sequência 2, o "antes" é o "depois" da primeira, o
--        condicional é descartado ao voltar para SIM, o histórico da primeira
--        continua; o detalhe mostra "corrigida" e as duas correções
--   C10  usuário SEM a permissão: rotina e formulário recusados (42501) —
--        o ator é rebaixado só dentro do bloco, sem criar conta
--   C11  outra organização: execução não encontrada na organização B (onde o
--        ator TEM a permissão) e organização inexistente recusada
--   C12  validação da publicação conta só vínculos vigentes hoje: vencido
--        ontem e futuro não contam; todos vencidos = "sem_operacoes"
--
-- Última execução: 23/09/2026 (projeto jgyvaltwqntpcjqounty) — 12/12 PASS
--   PASS C1 permissao no catalogo; padrao em administrador e gestor_frota, fora de lideranca/operacional/gestao/seguranca
--   PASS C2 sem motivo e com motivo curto: recusados, nada gravado
--   PASS C3 previa: nao conformes 0->1, criticas 0->1, nada gravado; condicional obrigatorio e opcao invalida recusados
--   PASS C4 correcao: 2 itens com antes/depois, invertida inconforme, resumo 0->2 (criticas 0->1), clusters recalculados, identidade intacta
--   PASS C5 auditoria com o ator real: cabecalho 1, itens 2, execucao 1 (non_conforming_answers)
--   PASS C6 identidade: vehicle_id, operational_date, checklist_type, operation_br_id e chave extra no item recusados; gatilho recusa data/tipo/veiculo/pergunta/exclusao mesmo com o portao
--   PASS C7 registro de correcao imutavel (UPDATE e DELETE recusados ao dono da tabela)
--   PASS C8 escrita direta: UPDATE/DELETE do usuario afetam 0 linhas, INSERT negado (42501); sem portao o dono nao altera o resumo
--   PASS C9 segunda correcao: sequencia 2, antes = depois da 1a, condicional descartado, resumo 2->1, historico com 2 correcoes, 2 respostas marcadas
--   PASS C10 sem a permissao: correcao e formulario recusados (42501); administrador restaurado
--   PASS C11 outra organizacao: execucao nao encontrada na organizacao B; organizacao inexistente recusada (42501)
--   PASS C12 vigencia: 4 vigentes -> vencido ontem 3 -> futuro 2 -> todos vencidos sem_operacoes (is_enabled continua true)
-- As mensagens vão sem acento de propósito: voltam dentro de uma mensagem de
-- erro do PostgreSQL, que atravessa clientes de codificação incerta.
-- =============================================================================
do $t$
declare
  v_org uuid; v_admin uuid; v_mem uuid; v_app uuid; v_v10 uuid;
  v_lmmg uuid; v_van_t uuid; v_van uuid; v_org_b uuid;
  v_exec uuid; v_corr1 uuid; v_corr2 uuid;
  v_q_freio uuid; v_q_avaria uuid; v_q_limpeza uuid; v_a_freio uuid;
  f jsonb; j jsonb; j2 jsonb; v_ans jsonb;
  e0 record; e1 record; a_freio record; a_avaria record;
  n bigint; n2 bigint; n3 bigint; n4 bigint; n5 bigint;
  ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean; msg text;
  r text := '';
  c_reason constant text := 'Motorista informou a resposta errada; conferido no patio pelo gestor.';
begin
  -- ---------------------------------------------------------------------------
  -- Fixture: tudo real, escolhido por permissão e por elegibilidade, nunca por id.
  -- ---------------------------------------------------------------------------
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  select v.id into v_v10 from public.checklist_app_versions v
   where v.app_id = v_app and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  select id into v_lmmg from public.operations where organization_id = v_org and lower(name) = 'last mille mg';
  select id into v_van_t from public.vehicle_types
   where code = 'van' and (organization_id = v_org or organization_id is null) and deleted_at is null limit 1;

  for e0 in select mm.user_id, mm.id from public.organization_memberships mm
             where mm.organization_id = v_org and mm.status = 'active' and mm.employee_id is not null
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', e0.user_id, 'role', 'authenticated')::text, true);
    if private.has_permission(v_org, 'applications.checklist_fleet.correct')
       and private.has_permission(v_org, 'applications.checklist_fleet.execute')
       and private.has_permission(v_org, 'applications.checklist_fleet.configure')
       and private.has_permission(v_org, 'operations.access_all') then
      v_admin := e0.user_id; v_mem := e0.id;
      exit;
    end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select v.id into v_van from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.vehicle_type_id = v_van_t
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_lmmg, current_date)
   order by v.fleet_code limit 1;

  if v_org is null or v_app is null or v_v10 is null or v_lmmg is null or v_admin is null or v_van is null then
    raise exception 'FIXTURE incompleta: org=% app=% v10=% lmmg=% admin=% van=%', v_org, v_app, v_v10, v_lmmg, v_admin, v_van;
  end if;

  -- A execução que será corrigida: envio oficial, tudo conforme.
  set local role authenticated;
  f := public.checklist_fleet_form(v_org, v_van, v_lmmg);
  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'answer', q ->> 'conforming_answer',
           'conditional_value', case when q -> 'conditional' ->> 'trigger_answer' = q ->> 'conforming_answer'
             then jsonb_build_object(q -> 'conditional' ->> 'field_key', 'Teste 16c.') else null end))
    into v_ans from jsonb_array_elements(f -> 'clusters') c, jsonb_array_elements(c -> 'questions') q;
  j := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', '16c-' || gen_random_uuid()::text, 'vehicle_id', v_van, 'operation_id', v_lmmg,
    'checklist_type', 'saida', 'operational_date', current_date,
    'started_at', now() - interval '2 minutes', 'version_id', f ->> 'version_id', 'answers', v_ans));
  v_exec := (j ->> 'execution_id')::uuid;
  reset role;

  select q.id into v_q_freio from public.checklist_questions q where q.version_id = (f ->> 'version_id')::uuid and q.question_key = 'luzes.freio';
  select q.id into v_q_avaria from public.checklist_questions q where q.version_id = (f ->> 'version_id')::uuid and q.question_key = 'funilaria.avaria';
  select q.id into v_q_limpeza from public.checklist_questions q where q.version_id = (f ->> 'version_id')::uuid and q.question_key = '5s.limpeza_externa';
  select id into v_a_freio from public.checklist_execution_answers where execution_id = v_exec and question_id = v_q_freio;
  select * into e0 from public.checklist_executions where id = v_exec;
  if v_exec is null or v_a_freio is null or v_q_avaria is null or e0.non_conforming_answers <> 0 then
    raise exception 'FIXTURE: envio de teste incompleto (exec=% freio=% avaria=% nc=%)', v_exec, v_a_freio, v_q_avaria, e0.non_conforming_answers;
  end if;

  -- ---------------------------------------------------------------------------
  -- C1 — permissão e padrão
  -- ---------------------------------------------------------------------------
  select count(*) into n from public.permissions where code = 'applications.checklist_fleet.correct';
  select count(distinct ro.code) into n2
    from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
    join public.roles ro on ro.id = rp.role_id
   where p.code = 'applications.checklist_fleet.correct' and ro.organization_id = v_org and ro.deleted_at is null
     and ro.code in ('administrador', 'gestor_frota');
  select count(*) into n3
    from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
    join public.roles ro on ro.id = rp.role_id
   where p.code = 'applications.checklist_fleet.correct'
     and ro.code in ('lideranca_operacoes', 'operacional', 'gestao', 'seguranca', 'gente');
  if n = 1 and n2 = 2 and n3 = 0 then
    r := r || 'PASS C1 permissao no catalogo; padrao em administrador e gestor_frota, fora de lideranca/operacional/gestao/seguranca' || chr(10);
  else r := r || format('FAIL C1 catalogo=%s padrao=%s fora_do_padrao=%s', n, n2, n3) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C2 — sem motivo
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  ok := false; ok2 := false;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', '',
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'no',
                 'conditional_value', jsonb_build_object('lado_falha', 'esquerdo')))));
  exception when others then ok := sqlerrm like '%motivo%';
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', 'curto',
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'no',
                 'conditional_value', jsonb_build_object('lado_falha', 'esquerdo')))));
  exception when others then ok2 := sqlerrm like '%motivo%';
  end;
  reset role;
  select count(*) into n from public.checklist_execution_corrections where execution_id = v_exec;
  select count(*) into n2 from public.checklist_execution_answers where id = v_a_freio and answer = 'yes';
  if ok and ok2 and n = 0 and n2 = 1 then
    r := r || 'PASS C2 sem motivo e com motivo curto: recusados, nada gravado' || chr(10);
  else r := r || format('FAIL C2 vazio=%s curto=%s correcoes=%s resposta_intacta=%s', ok, ok2, n, n2) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C3 — prévia exata e recusas do condicional
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.correct_checklist_execution(v_org, jsonb_build_object(
    'execution_id', v_exec, 'reason', c_reason, 'dry_run', true,
    'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'no',
               'conditional_value', jsonb_build_object('lado_falha', 'esquerdo')))));
  ok := false; ok2 := false;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason,
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'no'))));
  exception when others then ok := sqlerrm like 'Preencha%';
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason,
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'no',
                 'conditional_value', jsonb_build_object('lado_falha', 'meio')))));
  exception when others then ok2 := sqlerrm like '%inv_lida%';
  end;
  reset role;
  select count(*) into n from public.checklist_execution_corrections where execution_id = v_exec;
  select count(*) into n2 from public.checklist_execution_answers where id = v_a_freio and answer = 'yes' and is_conforming;
  if (j ->> 'dry_run')::boolean and (j -> 'summary_before' ->> 'non_conforming')::int = 0
     and (j -> 'summary_after' ->> 'non_conforming')::int = 1
     and (j -> 'summary_after' ->> 'critical_non_conforming')::int = 1
     and j -> 'items' -> 0 -> 'before' ->> 'answer' = 'yes'
     and j -> 'items' -> 0 -> 'after' -> 'conditional_value' ->> 'lado_falha' = 'esquerdo'
     and n = 0 and n2 = 1 and ok and ok2 then
    r := r || 'PASS C3 previa: nao conformes 0->1, criticas 0->1, nada gravado; condicional obrigatorio e opcao invalida recusados' || chr(10);
  else r := r || format('FAIL C3 previa=%s correcoes=%s intacta=%s obrigatorio=%s opcao=%s', j, n, n2, ok, ok2) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C4 — correção válida
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.correct_checklist_execution(v_org, jsonb_build_object(
    'execution_id', v_exec, 'reason', c_reason,
    'items', jsonb_build_array(
      jsonb_build_object('question_id', v_q_freio, 'answer', 'no',
                         'conditional_value', jsonb_build_object('lado_falha', 'esquerdo')),
      jsonb_build_object('question_id', v_q_avaria, 'answer', 'yes',
                         'conditional_value', jsonb_build_object('descricao_avaria', '  Risco na porta traseira  '),
                         'note', 'Visto no patio.'))));
  v_corr1 := (j ->> 'correction_id')::uuid;
  reset role;

  select * into e1 from public.checklist_executions where id = v_exec;
  select * into a_freio from public.checklist_execution_answers where id = v_a_freio;
  select * into a_avaria from public.checklist_execution_answers where execution_id = v_exec and question_id = v_q_avaria;
  select count(*) into n from public.checklist_execution_correction_items i
   where i.correction_id = v_corr1 and i.answer_id = v_a_freio
     and i.answer_before = 'yes' and i.answer_after = 'no'
     and i.is_conforming_before and not i.is_conforming_after
     and i.conditional_value_before is null and i.conditional_value_after = '{"lado_falha": "esquerdo"}'::jsonb
     and i.changed_fields @> array['answer', 'conditional_value'];
  select count(*) into n2 from public.checklist_execution_correction_items i
   where i.correction_id = v_corr1 and i.question_id = v_q_avaria
     and i.answer_before = 'no' and i.answer_after = 'yes' and i.is_conforming_before and not i.is_conforming_after
     and i.conditional_value_after = '{"descricao_avaria": "Risco na porta traseira"}'::jsonb
     and i.note_before is null and i.note_after = 'Visto no patio.';
  select count(*) into n3 from public.checklist_execution_corrections c
   where c.id = v_corr1 and c.execution_id = v_exec and c.sequence = 1 and c.reason = c_reason
     and c.corrected_by = v_admin and c.items_count = 2
     and (c.summary_before ->> 'non_conforming')::int = 0 and (c.summary_after ->> 'non_conforming')::int = 2;
  select count(*) filter (where ec.non_conforming = 1) into n4 from public.checklist_execution_clusters ec
   where ec.execution_id = v_exec and ec.cluster_key in ('luzes', 'funilaria');
  if n = 1 and n2 = 1 and n3 = 1 and n4 = 2
     and a_freio.answer = 'no' and not a_freio.is_conforming and a_freio.conditional_value = '{"lado_falha": "esquerdo"}'::jsonb
     and a_avaria.answer = 'yes' and not a_avaria.is_conforming and a_avaria.note = 'Visto no patio.'
     and e1.non_conforming_answers = 2 and e1.conforming_answers = e0.conforming_answers - 2
     and e1.critical_non_conforming = e0.critical_non_conforming + 1
     and e1.vehicle_id = e0.vehicle_id and e1.operational_date = e0.operational_date
     and e1.checklist_type = e0.checklist_type and e1.operation_id = e0.operation_id
     and e1.operation_br_id is not distinct from e0.operation_br_id and e1.employee_id = e0.employee_id
     and e1.version_id = e0.version_id and e1.status = 'submitted' and e1.submitted_at = e0.submitted_at then
    r := r || format('PASS C4 correcao: 2 itens com antes/depois, invertida inconforme, resumo 0->%s (criticas %s->%s), clusters recalculados, identidade intacta',
                     e1.non_conforming_answers, e0.critical_non_conforming, e1.critical_non_conforming) || chr(10);
  else r := r || format('FAIL C4 item_freio=%s item_avaria=%s cabecalho=%s clusters=%s resumo=%s/%s/%s', n, n2, n3, n4,
                        e1.conforming_answers, e1.non_conforming_answers, e1.critical_non_conforming) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C5 — auditoria com o ator real
  -- ---------------------------------------------------------------------------
  select count(*) into n from public.audit_logs l
   where l.entity_type = 'public.checklist_execution_corrections' and l.entity_id = v_corr1::text
     and l.action = 'INSERT' and l.user_id = v_admin and l.new_data ->> 'reason' = c_reason;
  select count(*) into n2 from public.audit_logs l
   where l.entity_type = 'public.checklist_execution_correction_items' and l.action = 'INSERT'
     and l.user_id = v_admin and l.new_data ->> 'correction_id' = v_corr1::text;
  select count(*) into n3 from public.audit_logs l
   where l.entity_type = 'public.checklist_executions' and l.entity_id = v_exec::text and l.action = 'UPDATE'
     and l.user_id = v_admin and 'non_conforming_answers' = any (l.changed_fields)
     and (l.old_data ->> 'non_conforming_answers')::int = 0 and (l.new_data ->> 'non_conforming_answers')::int = 2;
  if n = 1 and n2 = 2 and n3 = 1 then
    r := r || format('PASS C5 auditoria com o ator real: cabecalho %s, itens %s, execucao %s (non_conforming_answers)', n, n2, n3) || chr(10);
  else r := r || format('FAIL C5 cabecalho=%s itens=%s execucao=%s', n, n2, n3) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C6 — a identidade não se corrige
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  n := 0;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason, 'vehicle_id', gen_random_uuid(),
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'x'))));
  exception when others then if sqlerrm like '%recebido: vehicle_id%' then n := n + 1; end if;
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason, 'operational_date', current_date - 1,
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'x'))));
  exception when others then if sqlerrm like '%recebido: operational_date%' then n := n + 1; end if;
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason, 'checklist_type', 'retorno',
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'x'))));
  exception when others then if sqlerrm like '%recebido: checklist_type%' then n := n + 1; end if;
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason, 'operation_br_id', gen_random_uuid(),
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'x'))));
  exception when others then if sqlerrm like '%recebido: operation_br_id%' then n := n + 1; end if;
  end;
  begin
    perform public.correct_checklist_execution(v_org, jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason,
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'x',
                                                    'question_text', 'outra pergunta'))));
  exception when others then if sqlerrm like '%recebido: question_text%' then n := n + 1; end if;
  end;
  reset role;

  -- Com o portão aberto (o que só a rotina faz), o gatilho ainda sela a identidade.
  perform set_config('hfm.checklist_correction', 'on', true);
  n2 := 0;
  begin
    update public.checklist_executions set operational_date = operational_date - 1 where id = v_exec;
  exception when others then if sqlerrm like '%identidade%' then n2 := n2 + 1; end if;
  end;
  begin
    update public.checklist_executions set checklist_type = 'retorno' where id = v_exec;
  exception when others then if sqlerrm like '%identidade%' then n2 := n2 + 1; end if;
  end;
  begin
    update public.checklist_executions
       set vehicle_id = (select v.id from public.vehicles v
                          where v.organization_id = v_org and v.id <> v_van and v.deleted_at is null limit 1)
     where id = v_exec;
  exception when others then if sqlerrm like '%identidade%' then n2 := n2 + 1; end if;
  end;
  begin
    update public.checklist_execution_answers set question_id = v_q_limpeza where id = v_a_freio;
  exception when others then if sqlerrm like '%pergunta respondida%' then n2 := n2 + 1; end if;
  end;
  begin
    delete from public.checklist_execution_answers where id = v_a_freio;
  exception when others then if sqlerrm like '%exclu%' then n2 := n2 + 1; end if;
  end;
  perform set_config('hfm.checklist_correction', '', true);
  select * into e1 from public.checklist_executions where id = v_exec;
  if n = 5 and n2 = 5 and e1.operational_date = e0.operational_date and e1.checklist_type = e0.checklist_type then
    r := r || 'PASS C6 identidade: vehicle_id, operational_date, checklist_type, operation_br_id e chave extra no item recusados; gatilho recusa data/tipo/veiculo/pergunta/exclusao mesmo com o portao' || chr(10);
  else r := r || format('FAIL C6 rotina=%s/5 gatilho=%s/5', n, n2) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C7 — o registro de correção é imutável (inclusive para o dono)
  -- ---------------------------------------------------------------------------
  ok := false; ok2 := false;
  begin
    update public.checklist_execution_corrections set reason = 'adulterado para o teste' where id = v_corr1;
  exception when others then ok := sqlerrm like '%imut%vel%';
  end;
  begin
    delete from public.checklist_execution_correction_items where correction_id = v_corr1;
  exception when others then ok2 := sqlerrm like '%imut%vel%';
  end;
  if ok and ok2 then
    r := r || 'PASS C7 registro de correcao imutavel (UPDATE e DELETE recusados ao dono da tabela)' || chr(10);
  else r := r || format('FAIL C7 update=%s delete=%s', ok, ok2) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C8 — escrita direta
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  update public.checklist_executions set non_conforming_answers = 0, conforming_answers = 0 where id = v_exec;
  get diagnostics n = row_count;
  update public.checklist_execution_answers set answer = 'yes', is_conforming = true where id = v_a_freio;
  get diagnostics n2 = row_count;
  delete from public.checklist_executions where id = v_exec;
  get diagnostics n3 = row_count;
  ok := false;
  begin
    insert into public.checklist_execution_corrections
      (organization_id, execution_id, sequence, reason, corrected_by, items_count, summary_before, summary_after)
    values (v_org, v_exec, 99, 'inserido direto pelo cliente', v_admin, 1, '{}', '{}');
  exception when others then ok := sqlstate = '42501';
  end;
  reset role;
  ok2 := false;
  begin
    update public.checklist_executions set non_conforming_answers = 0 where id = v_exec;
  exception when others then ok2 := sqlerrm like '%procedimento de corre%';
  end;
  select * into e1 from public.checklist_executions where id = v_exec;
  if n = 0 and n2 = 0 and n3 = 0 and ok and ok2 and e1.non_conforming_answers = 2
     and (select answer from public.checklist_execution_answers where id = v_a_freio) = 'no' then
    r := r || 'PASS C8 escrita direta: UPDATE/DELETE do usuario afetam 0 linhas, INSERT negado (42501); sem portao o dono nao altera o resumo' || chr(10);
  else r := r || format('FAIL C8 upd_exec=%s upd_resp=%s del=%s insert_negado=%s gatilho=%s', n, n2, n3, ok, ok2) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C9 — segunda correção e o detalhe
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.correct_checklist_execution(v_org, jsonb_build_object(
    'execution_id', v_exec, 'reason', 'Lampada trocada antes da saida; a falha nao existia na hora do checklist.',
    'items', jsonb_build_array(jsonb_build_object('question_id', v_q_freio, 'answer', 'yes'))));
  v_corr2 := (j ->> 'correction_id')::uuid;
  j2 := public.checklist_execution_detail(v_exec);
  reset role;
  select count(*) into n from public.checklist_execution_correction_items i
   where i.correction_id = v_corr2 and i.answer_before = 'no' and i.answer_after = 'yes'
     and i.conditional_value_before = '{"lado_falha": "esquerdo"}'::jsonb and i.conditional_value_after is null
     and i.changed_fields @> array['answer', 'conditional_value'];
  -- O histórico da primeira continua dizendo o que ela fez.
  select count(*) into n2 from public.checklist_execution_correction_items i
   where i.correction_id = v_corr1 and i.answer_id = v_a_freio and i.answer_after = 'no';
  select count(*) into n3
    from jsonb_array_elements(j2 -> 'clusters') c, jsonb_array_elements(c -> 'answers') a
   where (a ->> 'corrected')::boolean;
  select * into e1 from public.checklist_executions where id = v_exec;
  if (j ->> 'sequence')::int = 2 and n = 1 and n2 = 1 and n3 = 2
     and (j -> 'summary_before' ->> 'non_conforming')::int = 2 and (j -> 'summary_after' ->> 'non_conforming')::int = 1
     and e1.non_conforming_answers = 1 and e1.critical_non_conforming = e0.critical_non_conforming
     and (j2 ->> 'correction_count')::int = 2 and (j2 -> 'corrections' -> 0 ->> 'sequence')::int = 2
     and j2 -> 'corrections' -> 1 ->> 'reason' = c_reason
     and j2 -> 'corrections' -> 0 ->> 'corrected_by_name' is not null
     and (select conditional_value from public.checklist_execution_answers where id = v_a_freio) is null then
    r := r || 'PASS C9 segunda correcao: sequencia 2, antes = depois da 1a, condicional descartado, resumo 2->1, historico com 2 correcoes, 2 respostas marcadas' || chr(10);
  else r := r || format('FAIL C9 seq=%s item2=%s item1=%s marcadas=%s detalhe=%s', j ->> 'sequence', n, n2, n3, j2 ->> 'correction_count') || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C10 — sem a permissão (rebaixamento desfeito ao fim do sub-bloco)
  -- ---------------------------------------------------------------------------
  ok := false; ok2 := false; ok3 := false;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_admin and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = v_mem
       and p.code = 'applications.checklist_fleet.correct';
    perform set_config('hfm.access_change', '', true);
    if private.has_permission(v_org, 'applications.checklist_fleet.correct') then
      raise exception 'rebaixamento nao surtiu efeito' using errcode = 'HF002';
    end if;
    set local role authenticated;
    begin
      perform public.correct_checklist_execution(v_org, jsonb_build_object(
        'execution_id', v_exec, 'reason', c_reason,
        'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'sem permissao'))));
    exception when others then ok := sqlstate = '42501';
    end;
    begin
      perform public.checklist_execution_correction_form(v_org, v_exec);
    exception when others then ok2 := sqlstate = '42501';
    end;
    -- Continua vendo o detalhe (é o próprio checklist), só não corrige.
    ok3 := (public.checklist_execution_detail(v_exec) ->> 'id')::uuid = v_exec;
    reset role;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  reset role;
  if ok and ok2 and ok3 and private.has_permission(v_org, 'applications.checklist_fleet.correct') then
    r := r || 'PASS C10 sem a permissao: correcao e formulario recusados (42501); administrador restaurado' || chr(10);
  elsif not private.has_permission(v_org, 'applications.checklist_fleet.correct') then
    raise exception 'C10 nao restaurou o administrador';
  else r := r || format('FAIL C10 correcao=%s formulario=%s detalhe=%s', ok, ok2, ok3) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C11 — outra organização
  -- ---------------------------------------------------------------------------
  ok := false; ok2 := false; ok3 := false; msg := null;
  begin
    insert into public.organizations (name, slug) values ('Organizacao de teste 16c', '16c-' || substr(md5(random()::text), 1, 10))
    returning id into v_org_b;
  exception when others then msg := sqlerrm;
  end;
  set local role authenticated;
  if v_org_b is not null then
    begin
      perform public.correct_checklist_execution(v_org_b, jsonb_build_object(
        'execution_id', v_exec, 'reason', c_reason,
        'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'outra org'))));
    exception when others then ok := sqlerrm like '%encontrada nesta organiza%';
    end;
    begin
      perform public.checklist_execution_correction_form(v_org_b, v_exec);
    exception when others then ok2 := sqlerrm like '%encontrada nesta organiza%';
    end;
  end if;
  begin
    perform public.correct_checklist_execution(gen_random_uuid(), jsonb_build_object(
      'execution_id', v_exec, 'reason', c_reason,
      'items', jsonb_build_array(jsonb_build_object('question_id', v_q_limpeza, 'note', 'outra org'))));
  exception when others then ok3 := sqlstate = '42501';
  end;
  reset role;
  select count(*) into n from public.checklist_execution_corrections where execution_id = v_exec;
  if ok and ok2 and ok3 and n = 2 then
    r := r || 'PASS C11 outra organizacao: execucao nao encontrada na organizacao B; organizacao inexistente recusada (42501)' || chr(10);
  else r := r || format('FAIL C11 org_b=%s (%s) correcao=%s formulario=%s inexistente=%s correcoes=%s', v_org_b, msg, ok, ok2, ok3, n) || chr(10); end if;

  -- ---------------------------------------------------------------------------
  -- C12 — validação da publicação respeita a vigência do vínculo
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.validate_checklist_version(v_org, v_v10);
  n := (j -> 'summary' ->> 'operations_enabled')::int;
  reset role;
  select count(*) into n5 from public.checklist_app_operations ao join public.operations o on o.id = ao.operation_id
   where ao.app_id = v_app and ao.is_enabled and o.deleted_at is null and o.status = 'active';
  -- Vencido ontem, ainda is_enabled.
  update public.checklist_app_operations set effective_from = null, effective_to = current_date - 1
   where app_id = v_app and operation_id = v_lmmg;
  set local role authenticated;
  n2 := (public.validate_checklist_version(v_org, v_v10) -> 'summary' ->> 'operations_enabled')::int;
  reset role;
  -- Só a partir de amanhã.
  update public.checklist_app_operations set effective_from = current_date + 1, effective_to = null
   where app_id = v_app and is_enabled and operation_id <> v_lmmg
     and operation_id = (select ao.operation_id from public.checklist_app_operations ao
                          where ao.app_id = v_app and ao.is_enabled and ao.operation_id <> v_lmmg
                          order by ao.operation_id limit 1);
  set local role authenticated;
  n3 := (public.validate_checklist_version(v_org, v_v10) -> 'summary' ->> 'operations_enabled')::int;
  reset role;
  -- Todos vencidos.
  update public.checklist_app_operations set effective_from = null, effective_to = current_date - 1
   where app_id = v_app and is_enabled;
  set local role authenticated;
  j2 := public.validate_checklist_version(v_org, v_v10);
  reset role;
  select count(*) into n4 from jsonb_array_elements(j2 -> 'errors') x where x ->> 'code' = 'sem_operacoes';
  select count(*) into n5 from public.checklist_app_operations where app_id = v_app and is_enabled;
  if n > 0 and n2 = n - 1 and n3 = n - 2 and n4 = 1 and not (j2 ->> 'ok')::boolean
     and (j2 -> 'summary' ->> 'operations_enabled')::int = 0 and n5 = n then
    r := r || format('PASS C12 vigencia: %s vigentes -> vencido ontem %s -> futuro %s -> todos vencidos sem_operacoes (is_enabled continua true)', n, n2, n3) || chr(10);
  else r := r || format('FAIL C12 vigentes=%s vencido=%s futuro=%s sem_operacoes=%s ok=%s habilitados=%s', n, n2, n3, n4, j2 ->> 'ok', n5) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
