-- =============================================================================
-- 23 · Importação da Manutenção — o lote certo e os layouts das bases reais
--
-- Migration 20261001100000_maintenance_import_layouts. Suíte contra o banco
-- COM DADOS; tudo é desfeito no fim (`raise exception 'ROLLBACK_TESTES …'`).
-- Os cadastros usados aqui têm prefixo "Suite23" e somem com o rollback.
--
--   L1  Cadastro em partes como a tela faz: carga com "kind", validação e
--       prévia SEM "kind" — antes caía em "Esta importação não está mais
--       aberta" — e gravação
--   L2  Reimportar clusters: descrição atualizada, código e criticidade mantidos
--   L3  Serviços no layout 09: Categoria = cluster, "Não se aplica" = sem tipo,
--       Preditiva liga o serviço preditivo, Status, outros nomes
--   L4  Fornecedores no layout 07: código externo, categoria, tipo, pagamento
--       ("-" = vazio), validação; CNPJ inválido e CNPJ repetido entram sem
--       documento (aviso); nome repetido é erro; CNPJ não renomeia ninguém
--   L5  Parâmetros no layout 08: subcategoria no lugar do tipo e do modelo,
--       "—" = vazio, criticidade e situação
--   L6  Manutenções no layout 10: fornecedor pela forma canônica, pelo outro
--       nome e pela parte antes de "|"; fornecedor desconhecido guarda o nome;
--       cluster divergente vale o cadastro; serviço pelo nome antigo; KM com
--       decimais; agendado com data futura; saída antes da entrada é erro;
--       serviço repetido na entrada vira aviso; situações misturadas deixam a
--       manutenção na menos avançada
--   L7  Reimportar depois do de-para liga o fornecedor e limpa o nome informado
--   L8  Nada é criado por fora: nem veículo, nem serviço, nem fornecedor
-- =============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from public.organization_memberships m
                             where m.organization_id = (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1)
                               and m.status = 'active' limit 1), 'role', 'authenticated')::text, true);
