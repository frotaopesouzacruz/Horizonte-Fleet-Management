-- =============================================================================
-- Lideranças › Planejamento por Tipo de Operação → Cidade (modelo do HFC)
--
-- O HFC planeja a liderança como uma matriz: cada tipo de operação, suas
-- cidades, e em cada cidade um seletor com as pessoas do perfil Liderança
-- ("Planner de Lideranças Operacionais", `planner_liderancas`). O HFM já tem a
-- fonte oficial — `leadership_assignments`, com vigência por datas, auditoria,
-- escopo por operação e a guarda de correção histórica — e esta migration NÃO
-- cria outra: as duas rotinas abaixo leem e escrevem a mesma tabela, no nível
-- "cidade" e como responsável principal.
--
--  1. `leadership_city_planner(org, ano, mês)` — a matriz da competência:
--     operações ativas do escopo de quem pede, suas cidades, a liderança
--     principal de cada cidade no mês (com as datas) e quantas BRs da cidade
--     têm liderança própria (exceção da Etapa 13). Traz também as pessoas
--     que o seletor oferece: colaboradores ativos cujo vínculo funcional atual
--     é do perfil de negócio Liderança Operações — só id, nome e matrícula.
--     A lista é conveniência de escolha: não concede permissão a ninguém e
--     não altera Perfil de Acesso.
--  2. `set_city_leadership(org, cidade, ano, mês, colaborador|null, início,
--     motivo, dry_run)` — escolher (ou remover) a liderança de uma cidade na
--     competência:
--       * competência corrente: vale a partir de HOJE — os dias que já
--         passaram continuam com quem respondia por eles;
--       * competência futura: vale a partir do dia 1º;
--       * competência passada (ou início anterior a hoje): é correção
--         histórica — exige `leadership.manage_historical_data` e motivo
--         (a mesma regra de `save_leadership_assignment`, e o gatilho
--         `leadership_historical_guard` confere de novo);
--       * a nova liderança herda o restante da vigência que substitui (se a
--         anterior estava em aberto, a nova fica em aberto; se era só do mês,
--         fica só do mês). Numa competência passada a troca fica restrita
--         àquele mês e a vigência anterior continua depois dele;
--       * remover encerra a responsabilidade a partir do início calculado;
--       * nada é apagado: o vínculo anterior é encerrado na véspera (ou
--         cancelado, se começaria no mesmo dia) e tudo passa pela auditoria
--         com o usuário autenticado.
--     `dry_run` devolve o que aconteceria sem gravar.
--
-- Nenhuma tabela criada; nenhum dado apagado; nenhuma permissão concedida.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem o seletor oferece: perfil de negócio Liderança Operações, ativo.
-- -----------------------------------------------------------------------------
create or replace function private.is_leadership_candidate(p_organization_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.employee_assignments a
      join public.business_profiles bp on bp.id = a.business_profile_id
     where a.organization_id = p_organization_id
       and a.employee_id = p_employee_id
       and a.is_current
       and private.official_profile_from_text(bp.name) = 'lideranca_operacoes'
  );
$$;

revoke execute on function private.is_leadership_candidate(uuid, uuid) from public, anon;
grant execute on function private.is_leadership_candidate(uuid, uuid) to authenticated, service_role;

comment on function private.is_leadership_candidate(uuid, uuid) is
  'Se o vínculo funcional atual do colaborador é do perfil de negócio Liderança Operações. Só para oferecer a pessoa no planejamento — nunca concede permissão.';

