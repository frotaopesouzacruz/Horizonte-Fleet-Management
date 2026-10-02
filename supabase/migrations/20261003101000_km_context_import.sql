-- =============================================================================
-- Gestão de KM Rodado — contexto histórico, classificação e importação
--
-- Fonte oficial da importação manual: Base Geral KM Rodado.xlsx, aba EXATA
-- "Controle KM Rodado" (cabeçalho Ref Pesquisa | Placa | Frota | Tipo | Modelo |
-- Data | Hodômetro Inicial | Hodômetro Fim | KM Percorrido). Nenhuma outra aba
-- é fonte. O arquivo é lido no navegador; o banco recebe só os valores finais
-- (não recria fórmulas) e segue o pipeline oficial de lotes:
--
--   load (staging em import_rows, em partes)
--   → validate (em partes, conjunto: veículo pela placa, tipos, status do
--     catálogo central, divergência cadastral, data futura, comparação com o
--     razão)
--   → finalize/prévia (duplicidade no arquivo, continuidade do hodômetro,
--     resumo e comparação por mês, veículo e operação)
--   → process (consolidação em partes no razão diário + contexto da data +
--     hodômetro do veículo para a Manutenção + auditoria)
--   → conclusão (eventos: KM importado, marco preventivo alcançado).
--
-- Uma fonte automática futura (planilha conectada, telemetria) chama as MESMAS
-- rotinas com outro source_type: não há segundo mecanismo.
--
-- Regras:
--   * Sem leitura (nenhum hodômetro) ≠ Sem movimento (leitura válida, KM 0 ou
--     dentro da tolerância). Sem leitura nunca vira 0 km.
--   * KM informado (distance_imported), calculado (final − inicial) e validado
--     convivem; o informado nunca é sobrescrito.
--   * Frota/Tipo/Modelo da planilha só comparam com o cadastro: divergência é
--     alerta, o Cadastro de Frotas nunca é alterado.
--   * Reimportar o mesmo arquivo não duplica (chave veículo+data, hash da
--     linha e do arquivo); correção manual nunca é sobrescrita sem aviso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Conversões tolerantes
-- -----------------------------------------------------------------------------
-- Número vindo da planilha: número JSON é usado como está; texto segue o padrão
-- brasileiro ("57.629,6") ou o internacional ("57629.6"). Um número do Excel
-- nunca passa pelo texto (o HFC lia "179.199" como 179199 milhares).
create or replace function private.km_parse_number(p_value jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return (p_value #>> '{}')::numeric;
  end if;
  v := regexp_replace(btrim(p_value #>> '{}'), '[^0-9,.\-]', '', 'g');
  if v = '' or v = '-' then
    return null;
  end if;
  if v ~ '^-?\d{1,3}(\.\d{3})+(,\d+)?$' then
    v := replace(replace(v, '.', ''), ',', '.');
  elsif v ~ '^-?\d+,\d+$' then
    v := replace(v, ',', '.');
  elsif v ~ '^-?\d{1,3}(,\d{3})+(\.\d+)?$' then
    v := replace(v, ',', '');
  end if;
  return v::numeric;
exception when others then
  return null;
end;
$$;

-- Texto informado onde deveria haver número (para o achado "número inválido").
create or replace function private.km_has_text(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') <> '';
$$;

-- Data: ISO, dd/mm/aaaa, dd/mm/aa ou número serial do Excel.
create or replace function private.km_parse_date(p_value jsonb)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return date '1899-12-30' + floor((p_value #>> '{}')::numeric)::integer;
  end if;
  v := btrim(p_value #>> '{}');
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return left(v, 10)::date;
  elsif v ~ '^\d{1,2}/\d{1,2}/\d{4}' then
    return to_date(substring(v from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY');
  elsif v ~ '^\d{1,2}/\d{1,2}/\d{2}$' then
    return to_date(v, 'DD/MM/YY');
  elsif v ~ '^\d{5}(\.\d+)?$' then
    return date '1899-12-30' + floor(v::numeric)::integer;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function private.km_parse_number(jsonb) from public, anon;
revoke all on function private.km_has_text(jsonb) from public, anon;
revoke all on function private.km_parse_date(jsonb) from public, anon;
grant execute on function private.km_parse_number(jsonb), private.km_has_text(jsonb), private.km_parse_date(jsonb)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Classificação de uma leitura (catálogo central)
-- -----------------------------------------------------------------------------
-- Precedência: Sem leitura > Inconsistente > Divergência de KM > Alta rodagem >
-- Sem movimento > Validado. Sinais secundários vão em `alerts`.
create or replace function private.km_classify(
  p_start numeric, p_end numeric, p_informed numeric, p_settings public.km_settings)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_calc   numeric;
  v_status text;
  v_valid  numeric;
  v_alerts text[] := '{}';
begin
  if p_start is null and p_end is null then
    return jsonb_build_object('status', 'no_reading', 'calculated', null, 'validated', null, 'alerts', '[]'::jsonb);
  end if;
  if p_start is null or p_end is null then
    return jsonb_build_object('status', 'inconsistent', 'calculated', null, 'validated', null,
                              'alerts', jsonb_build_array('missing_odometer'));
  end if;
  v_calc := round(p_end - p_start, 2);
  if v_calc < -p_settings.no_movement_tolerance_km then
    return jsonb_build_object('status', 'inconsistent', 'calculated', v_calc, 'validated', null,
                              'alerts', jsonb_build_array('end_before_start'));
  end if;
  v_valid := greatest(v_calc, 0);
  if p_informed is not null and abs(round(p_informed, 2) - v_calc) > p_settings.divergence_tolerance_km then
    v_status := 'km_divergence';
  end if;
  if v_valid > p_settings.high_mileage_km then
    if v_status is null then v_status := 'high_mileage'; else v_alerts := array_append(v_alerts, 'high_mileage'); end if;
  end if;
  if v_status is null then
    v_status := case when v_valid <= p_settings.no_movement_tolerance_km then 'no_movement' else 'validated' end;
  end if;
  return jsonb_build_object('status', v_status, 'calculated', v_calc, 'validated', v_valid, 'alerts', to_jsonb(v_alerts));
end;
$$;

revoke all on function private.km_classify(numeric, numeric, numeric, public.km_settings) from public, anon;
grant execute on function private.km_classify(numeric, numeric, numeric, public.km_settings) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Contexto vigente na data, em conjunto
-- -----------------------------------------------------------------------------
-- As mesmas regras de private.adherence_planned_fleet + adherence_leader_at
-- (Fidelização titular vigente → alocação; liderança principal por BR, cidade,
-- operação), para muitos pares veículo×dia numa consulta só.
create or replace function private.km_context_pairs(
  p_organization_id uuid, p_vehicle_ids uuid[], p_dates date[])
returns table (
  vehicle_id uuid, day date, context_source text, operation_id uuid, operation_city_id uuid,
  state_id smallint, city_id integer, operation_br_id uuid, fidelization_assignment_id uuid,
  leader_employee_id uuid, organization_unit_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with pairs as (
    select distinct p.vehicle_id, p.day
      from unnest(p_vehicle_ids, p_dates) as p(vehicle_id, day)
     where p.vehicle_id is not null and p.day is not null
  ),
  fid as (
    select distinct on (p.vehicle_id, p.day)
           p.vehicle_id, p.day, fa.id as assignment_id, b.operation_id, b.operation_city_id, b.state_id, b.city_id, b.id as br_id
      from pairs p
      join public.fidelization_assignments fa
        on fa.vehicle_id = p.vehicle_id and fa.organization_id = p_organization_id
       and fa.status <> 'cancelled' and fa.vehicle_role = 'primary'
       and fa.start_date <= p.day and (fa.end_date is null or fa.end_date >= p.day)
      join public.operation_brs b on b.id = fa.operation_br_id and b.deleted_at is null
     order by p.vehicle_id, p.day, fa.start_date desc, fa.created_at desc
  ),
  alloc as (
    select distinct on (p.vehicle_id, p.day)
           p.vehicle_id, p.day, a.operation_id, a.state_id, a.city_id,
           (select oc.id from public.operation_cities oc
             where oc.operation_id = a.operation_id and oc.city_id = a.city_id limit 1) as operation_city_id
      from pairs p
      join public.vehicle_operation_assignments a
        on a.vehicle_id = p.vehicle_id and a.organization_id = p_organization_id
       and a.effective_from <= p.day and (a.effective_to is null or a.effective_to >= p.day)
     order by p.vehicle_id, p.day, a.effective_from desc
  ),
  ctx as (
    select p.vehicle_id, p.day,
           case when f.vehicle_id is not null then 'fidelization'
                when al.vehicle_id is not null then 'allocation' else 'none' end as src,
           coalesce(f.operation_id, al.operation_id) as operation_id,
           coalesce(f.operation_city_id, al.operation_city_id) as operation_city_id,
           coalesce(f.state_id, al.state_id) as state_id,
           coalesce(f.city_id, al.city_id) as city_id,
           f.br_id, f.assignment_id, v.organization_unit_id
      from pairs p
      join public.vehicles v on v.id = p.vehicle_id and v.organization_id = p_organization_id
      left join fid f on f.vehicle_id = p.vehicle_id and f.day = p.day
      left join alloc al on al.vehicle_id = p.vehicle_id and al.day = p.day
  ),
  lead as (
    select distinct on (c.vehicle_id, c.day) c.vehicle_id, c.day, l.employee_id
      from ctx c
      join public.leadership_assignments l
        on l.organization_id = p_organization_id and l.status = 'active' and l.responsibility_type = 'principal'
       and l.effective_from <= c.day and (l.effective_to is null or l.effective_to >= c.day)
       and (   (l.scope_level = 'br'        and c.br_id is not null and l.operation_br_id = c.br_id)
            or (l.scope_level = 'city'      and c.operation_city_id is not null and l.operation_city_id = c.operation_city_id)
            or (l.scope_level = 'operation' and c.operation_id is not null and l.operation_id = c.operation_id))
     order by c.vehicle_id, c.day, case l.scope_level when 'br' then 1 when 'city' then 2 else 3 end, l.effective_from desc
  )
  select c.vehicle_id, c.day, c.src, c.operation_id, c.operation_city_id, c.state_id, c.city_id,
         c.br_id, c.assignment_id, ld.employee_id, c.organization_unit_id
    from ctx c
    left join lead ld on ld.vehicle_id = c.vehicle_id and ld.day = c.day;
$$;

revoke all on function private.km_context_pairs(uuid, uuid[], date[]) from public, anon;
grant execute on function private.km_context_pairs(uuid, uuid[], date[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Fonte manual (MANUAL_XLSX) da organização
-- -----------------------------------------------------------------------------
create or replace function private.km_source_id(p_organization_id uuid, p_source_type text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from public.km_data_sources s
   where s.organization_id = p_organization_id and s.source_type = p_source_type and s.name = p_name;
  if v_id is null then
    insert into public.km_data_sources (organization_id, source_type, name, description, config, created_by)
    values (p_organization_id, p_source_type, p_name,
            'Importação manual da Base Geral KM Rodado — aba Controle KM Rodado.',
            jsonb_build_object('sheet', 'Controle KM Rodado',
                               'columns', jsonb_build_array('Ref Pesquisa', 'Placa', 'Frota', 'Tipo', 'Modelo', 'Data',
                                                            'Hodômetro Inicial', 'Hodômetro Fim', 'KM Percorrido')),
            auth.uid())
    on conflict (organization_id, source_type, name) do nothing
    returning id into v_id;
    if v_id is null then
      select s.id into v_id from public.km_data_sources s
       where s.organization_id = p_organization_id and s.source_type = p_source_type and s.name = p_name;
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function private.km_source_id(uuid, text, text) from public, anon;

-- -----------------------------------------------------------------------------
-- 5. Continuidade do hodômetro (regressão e salto) de um conjunto de leituras
-- -----------------------------------------------------------------------------
-- Para os pares (veículo, data) dados, devolve o final do dia anterior com
-- leitura e o sinal: regressão (inicial abaixo do final anterior além da
-- tolerância) ou salto (inicial acima do final anterior além do limite por dia).
-- Quem chama decide o que fazer (prévia da importação ou reprocessamento).
create or replace function private.km_continuity(
  p_organization_id uuid, p_rows jsonb)
returns table (vehicle_id uuid, reading_date date, prev_date date, prev_end numeric, gap numeric, signal text)
language sql
stable
security definer
set search_path = ''
as $$
  -- p_rows: [{vehicle_id, date, start, end}] — os valores novos; o razão
  -- completa a sequência com as leituras que esses valores não substituem.
  with s0 as (
    select (r ->> 'vehicle_id')::uuid as vehicle_id, (r ->> 'date')::date as reading_date,
           (r ->> 'start')::numeric as st, (r ->> 'end')::numeric as en, true as is_new
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where r ->> 'start' is not null and r ->> 'end' is not null
  ),
  s as (
    select * from s0
    union all
    select r.vehicle_id, r.reading_date, r.odometer_start, r.odometer_end, false
      from public.km_daily_readings r
     where r.organization_id = p_organization_id
       and r.vehicle_id in (select distinct s0.vehicle_id from s0)
       and r.odometer_start is not null and r.odometer_end is not null
       and r.status not in ('inconsistent', 'no_reading')
       and not exists (select 1 from s0 where s0.vehicle_id = r.vehicle_id and s0.reading_date = r.reading_date)
  ),
  w as (
    select s.*, lag(s.en) over (partition by s.vehicle_id order by s.reading_date) as prev_end,
           lag(s.reading_date) over (partition by s.vehicle_id order by s.reading_date) as prev_date
      from s
  )
  select w.vehicle_id, w.reading_date, w.prev_date, w.prev_end, round(w.st - w.prev_end, 2),
         case when w.st < w.prev_end - st.regression_tolerance_km then 'odometer_regression'
              else 'odometer_jump' end
    from w
    cross join lateral (select * from private.km_settings_of(p_organization_id)) st
   where w.is_new and w.prev_end is not null
     and (w.st < w.prev_end - st.regression_tolerance_km
          or w.st - w.prev_end > st.odometer_jump_km * greatest(1, w.reading_date - w.prev_date));
$$;

revoke all on function private.km_continuity(uuid, jsonb) from public, anon;

-- -----------------------------------------------------------------------------
-- 6. Hodômetro do veículo (Manutenção) a partir das leituras consolidadas
-- -----------------------------------------------------------------------------
-- O hodômetro final de cada dia com leitura confiável vira uma leitura de
-- vehicle_odometer_readings (fonte telemetry, ligada à leitura diária). Valor
-- novo supera o anterior (append-only); valor igual não duplica.
create or replace function private.km_sync_odometer(p_reading_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with r as (
    select d.id, d.organization_id, d.vehicle_id, d.reading_date, round(d.odometer_end)::integer as km
      from public.km_daily_readings d
      join public.km_reading_statuses s on s.code = d.status and s.has_reading
     where d.id = any (p_reading_ids) and d.odometer_end is not null
       and d.reading_date <= current_date + 1
  ),
  old as (
    select o.id as old_id, r.id as km_reading_id
      from r
      join public.vehicle_odometer_readings o
        on o.km_reading_id = r.id and o.superseded_by is null and o.odometer_km <> r.km
  ),
  ins as (
    insert into public.vehicle_odometer_readings
      (organization_id, vehicle_id, reading_date, odometer_km, source, notes, created_by, km_reading_id)
    select r.organization_id, r.vehicle_id, r.reading_date, r.km, 'telemetry',
           'Gestão de KM — hodômetro final do dia', auth.uid(), r.id
      from r
     where not exists (select 1 from public.vehicle_odometer_readings o
                        where o.km_reading_id = r.id and o.superseded_by is null and o.odometer_km = r.km)
    returning id, km_reading_id
  ),
  sup as (
    update public.vehicle_odometer_readings o set superseded_by = ins.id
      from old join ins on ins.km_reading_id = old.km_reading_id
     where o.id = old.old_id
    returning o.id
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

revoke all on function private.km_sync_odometer(uuid[]) from public, anon;

-- Avaliação de linhas da aba Controle KM Rodado (sem gravar): veículo pela
-- placa, tipos, status do catálogo central, divergência cadastral, data futura
-- e comparação com o razão. Usada ao gravar o staging (cada linha é escrita uma
-- única vez, já avaliada) e por qualquer fonte futura do mesmo pipeline.
create or replace function private.km_import_evaluate(p_org uuid, p_rows jsonb)
returns table (row_number integer, raw jsonb, normalized jsonb, level text, action text, vehicle_id uuid, issues jsonb[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_set   public.km_settings := private.km_settings_of(p_org);
  v_today date := private.maintenance_today(p_org);
begin
  return query
    with p as (
      select null::uuid as id, (e.value ->> 'row_number')::integer as row_number, e.value - 'raw' as d,
             coalesce(e.value -> 'raw', '{}'::jsonb) as raw
        from jsonb_array_elements(p_rows) as e(value)
    ),
    vehs as (
      select distinct on (private.normalize_plate(v.license_plate))
             private.normalize_plate(v.license_plate) as pn, v.id, v.fleet_code, v.status, v.deleted_at,
             v.vehicle_type_id, v.vehicle_subcategory_id, v.vehicle_model_id,
             (select t.name from public.vehicle_types t where t.id = v.vehicle_type_id) as type_name,
             (select s.name from public.vehicle_subcategories s where s.id = v.vehicle_subcategory_id) as sub_name,
             (select m.name from public.vehicle_models m where m.id = v.vehicle_model_id) as model_name
        from public.vehicles v
       where v.organization_id = p_org
       order by private.normalize_plate(v.license_plate), v.deleted_at nulls first
    ),
    q as (
      select p.id, p.row_number, p.d, p.raw,
             nullif(btrim(coalesce(p.d ->> 'plate', '')), '') as plate,
             private.normalize_plate(p.d ->> 'plate') as plate_norm,
             nullif(btrim(coalesce(p.d ->> 'fleet', '')), '') as fleet,
             nullif(btrim(coalesce(p.d ->> 'type', '')), '') as type_inf,
             nullif(btrim(coalesce(p.d ->> 'model', '')), '') as model_inf,
             nullif(btrim(coalesce(p.d ->> 'ref', '')), '') as ref,
             private.km_parse_date(p.d -> 'date') as dt,
             (p.d -> 'date') is not null and jsonb_typeof(p.d -> 'date') <> 'null'
               and btrim(coalesce(p.d ->> 'date', '')) <> '' as has_date,
             round(private.km_parse_number(p.d -> 'start'), 2) as o_start,
             round(private.km_parse_number(p.d -> 'end'), 2) as o_end,
             round(private.km_parse_number(p.d -> 'km'), 2) as km_inf,
             private.km_has_text(p.d -> 'start') and private.km_parse_number(p.d -> 'start') is null as bad_start,
             private.km_has_text(p.d -> 'end') and private.km_parse_number(p.d -> 'end') is null as bad_end,
             private.km_has_text(p.d -> 'km') and private.km_parse_number(p.d -> 'km') is null as bad_km
        from p
    ),
    v as (
      select q.*, vh.id as vehicle_id, vh.fleet_code, vh.status as vehicle_status, vh.deleted_at,
             vh.vehicle_type_id, vh.vehicle_subcategory_id, vh.vehicle_model_id, vh.type_name, vh.sub_name, vh.model_name,
             private.km_classify(q.o_start, q.o_end, q.km_inf, v_set) as cls
        from q
        left join vehs vh on vh.pn = q.plate_norm
    ),
    c as (
      select v.*,
             ex.id as ex_id, ex.odometer_start_imported as ex_start, ex.odometer_end_imported as ex_end,
             ex.distance_imported as ex_km, ex.distance_validated as ex_valid, ex.status as ex_status,
             ex.is_corrected as ex_corrected, ex.source_hash as ex_hash,
             md5(concat_ws('|', v.plate_norm, v.dt, v.o_start, v.o_end, v.km_inf)) as row_hash,
             (v.dt is not null and v.dt > v_today) as is_future,
             (v.o_start is null and v.o_end is null) as no_odo,
             -- divergência cadastral (só comparação; o cadastro não muda)
             array_remove(array[
               case when v.vehicle_id is not null and v.fleet is not null
                         and upper(btrim(v.fleet)) is distinct from upper(btrim(coalesce(v.fleet_code, '')))
                    then format('Frota %s (cadastro %s)', v.fleet, coalesce(v.fleet_code, '—')) end,
               case when v.vehicle_id is not null and v.type_inf is not null
                         and private.maintenance_norm(v.type_inf) is distinct from private.maintenance_norm(v.type_name)
                    then format('Tipo %s (cadastro %s)', v.type_inf, coalesce(v.type_name, '—')) end,
               case when v.vehicle_id is not null and v.model_inf is not null
                         and private.maintenance_norm(v.model_inf) is distinct from private.maintenance_norm(v.sub_name)
                         and private.maintenance_norm(v.model_inf) is distinct from private.maintenance_norm(v.model_name)
                    then format('Modelo %s (cadastro %s)', v.model_inf, coalesce(v.sub_name, v.model_name, '—')) end
             ], null) as reg_diff
        from v
        left join public.km_daily_readings ex
          on ex.organization_id = p_org and ex.vehicle_id = v.vehicle_id and ex.reading_date = v.dt
    ),
    e as (
      select c.*,
             array_remove(array[
               case when c.plate is null then jsonb_build_object('level', 'error', 'field', 'plate', 'code', 'missing_plate',
                    'message', 'Placa vazia.') end,
               case when c.plate is not null and c.vehicle_id is null then jsonb_build_object('level', 'error', 'field', 'plate',
                    'code', 'unregistered_plate',
                    'message', format('Placa %s não cadastrada no Cadastro de Frotas. A importação não cria veículos.', c.plate)) end,
               case when c.vehicle_id is not null and c.deleted_at is not null then jsonb_build_object('level', 'error', 'field', 'plate',
                    'code', 'archived_vehicle', 'message', format('Veículo %s arquivado no cadastro.', c.plate)) end,
               case when not c.has_date then jsonb_build_object('level', 'error', 'field', 'date', 'code', 'missing_date',
                    'message', 'Data vazia.')
                    when c.dt is null then jsonb_build_object('level', 'error', 'field', 'date', 'code', 'invalid_date',
                    'message', format('Data "%s" inválida.', c.d ->> 'date')) end,
               case when c.bad_start or c.bad_end or c.bad_km then jsonb_build_object('level', 'error', 'field', 'odometer',
                    'code', 'invalid_number', 'message', 'Hodômetro ou KM com texto no lugar de número.') end,
               case when c.is_future and not c.no_odo then jsonb_build_object('level', 'error', 'field', 'date', 'code', 'future_date',
                    'message', format('Data futura (%s) com leitura de hodômetro.', to_char(c.dt, 'DD/MM/YYYY'))) end,
               case when c.vehicle_id is not null and not c.is_future and c.cls ->> 'status' = 'inconsistent' then
                    jsonb_build_object('level', 'warning', 'field', 'odometer', 'code', 'inconsistent',
                    'message', case when c.o_start is null or c.o_end is null
                                    then 'Só um dos hodômetros informado: leitura inconsistente (o KM não entra nos totais).'
                                    else format('Hodômetro final (%s) menor que o inicial (%s): leitura inconsistente.', c.o_end, c.o_start) end) end,
               case when c.vehicle_id is not null and not c.is_future and c.cls ->> 'status' = 'km_divergence' then
                    jsonb_build_object('level', 'warning', 'field', 'km', 'code', 'km_divergence',
                    'message', format('KM informado %s difere do calculado %s (final − inicial); vale o calculado.',
                                      c.km_inf, c.cls ->> 'calculated')) end,
               case when c.vehicle_id is not null and not c.is_future
                         and (c.cls ->> 'status' = 'high_mileage' or c.cls -> 'alerts' ? 'high_mileage') then
                    jsonb_build_object('level', 'warning', 'field', 'km', 'code', 'high_mileage',
                    'message', format('Alta rodagem: %s km no dia (limite %s km).', c.cls ->> 'validated', v_set.high_mileage_km)) end,
               case when cardinality(c.reg_diff) > 0 and not c.is_future then
                    jsonb_build_object('level', 'warning', 'field', 'vehicle', 'code', 'registry_divergence',
                    'message', 'Divergência cadastral: ' || array_to_string(c.reg_diff, '; ') || '. O cadastro não é alterado.') end,
               case when c.vehicle_id is not null and c.deleted_at is null and c.vehicle_status <> 'active'
                         and not c.no_odo and not c.is_future then
                    jsonb_build_object('level', 'warning', 'field', 'vehicle', 'code', 'inactive_vehicle',
                    'message', format('Veículo %s com situação %s no cadastro e com leitura no dia.', c.plate, c.vehicle_status)) end,
               case when c.ex_id is not null and c.ex_corrected and c.ex_hash is distinct from md5(concat_ws('|', c.plate_norm, c.dt, c.o_start, c.o_end, c.km_inf)) then
                    jsonb_build_object('level', 'warning', 'field', 'odometer', 'code', 'manual_correction_kept',
                    'message', format('Leitura corrigida manualmente no HFM (KM %s); a planilha (KM %s) não a sobrescreve.',
                                      c.ex_valid, coalesce(c.cls ->> 'validated', 'sem leitura'))) end
             ], null) as issues
        from c
    ),
    f as (
      select e.*,
             case when exists (select 1 from unnest(e.issues) i where i ->> 'level' = 'error') then 'error'
                  when e.is_future and e.no_odo then 'skipped'
                  when cardinality(e.issues) > 0 then 'warning'
                  else 'valid' end as level
        from e
    ),
    g as (
      select f.*,
             case when f.level in ('error', 'skipped') then 'skip'
                  when f.ex_id is null then 'create'
                  when f.ex_corrected then 'skip'
                  when f.ex_hash = f.row_hash
                       or (f.ex_start is not distinct from f.o_start and f.ex_end is not distinct from f.o_end
                           and f.ex_km is not distinct from f.km_inf) then 'skip'
                  else 'update' end as act
        from f
    )
    select g.row_number, g.raw,
           jsonb_build_object(
             'plate', g.plate, 'plate_norm', g.plate_norm, 'fleet', g.fleet, 'type', g.type_inf, 'model', g.model_inf,
             'ref', g.ref, 'date', g.dt, 'start', g.o_start, 'end', g.o_end, 'km', g.km_inf,
             'vehicle_id', g.vehicle_id, 'vehicle_type_id', g.vehicle_type_id,
             'vehicle_subcategory_id', g.vehicle_subcategory_id, 'vehicle_model_id', g.vehicle_model_id,
             'status', case when g.level in ('error', 'skipped') then null else g.cls ->> 'status' end,
             'calculated', g.cls -> 'calculated', 'validated', g.cls -> 'validated', 'alerts', g.cls -> 'alerts',
             'registry_divergence', to_jsonb(g.reg_diff),
             'future_placeholder', g.is_future and g.no_odo,
             'key', case when g.vehicle_id is not null and g.dt is not null then g.vehicle_id::text || '|' || g.dt end,
             'hash', g.row_hash,
             'unchanged', g.ex_id is not null and g.act = 'skip' and g.level in ('valid', 'warning') and not coalesce(g.ex_corrected, false),
             'existing', case when g.ex_id is not null then jsonb_build_object(
                             'id', g.ex_id, 'start', g.ex_start, 'end', g.ex_end, 'km', g.ex_km, 'validated', g.ex_valid,
                             'status', g.ex_status, 'corrected', g.ex_corrected) end,
             'issues', to_jsonb(g.issues)),
           g.level, g.act, g.vehicle_id, g.issues
      from g;
end;
$$;

revoke all on function private.km_import_evaluate(uuid, jsonb) from public, anon;

-- -----------------------------------------------------------------------------
-- 7. Importação — staging, validação e prévia
-- -----------------------------------------------------------------------------
create or replace function public.stage_km_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'load');
  v_limit    integer := greatest(coalesce(nullif(p_payload ->> 'limit', '')::integer, 2000), 1);
  v_batch    uuid := nullif(p_payload ->> 'batch_id', '')::uuid;
  v_b        public.import_batches;
  v_set      public.km_settings := private.km_settings_of(p_organization_id);
  v_today    date := private.maintenance_today(p_organization_id);
  v_loaded   integer;
  v_sheet    text;
  v_cont     jsonb;
  v_summary  jsonb;
begin
  if not private.has_permission(p_organization_id, 'km.import') then
    raise exception 'Você não possui permissão para importar KM.' using errcode = 'insufficient_privilege';
  end if;
  if v_phase not in ('load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;

  if v_batch is null then
    if v_phase <> 'load' then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    -- A aba oficial é exatamente "Controle KM Rodado". Nenhuma outra aba
    -- (Base_Dados_Fidelização, Geotab, Mob7…) é aceita como fonte.
    v_sheet := btrim(coalesce(p_payload ->> 'sheet_name', ''));
    if private.maintenance_norm(v_sheet) is distinct from 'controle km rodado' then
      raise exception 'A aba Controle KM Rodado não foi localizada.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A aba Controle KM Rodado não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values
      (p_organization_id, 'km', 'create_update', 'draft', coalesce(nullif(p_payload ->> 'file_name', ''), 'Base Geral KM Rodado.xlsx'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb),
       jsonb_build_object('kind', 'km', 'sheet_name', v_sheet,
                          'header_row', nullif(p_payload ->> 'header_row', '')::integer,
                          'source_type', 'manual_xlsx'),
       auth.uid(), auth.uid())
    returning id into v_batch;
  end if;

  select * into v_b from public.import_batches b
   where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'km'
     and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
   for update;
  if v_b.id is null then
    raise exception 'Esta importação não está mais aberta. Envie o arquivo novamente.' using errcode = 'invalid_parameter_value';
  end if;

  -- ---------------------------------------------------------------- load ----
  if v_phase = 'load' then
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    -- Cada linha é gravada uma única vez, já avaliada (o staging tem muitos
    -- índices de outras bases: reescrever 30 mil linhas custaria caro).
    with ev as (
      select * from private.km_import_evaluate(p_organization_id, (
        select coalesce(jsonb_agg(e.value || jsonb_build_object('row_number',
                 coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1))), '[]'::jsonb)
          from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)))
    ),
    ins as (
      insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action, vehicle_id)
      select p_organization_id, v_batch, ev.row_number, ev.raw, ev.normalized, ev.level, ev.action, ev.vehicle_id
        from ev
      on conflict (batch_id, row_number) do nothing
      returning row_number
    )
    insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
    select p_organization_id, v_batch, ev.row_number, i ->> 'level', i ->> 'field', i ->> 'code', i ->> 'message'
      from ev join ins on ins.row_number = ev.row_number
      cross join lateral unnest(ev.issues) as i;
    return jsonb_build_object('batch_id', v_batch,
                              'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  -- ------------------------------------------------------------ validate ----
  -- As linhas já chegam avaliadas pelo load; aqui só sobra o que tenha sido
  -- gravado como pendente por uma versão anterior.
  if v_phase = 'validate' then
    with p as (
      select x.id, x.row_number, x.raw_data, x.normalized_data
        from public.import_rows x
       where x.batch_id = v_batch and x.status = 'pending'
       order by x.row_number limit v_limit
    ),
    ev as (
      select * from private.km_import_evaluate(p_organization_id,
        (select coalesce(jsonb_agg(p.normalized_data || jsonb_build_object('row_number', p.row_number, 'raw', p.raw_data)), '[]'::jsonb) from p))
    ),
    u as (
      update public.import_rows x set status = ev.level, action = ev.action, vehicle_id = ev.vehicle_id, normalized_data = ev.normalized
        from ev where x.batch_id = v_batch and x.row_number = ev.row_number
      returning x.row_number, ev.issues
    )
    insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
    select p_organization_id, v_batch, u.row_number, i ->> 'level', i ->> 'field', i ->> 'code', i ->> 'message'
      from u cross join lateral unnest(u.issues) as i;

    return jsonb_build_object('batch_id', v_batch,
      'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
  end if;

  -- ------------------------------------------------------------ finalize ----
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;

  if v_b.status = 'draft' then
    -- Duplicidade placa+data no arquivo: valores iguais → a primeira vale e as
    -- outras são ignoradas (aviso); valores diferentes → nenhuma é gravada.
    with k as (
      select x.id, x.row_number, x.normalized_data ->> 'key' as key, x.normalized_data ->> 'hash' as hash,
             count(*) over (partition by x.normalized_data ->> 'key') as n,
             min(x.normalized_data ->> 'hash') over (partition by x.normalized_data ->> 'key')
               <> max(x.normalized_data ->> 'hash') over (partition by x.normalized_data ->> 'key') as conflicting,
             row_number() over (partition by x.normalized_data ->> 'key' order by x.row_number) as rn,
             string_agg(x.row_number::text, ', ') over (partition by x.normalized_data ->> 'key') as rows_list
        from public.import_rows x
       where x.batch_id = v_batch and x.status in ('valid', 'warning') and x.normalized_data ->> 'key' is not null
    ),
    d as (select * from k where k.n > 1 and (k.conflicting or k.rn > 1)),
    u as (
      update public.import_rows x set
        status = case when d.conflicting then 'error' else 'skipped' end,
        action = 'skip'
        from d where x.id = d.id
      returning x.row_number, d.conflicting, d.rows_list, x.normalized_data ->> 'plate' as plate, x.normalized_data ->> 'date' as dt
    )
    insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
    select p_organization_id, v_batch, u.row_number,
           case when u.conflicting then 'error' else 'warning' end, 'date',
           case when u.conflicting then 'duplicate_conflict' else 'duplicate_identical' end,
           case when u.conflicting
                then format('Placa %s e data %s repetidas no arquivo com valores diferentes (linhas %s): nenhuma é gravada.',
                            u.plate, to_char(u.dt::date, 'DD/MM/YYYY'), u.rows_list)
                else format('Placa %s e data %s repetidas no arquivo com os mesmos valores (linhas %s): a primeira vale.',
                            u.plate, to_char(u.dt::date, 'DD/MM/YYYY'), u.rows_list) end
      from u;

    -- Continuidade do hodômetro (regressão / salto) contra o dia anterior com
    -- leitura — no arquivo ou no razão.
    select coalesce(jsonb_agg(jsonb_build_object('vehicle_id', x.normalized_data ->> 'vehicle_id',
                                                 'date', x.normalized_data ->> 'date',
                                                 'start', x.normalized_data ->> 'start',
                                                 'end', x.normalized_data ->> 'end')), '[]'::jsonb)
      into v_cont
      from public.import_rows x
     where x.batch_id = v_batch and x.status in ('valid', 'warning')
       and x.normalized_data ->> 'status' not in ('no_reading', 'inconsistent');

    with sig as (select * from private.km_continuity(p_organization_id, v_cont)),
    u as (
      update public.import_rows x set
        status = 'warning',
        normalized_data = x.normalized_data
          || jsonb_build_object(
               'alerts', coalesce(x.normalized_data -> 'alerts', '[]'::jsonb) || to_jsonb(sig.signal),
               'alert_detail', jsonb_build_object(sig.signal, jsonb_build_object('prev_date', sig.prev_date, 'prev_end', sig.prev_end, 'gap', sig.gap)),
               'status', case when sig.signal = 'odometer_regression'
                                   and x.normalized_data ->> 'status' in ('validated', 'no_movement', 'high_mileage')
                              then 'pending_review' else x.normalized_data ->> 'status' end)
        from sig
       where x.batch_id = v_batch and x.status in ('valid', 'warning')
         and (x.normalized_data ->> 'vehicle_id')::uuid = sig.vehicle_id
         and (x.normalized_data ->> 'date')::date = sig.reading_date
      returning x.row_number, x.normalized_data ->> 'plate' as plate, sig.*
    )
    insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
    select p_organization_id, v_batch, u.row_number, 'warning', 'odometer', u.signal,
           case when u.signal = 'odometer_regression'
                then format('Hodômetro regressivo: inicial abaixo do final de %s (%s km; diferença %s km). Leitura pendente de análise.',
                            to_char(u.prev_date, 'DD/MM/YYYY'), u.prev_end, u.gap)
                else format('Salto de hodômetro: inicial %s km acima do final de %s (%s km).',
                            u.gap, to_char(u.prev_date, 'DD/MM/YYYY'), u.prev_end) end
      from u;

    -- Uma linha que mudou de status (pendente de análise) volta a ser
    -- comparada com o razão: o que era "igual" pode ter de ser atualizado.
    update public.import_rows x set action = 'update'
     where x.batch_id = v_batch and x.status in ('valid', 'warning') and x.action = 'skip'
       and x.normalized_data -> 'existing' is not null
       and not coalesce((x.normalized_data -> 'existing' ->> 'corrected')::boolean, false)
       and x.normalized_data ->> 'status' is distinct from x.normalized_data -> 'existing' ->> 'status';
  end if;

  -- Resumo da prévia (contado por linha, nunca por achado).
  with r as (
    select x.row_number, x.status, x.action, x.normalized_data as d
      from public.import_rows x where x.batch_id = v_batch
  ),
  ok as (select * from r where r.status in ('valid', 'warning') and r.d ->> 'status' is not null),
  -- operação atual de cada veículo do arquivo (uma consulta por veículo)
  vop as (
    select vv.vehicle_id, pf.operation_id
      from (select distinct (ok.d ->> 'vehicle_id')::uuid as vehicle_id from ok) vv
      left join lateral (select f.operation_id from private.adherence_planned_fleet(
                           p_organization_id, v_today, null, vv.vehicle_id) f limit 1) pf on true
  )
  select jsonb_build_object(
    'sheet_name', v_b.summary ->> 'sheet_name',
    'header_row', v_b.summary -> 'header_row',
    'period_from', (select min((r.d ->> 'date')::date) from r where r.d ->> 'date' is not null and not coalesce((r.d ->> 'future_placeholder')::boolean, false)),
    'period_to', (select max((r.d ->> 'date')::date) from r where r.d ->> 'date' is not null and not coalesce((r.d ->> 'future_placeholder')::boolean, false)),
    'rows', (select count(*) from r),
    'plates', (select count(distinct r.d ->> 'plate_norm') from r where r.d ->> 'plate_norm' is not null),
    'vehicles', (select count(distinct ok.d ->> 'vehicle_id') from ok),
    'km_total', (select coalesce(sum((ok.d ->> 'validated')::numeric), 0) from ok join public.km_reading_statuses s on s.code = ok.d ->> 'status' and s.counts_distance),
    'create_rows', (select count(*) from r where r.action = 'create'),
    'update_rows', (select count(*) from r where r.action = 'update'),
    'unchanged_rows', (select count(*) from r where coalesce((r.d ->> 'unchanged')::boolean, false) and r.action = 'skip'),
    'manual_kept_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'manual_correction_kept'),
    'by_status', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                    from (select ok.d ->> 'status' as status, count(*) as n from ok group by 1) s),
    'no_reading_rows', (select count(*) from ok where ok.d ->> 'status' = 'no_reading'),
    'no_movement_rows', (select count(*) from ok where ok.d ->> 'status' = 'no_movement'),
    'inconsistent_rows', (select count(*) from ok where ok.d ->> 'status' = 'inconsistent'),
    'high_mileage_rows', (select count(*) from ok where ok.d ->> 'status' = 'high_mileage' or ok.d -> 'alerts' ? 'high_mileage'),
    'divergence_rows', (select count(*) from ok where ok.d ->> 'status' = 'km_divergence'),
    'pending_review_rows', (select count(*) from ok where ok.d ->> 'status' = 'pending_review'),
    'jump_rows', (select count(*) from ok where ok.d -> 'alerts' ? 'odometer_jump'),
    'registry_divergence_rows', (select count(*) from r where jsonb_array_length(coalesce(r.d -> 'registry_divergence', '[]')) > 0),
    'unregistered_plates', (select coalesce(jsonb_agg(jsonb_build_object('plate', q.plate, 'rows', q.n) order by q.n desc, q.plate), '[]'::jsonb)
                              from (select e.message, r.d ->> 'plate' as plate, count(*) as n
                                      from public.import_errors e join r on r.row_number = e.row_number
                                     where e.batch_id = v_batch and e.code = 'unregistered_plate' group by 1, 2) q),
    'duplicate_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code in ('duplicate_conflict', 'duplicate_identical')),
    'future_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'future_date'),
    'future_placeholder_rows', (select count(*) from r where coalesce((r.d ->> 'future_placeholder')::boolean, false)),
    'error_rows', (select count(*) from r where r.status = 'error'),
    'already_imported', exists (select 1 from public.import_batches b
                                 where b.organization_id = p_organization_id and b.type = 'km' and b.status = 'completed'
                                   and b.file_hash is not null and b.file_hash = v_b.file_hash and b.id <> v_batch),
    -- comparação: o que o razão tem hoje × o que o arquivo traz
    'compare_months', (
      select coalesce(jsonb_agg(m order by m ->> 'month'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'month', to_char(date_trunc('month', (ok.d ->> 'date')::date), 'YYYY-MM'),
                 'km_file', round(coalesce(sum((ok.d ->> 'validated')::numeric) filter (where s.counts_distance), 0), 1),
                 'km_current', round(coalesce(sum((ok.d -> 'existing' ->> 'validated')::numeric), 0), 1),
                 'new_rows', count(*) filter (where ok.action = 'create'),
                 'update_rows', count(*) filter (where ok.action = 'update')) as m
          from ok join public.km_reading_statuses s on s.code = ok.d ->> 'status'
         group by date_trunc('month', (ok.d ->> 'date')::date)) q),
    'compare_vehicles', (
      select coalesce(jsonb_agg(q.j order by abs((q.j ->> 'diff')::numeric) desc, q.j ->> 'plate'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'vehicle_id', ok.d ->> 'vehicle_id', 'plate', min(ok.d ->> 'plate'), 'fleet', min(ok.d ->> 'fleet'),
                 'km_file', round(coalesce(sum((ok.d ->> 'validated')::numeric) filter (where s.counts_distance), 0), 1),
                 'km_current', round(coalesce(sum((ok.d -> 'existing' ->> 'validated')::numeric), 0), 1),
                 'diff', round(coalesce(sum((ok.d ->> 'validated')::numeric) filter (where s.counts_distance), 0)
                               - coalesce(sum((ok.d -> 'existing' ->> 'validated')::numeric), 0), 1)) as j
          from ok join public.km_reading_statuses s on s.code = ok.d ->> 'status'
         group by ok.d ->> 'vehicle_id') q),
    'compare_operations', (
      select coalesce(jsonb_agg(q.j order by q.j ->> 'operation'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'operation_id', vop.operation_id,
                 'operation', coalesce((select o.name from public.operations o where o.id = vop.operation_id), 'Sem operação'),
                 'km_file', round(coalesce(sum((ok.d ->> 'validated')::numeric) filter (where s.counts_distance), 0), 1),
                 'km_current', round(coalesce(sum((ok.d -> 'existing' ->> 'validated')::numeric), 0), 1)) as j
          from ok
          join public.km_reading_statuses s on s.code = ok.d ->> 'status'
          left join vop on vop.vehicle_id = (ok.d ->> 'vehicle_id')::uuid
         group by vop.operation_id) q)
  ) into v_summary;

  update public.import_batches set
    status = 'validated',
    total_rows = (select count(*) from public.import_rows x where x.batch_id = v_batch),
    valid_rows = (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'valid'),
    warning_rows = (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'warning'),
    error_rows = (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'error'),
    skipped_rows = (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'skip'),
    summary = coalesce(summary, '{}'::jsonb) || v_summary,
    updated_at = now(), updated_by = auth.uid()
  where id = v_batch;

  return (
    select jsonb_build_object(
      'batch_id', v_batch, 'file_name', b.file_name, 'summary', b.summary,
      'total_rows', b.total_rows, 'valid_rows', b.valid_rows, 'warning_rows', b.warning_rows, 'error_rows', b.error_rows,
      'categories', (select coalesce(jsonb_object_agg(q.code, q.n), '{}'::jsonb)
                       from (select e.code, count(*) as n from public.import_errors e where e.batch_id = v_batch group by 1) q),
      'findings', (select coalesce(jsonb_agg(jsonb_build_object('row_number', q.row_number, 'level', q.level, 'field', q.field,
                                                                'code', q.code, 'message', q.message)
                                             order by q.level, q.row_number), '[]'::jsonb)
                     from (select * from public.import_errors e where e.batch_id = v_batch
                            order by (e.level = 'error') desc, e.row_number limit 500) q))
      from public.import_batches b where b.id = v_batch);
end;
$$;

revoke all on function public.stage_km_import(uuid, jsonb) from public, anon;
grant execute on function public.stage_km_import(uuid, jsonb) to authenticated, service_role;

comment on function public.stage_km_import(uuid, jsonb) is
  'Importação de KM (aba Controle KM Rodado): load → validate → finalize (prévia). Exige km.import. Não cria veículos nem altera o cadastro.';

-- Achados de um lote, paginados (a prévia mostra os 500 primeiros; aqui todos).
create or replace function public.km_import_findings(
  p_batch_id uuid, p_code text default null, p_limit integer default 200, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select b.organization_id into v_org from public.import_batches b where b.id = p_batch_id and b.type = 'km';
  if v_org is null or not (private.has_permission(v_org, 'km.import') or private.has_permission(v_org, 'km.view_quality')) then
    raise exception 'Você não possui permissão para ver esta importação.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.import_errors e where e.batch_id = p_batch_id and (p_code is null or e.code = p_code)),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                     'row_number', q.row_number, 'level', q.level, 'field', q.field, 'code', q.code, 'message', q.message,
                     'plate', q.plate, 'date', q.dt) order by (q.level = 'error') desc, q.row_number), '[]'::jsonb)
               from (select e.*, x.normalized_data ->> 'plate' as plate, x.normalized_data ->> 'date' as dt
                       from public.import_errors e
                       left join public.import_rows x on x.batch_id = e.batch_id and x.row_number = e.row_number
                      where e.batch_id = p_batch_id and (p_code is null or e.code = p_code)
                      order by (e.level = 'error') desc, e.row_number
                      limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) q));
end;
$$;

revoke all on function public.km_import_findings(uuid, text, integer, integer) from public, anon;
grant execute on function public.km_import_findings(uuid, text, integer, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Importação — consolidação em partes
-- -----------------------------------------------------------------------------
create or replace function public.process_km_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default 2000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b         public.import_batches;
  v_limit     integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_source    uuid;
  v_vids      uuid[];
  v_dates     date[];
  v_ids       uuid[];
  v_reading_ids uuid[];
  v_remaining integer;
  v_created   integer;
  v_updated   integer;
  v_events    integer := 0;
  v_actor     text := private.km_actor_name();
  r           record;
begin
  if not private.has_permission(p_organization_id, 'km.import') then
    raise exception 'Você não possui permissão para importar KM.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_b from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type = 'km'
     and b.status in ('validated', 'processing')
   for update;
  if v_b.id is null then
    raise exception 'Esta importação não está pronta para gravar.' using errcode = 'invalid_parameter_value';
  end if;
  v_source := private.km_source_id(p_organization_id, 'manual_xlsx', 'Planilha Controle KM Rodado');

  if v_b.status = 'validated' then
    -- O hodômetro de antes (para avisar marcos preventivos alcançados no fim).
    update public.import_batches set
      status = 'processing',
      summary = summary || jsonb_build_object('km_before', (
        select coalesce(jsonb_object_agg(q.vehicle_id, q.km), '{}'::jsonb)
          from (select distinct (x.normalized_data ->> 'vehicle_id')::uuid as vehicle_id
                  from public.import_rows x
                 where x.batch_id = p_batch_id and x.action in ('create', 'update')) vv
          cross join lateral (select vv.vehicle_id, k.km from private.vehicle_current_km(vv.vehicle_id) k) q)),
      updated_at = now(), updated_by = auth.uid()
    where id = p_batch_id;
  end if;

  select array_agg((x.normalized_data ->> 'vehicle_id')::uuid order by x.row_number),
         array_agg((x.normalized_data ->> 'date')::date order by x.row_number),
         array_agg(x.id order by x.row_number)
    into v_vids, v_dates, v_ids
    from (select x.* from public.import_rows x
           where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
           order by x.row_number limit v_limit) x;

  if v_ids is not null then
    -- Trilha das atualizações: o que o razão tinha × o que a planilha trouxe.
    insert into public.km_reading_audit
      (organization_id, reading_id, vehicle_id, reading_date, action, changes, reason, batch_id, actor_user_id, actor_name)
    select p_organization_id, ex.id, ex.vehicle_id, ex.reading_date, 'import_update',
           jsonb_strip_nulls(jsonb_build_object(
             'odometer_start', case when ex.odometer_start_imported is distinct from (x.normalized_data ->> 'start')::numeric
                                    then jsonb_build_object('from', ex.odometer_start_imported, 'to', (x.normalized_data ->> 'start')::numeric) end,
             'odometer_end', case when ex.odometer_end_imported is distinct from (x.normalized_data ->> 'end')::numeric
                                  then jsonb_build_object('from', ex.odometer_end_imported, 'to', (x.normalized_data ->> 'end')::numeric) end,
             'distance_imported', case when ex.distance_imported is distinct from (x.normalized_data ->> 'km')::numeric
                                       then jsonb_build_object('from', ex.distance_imported, 'to', (x.normalized_data ->> 'km')::numeric) end,
             'status', case when ex.status is distinct from x.normalized_data ->> 'status'
                            then jsonb_build_object('from', ex.status, 'to', x.normalized_data ->> 'status') end)),
           format('Atualizada pela importação %s (linha %s).', v_b.file_name, x.row_number), p_batch_id, auth.uid(), v_actor
      from public.import_rows x
      join public.km_daily_readings ex
        on ex.organization_id = p_organization_id
       and ex.vehicle_id = (x.normalized_data ->> 'vehicle_id')::uuid
       and ex.reading_date = (x.normalized_data ->> 'date')::date
     where x.id = any (v_ids) and x.action = 'update' and not ex.is_corrected;

    with ctx as (select * from private.km_context_pairs(p_organization_id, v_vids, v_dates)),
    up as (
      insert into public.km_daily_readings as k (
        organization_id, vehicle_id, reading_date, plate_snapshot, fleet_code_snapshot, type_informed, model_informed,
        vehicle_type_id, vehicle_subcategory_id, vehicle_model_id,
        odometer_start_imported, odometer_end_imported, distance_imported, distance_calculated,
        odometer_start, odometer_end, distance_validated, status, alerts, alert_detail,
        context_source, operation_id, operation_city_id, state_id, city_id, operation_br_id, fidelization_assignment_id,
        leader_employee_id, organization_unit_id, context_resolved_at,
        source_type, source_id, source_reference, source_hash, ingested_at, import_batch_id, created_by, updated_by)
      select p_organization_id, (d ->> 'vehicle_id')::uuid, (d ->> 'date')::date,
             d ->> 'plate', d ->> 'fleet', d ->> 'type', d ->> 'model',
             (d ->> 'vehicle_type_id')::uuid, (d ->> 'vehicle_subcategory_id')::uuid, (d ->> 'vehicle_model_id')::uuid,
             (d ->> 'start')::numeric, (d ->> 'end')::numeric, (d ->> 'km')::numeric, (d ->> 'calculated')::numeric,
             case when d ->> 'status' = 'no_reading' then null else (d ->> 'start')::numeric end,
             case when d ->> 'status' = 'no_reading' then null else (d ->> 'end')::numeric end,
             case when s.counts_distance then (d ->> 'validated')::numeric end,
             d ->> 'status',
             coalesce((select array_agg(distinct a) from jsonb_array_elements_text(coalesce(d -> 'alerts', '[]'::jsonb)) a), '{}')
               || case when jsonb_array_length(coalesce(d -> 'registry_divergence', '[]'::jsonb)) > 0
                       then array['registry_divergence'] else '{}'::text[] end,
             coalesce(d -> 'alert_detail', '{}'::jsonb)
               || case when jsonb_array_length(coalesce(d -> 'registry_divergence', '[]'::jsonb)) > 0
                       then jsonb_build_object('registry_divergence', d -> 'registry_divergence') else '{}'::jsonb end,
             coalesce(c.context_source, 'none'), c.operation_id, c.operation_city_id, c.state_id, c.city_id, c.operation_br_id,
             c.fidelization_assignment_id, c.leader_employee_id, c.organization_unit_id, now(),
             'manual_xlsx', v_source,
             format('%s!%s', coalesce(v_b.summary ->> 'sheet_name', 'Controle KM Rodado'), x.row_number)
               || coalesce(' · ' || (d ->> 'ref'), ''),
             d ->> 'hash', now(), p_batch_id, auth.uid(), auth.uid()
        from public.import_rows x
        cross join lateral (select x.normalized_data as d) dd
        join public.km_reading_statuses s on s.code = dd.d ->> 'status'
        left join ctx c on c.vehicle_id = (dd.d ->> 'vehicle_id')::uuid and c.day = (dd.d ->> 'date')::date
       where x.id = any (v_ids)
      on conflict (organization_id, vehicle_id, reading_date) do update set
        plate_snapshot = excluded.plate_snapshot, fleet_code_snapshot = excluded.fleet_code_snapshot,
        type_informed = excluded.type_informed, model_informed = excluded.model_informed,
        vehicle_type_id = excluded.vehicle_type_id, vehicle_subcategory_id = excluded.vehicle_subcategory_id,
        vehicle_model_id = excluded.vehicle_model_id,
        odometer_start_imported = excluded.odometer_start_imported, odometer_end_imported = excluded.odometer_end_imported,
        distance_imported = excluded.distance_imported, distance_calculated = excluded.distance_calculated,
        odometer_start = excluded.odometer_start, odometer_end = excluded.odometer_end,
        distance_validated = excluded.distance_validated, status = excluded.status,
        alerts = excluded.alerts, alert_detail = excluded.alert_detail,
        context_source = excluded.context_source, operation_id = excluded.operation_id,
        operation_city_id = excluded.operation_city_id, state_id = excluded.state_id, city_id = excluded.city_id,
        operation_br_id = excluded.operation_br_id, fidelization_assignment_id = excluded.fidelization_assignment_id,
        leader_employee_id = excluded.leader_employee_id, organization_unit_id = excluded.organization_unit_id,
        context_resolved_at = excluded.context_resolved_at,
        source_type = excluded.source_type, source_id = excluded.source_id, source_reference = excluded.source_reference,
        source_hash = excluded.source_hash, ingested_at = excluded.ingested_at, import_batch_id = excluded.import_batch_id,
        updated_at = now(), updated_by = auth.uid()
      where not k.is_corrected
      returning k.id, (k.xmax = 0) as inserted
    )
    select count(*) filter (where up.inserted), count(*) filter (where not up.inserted), array_agg(up.id)
      into v_created, v_updated, v_reading_ids
      from up;

    perform private.km_sync_odometer(coalesce(v_reading_ids, '{}'));

    update public.import_rows x set status = case when x.action = 'create' then 'created' else 'updated' end
     where x.id = any (v_ids);
  end if;

  select count(*) into v_remaining from public.import_rows x
   where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update');

  if v_remaining > 0 then
    return jsonb_build_object('done', false, 'remaining', v_remaining);
  end if;

  -- ------------------------------------------------------------ conclusão ----
  update public.import_batches set
    status = 'completed', processed_at = now(),
    created_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'created'),
    updated_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'updated'),
    skipped_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status not in ('created', 'updated')),
    updated_at = now(), updated_by = auth.uid()
  where id = p_batch_id
  returning * into v_b;

  update public.km_data_sources set last_ingested_at = now() where id = v_source;

  perform private.emit_event(p_organization_id, 'km.readings_imported', 'import_batch', p_batch_id,
    jsonb_build_object('file_name', v_b.file_name, 'created', v_b.created_rows, 'updated', v_b.updated_rows,
                       'period_from', v_b.summary ->> 'period_from', 'period_to', v_b.summary ->> 'period_to',
                       'source_type', 'manual_xlsx'));

  -- Marco preventivo alcançado: o hodômetro passou do marco de um ciclo ainda
  -- aberto. É aviso gerencial; nenhuma manutenção é gerada.
  for r in
    select c.vehicle_id, c.cycle_number, c.milestone_km,
           coalesce((v_b.summary -> 'km_before' ->> c.vehicle_id::text)::integer, 0) as km_before, k.km as km_now,
           (select v.license_plate from public.vehicles v where v.id = c.vehicle_id) as plate
      from public.maintenance_preventive_cycles c
      cross join lateral private.vehicle_current_km(c.vehicle_id) k
     where c.organization_id = p_organization_id and c.completed_on is null
       and c.vehicle_id in (select distinct (x.normalized_data ->> 'vehicle_id')::uuid
                              from public.import_rows x where x.batch_id = p_batch_id and x.status in ('created', 'updated'))
       and (v_b.summary -> 'km_before') ? c.vehicle_id::text
       and c.milestone_km > (v_b.summary -> 'km_before' ->> c.vehicle_id::text)::integer
       and c.milestone_km <= k.km
  loop
    perform private.emit_event(p_organization_id, 'km.preventive_milestone_reached', 'vehicle', r.vehicle_id,
      jsonb_build_object('license_plate', r.plate, 'cycle_number', r.cycle_number, 'milestone_km', r.milestone_km,
                         'km_before', r.km_before, 'km_now', r.km_now, 'batch_id', p_batch_id));
    v_events := v_events + 1;
  end loop;

  return jsonb_build_object('done', true, 'remaining', 0, 'outcome', jsonb_build_object(
    'batch_id', p_batch_id, 'created_rows', v_b.created_rows, 'updated_rows', v_b.updated_rows,
    'skipped_rows', v_b.skipped_rows, 'milestone_events', v_events));
end;
$$;

revoke all on function public.process_km_import(uuid, uuid, integer) from public, anon;
grant execute on function public.process_km_import(uuid, uuid, integer) to authenticated, service_role;

create or replace function public.cancel_km_import(p_organization_id uuid, p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'km.import') then
    raise exception 'Você não possui permissão para importar KM.' using errcode = 'insufficient_privilege';
  end if;
  update public.import_batches set status = 'cancelled', updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id and organization_id = p_organization_id and type = 'km' and status in ('draft', 'validated');
  return found;
end;
$$;

revoke all on function public.cancel_km_import(uuid, uuid) from public, anon;
grant execute on function public.cancel_km_import(uuid, uuid) to authenticated, service_role;
