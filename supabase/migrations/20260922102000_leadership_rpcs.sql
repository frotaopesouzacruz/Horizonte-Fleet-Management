-- =============================================================================
-- ETAPA 08 · AS ROTINAS DE LIDERANÇA
--
-- Três rotinas, e cada uma faz uma coisa só: designar, encerrar, replicar.
-- Nenhuma delas escreve em `roles`, `membership_roles`, `access_profiles` ou
-- `employee_assignments` — e isso não é um detalhe de implementação, é o §12 e
-- o §27 escritos em código. Designar alguém como responsável por uma cidade é
-- um fato operacional; o que essa pessoa pode fazer no HFM continua vindo do
-- fluxo administrativo da Etapa 05, e quem é o líder imediato dela continua
-- vindo de `employee_assignments.manager_employee_id`, que ninguém aqui toca.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.competence_range(year, month)
--
-- Uma competência é o mês inteiro, com o último dia incluído — é como a gestão
-- fala ("setembro/2026") e como o calendário desenha. Concentrar a conversão
-- num lugar evita que metade do módulo use o dia 30 e a outra metade o dia 1º
-- do mês seguinte.
-- -----------------------------------------------------------------------------
create or replace function private.competence_range(p_year integer, p_month integer)
returns daterange
language sql
immutable
set search_path = ''
as $$
  select daterange(
    make_date(p_year, p_month, 1),
    (make_date(p_year, p_month, 1) + interval '1 month')::date,
    '[)'
  );
$$;

revoke execute on function private.competence_range(integer, integer) from public, anon;

-- -----------------------------------------------------------------------------
-- private.assert_governance_access
--
-- A mesma verificação em todas as rotinas da etapa: a permissão na organização
-- e o alcance da operação. Separadas, porque as duas respostas erradas são
-- diferentes — "você não pode fazer isto" e "isto não está no seu escopo" — e
-- confundi-las é o que faz alguém passar uma tarde procurando uma permissão que
-- já tem.
-- -----------------------------------------------------------------------------
create or replace function private.assert_governance_access(
  p_organization_id uuid,
  p_operation_id    uuid,
  p_permission      text,
  p_denied_message  text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, p_permission) then
    raise exception '%', p_denied_message using errcode = 'insufficient_privilege';
  end if;

  if p_operation_id is not null and not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function private.assert_governance_access(uuid, uuid, text, text) from public, anon;

-- =============================================================================
-- public.save_leadership_assignment(uuid, jsonb)
--
-- Retorna `{id, warnings[]}`. Os avisos são o §19: um colaborador sem vínculo
-- funcional com a operação pode ser designado — há casos legítimos, como quem
-- responde por duas operações — mas a pessoa que está designando precisa saber
-- disso antes de salvar, e não descobrir depois pelo relatório.
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
  v_expected  timestamptz := nullif(p_payload ->> 'expected_updated_at', '')::timestamptz;
  v_current   record;
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

  perform private.assert_governance_access(
    p_organization_id, v_operation, 'leadership.manage',
    'Você não possui permissão para gerenciar lideranças.');

  -- ------------------------------------------------------------ coerência ---
  -- A forma do escopo é conferida aqui antes da constraint só para que a frase
  -- seja em português e diga qual campo falta.
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

  -- §19: aviso, não bloqueio. Atuar em mais de uma operação é legítimo; o que
  -- não pode é acontecer sem que ninguém perceba.
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

  -- ---------------------------------------------------------------- criar ---
  if v_is_new then
    if not private.has_permission(p_organization_id, 'leadership.assign') then
      raise exception 'Você não possui permissão para designar responsáveis.'
        using errcode = 'insufficient_privilege';
    end if;

    insert into public.leadership_assignments
      (organization_id, employee_id, scope_level, operation_id, operation_city_id,
       operation_br_id, responsibility_type, effective_from, effective_to, notes)
    values
      (p_organization_id, v_employee, v_scope, v_operation, v_city,
       v_br, v_type, v_from, v_to, v_notes)
    returning id into v_id;

  -- --------------------------------------------------------------- editar ---
  else
    select * into v_current
      from public.leadership_assignments
     where id = v_id and organization_id = p_organization_id
     for update;

    if v_current.id is null then
      raise exception 'Vínculo de liderança não encontrado.' using errcode = 'no_data_found';
    end if;

    -- Quem salvou por último não apaga o trabalho de quem salvou antes sem saber.
    if v_expected is not null and v_current.updated_at <> v_expected then
      raise exception 'Este vínculo foi alterado por outra pessoa enquanto você editava. Recarregue e tente de novo.'
        using errcode = 'serialization_failure';
    end if;

    -- Trocar a pessoa responsável é designar de novo, e exige a permissão de
    -- designar — mesmo que quem edita possa mexer nas datas e nas observações.
    if v_current.employee_id <> v_employee
       and not private.has_permission(p_organization_id, 'leadership.assign') then
      raise exception 'Você não possui permissão para designar responsáveis.'
        using errcode = 'insufficient_privilege';
    end if;

    update public.leadership_assignments
       set employee_id         = v_employee,
           scope_level         = v_scope,
           operation_id        = v_operation,
           operation_city_id   = v_city,
           operation_br_id     = v_br,
           responsibility_type = v_type,
           effective_from      = v_from,
           effective_to        = v_to,
           notes               = v_notes
     where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'warnings', to_jsonb(v_warnings));
