-- =============================================================================
-- Etapa 11 — Aderência: importação de bases externas (§54–§56)
--
-- Reaproveita a esteira de staging da Etapa 03 (`import_batches`,
-- `import_rows`, `import_errors`) com o tipo `adherence`. Tudo passa por duas
-- rotinas security definer: a tela só lê a planilha e mapeia colunas.
--
-- O que uma importação PODE fazer: abrir SOLICITAÇÕES pendentes (com o motivo
-- reconhecido e a justificativa/evidência do arquivo) e registrar
-- inconsistências para o que não entendeu.
--
-- O que ela NUNCA faz (§55, §56): criar veículo, operação, cidade, BR ou
-- colaborador; criar obrigação; sobrescrever execução oficial, expurgo
-- aprovado ou solicitação pendente; aprovar coisa alguma; tocar em Perfis de
-- Acesso. Um status vazio ou desconhecido não vira expurgo — vira
-- inconsistência (§21).
-- =============================================================================
alter table public.import_batches drop constraint if exists import_batches_type_check;
alter table public.import_batches add constraint import_batches_type_check
  check (type = any (array['employees'::text, 'vehicles'::text, 'adherence'::text]));

-- Mapeia o texto livre do arquivo para o CÓDIGO do motivo (ou NAO_FEZ, que
-- não gera nada). Sem correspondência, devolve NULL — e a linha é recusada.
create or replace function private.adherence_import_reason_code(p_status text)
returns text
language sql immutable
as $$
  select case
    when s in ('FEZ','FEZ_CHECKLIST','FEZ CHECKLIST','OK','REALIZADO','REALIZOU','EXECUTADO','EXECUCAO_COMPROVADA','COMPROVADO','SIM') then 'EXECUCAO_COMPROVADA'
    when s in ('SEM_ROTA','SEM ROTA','SEMROTA') then 'SEM_ROTA'
    when s in ('MANUTENCAO','EM MANUTENCAO','MANUT','OFICINA') then 'MANUTENCAO'
    when s in ('RESERVA','FROTA_RESERVA','FROTA RESERVA','RESERVA NAO ESCALADA') then 'RESERVA'
    when s in ('EM_VIAGEM','EM VIAGEM','VIAGEM') then 'EM_VIAGEM'
    when s in ('FROTA_NAO_ATIVA','FROTA NAO ATIVA','NAO ATIVA','NAO ATIVO','INATIVO','INATIVA','DESATIVADO') then 'FROTA_NAO_ATIVA'
    when s in ('OUTROS','OUTRO') then 'OUTROS'
    when s in ('NAO_FEZ','NAO FEZ','NAO_FEZ_CHECKLIST','NAO FEZ CHECKLIST','PENDENTE','NF','NAO') then 'NAO_FEZ'
    else null end
  from (select upper(btrim(translate(coalesce(p_status, ''),
          'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCAAAAEEIOOOUUC'))) as s) x;
$$;

