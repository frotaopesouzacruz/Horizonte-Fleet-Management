-- =============================================================================
-- Gestão de Pneus — consertos: identificação inequívoca do pneu
--
-- `tire_repair_save` buscava o pneu por `id = tire_id OR fire_number = …`; com os
-- dois informados e apontando para pneus diferentes, o registro podia cair no
-- pneu errado. Agora o tire_id manda quando vem, o Nº Fogo só é usado sozinho e
-- a divergência entre os dois é recusada. Mesma assinatura (create or replace).
-- =============================================================================

create or replace function public.tire_repair_save(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_old      public.tire_repairs;
  t          public.tires;
  v_date     date;
  v_type     text := nullif(btrim(p_payload ->> 'repair_type'), '');
  v_service  uuid := nullif(p_payload ->> 'service_id', '')::uuid;
  v_supplier uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
  v_sup_name text;
  v_override uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_reason   text := nullif(btrim(p_payload ->> 'override_reason'), '');
  r          record;
  v_vehicle  record;
  v_res      public.tire_repairs;
  v_name     text := private.tire_actor_name(p_organization_id);
begin
  perform private.tire_require(p_organization_id, 'tires.services.manage');
  -- sem troca manual o registro fica "vazio" (estrutura definida) para as leituras abaixo
  select null::uuid as id, null::text as license_plate, null::text as fleet_code into v_vehicle;
  if v_id is not null then
    select * into v_old from public.tire_repairs x where x.id = v_id and x.organization_id = p_organization_id for update;
    if v_old.id is null then raise exception 'Conserto não encontrado.' using errcode = 'no_data_found'; end if;
    if v_old.status = 'voided' then raise exception 'Conserto cancelado não pode ser editado.' using errcode = 'invalid_parameter_value'; end if;
  end if;
  -- o pneu é identificado pelo tire_id quando ele vem; o Nº Fogo só é usado
  -- sozinho. Se os dois vierem e apontarem para pneus diferentes, recusa.
  if nullif(p_payload ->> 'tire_id', '') is not null then
    select * into t from public.tires x
     where x.organization_id = p_organization_id and x.id = (p_payload ->> 'tire_id')::uuid;
    if t.id is not null and private.tire_fire_number(p_payload ->> 'fire_number') is not null
       and t.fire_number <> private.tire_fire_number(p_payload ->> 'fire_number') then
      raise exception 'O Nº Fogo informado não corresponde ao pneu selecionado.' using errcode = 'invalid_parameter_value';
    end if;
  else
    select * into t from public.tires x
     where x.organization_id = p_organization_id and x.fire_number = private.tire_fire_number(p_payload ->> 'fire_number');
  end if;
  if t.id is null then raise exception 'Nº Fogo não encontrado no cadastro de pneus.' using errcode = 'no_data_found'; end if;
  begin
    v_date := (p_payload ->> 'service_date')::date;
  exception when others then
    raise exception 'Data do serviço inválida.' using errcode = 'invalid_parameter_value';
  end;
  if v_date is null or v_date > private.maintenance_today(p_organization_id) then
    raise exception 'Informe a data do serviço (não pode ser futura).' using errcode = 'invalid_parameter_value';
  end if;
  if v_type is null or length(v_type) not between 2 and 80 then
    raise exception 'Informe o tipo de conserto (2 a 80 caracteres).' using errcode = 'invalid_parameter_value';
  end if;
  if v_service is not null and not exists (select 1 from public.maintenance_services s where s.id = v_service and s.organization_id = p_organization_id) then
    raise exception 'Serviço não encontrado no catálogo da Manutenção.' using errcode = 'no_data_found';
  end if;
  if v_supplier is not null then
    select s.name into v_sup_name from public.maintenance_suppliers s where s.id = v_supplier and s.organization_id = p_organization_id;
    if v_sup_name is null then raise exception 'Fornecedor não encontrado no cadastro da Manutenção.' using errcode = 'no_data_found'; end if;
  end if;

  select * into r from private.tire_resolve_vehicle_at(p_organization_id, t.id, v_date);
  if v_override is not null and v_override is distinct from r.vehicle_id then
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'O veículo informado difere do resolvido pela fotografia: justifique (mínimo de 5 caracteres).'
        using errcode = 'invalid_parameter_value', hint = 'tire_repair_override_reason';
    end if;
    select v.id, v.license_plate, v.fleet_code into v_vehicle from public.vehicles v where v.id = v_override and v.organization_id = p_organization_id;
    if v_vehicle.id is null then raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found'; end if;
  end if;

  if v_id is null then
    insert into public.tire_repairs (organization_id, tire_id, fire_number_snapshot, service_date, repair_type, service_id, supplier_id,
      supplier_name_snapshot, service_order_number, notes, vehicle_id, license_plate_snapshot, fleet_code_snapshot, position_code_snapshot,
      vehicle_resolution, resolution_reference_date, resolution_confidence, override_reason, created_by, created_by_name)
    values (p_organization_id, t.id, t.fire_number, v_date, v_type, v_service, v_supplier, v_sup_name,
      nullif(btrim(p_payload ->> 'service_order_number'), ''), nullif(btrim(p_payload ->> 'notes'), ''),
      case when v_vehicle.id is not null then v_vehicle.id else r.vehicle_id end,
      case when v_vehicle.id is not null then v_vehicle.license_plate else r.license_plate end,
      case when v_vehicle.id is not null then v_vehicle.fleet_code else r.fleet_code end,
      case when v_vehicle.id is not null then null else r.position_code end,
      case when v_vehicle.id is not null then 'manual' else r.resolution end, r.reference_date,
      case when v_vehicle.id is not null then 'manual' else r.confidence end,
      case when v_vehicle.id is not null then v_reason end, auth.uid(), v_name)
    returning * into v_res;
  else
    update public.tire_repairs set tire_id = t.id, fire_number_snapshot = t.fire_number, service_date = v_date, repair_type = v_type,
      service_id = v_service, supplier_id = v_supplier, supplier_name_snapshot = v_sup_name,
      service_order_number = nullif(btrim(p_payload ->> 'service_order_number'), ''), notes = nullif(btrim(p_payload ->> 'notes'), ''),
      vehicle_id = case when v_vehicle.id is not null then v_vehicle.id else r.vehicle_id end,
      license_plate_snapshot = case when v_vehicle.id is not null then v_vehicle.license_plate else r.license_plate end,
      fleet_code_snapshot = case when v_vehicle.id is not null then v_vehicle.fleet_code else r.fleet_code end,
      position_code_snapshot = case when v_vehicle.id is not null then null else r.position_code end,
      vehicle_resolution = case when v_vehicle.id is not null then 'manual' else r.resolution end,
      resolution_reference_date = r.reference_date,
      resolution_confidence = case when v_vehicle.id is not null then 'manual' else r.confidence end,
      override_reason = case when v_vehicle.id is not null then v_reason end, updated_by = auth.uid(), updated_at = now()
     where id = v_id
    returning * into v_res;
  end if;
  perform private.tire_audit(p_organization_id, case when v_id is null then 'repair.created' else 'repair.updated' end, 'tire_repair', v_res.id,
    format('Conserto %s do pneu %s em %s.', v_type, t.fire_number, to_char(v_date, 'DD/MM/YYYY')),
    case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_res));
  return to_jsonb(v_res);
end;
$$;
