-- =============================================================================
-- Etapa 12 — leituras do aplicativo (§29, §32, §33, §59, §60)
--
-- Todas `security invoker`: a RLS decide o que cada pessoa vê, e a tela não
-- recebe nada que ela não pudesse consultar diretamente.
-- =============================================================================

-- O que a tela inicial precisa saber, em uma ida só.
create or replace function public.checklist_fleet_context(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_app     record;
  v_version record;
  v_actor   record;
begin
  select a.id, a.name, a.slug, a.is_active, a.allows_attachments into v_app
    from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
     and a.deleted_at is null;

  if v_app.id is null then
    return jsonb_build_object('available', false, 'reason', 'nao_cadastrado');
  end if;

  select v.id, v.label, v.min_duration_seconds, v.max_duration_seconds into v_version
    from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc limit 1;

  select * into v_actor from private.checklist_actor(p_organization_id);

  return jsonb_build_object(
    'available', v_app.is_active and v_version.id is not null,
    'reason', case when not v_app.is_active then 'inativo'
                   when v_version.id is null then 'sem_versao' else null end,
    'app', jsonb_build_object('id', v_app.id, 'name', v_app.name,
                              'allows_attachments', v_app.allows_attachments),
    'version', case when v_version.id is null then null else jsonb_build_object(
                 'id', v_version.id, 'label', v_version.label,
                 'min_duration_seconds', v_version.min_duration_seconds,
                 'max_duration_seconds', v_version.max_duration_seconds) end,
    'actor', case when v_actor.employee_id is null then null else jsonb_build_object(
               'employee_id', v_actor.employee_id,
               'name', v_actor.employee_name,
               'employee_code', v_actor.employee_code) end,
    -- §32: só as operações do escopo, e só onde o aplicativo está habilitado.
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object('id', op.id, 'name', op.name) order by op.name)
        from public.operations op
        join public.checklist_app_operations ao
          on ao.operation_id = op.id and ao.app_id = v_app.id and ao.is_enabled
       where op.organization_id = p_organization_id and op.deleted_at is null
         and op.status = 'active'
         and private.can_access_operation(op.id)
    ), '[]'::jsonb));
end;
$$;

revoke execute on function public.checklist_fleet_context(uuid) from public, anon;
grant execute on function public.checklist_fleet_context(uuid) to authenticated;

-- §33: escolher o veículo. A fidelização sugere o previsto, mas planejamento
-- incompleto não impede o checklist — por isso a lista não se limita a ele.
create or replace function public.checklist_vehicle_options(
  p_organization_id uuid,
  p_operation_id    uuid,
  p_search          text default null,
  p_date            date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (select coalesce(p_date, current_date) as dia),
  base as (
    select v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_subcategory_id,
           t.name as vehicle_type_name,
           b.id as operation_br_id, b.code as br_code,
           (fa.id is not null) as previsto
      from public.vehicles v
      join public.vehicle_types t on t.id = v.vehicle_type_id
      cross join d
      left join public.fidelization_assignments fa
        on fa.vehicle_id = v.id and fa.organization_id = v.organization_id
       and fa.vehicle_role = 'primary' and fa.status <> 'cancelled'
       and fa.start_date <= d.dia and (fa.end_date is null or fa.end_date >= d.dia)
      left join public.operation_brs b on b.id = fa.operation_br_id
     where v.organization_id = p_organization_id
       and v.deleted_at is null and v.status = 'active'
       and (p_search is null or btrim(p_search) = ''
            or v.license_plate ilike '%' || btrim(p_search) || '%'
            or v.fleet_code ilike '%' || btrim(p_search) || '%')
  )
  select coalesce(jsonb_agg(x order by x ->> 'sort_key'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', base.id,
               'license_plate', base.license_plate,
               'fleet_code', base.fleet_code,
               'vehicle_type_name', base.vehicle_type_name,
               'operation_br_id', base.operation_br_id,
               'br_code', base.br_code,
               'expected', base.previsto,
               'sort_key', case when base.previsto then '0' else '1' end
                           || coalesce(base.license_plate, base.fleet_code, '')
             ) as x
        from base
       limit 100
    ) s;
$$;

revoke execute on function public.checklist_vehicle_options(uuid, uuid, text, date) from public, anon;
grant execute on function public.checklist_vehicle_options(uuid, uuid, text, date) to authenticated;

-- §59: Meus Checklists.
create or replace function public.checklist_my_executions(
  p_organization_id uuid,
  p_limit           integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'operational_date', e.operational_date,
           'checklist_type', e.checklist_type,
           'license_plate', e.license_plate_snapshot,
           'fleet_code', e.fleet_code_snapshot,
           'operation_name', op.name,
           'br_code', b.code,
           'submitted_at', e.submitted_at,
           'duration_seconds', e.duration_seconds,
           'applicable', e.applicable_questions,
           'conforming', e.conforming_answers,
           'non_conforming', e.non_conforming_answers,
           'critical_non_conforming', e.critical_non_conforming,
           'status', e.status
         ) order by e.operational_date desc, e.submitted_at desc), '[]'::jsonb)
    from (
      select * from public.checklist_executions
       where organization_id = p_organization_id and status = 'submitted'
       order by operational_date desc, submitted_at desc
       limit greatest(1, least(p_limit, 200))
    ) e
    join public.operations op on op.id = e.operation_id
    left join public.operation_brs b on b.id = e.operation_br_id;
