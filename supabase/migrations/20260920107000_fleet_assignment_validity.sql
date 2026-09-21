-- =============================================================================
-- ETAPA 06 · A ALOCAÇÃO VIGENTE É A QUE COBRE HOJE
--
-- Os testes funcionais expuseram três defeitos que só aparecem quando uma
-- transferência é programada para o futuro — que é exatamente o caso do §27
-- ("até 31/08 Contagem, a partir de 01/09 Betim"):
--
--   1. `vehicle_directory` tratava "alocação vigente" como "a linha em aberto".
--      Ao programar a mudança para amanhã, a tela passava a mostrar a cidade
--      nova hoje. A vigência não é a ausência de fim: é o intervalo que contém
--      a data de hoje.
--
--   2. `archive_vehicle` encerrava a linha em aberto com a data de hoje. Se
--      essa linha ainda não tinha começado, o intervalo resultante ficava
--      invertido e o gatilho de sobreposição abortava com uma mensagem de
--      range do PostgreSQL. Arquivar um veículo nunca deveria falhar por isso.
--
--   3. Nada impedia gravar `effective_to < effective_from` diretamente. O
--      gatilho de sobreposição recusava por acidente, com a mensagem errada.
--
-- A regra passa a ser explícita e escrita uma única vez: o intervalo é fechado
-- nos dois lados, `effective_to >= effective_from`, e a linha vigente é a que
-- contém `current_date`. Uma alocação futura continua existindo e passa a ser
-- exposta separadamente como "programada", porque esconder uma transferência
-- já agendada é como não tê-la agendado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O intervalo nunca pode ser invertido
-- -----------------------------------------------------------------------------
alter table public.vehicle_operation_assignments
  drop constraint if exists vehicle_assignments_period_check;

alter table public.vehicle_operation_assignments
  add constraint vehicle_assignments_period_check
  check (effective_to is null or effective_to >= effective_from);

comment on constraint vehicle_assignments_period_check on public.vehicle_operation_assignments is
  'O fim da vigência nunca antecede o início. Sem isto, encerrar uma alocação ainda não iniciada produzia um intervalo invertido.';

