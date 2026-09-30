-- =============================================================================
-- Importação da fidelização: a troca vira substituição ou inversão
--
-- Até aqui, uma linha importada que começava no dia seguinte ao fim do
-- titular anterior da BR, com outro veículo, entrava como vínculo novo
-- (`source = 'import'`, sem `replaces_assignment_id`): a Central só a via
-- como "troca inferida". Foi assim que as 16 trocas de Setembro/2026 (importação
-- de 21/09) ficaram fora das mobilizações.
--
-- Agora a importação registra a troca como a tela registra:
--   * a linha fica ligada ao vínculo que substitui (`replaces_assignment_id`);
--   * `source = 'inversion'` quando o veículo que entra saiu, na véspera, de
--     outra BR que recebe no mesmo dia o veículo que sai daqui — o par já
--     gravado ou ainda por gravar no mesmo lote; `'substitution'` nos demais;
--   * as linhas são gravadas por data, para o período anterior vindo do mesmo
--     arquivo já existir quando o seguinte chega;
--   * o histórico de mobilizações diz origem "Importação" e o lote/arquivo
--     (`hfm.fidelization_origin`, `hfm.fidelization_context`), e o resumo do
--     lote conta as trocas ligadas.
--
-- Não reescreve vínculos já gravados: as trocas antigas continuam inferidas e
-- entram nas mobilizações pela regra do painel (migration seguinte).
-- =============================================================================

