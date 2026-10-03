-- =============================================================================
-- Gestão de MTSR — motor, estado oficial, ingestão, leituras e cadastros
--
--   · parâmetros vigentes por data (private.mtsr_params_at)
--   · motor: prazo (CONFORME ≤ conforme_max; ATENÇÃO até attention_max; VENCIDO
--     acima; PENDENTE sem vistoria), conformidade (nenhum conhecido → SEM
--     INFORMAÇÃO; algum NOK → NÃO CONFORME; senão CONFORME) e criticidade
--     (sem NOK → SEM CRITICIDADE; NOK+CONFORME → MÉDIA; NOK+ATENÇÃO → ALTA;
--     NOK+VENCIDO/PENDENTE → CRÍTICA; componente principal = NOK de menor prioridade)
--   · private.mtsr_apply_status: única porta de mudança do estado oficial
--     (histórico, eventos, revalidação após manutenção)
--   · ingestão idempotente por hash com prioridade por fonte
--   · leituras: catálogo, frota filtrada (paginada, com contexto por IDs),
--     visão geral, ficha 360°, auditoria, saúde
--   · cadastros: componentes, serviços, parâmetros com vigência, fontes
-- Todas as escritas são RPCs security definer com checagem de permissão.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_actor_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then 'Sistema'
              else coalesce(nullif(private.org_member_name(p_organization_id, auth.uid()), ''), 'Usuário autenticado') end;
$$;

