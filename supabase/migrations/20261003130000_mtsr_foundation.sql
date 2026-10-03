-- =============================================================================
-- Gestão de MTSR — fundação (Segurança operacional)
--
-- Componentes de segurança do veículo (MDVR, câmeras/CFTV, teclado macro,
-- travas do baú, sirene do sistema, Geotab): catálogo, estado oficial por
-- veículo × componente com histórico, parâmetros com vigência, fontes de
-- ingestão e prioridade por componente, vistorias de campo com evidência
-- fotográfica privada, vínculo com a Gestão de Manutenção corporativa (sem base
-- paralela), eventos de domínio, RBAC, RLS e seeds por organização.
--
-- Princípios:
--   · veículo = public.vehicles (vehicle_id + placa como snapshot); nunca cria veículo;
--   · manutenção = public.maintenances via tabela de vínculo (origem de sistema "mtsr");
--   · serviços = public.maintenance_services (mapeamento componente → serviço);
--   · contexto operacional com IDs, resolvido pelos resolvers oficiais
--     (Fidelização → alocação; liderança BR → cidade → operação);
--   · escrita só por RPC security definer; leitura por RLS real;
--   · evidências em bucket privado (URLs assinadas curtas, geradas no servidor).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões (Administração › Perfis & Permissões)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('mtsr.view',               'mtsr', 'Ver Gestão de MTSR',                 'Acessa Segurança › Gestão de MTSR.'),
  ('mtsr.dashboard.view',     'mtsr', 'Ver visão geral MTSR',               'Indicadores de conformidade, criticidade, prazo de vistoria e manutenções MTSR.'),
  ('mtsr.conformity.view',    'mtsr', 'Ver conformidade por veículo',       'Matriz de conformidade por componente e ficha MTSR 360° do veículo.'),
  ('mtsr.inspection.review',  'mtsr', 'Analisar vistorias recebidas',       'Fila de vistorias enviadas pelo campo, com itens e evidências.'),
  ('mtsr.inspection.validate','mtsr', 'Validar vistoria',                   'Torna oficial o resultado dos componentes de campo de uma vistoria recebida.'),
  ('mtsr.inspection.return',  'mtsr', 'Retornar vistoria',                  'Devolve a vistoria ao campo para nova verificação, com motivo.'),
  ('mtsr.inspection.reject',  'mtsr', 'Rejeitar vistoria',                  'Rejeita a vistoria, com motivo; o estado oficial não muda.'),
  ('mtsr.component.manage',   'mtsr', 'Gerir componentes MTSR',             'Catálogo de componentes, forma de verificação, prioridade, política de evidência e mapeamento de serviços.'),
  ('mtsr.parameters.manage',  'mtsr', 'Parâmetros MTSR',                    'Prazos de vistoria, retenção de evidências e SLAs, com histórico de vigência.'),
  ('mtsr.backoffice.update',  'mtsr', 'Atualizar componente pelo backoffice','Registra o estado oficial de componentes verificados pelo backoffice (MDVR, câmeras, Geotab) ou correção manual.'),
  ('mtsr.ingestion.manage',   'mtsr', 'Gerir fontes e ingestão',            'Fontes de backoffice, prioridade por componente e eventos de ingestão.'),
  ('mtsr.maintenance.open',   'mtsr', 'Abrir manutenção de NOK',            'Abre manutenção corporativa a partir de um componente NOK. Exige também Manutenção › Abrir manutenção.'),
  ('mtsr.maintenance.link',   'mtsr', 'Vincular manutenção',                'Vincula uma manutenção existente a um componente MTSR do mesmo veículo.'),
  ('mtsr.export',             'mtsr', 'Exportar MTSR',                      'Exporta a matriz de conformidade e as vistorias.'),
  ('mtsr.import',             'mtsr', 'Importar histórico MTSR',            'Importa a conformidade legada por placa e componente, com prévia e reconciliação.'),
  ('mtsr.audit.view',         'mtsr', 'Ver auditoria MTSR',                 'Trilha de eventos do domínio MTSR (status, vistorias, manutenções, ingestão).'),
  ('applications.mtsr.execute','applications', 'Executar Vistoria MTSR',   'Realiza vistorias dos componentes MTSR no aplicativo e acompanha as próprias vistorias.')
on conflict (code) do nothing;

-- Padrões por perfil oficial — num único comando (o gatilho de sincronização é
-- por comando). Nada concede acesso pelo nome do perfil: são os padrões da
-- matriz, ajustáveis em Perfis & Permissões.
insert into public.access_profile_defaults (profile_code, permission_code)
select p.profile_code, c.code
  from (values ('administrador'), ('seguranca')) p(profile_code)
  cross join (select code from public.permissions where module = 'mtsr' or code = 'applications.mtsr.execute') c
