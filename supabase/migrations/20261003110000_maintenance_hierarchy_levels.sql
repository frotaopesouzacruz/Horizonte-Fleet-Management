-- =============================================================================
-- MANUTENÇÃO · BASE GERAL › HIERARQUIA COM NÍVEIS ESCOLHIDOS
--
-- A visão em hierarquia passa a agrupar pelos níveis que a pessoa escolher —
-- Operação, Cidade, Placa, Cluster e Serviço — na ordem informada em
-- p_filters.levels (array de códigos). Sem o parâmetro vale o agrupamento de
-- antes: Operação → Cidade → Placa.
--
-- Cada nó da árvore vem pronto do servidor, com contagens DISTINTAS de
-- manutenções (uma manutenção com dois serviços conta uma vez no cluster e uma
-- vez no pai), por GROUPING SETS sobre os prefixos do caminho. A tela só monta
-- a árvore e não soma nada. O conjunto vazio devolve o nó raiz (depth 0), com os
-- totais exatos do recorte. Mesma assinatura e mesmo RLS da rotina anterior.
-- =============================================================================
create or replace function public.maintenance_hierarchy(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_levels  text[];
  v_allowed constant text[] := array['operation', 'city', 'vehicle', 'cluster', 'service'];
  v_lvl     text;
  v_n       integer;
  v_items   boolean;
  v_cols    text := '';  -- k_i, l_i, e_i da base
  v_keys    text := '';  -- k_1, …, k_n
  v_sets    text := '';  -- (k_1), (k_1, k_2), …
  v_depth   text := '';  -- grouping(k_1) + … + grouping(k_n)
  v_outer   text := '';  -- k_i, max(l_i), max(e_i)
  v_path    text := '';  -- jsonb_build_object por nível
  v_sql     text;
  v_result  jsonb;
  i         integer;
begin
  select coalesce(array_agg(x), '{}') into v_levels
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_filters -> 'levels') = 'array' then p_filters -> 'levels' else '[]'::jsonb end) x;
  if cardinality(v_levels) = 0 then
    v_levels := array['operation', 'city', 'vehicle'];
  end if;
  foreach v_lvl in array v_levels loop
    if not (v_lvl = any (v_allowed)) then
      raise exception 'Nível de agrupamento inválido: %', v_lvl using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if (select count(distinct x) from unnest(v_levels) x) <> cardinality(v_levels) then
    raise exception 'Níveis de agrupamento repetidos.' using errcode = 'invalid_parameter_value';
  end if;
  v_n := cardinality(v_levels);
  v_items := 'cluster' = any (v_levels) or 'service' = any (v_levels);

  for i in 1..v_n loop
    v_cols := v_cols || case v_levels[i]
      when 'operation' then format('coalesce(m.operation_id::text, %L) as k%s, m.operation_name_snapshot::text as l%s, null::text as e%s', '-', i, i, i)
      when 'city'      then format('coalesce(m.city_id::text, %L || coalesce(m.state_uf_snapshot::text, %L)) as k%s, m.city_name_snapshot::text as l%s, m.state_uf_snapshot::text as e%s', 'uf:', '-', i, i, i)
      when 'vehicle'   then format('m.vehicle_id::text as k%s, m.license_plate_snapshot::text as l%s, m.fleet_code_snapshot::text as e%s', i, i, i)
      when 'cluster'   then format('coalesce(mi.cluster_id::text, %L) as k%s, mi.cluster_name_snapshot::text as l%s, null::text as e%s', '-', i, i, i)
      when 'service'   then format('coalesce(mi.service_id::text, %L) as k%s, mi.service_name_snapshot::text as l%s, mi.cluster_name_snapshot::text as e%s', '-', i, i, i)
      end || case when i < v_n then ', ' else '' end;
    v_keys  := v_keys || format('k%s', i) || case when i < v_n then ', ' else '' end;
    v_sets  := v_sets || '(' || (select string_agg(format('k%s', j), ', ') from generate_series(1, i) j) || ')'
               || case when i < v_n then ', ' else '' end;
    v_depth := v_depth || format('grouping(k%s)', i) || case when i < v_n then ' + ' else '' end;
    v_outer := v_outer || format('k%s, max(l%s) as l%s, max(e%s) as e%s, ', i, i, i, i, i);
    v_path  := v_path || format('jsonb_build_object(%L, %L, %L, g.k%s, %L, g.l%s, %L, g.e%s)',
                                'level', v_levels[i], 'key', i, 'label', i, 'extra', i)
               || case when i < v_n then ', ' else '' end;
  end loop;

  v_sql := format($q$
    with b as (
      select m.id, m.vehicle_id, m.status,
             coalesce(m.entry_date, m.scheduled_date, m.requested_on) as ref,
             %s
        from private.maintenance_filtered(%L::uuid, %L::jsonb) m
        %s
    ),
    g as (
      select %s - (%s) as depth, %s
             count(distinct b.id) as total,
             count(distinct b.id) filter (where b.status in ('to_schedule', 'scheduled', 'in_progress')) as open,
             count(distinct b.id) filter (where b.status = 'in_progress') as in_progress,
             count(distinct b.vehicle_id) as vehicles,
             max(b.ref) as last_reference
        from b
       group by grouping sets ((), %s)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'depth', g.depth,
             'path', (select coalesce(jsonb_agg(t.e order by t.ord), '[]'::jsonb)
                        from jsonb_array_elements(jsonb_build_array(%s)) with ordinality as t(e, ord)
                       where t.ord <= g.depth),
             'total', g.total, 'open', g.open, 'in_progress', g.in_progress,
             'vehicles', g.vehicles, 'last_reference', g.last_reference)
             order by g.depth, %s), '[]'::jsonb)
      from g
  $q$,
    v_cols,
    p_organization_id, p_filters,
    case when v_items
         then 'left join public.maintenance_items mi on mi.maintenance_id = m.id and mi.status <> ''cancelled'''
         else '' end,
    v_n, v_depth, v_outer,
    v_sets,
    v_path,
    v_keys);

  execute v_sql into v_result;
  return v_result;
end;
$$;

comment on function public.maintenance_hierarchy(uuid, jsonb) is
  'Base geral da Manutenção agrupada pelos níveis de p_filters.levels (operation, city, vehicle, cluster, service): um nó por prefixo do caminho, com contagens distintas de manutenções.';
