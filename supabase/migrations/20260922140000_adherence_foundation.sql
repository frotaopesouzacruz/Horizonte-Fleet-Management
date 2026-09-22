-- =============================================================================
-- Etapa 11 — GESTÃO DE CHECKLIST: ADERÊNCIA — fundação
--
-- A regra central do módulo:
--
--   FROTA PREVISTA → OBRIGAÇÃO → EXECUÇÃO RECEBIDA → CONCILIAÇÃO → STATUS
--                  → JUSTIFICATIVAS / EXPURGOS → INDICADORES
--
-- A obrigação existe ANTES de qualquer checklist chegar (§6). Ela nasce do
-- planejamento vigente na data — fidelização (Etapa 08/13) e, na falta dela,
-- alocação operacional (Etapa 06) — e congela o contexto daquele dia (§9):
-- operação, cidade, BR, filial, tipo e liderança. Uma transferência posterior
-- não reclassifica agosto.
--
-- Quatro conceitos, quatro lugares (§12): a obrigação esperada
-- (`checklist_obligations`), a evidência de execução (a execução oficial da
-- Etapa 12, ligada por `checklist_obligation_matches`), a decisão de
-- justificativa ou expurgo (`adherence_requests`) e a classificação — que NÃO é
-- coluna: é derivada por uma regra única, na view `adherence_obligation_status`
-- da migration seguinte. Ninguém "edita o status"; edita-se a evidência ou a
-- decisão, e o status segue.
--
-- Nada aqui cria veículo, operação, cidade, BR ou colaborador.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de status (§20) — global, código técnico estável, rótulo em pt-BR
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_status_catalog (
  code        text primary key,
  label       text not null,
  description text,
  -- tom semântico da interface (§66): success | danger | warning | info | neutral | pending
  tone        text not null check (tone in ('success','danger','warning','info','neutral','pending')),
  -- verdadeiro só para o status que entra no numerador
  counts_as_done boolean not null default false,
  sort_order  smallint not null default 100,
  is_active   boolean not null default true,
  constraint checklist_status_code_check check (code ~ '^[A-Z][A-Z0-9_]{2,39}$')
);

insert into public.checklist_status_catalog (code, label, description, tone, counts_as_done, sort_order) values
  ('FEZ_CHECKLIST',     'Fez checklist',      'Execução válida conciliada à obrigação.',                          'success', true,  10),
  ('NAO_FEZ_CHECKLIST', 'Não fez checklist',  'Obrigação vencida ou do dia vigente sem execução válida.',         'danger',  false, 20),
  ('RETORNO_PENDENTE',  'Retorno pendente',   'Obrigação de retorno ainda dentro do prazo, sem execução.',        'pending', false, 30),
  ('PLANEJADO',         'Planejado',          'Obrigação de data futura. Não conta como descumprimento.',         'neutral', false, 40),
  ('SEM_ROTA',          'Sem rota',           'Expurgo aprovado: o veículo não tinha rota na data.',              'info',    false, 50),
  ('MANUTENCAO',        'Manutenção',         'Expurgo aprovado: o veículo estava em manutenção.',                'warning', false, 60),
  ('FROTA_RESERVA',     'Frota reserva',      'Expurgo aprovado: veículo reserva não escalado.',                  'neutral', false, 70),
  ('EM_VIAGEM',         'Em viagem',          'Expurgo aprovado: veículo em viagem sem saída/retorno local.',     'info',    false, 80),
  ('FROTA_NAO_ATIVA',   'Frota não ativa',    'Expurgo aprovado: veículo fora de operação na data.',              'neutral', false, 90),
  ('SEM_DADOS',         'Sem dados',          'Não há obrigação conhecida para o veículo na data.',               'neutral', false, 100)
