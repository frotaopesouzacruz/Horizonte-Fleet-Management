-- =============================================================================
-- ETAPA 09 · A ABA HISTÓRICO NÃO ABRIA
--
-- `branch_audit_trail` declara `id` entre as colunas de retorno, e a primeira
-- linha do corpo resolvia a filial com `where id = p_organization_unit_id` —
-- sem qualificar. Em PL/pgSQL o nome da coluna de retorno é uma variável, e o
-- PostgreSQL recusa a consulta inteira com "column reference id is ambiguous".
--
-- O efeito: a aba Histórico da filial não abria nunca, para ninguém. O teste
-- funcional da etapa pegou na primeira execução.
--
-- A correção é qualificar. As outras rotinas da etapa não têm o problema:
-- `branch_employees` e `branch_vehicles` não devolvem nenhuma coluna chamada
-- `id`, e as duas de impacto devolvem jsonb.
-- =============================================================================

create or replace function public.branch_audit_trail(
  p_organization_unit_id uuid,
  p_limit                integer default 100
)
returns table (
  id             uuid,
  entity_type    text,
  action         text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  actor_name     text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select u.organization_id into v_org
    from public.organization_units u
   where u.id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view_audit') then
    raise exception 'Você não possui permissão para ler o histórico da filial.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.id, a.entity_type, a.action, a.changed_fields, a.old_data, a.new_data,
           e.full_name, a.created_at
      from public.audit_logs a
      left join public.organization_memberships m
        on m.organization_id = a.organization_id and m.user_id = a.user_id
      left join public.employees e
        on e.organization_id = a.organization_id and e.id = m.employee_id
     where a.organization_id = v_org
       and (
         (a.entity_type = 'public.organization_units'
          and a.entity_id = p_organization_unit_id::text)
         or (a.entity_type = 'public.organization_unit_operations'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
         or (a.entity_type = 'public.vehicle_unit_assignments'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
       )
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke execute on function public.branch_audit_trail(uuid, integer) from public, anon;
grant  execute on function public.branch_audit_trail(uuid, integer) to authenticated;
