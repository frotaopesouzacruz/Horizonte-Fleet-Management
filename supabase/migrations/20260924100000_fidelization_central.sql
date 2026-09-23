-- =============================================================================
-- Etapa 15 · Governança Operacional › Central de Fidelização
--
-- Aditiva. Nenhuma tabela existente perde coluna, nenhum dado é apagado.
--
--  1. Permissão `fidelization.manage_historical_data` e a regra que ela
--     protege: mudar quem ocupou uma BR em dia que já passou é correção
--     histórica (§44).
--  2. `fidelization_movements` — o Histórico de Mobilizações: um evento por
--     alteração efetiva, gravado no COMMIT por gatilhos diferidos sobre as
--     próprias tabelas de vínculo. Nenhuma rotina precisa lembrar de registrar;
--     nenhuma alteração escapa; nada é contado duas vezes (§16, §41–§45).
--     Imutável: não há UPDATE nem DELETE, nem para o dono da tabela.
--  3. Reconstrução do histórico já existente, marcada como reconstruída.
--  4. `apply_fidelization_period` — a edição da célula do planner (§23–§28):
--     vincular, substituir, remover ou inverter num intervalo de datas, com
--     prévia exata (a mesma rotina, desfeita) e numa transação.
--  5. Leitura: `fidelization_planner_matrix` (matriz com liderança da
--     competência e filtros), `fidelization_movements_list` e a estabilidade
--     com veículos e motoristas fidelizados e recortes por estado e tipo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissão de correção histórica
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('fidelization.manage_historical_data', 'fidelization', 'Corrigir dados históricos da fidelização',
   'Alterar vínculos de veículo ou motorista em datas que já passaram (correção histórica auditada)')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code) values
  ('administrador', 'fidelization.manage_historical_data'),
  ('gestor_frota',  'fidelization.manage_historical_data')
on conflict do nothing;

-- O "hoje" da fidelização. Datas operacionais do HFM são de São Paulo; o
-- `current_date` do servidor é UTC e vira o dia às 21h.
create or replace function private.fidelization_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

grant execute on function private.fidelization_today() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1b. A regra: alterar a cobertura de um dia anterior a hoje exige permissão.
--
-- Um gatilho, e não um teste em cada rotina, porque são onze rotinas que
-- escrevem vínculos (planejar, substituir, inverter, encerrar, cancelar,
-- motoristas, replicar, importar, editar período…) e a próxima também
-- escreveria. Encerrar ontem (substituição que vale a partir de hoje) não é
-- retroativo: nenhum dia passado muda de ocupante. Rotinas do sistema (sem
-- sessão) não passam por aqui.
-- -----------------------------------------------------------------------------
create or replace function private.tg_fidelization_historical_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.fidelization_today();
  v_retro boolean := false;
  v_old_end date;
  v_new_end date;
  v_old_subject uuid;
  v_new_subject uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'fidelization_assignments' then
    v_new_subject := new.vehicle_id;
    if tg_op = 'UPDATE' then v_old_subject := old.vehicle_id; end if;
  else
    v_new_subject := new.employee_id;
    if tg_op = 'UPDATE' then v_old_subject := old.employee_id; end if;
  end if;

  if tg_op = 'INSERT' then
    v_retro := new.status <> 'cancelled' and new.start_date < v_today;
  elsif old.status = 'cancelled' then
    -- Reativar um vínculo cancelado é criá-lo de novo.
    v_retro := new.status <> 'cancelled' and new.start_date < v_today;
  elsif new.status = 'cancelled' then
    v_retro := old.start_date < v_today;
  else
    if new.start_date is distinct from old.start_date then
      v_retro := v_retro or least(new.start_date, old.start_date) < v_today;
    end if;
    if v_new_subject is distinct from v_old_subject then
      v_retro := v_retro or old.start_date < v_today;
    end if;
    v_old_end := coalesce(old.end_date, 'infinity'::date);
    v_new_end := coalesce(new.end_date, 'infinity'::date);
    if v_new_end < v_old_end then
      -- Encurtar: os dias depois do novo fim perdem o ocupante.
      v_retro := v_retro or new.end_date < v_today - 1;
    elsif v_new_end > v_old_end then
      -- Estender: os dias depois do fim antigo ganham ocupante.
      v_retro := v_retro or old.end_date < v_today - 1;
    end if;
  end if;

  if v_retro and not private.has_permission(new.organization_id, 'fidelization.manage_historical_data') then
    raise exception 'Alterar o planejamento de datas que já passaram é uma correção histórica e exige a permissão "Corrigir dados históricos da fidelização".'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_fidelization_historical_guard() from public, anon;

drop trigger if exists fidelization_historical_guard on public.fidelization_assignments;
create trigger fidelization_historical_guard
  before insert or update on public.fidelization_assignments
  for each row execute function private.tg_fidelization_historical_guard();

drop trigger if exists fidelization_drivers_historical_guard on public.fidelization_drivers;
create trigger fidelization_drivers_historical_guard
  before insert or update on public.fidelization_drivers
  for each row execute function private.tg_fidelization_historical_guard();

-- -----------------------------------------------------------------------------
-- 2. Histórico de Mobilizações
-- -----------------------------------------------------------------------------
create table if not exists public.fidelization_movements (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id),
  movement_type               text not null,
  subject                     text not null,
  effective_date              date not null,
  operation_br_id             uuid not null references public.operation_brs (id),
  operation_id                uuid not null references public.operations (id),
  state_id                    smallint not null references public.states (id),
  city_id                     integer not null references public.cities (id),
  leader_employee_id          uuid references public.employees (id),
  assignment_id               uuid references public.fidelization_assignments (id),
  previous_assignment_id      uuid references public.fidelization_assignments (id),
  previous_vehicle_id         uuid references public.vehicles (id),
  new_vehicle_id              uuid references public.vehicles (id),
  driver_link_id              uuid references public.fidelization_drivers (id),
  previous_driver_employee_id uuid references public.employees (id),
  new_driver_employee_id      uuid references public.employees (id),
  driver_role                 text,
  period_start                date,
  period_end                  date,
  reason                      text,
  source                      text,
  origin                      text not null,
  is_inferred                 boolean not null default false,
  correlation_key             text not null,
  dedupe_key                  text not null,
  details                     jsonb not null default '{}'::jsonb,
  actor_user_id               uuid,
  recorded_at                 timestamptz not null default now(),
  constraint fidelization_movements_dedupe_key unique (dedupe_key),
  constraint fidelization_movements_type_check check (movement_type in (
    'first_allocation', 'vehicle_allocation', 'vehicle_substitution', 'vehicle_inversion',
    'vehicle_removal', 'vehicle_end', 'vehicle_return',
    'driver_allocation', 'driver_substitution', 'driver_end',
    'administrative_correction', 'cancellation')),
  constraint fidelization_movements_subject_check check (subject in ('vehicle', 'driver')),
  constraint fidelization_movements_origin_check check (origin in ('user', 'import', 'replication', 'system', 'reconstructed')),
  constraint fidelization_movements_reason_check check (reason is null or length(reason) <= 1000)
);

comment on table public.fidelization_movements is
  'Histórico de Mobilizações (Etapa 15, §41–§45): um evento por alteração efetiva de veículo ou motorista numa BR, '
  'gravado no commit a partir das tabelas de vínculo. Imutável. is_inferred = troca de titular observada sem '
  'substituição registrada; origin = reconstructed para o histórico anterior à Etapa 15.';

create index if not exists fidelization_movements_org_date_idx
  on public.fidelization_movements (organization_id, effective_date desc);
create index if not exists fidelization_movements_br_idx
  on public.fidelization_movements (operation_br_id, effective_date desc);
create index if not exists fidelization_movements_prev_vehicle_idx
  on public.fidelization_movements (previous_vehicle_id) where previous_vehicle_id is not null;
create index if not exists fidelization_movements_new_vehicle_idx
  on public.fidelization_movements (new_vehicle_id) where new_vehicle_id is not null;
create index if not exists fidelization_movements_correlation_idx
  on public.fidelization_movements (correlation_key);

alter table public.fidelization_movements enable row level security;

drop policy if exists fidelization_movements_select on public.fidelization_movements;
create policy fidelization_movements_select on public.fidelization_movements
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('fidelization.view'))
    and private.br_in_scope(organization_id, operation_br_id)
  );

revoke insert, update, delete, truncate on public.fidelization_movements from anon, authenticated;
grant select on public.fidelization_movements to authenticated;

create or replace function private.tg_fidelization_movements_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O Histórico de Mobilizações é imutável. Correções entram como novos eventos.'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists fidelization_movements_immutable on public.fidelization_movements;
create trigger fidelization_movements_immutable
  before update or delete on public.fidelization_movements
  for each row execute function private.tg_fidelization_movements_immutable();