-- -----------------------------------------------------------------------------
-- 1. A matriz da competência
-- -----------------------------------------------------------------------------
create or replace function public.leadership_city_planner(
  p_organization_id uuid,
  p_year            integer,
  p_month           integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_range      daterange := private.competence_range(p_year, p_month);
  v_operations jsonb;
  v_candidates jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'leadership.view') then
    raise exception 'Você não possui permissão para ver as lideranças.' using errcode = 'insufficient_privilege';
  end if;

  with ops as (
    select o.id, o.name, o.code
      from public.operations o
     where o.organization_id = p_organization_id
       and o.deleted_at is null
       and o.status = 'active'
       and o.id in (select private.accessible_operation_ids())
  ),
  places as (
    select oc.id, oc.operation_id, oc.city_id, oc.state_id, c.name as city_name, s.uf
      from public.operation_cities oc
      join ops on ops.id = oc.operation_id
      join public.cities c on c.id = oc.city_id
      join public.states s on s.id = oc.state_id
     where oc.organization_id = p_organization_id
  ),
  links as (
    select l.operation_city_id,
           jsonb_agg(jsonb_build_object(
             'id', l.id,
             'employee_id', l.employee_id,
             'employee_name', e.full_name,
             'employee_code', e.employee_code,
             'employee_active', e.employment_status = 'active' and e.deleted_at is null,
             'effective_from', l.effective_from,
             'effective_to', l.effective_to,
             'status', l.status,
             'notes', l.notes,
             'updated_at', l.updated_at
           ) order by l.effective_from) as items
      from public.leadership_assignments l
      join public.employees e on e.id = l.employee_id
     where l.organization_id = p_organization_id
       and l.scope_level = 'city'
       and l.responsibility_type = 'principal'
       and l.status <> 'cancelled'
       and daterange(l.effective_from, l.effective_to, '[]') && v_range
       and l.operation_city_id in (select id from places)
     group by l.operation_city_id
  ),
  exceptions as (
    select l.operation_city_id, count(distinct l.operation_br_id)::int as n
      from public.leadership_assignments l
     where l.organization_id = p_organization_id
       and l.scope_level = 'br'
       and l.responsibility_type = 'principal'
       and l.status <> 'cancelled'
       and daterange(l.effective_from, l.effective_to, '[]') && v_range
     group by l.operation_city_id
  ),
  cities_json as (
    select p.operation_id,
           jsonb_agg(jsonb_build_object(
             'operation_city_id', p.id,
             'city_id', p.city_id,
             'state_id', p.state_id,
             'city_name', p.city_name,
             'uf', p.uf,
             'leaders', coalesce(lk.items, '[]'::jsonb),
             'br_exceptions', coalesce(x.n, 0)
           ) order by p.city_name, p.uf) as items
      from places p
      left join links lk on lk.operation_city_id = p.id
      left join exceptions x on x.operation_city_id = p.id
     group by p.operation_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ops.id,
           'name', ops.name,
           'code', ops.code,
           'cities', coalesce(cj.items, '[]'::jsonb)
         ) order by ops.name), '[]'::jsonb)
    into v_operations
    from ops
    left join cities_json cj on cj.operation_id = ops.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'name', e.full_name, 'code', e.employee_code
         ) order by e.full_name), '[]'::jsonb)
    into v_candidates
    from public.employees e
   where e.organization_id = p_organization_id
     and e.deleted_at is null
     and e.employment_status = 'active'
     and private.is_leadership_candidate(p_organization_id, e.id);

  return jsonb_build_object(
    'competence', to_char(lower(v_range), 'YYYY-MM'),
    'month_start', lower(v_range),
    'month_end', upper(v_range) - 1,
    'today', private.fidelization_today(),
    'operations', v_operations,
    'candidates', v_candidates
  );
end;
$$;

