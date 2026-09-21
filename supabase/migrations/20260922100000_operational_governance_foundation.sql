-- =============================================================================
-- ETAPA 08 · GOVERNANÇA OPERACIONAL — A ESTRUTURA
--
-- A hierarquia oficial do HFM já existia até a cidade:
--
--   ORGANIZAÇÃO → OPERAÇÃO → ESTADO → CIDADE
--
-- Esta migration acrescenta os dois degraus que faltavam e as duas perguntas
-- que a gestão faz sobre eles:
--
--   → BR (posição operacional)  → VEÍCULO / MOTORISTA
--
--   "quem responde por isto?"   → leadership_assignments
--   "o que ocupa isto, e quando?" → fidelization_assignments
--
-- Três decisões estruturais, porque são as que custam caro se ficarem erradas:
--
-- 1. NENHUM CADASTRO PARALELO. A liderança é um `employee_id`, o veículo é um
--    `vehicle_id`, o motorista é um `employee_id`, a cidade é uma linha de
--    `operation_cities`. Nada aqui guarda nome, placa ou matrícula como texto —
--    um nome digitado é uma segunda verdade sobre a mesma pessoa.
--
-- 2. A GEOGRAFIA É PROVADA POR CHAVE ESTRANGEIRA, NÃO PELO SELECT DA TELA. Uma
--    BR aponta para `operation_cities.id` e carrega operação, estado e cidade
--    numa única FK composta. Não existe combinação inconsistente representável:
--    uma BR em cidade fora da cobertura da operação é recusada pelo banco,
--    venha ela da tela, de uma RPC ou de um POST direto.
--
-- 3. OCUPAÇÃO É CONSTRAINT, NÃO CONFERÊNCIA. Duas pessoas fidelizando o mesmo
--    veículo em BRs diferentes, ao mesmo tempo, passam por qualquer `select ...
--    where not exists` — as duas transações leem antes de qualquer uma gravar.
--    Aqui isso bate numa EXCLUDE constraint, que é o único mecanismo do
--    PostgreSQL que resolve sobreposição de período com concorrência real.
--
-- ESCRITA. Nenhuma destas tabelas recebe política de INSERT/UPDATE/DELETE. Toda
-- alteração passa pelas rotinas da Etapa 08, que são transacionais, conferem
-- permissão e deixam auditoria — como nas Etapas 06 e 07.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- btree_gist
--
-- Uma EXCLUDE constraint combina tipos: `organization_id with =` (uuid, btree)
-- ao lado de `daterange with &&` (gist). Sem btree_gist o PostgreSQL não sabe
-- indexar o primeiro num índice GiST e a constraint não pode ser criada.
--
-- Alternativa recusada: gatilho com `select ... where overlaps`. Um gatilho lê
-- linhas confirmadas; duas transações simultâneas leem o mesmo "está livre" e
-- gravam as duas. A constraint é a única que segura isso.
-- -----------------------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Chaves candidatas para as FKs compostas
--
-- `operation_cities.id` já é único sozinho; estes índices existem para que uma
-- FK possa exigir, numa linha só, que o id apontado seja daquele tenant, seja
-- daquela operação e carregue aquele estado e aquela cidade. É o que impede a
-- BR de ter `operation_city_id` de uma cidade e `city_id` de outra.
-- -----------------------------------------------------------------------------
alter table public.operation_cities
  drop constraint if exists operation_cities_identity_key;
alter table public.operation_cities
  add constraint operation_cities_identity_key
  unique (id, organization_id, operation_id);

alter table public.operation_cities
  drop constraint if exists operation_cities_geography_key;
alter table public.operation_cities
  add constraint operation_cities_geography_key
  unique (id, organization_id, operation_id, state_id, city_id);