create or replace function private.mtsr_log(
  p_organization_id uuid, p_event_type text, p_vehicle_id uuid, p_component_id uuid,
  p_payload jsonb default '{}'::jsonb, p_source text default 'user',
  p_inspection_id uuid default null, p_maintenance_id uuid default null,
  p_ingestion_event_id uuid default null, p_history_id uuid default null,
  p_reason text default null, p_source_type text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.mtsr_events
    (organization_id, vehicle_id, component_id, event_type, source_type, inspection_id, maintenance_id,
     ingestion_event_id, history_id, payload, reason, actor_user_id, actor_name, source)
  values (p_organization_id, p_vehicle_id, p_component_id, p_event_type, p_source_type, p_inspection_id, p_maintenance_id,
          p_ingestion_event_id, p_history_id, coalesce(p_payload, '{}'::jsonb), p_reason, auth.uid(),
          private.mtsr_actor_name(p_organization_id), coalesce(p_source, 'user'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.mtsr_params_at(p_organization_id uuid, p_date date)
returns public.mtsr_parameter_sets
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.mtsr_parameter_sets;
begin
  select p.* into v from public.mtsr_parameter_sets p
   where p.organization_id = p_organization_id and p.effective_from <= p_date
     and (p.effective_to is null or p.effective_to >= p_date)
   order by p.effective_from desc limit 1;
  if v.id is null then
    select p.* into v from public.mtsr_parameter_sets p
     where p.organization_id = p_organization_id order by p.effective_from desc limit 1;
  end if;
  if v.id is null then
    v.organization_id := p_organization_id;
    v.conforme_max_days := 29; v.attention_min_days := 30; v.attention_max_days := 45;
    v.evidence_retention_inspections := 2; v.review_sla_days := 2;
    v.maintenance_open_sla_days := 3; v.revalidation_sla_days := 7;
  end if;
  return v;
end;
$$;
comment on function private.mtsr_params_at(uuid, date) is
  'Conjunto de parâmetros MTSR vigente na data (histórico por vigência); sem cadastro, os padrões do módulo.';

create or replace function private.mtsr_deadline_status(p_days integer, p_params public.mtsr_parameter_sets)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_days is null then 'pendente'
              when p_days <= p_params.conforme_max_days then 'conforme'
              when p_days <= p_params.attention_max_days then 'atencao'
              else 'vencido' end;
$$;

create or replace function private.mtsr_normalize_status(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with n as (select coalesce(private.normalize_label(p_value), '') as v)
  select case
    when n.v in ('ok', 'conforme', 'funcionando', 'operante', 'sim', 'bom', 'regular', 'normal', '1', 'true', 'ativo', 'ok.') then 'ok'
    when n.v in ('nok', 'n ok', 'n/ok', 'nao conforme', 'nao-conforme', 'inoperante', 'defeito', 'com defeito', 'avariado', 'quebrado',
                 'nao', 'n', 'falha', 'pendente reparo', '0', 'false', 'inativo', 'nao funciona', 'nao funcionando') then 'nok'
    when n.v in ('', '-', '—', 'n/a', 'na', 'sem informacao', 'sem info', 'desconhecido', 'nao informado', 'ni', 'sem_informacao') then 'sem_informacao'
    when n.v ~ '(^|\s)(nok|nao conforme|inoperante|defeito|avaria|falha)' then 'nok'
    when n.v ~ '(^|\s)(ok|conforme|operante)' then 'ok'
    else null end
  from n;
$$;
comment on function private.mtsr_normalize_status(text) is
  'Normaliza o texto de status de componente (legado ou fonte externa) para ok | nok | sem_informacao; nulo quando não reconhecido.';

create or replace function private.mtsr_resolve_component(p_organization_id uuid, p_id uuid, p_code text)
returns public.mtsr_components
language sql
stable
security definer
set search_path = ''
as $$
  select c.* from public.mtsr_components c
   where c.organization_id = p_organization_id
     and (c.id = p_id
          or (p_id is null and p_code is not null and
              (c.code = private.normalize_label(p_code)
               or private.normalize_label(c.name) = private.normalize_label(p_code)
               or private.normalize_label(p_code) = any (select private.normalize_label(a) from unnest(c.aliases) a))))
   order by (c.id = p_id) desc, c.sort_order
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. Motor por veículo (avaliação ao vivo; nada é copiado para o front)
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_vehicle_eval(p_organization_id uuid, p_as_of date default null)
returns table (
  vehicle_id uuid, last_valid_inspection_date date, days_since integer, deadline_status text,
  conformity_status text, criticality text, nok_count integer, ok_count integer, known_count integer,
  unknown_count integer, awaiting_count integer, main_component_id uuid, main_component_name text,
  field_total integer, backoffice_total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_as_of, private.maintenance_today(p_organization_id));
  p public.mtsr_parameter_sets := private.mtsr_params_at(p_organization_id, v_today);
begin
  return query
  with comps as (
    select c.id, c.priority, c.sort_order, c.name, c.verification_mode
      from public.mtsr_components c where c.organization_id = p_organization_id and c.is_active),
  veh as (select v.id from public.vehicles v where v.organization_id = p_organization_id and v.deleted_at is null),
  st as (
    select s.vehicle_id, s.component_id, s.status, s.awaiting_revalidation
      from public.mtsr_component_status s join comps c on c.id = s.component_id
     where s.organization_id = p_organization_id),
  agg as (
    select veh.id as vehicle_id,
           count(*) filter (where st.status = 'nok') as nok_count,
           count(*) filter (where st.status = 'ok') as ok_count,
           count(*) filter (where st.awaiting_revalidation) as awaiting_count,
           (select c.id from comps c join st s2 on s2.component_id = c.id and s2.vehicle_id = veh.id and s2.status = 'nok'
             order by c.priority, c.sort_order limit 1) as main_component_id
      from veh left join st on st.vehicle_id = veh.id
     group by veh.id),
  f as (select x.vehicle_id, x.last_valid_inspection_date from public.mtsr_vehicle_facts x where x.organization_id = p_organization_id)
  select a.vehicle_id,
         f.last_valid_inspection_date,
         case when f.last_valid_inspection_date is null then null else (v_today - f.last_valid_inspection_date) end,
         dl.ds,
         case when a.ok_count + a.nok_count = 0 then 'sem_informacao' when a.nok_count > 0 then 'nao_conforme' else 'conforme' end,
         case when a.nok_count = 0 then 'sem_criticidade' when dl.ds = 'conforme' then 'media' when dl.ds = 'atencao' then 'alta' else 'critica' end,
         a.nok_count::integer, a.ok_count::integer, (a.ok_count + a.nok_count)::integer,
         ((select count(*) from comps) - a.ok_count - a.nok_count)::integer,
         a.awaiting_count::integer,
         a.main_component_id,
         (select c.name from comps c where c.id = a.main_component_id),
         (select count(*) from comps c where c.verification_mode = 'field')::integer,
         (select count(*) from comps c where c.verification_mode = 'backoffice')::integer
    from agg a
    left join f on f.vehicle_id = a.vehicle_id
    cross join lateral (select private.mtsr_deadline_status(
      case when f.last_valid_inspection_date is null then null else v_today - f.last_valid_inspection_date end, p) as ds) dl;
end;
$$;
comment on function private.mtsr_vehicle_eval(uuid, date) is
  'Motor MTSR por veículo na data: prazo, conformidade, criticidade e componente crítico principal, calculados do estado oficial e dos parâmetros vigentes.';

-- -----------------------------------------------------------------------------
-- 3. Única porta de mudança do estado oficial
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_apply_status(
  p_organization_id uuid, p_vehicle_id uuid, p_component_id uuid, p_status text, p_reference_date date,
  p_source_type text, p_source_system text, p_source_id uuid, p_ingestion_event_id uuid,
  p_inspection_id uuid, p_inspection_item_id uuid, p_observation text,
  p_event_type text, p_event_source text default 'user')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur       public.mtsr_component_status;
  v_prev      text;
  v_changed   boolean;
  v_hist      uuid;
  v_reval     boolean := false;
  v_link      record;
  v_comp      public.mtsr_components;
begin
  if p_status not in ('ok', 'nok', 'sem_informacao') then
    raise exception 'Status de componente inválido: %.', p_status using errcode = 'invalid_parameter_value';
  end if;
  select c.* into v_comp from public.mtsr_components c where c.id = p_component_id and c.organization_id = p_organization_id;
  if v_comp.id is null then
    raise exception 'Componente MTSR não encontrado.' using errcode = 'no_data_found';
  end if;

  insert into public.mtsr_component_status (organization_id, vehicle_id, component_id, status)
  values (p_organization_id, p_vehicle_id, p_component_id, 'sem_informacao')
  on conflict (vehicle_id, component_id) do nothing;

  select s.* into v_cur from public.mtsr_component_status s
   where s.vehicle_id = p_vehicle_id and s.component_id = p_component_id for update;
  v_prev := v_cur.status;
  v_changed := v_prev is distinct from p_status;

  insert into public.mtsr_component_status_history
    (organization_id, vehicle_id, component_id, previous_status, new_status, reference_date, source_type, source_system,
     source_id, ingestion_event_id, inspection_id, inspection_item_id, maintenance_id, observation, actor_user_id, actor_name)
  values (p_organization_id, p_vehicle_id, p_component_id, v_prev, p_status, p_reference_date, p_source_type, p_source_system,
          p_source_id, p_ingestion_event_id, p_inspection_id, p_inspection_item_id, v_cur.awaiting_maintenance_id, p_observation,
          auth.uid(), private.mtsr_actor_name(p_organization_id))
  returning id into v_hist;

  -- Revalidação: havia manutenção concluída à espera de nova verificação.
  if v_cur.awaiting_revalidation and p_source_type is distinct from 'system' then
    v_reval := true;
    for v_link in
      select l.* from public.mtsr_maintenance_links l
       where l.vehicle_id = p_vehicle_id and l.component_id = p_component_id
         and l.status = 'active' and l.revalidation_status = 'awaiting'
    loop
      update public.mtsr_maintenance_links
         set revalidation_status = 'done', revalidated_at = now(), revalidation_source = p_source_type,
             revalidation_history_id = v_hist
       where id = v_link.id;
      perform private.mtsr_log(p_organization_id, 'REVALIDACAO_REALIZADA', p_vehicle_id, p_component_id,
        jsonb_build_object('result', p_status, 'previous_status', v_prev, 'maintenance_id', v_link.maintenance_id),
        p_event_source, p_inspection_id, v_link.maintenance_id, p_ingestion_event_id, v_hist, null, p_source_type);
    end loop;
  end if;

  update public.mtsr_component_status
     set status = p_status,
         reference_date = p_reference_date,
         source_type = p_source_type,
         source_system = p_source_system,
         source_id = p_source_id,
         ingestion_event_id = p_ingestion_event_id,
         inspection_id = p_inspection_id,
         inspection_item_id = p_inspection_item_id,
         observation = p_observation,
         awaiting_revalidation = case when v_reval then false else awaiting_revalidation end,
         awaiting_since = case when v_reval then null else awaiting_since end,
         awaiting_maintenance_id = case when v_reval then null else awaiting_maintenance_id end,
         status_changed_at = case when v_changed then now() else coalesce(status_changed_at, now()) end
   where id = v_cur.id;

  if p_event_type is not null then
    perform private.mtsr_log(p_organization_id, p_event_type, p_vehicle_id, p_component_id,
      jsonb_build_object('status', p_status, 'previous_status', v_prev, 'reference_date', p_reference_date,
                         'changed', v_changed, 'observation', p_observation),
      p_event_source, p_inspection_id, null, p_ingestion_event_id, v_hist, null, p_source_type);
  end if;
  if v_changed then
    perform private.mtsr_log(p_organization_id, 'STATUS_COMPONENTE_ALTERADO', p_vehicle_id, p_component_id,
      jsonb_build_object('from', v_prev, 'to', p_status, 'reference_date', p_reference_date),
      p_event_source, p_inspection_id, null, p_ingestion_event_id, v_hist, null, p_source_type);
    if p_status = 'nok' then
      perform private.mtsr_log(p_organization_id, 'NOK_IDENTIFICADO', p_vehicle_id, p_component_id,
        jsonb_build_object('reference_date', p_reference_date, 'component', v_comp.name, 'observation', p_observation),
        p_event_source, p_inspection_id, null, p_ingestion_event_id, v_hist, null, p_source_type);
    end if;
  end if;

  return jsonb_build_object('history_id', v_hist, 'changed', v_changed, 'previous_status', v_prev,
                            'status', p_status, 'revalidated', v_reval);
end;
$$;
comment on function private.mtsr_apply_status(uuid, uuid, uuid, text, date, text, text, uuid, uuid, uuid, uuid, text, text, text) is
  'Aplica um estado oficial a (veículo, componente): histórico append-only, evento específico, STATUS_COMPONENTE_ALTERADO/NOK_IDENTIFICADO quando muda, e fecha a revalidação pendente de manutenção concluída.';

-- -----------------------------------------------------------------------------
-- 4. Ingestão: um evento (idempotente por hash, prioridade por fonte)
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_source_priority(p_component_id uuid, p_source_id uuid, p_source_type text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_source_type = 'field_inspection' then 0
              else coalesce((select cs.priority from public.mtsr_component_sources cs
                              where cs.component_id = p_component_id and cs.source_id = p_source_id and cs.is_enabled),
                            (select s.priority from public.mtsr_ingestion_sources s where s.id = p_source_id),
                            (select min(cs.priority) from public.mtsr_component_sources cs join public.mtsr_ingestion_sources s on s.id = cs.source_id
                              where cs.component_id = p_component_id and s.source_type = p_source_type),
                            (select min(s.priority) from public.mtsr_ingestion_sources s where s.source_type = p_source_type), 100) end;
$$;

create or replace function private.mtsr_ingest_one(
  p_organization_id uuid, p_source public.mtsr_ingestion_sources, p_event jsonb,
  p_import_batch_id uuid default null, p_event_source text default 'integration', p_force boolean default false,
  p_event_type text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle   record;
  v_comp      public.mtsr_components;
  v_status    text;
  v_ref       date;
  v_ts        timestamptz;
  v_hash      text;
  v_existing  public.mtsr_ingestion_events;
  v_id        uuid;
  v_cur       public.mtsr_component_status;
  v_outcome   text;
  v_reason    text;
  v_cur_prio  integer;
  v_new_prio  integer;
  v_apply     jsonb;
  v_plate     text := nullif(btrim(p_event ->> 'license_plate'), '');
  v_today     date := private.maintenance_today(p_organization_id);
begin
  -- veículo (nunca criado)
  if nullif(p_event ->> 'vehicle_id', '') is not null then
    select v.id, v.license_plate into v_vehicle from public.vehicles v
     where v.id = (p_event ->> 'vehicle_id')::uuid and v.organization_id = p_organization_id and v.deleted_at is null;
  elsif v_plate is not null then
    select v.id, v.license_plate into v_vehicle from public.vehicles v
     where v.organization_id = p_organization_id and v.deleted_at is null
       and v.license_plate = private.normalize_plate(v_plate);
  end if;
  v_comp := private.mtsr_resolve_component(p_organization_id, nullif(p_event ->> 'component_id', '')::uuid, p_event ->> 'component_code');
  v_status := private.mtsr_normalize_status(coalesce(p_event ->> 'status', ''));
  v_ts := nullif(p_event ->> 'source_timestamp', '')::timestamptz;
  v_ref := coalesce(nullif(p_event ->> 'reference_date', '')::date, (v_ts at time zone 'America/Sao_Paulo')::date, v_today);

  v_hash := md5(concat_ws('|', p_source.code, coalesce(v_vehicle.id::text, private.normalize_plate(coalesce(v_plate, ''))),
                          coalesce(v_comp.id::text, private.normalize_label(coalesce(p_event ->> 'component_code', ''))),
                          v_ref::text, coalesce(v_status, private.normalize_label(coalesce(p_event ->> 'status', ''))),
                          coalesce(p_event ->> 'source_record_id', '')));

  select e.* into v_existing from public.mtsr_ingestion_events e
   where e.organization_id = p_organization_id and e.hash = v_hash;
  if v_existing.id is not null then
    return jsonb_build_object('event_id', v_existing.id, 'outcome', v_existing.status, 'duplicate', true,
                              'reason', v_existing.outcome_reason, 'vehicle_id', v_existing.vehicle_id, 'component_id', v_existing.component_id);
  end if;

  insert into public.mtsr_ingestion_events
    (organization_id, source_id, source_type, source_system, source_record_id, source_timestamp, license_plate_raw, vehicle_id,
     component_code_raw, component_id, status_raw, normalized, raw, confidence, hash, import_batch_id, created_by, actor_name)
  values (p_organization_id, p_source.id, p_source.source_type, coalesce(p_event ->> 'source_system', p_source.source_system),
          nullif(p_event ->> 'source_record_id', ''), v_ts, v_plate, v_vehicle.id,
          nullif(p_event ->> 'component_code', ''), v_comp.id, p_event ->> 'status',
          jsonb_build_object('status', v_status, 'reference_date', v_ref, 'observation', nullif(btrim(p_event ->> 'observation'), '')),
          coalesce(p_event -> 'raw', p_event), nullif(p_event ->> 'confidence', '')::numeric, v_hash, p_import_batch_id,
          auth.uid(), private.mtsr_actor_name(p_organization_id))
  returning id into v_id;

  if v_vehicle.id is null then
    v_outcome := 'rejected'; v_reason := 'vehicle_not_found';
  elsif v_comp.id is null then
    v_outcome := 'rejected'; v_reason := 'component_not_found';
  elsif v_status is null then
    v_outcome := 'rejected'; v_reason := 'status_unknown';
  elsif v_ref > v_today then
    v_outcome := 'rejected'; v_reason := 'future_date';
  else
    select s.* into v_cur from public.mtsr_component_status s
     where s.vehicle_id = v_vehicle.id and s.component_id = v_comp.id;
    if not p_force and v_cur.id is not null and v_cur.reference_date is not null and v_cur.status <> 'sem_informacao' then
      v_cur_prio := private.mtsr_source_priority(v_comp.id, v_cur.source_id, v_cur.source_type);
      v_new_prio := private.mtsr_source_priority(v_comp.id, p_source.id, p_source.source_type);
      if v_cur.reference_date > v_ref then
        v_outcome := 'ignored'; v_reason := 'stale';
      elsif v_cur.reference_date = v_ref and v_cur_prio < v_new_prio then
        v_outcome := 'conflict'; v_reason := 'lower_priority_source';
      elsif v_cur.reference_date = v_ref and v_cur_prio = v_new_prio and v_cur.status = v_status then
        v_outcome := 'ignored'; v_reason := 'no_change';
      end if;
    end if;
    if v_outcome is null then
      v_apply := private.mtsr_apply_status(p_organization_id, v_vehicle.id, v_comp.id, v_status, v_ref,
        p_source.source_type, coalesce(p_event ->> 'source_system', p_source.source_system), p_source.id, v_id,
        null, null, nullif(btrim(p_event ->> 'observation'), ''),
        coalesce(p_event_type, case when p_source.source_type = 'manual_import' then 'IMPORTACAO'
                                    when p_source.source_type = 'backoffice_manual' then
                                      case when v_comp.verification_mode = 'backoffice' then 'ATUALIZACAO_BACKOFFICE' else 'ALTERACAO_MANUAL' end
                                    else 'ATUALIZACAO_BACKOFFICE' end),
        p_event_source);
      v_outcome := 'applied';
    end if;
  end if;

  update public.mtsr_ingestion_events
     set status = v_outcome, outcome_reason = v_reason, processed_at = now(), history_id = (v_apply ->> 'history_id')::uuid
   where id = v_id;
  update public.mtsr_ingestion_sources set last_event_at = now() where id = p_source.id;

  if v_outcome in ('ignored', 'conflict') then
    perform private.mtsr_log(p_organization_id, case when v_outcome = 'conflict' then 'INGESTAO_CONFLITO' else 'INGESTAO_IGNORADA' end,
      v_vehicle.id, v_comp.id, jsonb_build_object('reason', v_reason, 'status', v_status, 'reference_date', v_ref, 'source', p_source.code),
      p_event_source, null, null, v_id, null, v_reason, p_source.source_type);
  end if;

  return jsonb_build_object('event_id', v_id, 'outcome', v_outcome, 'duplicate', false, 'reason', v_reason,
                            'vehicle_id', v_vehicle.id, 'component_id', v_comp.id, 'status', v_status,
                            'changed', coalesce((v_apply ->> 'changed')::boolean, false));
end;
$$;
comment on function private.mtsr_ingest_one(uuid, public.mtsr_ingestion_sources, jsonb, uuid, text, boolean, text) is
  'Normaliza, deduplica (hash) e aplica um evento de fonte: applied | ignored (stale, no_change) | conflict (fonte de prioridade pior na mesma data) | rejected (veículo/componente/status). Nunca cria veículo.';

create or replace function public.mtsr_ingest_events(p_organization_id uuid, p_source_code text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.mtsr_ingestion_sources;
  v_res    jsonb;
  v_out    jsonb := '[]'::jsonb;
  e        jsonb;
  n_applied integer := 0; n_ignored integer := 0; n_conflict integer := 0; n_rejected integer := 0; n_dup integer := 0;
begin
  if not private.has_permission(p_organization_id, 'mtsr.ingestion.manage') then
    raise exception 'Sem permissão para registrar ingestão MTSR.' using errcode = 'insufficient_privilege';
  end if;
  select s.* into v_source from public.mtsr_ingestion_sources s
   where s.organization_id = p_organization_id and s.code = p_source_code;
  if v_source.id is null then
    raise exception 'Fonte de ingestão "%" não cadastrada.', p_source_code using errcode = 'no_data_found';
  end if;
  if not v_source.is_enabled or not v_source.is_available then
    raise exception 'A fonte "%" não está habilitada ou não tem adaptador disponível.', v_source.name using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'Informe a lista de eventos.' using errcode = 'invalid_parameter_value';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    v_res := private.mtsr_ingest_one(p_organization_id, v_source, e, null, 'integration', false, null);
    v_out := v_out || v_res;
    if (v_res ->> 'duplicate')::boolean then n_dup := n_dup + 1;
    elsif v_res ->> 'outcome' = 'applied' then n_applied := n_applied + 1;
    elsif v_res ->> 'outcome' = 'ignored' then n_ignored := n_ignored + 1;
    elsif v_res ->> 'outcome' = 'conflict' then n_conflict := n_conflict + 1;
    else n_rejected := n_rejected + 1; end if;
  end loop;
  return jsonb_build_object('source', v_source.code, 'total', jsonb_array_length(p_events), 'applied', n_applied,
                            'ignored', n_ignored, 'conflict', n_conflict, 'rejected', n_rejected, 'duplicate', n_dup,
                            'results', v_out);
end;
$$;
revoke execute on function public.mtsr_ingest_events(uuid, text, jsonb) from public, anon;
grant  execute on function public.mtsr_ingest_events(uuid, text, jsonb) to authenticated, service_role;

-- Atualização manual do backoffice (vários componentes do mesmo veículo).
create or replace function public.mtsr_component_status_update(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_source  public.mtsr_ingestion_sources;
  v_item    jsonb;
  v_res     jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_ref     date;
  v_today   date := private.maintenance_today(p_organization_id);
begin
  if not private.has_permission(p_organization_id, 'mtsr.backoffice.update') then
    raise exception 'Sem permissão para atualizar o estado oficial de componentes.' using errcode = 'insufficient_privilege';
  end if;
  if v_vehicle is null or not exists (select 1 from public.vehicles v where v.id = v_vehicle and v.organization_id = p_organization_id and v.deleted_at is null) then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if not private.vehicle_in_scope(p_organization_id, v_vehicle) then
    raise exception 'Veículo fora do seu escopo de operação.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Informe ao menos um componente.' using errcode = 'invalid_parameter_value';
  end if;
  select s.* into v_source from public.mtsr_ingestion_sources s
   where s.organization_id = p_organization_id and s.code = 'backoffice_manual';
  if v_source.id is null then
    raise exception 'Fonte backoffice_manual não cadastrada.' using errcode = 'no_data_found';
  end if;
  v_ref := coalesce(nullif(p_payload ->> 'reference_date', '')::date, v_today);
  if v_ref > v_today then
    raise exception 'A data de referência não pode ser futura.' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items') loop
    if nullif(btrim(v_item ->> 'observation'), '') is null and private.mtsr_normalize_status(v_item ->> 'status') = 'nok' then
      raise exception 'Descreva a inconformidade do componente marcado como NOK.' using errcode = 'invalid_parameter_value';
    end if;
    v_res := private.mtsr_ingest_one(p_organization_id, v_source,
      jsonb_build_object('vehicle_id', v_vehicle, 'component_id', v_item ->> 'component_id', 'status', v_item ->> 'status',
                         'reference_date', coalesce(nullif(v_item ->> 'reference_date', ''), v_ref::text),
                         'observation', v_item ->> 'observation', 'source_system', coalesce(p_payload ->> 'source_system', 'HFM Backoffice'),
                         'source_record_id', coalesce(p_payload ->> 'reference', ''), 'raw', v_item),
      null, 'user', true, null);
    if v_res ->> 'outcome' = 'rejected' then
      raise exception 'Componente não aplicado: %.', v_res ->> 'reason' using errcode = 'invalid_parameter_value';
    end if;
    v_out := v_out || v_res;
  end loop;
  return jsonb_build_object('vehicle_id', v_vehicle, 'applied', jsonb_array_length(v_out), 'results', v_out);
end;
$$;
revoke execute on function public.mtsr_component_status_update(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_component_status_update(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Frota filtrada (escopo + filtros por ID), base das leituras
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_fleet_filtered(p_organization_id uuid, p_filters jsonb, p_today date)
returns table (
  vehicle_id uuid, license_plate text, fleet_code text, vehicle_status text,
  vehicle_type_id uuid, vehicle_type_name text, subcategory_name text, model_name text,
  context_source text, operation_id uuid, operation_name text, operation_city_id uuid,
  state_id smallint, state_uf text, city_id integer, city_name text,
  operation_br_id uuid, br_code text, leader_employee_id uuid, leader_name text,
  organization_unit_id uuid, unit_name text,
  last_valid_inspection_date date, days_since integer, deadline_status text, conformity_status text, criticality text,
  nok_count integer, ok_count integer, known_count integer, unknown_count integer, awaiting_count integer,
  main_component_id uuid, main_component_name text,
  open_maintenances integer, pending_inspections integer, last_submission_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f_search    text := nullif(btrim(p_filters ->> 'search'), '');
  f_ops       uuid[] := private.km_uuid_array(p_filters -> 'operation_ids');
  f_states    integer[] := private.km_int_array(p_filters -> 'state_ids');
  f_cities    integer[] := private.km_int_array(p_filters -> 'city_ids');
  f_brs       uuid[] := private.km_uuid_array(p_filters -> 'br_ids');
  f_leaders   uuid[] := private.km_uuid_array(p_filters -> 'leader_ids');
  f_units     uuid[] := private.km_uuid_array(p_filters -> 'unit_ids');
  f_types     uuid[] := private.km_uuid_array(p_filters -> 'vehicle_type_ids');
  f_vehicles  uuid[] := private.km_uuid_array(p_filters -> 'vehicle_ids');
  f_deadline  text[] := private.jsonb_text_array(p_filters -> 'deadline_statuses');
  f_conf      text[] := private.jsonb_text_array(p_filters -> 'conformity_statuses');
  f_crit      text[] := private.jsonb_text_array(p_filters -> 'criticalities');
  f_comp      uuid := nullif(p_filters ->> 'component_id', '')::uuid;
  f_comp_st   text[] := private.jsonb_text_array(p_filters -> 'component_statuses');
  f_awaiting  boolean := nullif(p_filters ->> 'awaiting_revalidation', '')::boolean;
  f_fleet     text := coalesce(nullif(p_filters ->> 'fleet_status', ''), 'default');
  v_all       boolean := private.is_platform_admin() or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_ids       uuid[];
begin
  select coalesce(array_agg(v.id), '{}') into v_ids
    from public.vehicles v
   where v.organization_id = p_organization_id and v.deleted_at is null
     and (f_fleet = 'all' or (f_fleet = 'inactive' and v.status <> 'active') or (f_fleet = 'default' and v.status = 'active'))
     and (f_vehicles is null or cardinality(f_vehicles) = 0 or v.id = any (f_vehicles))
     and (f_types is null or cardinality(f_types) = 0 or v.vehicle_type_id = any (f_types))
     and (f_search is null or v.license_plate like '%' || private.normalize_plate(f_search) || '%'
          or upper(coalesce(v.fleet_code, '')) like '%' || upper(f_search) || '%');
  if cardinality(v_ids) = 0 then return; end if;

  return query
  with ctx as (
    select c.* from private.km_context_pairs(p_organization_id, v_ids, array_fill(p_today, array[cardinality(v_ids)])) c),
  ev as (select * from private.mtsr_vehicle_eval(p_organization_id, p_today) e where e.vehicle_id = any (v_ids)),
  om as (
    select l.vehicle_id, count(distinct l.maintenance_id)::integer as n
      from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
     where l.organization_id = p_organization_id and l.status = 'active' and m.status in ('to_schedule', 'scheduled', 'in_progress')
     group by l.vehicle_id),
  pi as (
    select i.vehicle_id, count(*)::integer as n, max(i.submitted_at) as last_at
      from public.mtsr_inspections i where i.organization_id = p_organization_id and i.status = 'pendente_validacao' group by i.vehicle_id),
  ls as (select i.vehicle_id, max(i.submitted_at) as last_at from public.mtsr_inspections i where i.organization_id = p_organization_id group by i.vehicle_id),
  scope as (select private.org_vehicle_scope_ids(p_organization_id) as id),
  ops as (select private.accessible_operation_ids() as id)
  select v.id, v.license_plate, v.fleet_code, v.status,
         v.vehicle_type_id, vt.name, sc.name, vm.name,
         c.context_source, c.operation_id, o.name, c.operation_city_id,
         c.state_id, s.uf::text, c.city_id, ci.name,
         c.operation_br_id, b.code, c.leader_employee_id, le.full_name,
         c.organization_unit_id, u.name,
         e.last_valid_inspection_date, e.days_since, e.deadline_status, e.conformity_status, e.criticality,
         e.nok_count, e.ok_count, e.known_count, e.unknown_count, e.awaiting_count,
         e.main_component_id, e.main_component_name,
         coalesce(om.n, 0), coalesce(pi.n, 0), ls.last_at
    from public.vehicles v
    join ev e on e.vehicle_id = v.id
    left join ctx c on c.vehicle_id = v.id
    left join public.vehicle_types vt on vt.id = v.vehicle_type_id
    left join public.vehicle_subcategories sc on sc.id = v.vehicle_subcategory_id
    left join public.vehicle_models vm on vm.id = v.vehicle_model_id
    left join public.operations o on o.id = c.operation_id
    left join public.states s on s.id = c.state_id
    left join public.cities ci on ci.id = c.city_id
    left join public.operation_brs b on b.id = c.operation_br_id
    left join public.employees le on le.id = c.leader_employee_id
    left join public.organization_units u on u.id = c.organization_unit_id
    left join om on om.vehicle_id = v.id
    left join pi on pi.vehicle_id = v.id
    left join ls on ls.vehicle_id = v.id
   where v.id = any (v_ids)
     and (v_all or (c.operation_id is not null and c.operation_id in (select id from ops))
          or (c.operation_id is null and v.id in (select id from scope)))
     and (f_ops is null or cardinality(f_ops) = 0 or c.operation_id = any (f_ops))
     and (f_states is null or cardinality(f_states) = 0 or c.state_id = any (f_states))
     and (f_cities is null or cardinality(f_cities) = 0 or c.city_id = any (f_cities))
     and (f_brs is null or cardinality(f_brs) = 0 or c.operation_br_id = any (f_brs))
     and (f_leaders is null or cardinality(f_leaders) = 0 or c.leader_employee_id = any (f_leaders))
     and (f_units is null or cardinality(f_units) = 0 or c.organization_unit_id = any (f_units))
     and (f_deadline is null or cardinality(f_deadline) = 0 or e.deadline_status = any (f_deadline))
     and (f_conf is null or cardinality(f_conf) = 0 or e.conformity_status = any (f_conf))
     and (f_crit is null or cardinality(f_crit) = 0 or e.criticality = any (f_crit))
     and (f_awaiting is null or (f_awaiting and e.awaiting_count > 0) or (not f_awaiting and e.awaiting_count = 0))
     and (f_comp is null or f_comp_st is null or cardinality(f_comp_st) = 0
          or coalesce((select st.status from public.mtsr_component_status st where st.vehicle_id = v.id and st.component_id = f_comp), 'sem_informacao') = any (f_comp_st));
end;
$$;
comment on function private.mtsr_fleet_filtered(uuid, jsonb, date) is
  'Frota MTSR no escopo da pessoa com contexto operacional por IDs (Fidelização → alocação; liderança BR → cidade → operação), avaliação do motor e filtros técnicos por ID.';

-- -----------------------------------------------------------------------------
-- 6. Leituras públicas
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_require_view(p_organization_id uuid, p_permission text default 'mtsr.view')
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'mtsr.view') or not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Sem permissão para acessar a Gestão de MTSR.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.mtsr_catalog(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_today date := private.maintenance_today(p_organization_id); p public.mtsr_parameter_sets;
begin
  perform private.mtsr_require_view(p_organization_id);
  p := private.mtsr_params_at(p_organization_id, v_today);
  return jsonb_build_object(
    'today', v_today,
    'components', coalesce((select jsonb_agg(to_jsonb(c) - 'organization_id' order by c.sort_order, c.name) from public.mtsr_components c where c.organization_id = p_organization_id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) - 'organization_id' - 'config' order by s.priority, s.name) from public.mtsr_ingestion_sources s where s.organization_id = p_organization_id), '[]'::jsonb),
    'component_sources', coalesce((select jsonb_agg(jsonb_build_object('component_id', cs.component_id, 'source_id', cs.source_id, 'priority', cs.priority, 'is_enabled', cs.is_enabled)) from public.mtsr_component_sources cs where cs.organization_id = p_organization_id), '[]'::jsonb),
    'component_services', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'component_id', x.component_id, 'service_id', x.service_id, 'is_default', x.is_default, 'is_active', x.is_active,
                                      'service_name', ms.name, 'cluster_name', mc.name))
                                     from public.mtsr_component_services x join public.maintenance_services ms on ms.id = x.service_id
                                     left join public.maintenance_clusters mc on mc.id = ms.cluster_id where x.organization_id = p_organization_id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', ms.id, 'name', ms.name, 'cluster_id', ms.cluster_id, 'cluster_name', mc.name, 'criticality', ms.criticality) order by mc.name, ms.name)
                            from public.maintenance_services ms left join public.maintenance_clusters mc on mc.id = ms.cluster_id
                           where ms.organization_id = p_organization_id and ms.deleted_at is null and ms.status = 'active'), '[]'::jsonb),
    'parameters', to_jsonb(p) - 'organization_id',
    'parameter_history', coalesce((select jsonb_agg(to_jsonb(h) - 'organization_id' order by h.effective_from desc) from public.mtsr_parameter_sets h where h.organization_id = p_organization_id), '[]'::jsonb),
    'origin_mtsr_id', (select o.id from public.maintenance_origins o where o.organization_id is null and o.code = 'mtsr'));
end;
$$;
revoke execute on function public.mtsr_catalog(uuid) from public, anon;
grant  execute on function public.mtsr_catalog(uuid) to authenticated;

create or replace function public.mtsr_fleet_status(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_sort text default 'criticality',
  p_dir text default 'desc', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today  date := private.maintenance_today(p_organization_id);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
  v_groups jsonb;
  v_sum    jsonb;
  v_desc   boolean := coalesce(p_dir, 'desc') = 'desc';
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.conformity.view');

  with f as materialized (select * from private.mtsr_fleet_filtered(p_organization_id, coalesce(p_filters, '{}'::jsonb), v_today)),
  ordered as (
    select f.*, row_number() over (order by
      case when v_desc then -k.n end, case when not v_desc then k.n end,
      case when v_desc then k.t end desc, case when not v_desc then k.t end asc,
      f.operation_name nulls last, f.license_plate) as rn
    from f
    cross join lateral (select
      case p_sort
        when 'criticality'     then case f.criticality when 'critica' then 3 when 'alta' then 2 when 'media' then 1 else 0 end
        when 'deadline'        then case f.deadline_status when 'vencido' then 3 when 'pendente' then 2 when 'atencao' then 1 else 0 end
        when 'nok'             then f.nok_count
        when 'last_inspection' then coalesce(f.days_since, 100000)
        else 0 end as n,
      case p_sort when 'plate' then f.license_plate when 'operation' then coalesce(f.operation_name, 'zzzz') else null end as t) k),
  comps as (
    select o.vehicle_id,
           jsonb_agg(jsonb_build_object('component_id', c.id, 'code', c.code, 'name', c.name, 'verification_mode', c.verification_mode,
                       'status', coalesce(st.status, 'sem_informacao'), 'reference_date', st.reference_date, 'source_type', st.source_type,
                       'awaiting_revalidation', coalesce(st.awaiting_revalidation, false), 'observation', st.observation)
                     order by c.sort_order) as cells
      from ordered o
      cross join public.mtsr_components c
      left join public.mtsr_component_status st on st.vehicle_id = o.vehicle_id and st.component_id = c.id
     where c.organization_id = p_organization_id and c.is_active and o.rn > v_offset and o.rn <= v_offset + v_limit
     group by o.vehicle_id)
  select (select count(*) from f),
         coalesce((select jsonb_agg((to_jsonb(o) - 'rn') || jsonb_build_object('components', coalesce(cp.cells, '[]'::jsonb)) order by o.rn)
                     from ordered o left join comps cp on cp.vehicle_id = o.vehicle_id
                    where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb),
         coalesce((select jsonb_agg(g order by g ->> 'operation_name' nulls last) from (
                     select jsonb_build_object('operation_id', f.operation_id, 'operation_name', f.operation_name,
                              'total', count(*), 'nao_conforme', count(*) filter (where f.conformity_status = 'nao_conforme'),
                              'critica', count(*) filter (where f.criticality = 'critica'),
                              'vencido', count(*) filter (where f.deadline_status = 'vencido')) as g
                       from f group by f.operation_id, f.operation_name) x), '[]'::jsonb),
         jsonb_build_object(
           'vehicles', (select count(*) from f),
           'conforme', (select count(*) from f where f.conformity_status = 'conforme'),
           'nao_conforme', (select count(*) from f where f.conformity_status = 'nao_conforme'),
           'sem_informacao', (select count(*) from f where f.conformity_status = 'sem_informacao'),
           'critica', (select count(*) from f where f.criticality = 'critica'),
           'alta', (select count(*) from f where f.criticality = 'alta'),
           'media', (select count(*) from f where f.criticality = 'media'),
           'vencido', (select count(*) from f where f.deadline_status = 'vencido'),
           'atencao', (select count(*) from f where f.deadline_status = 'atencao'),
           'pendente', (select count(*) from f where f.deadline_status = 'pendente'),
           'awaiting', (select count(*) from f where f.awaiting_count > 0))
    into v_total, v_rows, v_groups, v_sum;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', v_rows, 'groups', v_groups, 'summary', v_sum,
                            'limit', v_limit, 'offset', v_offset, 'today', v_today);
end;
$$;
revoke execute on function public.mtsr_fleet_status(uuid, jsonb, text, text, integer, integer) from public, anon;
grant  execute on function public.mtsr_fleet_status(uuid, jsonb, text, text, integer, integer) to authenticated;

-- Visão geral: KPIs e séries sobre a frota filtrada (nunca valores 0 como
-- fallback de falha: a ausência de base vem em `empty`).
create or replace function public.mtsr_dashboard(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  p public.mtsr_parameter_sets;
  v_ids uuid[];
  v_kpis jsonb; v_by_comp jsonb; v_ranking jsonb; v_by_op jsonb; v_by_city jsonb; v_by_type jsonb;
  v_m_status jsonb; v_m_aging jsonb; v_insp_status jsonb; v_trend jsonb; v_sources jsonb; v_crit jsonb; v_dead jsonb; v_conf jsonb;
  v_vehicles integer;
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.dashboard.view');
  p := private.mtsr_params_at(p_organization_id, v_today);

  -- Uma única passagem sobre a frota filtrada (sem tabela temporária): KPIs e distribuições
  with f as materialized (
    select * from private.mtsr_fleet_filtered(p_organization_id, coalesce(p_filters, '{}'::jsonb), v_today))
  select
    (select count(*) from f),
    (select coalesce(array_agg(f.vehicle_id), '{}') from f),
    (select jsonb_build_object(
      'vehicles', count(*),
      'monitored', count(*) filter (where known_count > 0),
      'with_inspection', count(*) filter (where last_valid_inspection_date is not null),
      'conforme', count(*) filter (where conformity_status = 'conforme'),
      'nao_conforme', count(*) filter (where conformity_status = 'nao_conforme'),
      'sem_informacao', count(*) filter (where conformity_status = 'sem_informacao'),
      'conformity_pct', case when count(*) filter (where conformity_status <> 'sem_informacao') = 0 then null
                             else round(100.0 * count(*) filter (where conformity_status = 'conforme') / count(*) filter (where conformity_status <> 'sem_informacao'), 1) end,
      'critica', count(*) filter (where criticality = 'critica'),
      'alta', count(*) filter (where criticality = 'alta'),
      'media', count(*) filter (where criticality = 'media'),
      'vencido', count(*) filter (where deadline_status = 'vencido'),
      'atencao', count(*) filter (where deadline_status = 'atencao'),
      'pendente', count(*) filter (where deadline_status = 'pendente'),
      'conforme_prazo', count(*) filter (where deadline_status = 'conforme'),
      'awaiting_vehicles', count(*) filter (where awaiting_count > 0),
      'awaiting_components', coalesce(sum(awaiting_count), 0),
      'nok_components', coalesce(sum(nok_count), 0),
      'open_maintenances', coalesce(sum(open_maintenances), 0),
      'pending_inspections', coalesce(sum(pending_inspections), 0),
      'avg_days_since_inspection', round(avg(days_since)::numeric, 1),
      'coverage_pct', case when count(*) = 0 then null else round(100.0 * count(*) filter (where last_valid_inspection_date is not null) / count(*), 1) end)
      from f),
    (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'total', n)), '[]'::jsonb)
       from (select criticality k, count(*) n from f group by criticality) z),
    (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'total', n)), '[]'::jsonb)
       from (select deadline_status k, count(*) n from f group by deadline_status) z),
    (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'total', n)), '[]'::jsonb)
       from (select conformity_status k, count(*) n from f group by conformity_status) z),
    (select coalesce(jsonb_agg(jsonb_build_object('operation_id', operation_id, 'name', operation_name, 'total', n, 'nao_conforme', nc, 'critica', cr, 'vencido', vz)
              order by nc desc, n desc), '[]'::jsonb)
       from (select operation_id, operation_name, count(*) n, count(*) filter (where conformity_status = 'nao_conforme') nc,
                    count(*) filter (where criticality = 'critica') cr, count(*) filter (where deadline_status = 'vencido') vz
               from f group by operation_id, operation_name) z),
    (select coalesce(jsonb_agg(jsonb_build_object('city_id', city_id, 'name', city_name, 'state_uf', state_uf, 'total', n, 'nao_conforme', nc) order by nc desc, n desc), '[]'::jsonb)
       from (select city_id, city_name, state_uf, count(*) n, count(*) filter (where conformity_status = 'nao_conforme') nc from f group by city_id, city_name, state_uf) z),
    (select coalesce(jsonb_agg(jsonb_build_object('vehicle_type_id', vehicle_type_id, 'name', vehicle_type_name, 'total', n, 'nao_conforme', nc) order by n desc), '[]'::jsonb)
       from (select vehicle_type_id, vehicle_type_name, count(*) n, count(*) filter (where conformity_status = 'nao_conforme') nc from f group by vehicle_type_id, vehicle_type_name) z)
    into v_vehicles, v_ids, v_kpis, v_crit, v_dead, v_conf, v_by_op, v_by_city, v_by_type;

  -- KPIs de fluxo (vistorias e manutenção) restritos aos veículos filtrados
  v_kpis := v_kpis || (
    select jsonb_build_object(
      'pending_over_sla', (select count(*) from public.mtsr_inspections i where i.organization_id = p_organization_id and i.status = 'pendente_validacao'
                             and i.vehicle_id = any (v_ids) and i.submitted_at < now() - (p.review_sla_days || ' days')::interval),
      'avg_review_hours', (select round(avg(extract(epoch from (i.reviewed_at - i.submitted_at)) / 3600.0)::numeric, 1) from public.mtsr_inspections i
                             where i.organization_id = p_organization_id and i.reviewed_at is not null and i.submitted_at >= now() - interval '90 days'
                               and i.vehicle_id = any (v_ids)),
      'inspections_30d', (select count(*) from public.mtsr_inspections i where i.organization_id = p_organization_id and i.submitted_at >= now() - interval '30 days'
                             and i.vehicle_id = any (v_ids)),
      'returned_rate_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where i.status in ('retornada', 'rejeitada')) / count(*), 1) end
                              from public.mtsr_inspections i where i.organization_id = p_organization_id and i.submitted_at >= now() - interval '90 days'
                               and i.vehicle_id = any (v_ids)),
      'nok_without_maintenance', (select count(*) from public.mtsr_component_status s
                                    where s.organization_id = p_organization_id and s.status = 'nok' and s.vehicle_id = any (v_ids)
                                      and not exists (select 1 from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                                                       where l.vehicle_id = s.vehicle_id and l.component_id = s.component_id and l.status = 'active'
                                                         and m.status in ('to_schedule', 'scheduled', 'in_progress'))),
      'nok_over_open_sla', (select count(*) from public.mtsr_component_status s
                              where s.organization_id = p_organization_id and s.status = 'nok' and s.vehicle_id = any (v_ids)
                                and s.status_changed_at < now() - (p.maintenance_open_sla_days || ' days')::interval
                                and not exists (select 1 from public.mtsr_maintenance_links l where l.vehicle_id = s.vehicle_id and l.component_id = s.component_id and l.status = 'active')),
      'awaiting_over_sla', (select count(*) from public.mtsr_component_status s
                              where s.organization_id = p_organization_id and s.awaiting_revalidation and s.vehicle_id = any (v_ids)
                                and s.awaiting_since < now() - (p.revalidation_sla_days || ' days')::interval),
      'avg_days_nok_to_maintenance', (select round(avg(extract(epoch from (l.linked_at - h.occurred_at)) / 86400.0)::numeric, 1)
                                        from public.mtsr_maintenance_links l join public.mtsr_component_status_history h on h.id = l.source_history_id
                                       where l.organization_id = p_organization_id and l.linked_at >= now() - interval '180 days'
                                         and l.vehicle_id = any (v_ids))));

  select coalesce(jsonb_agg(jsonb_build_object('component_id', c.id, 'code', c.code, 'name', c.name, 'verification_mode', c.verification_mode,
           'ok', x.ok, 'nok', x.nok, 'sem_informacao', v_vehicles - x.ok - x.nok, 'awaiting', x.awaiting) order by c.sort_order), '[]'::jsonb)
    into v_by_comp
    from public.mtsr_components c
    cross join lateral (
      select count(*) filter (where s.status = 'ok') as ok, count(*) filter (where s.status = 'nok') as nok, count(*) filter (where s.awaiting_revalidation) as awaiting
        from public.mtsr_component_status s where s.component_id = c.id and s.vehicle_id = any (v_ids)) x
   where c.organization_id = p_organization_id and c.is_active;

  v_ranking := coalesce((select jsonb_agg(jsonb_build_object('component_id', e ->> 'component_id', 'name', e ->> 'name', 'total', (e ->> 'nok')::int)
                                order by (e ->> 'nok')::int desc) from jsonb_array_elements(v_by_comp) e where (e ->> 'nok')::int > 0), '[]'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object('status', st, 'label', private.maintenance_status_label(st), 'total', n) order by n desc), '[]'::jsonb) into v_m_status
    from (select m.status st, count(distinct m.id) n
            from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
           where l.organization_id = p_organization_id and l.status = 'active' and l.vehicle_id = any (v_ids)
           group by m.status) z;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'total', n) order by o), '[]'::jsonb) into v_m_aging
    from (select case when d <= 7 then '0–7 d' when d <= 15 then '8–15 d' when d <= 30 then '16–30 d' when d <= 60 then '31–60 d' else '> 60 d' end b,
                 case when d <= 7 then 1 when d <= 15 then 2 when d <= 30 then 3 when d <= 60 then 4 else 5 end o, count(*) n
            from (select distinct m.id, (v_today - m.requested_on) d
                    from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                   where l.organization_id = p_organization_id and l.status = 'active' and m.status in ('to_schedule', 'scheduled', 'in_progress')
                     and l.vehicle_id = any (v_ids)) x
           group by 1, 2) z;

  select coalesce(jsonb_agg(jsonb_build_object('status', st, 'total', n)), '[]'::jsonb) into v_insp_status
    from (select i.status st, count(*) n from public.mtsr_inspections i where i.organization_id = p_organization_id
            and i.vehicle_id = any (v_ids) group by i.status) z;
  select coalesce(jsonb_agg(jsonb_build_object('week_start', ws, 'submitted', s, 'validated', v, 'nok', k) order by ws), '[]'::jsonb) into v_trend
    from (select date_trunc('week', i.submitted_at at time zone 'America/Sao_Paulo')::date ws, count(*) s,
                 count(*) filter (where i.status = 'validada') v, coalesce(sum(i.nok_count), 0) k
            from public.mtsr_inspections i
           where i.organization_id = p_organization_id and i.submitted_at >= now() - interval '12 weeks'
             and i.vehicle_id = any (v_ids)
           group by 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'source_type', s.source_type, 'is_enabled', s.is_enabled,
           'is_available', s.is_available, 'last_event_at', s.last_event_at,
           'days_since', case when s.last_event_at is null then null else (v_today - (s.last_event_at at time zone 'America/Sao_Paulo')::date) end,
           'events_30d', (select count(*) from public.mtsr_ingestion_events e where e.source_id = s.id and e.received_at >= now() - interval '30 days'))
           order by s.priority, s.name), '[]'::jsonb) into v_sources
    from public.mtsr_ingestion_sources s where s.organization_id = p_organization_id;

  return jsonb_build_object(
    'today', v_today, 'empty', coalesce(v_vehicles, 0) = 0 or coalesce((v_kpis ->> 'monitored')::int, 0) = 0,
    'parameters', to_jsonb(p) - 'organization_id',
    'kpis', v_kpis, 'by_component', v_by_comp, 'ranking_nok', v_ranking,
    'by_criticality', v_crit, 'by_deadline', v_dead, 'by_conformity', v_conf,
    'by_operation', v_by_op, 'by_city', v_by_city, 'by_vehicle_type', v_by_type,
    'maintenance_by_status', v_m_status, 'maintenance_aging', v_m_aging,
    'inspections_by_status', v_insp_status, 'inspections_trend', v_trend, 'sources', v_sources);
