-- =============================================================================
-- Gestão de MTSR — manutenção corporativa (vínculo, abertura de NOK,
-- revalidação) e importação histórica de conformidade
--
--   · Abrir manutenção de um NOK usa a Gestão de Manutenção oficial
--     (private.maintenance_create_internal com origem de sistema "mtsr") e grava
--     o vínculo em mtsr_maintenance_links. Não existe base paralela.
--   · Vincular manutenção existente ao componente (mesmo veículo).
--   · Gatilho em public.maintenances: conclusão → componente AGUARDANDO
--     REVALIDAÇÃO (estado oficial não muda); cancelamento/reabertura refletidos.
--   · Importação de conformidade legada: upload → prévia → normalização →
--     validação → reconciliação → confirmação → ingestão (fonte manual_import,
--     prioridade por componente, idempotente por hash) → auditoria.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Abrir manutenção a partir de um NOK
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_maintenance_open(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle   uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_comp      public.mtsr_components;
  v_item      public.mtsr_inspection_items;
  v_status    public.mtsr_component_status;
  v_eval      record;
  v_services  uuid[];
  v_priority  text;
  v_desc      text;
  v_open      record;
  v_res       jsonb;
  v_link      uuid;
  v_hist      uuid;
  v_payload   jsonb;
begin
  if not private.has_permission(p_organization_id, 'mtsr.maintenance.open') then
    raise exception 'Sem permissão para abrir manutenção a partir do MTSR.' using errcode = 'insufficient_privilege';
  end if;
  perform private.assert_vehicle_access(v_vehicle, 'maintenance.create', true);
  select c.* into v_comp from public.mtsr_components c where c.id = nullif(p_payload ->> 'component_id', '')::uuid and c.organization_id = p_organization_id;
  if v_comp.id is null then
    raise exception 'Componente MTSR não encontrado.' using errcode = 'no_data_found';
  end if;
  if nullif(p_payload ->> 'inspection_item_id', '') is not null then
    select i.* into v_item from public.mtsr_inspection_items i join public.mtsr_inspections x on x.id = i.inspection_id
     where i.id = (p_payload ->> 'inspection_item_id')::uuid and x.vehicle_id = v_vehicle and i.component_id = v_comp.id;
    if v_item.id is null then
      raise exception 'Item de vistoria não corresponde ao veículo/componente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- Uma manutenção aberta por componente: a segunda exige vínculo ou justificativa.
  select m.id, m.code, m.status into v_open
    from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
   where l.vehicle_id = v_vehicle and l.component_id = v_comp.id and l.status = 'active'
     and m.status in ('to_schedule', 'scheduled', 'in_progress')
   order by m.requested_on desc limit 1;
  if v_open.id is not null and length(coalesce(btrim(p_payload ->> 'duplicate_justification'), '')) < 10 then
    raise exception 'Já existe manutenção aberta (%) para % neste veículo.', v_open.code, v_comp.name
      using errcode = 'unique_violation', hint = 'mtsr_duplicate', detail = v_open.id::text;
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_services from jsonb_array_elements_text(coalesce(p_payload -> 'service_ids', '[]'::jsonb)) x;
  if cardinality(v_services) = 0 then
    select coalesce(array_agg(s.service_id), '{}') into v_services from public.mtsr_component_services s
     where s.component_id = v_comp.id and s.is_active and s.is_default;
  end if;
  if cardinality(v_services) = 0 then
    raise exception 'Selecione ao menos um serviço do catálogo de Manutenção para "%".', v_comp.name using errcode = 'invalid_parameter_value';
  end if;

  select e.criticality into v_eval from private.mtsr_vehicle_eval(p_organization_id, null) e where e.vehicle_id = v_vehicle;
  v_priority := coalesce(nullif(p_payload ->> 'priority', ''),
    case coalesce(v_eval.criticality, '') when 'critica' then 'critical' when 'alta' then 'high' when 'media' then 'medium'
      else case v_comp.base_criticality when 'critica' then 'critical' when 'alta' then 'high' when 'media' then 'medium' else 'low' end end);

  select s.* into v_status from public.mtsr_component_status s where s.vehicle_id = v_vehicle and s.component_id = v_comp.id;
  v_desc := coalesce(nullif(btrim(p_payload ->> 'description'), ''),
    left('MTSR · ' || v_comp.name || ' não conforme' || coalesce(' — ' || coalesce(v_item.observation, v_status.observation), ''), 2000));

  v_payload := (p_payload - 'component_id' - 'inspection_item_id' - 'inspection_id' - 'service_ids' - 'priority' - 'description')
    || jsonb_build_object('vehicle_id', v_vehicle, 'maintenance_type_code', coalesce(nullif(p_payload ->> 'maintenance_type_code', ''), 'corrective'),
                          'service_ids', to_jsonb(v_services), 'priority', v_priority, 'description', v_desc);
  v_res := private.maintenance_create_internal(p_organization_id, v_payload, 'mtsr');

  select h.id into v_hist from public.mtsr_component_status_history h
   where h.vehicle_id = v_vehicle and h.component_id = v_comp.id and h.new_status = 'nok' order by h.occurred_at desc limit 1;

  insert into public.mtsr_maintenance_links
    (organization_id, maintenance_id, vehicle_id, component_id, inspection_id, inspection_item_id, source_history_id, link_type,
     maintenance_status_snapshot, reason, linked_by)
  values (p_organization_id, (v_res ->> 'id')::uuid, v_vehicle, v_comp.id, v_item.inspection_id, v_item.id, v_hist, 'opened_from_nok',
          v_res ->> 'status', nullif(btrim(p_payload ->> 'reason'), ''), auth.uid())
  returning id into v_link;

  perform private.mtsr_log(p_organization_id, 'MANUTENCAO_ABERTA', v_vehicle, v_comp.id,
    jsonb_build_object('maintenance_code', v_res ->> 'code', 'priority', v_priority, 'service_ids', to_jsonb(v_services), 'link_id', v_link),
    'user', v_item.inspection_id, (v_res ->> 'id')::uuid, null, v_hist, nullif(btrim(p_payload ->> 'reason'), ''), 'system');
  return v_res || jsonb_build_object('link_id', v_link, 'component_id', v_comp.id);
end;
$$;
revoke execute on function public.mtsr_maintenance_open(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_maintenance_open(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Vincular / desvincular manutenção existente
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_maintenance_link(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m    public.maintenances;
  v_comp public.mtsr_components;
  v_item public.mtsr_inspection_items;
  v_link public.mtsr_maintenance_links;
  v_hist uuid;
begin
  if not private.has_permission(p_organization_id, 'mtsr.maintenance.link') then
    raise exception 'Sem permissão para vincular manutenção ao MTSR.' using errcode = 'insufficient_privilege';
  end if;
  select m.* into v_m from public.maintenances m where m.id = nullif(p_payload ->> 'maintenance_id', '')::uuid and m.organization_id = p_organization_id;
  if v_m.id is null then
    raise exception 'Manutenção não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_m.status = 'cancelled' then
    raise exception 'Manutenção cancelada não pode ser vinculada.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_m.vehicle_id) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  select c.* into v_comp from public.mtsr_components c where c.id = nullif(p_payload ->> 'component_id', '')::uuid and c.organization_id = p_organization_id;
  if v_comp.id is null then
    raise exception 'Componente MTSR não encontrado.' using errcode = 'no_data_found';
  end if;
  if nullif(p_payload ->> 'inspection_item_id', '') is not null then
    select i.* into v_item from public.mtsr_inspection_items i join public.mtsr_inspections x on x.id = i.inspection_id
     where i.id = (p_payload ->> 'inspection_item_id')::uuid and x.vehicle_id = v_m.vehicle_id and i.component_id = v_comp.id;
  end if;
  select h.id into v_hist from public.mtsr_component_status_history h
   where h.vehicle_id = v_m.vehicle_id and h.component_id = v_comp.id and h.new_status = 'nok' order by h.occurred_at desc limit 1;

  insert into public.mtsr_maintenance_links
    (organization_id, maintenance_id, vehicle_id, component_id, inspection_id, inspection_item_id, source_history_id, link_type,
     maintenance_status_snapshot, reason, linked_by, status, revalidation_status)
  values (p_organization_id, v_m.id, v_m.vehicle_id, v_comp.id, v_item.inspection_id, v_item.id, v_hist, 'linked_existing',
          v_m.status, nullif(btrim(p_payload ->> 'reason'), ''), auth.uid(), 'active', 'pending')
  on conflict (maintenance_id, component_id) do update
    set status = 'active', unlinked_by = null, unlinked_at = null, linked_by = auth.uid(), linked_at = now(),
        reason = excluded.reason, inspection_id = coalesce(excluded.inspection_id, public.mtsr_maintenance_links.inspection_id),
        inspection_item_id = coalesce(excluded.inspection_item_id, public.mtsr_maintenance_links.inspection_item_id),
        revalidation_status = case when public.mtsr_maintenance_links.revalidation_status = 'done' then 'done' else 'pending' end
  returning * into v_link;

  perform private.mtsr_log(p_organization_id, 'MANUTENCAO_VINCULADA', v_m.vehicle_id, v_comp.id,
    jsonb_build_object('maintenance_code', v_m.code, 'maintenance_status', v_m.status, 'link_id', v_link.id),
    'user', v_item.inspection_id, v_m.id, null, v_hist, nullif(btrim(p_payload ->> 'reason'), ''), 'system');

  -- Manutenção já concluída: o componente passa a aguardar revalidação.
  if v_m.status = 'completed' and v_link.revalidation_status <> 'done' then
    perform private.mtsr_on_maintenance_completed(v_link, v_m);
  end if;
  return jsonb_build_object('link_id', v_link.id, 'maintenance_id', v_m.id, 'code', v_m.code, 'status', v_m.status);
end;
$$;
revoke execute on function public.mtsr_maintenance_link(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_maintenance_link(uuid, jsonb) to authenticated;

create or replace function public.mtsr_maintenance_unlink(p_organization_id uuid, p_link_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_link public.mtsr_maintenance_links; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.has_permission(p_organization_id, 'mtsr.maintenance.link') then
    raise exception 'Sem permissão para desvincular manutenção.' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) < 5 then
    raise exception 'Informe o motivo (mínimo 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  select l.* into v_link from public.mtsr_maintenance_links l where l.id = p_link_id and l.organization_id = p_organization_id for update;
  if v_link.id is null then raise exception 'Vínculo não encontrado.' using errcode = 'no_data_found'; end if;
  update public.mtsr_maintenance_links set status = 'unlinked', unlinked_by = auth.uid(), unlinked_at = now(), reason = v_reason where id = v_link.id;
  update public.mtsr_component_status
     set awaiting_revalidation = false, awaiting_since = null, awaiting_maintenance_id = null
   where vehicle_id = v_link.vehicle_id and component_id = v_link.component_id and awaiting_maintenance_id = v_link.maintenance_id
     and not exists (select 1 from public.mtsr_maintenance_links o where o.vehicle_id = v_link.vehicle_id and o.component_id = v_link.component_id
                       and o.status = 'active' and o.revalidation_status = 'awaiting' and o.id <> v_link.id);
  perform private.mtsr_log(p_organization_id, 'MANUTENCAO_DESVINCULADA', v_link.vehicle_id, v_link.component_id,
    jsonb_build_object('link_id', v_link.id), 'user', v_link.inspection_id, v_link.maintenance_id, null, null, v_reason, 'system');
  return jsonb_build_object('link_id', v_link.id, 'status', 'unlinked');
end;
$$;
revoke execute on function public.mtsr_maintenance_unlink(uuid, uuid, text) from public, anon;
grant  execute on function public.mtsr_maintenance_unlink(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Reflexo do ciclo de vida da manutenção no MTSR
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_on_maintenance_completed(p_link public.mtsr_maintenance_links, p_m public.maintenances)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mtsr_maintenance_links
     set maintenance_status_snapshot = p_m.status, maintenance_concluded_at = coalesce(maintenance_concluded_at, now()),
         revalidation_status = case when revalidation_status = 'done' then 'done' when requires_revalidation then 'awaiting' else 'not_required' end
   where id = p_link.id;
  if p_link.requires_revalidation and p_link.revalidation_status <> 'done' then
    insert into public.mtsr_component_status (organization_id, vehicle_id, component_id, status)
    values (p_link.organization_id, p_link.vehicle_id, p_link.component_id, 'sem_informacao')
    on conflict (vehicle_id, component_id) do nothing;
    update public.mtsr_component_status
       set awaiting_revalidation = true, awaiting_since = coalesce(awaiting_since, now()), awaiting_maintenance_id = p_m.id
     where vehicle_id = p_link.vehicle_id and component_id = p_link.component_id;
  end if;
  perform private.mtsr_log(p_link.organization_id, 'MANUTENCAO_CONCLUIDA', p_link.vehicle_id, p_link.component_id,
    jsonb_build_object('maintenance_code', p_m.code, 'exit_date', p_m.exit_date, 'requires_revalidation', p_link.requires_revalidation,
                       'note', 'A conformidade do componente permanece inalterada até nova verificação.'),
    'system', p_link.inspection_id, p_m.id, null, null, null, 'system');
end;
$$;

create or replace function private.tg_maintenances_mtsr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare l public.mtsr_maintenance_links;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  for l in select * from public.mtsr_maintenance_links x where x.maintenance_id = new.id and x.status = 'active' loop
    begin
      if new.status = 'completed' then
        perform private.mtsr_on_maintenance_completed(l, new);
      elsif new.status in ('cancelled', 'not_performed') then
        update public.mtsr_maintenance_links set maintenance_status_snapshot = new.status,
               revalidation_status = case when revalidation_status = 'done' then 'done' else 'cancelled' end where id = l.id;
        update public.mtsr_component_status set awaiting_revalidation = false, awaiting_since = null, awaiting_maintenance_id = null
         where vehicle_id = l.vehicle_id and component_id = l.component_id and awaiting_maintenance_id = new.id;
        perform private.mtsr_log(l.organization_id, 'MANUTENCAO_CANCELADA', l.vehicle_id, l.component_id,
          jsonb_build_object('maintenance_code', new.code, 'status', new.status), 'system', l.inspection_id, new.id, null, null, null, 'system');
      elsif old.status = 'completed' and new.status = 'in_progress' then
        update public.mtsr_maintenance_links set maintenance_status_snapshot = new.status, maintenance_concluded_at = null,
               revalidation_status = case when revalidation_status = 'done' then 'done' else 'pending' end where id = l.id;
        update public.mtsr_component_status set awaiting_revalidation = false, awaiting_since = null, awaiting_maintenance_id = null
         where vehicle_id = l.vehicle_id and component_id = l.component_id and awaiting_maintenance_id = new.id;
        perform private.mtsr_log(l.organization_id, 'MANUTENCAO_REABERTA', l.vehicle_id, l.component_id,
          jsonb_build_object('maintenance_code', new.code), 'system', l.inspection_id, new.id, null, null, null, 'system');
      else
        update public.mtsr_maintenance_links set maintenance_status_snapshot = new.status where id = l.id;
      end if;
    exception when others then
      raise warning 'MTSR: falha ao refletir manutenção % (% → %): %', new.code, old.status, new.status, sqlerrm;
    end;
  end loop;
  return new;
end;
$$;

do $t$
begin
  if not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'maintenances' and tg.tgname = 'maintenances_mtsr') then
    create constraint trigger maintenances_mtsr
      after update on public.maintenances
      deferrable initially deferred
      for each row execute function private.tg_maintenances_mtsr();
  end if;
end $t$;

-- Leitura inversa para o drawer de Manutenção
create or replace function public.mtsr_for_maintenance(p_maintenance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_m public.maintenances;
begin
  select m.* into v_m from public.maintenances m where m.id = p_maintenance_id;
  if v_m.id is null then return '{"links":[]}'::jsonb; end if;
  if not private.has_permission(v_m.organization_id, 'maintenance.view') or not private.maintenance_in_scope(v_m.organization_id, v_m.operation_id, v_m.vehicle_id) then
    raise exception 'Sem permissão para esta manutenção.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'can_view_mtsr', private.has_permission(v_m.organization_id, 'mtsr.view'),
    'links', coalesce((select jsonb_agg(jsonb_build_object('link_id', l.id, 'component_id', l.component_id, 'component_name', c.name,
               'link_type', l.link_type, 'revalidation_status', l.revalidation_status, 'maintenance_concluded_at', l.maintenance_concluded_at,
               'revalidated_at', l.revalidated_at, 'inspection_id', l.inspection_id, 'protocol', i.protocol, 'linked_at', l.linked_at,
               'official_status', coalesce(s.status, 'sem_informacao'), 'awaiting_revalidation', coalesce(s.awaiting_revalidation, false)) order by l.linked_at)
      from public.mtsr_maintenance_links l join public.mtsr_components c on c.id = l.component_id
      left join public.mtsr_inspections i on i.id = l.inspection_id
      left join public.mtsr_component_status s on s.vehicle_id = l.vehicle_id and s.component_id = l.component_id
      where l.maintenance_id = p_maintenance_id and l.status = 'active'), '[]'::jsonb));
end;
$$;
revoke execute on function public.mtsr_for_maintenance(uuid) from public, anon;
grant  execute on function public.mtsr_for_maintenance(uuid) to authenticated;

-- Candidatas a vínculo (manutenções do veículo, não canceladas, últimos 180 dias)
create or replace function public.mtsr_maintenance_candidates(p_organization_id uuid, p_vehicle_id uuid, p_component_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'mtsr.maintenance.link') then
    raise exception 'Sem permissão para vincular manutenção.' using errcode = 'insufficient_privilege';
  end if;
  if not private.vehicle_in_scope(p_organization_id, p_vehicle_id) then
    raise exception 'Veículo fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status, 'label', private.maintenance_status_label(m.status),
      'maintenance_type_code', m.maintenance_type_code, 'requested_on', m.requested_on, 'scheduled_date', m.scheduled_date, 'exit_date', m.exit_date,
      'description', m.description, 'services', (select coalesce(jsonb_agg(it.service_name_snapshot order by it.sort_order), '[]'::jsonb) from public.maintenance_items it where it.maintenance_id = m.id and it.status <> 'cancelled'),
      'already_linked', exists (select 1 from public.mtsr_maintenance_links l where l.maintenance_id = m.id and l.status = 'active' and (p_component_id is null or l.component_id = p_component_id)),
      'mapped_service', exists (select 1 from public.maintenance_items it join public.mtsr_component_services cs on cs.service_id = it.service_id
                                 where it.maintenance_id = m.id and (p_component_id is null or cs.component_id = p_component_id)))
      order by case when m.status in ('to_schedule', 'scheduled', 'in_progress') then 0 else 1 end, m.requested_on desc)
    from public.maintenances m
    where m.organization_id = p_organization_id and m.vehicle_id = p_vehicle_id and m.status <> 'cancelled'
      and m.requested_on >= private.maintenance_today(p_organization_id) - 180), '[]'::jsonb);
end;
$$;
revoke execute on function public.mtsr_maintenance_candidates(uuid, uuid, uuid) from public, anon;
grant  execute on function public.mtsr_maintenance_candidates(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Importação histórica de conformidade (staging em lotes)
-- -----------------------------------------------------------------------------
create or replace function public.stage_mtsr_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase   text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit   integer := least(greatest(coalesce(nullif(p_payload ->> 'limit', '')::integer, 500), 1), 5000);
  v_batch   uuid := nullif(p_payload ->> 'batch_id', '')::uuid;
  v_today   date := private.maintenance_today(p_organization_id);
  v_already boolean;
  v_loaded  integer;
  v_pend    record;
  v_plate text; v_fleet text; v_vehicle record; v_date date; v_date_raw text;
  v_comps jsonb; v_norm jsonb; v_unknown_c jsonb; v_unknown_s jsonb; v_n_rec int;
  k text; val text; v_comp public.mtsr_components; v_st text;
  v_level text; v_code text; v_msg text; v_field text; v_status text;
  v_summary jsonb;
begin
  if not private.has_permission(p_organization_id, 'mtsr.import') then
    raise exception 'Sem permissão para importar a conformidade MTSR.' using errcode = 'insufficient_privilege';
  end if;
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;

  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    select exists (select 1 from public.import_batches b where b.organization_id = p_organization_id and b.type = 'mtsr_conformity'
                      and b.status = 'completed' and b.file_hash is not null and b.file_hash = p_payload ->> 'file_hash') into v_already;
    insert into public.import_batches (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values (p_organization_id, 'mtsr_conformity', 'create_update', 'draft', coalesce(nullif(p_payload ->> 'file_name', ''), 'conformidade-mtsr'),
            nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint, coalesce(p_payload -> 'column_mapping', '{}'::jsonb),
            jsonb_build_object('already_imported', coalesce(v_already, false), 'reference_default', coalesce(nullif(p_payload ->> 'reference_default', ''), v_today::text)),
            auth.uid(), auth.uid())
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'mtsr_conformity' and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated')) for update;
    if not found then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch, coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch, 'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  if v_phase in ('all', 'validate') then
    for v_pend in select x.* from public.import_rows x where x.batch_id = v_batch and x.status = 'pending' order by x.row_number limit v_limit loop
      v_plate := private.normalize_plate(coalesce(v_pend.normalized_data ->> 'license_plate', ''));
      v_fleet := nullif(upper(btrim(coalesce(v_pend.normalized_data ->> 'fleet_code', ''))), '');
      v_vehicle := null; v_level := null; v_code := null; v_msg := null; v_field := null;
      select v.id, v.license_plate, v.fleet_code, v.status into v_vehicle from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null
         and ((v_plate <> '' and v.license_plate = v_plate) or (v_plate = '' and v_fleet is not null and upper(v.fleet_code) = v_fleet))
       order by (v.status = 'active') desc limit 1;

      v_date := null; v_date_raw := nullif(btrim(v_pend.normalized_data ->> 'last_inspection_date'), '');
      if v_date_raw is not null then
        begin
          v_date := v_date_raw::date;
        exception when others then
          v_date := null; v_level := 'error'; v_code := 'invalid_date'; v_field := 'last_inspection_date'; v_msg := 'Data da última vistoria inválida.';
        end;
        if v_date is not null and v_date > v_today then
          v_level := 'error'; v_code := 'future_date'; v_field := 'last_inspection_date'; v_msg := 'Data da última vistoria no futuro.';
        end if;
      end if;

      v_comps := coalesce(v_pend.normalized_data -> 'components', '{}'::jsonb);
      v_norm := '{}'::jsonb; v_unknown_c := '[]'::jsonb; v_unknown_s := '[]'::jsonb; v_n_rec := 0;
      for k, val in select key, value #>> '{}' from jsonb_each(v_comps) loop
        v_comp := private.mtsr_resolve_component(p_organization_id, null, k);
        if v_comp.id is null then
          v_unknown_c := v_unknown_c || to_jsonb(k);
          continue;
        end if;
        v_st := private.mtsr_normalize_status(coalesce(val, ''));
        if v_st is null then
          v_unknown_s := v_unknown_s || jsonb_build_object('component', v_comp.code, 'value', val);
          continue;
        end if;
        v_norm := v_norm || jsonb_build_object(v_comp.code, v_st);
        if v_st <> 'sem_informacao' then v_n_rec := v_n_rec + 1; end if;
      end loop;

      if v_vehicle.id is null then
        v_level := 'error'; v_code := 'import_unknown_vehicle'; v_field := 'license_plate';
        v_msg := 'Placa/frota não encontrada no Cadastro de Frotas (a importação nunca cria veículos).';
      elsif v_level is null and v_n_rec = 0 and v_date is null then
        v_level := 'warning'; v_code := 'no_components'; v_msg := 'Linha sem status reconhecido de componente e sem data de vistoria: nada a aplicar.';
      elsif v_level is null and (jsonb_array_length(v_unknown_s) > 0 or jsonb_array_length(v_unknown_c) > 0) then
        v_level := 'warning'; v_code := 'partial'; v_field := null;
        v_msg := 'Alguns valores não reconhecidos foram ignorados: ' || coalesce((select string_agg(x ->> 'component' || '=' || coalesce(x ->> 'value', ''), ', ') from jsonb_array_elements(v_unknown_s) x), '')
                 || case when jsonb_array_length(v_unknown_c) > 0 then ' · colunas desconhecidas: ' || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(v_unknown_c) x) else '' end;
      end if;

      v_status := case when v_level = 'error' then 'error' when v_level = 'warning' then 'warning' else 'valid' end;
      update public.import_rows set
        status = v_status,
        action = case when v_status = 'error' then 'skip' else 'update' end,
        normalized_data = normalized_data || jsonb_build_object('vehicle_id', v_vehicle.id, 'license_plate_found', v_vehicle.license_plate,
          'fleet_code_found', v_vehicle.fleet_code, 'vehicle_status', v_vehicle.status, 'last_inspection_date', v_date,
          'components_normalized', v_norm, 'recognized', v_n_rec, 'unknown_components', v_unknown_c, 'unknown_statuses', v_unknown_s, 'code', v_code)
      where id = v_pend.id;
      if v_msg is not null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, v_batch, v_pend.row_number, v_level, v_field, v_code, v_msg);
      end if;
    end loop;
    if v_phase = 'validate' then
      return jsonb_build_object('batch_id', v_batch,
        'remaining', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'),
        'validated', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending'));
    end if;
  end if;

  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas por validar nesta importação.' using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
      'total_rows', count(*),
      'valid_rows', count(*) filter (where x.status = 'valid'),
      'warning_rows', count(*) filter (where x.status = 'warning'),
      'error_rows', count(*) filter (where x.status = 'error'),
      'vehicles', count(distinct x.normalized_data ->> 'vehicle_id') filter (where x.status in ('valid', 'warning')),
      'with_last_inspection', count(*) filter (where x.status in ('valid', 'warning') and x.normalized_data ->> 'last_inspection_date' is not null),
      'cells', coalesce(sum((x.normalized_data ->> 'recognized')::int) filter (where x.status in ('valid', 'warning')), 0),
      'date_from', min((x.normalized_data ->> 'last_inspection_date')::date), 'date_to', max((x.normalized_data ->> 'last_inspection_date')::date),
      'by_component', (select coalesce(jsonb_object_agg(c.code, jsonb_build_object('name', c.name, 'ok', s.ok, 'nok', s.nok, 'sem_informacao', s.sem)), '{}'::jsonb)
                         from public.mtsr_components c
                         cross join lateral (select count(*) filter (where y.normalized_data -> 'components_normalized' ->> c.code = 'ok') ok,
                                                    count(*) filter (where y.normalized_data -> 'components_normalized' ->> c.code = 'nok') nok,
                                                    count(*) filter (where y.normalized_data -> 'components_normalized' ->> c.code = 'sem_informacao') sem
                                               from public.import_rows y where y.batch_id = v_batch and y.status in ('valid', 'warning')) s
                        where c.organization_id = p_organization_id and c.is_active),
      'unknown_plates', (select coalesce(jsonb_agg(distinct coalesce(nullif(y.normalized_data ->> 'license_plate', ''), y.normalized_data ->> 'fleet_code')), '[]'::jsonb)
                           from public.import_rows y where y.batch_id = v_batch and y.normalized_data ->> 'code' = 'import_unknown_vehicle'),
      'findings', (select coalesce(jsonb_agg(jsonb_build_object('row', e.row_number, 'level', e.level, 'code', e.code, 'message', e.message) order by e.level, e.row_number), '[]'::jsonb)
                     from (select * from public.import_errors z where z.batch_id = v_batch order by (z.level = 'error') desc, z.row_number limit 60) e),
      'sample', (select coalesce(jsonb_agg(jsonb_build_object('row', y.row_number, 'status', y.status, 'license_plate', coalesce(y.normalized_data ->> 'license_plate_found', y.normalized_data ->> 'license_plate'),
                           'fleet_code', coalesce(y.normalized_data ->> 'fleet_code_found', y.normalized_data ->> 'fleet_code'), 'last_inspection_date', y.normalized_data ->> 'last_inspection_date',
                           'components', y.normalized_data -> 'components_normalized', 'code', y.normalized_data ->> 'code') order by y.row_number), '[]'::jsonb)
                   from (select * from public.import_rows z where z.batch_id = v_batch order by z.row_number limit 25) y))
    into v_summary
    from public.import_rows x where x.batch_id = v_batch;

  update public.import_batches b
     set status = 'validated', total_rows = (v_summary ->> 'total_rows')::int, valid_rows = (v_summary ->> 'valid_rows')::int,
         warning_rows = (v_summary ->> 'warning_rows')::int, error_rows = (v_summary ->> 'error_rows')::int,
         summary = coalesce(b.summary, '{}'::jsonb) || (v_summary - 'findings' - 'sample' - 'unknown_plates'),
         updated_at = now(), updated_by = auth.uid()
   where b.id = v_batch;

  return v_summary || jsonb_build_object('batch_id', v_batch,
    'already_imported', (select coalesce((b.summary ->> 'already_imported')::boolean, false) from public.import_batches b where b.id = v_batch),
    'reference_default', (select b.summary ->> 'reference_default' from public.import_batches b where b.id = v_batch));
end;
$$;
revoke execute on function public.stage_mtsr_import(uuid, jsonb) from public, anon;
grant  execute on function public.stage_mtsr_import(uuid, jsonb) to authenticated;

create or replace function public.process_mtsr_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch  record;
  v_source public.mtsr_ingestion_sources;
  x        public.import_rows;
  k text; v_st text; v_comp public.mtsr_components; v_res jsonb; v_date date; v_ref date;
  n_applied int := 0; n_ignored int := 0; n_conflict int := 0; n_rejected int := 0; n_dup int := 0; n_rows int := 0; n_facts int := 0;
  v_row_applied int; v_left int; v_stats jsonb; v_limit int := least(greatest(coalesce(p_limit, 200), 1), 2000);
begin
  if not private.has_permission(p_organization_id, 'mtsr.import') then
    raise exception 'Sem permissão para importar a conformidade MTSR.' using errcode = 'insufficient_privilege';
  end if;
  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type = 'mtsr_conformity' for update;
  if v_batch.id is null then raise exception 'Importação não encontrada.' using errcode = 'no_data_found'; end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  select s.* into v_source from public.mtsr_ingestion_sources s where s.organization_id = p_organization_id and s.code = 'manual_import';
  if v_source.id is null then raise exception 'Fonte manual_import não cadastrada.' using errcode = 'no_data_found'; end if;
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid(),
           summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('stats', jsonb_build_object('applied', 0, 'ignored', 0, 'conflict', 0, 'rejected', 0, 'duplicate', 0, 'rows', 0, 'facts', 0))
     where id = p_batch_id;
    select b.* into v_batch from public.import_batches b where b.id = p_batch_id;
  end if;
  v_ref := coalesce(nullif(v_batch.summary ->> 'reference_default', '')::date, private.maintenance_today(p_organization_id));

  for x in select r.* from public.import_rows r where r.batch_id = p_batch_id and r.status in ('valid', 'warning') order by r.row_number limit v_limit loop
    begin
      v_row_applied := 0;
      v_date := nullif(x.normalized_data ->> 'last_inspection_date', '')::date;
      for k, v_st in select key, value #>> '{}' from jsonb_each(coalesce(x.normalized_data -> 'components_normalized', '{}'::jsonb)) loop
        v_comp := private.mtsr_resolve_component(p_organization_id, null, k);
        if v_comp.id is null then continue; end if;
        v_res := private.mtsr_ingest_one(p_organization_id, v_source,
          jsonb_build_object('vehicle_id', x.normalized_data ->> 'vehicle_id', 'component_id', v_comp.id, 'status', v_st,
                             'reference_date', coalesce(v_date, v_ref)::text, 'observation', nullif(btrim(x.normalized_data ->> 'observation'), ''),
                             'source_record_id', p_batch_id::text || ':' || x.row_number, 'source_system', coalesce(v_batch.file_name, 'planilha'),
                             'raw', x.raw_data),
          p_batch_id, 'import', false, 'IMPORTACAO');
        if (v_res ->> 'duplicate')::boolean then n_dup := n_dup + 1;
        elsif v_res ->> 'outcome' = 'applied' then n_applied := n_applied + 1; v_row_applied := v_row_applied + 1;
        elsif v_res ->> 'outcome' = 'ignored' then n_ignored := n_ignored + 1;
        elsif v_res ->> 'outcome' = 'conflict' then n_conflict := n_conflict + 1;
        else n_rejected := n_rejected + 1; end if;
      end loop;
      if v_date is not null then
        insert into public.mtsr_vehicle_facts (organization_id, vehicle_id, last_valid_inspection_date, last_valid_source)
        values (p_organization_id, (x.normalized_data ->> 'vehicle_id')::uuid, v_date, 'manual_import')
        on conflict (vehicle_id) do update
          set last_valid_inspection_date = greatest(public.mtsr_vehicle_facts.last_valid_inspection_date, excluded.last_valid_inspection_date),
              last_valid_source = case when public.mtsr_vehicle_facts.last_valid_inspection_date is null or public.mtsr_vehicle_facts.last_valid_inspection_date < excluded.last_valid_inspection_date
                                       then 'manual_import' else public.mtsr_vehicle_facts.last_valid_source end,
              updated_at = now();
        n_facts := n_facts + 1;
      end if;
      update public.import_rows set status = case when v_row_applied > 0 or v_date is not null then 'updated' else 'skipped' end,
             action = case when v_row_applied > 0 or v_date is not null then 'update' else 'skip' end where id = x.id;
      n_rows := n_rows + 1;
    exception when others then
      update public.import_rows set status = 'failed', action = 'skip', normalized_data = normalized_data || jsonb_build_object('code', 'failed') where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'failed', left(sqlerrm, 500));
      n_rows := n_rows + 1;
    end;
  end loop;

  v_stats := coalesce(v_batch.summary -> 'stats', '{}'::jsonb);
  v_stats := jsonb_build_object(
    'applied', coalesce((v_stats ->> 'applied')::int, 0) + n_applied, 'ignored', coalesce((v_stats ->> 'ignored')::int, 0) + n_ignored,
    'conflict', coalesce((v_stats ->> 'conflict')::int, 0) + n_conflict, 'rejected', coalesce((v_stats ->> 'rejected')::int, 0) + n_rejected,
    'duplicate', coalesce((v_stats ->> 'duplicate')::int, 0) + n_dup, 'rows', coalesce((v_stats ->> 'rows')::int, 0) + n_rows,
    'facts', coalesce((v_stats ->> 'facts')::int, 0) + n_facts);
  select count(*) into v_left from public.import_rows r where r.batch_id = p_batch_id and r.status in ('valid', 'warning');

  update public.import_batches b
     set summary = coalesce(b.summary, '{}'::jsonb) || jsonb_build_object('stats', v_stats),
         updated_rows = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'updated'),
         skipped_rows = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status in ('skipped', 'error', 'failed')),
         status = case when v_left = 0 then 'completed' else 'processing' end,
         processed_at = case when v_left = 0 then now() else processed_at end,
         updated_at = now(), updated_by = auth.uid()
   where b.id = p_batch_id;

  if v_left = 0 then
    perform private.mtsr_log(p_organization_id, 'IMPORTACAO', null, null,
      jsonb_build_object('batch_id', p_batch_id, 'file_name', v_batch.file_name) || v_stats, 'import', null, null, null, null, null, 'manual_import');
  end if;
  return jsonb_build_object('done', v_left = 0, 'remaining', v_left, 'processed', n_rows, 'stats', v_stats);
