-- =============================================================================
-- ETAPA 07 · TIPOS DE EQUIPAMENTO — FUNDAÇÃO
--
-- NOMENCLATURA. A especificação fala em `equipment_types`. O HFM já tem o
-- mesmo conceito em `vehicle_types`, referenciado por `vehicles.vehicle_type_id`
-- e por `vehicle_subcategories.vehicle_type_id`. Criar `equipment_types` ao
-- lado seria criar exatamente o cadastro concorrente que o §2 proíbe. A tabela
-- existente é evoluída, e "Tipo de Equipamento" é o nome do módulo na interface.
--
-- ESCOPO. `vehicle_types` nasceu global — seis tipos mantidos pela plataforma.
-- Isso continua: os tipos base são compartilhados por todas as organizações.
-- O que muda é que uma organização passa a poder criar os seus, e é o
-- `organization_id` que separa os dois mundos:
--
--   organization_id is null      catálogo base, mantido pela plataforma
--   organization_id = <org>      tipo da organização, mantido por ela
--
-- Um administrador de organização nunca altera uma linha global (§41). A
-- parametrização operacional — operações, aplicativos, elegibilidade — é
-- sempre por organização, inclusive para os tipos globais, e vive em tabelas
-- próprias.
--
-- CÓDIGO. Os tipos globais mantêm os códigos técnicos que já têm (`truck`,
-- `van`). Os tipos criados por uma organização recebem `EQ-00001`, gerado por
-- um contador atômico — nunca por `MAX() + 1`, que perde a corrida com dois
-- administradores cadastrando ao mesmo tempo. Depois de gravado, o código não
-- muda mais.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `vehicle_types` ganha dono, descrição e ciclo de vida
-- -----------------------------------------------------------------------------
alter table public.vehicle_types
  add column if not exists organization_id uuid references public.organizations (id) on delete restrict,
  add column if not exists description text,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_by uuid references auth.users (id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

comment on column public.vehicle_types.organization_id is
  'Nulo para o catálogo base da plataforma, compartilhado por todas as organizações. Preenchido para um tipo criado pela própria organização.';

alter table public.vehicle_types
  drop constraint if exists vehicle_types_description_check;
alter table public.vehicle_types
  add constraint vehicle_types_description_check
  check (description is null or length(description) <= 500);

-- O código técnico aceita as duas formas que existem de verdade: o slug do
-- catálogo base e o sequencial por organização.
alter table public.vehicle_types drop constraint if exists vehicle_types_code_check;
alter table public.vehicle_types
  add constraint vehicle_types_code_check
  check (code ~ '^[a-z][a-z0-9_]{1,39}$' or code ~ '^EQ-[0-9]{5,10}$');

-- A unicidade global de código deixaria uma organização reservar um código
-- para todas as outras. Passa a valer por escopo.
alter table public.vehicle_types drop constraint if exists vehicle_types_code_key;

create unique index if not exists vehicle_types_global_code_key
  on public.vehicle_types (code) where organization_id is null;
create unique index if not exists vehicle_types_org_code_key
  on public.vehicle_types (organization_id, code) where organization_id is not null;

-- §7: "Van", "van" e "Van " são o mesmo tipo. A comparação é a mesma que o
-- resto do sistema usa, e ignora caixa, espaços repetidos e acentuação.
create unique index if not exists vehicle_types_global_name_key
  on public.vehicle_types (private.normalize_label(name))
  where organization_id is null and deleted_at is null;
create unique index if not exists vehicle_types_org_name_key
  on public.vehicle_types (organization_id, private.normalize_label(name))
  where organization_id is not null and deleted_at is null;

create index if not exists vehicle_types_org_idx
  on public.vehicle_types (organization_id) where deleted_at is null;

-- Necessária para as FKs compostas das tabelas de parametrização.
alter table public.vehicle_types drop constraint if exists vehicle_types_id_org_key;
alter table public.vehicle_types add constraint vehicle_types_id_org_key unique (id, organization_id);

drop trigger if exists vehicle_types_audit on public.vehicle_types;
create trigger vehicle_types_audit
  after insert or update or delete on public.vehicle_types
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 2. O código imutável
--
-- Nada além da rotina de criação escreve `code`. Um UPDATE que o altere é
-- recusado, inclusive vindo de um administrador: o código é a identidade
-- técnica do tipo e outros registros já apontam para ela.
-- -----------------------------------------------------------------------------
create or replace function private.tg_vehicle_type_code_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'O código do tipo de equipamento não pode ser alterado depois de criado.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Um tipo de equipamento não muda de organização.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_vehicle_type_code_immutable() from public, anon;

drop trigger if exists vehicle_types_code_immutable on public.vehicle_types;
create trigger vehicle_types_code_immutable
  before update on public.vehicle_types
  for each row execute function private.tg_vehicle_type_code_immutable();

-- -----------------------------------------------------------------------------
-- 3. Contador de códigos, atômico
--
-- `on conflict do update ... returning` trava a linha do contador e devolve o
-- valor já incrementado. Duas transações simultâneas recebem valores
-- diferentes; a segunda espera a primeira. É a diferença entre um sequencial
-- confiável e dois tipos com o mesmo código (§6).
-- -----------------------------------------------------------------------------
create table if not exists private.entity_code_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope           text not null,
  current_value   bigint not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, scope)
);

create or replace function private.next_entity_code(
  p_organization_id uuid,
  p_scope           text,
  p_prefix          text,
  p_width           integer default 5
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value bigint;
begin
  insert into private.entity_code_counters (organization_id, scope, current_value)
  values (p_organization_id, p_scope, 1)
  on conflict (organization_id, scope) do update
    set current_value = private.entity_code_counters.current_value + 1,
        updated_at = now()
  returning current_value into v_value;

  return p_prefix || lpad(v_value::text, p_width, '0');
end;
$$;

revoke execute on function private.next_entity_code(uuid, text, text, integer) from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Subcategorias: descrição, código e arquivamento
-- -----------------------------------------------------------------------------
alter table public.vehicle_subcategories
  add column if not exists description text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

alter table public.vehicle_subcategories
  drop constraint if exists vehicle_subcategories_description_check;
alter table public.vehicle_subcategories
  add constraint vehicle_subcategories_description_check
  check (description is null or length(description) <= 500);

drop trigger if exists vehicle_subcategories_audit on public.vehicle_subcategories;
create trigger vehicle_subcategories_audit
  after insert or update or delete on public.vehicle_subcategories
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 5. Leitura: o catálogo base é de todos, o tipo da organização é só dela
--
-- A política anterior era `using (true)` — correta enquanto a tabela só tinha
-- linhas globais, e um vazamento no instante em que passasse a ter linhas de
-- organização. Escrita continua fora do alcance de `authenticated`: tipos são
-- criados e alterados pelas rotinas da Etapa 07, que conferem permissão.
-- -----------------------------------------------------------------------------
drop policy if exists vehicle_types_select on public.vehicle_types;
create policy vehicle_types_select on public.vehicle_types
  for select to authenticated
  using (
    organization_id is null
    or organization_id in (select private.member_org_ids())
  );
