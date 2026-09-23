-- =============================================================================
-- Etapa 08 §20 e Etapa 13 §13–§14 · Lideranças — exportação e edição histórica
--
-- Aditiva. Nenhuma tabela perde coluna, nenhum dado é apagado ou reescrito.
--
--  1. Permissões `leadership.export` (Exportar, quando autorizado — §20) e
--     `leadership.manage_historical_data` (edição de competências históricas
--     somente mediante permissão específica — Etapa 13 §14). Até aqui nada
--     guardava a edição retroativa de uma liderança: qualquer `manage` mexia em
--     qualquer data. A regra é a mesma da fidelização (§44 da Etapa 15): mudar
--     quem respondia por um dia que já passou é correção histórica.
--  2. `leadership_assignments.change_reason`: o motivo da correção, gravado na
--     linha e, por ela, na trilha `audit_logs` (antes/depois) — §13.
--  3. `private.leadership_changed_days`: os dias passados em que uma alteração
--     muda quem responde. Uma regra só, usada pelo gatilho, pela rotina de
--     gravação e pela prévia de impacto — as três nunca discordam.
--  4. Gatilho `leadership_historical_guard`: vale para qualquer caminho que
--     escreva (editar, encerrar, replicar, a próxima rotina).
--  5. `save_leadership_assignment` passa a exigir o motivo de uma alteração
--     retroativa. O resto da rotina é o da Etapa 08, sem mudança.
--  6. `leadership_change_impact`: a prévia do impacto — BRs cuja liderança
--     muda, veículos e motoristas fidelizados nelas no período, checklists
--     executados e obrigações da Aderência do período. Somente leitura
--     (STABLE: o banco recusa qualquer escrita dentro dela).
--  7. `log_leadership_export`: toda exportação fica na auditoria; sem o
--     registro, a rota não entrega o arquivo.
--
-- O que esta migração NÃO faz, de propósito: não altera o contexto já gravado
-- em `checklist_executions` e `checklist_obligations`. Os dois guardam a
-- liderança do momento em que foram gerados (fotografia), e uma correção
-- retroativa da liderança não os regrava.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões e padrões por perfil
--
-- `leadership.export` segue os mesmos perfis que já exportam a fidelização
-- (administrador, gestao, gestor_frota, lideranca_operacoes). A correção
-- histórica, como na fidelização, fica com quem administra: o perfil
-- operacional planeja o mês corrente e os seguintes, e não reescreve o passado.
-- O gatilho `access_profile_defaults_sync` entrega os dois códigos aos papéis
-- existentes na mesma transação.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('leadership.export', 'leadership', 'Exportar lideranças',
   'Baixar em XLSX ou CSV as responsabilidades da competência com os filtros da tela (cada exportação fica na auditoria)'),
  ('leadership.manage_historical_data', 'leadership', 'Corrigir dados históricos da liderança',
   'Alterar vínculos de liderança em datas que já passaram (correção histórica com prévia de impacto, motivo e auditoria)')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code) values
  ('administrador',       'leadership.export'),
  ('gestao',              'leadership.export'),
  ('gestor_frota',        'leadership.export'),
  ('lideranca_operacoes', 'leadership.export'),
  ('administrador',       'leadership.manage_historical_data')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Motivo da correção histórica
-- -----------------------------------------------------------------------------
alter table public.leadership_assignments
  add column if not exists change_reason text;

alter table public.leadership_assignments
  drop constraint if exists leadership_change_reason_check;
alter table public.leadership_assignments
  add constraint leadership_change_reason_check
  check (change_reason is null or length(change_reason) <= 500);

comment on column public.leadership_assignments.change_reason is
  'Motivo informado na última gravação (obrigatório quando a alteração muda a liderança de dias que já passaram — Etapa 13 §14). '
  'A sequência completa de motivos fica em audit_logs.';

