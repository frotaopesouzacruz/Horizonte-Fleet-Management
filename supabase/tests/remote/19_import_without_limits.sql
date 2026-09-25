-- =============================================================================
-- 19 · Importação sem teto de linhas — validação e gravação em partes
--      (migration 20260925100000_import_export_without_limits)
--
-- Suíte transacional contra o banco COM DADOS: usa as BRs, os veículos, as
-- operações e os colaboradores reais da organização. Tudo o que ela cria
-- (lotes, linhas, vínculos, veículos e pessoas de teste) existe só dentro da
-- transação: o bloco termina em `raise exception 'ROLLBACK_TESTES …'` DE
-- PROPÓSITO, e nada persiste.
--
-- O único membro real é personificado por `request.jwt.claims` + `set local
-- role authenticated`, como na tela.
--
-- A regra de cada linha não mudou; o que mudou é que o arquivo chega e é
-- validado e gravado em partes. Então a prova central é de EQUIVALÊNCIA: o
-- mesmo arquivo, validado de uma vez (`phase = all`, o caminho de antes) e em
-- partes (carregado de 3 em 3 linhas, validado de 1 em 1), dá exatamente a
-- mesma assinatura linha a linha — situação, ação e cada apontamento.
--
--   L1  Fidelização (alocações): as sete categorias da §58 e a assinatura
--       idênticas nos dois caminhos, inclusive a sobreposição DENTRO do arquivo
--   L2  BRs: idem, inclusive o código repetido dentro do arquivo
--   L3  Filiais: idem; e as repetições que dependem do arquivo inteiro (código,
--       CNPJ, nome com códigos diferentes) marcam as DUAS linhas envolvidas,
--       mesmo quando a segunda ainda não foi validada
--   L4  Aderência: idem
--   L5  Frota: validate_vehicle_import inteiro × em partes (p_limit 2) — mesma
--       assinatura e mesmos totais; gravação em partes (p_limit 1) cria e
--       atualiza o mesmo que a prévia prometeu
--   L6  Usuários: validate_employee_import inteiro × em partes; matrícula e
--       CPF repetidos marcam as duas linhas; gravação em partes vincula o
--       líder que veio no próprio arquivo
--   L7  Gravação em partes da Fidelização: a primeira parte deixa o lote em
--       `processing`, a chamada seguinte (sem p_limit, a assinatura antiga)
--       retoma de onde parou e fecha com os mesmos números da gravação única
--   L8  Proteções do protocolo: acrescentar linhas depois de validar recusado;
--       fechar com linha pendente recusado; reenviar a mesma parte não duplica
--       linha; lote de outro tipo recusado; validar sem lote recusado
--   L9  Sem teto: um arquivo de 5.001 linhas (o teto antigo era 5.000) é
--       aceito e validado
--
-- Última execução: 9/9 PASS contra o projeto de desenvolvimento (25/09/2026);
-- desempenho e contexto em docs/architecture/importacao-exportacao-sem-limite.md.
-- =============================================================================
select set_config('request.jwt.claims',
  (select json_build_object('sub', m.user_id, 'role', 'authenticated')::text
     from public.organization_memberships m
     join public.organizations o on o.id = m.organization_id
    where o.deleted_at is null and o.status = 'active' and m.status = 'active'
    order by o.created_at limit 1), true);
set local role authenticated;

-- Assinatura de um lote: linha:situação:ação:apontamentos, na ordem do arquivo.
create function pg_temp.sig(b uuid) returns text language sql as $f$
  select coalesce(string_agg(r.row_number || ':' || r.status || ':' || r.action || ':' ||
           coalesce((select string_agg(e.level || '/' || e.code, ',' order by e.level, e.code, e.message)
                       from public.import_errors e where e.batch_id = b and e.row_number = r.row_number), ''),
           ';' order by r.row_number), '')
    from public.import_rows r where r.batch_id = b
$f$;

