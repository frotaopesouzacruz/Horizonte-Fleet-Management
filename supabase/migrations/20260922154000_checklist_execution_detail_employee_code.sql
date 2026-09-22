-- =============================================================================
-- Etapa 12 · Refinamento — detalhe da execução traz a matrícula (§60)
--
-- O detalhe do checklist (gaveta de leitura do histórico) mostra "Matrícula X ·
-- Saída para rota · versão N". A rotina de leitura devolvia o nome do
-- colaborador, mas não a matrícula. Só acrescenta a chave `employee_code`;
-- nada mais muda. Continua `security invoker`: a RLS das execuções decide o
-- que cada um enxerga (própria execução ou escopo com `view_details`).
-- =============================================================================

create or replace function public.checklist_execution_detail(p_execution_id uuid)
returns jsonb
language sql
stable
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
    'employee_code', emp.employee_code,
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

comment on function public.checklist_execution_detail(uuid) is
  'Detalhe de uma execução do Check List de Frota (cabeçalho, KPIs, clusters e respostas). Security invoker: a RLS de checklist_executions decide a visibilidade. Inclui employee_code (matrícula) desde o refinamento da Etapa 12.';
