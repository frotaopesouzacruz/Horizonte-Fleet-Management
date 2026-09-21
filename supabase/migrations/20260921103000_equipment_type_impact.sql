-- =============================================================================
-- ETAPA 07 · ANÁLISE DE IMPACTO REAL
--
-- A fragilidade do HFC que esta etapa existe para corrigir: a função de
-- veículos impactados devolvia sempre lista vazia, e a tela dizia com toda a
-- confiança que inativar uma categoria não afetaria ninguém.
--
-- Aqui cada número vem de uma contagem. Quando uma dependência ainda não
-- existe no HFM — Checklist, Manutenção, Pneus — a resposta não é zero, é
-- `available: false`, e a interface escreve "não disponível nesta etapa"
-- (§35). Zero e "não sei" são respostas diferentes e o produto não pode
-- confundi-las.
-- =============================================================================

create or replace function public.equipment_type_impact(
  p_organization_id uuid,
  p_vehicle_type_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with vehicles_of_type as (
    select v.id, v.status, v.deleted_at, v.vehicle_subcategory_id
      from public.vehicles v
     where v.organization_id = p_organization_id
       and v.vehicle_type_id = p_vehicle_type_id
  ),
  current_assignment as (
    select a.vehicle_id, a.operation_id
      from public.vehicle_operation_assignments a
      join vehicles_of_type v on v.id = a.vehicle_id
     where a.effective_from <= current_date
       and (a.effective_to is null or a.effective_to >= current_date)
  ),
  by_operation as (
    select c.operation_id, max(o.name) as operation_name, count(*) as vehicle_count
      from current_assignment c
      join public.operations o on o.id = c.operation_id
     group by c.operation_id
  ),
  subs as (
    select s.id, s.is_active, s.deleted_at
      from public.vehicle_subcategories s
     where s.vehicle_type_id = p_vehicle_type_id
       and (s.organization_id is null or s.organization_id = p_organization_id)
  )
  select jsonb_build_object(
    'vehicles_total',     (select count(*) from vehicles_of_type where deleted_at is null),
    'vehicles_active',    (select count(*) from vehicles_of_type where deleted_at is null and status = 'active'),
    'vehicles_inactive',  (select count(*) from vehicles_of_type where deleted_at is null and status <> 'active'),
    'vehicles_archived',  (select count(*) from vehicles_of_type where deleted_at is not null),
    'vehicles_allocated', (select count(*) from current_assignment),

    'subcategories_total',  (select count(*) from subs where deleted_at is null),
    'subcategories_active', (select count(*) from subs where deleted_at is null and is_active),

    'operations_linked', (
      select count(*) from public.vehicle_type_operations t
       where t.organization_id = p_organization_id and t.vehicle_type_id = p_vehicle_type_id),
    'operations_with_vehicles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'operation_id', b.operation_id,
               'operation_name', b.operation_name,
               'vehicle_count', b.vehicle_count)
             order by b.vehicle_count desc, b.operation_name)
        from by_operation b), '[]'::jsonb),

    'apps_linked', (
      select count(*) from public.vehicle_type_apps t
       where t.organization_id = p_organization_id and t.vehicle_type_id = p_vehicle_type_id),

    'module_rules', (
      select count(*) from public.vehicle_type_module_rules r
       where r.organization_id = p_organization_id and r.vehicle_type_id = p_vehicle_type_id
         and r.effective_to is null),

    -- Dependências de módulos que ainda não existem. Não são zero: são
    -- desconhecidas, e a interface diz isso em vez de tranquilizar ninguém.
    'pending_modules', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'module_code', m.code, 'module_name', m.name, 'available', false)
             order by m.sort_order), '[]'::jsonb)
        from public.operational_modules m where not m.is_available)
  );
$$;

comment on function public.equipment_type_impact(uuid, uuid) is
  'Impacto real de alterar um tipo: veículos, subcategorias, operações com veículos alocados, aplicativos e regras de módulo. security invoker — conta o que o chamador pode ver. Módulos ainda não implementados aparecem como indisponíveis, nunca como zero.';

revoke execute on function public.equipment_type_impact(uuid, uuid) from public, anon;
grant  execute on function public.equipment_type_impact(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Impacto de inativar uma subcategoria (§32)
-- -----------------------------------------------------------------------------
create or replace function public.equipment_subcategory_impact(
  p_organization_id uuid,
  p_subcategory_id  uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'vehicles_total',  count(*) filter (where v.deleted_at is null),
    'vehicles_active', count(*) filter (where v.deleted_at is null and v.status = 'active'),
    'vehicles_archived', count(*) filter (where v.deleted_at is not null),
    'pending_modules', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'module_code', m.code, 'module_name', m.name, 'available', false)
             order by m.sort_order), '[]'::jsonb)
        from public.operational_modules m where not m.is_available)
  )
  from public.vehicles v
 where v.organization_id = p_organization_id
   and v.vehicle_subcategory_id = p_subcategory_id;