create or replace function public.stage_adherence_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid;
  v_today date := private.adherence_today(p_organization_id);
  r jsonb;
  v_rownum int; v_fleet text; v_plate text; v_date date; v_ctx text; v_status_raw text; v_code text;
  v_just text; v_evid text; v_vehicle uuid;
  v_obl record; v_reason record;
  v_level text; v_action text; v_msg text; v_field text; v_errcode text;
  n_total int := 0; n_valid int := 0; n_warn int := 0; n_err int := 0;
  v_norm jsonb;
  v_already boolean;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
    raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_payload -> 'rows') > 20000 then
    raise exception 'A planilha excede 20000 linhas.' using errcode = 'invalid_parameter_value';
  end if;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'adherence' and b.status = 'completed'
       and b.file_hash = p_payload ->> 'file_hash') into v_already;

  insert into public.import_batches
    (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
  values
    (p_organization_id, 'adherence', 'create', 'draft',
     coalesce(nullif(p_payload ->> 'file_name', ''), 'aderencia'),
     nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
     coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_payload -> 'rows') loop
    n_total := n_total + 1;
    v_rownum := coalesce(nullif(r ->> 'row_number', '')::int, n_total + 1);
    v_fleet := nullif(btrim(coalesce(r ->> 'fleet_code', '')), '');
    v_plate := private.normalize_plate(nullif(btrim(coalesce(r ->> 'license_plate', '')), ''));
    v_ctx := lower(btrim(coalesce(r ->> 'context', '')));
    v_ctx := case when v_ctx in ('retorno', 'r', 'volta') then 'retorno'
                  when v_ctx in ('', 'saida', 'saída', 's', 'ida') then 'saida' else v_ctx end;
    v_status_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
    v_code := private.adherence_import_reason_code(v_status_raw);
    v_just := nullif(btrim(coalesce(r ->> 'justification', '')), '');
    v_evid := nullif(btrim(coalesce(r ->> 'evidence_reference', '')), '');
    begin
      v_date := nullif(btrim(coalesce(r ->> 'operational_date', '')), '')::date;
    exception when others then
      v_date := null;
    end;

    v_vehicle := null; v_level := 'valid'; v_action := 'create'; v_msg := null; v_field := null; v_errcode := null;

    if v_fleet is not null then
      select v.id into v_vehicle from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null and upper(v.fleet_code) = upper(v_fleet) limit 1;
    end if;
    if v_vehicle is null and v_plate is not null then
      select v.id into v_vehicle from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null and private.normalize_plate(v.license_plate) = v_plate limit 1;
    end if;

    select s.* into v_obl from public.adherence_obligation_status s
     where v_vehicle is not null and v_date is not null and v_ctx in ('saida', 'retorno')
       and s.organization_id = p_organization_id and s.vehicle_id = v_vehicle
       and s.operational_date = v_date and s.checklist_context = v_ctx;

    if v_vehicle is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'fleet_code'; v_errcode := 'import_unknown_vehicle';
      v_msg := 'Veiculo nao encontrado pela frota nem pela placa. A importacao nao cria veiculos.';
    elsif v_date is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'invalid_date';
      v_msg := 'Data operacional ausente ou invalida.';
    elsif v_date > v_today then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'future_date';
      v_msg := 'Data futura: nao ha descumprimento a justificar.';
    elsif v_ctx not in ('saida', 'retorno') then
      v_level := 'error'; v_action := 'skip'; v_field := 'context'; v_errcode := 'invalid_context';
      v_msg := 'Contexto deve ser saida ou retorno.';
    elsif v_code is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'import_unknown_status';
      v_msg := format('Status "%s" desconhecido. Nada e aprovado automaticamente; a linha vira inconsistencia.', coalesce(v_status_raw, ''));
    elsif v_obl.id is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'no_obligation';
      v_msg := 'Nao ha obrigacao para este veiculo, data e contexto. Reconcilie o periodo antes; a importacao nao cria obrigacoes.';
    elsif v_code = 'NAO_FEZ' then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'no_change';
      v_msg := format('Status atual no HFM: %s. "Nao fez" e o padrao do motor; nada a gravar.', v_obl.status_code);
    elsif v_obl.is_done then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_done';
      v_msg := format('A obrigacao ja possui checklist valido no HFM. Valor recebido (%s) nao sobrescreve a execucao oficial.', coalesce(v_status_raw, ''));
    elsif v_obl.is_excluded then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_excluded';
      v_msg := format('A obrigacao ja possui expurgo aprovado (%s). Valor recebido: %s.', v_obl.status_code, coalesce(v_status_raw, ''));
    elsif v_obl.has_pending_request then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'pending_conflict';
      v_msg := format('Ja existe solicitacao pendente para esta obrigacao. Valor recebido: %s.', coalesce(v_status_raw, ''));
    else
      select x.* into v_reason from public.adherence_exclusion_reasons x
       where x.organization_id = p_organization_id and x.code = v_code and x.is_active;
      if v_reason.id is null then
        v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'reason_inactive';
        v_msg := format('Motivo %s inativo nesta organizacao.', v_code);
      elsif (v_ctx = 'saida' and not v_reason.applies_to_departure) or (v_ctx = 'retorno' and not v_reason.applies_to_return) then
        v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'reason_context';
        v_msg := format('Motivo %s nao se aplica ao contexto %s.', v_code, v_ctx);
      elsif v_reason.requires_evidence and v_evid is null then
        v_level := 'error'; v_action := 'skip'; v_field := 'evidence_reference'; v_errcode := 'evidence_required';
        v_msg := format('Motivo %s exige referencia de evidencia (OS, chamado, documento).', v_code);
      end if;
    end if;

    v_norm := jsonb_build_object(
      'fleet_code', v_fleet, 'license_plate', v_plate, 'operational_date', v_date,
      'context', case when v_ctx in ('saida', 'retorno') then v_ctx end,
      'status_raw', v_status_raw, 'reason_code', case when v_code = 'NAO_FEZ' then null else v_code end,
      'justification', v_just, 'evidence_reference', v_evid,
      'obligation_id', v_obl.id, 'current_status', v_obl.status_code, 'code', v_errcode);

    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action, vehicle_id)
    values (p_organization_id, v_batch, v_rownum, coalesce(r -> 'raw', '{}'::jsonb), v_norm, v_level, v_action, v_vehicle);

    if v_msg is not null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, v_batch, v_rownum, v_level, v_field, v_errcode, v_msg);
    end if;

    if v_level = 'valid' then n_valid := n_valid + 1;
    elsif v_level = 'warning' then n_warn := n_warn + 1;
    else n_err := n_err + 1; end if;
  end loop;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         created_rows = 0, updated_rows = 0, skipped_rows = n_warn + n_err,
         summary = jsonb_build_object('requests_to_create', n_valid, 'already_imported', v_already),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn,
    'error_rows', n_err, 'create_rows', n_valid, 'already_imported', v_already,
    'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field, 'code', e.code, 'message', e.message) order by e.level, e.row_number)
                   from (select * from public.import_errors x where x.batch_id = v_batch order by x.level, x.row_number limit 300) e), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', i.row_number, 'status', i.status, 'action', i.action, 'data', i.normalized_data) order by i.row_number)
                 from (select * from public.import_rows x where x.batch_id = v_batch order by x.row_number limit 12) i), '[]'::jsonb));
