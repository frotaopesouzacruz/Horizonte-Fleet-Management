-- =============================================================================
-- Gestão de Pneus — evolução: conformidade centralizada, Prioridades,
-- indicadores, histórico de KPIs (snapshots), Central de Auditoria e
-- sincronização. Roda numa base com dados de pneus confirmados e DESFAZ tudo
-- ao final (raise exception 'ROLLBACK_TESTES'): seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/33_tires_evolution.sql
--   → a última linha deve ser "ROLLBACK_TESTES 33 OK (<n> verificações)".
-- =============================================================================
do $t$
declare
  org   uuid := (select b.organization_id from public.tire_import_batches b where b.status = 'confirmed' order by b.confirmed_at desc limit 1);
  adm   uuid := (select m.user_id from public.organization_memberships m join public.membership_roles mr on mr.membership_id = m.id
                   join public.roles ro on ro.id = mr.role_id
                  where m.organization_id = org and m.status = 'active' and ro.code = 'administrador' order by m.created_at limit 1);
  n     int := 0;
  j     jsonb; k jsonb; r record;
  v_in_use int; v_mm int; v_meas int; v_cal int; v_psi int; v_calconf int; v_all int;
  v_run uuid; v_run2 uuid;
  procedure_ok boolean;
begin
  if org is null then raise exception 'sem dados de pneus confirmados para testar'; end if;

  -- ---------------------------------------------------------------- 1. definições (funções puras)
  assert private.tire_overall_conform('adequado', 'em_dia', 'proximo', 'adequada'), 'geral: tudo ok'; n := n + 1;
  assert private.tire_overall_conform('atencao', 'proximo', 'em_dia', 'adequada'), 'geral: atenção e próximo contam como ok'; n := n + 1;
  assert not private.tire_overall_conform('critico', 'em_dia', 'em_dia', 'adequada'), 'geral: sulco crítico'; n := n + 1;
  assert not private.tire_overall_conform('adequado', 'vencido', 'em_dia', 'adequada'), 'geral: medição vencida'; n := n + 1;
  assert not private.tire_overall_conform('adequado', 'em_dia', 'sem_registro', 'adequada'), 'geral: sem calibragem'; n := n + 1;
  assert not private.tire_overall_conform('adequado', 'em_dia', 'em_dia', 'sem_parametro'), 'geral: sem parâmetro não é adequado'; n := n + 1;
  assert not private.tire_overall_conform('sem_medicao', 'em_dia', 'em_dia', 'adequada'), 'geral: sem medição'; n := n + 1;
  assert not private.tire_calibration_conform('em_dia', 'baixa'), 'calibragem: no prazo com PSI baixo não é conforme'; n := n + 1;
  assert not private.tire_calibration_conform('vencido', 'adequada'), 'calibragem: PSI ok com prazo vencido'; n := n + 1;
  assert private.tire_calibration_conform('proximo', 'adequada'), 'calibragem: próximo + adequada'; n := n + 1;
  assert private.tire_nonconformity_reasons('critico', 'vencido', 'em_dia', 'excesso') = array['sulco_critico', 'medicao_vencida', 'psi_excesso'],
    'motivos na ordem sulco → medição → calibragem → PSI'; n := n + 1;
  assert private.tire_criticality('critica') = 'critico' and private.tire_criticality('ok') = 'ok', 'criticidade'; n := n + 1;
  assert private.tire_fleet_status(1, 0, 0, 0, 0, 0, 0) = 'critico' and private.tire_fleet_status(0, 0, 0, 1, 0, 0, 0) = 'atencao'
     and private.tire_fleet_status(0, 0, 0, 0, 0, 0, 0) = 'ok', 'situação da frota'; n := n + 1;

  -- ---------------------------------------------------------------- 2. amostra manual × telas
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- contagem independente: só os status crus de tire_rows, sem as funções novas
  select count(*),
         count(*) filter (where x.tread_class in ('adequado', 'atencao')),
         count(*) filter (where x.measurement_status in ('em_dia', 'proximo')),
         count(*) filter (where x.calibration_status in ('em_dia', 'proximo')),
         count(*) filter (where x.psi_status = 'adequada'),
         count(*) filter (where x.calibration_status in ('em_dia', 'proximo') and x.psi_status = 'adequada'),
         count(*) filter (where x.tread_class in ('adequado', 'atencao') and x.measurement_status in ('em_dia', 'proximo')
                            and x.calibration_status in ('em_dia', 'proximo') and x.psi_status = 'adequada')
    into v_in_use, v_mm, v_meas, v_cal, v_psi, v_calconf, v_all
    from private.tire_rows(org, '{}'::jsonb, greatest(private.maintenance_today(org), private.tire_latest_reference(org))) x
   where x.canonical_status = 'em_uso';
  j := public.tires_overview(org, '{}'::jsonb);
  assert (j -> 'conformity' ->> 'base')::int = v_in_use, 'base = pneus em uso'; n := n + 1;
  assert (j -> 'conformity' -> 'tread' ->> 'ok')::int = v_mm, 'sulco OK'; n := n + 1;
  assert (j -> 'conformity' -> 'measurement' ->> 'ok')::int = v_meas, 'prazo de medição OK'; n := n + 1;
  assert (j -> 'conformity' -> 'calibration' ->> 'ok')::int = v_cal, 'prazo de calibragem OK'; n := n + 1;
  assert (j -> 'conformity' -> 'psi' ->> 'ok')::int = v_psi, 'PSI OK'; n := n + 1;
  assert (j -> 'conformity' -> 'calibration_conformity' ->> 'ok')::int = v_calconf, 'conformidade geral de calibragem'; n := n + 1;
  assert (j -> 'conformity' -> 'overall' ->> 'ok')::int = v_all, 'conformidade geral dos pneus'; n := n + 1;
  assert (j -> 'conformity' -> 'overall' ->> 'pct')::numeric = round(100.0 * v_all / nullif(v_in_use, 0), 1), '% geral'; n := n + 1;
  assert (j -> 'kpis' ->> 'fora_da_frota')::int = (j -> 'kpis' ->> 'total')::int - (j -> 'kpis' ->> 'em_uso')::int, 'fora da frota'; n := n + 1;
  assert not (j ? 'trend') and not (j::text ilike '%fotografia%'), 'visão geral sem "fotografia"'; n := n + 1;
  -- a mesma regra em todas as telas
  k := public.tires_indicator(org, 'overall', '{}'::jsonb, null, 5, 0);
  assert (k -> 'kpis' ->> 'ok')::int = v_all and (k -> 'kpis' ->> 'base')::int = v_in_use, 'indicador geral = visão geral'; n := n + 1;
  k := public.tires_indicator(org, 'calibration_conformity', '{}'::jsonb, null, 5, 0);
  assert (k -> 'kpis' ->> 'ok')::int = v_calconf, 'indicador de calibragem = visão geral'; n := n + 1;
  assert coalesce((k -> 'distribution' ->> 'prazo_ok_psi_inadequado')::int, 0) = (k -> 'details' ->> 'on_time_bad_psi')::int,
    'no prazo com PSI inadequado separado'; n := n + 1;
  k := public.tires_indicator(org, 'psi', '{}'::jsonb, null, 5, 0);
  assert (k -> 'kpis' ->> 'ok')::int = v_psi, 'indicador PSI'; n := n + 1;
  k := public.tires_adherence(org, 'measurement', '{}'::jsonb);
  assert (k -> 'kpis' ->> 'adherence_pct')::numeric = round(100.0 * v_meas / nullif(v_in_use, 0), 1), 'aderência antiga = mesma definição'; n := n + 1;
  k := public.tires_base(org, jsonb_build_object('overall_conformity', 'nao_conforme'), 'fogo', null, 'asc', 1, 0);
  assert (k ->> 'total')::int = v_in_use - v_all, 'recorte não conformes'; n := n + 1;
  -- prioridades: grupos ordenados do mais crítico; soma = pneus em uso
  k := public.tires_priorities(org, '{}'::jsonb, 'operation', null, 10, 0);
  assert (select sum((g ->> 'tires')::int) from jsonb_array_elements(k -> 'groups') g) = v_in_use, 'prioridades cobrem os pneus em uso'; n := n + 1;
  assert (select bool_and(coalesce((a ->> 'critico')::int >= (b ->> 'critico')::int, true))
            from jsonb_array_elements(k -> 'groups') with ordinality a(a, i)
            left join jsonb_array_elements(k -> 'groups') with ordinality b(b, i2) on i2 = i + 1), 'ordem por críticos'; n := n + 1;
  k := public.tires_base_groups(org, '{}'::jsonb, 'leader');
  assert (select sum((g ->> 'tires')::int) from jsonb_array_elements(k -> 'groups') g) = v_in_use, 'base agrupada cobre os pneus em uso'; n := n + 1;
  k := public.tires_filter_options(org, null);
  assert jsonb_array_length(k -> 'combos') > 0, 'combinações para a cascata'; n := n + 1;
  execute 'reset role';

  -- ---------------------------------------------------------------- 3. snapshots semanais (imutáveis, sem duplicar)
  perform private.tire_kpi_tick(now() + interval '30 days'); -- período futuro de teste
  select r2.id into v_run from public.tire_kpi_runs r2 where r2.organization_id = org order by r2.started_at desc limit 1;
  assert v_run is not null, 'captura criada'; n := n + 1;
  assert (select status from public.tire_kpi_runs where id = v_run) in ('concluida', 'ignorada'), 'captura concluída (ou ignorada pela janela)'; n := n + 1;
  if (select status from public.tire_kpi_runs where id = v_run) = 'concluida' then
    perform private.tire_kpi_tick(now() + interval '30 days' + interval '10 minutes');
    assert (select count(*) from public.tire_kpi_runs x join public.tire_kpi_runs y on y.id = v_run
             where x.organization_id = org and x.period_key = y.period_key and x.status = 'concluida') = 1, 'sem captura duplicada'; n := n + 1;
    procedure_ok := false;
    begin
      update public.tire_kpi_values set percentage = 0 where run_id = v_run;
    exception when insufficient_privilege then procedure_ok := true;
    end;
    assert procedure_ok, 'valores imutáveis (update)'; n := n + 1;
    -- (a recusa de DELETE é provada no teste local de integração; aqui não se envia DELETE)
    procedure_ok := false;
    begin
      update public.tire_kpi_runs set error_message = 'x' where id = v_run;
    exception when insufficient_privilege then procedure_ok := true;
    end;
    assert procedure_ok, 'execução encerrada imutável'; n := n + 1;
    assert (select v.numerator from public.tire_kpi_values v where v.run_id = v_run and v.indicator = 'overall_conformity' and v.dimension = 'geral')
           is not null, 'valor geral gravado'; n := n + 1;
    -- semana seguinte → comparação semana × semana
    perform private.tire_kpi_tick(now() + interval '37 days');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    j := public.tires_kpi_history(org, 'semana', 'overall_conformity', 'geral', null);
    assert jsonb_array_length(j -> 'series') >= 2, 'série semanal com ao menos 2 pontos'; n := n + 1;
    assert (select bool_and(s ? 'current' and s ? 'previous') from jsonb_array_elements(j -> 'summary') s), 'resumo atual × anterior'; n := n + 1;
    j := public.tires_kpi_history(org, 'mes', 'overall_conformity', 'geral', null);
    assert jsonb_array_length(j -> 'series') >= 1, 'série mensal'; n := n + 1;
    j := public.tires_kpi_history(org, 'semana', 'psi_conformity', 'operation', null);
    assert jsonb_typeof(j -> 'members') = 'array', 'ranking por operação'; n := n + 1;
    execute 'reset role';
  end if;

  -- ---------------------------------------------------------------- 4. Central de Auditoria (persistência e resolução)
  j := private.tire_audit_scan(org, 'manual');
  k := private.tire_audit_scan(org, 'manual');
  assert (k ->> 'opened')::int = 0 and (k ->> 'open_total')::int = (j ->> 'open_total')::int, 'varredura idempotente'; n := n + 1;
  insert into public.tire_data_findings (organization_id, rule_code, fingerprint, category, severity, detail)
  values (org, 'modelo_ausente', 'teste:achado-que-nao-existe-mais', 'cadastro', 'baixa', 'achado de teste');
  perform private.tire_audit_scan(org, 'manual');
  assert (select status from public.tire_data_findings where fingerprint = 'teste:achado-que-nao-existe-mais') = 'resolvida', 'achado some → resolvido'; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.tires_audit_center(org, '{}'::jsonb, null, null, null, 'aberta', 'category', 5, 0);
  assert (j -> 'kpis' ->> 'open')::int = (k ->> 'open_total')::int, 'central = varredura'; n := n + 1;
  assert jsonb_array_length(j -> 'rules') >= 30, 'catálogo de regras'; n := n + 1;
  execute 'reset role';

  -- ---------------------------------------------------------------- 5. sincronização: trava, permissão, somente-inserção
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.tire_sync_begin(org, 'manual');
  v_run2 := (j ->> 'run_id')::uuid;
  procedure_ok := false;
  begin
    perform public.tire_sync_begin(org, 'manual');
  exception when lock_not_available then procedure_ok := true;
  end;
  assert procedure_ok, 'trava contra execução simultânea'; n := n + 1;
  j := public.tire_sync_finish(org, v_run2, 'falhou', 'teste', 'Encerrada pelo teste.');
  assert j ->> 'status' = 'falhou', 'encerramento registrado'; n := n + 1;
  procedure_ok := false;
  begin
    perform public.tire_sync_begin(org, 'agendada');
  exception when insufficient_privilege then procedure_ok := true;
  end;
  assert procedure_ok, 'agendada só pelo servidor'; n := n + 1;
  execute 'reset role';
  procedure_ok := false;
  begin
    update public.tire_daily_snapshots set psi = psi where id = (select id from public.tire_daily_snapshots limit 1);
  exception when insufficient_privilege then procedure_ok := true;
  end;
  assert procedure_ok, 'dados diários seguem somente-inserção fora da revisão do dia'; n := n + 1;

  raise exception 'ROLLBACK_TESTES 33 OK (% verificações)', n;
end $t$;
