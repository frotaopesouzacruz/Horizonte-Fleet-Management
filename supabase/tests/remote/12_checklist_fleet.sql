-- =============================================================================
-- 12 · Check List de Frota — motor de aplicabilidade e envio
--
-- Suíte transacional contra o banco COM DADOS. Ela não cria veículo, operação
-- nem versão: usa os 95 veículos, as 8 operações e a versão 1.0 publicada que
-- existem de verdade.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: é assim que
-- devolve o resultado e desfaz tudo o que fez.
--
-- O que cada bloco protege:
--   A1–A3    aplicabilidade por VÍNCULO: Van, Caminhão e Frota Leve ADM veem
--            conjuntos diferentes de perguntas (§23, §24)
--   A5–A6    a orientação de Merchandising orienta sem restringir (§16)
--   A7       envio válido, com o contexto operacional resolvido no servidor
--   A8–A9    conformidade POR PERGUNTA: as 2 invertidas e as 32 positivas (§11)
--   A10      idempotência: a mesma chave não produz dois checklists (§52)
--   A11      evento de conciliação no outbox, pendente (§57)
--   A12–A13  validação no servidor: obrigatória faltando e condicional vazio
--   A14      tempo mínimo (§39)
--   A15      versão publicada é imutável (§43, CA18)
--   A16      NENHUMA coluna de anexo/foto/arquivo (§26, CA09) — por catálogo,
--            não por leitura humana do código
--
-- Refinamento da Etapa 12: A3 passou a esperar a RECUSA do formulário para a
-- Frota Leve ADM (tipo desabilitado para o aplicativo), A5 usa a prévia da
-- versão e A11 aceita o evento já processado pela Aderência.
-- Última execução: 15/15 PASS contra o projeto de desenvolvimento (22/09/2026).
-- As mensagens vão sem acento de propósito: voltam dentro de uma mensagem de
-- erro do PostgreSQL, que atravessa clientes de codificação incerta.
-- =============================================================================
do $t$
declare
  v_org   uuid;
  v_user  uuid; v_van uuid; v_truck uuid; v_car uuid; v_op uuid; v_merch uuid; v_redmg uuid; v_app uuid;
  f jsonb; v_res jsonb; v_ans jsonb; v_key text; v_exec uuid; v_qid uuid;
  n bigint; r text := '';
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  select id into v_op from public.operations where organization_id = v_org and code = 'OP-00004';
  select id into v_merch from public.operations where organization_id = v_org and code = 'OP-00005';
  select id into v_redmg from public.operations where organization_id = v_org and code = 'OP-00006';
  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  -- Refinamento: os veiculos de teste precisam ser ELEGIVEIS na operacao em
  -- que serao usados (operacao habilitada, tipo habilitado, fidelizados no dia).
  select v.id into v_van from public.vehicles v join public.vehicle_types t on t.id = v.vehicle_type_id
   where v.organization_id = v_org and v.deleted_at is null and t.code = 'van'
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_op, current_date)
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_merch, current_date) is false
   limit 1;
  select v.id into v_truck from public.vehicles v join public.vehicle_types t on t.id = v.vehicle_type_id
   where v.organization_id = v_org and v.deleted_at is null and t.code = 'truck'
     and private.app_vehicle_eligible(v_org, v_app, v.id, v_redmg, current_date)
   limit 1;
  -- Frota Leve ADM esta DESABILITADA para o aplicativo (Refinamento, §17):
  -- o carro existe e esta fidelizado, mas nao e elegivel.
  select v.id into v_car from public.vehicles v join public.vehicle_types t on t.id = v.vehicle_type_id
   where v.organization_id = v_org and v.deleted_at is null and t.code = 'car'
     and private.vehicle_in_operation(v_org, v.id, v_op, current_date)
   limit 1;

  if v_user is null or v_van is null or v_truck is null or v_car is null then
    raise exception 'FIXTURE incompleta: user=% van=% truck=% car=%', v_user, v_van, v_truck, v_car;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- A1: Van ve prateleiras e ARLA; nao ve plataforma nem mao amiga
  f := public.checklist_fleet_form(v_org, v_van, v_op);
  select count(*) into n from jsonb_array_elements(f->'clusters') c,
       jsonb_array_elements(c->'questions') q
   where q->>'question_key' in ('implementos.prateleiras','mecanica.nivel_arla');
  if n = 2 and not exists (select 1 from jsonb_array_elements(f->'clusters') c,
       jsonb_array_elements(c->'questions') q
       where q->>'question_key' in ('implementos.plataforma_hidraulica','implementos.controle_auxiliar')) then
    r := r || 'PASS A1 Van: prateleiras+ARLA presentes, plataforma/mao-amiga ausentes'||chr(10);
  else r := r || format('FAIL A1 n=%s', n)||chr(10); end if;

  -- A2: Caminhao ve plataforma, mao amiga e ARLA; nao ve prateleiras
  f := public.checklist_fleet_form(v_org, v_truck, v_redmg);
  select count(*) into n from jsonb_array_elements(f->'clusters') c,
       jsonb_array_elements(c->'questions') q
   where q->>'question_key' in ('implementos.plataforma_hidraulica','implementos.controle_auxiliar','mecanica.nivel_arla');
  if n = 3 and not exists (select 1 from jsonb_array_elements(f->'clusters') c,
       jsonb_array_elements(c->'questions') q where q->>'question_key' = 'implementos.prateleiras') then
    r := r || 'PASS A2 Caminhao: plataforma+mao-amiga+ARLA presentes, prateleiras ausente'||chr(10);
  else r := r || format('FAIL A2 n=%s', n)||chr(10); end if;

  -- A3 (Refinamento §17, §38): Frota Leve ADM esta desabilitada para o
  -- aplicativo; o formulario e recusado no servidor, mesmo pedido diretamente.
  n := 0;
  begin
    f := public.checklist_fleet_form(v_org, v_car, v_op);
  exception when others then
    n := case when sqlerrm like '%n%o est% dispon%vel%' then 1 else 0 end;
  end;
  if n = 1 then r := r || 'PASS A3 Frota Leve ADM: formulario recusado (tipo desabilitado para o app)'||chr(10);
  else r := r || format('FAIL A3 formulario abriu para Frota Leve ADM')||chr(10); end if;

  -- A5/A6: a orientacao de Merchandising orienta sem restringir
  -- A5 usa a PREVIA da versao (mesmo construtor do executor): a van de teste
  -- pertence a Last Mille MG, e o formulario real so abre na operacao do veiculo.
  select count(*) into n from jsonb_array_elements(
         public.checklist_version_preview(v_org,
           (select id from public.checklist_app_versions where app_id = v_app and status = 'published'),
           v_merch, (select vehicle_type_id from public.vehicles where id = v_van),
           (select vehicle_subcategory_id from public.vehicles where id = v_van))->'clusters') c,
       jsonb_array_elements(c->'questions') q
   where q->>'question_key' in ('implementos.camera_re','implementos.sirene_re')
     and q->>'guidance' is not null;
  if n = 2 then r := r || 'PASS A5 orientacao de Merchandising aparece nas 2 perguntas'||chr(10);
  else r := r || format('FAIL A5 n=%s', n)||chr(10); end if;

  select count(*) into n from jsonb_array_elements(
         public.checklist_fleet_form(v_org, v_van, v_op)->'clusters') c,
       jsonb_array_elements(c->'questions') q
   where q->>'question_key' in ('implementos.camera_re','implementos.sirene_re')
     and q->>'guidance' is not null;
  if n = 0 then r := r || 'PASS A6 fora de Merchandising nao ha orientacao, e a pergunta continua valendo'||chr(10);
  else r := r || format('FAIL A6 vazou orientacao n=%s', n)||chr(10); end if;

  -- Monta um envio completo: SIM em tudo, condicionais de gatilho SIM preenchidos.
  f := public.checklist_fleet_form(v_org, v_van, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.')
             else null end))
    into v_ans from jsonb_array_elements(f->'clusters') c, jsonb_array_elements(c->'questions') q;

  -- A7: envio valido
  v_key := 'teste-' || gen_random_uuid()::text;
  begin
    v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', v_key, 'vehicle_id', v_van, 'operation_id', v_op,
      'checklist_type', 'saida', 'operational_date', current_date,
      'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
    v_exec := (v_res->>'execution_id')::uuid;
    r := r || format('PASS A7 envio aceito: %s aplicaveis, %s conformes, %s inconformes, %s criticas%s',
      v_res->>'applicable', v_res->>'conforming', v_res->>'non_conforming',
      v_res->>'critical_non_conforming', chr(10));
  exception when others then r := r || 'FAIL A7 ' || sqlerrm || chr(10); end;

  -- A8/A9: conformidade POR PERGUNTA
  if v_exec is not null then
    select count(*) into n from public.checklist_execution_answers
     where execution_id = v_exec and question_key in ('funilaria.avaria','mecanica.problema_mecanico')
       and is_conforming = false;
    if n = 2 then r := r || 'PASS A8 as 2 perguntas invertidas: SIM = inconforme'||chr(10);
    else r := r || format('FAIL A8 invertidas inconformes=%s (esperado 2)', n)||chr(10); end if;

    select count(*) into n from public.checklist_execution_answers
     where execution_id = v_exec and question_key not in ('funilaria.avaria','mecanica.problema_mecanico')
       and is_conforming = false;
    if n = 0 then r := r || 'PASS A9 nenhuma pergunta positiva classificada como inconforme'||chr(10);
    else r := r || format('FAIL A9 positivas inconformes=%s', n)||chr(10); end if;
  end if;

  -- A10: idempotencia
  begin
    v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', v_key, 'vehicle_id', v_van, 'operation_id', v_op,
      'checklist_type', 'saida', 'operational_date', current_date,
      'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
    select count(*) into n from public.checklist_executions where idempotency_key = v_key;
    if (v_res->>'duplicate')::boolean and n = 1 then
      r := r || 'PASS A10 reenvio da mesma chave devolve o primeiro, sem criar segundo checklist'||chr(10);
    else r := r || format('FAIL A10 duplicate=%s execucoes=%s', v_res->>'duplicate', n)||chr(10); end if;
  exception when others then r := r || 'FAIL A10 ' || sqlerrm || chr(10); end;

  -- A11: evento no outbox
  select count(*) into n from public.outbox_events
   where aggregate_id = v_exec and event_type = 'checklist.execution.submitted' and status in ('pending', 'processed');
  -- Desde a Etapa 11 o consumidor do outbox concilia na mesma transacao: o evento nasce e e processado.
  if n = 1 then r := r || 'PASS A11 evento de conciliacao gravado no outbox'||chr(10);
  else r := r || format('FAIL A11 eventos=%s', n)||chr(10); end if;

  -- A12: pergunta obrigatoria faltando
  begin
    v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'teste-' || gen_random_uuid()::text, 'vehicle_id', v_van,
      'operation_id', v_op, 'checklist_type', 'saida', 'operational_date', current_date,
      'started_at', (now() - interval '120 seconds')::text,
      'answers', (select jsonb_agg(x) from (select jsonb_array_elements(v_ans) x limit 5) s)));
    r := r || 'FAIL A12 aceitou envio com perguntas faltando'||chr(10);
  exception when others then
    if sqlerrm like '%obrigat%rias sem resposta%' then
      r := r || 'PASS A12 envio incompleto e recusado no servidor'||chr(10);
    else r := r || 'FAIL A12 erro inesperado: ' || sqlerrm || chr(10); end if;
  end;

  -- A13: condicional obrigatorio nao preenchido
  select qq.id into v_qid from public.checklist_questions qq
    join public.checklist_app_versions vv on vv.id = qq.version_id
   where qq.question_key = 'luzes.freio' and vv.status = 'published' limit 1;
  begin
    v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'teste-' || gen_random_uuid()::text, 'vehicle_id', v_van,
      'operation_id', v_op, 'checklist_type', 'saida', 'operational_date', current_date,
      'started_at', (now() - interval '120 seconds')::text,
      'answers', (select jsonb_agg(case when x->>'question_id' = v_qid::text
                    then jsonb_build_object('question_id', x->>'question_id', 'answer', 'no')
                    else x end) from jsonb_array_elements(v_ans) x)));
    r := r || 'FAIL A13 aceitou NAO em luzes de freio sem informar o lado'||chr(10);
  exception when others then
    if sqlerrm like '%campo obrigat%rio%' then
      r := r || 'PASS A13 condicional obrigatorio e exigido quando acionado'||chr(10);
    else r := r || 'FAIL A13 erro inesperado: ' || sqlerrm || chr(10); end if;
  end;

  -- A14: tempo minimo
  begin
    v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
      'idempotency_key', 'teste-' || gen_random_uuid()::text, 'vehicle_id', v_van,
      'operation_id', v_op, 'checklist_type', 'saida', 'operational_date', current_date,
      'started_at', now()::text, 'answers', v_ans));
    r := r || 'FAIL A14 aceitou checklist instantaneo'||chr(10);
  exception when others then
    if sqlerrm like '%m%nimo configurado%' then
      r := r || 'PASS A14 tempo minimo validado no servidor'||chr(10);
    else r := r || 'FAIL A14 erro inesperado: ' || sqlerrm || chr(10); end if;
  end;

  -- A15: versao publicada e imutavel
  begin
    update public.checklist_questions set question_text = 'alterado'
     where question_key = 'pneus.estepe'
       and version_id = (select id from public.checklist_app_versions where status = 'published' limit 1);
    r := r || 'FAIL A15 alterou pergunta de versao publicada'||chr(10);
  exception when others then
    if sqlerrm like '%imut%vel%' then r := r || 'PASS A15 versao publicada recusa alteracao'||chr(10);
    else r := r || 'FAIL A15 erro inesperado: ' || sqlerrm || chr(10); end if;
  end;

  -- A16: nenhuma coluna de anexo em qualquer tabela do checklist
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name like 'checklist%'
     and (column_name ~* 'photo|foto|attach|anexo|file|arquivo|image|imagem|media|evidenc|storage|upload');
  if n = 0 then r := r || 'PASS A16 nenhuma coluna de anexo/foto/arquivo nas tabelas do checklist'||chr(10);
  else r := r || format('FAIL A16 encontrou %s colunas suspeitas', n)||chr(10); end if;

  raise exception 'ROLLBACK_TESTES %', chr(10) || r;
end $t$;
