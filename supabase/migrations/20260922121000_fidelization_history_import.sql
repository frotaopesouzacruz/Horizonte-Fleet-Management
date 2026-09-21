-- =============================================================================
-- Etapa 13 — importar história de fidelização sem mentir sobre ela
--
-- Dois ajustes que a carga da base histórica do PO tornou necessários, e que a
-- §57 ("importar planejamento de veículos por BR") já previa.
--
-- 1. ORIGEM. `save_fidelization_assignment` gravava `source = 'manual'` fixo.
--    A coluna existe para distinguir de onde veio o vínculo — manual, importado,
--    substituição, inversão — e 239 linhas importadas carimbadas como "manual"
--    tornariam a auditoria inútil justamente onde ela mais importa. A origem
--    passa a vir do payload, com lista branca (o check constraint já existia) e
--    com `fidelization.import` exigida para declarar 'import'.
--
-- 2. VEÍCULO INATIVO EM PERÍODO PASSADO. A checagem exigia veículo ativo, o que
--    está certo para planejar: ninguém aloca hoje um veículo que saiu da frota.
--    Mas a base histórica tem sete vigências do Merchandising que terminaram
--    entre 19/06 e 02/08 com veículos desativados depois — TEB8F21 a TEB8F27.
--    Recusá-las apagaria meio ano de história de sete posições operacionais.
--
--    A regra passa a olhar o período: um vínculo que TERMINOU no passado pode
--    referenciar um veículo hoje inativo, porque ele estava ativo enquanto
--    durou. Um vínculo que alcança hoje ou o futuro continua exigindo veículo
--    ativo. O veículo arquivado (soft delete) segue recusado em qualquer caso,
--    e as demais travas — organização, escopo e tipo de equipamento admitido na
--    operação — valem igual nos dois casos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.assert_vehicle_fidelizable — agora ciente do período
--
-- O parâmetro novo tem default, então quem já chamava com três argumentos
-- continua valendo e continua exigindo veículo ativo.
-- -----------------------------------------------------------------------------
create or replace function private.assert_vehicle_fidelizable(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_operation_id    uuid,
  p_period_end      date default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veh        record;
  v_historical boolean := p_period_end is not null and p_period_end < current_date;
begin
  select v.id, v.status, v.deleted_at, v.vehicle_type_id,
         coalesce(v.fleet_code, v.license_plate, 'sem identificação') as label
    into v_veh
    from public.vehicles v
   where v.id = p_vehicle_id and v.organization_id = p_organization_id;

  if v_veh.id is null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_veh.deleted_at is not null then
    raise exception 'O veículo % está arquivado.', v_veh.label using errcode = 'invalid_parameter_value';
  end if;
  -- Um período encerrado é um fato: o veículo esteve ali enquanto esteve ativo.
  -- Exigir que ele ainda esteja ativo hoje seria exigir que o passado mudasse.
  if v_veh.status <> 'active' and not v_historical then
    raise exception 'O veículo % não está ativo no cadastro de frotas.', v_veh.label
      using errcode = 'invalid_parameter_value';
  end if;
  if not private.vehicle_in_scope(p_organization_id, p_vehicle_id) then
    raise exception 'Este veículo não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.vehicle_type_operations o
     where o.organization_id = p_organization_id
       and o.vehicle_type_id = v_veh.vehicle_type_id
  ) and not exists (
    select 1 from public.vehicle_type_operations o
     where o.organization_id = p_organization_id
       and o.vehicle_type_id = v_veh.vehicle_type_id
       and o.operation_id = p_operation_id
  ) then
    raise exception 'O tipo de equipamento do veículo % não é admitido nesta operação.', v_veh.label
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke execute on function private.assert_vehicle_fidelizable(uuid, uuid, uuid, date) from public, anon;