union all
select v.profile_code, v.permission_code
  from (values
    ('gestor_frota',        'mtsr.view'),
    ('gestor_frota',        'mtsr.dashboard.view'),
    ('gestor_frota',        'mtsr.conformity.view'),
    ('gestor_frota',        'mtsr.inspection.review'),
    ('gestor_frota',        'mtsr.inspection.validate'),
    ('gestor_frota',        'mtsr.inspection.return'),
    ('gestor_frota',        'mtsr.inspection.reject'),
    ('gestor_frota',        'mtsr.backoffice.update'),
    ('gestor_frota',        'mtsr.maintenance.open'),
    ('gestor_frota',        'mtsr.maintenance.link'),
    ('gestor_frota',        'mtsr.export'),
    ('gestor_frota',        'mtsr.audit.view'),
    ('gestao',              'mtsr.view'),
    ('gestao',              'mtsr.dashboard.view'),
    ('gestao',              'mtsr.conformity.view'),
    ('gestao',              'mtsr.export'),
    ('gestao',              'mtsr.audit.view'),
    ('lideranca_operacoes', 'mtsr.view'),
    ('lideranca_operacoes', 'mtsr.dashboard.view'),
    ('lideranca_operacoes', 'mtsr.conformity.view'),
    ('lideranca_operacoes', 'mtsr.inspection.review'),
    ('lideranca_operacoes', 'mtsr.export'),
    ('lideranca_operacoes', 'applications.mtsr.execute'),
    ('operacional',         'applications.mtsr.execute')) v(profile_code, permission_code)
on conflict do nothing;

insert into public.operational_modules (code, name, description, is_available, sort_order)
values ('mtsr', 'Gestão de MTSR', 'Conformidade dos componentes de segurança do veículo (MDVR, câmeras, travas, sirene, Geotab).', true, 60)
on conflict (code) do update set is_available = true, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- 2. Origem de manutenção de sistema "mtsr" (gravada só pela rotina do MTSR)
-- -----------------------------------------------------------------------------
insert into public.maintenance_origins (organization_id, code, name, description, is_system, manual_selectable, is_active, sort_order)
values (null, 'mtsr', 'MTSR', 'Componente MTSR não conforme (vistoria validada ou atualização de backoffice).', true, false, true, 95)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Importação: novo tipo de lote
-- -----------------------------------------------------------------------------
alter table public.import_batches drop constraint if exists import_batches_type_check;
alter table public.import_batches add constraint import_batches_type_check
  check (type = any (array['adherence'::text, 'branches'::text, 'checklist_history'::text, 'employees'::text,
                           'fidelization'::text, 'km'::text, 'maintenance'::text, 'maintenance_catalog'::text,
                           'mtsr_conformity'::text, 'operation_brs'::text, 'vehicles'::text]));

-- -----------------------------------------------------------------------------
-- 4. Catálogo de componentes
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_components (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations (id) on delete restrict,
  code                          text not null,
  name                          text not null,
  description                   text,
  verification_mode             text not null default 'field',
  base_criticality              text not null default 'alta',
  priority                      smallint not null default 100,
  sort_order                    smallint not null default 100,
  is_active                     boolean not null default true,
  context_label                 text,
  evidence_required_when_ok     boolean not null default true,
  evidence_required_when_nok    boolean not null default true,
  observation_required_when_nok boolean not null default true,
  aliases                       text[] not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_components_code_check     check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint mtsr_components_name_check     check (length(btrim(name)) between 2 and 80),
  constraint mtsr_components_mode_check     check (verification_mode in ('field', 'backoffice')),
  constraint mtsr_components_crit_check     check (base_criticality in ('critica', 'alta', 'media', 'baixa')),
  constraint mtsr_components_priority_check check (priority between 1 and 999),
  constraint mtsr_components_code_key       unique (organization_id, code),
  constraint mtsr_components_org_id_key     unique (organization_id, id)
);
comment on table public.mtsr_components is
  'Catálogo MTSR por organização: componentes de segurança, forma de verificação (campo | backoffice), prioridade (menor = mais crítico) e política de evidência. Nada é fixo no código.';

create table if not exists public.mtsr_component_services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  component_id    uuid not null,
  service_id      uuid not null references public.maintenance_services (id) on delete cascade,
  is_default      boolean not null default true,
  is_active       boolean not null default true,
  notes           text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_component_services_component_fk foreign key (organization_id, component_id)
    references public.mtsr_components (organization_id, id) on delete cascade,
  constraint mtsr_component_services_key unique (component_id, service_id)
);
comment on table public.mtsr_component_services is
  'Mapeamento componente MTSR → serviço do catálogo corporativo de Manutenção (pré-preenche a abertura de manutenção de um NOK). Não existe catálogo de serviços paralelo.';

-- -----------------------------------------------------------------------------
-- 5. Parâmetros com vigência (formulário, não JSON)
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_parameter_sets (
  id                             uuid primary key default gen_random_uuid(),
  organization_id                uuid not null references public.organizations (id) on delete restrict,
  effective_from                 date not null,
  effective_to                   date,
  conforme_max_days              smallint not null default 29,
  attention_min_days             smallint not null default 30,
  attention_max_days             smallint not null default 45,
  evidence_retention_inspections smallint not null default 2,
  evidence_retention_days        integer,
  review_sla_days                smallint not null default 2,
  maintenance_open_sla_days      smallint not null default 3,
  revalidation_sla_days          smallint not null default 7,
  note                           text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_parameter_sets_range_check check (
    conforme_max_days >= 1 and attention_min_days > conforme_max_days and attention_max_days >= attention_min_days),
  constraint mtsr_parameter_sets_retention_check check (
    evidence_retention_inspections between 1 and 50 and (evidence_retention_days is null or evidence_retention_days between 1 and 3650)),
  constraint mtsr_parameter_sets_sla_check check (
    review_sla_days between 0 and 365 and maintenance_open_sla_days between 0 and 365 and revalidation_sla_days between 0 and 365),
  constraint mtsr_parameter_sets_validity_check check (effective_to is null or effective_to >= effective_from),
  constraint mtsr_parameter_sets_from_key unique (organization_id, effective_from)
);
comment on table public.mtsr_parameter_sets is
  'Parâmetros do motor MTSR com vigência: prazo da vistoria (≤ conforme_max CONFORME; attention_min..attention_max ATENÇÃO; acima VENCIDO; sem vistoria PENDENTE), retenção de evidências e SLAs. Uma linha por vigência; a corrente tem effective_to nulo.';