on conflict (code) do update set label = excluded.label, description = excluded.description,
  tone = excluded.tone, counts_as_done = excluded.counts_as_done, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 2. Parâmetros da organização (§19, §36)
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_settings (
  organization_id          uuid primary key references public.organizations(id) on delete cascade,
  timezone                 text not null default 'America/Sao_Paulo',
  -- janela padrão; regras de elegibilidade podem sobrescrever por operação
  departure_expected_time  time not null default '06:00',
  return_expected_time     time not null default '18:00',
  return_deadline_time     time not null default '02:00',
  return_deadline_next_day boolean not null default true,
  -- quantos dias à frente a rotina materializa obrigações (aparecem como Planejado)
  generation_horizon_days  smallint not null default 7 check (generation_horizon_days between 0 and 62),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- -----------------------------------------------------------------------------
-- 3. Motivos de expurgo (§28) — configuráveis por organização
--
-- `effect` é o que a aprovação faz com a obrigação:
--   exclude    → sai do denominador (expurgo)
--   count_done → entra no numerador (execução comprovada por fonte alternativa, §23)
--   none       → só registra a justificativa; a obrigação continua devida
-- Nem todo motivo exclui (§28): OUTROS nasce com effect = none.
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_exclusion_reasons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null,
  name             text not null,
  description      text,
  effect           text not null default 'exclude' check (effect in ('exclude','count_done','none')),
  -- status do catálogo aplicado à obrigação quando aprovado (null = mantém o derivado)
  status_code      text references public.checklist_status_catalog(code),
  requires_evidence   boolean not null default false,
  requires_approval   boolean not null default true,
  applies_to_departure boolean not null default true,
  applies_to_return    boolean not null default true,
  -- §33: herança saída → retorno só quando o motivo permite
  inherits_to_return   boolean not null default false,
  -- §29: exclusão automática validada. Nasce desligada em todos.
  auto_apply        boolean not null default false,
  valid_from        date,
  valid_to          date,
  sort_order        smallint not null default 100,
  is_active         boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  constraint adherence_reason_code_check check (code ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  constraint adherence_reason_period_check check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint adherence_reason_unique unique (organization_id, code)
);

-- -----------------------------------------------------------------------------
-- 4. Regras de elegibilidade (§7, §8, §26) — parametrização com vigência
--
-- A regra diz SE um veículo tem obrigação em cada contexto, por operação, tipo,
-- subcategoria e situação — por id, nunca por nome. A mais específica vence;
-- em empate, a menor prioridade. Sem regra vigente, não há obrigação.
-- `version` sobe a cada alteração e a obrigação guarda a versão que a gerou:
-- é o que impede uma mudança de setembro de reescrever agosto.
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_eligibility_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  description      text,
  priority         smallint not null default 100,
  operation_id     uuid references public.operations(id),
  vehicle_type_id  uuid references public.vehicle_types(id),
  vehicle_subcategory_id uuid references public.vehicle_subcategories(id),
  -- situação do veículo NA DATA (active | maintenance | inactive ...); null = qualquer
  vehicle_status   text check (vehicle_status is null or vehicle_status in ('active','inactive','maintenance','sold','decommissioned')),
  requires_checklist   boolean not null default true,
  applies_to_departure boolean not null default true,
  applies_to_return    boolean not null default true,
  -- dias da semana em que a obrigação existe (isodow: 1 = segunda … 7 = domingo)
  weekdays         smallint[] not null default '{1,2,3,4,5,6,7}',
  -- janelas específicas; null = usa adherence_settings
  departure_expected_time  time,
  return_expected_time     time,
  return_deadline_time     time,
  return_deadline_next_day boolean,
  valid_from       date not null default current_date,
  valid_to         date,
  version          integer not null default 1,
  is_active        boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  constraint adherence_rule_period_check check (valid_to is null or valid_to >= valid_from),
  constraint adherence_rule_weekdays_check check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(weekdays) > 0),
  constraint adherence_rule_name_check check (length(btrim(name)) between 3 and 120)
);
create index if not exists adherence_rules_org_idx on public.adherence_eligibility_rules (organization_id, is_active, valid_from);

