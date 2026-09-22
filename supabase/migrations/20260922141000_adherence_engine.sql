-- =============================================================================
-- Etapa 11 — Aderência: o motor
--
-- Tudo em `private`: nada aqui é exposto ao PostgREST. As rotinas públicas
-- (migration seguinte) verificam permissão e escopo e delegam para cá; a
-- rotina programada chama direto.
--
-- Ordem de leitura: data operacional → frota prevista na data → regra de
-- elegibilidade vigente → obrigações esperadas → geração idempotente →
-- conciliação da execução → classificação única (view).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fuso e data operacional (§19). Centralizado: ninguém usa a data UTC.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_tz(p_organization_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.timezone from public.adherence_settings s where s.organization_id = p_organization_id),
                  'America/Sao_Paulo');
$$;

create or replace function private.adherence_today(p_organization_id uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone private.adherence_tz(p_organization_id))::date;
$$;

-- Um instante local (data + hora no fuso da organização) como timestamptz.
create or replace function private.adherence_local_ts(p_organization_id uuid, p_date date, p_time time, p_next_day boolean)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select ((p_date + case when coalesce(p_next_day, false) then 1 else 0 end) + p_time)::timestamp
         at time zone private.adherence_tz(p_organization_id);
$$;

-- -----------------------------------------------------------------------------
-- 2. Situação do veículo NA DATA (§9, §26) — pelo histórico, não pelo cadastro atual
-- -----------------------------------------------------------------------------
create or replace function private.vehicle_status_at(p_vehicle_id uuid, p_date date, p_tz text)
returns text
language sql stable security definer set search_path = ''
as $$
  with cutoff as (select ((p_date + 1)::timestamp at time zone p_tz) as ts)
  select coalesce(
    (select h.new_status from public.vehicle_status_history h, cutoff
      where h.vehicle_id = p_vehicle_id and h.changed_at < cutoff.ts
      order by h.changed_at desc limit 1),
    (select h.previous_status from public.vehicle_status_history h, cutoff
      where h.vehicle_id = p_vehicle_id and h.changed_at >= cutoff.ts
      order by h.changed_at asc limit 1),
    (select v.status from public.vehicles v where v.id = p_vehicle_id));
$$;

-- -----------------------------------------------------------------------------
-- 3. Liderança responsável na data — mesma precedência da Etapa 13
--    (exceção do BR › cidade › operação), tolerante a obrigação sem BR
-- -----------------------------------------------------------------------------
create or replace function private.adherence_leader_at(
  p_operation_id uuid, p_operation_city_id uuid, p_operation_br_id uuid, p_date date)
returns table (employee_id uuid, leadership_assignment_id uuid)
language sql stable security definer set search_path = ''
as $$
  select l.employee_id, l.id
    from public.leadership_assignments l
   where l.status = 'active' and l.responsibility_type = 'principal'
     and l.effective_from <= p_date and (l.effective_to is null or l.effective_to >= p_date)
     and (   (l.scope_level = 'br'        and p_operation_br_id   is not null and l.operation_br_id   = p_operation_br_id)
          or (l.scope_level = 'city'      and p_operation_city_id is not null and l.operation_city_id = p_operation_city_id)
          or (l.scope_level = 'operation' and l.operation_id = p_operation_id))
   order by case l.scope_level when 'br' then 1 when 'city' then 2 else 3 end, l.effective_from desc
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 4. Frota prevista na data (§7, §25)
--
-- Precedência explícita: a fidelização (posição › BR › operação › cidade) é a
-- fonte primária; sem ela, vale a alocação operacional do Cadastro de Frotas.
-- Quando as duas existem e discordam de operação, a fidelização vence e o
-- conflito vira inconsistência para conciliação — nunca decisão silenciosa.
-- Vendidos e baixados não são frota. Inativos e em manutenção entram e a regra
-- de elegibilidade decide.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_planned_fleet(
  p_organization_id uuid, p_date date, p_operation_id uuid default null, p_vehicle_id uuid default null)
returns table (
  vehicle_id uuid, operation_id uuid, operation_city_id uuid, state_id smallint, city_id integer,
  operation_br_id uuid, fidelization_assignment_id uuid, organization_unit_id uuid,
  vehicle_type_id uuid, vehicle_subcategory_id uuid, fleet_code text, license_plate text,
  vehicle_status text, source text, planning_conflict boolean, conflict_operation_id uuid)
