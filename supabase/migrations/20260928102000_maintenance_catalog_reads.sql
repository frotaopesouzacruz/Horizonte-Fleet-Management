-- =============================================================================
-- Etapa 16 — Manutenção: catálogo (escrita) e leituras do módulo
--
-- Catálogo: clusters, serviços, fornecedores, vínculo Serviço × Check List,
-- origens da organização e configurações — tudo por RPC, com permissão
-- própria (maintenance.manage_*) e sem exclusão física do que já foi usado.
--
-- Leituras: um único filtro (private.maintenance_filtered) alimenta a Base
-- Geral, a Programação, a hierarquia, a exportação e os indicadores, e roda
-- como SECURITY INVOKER — o escopo é o da RLS, igual para todas as telas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.jsonb_uuid_array(p_value jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then null
              else (select array_agg(x::uuid) from jsonb_array_elements_text(p_value) x) end;
$$;

create or replace function private.jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then null
              else (select array_agg(x) from jsonb_array_elements_text(p_value) x) end;
$$;

create or replace function private.jsonb_int_array(p_value jsonb)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then null
              else (select array_agg(x::integer) from jsonb_array_elements_text(p_value) x) end;
$$;

-- Leituras em SECURITY INVOKER não alcançam vehicles/organizations (o papel
-- authenticated lê a frota pelas views e RPCs dela). Estes dois auxiliares
-- respondem só o necessário, sem abrir as tabelas.
create or replace function private.maintenance_vehicle_active(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vehicles v where v.id = p_vehicle_id and v.status = 'active' and v.deleted_at is null);
$$;

create or replace function private.maintenance_vehicle_org(p_vehicle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.organization_id from public.vehicles v
   where v.id = p_vehicle_id and private.vehicle_in_scope(v.organization_id, v.id);
$$;

create or replace function private.maintenance_now(p_organization_id uuid)
returns timestamp
language sql
stable
security definer
set search_path = ''
as $$
  select now() at time zone coalesce(
    (select nullif(o.timezone, '') from public.organizations o where o.id = p_organization_id), 'America/Sao_Paulo');
$$;

-- Identificador técnico a partir de um nome: MAIÚSCULAS, sem acento, "_".
create or replace function private.maintenance_code_from_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(both '_' from regexp_replace(upper(translate(btrim(coalesce(p_name, '')),
           'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
           'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z0-9]+', '_', 'g')), 40);
$$;

create or replace function private.maintenance_assert_permission(p_organization_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Catálogo — escrita
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_save_cluster(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_code text := upper(btrim(coalesce(nullif(p_payload ->> 'code', ''), '')));
  v_old  public.maintenance_clusters;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_clusters');
  if length(v_name) < 2 then
    raise exception 'Informe o nome do cluster.' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is not null then
    select * into v_old from public.maintenance_clusters where id = v_id and organization_id = p_organization_id for update;
    if v_old.id is null or v_old.deleted_at is not null then
      raise exception 'Cluster não encontrado.' using errcode = 'no_data_found';
    end if;
    -- O código é o identificador técnico: estável depois de criado.
    if v_code <> '' and v_code <> v_old.code then
      raise exception 'O identificador técnico do cluster não muda depois de criado.' using errcode = 'invalid_parameter_value';
    end if;
    if coalesce(p_payload ->> 'status', v_old.status) = 'inactive' and v_old.status = 'active' and exists (
         select 1 from public.maintenance_services s
          where s.cluster_id = v_id and s.status = 'active' and s.deleted_at is null) then
      raise exception 'Há serviços ativos neste cluster. Inative-os ou mova-os antes.' using errcode = 'invalid_parameter_value';
    end if;
    update public.maintenance_clusters set
      name                = v_name,
      description         = nullif(btrim(p_payload ->> 'description'), ''),
      default_criticality = coalesce(nullif(p_payload ->> 'default_criticality', ''), default_criticality),
      status              = coalesce(nullif(p_payload ->> 'status', ''), status),
      sort_order          = coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, sort_order)
    where id = v_id;
    return v_id;
  end if;

  if v_code = '' then
    v_code := private.maintenance_code_from_name(v_name);
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_]{1,39}$' then
    raise exception 'Identificador técnico inválido (use letras, números e _).' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.maintenance_clusters
    (organization_id, code, name, description, default_criticality, status, sort_order)
  values
    (p_organization_id, v_code, v_name, nullif(btrim(p_payload ->> 'description'), ''),
     coalesce(nullif(p_payload ->> 'default_criticality', ''), 'medium'),
     coalesce(nullif(p_payload ->> 'status', ''), 'active'),
     coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, 100))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um cluster com este nome ou identificador.' using errcode = 'unique_violation';
end;
$$;

-- Arquivar (não excluir): o cluster pode estar no histórico de manutenções.
create or replace function public.maintenance_archive_cluster(p_cluster_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.maintenance_clusters;
begin
  select * into v_row from public.maintenance_clusters where id = p_cluster_id for update;
  if v_row.id is null then
    raise exception 'Cluster não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_row.organization_id, 'maintenance.manage_clusters');
  if exists (select 1 from public.maintenance_services s where s.cluster_id = v_row.id and s.deleted_at is null) then
    raise exception 'Há serviços neste cluster. Arquive-os ou mova-os antes.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.maintenance_predictive_plan_items i where i.cluster_id = v_row.id and i.is_active) then
    raise exception 'O cluster é usado por itens ativos de plano preditivo.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_clusters set deleted_at = now(), deleted_by = auth.uid(), status = 'inactive' where id = v_row.id;
end;
$$;

create or replace function public.maintenance_save_service(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
  v_cluster uuid := nullif(p_payload ->> 'cluster_id', '')::uuid;
  v_types   text[] := coalesce(private.jsonb_text_array(p_payload -> 'maintenance_type_codes'), '{}');
  v_vtypes  uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'vehicle_type_ids'), '{}');
  v_status  text := coalesce(nullif(p_payload ->> 'status', ''), 'active');
  v_hours   numeric := nullif(p_payload ->> 'expected_hours', '')::numeric;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_services');
  if length(v_name) < 2 then
    raise exception 'Informe o nome do serviço.' using errcode = 'invalid_parameter_value';
  end if;
  if v_cluster is null or not exists (
       select 1 from public.maintenance_clusters c
        where c.id = v_cluster and c.organization_id = p_organization_id and c.deleted_at is null
          and (c.status = 'active' or v_status = 'inactive')) then
    raise exception 'Selecione um cluster técnico ativo: todo serviço pertence a um cluster.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_types) t where t not in (select code from public.maintenance_types)) then
    raise exception 'Tipo de manutenção inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_vtypes) t
              where not exists (select 1 from public.vehicle_types vt
                                 where vt.id = t and (vt.organization_id is null or vt.organization_id = p_organization_id)
                                   and vt.deleted_at is null)) then
    raise exception 'Tipo de equipamento inválido.' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is not null then
    if not exists (select 1 from public.maintenance_services
                    where id = v_id and organization_id = p_organization_id and deleted_at is null) then
      raise exception 'Serviço não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.maintenance_services set
      cluster_id             = v_cluster,
      name                   = v_name,
      description            = nullif(btrim(p_payload ->> 'description'), ''),
      criticality            = coalesce(nullif(p_payload ->> 'criticality', ''), criticality),
      maintenance_type_codes = v_types,
      vehicle_type_ids       = v_vtypes,
      expected_hours         = v_hours,
      is_predictive          = coalesce((p_payload ->> 'is_predictive')::boolean, is_predictive),
      status                 = v_status
    where id = v_id;
    return v_id;
  end if;

  insert into public.maintenance_services
    (organization_id, cluster_id, name, description, criticality, maintenance_type_codes, vehicle_type_ids,
     expected_hours, is_predictive, status)
  values
    (p_organization_id, v_cluster, v_name, nullif(btrim(p_payload ->> 'description'), ''),
     coalesce(nullif(p_payload ->> 'criticality', ''), 'medium'), v_types, v_vtypes, v_hours,
     coalesce((p_payload ->> 'is_predictive')::boolean, false), v_status)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um serviço com este nome neste cluster.' using errcode = 'unique_violation';
end;
$$;

create or replace function public.maintenance_archive_service(p_service_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.maintenance_services;
begin
  select * into v_row from public.maintenance_services where id = p_service_id for update;
  if v_row.id is null then
    raise exception 'Serviço não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_row.organization_id, 'maintenance.manage_services');
  if exists (select 1 from public.maintenance_preventive_rules r
              where r.service_id = v_row.id and r.deleted_at is null and r.status = 'active') then
    raise exception 'O serviço é usado por um parâmetro preventivo ativo.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_services set deleted_at = now(), deleted_by = auth.uid(), status = 'inactive' where id = v_row.id;
  update public.maintenance_checklist_service_links set is_active = false where service_id = v_row.id;
end;
$$;

create or replace function public.maintenance_save_supplier(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name     text := btrim(coalesce(p_payload ->> 'name', ''));
  v_doc      text := nullif(regexp_replace(coalesce(p_payload ->> 'document_number', ''), '[^0-9]', '', 'g'), '');
  v_state    smallint := nullif(p_payload ->> 'state_id', '')::smallint;
  v_city     integer := nullif(p_payload ->> 'city_id', '')::integer;
  v_clusters uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'cluster_ids'), '{}');
  v_services uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'service_ids'), '{}');
  v_cities   integer[] := coalesce(private.jsonb_int_array(p_payload -> 'served_city_ids'), '{}');
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_suppliers');
  if length(v_name) < 2 then
    raise exception 'Informe o nome do fornecedor.' using errcode = 'invalid_parameter_value';
  end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then
    raise exception 'CNPJ/CPF inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is not null and not exists (select 1 from public.cities c where c.id = v_city and (v_state is null or c.state_id = v_state)) then
    raise exception 'Cidade não pertence ao estado informado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is not null and v_state is null then
    select c.state_id into v_state from public.cities c where c.id = v_city;
  end if;
  if exists (select 1 from unnest(v_clusters) x
              where not exists (select 1 from public.maintenance_clusters c
                                 where c.id = x and c.organization_id = p_organization_id and c.deleted_at is null)) then
    raise exception 'Categoria atendida inválida (cluster).' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_services) x
              where not exists (select 1 from public.maintenance_services s
                                 where s.id = x and s.organization_id = p_organization_id and s.deleted_at is null)) then
    raise exception 'Serviço atendido inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_cities) x where not exists (select 1 from public.cities c where c.id = x)) then
    raise exception 'Local atendido inválido.' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is not null then
    if not exists (select 1 from public.maintenance_suppliers
                    where id = v_id and organization_id = p_organization_id and deleted_at is null) then
      raise exception 'Fornecedor não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.maintenance_suppliers set
      name = v_name, trade_name = nullif(btrim(p_payload ->> 'trade_name'), ''), document_number = v_doc,
      address = nullif(btrim(p_payload ->> 'address'), ''), state_id = v_state, city_id = v_city,
      cluster_ids = v_clusters, service_ids = v_services, served_city_ids = v_cities,
      status = coalesce(nullif(p_payload ->> 'status', ''), status), notes = nullif(btrim(p_payload ->> 'notes'), '')
    where id = v_id;
    return v_id;
  end if;

  insert into public.maintenance_suppliers
    (organization_id, name, trade_name, document_number, address, state_id, city_id, cluster_ids, service_ids,
     served_city_ids, status, notes)
  values
    (p_organization_id, v_name, nullif(btrim(p_payload ->> 'trade_name'), ''), v_doc,
     nullif(btrim(p_payload ->> 'address'), ''), v_state, v_city, v_clusters, v_services, v_cities,
     coalesce(nullif(p_payload ->> 'status', ''), 'active'), nullif(btrim(p_payload ->> 'notes'), ''))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um fornecedor com este nome ou documento.' using errcode = 'unique_violation';
