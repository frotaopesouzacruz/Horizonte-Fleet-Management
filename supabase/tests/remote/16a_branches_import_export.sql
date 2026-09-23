-- =============================================================================
-- 16a · Filiais — importação, exportação e centros de custo
--       (Etapa 09, continuação: §38, §58–§62, §65)
--
-- Suíte transacional contra o banco COM DADOS. Usa as filiais, operações,
-- colaboradores e veículos reais da organização; o que ela cria (uma segunda
-- organização com uma operação, dois centros de custo de teste, as filiais do
-- lote) existe só dentro da transação: o bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, e nada persiste.
--
-- O único membro real é personificado por `request.jwt.claims` + `set local
-- role authenticated`. Os rebaixamentos de permissão (B6, B8, B10) revogam o
-- administrador de plataforma e apagam `role_permissions` dentro de um
-- sub-bloco desfeito por exceção proposital (técnica das suítes 13b/15).
--
-- O que cada bloco protege:
--   B1   §59  a prévia classifica: nova válida, existente com diferença e aviso
--             de situação divergente, CNPJ inválido, operação inexistente,
--             operação de outra organização, código duplicado no arquivo,
--             estado/cidade incompatíveis, obrigatórios ausentes, nome de outra
--             filial, situação inválida, CNPJ de outra filial
--   B2   §59  a prévia NÃO grava: filiais, vínculos, colaboradores, veículos e
--             centros de custo idênticos antes e depois
--   B3   §60  a prévia mostra atual × recebido e os vínculos atuais que não
--             vieram no arquivo
--   B4   §58  gravar: a nova é criada com endereço, CNPJ e vínculo; auditoria
--             branch_import e eventos branch.imported / branch.operation_added
--   B5   §60  a existente: observações atualizadas, situação intacta, nenhum
--             vínculo encerrado ou reaberto, só o novo acrescentado;
--             colaboradores e veículos da filial intactos
--   B6   §62  nenhuma role, permission, membership ou escopo mudou
--   B7   §60  prévia desatualizada: a filial mudou depois da prévia e a linha
--             falha sem gravar nada
--   B8   §63  sem branches.import: validar e gravar recusados (42501); sem
--             plataforma, outra organização também recusada
--   B9   §61  exportação auditada (EXPORT + branch.exported); tipo inválido
--             recusado; sem branches.export recusada
--   B10  §38  centro de custo: associar, recusar o já associado a outra
--             filial, desassociar; outra organização recusada; sem
--             cost_centers.manage recusado; histórico da filial mostra o vínculo
--
-- Última execução: 23/09/2026 (projeto jgyvaltwqntpcjqounty), 10/10 PASS —
-- depois conferido que nada persistiu (0 lotes `branches`, 1 organização, 0
-- centros de custo, 2 filiais, 8 vínculos, 0 auditorias branch_import/export):
--   PASS B1 previa: total=14 criar=1 atualizar=1 erros=12; CNPJ invalido, operacao inexistente, operacao de outra organizacao, codigo duplicado (2 linhas), UF/cidade, obrigatorios, nome e CNPJ de outra filial, situacao invalida, cidade sem UF -> todos classificados
--   PASS B2 previa nao grava: filiais 2/2, vinculos 8/8, colaboradores 145/145, veiculos 87/87; lote validated (tipo branches)
--   PASS B3 diferencas: observacoes atual x recebido, 1 operacao a vincular (repetida por codigo e nome conta 1), situacao fora das mudancas, vinculos atuais fora do arquivo listados como mantidos
--   PASS B4 gravacao: criada=1 atualizada=1 vinculos=2 ignoradas=12; nova com CNPJ/CEP/UF/cidade/endereco e vinculo "Importacao"; auditoria branch_import=2 pelo usuario; eventos imported=2 operation_added=2
--   PASS B5 existente: observacoes atualizadas, situacao/nome/CNPJ intactos, 7 vinculos antigos com vigencia identica + 1 novo; colaboradores 138/138 e veiculos 85/85 da filial intactos
--   PASS B6 importacao nao altera acesso: role_permissions=370 membership_roles=1 memberships=1 escopos=0; filial de colaboradores (145) e veiculos (87) intacta
--   PASS B7 previa desatualizada: a filial mudou depois da previa, a linha falha e nada e gravado
--   PASS B8 sem branches.import: validar e gravar recusados (42501), nada criado; outra organizacao recusada
--   PASS B9 exportacao: 2 registros EXPORT (filtradas e modelo) pelo usuario, 2 eventos branch.exported, filtros gravados; formato e tipo invalidos recusados; sem branches.export recusada (42501)
--   PASS B10 centros de custo: dois associados a mesma filial, ja associado a outra recusado, desassociar de filial errada recusado, outra organizacao recusada, desassociado; 3 eventos e 3 linhas no historico da filial; sem cost_centers.manage recusado (42501)
--
-- A primeira execução deu FAIL em B7: a prévia desatualizada era detectada por
-- `updated_at`, que é now() — o instante da transação — e não distingue duas
-- escritas na mesma transação. Corrigido pelo retrato dos campos
-- (`private.branch_import_snapshot`, ledger `branches_import_snapshot_check`).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_org_b uuid; v_op_b uuid;
  v_a record; v_b record; v_op_free record; v_op_kept record;
  j jsonb; j2 jsonb; v_batch uuid; v_new uuid; v_cc1 uuid; v_cc2 uuid; v_cc_b uuid; v_audit uuid;
  n bigint; n2 bigint; n3 bigint; n4 bigint; ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; msg text;
  c_units bigint; c_links bigint; c_ea bigint; c_veh bigint; c_cc bigint;
  c_rp bigint; c_mr bigint; c_mem bigint; c_scope bigint;
  c_a_links bigint; c_a_ea bigint; c_a_veh bigint; v_a_links jsonb;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' order by m.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Fixture: filial A (com vínculo vigente) e filial B (outra, com CNPJ), reais.
  select u.id, u.code, u.name, u.status, u.notes, u.legal_name, u.document_number, u.updated_at
    into v_a
    from public.organization_units u
   where u.organization_id = v_org and u.deleted_at is null and u.code is not null
     and exists (select 1 from public.organization_unit_operations l where l.organization_unit_id = u.id and l.effective_to is null)
   order by (select count(*) from public.organization_unit_operations l where l.organization_unit_id = u.id) desc
   limit 1;
  select u.id, u.code, u.name, u.document_number into v_b
    from public.organization_units u
   where u.organization_id = v_org and u.deleted_at is null and u.id <> v_a.id and u.document_number is not null
   order by u.code limit 1;
  -- Uma operação ativa sem vínculo vigente com A, e uma com vínculo vigente.
  select o.id, o.code, o.name into v_op_free
    from public.operations o
   where o.organization_id = v_org and o.deleted_at is null and o.status = 'active'
     and not exists (select 1 from public.organization_unit_operations l
                      where l.organization_unit_id = v_a.id and l.operation_id = o.id
                        and (l.effective_to is null or l.effective_to >= current_date))
   order by o.code limit 1;
  select o.id, o.code, o.name into v_op_kept
    from public.operations o
    join public.organization_unit_operations l on l.operation_id = o.id and l.organization_unit_id = v_a.id and l.effective_to is null
   order by o.code limit 1;
  if v_a.id is null or v_b.id is null or v_op_free.id is null or v_op_kept.id is null then
    raise exception 'FIXTURE incompleta: A=% B=% livre=% vinculada=%', v_a.code, v_b.code, v_op_free.code, v_op_kept.code;
  end if;

  -- Segunda organização com uma operação (desfeitas no rollback).
  insert into public.organizations (name, slug) values ('Organizacao de teste 16a', '16a-' || substr(md5(random()::text), 1, 10))
  returning id into v_org_b;
  insert into public.operations (organization_id, name) values (v_org_b, 'Operacao da outra organizacao 16a')
  returning id into v_op_b;

  -- Contagens de referência (como postgres, sem RLS).
  select count(*) into c_units from public.organization_units where organization_id = v_org;
  select count(*) into c_links from public.organization_unit_operations where organization_id = v_org;
  select count(*) into c_ea from public.employee_assignments where organization_id = v_org and organization_unit_id is not null;
  select count(*) into c_veh from public.vehicles where organization_id = v_org and organization_unit_id is not null;
  select count(*) into c_cc from public.cost_centers where organization_id = v_org;
  select count(*) into c_rp from public.role_permissions;
  select count(*) into c_mr from public.membership_roles;
  select count(*) into c_mem from public.organization_memberships;
  select count(*) into c_scope from public.membership_operation_scopes;
  select count(*) into c_a_links from public.organization_unit_operations where organization_unit_id = v_a.id;
  select jsonb_agg(jsonb_build_object('id', l.id, 'from', l.effective_from, 'to', l.effective_to) order by l.id) into v_a_links
    from public.organization_unit_operations l where l.organization_unit_id = v_a.id;
  select count(*) into c_a_ea from public.employee_assignments where organization_unit_id = v_a.id;
  select count(*) into c_a_veh from public.vehicles where organization_unit_id = v_a.id;

  set local role authenticated;

  -- ---------------------------------------------------------------------------
  -- B1 — prévia
  -- ---------------------------------------------------------------------------
  j := public.stage_branch_import(v_org, jsonb_build_object('file_name', 'suite16a-filiais.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'code', 'TST16A-N1', 'name', 'Suite 16a Nova', 'legal_name', 'Suite 16a Ltda',
      'document_number', '11.222.333/0001-81', 'status', 'Ativa', 'postal_code', '30130-000', 'state', 'MG',
      'city', 'belo horizonte', 'street', 'Rua da Suite', 'street_number', '16', 'operations', v_op_free.name),
    jsonb_build_object('row_number', 3, 'code', lower(v_a.code), 'name', v_a.name, 'notes', 'Observacao da suite 16a',
      'status', 'Inativa', 'operations', v_op_free.code || '; ' || v_op_free.name),
    jsonb_build_object('row_number', 4, 'code', 'TST16A-N2', 'name', 'Suite 16a CNPJ', 'document_number', '11.222.333/0001-00'),
    jsonb_build_object('row_number', 5, 'code', 'TST16A-N3', 'name', 'Suite 16a Op', 'operations', 'Operacao Fantasma 16a'),
    jsonb_build_object('row_number', 6, 'code', 'TST16A-N4', 'name', 'Suite 16a Outra Org', 'operations', v_op_b::text),
    jsonb_build_object('row_number', 7, 'code', 'TST16A-D', 'name', 'Suite 16a Dup 1'),
    jsonb_build_object('row_number', 8, 'code', 'tst16a-d', 'name', 'Suite 16a Dup 2'),
    jsonb_build_object('row_number', 9, 'code', 'TST16A-N5', 'name', 'Suite 16a UF', 'state', 'SP', 'city', 'Belo Horizonte'),
    jsonb_build_object('row_number', 10, 'code', '', 'name', 'Suite 16a sem codigo'),
    jsonb_build_object('row_number', 11, 'code', 'TST16A-N6'),
    jsonb_build_object('row_number', 12, 'code', 'TST16A-N7', 'name', v_b.name),
    jsonb_build_object('row_number', 13, 'code', 'TST16A-N8', 'name', 'Suite 16a Situacao', 'status', 'Talvez'),
    jsonb_build_object('row_number', 14, 'code', 'TST16A-N9', 'name', 'Suite 16a CNPJ B', 'document_number', v_b.document_number),
    jsonb_build_object('row_number', 15, 'code', 'TST16A-NA', 'name', 'Suite 16a Cidade sem UF', 'city', 'Contagem'))));
  v_batch := (j ->> 'batch_id')::uuid;

  select bool_and(x) into ok from (values
    (exists (select 1 from jsonb_array_elements(j->'rows') s where (s->>'row_number')::int = 2 and s->>'action' = 'create' and s->>'status' = 'valid')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s where (s->>'row_number')::int = 3 and s->>'action' = 'update' and s->>'status' = 'warning'
               and exists (select 1 from jsonb_array_elements(s->'issues') f where f->>'code' = 'status_divergence'))),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 4 and f->>'code' = 'cnpj' and f->>'level' = 'error')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 5 and f->>'code' = 'operation' and f->>'level' = 'error')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 6 and f->>'code' = 'other_organization' and f->>'level' = 'error')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 7 and f->>'code' = 'duplicate')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 8 and f->>'code' = 'duplicate')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 9 and f->>'code' = 'state_city' and f->>'message' like '%encontrada em: MG%')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 10 and f->>'code' = 'required' and f->>'field' = 'code')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 11 and f->>'code' = 'required' and f->>'field' = 'name')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 12 and f->>'code' = 'identity_conflict')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 13 and f->>'code' = 'invalid_value' and f->>'field' = 'status')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 14 and f->>'code' = 'identity_conflict' and f->>'field' = 'document_number')),
    (exists (select 1 from jsonb_array_elements(j->'rows') s, jsonb_array_elements(s->'issues') f where (s->>'row_number')::int = 15 and f->>'code' = 'state_city'))
  ) v(x);
  if ok and (j->>'total_rows')::int = 14 and (j->>'create_rows')::int = 1 and (j->>'update_rows')::int = 1 and (j->>'error_rows')::int = 12 then
    r := r || format('PASS B1 previa: total=%s criar=%s atualizar=%s erros=%s; CNPJ invalido, operacao inexistente, operacao de outra organizacao, codigo duplicado (2 linhas), UF/cidade, obrigatorios, nome e CNPJ de outra filial, situacao invalida, cidade sem UF -> todos classificados',
         j->>'total_rows', j->>'create_rows', j->>'update_rows', j->>'error_rows') || chr(10);
  else
    r := r || format('FAIL B1 total=%s create=%s update=%s err=%s ok=%s rows=%s', j->>'total_rows', j->>'create_rows', j->>'update_rows', j->>'error_rows', ok, j->'rows') || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B2 — a prévia não grava
  -- ---------------------------------------------------------------------------
  reset role;
  select count(*) into n from public.organization_units where organization_id = v_org;
  select count(*) into n2 from public.organization_unit_operations where organization_id = v_org;
  select count(*) into n3 from public.employee_assignments where organization_id = v_org and organization_unit_id is not null;
  select count(*) into n4 from public.vehicles where organization_id = v_org and organization_unit_id is not null;
  if n = c_units and n2 = c_links and n3 = c_ea and n4 = c_veh
     and (select count(*) from public.cost_centers where organization_id = v_org) = c_cc
     and (select status from public.import_batches where id = v_batch) = 'validated'
     and (select type from public.import_batches where id = v_batch) = 'branches' then
    r := r || format('PASS B2 previa nao grava: filiais %s/%s, vinculos %s/%s, colaboradores %s/%s, veiculos %s/%s; lote validated (tipo branches)', c_units, n, c_links, n2, c_ea, n3, c_veh, n4) || chr(10);
  else
    r := r || format('FAIL B2 filiais %s/%s vinculos %s/%s ea %s/%s veh %s/%s', c_units, n, c_links, n2, c_ea, n3, c_veh, n4) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B3 — diferença atual × recebido
  -- ---------------------------------------------------------------------------
  select s into j2 from jsonb_array_elements(j->'rows') s where (s->>'row_number')::int = 3;
  ok := exists (select 1 from jsonb_array_elements(j2->'data'->'changes') c
                 where c->>'field' = 'notes' and c->>'received' = 'Observacao da suite 16a'
                   and (c->>'current') is not distinct from v_a.notes);
  ok2 := jsonb_array_length(j2->'data'->'operations_to_add') = 1 and (j2->'data'->'operations_to_add'->>0)::uuid = v_op_free.id;
  ok3 := not exists (select 1 from jsonb_array_elements(j2->'data'->'changes') c where c->>'field' in ('name', 'status'));
  ok4 := exists (select 1 from jsonb_array_elements(j2->'issues') f where f->>'code' = 'links_kept' and f->>'message' like '%' || v_op_kept.name || '%');
  if ok and ok2 and ok3 and ok4 then
    r := r || 'PASS B3 diferencas: observacoes atual x recebido, 1 operacao a vincular (repetida por codigo e nome conta 1), situacao fora das mudancas, vinculos atuais fora do arquivo listados como mantidos' || chr(10);
  else
    r := r || format('FAIL B3 notes=%s add=%s sem_nome_status=%s mantidos=%s data=%s', ok, ok2, ok3, ok4, j2) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B4 — gravar
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j2 := public.process_branch_import(v_org, v_batch);
  reset role;
  select u.id into v_new from public.organization_units u where u.organization_id = v_org and u.code = 'TST16A-N1' and u.deleted_at is null;
  ok := exists (select 1 from public.organization_units u join public.cities c on c.id = u.city_id join public.states s on s.id = u.state_id
                 where u.id = v_new and u.document_number = '11222333000181' and u.postal_code = '30130000'
                   and s.uf = 'MG' and c.name = 'Belo Horizonte' and u.street = 'Rua da Suite' and u.street_number = '16'
                   and u.legal_name = 'Suite 16a Ltda' and u.status = 'active' and u.unit_type = 'branch' and u.created_by = v_user);
  ok2 := exists (select 1 from public.organization_unit_operations l where l.organization_unit_id = v_new and l.operation_id = v_op_free.id
                   and l.effective_to is null and l.notes like 'Importação: suite16a-filiais.xlsx%');
  select count(*) into n from public.audit_logs where organization_id = v_org and entity_type = 'branch_import' and created_at >= now() and user_id = v_user;
  select count(*) into n2 from public.outbox_events where organization_id = v_org and event_type = 'branch.imported' and created_at >= now();
  select count(*) into n3 from public.outbox_events where organization_id = v_org and event_type = 'branch.operation_added' and created_at >= now();
  if (j2->>'created')::int = 1 and (j2->>'updated')::int = 1 and (j2->>'failed')::int = 0 and ok and ok2 and n = 2 and n2 = 2 and n3 = 2
     and (select status from public.import_batches where id = v_batch) = 'completed' then
    r := r || format('PASS B4 gravacao: criada=%s atualizada=%s vinculos=%s ignoradas=%s; nova com CNPJ/CEP/UF/cidade/endereco e vinculo "Importacao"; auditoria branch_import=%s pelo usuario; eventos imported=%s operation_added=%s',
         j2->>'created', j2->>'updated', j2->>'links_added', j2->>'skipped', n, n2, n3) || chr(10);
  else
    r := r || format('FAIL B4 res=%s nova=%s vinculo=%s audit=%s ev=%s/%s', j2, ok, ok2, n, n2, n3) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B5 — a existente não perde nada
  -- ---------------------------------------------------------------------------
  select count(*) into n from public.organization_unit_operations where organization_unit_id = v_a.id;
  -- Todas as linhas de vínculo que existiam continuam idênticas (vigência intocada).
  ok := not exists (
    select 1 from jsonb_array_elements(v_a_links) old
     where not exists (select 1 from public.organization_unit_operations l
                        where l.id = (old->>'id')::uuid and l.effective_from = (old->>'from')::date
                          and l.effective_to is not distinct from (old->>'to')::date));
  ok2 := exists (select 1 from public.organization_units u where u.id = v_a.id and u.notes = 'Observacao da suite 16a'
                   and u.status = v_a.status and u.name = v_a.name and u.legal_name is not distinct from v_a.legal_name
                   and u.document_number is not distinct from v_a.document_number);
  select count(*) into n2 from public.employee_assignments where organization_unit_id = v_a.id;
  select count(*) into n3 from public.vehicles where organization_unit_id = v_a.id;
  if ok and ok2 and n = c_a_links + 1 and n2 = c_a_ea and n3 = c_a_veh then
    r := r || format('PASS B5 existente: observacoes atualizadas, situacao/nome/CNPJ intactos, %s vinculos antigos com vigencia identica + 1 novo; colaboradores %s/%s e veiculos %s/%s da filial intactos',
         c_a_links, c_a_ea, n2, c_a_veh, n3) || chr(10);
  else
    r := r || format('FAIL B5 vinculos_intactos=%s dados=%s vinculos %s->%s ea %s/%s veh %s/%s', ok, ok2, c_a_links, n, c_a_ea, n2, c_a_veh, n3) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B6 — §62: perfis, roles, permissions, memberships e escopos intactos
  -- ---------------------------------------------------------------------------
  if (select count(*) from public.role_permissions) = c_rp and (select count(*) from public.membership_roles) = c_mr
     and (select count(*) from public.organization_memberships) = c_mem and (select count(*) from public.membership_operation_scopes) = c_scope
     and (select count(*) from public.employee_assignments where organization_id = v_org and organization_unit_id is not null) = c_ea
     and (select count(*) from public.vehicles where organization_id = v_org and organization_unit_id is not null) = c_veh then
    r := r || format('PASS B6 importacao nao altera acesso: role_permissions=%s membership_roles=%s memberships=%s escopos=%s; filial de colaboradores (%s) e veiculos (%s) intacta', c_rp, c_mr, c_mem, c_scope, c_ea, c_veh) || chr(10);
  else
    r := r || 'FAIL B6 contagens de acesso ou de lotacao mudaram' || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B7 — prévia desatualizada
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.stage_branch_import(v_org, jsonb_build_object('file_name', 'suite16a-stale.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'code', 'TST16A-N1', 'notes', 'Nota da previa antiga'))));
  perform public.save_branch(v_org, jsonb_build_object('id', v_new, 'code', 'TST16A-N1', 'name', 'Suite 16a Nova (editada)'));
  j2 := public.process_branch_import(v_org, (j->>'batch_id')::uuid);
  reset role;
  if (j->>'update_rows')::int = 1 and (j2->>'failed')::int = 1 and (j2->>'updated')::int = 0
     and (j2->'errors'->0->>'message') like '%alterada depois da pr%via%'
     and (select notes from public.organization_units where id = v_new) is null then
    r := r || 'PASS B7 previa desatualizada: a filial mudou depois da previa, a linha falha e nada e gravado' || chr(10);
  else
    r := r || format('FAIL B7 stage=%s process=%s', j->>'update_rows', j2) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B8 — sem branches.import; outra organização
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  j := public.stage_branch_import(v_org, jsonb_build_object('file_name', 'suite16a-perm.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'code', 'TST16A-P1', 'name', 'Suite 16a Permissao'))));
  reset role;
  n := 0; n2 := 0; n3 := 0;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org and p.code = 'branches.import';
    perform set_config('hfm.access_change', '', true);
    set local role authenticated;
    begin
      perform public.stage_branch_import(v_org, jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'code', 'X1', 'name', 'X'))));
    exception when others then n := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.process_branch_import(v_org, (j->>'batch_id')::uuid);
    exception when others then n2 := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.stage_branch_import(v_org_b, jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'code', 'X1', 'name', 'X'))));
    exception when others then n3 := case when sqlstate = '42501' then 1 else 0 end; end;
    reset role;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  reset role;
  if not private.has_permission(v_org, 'branches.import') then raise exception 'B8 nao restaurou o administrador'; end if;
  if n = 1 and n2 = 1 and n3 = 1
     and not exists (select 1 from public.organization_units where organization_id = v_org and code = 'TST16A-P1') then
    r := r || 'PASS B8 sem branches.import: validar e gravar recusados (42501), nada criado; outra organizacao recusada' || chr(10);
  else
    r := r || format('FAIL B8 stage=%s process=%s outra_org=%s', n, n2, n3) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B9 — exportação auditada
  -- ---------------------------------------------------------------------------
  set local role authenticated;
  v_audit := public.log_branch_export(v_org, 'csv', 3, 'filtradas', jsonb_build_object('filters', jsonb_build_object('situacao', 'active')));
  perform public.log_branch_export(v_org, 'xlsx', 0, 'modelo');
  ok := false;
  begin
    perform public.log_branch_export(v_org, 'pdf', 1, 'todas');
  exception when others then ok := sqlerrm like 'Formato de exporta%';
  end;
  ok2 := false;
  begin
    perform public.log_branch_export(v_org, 'xlsx', 1, 'tudo');
  exception when others then ok2 := sqlerrm like 'Tipo de exporta%';
  end;
  reset role;
  select count(*) into n from public.audit_logs where organization_id = v_org and entity_type = 'branch_export' and action = 'EXPORT' and created_at >= now() and user_id = v_user;
  select count(*) into n2 from public.outbox_events where organization_id = v_org and event_type = 'branch.exported' and created_at >= now();
  ok3 := exists (select 1 from public.audit_logs where id = v_audit and new_data->>'kind' = 'filtradas' and (new_data->>'row_count')::int = 3
                   and new_data->'details'->'filters'->>'situacao' = 'active');
  n3 := 0;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org and p.code = 'branches.export';
    perform set_config('hfm.access_change', '', true);
    set local role authenticated;
    begin
      perform public.log_branch_export(v_org, 'xlsx', 1, 'todas');
    exception when others then n3 := case when sqlstate = '42501' then 1 else 0 end; end;
    reset role;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  reset role;
  if n = 2 and n2 = 2 and ok and ok2 and ok3 and n3 = 1 then
    r := r || 'PASS B9 exportacao: 2 registros EXPORT (filtradas e modelo) pelo usuario, 2 eventos branch.exported, filtros gravados; formato e tipo invalidos recusados; sem branches.export recusada (42501)' || chr(10);
  else
    r := r || format('FAIL B9 audit=%s eventos=%s formato=%s tipo=%s detalhes=%s sem_perm=%s', n, n2, ok, ok2, ok3, n3) || chr(10);
  end if;

  -- ---------------------------------------------------------------------------
  -- B10 — centros de custo
  -- ---------------------------------------------------------------------------
  insert into public.cost_centers (organization_id, code, name) values (v_org, 'TST16A-CC1', 'Suite 16a Centro 1') returning id into v_cc1;
  insert into public.cost_centers (organization_id, code, name) values (v_org, 'TST16A-CC2', 'Suite 16a Centro 2') returning id into v_cc2;
  insert into public.cost_centers (organization_id, code, name) values (v_org_b, 'TST16A-CCB', 'Centro da outra organizacao') returning id into v_cc_b;
  set local role authenticated;
  j := public.set_branch_cost_center(v_a.id, v_cc1, true);
  j2 := public.set_branch_cost_center(v_a.id, v_cc2, true);
  ok := false;
  begin
    perform public.set_branch_cost_center(v_new, v_cc1, true);
  exception when others then ok := sqlerrm like '%já está associado à filial%';
  end;
  ok2 := false;
  begin
    perform public.set_branch_cost_center(v_new, v_cc2, false);
  exception when others then ok2 := sqlerrm like '%não está associado a esta filial%';
  end;
  ok3 := false;
  begin
    perform public.set_branch_cost_center(v_a.id, v_cc_b, true);
  exception when others then ok3 := sqlerrm like 'Centro de custo não encontrado nesta organização%';
  end;
  perform public.set_branch_cost_center(v_a.id, v_cc2, false);
  select count(*) into n from public.branch_cost_center_directory where organization_unit_id = v_a.id and id in (v_cc1, v_cc2);
  select count(*) into n2 from public.branch_audit_trail(v_a.id, 200) t where t.entity_type = 'public.cost_centers';
  reset role;
  select count(*) into n3 from public.outbox_events where organization_id = v_org and event_type in ('branch.cost_center_added', 'branch.cost_center_removed') and created_at >= now();
  n4 := 0;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org and p.code = 'cost_centers.manage';
    perform set_config('hfm.access_change', '', true);
    set local role authenticated;
    begin
      perform public.set_branch_cost_center(v_a.id, v_cc2, true);
    exception when others then n4 := case when sqlstate = '42501' then 1 else 0 end; end;
    reset role;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  reset role;
  if (j->>'changed')::boolean and (j2->>'changed')::boolean and ok and ok2 and ok3 and n = 1 and n2 = 3 and n3 = 3 and n4 = 1
     and (select organization_unit_id from public.cost_centers where id = v_cc1) = v_a.id
     and (select organization_unit_id from public.cost_centers where id = v_cc2) is null
     and (select organization_unit_id from public.cost_centers where id = v_cc_b) is null then
    r := r || 'PASS B10 centros de custo: dois associados a mesma filial, ja associado a outra recusado, desassociar de filial errada recusado, outra organizacao recusada, desassociado; 3 eventos e 3 linhas no historico da filial; sem cost_centers.manage recusado (42501)' || chr(10);
  else
    r := r || format('FAIL B10 assoc=%s/%s outra_filial=%s errada=%s outra_org=%s vinculados=%s historico=%s eventos=%s sem_perm=%s', j, j2, ok, ok2, ok3, n, n2, n3, n4) || chr(10);
  end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end;
$t$;
