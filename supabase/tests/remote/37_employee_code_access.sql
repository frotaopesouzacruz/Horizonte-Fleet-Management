-- =============================================================================
-- 37 · Usuários › acesso por matrícula (perfil Operacional)
--
-- Suíte transacional: cria, DENTRO da transação, perfis organizacionais,
-- colaboradores, CPFs e contas de teste, e termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, então nada sobrevive.
-- Seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/37_employee_code_access.sql
--   → a última linha deve ser "ROLLBACK_TESTES 37 OK (<n> verificações)".
--
-- O que protege:
--   A1  perfil por matrícula: a preparação não exige e-mail, devolve
--       login_method = employee_code, a matrícula, o nome e a senha inicial =
--       6 primeiros dígitos do CPF; sem CPF, recusa (22023) citando o CPF
--   A2  perfil por e-mail: sem e-mail recusa; com e-mail devolve o e-mail e
--       nenhuma senha
--   A3  a assinatura antiga (prepare_employee_access) continua respondendo
--   A4  com a conta criada, a preparação devolve a conta e não reemite a senha
--   A5  redefinir senha inicial: só para conta por matrícula existente; devolve
--       a senha inicial e registra user.initial_password_issued com o ator;
--       recusa perfil por e-mail, quem não tem conta e acesso removido
--   A6  sem users.manage_access: recusado (42501) nas duas funções
--   A7  employee_directory expõe login_method
--   A8  a conta por matrícula nasce ativa; a por e-mail nasce convidada e é a
--       própria pessoa que a ativa ao definir a senha (accept_my_invitations),
--       com evento user.invitation_accepted
-- =============================================================================
do $t$
declare
  org      uuid;
  adm      uuid;
  bp_code  uuid;
  bp_mail  uuid;
  e_code   uuid;  -- matrícula, com CPF
  e_nocpf  uuid;  -- matrícula, sem CPF
  e_mail   uuid;  -- e-mail, sem e-mail cadastrado (depois com)
  e_rem    uuid;  -- matrícula, acesso removido
  u_new    uuid := gen_random_uuid();
  u_rem    uuid := gen_random_uuid();
  u_mail   uuid := gen_random_uuid();
  v_ms2    uuid;
  r        record;
  n        int := 0;
  ok       boolean;
  ev       int;
  v_ms     uuid;
