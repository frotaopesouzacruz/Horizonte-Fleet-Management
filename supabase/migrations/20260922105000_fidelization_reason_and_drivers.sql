-- =============================================================================
-- ETAPA 08 · DUAS CORREÇÕES NA FIDELIZAÇÃO
--
-- 1. A INVERSÃO NÃO FECHAVA OS MOTORISTAS, E ISSO A DERRUBAVA INTEIRA.
--
--    `invert_fidelization_vehicles` encurtava os dois vínculos e criava os dois
--    novos, mas deixava os motoristas planejados com o fim antigo. A verificação
--    diferida de período pai/filho — que existe justamente para isso — disparava
--    no COMMIT e desfazia a transação toda. O efeito para quem usa: a tela
--    parecia funcionar e a inversão simplesmente não acontecia.
--
--    O mesmo buraco existia no ramo de cancelamento da substituição, quando a
--    troca vale a partir do primeiro dia do vínculo.
--
-- 2. `reason` FAZIA DOIS TRABALHOS E PERDIA UM DELES.
--
--    A mesma coluna guardava "por que este vínculo existe" e "por que ele foi
--    encerrado", e toda rotina de encerramento sobrescrevia a primeira resposta.
--    Um veículo que entrou por inversão e saiu por manutenção passava a alegar
--    que entrou por manutenção. `leadership_assignments` já separava as duas
--    coisas em `notes` e `end_reason`; a fidelização passa a separar também.
--
--    Os vínculos já gravados não perdem nada: `reason` continua com o que tem e
--    `end_reason` nasce nulo.
-- =============================================================================

alter table public.fidelization_assignments
  add column if not exists end_reason text;

alter table public.fidelization_assignments
  drop constraint if exists fidelization_end_reason_check;
alter table public.fidelization_assignments
  add constraint fidelization_end_reason_check
  check (end_reason is null or length(end_reason) <= 500);

alter table public.fidelization_drivers
  add column if not exists end_reason text;

alter table public.fidelization_drivers
  drop constraint if exists fidelization_drivers_end_reason_check;
alter table public.fidelization_drivers
  add constraint fidelization_drivers_end_reason_check
  check (end_reason is null or length(end_reason) <= 500);

comment on column public.fidelization_assignments.reason is
  'Por que este vínculo existe. Escrito na criação e nunca sobrescrito por um encerramento.';
comment on column public.fidelization_assignments.end_reason is
  'Por que o vínculo foi encerrado ou cancelado. Obrigatório nas rotinas de encerramento e substituição (§49).';

