-- =============================================================================
-- ADERÊNCIA · IMPORTAÇÃO DO HISTÓRICO DE CHECK LIST — AJUSTE
--
-- A rotina de processamento percorria as linhas com uma variável `record` e
-- a entregava a `private.checklist_history_create_execution`, que espera a
-- linha tipada (`public.import_rows`): "cannot cast type record to
-- public.import_rows" em toda execução. A variável passa a ter o tipo da
-- tabela. Mesma assinatura, mesma regra.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 6. Processamento em partes: obrigações do período, depois as linhas
-- -----------------------------------------------------------------------------
create or replace function public.process_checklist_history_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch   record;
  v_run     uuid;
  v_today   date := private.adherence_today(p_organization_id);
  v_can_ovr boolean := private.has_permission(p_organization_id, 'adherence.override');
  v_months  jsonb;
  v_month   date;
  v_gen     jsonb;
  x         public.import_rows;
  v_obl     record;
  v_reason  uuid;
  v_res     jsonb;
  v_out     text;
  v_just    text;
  v_left    int;
  v_done    int := 0;
  v_stats   jsonb;
  n_inc     int;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;

  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type = 'checklist_history' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;

  if v_batch.status = 'validated' then
    insert into public.adherence_runs (organization_id, kind, date_from, date_to, reason, requested_by)
    values (p_organization_id, 'import', nullif(v_batch.summary ->> 'date_from', '')::date, nullif(v_batch.summary ->> 'date_to', '')::date,
            'Histórico de Check List ' || coalesce(v_batch.file_name, ''), auth.uid())
    returning id into v_run;
    -- os meses do período, para gerar as obrigações antes das linhas
    select coalesce(jsonb_agg(to_char(m, 'YYYY-MM-DD') order by m), '[]'::jsonb) into v_months
      from generate_series(date_trunc('month', nullif(v_batch.summary ->> 'date_from', '')::date)::date,
                           date_trunc('month', nullif(v_batch.summary ->> 'date_to', '')::date)::date, interval '1 month') m
     where nullif(v_batch.summary ->> 'date_from', '') is not null;
    update public.import_batches
       set status = 'processing',
           summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('run_id', v_run, 'pending_months', v_months, 'months_generated', 0),
           updated_at = now(), updated_by = auth.uid()
     where id = p_batch_id
     returning * into v_batch;
  end if;
  v_run := nullif(v_batch.summary ->> 'run_id', '')::uuid;
  v_months := coalesce(v_batch.summary -> 'pending_months', '[]'::jsonb);

  -- 6.1 obrigações do mês: o mesmo gerador da reconciliação (sem aposentar nada)
  if jsonb_array_length(v_months) > 0 then
    v_month := (v_months ->> 0)::date;
    v_gen := private.adherence_generate(p_organization_id, v_month, least((v_month + interval '1 month - 1 day')::date, v_today),
                                        null, null, null, false, false, v_run, null);
    update public.import_batches
       set summary = summary || jsonb_build_object('pending_months', v_months - 0,
                                                   'months_generated', coalesce((summary ->> 'months_generated')::int, 0) + 1,
                                                   'obligations_created', coalesce((summary ->> 'obligations_created')::int, 0) + coalesce((v_gen ->> 'create')::int, 0)),
           updated_at = now()
     where id = p_batch_id;
    select count(*)::int into v_left from public.import_rows r
     where r.batch_id = p_batch_id and r.status in ('valid', 'warning') and r.action = 'create';
    return jsonb_build_object('done', false, 'remaining', v_left + jsonb_array_length(v_months) - 1, 'batch_id', p_batch_id,
                              'phase', 'obligations', 'month', to_char(v_month, 'YYYY-MM'));
  end if;

  -- 6.2 linhas
  for x in
    select r.* from public.import_rows r
     where r.batch_id = p_batch_id and r.status in ('valid', 'warning') and r.action = 'create'
     order by r.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    v_done := v_done + 1;
    begin
      if x.normalized_data ->> 'kind' = 'execution' then
        v_res := private.checklist_history_create_execution(p_batch_id, x);
        if v_res ->> 'status' = 'created' then
          update public.import_rows set status = 'created', action = 'create' where id = x.id;
        else
          update public.import_rows set status = case when v_res ->> 'status' = 'failed' then 'failed' else 'skipped' end, action = 'skip',
                 normalized_data = normalized_data || jsonb_build_object('code', v_res ->> 'code') where id = x.id;
          insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
          values (p_organization_id, p_batch_id, x.row_number, case when v_res ->> 'status' = 'failed' then 'error' else 'warning' end, null,
                  v_res ->> 'code', coalesce(v_res ->> 'message', case v_res ->> 'code'
                    when 'already_imported' then 'Este dia ja havia sido importado para a placa.'
                    when 'already_done' then 'Ja existia checklist oficial desta placa neste dia.'
                    when 'unknown_employee' then 'Colaborador nao encontrado no momento do processamento.'
                    else 'Linha ignorada.' end));
        end if;
      else
        select s.* into v_obl from public.adherence_obligation_status s
         where s.organization_id = p_organization_id and s.vehicle_id = x.vehicle_id
           and s.operational_date = (x.normalized_data ->> 'operational_date')::date
           and s.checklist_context = x.normalized_data ->> 'context'
         order by s.journey_seq limit 1;
        select rs.id into v_reason from public.adherence_exclusion_reasons rs
         where rs.organization_id = p_organization_id and rs.code = x.normalized_data ->> 'reason_code';
        v_just := coalesce(x.normalized_data ->> 'justification',
                    format('Histórico de Check List importado de %s (linha %s). Status informado: %s.',
                           coalesce(v_batch.file_name, 'arquivo'), x.row_number, coalesce(x.normalized_data ->> 'status_raw', '')));
        if v_obl.id is null then
          update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || '{"code":"no_obligation"}'::jsonb where id = x.id;
          insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
          values (p_organization_id, p_batch_id, x.row_number, 'warning', 'operational_date', 'no_obligation',
                  'Nao ha obrigacao de checklist para esta placa na data (veiculo nao previsto na Fidelizacao/alocacao ou tipo sem obrigacao). Nada a expurgar.');
        elsif v_reason is null then
          update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || '{"code":"reason_inactive"}'::jsonb where id = x.id;
          insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
          values (p_organization_id, p_batch_id, x.row_number, 'warning', 'status', 'reason_inactive', 'Motivo de expurgo nao encontrado no processamento.');
        elsif x.normalized_data ->> 'kind' = 'override' and v_can_ovr then
          v_out := private.adherence_apply_override(p_organization_id, v_obl.id, v_reason, v_just, 'import');
          if v_out = 'applied' then
            update public.import_rows set status = 'created' where id = x.id;
          else
            update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || jsonb_build_object('code', v_out) where id = x.id;
            insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
            values (p_organization_id, p_batch_id, x.row_number, 'warning', null, v_out, case v_out
              when 'has_execution' then 'A obrigacao ja possui checklist valido; o expurgo nao se aplica.'
              when 'already_excluded' then 'A obrigacao ja possui expurgo aprovado.'
              when 'pending_request' then 'Ja existe solicitacao pendente para esta obrigacao.'
              when 'out_of_scope' then 'A operacao desta placa esta fora do seu escopo.'
              when 'future' then 'Obrigacao futura.'
              when 'reason_not_applicable' then 'O motivo nao se aplica a este contexto.'
              else 'Expurgo nao aplicado.' end);
          end if;
        else
          if v_obl.is_done then
            update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || '{"code":"already_done"}'::jsonb where id = x.id;
            insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
            values (p_organization_id, p_batch_id, x.row_number, 'warning', null, 'already_done', 'A obrigacao ja possui checklist valido no HFM.');
          elsif v_obl.is_excluded then
            update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || '{"code":"already_excluded"}'::jsonb where id = x.id;
            insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
            values (p_organization_id, p_batch_id, x.row_number, 'warning', null, 'already_excluded', 'A obrigacao ja possui expurgo aprovado.');
          else
            begin
              insert into public.adherence_requests
                (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference,
                 source, requested_by, requested_employee_id, import_batch_id)
              values
                (p_organization_id, v_obl.id, v_reason, x.normalized_data ->> 'context', v_just,
                 format('Histórico de Check List: %s, linha %s', coalesce(v_batch.file_name, 'arquivo'), x.row_number),
                 'import', null, null, p_batch_id);
              update public.import_rows set status = 'created' where id = x.id;
            exception when unique_violation then
              update public.import_rows set status = 'skipped', action = 'skip', normalized_data = normalized_data || '{"code":"pending_conflict"}'::jsonb where id = x.id;
              insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
              values (p_organization_id, p_batch_id, x.row_number, 'warning', null, 'pending_conflict', 'Ja existia solicitacao pendente para esta obrigacao.');
            end;
          end if;
        end if;
      end if;
    exception when others then
      update public.import_rows set status = 'failed', action = 'skip', normalized_data = normalized_data || '{"code":"failed"}'::jsonb where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'failed', left(sqlerrm, 500));
    end;
  end loop;

  select count(*)::int into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning') and r.action = 'create';
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left, 'batch_id', p_batch_id, 'phase', 'rows', 'processed', v_done);
  end if;

  -- §21: o que não foi entendido vira inconsistência, nunca decisão.
  insert into public.adherence_inconsistencies (organization_id, kind, vehicle_id, operational_date, checklist_context, details)
  select p_organization_id,
         case when r.normalized_data ->> 'code' = 'import_unknown_vehicle' then 'import_unknown_vehicle' else 'import_unknown_status' end,
         r.vehicle_id, nullif(r.normalized_data ->> 'operational_date', '')::date,
         case when r.normalized_data ->> 'context' in ('saida', 'retorno') then r.normalized_data ->> 'context' end,
         jsonb_build_object('batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', r.row_number,
                            'status_raw', r.normalized_data ->> 'status_raw',
                            'fleet_code', r.normalized_data ->> 'fleet_code', 'license_plate', r.normalized_data ->> 'license_plate')
    from public.import_rows r
   where r.batch_id = p_batch_id and r.status = 'error'
     and r.normalized_data ->> 'code' in ('import_unknown_status', 'import_unknown_vehicle');
  get diagnostics n_inc = row_count;

  select jsonb_build_object(
      'executions_created', count(*) filter (where r.status = 'created' and r.normalized_data ->> 'kind' = 'execution'),
      'overrides_applied', count(*) filter (where r.status = 'created' and r.normalized_data ->> 'kind' = 'override'),
      'requests_created', count(*) filter (where r.status = 'created' and r.normalized_data ->> 'kind' = 'request'),
      'no_change', count(*) filter (where r.normalized_data ->> 'kind' = 'none'),
      'skipped', count(*) filter (where r.status = 'skipped'),
      'failed', count(*) filter (where r.status = 'failed'),
      'errors', count(*) filter (where r.status = 'error'),
      'answers_created', (select count(*) from public.checklist_execution_answers a
                            join public.checklist_executions e on e.id = a.execution_id where e.import_batch_id = p_batch_id),
      'non_conforming', (select coalesce(sum(e.non_conforming_answers), 0) from public.checklist_executions e where e.import_batch_id = p_batch_id),
      'inconsistencies', n_inc)
    into v_stats
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches
     set status = 'completed', processed_at = now(),
         created_rows = (v_stats ->> 'executions_created')::int + (v_stats ->> 'overrides_applied')::int + (v_stats ->> 'requests_created')::int,
         skipped_rows = (v_stats ->> 'skipped')::int + (v_stats ->> 'no_change')::int + (v_stats ->> 'errors')::int + (v_stats ->> 'failed')::int,
         summary = coalesce(summary, '{}'::jsonb) || v_stats,
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;
  update public.adherence_runs
     set status = 'completed', finished_at = now(), stats = v_stats || jsonb_build_object('batch_id', p_batch_id)
   where id = v_run;

  return jsonb_build_object('done', true, 'remaining', 0, 'batch_id', p_batch_id) || v_stats;
end;
$$;
revoke execute on function public.process_checklist_history_import(uuid, uuid, integer) from public, anon;
grant execute on function public.process_checklist_history_import(uuid, uuid, integer) to authenticated;