end;
$$;

create or replace function public.maintenance_archive_supplier(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.maintenance_suppliers;
begin
  select * into v_row from public.maintenance_suppliers where id = p_supplier_id for update;
  if v_row.id is null then
    raise exception 'Fornecedor não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_row.organization_id, 'maintenance.manage_suppliers');
  if exists (select 1 from public.maintenances m
              where m.supplier_id = v_row.id and m.status in ('scheduled', 'in_progress')) then
    raise exception 'O fornecedor tem manutenções agendadas ou em execução.' using errcode = 'invalid_parameter_value';
  end if;
  update public.maintenance_suppliers set deleted_at = now(), deleted_by = auth.uid(), status = 'inactive' where id = v_row.id;
end;
$$;

-- Serviço × Check List: substitui o conjunto de perguntas de um serviço.
-- p_links: [{app_id, question_key, field_key, auto_resolve}]
create or replace function public.maintenance_save_service_links(p_service_id uuid, p_links jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.maintenance_services;
  v_link    jsonb;
  v_count   integer := 0;
  v_keep    uuid[] := '{}';
  v_id      uuid;
begin
  select * into v_service from public.maintenance_services where id = p_service_id and deleted_at is null;
  if v_service.id is null then
    raise exception 'Serviço não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.maintenance_assert_permission(v_service.organization_id, 'maintenance.manage_services');

  for v_link in select * from jsonb_array_elements(coalesce(p_links, '[]'))
  loop
    -- A pergunta existe em alguma versão do app (a chave é estável entre versões).
    if not exists (
         select 1 from public.checklist_questions q
           join public.checklist_app_versions v on v.id = q.version_id
          where v.app_id = (v_link ->> 'app_id')::uuid
            and q.organization_id = v_service.organization_id
            and q.question_key = v_link ->> 'question_key') then
      raise exception 'Pergunta "%" não existe no Check List.', v_link ->> 'question_key' using errcode = 'invalid_parameter_value';
    end if;
    if nullif(v_link ->> 'field_key', '') is not null and not exists (
         select 1 from public.checklist_question_conditionals c
           join public.checklist_questions q on q.id = c.question_id
           join public.checklist_app_versions v on v.id = q.version_id
          where v.app_id = (v_link ->> 'app_id')::uuid
            and q.question_key = v_link ->> 'question_key'
            and c.field_key = v_link ->> 'field_key') then
      raise exception 'Campo condicional "%" não existe na pergunta.', v_link ->> 'field_key' using errcode = 'invalid_parameter_value';
    end if;

    select l.id into v_id from public.maintenance_checklist_service_links l
     where l.organization_id = v_service.organization_id and l.app_id = (v_link ->> 'app_id')::uuid
       and l.question_key = v_link ->> 'question_key'
       and l.field_key is not distinct from nullif(v_link ->> 'field_key', '')
       and l.service_id = v_service.id;
    if v_id is null then
      insert into public.maintenance_checklist_service_links
        (organization_id, app_id, question_key, field_key, service_id, auto_resolve, is_active)
      values
        (v_service.organization_id, (v_link ->> 'app_id')::uuid, v_link ->> 'question_key',
         nullif(v_link ->> 'field_key', ''), v_service.id, coalesce((v_link ->> 'auto_resolve')::boolean, true), true)
      returning id into v_id;
    else
      update public.maintenance_checklist_service_links
         set auto_resolve = coalesce((v_link ->> 'auto_resolve')::boolean, true), is_active = true
       where id = v_id;
    end if;
    v_keep := v_keep || v_id;
    v_count := v_count + 1;
  end loop;

  update public.maintenance_checklist_service_links
     set is_active = false
   where service_id = v_service.id and is_active and not (id = any (v_keep));
  return v_count;
end;
$$;

create or replace function public.maintenance_save_origin(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_code text;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_parameters');
  if length(v_name) < 2 then
    raise exception 'Informe o nome da origem.' using errcode = 'invalid_parameter_value';
  end if;
  if v_id is not null then
    update public.maintenance_origins set name = v_name, description = nullif(btrim(p_payload ->> 'description'), ''),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active)
     where id = v_id and organization_id = p_organization_id and not is_system;
    if not found then
      raise exception 'Origem não encontrada (origens do sistema não são editáveis).' using errcode = 'no_data_found';
    end if;
    return v_id;
  end if;
  v_code := lower(private.maintenance_code_from_name(v_name));
  if exists (select 1 from public.maintenance_origins o
              where o.code = v_code and (o.organization_id is null or o.organization_id = p_organization_id)) then
    raise exception 'Já existe uma origem com este nome.' using errcode = 'unique_violation';
  end if;
  insert into public.maintenance_origins (organization_id, code, name, description, is_system, manual_selectable, sort_order)
  values (p_organization_id, v_code, v_name, nullif(btrim(p_payload ->> 'description'), ''), false, true, 200)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.maintenance_save_settings(p_organization_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buckets integer[] := private.jsonb_int_array(p_payload -> 'aging_buckets');
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_parameters');
  if v_buckets is not null and exists (
       select 1 from unnest(v_buckets) with ordinality a(v, i)
         join unnest(v_buckets) with ordinality b(v, i) on b.i = a.i + 1
        where b.v <= a.v) then
    raise exception 'As faixas de aging devem ser crescentes.' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.maintenance_settings (organization_id) values (p_organization_id)
  on conflict (organization_id) do nothing;
  update public.maintenance_settings set
    aging_buckets            = coalesce(v_buckets, aging_buckets),
    recurrence_window_days   = coalesce(nullif(p_payload ->> 'recurrence_window_days', '')::integer, recurrence_window_days),
    km_compatible_days       = coalesce(nullif(p_payload ->> 'km_compatible_days', '')::integer, km_compatible_days),
    km_estimated_max_days    = coalesce(nullif(p_payload ->> 'km_estimated_max_days', '')::integer, km_estimated_max_days),
    default_sla_hours        = coalesce(nullif(p_payload ->> 'default_sla_hours', '')::numeric, default_sla_hours),
    schedule_overdue_days    = coalesce(nullif(p_payload ->> 'schedule_overdue_days', '')::integer, schedule_overdue_days),
    predictive_forecast_km   = coalesce(nullif(p_payload ->> 'predictive_forecast_km', '')::integer, predictive_forecast_km),
    predictive_forecast_days = coalesce(nullif(p_payload ->> 'predictive_forecast_days', '')::integer, predictive_forecast_days)
  where organization_id = p_organization_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Leituras — catálogo para as telas
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_catalog(p_organization_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'types', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'description', t.description)
                                        order by t.sort_order), '[]')
                from public.maintenance_types t where t.is_active),
    'origins', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'code', o.code, 'name', o.name, 'description', o.description, 'is_system', o.is_system,
                  'manual_selectable', o.manual_selectable, 'is_active', o.is_active, 'organization_id', o.organization_id)
                  order by o.sort_order, o.name), '[]')
                  from public.maintenance_origins o
                 where o.organization_id is null or o.organization_id = p_organization_id),
    'clusters', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'code', c.code, 'name', c.name, 'description', c.description,
                   'default_criticality', c.default_criticality, 'status', c.status, 'sort_order', c.sort_order,
                   'services', (select count(*) from public.maintenance_services s where s.cluster_id = c.id and s.deleted_at is null))
                   order by c.sort_order, c.name), '[]')
                   from public.maintenance_clusters c
                  where c.organization_id = p_organization_id and c.deleted_at is null),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'cluster_id', s.cluster_id, 'cluster_name', c.name, 'name', s.name,
                   'description', s.description, 'criticality', s.criticality,
                   'maintenance_type_codes', to_jsonb(s.maintenance_type_codes),
                   'vehicle_type_ids', to_jsonb(s.vehicle_type_ids), 'expected_hours', s.expected_hours,
                   'is_predictive', s.is_predictive, 'status', s.status,
                   'checklist_links', (select coalesce(jsonb_agg(jsonb_build_object(
                                          'id', l.id, 'app_id', l.app_id, 'question_key', l.question_key,
                                          'field_key', l.field_key, 'action_key', l.action_key, 'auto_resolve', l.auto_resolve)
                                          order by l.question_key), '[]')
                                         from public.maintenance_checklist_service_links l
                                        where l.service_id = s.id and l.is_active))
                   order by c.name, s.name), '[]')
                   from public.maintenance_services s
                   join public.maintenance_clusters c on c.id = s.cluster_id
                  where s.organization_id = p_organization_id and s.deleted_at is null),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', s.id, 'name', s.name, 'trade_name', s.trade_name, 'document_number', s.document_number,
                    'address', s.address, 'state_id', s.state_id, 'city_id', s.city_id,
                    'city_name', ci.name, 'state_uf', st.uf, 'cluster_ids', to_jsonb(s.cluster_ids),
                    'service_ids', to_jsonb(s.service_ids), 'served_city_ids', to_jsonb(s.served_city_ids),
                    'status', s.status, 'notes', s.notes)
                    order by s.name), '[]')
                    from public.maintenance_suppliers s
                    left join public.cities ci on ci.id = s.city_id
                    left join public.states st on st.id = s.state_id
                   where s.organization_id = p_organization_id and s.deleted_at is null),
    'settings', (select to_jsonb(ms) - 'organization_id' - 'updated_by'
                   from public.maintenance_settings ms where ms.organization_id = p_organization_id));