-- -----------------------------------------------------------------------------
-- 2b. Gravação de um evento. Recebe o que a regra decidiu; resolve o que é
--     cadastro (geografia da BR, liderança na data, ator, origem, contexto).
-- -----------------------------------------------------------------------------
create or replace function private.fidelization_log_movement(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br           public.operation_brs;
  v_leader       uuid;
  v_effective    date := (p ->> 'effective_date')::date;
  v_reconstructed boolean := coalesce((p ->> 'reconstructed')::boolean, false);
  v_source       text := p ->> 'source';
  v_origin       text;
  v_actor        uuid;
  v_details      jsonb := coalesce(p -> 'details', '{}'::jsonb);
  v_notes        text;
  v_context      text;
  v_corr         text;
  v_key          text;
begin
  select * into v_br from public.operation_brs where id = (p ->> 'operation_br_id')::uuid;
  if v_br.id is null then
    return;
  end if;

  select l.employee_id into v_leader from private.br_leadership_at(v_br.id, v_effective) l;

  if v_reconstructed then
    v_origin := 'reconstructed';
    v_actor  := nullif(p ->> 'actor', '')::uuid;
    v_corr   := 'r:' || coalesce(p ->> 'at', '');
    v_key    := 'r:' || (p ->> 'type') || ':' || (p ->> 'entity_id');
  else
    v_actor  := auth.uid();
    v_origin := case
                  when v_source = 'import' then 'import'
                  when v_source = 'replication' then 'replication'
                  when v_actor is null then 'system'
                  else 'user'
                end;
    v_corr   := 'tx:' || txid_current()::text;
    v_key    := v_corr || ':' || (p ->> 'type') || ':' || (p ->> 'entity_id');
    v_notes  := nullif(current_setting('hfm.fidelization_notes', true), '');
    v_context := nullif(current_setting('hfm.fidelization_context', true), '');
    if v_notes is not null then
      v_details := v_details || jsonb_build_object('notes', v_notes);
    end if;
    if v_context is not null then
      v_details := v_details || v_context::jsonb;
    end if;
  end if;

  insert into public.fidelization_movements (
    organization_id, movement_type, subject, effective_date,
    operation_br_id, operation_id, state_id, city_id, leader_employee_id,
    assignment_id, previous_assignment_id, previous_vehicle_id, new_vehicle_id,
    driver_link_id, previous_driver_employee_id, new_driver_employee_id, driver_role,
    period_start, period_end, reason, source, origin, is_inferred,
    correlation_key, dedupe_key, details, actor_user_id, recorded_at)
  values (
    v_br.organization_id, p ->> 'type', p ->> 'subject', v_effective,
    v_br.id, v_br.operation_id, v_br.state_id, v_br.city_id, v_leader,
    nullif(p ->> 'assignment_id', '')::uuid, nullif(p ->> 'previous_assignment_id', '')::uuid,
    nullif(p ->> 'previous_vehicle_id', '')::uuid, nullif(p ->> 'new_vehicle_id', '')::uuid,
    nullif(p ->> 'driver_link_id', '')::uuid, nullif(p ->> 'previous_driver_employee_id', '')::uuid,
    nullif(p ->> 'new_driver_employee_id', '')::uuid, p ->> 'driver_role',
    nullif(p ->> 'period_start', '')::date, nullif(p ->> 'period_end', '')::date,
    left(p ->> 'reason', 1000), v_source, v_origin, coalesce((p ->> 'inferred')::boolean, false),
    v_corr, v_key, v_details, v_actor,
    case when v_reconstructed then coalesce(nullif(p ->> 'at', '')::timestamptz, now()) else now() end)
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke execute on function private.fidelization_log_movement(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2c. As regras de classificação — escritas uma vez, usadas pelo gatilho e
--     pela reconstrução. Sempre leem o estado FINAL da transação.
-- -----------------------------------------------------------------------------

-- Um titular começou numa BR.
create or replace function private.fidelization_record_vehicle_start(p_id uuid, p_reconstructed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.fidelization_assignments;
  p          public.fidelization_assignments;
  v_type     text;
  v_prev_id  uuid;
  v_prev_veh uuid;
  v_inferred boolean := false;
begin
  select * into r from public.fidelization_assignments where id = p_id;
  if r.id is null or r.vehicle_role <> 'primary' or r.status = 'cancelled' then
    return;
  end if;

  if r.replaces_assignment_id is not null then
    select * into p from public.fidelization_assignments where id = r.replaces_assignment_id;
    v_prev_id  := p.id;
    v_prev_veh := p.vehicle_id;
    v_type := case when r.source = 'inversion' then 'vehicle_inversion' else 'vehicle_substitution' end;
  else
    select * into p from public.fidelization_assignments x
     where x.operation_br_id = r.operation_br_id and x.vehicle_role = 'primary'
       and x.status <> 'cancelled' and x.id <> r.id and x.start_date < r.start_date
     order by x.start_date desc
     limit 1;

    if p.id is null then
      v_type := 'first_allocation';
    elsif p.vehicle_id = r.vehicle_id and p.end_date = r.start_date - 1 then
      -- O mesmo veículo continua (replicação da competência, divisão de
      -- período, base mensal importada): não houve mobilização.
      return;
    elsif exists (select 1 from public.fidelization_assignments x
                   where x.operation_br_id = r.operation_br_id and x.vehicle_role = 'primary'
                     and x.status <> 'cancelled' and x.id <> r.id
                     and x.vehicle_id = r.vehicle_id and x.start_date < r.start_date) then
      v_type := 'vehicle_return';
      if p.end_date = r.start_date - 1 then
        v_prev_id := p.id;
        v_prev_veh := p.vehicle_id;
      end if;
    elsif p.end_date = r.start_date - 1 then
      v_type := 'vehicle_substitution';
      v_inferred := true;
      v_prev_id := p.id;
      v_prev_veh := p.vehicle_id;
    else
      v_type := 'vehicle_allocation';
    end if;
  end if;

  perform private.fidelization_log_movement(jsonb_build_object(
    'type', v_type, 'subject', 'vehicle', 'effective_date', r.start_date,
    'operation_br_id', r.operation_br_id, 'assignment_id', r.id,
    'previous_assignment_id', v_prev_id, 'previous_vehicle_id', v_prev_veh, 'new_vehicle_id', r.vehicle_id,
    'period_start', r.start_date, 'period_end', r.end_date, 'reason', r.reason, 'source', r.source,
    'inferred', v_inferred, 'entity_id', r.id, 'reconstructed', p_reconstructed,
    'actor', r.created_by, 'at', r.created_at));
end;
$$;

-- Um titular deixou a BR sem que outro vínculo o tenha substituído.
create or replace function private.fidelization_record_vehicle_end(p_id uuid, p_reconstructed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.fidelization_assignments;
  v_type text;
begin
  select * into r from public.fidelization_assignments where id = p_id;
  if r.id is null or r.vehicle_role <> 'primary' or r.status = 'cancelled' or r.end_date is null then
    return;
  end if;
  -- Substituído ou invertido: o evento é o do sucessor.
  if exists (select 1 from public.fidelization_assignments s
              where s.replaces_assignment_id = r.id and s.status <> 'cancelled') then
    return;
  end if;
  -- Outro titular entra no dia seguinte: o evento é a entrada dele.
  -- O mesmo veículo continua no dia seguinte: não houve saída.
  if exists (select 1 from public.fidelization_assignments s
              where s.operation_br_id = r.operation_br_id and s.vehicle_role = 'primary'
                and s.status <> 'cancelled' and s.id <> r.id and s.start_date = r.end_date + 1) then
    return;
  end if;
  -- A reconstrução só conta saídas que já aconteceram.
  if p_reconstructed and r.end_date >= private.fidelization_today() then
    return;
  end if;

  v_type := case
              when exists (select 1 from public.fidelization_assignments s
                            where s.operation_br_id = r.operation_br_id and s.vehicle_role = 'primary'
                              and s.status <> 'cancelled' and s.vehicle_id = r.vehicle_id
                              and s.start_date > r.end_date)
                then 'vehicle_removal'
              else 'vehicle_end'
            end;

  perform private.fidelization_log_movement(jsonb_build_object(
    'type', v_type, 'subject', 'vehicle', 'effective_date', r.end_date + 1,
    'operation_br_id', r.operation_br_id, 'assignment_id', r.id,
    'previous_vehicle_id', r.vehicle_id,
    'period_start', r.start_date, 'period_end', r.end_date, 'reason', coalesce(r.end_reason, r.reason),
    'source', r.source, 'entity_id', r.id, 'reconstructed', p_reconstructed,
    'actor', coalesce(r.updated_by, r.created_by), 'at', r.updated_at));
end;
$$;

-- Um motorista começou numa BR.
create or replace function private.fidelization_record_driver_start(p_id uuid, p_reconstructed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d       record;
  p       record;
  v_type  text;
  v_prev  uuid;
  v_prev_link uuid;
begin
  select dr.*, a.operation_br_id, a.vehicle_id as assignment_vehicle_id, a.status as assignment_status
    into d
    from public.fidelization_drivers dr
    join public.fidelization_assignments a on a.id = dr.fidelization_assignment_id
   where dr.id = p_id;
  if d.id is null or d.status = 'cancelled' or d.assignment_status = 'cancelled' then
    return;
  end if;

  select d0.id, d0.employee_id, d0.end_date into p
    from public.fidelization_drivers d0
    join public.fidelization_assignments a0 on a0.id = d0.fidelization_assignment_id
   where a0.operation_br_id = d.operation_br_id and d0.driver_role = d.driver_role
     and d0.status <> 'cancelled' and d0.id <> d.id and d0.start_date < d.start_date
     and (d.driver_role = 'primary' or d0.employee_id = d.employee_id)
   order by d0.start_date desc
   limit 1;

  if p.id is not null and p.employee_id = d.employee_id and p.end_date = d.start_date - 1 then
    -- O mesmo motorista segue na BR (troca de veículo, divisão de período).
    return;
  end if;

  if d.driver_role = 'primary' and p.id is not null and p.end_date = d.start_date - 1 then
    v_type := 'driver_substitution';
    v_prev := p.employee_id;
    v_prev_link := p.id;
  else
    v_type := 'driver_allocation';
  end if;

  perform private.fidelization_log_movement(jsonb_build_object(
    'type', v_type, 'subject', 'driver', 'effective_date', d.start_date,
    'operation_br_id', d.operation_br_id, 'assignment_id', d.fidelization_assignment_id,
    'new_vehicle_id', d.assignment_vehicle_id, 'driver_link_id', d.id,
    'previous_driver_employee_id', v_prev, 'new_driver_employee_id', d.employee_id,
    'driver_role', d.driver_role, 'period_start', d.start_date, 'period_end', d.end_date,
    'reason', d.reason, 'details', jsonb_build_object('previous_driver_link_id', v_prev_link),
    'entity_id', d.id, 'reconstructed', p_reconstructed,
    'actor', d.created_by, 'at', d.created_at));
end;
$$;

-- Um motorista deixou a BR sem sucessor contíguo.
create or replace function private.fidelization_record_driver_end(p_id uuid, p_reconstructed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  select dr.*, a.operation_br_id, a.vehicle_id as assignment_vehicle_id
    into d
    from public.fidelization_drivers dr
    join public.fidelization_assignments a on a.id = dr.fidelization_assignment_id
   where dr.id = p_id;
  if d.id is null or d.status = 'cancelled' or d.end_date is null then
    return;
  end if;
  if exists (select 1 from public.fidelization_drivers s
               join public.fidelization_assignments a on a.id = s.fidelization_assignment_id
              where a.operation_br_id = d.operation_br_id and s.driver_role = d.driver_role
                and s.status <> 'cancelled' and s.id <> d.id and s.start_date = d.end_date + 1
                and (d.driver_role = 'primary' or s.employee_id = d.employee_id)) then
    return;
  end if;
  if p_reconstructed and d.end_date >= private.fidelization_today() then
    return;
  end if;

  perform private.fidelization_log_movement(jsonb_build_object(
    'type', 'driver_end', 'subject', 'driver', 'effective_date', d.end_date + 1,
    'operation_br_id', d.operation_br_id, 'assignment_id', d.fidelization_assignment_id,
    'new_vehicle_id', d.assignment_vehicle_id, 'driver_link_id', d.id,
    'previous_driver_employee_id', d.employee_id, 'driver_role', d.driver_role,
    'period_start', d.start_date, 'period_end', d.end_date,
    'reason', coalesce(d.end_reason, d.reason), 'entity_id', d.id, 'reconstructed', p_reconstructed,
    'actor', coalesce(d.updated_by, d.created_by), 'at', d.updated_at));
end;
$$;

revoke execute on function private.fidelization_record_vehicle_start(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.fidelization_record_vehicle_end(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.fidelization_record_driver_start(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.fidelization_record_driver_end(uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2d. Os gatilhos: diferidos até o commit, quando a transação inteira já
--     disse o que fez. Uma substituição fecha o antigo e abre o novo; lida
--     linha a linha seriam dois eventos, lida no commit é um.
-- -----------------------------------------------------------------------------
create or replace function private.tg_fidelization_movement_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.fidelization_assignments;
begin
  select * into r from public.fidelization_assignments where id = new.id;
  if r.id is null or r.vehicle_role <> 'primary' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.fidelization_record_vehicle_start(r.id, false);
    return null;
  end if;

  -- Saída sem sucessor: vale mesmo para um vínculo criado nesta transação
  -- (a regra lê o estado final e a chave do evento não deixa duplicar).
  if r.status <> 'cancelled'
     and coalesce(new.end_date, 'infinity'::date) < coalesce(old.end_date, 'infinity'::date) then
    perform private.fidelization_record_vehicle_end(r.id, false);
  end if;

  -- Criado nesta mesma transação: o evento de entrada já lê o estado final;
  -- cancelamento e correção seriam a mesma história contada duas vezes.
  if r.created_at = now() then
    return null;
  end if;

  if old.status <> 'cancelled' and r.status = 'cancelled' then
    if not exists (select 1 from public.fidelization_assignments s
                    where s.replaces_assignment_id = r.id and s.status <> 'cancelled') then
      perform private.fidelization_log_movement(jsonb_build_object(
        'type', 'cancellation', 'subject', 'vehicle', 'effective_date', old.start_date,
        'operation_br_id', r.operation_br_id, 'assignment_id', r.id, 'previous_vehicle_id', old.vehicle_id,
        'period_start', old.start_date, 'period_end', old.end_date, 'reason', r.end_reason,
        'source', r.source, 'entity_id', r.id));
    end if;
    return null;
  end if;

  if r.status = 'cancelled' then
    return null;
  end if;

  if old.vehicle_id is distinct from new.vehicle_id
     or old.start_date is distinct from new.start_date
     or coalesce(new.end_date, 'infinity'::date) > coalesce(old.end_date, 'infinity'::date) then
    perform private.fidelization_log_movement(jsonb_build_object(
      'type', 'administrative_correction', 'subject', 'vehicle',
      'effective_date', least(old.start_date, new.start_date),
      'operation_br_id', r.operation_br_id, 'assignment_id', r.id,
      'previous_vehicle_id', old.vehicle_id, 'new_vehicle_id', new.vehicle_id,
      'period_start', new.start_date, 'period_end', new.end_date,
      'reason', coalesce(nullif(current_setting('hfm.fidelization_reason', true), ''), r.reason),
      'source', r.source, 'entity_id', r.id || ':' || md5(row(old.vehicle_id, old.start_date, old.end_date, new.vehicle_id, new.start_date, new.end_date)::text),
      'details', jsonb_build_object(
        'before', jsonb_build_object('vehicle_id', old.vehicle_id, 'start_date', old.start_date, 'end_date', old.end_date),
        'after',  jsonb_build_object('vehicle_id', new.vehicle_id, 'start_date', new.start_date, 'end_date', new.end_date))));
  end if;
  return null;
end;
$$;

create or replace function private.tg_fidelization_movement_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.fidelization_drivers;
  v_br uuid;
  v_parent_changed boolean;
begin
  select * into r from public.fidelization_drivers where id = new.id;
  if r.id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.fidelization_record_driver_start(r.id, false);
    return null;
  end if;

  if r.status <> 'cancelled'
     and coalesce(new.end_date, 'infinity'::date) < coalesce(old.end_date, 'infinity'::date) then
    perform private.fidelization_record_driver_end(r.id, false);
  end if;

  if r.created_at = now() then
    return null;
  end if;

  select a.operation_br_id, (a.updated_at = now() and a.created_at <> now()) or a.status = 'cancelled'
    into v_br, v_parent_changed
    from public.fidelization_assignments a where a.id = r.fidelization_assignment_id;

  if old.status <> 'cancelled' and r.status = 'cancelled' then
    -- Cancelado junto com o vínculo do veículo: o evento é o do veículo.
    if not coalesce(v_parent_changed, false) then
      perform private.fidelization_log_movement(jsonb_build_object(
        'type', 'cancellation', 'subject', 'driver', 'effective_date', old.start_date,
        'operation_br_id', v_br, 'assignment_id', r.fidelization_assignment_id,
        'driver_link_id', r.id, 'previous_driver_employee_id', old.employee_id, 'driver_role', r.driver_role,
        'period_start', old.start_date, 'period_end', old.end_date, 'reason', r.end_reason,
        'entity_id', r.id));
    end if;
    return null;
  end if;

  if r.status = 'cancelled' then
    return null;
  end if;

  if old.employee_id is distinct from new.employee_id
     or old.start_date is distinct from new.start_date
     or coalesce(new.end_date, 'infinity'::date) > coalesce(old.end_date, 'infinity'::date) then
    if not coalesce(v_parent_changed, false) then
      perform private.fidelization_log_movement(jsonb_build_object(
        'type', 'administrative_correction', 'subject', 'driver',
        'effective_date', least(old.start_date, new.start_date),
        'operation_br_id', v_br, 'assignment_id', r.fidelization_assignment_id, 'driver_link_id', r.id,
        'previous_driver_employee_id', old.employee_id, 'new_driver_employee_id', new.employee_id,
        'driver_role', r.driver_role, 'period_start', new.start_date, 'period_end', new.end_date,
        'reason', coalesce(nullif(current_setting('hfm.fidelization_reason', true), ''), r.reason),
        'entity_id', r.id || ':' || md5(row(old.employee_id, old.start_date, old.end_date, new.employee_id, new.start_date, new.end_date)::text),
        'details', jsonb_build_object(
          'before', jsonb_build_object('employee_id', old.employee_id, 'start_date', old.start_date, 'end_date', old.end_date),
          'after',  jsonb_build_object('employee_id', new.employee_id, 'start_date', new.start_date, 'end_date', new.end_date))));
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function private.tg_fidelization_movement_vehicle() from public, anon;
revoke execute on function private.tg_fidelization_movement_driver() from public, anon;

drop trigger if exists fidelization_movements_vehicle on public.fidelization_assignments;
create constraint trigger fidelization_movements_vehicle
  after insert or update on public.fidelization_assignments
  deferrable initially deferred
  for each row execute function private.tg_fidelization_movement_vehicle();

drop trigger if exists fidelization_movements_driver on public.fidelization_drivers;
create constraint trigger fidelization_movements_driver
  after insert or update on public.fidelization_drivers
  deferrable initially deferred
  for each row execute function private.tg_fidelization_movement_driver();

-- -----------------------------------------------------------------------------
-- 3. Reconstrução do histórico anterior à Etapa 15 (origin = reconstructed).
--    As mesmas regras, lidas sobre os vínculos já gravados. Saídas futuras
--    não são reconstruídas: ainda não aconteceram.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select id from public.fidelization_assignments
     where vehicle_role = 'primary' and status <> 'cancelled'
     order by operation_br_id, start_date
  loop
    perform private.fidelization_record_vehicle_start(r.id, true);
    perform private.fidelization_record_vehicle_end(r.id, true);
  end loop;

  for r in
    select d.id from public.fidelization_drivers d
     where d.status <> 'cancelled'
     order by d.start_date
  loop
    perform private.fidelization_record_driver_start(r.id, true);
    perform private.fidelization_record_driver_end(r.id, true);
  end loop;
end;
$$;

-- =============================================================================
-- 4. Edição por período (a célula do Planner de Frotas, §23–§28)
-- =============================================================================

-- Tira um vínculo de um intervalo [p_from, p_to] (p_to nulo = em diante):
-- encurta o que vinha antes, cancela o que ficava todo dentro e recria, com os
-- mesmos motoristas, o que continuava depois. Devolve o que fez.
create or replace function private.fidelization_carve(
  p_id     uuid,
  p_from   date,
  p_to     date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         public.fidelization_assignments;
  v_old_end date;
  v_after   boolean;
  v_drivers jsonb;
  v_cont    uuid;
  v_actions jsonb := '[]'::jsonb;
  d         jsonb;
begin
  select * into a from public.fidelization_assignments where id = p_id for update;
  if a.id is null then
    return v_actions;
  end if;
  v_old_end := a.end_date;
  v_after := p_to is not null and coalesce(v_old_end, 'infinity'::date) > p_to;

  if v_after then
    select coalesce(jsonb_agg(jsonb_build_object(
             'employee_id', dr.employee_id, 'driver_role', dr.driver_role,
             'start_date', greatest(dr.start_date, p_to + 1), 'end_date', dr.end_date)), '[]'::jsonb)
      into v_drivers
      from public.fidelization_drivers dr
     where dr.fidelization_assignment_id = a.id and dr.status <> 'cancelled'
       and coalesce(dr.end_date, 'infinity'::date) > p_to;
  end if;

  if a.start_date < p_from then
    update public.fidelization_assignments
       set end_date = p_from - 1, end_reason = p_reason
     where id = a.id;
    perform private.close_assignment_drivers(a.id, p_from - 1, p_reason);
    v_actions := v_actions || jsonb_build_object('kind', 'trim', 'assignment_id', a.id, 'operation_br_id', a.operation_br_id,
      'vehicle_id', a.vehicle_id, 'start_date', a.start_date, 'end_date', p_from - 1, 'previous_end_date', v_old_end);
  else
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = p_reason
     where id = a.id;
    perform private.close_assignment_drivers(a.id, null, p_reason);
    v_actions := v_actions || jsonb_build_object('kind', 'cancel', 'assignment_id', a.id, 'operation_br_id', a.operation_br_id,
      'vehicle_id', a.vehicle_id, 'start_date', a.start_date, 'end_date', v_old_end);
  end if;

  if v_after then
    insert into public.fidelization_assignments
      (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
    values
      (a.organization_id, a.operation_br_id, a.vehicle_id, a.vehicle_role, p_to + 1, v_old_end, 'planned', 'manual',
       left(format('Retorno após o período de %s a %s. %s', to_char(p_from, 'DD/MM/YYYY'), to_char(p_to, 'DD/MM/YYYY'), p_reason), 500))
    returning id into v_cont;

    for d in select * from jsonb_array_elements(v_drivers) loop
      insert into public.fidelization_drivers
        (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, reason)
      values
        (a.organization_id, v_cont, (d ->> 'employee_id')::uuid, d ->> 'driver_role',
         (d ->> 'start_date')::date, nullif(d ->> 'end_date', '')::date, 'Segue com o veículo após o período editado.');
    end loop;

    v_actions := v_actions || jsonb_build_object('kind', 'continue', 'assignment_id', v_cont, 'operation_br_id', a.operation_br_id,
      'vehicle_id', a.vehicle_id, 'start_date', p_to + 1, 'end_date', v_old_end, 'drivers', jsonb_array_length(v_drivers));
  end if;

  return v_actions;
end;
$$;

revoke execute on function private.fidelization_carve(uuid, date, date, text) from public, anon, authenticated;

-- Motoristas de um vínculo que atravessam [p_from, p_to], recortados ao intervalo.
create or replace function private.fidelization_drivers_in(p_assignment_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', dr.employee_id, 'driver_role', dr.driver_role,
           'start_date', greatest(dr.start_date, p_from),
           'end_date', case when p_to is null then dr.end_date
                            when dr.end_date is null then p_to
                            else least(dr.end_date, p_to) end)), '[]'::jsonb)
    from public.fidelization_drivers dr
   where dr.fidelization_assignment_id = p_assignment_id and dr.status <> 'cancelled'
     and dr.start_date <= coalesce(p_to, 'infinity'::date)
     and coalesce(dr.end_date, 'infinity'::date) >= p_from;
$$;

revoke execute on function private.fidelization_drivers_in(uuid, date, date) from public, anon, authenticated;

create or replace function public.apply_fidelization_period(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_br_id     uuid := nullif(p_payload ->> 'operation_br_id', '')::uuid;
  v_vehicle   uuid := nullif(p_payload ->> 'vehicle_id', '')::uuid;
  v_from      date := nullif(p_payload ->> 'date_from', '')::date;
  v_to        date := nullif(p_payload ->> 'date_to', '')::date;
  v_reason    text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_notes     text := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_invert    boolean := coalesce((p_payload ->> 'invert')::boolean, false);
  v_keep      boolean := coalesce((p_payload ->> 'keep_drivers')::boolean, true);
  v_dry       boolean := coalesce((p_payload ->> 'dry_run')::boolean, false);
  v_today     date := private.fidelization_today();
  v_br        public.operation_brs;
  v_other     public.operation_brs;
  v_occ       public.fidelization_assignments[];
  v_foreign   public.fidelization_assignments[];
  v_y         public.fidelization_assignments;
  v_e         public.fidelization_assignments;
  v_replaced  uuid;
  v_mode      text;
  v_perm      text;
  v_can_invert boolean := false;
  v_conflicts jsonb := '[]'::jsonb;
  v_actions   jsonb := '[]'::jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_drivers_b jsonb := '[]'::jsonb;
  v_drivers_c jsonb := '[]'::jsonb;
  v_new       uuid;
  v_new_other uuid;
  v_label     text;
  v_result    jsonb;
  a           public.fidelization_assignments;
  d           jsonb;
begin
  if v_br_id is null or v_from is null then
    raise exception 'Informe a BR e a data inicial do período.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to is not null and v_to < v_from then
    raise exception 'O fim do período (%) não pode ser anterior ao início (%).',
      to_char(v_to, 'DD/MM/YYYY'), to_char(v_from, 'DD/MM/YYYY') using errcode = 'invalid_parameter_value';
  end if;
  if not (private.has_permission(p_organization_id, 'fidelization.plan')
          or private.has_permission(p_organization_id, 'fidelization.change_vehicle')) then
    raise exception 'Você não possui permissão para planejar a fidelização.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_br from public.operation_brs
   where id = v_br_id and organization_id = p_organization_id and deleted_at is null;
  if v_br.id is null or not private.br_in_scope(p_organization_id, v_br.id) then
    raise exception 'Posição operacional (BR) não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_from < v_today and not private.has_permission(p_organization_id, 'fidelization.manage_historical_data') then
    raise exception 'O período começa antes de hoje (%). Alterar datas que já passaram é uma correção histórica e exige a permissão "Corrigir dados históricos da fidelização".',
      to_char(v_today, 'DD/MM/YYYY') using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(x order by x.start_date), '{}') into v_occ
    from public.fidelization_assignments x
   where x.operation_br_id = v_br.id and x.vehicle_role = 'primary' and x.status <> 'cancelled'
     and x.start_date <= coalesce(v_to, 'infinity'::date)
     and coalesce(x.end_date, 'infinity'::date) >= v_from;

  if v_vehicle is not null then
    if exists (select 1 from unnest(v_occ) o where o.vehicle_id = v_vehicle) then
      raise exception 'Este veículo já ocupa a BR em parte deste período. Ajuste o período ou use o encerramento do vínculo existente.'
        using errcode = 'invalid_parameter_value';
    end if;
    select coalesce(array_agg(x order by x.start_date), '{}') into v_foreign
      from public.fidelization_assignments x
     where x.vehicle_id = v_vehicle and x.status <> 'cancelled' and x.operation_br_id <> v_br.id
       and x.start_date <= coalesce(v_to, 'infinity'::date)
       and coalesce(x.end_date, 'infinity'::date) >= v_from;

    select coalesce(v.fleet_code, v.license_plate, 'sem identificação') into v_label
      from public.vehicles v where v.id = v_vehicle and v.organization_id = p_organization_id;
    if v_label is null then
      raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
    end if;
  else
    v_foreign := '{}';
    if cardinality(v_occ) = 0 then
      raise exception 'Não há veículo nesta BR no período escolhido — não há o que remover.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  -- O conflito é mostrado com nome (§28): qual BR, de qual operação, em que período.
  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', f.id,
           'operation_br_id', case when private.br_in_scope(p_organization_id, f.operation_br_id) then f.operation_br_id end,
           'br_code', case when private.br_in_scope(p_organization_id, f.operation_br_id) then b.code else 'BR fora do seu escopo' end,
           'operation_name', case when private.br_in_scope(p_organization_id, f.operation_br_id) then o.name end,
           'city_name', case when private.br_in_scope(p_organization_id, f.operation_br_id) then ci.name end,
           'vehicle_role', f.vehicle_role, 'start_date', f.start_date, 'end_date', f.end_date)
           order by f.start_date), '[]'::jsonb)
    into v_conflicts
    from unnest(v_foreign) f
    join public.operation_brs b on b.id = f.operation_br_id
    join public.operations o on o.id = b.operation_id
    join public.cities ci on ci.id = b.city_id;

  -- A inversão é inequívoca quando o veículo está numa única outra BR como
  -- titular durante todo o período e a BR de destino tem no máximo um titular,
  -- também durante todo o período.
  if cardinality(v_foreign) = 1 then
    v_e := v_foreign[1];
    v_can_invert := v_e.vehicle_role = 'primary'
      and v_e.start_date <= v_from
      and (v_e.end_date is null or (v_to is not null and v_e.end_date >= v_to))
      and (cardinality(v_occ) = 0
           or (cardinality(v_occ) = 1 and v_occ[1].start_date <= v_from
               and (v_occ[1].end_date is null or (v_to is not null and v_occ[1].end_date >= v_to))));
  end if;

  if cardinality(v_foreign) > 0 and not v_invert then
    if v_dry then
      return jsonb_build_object(
        'preview', true, 'mode', 'conflict', 'operation_br_id', v_br.id, 'br_code', v_br.code,
        'vehicle_id', v_vehicle, 'vehicle_label', v_label, 'date_from', v_from, 'date_to', v_to,
        'conflicts', v_conflicts, 'can_invert', v_can_invert, 'actions', '[]'::jsonb,
        'historical', v_from < v_today);
    end if;
    raise exception 'O veículo % já está fidelizado em % no período. Confirme a inversão ou ajuste o período.',
      v_label, (select string_agg(c ->> 'br_code', ', ') from jsonb_array_elements(v_conflicts) c)
      using errcode = 'exclusion_violation';
  end if;

  if v_invert and cardinality(v_foreign) > 0 and not v_can_invert then
    raise exception 'Para inverter, o veículo precisa estar em uma única outra BR durante todo o período, e esta BR precisa ter no máximo um titular também durante todo o período. Ajuste o período.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_mode := case
              when v_vehicle is null then 'remove'
              when cardinality(v_foreign) > 0 and cardinality(v_occ) > 0 then 'invert'
              when cardinality(v_foreign) > 0 then 'transfer'
              when cardinality(v_occ) > 0 then 'substitute'
              else 'allocate'
            end;

  if v_mode <> 'allocate' and v_reason is null then
    raise exception 'Informe o motivo da alteração.' using errcode = 'invalid_parameter_value';
  end if;
  if v_vehicle is not null and v_br.status <> 'active' then
    raise exception 'A BR % está inativa e não recebe novo planejamento.', v_br.code using errcode = 'invalid_parameter_value';
  end if;

  v_perm := case when v_mode = 'allocate' then 'fidelization.plan' else 'fidelization.change_vehicle' end;

  -- Travas sempre na mesma ordem: duas inversões simultâneas em sentidos
  -- opostos não podem esperar uma pela outra.
  if v_mode in ('invert', 'transfer') then
    select * into v_other from public.operation_brs where id = v_e.operation_br_id;
    if v_other.id < v_br.id then
      perform private.lock_br(v_other.id, 'fidelization.change_vehicle');
      perform private.lock_br(v_br.id, v_perm);
    else
      perform private.lock_br(v_br.id, v_perm);
      perform private.lock_br(v_other.id, 'fidelization.change_vehicle');
    end if;
  else
    perform private.lock_br(v_br.id, v_perm);
  end if;

  if v_vehicle is not null then
    perform private.assert_vehicle_fidelizable(p_organization_id, v_vehicle, v_br.operation_id, v_to);
  end if;
  if v_mode = 'invert' then
    v_y := v_occ[1];
    perform private.assert_vehicle_fidelizable(p_organization_id, v_y.vehicle_id, v_other.operation_id, v_to);
  end if;

  perform set_config('hfm.fidelization_notes', coalesce(v_notes, ''), true);
  perform set_config('hfm.fidelization_context',
    jsonb_build_object('period_edit', jsonb_build_object('mode', v_mode, 'date_from', v_from, 'date_to', v_to))::text, true);

  begin
    -- Motoristas que seguem com a BR (§34): capturados antes de fechar.
    if v_keep and v_vehicle is not null and cardinality(v_occ) > 0 then
      v_drivers_b := private.fidelization_drivers_in(
        coalesce((select o.id from unnest(v_occ) o where o.start_date <= v_from order by o.start_date desc limit 1), v_occ[1].id),
        v_from, v_to);
    end if;
    if v_keep and v_mode = 'invert' then
      v_drivers_c := private.fidelization_drivers_in(v_e.id, v_from, v_to);
    end if;

    v_replaced := coalesce((select o.id from unnest(v_occ) o where o.start_date <= v_from order by o.start_date desc limit 1),
                           case when cardinality(v_occ) > 0 then v_occ[1].id end);

    foreach a in array v_occ loop
      v_actions := v_actions || private.fidelization_carve(a.id, v_from, v_to, coalesce(v_reason, 'Alteração pelo planner'));
    end loop;
    if v_mode in ('invert', 'transfer') then
      v_actions := v_actions || private.fidelization_carve(v_e.id, v_from, v_to, v_reason);
    end if;

    if v_vehicle is not null then
      insert into public.fidelization_assignments
        (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason, replaces_assignment_id)
      values
        (p_organization_id, v_br.id, v_vehicle, 'primary', v_from, v_to, 'planned',
         case v_mode when 'invert' then 'inversion' when 'substitute' then 'substitution' else 'manual' end,
         coalesce(v_reason, 'Alocação pelo Planner de Frotas'),
         case when v_mode in ('invert', 'substitute') then v_replaced end)
      returning id into v_new;
      v_created := v_created || jsonb_build_object('kind', 'create', 'assignment_id', v_new, 'operation_br_id', v_br.id,
        'vehicle_id', v_vehicle, 'start_date', v_from, 'end_date', v_to);

      for d in select * from jsonb_array_elements(v_drivers_b) loop
        insert into public.fidelization_drivers
          (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, reason)
        values (p_organization_id, v_new, (d ->> 'employee_id')::uuid, d ->> 'driver_role',
                (d ->> 'start_date')::date, nullif(d ->> 'end_date', '')::date, 'Segue com a BR na troca de veículo.');
      end loop;

      if v_mode = 'invert' then
        insert into public.fidelization_assignments
          (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason, replaces_assignment_id)
        values
          (p_organization_id, v_other.id, v_y.vehicle_id, 'primary', v_from, v_to, 'planned', 'inversion', v_reason, v_e.id)
        returning id into v_new_other;
        v_created := v_created || jsonb_build_object('kind', 'create', 'assignment_id', v_new_other, 'operation_br_id', v_other.id,
          'vehicle_id', v_y.vehicle_id, 'start_date', v_from, 'end_date', v_to);

        for d in select * from jsonb_array_elements(v_drivers_c) loop
          insert into public.fidelization_drivers
            (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, reason)
          values (p_organization_id, v_new_other, (d ->> 'employee_id')::uuid, d ->> 'driver_role',
                  (d ->> 'start_date')::date, nullif(d ->> 'end_date', '')::date, 'Segue com a BR na inversão.');
        end loop;
      end if;
    end if;

    select jsonb_build_object(
      'preview', v_dry, 'mode', v_mode, 'operation_br_id', v_br.id, 'br_code', v_br.code,
      'vehicle_id', v_vehicle, 'vehicle_label', v_label, 'date_from', v_from, 'date_to', v_to,
      'historical', v_from < v_today, 'conflicts', v_conflicts, 'can_invert', v_can_invert,
      'drivers_kept', jsonb_array_length(v_drivers_b) + jsonb_array_length(v_drivers_c),
      'actions', coalesce((
        select jsonb_agg(x || jsonb_build_object(
                 'br_code', b.code,
                 'vehicle_label', coalesce(v.fleet_code, v.license_plate)))
          from jsonb_array_elements(v_actions || v_created) x
          left join public.operation_brs b on b.id = (x ->> 'operation_br_id')::uuid
          left join public.vehicles v on v.id = (x ->> 'vehicle_id')::uuid), '[]'::jsonb))
      into v_result;

    if v_dry then
      -- A prévia é a própria rotina, desfeita: o que ela mostra é exatamente o
      -- que a gravação fará, inclusive as recusas das constraints.
      raise exception using errcode = 'HF000', message = 'dry-run';
    end if;
  exception when sqlstate 'HF000' then
    null;
  end;

  return v_result;
end;
$$;

revoke execute on function public.apply_fidelization_period(uuid, jsonb) from public, anon;
grant  execute on function public.apply_fidelization_period(uuid, jsonb) to authenticated;

comment on function public.apply_fidelization_period(uuid, jsonb) is
  'Edição da célula do Planner de Frotas (Etapa 15): vincula, substitui, remove ou inverte o titular de uma BR '
  'num intervalo [date_from, date_to] (date_to nulo = em diante), preservando o que vem antes e recriando o que '
  'vem depois. dry_run devolve a mesma resposta sem gravar. Motivo obrigatório exceto na primeira alocação.';

-- =============================================================================
-- 5. Leitura
-- =============================================================================

-- Nome de quem registrou — só para membros da mesma organização.
create or replace function private.org_member_name(p_organization_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(p.display_name, ''), p.full_name)
    from public.profiles p
   where p.user_id = p_user_id
     and exists (select 1 from public.organization_memberships m
                  where m.user_id = p_user_id and m.organization_id = p_organization_id);
$$;

revoke execute on function private.org_member_name(uuid, uuid) from public, anon;
grant  execute on function private.org_member_name(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5a. Histórico de Mobilizações (§45)
-- -----------------------------------------------------------------------------
create or replace function public.fidelization_movements_list(
  p_organization_id uuid,
  p_filters         jsonb   default '{}'::jsonb,
  p_page            integer default 1,
  p_page_size       integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from    date := nullif(p_filters ->> 'date_from', '')::date;
  v_to      date := nullif(p_filters ->> 'date_to', '')::date;
  v_op      uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state   smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city    integer := nullif(p_filters ->> 'city_id', '')::integer;
  v_br      uuid := nullif(p_filters ->> 'br_id', '')::uuid;
  v_leader  uuid := nullif(p_filters ->> 'leader_employee_id', '')::uuid;
  v_type    text := nullif(p_filters ->> 'movement_type', '');
  v_subject text := nullif(p_filters ->> 'subject', '');
  v_vehicle text := nullif(lower(btrim(coalesce(p_filters ->> 'vehicle', ''))), '');
  v_driver  text := nullif(lower(btrim(coalesce(p_filters ->> 'driver', ''))), '');
  v_size    integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_offset  integer := (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_out     jsonb;
begin
  with base as (
    select m.*, b.code as br_code, o.name as operation_name, st.uf::text as state_uf, ci.name as city_name,
           le.full_name as leader_name,
           pv.fleet_code as prev_fleet_code, pv.license_plate as prev_plate,
           nv.fleet_code as new_fleet_code, nv.license_plate as new_plate,
           pe.full_name as prev_driver_name, pe.employee_code as prev_driver_code,
           ne.full_name as new_driver_name, ne.employee_code as new_driver_code
      from public.fidelization_movements m
      join public.operation_brs b on b.id = m.operation_br_id
      join public.operations o on o.id = m.operation_id
      join public.states st on st.id = m.state_id
      join public.cities ci on ci.id = m.city_id
      left join public.employees le on le.id = m.leader_employee_id
      left join public.vehicles pv on pv.id = m.previous_vehicle_id
      left join public.vehicles nv on nv.id = m.new_vehicle_id
      left join public.employees pe on pe.id = m.previous_driver_employee_id
      left join public.employees ne on ne.id = m.new_driver_employee_id
     where m.organization_id = p_organization_id
       and (v_from is null or m.effective_date >= v_from)
       and (v_to is null or m.effective_date <= v_to)
       and (v_op is null or m.operation_id = v_op)
       and (v_state is null or m.state_id = v_state)
       and (v_city is null or m.city_id = v_city)
       and (v_br is null or m.operation_br_id = v_br)
       and (v_leader is null or m.leader_employee_id = v_leader)
       and (v_type is null or m.movement_type = v_type)
       and (v_subject is null or m.subject = v_subject)
       and (v_vehicle is null
            or lower(coalesce(pv.fleet_code, '') || ' ' || coalesce(pv.license_plate, '') || ' '
                  || coalesce(nv.fleet_code, '') || ' ' || coalesce(nv.license_plate, '')) like '%' || v_vehicle || '%')
       and (v_driver is null
            or lower(coalesce(pe.full_name, '') || ' ' || coalesce(pe.employee_code, '') || ' '
                  || coalesce(ne.full_name, '') || ' ' || coalesce(ne.employee_code, '')) like '%' || v_driver || '%')
  ),
  page as (
    select * from base order by effective_date desc, recorded_at desc, id limit v_size offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'page', greatest(coalesce(p_page, 1), 1),
    'page_size', v_size,
    'counts', coalesce((select jsonb_object_agg(t.movement_type, t.n)
                          from (select movement_type, count(*) as n from base group by movement_type) t), '{}'::jsonb),
    'reconstructed', (select count(*) from base where origin = 'reconstructed'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'movement_type', p.movement_type, 'subject', p.subject, 'effective_date', p.effective_date,
        'operation_br_id', p.operation_br_id, 'br_code', p.br_code,
        'operation_id', p.operation_id, 'operation_name', p.operation_name,
        'state_uf', p.state_uf, 'city_id', p.city_id, 'city_name', p.city_name,
        'leader_employee_id', p.leader_employee_id, 'leader_name', p.leader_name,
        'previous_vehicle_id', p.previous_vehicle_id, 'previous_vehicle_label', coalesce(p.prev_fleet_code, p.prev_plate),
        'previous_plate', p.prev_plate,
        'new_vehicle_id', p.new_vehicle_id, 'new_vehicle_label', coalesce(p.new_fleet_code, p.new_plate), 'new_plate', p.new_plate,
        'previous_driver_name', p.prev_driver_name, 'previous_driver_code', p.prev_driver_code,
        'new_driver_name', p.new_driver_name, 'new_driver_code', p.new_driver_code, 'driver_role', p.driver_role,
        'period_start', p.period_start, 'period_end', p.period_end, 'reason', p.reason, 'source', p.source,
        'origin', p.origin, 'is_inferred', p.is_inferred, 'correlation_key', p.correlation_key,
        'details', p.details, 'actor_name', private.org_member_name(p.organization_id, p.actor_user_id),
        'recorded_at', p.recorded_at)
        order by p.effective_date desc, p.recorded_at desc, p.id) from page p), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke execute on function public.fidelization_movements_list(uuid, jsonb, integer, integer) from public, anon;
grant  execute on function public.fidelization_movements_list(uuid, jsonb, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5b. Matriz do Planner de Frotas (§19–§22): uma linha por BR, a liderança da
--     competência (Planner de Lideranças, com a exceção por BR), os dias com o
--     titular e os filtros que o HFC tinha e os que faltavam.
-- -----------------------------------------------------------------------------
create or replace function public.fidelization_planner_matrix(
  p_organization_id uuid,
  p_year            integer,
  p_month           integer,
  p_filters         jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_start   date := make_date(p_year, p_month, 1);
  v_end     date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_days    integer := extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::integer;
  v_anchor  date := private.competence_anchor(p_year, p_month);
  v_op      uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state   smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city    integer := nullif(p_filters ->> 'city_id', '')::integer;
  v_br      uuid := nullif(p_filters ->> 'br_id', '')::uuid;
  v_leader  uuid := nullif(p_filters ->> 'leader_employee_id', '')::uuid;
  v_type    uuid := nullif(p_filters ->> 'vehicle_type_id', '')::uuid;
  v_q       text := nullif(lower(btrim(coalesce(p_filters ->> 'q', ''))), '');
  v_vehicle text := nullif(lower(btrim(coalesce(p_filters ->> 'vehicle', ''))), '');
  v_sit     text := nullif(p_filters ->> 'situation', '');
  v_out     jsonb;
begin
  with brs as (
    select b.id, b.code, b.description, b.status, b.operation_id, o.name as operation_name,
           b.state_id, st.uf::text as state_uf, b.city_id, ci.name as city_name,
           l.employee_id as leader_employee_id, l.employee_name as leader_name, l.scope_level as leader_level
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.states st on st.id = b.state_id
      join public.cities ci on ci.id = b.city_id
      left join lateral private.br_leadership_at(b.id, v_anchor) l on true
     where b.organization_id = p_organization_id and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
       and (v_br is null or b.id = v_br)
       and (v_q is null or lower(b.code || ' ' || coalesce(b.description, '')) like '%' || v_q || '%')
  ),
  brs_f as (
    select * from brs where v_leader is null or leader_employee_id = v_leader
  ),
  asg as (
    select a.id, a.operation_br_id, a.vehicle_id, a.start_date, a.end_date, a.status, a.source,
           v.fleet_code, v.license_plate, v.vehicle_type_id, vt.name as vehicle_type_name
      from public.fidelization_assignments a
      join brs_f b on b.id = a.operation_br_id
      left join public.vehicles v on v.id = a.vehicle_id
      left join public.vehicle_types vt on vt.id = v.vehicle_type_id
     where a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_end and coalesce(a.end_date, 'infinity'::date) >= v_start
  ),
  per_br as (
    select b.id,
           count(distinct a.id) as assignments,
           coalesce(sum(least(coalesce(a.end_date, v_end), v_end) - greatest(a.start_date, v_start) + 1), 0)::integer as days_with_vehicle,
           count(*) filter (where a.source in ('substitution', 'inversion') and a.start_date between v_start and v_end) as changes,
           bool_or(v_vehicle is null or lower(coalesce(a.fleet_code, '') || ' ' || coalesce(a.license_plate, '')) like '%' || v_vehicle || '%') as vehicle_match,
           bool_or(v_type is null or a.vehicle_type_id = v_type) as type_match
      from brs_f b
      left join asg a on a.operation_br_id = b.id
     group by b.id
  ),
  selected as (
    select b.*, p.assignments, p.days_with_vehicle, p.changes
      from brs_f b join per_br p on p.id = b.id
     where (v_vehicle is null or coalesce(p.vehicle_match, false))
       and (v_type is null or coalesce(p.type_match, false))
       and (v_sit is null
            or (v_sit = 'with_vehicle' and p.days_with_vehicle > 0)
            or (v_sit = 'without_vehicle' and p.days_with_vehicle = 0)
            or (v_sit = 'partial' and p.days_with_vehicle > 0 and p.days_with_vehicle < v_days)
            or (v_sit = 'full' and p.days_with_vehicle = v_days)
            or (v_sit = 'changed' and p.changes > 0))
  )
  select jsonb_build_object(
    'competence', to_char(v_start, 'YYYY-MM'), 'anchor_date', v_anchor, 'today', private.fidelization_today(),
    'days_in_month', v_days,
    'total', (select count(*) from selected),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'operation_br_id', s.id, 'br_code', s.code, 'br_description', s.description, 'br_status', s.status,
        'operation_id', s.operation_id, 'operation_name', s.operation_name,
        'state_id', s.state_id, 'state_uf', s.state_uf, 'city_id', s.city_id, 'city_name', s.city_name,
        'leader_employee_id', s.leader_employee_id, 'leader_name', s.leader_name, 'leader_level', s.leader_level,
        'days_with_vehicle', s.days_with_vehicle, 'days_without_vehicle', v_days - s.days_with_vehicle,
        'changes', s.changes,
        'segments', coalesce((select jsonb_agg(jsonb_build_object(
            'assignment_id', a.id, 'vehicle_id', a.vehicle_id, 'fleet_code', a.fleet_code, 'license_plate', a.license_plate,
            'vehicle_type_id', a.vehicle_type_id, 'vehicle_type_name', a.vehicle_type_name,
            'status', a.status, 'source', a.source,
            'start_date', a.start_date, 'end_date', a.end_date,
            'first_day', extract(day from greatest(a.start_date, v_start))::integer,
            'last_day', extract(day from least(coalesce(a.end_date, v_end), v_end))::integer,
            'starts_here', a.start_date >= v_start,
            'ends_here', a.end_date is not null and a.end_date <= v_end,
            'drivers', coalesce((select jsonb_agg(jsonb_build_object(
                 'employee_id', dr.employee_id, 'name', e.full_name, 'employee_code', e.employee_code,
                 'driver_role', dr.driver_role, 'start_date', dr.start_date, 'end_date', dr.end_date)
                 order by dr.driver_role, dr.start_date)
               from public.fidelization_drivers dr join public.employees e on e.id = dr.employee_id
              where dr.fidelization_assignment_id = a.id and dr.status <> 'cancelled'
                and dr.start_date <= v_end and coalesce(dr.end_date, 'infinity'::date) >= v_start), '[]'::jsonb))
            order by a.start_date)
          from asg a where a.operation_br_id = s.id), '[]'::jsonb))
        order by s.operation_name, s.leader_name nulls last, s.city_name, s.code)
      from selected s), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke execute on function public.fidelization_planner_matrix(uuid, integer, integer, jsonb) from public, anon;
grant  execute on function public.fidelization_planner_matrix(uuid, integer, integer, jsonb) to authenticated;

comment on function public.fidelization_planner_matrix(uuid, integer, integer, jsonb) is
  'Planner de Frotas (Etapa 15): uma linha por BR com a liderança da competência (data-âncora) e os segmentos de '
  'titular que tocam o mês, com motoristas. Filtros: operação, estado, cidade, BR, q, liderança, veículo, tipo, '
  'situação (with_vehicle, without_vehicle, partial, full, changed). Security invoker.';

-- -----------------------------------------------------------------------------
-- 5c. Estabilidade (Etapa 13.1) com o que a §14 e a §17 pediram a mais:
--     BRs cadastradas (inclusive inativas), veículos e motoristas fidelizados,
--     recortes por estado e por tipo de equipamento. As fórmulas não mudam.
-- -----------------------------------------------------------------------------
create or replace function public.fidelization_stability(
  p_organization_id uuid, p_year integer, p_month integer, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start  date := make_date(p_year, p_month, 1);
  v_end    date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_anchor date := private.competence_anchor(p_year, p_month);
  v_op     uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_state  smallint := nullif(p_filters ->> 'state_id', '')::smallint;
  v_city   integer := nullif(p_filters ->> 'city_id', '')::integer;
  v_leader uuid := nullif(p_filters ->> 'leader_employee_id', '')::uuid;
  v_out    jsonb;
begin
  with brs as (
    select b.id, b.code, b.operation_id, o.name as operation_name, b.city_id, ci.name as city_name, st.uf::text as state_uf,
           (select l.employee_id from private.br_leadership_at(b.id, v_anchor) l) as leader_employee_id
      from public.operation_brs b
      join public.operations o on o.id = b.operation_id
      join public.cities ci on ci.id = b.city_id
      join public.states st on st.id = b.state_id
     where b.organization_id = p_organization_id and b.deleted_at is null and b.status = 'active'
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  brs_f as (
    select b.*, e.full_name as leader_name,
           (select v.vehicle_type_id from public.fidelization_assignments a join public.vehicles v on v.id = a.vehicle_id
             where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)
             order by (a.start_date <= v_anchor and (a.end_date is null or a.end_date >= v_anchor)) desc, a.start_date desc
             limit 1) as vehicle_type_id
      from brs b left join public.employees e on e.id = b.leader_employee_id
     where v_leader is null or b.leader_employee_id = v_leader
  ),
  veh as (
    select b.id as br_id,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                      and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)) as with_vehicle,
           exists (select 1 from public.fidelization_assignments a
                    where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                      and a.start_date <= v_anchor and (a.end_date is null or a.end_date >= v_anchor)) as with_vehicle_now,
           exists (select 1 from public.fidelization_assignments a join public.fidelization_drivers d on d.fidelization_assignment_id = a.id
                    where a.operation_br_id = b.id and a.status <> 'cancelled' and d.status <> 'cancelled' and d.driver_role = 'primary'
                      and d.start_date <= v_end and (d.end_date is null or d.end_date >= v_start)) as with_driver,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.replaces_assignment_id is not null and a.status <> 'cancelled'
               and a.start_date between v_start and v_end and a.source <> 'inversion') as substitutions,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.replaces_assignment_id is not null and a.status <> 'cancelled'
               and a.start_date between v_start and v_end and a.source = 'inversion') as inversion_rows,
           (select count(*) from public.fidelization_assignments a
             where a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and a.replaces_assignment_id is null and a.start_date between v_start and v_end
               and exists (select 1 from public.fidelization_assignments p
                            where p.operation_br_id = b.id and p.vehicle_role = 'primary' and p.status <> 'cancelled'
                              and p.end_date = a.start_date - 1 and p.vehicle_id <> a.vehicle_id)) as inferred_changes,
           (select count(*) from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
             where a.operation_br_id = b.id and d.status <> 'cancelled' and d.driver_role = 'primary' and d.start_date between v_start and v_end
               and exists (select 1 from public.fidelization_drivers d0 join public.fidelization_assignments a0 on a0.id = d0.fidelization_assignment_id
                            where a0.operation_br_id = b.id and d0.id <> d.id and d0.status <> 'cancelled' and d0.driver_role = 'primary'
                              and d0.end_date = d.start_date - 1 and d0.employee_id <> d.employee_id)) as driver_changes
      from brs_f b
  ),
  agg as (
    select count(*) as brs_total,
           count(*) filter (where v.with_vehicle) as brs_with_vehicle,
           count(*) filter (where v.with_vehicle_now) as brs_with_vehicle_now,
           count(*) filter (where not v.with_vehicle_now) as brs_without_vehicle_now,
           count(*) filter (where v.with_driver) as brs_with_driver,
           count(*) filter (where not v.with_driver) as brs_without_driver,
           count(*) filter (where b.leader_employee_id is not null) as brs_with_leader,
           coalesce(sum(v.substitutions), 0) as substitutions,
           coalesce(sum(v.inversion_rows), 0) as inversion_rows,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_vehicle_change,
           coalesce(sum(v.inferred_changes), 0) as inferred_changes,
           coalesce(sum(v.driver_changes), 0) as driver_changes,
           count(*) filter (where v.driver_changes > 0) as brs_with_driver_change
      from brs_f b join veh v on v.br_id = b.id
  ),
  fleet as (
    select count(distinct a.vehicle_id) as vehicles_fidelized
      from public.fidelization_assignments a join brs_f b on b.id = a.operation_br_id
     where a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_end and (a.end_date is null or a.end_date >= v_start)
  ),
  people as (
    select count(distinct d.employee_id) as drivers_fidelized
      from public.fidelization_drivers d
      join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
      join brs_f b on b.id = a.operation_br_id
     where a.status <> 'cancelled' and d.status <> 'cancelled'
       and d.start_date <= v_end and (d.end_date is null or d.end_date >= v_start)
  ),
  registered as (
    select count(*) as brs_registered
      from public.operation_brs b
     where b.organization_id = p_organization_id and b.deleted_at is null
       and (v_op is null or b.operation_id = v_op)
       and (v_state is null or b.state_id = v_state)
       and (v_city is null or b.city_id = v_city)
  ),
  by_state as (
    select b.state_uf, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.state_uf
  ),
  by_type as (
    select b.vehicle_type_id, vt.name as vehicle_type_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id left join public.vehicle_types vt on vt.id = b.vehicle_type_id
     group by b.vehicle_type_id, vt.name
  ),
  by_op as (
    select b.operation_id, b.operation_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_id, b.operation_name
  ),
  by_city as (
    select b.operation_name, b.city_id, b.city_name, b.state_uf, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.operation_name, b.city_id, b.city_name, b.state_uf
  ),
  by_leader as (
    select b.leader_employee_id, b.leader_name, count(*) as brs,
           count(*) filter (where v.with_vehicle) as with_vehicle,
           coalesce(sum(v.substitutions), 0) + ceil(coalesce(sum(v.inversion_rows), 0) / 2.0) as mobilizations,
           count(*) filter (where v.substitutions + v.inversion_rows > 0) as brs_with_change
      from brs_f b join veh v on v.br_id = b.id group by b.leader_employee_id, b.leader_name
  )
  select jsonb_build_object(
    'competence', to_char(v_start, 'YYYY-MM'), 'anchor_date', v_anchor, 'period_start', v_start, 'period_end', v_end,
    'brs_total', a.brs_total,
    'brs_registered', (select r.brs_registered from registered r),
    'vehicles_fidelized', (select f.vehicles_fidelized from fleet f),
    'drivers_fidelized', (select pp.drivers_fidelized from people pp),
    'brs_with_vehicle', a.brs_with_vehicle,
    'brs_with_vehicle_now', a.brs_with_vehicle_now,
    'brs_without_vehicle_now', a.brs_without_vehicle_now,
    'brs_with_driver', a.brs_with_driver,
    'brs_without_driver', a.brs_without_driver,
    'brs_with_leader', a.brs_with_leader,
    'vehicle_substitutions', a.substitutions,
    'vehicle_inversions', ceil(a.inversion_rows / 2.0)::int,
    'mobilizations', a.substitutions + ceil(a.inversion_rows / 2.0)::int,
    'brs_with_vehicle_change', a.brs_with_vehicle_change,
    'inferred_vehicle_changes', a.inferred_changes,
    'driver_changes', a.driver_changes,
    'brs_with_driver_change', a.brs_with_driver_change,
    'fleet_stability_pct', case when a.brs_with_vehicle = 0 then null
                                else round(100.0 * (1 - a.brs_with_vehicle_change::numeric / a.brs_with_vehicle), 1) end,
    'driver_stability_pct', case when a.brs_with_driver = 0 then null
                                 else round(100.0 * (1 - a.brs_with_driver_change::numeric / a.brs_with_driver), 1) end,
    'leadership_coverage_pct', case when a.brs_total = 0 then null
                                    else round(100.0 * a.brs_with_leader::numeric / a.brs_total, 1) end,
    'by_operation', coalesce((select jsonb_agg(jsonb_build_object('operation_id', o.operation_id, 'operation_name', o.operation_name, 'brs', o.brs,
                                 'with_vehicle', o.with_vehicle, 'mobilizations', o.mobilizations, 'brs_with_change', o.brs_with_change,
                                 'stability_pct', case when o.with_vehicle = 0 then null else round(100.0 * (1 - o.brs_with_change::numeric / o.with_vehicle), 1) end)
                               order by o.operation_name) from by_op o), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('operation_name', c.operation_name, 'city_id', c.city_id, 'city_name', c.city_name, 'state_uf', c.state_uf,
                            'brs', c.brs, 'with_vehicle', c.with_vehicle, 'mobilizations', c.mobilizations, 'brs_with_change', c.brs_with_change,
                            'stability_pct', case when c.with_vehicle = 0 then null else round(100.0 * (1 - c.brs_with_change::numeric / c.with_vehicle), 1) end)
                          order by c.operation_name, c.city_name) from by_city c), '[]'::jsonb),
    'by_state', coalesce((select jsonb_agg(jsonb_build_object('state_uf', s.state_uf, 'brs', s.brs,
                             'with_vehicle', s.with_vehicle, 'mobilizations', s.mobilizations, 'brs_with_change', s.brs_with_change,
                             'stability_pct', case when s.with_vehicle = 0 then null else round(100.0 * (1 - s.brs_with_change::numeric / s.with_vehicle), 1) end)
                           order by s.state_uf) from by_state s), '[]'::jsonb),
    'by_vehicle_type', coalesce((select jsonb_agg(jsonb_build_object('vehicle_type_id', t.vehicle_type_id,
                             'vehicle_type_name', coalesce(t.vehicle_type_name, 'Sem veículo'), 'brs', t.brs,
                             'with_vehicle', t.with_vehicle, 'mobilizations', t.mobilizations, 'brs_with_change', t.brs_with_change,
                             'stability_pct', case when t.with_vehicle = 0 then null else round(100.0 * (1 - t.brs_with_change::numeric / t.with_vehicle), 1) end)
                           order by (t.vehicle_type_name is null), t.vehicle_type_name) from by_type t), '[]'::jsonb),
    'by_leader', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.leader_employee_id, 'leader_name', coalesce(l.leader_name, 'Sem liderança'),
                              'brs', l.brs, 'with_vehicle', l.with_vehicle, 'mobilizations', l.mobilizations, 'brs_with_change', l.brs_with_change,
                              'stability_pct', case when l.with_vehicle = 0 then null else round(100.0 * (1 - l.brs_with_change::numeric / l.with_vehicle), 1) end)
                            order by (l.leader_name is null), l.leader_name) from by_leader l), '[]'::jsonb)
  ) into v_out from agg a;
  return v_out;
