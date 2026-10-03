-- =============================================================================
-- 31 · Gestão de MTSR — motor, vistorias, ingestão, manutenção, importação, RBAC
--
-- Suíte transacional contra o banco COM DADOS: usa dois veículos ativos
-- elegíveis ao app Vistoria MTSR e o catálogo oficial (componentes, fontes,
-- serviços de Manutenção). Não cria veículo, usuário nem catálogo. Termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO: devolve o resultado e
-- desfaz tudo o que fez (inclusive a manutenção aberta e os eventos).
--
--   M1  prazo parametrizado (≤29 CONFORME · 30–45 ATENÇÃO · >45 VENCIDO · sem = PENDENTE)
--   M2  envio do app: protocolo, idempotência por client_submission_id, estado
--       oficial NÃO muda no envio, validações (faltou componente, backoffice no
--       campo, evidência fora da área, OK sem foto)
--   M3  validação: só componentes de campo viram oficiais; histórico; criticidade
--       NOK+CONFORME = MÉDIA; componente principal por prioridade; idempotente
--   M4  backoffice: atualização manual com histórico; vistoria de campo não
--       sobrescreve componente backoffice
--   M5  última vistoria válida avança, nunca retrocede
--   M6  retornar / rejeitar com motivo (mínimo 5), rejeitada não valida
--   M7  ingestão: aplicado, duplicado (hash), stale, conflito por prioridade,
--       rejeições (veículo/componente/status/data futura), fonte indisponível
--   M8  manutenção corporativa: abrir de NOK (origem mtsr, serviço padrão do
--       catálogo), duplicidade, vínculo, conclusão → AGUARDANDO REVALIDAÇÃO
--       (estado oficial inalterado), revalidação pela vistoria, desvínculo
--   M9  importação histórica: prévia (placa desconhecida, data futura, valor
--       parcial), processamento idempotente, facts, histórico de lotes
--   M10 cadastros: parâmetros com vigência, nomenclatura CFTV/sirene, fonte
--       indisponível não habilita, serviços desativados (não excluídos)
--   M11 leitura: ficha 360°, dashboard, matriz, saúde, eventos; exportação auditada
--   M12 retenção de evidências parametrizada (não hardcode)
--   M13 RBAC/RLS: não membro não lê nem executa; RLS filtra tabelas
--
-- Última execução: 59/59 PASS contra o projeto de produção (03/10/2026), com
-- rollback. Fixture usada: veículos SNM9H96 e SNM9I66 (elegíveis ao app).
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_other uuid := gen_random_uuid();
  v_veh record; v_veh2 record; v_ctx jsonb; v_res jsonb; v_res2 jsonb; v_res3 jsonb; v_err text; v_hint text;
  c_mdvr uuid; c_cam uuid; c_tec uuid; c_tl uuid; c_tt uuid; c_sir uuid; c_geo uuid;
  v_sub uuid; v_sub2 uuid; v_sub3 uuid; v_sub4 uuid; v_sub5 uuid; v_pfx text;
  v_insp1 uuid; v_insp2 uuid; v_insp3 uuid; v_insp4 uuid; v_insp5 uuid;
  v_item_tl uuid; v_m uuid; v_link uuid; v_link2 uuid; v_mitem uuid; v_batch uuid; v_svc uuid; v_svc2 uuid; v_src uuid;
  p public.mtsr_parameter_sets; e record; st record; ev record; f record; lk record;
  n bigint; n2 bigint; n3 bigint;
  r text := ''; np int := 0; nf int := 0;
  items jsonb; ok_item jsonb; nok_item jsonb;