$$;

-- -----------------------------------------------------------------------------
-- 4. O filtro único
-- -----------------------------------------------------------------------------
-- p_filters: search, statuses[], types[], origin_ids[], priorities[], vehicle_ids[],
--   vehicle_type_ids[], operation_ids[], state_ids[], city_ids[], br_ids[],
--   leader_ids[], unit_ids[], supplier_ids[], cluster_ids[], service_ids[],
--   km_statuses[], date_from, date_to, fleet_status (active|inactive|all), open_only
-- Data de referência de uma manutenção: entrada real → agendamento → solicitação.
create or replace function private.maintenance_filtered(p_organization_id uuid, p_filters jsonb)
returns setof public.maintenances
language sql
stable
set search_path = ''
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'search'), '')                    as search,
           private.jsonb_text_array(p_filters -> 'statuses')           as statuses,
           private.jsonb_text_array(p_filters -> 'types')              as types,
           private.jsonb_uuid_array(p_filters -> 'origin_ids')         as origin_ids,
           private.jsonb_text_array(p_filters -> 'priorities')         as priorities,
           private.jsonb_uuid_array(p_filters -> 'vehicle_ids')        as vehicle_ids,
           private.jsonb_uuid_array(p_filters -> 'vehicle_type_ids')   as vehicle_type_ids,
           private.jsonb_uuid_array(p_filters -> 'operation_ids')      as operation_ids,
           private.jsonb_int_array(p_filters -> 'state_ids')           as state_ids,
           private.jsonb_int_array(p_filters -> 'city_ids')            as city_ids,
           private.jsonb_uuid_array(p_filters -> 'br_ids')             as br_ids,
           private.jsonb_uuid_array(p_filters -> 'leader_ids')         as leader_ids,
           private.jsonb_uuid_array(p_filters -> 'unit_ids')           as unit_ids,
           private.jsonb_uuid_array(p_filters -> 'supplier_ids')       as supplier_ids,
           private.jsonb_uuid_array(p_filters -> 'cluster_ids')        as cluster_ids,
           private.jsonb_uuid_array(p_filters -> 'service_ids')        as service_ids,
           private.jsonb_text_array(p_filters -> 'km_statuses')        as km_statuses,
           nullif(p_filters ->> 'date_from', '')::date                 as date_from,
           nullif(p_filters ->> 'date_to', '')::date                   as date_to,
           coalesce(nullif(p_filters ->> 'fleet_status', ''), 'all')   as fleet_status,
           coalesce((p_filters ->> 'open_only')::boolean, false)       as open_only
  )
  select m.*
    from public.maintenances m
    cross join f
   where m.organization_id = p_organization_id
     and (f.search is null
          or m.code ilike '%' || f.search || '%'
          or m.license_plate_snapshot ilike '%' || private.normalize_plate(f.search) || '%'
          or coalesce(m.fleet_code_snapshot, '') ilike '%' || f.search || '%'
          or coalesce(m.service_order_number, '') ilike '%' || f.search || '%')
     and (f.statuses is null or m.status = any (f.statuses))
     and (f.types is null or m.maintenance_type_code = any (f.types))
     and (f.origin_ids is null or m.origin_id = any (f.origin_ids))
     and (f.priorities is null or m.priority = any (f.priorities))
     and (f.vehicle_ids is null or m.vehicle_id = any (f.vehicle_ids))
     and (f.vehicle_type_ids is null or m.vehicle_type_id = any (f.vehicle_type_ids))
     and (f.operation_ids is null or m.operation_id = any (f.operation_ids))
     and (f.state_ids is null or m.state_id = any (f.state_ids))
     and (f.city_ids is null or m.city_id = any (f.city_ids))
     and (f.br_ids is null or m.operation_br_id = any (f.br_ids))
     and (f.leader_ids is null or m.leader_employee_id = any (f.leader_ids))
     and (f.unit_ids is null or m.organization_unit_id = any (f.unit_ids))
     and (f.supplier_ids is null or m.supplier_id = any (f.supplier_ids))
     and (f.km_statuses is null or m.entry_km_status = any (f.km_statuses))
     and (f.cluster_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.cluster_id = any (f.cluster_ids)))
     and (f.service_ids is null or exists (select 1 from public.maintenance_items i
                                            where i.maintenance_id = m.id and i.status <> 'cancelled'
                                              and i.service_id = any (f.service_ids)))
     and (f.date_from is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) >= f.date_from)
     and (f.date_to is null or coalesce(m.entry_date, m.scheduled_date, m.requested_on) <= f.date_to)
     and (not f.open_only or m.status in ('to_schedule', 'scheduled', 'in_progress'))
     and (f.fleet_status = 'all'
          or (f.fleet_status = 'active') = private.maintenance_vehicle_active(m.vehicle_id));
