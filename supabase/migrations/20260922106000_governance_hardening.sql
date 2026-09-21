-- =============================================================================
-- ETAPA 08 · TRÊS BURACOS FECHADOS
--
-- A auditoria da etapa encontrou três coisas que a migration de fundação
-- deixou passar. Nenhuma delas apareceria em um teste funcional: as três são
-- caminhos alternativos para o mesmo dado.
--
-- 1. TRUNCATE. As quatro tabelas novas nasceram com o ACL padrão do schema
--    `public`, que concede tudo a `authenticated`. A migration de RBAC revogou
--    `insert, update, delete` — e deixou `truncate`, `references` e `trigger`.
--    TRUNCATE não passa por RLS e não dispara gatilho BEFORE DELETE, então o
--    `tg_block_mutation` que protege o histórico simplesmente não roda.
--    `vehicles` e `operation_cities` não têm esse problema porque as suas
--    migrations revogaram tudo antes de conceder o SELECT. Esta faz o mesmo.
--
-- 2. `replaces_assignment_id` era a única FK do arquivo sem o tenant. Todas as
--    outras são compostas e carregam `organization_id`; esta apontava para a
--    chave primária nua, então uma substituição podia dizer que substituiu um
--    vínculo de outra organização.
--
-- 3. A TRILHA DE AUDITORIA CONTORNAVA O ESCOPO POR OPERAÇÃO. `tg_audit` grava a
--    linha inteira em `audit_logs`, cuja política confere apenas `audit.view` na
--    organização — sem escopo de operação e sem as permissões desta etapa. Quem
--    tivesse `audit.view` e acesso a uma única operação lia, por `audit_logs`,
--    todas as lideranças e todas as fidelizações da organização. A §64 é
--    explícita: o escopo tem de valer também para as exportações e consultas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Privilégios de tabela
-- -----------------------------------------------------------------------------
revoke all on
  public.operation_brs,
  public.leadership_assignments,
  public.fidelization_assignments,
  public.fidelization_drivers
  from anon, authenticated;

-- A leitura volta, e só ela. As políticas de SELECT continuam decidindo quais
-- linhas; este grant decide apenas que o verbo permitido é SELECT.
grant select on
  public.operation_brs,
  public.leadership_assignments,
  public.fidelization_assignments,
  public.fidelization_drivers
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A autorreferência passa a carregar o tenant
-- -----------------------------------------------------------------------------
alter table public.fidelization_assignments
  drop constraint if exists fidelization_assignments_replaces_assignment_id_fkey;

alter table public.fidelization_assignments
  drop constraint if exists fidelization_replaces_fkey;

alter table public.fidelization_assignments
  add constraint fidelization_replaces_fkey
  foreign key (organization_id, replaces_assignment_id)
  references public.fidelization_assignments (organization_id, id)
  on delete restrict;

-- -----------------------------------------------------------------------------
-- 3. A trilha de governança sai da política aberta de audit_logs
--
-- As quatro entidades desta etapa deixam de ser legíveis pela política
-- organizacional de `audit_logs` e passam a ser lidas por uma rotina que confere
-- a permissão específica E o escopo da operação — as mesmas duas coisas que a
-- listagem confere. É também o que dá função às permissões `leadership.audit` e
-- `fidelization.audit`.
--
-- Nada muda para as demais entidades: veículos, tipos de equipamento,
-- colaboradores e perfis continuam exatamente como estavam.
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (
      organization_id is not null
      and organization_id in (select private.permitted_org_ids('audit.view'))
      and entity_type not in (
        'public.operation_brs',
        'public.leadership_assignments',
        'public.fidelization_assignments',
        'public.fidelization_drivers'
      )
    )
    or (select private.is_platform_admin())
  );

comment on policy audit_logs_select on public.audit_logs is
  'audit.view na organização. As entidades da Governança Operacional são servidas por public.governance_audit_trail, que confere também o escopo por operação (§64).';

-- -----------------------------------------------------------------------------
-- public.governance_audit_trail
-- -----------------------------------------------------------------------------
create or replace function public.governance_audit_trail(
  p_entity_type text,
  p_entity_id   uuid,
  p_limit       integer default 50
)
returns table (
  id             uuid,
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
  v_permission text;
  v_org        uuid;
  v_operation  uuid;
begin
  -- A entidade decide a permissão exigida e como se chega à operação dela.
  if p_entity_type = 'public.leadership_assignments' then
    v_permission := 'leadership.audit';
    select l.organization_id, l.operation_id into v_org, v_operation
      from public.leadership_assignments l where l.id = p_entity_id;

  elsif p_entity_type = 'public.operation_brs' then
    v_permission := 'fidelization.audit';
    select b.organization_id, b.operation_id into v_org, v_operation
      from public.operation_brs b where b.id = p_entity_id;

  elsif p_entity_type = 'public.fidelization_assignments' then
    v_permission := 'fidelization.audit';
    select a.organization_id, b.operation_id into v_org, v_operation
      from public.fidelization_assignments a
      join public.operation_brs b on b.id = a.operation_br_id
     where a.id = p_entity_id;

  elsif p_entity_type = 'public.fidelization_drivers' then
    v_permission := 'fidelization.audit';
    select d.organization_id, b.operation_id into v_org, v_operation
      from public.fidelization_drivers d
      join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
      join public.operation_brs b on b.id = a.operation_br_id
     where d.id = p_entity_id;

  else
    raise exception 'Esta rotina serve apenas às entidades da Governança Operacional.'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_org is null then
    raise exception 'Registro não encontrado.' using errcode = 'no_data_found';
  end if;

  if not private.has_permission(v_org, v_permission) then
    raise exception 'Você não possui permissão para ler o histórico deste registro.'
      using errcode = 'insufficient_privilege';
  end if;

  if not private.can_access_operation(v_operation) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.id,
           a.action,
           a.changed_fields,
           a.old_data,
           a.new_data,
           -- O nome de quem alterou, quando essa pessoa é colaboradora desta
           -- organização. Nunca o e-mail: a trilha não é um diretório.
           e.full_name,
           a.created_at
      from public.audit_logs a
      left join public.organization_memberships m
        on m.organization_id = a.organization_id
       and m.user_id = a.user_id
      left join public.employees e
        on e.organization_id = a.organization_id
       and e.id = m.employee_id
     where a.entity_type = p_entity_type
       and a.entity_id = p_entity_id::text
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.governance_audit_trail(text, uuid, integer) from public, anon;
grant  execute on function public.governance_audit_trail(text, uuid, integer) to authenticated;

comment on function public.governance_audit_trail(text, uuid, integer) is
  'Trilha de auditoria de uma liderança, BR, fidelização ou motorista. Confere a permissão específica e o escopo da operação antes de devolver qualquer linha.';
