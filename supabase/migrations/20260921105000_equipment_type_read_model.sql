-- =============================================================================
-- ETAPA 07 · LEITURA DO MÓDULO
--
-- Três funções, e nenhuma delas devolve linhas para a aplicação contar depois:
-- subcategorias, veículos, operações e aplicativos saem agregados do banco
-- (§64). Carregar todos os veículos para descobrir quantos são de cada tipo é
-- exatamente o que não se faz aqui.
--
-- Todas são `security invoker`: contam o que o chamador pode ver, e o
-- isolamento entre organizações continua sendo o do RLS.
--
-- `effective_status` junta as duas metades do status: `vehicle_types.is_active`
-- para o tipo que a organização criou e `vehicle_type_settings.is_enabled` para
-- o tipo global que ela decidiu não usar. Quem lê a tabela vê um status só.
-- =============================================================================

create or replace function public.list_equipment_types(
  p_organization_id uuid,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  id uuid, code text, name text, description text, scope text,
  is_active boolean, is_enabled boolean, effective_status text,
  operation_restriction_enabled boolean, requires_subcategory boolean,
  subcategory_count bigint, vehicle_count bigint, operation_count bigint,
  app_count bigint, module_rule_count bigint, updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id, t.code, t.name, t.description,
    case when t.organization_id is null then 'global' else 'organization' end as scope,
    t.is_active,
    coalesce(s.is_enabled, true) as is_enabled,
    case when t.is_active and coalesce(s.is_enabled, true) then 'active' else 'inactive' end as effective_status,
    coalesce(s.operation_restriction_enabled, false),
    coalesce(s.requires_subcategory, false),
    (select count(*) from public.vehicle_subcategories sc
      where sc.vehicle_type_id = t.id and sc.deleted_at is null and sc.is_active
        and (sc.organization_id is null or sc.organization_id = p_organization_id)),
    (select count(*) from public.vehicles v
      where v.vehicle_type_id = t.id and v.organization_id = p_organization_id and v.deleted_at is null),
    (select count(*) from public.vehicle_type_operations o
      where o.vehicle_type_id = t.id and o.organization_id = p_organization_id),
    (select count(*) from public.vehicle_type_apps a
      where a.vehicle_type_id = t.id and a.organization_id = p_organization_id),
    (select count(*) from public.vehicle_type_module_rules r
      where r.vehicle_type_id = t.id and r.organization_id = p_organization_id
        and r.effective_to is null and r.is_eligible),
    greatest(t.updated_at, coalesce(s.updated_at, t.updated_at))
  from public.vehicle_types t
  left join public.vehicle_type_settings s
         on s.vehicle_type_id = t.id and s.organization_id = p_organization_id
 where t.deleted_at is null
   and (t.organization_id is null or t.organization_id = p_organization_id)
   and (p_filters ->> 'status' is null
        or (p_filters ->> 'status' = 'active' and t.is_active and coalesce(s.is_enabled, true))
        or (p_filters ->> 'status' = 'inactive' and not (t.is_active and coalesce(s.is_enabled, true))))
   and (p_filters ->> 'scope' is null
        or (p_filters ->> 'scope' = 'global' and t.organization_id is null)
        or (p_filters ->> 'scope' = 'organization' and t.organization_id is not null))
   and (p_filters ->> 'q' is null
        or private.normalize_label(t.name) like '%' || private.normalize_label(p_filters ->> 'q') || '%'
        or lower(t.code) like '%' || lower(p_filters ->> 'q') || '%'
        or private.normalize_label(coalesce(t.description, '')) like '%' || private.normalize_label(p_filters ->> 'q') || '%')
   and (p_filters ->> 'operation' is null
        or exists (select 1 from public.vehicle_type_operations o
                    where o.vehicle_type_id = t.id and o.organization_id = p_organization_id
                      and o.operation_id = (p_filters ->> 'operation')::uuid))
   and (p_filters ->> 'app' is null
        or exists (select 1 from public.vehicle_type_apps a
                    where a.vehicle_type_id = t.id and a.organization_id = p_organization_id
                      and a.app_id = (p_filters ->> 'app')::uuid))
 order by t.sort_order, private.normalize_label(t.name);
$$;

comment on function public.list_equipment_types(uuid, jsonb) is
  'Tipos visíveis para a organização — catálogo base e próprios — com as contagens já agregadas. Uma varredura, sem N+1 por linha na aplicação.';

revoke execute on function public.list_equipment_types(uuid, jsonb) from public, anon;
grant  execute on function public.list_equipment_types(uuid, jsonb) to authenticated;

create or replace function public.equipment_type_summary(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select t.id, t.is_active, coalesce(s.is_enabled, true) as is_enabled
      from public.vehicle_types t
      left join public.vehicle_type_settings s
             on s.vehicle_type_id = t.id and s.organization_id = p_organization_id
     where t.deleted_at is null
       and (t.organization_id is null or t.organization_id = p_organization_id)
  )
  select jsonb_build_object(
    'total',    (select count(*) from scoped),
    'active',   (select count(*) from scoped where is_active and is_enabled),
    'inactive', (select count(*) from scoped where not (is_active and is_enabled)),
    'subcategories_active', (
      select count(*) from public.vehicle_subcategories sc
       where sc.deleted_at is null and sc.is_active
         and (sc.organization_id is null or sc.organization_id = p_organization_id)
         and sc.vehicle_type_id in (select id from scoped)),
    'vehicles_linked', (
      select count(*) from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null
         and v.vehicle_type_id in (select id from scoped)),
    'vehicles_without_subcategory', (
      select count(*) from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null
         and v.vehicle_subcategory_id is null)
  );
$$;

revoke execute on function public.equipment_type_summary(uuid) from public, anon;
grant  execute on function public.equipment_type_summary(uuid) to authenticated;

create or replace function public.get_equipment_type(p_organization_id uuid, p_vehicle_type_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'code', t.code, 'name', t.name, 'description', t.description,
    'scope', case when t.organization_id is null then 'global' else 'organization' end,
    'is_active', t.is_active,
    'is_enabled', coalesce(s.is_enabled, true),
    'updated_at', t.updated_at,
    'settings', jsonb_build_object(
      'operation_restriction_enabled', coalesce(s.operation_restriction_enabled, false),
      'requires_subcategory', coalesce(s.requires_subcategory, false),
      'notes', s.notes),
    'subcategories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sc.id, 'name', sc.name, 'description', sc.description,
               'is_active', sc.is_active,
               'scope', case when sc.organization_id is null then 'global' else 'organization' end,
               'vehicle_count', (select count(*) from public.vehicles v
                                  where v.vehicle_subcategory_id = sc.id
                                    and v.organization_id = p_organization_id
                                    and v.deleted_at is null))
             order by sc.organization_id nulls first, sc.sort_order, sc.name)
        from public.vehicle_subcategories sc
       where sc.vehicle_type_id = t.id and sc.deleted_at is null
         and (sc.organization_id is null or sc.organization_id = p_organization_id)), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object('operation_id', o.operation_id, 'operation_name', op.name,
                                          'operation_status', op.status)
             order by op.name)
        from public.vehicle_type_operations o
        join public.operations op on op.id = o.operation_id
       where o.vehicle_type_id = t.id and o.organization_id = p_organization_id), '[]'::jsonb),
    'apps', coalesce((
      select jsonb_agg(jsonb_build_object('app_id', a.app_id, 'app_name', ap.name)
             order by ap.name)
        from public.vehicle_type_apps a
        join public.operational_apps ap on ap.id = a.app_id
       where a.vehicle_type_id = t.id and a.organization_id = p_organization_id), '[]'::jsonb),
    'module_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'module_code', r.module_code, 'capability', r.capability,
               'is_eligible', r.is_eligible, 'effective_from', r.effective_from,
               'reason', r.reason)
             order by r.module_code, r.capability)
        from public.vehicle_type_module_rules r
       where r.vehicle_type_id = t.id and r.organization_id = p_organization_id
         and r.effective_to is null), '[]'::jsonb)
  )
  from public.vehicle_types t
  left join public.vehicle_type_settings s
         on s.vehicle_type_id = t.id and s.organization_id = p_organization_id
 where t.id = p_vehicle_type_id
   and t.deleted_at is null
   and (t.organization_id is null or t.organization_id = p_organization_id);
