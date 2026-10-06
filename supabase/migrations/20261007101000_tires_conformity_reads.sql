-- =============================================================================
-- Gestão de Pneus — definições centralizadas de conformidade e leituras
-- gerenciais (Visão Geral, Prioridades, Aderências, Base Geral agrupada)
--
-- Uma definição, um lugar. Toda tela, exportação e captura de indicadores usa
-- as funções abaixo — nenhuma página replica fórmula:
--
--   Sulco OK (MM conforme) ......... classe do sulco adequado ou atenção
--                                    (acima do crítico e do legal da regra)
--   Prazo de medição OK ............ medição em dia ou próxima do vencimento
--   Prazo de calibragem OK ......... calibragem em dia ou próxima do vencimento
--   PSI OK ......................... PSI dentro da faixa da regra aplicável
--                                    (sem regra = sem parâmetro ≠ adequado)
--   Conformidade Geral de Calibragem  Prazo de calibragem OK E PSI OK
--   Conformidade Geral dos Pneus .... Sulco OK E Prazo de medição OK E
--                                    Prazo de calibragem OK E PSI OK
--
-- Base de todos os percentuais de conformidade: pneus EM USO. Sem registro
-- (sem medição, sem calibragem, sem parâmetro) conta como não conforme e
-- aparece separado como lacuna — nada é escondido do denominador. A
-- "aderência" das telas antigas passa a usar a mesma base.
--
-- Criticidade (Crítico/Alto/Médio/Baixo) = a severidade já documentada de
-- private.tire_rows (pontuação por regra objetiva: sulco legal/crítico/atenção,
-- prazos vencidos/sem registro/próximos, PSI fora, divergência de sulco,
-- alerta de ressolagem): crítica ≥ 100, alta ≥ 50, média ≥ 20, baixa > 0.
--
-- Aditiva: só `create or replace` (mesmas assinaturas) e funções novas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Definições (imutáveis, testáveis isoladamente)
-- -----------------------------------------------------------------------------
create or replace function private.tire_mm_ok(p_tread_class text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_tread_class in ('adequado', 'atencao'), false);
$$;

create or replace function private.tire_deadline_ok(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_status in ('em_dia', 'proximo'), false);
$$;

create or replace function private.tire_psi_ok(p_psi_status text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_psi_status = 'adequada', false);
$$;

create or replace function private.tire_calibration_conform(p_calibration_status text, p_psi_status text)
returns boolean language sql immutable set search_path = '' as $$
  select private.tire_deadline_ok(p_calibration_status) and private.tire_psi_ok(p_psi_status);
$$;

create or replace function private.tire_overall_conform(p_tread_class text, p_measurement_status text, p_calibration_status text, p_psi_status text)
returns boolean language sql immutable set search_path = '' as $$
  select private.tire_mm_ok(p_tread_class) and private.tire_deadline_ok(p_measurement_status)
     and private.tire_deadline_ok(p_calibration_status) and private.tire_psi_ok(p_psi_status);
$$;

-- Motivos da não conformidade (um código por critério que falhou), na ordem
-- Sulco → Prazo de medição → Prazo de calibragem → PSI.
create or replace function private.tire_nonconformity_reasons(p_tread_class text, p_measurement_status text, p_calibration_status text, p_psi_status text)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case p_tread_class when 'abaixo_legal' then 'sulco_abaixo_legal' when 'critico' then 'sulco_critico'
                       when 'sem_medicao' then 'sulco_sem_medicao' end,
    case p_measurement_status when 'vencido' then 'medicao_vencida' when 'sem_registro' then 'medicao_sem_registro' end,
    case p_calibration_status when 'vencido' then 'calibragem_vencida' when 'sem_registro' then 'calibragem_sem_registro' end,
    case p_psi_status when 'baixa' then 'psi_baixa' when 'excesso' then 'psi_excesso' when 'sem_parametro' then 'psi_sem_parametro'
                      when 'sem_calibragem' then 'psi_sem_leitura' end], null);
$$;

create or replace function private.tire_criticality(p_severity text)
returns text language sql immutable set search_path = '' as $$
  select case p_severity when 'critica' then 'critico' when 'alta' then 'alto' when 'media' then 'medio'
                         when 'baixa' then 'baixo' else 'ok' end;
$$;

comment on function private.tire_overall_conform(text, text, text, text) is
  'Conformidade Geral dos Pneus: Sulco OK E Prazo de medição OK E Prazo de calibragem OK E PSI OK. Fonte única para telas, exportações e indicadores.';
comment on function private.tire_calibration_conform(text, text) is
  'Conformidade Geral de Calibragem: Prazo de calibragem OK E PSI OK. Calibragem no prazo com pressão inadequada NÃO é conforme.';

