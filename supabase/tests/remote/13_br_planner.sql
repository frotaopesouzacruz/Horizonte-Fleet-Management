-- =============================================================================
-- 13 · Planner de Locais e BRs (20260922120000 / 121000 / 122000 / 123000)
--
-- Suíte transacional contra o banco COM DADOS: ela não cria operação, cidade
-- nem veículo — a §56 proíbe justamente isso —, ela encontra os 88 BRs e as
-- 239 vigências que a carga histórica trouxe e pergunta o que a etapa promete.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco. Ele
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: é assim que
-- devolve o resultado e desfaz tudo o que fez. Um erro com esse texto é o
-- sucesso; qualquer outro erro é a suíte tendo abortado antes da hora.
--
-- O que cada bloco protege:
--   A1–A3    a competência é uma janela, não um cadastro (§22/§23)
--   A4–A6    os indicadores da §26 fecham com as linhas da §24
--   A7–A8    a placa muda e o BR não (§12/§34) — provado na base real
--   A9       a precedência de liderança da §43, com a exceção do BR por cima
--   A10–A15  o multicadastro da §17/§18 e a prévia honesta da §58
--   A16–A17  a origem declarada e o período conferido (§57)
--   B1–B2    sem permissão não se cadastra e não se importa (§63)
--
-- A Fase B simula um chamador sem privilégio retirando, DENTRO da transação, o
-- vínculo de administrador de plataforma e as permissões do perfil. Ela abre o
-- portão que as rotinas oficiais de acesso abrem (`private.access_change_begin`)
-- porque o gatilho da Etapa 05 — corretamente — não deixa ninguém mexer na
-- matriz de acesso por fora. Nada disso é persistido.
--
-- As mensagens de PASS/FAIL vão sem acento de propósito: elas voltam dentro de
-- uma mensagem de erro do PostgreSQL, que atravessa clientes e logs de
-- codificação incerta, e um "posições" partido ao meio no meio do relatório
-- faria duvidar do resultado em vez do transporte.
--
-- Última execução: 19/19 PASS contra o projeto de desenvolvimento (21/09/2026).
-- =============================================================================
do $t$
declare
  v_org       uuid;
  v_user      uuid;
  v_br        uuid;
  v_br_code   text;
  v_br2       uuid;
  v_op        uuid;
  v_op_city   uuid;
  v_city      integer;
  v_emp       uuid;
  v_emp_name  text;
  v_json      jsonb;
  v_json2     jsonb;
  v_rec       record;
  v_anchor    date;
  v_past      date;
  v_a         bigint;
  v_b         bigint;
  v_n         bigint;
  v_code      text;
  v_plates    bigint;
  v_scope     text;
  v_veh       uuid;
  r           text := '';
