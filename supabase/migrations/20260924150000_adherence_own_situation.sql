-- =============================================================================
-- Etapa 11 · Aderência › "Minha situação" do perfil Operacional (§63)
--
-- "O perfil Operacional poderá consultar sua própria situação quando
-- autorizado. […] Gente não deverá receber autorização operacional automática.
-- A matriz RBAC continuará sendo a fonte oficial de autorização."
--
-- Aditiva. Nenhuma tabela criada ou alterada, nenhum dado apagado, nenhum
-- papel de ninguém trocado.
--
--  1. Permissão `adherence.view_own` e o padrão da matriz: Operacional (é o
--     "quando autorizado" — um administrador pode retirá-la do papel) e
--     Administrador (que possui o catálogo inteiro por definição e sem ela não
--     conseguiria conceder nem manter a permissão no papel Operacional —
--     `private.can_grant_permission`). Gente NÃO recebe.
--  2. `public.adherence_my_situation(org, ano, mês)` — leitura `security
--     definer`, só da própria pessoa:
--       * a pessoa é o colaborador da conta NA organização
--         (`organization_memberships.employee_id`), resolvido de `auth.uid()`;
--         nunca de um parâmetro, nunca por nome;
--       * "própria situação" = as obrigações (saída e retorno) da BR/veículo
--         em que ela é motorista TITULAR fidelizado (`fidelization_drivers`,
--         papel `primary`, via `fidelization_assignments`), com o vínculo do
--         motorista e o do veículo vigentes na data de cada obrigação; mais as
--         obrigações conciliadas com checklists que ela mesma enviou
--         (`checklist_executions.employee_id`). O motorista secundário é a
--         escala de reserva (um reserva pode estar em cinco BRs) e só entra
--         pelos checklists que ele mesmo enviou;
--       * status, devida e feita vêm da view oficial
--         `adherence_obligation_status` e a fórmula é a mesma de
--         `adherence_summary`: Σ feitas e devidas ÷ Σ devidas × 100, `null`
--         sem base. Não há segunda regra.
--     Nunca devolve dado de outro colaborador — nem para administrador, que
--     tem as telas completas da Aderência.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissão e padrão da matriz
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('adherence.view_own', 'adherence', 'Ver a própria situação na aderência',
   'Consultar a própria aderência: obrigações da BR em que é motorista fidelizado e checklists que enviou. Não dá acesso aos indicadores da organização')
on conflict (code) do nothing;

-- O gatilho `access_profile_defaults_sync` materializa o padrão nos papéis que
-- já existem (aditivo: só entrega código que a organização nunca teve).
insert into public.access_profile_defaults (profile_code, permission_code) values
  ('operacional',   'adherence.view_own'),
  ('administrador', 'adherence.view_own')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Minha situação
