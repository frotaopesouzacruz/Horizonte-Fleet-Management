-- =============================================================================
-- Gestão de MTSR — vistorias de campo (app Vistoria MTSR) e validação
--
--   App (permissão applications.mtsr.execute): contexto, veículos elegíveis
--   (Aplicativos: operação + tipo de equipamento habilitados, escopo da pessoa),
--   envio idempotente com itens OK/NOK + evidências (bucket privado), minhas
--   vistorias.
--   Portal (mtsr.inspection.*): fila de recebidas, detalhe, validar (torna
--   oficial SÓ os componentes de campo presentes; nunca sobrescreve componente
--   de backoffice; avança a última vistoria válida, nunca retrocede), retornar e
--   rejeitar com motivo. Retenção de evidências parametrizada.
-- =============================================================================

create or replace function private.mtsr_app(p_organization_id uuid)
returns public.operational_apps
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.operational_apps a
   where a.organization_id = p_organization_id and a.code = 'vistoria_mtsr' and a.deleted_at is null
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 1. App: contexto
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_inspection_context(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_app public.operational_apps; v_actor record; v_today date := private.maintenance_today(p_organization_id);
begin
  if not private.has_permission(p_organization_id, 'applications.mtsr.execute') then
    raise exception 'Sem permissão para executar a Vistoria MTSR.' using errcode = 'insufficient_privilege';
  end if;
  v_app := private.mtsr_app(p_organization_id);
  select * into v_actor from private.checklist_actor(p_organization_id);
  return jsonb_build_object(
    'available', v_app.id is not null and v_app.is_active,
    'reason', case when v_app.id is null then 'nao_cadastrado' when not v_app.is_active then 'inativo' else null end,
    'today', v_today,
    'app', case when v_app.id is null then null else jsonb_build_object('id', v_app.id, 'name', v_app.name, 'slug', v_app.slug, 'allows_attachments', v_app.allows_attachments) end,
    'actor', jsonb_build_object('user_id', auth.uid(), 'employee_id', v_actor.employee_id,
                                'name', coalesce(v_actor.employee_name, private.org_member_name(p_organization_id, auth.uid())),
                                'employee_code', v_actor.employee_code),
    'components', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'description', c.description,
                              'evidence_required_when_ok', c.evidence_required_when_ok, 'evidence_required_when_nok', c.evidence_required_when_nok,
                              'observation_required_when_nok', c.observation_required_when_nok) order by c.sort_order)
                            from public.mtsr_components c where c.organization_id = p_organization_id and c.is_active and c.verification_mode = 'field'), '[]'::jsonb),
    'backoffice_components', coalesce((select jsonb_agg(c.name order by c.sort_order) from public.mtsr_components c
                                        where c.organization_id = p_organization_id and c.is_active and c.verification_mode = 'backoffice'), '[]'::jsonb),
    'evidence', jsonb_build_object('bucket', 'mtsr-evidence', 'max_bytes', 10485760, 'mime_types', jsonb_build_array('image/jpeg', 'image/png', 'image/webp'), 'max_per_item', 6));
end;
$$;
revoke execute on function public.mtsr_inspection_context(uuid) from public, anon;
grant  execute on function public.mtsr_inspection_context(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. App: veículos elegíveis (escopo + elegibilidade do aplicativo, no servidor)
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_inspection_vehicles(p_organization_id uuid, p_search text default null, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app   public.operational_apps;
  v_today date := coalesce(p_date, private.maintenance_today(p_organization_id));
  v_ids   uuid[];
  v_search text := nullif(btrim(p_search), '');
begin
  if not private.has_permission(p_organization_id, 'applications.mtsr.execute') then
    raise exception 'Sem permissão para executar a Vistoria MTSR.' using errcode = 'insufficient_privilege';
  end if;
  v_app := private.mtsr_app(p_organization_id);
  if v_app.id is null or not v_app.is_active then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'today', v_today);
  end if;
  select coalesce(array_agg(v.id), '{}') into v_ids
    from public.vehicles v
   where v.organization_id = p_organization_id and v.deleted_at is null and v.status = 'active'
     and private.vehicle_in_scope(p_organization_id, v.id)
     and (v_search is null or v.license_plate like '%' || private.normalize_plate(v_search) || '%'
          or upper(coalesce(v.fleet_code, '')) like '%' || upper(v_search) || '%');
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('vehicles', '[]'::jsonb, 'today', v_today);
  end if;
  return jsonb_build_object('today', v_today, 'vehicles', coalesce((
    with ctx as (select * from private.km_context_pairs(p_organization_id, v_ids, array_fill(v_today, array[cardinality(v_ids)]))),
    ev as (select * from private.mtsr_vehicle_eval(p_organization_id, v_today) e where e.vehicle_id = any (v_ids))
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'license_plate', v.license_plate, 'fleet_code', v.fleet_code,
             'vehicle_type_id', v.vehicle_type_id, 'vehicle_type_name', vt.name,
             'operation_id', c.operation_id, 'operation_name', o.name, 'city_name', ci.name, 'state_uf', s.uf::text,
             'br_code', b.code, 'leader_name', le.full_name,
             'last_valid_inspection_date', e.last_valid_inspection_date, 'deadline_status', e.deadline_status, 'days_since', e.days_since,
             'nok_count', e.nok_count, 'conformity_status', e.conformity_status,
             'pending_inspection', exists (select 1 from public.mtsr_inspections i where i.vehicle_id = v.id and i.status = 'pendente_validacao'))
           order by vt.name nulls last, v.license_plate)
      from public.vehicles v
      join ctx c on c.vehicle_id = v.id
      join ev e on e.vehicle_id = v.id
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
      left join public.operations o on o.id = c.operation_id
      left join public.cities ci on ci.id = c.city_id
      left join public.states s on s.id = c.state_id
      left join public.operation_brs b on b.id = c.operation_br_id
      left join public.employees le on le.id = c.leader_employee_id
     where c.operation_id is not null
       and private.can_access_operation(c.operation_id)
       and private.app_vehicle_eligible(p_organization_id, v_app.id, v.id, c.operation_id, v_today)), '[]'::jsonb));
