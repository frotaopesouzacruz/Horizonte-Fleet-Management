-- =============================================================================
-- 09 · Filiais — endurecimento (20260922115000 / 116000 / 117000)
--
-- Suíte transacional para rodar contra um banco COM DADOS: ela não cria
-- organização, operação nem veículo, ela encontra os que existem. Por isso não
-- vive em `tests/database/`, que roda em banco local vazio via pgTAP — para
-- essas rotinas a pergunta interessante é o que acontece com os colaboradores e
-- os veículos que existem de verdade — na organização atual, 143 colaboradores,
-- 137 deles na filial mais populosa —, não com dois registros sintéticos.
--
-- COMO RODAR: cole o arquivo inteiro num SQL editor conectado ao banco.
-- Ele termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: é assim
-- que devolve o resultado e desfaz tudo o que fez. Um erro com esse texto é o
-- sucesso; qualquer outro erro é a suíte tendo abortado antes da hora.
--
-- O que cada bloco protege:
--   A1–A2, B0–B4  os indicadores não atravessam o eixo de operação (§64)
--   A3–A5, A11    transferência vale a partir de hoje, e o histórico acompanha
--   A6–A8         escrever a coluna direto continua gerando vigência (§34/§51)
--   A9–A10        o código duplicado volta a dar a mensagem em português
--
-- A Fase B simula um chamador escopado retirando, DENTRO da transação,
-- `operations.access_all` e o vínculo de administrador de plataforma. Ela abre
-- o mesmo portão que as rotinas oficiais de administração de acesso abrem
-- (`private.access_change_begin`), porque o gatilho da Etapa 05 — corretamente
-- — não deixa ninguém mexer na matriz de acesso por fora. Nada disso é
-- persistido.
--
-- Última execução: 16/16 PASS contra o projeto de desenvolvimento.
-- =============================================================================
do $t$
declare
  v_org        uuid;
  v_user       uuid;
  v_membership uuid;
  v_unit       uuid;
  v_scope_op   uuid;
  v_other_op   uuid;
  v_veh        uuid;
  v_veh_unit   uuid;
  v_prev_unit  uuid;
  v_other_unit uuid;
  r            text := '';
  v_json       jsonb;
  v_a          bigint;
  v_b          bigint;
  v_n          bigint;
  v_txt        text;
  v_date       date;
  v_scoped     boolean := false;
