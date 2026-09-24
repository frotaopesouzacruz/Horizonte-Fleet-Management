-- =============================================================================
-- 18 · Lideranças › Planejamento por Tipo de Operação → Cidade
--
-- Migration 20260924170000_leadership_city_planner. Suíte transacional contra
-- o banco COM DADOS: usa uma cidade real com liderança em aberto e um
-- colaborador real do perfil Liderança Operações. Cada bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO — nada sobrevive.
--
-- "Hoje" é private.fidelization_today(); as competências são relativas a ele.
--
--   Bloco 1 (Administrador)
--   P1  leitura: a matriz traz operações ativas, cidades com UF e as pessoas
--       do perfil Liderança Operações; a cidade escolhida mostra a liderança
--   P2  prévia (dry_run): diz o que faria e não grava nada
--   P3  troca na competência corrente: a anterior termina ONTEM (continua
--       ativa para os dias em que respondeu), a nova começa HOJE e herda a
--       vigência em aberto; auditoria com o usuário autenticado
--   P4  escolher a mesma pessoa de novo: "unchanged", nada muda
--   P5  competência futura: troca a partir do dia 1º; a do mês corrente
--       termina no último dia do mês anterior
--   P6  remover (lixeira) na competência corrente: a vigência termina ontem;
--       a matriz do mês passa a mostrar só o que valeu até ontem
--   P7  cidade sem liderança: designar vale de hoje ao fim do mês
--   P8  colaborador fora do perfil Liderança Operações: aceito com aviso, e o
--       perfil de acesso (membership_roles) não muda
--   Bloco 2 (correção histórica, Administrador)
--   H1  competência passada sem motivo: recusada
--   H2  competência passada com motivo: a troca fica restrita àquele mês; a
--       vigência anterior volta no mês seguinte com a mesma data de fim
--   Bloco 3 (perfis e escopo)
--   S1  Liderança Operações com escopo numa operação: troca na competência
--       corrente da própria operação é aceita (sem correção histórica)
--   S2  a mesma pessoa: cidade de outra operação é recusada; a matriz só
--       traz a própria operação
--   S3  a mesma pessoa: competência passada é recusada (correção histórica)
--   S4  Gestão (só leitura): lê a matriz, não planeja
--   S5  Operacional: não lê a matriz
--   S6  organização trocada e cidade inexistente: recusadas
-- =============================================================================