-- -----------------------------------------------------------------------------
-- 6. Fontes de ingestão e prioridade por componente
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_ingestion_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code            text not null,
  name            text not null,
  source_type     text not null,
  source_system   text,
  is_enabled      boolean not null default true,
  is_available    boolean not null default false,
  priority        smallint not null default 100,
  config          jsonb not null default '{}'::jsonb,
  last_event_at   timestamptz,
  notes           text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_ingestion_sources_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint mtsr_ingestion_sources_type_check check (source_type in
    ('manual_import', 'backoffice_manual', 'geotab_api', 'mdvr_api', 'cftv_api', 'other_connector')),
  constraint mtsr_ingestion_sources_code_key unique (organization_id, code),
  constraint mtsr_ingestion_sources_org_id_key unique (organization_id, id)
);
comment on table public.mtsr_ingestion_sources is
  'Fontes de estado dos componentes de backoffice. is_available indica adaptador implementado; os conectores de API ficam cadastrados como indisponíveis até existir integração real (nenhuma API é inventada).';

create table if not exists public.mtsr_component_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  component_id    uuid not null,
  source_id       uuid not null,
  priority        smallint not null default 100,
  is_enabled      boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_component_sources_component_fk foreign key (organization_id, component_id)
    references public.mtsr_components (organization_id, id) on delete cascade,
  constraint mtsr_component_sources_source_fk foreign key (organization_id, source_id)
    references public.mtsr_ingestion_sources (organization_id, id) on delete cascade,
  constraint mtsr_component_sources_key unique (component_id, source_id)
);
comment on table public.mtsr_component_sources is
  'Prioridade de cada fonte por componente (menor vence): uma fonte de prioridade pior não sobrescreve estado mais recente de fonte melhor.';

-- -----------------------------------------------------------------------------
-- 7. Fatos do veículo (última vistoria válida)
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_vehicle_facts (
  organization_id            uuid not null references public.organizations (id) on delete restrict,
  vehicle_id                 uuid primary key,
  last_valid_inspection_date date,
  last_valid_inspection_id   uuid,
  last_valid_source          text,
  last_submission_at         timestamptz,
  updated_at                 timestamptz not null default now(),
  constraint mtsr_vehicle_facts_vehicle_fk foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade
);
comment on table public.mtsr_vehicle_facts is
  'Última vistoria válida por veículo (base do prazo). Avança, nunca retrocede; alimentada por validação de vistoria e por importação legada.';

-- -----------------------------------------------------------------------------
-- 8. Vistorias de campo
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_inspections (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete restrict,
  protocol                   text not null,
  app_id                     uuid,
  source                     text not null default 'app',
  vehicle_id                 uuid not null,
  license_plate_snapshot     text not null,
  fleet_code_snapshot        text,
  vehicle_type_id            uuid,
  context_date               date,
  context_source             text,
  operation_id               uuid,
  operation_city_id          uuid,
  state_id                   smallint,
  city_id                    integer,
  operation_br_id            uuid,
  fidelization_assignment_id uuid,
  organization_unit_id       uuid,
  leader_employee_id         uuid,
  leadership_assignment_id   uuid,
  operation_name_snapshot    text,
  city_name_snapshot         text,
  state_uf_snapshot          text,
  br_code_snapshot           text,
  unit_name_snapshot         text,
  leader_name_snapshot       text,
  inspector_user_id          uuid not null,
  inspector_employee_id      uuid,
  inspector_name_snapshot    text,
  inspector_code_snapshot    text,
  inspection_date            date not null,
  inspected_at               timestamptz not null,
  submitted_at               timestamptz not null default now(),
  status                     text not null default 'pendente_validacao',
  general_observation        text,
  item_count                 smallint not null default 0,
  nok_count                  smallint not null default 0,
  evidence_count             smallint not null default 0,
  reviewed_by                uuid,
  reviewed_at                timestamptz,
  reviewer_name_snapshot     text,
  review_reason              text,
  client_submission_id       uuid not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_inspections_status_check check (status in ('pendente_validacao', 'validada', 'retornada', 'rejeitada')),
  constraint mtsr_inspections_source_check check (source in ('app', 'backoffice', 'import')),
  constraint mtsr_inspections_vehicle_fk foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint mtsr_inspections_protocol_key unique (organization_id, protocol),
  constraint mtsr_inspections_submission_key unique (organization_id, client_submission_id),
  constraint mtsr_inspections_org_id_key unique (organization_id, id)
);
comment on table public.mtsr_inspections is
  'Vistoria de campo enviada pelo app Vistoria MTSR. Fica pendente de validação: o envio NÃO altera o estado oficial dos componentes. Contexto operacional congelado com IDs + snapshots.';

create table if not exists public.mtsr_inspection_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  inspection_id      uuid not null,
  component_id       uuid not null,
  status             text not null,
  observation        text,
  evidence_count     smallint not null default 0,
  applied_at         timestamptz,
  applied_history_id uuid,
  skipped_reason     text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_inspection_items_status_check check (status in ('ok', 'nok')),
  constraint mtsr_inspection_items_inspection_fk foreign key (organization_id, inspection_id)
    references public.mtsr_inspections (organization_id, id) on delete cascade,
  constraint mtsr_inspection_items_component_fk foreign key (organization_id, component_id)
    references public.mtsr_components (organization_id, id) on delete restrict,
  constraint mtsr_inspection_items_key unique (inspection_id, component_id)
);