language sql stable security definer set search_path = ''
as $$
  with fid as (
    select distinct on (fa.vehicle_id)
           fa.vehicle_id, fa.id as assignment_id, b.operation_id, b.operation_city_id, b.state_id, b.city_id, b.id as br_id
      from public.fidelization_assignments fa
      join public.operation_brs b on b.id = fa.operation_br_id and b.deleted_at is null
     where fa.organization_id = p_organization_id
       and fa.status in ('confirmed', 'executed') and fa.vehicle_role = 'primary'
       and fa.start_date <= p_date and (fa.end_date is null or fa.end_date >= p_date)
     order by fa.vehicle_id, fa.start_date desc, fa.created_at desc
  ),
  alloc as (
    select distinct on (a.vehicle_id)
           a.vehicle_id, a.operation_id, a.state_id, a.city_id,
           (select oc.id from public.operation_cities oc
             where oc.operation_id = a.operation_id and oc.city_id = a.city_id limit 1) as operation_city_id
      from public.vehicle_operation_assignments a
     where a.organization_id = p_organization_id
       and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
     order by a.vehicle_id, a.effective_from desc
  )
  select v.id,
         coalesce(f.operation_id, al.operation_id),
         coalesce(f.operation_city_id, al.operation_city_id),
         coalesce(f.state_id, al.state_id),
         coalesce(f.city_id, al.city_id),
         f.br_id, f.assignment_id,
         v.organization_unit_id, v.vehicle_type_id, v.vehicle_subcategory_id, v.fleet_code, v.license_plate,
         private.vehicle_status_at(v.id, p_date, private.adherence_tz(p_organization_id)),
         case when f.vehicle_id is not null then 'fidelization' else 'allocation' end,
         (f.vehicle_id is not null and al.vehicle_id is not null and f.operation_id <> al.operation_id),
         case when f.vehicle_id is not null and al.vehicle_id is not null and f.operation_id <> al.operation_id
              then al.operation_id end
    from public.vehicles v
    left join fid f on f.vehicle_id = v.id
    left join alloc al on al.vehicle_id = v.id
   where v.organization_id = p_organization_id and v.deleted_at is null
     and (f.vehicle_id is not null or al.vehicle_id is not null)
     and (p_vehicle_id is null or v.id = p_vehicle_id)
     and (p_operation_id is null or coalesce(f.operation_id, al.operation_id) = p_operation_id);
$$;

-- -----------------------------------------------------------------------------
-- 5. Regra de elegibilidade vigente (§8, §26): a mais específica vence
-- -----------------------------------------------------------------------------
create or replace function private.adherence_resolve_rule(
  p_organization_id uuid, p_date date, p_operation_id uuid, p_vehicle_type_id uuid,
  p_subcategory_id uuid, p_vehicle_status text)
