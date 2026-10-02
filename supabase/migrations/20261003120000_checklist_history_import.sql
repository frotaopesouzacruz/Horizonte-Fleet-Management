-- =============================================================================
-- ADERÊNCIA · IMPORTAÇÃO DO HISTÓRICO DE CHECK LIST
--
-- A planilha "Histórico de Check List" (modelo gerado pela tela) traz uma linha
-- por placa e dia operacional com o STATUS do dia e, quando o checklist foi
-- feito, a resposta de cada pergunta do Check List de Frota (Sim/Não/N/A) e os
-- campos condicionais. A importação alimenta os cadastros OFICIAIS:
--
--   · "Fez Check List" com motorista cadastrado → EXECUÇÃO do Check List de
--     Frota (checklist_executions + respostas + clusters), com origem
--     `import`, chave idempotente por placa × dia × contexto. O evento do
--     outbox é o mesmo do aplicativo: a Aderência concilia (FEZ) e os Planos
--     de Ação recebem as inconformidades — nenhum caminho paralelo.
--   · "Fez" sem motorista cadastrado (ou sem respostas) → solicitação
--     PENDENTE de "execução comprovada" (count_done), com a referência do
--     arquivo como evidência: a Aderência não perde o dia, a decisão é humana.
--   · Sem rota, Manutenção, Reserva, Em viagem, Frota não ativa, Outros →
--     expurgo. Quem tem `adherence.override` e pede "aplicar expurgos" grava a
--     exceção autorizada (is_override, source `import`, decidida pelo próprio
--     importador — a mesma correção administrativa da tela, em lote). Sem a
--     permissão ou sem o pedido, abre solicitação pendente (como hoje).
--   · "Não fez" → nada a gravar: é o padrão do motor. As obrigações do período
--     são geradas pelo mesmo gerador da reconciliação, mês a mês.
--
-- O que a importação NUNCA faz: criar veículo, colaborador, operação ou
-- pergunta; sobrescrever execução já existente (do aplicativo ou de outra
-- importação); aprovar "Fez" sem execução; tocar em perfis de acesso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipo de lote e origem da execução
-- -----------------------------------------------------------------------------
alter table public.import_batches drop constraint if exists import_batches_type_check;
alter table public.import_batches add constraint import_batches_type_check
  check (type = any (array['adherence'::text, 'branches'::text, 'checklist_history'::text, 'employees'::text,
                           'fidelization'::text, 'km'::text, 'maintenance'::text, 'maintenance_catalog'::text,
                           'operation_brs'::text, 'vehicles'::text]));

alter table public.checklist_executions
  add column if not exists source text not null default 'app',
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict,
  add column if not exists employee_code_snapshot text,
  add column if not exists employee_name_snapshot text;

alter table public.checklist_executions drop constraint if exists checklist_exec_source_check;
alter table public.checklist_executions add constraint checklist_exec_source_check
  check (source = any (array['app'::text, 'import'::text]));

create index if not exists checklist_exec_import_batch_idx
  on public.checklist_executions (import_batch_id) where import_batch_id is not null;

comment on column public.checklist_executions.source is
  'Origem da execução: app (Check List de Frota) ou import (histórico importado pela Aderência).';

