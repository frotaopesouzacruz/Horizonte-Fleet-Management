-- =============================================================================
-- Etapa 12 — editor administrativo do Check List de Frota (§43–§47, §62, CA16)
--
-- Tudo o que a tela de configuração faz passa por aqui. Nenhuma policy de
-- escrita foi criada nas tabelas de configuração: a única forma de mudar um
-- cluster, uma pergunta, um condicional ou uma regra é por uma destas rotinas,
-- que conferem a permissão, exigem que a versão seja a de trabalho e deixam o
-- gatilho de imutabilidade como última linha de defesa.
--
-- TRÊS DECISÕES:
--
-- 1. A versão de trabalho nasce COPIANDO a última publicada (§43). A cópia
--    mapeia cluster e pergunta pela CHAVE, não pelo id — é a identidade
--    histórica da §47 fazendo o que existe para fazer.
--
-- 2. Publicar é validar primeiro (§46). A validação devolve a lista completa
--    de erros e avisos em vez de parar no primeiro; a rotina de publicação
--    recusa qualquer erro. O que o executor não sabe executar (tipo de
--    resposta fora de `yes_no`, mais de um condicional por pergunta, anexo)
--    é erro, não aviso.
--
-- 3. A pré-visualização usa o MESMO construtor de formulário do executor
--    (`private.checklist_build_form`). Não há segunda implementação para
--    divergir: o que a administração vê na prévia é o que o motorista recebe.
--
-- O QUE ESTA MIGRAÇÃO DELIBERADAMENTE NÃO CRIA: qualquer rotina, coluna ou
-- parâmetro de anexo, foto ou arquivo (§26, §45). O editor não tem onde
-- configurar isso porque o banco não tem onde guardar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Auditoria que faltava (§62): cluster e habilitação por operação
-- -----------------------------------------------------------------------------
drop trigger if exists checklist_clusters_audit on public.checklist_clusters;
create trigger checklist_clusters_audit
  after insert or update or delete on public.checklist_clusters
  for each row execute function private.tg_audit();

drop trigger if exists checklist_app_ops_audit on public.checklist_app_operations;
create trigger checklist_app_ops_audit
  after insert or update or delete on public.checklist_app_operations
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 1. Auxiliares
-- -----------------------------------------------------------------------------

-- Chave técnica a partir de um texto: minúsculas, sem acento, `_` entre
-- palavras. É assim que "Luzes e Sinalização" vira `luzes_e_sinalizacao`.
create or replace function private.checklist_slug(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        lower(translate(coalesce(p_text, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^a-z0-9]+', '_', 'g'),
      '^_+|_+$', '', 'g'),
    '');
$$;

revoke execute on function private.checklist_slug(text) from public, anon, authenticated;

-- A versão que pode ser editada: existe, é desta organização, é rascunho, e
-- quem chama tem a permissão pedida. As três recusas têm mensagens diferentes
-- de propósito (§63): "não pode" e "não é rascunho" são problemas distintos.
create or replace function private.checklist_editable_version(
  p_organization_id uuid,
  p_version_id      uuid,
  p_permission      text
)
returns public.checklist_app_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.checklist_app_versions;
begin
  if not private.has_permission(p_organization_id, p_permission) then
    raise exception 'Você não possui permissão para configurar o Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.checklist_app_versions
   where id = p_version_id and organization_id = p_organization_id;

  if v.id is null then
    raise exception 'Versão não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  if v.status <> 'draft' then
    raise exception 'A versão % está % e é imutável. Crie uma nova versão de trabalho para editar.',
      v.label, case v.status when 'published' then 'publicada' else 'arquivada' end
      using errcode = 'invalid_parameter_value';
  end if;

  return v;
end;
$$;

revoke execute on function private.checklist_editable_version(uuid, uuid, text)
  from public, anon, authenticated;

-- Renumera 1..n preservando a ordem atual. Chamada depois de excluir, para que
-- a validação de publicação nunca encontre lacuna criada pela própria tela.
create or replace function private.checklist_renumber_clusters(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checklist_clusters set sort_order = sort_order + 10000
   where version_id = p_version_id;
  update public.checklist_clusters c
     set sort_order = s.rn, updated_at = now()
    from (select id, row_number() over (order by sort_order) as rn
            from public.checklist_clusters where version_id = p_version_id) s
   where c.id = s.id;
end;
$$;

create or replace function private.checklist_renumber_questions(p_cluster_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checklist_questions set sort_order = sort_order + 10000
   where cluster_id = p_cluster_id;
  update public.checklist_questions q
     set sort_order = s.rn, updated_at = now()
    from (select id, row_number() over (order by sort_order) as rn
            from public.checklist_questions where cluster_id = p_cluster_id) s
   where q.id = s.id;
end;
$$;

revoke execute on function private.checklist_renumber_clusters(uuid) from public, anon, authenticated;
revoke execute on function private.checklist_renumber_questions(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. O construtor do formulário — um só, para o executor E para a prévia
--
-- `security invoker`: roda com a RLS de quem chama. É o mesmo corpo que vivia
-- dentro de `checklist_fleet_form`; só ganhou parâmetros para que a prévia de
-- um rascunho use exatamente a mesma montagem (§45 "pré-visualizar", §46
-- "compatibilidade com o executor").
-- -----------------------------------------------------------------------------
create or replace function private.checklist_build_form(
  p_version_id             uuid,
  p_operation_id           uuid,
  p_vehicle_type_id        uuid,
  p_vehicle_subcategory_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(c order by c ->> 'sort_order')
      from (
        select jsonb_build_object(
                 'id', cl.id,
                 'cluster_key', cl.cluster_key,
                 'name', cl.name,
                 'sort_order', lpad(cl.sort_order::text, 3, '0'),
                 'is_required', cl.is_required,
                 'questions', coalesce((
                   select jsonb_agg(q order by q ->> 'sort_order')
                     from (
                       select jsonb_build_object(
                                'id', qu.id,
                                'question_key', qu.question_key,
                                'sort_order', lpad(qu.sort_order::text, 3, '0'),
                                'text', qu.question_text,
                                'answer_type', qu.answer_type,
                                'conforming_answer', qu.conforming_answer,
                                'criticality', qu.criticality,
                                'is_required', qu.is_required,
                                'generates_action_plan', qu.generates_action_plan,
                                'allows_note', qu.allows_note,
                                'note_required', qu.note_required,
                                'guidance', (
                                  select r.guidance from public.checklist_question_rules r
                                   where r.question_id = qu.id and r.guidance is not null
                                     and (r.operation_id is null or r.operation_id = p_operation_id)
                                   limit 1),
                                'conditional', (
                                  select jsonb_build_object(
                                           'field_key', cd.field_key,
                                           'trigger_answer', cd.trigger_answer,
                                           'label', cd.label,
                                           'field_type', cd.field_type,
                                           'is_required', cd.is_required,
                                           'options', cd.options)
                                    from public.checklist_question_conditionals cd
                                   where cd.question_id = qu.id
                                   order by cd.sort_order limit 1)
                              ) as q
                         from public.checklist_questions qu
                        where qu.cluster_id = cl.id and qu.status = 'active'
                          and private.checklist_question_applies(
                                qu.id, p_vehicle_type_id, p_vehicle_subcategory_id, p_operation_id)
                     ) s
                 ), '[]'::jsonb)
               ) as c
          from public.checklist_clusters cl
         where cl.version_id = p_version_id
      ) t
     where c -> 'questions' <> '[]'::jsonb
  ), '[]'::jsonb);
$$;

revoke execute on function private.checklist_build_form(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.checklist_build_form(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- O executor passa a usar o construtor. Mesma assinatura, mesmo retorno.
create or replace function public.checklist_fleet_form(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_operation_id    uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_app     record;
  v_version record;
  v_vehicle record;
begin
  select a.id, a.name, a.slug into v_app
    from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
     and a.deleted_at is null;

  if v_app.id is null then
    raise exception 'O aplicativo Check List de Frota não está cadastrado nesta organização.'
      using errcode = 'no_data_found';
  end if;

  select v.* into v_version
    from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc
   limit 1;

  if v_version.id is null then
    raise exception 'O Check List de Frota ainda não possui versão publicada.'
      using errcode = 'no_data_found';
  end if;

  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate, v.fleet_code
    into v_vehicle
    from public.vehicles v
   where v.id = p_vehicle_id and v.organization_id = p_organization_id and v.deleted_at is null;

  if v_vehicle.id is null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'app_id',       v_app.id,
    'app_name',     v_app.name,
    'version_id',   v_version.id,
    'version_label', v_version.label,
    'min_duration_seconds', v_version.min_duration_seconds,
    'max_duration_seconds', v_version.max_duration_seconds,
    'vehicle', jsonb_build_object(
      'id', v_vehicle.id,
      'license_plate', v_vehicle.license_plate,
      'fleet_code', v_vehicle.fleet_code,
      'vehicle_type_id', v_vehicle.vehicle_type_id,
      'vehicle_subcategory_id', v_vehicle.vehicle_subcategory_id),
    'clusters', private.checklist_build_form(
      v_version.id, p_operation_id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Leituras do editor (security invoker: a RLS decide)
-- -----------------------------------------------------------------------------

-- Visão geral: aplicativo, versões com contagens, operações com a habilitação
-- e os catálogos que as regras de aplicabilidade apontam.
create or replace function public.checklist_admin_overview(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with app as (
    select a.id, a.name, a.is_active, a.allows_attachments
      from public.operational_apps a
     where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
       and a.deleted_at is null
  )
  select jsonb_build_object(
    'app', (select jsonb_build_object('id', app.id, 'name', app.name, 'is_active', app.is_active,
                                      'allows_attachments', app.allows_attachments) from app),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'major', v.major, 'minor', v.minor, 'label', v.label,
               'status', v.status, 'notes', v.notes, 'source_note', v.source_note,
               'published_at', v.published_at, 'created_at', v.created_at, 'updated_at', v.updated_at,
               'min_duration_seconds', v.min_duration_seconds,
               'max_duration_seconds', v.max_duration_seconds,
               'clusters', (select count(*) from public.checklist_clusters c where c.version_id = v.id),
               'questions', (select count(*) from public.checklist_questions q
                              where q.version_id = v.id and q.status = 'active'),
               'executions', (select count(*) from public.checklist_executions e
                               where e.version_id = v.id and e.status = 'submitted'))
             order by v.major desc, v.minor desc)
        from public.checklist_app_versions v, app
       where v.app_id = app.id), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'name', o.name, 'code', o.code, 'status', o.status,
               'is_enabled', coalesce(ao.is_enabled, false))
             order by o.name)
        from public.operations o
        cross join app
        left join public.checklist_app_operations ao
          on ao.operation_id = o.id and ao.app_id = app.id
       where o.organization_id = p_organization_id and o.deleted_at is null), '[]'::jsonb),
    'vehicle_types', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'code', t.code, 'name', t.name,
               'subcategories', coalesce((
                 select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'is_active', s.is_active)
                                  order by s.name)
                   from public.vehicle_subcategories s
                  where s.vehicle_type_id = t.id and s.deleted_at is null
                    and (s.organization_id = p_organization_id or s.organization_id is null)
               ), '[]'::jsonb))
             order by t.name)
        from public.vehicle_types t
       where t.deleted_at is null
         and (t.organization_id = p_organization_id or t.organization_id is null)), '[]'::jsonb)
  );
