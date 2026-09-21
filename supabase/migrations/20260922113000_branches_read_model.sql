-- =============================================================================
-- ETAPA 09 · READ MODEL DAS FILIAIS
--
-- Views com `security_invoker`: toda política das tabelas de baixo continua
-- valendo. A listagem nunca mostra uma filial que a política esconderia, porque
-- é a mesma política.
--
-- §67 pede consultas agregadas e proíbe N+1. Os contadores de operações,
-- colaboradores e veículos são resolvidos em subconsultas laterais dentro da
-- própria view — uma consulta para a tela inteira, e não uma por linha.
--
-- Colaboradores e veículos são contados por identidade DISTINTA (§40): alguém
-- com dois assignments históricos na mesma filial é uma pessoa, não duas.
-- =============================================================================

create or replace view public.branch_directory
with (security_invoker = on) as
select
  u.id,
  u.organization_id,
  u.unit_type,
  u.code,
  u.name,
  u.legal_name,
  u.document_number,
  u.status,
  u.status_reason,
  u.notes,

  u.postal_code,
  u.street,
  u.street_number,
  u.complement,
  u.district,
  u.state_id,
  st.uf                    as state_uf,
  u.city_id,
  ci.name                  as city_name,

  counts.operation_count,
  counts.employee_count,
  counts.vehicle_count,
  counts.cost_center_count,

  u.deleted_at,
  u.created_at,
  u.created_by,
  u.updated_at,
  u.updated_by
from public.organization_units u
left join public.states st on st.id = u.state_id
left join public.cities ci on ci.id = u.city_id
left join lateral (
  select
    (select count(*)
       from public.organization_unit_operations o
      where o.organization_unit_id = u.id
        and (o.effective_to is null or o.effective_to >= current_date)) as operation_count,
    (select count(distinct a.employee_id)
       from public.employee_assignments a
       join public.employees e on e.id = a.employee_id
      where a.organization_unit_id = u.id
        and a.is_current
        and e.deleted_at is null) as employee_count,
    (select count(*)
       from public.vehicles v
      where v.organization_unit_id = u.id
        and v.deleted_at is null) as vehicle_count,
    (select count(*)
       from public.cost_centers c
      where c.organization_unit_id = u.id
        and c.deleted_at is null) as cost_center_count
) counts on true;

comment on view public.branch_directory is
  'Read model de Filiais: unidade, endereço físico e contadores agregados de operações, colaboradores, veículos e centros de custo. security_invoker.';

grant select on public.branch_directory to authenticated;

-- -----------------------------------------------------------------------------
-- branch_operation_directory — os vínculos, com a operação resolvida
-- -----------------------------------------------------------------------------
create or replace view public.branch_operation_directory
with (security_invoker = on) as
select
  o.id,
  o.organization_id,
  o.organization_unit_id,
  u.name                   as branch_name,
  u.code                   as branch_code,
  o.operation_id,
  op.code                  as operation_code,
  op.name                  as operation_name,
  op.status                as operation_status,
  o.effective_from,
  o.effective_to,
  (o.effective_to is null or o.effective_to >= current_date) as is_current,
  o.notes,
  o.created_at,
  o.created_by,
  o.updated_at,
  o.updated_by,
  -- §47: quantos veículos daquela filial rodam naquela operação hoje. É o
  -- número que a multisseleção mostra ao lado de cada operação, e o mesmo que
  -- a análise de impacto usa antes de desvincular.
  (select count(distinct v.id)
     from public.vehicles v
     join public.vehicle_operation_assignments va
       on va.vehicle_id = v.id
      and (va.effective_to is null or va.effective_to >= current_date)
    where v.organization_unit_id = o.organization_unit_id
      and va.operation_id = o.operation_id
      and v.deleted_at is null) as vehicle_count
from public.organization_unit_operations o
join public.organization_units u on u.id = o.organization_unit_id
join public.operations op        on op.id = o.operation_id;

comment on view public.branch_operation_directory is
  'Vínculos filial × operação com vigência, a operação resolvida e a frota daquela combinação. security_invoker.';

grant select on public.branch_operation_directory to authenticated;

