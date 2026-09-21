-- =============================================================================
-- ETAPA 09 · FILIAIS
--
-- `organization_units` já existia desde a fundação e já é referenciada por
-- `employees` (via `employee_assignments.organization_unit_id`), por `vehicles`,
-- por `drivers`, por `cost_centers` e por `work_locations`. Criar uma tabela
-- `filiais` ao lado dela seria o cadastro concorrente que a §10 proíbe: duas
-- respostas para "de que filial é este veículo", e a primeira divergência entre
-- elas seria descoberta por um relatório errado.
--
-- Esta migration ESTENDE a tabela existente. Nenhum `id` muda, nenhum vínculo
-- se perde, e tudo que hoje aponta para uma unidade continua apontando para a
-- mesma linha.
--
-- QUATRO DISTINÇÕES QUE O MODELO PRECISA MANTER (§7, §8, §33):
--
--   Organização  quem é dona dos dados
--   Filial       a unidade organizacional responsável — o que esta etapa cadastra
--   Operação     a unidade de organização operacional (Last Mile MG, Merchandising)
--   Estado/Cidade duas coisas diferentes conforme o contexto:
--                  · endereço FÍSICO da filial (aqui)
--                  · cobertura GEOGRÁFICA da operação (Etapa 04, `operation_cities`)
--
-- O endereço da filial NÃO define a cobertura de operação nenhuma. São colunas
-- diferentes, em tabelas diferentes, e nada nesta migration liga uma à outra.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.is_valid_cnpj
--
-- Mesmo espírito de `private.is_valid_cpf`, que já existe: dígitos, tamanho e
-- os dois dígitos verificadores. Um CNPJ com o tamanho certo e o dígito errado
-- é um erro de digitação que só aparece meses depois, numa nota fiscal.
--
-- Aceita apenas o formato numérico vigente. O CNPJ alfanumérico previsto para
-- 2026 tem outro algoritmo e entra quando houver regra publicada para seguir —
-- inventar a validação dele agora seria pior do que recusá-lo.
-- -----------------------------------------------------------------------------
create or replace function private.is_valid_cnpj(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  v_weights integer[];
  v_sum   integer;
  v_check integer;
  i       integer;
  pass    integer;
begin
  if length(v_digits) <> 14 then return false; end if;
  -- 00000000000000, 11111111111111 e afins passam no algoritmo e não existem.
  if v_digits ~ '^(\d)\1{13}$' then return false; end if;

  for pass in 0..1 loop
    if pass = 0 then
      v_weights := array[5,4,3,2,9,8,7,6,5,4,3,2];
    else
      v_weights := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
    end if;

    v_sum := 0;
    for i in 1..array_length(v_weights, 1) loop
      v_sum := v_sum + substr(v_digits, i, 1)::integer * v_weights[i];
    end loop;

    v_check := v_sum % 11;
    if v_check < 2 then v_check := 0; else v_check := 11 - v_check; end if;

    if v_check <> substr(v_digits, 12 + pass + 1, 1)::integer then return false; end if;
  end loop;

  return true;
end;
$$;

revoke execute on function private.is_valid_cnpj(text) from public, anon;
grant  execute on function private.is_valid_cnpj(text) to authenticated;

comment on function private.is_valid_cnpj(text) is
  'Valida um CNPJ numérico: 14 dígitos, não repetidos, com os dois dígitos verificadores corretos.';

-- -----------------------------------------------------------------------------
-- As colunas novas de organization_units
-- -----------------------------------------------------------------------------
alter table public.organization_units
  add column if not exists unit_type       text not null default 'branch',
  add column if not exists legal_name      text,
  add column if not exists document_number text,
  add column if not exists notes           text,
  -- Por que a filial foi inativada ou reativada. Coluna própria, e não uma
  -- linha empurrada dentro de Observações: Observações é campo livre do
  -- usuário, e um motivo de inativação guardado ali pode ser apagado por quem
  -- estiver editando o endereço, sem perceber o que apagou (§20).
  add column if not exists status_reason   text,
  -- Endereço físico. Não existe tabela de endereços reutilizável no HFM, e
  -- criar uma para uma única entidade seria infraestrutura sem segundo usuário.
  -- Se um dia outra entidade precisar de endereço, estas colunas migram juntas.
  add column if not exists postal_code     text,
  add column if not exists street          text,
  add column if not exists street_number   text,
  add column if not exists complement      text,
  add column if not exists district        text,
  add column if not exists state_id        smallint,
  add column if not exists city_id         integer;

comment on column public.organization_units.unit_type is
  'Tipo da unidade. Hoje toda unidade é uma filial; a coluna existe para o dia em que houver outro tipo, e não para ser preenchida com variações do mesmo conceito.';
comment on column public.organization_units.document_number is
  'CNPJ em dígitos, sem máscara. Nulo para unidade operacional sem inscrição própria (§15).';
comment on column public.organization_units.city_id is
  'Município do ENDEREÇO FÍSICO da filial. Não tem relação nenhuma com a cobertura geográfica das operações vinculadas (§18).';

-- -----------------------------------------------------------------------------
-- Regras
-- -----------------------------------------------------------------------------
alter table public.organization_units
  drop constraint if exists organization_units_unit_type_check;
alter table public.organization_units
  add constraint organization_units_unit_type_check
  check (unit_type in ('branch', 'headquarters', 'operational'));

alter table public.organization_units
  drop constraint if exists organization_units_legal_name_check;
alter table public.organization_units
  add constraint organization_units_legal_name_check
  check (legal_name is null or length(btrim(legal_name)) between 1 and 200);

-- §15: armazenado só em dígitos, e um CNPJ inválido nunca é um registro válido.
alter table public.organization_units
  drop constraint if exists organization_units_document_check;
alter table public.organization_units
  add constraint organization_units_document_check
  check (document_number is null or private.is_valid_cnpj(document_number));

alter table public.organization_units
  drop constraint if exists organization_units_document_digits_check;
alter table public.organization_units
  add constraint organization_units_document_digits_check
  check (document_number is null or document_number ~ '^[0-9]{14}$');

alter table public.organization_units
  drop constraint if exists organization_units_notes_check;
alter table public.organization_units
  add constraint organization_units_notes_check
  check (notes is null or length(notes) <= 2000);

alter table public.organization_units
  drop constraint if exists organization_units_status_reason_check;
alter table public.organization_units
  add constraint organization_units_status_reason_check
  check (status_reason is null or length(status_reason) <= 500);

alter table public.organization_units
  drop constraint if exists organization_units_postal_code_check;
alter table public.organization_units
  add constraint organization_units_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{8}$');

alter table public.organization_units
  drop constraint if exists organization_units_address_text_check;
alter table public.organization_units
  add constraint organization_units_address_text_check
  check (
    (street        is null or length(street)        <= 200) and
    (street_number is null or length(street_number) <= 20)  and
    (complement    is null or length(complement)    <= 120) and
    (district      is null or length(district)      <= 120)
  );

-- O município tem de ser daquele estado. A cidade sozinha não é ambígua, mas a
-- tela grava os dois e um par inconsistente é o tipo de erro que só aparece
-- quando alguém filtra por UF e a filial some.
alter table public.organization_units
  drop constraint if exists organization_units_city_fkey;
alter table public.organization_units
  add constraint organization_units_city_fkey
  foreign key (city_id, state_id) references public.cities (id, state_id) on delete restrict;

alter table public.organization_units
  drop constraint if exists organization_units_city_needs_state_check;
alter table public.organization_units
  add constraint organization_units_city_needs_state_check
  check (city_id is null or state_id is not null);

-- §12: único dentro da organização, e só dentro dela. Duas organizações
-- independentes podem ter, cada uma, a sua filial 87.
--
-- Comparado por `normalize_code`, que só apara e sobe a caixa — os zeros à
-- esquerda continuam significando o que significam: "087" e "87" são códigos
-- diferentes, e é assim que a frota escreve.
create unique index if not exists organization_units_code_key
  on public.organization_units (organization_id, private.normalize_code(code))
  where deleted_at is null and code is not null;

-- §16: unicidade do CNPJ dentro da organização, nunca global — duas
-- organizações independentes podem legitimamente representar a mesma entidade
-- jurídica —, e apenas entre as unidades que SÃO entidades jurídicas.
--
-- Uma base operacional sem inscrição própria fatura sob o CNPJ da matriz, e a
-- §15 é explícita em não exigir CNPJ exclusivo dessas unidades. Se a unicidade
-- valesse para todas, cadastrar a segunda base de uma matriz seria impossível.
-- `unit_type = 'operational'` é o que marca essa unidade, e ela fica de fora.
create unique index if not exists organization_units_document_key
  on public.organization_units (organization_id, document_number)
  where deleted_at is null
    and document_number is not null
    and unit_type in ('branch', 'headquarters');

create index if not exists organization_units_city_idx
  on public.organization_units (organization_id, city_id) where deleted_at is null;
create index if not exists organization_units_status_idx
  on public.organization_units (organization_id, status) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Gatilhos que a tabela ainda não tinha
-- -----------------------------------------------------------------------------
drop trigger if exists organization_units_prevent_tenant_change on public.organization_units;
create trigger organization_units_prevent_tenant_change
  before update on public.organization_units
  for each row execute function private.tg_prevent_tenant_change();

-- §53: exclusão física bloqueada. Arquivar é `deleted_at`; apagar a linha
-- deixaria colaboradores e veículos apontando para o nada.
drop trigger if exists organization_units_block_delete on public.organization_units;
create trigger organization_units_block_delete
  before delete on public.organization_units
  for each row execute function private.tg_block_mutation();

-- =============================================================================
-- organization_unit_operations — quais operações a filial atende, e desde quando
--
-- §21: muitas operações por filial e muitas filiais por operação. §27: quando o
-- vínculo termina, o histórico continua respondendo pelos meses em que valeu —
-- um relatório de agosto tem de continuar reconhecendo a associação de agosto.
-- =============================================================================
create table if not exists public.organization_unit_operations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  organization_unit_id uuid not null,
  operation_id         uuid not null,

  effective_from       date not null default current_date,
  effective_to         date,
  notes                text,

  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,

  constraint unit_operations_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint unit_operations_notes_check
    check (notes is null or length(notes) <= 500),

  -- §23: as duas FKs carregam `organization_id`, então uma filial da
  -- Organização A não alcança uma operação da Organização B nem com os ids
  -- montados à mão. A validação não depende do que o front-end enviou.
  constraint unit_operations_unit_fkey
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict,
  constraint unit_operations_operation_fkey
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete restrict,

  -- §55: a mesma filial não atende a mesma operação duas vezes ao mesmo tempo.
  constraint unit_operations_no_overlap exclude using gist (
    organization_unit_id with =,
    operation_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index if not exists unit_operations_unit_idx
  on public.organization_unit_operations (organization_id, organization_unit_id);
create index if not exists unit_operations_operation_idx
  on public.organization_unit_operations (organization_id, operation_id);
create index if not exists unit_operations_current_idx
  on public.organization_unit_operations (organization_unit_id) where effective_to is null;

comment on table public.organization_unit_operations is
  'Operações atendidas por cada filial, com vigência. Desvincular data o fim; o histórico nunca é apagado (§27).';

drop trigger if exists unit_operations_set_stamps on public.organization_unit_operations;
create trigger unit_operations_set_stamps
  before insert or update on public.organization_unit_operations
  for each row execute function private.tg_set_stamps();

drop trigger if exists unit_operations_prevent_tenant_change on public.organization_unit_operations;
create trigger unit_operations_prevent_tenant_change
  before update on public.organization_unit_operations
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists unit_operations_block_delete on public.organization_unit_operations;
create trigger unit_operations_block_delete
  before delete on public.organization_unit_operations
  for each row execute function private.tg_block_mutation();

drop trigger if exists unit_operations_audit on public.organization_unit_operations;
create trigger unit_operations_audit
  after insert or update or delete on public.organization_unit_operations
  for each row execute function private.tg_audit();

-- =============================================================================
-- vehicle_unit_assignments — de que filial o veículo é, e desde quando
--
-- §34 é explícito: uma transferência real de responsabilidade entre filiais
-- registra filial anterior, nova filial, início, fim do vínculo anterior, motivo
-- e responsável. Sobrescrever `vehicles.organization_unit_id` apagaria cinco
-- dessas seis informações.
--
-- A coluna em `vehicles` continua existindo e continua sendo a filial atual —
-- ela é mantida em sincronia pela rotina de transferência. É desnormalização
-- deliberada: a listagem de frota filtra por filial o tempo todo.
-- =============================================================================
create table if not exists public.vehicle_unit_assignments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete restrict,
  vehicle_id           uuid not null,
  organization_unit_id uuid not null,

  effective_from       date not null default current_date,
  effective_to         date,
  reason               text,

  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,

  constraint vehicle_unit_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint vehicle_unit_reason_check
    check (reason is null or length(reason) <= 500),

  constraint vehicle_unit_vehicle_fkey
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint vehicle_unit_unit_fkey
    foreign key (organization_id, organization_unit_id)
    references public.organization_units (organization_id, id) on delete restrict,

  -- Um veículo pertence a uma filial de cada vez.
  constraint vehicle_unit_no_overlap exclude using gist (
    vehicle_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

create index if not exists vehicle_unit_vehicle_idx
  on public.vehicle_unit_assignments (vehicle_id, effective_from desc);
create index if not exists vehicle_unit_unit_idx
  on public.vehicle_unit_assignments (organization_id, organization_unit_id) where effective_to is null;

comment on table public.vehicle_unit_assignments is
  'Responsabilidade de cada veículo por filial, com vigência e motivo. A filial atual também fica em vehicles.organization_unit_id, mantida pela rotina de transferência.';

drop trigger if exists vehicle_unit_set_stamps on public.vehicle_unit_assignments;
create trigger vehicle_unit_set_stamps
  before insert or update on public.vehicle_unit_assignments
  for each row execute function private.tg_set_stamps();

drop trigger if exists vehicle_unit_prevent_tenant_change on public.vehicle_unit_assignments;
create trigger vehicle_unit_prevent_tenant_change
  before update on public.vehicle_unit_assignments
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists vehicle_unit_block_delete on public.vehicle_unit_assignments;
create trigger vehicle_unit_block_delete
  before delete on public.vehicle_unit_assignments
  for each row execute function private.tg_block_mutation();

drop trigger if exists vehicle_unit_audit on public.vehicle_unit_assignments;
create trigger vehicle_unit_audit
  after insert or update or delete on public.vehicle_unit_assignments
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- O que já existe vira histórico
--
-- Os veículos que hoje têm `organization_unit_id` preenchido ganham a linha de
-- vigência correspondente, aberta, datada do cadastro do veículo. Sem isto o
-- histórico começaria vazio e a filial atual de cada veículo não teria como ser
-- explicada.
-- -----------------------------------------------------------------------------
insert into public.vehicle_unit_assignments
  (organization_id, vehicle_id, organization_unit_id, effective_from, reason)
select v.organization_id, v.id, v.organization_unit_id,
       coalesce(v.created_at::date, current_date),
       'Vínculo inicial, registrado a partir do cadastro do veículo.'
  from public.vehicles v
 where v.organization_unit_id is not null
   and v.deleted_at is null
   and not exists (
     select 1 from public.vehicle_unit_assignments a where a.vehicle_id = v.id
   );