-- =============================================================================
-- operation_brs — a posição operacional
--
-- BR é o degrau abaixo da cidade: uma posição de negócio identificada por um
-- código que a operação conhece. O código NÃO é único no mundo: duas operações
-- podem ter a sua "001", e duas cidades da mesma operação também. A identidade
-- técnica é `operation_brs.id` e é ela que todo o resto referencia.
-- =============================================================================
create table if not exists public.operation_brs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,

  -- Os quatro juntos são provados pela FK composta lá embaixo. Ficam aqui
  -- desnormalizados porque filtrar BRs por operação ou por cidade é o que a
  -- tela faz o tempo todo, e um join a mais em cada filtro não se paga.
  operation_id      uuid not null,
  operation_city_id uuid not null,
  state_id          smallint not null,
  city_id           integer not null,

  code              text not null,
  description       text,
  status            text not null default 'active',
  notes             text,

  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users (id) on delete set null,

  constraint operation_brs_status_check
    check (status in ('active', 'inactive')),
  constraint operation_brs_code_check
    check (private.normalize_code(code) is not null and length(code) <= 40),
  constraint operation_brs_description_check
    check (description is null or length(description) <= 240),
  constraint operation_brs_notes_check
    check (notes is null or length(notes) <= 2000),

  -- Chaves candidatas para quem referencia uma BR provando o tenant junto.
  constraint operation_brs_org_id_key unique (organization_id, id),
  constraint operation_brs_city_id_key unique (id, organization_id, operation_city_id),

  -- Uma FK, quatro garantias: a cidade existe na cobertura, é deste tenant, é
  -- desta operação e é exatamente este estado e este município.
  constraint operation_brs_coverage_fkey
    foreign key (operation_city_id, organization_id, operation_id, state_id, city_id)
    references public.operation_cities (id, organization_id, operation_id, state_id, city_id)
    on delete restrict
);

-- §32: o código não se repete dentro da mesma organização + operação + cidade.
-- Comparado já normalizado, porque " 001 " e "001" são a mesma BR para quem
-- digita, e duas linhas para o banco se a comparação for crua.
create unique index if not exists operation_brs_code_key
  on public.operation_brs (organization_id, operation_id, city_id, private.normalize_code(code))
  where deleted_at is null;

create index if not exists operation_brs_operation_idx
  on public.operation_brs (organization_id, operation_id, status) where deleted_at is null;
create index if not exists operation_brs_city_idx
  on public.operation_brs (organization_id, city_id) where deleted_at is null;
create index if not exists operation_brs_code_search_idx
  on public.operation_brs using gin (private.normalize_code(code) extensions.gin_trgm_ops)
  where deleted_at is null;

comment on table public.operation_brs is
  'Posições operacionais (BR) — fonte única da verdade. O código é único apenas dentro de organização + operação + cidade; a identidade é operation_brs.id.';
comment on column public.operation_brs.operation_city_id is
  'Cidade da cobertura da operação. A FK composta prova operação, estado e município de uma vez — não existe BR fora da cobertura.';

drop trigger if exists operation_brs_set_stamps on public.operation_brs;
create trigger operation_brs_set_stamps
  before insert or update on public.operation_brs
  for each row execute function private.tg_set_stamps();

drop trigger if exists operation_brs_prevent_tenant_change on public.operation_brs;
create trigger operation_brs_prevent_tenant_change
  before update on public.operation_brs
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists operation_brs_guard_soft_delete on public.operation_brs;
create trigger operation_brs_guard_soft_delete
  before insert or update on public.operation_brs
  for each row execute function private.tg_guard_soft_delete('fidelization.manage_brs');

drop trigger if exists operation_brs_audit on public.operation_brs;
create trigger operation_brs_audit
  after insert or update or delete on public.operation_brs
  for each row execute function private.tg_audit();