-- Definições + parâmetros vigentes, para a tela "Como calculamos"
create or replace function public.tires_definitions(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.tire_parameter_sets;
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  p := private.tire_params_at(p_organization_id, private.maintenance_today(p_organization_id));
  return jsonb_build_object(
    'parameters', jsonb_build_object(
      'measurement_ok_days', p.measurement_ok_days, 'measurement_warning_days', p.measurement_warning_days,
      'calibration_ok_days', p.calibration_ok_days, 'calibration_warning_days', p.calibration_warning_days,
      'tread_critical_mm', p.tread_critical_mm, 'tread_attention_mm', p.tread_attention_mm,
      'effective_from', p.effective_from),
    'definitions', jsonb_build_array(
      jsonb_build_object('key', 'em_uso', 'label', 'Pneu em uso', 'text', 'Situação Rodopar "em uso" (montado em uma frota). Base de todos os percentuais de conformidade.'),
      jsonb_build_object('key', 'fora_da_frota', 'label', 'Fora da frota', 'text', 'Qualquer situação diferente de em uso: estoque, ressolagem/manutenção, descartado, baixado ou outra.'),
      jsonb_build_object('key', 'disponivel', 'label', 'Disponível', 'text', 'Em estoque com sulco adequado ou em atenção (apto para montagem).'),
      jsonb_build_object('key', 'medicao_valida', 'label', 'Medição válida', 'text', format('Medição com data registrada há no máximo %s dias (em dia até %s dias; próxima do vencimento de %s a %s dias).', p.measurement_warning_days, p.measurement_ok_days, p.measurement_ok_days + 1, p.measurement_warning_days)),
      jsonb_build_object('key', 'calibragem_valida', 'label', 'Calibragem válida (prazo)', 'text', format('Calibragem com data registrada há no máximo %s dias (em dia até %s dias; próxima do vencimento de %s a %s dias).', p.calibration_warning_days, p.calibration_ok_days, p.calibration_ok_days + 1, p.calibration_warning_days)),
      jsonb_build_object('key', 'prazo_vencido', 'label', 'Prazo vencido', 'text', 'Última data além do limite de "próximo do vencimento"; os dias de atraso contam a partir desse limite.'),
      jsonb_build_object('key', 'proximo_vencimento', 'label', 'Próximo do vencimento', 'text', 'Ainda dentro do prazo, entre o limite de "em dia" e o de vencimento — conta como prazo OK.'),
      jsonb_build_object('key', 'mm_conforme', 'label', 'Sulco OK (MM conforme)', 'text', format('Menor sulco acima do crítico (%s mm) e do mínimo legal da regra da dimensão/posição. Sem medição = não conforme.', p.tread_critical_mm)),
      jsonb_build_object('key', 'psi_conforme', 'label', 'PSI OK', 'text', 'PSI entre o mínimo e o máximo da regra mais específica (dimensão > posição > eixo > tipo). Sem regra = sem parâmetro (nunca adequado); sem leitura = não conforme. Não existe PSI universal.'),
      jsonb_build_object('key', 'calibragem_conforme', 'label', 'Conformidade Geral de Calibragem', 'text', 'Prazo de calibragem OK E PSI OK. Calibragem feita no prazo com pressão inadequada não é conforme.'),
      jsonb_build_object('key', 'pneu_conforme', 'label', 'Conformidade Geral dos Pneus', 'text', 'Sulco OK E Prazo de medição OK E Prazo de calibragem OK E PSI OK. Basta um critério falhar para o pneu ser não conforme.'),
      jsonb_build_object('key', 'criticidade', 'label', 'Criticidade', 'text', 'Pontuação objetiva por pneu em uso: sulco abaixo do legal 120, crítico 100+, atenção 40; prazo vencido 30, sem registro 20, próximo 10 (medição e calibragem); PSI fora 25, sem parâmetro 5; divergência de sulco 12; alerta de ressolagem 15. Crítico ≥ 100, Alto ≥ 50, Médio ≥ 20, Baixo > 0.')));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Recortes novos em private.tire_rows (conformidade geral/de calibragem e
--    grupos sem operação/local/liderança) — mesma assinatura
-- -----------------------------------------------------------------------------
create or replace function private.tire_rows(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_as_of date default null)
returns table (
  snapshot_id uuid, tire_id uuid, fire_number text, reference_date date, import_batch_id uuid,
  canonical_status text, rodopar_status_raw text, rodopar_status_label text, rodopar_condition text,
  brand text, model text, dimension text, dimension_key text, serial_number text, dot text, drawing text, rubber text,
  life smallint, position_code text, position_label text, position_sort smallint, axle_group text,
  vehicle_id uuid, license_plate text, fleet_number text, fleet_number_raw text, vehicle_type_id uuid, vehicle_type_name text,
  context_source text, operation_id uuid, operation_name text, operation_city_id uuid,
  state_id smallint, state_uf text, city_id integer, city_name text,
  operation_br_id uuid, br_code text, leader_employee_id uuid, leader_name text,
  organization_unit_id uuid, unit_name text, enrichment_status text,
  tread_1 numeric, tread_2 numeric, tread_3 numeric, tread_4 numeric,
  tread_min_raw numeric, tread_min_calculated numeric, tread_min numeric, tread_divergence boolean,
  tread_class text, legal_tread_mm numeric,
  measurement_date date, measurement_days integer, measurement_status text, measurement_due_date date,
  psi numeric, calibration_date date, calibration_days integer, calibration_status text, calibration_due_date date,
  pressure_rule_id uuid, psi_min numeric, psi_ideal numeric, psi_max numeric, psi_status text,
  km_rodado bigint, km_real bigint, rodopar_updated_at timestamp, stale_days integer,
  retread_alert boolean, quality_flags text[], severity_score integer, severity text, as_of date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f          jsonb := coalesce(p_filters, '{}'::jsonb);
  v_ref      date := coalesce(nullif(f ->> 'reference_date', '')::date, private.tire_latest_reference(p_organization_id));
  v_as_of    date := coalesce(p_as_of, private.maintenance_today(p_organization_id));
  p          public.tire_parameter_sets;
  f_search   text := nullif(btrim(f ->> 'search'), '');
  f_status   text[] := private.jsonb_text_array(f -> 'statuses');
  f_ops      uuid[] := private.km_uuid_array(f -> 'operation_ids');
  f_states   integer[] := private.km_int_array(f -> 'state_ids');
  f_cities   integer[] := private.km_int_array(f -> 'city_ids');
  f_brs      uuid[] := private.km_uuid_array(f -> 'br_ids');
  f_leaders  uuid[] := private.km_uuid_array(f -> 'leader_ids');
  f_units    uuid[] := private.km_uuid_array(f -> 'unit_ids');
  f_types    uuid[] := private.km_uuid_array(f -> 'vehicle_type_ids');
  f_vehicles uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  f_brands   text[] := private.jsonb_text_array(f -> 'brands');
  f_models   text[] := private.jsonb_text_array(f -> 'models');
  f_dims     text[] := private.jsonb_text_array(f -> 'dimensions');
  f_lives    integer[] := private.km_int_array(f -> 'lives');
  f_pos      text[] := private.jsonb_text_array(f -> 'positions');
  f_tread    text[] := private.jsonb_text_array(f -> 'tread_classes');
  f_meas     text[] := private.jsonb_text_array(f -> 'measurement_statuses');
  f_cal      text[] := private.jsonb_text_array(f -> 'calibration_statuses');
  f_psi      text[] := private.jsonb_text_array(f -> 'psi_statuses');
  f_sev      text[] := private.jsonb_text_array(f -> 'severities');
  f_quality  boolean := coalesce(nullif(f ->> 'quality_only', '')::boolean, false);
  f_retread  boolean := coalesce(nullif(f ->> 'retread_only', '')::boolean, false);
  -- recortes da conformidade e grupos "sem operação/local/liderança"
  f_nulls    text[] := private.jsonb_text_array(f -> 'null_dims');
  f_conf     text := nullif(f ->> 'overall_conformity', '');
  f_calconf  text := nullif(f ->> 'calibration_conformity', '');
  v_all      boolean := private.is_platform_admin() or private.is_privileged_context()
                        or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_scope    uuid[] := '{}';
  v_ops      uuid[] := '{}';
  -- regras cadastradas na implantação valem também para fotografias anteriores
  -- (não existe versão anterior que as contradiga); regras criadas depois só
  -- valem a partir da própria vigência — mesmo critério de tire_params_at
  v_rule_floor date := (select min(x.valid_from) from public.tire_pressure_rules x
                         where x.organization_id = p_organization_id and x.is_active);
begin
  if v_ref is null then return; end if;
  p := private.tire_params_at(p_organization_id, v_as_of);
  if p.id is null then return; end if;
  if not v_all then
    select coalesce(array_agg(x), '{}') into v_scope from private.org_vehicle_scope_ids(p_organization_id) x;
    select coalesce(array_agg(x), '{}') into v_ops from private.accessible_operation_ids() x;
  end if;

  return query
  with s as (
    select sn.* from public.tire_daily_snapshots sn
     where sn.organization_id = p_organization_id and sn.reference_date = v_ref and not sn.removed_in_revision
       and (v_all
            or (sn.operation_id is not null and sn.operation_id = any (v_ops))
            or (sn.operation_id is null and sn.vehicle_id is not null and sn.vehicle_id = any (v_scope)))
  ),
  e as (
    select s.*, pos.label as pos_label, pos.sort_order as pos_sort, pos.axle_group as pos_axle,
           r.id as rule_id, r.min_psi as r_min, r.ideal_psi as r_ideal, r.max_psi as r_max, r.min_legal_tread_mm as r_legal,
           (v_as_of - s.measurement_date) as m_days, (v_as_of - s.calibration_date) as c_days
      from s
      left join public.tire_positions pos on pos.organization_id = s.organization_id and pos.code = s.position_code
      left join lateral (
        select r.* from public.tire_pressure_rules r
         where r.organization_id = s.organization_id and r.is_active
           and r.valid_from <= greatest(v_as_of, v_rule_floor) and (r.valid_to is null or r.valid_to >= v_as_of)
           and (r.vehicle_type_id is null or r.vehicle_type_id = s.vehicle_type_id)
           and (r.dimension_key is null or r.dimension_key = s.dimension_key)
           and (r.position_code is null or r.position_code = s.position_code)
           and (r.axle_group is null or r.axle_group = pos.axle_group)
         order by ((r.dimension_key is not null)::int * 8 + (r.position_code is not null)::int * 4
                 + (r.axle_group is not null)::int * 2 + (r.vehicle_type_id is not null)::int) desc,
                  r.valid_from desc, r.created_at desc
         limit 1) r on true
  ),
  c as (
    select e.*,
      case when e.tread_min is null then 'sem_medicao'
           when e.r_legal is not null and e.tread_min <= e.r_legal then 'abaixo_legal'
           when e.tread_min <= p.tread_critical_mm then 'critico'
           when e.tread_min <= p.tread_attention_mm then 'atencao'
           else 'adequado' end as t_class,
      case when e.measurement_date is null then 'sem_registro'
           when e.m_days <= p.measurement_ok_days then 'em_dia'
           when e.m_days <= p.measurement_warning_days then 'proximo'
           else 'vencido' end as m_status,
      case when e.calibration_date is null then 'sem_registro'
           when e.c_days <= p.calibration_ok_days then 'em_dia'
           when e.c_days <= p.calibration_warning_days then 'proximo'
           else 'vencido' end as c_status,
      case when e.psi is null then 'sem_calibragem'
           when e.rule_id is null then 'sem_parametro'
           when e.psi < e.r_min then 'baixa'
           when e.psi > e.r_max then 'excesso'
           else 'adequada' end as p_status,
      (e.canonical_status in ('em_uso', 'estoque') and (
         (p.retread_alert_use_rodopar_condition and coalesce(private.normalize_label(e.rodopar_condition), '') like 'recap%')
         or (p.retread_alert_tread_mm is not null and e.tread_min is not null and e.tread_min <= p.retread_alert_tread_mm))) as retread
      from e
  ),
  sc as (
    select c.*,
      case when c.canonical_status <> 'em_uso' then 0 else
        (case c.t_class when 'abaixo_legal' then 120
                        when 'critico' then 100 + greatest(0, round((p.tread_critical_mm - c.tread_min) * 10))::int
                        when 'atencao' then 40 else 0 end)
      + (case c.m_status when 'vencido' then 30 when 'sem_registro' then 20 when 'proximo' then 10 else 0 end)
      + (case c.c_status when 'vencido' then 30 when 'sem_registro' then 20 when 'proximo' then 10 else 0 end)
      + (case c.p_status when 'baixa' then 25 when 'excesso' then 25 when 'sem_parametro' then 5 else 0 end)
      + (case when c.tread_divergence then 12 else 0 end)
      + (case when c.retread then 15 else 0 end) end as score
      from c
  )
  select sc.id, sc.tire_id, sc.fire_number, sc.reference_date, sc.import_batch_id,
         sc.canonical_status, sc.rodopar_status_raw, sc.rodopar_status_label, sc.rodopar_condition,
         sc.brand, sc.model, sc.dimension, sc.dimension_key, sc.serial_number, sc.dot, sc.drawing, sc.rubber,
         sc.life, sc.position_code, coalesce(sc.pos_label, sc.position_code), coalesce(sc.pos_sort, 999::smallint), sc.pos_axle,
         sc.vehicle_id, coalesce(v.license_plate, sc.vehicle_plate_snapshot), coalesce(sc.fleet_number_snapshot, sc.fleet_number_raw), sc.fleet_number_raw,
         sc.vehicle_type_id, vt.name,
         sc.context_source, sc.operation_id, o.name, sc.operation_city_id,
         sc.state_id, st.uf::text, sc.city_id, ci.name,
         sc.operation_br_id, b.code, sc.leader_employee_id, le.full_name,
         sc.organization_unit_id, u.name, sc.enrichment_status,
         sc.tread_1, sc.tread_2, sc.tread_3, sc.tread_4,
         sc.tread_min_raw, sc.tread_min_calculated, sc.tread_min, sc.tread_divergence,
         sc.t_class, sc.r_legal,
         sc.measurement_date, sc.m_days, sc.m_status, sc.measurement_date + p.measurement_warning_days,
         sc.psi, sc.calibration_date, sc.c_days, sc.c_status, sc.calibration_date + p.calibration_warning_days,
         sc.rule_id, sc.r_min, sc.r_ideal, sc.r_max, sc.p_status,
         sc.km_rodado, sc.km_real, sc.rodopar_updated_at, (v_as_of - sc.rodopar_updated_at::date),
         sc.retread, sc.quality_flags, sc.score,
         case when sc.score >= 100 then 'critica' when sc.score >= 50 then 'alta' when sc.score >= 20 then 'media'
              when sc.score > 0 then 'baixa' else 'ok' end,
         v_as_of
    from sc
    left join public.vehicles v on v.id = sc.vehicle_id
    left join public.vehicle_types vt on vt.id = sc.vehicle_type_id
    left join public.operations o on o.id = sc.operation_id
    left join public.states st on st.id = sc.state_id
    left join public.cities ci on ci.id = sc.city_id
    left join public.operation_brs b on b.id = sc.operation_br_id
    left join public.employees le on le.id = sc.leader_employee_id
    left join public.organization_units u on u.id = sc.organization_unit_id
   where (f_search is null
          or sc.fire_number like '%' || upper(f_search) || '%'
          or coalesce(v.license_plate, sc.vehicle_plate_snapshot, '') like '%' || coalesce(private.normalize_plate(f_search), '#') || '%'
          or upper(coalesce(sc.fleet_number_snapshot, sc.fleet_number_raw, '')) like '%' || upper(f_search) || '%'
          or coalesce(sc.brand, '') ilike '%' || f_search || '%'
          or coalesce(sc.model, '') ilike '%' || f_search || '%'
          or coalesce(sc.serial_number, '') ilike '%' || f_search || '%')
     and (f_status is null or cardinality(f_status) = 0 or sc.canonical_status = any (f_status))
     and (f_ops is null or cardinality(f_ops) = 0 or sc.operation_id = any (f_ops))
     and (f_states is null or cardinality(f_states) = 0 or sc.state_id = any (f_states))
     and (f_cities is null or cardinality(f_cities) = 0 or sc.city_id = any (f_cities))
     and (f_brs is null or cardinality(f_brs) = 0 or sc.operation_br_id = any (f_brs))
     and (f_leaders is null or cardinality(f_leaders) = 0 or sc.leader_employee_id = any (f_leaders))
     and (f_units is null or cardinality(f_units) = 0 or sc.organization_unit_id = any (f_units))
     and (f_types is null or cardinality(f_types) = 0 or sc.vehicle_type_id = any (f_types))
     and (f_vehicles is null or cardinality(f_vehicles) = 0 or sc.vehicle_id = any (f_vehicles))
     and (f_brands is null or cardinality(f_brands) = 0 or sc.brand = any (f_brands))
     and (f_models is null or cardinality(f_models) = 0 or sc.model = any (f_models))
     and (f_dims is null or cardinality(f_dims) = 0 or sc.dimension_key = any (f_dims))
     and (f_lives is null or cardinality(f_lives) = 0 or sc.life = any (f_lives))
     and (f_pos is null or cardinality(f_pos) = 0 or sc.position_code = any (f_pos))
     and (f_tread is null or cardinality(f_tread) = 0 or sc.t_class = any (f_tread))
     and (f_meas is null or cardinality(f_meas) = 0 or sc.m_status = any (f_meas))
     and (f_cal is null or cardinality(f_cal) = 0 or sc.c_status = any (f_cal))
     and (f_psi is null or cardinality(f_psi) = 0 or sc.p_status = any (f_psi))
     and (f_sev is null or cardinality(f_sev) = 0
          or (case when sc.score >= 100 then 'critica' when sc.score >= 50 then 'alta' when sc.score >= 20 then 'media'
                   when sc.score > 0 then 'baixa' else 'ok' end) = any (f_sev))
     and (not f_quality or cardinality(sc.quality_flags) > 0)
     and (not f_retread or sc.retread)
     and (f_nulls is null or cardinality(f_nulls) = 0 or (
            (not ('operation' = any (f_nulls)) or sc.operation_id is null)
        and (not ('city' = any (f_nulls)) or sc.city_id is null)
        and (not ('leader' = any (f_nulls)) or sc.leader_employee_id is null)))
     and (f_conf is null or (sc.canonical_status = 'em_uso'
          and private.tire_overall_conform(sc.t_class, sc.m_status, sc.c_status, sc.p_status) = (f_conf = 'conforme')))
     and (f_calconf is null or (sc.canonical_status = 'em_uso'
          and private.tire_calibration_conform(sc.c_status, sc.p_status) = (f_calconf = 'conforme')));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Opções de filtro com as combinações reais (cascata Operação → Local →
--    Liderança → Frota sem opção incompatível)
-- -----------------------------------------------------------------------------
create or replace function public.tires_filter_options(p_organization_id uuid, p_reference_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.view');
  with r as materialized (
    select * from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', p_reference_date)))
  select jsonb_build_object(
    'reference_dates', coalesce((select jsonb_agg(jsonb_build_object('reference_date', b.reference_date, 'file_name', b.file_name,
                                   'confirmed_at', b.confirmed_at, 'batch_id', b.id, 'source_kind', b.source_kind) order by b.reference_date desc)
                                   from public.tire_import_batches b where b.organization_id = p_organization_id and b.status = 'confirmed'), '[]'::jsonb),
    'operations', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                              from (select distinct r.operation_id as id, r.operation_name as name from r where r.operation_id is not null) x), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'uf', x.uf) order by x.uf)
                          from (select distinct r.state_id as id, r.state_uf as uf from r where r.state_id is not null) x), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'state_id', x.state_id, 'uf', x.uf) order by x.name)
                          from (select distinct r.city_id as id, r.city_name as name, r.state_id, r.state_uf as uf from r where r.city_id is not null) x), '[]'::jsonb),
    'brs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'operation_id', x.op) order by x.code)
                       from (select distinct r.operation_br_id as id, r.br_code as code, r.operation_id as op from r where r.operation_br_id is not null) x), '[]'::jsonb),
    'leaders', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                           from (select distinct r.leader_employee_id as id, r.leader_name as name from r where r.leader_employee_id is not null) x), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                         from (select distinct r.organization_unit_id as id, r.unit_name as name from r where r.organization_unit_id is not null) x), '[]'::jsonb),
    'vehicle_types', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
                                 from (select distinct r.vehicle_type_id as id, r.vehicle_type_name as name from r where r.vehicle_type_id is not null) x), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'plate', x.plate, 'fleet', x.fleet, 'operation_id', x.op,
                                                              'city_id', x.city, 'leader_id', x.leader, 'vehicle_type_id', x.vt) order by x.fleet, x.plate)
                            from (select r.vehicle_id as id, min(r.license_plate) as plate, min(r.fleet_number) as fleet,
                                         (array_agg(r.operation_id))[1] as op, (array_agg(r.city_id))[1] as city,
                                         (array_agg(r.leader_employee_id))[1] as leader, (array_agg(r.vehicle_type_id))[1] as vt
                                    from r where r.vehicle_id is not null group by r.vehicle_id) x), '[]'::jsonb),
    -- combinações reais (operação, local, liderança, tipo) para a cascata no navegador
    'combos', coalesce((select jsonb_agg(jsonb_build_object('operation_id', x.op, 'city_id', x.city, 'leader_id', x.leader, 'vehicle_type_id', x.vt))
                          from (select distinct r.operation_id as op, r.city_id as city, r.leader_employee_id as leader, r.vehicle_type_id as vt
                                  from r) x), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct r.brand as v from r where r.brand is not null) x), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(jsonb_build_object('value', x.v, 'brand', x.b) order by x.v)
                          from (select r.model as v, min(r.brand) as b from r where r.model is not null group by r.model) x), '[]'::jsonb),
    'dimensions', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l) order by x.l)
                              from (select r.dimension_key as k, min(r.dimension) as l from r where r.dimension_key is not null group by r.dimension_key) x), '[]'::jsonb),
    'lives', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct r.life as v from r where r.life is not null) x), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label) order by x.sort, x.code)
                             from (select distinct r.position_code as code, r.position_label as label, r.position_sort as sort from r where r.position_code is not null) x), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Visão Geral: Dados Gerais, perfil, onde estão, Saúde e Prazos,
