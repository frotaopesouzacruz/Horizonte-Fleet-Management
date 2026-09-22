-- =============================================================================
-- 13b · Fidelização — importação validada, situação do vínculo e exportação
--       (continuação da Etapa 13: §56, §57, §58, CA23)
--
-- Suíte transacional contra o banco COM DADOS: usa as BRs, as vigências e os
-- veículos reais da organização. Não cria veículo, BR (fora do lote de teste,
-- desfeito no rollback) nem colaborador. Para ter um veículo livre no período,
-- encerra — pela rotina oficial, com motivo — a vigência de uma segunda BR da
-- mesma operação; tudo isso é desfeito no fim.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- O que cada bloco protege:
--   I1   §56  prévia de BRs: existente ignorada (situação divergente só
--             avisa), nova a criar, cidade fora da cobertura, código repetido
--             no arquivo, operação inexistente
--   I2   §56  gravação de BRs: cria a nova, atualiza descrição informada, não
--             muda a situação da existente
--   I3   §58  prévia de alocações com as sete categorias: existente, novo,
--             substituição, sobreposição, BR desconhecida, veículo não
--             encontrado, erro de competência
--   I4   §57  gravação: substituição atômica pela rotina oficial (anterior
--             encerrado na véspera, novo herda o fim), vínculos novos criados,
--             linhas com erro de fora
--   I5   §57  a importação não cria veículo nem BR; os vínculos novos entram
--             na auditoria
--   I6        situação do vínculo: confirmar; executar antes do início
--             recusado; cancelar sem motivo recusado; cancelar; cancelado é
--             terminal; executar vigente iniciado
--   I7        exportação auditada (fidelização e frotas — o CHECK de
--             audit_logs passou a aceitar EXPORT)
--   I8   §63  sem permissão: importar, mudar situação e exportar recusados
--   I9   §63  sem `change_vehicle`, a linha que substituiria vira erro e nada
--             é gravado por ela
--
-- I8 e I9 rebaixam o próprio ator dentro de um sub-bloco desfeito por exceção
-- proposital (mesma técnica das suítes 12b/12c/13): nada é inventado, nada
-- persiste. As mensagens vão sem acento de propósito.
--
-- Última execução: 9/9 PASS contra o projeto de desenvolvimento (22/09/2026).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid;
  v_a record; v_b record; v_van record; v_vanb record;
  j jsonb; j2 jsonb; v_batch uuid; v_new uuid;
  n bigint; n2 bigint; n3 bigint; n4 bigint; n5 bigint; ok boolean; ok2 boolean; ok3 boolean; ok4 boolean;
  n_veh bigint; n_brs bigint;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m where m.organization_id = v_org and m.status = 'active' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Fixture: BR A vigente (titular ativo) e BR B da mesma operacao/tipo, cujo veiculo sera liberado.
  select b.id, b.code, b.description, b.status as br_status, o.name as op_name, ci.name as city_name, s.uf::text as uf,
         a.vehicle_id, a.start_date, a.end_date, a.id as assignment_id, b.operation_id, v.vehicle_type_id
    into v_a
    from public.operation_brs b join public.operations o on o.id = b.operation_id
    join public.cities ci on ci.id = b.city_id join public.states s on s.id = b.state_id
    join public.fidelization_assignments a on a.operation_br_id = b.id and a.status <> 'cancelled' and a.vehicle_role = 'primary'
         and a.start_date <= current_date and a.end_date >= current_date
    join public.vehicles v on v.id = a.vehicle_id and v.status = 'active'
   where b.organization_id = v_org and b.deleted_at is null and b.status = 'active'
   order by a.start_date, b.code limit 1;
  select b.id, b.code, a.vehicle_id, a.id as assignment_id, a.start_date
    into v_b
    from public.operation_brs b
    join public.fidelization_assignments a on a.operation_br_id = b.id and a.status <> 'cancelled' and a.vehicle_role = 'primary'
         and a.start_date <= current_date - 2 and a.end_date >= current_date
    join public.vehicles v on v.id = a.vehicle_id and v.status = 'active' and v.vehicle_type_id = v_a.vehicle_type_id
   where b.organization_id = v_org and b.deleted_at is null and b.status = 'active' and b.operation_id = v_a.operation_id and b.id <> v_a.id
   order by b.code limit 1;
  if v_a.id is null or v_b.id is null then
    raise exception 'FIXTURE incompleta: A=% B=%', v_a.code, v_b.code;
  end if;
  select v.fleet_code, v.license_plate into v_van from public.vehicles v where v.id = v_a.vehicle_id;
  select v.fleet_code, v.license_plate, v.id into v_vanb from public.vehicles v where v.id = v_b.vehicle_id;
  perform public.end_fidelization_assignment(v_b.assignment_id, current_date - 1, 'Suite 13b: libera o veiculo');
  select count(*) into n_veh from public.vehicles where organization_id = v_org;
  select count(*) into n_brs from public.operation_brs where organization_id = v_org and deleted_at is null;

  -- I1: previa de BRs
  j := public.stage_br_import(v_org, jsonb_build_object('file_name', 'suite13b-brs.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'operation', v_a.op_name, 'state', v_a.uf, 'city', v_a.city_name, 'code', v_a.code, 'status', 'Inativo'),
    jsonb_build_object('row_number', 3, 'operation', v_a.op_name, 'city', v_a.city_name, 'code', 'SUITE13B-NOVA', 'description', 'Posicao de teste'),
    jsonb_build_object('row_number', 4, 'operation', v_a.op_name, 'city', 'Cidade Inexistente', 'code', 'SUITE13B-X'),
    jsonb_build_object('row_number', 5, 'operation', lower(v_a.op_name), 'city', v_a.city_name, 'code', 'suite13b-nova'),
    jsonb_build_object('row_number', 6, 'operation', 'Operacao Fantasma', 'city', v_a.city_name, 'code', 'SUITE13B-Y'))));
  v_batch := (j ->> 'batch_id')::uuid;
  select bool_and(x) into ok from (values
    (exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 2 and f->>'code' = 'existing' and f->>'level' = 'warning')),
    (exists (select 1 from jsonb_array_elements(j->'sample') s where (s->>'row_number')::int = 3 and s->>'action' = 'create' and s->>'status' = 'valid')),
    (exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 4 and f->>'code' = 'city' and f->>'level' = 'error')),
    (exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 5 and f->>'code' = 'duplicate')),
    (exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 6 and f->>'code' = 'operation')),
    (exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 2 and f->>'code' = 'status_divergence' and f->>'level' = 'warning'))
  ) v(x);
  r := r || format('I1  previa de BRs: total=%s create=%s update=%s skip=%s err=%s; classificacoes -> %s%s',
       j->>'total_rows', j->>'create_rows', j->>'update_rows', j->>'skip_rows', j->>'error_rows',
       case when ok and (j->>'create_rows')::int = 1 and (j->>'error_rows')::int = 3 then 'PASS' else 'FAIL' end, chr(10));

  -- I2: gravacao de BRs (o lote acima cria a nova; um segundo lote atualiza a descricao da existente)
  j2 := public.process_br_import(v_org, v_batch);
  select count(*) into n from public.operation_brs where organization_id = v_org and code = 'SUITE13B-NOVA' and deleted_at is null and status = 'active';
  j := public.stage_br_import(v_org, jsonb_build_object('file_name', 'suite13b-brs2.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'operation', v_a.op_name, 'city', v_a.city_name, 'code', v_a.code, 'description', 'Descricao vinda do arquivo', 'status', 'Inativo'))));
  j2 := public.process_br_import(v_org, (j ->> 'batch_id')::uuid);
  select description, status into v_van.fleet_code, v_van.license_plate from public.operation_brs where id = v_a.id; -- reaproveita campos texto do record
  r := r || format('I2  gravacao de BRs: nova criada=%s, descricao atualizada=%s, situacao intacta=%s -> %s%s',
       n, v_van.fleet_code = 'Descricao vinda do arquivo', v_van.license_plate = v_a.br_status,
       case when n = 1 and v_van.fleet_code = 'Descricao vinda do arquivo' and v_van.license_plate = v_a.br_status then 'PASS' else 'FAIL' end, chr(10));
  select v.fleet_code, v.license_plate into v_van from public.vehicles v where v.id = v_a.vehicle_id;

  -- I3: previa de alocacoes com as sete categorias
  j := public.stage_fidelization_import(v_org, jsonb_build_object('file_name', 'suite13b-aloc.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'br_code', v_a.code, 'fleet_code', v_van.fleet_code, 'start_date', v_a.start_date::text, 'end_date', v_a.end_date::text),
    jsonb_build_object('row_number', 3, 'br_code', v_a.code, 'operation', v_a.op_name, 'license_plate', v_vanb.license_plate, 'start_date', (current_date + 3)::text, 'reason', 'Troca planejada'),
    jsonb_build_object('row_number', 4, 'br_code', v_b.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-10-01', 'end_date', '2026-10-31'),
    jsonb_build_object('row_number', 5, 'br_code', v_a.code, 'fleet_code', v_van.fleet_code, 'start_date', '2026-10-01', 'end_date', '2026-10-31'),
    jsonb_build_object('row_number', 6, 'br_code', v_a.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-10-15', 'end_date', '2026-10-20'),
    jsonb_build_object('row_number', 7, 'br_code', 'SUITE13B-NAOEXISTE', 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-11-01'),
    jsonb_build_object('row_number', 8, 'br_code', v_a.code, 'fleet_code', 'FROTA-INEXISTENTE', 'start_date', '2026-11-01'),
    jsonb_build_object('row_number', 9, 'br_code', v_a.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-11-10', 'end_date', '2026-11-05'))));
  v_batch := (j ->> 'batch_id')::uuid;
  r := r || format('I3  previa de alocacoes: existentes=%s novos=%s substituicoes=%s sobreposicoes=%s BRs desconhecidas=%s veiculos nao encontrados=%s competencia=%s -> %s%s',
       j->'categories'->>'existing', j->'categories'->>'new', j->'categories'->>'substitutions', j->'categories'->>'overlaps',
       j->'categories'->>'unknown_brs', j->'categories'->>'vehicles_not_found', j->'categories'->>'competence_errors',
       case when (j->'categories'->>'existing')::int = 1 and (j->'categories'->>'new')::int = 2 and (j->'categories'->>'substitutions')::int = 1
             and (j->'categories'->>'overlaps')::int = 1 and (j->'categories'->>'unknown_brs')::int = 1
             and (j->'categories'->>'vehicles_not_found')::int = 1 and (j->'categories'->>'competence_errors')::int = 1
             and exists (select 1 from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 3 and f->>'code' = 'substitution' and f->>'message' like '%herda o fim%')
            then 'PASS' else 'FAIL' end, chr(10));

  -- I4: gravacao — substituicao atomica e vinculos novos
  j2 := public.process_fidelization_import(v_org, v_batch);
  select a.id into v_new from public.fidelization_assignments a where a.operation_br_id = v_a.id and a.vehicle_id = v_vanb.id and a.source = 'substitution';
  select count(*) into n from public.fidelization_assignments a where a.operation_br_id in (v_a.id, v_b.id) and a.start_date = '2026-10-01' and a.source = 'import';
  select count(*) into n2 from public.import_errors e where e.batch_id = v_batch and e.code = 'process';
  r := r || format('I4  gravacao: created=%s substituted=%s skipped=%s; anterior encerrado em %s (esperado %s); novo %s..%s planned=%s motivo ok=%s; outubro=%s; erros de processamento=%s -> %s%s',
       j2->>'created', j2->>'substituted', j2->>'skipped',
       (select end_date from public.fidelization_assignments where id = v_a.assignment_id), current_date + 2,
       (select start_date from public.fidelization_assignments where id = v_new), (select end_date from public.fidelization_assignments where id = v_new),
       (select status = 'planned' from public.fidelization_assignments where id = v_new),
       (select reason = 'Troca planejada' from public.fidelization_assignments where id = v_new), n, n2,
       case when (j2->>'created')::int = 2 and (j2->>'substituted')::int = 1 and v_new is not null
             and (select end_date from public.fidelization_assignments where id = v_a.assignment_id) = current_date + 2
             and (select start_date from public.fidelization_assignments where id = v_new) = current_date + 3
             and (select end_date from public.fidelization_assignments where id = v_new) = v_a.end_date
             and (select reason from public.fidelization_assignments where id = v_new) = 'Troca planejada'
             and n = 2 and n2 = 0
            then 'PASS' else 'FAIL' end, chr(10));

  -- I5: nada de veiculo ou BR novo pela importacao de alocacoes; auditoria dos vinculos
  select count(*) into n from public.vehicles where organization_id = v_org;
  select count(*) into n2 from public.operation_brs where organization_id = v_org and deleted_at is null;
  select count(*) into n3 from public.audit_logs l where l.organization_id = v_org and l.entity_type like '%fidelization_assignments' and l.created_at >= now() and l.action = 'INSERT';
  r := r || format('I5  veiculos antes/depois=%s/%s, BRs antes/depois=%s/%s (+1 da I2), auditoria de vinculos novos=%s -> %s%s',
       n_veh, n, n_brs, n2, n3, case when n = n_veh and n2 = n_brs + 1 and n3 >= 3 then 'PASS' else 'FAIL' end, chr(10));

  -- I6: situacao do vinculo
  j := public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_new, 'status', 'confirmed'));
  ok := (j->>'status') = 'confirmed';
  ok2 := false;
  begin
    perform public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_new, 'status', 'executed'));
  exception when others then ok2 := sqlerrm like '%s% pode ser marcado como executado depois de%';
  end;
  ok3 := false;
  begin
    perform public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_new, 'status', 'cancelled'));
  exception when others then ok3 := sqlerrm like '%motivo do cancelamento%';
  end;
  j := public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_new, 'status', 'cancelled', 'reason', 'Suite 13b'));
  ok4 := false;
  begin
    perform public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_new, 'status', 'confirmed'));
  exception when others then ok4 := sqlerrm like '%cancelado n%o muda mais%';
  end;
  j2 := public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_a.assignment_id, 'status', 'executed'));
  r := r || format('I6  confirmar=%s, executar futuro recusado=%s, cancelar sem motivo recusado=%s, cancelado=%s, terminal=%s, executar iniciado=%s -> %s%s',
       ok, ok2, ok3, (select status from public.fidelization_assignments where id = v_new) = 'cancelled', ok4, (j2->>'status') = 'executed',
       case when ok and ok2 and ok3 and ok4 and (select status from public.fidelization_assignments where id = v_new) = 'cancelled' and (j2->>'status') = 'executed' then 'PASS' else 'FAIL' end, chr(10));

  -- I7: exportacao auditada
  perform public.log_fidelization_export(v_org, 'xlsx', 88, 'planner');
  perform public.log_fidelization_export(v_org, 'csv', 12, 'historico');
  perform public.log_vehicle_export(v_org, 'xlsx', 95);
  select count(*) into n from public.audit_logs where organization_id = v_org and action = 'EXPORT' and created_at >= now();
  select count(*) into n2 from public.audit_logs where organization_id = v_org and entity_type = 'fidelization_export' and created_at >= now() and new_data->>'kind' = 'historico';
  r := r || format('I7  exportacoes auditadas=%s (2 fidelizacao + 1 frotas), historico registrado=%s -> %s%s', n, n2,
       case when n = 3 and n2 = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- I8: sem permissao (rebaixamento temporario, desfeito por excecao)
  n := 0; n2 := 0; n3 := 0; n4 := 0;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org
       and p.code in ('fidelization.import', 'fidelization.plan', 'fidelization.export');
    perform set_config('hfm.access_change', '', true);
    begin
      perform public.stage_fidelization_import(v_org, jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'br_code', v_a.code, 'fleet_code', v_van.fleet_code, 'start_date', '2026-12-01'))));
    exception when others then n := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.stage_br_import(v_org, jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'operation', v_a.op_name, 'city', v_a.city_name, 'code', 'SUITE13B-Z'))));
    exception when others then n2 := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.set_fidelization_assignment_status(v_org, jsonb_build_object('id', v_a.assignment_id, 'status', 'confirmed'));
    exception when others then n3 := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.log_fidelization_export(v_org, 'xlsx', 1, 'planner');
    exception when others then n4 := case when sqlstate = '42501' then 1 else 0 end; end;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  if not private.has_permission(v_org, 'fidelization.import') then raise exception 'I8 nao restaurou o administrador'; end if;
  r := r || format('I8  sem permissao: importar alocacoes=%s, importar BRs=%s, mudar situacao=%s, exportar=%s -> %s%s',
       n, n2, n3, n4, case when n = 1 and n2 = 1 and n3 = 1 and n4 = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- I9: sem change_vehicle, a substituicao vira erro de permissao e nada e gravado por ela
  n := 0; n2 := -1;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org
       and p.code = 'fidelization.change_vehicle';
    perform set_config('hfm.access_change', '', true);
    -- a BR B ficou livre desde hoje e recebeu a van B em outubro (I4); uma substituicao dela em novembro nao existe.
    -- Usa a BR A: a substituicao de I4 foi cancelada em I6, entao o titular vigente voltou a ser... nenhum apos o dia +2.
    -- Cria um cenario limpo: van A continua titular de A ate +2; uma linha a partir de +1 com a van B substituiria.
    j := public.stage_fidelization_import(v_org, jsonb_build_object('file_name', 'suite13b-perm.xlsx', 'rows', jsonb_build_array(
      jsonb_build_object('row_number', 2, 'br_code', v_a.code, 'fleet_code', v_vanb.fleet_code, 'start_date', (current_date + 1)::text, 'end_date', (current_date + 2)::text))));
    n := (select count(*) from jsonb_array_elements(j->'findings') f where (f->>'row_number')::int = 2 and f->>'code' = 'permission' and f->>'level' = 'error');
    n2 := (j->>'substitute_rows')::int;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  if not private.has_permission(v_org, 'fidelization.change_vehicle') then raise exception 'I9 nao restaurou o administrador'; end if;
  r := r || format('I9  sem change_vehicle: linha de substituicao com erro de permissao=%s, substituicoes previstas=%s -> %s%s',
       n, n2, case when n = 1 and n2 = 0 then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
