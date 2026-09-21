-- =============================================================================
-- ETAPA 06 · HISTÓRICO E AUDITORIA DO VEÍCULO
--
-- O §41 pede uma linha do tempo: data, evento, responsável, informação
-- anterior, informação nova e motivo. Essa informação já existe, espalhada por
-- quatro lugares que registram coisas diferentes e por boas razões:
--
--   audit_logs                     o que mudou no cadastro, campo a campo
--   vehicle_status_history         a situação cadastral, com motivo
--   vehicle_operation_assignments  a vigência de cada alocação
--   vehicle_odometer_readings      cada leitura, inclusive as superadas
--
-- Criar uma quinta tabela de "eventos do veículo" seria criar uma auditoria
-- concorrente — exatamente o que o §63 proíbe. Estas views apenas leem as
-- quatro. Ambas são `security_invoker`: quem não enxerga `audit_logs` não passa
-- a enxergar por causa de uma view.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Histórico de alocação, já com os nomes e com a vigência resolvida
--
-- O PostgREST não consegue inferir o caminho até `operations` e `states`
-- porque as FKs que garantem a coerência são compostas (organização→operação→
-- cidade, e cidade→estado). Resolver aqui é melhor do que afrouxar as FKs para
-- agradar o gerador de joins.
-- -----------------------------------------------------------------------------
create or replace view public.vehicle_assignment_history
with (security_invoker = on) as
select
  a.id,
  a.organization_id,
  a.vehicle_id,
  a.operation_id,
  op.name                      as operation_name,
  a.state_id,
  st.uf                        as state_uf,
  a.city_id,
  ci.name                      as city_name,
  a.effective_from,
  a.effective_to,
  a.reason,
  a.created_at,
  a.created_by,
  p.full_name                  as created_by_name,
  (a.effective_from <= current_date
   and (a.effective_to is null or a.effective_to >= current_date)) as is_current,
  (a.effective_from > current_date)                               as is_scheduled
from public.vehicle_operation_assignments a
join public.operations op on op.id = a.operation_id
join public.cities ci     on ci.id = a.city_id
join public.states st     on st.id = a.state_id
left join public.profiles p on p.user_id = a.created_by;

comment on view public.vehicle_assignment_history is
  'Histórico de alocação do veículo com operação, cidade e UF resolvidas, e a vigência decidida pela data de hoje.';

grant select on public.vehicle_assignment_history to authenticated;

-- -----------------------------------------------------------------------------
-- Linha do tempo do veículo
-- -----------------------------------------------------------------------------
create or replace view public.vehicle_timeline
with (security_invoker = on) as
select
  l.id,
  l.organization_id,
  l.entity_id::uuid                             as vehicle_id,
  l.created_at                                  as occurred_at,
  case l.action
    when 'INSERT' then 'vehicle.created'
    when 'DELETE' then 'vehicle.deleted'
    else 'vehicle.updated'
  end                                           as event_type,
  l.changed_fields                              as fields,
  l.old_data                                    as previous_value,
  l.new_data                                    as new_value,
  null::text                                    as reason,
  l.user_id                                     as actor_id,
  p.full_name                                   as actor_name
from public.audit_logs l
left join public.profiles p on p.user_id = l.user_id
where l.entity_type = 'vehicles'

union all

select
  h.id,
  h.organization_id,
  h.vehicle_id,
  h.changed_at,
  'vehicle.status_changed',
  array['status']::text[],
  jsonb_build_object('status', h.previous_status),
  jsonb_build_object('status', h.new_status),
  h.reason,
  h.changed_by,
  p.full_name
from public.vehicle_status_history h
left join public.profiles p on p.user_id = h.changed_by

union all

select
  a.id,
  a.organization_id,
  a.vehicle_id,
  a.created_at,
  'vehicle.assigned',
  array['operation_id', 'city_id']::text[],
  null::jsonb,
  jsonb_build_object('operation', op.name, 'city', ci.name, 'uf', st.uf,
                     'effective_from', a.effective_from, 'effective_to', a.effective_to),
  a.reason,
  a.created_by,
  p.full_name
from public.vehicle_operation_assignments a
join public.operations op on op.id = a.operation_id
join public.cities ci     on ci.id = a.city_id
join public.states st     on st.id = a.state_id
left join public.profiles p on p.user_id = a.created_by

union all

select
  r.id,
  r.organization_id,
  r.vehicle_id,
  r.created_at,
  case r.source when 'manual_correction' then 'vehicle.odometer_corrected' else 'vehicle.odometer_recorded' end,
  array['odometer_km']::text[],
  null::jsonb,
  jsonb_build_object('odometer_km', r.odometer_km, 'reading_date', r.reading_date, 'source', r.source),
  r.notes,
  r.created_by,
  p.full_name
from public.vehicle_odometer_readings r
left join public.profiles p on p.user_id = r.created_by;

comment on view public.vehicle_timeline is
  'Linha do tempo do veículo montada sobre as fontes que já existem: auditoria do cadastro, histórico de situação, alocações e leituras de hodômetro. Não é uma auditoria concorrente — é a leitura das quatro.';

grant select on public.vehicle_timeline to authenticated;

create index if not exists audit_logs_vehicle_entity_idx
  on public.audit_logs (entity_id, created_at desc) where entity_type = 'vehicles';