--    conformidades e alertas determinísticos
-- -----------------------------------------------------------------------------
create or replace function public.tires_overview(p_organization_id uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  p        public.tire_parameter_sets;
  v_kpis jsonb; v_conf jsonb; v_profile jsonb; v_where jsonb; v_health jsonb; v_insights jsonb := '[]'::jsonb;
  v_batch jsonb; v_prev date; v_absent integer; v_insp jsonb; v_ops jsonb; v_gaps integer; v_gap_tires integer;
begin
  perform private.tire_require(p_organization_id, 'tires.dashboard.view');
  if v_ref is null then
    return jsonb_build_object('empty', true, 'reference_date', null, 'today', v_today);
  end if;
  v_as_of := case when v_ref = v_latest then greatest(v_today, v_ref) else v_ref end;
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_ref);

  select jsonb_build_object('batch_id', b.id, 'file_name', b.file_name, 'confirmed_at', b.confirmed_at, 'source_kind', b.source_kind,
                            'confirmed_by_name', b.confirmed_by_name, 'total_rows', b.total_rows, 'reference_date', b.reference_date,
                            'same_day_revision', b.supersedes_batch_id is not null)
    into v_batch
    from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date = v_ref;
  select max(b.reference_date) into v_prev from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'confirmed' and b.reference_date < v_ref;
  select count(*) into v_absent from public.tires t where t.organization_id = p_organization_id and t.presence_status = 'absent'
     and private.tire_vehicle_visible(t.organization_id, t.current_vehicle_id);

  with r as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of)),
  u as materialized (
    select r.*,
           private.tire_mm_ok(r.tread_class) as mm_ok,
           private.tire_deadline_ok(r.measurement_status) as meas_ok,
           private.tire_deadline_ok(r.calibration_status) as cal_ok,
           private.tire_psi_ok(r.psi_status) as psi_ok,
           private.tire_calibration_conform(r.calibration_status, r.psi_status) as cal_conf,
           private.tire_overall_conform(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status) as all_conf,
           cardinality(private.tire_nonconformity_reasons(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status)) as fails,
           private.tire_nonconformity_reasons(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status) as reasons
      from r where r.canonical_status = 'em_uso'),
  fl as (
    select coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k,
           bool_or(u.tread_class in ('abaixo_legal', 'critico')) as has_critical, bool_and(u.all_conf) as compliant
      from u group by 1),
  ev as (
    select e.event_type from public.tire_events e
     where e.organization_id = p_organization_id and e.reference_date > v_ref - 30 and e.reference_date <= v_ref
       and e.tire_id in (select r.tire_id from r))
  select
    -- Dados Gerais dos Pneus
    jsonb_build_object(
      'total', (select count(*) from r),
      'em_uso', (select count(*) from u),
      'fora_da_frota', (select count(*) from r where r.canonical_status <> 'em_uso'),
      'estoque', (select count(*) from r where r.canonical_status = 'estoque'),
      'disponiveis', (select count(*) from r where r.canonical_status = 'estoque' and private.tire_mm_ok(r.tread_class)),
      'em_manutencao', (select count(*) from r where r.canonical_status = 'ressolagem'),
      'ressolagem', (select count(*) from r where r.canonical_status = 'ressolagem'),
      'descartado', (select count(*) from r where r.canonical_status = 'descartado'),
      'baixado', (select count(*) from r where r.canonical_status = 'baixado'),
      'outro', (select count(*) from r where r.canonical_status = 'outro'),
      'in_use_without_vehicle', (select count(*) from u where u.vehicle_id is null),
      'fleets', (select count(*) from fl),
      'fleets_compliant', (select count(*) from fl where fl.compliant),
      'fleets_with_critical', (select count(*) from fl where fl.has_critical),
      -- Saúde e Prazos (pneus em uso)
      'below_legal', (select count(*) from u where u.tread_class = 'abaixo_legal'),
      'critical', (select count(*) from u where u.tread_class in ('abaixo_legal', 'critico')),
      'attention', (select count(*) from u where u.tread_class = 'atencao'),
      'tread_unknown', (select count(*) from u where u.tread_class = 'sem_medicao'),
      'measurement_ok', (select count(*) from u where u.measurement_status = 'em_dia'),
      'measurement_due_soon', (select count(*) from u where u.measurement_status = 'proximo'),
      'measurement_overdue', (select count(*) from u where u.measurement_status = 'vencido'),
      'measurement_missing', (select count(*) from u where u.measurement_status = 'sem_registro'),
      'calibration_ok', (select count(*) from u where u.calibration_status = 'em_dia'),
      'calibration_due_soon', (select count(*) from u where u.calibration_status = 'proximo'),
      'calibration_overdue', (select count(*) from u where u.calibration_status = 'vencido'),
      'calibration_missing', (select count(*) from u where u.calibration_status = 'sem_registro'),
      'psi_adequate', (select count(*) from u where u.psi_status = 'adequada'),
      'psi_low', (select count(*) from u where u.psi_status = 'baixa'),
      'psi_high', (select count(*) from u where u.psi_status = 'excesso'),
      'psi_no_rule', (select count(*) from u where u.psi_status = 'sem_parametro'),
      'psi_missing', (select count(*) from u where u.psi_status = 'sem_calibragem'),
      'retread_alerts', (select count(*) from r where r.retread_alert),
      'quality_issue_tires', (select count(*) from r where cardinality(r.quality_flags) > 0),
      'stale', (select count(*) from r where r.stale_days > p.stale_update_days),
      'tread_avg', (select round(avg(u.tread_min), 2) from u where u.tread_min is not null),
      'tread_median', (select round((percentile_cont(0.5) within group (order by u.tread_min))::numeric, 2) from u where u.tread_min is not null),
      'movements_30d', (select count(*) from ev where ev.event_type in ('TIRE_MOVED', 'TIRE_POSITION_CHANGED', 'TIRE_REMOVED', 'TIRE_RETURNED_TO_STOCK', 'TIRE_SENT_TO_RETREAD', 'TIRE_DISCARDED')),
      'life_changes_30d', (select count(*) from ev where ev.event_type = 'TIRE_LIFE_CHANGED'),
      'absent', v_absent),
    -- Conformidades (base = pneus em uso)
    (select jsonb_build_object(
       'base', count(*),
       'tread', jsonb_build_object('ok', count(*) filter (where u.mm_ok), 'nok', count(*) filter (where not u.mm_ok),
                                   'pct', round(100.0 * count(*) filter (where u.mm_ok) / nullif(count(*), 0), 1)),
       'measurement', jsonb_build_object('ok', count(*) filter (where u.meas_ok), 'nok', count(*) filter (where not u.meas_ok),
                                         'pct', round(100.0 * count(*) filter (where u.meas_ok) / nullif(count(*), 0), 1)),
       'calibration', jsonb_build_object('ok', count(*) filter (where u.cal_ok), 'nok', count(*) filter (where not u.cal_ok),
                                         'pct', round(100.0 * count(*) filter (where u.cal_ok) / nullif(count(*), 0), 1)),
       'psi', jsonb_build_object('ok', count(*) filter (where u.psi_ok), 'nok', count(*) filter (where not u.psi_ok),
                                 'pct', round(100.0 * count(*) filter (where u.psi_ok) / nullif(count(*), 0), 1)),
       'calibration_conformity', jsonb_build_object(
          'ok', count(*) filter (where u.cal_conf), 'nok', count(*) filter (where not u.cal_conf),
          'pct', round(100.0 * count(*) filter (where u.cal_conf) / nullif(count(*), 0), 1),
          'on_time_bad_psi', count(*) filter (where u.cal_ok and not u.psi_ok),
          'late_good_psi', count(*) filter (where not u.cal_ok and u.psi_ok),
          'late_bad_psi', count(*) filter (where not u.cal_ok and not u.psi_ok)),
       'overall', jsonb_build_object(
          'ok', count(*) filter (where u.all_conf), 'nok', count(*) filter (where not u.all_conf),
          'pct', round(100.0 * count(*) filter (where u.all_conf) / nullif(count(*), 0), 1),
          'one_failure', count(*) filter (where u.fails = 1), 'two_failures', count(*) filter (where u.fails = 2),
          'three_plus_failures', count(*) filter (where u.fails >= 3)),
       'reasons', coalesce((select jsonb_object_agg(x.code, x.n) from (select c as code, count(*) as n from u cross join lateral unnest(u.reasons) c group by c) x), '{}'::jsonb),
       'criticality', jsonb_build_object(
          'critico', count(*) filter (where u.severity = 'critica'), 'alto', count(*) filter (where u.severity = 'alta'),
          'medio', count(*) filter (where u.severity = 'media'), 'baixo', count(*) filter (where u.severity = 'baixa'),
          'ok', count(*) filter (where u.severity = 'ok')))
      from u),
    -- Perfil dos Pneus (toda a base filtrada)
    jsonb_build_object(
      'status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc) from (select r.canonical_status as k, count(*) as n from r group by 1) x), '[]'::jsonb),
      'brand', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.k, 'count', x.n, 'in_use', x.iu) order by x.n desc, x.k)
                           from (select coalesce(r.brand, '—') as k, count(*) as n, count(*) filter (where r.canonical_status = 'em_uso') as iu from r group by 1) x), '[]'::jsonb),
      'model', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.k, 'count', x.n, 'in_use', x.iu) order by x.n desc, x.k)
                           from (select coalesce(r.model, '—') as k, count(*) as n, count(*) filter (where r.canonical_status = 'em_uso') as iu from r group by 1 order by 2 desc limit 12) x), '[]'::jsonb),
      'dimension', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'in_use', x.iu) order by x.n desc)
                               from (select coalesce(r.dimension_key, '—') as k, min(coalesce(r.dimension, '—')) as l, count(*) as n,
                                            count(*) filter (where r.canonical_status = 'em_uso') as iu from r group by 1) x), '[]'::jsonb),
      'life', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n, 'in_use', x.iu) order by x.k)
                          from (select coalesce(r.life::text, '—') as k, count(*) as n, count(*) filter (where r.canonical_status = 'em_uso') as iu from r group by 1) x), '[]'::jsonb)),
    -- Onde estão os pneus em uso
    jsonb_build_object(
      'operation', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'conform', x.c, 'critical', x.cr) order by x.n desc)
                               from (select coalesce(u.operation_id::text, '—') as k, coalesce(min(u.operation_name), 'Sem operação') as l, count(*) as n,
                                            count(*) filter (where u.all_conf) as c, count(*) filter (where u.severity = 'critica') as cr from u group by 1) x), '[]'::jsonb),
      'city', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'conform', x.c, 'critical', x.cr) order by x.n desc)
                          from (select coalesce(u.city_id::text, '—') as k, coalesce(min(u.city_name) || ' · ' || min(u.state_uf), 'Sem local') as l, count(*) as n,
                                       count(*) filter (where u.all_conf) as c, count(*) filter (where u.severity = 'critica') as cr from u group by 1) x), '[]'::jsonb),
      'leader', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'conform', x.c, 'critical', x.cr) order by x.n desc)
                            from (select coalesce(u.leader_employee_id::text, '—') as k, coalesce(min(u.leader_name), 'Sem liderança') as l, count(*) as n,
                                         count(*) filter (where u.all_conf) as c, count(*) filter (where u.severity = 'critica') as cr from u group by 1) x), '[]'::jsonb),
      'vehicle_type', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l, 'count', x.n, 'conform', x.c, 'critical', x.cr) order by x.n desc)
                                  from (select coalesce(u.vehicle_type_id::text, '—') as k, coalesce(min(u.vehicle_type_name), 'Sem tipo') as l, count(*) as n,
                                               count(*) filter (where u.all_conf) as c, count(*) filter (where u.severity = 'critica') as cr from u group by 1) x), '[]'::jsonb)),
    -- Saúde e Prazos: distribuições dos pneus em uso
    jsonb_build_object(
      'tread_class', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.tread_class as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'measurement_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.measurement_status as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'calibration_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.calibration_status as k, count(*) as n from u group by 1) x), '[]'::jsonb),
      'psi_status', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n)) from (select u.psi_status as k, count(*) as n from u group by 1) x), '[]'::jsonb)),
    (select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'total', x.total, 'pct', x.pct) order by x.pct nulls last)
       from (select u.operation_id as id, min(u.operation_name) as name, count(*) as total,
                    round(100.0 * count(*) filter (where u.all_conf) / nullif(count(*), 0), 1) as pct
               from u where u.operation_id is not null group by u.operation_id) x),
    (select count(*) from (select 1 from u where u.psi_status = 'sem_parametro' group by u.vehicle_type_id, u.dimension_key, u.position_code) g),
    (select count(*) from u where u.psi_status = 'sem_parametro')
  into v_kpis, v_conf, v_profile, v_where, v_health, v_ops, v_gaps, v_gap_tires;

  v_kpis := v_kpis || jsonb_build_object(
    'pct_em_uso', round(100.0 * (v_kpis ->> 'em_uso')::int / nullif((v_kpis ->> 'total')::int, 0), 1),
    'pct_estoque', round(100.0 * (v_kpis ->> 'estoque')::int / nullif((v_kpis ->> 'total')::int, 0), 1),
    'measurement_coverage_pct', round(100.0 * ((v_kpis ->> 'em_uso')::int - (v_kpis ->> 'measurement_missing')::int) / nullif((v_kpis ->> 'em_uso')::int, 0), 1),
    'calibration_coverage_pct', round(100.0 * ((v_kpis ->> 'em_uso')::int - (v_kpis ->> 'calibration_missing')::int) / nullif((v_kpis ->> 'em_uso')::int, 0), 1),
    'measurement_adherence_pct', v_conf -> 'measurement' -> 'pct',
    'calibration_adherence_pct', v_conf -> 'calibration' -> 'pct',
    'pressure_adequate_pct', v_conf -> 'psi' -> 'pct',
    'quality_score', round(100.0 * ((v_kpis ->> 'total')::int - (v_kpis ->> 'quality_issue_tires')::int) / nullif((v_kpis ->> 'total')::int, 0), 1),
    'psi_rule_gaps', v_gaps);

  select jsonb_build_object(
    'pending_review', count(*) filter (where i.status = 'pendente_revisao'),
    'pending_rodopar', count(*) filter (where i.status = 'pendente_rodopar'),
    'pending_rodopar_over_sla', count(*) filter (where i.status = 'pendente_rodopar' and i.approved_at < now() - make_interval(days => p.rodopar_sync_sla_days)),
    'returned', count(*) filter (where i.status = 'retornar_divergencia'),
    'persistent', count(*) filter (where i.status = 'pendente_rodopar' and i.persistent_divergence))
    into v_insp
    from public.tire_inspections i
   where i.organization_id = p_organization_id and private.tire_vehicle_visible(i.organization_id, i.vehicle_id);
  v_kpis := v_kpis || jsonb_build_object('inspections', v_insp);

  -- alertas determinísticos: só aparecem quando o número existe
  if (v_kpis ->> 'below_legal')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'below_legal', 'tone', 'danger', 'count', (v_kpis ->> 'below_legal')::int,
      'text', format('%s %s abaixo do sulco mínimo legal da sua regra.', v_kpis ->> 'below_legal',
                     case when (v_kpis ->> 'below_legal')::int = 1 then 'pneu em uso está' else 'pneus em uso estão' end));
  end if;
  if (v_kpis ->> 'fleets_with_critical')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'fleets_with_critical', 'tone', 'danger', 'count', (v_kpis ->> 'fleets_with_critical')::int,
      'text', format('%s %s ao menos um pneu com sulco crítico (até %s mm) ou abaixo do limite legal.', v_kpis ->> 'fleets_with_critical',
                     case when (v_kpis ->> 'fleets_with_critical')::int = 1 then 'frota possui' else 'frotas possuem' end,
                     replace(trim(to_char(p.tread_critical_mm, 'FM990.0')), '.', ',')));
  end if;
  if (v_kpis ->> 'measurement_overdue')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'measurement_overdue', 'tone', 'danger', 'count', (v_kpis ->> 'measurement_overdue')::int,
      'text', format('%s %s com medição de sulco vencida (mais de %s dias).', v_kpis ->> 'measurement_overdue',
                     case when (v_kpis ->> 'measurement_overdue')::int = 1 then 'pneu em uso está' else 'pneus em uso estão' end, p.measurement_warning_days));
  end if;
  if ((v_conf -> 'calibration_conformity' ->> 'on_time_bad_psi')::int) > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'on_time_bad_psi', 'tone', 'warning', 'count', (v_conf -> 'calibration_conformity' ->> 'on_time_bad_psi')::int,
      'text', format('%s %s com calibragem no prazo, mas pressão fora da faixa — não conta como calibragem conforme.',
                     v_conf -> 'calibration_conformity' ->> 'on_time_bad_psi',
                     case when (v_conf -> 'calibration_conformity' ->> 'on_time_bad_psi')::int = 1 then 'pneu está' else 'pneus estão' end));
  end if;
  if v_ops is not null and jsonb_array_length(v_ops) > 1 and (v_ops -> 0 ->> 'pct') is not null and (v_ops -> 0 ->> 'pct')::numeric < 100 then
    v_insights := v_insights || jsonb_build_object('key', 'worst_operation', 'tone', 'warning', 'count', (v_ops -> 0 ->> 'total')::int,
      'text', format('A operação %s tem a menor Conformidade Geral dos Pneus: %s%%.', v_ops -> 0 ->> 'name', replace(v_ops -> 0 ->> 'pct', '.', ',')));
  end if;
  if v_gaps > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'psi_gaps', 'tone', 'info', 'count', v_gaps,
      'text', format('%s %s de tipo, dimensão e posição ainda sem parâmetro de PSI (%s %s).', v_gaps,
                     case when v_gaps = 1 then 'combinação' else 'combinações' end, v_gap_tires, case when v_gap_tires = 1 then 'pneu' else 'pneus' end));
  end if;
  if v_absent > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'absent', 'tone', 'warning', 'count', v_absent,
      'text', format('%s %s não %s mais na planilha Rodopar (mantidos com a última situação conhecida).', v_absent,
                     case when v_absent = 1 then 'pneu' else 'pneus' end, case when v_absent = 1 then 'aparece' else 'aparecem' end));
  end if;
  if (v_insp ->> 'pending_rodopar_over_sla')::int > 0 then
    v_insights := v_insights || jsonb_build_object('key', 'rodopar_sla', 'tone', 'warning', 'count', (v_insp ->> 'pending_rodopar_over_sla')::int,
      'text', format('%s %s aguardando lançamento no Rodopar há mais de %s dias.', v_insp ->> 'pending_rodopar_over_sla',
                     case when (v_insp ->> 'pending_rodopar_over_sla')::int = 1 then 'vistoria aprovada está' else 'vistorias aprovadas estão' end, p.rodopar_sync_sla_days));
  end if;

  return jsonb_build_object(
    'empty', false, 'today', v_today, 'as_of', v_as_of, 'reference_date', v_ref, 'latest_reference_date', v_latest,
    'previous_reference_date', v_prev, 'is_latest', v_ref = v_latest, 'source', v_batch,
    'parameters', jsonb_build_object('measurement_ok_days', p.measurement_ok_days, 'measurement_warning_days', p.measurement_warning_days,
                                     'calibration_ok_days', p.calibration_ok_days, 'calibration_warning_days', p.calibration_warning_days,
                                     'tread_critical_mm', p.tread_critical_mm, 'tread_attention_mm', p.tread_attention_mm,
                                     'stale_update_days', p.stale_update_days),
    'kpis', v_kpis, 'conformity', v_conf, 'profile', v_profile, 'where', v_where, 'health', v_health,
    'insights', v_insights);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Prioridades agrupadas (Operação | Local de Operação | Liderança), do mais