-- -----------------------------------------------------------------------------
-- 3. Os dias passados em que uma alteração muda quem responde
--
-- A cobertura de uma linha é o seu período, exceto quando cancelada (nunca
-- vigorou). Se a pessoa, o escopo ou a função mudam, todos os dias do período
-- antigo e do novo mudam; se só as datas mudam, só a diferença entre os dois.
-- O resultado é recortado em `p_until` (exclusivo): o que interessa é o
-- passado. `p_old` nulo (todos os campos nulos) é uma criação.
-- -----------------------------------------------------------------------------
create or replace function private.leadership_changed_days(
  p_old   public.leadership_assignments,
  p_new   public.leadership_assignments,
  p_until date
)
returns datemultirange
language sql
immutable
set search_path = ''
as $$
  with cov as (
    select
      case when p_old.id is null or p_old.status = 'cancelled' or p_old.effective_from is null
           then '{}'::datemultirange
           else datemultirange(daterange(p_old.effective_from, p_old.effective_to, '[]')) end as o,
      case when p_new.status = 'cancelled' or p_new.effective_from is null
           then '{}'::datemultirange
           else datemultirange(daterange(p_new.effective_from, p_new.effective_to, '[]')) end as n,
      (p_old.id is null
        or p_old.employee_id         is distinct from p_new.employee_id
        or p_old.scope_level         is distinct from p_new.scope_level
        or p_old.operation_id        is distinct from p_new.operation_id
        or p_old.operation_city_id   is distinct from p_new.operation_city_id
        or p_old.operation_br_id     is distinct from p_new.operation_br_id
        or p_old.responsibility_type is distinct from p_new.responsibility_type) as moved
  )
  select case when moved then o + n else (o + n) - (o * n) end
         * datemultirange(daterange(null, p_until, '[)'))
    from cov;
$$;

revoke execute on function private.leadership_changed_days(public.leadership_assignments, public.leadership_assignments, date)
  from public, anon;

comment on function private.leadership_changed_days(public.leadership_assignments, public.leadership_assignments, date) is
  'Dias anteriores a p_until em que a alteração muda a cobertura do vínculo (Etapa 13 §14). Vazio = não retroativa.';

-- -----------------------------------------------------------------------------
-- 4. A regra: alterar a liderança de um dia anterior a hoje exige permissão.
--
-- Um gatilho, e não um teste em cada rotina, porque são várias as rotinas que
-- escrevem vínculos (salvar, encerrar, replicar) e a próxima também
-- escreveria. Encerrar ontem não é retroativo: nenhum dia passado muda de
-- responsável. Rotinas do sistema (sem sessão) não passam por aqui. "Hoje" é
-- o de São Paulo, o mesmo da fidelização.
-- -----------------------------------------------------------------------------
create or replace function private.tg_leadership_historical_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old  public.leadership_assignments;
  v_days datemultirange;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := old;
  end if;

  v_days := private.leadership_changed_days(v_old, new, private.fidelization_today());

  if not isempty(v_days)
     and not private.has_permission(new.organization_id, 'leadership.manage_historical_data') then
    raise exception 'Alterar a liderança de datas que já passaram (a partir de %) é uma correção histórica e exige a permissão "Corrigir dados históricos da liderança".',
      to_char(lower(v_days), 'DD/MM/YYYY')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_leadership_historical_guard() from public, anon;

drop trigger if exists leadership_historical_guard on public.leadership_assignments;
create trigger leadership_historical_guard
  before insert or update on public.leadership_assignments
  for each row execute function private.tg_leadership_historical_guard();

