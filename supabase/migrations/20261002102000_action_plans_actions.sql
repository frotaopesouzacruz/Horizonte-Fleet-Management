-- =============================================================================
-- Gestão de Checklist › Planos de Ação — tratativas (RPCs de escrita)
--
-- Toda ação confere permissão (action_plans.*) e o escopo do plano no
-- servidor; esconder botão não é controle de segurança. Cada decisão grava
-- quem, quando, motivo e justificativa (resoluções e eventos append-only).
-- A manutenção é sempre a do módulo oficial: abrir pelo plano chama
-- public.maintenance_create (que exige também Manutenção › Abrir manutenção e o
-- acesso ao veículo) com origem "Plano de ação" e os apontamentos do plano.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Guardas
-- -----------------------------------------------------------------------------
create or replace function private.action_plan_in_scope(p_plan public.action_plans)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_plan.operation_id is not null then p_plan.operation_id in (select private.accessible_operation_ids())
           else private.vehicle_in_scope(p_plan.organization_id, p_plan.vehicle_id)
         end;
$$;

-- O plano, travado, se o usuário tem a permissão e o plano está no escopo dele.
create or replace function private.action_plan_guard(p_plan_id uuid, p_permission text, p_lock boolean default true)
returns public.action_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.action_plans;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;
  if p_lock then
    select * into v_p from public.action_plans where id = p_plan_id for update;
  else
    select * into v_p from public.action_plans where id = p_plan_id;
  end if;
  if not found then
    raise exception 'Plano de ação não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_p.organization_id, p_permission) then
    raise exception 'Você não possui permissão para esta ação.' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(v_p.organization_id, 'action_plans.view') or not private.action_plan_in_scope(v_p) then
    raise exception 'Este plano não pertence às operações do seu acesso.' using errcode = 'insufficient_privilege';
  end if;
  return v_p;
end;
$$;

create or replace function private.action_plan_require_text(p_value text, p_label text, p_min integer default 10)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if length(btrim(coalesce(p_value, ''))) < p_min then
    raise exception '% é obrigatório (mínimo de % caracteres).', p_label, p_min using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(p_value)) > 2000 then
    raise exception '% muito longo (máximo de 2000 caracteres).', p_label using errcode = 'invalid_parameter_value';
  end if;
  return btrim(p_value);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Análise, prazo, observação, responsável e prioridade
-- -----------------------------------------------------------------------------
-- p_state: in_analysis (iniciar análise) | awaiting_maintenance (tratativa
-- definida: manutenção necessária) | new (voltar ao início, sem decisão).
create or replace function public.action_plan_set_analysis(p_plan_id uuid, p_state text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_status text;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.manage');
  if p_state not in ('new', 'in_analysis', 'awaiting_maintenance') then
    raise exception 'Etapa de análise inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if private.action_plan_terminal(v_p.status) then
    raise exception 'O plano está encerrado. Reabra-o para mudar a tratativa.' using errcode = 'invalid_parameter_value';
  end if;
  update public.action_plans set analysis_state = p_state, last_treatment_at = now(),
         last_treatment = case p_state when 'in_analysis' then 'Em análise'
                                       when 'awaiting_maintenance' then 'Manutenção necessária'
                                       else 'Sem tratativa definida' end
   where id = p_plan_id;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'analysis_changed', v_p.analysis_state, p_state,
    nullif(btrim(p_note), ''), '{}'::jsonb, 'user');
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return jsonb_build_object('id', p_plan_id, 'status', v_status);
end;
$$;

create or replace function public.action_plan_add_note(p_plan_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.action_plans;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.manage');
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'note_added', null, null,
    private.action_plan_require_text(p_note, 'A observação', 3), '{}'::jsonb, 'user');
  update public.action_plans set last_treatment_at = now(), last_treatment = 'Observação registrada' where id = p_plan_id;
  return jsonb_build_object('id', p_plan_id);
end;
$$;

create or replace function public.action_plan_set_due(p_plan_id uuid, p_due_on date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_reason text;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.manage');
  v_reason := private.action_plan_require_text(p_reason, 'O motivo da alteração do prazo');
  if p_due_on is null or p_due_on < v_p.first_operational_date then
    raise exception 'O prazo não pode ser anterior ao primeiro apontamento.' using errcode = 'invalid_parameter_value';
  end if;
  update public.action_plans set due_on = p_due_on, due_source = 'user' where id = p_plan_id;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'due_changed', null, null, v_reason,
    jsonb_build_object('from', v_p.due_on, 'to', p_due_on), 'user');
  return jsonb_build_object('id', p_plan_id, 'due_on', p_due_on);
end;
$$;

-- Responsável atual pela tratativa (distinto da liderança histórica do
-- checklist). p_user_id nulo = remover.
create or replace function public.action_plan_assign(p_plan_id uuid, p_user_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.action_plans;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.assign');
  if p_user_id is not null and not exists (
       select 1 from public.organization_memberships m
        where m.organization_id = v_p.organization_id and m.user_id = p_user_id and m.status = 'active') then
    raise exception 'O responsável precisa ser um usuário ativo da organização.' using errcode = 'invalid_parameter_value';
  end if;
  update public.action_plans
     set responsible_user_id = p_user_id, responsible_assigned_at = case when p_user_id is null then null else now() end
   where id = p_plan_id;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'assigned', null, null, nullif(btrim(p_reason), ''),
    jsonb_build_object('from', v_p.responsible_user_id, 'from_name', private.org_member_name(v_p.organization_id, v_p.responsible_user_id),
                       'to', p_user_id, 'to_name', private.org_member_name(v_p.organization_id, p_user_id)),
    'user');
  return jsonb_build_object('id', p_plan_id, 'responsible_user_id', p_user_id);