$$;

-- Uma linha pronta para a tela.
create or replace function private.maintenance_row_json(p_m public.maintenances, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_m.id, 'code', p_m.code, 'vehicle_id', p_m.vehicle_id,
    'license_plate', p_m.license_plate_snapshot, 'fleet_code', p_m.fleet_code_snapshot,
    'type', p_m.maintenance_type_code, 'type_name', (select t.name from public.maintenance_types t where t.code = p_m.maintenance_type_code),
    'origin_id', p_m.origin_id, 'origin_name', (select o.name from public.maintenance_origins o where o.id = p_m.origin_id),
    'priority', p_m.priority, 'status', p_m.status,
    'requested_on', p_m.requested_on, 'scheduled_date', p_m.scheduled_date, 'scheduled_time', p_m.scheduled_time,
    'expected_exit_date', p_m.expected_exit_date, 'expected_exit_time', p_m.expected_exit_time,
    'entry_date', p_m.entry_date, 'entry_time', p_m.entry_time, 'exit_date', p_m.exit_date, 'exit_time', p_m.exit_time,
    'duration_hours', p_m.duration_hours, 'duration_precision', p_m.duration_precision,
    'supplier_id', p_m.supplier_id, 'supplier_name', (select s.name from public.maintenance_suppliers s where s.id = p_m.supplier_id),
    'service_order_number', p_m.service_order_number,
    'entry_km', p_m.entry_km, 'entry_km_status', p_m.entry_km_status, 'entry_km_source', p_m.entry_km_source,
    'current_km', p_m.current_km_snapshot,
    'operation_id', p_m.operation_id, 'operation_name', p_m.operation_name_snapshot,
    'city_id', p_m.city_id, 'city_name', p_m.city_name_snapshot, 'state_uf', p_m.state_uf_snapshot,
    'br_id', p_m.operation_br_id, 'br_code', p_m.br_code_snapshot,
    'leader_id', p_m.leader_employee_id, 'leader_name', p_m.leader_name_snapshot, 'unit_name', p_m.unit_name_snapshot,
    'preventive_cycle_id', p_m.preventive_cycle_id, 'predictive_cycle_id', p_m.predictive_cycle_id,
    'description', p_m.description, 'reopen_count', p_m.reopen_count,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'service_id', i.service_id, 'service', i.service_name_snapshot,
                'cluster_id', i.cluster_id, 'cluster', i.cluster_name_snapshot,
                'criticality', i.criticality, 'status', i.status, 'result', i.result) order by i.sort_order), '[]')
                from public.maintenance_items i where i.maintenance_id = p_m.id and i.status <> 'cancelled'),
    'late_entry', p_m.status = 'scheduled' and p_m.scheduled_date < p_today,
    'exit_overdue', p_m.status = 'in_progress' and p_m.expected_exit_date < p_today,
    'age_days', case when p_m.status in ('to_schedule', 'scheduled', 'in_progress')
                     then p_today - coalesce(p_m.entry_date, p_m.requested_on) end,
    'created_at', p_m.created_at, 'updated_at', p_m.updated_at);