$$;

revoke execute on function public.checklist_admin_overview(uuid) from public, anon;
grant execute on function public.checklist_admin_overview(uuid) to authenticated;

-- A árvore completa de uma versão: clusters → perguntas → condicionais e regras.
create or replace function public.checklist_version_tree(
  p_organization_id uuid,
  p_version_id      uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version', jsonb_build_object(
      'id', v.id, 'major', v.major, 'minor', v.minor, 'label', v.label, 'status', v.status,
      'notes', v.notes, 'source_note', v.source_note,
      'published_at', v.published_at, 'created_at', v.created_at, 'updated_at', v.updated_at,
      'min_duration_seconds', v.min_duration_seconds,
      'max_duration_seconds', v.max_duration_seconds),
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cl.id, 'cluster_key', cl.cluster_key, 'name', cl.name,
               'sort_order', cl.sort_order, 'is_required', cl.is_required,
               'questions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', qu.id, 'question_key', qu.question_key, 'sort_order', qu.sort_order,
                          'question_text', qu.question_text, 'answer_type', qu.answer_type,
                          'conforming_answer', qu.conforming_answer, 'criticality', qu.criticality,
                          'is_required', qu.is_required,
                          'generates_action_plan', qu.generates_action_plan,
                          'allows_note', qu.allows_note, 'note_required', qu.note_required,
                          'status', qu.status,
                          'conditionals', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', cd.id, 'field_key', cd.field_key,
                                     'trigger_answer', cd.trigger_answer, 'label', cd.label,
                                     'field_type', cd.field_type, 'is_required', cd.is_required,
                                     'options', cd.options, 'sort_order', cd.sort_order)
                                   order by cd.sort_order)
                              from public.checklist_question_conditionals cd
                             where cd.question_id = qu.id), '[]'::jsonb),
                          'rules', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', r.id, 'rule_kind', r.rule_kind, 'mode', r.mode,
                                     'vehicle_type_id', r.vehicle_type_id,
                                     'vehicle_subcategory_id', r.vehicle_subcategory_id,
                                     'operation_id', r.operation_id,
                                     'target_name', coalesce(t.name, s.name, o.name),
                                     'guidance', r.guidance)
                                   order by r.rule_kind, r.mode, coalesce(t.name, s.name, o.name))
                              from public.checklist_question_rules r
                              left join public.vehicle_types t on t.id = r.vehicle_type_id
                              left join public.vehicle_subcategories s on s.id = r.vehicle_subcategory_id
                              left join public.operations o on o.id = r.operation_id
                             where r.question_id = qu.id), '[]'::jsonb))
                        order by qu.sort_order)
                   from public.checklist_questions qu
                  where qu.cluster_id = cl.id), '[]'::jsonb))
             order by cl.sort_order)
        from public.checklist_clusters cl
       where cl.version_id = v.id), '[]'::jsonb))
    from public.checklist_app_versions v
   where v.id = p_version_id and v.organization_id = p_organization_id;
$$;

revoke execute on function public.checklist_version_tree(uuid, uuid) from public, anon;
grant execute on function public.checklist_version_tree(uuid, uuid) to authenticated;