end;
$$;

create or replace function public.action_plan_change_priority(
  p_plan_id uuid, p_priority text, p_reason text, p_recalculate_due boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.action_plans;
  v_reason   text;
  v_settings public.action_plan_settings;
  v_due      date;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.change_priority');
  v_reason := private.action_plan_require_text(p_reason, 'O motivo da alteração de prioridade');
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridade inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if p_priority = v_p.priority then
    return jsonb_build_object('id', p_plan_id, 'priority', p_priority, 'unchanged', true);
  end if;
  v_settings := private.action_plan_settings_of(v_p.organization_id);
  v_due := case when coalesce(p_recalculate_due, true) and v_p.due_source = 'sla' and not private.action_plan_terminal(v_p.status)
                then v_p.first_operational_date + private.action_plan_sla_days(v_settings, p_priority)
                else v_p.due_on end;
  update public.action_plans set priority = p_priority, priority_source = 'user', due_on = v_due where id = p_plan_id;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'priority_changed', null, null, v_reason,
    jsonb_build_object('from', v_p.priority, 'to', p_priority, 'due_from', v_p.due_on, 'due_to', v_due), 'user');
  return jsonb_build_object('id', p_plan_id, 'priority', p_priority, 'due_on', v_due);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Resolução por apontamento
