-- =============================================================================
-- 32 · Gestão de Pneus + Vistoria de Pneus + Importação Rodopar 10
--
-- Suíte transacional contra o banco COM DADOS: usa dois veículos ativos
-- elegíveis ao app Vistoria de Pneus (layout leve com 5 posições) e monta duas
-- fotografias Rodopar sintéticas (Nº Fogo "ZT90xx" e "0099005"). Não cria
-- veículo, usuário nem catálogo. Termina em `raise exception 'ROLLBACK_TESTES …'`
-- DE PROPÓSITO: devolve o resultado e desfaz tudo (lotes, pneus, fotografias,
-- eventos, vistorias, consertos, parâmetros, auditoria e outbox).
--
--   P1  parâmetros/sementes; Nº Fogo texto (zeros à esquerda); status canônico;
--       conversões de célula (vírgula decimal, milhar, data BR, serial Excel)
--   P2  importação r1: staging → validação (avisos: KM Real negativo, PSI como
--       data, sulco inválido, menor mm divergente, frota não encontrada,
--       situação não reconhecida, data futura) → prévia → confirmação atômica
--       (fotografia com contexto por IDs, bruto preservado, eventos, auditoria)
--   P3  bloqueios: arquivo repetido, data não posterior, Nº Fogo duplicado,
--       colisão de posição, colunas oficiais ausentes; confirmação recusada;
--       cancelamento sem tocar a base
--   P4  leituras: visão geral, base (frota/fogo/fora), aderências, cronograma,
--       qualidade, opções, ficha, resumo do veículo, catálogo
--   P5  app cego: posições sem nenhum dado do pneu; envio idempotente; posição
--       fora do veículo; limites; comparação no servidor (SEM_REFERENCIA,
--       PNEU_DIFERENTE, POSICAO_NAO_ENCONTRADA, SULCO_DIVERGENTE,
--       PSI_DIVERGENTE, MEDICAO_INCOMPLETA); a vistoria NÃO altera a base
--   P6  workflow: retorno exige motivo + alerta (outbox); nova medição substitui;
--       transições inválidas recusadas; aprovação → pendente de Rodopar
--   P7  importação r2 + reconciliação automática: sincronizada, divergência
--       persistente, pendente; eventos MOVED/RETURNED_TO_STOCK/POSITION_CHANGED/
--       LIFE_CHANGED/MEASURED/PRESSURE_UPDATED/ABSENT; ausente não é excluído
--   P8  serviços: veículo do conserto pela fotografia da data; troca exige
--       justificativa; cancelamento com motivo; serviços da Manutenção
--   P9  parâmetros com auditoria; regra de PSI mais específica vence; regra
--       duplicada recusada; layout por veículo; exportação auditada
--   P10 RBAC/RLS, perfis oficiais e ausência de CPK
--
-- Última execução (06/10/2026, produção, com rollback): 53/54 PASS na primeira
-- rodada completa; a única falha era da própria verificação de CPK (casava as
-- permissões cost_centers.* das Filiais) — corrigida para o módulo de pneus e
-- reexecutada isoladamente: PASS. Fixture: frotas FL115 e FL116. A rodada
-- anterior revelou e corrigiu 1 defeito real (tire_repair_save sem troca manual)
-- e a vigência das regras de PSI para fotografias anteriores à implantação.
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_other uuid := gen_random_uuid();
  v1 record; v2 record; r1 date; r2 date; m1 timestamp; m2 timestamp; fut timestamp;
  v_cols jsonb := '["fire_number","status_raw","fleet_number","position","tread_min","tread_1","tread_2","tread_3","tread_4","measurement_at","psi","calibration_at","km_rodado","km_real","life","brand","model","dimension"]'::jsonb;
  h1 text := encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex');
  h2 text := encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex');
  h3 text := encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex');
  h4 text := encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex');
  rows1 jsonb; rows2 jsonb; rows3 jsonb;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid;
  i_a uuid; i_b uuid; i_c uuid; i_d uuid; i_e uuid; s_a uuid := gen_random_uuid();
  v_at text; v_res jsonb; v_res2 jsonb; v_err text; v_hint text; v_txt text;
  p public.tire_parameter_sets; n bigint; n2 bigint; n3 bigint; n4 bigint; ts1 timestamptz; ts2 timestamptz;
  rp1 uuid; rp2 uuid; v_lay uuid;
  r text := ''; np int := 0; nf int := 0;