-- =============================================================================
-- public.branch_summary — os seis indicadores do §40
--
-- Contados sem duplicidade e dentro do que a RLS deixa o chamador enxergar:
-- SECURITY INVOKER de propósito, porque um total calculado fora da RLS seria um
-- vazamento por agregação (§64).
-- =============================================================================
create or replace function public.branch_summary(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select b.* from public.branch_directory b
     where b.organization_id = p_organization_id
       and b.deleted_at is null
  )
  select jsonb_build_object(
    'total_branches',   (select count(*) from visible),
    'active_branches',  (select count(*) from visible where status = 'active'),
    'inactive_branches',(select count(*) from visible where status <> 'active'),
    'linked_operations',(select count(distinct o.operation_id)
                           from public.branch_operation_directory o
                          where o.organization_id = p_organization_id
                            and o.is_current),
    'linked_employees', (select count(distinct a.employee_id)
                           from public.employee_assignments a
                           join public.employees e on e.id = a.employee_id
                          where a.organization_id = p_organization_id
                            and a.is_current
                            and e.deleted_at is null
                            and a.organization_unit_id in (select id from visible)),
    'linked_vehicles',  (select count(distinct v.id)
                           from public.vehicles v
                          where v.organization_id = p_organization_id
                            and v.deleted_at is null
                            and v.organization_unit_id in (select id from visible))
  );
$$;

revoke execute on function public.branch_summary(uuid) from public, anon;
grant  execute on function public.branch_summary(uuid) to authenticated;

-- =============================================================================
-- public.branch_employees — §48
--
-- Lê o cadastro mestre. Não duplica a base de pessoas, e respeita o escopo:
-- `employee_directory` é security_invoker e já aplica as políticas de
-- colaboradores, então quem não alcança a pessoa não a vê aqui.
-- =============================================================================
create or replace function public.branch_employees(
  p_organization_unit_id uuid,
  p_limit                integer default 200
)
returns table (
  employee_id     uuid,
  full_name       text,
  employee_code   text,
  job_position    text,
  operation_name  text,
  city_name       text,
  leader_name     text,
  status          text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_units where id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view_employees') then
    raise exception 'Você não possui permissão para consultar os colaboradores da filial.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select e.id, e.full_name, e.employee_code, e.job_position_name,
           e.operation_name, e.work_location_name, e.manager_name, e.employment_status
      from public.employee_directory e
     where e.organization_unit_id = p_organization_unit_id
       and e.deleted_at is null
     order by e.full_name
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke execute on function public.branch_employees(uuid, integer) from public, anon;
grant  execute on function public.branch_employees(uuid, integer) to authenticated;

-- =============================================================================
-- public.branch_vehicles — §49
-- =============================================================================
create or replace function public.branch_vehicles(
  p_organization_unit_id uuid,
  p_limit                integer default 200
)
returns table (
  vehicle_id     uuid,
  fleet_code     text,
  license_plate  text,
  vehicle_type   text,
  operation_name text,
  city_name      text,
  status         text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_units where id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view_vehicles') then
    raise exception 'Você não possui permissão para consultar a frota da filial.'
      using errcode = 'insufficient_privilege';
  end if;

  -- `vehicle_directory` é security_invoker e já aplica o escopo por operação:
  -- quem não alcança o veículo não o vê aqui, nem no contador.
  return query
    select v.id, v.fleet_code, v.license_plate, v.vehicle_type_name,
           v.operation_name, v.city_name, v.status
      from public.vehicle_directory v
     where v.organization_unit_id = p_organization_unit_id
       and v.deleted_at is null
     order by v.fleet_code nulls last, v.license_plate
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke execute on function public.branch_vehicles(uuid, integer) from public, anon;
grant  execute on function public.branch_vehicles(uuid, integer) to authenticated;

-- =============================================================================
-- public.branch_audit_trail — §50
--
-- A aba Histórico. SECURITY DEFINER porque precisa ler `audit_logs`, e confere
-- `branches.view_audit` antes de devolver qualquer linha.
-- =============================================================================
create or replace function public.branch_audit_trail(
  p_organization_unit_id uuid,
  p_limit                integer default 100
)
returns table (
  id             uuid,
  entity_type    text,
  action         text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  actor_name     text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_units where id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view_audit') then
    raise exception 'Você não possui permissão para ler o histórico da filial.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.id, a.entity_type, a.action, a.changed_fields, a.old_data, a.new_data,
           e.full_name, a.created_at
      from public.audit_logs a
      left join public.organization_memberships m
        on m.organization_id = a.organization_id and m.user_id = a.user_id
      left join public.employees e
        on e.organization_id = a.organization_id and e.id = m.employee_id
     where a.organization_id = v_org
       and (
         (a.entity_type = 'public.organization_units'
          and a.entity_id = p_organization_unit_id::text)
         or (a.entity_type = 'public.organization_unit_operations'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
         or (a.entity_type = 'public.vehicle_unit_assignments'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
       )
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.branch_audit_trail(uuid, integer) from public, anon;
grant  execute on function public.branch_audit_trail(uuid, integer) to authenticated;
