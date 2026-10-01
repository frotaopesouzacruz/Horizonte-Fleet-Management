-- =============================================================================
-- 26 · Importação da Manutenção — operação e cidade da planilha; manutenção
--      aberta que perdeu a OS ou mudou de data
--
-- Migration 20261002105000_maintenance_import_operation_city. Suíte contra o
-- banco COM DADOS; tudo é desfeito no fim (`raise exception 'ROLLBACK_TESTES …'`).
-- Os cadastros usados aqui têm prefixo "Suite26" e somem com o rollback. As
-- rotinas de importação rodam como o usuário autenticado (role authenticated
-- + request.jwt.claims); os cadastros de apoio e as conferências, como dono.
--
--   R1  Resolução: operação sem acento/caixa e com "/" ou "-"; cidade sem UF
--       pela abrangência da operação, pelos estados dela ou única no país;
--       cidade ambígua e operação desconhecida viram aviso
--   C1  Prévia do arquivo novo: reidentificadas, OS mantida, reprogramação,
--       contexto divergente, conflito, avisos de operação/cidade, nenhuma
--       duplicada, 2 novas
--   C2  OS apagada em linhas "Há agendar": atualiza a manutenção que já
--       existia (OS do HFM mantida), não cria outra nem soma item à vizinha
--   C3  Existente sem operação: recebe a da planilha (evento import_updated,
--       change = context_filled, autor = quem importou; context_source none)
--   C4  Existente com outra operação: aviso "Contexto divergente", nada muda
--   C5  Alterada por usuário (conflito): só o contexto vazio é preenchido
--   C6  Nova sem contexto oficial: grava a operação/cidade da planilha
--   C7  Preventiva agendada com outra data: reprogramada (evento
--       rescheduled, origem importação), sem nova manutenção
--   C8  Duas candidatas: aviso listando as duas, a linha cria como antes
--   C9  O mesmo arquivo de novo: nada a criar nem atualizar, nenhum evento
-- =============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from public.organization_memberships m
                             where m.organization_id = (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1)
                               and m.status = 'active' limit 1), 'role', 'authenticated')::text, true);