begin
  create temp table if not exists t_res (seq serial, ok boolean, label text);
  set constraints all immediate;

  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.organization_id = v_org and m.status = 'active' and ro.code = 'administrador' order by m.created_at limit 1;
  v_today := private.maintenance_today(v_org);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  r1 := v_today - 5; r2 := v_today - 1;
  m1 := (v_today - 6)::timestamp + interval '8 hours';
  m2 := (v_today - 2)::timestamp + interval '9 hours';
  fut := (v_today + 5)::timestamp + interval '8 hours';
  v_at := (((v_today - 3)::timestamp + interval '10 hours') at time zone 'America/Sao_Paulo')::text;

  if exists (select 1 from public.tires t where t.organization_id = v_org) then
    raise exception E'ROLLBACK_TESTES\nSEM FIXTURE: a suíte espera a base de pneus vazia (rodar antes da importação real ou adaptar).';
  end if;

  -- dois veículos elegíveis ao app, com layout leve (5 posições) e código de frota
  v_res := public.tire_inspection_vehicles(v_org, null, 100);
  select (x ->> 'id')::uuid as id, x ->> 'license_plate' as plate, x ->> 'fleet_code' as fleet into v1
    from jsonb_array_elements(v_res -> 'vehicles') x
   where (x ->> 'positions')::int = 5 and x ->> 'fleet_code' is not null order by x ->> 'fleet_code' limit 1;
  select (x ->> 'id')::uuid as id, x ->> 'license_plate' as plate, x ->> 'fleet_code' as fleet into v2
    from jsonb_array_elements(v_res -> 'vehicles') x
   where (x ->> 'positions')::int = 5 and x ->> 'fleet_code' is not null and (x ->> 'id')::uuid <> v1.id order by x ->> 'fleet_code' limit 1;
  if v1.id is null or v2.id is null then
    raise exception E'ROLLBACK_TESTES\nSEM FIXTURE: precisa de 2 veículos elegíveis à Vistoria de Pneus com layout de 5 posições.';
  end if;

  -- ---------------------------------------------------------------- P1
  p := private.tire_params_at(v_org, v_today);
  insert into t_res (ok, label) values (p.measurement_ok_days = 20 and p.measurement_warning_days = 25 and p.calibration_ok_days = 20
    and p.tread_critical_mm = 3 and p.tread_attention_mm = 5 and p.inspection_tread_tolerance_mm = 1.0 and p.inspection_psi_tolerance = 8,
    'P1 parâmetros vigentes (20/25 dias, 3/5 mm, tolerâncias 1 mm / 8 PSI) vêm do banco');
  insert into t_res (ok, label) values ((select count(*) from public.tire_pressure_rules x where x.organization_id = v_org and x.is_active) = 6
    and (select count(*) from public.tire_positions x where x.organization_id = v_org) = 13
    and (select count(*) from public.tire_layouts x where x.organization_id = v_org) = 3, 'P1 sementes: 6 regras de PSI, 13 posições, 3 layouts');
  insert into t_res (ok, label) values (private.tire_fire_number(' 00123 ') = '00123' and private.tire_fire_number('123.0') = '123'
    and private.tire_fire_number('ab 12') = 'AB12' and private.tire_fire_number('') is null, 'P1 Nº Fogo é texto: zeros à esquerda preservados, ".0" do Excel removido');
  insert into t_res (ok, label) values (private.tire_canonical_status('USO') = 'em_uso' and private.tire_canonical_status('ESTOQUE') = 'estoque'
    and private.tire_canonical_status('RESSOLAGEM') = 'ressolagem' and private.tire_canonical_status('DESCARTE') = 'descartado'
    and private.tire_canonical_status('BAIXADO') = 'baixado' and private.tire_canonical_status('XPTO') = 'outro', 'P1 situação canônica: USO/ESTOQUE/RESSOLAGEM/DESCARTE/BAIXADO/outro');
  insert into t_res (ok, label) values (private.tire_cell_num('"8,5"') = 8.5 and private.tire_cell_num('"1.234,5"') = 1234.5
    and private.tire_cell_num('"abc"') = 'NaN' and private.tire_cell_ts('"05/10/2026 14:30"') = timestamp '2026-10-05 14:30'
    and private.tire_cell_ts('46000') = timestamp '2025-12-09' and private.tire_cell_ts('"31/02/2026"') = '-infinity', 'P1 conversões: vírgula decimal, milhar, data BR, serial Excel; inválido ≠ vazio');

  -- ---------------------------------------------------------------- P2 importação r1
  select jsonb_agg(jsonb_build_object('row_number', x.rn, 'cells', c.cells, 'raw', c.cells, 'flags', to_jsonb(coalesce(x.flags, '{}'::text[]))) order by x.rn)
    into rows1
    from (values
      (1, 'ZT9001', 'USO', v1.fleet, 'EDE', 8.0, 8.0, 8.0, 8.0, 8.0, 70.0, m1, m1, 1, 1000, null::text[]),
      (2, 'ZT9002', 'USO', v1.fleet, 'EDD', 7, 7, 7, 7, 7, 70, m1, m1, 1, 1000, null),
      (3, 'ZT9003', 'USO', v1.fleet, 'ETE', 6, 6, 6, 6, 6, 70, m1, m1, 1, 1000, null),
      (4, '0099005', 'USO', v1.fleet, 'ETD', 5, 5, 5, 5, 5, 70, m1, m1, 1, 1000, null),
      (5, 'ZT9010', 'USO', v2.fleet, 'EDE', 2.5, 2.5, 2.5, 2.5, 2.5, 60, m1, m1, 1, 1000, null),
      (6, 'ZT9011', 'USO', v2.fleet, 'EDD', 1.5, 1.5, 1.5, 1.5, 1.5, 70, m1, m1, 1, 1000, null),
      (7, 'ZT9012', 'USO', v2.fleet, 'ETE', 9, 9, 9, 9, 9, 70, m1, m1, 1, 1000, array['psi:date_serial']),
      (8, 'ZT9013', 'USO', v2.fleet, 'ETD', 9, 99, 9, 9, 4, 70, m1, m1, 1, -50, null),
      (9, 'ZT9020', 'ESTOQUE', null, null, null, null, null, null, null, null, null, null, 1, null, null),
      (10, 'ZT9021', 'DESCARTE', null, null, null, null, null, null, null, null, null, null, 2, null, null),
      (11, 'ZT9022', 'USO', 'ZZ-NAO-EXISTE', 'EDE', 7, 7, 7, 7, 7, 70, m1, m1, 1, 1000, null),
      (12, 'ZT9023', 'XPTO', null, null, null, null, null, null, null, null, null, null, 1, null, null),
      (13, 'ZT9025', 'ESTOQUE', null, null, 8, 8, 8, 8, 8, 70, fut, null, 1, null, null)
    ) x(rn, fire, st, fleet, pos, t1, t2, t3, t4, tmin, psi, meas, cal, life, kmreal, flags)
    cross join lateral (select jsonb_strip_nulls(jsonb_build_object('fire_number', x.fire, 'status_raw', x.st, 'fleet_number', x.fleet, 'position', x.pos,
        'tread_1', x.t1, 'tread_2', x.t2, 'tread_3', x.t3, 'tread_4', x.t4, 'tread_min', x.tmin, 'psi', x.psi,
        'measurement_at', to_char(x.meas, 'YYYY-MM-DD"T"HH24:MI:SS'), 'calibration_at', to_char(x.cal, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'life', x.life, 'km_real', x.kmreal, 'km_rodado', 1000, 'brand', 'MICHELIN', 'model', 'AGILIS', 'dimension', '205/75 R16')) as cells) c;

  v_res := public.tire_import_start(v_org, jsonb_build_object('file_name', 'teste-rodopar-r1.xlsx', 'file_hash', h1, 'reference_date', r1,
             'recognized_columns', v_cols, 'total_rows', 13, 'sheet_name', 'Planilha1', 'header_row', 1));
  b1 := (v_res ->> 'batch_id')::uuid;
  perform public.tire_import_stage(v_org, b1, rows1);
  perform public.tire_import_stage(v_org, b1, rows1);   -- reenvio da mesma parte não duplica
  v_res := public.tire_import_validate(v_org, b1);
  insert into t_res (ok, label) values (v_res ->> 'status' = 'validated' and (v_res ->> 'error_rows')::int = 0 and (v_res ->> 'total_rows')::int = 13
    and (v_res ->> 'new_tires')::int = 13 and (select count(*) from public.tire_import_staging s where s.batch_id = b1) = 13,
    'P2 staging + validação: 13 linhas (reenvio da parte não duplica), 0 erros, 13 novos');
  insert into t_res (ok, label) values ((v_res -> 'counters' -> 'issues' ->> 'km_real_negativo')::int = 1
    and (v_res -> 'counters' -> 'issues' ->> 'numero_formatado_como_data')::int = 1 and (v_res -> 'counters' -> 'issues' ->> 'sulco_invalido')::int = 1
    and (v_res -> 'counters' -> 'issues' ->> 'menor_mm_divergente')::int = 1 and (v_res -> 'counters' -> 'issues' ->> 'frota_nao_encontrada')::int = 1
    and (v_res -> 'counters' -> 'issues' ->> 'situacao_nao_reconhecida')::int = 1 and (v_res -> 'counters' -> 'issues' ->> 'data_futura')::int = 1,
    'P2 qualidade: KM Real negativo, PSI gravado como data, sulco inválido, menor mm divergente, frota inexistente, situação desconhecida, data futura');
  v_res2 := public.tire_import_preview(v_org, b1, 'new', null, 5, 0);
  insert into t_res (ok, label) values ((v_res2 ->> 'total')::int = 13 and jsonb_array_length(v_res2 -> 'rows') = 5
    and (public.tire_import_preview(v_org, b1, 'issues', 'km_real_negativo', 50, 0) ->> 'total')::int = 1
    and not exists (select 1 from public.tires t where t.organization_id = v_org), 'P2 prévia paginada (novos, filtro por inconsistência) e nada gravado no cadastro antes de confirmar');

  v_res := public.tire_import_confirm(v_org, b1);
  insert into t_res (ok, label) values ((v_res ->> 'snapshots')::int = 13 and (v_res ->> 'new_tires')::int = 13 and (v_res ->> 'events')::int = 13
    and (v_res ->> 'absent')::int = 0 and (select status from public.tire_import_batches where id = b1) = 'confirmed', 'P2 confirmação: 13 fotografias, 13 pneus, 13 TIRE_CREATED, lote confirmado');
  insert into t_res (ok, label) values (exists (select 1 from public.tires t where t.organization_id = v_org and t.fire_number = '0099005')
    and (select s.tread_2 is null and s.raw ->> 'tread_2' = '99' and s.tread_min = 4 and s.tread_divergence and s.km_real = -50
           from public.tire_daily_snapshots s where s.organization_id = v_org and s.fire_number = 'ZT9013')
    and (select s.psi = 70 and 'numero_formatado_como_data' = any (s.quality_flags) from public.tire_daily_snapshots s where s.organization_id = v_org and s.fire_number = 'ZT9012'),
    'P2 fotografia: Nº Fogo 0099005 intacto; sulco inválido anulado com bruto preservado; menor mm efetivo conservador; KM Real negativo preservado; PSI recuperado');
  insert into t_res (ok, label) values ((select s.vehicle_id = v1.id and s.operation_id is not null and s.enrichment_status = 'ok' and s.vehicle_type_id is not null
           from public.tire_daily_snapshots s where s.organization_id = v_org and s.fire_number = 'ZT9001')
    and (select s.vehicle_id is null and s.enrichment_status = 'frota_nao_encontrada' from public.tire_daily_snapshots s where s.organization_id = v_org and s.fire_number = 'ZT9022')
    and (select count(*) from public.vehicles v where v.organization_id = v_org and v.fleet_code = 'ZZ-NAO-EXISTE') = 0,
    'P2 contexto oficial por IDs na data (operação, tipo); frota inexistente não cria veículo');
  insert into t_res (ok, label) values (exists (select 1 from public.tire_audit_events a where a.organization_id = v_org and a.action = 'import.confirmed' and a.entity_id = b1 and a.actor_user_id = v_user and a.actor_name is not null)
    and exists (select 1 from public.outbox_events o where o.organization_id = v_org and o.event_type = 'tires.snapshot.confirmed' and o.aggregate_id = b1),
    'P2 auditoria com usuário identificado + evento tires.snapshot.confirmed no outbox');

  -- ---------------------------------------------------------------- P3 bloqueios
  begin
    perform public.tire_import_start(v_org, jsonb_build_object('file_name', 'repetido.xlsx', 'file_hash', h1, 'reference_date', v_today - 4, 'recognized_columns', v_cols));
    v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  insert into t_res (ok, label) values (v_hint = 'tire_duplicate_file', 'P3 mesmo arquivo (hash) já confirmado é recusado');
  begin
    perform public.tire_import_start(v_org, jsonb_build_object('file_name', 'antigo.xlsx', 'file_hash', h3, 'reference_date', r1, 'recognized_columns', v_cols));
    v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  insert into t_res (ok, label) values (v_hint = 'tire_reference_not_after_latest', 'P3 data de referência não posterior à última fotografia é recusada');
  rows3 := rows1 || jsonb_build_array(jsonb_set(rows1 -> 0, '{row_number}', '99'::jsonb))
           || jsonb_build_array(jsonb_set(jsonb_set(rows1 -> 1, '{row_number}', '98'::jsonb), '{cells,fire_number}', '"ZT9099"'::jsonb));
  rows3 := jsonb_set(rows3, '{13,cells,fire_number}', '"ZT9001"'::jsonb);
  rows3 := jsonb_set(rows3, '{14,cells,position}', '"EDE"'::jsonb);
  v_res := public.tire_import_start(v_org, jsonb_build_object('file_name', 'bloqueado.xlsx', 'file_hash', h3, 'reference_date', v_today - 4, 'recognized_columns', v_cols));
  b3 := (v_res ->> 'batch_id')::uuid;
  perform public.tire_import_stage(v_org, b3, rows3);
  v_res := public.tire_import_validate(v_org, b3);
  insert into t_res (ok, label) values (v_res ->> 'status' = 'blocked' and (v_res ->> 'error_rows')::int >= 3
    and (v_res -> 'counters' -> 'issues' ->> 'fogo_duplicado')::int = 2 and (v_res -> 'counters' -> 'issues' ->> 'colisao_posicao')::int >= 2,
    'P3 Nº Fogo duplicado e dois pneus na mesma frota+posição bloqueiam o lote');
  begin
    perform public.tire_import_confirm(v_org, b3); v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  perform public.tire_import_cancel(v_org, b3, 'teste de bloqueio');
  insert into t_res (ok, label) values (v_hint = 'tire_import_blocked' and (select status from public.tire_import_batches where id = b3) = 'cancelled'
    and (select count(*) from public.tire_daily_snapshots s where s.organization_id = v_org) = 13, 'P3 confirmação de lote bloqueado é recusada; cancelamento não altera a base');
  v_res := public.tire_import_start(v_org, jsonb_build_object('file_name', 'sem-colunas.xlsx', 'file_hash', h4, 'reference_date', v_today - 4,
             'recognized_columns', '["fire_number","status_raw","fleet_number","position"]'::jsonb));
  b4 := (v_res ->> 'batch_id')::uuid;
  perform public.tire_import_stage(v_org, b4, jsonb_build_array(rows1 -> 0));
  v_res := public.tire_import_validate(v_org, b4);
  perform public.tire_import_cancel(v_org, b4, 'teste de colunas');
  insert into t_res (ok, label) values (v_res ->> 'status' = 'blocked' and v_res ->> 'block_reason' like 'Colunas oficiais não reconhecidas%psi%', 'P3 colunas oficiais ausentes (ex.: PSI) bloqueiam — nada é inventado');

  -- ---------------------------------------------------------------- P4 leituras
  v_res := public.tires_overview(v_org, '{}'::jsonb);
  insert into t_res (ok, label) values (not (v_res ->> 'empty')::boolean and (v_res -> 'kpis' ->> 'total')::int = 13 and (v_res -> 'kpis' ->> 'em_uso')::int = 9
    and (v_res -> 'kpis' ->> 'below_legal')::int = 1 and (v_res -> 'kpis' ->> 'critical')::int = 2 and (v_res -> 'kpis' ->> 'psi_low')::int = 1
    and (v_res -> 'kpis' ->> 'in_use_without_vehicle')::int = 1 and (v_res -> 'kpis' ->> 'measurement_coverage_pct')::numeric = 100
    and (v_res -> 'kpis' ->> 'psi_no_rule')::int = 0, 'P4 visão geral: 13 pneus, 9 em uso, 1 abaixo do legal, 2 críticos, 1 PSI baixa, 1 em uso sem veículo, cobertura 100%');
  insert into t_res (ok, label) values (exists (select 1 from jsonb_array_elements(v_res -> 'insights') x where x ->> 'key' = 'below_legal' and (x ->> 'count')::int = 1)
    and not exists (select 1 from jsonb_array_elements(v_res -> 'insights') x where x ->> 'key' = 'measurement_overdue')
    and jsonb_array_length(v_res -> 'trend') = 1 and jsonb_array_length(v_res -> 'priorities') >= 2, 'P4 insights determinísticos (só quando o número existe), tendência e prioridades');
  v_res := public.tires_base(v_org, '{}'::jsonb, 'frota', null, 'asc', 50, 0);
  v_res2 := public.tires_base(v_org, '{}'::jsonb, 'fora', null, 'asc', 50, 0);
  insert into t_res (ok, label) values ((v_res ->> 'total')::int = 3 and (v_res -> 'summary' ->> 'tires')::int = 9 and (v_res2 ->> 'total')::int = 4
    and (public.tires_base(v_org, '{"search":"zt9013"}'::jsonb, 'fogo', null, 'asc', 50, 0) ->> 'total')::int = 1, 'P4 base geral: por frota (3 grupos, 9 pneus), fora da frota (4), busca por Nº Fogo');
  v_res := public.tires_adherence(v_org, 'measurement', '{}'::jsonb, 'all', 50, 0);
  v_res2 := public.tires_adherence(v_org, 'calibration', '{}'::jsonb, 'all', 50, 0);
  insert into t_res (ok, label) values ((v_res -> 'kpis' ->> 'eligible')::int = 9 and (v_res -> 'kpis' ->> 'adherence_pct')::numeric = 100
    and (v_res2 -> 'kpis' ->> 'pressure_adequate_pct')::numeric = 88.9 and jsonb_array_length(v_res2 -> 'gaps') = 0
    and v_res -> 'breakdowns' ? 'operation' and v_res -> 'breakdowns' ? 'br', 'P4 aderência MM 100% (9 elegíveis) e PSI adequada 88,9% com quebras por operação/BR');
  v_res := public.tires_schedule(v_org, '{}'::jsonb, 'todos', 50, 0);
  insert into t_res (ok, label) values ((v_res -> 'kpis' ->> 'units')::int = 3 and (v_res -> 'kpis' ->> 'measurement_overdue')::int = 0
    and v_res -> 'agenda' ? 'proximos_7', 'P4 cronograma por frota (3) e agenda de vencimentos');
  v_res := public.tires_quality(v_org, '{}'::jsonb, 'posicao_layout_vazia', 50, 0);
  insert into t_res (ok, label) values (exists (select 1 from jsonb_array_elements(v_res -> 'issues') x where x ->> 'code' = 'posicao_layout_vazia' and (x ->> 'count')::int = 2)
    and exists (select 1 from jsonb_array_elements(v_res -> 'issues') x where x ->> 'code' = 'km_real_negativo')
    and (v_res ->> 'issue_total')::int = 2 and (v_res ->> 'quality_score')::numeric < 100, 'P4 qualidade: estepe vazio do layout nas 2 frotas, KM Real negativo, score metodológico');
  v_res := public.tire_sheet(v_org, (select id from public.tires where organization_id = v_org and fire_number = 'ZT9013'));
  v_res2 := public.tires_vehicle_summary(v1.id);
  insert into t_res (ok, label) values (jsonb_array_length(v_res -> 'snapshots') = 1 and jsonb_array_length(v_res -> 'events') = 1
    and v_res -> 'current' ->> 'tread_class' is not null and v_res2 -> 'layout' ->> 'layout_source' = 'vehicle_type'
    and jsonb_array_length(v_res2 -> 'tires') = 4 and jsonb_array_length(v_res2 -> 'positions') = 5
    and jsonb_array_length(public.tires_filter_options(v_org, null) -> 'reference_dates') = 1
    and jsonb_array_length(public.tires_catalog(v_org) -> 'pressure_rules') = 6, 'P4 ficha 360°, resumo do veículo (layout do tipo, 4 pneus, 5 posições), opções e catálogo');

  -- ---------------------------------------------------------------- P5 app cego
  v_res := public.tire_inspection_context(v_org);
  insert into t_res (ok, label) values (v_res -> 'app' ->> 'id' is not null and (v_res ->> 'has_official_photo')::boolean, 'P5 contexto do app: aplicativo ativo e fotografia oficial disponível');
  v_res := public.tire_inspection_positions(v_org, v1.id);
  insert into t_res (ok, label) values (jsonb_array_length(v_res -> 'positions') = 5
    and not exists (select 1 from jsonb_array_elements(v_res -> 'positions') x, jsonb_object_keys(x) k
                     where k not in ('code', 'label', 'axle_group', 'axle_index', 'side', 'slot', 'sort_order'))
    and v_res::text !~* '(ZT90|0099005|tread|psi|fire)', 'P5 leitura cega: só posições e atributos de eixo — nenhum Nº Fogo, sulco ou PSI');
  ts1 := (select max(t.updated_at) from public.tires t where t.organization_id = v_org);
  v_res := public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', s_a, 'vehicle_id', v1.id, 'inspected_at', v_at, 'items', jsonb_build_array(
    jsonb_build_object('position_code', 'EDE', 'fire_number_read', 'ZT9001', 'tread_1', 7.5, 'tread_2', 7.5, 'tread_3', 7.5, 'tread_4', 7.5, 'psi_read', 72),
    jsonb_build_object('position_code', 'EDD', 'fire_number_read', 'ZT9002', 'tread_1', 5, 'tread_2', 5, 'tread_3', 5, 'tread_4', 5, 'psi_read', 70),
    jsonb_build_object('position_code', 'ETE', 'fire_number_read', 'ZT9003', 'tread_1', 6, 'tread_2', 6, 'tread_3', 6, 'tread_4', 6, 'psi_read', 50),
    jsonb_build_object('position_code', 'ETD', 'fire_number_read', 'ZT9020', 'tread_1', 8, 'tread_2', 8, 'tread_3', 8, 'tread_4', 8, 'psi_read', 70),
    jsonb_build_object('position_code', 'ESTEP1', 'fire_number_read', 'ZT9030', 'tread_1', 9, 'tread_2', 9, 'tread_3', 9, 'tread_4', 9, 'psi_read', 70))));
  i_a := (v_res ->> 'id')::uuid;
  insert into t_res (ok, label) values (v_res ->> 'protocol' like 'PNEU-' || to_char(v_today, 'YYYY') || '-%' and not (v_res ->> 'duplicate')::boolean
    and (v_res ->> 'positions_measured')::int = 5 and not (v_res ?| array['divergences', 'divergence_count', 'positions_divergent']),
    'P5 envio: protocolo PNEU-AAAA-NNNNNN; o retorno ao campo não traz divergência nem valor oficial');
  v_res2 := public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', s_a, 'vehicle_id', v1.id, 'inspected_at', v_at, 'items', '[]'::jsonb));
  insert into t_res (ok, label) values ((v_res2 ->> 'duplicate')::boolean and (v_res2 ->> 'id')::uuid = i_a
    and (select count(*) from public.tire_inspections i where i.client_submission_id = s_a) = 1, 'P5 reenvio com o mesmo client_submission_id não duplica');
  insert into t_res (ok, label) values ((select count(*) from public.tire_daily_snapshots s where s.organization_id = v_org) = 13
    and (select max(t.updated_at) from public.tires t where t.organization_id = v_org) = ts1
    and (select count(*) from public.tire_events e where e.organization_id = v_org) = 13, 'P5 a vistoria NÃO altera fotografia, cadastro nem eventos');
  insert into t_res (ok, label) values (
    (select not it.has_divergence from public.tire_inspection_items it where it.inspection_id = i_a and it.position_code = 'EDE')
    and exists (select 1 from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_a and it.position_code = 'EDD' and d ->> 'type' = 'SULCO_DIVERGENTE')
    and exists (select 1 from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_a and it.position_code = 'ETE' and d ->> 'type' = 'PSI_DIVERGENTE')
    and exists (select 1 from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_a and it.position_code = 'ETD' and d ->> 'type' = 'PNEU_DIFERENTE')
    and exists (select 1 from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_a and it.position_code = 'ETD' and d ->> 'type' = 'POSICAO_NAO_ENCONTRADA')
    and exists (select 1 from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_a and it.position_code = 'ESTEP1' and d ->> 'type' = 'SEM_REFERENCIA')
    and (select positions_divergent from public.tire_inspections where id = i_a) = 4
    and (select it.ref_tread_1 = 7 and it.expected_fire_number = 'ZT9002' from public.tire_inspection_items it where it.inspection_id = i_a and it.position_code = 'EDD'),
    'P5 comparação no servidor dentro da tolerância: SULCO, PSI, PNEU_DIFERENTE, POSICAO_NAO_ENCONTRADA, SEM_REFERENCIA; referência congelada');
  begin
    perform public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v1.id, 'inspected_at', v_at,
      'items', jsonb_build_array(jsonb_build_object('position_code', 'ETEE3', 'tread_1', 5))));
    v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  begin
    perform public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v1.id, 'inspected_at', v_at,
      'items', jsonb_build_array(jsonb_build_object('position_code', 'EDE', 'tread_1', 45))));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  begin
    perform public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v1.id, 'inspected_at', v_at,
      'items', jsonb_build_array(jsonb_build_object('position_code', 'EDE'))));
    v_txt := null;
  exception when others then v_txt := sqlerrm; end;
  insert into t_res (ok, label) values (v_hint = 'POSICAO_NAO_ENCONTRADA' and v_err like 'Sulco inválido%' and v_txt like 'Meça ao menos%',
    'P5 recusa posição que não é do veículo, sulco fora do limite técnico e envio sem nenhuma medição');
  i_b := (public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v2.id, 'inspected_at', v_at,
    'items', jsonb_build_array(jsonb_build_object('position_code', 'EDE', 'fire_number_read', 'ZT9010', 'tread_1', 2.5, 'tread_2', 2.5, 'tread_3', 2.5, 'tread_4', 2.5, 'psi_read', 61)))) ->> 'id')::uuid;
  i_c := (public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v2.id, 'inspected_at', v_at,
    'items', jsonb_build_array(jsonb_build_object('position_code', 'EDD', 'fire_number_read', 'ZT9011', 'tread_1', 3, 'tread_2', 3, 'tread_3', 3, 'tread_4', 3, 'psi_read', 70)))) ->> 'id')::uuid;
  i_e := (public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v2.id, 'inspected_at', v_at,
    'items', jsonb_build_array(jsonb_build_object('position_code', 'ETE', 'fire_number_read', 'ZT9012', 'tread_1', 9, 'tread_2', 9, 'tread_3', 9, 'tread_4', 9, 'psi_read', 80)))) ->> 'id')::uuid;
  insert into t_res (ok, label) values ((select positions_expected = 5 and positions_measured = 1 and positions_divergent = 0 from public.tire_inspections where id = i_b)
    and (select count(*) from public.tire_inspection_items it, jsonb_array_elements(it.divergences) d where it.inspection_id = i_b and d ->> 'type' = 'MEDICAO_INCOMPLETA') = 4
    and (select count(*) from public.tire_inspection_items it where it.inspection_id = i_b and it.sync_status = 'not_applicable') = 4,
    'P5 posições não medidas ficam registradas como MEDICAO_INCOMPLETA (não contam como divergência)');
  v_res := public.tire_my_inspection_detail(v_org, i_c);
  insert into t_res (ok, label) values (not exists (select 1 from jsonb_array_elements(v_res -> 'items') x, jsonb_object_keys(x) k where k like 'ref%' or k like 'expected%')
    and not exists (select 1 from jsonb_array_elements(v_res -> 'items') x where jsonb_array_length(x -> 'divergence_types') > 0)
    and (public.tire_my_inspections(v_org, 30, 0) ->> 'total')::int = 4, 'P5 Minhas vistorias: só leituras próprias, sem valor oficial nem divergência enquanto em revisão');

  -- ---------------------------------------------------------------- P6 workflow
  begin
    perform public.tire_inspection_transition(v_org, i_c, 'retornar_divergencia', null); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Informe o motivo do retorno%', 'P6 retorno sem motivo é recusado');
  perform public.tire_inspection_transition(v_org, i_c, 'retornar_divergencia', 'Sulco da EDD muito acima do oficial: medir novamente');
  v_res := public.tire_my_inspection_detail(v_org, i_c);
  insert into t_res (ok, label) values ((select status from public.tire_inspections where id = i_c) = 'retornar_divergencia'
    and exists (select 1 from public.outbox_events o where o.aggregate_id = i_c and o.event_type = 'tires.inspection.returned' and o.payload ? 'leader_employee_id')
    and exists (select 1 from public.tire_audit_events a where a.entity_id = i_c and a.action = 'inspection.retornar_divergencia' and a.actor_user_id = v_user)
    and exists (select 1 from jsonb_array_elements(v_res -> 'items') x where x -> 'divergence_types' ? 'SULCO_DIVERGENTE')
    and v_res ->> 'review_note' like 'Sulco da EDD%' and (public.tire_inspection_context(v_org) -> 'counts' ->> 'mine_returned')::int = 1,
    'P6 retorno com motivo: alerta à liderança (outbox), auditoria, executor vê só o tipo da divergência e o motivo');
  i_d := (public.tire_inspection_submit(v_org, jsonb_build_object('client_submission_id', gen_random_uuid(), 'vehicle_id', v2.id, 'inspected_at', v_at, 'parent_inspection_id', i_c,
    'items', jsonb_build_array(jsonb_build_object('position_code', 'EDD', 'fire_number_read', 'ZT9011', 'tread_1', 1.5, 'tread_2', 1.5, 'tread_3', 1.5, 'tread_4', 1.5, 'psi_read', 70)))) ->> 'id')::uuid;
  insert into t_res (ok, label) values ((select status from public.tire_inspections where id = i_c) = 'substituida'
    and (select status = 'pendente_revisao' and parent_inspection_id = i_c and positions_divergent = 0 from public.tire_inspections where id = i_d)
    and exists (select 1 from public.tire_inspection_status_history h where h.inspection_id = i_c and h.to_status = 'substituida'),
    'P6 nova medição sobre a vistoria retornada a substitui (histórico preservado)');
  begin
    perform public.tire_inspection_transition(v_org, i_a, 'sincronizado_rodopar', 'pular etapa'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform public.tire_inspection_transition(v_org, i_a, 'pendente_rodopar', null);
  perform public.tire_inspection_transition(v_org, i_b, 'pendente_rodopar', null);
  perform public.tire_inspection_transition(v_org, i_e, 'pendente_rodopar', null);
  v_res := public.tire_inspections_received(v_org, '{}'::jsonb, 50, 0);
  insert into t_res (ok, label) values (v_err like 'Transição não permitida%' and (v_res -> 'kpis' ->> 'pendente_rodopar')::int = 3
    and (v_res -> 'kpis' ->> 'pendente_revisao')::int = 1 and (v_res -> 'kpis' ->> 'substituida')::int = 1
    and (select approved_at is not null from public.tire_inspections where id = i_a)
    and public.tire_inspection_detail(v_org, i_a) -> 'transitions' = '["sincronizado_rodopar", "retornar_divergencia"]'::jsonb,
    'P6 transição inválida recusada; aprovadas → pendente de lançamento no Rodopar; fila com KPIs');

  -- ---------------------------------------------------------------- P7 importação r2 + reconciliação
  select jsonb_agg(jsonb_build_object('row_number', x.rn, 'cells', c.cells, 'raw', c.cells, 'flags', to_jsonb(coalesce(x.flags, '{}'::text[]))) order by x.rn)
    into rows2
    from (values
      (1, 'ZT9001', 'USO', v1.fleet, 'EDE', 7.5, 7.5, 7.5, 7.5, 7.5, 72.0, m2, m2, 1, 1000, null::text[]),
      (2, 'ZT9002', 'USO', v1.fleet, 'EDD', 5, 5, 5, 5, 5, 70, m2, m1, 1, 1000, null),
      (3, 'ZT9003', 'USO', v1.fleet, 'ETE', 6, 6, 6, 6, 6, 50, m1, m2, 1, 1000, null),
      (4, '0099005', 'ESTOQUE', null, null, 5, 5, 5, 5, 5, 70, m1, m1, 1, 1000, null),
      (5, 'ZT9010', 'USO', v2.fleet, 'EDE', 4, 4, 4, 4, 4, 61, m2, m2, 1, 1000, null),
      (6, 'ZT9011', 'USO', v2.fleet, 'ETD', 1.5, 1.5, 1.5, 1.5, 1.5, 70, m1, m1, 1, 1000, null),
      (7, 'ZT9012', 'USO', v2.fleet, 'ETE', 9, 9, 9, 9, 9, 70, m1, m1, 1, 1000, array['psi:date_serial']),
      (8, 'ZT9013', 'USO', v2.fleet, 'EDD', 9, 99, 9, 9, 4, 70, m1, m1, 1, -50, null),
      (9, 'ZT9020', 'USO', v1.fleet, 'ETD', 8, 8, 8, 8, 8, 70, m2, m2, 1, null, null),
      (10, 'ZT9021', 'DESCARTE', null, null, null, null, null, null, null, null, null, null, 2, null, null),
      (12, 'ZT9023', 'XPTO', null, null, null, null, null, null, null, null, null, null, 2, null, null),
      (13, 'ZT9025', 'ESTOQUE', null, null, 8, 8, 8, 8, 8, 70, fut, null, 1, null, null),
      (14, 'ZT9030', 'USO', v1.fleet, 'ESTEP1', 9, 9, 9, 9, 9, 70, m2, m2, 1, null, null)
    ) x(rn, fire, st, fleet, pos, t1, t2, t3, t4, tmin, psi, meas, cal, life, kmreal, flags)
    cross join lateral (select jsonb_strip_nulls(jsonb_build_object('fire_number', x.fire, 'status_raw', x.st, 'fleet_number', x.fleet, 'position', x.pos,
        'tread_1', x.t1, 'tread_2', x.t2, 'tread_3', x.t3, 'tread_4', x.t4, 'tread_min', x.tmin, 'psi', x.psi,
        'measurement_at', to_char(x.meas, 'YYYY-MM-DD"T"HH24:MI:SS'), 'calibration_at', to_char(x.cal, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'life', x.life, 'km_real', x.kmreal, 'km_rodado', 1000, 'brand', 'MICHELIN', 'model', 'AGILIS', 'dimension', '205/75 R16')) as cells) c;
  v_res := public.tire_import_start(v_org, jsonb_build_object('file_name', 'teste-rodopar-r2.xlsx', 'file_hash', h2, 'reference_date', r2, 'recognized_columns', v_cols));
  b2 := (v_res ->> 'batch_id')::uuid;
  perform public.tire_import_stage(v_org, b2, rows2);
  v_res := public.tire_import_validate(v_org, b2);
  insert into t_res (ok, label) values (v_res ->> 'status' = 'validated' and (v_res ->> 'new_tires')::int = 1 and (v_res ->> 'absent_tires')::int = 1
    and (public.tire_import_preview(v_org, b2, 'absent', null, 50, 0) ->> 'total')::int = 1
    and (public.tire_import_preview(v_org, b2, 'changes', 'position', 50, 0) ->> 'total')::int = 2, 'P7 prévia r2: 1 novo, 1 ausente, 2 trocas de posição');
  v_res := public.tire_import_confirm(v_org, b2);
  insert into t_res (ok, label) values (v_res -> 'reconciliation' = '{"checked": 3, "synced": 1, "persistent": 1, "pending": 1}'::jsonb,
    'P7 reconciliação automática: 3 aprovadas conferidas → 1 sincronizada, 1 persistente, 1 pendente');
  insert into t_res (ok, label) values ((select status = 'sincronizado_rodopar' and synced_batch_id = b2 and not persistent_divergence from public.tire_inspections where id = i_a)
    and exists (select 1 from public.tire_inspection_status_history h where h.inspection_id = i_a and h.to_status = 'sincronizado_rodopar' and h.source = 'import' and h.import_batch_id = b2)
    and (select count(*) from public.tire_inspection_items it where it.inspection_id = i_a and it.sync_status = 'synced') = 5,
    'P7 vistoria cujos valores chegaram na fotografia vira Sincronizada (origem: importação)');
  insert into t_res (ok, label) values ((select status = 'pendente_rodopar' and persistent_divergence from public.tire_inspections where id = i_b)
    and exists (select 1 from public.outbox_events o where o.aggregate_id = i_b and o.event_type = 'tires.inspection.persistent_divergence')
    and (select status = 'pendente_rodopar' and not persistent_divergence from public.tire_inspections where id = i_e)
    and (select it.sync_status from public.tire_inspection_items it where it.inspection_id = i_e and it.position_code = 'ETE') = 'pending'
    and (select status from public.tire_inspections where id = i_d) = 'pendente_revisao',
    'P7 lançada e ainda diferente = divergência persistente (alerta); não lançada = pendente; em revisão não é tocada');
  insert into t_res (ok, label) values (
    exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9030' and e.event_type = 'TIRE_CREATED' and e.reference_date = r2)
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9020' and e.event_type = 'TIRE_MOVED' and e.vehicle_id = v1.id)
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = '0099005' and e.event_type = 'TIRE_RETURNED_TO_STOCK' and e.previous_vehicle_id = v1.id)
    and (select count(*) from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number in ('ZT9011', 'ZT9013') and e.event_type = 'TIRE_POSITION_CHANGED' and e.reference_date = r2) = 2
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9023' and e.event_type = 'TIRE_LIFE_CHANGED')
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9001' and e.event_type = 'TIRE_MEASURED')
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9001' and e.event_type = 'TIRE_PRESSURE_UPDATED')
    and not exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9021' and e.reference_date = r2),
    'P7 eventos r2: criado, movido, devolvido ao estoque, troca de posição, vida, medição, calibragem; inalterado não gera evento');
  insert into t_res (ok, label) values ((select presence_status = 'absent' and absent_since = r2 and current_snapshot_id is not null from public.tires where organization_id = v_org and fire_number = 'ZT9022')
    and exists (select 1 from public.tire_events e join public.tires t on t.id = e.tire_id where t.fire_number = 'ZT9022' and e.event_type = 'TIRE_ABSENT')
    and (select count(*) from public.tires where organization_id = v_org) = 14 and (select count(*) from public.tire_daily_snapshots where organization_id = v_org) = 26,
    'P7 pneu ausente no novo relatório NÃO é excluído (ausente desde r2, última fotografia mantida)');
  begin
    perform public.tire_import_start(v_org, jsonb_build_object('file_name', 'r2-de-novo.xlsx', 'file_hash', h2, 'reference_date', v_today, 'recognized_columns', v_cols));
    v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  v_res := public.tires_overview(v_org, '{}'::jsonb);
  insert into t_res (ok, label) values (v_hint = 'tire_duplicate_file' and jsonb_array_length(v_res -> 'trend') = 2 and (v_res -> 'kpis' ->> 'absent')::int = 1
    and (v_res -> 'trend' -> 0 ->> 'psi_out')::int = 1
    and v_res ->> 'previous_reference_date' = r1::text and (v_res -> 'kpis' ->> 'movements_30d')::int >= 4
    and (public.tires_events_list(v_org, '{"event_types":["TIRE_POSITION_CHANGED"]}'::jsonb, 50, 0) ->> 'total')::int = 2,
    'P7 reimportar o mesmo arquivo é recusado (idempotência); tendência por fotografia (regras da implantação valem para a foto anterior); eventos filtráveis');

  -- ---------------------------------------------------------------- P8 serviços
  v_res := public.tire_repair_resolve(v_org, 'zt9002', v_today);
  v_res2 := public.tire_repair_resolve(v_org, 'ZT9002', r1);
  insert into t_res (ok, label) values ((v_res ->> 'found')::boolean and v_res -> 'suggestion' ->> 'resolution' = 'snapshot_previous'
    and (v_res -> 'suggestion' ->> 'vehicle_id')::uuid = v1.id and v_res -> 'suggestion' ->> 'confidence' = 'high'
    and v_res2 -> 'suggestion' ->> 'resolution' = 'snapshot_exact', 'P8 veículo do conserto resolvido pela fotografia da data (não pela placa atual)');
  begin
    perform public.tire_repair_save(v_org, jsonb_build_object('fire_number', 'ZT9002', 'service_date', v_today, 'repair_type', 'Conserto de furo', 'vehicle_id', v2.id));
    v_hint := null;
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  rp1 := (public.tire_repair_save(v_org, jsonb_build_object('fire_number', 'ZT9002', 'service_date', v_today, 'repair_type', 'Conserto de furo', 'notes', 'teste')) ->> 'id')::uuid;
  rp2 := (public.tire_repair_save(v_org, jsonb_build_object('fire_number', 'ZT9002', 'service_date', v_today, 'repair_type', 'Vulcanização',
             'vehicle_id', v2.id, 'override_reason', 'Pneu emprestado para a outra frota')) ->> 'id')::uuid;
  begin
    perform public.tire_repair_void(v_org, rp2, 'x'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform public.tire_repair_void(v_org, rp2, 'Lançado em duplicidade');
  v_res := public.tire_repairs_list(v_org, '{}'::jsonb, 50, 0);
  insert into t_res (ok, label) values (v_hint = 'tire_repair_override_reason' and v_err like 'Informe o motivo%'
    and (select vehicle_resolution = 'snapshot_previous' and vehicle_id = v1.id and created_by = v_user from public.tire_repairs where id = rp1)
    and (select vehicle_resolution = 'manual' and resolution_confidence = 'manual' and status = 'voided' from public.tire_repairs where id = rp2)
    and (v_res ->> 'total')::int = 1 and (select count(*) from public.tire_repairs where organization_id = v_org) = 2,
    'P8 consertos: troca de veículo exige justificativa; cancelamento exige motivo e nada é apagado');
  v_res := public.tire_maintenance_services(v_org, '{}'::jsonb, 10, 0);
  insert into t_res (ok, label) values ((v_res ->> 'mapped_services')::int = (select count(*) from public.tire_maintenance_service_kinds k where k.organization_id = v_org and k.is_active)
    and v_res -> 'kpis' ? 'alignment_balancing', 'P8 alinhamento/balanceamento lidos da Gestão de Manutenção (sem base paralela)');

  -- ---------------------------------------------------------------- P9 parâmetros
  v_res := public.tire_save_parameters(v_org, '{"inspection_psi_tolerance": 10}'::jsonb);
  insert into t_res (ok, label) values ((v_res ->> 'inspection_psi_tolerance')::numeric = 10 and (private.tire_params_at(v_org, v_today)).inspection_psi_tolerance = 10
    and exists (select 1 from public.tire_audit_events a where a.organization_id = v_org and a.action = 'parameters.saved' and a.actor_user_id = v_user),
    'P9 parâmetros salvos pelo formulário, com vigência e auditoria (sem JSON manual)');
  begin
    perform public.tire_save_pressure_rule(v_org, jsonb_build_object('dimension', '205/75 R16', 'min_psi', 60, 'ideal_psi', 65, 'max_psi', 70)); v_err := null;
  exception when others then v_err := sqlerrm; end;
  perform public.tire_save_pressure_rule(v_org, jsonb_build_object('dimension', '205/75 R16', 'position_code', 'EDE', 'min_psi', 80, 'ideal_psi', 85, 'max_psi', 90, 'notes', 'teste'));
  select x.psi_status, x.psi_min into v_txt, n from private.tire_rows(v_org, '{"search":"ZT9001"}'::jsonb) x where x.fire_number = 'ZT9001';
  insert into t_res (ok, label) values (v_err like 'Já existe uma regra ativa%' and v_txt = 'baixa' and n = 80
    and (select x.psi_status from private.tire_rows(v_org, '{"search":"ZT9002"}'::jsonb) x where x.fire_number = 'ZT9002') = 'adequada',
    'P9 regra duplicada recusada; regra mais específica (dimensão + posição) vence a geral');
  select id into v_lay from public.tire_layouts where organization_id = v_org and code = 'caminhao_1_traseiro_duplo';
  perform public.tire_set_vehicle_layout(v_org, v1.id, v_lay, 'teste de layout por veículo');
  select layout_source into v_txt from private.tire_vehicle_layout(v_org, v1.id, null);
  perform public.tire_set_vehicle_layout(v_org, v1.id, null, 'volta ao padrão do tipo');
  perform public.log_tire_export(v_org, 'base', '{}'::jsonb, 14);
  insert into t_res (ok, label) values (v_txt = 'vehicle' and (select layout_source from private.tire_vehicle_layout(v_org, v1.id, null)) = 'vehicle_type'
    and exists (select 1 from public.tire_audit_events a where a.organization_id = v_org and a.action = 'export.base')
    and (public.tires_audit_list(v_org, '{}'::jsonb, 50, 0) ->> 'total')::int >= 8, 'P9 layout por veículo prevalece e volta ao do tipo; exportação e trilha auditadas');

  -- ---------------------------------------------------------------- P10 RBAC / RLS / CPK
  set local role authenticated;
  select count(*) into n from public.tires;
  select count(*) into n2 from public.tire_daily_snapshots;
  select count(*) into n3 from public.tire_inspections;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select (select count(*) from public.tires) + (select count(*) from public.tire_daily_snapshots)
       + (select count(*) from public.tire_inspections) + (select count(*) from public.tire_audit_events) into n4;
  begin
    perform public.tires_overview(v_org, '{}'::jsonb); v_err := null;
  exception when others then v_err := sqlerrm; end;
  begin
    perform public.tire_inspection_context(v_org); v_hint := null;
  exception when others then v_hint := sqlerrm; end;
  begin
    perform public.tire_import_start(v_org, jsonb_build_object('file_name', 'x.xlsx', 'file_hash', h4, 'reference_date', v_today)); v_txt := null;
  exception when others then v_txt := sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  insert into t_res (ok, label) values (n = 14 and n2 = 26 and n3 = 5 and n4 = 0,
    'P10 RLS real: administrador lê pneus, fotografias e vistorias; não membro não lê nada (nem auditoria)');
  insert into t_res (ok, label) values (v_err like 'Sem permissão%' and v_hint like 'Sem permissão%' and v_txt like 'Sem permissão%',
    'P10 RBAC no servidor: não membro não consulta, não executa o app e não importa');
  insert into t_res (ok, label) values (
    (select count(*) from public.access_profile_defaults d where d.profile_code = 'operacional' and d.permission_code = 'applications.tires.execute') = 1
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'operacional' and d.permission_code like 'tires.%') = 0
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'lideranca_operacoes' and d.permission_code in ('tires.import', 'tires.parameters.manage', 'tires.inspection.review')) = 0
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'seguranca' and d.permission_code = 'tires.import') = 0
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'gestor_frota' and (d.permission_code like 'tires.%' or d.permission_code = 'applications.tires.execute')) = 16
    and (select count(*) from public.permissions x where x.module = 'tires') = 15,
    'P10 perfis oficiais: Operacional só executa o app; Liderança não importa nem revisa; Gestor de Frota tem as 16');
  insert into t_res (ok, label) values (
    (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name like 'tire%'
      and c.column_name ~ '(cpk|custo|valor|price|preco|amount|^cost$|_cost$|^cost_per|total_cost)') = 0
    and (select count(*) from public.permissions x where x.code ilike '%cpk%' or (x.module = 'tires' and (x.code ilike '%cost%' or x.code ilike '%custo%'))) = 0
    and (select count(*) from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace where ns.nspname in ('public', 'private') and pr.proname ilike '%cpk%') = 0
    and (select count(*) from information_schema.tables t where t.table_schema = 'public' and t.table_name ilike '%cpk%') = 0,
    'P10 CPK fora do escopo: nenhuma tabela, coluna financeira, função ou permissão de CPK/custo');

  select count(*) filter (where ok), count(*) filter (where not ok) into np, nf from t_res;
  select string_agg(format('%s  %s', case when ok then 'PASS' else 'FAIL' end, label), E'\n' order by seq) into r from t_res;
  raise exception E'ROLLBACK_TESTES\n%\n\nRESULTADO: % PASS · % FAIL (frotas % e %)', r, np, nf, v1.fleet, v2.fleet;
end $t$;