-- =============================================================================
-- leadership_assignments — quem responde pelo quê, e desde quando
--
-- §11: uma liderança É um colaborador. Não há nome, matrícula nem cargo aqui;
-- há `employee_id`, e tudo o mais se lê no cadastro mestre.
--
-- §12 e §28: estar nesta tabela não concede absolutamente nada no HFM. O acesso
-- continua vindo de role, permissions e escopos. Esta tabela é um fato
-- operacional, não uma credencial — e é por isso que nenhuma rotina da Etapa 08
-- escreve em membership_roles, roles ou employee_assignments.
-- =============================================================================
create table if not exists public.leadership_assignments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  employee_id         uuid not null,

  scope_level         text not null,
  operation_id        uuid not null,
  operation_city_id   uuid,
  operation_br_id     uuid,

  responsibility_type text not null default 'principal',
  -- Derivado, não digitado: is_primary e responsibility_type nunca discordam
  -- porque só existe um lugar onde o valor é decidido.
  is_primary          boolean generated always as (responsibility_type = 'principal') stored,

  effective_from      date not null default current_date,
  effective_to        date,

  status              text not null default 'active',
  notes               text,
  end_reason          text,

  -- A identidade do escopo, em uma coluna, para a EXCLUDE constraint poder
  -- compará-la com `=`. Escopos de níveis diferentes nunca colidem entre si.
  scope_key           text generated always as (
    scope_level || ':' ||
    coalesce(operation_br_id::text, operation_city_id::text, operation_id::text)
  ) stored,

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,

  constraint leadership_scope_level_check
    check (scope_level in ('operation', 'city', 'br')),
  constraint leadership_responsibility_check
    check (responsibility_type in ('principal', 'substitute', 'support')),
  -- 'cancelled' existe para o caso que 'ended' não sabe representar: uma
  -- designação substituída antes de valer um único dia. Datá-la seria mentir
  -- (ela nunca vigorou) e apagá-la seria perder o fato de que alguém a criou.
  constraint leadership_status_check
    check (status in ('active', 'ended', 'cancelled')),

  -- §13: o nível diz exatamente quais vínculos existem. Sem isto seria possível
  -- gravar uma responsabilidade "por operação" carregando uma BR que ninguém lê.
  constraint leadership_scope_shape_check check (
    (scope_level = 'operation' and operation_city_id is null and operation_br_id is null)
    or (scope_level = 'city'   and operation_city_id is not null and operation_br_id is null)
    or (scope_level = 'br'     and operation_city_id is not null and operation_br_id is not null)
  ),
  constraint leadership_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint leadership_notes_check
    check (notes is null or length(notes) <= 2000),
  constraint leadership_end_reason_check
    check (end_reason is null or length(end_reason) <= 500),
  -- Encerrar é datar o fim — e cancelar também. Uma linha fora de 'active' sem
  -- data de fim seria uma vigência aberta que toda consulta por dia continuaria
  -- devolvendo, para sempre. Um cancelamento grava effective_to = effective_from:
  -- o dia em que foi criado e desfeito, e nada além disso.
  constraint leadership_dated_when_not_active_check
    check (status = 'active' or effective_to is not null),

  constraint leadership_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint leadership_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,
  constraint leadership_city_fkey
    foreign key (operation_city_id, organization_id, operation_id)
    references public.operation_cities (id, organization_id, operation_id) on delete restrict,
  constraint leadership_br_fkey
    foreign key (operation_br_id, organization_id, operation_city_id)
    references public.operation_brs (id, organization_id, operation_city_id) on delete restrict,

  -- §15 e §17: um responsável principal por escopo e por dia. Duas designações
  -- simultâneas para a mesma BR fariam a pergunta "quem responde por isto hoje"
  -- ter duas respostas — que é exatamente a pergunta que o módulo existe para
  -- responder.
  --
  -- O predicado exclui apenas o que foi cancelado, NÃO o que foi encerrado. Um
  -- vínculo encerrado continua ocupando exatamente os dias que ocupou, e é isso
  -- que impede a correção retroativa silenciosa: estender o fim de A para além
  -- do início de B faria os dois responderem pelo dia 20, e aqui isso é
  -- recusado. Só o cancelado — que por definição não vigorou — sai do índice.
  constraint leadership_primary_no_overlap exclude using gist (
    organization_id with =,
    scope_key with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (responsibility_type = 'principal' and status <> 'cancelled')
);

create index if not exists leadership_employee_idx
  on public.leadership_assignments (organization_id, employee_id, effective_from desc);
create index if not exists leadership_operation_idx
  on public.leadership_assignments (organization_id, operation_id, effective_from desc);
create index if not exists leadership_city_idx
  on public.leadership_assignments (organization_id, operation_city_id) where operation_city_id is not null;
create index if not exists leadership_br_idx
  on public.leadership_assignments (organization_id, operation_br_id) where operation_br_id is not null;
create index if not exists leadership_period_idx
  on public.leadership_assignments using gist (daterange(effective_from, effective_to, '[]'));

comment on table public.leadership_assignments is
  'Responsabilidade operacional por operação, cidade ou BR, com vigência. NÃO concede acesso: o Perfil de Acesso HFM continua vindo de roles e permissions (§12, §28).';
