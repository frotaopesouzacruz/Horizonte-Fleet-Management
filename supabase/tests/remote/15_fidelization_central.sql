-- =============================================================================
-- 15 · Central de Fidelização — planner por período, mobilizações, histórico
--
-- Suíte transacional contra o banco COM DADOS. Cria as próprias BRs de teste
-- (dentro da transação) numa cidade real e usa veículos reais livres três
-- meses à frente — nada do que ela escreve sobrevive: cada bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- Os eventos do Histórico de Mobilizações são gravados por gatilhos
-- diferidos, no COMMIT. Como aqui não há commit, cada passo termina com
-- `set constraints all immediate` (dispara o que está pendente) seguido de
-- `set constraints all deferred` (volta ao normal para o passo seguinte).
--
-- O que cada bloco protege:
--   Bloco 1 (planner e mobilizações)
--   P1   §78 alocação por período numa BR sem veículo: a matriz mostra a placa
--        só nos dias do período; um evento "primeira alocação"
--   P2   §79 substituição: BR preservada, anterior encerrado na véspera, novo
--        com vínculo ao substituído; exatamente UM evento (§83, §16)
--   P3   §83 estabilidade: a substituição soma exatamente 1 mobilização
--   P4   §80 inversão por período: troca correta, dois eventos na mesma
--        transação, cada veículo volta à sua BR depois do período
--   P5   §80 falha intermediária: a segunda metade da inversão falha e nada
--        da primeira metade persiste
--   P6   §28 conflito: prévia devolve o conflito com nome e oferece inversão;
--        gravar sem inverter é recusado; a prévia não grava nada
--   P7   remoção por período: "remoção" + "retorno", o BR continua na matriz
--   P8   §45 consulta do histórico por BR, tipo e placa
--   P9   §44 histórico imutável: UPDATE e DELETE recusados
--   P10  §44 correção histórica: sem a permissão, alterar data passada é
--        recusado pela rotina E pelo gatilho (vale para qualquer caminho)
--   Bloco 2 (motoristas, replicação, liderança, aderência) — ver bloco
--   Bloco 3 (segurança por perfil e organização) — ver bloco
--
-- Última execução: 23/09/2026 (projeto jgyvaltwqntpcjqounty), 22/22 PASS
--   Bloco 1: P1–P10 PASS (P8 achou 5 eventos pela placa)
--   Bloco 2: M1–M6 PASS (M4 replicou 88 vínculos na 1ª vez, 0 na 2ª)
--   Bloco 3: S1–S6 PASS (S3: 73 BRs na operação do escopo; S4: 89 BRs)
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_d0 date; v_d0_month date;
  v_op uuid; v_city uuid; v_type uuid;
  v_x uuid; v_y uuid; v_v1 uuid; v_v2 uuid; v_v3 uuid; v_p3 text;
  v_res jsonb; v_res2 jsonb; n int; n2 int; n3 int; r text := '';
  v_a record; v_mob0 int; v_mob1 int; v_before int; v_after int;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  v_d0_month := (date_trunc('month', v_today) + interval '3 months')::date;
  v_d0 := v_d0_month + 1;

  -- Uma cidade real de uma operação que já tem titulares (para o tipo de equipamento ser admitido).
  select b.operation_id, b.operation_city_id, v.vehicle_type_id into v_op, v_city, v_type
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id
    join public.vehicles v on v.id = a.vehicle_id
   where a.status <> 'cancelled' and a.vehicle_role = 'primary' and v.status = 'active'
   group by b.operation_id, b.operation_city_id, v.vehicle_type_id
   order by count(*) desc limit 1;

  -- Três veículos ativos, do mesmo tipo, sem nenhum vínculo na janela de teste.
  select coalesce(jsonb_agg(q.id), '[]'::jsonb) into v_res2 from (
      select v.id from public.vehicles v
       where v.organization_id = v_org and v.deleted_at is null and v.status = 'active' and v.vehicle_type_id = v_type
         and not exists (select 1 from public.fidelization_assignments a where a.vehicle_id = v.id and a.status <> 'cancelled'
                          and a.start_date <= v_d0 + 60 and coalesce(a.end_date, 'infinity'::date) >= v_d0)
       order by v.fleet_code limit 3) q;
  if jsonb_array_length(v_res2) < 3 then
    raise exception 'FIXTURE: veículos livres insuficientes (%).', jsonb_array_length(v_res2);
  end if;
  v_v1 := (v_res2 ->> 0)::uuid; v_v2 := (v_res2 ->> 1)::uuid; v_v3 := (v_res2 ->> 2)::uuid;
  select license_plate into v_p3 from public.vehicles where id = v_v3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Duas BRs novas, na mesma cidade (desfeitas no rollback).
  v_x := public.save_operation_br(v_org, jsonb_build_object('operation_city_id', v_city, 'code', 'TST15X' || substr(md5(random()::text), 1, 6), 'description', 'Suíte 15 X'));
  v_y := public.save_operation_br(v_org, jsonb_build_object('operation_city_id', v_city, 'code', 'TST15Y' || substr(md5(random()::text), 1, 6), 'description', 'Suíte 15 Y'));

  -- P1
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_x, 'vehicle_id', v_v1, 'date_from', v_d0, 'date_to', v_d0 + 9, 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  v_res2 := public.fidelization_planner_matrix(v_org, extract(year from v_d0)::int, extract(month from v_d0)::int, jsonb_build_object('br_id', v_x));
  select count(*) into n from public.fidelization_movements where operation_br_id = v_x and movement_type = 'first_allocation' and new_vehicle_id = v_v1;
  if v_res ->> 'mode' = 'allocate'
     and (v_res2 -> 'rows' -> 0 -> 'segments' -> 0 ->> 'first_day')::int = extract(day from v_d0)::int
     and (v_res2 -> 'rows' -> 0 -> 'segments' -> 0 ->> 'last_day')::int = extract(day from v_d0 + 9)::int
     and (v_res2 -> 'rows' -> 0 ->> 'days_without_vehicle')::int > 0 and n = 1 then
    r := r || 'PASS P1 alocacao por periodo: placa so nos dias do periodo, BR segue na matriz, 1 evento primeira alocacao' || chr(10);
  else r := r || format('FAIL P1 mode=%s matrix=%s events=%s', v_res ->> 'mode', v_res2 -> 'rows' -> 0, n) || chr(10); end if;

  -- P2 + P3
  v_mob0 := (public.fidelization_stability(v_org, extract(year from v_d0)::int, extract(month from v_d0)::int, jsonb_build_object('operation_id', v_op)) ->> 'mobilizations')::int;
  select count(*) into v_before from public.fidelization_movements where operation_br_id = v_x;
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_x, 'vehicle_id', v_v2, 'date_from', v_d0 + 5, 'date_to', null, 'reason', 'Suite 15: substituicao', 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  select count(*) into v_after from public.fidelization_movements where operation_br_id = v_x;
  select count(*) into n from public.fidelization_assignments where operation_br_id = v_x and vehicle_id = v_v1 and status <> 'cancelled' and end_date = v_d0 + 4;
  select count(*) into n2 from public.fidelization_assignments a
   where a.operation_br_id = v_x and a.vehicle_id = v_v2 and a.start_date = v_d0 + 5 and a.end_date is null and a.source = 'substitution'
     and a.replaces_assignment_id = (select id from public.fidelization_assignments where operation_br_id = v_x and vehicle_id = v_v1 and status <> 'cancelled');
  select count(*) into n3 from public.fidelization_movements
   where operation_br_id = v_x and movement_type = 'vehicle_substitution' and not is_inferred
     and previous_vehicle_id = v_v1 and new_vehicle_id = v_v2 and effective_date = v_d0 + 5 and reason = 'Suite 15: substituicao';
  if v_res ->> 'mode' = 'substitute' and n = 1 and n2 = 1 and n3 = 1 and v_after - v_before = 1 then
    r := r || 'PASS P2 substituicao: mesma BR, anterior encerrado na vespera, novo ligado ao substituido, 1 unico evento' || chr(10);
  else r := r || format('FAIL P2 mode=%s ended=%s new=%s event=%s delta=%s', v_res ->> 'mode', n, n2, n3, v_after - v_before) || chr(10); end if;
  v_mob1 := (public.fidelization_stability(v_org, extract(year from v_d0)::int, extract(month from v_d0)::int, jsonb_build_object('operation_id', v_op)) ->> 'mobilizations')::int;
  if v_mob1 - v_mob0 = 1 then
    r := r || format('PASS P3 estabilidade: uma substituicao = +1 mobilizacao (%s -> %s)', v_mob0, v_mob1) || chr(10);
  else r := r || format('FAIL P3 mobilizacoes %s -> %s', v_mob0, v_mob1) || chr(10); end if;

  -- P4
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_y, 'vehicle_id', v_v3, 'date_from', v_d0, 'date_to', null, 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_x, 'vehicle_id', v_v3, 'date_from', v_d0 + 10, 'date_to', v_d0 + 12,
    'reason', 'Suite 15: inversao', 'invert', true, 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  select count(*) into n from public.fidelization_assignments
   where status <> 'cancelled' and start_date = v_d0 + 10 and end_date = v_d0 + 12 and source = 'inversion'
     and ((operation_br_id = v_x and vehicle_id = v_v3) or (operation_br_id = v_y and vehicle_id = v_v2));
  select count(*) into n2 from public.fidelization_assignments
   where status <> 'cancelled' and start_date = v_d0 + 13
     and ((operation_br_id = v_x and vehicle_id = v_v2) or (operation_br_id = v_y and vehicle_id = v_v3));
  select count(distinct correlation_key), count(*) into n3, v_after from public.fidelization_movements
   where movement_type = 'vehicle_inversion' and operation_br_id in (v_x, v_y);
  if v_res ->> 'mode' = 'invert' and n = 2 and n2 = 2 and n3 = 1 and v_after = 2 then
    r := r || 'PASS P4 inversao por periodo: placas trocadas nas duas BRs, 2 eventos numa transacao, cada veiculo volta a sua BR depois' || chr(10);
  else r := r || format('FAIL P4 mode=%s swapped=%s returned=%s corr=%s rows=%s', v_res ->> 'mode', n, n2, n3, v_after) || chr(10); end if;

  -- P5: a segunda metade da inversão falha; a primeira não pode sobrar.
  reset role;
  execute $f$create or replace function pg_temp.hf_fail_second_half() returns trigger language plpgsql as $b$
    begin
      if new.source = 'inversion' and new.start_date = current_setting('hf15.fail_date')::date and new.operation_br_id = current_setting('hf15.fail_br')::uuid then
        raise exception 'falha simulada na segunda metade da inversao';
      end if;
      return new;
    end $b$;$f$;
  execute 'create trigger hf15_fail before insert on public.fidelization_assignments for each row execute function pg_temp.hf_fail_second_half()';
  perform set_config('hf15.fail_date', (v_d0 + 20)::text, true);
  perform set_config('hf15.fail_br', v_y::text, true);
  select count(*) into n from public.fidelization_assignments where operation_br_id in (v_x, v_y) and status <> 'cancelled';
  set local role authenticated;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object(
      'operation_br_id', v_x, 'vehicle_id', v_v3, 'date_from', v_d0 + 20, 'date_to', v_d0 + 21,
      'reason', 'Suite 15: falha', 'invert', true, 'dry_run', false));
    r := r || 'FAIL P5 a inversao com falha simulada foi aceita' || chr(10);
  exception when others then
    reset role;
    select count(*) into n2 from public.fidelization_assignments where operation_br_id in (v_x, v_y) and status <> 'cancelled';
    select count(*) into n3 from public.fidelization_assignments where operation_br_id in (v_x, v_y) and status <> 'cancelled'
      and start_date <= v_d0 + 21 and coalesce(end_date, 'infinity'::date) >= v_d0 + 20
      and ((operation_br_id = v_x and vehicle_id = v_v2) or (operation_br_id = v_y and vehicle_id = v_v3));
    if sqlerrm like '%falha simulada%' and n2 = n and n3 = 2 then
      r := r || 'PASS P5 falha na segunda metade: nada da primeira metade persiste (vinculos intactos)' || chr(10);
    else r := r || format('FAIL P5 erro=%s linhas %s->%s intactos=%s', sqlerrm, n, n2, n3) || chr(10); end if;
    set local role authenticated;
  end;
  reset role;
  execute 'drop trigger hf15_fail on public.fidelization_assignments';
  set local role authenticated;

  -- P6
  select count(*) into n from public.fidelization_assignments where operation_br_id in (v_x, v_y);
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_x, 'vehicle_id', v_v3, 'date_from', v_d0 + 15, 'date_to', v_d0 + 16, 'reason', 'Suite 15', 'dry_run', true));
  select count(*) into n2 from public.fidelization_assignments where operation_br_id in (v_x, v_y);
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object(
      'operation_br_id', v_x, 'vehicle_id', v_v3, 'date_from', v_d0 + 15, 'date_to', v_d0 + 16, 'reason', 'Suite 15', 'dry_run', false));
    n3 := 0;
  exception when others then
    n3 := case when sqlerrm like '%já está fidelizado%' then 1 else -1 end;
  end;
  if v_res ->> 'mode' = 'conflict' and (v_res ->> 'can_invert')::boolean
     and v_res -> 'conflicts' -> 0 ->> 'operation_br_id' = v_y::text and n = n2 and n3 = 1 then
    r := r || 'PASS P6 conflito: previa nomeia a BR ocupada e oferece inversao, nao grava; gravar sem inverter e recusado' || chr(10);
  else r := r || format('FAIL P6 previa=%s linhas %s->%s recusa=%s', v_res, n, n2, n3) || chr(10); end if;

  -- P7
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_x, 'vehicle_id', null, 'date_from', v_d0 + 30, 'date_to', v_d0 + 31, 'reason', 'Suite 15: remocao', 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  select count(*) into n from public.fidelization_movements where operation_br_id = v_x and movement_type = 'vehicle_removal' and effective_date = v_d0 + 30;
  select count(*) into n2 from public.fidelization_movements where operation_br_id = v_x and movement_type = 'vehicle_return' and effective_date = v_d0 + 32 and new_vehicle_id = v_v2;
  v_res2 := public.fidelization_planner_matrix(v_org, extract(year from v_d0 + 30)::int, extract(month from v_d0 + 30)::int, jsonb_build_object('br_id', v_x));
  if v_res ->> 'mode' = 'remove' and n = 1 and n2 = 1 and (v_res2 ->> 'total')::int = 1 then
    r := r || 'PASS P7 remocao por periodo: evento de remocao e de retorno; a BR continua na matriz' || chr(10);
  else r := r || format('FAIL P7 mode=%s remocao=%s retorno=%s linhas=%s', v_res ->> 'mode', n, n2, v_res2 ->> 'total') || chr(10); end if;

  -- P8
  v_res := public.fidelization_movements_list(v_org, jsonb_build_object('br_id', v_x, 'movement_type', 'vehicle_inversion'), 1, 50);
  v_res2 := public.fidelization_movements_list(v_org, jsonb_build_object('vehicle', lower(v_p3), 'date_from', v_d0, 'date_to', v_d0 + 60), 1, 50);
  if (v_res ->> 'total')::int = 1 and (v_res2 ->> 'total')::int >= 2
     and v_res -> 'rows' -> 0 ->> 'actor_name' is not null and v_res -> 'rows' -> 0 ->> 'origin' = 'user' then
    r := r || format('PASS P8 consulta do historico por BR+tipo (1) e por placa (%s); ator e origem registrados', v_res2 ->> 'total') || chr(10);
  else r := r || format('FAIL P8 por_tipo=%s por_placa=%s linha=%s', v_res ->> 'total', v_res2 ->> 'total', v_res -> 'rows' -> 0) || chr(10); end if;

  -- P9
  reset role;
  begin
    update public.fidelization_movements set reason = 'adulterado' where operation_br_id = v_x;
    r := r || 'FAIL P9 update aceito' || chr(10);
  exception when others then
    begin
      delete from public.fidelization_movements where operation_br_id = v_x;
      r := r || 'FAIL P9 delete aceito' || chr(10);
    exception when others then
      r := r || 'PASS P9 historico imutavel: UPDATE e DELETE recusados (inclusive para o dono da tabela)' || chr(10);
    end;
  end;

  -- P10: sem a permissão de correção histórica. A matriz de acesso só muda
  -- dentro das rotinas de administração de acesso; o teste liga a mesma
  -- marca que elas ligam, e só dentro desta transação desfeita.
  -- O usuário da suíte também é administrador da plataforma, o que dispensa
  -- qualquer permissão; a marca é revogada só aqui dentro.
  perform set_config('hfm.access_change', 'on', true);
  update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
  delete from public.role_permissions rp using public.roles ro, public.permissions p
   where rp.role_id = ro.id and rp.permission_id = p.id and p.code = 'fidelization.manage_historical_data';
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  select a.* into v_a from public.fidelization_assignments a
   where a.status <> 'cancelled' and a.vehicle_role = 'primary' and a.start_date < v_today - 5
     and coalesce(a.end_date, 'infinity'::date) > v_today order by a.start_date limit 1;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object(
      'operation_br_id', v_x, 'vehicle_id', null, 'date_from', v_today - 2, 'date_to', v_today - 1, 'reason', 'x', 'dry_run', true));
    n := 0;
  exception when others then n := case when sqlerrm like '%correção histórica%' then 1 else -1 end; end;
  begin
    perform public.end_fidelization_assignment(v_a.id, v_today - 5, 'Suite 15: encerramento retroativo');
    n2 := 0;
  exception when others then n2 := case when sqlerrm like '%correção histórica%' then 1 else -1 end; end;
  begin
    perform public.save_fidelization_assignment(v_org, jsonb_build_object(
      'operation_br_id', v_y, 'vehicle_id', v_v1, 'start_date', v_today - 3, 'end_date', v_today - 3));
    n3 := 0;
  exception when others then n3 := case when sqlerrm like '%correção histórica%' then 1 else -1 end; end;
  if n = 1 and n2 = 1 and n3 = 1 then
    r := r || 'PASS P10 correcao historica sem permissao: recusada na edicao por periodo, no encerramento e no planejamento direto' || chr(10);
  else r := r || format('FAIL P10 periodo=%s encerrar=%s planejar=%s', n, n2, n3) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 2 · Motoristas, replicação, liderança e aderência
