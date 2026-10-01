-- =============================================================================
-- 25 · Gestão de Checklist › Planos de Ação — Plano de Ação de Manutenção
--      testes obrigatórios 91–103 (migrations 20261002100000 … 20261002103000)
--
-- Suíte transacional: usa a organização, a versão publicada do Check List, os
-- veículos e o catálogo de serviços reais. Tudo o que ela cria — operação de
-- teste, colaborador (se não houver), execuções e respostas de checklist,
-- mapeamento de serviços, planos, manutenções, uma segunda organização e os
-- perfis simulados — existe só dentro da transação: o bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, e nada persiste.
--
-- Rodar com o arquivo inteiro numa única transação (psql -1 -f, ou um único
-- comando no SQL Editor). Os gatilhos adiados (recálculo no fim da transação)
-- são disparados com SET CONSTRAINTS ALL IMMEDIATE depois de cada operação de
-- manutenção — o mesmo efeito do COMMIT real.
--
--   T91  Avaria: "Possui alguma avaria?" = SIM → NÃO entra no Plano de Ação de
--        Manutenção; vai para o fluxo de Avarias (evento, uma vez)
--   T92  Freio: freios de serviço = NÃO → apontamento + plano (prioridade e prazo)
--   T93  Detalhe: faróis = NÃO + farol esquerdo → 1 problema lógico (sem
--        duplicar gatilho + detalhe); multisseleção → um plano por opção
--   T94  Recorrência: 3 checklists do mesmo problema → 1 plano, 3 apontamentos
--   T95  Abertura de manutenção pelo plano: veículo, contexto, serviço, origem
--        Plano de ação, plano e apontamentos
--   T96  Manutenção existente compatível: candidata (alta), vínculo, sem duplicar
--   T97  Resolução parcial: 3 apontamentos, manutenção resolve 2 → plano aberto
--   T98  Improcedente: exige motivo e justificativa; resposta original intacta
--   T99  Resolvido sem manutenção: nenhuma manutenção criada; plano encerrado
--   T100 Status: sem plano encerrado com pendência; fechamento automático
--   T101 Histórico: contexto congelado; troca da alocação não move o plano
--   T102 Idempotência: reprocessar não duplica apontamento, plano nem evento
--   T103 Segurança: Administrador, Gestor de Frota, Liderança, Operacional,
--        sem acesso e outro tenant
--   (+)  Correção do checklist reclassifica; Aderência não é afetada.
-- =============================================================================

create or replace function pg_temp.s25_exec(
  p_org uuid, p_app uuid, p_ver uuid, p_user uuid, p_emp uuid, p_vehicle uuid, p_op uuid, p_date date, p_answers jsonb)
returns uuid
language plpgsql
as $$
declare
  v_exec uuid;
  v_a    jsonb;
  v_q    record;
  v_nc   integer := 0;
begin
  insert into public.checklist_executions (organization_id, app_id, version_id, user_id, employee_id, vehicle_id,
    license_plate_snapshot, operation_id, checklist_type, operational_date, status, idempotency_key)
  values (p_org, p_app, p_ver, p_user, p_emp, p_vehicle,
          (select license_plate from public.vehicles where id = p_vehicle), p_op, 'saida', p_date, 'draft',
          'suite25-' || gen_random_uuid())
  returning id into v_exec;
  for v_a in select * from jsonb_array_elements(p_answers) loop
    select q.id, q.question_key, q.question_text, q.criticality, q.conforming_answer, cl.cluster_key into v_q
      from public.checklist_questions q join public.checklist_clusters cl on cl.id = q.cluster_id
     where q.version_id = p_ver and q.question_key = v_a ->> 'q';
    insert into public.checklist_execution_answers (organization_id, execution_id, version_id, question_id, question_key,
      cluster_key, question_text_snapshot, answer, is_conforming, criticality, conditional_value, note)
    values (p_org, v_exec, p_ver, v_q.id, v_q.question_key, v_q.cluster_key, v_q.question_text, v_a ->> 'a',
            (v_a ->> 'a') = v_q.conforming_answer, v_q.criticality, v_a -> 'cv', v_a ->> 'note');
    if (v_a ->> 'a') <> v_q.conforming_answer then v_nc := v_nc + 1; end if;
  end loop;
  update public.checklist_executions
     set status = 'submitted', submitted_at = (p_date + time '07:30') at time zone 'America/Sao_Paulo',
         duration_seconds = 180, non_conforming_answers = v_nc
   where id = v_exec;
  -- O evento oficial, como o submit grava: dispara a Aderência e o Plano de Ação.
  insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_org, 'checklist.execution.submitted', 'checklist_execution', v_exec,
          jsonb_build_object('execution_id', v_exec, 'vehicle_id', p_vehicle, 'operational_date', p_date));
  return v_exec;
end;
$$;