-- -----------------------------------------------------------------------------
create or replace function public.adherence_my_situation(
  p_organization_id uuid, p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_found     boolean;
  v_employee  uuid;
  v_name      text;
  v_from      date;
  v_to        date;
  v_today     date;
  v_links     jsonb := '[]'::jsonb;
  v_fid_ids   uuid[] := array[]::uuid[];
  v_exec_ids  uuid[] := array[]::uuid[];
  v_ids       uuid[];
  v_exec      jsonb;
  v_state     text;
  v_result    jsonb;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente para consultar a sua situação.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_organization_id is null or p_year is null or p_month is null
     or p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;

  -- A conta precisa pertencer à organização: "minha situação" é de um
  -- colaborador desta organização, não da plataforma.
  select true, m.employee_id into v_found, v_employee
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    join public.profiles p      on p.user_id = m.user_id
   where m.user_id = v_uid
     and m.organization_id = p_organization_id
     and m.status = 'active'
     and o.status = 'active' and o.deleted_at is null
     and p.status = 'active'
   limit 1;

  if not coalesce(v_found, false) then
    raise exception 'Sua conta não pertence a esta organização.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A matriz RBAC decide; nenhum nome de perfil é consultado aqui.
  if not private.has_permission(p_organization_id, 'adherence.view_own') then
    raise exception 'Você não tem autorização para consultar a própria situação na Aderência.'
      using errcode = 'insufficient_privilege';
  end if;

  v_from  := make_date(p_year, p_month, 1);
  v_to    := (v_from + interval '1 month' - interval '1 day')::date;
  v_today := private.adherence_today(p_organization_id);

  if v_employee is null then
    return jsonb_build_object(
      'state', 'no_employee',
      'year', p_year, 'month', p_month, 'date_from', v_from, 'date_to', v_to, 'today', v_today,
      'employee_name', null,
      'summary', null, 'positions', '[]'::jsonb, 'days', '[]'::jsonb,
      'pending', '[]'::jsonb, 'pending_total', 0,
      'executions', jsonb_build_object('submitted', 0, 'linked', 0));
  end if;

  select e.full_name into v_name from public.employees e
   where e.id = v_employee and e.organization_id = p_organization_id;

  -- Vínculos de motorista titular no mês, recortados ao período em que o
  -- vínculo do motorista E o do veículo na BR valem.
  select coalesce(jsonb_agg(jsonb_build_object(
           'operation_br_id', x.operation_br_id, 'vehicle_id', x.vehicle_id,
           'd_from', x.d_from, 'd_to', x.d_to,
           'br_code', br.code, 'operation_name', op.name,
           'city_name', c.name, 'uf', st.uf,
           'fleet_code', v.fleet_code, 'license_plate', v.license_plate)
         order by x.d_from, br.code), '[]'::jsonb)
    into v_links
    from (
      select fa.operation_br_id, fa.vehicle_id,
             greatest(fd.start_date, fa.start_date, v_from) as d_from,
             least(coalesce(fd.end_date, 'infinity'::date), coalesce(fa.end_date, 'infinity'::date), v_to) as d_to
        from public.fidelization_drivers fd
        join public.fidelization_assignments fa
          on fa.organization_id = fd.organization_id and fa.id = fd.fidelization_assignment_id
       where fd.organization_id = p_organization_id
         and fd.employee_id = v_employee
         and fd.driver_role = 'primary'
         and fd.status <> 'cancelled'
         and fa.status <> 'cancelled'
    ) x
    join public.operation_brs br on br.id = x.operation_br_id
    left join public.operations op on op.id = br.operation_id
    left join public.cities c on c.id = br.city_id
    left join public.states st on st.id = br.state_id
    left join public.vehicles v on v.id = x.vehicle_id
   where x.d_from <= x.d_to;

  -- Obrigações da BR/veículo nos dias do vínculo.
  select coalesce(array_agg(distinct o.id), array[]::uuid[]) into v_fid_ids
    from public.checklist_obligations o
    join jsonb_to_recordset(v_links) as l(operation_br_id uuid, vehicle_id uuid, d_from date, d_to date)
      on o.operation_br_id = l.operation_br_id
     and o.vehicle_id = l.vehicle_id
     and o.operational_date between l.d_from and l.d_to
   where o.organization_id = p_organization_id
     and o.is_active;

  -- Checklists que a própria pessoa enviou. A data operacional da execução
  -- pode ser a do dia civil seguinte (retorno depois da meia-noite): a janela
  -- tem um dia de folga e a obrigação conciliada é que decide o mês.
  with ex as (
    select e.id, e.operational_date
      from public.checklist_executions e
     where e.organization_id = p_organization_id
       and e.employee_id = v_employee
       and e.status = 'submitted'
       and e.operational_date between v_from - 1 and v_to + 1
  ), linked as (
    select m.execution_id, m.obligation_id
      from public.checklist_obligation_matches m
      join ex on ex.id = m.execution_id
      join public.checklist_obligations o on o.id = m.obligation_id
     where m.organization_id = p_organization_id
       and m.is_valid
       and o.is_active
       and o.operational_date between v_from and v_to
  )
  select coalesce((select array_agg(distinct obligation_id) from linked), array[]::uuid[]),
         jsonb_build_object(
           'submitted', (select count(*) from ex where ex.operational_date between v_from and v_to),
           'linked',    (select count(distinct execution_id) from linked))
    into v_exec_ids, v_exec;

  v_ids := array(select distinct u from unnest(v_fid_ids || v_exec_ids) u);

  if jsonb_array_length(v_links) = 0 and cardinality(v_ids) = 0 and (v_exec ->> 'submitted')::int = 0 then
    v_state := 'not_driver';
  else
    v_state := 'ok';
  end if;

  with base as materialized (
    select s.*,
           (s.id = any (v_fid_ids))  as by_fidelization,
           (s.id = any (v_exec_ids)) as by_execution
      from public.adherence_obligation_status s
     where s.organization_id = p_organization_id
       and s.id = any (v_ids)
  ),
  labeled as (
    select b.*, br.code as br_code, op.name as operation_name, c.name as city_name
      from base b
      left join public.operation_brs br on br.id = b.operation_br_id
      left join public.operations op on op.id = b.operation_id
      left join public.cities c on c.id = b.city_id
  ),
  -- A mesma fórmula de `adherence_summary`, sobre o conjunto da pessoa.
  summary as (
    select k.key,
           jsonb_build_object(
             'obligations',      count(b.id),
             'done',             count(b.id) filter (where b.is_done),
             'not_done',         count(b.id) filter (where b.status_code = 'NAO_FEZ_CHECKLIST'),
             'pending_return',   count(b.id) filter (where b.status_code = 'RETORNO_PENDENTE'),
             'planned',          count(b.id) filter (where b.status_code = 'PLANEJADO'),
             'excluded',         count(b.id) filter (where b.is_excluded),
             'pending_requests', count(b.id) filter (where b.has_pending_request),
             'provisional',      count(b.id) filter (where b.is_provisional),
             'numerator',        count(b.id) filter (where b.is_done and b.is_due),
             'denominator',      count(b.id) filter (where b.is_due),
             'adherence_pct',    case when count(b.id) filter (where b.is_due) > 0
                                   then round((count(b.id) filter (where b.is_done and b.is_due))::numeric * 100
                                              / (count(b.id) filter (where b.is_due))::numeric, 2) end,
             'target_pct',       private.adherence_target_pct(p_organization_id, null, k.ctx, v_to)) as val
      from (values ('total', null::text), ('saida', 'saida'), ('retorno', 'retorno')) k(key, ctx)
      left join base b on (k.ctx is null or b.checklist_context = k.ctx)
     group by k.key, k.ctx
  ),
  cells as (
    select l.operational_date, l.operation_br_id, l.vehicle_id, l.journey_seq, l.checklist_context,
           l.br_code, l.operation_name, l.city_name, l.fleet_code_snapshot, l.license_plate_snapshot,
           l.by_fidelization, l.by_execution,
           jsonb_build_object(
             'status', l.status_code, 'due', l.is_due, 'done', l.is_done, 'excluded', l.is_excluded,
             'provisional', l.is_provisional, 'pending_request', l.has_pending_request,
             'condition', l.detected_condition, 'performed_by_me', l.by_execution,
             'expected_at', l.expected_at, 'deadline_at', l.deadline_at) as cell
      from labeled l
  ),
  day_rows as (
    select c.operational_date, min(c.br_code) as br_code,
           jsonb_build_object(
             'date', c.operational_date,
             'journey', c.journey_seq,
             'br_code', min(c.br_code),
             'operation_name', min(c.operation_name),
             'city_name', min(c.city_name),
             'fleet_code', min(c.fleet_code_snapshot),
             'license_plate', min(c.license_plate_snapshot),
             'by_fidelization', bool_or(c.by_fidelization),
             'by_execution', bool_or(c.by_execution),
             'saida',   (array_agg(c.cell) filter (where c.checklist_context = 'saida'))[1],
             'retorno', (array_agg(c.cell) filter (where c.checklist_context = 'retorno'))[1]) as val
      from cells c
     group by c.operational_date, c.operation_br_id, c.vehicle_id, c.journey_seq
  ),
  pend as (
    select l.deadline_at, l.br_code,
           jsonb_build_object(
             'date', l.operational_date,
             'context', l.checklist_context,
             'status', l.status_code,
             'br_code', l.br_code,
             'operation_name', l.operation_name,
             'city_name', l.city_name,
             'fleet_code', l.fleet_code_snapshot,
             'license_plate', l.license_plate_snapshot,
             'expected_at', l.expected_at,
             'deadline_at', l.deadline_at,
             'provisional', l.is_provisional,
             'pending_request', l.has_pending_request,
             'departure_done', case when l.checklist_context = 'retorno' then coalesce(dep.is_done, false) end,
             'situation', case
               when l.status_code = 'RETORNO_PENDENTE' and coalesce(dep.is_done, false) then 'awaiting_return'
               when l.status_code = 'RETORNO_PENDENTE' then 'not_departed'
               when l.is_provisional then 'provisional'
               when l.checklist_context = 'retorno' and coalesce(dep.is_done, false) then 'overdue_after_departure'
               else 'overdue' end) as val
      from labeled l
      left join public.adherence_obligation_status dep
        on l.checklist_context = 'retorno'
       and dep.organization_id = p_organization_id
       and dep.vehicle_id = l.vehicle_id
       and dep.operational_date = l.operational_date
       and dep.journey_seq = l.journey_seq
       and dep.checklist_context = 'saida'
     where l.status_code in ('NAO_FEZ_CHECKLIST', 'RETORNO_PENDENTE')
  )
  select jsonb_build_object(
      'state', v_state,
      'year', p_year, 'month', p_month, 'date_from', v_from, 'date_to', v_to, 'today', v_today,
      'employee_name', v_name,
      'summary', (select jsonb_object_agg(s.key, s.val) from summary s),
      'positions', (select coalesce(jsonb_agg(x - 'vehicle_id'), '[]'::jsonb) from jsonb_array_elements(v_links) x),
      'days', coalesce((select jsonb_agg(d.val order by d.operational_date, d.br_code) from day_rows d), '[]'::jsonb),
      'pending', coalesce((select jsonb_agg(p.val order by p.deadline_at, p.br_code)
                            from (select * from pend order by deadline_at, br_code limit 200) p), '[]'::jsonb),
      'pending_total', (select count(*) from pend),
      'executions', v_exec)
    into v_result;

  return v_result;
end;
$$;

comment on function public.adherence_my_situation(uuid, integer, integer) is
  'Minha situação (§63): a aderência do colaborador da própria conta na competência — obrigações da BR em '
  'que é motorista titular fidelizado na data e as conciliadas com checklists que enviou. Status e fórmula '
  'da view oficial. Exige adherence.view_own; nunca devolve dado de outro colaborador.';

revoke all on function public.adherence_my_situation(uuid, integer, integer) from public, anon;
grant execute on function public.adherence_my_situation(uuid, integer, integer) to authenticated;
