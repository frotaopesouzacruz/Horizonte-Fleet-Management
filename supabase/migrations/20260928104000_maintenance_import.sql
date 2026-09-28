-- =============================================================================
-- Etapa 16 — Manutenção: importação (base de manutenções e cadastros)
--
-- Mesmo protocolo em partes das outras importações (load → validate →
-- finalize → process), sem teto de linhas.
--
-- Base de manutenções — diferenças deliberadas em relação ao HFC:
--   * a base do HFC tem uma linha por serviço; aqui as linhas que descrevem a
--     mesma entrada em oficina (veículo + tipo + data de referência + OS) viram
--     UMA manutenção com vários itens;
--   * idempotência pela chave de negócio (import_key): reimportar o mesmo
--     arquivo não duplica nada — linha igual = inalterada, diferente = atualiza
--     (se ninguém mexeu depois da importação) ou conflito (se mexeu);
--   * situação e tipo são reconhecidos por equivalência exata ("Realizada" não
--     vira "Não realizada", como no HFC);
--   * nunca cria veículo, operação, serviço nem fornecedor: o que não existe é
--     erro na prévia; nunca altera perfis; nunca reescreve a trilha — cada
--     mudança importada é um evento novo com source = 'import'.
-- =============================================================================

create or replace function private.maintenance_norm(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(translate(btrim(coalesce(p_value, '')),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'), '');
$$;

create or replace function private.maintenance_import_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v = '' then
    return null;
  end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return left(v, 10)::date;
  end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(v, 'DD/MM/YYYY');
  end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{2}$' then
    return to_date(v, 'DD/MM/YY');
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.maintenance_import_time(p_value text)
returns time
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return btrim(p_value)::time;
exception when others then
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Etapa (carga, validação, prévia)
-- -----------------------------------------------------------------------------
-- p_payload: phase (load|validate|finalize|all), batch_id, kind, rows[], limit,
--            file_name, file_hash, file_size, column_mapping
-- kind: records | clusters | services | suppliers | preventive_rules
create or replace function public.stage_maintenance_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase   text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_kind    text := coalesce(nullif(p_payload ->> 'kind', ''), 'records');
  v_limit   integer := nullif(p_payload ->> 'limit', '')::integer;
  v_type    text;
  v_batch   uuid;
  v_loaded  integer;
  v_pend    record;
  r         jsonb;
  v_today   date := private.maintenance_today(p_organization_id);
  -- linha
  v_level text; v_action text; v_msgs jsonb; v_norm jsonb;
  v_vehicle record; v_type_code text; v_origin_code text; v_status text; v_raw text;
  v_service uuid; v_cluster uuid; v_supplier uuid; v_services uuid[];
  v_req date; v_sched date; v_entry date; v_exit date; v_ref date; v_expected date;
  v_key text; v_group text; v_existing record; v_km integer; v_cycle integer;
  v_name text; v_code text; v_vtype uuid; v_sub uuid; v_model uuid;
  n_total int; n_valid int; n_warn int; n_err int; v_msg jsonb;
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  if v_kind not in ('records', 'clusters', 'services', 'suppliers', 'preventive_rules') then
    raise exception 'Tipo de importação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  v_type := case when v_kind = 'records' then 'maintenance' else 'maintenance_catalog' end;

  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values
      (p_organization_id, v_type, 'create_update', 'draft', coalesce(nullif(p_payload ->> 'file_name', ''), 'manutencao'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), jsonb_build_object('kind', v_kind), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    select b.summary ->> 'kind' into v_kind from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = v_type
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if v_kind is null then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch, 'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  if v_phase in ('all', 'validate') then
    for v_pend in
      select x.id, x.row_number, x.normalized_data from public.import_rows x
       where x.batch_id = v_batch and x.status = 'pending'
       order by x.row_number
       limit greatest(coalesce(v_limit, 2147483647), 1)
    loop
      r := v_pend.normalized_data;
      v_level := 'valid'; v_action := 'create'; v_msgs := '[]'::jsonb; v_norm := '{}'::jsonb;

      if v_kind = 'records' then
        -- Veículo: pela frota, depois pela placa. Nunca cria.
        v_vehicle := null;
        select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
         where v.organization_id = p_organization_id and nullif(btrim(r ->> 'fleet_code'), '') is not null
           and upper(btrim(v.fleet_code)) = upper(btrim(r ->> 'fleet_code'))
         order by v.deleted_at nulls first limit 1;
        if v_vehicle.id is null and nullif(btrim(r ->> 'license_plate'), '') is not null then
          select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
           where v.organization_id = p_organization_id
             and private.normalize_plate(v.license_plate) = private.normalize_plate(r ->> 'license_plate')
           order by v.deleted_at nulls first limit 1;
        end if;
        if v_vehicle.id is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'license_plate', 'code', 'unknown_vehicle',
                    'message', 'Veículo não encontrado pela frota nem pela placa. A importação não cria veículos.');
        end if;

        -- Tipo (equivalência exata; Avaria tem fluxo próprio).
        v_raw := private.maintenance_norm(r ->> 'maintenance_type');
        v_type_code := case v_raw
                         when 'preventiva' then 'preventive' when 'preventive' then 'preventive'
                         when 'corretiva' then 'corrective' when 'corrective' then 'corrective'
                         when 'preditiva' then 'predictive' when 'predictive' then 'predictive'
                         when 'socorro em rota' then 'corrective' when 'entrega tecnica' then 'corrective'
                       end;
        v_origin_code := case v_raw when 'socorro em rota' then 'roadside_assistance' when 'entrega tecnica' then 'technical_delivery' end;
        if v_raw = 'avaria' then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'damage_flow',
                    'message', 'Avarias têm fluxo próprio (Sinistros e Avarias) e não entram na base de manutenção.');
        elsif v_type_code is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'unknown_type',
                    'message', format('Tipo de manutenção "%s" não reconhecido (use Preventiva, Corretiva ou Preditiva).', coalesce(r ->> 'maintenance_type', '')));
        elsif v_origin_code is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'maintenance_type', 'code', 'type_mapped',
                    'message', format('"%s" é origem no HFM: importado como Corretiva com essa origem.', r ->> 'maintenance_type'));
        end if;

        -- Situação (equivalência exata).
        v_raw := private.maintenance_norm(r ->> 'status');
        v_status := case v_raw
                      when 'ha agendar' then 'to_schedule' when 'a agendar' then 'to_schedule' when 'aguardando agendamento' then 'to_schedule'
                      when 'agendado' then 'scheduled' when 'agendada' then 'scheduled' when 'reprogramado' then 'scheduled'
                      when 'em execucao' then 'in_progress' when 'em andamento' then 'in_progress'
                      when 'concluido' then 'completed' when 'concluida' then 'completed' when 'realizada' then 'completed' when 'realizado' then 'completed'
                      when 'cancelado' then 'cancelled' when 'cancelada' then 'cancelled'
                      when 'nao realizada' then 'not_performed' when 'nao realizado' then 'not_performed'
                    end;
        if v_raw is null then
          v_status := 'to_schedule';
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'status_default',
                    'message', 'Situação vazia: importada como Há agendar.');
        elsif v_status is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'unknown_status',
                    'message', format('Situação "%s" não reconhecida.', r ->> 'status'));
        end if;

        -- Origem.
        if v_origin_code is null then
          v_raw := private.maintenance_norm(r ->> 'origin');
          if v_raw is null then
            v_origin_code := 'import';
          else
            select o.code into v_origin_code from public.maintenance_origins o
             where (o.organization_id is null or o.organization_id = p_organization_id) and o.is_active
               and (private.maintenance_norm(o.name) = v_raw or o.code = v_raw
                    or (v_raw = 'plano de acao checklist' and o.code = 'action_plan')
                    or (v_raw = 'preventiva programada' and o.code = 'preventive_schedule'))
             order by o.organization_id nulls last limit 1;
            if v_origin_code is null then
              v_origin_code := 'not_informed';
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'origin', 'code', 'unknown_origin',
                        'message', format('Origem "%s" não está no catálogo: importada como Não informado.', r ->> 'origin'));
            end if;
          end if;
        end if;

        -- Serviço (pelo cluster + nome; o cluster pode vir vazio se o nome for único).
        v_service := null; v_cluster := null;
        if nullif(btrim(r ->> 'service'), '') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'missing_service',
                    'message', 'Serviço ausente.');
        else
          select s.id, s.cluster_id into v_service, v_cluster
            from public.maintenance_services s join public.maintenance_clusters c on c.id = s.cluster_id
           where s.organization_id = p_organization_id and s.deleted_at is null
             and private.maintenance_norm(s.name) = private.maintenance_norm(r ->> 'service')
             and (nullif(btrim(r ->> 'cluster'), '') is null
                  or private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'cluster')
                  or c.code = upper(btrim(r ->> 'cluster')))
           order by s.status = 'active' desc limit 1;
          if v_service is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                      'message', format('Serviço "%s"%s não está no catálogo. Importe os cadastros antes.',
                                        r ->> 'service', coalesce(' (cluster ' || nullif(btrim(r ->> 'cluster'), '') || ')', '')));
          end if;
        end if;

        -- Fornecedor.
        v_supplier := null;
        if nullif(btrim(r ->> 'supplier'), '') is not null then
          select s.id into v_supplier from public.maintenance_suppliers s
           where s.organization_id = p_organization_id and s.deleted_at is null
             and (private.maintenance_norm(s.name) = private.maintenance_norm(r ->> 'supplier')
                  or private.maintenance_norm(s.trade_name) = private.maintenance_norm(r ->> 'supplier')
                  or (s.document_number is not null and s.document_number = regexp_replace(r ->> 'supplier', '[^0-9]', '', 'g')))
           limit 1;
          if v_supplier is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'supplier', 'code', 'unknown_supplier',
                      'message', format('Fornecedor "%s" não está no catálogo. Importe os fornecedores antes.', r ->> 'supplier'));
          end if;
        end if;

        -- Datas e os fatos que a situação exige.
        v_req := private.maintenance_import_date(r ->> 'requested_on');
        v_sched := private.maintenance_import_date(r ->> 'scheduled_date');
        v_entry := private.maintenance_import_date(r ->> 'entry_date');
        v_exit := private.maintenance_import_date(r ->> 'exit_date');
        v_expected := private.maintenance_import_date(r ->> 'expected_exit_date');
        v_ref := coalesce(v_entry, v_sched, v_req);
        v_req := coalesce(v_req, least(coalesce(v_entry, v_sched), v_today), v_today);
        if nullif(btrim(r ->> 'entry_date'), '') is not null and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'invalid_date', 'message', 'Data de entrada inválida.');
        end if;
        if nullif(btrim(r ->> 'exit_date'), '') is not null and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'invalid_date', 'message', 'Data de saída inválida.');
        end if;
        if v_status = 'scheduled' and v_sched is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'scheduled_date', 'code', 'missing_scheduled',
                    'message', 'Agendado exige a data agendada.');
        end if;
        if v_status in ('in_progress', 'completed') and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'missing_entry',
                    'message', 'Em execução ou concluído exige a data de entrada real.');
        end if;
        if v_status = 'completed' and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'missing_exit',
                    'message', 'Concluído exige a data de saída real.');
        end if;
        if v_exit is not null and v_entry is not null and v_exit < v_entry then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'exit_before_entry',
                    'message', 'Saída anterior à entrada.');
        end if;
        if v_entry > v_today or v_exit > v_today then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'future_fact',
                    'message', 'Entrada ou saída real no futuro.');
        end if;
        if v_status = 'in_progress' and v_exit is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'exit_date', 'code', 'exit_ignored',
                    'message', 'Em execução com data de saída: a saída foi ignorada.');
          v_exit := null;
        end if;
        begin
          v_km := nullif(regexp_replace(coalesce(r ->> 'entry_km', ''), '[^0-9]', '', 'g'), '')::integer;
        exception when others then
          v_km := null;
        end;
        if v_km is not null and v_km > 9999999 then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'entry_km', 'code', 'km_out_of_range',
                    'message', 'KM de entrada fora da faixa: ignorado (o KM oficial será usado).');
          v_km := null;
        end if;
        if v_expected is not null and v_sched is not null and v_expected < v_sched then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'expected_exit_date', 'code', 'expected_before_schedule',
                    'message', 'Previsão de saída anterior ao agendamento: ignorada.');
          v_expected := null;
        end if;
        v_cycle := nullif(substring(coalesce(r ->> 'preventive_cycle', '') from '(\d+)'), '')::integer;
        if v_type_code = 'preventive' and v_cycle is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'no_cycle',
                    'message', 'Preventiva sem ciclo (MP): importada sem vínculo com a matriz preventiva.');
        end if;

        -- Chave de negócio: a entrada em oficina (a manutenção) e o item.
        v_group := md5(concat_ws('|', v_vehicle.id, v_type_code, v_ref, upper(btrim(coalesce(r ->> 'service_order_number', '')))));
        v_key := v_group || ':' || coalesce(v_service::text, '');

        if exists (select 1 from public.import_rows x
                    where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                      and x.normalized_data ->> 'item_key' = v_key) then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'duplicate_in_file',
                    'message', 'Linha repetida no arquivo (mesmo veículo, tipo, data, OS e serviço).');
        end if;

        -- Já existe no HFM?
        v_existing := null;
        select m.id, m.code, m.status, m.imported_at, m.updated_at,
               exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user') as touched,
               exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service) as has_item
          into v_existing
          from public.maintenances m
         where m.organization_id = p_organization_id and m.import_key = v_group;

        v_norm := jsonb_build_object(
          'vehicle_id', v_vehicle.id, 'type', v_type_code, 'origin_code', v_origin_code, 'status', v_status,
          'service_id', v_service, 'cluster_id', v_cluster, 'supplier_id', v_supplier,
          'requested_on', v_req, 'scheduled_date', v_sched, 'scheduled_time', private.maintenance_import_time(r ->> 'scheduled_time'),
          'expected_exit_date', v_expected, 'entry_date', v_entry, 'entry_time', private.maintenance_import_time(r ->> 'entry_time'),
          'exit_date', v_exit, 'exit_time', private.maintenance_import_time(r ->> 'exit_time'),
          'entry_km', v_km, 'preventive_cycle', v_cycle,
          'service_order_number', nullif(btrim(r ->> 'service_order_number'), ''),
          'priority', case private.maintenance_norm(r ->> 'priority') when 'baixa' then 'low' when 'alta' then 'high'
                                                                      when 'critica' then 'critical' else 'medium' end,
          'description', nullif(btrim(r ->> 'description'), ''), 'notes', nullif(btrim(r ->> 'notes'), ''),
          'group_key', v_group, 'item_key', v_key,
          'license_plate', r ->> 'license_plate', 'fleet_code', r ->> 'fleet_code', 'service', r ->> 'service');

        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif v_existing.id is not null then
          if v_existing.touched then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'conflict',
                      'message', format('%s já foi alterada no HFM depois da importação; o arquivo não sobrescreve (conflito).', v_existing.code));
          elsif v_existing.has_item and v_existing.status = v_status then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'unchanged',
                      'message', format('%s já importada, sem mudança.', v_existing.code));
          else
            v_action := 'update';
          end if;
          v_norm := v_norm || jsonb_build_object('existing_id', v_existing.id, 'existing_code', v_existing.code);
        elsif exists (select 1 from public.import_rows x
                       where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                         and x.normalized_data ->> 'group_key' = v_group and x.action = 'create') then
          v_action := 'update';  -- mais um serviço da mesma manutenção deste arquivo
        end if;
        if v_level = 'valid' and exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;

      elsif v_kind = 'clusters' then
        v_name := nullif(btrim(r ->> 'name'), '');
        v_code := upper(coalesce(nullif(btrim(r ->> 'code'), ''), private.maintenance_code_from_name(v_name)));
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do cluster ausente.');
        end if;
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (c.code = v_code or private.maintenance_norm(c.name) = private.maintenance_norm(v_name)) limit 1;
        v_action := case when v_cluster is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_cluster, 'name', v_name, 'code', v_code, 'description', nullif(btrim(r ->> 'description'), ''),
                                     'default_criticality', case private.maintenance_norm(r ->> 'criticality') when 'baixa' then 'low' when 'alta' then 'high'
                                                                                                                when 'critica' then 'critical' else 'medium' end,
                                     'item_key', 'cluster:' || v_code);

      elsif v_kind = 'services' then
        v_name := nullif(btrim(r ->> 'name'), '');
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'cluster') or c.code = upper(btrim(coalesce(r ->> 'cluster', ''))))
         limit 1;
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do serviço ausente.');
        end if;
        if v_cluster is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'cluster', 'code', 'unknown_cluster',
                    'message', format('Cluster "%s" não existe. Todo serviço pertence a um cluster; importe os clusters antes.', coalesce(r ->> 'cluster', '')));
        end if;
        select s.id into v_service from public.maintenance_services s
         where s.organization_id = p_organization_id and s.deleted_at is null and s.cluster_id = v_cluster
           and private.maintenance_norm(s.name) = private.maintenance_norm(v_name) limit 1;
        v_action := case when v_service is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_service, 'cluster_id', v_cluster, 'name', v_name,
                    'criticality', case private.maintenance_norm(r ->> 'criticality') when 'baixa' then 'low' when 'alta' then 'high'
                                                                                      when 'critica' then 'critical' else 'medium' end,
                    'expected_hours', nullif(replace(regexp_replace(coalesce(r ->> 'expected_hours', ''), '[^0-9,\.]', '', 'g'), ',', '.'), ''),
                    'is_predictive', private.maintenance_norm(r ->> 'is_predictive') in ('sim', 's', 'true', '1', 'x', 'yes'),
                    'maintenance_type_codes', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from (
                        select case private.maintenance_norm(x) when 'preventiva' then 'preventive' when 'corretiva' then 'corrective'
                                                                when 'preditiva' then 'predictive' end as t
                          from regexp_split_to_table(coalesce(r ->> 'maintenance_types', ''), '[;,|/]') x) q where t is not null),
                    'item_key', 'service:' || coalesce(v_cluster::text, '') || ':' || coalesce(private.maintenance_norm(v_name), ''));

      elsif v_kind = 'suppliers' then
        v_name := nullif(btrim(r ->> 'name'), '');
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do fornecedor ausente.');
        end if;
        select s.id into v_supplier from public.maintenance_suppliers s
         where s.organization_id = p_organization_id and s.deleted_at is null
           and (private.maintenance_norm(s.name) = private.maintenance_norm(v_name)
                or (s.document_number is not null and s.document_number = nullif(regexp_replace(coalesce(r ->> 'document_number', ''), '[^0-9]', '', 'g'), '')))
         limit 1;
        v_action := case when v_supplier is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_supplier, 'name', v_name,
                    'document_number', nullif(regexp_replace(coalesce(r ->> 'document_number', ''), '[^0-9]', '', 'g'), ''),
                    'address', nullif(btrim(r ->> 'address'), ''),
                    'city_id', (select c.id from public.cities c join public.states s on s.id = c.state_id
                                 where private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'city')
                                   and (nullif(btrim(r ->> 'state'), '') is null or upper(s.uf) = upper(btrim(r ->> 'state')))
                                 order by c.is_municipality desc limit 1),
                    'cluster_ids', (select coalesce(jsonb_agg(distinct c.id), '[]'::jsonb)
                                      from regexp_split_to_table(coalesce(r ->> 'clusters', ''), '[;,|/]') x
                                      join public.maintenance_clusters c on c.organization_id = p_organization_id and c.deleted_at is null
                                       and private.maintenance_norm(c.name) = private.maintenance_norm(x)),
                    'item_key', 'supplier:' || coalesce(private.maintenance_norm(v_name), ''));
        if nullif(btrim(r ->> 'city'), '') is not null and v_norm ->> 'city_id' is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'unknown_city',
                    'message', format('Cidade "%s" não encontrada: fornecedor importado sem cidade.', r ->> 'city'));
        end if;

      else  -- preventive_rules
        select t.id into v_vtype from public.vehicle_types t
         where (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null
           and (private.maintenance_norm(t.name) = private.maintenance_norm(r ->> 'vehicle_type') or lower(t.code) = lower(btrim(coalesce(r ->> 'vehicle_type', ''))))
         order by t.organization_id nulls last limit 1;
        if v_vtype is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'vehicle_type', 'code', 'unknown_vehicle_type',
                    'message', format('Tipo de equipamento "%s" não existe.', coalesce(r ->> 'vehicle_type', '')));
        end if;
        v_sub := null; v_model := null;
        if nullif(btrim(r ->> 'subcategory'), '') is not null then
          select s.id into v_sub from public.vehicle_subcategories s
           where s.vehicle_type_id = v_vtype and private.maintenance_norm(s.name) = private.maintenance_norm(r ->> 'subcategory') limit 1;
          if v_sub is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'subcategory', 'code', 'unknown_subcategory',
                      'message', format('Subcategoria "%s" não existe neste tipo.', r ->> 'subcategory'));
          end if;
        end if;
        if nullif(btrim(r ->> 'model'), '') is not null then
          select m.id into v_model from public.vehicle_models m
           where (m.organization_id = p_organization_id or m.organization_id is null) and private.maintenance_norm(m.name) = private.maintenance_norm(r ->> 'model') limit 1;
          if v_model is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'model', 'code', 'unknown_model',
                      'message', format('Modelo "%s" não existe.', r ->> 'model'));
          end if;
        end if;
        select s.id into v_service from public.maintenance_services s
         where s.organization_id = p_organization_id and s.deleted_at is null
           and private.maintenance_norm(s.name) = private.maintenance_norm(r ->> 'service') limit 1;
        if nullif(btrim(r ->> 'service'), '') is not null and v_service is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                    'message', format('Serviço "%s" não está no catálogo.', r ->> 'service'));
        end if;
        if coalesce(nullif(regexp_replace(coalesce(r ->> 'interval_km', ''), '[^0-9]', '', 'g'), '')::integer, 0) < 100 then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'interval_km', 'code', 'invalid_interval',
                    'message', 'Intervalo de KM ausente ou menor que 100.');
        end if;
        v_action := case when exists (select 1 from public.maintenance_preventive_rules pr
                                       where pr.organization_id = p_organization_id and pr.deleted_at is null
                                         and pr.vehicle_type_id = v_vtype and pr.vehicle_subcategory_id is not distinct from v_sub
                                         and pr.vehicle_model_id is not distinct from v_model) then 'update' else 'create' end;
        v_norm := jsonb_build_object(
          'id', (select pr.id from public.maintenance_preventive_rules pr
                  where pr.organization_id = p_organization_id and pr.deleted_at is null and pr.vehicle_type_id = v_vtype
                    and pr.vehicle_subcategory_id is not distinct from v_sub and pr.vehicle_model_id is not distinct from v_model),
          'vehicle_type_id', v_vtype, 'vehicle_subcategory_id', v_sub, 'vehicle_model_id', v_model, 'service_id', v_service,
          'interval_km', nullif(regexp_replace(coalesce(r ->> 'interval_km', ''), '[^0-9]', '', 'g'), ''),
          'initial_km', coalesce(nullif(regexp_replace(coalesce(r ->> 'initial_km', ''), '[^0-9]', '', 'g'), ''), '0'),
          'cycle_count', coalesce(nullif(regexp_replace(coalesce(r ->> 'cycle_count', ''), '[^0-9]', '', 'g'), ''), '20'),
          'alert_before_pct', coalesce(nullif(replace(r ->> 'alert_before_pct', ',', '.'), ''), '5'),
          'tolerance_after_pct', coalesce(nullif(replace(r ->> 'tolerance_after_pct', ',', '.'), ''), '5'),
          'item_key', 'rule:' || concat_ws(':', v_vtype, v_sub, v_model));
      end if;

      if v_kind <> 'records' then
        if exists (select 1 from public.import_rows x
                    where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                      and x.normalized_data ->> 'item_key' = v_norm ->> 'item_key') then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', null, 'code', 'duplicate_in_file',
                    'message', 'Registro repetido no arquivo.');
        end if;
        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;
      end if;

      update public.import_rows
         set normalized_data = v_norm, status = v_level, action = v_action,
             vehicle_id = case when v_kind = 'records' then (v_norm ->> 'vehicle_id')::uuid end
       where id = v_pend.id;
      for v_msg in select * from jsonb_array_elements(v_msgs) loop
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, v_batch, v_pend.row_number, v_msg ->> 'level', v_msg ->> 'field', v_msg ->> 'code', v_msg ->> 'message');
      end loop;
    end loop;
    if v_phase = 'validate' then
      return jsonb_build_object('batch_id', v_batch,
        'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
    end if;
  end if;

  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  select count(*)::integer, count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer, count(*) filter (where x.status = 'error')::integer
    into n_total, n_valid, n_warn, n_err
    from public.import_rows x where x.batch_id = v_batch;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         created_rows = 0, updated_rows = 0, skipped_rows = 0,
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
           'create_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'create'),
           'update_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'update'),
           'unchanged_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'unchanged'),
           'conflict_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'conflict'),
           'duplicate_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'duplicate_in_file'),
           'maintenances', (select count(distinct x.normalized_data ->> 'group_key') from public.import_rows x
                             where x.batch_id = v_batch and x.action in ('create', 'update')),
           'already_imported', exists (select 1 from public.import_batches b
                                        where b.organization_id = p_organization_id and b.type = v_type and b.status = 'completed'
                                          and b.file_hash is not null
                                          and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch))),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return (
    select jsonb_build_object(
      'batch_id', v_batch, 'kind', v_kind, 'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
      'summary', b.summary,
      'categories', (select coalesce(jsonb_object_agg(e.code, e.cnt), '{}'::jsonb)
                       from (select code, count(*) as cnt from public.import_errors where batch_id = v_batch group by code) e),
      'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field,
                                                                'code', e.code, 'message', e.message) order by e.level, e.row_number)
                              from (select * from public.import_errors x where x.batch_id = v_batch
                                     order by (x.level = 'error') desc, x.row_number limit 300) e), '[]'::jsonb),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', i.row_number, 'status', i.status, 'action', i.action,
                                                              'data', i.normalized_data) order by i.row_number)
                            from (select * from public.import_rows x where x.batch_id = v_batch order by x.row_number limit 12) i), '[]'::jsonb))
      from public.import_batches b where b.id = v_batch);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Gravação em partes