-- Pré-visualização (§45): o formulário que um veículo HIPOTÉTICO responderia
-- sob esta versão — publicada ou rascunho. Mesmo construtor do executor.
create or replace function public.checklist_version_preview(
  p_organization_id        uuid,
  p_version_id             uuid,
  p_operation_id           uuid default null,
  p_vehicle_type_id        uuid default null,
  p_vehicle_subcategory_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_version record;
  v_app     record;
begin
  select v.* into v_version from public.checklist_app_versions v
   where v.id = p_version_id and v.organization_id = p_organization_id;
  if v_version.id is null then
    raise exception 'Versão não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  select a.id, a.name into v_app from public.operational_apps a where a.id = v_version.app_id;

  return jsonb_build_object(
    'app_id', v_app.id,
    'app_name', v_app.name,
    'version_id', v_version.id,
    'version_label', v_version.label,
    'version_status', v_version.status,
    'min_duration_seconds', v_version.min_duration_seconds,
    'max_duration_seconds', v_version.max_duration_seconds,
    'vehicle', jsonb_build_object(
      'id', null, 'license_plate', 'PRÉVIA', 'fleet_code', null,
      'vehicle_type_id', p_vehicle_type_id, 'vehicle_subcategory_id', p_vehicle_subcategory_id),
    'clusters', private.checklist_build_form(
      v_version.id, p_operation_id, p_vehicle_type_id, p_vehicle_subcategory_id));
end;
$$;

revoke execute on function public.checklist_version_preview(uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.checklist_version_preview(uuid, uuid, uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Versões: criar a de trabalho, ajustar parâmetros, descartar
-- -----------------------------------------------------------------------------

-- §43: a nova versão nasce da última publicada, com tudo copiado. `bump`
-- decide se é 1.1 (minor, padrão) ou 2.0 (major).
create or replace function public.create_checklist_version(
  p_organization_id uuid,
  p_payload         jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bump   text := coalesce(nullif(p_payload ->> 'bump', ''), 'minor');
  v_notes  text := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_app    record;
  v_base   record;
  v_draft  record;
  v_major  smallint;
  v_minor  smallint;
  v_new    uuid;
  v_label  text;
begin
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.create_version') then
    raise exception 'Você não possui permissão para criar versões do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_bump not in ('minor', 'major') then
    raise exception 'Tipo de versão inválido: use minor ou major.' using errcode = 'invalid_parameter_value';
  end if;

  -- Trava o aplicativo: duas criações simultâneas não podem numerar igual.
  select a.id, a.name into v_app
    from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
     and a.deleted_at is null
   for update;

  if v_app.id is null then
    raise exception 'O aplicativo Check List de Frota não está cadastrado nesta organização.'
      using errcode = 'no_data_found';
  end if;

  select v.id, v.label into v_draft from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'draft';
  if v_draft.id is not null then
    raise exception 'Já existe uma versão de trabalho (%). Edite, publique ou descarte-a antes de criar outra.',
      v_draft.label using errcode = 'unique_violation';
  end if;

  select v.* into v_base from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc limit 1;

  -- Sem publicada (organização nova, ou tudo arquivado): parte da mais recente
  -- que existir; sem nenhuma, nasce 1.0 vazia.
  if v_base.id is null then
    select v.* into v_base from public.checklist_app_versions v
     where v.app_id = v_app.id
     order by v.major desc, v.minor desc limit 1;
  end if;

  if v_base.id is null then
    v_major := 1; v_minor := 0;
  elsif v_bump = 'major' then
    select coalesce(max(major), 0) + 1 into v_major from public.checklist_app_versions where app_id = v_app.id;
    v_minor := 0;
  else
    v_major := v_base.major;
    select coalesce(max(minor), -1) + 1 into v_minor
      from public.checklist_app_versions where app_id = v_app.id and major = v_major;
  end if;

  insert into public.checklist_app_versions
    (organization_id, app_id, major, minor, status, notes, source_note,
     min_duration_seconds, max_duration_seconds, created_by, updated_by)
  values
    (p_organization_id, v_app.id, v_major, v_minor, 'draft', v_notes,
     case when v_base.id is null then 'Versão inicial criada em branco pelo editor.'
          else 'Versão de trabalho criada a partir da versão ' || v_base.label || '.' end,
     coalesce(v_base.min_duration_seconds, 60), coalesce(v_base.max_duration_seconds, 600),
     auth.uid(), auth.uid())
  returning id, label into v_new, v_label;

  if v_base.id is not null then
    -- §47: cluster e pergunta se mapeiam pela CHAVE. Id novo, identidade igual.
    insert into public.checklist_clusters
      (organization_id, version_id, cluster_key, name, sort_order, is_required)
    select c.organization_id, v_new, c.cluster_key, c.name, c.sort_order, c.is_required
      from public.checklist_clusters c where c.version_id = v_base.id;

    insert into public.checklist_questions
      (organization_id, version_id, cluster_id, question_key, sort_order, question_text,
       answer_type, conforming_answer, criticality, is_required, generates_action_plan,
       allows_note, note_required, status)
    select q.organization_id, v_new, nc.id, q.question_key, q.sort_order, q.question_text,
           q.answer_type, q.conforming_answer, q.criticality, q.is_required, q.generates_action_plan,
           q.allows_note, q.note_required, q.status
      from public.checklist_questions q
      join public.checklist_clusters oc on oc.id = q.cluster_id
      join public.checklist_clusters nc on nc.version_id = v_new and nc.cluster_key = oc.cluster_key
     where q.version_id = v_base.id;

    insert into public.checklist_question_conditionals
      (organization_id, version_id, question_id, field_key, trigger_answer, label, field_type,
       is_required, options, sort_order)
    select cd.organization_id, v_new, nq.id, cd.field_key, cd.trigger_answer, cd.label, cd.field_type,
           cd.is_required, cd.options, cd.sort_order
      from public.checklist_question_conditionals cd
      join public.checklist_questions oq on oq.id = cd.question_id
      join public.checklist_questions nq on nq.version_id = v_new and nq.question_key = oq.question_key
     where cd.version_id = v_base.id;

    insert into public.checklist_question_rules
      (organization_id, version_id, question_id, rule_kind, mode,
       vehicle_type_id, vehicle_subcategory_id, operation_id, guidance, created_by)
    select r.organization_id, v_new, nq.id, r.rule_kind, r.mode,
           r.vehicle_type_id, r.vehicle_subcategory_id, r.operation_id, r.guidance, auth.uid()
      from public.checklist_question_rules r
      join public.checklist_questions oq on oq.id = r.question_id
      join public.checklist_questions nq on nq.version_id = v_new and nq.question_key = oq.question_key
     where r.version_id = v_base.id;
  end if;

  return jsonb_build_object('id', v_new, 'label', v_label,
                            'base_label', v_base.label,
                            'clusters', (select count(*) from public.checklist_clusters where version_id = v_new),
                            'questions', (select count(*) from public.checklist_questions where version_id = v_new));
end;
$$;

revoke execute on function public.create_checklist_version(uuid, jsonb) from public, anon;
grant execute on function public.create_checklist_version(uuid, jsonb) to authenticated;

-- Notas e limites de tempo (§39) da versão de trabalho.
create or replace function public.update_checklist_version(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.checklist_app_versions;
  v_min integer := coalesce((p_payload ->> 'min_duration_seconds')::integer, 60);
  v_max integer := coalesce((p_payload ->> 'max_duration_seconds')::integer, 600);
begin
  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'id', '')::uuid,
         'applications.checklist_fleet.configure');

  if v_min < 0 or v_max <= v_min then
    raise exception 'O tempo mínimo deve ser zero ou mais e o máximo maior que o mínimo.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.checklist_app_versions
     set notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
         min_duration_seconds = v_min,
         max_duration_seconds = v_max,
         updated_at = now(), updated_by = auth.uid()
   where id = v.id;

  return jsonb_build_object('id', v.id, 'label', v.label);
end;
$$;

revoke execute on function public.update_checklist_version(uuid, jsonb) from public, anon;
grant execute on function public.update_checklist_version(uuid, jsonb) to authenticated;

-- Descartar a versão de trabalho. Só rascunho: publicada e arquivada nunca
-- saem (o gatilho recusa), e nenhuma execução pode apontar para um rascunho.
create or replace function public.discard_checklist_version(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.checklist_app_versions;
begin
  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'id', '')::uuid,
         'applications.checklist_fleet.create_version');

  if exists (select 1 from public.checklist_executions e where e.version_id = v.id) then
    raise exception 'A versão % possui execuções vinculadas e não pode ser descartada.', v.label
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.checklist_app_versions where id = v.id;
  return jsonb_build_object('id', v.id, 'label', v.label);
end;
$$;

revoke execute on function public.discard_checklist_version(uuid, jsonb) from public, anon;
grant execute on function public.discard_checklist_version(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Clusters
-- -----------------------------------------------------------------------------
create or replace function public.save_checklist_cluster(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         public.checklist_app_versions;
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
  v_req     boolean := coalesce((p_payload ->> 'is_required')::boolean, true);
  v_key     text;
  v_current record;
  n         integer;
begin
  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'version_id', '')::uuid,
         'applications.checklist_fleet.configure');

  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'O nome do cluster deve ter entre 1 e 120 caracteres.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    v_key := coalesce(private.checklist_slug(nullif(p_payload ->> 'cluster_key', '')),
                      private.checklist_slug(v_name));
    if v_key is null then
      raise exception 'Não foi possível derivar a chave do cluster a partir do nome.'
        using errcode = 'invalid_parameter_value';
    end if;
    v_key := left(v_key, 60);
    n := 1;
    while exists (select 1 from public.checklist_clusters where version_id = v.id and cluster_key = v_key) loop
      n := n + 1;
      v_key := left(private.checklist_slug(v_name), 56) || '_' || n;
    end loop;

    insert into public.checklist_clusters
      (organization_id, version_id, cluster_key, name, sort_order, is_required)
    values (p_organization_id, v.id, v_key, v_name,
            (select coalesce(max(sort_order), 0) + 1 from public.checklist_clusters where version_id = v.id),
            v_req)
    returning id into v_id;
  else
    select * into v_current from public.checklist_clusters where id = v_id and version_id = v.id;
    if v_current.id is null then
      raise exception 'Cluster não encontrado nesta versão.' using errcode = 'no_data_found';
    end if;
    v_key := v_current.cluster_key;
    update public.checklist_clusters
       set name = v_name, is_required = v_req, updated_at = now()
     where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'cluster_key', v_key);
