-- =============================================================================
-- Gestão de Pneus — importação oficial do Rodopar 10
--
-- UPLOAD (navegador lê a planilha, identifica a janela N.Fogo→Desenho/Borracha
-- e envia as células em partes) → STAGING (tire_import_staging, independente
-- da base) → VALIDAÇÃO + QUALIDADE + ENRIQUECIMENTO + COMPARAÇÃO (aqui, no
-- banco: nada do navegador é confiado) → PRÉVIA → CONFIRMAÇÃO atômica →
-- cadastro + fotografia + eventos + ausentes + reconciliação das vistorias.
--
-- Bloqueiam o lote (nenhuma linha é aplicada): Nº Fogo ausente/inválido,
-- Nº Fogo duplicado, dois pneus em uso na mesma frota + posição, colunas
-- oficiais ausentes, data de referência que não é posterior à última
-- fotografia, arquivo já confirmado. Valor fora do limite técnico invalida só
-- o campo (o bruto fica preservado e a inconsistência vai para a qualidade).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Conversões tolerantes das células (o bruto nunca é descartado)
-- -----------------------------------------------------------------------------
create or replace function private.tire_cell_text(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then null
              else nullif(nullif(btrim(p #>> '{}'), ''), '-') end;
$$;

-- Número: vírgula decimal (8,5), milhar com ponto (1.234,5) ou vírgula
-- (1,234.5). Texto que não é número devolve NaN (inválido ≠ vazio).
create or replace function private.tire_cell_num(p jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare s text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  s := regexp_replace(btrim(p #>> '{}'), '\s', '', 'g');
  if s = '' or s = '-' then return null; end if;
  if s ~ '^-?\d+(,\d+)?$' then return replace(s, ',', '.')::numeric; end if;
  if s ~ '^-?\d+\.\d+$' then return s::numeric; end if;
  if s ~ '^-?\d{1,3}(\.\d{3})+(,\d+)?$' then return replace(replace(s, '.', ''), ',', '.')::numeric; end if;
  if s ~ '^-?\d{1,3}(,\d{3})+(\.\d+)?$' then return replace(s, ',', '')::numeric; end if;
  return 'NaN'::numeric;
exception when others then
  return 'NaN'::numeric;
end;
$$;

-- Data/hora: ISO (o navegador envia a hora "de parede" da célula), serial do
-- Excel ou dd/mm/aaaa [hh:mm[:ss]]. Inválida devolve -infinity.
create or replace function private.tire_cell_ts(p jsonb)
returns timestamp
language plpgsql
immutable
set search_path = ''
as $$
declare s text; n numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'number' then
    n := (p #>> '{}')::numeric;
    if n <= 0 or n > 2958465 then return '-infinity'::timestamp; end if;
    return timestamp '1899-12-30' + make_interval(secs => round(n * 86400));
  end if;
  s := btrim(p #>> '{}');
  if s = '' or s = '-' then return null; end if;
  if s ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z)?$' then
    return replace(replace(s, 'T', ' '), 'Z', '')::timestamp;
  end if;
  if s ~ '^\d{1,2}/\d{1,2}/\d{4}$' then return to_timestamp(s, 'DD/MM/YYYY')::timestamp; end if;
  if s ~ '^\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}$' then return to_timestamp(s, 'DD/MM/YYYY HH24:MI')::timestamp; end if;
  if s ~ '^\d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2}:\d{2}$' then return to_timestamp(s, 'DD/MM/YYYY HH24:MI:SS')::timestamp; end if;
  return '-infinity'::timestamp;
exception when others then
  return '-infinity'::timestamp;
end;
$$;

grant execute on function private.tire_cell_text(jsonb), private.tire_cell_num(jsonb), private.tire_cell_ts(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Início do lote
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_start(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text := lower(nullif(btrim(p_payload ->> 'file_hash'), ''));
  v_name    text := nullif(btrim(p_payload ->> 'file_name'), '');
  v_ref     date;
  v_today   date := private.maintenance_today(p_organization_id);
  v_latest  date := private.tire_latest_reference(p_organization_id);
  v_dup     public.tire_import_batches;
  v_id      uuid;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  if v_name is null then raise exception 'Nome do arquivo ausente.' using errcode = 'invalid_parameter_value'; end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'Assinatura (hash) do arquivo inválida.' using errcode = 'invalid_parameter_value'; end if;
  begin
    v_ref := (p_payload ->> 'reference_date')::date;
  exception when others then
    raise exception 'Data de referência inválida.' using errcode = 'invalid_parameter_value';
  end;
  if v_ref is null then raise exception 'Informe a data de referência da fotografia.' using errcode = 'invalid_parameter_value'; end if;
  if v_ref > v_today then raise exception 'A data de referência não pode ser futura.' using errcode = 'invalid_parameter_value'; end if;

  select * into v_dup from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.file_hash = v_hash and b.status = 'confirmed';
  if v_dup.id is not null then
    raise exception 'Este arquivo já foi importado e confirmado como fotografia de %.', to_char(v_dup.reference_date, 'DD/MM/YYYY')
      using errcode = 'unique_violation', hint = 'tire_duplicate_file', detail = v_dup.id::text;
  end if;
  if v_latest is not null and v_ref <= v_latest then
    raise exception 'Já existe fotografia confirmada em % (ou posterior). A nova data de referência precisa ser posterior.', to_char(v_latest, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value', hint = 'tire_reference_not_after_latest';
  end if;

  insert into public.tire_import_batches (
    organization_id, file_name, file_hash, file_size, sheet_name, header_row, layout_version, window_start, window_end,
    recognized_columns, unrecognized_columns, ignored_columns, reference_date, suggested_reference_date, previous_reference_date,
    status, total_rows, created_by, created_by_name)
  values (
    p_organization_id, left(v_name, 255), v_hash, nullif(p_payload ->> 'file_size', '')::bigint, left(p_payload ->> 'sheet_name', 120),
    nullif(p_payload ->> 'header_row', '')::integer, coalesce(nullif(p_payload ->> 'layout_version', ''), 'rodopar10_v1'),
    left(p_payload ->> 'window_start', 60), left(p_payload ->> 'window_end', 60),
    coalesce(private.jsonb_text_array(p_payload -> 'recognized_columns'), '{}'),
    coalesce(private.jsonb_text_array(p_payload -> 'unrecognized_columns'), '{}'),
    coalesce(private.jsonb_text_array(p_payload -> 'ignored_columns'), '{}'),
    v_ref, nullif(p_payload ->> 'suggested_reference_date', '')::date, v_latest,
    'staging', coalesce(nullif(p_payload ->> 'total_rows', '')::integer, 0), auth.uid(), private.tire_actor_name(p_organization_id))
  returning id into v_id;

  return jsonb_build_object('batch_id', v_id, 'reference_date', v_ref, 'previous_reference_date', v_latest);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Envio das linhas (em partes; reenviar a mesma parte não duplica)
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_stage(p_organization_id uuid, p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.tire_import_batches;
  n integer;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id for update;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;
  if b.status not in ('staging', 'validated', 'blocked') then
    raise exception 'Este lote já foi % e não recebe mais linhas.', case b.status when 'confirmed' then 'confirmado' else 'cancelado' end
      using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Linhas ausentes.' using errcode = 'invalid_parameter_value'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Envie no máximo 2.000 linhas por parte.' using errcode = 'invalid_parameter_value'; end if;

  insert into public.tire_import_staging (organization_id, batch_id, row_number, raw, cells, client_flags)
  select p_organization_id, b.id, (r ->> 'row_number')::integer, coalesce(r -> 'raw', '{}'::jsonb), coalesce(r -> 'cells', '{}'::jsonb),
         coalesce(private.jsonb_text_array(r -> 'flags'), '{}')
    from jsonb_array_elements(p_rows) r
   where (r ->> 'row_number') ~ '^\d+$'
  on conflict (batch_id, row_number) do update
    set raw = excluded.raw, cells = excluded.cells, client_flags = excluded.client_flags, severity = 'pending';
  get diagnostics n = row_count;

  update public.tire_import_batches set status = 'staging', updated_at = now() where id = b.id and status <> 'staging';
  return jsonb_build_object('staged', n);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Validação, qualidade, enriquecimento e comparação (fonte única da prévia
--    e da confirmação)
-- -----------------------------------------------------------------------------
create or replace function private.tire_import_run_validation(p_organization_id uuid, p_batch_id uuid)
returns public.tire_import_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  b          public.tire_import_batches;
  p          public.tire_parameter_sets;
  v_latest   date;
  v_required text[] := array['fire_number', 'status_raw', 'fleet_number', 'position', 'tread_1', 'tread_2', 'tread_3', 'tread_4',
                             'measurement_at', 'psi', 'calibration_at', 'life'];
  v_missing  text[];
  v_limit_ts timestamp;
  v_block    text[] := '{}';
  v_counters jsonb;
  v_dup      uuid;
  n_total integer; n_err integer; n_warn integer; n_new integer; n_upd integer; n_same integer; n_absent integer; n_back integer;
begin
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id for update;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;
  if b.status in ('confirmed', 'cancelled') then
    raise exception 'Este lote já foi % e não pode ser revalidado.', case b.status when 'confirmed' then 'confirmado' else 'cancelado' end
      using errcode = 'invalid_parameter_value';
  end if;
  p := private.tire_params_at(p_organization_id, b.reference_date);
  if p.id is null then raise exception 'Parâmetros de Pneus não cadastrados.' using errcode = 'no_data_found'; end if;
  v_latest := private.tire_latest_reference(p_organization_id);
  v_limit_ts := (b.reference_date + p.future_date_tolerance_days + 1)::timestamp;

  -- ---------------------------------------------------------- passo 1: tipagem e regras por linha
  with cv as (
    select s.id,
      private.tire_fire_number(private.tire_cell_text(s.cells -> 'fire_number')) as fire_number,
      private.tire_cell_text(s.cells -> 'fire_number') as fire_raw,
      private.tire_cell_text(s.cells -> 'serial_number') as serial_number,
      private.tire_cell_text(s.cells -> 'tire_branch') as tire_branch,
      private.tire_cell_text(s.cells -> 'unit_code') as unit_code,
      private.tire_cell_text(s.cells -> 'cost_code') as cost_code,
      private.tire_cell_text(s.cells -> 'status_raw') as status_raw,
      upper(private.tire_cell_text(s.cells -> 'fleet_number')) as fleet_number,
      private.tire_cell_text(s.cells -> 'fleet_branch') as fleet_branch,
      private.tire_cell_text(s.cells -> 'brand') as brand,
      private.tire_cell_text(s.cells -> 'model') as model,
      private.tire_cell_text(s.cells -> 'dimension') as dimension,
      private.tire_position_key(private.tire_cell_text(s.cells -> 'position')) as position_code,
      private.tire_cell_text(s.cells -> 'dot') as dot,
      private.tire_cell_text(s.cells -> 'condition') as condition,
      private.tire_cell_text(s.cells -> 'classification') as classification,
      private.tire_cell_text(s.cells -> 'status_label') as status_label,
      private.tire_cell_text(s.cells -> 'created_by_user') as created_by_user,
      private.tire_cell_text(s.cells -> 'updated_by_user') as updated_by_user,
      private.tire_cell_text(s.cells -> 'drawing') as drawing,
      private.tire_cell_text(s.cells -> 'rubber') as rubber,
      private.tire_cell_num(s.cells -> 'tread_min') as n_tmin,
      private.tire_cell_num(s.cells -> 'tread_1') as n_t1,
      private.tire_cell_num(s.cells -> 'tread_2') as n_t2,
      private.tire_cell_num(s.cells -> 'tread_3') as n_t3,
      private.tire_cell_num(s.cells -> 'tread_4') as n_t4,
      private.tire_cell_num(s.cells -> 'psi') as n_psi,
      private.tire_cell_num(s.cells -> 'km_rodado') as n_kmr,
      private.tire_cell_num(s.cells -> 'km_real') as n_kmreal,
      private.tire_cell_num(s.cells -> 'life') as n_life,
      private.tire_cell_ts(s.cells -> 'purchase_date') as d_purchase,
      private.tire_cell_ts(s.cells -> 'measurement_at') as d_meas,
      private.tire_cell_ts(s.cells -> 'calibration_at') as d_cal,
      private.tire_cell_ts(s.cells -> 'registration_at') as d_reg,
      private.tire_cell_ts(s.cells -> 'updated_at') as d_upd,
      s.client_flags, s.cells
    from public.tire_import_staging s where s.batch_id = b.id
  ),
  ok as (
    select cv.*,
      (cv.n_tmin is not null and (cv.n_tmin = 'NaN' or cv.n_tmin < 0 or cv.n_tmin > p.max_valid_tread_mm)) as bad_tmin,
      (cv.n_t1 is not null and (cv.n_t1 = 'NaN' or cv.n_t1 < 0 or cv.n_t1 > p.max_valid_tread_mm)) as bad_t1,
      (cv.n_t2 is not null and (cv.n_t2 = 'NaN' or cv.n_t2 < 0 or cv.n_t2 > p.max_valid_tread_mm)) as bad_t2,
      (cv.n_t3 is not null and (cv.n_t3 = 'NaN' or cv.n_t3 < 0 or cv.n_t3 > p.max_valid_tread_mm)) as bad_t3,
      (cv.n_t4 is not null and (cv.n_t4 = 'NaN' or cv.n_t4 < 0 or cv.n_t4 > p.max_valid_tread_mm)) as bad_t4,
      (cv.n_psi is not null and (cv.n_psi = 'NaN' or cv.n_psi < 0 or cv.n_psi > p.max_valid_psi)) as bad_psi,
      (cv.n_kmr is not null and (cv.n_kmr = 'NaN' or cv.n_kmr < 0 or cv.n_kmr > 99999999)) as bad_kmr,
      (cv.n_kmreal is not null and (cv.n_kmreal = 'NaN' or abs(cv.n_kmreal) > 99999999)) as bad_kmreal,
      (cv.n_life is not null and (cv.n_life = 'NaN' or cv.n_life < 0 or cv.n_life > 20 or cv.n_life <> trunc(cv.n_life))) as bad_life,
      (cv.d_purchase = '-infinity' or (cv.d_purchase is not null and cv.d_purchase < timestamp '1980-01-01')) as inv_purchase,
      (cv.d_meas = '-infinity' or (cv.d_meas is not null and cv.d_meas < timestamp '1980-01-01')) as inv_meas,
      (cv.d_cal = '-infinity' or (cv.d_cal is not null and cv.d_cal < timestamp '1980-01-01')) as inv_cal,
      (cv.d_reg = '-infinity' or (cv.d_reg is not null and cv.d_reg < timestamp '1980-01-01')) as inv_reg,
      (cv.d_upd = '-infinity' or (cv.d_upd is not null and cv.d_upd < timestamp '1980-01-01')) as inv_upd,
      (cv.d_purchase is not null and cv.d_purchase <> '-infinity' and cv.d_purchase >= v_limit_ts) as fut_purchase,
      (cv.d_meas is not null and cv.d_meas <> '-infinity' and cv.d_meas >= v_limit_ts) as fut_meas,
      (cv.d_cal is not null and cv.d_cal <> '-infinity' and cv.d_cal >= v_limit_ts) as fut_cal,
      (cv.d_reg is not null and cv.d_reg <> '-infinity' and cv.d_reg >= v_limit_ts) as fut_reg,
      (cv.d_upd is not null and cv.d_upd <> '-infinity' and cv.d_upd >= v_limit_ts) as fut_upd,
      private.tire_canonical_status(cv.status_raw) as canonical
    from cv
  ),
  fx as (
    select ok.*,
      case when ok.bad_tmin then null else ok.n_tmin end as v_tmin,
      case when ok.bad_t1 then null else ok.n_t1 end as v_t1,
      case when ok.bad_t2 then null else ok.n_t2 end as v_t2,
      case when ok.bad_t3 then null else ok.n_t3 end as v_t3,
      case when ok.bad_t4 then null else ok.n_t4 end as v_t4,
      case when ok.bad_psi then null else ok.n_psi end as v_psi,
      case when ok.inv_meas or ok.fut_meas then null else ok.d_meas end as v_meas,
      case when ok.inv_cal or ok.fut_cal then null else ok.d_cal end as v_cal
    from ok
  ),
  calc as (
    select fx.*, least(fx.v_t1, fx.v_t2, fx.v_t3, fx.v_t4) as v_tcalc from fx
  ),
  iss as (
    select calc.*,
      array_remove(array[
        case when calc.fire_number is null then jsonb_build_object('code', 'fogo_ausente', 'severity', 'error', 'field', 'fire_number',
             'message', 'Linha com dados e sem Nº Fogo: o pneu não pode ser identificado.') end,
        case when calc.fire_number is not null and calc.fire_number !~ '^[0-9A-Z][0-9A-Z./_-]{0,29}$' then jsonb_build_object('code', 'fogo_invalido', 'severity', 'error',
             'field', 'fire_number', 'value', calc.fire_raw, 'message', format('Nº Fogo "%s" contém caracteres inválidos.', calc.fire_raw)) end,
        case when calc.bad_tmin then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_min', 'value', calc.n_tmin::text,
             'message', format('Menor milimetragem %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_tmin, p.max_valid_tread_mm)) end,
        case when calc.bad_t1 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_1', 'value', calc.n_t1::text,
             'message', format('Sulco 1 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t1, p.max_valid_tread_mm)) end,
        case when calc.bad_t2 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_2', 'value', calc.n_t2::text,
             'message', format('Sulco 2 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t2, p.max_valid_tread_mm)) end,
        case when calc.bad_t3 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_3', 'value', calc.n_t3::text,
             'message', format('Sulco 3 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t3, p.max_valid_tread_mm)) end,
        case when calc.bad_t4 then jsonb_build_object('code', 'sulco_invalido', 'severity', 'warning', 'field', 'tread_4', 'value', calc.n_t4::text,
             'message', format('Sulco 4 = %s fora do limite técnico (0 a %s mm): valor ignorado.', calc.n_t4, p.max_valid_tread_mm)) end,
        case when calc.v_tmin is not null and calc.v_tcalc is not null and abs(calc.v_tmin - calc.v_tcalc) > p.tread_min_divergence_tolerance_mm
             then jsonb_build_object('code', 'menor_mm_divergente', 'severity', 'warning', 'field', 'tread_min', 'value', calc.v_tmin::text,
             'message', format('Menor milimetragem informada (%s mm) difere do menor sulco medido (%s mm).', calc.v_tmin, calc.v_tcalc)) end,
        case when calc.canonical = 'em_uso' and calc.v_tmin is null and calc.v_tcalc is null then jsonb_build_object('code', 'sem_milimetragem',
             'severity', 'warning', 'field', 'tread_1', 'message', 'Pneu em uso sem nenhuma milimetragem válida.') end,
        case when calc.bad_psi then jsonb_build_object('code', 'psi_invalido', 'severity', 'warning', 'field', 'psi', 'value', calc.n_psi::text,
             'message', format('Calibragem %s fora do limite técnico (0 a %s PSI): valor ignorado.', calc.n_psi, p.max_valid_psi)) end,
        case when 'psi:date_serial' = any (calc.client_flags) and not calc.bad_psi then jsonb_build_object('code', 'numero_formatado_como_data', 'severity', 'warning',
             'field', 'psi', 'value', calc.n_psi::text, 'message', format('Calibragem gravada como data no Rodopar; valor recuperado: %s PSI.', calc.n_psi)) end,
        case when calc.inv_meas then jsonb_build_object('code', 'data_invalida', 'severity', 'warning', 'field', 'measurement_at',
             'value', calc.cells ->> 'measurement_at', 'message', 'Data de medição inválida: ignorada.') end,
        case when calc.fut_meas then jsonb_build_object('code', 'data_futura', 'severity', 'warning', 'field', 'measurement_at', 'value', calc.d_meas::text,
             'message', format('Data de medição %s posterior à fotografia: ignorada.', to_char(calc.d_meas, 'DD/MM/YYYY'))) end,
        case when calc.inv_cal then jsonb_build_object('code', 'data_invalida', 'severity', 'warning', 'field', 'calibration_at',
             'value', calc.cells ->> 'calibration_at', 'message', 'Data de calibragem inválida: ignorada.') end,
        case when calc.fut_cal then jsonb_build_object('code', 'data_futura', 'severity', 'warning', 'field', 'calibration_at', 'value', calc.d_cal::text,
             'message', format('Data de calibragem %s posterior à fotografia: ignorada.', to_char(calc.d_cal, 'DD/MM/YYYY'))) end,
        case when calc.inv_purchase or calc.fut_purchase then jsonb_build_object('code', case when calc.inv_purchase then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'purchase_date', 'message', 'Data de compra inválida ou futura: ignorada.') end,
        case when calc.inv_reg or calc.fut_reg then jsonb_build_object('code', case when calc.inv_reg then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'registration_at', 'message', 'Data de cadastro inválida ou futura: ignorada.') end,
        case when calc.inv_upd or calc.fut_upd then jsonb_build_object('code', case when calc.inv_upd then 'data_invalida' else 'data_futura' end,
             'severity', 'warning', 'field', 'updated_at', 'message', 'Data da última alteração inválida ou futura: ignorada.') end,
        case when calc.bad_kmr then jsonb_build_object('code', 'km_rodado_invalido', 'severity', 'warning', 'field', 'km_rodado', 'value', calc.n_kmr::text,
             'message', 'KM Rodado negativo ou inválido: ignorado.') end,
        case when calc.n_kmreal is not null and not calc.bad_kmreal and calc.n_kmreal < 0 then jsonb_build_object('code', 'km_real_negativo', 'severity', 'warning',
             'field', 'km_real', 'value', calc.n_kmreal::text, 'message', format('KM Real negativo (%s) no relatório: preservado como diagnóstico.', calc.n_kmreal)) end,
        case when calc.bad_life then jsonb_build_object('code', 'vida_invalida', 'severity', 'warning', 'field', 'life', 'value', calc.n_life::text,
             'message', 'Nº da vida inválido: ignorado.') end,
        case when calc.status_raw is not null and calc.canonical = 'outro' then jsonb_build_object('code', 'situacao_nao_reconhecida', 'severity', 'warning',
             'field', 'status_raw', 'value', calc.status_raw, 'message', format('Situação "%s" não reconhecida: classificada como Outro.', calc.status_raw)) end,
        case when calc.canonical = 'em_uso' and calc.fleet_number is null then jsonb_build_object('code', 'em_uso_sem_frota', 'severity', 'warning',
             'field', 'fleet_number', 'message', 'Pneu em uso sem frota informada.') end,
        case when calc.canonical = 'em_uso' and calc.fleet_number is not null and calc.position_code is null then jsonb_build_object('code', 'em_uso_sem_posicao',
             'severity', 'warning', 'field', 'position', 'message', 'Pneu em uso sem posição informada.') end,
        case when calc.canonical <> 'em_uso' and (calc.fleet_number is not null or calc.position_code is not null) then jsonb_build_object('code', 'fora_de_uso_com_frota',
             'severity', 'warning', 'field', 'fleet_number', 'message', 'Pneu fora de uso com frota ou posição preenchida.') end,
        case when calc.position_code is not null and not exists (select 1 from public.tire_positions tp where tp.organization_id = p_organization_id
                                                                  and tp.code = calc.position_code and tp.is_active)
             then jsonb_build_object('code', 'posicao_desconhecida', 'severity', 'warning', 'field', 'position', 'value', calc.position_code,
             'message', format('Posição "%s" não está no dicionário de posições.', calc.position_code)) end,
        case when calc.canonical = 'em_uso' and calc.v_meas is null and not calc.inv_meas and not calc.fut_meas then jsonb_build_object('code', 'sem_data_medicao',
             'severity', 'warning', 'field', 'measurement_at', 'message', 'Pneu em uso sem data de medição.') end,
        case when calc.canonical = 'em_uso' and calc.v_cal is null and not calc.inv_cal and not calc.fut_cal then jsonb_build_object('code', 'sem_data_calibragem',
             'severity', 'warning', 'field', 'calibration_at', 'message', 'Pneu em uso sem data de calibragem.') end
      ], null) as issue_list
    from calc
  )
  update public.tire_import_staging s set
    fire_number = iss.fire_number, serial_number = iss.serial_number, rodopar_tire_branch = iss.tire_branch,
    unit_code = iss.unit_code, cost_code = iss.cost_code,
    purchase_date = case when iss.inv_purchase or iss.fut_purchase then null else iss.d_purchase::date end,
    rodopar_status_raw = iss.status_raw, canonical_status = iss.canonical,
    fleet_number_raw = iss.fleet_number, fleet_branch = iss.fleet_branch, brand = iss.brand, model = iss.model,
    dimension = iss.dimension, position_code = iss.position_code,
    tread_min_raw = iss.v_tmin, tread_1 = iss.v_t1, tread_2 = iss.v_t2, tread_3 = iss.v_t3, tread_4 = iss.v_t4,
    tread_min_calculated = iss.v_tcalc,
    measurement_at = iss.v_meas, psi = iss.v_psi, calibration_at = iss.v_cal,
    km_rodado = case when iss.bad_kmr then null else round(iss.n_kmr)::bigint end,
    km_real = case when iss.bad_kmreal then null else round(iss.n_kmreal)::bigint end,
    dot = iss.dot, life = case when iss.bad_life then null else iss.n_life::smallint end,
    rodopar_condition = iss.condition, rodopar_classification = iss.classification, rodopar_status_label = iss.status_label,
    registration_at = case when iss.inv_reg or iss.fut_reg then null else iss.d_reg end,
    rodopar_created_by = iss.created_by_user, rodopar_updated_by = iss.updated_by_user,
    rodopar_updated_at = case when iss.inv_upd or iss.fut_upd then null else iss.d_upd end,
    drawing = iss.drawing, rubber = iss.rubber,
    vehicle_id = null, tire_id = null, action = null, changes = '{}',
    issues = coalesce(to_jsonb(iss.issue_list), '[]'::jsonb)
  from iss
  where s.id = iss.id;

  -- ---------------------------------------------------------- passo 2: Nº Fogo duplicado no arquivo
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'fogo_duplicado', 'severity', 'error', 'field', 'fire_number',
           'value', s.fire_number, 'message', format('Nº Fogo %s aparece %s vezes no arquivo.', s.fire_number, d.n)))
    from (select x.fire_number, count(*) as n from public.tire_import_staging x
           where x.batch_id = b.id and x.fire_number is not null group by x.fire_number having count(*) > 1) d
   where s.batch_id = b.id and s.fire_number = d.fire_number;

  -- ---------------------------------------------------------- passo 3: veículo do HFM (frota → placa); nunca cria veículo
  update public.tire_import_staging s
     set vehicle_id = coalesce(
           (select v.id from public.vehicles v
             where v.organization_id = p_organization_id and v.deleted_at is null and upper(btrim(v.fleet_code)) = s.fleet_number_raw
             order by (v.status = 'active') desc, v.created_at limit 1),
           (select v.id from public.vehicles v
             where v.organization_id = p_organization_id and v.deleted_at is null
               and length(coalesce(private.normalize_plate(s.fleet_number_raw), '')) >= 7
               and v.license_plate = private.normalize_plate(s.fleet_number_raw)
             order by (v.status = 'active') desc, v.created_at limit 1))
   where s.batch_id = b.id and s.fleet_number_raw is not null;
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'frota_nao_encontrada', 'severity', 'warning', 'field', 'fleet_number',
           'value', s.fleet_number_raw, 'message', format('Frota "%s" não existe no Cadastro de Frotas do HFM: pneu importado sem veículo (nenhum veículo é criado).', s.fleet_number_raw)))
   where s.batch_id = b.id and s.fleet_number_raw is not null and s.vehicle_id is null;

  -- ---------------------------------------------------------- passo 4: dois pneus em uso na mesma frota + posição
  update public.tire_import_staging s
     set issues = s.issues || jsonb_build_array(jsonb_build_object('code', 'colisao_posicao', 'severity', 'error', 'field', 'position',
           'value', s.position_code, 'message', format('Frota %s, posição %s: %s pneus em uso (%s).', s.fleet_number_raw, s.position_code, d.n, d.fires)))
    from (select coalesce(x.vehicle_id::text, x.fleet_number_raw) as k, x.position_code, count(distinct x.fire_number) as n,
                 string_agg(distinct x.fire_number, ', ') as fires
            from public.tire_import_staging x
           where x.batch_id = b.id and x.canonical_status = 'em_uso' and x.position_code is not null and x.fleet_number_raw is not null
           group by 1, 2 having count(distinct x.fire_number) > 1) d
   where s.batch_id = b.id and s.canonical_status = 'em_uso' and s.position_code = d.position_code
     and coalesce(s.vehicle_id::text, s.fleet_number_raw) = d.k;

  -- ---------------------------------------------------------- passo 5: comparação com o cadastro e a fotografia anterior
  update public.tire_import_staging s set tire_id = t.id
    from public.tires t
   where s.batch_id = b.id and t.organization_id = p_organization_id and t.fire_number = s.fire_number;

  with c as (
    select s.id, ps.id as ps_id, ps.canonical_status as ps_status, ps.life as ps_life,
      array_remove(array[
        case when ps.id is not null and ps.canonical_status is distinct from s.canonical_status then 'status' end,
        case when ps.id is not null and coalesce(ps.vehicle_id::text, ps.fleet_number_raw) is distinct from coalesce(s.vehicle_id::text, s.fleet_number_raw) then 'vehicle' end,
        case when ps.id is not null and coalesce(ps.vehicle_id::text, ps.fleet_number_raw) is not distinct from coalesce(s.vehicle_id::text, s.fleet_number_raw)
                  and ps.position_code is distinct from s.position_code then 'position' end,
        case when ps.id is not null and ps.life is distinct from s.life then 'life' end,
        case when ps.id is not null and (ps.measurement_at is distinct from s.measurement_at or ps.tread_1 is distinct from s.tread_1
                  or ps.tread_2 is distinct from s.tread_2 or ps.tread_3 is distinct from s.tread_3 or ps.tread_4 is distinct from s.tread_4
                  or ps.tread_min_raw is distinct from s.tread_min_raw) then 'measurement' end,
        case when ps.id is not null and (ps.calibration_at is distinct from s.calibration_at or ps.psi is distinct from s.psi) then 'calibration' end,
        case when ps.id is not null and (ps.brand is distinct from s.brand or ps.model is distinct from s.model
                  or ps.dimension_key is distinct from private.tire_dimension_key(s.dimension) or ps.dot is distinct from s.dot
                  or ps.drawing is distinct from s.drawing or ps.rubber is distinct from s.rubber
                  or ps.serial_number is distinct from s.serial_number) then 'attributes' end], null) as ch
      from public.tire_import_staging s
      left join lateral (select x.* from public.tire_daily_snapshots x where x.tire_id = s.tire_id
                          order by x.reference_date desc limit 1) ps on s.tire_id is not null
     where s.batch_id = b.id)
  update public.tire_import_staging s set
    changes = c.ch,
    action = case when s.tire_id is null then 'new' when cardinality(c.ch) > 0 then 'updated' else 'unchanged' end,
    issues = s.issues
      || case when c.ps_life is not null and s.life is not null and s.life < c.ps_life then jsonb_build_array(jsonb_build_object(
             'code', 'vida_regrediu', 'severity', 'warning', 'field', 'life', 'value', s.life::text,
             'message', format('Vida passou de %s para %s: vida não regride.', c.ps_life, s.life))) else '[]'::jsonb end
      || case when c.ps_status in ('descartado', 'baixado') and s.canonical_status in ('em_uso', 'estoque') then jsonb_build_array(jsonb_build_object(
             'code', 'reativado_apos_baixa', 'severity', 'warning', 'field', 'status_raw', 'value', s.rodopar_status_raw,
             'message', format('Pneu que estava %s voltou como %s.', c.ps_status, s.canonical_status))) else '[]'::jsonb end
  from c where s.id = c.id;

  -- ---------------------------------------------------------- passo 6: severidade
  update public.tire_import_staging s set severity =
    case when exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'severity' = 'error') then 'error'
         when jsonb_array_length(s.issues) > 0 then 'warning' else 'ok' end
   where s.batch_id = b.id;

  -- ---------------------------------------------------------- passo 7: contadores, ausentes, bloqueio
  select count(*), count(*) filter (where s.severity = 'error'), count(*) filter (where s.severity = 'warning'),
         count(*) filter (where s.severity <> 'error' and s.action = 'new'),
         count(*) filter (where s.severity <> 'error' and s.action = 'updated'),
         count(*) filter (where s.severity <> 'error' and s.action = 'unchanged')
    into n_total, n_err, n_warn, n_new, n_upd, n_same
    from public.tire_import_staging s where s.batch_id = b.id;
  select count(*) into n_absent from public.tires t
   where t.organization_id = p_organization_id and t.presence_status = 'present'
     and not exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number);
  select count(*) into n_back from public.tires t
   where t.organization_id = p_organization_id and t.presence_status = 'absent'
     and exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number);

  select array(select x from unnest(v_required) x where not (x = any (b.recognized_columns))) into v_missing;
  if cardinality(v_missing) > 0 then
    v_block := v_block || format('Colunas oficiais não reconhecidas no arquivo: %s.', array_to_string(v_missing, ', '));
  end if;
  if n_err > 0 then
    v_block := v_block || format('%s %s com erro bloqueante: nenhuma linha será aplicada.', n_err, case when n_err = 1 then 'linha' else 'linhas' end);
  end if;
  if n_total = 0 or n_total = n_err then v_block := v_block || 'Nenhuma linha válida no arquivo.'::text; end if;
  if v_latest is not null and b.reference_date <= v_latest then
    v_block := v_block || format('Já existe fotografia confirmada em %s: a data de referência precisa ser posterior.', to_char(v_latest, 'DD/MM/YYYY'));
  end if;
  select x.id into v_dup from public.tire_import_batches x
   where x.organization_id = p_organization_id and x.file_hash = b.file_hash and x.status = 'confirmed' and x.id <> b.id;
  if v_dup is not null then v_block := v_block || 'Este arquivo já foi importado e confirmado.'::text; end if;

  select jsonb_build_object(
    'status', coalesce((select jsonb_object_agg(x.k, x.n) from (select s.canonical_status as k, count(*) as n from public.tire_import_staging s
                          where s.batch_id = b.id and s.canonical_status is not null group by 1) x), '{}'::jsonb),
    'changes', coalesce((select jsonb_object_agg(x.k, x.n) from (select c as k, count(*) as n from public.tire_import_staging s
                           cross join lateral unnest(s.changes) c where s.batch_id = b.id and s.severity <> 'error' group by 1) x), '{}'::jsonb),
    'issues', coalesce((select jsonb_object_agg(x.k, x.n) from (select i ->> 'code' as k, count(*) as n from public.tire_import_staging s
                          cross join lateral jsonb_array_elements(s.issues) i where s.batch_id = b.id group by 1) x), '{}'::jsonb),
    'vehicles_resolved', (select count(distinct s.vehicle_id) from public.tire_import_staging s where s.batch_id = b.id and s.vehicle_id is not null),
    'fleets_in_file', (select count(distinct s.fleet_number_raw) from public.tire_import_staging s where s.batch_id = b.id and s.fleet_number_raw is not null),
    'fleets_not_found', (select count(distinct s.fleet_number_raw) from public.tire_import_staging s where s.batch_id = b.id and s.fleet_number_raw is not null and s.vehicle_id is null),
    'max_updated_at', (select max(s.rodopar_updated_at) from public.tire_import_staging s where s.batch_id = b.id),
    'reference_before_last_change', coalesce((select max(s.rodopar_updated_at)::date > b.reference_date from public.tire_import_staging s where s.batch_id = b.id), false),
    'missing_columns', to_jsonb(v_missing),
    'block_reasons', to_jsonb(v_block))
    into v_counters;

  update public.tire_import_batches x set
    status = case when cardinality(v_block) > 0 then 'blocked' else 'validated' end,
    total_rows = n_total, error_rows = n_err, warning_rows = n_warn, valid_rows = n_total - n_err,
    new_tires = n_new, updated_tires = n_upd, unchanged_tires = n_same, absent_tires = n_absent, reappeared_tires = n_back,
    counters = v_counters, block_reason = nullif(array_to_string(v_block, ' '), ''),
    previous_reference_date = v_latest, validated_at = now(), updated_at = now()
   where x.id = b.id
  returning * into b;
  return b;
end;
$$;

create or replace function public.tire_import_validate(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare b public.tire_import_batches;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  b := private.tire_import_run_validation(p_organization_id, p_batch_id);
  return to_jsonb(b);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Prévia paginada: inconsistências, mudanças, novos, ausentes e reaparecidos
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_preview(
  p_organization_id uuid, p_batch_id uuid, p_section text default 'issues', p_filter text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b        public.tire_import_batches;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not (private.has_permission(p_organization_id, 'tires.import') or private.has_permission(p_organization_id, 'tires.audit.view')) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;

  if p_section in ('absent', 'reappeared') then
    with t as (
      select t.id, t.fire_number, t.current_status, t.current_position_code, v.license_plate, v.fleet_code, t.last_reference_date, t.brand, t.model
        from public.tires t left join public.vehicles v on v.id = t.current_vehicle_id
       where t.organization_id = p_organization_id
         and ((p_section = 'absent' and b.status <> 'confirmed' and t.presence_status = 'present'
               and not exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number))
           or (p_section = 'absent' and b.status = 'confirmed' and t.presence_status = 'absent' and t.absent_since = b.reference_date)
           or (p_section = 'reappeared' and exists (select 1 from public.tire_events e where e.tire_id = t.id and e.event_type = 'TIRE_REAPPEARED' and e.import_batch_id = b.id))
           or (p_section = 'reappeared' and b.status <> 'confirmed' and t.presence_status = 'absent'
               and exists (select 1 from public.tire_import_staging s where s.batch_id = b.id and s.fire_number = t.fire_number)))),
    o as (select t.*, row_number() over (order by t.fleet_code nulls last, t.fire_number) as rn from t)
    select (select count(*) from o), coalesce(jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) filter (where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb)
      into v_total, v_rows from o;
  else
    with s as (
      select s.row_number, s.fire_number, s.severity, s.action, s.changes, s.issues, s.canonical_status, s.rodopar_status_raw,
             s.fleet_number_raw, s.position_code, s.life, s.tread_min_raw, s.tread_min_calculated, s.tread_1, s.tread_2, s.tread_3, s.tread_4,
             s.psi, s.measurement_at, s.calibration_at, s.vehicle_id, v.license_plate, s.brand, s.model, s.dimension,
             ps.canonical_status as prev_status, ps.fleet_number_raw as prev_fleet, coalesce(pv.license_plate, ps.vehicle_plate_snapshot) as prev_plate,
             ps.position_code as prev_position, ps.life as prev_life, ps.tread_min as prev_tread_min, ps.psi as prev_psi,
             ps.measurement_date as prev_measurement_date, ps.calibration_date as prev_calibration_date
        from public.tire_import_staging s
        left join public.vehicles v on v.id = s.vehicle_id
        left join lateral (select x.* from public.tire_daily_snapshots x where x.tire_id = s.tire_id and x.reference_date < b.reference_date
                            order by x.reference_date desc limit 1) ps on s.tire_id is not null
        left join public.vehicles pv on pv.id = ps.vehicle_id
       where s.batch_id = b.id
         and case coalesce(p_section, 'issues')
               when 'issues' then s.severity in ('error', 'warning')
                 and (p_filter is null or p_filter = s.severity
                      or exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'code' = p_filter))
               when 'changes' then s.action = 'updated' and (p_filter is null or p_filter = any (s.changes))
               when 'new' then s.action = 'new'
               when 'rows' then true
               else false end),
    o as (select s.*, row_number() over (order by case when s.severity = 'error' then 0 else 1 end, s.row_number) as rn from s)
    select (select count(*) from o), coalesce(jsonb_agg(to_jsonb(o) - 'rn' order by o.rn) filter (where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb)
      into v_total, v_rows from o;
  end if;

  return jsonb_build_object('batch', to_jsonb(b), 'section', p_section, 'filter', p_filter,
                            'total', v_total, 'rows', v_rows, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Confirmação atômica: cadastro, fotografia, eventos, ausentes, reconciliação
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_confirm(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        public.tire_import_batches;
  v_ref    date;
  v_prev   date;
  v_ids    uuid[];
  n_new integer := 0; n_snap integer := 0; n_events integer := 0; n_absent integer := 0; n_back integer := 0;
  v_recon  jsonb := '{}'::jsonb;
  v_name   text := private.tire_actor_name(p_organization_id);
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  -- revalida tudo no banco: a confirmação nunca confia na prévia já exibida
  b := private.tire_import_run_validation(p_organization_id, p_batch_id);
  if b.status <> 'validated' then
    raise exception 'Importação bloqueada: %', coalesce(b.block_reason, 'há inconsistências bloqueantes.')
      using errcode = 'check_violation', hint = 'tire_import_blocked';
  end if;
  v_ref := b.reference_date;
  v_prev := b.previous_reference_date;

  -- ---------------------------------------------------------- cadastro: novos pneus
  insert into public.tires (organization_id, fire_number, serial_number, brand, model, dimension, dimension_key, dot, drawing, rubber,
                            purchase_date, registration_date, current_life, current_status, rodopar_status_raw,
                            first_reference_date, last_reference_date, last_import_batch_id)
  select p_organization_id, s.fire_number, s.serial_number, s.brand, s.model, s.dimension, private.tire_dimension_key(s.dimension),
         s.dot, s.drawing, s.rubber, s.purchase_date, s.registration_at::date, s.life, s.canonical_status, s.rodopar_status_raw,
         v_ref, v_ref, b.id
    from public.tire_import_staging s
   where s.batch_id = b.id and s.severity <> 'error' and s.action = 'new'
  on conflict (organization_id, fire_number) do nothing;
  get diagnostics n_new = row_count;
  update public.tire_import_staging s set tire_id = t.id
    from public.tires t
   where s.batch_id = b.id and s.tire_id is null and t.organization_id = p_organization_id and t.fire_number = s.fire_number;

  -- ---------------------------------------------------------- fotografia (contexto oficial na data)
  select coalesce(array_agg(distinct s.vehicle_id), '{}') into v_ids
    from public.tire_import_staging s where s.batch_id = b.id and s.vehicle_id is not null and s.severity <> 'error';

  with ctx as (
    select c.* from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_ref, array[cardinality(v_ids)])) c)
  insert into public.tire_daily_snapshots (
    organization_id, tire_id, reference_date, import_batch_id, row_number, fire_number,
    rodopar_tire_branch, unit_code, cost_code, purchase_date, rodopar_status_raw, canonical_status, fleet_number_raw, fleet_branch,
    brand, model, dimension, dimension_key, position_code, tread_min_raw, tread_1, tread_2, tread_3, tread_4, tread_min_calculated,
    tread_min, tread_divergence, measurement_at, measurement_date, psi, calibration_at, calibration_date, km_rodado, km_real, dot, life,
    rodopar_condition, rodopar_classification, rodopar_status_label, registration_at, serial_number, rodopar_created_by,
    rodopar_updated_by, rodopar_updated_at, drawing, rubber, raw,
    vehicle_id, vehicle_plate_snapshot, fleet_number_snapshot, vehicle_type_id, context_source, operation_id, operation_city_id,
    state_id, city_id, operation_br_id, fidelization_assignment_id, leader_employee_id, organization_unit_id,
    enrichment_status, quality_flags, data_quality_status)
  select p_organization_id, s.tire_id, v_ref, b.id, s.row_number, s.fire_number,
         s.rodopar_tire_branch, s.unit_code, s.cost_code, s.purchase_date, s.rodopar_status_raw, s.canonical_status, s.fleet_number_raw, s.fleet_branch,
         s.brand, s.model, s.dimension, private.tire_dimension_key(s.dimension), s.position_code, s.tread_min_raw, s.tread_1, s.tread_2, s.tread_3, s.tread_4,
         s.tread_min_calculated,
         -- saúde usa o menor entre o informado e o medido (conservador); os dois ficam guardados
         least(s.tread_min_raw, s.tread_min_calculated),
         exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'code' = 'menor_mm_divergente'),
         s.measurement_at, s.measurement_at::date, s.psi, s.calibration_at, s.calibration_at::date, s.km_rodado, s.km_real, s.dot, s.life,
         s.rodopar_condition, s.rodopar_classification, s.rodopar_status_label, s.registration_at, s.serial_number, s.rodopar_created_by,
         s.rodopar_updated_by, s.rodopar_updated_at, s.drawing, s.rubber, s.raw,
         s.vehicle_id, v.license_plate, v.fleet_code, v.vehicle_type_id, ctx.context_source, ctx.operation_id, ctx.operation_city_id,
         ctx.state_id, ctx.city_id, ctx.operation_br_id, ctx.fidelization_assignment_id, ctx.leader_employee_id,
         coalesce(ctx.organization_unit_id, v.organization_unit_id),
         case when s.fleet_number_raw is null then 'sem_frota' when s.vehicle_id is null then 'frota_nao_encontrada'
              when coalesce(ctx.context_source, 'none') = 'none' then 'sem_contexto' else 'ok' end,
         array(select distinct i ->> 'code' from jsonb_array_elements(s.issues) i
                where i ->> 'severity' = 'warning' and i ->> 'code' not in ('sem_data_medicao', 'sem_data_calibragem') order by 1),
         case when exists (select 1 from jsonb_array_elements(s.issues) i where i ->> 'severity' = 'warning'
                            and i ->> 'code' not in ('sem_data_medicao', 'sem_data_calibragem')) then 'warning' else 'ok' end
    from public.tire_import_staging s
    left join public.vehicles v on v.id = s.vehicle_id
    left join ctx on ctx.vehicle_id = s.vehicle_id
   where s.batch_id = b.id and s.severity <> 'error' and s.tire_id is not null
  on conflict (tire_id, reference_date) do nothing;
  get diagnostics n_snap = row_count;

  -- ---------------------------------------------------------- eventos (comparação com a fotografia anterior do pneu)
  with cur as (
    select ns.*, s.action, prev.id as p_id, prev.canonical_status as p_status, prev.vehicle_id as p_vehicle, prev.fleet_number_raw as p_fleet,
           coalesce(prev.fleet_number_snapshot, prev.fleet_number_raw) as p_fleet_label, prev.vehicle_plate_snapshot as p_plate,
           prev.position_code as p_position, prev.life as p_life, prev.tread_min as p_tread_min, prev.tread_1 as p_t1, prev.tread_2 as p_t2,
           prev.tread_3 as p_t3, prev.tread_4 as p_t4, prev.tread_min_raw as p_tmin_raw, prev.measurement_at as p_meas_at,
           prev.measurement_date as p_meas, prev.psi as p_psi, prev.calibration_at as p_cal_at, prev.calibration_date as p_cal,
           prev.brand as p_brand, prev.model as p_model, prev.dimension as p_dimension, prev.dimension_key as p_dim_key, prev.dot as p_dot,
           prev.drawing as p_drawing, prev.rubber as p_rubber, prev.serial_number as p_serial,
           t.presence_status as t_presence
      from public.tire_daily_snapshots ns
      join public.tire_import_staging s on s.batch_id = b.id and s.tire_id = ns.tire_id
      join public.tires t on t.id = ns.tire_id
      left join lateral (select x.* from public.tire_daily_snapshots x where x.tire_id = ns.tire_id and x.reference_date < v_ref
                          order by x.reference_date desc limit 1) prev on true
     where ns.import_batch_id = b.id),
  cand as (
    select cur.*, e.event_type
      from cur
      cross join lateral (values
        ('TIRE_CREATED', cur.p_id is null),
        ('TIRE_REAPPEARED', cur.p_id is not null and cur.t_presence = 'absent'),
        ('TIRE_RETURNED_TO_STOCK', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status = 'estoque'),
        ('TIRE_SENT_TO_RETREAD', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status = 'ressolagem'),
        ('TIRE_DISCARDED', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status and cur.canonical_status in ('descartado', 'baixado')),
        ('TIRE_STATUS_CHANGED', cur.p_id is not null and cur.p_status is distinct from cur.canonical_status
                                and (cur.canonical_status = 'outro'
                                     or (cur.canonical_status = 'em_uso' and coalesce(cur.p_vehicle::text, cur.p_fleet) is not distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)))),
        ('TIRE_MOVED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.fleet_number_raw is not null
                       and coalesce(cur.p_vehicle::text, cur.p_fleet) is distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)),
        ('TIRE_REMOVED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.p_status = 'em_uso'
                         and cur.p_fleet is not null and cur.fleet_number_raw is null),
        ('TIRE_POSITION_CHANGED', cur.p_id is not null and cur.canonical_status = 'em_uso' and cur.p_status = 'em_uso'
                                  and coalesce(cur.p_vehicle::text, cur.p_fleet) is not distinct from coalesce(cur.vehicle_id::text, cur.fleet_number_raw)
                                  and cur.p_position is distinct from cur.position_code),
        ('TIRE_LIFE_CHANGED', cur.p_id is not null and cur.p_life is distinct from cur.life),
        ('TIRE_MEASURED', cur.p_id is not null and (cur.p_meas_at is distinct from cur.measurement_at or cur.p_t1 is distinct from cur.tread_1
                          or cur.p_t2 is distinct from cur.tread_2 or cur.p_t3 is distinct from cur.tread_3 or cur.p_t4 is distinct from cur.tread_4
                          or cur.p_tmin_raw is distinct from cur.tread_min_raw)),
        ('TIRE_PRESSURE_UPDATED', cur.p_id is not null and (cur.p_cal_at is distinct from cur.calibration_at or cur.p_psi is distinct from cur.psi)),
        ('TIRE_IMPORTED', cur.p_id is not null and (cur.p_brand is distinct from cur.brand or cur.p_model is distinct from cur.model
                          or cur.p_dim_key is distinct from cur.dimension_key or cur.p_dot is distinct from cur.dot or cur.p_drawing is distinct from cur.drawing
                          or cur.p_rubber is distinct from cur.rubber or cur.p_serial is distinct from cur.serial_number))
      ) e(event_type, happened)
     where e.happened)
  insert into public.tire_events (organization_id, tire_id, event_type, reference_date, import_batch_id, snapshot_id,
                                  previous_values, current_values, vehicle_id, previous_vehicle_id, position_code, previous_position_code, source, actor_user_id)
  select p_organization_id, cand.tire_id, cand.event_type, v_ref, b.id, cand.id,
         case when cand.p_id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
           'status', cand.p_status, 'license_plate', cand.p_plate, 'fleet_number', cand.p_fleet_label, 'position_code', cand.p_position,
           'life', cand.p_life, 'tread_min', cand.p_tread_min, 'tread_1', cand.p_t1, 'tread_2', cand.p_t2, 'tread_3', cand.p_t3, 'tread_4', cand.p_t4,
           'measurement_date', cand.p_meas, 'psi', cand.p_psi, 'calibration_date', cand.p_cal,
           'brand', cand.p_brand, 'model', cand.p_model, 'dimension', cand.p_dimension, 'dot', cand.p_dot, 'drawing', cand.p_drawing,
           'rubber', cand.p_rubber, 'serial_number', cand.p_serial)) end,
         jsonb_strip_nulls(jsonb_build_object(
           'status', cand.canonical_status, 'license_plate', cand.vehicle_plate_snapshot, 'fleet_number', coalesce(cand.fleet_number_snapshot, cand.fleet_number_raw),
           'position_code', cand.position_code, 'life', cand.life, 'tread_min', cand.tread_min, 'tread_1', cand.tread_1, 'tread_2', cand.tread_2,
           'tread_3', cand.tread_3, 'tread_4', cand.tread_4, 'measurement_date', cand.measurement_date, 'psi', cand.psi,
           'calibration_date', cand.calibration_date, 'brand', cand.brand, 'model', cand.model, 'dimension', cand.dimension, 'dot', cand.dot,
           'drawing', cand.drawing, 'rubber', cand.rubber, 'serial_number', cand.serial_number)),
         cand.vehicle_id, cand.p_vehicle, cand.position_code, cand.p_position, 'rodopar_import', auth.uid()
    from cand
  on conflict (tire_id, event_type, reference_date) do nothing;
  get diagnostics n_events = row_count;

  -- ---------------------------------------------------------- cadastro: situação vigente
  update public.tires t set
    serial_number = ns.serial_number, brand = ns.brand, model = ns.model, dimension = ns.dimension, dimension_key = ns.dimension_key,
    dot = ns.dot, drawing = ns.drawing, rubber = ns.rubber,
    purchase_date = coalesce(ns.purchase_date, t.purchase_date), registration_date = coalesce(ns.registration_at::date, t.registration_date),
    current_life = ns.life, current_status = ns.canonical_status, rodopar_status_raw = ns.rodopar_status_raw,
    current_vehicle_id = ns.vehicle_id, current_position_code = ns.position_code, current_snapshot_id = ns.id,
    last_reference_date = v_ref, last_import_batch_id = b.id, presence_status = 'present', absent_since = null
    from public.tire_daily_snapshots ns
   where ns.import_batch_id = b.id and ns.tire_id = t.id;

  -- ---------------------------------------------------------- ausentes no novo relatório (nunca excluídos)
  with gone as (
    update public.tires t set presence_status = 'absent', absent_since = v_ref
     where t.organization_id = p_organization_id and t.presence_status = 'present' and t.last_reference_date < v_ref
    returning t.id, t.current_snapshot_id, t.current_vehicle_id, t.current_position_code, t.current_status)
  insert into public.tire_events (organization_id, tire_id, event_type, reference_date, import_batch_id, snapshot_id,
                                  previous_values, current_values, vehicle_id, previous_vehicle_id, position_code, previous_position_code, source, actor_user_id, note)
  select p_organization_id, gone.id, 'TIRE_ABSENT', v_ref, b.id, gone.current_snapshot_id,
         jsonb_build_object('status', gone.current_status, 'position_code', gone.current_position_code), '{}'::jsonb,
         null, gone.current_vehicle_id, null, gone.current_position_code, 'rodopar_import', auth.uid(),
         'Pneu ausente no relatório Rodopar desta data: mantido no cadastro com a última fotografia conhecida.'
    from gone
  on conflict (tire_id, event_type, reference_date) do nothing;
  get diagnostics n_absent = row_count;

  -- ---------------------------------------------------------- lote confirmado + reconciliação das vistorias
  update public.tire_import_batches x set status = 'confirmed', confirmed_by = auth.uid(), confirmed_by_name = v_name,
         confirmed_at = now(), updated_at = now(), absent_tires = n_absent
   where x.id = b.id;

  v_recon := private.tire_reconcile_inspections(p_organization_id, b.id);
  update public.tire_import_batches x set reconciliation = v_recon where x.id = b.id;

  perform private.tire_audit(p_organization_id, 'import.confirmed', 'tire_import_batch', b.id,
    format('Fotografia Rodopar de %s confirmada (%s pneus, %s novos, %s eventos, %s ausentes).', to_char(v_ref, 'DD/MM/YYYY'), n_snap, n_new, n_events, n_absent),
    null, jsonb_build_object('file_name', b.file_name, 'file_hash', b.file_hash, 'reference_date', v_ref, 'snapshots', n_snap,
                             'new_tires', n_new, 'events', n_events, 'absent', n_absent, 'reconciliation', v_recon));
  perform private.emit_event(p_organization_id, 'tires.snapshot.confirmed', 'tire_import_batch', b.id,
    jsonb_build_object('reference_date', v_ref, 'snapshots', n_snap, 'previous_reference_date', v_prev));

  return jsonb_build_object('batch_id', b.id, 'reference_date', v_ref, 'snapshots', n_snap, 'new_tires', n_new,
                            'updated_tires', b.updated_tires, 'unchanged_tires', b.unchanged_tires, 'events', n_events,
                            'absent', n_absent, 'reconciliation', v_recon);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Cancelamento e histórico de lotes
-- -----------------------------------------------------------------------------
create or replace function public.tire_import_cancel(p_organization_id uuid, p_batch_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare b public.tire_import_batches;
begin
  perform private.tire_require(p_organization_id, 'tires.import');
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id for update;
  if b.id is null then raise exception 'Lote não encontrado.' using errcode = 'no_data_found'; end if;
  if b.status = 'confirmed' then
    raise exception 'Lote confirmado não pode ser cancelado: a fotografia já é oficial.' using errcode = 'invalid_parameter_value';
  end if;
  if b.status = 'cancelled' then return to_jsonb(b); end if;
  update public.tire_import_batches x set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = left(nullif(btrim(p_reason), ''), 300), updated_at = now()
   where x.id = b.id returning * into b;
  perform private.tire_audit(p_organization_id, 'import.cancelled', 'tire_import_batch', b.id,
    format('Lote %s (%s) descartado sem alterar a base.', b.file_name, to_char(b.reference_date, 'DD/MM/YYYY')));
  return to_jsonb(b);
end;
$$;

create or replace function public.tire_import_history(p_organization_id uuid, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not (private.has_permission(p_organization_id, 'tires.import') or private.has_permission(p_organization_id, 'tires.audit.view')) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.tire_import_batches b where b.organization_id = p_organization_id),
    'latest_reference_date', private.tire_latest_reference(p_organization_id),
    'rows', coalesce((select jsonb_agg(to_jsonb(b) - 'recognized_columns' - 'unrecognized_columns' - 'ignored_columns' order by b.created_at desc)
                        from (select * from public.tire_import_batches b where b.organization_id = p_organization_id
                               order by b.created_at desc limit v_limit offset v_offset) b), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_import_run_validation(uuid, uuid) from public, anon;
grant execute on function private.tire_import_run_validation(uuid, uuid) to authenticated, service_role;
revoke execute on function public.tire_import_start(uuid, jsonb), public.tire_import_stage(uuid, uuid, jsonb),
  public.tire_import_validate(uuid, uuid), public.tire_import_preview(uuid, uuid, text, text, integer, integer),
  public.tire_import_confirm(uuid, uuid), public.tire_import_cancel(uuid, uuid, text), public.tire_import_history(uuid, integer, integer)
  from public, anon;
grant execute on function public.tire_import_start(uuid, jsonb), public.tire_import_stage(uuid, uuid, jsonb),
  public.tire_import_validate(uuid, uuid), public.tire_import_preview(uuid, uuid, text, text, integer, integer),
  public.tire_import_confirm(uuid, uuid), public.tire_import_cancel(uuid, uuid, text), public.tire_import_history(uuid, integer, integer)
  to authenticated, service_role;