$$;

revoke execute on function public.checklist_my_executions(uuid, integer) from public, anon;
grant execute on function public.checklist_my_executions(uuid, integer) to authenticated;

-- §60: o detalhe de uma execução, sem permitir edição.
create or replace function public.checklist_execution_detail(p_execution_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'operational_date', e.operational_date,
    'checklist_type', e.checklist_type,
    'license_plate', e.license_plate_snapshot,
    'fleet_code', e.fleet_code_snapshot,
    'operation_name', op.name,
    'br_code', b.code,
    'city_name', ci.name,
    'state_uf', st.uf,
    'version_label', ver.label,
    'employee_name', emp.full_name,
    'leader_name', led.full_name,
    'started_at', e.started_at,
    'submitted_at', e.submitted_at,
    'duration_seconds', e.duration_seconds,
    'applicable', e.applicable_questions,
    'conforming', e.conforming_answers,
    'non_conforming', e.non_conforming_answers,
    'critical_non_conforming', e.critical_non_conforming,
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cluster_key', ec.cluster_key,
               'name', ec.cluster_name,
               'applicable', ec.applicable_questions,
               'non_conforming', ec.non_conforming,
               'answers', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'question_key', an.question_key,
                          'text', an.question_text_snapshot,
                          'answer', an.answer,
                          'is_conforming', an.is_conforming,
                          'criticality', an.criticality,
                          'conditional_value', an.conditional_value,
                          'note', an.note) order by an.question_key)
                   from public.checklist_execution_answers an
                  where an.execution_id = e.id and an.cluster_key = ec.cluster_key
               ), '[]'::jsonb)
             ) order by ec.sort_order)
        from public.checklist_execution_clusters ec
       where ec.execution_id = e.id
    ), '[]'::jsonb))
    from public.checklist_executions e
    join public.operations op on op.id = e.operation_id
    join public.checklist_app_versions ver on ver.id = e.version_id
    join public.employees emp on emp.id = e.employee_id
    left join public.operation_brs b on b.id = e.operation_br_id
    left join public.cities ci on ci.id = e.city_id
    left join public.states st on st.id = e.state_id
    left join public.employees led on led.id = e.leader_employee_id
   where e.id = p_execution_id;
$$;

revoke execute on function public.checklist_execution_detail(uuid) from public, anon;
grant execute on function public.checklist_execution_detail(uuid) to authenticated;
