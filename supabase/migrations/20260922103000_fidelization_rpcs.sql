-- =============================================================================
-- ETAPA 08 · AS ROTINAS DE FIDELIZAÇÃO
--
-- Duas regras percorrem o arquivo inteiro:
--
--   NADA AQUI MUDA A ALOCAÇÃO DO VEÍCULO (§38). Fidelizar é dizer que o veículo
--   ocupa aquela posição naqueles dias. A operação e a cidade em que ele está
--   alocado continuam vindo de `vehicle_operation_assignments`, e nenhuma linha
--   deste arquivo escreve nessa tabela.
--
--   MOVIMENTAÇÃO COMPOSTA É UMA TRANSAÇÃO SÓ (§50, §62). Inverter dois veículos
--   entre duas BRs não é "encerrar aqui e criar ali" quatro vezes: é uma função,
--   e ou as quatro linhas entram ou nenhuma entra. Metade de uma inversão é o
--   pior estado possível — duas BRs com o mesmo veículo, ou nenhuma com nenhum.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.assert_vehicle_fidelizable
--
-- §48. A elegibilidade que existe e está documentada, e só ela: situação
-- cadastral, arquivamento, escopo e — quando a Etapa 07 restringiu o tipo a
-- certas operações — a operação da BR. Um tipo sem nenhuma operação cadastrada
-- não é um tipo proibido em todas; é um tipo sem restrição, que é como a Etapa
-- 07 já o trata no cadastro de frotas.
-- -----------------------------------------------------------------------------
create or replace function private.assert_vehicle_fidelizable(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_operation_id    uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veh record;
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
  if v_veh.status <> 'active' then
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

revoke execute on function private.assert_vehicle_fidelizable(uuid, uuid, uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- private.lock_br(p_operation_br_id, p_permission)
--
-- Devolve a BR travada para UPDATE, depois de conferir permissão e escopo. O
-- lock é o que impede duas pessoas de planejarem a mesma posição ao mesmo tempo
-- e descobrirem o conflito só no commit (§62).
-- -----------------------------------------------------------------------------
create or replace function private.lock_br(p_operation_br_id uuid, p_permission text)
returns public.operation_brs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br public.operation_brs;
begin
  select * into v_br from public.operation_brs
   where id = p_operation_br_id and deleted_at is null
   for update;

  if v_br.id is null then
    raise exception 'Posição operacional (BR) não encontrada.' using errcode = 'no_data_found';
  end if;

  perform private.assert_governance_access(
    v_br.organization_id, v_br.operation_id, p_permission,
    'Você não possui permissão para esta ação na fidelização.');

  return v_br;
end;
$$;

revoke execute on function private.lock_br(uuid, text) from public, anon;

-- =============================================================================
-- public.save_operation_br — o cadastro oficial das posições operacionais
-- =============================================================================
create or replace function public.save_operation_br(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_city     uuid := nullif(p_payload ->> 'operation_city_id', '')::uuid;
  v_code     text := btrim(coalesce(p_payload ->> 'code', ''));
  v_desc     text := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
  v_notes    text := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_expected timestamptz := nullif(p_payload ->> 'expected_updated_at', '')::timestamptz;
  v_cov      record;
  v_current  record;
begin
  if v_code = '' then
    raise exception 'Informe o código da BR.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is null then
    raise exception 'Informe a cidade da BR.' using errcode = 'invalid_parameter_value';
  end if;

  -- A cobertura é a fonte da operação, do estado e da cidade. Nenhum dos três
  -- vem do payload: o front-end informa a cidade da cobertura e o resto é lido
  -- aqui, o que torna impossível salvar uma BR em cidade de outra operação
  -- mesmo com um POST montado à mão (§33).
  select c.operation_id, c.state_id, c.city_id
    into v_cov
    from public.operation_cities c
   where c.id = v_city and c.organization_id = p_organization_id;

  if v_cov.operation_id is null then
    raise exception 'Esta cidade não faz parte da cobertura de nenhuma operação desta organização.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_governance_access(
    p_organization_id, v_cov.operation_id, 'fidelization.manage_brs',
    'Você não possui permissão para gerenciar posições operacionais.');

  if v_id is null then
    insert into public.operation_brs
      (organization_id, operation_id, operation_city_id, state_id, city_id, code, description, notes)
    values
      (p_organization_id, v_cov.operation_id, v_city, v_cov.state_id, v_cov.city_id, v_code, v_desc, v_notes)
    returning id into v_id;
  else
    select * into v_current from public.operation_brs
     where id = v_id and organization_id = p_organization_id and deleted_at is null
     for update;

    if v_current.id is null then
      raise exception 'Posição operacional (BR) não encontrada.' using errcode = 'no_data_found';
    end if;
    if v_expected is not null and v_current.updated_at <> v_expected then
      raise exception 'Esta BR foi alterada por outra pessoa enquanto você editava. Recarregue e tente de novo.'
        using errcode = 'serialization_failure';
    end if;

    -- Mover uma BR para outra operação mudaria o significado de todo o histórico
    -- de fidelização pendurado nela. Trocar de cidade dentro da mesma operação
    -- é uma correção comum e continua permitida.
    if v_current.operation_id <> v_cov.operation_id then
      raise exception 'Não é possível mover uma BR para outra operação. Cadastre uma nova BR na operação de destino.'
        using errcode = 'invalid_parameter_value';
    end if;

    update public.operation_brs
       set operation_city_id = v_city,
           state_id          = v_cov.state_id,
           city_id           = v_cov.city_id,
           code              = v_code,
           description       = v_desc,
           notes             = v_notes
     where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_operation_br(uuid, jsonb) from public, anon;
grant  execute on function public.save_operation_br(uuid, jsonb) to authenticated;

-- =============================================================================
-- public.operation_br_impact — o que realmente depende desta BR
--
-- Contagens reais, lidas das tabelas. Nada aqui é estimado nem arredondado:
-- quem vai inativar uma posição precisa saber exatamente quantos vínculos
-- vigentes e quantas responsabilidades ficam pendurados nela.
-- =============================================================================
create or replace function public.operation_br_impact(p_operation_br_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_br     public.operation_brs;
  v_result jsonb;
begin
  select * into v_br from public.operation_brs where id = p_operation_br_id and deleted_at is null;
  if v_br.id is null then
    raise exception 'Posição operacional (BR) não encontrada.' using errcode = 'no_data_found';
  end if;

  perform private.assert_governance_access(
    v_br.organization_id, v_br.operation_id, 'fidelization.view',
    'Você não possui permissão para consultar a fidelização.');

  select jsonb_build_object(
    'current_vehicles', (
      select count(*) from public.fidelization_assignments a
       where a.operation_br_id = p_operation_br_id
         and a.status <> 'cancelled'
         and (a.end_date is null or a.end_date >= current_date)),
    'total_vehicles', (
      select count(*) from public.fidelization_assignments a
       where a.operation_br_id = p_operation_br_id),
    'current_drivers', (
      select count(*) from public.fidelization_drivers d
       join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
       where a.operation_br_id = p_operation_br_id
         and d.status <> 'cancelled'
         and (d.end_date is null or d.end_date >= current_date)),
    'current_leaders', (
      select count(*) from public.leadership_assignments l
       where l.operation_br_id = p_operation_br_id
         and l.status = 'active'
         and (l.effective_to is null or l.effective_to >= current_date))
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.operation_br_impact(uuid) from public, anon;
grant  execute on function public.operation_br_impact(uuid) to authenticated;

-- =============================================================================
-- public.set_operation_br_status
--
-- Inativar não encerra nada sozinho. Uma BR inativa deixa de receber
-- planejamento novo; o que já estava vigente continua vigente e visível, porque
-- apagar o presente para refletir uma decisão cadastral é perder informação.
-- =============================================================================
create or replace function public.set_operation_br_status(
  p_operation_br_id uuid,
  p_status          text,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br public.operation_brs;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Situação inválida para uma BR.' using errcode = 'invalid_parameter_value';
  end if;

  v_br := private.lock_br(p_operation_br_id, 'fidelization.manage_brs');

  if v_br.status = p_status then
    return;
  end if;

  update public.operation_brs
     set status = p_status,
         notes  = case
                    when nullif(btrim(coalesce(p_reason, '')), '') is null then notes
                    else left(
                      coalesce(notes || E'\n', '') ||
                      to_char(now(), 'DD/MM/YYYY') || ' — ' ||
                      case when p_status = 'inactive' then 'Inativada: ' else 'Reativada: ' end ||
                      btrim(p_reason), 2000)
                  end
   where id = p_operation_br_id;
end;
$$;

revoke execute on function public.set_operation_br_status(uuid, text, text) from public, anon;
grant  execute on function public.set_operation_br_status(uuid, text, text) to authenticated;

-- =============================================================================
-- public.fidelization_conflicts — §51, antes de tentar gravar
--
-- A constraint recusa o conflito de qualquer jeito. Esta função existe para que
-- a pessoa veja QUAL veículo, em QUAL BR, de QUAL operação e em QUE período —
-- em vez de uma mensagem dizendo que houve sobreposição.
-- =============================================================================
create or replace function public.fidelization_conflicts(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_start_date      date,
  p_end_date        date default null,
  p_exclude_id      uuid default null
)
returns table (
  assignment_id  uuid,
  operation_br_id uuid,
  br_code        text,
  operation_name text,
  city_name      text,
  start_date     date,
  end_date       date,
  status         text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.operation_br_id, b.code, o.name, c.name, a.start_date, a.end_date, a.status
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id
    join public.operations    o on o.id = b.operation_id
    join public.cities        c on c.id = b.city_id
   where a.organization_id = p_organization_id
     and a.vehicle_id = p_vehicle_id
     and a.status <> 'cancelled'
     and (p_exclude_id is null or a.id <> p_exclude_id)
     and daterange(a.start_date, a.end_date, '[]')
         && daterange(p_start_date, p_end_date, '[]')
   order by a.start_date;
$$;

revoke execute on function public.fidelization_conflicts(uuid, uuid, date, date, uuid) from public, anon;
grant  execute on function public.fidelization_conflicts(uuid, uuid, date, date, uuid) to authenticated;

comment on function public.fidelization_conflicts(uuid, uuid, date, date, uuid) is
  'SECURITY INVOKER de propósito: só enxerga os vínculos que as políticas já deixariam o chamador ler.';

-- =============================================================================
-- public.save_fidelization_assignment
-- =============================================================================
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
  v_br      public.operation_brs;
  v_current record;
begin
  if v_start is null then
    raise exception 'Informe a data de início da fidelização.' using errcode = 'invalid_parameter_value';
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

  perform private.assert_vehicle_fidelizable(p_organization_id, v_vehicle, v_br.operation_id);

  if v_id is null then
    insert into public.fidelization_assignments
      (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
    values
      (p_organization_id, v_br_id, v_vehicle, v_role, v_start, v_end, v_status, 'manual', v_reason)
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

revoke execute on function public.save_fidelization_assignment(uuid, jsonb) from public, anon;
grant  execute on function public.save_fidelization_assignment(uuid, jsonb) to authenticated;

-- =============================================================================
-- public.end_fidelization_assignment — §49, motivo obrigatório
-- =============================================================================
create or replace function public.end_fidelization_assignment(
  p_id       uuid,
  p_end_date date,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_br  public.operation_brs;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo do encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_assignments where id = p_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;

  v_br := private.lock_br(v_row.operation_br_id, 'fidelization.change_vehicle');

  if p_end_date is null then
    raise exception 'Informe a data de encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  if p_end_date < v_row.start_date then
    -- Encerrar antes de começar significa que o planejamento não aconteceu.
    update public.fidelization_assignments
       set status = 'cancelled', reason = btrim(p_reason)
     where id = p_id;
  else
    update public.fidelization_assignments
       set end_date = p_end_date, reason = btrim(p_reason)
     where id = p_id;
  end if;

  -- Motoristas não sobrevivem ao fim do vínculo que os hospeda: o gatilho de
  -- período recusaria a inconsistência, e deixá-los em aberto seria planejar
  -- alguém para uma posição que já não existe naquele dia.
  update public.fidelization_drivers
     set end_date = least(coalesce(end_date, p_end_date), p_end_date)
   where fidelization_assignment_id = p_id
     and status <> 'cancelled'
     and (end_date is null or end_date > p_end_date)
     and p_end_date >= start_date;

  update public.fidelization_drivers
     set status = 'cancelled'
   where fidelization_assignment_id = p_id
     and status <> 'cancelled'
     and start_date > p_end_date;
end;
$$;

revoke execute on function public.end_fidelization_assignment(uuid, date, text) from public, anon;
grant  execute on function public.end_fidelization_assignment(uuid, date, text) to authenticated;

-- =============================================================================
-- public.substitute_fidelization_vehicle — §49
--
-- Encerra o vínculo atual na véspera e abre o novo, apontando para o anterior.
-- As duas coisas numa transação: nunca existe o instante em que a BR ficou sem
-- veículo nenhum ou com dois.
-- =============================================================================
create or replace function public.substitute_fidelization_vehicle(
  p_assignment_id  uuid,
  p_new_vehicle_id uuid,
  p_effective_from date,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_br     public.operation_brs;
  v_new_id uuid;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo da substituição.' using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_from is null then
    raise exception 'Informe a data a partir da qual a substituição vale.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_assignments where id = p_assignment_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'Este vínculo está cancelado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_row.vehicle_id = p_new_vehicle_id then
    raise exception 'O veículo escolhido já é o veículo atual desta BR.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_row.end_date is not null and p_effective_from > v_row.end_date then
    raise exception 'A substituição (%) é posterior ao fim do vínculo (%).',
      to_char(p_effective_from, 'DD/MM/YYYY'), to_char(v_row.end_date, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  v_br := private.lock_br(v_row.operation_br_id, 'fidelization.change_vehicle');
  perform private.assert_vehicle_fidelizable(v_row.organization_id, p_new_vehicle_id, v_br.operation_id);

  -- Fecha primeiro. A ordem importa: a constraint de ocupação é imediata, e
  -- inserir o novo antes de fechar o antigo bateria contra ela.
  if p_effective_from <= v_row.start_date then
    update public.fidelization_assignments
       set status = 'cancelled', reason = btrim(p_reason)
     where id = p_assignment_id;
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, reason = btrim(p_reason)
     where id = p_assignment_id;

    update public.fidelization_drivers
       set end_date = p_effective_from - 1
     where fidelization_assignment_id = p_assignment_id
       and status <> 'cancelled'
       and (end_date is null or end_date > p_effective_from - 1)
       and start_date <= p_effective_from - 1;

    update public.fidelization_drivers
       set status = 'cancelled'
     where fidelization_assignment_id = p_assignment_id
       and status <> 'cancelled'
       and start_date > p_effective_from - 1;
  end if;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_row.organization_id, v_row.operation_br_id, p_new_vehicle_id, v_row.vehicle_role,
     greatest(p_effective_from, v_row.start_date), v_row.end_date,
     'planned', 'substitution', btrim(p_reason), p_assignment_id)
  returning id into v_new_id;

  return jsonb_build_object('previous_id', p_assignment_id, 'new_id', v_new_id);
end;
$$;

revoke execute on function public.substitute_fidelization_vehicle(uuid, uuid, date, text) from public, anon;
grant  execute on function public.substitute_fidelization_vehicle(uuid, uuid, date, text) to authenticated;

-- =============================================================================
-- public.invert_fidelization_vehicles — §50
--
-- BR A tem o veículo 1, BR B tem o veículo 2, e a partir de uma data passam a
-- ser 2 e 1. Uma função, uma transação, quatro linhas gravadas — nunca duas
-- substituições independentes, que entre uma e outra deixariam o veículo 2 em
-- duas BRs ao mesmo tempo e bateriam na constraint.
-- =============================================================================
create or replace function public.invert_fidelization_vehicles(
  p_assignment_a   uuid,
  p_assignment_b   uuid,
  p_effective_from date,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a      record;
  v_b      record;
  v_br_a   public.operation_brs;
  v_br_b   public.operation_brs;
  v_new_a  uuid;
  v_new_b  uuid;
  v_first  uuid;
  v_second uuid;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo da inversão.' using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_from is null then
    raise exception 'Informe a data a partir da qual a inversão vale.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_assignment_a = p_assignment_b then
    raise exception 'Escolha dois vínculos diferentes para inverter.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Travar sempre na mesma ordem. Duas inversões simultâneas dos mesmos dois
  -- vínculos, em sentidos opostos, travariam uma na outra para sempre.
  v_first  := least(p_assignment_a, p_assignment_b);
  v_second := greatest(p_assignment_a, p_assignment_b);
  perform 1 from public.fidelization_assignments where id = v_first  for update;
  perform 1 from public.fidelization_assignments where id = v_second for update;

  select * into v_a from public.fidelization_assignments where id = p_assignment_a;
  select * into v_b from public.fidelization_assignments where id = p_assignment_b;

  if v_a.id is null or v_b.id is null then
    raise exception 'Um dos vínculos de fidelização não foi encontrado.' using errcode = 'no_data_found';
  end if;
  if v_a.organization_id <> v_b.organization_id then
    raise exception 'Os vínculos pertencem a organizações diferentes.' using errcode = 'insufficient_privilege';
  end if;
  if v_a.status = 'cancelled' or v_b.status = 'cancelled' then
    raise exception 'Um dos vínculos está cancelado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_a.operation_br_id = v_b.operation_br_id then
    raise exception 'Os dois vínculos são da mesma BR — não há o que inverter.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_a.vehicle_id = v_b.vehicle_id then
    raise exception 'Os dois vínculos já são do mesmo veículo.' using errcode = 'invalid_parameter_value';
  end if;

  v_br_a := private.lock_br(v_a.operation_br_id, 'fidelization.change_vehicle');
  v_br_b := private.lock_br(v_b.operation_br_id, 'fidelization.change_vehicle');

  -- Cada veículo tem de ser elegível na operação para onde vai, não na de onde
  -- veio. Duas BRs podem ser de operações diferentes.
  perform private.assert_vehicle_fidelizable(v_a.organization_id, v_b.vehicle_id, v_br_a.operation_id);
  perform private.assert_vehicle_fidelizable(v_b.organization_id, v_a.vehicle_id, v_br_b.operation_id);

  -- Fecha os dois antes de abrir qualquer um.
  if p_effective_from <= v_a.start_date then
    update public.fidelization_assignments set status = 'cancelled', reason = btrim(p_reason) where id = v_a.id;
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, reason = btrim(p_reason) where id = v_a.id;
  end if;

  if p_effective_from <= v_b.start_date then
    update public.fidelization_assignments set status = 'cancelled', reason = btrim(p_reason) where id = v_b.id;
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, reason = btrim(p_reason) where id = v_b.id;
  end if;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_a.organization_id, v_a.operation_br_id, v_b.vehicle_id, v_a.vehicle_role,
     greatest(p_effective_from, v_a.start_date), v_a.end_date,
     'planned', 'inversion', btrim(p_reason), v_a.id)
  returning id into v_new_a;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_b.organization_id, v_b.operation_br_id, v_a.vehicle_id, v_b.vehicle_role,
     greatest(p_effective_from, v_b.start_date), v_b.end_date,
     'planned', 'inversion', btrim(p_reason), v_b.id)
  returning id into v_new_b;

  return jsonb_build_object(
    'previous', jsonb_build_array(v_a.id, v_b.id),
    'created',  jsonb_build_array(v_new_a, v_new_b)
  );
end;
$$;

revoke execute on function public.invert_fidelization_vehicles(uuid, uuid, date, text) from public, anon;
grant  execute on function public.invert_fidelization_vehicles(uuid, uuid, date, text) to authenticated;

comment on function public.invert_fidelization_vehicles(uuid, uuid, date, text) is
  'Inverte os veículos de dois vínculos de fidelização atomicamente (§50). Nunca executada como duas substituições independentes.';

-- =============================================================================
-- Motoristas
-- =============================================================================
create or replace function public.save_fidelization_driver(
  p_organization_id uuid,
  p_payload         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_assign    uuid := nullif(p_payload ->> 'fidelization_assignment_id', '')::uuid;
  v_employee  uuid := nullif(p_payload ->> 'employee_id', '')::uuid;
  v_role      text := coalesce(nullif(p_payload ->> 'driver_role', ''), 'primary');
  v_start     date := nullif(p_payload ->> 'start_date', '')::date;
  v_end       date := nullif(p_payload ->> 'end_date', '')::date;
  v_row       record;
  v_assignment record;
  v_emp       record;
begin
  if v_id is not null then
    select * into v_row from public.fidelization_drivers where id = v_id for update;
    if v_row.id is null then
      raise exception 'Vínculo de motorista não encontrado.' using errcode = 'no_data_found';
    end if;
    v_assign   := coalesce(v_assign, v_row.fidelization_assignment_id);
    v_employee := coalesce(v_employee, v_row.employee_id);
    v_start    := coalesce(v_start, v_row.start_date);
  end if;

  select * into v_assignment from public.fidelization_assignments
   where id = v_assign and organization_id = p_organization_id
   for update;
  if v_assignment.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;

  perform private.lock_br(v_assignment.operation_br_id, 'fidelization.change_driver');

  v_start := coalesce(v_start, v_assignment.start_date);

  -- §37: o motorista é um colaborador existente. Nada aqui cria colaborador,
  -- conta de acesso ou perfil — digitar um nome não inventa uma pessoa.
  select e.id, e.full_name, e.employment_status, e.deleted_at into v_emp
    from public.employees e
   where e.id = v_employee and e.organization_id = p_organization_id;

  if v_emp.id is null or v_emp.deleted_at is not null then
    raise exception 'Colaborador não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_emp.employment_status <> 'active' then
    raise exception 'O colaborador % não está ativo no cadastro.', v_emp.full_name
      using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.fidelization_drivers
      (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date)
    values
      (p_organization_id, v_assign, v_employee, v_role, v_start, coalesce(v_end, v_assignment.end_date))
    returning id into v_id;
  else
    update public.fidelization_drivers
       set employee_id = v_employee,
           driver_role = v_role,
           start_date  = v_start,
           end_date    = coalesce(v_end, v_assignment.end_date)
     where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_fidelization_driver(uuid, jsonb) from public, anon;
grant  execute on function public.save_fidelization_driver(uuid, jsonb) to authenticated;

create or replace function public.end_fidelization_driver(
  p_id       uuid,
  p_end_date date,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_assignment record;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo do encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_drivers where id = p_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de motorista não encontrado.' using errcode = 'no_data_found';
  end if;

  select * into v_assignment from public.fidelization_assignments
   where id = v_row.fidelization_assignment_id;
  perform private.lock_br(v_assignment.operation_br_id, 'fidelization.change_driver');

  if p_end_date is null then
    raise exception 'Informe a data de encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  if p_end_date < v_row.start_date then
    update public.fidelization_drivers
       set status = 'cancelled', reason = btrim(p_reason) where id = p_id;
  else
    update public.fidelization_drivers
       set end_date = p_end_date, reason = btrim(p_reason) where id = p_id;
  end if;
end;
$$;

revoke execute on function public.end_fidelization_driver(uuid, date, text) from public, anon;
grant  execute on function public.end_fidelization_driver(uuid, date, text) to authenticated;
