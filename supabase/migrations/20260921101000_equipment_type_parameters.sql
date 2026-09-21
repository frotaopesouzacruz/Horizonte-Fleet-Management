-- =============================================================================
-- ETAPA 07 · PARAMETRIZAÇÃO DO TIPO, POR ORGANIZAÇÃO
--
-- O tipo classifica; a parametrização decide o que ele pode fazer aqui. São
-- coisas separadas porque um tipo do catálogo base é compartilhado: "Caminhão"
-- é o mesmo conceito em todas as organizações, mas quais operações o admitem e
-- quais aplicativos o utilizam é decisão de cada uma. Por isso toda tabela
-- abaixo tem `organization_id`, inclusive quando o tipo é global.
--
-- A AUSÊNCIA DE VÍNCULO NÃO AUTORIZA NADA (§19). Um tipo sem operações
-- vinculadas poderia significar duas coisas opostas — "serve para todas" ou
-- "não foi habilitado para nenhuma" — e deixar isso implícito é como um
-- cadastro incompleto vira permissão. `operation_restriction_enabled` diz qual
-- das duas, explicitamente:
--
--   false  sem restrição configurada: qualquer operação aceita este tipo
--   true   só as operações vinculadas aceitam; nenhuma vinculada = nenhuma aceita
-- =============================================================================

-- -----------------------------------------------------------------------------
-- O tipo precisa ser global ou da própria organização
--
-- Uma FK composta não consegue dizer "ou é meu, ou é de ninguém": o lado global
-- tem `organization_id` nulo. O gatilho diz.
-- -----------------------------------------------------------------------------
create or replace function private.tg_type_belongs_to_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_found boolean;
begin
  select organization_id, true into v_owner, v_found
    from public.vehicle_types where id = new.vehicle_type_id;

  if not coalesce(v_found, false) then
    raise exception 'Tipo de equipamento não encontrado.' using errcode = 'foreign_key_violation';
  end if;
  if v_owner is not null and v_owner <> new.organization_id then
    raise exception 'Este tipo de equipamento pertence a outra organização.'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_type_belongs_to_org() from public, anon;

-- -----------------------------------------------------------------------------
-- 1. Configuração do tipo dentro da organização
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_type_settings (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id uuid not null references public.vehicle_types (id) on delete restrict,

  -- §19: o significado da ausência de operações vinculadas, dito em voz alta.
  operation_restriction_enabled boolean not null default false,
  -- §13: subcategoria obrigatória é uma regra explícita, não a consequência de
  -- existir alguma subcategoria cadastrada em algum momento.
  requires_subcategory boolean not null default false,
  is_enabled boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  primary key (organization_id, vehicle_type_id),
  constraint vehicle_type_settings_notes_check check (notes is null or length(notes) <= 1000)
);

comment on table public.vehicle_type_settings is
  'Parametrização de um tipo de equipamento dentro de uma organização. Existe também para os tipos do catálogo global, que são compartilhados mas configurados por cada organização.';

alter table public.vehicle_type_settings enable row level security;

drop trigger if exists vehicle_type_settings_stamps on public.vehicle_type_settings;
create trigger vehicle_type_settings_stamps
  before insert or update on public.vehicle_type_settings
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_type_settings_type_scope on public.vehicle_type_settings;
create trigger vehicle_type_settings_type_scope
  before insert or update on public.vehicle_type_settings
  for each row execute function private.tg_type_belongs_to_org();

drop trigger if exists vehicle_type_settings_audit on public.vehicle_type_settings;
create trigger vehicle_type_settings_audit
  after insert or update or delete on public.vehicle_type_settings
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 2. Operações que admitem o tipo
--
-- A FK composta contra `operations (organization_id, id)` é o que impede o tipo
-- da organização A de ser habilitado para a operação da organização B (§41).
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_type_operations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id uuid not null references public.vehicle_types (id) on delete restrict,
  operation_id    uuid not null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint vehicle_type_operations_key unique (organization_id, vehicle_type_id, operation_id),
  constraint vehicle_type_operations_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict
);

alter table public.vehicle_type_operations enable row level security;

create index if not exists vehicle_type_operations_type_idx
  on public.vehicle_type_operations (vehicle_type_id);