create or replace function private.tg_adherence_rule_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
       new.requires_checklist is distinct from old.requires_checklist
    or new.applies_to_departure is distinct from old.applies_to_departure
    or new.applies_to_return is distinct from old.applies_to_return
    or new.weekdays is distinct from old.weekdays
    or new.operation_id is distinct from old.operation_id
    or new.vehicle_type_id is distinct from old.vehicle_type_id
    or new.vehicle_subcategory_id is distinct from old.vehicle_subcategory_id
    or new.vehicle_status is distinct from old.vehicle_status
    or new.valid_from is distinct from old.valid_from
    or new.valid_to is distinct from old.valid_to
    or new.return_deadline_time is distinct from old.return_deadline_time
    or new.return_deadline_next_day is distinct from old.return_deadline_next_day
  ) then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists adherence_rules_version on public.adherence_eligibility_rules;
create trigger adherence_rules_version
  before update on public.adherence_eligibility_rules
  for each row execute function private.tg_adherence_rule_version();

-- -----------------------------------------------------------------------------
-- 5. Metas (§36) — organização › operação › contexto, com vigência
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_targets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  operation_id     uuid references public.operations(id),
  checklist_context text check (checklist_context is null or checklist_context in ('saida','retorno')),
  target_pct       numeric(5,2) not null check (target_pct > 0 and target_pct <= 100),
  valid_from       date not null default current_date,
  valid_to         date,
  notes            text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  constraint adherence_target_period_check check (valid_to is null or valid_to >= valid_from)
);
create index if not exists adherence_targets_org_idx on public.adherence_targets (organization_id, valid_from);

-- -----------------------------------------------------------------------------
-- 6. Rodadas de processamento (§38–§40) — quem gerou/reprocessou o quê, e o diff
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null check (kind in ('daily','reconcile','outbox','import','on_demand')),
  date_from        date,
  date_to          date,
  operation_id     uuid references public.operations(id),
  checklist_context text check (checklist_context is null or checklist_context in ('saida','retorno')),
  reason           text,
  is_preview       boolean not null default false,
  status           text not null default 'running' check (status in ('running','completed','failed')),
  stats            jsonb not null default '{}'::jsonb,
  error_message    text,
  requested_by     uuid references auth.users(id),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists adherence_runs_org_idx on public.adherence_runs (organization_id, started_at desc);

-- -----------------------------------------------------------------------------
-- 7. Obrigações (§11) — a base de referência, independente das execuções
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_obligations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vehicle_id       uuid not null references public.vehicles(id),
  operational_date date not null,
  checklist_context text not null check (checklist_context in ('saida','retorno')),
  -- preparado para mais de uma jornada no mesmo dia (§11, §14); hoje sempre 1
  journey_seq      smallint not null default 1 check (journey_seq between 1 and 9),
  -- contexto congelado na data (§9)
  operation_id     uuid not null references public.operations(id),
  operation_city_id uuid references public.operation_cities(id),
  state_id         smallint references public.states(id),
  city_id          integer references public.cities(id),
  operation_br_id  uuid references public.operation_brs(id),
  organization_unit_id uuid references public.organization_units(id),
  vehicle_type_id  uuid references public.vehicle_types(id),
  vehicle_subcategory_id uuid references public.vehicle_subcategories(id),
  leader_employee_id uuid references public.employees(id),
  leadership_assignment_id uuid references public.leadership_assignments(id),
  fleet_code_snapshot text,
  license_plate_snapshot text,
  vehicle_status_snapshot text,
  expected_at      timestamptz not null,
  deadline_at      timestamptz not null,
  -- de onde veio a frota prevista: fidelization | allocation | import
  source           text not null check (source in ('fidelization','allocation','import')),
  fidelization_assignment_id uuid references public.fidelization_assignments(id),
  eligibility_rule_id uuid references public.adherence_eligibility_rules(id),
  eligibility_rule_version integer,
  -- situação operacional detectada automaticamente (§29): sugestão, não decisão
  detected_condition text references public.checklist_status_catalog(code),
  is_active        boolean not null default true,
  retired_at       timestamptz,
  retired_reason   text,
  generation_run_id uuid references public.adherence_runs(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint checklist_obligation_deadline_check check (deadline_at >= expected_at),
  constraint checklist_obligation_unique unique (organization_id, vehicle_id, operational_date, checklist_context, journey_seq)
);
create index if not exists checklist_obligations_date_idx
  on public.checklist_obligations (organization_id, operational_date, checklist_context) where is_active;
