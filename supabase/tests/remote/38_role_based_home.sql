-- =============================================================================
-- 38 · Home por perfil: Início do Operacional v2 (ações de hoje, meu veículo,
--      pendências, histórico recente e aplicativos habilitados)
--
-- Suíte transacional: cria, DENTRO da transação, operação, BR, fidelização,
-- obrigação de hoje, vistoria devolvida, checklist e contas de teste, e
-- termina em `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, então nada
-- sobrevive. Seguro em produção.
--
--   psql -v ON_ERROR_STOP=0 -f supabase/tests/remote/38_role_based_home.sql
--   → a última linha deve ser "ROLLBACK_TESTES 38 OK (<n> verificações)".
--
-- O que protege:
--   H1  o contrato antigo continua (checklists, executions, reports) e a
--       operação do vínculo é devolvida
--   H2  ações de hoje: a obrigação de saída da BR em que a pessoa é titular
--       fidelizada aparece, com placa, BR e status oficial; sem checklist,
--       não está feita
--   H3  meu veículo: o veículo fidelizado de hoje com placa, BR, operação,
--       hodômetro oficial (última leitura) e o último checklist dele
--   H4  pendências: a vistoria MTSR devolvida ao campo de autoria da pessoa
--       aparece, com o motivo; a validada não
--   H5  histórico recente: checklist e vistorias da pessoa, da mais recente
--       para a mais antiga, no máximo 5
--   H6  aplicativos: o catálogo oficial, com habilitado = true só para o app
--       vinculado à operação do vínculo
--   H7  quem não é titular fidelizado hoje: sem ações e sem veículo (não
--       inventa nada), e as demais chaves seguem respondendo
-- =============================================================================
do $t$
declare
  org      uuid;
  adm      uuid;
  r_op     uuid;
  v_today  date;
  v_op     uuid;
  v_city   integer;
  v_state  smallint;
  v_opcity uuid;
  v_br     uuid;
  v_veh    uuid;
  v_plate  text;
  v_app    uuid;
  v_ver    uuid;
  v_fa     uuid;
  e_op     uuid;
  e_x      uuid;
  u_op     uuid := gen_random_uuid();
  u_x      uuid := gen_random_uuid();
  m_op     uuid;
  m_x      uuid;
  j        jsonb;
  a        jsonb;
  n        int := 0;
begin
  select m.organization_id, m.user_id into org, adm
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.status = 'active' and ro.code = 'administrador'
   order by m.created_at limit 1;
  if org is null then raise exception 'sem Administrador ativo para testar'; end if;

  select id into r_op from public.roles where organization_id = org and code = 'operacional' and deleted_at is null;
  if r_op is null then raise exception 'perfil Operacional ausente'; end if;

  v_today := private.adherence_today(org);

  select v.id, v.app_id into v_ver, v_app from public.checklist_app_versions v
   where v.organization_id = org and v.status = 'published' order by v.published_at desc limit 1;
  select v.id, v.license_plate into v_veh, v_plate from public.vehicles v
   where v.organization_id = org and v.deleted_at is null and v.license_plate is not null order by v.created_at limit 1;
  if v_ver is null or v_veh is null then raise exception 'sem versão publicada do Check List ou sem veículo para testar'; end if;

  select c.id, c.state_id into v_city, v_state from public.cities c order by c.id limit 1;

  -- ------------------------------------------------------------- operação, BR, fidelização
  insert into public.operations (organization_id, code, name) values (org, 'T38OP', 'Teste 38 Operação') returning id into v_op;
  insert into public.operation_states (organization_id, operation_id, state_id) values (org, v_op, v_state);
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id) values (org, v_op, v_state, v_city) returning id into v_opcity;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code)
  values (org, v_op, v_opcity, v_state, v_city, 'T38BR') returning id into v_br;

  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T38OP1', 'Teste 38 Motorista') returning id into e_op;
  insert into public.employees (organization_id, employee_code, full_name) values (org, 'T38X', 'Teste 38 Sem fidelização') returning id into e_x;
  insert into public.employee_assignments (organization_id, employee_id, operation_id) values (org, e_op, v_op), (org, e_x, v_op);

  insert into public.fidelization_assignments (organization_id, operation_br_id, vehicle_id, start_date, status)
  values (org, v_br, v_veh, v_today - 10, 'confirmed') returning id into v_fa;
  insert into public.fidelization_drivers (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, status)
  values (org, v_fa, e_op, 'primary', v_today - 10, 'confirmed');

  insert into public.vehicle_odometer_readings (organization_id, vehicle_id, reading_date, odometer_km, source)
  values (org, v_veh, v_today - 1, 123456, 'manual_correction');

  -- obrigação oficial de hoje (saída), sem checklist conciliado
  insert into public.checklist_obligations (organization_id, vehicle_id, operational_date, checklist_context, journey_seq,
    operation_id, operation_br_id, expected_at, deadline_at, source, is_active, license_plate_snapshot)
  values (org, v_veh, v_today, 'saida', 1, v_op, v_br, (v_today::timestamp at time zone 'America/Sao_Paulo') + interval '5 hours',
          (v_today::timestamp at time zone 'America/Sao_Paulo') + interval '23 hours', 'fidelization', true, v_plate);

  -- app habilitado para a operação (só o Check List)
  insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled) values (org, v_app, v_op, true);

  -- ------------------------------------------------------------- contas
  insert into auth.users (id) values (u_op), (u_x);
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (org, u_op, 'active', e_op) returning id into m_op;
  insert into public.organization_memberships (organization_id, user_id, status, employee_id) values (org, u_x, 'active', e_x) returning id into m_x;
  insert into public.membership_roles (membership_id, role_id) values (m_op, r_op), (m_x, r_op);

  -- ------------------------------------------------------------- atividades da pessoa
  insert into public.checklist_executions (organization_id, app_id, version_id, user_id, employee_id, vehicle_id,
    operation_id, checklist_type, operational_date, status, idempotency_key, license_plate_snapshot)
  values (org, v_app, v_ver, u_op, e_op, v_veh, v_op, 'retorno', v_today - 1, 'draft', 't38-' || gen_random_uuid(), v_plate);
  update public.checklist_executions set status = 'submitted', submitted_at = now() - interval '20 hours', duration_seconds = 200
   where organization_id = org and idempotency_key like 't38-%';

  insert into public.mtsr_inspections (organization_id, protocol, vehicle_id, license_plate_snapshot, inspector_user_id,
    inspector_employee_id, inspection_date, inspected_at, submitted_at, client_submission_id, status, review_reason, reviewed_at)
  values (org, 'T38-MTSR-1', v_veh, v_plate, u_op, e_op, v_today - 2, now() - interval '2 days', now() - interval '47 hours',
          gen_random_uuid(), 'retornada', 'Refazer a verificação do extintor', now() - interval '1 day'),
         (org, 'T38-MTSR-2', v_veh, v_plate, u_op, e_op, v_today - 3, now() - interval '3 days', now() - interval '3 days',
          gen_random_uuid(), 'validada', null, now() - interval '2 days');

  -- ============================================================= H1–H6 (motorista fidelizado)
  perform set_config('request.jwt.claims', json_build_object('sub', u_op, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_operational_home(org, extract(year from v_today)::int, extract(month from v_today)::int);
  execute 'reset role';

  assert (j -> 'checklists' ->> 'total')::int = 1, 'H1 total de checklists: ' || (j -> 'checklists')::text; n := n + 1;
  assert (j ->> 'operation_id')::uuid = v_op, 'H1 operação do vínculo'; n := n + 1;
  assert j ? 'reports', 'H1 chave reports continua'; n := n + 1;

  assert jsonb_typeof(j -> 'today_actions') = 'array' and jsonb_array_length(j -> 'today_actions') = 1,
         'H2 uma obrigação de hoje: ' || coalesce((j -> 'today_actions')::text, 'null'); n := n + 1;
  a := j -> 'today_actions' -> 0;
  assert a ->> 'context' = 'saida' and a ->> 'br_code' = 'T38BR' and a ->> 'license_plate' = v_plate
         and (a ->> 'done')::boolean = false and a ->> 'status' is not null,
         'H2 saída da BR, não feita: ' || a::text; n := n + 1;

  assert j -> 'vehicle' ->> 'license_plate' = v_plate and j -> 'vehicle' ->> 'br_code' = 'T38BR'
         and j -> 'vehicle' ->> 'operation_name' = 'Teste 38 Operação', 'H3 meu veículo: ' || coalesce((j -> 'vehicle')::text, 'null'); n := n + 1;
  assert (j -> 'vehicle' ->> 'odometer_km')::int = 123456, 'H3 hodômetro oficial'; n := n + 1;
  assert j -> 'vehicle' -> 'last_checklist' ->> 'context' = 'retorno'
         and (j -> 'vehicle' -> 'last_checklist' ->> 'mine')::boolean, 'H3 último checklist do veículo'; n := n + 1;
  assert j -> 'vehicle' -> 'maintenance' is null or jsonb_typeof(j -> 'vehicle' -> 'maintenance') = 'null', 'H3 sem manutenção aberta'; n := n + 1;

  assert jsonb_array_length(j -> 'pending') = 1 and j -> 'pending' -> 0 ->> 'kind' = 'mtsr'
         and j -> 'pending' -> 0 ->> 'protocol' = 'T38-MTSR-1'
         and j -> 'pending' -> 0 ->> 'reason' = 'Refazer a verificação do extintor', 'H4 vistoria devolvida: ' || (j -> 'pending')::text; n := n + 1;

  assert jsonb_array_length(j -> 'recent') = 3, 'H5 três atividades: ' || (j -> 'recent')::text; n := n + 1;
  assert j -> 'recent' -> 0 ->> 'kind' = 'checklist' and j -> 'recent' -> 1 ->> 'protocol' = 'T38-MTSR-1'
         and j -> 'recent' -> 2 ->> 'protocol' = 'T38-MTSR-2', 'H5 ordem da mais recente: ' || (j -> 'recent')::text; n := n + 1;

  assert jsonb_array_length(j -> 'apps') >= 1, 'H6 catálogo de apps'; n := n + 1;
  assert exists (select 1 from jsonb_array_elements(j -> 'apps') x where x ->> 'code' = 'checklist_frota' and (x ->> 'enabled')::boolean),
         'H6 Check List habilitado para a operação: ' || (j -> 'apps')::text; n := n + 1;
  assert not exists (select 1 from jsonb_array_elements(j -> 'apps') x where x ->> 'code' <> 'checklist_frota' and (x ->> 'enabled')::boolean),
         'H6 os demais apps não estão habilitados para a operação'; n := n + 1;

  -- ============================================================= H7 (sem fidelização)
  perform set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_operational_home(org, extract(year from v_today)::int, extract(month from v_today)::int);
  execute 'reset role';
  assert jsonb_typeof(j -> 'today_actions') = 'array' and jsonb_array_length(j -> 'today_actions') = 0, 'H7 sem ações'; n := n + 1;
  assert jsonb_typeof(j -> 'vehicle') = 'null', 'H7 sem veículo'; n := n + 1;
  assert jsonb_array_length(j -> 'pending') = 0 and jsonb_array_length(j -> 'recent') = 0, 'H7 sem pendências nem histórico'; n := n + 1;
  assert jsonb_array_length(j -> 'apps') >= 1, 'H7 apps continuam listados'; n := n + 1;

  raise exception 'ROLLBACK_TESTES 38 OK (% verificações)', n;
end;
$t$;