--   M1  §81 vincular motorista e substituí-lo depois: histórico preservado,
--       mesma BR, sem sobreposição, um evento de cada
--   M2  §34 troca de veículo por período mantém o motorista da BR: nenhum
--       evento de motorista (continuidade), os de veículo sim
--   M3  §37/§38 motorista principal em duas BRs no mesmo dia é recusado;
--       secundário na mesma BR é aceito (turno/reserva)
--   M4  §82 replicação: a prévia prevê o que a gravação cria; repetir cria 0;
--       nenhuma BR com dois titulares; replicar não é mobilização
--   M5  §85 liderança muda na competência seguinte: o mês novo usa a nova, o
--       mês corrente mantém a anterior, o evento guarda a da data; a BR é a mesma
--   M6  §86 aderência: inverter veículos durante a competência muda as
--       obrigações dos dias seguintes e preserva as de ontem
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_d0 date; v_m1 date; v_month_end date;
  v_op uuid; v_city uuid; v_type uuid;
  v_z uuid; v_w uuid; v_v4 uuid; v_v5 uuid; v_v6 uuid; v_asg uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_drv uuid; v_l0 uuid; v_res jsonb; v_res2 jsonb; n int; n2 int; n3 int; r text := '';
  v_a record; v_b record; v_from date; v_before int; v_obl_prev uuid;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  v_d0 := (date_trunc('month', v_today) + interval '3 months')::date + 1;
  v_m1 := (date_trunc('month', v_d0) + interval '1 month')::date;
  v_month_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

  select b.operation_id, b.operation_city_id, v.vehicle_type_id into v_op, v_city, v_type
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id
    join public.vehicles v on v.id = a.vehicle_id
   where a.status <> 'cancelled' and a.vehicle_role = 'primary' and v.status = 'active'
   group by b.operation_id, b.operation_city_id, v.vehicle_type_id
   order by count(*) desc limit 1;
  select coalesce(jsonb_agg(q.id), '[]'::jsonb) into v_res2 from (
      select v.id from public.vehicles v
       where v.organization_id = v_org and v.deleted_at is null and v.status = 'active' and v.vehicle_type_id = v_type
         and not exists (select 1 from public.fidelization_assignments a where a.vehicle_id = v.id and a.status <> 'cancelled'
                          and a.start_date <= v_d0 + 60 and coalesce(a.end_date, 'infinity'::date) >= v_d0)
       order by v.fleet_code limit 3) q;
  v_v4 := (v_res2 ->> 0)::uuid; v_v5 := (v_res2 ->> 1)::uuid; v_v6 := (v_res2 ->> 2)::uuid;
  select coalesce(jsonb_agg(q.id), '[]'::jsonb) into v_res2 from (
      select e.id from public.employees e
       where e.organization_id = v_org and e.deleted_at is null and e.employment_status = 'active'
         and not exists (select 1 from public.fidelization_drivers d where d.employee_id = e.id and d.status <> 'cancelled'
                          and d.start_date <= v_d0 + 60 and coalesce(d.end_date, 'infinity'::date) >= v_d0)
       order by e.full_name limit 3) q;
  v_e1 := (v_res2 ->> 0)::uuid; v_e2 := (v_res2 ->> 1)::uuid; v_e3 := (v_res2 ->> 2)::uuid;
  if v_v6 is null or v_e3 is null then
    raise exception 'FIXTURE: veiculos=% colaboradores=%', v_res2, v_e3;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_z := public.save_operation_br(v_org, jsonb_build_object('operation_city_id', v_city, 'code', 'TST15Z' || substr(md5(random()::text), 1, 6), 'description', 'Suíte 15 Z'));
  v_w := public.save_operation_br(v_org, jsonb_build_object('operation_city_id', v_city, 'code', 'TST15W' || substr(md5(random()::text), 1, 6), 'description', 'Suíte 15 W'));
  perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_z, 'vehicle_id', v_v4, 'date_from', v_d0, 'date_to', null, 'dry_run', false));
  perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_w, 'vehicle_id', v_v6, 'date_from', v_d0, 'date_to', null, 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  select id into v_asg from public.fidelization_assignments where operation_br_id = v_z and vehicle_id = v_v4 and status <> 'cancelled';

  -- M1
  v_drv := public.save_fidelization_driver(v_org, jsonb_build_object(
    'fidelization_assignment_id', v_asg, 'employee_id', v_e1, 'driver_role', 'primary', 'start_date', v_d0));
  set constraints all immediate; set constraints all deferred;
  v_res := public.substitute_fidelization_driver(v_org, jsonb_build_object(
    'driver_id', v_drv, 'new_employee_id', v_e2, 'effective_from', v_d0 + 5, 'reason', 'Suite 15: troca de motorista'));
  set constraints all immediate; set constraints all deferred;
  select count(*) into n from public.fidelization_drivers where id = v_drv and employee_id = v_e1 and end_date = v_d0 + 4 and status <> 'cancelled';
  select count(*) into n2 from public.fidelization_drivers where fidelization_assignment_id = v_asg and employee_id = v_e2 and start_date = v_d0 + 5 and status <> 'cancelled';
  select count(*) into n3 from public.fidelization_movements
   where operation_br_id = v_z and ((movement_type = 'driver_allocation' and new_driver_employee_id = v_e1)
      or (movement_type = 'driver_substitution' and previous_driver_employee_id = v_e1 and new_driver_employee_id = v_e2 and effective_date = v_d0 + 5));
  if n = 1 and n2 = 1 and n3 = 2 then
    r := r || 'PASS M1 motorista vinculado e substituido: anterior encerrado na vespera, novo na mesma BR, 2 eventos (vinculacao, substituicao)' || chr(10);
  else r := r || format('FAIL M1 anterior=%s novo=%s eventos=%s', n, n2, n3) || chr(10); end if;

  -- M2
  select count(*) into v_before from public.fidelization_movements where operation_br_id = v_z and subject = 'driver';
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object(
    'operation_br_id', v_z, 'vehicle_id', v_v5, 'date_from', v_d0 + 7, 'date_to', v_d0 + 9, 'reason', 'Suite 15: reserva temporaria', 'dry_run', false));
  set constraints all immediate; set constraints all deferred;
  select count(*) into n from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
   where a.operation_br_id = v_z and d.employee_id = v_e2 and d.status <> 'cancelled'
     and ((a.vehicle_id = v_v5 and d.start_date = v_d0 + 7 and d.end_date = v_d0 + 9)
       or (a.vehicle_id = v_v4 and d.start_date = v_d0 + 10));
  select count(*) - v_before into n2 from public.fidelization_movements where operation_br_id = v_z and subject = 'driver';
  select count(*) into n3 from public.fidelization_movements where operation_br_id = v_z and subject = 'vehicle'
     and movement_type in ('vehicle_substitution', 'vehicle_return') and effective_date in (v_d0 + 7, v_d0 + 10);
  if (v_res ->> 'drivers_kept')::int = 1 and n = 2 and n2 = 0 and n3 = 2 then
    r := r || 'PASS M2 troca temporaria de veiculo mantem o motorista da BR: 0 eventos de motorista, 2 de veiculo' || chr(10);
  else r := r || format('FAIL M2 kept=%s vinculos=%s ev_motorista=%s ev_veiculo=%s', v_res ->> 'drivers_kept', n, n2, n3) || chr(10); end if;

  -- M3
  begin
    perform public.save_fidelization_driver(v_org, jsonb_build_object(
      'fidelization_assignment_id', (select id from public.fidelization_assignments where operation_br_id = v_w and status <> 'cancelled' limit 1),
      'employee_id', v_e2, 'driver_role', 'primary', 'start_date', v_d0 + 20));
    set constraints all immediate; set constraints all deferred;
    n := 0;
  exception when others then n := 1; end;
  begin
    perform public.save_fidelization_driver(v_org, jsonb_build_object(
      'fidelization_assignment_id', (select id from public.fidelization_assignments where operation_br_id = v_z and vehicle_id = v_v4 and start_date = v_d0 + 10 and status <> 'cancelled'),
      'employee_id', v_e1, 'driver_role', 'secondary', 'start_date', v_d0 + 20));
    set constraints all immediate; set constraints all deferred;
    n2 := 1;
  exception when others then n2 := 0; r := r || 'M3 secundario: ' || sqlerrm || chr(10); end;
  if n = 1 and n2 = 1 then
    r := r || 'PASS M3 motorista principal em duas BRs no mesmo dia recusado; secundario na mesma BR aceito' || chr(10);
  else r := r || format('FAIL M3 duplo_principal_recusado=%s secundario_aceito=%s', n, n2) || chr(10); end if;

  -- M4 (competência corrente -> seguinte, dados reais; desfeito no fim)
  v_res := public.replicate_fidelization_competence(v_org, extract(year from v_today)::int, extract(month from v_today)::int,
    extract(year from v_month_end + 1)::int, extract(month from v_month_end + 1)::int, null, true, true);
  select count(*) into v_before from public.fidelization_movements where subject = 'vehicle';
  v_res2 := public.replicate_fidelization_competence(v_org, extract(year from v_today)::int, extract(month from v_today)::int,
    extract(year from v_month_end + 1)::int, extract(month from v_month_end + 1)::int, null, true, false);
  set constraints all immediate; set constraints all deferred;
  select count(*) - v_before into n from public.fidelization_movements where subject = 'vehicle';
  select count(*) into n2 from (
    select a.operation_br_id, d::date from public.fidelization_assignments a,
           generate_series(v_month_end + 1, v_month_end + 3, interval '1 day') d
     where a.vehicle_role = 'primary' and a.status <> 'cancelled' and a.start_date <= d::date and coalesce(a.end_date, 'infinity'::date) >= d::date
     group by 1, 2 having count(*) > 1) x;
  v_res := v_res2;
  v_res2 := public.replicate_fidelization_competence(v_org, extract(year from v_today)::int, extract(month from v_today)::int,
    extract(year from v_month_end + 1)::int, extract(month from v_month_end + 1)::int, null, true, false);
  if (v_res -> 'vehicles' ->> 'new')::int > 0 and (v_res2 -> 'vehicles' ->> 'new')::int = 0 and n = 0 and n2 = 0 then
    r := r || format('PASS M4 replicacao: %s novos na primeira, 0 na segunda; nenhuma BR com dois titulares; replicar nao gera mobilizacao', v_res -> 'vehicles' ->> 'new') || chr(10);
  else r := r || format('FAIL M4 primeira=%s segunda=%s eventos=%s duplicados=%s', v_res -> 'vehicles', v_res2 -> 'vehicles', n, n2) || chr(10); end if;

  -- M5
  select l.employee_id into v_l0 from private.br_leadership_at(v_z, v_d0) l;
  perform public.save_leadership_assignment(v_org, jsonb_build_object(
    'employee_id', v_e3, 'scope_level', 'br', 'operation_id', v_op, 'operation_br_id', v_z,
    'responsibility_type', 'principal', 'effective_from', v_m1, 'notes', 'Suite 15'));
  v_res := public.fidelization_planner_matrix(v_org, extract(year from v_m1)::int, extract(month from v_m1)::int, jsonb_build_object('br_id', v_z));
  v_res2 := public.fidelization_planner_matrix(v_org, extract(year from v_d0)::int, extract(month from v_d0)::int, jsonb_build_object('br_id', v_z));
  select count(*) into n from public.fidelization_movements
   where operation_br_id = v_z and movement_type = 'first_allocation' and leader_employee_id is not distinct from v_l0;
  if v_res -> 'rows' -> 0 ->> 'leader_employee_id' = v_e3::text and v_res -> 'rows' -> 0 ->> 'leader_level' = 'br'
     and (v_res2 -> 'rows' -> 0 ->> 'leader_employee_id') is not distinct from v_l0::text
     and v_res -> 'rows' -> 0 ->> 'operation_br_id' = v_z::text and n = 1 then
    r := r || 'PASS M5 lideranca nova so a partir da competencia seguinte; o mes anterior e o evento guardam a anterior; mesma BR' || chr(10);
  else r := r || format('FAIL M5 novo=%s/%s anterior=%s esperado=%s evento=%s', v_res -> 'rows' -> 0 ->> 'leader_employee_id', v_res -> 'rows' -> 0 ->> 'leader_level', v_res2 -> 'rows' -> 0 ->> 'leader_employee_id', v_l0, n) || chr(10); end if;

  -- M6 (dados reais da competência corrente; desfeito no fim)
  v_from := v_today + 2;
  if v_from > v_month_end then
    r := r || 'SKIP M6 menos de 3 dias ate o fim da competencia' || chr(10);
  else
    select a.* into v_a from public.fidelization_assignments a
     where a.vehicle_role = 'primary' and a.status <> 'cancelled' and a.start_date <= v_today - 1 and a.end_date >= v_month_end
       and exists (select 1 from public.checklist_obligations o where o.vehicle_id = a.vehicle_id and o.operational_date = v_today - 1 and o.operation_br_id = a.operation_br_id and o.is_active)
     order by a.operation_br_id limit 1;
    select a.* into v_b from public.fidelization_assignments a join public.operation_brs b on b.id = a.operation_br_id
     where a.vehicle_role = 'primary' and a.status <> 'cancelled' and a.start_date <= v_from and a.end_date >= v_month_end
       and a.operation_br_id <> v_a.operation_br_id and b.operation_id = (select operation_id from public.operation_brs where id = v_a.operation_br_id)
     order by a.operation_br_id desc limit 1;
    select id into v_obl_prev from public.checklist_obligations
     where vehicle_id = v_a.vehicle_id and operational_date = v_today - 1 and checklist_context = 'saida' and is_active;
    perform public.apply_fidelization_period(v_org, jsonb_build_object(
      'operation_br_id', v_a.operation_br_id, 'vehicle_id', v_b.vehicle_id, 'date_from', v_from, 'date_to', v_month_end,
      'reason', 'Suite 15: inversao na competencia', 'invert', true, 'dry_run', false));
    reset role;
    perform private.adherence_generate(v_org, v_today - 1, v_month_end, null, null, null, true, false, null, 'Suite 15');
    select count(*) into n from public.checklist_obligations
     where id = v_obl_prev and operation_br_id = v_a.operation_br_id and vehicle_id = v_a.vehicle_id and is_active;
    select count(*) into n2 from public.checklist_obligations
     where operational_date = v_from and checklist_context = 'saida' and is_active
       and ((vehicle_id = v_a.vehicle_id and operation_br_id = v_b.operation_br_id)
         or (vehicle_id = v_b.vehicle_id and operation_br_id = v_a.operation_br_id));
    if n = 1 and n2 = 2 then
      r := r || 'PASS M6 aderencia: apos a inversao as obrigacoes dos dias seguintes trocam de BR; a de ontem continua com o veiculo e a BR da data' || chr(10);
    else r := r || format('FAIL M6 ontem_preservada=%s dias_seguintes=%s', n, n2) || chr(10); end if;
  end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 3 · Segurança por perfil, escopo e organização (§87)
