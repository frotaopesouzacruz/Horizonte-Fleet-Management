-- =============================================================================
-- ETAPA 08 · PERMISSÕES, ESCOPO E LEITURA
--
-- Treze permissões (§63), porque as treze coisas são realmente diferentes: quem
-- planeja a fidelização do mês não é necessariamente quem cadastra as posições
-- operacionais, e nenhum dos dois é quem lê a trilha de auditoria.
--
-- ESCOPO. Toda entidade desta etapa pendura numa operação, então o escopo é uma
-- linha só e é a mesma em todos os lugares: `private.can_access_operation`.
-- Quem não alcança a operação não alcança as suas cidades, as suas BRs, as suas
-- fidelizações nem as suas lideranças — e isso vale para a listagem, para o
-- calendário, para os indicadores e para um GET direto no PostgREST.
--
-- ESCRITA. Nenhuma destas tabelas recebe política de INSERT, UPDATE ou DELETE.
-- Toda alteração passa pelas rotinas da Etapa 08, que são transacionais,
-- conferem permissão e deixam auditoria. Uma política de escrita aqui seria uma
-- segunda porta para o mesmo dado, sem nenhuma dessas garantias.
-- =============================================================================

insert into public.permissions (code, module, name, description) values
  ('leadership.view',            'leadership', 'Ver lideranças',
   'Consultar responsáveis por operação, cidade e BR, e o histórico de vigências'),
  ('leadership.manage',          'leadership', 'Gerenciar lideranças',
   'Criar, editar e encerrar vínculos de responsabilidade operacional'),
  ('leadership.assign',          'leadership', 'Designar responsáveis',
   'Escolher o colaborador responsável por um escopo operacional'),
  ('leadership.replicate',       'leadership', 'Replicar competências',
   'Copiar o planejamento de lideranças de uma competência para outra'),
  ('leadership.audit',           'leadership', 'Ver histórico de lideranças',
   'Ler a trilha de auditoria das designações e encerramentos'),

  ('fidelization.view',           'fidelization', 'Ver fidelização',
   'Consultar BRs, calendário mensal, motoristas e indicadores'),
  ('fidelization.manage_brs',     'fidelization', 'Gerenciar BRs',
   'Cadastrar, editar, inativar e reativar posições operacionais'),
  ('fidelization.plan',           'fidelization', 'Planejar fidelização',
   'Criar e editar o planejamento de veículos por BR e competência'),
  ('fidelization.change_vehicle', 'fidelization', 'Substituir e inverter veículos',
   'Substituir o veículo de uma BR, inverter veículos entre BRs e encerrar vínculos'),
  ('fidelization.change_driver',  'fidelization', 'Gerenciar motoristas da fidelização',
   'Vincular, substituir e encerrar motoristas de uma posição operacional'),
  ('fidelization.import',         'fidelization', 'Importar fidelização',
   'Importar planejamento a partir de arquivo, pelo fluxo validado'),
  ('fidelization.export',         'fidelization', 'Exportar fidelização',
   'Exportar o planejamento e o histórico de mobilizações'),
  ('fidelization.audit',          'fidelization', 'Ver histórico da fidelização',
   'Ler a trilha de auditoria de vínculos, substituições e inversões')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Matriz padrão