end;
$$;

revoke execute on function public.save_checklist_cluster(uuid, jsonb) from public, anon;
grant execute on function public.save_checklist_cluster(uuid, jsonb) to authenticated;

create or replace function public.delete_checklist_cluster(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cluster record;
  v         public.checklist_app_versions;
  n         integer;
begin
  select * into v_cluster from public.checklist_clusters
   where id = nullif(p_payload ->> 'id', '')::uuid and organization_id = p_organization_id;
  if v_cluster.id is null then
    raise exception 'Cluster não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, v_cluster.version_id, 'applications.checklist_fleet.configure');

  select count(*) into n from public.checklist_questions where cluster_id = v_cluster.id;
  if n > 0 then
    raise exception 'O cluster "%" possui % pergunta(s). Mova ou exclua as perguntas antes de excluí-lo.',
      v_cluster.name, n using errcode = 'invalid_parameter_value';
  end if;

  delete from public.checklist_clusters where id = v_cluster.id;
  perform private.checklist_renumber_clusters(v.id);

  return jsonb_build_object('id', v_cluster.id);
end;
$$;

revoke execute on function public.delete_checklist_cluster(uuid, jsonb) from public, anon;
grant execute on function public.delete_checklist_cluster(uuid, jsonb) to authenticated;

-- §45 "alterar ordem": a lista completa, na ordem nova. Uma lista parcial é
-- recusada — reordenar não pode esconder um cluster por omissão.
create or replace function public.reorder_checklist_clusters(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.checklist_app_versions;
  v_ids  uuid[];
  n_have integer;
begin
  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'version_id', '')::uuid,
         'applications.checklist_fleet.configure');

  select coalesce(array_agg(value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload -> 'ordered_ids', '[]'::jsonb));

  select count(*) into n_have from public.checklist_clusters where version_id = v.id;
  if n_have <> coalesce(array_length(v_ids, 1), 0)
     or exists (select 1 from unnest(v_ids) u(id)
                 where not exists (select 1 from public.checklist_clusters c
                                    where c.id = u.id and c.version_id = v.id))
     or (select count(distinct x) from unnest(v_ids) x) <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'A ordem informada não corresponde aos clusters desta versão.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.checklist_clusters set sort_order = sort_order + 10000 where version_id = v.id;
  update public.checklist_clusters c
     set sort_order = o.pos, updated_at = now()
    from unnest(v_ids) with ordinality as o(id, pos)
   where c.id = o.id;

  return jsonb_build_object('version_id', v.id, 'count', n_have);
end;
$$;

revoke execute on function public.reorder_checklist_clusters(uuid, jsonb) from public, anon;
grant execute on function public.reorder_checklist_clusters(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Perguntas (§45, §47)
-- -----------------------------------------------------------------------------
create or replace function public.save_checklist_question(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v           public.checklist_app_versions;
  v_id        uuid    := nullif(p_payload ->> 'id', '')::uuid;
  v_cluster   uuid    := nullif(p_payload ->> 'cluster_id', '')::uuid;
  v_text      text    := btrim(coalesce(p_payload ->> 'question_text', ''));
  v_conf      text    := coalesce(nullif(p_payload ->> 'conforming_answer', ''), 'yes');
  v_crit      text    := coalesce(nullif(p_payload ->> 'criticality', ''), 'media');
  v_req       boolean := coalesce((p_payload ->> 'is_required')::boolean, true);
  v_plan      boolean := coalesce((p_payload ->> 'generates_action_plan')::boolean, true);
  v_note      boolean := coalesce((p_payload ->> 'allows_note')::boolean, true);
  v_note_req  boolean := coalesce((p_payload ->> 'note_required')::boolean, false);
  v_status    text    := coalesce(nullif(p_payload ->> 'status', ''), 'active');
  v_new_ident boolean := coalesce((p_payload ->> 'new_identity')::boolean, false);
  v_key_in    text    := nullif(btrim(coalesce(p_payload ->> 'question_key', '')), '');
  v_key       text;
  v_cl        record;
  v_current   record;
  v_old_cl    uuid;
  n           integer;
begin
  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'version_id', '')::uuid,
         'applications.checklist_fleet.configure');

  if length(v_text) < 3 or length(v_text) > 500 then
    raise exception 'O texto da pergunta deve ter entre 3 e 500 caracteres.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_conf not in ('yes', 'no') then
    raise exception 'A resposta conforme deve ser SIM ou NÃO.' using errcode = 'invalid_parameter_value';
  end if;
  if v_crit not in ('media', 'critica') then
    raise exception 'A criticidade deve ser média ou crítica.' using errcode = 'invalid_parameter_value';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception 'Situação da pergunta inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if v_note_req and not v_note then
    raise exception 'A pergunta exige observação mas não permite observação. Ative "permite observação" ou desative a exigência.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_cl from public.checklist_clusters where id = v_cluster and version_id = v.id;
  if v_cl.id is null then
    raise exception 'Cluster não encontrado nesta versão.' using errcode = 'no_data_found';
  end if;

  if v_key_in is not null and v_key_in !~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' then
    raise exception 'A identidade técnica aceita apenas letras minúsculas, números, "_" e "." (ex.: luzes.farois).'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    -- Nova pergunta: identidade informada ou derivada do cluster + texto.
    v_key := coalesce(v_key_in, v_cl.cluster_key || '.' || left(private.checklist_slug(v_text), 60));
    n := 1;
    while exists (select 1 from public.checklist_questions where version_id = v.id and question_key = v_key) loop
      n := n + 1;
      v_key := coalesce(v_key_in, v_cl.cluster_key || '.' || left(private.checklist_slug(v_text), 56)) || '_' || n;
    end loop;

    insert into public.checklist_questions
      (organization_id, version_id, cluster_id, question_key, sort_order, question_text,
       answer_type, conforming_answer, criticality, is_required, generates_action_plan,
       allows_note, note_required, status)
    values
      (p_organization_id, v.id, v_cl.id, v_key,
       (select coalesce(max(sort_order), 0) + 1 from public.checklist_questions where cluster_id = v_cl.id),
       v_text, 'yes_no', v_conf, v_crit, v_req, v_plan, v_note, v_note_req, v_status)
    returning id into v_id;
  else
    select * into v_current from public.checklist_questions where id = v_id and version_id = v.id;
    if v_current.id is null then
      raise exception 'Pergunta não encontrada nesta versão.' using errcode = 'no_data_found';
    end if;

    -- §47: a identidade só muda quando a administração declara mudança
    -- substancial de significado. Editar o texto NÃO muda a chave.
    v_key := v_current.question_key;
    if v_new_ident then
      if v_key_in is null or v_key_in = v_current.question_key then
        raise exception 'Informe a nova identidade técnica da pergunta, diferente da atual (%).',
          v_current.question_key using errcode = 'invalid_parameter_value';
      end if;
      if exists (select 1 from public.checklist_questions
                  where version_id = v.id and question_key = v_key_in and id <> v_id) then
        raise exception 'Já existe uma pergunta com a identidade % nesta versão.', v_key_in
          using errcode = 'unique_violation';
      end if;
      v_key := v_key_in;
    end if;

    v_old_cl := v_current.cluster_id;
    update public.checklist_questions
       set cluster_id = v_cl.id,
           sort_order = case when v_cl.id = v_old_cl then sort_order
                             else (select coalesce(max(sort_order), 0) + 1
                                     from public.checklist_questions where cluster_id = v_cl.id) end,
           question_key = v_key,
           question_text = v_text,
           conforming_answer = v_conf,
           criticality = v_crit,
           is_required = v_req,
           generates_action_plan = v_plan,
           allows_note = v_note,
           note_required = v_note_req,
           status = v_status,
           updated_at = now()
     where id = v_id;

    if v_cl.id <> v_old_cl then
      perform private.checklist_renumber_questions(v_old_cl);
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'question_key', v_key, 'cluster_id', v_cl.id);
end;
$$;