comment on column public.leadership_assignments.effective_to is
  'Último dia da responsabilidade, inclusivo — como em employee_assignments e vehicle_operation_assignments. "01/09 a 15/09" grava 15/09.';

drop trigger if exists leadership_set_stamps on public.leadership_assignments;
create trigger leadership_set_stamps
  before insert or update on public.leadership_assignments
  for each row execute function private.tg_set_stamps();

drop trigger if exists leadership_prevent_tenant_change on public.leadership_assignments;
create trigger leadership_prevent_tenant_change
  before update on public.leadership_assignments
  for each row execute function private.tg_prevent_tenant_change();

-- §25: histórico não se apaga. DELETE é recusado pelo banco, não pela tela.
drop trigger if exists leadership_block_delete on public.leadership_assignments;
create trigger leadership_block_delete
  before delete on public.leadership_assignments
  for each row execute function private.tg_block_mutation();

drop trigger if exists leadership_audit on public.leadership_assignments;
create trigger leadership_audit
  after insert or update or delete on public.leadership_assignments
  for each row execute function private.tg_audit();

-- =============================================================================
-- fidelization_assignments — que veículo ocupa a posição, e em que dias
--
-- §38 é o ponto crítico desta etapa: isto NÃO é alocação operacional. Um
-- veículo alocado em Last Mile MG / Contagem pode ser fidelizado numa BR por
-- duas semanas sem que a sua operação ou cidade mudem. São duas perguntas
-- diferentes e continuam em duas tabelas diferentes; nada aqui escreve em
-- vehicle_operation_assignments.
-- =============================================================================
create table if not exists public.fidelization_assignments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  operation_br_id     uuid not null,
  vehicle_id          uuid not null,

  vehicle_role        text not null default 'primary',
  start_date          date not null,
  end_date            date,

  status              text not null default 'planned',
  source              text not null default 'manual',
  reason              text,

  -- §44 e §49: uma substituição não é um vínculo solto. Apontar para o vínculo
  -- encerrado é o que permite desenhar "trocou de veículo" em vez de "acabou um
  -- período e começou outro".
  replaces_assignment_id uuid references public.fidelization_assignments (id) on delete set null,

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,

  constraint fidelization_role_check
    check (vehicle_role in ('primary', 'support')),
  -- §45: planejado não é executado. O estado nasce em 'planned' e só sai daí
  -- quando existir origem confiável de confirmação.
  constraint fidelization_status_check
    check (status in ('planned', 'confirmed', 'executed', 'cancelled')),
  constraint fidelization_source_check
    check (source in ('manual', 'import', 'substitution', 'inversion')),
  constraint fidelization_period_check
    check (end_date is null or end_date >= start_date),
  constraint fidelization_reason_check
    check (reason is null or length(reason) <= 500),

  constraint fidelization_org_id_key unique (organization_id, id),

  constraint fidelization_br_fkey
    foreign key (organization_id, operation_br_id)
    references public.operation_brs (organization_id, id) on delete restrict,
  constraint fidelization_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,

  -- §47, primeira metade: uma BR não tem dois veículos principais no mesmo dia.
  constraint fidelization_br_occupancy exclude using gist (
    operation_br_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (vehicle_role = 'primary' and status <> 'cancelled'),

  -- §47, segunda metade: um veículo não está em duas BRs no mesmo dia. A
  -- constraint é por veículo e não por veículo+BR justamente porque o conflito
  -- que interessa é entre BRs diferentes.
  constraint fidelization_vehicle_occupancy exclude using gist (
    vehicle_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'cancelled')
);

create index if not exists fidelization_br_idx
  on public.fidelization_assignments (organization_id, operation_br_id, start_date desc);
create index if not exists fidelization_vehicle_idx
  on public.fidelization_assignments (organization_id, vehicle_id, start_date desc);
create index if not exists fidelization_period_idx
  on public.fidelization_assignments using gist (daterange(start_date, end_date, '[]'));

comment on table public.fidelization_assignments is
  'Ocupação de uma BR por um veículo durante um período. Conceito distinto de vehicle_operation_assignments: fidelizar não transfere a operação nem a cidade do veículo (§38).';
comment on column public.fidelization_assignments.end_date is
  'Último dia do vínculo, inclusivo. Nulo significa vínculo aberto.';