$$;


-- -----------------------------------------------------------------------------
-- 5. Reincidência — veículo + cluster (+ serviço) dentro da janela
-- -----------------------------------------------------------------------------
-- Uma manutenção é "possível reincidência" quando o mesmo veículo teve outra
-- manutenção do mesmo cluster técnico nos N dias anteriores (data de
-- referência). É um evento para análise: não afirma que a anterior foi mal
-- executada. same_service indica que o serviço também se repetiu.
create or replace function private.maintenance_recurrences(p_organization_id uuid, p_window_days integer, p_filters jsonb default '{}'::jsonb)
returns table (maintenance_id uuid, vehicle_id uuid, cluster_id uuid, cluster_name text,
               previous_maintenance_id uuid, days_between integer, same_service boolean, reference_date date)
language sql
stable
set search_path = ''
as $$
  with base as (
    select distinct m.id, m.vehicle_id, i.cluster_id, i.cluster_name_snapshot,
           coalesce(m.entry_date, m.scheduled_date, m.requested_on) as ref
      from private.maintenance_filtered(p_organization_id, p_filters) m
      join public.maintenance_items i on i.maintenance_id = m.id and i.status <> 'cancelled'
     where m.status not in ('cancelled', 'not_performed')
  ),
  ordered as (
    select b.*, lag(b.id) over w as prev_id, lag(b.ref) over w as prev_ref
      from base b
    window w as (partition by b.vehicle_id, b.cluster_id order by b.ref, b.id)
  )
  select o.id, o.vehicle_id, o.cluster_id, o.cluster_name_snapshot, o.prev_id, (o.ref - o.prev_ref)::integer,
         exists (select 1 from public.maintenance_items a
                   join public.maintenance_items b on b.service_id = a.service_id
                  where a.maintenance_id = o.id and b.maintenance_id = o.prev_id
                    and a.status <> 'cancelled' and b.status <> 'cancelled'),
         o.ref
    from ordered o
   where o.prev_id is not null and o.ref - o.prev_ref <= p_window_days;
