-- =============================================================================
-- 28 · Preventiva — ciclo informado (coluna Ciclo Preventivo) × ciclo realizado
--
-- Migration 20261002107000_maintenance_preventive_reconcile. Suíte contra o
-- banco COM DADOS; tudo é desfeito no fim (`raise exception 'ROLLBACK_TESTES …'`).
-- Veículos, modelo, catálogo e regra do teste são criados aqui (prefixo
-- Suite28/SUITE28) e somem com o rollback. A importação roda como o usuário
-- autenticado (role authenticated + request.jwt.claims).
--
--   P1  MP repetido (SNT8I36): "MP1" aos 60.126 km depois do MP1 e do MP2 →
--       realiza o MP3 pelo KM; a "MP3 Há agendar" passa ao MP4; trilha e aviso
--       do lote registram o porquê; o MP informado continua MP1
--   P2  Mesma visita (SNT8E16): MP3 e MP4 no mesmo dia e KM → só o MP3 é
--       realizado; o MP4 continua pendente
--   P3  Sequência deslocada (SNT8J56): MP3 aos 79.524 e MP4 aos 101.042 →
--       MP4 e MP5 realizados
--   P4  Regra cadastrada depois (SNU9C19): preventivas importadas sem regra
--       guardam o MP informado; salvar a regra liga MP1..MP3 e a agendada ao MP4
--   P5  O mesmo arquivo de novo: nada a criar nem atualizar, nenhum evento,
--       vínculos iguais
--   P6  KM corrigido na planilha: atualiza o KM vindo da importação (evento
--       km_changed) e o KM do ciclo; registro alterado por usuário não muda
--   P7  Conciliação pela rotina: simulação sem mudanças depois de conciliado;
--       veículo sem preventiva não muda nada
--   P8  MP informado à frente do KM (20261002108000): "MP2" aos 19.800 km como
--       primeira preventiva → realiza o MP1; o MP2 continua pendente; trilha e
--       aviso do lote dizem por quê
-- =============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from public.organization_memberships m
                             where m.organization_id = (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1)
                               and m.status = 'active' limit 1), 'role', 'authenticated')::text, true);