-- -----------------------------------------------------------------------------
-- public.save_fidelization_assignment — origem declarada e período conferido
-- -----------------------------------------------------------------------------
create or replace function public.save_fidelization_assignment(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_br_id   uuid := nullif(p_payload ->> 'operation_br_id', '')::uuid;
  v_vehicle uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_role    text := coalesce(nullif(p_payload ->> 'vehicle_role', ''), 'primary');
  v_start   date := nullif(p_payload ->> 'start_date', '')::date;
  v_end     date := nullif(p_payload ->> 'end_date', '')::date;
  v_status  text := coalesce(nullif(p_payload ->> 'status', ''), 'planned');
  v_reason  text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  -- §57: uma alocação importada precisa dizer que veio de importação. A origem
  -- era fixa em 'manual', o que fazia 239 linhas de história mentirem sobre si
  -- mesmas na auditoria. Lista branca, porque `source` tem check constraint.
  v_source  text := coalesce(nullif(p_payload ->> 'source', ''), 'manual');
  v_br      public.operation_brs;
  v_current record;
begin
  if v_start is null then
    raise exception 'Informe a data de início da fidelização.' using errcode = 'invalid_parameter_value';
  end if;
  if v_source not in ('manual', 'import', 'substitution', 'inversion') then
    raise exception 'Origem de alocação inválida: %.', v_source using errcode = 'invalid_parameter_value';
  end if;
  if v_source = 'import' and not private.has_permission(p_organization_id, 'fidelization.import') then
    raise exception 'Você não possui permissão para importar alocações.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'O fim do período (%) não pode ser anterior ao início (%).',
      to_char(v_end, 'DD/MM/YYYY'), to_char(v_start, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  if v_id is not null then
    select * into v_current from public.fidelization_assignments
     where id = v_id and organization_id = p_organization_id
     for update;
    if v_current.id is null then
      raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
    end if;
    v_br_id := coalesce(v_br_id, v_current.operation_br_id);
    -- Trocar a BR de um vínculo existente é mobilizar o veículo para outra
    -- posição, o que tem rotina própria e motivo obrigatório.
    if v_br_id <> v_current.operation_br_id then
      raise exception 'Para mover este veículo para outra BR, utilize a substituição ou a inversão.'
        using errcode = 'invalid_parameter_value';
    end if;
    v_vehicle := coalesce(v_vehicle, v_current.vehicle_id);
  end if;

  v_br := private.lock_br(v_br_id, 'fidelization.plan');

  if v_br.organization_id <> p_organization_id then
    raise exception 'Esta BR não pertence a esta organização.' using errcode = 'insufficient_privilege';
  end if;
  if v_id is null and v_br.status <> 'active' then
    raise exception 'A BR % está inativa e não recebe novo planejamento.', v_br.code
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_vehicle_fidelizable(p_organization_id, v_vehicle, v_br.operation_id, v_end);

  if v_id is null then
    insert into public.fidelization_assignments
      (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
    values
      (p_organization_id, v_br_id, v_vehicle, v_role, v_start, v_end, v_status, v_source, v_reason)
    returning id into v_id;
  else
    update public.fidelization_assignments
       set vehicle_id   = v_vehicle,
           vehicle_role = v_role,
           start_date   = v_start,
           end_date     = v_end,
           status       = v_status,
           reason       = coalesce(v_reason, reason)
     where id = v_id;

    -- Encurtar o período do vínculo encurta o dos motoristas junto. Sem isto a
    -- verificação diferida recusaria a gravação no commit, com uma mensagem
    -- sobre motoristas para quem só queria corrigir uma data.
    if v_end is not null then
      update public.fidelization_drivers
         set end_date = v_end
       where fidelization_assignment_id = v_id
         and status <> 'cancelled'
         and (end_date is null or end_date > v_end)
         and start_date <= v_end;

      update public.fidelization_drivers
         set status = 'cancelled'
       where fidelization_assignment_id = v_id
         and status <> 'cancelled'
         and start_date > v_end;
    end if;

    update public.fidelization_drivers
       set start_date = v_start
     where fidelization_assignment_id = v_id
       and status <> 'cancelled'
       and start_date < v_start
       and (end_date is null or end_date >= v_start);
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;