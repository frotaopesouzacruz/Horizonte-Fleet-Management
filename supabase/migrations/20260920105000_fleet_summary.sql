-- =============================================================================
-- ETAPA 06 · INDICADORES DA FROTA
--
-- Uma função, uma varredura, security invoker: conta exatamente os veículos que
-- o chamador pode ver, escopo por operação incluído. Nada é contado no
-- navegador, e o valor patrimonial soma apenas o que se conhece — NULL não é
-- zero, e um somatório que finge o contrário é pior que um somatório ausente.
-- =============================================================================

create or replace function public.vehicle_summary(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select
      d.id, d.status, d.ownership_type, d.asset_value,
      d.operation_id, d.operation_name, d.city_id
    from public.vehicle_directory d
    where d.organization_id = p_organization_id
      and case
            when coalesce((p_filters ->> 'archived')::boolean, false) then d.deleted_at is not null
            else d.deleted_at is null
          end
      and (p_filters ->> 'status'      is null or d.status                 = p_filters ->> 'status')
      and (p_filters ->> 'ownership'   is null or d.ownership_type         = p_filters ->> 'ownership')
      and (p_filters ->> 'type'        is null or d.vehicle_type_id        = (p_filters ->> 'type')::uuid)
      and (p_filters ->> 'subcategory' is null or d.vehicle_subcategory_id = (p_filters ->> 'subcategory')::uuid)
      and (p_filters ->> 'operation'   is null or d.operation_id           = (p_filters ->> 'operation')::uuid)
      and (p_filters ->> 'state'       is null or d.state_id               = (p_filters ->> 'state')::smallint)
      and (p_filters ->> 'city'        is null or d.city_id                = (p_filters ->> 'city')::integer)
      and (p_filters ->> 'unit'        is null or d.organization_unit_id   = (p_filters ->> 'unit')::uuid)
  ),
  totals as (
    select
      count(*)                                                     as total,
      count(*) filter (where status = 'active')                    as active,
      count(*) filter (where status <> 'active')                   as inactive,
      count(*) filter (where ownership_type = 'owned')             as owned,
      count(*) filter (where ownership_type in ('leased','rented')) as rented,
      count(*) filter (where operation_id is null)                 as unassigned,
      count(distinct operation_id)                                 as operation_count,
      coalesce(sum(asset_value), 0)::numeric                       as asset_value_total,
      count(*) filter (where asset_value is not null)              as asset_value_known,
      count(*) filter (where asset_value is null)                  as asset_value_unknown
    from scoped
  ),
  by_operation as (
    select
      s.operation_id,
      max(s.operation_name) as operation_name,
      count(*)              as vehicle_count
    from scoped s
    group by s.operation_id
  )
  select jsonb_build_object(
    'total',                t.total,
    'active',               t.active,
    'inactive',             t.inactive,
    'owned',                t.owned,
    'rented',               t.rented,
    'unassigned',           t.unassigned,
    'operation_count',      t.operation_count,
    'asset_value_total',    t.asset_value_total,
    'asset_value_known',    t.asset_value_known,
    'asset_value_unknown',  t.asset_value_unknown,
    'by_operation', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'operation_id',   b.operation_id,
                  'operation_name', coalesce(b.operation_name, 'Sem alocação'),
                  'vehicle_count',  b.vehicle_count
                )
                order by (b.operation_id is null), b.vehicle_count desc, b.operation_name
              )
         from by_operation b),
      '[]'::jsonb
    )
  )
  from totals t;
$$;

comment on function public.vehicle_summary(uuid, jsonb) is
  'Indicadores do Cadastro de Frotas numa única varredura. security invoker: conta exatamente os veículos que o chamador pode ver, incluindo o escopo por operação. asset_value soma apenas valores conhecidos — NULL nunca vira zero.';

revoke execute on function public.vehicle_summary(uuid, jsonb) from public, anon;
grant  execute on function public.vehicle_summary(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Impacto de remover uma cidade da cobertura de uma operação
--
-- A FK da alocação já recusa a remoção — o que faltava era poder explicar o
-- motivo antes de a pessoa tentar e receber um erro de integridade.
-- -----------------------------------------------------------------------------
create or replace function public.vehicles_blocking_coverage_removal(
  p_operation_id uuid,
  p_city_ids     integer[]
)
returns table (
  city_id       integer,
  city_name     text,
  vehicle_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.city_id, max(c.name), count(*)
    from public.vehicle_operation_assignments a
    join public.cities c on c.id = a.city_id
   where a.operation_id = p_operation_id
     and a.effective_to is null
     and a.city_id = any (coalesce(p_city_ids, array[]::integer[]))
   group by a.city_id
   order by 3 desc;
$$;

comment on function public.vehicles_blocking_coverage_removal(uuid, integer[]) is
  'Veículos hoje alocados nas cidades que se pretende remover da cobertura. A FK já recusa a remoção; isto permite explicar o motivo antes de tentar.';

revoke execute on function public.vehicles_blocking_coverage_removal(uuid, integer[]) from public, anon;
grant  execute on function public.vehicles_blocking_coverage_removal(uuid, integer[]) to authenticated;

create index if not exists vehicles_org_ownership_idx
  on public.vehicles (organization_id, ownership_type) where deleted_at is null;
create index if not exists vehicles_org_subcategory_idx
  on public.vehicles (organization_id, vehicle_subcategory_id) where deleted_at is null;