-- -----------------------------------------------------------------------------
-- 2. Encerrar uma alocação nunca inverte o intervalo
--
-- Encerrar na data de início é o mais próximo de "não chegou a valer" que se
-- pode dizer sem apagar a linha — e apagar seria perder o registro de que a
-- transferência havia sido programada e por quem.
-- -----------------------------------------------------------------------------
create or replace function public.end_vehicle_assignment(
  p_vehicle_id uuid,
  p_effective_to date default current_date,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.manage_assignment') then
    raise exception 'Você não possui permissão para alocar veículos.' using errcode = 'insufficient_privilege';
  end if;

  update public.vehicle_operation_assignments
     set effective_to = greatest(coalesce(p_effective_to, current_date), effective_from),
         reason = coalesce(p_reason, reason)
   where vehicle_id = p_vehicle_id and effective_to is null;

  if not found then
    raise exception 'Este veículo não possui alocação vigente.' using errcode = 'no_data_found';
  end if;

  perform private.emit_event(v_org, 'vehicle.assignment_ended', 'vehicle', p_vehicle_id,
    jsonb_build_object('effective_to', p_effective_to, 'reason', p_reason));
end;
$$;

revoke execute on function public.end_vehicle_assignment(uuid, date, text) from public, anon;
grant  execute on function public.end_vehicle_assignment(uuid, date, text) to authenticated;

create or replace function public.archive_vehicle(p_vehicle_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.vehicles where id = p_vehicle_id for update;
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.archive') then
    raise exception 'Você não possui permissão para arquivar veículos.' using errcode = 'insufficient_privilege';
  end if;

  -- Um veículo arquivado não continua alocado a uma operação: seria um ativo
  -- fora do cadastro ocupando uma cidade nos indicadores de alguém.
  update public.vehicle_operation_assignments
     set effective_to = greatest(current_date, effective_from),
         reason = coalesce(reason, 'Veículo arquivado.')
   where vehicle_id = p_vehicle_id and effective_to is null;

  perform set_config('hfm.vehicle_status_reason', coalesce(p_reason, 'Cadastro arquivado.'), true);
  update public.vehicles
     set status = 'inactive', deleted_at = now(), deleted_by = (select auth.uid())
   where id = p_vehicle_id and deleted_at is null;

  perform private.emit_event(v_org, 'vehicle.archived', 'vehicle', p_vehicle_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.archive_vehicle(uuid, text) from public, anon;
grant  execute on function public.archive_vehicle(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Escopo de leitura: vigente OU programada
--
-- Um veículo que muda de operação na semana que vem já pertence à operação de
-- destino para efeito de quem precisa prepará-lo. O que ele não faz é voltar a
-- ser visível para a operação de origem depois que a vigência terminou, nem
-- cair no balde "sem alocação", que exige permissão administrativa própria.
-- -----------------------------------------------------------------------------
create or replace function private.vehicle_in_scope(p_organization_id uuid, p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
    or exists (
         select 1 from public.vehicle_operation_assignments a
          where a.vehicle_id = p_vehicle_id
            and (a.effective_to is null or a.effective_to >= current_date)
            and a.operation_id in (select private.accessible_operation_ids()))
    or (p_organization_id in (select private.permitted_org_ids('vehicles.view_unassigned'))
        and not exists (
              select 1 from public.vehicle_operation_assignments a
               where a.vehicle_id = p_vehicle_id
                 and (a.effective_to is null or a.effective_to >= current_date)));
$$;

revoke execute on function private.vehicle_in_scope(uuid, uuid) from public, anon;
grant  execute on function private.vehicle_in_scope(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. O read model separa vigente de programada
-- -----------------------------------------------------------------------------
drop view if exists public.vehicle_directory;

create view public.vehicle_directory
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
  a.effective_to               as assigned_until,

  -- A transferência já programada. Mostrá-la é o que impede alguém de agendar
  -- a mesma mudança duas vezes por não enxergar a primeira.
  f.id                         as scheduled_assignment_id,
  f.operation_id               as scheduled_operation_id,
  fop.name                     as scheduled_operation_name,
  f.city_id                    as scheduled_city_id,
  fci.name                     as scheduled_city_name,
  fst.uf                       as scheduled_state_uf,
  f.effective_from             as scheduled_from,

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
left join lateral (
  -- vigente: o intervalo que contém hoje
  select x.*
    from public.vehicle_operation_assignments x
   where x.vehicle_id = v.id
     and x.effective_from <= current_date
     and (x.effective_to is null or x.effective_to >= current_date)
   order by x.effective_from desc
   limit 1
) a on true
left join public.operations op        on op.id = a.operation_id
left join public.states st            on st.id = a.state_id
left join public.cities ci            on ci.id = a.city_id
left join lateral (
  -- programada: a próxima que ainda não começou
  select x.*
    from public.vehicle_operation_assignments x
   where x.vehicle_id = v.id and x.effective_from > current_date
   order by x.effective_from
   limit 1
) f on true
left join public.operations fop       on fop.id = f.operation_id
left join public.cities fci           on fci.id = f.city_id
left join public.states fst           on fst.id = f.state_id
left join lateral (
  -- a leitura vigente: a mais recente que ninguém corrigiu
  select r.odometer_km, r.reading_date, r.source
    from public.vehicle_odometer_readings r
   where r.vehicle_id = v.id and r.superseded_by is null
   order by r.reading_date desc, r.created_at desc
   limit 1
) o on true;

comment on view public.vehicle_directory is
  'Read model do Cadastro de Frotas: veículo, classificação, alocação vigente hoje, transferência programada e leitura de hodômetro vigente. security_invoker, então o escopo por operação continua valendo.';

grant select on public.vehicle_directory to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Indicadores: "sem alocação" é sem vigente e sem programada
-- -----------------------------------------------------------------------------
create or replace function public.vehicle_summary(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select d.*
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
      count(*) filter (where operation_id is null
                         and scheduled_operation_id is null)       as unassigned,
      count(*) filter (where operation_id is null
                         and scheduled_operation_id is not null)   as scheduled_only,
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
    'scheduled_only',       t.scheduled_only,
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
-- 6. Impacto de remover cidade: conta vigentes E programadas
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
  select a.city_id, max(c.name), count(distinct a.vehicle_id)
    from public.vehicle_operation_assignments a
    join public.cities c on c.id = a.city_id
   where a.operation_id = p_operation_id
     and (a.effective_to is null or a.effective_to >= current_date)
     and a.city_id = any (coalesce(p_city_ids, array[]::integer[]))
   group by a.city_id
   order by 3 desc;
$$;

comment on function public.vehicles_blocking_coverage_removal(uuid, integer[]) is
  'Veículos alocados hoje — ou com transferência já programada — nas cidades que se pretende remover da cobertura. A FK já recusa a remoção; isto permite explicar o motivo antes de tentar.';

revoke execute on function public.vehicles_blocking_coverage_removal(uuid, integer[]) from public, anon;
grant  execute on function public.vehicles_blocking_coverage_removal(uuid, integer[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. O gatilho de sobreposição valida o período antes de montar o intervalo
--
-- `daterange(from, to)` com o fim antes do início aborta dentro do próprio
-- gatilho, e a pessoa recebe "range lower bound must be less than or equal to
-- range upper bound" — uma mensagem do PostgreSQL sobre um tipo que ela não
-- sabe que existe. A validação do período vem antes, com a frase certa.
-- -----------------------------------------------------------------------------
create or replace function private.tg_vehicle_assignment_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'O fim da vigência (%) não pode ser anterior ao início (%).',
      to_char(new.effective_to, 'DD/MM/YYYY'), to_char(new.effective_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1 from public.vehicle_operation_assignments a
     where a.vehicle_id = new.vehicle_id
       and a.id is distinct from new.id
       and daterange(a.effective_from, a.effective_to, '[]')
           && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'O período informado se sobrepõe a outra alocação deste veículo.'
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_vehicle_assignment_no_overlap() from public;