-- -----------------------------------------------------------------------------
-- 2. Status do dia → código (texto livre do arquivo, sem acentos/espaços)
-- -----------------------------------------------------------------------------
create or replace function private.checklist_history_status_code(p_status text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when s in ('FEZ', 'FEZCHECKLIST', 'FEZCHECK', 'REALIZADO', 'REALIZOU', 'EXECUTADO', 'OK', 'SIM', 'FEITO') then 'FEZ'
    when s in ('NAOFEZ', 'NAOFEZCHECKLIST', 'NAOFEZCHECK', 'PENDENTE', 'NAO', 'NF', 'NAOREALIZADO', 'NAOREALIZOU') then 'NAO_FEZ'
    when s in ('SEMROTA') then 'SEM_ROTA'
    when s in ('MANUTENCAO', 'EMMANUTENCAO', 'MANUT', 'OFICINA') then 'MANUTENCAO'
    when s in ('RESERVA', 'FROTARESERVA', 'RESERVANAOESCALADA') then 'RESERVA'
    when s in ('EMVIAGEM', 'VIAGEM') then 'EM_VIAGEM'
    when s in ('FROTANAOATIVA', 'NAOATIVA', 'NAOATIVO', 'INATIVO', 'INATIVA', 'DESATIVADO', 'FROTAINATIVA') then 'FROTA_NAO_ATIVA'
    when s in ('OUTROS', 'OUTRO') then 'OUTROS'
    else null end
  from (select regexp_replace(upper(translate(coalesce(p_status, ''),
          'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCAAAAEEIOOOUUC')), '[^A-Z0-9]', '', 'g') as s) x;
$$;
revoke execute on function private.checklist_history_status_code(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Layout oficial para o modelo e para o mapeamento das colunas
-- -----------------------------------------------------------------------------
create or replace function public.checklist_history_import_layout(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_app     record;
  v_version record;
begin
  if not (private.has_permission(p_organization_id, 'adherence.import')
          or private.has_permission(p_organization_id, 'adherence.view_audit')) then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;
  select a.id, a.name into v_app from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota' and a.deleted_at is null;
  if v_app.id is null then
    raise exception 'O aplicativo Check List de Frota não está cadastrado nesta organização.' using errcode = 'no_data_found';
  end if;
  select v.* into v_version from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  if v_version.id is null then
    raise exception 'O Check List de Frota ainda não possui versão publicada.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'version', jsonb_build_object('id', v_version.id, 'label', v_version.label),
    'can_override', private.has_permission(p_organization_id, 'adherence.override'),
    'statuses', (
      select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'description', x.description) order by x.ord)
        from (values
          ('FEZ', 'Fez Check List', 'Checklist realizado no dia: vira execução oficial com as respostas informadas.', 1),
          ('NAO_FEZ', 'Não Fez Check List', 'Dia devido sem checklist. Nada é gravado: é o padrão do motor.', 2),
          ('SEM_ROTA', 'Sem Rota', 'Expurgo: o veículo não tinha rota na data.', 3),
          ('MANUTENCAO', 'Manutenção', 'Expurgo: o veículo estava em manutenção.', 4),
          ('EM_VIAGEM', 'Em Viagem', 'Expurgo: veículo em viagem, sem saída ou retorno local.', 5),
          ('RESERVA', 'Frota Reserva', 'Expurgo: veículo reserva não escalado.', 6),
          ('FROTA_NAO_ATIVA', 'Frota não ativa', 'Expurgo: veículo fora de operação na data.', 7),
          ('OUTROS', 'Outros', 'Expurgo por outro motivo; informe a justificativa.', 8)
        ) as x(code, label, description, ord)),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'question_key', q.question_key, 'cluster_key', c.cluster_key, 'cluster_name', c.name,
               'text', q.question_text, 'conforming_answer', q.conforming_answer, 'criticality', q.criticality,
               'conditional', (select jsonb_build_object('field_key', k.field_key, 'label', k.label, 'field_type', k.field_type,
                                                         'trigger_answer', k.trigger_answer, 'options', k.options)
                                 from public.checklist_question_conditionals k
                                where k.question_id = q.id order by k.sort_order limit 1))
             order by c.sort_order, q.sort_order)
        from public.checklist_questions q
        join public.checklist_clusters c on c.id = q.cluster_id
       where q.version_id = v_version.id and q.status = 'active'), '[]'::jsonb));