end;
$$;
revoke execute on function public.mtsr_inspection_vehicles(uuid, text, date) from public, anon;
grant  execute on function public.mtsr_inspection_vehicles(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. App: envio (idempotente; não altera o estado oficial)
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_inspection_submit(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app        public.operational_apps;
  v_sub        uuid := nullif(p_payload ->> 'client_submission_id', '')::uuid;
  v_vehicle    record;
  v_existing   public.mtsr_inspections;
  v_ctx        jsonb;
  v_actor      record;
  v_today      date := private.maintenance_today(p_organization_id);
  v_at         timestamptz := coalesce(nullif(p_payload ->> 'inspected_at', '')::timestamptz, now());
  v_date       date;
  v_id         uuid;
  v_protocol   text;
  v_item       jsonb;
  v_ev         jsonb;
  v_comp       public.mtsr_components;
  v_item_id    uuid;
  v_status     text;
  v_obs        text;
  v_n_items    integer := 0;
  v_n_nok      integer := 0;
  v_n_ev       integer := 0;
  v_ev_count   integer;
  v_prefix     text;
  v_field_ids  uuid[];
  v_given_ids  uuid[] := '{}';
begin
  if not private.has_permission(p_organization_id, 'applications.mtsr.execute') then
    raise exception 'Sem permissão para executar a Vistoria MTSR.' using errcode = 'insufficient_privilege';
  end if;
  if v_sub is null then
    raise exception 'Identificador do envio ausente.' using errcode = 'invalid_parameter_value';
  end if;
  select i.* into v_existing from public.mtsr_inspections i where i.organization_id = p_organization_id and i.client_submission_id = v_sub;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'protocol', v_existing.protocol, 'submitted_at', v_existing.submitted_at,
                              'item_count', v_existing.item_count, 'nok_count', v_existing.nok_count, 'duplicate', true);
  end if;

  v_app := private.mtsr_app(p_organization_id);
  if v_app.id is null or not v_app.is_active then
    raise exception 'O aplicativo Vistoria MTSR não está disponível nesta organização.' using errcode = 'invalid_parameter_value';
  end if;

  select v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle
    from public.vehicles v where v.id = nullif(p_payload ->> 'vehicle_id', '')::uuid and v.organization_id = p_organization_id;
  if v_vehicle.id is null or v_vehicle.deleted_at is not null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_vehicle.status <> 'active' then
    raise exception 'Frota inativa: a vistoria só é registrada para frotas ativas.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_vehicle.id) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  if v_at > now() + interval '10 minutes' then
    raise exception 'A data da vistoria não pode ser futura.' using errcode = 'invalid_parameter_value';
  end if;
  v_date := (v_at at time zone coalesce((select o.timezone from public.organizations o where o.id = p_organization_id), 'America/Sao_Paulo'))::date;
  if v_date < v_today - 30 then
    raise exception 'A vistoria não pode ter mais de 30 dias.' using errcode = 'invalid_parameter_value';
  end if;

  v_ctx := private.maintenance_context(p_organization_id, v_vehicle.id, v_date);
  if (v_ctx ->> 'operation_id') is null then
    raise exception 'Veículo sem operação vigente na data: não é elegível para a vistoria.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_operation((v_ctx ->> 'operation_id')::uuid) then
    raise exception 'Operação do veículo fora do seu escopo.' using errcode = 'insufficient_privilege';
  end if;
  if not private.app_vehicle_eligible(p_organization_id, v_app.id, v_vehicle.id, (v_ctx ->> 'operation_id')::uuid, v_date) then
    raise exception 'Veículo não elegível para a Vistoria MTSR (operação ou tipo de equipamento não habilitado).' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_actor from private.checklist_actor(p_organization_id);

  select coalesce(array_agg(c.id), '{}') into v_field_ids from public.mtsr_components c
   where c.organization_id = p_organization_id and c.is_active and c.verification_mode = 'field';
  if cardinality(v_field_ids) = 0 then
    raise exception 'Não há componentes de campo ativos no catálogo MTSR.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array' then
    raise exception 'Informe os itens da vistoria.' using errcode = 'invalid_parameter_value';
  end if;

  v_prefix := p_organization_id::text || '/inspections/drafts/' || auth.uid()::text || '/' || v_sub::text || '/';
  v_protocol := private.next_entity_code(p_organization_id, 'mtsr_inspection:' || to_char(v_date, 'YYYY'), 'MTSR-' || to_char(v_date, 'YYYY') || '-', 6);

  insert into public.mtsr_inspections
    (organization_id, protocol, app_id, source, vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id,
     context_date, context_source, operation_id, operation_city_id, state_id, city_id, operation_br_id, fidelization_assignment_id,
     organization_unit_id, leader_employee_id, leadership_assignment_id, operation_name_snapshot, city_name_snapshot, state_uf_snapshot,
     br_code_snapshot, unit_name_snapshot, leader_name_snapshot,
     inspector_user_id, inspector_employee_id, inspector_name_snapshot, inspector_code_snapshot,
     inspection_date, inspected_at, general_observation, client_submission_id)
  values
    (p_organization_id, v_protocol, v_app.id, 'app', v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code, v_vehicle.vehicle_type_id,
     v_date, v_ctx ->> 'source', (v_ctx ->> 'operation_id')::uuid, (v_ctx ->> 'operation_city_id')::uuid, (v_ctx ->> 'state_id')::smallint,
     (v_ctx ->> 'city_id')::integer, (v_ctx ->> 'operation_br_id')::uuid, (v_ctx ->> 'fidelization_assignment_id')::uuid,
     (v_ctx ->> 'organization_unit_id')::uuid, (v_ctx ->> 'leader_employee_id')::uuid, (v_ctx ->> 'leadership_assignment_id')::uuid,
     v_ctx ->> 'operation_name', v_ctx ->> 'city_name', v_ctx ->> 'state_uf', v_ctx ->> 'br_code', v_ctx ->> 'unit_name', v_ctx ->> 'leader_name',
     auth.uid(), v_actor.employee_id, coalesce(v_actor.employee_name, private.org_member_name(p_organization_id, auth.uid())), v_actor.employee_code,
     v_date, v_at, nullif(btrim(p_payload ->> 'general_observation'), ''), v_sub)
  returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    select c.* into v_comp from public.mtsr_components c
     where c.id = nullif(v_item ->> 'component_id', '')::uuid and c.organization_id = p_organization_id;
    if v_comp.id is null or not v_comp.is_active then
      raise exception 'Item com componente inválido.' using errcode = 'invalid_parameter_value';
    end if;
    if v_comp.verification_mode <> 'field' then
      raise exception 'O componente "%" é verificado pelo backoffice e não entra na vistoria de campo.', v_comp.name using errcode = 'invalid_parameter_value';
    end if;
    if v_comp.id = any (v_given_ids) then
      raise exception 'Componente "%" informado mais de uma vez.', v_comp.name using errcode = 'invalid_parameter_value';
    end if;
    v_given_ids := v_given_ids || v_comp.id;
    v_status := lower(coalesce(v_item ->> 'status', ''));
    if v_status not in ('ok', 'nok') then
      raise exception 'Responda OK ou NOK para "%".', v_comp.name using errcode = 'invalid_parameter_value';
    end if;
    v_obs := nullif(btrim(v_item ->> 'observation'), '');
    if v_status = 'nok' and v_comp.observation_required_when_nok and v_obs is null then
      raise exception 'Descreva a inconformidade de "%".', v_comp.name using errcode = 'invalid_parameter_value';
    end if;
    v_ev_count := case when jsonb_typeof(v_item -> 'evidence') = 'array' then jsonb_array_length(v_item -> 'evidence') else 0 end;
    if ((v_status = 'ok' and v_comp.evidence_required_when_ok) or (v_status = 'nok' and v_comp.evidence_required_when_nok)) and v_ev_count = 0 then
      raise exception 'Anexe a foto de "%".', v_comp.name using errcode = 'invalid_parameter_value';
    end if;
    if v_ev_count > 6 then
      raise exception 'No máximo 6 fotos por componente ("%").', v_comp.name using errcode = 'invalid_parameter_value';
    end if;

    insert into public.mtsr_inspection_items (organization_id, inspection_id, component_id, status, observation, evidence_count)
    values (p_organization_id, v_id, v_comp.id, v_status, v_obs, v_ev_count)
    returning id into v_item_id;
    v_n_items := v_n_items + 1;
    if v_status = 'nok' then v_n_nok := v_n_nok + 1; end if;

    if v_ev_count > 0 then
      for v_ev in select value from jsonb_array_elements(v_item -> 'evidence') loop
        if coalesce(v_ev ->> 'storage_path', '') not like v_prefix || '%' then
          raise exception 'Evidência fora da área de envio desta vistoria.' using errcode = 'invalid_parameter_value';
        end if;
        if coalesce(v_ev ->> 'mime_type', '') not in ('image/jpeg', 'image/png', 'image/webp') then
          raise exception 'Formato de foto não aceito (use JPEG, PNG ou WebP).' using errcode = 'invalid_parameter_value';
        end if;
        insert into public.mtsr_inspection_evidence (organization_id, inspection_id, item_id, storage_path, mime_type, size_bytes, sha256, captured_at, uploaded_by)
        values (p_organization_id, v_id, v_item_id, v_ev ->> 'storage_path', v_ev ->> 'mime_type', nullif(v_ev ->> 'size_bytes', '')::integer,
                nullif(v_ev ->> 'sha256', ''), nullif(v_ev ->> 'captured_at', '')::timestamptz, auth.uid());
        v_n_ev := v_n_ev + 1;
      end loop;
    end if;
  end loop;

  if exists (select 1 from unnest(v_field_ids) f where not (f = any (v_given_ids))) then
    raise exception 'Todos os componentes de campo precisam ser respondidos (faltou: %).',
      (select string_agg(c.name, ', ' order by c.sort_order) from public.mtsr_components c where c.id = any (v_field_ids) and not (c.id = any (v_given_ids)))
      using errcode = 'invalid_parameter_value';
  end if;

  update public.mtsr_inspections set item_count = v_n_items, nok_count = v_n_nok, evidence_count = v_n_ev where id = v_id;

  insert into public.mtsr_vehicle_facts (organization_id, vehicle_id, last_submission_at)
  values (p_organization_id, v_vehicle.id, now())
  on conflict (vehicle_id) do update set last_submission_at = excluded.last_submission_at, updated_at = now();

  perform private.mtsr_log(p_organization_id, 'VISTORIA_ENVIADA', v_vehicle.id, null,
    jsonb_build_object('protocol', v_protocol, 'item_count', v_n_items, 'nok_count', v_n_nok, 'evidence_count', v_n_ev,
                       'operation_id', v_ctx ->> 'operation_id', 'inspection_date', v_date),
    'user', v_id, null, null, null, null, 'field_inspection');
  perform private.emit_event(p_organization_id, 'mtsr.inspection.submitted', 'mtsr_inspection', v_id,
    jsonb_build_object('protocol', v_protocol, 'vehicle_id', v_vehicle.id, 'nok_count', v_n_nok));

  return jsonb_build_object('id', v_id, 'protocol', v_protocol, 'submitted_at', now(), 'item_count', v_n_items,
                            'nok_count', v_n_nok, 'evidence_count', v_n_ev, 'duplicate', false);
end;
$$;
revoke execute on function public.mtsr_inspection_submit(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_inspection_submit(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Leitura de uma vistoria (detalhe), com regra de acesso
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_inspection_json(p_inspection public.mtsr_inspections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(p_inspection) - 'organization_id'
      || jsonb_build_object(
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', it.id, 'component_id', it.component_id, 'component_code', c.code, 'component_name', c.name,
                       'status', it.status, 'observation', it.observation, 'evidence_count', it.evidence_count,
                       'applied_at', it.applied_at, 'skipped_reason', it.skipped_reason,
                       'official_status', coalesce(s.status, 'sem_informacao'), 'official_reference_date', s.reference_date,
                       'official_source_type', s.source_type, 'awaiting_revalidation', coalesce(s.awaiting_revalidation, false),
                       'maintenance', (select jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status, 'label', private.maintenance_status_label(m.status), 'link_id', l.id)
                                         from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                                        where l.inspection_item_id = it.id and l.status = 'active' order by l.linked_at desc limit 1),
                       'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'bucket_id', e.bucket_id, 'storage_path', e.storage_path,
                                       'mime_type', e.mime_type, 'size_bytes', e.size_bytes, 'captured_at', e.captured_at, 'purged_at', e.purged_at) order by e.created_at)
                                      from public.mtsr_inspection_evidence e where e.item_id = it.id), '[]'::jsonb))
                       order by c.sort_order)
                     from public.mtsr_inspection_items it
                     join public.mtsr_components c on c.id = it.component_id
                     left join public.mtsr_component_status s on s.vehicle_id = p_inspection.vehicle_id and s.component_id = it.component_id
                    where it.inspection_id = p_inspection.id), '[]'::jsonb),
           'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'actor_name', e.actor_name,
                                 'reason', e.reason, 'payload', e.payload, 'occurred_at', e.occurred_at) order by e.occurred_at)
                               from public.mtsr_events e where e.inspection_id = p_inspection.id), '[]'::jsonb),
           'card', private.km_vehicle_card(p_inspection.vehicle_id),
           'days_waiting', case when p_inspection.status = 'pendente_validacao'
                                then extract(day from (now() - p_inspection.submitted_at))::integer else null end);
