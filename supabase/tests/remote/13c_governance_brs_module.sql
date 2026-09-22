-- =============================================================================
-- 13c · Governança Operacional — módulo BRs, contexto central, motoristas,
--       replicação da fidelização e estabilidade (Etapa 13.1)
--
-- Suíte transacional contra o banco COM DADOS: usa as BRs, as vigências, os
-- veículos e os colaboradores reais da organização. Não cria veículo, BR nem
-- colaborador. Para ter um veículo livre, encerra — pela rotina oficial, com
-- motivo — a vigência de uma BR da mesma operação; tudo é desfeito no fim.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- O que cada bloco protege:
--   C1   §47  contexto central: operação, estado, cidade, BR, veículo,
--             liderança e origem de cada vínculo; BR desconhecida → null
--   C2   §54  a consulta histórica usa o que valia NA DATA: após substituir
--             o veículo a partir de amanhã, hoje ainda responde o anterior
--   C3   §24  diretório paginado e ordenado no servidor; filtro "com
--             substituição no período"; filtro por operação
--   C4   §22  indicadores sem contagem dupla: com/sem liderança, por
--             liderança, com substituição no período
--   C5   §29  detalhe: movimentação com veículo anterior → novo e ator real;
--             BR desconhecida → null
--   C6   §48  BR atual e anteriores de um veículo, pelo vehicle_id
--   C7   §12  cobertura de lideranças e escopo de uma liderança (§35)
--   C8   §34  substituição transacional de motorista: anterior fechado na
--             véspera, novo planejado; recusas; conflito desfaz tudo
--   C9   §42  estabilidade sem contagem dupla: substituição = 1 evento,
--             inversão = 1 evento (duas linhas), trocas inferidas à parte
--   C10  §37  replicação com prévia: prévia não grava; real = prévia;
--             destino já planejado preservado; veículo em outra BR = conflito;
--             repetir não sobrescreve
--   C11  §63  sem permissão: substituir motorista, replicar, e o diretório e
--             o contexto sem `fidelization.view`/`leadership.view`
--
-- C11 rebaixa o próprio ator dentro de um sub-bloco desfeito por exceção
-- proposital (mesma técnica das suítes 12b/12c/13/13b). As mensagens vão sem
-- acento de propósito.
--
-- Última execução: 11/11 PASS contra o projeto de desenvolvimento (22/09/2026).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_leader uuid;
  a record; b record; c record; d record; e record;
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  j jsonb; j2 jsonb; j3 jsonb;
  n bigint; n2 bigint; n3 bigint; n4 bigint; n5 bigint;
  ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean;
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_new_a uuid; v_b_oct uuid; v_d_oct uuid;
  v_src bigint; v_created bigint;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m where m.organization_id = v_org and m.status = 'active' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Fixture: cinco BRs vigentes da mesma operacao (A..E), ordenadas por codigo.
  select ob.id, ob.code, ob.operation_id, fa.id as assignment_id, fa.vehicle_id, fa.start_date, fa.end_date into a
    from public.operation_brs ob join public.fidelization_assignments fa on fa.operation_br_id = ob.id
   where ob.organization_id = v_org and ob.deleted_at is null and ob.status = 'active'
     and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= current_date and (fa.end_date is null or fa.end_date >= current_date)
     and ob.operation_id = (select b2.operation_id from public.operation_brs b2 join public.fidelization_assignments a2 on a2.operation_br_id = b2.id
                            where b2.organization_id = v_org and a2.status <> 'cancelled' and a2.vehicle_role = 'primary'
                              and a2.start_date <= current_date and (a2.end_date is null or a2.end_date >= current_date)
                            group by b2.operation_id having count(*) >= 5 order by count(*) desc limit 1)
   order by ob.code limit 1;
  select ob.id, ob.code, ob.operation_id, fa.id as assignment_id, fa.vehicle_id, fa.start_date, fa.end_date into b
    from public.operation_brs ob join public.fidelization_assignments fa on fa.operation_br_id = ob.id
   where ob.operation_id = a.operation_id and ob.id <> a.id and ob.status = 'active' and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= current_date and (fa.end_date is null or fa.end_date >= current_date) order by ob.code limit 1;
  select ob.id, ob.code, ob.operation_id, fa.id as assignment_id, fa.vehicle_id, fa.start_date, fa.end_date into c
    from public.operation_brs ob join public.fidelization_assignments fa on fa.operation_br_id = ob.id
   where ob.operation_id = a.operation_id and ob.id not in (a.id, b.id) and ob.status = 'active' and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= current_date and (fa.end_date is null or fa.end_date >= current_date) order by ob.code limit 1;
  select ob.id, ob.code, ob.operation_id, fa.id as assignment_id, fa.vehicle_id, fa.start_date, fa.end_date into d
    from public.operation_brs ob join public.fidelization_assignments fa on fa.operation_br_id = ob.id
   where ob.operation_id = a.operation_id and ob.id not in (a.id, b.id, c.id) and ob.status = 'active' and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= current_date and (fa.end_date is null or fa.end_date >= current_date) order by ob.code limit 1;
  select ob.id, ob.code, ob.operation_id, fa.id as assignment_id, fa.vehicle_id, fa.start_date, fa.end_date into e
    from public.operation_brs ob join public.fidelization_assignments fa on fa.operation_br_id = ob.id
   where ob.operation_id = a.operation_id and ob.id not in (a.id, b.id, c.id, d.id) and ob.status = 'active' and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= current_date and (fa.end_date is null or fa.end_date >= current_date) order by ob.code limit 1;
  if a.id is null or b.id is null or c.id is null or d.id is null or e.id is null then
    raise exception 'Fixture: a suite precisa de cinco BRs vigentes na mesma operacao';
  end if;
  if coalesce(a.end_date, current_date) < current_date + 3 or coalesce(b.end_date, current_date) < current_date + 3 then
    raise exception 'Fixture: as vigencias de A e B precisam ir ate pelo menos hoje + 3';
  end if;

  select e1.id into v_e1 from public.employees e1 where e1.organization_id = v_org and e1.employment_status = 'active' and e1.deleted_at is null
     and not exists (select 1 from public.fidelization_drivers x where x.employee_id = e1.id and x.status <> 'cancelled') order by e1.full_name limit 1;
  select e1.id into v_e2 from public.employees e1 where e1.organization_id = v_org and e1.employment_status = 'active' and e1.deleted_at is null and e1.id <> v_e1
     and not exists (select 1 from public.fidelization_drivers x where x.employee_id = e1.id and x.status <> 'cancelled') order by e1.full_name limit 1;
  select e1.id into v_e3 from public.employees e1 where e1.organization_id = v_org and e1.employment_status = 'active' and e1.deleted_at is null and e1.id not in (v_e1, v_e2)
     and not exists (select 1 from public.fidelization_drivers x where x.employee_id = e1.id and x.status <> 'cancelled') order by e1.full_name limit 1;

  -- Libera o veiculo de C: encerra a vigencia de C ontem, pela rotina oficial.
  perform public.end_fidelization_assignment(c.assignment_id, current_date - 1, 'Suite 13c: libera o veiculo');

  -- C1: contexto central
  j := public.resolve_operational_context(v_org, a.id, current_date);
  ok  := (j->'br'->>'id')::uuid = a.id and (j->'operation'->>'id')::uuid = a.operation_id
         and j->'state'->>'uf' is not null and j->'city'->>'name' is not null;
  ok2 := (j->'vehicle'->>'id')::uuid = a.vehicle_id and (j->'vehicle'->>'assignment_id')::uuid = a.assignment_id and j->'origins'->>'vehicle' = 'import';
  ok3 := j->'leadership'->>'name' is not null and j->'leadership'->>'rule' is not null and j->'origins'->>'leadership' in ('br', 'city', 'operation');
  ok4 := public.resolve_operational_context(v_org, gen_random_uuid(), current_date) is null;
  ok5 := public.resolve_operational_context(v_org, c.id, current_date)->'vehicle' = 'null'::jsonb;
  r := r || format('C1  contexto: hierarquia=%s, veiculo com origem=%s, lideranca com regra=%s, BR desconhecida=null %s, BR sem veiculo hoje=%s -> %s%s',
       ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- C2: substitui o veiculo de A pelo de C a partir de amanha; hoje ainda responde o anterior
  j := public.substitute_fidelization_vehicle(a.assignment_id, c.vehicle_id, current_date + 1, 'Suite 13c: substituicao');
  v_new_a := (j->>'new_id')::uuid;
  ok  := (public.resolve_operational_context(v_org, a.id, current_date)->'vehicle'->>'id')::uuid = a.vehicle_id;
  j2 := public.resolve_operational_context(v_org, a.id, current_date + 1);
  ok2 := (j2->'vehicle'->>'id')::uuid = c.vehicle_id and j2->'origins'->>'vehicle' = 'substitution' and (j2->'vehicle'->>'assignment_id')::uuid = v_new_a;
  ok3 := (select end_date from public.fidelization_assignments where id = a.assignment_id) = current_date;
  r := r || format('C2  historico na data: hoje=anterior %s, amanha=novo (origem substituicao) %s, anterior fechado hoje=%s -> %s%s',
       ok, ok2, ok3, case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- C3: diretorio paginado e ordenado no servidor
  select count(*) into n from public.operation_brs where organization_id = v_org and deleted_at is null;
  j := public.br_directory(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{}'::jsonb, 5, 0, 'code', 'asc');
  j2 := public.br_directory(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{}'::jsonb, 5, 5, 'code', 'asc');
  j3 := public.br_directory(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{}'::jsonb, 1, 0, 'code', 'desc');
  ok  := (j->>'total')::int = n and jsonb_array_length(j->'rows') = 5 and (j2->'rows'->0->>'code') <> (j->'rows'->0->>'code');
  ok2 := (j3->'rows'->0->>'code') = (select max(code) from public.operation_brs where organization_id = v_org and deleted_at is null);
  j := public.br_directory(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{"swapped":"with"}'::jsonb, 200, 0, 'last_movement', 'desc');
  ok3 := exists (select 1 from jsonb_array_elements(j->'rows') x where (x->>'id')::uuid = a.id and (x->>'swapped_in_period')::boolean)
         and (j->'rows'->0->>'id')::uuid = a.id;
  j := public.br_directory(v_org, extract(year from current_date)::int, extract(month from current_date)::int, jsonb_build_object('operation_id', a.operation_id), 200, 0, 'code', 'asc');
  ok4 := (j->>'total')::int = (select count(*) from public.operation_brs where organization_id = v_org and deleted_at is null and operation_id = a.operation_id)
         and not exists (select 1 from jsonb_array_elements(j->'rows') x where (x->>'operation_id')::uuid <> a.operation_id);
  r := r || format('C3  diretorio: total=%s e pagina 2 avanca %s, ordem desc %s, com substituicao no periodo (A primeiro por ultima movimentacao) %s, filtro por operacao %s -> %s%s',
       n, ok, ok2, ok3, ok4, case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  -- C4: indicadores sem contagem dupla
  j := public.br_planner_indicators(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{}'::jsonb);
  ok  := (j->>'with_leader')::int + (j->>'without_leader')::int <= (j->>'total')::int;
  ok2 := (j->>'with_vehicle_swap_in_period')::int >= 1;
  select coalesce(sum((x->>'total')::int), 0) into n from jsonb_array_elements(j->'by_leader') x;
  ok3 := n = (j->>'with_leader')::int;
  ok4 := (j->>'with_vehicle')::int + (j->>'without_vehicle')::int = (j->>'total')::int;
  r := r || format('C4  indicadores: com+sem lideranca <= total %s, com substituicao no periodo>=1 %s, por lideranca soma=com lideranca %s, com+sem veiculo=total %s -> %s%s',
       ok, ok2, ok3, ok4, case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  -- C5: detalhe com movimentacao e ator real
  j := public.br_detail(v_org, a.id, extract(year from current_date)::int, extract(month from current_date)::int);
  ok  := (j->'br'->>'id')::uuid = a.id and jsonb_array_length(j->'movements') = 1;
  ok2 := (j->'movements'->0->>'kind') = 'substitution' and (j->'movements'->0->>'previous_vehicle_id')::uuid = a.vehicle_id
         and (j->'movements'->0->>'new_vehicle_id')::uuid = c.vehicle_id and (j->'movements'->0->>'created_by')::uuid = v_user
         and (j->'movements'->0->>'reason') = 'Suite 13c: substituicao';
  ok3 := (j->'indicators'->>'vehicle_swaps_in_period')::int = 1
         and exists (select 1 from jsonb_array_elements(j->'vehicle_history') x where (x->>'assignment_id')::uuid = v_new_a);
  ok4 := public.br_detail(v_org, gen_random_uuid(), null, null) is null;
  ok5 := j->'movements'->0->>'actor_name' = (select full_name from public.profiles where user_id = v_user);
  r := r || format('C5  detalhe: 1 movimentacao %s, anterior->novo com ator e motivo %s, indicadores e historico %s, BR desconhecida=null %s, nome do ator pelo perfil %s -> %s%s',
       ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- C6: BR atual e anteriores do veiculo
  j := public.vehicle_br_history(v_org, a.vehicle_id);
  ok  := (j->'current'->>'operation_br_id')::uuid = a.id and (j->'current'->>'is_current')::boolean;
  j2 := public.vehicle_br_history(v_org, c.vehicle_id);
  ok2 := j2->'current' = 'null'::jsonb
         and exists (select 1 from jsonb_array_elements(j2->'history') x where (x->>'operation_br_id')::uuid = a.id and (x->>'source') = 'substitution')
         and exists (select 1 from jsonb_array_elements(j2->'history') x where (x->>'operation_br_id')::uuid = c.id and (x->>'end_date')::date = current_date - 1);
  ok3 := (j2->>'substitutions')::int = 1;
  r := r || format('C6  veiculo: atual de A %s, o veiculo de C sem BR hoje e com A amanha no historico %s, substituicoes=1 %s -> %s%s',
       ok, ok2, ok3, case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- C7: cobertura de liderancas e escopo de uma lideranca
  j := public.leadership_indicators(v_org, extract(year from current_date)::int, extract(month from current_date)::int, null);
  ok  := (j->>'places_with_leader')::int + (j->>'places_without_leader')::int = (j->>'places_total')::int;
  ok2 := (j->>'coverage_pct')::numeric = round(100.0 * (j->>'places_with_leader')::int / nullif((j->>'places_total')::int, 0), 1);
  ok3 := (j->>'brs_under_leadership')::int <= (j->>'brs_total')::int and (j->>'vehicles_linked')::int <= (j->>'brs_under_leadership')::int;
  select l.employee_id into v_leader from private.br_leadership_at(a.id, private.competence_anchor(extract(year from current_date)::int, extract(month from current_date)::int)) l;
  j2 := public.leadership_scope_summary(v_org, v_leader, extract(year from current_date)::int, extract(month from current_date)::int);
  select count(*) into n from public.br_planner_rows(v_org, extract(year from current_date)::int, extract(month from current_date)::int, jsonb_build_object('leader_employee_id', v_leader));
  ok4 := (j2->>'brs_total')::int = n and exists (select 1 from jsonb_array_elements(j2->'brs') x where (x->>'id')::uuid = a.id)
         and jsonb_array_length(j2->'operations') >= 1;
  r := r || format('C7  liderancas: com+sem=locais %s, cobertura=%s%% %s, sob responsabilidade coerente %s, escopo do lider de A = planner filtrado (%s BRs) %s -> %s%s',
       ok, j->>'coverage_pct', ok2, ok3, n, ok4, case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  -- C8: substituicao transacional de motorista
  if v_e1 is null or v_e2 is null or v_e3 is null then
    r := r || 'C8  SKIP: a suite precisa de tres colaboradores ativos sem vinculo de motorista' || chr(10);
  else
    v_d1 := public.save_fidelization_driver(v_org, jsonb_build_object('fidelization_assignment_id', b.assignment_id, 'employee_id', v_e1, 'driver_role', 'primary', 'start_date', current_date::text));
    j := public.substitute_fidelization_driver(v_org, jsonb_build_object('driver_id', v_d1, 'new_employee_id', v_e2, 'effective_from', (current_date + 2)::text, 'reason', 'Suite 13c: troca'));
    v_d2 := (j->>'new_id')::uuid;
    ok  := (select end_date from public.fidelization_drivers where id = v_d1) = current_date + 1
           and (select end_reason from public.fidelization_drivers where id = v_d1) = 'Suite 13c: troca';
    ok2 := (select status = 'planned' and employee_id = v_e2 and start_date = current_date + 2 and end_date = b.end_date and fidelization_assignment_id = b.assignment_id
              from public.fidelization_drivers where id = v_d2);
    -- recusas
    ok3 := false;
    begin
      perform public.substitute_fidelization_driver(v_org, jsonb_build_object('driver_id', v_d2, 'new_employee_id', v_e2, 'effective_from', (current_date + 3)::text, 'reason', 'x'));
    exception when invalid_parameter_value then ok3 := true; end;
    ok4 := false;
    begin
      perform public.substitute_fidelization_driver(v_org, jsonb_build_object('driver_id', v_d2, 'new_employee_id', v_e3, 'effective_from', (current_date + 3)::text));
    exception when invalid_parameter_value then ok4 := true; end;
    -- conflito desfaz tudo: E3 e principal do novo vinculo de A a partir de amanha; entra-lo em B no dia +3 viola a ocupacao
    v_d3 := public.save_fidelization_driver(v_org, jsonb_build_object('fidelization_assignment_id', v_new_a, 'employee_id', v_e3, 'driver_role', 'primary', 'start_date', (current_date + 1)::text));
    ok5 := false;
    begin
      perform public.substitute_fidelization_driver(v_org, jsonb_build_object('driver_id', v_d2, 'new_employee_id', v_e3, 'effective_from', (current_date + 3)::text, 'reason', 'conflito'));
    exception when exclusion_violation then ok5 := true; end;
    ok5 := ok5 and (select end_date from public.fidelization_drivers where id = v_d2) = b.end_date
           and (select count(*) from public.fidelization_drivers where fidelization_assignment_id = b.assignment_id and status <> 'cancelled') = 2;
    r := r || format('C8  motorista: anterior fechado na vespera com motivo %s, novo planejado ate o fim do vinculo %s, mesmo motorista recusado %s, sem motivo recusado %s, conflito desfaz o fechamento %s -> %s%s',
         ok, ok2, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));
  end if;

  -- C9: estabilidade sem contagem dupla — inverte B e D a partir de amanha
  perform public.invert_fidelization_vehicles(b.assignment_id, d.assignment_id, current_date + 1, 'Suite 13c: inversao');
  j := public.fidelization_stability(v_org, extract(year from current_date)::int, extract(month from current_date)::int, jsonb_build_object('operation_id', a.operation_id));
  ok  := (j->>'vehicle_substitutions')::int = 1 and (j->>'vehicle_inversions')::int = 1 and (j->>'mobilizations')::int = 2;
  ok2 := (j->>'brs_with_vehicle_change')::int = 3;
  ok3 := (j->>'fleet_stability_pct')::numeric = round(100.0 * (1 - 3::numeric / (j->>'brs_with_vehicle')::int), 1);
  ok4 := (j->>'leadership_coverage_pct')::numeric = round(100.0 * (j->>'brs_with_leader')::int / (j->>'brs_total')::int, 1);
  select (x->>'mobilizations')::int into n from jsonb_array_elements(j->'by_operation') x where (x->>'operation_id')::uuid = a.operation_id;
  ok5 := n = 2 and (j->>'inferred_vehicle_changes')::int >= 0
         and (select count(*) from public.fidelization_assignments where operation_br_id in (b.id, d.id) and source = 'inversion') = 2;
  r := r || format('C9  estabilidade: 1 substituicao + 1 inversao (2 linhas) = 2 mobilizacoes %s, 3 BRs com troca %s, formula da frota %s, cobertura %s, por operacao = 2 e inferidas (%s) nao entram %s -> %s%s',
       ok, ok2, ok3, ok4, j->>'inferred_vehicle_changes', ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- C10: replicacao com previa (mes vigente -> proximo), sem sobrescrever
  -- B ja planejada no destino com o veiculo antigo de A (livre em outubro); D planejada com o veiculo de E (conflito para E).
  j := public.save_fidelization_assignment(v_org, jsonb_build_object('operation_br_id', b.id, 'vehicle_id', a.vehicle_id,
         'start_date', to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM-DD'),
         'end_date', to_char(date_trunc('month', current_date) + interval '2 month - 1 day', 'YYYY-MM-DD'), 'source', 'manual', 'reason', 'Suite 13c: destino'));
  v_b_oct := (j->>'id')::uuid;
  j := public.save_fidelization_assignment(v_org, jsonb_build_object('operation_br_id', d.id, 'vehicle_id', e.vehicle_id,
         'start_date', to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM-DD'),
         'end_date', to_char(date_trunc('month', current_date) + interval '2 month - 1 day', 'YYYY-MM-DD'), 'source', 'manual', 'reason', 'Suite 13c: destino'));
  v_d_oct := (j->>'id')::uuid;
  select count(*) into v_src from public.operation_brs x join public.fidelization_assignments y on y.operation_br_id = x.id join public.vehicles v on v.id = y.vehicle_id
   where x.organization_id = v_org and x.deleted_at is null and x.status = 'active' and v.status = 'active' and v.deleted_at is null
     and y.vehicle_role = 'primary' and y.status <> 'cancelled'
     and y.start_date <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date
     and (y.end_date is null or y.end_date >= (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
  select count(*) into n from public.fidelization_assignments where organization_id = v_org;
  j := public.replicate_fidelization_competence(v_org, extract(year from current_date)::int, extract(month from current_date)::int,
         extract(year from date_trunc('month', current_date) + interval '1 month')::int, extract(month from date_trunc('month', current_date) + interval '1 month')::int,
         null, true, true);
  select count(*) into n2 from public.fidelization_assignments where organization_id = v_org;
  ok  := n2 = n and (j->>'dry_run')::boolean;
  ok2 := (j->'vehicles'->>'kept')::int = 2 and (j->'vehicles'->>'conflicts')::int = 1
         and (j->'vehicles'->>'new')::int = v_src - 3
         and exists (select 1 from jsonb_array_elements(j->'rows') x where (x->>'br_id')::uuid = e.id and x->>'status' = 'conflict')
         and exists (select 1 from jsonb_array_elements(j->'rows') x where (x->>'br_id')::uuid = b.id and x->>'status' = 'kept');
  j2 := public.replicate_fidelization_competence(v_org, extract(year from current_date)::int, extract(month from current_date)::int,
         extract(year from date_trunc('month', current_date) + interval '1 month')::int, extract(month from date_trunc('month', current_date) + interval '1 month')::int,
         null, true, false);
  select count(*) into n3 from public.fidelization_assignments where organization_id = v_org and source = 'replication';
  select count(*) into n4 from public.fidelization_drivers where organization_id = v_org and reason like 'Replicado de %';
  ok3 := n3 = (j->'vehicles'->>'new')::int and (j2->'vehicles'->>'new')::int = (j->'vehicles'->>'new')::int
         and n4 = (j2->'drivers'->>'new')::int and (j2->'drivers'->>'new')::int = (j->'drivers'->>'new')::int
         and not exists (select 1 from public.fidelization_assignments where organization_id = v_org and source = 'replication'
                          and (status <> 'planned' or start_date <> (date_trunc('month', current_date) + interval '1 month')::date));
  -- preservado: B continua com o veiculo antigo de A em outubro, e nada a mais foi criado para B
  ok4 := (select vehicle_id from public.fidelization_assignments where id = v_b_oct) = a.vehicle_id
         and (select count(*) from public.fidelization_assignments where operation_br_id = b.id and start_date >= (date_trunc('month', current_date) + interval '1 month')::date and status <> 'cancelled') = 1;
  j3 := public.replicate_fidelization_competence(v_org, extract(year from current_date)::int, extract(month from current_date)::int,
         extract(year from date_trunc('month', current_date) + interval '1 month')::int, extract(month from date_trunc('month', current_date) + interval '1 month')::int,
         null, true, false);
  select count(*) into n5 from public.fidelization_assignments where organization_id = v_org and source = 'replication';
  ok5 := (j3->'vehicles'->>'new')::int = 0 and (j3->'vehicles'->>'kept')::int = v_src - 1 and (j3->'vehicles'->>'conflicts')::int = 1 and n5 = n3;
  r := r || format('C10 replicacao: previa nao grava %s, previa = %s novos/2 preservados/1 conflito %s, real = previa (veiculos %s, motoristas %s) %s, destino preservado %s, repetir nao sobrescreve %s -> %s%s',
       ok, v_src - 3, ok2, n3, n4, ok3, ok4, ok5, case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, chr(10));

  -- C11: sem permissao (rebaixamento temporario, desfeito por excecao)
  n := 0; n2 := 0; n3 := -1; ok4 := false;
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    delete from public.role_permissions rp
     using public.permissions p, public.membership_roles mr, public.organization_memberships om
     where rp.permission_id = p.id and rp.role_id = mr.role_id and mr.membership_id = om.id
       and om.user_id = v_user and om.organization_id = v_org
       and p.code in ('fidelization.change_driver', 'fidelization.plan', 'fidelization.view', 'leadership.view');
    perform set_config('hfm.access_change', '', true);
    begin
      perform public.substitute_fidelization_driver(v_org, jsonb_build_object('driver_id', coalesce(v_d3, gen_random_uuid()), 'new_employee_id', coalesce(v_e1, gen_random_uuid()), 'effective_from', (current_date + 5)::text, 'reason', 'x'));
    exception when others then n := case when sqlstate = '42501' then 1 else 0 end; end;
    begin
      perform public.replicate_fidelization_competence(v_org, extract(year from current_date)::int, extract(month from current_date)::int,
        extract(year from date_trunc('month', current_date) + interval '2 month')::int, extract(month from date_trunc('month', current_date) + interval '2 month')::int, null, false, true);
    exception when others then n2 := case when sqlstate = '42501' then 1 else 0 end; end;
    -- As leituras sao security invoker: a RLS de operation_brs decide. O editor
    -- roda como postgres (bypassa RLS), entao a leitura e feita como `authenticated`.
    set local role authenticated;
    j := public.br_directory(v_org, null, null, '{}'::jsonb, 5, 0, 'code', 'asc');
    n3 := (j->>'total')::int;
    ok4 := public.resolve_operational_context(v_org, a.id, current_date) is null
           and (public.fidelization_stability(v_org, extract(year from current_date)::int, extract(month from current_date)::int, '{}'::jsonb)->>'brs_total')::int = 0;
    reset role;
    raise exception 'desfaz o rebaixamento' using errcode = 'HF001';
  exception when sqlstate 'HF001' then null;
  end;
  if not private.has_permission(v_org, 'fidelization.view') then raise exception 'C11 nao restaurou o administrador'; end if;
  r := r || format('C11 sem permissao: substituir motorista=%s, replicar=%s, diretorio vazio (total=%s), contexto e estabilidade vazios=%s -> %s%s',
       n, n2, n3, ok4, case when n = 1 and n2 = 1 and n3 = 0 and ok4 then 'PASS' else 'FAIL' end, chr(10));

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end;
$t$;