returns table (
  rule_id uuid, rule_version integer, requires_checklist boolean,
  applies_to_departure boolean, applies_to_return boolean, weekdays smallint[],
  departure_expected_time time, return_expected_time time, return_deadline_time time, return_deadline_next_day boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.version, r.requires_checklist, r.applies_to_departure, r.applies_to_return, r.weekdays,
         r.departure_expected_time, r.return_expected_time, r.return_deadline_time, r.return_deadline_next_day
    from public.adherence_eligibility_rules r
   where r.organization_id = p_organization_id and r.is_active
     and r.valid_from <= p_date and (r.valid_to is null or r.valid_to >= p_date)
     and (r.operation_id is null or r.operation_id = p_operation_id)
     and (r.vehicle_type_id is null or r.vehicle_type_id = p_vehicle_type_id)
     and (r.vehicle_subcategory_id is null or r.vehicle_subcategory_id = p_subcategory_id)
     and (r.vehicle_status is null or r.vehicle_status = p_vehicle_status)
   order by (r.operation_id is not null)::int + (r.vehicle_type_id is not null)::int
          + (r.vehicle_subcategory_id is not null)::int + (r.vehicle_status is not null)::int desc,
            r.priority asc, r.valid_from desc
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 6. Obrigações esperadas para um período (§11): o que o planejamento diz
--    que deveria existir, com o contexto resolvido na data
-- -----------------------------------------------------------------------------
create or replace function private.adherence_expected(
  p_organization_id uuid, p_from date, p_to date,
  p_operation_id uuid default null, p_vehicle_id uuid default null, p_context text default null)
returns table (
  vehicle_id uuid, operational_date date, checklist_context text,
  operation_id uuid, operation_city_id uuid, state_id smallint, city_id integer, operation_br_id uuid,
  fidelization_assignment_id uuid, organization_unit_id uuid, vehicle_type_id uuid, vehicle_subcategory_id uuid,
  leader_employee_id uuid, leadership_assignment_id uuid, fleet_code text, license_plate text, vehicle_status text,
  expected_at timestamptz, deadline_at timestamptz, source text,
  eligibility_rule_id uuid, eligibility_rule_version integer, detected_condition text,
  planning_conflict boolean, conflict_operation_id uuid)
language sql stable security definer set search_path = ''
as $$
  with days as (
    select d::date as d from generate_series(p_from, p_to, interval '1 day') d
  ),
  s as (
    select * from public.adherence_settings where organization_id = p_organization_id
  ),
  fleet as (
    select days.d, f.*
      from days
      cross join lateral private.adherence_planned_fleet(p_organization_id, days.d, p_operation_id, p_vehicle_id) f
     where f.vehicle_status not in ('sold', 'decommissioned')
       -- a obrigação pressupõe o aplicativo habilitado na operação (Etapa 12, §26)
       and exists (
         select 1 from public.checklist_app_operations ao
           join public.operational_apps a on a.id = ao.app_id
          where ao.organization_id = p_organization_id and ao.operation_id = f.operation_id
            and ao.is_enabled and a.code = 'checklist_frota' and a.deleted_at is null)
  ),
  ruled as (
    select fl.*, r.*
      from fleet fl
      cross join lateral private.adherence_resolve_rule(
        p_organization_id, fl.d, fl.operation_id, fl.vehicle_type_id, fl.vehicle_subcategory_id, fl.vehicle_status) r
     where r.requires_checklist
       and extract(isodow from fl.d)::smallint = any (r.weekdays)
  ),
  ctx as (
    select c.context from (values ('saida'), ('retorno')) as c(context)
     where p_context is null or c.context = p_context
  )
  select ru.vehicle_id, ru.d, ctx.context,
         ru.operation_id, ru.operation_city_id, ru.state_id, ru.city_id, ru.operation_br_id,
         ru.fidelization_assignment_id, ru.organization_unit_id, ru.vehicle_type_id, ru.vehicle_subcategory_id,
         ld.employee_id, ld.leadership_assignment_id, ru.fleet_code, ru.license_plate, ru.vehicle_status,
         case ctx.context
           when 'saida' then private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.departure_expected_time, s.departure_expected_time, '06:00'::time), false)
           else private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.return_expected_time, s.return_expected_time, '18:00'::time), false)
         end,
         case ctx.context
           -- a saída vence no fim do dia operacional; durante o dia já é "não fez" provisório (§15)
           when 'saida' then private.adherence_local_ts(p_organization_id, ru.d, '00:00'::time, true)
           else private.adherence_local_ts(p_organization_id, ru.d,
                               coalesce(ru.return_deadline_time, s.return_deadline_time, '02:00'::time),
                               coalesce(ru.return_deadline_next_day, s.return_deadline_next_day, true))
         end,
         ru.source, ru.rule_id, ru.rule_version,
         case ru.vehicle_status when 'maintenance' then 'MANUTENCAO' when 'inactive' then 'FROTA_NAO_ATIVA' end,
         ru.planning_conflict, ru.conflict_operation_id
    from ruled ru
    cross join ctx
    left join lateral private.adherence_leader_at(ru.operation_id, ru.operation_city_id, ru.operation_br_id, ru.d) ld on true
    left join s on true
   where (ctx.context = 'saida' and ru.applies_to_departure)
      or (ctx.context = 'retorno' and ru.applies_to_return);
$$;