create index if not exists checklist_obligations_vehicle_idx
  on public.checklist_obligations (organization_id, vehicle_id, operational_date) where is_active;
create index if not exists checklist_obligations_operation_idx
  on public.checklist_obligations (organization_id, operation_id, operational_date) where is_active;
create index if not exists checklist_obligations_leader_idx
  on public.checklist_obligations (organization_id, leader_employee_id, operational_date) where is_active;

-- -----------------------------------------------------------------------------
-- 8. Conciliação (§22) — a execução oficial ligada à obrigação
--
-- Uma execução casa com no máximo UMA obrigação, e uma obrigação tem no máximo
-- UMA execução válida. A segunda execução do mesmo contexto no mesmo dia fica
-- registrada como duplicidade — real, mas não conta duas vezes (§67).
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_obligation_matches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  obligation_id    uuid not null references public.checklist_obligations(id),
  execution_id     uuid not null references public.checklist_executions(id),
  match_source     text not null check (match_source in ('outbox','trigger','reconcile','import','manual')),
  is_valid         boolean not null default true,
  invalid_reason   text,
  matched_at       timestamptz not null default now(),
  matched_by       uuid references auth.users(id),
  constraint checklist_match_execution_unique unique (execution_id)
);
create unique index if not exists checklist_match_valid_unique
  on public.checklist_obligation_matches (obligation_id) where is_valid;

-- -----------------------------------------------------------------------------
-- 9. Solicitações e expurgos (§27–§33)
--
-- Toda justificativa é uma solicitação com decisão. Pendente ou rejeitada,
-- não tira nada do denominador (§31). Aprovada, aplica o `effect` do motivo —
-- copiado para a linha no momento da decisão, para que editar o motivo depois
-- não reclassifique o passado (§40).
--
-- Segregação (§32): quem decide não é quem pediu. A exceção autorizada é a
-- correção administrativa (`is_override`), que exige permissão própria,
-- justificativa e sai marcada na auditoria.
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  obligation_id    uuid not null references public.checklist_obligations(id),
  reason_id        uuid not null references public.adherence_exclusion_reasons(id),
  checklist_context text not null check (checklist_context in ('saida','retorno')),
  status           text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  justification    text not null check (length(btrim(justification)) between 5 and 2000),
  evidence_reference text,
  source           text not null default 'leadership' check (source in ('leadership','admin','import','auto','inherited','bulk')),
  is_override      boolean not null default false,
  requested_by     uuid references auth.users(id),
  requested_employee_id uuid references public.employees(id),
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text,
  -- efeito e status aplicados NA decisão (snapshot do motivo)
  decision_effect  text check (decision_effect is null or decision_effect in ('exclude','count_done','none')),
  status_code_applied text references public.checklist_status_catalog(code),
  reclassified_from_reason_id uuid references public.adherence_exclusion_reasons(id),
  inherited_from_request_id uuid references public.adherence_requests(id),
  import_batch_id  uuid references public.import_batches(id),
  reason_version_note text,
  updated_at       timestamptz not null default now(),
  constraint adherence_request_segregation_check check (
    decided_by is null or is_override or requested_by is null or decided_by <> requested_by),
  constraint adherence_request_decided_check check (
    (status in ('pending','cancelled')) or (decided_by is not null and decided_at is not null))
);
create index if not exists adherence_requests_obligation_idx on public.adherence_requests (obligation_id, status);
create index if not exists adherence_requests_org_status_idx on public.adherence_requests (organization_id, status, requested_at desc);
-- uma solicitação pendente por obrigação
create unique index if not exists adherence_requests_pending_unique
  on public.adherence_requests (obligation_id) where status = 'pending';