begin
  ---------------------------------------------------------------- fixtures
  -- Nada é fixo: a suíte encontra a organização, as filiais e o veículo que o
  -- banco tiver, e falha alto se não houver base para o que ela testa.
  select o.id into v_org
    from public.organizations o
   where o.deleted_at is null and o.status = 'active'
   order by o.created_at
   limit 1;

  select m.user_id, m.id into v_user, v_membership
    from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active'
   limit 1;

  -- A filial com mais gente, porque é onde um vazamento de escopo aparece.
  select u.id into v_unit
    from public.organization_units u
    left join public.employee_assignments a
      on a.organization_unit_id = u.id and a.is_current
   where u.organization_id = v_org and u.deleted_at is null and u.status = 'active'
   group by u.id
   order by count(distinct a.employee_id) desc
   limit 1;

  select u.id into v_other_unit
    from public.organization_units u
   where u.organization_id = v_org and u.deleted_at is null and u.status = 'active'
     and u.id <> v_unit
   limit 1;

  select a.operation_id into v_scope_op
    from public.employee_assignments a
   where a.organization_unit_id = v_unit and a.is_current and a.operation_id is not null
   group by a.operation_id order by count(*) desc limit 1;

  select a.operation_id into v_other_op
    from public.employee_assignments a
   where a.organization_unit_id = v_unit and a.is_current and a.operation_id is not null
     and a.operation_id <> v_scope_op
   group by a.operation_id order by count(*) desc limit 1;

  if v_user is null or v_unit is null or v_other_unit is null
     or v_scope_op is null or v_other_op is null then
    raise exception 'FIXTURE incompleta: user=% unit=% unit2=% op1=% op2=%',
      v_user, v_unit, v_other_unit, v_scope_op, v_other_op;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Veículo + filial compatíveis (§35). Se o vínculo filial × operação ainda
  -- não existe, ele é criado aqui como fixture — e a transação o desfaz.
  select va.vehicle_id, uo.organization_unit_id into v_veh, v_veh_unit
    from public.vehicle_operation_assignments va
    join public.organization_unit_operations uo
      on uo.operation_id = va.operation_id
     and uo.effective_from <= current_date
     and (uo.effective_to is null or uo.effective_to >= current_date)
    join public.vehicles v on v.id = va.vehicle_id
   where (va.effective_to is null or va.effective_to >= current_date)
     and v.deleted_at is null and v.status = 'active'
     and v.organization_unit_id is distinct from uo.organization_unit_id
   limit 1;

  if v_veh is null then
    select v.id into v_veh
      from public.vehicles v
      join public.vehicle_operation_assignments va on va.vehicle_id = v.id
       and (va.effective_to is null or va.effective_to >= current_date)
     where v.deleted_at is null and v.status = 'active'
       and v.organization_unit_id is null
     limit 1;
    if v_veh is null then
      raise exception 'FIXTURE: nenhum veículo ativo com operação vigente.';
    end if;
    v_veh_unit := v_unit;
    insert into public.organization_unit_operations
      (organization_id, organization_unit_id, operation_id, effective_from)
    select v_org, v_unit, va.operation_id, current_date - 1
      from public.vehicle_operation_assignments va
     where va.vehicle_id = v_veh
       and (va.effective_to is null or va.effective_to >= current_date)
    on conflict do nothing;
  end if;

  /* =====================================================================
     FASE A — chamador com acesso total (administrador de plataforma)
     ===================================================================== */

  -- A1: branch_impact continua contando tudo para quem alcança tudo
  begin
    v_json := public.branch_impact(v_unit);
    select count(distinct a.employee_id) into v_a
      from public.employee_assignments a
      join public.employees e on e.id = a.employee_id
     where a.organization_unit_id = v_unit and a.is_current
       and e.deleted_at is null and e.employment_status = 'active';
    if (v_json ->> 'active_employees')::bigint = v_a and v_a > 0 then
      r := r || format('PASS A1 acesso total conta tudo (%s colaboradores ativos)%s', v_a, E'\n');
    else
      r := r || format('FAIL A1 esperado %s, veio %s%s', v_a, v_json ->> 'active_employees', E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A1 ' || sqlerrm || E'\n';
  end;

  -- A2: operação inexistente nesta organização não vira contagem nem zero
  begin
    v_json := public.branch_operation_impact(v_unit, gen_random_uuid());
    r := r || 'FAIL A2 operação inexistente foi aceita' || E'\n';
  exception when others then
    if sqlerrm like '%não encontrada nesta organização%' then
      r := r || 'PASS A2 operação de fora da organização é recusada' || E'\n';
    else
      r := r || 'FAIL A2 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A3: transferência agendada é recusada
  begin
    v_json := public.transfer_vehicle_branch(v_veh, v_veh_unit, current_date + 30, 'teste de agendamento');
    r := r || 'FAIL A3 transferência futura foi aceita' || E'\n';
  exception when others then
    if sqlerrm like '%vale a partir de hoje%' then
      r := r || 'PASS A3 transferência com data futura é recusada' || E'\n';
    else
      r := r || 'FAIL A3 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A4: transferência de hoje move a coluna e deixa UMA linha aberta
  begin
    select organization_unit_id into v_prev_unit from public.vehicles where id = v_veh;
    v_json := public.transfer_vehicle_branch(v_veh, v_veh_unit, current_date, 'teste de transferência');

    select count(*) into v_n
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null;
    select count(*) into v_b
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null
       and organization_unit_id = v_veh_unit;

    if (select organization_unit_id from public.vehicles where id = v_veh) = v_veh_unit
       and v_n = 1 and v_b = 1 then
      r := r || 'PASS A4 transferência de hoje sincroniza coluna e histórico (1 linha aberta)' || E'\n';
    else
      r := r || format('FAIL A4 linhas abertas=%s na filial nova=%s%s', v_n, v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A4 ' || sqlerrm || E'\n';
  end;

  -- A5: o gatilho não duplicou a linha que a RPC já havia aberto
  begin
    select count(*) into v_n
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and organization_unit_id = v_veh_unit
       and effective_from = current_date;
    if v_n = 1 then
      r := r || 'PASS A5 gatilho reconhece a linha da RPC e não duplica' || E'\n';
    else
      r := r || format('FAIL A5 %s linhas para hoje na mesma filial%s', v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A5 ' || sqlerrm || E'\n';
  end;

  -- A6: escrever a coluna direto (o que save_vehicle faz) cria histórico
  begin
    select count(*) into v_a from public.vehicle_unit_assignments where vehicle_id = v_veh;
    update public.vehicles set organization_unit_id = v_other_unit where id = v_veh;
    select count(*) into v_b
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null and organization_unit_id = v_other_unit;
    select count(*) into v_n
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null;
    if v_b = 1 and v_n = 1 then
      r := r || 'PASS A6 escrita direta na coluna gera vínculo (sem linha órfã)' || E'\n';
    else
      r := r || format('FAIL A6 abertas=%s na filial nova=%s%s', v_n, v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A6 ' || sqlerrm || E'\n';
  end;

  -- A7: contadores deixam de se contradizer
  begin
    v_json := public.branch_impact(v_other_unit);
    if (v_json ->> 'total_vehicles')::bigint >= (v_json ->> 'active_vehicles')::bigint then
      r := r || format('PASS A7 total_vehicles (%s) >= active_vehicles (%s)%s',
                       v_json ->> 'total_vehicles', v_json ->> 'active_vehicles', E'\n');
    else
      r := r || format('FAIL A7 total=%s < ativo=%s%s',
                       v_json ->> 'total_vehicles', v_json ->> 'active_vehicles', E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A7 ' || sqlerrm || E'\n';
  end;

  -- A8: limpar a filial encerra o vínculo em vez de deixá-lo aberto
  begin
    update public.vehicles set organization_unit_id = null where id = v_veh;
    select count(*) into v_n
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null;
    if v_n = 0 then
      r := r || 'PASS A8 remover a filial encerra o vínculo aberto' || E'\n';
    else
      r := r || format('FAIL A8 %s vínculos continuam abertos%s', v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A8 ' || sqlerrm || E'\n';
  end;

  -- A9: código interno duplicado reporta o índice que a aplicação procura
  begin
    insert into public.organization_units (organization_id, code, name, unit_type, status)
    values (v_org, '87', 'Filial de teste (colisão)', 'branch', 'active');
    r := r || 'FAIL A9 código duplicado foi aceito' || E'\n';
  exception when others then
    if sqlerrm like '%organization_units_code_key%' then
      r := r || 'PASS A9 duplicidade de código reporta organization_units_code_key' || E'\n';
    else
      r := r || 'FAIL A9 mensagem inesperada: ' || sqlerrm || E'\n';
    end if;
  end;

  -- A10: os índices duplicados sumiram e os corretos ficaram
  begin
    select count(*) into v_a from pg_indexes
     where schemaname = 'public' and tablename = 'organization_units'
       and indexname in ('organization_units_status_idx', 'organization_units_org_code_key');
    select count(*) into v_b from pg_indexes
     where schemaname = 'public' and tablename = 'organization_units'
       and indexname in ('organization_units_code_key', 'organization_units_org_active_idx');
    if v_a = 0 and v_b = 2 then
      r := r || 'PASS A10 índices duplicados removidos, regra preservada' || E'\n';
    else
      r := r || format('FAIL A10 duplicados=%s corretos=%s%s', v_a, v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A10 ' || sqlerrm || E'\n';
  end;

  /* =====================================================================
     FASE B — o mesmo chamador, agora escopado a UMA operação.
     A transação desfaz as três alterações de privilégio no final.
     ===================================================================== */
  -- A11: tirar e repor a filial no mesmo dia (o que alguém faz ao corrigir um
  -- engano antes de salvar). Também é a fixture da Fase B: devolver 0 só prova
  -- alguma coisa se houver o que contar.
  begin
    update public.vehicles set organization_unit_id = v_unit where id = v_veh;
    select count(*) into v_n
      from public.vehicle_unit_assignments
     where vehicle_id = v_veh and effective_to is null
       and organization_unit_id = v_unit;
    if v_n = 1 then
      r := r || 'PASS A11 limpar e reatribuir a filial no mesmo dia não quebra' || E'\n';
    else
      r := r || format('FAIL A11 %s vínculos abertos na filial%s', v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL A11 ' || sqlerrm || E'\n';
  end;

  if (select organization_unit_id from public.vehicles where id = v_veh) is distinct from v_unit then
    update public.vehicles set organization_unit_id = v_unit where id = v_veh;
  end if;

  -- A matriz de acesso é protegida pelo gatilho de Etapa 05: só se mexe nela
  -- com o portão que as rotinas oficiais de administração de acesso abrem. O
  -- teste abre o mesmo portão, pela mesma função — e a transação fecha tudo.
  --
  -- O escopo não é preenchido porque `tg_operation_scope_guard` impede que uma
  -- conta mude o próprio escopo, e ela tem razão. Tirar `operations.access_all`
  -- e o vínculo de administrador de plataforma deixa o escopo VAZIO, que prova
  -- a mesma coisa de forma ainda mais direta: o indicador que antes devolvia a
  -- filial inteira passa a devolver o que este chamador alcança — nada.
  begin
    perform private.access_change_begin();
    delete from public.platform_admins where user_id = v_user;
    delete from public.role_permissions rp
     using public.permissions p
     where rp.permission_id = p.id
       and p.code = 'operations.access_all'
       and rp.role_id in (select mr.role_id from public.membership_roles mr
                           where mr.membership_id = v_membership);
    v_scoped := true;
  exception when others then
    r := r || 'FAIL Fase B não pôde ser montada: ' || sqlerrm || E'\n';
  end;

  if not v_scoped then
    raise exception E'ROLLBACK_TESTES\n%', r;
  end if;

  -- B0: a simulação é real — o chamador perdeu o acesso irrestrito
  begin
    select count(*) into v_n from private.accessible_operation_ids();
    if v_n = 0 then
      r := r || 'PASS B0 chamador sem escopo não alcança operação nenhuma' || E'\n';
    else
      r := r || format('FAIL B0 ainda alcança %s operações (simulação não valeu)%s', v_n, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL B0 ' || sqlerrm || E'\n';
  end;

  -- B1: o indicador para no escopo em vez de devolver a filial inteira (§64)
  begin
    v_json := public.branch_impact(v_unit);
    select count(distinct a.employee_id) into v_b
      from public.employee_assignments a
      join public.employees e on e.id = a.employee_id
     where a.organization_unit_id = v_unit and a.is_current
       and e.deleted_at is null and e.employment_status = 'active';
    if (v_json ->> 'active_employees')::bigint = 0 and v_b > 0 then
      r := r || format('PASS B1 indicador devolve 0 onde a filial tem %s colaboradores%s', v_b, E'\n');
    else
      r := r || format('FAIL B1 vazou %s de %s colaboradores%s',
                       v_json ->> 'active_employees', v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL B1 ' || sqlerrm || E'\n';
  end;

  -- B2: a frota também para no escopo
  begin
    v_json := public.branch_impact(v_unit);
    select count(distinct v.id) into v_b
      from public.vehicles v
     where v.organization_unit_id = v_unit and v.deleted_at is null and v.status = 'active';
    if v_b = 0 then
      r := r || 'FAIL B2 fixture vazia: a filial não tem frota, o 0 não provaria nada' || E'\n';
    elsif (v_json ->> 'active_vehicles')::bigint = 0 then
      r := r || format('PASS B2 frota escopada devolve 0 onde a filial tem %s%s', v_b, E'\n');
    else
      r := r || format('FAIL B2 vazou %s de %s veículos%s',
                       v_json ->> 'active_vehicles', v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL B2 ' || sqlerrm || E'\n';
  end;

  -- B3: o oráculo por operação fechou
  begin
    v_json := public.branch_operation_impact(v_unit, v_other_op);
    r := r || format('FAIL B3 contou operação fora do escopo: %s%s', v_json, E'\n');
  exception when others then
    if sqlerrm like '%não faz parte do seu escopo%' then
      r := r || 'PASS B3 operação fora do escopo é recusada' || E'\n';
    else
      r := r || 'FAIL B3 erro inesperado: ' || sqlerrm || E'\n';
    end if;
  end;

  -- B4: o eixo de permissão continua atravessado — quem tem branches.view vê
  -- o tamanho da estrutura da filial sem precisar de cost_centers.view
  begin
    v_json := public.branch_impact(v_unit);
    select count(*) into v_b
      from public.organization_unit_operations o
     where o.organization_unit_id = v_unit;
    if (v_json ->> 'historical_operations')::bigint = v_b and v_b > 0 then
      r := r || format('PASS B4 estrutura da filial segue visível (%s vínculos de operação)%s',
                       v_b, E'\n');
    else
      r := r || format('FAIL B4 veio %s, esperado %s%s',
                       v_json ->> 'historical_operations', v_b, E'\n');
    end if;
  exception when others then
    r := r || 'FAIL B4 ' || sqlerrm || E'\n';
  end;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