end;
$$;
revoke execute on function public.mtsr_dashboard(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_dashboard(uuid, jsonb) to authenticated;

-- Ficha MTSR 360° do veículo
create or replace function public.mtsr_vehicle_sheet(p_organization_id uuid, p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  v_row jsonb;
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.conformity.view');
  select to_jsonb(f) into v_row from private.mtsr_fleet_filtered(p_organization_id,
    jsonb_build_object('vehicle_ids', jsonb_build_array(p_vehicle_id), 'fleet_status', 'all'), v_today) f;
  if v_row is null then
    return jsonb_build_object('vehicle', null, 'today', v_today);
  end if;
  return jsonb_build_object(
    'today', v_today,
    'vehicle', v_row,
    'card', private.km_vehicle_card(p_vehicle_id),
    'facts', (select to_jsonb(x) - 'organization_id' from public.mtsr_vehicle_facts x where x.vehicle_id = p_vehicle_id),
    'components', coalesce((select jsonb_agg(jsonb_build_object(
        'component_id', c.id, 'code', c.code, 'name', c.name, 'verification_mode', c.verification_mode, 'base_criticality', c.base_criticality,
        'priority', c.priority, 'status', coalesce(s.status, 'sem_informacao'), 'reference_date', s.reference_date, 'source_type', s.source_type,
        'source_system', s.source_system, 'observation', s.observation, 'awaiting_revalidation', coalesce(s.awaiting_revalidation, false),
        'awaiting_since', s.awaiting_since, 'awaiting_maintenance_id', s.awaiting_maintenance_id, 'status_changed_at', s.status_changed_at,
        'inspection_id', s.inspection_id,
        'open_maintenance', (select jsonb_build_object('id', m.id, 'code', m.code, 'status', m.status, 'label', private.maintenance_status_label(m.status))
                               from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id
                              where l.vehicle_id = p_vehicle_id and l.component_id = c.id and l.status = 'active'
                                and m.status in ('to_schedule', 'scheduled', 'in_progress') order by m.requested_on desc limit 1),
        'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'previous_status', h.previous_status, 'new_status', h.new_status,
                              'reference_date', h.reference_date, 'source_type', h.source_type, 'source_system', h.source_system, 'inspection_id', h.inspection_id,
                              'observation', h.observation, 'actor_name', h.actor_name, 'occurred_at', h.occurred_at) order by h.occurred_at desc)
                             from (select * from public.mtsr_component_status_history h0 where h0.vehicle_id = p_vehicle_id and h0.component_id = c.id order by h0.occurred_at desc limit 10) h), '[]'::jsonb))
        order by c.sort_order)
      from public.mtsr_components c left join public.mtsr_component_status s on s.vehicle_id = p_vehicle_id and s.component_id = c.id
      where c.organization_id = p_organization_id and c.is_active), '[]'::jsonb),
    'inspections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'protocol', i.protocol, 'status', i.status, 'inspection_date', i.inspection_date, 'submitted_at', i.submitted_at,
        'inspector_name', i.inspector_name_snapshot, 'inspector_code', i.inspector_code_snapshot, 'item_count', i.item_count, 'nok_count', i.nok_count,
        'evidence_count', i.evidence_count, 'reviewed_at', i.reviewed_at, 'reviewer_name', i.reviewer_name_snapshot, 'review_reason', i.review_reason,
        'items', coalesce((select jsonb_agg(jsonb_build_object('component_id', it.component_id, 'component_name', c2.name, 'status', it.status,
                            'observation', it.observation, 'evidence_count', it.evidence_count) order by c2.sort_order)
                           from public.mtsr_inspection_items it join public.mtsr_components c2 on c2.id = it.component_id where it.inspection_id = i.id), '[]'::jsonb))
        order by i.submitted_at desc)
      from (select * from public.mtsr_inspections i0 where i0.vehicle_id = p_vehicle_id order by i0.submitted_at desc limit 50) i), '[]'::jsonb),
    'maintenances', coalesce((select jsonb_agg(jsonb_build_object(
        'link_id', l.id, 'maintenance_id', m.id, 'code', m.code, 'status', m.status, 'label', private.maintenance_status_label(m.status),
        'component_id', l.component_id, 'component_name', c3.name, 'link_type', l.link_type, 'link_status', l.status,
        'revalidation_status', l.revalidation_status, 'maintenance_concluded_at', l.maintenance_concluded_at, 'revalidated_at', l.revalidated_at,
        'requested_on', m.requested_on, 'scheduled_date', m.scheduled_date, 'exit_date', m.exit_date, 'service_order_number', m.service_order_number,
        'supplier', (select sp.name from public.maintenance_suppliers sp where sp.id = m.supplier_id), 'linked_at', l.linked_at, 'inspection_id', l.inspection_id)
        order by l.linked_at desc)
      from public.mtsr_maintenance_links l join public.maintenances m on m.id = l.maintenance_id join public.mtsr_components c3 on c3.id = l.component_id
      where l.vehicle_id = p_vehicle_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'component_id', e.component_id,
        'component_name', (select c4.name from public.mtsr_components c4 where c4.id = e.component_id), 'source_type', e.source_type, 'inspection_id', e.inspection_id,
        'maintenance_id', e.maintenance_id, 'payload', e.payload, 'reason', e.reason, 'actor_name', e.actor_name, 'source', e.source, 'occurred_at', e.occurred_at)
        order by e.occurred_at desc)
      from (select * from public.mtsr_events e0 where e0.vehicle_id = p_vehicle_id order by e0.occurred_at desc limit 200) e), '[]'::jsonb));
