-- =============================================================================
-- Gestão de Pneus — linguagem: "fotografia" sai das mensagens e descrições
--
-- O termo deixa de existir para quem usa o módulo: falamos em dados gerais,
-- situação atual, base oficial (Rodopar) ou dados de uma data. Esta migration
-- só troca textos devolvidos ao usuário (mesmas assinaturas, mesma lógica) e
-- as descrições das permissões e do módulo. A conciliação das vistorias passa
-- a ignorar linhas removidas numa revisão do mesmo dia.
-- =============================================================================

update public.permissions set description = x.d
  from (values
    ('tires.dashboard.view', 'Visão geral: dados gerais, saúde e prazos, conformidades e prioridades dos pneus.'),
    ('tires.history.view', 'Movimentações, trocas de posição, mudanças de vida e de situação dos pneus.'),
    ('tires.measurement.view', 'Aderência de MM: sulco (milimetragem) e prazo de medição, quebras, ranking e pendências.'),
    ('tires.calibration.view', 'Aderência de calibragem: prazo de calibragem, pressão (PSI), conformidade geral de calibragem e lacunas de parâmetro.'),
    ('tires.import', 'Sincronização Rodopar: acompanha e dispara a sincronização com a planilha oficial (SharePoint) e, em contingência, envia o arquivo manualmente.'),
    ('tires.quality.view', 'Central de Auditoria dos Dados: inconsistências por regra, categoria e gravidade, com drill-down e acompanhamento.'),
    ('tires.audit.view', 'Trilha de sincronizações, importações, decisões das vistorias, parâmetros e exportações.')) as x(code, d)
 where public.permissions.code = x.code;

update public.operational_modules
   set description = 'Gestão de Pneus: dados oficiais Rodopar (SharePoint), conformidade de sulco, prazos e PSI, regras de PSI por dimensão e posição, layout de posições e Vistoria de Pneus.'
 where code = 'tyres';