--
-- Liderança de Operações é quem planeja: designa responsáveis, monta a
-- competência e move veículos entre posições. Gestor de Frota é quem responde
-- pela frota, então cadastra as posições e acompanha tudo. Gestão lê, incluindo
-- a auditoria. Operacional, Gente e Segurança não recebem nada por aproximação.
--
-- Só o padrão muda: perfis já existentes não são alterados por esta migration.
-- -----------------------------------------------------------------------------
insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('administrador', 'leadership.view'),
    ('administrador', 'leadership.manage'),
    ('administrador', 'leadership.assign'),
    ('administrador', 'leadership.replicate'),
    ('administrador', 'leadership.audit'),
    ('administrador', 'fidelization.view'),
    ('administrador', 'fidelization.manage_brs'),
    ('administrador', 'fidelization.plan'),
    ('administrador', 'fidelization.change_vehicle'),
    ('administrador', 'fidelization.change_driver'),
    ('administrador', 'fidelization.import'),
    ('administrador', 'fidelization.export'),
    ('administrador', 'fidelization.audit'),

    ('lideranca_operacoes', 'leadership.view'),
    ('lideranca_operacoes', 'leadership.manage'),
    ('lideranca_operacoes', 'leadership.assign'),
    ('lideranca_operacoes', 'leadership.replicate'),
    ('lideranca_operacoes', 'fidelization.view'),
    ('lideranca_operacoes', 'fidelization.plan'),
    ('lideranca_operacoes', 'fidelization.change_vehicle'),
    ('lideranca_operacoes', 'fidelization.change_driver'),
    ('lideranca_operacoes', 'fidelization.export'),

    ('gestor_frota', 'leadership.view'),
    ('gestor_frota', 'fidelization.view'),
    ('gestor_frota', 'fidelization.manage_brs'),
    ('gestor_frota', 'fidelization.plan'),
    ('gestor_frota', 'fidelization.change_vehicle'),
    ('gestor_frota', 'fidelization.change_driver'),
    ('gestor_frota', 'fidelization.import'),
    ('gestor_frota', 'fidelization.export'),
    ('gestor_frota', 'fidelization.audit'),

    ('gestao', 'leadership.view'),
    ('gestao', 'leadership.audit'),
    ('gestao', 'fidelization.view'),
    ('gestao', 'fidelization.export'),
    ('gestao', 'fidelization.audit')
  ) as d (profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- private.br_in_scope
--
-- A fidelização e os seus motoristas não carregam `operation_id`: eles apontam
-- para uma BR, e é a BR que sabe de que operação é. Resolver isso numa função
-- mantém as políticas curtas e — mais importante — garante que as três tabelas
-- usem exatamente a mesma definição de "alcança".
-- -----------------------------------------------------------------------------
create or replace function private.br_in_scope(p_organization_id uuid, p_operation_br_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.operation_brs b
     where b.id = p_operation_br_id
       and b.organization_id = p_organization_id
       and private.can_access_operation(b.operation_id)
  );
$$;

revoke execute on function private.br_in_scope(uuid, uuid) from public, anon;
-- Concedida a authenticated porque as políticas RLS a avaliam com os
-- privilégios de quem consulta, não os do dono da tabela.
grant  execute on function private.br_in_scope(uuid, uuid) to authenticated;

comment on function private.br_in_scope(uuid, uuid) is
  'Alcance de uma posição operacional: a organização é a do chamador e a operação da BR está no seu escopo.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.operation_brs            enable row level security;
alter table public.leadership_assignments   enable row level security;
alter table public.fidelization_assignments enable row level security;
alter table public.fidelization_drivers     enable row level security;

alter table public.operation_brs            force row level security;
alter table public.leadership_assignments   force row level security;
alter table public.fidelization_assignments force row level security;
alter table public.fidelization_drivers     force row level security;

-- As BRs são estrutura: quem vê fidelização e quem vê lideranças precisa delas,
-- e nenhum dos dois deveria ter de pedir a permissão do outro para desenhar uma
-- linha da tabela.
drop policy if exists operation_brs_select on public.operation_brs;
create policy operation_brs_select on public.operation_brs
  for select to authenticated
  using (
    (organization_id in (select private.permitted_org_ids('fidelization.view'))
     or organization_id in (select private.permitted_org_ids('leadership.view')))
    and private.can_access_operation(operation_id)
  );

drop policy if exists leadership_assignments_select on public.leadership_assignments;
create policy leadership_assignments_select on public.leadership_assignments
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('leadership.view'))
    and private.can_access_operation(operation_id)
  );

drop policy if exists fidelization_assignments_select on public.fidelization_assignments;
create policy fidelization_assignments_select on public.fidelization_assignments
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('fidelization.view'))
    and private.br_in_scope(organization_id, operation_br_id)
  );

-- O motorista é um dado de pessoa. Lê quem lê a fidelização a que ele pertence
-- — nunca quem apenas alcança a organização.
drop policy if exists fidelization_drivers_select on public.fidelization_drivers;
create policy fidelization_drivers_select on public.fidelization_drivers
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('fidelization.view'))
    and exists (
      select 1 from public.fidelization_assignments a
       where a.id = fidelization_drivers.fidelization_assignment_id
         and a.organization_id = fidelization_drivers.organization_id
         and private.br_in_scope(a.organization_id, a.operation_br_id)
    )
  );

grant select on
  public.operation_brs,
  public.leadership_assignments,
  public.fidelization_assignments,
  public.fidelization_drivers
  to authenticated;

-- Escrita só pelas rotinas. Isto é explícito e não herdado: se algum default
-- privilege mudar amanhã, estas quatro tabelas continuam somente leitura.
revoke insert, update, delete on
  public.operation_brs,
  public.leadership_assignments,
  public.fidelization_assignments,
  public.fidelization_drivers
  from authenticated, anon;