end;
$$;
revoke execute on function public.mtsr_vehicle_sheet(uuid, uuid) from public, anon;
grant  execute on function public.mtsr_vehicle_sheet(uuid, uuid) to authenticated;

-- Resumo para a aba MTSR da ficha de Frotas (permissão do módulo + escopo)
create or replace function public.mtsr_vehicle_summary(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid; v_today date; v_row jsonb;
begin
  select v.organization_id into v_org from public.vehicles v where v.id = p_vehicle_id;
  if v_org is null or not private.has_permission(v_org, 'mtsr.view') or not private.vehicle_in_scope(v_org, p_vehicle_id) then
    raise exception 'Sem permissão para ver a situação MTSR deste veículo.' using errcode = 'insufficient_privilege';
  end if;
  v_today := private.maintenance_today(v_org);
  select to_jsonb(f) into v_row from private.mtsr_fleet_filtered(v_org,
    jsonb_build_object('vehicle_ids', jsonb_build_array(p_vehicle_id), 'fleet_status', 'all'), v_today) f;
  return jsonb_build_object('today', v_today, 'vehicle', v_row,
    'components', coalesce((select jsonb_agg(jsonb_build_object('component_id', c.id, 'name', c.name, 'verification_mode', c.verification_mode,
        'status', coalesce(s.status, 'sem_informacao'), 'reference_date', s.reference_date, 'awaiting_revalidation', coalesce(s.awaiting_revalidation, false)) order by c.sort_order)
      from public.mtsr_components c left join public.mtsr_component_status s on s.vehicle_id = p_vehicle_id and s.component_id = c.id
      where c.organization_id = v_org and c.is_active), '[]'::jsonb),
    'last_inspection', (select jsonb_build_object('id', i.id, 'protocol', i.protocol, 'status', i.status, 'inspection_date', i.inspection_date, 'nok_count', i.nok_count)
                          from public.mtsr_inspections i where i.vehicle_id = p_vehicle_id order by i.submitted_at desc limit 1));
end;
$$;
revoke execute on function public.mtsr_vehicle_summary(uuid) from public, anon;
grant  execute on function public.mtsr_vehicle_summary(uuid) to authenticated;

-- Auditoria do domínio
create or replace function public.mtsr_events_list(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  f_types text[] := private.jsonb_text_array(p_filters -> 'event_types');
  f_vehicles uuid[] := private.km_uuid_array(p_filters -> 'vehicle_ids');
  f_from date := nullif(p_filters ->> 'date_from', '')::date;
  f_to date := nullif(p_filters ->> 'date_to', '')::date;
  f_search text := nullif(btrim(p_filters ->> 'search'), '');
  v_total integer; v_rows jsonb;
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.audit.view');
  with scope as (select private.org_vehicle_scope_ids(p_organization_id) as id),
  base as (
    select e.*, v.license_plate, v.fleet_code, c.name as component_name
      from public.mtsr_events e
      left join public.vehicles v on v.id = e.vehicle_id
      left join public.mtsr_components c on c.id = e.component_id
     where e.organization_id = p_organization_id
       and (e.vehicle_id is null or e.vehicle_id in (select id from scope))
       and (f_types is null or cardinality(f_types) = 0 or e.event_type = any (f_types))
       and (f_vehicles is null or cardinality(f_vehicles) = 0 or e.vehicle_id = any (f_vehicles))
       and (f_from is null or e.occurred_at >= f_from::timestamptz)
       and (f_to is null or e.occurred_at < (f_to + 1)::timestamptz)
       and (f_search is null or v.license_plate like '%' || private.normalize_plate(f_search) || '%' or upper(coalesce(v.fleet_code, '')) like '%' || upper(f_search) || '%'))
  select count(*), coalesce((select jsonb_agg(to_jsonb(b) - 'organization_id' order by b.occurred_at desc) from (select * from base order by occurred_at desc limit v_limit offset v_offset) b), '[]'::jsonb)
    into v_total, v_rows from base;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'limit', v_limit, 'offset', v_offset);
end;
$$;
revoke execute on function public.mtsr_events_list(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.mtsr_events_list(uuid, jsonb, integer, integer) to authenticated;

-- Saúde / cobertura do módulo
create or replace function public.mtsr_health(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_today date := private.maintenance_today(p_organization_id); p public.mtsr_parameter_sets;
begin
  perform private.mtsr_require_view(p_organization_id, 'mtsr.dashboard.view');
  p := private.mtsr_params_at(p_organization_id, v_today);
  return (
    with f as (select * from private.mtsr_fleet_filtered(p_organization_id, '{}'::jsonb, v_today)),
    comps as (select * from public.mtsr_components c where c.organization_id = p_organization_id and c.is_active)
    select jsonb_build_object(
      'today', v_today,
      'vehicles_active', (select count(*) from f),
      'vehicles_without_any_status', (select count(*) from f where known_count = 0),
      'vehicles_without_inspection', (select count(*) from f where last_valid_inspection_date is null),
      'field_cells_missing', (select count(*) from f cross join comps c where c.verification_mode = 'field'
                                 and not exists (select 1 from public.mtsr_component_status s where s.vehicle_id = f.vehicle_id and s.component_id = c.id and s.status <> 'sem_informacao')),
      'backoffice_cells_missing', (select count(*) from f cross join comps c where c.verification_mode = 'backoffice'
                                 and not exists (select 1 from public.mtsr_component_status s where s.vehicle_id = f.vehicle_id and s.component_id = c.id and s.status <> 'sem_informacao')),
      'awaiting_revalidation', (select count(*) from public.mtsr_component_status s where s.organization_id = p_organization_id and s.awaiting_revalidation),
      'awaiting_over_sla', (select count(*) from public.mtsr_component_status s where s.organization_id = p_organization_id and s.awaiting_revalidation
                              and s.awaiting_since < now() - (p.revalidation_sla_days || ' days')::interval),
      'pending_inspections', (select count(*) from public.mtsr_inspections i where i.organization_id = p_organization_id and i.status = 'pendente_validacao'),
      'pending_over_sla', (select count(*) from public.mtsr_inspections i where i.organization_id = p_organization_id and i.status = 'pendente_validacao'
                             and i.submitted_at < now() - (p.review_sla_days || ' days')::interval),
      'nok_without_maintenance', (select count(*) from public.mtsr_component_status s where s.organization_id = p_organization_id and s.status = 'nok'
                                    and not exists (select 1 from public.mtsr_maintenance_links l where l.vehicle_id = s.vehicle_id and l.component_id = s.component_id and l.status = 'active')),
      'components_without_service', (select count(*) from comps c where not exists (select 1 from public.mtsr_component_services x where x.component_id = c.id and x.is_active)),
      'components_without_source', (select count(*) from comps c where c.verification_mode = 'backoffice'
                                      and not exists (select 1 from public.mtsr_component_sources cs join public.mtsr_ingestion_sources s on s.id = cs.source_id
                                                       where cs.component_id = c.id and cs.is_enabled and s.is_enabled and s.is_available)),
      'evidence_live', (select count(*) from public.mtsr_inspection_evidence e where e.organization_id = p_organization_id and e.purged_at is null),
      'evidence_purged', (select count(*) from public.mtsr_inspection_evidence e where e.organization_id = p_organization_id and e.purged_at is not null),
      'ingestion_rejected_30d', (select count(*) from public.mtsr_ingestion_events e where e.organization_id = p_organization_id and e.status = 'rejected' and e.received_at >= now() - interval '30 days'),
      'ingestion_conflict_30d', (select count(*) from public.mtsr_ingestion_events e where e.organization_id = p_organization_id and e.status = 'conflict' and e.received_at >= now() - interval '30 days'),
      'app_enabled_operations', (select count(*) from public.checklist_app_operations l join public.operational_apps a on a.id = l.app_id
                                   where a.organization_id = p_organization_id and a.code = 'vistoria_mtsr' and l.is_enabled),
      'app_enabled_vehicle_types', (select count(*) from public.vehicle_type_apps l join public.operational_apps a on a.id = l.app_id
                                      where a.organization_id = p_organization_id and a.code = 'vistoria_mtsr' and l.is_enabled),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'is_enabled', s.is_enabled, 'is_available', s.is_available,
                           'last_event_at', s.last_event_at) order by s.priority)
                             from public.mtsr_ingestion_sources s where s.organization_id = p_organization_id), '[]'::jsonb)));
