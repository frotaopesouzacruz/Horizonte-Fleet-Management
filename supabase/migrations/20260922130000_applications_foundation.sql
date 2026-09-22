-- =============================================================================
-- Etapa 12 — APLICATIVOS: fundação configurável e versionada
--
-- A Etapa 07 já criou `operational_apps` e `vehicle_type_apps` como esqueleto:
-- um aplicativo é uma entidade da organização e um tipo de equipamento pode
-- exigi-lo. As duas tabelas estão vazias. Esta migração AMPLIA essa estrutura —
-- a §4 da etapa é explícita em não criar uma segunda estrutura concorrente — e
-- acrescenta o que faltava para um aplicativo ser configurável sem tocar em
-- código: versão, cluster, pergunta, condicional e regra de aplicabilidade.
--
-- DUAS DECISÕES ESTRUTURAIS:
--
-- 1. A IDENTIDADE DA PERGUNTA É ESTÁVEL, O TEXTO NÃO (§47). Cada pergunta
--    carrega `question_key`, que atravessa versões. Mudar o texto de "As luzes
--    de freio estão funcionando?" não pode tornar impossível comparar uma
--    execução de janeiro com uma de dezembro. O texto fica na versão; a
--    identidade, na chave.
--
-- 2. APLICABILIDADE É VÍNCULO, NUNCA TEXTO (§23). O HFC decidia se uma pergunta
--    aparecia com `tipo.includes("caminh")`. Aqui a regra aponta para o id do
--    tipo de equipamento, da subcategoria ou da operação. Renomear "Caminhão"
--    para "Caminhão 3/4" não pode apagar a pergunta da plataforma hidráulica.
--
-- O QUE ESTA MIGRAÇÃO DELIBERADAMENTE NÃO CRIA: nenhuma coluna, tabela, bucket
-- ou referência de fotografia, vídeo, documento ou anexo (§26). O Check List de
-- Frota registra inconformidade por resposta, campo condicional e observação
-- textual — e a ausência de infraestrutura de anexo é o que garante que nenhuma
-- versão futura possa exigir foto por engano.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. operational_apps — o que faltava para o app ser um produto configurável
-- -----------------------------------------------------------------------------
alter table public.operational_apps
  add column if not exists slug            text,
  add column if not exists platform        text not null default 'mobile_responsive',
  add column if not exists is_official     boolean not null default false,
  add column if not exists is_configurable boolean not null default false,
  add column if not exists allows_attachments boolean not null default false;

comment on column public.operational_apps.allows_attachments is
  'Sempre false para o Check List de Frota (§26). A coluna existe para que um '
  'aplicativo futuro possa declarar o contrário de forma explícita e auditável, '
  'nunca por omissão.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operational_apps_platform_check') then
    alter table public.operational_apps
      add constraint operational_apps_platform_check
      check (platform in ('mobile_responsive', 'web', 'mobile_native'));
  end if;
end $$;

create unique index if not exists operational_apps_slug_key
  on public.operational_apps (organization_id, slug)
  where deleted_at is null and slug is not null;

-- -----------------------------------------------------------------------------
-- 2. checklist_app_versions — Major/Minor, e publicada é imutável (§43)
--
-- `label` é gerado, não digitado: "1.10" e "1.1" seriam a mesma coisa para
-- quem digita e coisas diferentes para quem ordena.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_app_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id          uuid not null,
  major           smallint not null,
  minor           smallint not null,
  label           text generated always as (major::text || '.' || minor::text) stored,
  status          text not null default 'draft',
  notes           text,
  source_note     text,
  published_at    timestamptz,
  published_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  -- A chave única de operational_apps é (id, organization_id), nessa ordem: a
  -- FK composta tem de segui-la, senão o Postgres não encontra índice de apoio.
  constraint checklist_versions_app_fkey
    foreign key (app_id, organization_id)
    references public.operational_apps (id, organization_id) on delete restrict,
  constraint checklist_versions_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint checklist_versions_numbers_check
    check (major >= 0 and minor >= 0),
  -- Publicar é datar. Uma versão publicada sem data seria uma publicação que
  -- ninguém consegue situar no tempo.
  constraint checklist_versions_published_dated_check
    check (status <> 'published' or published_at is not null)
);