do $t$
declare
  v_org uuid; v_uid uuid; v_today date;
  v1 record; v2 record; v3 record; v4 record; v5 record;
  op_a uuid; op_b uuid; op_c uuid;
  j jsonb; k jsonb; c jsonb; x jsonb; ok boolean;
  v_rows jsonb; v_base jsonb;
  m_a1 uuid; m_b1 uuid; m_b2 uuid; m_c1 uuid; m_p uuid; m_r8 uuid; m_r9 uuid; m_r10 uuid; m_new uuid;
  n int; n2 int; n_ev int; n_v1 int; n_v5 int;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  v_uid := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
  v_today := private.maintenance_today(v_org);

  -- Veículos: v2 sem nenhuma manutenção (ciclos preventivos limpos); v4 sem
  -- contexto oficial hoje (Fidelização/alocação), para a manutenção nova. Com a
  -- competência mensal toda a frota real tem fidelização vigente, então v4 é
  -- um veículo de teste criado aqui (some com o rollback), do tipo de v2.
  select v.id, v.license_plate, v.vehicle_type_id, v.vehicle_subcategory_id, v.vehicle_model_id into v2 from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null
     and not exists (select 1 from public.maintenances m where m.vehicle_id = v.id)
   order by v.fleet_code limit 1;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, fleet_code, license_plate, status)
  values (v_org, v2.vehicle_type_id, v2.vehicle_subcategory_id, 'SUITE26-SEMCTX', 'SUITE26X', 'active');
  select v.id, v.license_plate into v4 from public.vehicles v
   where v.organization_id = v_org and v.license_plate = 'SUITE26X' and v.deleted_at is null;
  if private.maintenance_context(v_org, v4.id, v_today) ->> 'operation_id' is not null then
    raise exception 'FIXTURE: o veículo de teste SUITE26X já nasceu com contexto oficial';
  end if;
  select v.id, v.license_plate into v1 from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.id not in (v2.id, v4.id)
   order by v.fleet_code limit 1;
  select v.id, v.license_plate into v3 from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.id not in (v1.id, v2.id, v4.id)
   order by v.fleet_code limit 1;
  select v.id, v.license_plate into v5 from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.id not in (v1.id, v2.id, v3.id, v4.id)
   order by v.fleet_code limit 1;

  -- Operações (nomes com acento e barra) e a geografia delas.
  insert into public.operations (organization_id, name, status) values (v_org, 'Suite26 Redespacho Belém / PA', 'active') returning id into op_a;
  insert into public.operations (organization_id, name, status) values (v_org, 'Suite26 Merchandising CO', 'active') returning id into op_b;
  insert into public.operations (organization_id, name, status) values (v_org, 'Suite26 Last Mille MG', 'active') returning id into op_c;
  insert into public.operation_states (organization_id, operation_id, state_id)
  values (v_org, op_a, 15), (v_org, op_b, 50), (v_org, op_b, 52), (v_org, op_c, 31);
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id)
  values (v_org, op_a, 15, 1501402),                      -- Belém/PA
         (v_org, op_b, 52, 5208707),                      -- Goiânia/GO (Campo Grande/MS fora da abrangência)
         (v_org, op_c, 31, 3122306), (v_org, op_c, 31, 3118601);  -- Divinópolis e Contagem/MG

  -- Catálogo do teste e uma regra preventiva só para o modelo de v2.
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'clusters', 'file_name', 's26.xlsx',
         'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Suite26 Corretiva', 'code', 'S26COR'),
                                   jsonb_build_object('row_number', 3, 'name', 'Suite26 Preventiva', 'code', 'S26PRE'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'services', 'file_name', 's26.xlsx',
         'rows', jsonb_build_array(
           jsonb_build_object('row_number', 2, 'cluster', 'Suite26 Corretiva', 'name', 'Suite26 Câmera de ré', 'maintenance_types', 'Corretiva', 'status', 'Ativo'),
           jsonb_build_object('row_number', 3, 'cluster', 'Suite26 Corretiva', 'name', 'Suite26 Multimídia', 'maintenance_types', 'Corretiva', 'status', 'Ativo'),
           jsonb_build_object('row_number', 4, 'cluster', 'Suite26 Corretiva', 'name', 'Suite26 Pastilhas', 'maintenance_types', 'Corretiva', 'status', 'Ativo'),
           jsonb_build_object('row_number', 5, 'cluster', 'Suite26 Corretiva', 'name', 'Suite26 Freio de mão', 'maintenance_types', 'Corretiva', 'status', 'Ativo'),
           jsonb_build_object('row_number', 6, 'cluster', 'Suite26 Preventiva', 'name', 'Suite26 Revisão programada', 'maintenance_types', 'Preventiva', 'status', 'Ativo'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  perform public.maintenance_save_preventive_rule(v_org, jsonb_build_object(
    'vehicle_type_id', v2.vehicle_type_id, 'vehicle_subcategory_id', v2.vehicle_subcategory_id, 'vehicle_model_id', v2.vehicle_model_id,
    'interval_km', 10000, 'initial_km', 0, 'cycle_count', 10, 'alert_before_pct', 10, 'tolerance_after_pct', 5, 'status', 'active'));

  -- Base antiga (sem as colunas Operação e Cidade/UF).
  v_base := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'license_plate', v1.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Câmera de ré', 'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 3, 'license_plate', v1.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Multimídia', 'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 4, 'license_plate', v1.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Pastilhas', 'service_order_number', 'S26-3790', 'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 5, 'license_plate', v1.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Freio de mão', 'supplier', 'Suite26 Prevcenter', 'service_order_number', 'S26-2562',
                       'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 6, 'license_plate', v1.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Freio de mão', 'supplier', 'Suite26 Prevcenter', 'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 7, 'license_plate', v2.license_plate, 'maintenance_type', 'Preventiva', 'cluster', 'Suite26 Preventiva',
                       'service', 'Suite26 Revisão programada', 'preventive_cycle', 'MP2', 'supplier', 'Suite26 Casa da Sprinter',
                       'status', 'Agendado', 'scheduled_date', to_char(v_today + 30, 'YYYY-MM-DD'), 'origin', 'Preventiva Programada'),
    jsonb_build_object('row_number', 8, 'license_plate', v3.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Freio de mão', 'service_order_number', 'S26-500', 'status', 'Concluído', 'origin', 'Checklist',
                       'entry_date', to_char(v_today - 50, 'YYYY-MM-DD'), 'exit_date', to_char(v_today - 50, 'YYYY-MM-DD')),
    jsonb_build_object('row_number', 9, 'license_plate', v3.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Pastilhas', 'service_order_number', 'S26-501', 'status', 'Concluído', 'origin', 'Checklist',
                       'entry_date', to_char(v_today - 40, 'YYYY-MM-DD'), 'exit_date', to_char(v_today - 40, 'YYYY-MM-DD')),
    jsonb_build_object('row_number', 10, 'license_plate', v3.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Câmera de ré', 'service_order_number', 'S26-502', 'status', 'Concluído', 'origin', 'Checklist',
                       'entry_date', to_char(v_today - 30, 'YYYY-MM-DD'), 'exit_date', to_char(v_today - 30, 'YYYY-MM-DD')),
    jsonb_build_object('row_number', 11, 'license_plate', v5.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Multimídia', 'service_order_number', 'S26-901', 'status', 'Há Agendar', 'origin', 'Checklist'),
    jsonb_build_object('row_number', 12, 'license_plate', v5.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Multimídia', 'service_order_number', 'S26-902', 'status', 'Há Agendar', 'origin', 'Checklist'));

  perform set_config('role', 'authenticated', true);
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes_antiga.xlsx', 'rows', v_base));
  k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  perform set_config('role', 'postgres', true);

  select m.id into m_a1 from public.maintenances m join public.maintenance_items i on i.maintenance_id = m.id
   where m.vehicle_id = v1.id and i.service_name_snapshot = 'Suite26 Câmera de ré';
  select id into m_b1 from public.maintenances where vehicle_id = v1.id and service_order_number = 'S26-3790';
  select id into m_b2 from public.maintenances where vehicle_id = v1.id and service_order_number = 'S26-2562';
  select m.id into m_c1 from public.maintenances m join public.maintenance_items i on i.maintenance_id = m.id
   where m.vehicle_id = v1.id and m.service_order_number is null and i.service_name_snapshot = 'Suite26 Freio de mão';
  select m.id into m_p from public.maintenances m where m.vehicle_id = v2.id and m.import_key is not null;
  select id into m_r8 from public.maintenances where vehicle_id = v3.id and service_order_number = 'S26-500';
  select id into m_r9 from public.maintenances where vehicle_id = v3.id and service_order_number = 'S26-501';
  select id into m_r10 from public.maintenances where vehicle_id = v3.id and service_order_number = 'S26-502';
  select count(*) into n_v1 from public.maintenances where vehicle_id = v1.id;
  select count(*) into n_v5 from public.maintenances where vehicle_id = v5.id;

  -- O HFM já tem contexto para S26-501 (outra operação); S26-502 foi
  -- alterada por um usuário depois da importação.
  update public.maintenances set operation_id = op_c, operation_name_snapshot = 'Suite26 Last Mille MG',
         state_id = 31, city_id = 3118601, city_name_snapshot = 'Contagem', state_uf_snapshot = 'MG'
   where id = m_r9;
  perform private.maintenance_log(v_org, m_r10, 'details_updated', null, null, 'Ajuste manual do teste', '{}'::jsonb, 'user');

  -- Arquivo novo: Operação e Cidade/UF; OS apagada nas "Há agendar" de v1;
  -- preventiva de v2 reprogramada; v4 nova; v5 sem OS com duas candidatas.
  v_rows := jsonb_build_array(
    (v_base -> 0) || '{"operation": "suite26 last mille mg", "city": "Divinopolis"}',
    (v_base -> 1) || '{"operation": "suite26 last mille mg", "city": "Divinopolis"}',
    ((v_base -> 2) - 'service_order_number') || '{"operation": "suite26 last mille mg", "city": "Divinopolis"}',
    ((v_base -> 3) - 'service_order_number') || '{"operation": "suite26 last mille mg", "city": "Divinopolis"}',
    (v_base -> 4) || '{"operation": "suite26 last mille mg", "city": "Divinopolis"}',
    (v_base -> 5) || jsonb_build_object('scheduled_date', to_char(v_today + 60, 'YYYY-MM-DD'),
                                      'operation', 'Suite26 Merchandising CO', 'city', 'Goiania'),
    (v_base -> 6) || '{"operation": "Suite26 Redespacho Belem/Pa", "city": "Belém"}',
    (v_base -> 7) || '{"operation": "SUITE26 REDESPACHO BELÉM / PA", "city": "Belém/PA"}',
    (v_base -> 8) || '{"operation": "Suite26 Redespacho Belém - PA", "city": "Belém (PA)"}',
    jsonb_build_object('row_number', 11, 'license_plate', v4.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Pastilhas', 'status', 'Há Agendar', 'origin', 'Checklist',
                       'operation', 'Suite26 Merchandising CO', 'city', 'Campo Grande'),
    jsonb_build_object('row_number', 12, 'license_plate', v5.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite26 Corretiva',
                       'service', 'Suite26 Multimídia', 'status', 'Há Agendar', 'origin', 'Checklist',
                       'operation', 'Suite26 Inexistente', 'city', 'Belém'));

  -- ------------------------------------------------------------------- R1 --
  begin
    perform set_config('role', 'authenticated', true);
    x := jsonb_build_object(
      'div', private.maintenance_import_resolve_context(v_org, 'suite26 last mille mg', 'Divinopolis'),
      'bel', private.maintenance_import_resolve_context(v_org, 'Suite26 Redespacho Belem/Pa', 'Belém'),
      'beluf', private.maintenance_import_resolve_context(v_org, 'Suite26 Redespacho Belém-PA', 'belem / pa'),
      'cg', private.maintenance_import_resolve_context(v_org, 'Suite26 Merchandising CO', 'Campo Grande'),
      'amb', private.maintenance_import_resolve_context(v_org, null, 'Campo Grande'),
      'bsb', private.maintenance_import_resolve_context(v_org, 'Operação que não existe', 'Brasilia'),
      'none', private.maintenance_import_resolve_context(v_org, 'Suite26 Last Mille MG', 'Cidade Inexistente Suite26'));
    perform set_config('role', 'postgres', true);
    ok := (x -> 'div' ->> 'operation_id')::uuid = op_c and (x -> 'div' ->> 'city_id')::int = 3122306
          and x -> 'div' ->> 'operation_city_id' is not null and jsonb_array_length(x -> 'div' -> 'messages') = 0
          and (x -> 'bel' ->> 'operation_id')::uuid = op_a and (x -> 'bel' ->> 'city_id')::int = 1501402
          and (x -> 'beluf' ->> 'operation_id')::uuid = op_a and x -> 'beluf' ->> 'state_uf' = 'PA'
          and (x -> 'cg' ->> 'city_id')::int = 5002704 and x -> 'cg' -> 'messages' -> 0 ->> 'code' = 'city_outside_operation'
          and x -> 'amb' ->> 'city_id' is null and x -> 'amb' -> 'messages' -> 0 ->> 'code' = 'ambiguous_city'
          and x -> 'bsb' ->> 'operation_id' is null and (x -> 'bsb' ->> 'city_id')::int = 5300108
          and x -> 'bsb' -> 'messages' -> 0 ->> 'code' = 'unknown_operation'
          and x -> 'none' ->> 'city_id' is null and x -> 'none' -> 'messages' -> 0 ->> 'code' = 'unknown_city';
    r := r || format('%s R1 resolução: Divinopolis→%s/%s pela abrangência, Belém sem UF→%s, "belem / pa"→%s, Campo Grande→%s (%s), sem operação→%s, Brasilia→%s (%s), inexistente→%s%s',
         case when ok then 'PASS' else 'FAIL' end,
         x -> 'div' ->> 'city_name', x -> 'div' ->> 'state_uf', x -> 'bel' ->> 'state_uf', x -> 'beluf' ->> 'state_uf',
         x -> 'cg' ->> 'state_uf', x -> 'cg' -> 'messages' -> 0 ->> 'code', x -> 'amb' -> 'messages' -> 0 ->> 'code',
         x -> 'bsb' ->> 'state_uf', x -> 'bsb' -> 'messages' -> 0 ->> 'code', x -> 'none' -> 'messages' -> 0 ->> 'code', chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL R1 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C1 --
  begin
    perform set_config('role', 'authenticated', true);
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    perform set_config('role', 'postgres', true);
    c := j -> 'categories';
    ok := (c ->> 'reidentified')::int = 3 and (c ->> 'os_kept')::int = 2 and (c ->> 'rescheduled')::int = 1
          and (c ->> 'context_divergent')::int = 1 and (c ->> 'conflict')::int = 1
          and (c ->> 'unknown_operation')::int = 1 and (c ->> 'ambiguous_city')::int = 1
          and (c ->> 'city_outside_operation')::int = 1 and (c ->> 'reidentify_ambiguous')::int = 1
          and c ->> 'duplicate_in_file' is null
          and (j -> 'summary' ->> 'create_rows')::int = 2 and (j -> 'summary' ->> 'update_rows')::int = 8
          and (j -> 'summary' ->> 'unchanged_rows')::int = 1
          and (j -> 'summary' ->> 'context_fill_rows')::int = 8 and (j -> 'summary' ->> 'reidentified_rows')::int = 3;
    r := r || format('%s C1 prévia: novas=%s, atualizar=%s, sem mudança=%s, contexto a preencher=%s, reidentificadas=%s, categorias=%s%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'summary' ->> 'create_rows', j -> 'summary' ->> 'update_rows',
         j -> 'summary' ->> 'unchanged_rows', j -> 'summary' ->> 'context_fill_rows', j -> 'summary' ->> 'reidentified_rows', c, chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL C1 ' || sqlerrm || chr(10);
  end;

  -- Gravação do arquivo novo (como quem importa).
  begin
    perform set_config('role', 'authenticated', true);
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    perform set_config('role', 'postgres', true);
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL gravação ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C2 --
  begin
    select count(*) into n from public.maintenances where vehicle_id = v1.id;
    ok := n = n_v1
          and (select count(*) from public.maintenance_items where maintenance_id = m_a1) = 2
          and (select service_order_number from public.maintenances where id = m_b1) = 'S26-3790'
          and (select service_order_number from public.maintenances where id = m_b2) = 'S26-2562'
          and (select operation_id from public.maintenances where id = m_b1) = op_c
          and (select city_id from public.maintenances where id = m_b2) = 3122306
          and (select operation_id from public.maintenances where id = m_c1) = op_c
          and exists (select 1 from public.import_rows x where x.batch_id = (j ->> 'batch_id')::uuid and x.row_number = 4
                       and x.status = 'updated' and (x.normalized_data ->> 'existing_id')::uuid = m_b1)
          and exists (select 1 from public.import_rows x where x.batch_id = (j ->> 'batch_id')::uuid and x.row_number = 6
                       and x.status = 'updated' and (x.normalized_data ->> 'existing_id')::uuid = m_b2);
    r := r || format('%s C2 OS apagada em "Há agendar": manutenções de v1 %s→%s, itens da vizinha=%s, OS mantidas %s/%s%s',
         case when ok then 'PASS' else 'FAIL' end, n_v1, n, (select count(*) from public.maintenance_items where maintenance_id = m_a1),
         (select service_order_number from public.maintenances where id = m_b1),
         (select service_order_number from public.maintenances where id = m_b2), chr(10));
  exception when others then r := r || 'FAIL C2 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C3 --
  begin
    select jsonb_build_object('op', m.operation_id, 'city', m.city_id, 'uf', m.state_uf_snapshot, 'src', m.context_source,
                              'name', m.operation_name_snapshot, 'oc', m.operation_city_id) into x
      from public.maintenances m where m.id = m_r8;
    ok := (x ->> 'op')::uuid = op_a and (x ->> 'city')::int = 1501402 and x ->> 'uf' = 'PA' and x ->> 'src' = 'none'
          and x ->> 'oc' is not null
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_r8 and e.event_type = 'import_updated'
                       and e.payload ->> 'change' = 'context_filled' and e.payload ->> 'context_source' = 'import'
                       and e.actor_user_id = v_uid and e.source = 'import');
    r := r || format('%s C3 existente sem operação: %s — %s/%s, context_source=%s, evento context_filled do importador%s',
         case when ok then 'PASS' else 'FAIL' end, x ->> 'name',
         (select city_name_snapshot from public.maintenances where id = m_r8), x ->> 'uf', x ->> 'src', chr(10));
  exception when others then r := r || 'FAIL C3 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C4 --
  begin
    ok := (select operation_id from public.maintenances where id = m_r9) = op_c
          and (select city_id from public.maintenances where id = m_r9) = 3118601
          and exists (select 1 from public.import_errors e where e.batch_id = (j ->> 'batch_id')::uuid and e.row_number = 9
                       and e.code = 'context_divergent' and e.message like 'Contexto divergente: mantido o do HFM (Suite26 Last Mille MG%')
          and not exists (select 1 from public.maintenance_events e where e.maintenance_id = m_r9 and e.event_type = 'import_updated');
    r := r || format('%s C4 contexto divergente: mantido %s; aviso "%s"%s',
         case when ok then 'PASS' else 'FAIL' end, (select operation_name_snapshot from public.maintenances where id = m_r9),
         (select e.message from public.import_errors e where e.batch_id = (j ->> 'batch_id')::uuid and e.row_number = 9
           and e.code = 'context_divergent' limit 1), chr(10));
  exception when others then r := r || 'FAIL C4 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C5 --
  begin
    ok := (select operation_id from public.maintenances where id = m_r10) = op_a
          and (select status from public.maintenances where id = m_r10) = 'completed'
          and (select count(*) from public.maintenance_events e where e.maintenance_id = m_r10 and e.source = 'import'
                and e.event_type = 'import_updated') = 1;
    r := r || format('%s C5 alterada por usuário: só o contexto vazio preenchido (%s), situação %s%s',
         case when ok then 'PASS' else 'FAIL' end, (select operation_name_snapshot from public.maintenances where id = m_r10),
         (select status from public.maintenances where id = m_r10), chr(10));
  exception when others then r := r || 'FAIL C5 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C6 --
  begin
    select id into m_new from public.maintenances where vehicle_id = v4.id and import_batch_id = (j ->> 'batch_id')::uuid;
    ok := m_new is not null
          and (select operation_id from public.maintenances where id = m_new) = op_b
          and (select city_id from public.maintenances where id = m_new) = 5002704
          and (select state_uf_snapshot from public.maintenances where id = m_new) = 'MS'
          and (select context_source from public.maintenances where id = m_new) = 'none'
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_new and e.event_type = 'imported'
                       and e.payload -> 'context_from_sheet' ->> 'context_source' = 'import')
          and exists (select 1 from public.import_rows x where x.batch_id = (j ->> 'batch_id')::uuid and x.row_number = 11
                       and x.status = 'created' and x.normalized_data ->> 'context_applied' = 'sheet');
    r := r || format('%s C6 nova sem contexto oficial: %s — %s/%s (origem planilha no evento imported)%s',
         case when ok then 'PASS' else 'FAIL' end, (select operation_name_snapshot from public.maintenances where id = m_new),
         (select city_name_snapshot from public.maintenances where id = m_new),
         (select state_uf_snapshot from public.maintenances where id = m_new), chr(10));
  exception when others then r := r || 'FAIL C6 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C7 --
  begin
    select count(*) into n from public.maintenances where vehicle_id = v2.id;
    ok := n = 1
          and (select scheduled_date from public.maintenances where id = m_p) = v_today + 60
          and (select status from public.maintenances where id = m_p) = 'scheduled'
          and (select import_key from public.maintenances where id = m_p)
              = (select x.normalized_data ->> 'file_group_key' from public.import_rows x
                  where x.batch_id = (j ->> 'batch_id')::uuid and x.row_number = 7)
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_p and e.event_type = 'rescheduled'
                       and e.source = 'import' and (e.payload -> 'before' ->> 'scheduled_date')::date = v_today + 30
                       and (e.payload -> 'after' ->> 'scheduled_date')::date = v_today + 60)
          and (select c2.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c2 on c2.id = m.preventive_cycle_id
                where m.id = m_p) = 2
          and (select operation_id from public.maintenances where id = m_p) = op_b;
    r := r || format('%s C7 preventiva reprogramada: manutenções de v2=%s, agendada para %s, evento rescheduled (importação), chave movida%s',
         case when ok then 'PASS' else 'FAIL' end, n,
         to_char((select scheduled_date from public.maintenances where id = m_p), 'DD/MM/YYYY'), chr(10));
  exception when others then r := r || 'FAIL C7 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C8 --
  begin
    select count(*) into n from public.maintenances where vehicle_id = v5.id;
    ok := n = n_v5 + 1
          and exists (select 1 from public.import_errors e where e.batch_id = (j ->> 'batch_id')::uuid and e.row_number = 12
                       and e.code = 'reidentify_ambiguous' and e.message like '%MAN-%, MAN-%')
          and (select operation_id from public.maintenances where vehicle_id = v5.id and import_batch_id = (j ->> 'batch_id')::uuid) is null;
    r := r || format('%s C8 duas candidatas: aviso com as duas, linha criada como antes (manutenções de v5 %s→%s)%s',
         case when ok then 'PASS' else 'FAIL' end, n_v5, n, chr(10));
  exception when others then r := r || 'FAIL C8 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- C9 --
  begin
    select count(*) into n from public.maintenances where organization_id = v_org;
    select count(*) into n_ev from public.maintenance_events e
      join public.maintenances m on m.id = e.maintenance_id where m.vehicle_id in (v1.id, v2.id, v3.id, v4.id, v5.id);
    perform set_config('role', 'authenticated', true);
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    perform set_config('role', 'postgres', true);
    select count(*) into n2 from public.maintenances where organization_id = v_org;
    ok := coalesce((j -> 'summary' ->> 'create_rows')::int, 0) = 0 and coalesce((j -> 'summary' ->> 'update_rows')::int, 0) = 0
          and coalesce((k ->> 'created_rows')::int, 0) = 0 and coalesce((k ->> 'updated_rows')::int, 0) = 0
          and n2 = n
          and (select count(*) from public.maintenance_events e join public.maintenances m on m.id = e.maintenance_id
                where m.vehicle_id in (v1.id, v2.id, v3.id, v4.id, v5.id)) = n_ev;
    r := r || format('%s C9 o mesmo arquivo de novo: novas=%s, atualizar=%s, gravadas=%s/%s, manutenções %s→%s, eventos %s→%s%s',
         case when ok then 'PASS' else 'FAIL' end, coalesce(j -> 'summary' ->> 'create_rows', '0'), coalesce(j -> 'summary' ->> 'update_rows', '0'),
         coalesce(k ->> 'created_rows', '0'), coalesce(k ->> 'updated_rows', '0'), n, n2, n_ev,
         (select count(*) from public.maintenance_events e join public.maintenances m on m.id = e.maintenance_id
           where m.vehicle_id in (v1.id, v2.id, v3.id, v4.id, v5.id)), chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL C9 ' || sqlerrm || chr(10);
  end;

  raise notice '%', r;
  raise exception 'ROLLBACK_TESTES %', r;
end $t$;
