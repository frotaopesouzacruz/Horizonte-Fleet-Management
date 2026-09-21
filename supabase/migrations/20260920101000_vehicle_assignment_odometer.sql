-- =============================================================================
-- ETAPA 06 · ALOCAÇÃO OPERACIONAL E HODÔMETRO
--
-- Duas informações que o cadastro antigo guardava como campo sobrescrito e que
-- aqui passam a ter história:
--
--   • onde o veículo está (operação → estado → cidade);
--   • quanto ele rodou.
--
-- Um campo sobrescrito responde "onde está agora" e apaga a pergunta que a
-- gestão realmente faz: "onde estava em agosto, e por que mudou".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vehicle_operation_assignments
--
-- A combinação operação+estado+cidade é provada por chave estrangeira contra a
-- cobertura da operação (Etapa 04). Não é validada pelo select da tela: um
-- POST direto com uma cidade de outra operação é recusado pelo banco.
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_operation_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_id      uuid not null,
  operation_id    uuid not null,
  state_id        smallint not null,
  city_id         integer not null,

  effective_from  date not null default current_date,
  effective_to    date,

  reason          text,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_assignments_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint vehicle_assignments_reason_check
    check (reason is null or length(reason) <= 500),

  constraint vehicle_assignments_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  -- a cidade tem de estar na cobertura daquela operação, daquele tenant
  constraint vehicle_assignments_coverage_fkey
    foreign key (organization_id, operation_id, city_id)
    references public.operation_cities (organization_id, operation_id, city_id) on delete restrict,
  -- e o estado tem de ser o estado da cidade
  constraint vehicle_assignments_city_state_fkey
    foreign key (city_id, state_id) references public.cities (id, state_id) on delete restrict
);

-- Uma única alocação vigente por veículo. A garantia é um índice parcial, não
-- um `is_current` calculado em algum lugar: duas transferências simultâneas
-- batem uma na outra aqui, e não em produção três semanas depois.
create unique index if not exists vehicle_assignments_current_key
  on public.vehicle_operation_assignments (vehicle_id) where effective_to is null;

create index if not exists vehicle_assignments_vehicle_idx
  on public.vehicle_operation_assignments (vehicle_id, effective_from desc);
create index if not exists vehicle_assignments_operation_idx
  on public.vehicle_operation_assignments (organization_id, operation_id) where effective_to is null;
create index if not exists vehicle_assignments_city_idx
  on public.vehicle_operation_assignments (organization_id, city_id) where effective_to is null;

comment on table public.vehicle_operation_assignments is
  'Onde cada veículo esteve alocado, com vigência. A alocação atual é a linha com effective_to nulo; o histórico nunca é sobrescrito.';

drop trigger if exists vehicle_assignments_set_stamps on public.vehicle_operation_assignments;
create trigger vehicle_assignments_set_stamps
  before insert or update on public.vehicle_operation_assignments
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_assignments_prevent_tenant_change on public.vehicle_operation_assignments;
create trigger vehicle_assignments_prevent_tenant_change
  before update on public.vehicle_operation_assignments
  for each row execute function private.tg_prevent_tenant_change();

-- Períodos não se sobrepõem, nem para trás. Uma transferência com data retroativa
-- que invadisse a vigência anterior produziria duas verdades sobre o mesmo dia.
create or replace function private.tg_vehicle_assignment_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

drop trigger if exists vehicle_assignments_no_overlap on public.vehicle_operation_assignments;
create trigger vehicle_assignments_no_overlap
  before insert or update on public.vehicle_operation_assignments
  for each row execute function private.tg_vehicle_assignment_no_overlap();

-- -----------------------------------------------------------------------------
-- vehicle_odometer_readings
--
-- O KM atual não é um número editável: é a leitura vigente. Uma correção não
-- apaga a leitura anterior, ela a supera — e diz por quê.
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_odometer_readings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_id      uuid not null,

  reading_date    date not null default current_date,
  odometer_km     integer not null,
  source          text not null,
  notes           text,

  -- uma leitura corrigida continua existindo, apontando para a que a substituiu
  superseded_by   uuid references public.vehicle_odometer_readings (id) on delete restrict,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_odometer_km_check check (odometer_km >= 0 and odometer_km <= 9999999),
  constraint vehicle_odometer_date_check check (reading_date <= current_date + 1),
  constraint vehicle_odometer_source_check check (source in (
    'initial_registration', 'manual_correction', 'import',
    'checklist', 'fuelling', 'maintenance', 'telemetry'
  )),
  constraint vehicle_odometer_notes_check check (notes is null or length(notes) <= 500),
  constraint vehicle_odometer_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict
);

create index if not exists vehicle_odometer_current_idx
  on public.vehicle_odometer_readings (vehicle_id, reading_date desc, created_at desc)
  where superseded_by is null;

comment on table public.vehicle_odometer_readings is
  'Leituras de hodômetro. O KM atual é a leitura vigente mais recente; correções superam a anterior sem apagá-la.';

-- Append-only, com uma exceção nomeada: marcar uma leitura como superada. É a
-- única coluna que uma correção precisa tocar, e qualquer outra alteração
-- continua recusada.
create or replace function private.tg_odometer_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Leituras de hodômetro não podem ser excluídas.' using errcode = 'insufficient_privilege';
  end if;
  if to_jsonb(new) - 'superseded_by' is distinct from to_jsonb(old) - 'superseded_by' then
    raise exception 'Uma leitura de hodômetro não pode ser editada. Registre uma correção.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.superseded_by is not null then
    raise exception 'Esta leitura já foi corrigida.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_odometer_append_only() from public;

drop trigger if exists vehicle_odometer_append_only on public.vehicle_odometer_readings;
create trigger vehicle_odometer_append_only
  before update or delete on public.vehicle_odometer_readings
  for each row execute function private.tg_odometer_append_only();

-- -----------------------------------------------------------------------------
-- RLS
--
-- Nenhuma das duas tabelas aceita escrita direta: alocação e hodômetro só se
-- movem pelas rotinas transacionais, que validam cobertura, vigência e
-- permissão. A leitura acompanha o que o usuário pode ver do veículo.
-- -----------------------------------------------------------------------------
alter table public.vehicle_operation_assignments enable row level security;
alter table public.vehicle_odometer_readings     enable row level security;

drop policy if exists vehicle_assignments_select on public.vehicle_operation_assignments;
create policy vehicle_assignments_select on public.vehicle_operation_assignments
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('vehicles.view')));

drop policy if exists vehicle_odometer_select on public.vehicle_odometer_readings;
create policy vehicle_odometer_select on public.vehicle_odometer_readings
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('vehicles.view')));

grant select on public.vehicle_operation_assignments to authenticated;
grant select on public.vehicle_odometer_readings     to authenticated;