create table if not exists public.mtsr_inspection_evidence (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  inspection_id   uuid not null,
  item_id         uuid not null references public.mtsr_inspection_items (id) on delete cascade,
  bucket_id       text not null default 'mtsr-evidence',
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      integer,
  sha256          text,
  captured_at     timestamptz,
  uploaded_by     uuid,
  purged_at       timestamptz,
  purge_reason    text,
  created_at      timestamptz not null default now(),
  constraint mtsr_inspection_evidence_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint mtsr_inspection_evidence_size_check check (size_bytes is null or size_bytes between 1 and 10485760),
  constraint mtsr_inspection_evidence_inspection_fk foreign key (organization_id, inspection_id)
    references public.mtsr_inspections (organization_id, id) on delete cascade,
  constraint mtsr_inspection_evidence_path_key unique (bucket_id, storage_path)
);
comment on table public.mtsr_inspection_evidence is
  'Fotos das vistorias no bucket privado mtsr-evidence. Nunca públicas: o acesso é por URL assinada curta gerada no servidor após checar permissão. purged_at marca a retenção aplicada.';

-- -----------------------------------------------------------------------------
-- 9. Eventos de ingestão (qualquer fonte de backoffice e importação)
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_ingestion_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  source_id          uuid not null,
  source_type        text not null,
  source_system      text,
  source_record_id   text,
  source_timestamp   timestamptz,
  license_plate_raw  text,
  vehicle_id         uuid,
  component_code_raw text,
  component_id       uuid,
  status_raw         text,
  normalized         jsonb not null default '{}'::jsonb,
  raw                jsonb not null default '{}'::jsonb,
  confidence         numeric(4,3),
  hash               text not null,
  status             text not null default 'received',
  outcome_reason     text,
  history_id         uuid,
  import_batch_id    uuid references public.import_batches (id) on delete set null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  created_by         uuid,
  actor_name         text,
  constraint mtsr_ingestion_events_status_check check (status in ('received', 'applied', 'ignored', 'rejected', 'conflict')),
  constraint mtsr_ingestion_events_source_fk foreign key (organization_id, source_id)
    references public.mtsr_ingestion_sources (organization_id, id) on delete restrict,
  constraint mtsr_ingestion_events_hash_key unique (organization_id, hash)
);
comment on table public.mtsr_ingestion_events is
  'Registro bruto + normalizado de cada evento recebido de uma fonte (importação, backoffice manual, conectores). hash garante idempotência; status diz o que aconteceu (applied | ignored stale | conflict por prioridade | rejected).';

-- -----------------------------------------------------------------------------
-- 10. Estado oficial por veículo × componente + histórico
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_component_status (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  vehicle_id              uuid not null,
  component_id            uuid not null,
  status                  text not null default 'sem_informacao',
  reference_date          date,
  source_type             text,
  source_system           text,
  source_id               uuid,
  ingestion_event_id      uuid references public.mtsr_ingestion_events (id) on delete set null,
  inspection_id           uuid,
  inspection_item_id      uuid references public.mtsr_inspection_items (id) on delete set null,
  observation             text,
  awaiting_revalidation   boolean not null default false,
  awaiting_since          timestamptz,
  awaiting_maintenance_id uuid,
  status_changed_at       timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_component_status_status_check check (status in ('ok', 'nok', 'sem_informacao')),
  constraint mtsr_component_status_source_check check (source_type is null or source_type in
    ('field_inspection', 'manual_import', 'backoffice_manual', 'geotab_api', 'mdvr_api', 'cftv_api', 'other_connector', 'system')),
  constraint mtsr_component_status_vehicle_fk foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  constraint mtsr_component_status_component_fk foreign key (organization_id, component_id)
    references public.mtsr_components (organization_id, id) on delete restrict,
  constraint mtsr_component_status_inspection_fk foreign key (organization_id, inspection_id)
    references public.mtsr_inspections (organization_id, id) on delete set null,
  constraint mtsr_component_status_key unique (vehicle_id, component_id)
);
comment on table public.mtsr_component_status is
  'Estado oficial corrente de cada componente por veículo. Só muda por vistoria VALIDADA (componentes de campo), por atualização de backoffice/ingestão ou por importação. awaiting_revalidation: manutenção concluída e ainda sem nova verificação.';

create table if not exists public.mtsr_component_status_history (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  vehicle_id         uuid not null,
  component_id       uuid not null,
  previous_status    text,
  new_status         text not null,
  reference_date     date,
  source_type        text,
  source_system      text,
  source_id          uuid,
  ingestion_event_id uuid,
  inspection_id      uuid,
  inspection_item_id uuid,
  maintenance_id     uuid,
  observation        text,
  actor_user_id      uuid,
  actor_name         text,
  occurred_at        timestamptz not null default clock_timestamp(),
  created_at         timestamptz not null default now(),
  constraint mtsr_component_status_history_vehicle_fk foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade
);
comment on table public.mtsr_component_status_history is
  'Histórico append-only de cada mudança de estado oficial (de → para, fonte, vistoria, manutenção, ator).';

