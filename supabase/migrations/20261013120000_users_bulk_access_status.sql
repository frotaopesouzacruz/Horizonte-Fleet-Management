-- =============================================================================
-- Usuários › ações em massa de acesso (Suspender / Reativar acesso)
--
-- O problema: a tela chamava set_employee_access_status uma vez por
-- colaborador e contava como "não pôde ser alterado" quem nem tem conta de
-- acesso ao HFM (hoje, quase toda a base), sem dizer o motivo. E "reativar"
-- uma conta que já estava ativa gravava um evento de reativação que não
-- aconteceu.
--
-- A correção:
--   * set_employee_access_status: trocar para o mesmo status não faz nada e
--     não registra evento. Mesma assinatura e mesmas regras para o resto.
--   * bulk_set_employee_access_status: uma chamada para a seleção inteira. O
--     banco classifica cada colaborador (alterado, já estava assim, sem conta,
--     a própria conta, acesso removido, convite pendente, cadastro inativo,
--     não encontrado, bloqueado pela trava do último Administrador), altera só
--     quem pode mudar e devolve os totais para a tela explicar. Valem as mesmas
--     transições da ficha do colaborador: reativar é para acesso suspenso ou
--     convite pendente; suspender, para acesso ativo. A própria conta nunca
--     entra numa ação em massa, e reativar em massa não devolve acesso a quem
--     teve o cadastro inativado.
--
-- Nada é apagado; nenhuma tabela muda.
-- =============================================================================

create or replace function public.set_employee_access_status(p_employee_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_user    uuid;
  v_current text;
begin
  if p_status not in ('active', 'suspended', 'removed') then
    raise exception 'invalid access status %', p_status using errcode = 'invalid_parameter_value';
  end if;

  select e.organization_id into v_org from public.employees e where e.id = p_employee_id;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;

  select m.user_id, m.status into v_user, v_current
    from public.organization_memberships m
   where m.organization_id = v_org and m.employee_id = p_employee_id;

  if v_user is null then
    raise exception 'Este colaborador não possui conta de acesso.' using errcode = 'no_data_found';
  end if;
  if v_user = (select auth.uid()) and not private.is_platform_admin() then
    raise exception 'an account cannot change its own access status' using errcode = 'insufficient_privilege';
  end if;

  -- Mesmo status: nada muda, e nada é registrado como se tivesse mudado.
  if v_current = p_status then
    return;
  end if;

  update public.organization_memberships
     set status = p_status
   where organization_id = v_org and employee_id = p_employee_id;

  perform private.emit_event(
    v_org,
    case p_status when 'active' then 'user.access_reactivated'
                  when 'suspended' then 'user.access_suspended'
                  else 'user.access_removed' end,
    'employee', p_employee_id, jsonb_build_object('status', p_status, 'previous_status', v_current)
  );
end;
$$;

create or replace function public.bulk_set_employee_access_status(
  p_organization_id uuid,
  p_employee_ids    uuid[],
  p_status          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := (select auth.uid());
  r         record;
  c_applied integer := 0;
  c_already integer := 0;
  c_none    integer := 0;
  c_self    integer := 0;
  c_removed integer := 0;
  c_invited integer := 0;
  c_archived integer := 0;
  c_missing integer := 0;
  c_blocked integer := 0;
  c_changed integer := 0;
begin
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'Ação de acesso inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if p_organization_id is null
     or not private.has_permission(p_organization_id, 'users.manage_access')
     or not private.has_permission(p_organization_id, 'users.bulk_manage') then
    raise exception 'Você não possui permissão para alterar o acesso de vários colaboradores.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_employee_ids), 0) > 1000 then
    raise exception 'Selecione no máximo 1.000 colaboradores por vez.' using errcode = 'program_limit_exceeded';
  end if;

  for r in
    select x.employee_id, e.id as employee_found, e.deleted_at, m.user_id, m.status as access_status
      from (select distinct u.id as employee_id
              from unnest(coalesce(p_employee_ids, '{}'::uuid[])) as u(id)
             where u.id is not null) x
      left join public.employees e
             on e.id = x.employee_id and e.organization_id = p_organization_id
      left join public.organization_memberships m
             on m.organization_id = p_organization_id and m.employee_id = e.id
     order by x.employee_id
  loop
    if r.employee_found is null then
      c_missing := c_missing + 1;
    elsif r.user_id is null then
      c_none := c_none + 1;
    elsif r.user_id = v_me then
      c_self := c_self + 1;
    elsif r.access_status = p_status then
      c_already := c_already + 1;
    elsif r.access_status = 'removed' then
      c_removed := c_removed + 1;
    elsif p_status = 'suspended' and r.access_status = 'invited' then
      c_invited := c_invited + 1;
    elsif p_status = 'active' and r.deleted_at is not null then
      c_archived := c_archived + 1;
    else
      -- reativar: suspenso ou convite pendente → ativo; suspender: ativo → suspenso
      begin
        update public.organization_memberships m
           set status = p_status
         where m.organization_id = p_organization_id
           and m.employee_id = r.employee_id
           and m.status = r.access_status;
        if found then
          c_applied := c_applied + 1;
          perform private.emit_event(
            p_organization_id,
            case p_status when 'active' then 'user.access_reactivated' else 'user.access_suspended' end,
            'employee', r.employee_id,
            jsonb_build_object('status', p_status, 'previous_status', r.access_status, 'bulk', true));
        else
          c_changed := c_changed + 1;   -- outra pessoa alterou a conta enquanto isso
        end if;
      exception when check_violation then
        -- a trava do último Administrador ativo recusou: a conta fica como está
        c_blocked := c_blocked + 1;
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'status',     p_status,
    'requested',  c_applied + c_already + c_none + c_self + c_removed + c_invited + c_archived
                  + c_missing + c_blocked + c_changed,
    'applied',    c_applied,
    'already',    c_already,
    'no_account', c_none,
    'self',       c_self,
    'removed',    c_removed,
    'invited',    c_invited,
    'archived',   c_archived,
    'not_found',  c_missing,
    'blocked',    c_blocked,
    'changed',    c_changed);
end;
$$;

revoke execute on function public.bulk_set_employee_access_status(uuid, uuid[], text) from public, anon;
grant execute on function public.bulk_set_employee_access_status(uuid, uuid[], text) to authenticated;
