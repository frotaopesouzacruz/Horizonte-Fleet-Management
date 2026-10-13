-- =============================================================================
-- 35 · Pós-login: o início de cada perfil (Operacional e Liderança de Operações)
--
-- Suíte transacional: cria, DENTRO da transação, colaboradores, contas,
-- vínculos, uma operação e checklists de teste, e termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, então nada sobrevive.
-- Seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/35_portals_post_login.sql
--   → a última linha deve ser "ROLLBACK_TESTES 35 OK (<n> verificações)".
--
-- O que protege:
--   P1  o portal sai dos perfis do vínculo: só Operacional → operational;
--       Liderança (com ou sem Operacional) → leadership; Liderança + Gestor de
--       Frota, Administrador ou nenhum perfil → management; quem não pertence
--       à organização é recusado
--   P2  `view_own` não depende de `view`: o perfil Operacional oficial volta a
--       poder ser salvo; as demais dependências continuam valendo
--   P3  "Meu resumo": só os checklists ENVIADOS do colaborador da conta
--       (rascunho e checklist de outra pessoa ficam fora), mês e total
--       separados, sem permissão é recusado, competência inválida é recusada
--   P4  Portal da Liderança: operações do vínculo, responsabilidade vigente,
--       equipe direta ativa (inativo e excluído ficam fora),
--       hoje e semana (segunda até hoje) contados certo; o Operacional não
--       abre o portal da liderança
-- =============================================================================
do $t$
declare
  org      uuid;
  adm      uuid;
  r_op     uuid; r_lid uuid; r_gf uuid;
  v_today  date;
  v_week   date;
  v_mfrom  date;
  v_op     uuid;
  v_veh    uuid;
  v_app    uuid;
  v_ver    uuid;
  e_op uuid; e_lid uuid; e_m1 uuid; e_m2 uuid; e_m3 uuid; e_m4 uuid; e_m5 uuid; e_x uuid;
  u_op   uuid := gen_random_uuid(); u_lid  uuid := gen_random_uuid(); u_both uuid := gen_random_uuid();
  u_mgmt uuid := gen_random_uuid(); u_none uuid := gen_random_uuid(); u_out  uuid := gen_random_uuid();
  m_op uuid; m_lid uuid; m_both uuid; m_mgmt uuid;
  v_codes  text[];
  j        jsonb;
  n        int := 0;
  ok       boolean;