drop trigger if exists fidelization_set_stamps on public.fidelization_assignments;
create trigger fidelization_set_stamps
  before insert or update on public.fidelization_assignments
  for each row execute function private.tg_set_stamps();

drop trigger if exists fidelization_prevent_tenant_change on public.fidelization_assignments;
create trigger fidelization_prevent_tenant_change
  before update on public.fidelization_assignments
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists fidelization_block_delete on public.fidelization_assignments;
create trigger fidelization_block_delete
  before delete on public.fidelization_assignments
  for each row execute function private.tg_block_mutation();

drop trigger if exists fidelization_audit on public.fidelization_assignments;
create trigger fidelization_audit
  after insert or update or delete on public.fidelization_assignments
  for each row execute function private.tg_audit();

-- =============================================================================
-- fidelization_drivers — quem dirige, quando
--
-- §40: entidade associativa, não dois campos de texto. Uma posição pode ter
-- motorista principal e secundário, e cada um com o seu período dentro do
-- período do vínculo.
-- =============================================================================
create table if not exists public.fidelization_drivers (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete restrict,
  fidelization_assignment_id uuid not null,
  employee_id               uuid not null,

  driver_role               text not null default 'primary',
  start_date                date not null,
  end_date                  date,
  status                    text not null default 'planned',
  reason                    text,

  created_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id) on delete set null,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null,

  constraint fidelization_drivers_role_check
    check (driver_role in ('primary', 'secondary')),
  constraint fidelization_drivers_status_check
    check (status in ('planned', 'confirmed', 'executed', 'cancelled')),
  constraint fidelization_drivers_period_check
    check (end_date is null or end_date >= start_date),
  constraint fidelization_drivers_reason_check
    check (reason is null or length(reason) <= 500),

  constraint fidelization_drivers_assignment_fkey
    foreign key (organization_id, fidelization_assignment_id)
    references public.fidelization_assignments (organization_id, id) on delete restrict,
  -- §37: o motorista é um colaborador do cadastro mestre. A especialização em
  -- `drivers` é consultada pela tela; a identidade é o employee_id.
  constraint fidelization_drivers_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,

  -- §53: um motorista não dirige duas posições no mesmo dia. A restrição é só
  -- sobre o papel que consome o dia da pessoa — espelhando
  -- fidelization_br_occupancy, que também só olha o 'primary'. Um reserva
  -- listado como secundário em cinco BRs da mesma cidade é a escala normal de
  -- backup, não um conflito, e uma constraint que a proibisse tornaria o
  -- planejamento de reserva impossível de representar.
  constraint fidelization_drivers_occupancy exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (driver_role = 'primary' and status <> 'cancelled'),

  -- E o espelho de fidelization_br_occupancy: a posição tem um motorista
  -- principal por dia. Sem esta, duas pessoas diferentes podiam ser a titular
  -- do mesmo veículo no mesmo dia — e a escala não teria como estar certa.
  constraint fidelization_drivers_primary_occupancy exclude using gist (
    fidelization_assignment_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (driver_role = 'primary' and status <> 'cancelled')
);

create index if not exists fidelization_drivers_assignment_idx
  on public.fidelization_drivers (organization_id, fidelization_assignment_id);
create index if not exists fidelization_drivers_employee_idx
  on public.fidelization_drivers (organization_id, employee_id, start_date desc);

comment on table public.fidelization_drivers is
  'Motoristas planejados para um vínculo de fidelização, por período. Usa employee_id do cadastro mestre; vincular alguém aqui não cria conta nem altera Perfil de Acesso.';

