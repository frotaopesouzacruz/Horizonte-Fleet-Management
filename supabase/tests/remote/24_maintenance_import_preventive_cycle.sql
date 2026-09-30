-- =============================================================================
-- 24 · Importação da Manutenção — ciclo preventivo em manutenções que já existem
--
-- Migration 20261001110000_maintenance_import_preventive_cycle. Suíte contra o
-- banco COM DADOS; tudo é desfeito no fim (`raise exception 'ROLLBACK_TESTES …'`).
-- Os cadastros usados aqui têm prefixo "Suite24" e somem com o rollback.
--
--   P1  Base importada sem a coluna "Ciclo Preventivo": entra sem vínculo
--   P2  A mesma planilha com MP1/MP2: a validação vê a mudança (atualizar, não
--       "sem mudança"), a gravação vincula e realiza os ciclos
--   P3  Reimportar igual: sem mudança, nada gravado
--   P4  MPs trocados entre duas manutenções: cada ciclo fica realizado pela
--       manutenção que o arquivo aponta — nenhum fica aberto por engano
--   P5  Fornecedor reescrito na planilha, mesma OS: a manutenção é atualizada
--       (reconhecida pela OS), não duplicada
--   P6  MP além da regra do veículo: a linha entra com aviso e sem vínculo
-- =============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from public.organization_memberships m
                             where m.organization_id = (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1)
                               and m.status = 'active' limit 1), 'role', 'authenticated')::text, true);