-- -----------------------------------------------------------------------------
create or replace function public.process_maintenance_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   record;
  v_kind    text;
  v_group   record;
  v_row     record;
  v_m       public.maintenances;
  v_id      uuid;
  v_code    text;
  v_origin  uuid;
  v_context jsonb;
  v_km      jsonb;
  v_cycle   uuid;
  v_first   jsonb;
  v_left    integer;
  v_done    integer := 0;
  v_limit   integer := greatest(coalesce(p_limit, 2147483647), 1);
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type in ('maintenance', 'maintenance_catalog') for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  v_kind := v_batch.summary ->> 'kind';
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  end if;

  if v_kind = 'records' then
    for v_group in
      select x.normalized_data ->> 'group_key' as group_key, min(x.row_number) as first_row
        from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       group by 1 order by 2
       limit v_limit
    loop
      select x.normalized_data into v_first from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
         and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       order by x.row_number limit 1;

      select * into v_m from public.maintenances
       where organization_id = p_organization_id and import_key = v_group.group_key for update;

      if v_m.id is null then
        select o.id into v_origin from public.maintenance_origins o
         where o.code = v_first ->> 'origin_code' and (o.organization_id is null or o.organization_id = p_organization_id)
         order by o.organization_id nulls last limit 1;
        v_code := private.next_entity_code(p_organization_id,
                    'maintenance:' || extract(year from (v_first ->> 'requested_on')::date)::int,
                    'MAN-' || extract(year from (v_first ->> 'requested_on')::date)::int || '-', 6);
        v_cycle := null;
        if v_first ->> 'type' = 'preventive' and v_first ->> 'preventive_cycle' is not null then
          perform private.maintenance_sync_preventive_vehicle((v_first ->> 'vehicle_id')::uuid);
          select c.id into v_cycle from public.maintenance_preventive_cycles c
           where c.vehicle_id = (v_first ->> 'vehicle_id')::uuid and c.cycle_number = (v_first ->> 'preventive_cycle')::integer;
          -- Um ciclo com manutenção aberta não recebe outra aberta.
          if v_cycle is not null and v_first ->> 'status' in ('to_schedule', 'scheduled', 'in_progress')
             and exists (select 1 from public.maintenances mm where mm.preventive_cycle_id = v_cycle
                           and mm.status in ('to_schedule', 'scheduled', 'in_progress')) then
            v_cycle := null;
          end if;
        end if;

        insert into public.maintenances
          (organization_id, code, vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id, vehicle_subcategory_id,
           vehicle_model_id, maintenance_type_code, origin_id, priority, status, context_date, requested_on,
           scheduled_date, scheduled_time, expected_exit_date, entry_date, entry_time, exit_date, exit_time,
           supplier_id, service_order_number, preventive_cycle_id, description, notes, import_batch_id, import_key, imported_at)
        select p_organization_id, v_code, v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_subcategory_id,
               v.vehicle_model_id, v_first ->> 'type', v_origin, coalesce(v_first ->> 'priority', 'medium'), v_first ->> 'status',
               coalesce((v_first ->> 'entry_date')::date, (v_first ->> 'scheduled_date')::date, (v_first ->> 'requested_on')::date),
               (v_first ->> 'requested_on')::date, (v_first ->> 'scheduled_date')::date, (v_first ->> 'scheduled_time')::time,
               (v_first ->> 'expected_exit_date')::date,
               case when v_first ->> 'status' in ('in_progress', 'completed') then (v_first ->> 'entry_date')::date end,
               case when v_first ->> 'status' in ('in_progress', 'completed') then (v_first ->> 'entry_time')::time end,
               case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_date')::date end,
               case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_time')::time end,
               (v_first ->> 'supplier_id')::uuid, v_first ->> 'service_order_number', v_cycle,
               v_first ->> 'description', v_first ->> 'notes', p_batch_id, v_group.group_key, now()
          from public.vehicles v where v.id = (v_first ->> 'vehicle_id')::uuid
        returning * into v_m;

        v_context := private.maintenance_context(p_organization_id, v_m.vehicle_id, v_m.context_date);
        perform private.maintenance_apply_context(v_m.id, v_context);
        if v_m.entry_date is not null then
          if v_first ->> 'entry_km' is not null then
            v_km := private.maintenance_check_manual_km(p_organization_id, v_m.vehicle_id, v_m.entry_date, (v_first ->> 'entry_km')::integer)
                    || jsonb_build_object('source', 'import');
          else
            v_km := private.maintenance_resolve_km(p_organization_id, v_m.vehicle_id, v_m.entry_date);
          end if;
          perform private.maintenance_apply_entry_km(v_m.id, v_km, null);
        end if;
        perform private.maintenance_log(p_organization_id, v_m.id, 'imported', null, v_m.status,
          'Importado de ' || coalesce(v_batch.file_name, 'arquivo'),
          jsonb_build_object('batch_id', p_batch_id, 'first_row', v_group.first_row, 'context', v_context), 'import');
      elsif (v_first ->> 'status') is distinct from v_m.status then
        -- Situação diferente num registro ainda intocado: novo evento, nunca reescrita.
        update public.maintenances set
          status = v_first ->> 'status',
          scheduled_date = coalesce((v_first ->> 'scheduled_date')::date, scheduled_date),
          entry_date = case when v_first ->> 'status' in ('in_progress', 'completed') then coalesce((v_first ->> 'entry_date')::date, entry_date) else entry_date end,
          exit_date = case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_date')::date else null end,
          exit_time = case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_time')::time else null end,
          supplier_id = coalesce((v_first ->> 'supplier_id')::uuid, supplier_id),
          imported_at = now(), import_batch_id = p_batch_id
        where id = v_m.id;
        perform private.maintenance_log(p_organization_id, v_m.id, 'import_updated', v_m.status, v_first ->> 'status',
          'Atualizado por ' || coalesce(v_batch.file_name, 'arquivo'), jsonb_build_object('batch_id', p_batch_id), 'import');
        select * into v_m from public.maintenances where id = v_m.id;
      end if;

      -- Itens: um por serviço distinto do grupo.
      for v_row in
        select x.id, x.normalized_data as d from public.import_rows x
         where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
           and x.status in ('valid', 'warning') and x.action in ('create', 'update')
         order by x.row_number
      loop
        -- Qualquer item do serviço (inclusive cancelado) já representa a linha:
        -- reimportar não cria outro.
        if not exists (select 1 from public.maintenance_items i
                        where i.maintenance_id = v_m.id and i.service_id = (v_row.d ->> 'service_id')::uuid) then
          insert into public.maintenance_items
            (organization_id, maintenance_id, service_id, cluster_id, service_name_snapshot, cluster_name_snapshot, criticality,
             status, result, completed_at, sort_order)
          select p_organization_id, v_m.id, s.id, c.id, s.name, c.name, s.criticality,
                 case when v_m.status = 'completed' then 'done' when v_m.status in ('cancelled', 'not_performed') then 'cancelled' else 'pending' end,
                 case when v_m.status = 'completed' then 'resolved' end,
                 case when v_m.status = 'completed' then now() end,
                 (select coalesce(max(i.sort_order), 0) + 1 from public.maintenance_items i where i.maintenance_id = v_m.id)
            from public.maintenance_services s join public.maintenance_clusters c on c.id = s.cluster_id
           where s.id = (v_row.d ->> 'service_id')::uuid;
        elsif v_m.status = 'completed' then
          update public.maintenance_items set status = 'done', result = coalesce(result, 'resolved'), completed_at = coalesce(completed_at, now())
           where maintenance_id = v_m.id and service_id = (v_row.d ->> 'service_id')::uuid and status = 'pending';
        end if;
        update public.import_rows set status = case when v_row.d ? 'existing_id' then 'updated' else 'created' end where id = v_row.id;
      end loop;

      -- Preventiva importada como concluída realiza o ciclo; preditiva coberta reinicia.
      if v_m.status = 'completed' then
        if v_m.preventive_cycle_id is not null then
          update public.maintenance_preventive_cycles set
            completed_on = v_m.exit_date, completed_km = v_m.entry_km, completed_maintenance_id = v_m.id, completion_source = 'import'
          where id = v_m.preventive_cycle_id and completed_on is null;
        end if;
        perform private.maintenance_on_completed(v_m.id);
      end if;
      v_done := v_done + 1;
    end loop;
  else
    for v_row in
      select x.id, x.row_number, x.action, x.normalized_data as d from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       order by x.row_number limit v_limit
    loop
      begin
        if v_kind = 'clusters' then
          perform public.maintenance_save_cluster(p_organization_id, (v_row.d - 'item_key') - case when v_row.d ->> 'id' is null then 'id' else '' end);
        elsif v_kind = 'services' then
          perform public.maintenance_save_service(p_organization_id, v_row.d - 'item_key');
        elsif v_kind = 'suppliers' then
          perform public.maintenance_save_supplier(p_organization_id, v_row.d - 'item_key');
        else
          perform public.maintenance_save_preventive_rule(p_organization_id, v_row.d - 'item_key');
        end if;
        update public.import_rows set status = case when v_row.action = 'update' then 'updated' else 'created' end where id = v_row.id;
      exception when others then
        update public.import_rows set status = 'failed', action = 'skip' where id = v_row.id;
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, 'error', null, 'process_failed', sqlerrm);
      end;
      v_done := v_done + 1;
    end loop;
  end if;

  select count(*)::integer into v_left from public.import_rows x
   where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left, 'batch_id', p_batch_id);
  end if;

  update public.import_batches set
    status = 'completed', processed_at = now(),
    created_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'created'),
    updated_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'updated'),
    skipped_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status in ('warning', 'error', 'skipped', 'failed')),
    summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
      'maintenances_created', (select count(*) from public.maintenances m where m.import_batch_id = p_batch_id
                                  and exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.event_type = 'imported'
                                                and e.payload ->> 'batch_id' = p_batch_id::text))),
    updated_at = now(), updated_by = auth.uid()
  where id = p_batch_id;

  return (select jsonb_build_object('done', true, 'remaining', 0, 'batch_id', p_batch_id,
                                    'created_rows', b.created_rows, 'updated_rows', b.updated_rows, 'skipped_rows', b.skipped_rows,
                                    'summary', b.summary)
            from public.import_batches b where b.id = p_batch_id);
