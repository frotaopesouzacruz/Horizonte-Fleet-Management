-- =============================================================================
-- ETAPA 06 · READ MODEL DA FROTA
--
-- Uma view com security_invoker: toda política das tabelas de baixo continua
-- valendo, inclusive o escopo por operação. A lista nunca mostra um veículo que
-- a política esconderia, porque é a mesma política.
-- =============================================================================

create or replace view public.vehicle_directory
with (security_invoker = on) as
select
  v.id,
  v.organization_id,
  v.fleet_code,
  v.license_plate,
  v.vin,
  v.renavam,
  v.status,
  v.ownership_type,
  v.asset_value,
  v.antt_code,
  v.has_tachograph,
  v.tachograph_number,
  v.notes,
  v.manufacture_year,
  v.model_year,
  v.deleted_at,
  v.created_at,
  v.updated_at,

  v.vehicle_type_id,
  vt.name                      as vehicle_type_name,
  vt.code                      as vehicle_type_code,
  v.vehicle_subcategory_id,
  vs.name                      as vehicle_subcategory_name,
  v.vehicle_model_id,
  vmo.name                     as vehicle_model_name,
  vmo.vehicle_make_id,
  vmk.name                     as vehicle_make_name,

  v.organization_unit_id,
  ou.name                      as organization_unit_name,
  v.cost_center_id,
  cc.name                      as cost_center_name,

  a.id                         as assignment_id,
  a.operation_id,
  op.name                      as operation_name,
  a.state_id,
  st.uf                        as state_uf,
  st.name                      as state_name,
  a.city_id,
  ci.name                      as city_name,
  a.effective_from             as assigned_since,

  o.odometer_km                as current_odometer_km,
  o.reading_date               as odometer_reading_date,
  o.source                     as odometer_source,

  -- mesma forma de comparação usada pela busca, para que "sprinter" encontre
  -- "Sprinter" e o índice sirva para alguma coisa
  private.normalize_label(
    concat_ws(' ', v.fleet_code, v.license_plate, vmk.name, vmo.name, vt.name)
  )                            as search_text
from public.vehicles v
join public.vehicle_types vt          on vt.id = v.vehicle_type_id
left join public.vehicle_subcategories vs on vs.id = v.vehicle_subcategory_id
left join public.vehicle_models vmo   on vmo.id = v.vehicle_model_id
left join public.vehicle_makes vmk    on vmk.id = vmo.vehicle_make_id
left join public.organization_units ou on ou.id = v.organization_unit_id
left join public.cost_centers cc      on cc.id = v.cost_center_id
left join public.vehicle_operation_assignments a
       on a.vehicle_id = v.id and a.effective_to is null
left join public.operations op        on op.id = a.operation_id
left join public.states st            on st.id = a.state_id
left join public.cities ci            on ci.id = a.city_id
left join lateral (
  -- a leitura vigente: a mais recente que ninguém corrigiu
  select r.odometer_km, r.reading_date, r.source
    from public.vehicle_odometer_readings r
   where r.vehicle_id = v.id and r.superseded_by is null
   order by r.reading_date desc, r.created_at desc
   limit 1
) o on true;

comment on view public.vehicle_directory is
  'Read model do Cadastro de Frotas: veículo, classificação, alocação vigente e leitura de hodômetro vigente. security_invoker, então o escopo por operação continua valendo.';

grant select on public.vehicle_directory to authenticated;