revoke execute on function public.save_checklist_question(uuid, jsonb) from public, anon;
grant execute on function public.save_checklist_question(uuid, jsonb) to authenticated;

create or replace function public.delete_checklist_question(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q record;
  v   public.checklist_app_versions;
begin
  select * into v_q from public.checklist_questions
   where id = nullif(p_payload ->> 'id', '')::uuid and organization_id = p_organization_id;
  if v_q.id is null then
    raise exception 'Pergunta não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, v_q.version_id, 'applications.checklist_fleet.configure');

  delete from public.checklist_questions where id = v_q.id;
  perform private.checklist_renumber_questions(v_q.cluster_id);

  return jsonb_build_object('id', v_q.id, 'question_key', v_q.question_key);
end;
$$;

revoke execute on function public.delete_checklist_question(uuid, jsonb) from public, anon;
grant execute on function public.delete_checklist_question(uuid, jsonb) to authenticated;

create or replace function public.reorder_checklist_questions(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cl   record;
  v      public.checklist_app_versions;
  v_ids  uuid[];
  n_have integer;
begin
  select * into v_cl from public.checklist_clusters
   where id = nullif(p_payload ->> 'cluster_id', '')::uuid and organization_id = p_organization_id;
  if v_cl.id is null then
    raise exception 'Cluster não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, v_cl.version_id, 'applications.checklist_fleet.configure');

  select coalesce(array_agg(value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload -> 'ordered_ids', '[]'::jsonb));

  select count(*) into n_have from public.checklist_questions where cluster_id = v_cl.id;
  if n_have <> coalesce(array_length(v_ids, 1), 0)
     or exists (select 1 from unnest(v_ids) u(id)
                 where not exists (select 1 from public.checklist_questions q
                                    where q.id = u.id and q.cluster_id = v_cl.id))
     or (select count(distinct x) from unnest(v_ids) x) <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'A ordem informada não corresponde às perguntas deste cluster.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.checklist_questions set sort_order = sort_order + 10000 where cluster_id = v_cl.id;
  update public.checklist_questions q
     set sort_order = o.pos, updated_at = now()
    from unnest(v_ids) with ordinality as o(id, pos)
   where q.id = o.id;

  return jsonb_build_object('cluster_id', v_cl.id, 'count', n_have);
end;
$$;

revoke execute on function public.reorder_checklist_questions(uuid, jsonb) from public, anon;
grant execute on function public.reorder_checklist_questions(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Condicionais (§25, §45)
--
-- O executor apresenta UM campo condicional por pergunta. Um segundo campo
-- seria gravado no banco e nunca perguntado ao motorista — por isso é recusado
-- aqui, e não descoberto na publicação.
-- -----------------------------------------------------------------------------
create or replace function public.save_checklist_conditional(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         public.checklist_app_versions;
  v_id      uuid    := nullif(p_payload ->> 'id', '')::uuid;
  v_q       record;
  v_trigger text    := coalesce(nullif(p_payload ->> 'trigger_answer', ''), 'no');
  v_label   text    := btrim(coalesce(p_payload ->> 'label', ''));
  v_type    text    := coalesce(nullif(p_payload ->> 'field_type', ''), 'text');
  v_req     boolean := coalesce((p_payload ->> 'is_required')::boolean, true);
  v_opts_in jsonb   := coalesce(p_payload -> 'options', '[]'::jsonb);
  v_opts    jsonb   := '[]'::jsonb;
  v_key     text;
  o         jsonb;
  o_label   text;
  o_value   text;
  v_current record;
begin
  select q.* into v_q from public.checklist_questions q
   where q.id = nullif(p_payload ->> 'question_id', '')::uuid and q.organization_id = p_organization_id;
  if v_q.id is null then
    raise exception 'Pergunta não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, v_q.version_id, 'applications.checklist_fleet.configure');

  if v_trigger not in ('yes', 'no') then
    raise exception 'A resposta que aciona o campo deve ser SIM ou NÃO.' using errcode = 'invalid_parameter_value';
  end if;
  if length(v_label) < 3 or length(v_label) > 200 then
    raise exception 'O rótulo do campo condicional deve ter entre 3 e 200 caracteres.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_type not in ('text', 'single_select', 'multi_select') then
    raise exception 'Tipo de campo condicional não suportado pelo executor: %.', v_type
      using errcode = 'invalid_parameter_value';
  end if;

  if v_type <> 'text' then
    if jsonb_typeof(v_opts_in) <> 'array' then
      raise exception 'As opções devem ser uma lista.' using errcode = 'invalid_parameter_value';
    end if;
    for o in select value from jsonb_array_elements(v_opts_in) loop
      if jsonb_typeof(o) = 'string' then
        o_label := btrim(o #>> '{}');
        o_value := private.checklist_slug(o_label);
      else
        o_label := btrim(coalesce(o ->> 'label', ''));
        o_value := coalesce(nullif(btrim(coalesce(o ->> 'value', '')), ''), private.checklist_slug(o_label));
      end if;
      if o_label = '' or o_value is null then
        continue;
      end if;
      if v_opts @> jsonb_build_array(jsonb_build_object('value', o_value)) then
        raise exception 'Opção repetida: %.', o_label using errcode = 'invalid_parameter_value';
      end if;
      v_opts := v_opts || jsonb_build_array(jsonb_build_object('value', o_value, 'label', o_label));
    end loop;
    if jsonb_array_length(v_opts) < 2 then
      raise exception 'Um campo de escolha precisa de pelo menos duas opções.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_id is null then
    if exists (select 1 from public.checklist_question_conditionals where question_id = v_q.id) then
      raise exception 'Esta pergunta já possui um campo condicional. O executor apresenta um por pergunta: edite o existente.'
        using errcode = 'unique_violation';
    end if;
    v_key := coalesce(private.checklist_slug(nullif(p_payload ->> 'field_key', '')),
                      left(private.checklist_slug(v_label), 60));
    if v_key is null then
      raise exception 'Não foi possível derivar a chave do campo a partir do rótulo.'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public.checklist_question_conditionals
      (organization_id, version_id, question_id, field_key, trigger_answer, label, field_type,
       is_required, options, sort_order)
    values (p_organization_id, v.id, v_q.id, v_key, v_trigger, v_label, v_type, v_req, v_opts, 1)
    returning id into v_id;
  else
    select * into v_current from public.checklist_question_conditionals
     where id = v_id and question_id = v_q.id;
    if v_current.id is null then
      raise exception 'Campo condicional não encontrado nesta pergunta.' using errcode = 'no_data_found';
    end if;
    v_key := v_current.field_key;
    update public.checklist_question_conditionals
       set trigger_answer = v_trigger, label = v_label, field_type = v_type,
           is_required = v_req, options = v_opts, updated_at = now()
     where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'field_key', v_key, 'options', v_opts);
end;
$$;

revoke execute on function public.save_checklist_conditional(uuid, jsonb) from public, anon;
grant execute on function public.save_checklist_conditional(uuid, jsonb) to authenticated;

create or replace function public.delete_checklist_conditional(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
  v   public.checklist_app_versions;
begin
  select * into v_c from public.checklist_question_conditionals
   where id = nullif(p_payload ->> 'id', '')::uuid and organization_id = p_organization_id;
  if v_c.id is null then
    raise exception 'Campo condicional não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  v := private.checklist_editable_version(
         p_organization_id, v_c.version_id, 'applications.checklist_fleet.configure');

  delete from public.checklist_question_conditionals where id = v_c.id;
  return jsonb_build_object('id', v_c.id);
end;
$$;

revoke execute on function public.delete_checklist_conditional(uuid, jsonb) from public, anon;
grant execute on function public.delete_checklist_conditional(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Regras de aplicabilidade (§23, §45 "configurar aplicabilidade")
--
-- A tenancy do alvo é conferida AQUI (a FK de tipo e subcategoria é simples de
-- propósito, por causa dos tipos globais). Uma regra apontando para operação
-- de outra organização não passa.
-- -----------------------------------------------------------------------------
create or replace function public.save_checklist_rule(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         public.checklist_app_versions;
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_q       record;
  v_kind    text := nullif(p_payload ->> 'rule_kind', '');
  v_mode    text := coalesce(nullif(p_payload ->> 'mode', ''), 'include');
  v_target  uuid := nullif(p_payload ->> 'target_id', '')::uuid;
  v_guid    text := nullif(btrim(coalesce(p_payload ->> 'guidance', '')), '');
  v_type    uuid; v_sub uuid; v_op uuid;
  v_name    text;
begin
  select q.* into v_q from public.checklist_questions q
   where q.id = nullif(p_payload ->> 'question_id', '')::uuid and q.organization_id = p_organization_id;
  if v_q.id is null then
    raise exception 'Pergunta não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, v_q.version_id, 'applications.checklist_fleet.manage_rules');

  if v_kind not in ('vehicle_type', 'vehicle_subcategory', 'operation') then
    raise exception 'Tipo de regra inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_mode not in ('include', 'exclude', 'guidance') then
    raise exception 'Modo de regra inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_target is null then
    raise exception 'Informe o alvo da regra.' using errcode = 'invalid_parameter_value';
  end if;
  if v_mode = 'guidance' and v_guid is null then
    raise exception 'Uma regra de orientação precisa do texto orientativo.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_mode <> 'guidance' then
    v_guid := null;
  end if;

  if v_kind = 'vehicle_type' then
    select t.id, t.name into v_type, v_name from public.vehicle_types t
     where t.id = v_target and t.deleted_at is null
       and (t.organization_id = p_organization_id or t.organization_id is null);
    if v_type is null then
      raise exception 'Tipo de equipamento não encontrado nesta organização.' using errcode = 'no_data_found';
    end if;
  elsif v_kind = 'vehicle_subcategory' then
    select s.id, s.name into v_sub, v_name from public.vehicle_subcategories s
     where s.id = v_target and s.deleted_at is null
       and (s.organization_id = p_organization_id or s.organization_id is null);
    if v_sub is null then
      raise exception 'Subcategoria não encontrada nesta organização.' using errcode = 'no_data_found';
    end if;
  else
    select o.id, o.name into v_op, v_name from public.operations o
     where o.id = v_target and o.organization_id = p_organization_id and o.deleted_at is null;
    if v_op is null then
      raise exception 'Operação não encontrada nesta organização.' using errcode = 'no_data_found';
    end if;
  end if;

  begin
    if v_id is null then
      insert into public.checklist_question_rules
        (organization_id, version_id, question_id, rule_kind, mode,
         vehicle_type_id, vehicle_subcategory_id, operation_id, guidance, created_by)
      values (p_organization_id, v.id, v_q.id, v_kind, v_mode, v_type, v_sub, v_op, v_guid, auth.uid())
      returning id into v_id;
    else
      update public.checklist_question_rules
         set rule_kind = v_kind, mode = v_mode,
             vehicle_type_id = v_type, vehicle_subcategory_id = v_sub, operation_id = v_op,
             guidance = v_guid
       where id = v_id and question_id = v_q.id;
      if not found then
        raise exception 'Regra não encontrada nesta pergunta.' using errcode = 'no_data_found';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe uma regra desta pergunta para "%".', v_name
      using errcode = 'unique_violation';
  end;

  return jsonb_build_object('id', v_id, 'target_name', v_name);
end;
$$;

revoke execute on function public.save_checklist_rule(uuid, jsonb) from public, anon;
grant execute on function public.save_checklist_rule(uuid, jsonb) to authenticated;

create or replace function public.delete_checklist_rule(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r record;
  v   public.checklist_app_versions;
begin
  select * into v_r from public.checklist_question_rules
   where id = nullif(p_payload ->> 'id', '')::uuid and organization_id = p_organization_id;
  if v_r.id is null then
    raise exception 'Regra não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  v := private.checklist_editable_version(
         p_organization_id, v_r.version_id, 'applications.checklist_fleet.manage_rules');

  delete from public.checklist_question_rules where id = v_r.id;
  return jsonb_build_object('id', v_r.id);
end;
$$;

revoke execute on function public.delete_checklist_rule(uuid, jsonb) from public, anon;
grant execute on function public.delete_checklist_rule(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Operações habilitadas (§8, §46)
-- -----------------------------------------------------------------------------
create or replace function public.set_checklist_app_operation(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app     uuid;
  v_op      record;
  v_enabled boolean := coalesce((p_payload ->> 'is_enabled')::boolean, true);
begin
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.configure') then
    raise exception 'Você não possui permissão para configurar o Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  select a.id into v_app from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota' and a.deleted_at is null;
  if v_app is null then
    raise exception 'O aplicativo Check List de Frota não está cadastrado nesta organização.'
      using errcode = 'no_data_found';
  end if;

  select o.id, o.name into v_op from public.operations o
   where o.id = nullif(p_payload ->> 'operation_id', '')::uuid
     and o.organization_id = p_organization_id and o.deleted_at is null;
  if v_op.id is null then
    raise exception 'Operação não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled, created_by)
  values (p_organization_id, v_app, v_op.id, v_enabled, auth.uid())
  on conflict (app_id, operation_id) do update set is_enabled = excluded.is_enabled;

  return jsonb_build_object('operation_id', v_op.id, 'name', v_op.name, 'is_enabled', v_enabled);
end;
$$;

revoke execute on function public.set_checklist_app_operation(uuid, jsonb) from public, anon;
grant execute on function public.set_checklist_app_operation(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Validação da publicação (§46)
--
-- Devolve TODOS os problemas, não o primeiro. `errors` impede publicar;
-- `warnings` informa. O que o executor não sabe executar é erro.
-- -----------------------------------------------------------------------------
create or replace function public.validate_checklist_version(
  p_organization_id uuid,
  p_version_id      uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v          record;
  v_app      record;
  v_errors   jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_pub      uuid;
  r          record;
  n          integer;
  n_ops      integer;
  n_active   integer;
  n_inactive integer;
  n_cond     integer;
  n_rules    integer;
  n_crit     integer;
begin
  if not (private.has_permission(p_organization_id, 'applications.checklist_fleet.configure')
          or private.has_permission(p_organization_id, 'applications.checklist_fleet.publish')
          or private.has_permission(p_organization_id, 'applications.checklist_fleet.create_version')) then
    raise exception 'Você não possui permissão para validar versões do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.checklist_app_versions
   where id = p_version_id and organization_id = p_organization_id;
  if v.id is null then
    raise exception 'Versão não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  select a.id, a.is_active, a.allows_attachments into v_app
    from public.operational_apps a where a.id = v.app_id;

  select v2.id into v_pub from public.checklist_app_versions v2
   where v2.app_id = v.app_id and v2.status = 'published' and v2.id <> v.id
   order by v2.major desc, v2.minor desc limit 1;

  -- Clusters
  select count(*) into n from public.checklist_clusters where version_id = v.id;
  if n = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_clusters',
      'message', 'A versão não possui nenhum cluster.');
  end if;

  if exists (
    select 1 from (select sort_order, row_number() over (order by sort_order) as rn
                     from public.checklist_clusters where version_id = v.id) s
     where s.sort_order <> s.rn) then
    v_errors := v_errors || jsonb_build_object('code', 'ordem_clusters',
      'message', 'A ordem dos clusters possui lacunas. Reordene os clusters.');
  end if;

  for r in
    select c.id, c.name,
           (select count(*) from public.checklist_questions q where q.cluster_id = c.id and q.status = 'active') as ativas,
           (select count(*) from public.checklist_questions q where q.cluster_id = c.id) as total
      from public.checklist_clusters c where c.version_id = v.id order by c.sort_order
  loop
    if r.ativas = 0 then
      v_errors := v_errors || jsonb_build_object('code', 'cluster_vazio', 'cluster_id', r.id,
        'message', format('O cluster "%s" não possui pergunta ativa.', r.name));
    end if;
    if exists (
      select 1 from (select sort_order, row_number() over (order by sort_order) as rn
                       from public.checklist_questions where cluster_id = r.id) s
       where s.sort_order <> s.rn) then
      v_errors := v_errors || jsonb_build_object('code', 'ordem_perguntas', 'cluster_id', r.id,
        'message', format('A ordem das perguntas do cluster "%s" possui lacunas. Reordene as perguntas.', r.name));
    end if;
  end loop;

  -- Perguntas
  select count(*) filter (where status = 'active'), count(*) filter (where status <> 'active'),
         count(*) filter (where status = 'active' and criticality = 'critica')
    into n_active, n_inactive, n_crit
    from public.checklist_questions where version_id = v.id;

  if n_active = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_perguntas',
      'message', 'A versão não possui nenhuma pergunta ativa.');
  end if;

  for r in
    select q.*, c.name as cluster_name from public.checklist_questions q
      join public.checklist_clusters c on c.id = q.cluster_id
     where q.version_id = v.id order by c.sort_order, q.sort_order
  loop
    if r.answer_type <> 'yes_no' then
      v_errors := v_errors || jsonb_build_object('code', 'tipo_resposta', 'question_id', r.id,
        'message', format('"%s": o executor não executa o tipo de resposta "%s".', left(r.question_text, 60), r.answer_type));
    end if;
    if r.conforming_answer not in ('yes', 'no') then
      v_errors := v_errors || jsonb_build_object('code', 'resposta_conforme', 'question_id', r.id,
        'message', format('"%s": resposta conforme inválida.', left(r.question_text, 60)));
    end if;
    if r.criticality not in ('media', 'critica') then
      v_errors := v_errors || jsonb_build_object('code', 'criticidade', 'question_id', r.id,
        'message', format('"%s": criticidade inválida.', left(r.question_text, 60)));
    end if;
    if length(btrim(r.question_text)) < 3 or length(btrim(r.question_text)) > 500 then
      v_errors := v_errors || jsonb_build_object('code', 'texto', 'question_id', r.id,
        'message', format('"%s": o texto deve ter entre 3 e 500 caracteres.', left(r.question_text, 60)));
    end if;
    if r.question_key !~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' then
      v_errors := v_errors || jsonb_build_object('code', 'identidade', 'question_id', r.id,
        'message', format('"%s": identidade técnica inválida (%s).', left(r.question_text, 60), r.question_key));
    end if;
    if r.note_required and not r.allows_note then
      v_errors := v_errors || jsonb_build_object('code', 'observacao', 'question_id', r.id,
        'message', format('"%s": exige observação mas não permite observação.', left(r.question_text, 60)));
    end if;

    select count(*) into n from public.checklist_question_conditionals where question_id = r.id;
    if n > 1 then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_multiplo', 'question_id', r.id,
        'message', format('"%s": possui %s campos condicionais; o executor apresenta um por pergunta.', left(r.question_text, 60), n));
    end if;
  end loop;

  -- Condicionais
  select count(*) into n_cond from public.checklist_question_conditionals where version_id = v.id;
  for r in
    select cd.*, q.question_text from public.checklist_question_conditionals cd
      join public.checklist_questions q on q.id = cd.question_id
     where cd.version_id = v.id
  loop
    if r.field_type not in ('text', 'single_select', 'multi_select') then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_tipo', 'question_id', r.question_id,
        'message', format('"%s": o executor não executa campo condicional do tipo "%s".', left(r.question_text, 60), r.field_type));
    end if;
    if r.trigger_answer not in ('yes', 'no') then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_gatilho', 'question_id', r.question_id,
        'message', format('"%s": resposta que aciona o campo inválida.', left(r.question_text, 60)));
    end if;
    if r.field_type = 'text' and jsonb_array_length(r.options) <> 0 then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
        'message', format('"%s": campo de texto não pode ter opções.', left(r.question_text, 60)));
    end if;
    if r.field_type <> 'text' then
      if jsonb_array_length(r.options) < 2 then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": o campo de escolha precisa de pelo menos duas opções.', left(r.question_text, 60)));
      end if;
      if exists (select 1 from jsonb_array_elements(r.options) o
                  where nullif(btrim(coalesce(o ->> 'value', '')), '') is null
                     or nullif(btrim(coalesce(o ->> 'label', '')), '') is null) then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": há opção sem valor ou sem rótulo.', left(r.question_text, 60)));
      end if;
      if (select count(*) from jsonb_array_elements(r.options) o) <>
         (select count(distinct o ->> 'value') from jsonb_array_elements(r.options) o) then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": há opções com o mesmo valor.', left(r.question_text, 60)));
      end if;
    end if;
  end loop;

  -- Regras
  select count(*) into n_rules from public.checklist_question_rules where version_id = v.id;
  for r in
    select ru.*, q.question_text,
           t.deleted_at as type_deleted, s.deleted_at as sub_deleted, o.deleted_at as op_deleted,
           t.organization_id as type_org, s.organization_id as sub_org, o.organization_id as op_org,
           coalesce(t.name, s.name, o.name) as target_name,
           (select ao.is_enabled from public.checklist_app_operations ao
             where ao.app_id = v.app_id and ao.operation_id = ru.operation_id) as op_enabled
      from public.checklist_question_rules ru
      join public.checklist_questions q on q.id = ru.question_id
      left join public.vehicle_types t on t.id = ru.vehicle_type_id
      left join public.vehicle_subcategories s on s.id = ru.vehicle_subcategory_id
      left join public.operations o on o.id = ru.operation_id
     where ru.version_id = v.id
  loop
    if r.target_name is null
       or r.type_deleted is not null or r.sub_deleted is not null or r.op_deleted is not null
       or (r.type_org is not null and r.type_org <> p_organization_id)
       or (r.sub_org is not null and r.sub_org <> p_organization_id)
       or (r.op_org is not null and r.op_org <> p_organization_id) then
      v_errors := v_errors || jsonb_build_object('code', 'regra_alvo', 'question_id', r.question_id,
        'message', format('"%s": há regra apontando para %s inexistente ou excluído.', left(r.question_text, 60),
          case r.rule_kind when 'vehicle_type' then 'tipo de equipamento'
                           when 'vehicle_subcategory' then 'subcategoria' else 'operação' end));
    end if;
    if r.mode = 'guidance' and nullif(btrim(coalesce(r.guidance, '')), '') is null then
      v_errors := v_errors || jsonb_build_object('code', 'regra_orientacao', 'question_id', r.question_id,
        'message', format('"%s": regra de orientação sem texto.', left(r.question_text, 60)));
    end if;
    if r.rule_kind = 'operation' and coalesce(r.op_enabled, false) = false then
      v_warnings := v_warnings || jsonb_build_object('code', 'regra_operacao_desabilitada', 'question_id', r.question_id,
        'message', format('"%s": a regra aponta para a operação "%s", que não está habilitada para o aplicativo.', left(r.question_text, 60), r.target_name));
    end if;
  end loop;

  -- Operações habilitadas
  select count(*) into n_ops
    from public.checklist_app_operations ao
    join public.operations o on o.id = ao.operation_id
   where ao.app_id = v.app_id and ao.is_enabled and o.deleted_at is null and o.status = 'active';
  if n_ops = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_operacoes',
      'message', 'Nenhuma operação ativa está habilitada para o aplicativo.');
  end if;

  -- Compatibilidade com o executor (§26, §39)
  if coalesce(v_app.allows_attachments, false) then
    v_errors := v_errors || jsonb_build_object('code', 'anexos',
      'message', 'O aplicativo está marcado para permitir anexos; o Check List de Frota não admite anexos e o executor não os executa.');
  end if;
  if v.min_duration_seconds < 0 or v.max_duration_seconds <= v.min_duration_seconds then
    v_errors := v_errors || jsonb_build_object('code', 'duracao',
      'message', 'Os limites de tempo são inválidos: o máximo deve ser maior que o mínimo.');
  end if;
  if v.max_duration_seconds > 3600 then
    v_warnings := v_warnings || jsonb_build_object('code', 'duracao_longa',
      'message', 'O tempo máximo é maior que uma hora.');
  end if;
  if not coalesce(v_app.is_active, false) then
    v_warnings := v_warnings || jsonb_build_object('code', 'app_inativo',
      'message', 'O aplicativo está inativo: a versão pode ser publicada, mas ninguém a executará até a reativação.');
  end if;

  -- Avisos informativos
  if n_crit = 0 and n_active > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'sem_criticas',
      'message', 'Nenhuma pergunta ativa é crítica.');
  end if;
  if n_inactive > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'perguntas_inativas',
      'message', format('%s pergunta(s) inativa(s) não serão apresentadas ao motorista.', n_inactive));
  end if;

  -- §47: comparabilidade com a versão publicada — identidades que somem e que nascem.
  if v_pub is not null then
    select count(*) into n from public.checklist_questions pq
     where pq.version_id = v_pub and pq.status = 'active'
       and not exists (select 1 from public.checklist_questions dq
                        where dq.version_id = v.id and dq.question_key = pq.question_key and dq.status = 'active');
    if n > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'identidades_retiradas',
        'message', format('%s pergunta(s) ativa(s) na versão publicada não seguem ativas nesta versão; o histórico delas fica preservado, mas a comparação futura para.', n));
    end if;
    select count(*) into n from public.checklist_questions dq
     where dq.version_id = v.id and dq.status = 'active'
       and not exists (select 1 from public.checklist_questions pq
                        where pq.version_id = v_pub and pq.question_key = dq.question_key);
    if n > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'identidades_novas',
        'message', format('%s pergunta(s) com identidade nova: passam a ser medidas a partir desta versão.', n));
    end if;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'version_id', v.id,
    'label', v.label,
    'status', v.status,
    'errors', v_errors,
    'warnings', v_warnings,
    'summary', jsonb_build_object(
      'clusters', (select count(*) from public.checklist_clusters where version_id = v.id),
      'questions_active', n_active,
      'questions_inactive', n_inactive,
      'conditionals', n_cond,
      'rules', n_rules,
      'operations_enabled', n_ops,
      'answer_types', (select coalesce(jsonb_agg(distinct answer_type), '[]'::jsonb)
                         from public.checklist_questions where version_id = v.id),
      'allows_attachments', coalesce(v_app.allows_attachments, false)));
