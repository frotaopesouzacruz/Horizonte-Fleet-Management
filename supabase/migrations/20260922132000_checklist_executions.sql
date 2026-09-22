-- =============================================================================
-- Etapa 12 — execução do Check List de Frota (§49, §50, §52)
--
-- Três tabelas: o cabeçalho da execução, as respostas e o resumo por cluster.
--
-- O CONTEXTO OPERACIONAL É CONGELADO NO ENVIO. A execução guarda placa, código
-- de frota, tipo de equipamento, BR, cidade e liderança como estavam no dia —
-- não como estão hoje. A §34 é explícita: substituir o veículo de um BR não
-- pode reescrever o que foi inspecionado em março.
--
-- NENHUMA COLUNA DE ANEXO (§26). Não há `photo_url`, `attachment_id`,
-- `evidence_path` nem nada equivalente, e a suíte de testes verifica isso por
-- consulta ao catálogo — não por leitura humana do arquivo.
-- =============================================================================
create table if not exists public.checklist_executions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  app_id                 uuid not null,
  version_id             uuid not null references public.checklist_app_versions (id) on delete restrict,

  -- Quem. Resolvido da sessão no servidor (§31), nunca do payload.
  user_id                uuid not null references auth.users (id) on delete restrict,
  employee_id            uuid not null,

  vehicle_id             uuid not null,
  license_plate_snapshot text,
  fleet_code_snapshot    text,
  vehicle_type_id        uuid,
  vehicle_subcategory_id uuid,

  operation_id           uuid not null,
  state_id               smallint,
  city_id                integer,
  operation_br_id        uuid,
  organization_unit_id   uuid,
  leader_employee_id     uuid,

  checklist_type         text not null,
  operational_date       date not null,

  started_at             timestamptz not null default now(),
  submitted_at           timestamptz,
  duration_seconds       integer,
  status                 text not null default 'draft',

  applicable_questions   smallint not null default 0,
  answered_questions     smallint not null default 0,
  conforming_answers     smallint not null default 0,
  non_conforming_answers smallint not null default 0,
  critical_non_conforming smallint not null default 0,

  -- §52: a chave vem do cliente ANTES do envio. Duplo toque, retry e queda de
  -- rede reenviam a mesma chave, e o índice único transforma o segundo envio
  -- na devolução do primeiro resultado em vez de um segundo checklist.
  idempotency_key        text not null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint checklist_exec_app_fkey
    foreign key (app_id, organization_id)
    references public.operational_apps (id, organization_id) on delete restrict,
  constraint checklist_exec_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint checklist_exec_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint checklist_exec_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,
  constraint checklist_exec_br_fkey
    foreign key (operation_br_id) references public.operation_brs (id) on delete restrict,
  constraint checklist_exec_type_check
    check (checklist_type in ('saida', 'retorno')),
  constraint checklist_exec_status_check
    check (status in ('draft', 'submitted', 'cancelled')),
  -- Enviado é datado e contado. Um envio sem data seria um checklist que
  -- ninguém consegue situar numa jornada.
  constraint checklist_exec_submitted_check
    check (status <> 'submitted' or (submitted_at is not null and duration_seconds is not null)),
  constraint checklist_exec_duration_check
    check (duration_seconds is null or duration_seconds >= 0)
);

create unique index if not exists checklist_exec_idempotency_key
  on public.checklist_executions (organization_id, idempotency_key);

create index if not exists checklist_exec_lookup_idx
  on public.checklist_executions (organization_id, operational_date desc, checklist_type);
create index if not exists checklist_exec_vehicle_idx
  on public.checklist_executions (organization_id, vehicle_id, operational_date desc);
create index if not exists checklist_exec_employee_idx
  on public.checklist_executions (organization_id, employee_id, operational_date desc);
create index if not exists checklist_exec_br_idx
  on public.checklist_executions (operation_br_id, operational_date desc)
  where operation_br_id is not null;

comment on table public.checklist_executions is
  'Execução do Check List de Frota. Guarda o contexto operacional congelado no '
  'envio; não guarda e não deve guardar anexo, foto ou arquivo (§26).';

create table if not exists public.checklist_execution_answers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  execution_id        uuid not null references public.checklist_executions (id) on delete cascade,
  version_id          uuid not null references public.checklist_app_versions (id) on delete restrict,
  question_id         uuid not null references public.checklist_questions (id) on delete restrict,
  -- §47: a chave é o que sobrevive à mudança de texto; o texto guardado é o
  -- que a pessoa realmente leu ao responder.
  question_key        text not null,
  cluster_key         text not null,
  question_text_snapshot text not null,
  answer              text not null,
  is_conforming       boolean not null,
  criticality         text not null,
  conditional_value   jsonb,
  note                text,
  answered_at         timestamptz not null default now(),

  constraint checklist_answer_value_check check (answer in ('yes', 'no')),
  constraint checklist_answer_criticality_check check (criticality in ('media', 'critica')),
  constraint checklist_answer_note_check check (note is null or length(note) <= 2000)
);

create unique index if not exists checklist_answer_unique
  on public.checklist_execution_answers (execution_id, question_id);
create index if not exists checklist_answer_exec_idx
  on public.checklist_execution_answers (execution_id);
-- §61: a consulta que o Plano de Ação futuro fará é "inconformidades por
-- pergunta e criticidade", não "todas as respostas".
create index if not exists checklist_answer_nonconforming_idx
  on public.checklist_execution_answers (organization_id, question_key, criticality)
  where is_conforming = false;

create table if not exists public.checklist_execution_clusters (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  execution_id        uuid not null references public.checklist_executions (id) on delete cascade,
  cluster_id          uuid not null references public.checklist_clusters (id) on delete restrict,
  cluster_key         text not null,
  cluster_name        text not null,
  sort_order          smallint not null,
  applicable_questions smallint not null default 0,
  answered_questions   smallint not null default 0,
  non_conforming       smallint not null default 0,
  created_at          timestamptz not null default now()
);

create unique index if not exists checklist_exec_cluster_unique
  on public.checklist_execution_clusters (execution_id, cluster_id);