$$;

create or replace function private.mtsr_inspection_can_review(p_i public.mtsr_inspections)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_i.organization_id, 'mtsr.inspection.review')
     and ((p_i.operation_id is not null and private.can_access_operation(p_i.operation_id))
          or (p_i.operation_id is null and private.vehicle_in_scope(p_i.organization_id, p_i.vehicle_id))
          or private.is_platform_admin()
          or p_i.organization_id in (select private.permitted_org_ids('operations.access_all')));
$$;

create or replace function public.mtsr_inspection_detail(p_organization_id uuid, p_inspection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.mtsr_inspections; v_own boolean; v_review boolean;
begin
  select i.* into v from public.mtsr_inspections i where i.id = p_inspection_id and i.organization_id = p_organization_id;
  if v.id is null then
    raise exception 'Vistoria não encontrada.' using errcode = 'no_data_found';
  end if;
  v_own := v.inspector_user_id = auth.uid() and private.has_permission(p_organization_id, 'applications.mtsr.execute');
  v_review := private.mtsr_inspection_can_review(v);
  if not (v_own or v_review) then
    raise exception 'Sem permissão para ver esta vistoria.' using errcode = 'insufficient_privilege';
  end if;
  return private.mtsr_inspection_json(v) || jsonb_build_object(
    'can_review', v_review,
    'can_validate', v_review and private.has_permission(p_organization_id, 'mtsr.inspection.validate'),
    'can_return', v_review and private.has_permission(p_organization_id, 'mtsr.inspection.return'),
    'can_reject', v_review and private.has_permission(p_organization_id, 'mtsr.inspection.reject'),
    'can_open_maintenance', v_review and private.has_permission(p_organization_id, 'mtsr.maintenance.open') and private.has_permission(p_organization_id, 'maintenance.create'),
    'is_own', v_own);
end;
$$;
revoke execute on function public.mtsr_inspection_detail(uuid, uuid) from public, anon;
grant  execute on function public.mtsr_inspection_detail(uuid, uuid) to authenticated;

-- Minhas vistorias (app)
create or replace function public.mtsr_my_inspections(p_organization_id uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'applications.mtsr.execute') then
    raise exception 'Sem permissão para executar a Vistoria MTSR.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((select jsonb_agg(private.mtsr_inspection_json(i) order by i.submitted_at desc)
                     from (select * from public.mtsr_inspections i0
                            where i0.organization_id = p_organization_id and i0.inspector_user_id = auth.uid()
                            order by i0.submitted_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) i), '[]'::jsonb);
