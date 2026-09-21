-- =============================================================================
-- ETAPA 08 · O MOTIVO DA INATIVAÇÃO SAI DE DENTRO DAS OBSERVAÇÕES
--
-- `set_operation_br_status` vinha carimbando o motivo dentro de
-- `operation_brs.notes`. Observações é campo livre de quem usa o sistema: a
-- linha "21/09/2026 — Inativada: fim do contrato" aparecia no textarea como se
-- alguém a tivesse digitado, e a próxima pessoa que editasse a descrição podia
-- apagá-la sem saber o que estava apagando.
--
-- Um motivo de mudança de situação é informação estruturada e tem coluna
-- própria. Quem mudou e quando continuam na trilha de auditoria, que é
-- append-only e não se apaga por edição de formulário.
--
-- O que já foi carimbado em `notes` fica onde está: reescrever texto livre de
-- terceiros para "limpar" o formato seria pior do que a bagunça que ele é.
-- =============================================================================

alter table public.operation_brs
  add column if not exists status_reason text;

alter table public.operation_brs
  drop constraint if exists operation_brs_status_reason_check;
alter table public.operation_brs
  add constraint operation_brs_status_reason_check
  check (status_reason is null or length(status_reason) <= 500);

comment on column public.operation_brs.status_reason is
  'Por que a BR foi inativada ou reativada. Coluna própria — nunca dentro de notes, que é campo livre do usuário.';

create or replace function public.set_operation_br_status(
  p_operation_br_id uuid,
  p_status          text,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br public.operation_brs;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Situação inválida para uma BR.' using errcode = 'invalid_parameter_value';
  end if;

  v_br := private.lock_br(p_operation_br_id, 'fidelization.manage_brs');

  if v_br.status = p_status then
    return;
  end if;

  update public.operation_brs
     set status        = p_status,
         status_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where id = p_operation_br_id;
end;
$$;

revoke execute on function public.set_operation_br_status(uuid, text, text) from public, anon;
grant  execute on function public.set_operation_br_status(uuid, text, text) to authenticated;
