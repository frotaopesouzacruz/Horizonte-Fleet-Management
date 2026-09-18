-- =============================================================================
-- FIX — master-data resolution for catalogues without a `code` column
--
-- Found by importing the reference QLP file: work_locations is the one
-- catalogue identified only by its name, and the resolver assumed every
-- catalogue had the same shape.
-- =============================================================================
create or replace function private.resolve_master_data(
  p_organization_id uuid,
  p_kind            text,
  p_code            text,
  p_name            text,
  p_create          boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table    text;
  v_has_code boolean;
  v_code     text := private.normalize_code(p_code);
  v_name     text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_id       uuid;
begin
  v_table := case p_kind
    when 'job_position'      then 'job_positions'
    when 'employment_area'   then 'employment_areas'
    when 'operation'         then 'operations'
    when 'work_location'     then 'work_locations'
    when 'business_profile'  then 'business_profiles'
    when 'organization_unit' then 'organization_units'
  end;
  if v_table is null then
    raise exception 'unknown master data kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;

  v_has_code := p_kind <> 'work_location';

  if v_name is null and v_code is null then
    return null;
  end if;

  if v_has_code and v_code is not null then
    execute format(
      'select id from public.%I where organization_id = $1 and code = $2 and deleted_at is null limit 1', v_table)
      into v_id using p_organization_id, v_code;
    if v_id is not null then return v_id; end if;
  end if;

  if v_name is not null then
    execute format(
      'select id from public.%I where organization_id = $1
         and private.normalize_label(name) = private.normalize_label($2)
         and deleted_at is null limit 1', v_table)
      into v_id using p_organization_id, v_name;
    if v_id is not null then return v_id; end if;
  end if;

  if not p_create then return null; end if;

  -- A catalogue row with no usable name would be unreadable in the product, so
  -- the code stands in for it when that is all the file carried.
  if v_has_code then
    execute format(
      'insert into public.%I (organization_id, code, name) values ($1, $2, $3) returning id', v_table)
      into v_id using p_organization_id, v_code, coalesce(v_name, v_code);
  else
    execute format(
      'insert into public.%I (organization_id, name) values ($1, $2) returning id', v_table)
      into v_id using p_organization_id, coalesce(v_name, v_code);
  end if;

  return v_id;
end;
$$;