$$;

revoke execute on function public.equipment_subcategory_impact(uuid, uuid) from public, anon;
grant  execute on function public.equipment_subcategory_impact(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Impacto de retirar operações da elegibilidade (§33)
--
-- Retirar a operação não move veículo nenhum, e não deve mesmo. O que esta
-- função responde é quantos veículos daquele tipo estão alocados ali agora —
-- para que a decisão seja tomada sabendo o tamanho da regularização que ela
-- cria, e não depois.
-- -----------------------------------------------------------------------------
create or replace function public.equipment_type_operation_impact(
  p_organization_id uuid,
  p_vehicle_type_id uuid,
  p_operation_ids   uuid[]
)
returns table (
  operation_id   uuid,
  operation_name text,
  vehicle_count  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.operation_id, max(o.name), count(distinct a.vehicle_id)
    from public.vehicle_operation_assignments a
    join public.vehicles v on v.id = a.vehicle_id
    join public.operations o on o.id = a.operation_id
   where v.organization_id = p_organization_id
     and v.vehicle_type_id = p_vehicle_type_id
     and v.deleted_at is null
     and a.effective_from <= current_date
     and (a.effective_to is null or a.effective_to >= current_date)
     and a.operation_id = any (coalesce(p_operation_ids, array[]::uuid[]))
   group by a.operation_id
   order by 3 desc;
$$;

revoke execute on function public.equipment_type_operation_impact(uuid, uuid, uuid[]) from public, anon;
grant  execute on function public.equipment_type_operation_impact(uuid, uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Elegibilidade por operação (§20)
--
-- A regra só existe quando a organização a ligou. Sem restrição configurada,
-- qualquer operação aceita o tipo — e isso é uma decisão gravada, não a
-- consequência de uma tabela vazia.
-- -----------------------------------------------------------------------------
create or replace function public.vehicle_type_allows_operation(
  p_organization_id uuid,
  p_vehicle_type_id uuid,
  p_operation_id    uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not coalesce((
      select s.operation_restriction_enabled
        from public.vehicle_type_settings s
       where s.organization_id = p_organization_id
         and s.vehicle_type_id = p_vehicle_type_id), false)
    then true
    else exists (
      select 1 from public.vehicle_type_operations t
       where t.organization_id = p_organization_id
         and t.vehicle_type_id = p_vehicle_type_id
         and t.operation_id = p_operation_id)
  end;
$$;

comment on function public.vehicle_type_allows_operation(uuid, uuid, uuid) is
  'O tipo é admitido nesta operação? Falso apenas quando a organização ligou a restrição e a operação não está na lista. A ausência de vínculos nunca autoriza por omissão: quem decide é operation_restriction_enabled.';

revoke execute on function public.vehicle_type_allows_operation(uuid, uuid, uuid) from public, anon;
grant  execute on function public.vehicle_type_allows_operation(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Elegibilidade de módulo numa data (§29)
--
-- A consulta histórica de agosto lê a regra que valia em agosto. Mudar a
-- configuração hoje não reescreve o indicador de ontem.
-- -----------------------------------------------------------------------------
create or replace function public.vehicle_type_module_eligibility(
  p_organization_id uuid,
  p_vehicle_type_id uuid,
  p_module_code     text,
  p_capability      text,
  p_on_date         date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.is_eligible
      from public.vehicle_type_module_rules r
     where r.organization_id = p_organization_id
       and r.vehicle_type_id = p_vehicle_type_id
       and r.module_code = p_module_code
       and r.capability = p_capability
       and r.effective_from <= p_on_date
       and (r.effective_to is null or r.effective_to >= p_on_date)
     order by r.effective_from desc
     limit 1
  ), false);
$$;

comment on function public.vehicle_type_module_eligibility(uuid, uuid, text, text, date) is
  'Elegibilidade do tipo para um módulo numa capacidade e numa data. Sem regra configurada o padrão é falso: nenhum módulo opcional recebe o tipo por omissão (§55).';

revoke execute on function public.vehicle_type_module_eligibility(uuid, uuid, text, text, date) from public, anon;
grant  execute on function public.vehicle_type_module_eligibility(uuid, uuid, text, text, date) to authenticated;