do $t$
declare
  v_org uuid; v_today date; v_veh record; j jsonb; k jsonb; v_rows jsonb; ok boolean;
  m1 uuid; m2 uuid; c1 record; c2 record; n int; n_before int;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  v_today := private.maintenance_today(v_org);
  select v.id, v.license_plate, v.vehicle_type_id, v.vehicle_subcategory_id into v_veh from public.vehicles v
   where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null order by v.fleet_code limit 1;

  -- Catálogo e uma regra preventiva só para o veículo do teste (modelo exato
  -- vence qualquer regra da organização): 10.000 km, 4 ciclos.
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'clusters', 'file_name', 's24.xlsx',
         'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Suite24 Preventiva', 'code', 'S24PRE'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'services', 'file_name', 's24.xlsx',
         'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'cluster', 'Suite24 Preventiva', 'name', 'Suite24 Revisão programada',
                                                      'maintenance_types', 'Preventiva', 'status', 'Ativo'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  perform public.maintenance_save_preventive_rule(v_org, jsonb_build_object(
    'vehicle_type_id', v_veh.vehicle_type_id, 'vehicle_subcategory_id', v_veh.vehicle_subcategory_id,
    'vehicle_model_id', (select vehicle_model_id from public.vehicles where id = v_veh.id),
    'interval_km', 10000, 'initial_km', 0, 'cycle_count', 4, 'alert_before_pct', 10, 'tolerance_after_pct', 5, 'status', 'active'));

  v_rows := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Preventiva',
                       'cluster', 'Suite24 Preventiva', 'service', 'Suite24 Revisão programada', 'supplier', 'Suite24 Oficina Centro',
                       'service_order_number', 'S24-100', 'status', 'Concluído', 'origin', 'Checklist',
                       'entry_date', to_char(v_today - 200, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 200, 'DD/MM/YYYY'), 'entry_km', '10050'),
    jsonb_build_object('row_number', 3, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Preventiva',
                       'cluster', 'Suite24 Preventiva', 'service', 'Suite24 Revisão programada', 'supplier', 'Suite24 Oficina Centro',
                       'service_order_number', 'S24-200', 'status', 'Concluído', 'origin', 'Checklist',
                       'entry_date', to_char(v_today - 100, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 100, 'DD/MM/YYYY'), 'entry_km', '20100'));

  -- ------------------------------------------------------------------- P1 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select id into m1 from public.maintenances where organization_id = v_org and service_order_number = 'S24-100';
    select id into m2 from public.maintenances where organization_id = v_org and service_order_number = 'S24-200';
    ok := (k ->> 'created_rows')::int = 2 and (j -> 'categories' ->> 'no_cycle')::int = 2
          and (select preventive_cycle_id from public.maintenances where id = m1) is null;
    r := r || format('%s P1 base sem ciclo: criadas=%s, sem MP=%s, sem vínculo%s',
         case when ok then 'PASS' else 'FAIL' end, k ->> 'created_rows', j -> 'categories' ->> 'no_cycle', chr(10));
  exception when others then r := r || 'FAIL P1 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P2 --
  begin
    v_rows := jsonb_set(jsonb_set(v_rows, '{0,preventive_cycle}', '"MP1"'), '{1,preventive_cycle}', '"MP2"');
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select c.cycle_number, c.completed_on, c.completed_maintenance_id, c.completion_source into c1
      from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m1;
    select c.cycle_number, c.completed_on, c.completed_maintenance_id, c.completion_source into c2
      from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m2;
    ok := (j -> 'summary' ->> 'update_rows')::int = 2 and coalesce((j -> 'summary' ->> 'unchanged_rows')::int, 0) = 0
          and (k ->> 'updated_rows')::int = 2
          and c1.cycle_number = 1 and c1.completed_maintenance_id = m1 and c1.completion_source = 'import'
          and c1.completed_on = v_today - 200
          and c2.cycle_number = 2 and c2.completed_maintenance_id = m2
          and (select count(*) from public.maintenance_events e where e.maintenance_id in (m1, m2) and e.event_type = 'preventive_updated') = 2
          and (select count(*) from public.maintenances where organization_id = v_org and service_order_number like 'S24-%') = 2;
    r := r || format('%s P2 mesma planilha com MP1/MP2: atualizar=%s, gravadas=%s, MP%s por %s, MP%s por %s%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'summary' ->> 'update_rows', k ->> 'updated_rows',
         c1.cycle_number, case when c1.completed_maintenance_id = m1 then 'm1' else '?' end,
         c2.cycle_number, case when c2.completed_maintenance_id = m2 then 'm2' else '?' end, chr(10));
  exception when others then r := r || 'FAIL P2 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P3 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := (j -> 'summary' ->> 'unchanged_rows')::int = 2 and coalesce((j -> 'summary' ->> 'update_rows')::int, 0) = 0
          and coalesce((k ->> 'updated_rows')::int, 0) = 0 and coalesce((k ->> 'created_rows')::int, 0) = 0;
    r := r || format('%s P3 reimportar igual: sem mudança=%s, gravadas=%s%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'summary' ->> 'unchanged_rows', coalesce(k ->> 'updated_rows', '0'), chr(10));
  exception when others then r := r || 'FAIL P3 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P4 --
  begin
    v_rows := jsonb_set(jsonb_set(v_rows, '{0,preventive_cycle}', '"MP2"'), '{1,preventive_cycle}', '"MP1"');
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select c.cycle_number, c.completed_maintenance_id into c1
      from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m1;
    select c.cycle_number, c.completed_maintenance_id into c2
      from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m2;
    ok := c1.cycle_number = 2 and c1.completed_maintenance_id = m1 and c2.cycle_number = 1 and c2.completed_maintenance_id = m2
          and not exists (select 1 from public.maintenance_preventive_cycles c
                           where c.vehicle_id = v_veh.id and c.cycle_number in (1, 2) and c.completed_on is null);
    r := r || format('%s P4 MPs trocados: m1→MP%s (realizado por %s), m2→MP%s (realizado por %s), nenhum MP1/MP2 aberto%s',
         case when ok then 'PASS' else 'FAIL' end,
         c1.cycle_number, case when c1.completed_maintenance_id = m1 then 'm1' else 'outra' end,
         c2.cycle_number, case when c2.completed_maintenance_id = m2 then 'm2' else 'outra' end, chr(10));
  exception when others then r := r || 'FAIL P4 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P5 --
  begin
    select count(*) into n_before from public.maintenances where organization_id = v_org;
    v_rows := jsonb_set(v_rows, '{0,supplier}', '"Suite24 Oficina Centro Ltda | Matriz"');
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    select count(*) into n from public.maintenances where organization_id = v_org;
    ok := n = n_before and (j -> 'categories' ->> 'matched_by_os')::int = 1
          and (select supplier_name_informed from public.maintenances where id = m1) = 'Suite24 Oficina Centro Ltda | Matriz'
          and (select import_key from public.maintenances where id = m1)
              = (select x.normalized_data ->> 'group_key' from public.import_rows x
                  where x.batch_id = (j ->> 'batch_id')::uuid and x.row_number = 2);
    r := r || format('%s P5 fornecedor reescrito, mesma OS: reconhecida pela OS=%s, manutenções antes=%s depois=%s, chave atualizada%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'categories' ->> 'matched_by_os', n_before, n, chr(10));
  exception when others then r := r || 'FAIL P5 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P6 --
  begin
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', '10_Manutencoes.xlsx',
           'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'license_plate', v_veh.license_plate, 'maintenance_type', 'Preventiva',
                     'cluster', 'Suite24 Preventiva', 'service', 'Suite24 Revisão programada', 'preventive_cycle', 'MP9',
                     'service_order_number', 'S24-900', 'status', 'Concluído',
                     'entry_date', to_char(v_today - 10, 'DD/MM/YYYY'), 'exit_date', to_char(v_today - 10, 'DD/MM/YYYY'), 'entry_km', '90000'))));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    ok := (j -> 'categories' ->> 'cycle_out_of_plan')::int = 1 and (k ->> 'created_rows')::int = 1
          and (select preventive_cycle_id from public.maintenances where organization_id = v_org and service_order_number = 'S24-900') is null;
    r := r || format('%s P6 MP9 com regra de 4 ciclos: aviso=%s, criada sem vínculo%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'categories' ->> 'cycle_out_of_plan', chr(10));
  exception when others then r := r || 'FAIL P6 ' || sqlerrm || chr(10);
  end;

  raise notice '%', r;
  raise exception 'ROLLBACK_TESTES %', r;
end $t$;
