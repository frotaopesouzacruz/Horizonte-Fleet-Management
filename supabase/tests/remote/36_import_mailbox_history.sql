-- =============================================================================
-- 36 · Importação: caixa de entrada por API, status diário do HFC e pergunta
--      sem resposta no histórico de Check List
--
-- Suíte transacional: cria, DENTRO da transação, uma caixa, partes, um
-- colaborador e uma importação de histórico de teste, e termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, então nada sobrevive.
-- Seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/36_import_mailbox_history.sql
--   → a última linha deve ser "ROLLBACK_TESTES 36 OK (<n> verificações)".
--
-- O que protege:
--   M1  os rótulos do Status Diário do HFC ("Fez Check List Retorno",
--       "Herdado da Saída — <motivo>") viram o código equivalente
--   M2  a caixa: abrir exige sessão e uma permissão "*.import"; o token tem
--       64 hex; `put` sem sessão (anon) grava, substitui a mesma sequência,
--       recusa sequência acima do máximo, token errado e parte grande; anon
--       não lê a caixa; fechar lista partes faltantes e bloqueia novos envios;
--       `purge` esvazia o conteúdo e marca a caixa
--   M3  uma linha "Fez Check List" com só 3 perguntas respondidas vira
--       execução com 3 respostas (as demais ficam sem resposta) — a falha de
--       "null value in column answer" não volta
-- =============================================================================
do $t$
declare
  org      uuid;
  adm      uuid;
  n        int := 0;
  ok       boolean;
  j        jsonb;
  r        jsonb;
  v_up     uuid;
  v_token  text;
  v_batch  uuid;
  v_app    uuid;
  v_ver    uuid;
  v_veh    uuid;
  v_plate  text;
  v_exec   uuid;
  v_date   date := '2025-12-15';
