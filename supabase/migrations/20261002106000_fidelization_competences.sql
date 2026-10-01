-- =============================================================================
-- Fidelização — competência mensal contínua (Frota × BR × Local)
--
-- A competência é o mês do calendário. Ao virar o mês, a posição vigente no
-- ÚLTIMO dia do mês anterior vira a posição inicial do novo mês (30/09/2026 →
-- Outubro/2026), em vínculos MENSAIS NOVOS: nenhum vínculo anterior é
-- estendido, alterado ou apagado — o histórico fica como estava. As mudanças
-- do mês seguem pelas rotinas de sempre (substituir, inverter, encerrar,
-- período) e a próxima replicação lê a posição do último dia (31/10 →
-- Novembro).
--
--  1. `fidelization_competences` — o cabeçalho da competência: tipo
--     (histórica/operacional), origem (importação histórica, replicação
--     automática, replicação manual, manual), competência de origem, data de
--     referência e a última execução. A SITUAÇÃO não é gravada: é derivada
--     (Histórica · Encerrada · Em andamento · Planejada · Não criada).
--  2. `fidelization_history_positions` — histórico consolidado 2024/2025,
--     SOMENTE CONSULTA: nunca recalculado, nunca usado para recriar vínculos.
--     BR nula é nula de verdade (nada de "BR 000", "Sem BR", "Não informado").
--  3. `private.fidelization_replicate` — o motor único da replicação, usado
--     pela rotina automática e pela tela ("Replicar competência"): mesma
--     regra, mesma prévia, idempotente (novo · já existente · conflito ·
--     ignorado). `replicate_fidelization_competence` mantém a assinatura e as
--     permissões e delega ao motor.
--  4. `private.fidelization_competence_tick` + pg_cron diário (00:07 BRT):
--     cria a competência do mês corrente uma única vez, a partir do último dia
--     do mês anterior. Lideranças NUNCA são tocadas.
--  5. Leituras: resumo da competência, histórico consolidado e evolução do ano.
--  6. `import_fidelization_history` — carga do histórico 2024/2025 (planilha).
--
-- Aditiva e reaplicável: nenhuma tabela, função, gatilho, política ou
-- constraint existente é removida; nenhum dado é apagado. A constraint
-- `fidelization_source_check` NÃO muda: replicação automática e manual são
-- ambas `source = 'replication'`, distinguidas por `created_by` (nulo = rotina
-- do sistema), pelo cabeçalho da competência e pelo contexto do histórico de
-- mobilizações (`details.replication = auto | manual`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Apoio
-- -----------------------------------------------------------------------------

-- Corte entre o histórico consolidado (consulta) e a operação: 2024 e 2025 são
-- históricos; a partir de Janeiro/2026 a fidelização é operacional (vínculos).
create or replace function private.fidelization_operational_start()
returns date
language sql
immutable
set search_path = ''
as $$
  select date '2026-01-01';
$$;

-- "Outubro/2026"
create or replace function private.fidelization_competence_label(p_competence date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_competence is null then null else
    (array['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
           'Setembro', 'Outubro', 'Novembro', 'Dezembro'])[extract(month from p_competence)::integer]
    || '/' || extract(year from p_competence)::integer::text
  end;
$$;

-- A origem de um vínculo, com nome (requisito 4). Replicação automática e
-- manual dividem `source = 'replication'`; quem gravou decide: a rotina do
-- sistema não tem usuário (created_by nulo).
create or replace function private.fidelization_origin_label(p_source text, p_created_by uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_source = 'import' then 'Importação histórica'
           when p_source = 'replication' and p_created_by is null then 'Replicação automática'
           when p_source = 'replication' then 'Replicação manual'
           else 'Alteração manual'
         end;
$$;

-- A origem do cabeçalho da competência, com nome.
create or replace function private.fidelization_competence_origin_label(p_origin text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_origin
           when 'historical_import'  then 'Importação histórica'
           when 'auto_replication'   then 'Replicação automática'
           when 'manual_replication' then 'Replicação manual'
           when 'manual'             then 'Alteração manual'
         end;
$$;

-- O código de BR como veio do arquivo, ou NULO quando o arquivo só marca a
-- ausência ("-", "BR 000", "Sem BR", "Não informado"…). Ausência é nulo de
-- verdade: um marcador gravado viraria uma BR fantasma nos agrupamentos.
create or replace function private.fidelization_br_code_clean(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_value is null or btrim(p_value) = '' then null
           when coalesce(regexp_replace(upper(private.normalize_label(p_value)), '[^A-Z0-9]', '', 'g'), '') ~ '^(BR)?0*$' then null
           when regexp_replace(upper(private.normalize_label(p_value)), '[^A-Z0-9]', '', 'g') in (
             'SEMBR', 'SEMCODIGO', 'NAOINFORMADO', 'NAOINFORMADA', 'NI', 'NA', 'NULL', 'NULO', 'NENHUM', 'NENHUMA',
             'NAOSEAPLICA', 'SEMINFORMACAO', 'INDEFINIDO', 'VAZIO', 'NAN', 'NONE') then null
           else btrim(p_value)
         end;
$$;

-- Datas da planilha: ISO (2025-03-14), brasileira (14/03/2025) ou só o dia do
-- mês da competência (14).
create or replace function private.fidelization_parse_day(p_value text, p_competence date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v = '' then
    return null;
  elsif v ~ '^\d{4}-\d{2}-\d{2}' then
    return left(v, 10)::date;
  elsif v ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(v, 'DD/MM/YYYY');
  elsif v ~ '^\d{1,2}$' and p_competence is not null then
    return make_date(extract(year from p_competence)::integer, extract(month from p_competence)::integer, v::integer);
  end if;
  raise exception 'Data inválida: "%". Use AAAA-MM-DD, DD/MM/AAAA ou o dia do mês.', v
    using errcode = 'invalid_parameter_value';
end;
$$;

-- A trava da competência de destino: a rotina automática e a replicação manual
-- da mesma competência nunca correm ao mesmo tempo.
create or replace function private.fidelization_competence_lock_key(p_organization_id uuid, p_competence date)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended('fidelization_competence:' || p_organization_id::text || ':' || p_competence::text, 0);
$$;

-- -----------------------------------------------------------------------------
-- 1. Cabeçalho da competência
-- -----------------------------------------------------------------------------
create table if not exists public.fidelization_competences (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  competence         date not null,
  kind               text not null,
  origin             text not null,
  source_competence  date,
  reference_date     date,
  last_run           jsonb,
  runs               integer not null default 0,
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null,

  constraint fidelization_competences_day_check
    check (extract(day from competence) = 1),
  constraint fidelization_competences_kind_check
    check (kind in ('historical', 'operational')),
  -- 2024 e 2025 são históricos (consulta); a partir de 01/2026, operacional.
  constraint fidelization_competences_kind_period_check
    check ((kind = 'historical' and competence < date '2026-01-01')
        or (kind = 'operational' and competence >= date '2026-01-01')),
  constraint fidelization_competences_origin_check
    check (origin in ('historical_import', 'auto_replication', 'manual_replication', 'manual')),
  constraint fidelization_competences_source_check
    check (source_competence is null or (extract(day from source_competence) = 1 and source_competence < competence)),
  constraint fidelization_competences_reference_check
    check (reference_date is null or reference_date < competence),
  constraint fidelization_competences_runs_check
    check (runs >= 0),
  constraint fidelization_competences_notes_check
    check (notes is null or length(notes) <= 1000),
  constraint fidelization_competences_org_competence_key unique (organization_id, competence),
  constraint fidelization_competences_org_id_key unique (organization_id, id)
);

comment on table public.fidelization_competences is
  'Cabeçalho da competência mensal da fidelização: tipo (historical = 2024/2025, só consulta; operational = 2026 em diante), '
  'origem (historical_import, auto_replication, manual_replication, manual), competência de origem, data de referência '
  '(último dia do mês de origem) e a última execução. A situação (Encerrada, Em andamento, Planejada, Não criada) é derivada.';
comment on column public.fidelization_competences.reference_date is
  'Último dia da competência de origem: a posição vigente nesse dia é a posição inicial desta competência.';
comment on column public.fidelization_competences.last_run is
  'Última execução da replicação nesta competência: modo (auto/manual), quando, quem, contagens novos/já existentes/conflitos/ignorados.';

create index if not exists fidelization_competences_org_idx
  on public.fidelization_competences (organization_id, competence desc);

-- Competência, tipo e origem não mudam depois de criados: uma complementação
-- posterior incrementa `runs` e troca `last_run`, mas a competência continua
-- "criada pela replicação automática" (ou manual) — é o que a tela diz.
create or replace function private.tg_fidelization_competence_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.competence is distinct from old.competence
     or new.kind is distinct from old.kind
     or new.origin is distinct from old.origin then
    raise exception 'A competência, o tipo e a origem do cabeçalho não mudam depois de criados.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_fidelization_competence_guard() from public, anon, authenticated;

create or replace trigger fidelization_competences_guard
  before update on public.fidelization_competences
  for each row execute function private.tg_fidelization_competence_guard();

-- Carimbos, organização imutável, auditoria e nada de exclusão (o cabeçalho
-- é o histórico da competência). Os mesmos gatilhos das demais tabelas do HFM.
create or replace trigger fidelization_competences_set_stamps
  before insert or update on public.fidelization_competences
  for each row execute function private.tg_set_stamps();

create or replace trigger fidelization_competences_prevent_tenant_change
  before update on public.fidelization_competences
  for each row execute function private.tg_prevent_tenant_change();

create or replace trigger fidelization_competences_block_delete
  before delete on public.fidelization_competences
  for each row execute function private.tg_block_mutation();

create or replace trigger fidelization_competences_audit
  after insert or update or delete on public.fidelization_competences
  for each row execute function private.tg_audit();

alter table public.fidelization_competences enable row level security;

do $pol$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fidelization_competences'
                and policyname = 'fidelization_competences_select') then
    alter policy fidelization_competences_select on public.fidelization_competences to authenticated
      using (organization_id in (select private.permitted_org_ids('fidelization.view')));
  else
    create policy fidelization_competences_select on public.fidelization_competences for select to authenticated
      using (organization_id in (select private.permitted_org_ids('fidelization.view')));
  end if;
end $pol$;

revoke all on public.fidelization_competences from anon, authenticated;
grant select on public.fidelization_competences to authenticated;
grant all on public.fidelization_competences to service_role;

-- -----------------------------------------------------------------------------
-- 2. Histórico consolidado (2024/2025) — somente consulta
-- -----------------------------------------------------------------------------
create table if not exists public.fidelization_history_positions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  competence_id           uuid not null,
  competence              date not null,
  vehicle_id              uuid not null,
  license_plate_snapshot  text,
  fleet_code_snapshot     text,
  operation_id            uuid not null,
  state_id                smallint not null references public.states (id),
  city_id                 integer not null references public.cities (id),
  operation_br_id         uuid,
  br_code_snapshot        text,
  first_day               date not null,
  last_day                date not null,
  days                    integer not null,
  origin                  text not null default 'historical_import',
  import_batch            text,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id) on delete set null,

  constraint fidelization_history_competence_fkey
    foreign key (organization_id, competence_id)
    references public.fidelization_competences (organization_id, id) on delete restrict,
  constraint fidelization_history_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint fidelization_history_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,
  constraint fidelization_history_br_fkey
    foreign key (organization_id, operation_br_id)
    references public.operation_brs (organization_id, id) on delete restrict,

  constraint fidelization_history_competence_check
    check (extract(day from competence) = 1 and competence < date '2026-01-01'),
  constraint fidelization_history_days_window_check
    check (first_day >= competence
       and last_day >= first_day
       and last_day < (competence + interval '1 month')::date),
  constraint fidelization_history_days_check
    check (days between 1 and 31 and days <= last_day - first_day + 1),
  constraint fidelization_history_origin_check
    check (origin = 'historical_import'),
  -- BR ausente é NULO, nunca um marcador.
  constraint fidelization_history_br_code_check
    check (br_code_snapshot is null or private.fidelization_br_code_clean(br_code_snapshot) is not null),
  constraint fidelization_history_br_consistency_check
    check (operation_br_id is null or br_code_snapshot is not null),
  constraint fidelization_history_batch_check
    check (import_batch is null or length(import_batch) <= 200),
  constraint fidelization_history_position_key unique (competence_id, vehicle_id, first_day)
);

comment on table public.fidelization_history_positions is
  'Histórico consolidado mensal da fidelização (2024/2025): a posição (operação, cidade, BR quando houver) de cada placa '
  'em cada competência. SOMENTE CONSULTA: imutável, nunca recalculado e nunca usado para recriar vínculos atuais ou futuros. '
  'BR ausente é NULL (2024 não tem BR).';
comment on column public.fidelization_history_positions.br_code_snapshot is
  'Código da BR como veio do arquivo; NULL quando o arquivo não tem BR ("-" também é NULL). Nunca um marcador como "BR 000".';

create index if not exists fidelization_history_org_competence_idx
  on public.fidelization_history_positions (organization_id, competence);
create index if not exists fidelization_history_org_operation_idx
  on public.fidelization_history_positions (organization_id, operation_id, competence);
create index if not exists fidelization_history_vehicle_idx
  on public.fidelization_history_positions (vehicle_id, competence);

-- O cabeçalho tem de ser histórico e da mesma competência — a carga confere,
-- e o banco também, para qualquer caminho de escrita.
create or replace function private.tg_fidelization_history_position_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.fidelization_competences;
begin
  select * into h from public.fidelization_competences where id = new.competence_id;
  if h.id is null or h.organization_id <> new.organization_id then
    raise exception 'Competência histórica não encontrada.' using errcode = 'foreign_key_violation';
  end if;
  if h.kind <> 'historical' then
    raise exception 'A competência % é operacional: o histórico consolidado só aceita 2024 e 2025.',
      private.fidelization_competence_label(h.competence) using errcode = 'check_violation';
  end if;
  if h.competence <> new.competence then
    raise exception 'A posição não pertence à competência informada.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_fidelization_history_position_check() from public, anon, authenticated;

create or replace trigger fidelization_history_positions_check
  before insert on public.fidelization_history_positions
  for each row execute function private.tg_fidelization_history_position_check();

-- Imutável: nem UPDATE nem DELETE (o mesmo gatilho dos históricos do HFM).
create or replace trigger fidelization_history_positions_append_only
  before update or delete on public.fidelization_history_positions
  for each row execute function private.tg_block_mutation();

alter table public.fidelization_history_positions enable row level security;

-- Escopo por operação, avaliado uma vez por consulta (sem função por linha).
do $pol$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fidelization_history_positions'
                and policyname = 'fidelization_history_positions_select') then
    alter policy fidelization_history_positions_select on public.fidelization_history_positions to authenticated
      using (organization_id in (select private.permitted_org_ids('fidelization.view'))
             and operation_id in (select private.accessible_operation_ids()));
  else
    create policy fidelization_history_positions_select on public.fidelization_history_positions for select to authenticated
      using (organization_id in (select private.permitted_org_ids('fidelization.view'))
             and operation_id in (select private.accessible_operation_ids()));
  end if;
end $pol$;

revoke all on public.fidelization_history_positions from anon, authenticated;
grant select on public.fidelization_history_positions to authenticated;
grant all on public.fidelization_history_positions to service_role;

-- -----------------------------------------------------------------------------
-- 3. O motor da replicação — um só, para a rotina automática e para a tela
--
-- Sem conferência de permissão: quem chama decide (a RPC pública confere
-- permissão e escopo; a rotina do pg_cron roda como sistema).
--
--   * lê os titulares não cancelados vigentes no ÚLTIMO dia de p_from;
--   * BR ou veículo inativo → ignorado;
--   * a mesma BR já tem o mesmo veículo no destino → já existente;
--   * a BR já tem outro veículo no destino, ou o veículo já está em outra BR
--     no destino → conflito (nada é sobrescrito);
--   * senão → vínculo NOVO de 1º ao último dia do destino, `source =
--     'replication'`, com o status pedido; motorista principal junto, quando
--     pedido, pela mesma regra de antes.
--   * Lideranças não são lidas nem escritas.
-- -----------------------------------------------------------------------------
create or replace function private.fidelization_replicate(
  p_organization_id uuid,
  p_from            date,
  p_to              date,
  p_include_drivers boolean,
  p_dry_run         boolean,
  p_mode            text,
  p_status          text,
  p_operation_id    uuid    default null,
  p_scoped          boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from       date := date_trunc('month', p_from)::date;
  v_to_start   date := date_trunc('month', p_to)::date;
  v_from_last  date;
  v_to_end     date;
  v_why        text;
  v_header     public.fidelization_competences;
  v_existed    boolean;
  x            record;
  v_new        uuid;
  v_same       uuid;
  v_other      text;
  v_elsewhere  text;
  v_rows       jsonb := '[]'::jsonb;
  v_last_run   jsonb;
  n_found integer := 0;
  n_new integer := 0; n_kept integer := 0; n_conflict integer := 0; n_inactive integer := 0;
  d_new integer := 0; d_kept integer := 0; d_conflict integer := 0; d_inactive integer := 0;
  v_status text; v_note text; v_conflict_kind text; v_driver_status text; v_driver_note text;
  v_ops uuid[];
begin
  if p_organization_id is null or p_from is null or p_to is null then
    raise exception 'Organização e competências são obrigatórias.' using errcode = 'invalid_parameter_value';
  end if;
  if p_mode not in ('auto', 'manual') then
    raise exception 'Modo de replicação inválido: %.', p_mode using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('planned', 'confirmed') then
    raise exception 'Situação inicial inválida: %.', p_status using errcode = 'invalid_parameter_value';
  end if;
  if v_to_start <= v_from then
    raise exception 'A competência de destino precisa ser posterior à de origem.' using errcode = 'invalid_parameter_value';
  end if;
  -- 2024 e 2025 são consulta: nem destino, nem premissa para recriar vínculos.
  if v_to_start < private.fidelization_operational_start() then
    raise exception 'A competência % é histórica (somente consulta) e não recebe replicação.',
      private.fidelization_competence_label(v_to_start) using errcode = 'invalid_parameter_value';
  end if;
  if v_from < private.fidelization_operational_start() then
    raise exception 'A competência % é histórica (somente consulta) e não é usada para recriar vínculos.',
      private.fidelization_competence_label(v_from) using errcode = 'invalid_parameter_value';
  end if;

  v_from_last := (v_from + interval '1 month - 1 day')::date;
  v_to_end    := (v_to_start + interval '1 month - 1 day')::date;
  v_why       := 'Replicado de ' || to_char(v_from, 'MM/YYYY');

  -- Uma replicação por competência de destino de cada vez (a automática e a
  -- manual leem e gravam o mesmo mês).
  perform pg_advisory_xact_lock(private.fidelization_competence_lock_key(p_organization_id, v_to_start));

  select * into v_header from public.fidelization_competences c
   where c.organization_id = p_organization_id and c.competence = v_to_start;
  v_existed := v_header.id is not null;
  if v_existed and v_header.kind <> 'operational' then
    raise exception 'A competência % é histórica (somente consulta) e não recebe replicação.',
      private.fidelization_competence_label(v_to_start) using errcode = 'invalid_parameter_value';
  end if;

  if p_scoped then
    select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ops from private.accessible_operation_ids() s(id);
  end if;

  -- O histórico de mobilizações diz de onde veio (lido no COMMIT pelos
  -- gatilhos diferidos e somado aos detalhes do evento).
  if not p_dry_run then
    perform set_config('hfm.fidelization_context',
      jsonb_build_object('replication', p_mode,
                         'competence', to_char(v_to_start, 'YYYY-MM'),
                         'source_competence', to_char(v_from, 'YYYY-MM'))::text, true);
  end if;

  for x in
    select b.id as br_id, b.code as br_code, b.status as br_status, b.operation_id, b.city_id,
           a.id as assignment_id, a.vehicle_id, v.fleet_code, v.license_plate,
           v.status as vehicle_status, v.deleted_at as vehicle_deleted,
           (select d.employee_id from public.fidelization_drivers d
             where d.fidelization_assignment_id = a.id and d.status <> 'cancelled' and d.driver_role = 'primary'
               and d.start_date <= v_from_last and (d.end_date is null or d.end_date >= v_from_last)
             order by d.start_date desc limit 1) as driver_employee_id
      from public.operation_brs b
      join public.fidelization_assignments a on a.operation_br_id = b.id
      join public.vehicles v on v.id = a.vehicle_id
     where b.organization_id = p_organization_id and b.deleted_at is null
       and (p_operation_id is null or b.operation_id = p_operation_id)
       and (not p_scoped or b.operation_id = any (v_ops))
       and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_from_last and (a.end_date is null or a.end_date >= v_from_last)
     order by b.code, v.license_plate
  loop
    n_found := n_found + 1;
    v_driver_status := null; v_driver_note := null; v_new := null; v_same := null;
    v_other := null; v_elsewhere := null; v_conflict_kind := null;

    if x.br_status <> 'active' then
      v_status := 'skipped_inactive_br'; v_note := 'BR inativa'; n_inactive := n_inactive + 1;
    elsif x.vehicle_deleted is not null or x.vehicle_status <> 'active' then
      v_status := 'skipped_inactive_vehicle'; v_note := 'Veículo inativo ou arquivado'; n_inactive := n_inactive + 1;
    else
      select a.id into v_same
        from public.fidelization_assignments a
       where a.operation_br_id = x.br_id and a.vehicle_id = x.vehicle_id
         and a.vehicle_role = 'primary' and a.status <> 'cancelled'
         and a.start_date <= v_to_end and coalesce(a.end_date, 'infinity'::date) >= v_to_start
       order by a.start_date limit 1;

      if v_same is not null then
        -- Já está lá: nunca duplica placa × competência × BR.
        v_new := v_same;
        v_status := 'kept'; v_note := 'Já existe na competência de destino'; n_kept := n_kept + 1;
      else
        select coalesce(ov.license_plate, ov.fleet_code, '?') into v_other
          from public.fidelization_assignments a
          join public.vehicles ov on ov.id = a.vehicle_id
         where a.operation_br_id = x.br_id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
           and a.start_date <= v_to_end and coalesce(a.end_date, 'infinity'::date) >= v_to_start
         order by a.start_date limit 1;

        if v_other is not null then
          v_status := 'conflict'; v_conflict_kind := 'br_occupied';
          v_note := 'BR já planejada no destino com outro veículo (' || v_other || ')';
          n_conflict := n_conflict + 1;
        else
          select ob.code into v_elsewhere
            from public.fidelization_assignments a
            join public.operation_brs ob on ob.id = a.operation_br_id
           where a.vehicle_id = x.vehicle_id and a.status <> 'cancelled'
             and a.start_date <= v_to_end and coalesce(a.end_date, 'infinity'::date) >= v_to_start
             and not (a.operation_br_id = x.br_id and a.vehicle_role = 'primary')
           order by a.start_date limit 1;

          if v_elsewhere is not null then
            v_status := 'conflict'; v_conflict_kind := 'vehicle_elsewhere';
            v_note := 'Veículo já planejado em outra BR no destino (BR ' || v_elsewhere || ')';
            n_conflict := n_conflict + 1;
          else
            v_status := 'new'; v_note := null; n_new := n_new + 1;
            if not p_dry_run then
              insert into public.fidelization_assignments
                (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
              values (p_organization_id, x.br_id, x.vehicle_id, 'primary', v_to_start, v_to_end, p_status, 'replication', v_why)
              returning id into v_new;
            end if;
          end if;
        end if;
      end if;
    end if;

    -- Motoristas: só onde há (ou haverá) o vínculo do MESMO veículo no
    -- destino, sem motorista principal.
    if p_include_drivers and x.driver_employee_id is not null and v_status in ('new', 'kept') then
      if not exists (select 1 from public.employees e
                      where e.id = x.driver_employee_id and e.employment_status = 'active' and e.deleted_at is null) then
        v_driver_status := 'skipped_inactive_driver'; v_driver_note := 'Motorista inativo'; d_inactive := d_inactive + 1;
      elsif v_status = 'kept' and exists (select 1 from public.fidelization_drivers d
                                          where d.fidelization_assignment_id = v_new and d.status <> 'cancelled'
                                            and d.driver_role = 'primary'
                                            and d.start_date <= v_to_end and coalesce(d.end_date, 'infinity'::date) >= v_to_start) then
        v_driver_status := 'kept'; v_driver_note := 'Destino já tem motorista'; d_kept := d_kept + 1;
      elsif exists (select 1 from public.fidelization_drivers d
                      join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
                     where d.employee_id = x.driver_employee_id and d.status <> 'cancelled' and d.driver_role = 'primary'
                       and a.operation_br_id <> x.br_id
                       and d.start_date <= v_to_end and coalesce(d.end_date, 'infinity'::date) >= v_to_start) then
        v_driver_status := 'conflict'; v_driver_note := 'Motorista já planejado em outra BR no destino'; d_conflict := d_conflict + 1;
      else
        v_driver_status := 'new'; d_new := d_new + 1;
        if not p_dry_run and v_new is not null then
          insert into public.fidelization_drivers
            (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status, reason)
          select p_organization_id, v_new, x.driver_employee_id, 'primary',
                 greatest(v_to_start, a.start_date), least(v_to_end, coalesce(a.end_date, v_to_end)),
                 p_status, v_why
            from public.fidelization_assignments a where a.id = v_new;
        end if;
      end if;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'br_id', x.br_id, 'br_code', x.br_code, 'operation_id', x.operation_id,
      'vehicle_id', x.vehicle_id, 'fleet_code', x.fleet_code, 'license_plate', x.license_plate,
      'status', v_status, 'note', v_note, 'conflict_kind', v_conflict_kind,
      'driver_employee_id', x.driver_employee_id,
      'driver_name', (select e.full_name from public.employees e where e.id = x.driver_employee_id),
      'driver_status', v_driver_status, 'driver_note', v_driver_note);
  end loop;

  v_last_run := jsonb_build_object(
    'mode', p_mode, 'status', p_status, 'at', now(), 'by', auth.uid(),
    'from', to_char(v_from, 'YYYY-MM'), 'reference_date', v_from_last, 'plates_found', n_found,
    'operation_id', p_operation_id, 'scoped', p_scoped, 'include_drivers', p_include_drivers,
    'vehicles', jsonb_build_object('new', n_new, 'kept', n_kept, 'conflicts', n_conflict, 'skipped', n_inactive),
    'drivers',  jsonb_build_object('new', d_new, 'kept', d_kept, 'conflicts', d_conflict, 'skipped', d_inactive));

  -- O cabeçalho: criado na primeira execução (com a origem dela); uma
  -- complementação posterior mantém a origem e soma a execução.
  if not p_dry_run then
    if v_existed then
      update public.fidelization_competences
         set runs = runs + 1,
             last_run = v_last_run,
             source_competence = coalesce(source_competence, v_from),
             reference_date = coalesce(reference_date, v_from_last)
       where id = v_header.id;
    elsif n_found > 0 then
      insert into public.fidelization_competences
        (organization_id, competence, kind, origin, source_competence, reference_date, last_run, runs)
      values
        (p_organization_id, v_to_start, 'operational',
         case p_mode when 'auto' then 'auto_replication' else 'manual_replication' end,
         v_from, v_from_last, v_last_run, 1);
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'mode', p_mode,
    'status', p_status,
    'from', to_char(v_from, 'YYYY-MM'), 'to', to_char(v_to_start, 'YYYY-MM'),
    'from_label', private.fidelization_competence_label(v_from),
    'to_label', private.fidelization_competence_label(v_to_start),
    'reference_date', v_from_last,
    'plates_found', n_found,
    'already_created', v_existed,
    'destination', case when v_existed then jsonb_build_object(
        'origin', v_header.origin,
        'origin_label', private.fidelization_competence_origin_label(v_header.origin),
        'created_at', v_header.created_at,
        'created_by_name', private.org_member_name(p_organization_id, v_header.created_by),
        'runs', v_header.runs,
        'last_run', v_header.last_run) end,
    'vehicles', jsonb_build_object('new', n_new, 'kept', n_kept, 'conflicts', n_conflict, 'skipped', n_inactive),
    'drivers',  jsonb_build_object('new', d_new, 'kept', d_kept, 'conflicts', d_conflict, 'skipped', d_inactive),
    'rows', v_rows);
end;
$$;

comment on function private.fidelization_replicate(uuid, date, date, boolean, boolean, text, text, uuid, boolean) is
  'Motor único da replicação da fidelização (automática e manual): posição vigente no último dia de p_from → vínculos '
  'mensais novos [1º..último dia] de p_to. Nunca sobrescreve (novo / já existente / conflito / ignorado); cria ou '
  'complementa o cabeçalho da competência. Não confere permissão (quem chama confere). Não toca lideranças.';

revoke execute on function private.fidelization_replicate(uuid, date, date, boolean, boolean, text, text, uuid, boolean)
  from public, anon, authenticated;

-- A RPC da tela: mesma assinatura, mesmas permissões e escopo; delega ao motor.
-- Situação dos vínculos criados: `confirmed` no mês corrente, `planned` nos
-- demais (futuro, e o passado — que segue exigindo a permissão de correção
-- histórica pelo gatilho `fidelization_historical_guard`).
create or replace function public.replicate_fidelization_competence(
  p_organization_id uuid, p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer,
  p_operation_id uuid default null, p_include_drivers boolean default true, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from    date;
  v_to      date;
  v_current date := date_trunc('month', private.fidelization_today())::date;
begin
  if not private.has_permission(p_organization_id, 'fidelization.plan') then
    raise exception 'Você não possui permissão para replicar o planejamento da fidelização.' using errcode = 'insufficient_privilege';
  end if;
  if p_include_drivers and not private.has_permission(p_organization_id, 'fidelization.change_driver') then
    raise exception 'Você não possui permissão para replicar motoristas.' using errcode = 'insufficient_privilege';
  end if;
  if p_from_month not between 1 and 12 or p_to_month not between 1 and 12 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;
  v_from := make_date(p_from_year, p_from_month, 1);
  v_to   := make_date(p_to_year, p_to_month, 1);
  if v_to <= v_from then
    raise exception 'A competência de destino precisa ser posterior à de origem.' using errcode = 'invalid_parameter_value';
  end if;
  if p_operation_id is not null and not private.can_access_operation(p_operation_id) then
    raise exception 'Esta operação não faz parte do seu escopo de acesso.' using errcode = 'insufficient_privilege';
  end if;

  return private.fidelization_replicate(
    p_organization_id, v_from, v_to, coalesce(p_include_drivers, true), coalesce(p_dry_run, true), 'manual',
    case when v_to = v_current then 'confirmed' else 'planned' end,
    p_operation_id, true);
end;
$$;

comment on function public.replicate_fidelization_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) is
  'Replicar competência (tela): confere fidelization.plan (+ change_driver para motoristas) e o escopo de operação, e '
  'delega ao motor private.fidelization_replicate em modo manual. Idempotente: repetir não duplica; se o destino já foi '
  'criado, só complementa as placas que faltam (already_created = true).';

-- -----------------------------------------------------------------------------
-- 4. Rotina automática (pg_cron): uma vez por competência
-- -----------------------------------------------------------------------------
create or replace function private.fidelization_competence_tick(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o         record;
  v_today   date;
  v_month   date;
  v_prev    date;
  v_res     jsonb;
  v_out     jsonb := '[]'::jsonb;
  n_created integer := 0;
begin
  for o in
    select org.id, org.timezone from public.organizations org
     where org.deleted_at is null and org.status = 'active'
     order by org.created_at, org.id
  loop
    begin
      v_today := coalesce(p_today, (now() at time zone coalesce(nullif(btrim(o.timezone), ''), 'America/Sao_Paulo'))::date);
      v_month := date_trunc('month', v_today)::date;
      v_prev  := (v_month - interval '1 month')::date;

      if v_month < private.fidelization_operational_start() or v_prev < private.fidelization_operational_start() then
        continue;
      end if;

      -- Mesma trava do motor: a replicação manual do mesmo mês espera.
      perform pg_advisory_xact_lock(private.fidelization_competence_lock_key(o.id, v_month));

      if exists (select 1 from public.fidelization_competences c
                  where c.organization_id = o.id and c.competence = v_month) then
        continue; -- já criada (pela rotina ou pela tela): nunca roda duas vezes
      end if;
      if not exists (select 1 from public.fidelization_assignments a
                      where a.organization_id = o.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                        and a.start_date <= v_month - 1 and coalesce(a.end_date, 'infinity'::date) >= v_month - 1) then
        continue; -- nada vigente no último dia do mês anterior
      end if;

      v_res := private.fidelization_replicate(o.id, v_prev, v_month, true, false, 'auto', 'confirmed', null, false);
      -- Os gatilhos diferidos (histórico de mobilizações, motoristas dentro
      -- do vínculo) disparam aqui, dentro do bloco desta organização: um erro
      -- desfaz só ela, e o contexto do histórico é o desta execução.
      set constraints all immediate;
      set constraints all deferred;
      n_created := n_created + 1;
      v_out := v_out || jsonb_build_object(
        'organization_id', o.id, 'competence', to_char(v_month, 'YYYY-MM'),
        'reference_date', v_res -> 'reference_date', 'plates_found', v_res -> 'plates_found',
        'vehicles', v_res -> 'vehicles', 'drivers', v_res -> 'drivers');
    exception when others then
      v_out := v_out || jsonb_build_object('organization_id', o.id, 'competence', to_char(v_month, 'YYYY-MM'),
                                           'error', left(sqlerrm, 500));
    end;
  end loop;

  return jsonb_build_object('ran_at', now(), 'created', n_created, 'results', v_out);
end;
$$;

comment on function private.fidelization_competence_tick(date) is
  'Rotina diária (pg_cron hfm_fidelization_competence_tick): para cada organização ativa, cria a competência do mês '
  'corrente (fuso da organização) a partir do último dia do mês anterior, uma única vez — se o cabeçalho já existe, não faz nada.';

revoke execute on function private.fidelization_competence_tick(date) from public, anon, authenticated;

-- Diária às 03:07 UTC (00:07 em São Paulo): o dia 1º é o normal; os demais
-- dias são a rede de segurança (a rotina só cria o que ainda não existe).
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'hfm_fidelization_competence_tick') then
    perform cron.schedule('hfm_fidelization_competence_tick', '7 3 * * *',
                          'select private.fidelization_competence_tick()');
  end if;
end $cron$;

-- -----------------------------------------------------------------------------
-- 5. Cabeçalhos das competências já existentes (2026-01 … 2026-09): vieram da
--    importação de 2026. Só cria o que falta; nada é reescrito.
-- -----------------------------------------------------------------------------
insert into public.fidelization_competences (organization_id, competence, kind, origin, notes)
select distinct a.organization_id, m.month::date, 'operational', 'historical_import',
       'Competência carregada pela importação de 2026 (antes da replicação mensal).'
  from generate_series(date '2026-01-01', date '2026-09-01', interval '1 month') m(month)
  join public.fidelization_assignments a
    on a.status <> 'cancelled'
   and a.start_date <= (m.month + interval '1 month - 1 day')::date
   and coalesce(a.end_date, 'infinity'::date) >= m.month::date
on conflict (organization_id, competence) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Leituras
-- -----------------------------------------------------------------------------

-- Resumo da competência em tela: tipo, situação (derivada), origem,
-- contagens no escopo de quem consulta e a última atualização; e o resumo do
-- mês anterior (data de referência e placas encontradas) para a replicação.
create or replace function public.fidelization_competence_summary(
  p_organization_id uuid, p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month     date;
  v_end       date;
  v_prev      date;
  v_prev_last date;
  v_current   date := date_trunc('month', private.fidelization_today())::date;
  v_ops       uuid[];
  h           public.fidelization_competences;
  hp          public.fidelization_competences;
  v_kind      text;
  v_plates integer := 0; v_brs integer := 0; v_locais integer := 0; v_operations integer := 0; v_positions integer := 0;
  v_upd_at    timestamptz;
  v_upd_by    uuid;
  v_a_at timestamptz; v_a_by uuid; v_m_at timestamptz; v_m_by uuid;
  v_origin    text;
  v_sit       text;
  v_prev_kind text;
  v_prev_found integer := 0;
begin
  if p_year is null or p_month is null or p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.has_permission(p_organization_id, 'fidelization.view') then
    raise exception 'Você não possui permissão para consultar a fidelização.' using errcode = 'insufficient_privilege';
  end if;

  v_month     := make_date(p_year, p_month, 1);
  v_end       := (v_month + interval '1 month - 1 day')::date;
  v_prev      := (v_month - interval '1 month')::date;
  v_prev_last := v_month - 1;
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ops from private.accessible_operation_ids() s(id);

  select * into h from public.fidelization_competences c
   where c.organization_id = p_organization_id and c.competence = v_month;
  v_kind := coalesce(h.kind, case when v_month < private.fidelization_operational_start() then 'historical' else 'operational' end);

  if v_kind = 'historical' then
    select count(distinct p.vehicle_id),
           count(distinct (p.operation_id, p.city_id, upper(p.br_code_snapshot))) filter (where p.br_code_snapshot is not null),
           count(distinct (p.operation_id, p.city_id)),
           count(distinct p.operation_id),
           count(*),
           max(p.created_at)
      into v_plates, v_brs, v_locais, v_operations, v_positions, v_a_at
      from public.fidelization_history_positions p
     where p.organization_id = p_organization_id and p.competence = v_month
       and p.operation_id = any (v_ops);
    v_upd_at := greatest(h.updated_at, v_a_at);
    v_upd_by := case when h.updated_at is not null and h.updated_at >= coalesce(v_a_at, '-infinity') then h.updated_by end;
    v_sit := 'historical';
  else
    select count(distinct a.vehicle_id),
           count(distinct a.operation_br_id),
           count(distinct (b.operation_id, b.city_id)),
           count(distinct b.operation_id),
           count(*)
      into v_plates, v_brs, v_locais, v_operations, v_positions
      from public.fidelization_assignments a
      join public.operation_brs b on b.id = a.operation_br_id
     where a.organization_id = p_organization_id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_end and coalesce(a.end_date, 'infinity'::date) >= v_month
       and b.operation_id = any (v_ops);

    -- Última atualização: o cabeçalho, os vínculos do mês (inclusive
    -- cancelados) e os eventos do histórico com data no mês.
    select a.updated_at, coalesce(a.updated_by, a.created_by) into v_a_at, v_a_by
      from public.fidelization_assignments a
      join public.operation_brs b on b.id = a.operation_br_id
     where a.organization_id = p_organization_id
       and a.start_date <= v_end and coalesce(a.end_date, 'infinity'::date) >= v_month
       and b.operation_id = any (v_ops)
     order by a.updated_at desc limit 1;
    select m.recorded_at, m.actor_user_id into v_m_at, v_m_by
      from public.fidelization_movements m
     where m.organization_id = p_organization_id and m.effective_date between v_month and v_end
       and m.operation_id = any (v_ops)
     order by m.recorded_at desc limit 1;

    v_upd_at := greatest(h.updated_at, v_a_at, v_m_at);
    v_upd_by := case
                  when v_upd_at is null then null
                  when v_upd_at = h.updated_at then h.updated_by
                  when v_upd_at = v_a_at then v_a_by
                  else v_m_by
                end;

    v_sit := case
               when h.id is null and v_positions = 0 then 'not_created'
               when v_month < v_current then 'closed'
               when v_month = v_current then 'in_progress'
               else 'planned'
             end;
  end if;

  -- Sem cabeçalho, mas com vínculos: planejados à mão.
  v_origin := coalesce(h.origin, case when v_kind = 'operational' and v_positions > 0 then 'manual' end);

  -- O mês anterior: a data de referência e as placas que a replicação leria.
  select * into hp from public.fidelization_competences c
   where c.organization_id = p_organization_id and c.competence = v_prev;
  v_prev_kind := coalesce(hp.kind, case when v_prev < private.fidelization_operational_start() then 'historical' else 'operational' end);
  if v_prev_kind = 'operational' then
    select count(distinct a.vehicle_id) into v_prev_found
      from public.fidelization_assignments a
      join public.operation_brs b on b.id = a.operation_br_id
     where a.organization_id = p_organization_id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= v_prev_last and coalesce(a.end_date, 'infinity'::date) >= v_prev_last
       and b.deleted_at is null and b.operation_id = any (v_ops);
  end if;

  return jsonb_build_object(
    'competence', to_char(v_month, 'YYYY-MM'),
    'year', p_year, 'month', p_month,
    'label', private.fidelization_competence_label(v_month),
    'kind', v_kind,
    'exists', h.id is not null,
    'situation', v_sit,
    'situation_label', case v_sit
                         when 'historical'  then 'Histórica (consulta)'
                         when 'not_created' then 'Não criada'
                         when 'closed'      then 'Encerrada'
                         when 'in_progress' then 'Em andamento'
                         else 'Planejada'
                       end,
    'origin', v_origin,
    'origin_label', private.fidelization_competence_origin_label(v_origin),
    'source_competence', to_char(h.source_competence, 'YYYY-MM'),
    'source_label', private.fidelization_competence_label(h.source_competence),
    'reference_date', h.reference_date,
    'runs', coalesce(h.runs, 0),
    'last_run', h.last_run,
    'created_at', h.created_at,
    'created_by_name', private.org_member_name(p_organization_id, h.created_by),
    'counts', jsonb_build_object('plates', coalesce(v_plates, 0), 'brs', coalesce(v_brs, 0),
                                 'locais', coalesce(v_locais, 0), 'operations', coalesce(v_operations, 0),
                                 'positions', coalesce(v_positions, 0)),
    'last_updated_at', v_upd_at,
    'last_updated_by_name', private.org_member_name(p_organization_id, v_upd_by),
    'current_competence', to_char(v_current, 'YYYY-MM'),
    'previous', jsonb_build_object(
      'competence', to_char(v_prev, 'YYYY-MM'),
      'label', private.fidelization_competence_label(v_prev),
      'kind', v_prev_kind,
      'exists', hp.id is not null,
      'reference_date', v_prev_last,
      'plates_found', coalesce(v_prev_found, 0)));
end;
$$;

comment on function public.fidelization_competence_summary(uuid, integer, integer) is
  'Resumo da competência: tipo, situação derivada (Histórica, Encerrada, Em andamento, Planejada, Não criada), origem, '
  'placas, BRs, locais e operações no escopo de quem consulta, última atualização e o mês anterior (data de referência '
  'e placas encontradas). Security definer com permissão e escopo explícitos.';

-- O histórico consolidado de uma competência (2024/2025), com filtros e as
-- opções dos filtros. BR nula volta nula: a tela escreve "—".
create or replace function public.fidelization_history_rows(
  p_organization_id uuid, p_year integer, p_month integer, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month    date;
  v_ops      uuid[];
  f          jsonb := coalesce(p_filters, '{}'::jsonb);
  v_f_ops    uuid[];
  v_f_cities integer[];
  v_f_brs    uuid[];
  v_f_codes  text[];
  v_no_br    boolean := coalesce((f ->> 'no_br')::boolean, false);
  v_q        text := private.normalize_plate(f ->> 'q');
  v_q_label  text := upper(btrim(coalesce(f ->> 'q', '')));
  h          public.fidelization_competences;
  v_out      jsonb;
begin
  if p_year is null or p_month is null or p_month not between 1 and 12 or p_year not between 2000 and 2100 then
    raise exception 'Competência inválida.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.has_permission(p_organization_id, 'fidelization.view') then
    raise exception 'Você não possui permissão para consultar a fidelização.' using errcode = 'insufficient_privilege';
  end if;
  v_month := make_date(p_year, p_month, 1);
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ops from private.accessible_operation_ids() s(id);

  if jsonb_typeof(f -> 'operation_ids') = 'array' then
    select array_agg(e.v::uuid) into v_f_ops from jsonb_array_elements_text(f -> 'operation_ids') e(v);
  end if;
  if jsonb_typeof(f -> 'city_ids') = 'array' then
    select array_agg(e.v::integer) into v_f_cities from jsonb_array_elements_text(f -> 'city_ids') e(v);
  end if;
  if jsonb_typeof(f -> 'br_ids') = 'array' then
    select array_agg(e.v::uuid) into v_f_brs from jsonb_array_elements_text(f -> 'br_ids') e(v);
  end if;
  if jsonb_typeof(f -> 'br_codes') = 'array' then
    select array_agg(upper(btrim(e.v))) into v_f_codes from jsonb_array_elements_text(f -> 'br_codes') e(v);
  end if;

  select * into h from public.fidelization_competences c
   where c.organization_id = p_organization_id and c.competence = v_month;

  with base as (
    select p.id, p.vehicle_id, p.license_plate_snapshot, p.fleet_code_snapshot,
           p.operation_id, o.name as operation_name, p.state_id, st.uf::text as state_uf,
           p.city_id, ci.name as city_name, p.operation_br_id, p.br_code_snapshot,
           p.first_day, p.last_day, p.days
      from public.fidelization_history_positions p
      join public.operations o on o.id = p.operation_id
      join public.cities ci on ci.id = p.city_id
      join public.states st on st.id = p.state_id
     where p.organization_id = p_organization_id and p.competence = v_month
       and p.operation_id = any (v_ops)
  ),
  filtered as (
    select * from base b
     where (v_f_ops is null or b.operation_id = any (v_f_ops))
       and (v_f_cities is null or b.city_id = any (v_f_cities))
       and (v_f_brs is null or b.operation_br_id = any (v_f_brs))
       and (v_f_codes is null or upper(b.br_code_snapshot) = any (v_f_codes))
       and (not v_no_br or b.br_code_snapshot is null)
       and (v_q is null
            or private.normalize_plate(b.license_plate_snapshot) like '%' || v_q || '%'
            or upper(coalesce(b.fleet_code_snapshot, '')) like '%' || v_q_label || '%')
  )
  select jsonb_build_object(
    'competence', to_char(v_month, 'YYYY-MM'),
    'label', private.fidelization_competence_label(v_month),
    'kind', coalesce(h.kind, case when v_month < private.fidelization_operational_start() then 'historical' else 'operational' end),
    'loaded', h.id is not null and h.kind = 'historical',
    'has_br', exists (select 1 from base where br_code_snapshot is not null),
    'total', (select count(*) from filtered),
    'totals', (select jsonb_build_object(
                 'plates', count(distinct vehicle_id),
                 'brs', count(distinct (operation_id, city_id, upper(br_code_snapshot))) filter (where br_code_snapshot is not null),
                 'locais', count(distinct (operation_id, city_id)),
                 'operations', count(distinct operation_id),
                 'without_br', count(*) filter (where br_code_snapshot is null))
                 from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'operation_id', r.operation_id, 'operation_name', r.operation_name,
                 'state_id', r.state_id, 'state_uf', r.state_uf, 'city_id', r.city_id, 'city_name', r.city_name,
                 'br_id', r.operation_br_id, 'br_code', r.br_code_snapshot,
                 'vehicle_id', r.vehicle_id, 'license_plate', r.license_plate_snapshot, 'fleet_code', r.fleet_code_snapshot,
                 'first_day', r.first_day, 'last_day', r.last_day, 'days', r.days)
               order by r.operation_name, r.br_code_snapshot nulls first, r.city_name, r.license_plate_snapshot, r.first_day)
               from filtered r), '[]'::jsonb),
    'options', jsonb_build_object(
      'operations', coalesce((select jsonb_agg(jsonb_build_object('id', x.operation_id, 'name', x.operation_name) order by x.operation_name)
                                from (select distinct operation_id, operation_name from base) x), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(jsonb_build_object('id', x.city_id, 'name', x.city_name, 'uf', x.state_uf,
                                                              'operation_id', x.operation_id) order by x.city_name, x.state_uf)
                            from (select distinct operation_id, city_id, city_name, state_uf from base) x), '[]'::jsonb),
      'brs', coalesce((select jsonb_agg(jsonb_build_object('code', x.br_code, 'id', x.br_id, 'operation_id', x.operation_id,
                                                           'city_id', x.city_id) order by x.br_code)
                         from (select distinct upper(br_code_snapshot) as br_code, operation_br_id as br_id, operation_id, city_id
                                 from base where br_code_snapshot is not null) x), '[]'::jsonb))
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.fidelization_history_rows(uuid, integer, integer, jsonb) is
  'Histórico consolidado de uma competência (2024/2025, somente consulta): linhas (operação, UF, cidade, BR — nula quando '
  'não há —, placa, frota, primeiro e último dia, dias), totais e opções de filtro, no escopo de quem consulta. '
  'Filtros: operation_ids, city_ids, br_ids, br_codes, no_br, q (placa/frota).';

-- A evolução de um ano histórico, mês a mês: placas, BRs, locais e mudanças
-- (placas com mais de uma posição no mês, ou com posição diferente da do mês
-- anterior).
create or replace function public.fidelization_history_evolution(p_organization_id uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ops   uuid[];
  v_start date;
  v_out   jsonb;
begin
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Ano inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.has_permission(p_organization_id, 'fidelization.view') then
    raise exception 'Você não possui permissão para consultar a fidelização.' using errcode = 'insufficient_privilege';
  end if;
  v_start := make_date(p_year, 1, 1);
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_ops from private.accessible_operation_ids() s(id);

  with months as (
    select g::date as m from generate_series(v_start, make_date(p_year, 12, 1), interval '1 month') g
  ),
  pos as (
    select p.competence, p.vehicle_id, p.operation_id, p.city_id, upper(p.br_code_snapshot) as br,
           p.first_day, p.last_day,
           p.operation_id::text || '|' || p.city_id::text || '|' || coalesce(upper(p.br_code_snapshot), '') as pkey
      from public.fidelization_history_positions p
     where p.organization_id = p_organization_id
       and p.competence between (v_start - interval '1 month')::date and make_date(p_year, 12, 1)
       and p.operation_id = any (v_ops)
  ),
  per_vehicle as (
    select competence, vehicle_id,
           count(distinct pkey) as positions,
           (array_agg(pkey order by first_day, last_day))[1] as first_key,
           (array_agg(pkey order by last_day desc, first_day desc))[1] as last_key
      from pos group by competence, vehicle_id
  ),
  changes as (
    select cur.competence,
           count(*) filter (where cur.positions > 1
                               or (prev.vehicle_id is not null and prev.last_key <> cur.first_key)) as changes
      from per_vehicle cur
      left join per_vehicle prev
        on prev.vehicle_id = cur.vehicle_id and prev.competence = (cur.competence - interval '1 month')::date
     group by cur.competence
  ),
  agg as (
    select competence,
           count(distinct vehicle_id) as plates,
           count(distinct (operation_id, city_id, br)) filter (where br is not null) as brs,
           count(distinct (operation_id, city_id)) as locais,
           count(*) as positions
      from pos group by competence
  )
  select jsonb_build_object(
    'year', p_year,
    'months', jsonb_agg(jsonb_build_object(
      'competence', to_char(months.m, 'YYYY-MM'),
      'month', extract(month from months.m)::integer,
      'label', private.fidelization_competence_label(months.m),
      'loaded', h.id is not null and h.kind = 'historical',
      'plates', coalesce(agg.plates, 0),
      'brs', coalesce(agg.brs, 0),
      'locais', coalesce(agg.locais, 0),
      'positions', coalesce(agg.positions, 0),
      'changes', coalesce(c.changes, 0)) order by months.m))
    into v_out
    from months
    left join agg on agg.competence = months.m
    left join changes c on c.competence = months.m
    left join public.fidelization_competences h
      on h.organization_id = p_organization_id and h.competence = months.m;

  return v_out;
end;
$$;

comment on function public.fidelization_history_evolution(uuid, integer) is
  'Evolução mensal do histórico consolidado de um ano: placas, BRs, locais, posições e mudanças (placa com mais de uma '
  'posição no mês ou posição diferente da do mês anterior), no escopo de quem consulta.';

-- -----------------------------------------------------------------------------
-- 7. Carga do histórico 2024/2025 (planilha) — só consulta, nunca vínculo
--
-- Linha: {competence: 'AAAA-MM', plate, fleet_code, operation, uf, city (nome
-- ou código IBGE), br_code (opcional; '-' = sem BR), first_day, last_day, days}.
-- Veículo pela placa normalizada (nunca cria veículo), operação pelo nome (sem
-- acento/caixa) ou código, cidade pelo IBGE ou nome + UF, BR pelo código na
-- operação + cidade (não achou: grava só o código e avisa). Idempotente pela
-- chave (competência, veículo, primeiro dia). Nunca toca fidelization_assignments.
-- -----------------------------------------------------------------------------
create or replace function public.import_fidelization_history(
  p_organization_id uuid, p_rows jsonb, p_batch text default null, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          jsonb;
  i          integer := 0;
  v_raw      text;
  v_comp     date;
  v_plate    text;
  v_fleet    text;
  v_vehicle_id    uuid;
  v_vehicle_plate text;
  v_vehicle_fleet text;
  v_op       uuid;
  v_city     integer;
  v_state    smallint;
  v_uf       text;
  v_city_raw text;
  v_br_code  text;
  v_br_id    uuid;
  v_first    date;
  v_last     date;
  v_days     integer;
  v_header   public.fidelization_competences;
  v_id       uuid;
  v_key      text;
  v_seen     jsonb := '{}'::jsonb;
  v_by_comp  jsonb := '{}'::jsonb;
  v_batch    text := nullif(btrim(coalesce(p_batch, '')), '');
  n_rows integer := 0; n_ins integer := 0; n_dup integer := 0; n_err integer := 0; n_warn integer := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  k          text;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import')
     or not private.has_permission(p_organization_id, 'fidelization.manage_historical_data') then
    raise exception 'Carregar o histórico da fidelização exige as permissões de importar e de corrigir dados históricos.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'As linhas do histórico devem vir numa lista.' using errcode = 'invalid_parameter_value';
  end if;
  if v_batch is not null and length(v_batch) > 200 then
    raise exception 'O nome do lote tem no máximo 200 caracteres.' using errcode = 'invalid_parameter_value';
  end if;

  for r in select e.value from jsonb_array_elements(p_rows) e loop
    i := i + 1;
    n_rows := n_rows + 1;
    begin
      -- Competência
      v_raw := btrim(coalesce(r ->> 'competence', ''));
      if v_raw ~ '^\d{4}-\d{1,2}$' then
        v_comp := make_date(split_part(v_raw, '-', 1)::integer, split_part(v_raw, '-', 2)::integer, 1);
      elsif v_raw ~ '^\d{1,2}/\d{4}$' then
        v_comp := make_date(split_part(v_raw, '/', 2)::integer, split_part(v_raw, '/', 1)::integer, 1);
      elsif v_raw ~ '^\d{4}-\d{2}-\d{2}' then
        v_comp := date_trunc('month', left(v_raw, 10)::date)::date;
      else
        raise exception 'Competência inválida: "%". Use AAAA-MM.', v_raw using errcode = 'invalid_parameter_value';
      end if;
      if v_comp >= private.fidelization_operational_start() then
        raise exception 'A competência % é operacional (a partir de 01/2026) e não entra no histórico consolidado.',
          private.fidelization_competence_label(v_comp) using errcode = 'invalid_parameter_value';
      end if;

      -- Veículo (nunca criado)
      v_plate := private.normalize_plate(r ->> 'plate');
      v_fleet := nullif(upper(btrim(coalesce(r ->> 'fleet_code', ''))), '');
      v_vehicle_id := null; v_vehicle_plate := null; v_vehicle_fleet := null;
      if v_plate is not null then
        select v.id, v.license_plate, v.fleet_code into v_vehicle_id, v_vehicle_plate, v_vehicle_fleet
          from public.vehicles v
         where v.organization_id = p_organization_id and private.normalize_plate(v.license_plate) = v_plate
         order by (v.deleted_at is null) desc, v.created_at
         limit 1;
      end if;
      if v_vehicle_id is null and v_fleet is not null then
        select v.id, v.license_plate, v.fleet_code into v_vehicle_id, v_vehicle_plate, v_vehicle_fleet
          from public.vehicles v
         where v.organization_id = p_organization_id and upper(btrim(v.fleet_code)) = v_fleet
         order by (v.deleted_at is null) desc, v.created_at
         limit 1;
      end if;
      if v_vehicle_id is null then
        raise exception 'Veículo % não cadastrado na frota (o histórico não cria veículos).',
          coalesce(r ->> 'plate', r ->> 'fleet_code', '(sem placa)') using errcode = 'no_data_found';
      end if;

      -- Operação
      v_op := null;
      select o.id into v_op from public.operations o
       where o.organization_id = p_organization_id
         and (private.normalize_label(o.name) = private.normalize_label(r ->> 'operation')
              or (o.code is not null and private.normalize_code(o.code) = private.normalize_code(r ->> 'operation')))
       order by (o.deleted_at is null) desc, (private.normalize_label(o.name) = private.normalize_label(r ->> 'operation')) desc
       limit 1;
      if v_op is null then
        raise exception 'Operação "%" não encontrada.', coalesce(r ->> 'operation', '') using errcode = 'no_data_found';
      end if;

      -- Cidade (IBGE ou nome + UF)
      v_city := null; v_state := null;
      v_city_raw := btrim(coalesce(r ->> 'city_ibge', r ->> 'city_id', r ->> 'city', ''));
      v_uf := nullif(upper(btrim(coalesce(r ->> 'uf', ''))), '');
      if v_city_raw ~ '^\d{7}$' then
        select ci.id, ci.state_id into v_city, v_state from public.cities ci where ci.id = v_city_raw::integer;
      elsif v_city_raw <> '' and v_uf is not null then
        select ci.id, ci.state_id into v_city, v_state
          from public.cities ci join public.states st on st.id = ci.state_id
         where st.uf = v_uf and private.normalize_label(ci.name) = private.normalize_label(v_city_raw)
         limit 1;
      elsif v_city_raw <> '' then
        if (select count(*) from public.cities ci where private.normalize_label(ci.name) = private.normalize_label(v_city_raw)) = 1 then
          select ci.id, ci.state_id into v_city, v_state from public.cities ci
           where private.normalize_label(ci.name) = private.normalize_label(v_city_raw);
        else
          raise exception 'Cidade "%" sem UF: informe a UF ou o código IBGE.', v_city_raw using errcode = 'invalid_parameter_value';
        end if;
      end if;
      if v_city is null then
        raise exception 'Cidade "%"% não encontrada.', v_city_raw, coalesce('/' || v_uf, '') using errcode = 'no_data_found';
      end if;
      if v_uf is not null and not exists (select 1 from public.states st where st.id = v_state and st.uf = v_uf) then
        raise exception 'A cidade % não é da UF %.', v_city_raw, v_uf using errcode = 'invalid_parameter_value';
      end if;

      -- BR (opcional; ausência é nulo)
      v_br_code := private.fidelization_br_code_clean(r ->> 'br_code');
      v_br_id := null;
      if v_br_code is not null then
        select b.id into v_br_id from public.operation_brs b
         where b.organization_id = p_organization_id and b.operation_id = v_op and b.city_id = v_city
           and private.normalize_code(b.code) = private.normalize_code(v_br_code)
         order by (b.deleted_at is null) desc
         limit 1;
        if v_br_id is null then
          n_warn := n_warn + 1;
          if jsonb_array_length(v_warnings) < 50 then
            v_warnings := v_warnings || jsonb_build_object('row', i, 'message',
              format('BR %s não encontrada em %s/%s: gravada só como código.', v_br_code, v_city_raw, coalesce(v_uf, '')));
          end if;
        end if;
      end if;

      -- Dias dentro do mês
      v_first := coalesce(private.fidelization_parse_day(r ->> 'first_day', v_comp), v_comp);
      v_last  := coalesce(private.fidelization_parse_day(r ->> 'last_day', v_comp), (v_comp + interval '1 month - 1 day')::date);
      if v_first < v_comp or v_last > (v_comp + interval '1 month - 1 day')::date or v_last < v_first then
        raise exception 'Período %–% fora da competência %.', to_char(v_first, 'DD/MM/YYYY'), to_char(v_last, 'DD/MM/YYYY'),
          private.fidelization_competence_label(v_comp) using errcode = 'invalid_parameter_value';
      end if;
      v_days := coalesce(nullif(btrim(coalesce(r ->> 'days', '')), '')::numeric::integer, v_last - v_first + 1);
      if v_days < 1 or v_days > v_last - v_first + 1 then
        raise exception 'Dias (%) incompatíveis com o período %–%.', v_days, to_char(v_first, 'DD/MM'), to_char(v_last, 'DD/MM')
          using errcode = 'invalid_parameter_value';
      end if;

      -- Cabeçalho histórico da competência
      select * into v_header from public.fidelization_competences c
       where c.organization_id = p_organization_id and c.competence = v_comp;
      if v_header.id is not null and v_header.kind <> 'historical' then
        raise exception 'A competência % já é operacional.', private.fidelization_competence_label(v_comp)
          using errcode = 'invalid_parameter_value';
      end if;
      if v_header.id is null and not p_dry_run then
        insert into public.fidelization_competences (organization_id, competence, kind, origin, notes)
        values (p_organization_id, v_comp, 'historical', 'historical_import', 'Histórico consolidado — somente consulta.')
        on conflict (organization_id, competence) do nothing;
        select * into v_header from public.fidelization_competences c
         where c.organization_id = p_organization_id and c.competence = v_comp;
      end if;

      -- Sobreposição da mesma placa no mês: aviso (o histórico é como veio).
      if v_header.id is not null and exists (
           select 1 from public.fidelization_history_positions p
            where p.competence_id = v_header.id and p.vehicle_id = v_vehicle_id and p.first_day <> v_first
              and p.first_day <= v_last and p.last_day >= v_first) then
        n_warn := n_warn + 1;
        if jsonb_array_length(v_warnings) < 50 then
          v_warnings := v_warnings || jsonb_build_object('row', i, 'message',
            format('A placa %s já tem outra posição sobreposta em %s.', coalesce(v_vehicle_plate, v_vehicle_fleet),
                   private.fidelization_competence_label(v_comp)));
        end if;
      end if;

      v_key := v_comp::text || '|' || v_vehicle_id::text || '|' || v_first::text;
      v_id := null;
      if p_dry_run then
        if v_seen ? v_key or (v_header.id is not null and exists (
             select 1 from public.fidelization_history_positions p
              where p.competence_id = v_header.id and p.vehicle_id = v_vehicle_id and p.first_day = v_first)) then
          n_dup := n_dup + 1;
        else
          n_ins := n_ins + 1;
        end if;
        v_seen := v_seen || jsonb_build_object(v_key, true);
      else
        insert into public.fidelization_history_positions
          (organization_id, competence_id, competence, vehicle_id, license_plate_snapshot, fleet_code_snapshot,
           operation_id, state_id, city_id, operation_br_id, br_code_snapshot, first_day, last_day, days,
           origin, import_batch, created_by)
        values
          (p_organization_id, v_header.id, v_comp, v_vehicle_id, v_vehicle_plate, v_vehicle_fleet,
           v_op, v_state, v_city, v_br_id, v_br_code, v_first, v_last, v_days,
           'historical_import', v_batch, auth.uid())
        on conflict (competence_id, vehicle_id, first_day) do nothing
        returning id into v_id;
        if v_id is null then
          n_dup := n_dup + 1;
        else
          n_ins := n_ins + 1;
          k := to_char(v_comp, 'YYYY-MM');
          v_by_comp := jsonb_set(v_by_comp, array[k], to_jsonb(coalesce((v_by_comp ->> k)::integer, 0) + 1));
        end if;
      end if;
    exception when others then
      n_err := n_err + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('row', i, 'message', sqlerrm);
      end if;
    end;
  end loop;

  -- A carga fica registrada em cada competência que recebeu linhas (auditada).
  if not p_dry_run then
    for k in select jsonb_object_keys(v_by_comp) loop
      update public.fidelization_competences c
         set runs = c.runs + 1,
             last_run = jsonb_build_object('mode', 'historical_import', 'at', now(), 'by', auth.uid(),
                                           'batch', v_batch, 'inserted', (v_by_comp ->> k)::integer)
       where c.organization_id = p_organization_id and c.competence = to_date(k || '-01', 'YYYY-MM-DD');
    end loop;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'batch', v_batch,
    'rows', n_rows, 'inserted', n_ins, 'duplicates', n_dup, 'errors', n_err, 'warnings', n_warn,
    'by_competence', v_by_comp,
    'error_examples', v_errors, 'warning_examples', v_warnings);
end;
$$;

comment on function public.import_fidelization_history(uuid, jsonb, text, boolean) is
  'Carga do histórico consolidado 2024/2025 (somente consulta): exige fidelization.import e '
  'fidelization.manage_historical_data; recusa competências de 2026 em diante; não cria veículos; BR ausente ou "-" = NULL; '
  'idempotente (competência, veículo, primeiro dia). Nunca toca fidelization_assignments.';

-- -----------------------------------------------------------------------------
-- 8. Execução
-- -----------------------------------------------------------------------------
revoke execute on function private.fidelization_operational_start() from public, anon;
revoke execute on function private.fidelization_competence_label(date) from public, anon;
revoke execute on function private.fidelization_origin_label(text, uuid) from public, anon;
revoke execute on function private.fidelization_competence_origin_label(text) from public, anon;
revoke execute on function private.fidelization_br_code_clean(text) from public, anon;
revoke execute on function private.fidelization_parse_day(text, date) from public, anon, authenticated;
revoke execute on function private.fidelization_competence_lock_key(uuid, date) from public, anon, authenticated;
grant execute on function private.fidelization_operational_start() to authenticated, service_role;
grant execute on function private.fidelization_competence_label(date) to authenticated, service_role;
grant execute on function private.fidelization_origin_label(text, uuid) to authenticated, service_role;
grant execute on function private.fidelization_competence_origin_label(text) to authenticated, service_role;
-- A constraint da tabela de histórico chama esta função com o papel de quem grava.
grant execute on function private.fidelization_br_code_clean(text) to authenticated, service_role;

revoke all on function public.replicate_fidelization_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) from public, anon;
revoke all on function public.fidelization_competence_summary(uuid, integer, integer) from public, anon;
revoke all on function public.fidelization_history_rows(uuid, integer, integer, jsonb) from public, anon;
revoke all on function public.fidelization_history_evolution(uuid, integer) from public, anon;
revoke all on function public.import_fidelization_history(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.replicate_fidelization_competence(uuid, integer, integer, integer, integer, uuid, boolean, boolean) to authenticated;
grant execute on function public.fidelization_competence_summary(uuid, integer, integer) to authenticated;
grant execute on function public.fidelization_history_rows(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.fidelization_history_evolution(uuid, integer) to authenticated;
grant execute on function public.import_fidelization_history(uuid, jsonb, text, boolean) to authenticated;
