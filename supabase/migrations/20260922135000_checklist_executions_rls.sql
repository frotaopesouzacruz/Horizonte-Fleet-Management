-- =============================================================================
-- Etapa 12 — RLS das execuções e selagem do que já foi enviado (§60, §65)
-- =============================================================================
alter table public.checklist_executions         enable row level security;
alter table public.checklist_execution_answers  enable row level security;
alter table public.checklist_execution_clusters enable row level security;

drop policy if exists checklist_executions_select on public.checklist_executions;
create policy checklist_executions_select on public.checklist_executions
  for select to authenticated
  using (
    -- O próprio: comparado pelo colaborador da SESSÃO, nunca por um id vindo
    -- do cliente (§31).
    (organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_own'))
     and employee_id in (
       select m.employee_id from public.organization_memberships m
        where m.user_id = auth.uid() and m.organization_id = checklist_executions.organization_id
          and m.status = 'active'))
    or
    (organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_details'))
     and private.can_access_operation(operation_id))
  );

drop policy if exists checklist_answers_select on public.checklist_execution_answers;
create policy checklist_answers_select on public.checklist_execution_answers
  for select to authenticated
  using (exists (select 1 from public.checklist_executions e where e.id = execution_id));

drop policy if exists checklist_exec_clusters_select on public.checklist_execution_clusters;
create policy checklist_exec_clusters_select on public.checklist_execution_clusters
  for select to authenticated
  using (exists (select 1 from public.checklist_executions e where e.id = execution_id));

grant select on public.checklist_executions, public.checklist_execution_answers,
                public.checklist_execution_clusters to authenticated;

drop trigger if exists checklist_executions_audit on public.checklist_executions;
create trigger checklist_executions_audit
  after insert or update or delete on public.checklist_executions
  for each row execute function private.tg_audit();

-- §60: um checklist enviado não se edita livremente. A correção administrativa
-- terá rotina própria, autorizada e auditável, que abrirá o portão
-- `hfm.checklist_correction`; até lá, o banco recusa.
create or replace function private.tg_checklist_execution_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Uma execução enviada não pode ser excluída.'
      using errcode = 'invalid_parameter_value';
  end if;
  if old.status = 'submitted' and new.status = 'submitted'
     and (new.answered_questions is distinct from old.answered_questions
          or new.vehicle_id is distinct from old.vehicle_id
          or new.employee_id is distinct from old.employee_id
          or new.checklist_type is distinct from old.checklist_type
          or new.operational_date is distinct from old.operational_date
          or new.version_id is distinct from old.version_id)
     and current_setting('hfm.checklist_correction', true) is distinct from 'on' then
    raise exception 'Esta execução já foi enviada. Use o procedimento de correção administrativa.'
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_executions_sealed on public.checklist_executions;
create trigger checklist_executions_sealed
  before update or delete on public.checklist_executions
  for each row execute function private.tg_checklist_execution_sealed();

create or replace function private.tg_checklist_answers_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select e.status into v_status from public.checklist_executions e
   where e.id = coalesce(new.execution_id, old.execution_id);
  if v_status = 'submitted'
     and current_setting('hfm.checklist_correction', true) is distinct from 'on' then
    raise exception 'As respostas de uma execução enviada não podem ser alteradas.'
      using errcode = 'invalid_parameter_value';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists checklist_answers_sealed on public.checklist_execution_answers;
create trigger checklist_answers_sealed
  before update or delete on public.checklist_execution_answers
  for each row execute function private.tg_checklist_answers_sealed();