--    crítico para o menos crítico; drill-down paginado dos pneus do grupo
-- -----------------------------------------------------------------------------
create or replace function public.tires_priorities(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_group_by text default 'operation',
  p_group_id text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.dashboard.view');
  if p_group_by not in ('operation', 'city', 'leader') then
    raise exception 'Agrupamento inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_ref is null then return jsonb_build_object('empty', true, 'groups', '[]'::jsonb); end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  f := f || jsonb_build_object('reference_date', v_ref);

  with u as materialized (
    select x.*,
           case p_group_by when 'operation' then x.operation_id::text when 'city' then x.city_id::text else x.leader_employee_id::text end as gid,
           case p_group_by when 'operation' then coalesce(x.operation_name, 'Sem operação')
                           when 'city' then coalesce(x.city_name || ' · ' || x.state_uf, 'Sem local')
                           else coalesce(x.leader_name, 'Sem liderança') end as glabel,
           private.tire_overall_conform(x.tread_class, x.measurement_status, x.calibration_status, x.psi_status) as all_conf,
           private.tire_nonconformity_reasons(x.tread_class, x.measurement_status, x.calibration_status, x.psi_status) as reasons
      from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  g as (
    select coalesce(u.gid, '—') as gid, min(u.glabel) as label, count(*) as tires,
           count(distinct coalesce(u.vehicle_id::text, u.fleet_number)) as fleets,
           count(*) filter (where not u.all_conf) as nonconform,
           count(*) filter (where u.severity = 'critica') as critico,
           count(*) filter (where u.severity = 'alta') as alto,
           count(*) filter (where u.severity = 'media') as medio,
           count(*) filter (where u.severity = 'baixa') as baixo,
           count(*) filter (where u.tread_class in ('abaixo_legal', 'critico')) as tread_critical,
           count(*) filter (where u.tread_class = 'abaixo_legal') as below_legal,
           count(*) filter (where u.measurement_status = 'vencido') as measurement_overdue,
           count(*) filter (where u.measurement_status = 'sem_registro') as measurement_missing,
           count(*) filter (where u.calibration_status = 'vencido') as calibration_overdue,
           count(*) filter (where u.calibration_status = 'sem_registro') as calibration_missing,
           count(*) filter (where u.psi_status in ('baixa', 'excesso')) as psi_out,
           count(*) filter (where u.psi_status = 'sem_parametro') as psi_no_rule,
           count(*) filter (where cardinality(u.reasons) >= 2) as multi_failures,
           max(u.severity_score) as worst_score
      from u group by 1),
  go as (
    select g.*, round(100.0 * (g.tires - g.nonconform) / nullif(g.tires, 0), 1) as conform_pct,
           case when g.critico > 0 then 'critico' when g.alto > 0 then 'alto' when g.medio > 0 then 'medio'
                when g.baixo > 0 then 'baixo' else 'ok' end as level,
           row_number() over (order by g.critico desc, g.alto desc, g.medio desc, g.nonconform desc, g.worst_score desc nulls last, g.label) as rn
      from g),
  t as (
    select u.*, row_number() over (order by u.severity_score desc, u.tread_min nulls first, u.fire_number) as rn
      from u where p_group_id is not null and coalesce(u.gid, '—') = p_group_id and u.severity <> 'ok')
  select jsonb_build_object(
    'reference_date', v_ref, 'as_of', v_as_of, 'group_by', p_group_by,
    'summary', jsonb_build_object(
      'groups', (select count(*) from go), 'tires', (select count(*) from u),
      'critico', (select count(*) from u where u.severity = 'critica'), 'alto', (select count(*) from u where u.severity = 'alta'),
      'medio', (select count(*) from u where u.severity = 'media'), 'baixo', (select count(*) from u where u.severity = 'baixa')),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', nullif(go.gid, '—'), 'key', go.gid, 'label', go.label, 'tires', go.tires, 'fleets', go.fleets, 'nonconform', go.nonconform,
        'conform_pct', go.conform_pct, 'level', go.level, 'critico', go.critico, 'alto', go.alto, 'medio', go.medio, 'baixo', go.baixo,
        'tread_critical', go.tread_critical, 'below_legal', go.below_legal, 'measurement_overdue', go.measurement_overdue,
        'measurement_missing', go.measurement_missing, 'calibration_overdue', go.calibration_overdue,
        'calibration_missing', go.calibration_missing, 'psi_out', go.psi_out, 'psi_no_rule', go.psi_no_rule,
        'multi_failures', go.multi_failures) order by go.rn) from go), '[]'::jsonb),
    'group_id', p_group_id,
    'tires_total', (select count(*) from t),
    'tires', coalesce((select jsonb_agg(jsonb_build_object(
        'tire_id', t.tire_id, 'fire_number', t.fire_number, 'vehicle_id', t.vehicle_id, 'license_plate', t.license_plate,
        'fleet_number', t.fleet_number, 'position_code', t.position_code, 'position_label', t.position_label,
        'operation_name', t.operation_name, 'city_name', t.city_name, 'state_uf', t.state_uf, 'leader_name', t.leader_name,
        'tread_min', t.tread_min, 'tread_class', t.tread_class, 'measurement_status', t.measurement_status,
        'measurement_days', t.measurement_days, 'calibration_status', t.calibration_status, 'calibration_days', t.calibration_days,
        'psi', t.psi, 'psi_min', t.psi_min, 'psi_max', t.psi_max, 'psi_status', t.psi_status,
        'severity', t.severity, 'criticality', private.tire_criticality(t.severity), 'severity_score', t.severity_score,
        'reasons', to_jsonb(t.reasons)) order by t.rn) from t where t.rn > v_offset and t.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Indicador gerencial (Sulco, Prazo de medição, Prazo de calibragem, PSI,
--    Conformidade de calibragem, Conformidade geral): cartões, distribuição,
--    quebras por Operação/Local/Liderança/Tipo/Perfil, pendências paginadas
-- -----------------------------------------------------------------------------
create or replace function public.tires_indicator(
  p_organization_id uuid, p_indicator text, p_filters jsonb default '{}'::jsonb, p_status text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today  date := private.maintenance_today(p_organization_id);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  p        public.tire_parameter_sets;
  v_res    jsonb;
begin
  if p_indicator not in ('tread', 'measurement', 'calibration', 'psi', 'calibration_conformity', 'overall') then
    raise exception 'Indicador inválido.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.tire_require(p_organization_id, case p_indicator
    when 'tread' then 'tires.measurement.view' when 'measurement' then 'tires.measurement.view'
    when 'overall' then 'tires.dashboard.view' else 'tires.calibration.view' end);
  if v_ref is null then return jsonb_build_object('empty', true, 'indicator', p_indicator); end if;
  v_as_of := case when v_ref = v_latest then greatest(v_today, v_ref) else v_ref end;
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_ref);

  with u as materialized (
    select x.*,
      private.tire_mm_ok(x.tread_class) as mm_ok,
      private.tire_deadline_ok(x.measurement_status) as meas_ok,
      private.tire_deadline_ok(x.calibration_status) as cal_ok,
      private.tire_psi_ok(x.psi_status) as psi_ok,
      private.tire_calibration_conform(x.calibration_status, x.psi_status) as cal_conf,
      private.tire_overall_conform(x.tread_class, x.measurement_status, x.calibration_status, x.psi_status) as all_conf,
      private.tire_nonconformity_reasons(x.tread_class, x.measurement_status, x.calibration_status, x.psi_status) as reasons,
      case when x.measurement_status = 'vencido' then x.measurement_days - p.measurement_warning_days end as meas_late,
      case when x.calibration_status = 'vencido' then x.calibration_days - p.calibration_warning_days end as cal_late,
      case when x.psi_status = 'baixa' then x.psi - x.psi_min when x.psi_status = 'excesso' then x.psi - x.psi_max end as psi_dev,
      case when x.psi_status in ('baixa', 'excesso') and coalesce(x.psi_ideal, x.psi_min) > 0
           then round(100.0 * (case when x.psi_status = 'baixa' then x.psi - x.psi_min else x.psi - x.psi_max end) / coalesce(x.psi_ideal, x.psi_min), 1) end as psi_dev_pct
      from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  k as (
    select u.*,
      case p_indicator when 'tread' then u.mm_ok when 'measurement' then u.meas_ok when 'calibration' then u.cal_ok
                       when 'psi' then u.psi_ok when 'calibration_conformity' then u.cal_conf else u.all_conf end as ok,
      case p_indicator when 'tread' then u.tread_class when 'measurement' then u.measurement_status
                       when 'calibration' then u.calibration_status when 'psi' then u.psi_status
                       when 'calibration_conformity' then case when u.cal_ok and u.psi_ok then 'conforme'
                                                               when u.cal_ok then 'prazo_ok_psi_inadequado'
                                                               when u.psi_ok then 'psi_ok_prazo_vencido' else 'prazo_e_psi' end
                       else case when u.all_conf then 'conforme' else 'nao_conforme' end end as st,
      -- maior = pior (ordem das pendências)
      case p_indicator
        when 'tread' then case u.tread_class when 'abaixo_legal' then 4000 - coalesce(u.tread_min, 0) * 10
                                             when 'critico' then 3000 - coalesce(u.tread_min, 0) * 10
                                             when 'sem_medicao' then 2500 when 'atencao' then 2000 - coalesce(u.tread_min, 0) * 10 else 0 end
        when 'measurement' then case u.measurement_status when 'vencido' then 3000 + u.meas_late when 'sem_registro' then 2500
                                                          when 'proximo' then 1000 + u.measurement_days else 0 end
        when 'calibration' then case u.calibration_status when 'vencido' then 3000 + u.cal_late when 'sem_registro' then 2500
                                                          when 'proximo' then 1000 + u.calibration_days else 0 end
        when 'psi' then case u.psi_status when 'baixa' then 3000 + abs(coalesce(u.psi_dev_pct, 0)) * 10
                                          when 'excesso' then 3000 + abs(coalesce(u.psi_dev_pct, 0)) * 10
                                          when 'sem_calibragem' then 2500 when 'sem_parametro' then 2000 else 0 end
        when 'calibration_conformity' then (case when u.cal_conf then 0 else 1000 end) + u.severity_score
        else (case when u.all_conf then 0 else 1000 end) + u.severity_score end::numeric as rank_key
      from u),
  bd as (
    select case when grouping(k.operation_id) = 0 then 'operation' when grouping(k.city_id) = 0 then 'city'
                when grouping(k.leader_employee_id) = 0 then 'leader' when grouping(k.vehicle_type_id) = 0 then 'vehicle_type'
                else 'dimension' end as dim,
           coalesce(k.operation_id::text, k.city_id::text, k.leader_employee_id::text, k.vehicle_type_id::text, k.dimension_key) as id,
           case when grouping(k.operation_id) = 0 then coalesce(min(k.operation_name), 'Sem operação')
                when grouping(k.city_id) = 0 then coalesce(min(k.city_name) || ' · ' || min(k.state_uf), 'Sem local')
                when grouping(k.leader_employee_id) = 0 then coalesce(min(k.leader_name), 'Sem liderança')
                when grouping(k.vehicle_type_id) = 0 then coalesce(min(k.vehicle_type_name), 'Sem tipo')
                else coalesce(min(k.dimension), 'Sem medida') end as label,
           count(*) as total, count(*) filter (where k.ok) as ok, count(*) filter (where not k.ok) as nok,
           round(100.0 * count(*) filter (where k.ok) / nullif(count(*), 0), 1) as pct,
           count(*) filter (where case when p_indicator in ('calibration_conformity', 'overall') then k.severity = 'critica' else k.rank_key >= 3000 end) as critical,
           count(*) filter (where k.st in ('vencido', 'baixa', 'excesso', 'critico', 'abaixo_legal')) as out_of_range,
           count(*) filter (where k.st in ('proximo', 'atencao')) as warning,
           count(*) filter (where k.st in ('sem_registro', 'sem_medicao', 'sem_parametro', 'sem_calibragem')) as missing,
           round(avg(case p_indicator when 'measurement' then k.meas_late when 'calibration' then k.cal_late end), 1) as avg_late,
           max(case p_indicator when 'measurement' then k.meas_late when 'calibration' then k.cal_late end) as max_late,
           round(avg(abs(k.psi_dev_pct)) filter (where k.psi_dev_pct is not null), 1) as avg_psi_dev_pct,
           round(avg(k.tread_min) filter (where k.tread_min is not null), 2) as avg_tread
      from k
     group by grouping sets ((k.operation_id), (k.city_id), (k.leader_employee_id), (k.vehicle_type_id), (k.dimension_key))),
  pend as (
    select k.*, row_number() over (order by k.rank_key desc, k.fleet_number, k.position_sort, k.fire_number) as rn
      from k where not k.ok and (p_status is null or p_status = '' or k.st = p_status))
  select jsonb_build_object(
    'indicator', p_indicator, 'reference_date', v_ref, 'as_of', v_as_of, 'is_latest', v_ref = v_latest, 'today', v_today,
    'parameters', jsonb_build_object('measurement_ok_days', p.measurement_ok_days, 'measurement_warning_days', p.measurement_warning_days,
                                     'calibration_ok_days', p.calibration_ok_days, 'calibration_warning_days', p.calibration_warning_days,
                                     'tread_critical_mm', p.tread_critical_mm, 'tread_attention_mm', p.tread_attention_mm),
    'kpis', jsonb_build_object(
      'base', (select count(*) from k), 'ok', (select count(*) from k where k.ok), 'nok', (select count(*) from k where not k.ok),
      'pct', (select round(100.0 * count(*) filter (where k.ok) / nullif(count(*), 0), 1) from k),
      'critical', (select count(*) from k where case when p_indicator in ('calibration_conformity', 'overall') then k.severity = 'critica' else k.rank_key >= 3000 end),
      'fleets_affected', (select count(distinct coalesce(k.vehicle_id::text, k.fleet_number)) from k where not k.ok)),
    'distribution', coalesce((select jsonb_object_agg(x.st, x.n) from (select k.st, count(*) as n from k group by k.st) x), '{}'::jsonb),
    'details', case p_indicator
      when 'tread' then jsonb_build_object(
        'avg', (select round(avg(k.tread_min), 2) from k where k.tread_min is not null),
        'median', (select round((percentile_cont(0.5) within group (order by k.tread_min))::numeric, 2) from k where k.tread_min is not null),
        'min', (select min(k.tread_min) from k),
        'divergent', (select count(*) from k where k.tread_divergence),
        'retread_alerts', (select count(*) from k where k.retread_alert),
        'histogram', coalesce((select jsonb_agg(jsonb_build_object('bucket', x.b, 'count', x.n) order by x.b)
                                 from (select least(floor(k.tread_min), 16)::int as b, count(*) as n from k where k.tread_min is not null group by 1) x), '[]'::jsonb))
      when 'measurement' then jsonb_build_object(
        'avg_days', (select round(avg(k.measurement_days), 1) from k where k.measurement_days is not null),
        'max_late', (select max(k.meas_late) from k),
        'avg_late', (select round(avg(k.meas_late), 1) from k where k.meas_late is not null),
        'due_7d', (select count(*) from k where k.measurement_due_date between v_today and v_today + 7),
        'due_15d', (select count(*) from k where k.measurement_due_date between v_today and v_today + 15),
        'late_buckets', jsonb_build_array(
          jsonb_build_object('bucket', '1-7', 'count', (select count(*) from k where k.meas_late between 1 and 7)),
          jsonb_build_object('bucket', '8-15', 'count', (select count(*) from k where k.meas_late between 8 and 15)),
          jsonb_build_object('bucket', '16-30', 'count', (select count(*) from k where k.meas_late between 16 and 30)),
          jsonb_build_object('bucket', '31-60', 'count', (select count(*) from k where k.meas_late between 31 and 60)),
          jsonb_build_object('bucket', '60+', 'count', (select count(*) from k where k.meas_late > 60))))
      when 'calibration' then jsonb_build_object(
        'avg_days', (select round(avg(k.calibration_days), 1) from k where k.calibration_days is not null),
        'max_late', (select max(k.cal_late) from k),
        'avg_late', (select round(avg(k.cal_late), 1) from k where k.cal_late is not null),
        'due_7d', (select count(*) from k where k.calibration_due_date between v_today and v_today + 7),
        'due_15d', (select count(*) from k where k.calibration_due_date between v_today and v_today + 15),
        'on_time_bad_psi', (select count(*) from k where k.cal_ok and not k.psi_ok),
        'late_buckets', jsonb_build_array(
          jsonb_build_object('bucket', '1-7', 'count', (select count(*) from k where k.cal_late between 1 and 7)),
          jsonb_build_object('bucket', '8-15', 'count', (select count(*) from k where k.cal_late between 8 and 15)),
          jsonb_build_object('bucket', '16-30', 'count', (select count(*) from k where k.cal_late between 16 and 30)),
          jsonb_build_object('bucket', '31-60', 'count', (select count(*) from k where k.cal_late between 31 and 60)),
          jsonb_build_object('bucket', '60+', 'count', (select count(*) from k where k.cal_late > 60))))
      when 'psi' then jsonb_build_object(
        'avg_dev_pct', (select round(avg(abs(k.psi_dev_pct)), 1) from k where k.psi_dev_pct is not null),
        'rule_gaps', (select count(*) from (select 1 from k where k.psi_status = 'sem_parametro' group by k.vehicle_type_id, k.dimension_key, k.position_code) g),
        'deviation_buckets', jsonb_build_array(
          jsonb_build_object('bucket', '<-20%', 'side', 'below', 'count', (select count(*) from k where k.psi_dev_pct < -20)),
          jsonb_build_object('bucket', '-20% a -10%', 'side', 'below', 'count', (select count(*) from k where k.psi_dev_pct >= -20 and k.psi_dev_pct < -10)),
          jsonb_build_object('bucket', '-10% a -5%', 'side', 'below', 'count', (select count(*) from k where k.psi_dev_pct >= -10 and k.psi_dev_pct < -5)),
          jsonb_build_object('bucket', '-5% a 0', 'side', 'below', 'count', (select count(*) from k where k.psi_dev_pct >= -5 and k.psi_dev_pct <= 0)),
          jsonb_build_object('bucket', 'Na faixa', 'side', 'ok', 'count', (select count(*) from k where k.psi_status = 'adequada')),
          jsonb_build_object('bucket', '0 a +5%', 'side', 'above', 'count', (select count(*) from k where k.psi_dev_pct > 0 and k.psi_dev_pct <= 5)),
          jsonb_build_object('bucket', '+5% a +10%', 'side', 'above', 'count', (select count(*) from k where k.psi_dev_pct > 5 and k.psi_dev_pct <= 10)),
          jsonb_build_object('bucket', '+10% a +20%', 'side', 'above', 'count', (select count(*) from k where k.psi_dev_pct > 10 and k.psi_dev_pct <= 20)),
          jsonb_build_object('bucket', '>+20%', 'side', 'above', 'count', (select count(*) from k where k.psi_dev_pct > 20))),
        'gaps', coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_name', g.vt, 'dimension', g.dim, 'position_code', g.pos, 'tires', g.n) order by g.n desc)
                            from (select min(k.vehicle_type_name) as vt, min(k.dimension) as dim, k.position_code as pos, count(*) as n
                                    from k where k.psi_status = 'sem_parametro' group by k.vehicle_type_id, k.dimension_key, k.position_code) g), '[]'::jsonb))
      when 'calibration_conformity' then jsonb_build_object(
        'on_time_bad_psi', (select count(*) from k where k.cal_ok and not k.psi_ok),
        'late_good_psi', (select count(*) from k where not k.cal_ok and k.psi_ok),
        'late_bad_psi', (select count(*) from k where not k.cal_ok and not k.psi_ok))
      else jsonb_build_object(
        'reasons', coalesce((select jsonb_object_agg(x.code, x.n) from (select c as code, count(*) as n from k cross join lateral unnest(k.reasons) c group by c) x), '{}'::jsonb),
        'failures', jsonb_build_object('1', (select count(*) from k where cardinality(k.reasons) = 1), '2', (select count(*) from k where cardinality(k.reasons) = 2),
                                       '3', (select count(*) from k where cardinality(k.reasons) = 3), '4', (select count(*) from k where cardinality(k.reasons) >= 4)))
      end,
    'breakdowns', coalesce((select jsonb_object_agg(z.dim, z.items) from (
        select bd.dim, jsonb_agg(jsonb_build_object('id', bd.id, 'label', bd.label, 'total', bd.total, 'ok', bd.ok, 'nok', bd.nok, 'pct', bd.pct,
                                                     'critical', bd.critical, 'out_of_range', bd.out_of_range, 'warning', bd.warning, 'missing', bd.missing,
                                                     'avg_late', bd.avg_late, 'max_late', bd.max_late, 'avg_psi_dev_pct', bd.avg_psi_dev_pct, 'avg_tread', bd.avg_tread)
                                  order by bd.pct asc nulls last, bd.nok desc, bd.label) as items
          from bd group by bd.dim) z), '{}'::jsonb),
    'status', p_status,
    'pending_total', (select count(*) from pend),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'tire_id', pend.tire_id, 'fire_number', pend.fire_number, 'vehicle_id', pend.vehicle_id, 'license_plate', pend.license_plate,
        'fleet_number', pend.fleet_number, 'position_code', pend.position_code, 'position_label', pend.position_label, 'position_sort', pend.position_sort,
        'operation_name', pend.operation_name, 'city_name', pend.city_name, 'state_uf', pend.state_uf, 'leader_name', pend.leader_name,
        'vehicle_type_name', pend.vehicle_type_name, 'brand', pend.brand, 'model', pend.model, 'dimension', pend.dimension,
        'tread_min', pend.tread_min, 'tread_1', pend.tread_1, 'tread_2', pend.tread_2, 'tread_3', pend.tread_3, 'tread_4', pend.tread_4,
        'tread_class', pend.tread_class, 'legal_tread_mm', pend.legal_tread_mm,
        'measurement_date', pend.measurement_date, 'measurement_days', pend.measurement_days, 'measurement_status', pend.measurement_status,
        'measurement_due_date', pend.measurement_due_date, 'measurement_late', pend.meas_late,
        'calibration_date', pend.calibration_date, 'calibration_days', pend.calibration_days, 'calibration_status', pend.calibration_status,
        'calibration_due_date', pend.calibration_due_date, 'calibration_late', pend.cal_late,
        'psi', pend.psi, 'psi_min', pend.psi_min, 'psi_ideal', pend.psi_ideal, 'psi_max', pend.psi_max, 'psi_status', pend.psi_status,
        'psi_dev', pend.psi_dev, 'psi_dev_pct', pend.psi_dev_pct, 'status', pend.st, 'reasons', to_jsonb(pend.reasons),
        'severity', pend.severity, 'criticality', private.tire_criticality(pend.severity))
        order by pend.rn) from pend where pend.rn > v_offset and pend.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Base Geral › Por Frota agrupada (Operação | Local | Liderança): cabeçalhos