-- =============================================================================
-- 5. public.save_leadership_assignment(uuid, jsonb)
--
-- A rotina da Etapa 08 com dois acréscimos:
--   * quando a gravação muda a liderança de dias que já passaram, ela exige a
--     permissão de correção histórica e o motivo (`change_reason`), e devolve
--     `retroactive`. A tela mostra a prévia (`leadership_change_impact`) antes;
--   * na edição, o vínculo que já existe também precisa estar no escopo de
--     quem edita (antes só a operação de destino era conferida).
-- O resto — validações, avisos §19, `assign` para trocar a pessoa, conflito de
-- edição simultânea — é o mesmo.
-- =============================================================================
create or replace function public.save_leadership_assignment(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid    := nullif(p_payload ->> 'id', '')::uuid;
  v_is_new    boolean := v_id is null;
  v_employee  uuid    := nullif(p_payload ->> 'employee_id', '')::uuid;
  v_scope     text    := coalesce(nullif(p_payload ->> 'scope_level', ''), 'operation');
  v_operation uuid    := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_city      uuid    := nullif(p_payload ->> 'operation_city_id', '')::uuid;
  v_br        uuid    := nullif(p_payload ->> 'operation_br_id', '')::uuid;
  v_type      text    := coalesce(nullif(p_payload ->> 'responsibility_type', ''), 'principal');
  v_from      date    := nullif(p_payload ->> 'effective_from', '')::date;
  v_to        date    := nullif(p_payload ->> 'effective_to', '')::date;
  v_notes     text    := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_reason    text    := nullif(btrim(coalesce(p_payload ->> 'change_reason', '')), '');
  v_expected  timestamptz := nullif(p_payload ->> 'expected_updated_at', '')::timestamptz;
  v_current   public.leadership_assignments;
  v_new       public.leadership_assignments;
  v_days      datemultirange;
  v_retro     boolean := false;
  v_warnings  text[]  := array[]::text[];
  v_emp       record;
  v_op        record;
begin
  if v_operation is null then
    raise exception 'Informe a operação da responsabilidade.' using errcode = 'invalid_parameter_value';
  end if;
  if v_employee is null then
    raise exception 'Informe o colaborador responsável.' using errcode = 'invalid_parameter_value';
  end if;
  if v_from is null then
    raise exception 'Informe a data de início da responsabilidade.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to is not null and v_to < v_from then
    raise exception 'O fim da vigência (%) não pode ser anterior ao início (%).',
      to_char(v_to, 'DD/MM/YYYY'), to_char(v_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'O motivo da correção pode ter no máximo 500 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_governance_access(
    p_organization_id, v_operation, 'leadership.manage',
    'Você não possui permissão para gerenciar lideranças.');

  -- ------------------------------------------------------------ coerência ---
  if v_scope not in ('operation', 'city', 'br') then
    raise exception 'Nível de responsabilidade inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_scope = 'operation' then
    v_city := null; v_br := null;
  elsif v_scope = 'city' then
    v_br := null;
    if v_city is null then
      raise exception 'Informe a cidade da responsabilidade.' using errcode = 'invalid_parameter_value';
    end if;
  else
    if v_br is null then
      raise exception 'Informe a BR da responsabilidade.' using errcode = 'invalid_parameter_value';
    end if;
    select operation_city_id into v_city from public.operation_brs
     where id = v_br and organization_id = p_organization_id and deleted_at is null;
    if v_city is null then
      raise exception 'A BR informada não existe nesta organização.' using errcode = 'no_data_found';
    end if;
  end if;

  if v_city is not null and not exists (
    select 1 from public.operation_cities c
     where c.id = v_city and c.organization_id = p_organization_id and c.operation_id = v_operation
  ) then
    raise exception 'A cidade informada não faz parte da cobertura desta operação.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---------------------------------------------------------- colaborador ---
  select e.id, e.full_name, e.employment_status, e.deleted_at
    into v_emp
    from public.employees e
   where e.id = v_employee and e.organization_id = p_organization_id;

  if v_emp.id is null or v_emp.deleted_at is not null then
    raise exception 'Colaborador não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  if v_emp.employment_status <> 'active' then
    v_warnings := v_warnings ||
      format('%s não está com situação ativa no cadastro de colaboradores.', v_emp.full_name);
  end if;

  if not exists (
    select 1 from public.employee_assignments a
     where a.employee_id = v_employee
       and a.organization_id = p_organization_id
       and a.is_current
       and a.operation_id = v_operation
  ) then
    v_warnings := v_warnings ||
      format('%s não possui vínculo funcional atual com esta operação. A designação não altera a operação nem o acesso do colaborador.',
             v_emp.full_name);
  end if;

  -- ------------------------------------------------------------- operação ---
  select o.status, o.deleted_at into v_op
    from public.operations o
   where o.id = v_operation and o.organization_id = p_organization_id;

  if v_op.deleted_at is not null then
    raise exception 'Esta operação foi arquivada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_is_new and v_op.status <> 'active' then
    raise exception 'Não é possível criar responsabilidades em uma operação inativa.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- --------------------------------------------------- designar / carregar ---
  if v_is_new then
    if not private.has_permission(p_organization_id, 'leadership.assign') then
      raise exception 'Você não possui permissão para designar responsáveis.'
        using errcode = 'insufficient_privilege';
    end if;
    v_new.organization_id := p_organization_id;
    v_new.status          := 'active';
  else
    select * into v_current
      from public.leadership_assignments
     where id = v_id and organization_id = p_organization_id
     for update;

    if v_current.id is null then
      raise exception 'Vínculo de liderança não encontrado.' using errcode = 'no_data_found';
    end if;

    -- O vínculo que se edita também precisa estar no escopo de quem edita.
    if not private.can_access_operation(v_current.operation_id) then
      raise exception 'Esta operação não faz parte do seu escopo de acesso.'
        using errcode = 'insufficient_privilege';
    end if;

    if v_expected is not null and v_current.updated_at <> v_expected then
      raise exception 'Este vínculo foi alterado por outra pessoa enquanto você editava. Recarregue e tente de novo.'
        using errcode = 'serialization_failure';
    end if;

    if v_current.employee_id <> v_employee
       and not private.has_permission(p_organization_id, 'leadership.assign') then
      raise exception 'Você não possui permissão para designar responsáveis.'
        using errcode = 'insufficient_privilege';
    end if;
    v_new := v_current;
  end if;

  -- ------------------------------------------------ correção histórica §14 ---
  v_new.employee_id         := v_employee;
  v_new.scope_level         := v_scope;
  v_new.operation_id        := v_operation;
  v_new.operation_city_id   := v_city;
  v_new.operation_br_id     := v_br;
  v_new.responsibility_type := v_type;
  v_new.effective_from      := v_from;
  v_new.effective_to        := v_to;

  v_days  := private.leadership_changed_days(v_current, v_new, private.fidelization_today());
  v_retro := not isempty(v_days);

  if v_retro then
    if not private.has_permission(p_organization_id, 'leadership.manage_historical_data') then
      raise exception 'Alterar a liderança de datas que já passaram (a partir de %) é uma correção histórica e exige a permissão "Corrigir dados históricos da liderança".',
        to_char(lower(v_days), 'DD/MM/YYYY')
        using errcode = 'insufficient_privilege';
    end if;
    if v_reason is null then
      raise exception 'Informe o motivo da correção histórica: a alteração muda a liderança de dias que já passaram (a partir de %).',
        to_char(lower(v_days), 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ---------------------------------------------------------------- gravar ---
  if v_is_new then
    insert into public.leadership_assignments
      (organization_id, employee_id, scope_level, operation_id, operation_city_id,
       operation_br_id, responsibility_type, effective_from, effective_to, notes, change_reason)
    values
      (p_organization_id, v_employee, v_scope, v_operation, v_city,
       v_br, v_type, v_from, v_to, v_notes, v_reason)
    returning id into v_id;
  else
    update public.leadership_assignments
       set employee_id         = v_employee,
           scope_level         = v_scope,
           operation_id        = v_operation,
           operation_city_id   = v_city,
           operation_br_id     = v_br,
           responsibility_type = v_type,
           effective_from      = v_from,
           effective_to        = v_to,
           notes               = v_notes,
           change_reason       = v_reason
     where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'warnings', to_jsonb(v_warnings), 'retroactive', v_retro);
end;
$$;

revoke execute on function public.save_leadership_assignment(uuid, jsonb) from public, anon;
grant  execute on function public.save_leadership_assignment(uuid, jsonb) to authenticated;

comment on function public.save_leadership_assignment(uuid, jsonb) is
  'Cria ou edita uma responsabilidade operacional. Alteração que muda a liderança de dias passados exige '
  'leadership.manage_historical_data e change_reason (Etapa 13 §14). Não altera Perfil de Acesso, escopos nem employee_assignments (§12, §27).';

-- =============================================================================
-- 6. public.leadership_change_impact(uuid, jsonb) — a prévia do impacto (§14)
--
-- Recebe o mesmo payload de `save_leadership_assignment` e responde, sem
-- gravar nada, o que mudaria nos dias que já passaram:
--
--   * BRs cuja liderança resolvida muda — pela mesma precedência da §43
--     (exceção do BR › cidade › operação, só `principal` e `active`), antes e
--     depois da alteração, dia a dia;
--   * veículos e motoristas fidelizados nessas BRs nos dias que mudam;
--   * checklists executados (enviados) e obrigações da Aderência (ativas)
--     desses lugares nesses dias — registros sem BR entram pela cidade ou
--     pela operação, como na resolução da Aderência.
--
-- Contagens mais uma amostra curta. Checklists e obrigações NÃO são
-- regravados pela alteração: guardam a liderança do momento em que foram
-- gerados. `recent_pending_obligations` conta as de ontem ainda sem checklist
-- nem decisão, que a rotina automática da Aderência (ontem e hoje) ainda pode
-- realinhar — o resto fica como está.
--
-- STABLE: o próprio banco recusa INSERT/UPDATE/DELETE aqui dentro.
-- =============================================================================
create or replace function public.leadership_change_impact(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id        uuid    := nullif(p_payload ->> 'id', '')::uuid;
  v_employee  uuid    := nullif(p_payload ->> 'employee_id', '')::uuid;
  v_scope     text    := coalesce(nullif(p_payload ->> 'scope_level', ''), 'operation');
  v_operation uuid    := nullif(p_payload ->> 'operation_id', '')::uuid;
  v_city      uuid    := nullif(p_payload ->> 'operation_city_id', '')::uuid;
  v_br        uuid    := nullif(p_payload ->> 'operation_br_id', '')::uuid;
  v_type      text    := coalesce(nullif(p_payload ->> 'responsibility_type', ''), 'principal');
  v_from      date    := nullif(p_payload ->> 'effective_from', '')::date;
  v_to        date    := nullif(p_payload ->> 'effective_to', '')::date;
  v_sample    integer := least(greatest(coalesce(nullif(p_payload ->> 'sample_size', '')::integer, 8), 1), 25);
  v_today     date    := private.fidelization_today();
  v_current   public.leadership_assignments;
  v_new       public.leadership_assignments;
  v_days      datemultirange;
  v_periods   jsonb;
  v_past_days integer;
  v_result    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente para continuar.' using errcode = 'insufficient_privilege';
  end if;
  if v_operation is null then
    raise exception 'Informe a operação da responsabilidade.' using errcode = 'invalid_parameter_value';
  end if;
  if v_employee is null then
    raise exception 'Informe o colaborador responsável.' using errcode = 'invalid_parameter_value';
  end if;
  if v_from is null then
    raise exception 'Informe a data de início da responsabilidade.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to is not null and v_to < v_from then
    raise exception 'O fim da vigência (%) não pode ser anterior ao início (%).',
      to_char(v_to, 'DD/MM/YYYY'), to_char(v_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_type not in ('principal', 'substitute', 'support') then
    raise exception 'Função de responsabilidade inválida.' using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_governance_access(
    p_organization_id, v_operation, 'leadership.manage',
    'Você não possui permissão para gerenciar lideranças.');

  -- A mesma normalização do escopo que a gravação faz.
  if v_scope not in ('operation', 'city', 'br') then
    raise exception 'Nível de responsabilidade inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_scope = 'operation' then
    v_city := null; v_br := null;
  elsif v_scope = 'city' then
    v_br := null;
    if v_city is null then
      raise exception 'Informe a cidade da responsabilidade.' using errcode = 'invalid_parameter_value';
    end if;
  else
    if v_br is null then
      raise exception 'Informe a BR da responsabilidade.' using errcode = 'invalid_parameter_value';
    end if;
    select operation_city_id into v_city from public.operation_brs
     where id = v_br and organization_id = p_organization_id and deleted_at is null;
    if v_city is null then
      raise exception 'A BR informada não existe nesta organização.' using errcode = 'no_data_found';
    end if;
  end if;
  if v_city is not null and not exists (
    select 1 from public.operation_cities c
     where c.id = v_city and c.organization_id = p_organization_id and c.operation_id = v_operation
  ) then
    raise exception 'A cidade informada não faz parte da cobertura desta operação.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.employees e
     where e.id = v_employee and e.organization_id = p_organization_id and e.deleted_at is null
  ) then
    raise exception 'Colaborador não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  if v_id is not null then
    select * into v_current
      from public.leadership_assignments
     where id = v_id and organization_id = p_organization_id;
    if v_current.id is null then
      raise exception 'Vínculo de liderança não encontrado.' using errcode = 'no_data_found';
    end if;
    if not private.can_access_operation(v_current.operation_id) then
      raise exception 'Esta operação não faz parte do seu escopo de acesso.'
        using errcode = 'insufficient_privilege';
    end if;
    v_new := v_current;
  else
    v_new.organization_id := p_organization_id;
    v_new.status          := 'active';
  end if;

  v_new.employee_id         := v_employee;
  v_new.scope_level         := v_scope;
  v_new.operation_id        := v_operation;
  v_new.operation_city_id   := v_city;
  v_new.operation_br_id     := v_br;
  v_new.responsibility_type := v_type;
  v_new.effective_from      := v_from;
  v_new.effective_to        := v_to;

  v_days := private.leadership_changed_days(v_current, v_new, v_today);

  if isempty(v_days) then
    return jsonb_build_object(
      'retroactive', false, 'today', v_today, 'periods', '[]'::jsonb, 'past_days', 0,
      'changed_days', 0, 'snapshots_preserved', true, 'recent_pending_obligations', 0,
      'brs',         jsonb_build_object('count', 0, 'sample', '[]'::jsonb),
      'vehicles',    jsonb_build_object('count', 0, 'sample', '[]'::jsonb),
      'drivers',     jsonb_build_object('count', 0, 'sample', '[]'::jsonb),
      'checklists',  jsonb_build_object('count', 0, 'sample', '[]'::jsonb),
      'obligations', jsonb_build_object('count', 0, 'sample', '[]'::jsonb));
  end if;

  -- Retroativa: só quem pode corrigir o passado vê o que a correção alcança.
  if not private.has_permission(p_organization_id, 'leadership.manage_historical_data') then
    raise exception 'Alterar a liderança de datas que já passaram (a partir de %) é uma correção histórica e exige a permissão "Corrigir dados históricos da liderança".',
      to_char(lower(v_days), 'DD/MM/YYYY')
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('from', lower(r), 'to', upper(r) - 1) order by lower(r)), '[]'::jsonb),
         coalesce(sum(upper(r) - lower(r)), 0)
    into v_periods, v_past_days
    from unnest(v_days) r;

  with
  days as (
    select g::date as day
      from unnest(v_days) r,
           generate_series(lower(r)::timestamp, (upper(r) - 1)::timestamp, interval '1 day') g
  ),
  ops as (
    select v_new.operation_id as id
    union
    select v_current.operation_id where v_current.id is not null
  ),
  -- Lugares: cada BR, e a cidade / a operação para registros sem BR.
  places as (
    select b.id as br_id, b.code as br_code, b.operation_id, b.operation_city_id
      from public.operation_brs b
     where b.organization_id = p_organization_id and b.deleted_at is null
       and b.operation_id in (select id from ops)
    union all
    select null::uuid, null::text, c.operation_id, c.id
      from public.operation_cities c
     where c.organization_id = p_organization_id and c.operation_id in (select id from ops)
    union all
    select null::uuid, null::text, o.id, null::uuid from ops o
  ),
  -- Só os lugares que a linha antiga ou a nova alcançam podem mudar.
  touched as (
    select p.*
      from places p
     where exists (
       select 1
         from (values (v_current.scope_level, v_current.operation_id, v_current.operation_city_id, v_current.operation_br_id),
                      (v_new.scope_level,     v_new.operation_id,     v_new.operation_city_id,     v_new.operation_br_id)) s(lvl, op, city, br)
        where (s.lvl = 'br'        and p.br_id is not null             and s.br   = p.br_id)
           or (s.lvl = 'city'      and p.operation_city_id is not null and s.city = p.operation_city_id)
           or (s.lvl = 'operation' and s.op = p.operation_id))
  ),
  current_rows as (
    select l.id, l.employee_id, l.scope_level, l.operation_id, l.operation_city_id, l.operation_br_id,
           l.effective_from, l.effective_to, l.status, l.responsibility_type
      from public.leadership_assignments l
     where l.organization_id = p_organization_id
       and l.operation_id in (select id from ops)
  ),
  proposed_rows as (
    select * from current_rows c where c.id is distinct from v_current.id
    union all
    select v_new.id, v_new.employee_id, v_new.scope_level, v_new.operation_id, v_new.operation_city_id,
           v_new.operation_br_id, v_new.effective_from, v_new.effective_to, v_new.status, v_new.responsibility_type
  ),
  resolved as (
    select t.br_id, t.br_code, t.operation_id, t.operation_city_id, d.day,
           (select c.employee_id from current_rows c
             where c.status = 'active' and c.responsibility_type = 'principal'
               and c.effective_from <= d.day and (c.effective_to is null or c.effective_to >= d.day)
               and (   (c.scope_level = 'br'        and t.br_id is not null             and c.operation_br_id   = t.br_id)
                    or (c.scope_level = 'city'      and t.operation_city_id is not null and c.operation_city_id = t.operation_city_id)
                    or (c.scope_level = 'operation' and c.operation_id = t.operation_id))
             order by case c.scope_level when 'br' then 1 when 'city' then 2 else 3 end, c.effective_from desc
             limit 1) as before_employee,
           (select c.employee_id from proposed_rows c
             where c.status = 'active' and c.responsibility_type = 'principal'
               and c.effective_from <= d.day and (c.effective_to is null or c.effective_to >= d.day)
               and (   (c.scope_level = 'br'        and t.br_id is not null             and c.operation_br_id   = t.br_id)
                    or (c.scope_level = 'city'      and t.operation_city_id is not null and c.operation_city_id = t.operation_city_id)
                    or (c.scope_level = 'operation' and c.operation_id = t.operation_id))
             order by case c.scope_level when 'br' then 1 when 'city' then 2 else 3 end, c.effective_from desc
             limit 1) as after_employee
      from touched t
      cross join days d
  ),
  changed as (
    select * from resolved where before_employee is distinct from after_employee
  ),
  place_days as (
    select c.br_id, c.br_code, c.operation_id, c.operation_city_id,
           range_agg(daterange(c.day, c.day, '[]')) as days,
           min(c.day) as first_day, max(c.day) as last_day, count(*)::integer as day_count,
           array_agg(distinct c.before_employee) filter (where c.before_employee is not null) as before_ids,
           array_agg(distinct c.after_employee)  filter (where c.after_employee  is not null) as after_ids
      from changed c
     group by c.br_id, c.br_code, c.operation_id, c.operation_city_id
  ),
  br_list as (
    select pd.*, o.name as operation_name, ci.name as city_name, st.uf as state_uf
      from place_days pd
      join public.operation_brs b on b.id = pd.br_id
      join public.operations o on o.id = b.operation_id
      left join public.cities ci on ci.id = b.city_id
      left join public.states st on st.id = b.state_id
     where pd.br_id is not null
  ),
  veh as (
    select a.vehicle_id, a.operation_br_id, pd.br_code,
           pd.days * datemultirange(daterange(a.start_date, a.end_date, '[]')) as overlap
      from place_days pd
      join public.fidelization_assignments a
        on a.operation_br_id = pd.br_id and a.organization_id = p_organization_id and a.status <> 'cancelled'
     where pd.br_id is not null
       and pd.days && daterange(a.start_date, a.end_date, '[]')
  ),
  drv as (
    select d.employee_id, a.operation_br_id, pd.br_code, d.driver_role,
           pd.days * datemultirange(daterange(d.start_date, d.end_date, '[]')) as overlap
      from place_days pd
      join public.fidelization_assignments a
        on a.operation_br_id = pd.br_id and a.organization_id = p_organization_id and a.status <> 'cancelled'
      join public.fidelization_drivers d
        on d.fidelization_assignment_id = a.id and d.status <> 'cancelled'
     where pd.br_id is not null
       and pd.days && daterange(d.start_date, d.end_date, '[]')
       and pd.days && daterange(a.start_date, a.end_date, '[]')
  ),
  exe as (
    select e.id, e.operational_date, e.checklist_type, e.license_plate_snapshot, e.fleet_code_snapshot,
           e.leader_employee_id, pd.br_code
      from place_days pd
      join public.checklist_executions e
        on e.organization_id = p_organization_id and e.status = 'submitted'
       and e.operational_date <@ pd.days
       and (   (pd.br_id is not null and e.operation_br_id = pd.br_id)
            or (pd.br_id is null and e.operation_br_id is null and e.operation_id = pd.operation_id
                and (select oc.id from public.operation_cities oc
                      where oc.operation_id = e.operation_id and oc.city_id = e.city_id
                      limit 1) is not distinct from pd.operation_city_id))
  ),
  obl as (
    select o.id, o.operational_date, o.checklist_context, o.license_plate_snapshot, o.fleet_code_snapshot,
           o.leader_employee_id, pd.br_code,
           (not exists (select 1 from public.checklist_obligation_matches m where m.obligation_id = o.id and m.is_valid)
            and not exists (select 1 from public.adherence_requests q
                             where q.obligation_id = o.id and q.status in ('approved', 'pending'))) as open_item
      from place_days pd
      join public.checklist_obligations o
        on o.organization_id = p_organization_id and o.is_active
       and o.operational_date <@ pd.days
       and (   (pd.br_id is not null and o.operation_br_id = pd.br_id)
            or (pd.br_id is null and o.operation_br_id is null and o.operation_id = pd.operation_id
                and o.operation_city_id is not distinct from pd.operation_city_id))
  )
  select jsonb_build_object(
    'retroactive', true,
    'today', v_today,
    'periods', v_periods,
    'past_days', v_past_days,
    'changed_days', (select count(distinct day) from changed where br_id is not null),
    'snapshots_preserved', true,
    'recent_pending_obligations', (select count(*) from obl where open_item and operational_date >= v_today - 1),
    'brs', jsonb_build_object(
      'count', (select count(*) from br_list),
      'sample', coalesce((
        select jsonb_agg(x.j order by x.code)
          from (select bl.br_code as code, jsonb_build_object(
                  'operation_br_id', bl.br_id, 'code', bl.br_code, 'operation_name', bl.operation_name,
                  'city_name', bl.city_name, 'state_uf', bl.state_uf,
                  'first_day', bl.first_day, 'last_day', bl.last_day, 'days', bl.day_count,
                  'leaders_before', coalesce((select jsonb_agg(e.full_name order by e.full_name)
                                                from public.employees e where e.id = any (bl.before_ids)), '[]'::jsonb),
                  'leaders_after',  coalesce((select jsonb_agg(e.full_name order by e.full_name)
                                                from public.employees e where e.id = any (bl.after_ids)), '[]'::jsonb)) as j
                  from br_list bl order by bl.br_code limit v_sample) x), '[]'::jsonb)),
    'vehicles', jsonb_build_object(
      'count', (select count(distinct vehicle_id) from veh),
      'sample', coalesce((
        select jsonb_agg(x.j order by x.k)
          from (select y.k, y.j
                  from (select distinct on (v.vehicle_id)
                               coalesce(vh.fleet_code, vh.license_plate, '') as k,
                               jsonb_build_object('vehicle_id', v.vehicle_id, 'fleet_code', vh.fleet_code,
                                 'license_plate', vh.license_plate, 'br_code', v.br_code,
                                 'from', lower(v.overlap), 'to', upper(v.overlap) - 1) as j
                          from veh v join public.vehicles vh on vh.id = v.vehicle_id
                         order by v.vehicle_id, lower(v.overlap)) y
                 order by y.k
                 limit v_sample) x), '[]'::jsonb)),
    'drivers', jsonb_build_object(
      'count', (select count(distinct employee_id) from drv),
      'sample', coalesce((
        select jsonb_agg(x.j order by x.k)
          from (select y.k, y.j
                  from (select distinct on (d.employee_id)
                               e.full_name as k,
                               jsonb_build_object('employee_id', d.employee_id, 'name', e.full_name,
                                 'employee_code', e.employee_code, 'br_code', d.br_code, 'driver_role', d.driver_role,
                                 'from', lower(d.overlap), 'to', upper(d.overlap) - 1) as j
                          from drv d join public.employees e on e.id = d.employee_id
                         order by d.employee_id, lower(d.overlap)) y
                 order by y.k
                 limit v_sample) x), '[]'::jsonb)),
    'checklists', jsonb_build_object(
      'count', (select count(*) from exe),
      'sample', coalesce((
        select jsonb_agg(x.j order by x.d, x.k)
          from (select ex.operational_date as d, coalesce(ex.br_code, '') as k,
                       jsonb_build_object('id', ex.id, 'operational_date', ex.operational_date,
                         'checklist_type', ex.checklist_type, 'br_code', ex.br_code,
                         'license_plate', ex.license_plate_snapshot, 'fleet_code', ex.fleet_code_snapshot,
                         'leader_name', (select e.full_name from public.employees e where e.id = ex.leader_employee_id)) as j
                  from exe ex order by ex.operational_date, ex.br_code limit v_sample) x), '[]'::jsonb)),
    'obligations', jsonb_build_object(
      'count', (select count(*) from obl),
      'open', (select count(*) from obl where open_item),
      'sample', coalesce((
        select jsonb_agg(x.j order by x.d, x.k)
          from (select ob.operational_date as d, coalesce(ob.br_code, '') as k,
                       jsonb_build_object('id', ob.id, 'operational_date', ob.operational_date,
                         'checklist_context', ob.checklist_context, 'br_code', ob.br_code,
                         'license_plate', ob.license_plate_snapshot, 'fleet_code', ob.fleet_code_snapshot,
                         'open', ob.open_item,
                         'leader_name', (select e.full_name from public.employees e where e.id = ob.leader_employee_id)) as j
                  from obl ob order by ob.operational_date, ob.br_code limit v_sample) x), '[]'::jsonb))
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.leadership_change_impact(uuid, jsonb) from public, anon;
grant  execute on function public.leadership_change_impact(uuid, jsonb) to authenticated;

comment on function public.leadership_change_impact(uuid, jsonb) is
  'Etapa 13 §14: prévia, sem gravar nada, do que uma alteração de liderança muda nos dias que já passaram — BRs cuja '
  'liderança resolvida muda, veículos e motoristas fidelizados nelas, checklists executados e obrigações da Aderência '
  'do período (contagens e amostra). Exige leadership.manage no escopo da operação e, quando retroativa, '
  'leadership.manage_historical_data. Checklists e obrigações guardam a liderança da época e não são regravados.';

-- =============================================================================
-- 7. public.log_leadership_export — toda exportação fica na auditoria
-- =============================================================================
create or replace function public.log_leadership_export(
  p_organization_id uuid,
  p_format          text,
  p_row_count       integer,
  p_filters         jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente para continuar.' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'leadership.export') then
    raise exception 'Você não possui permissão para exportar lideranças.' using errcode = 'insufficient_privilege';
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') then
    raise exception 'Formato de exportação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'Quantidade de linhas inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(v_filters) <> 'object' then
    v_filters := '{}'::jsonb;
  end if;

  insert into public.audit_logs
    (organization_id, user_id, entity_type, entity_id, action, new_data)
  values
    (p_organization_id, (select auth.uid()), 'leadership_export', null, 'EXPORT',
     jsonb_build_object(
       'format', p_format,
       'row_count', p_row_count,
       -- Só os filtros da tela, e curtos: a auditoria não é depósito de texto livre.
       'filters', jsonb_strip_nulls(jsonb_build_object(
         'ano',       left(v_filters ->> 'ano', 8),
         'mes',       left(v_filters ->> 'mes', 4),
         'operacao',  left(v_filters ->> 'operacao', 64),
         'uf',        left(v_filters ->> 'uf', 16),
         'cidade',    left(v_filters ->> 'cidade', 16),
         'nivel',     left(v_filters ->> 'nivel', 16),
         'situacao',  left(v_filters ->> 'situacao', 16),
         'lideranca', left(v_filters ->> 'lideranca', 64)))));
end;
$$;

revoke execute on function public.log_leadership_export(uuid, text, integer, jsonb) from public, anon;
grant  execute on function public.log_leadership_export(uuid, text, integer, jsonb) to authenticated;

comment on function public.log_leadership_export(uuid, text, integer, jsonb) is
  'Etapa 08 §20: registra uma exportação de Lideranças (formato, linhas, filtros) na auditoria. Exige leadership.export. '
  'A rota não entrega o arquivo sem este registro.';