end;
$$;

create or replace function public.process_adherence_import(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch record;
  x record;
  v_reason uuid;
  v_run uuid;
  n_created int := 0; n_skipped int := 0; n_inc int := 0;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;

  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type = 'adherence' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status <> 'validated' then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;

  update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  insert into public.adherence_runs (organization_id, kind, reason, requested_by)
  values (p_organization_id, 'import', 'Importação ' || coalesce(v_batch.file_name, ''), auth.uid())
  returning id into v_run;

  for x in
    select r.* from public.import_rows r
     where r.batch_id = p_batch_id and r.status = 'valid' and r.action = 'create'
     order by r.row_number
  loop
    select rs.id into v_reason from public.adherence_exclusion_reasons rs
     where rs.organization_id = p_organization_id and rs.code = x.normalized_data ->> 'reason_code';
    begin
      -- O "solicitante" é o arquivo, não quem importou: fica sem requested_by
      -- para que a decisão continue segregada e possível (§32).
      insert into public.adherence_requests
        (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference,
         source, requested_by, requested_employee_id, import_batch_id)
      values
        (p_organization_id, (x.normalized_data ->> 'obligation_id')::uuid, v_reason, x.normalized_data ->> 'context',
         coalesce(x.normalized_data ->> 'justification',
                  format('Importado de %s (linha %s). Status informado: %s.', coalesce(v_batch.file_name, 'arquivo'), x.row_number, coalesce(x.normalized_data ->> 'status_raw', ''))),
         x.normalized_data ->> 'evidence_reference', 'import', null, null, p_batch_id);
      update public.import_rows set status = 'created' where id = x.id;
      n_created := n_created + 1;
    exception when unique_violation then
      update public.import_rows set status = 'skipped', action = 'skip' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'warning', null, 'pending_conflict',
              'Ja existia solicitacao pendente no momento do processamento.');
      n_skipped := n_skipped + 1;
    end;
  end loop;

  -- §21: o que não foi entendido vira inconsistência, nunca decisão.
  insert into public.adherence_inconsistencies (organization_id, kind, vehicle_id, operational_date, checklist_context, details)
  select p_organization_id,
         case when r.normalized_data ->> 'code' = 'import_unknown_vehicle' then 'import_unknown_vehicle' else 'import_unknown_status' end,
         r.vehicle_id,
         nullif(r.normalized_data ->> 'operational_date', '')::date,
         case when r.normalized_data ->> 'context' in ('saida', 'retorno') then r.normalized_data ->> 'context' end,
         jsonb_build_object('batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', r.row_number,
                            'status_raw', r.normalized_data ->> 'status_raw',
                            'fleet_code', r.normalized_data ->> 'fleet_code', 'license_plate', r.normalized_data ->> 'license_plate')
    from public.import_rows r
   where r.batch_id = p_batch_id and r.status = 'error'
     and r.normalized_data ->> 'code' in ('import_unknown_status', 'import_unknown_vehicle');
  get diagnostics n_inc = row_count;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created,
         skipped_rows = n_skipped + (select count(*) from public.import_rows i where i.batch_id = p_batch_id and i.status in ('warning', 'error', 'skipped')),
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;
  update public.adherence_runs
     set status = 'completed', finished_at = now(),
         stats = jsonb_build_object('requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc, 'batch_id', p_batch_id)
   where id = v_run;

  return jsonb_build_object('batch_id', p_batch_id, 'requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc);
end;
$$;

revoke execute on function
  public.stage_adherence_import(uuid, jsonb),
  public.process_adherence_import(uuid, uuid)
from public, anon;
revoke execute on function private.adherence_import_reason_code(text) from public, anon, authenticated;