$$;

revoke execute on function public.get_equipment_type(uuid, uuid) from public, anon;
grant  execute on function public.get_equipment_type(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Histórico do tipo (§39, §40)
--
-- Uma consulta sobre `audit_logs`, não uma tabela de eventos própria: o §39 pede
-- a estrutura oficial de auditoria, e criar outra seria a auditoria concorrente
-- que o §63 da etapa anterior já proibia. Pega o tipo e tudo que pende dele.
-- -----------------------------------------------------------------------------
create or replace function public.equipment_type_history(
  p_organization_id uuid,
  p_vehicle_type_id uuid
)
returns table (
  id uuid, occurred_at timestamptz, entity text, action text,
  fields text[], previous_value jsonb, new_value jsonb, actor_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.created_at, l.entity_type, l.action, l.changed_fields,
         l.old_data, l.new_data, p.full_name
    from public.audit_logs l
    left join public.profiles p on p.user_id = l.user_id
   where l.organization_id is not distinct from p_organization_id
     and (
       (l.entity_type = 'vehicle_types' and l.entity_id = p_vehicle_type_id::text)
       or (l.entity_type in ('vehicle_subcategories', 'vehicle_type_operations', 'vehicle_type_apps',
                             'vehicle_type_module_rules', 'vehicle_type_settings')
           and coalesce(l.new_data ->> 'vehicle_type_id', l.old_data ->> 'vehicle_type_id')
               = p_vehicle_type_id::text)
     )
   order by l.created_at desc
   limit 200;
$$;

comment on function public.equipment_type_history(uuid, uuid) is
  'Trilha de auditoria do tipo e de tudo que pende dele — subcategorias, operações, aplicativos, elegibilidade e configuração. security invoker: quem não enxerga audit_logs não passa a enxergar por aqui.';

revoke execute on function public.equipment_type_history(uuid, uuid) from public, anon;
grant  execute on function public.equipment_type_history(uuid, uuid) to authenticated;