--   S1  usuário sem vínculo: matriz, histórico e tabela vazios; edição recusada
--   S2  organização trocada e BR inexistente no parâmetro: recusados
--   S3  Liderança Operações (escopo de uma operação): só vê a sua operação;
--       planeja no escopo; BR de outra operação "não encontrada"; data
--       passada recusada (sem correção histórica)
--   S4  Gestão: vê, não planeja
--   S5  Operacional: nada de fidelização
--   S6  Gestor de Frota: prévia de correção histórica permitida
--   Os perfis são simulados trocando o papel do único membro ativo DENTRO da
--   transação desfeita (com a marca das rotinas de administração de acesso).
--   A troca é um UPDATE do papel, não DELETE + INSERT: a guarda do último
--   Administrador dispara no DELETE e, com um único membro, recusaria o teste.
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_today date; v_d0 date;
  v_op uuid; v_other_op uuid; v_city uuid; v_type uuid; v_t uuid; v_v uuid; v_br_other uuid; v_br_mine uuid;
  v_res jsonb; n int; n2 int; n3 int; r text := ''; v_rand uuid := gen_random_uuid();
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  v_d0 := (date_trunc('month', v_today) + interval '3 months')::date + 1;

  select b.operation_id, b.operation_city_id, v.vehicle_type_id into v_op, v_city, v_type
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id
    join public.vehicles v on v.id = a.vehicle_id
   where a.status <> 'cancelled' and a.vehicle_role = 'primary' and v.status = 'active'
   group by b.operation_id, b.operation_city_id, v.vehicle_type_id
   order by count(*) desc limit 1;
  select b.id, b.operation_id into v_br_other, v_other_op from public.operation_brs b
   where b.organization_id = v_org and b.deleted_at is null and b.operation_id <> v_op limit 1;
  select b.id into v_br_mine from public.operation_brs b
   join public.fidelization_assignments a on a.operation_br_id = b.id and a.status <> 'cancelled' and a.vehicle_role = 'primary'
    and a.start_date <= v_today - 2 and coalesce(a.end_date, 'infinity'::date) >= v_today
   where b.operation_id = v_op limit 1;
  select v.id into v_v from public.vehicles v
   where v.organization_id = v_org and v.deleted_at is null and v.status = 'active' and v.vehicle_type_id = v_type
     and not exists (select 1 from public.fidelization_assignments a where a.vehicle_id = v.id and a.status <> 'cancelled'
                      and a.start_date <= v_d0 + 60 and coalesce(a.end_date, 'infinity'::date) >= v_d0)
   order by v.fleet_code limit 1;

  -- BR de teste criada como administrador, antes das trocas de perfil.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_t := public.save_operation_br(v_org, jsonb_build_object('operation_city_id', v_city, 'code', 'TST15S' || substr(md5(random()::text), 1, 6), 'description', 'Suíte 15 S'));
  reset role;

  -- S1
  perform set_config('request.jwt.claims', json_build_object('sub', v_rand, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.fidelization_planner_matrix(v_org, extract(year from v_today)::int, extract(month from v_today)::int, '{}'::jsonb);
  n := (v_res ->> 'total')::int;
  n2 := (public.fidelization_movements_list(v_org, '{}'::jsonb, 1, 10) ->> 'total')::int;
  select count(*) into n3 from public.fidelization_movements;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_t, 'vehicle_id', v_v, 'date_from', v_d0, 'dry_run', true));
    r := r || 'FAIL S1 usuario sem vinculo editou' || chr(10);
  exception when others then
    if n = 0 and n2 = 0 and n3 = 0 then
      r := r || 'PASS S1 usuario sem vinculo: matriz, historico e tabela vazios; edicao recusada' || chr(10);
    else r := r || format('FAIL S1 matriz=%s historico=%s tabela=%s', n, n2, n3) || chr(10); end if;
  end;
  reset role;

  -- S2
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.apply_fidelization_period(v_rand, jsonb_build_object('operation_br_id', v_t, 'vehicle_id', v_v, 'date_from', v_d0, 'dry_run', true));
    n := 0;
  exception when others then n := 1; end;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_rand, 'vehicle_id', v_v, 'date_from', v_d0, 'dry_run', true));
    n2 := 0;
  exception when others then n2 := case when sqlerrm like '%não encontrada%' then 1 else -1 end; end;
  if n = 1 and n2 = 1 then
    r := r || 'PASS S2 organizacao trocada e BR inexistente: recusados' || chr(10);
  else r := r || format('FAIL S2 org=%s br=%s', n, n2) || chr(10); end if;
  reset role;

  -- Troca de perfil do único membro (desfeita no fim).
  -- O escopo entra antes da troca: a guarda exige que QUEM altera o escopo
  -- tenha users.manage_operation_scope, e o perfil simulado não tem.
  perform set_config('hfm.access_change', 'on', true);
  delete from public.membership_operation_scopes where membership_id = v_mem;
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_op);
  update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'lideranca_operacoes' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);

  -- S3
  set local role authenticated;
  v_res := public.fidelization_planner_matrix(v_org, extract(year from v_today)::int, extract(month from v_today)::int, '{}'::jsonb);
  select count(*) filter (where x ->> 'operation_id' <> v_op::text), count(*) into n, n2 from jsonb_array_elements(v_res -> 'rows') x;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_br_other, 'vehicle_id', null, 'date_from', v_d0, 'reason', 'x', 'dry_run', true));
    n3 := 0;
  exception when others then n3 := case when sqlerrm like '%não encontrada%' then 1 else -1 end; end;
  v_res := public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_t, 'vehicle_id', v_v, 'date_from', v_d0, 'date_to', v_d0 + 3, 'dry_run', true));
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_br_mine, 'vehicle_id', null, 'date_from', v_today - 2, 'date_to', v_today - 1, 'reason', 'x', 'dry_run', true));
    r := r || 'FAIL S3 lideranca corrigiu data passada' || chr(10);
  exception when others then
    if n = 0 and n2 > 0 and n3 = 1 and v_res ->> 'mode' = 'allocate' and sqlerrm like '%correção histórica%' then
      r := r || format('PASS S3 lideranca: ve so a propria operacao (%s BRs), planeja no escopo, BR de outra operacao nao encontrada, data passada recusada', n2) || chr(10);
    else r := r || format('FAIL S3 fora=%s visiveis=%s outra_op=%s modo=%s erro=%s', n, n2, n3, v_res ->> 'mode', sqlerrm) || chr(10); end if;
  end;
  reset role;

  -- S4
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'gestao' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  n := (public.fidelization_planner_matrix(v_org, extract(year from v_today)::int, extract(month from v_today)::int, '{}'::jsonb) ->> 'total')::int;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_t, 'vehicle_id', v_v, 'date_from', v_d0, 'dry_run', true));
    r := r || 'FAIL S4 gestao planejou' || chr(10);
  exception when others then
    if n > 0 and sqlerrm like '%permissão%' then
      r := r || format('PASS S4 gestao: ve a matriz (%s BRs) e nao planeja', n) || chr(10);
    else r := r || format('FAIL S4 visiveis=%s erro=%s', n, sqlerrm) || chr(10); end if;
  end;
  reset role;

  -- S5
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'operacional' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  v_res := public.fidelization_planner_matrix(v_org, extract(year from v_today)::int, extract(month from v_today)::int, '{}'::jsonb);
  select coalesce(sum(jsonb_array_length(x -> 'segments')), 0) into n from jsonb_array_elements(v_res -> 'rows') x;
  n2 := (public.fidelization_movements_list(v_org, '{}'::jsonb, 1, 10) ->> 'total')::int;
  begin
    perform public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_t, 'vehicle_id', v_v, 'date_from', v_d0, 'dry_run', true));
    r := r || 'FAIL S5 operacional planejou' || chr(10);
  exception when others then
    if n = 0 and n2 = 0 then
      r := r || 'PASS S5 operacional: nenhum vinculo, nenhum evento, edicao recusada' || chr(10);
    else r := r || format('FAIL S5 vinculos=%s eventos=%s', n, n2) || chr(10); end if;
  end;
  reset role;

  -- S6
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'gestor_frota' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    v_res := public.apply_fidelization_period(v_org, jsonb_build_object('operation_br_id', v_br_mine, 'vehicle_id', null, 'date_from', v_today - 2, 'date_to', v_today - 1, 'reason', 'Suite 15', 'dry_run', true));
    if v_res ->> 'mode' = 'remove' and (v_res ->> 'historical')::boolean and (v_res ->> 'preview')::boolean then
      r := r || 'PASS S6 gestor de frota: previa de correcao historica permitida e marcada como historica' || chr(10);
    else r := r || format('FAIL S6 %s', v_res) || chr(10); end if;
  exception when others then r := r || 'FAIL S6 ' || sqlerrm || chr(10); end;
  reset role;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