create or replace function private.fidelization_log_movement(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br           public.operation_brs;
  v_leader       uuid;
  v_effective    date := (p ->> 'effective_date')::date;
  v_reconstructed boolean := coalesce((p ->> 'reconstructed')::boolean, false);
  v_source       text := p ->> 'source';
  v_origin       text;
  v_actor        uuid;
  v_details      jsonb := coalesce(p -> 'details', '{}'::jsonb);
  v_notes        text;
  v_context      text;
  v_corr         text;
  v_key          text;
begin
  select * into v_br from public.operation_brs where id = (p ->> 'operation_br_id')::uuid;
  if v_br.id is null then
    return;
  end if;

  select l.employee_id into v_leader from private.br_leadership_at(v_br.id, v_effective) l;

  if v_reconstructed then
    v_origin := 'reconstructed';
    v_actor  := nullif(p ->> 'actor', '')::uuid;
    v_corr   := 'r:' || coalesce(p ->> 'at', '');
    v_key    := 'r:' || (p ->> 'type') || ':' || (p ->> 'entity_id');
  else
    v_actor  := auth.uid();
    v_origin := case
                  when v_source = 'import' or current_setting('hfm.fidelization_origin', true) = 'import' then 'import'
                  when v_source = 'replication' then 'replication'
                  when v_actor is null then 'system'
                  else 'user'
                end;
    v_corr   := 'tx:' || txid_current()::text;
    v_key    := v_corr || ':' || (p ->> 'type') || ':' || (p ->> 'entity_id');
    v_notes  := nullif(current_setting('hfm.fidelization_notes', true), '');
    v_context := nullif(current_setting('hfm.fidelization_context', true), '');
    if v_notes is not null then
      v_details := v_details || jsonb_build_object('notes', v_notes);
    end if;
    if v_context is not null then
      v_details := v_details || v_context::jsonb;
    end if;
  end if;

  insert into public.fidelization_movements (
    organization_id, movement_type, subject, effective_date,
    operation_br_id, operation_id, state_id, city_id, leader_employee_id,
    assignment_id, previous_assignment_id, previous_vehicle_id, new_vehicle_id,
    driver_link_id, previous_driver_employee_id, new_driver_employee_id, driver_role,
    period_start, period_end, reason, source, origin, is_inferred,
    correlation_key, dedupe_key, details, actor_user_id, recorded_at)
  values (
    v_br.organization_id, p ->> 'type', p ->> 'subject', v_effective,
    v_br.id, v_br.operation_id, v_br.state_id, v_br.city_id, v_leader,
    nullif(p ->> 'assignment_id', '')::uuid, nullif(p ->> 'previous_assignment_id', '')::uuid,
    nullif(p ->> 'previous_vehicle_id', '')::uuid, nullif(p ->> 'new_vehicle_id', '')::uuid,
    nullif(p ->> 'driver_link_id', '')::uuid, nullif(p ->> 'previous_driver_employee_id', '')::uuid,
    nullif(p ->> 'new_driver_employee_id', '')::uuid, p ->> 'driver_role',
    nullif(p ->> 'period_start', '')::date, nullif(p ->> 'period_end', '')::date,
    left(p ->> 'reason', 1000), v_source, v_origin, coalesce((p ->> 'inferred')::boolean, false),
    v_corr, v_key, v_details, v_actor,
    case when v_reconstructed then coalesce(nullif(p ->> 'at', '')::timestamptz, now()) else now() end)
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.process_fidelization_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_br    public.operation_brs;
  x       record;
  v_new   uuid;
  v_res   jsonb;
  v_why   text;
  v_left  integer;
  v_vehicle uuid;
  v_start   date;
  v_prev    public.fidelization_assignments;
  v_source  text;
  n_created integer := 0; n_sub integer := 0; n_skipped integer := 0;
  n_linked_sub integer := 0; n_linked_inv integer := 0;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import') then
    raise exception 'Você não possui permissão para importar alocações.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_batch from public.import_batches
   where id = p_batch_id and organization_id = p_organization_id and type = 'fidelization' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  end if;

  -- O histórico de mobilizações diz que veio da importação, e de qual arquivo,
  -- mesmo quando a linha é gravada como substituição ou inversão.
  perform set_config('hfm.fidelization_origin', 'import', true);
  perform set_config('hfm.fidelization_context',
            jsonb_build_object('import_batch_id', p_batch_id, 'import_file', v_batch.file_name)::text, true);

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            -- Por data: o período anterior da mesma BR, vindo do mesmo arquivo,
            -- já está gravado quando o seguinte chega, e a troca é reconhecida.
            order by (r.normalized_data ->> 'start_date')::date nulls last, r.row_number
            limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    begin
      v_why := coalesce(x.d ->> 'reason', 'Importação: ' || v_batch.file_name);
      if x.action = 'create' then
        -- As mesmas travas da gravação manual, com a permissão de importar.
        v_br := private.lock_br((x.d ->> 'br_id')::uuid, 'fidelization.import');
        if v_br.organization_id <> p_organization_id then
          raise exception 'Esta BR não pertence a esta organização.' using errcode = 'insufficient_privilege';
        end if;
        perform private.assert_vehicle_fidelizable(p_organization_id, (x.d ->> 'vehicle_id')::uuid, v_br.operation_id,
                                                   nullif(x.d ->> 'end_date', '')::date);
        v_vehicle := (x.d ->> 'vehicle_id')::uuid;
        v_start   := (x.d ->> 'start_date')::date;
        v_source  := 'import';
        v_prev    := null;

        -- A linha que começa no dia seguinte ao fim do titular anterior da BR,
        -- com outro veículo, é uma troca: fica ligada ao vínculo que ela
        -- substitui, como a substituição feita pela tela. Se o veículo que
        -- entra saiu, na véspera, de outra BR que recebe no mesmo dia o que
        -- sai daqui — já gravado ou ainda por gravar neste lote —, as duas
        -- linhas são uma inversão (um evento).
        if x.d ->> 'vehicle_role' = 'primary' then
          select * into v_prev from public.fidelization_assignments p
           where p.operation_br_id = v_br.id and p.vehicle_role = 'primary' and p.status <> 'cancelled'
             and p.end_date = v_start - 1 and p.vehicle_id <> v_vehicle
           order by p.start_date desc
           limit 1;
          if v_prev.id is not null then
            v_source := case when exists (
              select 1 from public.fidelization_assignments q
               where q.organization_id = p_organization_id and q.vehicle_id = v_vehicle
                 and q.vehicle_role = 'primary' and q.status <> 'cancelled'
                 and q.end_date = v_start - 1 and q.operation_br_id <> v_br.id
                 and (exists (select 1 from public.fidelization_assignments c
                               where c.operation_br_id = q.operation_br_id and c.vehicle_id = v_prev.vehicle_id
                                 and c.vehicle_role = 'primary' and c.status <> 'cancelled' and c.start_date = v_start)
                      or exists (select 1 from public.import_rows ir
                                  where ir.batch_id = p_batch_id and ir.id <> x.id
                                    and ir.status in ('valid', 'warning') and ir.action = 'create'
                                    and ir.normalized_data ->> 'vehicle_role' = 'primary'
                                    and (ir.normalized_data ->> 'br_id')::uuid = q.operation_br_id
                                    and (ir.normalized_data ->> 'vehicle_id')::uuid = v_prev.vehicle_id
                                    and (ir.normalized_data ->> 'start_date')::date = v_start)))
              then 'inversion' else 'substitution' end;
          end if;
        end if;

        insert into public.fidelization_assignments
          (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason,
           replaces_assignment_id)
        values
          (p_organization_id, v_br.id, v_vehicle, x.d ->> 'vehicle_role',
           v_start, nullif(x.d ->> 'end_date', '')::date, x.d ->> 'status', v_source, v_why, v_prev.id)
        returning id into v_new;
        update public.import_rows set status = 'created' where id = x.id;
        if v_source = 'substitution' then
          n_linked_sub := n_linked_sub + 1;
        elsif v_source = 'inversion' then
          n_linked_inv := n_linked_inv + 1;
        end if;
      elsif x.action = 'substitute' then
        -- A rotina oficial encerra o anterior e cria o novo na mesma transação (§33).
        v_res := public.substitute_fidelization_vehicle((x.d ->> 'replaces_assignment_id')::uuid,
                   (x.d ->> 'vehicle_id')::uuid, (x.d ->> 'start_date')::date, v_why);
        v_new := (v_res ->> 'new_id')::uuid;
        update public.fidelization_assignments
           set end_date = coalesce(nullif(x.d ->> 'end_date', '')::date, end_date),
               status   = coalesce(x.d ->> 'status', status)
         where id = v_new;
        update public.import_rows set status = 'created' where id = x.id;
      else
        update public.import_rows set status = 'skipped' where id = x.id;
      end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
    end;
  end loop;

  -- As trocas ligadas somam parte a parte no resumo do lote.
  if n_linked_sub + n_linked_inv > 0 then
    update public.import_batches
       set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
             'linked_substitutions', coalesce((summary ->> 'linked_substitutions')::integer, 0) + n_linked_sub,
             'linked_inversion_rows', coalesce((summary ->> 'linked_inversion_rows')::integer, 0) + n_linked_inv)
     where id = p_batch_id;
  end if;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left);
  end if;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';
  select count(*) filter (where r.status = 'created' and r.action = 'create')::integer,
         count(*) filter (where r.status = 'created' and r.action = 'substitute')::integer,
         count(*) filter (where r.status in ('skipped', 'failed'))::integer
    into n_created, n_sub, n_skipped
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created + n_sub,
         skipped_rows = n_skipped,
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('created', n_created, 'substituted', n_sub),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;

  return jsonb_build_object('done', true, 'remaining', 0, 'created', n_created, 'substituted', n_sub, 'skipped', n_skipped);
end;
$$;

comment on function public.process_fidelization_import(uuid, uuid, integer) is
  'Etapa 13 §57: grava os vínculos novos e executa as substituições pela rotina oficial; a linha que continua a BR '
  'com outro veículo no dia seguinte fica ligada ao vínculo substituído (substitution, ou inversion quando o par '
  'recíproco está no banco ou no lote). Sobreposições ficam de fora. Em partes com p_limit (sem teto de linhas).';