-- -----------------------------------------------------------------------------
-- 7. Geração idempotente (§38–§40)
--
-- Reprocessar sem mudança nas fontes produz o mesmo resultado: cria o que
-- falta, reativa o que foi aposentado e voltou a ser esperado, e só aposenta
-- (nunca apaga) o que deixou de ser esperado E não está protegido — obrigação
-- com execução conciliada ou com solicitação pendente/aprovada é história.
-- `p_dry_run` devolve o diff sem gravar (prévia da reconciliação, §39).
-- -----------------------------------------------------------------------------
create or replace function private.adherence_generate(
  p_organization_id uuid, p_from date, p_to date,
  p_operation_id uuid default null, p_vehicle_id uuid default null, p_context text default null,
  p_allow_retire boolean default false, p_dry_run boolean default false,
  p_run_id uuid default null, p_retire_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected int := 0; v_create int := 0; v_reactivate int := 0; v_unchanged int := 0;
  v_retire int := 0; v_protected int := 0; v_conflicts int := 0; v_hints int := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Período inválido para geração de obrigações.' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 92 then
    raise exception 'Reprocesse no máximo 93 dias por vez.' using errcode = 'invalid_parameter_value';
  end if;
  if p_context is not null and p_context not in ('saida', 'retorno') then
    raise exception 'Contexto inválido: %', p_context using errcode = 'invalid_parameter_value';
  end if;

  drop table if exists pg_temp.adh_expected;
  create temp table adh_expected on commit drop as
    select * from private.adherence_expected(p_organization_id, p_from, p_to, p_operation_id, p_vehicle_id, p_context);

  select count(*) into v_expected from pg_temp.adh_expected;

  select count(*) filter (where o.id is null),
         count(*) filter (where o.id is not null and not o.is_active),
         count(*) filter (where o.id is not null and o.is_active)
    into v_create, v_reactivate, v_unchanged
    from pg_temp.adh_expected e
    left join public.checklist_obligations o
      on o.organization_id = p_organization_id and o.vehicle_id = e.vehicle_id
     and o.operational_date = e.operational_date and o.checklist_context = e.checklist_context
     and o.journey_seq = 1;

  select count(distinct (e.vehicle_id, e.operational_date)) into v_conflicts
    from pg_temp.adh_expected e where e.planning_conflict;

  select count(*) filter (where not c.protected), count(*) filter (where c.protected)
    into v_retire, v_protected
    from (
      select o.id,
             (exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
              or exists (select 1 from public.adherence_requests r where r.obligation_id = o.id and r.status in ('approved', 'pending'))
             ) as protected
        from public.checklist_obligations o
       where o.organization_id = p_organization_id and o.is_active
         and o.operational_date between p_from and p_to
         and (p_operation_id is null or o.operation_id = p_operation_id)
         and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
         and (p_context is null or o.checklist_context = p_context)
         and not exists (select 1 from pg_temp.adh_expected e
                          where e.vehicle_id = o.vehicle_id and e.operational_date = o.operational_date
                            and e.checklist_context = o.checklist_context)
    ) c;

  if p_dry_run then
    return jsonb_build_object(
      'preview', true, 'date_from', p_from, 'date_to', p_to,
      'expected', v_expected, 'create', v_create, 'reactivate', v_reactivate, 'unchanged', v_unchanged,
      'retire', case when p_allow_retire then v_retire else 0 end, 'retire_candidates', v_retire,
      'protected', v_protected, 'planning_conflicts', v_conflicts);
  end if;

  insert into public.checklist_obligations (
    organization_id, vehicle_id, operational_date, checklist_context, journey_seq,
    operation_id, operation_city_id, state_id, city_id, operation_br_id, organization_unit_id,
    vehicle_type_id, vehicle_subcategory_id, leader_employee_id, leadership_assignment_id,
    fleet_code_snapshot, license_plate_snapshot, vehicle_status_snapshot, expected_at, deadline_at,
    source, fidelization_assignment_id, eligibility_rule_id, eligibility_rule_version,
    detected_condition, generation_run_id)
  select p_organization_id, e.vehicle_id, e.operational_date, e.checklist_context, 1,
         e.operation_id, e.operation_city_id, e.state_id, e.city_id, e.operation_br_id, e.organization_unit_id,
         e.vehicle_type_id, e.vehicle_subcategory_id, e.leader_employee_id, e.leadership_assignment_id,
         e.fleet_code, e.license_plate, e.vehicle_status, e.expected_at, e.deadline_at,
         e.source, e.fidelization_assignment_id, e.eligibility_rule_id, e.eligibility_rule_version,
         e.detected_condition, p_run_id
    from pg_temp.adh_expected e
  on conflict (organization_id, vehicle_id, operational_date, checklist_context, journey_seq) do update
     set is_active = true, retired_at = null, retired_reason = null, updated_at = now(),
         generation_run_id = coalesce(p_run_id, public.checklist_obligations.generation_run_id)
   where not public.checklist_obligations.is_active;

  -- A condição detectada é dica para o expurgo, não história: acompanha o cadastro.
  update public.checklist_obligations o
     set detected_condition = e.detected_condition,
         vehicle_status_snapshot = e.vehicle_status,
         updated_at = now()
    from pg_temp.adh_expected e
   where o.organization_id = p_organization_id and o.is_active
     and o.vehicle_id = e.vehicle_id and o.operational_date = e.operational_date
     and o.checklist_context = e.checklist_context and o.journey_seq = 1
     and (o.detected_condition is distinct from e.detected_condition
          or o.vehicle_status_snapshot is distinct from e.vehicle_status);
  get diagnostics v_hints = row_count;

  if p_allow_retire then
    update public.checklist_obligations o
       set is_active = false, retired_at = now(),
           retired_reason = coalesce(p_retire_reason, 'planning_changed'), updated_at = now()
     where o.organization_id = p_organization_id and o.is_active
       and o.operational_date between p_from and p_to
       and (p_operation_id is null or o.operation_id = p_operation_id)
       and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
       and (p_context is null or o.checklist_context = p_context)
       and not exists (select 1 from pg_temp.adh_expected e
                        where e.vehicle_id = o.vehicle_id and e.operational_date = o.operational_date
                          and e.checklist_context = o.checklist_context)
       and not exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
       and not exists (select 1 from public.adherence_requests r where r.obligation_id = o.id and r.status in ('approved', 'pending'));
    get diagnostics v_retire = row_count;
  else
    v_retire := 0;
  end if;

  insert into public.adherence_inconsistencies (organization_id, kind, vehicle_id, operational_date, details)
  select distinct p_organization_id, 'planning_conflict', e.vehicle_id, e.operational_date,
         jsonb_build_object('fidelization_operation_id', e.operation_id, 'allocation_operation_id', e.conflict_operation_id)
    from pg_temp.adh_expected e
   where e.planning_conflict
     and not exists (select 1 from public.adherence_inconsistencies i
                      where i.organization_id = p_organization_id and i.kind = 'planning_conflict'
                        and i.vehicle_id = e.vehicle_id and i.operational_date = e.operational_date and i.status = 'open');

  return jsonb_build_object(
    'preview', false, 'date_from', p_from, 'date_to', p_to,
    'expected', v_expected, 'create', v_create, 'reactivate', v_reactivate, 'unchanged', v_unchanged,
    'retire', v_retire, 'protected', v_protected, 'hints_updated', v_hints, 'planning_conflicts', v_conflicts);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Conciliação de uma execução (§22, §24)
--
-- Saída satisfaz só saída; retorno só retorno. Um retorno enviado depois da
-- meia-noite, ainda dentro do prazo do dia anterior, pertence àquela jornada
-- (§18). Sem obrigação materializada, o motor pergunta ao planejamento pela
-- obrigação daquele veículo naquele dia — não inventa uma. Sem resposta, a
-- execução vira inconsistência para conciliação autorizada. A segunda execução
-- do mesmo contexto no dia é registrada, mas não conta duas vezes.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_match_execution(
  p_execution_id uuid, p_source text default 'outbox', p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e record;
  o record;
  v_existing uuid;
  v_today date;
begin
  select x.id, x.organization_id, x.vehicle_id, x.checklist_type, x.operational_date, x.submitted_at, x.status
    into e
    from public.checklist_executions x where x.id = p_execution_id;
  if e.id is null then
    raise exception 'Execução % não encontrada.', p_execution_id using errcode = 'no_data_found';
  end if;
  if e.status <> 'submitted' then
    return jsonb_build_object('status', 'skipped', 'reason', 'execution_not_submitted');
  end if;

  select m.obligation_id into v_existing
    from public.checklist_obligation_matches m where m.execution_id = e.id;
  if v_existing is not null then
    return jsonb_build_object('status', 'already_matched', 'obligation_id', v_existing);
  end if;

  v_today := private.adherence_today(e.organization_id);

  select c.* into o from public.checklist_obligations c
   where c.organization_id = e.organization_id and c.vehicle_id = e.vehicle_id and c.is_active
     and c.checklist_context = e.checklist_type and c.operational_date = e.operational_date
   order by c.journey_seq limit 1;

  if o.id is null and e.checklist_type = 'retorno' then
    select c.* into o from public.checklist_obligations c
     where c.organization_id = e.organization_id and c.vehicle_id = e.vehicle_id and c.is_active
       and c.checklist_context = 'retorno' and c.operational_date = e.operational_date - 1
       and c.deadline_at >= coalesce(e.submitted_at, now())
       and not exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = c.id and m.is_valid)
     order by c.journey_seq limit 1;
  end if;

  if o.id is null and e.operational_date <= v_today + 1 then
    perform private.adherence_generate(
      e.organization_id, e.operational_date, e.operational_date, null, e.vehicle_id, e.checklist_type,
      false, false, null, null);
    select c.* into o from public.checklist_obligations c
     where c.organization_id = e.organization_id and c.vehicle_id = e.vehicle_id and c.is_active
       and c.checklist_context = e.checklist_type and c.operational_date = e.operational_date
     order by c.journey_seq limit 1;
  end if;

  if o.id is null then
    insert into public.adherence_inconsistencies
      (organization_id, kind, vehicle_id, execution_id, operational_date, checklist_context, details)
    values (e.organization_id, 'execution_without_obligation', e.vehicle_id, e.id, e.operational_date, e.checklist_type,
            jsonb_build_object('submitted_at', e.submitted_at, 'source', p_source))
    on conflict do nothing;
    return jsonb_build_object('status', 'unmatched');
  end if;

  if exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid) then
    insert into public.checklist_obligation_matches
      (organization_id, obligation_id, execution_id, match_source, is_valid, invalid_reason, matched_by)
    values (e.organization_id, o.id, e.id, p_source, false, 'duplicate', p_actor);
    insert into public.adherence_inconsistencies
      (organization_id, kind, vehicle_id, execution_id, obligation_id, operational_date, checklist_context, details)
    values (e.organization_id, 'duplicate_execution', e.vehicle_id, e.id, o.id, o.operational_date, o.checklist_context,
            jsonb_build_object('submitted_at', e.submitted_at))
    on conflict do nothing;
    return jsonb_build_object('status', 'duplicate', 'obligation_id', o.id);
  end if;

  insert into public.checklist_obligation_matches (organization_id, obligation_id, execution_id, match_source, matched_by)
  values (e.organization_id, o.id, e.id, p_source, p_actor);

  if exists (select 1 from public.adherence_requests r
              where r.obligation_id = o.id and r.status = 'approved' and r.decision_effect = 'exclude') then
    insert into public.adherence_inconsistencies
      (organization_id, kind, vehicle_id, execution_id, obligation_id, operational_date, checklist_context, details)
    values (e.organization_id, 'execution_after_exclusion', e.vehicle_id, e.id, o.id, o.operational_date, o.checklist_context, '{}'::jsonb)
    on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'matched', 'obligation_id', o.id, 'operational_date', o.operational_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Consumo do outbox da Etapa 12 (§24, §57 da Etapa 12)
