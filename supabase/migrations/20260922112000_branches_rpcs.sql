-- =============================================================================
-- ETAPA 09 · AS ROTINAS DA FILIAL
--
-- `save_branch` grava a filial e os seus vínculos operacionais numa transação só
-- (§56). Se qualquer parte falhar, nada entra — nunca existe a filial salva com
-- metade das operações.
--
-- Os vínculos são atualizados por DIFERENÇA (§57), nunca apagando e recriando
-- tudo: recriar destruiria as vigências e faria toda filial parecer ter sido
-- vinculada a todas as suas operações na data da última edição.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.normalize_document — CNPJ em dígitos
-- -----------------------------------------------------------------------------
create or replace function private.normalize_document(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '');
$$;

revoke execute on function private.normalize_document(text) from public, anon;
grant  execute on function private.normalize_document(text) to authenticated;

-- =============================================================================
-- public.branch_impact — o que realmente depende desta filial
--
-- Contagens reais, lidas das tabelas (§51: "Não utilizar contadores fictícios").
-- Colaboradores e veículos são contados por identidade distinta: um colaborador
-- com dois assignments históricos na mesma filial é uma pessoa, não duas.
-- =============================================================================
create or replace function public.branch_impact(p_organization_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_result jsonb;
begin
  select organization_id into v_org
    from public.organization_units where id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view') then
    raise exception 'Você não possui permissão para consultar filiais.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'active_employees', (
      select count(distinct a.employee_id)
        from public.employee_assignments a
        join public.employees e on e.id = a.employee_id
       where a.organization_unit_id = p_organization_unit_id
         and a.is_current
         and e.deleted_at is null
         and e.employment_status = 'active'),
    'total_employees', (
      select count(distinct a.employee_id)
        from public.employee_assignments a
       where a.organization_unit_id = p_organization_unit_id),
    'active_vehicles', (
      select count(distinct v.id)
        from public.vehicles v
       where v.organization_unit_id = p_organization_unit_id
         and v.deleted_at is null
         and v.status = 'active'),
    'total_vehicles', (
      select count(distinct a.vehicle_id)
        from public.vehicle_unit_assignments a
       where a.organization_unit_id = p_organization_unit_id),
    'current_operations', (
      select count(*)
        from public.organization_unit_operations o
       where o.organization_unit_id = p_organization_unit_id
         and (o.effective_to is null or o.effective_to >= current_date)),
    'historical_operations', (
      select count(*)
        from public.organization_unit_operations o
       where o.organization_unit_id = p_organization_unit_id),
    'cost_centers', (
      select count(*)
        from public.cost_centers c
       where c.organization_unit_id = p_organization_unit_id
         and c.deleted_at is null),
    'work_locations', (
      select count(*)
        from public.work_locations w
       where w.organization_unit_id = p_organization_unit_id
         and w.deleted_at is null)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.branch_impact(uuid) from public, anon;
grant  execute on function public.branch_impact(uuid) to authenticated;

-- =============================================================================
-- public.branch_operation_impact — o que depende deste vínculo específico
--
-- §26: antes de desvincular uma operação, quem depende daquela combinação
-- filial × operação. Nada é transferido nem apagado por esta rotina — ela só
-- conta, para que a decisão seja tomada com o número na frente.
-- =============================================================================
create or replace function public.branch_operation_impact(
  p_organization_unit_id uuid,
  p_operation_id         uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_units where id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view') then
    raise exception 'Você não possui permissão para consultar filiais.'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'employees', (
      select count(distinct a.employee_id)
        from public.employee_assignments a
       where a.organization_unit_id = p_organization_unit_id
         and a.operation_id = p_operation_id
         and a.is_current),
    'vehicles', (
      select count(distinct v.id)
        from public.vehicles v
        join public.vehicle_operation_assignments va
          on va.vehicle_id = v.id
         and (va.effective_to is null or va.effective_to >= current_date)
       where v.organization_unit_id = p_organization_unit_id
         and va.operation_id = p_operation_id
         and v.deleted_at is null)
  );
end;
$$;

