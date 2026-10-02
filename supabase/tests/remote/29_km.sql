-- =============================================================================
-- 29 · Gestão de KM Rodado — importação, status, planner, paridade, correção,
--      reprocessamento, segurança e plano de rodízio
--
-- Migrations 20261003100000_km_foundation … 20261003103000_km_rotation. Suíte
-- contra o banco COM DADOS; tudo é desfeito no fim (`raise exception
-- 'ROLLBACK_TESTES …'`). Tipo, subcategoria, modelo e veículos do teste são
-- criados aqui (prefixo Suite29/SUITE29) e somem com o rollback; os filtros
-- das leituras usam o tipo do teste, então nada da frota real entra nas contas.
--
--   K1  Aba obrigatória: outra aba bloqueia com "A aba Controle KM Rodado não
--       foi localizada."
--   K2  Validação na prévia: placa vazia, não cadastrada, data inválida,
--       número inválido, data futura com hodômetro (erro), futuro sem leitura
--       (ignorado), duplicidade idêntica (aviso) e conflitante (erro),
--       divergência cadastral (aviso), regressão e salto (continuidade)
--   K3  Classificação: validado, sem movimento, SEM LEITURA (KM nulo, nunca 0),
--       inconsistente, alta rodagem, divergência de KM (vale o calculado),
--       número pt-BR em texto, data dd/mm/aaaa e serial do Excel
--   K4  Consolidação: KM não cria veículo nem altera o cadastro; hodômetro
--       oficial sincronizado (vehicle_odometer_readings.km_reading_id)
--   K5  Idempotência: o mesmo arquivo de novo → já importado, nada a criar ou
--       atualizar
--   K6  Atualização: valor alterado na planilha atualiza e audita
--       (import_update) mantendo o importado original na trilha
--   K7  Correção manual auditada; a planilha não a sobrescreve
--       (manual_correction_kept); importado original preservado
--   K8  Planner: todas as frotas elegíveis (inclusive sem leitura); sem leitura
--       ≠ sem movimento na célula; total do dia
--   K9  Paridade: KM do período igual na visão geral, planner, análise e
--       exportação da base; KPI de inconsistências = lista da visão diária
--   K10 Atualização da frota (faixas) e dia de referência
--   K11 Reprocessamento com novo limite de alta rodagem reclassifica e audita
--   K12 Trilha append-only
--   K13 Segurança: sem vínculo → nenhuma leitura visível (RLS) e rotinas
--       negadas; escrita direta na tabela negada
--   K14 Rodízio: só sugere, coorte, cada veículo uma vez, A acima de B
--   K15 Plano: transições com regras (programar exige data, cancelar exige
--       motivo), execução grava hodômetros, revalidação
--   K16 Fidelização: nunca automática — aplicar exige confirmação; sem vínculo
--       vigente a prévia bloqueia e nada muda
-- =============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select m.user_id from public.organization_memberships m
                             where m.organization_id = (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1)
                               and m.status = 'active' limit 1), 'role', 'authenticated')::text, true);

-- Ciclo completo de importação (load em blocos → validate → finalize → process).
create or replace function pg_temp.km29_import(p_org uuid, p_rows jsonb, p_hash text, p_process boolean)
returns jsonb
language plpgsql
as $f$
declare
  j jsonb; v_batch uuid; pv jsonb; pr jsonb;
begin
  j := public.stage_km_import(p_org, jsonb_build_object('phase', 'load', 'file_name', 'Suite29 Base Geral KM Rodado.xlsx',
         'file_hash', p_hash, 'file_size', 1234, 'sheet_name', 'Controle KM Rodado', 'header_row', 8, 'rows', p_rows));
  v_batch := (j ->> 'batch_id')::uuid;
  loop
    j := public.stage_km_import(p_org, jsonb_build_object('phase', 'validate', 'batch_id', v_batch));
    exit when coalesce((j ->> 'pending')::int, 0) = 0;
  end loop;
  pv := public.stage_km_import(p_org, jsonb_build_object('phase', 'finalize', 'batch_id', v_batch));
  if p_process then
    loop
      pr := public.process_km_import(p_org, v_batch, 2000);
      exit when (pr ->> 'done')::boolean;
    end loop;
  end if;
  return jsonb_build_object('batch_id', v_batch, 'preview', pv, 'process', pr);