-- -----------------------------------------------------------------------------
create or replace function private.adherence_consume_outbox(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ev record;
  n_ok int := 0;
  n_err int := 0;
begin
  for ev in
    select x.id, x.aggregate_id, x.attempts
      from public.outbox_events x
     where x.event_type = 'checklist.execution.submitted'
       and x.status in ('pending', 'failed') and x.attempts < 5
     order by x.created_at
     limit p_limit
     for update skip locked
  loop
    begin
      perform private.adherence_match_execution(ev.aggregate_id, 'outbox', null);
      update public.outbox_events set status = 'processed', processed_at = now(), last_error = null where id = ev.id;
      n_ok := n_ok + 1;
    exception when others then
      update public.outbox_events
         set attempts = ev.attempts + 1, last_error = left(sqlerrm, 500),
             status = case when ev.attempts + 1 >= 5 then 'failed' else 'pending' end
       where id = ev.id;
      n_err := n_err + 1;
    end;
  end loop;
  return jsonb_build_object('processed', n_ok, 'errors', n_err);
end;
$$;

-- Conciliação síncrona: o evento nasce na transação do checklist e é conciliado
-- ali mesmo. Se algo falhar, fica pendente e a rotina tenta de novo — o
-- checklist do motorista nunca é recusado por causa da aderência.
create or replace function private.tg_outbox_adherence()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.event_type = 'checklist.execution.submitted' and new.status = 'pending' then
    begin
      perform private.adherence_match_execution(new.aggregate_id, 'trigger', null);
      new.status := 'processed';
      new.processed_at := now();
    exception when others then
      new.attempts := 1;
      new.last_error := left(sqlerrm, 500);
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists outbox_adherence_consume on public.outbox_events;
create trigger outbox_adherence_consume
  before insert on public.outbox_events
  for each row execute function private.tg_outbox_adherence();

-- -----------------------------------------------------------------------------
-- 10. A regra única de classificação (§12, §15–§18, §20)
--
-- Pura e imutável: recebe fatos, devolve o código. É a única função que decide
-- status no HFM; a view abaixo a aplica a cada obrigação e todo indicador lê
-- da view. Ordem: execução válida › decisão aprovada › data futura ›
-- retorno no prazo › não fez.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_status_code(
  p_is_done boolean, p_decision_effect text, p_status_applied text, p_context text,
  p_date date, p_today date, p_deadline timestamptz, p_now timestamptz)
returns text
language sql immutable
as $$
  select case
    when coalesce(p_is_done, false)          then 'FEZ_CHECKLIST'
    when p_decision_effect = 'exclude'       then coalesce(p_status_applied, 'SEM_ROTA')
    when p_date > p_today                    then 'PLANEJADO'
    when p_context = 'retorno' and p_now < p_deadline then 'RETORNO_PENDENTE'
    else 'NAO_FEZ_CHECKLIST'
  end;
$$;

create or replace function private.adherence_target_pct(
  p_organization_id uuid, p_operation_id uuid, p_context text, p_date date)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select t.target_pct
    from public.adherence_targets t
   where t.organization_id = p_organization_id
     and t.valid_from <= p_date and (t.valid_to is null or t.valid_to >= p_date)
     and (t.operation_id is null or t.operation_id = p_operation_id)
     and (t.checklist_context is null or t.checklist_context = p_context)
   order by (t.operation_id is not null)::int + (t.checklist_context is not null)::int desc, t.valid_from desc
   limit 1;
$$;

-- A view é `security_invoker`: a RLS das obrigações decide o que cada pessoa
-- vê, e os indicadores herdam o escopo sem uma segunda lista de regras.
create or replace view public.adherence_obligation_status
with (security_invoker = true) as
select
  o.id, o.organization_id, o.vehicle_id, o.operational_date, o.checklist_context, o.journey_seq,
  o.operation_id, o.operation_city_id, o.state_id, o.city_id, o.operation_br_id, o.organization_unit_id,
  o.vehicle_type_id, o.vehicle_subcategory_id, o.leader_employee_id, o.leadership_assignment_id,
  o.fleet_code_snapshot, o.license_plate_snapshot, o.vehicle_status_snapshot,
  o.expected_at, o.deadline_at, o.source, o.fidelization_assignment_id,
  o.eligibility_rule_id, o.eligibility_rule_version, o.detected_condition, o.generation_run_id,
  o.created_at, o.updated_at,
  m.execution_id, m.id as match_id,
  ap.id as approved_request_id, ap.reason_id as approved_reason_id, ap.decision_effect, ap.status_code_applied,
  pr.id as pending_request_id,
  t.today,
  d.is_done,
  (coalesce(ap.decision_effect = 'exclude', false) and not d.is_done) as is_excluded,
  s.status_code,
  case
    when coalesce(ap.decision_effect = 'exclude', false) and not d.is_done then false
    when d.is_done then true
    when o.operational_date <= t.today and (o.checklist_context = 'saida' or t.ts >= o.deadline_at) then true
    else false
  end as is_due,
  (s.status_code = 'NAO_FEZ_CHECKLIST' and o.operational_date = t.today) as is_provisional,
  (pr.id is not null) as has_pending_request
from public.checklist_obligations o
left join public.checklist_obligation_matches m on m.obligation_id = o.id and m.is_valid
left join lateral (
  select r.id, r.reason_id, r.decision_effect, r.status_code_applied
    from public.adherence_requests r
   where r.obligation_id = o.id and r.status = 'approved'
   order by r.decided_at desc limit 1) ap on true
left join lateral (
  select r.id from public.adherence_requests r
   where r.obligation_id = o.id and r.status = 'pending' limit 1) pr on true
cross join lateral (select private.adherence_today(o.organization_id) as today, now() as ts) t
cross join lateral (select (m.execution_id is not null or coalesce(ap.decision_effect = 'count_done', false)) as is_done) d
cross join lateral (select private.adherence_status_code(
  d.is_done, ap.decision_effect, ap.status_code_applied, o.checklist_context,
  o.operational_date, t.today, o.deadline_at, t.ts) as status_code) s
where o.is_active;

grant select on public.adherence_obligation_status to authenticated;

-- -----------------------------------------------------------------------------
-- 11. A rotina (§38): não depende de ninguém abrir página
--
-- Para cada organização ativa: ontem e hoje (o planejamento do dia pode ter
-- mudado — aposenta o que deixou de ser esperado e não está protegido), o
-- horizonte à frente (só cria; aparece como Planejado) e o outbox pendente.
-- Cada execução fica registrada em `adherence_runs` com o diff.
-- -----------------------------------------------------------------------------
create or replace function private.adherence_cron_tick()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o record;
  v_today date;
  v_h int;
  v_run uuid;
  v_stats jsonb;
  v_all jsonb := '[]'::jsonb;
begin
  for o in select org.id from public.organizations org where org.deleted_at is null and org.status = 'active' loop
    v_today := private.adherence_today(o.id);
    select coalesce(s.generation_horizon_days, 7) into v_h from public.adherence_settings s where s.organization_id = o.id;
    v_h := coalesce(v_h, 7);

    insert into public.adherence_runs (organization_id, kind, date_from, date_to)
    values (o.id, 'daily', v_today - 1, v_today + v_h) returning id into v_run;

    begin
      v_stats := jsonb_build_object(
        'current', private.adherence_generate(o.id, v_today - 1, v_today, null, null, null, true, false, v_run, 'planning_changed'));
      if v_h > 0 then
        v_stats := v_stats || jsonb_build_object(
          'future', private.adherence_generate(o.id, v_today + 1, v_today + v_h, null, null, null, true, false, v_run, 'planning_changed'));
      end if;
      v_stats := v_stats || jsonb_build_object('outbox', private.adherence_consume_outbox(500));
      update public.adherence_runs set status = 'completed', finished_at = now(), stats = v_stats where id = v_run;
    exception when others then
      update public.adherence_runs set status = 'failed', finished_at = now(), error_message = left(sqlerrm, 1000) where id = v_run;
    end;

    v_all := v_all || jsonb_build_object('organization_id', o.id, 'run_id', v_run);
  end loop;
  return v_all;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Superfície de execução (§62)
--
-- O default ACL do esquema `private` concede EXECUTE a `authenticated` — é o
-- que permite à view chamar `adherence_today` e `adherence_status_code` sob
-- security invoker. O motor, não: só o banco (rotina programada, gatilho do
-- outbox) e as rotinas públicas autorizadas da migration seguinte o chamam.
-- -----------------------------------------------------------------------------
revoke execute on function
  private.adherence_generate(uuid, date, date, uuid, uuid, text, boolean, boolean, uuid, text),
  private.adherence_match_execution(uuid, text, uuid),
  private.adherence_consume_outbox(integer),
  private.adherence_cron_tick(),
  private.adherence_seed_defaults(uuid),
  private.adherence_expected(uuid, date, date, uuid, uuid, text),
  private.adherence_planned_fleet(uuid, date, uuid, uuid),
  private.adherence_resolve_rule(uuid, date, uuid, uuid, uuid, text),
  private.adherence_leader_at(uuid, uuid, uuid, date),
  private.vehicle_status_at(uuid, date, text),
  private.adherence_local_ts(uuid, date, time, boolean)
from public, anon, authenticated;