do $t$
declare
  v_org uuid; v_today date; v_veh record; v_caminhao uuid; v_toco uuid; v_van uuid; v_sub105 uuid;
  j jsonb; k jsonb; v_batch uuid; v_rows jsonb; n int; n2 int; ok boolean; txt text;
  c_fre uuid; c_ele uuid; s_pas uuid; s_cam uuid; v_sup_a uuid; v_sup_b uuid; v_m record; v_m2 record;
  n_veh int; n_srv int; n_sup int;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  v_today := private.maintenance_today(v_org);
  select v.id, v.license_plate, v.fleet_code into v_veh from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null order by v.fleet_code limit 1;
  select t.id, s.id into v_caminhao, v_toco from public.vehicle_subcategories s join public.vehicle_types t on t.id = s.vehicle_type_id
   where (t.organization_id = v_org or t.organization_id is null) and t.deleted_at is null and s.deleted_at is null
     and t.name = 'Caminhão' and s.name = 'Toco' limit 1;
  select t.id, s.id into v_van, v_sub105 from public.vehicle_subcategories s join public.vehicle_types t on t.id = s.vehicle_type_id
   where (t.organization_id = v_org or t.organization_id is null) and t.deleted_at is null and s.deleted_at is null
     and t.name = 'Van' and s.name = '10,5 m³' limit 1;
  if v_veh.id is null or v_toco is null or v_sub105 is null then
    raise exception 'FIXTURE incompleta: veículo=% toco=% 10,5=%', v_veh.id, v_toco, v_sub105;
  end if;
  select count(*) into n_veh from public.vehicles where organization_id = v_org;

  -- ------------------------------------------------------------------- L1 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'load', 'kind', 'clusters', 'file_name', '06_Clusters.xlsx',
           'rows', jsonb_build_array(
             jsonb_build_object('row_number', 2, 'name', 'Suite23 Freios', 'code', 'S23FRE', 'description', 'Lonas, pastilhas', 'criticality', 'Alta'),
             jsonb_build_object('row_number', 3, 'name', 'Suite23 Elétrica', 'code', 'S23ELE', 'description', 'Bateria', 'criticality', 'Média'),
             jsonb_build_object('row_number', 4, 'name', 'Suite23 Preventiva', 'code', 'S23PRE', 'criticality', 'Média'))));
    v_batch := (j ->> 'batch_id')::uuid;
    k := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', v_batch, 'limit', 2));
    ok := (k ->> 'pending')::int = 1;
    k := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', v_batch, 'limit', 2));
    ok := ok and (k ->> 'pending')::int = 0;
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'finalize', 'batch_id', v_batch));
    ok := ok and j ->> 'kind' = 'clusters' and (j ->> 'valid_rows')::int = 3;
    k := public.process_maintenance_import(v_org, v_batch, 2);
    k := public.process_maintenance_import(v_org, v_batch, 2);
    select id into c_fre from public.maintenance_clusters where organization_id = v_org and code = 'S23FRE' and deleted_at is null;
    select id into c_ele from public.maintenance_clusters where organization_id = v_org and code = 'S23ELE' and deleted_at is null;
    ok := ok and (k ->> 'done')::boolean and (k ->> 'created_rows')::int = 3 and c_fre is not null
          and (select default_criticality from public.maintenance_clusters where id = c_fre) = 'high';
    r := r || format('%s L1 clusters em partes (validação e prévia sem kind): base=%s, válidas=%s, criadas=%s%s',
         case when ok then 'PASS' else 'FAIL' end, j ->> 'kind', j ->> 'valid_rows', k ->> 'created_rows', chr(10));
  exception when others then r := r || 'FAIL L1 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L2 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'clusters', 'file_name', '06_Clusters.xlsx',
           'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Suite23 Freios', 'code', 'OUTRO', 'description', 'Sistema de freios'))));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := (j -> 'summary' ->> 'update_rows')::int = 1
          and (select code = 'S23FRE' and description = 'Sistema de freios' and default_criticality = 'high'
                 from public.maintenance_clusters where id = c_fre);
    r := r || format('%s L2 reimportar cluster: atualiza a descrição, mantém código S23FRE e criticidade alta%s',
         case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL L2 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L3 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'services', 'file_name', '09_Servicos.xlsx',
           'rows', jsonb_build_array(
             jsonb_build_object('row_number', 2, 'cluster', 'Suite23 Freios', 'name', 'Suite23 Substituição de pastilhas', 'maintenance_types', 'Corretiva', 'criticality', 'Crítica', 'status', 'Ativo'),
             jsonb_build_object('row_number', 3, 'cluster', 'Suite23 Elétrica', 'name', 'Suite23 Câmera de ré', 'maintenance_types', 'Não se aplica', 'criticality', 'Alta', 'status', 'Ativo',
                                'alias_names', 'Suite23 Instalação de câmera; Suite23 Câmera antiga'),
             jsonb_build_object('row_number', 4, 'cluster', 'Suite23 Elétrica', 'name', 'Suite23 Inspeção preditiva elétrica', 'maintenance_types', 'Preditiva', 'criticality', 'Baixa', 'status', 'Ativo'),
             jsonb_build_object('row_number', 5, 'cluster', 'Suite23 Preventiva', 'name', 'Suite23 Revisão programada', 'maintenance_types', 'Preventiva', 'status', 'Ativo'))));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select id into s_pas from public.maintenance_services where organization_id = v_org and name = 'Suite23 Substituição de pastilhas' and deleted_at is null;
    select id into s_cam from public.maintenance_services where organization_id = v_org and name = 'Suite23 Câmera de ré' and deleted_at is null;
    ok := (k ->> 'created_rows')::int = 4
          and (select criticality = 'critical' and maintenance_type_codes = '{corrective}' and not is_predictive from public.maintenance_services where id = s_pas)
          and (select maintenance_type_codes = '{}' and alias_names = '{"Suite23 Câmera antiga","Suite23 Instalação de câmera"}' from public.maintenance_services where id = s_cam)
          and (select is_predictive from public.maintenance_services where organization_id = v_org and name = 'Suite23 Inspeção preditiva elétrica' and deleted_at is null);
    r := r || format('%s L3 serviços no layout 09: criados=%s, "Não se aplica" sem tipo, Preditiva liga preditivo, outros nomes gravados%s',
         case when ok then 'PASS' else 'FAIL' end, k ->> 'created_rows', chr(10));
  exception when others then r := r || 'FAIL L3 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L4 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'suppliers', 'file_name', '07_Fornecedores.xlsx',
           'rows', jsonb_build_array(
             jsonb_build_object('row_number', 2, 'external_code', '239031', 'name', 'Suite23 Mecanica Cristo Rei Ltda', 'document_number', '71.299.614/0001-64',
                                'category', 'Mecanica', 'service_type', 'Revisões Preventivas e Corretivas', 'payment_terms', '15 Dias', 'financial_validation', 'OK'),
             jsonb_build_object('row_number', 3, 'name', 'Suite23 Fast Tire', 'document_number', 'Borracharia', 'category', 'Concertos e Montagem de Pneus'),
             jsonb_build_object('row_number', 4, 'name', 'Suite23 GP Pneus - Eldorado Contagem', 'document_number', '46.378.127/0024-36', 'payment_terms', '-'),
             jsonb_build_object('row_number', 5, 'name', 'Suite23 GP Pneus Contagem', 'document_number', '46.378.127/0024-36'),
             jsonb_build_object('row_number', 6, 'name', 'Suite23 Minas Maquinas Sa - Nova Lima Mg', 'document_number', '17.161.241/0014-30'),
             jsonb_build_object('row_number', 7, 'name', 'Suite23 Fabio Alves Prates', 'document_number', '58.595.014/0001-85'),
             jsonb_build_object('row_number', 8, 'name', 'Suite23 Referência Centro Automotivo', 'document_number', '57.466.320/0001-59'),
             jsonb_build_object('row_number', 9, 'name', 'Suite23 Referencia Centro Automotivo', 'document_number', '57.466.320/0001-59'))));
    ok := (j -> 'categories' ->> 'invalid_document')::int = 1 and (j -> 'categories' ->> 'duplicate_document')::int >= 1
          and (j -> 'categories' ->> 'duplicate_in_file')::int = 1 and (j ->> 'error_rows')::int = 1;
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := ok and (k ->> 'created_rows')::int = 7
          and (select external_code = '239031' and category = 'Mecanica' and payment_terms = '15 Dias' and financial_validation = 'OK'
                      and document_number = '71299614000164'
                 from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Mecanica Cristo Rei Ltda' and deleted_at is null)
          and (select document_number is null from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Fast Tire' and deleted_at is null)
          and (select payment_terms is null and document_number = '46378127002436' from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 GP Pneus - Eldorado Contagem' and deleted_at is null)
          and (select document_number is null from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 GP Pneus Contagem' and deleted_at is null);
    -- Um arquivo novo com outro nome e o mesmo CNPJ não renomeia o existente.
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'suppliers', 'file_name', '07b.xlsx',
           'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Suite23 Cristo Rei Filial', 'document_number', '71.299.614/0001-64'))));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := ok and exists (select 1 from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Mecanica Cristo Rei Ltda' and deleted_at is null)
          and (select document_number is null from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Cristo Rei Filial' and deleted_at is null);
    r := r || format('%s L4 fornecedores no layout 07: campos novos gravados, CNPJ inválido/repetido sem documento, nome repetido barrado, CNPJ não renomeia%s',
         case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL L4 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L5 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'preventive_rules', 'file_name', '08_Parametros.xlsx',
           'rows', jsonb_build_array(
             jsonb_build_object('row_number', 2, 'vehicle_type', 'Toco', 'model', '—', 'interval_km', '30000', 'initial_km', '0', 'cycle_count', '20',
                                'alert_before_pct', '5', 'tolerance_after_pct', '5', 'criticality', 'Alta', 'status', 'ativo'),
             jsonb_build_object('row_number', 3, 'vehicle_type', 'Van', 'model', '10,5 m³', 'interval_km', '20000', 'initial_km', '0', 'cycle_count', '25',
                                'alert_before_pct', '5', 'tolerance_after_pct', '5', 'criticality', 'Crítica', 'status', 'ativo'))));
    ok := (j ->> 'error_rows')::int = 0 and (j -> 'categories' ->> 'type_from_subcategory')::int = 1
          and (j -> 'categories' ->> 'model_is_subcategory')::int = 1;
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := ok and (k -> 'summary' ->> 'failed_rows')::int = 0
          and exists (select 1 from public.maintenance_preventive_rules where organization_id = v_org and deleted_at is null
                        and vehicle_type_id = v_caminhao and vehicle_subcategory_id = v_toco and vehicle_model_id is null
                        and interval_km = 30000 and criticality = 'high' and status = 'active')
          and exists (select 1 from public.maintenance_preventive_rules where organization_id = v_org and deleted_at is null
                        and vehicle_type_id = v_van and vehicle_subcategory_id = v_sub105 and cycle_count = 25 and criticality = 'critical');
    r := r || format('%s L5 parâmetros no layout 08: Toco → Caminhão/Toco, "10,5 m³" → subcategoria da Van, "—" vazio, criticidade%s',
         case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL L5 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L6 --
  begin
    select id into v_sup_a from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Minas Maquinas Sa - Nova Lima Mg' and deleted_at is null;
    update public.maintenance_suppliers set alias_names = '{"Suite23 Minas Maquinas Nova Lima"}' where id = v_sup_a;
    select count(*) into n_srv from public.maintenance_services where organization_id = v_org;
    select count(*) into n_sup from public.maintenance_suppliers where organization_id = v_org;
    v_rows := jsonb_build_array(
      -- 2–3: mesma entrada (Cristo Rei pela forma canônica), cluster divergente vale o cadastro, KM com decimais
      jsonb_build_object('row_number', 2, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Substituição de pastilhas', 'supplier', 'Suite23 Mecânica Cristo Rei', 'status', 'Concluído',
                         'scheduled_date', to_char(v_today - 40, 'DD/MM/YYYY'), 'entry_date', to_char(v_today - 40, 'DD/MM/YYYY'), 'entry_time', '08:00:00',
                         'exit_date', to_char(v_today - 39, 'DD/MM/YYYY'), 'exit_time', '15:00:00', 'entry_km', '148398.88', 'origin', 'Checklist'),
      jsonb_build_object('row_number', 3, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Instalação de câmera', 'supplier', 'Suite23 Mecânica Cristo Rei', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 40, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 38, 'DD/MM/YYYY'), 'exit_time', '10:00:00',
                         'origin', 'Relato Motorista'),
      -- 4: outro nome do fornecedor
      jsonb_build_object('row_number', 4, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Substituição de pastilhas', 'supplier', 'Suite23 Minas Maquinas Nova Lima', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 30, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 30, 'DD/MM/YYYY')),
      -- 5: parte antes de "|"
      jsonb_build_object('row_number', 5, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Elétrica',
                         'service', 'Suite23 Câmera de ré', 'supplier', 'Suite23 Fabio Alves Prates | SKY Tracker', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 20, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 20, 'DD/MM/YYYY')),
      -- 6: fornecedor desconhecido
      jsonb_build_object('row_number', 6, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Elétrica',
                         'service', 'Suite23 Câmera de ré', 'supplier', 'Suite23 Oficina Sem Cadastro', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 15, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 14, 'DD/MM/YYYY')),
      -- 7: agendado com entrada prevista no futuro
      jsonb_build_object('row_number', 7, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Elétrica',
                         'service', 'Suite23 Câmera de ré', 'supplier', 'Suite23 Mecânica Cristo Rei', 'status', 'Agendado',
                         'scheduled_date', to_char(v_today + 3, 'DD/MM/YYYY'), 'entry_date', to_char(v_today + 3, 'DD/MM/YYYY')),
      -- 8: saída antes da entrada (erro)
      jsonb_build_object('row_number', 8, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Substituição de pastilhas', 'supplier', 'Suite23 Mecânica Cristo Rei', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 10, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 12, 'DD/MM/YYYY')),
      -- 9: serviço repetido na entrada das linhas 2–3 (aviso, sem item novo)
      jsonb_build_object('row_number', 9, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Substituição de pastilhas', 'supplier', 'Suite23 Mecânica Cristo Rei', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 40, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 39, 'DD/MM/YYYY')),
      -- 10–11: mesma entrada com situações diferentes
      jsonb_build_object('row_number', 10, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Freios',
                         'service', 'Suite23 Substituição de pastilhas', 'supplier', 'Suite23 GP Pneus Contagem', 'status', 'Concluído',
                         'entry_date', to_char(v_today - 5, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 4, 'DD/MM/YYYY')),
      jsonb_build_object('row_number', 11, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'cluster', 'Suite23 Elétrica',
                         'service', 'Suite23 Câmera de ré', 'supplier', 'Suite23 GP Pneus Contagem', 'status', 'Em Execução',
                         'entry_date', to_char(v_today - 5, 'DD/MM/YYYY')),
      -- 12: placa desconhecida (erro, nada criado)
      jsonb_build_object('row_number', 12, 'license_plate', 'ZZZ9Z23', 'maintenance_type', 'Corretiva', 'service', 'Suite23 Câmera de ré',
                         'status', 'Concluído', 'entry_date', to_char(v_today - 3, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 3, 'DD/MM/YYYY')),
      -- 13: serviço fora do catálogo (erro, nada criado)
      jsonb_build_object('row_number', 13, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Corretiva', 'service', 'Suite23 Serviço inexistente',
                         'status', 'Concluído', 'entry_date', to_char(v_today - 3, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 3, 'DD/MM/YYYY')));
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'load', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx',
           'file_hash', md5('suite23-records') || md5('suite23-records-b'), 'rows', v_rows));
    v_batch := (j ->> 'batch_id')::uuid;
    k := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', v_batch, 'limit', 5));
    k := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'validate', 'batch_id', v_batch, 'limit', 50));
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'finalize', 'batch_id', v_batch));
    ok := (j ->> 'error_rows')::int = 3
          and (j -> 'categories' ->> 'exit_before_entry')::int = 1 and (j -> 'categories' ->> 'unknown_vehicle')::int = 1
          and (j -> 'categories' ->> 'unknown_service')::int = 1 and (j -> 'categories' ->> 'unknown_supplier')::int = 1
          and (j -> 'categories' ->> 'cluster_mismatch')::int = 1 and (j -> 'categories' ->> 'duplicate_in_file')::int = 1
          and (j -> 'categories' ->> 'group_status_mixed')::int >= 1 and (j -> 'categories' ->> 'future_fact') is null
          and j -> 'summary' -> 'unknown_suppliers' -> 0 ->> 'name' = 'Suite23 Oficina Sem Cadastro';
    txt := format('prévia: erros=%s, categorias=%s; ', j ->> 'error_rows', j -> 'categories');
    k := public.process_maintenance_import(v_org, v_batch, 2);
    k := public.process_maintenance_import(v_org, v_batch, 50);
    ok := ok and (k ->> 'done')::boolean;
    -- Linhas 2–3: uma manutenção, fornecedor Cristo Rei, dois itens (câmera no cluster do cadastro), KM 148398, saída = a última.
    select m.* into v_m from public.maintenances m where m.import_batch_id = v_batch and m.entry_date = v_today - 40;
    ok := ok and v_m.supplier_id = (select id from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Mecanica Cristo Rei Ltda' and deleted_at is null)
          and v_m.entry_km = 148398 and v_m.exit_date = v_today - 38
          and (select count(*) from public.maintenance_items i where i.maintenance_id = v_m.id) = 2
          and exists (select 1 from public.maintenance_items i where i.maintenance_id = v_m.id and i.service_id = s_cam and i.cluster_id = c_ele);
    txt := txt || format('entrada 2–3: itens=%s, KM=%s, saída=%s; ', (select count(*) from public.maintenance_items i where i.maintenance_id = v_m.id), v_m.entry_km, v_m.exit_date);
    ok := ok and (select supplier_id = v_sup_a from public.maintenances where import_batch_id = v_batch and entry_date = v_today - 30)
          and (select supplier_id is not null from public.maintenances where import_batch_id = v_batch and entry_date = v_today - 20)
          and (select supplier_id is null and supplier_name_informed = 'Suite23 Oficina Sem Cadastro'
                 from public.maintenances where import_batch_id = v_batch and entry_date = v_today - 15)
          and (select status = 'scheduled' and scheduled_date = v_today + 3 and entry_date is null
                 from public.maintenances where import_batch_id = v_batch and scheduled_date = v_today + 3);
    select m.* into v_m2 from public.maintenances m where m.import_batch_id = v_batch and m.context_date = v_today - 5;
    ok := ok and v_m2.status = 'in_progress' and v_m2.exit_date is null
          and (select count(*) filter (where status = 'done') = 1 and count(*) filter (where status = 'pending') = 1
                 from public.maintenance_items where maintenance_id = v_m2.id);
    txt := txt || format('situações misturadas → %s', v_m2.status);
    r := r || format('%s L6 manutenções no layout 10: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL L6 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L7 --
  begin
    select id into v_sup_b from public.maintenance_suppliers where organization_id = v_org and name = 'Suite23 Fast Tire' and deleted_at is null;
    perform public.maintenance_save_supplier(v_org, private.maintenance_import_merge('suppliers', v_sup_b,
              jsonb_build_object('alias_names', jsonb_build_array('Suite23 Oficina Sem Cadastro'))));
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx',
           'file_hash', md5('suite23-records') || md5('suite23-records-b'), 'rows', v_rows));
    ok := (j -> 'summary' ->> 'update_rows')::int >= 1 and (j -> 'summary' ->> 'unchanged_rows')::int >= 5;
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := ok and (select supplier_id = v_sup_b and supplier_name_informed is null
                    from public.maintenances where organization_id = v_org and entry_date = v_today - 15 and supplier_id = v_sup_b)
          and (select count(*) from public.maintenances where organization_id = v_org and entry_date = v_today - 15
                 and license_plate_snapshot = v_veh.license_plate) = 1;
    r := r || format('%s L7 reimportar depois do de-para: atualizações=%s, sem mudança=%s, fornecedor ligado sem duplicar a manutenção%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'summary' ->> 'update_rows', j -> 'summary' ->> 'unchanged_rows', chr(10));
  exception when others then r := r || 'FAIL L7 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- L8 --
  begin
    ok := (select count(*) from public.vehicles where organization_id = v_org) = n_veh
          and (select count(*) from public.maintenance_services where organization_id = v_org) = n_srv
          and (select count(*) from public.maintenance_suppliers where organization_id = v_org) = n_sup
          and not exists (select 1 from public.vehicles where license_plate = 'ZZZ9Z23');
    r := r || format('%s L8 a base de manutenções não cria veículo, serviço nem fornecedor%s', case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL L8 ' || sqlerrm || chr(10);
  end;

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end;
$t$;