create or replace function public.tire_inspection_submit(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub      uuid;
  v_existing public.tire_inspections;
  v_vehicle  uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_parent   uuid := nullif(p_payload ->> 'parent_inspection_id', '')::uuid;
  v_today    date := private.maintenance_today(p_organization_id);
  v_at       timestamptz := coalesce(nullif(p_payload ->> 'inspected_at', '')::timestamptz, now());
  v_date     date;
  v_latest   date := private.tire_latest_reference(p_organization_id);
  v_ctx      jsonb;
  v_actor    record;
  v_layout   record;
  v_protocol text;
  v_id       uuid;
  v_parent_r public.tire_inspections;
  p          public.tire_parameter_sets;
  it         jsonb;
  v_pos      text;
  v_fire     text;
  n_expected integer; n_measured integer; n_div integer; n_divs integer;
  v_tz       text;
begin
  perform private.tire_require(p_organization_id, 'applications.tires.execute');
  begin
    v_sub := nullif(p_payload ->> 'client_submission_id', '')::uuid;
  exception when others then v_sub := null; end;
  if v_sub is null then raise exception 'Identificador do envio ausente.' using errcode = 'invalid_parameter_value'; end if;

  select * into v_existing from public.tire_inspections i where i.organization_id = p_organization_id and i.client_submission_id = v_sub;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'protocol', v_existing.protocol, 'submitted_at', v_existing.submitted_at,
                              'positions_expected', v_existing.positions_expected, 'positions_measured', v_existing.positions_measured,
                              'duplicate', true);
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_organization_id;
  v_date := (v_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date;
  if v_date > v_today then raise exception 'A data da vistoria não pode ser futura.' using errcode = 'invalid_parameter_value'; end if;
  if v_date < v_today - 30 then raise exception 'A vistoria não pode ter mais de 30 dias.' using errcode = 'invalid_parameter_value'; end if;
  if v_vehicle is null then raise exception 'Selecione o veículo.' using errcode = 'invalid_parameter_value'; end if;
  v_ctx := private.tire_inspection_vehicle_check(p_organization_id, v_vehicle, v_date);
  p := private.tire_params_at(p_organization_id, v_date);

  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Nenhuma posição informada.' using errcode = 'invalid_parameter_value';
  end if;
  if length(coalesce(p_payload ->> 'general_observation', '')) > 1000 then
    raise exception 'Observação geral acima de 1.000 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  -- validação de cada posição: pertence ao veículo, valores dentro dos limites técnicos
  for it in select x from jsonb_array_elements(p_payload -> 'items') x loop
    v_pos := private.tire_position_key(it ->> 'position_code');
    if v_pos is null or not exists (select 1 from private.tire_expected_positions(p_organization_id, v_vehicle, v_latest) e where e.code = v_pos) then
      raise exception 'Posição "%" não pertence a este veículo.', coalesce(it ->> 'position_code', '')
        using errcode = 'invalid_parameter_value', hint = 'POSICAO_NAO_ENCONTRADA';
    end if;
    v_fire := private.tire_fire_number(it ->> 'fire_number_read');
    if v_fire is not null and v_fire !~ '^[0-9A-Z][0-9A-Z./_-]{0,29}$' then
      raise exception 'Nº Fogo inválido na posição %.', v_pos using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from unnest(array[it ->> 'tread_1', it ->> 'tread_2', it ->> 'tread_3', it ->> 'tread_4']) x
                where x is not null and btrim(x) <> ''
                  and (private.tire_cell_num(to_jsonb(x)) = 'NaN' or private.tire_cell_num(to_jsonb(x)) < 0
                       or private.tire_cell_num(to_jsonb(x)) > p.max_valid_tread_mm)) then
      raise exception 'Sulco inválido na posição % (aceito de 0 a % mm).', v_pos, p.max_valid_tread_mm using errcode = 'invalid_parameter_value';
    end if;
    if nullif(btrim(it ->> 'psi_read'), '') is not null and (private.tire_cell_num(it -> 'psi_read') = 'NaN'
        or private.tire_cell_num(it -> 'psi_read') < 0 or private.tire_cell_num(it -> 'psi_read') > p.max_valid_psi) then
      raise exception 'PSI inválido na posição % (aceito de 0 a %).', v_pos, p.max_valid_psi using errcode = 'invalid_parameter_value';
    end if;
    if length(coalesce(it ->> 'observation', '')) > 500 then
      raise exception 'Observação da posição % acima de 500 caracteres.', v_pos using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  if v_parent is not null then
    select * into v_parent_r from public.tire_inspections i where i.id = v_parent and i.organization_id = p_organization_id for update;
    if v_parent_r.id is null or v_parent_r.vehicle_id <> v_vehicle or v_parent_r.status <> 'retornar_divergencia' then
      raise exception 'A vistoria de origem não está retornada para nova medição deste veículo.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  select * into v_actor from private.checklist_actor(p_organization_id) limit 1;
  select * into v_layout from private.tire_vehicle_layout(p_organization_id, v_vehicle, v_latest) limit 1;
  v_protocol := private.next_entity_code(p_organization_id, 'tire_inspection:' || to_char(v_date, 'YYYY'), 'PNEU-' || to_char(v_date, 'YYYY') || '-', 6);

  insert into public.tire_inspections (
    organization_id, protocol, client_submission_id, app_id, parent_inspection_id, vehicle_id, license_plate_snapshot, fleet_code_snapshot,
    vehicle_type_id, context_date, context_source, operation_id, operation_city_id, state_id, city_id, operation_br_id,
    fidelization_assignment_id, organization_unit_id, leader_employee_id, operation_name_snapshot, city_name_snapshot,
    state_uf_snapshot, br_code_snapshot, unit_name_snapshot, leader_name_snapshot, vehicle_type_name_snapshot,
    inspector_user_id, inspector_employee_id, inspector_name_snapshot, inspector_code_snapshot,
    inspection_date, started_at, inspected_at, reference_snapshot_date, reference_batch_id, layout_source, layout_id,
    general_observation, status)
  values (
    p_organization_id, v_protocol, v_sub, (v_ctx ->> 'app_id')::uuid, v_parent, v_vehicle, v_ctx ->> 'license_plate', v_ctx ->> 'fleet_code',
    (v_ctx ->> 'vehicle_type_id')::uuid, v_date, v_ctx ->> 'source', (v_ctx ->> 'operation_id')::uuid, (v_ctx ->> 'operation_city_id')::uuid,
    (v_ctx ->> 'state_id')::smallint, (v_ctx ->> 'city_id')::integer, (v_ctx ->> 'operation_br_id')::uuid,
    (v_ctx ->> 'fidelization_assignment_id')::uuid, (v_ctx ->> 'organization_unit_id')::uuid, (v_ctx ->> 'leader_employee_id')::uuid,
    v_ctx ->> 'operation_name', v_ctx ->> 'city_name', v_ctx ->> 'state_uf', v_ctx ->> 'br_code', v_ctx ->> 'unit_name', v_ctx ->> 'leader_name',
    (select vt.name from public.vehicle_types vt where vt.id = (v_ctx ->> 'vehicle_type_id')::uuid),
    auth.uid(), v_actor.employee_id, coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)), v_actor.employee_code,
    v_date, nullif(p_payload ->> 'started_at', '')::timestamptz, v_at, v_latest,
    (select b.id from public.tire_import_batches b where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_latest),
    coalesce(v_layout.layout_source, 'snapshot'), v_layout.layout_id,
    nullif(btrim(p_payload ->> 'general_observation'), ''), 'pendente_revisao')
  returning id into v_id;

  -- itens: todas as posições esperadas (as não medidas também), com a
  -- referência oficial congelada e as divergências calculadas aqui
  with exp as (select * from private.tire_expected_positions(p_organization_id, v_vehicle, v_latest)),
  sent as (
    select private.tire_position_key(x ->> 'position_code') as code,
           private.tire_fire_number(x ->> 'fire_number_read') as fire,
           private.tire_cell_num(x -> 'tread_1') as t1, private.tire_cell_num(x -> 'tread_2') as t2,
           private.tire_cell_num(x -> 'tread_3') as t3, private.tire_cell_num(x -> 'tread_4') as t4,
           private.tire_cell_num(x -> 'psi_read') as psi, nullif(btrim(x ->> 'observation'), '') as obs
      from jsonb_array_elements(p_payload -> 'items') x),
  j as (
    select exp.code, exp.label, exp.sort_order, sent.fire, sent.t1, sent.t2, sent.t3, sent.t4, sent.psi, sent.obs,
           (sent.fire is not null or sent.t1 is not null or sent.t2 is not null or sent.t3 is not null or sent.t4 is not null or sent.psi is not null) as measured,
           ref.id as ref_id, ref.tire_id as ref_tire, ref.fire_number as ref_fire, ref.tread_1 as r1, ref.tread_2 as r2, ref.tread_3 as r3,
           ref.tread_4 as r4, ref.tread_min as rmin, ref.psi as rpsi, ref.measurement_date as rmd, ref.calibration_date as rcd,
           elsewhere.label as found_at
      from exp
      left join sent on sent.code = exp.code
      left join lateral (select s.* from public.tire_daily_snapshots s
                          where s.organization_id = p_organization_id and s.reference_date = v_latest and s.vehicle_id = v_vehicle
                            and s.position_code = exp.code and s.canonical_status = 'em_uso'
                          order by s.fire_number limit 1) ref on true
      left join lateral (select coalesce('frota ' || coalesce(s.fleet_number_snapshot, s.fleet_number_raw) || ', posição ' || s.position_code,
                                         'situação ' || s.canonical_status) as label
                           from public.tire_daily_snapshots s
                          where s.organization_id = p_organization_id and s.reference_date = v_latest and sent.fire is not null
                            and s.fire_number = sent.fire and not (s.vehicle_id is not distinct from v_vehicle and s.position_code = exp.code)
                          limit 1) elsewhere on true),
  d as (
    select j.*,
      to_jsonb(array_remove(array[
        case when j.measured and j.ref_id is null then jsonb_build_object('type', 'SEM_REFERENCIA',
             'detail', 'A base oficial (Rodopar) não tem pneu em uso nesta posição.') end,
        case when j.measured and j.ref_id is not null and j.fire is not null and j.fire <> j.ref_fire then jsonb_build_object('type', 'PNEU_DIFERENTE',
             'detail', format('Nº Fogo lido %s difere do esperado %s.', j.fire, j.ref_fire)) end,
        case when j.measured and j.found_at is not null then jsonb_build_object('type', 'POSICAO_NAO_ENCONTRADA',
             'detail', format('Na base oficial (Rodopar) o Nº Fogo %s está em %s.', j.fire, j.found_at)) end,
        case when j.measured and j.ref_id is not null and (
               (j.t1 is not null and j.r1 is not null and abs(j.t1 - j.r1) > p.inspection_tread_tolerance_mm)
            or (j.t2 is not null and j.r2 is not null and abs(j.t2 - j.r2) > p.inspection_tread_tolerance_mm)
            or (j.t3 is not null and j.r3 is not null and abs(j.t3 - j.r3) > p.inspection_tread_tolerance_mm)
            or (j.t4 is not null and j.r4 is not null and abs(j.t4 - j.r4) > p.inspection_tread_tolerance_mm))
             then jsonb_build_object('type', 'SULCO_DIVERGENTE', 'detail', concat_ws(' · ',
               case when j.t1 is not null and j.r1 is not null and abs(j.t1 - j.r1) > p.inspection_tread_tolerance_mm then format('S1: %s × %s mm', j.t1, j.r1) end,
               case when j.t2 is not null and j.r2 is not null and abs(j.t2 - j.r2) > p.inspection_tread_tolerance_mm then format('S2: %s × %s mm', j.t2, j.r2) end,
               case when j.t3 is not null and j.r3 is not null and abs(j.t3 - j.r3) > p.inspection_tread_tolerance_mm then format('S3: %s × %s mm', j.t3, j.r3) end,
               case when j.t4 is not null and j.r4 is not null and abs(j.t4 - j.r4) > p.inspection_tread_tolerance_mm then format('S4: %s × %s mm', j.t4, j.r4) end)) end,
        case when j.measured and j.ref_id is not null and j.psi is not null and j.rpsi is not null and abs(j.psi - j.rpsi) > p.inspection_psi_tolerance
             then jsonb_build_object('type', 'PSI_DIVERGENTE', 'detail', format('PSI lido %s × oficial %s.', j.psi, j.rpsi)) end,
        case when not j.measured then jsonb_build_object('type', 'MEDICAO_INCOMPLETA', 'detail', 'Posição não medida.')
             when j.fire is null or j.t1 is null or j.t2 is null or j.t3 is null or j.t4 is null or j.psi is null
             then jsonb_build_object('type', 'MEDICAO_INCOMPLETA', 'detail', 'Faltou: ' || concat_ws(', ',
               case when j.fire is null then 'Nº Fogo' end, case when j.t1 is null then 'S1' end, case when j.t2 is null then 'S2' end,
               case when j.t3 is null then 'S3' end, case when j.t4 is null then 'S4' end, case when j.psi is null then 'PSI' end)) end
      ], null)) as divs
      from j)
  insert into public.tire_inspection_items (
    organization_id, inspection_id, position_code, position_label_snapshot, sort_order, measured, fire_number_read,
    tread_1, tread_2, tread_3, tread_4, psi_read, observation, expected_tire_id, expected_fire_number, ref_snapshot_id,
    ref_tread_1, ref_tread_2, ref_tread_3, ref_tread_4, ref_tread_min, ref_psi, ref_measurement_date, ref_calibration_date,
    divergences, has_divergence, sync_status)
  select p_organization_id, v_id, d.code, d.label, d.sort_order, d.measured, d.fire, d.t1, d.t2, d.t3, d.t4, d.psi, d.obs,
         d.ref_tire, d.ref_fire, d.ref_id, d.r1, d.r2, d.r3, d.r4, d.rmin, d.rpsi, d.rmd, d.rcd,
         coalesce(d.divs, '[]'::jsonb),
         exists (select 1 from jsonb_array_elements(coalesce(d.divs, '[]'::jsonb)) x where x ->> 'type' <> 'MEDICAO_INCOMPLETA'),
         case when d.measured then 'pending' else 'not_applicable' end
    from d;

  select count(*), count(*) filter (where i.measured), count(*) filter (where i.has_divergence),
         coalesce(sum(jsonb_array_length(i.divergences)), 0)
    into n_expected, n_measured, n_div, n_divs
    from public.tire_inspection_items i where i.inspection_id = v_id;
  if n_measured = 0 then
    raise exception 'Meça ao menos uma posição antes de enviar.' using errcode = 'invalid_parameter_value';
  end if;
  update public.tire_inspections set positions_expected = n_expected, positions_measured = n_measured,
         positions_divergent = n_div, divergence_count = n_divs
   where id = v_id;

  insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, actor_user_id, actor_name)
  values (p_organization_id, v_id, null, 'pendente_revisao', 'Vistoria enviada pelo aplicativo (leitura cega).', 'user', auth.uid(),
          coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)));

  if v_parent_r.id is not null then
    update public.tire_inspections set status = 'substituida', updated_at = now() where id = v_parent_r.id;
    insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, actor_user_id, actor_name)
    values (p_organization_id, v_parent_r.id, 'retornar_divergencia', 'substituida', format('Nova medição enviada: protocolo %s.', v_protocol),
            'system', auth.uid(), coalesce(v_actor.employee_name, private.tire_actor_name(p_organization_id)));
  end if;

  perform private.emit_event(p_organization_id, 'tires.inspection.submitted', 'tire_inspection', v_id,
    jsonb_build_object('protocol', v_protocol, 'vehicle_id', v_vehicle, 'positions_measured', n_measured));

  -- o retorno ao campo é cego: nenhum valor oficial e nenhuma divergência
  return jsonb_build_object('id', v_id, 'protocol', v_protocol, 'submitted_at', now(),
                            'positions_expected', n_expected, 'positions_measured', n_measured, 'duplicate', false);