$$;

-- -----------------------------------------------------------------------------
-- 6. Base Geral / Programação — lista paginada no servidor
-- -----------------------------------------------------------------------------
-- p_sort: reference | requested | scheduled | entry | exit | code | plate | status | duration
create or replace function public.maintenance_list(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb,
  p_sort            text default 'reference',
  p_dir             text default 'desc',
  p_limit           integer default 50,
  p_offset          integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort   text := coalesce(p_sort, 'reference');
  v_desc   boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  v_total  bigint;
  v_rows   jsonb;
begin
  select count(*) into v_total from private.maintenance_filtered(p_organization_id, p_filters);

  select coalesce(jsonb_agg(private.maintenance_row_json(p.m, v_today) order by p.rn), '[]'::jsonb)
    into v_rows
    from (
      select m, row_number() over (order by
               case when not v_desc then case v_sort when 'code' then m.code when 'plate' then m.license_plate_snapshot
                                                     when 'status' then m.status end end asc nulls last,
               case when v_desc then case v_sort when 'code' then m.code when 'plate' then m.license_plate_snapshot
                                                 when 'status' then m.status end end desc nulls last,
               case when not v_desc then case v_sort
                    when 'reference' then coalesce(m.entry_date, m.scheduled_date, m.requested_on)
                    when 'requested' then m.requested_on when 'scheduled' then m.scheduled_date
                    when 'entry' then m.entry_date when 'exit' then m.exit_date end end asc nulls last,
               case when v_desc then case v_sort
                    when 'reference' then coalesce(m.entry_date, m.scheduled_date, m.requested_on)
                    when 'requested' then m.requested_on when 'scheduled' then m.scheduled_date
                    when 'entry' then m.entry_date when 'exit' then m.exit_date end end desc nulls last,
               case when not v_desc and v_sort = 'duration' then m.duration_hours end asc nulls last,
               case when v_desc and v_sort = 'duration' then m.duration_hours end desc nulls last,
               m.created_at desc, m.id) as rn
        from private.maintenance_filtered(p_organization_id, p_filters) m
    ) p
   where p.rn > v_offset and p.rn <= v_offset + v_limit;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'limit', v_limit, 'offset', v_offset, 'today', v_today);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Programação — indicadores
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_schedule_kpis(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today    date := private.maintenance_today(p_organization_id);
  v_now      timestamp;
  v_settings public.maintenance_settings;
  v_result   jsonb;
begin
  select * into v_settings from public.maintenance_settings where organization_id = p_organization_id;
  v_now := private.maintenance_now(p_organization_id);
  with m as (select * from private.maintenance_filtered(p_organization_id, p_filters)),
  sla as (
    select m.id,
           coalesce((select sum(s.expected_hours) from public.maintenance_items i
                       join public.maintenance_services s on s.id = i.service_id
                      where i.maintenance_id = m.id and i.status <> 'cancelled'),
                    coalesce(v_settings.default_sla_hours, 72)) as sla_hours
      from m where m.status = 'in_progress'
  )
  select jsonb_build_object(
    'today',               v_today,
    'to_schedule',         count(*) filter (where m.status = 'to_schedule'),
    'scheduled',           count(*) filter (where m.status = 'scheduled'),
    'in_progress',         count(*) filter (where m.status = 'in_progress'),
    'scheduled_today',     count(*) filter (where m.status = 'scheduled' and m.scheduled_date = v_today),
    'late_entry',          count(*) filter (where m.status = 'scheduled' and m.scheduled_date < v_today),
    'exit_overdue',        count(*) filter (where m.status = 'in_progress' and m.expected_exit_date < v_today),
    'unscheduled_overdue', count(*) filter (where m.status = 'to_schedule'
                                              and m.requested_on <= v_today - coalesce(v_settings.schedule_overdue_days, 5)),
    'over_sla',            count(*) filter (where m.status = 'in_progress' and
                                              extract(epoch from (v_now - (m.entry_date + coalesce(m.entry_time, time '00:00')))) / 3600
                                              > (select sla.sla_hours from sla where sla.id = m.id)),
    'completed_today',     count(*) filter (where m.status = 'completed' and m.exit_date = v_today),
    'schedule_overdue_days', coalesce(v_settings.schedule_overdue_days, 5),
    'default_sla_hours',   coalesce(v_settings.default_sla_hours, 72))
    into v_result
    from m;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Hierarquia Operação → Cidade → BR → Veículo (pelo contexto histórico)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_hierarchy(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'operation_id', g.operation_id, 'operation_name', g.operation_name,
           'city_id', g.city_id, 'city_name', g.city_name, 'state_uf', g.state_uf,
           'br_id', g.br_id, 'br_code', g.br_code,
           'vehicle_id', g.vehicle_id, 'license_plate', g.license_plate, 'fleet_code', g.fleet_code,
           'total', g.total, 'open', g.open, 'in_progress', g.in_progress, 'last_reference', g.last_reference)
           order by g.operation_name nulls last, g.city_name nulls last, g.br_code nulls last, g.license_plate), '[]'::jsonb)
    from (
      select m.operation_id, max(m.operation_name_snapshot) as operation_name,
             m.city_id, max(m.city_name_snapshot) as city_name, max(m.state_uf_snapshot) as state_uf,
             m.operation_br_id as br_id, max(m.br_code_snapshot) as br_code,
             m.vehicle_id, max(m.license_plate_snapshot) as license_plate, max(m.fleet_code_snapshot) as fleet_code,
             count(*) as total,
             count(*) filter (where m.status in ('to_schedule', 'scheduled', 'in_progress')) as open,
             count(*) filter (where m.status = 'in_progress') as in_progress,
             max(coalesce(m.entry_date, m.scheduled_date, m.requested_on)) as last_reference
        from private.maintenance_filtered(p_organization_id, p_filters) m
       group by m.operation_id, m.city_id, m.operation_br_id, m.vehicle_id
    ) g;
