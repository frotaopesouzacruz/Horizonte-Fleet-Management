-- =============================================================================
-- Gestão de Checklist › Planos de Ação — o motor
--
--   CHECKLIST CONCLUÍDO → EVENTO (outbox) → CLASSIFICAÇÃO DAS RESPOSTAS
--     → AVARIA? sim: fluxo de Avarias (evento checklist.damage.reported)
--               não: APONTAMENTO → PLANO (novo ou o aberto do mesmo problema)
--
--   * Recebimento: gatilho no outbox (mesma transação do checklist, protegido —
--     se falhar, o checklist grava do mesmo jeito e o controle fica "failed"),
--     rotina (pg_cron) que tenta de novo e reprocessamento manual. Idempotente
--     por construção: um apontamento por resposta (+ opção do detalhe).
--   * Correção administrativa do checklist: a resposta corrigida é
--     reclassificada (novo apontamento, ou cancelamento do que só estava
--     pendente) — nunca apagando a resposta original.
--   * Situação derivada: apontamento pela manutenção que o trata; plano pelos
--     apontamentos. Manutenção concluída que não resolveu tudo = PENDENTE DE
--     NOVA TRATATIVA; o plano só fecha quando não sobra pendência.
--   * Integração com Manutenção por gatilhos nas tabelas oficiais
--     (maintenances, maintenance_finding_links): abrir, vincular, reabrir,
--     concluir ou cancelar uma manutenção reflete no plano, dos dois lados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Utilitários
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_terminal(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('resolved_without_maintenance', 'improper', 'resolved', 'cancelled');
$$;

create or replace function private.action_plan_actor_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null
              else coalesce(nullif(private.org_member_name(p_organization_id, auth.uid()), ''), 'Usuário autenticado')
         end;
$$;

create or replace function private.action_plan_log(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_event_type      text,
  p_from_status     text,
  p_to_status       text,
  p_reason          text,
  p_payload         jsonb,
  p_source          text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.action_plan_events
    (organization_id, plan_id, event_type, from_status, to_status, reason, payload, source, actor_user_id, actor_name)
  values
    (p_organization_id, p_plan_id, p_event_type, p_from_status, p_to_status, nullif(btrim(p_reason), ''),
     coalesce(p_payload, '{}'::jsonb), coalesce(p_source, 'user'), auth.uid(),
     private.action_plan_actor_name(p_organization_id))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.action_plan_settings_of(p_organization_id uuid)
returns public.action_plan_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_plan_settings;
begin
  select * into v from public.action_plan_settings where organization_id = p_organization_id;
  if not found then
    insert into public.action_plan_settings (organization_id) values (p_organization_id)
    on conflict (organization_id) do nothing;
    select * into v from public.action_plan_settings where organization_id = p_organization_id;
  end if;
  return v;
end;
$$;

create or replace function private.action_plan_sla_days(p_settings public.action_plan_settings, p_priority text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_priority
           when 'critical' then p_settings.sla_days_critical
           when 'high'     then p_settings.sla_days_high
           when 'low'      then p_settings.sla_days_low
           else p_settings.sla_days_medium
         end;
$$;

create or replace function private.action_plan_param(p_organization_id uuid, p_app_id uuid, p_question_key text, p_field_key text)
returns public.checklist_action_parameters
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.checklist_action_parameters p
   where p.organization_id = p_organization_id and p.app_id = p_app_id
     and p.question_key = p_question_key and p.field_key is not distinct from p_field_key
   limit 1;
$$;

-- Os valores marcados num campo de seleção: ["a","b"] ou "a".
create or replace function private.action_plan_selected(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v order by v), '{}')
    from (
      select btrim(x) as v from jsonb_array_elements_text(
               case jsonb_typeof(p_value) when 'array' then p_value
                                          when 'string' then jsonb_build_array(p_value)
                                          else '[]'::jsonb end) x
    ) s
   where v <> '';
$$;

-- -----------------------------------------------------------------------------
-- 2. Classificação de uma resposta
-- -----------------------------------------------------------------------------
-- route: conforming | not_submitted | damage | not_eligible | maintenance
create or replace function private.action_plan_answer_route(p_answer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a  record;
  v_qp public.checklist_action_parameters;
begin
  select a.id, a.organization_id, a.question_id, a.question_key, a.is_conforming, e.app_id, e.status,
         q.generates_action_plan
    into v_a
    from public.checklist_execution_answers a
    join public.checklist_executions e on e.id = a.execution_id
    left join public.checklist_questions q on q.id = a.question_id
   where a.id = p_answer_id;
  if not found then return null; end if;
  if v_a.status <> 'submitted' then return 'not_submitted'; end if;
  if v_a.is_conforming then return 'conforming'; end if;

  v_qp := private.action_plan_param(v_a.organization_id, v_a.app_id, v_a.question_key, null);
  -- A separação é por configuração da chave estável, nunca pelo texto.
  if v_qp.id is not null and v_qp.action_domain = 'damage' then return 'damage'; end if;
  if v_qp.id is not null and (v_qp.status <> 'active' or not v_qp.generates_plan) then return 'not_eligible'; end if;
  if v_qp.id is null and not coalesce(v_a.generates_action_plan, true) then return 'not_eligible'; end if;
  return 'maintenance';
end;
$$;

-- Os apontamentos que uma resposta inconforme de MANUTENÇÃO deve gerar. O
-- detalhe de seleção especializa o gatilho (nunca os dois): com agrupamento
-- por opção, um plano por opção marcada; por pergunta, um plano da pergunta
-- com um apontamento por opção. Sem detalhe marcado, um apontamento da pergunta.
create or replace function private.action_plan_targets(p_answer_id uuid)
returns table (plan_key text, action_key text, field_key text, option_value text, option_label text,
               title text, detail_label text, priority text, priority_source text, sla_days integer,
               detail_text text, requires_maintenance boolean, requires_manual_analysis boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a        record;
  v_qp       public.checklist_action_parameters;
  v_fp       public.checklist_action_parameters;
  v_c        record;
  v_title    text;
  v_priority text;
  v_psource  text;
  v_detail   text;
  v_vals     text[];
  v_v        text;
  v_label    text;
  v_group    text;
  v_spec     boolean := false;
begin
  if private.action_plan_answer_route(p_answer_id) is distinct from 'maintenance' then
    return;
  end if;
  select a.*, e.app_id into v_a
    from public.checklist_execution_answers a
    join public.checklist_executions e on e.id = a.execution_id
   where a.id = p_answer_id;

  v_qp := private.action_plan_param(v_a.organization_id, v_a.app_id, v_a.question_key, null);
  v_title := coalesce(v_qp.action_title, v_a.question_text_snapshot);
  if v_qp.default_priority is not null then
    v_priority := v_qp.default_priority; v_psource := 'parameter';
  else
    v_priority := case v_a.criticality when 'critica' then 'high' else 'medium' end; v_psource := 'criticality';
  end if;

  -- Relatos de texto: informativos, acompanham o apontamento.
  select string_agg(btrim(v_a.conditional_value ->> c.field_key), ' · ' order by c.sort_order)
    into v_detail
    from public.checklist_question_conditionals c
   where c.question_id = v_a.question_id and c.field_type = 'text'
     and nullif(btrim(coalesce(v_a.conditional_value ->> c.field_key, '')), '') is not null;

  for v_c in
    select c.field_key, c.options
      from public.checklist_question_conditionals c
     where c.question_id = v_a.question_id and c.field_type in ('single_select', 'multi_select')
     order by c.sort_order, c.field_key
  loop
    v_fp := private.action_plan_param(v_a.organization_id, v_a.app_id, v_a.question_key, v_c.field_key);
    if v_fp.id is not null and (v_fp.action_domain = 'damage' or v_fp.status <> 'active' or v_fp.question_role <> 'detail') then
      continue;
    end if;
    v_vals := private.action_plan_selected(v_a.conditional_value -> v_c.field_key);
    if cardinality(v_vals) = 0 then continue; end if;
    v_spec := true;
    v_group := coalesce(v_fp.plan_grouping, 'option');
    foreach v_v in array v_vals loop
      select o ->> 'label' into v_label from jsonb_array_elements(coalesce(v_c.options, '[]'::jsonb)) o
       where o ->> 'value' = v_v limit 1;
      v_label := coalesce(v_label, v_v);
      plan_key := case when v_group = 'option' then 'q:' || v_a.question_key || ':' || v_c.field_key || '=' || v_v
                       else 'q:' || v_a.question_key end;
      action_key := 'q:' || v_a.question_key || ':' || v_c.field_key;
      field_key := v_c.field_key;
      option_value := v_v;
      option_label := v_label;
      title := v_title;
      detail_label := case when v_group = 'option' then v_label end;
      priority := coalesce(v_fp.default_priority, v_priority);
      priority_source := case when v_fp.default_priority is not null then 'parameter' else v_psource end;
      sla_days := coalesce(v_fp.sla_days, v_qp.sla_days);
      detail_text := v_detail;
      requires_maintenance := coalesce(v_qp.requires_maintenance, true);
      requires_manual_analysis := coalesce(v_qp.requires_manual_analysis, false);
      return next;
    end loop;
  end loop;

  if not v_spec then
    plan_key := 'q:' || v_a.question_key;
    action_key := 'q:' || v_a.question_key;
    field_key := null; option_value := null; option_label := null;
    title := v_title; detail_label := null;
    priority := v_priority; priority_source := v_psource;
    sla_days := v_qp.sla_days;
    detail_text := v_detail;
    requires_maintenance := coalesce(v_qp.requires_maintenance, true);
    requires_manual_analysis := coalesce(v_qp.requires_manual_analysis, false);
    return next;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Situação derivada
-- -----------------------------------------------------------------------------
-- Apontamento (só os que o motor governa: pendente, em manutenção, pendente de
-- nova tratativa e resolvido AUTOMATICAMENTE pela manutenção — decisão de
-- usuário nunca é recalculada):
--   * resolvido: uma manutenção vinculada ao plano, concluída, resolveu a
--     resposta deste apontamento pelo mapeamento com baixa automática, e a
--     correspondência é específica (a resposta tem só este apontamento no plano);
--   * em manutenção: uma manutenção vinculada que o cobre está aberta;
--   * pendente de nova tratativa: a manutenção que o cobria terminou (concluída
--     sem resolver, cancelada ou não realizada);
--   * pendente: nada o cobre.
-- Plano: sem pendência → encerrado (resolvido > resolvido sem manutenção >
-- improcedente; todos cancelados → cancelado); com pendência → pendente de nova
-- tratativa > manutenção em execução > agendada > aberta > aguardando
-- manutenção > em análise > novo.
create or replace function private.action_plan_refresh(p_plan_id uuid, p_source text default 'system')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.action_plans;
  v_i        record;
  v_new      text;
  v_cov      record;
  v_n        record;
  v_status   text;
  v_mstatus  text;
  v_closing  boolean;
  v_user     boolean := auth.uid() is not null and p_source = 'user';
begin
  select * into v_p from public.action_plans where id = p_plan_id for update;
  if not found then return null; end if;

  for v_i in
    select i.*,
           (select count(*) from public.action_plan_items x
             where x.plan_id = i.plan_id and x.checklist_answer_id = i.checklist_answer_id) as in_plan,
           (select count(*) from public.action_plan_items x
             where x.checklist_answer_id = i.checklist_answer_id and x.status <> 'cancelled') as overall
      from public.action_plan_items i
     where i.plan_id = p_plan_id
       and (i.status in ('pending', 'in_maintenance', 'needs_action')
            or (i.status = 'resolved' and i.status_source = 'maintenance'))
  loop
    -- Correspondência específica: a resposta tem só este apontamento no plano
    -- e, se a mesma resposta gerou outros apontamentos (várias opções marcadas),
    -- a manutenção foi vinculada A ESTE plano por decisão explícita.
    select bool_or(m.status = 'completed' and f.resolution_status = 'resolved'
                   and v_i.in_plan = 1
                   and (v_i.overall = 1 or l.origin in ('opened_from_plan', 'linked_manual', 'reconciliation_manual')))
             as resolved,
           bool_or(m.status in ('to_schedule', 'scheduled', 'in_progress'))   as open,
           count(*)                                                          as n,
           (array_agg(m.id order by (m.status = 'completed' and f.resolution_status = 'resolved') desc,
                                    m.exit_date desc nulls last, m.created_at desc))[1] as maintenance_id,
           (array_agg(l.id order by (m.status = 'completed' and f.resolution_status = 'resolved') desc,
                                    m.exit_date desc nulls last, m.created_at desc))[1] as link_id
      into v_cov
      from public.action_plan_maintenance_links l
      join public.maintenances m on m.id = l.maintenance_id
      join public.maintenance_finding_links f
        on f.maintenance_id = m.id and f.checklist_answer_id = v_i.checklist_answer_id
     where l.plan_id = p_plan_id and l.status = 'active' and l.resolutive;

    v_new := case
               when coalesce(v_cov.resolved, false) then 'resolved'
               when coalesce(v_cov.open, false) then 'in_maintenance'
               when coalesce(v_cov.n, 0) > 0 then 'needs_action'
               else 'pending'
             end;

    if v_new is distinct from v_i.status then
      update public.action_plan_items
         set status = v_new,
             status_source = case when v_new = 'resolved' then 'maintenance' else 'system' end,
             resolved_at = case when v_new = 'resolved' then now() end,
             resolved_by = case when v_new = 'resolved' then auth.uid() end,
             resolved_maintenance_id = case when v_new = 'resolved' then v_cov.maintenance_id end
       where id = v_i.id;
      insert into public.action_plan_item_resolutions
        (organization_id, plan_id, item_id, resolution_type, from_status, to_status, maintenance_id,
         maintenance_link_id, source, confidence, reason, resolved_by, resolved_by_name)
      values
        (v_p.organization_id, p_plan_id, v_i.id,
         case when v_new = 'resolved' then 'resolved_by_maintenance'
              when v_i.status = 'resolved' then 'returned_to_pending'
              else 'maintenance_status' end,
         v_i.status, v_new, v_cov.maintenance_id, v_cov.link_id,
         case when v_new = 'resolved' then 'maintenance_auto' else 'system' end,
         case when v_new = 'resolved' then 'high' end,
         case v_new
           when 'resolved' then 'Resolvido pela manutenção (serviço mapeado com baixa automática).'
           when 'in_maintenance' then 'Coberto por manutenção aberta.'
           when 'needs_action' then 'A manutenção vinculada terminou sem resolver este apontamento.'
           else 'Sem manutenção que o cubra.'
         end,
         auth.uid(), private.action_plan_actor_name(v_p.organization_id));
    end if;
  end loop;

  select count(*)                                                      as total,
         count(*) filter (where status in ('pending', 'in_maintenance', 'needs_action')) as open,
         count(*) filter (where status = 'pending')                    as pending,
         count(*) filter (where status = 'in_maintenance')             as in_maintenance,
         count(*) filter (where status = 'needs_action')               as needs_action,
         count(*) filter (where status = 'resolved')                   as resolved,
         count(*) filter (where status = 'resolved_without_maintenance') as rwm,
         count(*) filter (where status = 'improper')                   as improper,
         count(*) filter (where status = 'cancelled')                  as cancelled,
         min(occurred_at) as first_at, max(occurred_at) as last_at,
         min(operational_date) as first_date, max(operational_date) as last_date
    into v_n
    from public.action_plan_items where plan_id = p_plan_id;

  if v_n.total = 0 then
    return v_p.status;
  end if;

  if v_n.open = 0 then
    v_status := case
                  when v_n.cancelled = v_n.total then 'cancelled'
                  when v_n.resolved > 0 then 'resolved'
                  when v_n.rwm > 0 then 'resolved_without_maintenance'
                  else 'improper'
                end;
  elsif v_n.needs_action > 0 then
    v_status := 'pending_new_action';
  elsif v_n.in_maintenance > 0 then
    select case
             when bool_or(m.status = 'in_progress') then 'maintenance_in_progress'
             when bool_or(m.status = 'scheduled') then 'maintenance_scheduled'
             else 'maintenance_open'
           end
      into v_mstatus
      from public.action_plan_maintenance_links l
      join public.maintenances m on m.id = l.maintenance_id
     where l.plan_id = p_plan_id and l.status = 'active' and l.resolutive
       and m.status in ('to_schedule', 'scheduled', 'in_progress');
    v_status := coalesce(v_mstatus, 'maintenance_open');
  else
    v_status := v_p.analysis_state;  -- new | in_analysis | awaiting_maintenance
  end if;

  v_closing := private.action_plan_terminal(v_status) and not private.action_plan_terminal(v_p.status);

  -- Um plano encerrado só volta a abrir se não houver outro aberto do mesmo
  -- problema no veículo (o índice único garante isso); do contrário fica como
  -- está e a inconsistência aparece em Qualidade & Auditoria.
  if not private.action_plan_terminal(v_status) and private.action_plan_terminal(v_p.status)
     and exists (select 1 from public.action_plans o
                  where o.organization_id = v_p.organization_id and o.vehicle_id = v_p.vehicle_id
                    and o.plan_key = v_p.plan_key and o.id <> v_p.id
                    and not private.action_plan_terminal(o.status)) then
    perform private.action_plan_log(v_p.organization_id, p_plan_id, 'reopen_blocked', v_p.status, v_status,
      'Há outro plano aberto do mesmo problema neste veículo.', '{}'::jsonb, 'system');
    v_status := v_p.status;
  end if;

  update public.action_plans
     set status = v_status,
         occurrences = v_n.total,
         open_items = v_n.open,
         resolved_items = v_n.resolved + v_n.rwm,
         first_occurrence_at = v_n.first_at,
         last_occurrence_at = v_n.last_at,
         first_operational_date = v_n.first_date,
         last_operational_date = v_n.last_date,
         -- Encerramento = a última resolução (respeita a baixa com data retroativa).
         closed_at = case when private.action_plan_terminal(v_status)
                          then coalesce(v_p.closed_at,
                                        (select max(x.resolved_at) from public.action_plan_items x where x.plan_id = p_plan_id),
                                        now()) end,
         closed_by = case when private.action_plan_terminal(v_status)
                          then case when v_closing then auth.uid() else v_p.closed_by end end,
         auto_closed = case when private.action_plan_terminal(v_status)
                            then case when v_closing then not v_user else v_p.auto_closed end
                            else false end
   where id = p_plan_id;

  if v_status is distinct from v_p.status then
    perform private.action_plan_log(v_p.organization_id, p_plan_id,
      case when v_closing then case when v_user then 'closed' else 'auto_closed' end
           when private.action_plan_terminal(v_p.status) then 'reopened_by_maintenance'
           else 'status_changed' end,
      v_p.status, v_status, null,
      jsonb_build_object('items', jsonb_build_object('open', v_n.open, 'resolved', v_n.resolved, 'rwm', v_n.rwm,
                                                     'improper', v_n.improper, 'cancelled', v_n.cancelled),
                         'fechamento_automatico', v_closing and not v_user),
      case when v_user then 'user' else coalesce(nullif(p_source, 'user'), 'system') end);
  end if;
  return v_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Vínculo plano × manutenção (uso interno)
-- -----------------------------------------------------------------------------
-- Vincula e leva os apontamentos abertos do plano (ou os informados) para a
-- manutenção como apontamentos do Check List (maintenance_finding_links), onde
-- a conclusão os resolve pelo mapeamento. Manutenção já concluída: roda a
-- resolução só sobre os vínculos novos — nada do histórico da manutenção muda.
create or replace function private.action_plan_link_internal(
  p_plan_id        uuid,
  p_maintenance_id uuid,
  p_origin         text,
  p_confidence     text,
  p_rule           text,
  p_resolutive     boolean,
  p_reason         text,
  p_item_ids       uuid[] default null,
  p_source         text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p       public.action_plans;
  v_m       public.maintenances;
  v_link    uuid;
  v_prev    text;
  v_a       record;
  v_n       integer := 0;
  v_answers uuid[] := '{}';
begin
  select * into v_p from public.action_plans where id = p_plan_id;
  select * into v_m from public.maintenances where id = p_maintenance_id;
  if v_p.id is null or v_m.id is null or v_m.organization_id <> v_p.organization_id then
    raise exception 'Plano ou manutenção não encontrados nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_m.vehicle_id <> v_p.vehicle_id then
    raise exception 'A manutenção é de outro veículo.' using errcode = 'invalid_parameter_value';
  end if;

  select status into v_prev from public.action_plan_maintenance_links
   where plan_id = p_plan_id and maintenance_id = p_maintenance_id;
  insert into public.action_plan_maintenance_links
    (organization_id, plan_id, maintenance_id, status, origin, confidence, rule, resolutive, reason, linked_by, linked_at)
  values
    (v_p.organization_id, p_plan_id, p_maintenance_id, 'active', p_origin, p_confidence, p_rule,
     coalesce(p_resolutive, true), nullif(btrim(p_reason), ''), auth.uid(), now())
  on conflict (plan_id, maintenance_id) do update
    set status = 'active', origin = excluded.origin, confidence = excluded.confidence, rule = excluded.rule,
        resolutive = excluded.resolutive, reason = excluded.reason, linked_by = excluded.linked_by,
        linked_at = excluded.linked_at, unlinked_by = null, unlinked_at = null
  returning id into v_link;

  if coalesce(p_resolutive, true) then
    -- Os apontamentos vão para a manutenção em nome DESTE plano: o gatilho de
    -- vínculo automático não estende a outros planos da mesma resposta.
    perform set_config('hfm.action_plan_linking', p_plan_id::text, true);
    for v_a in
      select distinct i.checklist_answer_id, i.checklist_execution_id, i.question_key,
             (select c.field_key from public.checklist_question_conditionals c
               join public.checklist_execution_answers a on a.question_id = c.question_id
              where a.id = i.checklist_answer_id and a.conditional_value is not null limit 1) as field_key
        from public.action_plan_items i
       where i.plan_id = p_plan_id
         and (case when p_item_ids is null then i.status in ('pending', 'in_maintenance', 'needs_action')
                   else i.id = any (p_item_ids) end)
         and not exists (select 1 from public.maintenance_finding_links f
                          where f.maintenance_id = p_maintenance_id and f.checklist_answer_id = i.checklist_answer_id)
    loop
      insert into public.maintenance_finding_links
        (organization_id, maintenance_id, checklist_execution_id, checklist_answer_id, question_key, field_key,
         link_origin, notes)
      values
        (v_p.organization_id, p_maintenance_id, v_a.checklist_execution_id, v_a.checklist_answer_id,
         v_a.question_key, v_a.field_key,
         case when p_origin in ('auto_reconciliation') then 'auto' else 'manual' end,
         'Plano de Ação ' || v_p.code)
      on conflict (maintenance_id, checklist_answer_id) do nothing;
      v_answers := v_answers || v_a.checklist_answer_id;
      v_n := v_n + 1;
    end loop;
    perform set_config('hfm.action_plan_linking', '', true);
    if v_n > 0 then
      perform private.maintenance_log(v_p.organization_id, p_maintenance_id, 'finding_linked', null, null,
        'Apontamentos do Plano de Ação ' || v_p.code,
        jsonb_build_object('answers', to_jsonb(v_answers), 'action_plan_id', p_plan_id, 'action_plan_code', v_p.code,
                           'origin', p_origin),
        case when auth.uid() is null then 'system' else 'user' end);
      if v_m.status = 'completed' then
        perform private.maintenance_resolve_findings(p_maintenance_id);
      end if;
    end if;
  end if;

  perform private.action_plan_log(v_p.organization_id, p_plan_id,
    case when v_prev is null then 'maintenance_linked' else 'maintenance_relinked' end, null, null, p_reason,
    jsonb_build_object('maintenance_id', p_maintenance_id, 'maintenance_code', v_m.code, 'origin', p_origin,
                       'confidence', p_confidence, 'rule', p_rule, 'resolutive', coalesce(p_resolutive, true),
                       'answers_linked', v_n),
    p_source);
  update public.action_plans set last_treatment_at = now(),
         last_treatment = 'Manutenção ' || v_m.code || ' vinculada'
   where id = p_plan_id;
  return v_link;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Plano do problema: o aberto, ou um novo ciclo
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_open_for(
  p_organization_id uuid,
  p_app_id          uuid,
  p_execution       public.checklist_executions,
  p_answer          public.checklist_execution_answers,
  p_target          record,
  out plan_id uuid,
  out created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev     public.action_plans;
  v_settings public.action_plan_settings;
  v_code     text;
  v_year     integer := extract(year from p_execution.operational_date)::int;
  v_cluster  text;
  v_recur    boolean := false;
begin
  created := false;
  select p.id into plan_id from public.action_plans p
   where p.organization_id = p_organization_id and p.vehicle_id = p_execution.vehicle_id
     and p.plan_key = p_target.plan_key and not private.action_plan_terminal(p.status)
   for update;
  if plan_id is not null then return; end if;

  select * into v_prev from public.action_plans p
   where p.organization_id = p_organization_id and p.vehicle_id = p_execution.vehicle_id
     and p.plan_key = p_target.plan_key and private.action_plan_terminal(p.status)
   order by p.closed_at desc nulls last, p.created_at desc limit 1;
  v_settings := private.action_plan_settings_of(p_organization_id);
  -- Possível reincidência: o problema voltou até N dias depois de um plano
  -- resolvido. É um indicador para análise; não afirma falha da manutenção.
  v_recur := v_prev.id is not null and v_prev.status in ('resolved', 'resolved_without_maintenance')
             and p_execution.operational_date >= (v_prev.closed_at at time zone 'America/Sao_Paulo')::date
             and p_execution.operational_date <= (v_prev.closed_at at time zone 'America/Sao_Paulo')::date
                                                 + v_settings.recurrence_window_days;
  v_cluster := coalesce(
    (select c.cluster_name from public.checklist_execution_clusters c
      where c.execution_id = p_execution.id and c.cluster_key = p_answer.cluster_key limit 1),
    (select cl.name from public.checklist_clusters cl
      where cl.version_id = p_answer.version_id and cl.cluster_key = p_answer.cluster_key limit 1));

  v_code := private.next_entity_code(p_organization_id, 'action_plan:' || v_year, 'PA-' || v_year || '-', 6);
  begin
    insert into public.action_plans
      (organization_id, code, app_id, vehicle_id, plan_key, action_key, question_key, field_key, option_value,
       title, detail_label, cluster_key, cluster_name, criticality, status, analysis_state, priority, priority_source,
       due_on, requires_maintenance, requires_manual_analysis,
       first_occurrence_at, last_occurrence_at, first_operational_date, last_operational_date,
       first_execution_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id, vehicle_subcategory_id,
       operation_id, state_id, city_id, operation_br_id, organization_unit_id, leader_employee_id,
       previous_plan_id, cycle_number, is_recurrence)
    values
      (p_organization_id, v_code, p_app_id, p_execution.vehicle_id, p_target.plan_key, p_target.action_key,
       p_answer.question_key, p_target.field_key, case when p_target.detail_label is not null then p_target.option_value end,
       p_target.title, p_target.detail_label, p_answer.cluster_key, v_cluster, p_answer.criticality,
       case when p_target.requires_manual_analysis then 'in_analysis' else 'new' end,
       case when p_target.requires_manual_analysis then 'in_analysis' else 'new' end,
       p_target.priority, p_target.priority_source,
       p_execution.operational_date + coalesce(p_target.sla_days, private.action_plan_sla_days(v_settings, p_target.priority)),
       p_target.requires_maintenance, p_target.requires_manual_analysis,
       coalesce(p_execution.submitted_at, now()), coalesce(p_execution.submitted_at, now()),
       p_execution.operational_date, p_execution.operational_date,
       p_execution.id, p_execution.license_plate_snapshot, p_execution.fleet_code_snapshot,
       p_execution.vehicle_type_id, p_execution.vehicle_subcategory_id,
       p_execution.operation_id, p_execution.state_id, p_execution.city_id, p_execution.operation_br_id,
       p_execution.organization_unit_id, p_execution.leader_employee_id,
       v_prev.id, coalesce(v_prev.cycle_number, 0) + 1, v_recur)
    returning id into plan_id;
    created := true;
  exception when unique_violation then
    -- Outro processamento criou o mesmo plano ao mesmo tempo: usa o dele.
    select p.id into plan_id from public.action_plans p
     where p.organization_id = p_organization_id and p.vehicle_id = p_execution.vehicle_id
       and p.plan_key = p_target.plan_key and not private.action_plan_terminal(p.status);
    return;
  end;

  perform private.action_plan_log(p_organization_id, plan_id, 'created', null,
    case when p_target.requires_manual_analysis then 'in_analysis' else 'new' end, null,
    jsonb_build_object('plan_key', p_target.plan_key, 'action_key', p_target.action_key,
                       'execution_id', p_execution.id, 'answer_id', p_answer.id,
                       'priority', p_target.priority, 'priority_source', p_target.priority_source,
                       'previous_plan_id', v_prev.id, 'recurrence', v_recur),
    'checklist');
  if v_recur then
    perform private.action_plan_log(p_organization_id, plan_id, 'recurrence_detected', null, null,
      'O mesmo problema voltou a ser apontado neste veículo dentro da janela de reincidência.',
      jsonb_build_object('previous_plan_id', v_prev.id, 'previous_code', v_prev.code,
                         'previous_closed_at', v_prev.closed_at, 'window_days', v_settings.recurrence_window_days),
      'checklist');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Sincronizar uma resposta com os apontamentos (idempotente)
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_sync_answer(p_answer_id uuid, p_source text default 'trigger')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a        public.checklist_execution_answers;
  v_e        public.checklist_executions;
  v_route    text;
  v_t        record;
  v_open     record;
  v_item     uuid;
  v_plans    uuid[] := '{}';
  v_created  integer := 0;
  v_pcreated integer := 0;
  v_pupdated integer := 0;
  v_cancel   integer := 0;
  v_keys     text[] := '{}';
  v_x        record;
  v_m        record;
  v_src      text := case when p_source = 'correction' then 'correction' else 'checklist' end;
begin
  select * into v_a from public.checklist_execution_answers where id = p_answer_id;
  if not found then return jsonb_build_object('route', null); end if;
  select * into v_e from public.checklist_executions where id = v_a.execution_id;
  v_route := private.action_plan_answer_route(p_answer_id);

  if v_route = 'maintenance' then
    for v_t in select * from private.action_plan_targets(p_answer_id) loop
      v_keys := v_keys || coalesce(v_t.option_value, '');
      select i.id, i.status, i.plan_id into v_x from public.action_plan_items i
       where i.checklist_answer_id = p_answer_id and coalesce(i.option_value, '') = coalesce(v_t.option_value, '');
      if v_x.id is not null then
        -- Já existe (reprocessamento): só reativa o que uma correção cancelou.
        if v_x.status = 'cancelled' and exists (
             select 1 from public.action_plan_item_resolutions r
              where r.item_id = v_x.id and r.source = 'correction'
                and r.resolved_at = (select max(r2.resolved_at) from public.action_plan_item_resolutions r2 where r2.item_id = v_x.id)) then
          update public.action_plan_items set status = 'pending', status_source = 'correction',
                 resolved_at = null, resolved_by = null, resolved_maintenance_id = null
           where id = v_x.id;
          insert into public.action_plan_item_resolutions
            (organization_id, plan_id, item_id, resolution_type, from_status, to_status, source, reason, resolved_by, resolved_by_name)
          values (v_a.organization_id, v_x.plan_id, v_x.id, 'returned_to_pending', 'cancelled', 'pending', 'correction',
                  'A correção do checklist voltou a apontar esta inconformidade.', auth.uid(),
                  private.action_plan_actor_name(v_a.organization_id));
          v_plans := v_plans || v_x.plan_id;
        end if;
        continue;
      end if;

      select * into v_open from private.action_plan_open_for(v_a.organization_id, v_e.app_id, v_e, v_a, v_t);
      if v_open.created then v_pcreated := v_pcreated + 1; else v_pupdated := v_pupdated + 1; end if;

      insert into public.action_plan_items
        (organization_id, plan_id, checklist_execution_id, checklist_answer_id, question_id, question_key, field_key,
         option_value, option_label, action_key, cluster_key, criticality, question_text_snapshot, answer,
         conditional_value, detail_text, note, checklist_type, operational_date, occurred_at, employee_id, user_id,
         vehicle_id, license_plate_snapshot, operation_id, state_id, city_id, operation_br_id,
         organization_unit_id, leader_employee_id, status, status_source)
      values
        (v_a.organization_id, v_open.plan_id, v_e.id, v_a.id, v_a.question_id, v_a.question_key, v_t.field_key,
         v_t.option_value, v_t.option_label, v_t.action_key, v_a.cluster_key, v_a.criticality,
         v_a.question_text_snapshot, v_a.answer, v_a.conditional_value, v_t.detail_text, v_a.note,
         v_e.checklist_type, v_e.operational_date, coalesce(v_e.submitted_at, now()), v_e.employee_id, v_e.user_id,
         v_e.vehicle_id, v_e.license_plate_snapshot, v_e.operation_id, v_e.state_id, v_e.city_id,
         v_e.operation_br_id, v_e.organization_unit_id, v_e.leader_employee_id, 'pending',
         case when p_source = 'correction' then 'correction' else 'system' end)
      on conflict do nothing
      returning id into v_item;
      if v_item is null then continue; end if;  -- corrida: outro processamento gravou
      v_created := v_created + 1;
      v_plans := v_plans || v_open.plan_id;

      if not v_open.created then
        perform private.action_plan_log(v_a.organization_id, v_open.plan_id, 'occurrence_added', null, null, null,
          jsonb_build_object('item_id', v_item, 'execution_id', v_e.id, 'answer_id', v_a.id,
                             'operational_date', v_e.operational_date, 'option', v_t.option_value),
          v_src);
        -- Recorrência do mesmo defeito com manutenção aberta no plano: a nova
        -- ocorrência vai para a mesma manutenção (não abre outra).
        for v_m in
          select l.maintenance_id from public.action_plan_maintenance_links l
            join public.maintenances m on m.id = l.maintenance_id
           where l.plan_id = v_open.plan_id and l.status = 'active' and l.resolutive
             and m.status in ('to_schedule', 'scheduled', 'in_progress')
           order by m.created_at desc limit 1
        loop
          perform set_config('hfm.action_plan_linking', v_open.plan_id::text, true);
          insert into public.maintenance_finding_links
            (organization_id, maintenance_id, checklist_execution_id, checklist_answer_id, question_key, field_key,
             link_origin, notes)
          values
            (v_a.organization_id, v_m.maintenance_id, v_e.id, v_a.id, v_a.question_key, v_t.field_key, 'auto',
             'Nova ocorrência do mesmo problema (Plano de Ação)')
          on conflict (maintenance_id, checklist_answer_id) do nothing;
          perform set_config('hfm.action_plan_linking', '', true);
          perform private.maintenance_log(v_a.organization_id, v_m.maintenance_id, 'finding_linked', null, null,
            'Nova ocorrência do mesmo problema, vinculada pelo Plano de Ação.',
            jsonb_build_object('answers', jsonb_build_array(v_a.id), 'action_plan_id', v_open.plan_id, 'origin', 'recurrence'),
            'system');
        end loop;
      end if;
    end loop;
  end if;

  -- O que a resposta não aponta mais (corrigida para conforme, opção
  -- desmarcada, pergunta reclassificada): cancela só o que ainda não teve
  -- tratativa. O que já tem tratativa fica, e a Qualidade mostra o conflito.
  for v_x in
    select i.id, i.plan_id, i.status from public.action_plan_items i
     where i.checklist_answer_id = p_answer_id
       and not (coalesce(i.option_value, '') = any (v_keys))
  loop
    if v_x.status = 'pending' then
      update public.action_plan_items set status = 'cancelled', status_source = 'correction', resolved_at = now(),
             resolved_by = auth.uid()
       where id = v_x.id;
      insert into public.action_plan_item_resolutions
        (organization_id, plan_id, item_id, resolution_type, from_status, to_status, source, reason_code, reason,
         resolved_by, resolved_by_name)
      values (v_a.organization_id, v_x.plan_id, v_x.id, 'cancelled', 'pending', 'cancelled', 'correction',
              'checklist_corrected', 'A resposta do checklist foi corrigida e não aponta mais esta inconformidade.',
              auth.uid(), private.action_plan_actor_name(v_a.organization_id));
      v_cancel := v_cancel + 1;
      v_plans := v_plans || v_x.plan_id;
    elsif v_x.status not in ('cancelled') then
      perform private.action_plan_log(v_a.organization_id, v_x.plan_id, 'correction_conflict', null, null,
        'O checklist foi corrigido, mas o apontamento já tem tratativa: revisar.',
        jsonb_build_object('item_id', v_x.id, 'answer_id', p_answer_id, 'item_status', v_x.status), 'correction');
    end if;
  end loop;

  select coalesce(array_agg(distinct x), '{}') into v_plans from unnest(v_plans) x;
  for v_x in select unnest(v_plans) as plan_id loop
    perform private.action_plan_refresh(v_x.plan_id, v_src);
  end loop;

  return jsonb_build_object('route', v_route, 'items_created', v_created, 'plans_created', v_pcreated,
                            'plans_updated', v_pupdated, 'items_cancelled', v_cancel);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Receber um checklist (idempotente; nunca derruba o checklist)
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_ingest_execution(p_execution_id uuid, p_source text default 'trigger')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e       public.checklist_executions;
  v_a       record;
  v_r       jsonb;
  v_route   text;
  v_stats   jsonb := jsonb_build_object('findings', 0, 'maintenance', 0, 'damage', 0, 'not_eligible', 0,
                                        'items_created', 0, 'plans_created', 0, 'plans_updated', 0);
begin
  select * into v_e from public.checklist_executions where id = p_execution_id;
  if not found or v_e.status <> 'submitted' then
    return jsonb_build_object('skipped', true);
  end if;

  for v_a in
    select a.id, a.is_conforming from public.checklist_execution_answers a
     where a.execution_id = p_execution_id
       and (not a.is_conforming
            or exists (select 1 from public.action_plan_items i where i.checklist_answer_id = a.id))
     order by a.cluster_key, a.question_key
  loop
    v_route := private.action_plan_answer_route(v_a.id);
    if not v_a.is_conforming then
      v_stats := jsonb_set(v_stats, '{findings}', to_jsonb((v_stats ->> 'findings')::int + 1));
    end if;
    if v_route = 'conforming' then
      -- corrigida para conforme sem passar pelo gatilho: reconcilia os apontamentos
      perform private.action_plan_sync_answer(v_a.id, 'correction');
    elsif v_route = 'damage' then
      v_stats := jsonb_set(v_stats, '{damage}', to_jsonb((v_stats ->> 'damage')::int + 1));
      -- Fluxo de Avarias: o evento oficial para o módulo de Sinistros/Avarias.
      -- Uma vez por resposta, por mais que o checklist seja reprocessado.
      if not exists (select 1 from public.outbox_events x
                      where x.event_type = 'checklist.damage.reported' and x.aggregate_id = v_a.id) then
        perform private.emit_event(v_e.organization_id, 'checklist.damage.reported', 'checklist_answer', v_a.id,
          (select jsonb_build_object('execution_id', v_e.id, 'answer_id', a.id, 'vehicle_id', v_e.vehicle_id,
                                     'license_plate', v_e.license_plate_snapshot, 'operation_id', v_e.operation_id,
                                     'operation_br_id', v_e.operation_br_id, 'operational_date', v_e.operational_date,
                                     'checklist_type', v_e.checklist_type, 'question_key', a.question_key,
                                     'conditional_value', a.conditional_value, 'note', a.note,
                                     'employee_id', v_e.employee_id)
             from public.checklist_execution_answers a where a.id = v_a.id));
      end if;
    elsif v_route = 'not_eligible' then
      v_stats := jsonb_set(v_stats, '{not_eligible}', to_jsonb((v_stats ->> 'not_eligible')::int + 1));
    elsif v_route = 'maintenance' then
      v_stats := jsonb_set(v_stats, '{maintenance}', to_jsonb((v_stats ->> 'maintenance')::int + 1));
      v_r := private.action_plan_sync_answer(v_a.id, p_source);
      v_stats := jsonb_set(v_stats, '{items_created}', to_jsonb((v_stats ->> 'items_created')::int + coalesce((v_r ->> 'items_created')::int, 0)));
      v_stats := jsonb_set(v_stats, '{plans_created}', to_jsonb((v_stats ->> 'plans_created')::int + coalesce((v_r ->> 'plans_created')::int, 0)));
      v_stats := jsonb_set(v_stats, '{plans_updated}', to_jsonb((v_stats ->> 'plans_updated')::int + coalesce((v_r ->> 'plans_updated')::int, 0)));
    end if;
  end loop;

  insert into public.action_plan_ingestions
    (execution_id, organization_id, status, source, attempts, last_error, findings, maintenance_findings,
     damage_findings, not_eligible, items_created, plans_created, plans_updated, processed_at)
  values
    (p_execution_id, v_e.organization_id, 'processed', p_source, 1, null,
     (v_stats ->> 'findings')::int, (v_stats ->> 'maintenance')::int, (v_stats ->> 'damage')::int,
     (v_stats ->> 'not_eligible')::int, (v_stats ->> 'items_created')::int, (v_stats ->> 'plans_created')::int,
     (v_stats ->> 'plans_updated')::int, now())
  on conflict (execution_id) do update
    set status = 'processed', source = excluded.source, attempts = public.action_plan_ingestions.attempts + 1,
        last_error = null, findings = excluded.findings, maintenance_findings = excluded.maintenance_findings,
        damage_findings = excluded.damage_findings, not_eligible = excluded.not_eligible,
        -- Contagens de criação acumulam: um reprocessamento que não cria nada
        -- não apaga o que o primeiro recebimento criou.
        items_created = public.action_plan_ingestions.items_created + excluded.items_created,
        plans_created = public.action_plan_ingestions.plans_created + excluded.plans_created,
        plans_updated = public.action_plan_ingestions.plans_updated + excluded.plans_updated,
        processed_at = now();
  return v_stats;
end;
$$;

-- Versão protegida: registra a falha e segue. É a que os gatilhos e a rotina usam.
create or replace function private.action_plan_ingest_safe(p_execution_id uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  begin
    return private.action_plan_ingest_execution(p_execution_id, p_source);
  exception when others then
    select organization_id into v_org from public.checklist_executions where id = p_execution_id;
    if v_org is not null then
      insert into public.action_plan_ingestions (execution_id, organization_id, status, source, attempts, last_error)
      values (p_execution_id, v_org, 'failed', p_source, 1, left(sqlerrm, 500))
      on conflict (execution_id) do update
        set status = 'failed', source = excluded.source, attempts = public.action_plan_ingestions.attempts + 1,
            last_error = excluded.last_error;
    end if;
    return jsonb_build_object('error', left(sqlerrm, 500));
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Gatilhos de integração
-- -----------------------------------------------------------------------------
-- 8.1 Evento do checklist (AFTER: a Aderência já consumiu no BEFORE e marcou o
-- evento; aqui o controle é o próprio action_plan_ingestions).
create or replace function private.tg_outbox_action_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'checklist.execution.submitted' then
    perform private.action_plan_ingest_safe(new.aggregate_id, 'trigger');
  end if;
  return null;
end;
$$;
drop trigger if exists outbox_action_plans_consume on public.outbox_events;
create trigger outbox_action_plans_consume
  after insert on public.outbox_events
  for each row execute function private.tg_outbox_action_plans();

-- 8.2 Correção administrativa do checklist (não emite evento): reclassifica a
-- resposta corrigida.
create or replace function private.tg_answers_action_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.is_conforming is distinct from new.is_conforming
      or old.conditional_value is distinct from new.conditional_value
      or old.answer is distinct from new.answer)
     and exists (select 1 from public.checklist_executions e where e.id = new.execution_id and e.status = 'submitted') then
    begin
      perform private.action_plan_sync_answer(new.id, 'correction');
    exception when others then
      insert into public.action_plan_ingestions (execution_id, organization_id, status, source, attempts, last_error)
      values (new.execution_id, new.organization_id, 'failed', 'correction', 1, left(sqlerrm, 500))
      on conflict (execution_id) do update
        set status = 'failed', source = 'correction', attempts = public.action_plan_ingestions.attempts + 1,
            last_error = excluded.last_error;
    end;
  end if;
  return null;
end;
$$;
drop trigger if exists checklist_answers_action_plans on public.checklist_execution_answers;
create trigger checklist_answers_action_plans
  after update on public.checklist_execution_answers
  for each row execute function private.tg_answers_action_plans();

-- 8.3 Apontamento vinculado a uma manutenção no módulo Manutenção (abertura
-- com apontamentos, "vincular apontamentos"): o plano aberto desse apontamento
-- passa a ter a manutenção — imediatamente. Quando o vínculo nasce do próprio
-- Plano de Ação (hfm.action_plan_linking), o plano já foi vinculado e os
-- demais planos da mesma resposta não são estendidos.
create or replace function private.tg_finding_links_action_plans_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan    record;
  v_origin  text;
  v_code    text;
  v_overall integer;
begin
  if coalesce(current_setting('hfm.action_plan_linking', true), '') <> '' then
    return null;
  end if;
  select case when o.code = 'action_plan' then 'opened_from_plan' else 'maintenance_module' end, m.code
    into v_origin, v_code
    from public.maintenances m left join public.maintenance_origins o on o.id = m.origin_id
   where m.id = new.maintenance_id;
  select count(*) into v_overall from public.action_plan_items i
    join public.action_plans p on p.id = i.plan_id
   where i.checklist_answer_id = new.checklist_answer_id and not private.action_plan_terminal(p.status);
  for v_plan in
    select distinct i.plan_id from public.action_plan_items i
      join public.action_plans p on p.id = i.plan_id
     where i.checklist_answer_id = new.checklist_answer_id and not private.action_plan_terminal(p.status)
       and not exists (select 1 from public.action_plan_maintenance_links l
                        where l.plan_id = i.plan_id and l.maintenance_id = new.maintenance_id and l.status = 'active')
  loop
    insert into public.action_plan_maintenance_links
      (organization_id, plan_id, maintenance_id, status, origin, confidence, rule, resolutive, linked_by, linked_at)
    values
      (new.organization_id, v_plan.plan_id, new.maintenance_id, 'active', v_origin,
       case when v_overall > 1 then 'medium' else 'high' end,
       case when v_overall > 1 then 'checklist_finding_multi_option' else 'checklist_finding' end,
       true, auth.uid(), now())
    on conflict (plan_id, maintenance_id) do update
      set status = 'active', origin = excluded.origin, confidence = excluded.confidence, rule = excluded.rule,
          resolutive = true, linked_by = excluded.linked_by, linked_at = now(), unlinked_at = null, unlinked_by = null;
    perform private.action_plan_log(new.organization_id, v_plan.plan_id, 'maintenance_linked', null, null, null,
      jsonb_build_object('maintenance_id', new.maintenance_id, 'maintenance_code', v_code,
                         'origin', v_origin, 'answer_id', new.checklist_answer_id),
      case when auth.uid() is null then 'maintenance' else 'user' end);
    update public.action_plans set last_treatment_at = now(), last_treatment = 'Manutenção ' || v_code
     where id = v_plan.plan_id;
  end loop;
  return null;
end;
$$;
drop trigger if exists maintenance_finding_links_action_plans on public.maintenance_finding_links;
drop trigger if exists maintenance_finding_links_action_plans_link on public.maintenance_finding_links;
create trigger maintenance_finding_links_action_plans_link
  after insert on public.maintenance_finding_links
  for each row execute function private.tg_finding_links_action_plans_link();

-- 8.4 Recalcular a situação no FIM da transação (gatilhos adiados): concluir
-- uma manutenção muda a situação e só depois resolve os apontamentos — o
-- plano vê o estado final, sem passar por "pendente de nova tratativa" no
-- meio. Nunca derruba a operação da Manutenção: se o recálculo falhar, a
-- rotina refaz.
create or replace function private.tg_finding_links_action_plans_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer uuid := case when tg_op = 'DELETE' then old.checklist_answer_id else new.checklist_answer_id end;
  v_plan   record;
begin
  for v_plan in select distinct i.plan_id from public.action_plan_items i where i.checklist_answer_id = v_answer loop
    begin
      perform private.action_plan_refresh(v_plan.plan_id, 'maintenance');
    exception when others then
      raise warning 'Plano de Ação %: recálculo adiado para a rotina (%).', v_plan.plan_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
drop trigger if exists maintenance_finding_links_action_plans_refresh on public.maintenance_finding_links;
create constraint trigger maintenance_finding_links_action_plans_refresh
  after insert or update or delete on public.maintenance_finding_links
  deferrable initially deferred
  for each row execute function private.tg_finding_links_action_plans_refresh();

create or replace function private.tg_maintenances_action_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan record;
begin
  if old.status is distinct from new.status then
    for v_plan in
      select l.plan_id from public.action_plan_maintenance_links l
       where l.maintenance_id = new.id and l.status = 'active'
    loop
      begin
        perform private.action_plan_refresh(v_plan.plan_id, 'maintenance');
      exception when others then
        raise warning 'Plano de Ação %: recálculo adiado para a rotina (%).', v_plan.plan_id, sqlerrm;
      end;
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists maintenances_action_plans on public.maintenances;
create constraint trigger maintenances_action_plans
  after update on public.maintenances
  deferrable initially deferred
  for each row execute function private.tg_maintenances_action_plans();

-- -----------------------------------------------------------------------------
-- 9. Conciliação plano × manutenção
-- -----------------------------------------------------------------------------
-- Candidatas: manutenções do MESMO veículo (vehicle_id, nunca placa em texto),
-- não canceladas, abertas ou com referência a partir do 1º apontamento até a
-- janela depois do último, ainda não vinculadas nem descartadas para o plano.
-- Confiança:
--   ALTA  — item com serviço mapeado (ativo) para a chave do plano, sem
--           conflito (uma só candidata assim e nenhum outro plano aberto do
--           veículo disputando o mesmo serviço);
--   MÉDIA — serviço mapeado com conflito, ou mesmo cluster técnico dos
--           serviços mapeados;
--   REVISÃO MANUAL — mesmo veículo e período, sem correspondência técnica (ou a
--           chave do plano ainda sem mapeamento).
-- Placa e data parecidas nunca bastam para conciliar sozinhas.
create or replace function private.action_plan_candidates(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p        public.action_plans;
  v_settings public.action_plan_settings;
  v_mapped   boolean;
  v_result   jsonb;
begin
  select * into v_p from public.action_plans where id = p_plan_id;
  if not found then return '[]'::jsonb; end if;
  select * into v_settings from public.action_plan_settings where organization_id = v_p.organization_id;
  v_settings.reconciliation_window_days := coalesce(v_settings.reconciliation_window_days, 30);

  v_mapped := exists (select 1 from public.maintenance_checklist_service_links s
                       where s.organization_id = v_p.organization_id and s.app_id = v_p.app_id and s.is_active
                         and s.question_key = v_p.question_key
                         and (s.field_key is null or s.field_key is not distinct from v_p.field_key));

  with cand as (
    select m.id, m.code, m.status, m.maintenance_type_code, m.requested_on, m.scheduled_date, m.entry_date,
           m.exit_date, coalesce(m.entry_date, m.scheduled_date, m.requested_on) as ref_date,
           exists (select 1 from public.maintenance_items i
                     join public.maintenance_checklist_service_links s
                       on s.service_id = i.service_id and s.organization_id = i.organization_id and s.is_active
                      and s.app_id = v_p.app_id and s.question_key = v_p.question_key
                      and (s.field_key is null or s.field_key is not distinct from v_p.field_key)
                    where i.maintenance_id = m.id and i.status <> 'cancelled') as service_match,
           exists (select 1 from public.maintenance_items i
                     join public.maintenance_checklist_service_links s
                       on s.service_id = i.service_id and s.organization_id = i.organization_id and s.is_active
                      and s.auto_resolve and s.app_id = v_p.app_id and s.question_key = v_p.question_key
                      and (s.field_key is null or s.field_key is not distinct from v_p.field_key)
                    where i.maintenance_id = m.id and i.status <> 'cancelled') as auto_resolve_match,
           exists (select 1 from public.maintenance_items i
                     join public.maintenance_services sv on sv.id = i.service_id
                    where i.maintenance_id = m.id and i.status <> 'cancelled'
                      and i.cluster_id in (select sv2.cluster_id from public.maintenance_checklist_service_links s
                                             join public.maintenance_services sv2 on sv2.id = s.service_id
                                            where s.organization_id = v_p.organization_id and s.app_id = v_p.app_id
                                              and s.is_active and s.question_key = v_p.question_key)) as cluster_match,
           (select string_agg(i.service_name_snapshot, ', ' order by i.sort_order) from public.maintenance_items i
             where i.maintenance_id = m.id and i.status <> 'cancelled') as services,
           -- outro plano aberto do veículo, com serviço mapeado nesta manutenção
           exists (select 1 from public.action_plans o
                     join public.maintenance_checklist_service_links s
                       on s.organization_id = o.organization_id and s.app_id = o.app_id and s.is_active
                      and s.question_key = o.question_key
                      and (s.field_key is null or s.field_key is not distinct from o.field_key)
                     join public.maintenance_items i on i.service_id = s.service_id and i.maintenance_id = m.id
                                                     and i.status <> 'cancelled'
                    where o.organization_id = v_p.organization_id and o.vehicle_id = v_p.vehicle_id
                      and o.id <> v_p.id and not private.action_plan_terminal(o.status)
                      and not exists (select 1 from public.action_plan_maintenance_links ol
                                       where ol.plan_id = o.id and ol.maintenance_id = m.id)) as contested
      from public.maintenances m
     where m.organization_id = v_p.organization_id and m.vehicle_id = v_p.vehicle_id
       and m.status not in ('cancelled')
       and (m.status in ('to_schedule', 'scheduled', 'in_progress')
            or (coalesce(m.exit_date, m.entry_date, m.scheduled_date, m.requested_on) >= v_p.first_operational_date
                and coalesce(m.entry_date, m.scheduled_date, m.requested_on)
                    <= v_p.last_operational_date + v_settings.reconciliation_window_days))
       and not exists (select 1 from public.action_plan_maintenance_links l
                        where l.plan_id = v_p.id and l.maintenance_id = m.id)
  ),
  scored as (
    select c.*,
           count(*) filter (where c.service_match) over () as n_service,
           case
             when c.service_match and not c.contested then 'high'
             when c.service_match or c.cluster_match then 'medium'
             else 'manual_review'
           end as confidence0
      from cand c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'maintenance_id', s.id, 'code', s.code, 'status', s.status, 'type', s.maintenance_type_code,
           'requested_on', s.requested_on, 'scheduled_date', s.scheduled_date, 'entry_date', s.entry_date,
           'exit_date', s.exit_date, 'services', s.services,
           'service_match', s.service_match, 'auto_resolve_match', s.auto_resolve_match,
           'cluster_match', s.cluster_match, 'contested', s.contested,
           'confidence', case when s.confidence0 = 'high' and s.n_service > 1 then 'medium' else s.confidence0 end,
           'rule', case
                     when s.service_match and not s.contested and s.n_service = 1 then 'service_mapping_specific'
                     when s.service_match and s.contested then 'service_mapping_contested'
                     when s.service_match then 'service_mapping_multiple_candidates'
                     when s.cluster_match then 'same_cluster'
                     when not v_mapped then 'unmapped_action_key'
                     else 'same_vehicle_period'
                   end)
         order by (case when s.confidence0 = 'high' and s.n_service = 1 then 0
                        when s.confidence0 in ('high', 'medium') then 1 else 2 end),
                  (s.status in ('to_schedule', 'scheduled', 'in_progress')) desc, s.ref_date desc), '[]'::jsonb)
    into v_result
    from scored s;
  return v_result;
end;
$$;

-- Conciliação automática: só ALTA confiança (mapeamento ativo, específico e
-- sem conflito), só planos sem manutenção aberta que os cubra, e só manutenção
-- aberta ou concluída a partir do 1º apontamento. Registra origem, confiança,
-- regra e data no vínculo.
create or replace function private.action_plan_auto_reconcile(p_organization_id uuid, p_plan_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.action_plan_settings;
  v_p        record;
  v_c        jsonb;
  v_linked   integer := 0;
  v_checked  integer := 0;
begin
  v_settings := private.action_plan_settings_of(p_organization_id);
  if not v_settings.auto_reconcile and p_plan_id is null then
    return jsonb_build_object('disabled', true);
  end if;
  for v_p in
    select p.id from public.action_plans p
     where p.organization_id = p_organization_id
       and (p_plan_id is null or p.id = p_plan_id)
       and p.status in ('new', 'in_analysis', 'awaiting_maintenance', 'pending_new_action')
     order by p.first_operational_date
  loop
    v_checked := v_checked + 1;
    select c into v_c from jsonb_array_elements(private.action_plan_candidates(v_p.id)) c
     where c ->> 'rule' = 'service_mapping_specific' and c ->> 'confidence' = 'high'
     limit 1;
    if v_c is not null then
      perform private.action_plan_link_internal(v_p.id, (v_c ->> 'maintenance_id')::uuid, 'auto_reconciliation',
        'high', 'service_mapping_specific', true, 'Conciliação automática (alta confiança).', null, 'system');
      perform private.action_plan_refresh(v_p.id, 'system');
      v_linked := v_linked + 1;
    end if;
    v_c := null;
  end loop;
  return jsonb_build_object('checked', v_checked, 'linked', v_linked);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Rotina (pg_cron): recebimentos pendentes/falhos, checklists sem controle,
--     conciliação automática
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_cron_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e     record;
  v_ok    integer := 0;
  v_err   integer := 0;
  v_org   record;
  v_rec   jsonb := '[]'::jsonb;
  v_r     jsonb;
begin
  for v_e in
    select e.id from public.checklist_executions e
      left join public.action_plan_ingestions g on g.execution_id = e.id
     where e.status = 'submitted' and e.non_conforming_answers > 0
       and (g.execution_id is null or (g.status in ('pending', 'failed') and g.attempts < 5))
     order by e.submitted_at
     limit 500
  loop
    v_r := private.action_plan_ingest_safe(v_e.id, 'cron');
    if v_r ? 'error' then v_err := v_err + 1; else v_ok := v_ok + 1; end if;
  end loop;

  -- Planos que dependem de manutenção: recalcula (corrige o que um recálculo
  -- adiado não conseguiu fazer).
  for v_e in
    select distinct l.plan_id from public.action_plan_maintenance_links l
      join public.action_plans p on p.id = l.plan_id
     where l.status = 'active' and not private.action_plan_terminal(p.status)
  loop
    begin
      perform private.action_plan_refresh(v_e.plan_id, 'system');
    exception when others then
      v_err := v_err + 1;
    end;
  end loop;

  for v_org in select distinct organization_id from public.action_plans loop
    begin
      v_rec := v_rec || jsonb_build_object('organization_id', v_org.organization_id,
                                           'result', private.action_plan_auto_reconcile(v_org.organization_id, null));
    exception when others then
      v_rec := v_rec || jsonb_build_object('organization_id', v_org.organization_id, 'error', left(sqlerrm, 300));
    end;
  end loop;
  return jsonb_build_object('ingested', v_ok, 'errors', v_err, 'reconciliation', v_rec);
end;
$$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'hfm_action_plans_tick';
    perform cron.schedule('hfm_action_plans_tick', '*/20 * * * *', 'select private.action_plan_cron_tick()');
  end if;
end $cron$;

-- -----------------------------------------------------------------------------
-- 11. Permissões de execução
-- -----------------------------------------------------------------------------
revoke execute on function
  private.action_plan_terminal(text),
  private.action_plan_actor_name(uuid),
  private.action_plan_log(uuid, uuid, text, text, text, text, jsonb, text),
  private.action_plan_settings_of(uuid),
  private.action_plan_sla_days(public.action_plan_settings, text),
  private.action_plan_param(uuid, uuid, text, text),
  private.action_plan_selected(jsonb),
  private.action_plan_answer_route(uuid),
  private.action_plan_targets(uuid),
  private.action_plan_refresh(uuid, text),
  private.action_plan_link_internal(uuid, uuid, text, text, text, boolean, text, uuid[], text),
  private.action_plan_open_for(uuid, uuid, public.checklist_executions, public.checklist_execution_answers, record),
  private.action_plan_sync_answer(uuid, text),
  private.action_plan_ingest_execution(uuid, text),
  private.action_plan_ingest_safe(uuid, text),
  private.action_plan_candidates(uuid),
  private.action_plan_auto_reconcile(uuid, uuid),
  private.action_plan_cron_tick()
from public, anon, authenticated;

grant execute on function private.action_plan_terminal(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. Recebimento inicial: os checklists já enviados
-- -----------------------------------------------------------------------------
-- Toda inconformidade elegível precisa de rastreabilidade — inclusive as que
-- chegaram antes deste módulo. Em ordem cronológica, para que a consolidação e
-- os ciclos reflitam a história real. Idempotente.
do $backfill$
declare
  v_e record;
begin
  for v_e in
    select e.id from public.checklist_executions e
     where e.status = 'submitted' and e.non_conforming_answers > 0
       and not exists (select 1 from public.action_plan_ingestions g where g.execution_id = e.id and g.status = 'processed')
     order by e.operational_date, e.submitted_at
  loop
    perform private.action_plan_ingest_safe(v_e.id, 'backfill');
  end loop;
end $backfill$;