create index if not exists vehicle_type_operations_operation_idx
  on public.vehicle_type_operations (operation_id);

drop trigger if exists vehicle_type_operations_stamps on public.vehicle_type_operations;
create trigger vehicle_type_operations_stamps
  before insert on public.vehicle_type_operations
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_type_operations_type_scope on public.vehicle_type_operations;
create trigger vehicle_type_operations_type_scope
  before insert or update on public.vehicle_type_operations
  for each row execute function private.tg_type_belongs_to_org();

drop trigger if exists vehicle_type_operations_audit on public.vehicle_type_operations;
create trigger vehicle_type_operations_audit
  after insert or update or delete on public.vehicle_type_operations
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 3. Aplicativos operacionais
--
-- O Gerenciador de Aplicativos ainda não existe no HFM. Esta é a tabela que ele
-- vai administrar quando existir — criada vazia, sem nenhum aplicativo
-- inventado para preencher a tela (§23). Até lá a aba Aplicativos mostra um
-- estado vazio honesto, e o vínculo abaixo já é o que o módulo futuro reutiliza.
-- -----------------------------------------------------------------------------
create table if not exists public.operational_apps (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code            text not null,
  name            text not null,
  description     text,
  is_active       boolean not null default true,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,

  constraint operational_apps_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint operational_apps_name_check check (length(btrim(name)) between 1 and 80),
  constraint operational_apps_code_key unique (organization_id, code),
  constraint operational_apps_id_org_key unique (id, organization_id)
);

comment on table public.operational_apps is
  'Cadastro oficial de aplicativos operacionais da organização. Criado vazio na Etapa 07: o Gerenciador de Aplicativos ainda não existe e nenhum aplicativo foi inventado para preencher interface.';

alter table public.operational_apps enable row level security;

drop trigger if exists operational_apps_stamps on public.operational_apps;
create trigger operational_apps_stamps
  before insert or update on public.operational_apps
  for each row execute function private.tg_set_stamps();

create table if not exists public.vehicle_type_apps (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id uuid not null references public.vehicle_types (id) on delete restrict,
  app_id          uuid not null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint vehicle_type_apps_key unique (organization_id, vehicle_type_id, app_id),
  constraint vehicle_type_apps_app_fkey
    foreign key (app_id, organization_id)
    references public.operational_apps (id, organization_id) on delete restrict
);

alter table public.vehicle_type_apps enable row level security;

create index if not exists vehicle_type_apps_type_idx on public.vehicle_type_apps (vehicle_type_id);
create index if not exists vehicle_type_apps_app_idx  on public.vehicle_type_apps (app_id);

drop trigger if exists vehicle_type_apps_stamps on public.vehicle_type_apps;
create trigger vehicle_type_apps_stamps
  before insert on public.vehicle_type_apps
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_type_apps_type_scope on public.vehicle_type_apps;
create trigger vehicle_type_apps_type_scope
  before insert or update on public.vehicle_type_apps
  for each row execute function private.tg_type_belongs_to_org();

drop trigger if exists vehicle_type_apps_audit on public.vehicle_type_apps;
create trigger vehicle_type_apps_audit
  after insert or update or delete on public.vehicle_type_apps
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 4. Módulos e elegibilidade
--
-- O §25 separa três coisas que um checkbox só chamado "Motor de Aderência"
-- confundiria:
--
--   visibility  o módulo pode consultar veículos deste tipo
--   operation   veículos deste tipo são elegíveis para o módulo
--   indicator   veículos deste tipo entram no indicador do módulo
--
-- São perguntas diferentes e uma resposta não implica a outra: um veículo
-- administrativo pode ser consultável pelo Checklist sem entrar no cálculo de
-- aderência. Cada combinação tipo × módulo × capacidade tem a sua regra.
-- -----------------------------------------------------------------------------
create table if not exists public.operational_modules (
  code        text primary key,
  name        text not null,
  description text not null,
  -- §26: um módulo que ainda não existe aparece na lista como indisponível, e
  -- não como uma caixa que promete um comportamento que ninguém implementou.
  is_available boolean not null default false,
  sort_order  smallint not null default 100,
  constraint operational_modules_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$')
);

