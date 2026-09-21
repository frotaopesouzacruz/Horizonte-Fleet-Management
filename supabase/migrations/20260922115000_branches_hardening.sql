-- =============================================================================
-- Etapa 09 — endurecimento das Filiais
--
-- Cinco defeitos encontrados por auditoria adversarial depois que o módulo já
-- estava aplicado. Nenhum deles aparece em uso normal com um Administrador,
-- que enxerga todas as operações; todos aparecem com os perfis que o próprio
-- HFM entrega escopados.
--
--  1. `branch_impact` e `branch_operation_impact` são SECURITY DEFINER e o
--     único portão era `branches.view`. Como o dono é `postgres` e `postgres`
--     tem `rolbypassrls`, as políticas `employee_assignments_select` (que
--     restringe a `accessible_operation_ids()`) e `vehicles_select` (que aplica
--     `vehicle_in_scope`) simplesmente não rodavam. Um Liderança de Operações
--     escopado em Merchandising recebia o efetivo e a frota da filial inteira,
--     incluindo Last Mile MG — §64: "Não permitir que os indicadores ou a
--     exportação revelem dados de operações às quais o usuário não possui
--     acesso". `lideranca_operacoes` e `gestor_frota` têm `branches.view` e não
--     têm `operations.access_all`, então o caminho estava aberto por padrão.
--
--  2. `branch_operation_impact` era pior: `p_operation_id` não era conferido
--     contra a organização nem contra o escopo. Com os ids que
--     `unit_operations_select` devolve, virava um oráculo operação a operação.
--
--  3. `transfer_vehicle_branch` aceitava data futura, devolvia `scheduled` e
--     prometia no comentário que "quando a data chegar, é a linha de vigência
--     que responde". Não responde: `vehicle_directory`, `branch_vehicles`, o
--     filtro por filial e `branch_impact.active_vehicles` leem
--     `vehicles.organization_unit_id`, e não existe rotina que promova a linha
--     agendada. A transferência nunca acontecia — e ainda travava o veículo,
--     porque a linha nova passava a ser a única aberta.
--
--  4. `vehicle_unit_assignments` foi criada como o histórico de §34, mas
--     `save_vehicle` e `apply_vehicle_import` continuavam escrevendo
--     `vehicles.organization_unit_id` direto. Com os 95 veículos sem filial
--     hoje, o primeiro veículo que recebesse uma filial pelo formulário de
--     frota produziria `active_vehicles: 1, total_vehicles: 0` — o contador
--     fictício que §51 proíbe, sem vigência, sem motivo e sem responsável.
--
--  5. `organization_units_status_idx` era cópia byte a byte de
--     `organization_units_org_active_idx`, e o índice único de código passou a
--     conviver com o `organization_units_org_code_key` que já existia. O
--     PostgreSQL relatava o mais antigo, que não é o nome que
--     `src/lib/branches/actions.ts` procura: quem repetia um código interno
--     recebia o erro cru do Postgres em vez da mensagem em português.
--
-- Nada aqui apaga dado, afrouxa RLS ou muda a matriz de permissões.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. public.branch_impact — as mesmas contagens, dentro do escopo de quem olha
--
-- Segue SECURITY DEFINER de propósito. O eixo que a função atravessa é o de
-- *permissão*: quem tem `branches.view` vê o tamanho da filial sem precisar de
-- `users.view`, `vehicles.view` ou `cost_centers.view` — do contrário o painel
-- de inativação mostraria zero para quem não tem esses acessos, e um zero falso
-- antes de inativar é exatamente o contador fictício de §51.
--
-- O eixo que ela NÃO pode atravessar é o de *operação*. Os predicados abaixo
-- reproduzem literalmente os das políticas: a cláusula de operação de
-- `employee_assignments_select` e `private.vehicle_in_scope`, que é o que
-- `vehicles_select` e `vehicle_unit_assignments_select` aplicam.
--
-- `current_operations`, `historical_operations`, `cost_centers` e
-- `work_locations` ficam como estão: `unit_operations_select` é deliberadamente
-- por organização (documentado em 111000) e as outras duas tabelas não têm eixo
-- de operação para espelhar.
-- -----------------------------------------------------------------------------
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
         and e.employment_status = 'active'
         and (v_org in (select private.permitted_org_ids('operations.access_all'))
              or a.operation_id in (select private.accessible_operation_ids()))),
    'total_employees', (
      select count(distinct a.employee_id)
        from public.employee_assignments a
       where a.organization_unit_id = p_organization_unit_id
         and (v_org in (select private.permitted_org_ids('operations.access_all'))
              or a.operation_id in (select private.accessible_operation_ids()))),
    'active_vehicles', (
      select count(distinct v.id)
        from public.vehicles v
       where v.organization_unit_id = p_organization_unit_id
         and v.deleted_at is null
         and v.status = 'active'
         and private.vehicle_in_scope(v.organization_id, v.id)),
    'total_vehicles', (
      select count(distinct a.vehicle_id)
        from public.vehicle_unit_assignments a
       where a.organization_unit_id = p_organization_unit_id
         and private.vehicle_in_scope(a.organization_id, a.vehicle_id)),
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