-- -----------------------------------------------------------------------------
-- 10. Inconsistências para conciliação (§21, §25) — nunca decisão automática
-- -----------------------------------------------------------------------------
create table if not exists public.adherence_inconsistencies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null check (kind in (
                     'execution_without_obligation','duplicate_execution','planning_conflict',
                     'execution_after_exclusion','import_unknown_status','import_unknown_vehicle','other')),
  vehicle_id       uuid references public.vehicles(id),
  execution_id     uuid references public.checklist_executions(id),
  obligation_id    uuid references public.checklist_obligations(id),
  operational_date date,
  checklist_context text check (checklist_context is null or checklist_context in ('saida','retorno')),
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by      uuid references auth.users(id),
  resolved_at      timestamptz,
  resolution_note  text,
  created_at       timestamptz not null default now()
);
create index if not exists adherence_inconsistencies_org_idx on public.adherence_inconsistencies (organization_id, status, created_at desc);
create unique index if not exists adherence_inconsistencies_execution_unique
  on public.adherence_inconsistencies (execution_id, kind) where execution_id is not null and status = 'open';

-- -----------------------------------------------------------------------------
-- 11. Auditoria (§41)
-- Obrigações são geradas aos milhares: auditamos o que muda depois de criadas
-- (aposentar, refrescar contexto), não cada inserção da rotina.
-- -----------------------------------------------------------------------------
create trigger checklist_obligations_audit
  after update or delete on public.checklist_obligations
  for each row execute function private.tg_audit();
create trigger checklist_obligation_matches_audit
  after insert or update or delete on public.checklist_obligation_matches
  for each row execute function private.tg_audit();
create trigger adherence_requests_audit
  after insert or update or delete on public.adherence_requests
  for each row execute function private.tg_audit();
create trigger adherence_reasons_audit
  after insert or update or delete on public.adherence_exclusion_reasons
  for each row execute function private.tg_audit();
create trigger adherence_rules_audit
  after insert or update or delete on public.adherence_eligibility_rules
  for each row execute function private.tg_audit();
create trigger adherence_targets_audit
  after insert or update or delete on public.adherence_targets
  for each row execute function private.tg_audit();
create trigger adherence_settings_audit
  after insert or update or delete on public.adherence_settings
  for each row execute function private.tg_audit();