-- =============================================================================
-- Bloco 1
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; y int; m int; ny int; nm int;
  v_city uuid; v_city_empty uuid; v_old_row uuid; v_old_emp uuid; v_new_emp uuid; v_other_emp uuid;
  v_res jsonb; v_plan jsonb; n int; n2 int; r text := '';
  v_row record; v_row2 record; v_roles_before text; v_roles_after text;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m2.user_id into v_user from public.organization_memberships m2
   where m2.organization_id = v_org and m2.status = 'active' and m2.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  y := extract(year from v_today)::int; m := extract(month from v_today)::int;
  ny := case when m = 12 then y + 1 else y end; nm := case when m = 12 then 1 else m + 1 end;

  -- Uma cidade com liderança principal em aberto, iniciada antes de hoje.
  select l.operation_city_id, l.id, l.employee_id into v_city, v_old_row, v_old_emp
    from public.leadership_assignments l
    join public.operations o on o.id = l.operation_id and o.status = 'active' and o.deleted_at is null
   where l.organization_id = v_org and l.scope_level = 'city' and l.responsibility_type = 'principal'
     and l.status = 'active' and l.effective_to is null and l.effective_from < v_today
   order by l.effective_from limit 1;
  -- Um candidato diferente do atual.
  select e.id into v_new_emp from public.employees e
   where e.organization_id = v_org and e.deleted_at is null and e.employment_status = 'active'
     and private.is_leadership_candidate(v_org, e.id) and e.id <> v_old_emp
   order by e.full_name limit 1;
  -- Uma cidade de operação ativa sem nenhuma liderança principal no mês.
  select oc.id into v_city_empty from public.operation_cities oc
    join public.operations o on o.id = oc.operation_id and o.status = 'active' and o.deleted_at is null
   where oc.organization_id = v_org
     and not exists (select 1 from public.leadership_assignments l
                      where l.scope_key = 'city:' || oc.id::text and l.responsibility_type = 'principal'
                        and l.status <> 'cancelled'
                        and daterange(l.effective_from, l.effective_to, '[]') && private.competence_range(y, m))
   limit 1;
  -- Alguém ativo fora do perfil Liderança Operações.
  select e.id into v_other_emp from public.employees e
   where e.organization_id = v_org and e.deleted_at is null and e.employment_status = 'active'
     and not private.is_leadership_candidate(v_org, e.id)
   order by e.full_name limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- P1
  v_plan := public.leadership_city_planner(v_org, y, m);
  select count(*) into n from jsonb_array_elements(v_plan -> 'operations') o, jsonb_array_elements(o -> 'cities') c
   where c ->> 'operation_city_id' = v_city::text
     and (c -> 'leaders' -> 0 ->> 'employee_id') = v_old_emp::text and c ->> 'uf' is not null;
  select count(*) into n2 from jsonb_array_elements(v_plan -> 'candidates') x where x ->> 'id' = v_new_emp::text;
  if n = 1 and n2 = 1 and jsonb_array_length(v_plan -> 'operations') > 0 then
    r := r || format('PASS P1 matriz: %s operacoes, %s candidatos; a cidade mostra a lideranca atual',
                     jsonb_array_length(v_plan -> 'operations'), jsonb_array_length(v_plan -> 'candidates')) || chr(10);
  else r := r || format('FAIL P1 cidade=%s candidato=%s', n, n2) || chr(10); end if;

  -- P2
  v_res := public.set_city_leadership(v_org, v_city, y, m, v_new_emp, null, null, true);
  select count(*) into n from public.leadership_assignments where scope_key = 'city:' || v_city::text and effective_from = v_today;
  if v_res ->> 'action' = 'replaced' and (v_res ->> 'effective_from')::date = v_today and v_res ->> 'effective_to' is null
     and v_res -> 'previous' ->> 'action' = 'ended' and n = 0 then
    r := r || 'PASS P2 previa: substitui a partir de hoje, sem gravar' || chr(10);
  else r := r || format('FAIL P2 %s gravados=%s', v_res, n) || chr(10); end if;

  -- P3
  v_res := public.set_city_leadership(v_org, v_city, y, m, v_new_emp, null, null, false);
  select * into v_row from public.leadership_assignments where id = v_old_row;
  select * into v_row2 from public.leadership_assignments where id = (v_res ->> 'id')::uuid;
  reset role;
  select count(*) into n from public.audit_logs
   where entity_type = 'public.leadership_assignments' and user_id = v_user
     and entity_id in (v_old_row::text, v_res ->> 'id');
  set local role authenticated;
  if v_row.effective_to = v_today - 1 and v_row.status = 'active'
     and v_row2.employee_id = v_new_emp and v_row2.effective_from = v_today and v_row2.effective_to is null
     and v_row2.scope_level = 'city' and v_row2.responsibility_type = 'principal' and n >= 2 then
    r := r || 'PASS P3 troca na competencia corrente: anterior ate ontem (ativa), nova desde hoje em aberto; auditoria com o usuario' || chr(10);
  else r := r || format('FAIL P3 anterior=%s..%s/%s nova=%s..%s auditoria=%s', v_row.effective_from, v_row.effective_to, v_row.status,
                        v_row2.effective_from, v_row2.effective_to, n) || chr(10); end if;

  -- P4
  select count(*) into n from public.leadership_assignments where scope_key = 'city:' || v_city::text;
  v_res := public.set_city_leadership(v_org, v_city, y, m, v_new_emp, null, null, false);
  select count(*) into n2 from public.leadership_assignments where scope_key = 'city:' || v_city::text;
  if v_res ->> 'action' = 'unchanged' and n = n2 then r := r || 'PASS P4 mesma pessoa: nada muda' || chr(10);
  else r := r || format('FAIL P4 %s', v_res) || chr(10); end if;

  -- P5
  v_res := public.set_city_leadership(v_org, v_city, ny, nm, v_old_emp, null, null, false);
  select * into v_row2 from public.leadership_assignments
   where scope_key = 'city:' || v_city::text and employee_id = v_new_emp and effective_from = v_today;
  if v_res ->> 'action' = 'replaced' and (v_res ->> 'effective_from')::date = make_date(ny, nm, 1)
     and v_res ->> 'effective_to' is null and v_row2.effective_to = make_date(ny, nm, 1) - 1 then
    r := r || 'PASS P5 competencia futura: troca a partir do dia 1o; a do mes corrente termina no fim do mes' || chr(10);
  else r := r || format('FAIL P5 %s corrente_ate=%s', v_res, v_row2.effective_to) || chr(10); end if;

  -- P6
  v_res := public.set_city_leadership(v_org, v_city, y, m, null, null, null, false);
  select * into v_row2 from public.leadership_assignments where id = v_row2.id;
  if v_res ->> 'action' = 'removed' and v_row2.status = 'cancelled' then
    -- A nova começava hoje: não há véspera, a linha fica cancelada.
    r := r || 'PASS P6 remover na competencia corrente: o vinculo que comecava hoje fica cancelado' || chr(10);
  else r := r || format('FAIL P6 %s status=%s', v_res, v_row2.status) || chr(10); end if;
  v_plan := public.leadership_city_planner(v_org, y, m);
  select count(*) into n from jsonb_array_elements(v_plan -> 'operations') o, jsonb_array_elements(o -> 'cities') c,
                             jsonb_array_elements(c -> 'leaders') lk
   where c ->> 'operation_city_id' = v_city::text;
  if n = 1 then r := r || 'PASS P6 a matriz do mes mostra so quem respondeu ate ontem' || chr(10);
  else r := r || format('FAIL P6 lideres no mes=%s', n) || chr(10); end if;

  -- P7
  if v_city_empty is null then
    r := r || 'SKIP P7 nenhuma cidade sem lideranca no mes' || chr(10);
  else
    v_res := public.set_city_leadership(v_org, v_city_empty, y, m, v_new_emp, null, null, false);
    select * into v_row2 from public.leadership_assignments where id = (v_res ->> 'id')::uuid;
    if v_res ->> 'action' = 'assigned' and v_row2.effective_from = v_today
       and v_row2.effective_to = (make_date(y, m, 1) + interval '1 month - 1 day')::date then
      r := r || 'PASS P7 cidade sem lideranca: vale de hoje ao fim do mes' || chr(10);
    else r := r || format('FAIL P7 %s', v_res) || chr(10); end if;
  end if;

  -- P8
  reset role;
  select string_agg(role_id::text, ',' order by role_id) into v_roles_before from public.membership_roles mr
    join public.organization_memberships m3 on m3.id = mr.membership_id where m3.employee_id = v_other_emp;
  set local role authenticated;
  if v_other_emp is null then
    r := r || 'SKIP P8 nenhum colaborador fora do perfil' || chr(10);
  else
    v_res := public.set_city_leadership(v_org, v_city, ny, nm, v_other_emp, null, null, false);
    reset role;
    select string_agg(role_id::text, ',' order by role_id) into v_roles_after from public.membership_roles mr
      join public.organization_memberships m3 on m3.id = mr.membership_id where m3.employee_id = v_other_emp;
    set local role authenticated;
    if v_res ->> 'action' = 'replaced' and (v_res ->> 'warnings') like '%perfil Liderança Operações%'
       and v_roles_before is not distinct from v_roles_after then
      r := r || 'PASS P8 fora do perfil: aceito com aviso; perfil de acesso intacto' || chr(10);
    else r := r || format('FAIL P8 %s', v_res) || chr(10); end if;
  end if;

  reset role;
  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 2 · correção histórica
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; py int; pm int;
  v_city uuid; v_old_row uuid; v_old_emp uuid; v_old_to date; v_new_emp uuid;
  v_res jsonb; r text := ''; v_row record; v_row2 record; v_cont record;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m2.user_id into v_user from public.organization_memberships m2
   where m2.organization_id = v_org and m2.status = 'active' and m2.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  py := extract(year from (v_today - interval '1 month'))::int; pm := extract(month from (v_today - interval '1 month'))::int;

  select l.operation_city_id, l.id, l.employee_id, l.effective_to into v_city, v_old_row, v_old_emp, v_old_to
    from public.leadership_assignments l
    join public.operations o on o.id = l.operation_id and o.status = 'active' and o.deleted_at is null
   where l.organization_id = v_org and l.scope_level = 'city' and l.responsibility_type = 'principal'
     and l.status = 'active' and l.effective_to is null and l.effective_from < make_date(py, pm, 1)
   order by l.effective_from limit 1;
  select e.id into v_new_emp from public.employees e
   where e.organization_id = v_org and e.deleted_at is null and e.employment_status = 'active'
     and private.is_leadership_candidate(v_org, e.id) and e.id <> v_old_emp
   order by e.full_name limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- H1
  begin
    v_res := public.set_city_leadership(v_org, v_city, py, pm, v_new_emp, null, null, false);
    r := r || 'FAIL H1 competencia passada sem motivo foi aceita' || chr(10);
  exception when others then
    if sqlerrm like '%motivo da correção histórica%' then r := r || 'PASS H1 competencia passada sem motivo: recusada' || chr(10);
    else r := r || 'FAIL H1 ' || sqlerrm || chr(10); end if;
  end;

  -- H2
  v_res := public.set_city_leadership(v_org, v_city, py, pm, v_new_emp, null, 'Suite 18: correcao do mes anterior', false);
  select * into v_row from public.leadership_assignments where id = v_old_row;
  select * into v_row2 from public.leadership_assignments where id = (v_res ->> 'id')::uuid;
  select * into v_cont from public.leadership_assignments
   where scope_key = 'city:' || v_city::text and employee_id = v_old_emp and effective_from = make_date(py, pm, 1) + interval '1 month';
  if (v_res ->> 'retroactive')::boolean
     and v_row.effective_to = make_date(py, pm, 1) - 1
     and v_row2.effective_from = make_date(py, pm, 1)
     and v_row2.effective_to = (make_date(py, pm, 1) + interval '1 month - 1 day')::date
     and v_row2.change_reason = 'Suite 18: correcao do mes anterior'
     and v_cont.id is not null and v_cont.effective_to is not distinct from v_old_to then
    r := r || 'PASS H2 correcao historica com motivo: so o mes passado muda; a vigencia anterior volta no mes seguinte' || chr(10);
  else r := r || format('FAIL H2 %s anterior_ate=%s nova=%s..%s continua=%s', v_res, v_row.effective_to,
                        v_row2.effective_from, v_row2.effective_to, v_cont.id) || chr(10); end if;

  reset role;
  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 3 · perfis e escopo
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_today date; y int; m int; py int; pm int;
  v_op uuid; v_city_mine uuid; v_city_other uuid; v_emp_mine uuid; v_new_emp uuid;
  v_res jsonb; v_plan jsonb; n int; r text := ''; v_rand uuid := gen_random_uuid();
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m2.user_id, m2.id into v_user, v_mem from public.organization_memberships m2
   where m2.organization_id = v_org and m2.status = 'active' and m2.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  y := extract(year from v_today)::int; m := extract(month from v_today)::int;
  py := extract(year from (v_today - interval '1 month'))::int; pm := extract(month from (v_today - interval '1 month'))::int;

  -- A cidade com liderança em aberto e a operação dela; uma cidade de outra operação.
  select l.operation_city_id, l.operation_id, l.employee_id into v_city_mine, v_op, v_emp_mine
    from public.leadership_assignments l
    join public.operations o on o.id = l.operation_id and o.status = 'active' and o.deleted_at is null
   where l.organization_id = v_org and l.scope_level = 'city' and l.responsibility_type = 'principal'
     and l.status = 'active' and l.effective_to is null and l.effective_from < v_today
   order by l.effective_from limit 1;
  select oc.id into v_city_other from public.operation_cities oc
    join public.operations o on o.id = oc.operation_id and o.status = 'active' and o.deleted_at is null
   where oc.organization_id = v_org and oc.operation_id <> v_op limit 1;
  select e.id into v_new_emp from public.employees e
   where e.organization_id = v_org and e.deleted_at is null and e.employment_status = 'active'
     and private.is_leadership_candidate(v_org, e.id) and e.id <> v_emp_mine
   order by e.full_name limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Liderança Operações com escopo na operação da cidade (escopo antes da troca).
  perform set_config('hfm.access_change', 'on', true);
  delete from public.membership_operation_scopes where membership_id = v_mem;
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_op);
  update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'lideranca_operacoes' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);

  set local role authenticated;
  -- S1
  begin
    v_res := public.set_city_leadership(v_org, v_city_mine, y, m, v_new_emp, null, null, false);
    if v_res ->> 'action' = 'replaced' and not (v_res ->> 'retroactive')::boolean then
      r := r || 'PASS S1 lideranca: troca na competencia corrente da propria operacao, sem correcao historica' || chr(10);
    else r := r || format('FAIL S1 %s', v_res) || chr(10); end if;
  exception when others then r := r || 'FAIL S1 ' || sqlerrm || chr(10); end;
  -- S2
  begin
    v_res := public.set_city_leadership(v_org, v_city_other, y, m, v_new_emp, null, null, false);
    r := r || 'FAIL S2 lideranca planejou cidade de outra operacao' || chr(10);
  exception when others then
    v_plan := public.leadership_city_planner(v_org, y, m);
    select count(*) into n from jsonb_array_elements(v_plan -> 'operations') o where o ->> 'id' <> v_op::text;
    if sqlerrm like '%escopo%' and n = 0 and jsonb_array_length(v_plan -> 'operations') = 1 then
      r := r || 'PASS S2 lideranca: outra operacao recusada; a matriz traz so a propria operacao' || chr(10);
    else r := r || format('FAIL S2 erro=%s outras_ops=%s', sqlerrm, n) || chr(10); end if;
  end;
  -- S3
  begin
    v_res := public.set_city_leadership(v_org, v_city_mine, py, pm, v_new_emp, null, 'x', false);
    r := r || 'FAIL S3 lideranca corrigiu competencia passada' || chr(10);
  exception when others then
    if sqlerrm like '%correção histórica%' then r := r || 'PASS S3 lideranca: competencia passada recusada (correcao historica)' || chr(10);
    else r := r || 'FAIL S3 ' || sqlerrm || chr(10); end if;
  end;
  reset role;

  -- S4 Gestão
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'gestao' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  v_plan := public.leadership_city_planner(v_org, y, m);
  begin
    v_res := public.set_city_leadership(v_org, v_city_mine, y, m, v_emp_mine, null, null, false);
    r := r || 'FAIL S4 gestao planejou' || chr(10);
  exception when others then
    if sqlerrm like '%permissão%' and jsonb_array_length(v_plan -> 'operations') > 0 then
      r := r || 'PASS S4 gestao: le a matriz e nao planeja' || chr(10);
    else r := r || 'FAIL S4 ' || sqlerrm || chr(10); end if;
  end;
  reset role;

  -- S5 Operacional
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'operacional' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    v_plan := public.leadership_city_planner(v_org, y, m);
    r := r || 'FAIL S5 operacional leu a matriz' || chr(10);
  exception when others then
    if sqlerrm like '%permissão%' then r := r || 'PASS S5 operacional: matriz recusada' || chr(10);
    else r := r || 'FAIL S5 ' || sqlerrm || chr(10); end if;
  end;
  reset role;

  -- S6 (de volta ao papel original é desnecessário: tudo é desfeito no fim)
  perform set_config('hfm.access_change', 'on', true);
  update public.platform_admins set revoked_at = null where user_id = v_user and revoked_at = now();
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    v_res := public.set_city_leadership(v_rand, v_city_mine, y, m, v_emp_mine, null, null, false);
    n := 0;
  exception when others then n := case when sqlerrm like '%não encontrada%' then 1 else -1 end; end;
  begin
    v_res := public.set_city_leadership(v_org, v_rand, y, m, v_emp_mine, null, null, false);
    r := r || case when n = 1 then '' else 'FAIL S6 organizacao trocada: ' || n || chr(10) end;
    r := r || 'FAIL S6 cidade inexistente aceita' || chr(10);
  exception when others then
    if n = 1 and sqlerrm like '%não encontrada%' then r := r || 'PASS S6 organizacao trocada e cidade inexistente: recusadas' || chr(10);
    else r := r || format('FAIL S6 org=%s cidade=%s', n, sqlerrm) || chr(10); end if;
  end;
  reset role;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
