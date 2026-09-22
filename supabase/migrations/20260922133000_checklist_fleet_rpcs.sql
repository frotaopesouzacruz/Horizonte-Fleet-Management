-- =============================================================================
-- Etapa 12 — rotinas de leitura e resolução do Check List de Frota
--
-- Três funções carregam o peso da etapa:
--
--   private.checklist_actor          quem está executando, resolvido da SESSÃO
--   private.checklist_question_applies  a aplicabilidade por VÍNCULO (§23)
--   public.checklist_fleet_form      o formulário que ESTE veículo responde
--
-- A segunda é a que substitui o `tipo.includes("caminh")` do HFC por um id.
-- =============================================================================

-- §39: os limites de tempo são configuração da versão, não número solto no código.
alter table public.checklist_app_versions
  add column if not exists min_duration_seconds integer not null default 60,
  add column if not exists max_duration_seconds integer not null default 600;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_versions_duration_check') then
    alter table public.checklist_app_versions
      add constraint checklist_versions_duration_check
      check (min_duration_seconds >= 0 and max_duration_seconds > min_duration_seconds);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- private.checklist_actor — §31
--
-- A matrícula NUNCA vem do payload. Quem responde é o colaborador vinculado à
-- sessão; deixar o cliente informar `employee_id` seria permitir que alguém
-- fizesse checklist no nome de outra pessoa com uma requisição alterada.
-- -----------------------------------------------------------------------------
create or replace function private.checklist_actor(p_organization_id uuid)
returns table (user_id uuid, employee_id uuid, employee_name text, employee_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.employee_id, e.full_name, e.employee_code
    from public.organization_memberships m
    join public.employees e on e.id = m.employee_id
   where m.organization_id = p_organization_id
     and m.user_id = auth.uid()
     and m.status = 'active'
     and m.employee_id is not null
   limit 1;
$$;

grant execute on function private.checklist_actor(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.checklist_question_applies — §23
--
-- SEMÂNTICA, por eixo (tipo, subcategoria, operação), independente:
--   · uma regra `exclude` que casa       -> não se aplica;
--   · existindo regra `include` no eixo  -> tem de casar uma;
--   · sem nenhuma regra no eixo          -> o eixo não restringe.
--
-- `guidance` não é lido aqui de propósito: orientação orienta, não restringe.
-- -----------------------------------------------------------------------------
create or replace function private.checklist_question_applies(
  p_question_id            uuid,
  p_vehicle_type_id        uuid,
  p_vehicle_subcategory_id uuid,
  p_operation_id           uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k       text;
  alvo    uuid;
  tem_inc boolean;
  casa    boolean;
begin
  foreach k in array array['vehicle_type', 'vehicle_subcategory', 'operation'] loop
    alvo := case k
              when 'vehicle_type'        then p_vehicle_type_id
              when 'vehicle_subcategory' then p_vehicle_subcategory_id
              else p_operation_id
            end;

    if alvo is not null and exists (
      select 1 from public.checklist_question_rules r
       where r.question_id = p_question_id and r.rule_kind = k and r.mode = 'exclude'
         and coalesce(r.vehicle_type_id, r.vehicle_subcategory_id, r.operation_id) = alvo
    ) then
      return false;
    end if;

    select exists (
      select 1 from public.checklist_question_rules r
       where r.question_id = p_question_id and r.rule_kind = k and r.mode = 'include'
    ) into tem_inc;

    if tem_inc then
      if alvo is null then
        return false;
      end if;
      select exists (
        select 1 from public.checklist_question_rules r
         where r.question_id = p_question_id and r.rule_kind = k and r.mode = 'include'
           and coalesce(r.vehicle_type_id, r.vehicle_subcategory_id, r.operation_id) = alvo
      ) into casa;
      if not casa then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

grant execute on function private.checklist_question_applies(uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.checklist_fleet_form — §24
--
-- Devolve a versão publicada com clusters e perguntas já filtrados. O executor
-- não recebe as 34 perguntas para esconder algumas no navegador: o que não se
-- aplica não chega, e por isso não há como ser contado como pendente.
-- -----------------------------------------------------------------------------
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
  v_result  jsonb;
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

  select jsonb_build_object(
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
    'clusters', coalesce((
      select jsonb_agg(c ORDER BY c ->> 'sort_order')
        from (
          select jsonb_build_object(
                   'id', cl.id,
                   'cluster_key', cl.cluster_key,
                   'name', cl.name,
                   'sort_order', lpad(cl.sort_order::text, 3, '0'),
                   'is_required', cl.is_required,
                   'questions', coalesce((
                     select jsonb_agg(q ORDER BY q ->> 'sort_order')
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
                                  qu.id, v_vehicle.vehicle_type_id,
                                  v_vehicle.vehicle_subcategory_id, p_operation_id)
                       ) s
                   ), '[]'::jsonb)
                 ) as c
            from public.checklist_clusters cl
           where cl.version_id = v_version.id
        ) t
       where c -> 'questions' <> '[]'::jsonb
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.checklist_fleet_form(uuid, uuid, uuid) from public, anon;
grant execute on function public.checklist_fleet_form(uuid, uuid, uuid) to authenticated;