end;
$$;

revoke execute on function public.validate_checklist_version(uuid, uuid) from public, anon;
grant execute on function public.validate_checklist_version(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Publicar (§43, §46)
--
-- Na mesma transação: valida, arquiva a publicada atual e publica o rascunho.
-- Um checklist já iniciado sob a versão anterior continua nela (§48): é a
-- rotina de envio que aceita a versão do formulário aberto.
-- -----------------------------------------------------------------------------
create or replace function public.publish_checklist_version(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v          public.checklist_app_versions;
  v_check    jsonb;
  v_prev     record;
  v_msgs     text;
begin
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.publish') then
    raise exception 'Você não possui permissão para publicar versões do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  v := private.checklist_editable_version(
         p_organization_id, nullif(p_payload ->> 'version_id', '')::uuid,
         'applications.checklist_fleet.publish');

  -- Trava o aplicativo: duas publicações simultâneas não podem cruzar.
  perform 1 from public.operational_apps a where a.id = v.app_id for update;

  v_check := public.validate_checklist_version(p_organization_id, v.id);
  if (v_check ->> 'ok')::boolean is distinct from true then
    select string_agg(e ->> 'message', ' ') into v_msgs
      from (select e from jsonb_array_elements(v_check -> 'errors') e limit 3) s;
    raise exception 'A versão % não pode ser publicada: %', v.label, v_msgs
      using errcode = 'invalid_parameter_value';
  end if;

  select v2.id, v2.label into v_prev from public.checklist_app_versions v2
   where v2.app_id = v.app_id and v2.status = 'published';

  if v_prev.id is not null then
    update public.checklist_app_versions
       set status = 'archived', updated_at = now(), updated_by = auth.uid()
     where id = v_prev.id;
  end if;

  update public.checklist_app_versions
     set status = 'published', published_at = now(), published_by = auth.uid(),
         updated_at = now(), updated_by = auth.uid()
   where id = v.id;

  return jsonb_build_object(
    'id', v.id, 'label', v.label,
    'archived_id', v_prev.id, 'archived_label', v_prev.label,
    'published_at', now(),
    'warnings', v_check -> 'warnings');
end;
$$;

revoke execute on function public.publish_checklist_version(uuid, jsonb) from public, anon;
grant execute on function public.publish_checklist_version(uuid, jsonb) to authenticated;