--    de grupo; as frotas de um grupo vêm de tires_base com o filtro do grupo
-- -----------------------------------------------------------------------------
create or replace function public.tires_base_groups(p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_group_by text default 'operation')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.base.view');
  if p_group_by not in ('operation', 'city', 'leader') then
    raise exception 'Agrupamento inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_ref is null then return jsonb_build_object('empty', true, 'groups', '[]'::jsonb); end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  f := f || jsonb_build_object('reference_date', v_ref);

  with u as materialized (
    select x.*,
           case p_group_by when 'operation' then x.operation_id::text when 'city' then x.city_id::text else x.leader_employee_id::text end as gid,
           case p_group_by when 'operation' then coalesce(x.operation_name, 'Sem operação')
                           when 'city' then coalesce(x.city_name || ' · ' || x.state_uf, 'Sem local')
                           else coalesce(x.leader_name, 'Sem liderança') end as glabel,
           private.tire_overall_conform(x.tread_class, x.measurement_status, x.calibration_status, x.psi_status) as all_conf
      from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  fl as (
    select coalesce(u.gid, '—') as gid, min(u.glabel) as label, coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k,
           count(*) as tires, count(*) filter (where not u.all_conf) as nonconform,
           private.tire_fleet_status(
             count(*) filter (where u.tread_class in ('abaixo_legal', 'critico')), count(*) filter (where u.measurement_status = 'vencido'),
             count(*) filter (where u.tread_class = 'atencao'), count(*) filter (where u.psi_status in ('baixa', 'excesso')),
             count(*) filter (where u.calibration_status = 'vencido'), count(*) filter (where u.measurement_status = 'sem_registro'),
             count(*) filter (where u.calibration_status = 'sem_registro')) as status
      from u group by 1, 3)
  select jsonb_build_object(
    'reference_date', v_ref, 'as_of', v_as_of, 'group_by', p_group_by,
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', nullif(g.gid, '—'), 'key', g.gid, 'label', g.label, 'fleets', g.fleets, 'tires', g.tires, 'nonconform', g.nonconform,
        'conform_pct', round(100.0 * (g.tires - g.nonconform) / nullif(g.tires, 0), 1),
        'critical', g.critical, 'attention', g.attention, 'ok', g.ok)
        order by g.critical desc, g.attention desc, g.label) from (
          select fl.gid, min(fl.label) as label, count(*) as fleets, sum(fl.tires) as tires, sum(fl.nonconform) as nonconform,
                 count(*) filter (where fl.status = 'critico') as critical, count(*) filter (where fl.status = 'atencao') as attention,
                 count(*) filter (where fl.status = 'ok') as ok
            from fl group by fl.gid) g), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Situação da frota (o pior pneu manda) — regra única para Base Geral e