-- -----------------------------------------------------------------------------
-- p_payload: item_ids[] (padrão: todos os abertos), resolution, reason_code,
-- reason, observation, maintenance_id (validação), resolved_on (data em que a
-- solução de fato ocorreu, para baixa retroativa; entre o apontamento e hoje).
-- Resolver sem manutenção ou como improcedente não é permitido enquanto uma
-- manutenção ABERTA trata o apontamento: desvincule ou conclua a manutenção.
--   resolved_without_maintenance — action_plans.resolve_without_maintenance;
--       motivo + descrição da ação (≥ 10). Nenhuma manutenção é criada.
--   improper — action_plans.mark_improper; motivo + justificativa (≥ 10). A
--       resposta do motorista fica intacta.
--   cancelled — action_plans.cancel; justificativa administrativa (≥ 10).
--   validated_by_maintenance — action_plans.manage; a manutenção vinculada e
--       concluída resolveu (quando a baixa automática não era específica).
create or replace function public.action_plan_resolve_items(p_plan_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p          public.action_plans;
  v_res        text := p_payload ->> 'resolution';
  v_perm       text;
  v_code       text := nullif(btrim(p_payload ->> 'reason_code'), '');
  v_reason     text;
  v_obs        text := nullif(btrim(p_payload ->> 'observation'), '');
  v_ids        uuid[];
  v_m          public.maintenances;
  v_link       uuid;
  v_i          record;
  v_n          integer := 0;
  v_status     text;
  v_on         date := nullif(p_payload ->> 'resolved_on', '')::date;
  v_at         timestamptz;
  v_today      date;
begin
  v_perm := case v_res
              when 'resolved_without_maintenance' then 'action_plans.resolve_without_maintenance'
              when 'improper' then 'action_plans.mark_improper'
              when 'cancelled' then 'action_plans.cancel'
              when 'validated_by_maintenance' then 'action_plans.manage'
            end;
  if v_perm is null then
    raise exception 'Resolução inválida.' using errcode = 'invalid_parameter_value';
  end if;
  v_p := private.action_plan_guard(p_plan_id, v_perm);

  if v_res in ('resolved_without_maintenance', 'improper') and v_code is null then
    raise exception 'Selecione o motivo.' using errcode = 'invalid_parameter_value';
  end if;
  v_reason := private.action_plan_require_text(p_payload ->> 'reason',
    case v_res when 'resolved_without_maintenance' then 'A descrição da ação realizada'
               when 'improper' then 'A justificativa'
               when 'cancelled' then 'A justificativa do cancelamento'
               else 'A observação da validação' end,
    case when v_res = 'validated_by_maintenance' then 3 else 10 end);

  if v_res = 'validated_by_maintenance' then
    select m.* into v_m from public.maintenances m
      join public.action_plan_maintenance_links l on l.maintenance_id = m.id and l.plan_id = p_plan_id and l.status = 'active'
     where m.id = nullif(p_payload ->> 'maintenance_id', '')::uuid;
    if v_m.id is null then
      raise exception 'Informe uma manutenção vinculada a este plano.' using errcode = 'invalid_parameter_value';
    end if;
    if v_m.status <> 'completed' then
      raise exception 'A validação exige a manutenção concluída.' using errcode = 'invalid_parameter_value';
    end if;
    select id into v_link from public.action_plan_maintenance_links where plan_id = p_plan_id and maintenance_id = v_m.id;
  end if;

  if p_payload ? 'item_ids' and jsonb_typeof(p_payload -> 'item_ids') = 'array'
     and jsonb_array_length(p_payload -> 'item_ids') > 0 then
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'item_ids') x;
  end if;

  v_today := private.maintenance_today(v_p.organization_id);
  if v_on is not null then
    if v_on > v_today then
      raise exception 'A data da resolução não pode estar no futuro.' using errcode = 'invalid_parameter_value';
    end if;
    -- meio-dia no fuso da organização: a data informada, sem depender do horário
    v_at := (v_on + time '12:00') at time zone coalesce(
              (select nullif(o.timezone, '') from public.organizations o where o.id = v_p.organization_id), 'America/Sao_Paulo');
  end if;

  if v_res in ('resolved_without_maintenance', 'improper') and exists (
       select 1 from public.action_plan_items i
        where i.plan_id = p_plan_id and (v_ids is null or i.id = any (v_ids)) and i.status = 'in_maintenance') then
    raise exception 'Há manutenção aberta tratando o apontamento. Conclua ou desvincule a manutenção antes de dar esta baixa.'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_i in
    select i.* from public.action_plan_items i
     where i.plan_id = p_plan_id
       and (v_ids is null or i.id = any (v_ids))
       and i.status in ('pending', 'in_maintenance', 'needs_action')
     for update
  loop
    if v_on is not null and v_on < v_i.operational_date then
      raise exception 'A data da resolução não pode ser anterior ao apontamento (%).', to_char(v_i.operational_date, 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value';
    end if;
    update public.action_plan_items
       set status = case v_res when 'validated_by_maintenance' then 'resolved' else v_res end,
           status_source = 'user', resolved_at = coalesce(v_at, now()), resolved_by = auth.uid(),
           resolved_maintenance_id = case when v_res = 'validated_by_maintenance' then v_m.id end
     where id = v_i.id;
    insert into public.action_plan_item_resolutions
      (organization_id, plan_id, item_id, resolution_type, from_status, to_status, maintenance_id, maintenance_link_id,
       source, confidence, reason_code, reason, observation, resolved_by, resolved_by_name)
    values
      (v_p.organization_id, p_plan_id, v_i.id, v_res, v_i.status,
       case v_res when 'validated_by_maintenance' then 'resolved' else v_res end,
       v_m.id, v_link, 'user', case when v_res = 'validated_by_maintenance' then 'manual_review' end,
       v_code, v_reason,
       concat_ws(' · ', v_obs, case when v_on is not null then 'Resolução informada em ' || to_char(v_on, 'DD/MM/YYYY') end),
       auth.uid(), private.action_plan_actor_name(v_p.organization_id));
    v_n := v_n + 1;
  end loop;

  if v_ids is not null and v_n < cardinality(v_ids) then
    raise exception 'Há apontamentos já encerrados ou de outro plano na seleção.' using errcode = 'invalid_parameter_value';
  end if;
  if v_n = 0 then
    raise exception 'Nenhum apontamento aberto para resolver.' using errcode = 'invalid_parameter_value';
  end if;

  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'items_' || v_res, null, null, v_reason,
    jsonb_build_object('items', v_n, 'item_ids', to_jsonb(v_ids), 'reason_code', v_code, 'observation', v_obs,
                       'maintenance_id', v_m.id, 'maintenance_code', v_m.code),
    'user');
  update public.action_plans set last_treatment_at = now(),
         last_treatment = case v_res when 'resolved_without_maintenance' then 'Resolvido sem manutenção'
                                     when 'improper' then 'Improcedente'
                                     when 'cancelled' then 'Cancelado'
                                     else 'Resolução validada (' || v_m.code || ')' end
   where id = p_plan_id;
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return jsonb_build_object('id', p_plan_id, 'items', v_n, 'status', v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Reabertura — preserva o ciclo anterior
-- -----------------------------------------------------------------------------
-- O problema permaneceu ou voltou: os apontamentos encerrados (exceto
-- cancelados) voltam a pendente com o registro "reaberto", e as manutenções já
-- terminadas deixam de contar como tratativa (continuam vinculadas, como
-- histórico). Se já há outro plano aberto do mesmo problema no veículo, a
-- reabertura é recusada: a tratativa segue nele.
create or replace function public.action_plan_reopen(p_plan_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_reason text;
  v_other  text;
  v_i      record;
  v_n      integer := 0;
  v_status text;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.reopen');
  v_reason := private.action_plan_require_text(p_reason, 'O motivo da reabertura');
  if not private.action_plan_terminal(v_p.status) or v_p.status = 'cancelled' then
    raise exception 'Só um plano encerrado (resolvido, resolvido sem manutenção ou improcedente) pode ser reaberto.'
      using errcode = 'invalid_parameter_value';
  end if;
  select o.code into v_other from public.action_plans o
   where o.organization_id = v_p.organization_id and o.vehicle_id = v_p.vehicle_id and o.plan_key = v_p.plan_key
     and o.id <> v_p.id and not private.action_plan_terminal(o.status);
  if v_other is not null then
    raise exception 'Já existe o plano % aberto para este problema no veículo. Trate por ele.', v_other
      using errcode = 'invalid_parameter_value';
  end if;

  update public.action_plan_maintenance_links l
     set resolutive = false,
         metadata = l.metadata || jsonb_build_object('non_resolutive_since', now(), 'non_resolutive_reason', 'Plano reaberto')
    from public.maintenances m
   where l.plan_id = p_plan_id and l.status = 'active' and l.resolutive and m.id = l.maintenance_id
     and m.status in ('completed', 'cancelled', 'not_performed');

  for v_i in
    select i.* from public.action_plan_items i
     where i.plan_id = p_plan_id and i.status in ('resolved', 'resolved_without_maintenance', 'improper')
     for update
  loop
    update public.action_plan_items set status = 'pending', status_source = 'user', resolved_at = null,
           resolved_by = null, resolved_maintenance_id = null
     where id = v_i.id;
    insert into public.action_plan_item_resolutions
      (organization_id, plan_id, item_id, resolution_type, from_status, to_status, source, reason, resolved_by, resolved_by_name)
    values (v_p.organization_id, p_plan_id, v_i.id, 'reopened', v_i.status, 'pending', 'user', v_reason,
            auth.uid(), private.action_plan_actor_name(v_p.organization_id));
    v_n := v_n + 1;
  end loop;

  update public.action_plans
     set analysis_state = 'in_analysis', reopened_count = reopened_count + 1,
         last_treatment_at = now(), last_treatment = 'Plano reaberto'
   where id = p_plan_id;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'reopened', v_p.status, null, v_reason,
    jsonb_build_object('items', v_n), 'user');
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return jsonb_build_object('id', p_plan_id, 'items', v_n, 'status', v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Manutenção: vincular, desvincular, descartar candidata, abrir pelo plano
-- -----------------------------------------------------------------------------
-- p_payload: item_ids[] (padrão: abertos), resolutive (padrão true), reason,
--            origin: linked_manual (padrão) | reconciliation_manual
create or replace function public.action_plan_link_maintenance(p_plan_id uuid, p_maintenance_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_origin text := coalesce(nullif(p_payload ->> 'origin', ''), 'linked_manual');
  v_ids    uuid[];
  v_m      public.maintenances;
  v_link   uuid;
  v_status text;
begin
  if v_origin not in ('linked_manual', 'reconciliation_manual') then
    raise exception 'Origem de vínculo inválida.' using errcode = 'invalid_parameter_value';
  end if;
  v_p := private.action_plan_guard(p_plan_id,
           case when v_origin = 'reconciliation_manual' then 'action_plans.reconcile' else 'action_plans.link_maintenance' end);
  select * into v_m from public.maintenances where id = p_maintenance_id;
  if v_m.id is null or v_m.organization_id <> v_p.organization_id then
    raise exception 'Manutenção não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_m.vehicle_id <> v_p.vehicle_id then
    raise exception 'A manutenção é de outro veículo.' using errcode = 'invalid_parameter_value';
  end if;
  if v_m.status = 'cancelled' then
    raise exception 'Manutenção cancelada não trata apontamentos.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.action_plan_maintenance_links
              where plan_id = p_plan_id and maintenance_id = p_maintenance_id and status = 'active') then
    raise exception 'Esta manutenção já está vinculada ao plano.' using errcode = 'unique_violation';
  end if;
  if private.action_plan_terminal(v_p.status) then
    raise exception 'O plano está encerrado. Reabra-o para vincular manutenção.' using errcode = 'invalid_parameter_value';
  end if;
  if p_payload ? 'item_ids' and jsonb_typeof(p_payload -> 'item_ids') = 'array' and jsonb_array_length(p_payload -> 'item_ids') > 0 then
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'item_ids') x;
    if exists (select 1 from unnest(v_ids) u(id)
                where not exists (select 1 from public.action_plan_items i
                                   where i.id = u.id and i.plan_id = p_plan_id
                                     and i.status in ('pending', 'in_maintenance', 'needs_action'))) then
      raise exception 'Selecione apontamentos abertos deste plano.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_link := private.action_plan_link_internal(p_plan_id, p_maintenance_id, v_origin,
              case when v_origin = 'reconciliation_manual' then nullif(p_payload ->> 'confidence', '') end,
              case when v_origin = 'reconciliation_manual' then coalesce(nullif(p_payload ->> 'rule', ''), 'manual') else 'manual' end,
              coalesce((p_payload ->> 'resolutive')::boolean, true), p_payload ->> 'reason', v_ids, 'user');
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return jsonb_build_object('id', p_plan_id, 'link_id', v_link, 'status', v_status);
end;
$$;