revoke execute on function public.branch_operation_impact(uuid, uuid) from public, anon;
grant  execute on function public.branch_operation_impact(uuid, uuid) to authenticated;

-- =============================================================================
-- public.save_branch
-- =============================================================================
create or replace function public.save_branch(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_is_new    boolean := v_id is null;
  v_code      text := private.normalize_code(p_payload ->> 'code');
  v_name      text := btrim(coalesce(p_payload ->> 'name', ''));
  v_legal     text := nullif(btrim(coalesce(p_payload ->> 'legal_name', '')), '');
  v_document  text := private.normalize_document(p_payload ->> 'document_number');
  v_notes     text := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_postal    text := private.normalize_document(p_payload ->> 'postal_code');
  v_state     smallint := nullif(p_payload ->> 'state_id', '')::smallint;
  v_city      integer  := nullif(p_payload ->> 'city_id', '')::integer;
  v_expected  timestamptz := nullif(p_payload ->> 'expected_updated_at', '')::timestamptz;
  v_status_in text := nullif(btrim(coalesce(p_payload ->> 'status', '')), '');
  v_operations uuid[];
  v_current   record;
  v_op        uuid;
  v_status    text;
begin
  if v_name = '' then
    raise exception 'Informe o nome da filial.' using errcode = 'invalid_parameter_value';
  end if;
  if v_code is null then
    raise exception 'Informe o código interno da filial.' using errcode = 'invalid_parameter_value';
  end if;
  -- §15: o CNPJ é opcional, mas um CNPJ inválido nunca é um registro válido. A
  -- constraint recusaria de qualquer forma; a mensagem aqui é em português.
  if v_document is not null and not private.is_valid_cnpj(v_document) then
    raise exception 'O CNPJ informado é inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is not null and v_state is null then
    raise exception 'Informe o estado do endereço da filial.' using errcode = 'invalid_parameter_value';
  end if;
  -- §45 lista Situação entre os Dados Gerais. Aceitar o campo e descartá-lo em
  -- silêncio seria pior do que não aceitá-lo: a tela diria "salvo" e a filial
  -- continuaria ativa.
  if v_status_in is not null and v_status_in not in ('active', 'inactive') then
    raise exception 'Situação inválida para uma filial.' using errcode = 'invalid_parameter_value';
  end if;

  -- A lista de operações desejadas. Ausente significa "não mexer nos vínculos";
  -- um array vazio significa "desvincular todas", que é uma ordem diferente.
  --
  -- Testa o TIPO e não a presença da chave: `?` também é verdadeiro para um
  -- `"operations": null`, que é o que um formulário serializa quando o campo
  -- nunca foi tocado — e aí jsonb_array_elements_text receberia um escalar e
  -- devolveria um erro do PostgreSQL no lugar de uma frase em português.
  if jsonb_typeof(p_payload -> 'operations') = 'array' then
    select coalesce(array_agg(value::text::uuid), array[]::uuid[])
      into v_operations
      from jsonb_array_elements_text(p_payload -> 'operations') as value;
  end if;

  -- ---------------------------------------------------------------- criar ---
  if v_is_new then
    if not private.has_permission(p_organization_id, 'branches.create') then
      raise exception 'Você não possui permissão para cadastrar filiais.'
        using errcode = 'insufficient_privilege';
    end if;
    if coalesce(v_status_in, 'active') <> 'active'
       and not private.has_permission(p_organization_id, 'branches.deactivate') then
      raise exception 'Você não possui permissão para cadastrar uma filial já inativa.'
        using errcode = 'insufficient_privilege';
    end if;

    insert into public.organization_units
      (organization_id, unit_type, code, name, legal_name, document_number, status, notes,
       postal_code, street, street_number, complement, district, state_id, city_id)
    values
      (p_organization_id, 'branch', v_code, v_name, v_legal, v_document,
       coalesce(v_status_in, 'active'), v_notes,
       v_postal,
       nullif(btrim(coalesce(p_payload ->> 'street', '')), ''),
       nullif(btrim(coalesce(p_payload ->> 'street_number', '')), ''),
       nullif(btrim(coalesce(p_payload ->> 'complement', '')), ''),
       nullif(btrim(coalesce(p_payload ->> 'district', '')), ''),
       v_state, v_city)
    returning id into v_id;

  -- --------------------------------------------------------------- editar ---
  else
    if not private.has_permission(p_organization_id, 'branches.update') then
      raise exception 'Você não possui permissão para editar filiais.'
        using errcode = 'insufficient_privilege';
    end if;

    select * into v_current
      from public.organization_units
     where id = v_id and organization_id = p_organization_id and deleted_at is null
     for update;

    if v_current.id is null then
      raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
    end if;
    if v_expected is not null and v_current.updated_at <> v_expected then
      raise exception 'Esta filial foi alterada por outra pessoa enquanto você editava. Recarregue e tente de novo.'
        using errcode = 'serialization_failure';
    end if;

    if v_status_in is not null and v_status_in <> v_current.status
       and not private.has_permission(p_organization_id, 'branches.deactivate') then
      raise exception 'Você não possui permissão para alterar a situação da filial.'
        using errcode = 'insufficient_privilege';
    end if;

    update public.organization_units
       set status          = coalesce(v_status_in, status),
           code            = v_code,
           name            = v_name,
           legal_name      = v_legal,
           document_number = v_document,
           notes           = v_notes,
           postal_code     = v_postal,
           street          = nullif(btrim(coalesce(p_payload ->> 'street', '')), ''),
           street_number   = nullif(btrim(coalesce(p_payload ->> 'street_number', '')), ''),
           complement      = nullif(btrim(coalesce(p_payload ->> 'complement', '')), ''),
           district        = nullif(btrim(coalesce(p_payload ->> 'district', '')), ''),
           state_id        = v_state,
           city_id         = v_city
     where id = v_id;
  end if;

  -- ------------------------------------------------------------- vínculos ---
  if v_operations is not null then
    if not private.has_permission(p_organization_id, 'branches.manage_operations') then
      raise exception 'Você não possui permissão para gerenciar as operações da filial.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Encerra os que saíram. Nunca apaga: o relatório de agosto tem de continuar
    -- reconhecendo a associação de agosto (§27).
    --
    -- O fim é a VÉSPERA, não hoje. A vigência é inclusiva nas duas pontas, então
    -- fechar em `current_date` deixaria a linha ocupando o dia de hoje — e
    -- desmarcar uma operação por engano e remarcá-la no mesmo minuto, que é o
    -- primeiro erro que qualquer pessoa comete nesta tela, bateria na constraint
    -- de sobreposição. `greatest` cuida do vínculo criado hoje mesmo, que não
    -- tem véspera onde caber.
    update public.organization_unit_operations
       set effective_to = greatest(effective_from, current_date - 1)
     where organization_unit_id = v_id
       and effective_to is null
       and operation_id <> all (v_operations);

    -- Cria os que entraram, e só eles. Os que já estavam ficam intocados, com a
    -- vigência original — que é o ponto do §57.
    foreach v_op in array v_operations loop
      if exists (
        select 1 from public.organization_unit_operations
         where organization_unit_id = v_id
           and operation_id = v_op
           and effective_to is null
      ) then
        continue;
      end if;

      -- Remarcada logo depois de ter sido desmarcada: o vínculo volta a ficar
      -- aberto em vez de nascer uma segunda linha. Duas linhas contariam a
      -- história de uma interrupção que não houve.
      update public.organization_unit_operations
         set effective_to = null
       where organization_unit_id = v_id
         and operation_id = v_op
         and effective_to >= current_date - 1;

      if found then
        continue;
      end if;

      select o.status into v_status
        from public.operations o
       where o.id = v_op and o.organization_id = p_organization_id and o.deleted_at is null;

      if v_status is null then
        raise exception 'Uma das operações informadas não existe nesta organização.'
          using errcode = 'invalid_parameter_value';
      end if;
      -- §25: operação inativa não recebe vínculo novo. Os vínculos históricos
      -- com ela continuam de pé e consultáveis.
      if v_status <> 'active' then
        raise exception 'Não é possível vincular uma operação inativa à filial.'
          using errcode = 'invalid_parameter_value';
      end if;

      insert into public.organization_unit_operations
        (organization_id, organization_unit_id, operation_id, effective_from)
      values (p_organization_id, v_id, v_op, current_date);
    end loop;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_branch(uuid, jsonb) from public, anon;
grant  execute on function public.save_branch(uuid, jsonb) to authenticated;

comment on function public.save_branch(uuid, jsonb) is
  'Cria ou edita uma filial e os seus vínculos operacionais em uma transação (§56). Os vínculos são atualizados por diferença, nunca apagados e recriados (§57).';

-- =============================================================================
-- public.set_branch_status
--
-- §17 e §52: inativar não apaga nada. A filial some das listas de vínculo novo
-- e continua respondendo por tudo o que já está pendurado nela.
-- §54: reativar não restaura vínculos operacionais encerrados — quem quiser a
-- operação de volta vincula de novo, e a nova vigência começa hoje.
-- =============================================================================
create or replace function public.set_branch_status(
  p_organization_unit_id uuid,
  p_status               text,
  p_reason               text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Situação inválida para uma filial.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.organization_units
   where id = p_organization_unit_id and deleted_at is null
   for update;

  if v_row.id is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_row.organization_id, 'branches.deactivate') then
    raise exception 'Você não possui permissão para inativar filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.status = p_status then
    return;
  end if;

  -- O motivo vai para a sua própria coluna, nunca para Observações (§20). Quem
  -- mudou e quando já estão na trilha de auditoria, que é append-only.
  update public.organization_units
     set status        = p_status,
         status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_organization_unit_id;

  perform private.emit_event(
    v_row.organization_id,
    case when p_status = 'inactive' then 'branch.deactivated' else 'branch.activated' end,
    'organization_unit',
    p_organization_unit_id,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end;
$$;

revoke execute on function public.set_branch_status(uuid, text, text) from public, anon;
grant  execute on function public.set_branch_status(uuid, text, text) to authenticated;

-- =============================================================================
-- public.transfer_vehicle_branch — §34
--
-- Registra filial anterior, nova filial, início, fim do vínculo anterior,
-- motivo e — pela trilha de auditoria — o responsável. Sobrescrever
-- `vehicles.organization_unit_id` sozinho apagaria cinco dessas seis coisas.
--
-- A coluna em `vehicles` continua sendo a filial atual e é atualizada aqui, na
-- mesma transação, para que a listagem de frota não precise de um join só para
-- saber de quem é o veículo.
-- =============================================================================
create or replace function public.transfer_vehicle_branch(
  p_vehicle_id           uuid,
  p_organization_unit_id uuid,
  p_effective_from       date,
  p_reason               text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_veh      record;
  v_unit     record;
  v_current  record;
  v_why      text := nullif(btrim(coalesce(p_reason, '')), '');
  v_from     date := coalesce(p_effective_from, current_date);
  v_new_id   uuid;
begin
  if v_why is null then
    raise exception 'Informe o motivo da transferência.' using errcode = 'invalid_parameter_value';
  end if;

  select v.id, v.organization_id, v.organization_unit_id, v.deleted_at,
         coalesce(v.fleet_code, v.license_plate, 'sem identificação') as label
    into v_veh
    from public.vehicles v where v.id = p_vehicle_id
   for update;

  if v_veh.id is null or v_veh.deleted_at is not null then
    raise exception 'Veículo não encontrado.' using errcode = 'no_data_found';
  end if;

  -- Duas permissões, porque são dois cadastros: a filial recebe o veículo e o
  -- veículo muda de responsável.
  if not private.has_permission(v_veh.organization_id, 'branches.update') then
    raise exception 'Você não possui permissão para transferir veículos entre filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.vehicle_in_scope(v_veh.organization_id, p_vehicle_id) then
    raise exception 'Este veículo não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_unit from public.organization_units
   where id = p_organization_unit_id
     and organization_id = v_veh.organization_id
     and deleted_at is null;

  if v_unit.id is null then
    raise exception 'Filial não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if v_unit.status <> 'active' then
    raise exception 'A filial % está inativa e não recebe novos veículos.', v_unit.name
      using errcode = 'invalid_parameter_value';
  end if;
  if v_veh.organization_unit_id = p_organization_unit_id then
    raise exception 'O veículo % já pertence a esta filial.', v_veh.label
      using errcode = 'invalid_parameter_value';
  end if;

  -- §35: a combinação filial × operação tem de existir na estrutura. Um veículo
  -- alocado em Last Mile MG não passa a ser responsabilidade de uma filial que
  -- só atende Merchandising — isso não é uma transferência, é uma inconsistência
  -- que ninguém descobriria até o primeiro relatório por filial.
  if exists (
    select 1 from public.vehicle_operation_assignments va
     where va.vehicle_id = p_vehicle_id
       and va.effective_from <= v_from
       and (va.effective_to is null or va.effective_to >= v_from)
  ) and not exists (
    select 1
      from public.vehicle_operation_assignments va
      join public.organization_unit_operations uo
        on uo.organization_unit_id = p_organization_unit_id
       and uo.operation_id = va.operation_id
       and uo.effective_from <= v_from
       and (uo.effective_to is null or uo.effective_to >= v_from)
     where va.vehicle_id = p_vehicle_id
       and va.effective_from <= v_from
       and (va.effective_to is null or va.effective_to >= v_from)
  ) then
    raise exception 'A filial % não atende a operação em que o veículo % está alocado. Vincule a operação à filial antes de transferir.',
      v_unit.name, v_veh.label
      using errcode = 'invalid_parameter_value';
  end if;

  -- Encerra o vínculo anterior na véspera. A ordem importa: a constraint de
  -- sobreposição é imediata.
  select * into v_current
    from public.vehicle_unit_assignments
   where vehicle_id = p_vehicle_id and effective_to is null
   for update;

  if v_current.id is not null then
    if v_from <= v_current.effective_from then
      raise exception 'A transferência (%) não pode começar antes do vínculo atual (%).',
        to_char(v_from, 'DD/MM/YYYY'), to_char(v_current.effective_from, 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value';
    end if;
    update public.vehicle_unit_assignments
       set effective_to = v_from - 1, reason = coalesce(reason, v_why)
     where id = v_current.id;
  end if;

  insert into public.vehicle_unit_assignments
    (organization_id, vehicle_id, organization_unit_id, effective_from, reason)
  values
    (v_veh.organization_id, p_vehicle_id, p_organization_unit_id, v_from, v_why)
  returning id into v_new_id;

  -- A coluna em `vehicles` é a filial de HOJE. Uma transferência agendada para
  -- o mês que vem não pode alterá-la agora: por dez dias o veículo apareceria
  -- em uma filial na listagem e em outra no seu próprio histórico. Quando a
  -- data chegar, é a linha de vigência que responde — e a listagem passa a lê-la.
  if v_from <= current_date then
    update public.vehicles
       set organization_unit_id = p_organization_unit_id
     where id = p_vehicle_id;
  end if;

  perform private.emit_event(
    v_veh.organization_id, 'branch.vehicle_transferred', 'vehicle', p_vehicle_id,
    jsonb_build_object(
      'previous_unit_id', v_veh.organization_unit_id,
      'new_unit_id',      p_organization_unit_id,
      'effective_from',   v_from,
      'reason',           v_why));

  return jsonb_build_object(
    'assignment_id',        v_new_id,
    'previous_unit_id',     v_veh.organization_unit_id,
    'new_unit_id',          p_organization_unit_id,
    'effective_from',       v_from,
    'scheduled',            v_from > current_date
  );
end;
$$;

revoke execute on function public.transfer_vehicle_branch(uuid, uuid, date, text) from public, anon;
grant  execute on function public.transfer_vehicle_branch(uuid, uuid, date, text) to authenticated;

comment on function public.transfer_vehicle_branch(uuid, uuid, date, text) is
  'Transfere a responsabilidade de um veículo entre filiais, com vigência e motivo (§34). Não altera a operação, a cidade nem a fidelização do veículo.';