begin
  select m.organization_id, m.user_id into org, adm
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.status = 'active' and ro.code = 'administrador'
   order by m.created_at limit 1;
  if org is null then raise exception 'sem Administrador ativo para testar'; end if;

  -- ============================================================= M1 status do HFC
  assert private.checklist_history_status_code('Fez Check List Retorno') = 'FEZ'; n := n + 1;
  assert private.checklist_history_status_code('Fez Check List Retorno · fora da elegibilidade') = 'FEZ'; n := n + 1;
  assert private.checklist_history_status_code('Herdado da Saída — Sem Rota') = 'SEM_ROTA'; n := n + 1;
  assert private.checklist_history_status_code('Herdado da Saída — Manutenção') = 'MANUTENCAO'; n := n + 1;
  assert private.checklist_history_status_code('Herdado da Saída — Em Viagem') = 'EM_VIAGEM'; n := n + 1;
  assert private.checklist_history_status_code('Herdado da Saída — Frota Reserva') = 'RESERVA'; n := n + 1;
  assert private.checklist_history_status_code('Fez Check List') = 'FEZ' and private.checklist_history_status_code('Não Fez Check List') = 'NAO_FEZ'; n := n + 1;
  assert private.checklist_history_status_code('qualquer coisa') is null; n := n + 1;

  -- ============================================================= M2 caixa de entrada
  ok := false;
  begin perform public.import_mailbox_open(org, 'Teste 36', 'adherence.import'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'abrir sem sessão deve ser recusado'; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin perform public.import_mailbox_open(org, 'Teste 36', 'adherence.view'); exception when invalid_parameter_value then ok := true; end;
  assert ok, 'só permissão de importação abre caixa'; n := n + 1;
  j := public.import_mailbox_open(org, 'Teste 36', 'adherence.import', 3, 4096, 10);
  v_up := (j ->> 'upload_id')::uuid; v_token := j ->> 'token';
  assert v_token ~ '^[0-9a-f]{64}$' and (j ->> 'expires_at')::timestamptz > now(), j::text; n := n + 1;
  execute 'reset role';
  assert (select u.token_hash = extensions.digest(v_token, 'sha256') and u.created_by = adm from private.import_mailbox_uploads u where u.id = v_up),
         'só o hash do token fica gravado'; n := n + 1;

  -- partes sem sessão (anon): o token é a credencial
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  j := public.import_mailbox_put(v_token, 1, '[{"a":1}]'::jsonb);
  assert (j ->> 'received_chunks')::int = 1 and (j ->> 'upload_id')::uuid = v_up, j::text; n := n + 1;
  j := public.import_mailbox_put(v_token, 2, '[{"a":2}]'::jsonb);
  assert (j ->> 'received_chunks')::int = 2, j::text; n := n + 1;
  j := public.import_mailbox_put(v_token, 2, '[{"a":22}]'::jsonb);
  assert (j ->> 'received_chunks')::int = 2, 'reenviar a mesma sequência substitui, não duplica'; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_put(v_token, 4, '[]'::jsonb); exception when invalid_parameter_value then ok := true; end;
  assert ok, 'sequência acima do máximo'; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_put(repeat('0', 64), 1, '[]'::jsonb); exception when invalid_authorization_specification then ok := true; end;
  assert ok, 'token errado'; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_put('abc', 1, '[]'::jsonb); exception when invalid_authorization_specification then ok := true; end;
  assert ok, 'token fora do formato'; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_put(v_token, 3, ('["' || repeat('x', 5000) || '"]')::jsonb); exception when invalid_parameter_value then ok := true; end;
  assert ok, 'parte maior que o permitido'; n := n + 1;
  ok := false;
  begin perform 1 from private.import_mailbox_chunks; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não lê a caixa'; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_close(v_up); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não fecha a caixa'; n := n + 1;
  execute 'reset role';

  -- fechar (quem abriu): partes 1 e 2, nada faltando; depois nenhuma parte entra
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.import_mailbox_close(v_up);
  assert (j ->> 'received_chunks')::int = 2 and j -> 'missing' = '[]'::jsonb and (j ->> 'closed_at') is not null, j::text; n := n + 1;
  ok := false;
  begin perform public.import_mailbox_put(v_token, 1, '[]'::jsonb); exception when invalid_authorization_specification then ok := true; end;
  assert ok, 'caixa fechada não recebe'; n := n + 1;
  execute 'reset role';
  assert (select c.payload from private.import_mailbox_chunks c where c.upload_id = v_up and c.seq = 2) = '[{"a":22}]'::jsonb; n := n + 1;
  assert private.import_mailbox_purge(v_up) = 2; n := n + 1;
  assert (select count(*) from private.import_mailbox_chunks c where c.upload_id = v_up and c.payload is not null) = 0
     and (select u.purged_at is not null from private.import_mailbox_uploads u where u.id = v_up), 'esvaziada e marcada'; n := n + 1;

  -- ============================================================= M3 pergunta sem resposta
  select a.id into v_app from public.operational_apps a
   where a.organization_id = org and a.code = 'checklist_frota' and a.deleted_at is null;
  select v.id into v_ver from public.checklist_app_versions v
   where v.app_id = v_app and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  -- um veículo ativo com operação conhecida (Fidelização ou alocação) e sem checklist nesta data
  select v.id, v.license_plate into v_veh, v_plate
    from public.vehicles v
   where v.organization_id = org and v.deleted_at is null and v.status = 'active'
     and exists (select 1 from public.vehicle_operation_assignments a where a.vehicle_id = v.id)
     and not exists (select 1 from public.checklist_executions e where e.vehicle_id = v.id and e.operational_date = v_date)
   order by v.license_plate limit 1;
  if v_ver is null or v_veh is null then
    raise notice 'M3 pulado: sem versão publicada ou sem veículo alocado para testar';
  else
    insert into public.employees (organization_id, employee_code, full_name) values (org, 'T36MOT', 'Teste 36 Motorista');
    r := jsonb_build_object(
      'row_number', 1, 'raw', '{}'::jsonb, 'license_plate', v_plate, 'fleet_code', null,
      'operational_date', v_date, 'context', 'saida', 'status', 'Fez Check List',
      'employee_code', 'T36MOT', 'employee_name', 'Teste 36 Motorista', 'justification', null,
      'answers', jsonb_build_object('pneus.dianteiros', 'yes', 'pneus.traseiros', 'no', 'luzes.farois', 'no'),
      'conditionals', jsonb_build_object('luzes.farois', jsonb_build_object('itens_falha', jsonb_build_array('farol_esquerdo'))),
      'notes', '{}'::jsonb);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    j := public.stage_checklist_history_import(org, jsonb_build_object(
           'phase', 'all', 'file_name', 'teste36.csv', 'file_hash', repeat('6', 64), 'file_size', 1,
           'apply_exclusions', false, 'version_id', v_ver, 'rows', jsonb_build_array(r)));
    v_batch := (j ->> 'batch_id')::uuid;
    assert (j ->> 'executions')::int = 1 and (j ->> 'error_rows')::int = 0 and (j ->> 'answers')::int = 3,
           'prévia: ' || (j - 'sample' - 'findings')::text; n := n + 1;
    loop
      j := public.process_checklist_history_import(org, v_batch, 100);
      exit when (j ->> 'done')::boolean;
    end loop;
    assert (j ->> 'executions_created')::int = 1 and (j ->> 'failed')::int = 0, 'processamento: ' || j::text; n := n + 1;
    execute 'reset role';
    select e.id into v_exec from public.checklist_executions e where e.import_batch_id = v_batch;
    assert (select e.status = 'submitted' and e.answered_questions = 3 and e.non_conforming_answers = 2 and e.source = 'import'
              from public.checklist_executions e where e.id = v_exec), 'execução com 3 respostas e 2 inconformidades'; n := n + 1;
    assert (select count(*) from public.checklist_execution_answers a where a.execution_id = v_exec) = 3,
           'só as perguntas respondidas são gravadas'; n := n + 1;
    assert (select a.conditional_value from public.checklist_execution_answers a where a.execution_id = v_exec and a.question_key = 'luzes.farois')
           = '{"itens_falha": ["farol_esquerdo"]}'::jsonb, 'condicional gravado'; n := n + 1;
    assert (select count(*) from public.outbox_events o where o.aggregate_id = v_exec and o.event_type = 'checklist.execution.submitted') = 1,
           'o mesmo evento do aplicativo'; n := n + 1;
  end if;

  raise exception 'ROLLBACK_TESTES 36 OK (% verificações)', n;
end
$t$;
