-- =============================================================================
-- 34 · Usuários › ações em massa de acesso (Suspender / Reativar acesso)
--
-- Suíte transacional: cria, DENTRO da transação, colaboradores e contas de
-- teste em cada situação de acesso e termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, então nada sobrevive.
-- Seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/34_users_bulk_access.sql
--   → a última linha deve ser "ROLLBACK_TESTES 34 OK (<n> verificações)".
--
-- O que protege:
--   B1  reativar em massa altera só suspensos e convites pendentes; quem já
--       está ativo, sem conta, com acesso removido, com cadastro inativo, a
--       própria conta e ids de fora ficam como estão, cada grupo contado
--   B2  um evento por conta realmente alterada (marcado como "em massa"); a
--       segunda execução não altera nada nem gera evento
--   B3  suspender em massa: só contas ativas; convite pendente fica
--   B4  set_employee_access_status para o mesmo status não gera evento
--   B5  sem permissão: recusado (42501); ação inválida: recusada (22023)
-- =============================================================================
do $t$
declare
  org     uuid;
  adm     uuid;
  adm_emp uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid;
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid(); u7 uuid := gen_random_uuid();
  j   jsonb;
  ev  int;
  n   int := 0;
  ok  boolean;
begin
  select m.organization_id, m.user_id into org, adm
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.status = 'active' and ro.code = 'administrador'
   order by m.created_at limit 1;
  if org is null then raise exception 'sem Administrador ativo para testar'; end if;

  -- a conta do Administrador precisa de um colaborador para o caso "a própria conta"
  select m.employee_id into adm_emp from public.organization_memberships m where m.organization_id = org and m.user_id = adm;
  if adm_emp is null then
    insert into public.employees (organization_id, employee_code, full_name)
    values (org, 'T34-ADM', 'Teste 34 Administrador') returning id into adm_emp;
    update public.organization_memberships set employee_id = adm_emp where organization_id = org and user_id = adm;
  end if;

  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-1', 'Teste 34 Suspenso') returning id into e1;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-2', 'Teste 34 Convite') returning id into e2;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-3', 'Teste 34 Removido') returning id into e3;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-4', 'Teste 34 Ativo') returning id into e4;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-5', 'Teste 34 Sem conta') returning id into e5;
  insert into public.employees (organization_id, employee_code, full_name, deleted_at)
  values (org, 'T34-6', 'Teste 34 Inativado', now()) returning id into e6;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T34-7', 'Teste 34 Convite 2') returning id into e7;

  insert into auth.users (id) values (u1), (u2), (u3), (u4), (u6), (u7);
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values
    (org, u1, 'suspended', e1), (org, u2, 'invited', e2), (org, u3, 'removed', e3),
    (org, u4, 'active', e4),   (org, u6, 'suspended', e6), (org, u7, 'invited', e7);

  -- ------------------------------------------------------------- B1/B2 reativar
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.bulk_set_employee_access_status(org, array[e1, e2, e3, e4, e5, e6, adm_emp, gen_random_uuid(), e1], 'active');
  execute 'reset role';
  assert (j ->> 'requested')::int = 8, 'ids repetidos contam uma vez: ' || j::text; n := n + 1;
  assert (j ->> 'applied')::int = 2, 'reativa só suspenso e convite pendente: ' || j::text; n := n + 1;
  assert (j ->> 'already')::int = 1, 'já ativo: ' || j::text; n := n + 1;
  assert (j ->> 'no_account')::int = 1, 'sem conta: ' || j::text; n := n + 1;
  assert (j ->> 'removed')::int = 1, 'acesso removido não volta em massa: ' || j::text; n := n + 1;
  assert (j ->> 'archived')::int = 1, 'cadastro inativo não ganha acesso em massa: ' || j::text; n := n + 1;
  assert (j ->> 'self')::int = 1, 'a própria conta fica de fora: ' || j::text; n := n + 1;
  assert (j ->> 'not_found')::int = 1, 'id de fora: ' || j::text; n := n + 1;
  assert (select status from public.organization_memberships where organization_id = org and employee_id = e1) = 'active'
     and (select status from public.organization_memberships where organization_id = org and employee_id = e2) = 'active'
     and (select status from public.organization_memberships where organization_id = org and employee_id = e3) = 'removed'
     and (select status from public.organization_memberships where organization_id = org and employee_id = e6) = 'suspended',
    'status gravados'; n := n + 1;
  select count(*) into ev from public.outbox_events o
   where o.organization_id = org and o.event_type = 'user.access_reactivated' and o.aggregate_id in (e1, e2, e3, e4, e6)
     and o.payload ->> 'bulk' = 'true';
  assert ev = 2, 'um evento por conta alterada, não ' || ev; n := n + 1;

  execute 'set local role authenticated';
  j := public.bulk_set_employee_access_status(org, array[e1, e2, e4], 'active');
  execute 'reset role';
  assert (j ->> 'applied')::int = 0 and (j ->> 'already')::int = 3, 'segunda execução não muda nada: ' || j::text; n := n + 1;
  assert (select count(*) from public.outbox_events o where o.organization_id = org and o.event_type = 'user.access_reactivated'
           and o.aggregate_id in (e1, e2, e4)) = 2, 'nenhum evento novo'; n := n + 1;

  -- ------------------------------------------------------------- B3 suspender
  execute 'set local role authenticated';
  j := public.bulk_set_employee_access_status(org, array[e1, e2, e3, e4, e5, e7, adm_emp], 'suspended');
  execute 'reset role';
  assert (j ->> 'applied')::int = 3, 'suspende só contas ativas: ' || j::text; n := n + 1;
  assert (j ->> 'invited')::int = 1 and (j ->> 'removed')::int = 1 and (j ->> 'no_account')::int = 1 and (j ->> 'self')::int = 1,
    'convite, removido, sem conta e a própria conta ficam: ' || j::text; n := n + 1;
  assert (select status from public.organization_memberships where organization_id = org and employee_id = e7) = 'invited'
     and (select status from public.organization_memberships where organization_id = org and user_id = adm) = 'active',
    'convite e Administrador intactos'; n := n + 1;

  -- ------------------------------------------------------------- B4 mesmo status, sem evento
  select count(*) into ev from public.outbox_events o where o.organization_id = org and o.aggregate_id = e1;
  execute 'set local role authenticated';
  perform public.set_employee_access_status(e1, 'suspended');
  execute 'reset role';
  assert (select count(*) from public.outbox_events o where o.organization_id = org and o.aggregate_id = e1) = ev,
    'mesmo status não registra evento'; n := n + 1;
  execute 'set local role authenticated';
  perform public.set_employee_access_status(e1, 'active');
  execute 'reset role';
  -- (dentro da transação todo evento tem o mesmo created_at: o da ficha é achado pelo conteúdo)
  assert (select count(*) from public.outbox_events o where o.organization_id = org and o.aggregate_id = e1) = ev + 1
     and (select count(*) from public.outbox_events o
           where o.organization_id = org and o.aggregate_id = e1 and o.event_type = 'user.access_reactivated'
             and o.payload ->> 'previous_status' = 'suspended' and not (o.payload ? 'bulk')) = 1,
    'troca real registra evento com o status anterior'; n := n + 1;

  -- ------------------------------------------------------------- B5 permissão e ação inválida
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.bulk_set_employee_access_status(org, array[e1], 'active');
  exception when insufficient_privilege then ok := true;
  end;
  execute 'reset role';
  assert ok, 'sem permissão é recusado'; n := n + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.bulk_set_employee_access_status(org, array[e1], 'removed');
  exception when invalid_parameter_value then ok := true;
  end;
  execute 'reset role';
  assert ok, 'remover não é ação em massa'; n := n + 1;

  raise exception 'ROLLBACK_TESTES 34 OK (% verificações)', n;
end $t$;
