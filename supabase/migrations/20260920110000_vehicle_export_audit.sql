-- =============================================================================
-- ETAPA 06 · AUDITORIA DA EXPORTAÇÃO DE FROTAS
--
-- §61: exportar é tirar dados do sistema, e isso precisa deixar registro. A
-- rotina não decide quem pode exportar — a permissão já foi verificada na rota
-- e o RLS já decidiu quais linhas o chamador enxerga. Ela registra o que saiu.
-- =============================================================================

create or replace function public.log_vehicle_export(
  p_organization_id uuid,
  p_format          text,
  p_row_count       integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'vehicles.export') then
    raise exception 'Você não possui permissão para exportar frotas.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_logs
    (organization_id, user_id, entity_type, entity_id, action, new_data)
  values
    (p_organization_id, (select auth.uid()), 'vehicles_export', null, 'EXPORT',
     jsonb_build_object('format', p_format, 'row_count', p_row_count));
end;
$$;

revoke execute on function public.log_vehicle_export(uuid, text, integer) from public, anon;
grant  execute on function public.log_vehicle_export(uuid, text, integer) to authenticated;