create or replace function public.action_plan_unlink_maintenance(p_plan_id uuid, p_maintenance_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_reason text;
  v_m      public.maintenances;
  v_n      integer := 0;
  v_status text;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.link_maintenance');
  v_reason := private.action_plan_require_text(p_reason, 'O motivo do desvínculo');
  select * into v_m from public.maintenances where id = p_maintenance_id;
  update public.action_plan_maintenance_links
     set status = 'unlinked', unlinked_by = auth.uid(), unlinked_at = now(), reason = v_reason
   where plan_id = p_plan_id and maintenance_id = p_maintenance_id and status = 'active';
  if not found then
    raise exception 'Esta manutenção não está vinculada ao plano.' using errcode = 'no_data_found';
  end if;
  -- Os apontamentos ainda não resolvidos saem da manutenção — só os deste plano
  -- e só se nenhum outro plano aberto os mantém nela.
  with gone as (
    delete from public.maintenance_finding_links f
     where f.maintenance_id = p_maintenance_id and f.resolution_status = 'pending'
       and f.checklist_answer_id in (select i.checklist_answer_id from public.action_plan_items i where i.plan_id = p_plan_id)
       and not exists (select 1 from public.action_plan_items i2
                         join public.action_plan_maintenance_links l2 on l2.plan_id = i2.plan_id
                        where i2.checklist_answer_id = f.checklist_answer_id and l2.maintenance_id = p_maintenance_id
                          and l2.status = 'active' and l2.plan_id <> p_plan_id)
    returning f.checklist_answer_id
  )
  select count(*) into v_n from gone;
  if v_n > 0 then
    perform private.maintenance_log(v_p.organization_id, p_maintenance_id, 'finding_unlinked', null, null, v_reason,
      jsonb_build_object('action_plan_id', p_plan_id, 'action_plan_code', v_p.code, 'answers', v_n), 'user');
  end if;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'maintenance_unlinked', null, null, v_reason,
    jsonb_build_object('maintenance_id', p_maintenance_id, 'maintenance_code', v_m.code, 'answers_unlinked', v_n), 'user');
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return jsonb_build_object('id', p_plan_id, 'status', v_status);
end;
$$;