--    grupos
-- -----------------------------------------------------------------------------
create or replace function private.tire_fleet_status(
  p_critical bigint, p_measurement_overdue bigint, p_attention bigint, p_psi_out bigint,
  p_calibration_overdue bigint, p_measurement_missing bigint, p_calibration_missing bigint)
returns text language sql immutable set search_path = '' as $$
  select case when p_critical > 0 or p_measurement_overdue > 0 then 'critico'
              when p_attention > 0 or p_psi_out > 0 or p_calibration_overdue > 0 or p_measurement_missing > 0 or p_calibration_missing > 0 then 'atencao'
              else 'ok' end;
$$;

-- Base Geral: conformidade por pneu e por frota, ids dos grupos e regra única de
-- situação da frota (mesma assinatura)
create or replace function public.tires_base(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_view text default 'frota',
  p_sort text default null, p_dir text default 'asc', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_desc   boolean := coalesce(p_dir, 'asc') = 'desc';
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.base.view');
  if v_ref is null then
    return jsonb_build_object('empty', true, 'total', 0, 'rows', '[]'::jsonb, 'groups', '[]'::jsonb, 'limit', v_limit, 'offset', v_offset);
  end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  f := f || jsonb_build_object('reference_date', v_ref);

  if p_view = 'frota' then
    with r as materialized (select * from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
    g as (
      select coalesce(r.vehicle_id::text, 'fleet:' || coalesce(r.fleet_number, '?')) as k,
             (array_agg(r.vehicle_id))[1] as vehicle_id, min(r.license_plate) as license_plate, min(r.fleet_number) as fleet_number,
             min(r.vehicle_type_name) as vehicle_type_name, min(r.operation_name) as operation_name, min(r.city_name) as city_name,
             min(r.state_uf) as state_uf, min(r.br_code) as br_code, min(r.leader_name) as leader_name, min(r.unit_name) as unit_name,
             (array_agg(r.operation_id))[1] as operation_id, (array_agg(r.city_id))[1] as city_id,
             (array_agg(r.leader_employee_id))[1] as leader_id, (array_agg(r.vehicle_type_id))[1] as vehicle_type_id,
             count(*) filter (where not private.tire_overall_conform(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status)) as nonconform,
             count(*) as tires,
             count(*) filter (where r.tread_class = 'abaixo_legal') as below_legal,
             count(*) filter (where r.tread_class in ('abaixo_legal', 'critico')) as critical,
             count(*) filter (where r.tread_class = 'atencao') as attention,
             count(*) filter (where r.psi_status in ('baixa', 'excesso')) as psi_out,
             count(*) filter (where r.psi_status = 'sem_parametro') as psi_no_rule,
             count(*) filter (where r.measurement_status = 'vencido') as measurement_overdue,
             count(*) filter (where r.measurement_status = 'sem_registro') as measurement_missing,
             count(*) filter (where r.calibration_status = 'vencido') as calibration_overdue,
             count(*) filter (where r.calibration_status = 'sem_registro') as calibration_missing,
             min(r.measurement_date) as oldest_measurement, min(r.calibration_date) as oldest_calibration,
             min(r.tread_min) as worst_tread, max(r.severity_score) as worst_score,
             jsonb_agg((to_jsonb(r) - 'as_of') || jsonb_build_object(
               'overall_conform', private.tire_overall_conform(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status),
               'calibration_conform', private.tire_calibration_conform(r.calibration_status, r.psi_status),
               'reasons', to_jsonb(private.tire_nonconformity_reasons(r.tread_class, r.measurement_status, r.calibration_status, r.psi_status)),
               'criticality', private.tire_criticality(r.severity))
                       order by r.position_sort, r.position_code) as tire_rows
        from r group by 1),
    g2 as (
      select g.*,
             private.tire_fleet_status(g.critical, g.measurement_overdue, g.attention, g.psi_out, g.calibration_overdue,
                                       g.measurement_missing, g.calibration_missing) as status,
             row_number() over (order by
               case when not v_desc then case p_sort when 'fleet' then g.fleet_number when 'plate' then g.license_plate when 'operation' then g.operation_name end end asc nulls last,
               case when v_desc then case p_sort when 'fleet' then g.fleet_number when 'plate' then g.license_plate when 'operation' then g.operation_name end end desc nulls last,
               case when p_sort = 'tread' then g.worst_tread end asc nulls last,
               g.worst_score desc, g.fleet_number) as rn,
             count(*) over () as total
        from g)
    select jsonb_build_object(
      'view', 'frota', 'reference_date', v_ref, 'as_of', v_as_of, 'limit', v_limit, 'offset', v_offset,
      'total', coalesce(max(g2.total), 0),
      'summary', jsonb_build_object(
        'fleets', coalesce(max(g2.total), 0),
        'critical', count(*) filter (where g2.status = 'critico'),
        'attention', count(*) filter (where g2.status = 'atencao'),
        'ok', count(*) filter (where g2.status = 'ok'),
        'tires', coalesce(sum(g2.tires), 0)),
      'groups', coalesce(jsonb_agg(jsonb_build_object(
          'key', g2.k, 'vehicle_id', g2.vehicle_id, 'license_plate', g2.license_plate, 'fleet_number', g2.fleet_number,
          'vehicle_type_name', g2.vehicle_type_name, 'operation_name', g2.operation_name, 'city_name', g2.city_name,
          'state_uf', g2.state_uf, 'br_code', g2.br_code, 'leader_name', g2.leader_name, 'unit_name', g2.unit_name,
          'operation_id', g2.operation_id, 'city_id', g2.city_id, 'leader_id', g2.leader_id, 'vehicle_type_id', g2.vehicle_type_id,
          'nonconform', g2.nonconform, 'conform_pct', round(100.0 * (g2.tires - g2.nonconform) / nullif(g2.tires, 0), 1),
          'tires', g2.tires, 'below_legal', g2.below_legal, 'critical', g2.critical, 'attention', g2.attention,
          'psi_out', g2.psi_out, 'psi_no_rule', g2.psi_no_rule, 'measurement_overdue', g2.measurement_overdue,
          'measurement_missing', g2.measurement_missing, 'calibration_overdue', g2.calibration_overdue,
          'calibration_missing', g2.calibration_missing, 'oldest_measurement', g2.oldest_measurement,
          'oldest_calibration', g2.oldest_calibration, 'worst_tread', g2.worst_tread, 'status', g2.status,
          'layout', (select to_jsonb(l) from private.tire_vehicle_layout(p_organization_id, g2.vehicle_id, v_ref) l where g2.vehicle_id is not null),
          'tire_rows', g2.tire_rows) order by g2.rn) filter (where g2.rn > v_offset and g2.rn <= v_offset + v_limit), '[]'::jsonb))
      into v_res from g2;
    -- resumo calculado sobre todos os grupos (não só a página)
    return v_res;
  end if;

  with r as materialized (
    select * from private.tire_rows(p_organization_id, f, v_as_of) x
     where (p_view = 'fora' and x.canonical_status <> 'em_uso') or (p_view <> 'fora')),
  o as (
    select r.*, row_number() over (order by
      case when not v_desc then case p_sort
        when 'fire_number' then r.fire_number when 'status' then r.canonical_status when 'plate' then r.license_plate
        when 'fleet' then r.fleet_number when 'brand' then r.brand when 'position' then lpad(r.position_sort::text, 4, '0') end end asc nulls last,
      case when v_desc then case p_sort
        when 'fire_number' then r.fire_number when 'status' then r.canonical_status when 'plate' then r.license_plate
        when 'fleet' then r.fleet_number when 'brand' then r.brand when 'position' then lpad(r.position_sort::text, 4, '0') end end desc nulls last,
      case when not v_desc then case p_sort when 'tread' then r.tread_min when 'measurement' then r.measurement_days::numeric
        when 'calibration' then r.calibration_days::numeric when 'psi' then r.psi when 'life' then r.life::numeric when 'km' then r.km_real::numeric end end asc nulls last,
      case when v_desc then case p_sort when 'tread' then r.tread_min when 'measurement' then r.measurement_days::numeric
        when 'calibration' then r.calibration_days::numeric when 'psi' then r.psi when 'life' then r.life::numeric when 'km' then r.km_real::numeric end end desc nulls last,
      r.fire_number) as rn
      from r)
  select jsonb_build_object(
    'view', p_view, 'reference_date', v_ref, 'as_of', v_as_of, 'limit', v_limit, 'offset', v_offset,
    'total', (select count(*) from o),
    'status_counts', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc)
                                 from (select o.canonical_status as k, count(*) as n from o group by 1) x), '[]'::jsonb),
    'summary', jsonb_build_object(
      'total', (select count(*) from o),
      'in_use', (select count(*) from o where o.canonical_status = 'em_uso'),
      'measurement_overdue', (select count(*) from o where o.canonical_status = 'em_uso' and o.measurement_status = 'vencido'),
      'measurement_due_soon', (select count(*) from o where o.canonical_status = 'em_uso' and o.measurement_status = 'proximo'),
      'measurement_missing', (select count(*) from o where o.measurement_date is null),
      'psi_out', (select count(*) from o where o.canonical_status = 'em_uso' and o.psi_status in ('baixa', 'excesso')),
      'without_vehicle', (select count(*) from o where o.canonical_status = 'em_uso' and o.vehicle_id is null),
      'tread_divergence', (select count(*) from o where o.tread_divergence),
      'km_real_negative', (select count(*) from o where o.km_real < 0),
      'retread_alerts', (select count(*) from o where o.retread_alert)),
    'rows', coalesce((select jsonb_agg((to_jsonb(o) - 'as_of' - 'rn') || jsonb_build_object(
               'overall_conform', case when o.canonical_status = 'em_uso' then private.tire_overall_conform(o.tread_class, o.measurement_status, o.calibration_status, o.psi_status) end,
               'reasons', case when o.canonical_status = 'em_uso' then to_jsonb(private.tire_nonconformity_reasons(o.tread_class, o.measurement_status, o.calibration_status, o.psi_status)) end,
               'criticality', private.tire_criticality(o.severity))
             order by o.rn) from o where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb))
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Aderência (telas e exportações antigas): mesma base dos indicadores
-- -----------------------------------------------------------------------------
create or replace function private.tire_breakdowns(p_rows jsonb, p_status_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- quebras por operação, estado, local (cidade), BR, filial, liderança e tipo,
  -- todas a partir das mesmas linhas
  with r as (select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x),
  dims(dim, id_key, name_key) as (values
    ('operation', 'operation_id', 'operation_name'), ('state', 'state_id', 'state_uf'), ('city', 'city_id', 'city_name'),
    ('br', 'operation_br_id', 'br_code'), ('unit', 'organization_unit_id', 'unit_name'),
    ('leader', 'leader_employee_id', 'leader_name'), ('vehicle_type', 'vehicle_type_id', 'vehicle_type_name')),
  agg as (
    select d.dim, coalesce(r.x ->> d.id_key, '') as id, coalesce(min(r.x ->> d.name_key), '') as name,
           count(*) as total,
           count(*) filter (where r.x ->> p_status_key = 'em_dia') as em_dia,
           count(*) filter (where r.x ->> p_status_key = 'proximo') as proximo,
           count(*) filter (where r.x ->> p_status_key = 'vencido') as vencido,
           count(*) filter (where r.x ->> p_status_key = 'sem_registro') as sem_registro
      from dims d cross join r group by d.dim, 2)
  select coalesce(jsonb_object_agg(z.dim, z.items), '{}'::jsonb) from (
    select a.dim, jsonb_agg(jsonb_build_object(
             'id', nullif(a.id, ''), 'name', nullif(a.name, ''), 'total', a.total, 'em_dia', a.em_dia, 'proximo', a.proximo,
             'vencido', a.vencido, 'sem_registro', a.sem_registro,
             'coverage_pct', round(100.0 * (a.total - a.sem_registro) / nullif(a.total, 0), 1),
             -- mesma definição do indicador: prazo OK ÷ pneus em uso (sem registro conta como não conforme)
             'adherence_pct', round(100.0 * (a.em_dia + a.proximo) / nullif(a.total, 0), 1))
             order by a.total desc, a.name) as items
      from agg a group by a.dim) z;
$$;

create or replace function public.tires_adherence(
  p_organization_id uuid, p_kind text, p_filters jsonb default '{}'::jsonb,
  p_pending_filter text default 'all', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_latest date := private.tire_latest_reference(p_organization_id);
  v_ref    date := coalesce(nullif(f ->> 'reference_date', '')::date, v_latest);
  v_as_of  date;
  v_cal    boolean := p_kind = 'calibration';
  p        public.tire_parameter_sets;
  v_res    jsonb;
begin
  if p_kind not in ('measurement', 'calibration') then
    raise exception 'Tipo de aderência inválido.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.tire_require(p_organization_id, case when v_cal then 'tires.calibration.view' else 'tires.measurement.view' end);
  if v_ref is null then return jsonb_build_object('empty', true); end if;
  v_as_of := case when v_ref = v_latest then greatest(private.maintenance_today(p_organization_id), v_ref) else v_ref end;
  p := private.tire_params_at(p_organization_id, v_as_of);
  f := f || jsonb_build_object('reference_date', v_ref);

  with u as materialized (
    select x.*, case when v_cal then x.calibration_status else x.measurement_status end as st,
                case when v_cal then x.calibration_days else x.measurement_days end as days,
                case when v_cal then x.calibration_date else x.measurement_date end as last_date,
                case when v_cal then x.calibration_due_date else x.measurement_due_date end as due_date
      from private.tire_rows(p_organization_id, f, v_as_of) x where x.canonical_status = 'em_uso'),
  pend as (
    select u.* from u
     where (u.st <> 'em_dia' or (v_cal and u.psi_status in ('baixa', 'excesso', 'sem_parametro')))
       and (coalesce(p_pending_filter, 'all') = 'all'
            or (p_pending_filter = 'vencido' and u.st = 'vencido')
            or (p_pending_filter = 'proximo' and u.st = 'proximo')
            or (p_pending_filter = 'sem_registro' and u.st = 'sem_registro')
            or (p_pending_filter = 'pressao' and u.psi_status in ('baixa', 'excesso'))
            or (p_pending_filter = 'sem_parametro' and u.psi_status = 'sem_parametro'))),
  pend_o as (select pend.*, row_number() over (order by pend.days desc nulls first, pend.city_name, pend.fleet_number, pend.position_sort) as rn from pend),
  veh as (
    select coalesce(u.vehicle_id::text, 'fleet:' || coalesce(u.fleet_number, '?')) as k, (array_agg(u.vehicle_id))[1] as vehicle_id,
           min(u.license_plate) as license_plate, min(u.fleet_number) as fleet_number, min(u.operation_name) as operation_name,
           min(u.city_name) as city_name, count(*) as tires,
           count(*) filter (where u.st = 'vencido') as overdue, count(*) filter (where u.st = 'sem_registro') as missing,
           max(u.days) as worst_days,
           round(100.0 * count(*) filter (where private.tire_deadline_ok(u.st)) / nullif(count(*), 0), 1) as adherence_pct
      from u group by 1)
  select jsonb_build_object(
    'kind', p_kind, 'reference_date', v_ref, 'as_of', v_as_of, 'is_latest', v_ref = v_latest,
    'parameters', jsonb_build_object('ok_days', case when v_cal then p.calibration_ok_days else p.measurement_ok_days end,
                                     'warning_days', case when v_cal then p.calibration_warning_days else p.measurement_warning_days end),
    'kpis', jsonb_build_object(
      'eligible', (select count(*) from u),
      'with_record', (select count(*) from u where u.st <> 'sem_registro'),
      'em_dia', (select count(*) from u where u.st = 'em_dia'),
      'proximo', (select count(*) from u where u.st = 'proximo'),
      'vencido', (select count(*) from u where u.st = 'vencido'),
      'sem_registro', (select count(*) from u where u.st = 'sem_registro'),
      'coverage_pct', (select round(100.0 * count(*) filter (where u.st <> 'sem_registro') / nullif(count(*), 0), 1) from u),
      'adherence_pct', (select round(100.0 * count(*) filter (where private.tire_deadline_ok(u.st)) / nullif(count(*), 0), 1) from u),
      'psi_adequate', (select count(*) from u where u.psi_status = 'adequada'),
      'psi_low', (select count(*) from u where u.psi_status = 'baixa'),
      'psi_high', (select count(*) from u where u.psi_status = 'excesso'),
      'psi_no_rule', (select count(*) from u where u.psi_status = 'sem_parametro'),
      'psi_missing', (select count(*) from u where u.psi_status = 'sem_calibragem'),
      'pressure_adequate_pct', (select round(100.0 * count(*) filter (where private.tire_psi_ok(u.psi_status)) / nullif(count(*), 0), 1) from u),
      'calibration_conformity_pct', (select round(100.0 * count(*) filter (where private.tire_calibration_conform(u.calibration_status, u.psi_status)) / nullif(count(*), 0), 1) from u),
      'tread_critical', (select count(*) from u where u.tread_class in ('abaixo_legal', 'critico')),
      'tread_attention', (select count(*) from u where u.tread_class = 'atencao')),
    'breakdowns', private.tire_breakdowns((select jsonb_agg(jsonb_build_object(
        'operation_id', u.operation_id, 'operation_name', u.operation_name, 'state_id', u.state_id, 'state_uf', u.state_uf,
        'city_id', u.city_id, 'city_name', u.city_name, 'operation_br_id', u.operation_br_id, 'br_code', u.br_code,
        'organization_unit_id', u.organization_unit_id, 'unit_name', u.unit_name, 'leader_employee_id', u.leader_employee_id,
        'leader_name', u.leader_name, 'vehicle_type_id', u.vehicle_type_id, 'vehicle_type_name', u.vehicle_type_name, 'st', u.st)) from u), 'st'),
    'ranking', coalesce((select jsonb_agg(to_jsonb(v) - 'k' order by v.worst_days desc nulls first, v.overdue desc)
                           from (select * from veh where veh.overdue > 0 or veh.missing > 0 order by veh.worst_days desc nulls first, veh.overdue desc limit 20) v), '[]'::jsonb),
    'gaps', case when v_cal then coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_id', g.vehicle_type_id, 'vehicle_type_name', g.vehicle_type_name,
                                   'dimension', g.dimension, 'dimension_key', g.dimension_key, 'position_code', g.position_code, 'tires', g.n) order by g.n desc)
                                   from (select u.vehicle_type_id, min(u.vehicle_type_name) as vehicle_type_name, min(u.dimension) as dimension, u.dimension_key,
                                                u.position_code, count(*) as n
                                           from u where u.psi_status = 'sem_parametro' group by u.vehicle_type_id, u.dimension_key, u.position_code) g), '[]'::jsonb)
                 else '[]'::jsonb end,
    'pending_total', (select count(*) from pend),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'tire_id', pend_o.tire_id, 'fire_number', pend_o.fire_number, 'position_code', pend_o.position_code, 'position_label', pend_o.position_label,
        'position_sort', pend_o.position_sort, 'vehicle_id', pend_o.vehicle_id, 'license_plate', pend_o.license_plate, 'fleet_number', pend_o.fleet_number,
        'operation_name', pend_o.operation_name, 'city_id', pend_o.city_id, 'city_name', pend_o.city_name, 'state_uf', pend_o.state_uf,
        'unit_name', pend_o.unit_name, 'leader_name', pend_o.leader_name, 'br_code', pend_o.br_code,
        'tread_min', pend_o.tread_min, 'tread_1', pend_o.tread_1, 'tread_2', pend_o.tread_2, 'tread_3', pend_o.tread_3, 'tread_4', pend_o.tread_4,
        'tread_class', pend_o.tread_class, 'psi', pend_o.psi, 'psi_min', pend_o.psi_min, 'psi_ideal', pend_o.psi_ideal, 'psi_max', pend_o.psi_max,
        'psi_status', pend_o.psi_status, 'last_date', pend_o.last_date, 'days', pend_o.days, 'status', pend_o.st, 'due_date', pend_o.due_date)
        order by pend_o.rn) from pend_o where pend_o.rn > v_offset and pend_o.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Grants
