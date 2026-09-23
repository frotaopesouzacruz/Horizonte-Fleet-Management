-- =============================================================================
-- 16d · Aderência › "Minha situação" do perfil Operacional (§63)
--
-- Suíte transacional contra o banco COM DADOS (competência vigente já
-- materializada pela rotina). Não cria veículo, operação, BR nem colaborador:
-- usa vínculos de fidelização reais e cria, DENTRO da transação, os vínculos de
-- motorista (a produção não tem nenhum); as execuções passam pela rotina
-- oficial do Check List de Frota. Cada bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO — nada sobrevive.
--
-- COMO RODAR: cole um bloco por vez num SQL editor conectado ao banco. Precisa
-- de pelo menos 6 dias corridos no mês (a janela do 1º vínculo termina 5 dias
-- antes de hoje).
--
-- O que cada bloco protege:
--   Bloco 1 (conteúdo)
--   M1  só as BRs/obrigações da própria pessoa: as duas posições de motorista
--       titular, nos dias de cada vínculo, e a obrigação de outra BR que ela
--       mesma cumpriu; nenhuma linha fora desse conjunto
--   M2  motorista SECUNDÁRIO (escala de reserva) e o titular de OUTRO
--       colaborador não entram
--   M3  números = fórmula oficial: numerador, denominador e % iguais à soma
--       de `adherence_summary` sobre o mesmo recorte (total e saída)
--   M4  checklists enviados pela pessoa: a saída de hoje da sua BR sai feita e
--       "enviada por você"; a de outra BR entra só por execução; contagem de
--       enviados e conciliados
--   M5  pendências: o total bate com NF + retorno pendente do conjunto, todas
--       da própria pessoa; dias = (data × veículo) distintos do conjunto
--   Bloco 2 (segurança; papel trocado do único membro DENTRO da transação —
--   UPDATE de membership_roles com a marca das rotinas de acesso; a guarda do
--   último Administrador dispara no DELETE — e administrador de plataforma
--   revogado)
--   S1  Operacional: padrão da matriz inclui adherence.view_own e a consulta
--       devolve a própria situação
--   S2  Operacional com a permissão retirada do papel: recusado (42501)
--   S3  Gente: sem a permissão por padrão, no papel da organização, e recusado
--   S4  Administrador (sem plataforma): continua só a própria situação, nunca
--       a organização
--   S5  conta sem colaborador vinculado: resultado vazio explícito
--       (state = no_employee)
--   S6  outra organização e conta sem vínculo: recusados; anon não executa
--   S7  mês sem vínculo de motorista nem checklist: state = not_driver
--
-- Última execução: 23/09/2026 (projeto jgyvaltwqntpcjqounty), 12/12 PASS
--   Bloco 1: M1–M5 PASS (61 obrigações próprias em 3 BRs; 2/46 = 4,35%)
--   Bloco 2: S1–S7 PASS (administrador: 60 próprias de 4.920 da organização)
--   Resultado verbatim no fim de cada bloco. Depois das duas execuções:
--   fidelization_drivers = 0, checklist_executions = 0, papel e vínculo do
--   membro inalterados (nada persistiu).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_emp uuid; v_emp2 uuid; v_op uuid;
  v_today date; v_from date; v_to date; v_split date;
  a record; b record; c record; d record; e record;
  f jsonb; v_ans jsonb; v_res jsonb; j jsonb; s1 jsonb; s2 jsonb; s3 jsonb;
  v_expected uuid[]; v_brs text[]; v_exp_brs text[]; v_br_c text; v_br_d text;
  n bigint; n2 bigint; n3 bigint; num bigint; den bigint;
  ok boolean; ok2 boolean; ok3 boolean; ok4 boolean;
  r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.employee_id into v_user, v_emp from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  select id into v_op from public.operations where organization_id = v_org and code = 'OP-00004';
  v_today := private.adherence_today(v_org);
  v_from := date_trunc('month', v_today)::date;
  v_to := (v_from + interval '1 month - 1 day')::date;
  v_split := v_today - 4;
  if v_split - 1 < v_from then
    raise exception 'FIXTURE: a suíte precisa de pelo menos 6 dias corridos no mês (hoje = %).', v_today;
  end if;

  -- B e E: vans da mesma operação com a saída de hoje em aberto (B será a BR
  -- do 2º vínculo; E, uma BR que não é da pessoa, onde ela envia um checklist).
  select s.vehicle_id, s.id as obligation_id, s.operation_br_id, fa.id as assignment_id into b
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
    join public.fidelization_assignments fa on fa.id = s.fidelization_assignment_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request
     and fa.start_date <= v_split and coalesce(fa.end_date, 'infinity'::date) >= v_to
   order by s.fleet_code_snapshot limit 1;
  select s.vehicle_id, s.id as obligation_id, s.operation_br_id, fa.id as assignment_id into e
    from public.adherence_obligation_status s
    join public.vehicle_types t on t.id = s.vehicle_type_id
    join public.fidelization_assignments fa on fa.id = s.fidelization_assignment_id
   where s.organization_id = v_org and s.operational_date = v_today and s.checklist_context = 'saida'
     and s.operation_id = v_op and t.code = 'van' and not s.is_done and not s.has_pending_request
     and s.operation_br_id <> b.operation_br_id
   order by s.fleet_code_snapshot desc limit 1;
  -- A: 1º vínculo (do dia 1º até 5 dias antes de hoje), outra BR.
  select fa.id as assignment_id, fa.operation_br_id, fa.vehicle_id into a
    from public.fidelization_assignments fa
   where fa.organization_id = v_org and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= v_from and coalesce(fa.end_date, 'infinity'::date) >= v_split - 1
     and fa.operation_br_id not in (b.operation_br_id, e.operation_br_id)
     and exists (select 1 from public.checklist_obligations o where o.organization_id = v_org and o.is_active
                  and o.operation_br_id = fa.operation_br_id and o.vehicle_id = fa.vehicle_id
                  and o.operational_date between v_from and v_split - 1)
   order by fa.id limit 1;
  -- C: a pessoa como motorista SECUNDÁRIO; D: outro colaborador como titular.
  select fa.id as assignment_id, fa.operation_br_id, fa.vehicle_id into c
    from public.fidelization_assignments fa
   where fa.organization_id = v_org and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= v_from and coalesce(fa.end_date, 'infinity'::date) >= v_to
     and fa.operation_br_id not in (a.operation_br_id, b.operation_br_id, e.operation_br_id)
     and exists (select 1 from public.checklist_obligations o where o.organization_id = v_org and o.is_active
                  and o.operation_br_id = fa.operation_br_id and o.operational_date between v_from and v_to)
   order by fa.id limit 1;
  select fa.id as assignment_id, fa.operation_br_id, fa.vehicle_id into d
    from public.fidelization_assignments fa
   where fa.organization_id = v_org and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= v_from and coalesce(fa.end_date, 'infinity'::date) >= v_to
     and fa.operation_br_id not in (a.operation_br_id, b.operation_br_id, c.operation_br_id, e.operation_br_id)
     and exists (select 1 from public.checklist_obligations o where o.organization_id = v_org and o.is_active
                  and o.operation_br_id = fa.operation_br_id and o.operational_date between v_from and v_to)
   order by fa.id limit 1;
  select em.id into v_emp2 from public.employees em
   where em.organization_id = v_org and em.deleted_at is null and em.id <> v_emp
   order by em.employee_code limit 1;
  if a.assignment_id is null or b.assignment_id is null or c.assignment_id is null or d.assignment_id is null
     or e.obligation_id is null or v_emp2 is null then
    raise exception 'FIXTURE: vínculos reais insuficientes (a=% b=% c=% d=% e=%).',
      a.assignment_id, b.assignment_id, c.assignment_id, d.assignment_id, e.obligation_id;
  end if;
  select code into v_br_c from public.operation_brs where id = c.operation_br_id;
  select code into v_br_d from public.operation_brs where id = d.operation_br_id;

  -- Vínculos de motorista temporários (sem sessão: não passam pela guarda de
  -- correção histórica, que é de quem edita pela tela).
  insert into public.fidelization_drivers (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status) values
    (v_org, a.assignment_id, v_emp,  'primary',   v_from,  v_split - 1, 'planned'),
    (v_org, b.assignment_id, v_emp,  'primary',   v_split, v_to,        'planned'),
    (v_org, c.assignment_id, v_emp,  'secondary', v_from,  v_to,        'planned'),
    (v_org, d.assignment_id, v_emp2, 'primary',   v_from,  v_to,        'planned');

  -- Dois checklists da própria pessoa pela rotina oficial: saída de hoje de B
  -- (a sua BR) e de E (BR de outro).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  f := public.checklist_fleet_form(v_org, b.vehicle_id, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') cl, jsonb_array_elements(cl->'questions') q;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', 'aderencia-16d-' || gen_random_uuid()::text, 'vehicle_id', b.vehicle_id, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));
  f := public.checklist_fleet_form(v_org, e.vehicle_id, v_op);
  select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'answer', 'yes',
           'conditional_value', case when q->'conditional'->>'trigger_answer' = 'yes'
             then jsonb_build_object(q->'conditional'->>'field_key', 'Descricao de teste.') else null end))
    into v_ans from jsonb_array_elements(f->'clusters') cl, jsonb_array_elements(cl->'questions') q;
  v_res := public.submit_checklist_execution(v_org, jsonb_build_object(
    'idempotency_key', 'aderencia-16d-' || gen_random_uuid()::text, 'vehicle_id', e.vehicle_id, 'operation_id', v_op,
    'checklist_type', 'saida', 'operational_date', v_today,
    'started_at', (now() - interval '120 seconds')::text, 'answers', v_ans));

  -- A consulta, como a pessoa.
  set local role authenticated;
  j := public.adherence_my_situation(v_org, extract(year from v_today)::int, extract(month from v_today)::int);
  reset role;

  -- O conjunto esperado, lido direto da tabela.
  select coalesce(array_agg(o.id), array[]::uuid[]) into v_expected from public.checklist_obligations o
   where o.organization_id = v_org and o.is_active and (
         (o.operation_br_id = a.operation_br_id and o.vehicle_id = a.vehicle_id and o.operational_date between v_from and v_split - 1)
      or (o.operation_br_id = b.operation_br_id and o.vehicle_id = b.vehicle_id and o.operational_date between v_split and v_to)
      or o.id = e.obligation_id);
  n := cardinality(v_expected);
  select array_agg(distinct br.code order by br.code) into v_exp_brs
    from public.checklist_obligations o join public.operation_brs br on br.id = o.operation_br_id
   where o.id = any (v_expected);
  select array_agg(distinct d2->>'br_code' order by d2->>'br_code') into v_brs from jsonb_array_elements(j->'days') d2;

  -- M1
  ok := j->>'state' = 'ok' and (j->'summary'->'total'->>'obligations')::bigint = n and v_brs = v_exp_brs
        and jsonb_array_length(j->'positions') = 2;
  r := r || format('M1  so a propria situacao: %s obrigacoes (esperado %s), BRs %s = %s, 2 posicoes de titular -> %s%s',
       j->'summary'->'total'->>'obligations', n, v_brs, v_exp_brs, case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- M2
  ok := not (v_br_c = any (v_brs)) and not (v_br_d = any (v_brs))
        and not exists (select 1 from jsonb_array_elements(j->'pending') p where p->>'br_code' in (v_br_c, v_br_d));
  r := r || format('M2  secundario (%s) e titular de outro colaborador (%s) fora -> %s%s',
       v_br_c, v_br_d, case when ok then 'PASS' else 'FAIL' end, chr(10));

  -- M3: a mesma fórmula, pela rotina oficial, sobre o mesmo recorte
  s1 := public.adherence_summary(v_org, v_from, v_split - 1, null, jsonb_build_object('operation_br_id', a.operation_br_id, 'vehicle_id', a.vehicle_id), null);
  s2 := public.adherence_summary(v_org, v_split, v_to, null, jsonb_build_object('operation_br_id', b.operation_br_id, 'vehicle_id', b.vehicle_id), null);
  s3 := public.adherence_summary(v_org, v_today, v_today, 'saida', jsonb_build_object('vehicle_id', e.vehicle_id), null);
  num := (s1->>'numerator')::bigint + (s2->>'numerator')::bigint + (s3->>'numerator')::bigint;
  den := (s1->>'denominator')::bigint + (s2->>'denominator')::bigint + (s3->>'denominator')::bigint;
  ok := (j->'summary'->'total'->>'numerator')::bigint = num and (j->'summary'->'total'->>'denominator')::bigint = den
        and (j->'summary'->'total'->>'adherence_pct')::numeric is not distinct from
            (case when den > 0 then round(num::numeric * 100 / den, 2) end);
  s1 := public.adherence_summary(v_org, v_from, v_split - 1, 'saida', jsonb_build_object('operation_br_id', a.operation_br_id, 'vehicle_id', a.vehicle_id), null);
  s2 := public.adherence_summary(v_org, v_split, v_to, 'saida', jsonb_build_object('operation_br_id', b.operation_br_id, 'vehicle_id', b.vehicle_id), null);
  ok2 := (j->'summary'->'saida'->>'numerator')::bigint = (s1->>'numerator')::bigint + (s2->>'numerator')::bigint + (s3->>'numerator')::bigint
     and (j->'summary'->'saida'->>'denominator')::bigint = (s1->>'denominator')::bigint + (s2->>'denominator')::bigint + (s3->>'denominator')::bigint;
  r := r || format('M3  formula oficial: total %s/%s = %s%% (summary %s/%s), saida confere %s -> %s%s',
       j->'summary'->'total'->>'numerator', j->'summary'->'total'->>'denominator', j->'summary'->'total'->>'adherence_pct',
       num, den, ok2, case when ok and ok2 then 'PASS' else 'FAIL' end, chr(10));

  -- M4
  select count(*) into n2 from public.checklist_executions x
   where x.organization_id = v_org and x.employee_id = v_emp and x.status = 'submitted' and x.operational_date between v_from and v_to;
  ok := exists (select 1 from jsonb_array_elements(j->'days') d2
                 where d2->>'date' = v_today::text and d2->>'license_plate' = (select license_plate from public.vehicles where id = b.vehicle_id)
                   and (d2->'saida'->>'done')::boolean and (d2->'saida'->>'performed_by_me')::boolean and (d2->>'by_fidelization')::boolean);
  ok2 := exists (select 1 from jsonb_array_elements(j->'days') d2
                  where d2->>'date' = v_today::text and d2->>'license_plate' = (select license_plate from public.vehicles where id = e.vehicle_id)
                    and (d2->'saida'->>'done')::boolean and (d2->>'by_execution')::boolean and not (d2->>'by_fidelization')::boolean
                    and d2->'retorno' = 'null'::jsonb);
  ok3 := (j->'executions'->>'submitted')::bigint = n2 and (j->'executions'->>'linked')::bigint >= 2;
  r := r || format('M4  checklists da pessoa: saida de hoje da propria BR feita e enviada por ela %s, BR de outro so pela execucao (sem o retorno dela) %s, enviados %s/conciliados %s %s -> %s%s',
       ok, ok2, j->'executions'->>'submitted', j->'executions'->>'linked', ok3, case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, chr(10));

  -- M5
  select count(*) into n2 from public.adherence_obligation_status s
   where s.id = any (v_expected) and s.status_code in ('NAO_FEZ_CHECKLIST', 'RETORNO_PENDENTE');
  select count(*) into n3 from (select distinct o.operational_date, o.vehicle_id from public.checklist_obligations o where o.id = any (v_expected)) q;
  ok := (j->>'pending_total')::bigint = n2 and jsonb_array_length(j->'days') = n3
        and not exists (select 1 from jsonb_array_elements(j->'pending') p where not (p->>'br_code' = any (v_exp_brs)));
  r := r || format('M5  pendencias %s (esperado %s), dias %s (esperado %s), todas da propria pessoa -> %s%s',
       j->>'pending_total', n2, jsonb_array_length(j->'days'), n3, case when ok then 'PASS' else 'FAIL' end, chr(10));

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- Última execução (23/09/2026, jgyvaltwqntpcjqounty) — Bloco 1, verbatim:
--   ROLLBACK_TESTES
--   M1  so a propria situacao: 61 obrigacoes (esperado 61), BRs {BR0302274,"Redespacho Juiz de Fora","Redespacho MG_4"} = {BR0302274,"Redespacho Juiz de Fora","Redespacho MG_4"}, 2 posicoes de titular -> PASS
--   M2  secundario (BR0302284) e titular de outro colaborador (BR0024863) fora -> PASS
--   M3  formula oficial: total 2/46 = 4.35% (summary 2/46), saida confere t -> PASS
--   M4  checklists da pessoa: saida de hoje da propria BR feita e enviada por ela t, BR de outro so pela execucao (sem o retorno dela) t, enviados 2/conciliados 2 t -> PASS
--   M5  pendencias 45 (esperado 45), dias 31 (esperado 31), todas da propria pessoa -> PASS

-- =============================================================================
-- Bloco 2 · Segurança por permissão, colaborador e organização
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_emp uuid; v_today date; v_from date; v_to date;
  a record; j jsonb; n bigint; n_org bigint; y int; m int; y3 int; m3 int;
  ok boolean; ok2 boolean; v_err text; r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m2.user_id, m2.id, m2.employee_id into v_user, v_mem, v_emp from public.organization_memberships m2
   where m2.organization_id = v_org and m2.status = 'active' and m2.employee_id is not null limit 1;
  v_today := private.adherence_today(v_org);
  v_from := date_trunc('month', v_today)::date;
  v_to := (v_from + interval '1 month - 1 day')::date;
  y := extract(year from v_today)::int; m := extract(month from v_today)::int;
  y3 := extract(year from v_from + interval '3 months')::int; m3 := extract(month from v_from + interval '3 months')::int;

  select fa.id as assignment_id, fa.operation_br_id, fa.vehicle_id into a
    from public.fidelization_assignments fa
   where fa.organization_id = v_org and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
     and fa.start_date <= v_from and coalesce(fa.end_date, 'infinity'::date) >= v_to
     and exists (select 1 from public.checklist_obligations o where o.organization_id = v_org and o.is_active
                  and o.operation_br_id = fa.operation_br_id and o.vehicle_id = fa.vehicle_id and o.operational_date between v_from and v_to)
   order by fa.id limit 1;
  insert into public.fidelization_drivers (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status)
  values (v_org, a.assignment_id, v_emp, 'primary', v_from, v_to, 'planned');
  select count(*) into n from public.checklist_obligations o
   where o.organization_id = v_org and o.is_active and o.operation_br_id = a.operation_br_id and o.vehicle_id = a.vehicle_id
     and o.operational_date between v_from and v_to;
  select count(*) into n_org from public.checklist_obligations o
   where o.organization_id = v_org and o.is_active and o.operational_date between v_from and v_to;

  -- Perfil simulado: Operacional, sem administrador de plataforma.
  perform set_config('hfm.access_change', 'on', true);
  update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'operacional' and ro.organization_id = v_org and ro.deleted_at is null)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- S1
  ok := exists (select 1 from public.access_profile_defaults where profile_code = 'operacional' and permission_code = 'adherence.view_own')
    and exists (select 1 from public.role_permissions rp join public.roles ro on ro.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                 where ro.organization_id = v_org and ro.code = 'operacional' and p.code = 'adherence.view_own');
  set local role authenticated;
  j := public.adherence_my_situation(v_org, y, m);
  ok2 := not private.has_permission(v_org, 'adherence.view');
  reset role;
  r := r || format('S1  operacional: padrao da matriz e papel com adherence.view_own %s, sem adherence.view %s, consulta devolve %s obrigacoes (esperado %s) -> %s%s',
       ok, ok2, j->'summary'->'total'->>'obligations', n,
       case when ok and ok2 and j->>'state' = 'ok' and (j->'summary'->'total'->>'obligations')::bigint = n then 'PASS' else 'FAIL' end, chr(10));

  -- S2: o administrador retira a permissão do papel Operacional
  perform set_config('hfm.access_change', 'on', true);
  delete from public.role_permissions rp
   using public.roles ro, public.permissions p
   where rp.role_id = ro.id and rp.permission_id = p.id
     and ro.organization_id = v_org and ro.code = 'operacional' and p.code = 'adherence.view_own';
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    perform public.adherence_my_situation(v_org, y, m);
    v_err := 'devolveu dados';
  exception when others then v_err := sqlstate || ' ' || sqlerrm; end;
  reset role;
  r := r || format('S2  operacional sem a permissao no papel: %s -> %s%s', v_err,
       case when v_err like '42501%autoriza%' then 'PASS' else 'FAIL' end, chr(10));

  -- S3: Gente
  ok := not exists (select 1 from public.access_profile_defaults where profile_code = 'gente' and permission_code = 'adherence.view_own')
    and not exists (select 1 from public.role_permissions rp join public.roles ro on ro.id = rp.role_id join public.permissions p on p.id = rp.permission_id
                     where ro.organization_id = v_org and ro.code = 'gente' and p.code = 'adherence.view_own');
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'gente' and ro.organization_id = v_org and ro.deleted_at is null)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    perform public.adherence_my_situation(v_org, y, m);
    v_err := 'devolveu dados';
  exception when others then v_err := sqlstate || ' ' || sqlerrm; end;
  reset role;
  r := r || format('S3  gente: sem a permissao no padrao nem no papel %s; consulta %s -> %s%s', ok, v_err,
       case when ok and v_err like '42501%autoriza%' then 'PASS' else 'FAIL' end, chr(10));

  -- S4: Administrador (sem plataforma)
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'administrador' and ro.organization_id = v_org and ro.deleted_at is null)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  j := public.adherence_my_situation(v_org, y, m);
  reset role;
  r := r || format('S4  administrador: %s obrigacoes proprias (organizacao tem %s), %s posicao -> %s%s',
       j->'summary'->'total'->>'obligations', n_org, jsonb_array_length(j->'positions'),
       case when (j->'summary'->'total'->>'obligations')::bigint = n and n < n_org and jsonb_array_length(j->'positions') = 1 then 'PASS' else 'FAIL' end, chr(10));

  -- S5: conta sem colaborador
  update public.organization_memberships set employee_id = null where id = v_mem;
  set local role authenticated;
  j := public.adherence_my_situation(v_org, y, m);
  reset role;
  update public.organization_memberships set employee_id = v_emp where id = v_mem;
  r := r || format('S5  conta sem colaborador: state=%s, resumo=%s, dias=%s, pendencias=%s -> %s%s',
       j->>'state', j->'summary', jsonb_array_length(j->'days'), jsonb_array_length(j->'pending'),
       case when j->>'state' = 'no_employee' and j->'summary' = 'null'::jsonb and jsonb_array_length(j->'days') = 0
                 and jsonb_array_length(j->'pending') = 0 and jsonb_array_length(j->'positions') = 0 then 'PASS' else 'FAIL' end, chr(10));

  -- S6: outra organização; conta sem vínculo; anon
  set local role authenticated;
  begin
    perform public.adherence_my_situation(gen_random_uuid(), y, m);
    v_err := 'devolveu dados';
  exception when others then v_err := sqlstate || ' ' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.adherence_my_situation(v_org, y, m);
    ok := false;
  exception when others then ok := sqlstate = '42501'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  ok2 := not has_function_privilege('anon', 'public.adherence_my_situation(uuid, integer, integer)', 'execute');
  r := r || format('S6  outra organizacao: %s; conta sem vinculo recusada %s; anon sem execucao %s -> %s%s', v_err, ok, ok2,
       case when v_err like '42501%não pertence%' and ok and ok2 then 'PASS' else 'FAIL' end, chr(10));

  -- S7: mês sem vínculo de motorista nem checklist
  set local role authenticated;
  j := public.adherence_my_situation(v_org, y3, m3);
  reset role;
  r := r || format('S7  %s/%s sem vinculo nem checklist: state=%s, dias=%s -> %s%s', m3, y3, j->>'state', jsonb_array_length(j->'days'),
       case when j->>'state' = 'not_driver' and jsonb_array_length(j->'days') = 0 then 'PASS' else 'FAIL' end, chr(10));

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- Última execução (23/09/2026, jgyvaltwqntpcjqounty) — Bloco 2, verbatim:
--   ROLLBACK_TESTES
--   S1  operacional: padrao da matriz e papel com adherence.view_own t, sem adherence.view t, consulta devolve 60 obrigacoes (esperado 60) -> PASS
--   S2  operacional sem a permissao no papel: 42501 Você não tem autorização para consultar a própria situação na Aderência. -> PASS
--   S3  gente: sem a permissao no padrao nem no papel t; consulta 42501 Você não tem autorização para consultar a própria situação na Aderência. -> PASS
--   S4  administrador: 60 obrigacoes proprias (organizacao tem 4920), 1 posicao -> PASS
--   S5  conta sem colaborador: state=no_employee, resumo=null, dias=0, pendencias=0 -> PASS
--   S6  outra organizacao: 42501 Sua conta não pertence a esta organização.; conta sem vinculo recusada t; anon sem execucao t -> PASS
--   S7  12/2026 sem vinculo nem checklist: state=not_driver, dias=0 -> PASS