end;
$$;
revoke execute on function public.process_mtsr_import(uuid, uuid, integer) from public, anon;
grant  execute on function public.process_mtsr_import(uuid, uuid, integer) to authenticated;

create or replace function public.mtsr_import_history(p_organization_id uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (private.has_permission(p_organization_id, 'mtsr.import') or private.has_permission(p_organization_id, 'mtsr.audit.view')) then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'file_name', b.file_name, 'status', b.status, 'total_rows', b.total_rows, 'valid_rows', b.valid_rows,
        'warning_rows', b.warning_rows, 'error_rows', b.error_rows, 'updated_rows', b.updated_rows, 'skipped_rows', b.skipped_rows,
        'summary', b.summary, 'error_message', b.error_message, 'created_at', b.created_at, 'processed_at', b.processed_at,
        'created_by_name', (select p.full_name from public.profiles p where p.user_id = b.created_by),
        'errors', coalesce((select jsonb_agg(jsonb_build_object('row', e.row_number, 'level', e.level, 'message', e.message) order by e.row_number)
                             from (select * from public.import_errors x where x.batch_id = b.id order by x.row_number limit 50) e), '[]'::jsonb))
        order by b.created_at desc)
      from (select * from public.import_batches x where x.organization_id = p_organization_id and x.type = 'mtsr_conformity'
             order by x.created_at desc limit greatest(coalesce(p_limit, 20), 1)) b), '[]'::jsonb)
  end;
$$;
revoke execute on function public.mtsr_import_history(uuid, integer) from public, anon;
grant  execute on function public.mtsr_import_history(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Exportação auditada (registro antes de o arquivo sair)
-- -----------------------------------------------------------------------------
create or replace function public.log_mtsr_export(
  p_organization_id uuid, p_kind text, p_format text, p_row_count integer, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'mtsr.export') then
    raise exception 'Você não possui permissão para exportar MTSR.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, (select auth.uid()), 'mtsr_export', null, 'EXPORT',
          jsonb_build_object('kind', p_kind, 'format', p_format, 'row_count', p_row_count, 'filters', coalesce(p_filters, '{}'::jsonb)));
  perform private.mtsr_log(p_organization_id, 'EXPORTACAO', null, null,
    jsonb_build_object('kind', p_kind, 'format', p_format, 'row_count', p_row_count, 'filters', coalesce(p_filters, '{}'::jsonb)));
end;
$$;
revoke all on function public.log_mtsr_export(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.log_mtsr_export(uuid, text, text, integer, jsonb) to authenticated;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('mtsr_on_maintenance_completed', 'tg_maintenances_mtsr') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;
