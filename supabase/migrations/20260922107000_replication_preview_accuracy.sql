-- =============================================================================
-- ETAPA 08 · A PRÉVIA DA REPLICAÇÃO PRECISA DIZER A VERDADE
--
-- O teste funcional da etapa pegou a rotina mentindo: a prévia prometeu 4
-- vínculos criados e a execução criou 3. Duas causas, as duas reais.
--
-- 1. A PRÉVIA NÃO VIA O QUE ELA MESMA IA CRIAR.
--
--    Setembro tinha dois principais no escopo da operação em períodos
--    diferentes — A até o dia 12, B do dia 16 em diante. Isso é legítimo e é
--    exatamente o caso do §17. Ao replicar para outubro, os dois viram uma
--    linha só: o primeiro cria o vínculo do mês, o segundo encontra esse
--    vínculo e é preservado.
--
--    A execução acertava, porque consultava o destino a cada volta e já
--    enxergava a linha recém-criada. A prévia, que não grava nada, nunca
--    enxergava — e contava os dois como criações. Quem confirmasse a operação
--    receberia um resultado diferente do que aprovou, que é precisamente o que
--    o §23 existe para impedir.
--
-- 2. RESPONSABILIDADES ENCERRADAS ESTAVAM SENDO REPLICADAS.
--
--    A consulta de origem não filtrava por situação, então um vínculo encerrado
--    em 12/09 renascia ativo em outubro. Encerrar uma responsabilidade é dizer
--    que ela acabou; replicá-la adiante desfaz a decisão de quem a encerrou, e
--    sem que ninguém peça.
--
--    Passam a ser replicados apenas os vínculos ativos da competência de
--    origem — que é o que "repetir o planejamento" quer dizer.
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
  -- O que esta execução já planejou. É o que faz a prévia contar igual à
  -- execução: sem gravar nada, ela precisa lembrar do que prometeu criar.
  v_planned    text[]    := array[]::text[];
  v_slot       text;
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
       and l.status = 'active'
       and daterange(l.effective_from, l.effective_to, '[]') && v_from_range
       and (p_operation_id is null or l.operation_id = p_operation_id)
       and private.can_access_operation(l.operation_id)
     order by l.scope_key, l.responsibility_type, l.effective_from
  loop
    v_slot := r.scope_key || '|' || r.responsibility_type;

    -- Já planejado nesta mesma execução: nada a fazer, e conta como preservado
    -- tanto na prévia quanto na execução.
    if v_slot = any (v_planned) then
      v_preserved := v_preserved + 1;
      v_details := v_details || jsonb_build_object(
        'scope_key', r.scope_key, 'action', 'preserved', 'kept_employee_id', r.employee_id);
      continue;
    end if;

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
        v_planned := v_planned || v_slot;
        v_details := v_details || jsonb_build_object(
          'scope_key', r.scope_key, 'action', 'preserved',
          'kept_employee_id', v_existing.employee_id);
        v_existing := null;
        continue;
      end if;

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

    v_planned := v_planned || v_slot;
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
  'Copia o planejamento de lideranças entre competências. Idempotente, transacional, preserva o destino por padrão (§24), e a prévia conta exatamente o que a execução fará (§23).';
