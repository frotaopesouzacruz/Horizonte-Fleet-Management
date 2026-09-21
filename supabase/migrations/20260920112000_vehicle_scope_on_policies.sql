-- =============================================================================
-- ETAPA 06 · O ESCOPO POR OPERAÇÃO NAS POLÍTICAS, NÃO SÓ NAS ROTINAS
--
-- A migration anterior fechou o escopo nas rotinas de mutação. A auditoria das
-- políticas mostrou que sobravam três portas:
--
--   1. `vehicles_update` conferia apenas `vehicles.update` na organização. Uma
--      rotina antiga da fundação — `public.set_vehicle_status`, SECURITY
--      INVOKER e concedida a `authenticated` — passava por ela, e com ela
--      qualquer `UPDATE` direto pelo PostgREST. Fechar a rotina e deixar a
--      política aberta é fechar a porta e deixar a janela.
--
--   2. `vehicle_assignments_select`, `vehicle_odometer_select` e
--      `vehicle_status_history_select` conferiam `vehicles.view` na
--      organização e mais nada. O veículo ficava invisível na listagem e o seu
--      histórico de alocação, as suas leituras de hodômetro e as suas mudanças
--      de situação continuavam legíveis consultando as tabelas diretamente.
--
-- A regra é uma só, e é a mesma função em todos os lugares: quem não alcança o
-- veículo não alcança nada que seja sobre ele.
--
-- `public.set_vehicle_status` deixa de ser executável por `authenticated`. Ela
-- não é chamada por nenhum código da aplicação — quem altera situação cadastral
-- é `set_vehicle_registration_status`, que valida os dois valores possíveis,
-- confere permissão e escopo e deixa auditoria. A função continua existindo
-- para os processos internos que a usavam; só não é mais um caminho aberto.
-- =============================================================================

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles
  for update to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.update'))
    and private.vehicle_in_scope(organization_id, id)
  )
  with check (
    organization_id in (select private.permitted_org_ids('vehicles.update'))
    and private.vehicle_in_scope(organization_id, id)
  );

drop policy if exists vehicle_assignments_select on public.vehicle_operation_assignments;
create policy vehicle_assignments_select on public.vehicle_operation_assignments
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and private.vehicle_in_scope(organization_id, vehicle_id)
  );

drop policy if exists vehicle_odometer_select on public.vehicle_odometer_readings;
create policy vehicle_odometer_select on public.vehicle_odometer_readings
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and private.vehicle_in_scope(organization_id, vehicle_id)
  );

drop policy if exists vehicle_status_history_select on public.vehicle_status_history;
create policy vehicle_status_history_select on public.vehicle_status_history
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and private.vehicle_in_scope(organization_id, vehicle_id)
  );

revoke execute on function public.set_vehicle_status(uuid, text, text) from authenticated, anon, public;

comment on function public.set_vehicle_status(uuid, text, text) is
  'Rotina da fundação, sem verificação de permissão nem de escopo próprios. Não concedida a authenticated: a situação cadastral é alterada por public.set_vehicle_registration_status.';
