-- =============================================================================
-- ETAPA 06 · CADASTRO DE FROTAS — O QUE FALTAVA NA FUNDAÇÃO
--
-- `vehicles` já existia desde a Etapa 01 e continua sendo a fonte única da
-- verdade. Esta migration não a recria: acrescenta o que o cadastro precisa e
-- que ainda não havia — subcategoria, patrimônio, documentação, alocação
-- operacional e hodômetro.
--
-- Três coisas que o módulo antigo misturava e aqui ficam separadas:
--
--   • identidade técnica (placa, chassi, RENAVAM) — permanente, auditada;
--   • classificação cadastral (tipo, subcategoria, marca, modelo);
--   • alocação operacional (operação → estado → cidade) — historiada, nunca
--     um campo sobrescrito.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vehicle_subcategories — a carroceria dentro do tipo
--
-- Uma subcategoria pertence a um tipo: "Baú" é uma carroceria de caminhão e não
-- faz sentido sob "Motocicleta". Catálogo global curado mais entradas próprias
-- da organização, exatamente como marcas e modelos já funcionam.
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_subcategories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete restrict,
  vehicle_type_id uuid not null references public.vehicle_types (id) on delete restrict,
  name            text not null,
  sort_order      smallint not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint vehicle_subcategories_name_check check (length(btrim(name)) between 1 and 80),
  -- composite key so a vehicle can be forced, by FK, to pick a subcategory of
  -- the type it actually is
  constraint vehicle_subcategories_type_key unique (id, vehicle_type_id)
);

create unique index if not exists vehicle_subcategories_global_name_key
  on public.vehicle_subcategories (vehicle_type_id, lower(name)) where organization_id is null;
create unique index if not exists vehicle_subcategories_org_name_key
  on public.vehicle_subcategories (organization_id, vehicle_type_id, lower(name))
  where organization_id is not null;
create index if not exists vehicle_subcategories_type_idx
  on public.vehicle_subcategories (vehicle_type_id) where is_active;

comment on table public.vehicle_subcategories is
  'Carroceria/subcategoria dentro de um tipo de veículo. Catálogo global mais entradas por organização.';

drop trigger if exists vehicle_subcategories_set_stamps on public.vehicle_subcategories;
create trigger vehicle_subcategories_set_stamps
  before insert or update on public.vehicle_subcategories
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_subcategories_prevent_tenant_change on public.vehicle_subcategories;
create trigger vehicle_subcategories_prevent_tenant_change
  before update on public.vehicle_subcategories
  for each row execute function private.tg_prevent_tenant_change();

alter table public.vehicle_subcategories enable row level security;

drop policy if exists vehicle_subcategories_select on public.vehicle_subcategories;
create policy vehicle_subcategories_select on public.vehicle_subcategories
  for select to authenticated
  using (organization_id is null or organization_id in (select private.member_org_ids()));

drop policy if exists vehicle_subcategories_insert on public.vehicle_subcategories;
create policy vehicle_subcategories_insert on public.vehicle_subcategories
  for insert to authenticated
  with check (
    organization_id is not null
    and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage'))
  );

drop policy if exists vehicle_subcategories_update on public.vehicle_subcategories;
create policy vehicle_subcategories_update on public.vehicle_subcategories
  for update to authenticated
  using (organization_id is not null
         and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage')))
  with check (organization_id is not null
              and organization_id in (select private.permitted_org_ids('vehicle_catalog.manage')));

grant select on public.vehicle_subcategories to authenticated;
grant insert, update on public.vehicle_subcategories to authenticated;

-- Seed do catálogo global. Conservador de propósito: cada organização amplia o
-- seu próprio catálogo, e uma lista longa de carrocerias que ninguém usa só
-- atrapalha quem procura a sua.
insert into public.vehicle_subcategories (organization_id, vehicle_type_id, name, sort_order)
select null, t.id, s.name, s.sort_order
  from (values
    ('car',        'Sedã',                10),
    ('car',        'Hatch',               20),
    ('car',        'SUV',                 30),
    ('utility',    'Picape cabine simples', 10),
    ('utility',    'Picape cabine dupla', 20),
    ('utility',    'Furgão',              30),
    ('van',        'Van de carga',        10),
    ('van',        'Van de passageiros',  20),
    ('van',        'Furgão',              30),
    ('truck',      'Baú',                 10),
    ('truck',      'Carroceria aberta',   20),
    ('truck',      'Refrigerado',         30),
    ('truck',      'Sider',               40),
    ('truck',      'Tanque',              50),
    ('truck',      'Basculante',          60),
    ('motorcycle', 'Motocicleta',         10),
    ('motorcycle', 'Motocicleta com baú', 20)
  ) as s (type_code, name, sort_order)
  join public.vehicle_types t on t.code = s.type_code
 where not exists (
   select 1 from public.vehicle_subcategories v
    where v.organization_id is null and v.vehicle_type_id = t.id and lower(v.name) = lower(s.name)
 );

-- -----------------------------------------------------------------------------
-- vehicles — o que o cadastro precisa e não existia
-- -----------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists vehicle_subcategory_id uuid,
  add column if not exists asset_value            numeric(14, 2),
  add column if not exists antt_code              text,
  add column if not exists has_tachograph         boolean not null default false,
  add column if not exists tachograph_number      text,
  add column if not exists notes                  text;

do $$
begin
  -- A subcategoria tem de pertencer ao tipo escolhido, e quem garante isso é a
  -- chave composta — não a ordem dos selects na tela.
  if not exists (select 1 from pg_constraint where conname = 'vehicles_subcategory_fkey') then
    alter table public.vehicles
      add constraint vehicles_subcategory_fkey
      foreign key (vehicle_subcategory_id, vehicle_type_id)
      references public.vehicle_subcategories (id, vehicle_type_id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_asset_value_check') then
    -- NULL é "não informado". Zero é um valor patrimonial, e os dois não podem
    -- se confundir num somatório.
    alter table public.vehicles
      add constraint vehicles_asset_value_check check (asset_value is null or asset_value >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_antt_code_check') then
    alter table public.vehicles
      add constraint vehicles_antt_code_check
      check (antt_code is null or antt_code ~ '^[0-9]{6,12}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_tachograph_check') then
    alter table public.vehicles
      add constraint vehicles_tachograph_check
      check (tachograph_number is null or has_tachograph);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_notes_check') then
    alter table public.vehicles
      add constraint vehicles_notes_check check (notes is null or length(notes) <= 2000);
  end if;
end;
$$;

comment on column public.vehicles.status is
  'Situação CADASTRAL do veículo: active ou inactive. Situação operacional (em rota, em manutenção, parado) pertence aos módulos operacionais e nunca é escrita por este cadastro. Os valores maintenance/sold/decommissioned são legado e não são oferecidos pela interface.';
comment on column public.vehicles.asset_value is
  'Valor patrimonial conhecido. NULL significa desconhecido e nunca deve ser somado como zero.';

-- -----------------------------------------------------------------------------
-- operation_cities — chave por tenant
--
-- Já havia unicidade por (operation_id, city_id); faltava a forma composta com
-- organization_id, que é do que a alocação de veículo precisa para provar, por
-- FK, que a cidade pertence àquela operação daquele tenant.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operation_cities_scope_key') then
    alter table public.operation_cities
      add constraint operation_cities_scope_key unique (organization_id, operation_id, city_id);
  end if;
end;
$$;