create or replace function public.action_plan_discard_candidate(p_plan_id uuid, p_maintenance_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      public.action_plans;
  v_reason text;
  v_m      public.maintenances;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.reconcile');
  v_reason := private.action_plan_require_text(p_reason, 'O motivo do descarte');
  select * into v_m from public.maintenances where id = p_maintenance_id and organization_id = v_p.organization_id;
  if v_m.id is null or v_m.vehicle_id <> v_p.vehicle_id then
    raise exception 'Candidata inválida para este plano.' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.action_plan_maintenance_links
    (organization_id, plan_id, maintenance_id, status, origin, resolutive, reason, linked_by, linked_at)
  values (v_p.organization_id, p_plan_id, p_maintenance_id, 'discarded', 'reconciliation_manual', false, v_reason, auth.uid(), now())
  on conflict (plan_id, maintenance_id) do nothing;
  if not found then
    raise exception 'Esta manutenção já foi vinculada ou descartada para o plano.' using errcode = 'unique_violation';
  end if;
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'candidate_discarded', null, null, v_reason,
    jsonb_build_object('maintenance_id', p_maintenance_id, 'maintenance_code', v_m.code), 'user');
  return jsonb_build_object('id', p_plan_id);
end;
$$;

-- Abre a manutenção no módulo oficial a partir do plano. p_payload é o mesmo
-- do assistente de Manutenção (vehicle_id, maintenance_type_code, service_ids,
-- priority, status, datas, fornecedor, description, duplicate_justification…)
-- mais item_ids[] (padrão: os abertos). Origem = Plano de ação; os
-- apontamentos vão juntos. A duplicidade é a da Manutenção: com equivalente
-- aberta, só abre com justificativa (hint maintenance_duplicate).
create or replace function public.action_plan_open_maintenance(p_plan_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p       public.action_plans;
  v_ids     uuid[];
  v_answers jsonb;
  v_payload jsonb;
  v_result  jsonb;
  v_status  text;
begin
  v_p := private.action_plan_guard(p_plan_id, 'action_plans.open_maintenance');
  if private.action_plan_terminal(v_p.status) then
    raise exception 'O plano está encerrado. Reabra-o para abrir manutenção.' using errcode = 'invalid_parameter_value';
  end if;
  if nullif(p_payload ->> 'vehicle_id', '')::uuid is distinct from v_p.vehicle_id then
    raise exception 'A manutenção deve ser do veículo do plano.' using errcode = 'invalid_parameter_value';
  end if;
  if p_payload ? 'item_ids' and jsonb_typeof(p_payload -> 'item_ids') = 'array' and jsonb_array_length(p_payload -> 'item_ids') > 0 then
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'item_ids') x;
  end if;
  select coalesce(jsonb_agg(distinct i.checklist_answer_id), '[]'::jsonb) into v_answers
    from public.action_plan_items i
   where i.plan_id = p_plan_id and i.status in ('pending', 'in_maintenance', 'needs_action')
     and (v_ids is null or i.id = any (v_ids));
  if jsonb_array_length(v_answers) = 0 then
    raise exception 'Selecione ao menos um apontamento aberto do plano.' using errcode = 'invalid_parameter_value';
  end if;

  v_payload := (p_payload - 'item_ids' - 'origin_id')
               || jsonb_build_object('origin_code', 'action_plan', 'checklist_answer_ids', v_answers,
                                     'description', coalesce(nullif(btrim(p_payload ->> 'description'), ''),
                                                             v_p.title || coalesce(' — ' || v_p.detail_label, '')
                                                             || ' (Plano de Ação ' || v_p.code || ')'));
  perform set_config('hfm.action_plan_linking', p_plan_id::text, true);
  v_result := public.maintenance_create(v_p.organization_id, v_payload);
  perform set_config('hfm.action_plan_linking', '', true);

  perform private.action_plan_link_internal(p_plan_id, (v_result ->> 'id')::uuid, 'opened_from_plan', 'high',
    'opened_from_plan', true, null, v_ids, 'user');
  perform private.action_plan_log(v_p.organization_id, p_plan_id, 'maintenance_opened', null, null, null,
    jsonb_build_object('maintenance_id', v_result ->> 'id', 'maintenance_code', v_result ->> 'code',
                       'answers', v_answers), 'user');
  update public.action_plans set analysis_state = 'awaiting_maintenance' where id = p_plan_id and analysis_state <> 'awaiting_maintenance';
  v_status := private.action_plan_refresh(p_plan_id, 'user');
  return v_result || jsonb_build_object('plan_id', p_plan_id, 'plan_status', v_status);