-- -----------------------------------------------------------------------------
-- private.close_assignment_drivers
--
-- Encerrar ou cancelar um vínculo tem exatamente uma consequência correta sobre
-- os seus motoristas, e ela estava escrita em três lugares — dois deles
-- incompletos. Agora está escrita uma vez.
-- -----------------------------------------------------------------------------
create or replace function private.close_assignment_drivers(
  p_assignment_id uuid,
  p_end_date      date,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_end_date is null then
    -- O vínculo foi cancelado: não houve período nenhum, e nenhum motorista
    -- pode sobreviver a ele.
    update public.fidelization_drivers
       set status = 'cancelled', end_reason = p_reason
     where fidelization_assignment_id = p_assignment_id
       and status <> 'cancelled';
    return;
  end if;

  -- Quem começava depois do novo fim nunca chegou a valer.
  update public.fidelization_drivers
     set status = 'cancelled', end_reason = p_reason
   where fidelization_assignment_id = p_assignment_id
     and status <> 'cancelled'
     and start_date > p_end_date;

  -- Quem atravessava o novo fim termina nele.
  update public.fidelization_drivers
     set end_date = p_end_date, end_reason = p_reason
   where fidelization_assignment_id = p_assignment_id
     and status <> 'cancelled'
     and start_date <= p_end_date
     and (end_date is null or end_date > p_end_date);
end;
$$;

revoke execute on function private.close_assignment_drivers(uuid, date, text) from public, anon;

-- =============================================================================
-- end_fidelization_assignment — agora grava end_reason e delega os motoristas
-- =============================================================================
create or replace function public.end_fidelization_assignment(
  p_id       uuid,
  p_end_date date,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_why is null then
    raise exception 'Informe o motivo do encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_assignments where id = p_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;

  perform private.lock_br(v_row.operation_br_id, 'fidelization.change_vehicle');

  if p_end_date is null then
    raise exception 'Informe a data de encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  if p_end_date < v_row.start_date then
    -- Encerrar antes de começar significa que o planejamento não aconteceu.
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = v_why
     where id = p_id;
    perform private.close_assignment_drivers(p_id, null, v_why);
  else
    update public.fidelization_assignments
       set end_date = p_end_date, end_reason = v_why
     where id = p_id;
    perform private.close_assignment_drivers(p_id, p_end_date, v_why);
  end if;
end;
$$;

revoke execute on function public.end_fidelization_assignment(uuid, date, text) from public, anon;
grant  execute on function public.end_fidelization_assignment(uuid, date, text) to authenticated;

-- =============================================================================
-- substitute_fidelization_vehicle — o ramo de cancelamento também fecha motoristas
-- =============================================================================
create or replace function public.substitute_fidelization_vehicle(
  p_assignment_id  uuid,
  p_new_vehicle_id uuid,
  p_effective_from date,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_br     public.operation_brs;
  v_new_id uuid;
  v_why    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_why is null then
    raise exception 'Informe o motivo da substituição.' using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_from is null then
    raise exception 'Informe a data a partir da qual a substituição vale.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_assignments where id = p_assignment_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'Este vínculo está cancelado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_row.vehicle_id = p_new_vehicle_id then
    raise exception 'O veículo escolhido já é o veículo atual desta BR.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_row.end_date is not null and p_effective_from > v_row.end_date then
    raise exception 'A substituição (%) é posterior ao fim do vínculo (%).',
      to_char(p_effective_from, 'DD/MM/YYYY'), to_char(v_row.end_date, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  v_br := private.lock_br(v_row.operation_br_id, 'fidelization.change_vehicle');
  perform private.assert_vehicle_fidelizable(v_row.organization_id, p_new_vehicle_id, v_br.operation_id);

  -- Fecha primeiro. A ordem importa: a constraint de ocupação é imediata, e
  -- inserir o novo antes de fechar o antigo bateria contra ela.
  if p_effective_from <= v_row.start_date then
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = v_why
     where id = p_assignment_id;
    perform private.close_assignment_drivers(p_assignment_id, null, v_why);
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, end_reason = v_why
     where id = p_assignment_id;
    perform private.close_assignment_drivers(p_assignment_id, p_effective_from - 1, v_why);
  end if;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_row.organization_id, v_row.operation_br_id, p_new_vehicle_id, v_row.vehicle_role,
     greatest(p_effective_from, v_row.start_date), v_row.end_date,
     'planned', 'substitution', v_why, p_assignment_id)
  returning id into v_new_id;

  return jsonb_build_object('previous_id', p_assignment_id, 'new_id', v_new_id);
end;
$$;

revoke execute on function public.substitute_fidelization_vehicle(uuid, uuid, date, text) from public, anon;
grant  execute on function public.substitute_fidelization_vehicle(uuid, uuid, date, text) to authenticated;

-- =============================================================================
-- invert_fidelization_vehicles — a correção que faltava
-- =============================================================================
create or replace function public.invert_fidelization_vehicles(
  p_assignment_a   uuid,
  p_assignment_b   uuid,
  p_effective_from date,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a      record;
  v_b      record;
  v_br_a   public.operation_brs;
  v_br_b   public.operation_brs;
  v_new_a  uuid;
  v_new_b  uuid;
  v_first  uuid;
  v_second uuid;
  v_why    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_why is null then
    raise exception 'Informe o motivo da inversão.' using errcode = 'invalid_parameter_value';
  end if;
  if p_effective_from is null then
    raise exception 'Informe a data a partir da qual a inversão vale.'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_assignment_a = p_assignment_b then
    raise exception 'Escolha dois vínculos diferentes para inverter.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Travar sempre na mesma ordem. Duas inversões simultâneas dos mesmos dois
  -- vínculos, em sentidos opostos, travariam uma na outra para sempre.
  v_first  := least(p_assignment_a, p_assignment_b);
  v_second := greatest(p_assignment_a, p_assignment_b);
  perform 1 from public.fidelization_assignments where id = v_first  for update;
  perform 1 from public.fidelization_assignments where id = v_second for update;

  select * into v_a from public.fidelization_assignments where id = p_assignment_a;
  select * into v_b from public.fidelization_assignments where id = p_assignment_b;

  if v_a.id is null or v_b.id is null then
    raise exception 'Um dos vínculos de fidelização não foi encontrado.' using errcode = 'no_data_found';
  end if;
  if v_a.organization_id <> v_b.organization_id then
    raise exception 'Os vínculos pertencem a organizações diferentes.' using errcode = 'insufficient_privilege';
  end if;
  if v_a.status = 'cancelled' or v_b.status = 'cancelled' then
    raise exception 'Um dos vínculos está cancelado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_a.operation_br_id = v_b.operation_br_id then
    raise exception 'Os dois vínculos são da mesma BR — não há o que inverter.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_a.vehicle_id = v_b.vehicle_id then
    raise exception 'Os dois vínculos já são do mesmo veículo.' using errcode = 'invalid_parameter_value';
  end if;

  v_br_a := private.lock_br(v_a.operation_br_id, 'fidelization.change_vehicle');
  v_br_b := private.lock_br(v_b.operation_br_id, 'fidelization.change_vehicle');

  -- Cada veículo tem de ser elegível na operação para onde vai, não na de onde
  -- veio. Duas BRs podem ser de operações diferentes.
  perform private.assert_vehicle_fidelizable(v_a.organization_id, v_b.vehicle_id, v_br_a.operation_id);
  perform private.assert_vehicle_fidelizable(v_b.organization_id, v_a.vehicle_id, v_br_b.operation_id);

  -- Fecha os dois — e os motoristas dos dois — antes de abrir qualquer um.
  if p_effective_from <= v_a.start_date then
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = v_why where id = v_a.id;
    perform private.close_assignment_drivers(v_a.id, null, v_why);
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, end_reason = v_why where id = v_a.id;
    perform private.close_assignment_drivers(v_a.id, p_effective_from - 1, v_why);
  end if;

  if p_effective_from <= v_b.start_date then
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = v_why where id = v_b.id;
    perform private.close_assignment_drivers(v_b.id, null, v_why);
  else
    update public.fidelization_assignments
       set end_date = p_effective_from - 1, end_reason = v_why where id = v_b.id;
    perform private.close_assignment_drivers(v_b.id, p_effective_from - 1, v_why);
  end if;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_a.organization_id, v_a.operation_br_id, v_b.vehicle_id, v_a.vehicle_role,
     greatest(p_effective_from, v_a.start_date), v_a.end_date,
     'planned', 'inversion', v_why, v_a.id)
  returning id into v_new_a;

  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date,
     status, source, reason, replaces_assignment_id)
  values
    (v_b.organization_id, v_b.operation_br_id, v_a.vehicle_id, v_b.vehicle_role,
     greatest(p_effective_from, v_b.start_date), v_b.end_date,
     'planned', 'inversion', v_why, v_b.id)
  returning id into v_new_b;

  return jsonb_build_object(
    'previous', jsonb_build_array(v_a.id, v_b.id),
    'created',  jsonb_build_array(v_new_a, v_new_b)
  );
end;
$$;

revoke execute on function public.invert_fidelization_vehicles(uuid, uuid, date, text) from public, anon;
grant  execute on function public.invert_fidelization_vehicles(uuid, uuid, date, text) to authenticated;

comment on function public.invert_fidelization_vehicles(uuid, uuid, date, text) is
  'Inverte os veículos de dois vínculos de fidelização atomicamente (§50), encerrando também os motoristas dos vínculos substituídos.';

-- -----------------------------------------------------------------------------
-- end_fidelization_driver passa a gravar end_reason em vez de reason
-- -----------------------------------------------------------------------------
create or replace function public.end_fidelization_driver(
  p_id       uuid,
  p_end_date date,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        record;
  v_assignment record;
  v_why        text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_why is null then
    raise exception 'Informe o motivo do encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_drivers where id = p_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de motorista não encontrado.' using errcode = 'no_data_found';
  end if;

  select * into v_assignment from public.fidelization_assignments
   where id = v_row.fidelization_assignment_id;
  perform private.lock_br(v_assignment.operation_br_id, 'fidelization.change_driver');

  if p_end_date is null then
    raise exception 'Informe a data de encerramento.' using errcode = 'invalid_parameter_value';
  end if;

  if p_end_date < v_row.start_date then
    update public.fidelization_drivers
       set status = 'cancelled', end_reason = v_why where id = p_id;
  else
    update public.fidelization_drivers
       set end_date = p_end_date, end_reason = v_why where id = p_id;
  end if;
end;
$$;

revoke execute on function public.end_fidelization_driver(uuid, date, text) from public, anon;
grant  execute on function public.end_fidelization_driver(uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- O read model passa a expor as duas respostas
--
-- `end_reason` entra no fim da lista de colunas porque CREATE OR REPLACE VIEW
-- só admite acréscimos ali — e a ordem das colunas de um read model não carrega
-- significado nenhum.
-- -----------------------------------------------------------------------------
create or replace view public.fidelization_directory
with (security_invoker = on) as
select
  a.id,
  a.organization_id,
  a.operation_br_id,
  b.code                    as br_code,
  b.operation_id,
  o.name                    as operation_name,
  b.state_id,
  st.uf                     as state_uf,
  b.city_id,
  ci.name                   as city_name,

  a.vehicle_id,
  v.fleet_code,
  v.license_plate,
  vt.name                   as vehicle_type_name,
  vmk.name                  as vehicle_make_name,
  vmo.name                  as vehicle_model_name,

  a.vehicle_role,
  a.start_date,
  a.end_date,
  a.status,
  a.source,
  a.reason,
  a.replaces_assignment_id,
  (a.status <> 'cancelled'
   and a.start_date <= current_date
   and (a.end_date is null or a.end_date >= current_date)) as is_current,

  a.created_at,
  a.created_by,
  a.updated_at,
  a.updated_by,
  a.end_reason
from public.fidelization_assignments a
join public.operation_brs b on b.id = a.operation_br_id
join public.operations    o on o.id = b.operation_id
join public.states       st on st.id = b.state_id
join public.cities       ci on ci.id = b.city_id
join public.vehicles      v on v.id = a.vehicle_id
left join public.vehicle_types  vt  on vt.id  = v.vehicle_type_id
left join public.vehicle_models vmo on vmo.id = v.vehicle_model_id
left join public.vehicle_makes  vmk on vmk.id = vmo.vehicle_make_id;

grant select on public.fidelization_directory to authenticated;