-- -----------------------------------------------------------------------------
-- 11. Vínculo com a Gestão de Manutenção corporativa
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_maintenance_links (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations (id) on delete restrict,
  maintenance_id              uuid not null,
  vehicle_id                  uuid not null,
  component_id                uuid not null,
  inspection_id               uuid,
  inspection_item_id          uuid references public.mtsr_inspection_items (id) on delete set null,
  source_history_id           uuid references public.mtsr_component_status_history (id) on delete set null,
  link_type                   text not null default 'opened_from_nok',
  status                      text not null default 'active',
  requires_revalidation       boolean not null default true,
  revalidation_status         text not null default 'pending',
  maintenance_status_snapshot text,
  maintenance_concluded_at    timestamptz,
  revalidated_at              timestamptz,
  revalidation_source         text,
  revalidation_history_id     uuid references public.mtsr_component_status_history (id) on delete set null,
  reason                      text,
  notes                       text,
  linked_by                   uuid,
  linked_at                   timestamptz not null default now(),
  unlinked_by                 uuid,
  unlinked_at                 timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  constraint mtsr_maintenance_links_type_check check (link_type in ('opened_from_nok', 'linked_existing', 'import')),
  constraint mtsr_maintenance_links_status_check check (status in ('active', 'unlinked')),
  constraint mtsr_maintenance_links_reval_check check (revalidation_status in ('pending', 'awaiting', 'done', 'not_required', 'cancelled')),
  constraint mtsr_maintenance_links_maintenance_fk foreign key (organization_id, maintenance_id)
    references public.maintenances (organization_id, id) on delete restrict,
  constraint mtsr_maintenance_links_vehicle_fk foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  constraint mtsr_maintenance_links_component_fk foreign key (organization_id, component_id)
    references public.mtsr_components (organization_id, id) on delete restrict,
  constraint mtsr_maintenance_links_inspection_fk foreign key (organization_id, inspection_id)
    references public.mtsr_inspections (organization_id, id) on delete set null,
  constraint mtsr_maintenance_links_key unique (maintenance_id, component_id)
);
comment on table public.mtsr_maintenance_links is
  'Vínculo N:N entre manutenção corporativa (public.maintenances) e componente MTSR. A conclusão da manutenção NÃO torna o componente OK: marca AGUARDANDO REVALIDAÇÃO até nova verificação.';

-- -----------------------------------------------------------------------------
-- 12. Eventos de domínio (timeline por veículo + auditoria do módulo)
-- -----------------------------------------------------------------------------
create table if not exists public.mtsr_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  vehicle_id         uuid,
  component_id       uuid,
  event_type         text not null,
  source_type        text,
  inspection_id      uuid,
  maintenance_id     uuid,
  ingestion_event_id uuid,
  history_id         uuid,
  payload            jsonb not null default '{}'::jsonb,
  reason             text,
  actor_user_id      uuid,
  actor_name         text,
  source             text not null default 'user',
  occurred_at        timestamptz not null default clock_timestamp(),
  constraint mtsr_events_type_check check (event_type in (
    'STATUS_COMPONENTE_ALTERADO', 'VISTORIA_ENVIADA', 'VISTORIA_VALIDADA', 'VISTORIA_RETORNADA', 'VISTORIA_REJEITADA',
    'NOK_IDENTIFICADO', 'MANUTENCAO_ABERTA', 'MANUTENCAO_VINCULADA', 'MANUTENCAO_DESVINCULADA', 'MANUTENCAO_CONCLUIDA',
    'MANUTENCAO_CANCELADA', 'MANUTENCAO_REABERTA', 'REVALIDACAO_REALIZADA', 'ATUALIZACAO_BACKOFFICE', 'IMPORTACAO',
    'ALTERACAO_MANUAL', 'INGESTAO_IGNORADA', 'INGESTAO_CONFLITO', 'PARAMETROS_ALTERADOS', 'COMPONENTE_ALTERADO',
    'FONTE_ALTERADA', 'EVIDENCIA_EXPURGADA', 'EXPORTACAO')),
  constraint mtsr_events_source_check check (source in ('user', 'system', 'import', 'integration'))
);
comment on table public.mtsr_events is
  'Trilha append-only do domínio MTSR: quem fez o quê, quando, por qual fonte. Ator = usuário autenticado (nome congelado); "Sistema" só sem sessão.';