$$;

-- -----------------------------------------------------------------------------
-- 9. Detalhe da manutenção (com trilha, itens, apontamentos e transições)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_detail(p_maintenance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m       public.maintenances;
  v_today   date;
  v_window  integer;
  v_result  jsonb;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id;
  if v_m.id is null
     or not private.has_permission(v_m.organization_id, 'maintenance.view')
     or not private.maintenance_in_scope(v_m.organization_id, v_m.operation_id, v_m.vehicle_id) then
    raise exception 'Manutenção não encontrada.' using errcode = 'no_data_found';
  end if;
  v_today  := private.maintenance_today(v_m.organization_id);
  v_window := coalesce((select s.recurrence_window_days from public.maintenance_settings s
                         where s.organization_id = v_m.organization_id), 30);

  v_result := private.maintenance_row_json(v_m, v_today) || jsonb_build_object(
    'context_date', v_m.context_date, 'context_source', v_m.context_source,
    'scheduling_notes', v_m.scheduling_notes, 'completion_notes', v_m.completion_notes, 'notes', v_m.notes,
    'duplicate_justification', v_m.duplicate_justification,
    'entry_km_reference_date', v_m.entry_km_reference_date, 'entry_km_official', v_m.entry_km_official,
    'entry_km_difference', v_m.entry_km_difference, 'entry_km_justification', v_m.entry_km_justification,
    'current_km_date', v_m.current_km_date,
    'vehicle', (select jsonb_build_object('status', v.status, 'license_plate', v.license_plate, 'fleet_code', v.fleet_code,
                                          'type_name', vt.name, 'subcategory_name', sc.name, 'model_name', vm.name,
                                          'make_name', mk.name)
                  from public.vehicles v
                  left join public.vehicle_types vt on vt.id = v.vehicle_type_id
                  left join public.vehicle_subcategories sc on sc.id = v.vehicle_subcategory_id
                  left join public.vehicle_models vm on vm.id = v.vehicle_model_id
                  left join public.vehicle_makes mk on mk.id = vm.vehicle_make_id
                 where v.id = v_m.vehicle_id),
    'items_all', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', i.id, 'service_id', i.service_id, 'service', i.service_name_snapshot,
                    'cluster_id', i.cluster_id, 'cluster', i.cluster_name_snapshot, 'criticality', i.criticality,
                    'status', i.status, 'result', i.result, 'notes', i.notes, 'completed_at', i.completed_at,
                    'expected_hours', (select s.expected_hours from public.maintenance_services s where s.id = i.service_id))
                    order by i.sort_order), '[]')
                    from public.maintenance_items i where i.maintenance_id = v_m.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', e.id, 'type', e.event_type, 'from_status', e.from_status, 'to_status', e.to_status,
                 'reason', e.reason, 'payload', e.payload, 'source', e.source, 'actor', e.actor_name,
                 'occurred_at', e.occurred_at) order by e.occurred_at, e.id), '[]')
                 from public.maintenance_events e where e.maintenance_id = v_m.id),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', f.id, 'answer_id', f.checklist_answer_id, 'execution_id', f.checklist_execution_id,
                   'question_key', f.question_key, 'field_key', f.field_key,
                   'question', a.question_text_snapshot, 'answer', a.answer, 'note', a.note,
                   'checklist_date', ce.operational_date, 'resolution_status', f.resolution_status,
                   'link_origin', f.link_origin, 'resolved_at', f.resolved_at) order by f.created_at), '[]')
                   from public.maintenance_finding_links f
                   left join public.checklist_execution_answers a on a.id = f.checklist_answer_id
                   left join public.checklist_executions ce on ce.id = f.checklist_execution_id
                  where f.maintenance_id = v_m.id),
    'recurrence', (select coalesce(jsonb_agg(jsonb_build_object(
                     'cluster', r.cluster_name, 'previous_id', r.previous_maintenance_id,
                     'previous_code', (select pm.code from public.maintenances pm where pm.id = r.previous_maintenance_id),
                     'days_between', r.days_between, 'same_service', r.same_service)), '[]')
                     from private.maintenance_recurrences(v_m.organization_id, v_window,
                                                          jsonb_build_object('vehicle_ids', jsonb_build_array(v_m.vehicle_id))) r
                    where r.maintenance_id = v_m.id),
    'transitions', (select coalesce(jsonb_agg(t.to_status), '[]')
                      from unnest(array['to_schedule', 'scheduled', 'in_progress', 'completed', 'cancelled', 'not_performed']) t(to_status)
                     where private.maintenance_transition_allowed(v_m.status, t.to_status)),
    'recurrence_window_days', v_window);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Histórico por veículo (aba do Cadastro de Frotas) — consulta, não cópia