end;
$f$;

do $t$
declare
  v_org uuid; v_uid uuid; v_today date; d0 date;
  v_type uuid; v_sub uuid; v_make uuid; v_model uuid;
  va uuid; vb uuid; vc uuid; vd uuid; ve uuid;
  v_rows jsonb; v_rows2 jsonb; v_hash text := encode(sha256(convert_to('suite29-arquivo-1', 'UTF8')), 'hex');
  j jsonb; k jsonb; s jsonb; ok boolean; txt text; n int; n2 numeric; v_x numeric; v_y numeric; v_z numeric;
  v_batch uuid; v_reading uuid; v_plan uuid; v_item uuid; v_filters jsonb; v_from date; v_idx int;
  v_veh_before int; v_fid_before int;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  v_uid := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
  v_today := private.maintenance_today(v_org);
  d0 := v_today - 15;

  -- Cadastro do teste: tipo, subcategoria, marca, modelo e 5 veículos ativos.
  insert into public.vehicle_types (organization_id, code, name) values (v_org, 'suite29_tipo', 'Suite29 Tipo') returning id into v_type;
  insert into public.vehicle_subcategories (organization_id, vehicle_type_id, name) values (v_org, v_type, 'Suite29 Sub') returning id into v_sub;
  insert into public.vehicle_makes (organization_id, name) values (v_org, 'Suite29 Marca') returning id into v_make;
  insert into public.vehicle_models (organization_id, vehicle_make_id, name) values (v_org, v_make, 'Suite29 Modelo') returning id into v_model;
  insert into public.vehicles (organization_id, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id, fleet_code, license_plate, status)
  values (v_org, v_type, v_sub, v_model, 'S29-A', 'SUITE29A', 'active'),
         (v_org, v_type, v_sub, v_model, 'S29-B', 'SUITE29B', 'active'),
         (v_org, v_type, v_sub, v_model, 'S29-C', 'SUITE29C', 'active'),
         (v_org, v_type, v_sub, v_model, 'S29-D', 'SUITE29D', 'active'),
         (v_org, v_type, v_sub, v_model, 'S29-E', 'SUITE29E', 'active');
  select id into va from public.vehicles where organization_id = v_org and license_plate = 'SUITE29A';
  select id into vb from public.vehicles where organization_id = v_org and license_plate = 'SUITE29B';
  select id into vc from public.vehicles where organization_id = v_org and license_plate = 'SUITE29C';
  select id into vd from public.vehicles where organization_id = v_org and license_plate = 'SUITE29D';
  select id into ve from public.vehicles where organization_id = v_org and license_plate = 'SUITE29E';
  v_filters := jsonb_build_object('date_from', d0, 'date_to', d0 + 9, 'vehicle_type_ids', jsonb_build_array(v_type));

  -- Linhas da aba (row_number = linha real). A: um caso por status; B, D: ritmo
  -- constante; E: regressão no d5 e salto no d8; C: nenhuma linha.
  v_rows := jsonb_build_array(
    jsonb_build_object('row_number', 10, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0,     'start', 100000, 'end', 100200, 'km', 200),
    jsonb_build_object('row_number', 11, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 1, 'start', 100200, 'end', 100200.5, 'km', 0.5),
    jsonb_build_object('row_number', 12, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 2),
    jsonb_build_object('row_number', 13, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 3, 'start', 100400, 'end', 100350),
    jsonb_build_object('row_number', 14, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 4, 'start', 100350, 'end', 101250, 'km', 900),
    jsonb_build_object('row_number', 15, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 5, 'start', 101250, 'end', 101450, 'km', 250),
    jsonb_build_object('row_number', 16, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 6, 'start', '101.450,0', 'end', '101.650,5'),
    jsonb_build_object('row_number', 17, 'plate', 'suite-29a', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', to_char(d0 + 7, 'DD/MM/YYYY'), 'start', 101650.5, 'end', 101850.5),
    jsonb_build_object('row_number', 18, 'plate', 'SUITE29A', 'fleet', 'S29-A', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', (d0 + 8) - date '1899-12-30', 'start', 101850.5, 'end', 102050.5),
    jsonb_build_object('row_number', 19, 'plate', 'SUITE29A', 'fleet', 'OUTRA-FROTA', 'type', 'Suite29 Tipo', 'model', 'Suite29 Sub', 'date', d0 + 9, 'start', 102050.5, 'end', 102250.5),
    -- erros e ignorados
    jsonb_build_object('row_number', 20, 'plate', 'ZZZ9Z99', 'date', d0, 'start', 1, 'end', 2),
    jsonb_build_object('row_number', 21, 'plate', '', 'date', d0, 'start', 1, 'end', 2),
    jsonb_build_object('row_number', 22, 'plate', 'SUITE29B', 'date', '31/02/2026', 'start', 1, 'end', 2),
    jsonb_build_object('row_number', 23, 'plate', 'SUITE29B', 'date', d0 + 1, 'start', 'abc', 'end', 2),
    jsonb_build_object('row_number', 24, 'plate', 'SUITE29A', 'date', v_today + 3, 'start', 102250.5, 'end', 102300),
    jsonb_build_object('row_number', 25, 'plate', 'SUITE29A', 'date', v_today + 4)
  );
  -- B (20 km/dia), D (100 km/dia), E (50 km/dia com regressão e salto)
  select v_rows || jsonb_agg(x.j order by x.rn) into v_rows from (
    select 100 + i as rn, jsonb_build_object('row_number', 100 + i, 'plate', 'SUITE29B', 'date', d0 + i,
             'start', 50000 + 20 * i, 'end', 50020 + 20 * i, 'km', 20) as j from generate_series(0, 9) i where i <> 1
    union all
    select 200 + i, jsonb_build_object('row_number', 200 + i, 'plate', 'SUITE29D', 'date', d0 + i,
             'start', 80000 + 100 * i, 'end', 80100 + 100 * i, 'km', 100) from generate_series(0, 9) i
    union all
    select 300 + i, jsonb_build_object('row_number', 300 + i, 'plate', 'SUITE29E', 'date', d0 + i,
             'start', case when i = 5 then 60230 when i >= 8 then 61000 + 50 * (i - 8) else 60000 + 50 * i end,
             'end', case when i = 5 then 60280 when i >= 8 then 61050 + 50 * (i - 8) else 60050 + 50 * i end)
      from generate_series(0, 9) i
  ) x;
  -- B d1 vem como duas linhas iguais; D d4 aparece de novo com outro valor
  v_rows := v_rows
    || jsonb_build_array(jsonb_build_object('row_number', 101, 'plate', 'SUITE29B', 'date', d0 + 1, 'start', 50020, 'end', 50040, 'km', 20),
                         jsonb_build_object('row_number', 120, 'plate', 'SUITE29B', 'date', d0 + 1, 'start', 50020, 'end', 50040, 'km', 20),
                         jsonb_build_object('row_number', 220, 'plate', 'SUITE29D', 'date', d0 + 4, 'start', 80400, 'end', 80555, 'km', 155));

  -- -------------------------------------------------------------------- K1 --
  begin
    begin
      perform public.stage_km_import(v_org, jsonb_build_object('phase', 'load', 'file_name', 'x.xlsx', 'sheet_name', 'KM Rodado',
                                                               'rows', jsonb_build_array(jsonb_build_object('row_number', 2, 'plate', 'SUITE29A'))));
      ok := false; txt := 'aceitou outra aba';
    exception when others then
      ok := sqlerrm = 'A aba Controle KM Rodado não foi localizada.'; txt := sqlerrm;
    end;
    r := r || format('%s K1 aba obrigatória: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL K1 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K2 --
  begin
    select count(*) into v_veh_before from public.vehicles where organization_id = v_org;
    j := pg_temp.km29_import(v_org, v_rows, v_hash, false);
    v_batch := (j ->> 'batch_id')::uuid;
    s := j -> 'preview' -> 'summary';
    ok := exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 20 and e.code = 'unregistered_plate')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 21 and e.code = 'missing_plate')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 22 and e.code = 'invalid_date')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 23 and e.code = 'invalid_number')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 24 and e.code = 'future_date' and e.level = 'error')
      and (select x.status from public.import_rows x where x.batch_id = v_batch and x.row_number = 25) = 'skipped'
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 120 and e.code = 'duplicate_identical' and e.level = 'warning')
      and (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'duplicate_conflict' and e.row_number in (204, 220)) = 2
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 19 and e.code = 'registry_divergence')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 305 and e.code = 'odometer_regression')
      and exists (select 1 from public.import_errors e where e.batch_id = v_batch and e.row_number = 308 and e.code = 'odometer_jump')
      and (s ->> 'unregistered_plates') like '%ZZZ9Z99%'
      and (select b.status from public.import_batches b where b.id = v_batch) = 'validated';
    r := r || format('%s K2 prévia: criar %s, ignorar futuros %s, erros %s, duplicidades %s, KM %s%s',
         case when ok then 'PASS' else 'FAIL' end, s ->> 'create_rows', s ->> 'future_placeholder_rows',
         s ->> 'error_rows', s ->> 'duplicate_rows', s ->> 'km_total', chr(10));
  exception when others then r := r || 'FAIL K2 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K3 --
  begin
    loop
      k := public.process_km_import(v_org, v_batch, 2000);
      exit when (k ->> 'done')::boolean;
    end loop;
    ok := (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0) = 'validated'
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0) = 200
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 1) = 'no_movement'
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 1) = 0.5
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 2) = 'no_reading'
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 2) is null
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 3) = 'inconsistent'
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 3) is null
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 4) = 'high_mileage'
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 5) = 'km_divergence'
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 5) = 200
      and (select distance_imported from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 5) = 250
      and (select distance_validated from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 6) = 200.5
      and (select odometer_end from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 7) = 101850.5
      and (select odometer_end from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 8) = 102050.5
      and (select 'registry_divergence' = any (alerts) from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 9)
      and (select status from public.km_daily_readings where vehicle_id = ve and reading_date = d0 + 5) = 'pending_review'
      and (select 'odometer_jump' = any (alerts) from public.km_daily_readings where vehicle_id = ve and reading_date = d0 + 8)
      and not exists (select 1 from public.km_daily_readings where vehicle_id = vd and reading_date = d0 + 4)
      and (select count(*) from public.km_daily_readings where vehicle_id = vb) = 10
      and not exists (select 1 from public.km_daily_readings where vehicle_id = va and reading_date > v_today);
    r := r || format('%s K3 classificação: A = %s%s', case when ok then 'PASS' else 'FAIL' end,
         (select string_agg(to_char(reading_date, 'DD') || ':' || status || '/' || coalesce(distance_validated::text, 'null'), ' ' order by reading_date)
            from public.km_daily_readings where vehicle_id = va), chr(10));
  exception when others then r := r || 'FAIL K3 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K4 --
  begin
    ok := (select count(*) from public.vehicles where organization_id = v_org) = v_veh_before
      and not exists (select 1 from public.vehicles where organization_id = v_org and license_plate = 'ZZZ9Z99')
      and (select fleet_code from public.vehicles where id = va) = 'S29-A'
      and (select c.km from private.vehicle_current_km(va) c) = 102251
      and exists (select 1 from public.vehicle_odometer_readings o
                   join public.km_daily_readings k2 on k2.id = o.km_reading_id
                  where o.vehicle_id = va and o.reading_date = d0 + 9 and o.odometer_km = 102251 and o.superseded_by is null)
      and not exists (select 1 from public.vehicle_odometer_readings o where o.vehicle_id = va and o.reading_date = d0 + 2);
    r := r || format('%s K4 cadastro intacto; hodômetro oficial de A = %s km%s', case when ok then 'PASS' else 'FAIL' end,
         (select c.km from private.vehicle_current_km(va) c), chr(10));
  exception when others then r := r || 'FAIL K4 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K5 --
  begin
    select count(*) into n from public.km_daily_readings where vehicle_id in (va, vb, vc, vd, ve);
    j := pg_temp.km29_import(v_org, v_rows, v_hash, true);
    s := j -> 'preview' -> 'summary';
    select count(*) into n2 from public.km_daily_readings where vehicle_id in (va, vb, vc, vd, ve);
    ok := (s ->> 'already_imported')::boolean and coalesce((s ->> 'create_rows')::int, 0) = 0
      and coalesce((s ->> 'update_rows')::int, 0) = 0 and n = n2;
    r := r || format('%s K5 mesmo arquivo: já importado=%s, criar %s, atualizar %s, iguais %s, leituras %s→%s%s',
         case when ok then 'PASS' else 'FAIL' end, s ->> 'already_imported', s ->> 'create_rows', s ->> 'update_rows',
         s ->> 'unchanged_rows', n, n2, chr(10));
  exception when others then r := r || 'FAIL K5 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K6 --
  begin
    v_rows2 := jsonb_build_array(jsonb_build_object('row_number', 100, 'plate', 'SUITE29B', 'date', d0, 'start', 50000, 'end', 50025, 'km', 25));
    j := pg_temp.km29_import(v_org, v_rows2, encode(sha256(convert_to('suite29-arquivo-2', 'UTF8')), 'hex'), true);
    ok := (j -> 'preview' -> 'summary' ->> 'update_rows')::int = 1
      and (select distance_validated from public.km_daily_readings where vehicle_id = vb and reading_date = d0) = 25
      and exists (select 1 from public.km_reading_audit a where a.vehicle_id = vb and a.reading_date = d0 and a.action = 'import_update');
    r := r || format('%s K6 atualização pela planilha: B d0 = %s km, trilha %s%s', case when ok then 'PASS' else 'FAIL' end,
         (select distance_validated from public.km_daily_readings where vehicle_id = vb and reading_date = d0),
         (select count(*) from public.km_reading_audit a where a.vehicle_id = vb and a.action = 'import_update'), chr(10));
  exception when others then r := r || 'FAIL K6 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K7 --
  begin
    select id into v_reading from public.km_daily_readings where vehicle_id = va and reading_date = d0;
    begin
      perform public.km_correct_reading(v_reading, jsonb_build_object('odometer_start', 100000, 'odometer_end', 100150, 'reason', 'curto'));
      ok := false;
    exception when others then ok := sqlerrm like 'Informe o motivo%';
    end;
    j := public.km_correct_reading(v_reading, jsonb_build_object('odometer_start', 100000, 'odometer_end', 100150,
                                                                 'reason', 'Hodômetro final digitado errado na planilha'));
    v_rows2 := jsonb_build_array(jsonb_build_object('row_number', 10, 'plate', 'SUITE29A', 'date', d0, 'start', 100000, 'end', 100300, 'km', 300));
    k := pg_temp.km29_import(v_org, v_rows2, encode(sha256(convert_to('suite29-arquivo-3', 'UTF8')), 'hex'), true);
    ok := ok and (j ->> 'status') = 'validated'
      and (select distance_validated from public.km_daily_readings where id = v_reading) = 150
      and (select is_corrected from public.km_daily_readings where id = v_reading)
      and (select odometer_end_imported from public.km_daily_readings where id = v_reading) = 100200
      and exists (select 1 from public.km_reading_audit a where a.reading_id = v_reading and a.action = 'correction'
                   and a.reason = 'Hodômetro final digitado errado na planilha' and a.actor_user_id = v_uid)
      and exists (select 1 from public.import_errors e where e.batch_id = (k ->> 'batch_id')::uuid and e.code = 'manual_correction_kept');
    r := r || format('%s K7 correção manual: KM %s (importado %s mantido), planilha nova não sobrescreve%s',
         case when ok then 'PASS' else 'FAIL' end,
         (select distance_validated from public.km_daily_readings where id = v_reading),
         (select odometer_end_imported from public.km_daily_readings where id = v_reading), chr(10));
  exception when others then r := r || 'FAIL K7 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K8 --
  begin
    j := public.km_planner(v_org, jsonb_build_object('competence', to_char(d0 + 2, 'YYYY-MM'), 'vehicle_type_ids', jsonb_build_array(v_type)));
    v_from := (j -> 'period' ->> 'from')::date;
    v_idx := (d0 + 2) - v_from;
    ok := jsonb_array_length(j -> 'rows') = 5
      and exists (select 1 from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = vc::text
                   and not exists (select 1 from jsonb_array_elements(x -> 'cells') c where c ->> 0 not in ('no_reading', 'future')))
      and (select x -> 'cells' -> v_idx ->> 0 from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = va::text) = 'no_reading'
      and (select x -> 'cells' -> v_idx -> 3 from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = va::text) = 'null'::jsonb
      and (select x -> 'cells' -> (v_idx - 1) ->> 0 from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = va::text) = 'no_movement'
      and (select (x -> 'cells' -> (v_idx - 1) ->> 3)::numeric from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = va::text) = 0.5;
    r := r || format('%s K8 planner: %s frotas (C sem leitura incluída); A dia %s = %s%s', case when ok then 'PASS' else 'FAIL' end,
         jsonb_array_length(j -> 'rows'), to_char(d0 + 2, 'DD/MM'),
         (select x -> 'cells' -> v_idx from jsonb_array_elements(j -> 'rows') x where x ->> 'vehicle_id' = va::text), chr(10));
  exception when others then r := r || 'FAIL K8 ' || sqlerrm || chr(10);
  end;

  -- -------------------------------------------------------------------- K9 --
  begin
    v_x := (public.km_overview(v_org, v_filters) -> 'kpis' ->> 'km_total')::numeric;
    v_y := (public.km_analysis(v_org, v_filters) -> 'totals' ->> 'km')::numeric;
    select round(sum((e ->> 'km_validated')::numeric), 1) into v_z
      from jsonb_array_elements(public.km_readings_export(v_org, v_filters, 5000, 0) -> 'rows') e;
    select round(sum(distance_validated), 1) into n2 from public.km_daily_readings r2
     join public.km_reading_statuses st on st.code = r2.status and st.counts_distance
     where r2.vehicle_id in (va, vb, vc, vd, ve) and r2.reading_date between d0 and d0 + 9;
    j := public.km_planner(v_org, jsonb_build_object('competence', to_char(d0 + 9, 'YYYY-MM'), 'vehicle_type_ids', jsonb_build_array(v_type)));
    k := public.km_overview(v_org, jsonb_build_object('competence', to_char(d0 + 9, 'YYYY-MM'), 'vehicle_type_ids', jsonb_build_array(v_type)));
    s := public.km_daily(v_org, d0 + 3, jsonb_build_object('vehicle_type_ids', jsonb_build_array(v_type)));
    ok := v_x = v_y and v_x = v_z and v_x = n2
      and (j -> 'totals' ->> 'km')::numeric = (k -> 'kpis' ->> 'km_total')::numeric and (j -> 'totals' ->> 'km')::numeric > 0
      and (s -> 'kpis' ->> 'inconsistencies')::int = jsonb_array_length(s -> 'inconsistencies');
    r := r || format('%s K9 paridade: visão geral %s = análise %s = exportação %s = base %s; planner %s = visão geral %s; diária %s = %s%s',
         case when ok then 'PASS' else 'FAIL' end, v_x, v_y, v_z, n2, j -> 'totals' ->> 'km', k -> 'kpis' ->> 'km_total',
         s -> 'kpis' ->> 'inconsistencies', jsonb_array_length(s -> 'inconsistencies'), chr(10));
  exception when others then r := r || 'FAIL K9 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K10 --
  begin
    ok := (select f.bucket from private.km_vehicle_freshness(v_org, array[va]) f) =
            case when (v_today - 1) - (d0 + 9) = 0 then 'updated' when (v_today - 1) - (d0 + 9) = 1 then 'd1'
                 when (v_today - 1) - (d0 + 9) <= 3 then 'd2_3' when (v_today - 1) - (d0 + 9) <= 7 then 'd4_7' else 'd7_plus' end
      and (select f.bucket from private.km_vehicle_freshness(v_org, array[vc]) f) = 'never'
      and (public.km_overview(v_org, v_filters) -> 'period' ->> 'reference_day')::date = d0 + 9;
    r := r || format('%s K10 atualização: A %s, C %s; dia de referência %s%s', case when ok then 'PASS' else 'FAIL' end,
         (select f.bucket from private.km_vehicle_freshness(v_org, array[va]) f),
         (select f.bucket from private.km_vehicle_freshness(v_org, array[vc]) f),
         public.km_overview(v_org, v_filters) -> 'period' ->> 'reference_day', chr(10));
  exception when others then r := r || 'FAIL K10 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K11 --
  begin
    perform public.km_save_settings(v_org, jsonb_build_object('high_mileage_km', 150));
    j := public.km_reprocess(v_org, d0, d0 + 9, array[va, vb, vd, ve]);
    ok := (j ->> 'status_changes')::int > 0
      and (select status from public.km_daily_readings where vehicle_id = vd and reading_date = d0) = 'validated'
      and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 6) = 'high_mileage'
      and exists (select 1 from public.km_reading_audit a where a.vehicle_id = va and a.reading_date = d0 + 6 and a.action = 'reprocess')
      and (select status from public.km_daily_readings where vehicle_id = ve and reading_date = d0 + 5) = 'pending_review';
    perform public.km_save_settings(v_org, jsonb_build_object('high_mileage_km', 800));
    perform public.km_reprocess(v_org, d0, d0 + 9, array[va, vb, vd, ve]);
    ok := ok and (select status from public.km_daily_readings where vehicle_id = va and reading_date = d0 + 6) = 'validated';
    r := r || format('%s K11 reprocessamento: %s mudanças com limite 150 km; volta ao validado com 800 km%s',
         case when ok then 'PASS' else 'FAIL' end, j ->> 'status_changes', chr(10));
  exception when others then r := r || 'FAIL K11 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K12 --
  begin
    select count(*) into n from public.km_reading_audit where reading_id = v_reading;
    begin
      update public.km_reading_audit set reason = 'alterado' where reading_id = v_reading;
      ok := false;
    exception when others then ok := n > 0;
    end;
    r := r || format('%s K12 trilha append-only%s', case when ok then 'PASS' else 'FAIL' end, chr(10));
  exception when others then r := r || 'FAIL K12 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K13 --
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from public.km_daily_readings where organization_id = v_org;
    ok := n = 0;
    begin
      perform public.km_overview(v_org, '{}'::jsonb); ok := false;
    exception when others then ok := ok and sqlstate = '42501';
    end;
    begin
      perform public.km_rotation_candidates(v_org, '{}'::jsonb); ok := false;
    exception when others then ok := ok and sqlstate = '42501';
    end;
    begin
      perform public.stage_km_import(v_org, jsonb_build_object('phase', 'load', 'sheet_name', 'Controle KM Rodado',
                                                               'rows', jsonb_build_array(jsonb_build_object('row_number', 2)))); ok := false;
    exception when others then ok := ok and sqlstate = '42501';
    end;
    begin
      insert into public.km_daily_readings (organization_id, vehicle_id, reading_date, status) values (v_org, va, d0 - 1, 'no_reading');
      ok := false;
    exception when others then ok := ok and sqlstate = '42501';
    end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    r := r || format('%s K13 segurança: sem vínculo vê %s leituras; rotinas e escrita direta negadas%s', case when ok then 'PASS' else 'FAIL' end, n, chr(10));
  exception when others then
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    r := r || 'FAIL K13 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K14 --
  begin
    j := public.km_rotation_candidates(v_org, v_filters || jsonb_build_object('horizon_days', 90, 'different_locations_only', false));
    ok := (j -> 'summary' ->> 'candidates')::int >= 1
      and (j -> 'items' -> 0 ->> 'vehicle_a_id')::uuid = va and (j -> 'items' -> 0 ->> 'vehicle_b_id')::uuid = vb
      and (j -> 'items' -> 0 ->> 'gap_current')::numeric > 0
      and (j -> 'items' -> 0 ->> 'reduction_pct')::numeric > 0
      and (select count(*) = count(distinct v) from (
             select x ->> 'vehicle_a_id' as v from jsonb_array_elements(j -> 'items') x
             union all select x ->> 'vehicle_b_id' from jsonb_array_elements(j -> 'items') x) q)
      and not exists (select 1 from jsonb_array_elements(j -> 'items') x where (x ->> 'vehicle_a_id')::uuid = vc or (x ->> 'vehicle_b_id')::uuid = vc)
      and not exists (select 1 from public.km_rotation_plans p where p.organization_id = v_org and p.name like 'Suite29%');
    -- com "somente locais diferentes", veículos sem local não formam par
    k := public.km_rotation_candidates(v_org, v_filters || jsonb_build_object('horizon_days', 90, 'different_locations_only', true));
    ok := ok and (k -> 'summary' ->> 'candidates')::int = 0;
    r := r || format('%s K14 rodízio sugerido: %s par(es); 1º %s ⇄ %s, redução %s%% em 90 dias (prioridade %s)%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'summary' ->> 'candidates',
         j -> 'items' -> 0 -> 'vehicle_a' ->> 'plate', j -> 'items' -> 0 -> 'vehicle_b' ->> 'plate',
         j -> 'items' -> 0 ->> 'reduction_pct', j -> 'items' -> 0 ->> 'priority', chr(10));
  exception when others then r := r || 'FAIL K14 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K15 --
  begin
    j := public.km_create_rotation_plan(v_org, jsonb_build_object('name', 'Suite29 Plano', 'filters', v_filters,
           'horizon_days', 90, 'different_locations_only', false,
           'items', jsonb_build_array(jsonb_build_object('vehicle_a_id', va, 'vehicle_b_id', vb))));
    v_plan := (j ->> 'plan_id')::uuid;
    select id into v_item from public.km_rotation_plan_items where plan_id = v_plan;
    ok := (j ->> 'code') like 'ROD-%' and (select status from public.km_rotation_plan_items where id = v_item) = 'suggested';
    begin
      perform public.km_set_rotation_item(v_item, '{"status":"executed"}'); ok := false;
    exception when others then ok := ok and sqlerrm like 'Transição de status não permitida%';
    end;
    perform public.km_set_rotation_item(v_item, '{"status":"approved"}');
    begin
      perform public.km_set_rotation_item(v_item, '{"status":"scheduled"}'); ok := false;
    exception when others then ok := ok and sqlerrm like 'Informe a data prevista%';
    end;
    perform public.km_set_rotation_item(v_item, jsonb_build_object('effective_date', d0 + 9));
    perform public.km_set_rotation_item(v_item, '{"status":"scheduled"}');
    perform public.km_set_rotation_item(v_item, '{"status":"executed"}');
    ok := ok and (select status from public.km_rotation_plan_items where id = v_item) = 'executed'
      and (select execution_odometer_a from public.km_rotation_plan_items where id = v_item) = 102251
      and (select execution_odometer_b from public.km_rotation_plan_items where id = v_item) is not null
      and (select status from public.km_rotation_plans where id = v_plan) = 'executed'
      and (select count(*) from public.km_rotation_events where plan_id = v_plan) >= 5;
    begin
      perform public.km_set_rotation_plan_status(v_plan, 'cancelled', null); ok := false;
    exception when others then ok := ok and sqlerrm like 'Informe o motivo%';
    end;
    j := public.km_revalidate_rotation_plan(v_plan);
    ok := ok and (public.km_rotation_plan_detail(v_plan) -> 'items' -> 0 -> 'evaluation' ->> 'execution_date')::date = d0 + 9;
    r := r || format('%s K15 plano %s: sugerido → aprovado → programado → executado; hodômetros na execução %s / %s%s',
         case when ok then 'PASS' else 'FAIL' end, (select code from public.km_rotation_plans where id = v_plan),
         (select execution_odometer_a from public.km_rotation_plan_items where id = v_item),
         (select execution_odometer_b from public.km_rotation_plan_items where id = v_item), chr(10));
  exception when others then r := r || 'FAIL K15 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------- K16 --
  begin
    select count(*) into v_fid_before from public.fidelization_assignments where organization_id = v_org;
    begin
      perform public.km_apply_rotation_fidelization(v_item, jsonb_build_object('effective_date', d0 + 9)); ok := false;
    exception when others then ok := sqlerrm like 'Confirme a aplicação%';
    end;
    j := public.km_rotation_fidelization_preview(v_item, d0 + 9);
    ok := ok and not (j ->> 'can_apply')::boolean and jsonb_array_length(j -> 'errors') >= 2;
    begin
      perform public.km_apply_rotation_fidelization(v_item, jsonb_build_object('effective_date', d0 + 9, 'confirm', true)); ok := false;
    exception when others then ok := ok and sqlerrm like '%não tem vínculo de fidelização vigente%';
    end;
    ok := ok and (select count(*) from public.fidelization_assignments where organization_id = v_org) = v_fid_before
      and (select fidelization_applied_at from public.km_rotation_plan_items where id = v_item) is null;
    r := r || format('%s K16 fidelização: sem confirmação negado; prévia bloqueia (%s); vínculos %s → %s%s',
         case when ok then 'PASS' else 'FAIL' end, j -> 'errors' ->> 0, v_fid_before,
         (select count(*) from public.fidelization_assignments where organization_id = v_org), chr(10));
  exception when others then r := r || 'FAIL K16 ' || sqlerrm || chr(10);
  end;

  raise notice '%', r;
  raise exception 'ROLLBACK_TESTES %', r;
end $t$;