comment on function public.branch_impact(uuid) is
  'Dependências reais da filial antes de inativar (§51). SECURITY DEFINER para '
  'atravessar o eixo de permissão — quem tem branches.view vê o tamanho da '
  'filial sem users.view ou vehicles.view —, mas nunca o eixo de operação: os '
  'contadores de colaboradores e veículos repetem os predicados de escopo das '
  'políticas, porque um total calculado fora do escopo é vazamento por '
  'agregação (§64).';

-- -----------------------------------------------------------------------------
-- 2. public.branch_operation_impact — a operação precisa ser alcançável
--
-- Mesmo padrão e mesma mensagem que 20260922106000_governance_hardening.sql já
-- usa. Depois deste portão as duas contagens não precisam de mais nada: elas
-- já estão presas a `p_operation_id`, e o que está dentro do escopo pode ser
-- contado.
-- -----------------------------------------------------------------------------
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

  -- A operação tem de ser desta organização — um id de outro tenant não vira
  -- contagem nem vira zero, vira erro.
  if not exists (
    select 1 from public.operations o
     where o.id = p_operation_id
       and o.organization_id = v_org
  ) then
    raise exception 'Operação não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
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

comment on function public.branch_operation_impact(uuid, uuid) is
  'Quem depende da combinação filial × operação antes de desvincular (§26). '
  'A operação é conferida contra a organização e contra o escopo do chamador '
  'antes de qualquer contagem (§64).';