-- O mesmo arquivo pelo protocolo em partes: carrega de p_load em p_load,
-- valida de p_lim em p_lim, fecha.
create function pg_temp.chunked(p_fn text, p_org uuid, p_rows jsonb, p_load int, p_lim int)
returns jsonb language plpgsql as $f$
declare b uuid; res jsonb; i int := 0; n int := jsonb_array_length(p_rows); calls int := 0;
begin
  while i < n loop
    execute format('select public.%I($1, $2)', p_fn) into res using p_org,
      jsonb_build_object('phase', 'load', 'batch_id', b, 'file_name', 'suite19.xlsx', 'rows',
        (select jsonb_agg(e.value order by e.ord) from jsonb_array_elements(p_rows) with ordinality e(value, ord)
          where e.ord > i and e.ord <= i + p_load));
    b := (res ->> 'batch_id')::uuid;
    i := i + p_load;
  end loop;
  loop
    execute format('select public.%I($1, $2)', p_fn) into res using p_org,
      jsonb_build_object('phase', 'validate', 'batch_id', b, 'limit', p_lim);
    calls := calls + 1;
    exit when (res ->> 'pending')::int = 0 or calls > 10000;
  end loop;
  execute format('select public.%I($1, $2)', p_fn) into res using p_org,
    jsonb_build_object('phase', 'finalize', 'batch_id', b);
  return res || jsonb_build_object('_validate_calls', calls);
end $f$;