create unique index if not exists checklist_versions_number_key
  on public.checklist_app_versions (app_id, major, minor);

-- Uma rascunho por aplicativo: duas frentes de edição concorrentes sobre o
-- mesmo formulário produzem uma publicação que ninguém sabe o que contém.
create unique index if not exists checklist_versions_single_draft_key
  on public.checklist_app_versions (app_id)
  where status = 'draft';

create index if not exists checklist_versions_org_idx
  on public.checklist_app_versions (organization_id, app_id, status);

-- -----------------------------------------------------------------------------
-- 3. checklist_clusters — o agrupamento por categoria de inspeção (§9)
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_clusters (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  version_id      uuid not null references public.checklist_app_versions (id) on delete cascade,
  cluster_key     text not null,
  name            text not null,
  sort_order      smallint not null,
  is_required     boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint checklist_clusters_name_check check (length(btrim(name)) between 1 and 120),
  constraint checklist_clusters_position_check check (sort_order > 0)
);

create unique index if not exists checklist_clusters_key_unique
  on public.checklist_clusters (version_id, cluster_key);
create unique index if not exists checklist_clusters_position_unique
  on public.checklist_clusters (version_id, sort_order);

-- -----------------------------------------------------------------------------
-- 4. checklist_questions — o catálogo da §10
--
-- `conforming_answer` é por pergunta, não global (§11). Duas das 34 são
-- invertidas — "Possui alguma avaria?" e "A frota apresenta algum problema
-- mecânico?" —, e uma regra global "SIM = conforme" classificaria um veículo
-- avariado como aprovado.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_questions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  version_id             uuid not null references public.checklist_app_versions (id) on delete cascade,
  cluster_id             uuid not null references public.checklist_clusters (id) on delete cascade,
  -- §47: atravessa versões. É por ela que se compara execução de janeiro com
  -- execução de dezembro, mesmo que o texto tenha mudado no meio.
  question_key           text not null,
  sort_order             smallint not null,
  question_text          text not null,
  answer_type            text not null default 'yes_no',
  conforming_answer      text not null,
  criticality            text not null,
  is_required            boolean not null default true,
  generates_action_plan  boolean not null default true,
  allows_note            boolean not null default true,
  note_required          boolean not null default false,
  status                 text not null default 'active',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint checklist_questions_text_check check (length(btrim(question_text)) between 3 and 500),
  constraint checklist_questions_type_check check (answer_type in ('yes_no')),
  constraint checklist_questions_conforming_check check (conforming_answer in ('yes', 'no')),
  constraint checklist_questions_criticality_check check (criticality in ('media', 'critica')),
  constraint checklist_questions_status_check check (status in ('active', 'inactive')),
  constraint checklist_questions_position_check check (sort_order > 0)
);

create unique index if not exists checklist_questions_key_unique
  on public.checklist_questions (version_id, question_key);
create unique index if not exists checklist_questions_position_unique
  on public.checklist_questions (cluster_id, sort_order);
create index if not exists checklist_questions_cluster_idx
  on public.checklist_questions (version_id, cluster_id);

comment on table public.checklist_questions is
  'Catálogo de perguntas de uma versão. NÃO possui e não deve ganhar coluna de '
  'anexo, foto ou evidência digital (§26): a inconformidade se registra por '
  'resposta, campo condicional e observação textual.';