end;
$$;

comment on function public.fidelization_stability(uuid, integer, integer, jsonb) is
  'Dashboard de Estabilidade: estabilidade de frota = 1 − BRs com troca de titular / BRs com veículo no mês; '
  'estabilidade de motoristas = 1 − BRs com troca de motorista / BRs com motorista; mobilizações = substituições + '
  'pares de inversão; trocas inferidas à parte. Etapa 15: brs_registered, vehicles_fidelized, drivers_fidelized, '
  'by_state, by_vehicle_type. Security invoker.';

-- -----------------------------------------------------------------------------
-- 5d. Histórico de importações da fidelização (§54): lotes de alocações e de
--     BRs, com os totais e os erros por linha. Vazio sem permissão.
-- -----------------------------------------------------------------------------
create or replace function public.fidelization_import_history(p_organization_id uuid, p_limit integer default 20)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when not (private.has_permission(p_organization_id, 'fidelization.import') or private.has_permission(p_organization_id, 'fidelization.audit'))
      then '[]'::jsonb
    else coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'file_name', b.file_name, 'status', b.status, 'total_rows', b.total_rows,
        'valid_rows', b.valid_rows, 'warning_rows', b.warning_rows, 'error_rows', b.error_rows,
        'created_rows', b.created_rows, 'updated_rows', b.updated_rows, 'skipped_rows', b.skipped_rows,
        'summary', b.summary, 'error_message', b.error_message,
        'created_at', b.created_at, 'processed_at', b.processed_at,
        'created_by_name', private.org_member_name(b.organization_id, b.created_by),
        'errors', coalesce((select jsonb_agg(jsonb_build_object('row', e.row_number, 'message', e.message) order by e.row_number)
                             from (select * from public.import_errors x where x.batch_id = b.id order by x.row_number limit 50) e), '[]'::jsonb))
        order by b.created_at desc)
      from (select * from public.import_batches x
             where x.organization_id = p_organization_id and x.type in ('fidelization', 'operation_brs')
             order by x.created_at desc limit greatest(p_limit, 1)) b), '[]'::jsonb)
  end;
$$;

revoke execute on function public.fidelization_import_history(uuid, integer) from public, anon;
grant  execute on function public.fidelization_import_history(uuid, integer) to authenticated;
