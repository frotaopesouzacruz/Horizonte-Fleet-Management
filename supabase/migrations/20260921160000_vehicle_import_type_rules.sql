-- =============================================================================
-- Importação de frotas: o que só era visto na gravação passa a ser validado
--
-- Duas regras da Etapa 07 valiam para o cadastro de veículos mas não eram
-- conferidas na pré-visualização: tipo de equipamento inativo e subcategoria
-- obrigatória. O efeito apareceu numa importação real de 95 veículos — a
-- validação devolveu "95 válidas, 0 erros" e o processamento abortou inteiro
-- no primeiro veículo de um tipo que estava desligado, sem dizer qual linha.
--
-- A área de staging existe para que o erro apareça antes de qualquer escrita,
-- com o número da linha. Agora aparece.
--
-- A função é reemitida inteira porque é assim que o PostgreSQL substitui uma
-- função; as mudanças são os dois blocos novos na seção de catálogos.
-- =============================================================================

create or replace function public.validate_vehicle_import(p_batch_id uuid)
returns table (
  total_rows   integer,
  valid_rows   integer,
  warning_rows integer,
  error_rows   integer,
  create_rows  integer,
  update_rows  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_mode  text;
  r       record;
  d       jsonb;
  v_status text;
  v_action text;

  v_plate  text;
  v_code   text;
  v_vin    text;
  v_renavam text;

  v_by_plate uuid;
  v_by_code  uuid;
  v_by_vin   uuid;
  v_by_ren   uuid;
  v_target   uuid;

  v_type_id uuid;
  v_sub_id  uuid;
  v_make_id uuid;
  v_model_id uuid;
  v_op_id   uuid;
  v_state_id smallint;
  v_city_id integer;
  v_unit_id uuid;
  v_cc_id   uuid;
  v_op_matches integer;

  v_cur_op  uuid;
  v_cur_city integer;
  v_cur_km  integer;
  v_issue   jsonb;
begin
  select organization_id, mode into v_org, v_mode
    from public.import_batches where id = p_batch_id and type = 'vehicles';
  if v_org is null then
    raise exception 'Lote de importação não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.import') then
    raise exception 'Você não possui permissão para importar frotas.' using errcode = 'insufficient_privilege';
  end if;

  delete from public.import_errors where batch_id = p_batch_id;

  for r in
    select id, row_number, normalized_data from public.import_rows
     where batch_id = p_batch_id order by row_number
  loop
    d := r.normalized_data;
    v_status := 'valid';
    v_action := 'create';
    v_target := null;

    -- 0. o que o parser já reprovou
    for v_issue in select * from jsonb_array_elements(coalesce(d -> 'parse_errors', '[]'::jsonb))
    loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number,
              coalesce(v_issue ->> 'level', 'error'), v_issue ->> 'field',
              coalesce(v_issue ->> 'code', 'parse'), coalesce(v_issue ->> 'message', 'Valor inválido.'));
      if coalesce(v_issue ->> 'level', 'error') = 'error' then v_status := 'error'; end if;
    end loop;

    v_code    := private.normalize_code(nullif(d ->> 'fleet_code', ''));
    v_plate   := private.normalize_plate(d ->> 'license_plate');
    v_vin     := private.normalize_plate(d ->> 'vin');
    v_renavam := private.normalize_renavam(d ->> 'renavam');

    -- 1. identificação mínima
    if v_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'required', 'Informe o código da frota.');
      v_status := 'error';
    end if;
    if v_plate is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'required', 'Informe a placa.');
      v_status := 'error';
    elsif v_plate !~ '^[A-Z0-9]{5,10}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'format',
              format('Placa %s não tem um formato reconhecido.', d ->> 'license_plate'));
      v_status := 'error';
    end if;
    if v_vin is not null and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'format', 'Chassi deve ter 17 caracteres válidos.');
      v_status := 'error';
    end if;
    if v_renavam is not null and v_renavam !~ '^[0-9]{11}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'format', 'RENAVAM deve ter 11 dígitos.');
      v_status := 'error';
    end if;

    -- 2. duplicidade dentro da própria planilha
    if v_plate is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_plate(o.normalized_data ->> 'license_plate') = v_plate
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'duplicate_in_file',
              format('A placa %s aparece mais de uma vez no arquivo.', v_plate));
      v_status := 'error';
    end if;
    if v_code is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_code(o.normalized_data ->> 'fleet_code') = v_code
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'duplicate_in_file',
              format('O código de frota %s aparece mais de uma vez no arquivo.', v_code));
      v_status := 'error';
    end if;

    -- Chassi e RENAVAM identificam o veículo tanto quanto a placa, e o banco
    -- tem índice único para os dois. Conferir só placa e código aqui deixava a
    -- duplicidade passar pela validação e estourar lá na gravação, que é
    -- exatamente o que a área de staging existe para evitar.
    if v_vin is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_plate(o.normalized_data ->> 'vin') = v_vin
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'duplicate_in_file',
              format('O chassi %s aparece mais de uma vez no arquivo.', v_vin));
      v_status := 'error';
    end if;
    if v_renavam is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_renavam(o.normalized_data ->> 'renavam') = v_renavam
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'duplicate_in_file',
              format('O RENAVAM %s aparece mais de uma vez no arquivo.', v_renavam));
      v_status := 'error';
    end if;

    -- 3. correspondência com a base: regra explícita, nunca aproximação
    v_by_plate := null; v_by_code := null; v_by_vin := null; v_by_ren := null;
    if v_plate is not null then
      select id into v_by_plate from public.vehicles
       where organization_id = v_org and license_plate = v_plate and deleted_at is null;
    end if;
    if v_code is not null then
      select id into v_by_code from public.vehicles
       where organization_id = v_org and fleet_code = v_code and deleted_at is null;
    end if;
    if v_vin is not null then
      select id into v_by_vin from public.vehicles
       where organization_id = v_org and vin = v_vin and deleted_at is null;
    end if;
    if v_renavam is not null then
      select id into v_by_ren from public.vehicles
       where organization_id = v_org and renavam = v_renavam and deleted_at is null;
    end if;

    if v_by_plate is not null and v_by_code is not null and v_by_plate <> v_by_code then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'identity_conflict',
              'A placa e o código de frota desta linha pertencem a veículos diferentes. Corrija a identidade antes de importar.');
      v_status := 'error';
    elsif v_by_plate is not null and v_by_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'identity_change',
              'Esta placa já está cadastrada com outro código de frota. Trocar a identidade exige o fluxo de correção cadastral.');
      v_status := 'error';
    elsif v_by_code is not null and v_by_plate is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'identity_change',
              'Este código de frota já está cadastrado com outra placa. Trocar a identidade exige o fluxo de correção cadastral.');
      v_status := 'error';
    else
      v_target := coalesce(v_by_plate, v_by_code);
    end if;

    if v_by_vin is not null and v_target is distinct from v_by_vin then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'duplicate', 'Este chassi já pertence a outro veículo.');
      v_status := 'error';
    end if;
    if v_by_ren is not null and v_target is distinct from v_by_ren then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'duplicate', 'Este RENAVAM já pertence a outro veículo.');
      v_status := 'error';
    end if;

    v_action := case when v_target is null then 'create' else 'update' end;

    -- 4. classificação
    v_type_id := null; v_sub_id := null; v_make_id := null; v_model_id := null;
    if nullif(d ->> 'type_name', '') is not null then
      select id into v_type_id from public.vehicle_types
       where private.normalize_label(name) = private.normalize_label(d ->> 'type_name')
          or private.normalize_label(code) = private.normalize_label(d ->> 'type_name')
       limit 1;
      if v_type_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'unknown',
                format('Tipo de equipamento "%s" não existe no catálogo.', d ->> 'type_name'));
        v_status := 'error';
      end if;

      -- Um tipo inativo continua classificando quem já classificava, mas não
      -- entra em cadastro novo. A regra existia só na gravação: a validação
      -- aprovava as 95 linhas e o lote inteiro estourava no primeiro veículo
      -- do tipo desligado, sem dizer qual linha.
      if v_type_id is not null and v_action = 'create' and not exists (
        select 1
          from public.vehicle_types t
          left join public.vehicle_type_settings s
                 on s.vehicle_type_id = t.id and s.organization_id = v_org
         where t.id = v_type_id and t.is_active and coalesce(s.is_enabled, true)
      ) then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'inactive',
                format('O tipo de equipamento "%s" está inativo e não pode ser usado em cadastros novos.',
                       d ->> 'type_name'));
        v_status := 'error';
      end if;
    elsif v_action = 'create' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'required', 'Informe o tipo de equipamento.');
      v_status := 'error';
    end if;

    if nullif(d ->> 'subcategory_name', '') is not null and v_type_id is not null then
      select id into v_sub_id from public.vehicle_subcategories
       where vehicle_type_id = v_type_id
         and (organization_id is null or organization_id = v_org)
         and private.normalize_label(name) = private.normalize_label(d ->> 'subcategory_name')
       order by (organization_id is not null) desc
       limit 1;
      if v_sub_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'subcategory_name', 'unknown',
                format('Subcategoria "%s" não pertence ao tipo informado e foi ignorada.', d ->> 'subcategory_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- Subcategoria obrigatória é regra explícita da organização e vale para o
    -- cadastro novo. Mesma história: só era vista na hora de gravar.
    if v_type_id is not null and v_action = 'create' and v_sub_id is null
       and coalesce((select s.requires_subcategory
                       from public.vehicle_type_settings s
                      where s.organization_id = v_org and s.vehicle_type_id = v_type_id), false) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'subcategory_name', 'required',
              format('O tipo "%s" exige subcategoria.', d ->> 'type_name'));
      v_status := 'error';
    end if;

    if nullif(d ->> 'make_name', '') is not null then
      select id into v_make_id from public.vehicle_makes
       where organization_id = v_org and private.normalize_label(name) = private.normalize_label(d ->> 'make_name')
       limit 1;
    end if;
    if nullif(d ->> 'model_name', '') is not null then
      select m.id into v_model_id from public.vehicle_models m
       where m.organization_id = v_org
         and private.normalize_label(m.name) = private.normalize_label(d ->> 'model_name')
         and (v_make_id is null or m.vehicle_make_id = v_make_id)
       limit 1;
      if v_model_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'model_name', 'unknown',
                format('Modelo "%s" não está no cadastro mestre e foi ignorado. Cadastre-o para vinculá-lo.', d ->> 'model_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 5. filial e centro de custo
    v_unit_id := null; v_cc_id := null;
    if nullif(d ->> 'unit_name', '') is not null then
      select id into v_unit_id from public.organization_units
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'unit_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'unit_name'))
       limit 1;
      if v_unit_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'unit_name', 'unknown',
                format('Filial "%s" não existe e foi ignorada.', d ->> 'unit_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;
    if nullif(d ->> 'cost_center_name', '') is not null then
      select id into v_cc_id from public.cost_centers
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'cost_center_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'cost_center_name'))
       limit 1;
      if v_cc_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'cost_center_name', 'unknown',
                format('Centro de custo "%s" não existe e foi ignorado.', d ->> 'cost_center_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 6. operação, estado e cidade
    v_op_id := null; v_state_id := null; v_city_id := null;
    if nullif(d ->> 'operation_name', '') is not null then
      select count(*) into v_op_matches
        from public.operations
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'operation_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'operation_name'));
      if v_op_matches = 1 then
        select id into v_op_id
          from public.operations
         where organization_id = v_org and deleted_at is null
           and (private.normalize_label(name) = private.normalize_label(d ->> 'operation_name')
                or private.normalize_code(code) = private.normalize_code(d ->> 'operation_name'))
         limit 1;
      elsif v_op_matches = 0 then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'operation_name', 'unknown',
                format('Operação "%s" não existe. Operações não são criadas por importação.', d ->> 'operation_name'));
        v_status := 'error';
      else
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'operation_name', 'ambiguous',
                format('"%s" corresponde a mais de uma operação. Resolva a ambiguidade no arquivo.', d ->> 'operation_name'));
        v_status := 'error';
      end if;
    end if;

    if v_op_id is not null and nullif(d ->> 'city_name', '') is not null then
      select c.id, c.state_id into v_city_id, v_state_id
        from public.operation_cities oc
        join public.cities c on c.id = oc.city_id
        join public.states s on s.id = c.state_id
       where oc.organization_id = v_org and oc.operation_id = v_op_id
         and private.normalize_label(c.name) = private.normalize_label(d ->> 'city_name')
         and (nullif(d ->> 'state_uf', '') is null or s.uf = upper(d ->> 'state_uf'))
       limit 1;
      if v_city_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'city_name', 'not_covered',
                format('A cidade "%s" não faz parte da cobertura da operação "%s".',
                       d ->> 'city_name', d ->> 'operation_name'));
        v_status := 'error';
      end if;
    elsif v_op_id is not null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'city_name', 'required',
              'Informe a cidade para alocar o veículo na operação.');
      v_status := 'error';
    end if;

    -- 7. o que a importação NÃO vai fazer num veículo existente
    if v_target is not null then
      v_cur_op   := null;
      v_cur_city := null;
      v_cur_km   := null;
      select a.operation_id, a.city_id into v_cur_op, v_cur_city
        from public.vehicle_operation_assignments a
       where a.vehicle_id = v_target
         and a.effective_from <= current_date
         and (a.effective_to is null or a.effective_to >= current_date)
       order by a.effective_from desc limit 1;

      if v_op_id is not null and (v_cur_op is distinct from v_op_id or v_cur_city is distinct from v_city_id) then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'operation_name', 'assignment_divergence',
                format('O arquivo indica %s/%s, diferente da alocação vigente. A alocação NÃO foi alterada: use a transferência, que tem data de vigência.',
                       d ->> 'operation_name', d ->> 'city_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;

      select o.odometer_km into v_cur_km
        from public.vehicle_odometer_readings o
       where o.vehicle_id = v_target and o.superseded_by is null
       order by o.reading_date desc, o.created_at desc limit 1;

      if nullif(d ->> 'odometer_km', '') is not null
         and v_cur_km is distinct from (d ->> 'odometer_km')::integer then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'odometer_km', 'odometer_divergence',
                format('O arquivo informa %s km e a leitura homologada é %s km. A leitura NÃO foi alterada: use a correção de quilometragem.',
                       d ->> 'odometer_km', coalesce(v_cur_km::text, 'ausente')));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 8. modo do lote
    if v_status <> 'error' then
      if v_mode = 'validate' then
        v_action := 'skip';
      elsif v_mode = 'create' and v_action = 'update' then
        v_action := 'skip';
      end if;
    else
      v_action := 'skip';
    end if;

    update public.import_rows
       set status = v_status,
           action = v_action,
           vehicle_id = v_target,
           normalized_data = d
             || (jsonb_build_object(
                  'resolved_fleet_code',     v_code,
                  'resolved_license_plate',  v_plate,
                  'resolved_vin',            v_vin,
                  'resolved_renavam',        v_renavam,
                  'resolved_type_id',        v_type_id,
                  'resolved_subcategory_id', v_sub_id,
                  'resolved_model_id',       v_model_id,
                  'resolved_unit_id',        v_unit_id,
                  'resolved_cost_center_id', v_cc_id,
                  'resolved_operation_id',   v_op_id,
                  'resolved_state_id',       v_state_id,
                  'resolved_city_id',        v_city_id))
     where id = r.id;
  end loop;

  update public.import_batches b
     set status = 'validated',
         total_rows   = c.total,
         valid_rows   = c.valid,
         warning_rows = c.warning,
         error_rows   = c.error
    from (
      select count(*) as total,
             count(*) filter (where status = 'valid')   as valid,
             count(*) filter (where status = 'warning') as warning,
             count(*) filter (where status = 'error')   as error
        from public.import_rows where batch_id = p_batch_id
    ) c
   where b.id = p_batch_id;

  return query
    select b.total_rows, b.valid_rows, b.warning_rows, b.error_rows,
           (select count(*)::integer from public.import_rows where batch_id = p_batch_id and action = 'create'),
           (select count(*)::integer from public.import_rows where batch_id = p_batch_id and action = 'update')
      from public.import_batches b where b.id = p_batch_id;
end;
$$;