end;
$$;
revoke execute on function public.mtsr_my_inspections(uuid, integer) from public, anon;
grant  execute on function public.mtsr_my_inspections(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Portal: fila de vistorias recebidas
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_inspections_received(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date := private.maintenance_today(p_organization_id);
  p public.mtsr_parameter_sets := private.mtsr_params_at(p_organization_id, private.maintenance_today(p_organization_id));
  f_status text[] := private.jsonb_text_array(p_filters -> 'statuses');
  f_search text := nullif(btrim(p_filters ->> 'search'), '');
  f_ops uuid[] := private.km_uuid_array(p_filters -> 'operation_ids');
  f_types uuid[] := private.km_uuid_array(p_filters -> 'vehicle_type_ids');
  f_insp uuid[] := private.km_uuid_array(p_filters -> 'inspector_ids');
  f_from date := nullif(p_filters ->> 'date_from', '')::date;
  f_to date := nullif(p_filters ->> 'date_to', '')::date;
  f_nok boolean := nullif(p_filters ->> 'nok_only', '')::boolean;
  v_all boolean := private.is_platform_admin() or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_total integer; v_rows jsonb; v_kpis jsonb; v_opts jsonb;
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.inspection.review');
  with scope as (select private.org_vehicle_scope_ids(p_organization_id) as id),
  ops as (select private.accessible_operation_ids() as id),
  visible as (
    select i.* from public.mtsr_inspections i
     where i.organization_id = p_organization_id
       and (v_all or (i.operation_id is not null and i.operation_id in (select id from ops))
            or (i.operation_id is null and i.vehicle_id in (select id from scope)))),
  base as (
    select i.* from visible i
     where (f_status is null or cardinality(f_status) = 0 or i.status = any (f_status))
       and (f_ops is null or cardinality(f_ops) = 0 or i.operation_id = any (f_ops))
       and (f_types is null or cardinality(f_types) = 0 or i.vehicle_type_id = any (f_types))
       and (f_insp is null or cardinality(f_insp) = 0 or i.inspector_user_id = any (f_insp))
       and (f_from is null or i.inspection_date >= f_from)
       and (f_to is null or i.inspection_date <= f_to)
       and (f_nok is null or not f_nok or i.nok_count > 0)
       and (f_search is null or i.license_plate_snapshot like '%' || private.normalize_plate(f_search) || '%'
            or upper(coalesce(i.fleet_code_snapshot, '')) like '%' || upper(f_search) || '%'
            or upper(i.protocol) like '%' || upper(f_search) || '%'
            or upper(coalesce(i.inspector_name_snapshot, '')) like '%' || upper(f_search) || '%'))
  select count(*),
         coalesce((select jsonb_agg((to_jsonb(b) - 'organization_id') || jsonb_build_object(
                     'days_waiting', case when b.status = 'pendente_validacao' then extract(day from (now() - b.submitted_at))::integer else null end,
                     'over_sla', b.status = 'pendente_validacao' and b.submitted_at < now() - (p.review_sla_days || ' days')::interval,
                     'vehicle_type_name', (select vt.name from public.vehicle_types vt where vt.id = b.vehicle_type_id))
                     order by case b.status when 'pendente_validacao' then 0 else 1 end, b.submitted_at desc)
                   from (select * from base order by case status when 'pendente_validacao' then 0 else 1 end, submitted_at desc limit v_limit offset v_offset) b), '[]'::jsonb),
         (select jsonb_build_object(
            'pendentes', count(*) filter (where v.status = 'pendente_validacao'),
            'com_nok', count(*) filter (where v.status = 'pendente_validacao' and v.nok_count > 0),
            'validadas', count(*) filter (where v.status = 'validada'),
            'retornadas', count(*) filter (where v.status = 'retornada'),
            'rejeitadas', count(*) filter (where v.status = 'rejeitada'),
            'acima_sla', count(*) filter (where v.status = 'pendente_validacao' and v.submitted_at < now() - (p.review_sla_days || ' days')::interval),
            'espera_media_dias', round(avg(extract(epoch from (now() - v.submitted_at)) / 86400.0) filter (where v.status = 'pendente_validacao')::numeric, 1),
            'validacao_media_horas', round(avg(extract(epoch from (v.reviewed_at - v.submitted_at)) / 3600.0) filter (where v.reviewed_at is not null and v.submitted_at >= now() - interval '90 days')::numeric, 1),
            'ultimos_30d', count(*) filter (where v.submitted_at >= now() - interval '30 days'))
            from visible v),
         (select jsonb_build_object(
            'inspectors', coalesce((select jsonb_agg(jsonb_build_object('id', x.inspector_user_id, 'name', x.inspector_name_snapshot) order by x.inspector_name_snapshot)
                                     from (select distinct v.inspector_user_id, v.inspector_name_snapshot from visible v) x), '[]'::jsonb),
            'operations', coalesce((select jsonb_agg(jsonb_build_object('id', x.operation_id, 'name', x.operation_name_snapshot) order by x.operation_name_snapshot)
                                     from (select distinct v.operation_id, v.operation_name_snapshot from visible v where v.operation_id is not null) x), '[]'::jsonb)))
    into v_total, v_rows, v_kpis, v_opts
    from base;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'kpis', v_kpis, 'options', v_opts, 'limit', v_limit, 'offset', v_offset, 'today', v_today,
                            'review_sla_days', p.review_sla_days);
end;
$$;
revoke execute on function public.mtsr_inspections_received(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.mtsr_inspections_received(uuid, jsonb, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Portal: validar / retornar / rejeitar
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_inspection_lock(p_organization_id uuid, p_inspection_id uuid, p_permission text)
returns public.mtsr_inspections
language plpgsql
security definer
set search_path = ''
as $$
declare v public.mtsr_inspections;
begin
  if auth.uid() is null then
    raise exception 'Sessão não identificada.' using errcode = 'insufficient_privilege';
  end if;
  select i.* into v from public.mtsr_inspections i where i.id = p_inspection_id and i.organization_id = p_organization_id for update;
  if v.id is null then
    raise exception 'Vistoria não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.mtsr_inspection_can_review(v) or not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Sem permissão para esta ação na vistoria.' using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$$;

create or replace function public.mtsr_inspection_validate(p_organization_id uuid, p_inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.mtsr_inspections;
  it       record;
  v_res    jsonb;
  v_apl    integer := 0;
  v_skp    integer := 0;
  v_stale  integer := 0;
  v_chg    integer := 0;
  v_nok    integer := 0;
  v_facts  public.mtsr_vehicle_facts;
  v_adv    boolean := false;
  v_cur_ref date;
begin
  v := private.mtsr_inspection_lock(p_organization_id, p_inspection_id, 'mtsr.inspection.validate');
  if v.status = 'validada' then
    return jsonb_build_object('id', v.id, 'protocol', v.protocol, 'already_validated', true, 'applied', 0, 'skipped', 0);
  end if;
  if v.status <> 'pendente_validacao' then
    raise exception 'Só vistorias pendentes de validação podem ser validadas (status atual: %).', v.status using errcode = 'invalid_parameter_value';
  end if;

  for it in
    select i.*, c.verification_mode, c.is_active, c.name as component_name
      from public.mtsr_inspection_items i join public.mtsr_components c on c.id = i.component_id
     where i.inspection_id = v.id order by c.sort_order
  loop
    if it.verification_mode <> 'field' then
      -- Uma vistoria de campo NUNCA sobrescreve componente configurado como backoffice.
      update public.mtsr_inspection_items set skipped_reason = 'backoffice' where id = it.id;
      v_skp := v_skp + 1;
      continue;
    end if;
    -- O estado oficial reflete a leitura mais recente: uma vistoria mais antiga que a
    -- referência atual do componente é registrada, mas não sobrescreve (stale).
    select s.reference_date into v_cur_ref from public.mtsr_component_status s
     where s.vehicle_id = v.vehicle_id and s.component_id = it.component_id;
    if v_cur_ref is not null and v_cur_ref > v.inspection_date then
      update public.mtsr_inspection_items set skipped_reason = 'stale' where id = it.id;
      v_stale := v_stale + 1;
      continue;
    end if;
    v_res := private.mtsr_apply_status(p_organization_id, v.vehicle_id, it.component_id, it.status, v.inspection_date,
      'field_inspection', 'Vistoria MTSR', null, null, v.id, it.id, it.observation, null, 'user');
    update public.mtsr_inspection_items set applied_at = now(), applied_history_id = (v_res ->> 'history_id')::uuid where id = it.id;
    v_apl := v_apl + 1;
    if (v_res ->> 'changed')::boolean then v_chg := v_chg + 1; end if;
    if it.status = 'nok' then v_nok := v_nok + 1; end if;
  end loop;

  -- Última vistoria válida avança, nunca retrocede.
  select f.* into v_facts from public.mtsr_vehicle_facts f where f.vehicle_id = v.vehicle_id;
  if v_facts.vehicle_id is null or v_facts.last_valid_inspection_date is null or v_facts.last_valid_inspection_date < v.inspection_date then
    v_adv := true;
    insert into public.mtsr_vehicle_facts (organization_id, vehicle_id, last_valid_inspection_date, last_valid_inspection_id, last_valid_source)
    values (p_organization_id, v.vehicle_id, v.inspection_date, v.id, 'field_inspection')
    on conflict (vehicle_id) do update set last_valid_inspection_date = excluded.last_valid_inspection_date,
      last_valid_inspection_id = excluded.last_valid_inspection_id, last_valid_source = excluded.last_valid_source, updated_at = now();
  end if;

  update public.mtsr_inspections
     set status = 'validada', reviewed_by = auth.uid(), reviewed_at = now(),
         reviewer_name_snapshot = private.mtsr_actor_name(p_organization_id), review_reason = null
   where id = v.id;

  perform private.mtsr_log(p_organization_id, 'VISTORIA_VALIDADA', v.vehicle_id, null,
    jsonb_build_object('protocol', v.protocol, 'applied', v_apl, 'skipped_backoffice', v_skp, 'skipped_stale', v_stale, 'changed', v_chg, 'nok', v_nok,
                       'inspection_date', v.inspection_date, 'last_valid_advanced', v_adv),
    'user', v.id, null, null, null, null, 'field_inspection');
  perform private.emit_event(p_organization_id, 'mtsr.inspection.validated', 'mtsr_inspection', v.id,
    jsonb_build_object('protocol', v.protocol, 'vehicle_id', v.vehicle_id, 'nok', v_nok));

  return jsonb_build_object('id', v.id, 'protocol', v.protocol, 'already_validated', false, 'applied', v_apl,
                            'skipped', v_skp, 'skipped_stale', v_stale, 'changed', v_chg, 'nok', v_nok, 'last_valid_advanced', v_adv);
end;
$$;
revoke execute on function public.mtsr_inspection_validate(uuid, uuid) from public, anon;
grant  execute on function public.mtsr_inspection_validate(uuid, uuid) to authenticated;

create or replace function public.mtsr_inspection_return(p_organization_id uuid, p_inspection_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.mtsr_inspections; v_reason text := btrim(coalesce(p_reason, ''));
begin
  v := private.mtsr_inspection_lock(p_organization_id, p_inspection_id, 'mtsr.inspection.return');
  if length(v_reason) < 5 then
    raise exception 'Informe o motivo do retorno (mínimo 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v.status <> 'pendente_validacao' then
    raise exception 'Só vistorias pendentes podem ser retornadas (status atual: %).', v.status using errcode = 'invalid_parameter_value';
  end if;
  update public.mtsr_inspections
     set status = 'retornada', reviewed_by = auth.uid(), reviewed_at = now(),
         reviewer_name_snapshot = private.mtsr_actor_name(p_organization_id), review_reason = v_reason
   where id = v.id;
  perform private.mtsr_log(p_organization_id, 'VISTORIA_RETORNADA', v.vehicle_id, null,
    jsonb_build_object('protocol', v.protocol), 'user', v.id, null, null, null, v_reason, 'field_inspection');
  perform private.emit_event(p_organization_id, 'mtsr.inspection.returned', 'mtsr_inspection', v.id, jsonb_build_object('protocol', v.protocol));
  return jsonb_build_object('id', v.id, 'protocol', v.protocol, 'status', 'retornada');
end;
$$;
revoke execute on function public.mtsr_inspection_return(uuid, uuid, text) from public, anon;
grant  execute on function public.mtsr_inspection_return(uuid, uuid, text) to authenticated;

create or replace function public.mtsr_inspection_reject(p_organization_id uuid, p_inspection_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.mtsr_inspections; v_reason text := btrim(coalesce(p_reason, ''));
begin
  v := private.mtsr_inspection_lock(p_organization_id, p_inspection_id, 'mtsr.inspection.reject');
  if length(v_reason) < 5 then
    raise exception 'Informe o motivo da rejeição (mínimo 5 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v.status not in ('pendente_validacao', 'retornada') then
    raise exception 'Vistorias validadas não podem ser rejeitadas.' using errcode = 'invalid_parameter_value';
  end if;
  update public.mtsr_inspections
     set status = 'rejeitada', reviewed_by = auth.uid(), reviewed_at = now(),
         reviewer_name_snapshot = private.mtsr_actor_name(p_organization_id), review_reason = v_reason
   where id = v.id;
  perform private.mtsr_log(p_organization_id, 'VISTORIA_REJEITADA', v.vehicle_id, null,
    jsonb_build_object('protocol', v.protocol), 'user', v.id, null, null, null, v_reason, 'field_inspection');
  perform private.emit_event(p_organization_id, 'mtsr.inspection.rejected', 'mtsr_inspection', v.id, jsonb_build_object('protocol', v.protocol));
  return jsonb_build_object('id', v.id, 'protocol', v.protocol, 'status', 'rejeitada');
end;
$$;
revoke execute on function public.mtsr_inspection_reject(uuid, uuid, text) from public, anon;
grant  execute on function public.mtsr_inspection_reject(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Retenção de evidências (parametrizada; o servidor apaga os objetos e marca)
-- -----------------------------------------------------------------------------
create or replace function public.mtsr_evidence_purge_candidates(p_organization_id uuid, p_vehicle_id uuid default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  p public.mtsr_parameter_sets := private.mtsr_params_at(p_organization_id, private.maintenance_today(p_organization_id));
begin
  if not (private.has_permission(p_organization_id, 'mtsr.inspection.validate') or private.has_permission(p_organization_id, 'mtsr.parameters.manage')) then
    raise exception 'Sem permissão para aplicar a retenção de evidências.' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'retention_inspections', p.evidence_retention_inspections, 'retention_days', p.evidence_retention_days,
    'candidates', coalesce((
      with ranked as (
        select i.id, i.vehicle_id, i.inspection_date,
               row_number() over (partition by i.vehicle_id order by i.inspection_date desc, i.submitted_at desc, i.inspected_at desc, i.id desc) as rn
          from public.mtsr_inspections i
         where i.organization_id = p_organization_id and i.status in ('validada', 'rejeitada')
           and (p_vehicle_id is null or i.vehicle_id = p_vehicle_id))
      select jsonb_agg(jsonb_build_object('id', e.id, 'inspection_id', e.inspection_id, 'bucket_id', e.bucket_id, 'storage_path', e.storage_path,
                       'reason', case when r.rn > p.evidence_retention_inspections then 'retention_inspections' else 'retention_days' end))
        from (select e0.* from public.mtsr_inspection_evidence e0
                join ranked r0 on r0.id = e0.inspection_id
               where e0.organization_id = p_organization_id and e0.purged_at is null
                 and (r0.rn > p.evidence_retention_inspections
                      or (p.evidence_retention_days is not null and r0.inspection_date < v_today - p.evidence_retention_days))
               order by r0.inspection_date limit least(greatest(coalesce(p_limit, 200), 1), 1000)) e
        join ranked r on r.id = e.inspection_id), '[]'::jsonb));
end;
$$;
revoke execute on function public.mtsr_evidence_purge_candidates(uuid, uuid, integer) from public, anon;
grant  execute on function public.mtsr_evidence_purge_candidates(uuid, uuid, integer) to authenticated;

create or replace function public.mtsr_evidence_mark_purged(p_organization_id uuid, p_ids uuid[], p_reason text default 'retention')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare n integer; r record;
begin
  if not (private.has_permission(p_organization_id, 'mtsr.inspection.validate') or private.has_permission(p_organization_id, 'mtsr.parameters.manage')) then
    raise exception 'Sem permissão para aplicar a retenção de evidências.' using errcode = 'insufficient_privilege';
  end if;
  update public.mtsr_inspection_evidence set purged_at = now(), purge_reason = coalesce(p_reason, 'retention')
   where organization_id = p_organization_id and id = any (coalesce(p_ids, '{}')) and purged_at is null;
  get diagnostics n = row_count;
  for r in select e.inspection_id, i.vehicle_id, count(*) as n from public.mtsr_inspection_evidence e join public.mtsr_inspections i on i.id = e.inspection_id
            where e.id = any (coalesce(p_ids, '{}')) and e.organization_id = p_organization_id group by e.inspection_id, i.vehicle_id loop
    perform private.mtsr_log(p_organization_id, 'EVIDENCIA_EXPURGADA', r.vehicle_id, null,
      jsonb_build_object('count', r.n, 'reason', coalesce(p_reason, 'retention')), 'system', r.inspection_id);
  end loop;
  return jsonb_build_object('purged', n);
end;
$$;
revoke execute on function public.mtsr_evidence_mark_purged(uuid, uuid[], text) from public, anon;
grant  execute on function public.mtsr_evidence_mark_purged(uuid, uuid[], text) to authenticated;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('mtsr_app', 'mtsr_inspection_json', 'mtsr_inspection_can_review', 'mtsr_inspection_lock') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;