begin
  select m.organization_id, m.user_id into org, adm
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.status = 'active' and ro.code = 'administrador'
   order by m.created_at limit 1;
  if org is null then raise exception 'sem Administrador ativo para testar'; end if;

  select id into r_op  from public.roles where organization_id = org and code = 'operacional'         and deleted_at is null;
  select id into r_lid from public.roles where organization_id = org and code = 'lideranca_operacoes' and deleted_at is null;
  select id into r_gf  from public.roles where organization_id = org and code = 'gestor_frota'        and deleted_at is null;
  if r_op is null or r_lid is null or r_gf is null then raise exception 'perfis oficiais ausentes'; end if;

  v_today := private.adherence_today(org);
  v_week  := v_today - (extract(isodow from v_today)::int - 1);
  v_mfrom := date_trunc('month', v_today)::date;

  select v.id, v.app_id into v_ver, v_app from public.checklist_app_versions v
   where v.organization_id = org and v.status = 'published' order by v.published_at desc limit 1;
  select id into v_veh from public.vehicles where organization_id = org and deleted_at is null order by created_at limit 1;
  if v_ver is null or v_veh is null then raise exception 'sem versão publicada do Check List ou sem veículo para testar'; end if;

  insert into public.operations (organization_id, code, name) values (org, 'T35OP', 'Teste 35 Operação') returning id into v_op;

  -- ------------------------------------------------------------- colaboradores
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35OP1', 'Teste 35 Operador') returning id into e_op;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35LID', 'Teste 35 Líder') returning id into e_lid;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35M1', 'Teste 35 A Hoje') returning id into e_m1;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35M2', 'Teste 35 B Semana passada') returning id into e_m2;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35M3', 'Teste 35 C Nunca') returning id into e_m3;
  insert into public.employees (organization_id, employee_code, full_name, employment_status)
  values (org, 'T35M4', 'Teste 35 D Inativo', 'inactive') returning id into e_m4;
  insert into public.employees (organization_id, employee_code, full_name, deleted_at)
  values (org, 'T35M5', 'Teste 35 E Excluído', now()) returning id into e_m5;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T35X', 'Teste 35 Outra pessoa') returning id into e_x;

  insert into public.employee_assignments (organization_id, employee_id, operation_id, manager_employee_id) values
    (org, e_m1, v_op, e_lid), (org, e_m2, v_op, e_lid), (org, e_m3, v_op, e_lid),
    (org, e_m4, v_op, e_lid), (org, e_m5, v_op, e_lid), (org, e_op, v_op, null), (org, e_lid, v_op, null);

  -- ------------------------------------------------------------- contas e perfis
  insert into auth.users (id) values (u_op), (u_lid), (u_both), (u_mgmt), (u_none), (u_out);
  insert into public.organization_memberships (organization_id, user_id, status, employee_id)
  values (org, u_op, 'active', e_op) returning id into m_op;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id)
  values (org, u_lid, 'active', e_lid) returning id into m_lid;
  insert into public.organization_memberships (organization_id, user_id, status)
  values (org, u_both, 'active') returning id into m_both;
  insert into public.organization_memberships (organization_id, user_id, status)
  values (org, u_mgmt, 'active') returning id into m_mgmt;
  insert into public.organization_memberships (organization_id, user_id, status) values (org, u_none, 'active');
  insert into public.membership_roles (membership_id, role_id) values
    (m_op, r_op), (m_lid, r_lid), (m_both, r_lid), (m_both, r_op), (m_mgmt, r_lid), (m_mgmt, r_gf);
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (org, m_lid, v_op);

  -- responsabilidade de apoio na operação (apoio não disputa o titular de ninguém)
  insert into public.leadership_assignments (organization_id, employee_id, scope_level, operation_id, responsibility_type, effective_from)
  values (org, e_lid, 'operation', v_op, 'support', v_today - 1);

  -- ------------------------------------------------------------- checklists (rascunho → enviado)
  -- do Operador: hoje, dia 1 do mês, véspera do mês (fora) e um rascunho de hoje
  insert into public.checklist_executions (organization_id, app_id, version_id, user_id, employee_id, vehicle_id,
    operation_id, checklist_type, operational_date, status, idempotency_key)
  values
    (org, v_app, v_ver, u_op, e_op,  v_veh, v_op, 'saida',   v_today,     'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_op,  v_veh, v_op, 'retorno', v_mfrom,     'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_op,  v_veh, v_op, 'saida',   v_mfrom - 1, 'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_x,   v_veh, v_op, 'saida',   v_today,     'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_m1,  v_veh, v_op, 'saida',   v_today,     'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_m2,  v_veh, v_op, 'saida',   v_week - 1,  'draft', 't35-' || gen_random_uuid()),
    (org, v_app, v_ver, u_op, e_m4,  v_veh, v_op, 'saida',   v_today,     'draft', 't35-' || gen_random_uuid());
  update public.checklist_executions set status = 'submitted', submitted_at = now(), duration_seconds = 180
   where organization_id = org and idempotency_key like 't35-%';
  -- o rascunho que fica rascunho
  insert into public.checklist_executions (organization_id, app_id, version_id, user_id, employee_id, vehicle_id,
    operation_id, checklist_type, operational_date, status, idempotency_key)
  values (org, v_app, v_ver, u_op, e_op, v_veh, v_op, 'retorno', v_today, 'draft', 't35d-' || gen_random_uuid());

  -- ============================================================= P1 portal por perfil
  perform set_config('request.jwt.claims', json_build_object('sub', u_op, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'operational' and j ->> 'employee_code' = 'T35OP1', 'só Operacional: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_lid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'leadership', 'Liderança: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_both, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'leadership' and j -> 'employee_code' = 'null'::jsonb, 'Liderança + Operacional, sem colaborador: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgmt, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'management', 'perfil a mais nunca tira telas: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'management', 'sem perfil: navegação de sempre: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.current_user_portal(org);
  execute 'reset role';
  assert j ->> 'kind' = 'management', 'Administrador: ' || j::text; n := n + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.current_user_portal(org);
  exception when insufficient_privilege then ok := true;
  end;
  execute 'reset role';
  assert ok, 'quem não pertence à organização é recusado'; n := n + 1;

  -- ============================================================= P2 view_own sem view
  assert private.permission_dependency('adherence.view_own') is null
     and private.permission_dependency('action_plans.view_own') is null
     and private.permission_dependency('adherence.request') = 'adherence.view'
     and private.permission_dependency('applications.checklist_fleet.view_own') = 'applications.view',
    'dependências: view_own livre, as demais mantidas'; n := n + 1;

  select array_agg(p.code order by p.code) into v_codes
    from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
   where rp.role_id = r_op;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := true;
  begin
    perform public.set_role_permissions(r_op, v_codes, 'Teste 35: salvar o perfil Operacional como está');
  exception when check_violation then ok := false;
  end;
  execute 'reset role';
  assert ok, 'o perfil Operacional oficial (view_own sem view) pode ser salvo'; n := n + 1;
  assert (select array_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
           where rp.role_id = r_op) = v_codes, 'salvar como está não muda nada'; n := n + 1;

  -- ============================================================= P3 Meu resumo
  perform set_config('request.jwt.claims', json_build_object('sub', u_op, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_operational_home(org, extract(year from v_today)::int, extract(month from v_today)::int);
  execute 'reset role';
  assert (j -> 'checklists' ->> 'total')::int = 3, 'total: só os enviados da própria pessoa: ' || (j -> 'checklists')::text; n := n + 1;
  assert (j -> 'checklists' ->> 'month_total')::int = 2 and jsonb_array_length(j -> 'executions') = 2,
    'mês: 2 enviados na competência: ' || j::text; n := n + 1;
  assert (j -> 'checklists' ->> 'last_date')::date = v_today and j ->> 'today' = v_today::text,
    'último em hoje: ' || (j -> 'checklists')::text; n := n + 1;
  assert not exists (select 1 from jsonb_array_elements(j -> 'executions') e where (e ->> 'date')::date < v_mfrom),
    'a véspera do mês fica fora da lista do mês'; n := n + 1;
  assert j -> 'employee' ->> 'code' = 'T35OP1' and j -> 'employee' ->> 'operation_name' = 'Teste 35 Operação',
    'identidade: matrícula e operação vigentes: ' || (j -> 'employee')::text; n := n + 1;
  assert (j ->> 'executions_truncated')::boolean is false, 'lista do mês completa'; n := n + 1;
  -- o Operacional oficial tem action_plans.view_own: os apontamentos voltam (zerados aqui)
  assert j -> 'reports' is not null and (j -> 'reports' ->> 'window_days')::int = 90, 'apontamentos com a janela de 90 dias: ' || j::text; n := n + 1;

  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.my_operational_home(org, 2026, 13);
  exception when invalid_parameter_value then ok := true;
  end;
  execute 'reset role';
  assert ok, 'competência inválida é recusada'; n := n + 1;

  -- conta sem colaborador: zeros honestos, nenhuma execução de outra pessoa
  perform set_config('request.jwt.claims', json_build_object('sub', u_both, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_operational_home(org, extract(year from v_today)::int, extract(month from v_today)::int);
  execute 'reset role';
  assert j -> 'employee' = 'null'::jsonb and (j -> 'checklists' ->> 'total')::int = 0 and jsonb_array_length(j -> 'executions') = 0,
    'sem colaborador: nada de ninguém: ' || j::text; n := n + 1;

  -- sem applications.checklist_fleet.view_own (Liderança + Gestor de Frota não tem): recusado
  perform set_config('request.jwt.claims', json_build_object('sub', u_none, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.my_operational_home(org, extract(year from v_today)::int, extract(month from v_today)::int);
  exception when insufficient_privilege then ok := true;
  end;
  execute 'reset role';
  assert ok, 'sem permissão para os próprios checklists é recusado'; n := n + 1;

  -- ============================================================= P4 Portal da Liderança
  perform set_config('request.jwt.claims', json_build_object('sub', u_lid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_leadership_home(org);
  execute 'reset role';
  assert (j -> 'scope' ->> 'all_operations')::boolean is false
     and jsonb_array_length(j -> 'scope' -> 'operations') = 1
     and j -> 'scope' -> 'operations' -> 0 ->> 'name' = 'Teste 35 Operação',
    'operações: só as do vínculo: ' || (j -> 'scope')::text; n := n + 1;
  assert jsonb_array_length(j -> 'scope' -> 'responsibilities') = 1
     and j -> 'scope' -> 'responsibilities' -> 0 ->> 'responsibility_type' = 'support',
    'responsabilidade vigente: ' || (j -> 'scope' -> 'responsibilities')::text; n := n + 1;
  assert (j -> 'team' ->> 'members')::int = 3, 'equipe direta ativa (sem inativo nem excluído): ' || (j -> 'team')::text; n := n + 1;
  assert (j -> 'team' ->> 'with_checklist_today')::int = 1 and (j -> 'team' ->> 'without_checklist_today')::int = 2,
    'hoje: 1 com, 2 sem: ' || (j -> 'team')::text; n := n + 1;
  assert (j -> 'team' ->> 'without_checklist_week')::int = 2
     and j -> 'team' -> 'without_week_names' = '["Teste 35 B Semana passada", "Teste 35 C Nunca"]'::jsonb,
    'semana (segunda até hoje): a semana passada não conta: ' || (j -> 'team')::text; n := n + 1;
  assert (select (e ->> 'last_date')::date from jsonb_array_elements(j -> 'team' -> 'list') e
           where e ->> 'code' = 'T35M2') = v_week - 1,
    'último checklist de quem não fez na semana'; n := n + 1;
  assert j ->> 'week_from' = v_week::text and j ->> 'today' = v_today::text, 'semana começa na segunda'; n := n + 1;

  -- o Operacional não abre o portal da liderança
  perform set_config('request.jwt.claims', json_build_object('sub', u_op, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.my_leadership_home(org);
  exception when insufficient_privilege then ok := true;
  end;
  execute 'reset role';
  assert ok, 'Operacional não abre o portal da liderança'; n := n + 1;

  -- Liderança sem colaborador vinculado: escopo sim, equipe não (null, não zero)
  perform set_config('request.jwt.claims', json_build_object('sub', u_both, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_leadership_home(org);
  execute 'reset role';
  assert j -> 'team' = 'null'::jsonb and j -> 'employee' = 'null'::jsonb
     and jsonb_array_length(j -> 'scope' -> 'operations') = 0,
    'sem colaborador e sem operação liberada: nada inventado: ' || j::text; n := n + 1;

  raise exception 'ROLLBACK_TESTES 35 OK (% verificações)', n;
end $t$;