revoke execute on function public.leadership_city_planner(uuid, integer, integer) from public, anon;
grant execute on function public.leadership_city_planner(uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Escolher ou remover a liderança de uma cidade na competência
-- -----------------------------------------------------------------------------
create or replace function public.set_city_leadership(
  p_organization_id   uuid,
  p_operation_city_id uuid,
  p_year              integer,
  p_month             integer,
  p_employee_id       uuid,
  p_from              date    default null,
  p_reason            text    default null,
  p_dry_run           boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_range     daterange := private.competence_range(p_year, p_month);
  v_m0        date      := lower(v_range);
  v_m1        date      := upper(v_range) - 1;
  v_today     date      := private.fidelization_today();
  v_reason    text      := nullif(btrim(coalesce(p_reason, '')), '');
  v_city      record;
  v_emp       record;
  v_emp_name  text;
  v_prev_name text;
  v_cov       public.leadership_assignments;
  v_from      date;
  v_to        date;
  v_next      date;
  v_past      boolean;
  v_retro     boolean;
  v_cont_from date;
  v_cont_to   date;
  v_prev_act  text;
  v_action    text;
  v_new_id    uuid;
  v_label     text      := format('%s/%s', lpad(p_month::text, 2, '0'), p_year);
  v_warnings  text[]    := array[]::text[];
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'O motivo pode ter no máximo 500 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  select oc.id, oc.operation_id, c.name as city_name, s.uf, o.status as operation_status, o.deleted_at as operation_deleted_at
    into v_city
    from public.operation_cities oc
    join public.operations o on o.id = oc.operation_id
    join public.cities c on c.id = oc.city_id
    join public.states s on s.id = oc.state_id
   where oc.id = p_operation_city_id and oc.organization_id = p_organization_id;
  if v_city.id is null then
    raise exception 'Cidade não encontrada na cobertura das operações desta organização.' using errcode = 'no_data_found';
  end if;

  perform private.assert_governance_access(
    p_organization_id, v_city.operation_id, 'leadership.manage',
    'Você não possui permissão para planejar lideranças.');

  if v_city.operation_deleted_at is not null then
    raise exception 'Esta operação foi arquivada.' using errcode = 'invalid_parameter_value';
  end if;

  -- ------------------------------------------------------------- período ---
  v_past := v_m1 < v_today;
  if p_from is not null then
    if not (p_from <@ v_range) then
      raise exception 'O início (%) precisa estar dentro da competência %.', to_char(p_from, 'DD/MM/YYYY'), v_label
        using errcode = 'invalid_parameter_value';
    end if;
    v_from := p_from;
  elsif v_past then
    v_from := v_m0;
  elsif v_m0 <= v_today then
    v_from := v_today;
  else
    v_from := v_m0;
  end if;
  v_retro := v_from < v_today;

  -- A vaga da cidade (principal, nível cidade) fica travada até o fim.
  perform 1
     from public.leadership_assignments l
    where l.organization_id = p_organization_id
      and l.scope_key = 'city:' || p_operation_city_id::text
      and l.responsibility_type = 'principal'
      and l.status <> 'cancelled'
    for update;

  select l.* into v_cov
    from public.leadership_assignments l
   where l.organization_id = p_organization_id
     and l.scope_key = 'city:' || p_operation_city_id::text
     and l.responsibility_type = 'principal'
     and l.status <> 'cancelled'
     and v_from >= l.effective_from
     and v_from <= coalesce(l.effective_to, 'infinity'::date)
   limit 1;

  if v_cov.id is not null then
    select e.full_name into v_prev_name from public.employees e where e.id = v_cov.employee_id;
  end if;

  -- ---------------------------------------------------------- colaborador ---
  if p_employee_id is not null then
    select e.id, e.full_name, e.employment_status, e.deleted_at into v_emp
      from public.employees e
     where e.id = p_employee_id and e.organization_id = p_organization_id;
    if v_emp.id is null or v_emp.deleted_at is not null then
      raise exception 'Colaborador não encontrado nesta organização.' using errcode = 'no_data_found';
    end if;
    v_emp_name := v_emp.full_name;

    if v_cov.id is not null and v_cov.employee_id = p_employee_id then
      return jsonb_build_object(
        'action', 'unchanged', 'dry_run', p_dry_run, 'employee_name', v_emp_name,
        'city_name', v_city.city_name, 'uf', v_city.uf,
        'effective_from', v_cov.effective_from, 'effective_to', v_cov.effective_to,
        'retroactive', false, 'warnings', '[]'::jsonb);
    end if;

    if not private.has_permission(p_organization_id, 'leadership.assign') then
      raise exception 'Você não possui permissão para designar responsáveis.' using errcode = 'insufficient_privilege';
    end if;
    if v_city.operation_status <> 'active' then
      raise exception 'Não é possível designar liderança em uma operação inativa.' using errcode = 'invalid_parameter_value';
    end if;

    if v_emp.employment_status <> 'active' then
      v_warnings := v_warnings || format('%s não está com situação ativa no cadastro de colaboradores.', v_emp_name);
    end if;
    if not private.is_leadership_candidate(p_organization_id, p_employee_id) then
      v_warnings := v_warnings || format(
        '%s não está cadastrado com o perfil Liderança Operações. A designação não altera o perfil de acesso de ninguém.',
        v_emp_name);
    end if;
  elsif v_cov.id is null then
    return jsonb_build_object(
      'action', 'unchanged', 'dry_run', p_dry_run, 'employee_name', null,
      'city_name', v_city.city_name, 'uf', v_city.uf,
      'effective_from', v_from, 'effective_to', null,
      'retroactive', false, 'warnings', '[]'::jsonb);
  end if;

  -- ------------------------------------------------ correção histórica ---
  if v_retro then
    if not private.has_permission(p_organization_id, 'leadership.manage_historical_data') then
      raise exception 'Alterar a liderança de datas que já passaram (a partir de %) é uma correção histórica e exige a permissão "Corrigir dados históricos da liderança".',
        to_char(v_from, 'DD/MM/YYYY')
        using errcode = 'insufficient_privilege';
    end if;
    if v_reason is null then
      raise exception 'Informe o motivo da correção histórica: a alteração muda a liderança de dias que já passaram (a partir de %).',
        to_char(v_from, 'DD/MM/YYYY')
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- ---------------------------------------------------------------- plano ---
  if v_cov.id is not null then
    v_prev_act := case when v_cov.effective_from >= v_from then 'cancelled' else 'ended' end;
    -- Numa competência passada a troca fica no mês: o que vinha depois dele volta.
    if v_past and coalesce(v_cov.effective_to, 'infinity'::date) > v_m1 then
      v_cont_from := v_m1 + 1;
      v_cont_to   := v_cov.effective_to;
    end if;
  end if;

  if p_employee_id is not null then
    if v_cov.id is not null then
      v_to := case when v_past then least(coalesce(v_cov.effective_to, v_m1), v_m1) else v_cov.effective_to end;
      v_action := 'replaced';
    else
      select min(l.effective_from) into v_next
        from public.leadership_assignments l
       where l.organization_id = p_organization_id
         and l.scope_key = 'city:' || p_operation_city_id::text
         and l.responsibility_type = 'principal'
         and l.status <> 'cancelled'
         and l.effective_from > v_from;
      v_to := least(v_m1, v_next - 1);
      v_action := 'assigned';
    end if;
  else
    v_action := 'removed';
  end if;

  if not p_dry_run then
    if v_cov.id is not null then
      if v_prev_act = 'cancelled' then
        update public.leadership_assignments
           set status        = 'cancelled',
               effective_to  = coalesce(effective_to, effective_from),
               end_reason    = format('Substituído no planejamento de %s.', v_label),
               change_reason = v_reason
         where id = v_cov.id;
      else
        -- Encerrado na véspera: continua valendo para os dias em que respondeu.
        update public.leadership_assignments
           set effective_to  = v_from - 1,
               end_reason    = format('Substituído no planejamento de %s.', v_label),
               change_reason = v_reason
         where id = v_cov.id;
      end if;
    end if;

    if p_employee_id is not null then
      insert into public.leadership_assignments
        (organization_id, employee_id, scope_level, operation_id, operation_city_id,
         responsibility_type, effective_from, effective_to, change_reason)
      values
        (p_organization_id, p_employee_id, 'city', v_city.operation_id, p_operation_city_id,
         'principal', v_from, v_to, v_reason)
      returning id into v_new_id;
    end if;

    if v_cont_from is not null then
      insert into public.leadership_assignments
        (organization_id, employee_id, scope_level, operation_id, operation_city_id,
         responsibility_type, effective_from, effective_to, notes, change_reason)
      values
        (p_organization_id, v_cov.employee_id, 'city', v_cov.operation_id, v_cov.operation_city_id,
         'principal', v_cont_from, v_cont_to, v_cov.notes, v_reason);
    end if;
  end if;

  return jsonb_build_object(
    'action',          v_action,
    'dry_run',         p_dry_run,
    'id',              v_new_id,
    'employee_name',   v_emp_name,
    'city_name',       v_city.city_name,
    'uf',              v_city.uf,
    'effective_from',  v_from,
    'effective_to',    v_to,
    'previous',        case when v_cov.id is null then null else jsonb_build_object(
                         'id', v_cov.id, 'employee_name', v_prev_name,
                         'effective_from', v_cov.effective_from, 'effective_to', v_cov.effective_to,
                         'action', v_prev_act,
                         'resumes_from', v_cont_from, 'resumes_to', v_cont_to) end,
    'retroactive',     v_retro,
    'warnings',        to_jsonb(v_warnings)
  );
end;
$$;

revoke execute on function public.set_city_leadership(uuid, uuid, integer, integer, uuid, date, text, boolean) from public, anon;
grant execute on function public.set_city_leadership(uuid, uuid, integer, integer, uuid, date, text, boolean) to authenticated;

comment on function public.set_city_leadership(uuid, uuid, integer, integer, uuid, date, text, boolean) is
  'Planejamento de Lideranças (Tipo de Operação → Cidade): escolhe ou remove a liderança principal de uma cidade na competência, sobre leadership_assignments. Competência corrente vale a partir de hoje; passada é correção histórica.';
