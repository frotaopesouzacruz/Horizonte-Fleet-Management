-- =============================================================================
-- ETAPA 07 · UM NOME DE TIPO POR ORGANIZAÇÃO, CONTANDO O CATÁLOGO BASE
--
-- Os dois índices únicos de `vehicle_types` cobrem cada escopo por separado:
-- um impede duas "Van" globais, o outro impede duas "Van" da mesma
-- organização. Nenhum dos dois impede uma organização de criar a sua "Van" ao
-- lado da "Van" da plataforma — e é exatamente isso que apareceria como dois
-- tipos com o mesmo nome na mesma lista, na mesma tela.
--
-- Um índice não consegue expressar essa regra porque ela atravessa os dois
-- escopos. A rotina de gravação consegue.
-- =============================================================================

create or replace function private.assert_type_name_available(
  p_organization_id uuid,
  p_name            text,
  p_exclude_id      uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.vehicle_types t
     where t.deleted_at is null
       and (t.organization_id is null or t.organization_id = p_organization_id)
       and t.id is distinct from p_exclude_id
       and private.normalize_label(t.name) = private.normalize_label(p_name)
  ) then
    raise exception 'Já existe um tipo de equipamento chamado "%" disponível para esta organização.', btrim(p_name)
      using errcode = 'unique_violation';
  end if;
end;
$$;

revoke execute on function private.assert_type_name_available(uuid, text, uuid) from public, anon;
grant  execute on function private.assert_type_name_available(uuid, text, uuid) to authenticated;