-- -----------------------------------------------------------------------------
create or replace function public.vehicle_maintenance_history(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org    uuid;
  v_today  date;
  v_window integer;
  v_filter jsonb := jsonb_build_object('vehicle_ids', jsonb_build_array(p_vehicle_id));
begin
  v_org := private.maintenance_vehicle_org(p_vehicle_id);
  if v_org is null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;
  v_today  := private.maintenance_today(v_org);
  v_window := coalesce((select s.recurrence_window_days from public.maintenance_settings s where s.organization_id = v_org), 30);

  return (
    with m as (select * from private.maintenance_filtered(v_org, v_filter)),
    rec as (select * from private.maintenance_recurrences(v_org, v_window, v_filter))
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'total',        (select count(*) from m),
        'open',         (select count(*) from m where m.status in ('to_schedule', 'scheduled', 'in_progress')),
        'preventive',   (select count(*) from m where m.maintenance_type_code = 'preventive'),
        'corrective',   (select count(*) from m where m.maintenance_type_code = 'corrective'),
        'predictive',   (select count(*) from m where m.maintenance_type_code = 'predictive'),
        'avg_duration_hours', (select round(avg(m.duration_hours), 1) from m where m.status = 'completed'),
        'recurrences',  (select count(distinct rec.maintenance_id) from rec),
        'last_exit',    (select max(m.exit_date) from m)),
      'maintenances', (select coalesce(jsonb_agg(private.maintenance_row_json(m, v_today)
                                                 || jsonb_build_object('recurrent', exists (select 1 from rec where rec.maintenance_id = m.id))
                                                 order by coalesce(m.entry_date, m.scheduled_date, m.requested_on) desc, m.created_at desc), '[]')
                         from m),
      'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('supplier', s.name, 'count', x.cnt) order by x.cnt desc), '[]')
                      from (select m.supplier_id, count(*) as cnt from m where m.supplier_id is not null group by m.supplier_id) x
                      join public.maintenance_suppliers s on s.id = x.supplier_id),
      'recurrence_window_days', v_window));
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Grants
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.jsonb_uuid_array(jsonb)', 'private.jsonb_text_array(jsonb)', 'private.jsonb_int_array(jsonb)',
    'private.maintenance_code_from_name(text)', 'private.maintenance_filtered(uuid, jsonb)',
    'private.maintenance_row_json(public.maintenances, date)',
    'private.maintenance_recurrences(uuid, integer, jsonb)', 'private.maintenance_vehicle_active(uuid)',
    'private.maintenance_vehicle_org(uuid)', 'private.maintenance_now(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  execute 'revoke all on function private.maintenance_assert_permission(uuid, text) from public, anon, authenticated';

  foreach f in array array[
    'public.maintenance_save_cluster(uuid, jsonb)', 'public.maintenance_archive_cluster(uuid)',
    'public.maintenance_save_service(uuid, jsonb)', 'public.maintenance_archive_service(uuid)',
    'public.maintenance_save_supplier(uuid, jsonb)', 'public.maintenance_archive_supplier(uuid)',
    'public.maintenance_save_service_links(uuid, jsonb)', 'public.maintenance_save_origin(uuid, jsonb)',
    'public.maintenance_save_settings(uuid, jsonb)', 'public.maintenance_catalog(uuid)',
    'public.maintenance_list(uuid, jsonb, text, text, integer, integer)',
    'public.maintenance_schedule_kpis(uuid, jsonb)', 'public.maintenance_hierarchy(uuid, jsonb)',
    'public.maintenance_detail(uuid)', 'public.vehicle_maintenance_history(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
