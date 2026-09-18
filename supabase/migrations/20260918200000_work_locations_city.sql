-- =============================================================================
-- HFM · a work location gets a real municipality
--
-- Until now a work location carried a free-text name and nothing else, which is
-- why the imported base holds "Brasilia", "Goiania" and "Belém Do Pará": three
-- spellings that no report can group, map or join. city_id points at the IBGE
-- table and turns the municipality into a fact instead of a string.
--
-- Nullable on purpose. A location whose city cannot be established without
-- guessing stays NULL and visible, rather than being quietly attached to the
-- wrong municipality — there are two Campo Grandes, and picking one because it
-- is the bigger city is exactly the kind of inference this column exists to
-- remove. The free-text name is kept: it is what the operation calls the place.
-- =============================================================================

alter table public.work_locations
  add column city_id integer references public.cities (id) on delete restrict;

comment on column public.work_locations.city_id is
  'IBGE municipality. NULL means the city has not been established yet — never infer it from name.';

create index work_locations_city_idx on public.work_locations (city_id) where city_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill, in two deterministic passes. Both link only when the name resolves
-- to exactly one municipality; anything with zero or several candidates is left
-- for a human. No fuzzy matching, no ranking by population, no "closest" city.
-- ---------------------------------------------------------------------------

-- Pass 1 — the name is the municipality's name.
with candidato as (
  select w.id as work_location_id, c.id as city_id
    from public.work_locations w
    join public.cities c
      on private.normalize_label(c.name) = private.normalize_label(w.name)
   where w.city_id is null
),
unico as (
  select work_location_id, min(city_id) as city_id
    from candidato
   group by work_location_id
  having count(*) = 1
)
update public.work_locations w
   set city_id = u.city_id
  from unico u
 where w.id = u.work_location_id;

-- Pass 2 — the name is the municipality qualified by its state, in any of the
-- forms the imported sheet uses ("Belém Do Pará", and the "Cidade/UF" and
-- "Cidade - UF" shapes that appear elsewhere in master data).
with candidato as (
  select w.id as work_location_id, c.id as city_id
    from public.work_locations w
    join public.cities c on true
    join public.states s on s.id = c.state_id
   where w.city_id is null
     and private.normalize_label(w.name) in (
           private.normalize_label(c.name || ' ' || s.uf),
           private.normalize_label(c.name || '/' || s.uf),
           private.normalize_label(c.name || ' - ' || s.uf),
           private.normalize_label(c.name || ' do ' || s.name),
           private.normalize_label(c.name || ' de ' || s.name),
           private.normalize_label(c.name || ' da ' || s.name),
           private.normalize_label(c.name || ' - ' || s.name)
         )
),
unico as (
  select work_location_id, min(city_id) as city_id
    from candidato
   group by work_location_id
  having count(*) = 1
)
update public.work_locations w
   set city_id = u.city_id
  from unico u
 where w.id = u.work_location_id;