do $t$
declare
  v_org uuid; v_uid uuid; v_today date;
  x_tpl record; v_make uuid; v_model1 uuid; v_model2 uuid;
  va uuid; vb uuid; vc uuid; vd uuid; ve uuid; v_batch1 uuid;
  j jsonb; k jsonb; ok boolean; txt text;
  v_rows jsonb; v_rows2 jsonb;
  n int; n2 int; n_ev int;
  m_a3 uuid; m_a_open uuid; m_b4 uuid; m_a2 uuid; m_c2 uuid;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  v_uid := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
  v_today := private.maintenance_today(v_org);

  -- Veículos do teste: tipo, subcategoria e modelos próprios (nenhuma regra
  -- preventiva real alcança esses veículos).
  insert into public.vehicle_types (organization_id, code, name) values (v_org, 'suite28_tipo', 'Suite28 Tipo')
  returning id into v_make;
  insert into public.vehicle_subcategories (organization_id, vehicle_type_id, name) values (v_org, v_make, 'Suite28 Sub')
  returning id into v_model1;
  select v_make as vehicle_type_id, v_model1 as vehicle_subcategory_id into x_tpl;
  insert into public.vehicle_makes (organization_id, name) values (v_org, 'Suite28 Marca') returning id into v_make;
  insert into public.vehicle_models (organization_id, vehicle_make_id, name) values (v_org, v_make, 'Suite28 Modelo 1') returning id into v_model1;
  insert into public.vehicle_models (organization_id, vehicle_make_id, name) values (v_org, v_make, 'Suite28 Modelo 2') returning id into v_model2;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, x_tpl.vehicle_type_id, x_tpl.vehicle_subcategory_id, v_model1, 'SUITE28-A', 'SUITE28A', 'active'),
         (v_org, x_tpl.vehicle_type_id, x_tpl.vehicle_subcategory_id, v_model1, 'SUITE28-B', 'SUITE28B', 'active'),
         (v_org, x_tpl.vehicle_type_id, x_tpl.vehicle_subcategory_id, v_model1, 'SUITE28-C', 'SUITE28C', 'active'),
         (v_org, x_tpl.vehicle_type_id, x_tpl.vehicle_subcategory_id, v_model2, 'SUITE28-D', 'SUITE28D', 'active'),
         (v_org, x_tpl.vehicle_type_id, x_tpl.vehicle_subcategory_id, v_model1, 'SUITE28-E', 'SUITE28E', 'active');
  select id into va from public.vehicles where organization_id = v_org and license_plate = 'SUITE28A';
  select id into vb from public.vehicles where organization_id = v_org and license_plate = 'SUITE28B';
  select id into vc from public.vehicles where organization_id = v_org and license_plate = 'SUITE28C';
  select id into vd from public.vehicles where organization_id = v_org and license_plate = 'SUITE28D';
  select id into ve from public.vehicles where organization_id = v_org and license_plate = 'SUITE28E';

  -- Catálogo do teste e a regra do modelo 1 (MP a cada 20 mil km).
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'clusters', 'file_name', 's28.xlsx',
         'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'name', 'Suite28 Preventiva', 'code', 'S28PRE'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'services', 'file_name', 's28.xlsx',
         'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'cluster', 'Suite28 Preventiva', 'name', 'Suite28 Revisão',
                                                      'maintenance_types', 'Preventiva', 'status', 'Ativo'))));
  perform public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  perform public.maintenance_save_preventive_rule(v_org, jsonb_build_object(
    'vehicle_type_id', x_tpl.vehicle_type_id, 'vehicle_subcategory_id', x_tpl.vehicle_subcategory_id, 'vehicle_model_id', v_model1,
    'interval_km', 20000, 'initial_km', 0, 'cycle_count', 10, 'alert_before_pct', 5, 'tolerance_after_pct', 5, 'status', 'active'));

  -- A planilha (com os erros de ciclo da base real).
  select jsonb_agg(jsonb_build_object(
           'row_number', q.rn, 'license_plate', q.plate, 'maintenance_type', 'Preventiva', 'cluster', 'Suite28 Preventiva',
           'service', 'Suite28 Revisão', 'preventive_cycle', q.mp, 'service_order_number', q.os, 'status', q.st, 'origin', 'Checklist',
           'entry_date', q.d, 'exit_date', q.d, 'entry_km', q.km::text, 'scheduled_date', q.sched) order by q.rn)
    into v_rows
    from (values
      (2,  'SUITE28A', 'MP1', 'S28-A1', 'Concluído', '2024-08-08', 19257,  null),
      (3,  'SUITE28A', 'MP2', 'S28-A2', 'Concluído', '2025-05-21', 39467,  null),
      (4,  'SUITE28A', 'MP1', null,     'Concluído', '2026-01-12', 60126,  null),
      (5,  'SUITE28A', 'MP3', null,     'Há Agendar', null,        null,   null),
      (6,  'SUITE28B', 'MP1', 'S28-B1', 'Concluído', '2025-02-19', 20089,  null),
      (7,  'SUITE28B', 'MP2', 'S28-B2', 'Concluído', '2025-11-21', 39258,  null),
      (8,  'SUITE28B', 'MP3', 'S28-B3', 'Concluído', '2026-07-30', 62511,  null),
      (9,  'SUITE28B', 'MP4', 'S28-B4', 'Concluído', '2026-07-30', 62511,  null),
      (10, 'SUITE28C', 'MP1', 'S28-C1', 'Concluído', '2024-06-04', 19938,  null),
      (11, 'SUITE28C', 'MP2', 'S28-C2', 'Concluído', '2024-09-26', 40100,  null),
      (12, 'SUITE28C', 'MP3', 'S28-C3', 'Concluído', '2025-01-13', 59223,  null),
      (13, 'SUITE28C', 'MP3', 'S28-C4', 'Concluído', '2025-05-23', 79524,  null),
      (14, 'SUITE28C', 'MP4', 'S28-C5', 'Concluído', '2026-02-23', 101042, null),
      (15, 'SUITE28D', 'MP1', 'S28-D1', 'Concluído', '2024-09-09', 20548,  null),
      (16, 'SUITE28D', 'MP2', 'S28-D2', 'Concluído', '2025-02-03', 40168,  null),
      (17, 'SUITE28D', 'MP3', 'S28-D3', 'Concluído', '2025-07-23', 61147,  null),
      (18, 'SUITE28D', 'MP4', null,     'Agendado',  null,         null,   to_char(v_today + 3, 'YYYY-MM-DD')),
      (19, 'SUITE28E', 'MP2', 'S28-E1', 'Concluído', '2025-03-10', 19800,  null)
    ) as q(rn, plate, mp, os, st, d, km, sched);
  v_rows := (select jsonb_agg(jsonb_strip_nulls(x)) from jsonb_array_elements(v_rows) x);

  perform set_config('role', 'authenticated', true);
  j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', 's28_manutencoes.xlsx', 'rows', v_rows));
  k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
  perform set_config('role', 'postgres', true);
  v_batch1 := (j ->> 'batch_id')::uuid;

  -- ------------------------------------------------------------------- P1 --
  begin
    select m.id into m_a3 from public.maintenances m where m.vehicle_id = va and m.entry_date = date '2026-01-12';
    select m.id into m_a_open from public.maintenances m where m.vehicle_id = va and m.status = 'to_schedule';
    ok := (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m_a3) = 3
          and (select preventive_cycle_declared from public.maintenances where id = m_a3) = 1
          and (select c.completed_maintenance_id from public.maintenance_preventive_cycles c where c.vehicle_id = va and c.cycle_number = 3) = m_a3
          and (select count(*) from public.maintenance_preventive_cycles c where c.vehicle_id = va and c.completed_on is not null) = 3
          and (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m_a_open) = 4
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_a3 and e.event_type = 'preventive_updated'
                       and e.payload ->> 'reason' = 'km_inferred' and e.reason like '%60.126 km%MP3%')
          and exists (select 1 from public.import_errors e where e.batch_id = (j ->> 'batch_id')::uuid and e.code = 'cycle_reconciled' and e.row_number = 4);
    select string_agg('MP' || c.cycle_number || case when c.completed_on is not null then '✓' else '' end, ' ' order by c.cycle_number) into txt
      from public.maintenance_preventive_cycles c where c.vehicle_id = va and c.cycle_number <= 5;
    r := r || format('%s P1 MP repetido: %s; aberta no MP%s; informado MP%s%s', case when ok then 'PASS' else 'FAIL' end, txt,
         (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m_a_open),
         (select preventive_cycle_declared from public.maintenances where id = m_a3), chr(10));
  exception when others then r := r || 'FAIL P1 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P2 --
  begin
    select m.id into m_b4 from public.maintenances m where m.vehicle_id = vb and m.service_order_number = 'S28-B4';
    ok := (select c.completed_on from public.maintenance_preventive_cycles c where c.vehicle_id = vb and c.cycle_number = 4) is null
          and (select c.completed_on from public.maintenance_preventive_cycles c where c.vehicle_id = vb and c.cycle_number = 3) = date '2026-07-30'
          and (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m_b4) = 3
          and (select preventive_cycle_declared from public.maintenances where id = m_b4) = 4
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_b4 and e.payload ->> 'reason' = 'same_visit');
    select string_agg('MP' || c.cycle_number || case when c.completed_on is not null then '✓' else '' end, ' ' order by c.cycle_number) into txt
      from public.maintenance_preventive_cycles c where c.vehicle_id = vb and c.cycle_number <= 5;
    r := r || format('%s P2 mesma visita: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL P2 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P3 --
  begin
    ok := (select count(*) from public.maintenance_preventive_cycles c where c.vehicle_id = vc and c.completed_on is not null) = 5
          and (select m.entry_km from public.maintenance_preventive_cycles c join public.maintenances m on m.id = c.completed_maintenance_id
                where c.vehicle_id = vc and c.cycle_number = 4) = 79524
          and (select m.entry_km from public.maintenance_preventive_cycles c join public.maintenances m on m.id = c.completed_maintenance_id
                where c.vehicle_id = vc and c.cycle_number = 5) = 101042;
    select string_agg('MP' || c.cycle_number || case when c.completed_on is not null then '✓' || c.completed_km else '' end, ' ' order by c.cycle_number) into txt
      from public.maintenance_preventive_cycles c where c.vehicle_id = vc and c.cycle_number <= 6;
    r := r || format('%s P3 sequência deslocada: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL P3 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P4 --
  begin
    select count(*) into n from public.maintenance_preventive_cycles c where c.vehicle_id = vd;
    select count(*) into n2 from public.maintenances m where m.vehicle_id = vd and m.preventive_cycle_declared is not null;
    perform public.maintenance_save_preventive_rule(v_org, jsonb_build_object(
      'vehicle_type_id', x_tpl.vehicle_type_id, 'vehicle_subcategory_id', x_tpl.vehicle_subcategory_id, 'vehicle_model_id', v_model2,
      'interval_km', 20000, 'initial_km', 0, 'cycle_count', 10, 'alert_before_pct', 5, 'tolerance_after_pct', 5, 'status', 'active'));
    ok := n = 0 and n2 = 4
          and (select count(*) from public.maintenance_preventive_cycles c where c.vehicle_id = vd and c.completed_on is not null and c.cycle_number <= 3) = 3
          and (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id
                where m.vehicle_id = vd and m.status = 'scheduled') = 4
          and (select c.completed_km from public.maintenance_preventive_cycles c where c.vehicle_id = vd and c.cycle_number = 1) = 20548;
    select string_agg('MP' || c.cycle_number || case when c.completed_on is not null then '✓' else '' end, ' ' order by c.cycle_number) into txt
      from public.maintenance_preventive_cycles c where c.vehicle_id = vd and c.cycle_number <= 5;
    r := r || format('%s P4 regra depois: antes %s ciclos e %s MP informados; depois %s%s', case when ok then 'PASS' else 'FAIL' end, n, n2, txt, chr(10));
  exception when others then r := r || 'FAIL P4 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P5 --
  begin
    select count(*) into n_ev from public.maintenance_events e join public.maintenances m on m.id = e.maintenance_id
     where m.vehicle_id in (va, vb, vc, vd);
    select string_agg(m.id::text || ':' || coalesce(m.preventive_cycle_id::text, '-'), ',' order by m.id) into txt
      from public.maintenances m where m.vehicle_id in (va, vb, vc, vd);
    perform set_config('role', 'authenticated', true);
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', 's28_manutencoes.xlsx', 'rows', v_rows));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    perform set_config('role', 'postgres', true);
    ok := coalesce((j -> 'summary' ->> 'create_rows')::int, 0) = 0 and coalesce((j -> 'summary' ->> 'update_rows')::int, 0) = 0
          and (select count(*) from public.maintenance_events e join public.maintenances m on m.id = e.maintenance_id
                where m.vehicle_id in (va, vb, vc, vd)) = n_ev
          and (select string_agg(m.id::text || ':' || coalesce(m.preventive_cycle_id::text, '-'), ',' order by m.id)
                 from public.maintenances m where m.vehicle_id in (va, vb, vc, vd)) = txt;
    r := r || format('%s P5 mesmo arquivo de novo: novas=%s, atualizar=%s, eventos %s→%s, vínculos iguais=%s%s',
         case when ok then 'PASS' else 'FAIL' end, coalesce(j -> 'summary' ->> 'create_rows', '0'), coalesce(j -> 'summary' ->> 'update_rows', '0'),
         n_ev, (select count(*) from public.maintenance_events e join public.maintenances m on m.id = e.maintenance_id where m.vehicle_id in (va, vb, vc, vd)),
         (select string_agg(m.id::text || ':' || coalesce(m.preventive_cycle_id::text, '-'), ',' order by m.id)
            from public.maintenances m where m.vehicle_id in (va, vb, vc, vd)) = txt, chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL P5 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P6 --
  begin
    select m.id into m_a2 from public.maintenances m where m.vehicle_id = va and m.service_order_number = 'S28-A2';
    select m.id into m_c2 from public.maintenances m where m.vehicle_id = vc and m.service_order_number = 'S28-C2';
    -- C2 foi alterada por um usuário: o arquivo não a sobrescreve.
    perform private.maintenance_log(v_org, m_c2, 'details_updated', null, null, 'Ajuste manual do teste', '{}'::jsonb, 'user');
    select jsonb_agg(case when x ->> 'row_number' = '3' then x || '{"entry_km": "39500"}'
                          when x ->> 'row_number' = '11' then x || '{"entry_km": "40999"}'
                          else x end order by (x ->> 'row_number')::int)
      into v_rows2 from jsonb_array_elements(v_rows) x;
    perform set_config('role', 'authenticated', true);
    j := public.stage_maintenance_import(v_org, jsonb_build_object('phase', 'all', 'kind', 'records', 'file_name', 's28_manutencoes_km.xlsx', 'rows', v_rows2));
    k := public.process_maintenance_import(v_org, (j ->> 'batch_id')::uuid, null);
    perform set_config('role', 'postgres', true);
    ok := (select entry_km from public.maintenances where id = m_a2) = 39500
          and (select c.completed_km from public.maintenance_preventive_cycles c where c.vehicle_id = va and c.cycle_number = 2) = 39500
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_a2 and e.event_type = 'km_changed'
                       and (e.payload ->> 'km_from')::int = 39467 and (e.payload ->> 'km_to')::int = 39500 and e.source = 'import')
          and (select entry_km from public.maintenances where id = m_c2) = 40100;
    r := r || format('%s P6 KM da planilha: A2 %s km (ciclo %s km); C2 alterada por usuário mantém %s km%s',
         case when ok then 'PASS' else 'FAIL' end, (select entry_km from public.maintenances where id = m_a2),
         (select c.completed_km from public.maintenance_preventive_cycles c where c.vehicle_id = va and c.cycle_number = 2),
         (select entry_km from public.maintenances where id = m_c2), chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL P6 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P7 --
  begin
    perform set_config('role', 'authenticated', true);
    j := public.maintenance_reconcile_preventive(v_org, va, true);
    k := public.maintenance_reconcile_preventive(v_org, vb, false);
    perform set_config('role', 'postgres', true);
    ok := (j ->> 'changed')::int = 0 and (j ->> 'dry_run')::boolean and (k ->> 'changed')::int = 0
          and (k ->> 'cycles_reopened')::int = 0 and (k ->> 'cycles_completed')::int = 0;
    r := r || format('%s P7 rotina: simulação A muda %s; conciliação B muda %s (reabertos %s, realizados %s)%s',
         case when ok then 'PASS' else 'FAIL' end, j ->> 'changed', k ->> 'changed', k ->> 'cycles_reopened', k ->> 'cycles_completed', chr(10));
  exception when others then perform set_config('role', 'postgres', true); r := r || 'FAIL P7 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- P8 --
  begin
    select m.id into m_a2 from public.maintenances m where m.vehicle_id = ve;
    ok := (select c.cycle_number from public.maintenances m join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id where m.id = m_a2) = 1
          and (select preventive_cycle_declared from public.maintenances where id = m_a2) = 2
          and (select c.completed_maintenance_id from public.maintenance_preventive_cycles c where c.vehicle_id = ve and c.cycle_number = 1) = m_a2
          and (select c.completed_on from public.maintenance_preventive_cycles c where c.vehicle_id = ve and c.cycle_number = 2) is null
          and exists (select 1 from public.maintenance_events e where e.maintenance_id = m_a2 and e.payload ->> 'reason' = 'km_early'
                       and e.reason like '%MP2 (marco de 40.000 km), mas a entrada foi aos 19.800 km%MP1.')
          and exists (select 1 from public.import_errors e where e.batch_id = v_batch1 and e.code = 'cycle_reconciled' and e.row_number = 19
                       and e.message like '%entrada bem antes do marco%');
    select string_agg('MP' || c.cycle_number || case when c.completed_on is not null then '✓' else '' end, ' ' order by c.cycle_number) into txt
      from public.maintenance_preventive_cycles c where c.vehicle_id = ve and c.cycle_number <= 3;
    r := r || format('%s P8 MP2 aos 19.800 km (marco 40.000): %s; informado MP%s%s', case when ok then 'PASS' else 'FAIL' end, txt,
         (select preventive_cycle_declared from public.maintenances where id = m_a2), chr(10));
  exception when others then r := r || 'FAIL P8 ' || sqlerrm || chr(10);
  end;

  raise notice '%', r;
  raise exception 'ROLLBACK_TESTES %', r;
end $t$;