-- -----------------------------------------------------------------------------
revoke execute on function private.tire_mm_ok(text), private.tire_deadline_ok(text), private.tire_psi_ok(text),
  private.tire_calibration_conform(text, text), private.tire_overall_conform(text, text, text, text),
  private.tire_nonconformity_reasons(text, text, text, text), private.tire_criticality(text),
  private.tire_fleet_status(bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon;
grant execute on function private.tire_mm_ok(text), private.tire_deadline_ok(text), private.tire_psi_ok(text),
  private.tire_calibration_conform(text, text), private.tire_overall_conform(text, text, text, text),
  private.tire_nonconformity_reasons(text, text, text, text), private.tire_criticality(text),
  private.tire_fleet_status(bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  to authenticated, service_role;
revoke execute on function public.tires_definitions(uuid), public.tires_priorities(uuid, jsonb, text, text, integer, integer),
  public.tires_indicator(uuid, text, jsonb, text, integer, integer), public.tires_base_groups(uuid, jsonb, text)
  from public, anon;
grant execute on function public.tires_definitions(uuid), public.tires_priorities(uuid, jsonb, text, text, integer, integer),
  public.tires_indicator(uuid, text, jsonb, text, integer, integer), public.tires_base_groups(uuid, jsonb, text)
  to authenticated, service_role;
