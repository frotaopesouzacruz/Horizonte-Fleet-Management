-- =============================================================================
-- PÓS-LOGIN · O INÍCIO DE CADA PERFIL (Operacional e Liderança de Operações)
--
-- Até aqui toda conta caía no mesmo Dashboard e via o menu inteiro filtrado
-- por permissão. Para o Operacional isso significava enxergar Operações e
-- Cadastro de frotas — as permissões `operations.view` e `vehicles.view` são
-- dele porque o Check List de Frota precisa listar operações e placas (RLS),
-- não porque essas telas sejam da sua alçada.
--
-- O HFC resolve isso com um portal por perfil: o Operacional entra no "Meu
-- resumo" (apps, meus checklists, minhas tratativas e o calendário) e a
-- Liderança no "Portal da Liderança" (a operação dela hoje, prioridades,
-- pneus, equipe). Esta migration traz o que o HFM precisa do banco para o
-- mesmo desenho, sem mexer em nenhuma permissão:
--
--   1. `view_own` deixa de exigir `view`. "Ver o que é meu" é uma leitura
--      MENOR que "ver tudo", não uma ação sobre ela — e a regra antiga impedia
--      o Administrador de salvar o próprio perfil Operacional oficial
--      (`adherence.view_own` sem `adherence.view`).
--   2. `current_user_portal`: qual início a conta recebe, decidido pelos
--      perfis do vínculo ativo — no servidor, nunca por um parâmetro.
--   3. `my_operational_home`: os números do "Meu resumo" e os checklists do
--      mês para o calendário — só da própria pessoa.
--   4. `my_leadership_home`: o escopo (operações liberadas e
--      responsabilidades de liderança) e a equipe direta com a execução de
--      hoje e da semana.
--
-- Nada aqui grava. Toda rotina é `security definer` com search_path vazio,
-- resolve a pessoa pela sessão e recusa quem não pertence à organização.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `view_own` é irmã de `view`, não dependente
-- -----------------------------------------------------------------------------
create or replace function private.permission_dependency(p_code text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p_code is null then null
           -- `view` é a própria leitura; `view_own` é a leitura do que é da
           -- pessoa, que existe justamente para quem NÃO recebe `view`.
           when split_part(p_code, '.', 2) in ('view', 'view_own') then null
           when exists (
             select 1 from public.permissions p
              where p.code = split_part(p_code, '.', 1) || '.view'
           ) then split_part(p_code, '.', 1) || '.view'
           else null
         end;
$$;

comment on function private.permission_dependency(text) is
  'The <resource>.view a permission code requires, when the catalogue defines one. '
  '<resource>.view and <resource>.view_own depend on nothing: view_own is the narrower read '
  'given precisely to whoever does not hold view.';

-- -----------------------------------------------------------------------------
-- 2. Qual início a conta recebe
-- -----------------------------------------------------------------------------
-- Leve de propósito: roda a cada requisição, ao lado de
-- `current_user_permissions`. O tipo de portal sai dos PERFIS do vínculo
-- ativo (roles.code), não das permissões — permissões decidem o dado, o
-- perfil decide a casa:
--
--   management  administrador da plataforma; qualquer perfil além de
--               Operacional e Liderança de Operações; ou nenhum perfil
--               (a navegação de sempre, filtrada por permissão)
--   leadership  Liderança de Operações (com ou sem Operacional)
--   operational só Operacional
--
-- Quem acumula Liderança e Gestor de Frota recebe o portal mais amplo: um
-- perfil a mais nunca pode tirar telas de ninguém.
create or replace function public.current_user_portal(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_membership uuid;
  v_employee   uuid;
  v_codes      text[];
  v_kind       text;
  v_code       text;
  v_name       text;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;

  select m.id, m.employee_id into v_membership, v_employee
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
   where m.organization_id = p_organization_id
     and m.user_id = v_uid
     and m.status = 'active'
     and o.status = 'active' and o.deleted_at is null
   limit 1;

  if v_membership is null then
    if private.is_platform_admin() then
      return jsonb_build_object('kind', 'management', 'roles', '[]'::jsonb,
                                'employee_id', null, 'employee_code', null, 'employee_name', null);
    end if;
    raise exception 'Sua conta não pertence a esta organização.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(distinct coalesce(r.code, '') order by coalesce(r.code, '')), array[]::text[])
    into v_codes
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
   where mr.membership_id = v_membership
     and r.deleted_at is null;

  v_kind := case
    when private.is_platform_admin() then 'management'
    when cardinality(v_codes) = 0 then 'management'
    when exists (select 1 from unnest(v_codes) c where c not in ('operacional', 'lideranca_operacoes')) then 'management'
    when 'lideranca_operacoes' = any (v_codes) then 'leadership'
    else 'operational'
  end;

  if v_employee is not null then
    select e.employee_code, e.full_name into v_code, v_name
      from public.employees e
     where e.id = v_employee and e.organization_id = p_organization_id;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'roles', to_jsonb(v_codes),
    'employee_id', v_employee,
    'employee_code', v_code,
    'employee_name', v_name);
end;
$$;

comment on function public.current_user_portal(uuid) is
  'Pós-login: o início que a conta recebe (operational | leadership | management), decidido pelos perfis '
  'do vínculo ativo, e a matrícula do colaborador vinculado. Leve: roda a cada requisição.';

revoke all on function public.current_user_portal(uuid) from public, anon;
grant execute on function public.current_user_portal(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Identidade do colaborador da conta (cargo, operação e filial vigentes)
-- -----------------------------------------------------------------------------
create or replace function private.portal_identity(p_organization_id uuid, p_employee_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', e.id,
           'name', e.full_name,
           'code', e.employee_code,
           'job_position', jp.name,
           'operation_name', op.name,
           'unit_name', u.name)
    from public.employees e
    left join public.employee_assignments a
      on a.employee_id = e.id and a.organization_id = e.organization_id and a.is_current
    left join public.job_positions jp on jp.id = a.job_position_id
    left join public.operations op on op.id = a.operation_id
    left join public.organization_units u on u.id = a.organization_unit_id
   where e.organization_id = p_organization_id
     and e.id = p_employee_id;
$$;

revoke all on function private.portal_identity(uuid, uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Vínculo ativo da sessão (mesma regra de "Minha situação", §63)
-- -----------------------------------------------------------------------------
-- Devolve o colaborador da conta (ou null) e recusa quem não pertence à
-- organização, com organização e perfil ativos.
create or replace function private.portal_member(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found    boolean;
  v_employee uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;

  select true, m.employee_id into v_found, v_employee
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p      on p.user_id = m.user_id
   where m.user_id = auth.uid()
     and m.organization_id = p_organization_id
     and m.status = 'active'
     and o.status = 'active' and o.deleted_at is null
     and p.status = 'active'
   limit 1;

  if not coalesce(v_found, false) then
    raise exception 'Sua conta não pertence a esta organização.' using errcode = 'insufficient_privilege';
  end if;

  return v_employee;
end;
$$;

revoke all on function private.portal_member(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- 3. "Meu resumo" do Operacional
-- -----------------------------------------------------------------------------
-- Os checklists são os do colaborador da conta — a mesma regra de
-- `checklist_my_executions`, que alimenta "Meus checklists" no aplicativo:
-- o número do início e a lista do aplicativo nunca discordam.
--
-- Os apontamentos seguem `action_plan_my_reports` à risca (colaborador OU
-- conta que enviou, só perguntas visíveis ao motorista, últimos 90 dias), e
-- por isso só voltam para quem tem `action_plans.view_own` ou `view`. A
-- janela é a da tela "Meus apontamentos": o cartão leva a uma lista com os
-- mesmos números.
--
-- O calendário do mês recebe as execuções da competência (até 400 — um mês
-- de saída e retorno diários não passa de 62) e a tela as cruza com as
-- obrigações de `adherence_my_situation`; nenhum dia vira "não realizado"
-- por não ter checklist: só uma obrigação oficial vencida é falta.
create or replace function public.my_operational_home(
  p_organization_id uuid, p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_employee    uuid;
  v_from        date;
  v_to          date;
  v_today       date;
  v_report_from date;
  v_checklists  jsonb;
  v_executions  jsonb := '[]'::jsonb;
  v_reports     jsonb;
begin
  if p_organization_id is null or p_year is null or p_month is null
     or p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;

  v_employee := private.portal_member(p_organization_id);

  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.view_own') then
    raise exception 'Você não tem autorização para consultar os próprios checklists.'
      using errcode = 'insufficient_privilege';
  end if;

  v_from  := make_date(p_year, p_month, 1);
  v_to    := (v_from + interval '1 month' - interval '1 day')::date;
  v_today := private.adherence_today(p_organization_id);

  if v_employee is null then
    v_checklists := jsonb_build_object('total', 0, 'month_total', 0, 'last_30_days', 0,
                                       'last_submitted_at', null, 'last_date', null);
  else
    select jsonb_build_object(
             'total',             count(*),
             'month_total',       count(*) filter (where e.operational_date between v_from and v_to),
             'last_30_days',      count(*) filter (where e.operational_date > v_today - 30 and e.operational_date <= v_today),
             'last_submitted_at', max(e.submitted_at),
             'last_date',         max(e.operational_date))
      into v_checklists
      from public.checklist_executions e
     where e.organization_id = p_organization_id
       and e.employee_id = v_employee
       and e.status = 'submitted';

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id,
             'date', x.operational_date,
             'context', x.checklist_type,
             'license_plate', x.license_plate_snapshot,
             'fleet_code', x.fleet_code_snapshot,
             'operation_name', op.name,
             'br_code', b.code,
             'started_at', x.started_at,
             'submitted_at', x.submitted_at,
             'duration_seconds', x.duration_seconds,
             'non_conforming', x.non_conforming_answers,
             'critical_non_conforming', x.critical_non_conforming,
             'source', x.source)
           order by x.operational_date, x.submitted_at), '[]'::jsonb)
      into v_executions
      from (
        select e.* from public.checklist_executions e
         where e.organization_id = p_organization_id
           and e.employee_id = v_employee
           and e.status = 'submitted'
           and e.operational_date between v_from and v_to
         order by e.operational_date, e.submitted_at
         limit 400
      ) x
      left join public.operations op on op.id = x.operation_id
      left join public.operation_brs b on b.id = x.operation_br_id;
  end if;

  if private.has_permission(p_organization_id, 'action_plans.view_own')
     or private.has_permission(p_organization_id, 'action_plans.view') then
    v_report_from := private.maintenance_today(p_organization_id) - 90;
    select jsonb_build_object(
             'window_days',   90,
             'total',         count(*),
             'open',          count(*) filter (where i.status in ('pending', 'in_maintenance', 'needs_action')),
             'resolved',      count(*) filter (where i.status in ('resolved', 'resolved_without_maintenance')),
             'closed_other',  count(*) filter (where i.status in ('improper', 'cancelled')))
      into v_reports
      from public.action_plan_items i
      join public.action_plans p on p.id = i.plan_id
     where i.organization_id = p_organization_id
       and i.operational_date >= v_report_from
       and ((v_employee is not null and i.employee_id = v_employee) or i.user_id = v_uid)
       and coalesce((select prm.driver_visible from public.checklist_action_parameters prm
                      where prm.organization_id = p.organization_id and prm.app_id = p.app_id
                        and prm.question_key = p.question_key and prm.field_key is null), true);
  end if;

  return jsonb_build_object(
    'today', v_today,
    'year', p_year, 'month', p_month, 'date_from', v_from, 'date_to', v_to,
    'employee', case when v_employee is null then null else private.portal_identity(p_organization_id, v_employee) end,
    'checklists', v_checklists,
    'executions', v_executions,
    'executions_truncated', coalesce((v_checklists ->> 'month_total')::int, 0) > jsonb_array_length(v_executions),
    'reports', v_reports);
end;
$$;

comment on function public.my_operational_home(uuid, integer, integer) is
  'Pós-login (Operacional): checklists do colaborador da conta (total, mês, último) e os do mês para o '
  'calendário, e os próprios apontamentos dos últimos 90 dias por situação. Exige '
  'applications.checklist_fleet.view_own; apontamentos só com action_plans.view_own ou view. Só leitura.';

revoke all on function public.my_operational_home(uuid, integer, integer) from public, anon;
grant execute on function public.my_operational_home(uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Portal da Liderança
-- -----------------------------------------------------------------------------
-- A alçada da liderança no HFM tem duas metades, e o portal mostra as duas:
--
--   * o que a conta ENXERGA — as operações liberadas no vínculo
--     (`membership_operation_scopes`, ou todas com `operations.access_all`).
--     É isso que a RLS aplica em Aderência, Pneus, MTSR e nos aplicativos;
--   * pelo que a pessoa RESPONDE — as responsabilidades de liderança vigentes
--     (`leadership_assignments`), que dão o filtro "minha liderança" da
--     Aderência (`leader_employee_id`).
--
-- A equipe é a equipe direta do cadastro (gestor imediato vigente,
-- `employee_assignments.manager_employee_id`), com a execução de checklist de
-- hoje e da semana (segunda até hoje, no fuso da organização). Datas futuras
-- não contam; ninguém é "sem checklist" por um dia que ainda não chegou.
create or replace function public.my_leadership_home(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee  uuid;
  v_today     date;
  v_week_from date;
  v_all       boolean;
  v_ops       jsonb;
  v_resp      jsonb;
  v_team      jsonb;
begin
  v_employee := private.portal_member(p_organization_id);

  if not (private.has_permission(p_organization_id, 'adherence.view')
          or private.has_permission(p_organization_id, 'applications.checklist_fleet.view_details')) then
    raise exception 'Você não tem autorização para consultar a operação da sua liderança.'
      using errcode = 'insufficient_privilege';
  end if;

  v_today     := private.adherence_today(p_organization_id);
  v_week_from := v_today - (extract(isodow from v_today)::int - 1);
  v_all       := private.is_platform_admin()
                 or p_organization_id in (select private.permitted_org_ids('operations.access_all'));

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status)
                            order by o.name), '[]'::jsonb)
    into v_ops
    from public.operations o
   where o.organization_id = p_organization_id
     and o.deleted_at is null
     and o.id in (select private.accessible_operation_ids());

  if v_employee is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'scope_level', la.scope_level,
             'responsibility_type', la.responsibility_type,
             'operation_id', la.operation_id,
             'operation_name', op.name,
             'city_name', c.name,
             'uf', st.uf,
             'br_code', br.code,
             'effective_from', la.effective_from,
             'effective_to', la.effective_to)
           order by op.name, c.name, br.code), '[]'::jsonb)
      into v_resp
      from public.leadership_assignments la
      left join public.operations op on op.id = la.operation_id
      left join public.operation_brs br on br.id = la.operation_br_id
      left join public.operation_cities oc on oc.id = coalesce(la.operation_city_id, br.operation_city_id)
      left join public.cities c on c.id = coalesce(oc.city_id, br.city_id)
      left join public.states st on st.id = coalesce(oc.state_id, br.state_id)
     where la.organization_id = p_organization_id
       and la.employee_id = v_employee
       and la.status = 'active'
       and la.effective_from <= v_today
       and (la.effective_to is null or la.effective_to >= v_today);

    with team as materialized (
      select e.id, e.full_name, e.employee_code, jp.name as job_position
        from public.employee_assignments a
        join public.employees e on e.id = a.employee_id
        left join public.job_positions jp on jp.id = a.job_position_id
       where a.organization_id = p_organization_id
         and a.is_current
         and a.manager_employee_id = v_employee
         and e.organization_id = p_organization_id
         and e.deleted_at is null
         and e.employment_status = 'active'
         and e.id <> v_employee
    ),
    ex as (
      select x.employee_id,
             count(*) filter (where x.operational_date = v_today) as today_n,
             count(*) as week_n
        from public.checklist_executions x
       where x.organization_id = p_organization_id
         and x.status = 'submitted'
         and x.employee_id in (select t.id from team t)
         and x.operational_date between v_week_from and v_today
       group by x.employee_id
    ),
    mem as (
      select t.id, t.full_name, t.employee_code, t.job_position,
             coalesce(ex.today_n, 0)::int as today_n,
             coalesce(ex.week_n, 0)::int as week_n,
             (select max(l.operational_date) from public.checklist_executions l
               where l.organization_id = p_organization_id and l.employee_id = t.id
                 and l.status = 'submitted' and l.operational_date <= v_today) as last_date
        from team t
        left join ex on ex.employee_id = t.id
    )
    select jsonb_build_object(
             'members',                 count(*),
             'with_checklist_today',    count(*) filter (where r.today_n > 0),
             'without_checklist_today', count(*) filter (where r.today_n = 0),
             'without_checklist_week',  count(*) filter (where r.week_n = 0),
             'without_week_names',      coalesce((select jsonb_agg(z.full_name order by z.full_name)
                                                    from (select r2.full_name from mem r2 where r2.week_n = 0
                                                           order by r2.full_name limit 8) z), '[]'::jsonb),
             'list', coalesce((select jsonb_agg(jsonb_build_object(
                                        'id', r3.id, 'name', r3.full_name, 'code', r3.employee_code,
                                        'job_position', r3.job_position, 'today', r3.today_n,
                                        'week', r3.week_n, 'last_date', r3.last_date)
                                      order by r3.week_n, r3.full_name)
                                 from (select * from mem order by week_n, full_name limit 200) r3), '[]'::jsonb),
             'truncated', count(*) > 200)
      into v_team
      from mem r;
  end if;

  return jsonb_build_object(
    'today', v_today,
    'week_from', v_week_from,
    'employee', case when v_employee is null then null else private.portal_identity(p_organization_id, v_employee) end,
    'scope', jsonb_build_object(
      'all_operations', v_all,
      'operations', v_ops,
      'responsibilities', coalesce(v_resp, '[]'::jsonb)),
    'team', v_team);
end;
$$;

comment on function public.my_leadership_home(uuid) is
  'Pós-login (Liderança de Operações): operações liberadas no vínculo, responsabilidades de liderança '
  'vigentes e a equipe direta (gestor imediato) com checklists de hoje e da semana. Exige adherence.view ou '
  'applications.checklist_fleet.view_details. Só leitura.';

revoke all on function public.my_leadership_home(uuid) from public, anon;
grant execute on function public.my_leadership_home(uuid) to authenticated;
