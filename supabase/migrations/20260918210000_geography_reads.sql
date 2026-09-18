-- =============================================================================
-- HFM · reading the IBGE reference data
--
-- Two read paths for the Estados/Cidades screen. Both are SECURITY INVOKER, so
-- the reference-data policies still decide who sees what — these are conveniences
-- over public.states and public.cities, not a way around them.
-- =============================================================================

-- One row per federative unit with its municipality count and its capital, so
-- the state list does not need 27 follow-up queries.
create view public.state_summary
with (security_invoker = true) as
select s.id,
       s.uf,
       s.name,
       s.region,
       s.latitude,
       s.longitude,
       count(c.id)                                        as city_count,
       max(c.name) filter (where c.is_capital)             as capital_name,
       max(c.id)   filter (where c.is_capital)             as capital_id
  from public.states s
  left join public.cities c on c.state_id = s.id
 group by s.id, s.uf, s.name, s.region, s.latitude, s.longitude;

comment on view public.state_summary is
  'Federative units with municipality count and capital. security_invoker: the underlying policies still apply.';

revoke all on public.state_summary from anon, authenticated;
grant select on public.state_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Municipality search.
--
-- The filter is written against private.normalize_label(name) rather than the
-- raw column because people type "goiania" and "sao paulo": ILIKE on the stored
-- name would answer neither. That expression is exactly what cities_name_trgm_idx
-- is built on, so the GIN trigram index serves the contains-match.
--
-- The window count rides along with the page so the screen gets its total in the
-- same round trip. The limit is clamped here, not trusted from the caller.
-- ---------------------------------------------------------------------------
create or replace function public.search_cities(
  p_state_id smallint default null,
  p_query    text     default null,
  p_limit    integer  default 50,
  p_offset   integer  default 0
)
returns table (
  id              integer,
  state_id        smallint,
  uf              char(2),
  state_name      text,
  name            text,
  is_capital      boolean,
  is_municipality boolean,
  ddd             smallint,
  time_zone       text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  total           bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtrado as (
    select c.id, c.state_id, s.uf, s.name as state_name, c.name,
           c.is_capital, c.is_municipality, c.ddd, c.time_zone, c.latitude, c.longitude
      from public.cities c
      join public.states s on s.id = c.state_id
     where (p_state_id is null or c.state_id = p_state_id)
       and (
             private.normalize_label(p_query) is null
          or private.normalize_label(c.name) like '%' || private.normalize_label(p_query) || '%'
           )
  )
  select f.id, f.state_id, f.uf, f.state_name, f.name, f.is_capital, f.is_municipality,
         f.ddd, f.time_zone, f.latitude, f.longitude,
         count(*) over () as total
    from filtrado f
   order by f.is_capital desc, f.name, f.id
   limit  greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.search_cities(smallint, text, integer, integer) is
  'Paginated municipality search, accent- and case-insensitive, with the total count carried on each row.';

revoke all on function public.search_cities(smallint, text, integer, integer) from public, anon;
grant execute on function public.search_cities(smallint, text, integer, integer) to authenticated, service_role;