-- -----------------------------------------------------------------------------
-- 3. public.transfer_vehicle_branch — vale a partir de hoje, e só
--
-- A transferência agendada era uma promessa que o sistema não cumpre. Enquanto
-- `vehicles.organization_unit_id` for a filial de hoje para todo mundo que lê,
-- aceitar uma data futura é aceitar uma transferência que nunca acontece.
-- Retroagir continua funcionando: é um registro do que já ocorreu.
--
-- Agendar de verdade é outra etapa: exigiria resolver a filial corrente a
-- partir de `vehicle_unit_assignments` em `vehicle_directory`, `branch_vehicles`,
-- `branch_impact` e no filtro por filial — como a frota já faz para operações
-- em 20260920107000 — e aposentar a coluna como fonte de verdade.
-- -----------------------------------------------------------------------------
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

  if v_from > current_date then
    raise exception 'A transferência de filial vale a partir de hoje; não é possível agendá-la para %.',
      to_char(v_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
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

  -- A coluna em `vehicles` é a filial corrente e é o que todo mundo lê. Ela sai
  -- daqui sempre sincronizada, na mesma transação — o gatilho
  -- `vehicles_sync_unit` reconhece que a linha de vigência já é esta e não
  -- escreve nada em cima.
  update public.vehicles
     set organization_unit_id = p_organization_unit_id
   where id = p_vehicle_id;

  perform private.emit_event(
    v_veh.organization_id, 'branch.vehicle_transferred', 'vehicle', p_vehicle_id,
    jsonb_build_object(
      'previous_unit_id', v_veh.organization_unit_id,
      'new_unit_id',      p_organization_unit_id,
      'effective_from',   v_from,
      'reason',           v_why));

  return jsonb_build_object(
    'assignment_id',    v_new_id,
    'previous_unit_id', v_veh.organization_unit_id,
    'new_unit_id',      p_organization_unit_id,
    'effective_from',   v_from);
end;
$$;

revoke execute on function public.transfer_vehicle_branch(uuid, uuid, date, text) from public, anon;
grant  execute on function public.transfer_vehicle_branch(uuid, uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. private.tg_sync_vehicle_unit — o histórico deixa de depender de boa vontade
--
-- `save_vehicle` e `apply_vehicle_import` escrevem a coluna direto, e continuam
-- podendo: quem garante o histórico passa a ser a tabela, não quem escreve nela.
-- Mesmo padrão de `vehicles_status_history`, que já faz isso para `status`.
--
-- Os três desvios existem por um motivo cada:
--   · a linha aberta já apontando para a filial nova é a marca de
--     `transfer_vehicle_branch`, que insere antes de tocar na coluna — fechá-la
--     violaria `vehicle_unit_period_check`;
--   · uma linha que começou hoje não tem véspera onde encerrar e o DELETE está
--     bloqueado, então ela é corrigida no lugar;
--   · AFTER e `return null` mantêm o gatilho fora da linha que está sendo
--     escrita, e `update of organization_unit_id` o mantém fora do caminho
--     quente de qualquer outra edição de veículo.
-- -----------------------------------------------------------------------------
create or replace function private.tg_sync_vehicle_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open record;
begin
  if tg_op = 'INSERT' and new.organization_unit_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.organization_unit_id is not distinct from old.organization_unit_id then
    return null;
  end if;

  select * into v_open
    from public.vehicle_unit_assignments
   where vehicle_id = new.id and effective_to is null
   for update;

  if v_open.id is not null
     and v_open.organization_unit_id = new.organization_unit_id then
    return null;
  end if;

  if v_open.id is not null then
    if v_open.effective_from >= current_date then
      if new.organization_unit_id is null then
        update public.vehicle_unit_assignments
           set effective_to = v_open.effective_from
         where id = v_open.id;
      else
        update public.vehicle_unit_assignments
           set organization_unit_id = new.organization_unit_id
         where id = v_open.id;
        return null;
      end if;
    else
      update public.vehicle_unit_assignments
         set effective_to = current_date - 1
       where id = v_open.id;
    end if;
  end if;

  if new.organization_unit_id is not null then
    insert into public.vehicle_unit_assignments
      (organization_id, vehicle_id, organization_unit_id, effective_from, reason)
    values
      (new.organization_id, new.id, new.organization_unit_id, current_date,
       'Filial definida pelo Cadastro de Frotas.');
  end if;

  return null;
end;
$$;

revoke execute on function private.tg_sync_vehicle_unit() from public, anon;

drop trigger if exists vehicles_sync_unit on public.vehicles;
create trigger vehicles_sync_unit
  after insert or update of organization_unit_id on public.vehicles
  for each row execute function private.tg_sync_vehicle_unit();

-- Recupera o que já existe: os veículos que hoje têm filial e nenhuma linha de
-- vigência. Hoje são zero (os 95 estão sem filial), mas o backfill de 110000 já
-- rodou e esta migração pode ser aplicada a um banco que não é este.
insert into public.vehicle_unit_assignments
  (organization_id, vehicle_id, organization_unit_id, effective_from, reason)
select v.organization_id, v.id, v.organization_unit_id,
       coalesce(v.created_at::date, current_date),
       'Vínculo reconstruído a partir do cadastro do veículo.'
  from public.vehicles v
 where v.organization_unit_id is not null
   and not exists (
     select 1 from public.vehicle_unit_assignments a
      where a.vehicle_id = v.id
   );

-- -----------------------------------------------------------------------------
-- 5. Índices duplicados
--
-- `organization_units_org_active_idx` (organization_id, status) where
-- deleted_at is null existe desde a fundação; `organization_units_status_idx`
-- era a mesma definição com outro nome.
--
-- E o código interno passou a ter dois índices únicos equivalentes: o antigo
-- sobre `code` e o novo sobre `private.normalize_code(code)` — equivalentes
-- porque o gatilho `organization_units_normalize` já grava normalizado. Manter
-- os dois não fortalece a regra; só faz o PostgreSQL relatar o mais antigo,
-- que não é o nome que a aplicação procura. Fica o funcional, que continua
-- correto mesmo se o gatilho for contornado (uma restauração com
-- session_replication_role = replica, por exemplo).
--
-- Nenhuma FK depende de (organization_id, code): todas referenciam
-- (organization_id, id), servido por `organization_units_org_id_key`.
-- -----------------------------------------------------------------------------
drop index if exists public.organization_units_status_idx;
drop index if exists public.organization_units_org_code_key;