end;
$$;

create or replace function private.tire_reconcile_inspections(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b     public.tire_import_batches;
  p     public.tire_parameter_sets;
  r     record;
  n_checked integer := 0; n_synced integer := 0; n_persistent integer := 0; n_pending integer := 0;
begin
  select * into b from public.tire_import_batches x where x.id = p_batch_id and x.organization_id = p_organization_id;
  if b.id is null then return '{}'::jsonb; end if;
  p := private.tire_params_at(p_organization_id, b.reference_date);

  -- itens medidos de vistorias aprovadas, comparados com a nova fotografia
  with it as (
    select it.id, it.inspection_id, i.inspection_date, it.fire_number_read, it.tread_1, it.tread_2, it.tread_3, it.tread_4, it.psi_read,
           ns.id as ns_id, ns.fire_number, ns.tread_1 as n1, ns.tread_2 as n2, ns.tread_3 as n3, ns.tread_4 as n4, ns.psi as npsi,
           ns.measurement_date, ns.calibration_date
      from public.tire_inspection_items it
      join public.tire_inspections i on i.id = it.inspection_id
      left join lateral (select s.* from public.tire_daily_snapshots s
                          where s.import_batch_id = b.id and not s.removed_in_revision and s.vehicle_id = i.vehicle_id and s.position_code = it.position_code
                            and s.canonical_status = 'em_uso' order by s.fire_number limit 1) ns on true
     where i.organization_id = p_organization_id and i.status = 'pendente_rodopar' and it.measured),
  ev as (
    select it.*,
      (it.fire_number_read is null or it.fire_number_read = it.fire_number) as fire_ok,
      ((it.tread_1 is null or (it.n1 is not null and abs(it.tread_1 - it.n1) <= p.inspection_tread_tolerance_mm))
       and (it.tread_2 is null or (it.n2 is not null and abs(it.tread_2 - it.n2) <= p.inspection_tread_tolerance_mm))
       and (it.tread_3 is null or (it.n3 is not null and abs(it.tread_3 - it.n3) <= p.inspection_tread_tolerance_mm))
       and (it.tread_4 is null or (it.n4 is not null and abs(it.tread_4 - it.n4) <= p.inspection_tread_tolerance_mm))) as tread_ok,
      (it.psi_read is null or (it.npsi is not null and abs(it.psi_read - it.npsi) <= p.inspection_psi_tolerance)) as psi_ok,
      ((coalesce(it.tread_1, it.tread_2, it.tread_3, it.tread_4) is null or it.measurement_date >= it.inspection_date)
       and (it.psi_read is null or it.calibration_date >= it.inspection_date)) as launched
      from it),
  res as (
    select ev.id, ev.ns_id,
      case when ev.ns_id is null then 'pending'
           when ev.fire_ok and ev.tread_ok and ev.psi_ok then 'synced'
           when ev.launched or not ev.fire_ok then 'persistent'
           else 'pending' end as st,
      case when ev.ns_id is null then 'Os novos dados Rodopar não têm pneu em uso nesta posição.'
           when ev.fire_ok and ev.tread_ok and ev.psi_ok then 'Valores medidos encontrados na base oficial (Rodopar).'
           when ev.launched or not ev.fire_ok then concat_ws(' · ', case when not ev.fire_ok then 'Nº Fogo continua diferente' end,
                 case when not ev.tread_ok then 'sulcos continuam diferentes' end, case when not ev.psi_ok then 'PSI continua diferente' end)
           else 'Medição ainda não lançada no Rodopar (datas da base oficial anteriores à vistoria).' end as note
      from ev)
  update public.tire_inspection_items x set sync_status = res.st, synced_snapshot_id = res.ns_id, sync_note = res.note, updated_at = now()
    from res where x.id = res.id;

  for r in
    select i.id, i.protocol, i.vehicle_id, i.leader_employee_id,
           count(*) filter (where it.measured) as measured,
           count(*) filter (where it.sync_status = 'synced') as synced,
           count(*) filter (where it.sync_status = 'persistent') as persistent,
           count(*) filter (where it.measured and it.sync_status = 'pending') as pending
      from public.tire_inspections i join public.tire_inspection_items it on it.inspection_id = i.id
     where i.organization_id = p_organization_id and i.status = 'pendente_rodopar'
     group by i.id
  loop
    n_checked := n_checked + 1;
    if r.measured > 0 and r.synced = r.measured then
      n_synced := n_synced + 1;
      update public.tire_inspections set status = 'sincronizado_rodopar', synced_batch_id = b.id, synced_at = now(),
             persistent_divergence = false, last_reconciled_batch_id = b.id, last_reconciled_at = now(), updated_at = now(),
             sync_result = jsonb_build_object('batch_id', b.id, 'reference_date', b.reference_date, 'synced', r.synced, 'manual', false)
       where id = r.id;
      insert into public.tire_inspection_status_history (organization_id, inspection_id, from_status, to_status, reason, source, import_batch_id)
      values (p_organization_id, r.id, 'pendente_rodopar', 'sincronizado_rodopar',
              format('Sincronizada automaticamente pelos dados Rodopar de %s.', to_char(b.reference_date, 'DD/MM/YYYY')), 'import', b.id);
    else
      if r.persistent > 0 then n_persistent := n_persistent + 1; else n_pending := n_pending + 1; end if;
      update public.tire_inspections set persistent_divergence = r.persistent > 0, last_reconciled_batch_id = b.id,
             last_reconciled_at = now(), updated_at = now(),
             sync_result = jsonb_build_object('batch_id', b.id, 'reference_date', b.reference_date, 'synced', r.synced,
                                              'persistent', r.persistent, 'pending', r.pending, 'manual', false)
       where id = r.id;
      if r.persistent > 0 then
        perform private.emit_event(p_organization_id, 'tires.inspection.persistent_divergence', 'tire_inspection', r.id,
          jsonb_build_object('protocol', r.protocol, 'vehicle_id', r.vehicle_id, 'leader_employee_id', r.leader_employee_id,
                             'batch_id', b.id, 'reference_date', b.reference_date));
      end if;
    end if;
  end loop;

  return jsonb_build_object('checked', n_checked, 'synced', n_synced, 'persistent', n_persistent, 'pending', n_pending);
end;
$$;

create or replace function private.tire_resolve_vehicle_at(p_organization_id uuid, p_tire_id uuid, p_date date)
returns table (vehicle_id uuid, license_plate text, fleet_code text, position_code text, resolution text,
               reference_date date, confidence text, message text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s  public.tire_daily_snapshots;
  ev public.tire_events;
  p  public.tire_parameter_sets := private.tire_params_at(p_organization_id, p_date);
begin
  select x.* into s from public.tire_daily_snapshots x
   where x.tire_id = p_tire_id and x.organization_id = p_organization_id and x.reference_date <= p_date
   order by x.reference_date desc limit 1;
  if s.id is not null and s.vehicle_id is not null and s.canonical_status = 'em_uso' then
    return query select s.vehicle_id, v.license_plate, v.fleet_code, s.position_code,
      case when s.reference_date = p_date then 'snapshot_exact' else 'snapshot_previous' end, s.reference_date,
      case when s.reference_date = p_date or p_date - s.reference_date <= p.repair_resolution_max_age_days then 'high' else 'medium' end,
      case when s.reference_date = p_date then 'Dados Rodopar da própria data.'
           else format('Dados Rodopar de %s (%s dias antes).', to_char(s.reference_date, 'DD/MM/YYYY'), p_date - s.reference_date) end
      from public.vehicles v where v.id = s.vehicle_id;
    return;
  end if;
  -- sem fotografia anterior em uso: o veículo de onde o pneu saiu no primeiro
  -- movimento posterior à data
  select x.* into ev from public.tire_events x
   where x.tire_id = p_tire_id and x.organization_id = p_organization_id and x.reference_date > p_date
     and x.event_type in ('TIRE_MOVED', 'TIRE_REMOVED', 'TIRE_RETURNED_TO_STOCK', 'TIRE_SENT_TO_RETREAD', 'TIRE_DISCARDED')
     and x.previous_vehicle_id is not null
   order by x.reference_date limit 1;
  if ev.id is not null and s.id is null then
    return query select ev.previous_vehicle_id, v.license_plate, v.fleet_code, ev.previous_position_code, 'event', ev.reference_date,
      'medium', format('Movimentação registrada em %s: o pneu saiu deste veículo.', to_char(ev.reference_date, 'DD/MM/YYYY'))
      from public.vehicles v where v.id = ev.previous_vehicle_id;
    return;
  end if;
  return query select null::uuid, null::text, null::text, null::text, 'unresolved'::text, s.reference_date, null::text,
    case when s.id is null then 'Nenhum registro Rodopar do pneu até esta data.'
         else format('Nos dados Rodopar de %s o pneu não estava em uso em um veículo (%s).', to_char(s.reference_date, 'DD/MM/YYYY'), s.canonical_status) end;
end;
$$;

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
      raise exception 'O veículo informado difere do resolvido pelos dados Rodopar: justifique (mínimo de 5 caracteres).'
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