begin
  create temp table if not exists t_res (seq serial, ok boolean, label text);
  set constraints all immediate;

  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m join public.membership_roles mr on mr.membership_id = m.id
    join public.roles ro on ro.id = mr.role_id
   where m.organization_id = v_org and m.status = 'active' and ro.code = 'administrador' order by m.created_at limit 1;
  v_today := private.maintenance_today(v_org);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  select c.id into c_mdvr from public.mtsr_components c where c.organization_id = v_org and c.code = 'mdvr';
  select c.id into c_cam  from public.mtsr_components c where c.organization_id = v_org and c.code = 'cameras';
  select c.id into c_tec  from public.mtsr_components c where c.organization_id = v_org and c.code = 'teclado_macro';
  select c.id into c_tl   from public.mtsr_components c where c.organization_id = v_org and c.code = 'travas_bau_lateral';
  select c.id into c_tt   from public.mtsr_components c where c.organization_id = v_org and c.code = 'travas_bau_traseiro';
  select c.id into c_sir  from public.mtsr_components c where c.organization_id = v_org and c.code = 'sirene_sistema';
  select c.id into c_geo  from public.mtsr_components c where c.organization_id = v_org and c.code = 'geotab';

  -- dois veículos elegíveis ao app, sem nenhum dado MTSR
  v_res := public.mtsr_inspection_vehicles(v_org);
  select (x ->> 'id')::uuid as id, x ->> 'license_plate' as plate, (x ->> 'operation_id')::uuid as op into v_veh
    from jsonb_array_elements(v_res -> 'vehicles') x
   where not exists (select 1 from public.mtsr_component_status s where s.vehicle_id = (x ->> 'id')::uuid)
     and not exists (select 1 from public.mtsr_inspections i where i.vehicle_id = (x ->> 'id')::uuid)
   order by x ->> 'license_plate' limit 1;
  select (x ->> 'id')::uuid as id, x ->> 'license_plate' as plate into v_veh2
    from jsonb_array_elements(v_res -> 'vehicles') x
   where (x ->> 'id')::uuid <> v_veh.id
     and not exists (select 1 from public.mtsr_component_status s where s.vehicle_id = (x ->> 'id')::uuid)
   order by x ->> 'license_plate' limit 1;
  if v_veh.id is null or v_veh2.id is null or c_sir is null or c_tl is null then
    raise exception E'ROLLBACK_TESTES\nSEM FIXTURE: precisa de 2 veículos elegíveis sem dados MTSR e do catálogo de componentes.';
  end if;

  -- ---------------------------------------------------------------- M1 prazo
  p := private.mtsr_params_at(v_org, v_today);
  insert into t_res (ok, label) values (p.conforme_max_days = 29 and p.attention_min_days = 30 and p.attention_max_days = 45, 'M1 parâmetros vigentes 29/30/45 (sem hardcode no motor)');
  insert into t_res (ok, label) values (private.mtsr_deadline_status(null, p) = 'pendente' and private.mtsr_deadline_status(0, p) = 'conforme'
    and private.mtsr_deadline_status(29, p) = 'conforme' and private.mtsr_deadline_status(30, p) = 'atencao'
    and private.mtsr_deadline_status(45, p) = 'atencao' and private.mtsr_deadline_status(46, p) = 'vencido', 'M1 faixas de prazo: sem=PENDENTE, 0/29=CONFORME, 30/45=ATENÇÃO, 46=VENCIDO');
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values (e.deadline_status = 'pendente' and e.conformity_status = 'sem_informacao' and e.criticality = 'sem_criticidade' and e.nok_count = 0, 'M1 veículo sem dados: PENDENTE · SEM INFORMAÇÃO · SEM CRITICIDADE');

  -- ---------------------------------------------------------------- M2 envio
  v_ctx := public.mtsr_inspection_context(v_org);
  insert into t_res (ok, label) values ((v_ctx ->> 'available')::boolean and jsonb_array_length(v_ctx -> 'components') = 4
    and jsonb_array_length(v_ctx -> 'backoffice_components') = 3 and (v_ctx -> 'evidence' ->> 'bucket') = 'mtsr-evidence', 'M2 contexto do app: disponível, 4 componentes de campo, 3 backoffice, bucket privado');

  v_sub := gen_random_uuid();
  v_pfx := v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub::text || '/';
  items := jsonb_build_array(
    jsonb_build_object('component_id', c_tec, 'status', 'ok',  'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'tec/1.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 1000))),
    jsonb_build_object('component_id', c_tl,  'status', 'nok', 'observation', 'Trava lateral quebrada', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'tl/1.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 1000))),
    jsonb_build_object('component_id', c_tt,  'status', 'ok',  'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'tt/1.jpg', 'mime_type', 'image/webp', 'size_bytes', 1000))),
    jsonb_build_object('component_id', c_sir, 'status', 'nok', 'observation', 'Sirene não aciona', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'sir/1.jpg', 'mime_type', 'image/png', 'size_bytes', 1000))));
  v_res := public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub, 'vehicle_id', v_veh.id, 'items', items, 'general_observation', 'teste'));
  v_insp1 := (v_res ->> 'id')::uuid;
  insert into t_res (ok, label) values (v_res ->> 'protocol' like 'MTSR-' || to_char(v_today, 'YYYY') || '-%' and (v_res ->> 'nok_count')::int = 2 and (v_res ->> 'item_count')::int = 4
    and (v_res ->> 'evidence_count')::int = 4 and not (v_res ->> 'duplicate')::boolean, 'M2 envio: protocolo MTSR-AAAA-NNNNNN, 4 itens, 2 NOK, 4 evidências');
  v_res2 := public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub, 'vehicle_id', v_veh.id, 'items', items));
  insert into t_res (ok, label) values ((v_res2 ->> 'duplicate')::boolean and (v_res2 ->> 'id')::uuid = v_insp1
    and (select count(*) from public.mtsr_inspections i where i.client_submission_id = v_sub) = 1, 'M2 reenvio com o mesmo client_submission_id não duplica');
  insert into t_res (ok, label) values (not exists (select 1 from public.mtsr_component_status s where s.vehicle_id = v_veh.id)
    and (select i.status from public.mtsr_inspections i where i.id = v_insp1) = 'pendente_validacao'
    and (select operation_id from public.mtsr_inspections i where i.id = v_insp1) = v_veh.op, 'M2 envio não altera o estado oficial; fica Pendente de validação com contexto (IDs) da operação');
  insert into t_res (ok, label) values (exists (select 1 from public.mtsr_events x where x.inspection_id = v_insp1 and x.event_type = 'VISTORIA_ENVIADA' and x.actor_user_id = v_user and x.actor_name is not null), 'M2 evento VISTORIA_ENVIADA com ator identificado (não "Sistema")');
  -- validações
  v_sub5 := gen_random_uuid();
  begin
    perform public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub5, 'vehicle_id', v_veh.id, 'items', replace((items - 3)::text, v_sub::text, v_sub5::text)::jsonb));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Todos os componentes de campo%', 'M2 recusa vistoria sem todos os componentes de campo');
  v_sub5 := gen_random_uuid();
  begin
    perform public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub5, 'vehicle_id', v_veh.id,
      'items', replace((items || jsonb_build_array(jsonb_build_object('component_id', c_mdvr, 'status', 'ok')))::text, v_sub::text, v_sub5::text)::jsonb));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like '%verificado pelo backoffice%', 'M2 recusa componente BACKOFFICE na vistoria de campo');
  v_sub5 := gen_random_uuid();
  begin
    perform public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub5, 'vehicle_id', v_veh.id,
      'items', jsonb_set(replace(items::text, v_sub::text, v_sub5::text)::jsonb, '{0,evidence,0,storage_path}', to_jsonb('outro/caminho.jpg'::text))));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Evidência fora da área%', 'M2 recusa evidência fora da área privada do envio');
  v_sub5 := gen_random_uuid();
  begin
    perform public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub5, 'vehicle_id', v_veh.id,
      'items', jsonb_set(replace(items::text, v_sub::text, v_sub5::text)::jsonb, '{0,evidence}', '[]'::jsonb)));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Anexe a foto%', 'M2 política de evidência: OK sem foto é recusado (configurável por componente)');

  -- ---------------------------------------------------------------- M3 validação
  v_res := public.mtsr_inspection_validate(v_org, v_insp1);
  insert into t_res (ok, label) values ((v_res ->> 'applied')::int = 4 and (v_res ->> 'skipped')::int = 0 and (v_res ->> 'nok')::int = 2 and (v_res ->> 'last_valid_advanced')::boolean, 'M3 validação aplica os 4 componentes de campo e avança a última vistoria válida');
  select count(*) into n from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.status = 'nok' and s.component_id in (c_tl, c_sir) and s.source_type = 'field_inspection';
  select count(*) into n2 from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.status = 'ok' and s.component_id in (c_tec, c_tt);
  select count(*) into n3 from public.mtsr_component_status_history h where h.vehicle_id = v_veh.id and h.inspection_id = v_insp1;
  insert into t_res (ok, label) values (n = 2 and n2 = 2 and n3 = 4, 'M3 estado oficial: 2 NOK + 2 OK com 4 registros de histórico');
  select * into f from public.mtsr_vehicle_facts x where x.vehicle_id = v_veh.id;
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values (f.last_valid_inspection_date = v_today and e.deadline_status = 'conforme' and e.conformity_status = 'nao_conforme'
    and e.criticality = 'media' and e.main_component_id = c_tl and e.nok_count = 2 and e.unknown_count = 3, 'M3 motor: CONFORME no prazo + NOK ⇒ NÃO CONFORME · criticidade MÉDIA · principal = Travas Baú Lateral (prioridade 40 < 50)');
  v_res2 := public.mtsr_inspection_validate(v_org, v_insp1);
  insert into t_res (ok, label) values ((v_res2 ->> 'already_validated')::boolean and (select count(*) from public.mtsr_component_status_history h where h.vehicle_id = v_veh.id) = 4, 'M3 revalidar a mesma vistoria é idempotente (sem novo histórico)');
  insert into t_res (ok, label) values (exists (select 1 from public.mtsr_events x where x.inspection_id = v_insp1 and x.event_type = 'VISTORIA_VALIDADA')
    and (select count(*) from public.mtsr_events x where x.vehicle_id = v_veh.id and x.event_type = 'NOK_IDENTIFICADO') = 2, 'M3 eventos VISTORIA_VALIDADA + 2× NOK_IDENTIFICADO');

  -- ---------------------------------------------------------------- M4 backoffice
  v_res := public.mtsr_component_status_update(v_org, jsonb_build_object('vehicle_id', v_veh.id, 'reference_date', v_today,
    'items', jsonb_build_array(jsonb_build_object('component_id', c_mdvr, 'status', 'nok', 'observation', 'MDVR sem gravação'),
                               jsonb_build_object('component_id', c_geo, 'status', 'ok')), 'source_system', 'Teste'));
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values ((v_res ->> 'applied')::int = 2 and e.nok_count = 3 and e.main_component_id = c_mdvr and e.unknown_count = 1
    and exists (select 1 from public.mtsr_events x where x.vehicle_id = v_veh.id and x.event_type = 'ATUALIZACAO_BACKOFFICE'), 'M4 atualização backoffice: MDVR NOK vira principal (prioridade 10), Geotab OK, evento ATUALIZACAO_BACKOFFICE');
  begin
    perform public.mtsr_component_status_update(v_org, jsonb_build_object('vehicle_id', v_veh.id, 'reference_date', v_today,
      'items', jsonb_build_array(jsonb_build_object('component_id', c_cam, 'status', 'nok'))));
    v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Descreva a inconformidade%', 'M4 NOK manual exige observação');

  -- ---------------------------------------------------------------- M5 nunca retrocede
  v_sub2 := gen_random_uuid(); v_pfx := v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub2::text || '/';
  items := jsonb_build_array(
    jsonb_build_object('component_id', c_tec, 'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'a.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_tl,  'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'b.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_tt,  'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'c.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_sir, 'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'd.jpg', 'mime_type', 'image/jpeg'))));
  v_res := public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub2, 'vehicle_id', v_veh.id, 'inspected_at', (v_today - 5)::timestamp + time '10:00', 'items', items));
  v_insp2 := (v_res ->> 'id')::uuid;
  v_res := public.mtsr_inspection_validate(v_org, v_insp2);
  select * into f from public.mtsr_vehicle_facts x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values (not (v_res ->> 'last_valid_advanced')::boolean and f.last_valid_inspection_date = v_today and f.last_valid_inspection_id = v_insp1, 'M5 vistoria antiga validada depois NÃO retrocede a última vistoria válida');
  insert into t_res (ok, label) values ((v_res ->> 'skipped_stale')::int = 4 and (v_res ->> 'applied')::int = 0
    and (select count(*) from public.mtsr_inspection_items i where i.inspection_id = v_insp2 and i.skipped_reason = 'stale') = 4
    and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.component_id = c_sir) = 'nok'
    and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.component_id = c_mdvr) = 'nok', 'M5 leitura mais antiga (stale) não sobrescreve o estado atual (4 itens marcados stale); backoffice intacto');

  -- ---------------------------------------------------------------- M6 retornar / rejeitar
  v_sub3 := gen_random_uuid(); v_pfx := v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub3::text || '/';
  v_res := public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub3, 'vehicle_id', v_veh.id,
    'items', replace(items::text, v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub2::text, v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub3::text)::jsonb));
  v_insp3 := (v_res ->> 'id')::uuid;
  begin
    perform public.mtsr_inspection_return(v_org, v_insp3, 'abc'); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Informe o motivo%', 'M6 retorno exige motivo (≥ 5 caracteres)');
  v_res := public.mtsr_inspection_return(v_org, v_insp3, 'Fotos ilegíveis, refazer');
  insert into t_res (ok, label) values (v_res ->> 'status' = 'retornada' and (select review_reason from public.mtsr_inspections where id = v_insp3) = 'Fotos ilegíveis, refazer'
    and exists (select 1 from public.mtsr_events x where x.inspection_id = v_insp3 and x.event_type = 'VISTORIA_RETORNADA' and x.reason is not null), 'M6 retornada com motivo e evento');
  v_res := public.mtsr_inspection_reject(v_org, v_insp3, 'Vistoria inválida (veículo errado)');
  begin
    perform public.mtsr_inspection_validate(v_org, v_insp3); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_res ->> 'status' = 'rejeitada' and v_err like 'Só vistorias pendentes%'
    and (select count(*) from public.mtsr_component_status_history h where h.inspection_id = v_insp3) = 0, 'M6 rejeitada não valida e não toca o estado oficial');

  -- ---------------------------------------------------------------- M7 ingestão
  v_res := public.mtsr_ingest_events(v_org, 'manual_import', jsonb_build_array(
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'geotab', 'status', 'OK', 'reference_date', v_today - 1, 'source_record_id', 'T1'),
    jsonb_build_object('license_plate', v_veh2.plate, 'component_code', 'MDVR', 'status', 'NOK', 'reference_date', v_today - 1, 'source_record_id', 'T2', 'observation', 'sem sinal'),
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'inexistente', 'status', 'OK', 'reference_date', v_today - 1, 'source_record_id', 'T3'),
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'cameras', 'status', 'talvez', 'reference_date', v_today - 1, 'source_record_id', 'T4'),
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'cameras', 'status', 'OK', 'reference_date', v_today + 1, 'source_record_id', 'T5'),
    jsonb_build_object('license_plate', 'ZZZ0000', 'component_code', 'cameras', 'status', 'OK', 'reference_date', v_today - 1, 'source_record_id', 'T6')));
  insert into t_res (ok, label) values ((v_res ->> 'applied')::int = 2 and (v_res ->> 'rejected')::int = 4
    and (select count(*) from public.mtsr_ingestion_events x where x.vehicle_id = v_veh2.id and x.status = 'applied') = 2
    and (select count(*) from public.mtsr_ingestion_events x where x.organization_id = v_org and x.status = 'rejected'
           and x.outcome_reason in ('component_not_found', 'status_unknown', 'future_date', 'vehicle_not_found')) >= 4, 'M7 ingestão: 2 aplicados (por id e por placa), 4 rejeitados com motivo (componente, status, data futura, veículo)');
  v_res2 := public.mtsr_ingest_events(v_org, 'manual_import', jsonb_build_array(
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'geotab', 'status', 'OK', 'reference_date', v_today - 1, 'source_record_id', 'T1')));
  insert into t_res (ok, label) values ((v_res2 ->> 'duplicate')::int = 1 and (v_res2 ->> 'applied')::int = 0, 'M7 reenvio idêntico é duplicado (hash), não reaplica');
  v_res2 := public.mtsr_ingest_events(v_org, 'manual_import', jsonb_build_array(
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'geotab', 'status', 'NOK', 'observation', 'x', 'reference_date', v_today - 10, 'source_record_id', 'T7')));
  insert into t_res (ok, label) values ((v_res2 ->> 'ignored')::int = 1 and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh2.id and s.component_id = c_geo) = 'ok', 'M7 leitura mais antiga é ignorada (stale)');
  -- backoffice manual (prioridade 20) na mesma data; importação (40) na mesma data vira conflito
  perform public.mtsr_component_status_update(v_org, jsonb_build_object('vehicle_id', v_veh2.id, 'reference_date', v_today - 1,
    'items', jsonb_build_array(jsonb_build_object('component_id', c_geo, 'status', 'nok', 'observation', 'Geotab sem comunicação'))));
  v_res2 := public.mtsr_ingest_events(v_org, 'manual_import', jsonb_build_array(
    jsonb_build_object('vehicle_id', v_veh2.id, 'component_code', 'geotab', 'status', 'OK', 'reference_date', v_today - 1, 'source_record_id', 'T8')));
  insert into t_res (ok, label) values ((v_res2 ->> 'conflict')::int = 1 and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh2.id and s.component_id = c_geo) = 'nok'
    and exists (select 1 from public.mtsr_events x where x.vehicle_id = v_veh2.id and x.event_type = 'INGESTAO_CONFLITO'), 'M7 fonte de menor prioridade na mesma data não sobrescreve (conflito registrado)');
  begin
    perform public.mtsr_ingest_events(v_org, 'geotab_api', '[]'::jsonb); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err is not null, 'M7 fonte indisponível/desabilitada (geotab_api) não ingere');

  -- ---------------------------------------------------------------- M8 manutenção
  select i.id into v_item_tl from public.mtsr_inspection_items i where i.inspection_id = v_insp1 and i.component_id = c_tl;
  v_res := public.mtsr_maintenance_open(v_org, jsonb_build_object('vehicle_id', v_veh.id, 'component_id', c_tl, 'inspection_item_id', v_item_tl));
  v_m := (v_res ->> 'id')::uuid; v_link := (v_res ->> 'link_id')::uuid;
  insert into t_res (ok, label) values (v_m is not null and v_res ->> 'code' is not null
    and (select o.code from public.maintenances m join public.maintenance_origins o on o.id = m.origin_id where m.id = v_m) = 'mtsr'
    and (select m.priority from public.maintenances m where m.id = v_m) = 'medium'
    and (select count(*) from public.maintenance_items it join public.mtsr_component_services cs on cs.service_id = it.service_id and cs.component_id = c_tl where it.maintenance_id = v_m) = 1
    and (select l.link_type from public.mtsr_maintenance_links l where l.id = v_link) = 'opened_from_nok', 'M8 abrir de NOK: manutenção corporativa com origem mtsr, serviço padrão do catálogo, prioridade pela criticidade (MÉDIA ⇒ medium), vínculo opened_from_nok');
  begin
    perform public.mtsr_maintenance_open(v_org, jsonb_build_object('vehicle_id', v_veh.id, 'component_id', c_tl)); v_err := null; v_hint := null;
  exception when others then get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint; end;
  insert into t_res (ok, label) values (v_hint = 'mtsr_duplicate', 'M8 segunda manutenção para o mesmo componente aberto exige justificativa (hint mtsr_duplicate)');
  v_res := public.mtsr_for_maintenance(v_m);
  v_res2 := public.mtsr_maintenance_candidates(v_org, v_veh.id, c_tt);
  insert into t_res (ok, label) values (jsonb_array_length(v_res -> 'links') = 1 and (v_res -> 'links' -> 0 ->> 'official_status') = 'nok'
    and exists (select 1 from jsonb_array_elements(v_res2) x where (x ->> 'id')::uuid = v_m and not (x ->> 'already_linked')::boolean), 'M8 drawer de Manutenção vê o vínculo; candidatas listam a manutenção para outro componente');
  v_res2 := public.mtsr_maintenance_link(v_org, jsonb_build_object('maintenance_id', v_m, 'component_id', c_tt, 'reason', 'mesma intervenção no baú'));
  v_link2 := (v_res2 ->> 'link_id')::uuid;
  insert into t_res (ok, label) values (v_link2 is not null and (select count(*) from public.mtsr_maintenance_links l where l.maintenance_id = v_m and l.status = 'active') = 2, 'M8 vincular manutenção existente a outro componente');
  perform public.mtsr_maintenance_unlink(v_org, v_link2, 'vínculo indevido');
  insert into t_res (ok, label) values ((select l.status from public.mtsr_maintenance_links l where l.id = v_link2) = 'unlinked'
    and exists (select 1 from public.mtsr_events x where x.maintenance_id = v_m and x.event_type = 'MANUTENCAO_DESVINCULADA'), 'M8 desvincular com motivo e evento');
  -- ciclo de vida: entrada → conclusão ⇒ AGUARDANDO REVALIDAÇÃO; estado oficial não muda
  perform public.maintenance_start(v_m, jsonb_build_object('entry_date', v_today));
  select it.id into v_mitem from public.maintenance_items it where it.maintenance_id = v_m limit 1;
  perform public.maintenance_complete(v_m, jsonb_build_object('exit_date', v_today, 'items', jsonb_build_array(jsonb_build_object('item_id', v_mitem, 'status', 'done'))));
  select * into st from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.component_id = c_tl;
  select * into lk from public.mtsr_maintenance_links l where l.id = v_link;
  insert into t_res (ok, label) values ((select m.status from public.maintenances m where m.id = v_m) = 'completed' and st.status = 'nok' and st.awaiting_revalidation
    and st.awaiting_maintenance_id = v_m and lk.revalidation_status = 'awaiting' and lk.maintenance_concluded_at is not null
    and exists (select 1 from public.mtsr_events x where x.maintenance_id = v_m and x.event_type = 'MANUTENCAO_CONCLUIDA'), 'M8 conclusão da manutenção ⇒ componente AGUARDANDO REVALIDAÇÃO (estado oficial segue NOK)');
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values (e.awaiting_count = 1 and e.conformity_status = 'nao_conforme', 'M8 motor reflete 1 componente aguardando revalidação; conformidade inalterada');
  -- revalidação por nova vistoria validada
  v_sub4 := gen_random_uuid(); v_pfx := v_org::text || '/inspections/drafts/' || v_user::text || '/' || v_sub4::text || '/';
  items := jsonb_build_array(
    jsonb_build_object('component_id', c_tec, 'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'a.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_tl,  'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'b.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_tt,  'status', 'ok', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'c.jpg', 'mime_type', 'image/jpeg'))),
    jsonb_build_object('component_id', c_sir, 'status', 'nok', 'observation', 'Sirene segue sem acionar', 'evidence', jsonb_build_array(jsonb_build_object('storage_path', v_pfx || 'd.jpg', 'mime_type', 'image/jpeg'))));
  v_res := public.mtsr_inspection_submit(v_org, jsonb_build_object('client_submission_id', v_sub4, 'vehicle_id', v_veh.id, 'items', items));
  v_insp4 := (v_res ->> 'id')::uuid;
  perform public.mtsr_inspection_validate(v_org, v_insp4);
  select * into st from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.component_id = c_tl;
  select * into lk from public.mtsr_maintenance_links l where l.id = v_link;
  insert into t_res (ok, label) values (st.status = 'ok' and not st.awaiting_revalidation and lk.revalidation_status = 'done' and lk.revalidated_at is not null
    and exists (select 1 from public.mtsr_events x where x.vehicle_id = v_veh.id and x.component_id = c_tl and x.event_type = 'REVALIDACAO_REALIZADA'), 'M8 nova vistoria OK revalida o componente e fecha o ciclo (REVALIDACAO_REALIZADA)');
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh.id;
  insert into t_res (ok, label) values (e.nok_count = 2 and e.main_component_id = c_mdvr and e.awaiting_count = 0, 'M8 motor após revalidação: 2 NOK (MDVR backoffice + sirene), principal MDVR');
  -- backoffice nunca sobrescrito por vistoria de campo (MDVR segue NOK após 2 validações)
  insert into t_res (ok, label) values ((select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh.id and s.component_id = c_mdvr) = 'nok'
    and (select count(*) from public.mtsr_inspection_items i where i.inspection_id in (v_insp1, v_insp4) and i.component_id in (c_mdvr, c_cam, c_geo)) = 0, 'M8 componente BACKOFFICE nunca entra nem é sobrescrito pela vistoria de campo');

  -- ---------------------------------------------------------------- M9 importação histórica
  v_res := public.stage_mtsr_import(v_org, jsonb_build_object('phase', 'all', 'file_name', 'teste.xlsx', 'file_hash', encode(sha256(v_sub::text::bytea), 'hex'), 'reference_default', v_today::text,
    'rows', jsonb_build_array(
      jsonb_build_object('row_number', 2, 'license_plate', v_veh2.plate, 'last_inspection_date', (v_today - 3)::text, 'components', jsonb_build_object('MDVR', 'OK', 'Travas Baú Lateral', 'NOK', 'Geotab', 'X', 'Teclado Macro', 'Conforme'), 'raw', '{}'::jsonb),
      jsonb_build_object('row_number', 3, 'license_plate', 'ZZZ9Z99', 'components', jsonb_build_object('MDVR', 'OK'), 'raw', '{}'::jsonb),
      jsonb_build_object('row_number', 4, 'license_plate', v_veh2.plate, 'last_inspection_date', (v_today + 2)::text, 'components', jsonb_build_object('MDVR', 'OK'), 'raw', '{}'::jsonb))));
  v_batch := (v_res ->> 'batch_id')::uuid;
  insert into t_res (ok, label) values ((v_res ->> 'total_rows')::int = 3 and (v_res ->> 'error_rows')::int = 2 and (v_res ->> 'warning_rows')::int = 1 and (v_res ->> 'valid_rows')::int = 0
    and (v_res ->> 'vehicles')::int = 1 and (v_res ->> 'cells')::int = 3 and jsonb_array_length(v_res -> 'unknown_plates') = 1
    and exists (select 1 from jsonb_array_elements(v_res -> 'findings') x where x ->> 'code' = 'import_unknown_vehicle')
    and exists (select 1 from jsonb_array_elements(v_res -> 'findings') x where x ->> 'code' = 'future_date')
    and exists (select 1 from jsonb_array_elements(v_res -> 'findings') x where x ->> 'code' = 'partial'), 'M9 prévia: 3 linhas → 1 aproveitável (parcial: "X" ignorado), placa desconhecida e data futura recusadas; nunca cria veículo');
  v_res2 := public.process_mtsr_import(v_org, v_batch);
  insert into t_res (ok, label) values ((v_res2 ->> 'done')::boolean and (v_res2 -> 'stats' ->> 'applied')::int = 2 and (v_res2 -> 'stats' ->> 'conflict')::int = 0 and (v_res2 -> 'stats' ->> 'ignored')::int = 1
    and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh2.id and s.component_id = c_tl) = 'nok'
    and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh2.id and s.component_id = c_tec) = 'ok'
    and (select s.status from public.mtsr_component_status s where s.vehicle_id = v_veh2.id and s.component_id = c_mdvr) = 'nok'
    and (select f2.last_valid_inspection_date from public.mtsr_vehicle_facts f2 where f2.vehicle_id = v_veh2.id) = v_today - 3
    and (select b.status from public.import_batches b where b.id = v_batch) = 'completed', 'M9 processamento: Travas NOK e Teclado OK aplicados, MDVR OK (mais antigo que a leitura NOK de ontem) ignorado, última vistoria = D-3');
  select * into e from private.mtsr_vehicle_eval(v_org, v_today) x where x.vehicle_id = v_veh2.id;
  insert into t_res (ok, label) values (e.deadline_status = 'conforme' and e.days_since = 3 and e.conformity_status = 'nao_conforme' and e.criticality = 'media', 'M9 veículo importado: CONFORME (3 dias) · NÃO CONFORME · MÉDIA');
  begin
    perform public.process_mtsr_import(v_org, v_batch); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like 'Esta importação já foi processada%' and exists (select 1 from jsonb_array_elements(public.mtsr_import_history(v_org, 5)) x where (x ->> 'id')::uuid = v_batch and x ->> 'status' = 'completed')
    and exists (select 1 from public.mtsr_events x where x.event_type = 'IMPORTACAO' and (x.payload ->> 'batch_id')::uuid = v_batch), 'M9 reprocessar é recusado; histórico de lotes e evento IMPORTACAO');

  -- ---------------------------------------------------------------- M10 cadastros
  v_res := public.mtsr_save_parameters(v_org, jsonb_build_object('conforme_max_days', 20, 'attention_min_days', 21, 'attention_max_days', 40, 'evidence_retention_inspections', 1, 'note', 'teste'));
  p := private.mtsr_params_at(v_org, v_today);
  insert into t_res (ok, label) values (p.conforme_max_days = 20 and p.attention_max_days = 40 and p.evidence_retention_inspections = 1 and p.effective_from = v_today
    and (select count(*) from public.mtsr_parameter_sets x where x.organization_id = v_org and x.effective_to is null) = 1
    and (select count(*) from public.mtsr_parameter_sets x where x.organization_id = v_org and x.effective_to is not null and x.effective_from > x.effective_to) = 0
    and private.mtsr_deadline_status(25, p) = 'atencao' and private.mtsr_deadline_status(41, p) = 'vencido'
    and exists (select 1 from public.mtsr_events x where x.organization_id = v_org and x.event_type = 'PARAMETROS_ALTERADOS'), 'M10 parâmetros com vigência: uma única vigência aberta a partir de hoje, motor reclassifica (25 ⇒ ATENÇÃO, 41 ⇒ VENCIDO)');
  begin
    perform public.mtsr_save_component(v_org, jsonb_build_object('name', 'Câmeras CCTV')); v_err := null;
  exception when others then v_err := sqlerrm; end;
  begin
    perform public.mtsr_save_component(v_org, jsonb_build_object('name', 'Sirene de ré')); v_err := coalesce(v_err, '') || ' | ' || 'nao';
  exception when others then v_err := coalesce(v_err, '') || ' | ' || sqlerrm; end;
  insert into t_res (ok, label) values (v_err like '%CFTV%' and v_err like '%Sirene do Sistema%', 'M10 nomenclatura oficial: CCTV e sirene de ré são recusados');
  select s.id into v_src from public.mtsr_ingestion_sources s where s.organization_id = v_org and s.code = 'geotab_api';
  begin
    perform public.mtsr_save_source(v_org, jsonb_build_object('id', v_src, 'is_enabled', true)); v_err := null;
  exception when others then v_err := sqlerrm; end;
  insert into t_res (ok, label) values (v_err like '%não tem adaptador implementado%', 'M10 fonte sem adaptador (GEOTAB_API) não pode ser habilitada');
  select ms.id into v_svc from public.maintenance_services ms where ms.organization_id = v_org and ms.deleted_at is null and ms.status = 'active'
     and not exists (select 1 from public.mtsr_component_services x where x.service_id = ms.id) order by ms.name limit 1;
  perform public.mtsr_save_component_services(v_org, c_sir, jsonb_build_array(jsonb_build_object('service_id', v_svc, 'is_default', true)));
  perform public.mtsr_save_component_services(v_org, c_sir, '[]'::jsonb);
  insert into t_res (ok, label) values ((select count(*) from public.mtsr_component_services x where x.component_id = c_sir) = 1
    and (select x.is_active from public.mtsr_component_services x where x.component_id = c_sir and x.service_id = v_svc) = false, 'M10 serviço↔componente: remover desativa o vínculo (histórico preservado, sem exclusão física)');
  v_res := public.mtsr_save_component(v_org, jsonb_build_object('id', c_sir, 'name', 'Sirene do Sistema', 'evidence_required_when_ok', false));
  insert into t_res (ok, label) values ((select evidence_required_when_ok from public.mtsr_components where id = c_sir) = false
    and exists (select 1 from public.mtsr_events x where x.component_id = c_sir and x.event_type = 'COMPONENTE_ALTERADO'), 'M10 política de evidência configurável por componente, com evento COMPONENTE_ALTERADO');

  -- ---------------------------------------------------------------- M11 leitura
  v_res := public.mtsr_vehicle_sheet(v_org, v_veh.id);
  insert into t_res (ok, label) values (jsonb_array_length(v_res -> 'components') = 7 and jsonb_array_length(v_res -> 'inspections') = 4
    and jsonb_array_length(v_res -> 'maintenances') >= 1 and jsonb_array_length(v_res -> 'events') >= 10
    and (v_res -> 'facts' ->> 'last_valid_inspection_date')::date = v_today, 'M11 ficha 360°: 7 componentes, 4 vistorias, manutenção vinculada, linha do tempo');
  v_res := public.mtsr_dashboard(v_org, jsonb_build_object('vehicle_ids', jsonb_build_array(v_veh.id, v_veh2.id)));
  insert into t_res (ok, label) values ((v_res -> 'kpis' ->> 'vehicles')::int = 2 and (v_res -> 'kpis' ->> 'nao_conforme')::int = 2 and (v_res -> 'kpis' ->> 'media')::int = 2
    and (v_res -> 'kpis' ->> 'nok_components')::int = 5 and not (v_res ->> 'empty')::boolean and jsonb_array_length(v_res -> 'by_component') = 7, 'M11 dashboard filtrado por IDs: 2 veículos NÃO CONFORME (média), 5 NOK, séries por componente');
  v_res := public.mtsr_fleet_status(v_org, jsonb_build_object('component_id', c_mdvr, 'component_statuses', jsonb_build_array('nok')), 'criticality', 'desc', 50, 0);
  insert into t_res (ok, label) values ((v_res ->> 'total')::int = 2 and jsonb_array_length(v_res -> 'rows') = 2 and jsonb_array_length(v_res -> 'rows' -> 0 -> 'components') = 7, 'M11 matriz com filtro por componente/status no servidor (paginada)');
  v_res := public.mtsr_fleet_status(v_org, '{}'::jsonb, 'nok', 'desc', 1, 0);
  insert into t_res (ok, label) values ((v_res ->> 'total')::int >= 2 and jsonb_array_length(v_res -> 'rows') = 1 and (v_res -> 'rows' -> 0 ->> 'vehicle_id')::uuid = v_veh2.id, 'M11 paginação limit 1 + ordenação por NOK (veículo com 3 NOK primeiro)');
  v_res := public.mtsr_events_list(v_org, jsonb_build_object('vehicle_id', v_veh.id), 500, 0);
  v_res2 := public.mtsr_health(v_org);
  insert into t_res (ok, label) values ((v_res ->> 'total')::int >= 10 and v_res2 ? 'sources' and jsonb_array_length(v_res2 -> 'sources') = 6, 'M11 auditoria por veículo e Saúde/Cobertura com as 6 fontes');
  perform public.log_mtsr_export(v_org, 'conformidade', 'xlsx', 88, '{}'::jsonb);
  insert into t_res (ok, label) values (exists (select 1 from public.audit_logs a where a.organization_id = v_org and a.entity_type = 'mtsr_export' and a.action = 'EXPORT' and a.user_id = v_user)
    and exists (select 1 from public.mtsr_events x where x.organization_id = v_org and x.event_type = 'EXPORTACAO'), 'M11 exportação auditada (audit_logs + evento)');

  -- ---------------------------------------------------------------- M12 retenção
  v_res := public.mtsr_evidence_purge_candidates(v_org, v_veh.id, 100);
  insert into t_res (ok, label) values ((v_res ->> 'retention_inspections')::int = 1 and jsonb_array_length(v_res -> 'candidates') = 12
    and exists (select 1 from jsonb_array_elements(v_res -> 'candidates') x where (x ->> 'inspection_id')::uuid = v_insp2)
    and (select count(distinct x ->> 'inspection_id') from jsonb_array_elements(v_res -> 'candidates') x) = 3, 'M12 retenção = 1 (parâmetro): 12 evidências candidatas de 3 vistorias; a mais recente (de hoje) preservada');
  v_res2 := public.mtsr_evidence_mark_purged(v_org, (select array_agg((x ->> 'id')::uuid) from jsonb_array_elements(v_res -> 'candidates') x), 'retention');
  insert into t_res (ok, label) values ((v_res2 ->> 'purged')::int = 12 and (select count(*) from public.mtsr_inspection_evidence ev2 where ev2.inspection_id = v_insp2 and ev2.purged_at is null) = 0
    and exists (select 1 from public.mtsr_events x where x.vehicle_id = v_veh.id and x.event_type = 'EVIDENCIA_EXPURGADA'), 'M12 expurgo marcado com evento EVIDENCIA_EXPURGADA');

  -- ---------------------------------------------------------------- M13 RBAC / RLS
  set local role authenticated;
  select count(*) into n from public.mtsr_components;
  select count(*) into n2 from public.mtsr_inspections where vehicle_id = v_veh.id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into n3 from public.mtsr_components;
  begin
    perform public.mtsr_fleet_status(v_org); v_err := null;
  exception when others then v_err := sqlerrm; end;
  begin
    perform public.mtsr_inspection_context(v_org); v_hint := null;
  exception when others then v_hint := sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  insert into t_res (ok, label) values (n = 7 and n2 = 4 and n3 = 0, 'M13 RLS real: administrador lê catálogo e vistorias; não membro não lê nada');
  insert into t_res (ok, label) values (v_err is not null and v_hint is not null, 'M13 RBAC: não membro não consulta a matriz nem executa o app');
  insert into t_res (ok, label) values ((select count(*) from public.access_profile_defaults d where d.profile_code = 'operacional' and d.permission_code = 'applications.mtsr.execute') = 1
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'operacional' and d.permission_code like 'mtsr.%') = 0
    and (select count(*) from public.access_profile_defaults d where d.profile_code = 'seguranca' and d.permission_code like 'mtsr.%') = 16
    and (select count(*) from public.permissions x where x.module = 'mtsr') = 16, 'M13 perfis: Operacional só executa o app; Segurança tem as 16 permissões do módulo (via Perfis & Permissões, sem nome hardcoded)');

  select count(*) filter (where ok), count(*) filter (where not ok) into np, nf from t_res;
  select string_agg(format('%s  %s', case when ok then 'PASS' else 'FAIL' end, label), E'\n' order by seq) into r from t_res;
  raise exception E'ROLLBACK_TESTES\n%\n\nRESULTADO: % PASS · % FAIL (veículos % e %)', r, np, nf, v_veh.plate, v_veh2.plate;
end $t$;