-- O período do motorista não pode sair do período do vínculo: uma FK não sabe
-- comparar datas, e um motorista planejado para depois do fim da fidelização é
-- um planejamento que nenhuma tela conseguiria mostrar.
create or replace function private.tg_fidelization_driver_within_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end   date;
begin
  -- Cancelar um motorista é justamente dizer que ele não vale mais naqueles
  -- dias. Exigir que um registro cancelado caiba no período do vínculo fazia a
  -- limpeza das próprias rotinas — encurtar a fidelização e cancelar quem
  -- ficou de fora — abortar a transação inteira.
  if new.status = 'cancelled' then
    return new;
  end if;

  -- `for share` e não um select solto: sem o lock, encurtar o vínculo numa
  -- transação enquanto outra insere um motorista deixa as duas passarem, cada
  -- uma lendo um período que a outra já mudou.
  select start_date, end_date into v_start, v_end
    from public.fidelization_assignments
   where id = new.fidelization_assignment_id
   for share;

  if new.start_date < v_start then
    raise exception 'O motorista não pode começar (%) antes do início da fidelização (%).',
      to_char(new.start_date, 'DD/MM/YYYY'), to_char(v_start, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  if v_end is not null and (new.end_date is null or new.end_date > v_end) then
    raise exception 'O motorista não pode terminar depois do fim da fidelização (%).',
      to_char(v_end, 'DD/MM/YYYY')
      using errcode = 'invalid_parameter_value';
  end if;

  return new;
end;
$$;

revoke execute on function private.tg_fidelization_driver_within_assignment() from public, anon;

drop trigger if exists fidelization_drivers_within_assignment on public.fidelization_drivers;
create trigger fidelization_drivers_within_assignment
  before insert or update on public.fidelization_drivers
  for each row execute function private.tg_fidelization_driver_within_assignment();

drop trigger if exists fidelization_drivers_set_stamps on public.fidelization_drivers;
create trigger fidelization_drivers_set_stamps
  before insert or update on public.fidelization_drivers
  for each row execute function private.tg_set_stamps();

drop trigger if exists fidelization_drivers_prevent_tenant_change on public.fidelization_drivers;
create trigger fidelization_drivers_prevent_tenant_change
  before update on public.fidelization_drivers
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists fidelization_drivers_block_delete on public.fidelization_drivers;
create trigger fidelization_drivers_block_delete
  before delete on public.fidelization_drivers
  for each row execute function private.tg_block_mutation();

drop trigger if exists fidelization_drivers_audit on public.fidelization_drivers;
create trigger fidelization_drivers_audit
  after insert or update or delete on public.fidelization_drivers
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- A invariante pai/filho vale nas duas direções
--
-- O gatilho acima protege a inserção do motorista. Faltava a direção oposta: um
-- vínculo de fidelização encurtado, movido ou cancelado deixa os seus motoristas
-- planejados para dias que já não existem — e é exatamente o que uma
-- substituição faz, que é a escrita mais comum do módulo.
--
-- É um CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED de propósito: as rotinas
-- da Etapa 08 encurtam o vínculo e ajustam os motoristas na mesma transação, e
-- um gatilho imediato dispararia no meio desse ajuste, contra um estado que a
-- própria rotina ia consertar duas linhas adiante. Verificar no commit cobre
-- todos os caminhos — inclusive os que ainda não existem — sem atrapalhar
-- nenhum deles.
-- -----------------------------------------------------------------------------
create or replace function private.tg_fidelization_children_within_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad record;
begin
  select d.id, d.start_date, d.end_date
    into v_bad
    from public.fidelization_drivers d
   where d.fidelization_assignment_id = new.id
     and d.status <> 'cancelled'
     and (
       new.status = 'cancelled'
       or d.start_date < new.start_date
       or (new.end_date is not null and (d.end_date is null or d.end_date > new.end_date))
     )
   limit 1;

  if v_bad.id is not null then
    if new.status = 'cancelled' then
      raise exception 'Este vínculo ainda possui motorista planejado. Encerre o motorista antes de cancelar a fidelização.'
        using errcode = 'invalid_parameter_value';
    end if;
    raise exception 'O período do vínculo (% a %) não cobre o motorista planejado de % a %.',
      to_char(new.start_date, 'DD/MM/YYYY'),
      coalesce(to_char(new.end_date, 'DD/MM/YYYY'), 'sem fim'),
      to_char(v_bad.start_date, 'DD/MM/YYYY'),
      coalesce(to_char(v_bad.end_date, 'DD/MM/YYYY'), 'sem fim')
      using errcode = 'invalid_parameter_value';
  end if;

  return null;
end;
$$;

revoke execute on function private.tg_fidelization_children_within_period() from public, anon;

drop trigger if exists fidelization_children_within_period on public.fidelization_assignments;
create constraint trigger fidelization_children_within_period
  after update on public.fidelization_assignments
  deferrable initially deferred
  for each row execute function private.tg_fidelization_children_within_period();