end;
$$;

create or replace function public.cancel_maintenance_import(p_organization_id uuid, p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  update public.import_batches set status = 'cancelled', updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id and organization_id = p_organization_id and type in ('maintenance', 'maintenance_catalog')
     and status in ('draft', 'validated') and created_by = auth.uid();
end;
$$;

-- Histórico de importações do módulo.
create or replace function public.maintenance_import_history(p_organization_id uuid, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'kind', b.summary ->> 'kind', 'file_name', b.file_name, 'status', b.status,
           'total_rows', b.total_rows, 'created_rows', b.created_rows, 'updated_rows', b.updated_rows,
           'skipped_rows', b.skipped_rows, 'error_rows', b.error_rows, 'summary', b.summary,
           'created_at', b.created_at, 'processed_at', b.processed_at,
           'created_by_name', private.org_member_name(b.organization_id, b.created_by)) order by b.created_at desc), '[]'::jsonb)
    from (select * from public.import_batches b
           where b.organization_id = p_organization_id and b.type in ('maintenance', 'maintenance_catalog')
             and private.has_permission(p_organization_id, 'maintenance.import')
           order by b.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 200)) b;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['private.maintenance_norm(text)', 'private.maintenance_import_date(text)', 'private.maintenance_import_time(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public.stage_maintenance_import(uuid, jsonb)', 'public.process_maintenance_import(uuid, uuid, integer)',
    'public.cancel_maintenance_import(uuid, uuid)', 'public.maintenance_import_history(uuid, integer)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