comment on table public.operational_modules is
  'Catálogo dos módulos operacionais do HFM e da sua disponibilidade. is_available = false significa que o módulo ainda não foi implementado: a regra pode ser configurada, mas nada a consome ainda.';

alter table public.operational_modules enable row level security;

insert into public.operational_modules (code, name, description, is_available, sort_order) values
  ('checklist',   'Checklist de Frota',
   'Inspeções periódicas do veículo e as perguntas aplicáveis a cada tipo.', false, 10),
  ('adherence',   'Motor de Aderência',
   'Indicador de cumprimento do checklist. Define quais veículos entram no cálculo.', false, 20),
  ('maintenance', 'Manutenção',
   'Planos preventivos e preditivos e os serviços aplicáveis ao tipo.', false, 30),
  ('tyres',       'Pneus',
   'Parâmetros de pressão, medidas e inspeções por configuração de eixo.', false, 40),
  ('fueling',     'Abastecimento',
   'Registro de abastecimentos e consumo esperado por categoria.', false, 50)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

create table if not exists public.vehicle_type_module_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  vehicle_type_id uuid not null references public.vehicle_types (id) on delete restrict,
  module_code     text not null references public.operational_modules (code) on delete restrict,
  capability      text not null,
  is_eligible     boolean not null,

  -- §29: mudar a regra hoje não pode reescrever o indicador de agosto. A regra
  -- tem vigência, e a consulta histórica lê a que valia na data pedida.
  effective_from date not null default current_date,
  effective_to   date,
  reason         text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint vehicle_type_module_rules_capability_check
    check (capability in ('visibility', 'operation', 'indicator')),
  constraint vehicle_type_module_rules_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint vehicle_type_module_rules_reason_check
    check (reason is null or length(reason) <= 500)
);

comment on column public.vehicle_type_module_rules.capability is
  'visibility: o módulo pode consultar o veículo. operation: o veículo é elegível ao módulo. indicator: o veículo entra no indicador do módulo. Não são equivalentes.';

alter table public.vehicle_type_module_rules enable row level security;

create unique index if not exists vehicle_type_module_rules_current_key
  on public.vehicle_type_module_rules (organization_id, vehicle_type_id, module_code, capability)
  where effective_to is null;

create index if not exists vehicle_type_module_rules_type_idx
  on public.vehicle_type_module_rules (vehicle_type_id, module_code);

drop trigger if exists vehicle_type_module_rules_stamps on public.vehicle_type_module_rules;
create trigger vehicle_type_module_rules_stamps
  before insert on public.vehicle_type_module_rules
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_type_module_rules_type_scope on public.vehicle_type_module_rules;
create trigger vehicle_type_module_rules_type_scope
  before insert or update on public.vehicle_type_module_rules
  for each row execute function private.tg_type_belongs_to_org();

drop trigger if exists vehicle_type_module_rules_audit on public.vehicle_type_module_rules;
create trigger vehicle_type_module_rules_audit
  after insert or update or delete on public.vehicle_type_module_rules
  for each row execute function private.tg_audit();

-- Duas vigências da mesma regra não podem se sobrepor: a consulta histórica
-- precisa de uma resposta só para cada data.
create or replace function private.tg_module_rule_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.effective_to is not null and new.effective_to < new.effective_from then
    raise exception 'O fim da vigência (%) não pode ser anterior ao início (%).',
      to_char(new.effective_to, 'DD/MM/YYYY'), to_char(new.effective_from, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1 from public.vehicle_type_module_rules r
     where r.organization_id = new.organization_id
       and r.vehicle_type_id = new.vehicle_type_id
       and r.module_code = new.module_code
       and r.capability = new.capability
       and r.id is distinct from new.id
       and daterange(r.effective_from, r.effective_to, '[]')
           && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'Já existe uma regra vigente para este módulo neste período.'
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_module_rule_no_overlap() from public, anon;

drop trigger if exists vehicle_type_module_rules_no_overlap on public.vehicle_type_module_rules;
create trigger vehicle_type_module_rules_no_overlap
  before insert or update on public.vehicle_type_module_rules
  for each row execute function private.tg_module_rule_no_overlap();