create or replace function pg_temp.s25_flush()
returns void
language plpgsql
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_admin_role uuid; v_today date; v_app uuid; v_ver uuid; v_emp uuid; v_op uuid; v_op2 uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  s1 uuid; s2 uuid; s3 uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; p5 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; m1 uuid; m2 uuid; v_org2 uuid;
  j jsonb; k jsonb; n int; n2 int; n3 int; txt text; ok boolean; ok2 boolean; ok3 boolean; v_items jsonb; v_it record;
  v_ids jsonb; v_x record; v_sub record;
  r text := '';
begin
  -- ---------------------------------------------------------------- setup --
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' order by m.created_at limit 1;
  select mr.role_id into v_admin_role from public.membership_roles mr where mr.membership_id = v_mem limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_today := private.maintenance_today(v_org);
  select v.id, v.app_id into v_ver, v_app from public.checklist_app_versions v
   where v.organization_id = v_org and v.status = 'published' order by v.published_at desc limit 1;
  select e.id into v_emp from public.employees e where e.organization_id = v_org and e.deleted_at is null order by e.created_at limit 1;
  if v_emp is null then
    insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S25-001', 'Suite25 Motorista')
    returning id into v_emp;
  end if;
  insert into public.operations (organization_id, name, code) values (v_org, 'Suite25 Operação A', 'S25-OPA') returning id into v_op;
  insert into public.operations (organization_id, name, code) values (v_org, 'Suite25 Operação B', 'S25-OPB') returning id into v_op2;
  -- Veículos ativos sem manutenção aberta (a duplicidade é testada à parte).
  select jsonb_agg(id) into v_ids from (
    select v.id from public.vehicles v
     where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null
       and not exists (select 1 from public.maintenances m where m.vehicle_id = v.id and m.status in ('to_schedule', 'scheduled', 'in_progress'))
       and not exists (select 1 from public.action_plans p where p.vehicle_id = v.id)
     order by v.license_plate limit 4) x;
  v_a := (v_ids ->> 0)::uuid; v_b := (v_ids ->> 1)::uuid; v_c := (v_ids ->> 2)::uuid; v_d := (v_ids ->> 3)::uuid;
  -- Serviços reais do catálogo, corretivos e aplicáveis aos tipos dos veículos
  -- escolhidos: s1 e s2 do mesmo cluster, s3 de outro.
  create temporary table s25_services on commit drop as
    select s.id, s.cluster_id, s.name from public.maintenance_services s
     where s.organization_id = v_org and s.deleted_at is null and s.status = 'active'
       and (s.maintenance_type_codes is null or cardinality(s.maintenance_type_codes) = 0 or 'corrective' = any (s.maintenance_type_codes))
       and (s.vehicle_type_ids is null or cardinality(s.vehicle_type_ids) = 0
            or (select bool_and(v.vehicle_type_id = any (s.vehicle_type_ids)) from public.vehicles v
                 where v.id in (v_a, v_b, v_c, v_d)));
  select s.id, (select x.id from s25_services x where x.cluster_id = s.cluster_id and x.id <> s.id order by x.name limit 1)
    into s1, s2
    from s25_services s
   where (select count(*) from s25_services x where x.cluster_id = s.cluster_id) >= 2
   order by s.name limit 1;
  select s.id into s3 from s25_services s where s.cluster_id <> (select cluster_id from s25_services where id = s1)
   order by s.name limit 1;
  -- Administrador de plataforma (ambiente local): a guarda de escopo exige
  -- para trocar o próprio escopo na simulação de perfis (T103).
  if not exists (select 1 from public.platform_admins where user_id = v_user and revoked_at is null) then
    perform set_config('hfm.access_change', 'on', true);
    insert into public.platform_admins (user_id, note) values (v_user, 'Suite25 (transação de teste)');
    perform set_config('hfm.access_change', '', true);
  end if;
  -- Mapeamento oficial Pergunta × Serviço (o mesmo da Manutenção).
  perform public.action_plan_save_question_services(v_org, jsonb_build_object('app_id', v_app,
    'question_key', 'mecanica.freios_servico', 'services', jsonb_build_array(jsonb_build_object('service_id', s1, 'auto_resolve', true))));
  perform public.action_plan_save_question_services(v_org, jsonb_build_object('app_id', v_app,
    'question_key', 'luzes.farois', 'field_key', 'itens_falha',
    'services', jsonb_build_array(jsonb_build_object('service_id', s2, 'auto_resolve', true))));
  r := r || format('setup: veículos=%s, serviços=%s/%s/%s, versão=%s%s', jsonb_array_length(v_ids), s1 is not null, s2 is not null, s3 is not null,
                   (select label from public.checklist_app_versions where id = v_ver), chr(10));

  -- ---------------------------------------------------------------- T91 --
  begin
    e1 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_a, v_op, v_today - 6, jsonb_build_array(
            jsonb_build_object('q', 'funilaria.avaria', 'a', 'yes', 'cv', jsonb_build_object('descricao_avaria', 'Amassado na porta lateral')),
            jsonb_build_object('q', 'mecanica.freios_servico', 'a', 'no', 'note', 'Pedal baixo')));
    select count(*) into n from public.action_plan_items i
      join public.checklist_execution_answers a on a.id = i.checklist_answer_id
     where a.execution_id = e1 and a.question_key = 'funilaria.avaria';
    select count(*) into n2 from public.action_plans p where p.vehicle_id = v_a and p.question_key like 'funilaria.%';
    select count(*) into n3 from public.outbox_events x
     where x.event_type = 'checklist.damage.reported' and x.payload ->> 'execution_id' = e1::text;
    select private.action_plan_answer_route(a.id) into txt from public.checklist_execution_answers a
     where a.execution_id = e1 and a.question_key = 'funilaria.avaria';
    -- texto da pergunta trocado: a identidade continua (chave estável)
    ok := (select action_domain from public.checklist_action_parameters
            where organization_id = v_org and app_id = v_app and question_key = 'funilaria.avaria' and field_key is null) = 'damage'
          and (select action_domain from public.checklist_action_parameters
                where organization_id = v_org and app_id = v_app and question_key = 'funilaria.avaria' and field_key = 'descricao_avaria') = 'damage';
    r := r || format('%s T91 avaria: apontamentos=%s, planos de avaria=%s, rota=%s, evento de avaria=%s, parâmetros DAMAGE (pergunta e relato)=%s%s',
      case when n = 0 and n2 = 0 and txt = 'damage' and n3 = 1 and ok then 'PASS' else 'FAIL' end, n, n2, txt, n3, ok, chr(10));
  exception when others then r := r || 'FAIL T91 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T92 --
  begin
    select p.id into p1 from public.action_plans p where p.vehicle_id = v_a and p.plan_key = 'q:mecanica.freios_servico';
    select p.status = 'new' and p.priority = 'critical' and p.due_on = (v_today - 6) + 1 and p.occurrences = 1 and p.open_items = 1
           and p.operation_id = v_op and p.first_execution_id = e1 and p.code like 'PA-%'
      into ok from public.action_plans p where p.id = p1;
    select count(*) into n from public.action_plan_items i where i.plan_id = p1 and i.note = 'Pedal baixo' and i.status = 'pending';
    r := r || format('%s T92 freio: plano %s criado (novo, prioridade crítica, prazo SLA, contexto e checklist de origem)=%s, apontamento com relato=%s%s',
      case when p1 is not null and ok and n = 1 then 'PASS' else 'FAIL' end,
      (select code from public.action_plans where id = p1), ok, n, chr(10));
  exception when others then r := r || 'FAIL T92 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T93 --
  begin
    e2 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_b, v_op, v_today - 5, jsonb_build_array(
            jsonb_build_object('q', 'luzes.farois', 'a', 'no', 'cv', jsonb_build_object('itens_falha', jsonb_build_array('farol_esquerdo')))));
    select count(*) into n from public.action_plans p where p.vehicle_id = v_b and p.question_key = 'luzes.farois';
    select p.plan_key, p.title || ' — ' || p.detail_label as title into v_x from public.action_plans p where p.vehicle_id = v_b and p.question_key = 'luzes.farois';
    ok := n = 1 and v_x.plan_key = 'q:luzes.farois:itens_falha=farol_esquerdo';
    txt := format('1 problema lógico=%s (%s); ', ok, v_x.title);
    -- multisseleção: esquerdo + direito → dois planos, um apontamento cada; gatilho sem plano próprio
    e3 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_c, v_op, v_today - 5, jsonb_build_array(
            jsonb_build_object('q', 'luzes.farois', 'a', 'no', 'cv', jsonb_build_object('itens_falha', jsonb_build_array('farol_esquerdo', 'farol_direito')))));
    select count(*), count(*) filter (where p.plan_key = 'q:luzes.farois') into n2, n3
      from public.action_plans p where p.vehicle_id = v_c and p.question_key = 'luzes.farois';
    select count(*) into n from public.action_plan_items i
      join public.checklist_execution_answers a on a.id = i.checklist_answer_id where a.execution_id = e3;
    ok2 := n2 = 2 and n3 = 0 and n = 2;
    txt := txt || format('multisseleção: planos=%s, plano do gatilho=%s, apontamentos=%s', n2, n3, n);
    r := r || format('%s T93 gatilho × detalhe: %s%s', case when ok and ok2 then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL T93 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T94 --
  begin
    e4 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_a, v_op, v_today - 4, jsonb_build_array(
            jsonb_build_object('q', 'mecanica.freios_servico', 'a', 'no')));
    e5 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_a, v_op, v_today - 3, jsonb_build_array(
            jsonb_build_object('q', 'mecanica.freios_servico', 'a', 'no')));
    select count(*) into n from public.action_plans p where p.vehicle_id = v_a and p.plan_key = 'q:mecanica.freios_servico';
    select count(*) into n2 from public.action_plan_items i where i.plan_id = p1;
    select occurrences into n3 from public.action_plans where id = p1;
    r := r || format('%s T94 recorrência: planos=%s, apontamentos=%s, ocorrências no plano=%s, 1º→último=%s→%s%s',
      case when n = 1 and n2 = 3 and n3 = 3 then 'PASS' else 'FAIL' end, n, n2, n3,
      (select first_operational_date from public.action_plans where id = p1), (select last_operational_date from public.action_plans where id = p1), chr(10));
  exception when others then r := r || 'FAIL T94 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T95 --
  -- (e T97) Abre manutenção pelo plano com 2 dos 3 apontamentos.
  begin
    select jsonb_agg(i.id order by i.operational_date) into v_items from (
      select i.id, i.operational_date from public.action_plan_items i where i.plan_id = p1 order by i.operational_date limit 2) i;
    j := public.action_plan_open_maintenance(p1, jsonb_build_object('vehicle_id', v_a, 'maintenance_type_code', 'corrective',
           'service_ids', jsonb_build_array(s1), 'requested_on', v_today - 2, 'priority', 'high', 'item_ids', v_items,
           'duplicate_justification', 'Suite25: abertura pelo plano de ação'));
    m1 := (j ->> 'id')::uuid;
    perform pg_temp.s25_flush();
    select m.vehicle_id = v_a and (select o.code from public.maintenance_origins o where o.id = m.origin_id) = 'action_plan'
           and exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = s1
                         and i.cluster_id = (select cluster_id from public.maintenance_services where id = s1))
           and (select count(*) from public.maintenance_finding_links f where f.maintenance_id = m.id) = 2
      into ok from public.maintenances m where m.id = m1;
    select count(*) into n from public.action_plan_maintenance_links l
     where l.plan_id = p1 and l.maintenance_id = m1 and l.status = 'active' and l.origin = 'opened_from_plan' and l.resolutive;
    select status into txt from public.action_plans where id = p1;
    select count(*) filter (where status = 'in_maintenance'), count(*) filter (where status = 'pending') into n2, n3
      from public.action_plan_items where plan_id = p1;
    r := r || format('%s T95 abertura pelo plano: %s (veículo, origem Plano de ação, serviço e cluster, 2 apontamentos na manutenção)=%s, vínculo opened_from_plan=%s, plano=%s, apontamentos em manutenção=%s/pendente=%s%s',
      case when ok and n = 1 and txt = 'maintenance_open' and n2 = 2 and n3 = 1 then 'PASS' else 'FAIL' end,
      j ->> 'code', ok, n, txt, n2, n3, chr(10));
  exception when others then r := r || 'FAIL T95 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T97 --
  begin
    perform public.maintenance_start(m1, jsonb_build_object('entry_date', v_today - 1, 'entry_time', '08:00'));
    perform pg_temp.s25_flush();
    select status into txt from public.action_plans where id = p1;
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = m1 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(m1, jsonb_build_object('exit_date', v_today, 'exit_time', '17:00', 'items', v_items));
    perform pg_temp.s25_flush();
    select count(*) filter (where status = 'resolved' and status_source = 'maintenance'), count(*) filter (where status = 'pending')
      into n, n2 from public.action_plan_items where plan_id = p1;
    select count(*) into n3 from public.action_plan_item_resolutions r2
     where r2.plan_id = p1 and r2.resolution_type = 'resolved_by_maintenance' and r2.maintenance_id = m1 and r2.source = 'maintenance_auto';
    -- sem passar por "pendente de nova tratativa" no meio (recálculo adiado)
    select count(*) into v_x from public.action_plan_item_resolutions r2 where r2.plan_id = p1 and r2.to_status = 'needs_action';
    r := r || format('%s T97 resolução parcial: em execução=%s; após concluir resolvidos=%s, pendente=%s, baixas automáticas=%s, plano=%s (aberto), passagens por nova tratativa=%s%s',
      case when txt = 'maintenance_in_progress' and n = 2 and n2 = 1 and n3 = 2 and v_x.count = 0
                and not private.action_plan_terminal((select status from public.action_plans where id = p1))
                and (select open_items from public.action_plans where id = p1) = 1 then 'PASS' else 'FAIL' end,
      txt, n, n2, n3, (select status from public.action_plans where id = p1), v_x.count, chr(10));
  exception when others then r := r || 'FAIL T97 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T96 --
  begin
    -- Manutenção aberta, compatível (serviço mapeado aos faróis), já existente no veículo B.
    j := public.maintenance_create(v_org, jsonb_build_object('vehicle_id', v_b, 'maintenance_type_code', 'corrective',
           'origin_code', 'operation', 'service_ids', jsonb_build_array(s2), 'requested_on', v_today - 1,
           'duplicate_justification', 'Suite25: manutenção prévia'));
    m2 := (j ->> 'id')::uuid;
    select p.id into p2 from public.action_plans p where p.vehicle_id = v_b and p.question_key = 'luzes.farois';
    select count(*) into n from public.maintenances where vehicle_id = v_b;
    k := public.action_plan_maintenance_candidates(p2);
    select c ->> 'confidence' as confidence, c ->> 'rule' as rule into v_x from jsonb_array_elements(k) c where (c ->> 'maintenance_id')::uuid = m2;
    perform public.action_plan_link_maintenance(p2, m2, '{"reason":"Suite25 vínculo"}'::jsonb);
    perform pg_temp.s25_flush();
    select count(*) into n2 from public.maintenances where vehicle_id = v_b;
    select status into txt from public.action_plans where id = p2;
    r := r || format('%s T96 manutenção existente: candidata=%s (%s), vinculada; manutenções do veículo antes/depois=%s/%s; plano=%s%s',
      case when v_x.confidence = 'high' and v_x.rule = 'service_mapping_specific' and n = n2 and txt = 'maintenance_open' then 'PASS' else 'FAIL' end,
      v_x.confidence, v_x.rule, n, n2, txt, chr(10));
  exception when others then r := r || 'FAIL T96 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T98 --
  begin
    select p.id into p3 from public.action_plans p where p.vehicle_id = v_c and p.plan_key = 'q:luzes.farois:itens_falha=farol_direito';
    ok2 := false;
    begin
      perform public.action_plan_resolve_items(p3, '{"resolution":"improper","reason_code":"falha_nao_confirmada","reason":"curto"}'::jsonb);
    exception when invalid_parameter_value then ok2 := true;
    end;
    perform public.action_plan_resolve_items(p3, jsonb_build_object('resolution', 'improper', 'reason_code', 'falha_nao_confirmada',
      'reason', 'Farol testado na base: acende normalmente, apontamento não procede.'));
    select a.answer = 'no' and not a.is_conforming and a.conditional_value -> 'itens_falha' ? 'farol_direito'
      into ok from public.checklist_execution_answers a where a.execution_id = e3 and a.question_key = 'luzes.farois';
    select status into txt from public.action_plans where id = p3;
    select count(*) into n from public.action_plan_item_resolutions where plan_id = p3 and resolution_type = 'improper'
       and reason_code = 'falha_nao_confirmada' and resolved_by = v_user and resolved_by_name is not null;
    r := r || format('%s T98 improcedente: justificativa curta recusada=%s; plano=%s; registro com motivo e autor=%s; resposta original intacta=%s%s',
      case when ok2 and txt = 'improper' and n = 1 and ok then 'PASS' else 'FAIL' end, ok2, txt, n, ok, chr(10));
  exception when others then r := r || 'FAIL T98 ' || sqlerrm || chr(10);
  end;

  -- ---------------------------------------------------------------- T99 --
  begin
    select p.id into p4 from public.action_plans p where p.vehicle_id = v_c and p.plan_key = 'q:luzes.farois:itens_falha=farol_esquerdo';
    select count(*) into n from public.maintenances where vehicle_id = v_c;
    perform public.action_plan_resolve_items(p4, jsonb_build_object('resolution', 'resolved_without_maintenance',
      'reason_code', 'ajuste_operacional', 'reason', 'Conector do farol reencaixado pelo motorista na base.', 'resolved_on', v_today - 1));
    select count(*) into n2 from public.maintenances where vehicle_id = v_c;
    select p.status, p.closed_by = v_user and not p.auto_closed and (p.closed_at at time zone 'America/Sao_Paulo')::date = v_today - 1
      into txt, ok from public.action_plans p where p.id = p4;
    r := r || format('%s T99 resolvido sem manutenção: plano=%s, manutenções antes/depois=%s/%s, encerrado pelo usuário na data informada=%s%s',
      case when txt = 'resolved_without_maintenance' and n = n2 and ok then 'PASS' else 'FAIL' end, txt, n, n2, ok, chr(10));
  exception when others then r := r || 'FAIL T99 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T100 --
  begin
    -- Baixa sem manutenção bloqueada enquanto manutenção aberta trata o apontamento.
    ok2 := false;
    begin
      perform public.action_plan_resolve_items(p2, jsonb_build_object('resolution', 'resolved_without_maintenance',
        'reason_code', 'ajuste_operacional', 'reason', 'Tentativa de baixa com manutenção aberta.'));
    exception when invalid_parameter_value then ok2 := true;
    end;
    -- Concluir a manutenção do veículo B resolve o único apontamento → fechamento automático.
    perform public.maintenance_start(m2, jsonb_build_object('entry_date', v_today, 'entry_time', '08:00'));
    v_items := '[]';
    for v_it in select id from public.maintenance_items where maintenance_id = m2 loop
      v_items := v_items || jsonb_build_object('item_id', v_it.id, 'status', 'done', 'result', 'resolved');
    end loop;
    perform public.maintenance_complete(m2, jsonb_build_object('exit_date', v_today, 'exit_time', '18:00', 'items', v_items));
    perform pg_temp.s25_flush();
    select p.status, p.auto_closed into v_x from public.action_plans p where p.id = p2;
    -- Nenhum plano encerrado com pendência, nenhum aberto sem pendência.
    select count(*) into n from public.action_plans p
     where p.organization_id = v_org and private.action_plan_terminal(p.status)
       and exists (select 1 from public.action_plan_items i where i.plan_id = p.id and i.status in ('pending', 'in_maintenance', 'needs_action'));
    select count(*) into n2 from public.action_plans p
     where p.organization_id = v_org and not private.action_plan_terminal(p.status)
       and not exists (select 1 from public.action_plan_items i where i.plan_id = p.id and i.status in ('pending', 'in_maintenance', 'needs_action'));
    -- Escrita direta na tabela: só pelas RPCs.
    ok3 := false;
    set local role authenticated;
    begin
      update public.action_plans set status = 'resolved' where id = p1;
    exception when insufficient_privilege then ok3 := true;
    end;
    reset role;
    r := r || format('%s T100 status: baixa com manutenção aberta recusada=%s; plano B=%s fechamento_automatico=%s; encerrados com pendência=%s, abertos sem pendência=%s; escrita direta recusada=%s%s',
      case when ok2 and v_x.status = 'resolved' and v_x.auto_closed and n = 0 and n2 = 0 and ok3 then 'PASS' else 'FAIL' end,
      ok2, v_x.status, v_x.auto_closed, n, n2, ok3, chr(10));
  exception when others then r := r || 'FAIL T100 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T101 --
  begin
    select p.operation_id, p.vehicle_id, p.operation_br_id, p.first_operational_date into v_x from public.action_plans p where p.id = p1;
    -- A alocação/contexto do veículo muda depois (novo checklist em outra
    -- operação): o plano e os apontamentos antigos ficam onde aconteceram.
    e6 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_a, v_op2, v_today, jsonb_build_array(
            jsonb_build_object('q', 'mecanica.freios_servico', 'a', 'no')));
    perform public.action_plan_reprocess(v_org, jsonb_build_object('date_from', v_today - 10, 'date_to', v_today));
    select p.operation_id = v_x.operation_id and p.vehicle_id = v_x.vehicle_id and p.operation_br_id is not distinct from v_x.operation_br_id
           and p.first_operational_date = v_x.first_operational_date
      into ok from public.action_plans p where p.id = p1;
    select count(*) filter (where operation_id = v_op), count(*) filter (where operation_id = v_op2)
      into n, n2 from public.action_plan_items where plan_id = p1;
    r := r || format('%s T101 histórico: contexto do plano preservado=%s; apontamentos na operação A=%s e na nova operação B=%s (cada um com o seu)%s',
      case when ok and n = 3 and n2 = 1 then 'PASS' else 'FAIL' end, ok, n, n2, chr(10));
  exception when others then r := r || 'FAIL T101 ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T102 --
  begin
    select count(*) into n from public.action_plan_items where organization_id = v_org;
    select count(*) into n2 from public.action_plans where organization_id = v_org;
    select count(*) into n3 from public.outbox_events where event_type = 'checklist.damage.reported';
    select count(*) into v_sub from public.maintenances where organization_id = v_org;
    perform private.action_plan_ingest_execution(e1, 'reprocess');
    perform private.action_plan_ingest_execution(e3, 'reprocess');
    perform public.action_plan_reprocess(v_org, jsonb_build_object('date_from', v_today - 10, 'date_to', v_today));
    -- o mesmo evento chegando de novo
    insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
    values (v_org, 'checklist.execution.submitted', 'checklist_execution', e5, '{}'::jsonb);
    ok := (select count(*) from public.action_plan_items where organization_id = v_org) = n
          and (select count(*) from public.action_plans where organization_id = v_org) = n2
          and (select count(*) from public.outbox_events where event_type = 'checklist.damage.reported') = n3
          and (select count(*) from public.maintenances where organization_id = v_org) = v_sub.count;
    r := r || format('%s T102 idempotência: apontamentos=%s, planos=%s, eventos de avaria=%s, manutenções=%s — inalterados=%s%s',
      case when ok then 'PASS' else 'FAIL' end, n, n2, n3, v_sub.count, ok, chr(10));
  exception when others then r := r || 'FAIL T102 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------- correção e aderência (+) --
  begin
    -- O motorista marcou freio inconforme; a correção administrativa muda para
    -- conforme: o apontamento só pendente é cancelado (com registro), a
    -- resposta original fica na trilha da correção.
    perform set_config('hfm.checklist_correction', 'on', true);
    update public.checklist_execution_answers set answer = 'yes', is_conforming = true
     where execution_id = e6 and question_key = 'mecanica.freios_servico';
    perform set_config('hfm.checklist_correction', '', true);
    select i.status, (select r2.source from public.action_plan_item_resolutions r2 where r2.item_id = i.id order by r2.resolved_at desc limit 1)
      into v_x from public.action_plan_items i
      join public.checklist_execution_answers a on a.id = i.checklist_answer_id
     where a.execution_id = e6;
    -- Aderência: nenhuma escrita do Plano de Ação nas tabelas dela.
    select count(*) into n from public.action_plan_events e where e.organization_id = v_org and e.event_type like 'adherence%';
    r := r || format('%s (+) correção do checklist: apontamento=%s (fonte %s); aderência intocada=%s%s',
      case when v_x.status = 'cancelled' and v_x.source = 'correction' and n = 0 then 'PASS' else 'FAIL' end,
      v_x.status, v_x.source, n = 0, chr(10));
  exception when others then r := r || 'FAIL (+) correção ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------ leituras (+) --
  begin
    e7 := pg_temp.s25_exec(v_org, v_app, v_ver, v_user, v_emp, v_d, v_op2, v_today - 1, jsonb_build_array(
            jsonb_build_object('q', 'seguranca.buzina', 'a', 'no')));
    select id into p5 from public.action_plans where vehicle_id = v_d and plan_key = 'q:seguranca.buzina';
    set local role authenticated;
    txt := '';
    foreach k in array array['"operation"', '"cluster"', '"vehicle"', '"priority"', '"responsible"']::jsonb[] loop
      j := public.action_plan_groups(v_org, '{}'::jsonb, k #>> '{}');
      txt := txt || (k #>> '{}') || '=' || jsonb_array_length(j -> 'rows') || ' ';
    end loop;
    j := public.action_plan_dashboard(v_org, jsonb_build_object('date_from', v_today - 30, 'date_to', v_today));
    ok := (j -> 'kpis' ->> 'findings_received')::int >= 7 and (j -> 'kpis' ->> 'findings_damage')::int >= 1
          and jsonb_array_length(j -> 'funnel') = 6 and jsonb_array_length(j -> 'trend') > 0 and j ? 'coverage';
    txt := txt || format('painel: recebidas=%s (avaria %s), apontamentos=%s, aderência de tratativa=%s%%, TMR=%s, cobertura=%s%%; ',
      j -> 'kpis' ->> 'findings_received', j -> 'kpis' ->> 'findings_damage', j -> 'kpis' ->> 'items',
      j -> 'kpis' ->> 'treatment_adherence', j -> 'kpis' ->> 'tmr_avg_days', j -> 'coverage' ->> 'pct');
    j := public.action_plan_list(v_org, '{"deadline":"overdue"}'::jsonb, 'due', 'asc', 10, 0);
    k := public.action_plan_detail(p1);
    -- 4 apontamentos (3 + o da operação B, cancelado pela correção), 4 checklists de origem
    ok := ok and jsonb_array_length(k -> 'items') = 4 and jsonb_array_length(k -> 'maintenance_links') = 1
          and jsonb_array_length(k -> 'executions') = 4 and jsonb_array_length(k -> 'events') > 0;
    j := public.action_plan_reconciliation(v_org, '{}'::jsonb, null, 50, 0);
    ok := ok and j ? 'counts';
    j := public.action_plan_quality(v_org);
    ok := ok and jsonb_array_length(j -> 'checks') >= 12
          and (select (c ->> 'count')::int from jsonb_array_elements(j -> 'checks') c where c ->> 'key' = 'closed_with_pending') = 0;
    j := public.action_plan_health(v_org, 30);
    ok := ok and (j ->> 'processed')::int >= 6 and (j ->> 'failed')::int = 0;
    j := public.action_plan_mapping(v_org);
    ok := ok and jsonb_array_length(j -> 'rows') >= 40;
    j := public.action_plan_vehicle(v_a);
    ok := ok and jsonb_array_length(j -> 'rows') = 1;
    j := public.action_plan_checklist_history(v_org, jsonb_build_object('vehicle_ids', jsonb_build_array(v_a)), 50, 0);
    ok := ok and (j ->> 'total')::int = 4;
    j := public.action_plan_execution_trace(e1);
    ok := ok and (select count(*) from jsonb_array_elements(j -> 'findings') f where f ->> 'route' = 'damage') = 1;
    j := public.action_plan_catalog(v_org);
    ok := ok and jsonb_array_length(j -> 'action_keys') >= 3;
    j := public.action_plan_followup_import(v_org, jsonb_build_array(
           jsonb_build_object('row', 2, 'plan_code', (select code from public.action_plans where id = p5), 'action', 'SEM_MANUTENCAO',
                              'reason', 'Buzina religada: fusível trocado na base.'),
           jsonb_build_object('row', 3, 'plan_code', 'PA-0000-XXXXXX', 'action', 'IMPROCEDENTE', 'reason', 'Inexistente para teste.')), false);
    reset role;
    ok := ok and (j ->> 'ok')::int = 1 and (j ->> 'errors')::int = 1
          and (select status from public.action_plans where id = p5) = 'new';
    -- conciliação sob demanda e correção automática segura (sobre os planos da suíte)
    k := public.action_plan_run_reconciliation(v_org);
    j := public.action_plan_quality_fix(v_org);
    ok := ok and (k ->> 'checked')::int >= 1 and (j ->> 'plans_refreshed')::int >= 5;
    txt := txt || format('conciliação sob demanda=%s; correção segura=%s; ', k, j);
    r := r || format('%s (+) leituras e follow-up (prévia): %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then reset role; r := r || 'FAIL (+) leituras ' || sqlerrm || chr(10);
  end;

  -- --------------------------------------------------------------- T103 --
  begin
    txt := '';
    insert into public.organizations (name, slug) values ('Suite25 Outro Tenant', 'suite25-outro-' || substr(md5(random()::text), 1, 8))
    returning id into v_org2;
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    perform set_config('hfm.access_change', '', true);

    -- Administrador: lê e trata
    set local role authenticated;
    n := (public.action_plan_list(v_org, '{}'::jsonb, 'priority', 'desc', 50, 0) ->> 'total')::int;
    j := public.action_plan_dashboard(v_org, '{}'::jsonb);
    reset role;
    ok := n >= 4 and j ? 'kpis' and (j -> 'kpis' ->> 'items')::int >= 7;
    txt := txt || format('Administrador lista=%s, painel=%s; ', n, j ? 'kpis');

    -- Outro tenant: nada
    ok2 := false;
    begin perform public.action_plan_list(v_org2, '{}'::jsonb, 'priority', 'desc', 50, 0);
    exception when insufficient_privilege then ok2 := true; end;
    ok3 := false;
    begin perform public.action_plan_save_settings(v_org2, '{"due_soon_days":5}'::jsonb);
    exception when insufficient_privilege then ok3 := true; end;
    set local role authenticated;
    select count(*) into n2 from public.action_plans where organization_id = v_org2;
    reset role;
    txt := txt || format('outro tenant: leitura recusada=%s, gravação recusada=%s, linhas=%s; ', ok2, ok3, n2);
    ok := ok and ok2 and ok3 and n2 = 0;

    -- Gestor de Frota com escopo só na operação A: vê e trata os planos de A;
    -- o plano de outra operação (sem escopo) é recusado.
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = null where user_id = v_user and revoked_at = now();
    delete from public.membership_operation_scopes where membership_id = v_mem;
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_op);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gestor_frota'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    begin
      perform public.action_plan_change_priority(p1, 'high', 'Suite25: gestor reavaliou a criticidade', true);
      perform public.action_plan_add_note(p1, 'Suite25: gestor acompanhando');
      ok2 := true;
    exception when others then ok2 := false; txt := txt || 'gestor erro: ' || sqlerrm || '; ';
    end;
    ok3 := false;
    begin perform public.action_plan_add_note(p5, 'Suite25: fora do escopo');
    exception when insufficient_privilege then ok3 := true; end;
    set local role authenticated;
    n := (public.action_plan_list(v_org, '{}'::jsonb, 'priority', 'desc', 50, 0) ->> 'total')::int;
    reset role;
    txt := txt || format('Gestor de Frota (escopo A) trata=%s, fora do escopo recusado=%s, lista no escopo=%s; ', ok2, ok3, n);
    ok := ok and ok2 and ok3 and n >= 4;

    -- Liderança (escopo A): acompanha, não trata
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'lideranca_operacoes'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    set local role authenticated;
    n := (public.action_plan_list(v_org, '{}'::jsonb, 'priority', 'desc', 50, 0) ->> 'total')::int;
    j := public.action_plan_my_view(v_org);
    reset role;
    ok2 := false;
    begin perform public.action_plan_change_priority(p1, 'low', 'Suite25: liderança tenta alterar', true);
    exception when insufficient_privilege then ok2 := true; end;
    ok3 := false;
    begin perform public.action_plan_resolve_items(p1, jsonb_build_object('resolution', 'cancelled', 'reason', 'Suite25: liderança tenta cancelar'));
    exception when insufficient_privilege then ok3 := true; end;
    txt := txt || format('Liderança lê=%s e minha visão=%s; prioridade recusada=%s, cancelamento recusado=%s; ', n, j ? 'scope', ok2, ok3);
    ok := ok and n >= 4 and ok2 and ok3;

    -- Operacional: só os próprios apontamentos (feedback), sem portal e sem ação
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'operacional'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    ok2 := false;
    begin perform public.action_plan_list(v_org, '{}'::jsonb, 'priority', 'desc', 50, 0);
    exception when insufficient_privilege then ok2 := true; end;
    set local role authenticated;
    j := public.action_plan_my_reports(v_org, 30);
    select count(*) into n2 from public.action_plans;
    reset role;
    ok3 := false;
    begin perform public.action_plan_add_note(p1, 'operacional tenta');
    exception when insufficient_privilege then ok3 := true; end;
    txt := txt || format('Operacional: portal recusado=%s, meus apontamentos=%s, planos visíveis por RLS=%s, ação recusada=%s; ',
                         ok2, jsonb_array_length(j -> 'rows'), n2, ok3);
    ok := ok and ok2 and jsonb_array_length(j -> 'rows') >= 1 and n2 = 0 and ok3;

    -- Sem acesso (Gente)
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gente'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    ok2 := false;
    begin perform public.action_plan_dashboard(v_org, '{}'::jsonb);
    exception when insufficient_privilege then ok2 := true; end;
    ok3 := false;
    begin perform public.action_plan_my_reports(v_org, 30);
    exception when insufficient_privilege then ok3 := true; end;
    txt := txt || format('sem acesso: painel recusado=%s, feedback recusado=%s', ok2, ok3);
    ok := ok and ok2 and ok3;

    r := r || format('%s T103 segurança: %s%s', case when ok then 'PASS' else 'FAIL' end, txt, chr(10));
  exception when others then r := r || 'FAIL T103 ' || sqlerrm || chr(10);
  end;

  raise exception 'ROLLBACK_TESTES%s%s', chr(10), r;
end $t$;