end;
$$;
revoke execute on function public.checklist_history_import_layout(uuid) from public, anon;
grant execute on function public.checklist_history_import_layout(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Prévia: carregar em partes, validar em partes, fechar
-- -----------------------------------------------------------------------------
create or replace function public.stage_checklist_history_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit    integer := nullif(p_payload ->> 'limit', '')::integer;
  v_batch    uuid := nullif(p_payload ->> 'batch_id', '')::uuid;
  v_today    date := private.adherence_today(p_organization_id);
  v_can_ovr  boolean := private.has_permission(p_organization_id, 'adherence.override');
  v_apply    boolean;
  v_loaded   integer;
  v_pend     record;
  r          jsonb;
  v_plate text; v_fleet text; v_date date; v_ctx text; v_status_raw text; v_code text;
  v_ecode text; v_ename text; v_vehicle uuid; v_employee uuid; v_key text;
  v_answers jsonb; v_n_ans int; v_n_na int;
  v_reason record;
  v_level text; v_action text; v_msg text; v_field text; v_errcode text; v_kind text;
  v_norm jsonb;
  v_already boolean;
  v_summary jsonb;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
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
    select exists (select 1 from public.import_batches b
                    where b.organization_id = p_organization_id and b.type = 'checklist_history'
                      and b.status = 'completed' and b.file_hash is not null
                      and b.file_hash = p_payload ->> 'file_hash') into v_already;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values
      (p_organization_id, 'checklist_history', 'create', 'draft',
       coalesce(nullif(p_payload ->> 'file_name', ''), 'historico-check-list'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb),
       jsonb_build_object('already_imported', coalesce(v_already, false),
                          'apply_exclusions', coalesce((p_payload ->> 'apply_exclusions')::boolean, false) and v_can_ovr,
                          'version_id', nullif(p_payload ->> 'version_id', '')),
       auth.uid(), auth.uid())
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'checklist_history'
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
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
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch,
      'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  select coalesce((b.summary ->> 'apply_exclusions')::boolean, false) into v_apply
    from public.import_batches b where b.id = v_batch;

  if v_phase in ('all', 'validate') then
    for v_pend in
      select x.id, x.row_number, x.normalized_data from public.import_rows x
       where x.batch_id = v_batch and x.status = 'pending'
       order by x.row_number
       limit greatest(coalesce(v_limit, 2147483647), 1)
    loop
      r := v_pend.normalized_data;
      v_plate := private.normalize_plate(nullif(btrim(coalesce(r ->> 'license_plate', '')), ''));
      v_fleet := nullif(btrim(coalesce(r ->> 'fleet_code', '')), '');
      v_ctx := lower(btrim(coalesce(r ->> 'context', '')));
      v_ctx := case when v_ctx in ('retorno', 'r', 'volta') then 'retorno'
                    when v_ctx in ('', 'saida', 'saída', 's', 'ida') then 'saida' else v_ctx end;
      v_status_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
      v_code := private.checklist_history_status_code(v_status_raw);
      v_ecode := nullif(regexp_replace(coalesce(r ->> 'employee_code', ''), '[^0-9A-Za-z]', '', 'g'), '');
      v_ename := nullif(btrim(coalesce(r ->> 'employee_name', '')), '');
      v_answers := case when jsonb_typeof(r -> 'answers') = 'object' then r -> 'answers' else '{}'::jsonb end;
      select count(*) filter (where v in ('yes', 'no')), count(*) filter (where v = 'na')
        into v_n_ans, v_n_na from jsonb_each_text(v_answers) as a(k, v);
      begin
        v_date := nullif(btrim(coalesce(r ->> 'operational_date', '')), '')::date;
      exception when others then
        v_date := null;
      end;

      v_vehicle := null; v_employee := null; v_key := null;
      v_level := 'valid'; v_action := 'skip'; v_kind := null; v_msg := null; v_field := null; v_errcode := null;

      if v_plate is not null then
        select v.id into v_vehicle from public.vehicles v
         where v.organization_id = p_organization_id and v.deleted_at is null
           and private.normalize_plate(v.license_plate) = v_plate limit 1;
      end if;
      if v_vehicle is null and v_fleet is not null then
        select v.id into v_vehicle from public.vehicles v
         where v.organization_id = p_organization_id and v.deleted_at is null and upper(v.fleet_code) = upper(v_fleet) limit 1;
      end if;
      if v_ecode is not null then
        select e.id into v_employee from public.employees e
         where e.organization_id = p_organization_id and e.deleted_at is null
           and regexp_replace(e.employee_code, '[^0-9A-Za-z]', '', 'g') = v_ecode limit 1;
      end if;
      if v_employee is null and v_ename is not null then
        select e.id into v_employee from public.employees e
         where e.organization_id = p_organization_id and e.deleted_at is null
           and upper(translate(e.full_name, 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCAAAAEEIOOOUUC'))
             = upper(translate(v_ename, 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCAAAAEEIOOOUUC')) limit 1;
      end if;

      if v_vehicle is null then
        v_level := 'error'; v_field := 'license_plate'; v_errcode := 'import_unknown_vehicle';
        v_msg := 'Veiculo nao encontrado pela placa nem pela frota. A importacao nao cria veiculos.';
      elsif v_date is null then
        v_level := 'error'; v_field := 'operational_date'; v_errcode := 'invalid_date';
        v_msg := 'Data operacional ausente ou invalida.';
      elsif v_date > v_today then
        v_level := 'error'; v_field := 'operational_date'; v_errcode := 'future_date';
        v_msg := 'Data futura: o historico vai ate hoje.';
      elsif v_ctx not in ('saida', 'retorno') then
        v_level := 'error'; v_field := 'context'; v_errcode := 'invalid_context';
        v_msg := 'Contexto deve ser Saida ou Retorno (vazio = Saida).';
      elsif v_code is null then
        v_level := 'error'; v_field := 'status'; v_errcode := 'import_unknown_status';
        v_msg := format('Status "%s" desconhecido. Use os valores da aba Listas do modelo.', coalesce(v_status_raw, ''));
      elsif v_code = 'NAO_FEZ' then
        v_action := 'skip'; v_kind := 'none'; v_errcode := 'no_change';
      elsif v_code = 'FEZ' then
        v_key := 'hist:' || v_vehicle::text || ':' || v_date::text || ':' || v_ctx;
        if exists (select 1 from public.checklist_executions e
                    where e.organization_id = p_organization_id and e.idempotency_key = v_key) then
          v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_imported';
          v_msg := 'Este dia ja foi importado para esta placa; a execucao existente e mantida.';
        elsif exists (select 1 from public.checklist_executions e
                       where e.organization_id = p_organization_id and e.vehicle_id = v_vehicle
                         and e.operational_date = v_date and e.checklist_type = v_ctx and e.status = 'submitted') then
          v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_done';
          v_msg := 'Ja existe checklist oficial desta placa neste dia (aplicativo). O arquivo nao sobrescreve.';
        elsif v_employee is null or v_n_ans = 0 then
          -- sem motorista cadastrado ou sem respostas: a Aderencia recebe o dia como
          -- execucao comprovada PENDENTE, para decisao humana; as respostas nao entram.
          v_level := 'warning'; v_action := 'create'; v_kind := 'request';
          v_errcode := case when v_employee is null then 'unknown_employee' else 'no_answers' end;
          v_msg := case when v_employee is null
                        then format('Colaborador nao encontrado (matricula %s, %s): o dia vira solicitacao pendente de execucao comprovada, sem respostas. Cadastre o colaborador e reimporte para ter o checklist completo.', coalesce(v_ecode, '-'), coalesce(v_ename, '-'))
                        else 'Fez Check List sem respostas: o dia vira solicitacao pendente de execucao comprovada.' end;
        else
          v_action := 'create'; v_kind := 'execution';
        end if;
      else
        select x.* into v_reason from public.adherence_exclusion_reasons x
         where x.organization_id = p_organization_id and x.code = v_code and x.is_active;
        if v_reason.id is null then
          v_level := 'error'; v_field := 'status'; v_errcode := 'reason_inactive';
          v_msg := format('Motivo %s inativo nesta organizacao.', v_code);
        elsif (v_ctx = 'saida' and not v_reason.applies_to_departure) or (v_ctx = 'retorno' and not v_reason.applies_to_return) then
          v_level := 'error'; v_field := 'status'; v_errcode := 'reason_context';
          v_msg := format('Motivo %s nao se aplica ao contexto %s.', v_code, v_ctx);
        else
          v_action := 'create';
          v_kind := case when v_apply and v_can_ovr then 'override' else 'request' end;
        end if;
      end if;

      v_norm := jsonb_build_object(
        'license_plate', v_plate, 'fleet_code', v_fleet, 'operational_date', v_date,
        'context', case when v_ctx in ('saida', 'retorno') then v_ctx end,
        'status_raw', v_status_raw, 'status_code', v_code,
        'reason_code', case when v_code in ('FEZ', 'NAO_FEZ') then (case when v_kind = 'request' and v_code = 'FEZ' then 'EXECUCAO_COMPROVADA' end) else v_code end,
        'employee_code', v_ecode, 'employee_name', v_ename, 'employee_id', v_employee,
        'justification', nullif(btrim(coalesce(r ->> 'justification', '')), ''),
        'answers', v_answers,
        'conditionals', case when jsonb_typeof(r -> 'conditionals') = 'object' then r -> 'conditionals' else '{}'::jsonb end,
        'notes', case when jsonb_typeof(r -> 'notes') = 'object' then r -> 'notes' else '{}'::jsonb end,
        'answers_count', v_n_ans, 'na_count', v_n_na,
        'idempotency_key', v_key, 'kind', v_kind, 'code', v_errcode);

      update public.import_rows
         set normalized_data = v_norm, status = v_level, action = v_action, vehicle_id = v_vehicle
       where id = v_pend.id;

      if v_msg is not null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, v_batch, v_pend.row_number, v_level, v_field, v_errcode, v_msg);
      end if;
    end loop;
    if v_phase = 'validate' then
      return jsonb_build_object('batch_id', v_batch,
        'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
    end if;
  end if;

  -- fechar a prévia
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas por validar.' using errcode = 'invalid_parameter_value';
  end if;

  select jsonb_build_object(
      'total_rows', count(*),
      'valid_rows', count(*) filter (where x.status = 'valid'),
      'warning_rows', count(*) filter (where x.status = 'warning'),
      'error_rows', count(*) filter (where x.status = 'error'),
      'executions', count(*) filter (where x.status in ('valid', 'warning') and x.normalized_data ->> 'kind' = 'execution'),
      'overrides', count(*) filter (where x.status in ('valid', 'warning') and x.normalized_data ->> 'kind' = 'override'),
      'requests', count(*) filter (where x.status in ('valid', 'warning') and x.normalized_data ->> 'kind' = 'request'),
      'no_change', count(*) filter (where x.status = 'valid' and x.normalized_data ->> 'kind' = 'none'),
      'answers', coalesce(sum((x.normalized_data ->> 'answers_count')::int) filter (where x.normalized_data ->> 'kind' = 'execution'), 0),
      'date_from', min((x.normalized_data ->> 'operational_date')::date) filter (where x.status in ('valid', 'warning')),
      'date_to', max((x.normalized_data ->> 'operational_date')::date) filter (where x.status in ('valid', 'warning')),
      'vehicles', count(distinct x.vehicle_id) filter (where x.vehicle_id is not null),
      'by_status', (select coalesce(jsonb_object_agg(s.code, s.n), '{}'::jsonb)
                      from (select coalesce(y.normalized_data ->> 'status_code', '?') as code, count(*) as n
                              from public.import_rows y where y.batch_id = v_batch group by 1) s),
      'unknown_employees', (select coalesce(jsonb_agg(jsonb_build_object('code', u.code, 'name', u.name, 'rows', u.n) order by u.n desc), '[]'::jsonb)
                              from (select y.normalized_data ->> 'employee_code' as code, y.normalized_data ->> 'employee_name' as name, count(*) as n
                                      from public.import_rows y
                                     where y.batch_id = v_batch and y.normalized_data ->> 'code' = 'unknown_employee'
                                     group by 1, 2 order by 3 desc limit 60) u),
      'unknown_plates', (select coalesce(jsonb_agg(distinct coalesce(y.normalized_data ->> 'license_plate', y.normalized_data ->> 'fleet_code')), '[]'::jsonb)
                           from public.import_rows y where y.batch_id = v_batch and y.normalized_data ->> 'code' = 'import_unknown_vehicle'))
    into v_summary
    from public.import_rows x where x.batch_id = v_batch;

  update public.import_batches b
     set status = 'validated',
         total_rows = (v_summary ->> 'total_rows')::int,
         valid_rows = (v_summary ->> 'valid_rows')::int,
         warning_rows = (v_summary ->> 'warning_rows')::int,
         error_rows = (v_summary ->> 'error_rows')::int,
         summary = coalesce(b.summary, '{}'::jsonb) || (v_summary - 'unknown_employees' - 'unknown_plates' - 'by_status'),
         updated_at = now(), updated_by = auth.uid()
   where b.id = v_batch;

  return v_summary || jsonb_build_object(
    'batch_id', v_batch,
    'already_imported', (select coalesce((b.summary ->> 'already_imported')::boolean, false) from public.import_batches b where b.id = v_batch),
    'apply_exclusions', v_apply and v_can_ovr,
    'can_override', v_can_ovr,
    'findings', (select coalesce(jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field, 'code', e.code, 'message', e.message) order by e.row_number), '[]'::jsonb)
                   from (select * from public.import_errors z where z.batch_id = v_batch order by case z.level when 'error' then 0 else 1 end, z.row_number limit 60) e),
    'sample', (select coalesce(jsonb_agg(jsonb_build_object('row_number', s.row_number, 'status', s.status, 'action', s.action,
                 'data', s.normalized_data - 'answers' - 'conditionals' - 'notes') order by s.row_number), '[]'::jsonb)
                 from (select * from public.import_rows z where z.batch_id = v_batch order by z.row_number limit 25) s));
end;
$$;
revoke execute on function public.stage_checklist_history_import(uuid, jsonb) from public, anon;
grant execute on function public.stage_checklist_history_import(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Uma execução oficial a partir de uma linha do histórico
-- -----------------------------------------------------------------------------
create or replace function private.checklist_history_create_execution(p_batch_id uuid, p_row public.import_rows)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n          jsonb := p_row.normalized_data;
  v_org      uuid := p_row.organization_id;
  v_app      record;
  v_version  record;
  v_vehicle  record;
  v_fleet    record;
  v_leader   uuid;
  v_op       uuid;
  v_date     date := (n ->> 'operational_date')::date;
  v_ctx      text := n ->> 'context';
  v_emp      record;
  v_started  timestamptz;
  v_exec     uuid;
  q          record;
  v_ans      text;
  v_cond     jsonb;
  v_applic   int := 0; v_answered int := 0; v_conf int := 0; v_nonconf int := 0; v_crit int := 0;
begin
  if exists (select 1 from public.checklist_executions e where e.organization_id = v_org and e.idempotency_key = n ->> 'idempotency_key') then
    return jsonb_build_object('status', 'skipped', 'code', 'already_imported');
  end if;
  if exists (select 1 from public.checklist_executions e
              where e.organization_id = v_org and e.vehicle_id = p_row.vehicle_id
                and e.operational_date = v_date and e.checklist_type = v_ctx and e.status = 'submitted') then
    return jsonb_build_object('status', 'skipped', 'code', 'already_done');
  end if;

  select a.id into v_app from public.operational_apps a
   where a.organization_id = v_org and a.slug = 'check-list-frota' and a.deleted_at is null;
  select v.* into v_version from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published' order by v.major desc, v.minor desc limit 1;
  if v_version.id is null then
    return jsonb_build_object('status', 'failed', 'code', 'no_version', 'message', 'O Check List de Frota nao possui versao publicada.');
  end if;

  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate, v.fleet_code, v.organization_unit_id
    into v_vehicle from public.vehicles v where v.id = p_row.vehicle_id;
  select e.id, e.employee_code, e.full_name into v_emp from public.employees e where e.id = (n ->> 'employee_id')::uuid;
  if v_emp.id is null then
    return jsonb_build_object('status', 'skipped', 'code', 'unknown_employee');
  end if;

  -- contexto operacional NA DATA: Fidelização → alocação do cadastro (§98, §99)
  select * into v_fleet from private.adherence_planned_fleet(v_org, v_date, null, v_vehicle.id) limit 1;
  v_op := v_fleet.operation_id;
  if v_op is null then
    select a.operation_id into v_op from public.vehicle_operation_assignments a
     where a.organization_id = v_org and a.vehicle_id = v_vehicle.id
     order by (a.effective_from <= v_date and (a.effective_to is null or a.effective_to >= v_date)) desc, a.effective_from desc
     limit 1;
  end if;
  if v_op is null then
    return jsonb_build_object('status', 'skipped', 'code', 'no_operation',
      'message', 'Veiculo sem operacao conhecida (Fidelizacao ou alocacao) nesta data; a execucao precisa de operacao.');
  end if;
  if v_fleet.operation_br_id is not null or v_fleet.operation_city_id is not null then
    select employee_id into v_leader from private.adherence_leader_at(v_fleet.operation_id, v_fleet.operation_city_id, v_fleet.operation_br_id, v_date);
  end if;

  v_started := private.adherence_local_ts(v_org, v_date, '06:00'::time, false);

  insert into public.checklist_executions (
    organization_id, app_id, version_id, user_id, employee_id,
    vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id, vehicle_subcategory_id,
    operation_id, state_id, city_id, operation_br_id, organization_unit_id, leader_employee_id,
    checklist_type, operational_date, started_at, status, idempotency_key,
    source, import_batch_id, employee_code_snapshot, employee_name_snapshot)
  values (
    v_org, v_app.id, v_version.id, auth.uid(), v_emp.id,
    v_vehicle.id, v_vehicle.license_plate, v_vehicle.fleet_code, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id,
    v_op, v_fleet.state_id, v_fleet.city_id, v_fleet.operation_br_id, v_vehicle.organization_unit_id, v_leader,
    v_ctx, v_date, v_started, 'draft', n ->> 'idempotency_key',
    'import', p_batch_id, v_emp.employee_code, v_emp.full_name)
  returning id into v_exec;

  for q in
    select qu.id, qu.question_key, qu.question_text, qu.conforming_answer, qu.criticality, cl.cluster_key,
           cd.field_key, cd.trigger_answer,
           private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op) as applies
      from public.checklist_questions qu
      join public.checklist_clusters cl on cl.id = qu.cluster_id
      left join lateral (select k.field_key, k.trigger_answer from public.checklist_question_conditionals k
                          where k.question_id = qu.id order by k.sort_order limit 1) cd on true
     where qu.version_id = v_version.id and qu.status = 'active'
     order by cl.sort_order, qu.sort_order
  loop
    v_ans := n -> 'answers' ->> q.question_key;
    -- aplicável: o que a regra do formulário aplica a este veículo, exceto o que o
    -- arquivo marcou como N/A; o que foi respondido Sim/Não conta sempre.
    if v_ans in ('yes', 'no') or (q.applies and coalesce(v_ans, '') <> 'na') then
      v_applic := v_applic + 1;
    end if;
    if v_ans not in ('yes', 'no') then continue; end if;
    v_answered := v_answered + 1;
    v_cond := case when q.field_key is not null and v_ans = q.trigger_answer
                     and (n -> 'conditionals' -> q.question_key) is not null
                     and jsonb_typeof(n -> 'conditionals' -> q.question_key) <> 'null'
                   then n -> 'conditionals' -> q.question_key end;
    insert into public.checklist_execution_answers (
      organization_id, execution_id, version_id, question_id, question_key, cluster_key,
      question_text_snapshot, answer, is_conforming, criticality, conditional_value, note, answered_at)
    values (
      v_org, v_exec, v_version.id, q.id, q.question_key, q.cluster_key,
      q.question_text, v_ans, v_ans = q.conforming_answer, q.criticality, v_cond,
      nullif(btrim(coalesce(n -> 'notes' ->> q.question_key, '')), ''), v_started);
    if v_ans = q.conforming_answer then v_conf := v_conf + 1;
    else
      v_nonconf := v_nonconf + 1;
      if q.criticality = 'critica' then v_crit := v_crit + 1; end if;
    end if;
  end loop;

  insert into public.checklist_execution_clusters (
    organization_id, execution_id, cluster_id, cluster_key, cluster_name, sort_order,
    applicable_questions, answered_questions, non_conforming)
  select v_org, v_exec, cl.id, cl.cluster_key, cl.name, cl.sort_order,
         count(*) filter (where ans.id is not null or (private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op)
                                                      and coalesce(n -> 'answers' ->> qu.question_key, '') <> 'na')),
         count(ans.id), count(ans.id) filter (where ans.is_conforming = false)
    from public.checklist_questions qu
    join public.checklist_clusters cl on cl.id = qu.cluster_id
    left join public.checklist_execution_answers ans on ans.execution_id = v_exec and ans.question_id = qu.id
   where qu.version_id = v_version.id and qu.status = 'active'
   group by cl.id, cl.cluster_key, cl.name, cl.sort_order
  having count(ans.id) > 0 or bool_or(private.checklist_question_applies(qu.id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id, v_op));

  update public.checklist_executions
     set status = 'submitted', submitted_at = v_started, duration_seconds = 0,
         applicable_questions = v_applic, answered_questions = v_answered,
         conforming_answers = v_conf, non_conforming_answers = v_nonconf, critical_non_conforming = v_crit,
         updated_at = now()
   where id = v_exec;

  -- O mesmo evento do aplicativo: a Aderência concilia no BEFORE, os Planos de
  -- Ação ingerem no AFTER. Nenhum caminho paralelo.
  insert into public.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'checklist.execution.submitted', 'checklist_execution', v_exec,
          jsonb_build_object(
            'execution_id', v_exec, 'organization_id', v_org, 'vehicle_id', v_vehicle.id,
            'license_plate', v_vehicle.license_plate, 'operation_id', v_op, 'operation_br_id', v_fleet.operation_br_id,
            'employee_id', v_emp.id, 'checklist_type', v_ctx, 'operational_date', v_date, 'submitted_at', v_started,
            'version_id', v_version.id, 'version_label', v_version.label,
            'applicable_questions', v_applic, 'conforming', v_conf, 'non_conforming', v_nonconf,
            'critical_non_conforming', v_crit, 'execution_valid', true, 'source', 'import', 'import_batch_id', p_batch_id));

  return jsonb_build_object('status', 'created', 'execution_id', v_exec, 'answers', v_answered, 'non_conforming', v_nonconf);
end;
$$;
revoke execute on function private.checklist_history_create_execution(uuid, public.import_rows) from public, anon, authenticated;

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

-- -----------------------------------------------------------------------------
-- 7. Histórico de importações: os dois tipos do módulo, com o tipo na linha
-- -----------------------------------------------------------------------------
create or replace function public.adherence_import_history(p_organization_id uuid, p_limit integer default 20)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not (private.has_permission(p_organization_id, 'adherence.import') or private.has_permission(p_organization_id, 'adherence.view_audit'))
      then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'file_name', b.file_name, 'status', b.status, 'total_rows', b.total_rows, 'valid_rows', b.valid_rows,
        'warning_rows', b.warning_rows, 'error_rows', b.error_rows, 'created_rows', b.created_rows,
        'skipped_rows', b.skipped_rows, 'summary', b.summary, 'error_message', b.error_message,
        'created_at', b.created_at, 'processed_at', b.processed_at,
        'created_by_name', (select p.full_name from public.profiles p where p.user_id = b.created_by),
        'errors', coalesce((select jsonb_agg(jsonb_build_object('row', e.row_number, 'message', e.message) order by e.row_number)
                             from (select * from public.import_errors x where x.batch_id = b.id order by x.row_number limit 50) e), '[]'::jsonb))
        order by b.created_at desc)
      from (select * from public.import_batches x where x.organization_id = p_organization_id and x.type in ('adherence', 'checklist_history')
             order by x.created_at desc limit greatest(p_limit, 1)) b), '[]'::jsonb)
  end;
$$;