begin
  select m.organization_id, m.user_id into org, adm
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.status = 'active' and ro.code = 'administrador'
   order by m.created_at limit 1;
  if org is null then raise exception 'sem Administrador ativo para testar'; end if;

  insert into public.business_profiles (organization_id, name, login_method)
  values (org, 'Teste 37 Matrícula', 'employee_code') returning id into bp_code;
  insert into public.business_profiles (organization_id, name, login_method)
  values (org, 'Teste 37 E-mail', 'email') returning id into bp_mail;

  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T37-1', 'Teste 37 Matrícula com CPF') returning id into e_code;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T37-2', 'Teste 37 Matrícula sem CPF') returning id into e_nocpf;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T37-3', 'Teste 37 E-mail') returning id into e_mail;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T37-4', 'Teste 37 Removido') returning id into e_rem;

  insert into public.employee_assignments (organization_id, employee_id, business_profile_id) values
    (org, e_code, bp_code), (org, e_nocpf, bp_code), (org, e_mail, bp_mail), (org, e_rem, bp_code);
  insert into public.employee_private_data (employee_id, organization_id, cpf) values
    (e_code, org, '99999999901'), (e_rem, org, '99999999902')
  on conflict (employee_id) do update set cpf = excluded.cpf;

  -- --------------------------------------------------------------- A1
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.prepare_employee_access_v2(e_code, array[]::uuid[], array[]::uuid[]);
  execute 'reset role';
  assert r.login_method = 'employee_code', 'A1 login_method: ' || coalesce(r.login_method, 'null'); n := n + 1;
  assert r.email is null, 'A1 o e-mail deve ser nulo'; n := n + 1;
  assert r.employee_code = 'T37-1' and r.full_name = 'Teste 37 Matrícula com CPF', 'A1 matrícula e nome'; n := n + 1;
  assert r.initial_password = '999999', 'A1 senha inicial = 6 primeiros dígitos do CPF: ' || coalesce(r.initial_password, 'null'); n := n + 1;
  assert r.membership_id is null and r.account_user_id is null, 'A1 sem conta'; n := n + 1;

  execute 'set local role authenticated';
  begin
    perform * from public.prepare_employee_access_v2(e_nocpf, array[]::uuid[], array[]::uuid[]);
    ok := false;
  exception when invalid_parameter_value then
    ok := sqlerrm like '%CPF%';
  end;
  execute 'reset role';
  assert ok, 'A1 sem CPF: recusa citando o CPF'; n := n + 1;

  -- --------------------------------------------------------------- A2
  execute 'set local role authenticated';
  begin
    perform * from public.prepare_employee_access_v2(e_mail, array[]::uuid[], array[]::uuid[]);
    ok := false;
  exception when invalid_parameter_value then
    ok := sqlerrm ilike '%e-mail%';
  end;
  execute 'reset role';
  assert ok, 'A2 perfil por e-mail sem e-mail: recusa'; n := n + 1;

  update public.employees set corporate_email = 't37-3@teste37.invalid' where id = e_mail;
  execute 'set local role authenticated';
  select * into r from public.prepare_employee_access_v2(e_mail, array[]::uuid[], array[]::uuid[]);
  execute 'reset role';
  assert r.login_method = 'email' and r.email = 't37-3@teste37.invalid', 'A2 e-mail devolvido'; n := n + 1;
  assert r.initial_password is null, 'A2 sem senha inicial no perfil por e-mail'; n := n + 1;

  -- --------------------------------------------------------------- A3
  execute 'set local role authenticated';
  select * into r from public.prepare_employee_access(e_code, array[]::uuid[], array[]::uuid[]);
  execute 'reset role';
  assert r.organization_id = org and r.email is null and r.membership_id is null, 'A3 assinatura antiga responde'; n := n + 1;

  -- --------------------------------------------------------------- A4
  insert into auth.users (id) values (u_new), (u_rem);
  execute 'set local role authenticated';
  v_ms := public.grant_employee_access_v2(e_code, u_new, array[]::uuid[], array[]::uuid[]);
  select * into r from public.prepare_employee_access_v2(e_code, array[]::uuid[], array[]::uuid[]);
  execute 'reset role';
  assert r.membership_id = v_ms and r.account_user_id = u_new, 'A4 conta encontrada'; n := n + 1;
  assert r.initial_password is null, 'A4 a senha inicial não é reemitida na preparação'; n := n + 1;

  -- --------------------------------------------------------------- A5
  select count(*) into ev from public.outbox_events o
   where o.organization_id = org and o.event_type = 'user.initial_password_issued';
  execute 'set local role authenticated';
  select * into r from public.employee_code_initial_password(e_code);
  execute 'reset role';
  assert r.initial_password = '999999' and r.account_user_id = u_new and r.employee_code = 'T37-1', 'A5 senha inicial reemitida'; n := n + 1;
  assert (select count(*) from public.outbox_events o
           where o.organization_id = org and o.event_type = 'user.initial_password_issued') = ev + 1, 'A5 evento registrado'; n := n + 1;
  assert exists (select 1 from public.outbox_events o
                  where o.organization_id = org and o.event_type = 'user.initial_password_issued'
                    and o.aggregate_id = e_code and (o.payload ->> 'actor_user_id')::uuid = adm), 'A5 evento com o ator'; n := n + 1;

  execute 'set local role authenticated';
  begin
    perform * from public.employee_code_initial_password(e_mail);
    ok := false;
  exception when invalid_parameter_value then
    ok := sqlerrm ilike '%e-mail%';
  end;
  assert ok, 'A5 perfil por e-mail: recusa'; n := n + 1;
  begin
    perform * from public.employee_code_initial_password(e_nocpf);
    ok := false;
  exception when invalid_parameter_value then
    ok := sqlerrm ilike '%não possui conta%';
  end;
  assert ok, 'A5 sem conta: recusa'; n := n + 1;
  execute 'reset role';

  insert into public.organization_memberships (organization_id, user_id, status, employee_id)
  values (org, u_rem, 'removed', e_rem);
  execute 'set local role authenticated';
  begin
    perform * from public.employee_code_initial_password(e_rem);
    ok := false;
  exception when invalid_parameter_value then
    ok := sqlerrm ilike '%removido%';
  end;
  execute 'reset role';
  assert ok, 'A5 acesso removido: recusa'; n := n + 1;

  -- --------------------------------------------------------------- A6
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform * from public.prepare_employee_access_v2(e_code, array[]::uuid[], array[]::uuid[]);
    ok := false;
  exception when insufficient_privilege then
    ok := true;
  end;
  assert ok, 'A6 preparação sem permissão: 42501'; n := n + 1;
  begin
    perform * from public.employee_code_initial_password(e_code);
    ok := false;
  exception when insufficient_privilege then
    ok := true;
  end;
  assert ok, 'A6 senha inicial sem permissão: 42501'; n := n + 1;
  execute 'reset role';

  -- --------------------------------------------------------------- A7
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert (select d.login_method from public.employee_directory d where d.id = e_code) = 'employee_code', 'A7 diretório: matrícula'; n := n + 1;
  assert (select d.login_method from public.employee_directory d where d.id = e_mail) = 'email', 'A7 diretório: e-mail'; n := n + 1;
  execute 'reset role';

  -- --------------------------------------------------------------- A8
  assert (select m.status from public.organization_memberships m where m.id = v_ms) = 'active'
     and (select m.joined_at from public.organization_memberships m where m.id = v_ms) is not null,
     'A8 conta por matrícula nasce ativa'; n := n + 1;

  insert into auth.users (id) values (u_mail);
  execute 'set local role authenticated';
  v_ms2 := public.grant_employee_access_v2(e_mail, u_mail, array[]::uuid[], array[]::uuid[]);
  execute 'reset role';
  assert (select m.status from public.organization_memberships m where m.id = v_ms2) = 'invited', 'A8 conta por e-mail nasce convidada'; n := n + 1;

  select count(*) into ev from public.outbox_events o
   where o.organization_id = org and o.event_type = 'user.invitation_accepted';
  perform set_config('request.jwt.claims', json_build_object('sub', u_mail, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert public.accept_my_invitations() = 1, 'A8 aceita o próprio convite'; n := n + 1;
  assert public.accept_my_invitations() = 0, 'A8 segunda vez: nada a aceitar'; n := n + 1;
  execute 'reset role';
  assert (select m.status from public.organization_memberships m where m.id = v_ms2) = 'active'
     and (select m.joined_at from public.organization_memberships m where m.id = v_ms2) is not null,
     'A8 convite aceito vira ativo'; n := n + 1;
  assert (select count(*) from public.outbox_events o
           where o.organization_id = org and o.event_type = 'user.invitation_accepted' and o.aggregate_id = e_mail) = 1
     and (select count(*) from public.outbox_events o
           where o.organization_id = org and o.event_type = 'user.invitation_accepted') = ev + 1,
     'A8 evento de convite aceito'; n := n + 1;

  raise exception 'ROLLBACK_TESTES 37 OK (% verificações)', n;
end;
$t$;