end;
$$;

revoke execute on function public.save_leadership_assignment(uuid, jsonb) from public, anon;
grant  execute on function public.save_leadership_assignment(uuid, jsonb) to authenticated;

comment on function public.save_leadership_assignment(uuid, jsonb) is
  'Cria ou edita uma responsabilidade operacional. Não altera Perfil de Acesso, escopos nem employee_assignments (§12, §27).';

-- =============================================================================
-- public.end_leadership_assignment
--
-- §26: encerrar é datar o fim, nunca apagar a linha. O registro continua
-- respondendo pelas consultas do período em que valeu.
-- =============================================================================
create or replace function public.end_leadership_assignment(
  p_id           uuid,
  p_effective_to date,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select * into v_row
    from public.leadership_assignments
   where id = p_id
   for update;

  if v_row.id is null then
    raise exception 'Vínculo de liderança não encontrado.' using errcode = 'no_data_found';
  end if;

  perform private.assert_governance_access(
    v_row.organization_id, v_row.operation_id, 'leadership.manage',
    'Você não possui permissão para encerrar responsabilidades.');

  if p_effective_to is null then
    raise exception 'Informe a data de encerramento.' using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_to < v_row.effective_from then
    raise exception 'O encerramento (%) não pode ser anterior ao início da vigência (%).',
      to_char(p_effective_to, 'DD/MM/YYYY'), to_char(v_row.effective_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;
  if v_row.status = 'ended' then
    raise exception 'Esta responsabilidade já está encerrada desde %.',
      to_char(v_row.effective_to, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  update public.leadership_assignments
     set effective_to = p_effective_to,
         status       = 'ended',
         end_reason   = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id;
end;
$$;

revoke execute on function public.end_leadership_assignment(uuid, date, text) from public, anon;
grant  execute on function public.end_leadership_assignment(uuid, date, text) to authenticated;

-- =============================================================================
-- public.replicate_leadership_competence
--
-- §23 e §24. Duas garantias que precisam andar juntas:
--
--   IDEMPOTENTE — rodar duas vezes produz o mesmo resultado da primeira. O que
--   define "já existe" é o escopo + o tipo de responsabilidade dentro da
--   competência de destino, não o id da linha de origem.
--
--   NÃO SOBRESCREVE — por padrão, um escopo que já tem responsável no destino é
--   preservado e aparece na prévia como preservado. Substituir exige
--   `p_overwrite`, que encerra o vínculo do destino e cria o novo: ainda assim
--   nada é apagado.
--
-- `p_dry_run` devolve exatamente a mesma contagem sem gravar nada — é a prévia
-- do §23, calculada pelo mesmo código que executa, e não por uma segunda
-- consulta que pode discordar dele.
-- =============================================================================
create or replace function public.replicate_leadership_competence(
  p_organization_id uuid,
  p_from_year       integer,
  p_from_month      integer,
  p_to_year         integer,
  p_to_month        integer,
  p_operation_id    uuid default null,
  p_overwrite       boolean default false,
  p_dry_run         boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_range daterange := private.competence_range(p_from_year, p_from_month);
  v_to_range   daterange := private.competence_range(p_to_year,   p_to_month);
  v_to_start   date      := lower(v_to_range);
  v_to_end     date      := upper(v_to_range) - 1;
  v_created    integer   := 0;
  v_preserved  integer   := 0;
  v_replaced   integer   := 0;
  v_details    jsonb     := '[]'::jsonb;
  r            record;
  v_existing   record;
begin
  if not private.has_permission(p_organization_id, 'leadership.replicate') then
    raise exception 'Você não possui permissão para replicar competências.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_from_range = v_to_range then
    raise exception 'A competência de origem e a de destino são a mesma.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_operation_id is not null and not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  for r in
    select l.*
      from public.leadership_assignments l
     where l.organization_id = p_organization_id
       and daterange(l.effective_from, l.effective_to, '[]') && v_from_range
       and (p_operation_id is null or l.operation_id = p_operation_id)
       and private.can_access_operation(l.operation_id)
     order by l.scope_key, l.responsibility_type, l.effective_from
  loop
    -- Um escopo é considerado já planejado no destino quando existe qualquer
    -- responsabilidade ativa daquele tipo intersectando o mês — inclusive uma
    -- criada por esta mesma rotina numa execução anterior. É isso que torna a
    -- replicação idempotente sem precisar guardar de onde cada linha veio.
    select * into v_existing
      from public.leadership_assignments d
     where d.organization_id = p_organization_id
       and d.scope_key = r.scope_key
       and d.responsibility_type = r.responsibility_type
       and d.status = 'active'
       and daterange(d.effective_from, d.effective_to, '[]') && v_to_range
     limit 1;

    if v_existing.id is not null then
      if not p_overwrite then
        v_preserved := v_preserved + 1;
        v_details := v_details || jsonb_build_object(
          'scope_key', r.scope_key, 'action', 'preserved',
          'kept_employee_id', v_existing.employee_id);
        continue;
      end if;

      -- Substituir é encerrar o que havia na véspera e criar o novo. Nunca é
      -- um UPDATE em cima do responsável anterior: isso apagaria o fato de ele
      -- ter respondido por aquele escopo.
      if not p_dry_run then
        if v_existing.effective_from >= v_to_start then
          -- Começava dentro do mês que está sendo replanejado: não há véspera
          -- onde encerrá-lo, e datá-lo no próprio dia de início deixaria os
          -- dois vínculos válidos naquele dia. A linha fica, cancelada.
          update public.leadership_assignments
             set status = 'cancelled',
                 effective_to = effective_from,
                 end_reason = format('Substituído pela replicação de %s/%s.', p_from_month, p_from_year)
           where id = v_existing.id;
        else
          update public.leadership_assignments
             set status = 'ended', effective_to = v_to_start - 1,
                 end_reason = format('Substituído pela replicação de %s/%s.', p_from_month, p_from_year)
           where id = v_existing.id;
        end if;
      end if;
      v_replaced := v_replaced + 1;
    else
      v_created := v_created + 1;
    end if;

    if not p_dry_run then
      insert into public.leadership_assignments
        (organization_id, employee_id, scope_level, operation_id, operation_city_id,
         operation_br_id, responsibility_type, effective_from, effective_to, notes)
      values
        (p_organization_id, r.employee_id, r.scope_level, r.operation_id, r.operation_city_id,
         r.operation_br_id, r.responsibility_type, v_to_start, v_to_end,
         r.notes);
    end if;

    v_details := v_details || jsonb_build_object(
      'scope_key', r.scope_key,
      'action', case when v_existing.id is null then 'created' else 'replaced' end,
      'employee_id', r.employee_id);

    v_existing := null;
  end loop;

  return jsonb_build_object(
    'dry_run',   p_dry_run,
    'created',   v_created,
    'preserved', v_preserved,
    'replaced',  v_replaced,
    'details',   v_details
  );
end;
$$;

revoke execute on function public.replicate_leadership_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean)
  from public, anon;
grant  execute on function public.replicate_leadership_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean)
  to authenticated;

comment on function public.replicate_leadership_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) is
  'Copia o planejamento de lideranças entre competências. Idempotente e transacional; por padrão preserva o que já existe no destino (§24).';