-- -----------------------------------------------------------------------------
-- 13. Índices
-- -----------------------------------------------------------------------------
create index if not exists mtsr_components_org_active_idx       on public.mtsr_components (organization_id, is_active, sort_order);
create index if not exists mtsr_component_status_org_vehicle_idx on public.mtsr_component_status (organization_id, vehicle_id);
create index if not exists mtsr_component_status_component_idx  on public.mtsr_component_status (organization_id, component_id, status);
create index if not exists mtsr_component_status_awaiting_idx   on public.mtsr_component_status (organization_id) where awaiting_revalidation;
create index if not exists mtsr_status_history_vehicle_idx      on public.mtsr_component_status_history (organization_id, vehicle_id, occurred_at desc);
create index if not exists mtsr_inspections_org_status_idx      on public.mtsr_inspections (organization_id, status, submitted_at desc);
create index if not exists mtsr_inspections_vehicle_idx         on public.mtsr_inspections (organization_id, vehicle_id, inspection_date desc);
create index if not exists mtsr_inspections_inspector_idx       on public.mtsr_inspections (organization_id, inspector_user_id, submitted_at desc);
create index if not exists mtsr_inspection_items_inspection_idx on public.mtsr_inspection_items (inspection_id);
create index if not exists mtsr_inspection_evidence_item_idx    on public.mtsr_inspection_evidence (item_id);
create index if not exists mtsr_inspection_evidence_live_idx    on public.mtsr_inspection_evidence (organization_id, inspection_id) where purged_at is null;
create index if not exists mtsr_ingestion_events_org_idx        on public.mtsr_ingestion_events (organization_id, received_at desc);
create index if not exists mtsr_ingestion_events_vehicle_idx    on public.mtsr_ingestion_events (organization_id, vehicle_id, component_id);
create index if not exists mtsr_maintenance_links_maint_idx     on public.mtsr_maintenance_links (maintenance_id) where status = 'active';
create index if not exists mtsr_maintenance_links_vehicle_idx   on public.mtsr_maintenance_links (organization_id, vehicle_id, component_id);
create index if not exists mtsr_events_vehicle_idx              on public.mtsr_events (organization_id, vehicle_id, occurred_at desc);
create index if not exists mtsr_events_org_time_idx             on public.mtsr_events (organization_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- 14. Gatilhos padrão (stamps, tenant, auditoria, append-only)
-- -----------------------------------------------------------------------------
do $trg$
declare t text;
begin
  foreach t in array array['mtsr_components', 'mtsr_component_services', 'mtsr_parameter_sets', 'mtsr_ingestion_sources',
                           'mtsr_component_sources', 'mtsr_inspections', 'mtsr_inspection_items', 'mtsr_component_status',
                           'mtsr_maintenance_links'] loop
    execute format('create or replace trigger %1$s_set_stamps before insert or update on public.%1$s for each row execute function private.tg_set_stamps()', t);
    execute format('create or replace trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function private.tg_audit()', t);
  end loop;
  foreach t in array array['mtsr_components', 'mtsr_component_services', 'mtsr_parameter_sets', 'mtsr_ingestion_sources',
                           'mtsr_component_sources', 'mtsr_vehicle_facts', 'mtsr_inspections', 'mtsr_inspection_items',
                           'mtsr_inspection_evidence', 'mtsr_ingestion_events', 'mtsr_component_status',
                           'mtsr_component_status_history', 'mtsr_maintenance_links', 'mtsr_events'] loop
    execute format('create or replace trigger %1$s_prevent_tenant_change before update on public.%1$s for each row execute function private.tg_prevent_tenant_change()', t);
  end loop;
  foreach t in array array['mtsr_component_status_history', 'mtsr_events'] loop
    execute format('create or replace trigger %1$s_append_only before update or delete on public.%1$s for each row execute function private.tg_block_mutation()', t);
  end loop;
end $trg$;

-- -----------------------------------------------------------------------------
-- 15. RLS — leitura por permissão + escopo de veículo; escrita só por RPC
-- -----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['mtsr_components', 'mtsr_component_services', 'mtsr_parameter_sets', 'mtsr_ingestion_sources',
                           'mtsr_component_sources', 'mtsr_vehicle_facts', 'mtsr_inspections', 'mtsr_inspection_items',
                           'mtsr_inspection_evidence', 'mtsr_ingestion_events', 'mtsr_component_status',
                           'mtsr_component_status_history', 'mtsr_maintenance_links', 'mtsr_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $rls$;

-- Catálogos: quem vê o módulo ou executa o app (o app lê o catálogo de campo).
do $pol$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_components' and policyname = 'mtsr_components_select') then
    create policy mtsr_components_select on public.mtsr_components for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
          or organization_id in (select private.permitted_org_ids('applications.mtsr.execute')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_component_services' and policyname = 'mtsr_component_services_select') then
    create policy mtsr_component_services_select on public.mtsr_component_services for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_parameter_sets' and policyname = 'mtsr_parameter_sets_select') then
    create policy mtsr_parameter_sets_select on public.mtsr_parameter_sets for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_ingestion_sources' and policyname = 'mtsr_ingestion_sources_select') then
    create policy mtsr_ingestion_sources_select on public.mtsr_ingestion_sources for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_component_sources' and policyname = 'mtsr_component_sources_select') then
    create policy mtsr_component_sources_select on public.mtsr_component_sources for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view')));
  end if;
  -- Por veículo: escopo de operação da pessoa (mesma regra de Manutenção e KM).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_vehicle_facts' and policyname = 'mtsr_vehicle_facts_select') then
    create policy mtsr_vehicle_facts_select on public.mtsr_vehicle_facts for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
         and vehicle_id in (select private.vehicle_scope_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_component_status' and policyname = 'mtsr_component_status_select') then
    create policy mtsr_component_status_select on public.mtsr_component_status for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
         and vehicle_id in (select private.vehicle_scope_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_component_status_history' and policyname = 'mtsr_component_status_history_select') then
    create policy mtsr_component_status_history_select on public.mtsr_component_status_history for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
         and vehicle_id in (select private.vehicle_scope_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_maintenance_links' and policyname = 'mtsr_maintenance_links_select') then
    create policy mtsr_maintenance_links_select on public.mtsr_maintenance_links for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
         and vehicle_id in (select private.vehicle_scope_ids('mtsr.view')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_ingestion_events' and policyname = 'mtsr_ingestion_events_select') then
    create policy mtsr_ingestion_events_select on public.mtsr_ingestion_events for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.view'))
         and (vehicle_id is null or vehicle_id in (select private.vehicle_scope_ids('mtsr.view'))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_events' and policyname = 'mtsr_events_select') then
    create policy mtsr_events_select on public.mtsr_events for select to authenticated
      using (organization_id in (select private.permitted_org_ids('mtsr.audit.view'))
         and (vehicle_id is null or vehicle_id in (select private.vehicle_scope_ids('mtsr.audit.view'))));
  end if;
  -- Vistorias: escopo do módulo OU as próprias vistorias de quem executa o app.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_inspections' and policyname = 'mtsr_inspections_select') then
    create policy mtsr_inspections_select on public.mtsr_inspections for select to authenticated
      using ((organization_id in (select private.permitted_org_ids('mtsr.view'))
              and vehicle_id in (select private.vehicle_scope_ids('mtsr.view')))
          or (organization_id in (select private.permitted_org_ids('applications.mtsr.execute'))
              and inspector_user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_inspection_items' and policyname = 'mtsr_inspection_items_select') then
    create policy mtsr_inspection_items_select on public.mtsr_inspection_items for select to authenticated
      using (inspection_id in (select i.id from public.mtsr_inspections i));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mtsr_inspection_evidence' and policyname = 'mtsr_inspection_evidence_select') then
    create policy mtsr_inspection_evidence_select on public.mtsr_inspection_evidence for select to authenticated
      using (inspection_id in (select i.id from public.mtsr_inspections i));
  end if;
end $pol$;

-- -----------------------------------------------------------------------------
-- 16. Bucket privado de evidências (sem política para authenticated: só URLs
--     assinadas emitidas no servidor; nada é público)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mtsr-evidence', 'mtsr-evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 17. Aplicativo "Vistoria MTSR" (mesma arquitetura de elegibilidade dos
--     Aplicativos: operações e tipos de equipamento habilitados). Os vínculos
--     iniciais espelham o Check List de Frota e são ajustáveis em Operações e
--     Tipos de Equipamento › Aplicativos habilitados.
-- -----------------------------------------------------------------------------
do $app$
declare o record; v_app uuid; v_src uuid; n_ops integer; n_types integer;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active' loop
    insert into public.operational_apps
      (organization_id, code, name, slug, description, platform, is_active, is_official, is_configurable, allows_attachments)
    values (o.id, 'vistoria_mtsr', 'Vistoria MTSR', 'vistoria-mtsr',
            'Vistoria em campo dos componentes MTSR verificáveis presencialmente, com evidência fotográfica privada e validação pela gestão.',
            'mobile_responsive', true, true, false, true)
    on conflict (organization_id, code) do update
      set slug = excluded.slug, name = excluded.name, description = excluded.description,
          allows_attachments = true, is_active = true, deleted_at = null, updated_at = now()
    returning id into v_app;

    select a.id into v_src from public.operational_apps a
     where a.organization_id = o.id and a.code = 'checklist_frota' and a.deleted_at is null;
    n_ops := 0; n_types := 0;
    if v_src is not null then
      insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled, effective_from, effective_to)
      select o.id, v_app, l.operation_id, l.is_enabled, l.effective_from, l.effective_to
        from public.checklist_app_operations l where l.app_id = v_src
      on conflict (app_id, operation_id) do nothing;
      get diagnostics n_ops = row_count;
      insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled, effective_from, effective_to)
      select o.id, l.vehicle_type_id, v_app, l.is_enabled, l.effective_from, l.effective_to
        from public.vehicle_type_apps l where l.app_id = v_src
      on conflict (organization_id, vehicle_type_id, app_id) do nothing;
      get diagnostics n_types = row_count;
    end if;
    raise notice 'Vistoria MTSR em %: % vínculos de operação e % de tipo espelhados do Check List de Frota', o.name, n_ops, n_types;
  end loop;
end $app$;

-- -----------------------------------------------------------------------------
-- 18. Seeds por organização: componentes, parâmetros, fontes, prioridades e
--     mapeamento de serviços (dados editáveis em Cadastros — nada fixo no código)
-- -----------------------------------------------------------------------------
do $seed$
declare
  o record; c record; s record; v_today date;
  v_src_import uuid; v_src_bo uuid; v_src_geotab uuid; v_src_mdvr uuid; v_src_cftv uuid; v_src_other uuid;
  v_svc uuid;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active' loop
    v_today := private.maintenance_today(o.id);

    -- Componentes (catálogo oficial HFC: prioridade menor = mais crítico)
    insert into public.mtsr_components
      (organization_id, code, name, description, verification_mode, base_criticality, priority, sort_order, context_label, aliases)
    values
      (o.id, 'mdvr',                'MDVR',                 'Gravador móvel de vídeo (DVR embarcado).',                'backoffice', 'critica', 10, 10, null,   array['mdvr', 'dvr', 'mdvr / dvr', 'status mdvr', 'sistema mdvr', 'modulo mdvr']),
      (o.id, 'cameras',             'Câmeras',              'Câmeras de monitoramento veicular (CFTV).',               'backoffice', 'critica', 20, 20, 'CFTV', array['camera', 'cameras', 'cftv', 'camera cftv', 'cameras cftv', 'status cameras', 'status camera']),
      (o.id, 'teclado_macro',       'Teclado Macro',        'Teclado de macros do sistema embarcado.',                 'field',      'alta',    30, 30, null,   array['teclado', 'teclado macro', 'macro', 'status teclado']),
      (o.id, 'travas_bau_lateral',  'Travas do Baú Lateral','Travas da porta lateral do compartimento de carga.',      'field',      'alta',    40, 40, null,   array['travas bau lateral', 'trava bau lateral', 'trava lateral', 'travas lateral']),
      (o.id, 'travas_bau_traseiro', 'Travas do Baú Traseiro','Travas da porta traseira do compartimento de carga.',    'field',      'alta',    45, 45, null,   array['travas bau traseiro', 'trava bau traseiro', 'trava traseira', 'travas traseiro', 'travas do bau', 'travas bau', 'trava bau', 'travas']),
      (o.id, 'sirene_sistema',      'Sirene do Sistema',    'Sirene do sistema de segurança (não confundir com sirene de ré).', 'field', 'media', 50, 50, null, array['sirene', 'sirene do sistema', 'sirene sistema', 'status sirene']),
      (o.id, 'geotab',              'Geotab',               'Rastreador/telemetria Geotab.',                           'backoffice', 'alta',    60, 60, null,   array['geotab', 'rastreador geotab', 'status geotab'])
    on conflict (organization_id, code) do nothing;

    -- Parâmetros vigentes (29 / 30–45 / >45; retenção 2 vistorias; SLAs)
    insert into public.mtsr_parameter_sets (organization_id, effective_from, note)
    select o.id, v_today, 'Parâmetros iniciais do módulo (padrão HFC: conforme ≤ 29 dias, atenção 30–45, vencido > 45).'
     where not exists (select 1 from public.mtsr_parameter_sets p where p.organization_id = o.id);

    -- Fontes de ingestão (só as disponíveis estão habilitadas)
    insert into public.mtsr_ingestion_sources (organization_id, code, name, source_type, source_system, is_enabled, is_available, priority, notes) values
      (o.id, 'manual_import',     'Importação manual (planilha)', 'manual_import',     'HFM Importação',   true,  true,  40, 'Planilha de conformidade legada, com prévia e reconciliação.'),
      (o.id, 'backoffice_manual', 'Atualização manual do backoffice', 'backoffice_manual', 'HFM Backoffice', true, true, 20, 'Registro manual pela gestão (ex.: verificação de CFTV, MDVR, Geotab).'),
      (o.id, 'geotab_api',        'Geotab (API)',                 'geotab_api',        'Geotab',           false, false, 10, 'Conector não implementado: será habilitado quando a integração existir.'),
      (o.id, 'mdvr_api',          'MDVR (API)',                   'mdvr_api',          'MDVR',             false, false, 10, 'Conector não implementado.'),
      (o.id, 'cftv_api',          'CFTV (API)',                   'cftv_api',          'CFTV',             false, false, 10, 'Conector não implementado.'),
      (o.id, 'other_connector',   'Outro conector',               'other_connector',   null,               false, false, 50, 'Reservado para integrações futuras.')
    on conflict (organization_id, code) do nothing;

    select id into v_src_import from public.mtsr_ingestion_sources where organization_id = o.id and code = 'manual_import';
    select id into v_src_bo     from public.mtsr_ingestion_sources where organization_id = o.id and code = 'backoffice_manual';
    select id into v_src_geotab from public.mtsr_ingestion_sources where organization_id = o.id and code = 'geotab_api';
    select id into v_src_mdvr   from public.mtsr_ingestion_sources where organization_id = o.id and code = 'mdvr_api';
    select id into v_src_cftv   from public.mtsr_ingestion_sources where organization_id = o.id and code = 'cftv_api';
    select id into v_src_other  from public.mtsr_ingestion_sources where organization_id = o.id and code = 'other_connector';

    -- Prioridade por componente (conector dedicado > backoffice > importação)
    for c in select id, code, verification_mode from public.mtsr_components where organization_id = o.id loop
      insert into public.mtsr_component_sources (organization_id, component_id, source_id, priority) values
        (o.id, c.id, v_src_bo, 20), (o.id, c.id, v_src_import, 40), (o.id, c.id, v_src_other, 50)
      on conflict (component_id, source_id) do nothing;
      if c.code = 'geotab' then
        insert into public.mtsr_component_sources (organization_id, component_id, source_id, priority) values (o.id, c.id, v_src_geotab, 10) on conflict do nothing;
      elsif c.code = 'mdvr' then
        insert into public.mtsr_component_sources (organization_id, component_id, source_id, priority) values (o.id, c.id, v_src_mdvr, 10) on conflict do nothing;
      elsif c.code = 'cameras' then
        insert into public.mtsr_component_sources (organization_id, component_id, source_id, priority) values (o.id, c.id, v_src_cftv, 10) on conflict do nothing;
      end if;
    end loop;

    -- Mapeamento componente → serviço corporativo (só correspondências inequívocas;
    -- o restante é configurado em Cadastros)
    for s in select * from (values
        ('cameras',             'Reparo ou substituição das câmeras de monitoramento veicular'),
        ('travas_bau_lateral',  'Reparo de portas, maçanetas e fechaduras do compartimento de carga'),
        ('travas_bau_traseiro', 'Reparo de portas, maçanetas e fechaduras do compartimento de carga')) m(component_code, service_name) loop
      select ms.id into v_svc from public.maintenance_services ms
       where ms.organization_id = o.id and ms.deleted_at is null and ms.status = 'active'
         and private.normalize_label(ms.name) = private.normalize_label(s.service_name)
       limit 1;
      if v_svc is not null then
        insert into public.mtsr_component_services (organization_id, component_id, service_id, is_default)
        select o.id, mc.id, v_svc, true from public.mtsr_components mc where mc.organization_id = o.id and mc.code = s.component_code
        on conflict (component_id, service_id) do nothing;
      end if;
    end loop;
  end loop;
end $seed$;