end;
$$;

-- Conciliação automática sob demanda (só alta confiança), toda a organização.
create or replace function public.action_plan_run_reconciliation(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p   record;
  v_c   jsonb;
  v_n   integer := 0;
  v_chk integer := 0;
begin
  if not private.has_permission(p_organization_id, 'action_plans.reconcile') then
    raise exception 'Você não possui permissão para conciliar.' using errcode = 'insufficient_privilege';
  end if;
  for v_p in
    select p.* from public.action_plans p
     where p.organization_id = p_organization_id
       and p.status in ('new', 'in_analysis', 'awaiting_maintenance', 'pending_new_action')
     order by p.first_operational_date
  loop
    continue when not private.action_plan_in_scope(v_p);
    v_chk := v_chk + 1;
    select c into v_c from jsonb_array_elements(private.action_plan_candidates(v_p.id)) c
     where c ->> 'rule' = 'service_mapping_specific' and c ->> 'confidence' = 'high' limit 1;
    if v_c is not null then
      perform private.action_plan_link_internal(v_p.id, (v_c ->> 'maintenance_id')::uuid, 'auto_reconciliation',
        'high', 'service_mapping_specific', true, 'Conciliação automática (alta confiança), executada sob demanda.', null, 'user');
      perform private.action_plan_refresh(v_p.id, 'user');
      v_n := v_n + 1;
    end if;
    v_c := null;
  end loop;
  return jsonb_build_object('checked', v_chk, 'linked', v_n);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Reprocessamento (idempotente)
-- -----------------------------------------------------------------------------
-- p_payload: date_from, date_to (data operacional), execution_ids[]
create or replace function public.action_plan_reprocess(p_organization_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  date := nullif(p_payload ->> 'date_from', '')::date;
  v_to    date := nullif(p_payload ->> 'date_to', '')::date;
  v_ids   uuid[];
  v_e     record;
  v_r     jsonb;
  v_ok    integer := 0;
  v_err   integer := 0;
  v_items integer := 0;
  v_plans integer := 0;
  v_ref   integer := 0;
begin
  if not private.has_permission(p_organization_id, 'action_plans.reprocess') then
    raise exception 'Você não possui permissão para reprocessar.' using errcode = 'insufficient_privilege';
  end if;
  if p_payload ? 'execution_ids' and jsonb_typeof(p_payload -> 'execution_ids') = 'array' then
    select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p_payload -> 'execution_ids') x;
  end if;
  if v_ids is null and (v_from is null or v_to is null or v_to < v_from or v_to - v_from > 370) then
    raise exception 'Informe um período válido (até 12 meses) ou os checklists.' using errcode = 'invalid_parameter_value';
  end if;
  for v_e in
    select e.id from public.checklist_executions e
     where e.organization_id = p_organization_id and e.status = 'submitted'
       and (v_ids is null or e.id = any (v_ids))
       and (v_from is null or e.operational_date between v_from and v_to)
     order by e.operational_date, e.submitted_at
  loop
    v_r := private.action_plan_ingest_safe(v_e.id, 'reprocess');
    if v_r ? 'error' then v_err := v_err + 1;
    else
      v_ok := v_ok + 1;
      v_items := v_items + coalesce((v_r ->> 'items_created')::int, 0);
      v_plans := v_plans + coalesce((v_r ->> 'plans_created')::int, 0);
    end if;
  end loop;
  for v_e in
    select p.id from public.action_plans p
     where p.organization_id = p_organization_id and not private.action_plan_terminal(p.status)
  loop
    perform private.action_plan_refresh(v_e.id, 'system');
    v_ref := v_ref + 1;
  end loop;
  return jsonb_build_object('executions', v_ok, 'errors', v_err, 'items_created', v_items, 'plans_created', v_plans,
                            'plans_refreshed', v_ref);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Parâmetros, mapeamento de serviços e configurações
-- -----------------------------------------------------------------------------
-- p_payload: app_id, question_key, field_key, action_domain, question_role,
-- generates_plan, plan_grouping, action_title, default_priority, sla_days,
-- requires_maintenance, requires_manual_analysis, driver_visible, status, notes, reason
create or replace function public.action_plan_save_parameter(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app   uuid := nullif(p_payload ->> 'app_id', '')::uuid;
  v_qk    text := nullif(btrim(p_payload ->> 'question_key'), '');
  v_fk    text := nullif(btrim(p_payload ->> 'field_key'), '');
  v_old   public.checklist_action_parameters;
  v_id    uuid;
  v_dom   text;
begin
  if not private.has_permission(p_organization_id, 'action_plans.manage_parameters') then
    raise exception 'Você não possui permissão para gerir parâmetros.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.operational_apps a where a.id = v_app and a.organization_id = p_organization_id) then
    raise exception 'Aplicativo inválido.' using errcode = 'invalid_parameter_value';
  end if;
  -- A chave precisa existir no formulário (alguma versão do aplicativo).
  if not exists (select 1 from public.checklist_questions q join public.checklist_app_versions v on v.id = q.version_id
                  where v.app_id = v_app and q.question_key = v_qk
                    and (v_fk is null or exists (select 1 from public.checklist_question_conditionals c
                                                  where c.question_id = q.id and c.field_key = v_fk))) then
    raise exception 'Pergunta ou campo não encontrado no Check List.' using errcode = 'invalid_parameter_value';
  end if;
  v_old := private.action_plan_param(p_organization_id, v_app, v_qk, v_fk);
  v_dom := coalesce(nullif(p_payload ->> 'action_domain', ''), v_old.action_domain, 'maintenance');
  -- Um campo de detalhe segue o domínio da pergunta: detalhe de avaria é avaria.
  if v_fk is not null and (select action_domain from private.action_plan_param(p_organization_id, v_app, v_qk, null)) = 'damage' then
    v_dom := 'damage';
  end if;

  insert into public.checklist_action_parameters
    (organization_id, app_id, question_key, field_key, action_domain, question_role, generates_plan, plan_grouping,
     action_title, default_priority, sla_days, requires_maintenance, requires_manual_analysis, driver_visible, status, notes)
  values
    (p_organization_id, v_app, v_qk, v_fk, v_dom,
     coalesce(nullif(p_payload ->> 'question_role', ''), v_old.question_role, case when v_fk is null then 'standalone' else 'detail' end),
     case when v_dom = 'damage' then false
          else coalesce((p_payload ->> 'generates_plan')::boolean, v_old.generates_plan, v_fk is null) end,
     coalesce(nullif(p_payload ->> 'plan_grouping', ''), v_old.plan_grouping, 'option'),
     case when p_payload ? 'action_title' then nullif(btrim(p_payload ->> 'action_title'), '') else v_old.action_title end,
     case when p_payload ? 'default_priority' then nullif(p_payload ->> 'default_priority', '') else v_old.default_priority end,
     case when p_payload ? 'sla_days' then nullif(p_payload ->> 'sla_days', '')::integer else v_old.sla_days end,
     coalesce((p_payload ->> 'requires_maintenance')::boolean, v_old.requires_maintenance, true),
     coalesce((p_payload ->> 'requires_manual_analysis')::boolean, v_old.requires_manual_analysis, false),
     coalesce((p_payload ->> 'driver_visible')::boolean, v_old.driver_visible, true),
     coalesce(nullif(p_payload ->> 'status', ''), v_old.status, 'active'),
     case when p_payload ? 'notes' then nullif(btrim(p_payload ->> 'notes'), '') else v_old.notes end)
  on conflict (organization_id, app_id, question_key, field_key) do update
    set action_domain = excluded.action_domain, question_role = excluded.question_role,
        generates_plan = excluded.generates_plan, plan_grouping = excluded.plan_grouping,
        action_title = excluded.action_title, default_priority = excluded.default_priority, sla_days = excluded.sla_days,
        requires_maintenance = excluded.requires_maintenance, requires_manual_analysis = excluded.requires_manual_analysis,
        driver_visible = excluded.driver_visible, status = excluded.status, notes = excluded.notes
  returning id into v_id;
  -- field_key nulo não dispara o conflito da constraint (nulos são distintos):
  -- o índice parcial garante a unicidade; aqui a atualização é explícita.
  if v_id is null and v_fk is null then
    update public.checklist_action_parameters set
      action_domain = v_dom,
      question_role = coalesce(nullif(p_payload ->> 'question_role', ''), question_role),
      generates_plan = case when v_dom = 'damage' then false else coalesce((p_payload ->> 'generates_plan')::boolean, generates_plan) end,
      plan_grouping = coalesce(nullif(p_payload ->> 'plan_grouping', ''), plan_grouping),
      action_title = case when p_payload ? 'action_title' then nullif(btrim(p_payload ->> 'action_title'), '') else action_title end,
      default_priority = case when p_payload ? 'default_priority' then nullif(p_payload ->> 'default_priority', '') else default_priority end,
      sla_days = case when p_payload ? 'sla_days' then nullif(p_payload ->> 'sla_days', '')::integer else sla_days end,
      requires_maintenance = coalesce((p_payload ->> 'requires_maintenance')::boolean, requires_maintenance),
      requires_manual_analysis = coalesce((p_payload ->> 'requires_manual_analysis')::boolean, requires_manual_analysis),
      driver_visible = coalesce((p_payload ->> 'driver_visible')::boolean, driver_visible),
      status = coalesce(nullif(p_payload ->> 'status', ''), status),
      notes = case when p_payload ? 'notes' then nullif(btrim(p_payload ->> 'notes'), '') else notes end
     where id = v_old.id
    returning id into v_id;
  end if;
  -- Avaria contamina os detalhes da pergunta.
  if v_fk is null and v_dom = 'damage' then
    update public.checklist_action_parameters set action_domain = 'damage', generates_plan = false
     where organization_id = p_organization_id and app_id = v_app and question_key = v_qk and field_key is not null;
  end if;
  return jsonb_build_object('id', v_id, 'reprocess_hint', v_old.id is not null and
    (v_old.action_domain is distinct from v_dom or v_old.generates_plan is distinct from (select generates_plan from public.checklist_action_parameters where id = v_id)
     or v_old.plan_grouping is distinct from (select plan_grouping from public.checklist_action_parameters where id = v_id)));
end;
$$;

-- O mapeamento Pergunta × Serviço é o oficial da Manutenção
-- (maintenance_checklist_service_links). Substitui o conjunto de serviços da
-- pergunta/campo: os que saem são desativados (nunca apagados). Não reescreve
-- nada no histórico das manutenções; apontamentos pendentes podem ser
-- reconciliados depois, pela Conciliação.
-- p_payload: app_id, question_key, field_key, services: [{service_id, auto_resolve}]
create or replace function public.action_plan_save_question_services(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid := nullif(p_payload ->> 'app_id', '')::uuid;
  v_qk  text := nullif(btrim(p_payload ->> 'question_key'), '');
  v_fk  text := nullif(btrim(p_payload ->> 'field_key'), '');
  v_s   jsonb;
  v_ids uuid[] := '{}';
  v_n   integer := 0;
begin
  if not private.has_permission(p_organization_id, 'action_plans.manage_mappings') then
    raise exception 'Você não possui permissão para gerir o mapeamento de serviços.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.operational_apps a where a.id = v_app and a.organization_id = p_organization_id) then
    raise exception 'Aplicativo inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if (select action_domain from private.action_plan_param(p_organization_id, v_app, v_qk, null)) = 'damage' then
    raise exception 'Pergunta do domínio Avaria não é mapeada para serviços de manutenção.' using errcode = 'invalid_parameter_value';
  end if;
  for v_s in select * from jsonb_array_elements(coalesce(p_payload -> 'services', '[]'::jsonb)) loop
    if not exists (select 1 from public.maintenance_services sv
                    where sv.id = (v_s ->> 'service_id')::uuid and sv.organization_id = p_organization_id
                      and sv.deleted_at is null) then
      raise exception 'Serviço inválido.' using errcode = 'invalid_parameter_value';
    end if;
    v_ids := v_ids || (v_s ->> 'service_id')::uuid;
    update public.maintenance_checklist_service_links
       set is_active = true, auto_resolve = coalesce((v_s ->> 'auto_resolve')::boolean, true)
     where organization_id = p_organization_id and app_id = v_app and question_key = v_qk
       and field_key is not distinct from v_fk and service_id = (v_s ->> 'service_id')::uuid;
    if not found then
      insert into public.maintenance_checklist_service_links
        (organization_id, app_id, question_key, field_key, service_id, auto_resolve, is_active)
      values (p_organization_id, v_app, v_qk, v_fk, (v_s ->> 'service_id')::uuid,
              coalesce((v_s ->> 'auto_resolve')::boolean, true), true);
    end if;
    v_n := v_n + 1;
  end loop;
  update public.maintenance_checklist_service_links
     set is_active = false
   where organization_id = p_organization_id and app_id = v_app and question_key = v_qk
     and field_key is not distinct from v_fk and is_active and not (service_id = any (v_ids));
  return jsonb_build_object('services', v_n);
end;
$$;

create or replace function public.action_plan_save_settings(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_plan_settings;
begin
  if not private.has_permission(p_organization_id, 'action_plans.manage_parameters') then
    raise exception 'Você não possui permissão para gerir parâmetros.' using errcode = 'insufficient_privilege';
  end if;
  v := private.action_plan_settings_of(p_organization_id);
  update public.action_plan_settings set
    sla_days_critical = coalesce((p_payload ->> 'sla_days_critical')::integer, v.sla_days_critical),
    sla_days_high = coalesce((p_payload ->> 'sla_days_high')::integer, v.sla_days_high),
    sla_days_medium = coalesce((p_payload ->> 'sla_days_medium')::integer, v.sla_days_medium),
    sla_days_low = coalesce((p_payload ->> 'sla_days_low')::integer, v.sla_days_low),
    due_soon_days = coalesce((p_payload ->> 'due_soon_days')::integer, v.due_soon_days),
    recurrence_window_days = coalesce((p_payload ->> 'recurrence_window_days')::integer, v.recurrence_window_days),
    reconciliation_window_days = coalesce((p_payload ->> 'reconciliation_window_days')::integer, v.reconciliation_window_days),
    auto_reconcile = coalesce((p_payload ->> 'auto_reconcile')::boolean, v.auto_reconcile)
   where organization_id = p_organization_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Permissões de execução
-- -----------------------------------------------------------------------------
revoke execute on function
  private.action_plan_in_scope(public.action_plans),
  private.action_plan_guard(uuid, text, boolean),
  private.action_plan_require_text(text, text, integer)
from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.action_plan_set_analysis(uuid, text, text)',
    'public.action_plan_add_note(uuid, text)',
    'public.action_plan_set_due(uuid, date, text)',
    'public.action_plan_assign(uuid, uuid, text)',
    'public.action_plan_change_priority(uuid, text, text, boolean)',
    'public.action_plan_resolve_items(uuid, jsonb)',
    'public.action_plan_reopen(uuid, text)',
    'public.action_plan_link_maintenance(uuid, uuid, jsonb)',
    'public.action_plan_unlink_maintenance(uuid, uuid, text)',
    'public.action_plan_discard_candidate(uuid, uuid, text)',
    'public.action_plan_open_maintenance(uuid, jsonb)',
    'public.action_plan_run_reconciliation(uuid)',
    'public.action_plan_reprocess(uuid, jsonb)',
    'public.action_plan_save_parameter(uuid, jsonb)',
    'public.action_plan_save_question_services(uuid, jsonb)',
    'public.action_plan_save_settings(uuid, jsonb)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