do $t$
declare
  v_org uuid; v_user uuid;
  v_a record; v_b record; v_van record; v_vanb record; v_emp record;
  rows jsonb; j jsonb; k jsonb; b1 uuid; b2 uuid; v_l1 uuid; t record;
  n bigint; n2 bigint; ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean;
  s1 text; s2 text;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m where m.organization_id = v_org and m.status = 'active' limit 1;

  -- Fixture da suíte 13b: BR A com titular vigente; BR B da mesma operação, cujo veículo é liberado.
  select b.id, b.code, b.status as br_status, o.name as op_name, ci.name as city_name, s.uf::text as uf,
         a.vehicle_id, a.start_date, a.end_date, a.id as assignment_id, b.operation_id, v.vehicle_type_id
    into v_a
    from public.operation_brs b join public.operations o on o.id = b.operation_id
    join public.cities ci on ci.id = b.city_id join public.states s on s.id = b.state_id
    join public.fidelization_assignments a on a.operation_br_id = b.id and a.status <> 'cancelled' and a.vehicle_role = 'primary'
         and a.start_date <= current_date and a.end_date >= current_date
    join public.vehicles v on v.id = a.vehicle_id and v.status = 'active'
   where b.organization_id = v_org and b.deleted_at is null and b.status = 'active'
   order by a.start_date, b.code limit 1;
  select b.id, b.code, a.vehicle_id, a.id as assignment_id
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
  perform public.end_fidelization_assignment(v_b.assignment_id, current_date - 1, 'Suite 19: libera o veiculo');

  -- L1: Fidelizacao — os oito casos da 13b (I3), mais duas linhas que se sobrepoem dentro do arquivo
  rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'br_code', v_a.code, 'fleet_code', v_van.fleet_code, 'start_date', v_a.start_date::text, 'end_date', v_a.end_date::text),
    jsonb_build_object('row_number', 3, 'br_code', v_a.code, 'operation', v_a.op_name, 'license_plate', v_vanb.license_plate, 'start_date', (current_date + 3)::text, 'reason', 'Troca planejada'),
    jsonb_build_object('row_number', 4, 'br_code', v_b.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-10-01', 'end_date', '2026-10-31'),
    jsonb_build_object('row_number', 5, 'br_code', v_a.code, 'fleet_code', v_van.fleet_code, 'start_date', '2026-10-01', 'end_date', '2026-10-31'),
    jsonb_build_object('row_number', 6, 'br_code', v_a.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-10-15', 'end_date', '2026-10-20'),
    jsonb_build_object('row_number', 7, 'br_code', 'SUITE19-NAOEXISTE', 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-11-01'),
    jsonb_build_object('row_number', 8, 'br_code', v_a.code, 'fleet_code', 'FROTA-INEXISTENTE', 'start_date', '2026-11-01'),
    jsonb_build_object('row_number', 9, 'br_code', v_a.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2026-11-10', 'end_date', '2026-11-05'),
    jsonb_build_object('row_number', 10, 'br_code', v_b.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2027-03-01', 'end_date', '2027-03-31'),
    jsonb_build_object('row_number', 11, 'br_code', v_b.code, 'fleet_code', v_vanb.fleet_code, 'start_date', '2027-03-15', 'end_date', '2027-04-15'));
  j := public.stage_fidelization_import(v_org, jsonb_build_object('file_name', 'suite19.xlsx', 'rows', rows));
  k := pg_temp.chunked('stage_fidelization_import', v_org, rows, 3, 1);
  b1 := (j ->> 'batch_id')::uuid; b2 := (k ->> 'batch_id')::uuid; v_l1 := b2;
  s1 := pg_temp.sig(b1); s2 := pg_temp.sig(b2);
  ok := s1 = s2 and j -> 'categories' = k -> 'categories'
        and (j ->> 'total_rows') = (k ->> 'total_rows') and (j ->> 'create_rows') = (k ->> 'create_rows')
        and (j ->> 'substitute_rows') = (k ->> 'substitute_rows') and (j ->> 'skip_rows') = (k ->> 'skip_rows');
  ok2 := (j -> 'categories' ->> 'overlaps')::int = 2
         and exists (select 1 from public.import_errors e where e.batch_id = b2 and e.row_number = 11 and e.code = 'overlap' and e.message like '%linha 10%');
  r := r || format('L1  fidelizacao: validacoes em partes=%s, categorias=%s, assinatura igual=%s, sobreposicao no arquivo=%s -> %s%s',
       k ->> '_validate_calls', k -> 'categories', s1 = s2, ok2,
       case when ok and ok2 and (k ->> '_validate_calls')::int = 10 then 'PASS' else 'FAIL' end, chr(10));

  -- L2: BRs — os cinco casos da 13b (I1)
  rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'operation', v_a.op_name, 'state', v_a.uf, 'city', v_a.city_name, 'code', v_a.code, 'status', 'Inativo'),
    jsonb_build_object('row_number', 3, 'operation', v_a.op_name, 'city', v_a.city_name, 'code', 'SUITE19-NOVA', 'description', 'Posicao de teste'),
    jsonb_build_object('row_number', 4, 'operation', v_a.op_name, 'city', 'Cidade Inexistente', 'code', 'SUITE19-X'),
    jsonb_build_object('row_number', 5, 'operation', lower(v_a.op_name), 'city', v_a.city_name, 'code', 'suite19-nova'),
    jsonb_build_object('row_number', 6, 'operation', 'Operacao Fantasma', 'city', v_a.city_name, 'code', 'SUITE19-Y'));
  j := public.stage_br_import(v_org, jsonb_build_object('file_name', 'suite19.xlsx', 'rows', rows));
  k := pg_temp.chunked('stage_br_import', v_org, rows, 3, 1);
  s1 := pg_temp.sig((j ->> 'batch_id')::uuid); s2 := pg_temp.sig((k ->> 'batch_id')::uuid);
  ok := s1 = s2 and (j ->> 'create_rows') = (k ->> 'create_rows') and (j ->> 'error_rows') = (k ->> 'error_rows')
        and (k ->> 'create_rows')::int = 1 and (k ->> 'error_rows')::int = 3
        and exists (select 1 from public.import_errors e where e.batch_id = (k ->> 'batch_id')::uuid and e.row_number = 5 and e.code = 'duplicate');
  r := r || format('L2  BRs: criar=%s erros=%s, repetido no arquivo apontado, assinatura igual=%s -> %s%s',
       k ->> 'create_rows', k ->> 'error_rows', s1 = s2, case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- L3: Filiais — repeticoes que dependem do arquivo inteiro
  rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'code', 'TST19-A', 'name', 'Suite 19 A', 'document_number', '11.222.333/0001-81'),
    jsonb_build_object('row_number', 3, 'code', 'tst19-a', 'name', 'Suite 19 B'),
    jsonb_build_object('row_number', 4, 'code', 'TST19-C', 'name', 'Suite 19 C', 'document_number', '11222333000181'),
    jsonb_build_object('row_number', 5, 'code', 'TST19-D', 'name', 'suite 19 c'),
    jsonb_build_object('row_number', 6, 'code', 'TST19-E', 'name', 'Suite 19 E', 'document_number', '11.444.777/0001-61'));
  j := public.stage_branch_import(v_org, jsonb_build_object('file_name', 'suite19.xlsx', 'rows', rows));
  k := pg_temp.chunked('stage_branch_import', v_org, rows, 3, 1);
  b2 := (k ->> 'batch_id')::uuid;
  s1 := pg_temp.sig((j ->> 'batch_id')::uuid); s2 := pg_temp.sig(b2);
  ok := s1 = s2 and (j ->> 'error_rows') = (k ->> 'error_rows') and (j ->> 'create_rows') = (k ->> 'create_rows');
  ok2 := (select count(distinct e.row_number) from public.import_errors e where e.batch_id = b2 and e.field = 'code' and e.code = 'duplicate') = 2
     and (select count(distinct e.row_number) from public.import_errors e where e.batch_id = b2 and e.field = 'document_number' and e.code = 'duplicate') = 2
     and (select count(distinct e.row_number) from public.import_errors e where e.batch_id = b2 and e.field = 'name' and e.code = 'identity_conflict'
            and e.message like '%com c_digos diferentes%') = 2;
  ok3 := not exists (select 1 from public.import_rows x where x.batch_id = b2 and x.normalized_data ? '_file_counts');
  r := r || format('L3  filiais: codigo, CNPJ e nome repetidos marcam as duas linhas=%s, contagens nao ficam na linha validada=%s, assinatura igual=%s -> %s%s',
       ok2, ok3, s1 = s2, case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- L4: Aderencia
  rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'fleet_code', v_van.fleet_code, 'operational_date', (current_date - 3)::text, 'context', 'saida', 'status', 'Manutencao'),
    jsonb_build_object('row_number', 3, 'fleet_code', v_van.fleet_code, 'operational_date', (current_date - 3)::text, 'context', 'retorno', 'status', 'Nao fez'),
    jsonb_build_object('row_number', 4, 'license_plate', v_vanb.license_plate, 'operational_date', (current_date + 5)::text, 'context', 'saida', 'status', 'Manutencao'),
    jsonb_build_object('row_number', 5, 'fleet_code', 'FROTA-INEXISTENTE', 'operational_date', (current_date - 1)::text, 'context', 'saida', 'status', 'Manutencao'),
    jsonb_build_object('row_number', 6, 'fleet_code', v_van.fleet_code, 'operational_date', 'data-invalida', 'context', 'saida', 'status', 'Manutencao'),
    jsonb_build_object('row_number', 7, 'fleet_code', v_van.fleet_code, 'operational_date', (current_date - 2)::text, 'context', 'x', 'status', 'Manutencao'));
  j := public.stage_adherence_import(v_org, jsonb_build_object('file_name', 'suite19.xlsx', 'rows', rows));
  k := pg_temp.chunked('stage_adherence_import', v_org, rows, 3, 1);
  s1 := pg_temp.sig((j ->> 'batch_id')::uuid); s2 := pg_temp.sig((k ->> 'batch_id')::uuid);
  ok := s1 = s2 and (j ->> 'valid_rows') = (k ->> 'valid_rows') and (j ->> 'error_rows') = (k ->> 'error_rows')
        and (j ->> 'warning_rows') = (k ->> 'warning_rows') and (k ->> 'total_rows')::int = 6;
  r := r || format('L4  aderencia: total=%s validas=%s avisos=%s erros=%s, assinatura igual=%s -> %s%s',
       k ->> 'total_rows', k ->> 'valid_rows', k ->> 'warning_rows', k ->> 'error_rows', s1 = s2, case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- L5: Frota — as linhas chegam pela API (como a tela faz) e a validacao roda inteira x em partes
  rows := jsonb_build_array(
    jsonb_build_object('fleet_code', v_van.fleet_code, 'license_plate', v_van.license_plate, 'notes', 'Suite 19'),
    jsonb_build_object('fleet_code', 'TST19-F1', 'license_plate', 'TST1901', 'type_name', 'Inexistente 19'),
    jsonb_build_object('fleet_code', 'TST19-F2', 'license_plate', 'TST1901'),
    jsonb_build_object('fleet_code', 'tst19-f1', 'license_plate', 'TST1903'),
    jsonb_build_object('fleet_code', 'TST19-F4', 'license_plate', null),
    jsonb_build_object('fleet_code', v_vanb.fleet_code, 'license_plate', v_vanb.license_plate));
  for t in select 1 as pass union all select 2 loop
    insert into public.import_batches (organization_id, type, mode, status, file_name, created_by, updated_by)
    values (v_org, 'vehicles', 'create_update', 'draft', 'suite19-frota.xlsx', v_user, v_user)
    returning id into b2;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data)
    select v_org, b2, e.ord::int + 1, '{}'::jsonb, e.value from jsonb_array_elements(rows) with ordinality e(value, ord);
    if t.pass = 1 then b1 := b2; end if;
  end loop;
  select * into t from public.validate_vehicle_import(b1);
  n := 0;
  loop
    select pending_rows into n2 from public.validate_vehicle_import(b2, 2);
    n := n + 1;
    exit when n2 = 0 or n > 50;
  end loop;
  s1 := pg_temp.sig(b1); s2 := pg_temp.sig(b2);
  select (b.total_rows, b.valid_rows, b.warning_rows, b.error_rows) = (t.total_rows, t.valid_rows, t.warning_rows, t.error_rows) and b.status = 'validated'
    into ok from public.import_batches b where b.id = b2;
  ok2 := exists (select 1 from public.import_errors e where e.batch_id = b2 and e.row_number = 4 and e.field = 'license_plate' and e.code = 'duplicate_in_file')
     and exists (select 1 from public.import_errors e where e.batch_id = b2 and e.row_number = 5 and e.field = 'fleet_code' and e.code = 'duplicate_in_file');
  n := 0;
  loop
    select * into t from public.process_vehicle_import(b2, 1);
    n := n + 1;
    exit when t.remaining_rows = 0 or n > 50;
  end loop;
  ok3 := t.created_rows = (select count(*) from public.import_rows x where x.batch_id = b2 and x.action = 'create' and x.status = 'created')
     and t.updated_rows = (select count(*) from public.import_rows x where x.batch_id = b2 and x.action = 'update' and x.status = 'updated')
     and (select status from public.import_batches where id = b2) = 'completed'
     and (select notes from public.vehicles where id = v_a.vehicle_id) = 'Suite 19';
  r := r || format('L5  frota: assinatura igual=%s, totais iguais=%s, repetidos no arquivo=%s; gravacao em %s partes: criados=%s atualizados=%s ignorados=%s -> %s%s',
       s1 = s2, ok, ok2, n, t.created_rows, t.updated_rows, t.skipped_rows,
       case when s1 = s2 and ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- L6: Usuarios — matricula e CPF repetidos, lider que vem no proprio arquivo
  select e.full_name into v_emp from public.employees e where e.organization_id = v_org and e.deleted_at is null order by e.employee_code limit 1;
  rows := jsonb_build_array(
    jsonb_build_object('employee_code', 'TST19-001', 'full_name', 'Suite Dezenove Lider'),
    jsonb_build_object('employee_code', 'TST19-002', 'full_name', 'Suite Dezenove Liderado', 'manager_name', 'suite dezenove lider'),
    jsonb_build_object('employee_code', 'TST19-003', 'full_name', 'Suite Dezenove Repetido A'),
    jsonb_build_object('employee_code', 'tst19-003', 'full_name', 'Suite Dezenove Repetido B'),
    jsonb_build_object('employee_code', 'TST19-005', 'full_name', 'Suite Dezenove CPF', 'cpf', '529.982.247-25'),
    jsonb_build_object('employee_code', 'TST19-006', 'full_name', 'Suite Dezenove CPF 2', 'cpf', '52998224725'),
    jsonb_build_object('employee_code', 'TST19-007', 'full_name', 'Suite Dezenove Sem Lider', 'manager_name', 'Lider Que Nao Existe 19'),
    jsonb_build_object('employee_code', 'TST19-008', 'full_name', 'Suite Dezenove Com Lider', 'manager_name', v_emp.full_name));
  for t in select 1 as pass union all select 2 loop
    insert into public.import_batches (organization_id, type, mode, status, file_name, created_by, updated_by)
    values (v_org, 'employees', 'create_update', 'draft', 'suite19-usuarios.xlsx', v_user, v_user)
    returning id into b2;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data)
    select v_org, b2, e.ord::int + 1, '{}'::jsonb, e.value from jsonb_array_elements(rows) with ordinality e(value, ord);
    if t.pass = 1 then b1 := b2; end if;
  end loop;
  select * into t from public.validate_employee_import(b1);
  n := 0;
  loop
    select pending_rows into n2 from public.validate_employee_import(b2, 3);
    n := n + 1;
    exit when n2 = 0 or n > 50;
  end loop;
  s1 := pg_temp.sig(b1); s2 := pg_temp.sig(b2);
  select (b.total_rows, b.valid_rows, b.warning_rows, b.error_rows) = (t.total_rows, t.valid_rows, t.warning_rows, t.error_rows) and b.status = 'validated'
    into ok from public.import_batches b where b.id = b2;
  ok2 := (select count(*) from public.import_errors e where e.batch_id = b2 and e.code in ('duplicate_code_in_file', 'duplicate_cpf_in_file')) = 4
     and exists (select 1 from public.import_errors e where e.batch_id = b2 and e.row_number = 8 and e.code = 'manager_not_found')
     and not exists (select 1 from public.import_errors e where e.batch_id = b2 and e.row_number = 3 and e.code = 'manager_not_found');
  n := 0;
  loop
    select * into t from public.process_employee_import(b2, 1);
    n := n + 1;
    exit when t.remaining_rows = 0 or n > 50;
  end loop;
  ok3 := (select a.manager_employee_id from public.employee_assignments a join public.employees e on e.id = a.employee_id
           where e.organization_id = v_org and e.employee_code = 'TST19-002' and a.is_current)
       = (select e.id from public.employees e where e.organization_id = v_org and e.employee_code = 'TST19-001')
     and (select status from public.import_batches where id = b2) = 'completed'
     and t.created_rows = 4;
  r := r || format('L6  usuarios: assinatura igual=%s, totais iguais=%s, repetidos e lider=%s; gravacao em %s partes: criados=%s, lider do arquivo vinculado=%s -> %s%s',
       s1 = s2, ok, ok2, n, t.created_rows, ok3, case when s1 = s2 and ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- L7: gravacao em partes da Fidelizacao (o lote validado em partes na L1)
  b2 := v_l1;
  j := public.process_fidelization_import(v_org, b2, 1);
  ok := (j ->> 'done')::boolean = false and (select status from public.import_batches where id = b2) = 'processing';
  k := public.process_fidelization_import(v_org, b2);
  ok2 := (k ->> 'done')::boolean and (k ->> 'created')::int = 3 and (k ->> 'substituted')::int = 1
     and (select status from public.import_batches where id = b2) = 'completed'
     and not exists (select 1 from public.import_rows x where x.batch_id = b2 and x.status in ('valid', 'warning'));
  r := r || format('L7  gravacao em partes: primeira parte deixa processing=%s, retomada fecha com criados=%s substituidos=%s ignorados=%s -> %s%s',
       ok, k ->> 'created', k ->> 'substituted', k ->> 'skipped', case when ok and ok2 then 'PASS' else 'FAIL' end, chr(10));

  -- L8: protecoes do protocolo
  rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'operation', 'Operacao Fantasma', 'city', 'X', 'code', 'SUITE19-P1'),
    jsonb_build_object('row_number', 3, 'operation', 'Operacao Fantasma', 'city', 'X', 'code', 'SUITE19-P2'));
  j := public.stage_br_import(v_org, jsonb_build_object('phase', 'load', 'file_name', 'suite19-p.xlsx', 'rows', rows));
  b1 := (j ->> 'batch_id')::uuid;
  j := public.stage_br_import(v_org, jsonb_build_object('phase', 'load', 'batch_id', b1, 'rows', rows));
  ok := (j ->> 'loaded')::int = 2;
  ok2 := false;
  begin
    perform public.stage_br_import(v_org, jsonb_build_object('phase', 'finalize', 'batch_id', b1));
  exception when others then ok2 := sqlerrm like 'Ainda h% linhas%';
  end;
  perform public.stage_br_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', b1, 'limit', 1));
  ok3 := false;
  begin
    perform public.stage_br_import(v_org, jsonb_build_object('phase', 'load', 'batch_id', b1, 'rows',
      jsonb_build_array(jsonb_build_object('row_number', 9, 'code', 'SUITE19-P9'))));
  exception when others then ok3 := sqlerrm like '%valida%o desta importa%o j% come%ou%';
  end;
  ok4 := false;
  begin
    perform public.stage_fidelization_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', b1, 'limit', 1));
  exception when others then ok4 := sqlerrm like '%n%o est% mais aberta%';
  end;
  ok5 := false;
  begin
    perform public.stage_br_import(v_org, jsonb_build_object('phase', 'validate', 'limit', 1));
  exception when others then ok5 := sqlerrm like 'Informe a importa%o em andamento%';
  end;
  r := r || format('L8  protecoes: reenvio nao duplica=%s, fechar com pendente recusado=%s, acrescentar depois de validar recusado=%s, lote de outro tipo recusado=%s, validar sem lote recusado=%s -> %s%s',
       ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- L9: sem teto — 5.001 linhas (o teto antigo era 5.000)
  j := public.stage_br_import(v_org, jsonb_build_object('file_name', 'suite19-grande.xlsx', 'rows',
    (select jsonb_agg(jsonb_build_object('row_number', g + 1, 'city', 'X', 'code', 'SUITE19-G' || g)) from generate_series(1, 5001) g)));
  r := r || format('L9  sem teto: arquivo de 5001 linhas aceito, total=%s erros=%s -> %s%s',
       j ->> 'total_rows', j ->> 'error_rows', case when (j ->> 'total_rows')::int = 5001 and (j ->> 'error_rows')::int = 5001 then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