end;
$$;
revoke execute on function public.mtsr_health(uuid) from public, anon;
grant  execute on function public.mtsr_health(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Cadastros (componentes, serviços, parâmetros, fontes)
-- -----------------------------------------------------------------------------
create or replace function private.mtsr_assert_nomenclature(p_text text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare n text := coalesce(private.normalize_label(p_text), '');
begin
  if n like '%cctv%' then
    raise exception 'Use a nomenclatura oficial "CFTV" (não "CCTV").' using errcode = 'invalid_parameter_value';
  end if;
  if n like '%sirene de re%' or n like '%sirene re%' then
    raise exception 'A sirene MTSR é a "Sirene do Sistema"; a sirene de ré não é componente MTSR.' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create or replace function public.mtsr_save_component(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_code text := private.normalize_label(p_payload ->> 'code');
  v_name text := btrim(p_payload ->> 'name');
  v_before jsonb;
begin
  if not private.has_permission(p_organization_id, 'mtsr.component.manage') then
    raise exception 'Sem permissão para gerir componentes MTSR.' using errcode = 'insufficient_privilege';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'Informe o nome do componente.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.mtsr_assert_nomenclature(v_name);
  if p_payload ? 'context_label' then perform private.mtsr_assert_nomenclature(p_payload ->> 'context_label'); end if;

  if v_id is null then
    v_code := regexp_replace(coalesce(v_code, private.normalize_label(v_name)), '[^a-z0-9_]+', '_', 'g');
    insert into public.mtsr_components (organization_id, code, name, description, verification_mode, base_criticality, priority, sort_order,
      is_active, context_label, evidence_required_when_ok, evidence_required_when_nok, observation_required_when_nok, aliases)
    values (p_organization_id, v_code, v_name, nullif(btrim(p_payload ->> 'description'), ''),
      coalesce(nullif(p_payload ->> 'verification_mode', ''), 'field'), coalesce(nullif(p_payload ->> 'base_criticality', ''), 'alta'),
      coalesce(nullif(p_payload ->> 'priority', '')::smallint, 100), coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, 100),
      coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true), nullif(btrim(p_payload ->> 'context_label'), ''),
      coalesce(nullif(p_payload ->> 'evidence_required_when_ok', '')::boolean, true),
      coalesce(nullif(p_payload ->> 'evidence_required_when_nok', '')::boolean, true),
      coalesce(nullif(p_payload ->> 'observation_required_when_nok', '')::boolean, true),
      coalesce(private.jsonb_text_array(p_payload -> 'aliases'), '{}'))
    returning id into v_id;
  else
    select to_jsonb(c) into v_before from public.mtsr_components c where c.id = v_id and c.organization_id = p_organization_id;
    if v_before is null then raise exception 'Componente não encontrado.' using errcode = 'no_data_found'; end if;
    update public.mtsr_components set
      name = v_name,
      description = case when p_payload ? 'description' then nullif(btrim(p_payload ->> 'description'), '') else description end,
      verification_mode = coalesce(nullif(p_payload ->> 'verification_mode', ''), verification_mode),
      base_criticality = coalesce(nullif(p_payload ->> 'base_criticality', ''), base_criticality),
      priority = coalesce(nullif(p_payload ->> 'priority', '')::smallint, priority),
      sort_order = coalesce(nullif(p_payload ->> 'sort_order', '')::smallint, sort_order),
      is_active = coalesce(nullif(p_payload ->> 'is_active', '')::boolean, is_active),
      context_label = case when p_payload ? 'context_label' then nullif(btrim(p_payload ->> 'context_label'), '') else context_label end,
      evidence_required_when_ok = coalesce(nullif(p_payload ->> 'evidence_required_when_ok', '')::boolean, evidence_required_when_ok),
      evidence_required_when_nok = coalesce(nullif(p_payload ->> 'evidence_required_when_nok', '')::boolean, evidence_required_when_nok),
      observation_required_when_nok = coalesce(nullif(p_payload ->> 'observation_required_when_nok', '')::boolean, observation_required_when_nok),
      aliases = case when p_payload ? 'aliases' then coalesce(private.jsonb_text_array(p_payload -> 'aliases'), '{}') else aliases end
    where id = v_id;
  end if;
  perform private.mtsr_log(p_organization_id, 'COMPONENTE_ALTERADO', null, v_id,
    jsonb_build_object('before', v_before, 'after', (select to_jsonb(c) - 'organization_id' from public.mtsr_components c where c.id = v_id)));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.mtsr_save_component(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_save_component(uuid, jsonb) to authenticated;

create or replace function public.mtsr_save_component_services(p_organization_id uuid, p_component_id uuid, p_links jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_ids uuid[]; l jsonb; n integer := 0;
begin
  if not private.has_permission(p_organization_id, 'mtsr.component.manage') then
    raise exception 'Sem permissão para gerir componentes MTSR.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.mtsr_components c where c.id = p_component_id and c.organization_id = p_organization_id) then
    raise exception 'Componente não encontrado.' using errcode = 'no_data_found';
  end if;
  select coalesce(array_agg((x ->> 'service_id')::uuid), '{}') into v_ids from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) x;
  -- vínculos fora da lista são desativados (histórico preservado; sem exclusão física)
  update public.mtsr_component_services set is_active = false, is_default = false
   where component_id = p_component_id and is_active and not (service_id = any (v_ids));
  for l in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if not exists (select 1 from public.maintenance_services s where s.id = (l ->> 'service_id')::uuid and s.organization_id = p_organization_id and s.deleted_at is null) then
      raise exception 'Serviço não encontrado no catálogo de Manutenção.' using errcode = 'no_data_found';
    end if;
    insert into public.mtsr_component_services (organization_id, component_id, service_id, is_default, is_active, notes)
    values (p_organization_id, p_component_id, (l ->> 'service_id')::uuid, coalesce(nullif(l ->> 'is_default', '')::boolean, true), true, nullif(btrim(l ->> 'notes'), ''))
    on conflict (component_id, service_id) do update set is_default = excluded.is_default, is_active = true, notes = excluded.notes;
    n := n + 1;
  end loop;
  perform private.mtsr_log(p_organization_id, 'COMPONENTE_ALTERADO', null, p_component_id, jsonb_build_object('services', v_ids));
  return jsonb_build_object('component_id', p_component_id, 'services', n);
end;
$$;
revoke execute on function public.mtsr_save_component_services(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_save_component_services(uuid, uuid, jsonb) to authenticated;

create or replace function public.mtsr_save_parameters(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.maintenance_today(p_organization_id);
  v_from date := coalesce(nullif(p_payload ->> 'effective_from', '')::date, v_today);
  v_cur public.mtsr_parameter_sets := private.mtsr_params_at(p_organization_id, v_today);
  v_id uuid;
begin
  if not private.has_permission(p_organization_id, 'mtsr.parameters.manage') then
    raise exception 'Sem permissão para alterar os parâmetros MTSR.' using errcode = 'insufficient_privilege';
  end if;
  if v_from < v_today - 365 then
    raise exception 'A vigência não pode começar há mais de um ano.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.mtsr_parameter_sets p where p.organization_id = p_organization_id and p.effective_from > v_from) then
    raise exception 'Já existe uma vigência posterior a %.', to_char(v_from, 'DD/MM/YYYY') using errcode = 'invalid_parameter_value';
  end if;

  select p.id into v_id from public.mtsr_parameter_sets p where p.organization_id = p_organization_id and p.effective_from = v_from;
  if v_id is null then
    update public.mtsr_parameter_sets set effective_to = v_from - 1
     where organization_id = p_organization_id and effective_to is null and effective_from < v_from;
    insert into public.mtsr_parameter_sets (organization_id, effective_from) values (p_organization_id, v_from) returning id into v_id;
  end if;
  update public.mtsr_parameter_sets set
    conforme_max_days = coalesce(nullif(p_payload ->> 'conforme_max_days', '')::smallint, v_cur.conforme_max_days),
    attention_min_days = coalesce(nullif(p_payload ->> 'attention_min_days', '')::smallint, v_cur.attention_min_days),
    attention_max_days = coalesce(nullif(p_payload ->> 'attention_max_days', '')::smallint, v_cur.attention_max_days),
    evidence_retention_inspections = coalesce(nullif(p_payload ->> 'evidence_retention_inspections', '')::smallint, v_cur.evidence_retention_inspections),
    evidence_retention_days = case when p_payload ? 'evidence_retention_days' then nullif(p_payload ->> 'evidence_retention_days', '')::integer else v_cur.evidence_retention_days end,
    review_sla_days = coalesce(nullif(p_payload ->> 'review_sla_days', '')::smallint, v_cur.review_sla_days),
    maintenance_open_sla_days = coalesce(nullif(p_payload ->> 'maintenance_open_sla_days', '')::smallint, v_cur.maintenance_open_sla_days),
    revalidation_sla_days = coalesce(nullif(p_payload ->> 'revalidation_sla_days', '')::smallint, v_cur.revalidation_sla_days),
    note = nullif(btrim(p_payload ->> 'note'), ''),
    effective_to = null
  where id = v_id;
  perform private.mtsr_log(p_organization_id, 'PARAMETROS_ALTERADOS', null, null,
    jsonb_build_object('effective_from', v_from, 'before', to_jsonb(v_cur) - 'organization_id',
                       'after', (select to_jsonb(p) - 'organization_id' from public.mtsr_parameter_sets p where p.id = v_id)));
  return jsonb_build_object('id', v_id, 'effective_from', v_from);
end;
$$;
revoke execute on function public.mtsr_save_parameters(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_save_parameters(uuid, jsonb) to authenticated;

create or replace function public.mtsr_save_source(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.mtsr_ingestion_sources; v_enabled boolean;
begin
  if not private.has_permission(p_organization_id, 'mtsr.ingestion.manage') then
    raise exception 'Sem permissão para gerir fontes de ingestão.' using errcode = 'insufficient_privilege';
  end if;
  select s.* into v from public.mtsr_ingestion_sources s where s.id = (p_payload ->> 'id')::uuid and s.organization_id = p_organization_id;
  if v.id is null then raise exception 'Fonte não encontrada.' using errcode = 'no_data_found'; end if;
  v_enabled := coalesce(nullif(p_payload ->> 'is_enabled', '')::boolean, v.is_enabled);
  if v_enabled and not v.is_available then
    raise exception 'A fonte "%" não tem adaptador implementado e não pode ser habilitada.', v.name using errcode = 'invalid_parameter_value';
  end if;
  update public.mtsr_ingestion_sources set
    name = coalesce(nullif(btrim(p_payload ->> 'name'), ''), name),
    source_system = case when p_payload ? 'source_system' then nullif(btrim(p_payload ->> 'source_system'), '') else source_system end,
    is_enabled = v_enabled,
    priority = coalesce(nullif(p_payload ->> 'priority', '')::smallint, priority),
    notes = case when p_payload ? 'notes' then nullif(btrim(p_payload ->> 'notes'), '') else notes end,
    config = case when p_payload ? 'config' and jsonb_typeof(p_payload -> 'config') = 'object' then p_payload -> 'config' else config end
  where id = v.id;
  perform private.mtsr_log(p_organization_id, 'FONTE_ALTERADA', null, null,
    jsonb_build_object('source', v.code, 'before', to_jsonb(v) - 'organization_id' - 'config',
                       'after', (select to_jsonb(s) - 'organization_id' - 'config' from public.mtsr_ingestion_sources s where s.id = v.id)));
  return jsonb_build_object('id', v.id);
end;
$$;
revoke execute on function public.mtsr_save_source(uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_save_source(uuid, jsonb) to authenticated;

create or replace function public.mtsr_save_component_sources(p_organization_id uuid, p_component_id uuid, p_links jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare l jsonb; n integer := 0;
begin
  if not private.has_permission(p_organization_id, 'mtsr.ingestion.manage') then
    raise exception 'Sem permissão para gerir fontes de ingestão.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.mtsr_components c where c.id = p_component_id and c.organization_id = p_organization_id) then
    raise exception 'Componente não encontrado.' using errcode = 'no_data_found';
  end if;
  for l in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    insert into public.mtsr_component_sources (organization_id, component_id, source_id, priority, is_enabled)
    select p_organization_id, p_component_id, s.id, coalesce(nullif(l ->> 'priority', '')::smallint, 100), coalesce(nullif(l ->> 'is_enabled', '')::boolean, true)
      from public.mtsr_ingestion_sources s where s.id = (l ->> 'source_id')::uuid and s.organization_id = p_organization_id
    on conflict (component_id, source_id) do update set priority = excluded.priority, is_enabled = excluded.is_enabled;
    n := n + 1;
  end loop;
  perform private.mtsr_log(p_organization_id, 'FONTE_ALTERADA', null, p_component_id, jsonb_build_object('component_sources', p_links));
  return jsonb_build_object('component_id', p_component_id, 'links', n);
end;
$$;
revoke execute on function public.mtsr_save_component_sources(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.mtsr_save_component_sources(uuid, uuid, jsonb) to authenticated;

-- Grants das funções privadas (chamadas só por RPCs security definer / rotinas)
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname like 'mtsr\_%' loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;