create trigger adherence_runs_audit
  after insert or update on public.adherence_runs
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 12. Padrões por organização — parâmetros, motivos e a regra inicial
--
-- Chamada para as organizações existentes agora e disponível para as próximas.
-- As regras iniciais são explícitas e reversíveis: toda frota prevista, em
-- qualquer operação, deve checklist de saída e de retorno todos os dias. Duas
-- exceções, também explícitas e por parâmetro (nunca por nome): veículos com
-- situação cadastral "inativo" e o tipo "Frota Leve ADM" (por id) ficam sem
-- obrigação. Manutenção NÃO isenta: gera a obrigação com a condição detectada,
-- e o expurgo é decisão autorizada (§29).
-- -----------------------------------------------------------------------------
create or replace function private.adherence_seed_defaults(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_car uuid;
begin
  insert into public.adherence_settings (organization_id) values (p_organization_id)
  on conflict (organization_id) do nothing;

  insert into public.adherence_exclusion_reasons
    (organization_id, code, name, description, effect, status_code, requires_evidence, requires_approval, inherits_to_return, sort_order)
  values
    (p_organization_id, 'SEM_ROTA',        'Sem rota',            'O veículo não tinha rota programada na data.',                    'exclude',    'SEM_ROTA',        false, true, true,  10),
    (p_organization_id, 'MANUTENCAO',      'Manutenção',          'O veículo estava em manutenção (informar OS ou chamado).',         'exclude',    'MANUTENCAO',      true,  true, true,  20),
    (p_organization_id, 'RESERVA',         'Frota reserva',       'Veículo reserva não escalado na data.',                            'exclude',    'FROTA_RESERVA',   false, true, true,  30),
    (p_organization_id, 'EM_VIAGEM',       'Em viagem',           'Veículo em viagem, sem saída ou retorno local na data.',           'exclude',    'EM_VIAGEM',       false, true, true,  40),
    (p_organization_id, 'FROTA_NAO_ATIVA', 'Frota não ativa',     'Veículo fora de operação na data.',                                'exclude',    'FROTA_NAO_ATIVA', false, true, true,  50),
    (p_organization_id, 'EXECUCAO_COMPROVADA', 'Execução comprovada por outra fonte', 'Checklist realizado e comprovado por fonte alternativa validada (§23). Exige evidência e aprovação.', 'count_done', 'FEZ_CHECKLIST', true, true, false, 60),
    (p_organization_id, 'OUTROS',          'Outros',              'Justificativa registrada sem expurgo. O revisor pode reclassificar para um motivo elegível.', 'none', null, true, true, false, 90)
  on conflict (organization_id, code) do nothing;

  if not exists (select 1 from public.adherence_eligibility_rules r where r.organization_id = p_organization_id) then
    insert into public.adherence_eligibility_rules
      (organization_id, name, description, priority, vehicle_status, requires_checklist, valid_from)
    values
      (p_organization_id, 'Frota prevista: saída e retorno diários',
       'Regra padrão. Todo veículo previsto no planejamento deve checklist de saída e de retorno todos os dias. Manutenção não isenta: gera obrigação com condição detectada, para expurgo autorizado.',
       100, null, true, date '2026-01-01'),
      (p_organization_id, 'Veículos inativos: sem obrigação de checklist',
       'Exceção explícita por situação cadastral. Desative para cobrar checklist de veículos inativos que ainda constem no planejamento.',
       5, 'inactive', false, date '2026-01-01');

    select t.id into v_car from public.vehicle_types t
     where t.code = 'car' and (t.organization_id = p_organization_id or t.organization_id is null) and t.deleted_at is null
     order by t.organization_id nulls last limit 1;
    if v_car is not null then
      insert into public.adherence_eligibility_rules
        (organization_id, name, description, priority, vehicle_type_id, requires_checklist, valid_from)
      values
        (p_organization_id, 'Frota Leve ADM: sem obrigação de checklist',
         'Exceção explícita por tipo de equipamento. Desative para incluir a frota administrativa na aderência.',
         10, v_car, false, date '2026-01-01');
    end if;
  end if;
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations where deleted_at is null loop
    perform private.adherence_seed_defaults(o.id);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 13. Permissões (§59) e matriz padrão (§63)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('adherence.view',           'adherence', 'Ver aderência',                    'Consultar indicadores, matriz e pendências do escopo autorizado'),
  ('adherence.view_audit',     'adherence', 'Ver histórico da aderência',       'Consultar auditoria, rodadas de processamento e inconsistências'),
  ('adherence.request',        'adherence', 'Solicitar justificativa',          'Abrir solicitação de expurgo ou justificativa para uma obrigação do escopo'),
  ('adherence.approve',        'adherence', 'Aprovar justificativas',           'Aprovar, rejeitar ou reclassificar solicitações de expurgo'),
  ('adherence.override',       'adherence', 'Correção administrativa',          'Corrigir a classificação de uma obrigação com justificativa obrigatória (exceção auditada)'),
  ('adherence.bulk_update',    'adherence', 'Alteração em massa',               'Aplicar correção administrativa a vários registros com prévia'),
  ('adherence.import',         'adherence', 'Importar aderência',               'Importar bases de status diário e evidências externas'),
  ('adherence.export',         'adherence', 'Exportar aderência',               'Exportar indicadores e matriz'),
  ('adherence.reconcile',      'adherence', 'Reconciliar períodos',             'Reprocessar obrigações e conciliações de um período com motivo'),
  ('adherence.manage_rules',   'adherence', 'Administrar elegibilidade',        'Editar regras de elegibilidade e motivos de expurgo'),
  ('adherence.manage_targets', 'adherence', 'Administrar metas',                'Definir metas de aderência por organização, operação e contexto')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('administrador', 'adherence.view'), ('administrador', 'adherence.view_audit'),
    ('administrador', 'adherence.request'), ('administrador', 'adherence.approve'),
    ('administrador', 'adherence.override'), ('administrador', 'adherence.bulk_update'),
    ('administrador', 'adherence.import'), ('administrador', 'adherence.export'),
    ('administrador', 'adherence.reconcile'), ('administrador', 'adherence.manage_rules'),
    ('administrador', 'adherence.manage_targets'),

    -- Gestor de Frota administra e analisa (§63)
    ('gestor_frota', 'adherence.view'), ('gestor_frota', 'adherence.view_audit'),
    ('gestor_frota', 'adherence.request'), ('gestor_frota', 'adherence.approve'),
    ('gestor_frota', 'adherence.override'), ('gestor_frota', 'adherence.bulk_update'),
    ('gestor_frota', 'adherence.import'), ('gestor_frota', 'adherence.export'),
    ('gestor_frota', 'adherence.reconcile'), ('gestor_frota', 'adherence.manage_rules'),
    ('gestor_frota', 'adherence.manage_targets'),

    -- Liderança consulta o escopo e solicita; não aprova (§30, §32)
    ('lideranca_operacoes', 'adherence.view'),
    ('lideranca_operacoes', 'adherence.request'),
    ('lideranca_operacoes', 'adherence.export'),

    ('gestao',    'adherence.view'), ('gestao',    'adherence.view_audit'), ('gestao', 'adherence.export'),
    ('seguranca', 'adherence.view'), ('seguranca', 'adherence.view_audit')
  ) as d(profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 14. RLS (§60–§62) — leitura por permissão E escopo de operação; escrita só por rotina
-- -----------------------------------------------------------------------------
alter table public.checklist_status_catalog      enable row level security;
alter table public.adherence_settings            enable row level security;
alter table public.adherence_exclusion_reasons   enable row level security;
alter table public.adherence_eligibility_rules   enable row level security;
alter table public.adherence_targets             enable row level security;
alter table public.adherence_runs                enable row level security;
alter table public.checklist_obligations         enable row level security;
alter table public.checklist_obligation_matches  enable row level security;
alter table public.adherence_requests            enable row level security;
alter table public.adherence_inconsistencies     enable row level security;

create policy checklist_status_catalog_select on public.checklist_status_catalog
  for select to authenticated using (true);

create policy adherence_settings_select on public.adherence_settings
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view')));

create policy adherence_reasons_select on public.adherence_exclusion_reasons
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view')));

create policy adherence_rules_select on public.adherence_eligibility_rules
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view')));

create policy adherence_targets_select on public.adherence_targets
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view')));

create policy adherence_runs_select on public.adherence_runs
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view_audit'))
      or organization_id in (select private.permitted_org_ids('adherence.reconcile')));

-- A obrigação é vista por quem vê aderência E alcança a operação congelada
-- nela (§60): a liderança de Contagem não lê Belém.
create policy checklist_obligations_select on public.checklist_obligations
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view'))
     and private.can_access_operation(operation_id));

create policy checklist_matches_select on public.checklist_obligation_matches
  for select to authenticated
  using (exists (select 1 from public.checklist_obligations o where o.id = obligation_id));

create policy adherence_requests_select on public.adherence_requests
  for select to authenticated
  using (exists (select 1 from public.checklist_obligations o where o.id = obligation_id));

create policy adherence_inconsistencies_select on public.adherence_inconsistencies
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('adherence.view_audit'))
     and (obligation_id is null
          or exists (select 1 from public.checklist_obligations o where o.id = obligation_id)));

grant select on public.checklist_status_catalog, public.adherence_settings,
                public.adherence_exclusion_reasons, public.adherence_eligibility_rules,
                public.adherence_targets, public.adherence_runs, public.checklist_obligations,
                public.checklist_obligation_matches, public.adherence_requests,
                public.adherence_inconsistencies
  to authenticated;