-- -----------------------------------------------------------------------------
-- 5. checklist_question_conditionals — os 7 campos condicionais (§25)
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_question_conditionals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  version_id      uuid not null references public.checklist_app_versions (id) on delete cascade,
  question_id     uuid not null references public.checklist_questions (id) on delete cascade,
  field_key       text not null,
  trigger_answer  text not null,
  label           text not null,
  field_type      text not null,
  is_required     boolean not null default true,
  options         jsonb not null default '[]'::jsonb,
  sort_order      smallint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint checklist_cond_trigger_check check (trigger_answer in ('yes', 'no')),
  constraint checklist_cond_type_check
    check (field_type in ('text', 'single_select', 'multi_select')),
  constraint checklist_cond_label_check check (length(btrim(label)) between 3 and 200),
  -- Um seletor sem opções é um campo obrigatório impossível de preencher: ele
  -- travaria o envio do checklist sem nenhuma saída para o motorista.
  constraint checklist_cond_options_check check (
    (field_type = 'text' and jsonb_array_length(options) = 0)
    or (field_type in ('single_select', 'multi_select') and jsonb_array_length(options) >= 2)
  )
);

create unique index if not exists checklist_cond_field_unique
  on public.checklist_question_conditionals (question_id, field_key);

-- -----------------------------------------------------------------------------
-- 6. checklist_question_rules — aplicabilidade por vínculo, não por texto (§23)
--
-- SEMÂNTICA: sem nenhuma regra `include` de um tipo, a pergunta vale para
-- todos daquele tipo. Com pelo menos uma, vale só para os listados. `exclude`
-- retira. É o que permite "Prateleiras só em Van" sem escrever "Van" em código.
--
-- `guidance` existe para o caso da §16: em Merchandising, veículos sem câmera e
-- sirene de ré de fábrica seguem regra operacional aprovada. A orientação fica
-- presa à regra e ao seu escopo, nunca solta no texto da pergunta.
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_question_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  version_id      uuid not null references public.checklist_app_versions (id) on delete cascade,
  question_id     uuid not null references public.checklist_questions (id) on delete cascade,
  rule_kind       text not null,
  mode            text not null default 'include',
  vehicle_type_id        uuid,
  vehicle_subcategory_id uuid,
  operation_id           uuid,
  guidance        text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint checklist_rules_kind_check
    check (rule_kind in ('vehicle_type', 'vehicle_subcategory', 'operation')),
  constraint checklist_rules_mode_check check (mode in ('include', 'exclude')),
  -- O tipo da regra diz exatamente qual alvo existe. Sem isto seria possível
  -- gravar uma regra "por operação" carregando um tipo de equipamento que
  -- ninguém lê.
  constraint checklist_rules_shape_check check (
    (rule_kind = 'vehicle_type'        and vehicle_type_id is not null
       and vehicle_subcategory_id is null and operation_id is null)
    or (rule_kind = 'vehicle_subcategory' and vehicle_subcategory_id is not null
       and vehicle_type_id is null and operation_id is null)
    or (rule_kind = 'operation'        and operation_id is not null
       and vehicle_type_id is null and vehicle_subcategory_id is null)
  ),
  -- Tipo e subcategoria têm FK SIMPLES de propósito: `vehicle_types` admite
  -- linhas globais (organization_id nulo) compartilhadas entre tenants, e uma
  -- FK composta por organização recusaria justamente os tipos oficiais. A
  -- tenancy do alvo é conferida na rotina de gravação, não aqui.
  constraint checklist_rules_type_fkey
    foreign key (vehicle_type_id) references public.vehicle_types (id) on delete restrict,
  constraint checklist_rules_subcategory_fkey
    foreign key (vehicle_subcategory_id)
    references public.vehicle_subcategories (id) on delete restrict,
  constraint checklist_rules_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict
);

create unique index if not exists checklist_rules_target_unique
  on public.checklist_question_rules
     (question_id, rule_kind,
      coalesce(vehicle_type_id, vehicle_subcategory_id, operation_id));

-- -----------------------------------------------------------------------------
-- 7. checklist_app_operations — onde o aplicativo está habilitado (§8)
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_app_operations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  app_id          uuid not null,
  operation_id    uuid not null,
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint checklist_app_ops_app_fkey
    foreign key (app_id, organization_id)
    references public.operational_apps (id, organization_id) on delete restrict,
  constraint checklist_app_ops_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict
);

create unique index if not exists checklist_app_ops_unique
  on public.checklist_app_operations (app_id, operation_id);