begin
  ---------------------------------------------------------------- fixtures
  select o.id into v_org
    from public.organizations o
   where o.deleted_at is null and o.status = 'active'
   order by o.created_at
   limit 1;

  select m.user_id into v_user
    from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active'
   limit 1;

  -- O BR com mais vigências: é nele que a troca de placa aparece.
  select b.id, b.code, b.operation_id, b.operation_city_id, b.city_id, count(a.id)
    into v_br, v_br_code, v_op, v_op_city, v_city, v_n
    from public.operation_brs b
    join public.fidelization_assignments a on a.operation_br_id = b.id
   where b.organization_id = v_org and b.deleted_at is null
   group by b.id, b.code, b.operation_id, b.operation_city_id, b.city_id
   order by count(a.id) desc, b.code
   limit 1;

  select b.id into v_br2
    from public.operation_brs b
   where b.organization_id = v_org and b.deleted_at is null and b.id <> v_br
   limit 1;

  select e.id, e.full_name into v_emp, v_emp_name
    from public.employees e
   where e.organization_id = v_org and e.deleted_at is null
     and e.employment_status = 'active'
   order by e.created_at
   limit 1;

  if v_user is null or v_br is null or v_br2 is null or v_emp is null then
    raise exception 'FIXTURE incompleta: user=% br=% br2=% emp=%', v_user, v_br, v_br2, v_emp;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  /* =====================================================================
     FASE A — chamador com acesso total
     ===================================================================== */

  -- A1: a âncora do mês corrente é hoje
  begin
    v_anchor := private.competence_anchor(
      extract(year from current_date)::integer, extract(month from current_date)::integer);
    if v_anchor = current_date then
      r := r || format('PASS A1 competencia corrente ancora em hoje (%s)%s', v_anchor, E'\n');
    else
      r := r || format('FAIL A1 esperado %s, veio %s%s', current_date, v_anchor, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A1 ' || sqlerrm || E'\n';
  end;

  -- A2: um mês que passou ancora no último dia dele — o retrato de como terminou
  begin
    v_past := (date_trunc('month', current_date) - interval '1 month')::date;
    v_anchor := private.competence_anchor(
      extract(year from v_past)::integer, extract(month from v_past)::integer);
    if v_anchor = (date_trunc('month', current_date) - interval '1 day')::date then
      r := r || format('PASS A2 competencia passada ancora no ultimo dia (%s)%s', v_anchor, E'\n');
    else
      r := r || format('FAIL A2 veio %s%s', v_anchor, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A2 ' || sqlerrm || E'\n';
  end;

  -- A3: um mês futuro ancora no primeiro dia — o que já está planejado
  begin
    v_past := (date_trunc('month', current_date) + interval '2 months')::date;
    v_anchor := private.competence_anchor(
      extract(year from v_past)::integer, extract(month from v_past)::integer);
    if v_anchor = v_past then
      r := r || format('PASS A3 competencia futura ancora no primeiro dia (%s)%s', v_anchor, E'\n');
    else
      r := r || format('FAIL A3 veio %s%s', v_anchor, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A3 ' || sqlerrm || E'\n';
  end;

  -- A4: o planner devolve exatamente os BRs não excluídos da organização
  begin
    select count(*) into v_a from public.br_planner_rows(v_org);
    select count(*) into v_b
      from public.operation_brs b
     where b.organization_id = v_org and b.deleted_at is null;
    if v_a = v_b and v_a > 0 then
      r := r || format('PASS A4 planner devolve as %s posicoes cadastradas%s', v_a, E'\n');
    else
      r := r || format('FAIL A4 planner=%s cadastro=%s%s', v_a, v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A4 ' || sqlerrm || E'\n';
  end;

  -- A5: "com veículo" e "sem veículo" particionam o conjunto — sem sobra nem buraco
  begin
    select count(*) into v_a from public.br_planner_rows(v_org, null, null, jsonb_build_object('vehicle', 'with'));
    select count(*) into v_b from public.br_planner_rows(v_org, null, null, jsonb_build_object('vehicle', 'without'));
    select count(*) into v_n from public.br_planner_rows(v_org);
    if v_a + v_b = v_n and v_a > 0 then
      r := r || format('PASS A5 com(%s) + sem(%s) = total(%s)%s', v_a, v_b, v_n, E'\n');
    else
      r := r || format('FAIL A5 com=%s sem=%s total=%s%s', v_a, v_b, v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A5 ' || sqlerrm || E'\n';
  end;

  -- A6: §26 — o indicador não conta o mesmo BR duas vezes por ter seis placas
  begin
    v_json := public.br_planner_indicators(v_org);
    select count(*) into v_a from public.br_planner_rows(v_org, null, null, jsonb_build_object('vehicle', 'with'));
    if (v_json ->> 'with_vehicle')::bigint = v_a
       and (v_json ->> 'with_vehicle')::bigint + (v_json ->> 'without_vehicle')::bigint = (v_json ->> 'total')::bigint
       and (v_json ->> 'active')::bigint + (v_json ->> 'inactive')::bigint = (v_json ->> 'total')::bigint then
      r := r || format('PASS A6 indicadores fecham com as linhas (%s com veiculo de %s)%s',
                       v_json ->> 'with_vehicle', v_json ->> 'total', E'\n');
    else
      r := r || format('FAIL A6 indicadores=%s linhas com veiculo=%s%s', v_json::text, v_a, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A6 ' || sqlerrm || E'\n';
  end;

  -- A7: §12/§34 — a mesma posição passou por mais de uma placa e continua uma só
  begin
    select count(*), count(distinct a.vehicle_id) into v_n, v_plates
      from public.br_vehicle_history(v_br) a;
    if v_n >= 2 and v_plates >= 2 then
      r := r || format('PASS A7 a %s teve %s vinculos com %s veiculos distintos%s', v_br_code, v_n, v_plates, E'\n');
    else
      r := r || format('FAIL A7 %s: vinculos=%s veiculos=%s%s', v_br_code, v_n, v_plates, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A7 ' || sqlerrm || E'\n';
  end;

  -- A8: §22 — mudar a competência muda o veículo, nunca o BR
  begin
    select a.start_date into v_past
      from public.fidelization_assignments a
     where a.operation_br_id = v_br and a.status <> 'cancelled' and a.vehicle_role = 'primary'
     order by a.start_date limit 1;

    select count(*) into v_a
      from public.br_planner_rows(v_org, extract(year from v_past)::integer, extract(month from v_past)::integer)
     where id = v_br;
    select count(*) into v_b from public.br_planner_rows(v_org) where id = v_br;

    if v_a = 1 and v_b = 1 then
      r := r || format('PASS A8 a %s existe em %s e na competencia atual%s', v_br_code, to_char(v_past, 'MM/YYYY'), E'\n');
    else
      r := r || format('FAIL A8 passada=%s atual=%s%s', v_a, v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A8 ' || sqlerrm || E'\n';
  end;

  -- A9: §43 — a exceção do BR passa por cima da cidade e da operação
  begin
    select scope_level into v_scope from private.br_leadership_at(v_br, current_date);

    insert into public.leadership_assignments
      (organization_id, employee_id, scope_level, operation_id, operation_city_id,
       operation_br_id, responsibility_type, effective_from, status, notes)
    select v_org, v_emp, 'br', b.operation_id, b.operation_city_id, b.id,
           'principal', current_date, 'active', 'fixture da suite 13'
      from public.operation_brs b where b.id = v_br;

    select scope_level, employee_id into v_rec from private.br_leadership_at(v_br, current_date);

    if v_rec.scope_level = 'br' and v_rec.employee_id = v_emp then
      r := r || format('PASS A9 excecao do BR vence (antes: %s, agora: br)%s', coalesce(v_scope, 'ninguem'), E'\n');
    else
      r := r || format('FAIL A9 escopo=%s%s', coalesce(v_rec.scope_level, 'nenhum'), E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A9 ' || sqlerrm || E'\n';
  end;

  -- A10: §58 — a prévia não grava nada
  begin
    v_code := 'SUITE13-' || substr(md5(random()::text), 1, 6);
    select count(*) into v_a from public.operation_brs where organization_id = v_org;
    v_json := public.create_operation_brs_batch(v_org, v_op, v_op_city, array[v_code], 'previa', true);
    select count(*) into v_b from public.operation_brs where organization_id = v_org;
    if v_a = v_b and (v_json ->> 'created')::int = 1 and (v_json ->> 'dry_run')::boolean then
      r := r || 'PASS A10 previa promete 1 e nao grava nada' || E'\n';
    else
      r := r || format('FAIL A10 antes=%s depois=%s previa=%s%s', v_a, v_b, v_json::text, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A10 ' || sqlerrm || E'\n';
  end;

  -- A11: a gravação entrega exatamente o que a prévia prometeu
  begin
    v_json2 := public.create_operation_brs_batch(v_org, v_op, v_op_city, array[v_code], 'gravacao', false);
    select count(*) into v_n
      from public.operation_brs
     where organization_id = v_org and operation_id = v_op
       and private.normalize_code(code) = private.normalize_code(v_code)
       and deleted_at is null;
    if (v_json2 ->> 'created')::int = (v_json ->> 'created')::int and v_n = 1 then
      r := r || 'PASS A11 gravacao entrega o numero da previa' || E'\n';
    else
      r := r || format('FAIL A11 previa=%s gravacao=%s banco=%s%s', v_json ->> 'created', v_json2 ->> 'created', v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A11 ' || sqlerrm || E'\n';
  end;

  -- A12: o mesmo código no mesmo local volta como "já cadastrado", não como erro
  begin
    v_json := public.create_operation_brs_batch(v_org, v_op, v_op_city, array[v_code], null, true);
    if (v_json ->> 'existing')::int = 1 and (v_json ->> 'created')::int = 0
       and v_json -> 'details' -> 0 ->> 'result' = 'exists' then
      r := r || 'PASS A12 codigo repetido no local e "ja cadastrado"' || E'\n';
    else
      r := r || format('FAIL A12 %s%s', v_json::text, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A12 ' || sqlerrm || E'\n';
  end;

  -- A13: repetido dentro do próprio lote é apontado antes de virar violação
  begin
    v_json := public.create_operation_brs_batch(v_org, v_op, v_op_city, array['SUITE13-DUP', 'SUITE13-DUP'], null, true);
    if (v_json ->> 'created')::int = 1 and (v_json ->> 'invalid')::int = 1
       and v_json -> 'details' -> 1 ->> 'result' = 'duplicated_in_batch' then
      r := r || 'PASS A13 codigo repetido no lote e apontado na previa' || E'\n';
    else
      r := r || format('FAIL A13 %s%s', v_json::text, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A13 ' || sqlerrm || E'\n';
  end;

  -- A14: cidade fora da cobertura da operação é recusada (§16)
  begin
    select oc.id into v_rec from public.operation_cities oc where oc.operation_id <> v_op limit 1;
    v_json := public.create_operation_brs_batch(v_org, v_op, v_rec.id, array['SUITE13-FORA'], null, true);
    r := r || 'FAIL A14 cidade de outra operacao foi aceita' || E'\n';
  exception when others then
    if sqlerrm like '%nao pertence%' or sqlerrm like '%não pertence à cobertura%' then
      r := r || 'PASS A14 cidade fora da cobertura e recusada' || E'\n';
    else
      r := r || 'FAIL A14 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A15: lote vazio é recusado com mensagem em português
  begin
    v_json := public.create_operation_brs_batch(v_org, v_op, v_op_city, array[]::text[], null, true);
    r := r || 'FAIL A15 lote vazio foi aceito' || E'\n';
  exception when others then
    if sqlerrm like '%ao menos um c%digo%' then
      r := r || 'PASS A15 lote vazio e recusado' || E'\n';
    else
      r := r || 'FAIL A15 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A16: §57 — origem fora da lista branca não entra
  begin
    select a.vehicle_id into v_veh from public.fidelization_assignments a
     where a.operation_br_id = v_br order by a.start_date desc limit 1;
    v_json := public.save_fidelization_assignment(v_org, jsonb_build_object(
      'operation_br_id', v_br2, 'vehicle_id', v_veh,
      'start_date', to_char(current_date + 400, 'YYYY-MM-DD'), 'source', 'planilha'));
    r := r || 'FAIL A16 origem inventada foi aceita' || E'\n';
  exception when others then
    if sqlerrm like '%Origem de aloca%' then
      r := r || 'PASS A16 origem fora da lista branca e recusada' || E'\n';
    else
      r := r || 'FAIL A16 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A17: §57 — um período encerrado aceita veículo hoje inativo; um aberto, não
  begin
    select v.id into v_veh from public.vehicles v
     where v.organization_id = v_org and v.deleted_at is null and v.status <> 'active' limit 1;
    if v_veh is null then
      r := r || 'SKIP A17 nenhum veiculo inativo no cadastro' || E'\n';
    else
      begin
        perform private.assert_vehicle_fidelizable(v_org, v_veh, v_op, current_date - 30);
        v_a := 1;
      exception when others then
        v_a := 0; v_code := sqlerrm;
      end;
      begin
        perform private.assert_vehicle_fidelizable(v_org, v_veh, v_op, null);
        v_b := 1;
      exception when others then
        v_b := 0;
      end;
      if v_a = 1 and v_b = 0 then
        r := r || 'PASS A17 veiculo inativo vale no passado e nao vale em aberto' || E'\n';
      else
        r := r || format('FAIL A17 passado=%s aberto=%s (%s)%s', v_a, v_b, coalesce(v_code, '-'), E'\n');
      end if;
    end if;
  exception when others then
    r := r || 'FAIL A17 ' || sqlerrm || E'\n';
  end;

  /* =====================================================================
     FASE B — chamador sem privilégio (§63)
     ===================================================================== */
  perform private.access_change_begin();
  delete from public.platform_admins where user_id = v_user;
  delete from public.role_permissions rp
   using public.permissions p, public.roles ro
   where rp.permission_id = p.id and ro.id = rp.role_id
     and ro.organization_id = v_org
     and p.code in ('fidelization.manage_brs', 'fidelization.import');
  perform set_config('hfm.access_change', 'off', true);

  -- B1: sem `fidelization.manage_brs` o multicadastro não abre
  begin
    v_json := public.create_operation_brs_batch(v_org, v_op, v_op_city, array['SUITE13-SEMPERM'], null, true);
    r := r || 'FAIL B1 cadastrou BR sem permissao' || E'\n';
  exception when others then
    if sqlerrm like '%permiss%o para cadastrar BRs%' then
      r := r || 'PASS B1 multicadastro exige fidelization.manage_brs' || E'\n';
    else
      r := r || 'FAIL B1 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- B2: sem `fidelization.import` ninguém carimba um vínculo como importado
  begin
    select a.vehicle_id into v_veh from public.fidelization_assignments a
     where a.operation_br_id = v_br order by a.start_date desc limit 1;
    v_json := public.save_fidelization_assignment(v_org, jsonb_build_object(
      'operation_br_id', v_br2, 'vehicle_id', v_veh,
      'start_date', to_char(current_date + 400, 'YYYY-MM-DD'), 'source', 'import'));
    r := r || 'FAIL B2 declarou origem import sem permissao' || E'\n';
  exception when others then
    if sqlerrm like '%permiss%o para importar aloca%' then
      r := r || 'PASS B2 origem import exige fidelization.import' || E'\n';
    else
      r := r || 'FAIL B2 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  raise exception 'ROLLBACK_TESTES %', E'\n' || r;
end $t$;
