-- =============================================================================
-- ETAPA 09 · PERMISSÕES E LEITURA DAS FILIAIS
--
-- Dez permissões (§63). `units.view` e `units.manage` continuam existindo — são
-- da fundação e outras coisas as usam — mas o módulo Filiais fala `branches.*`,
-- e é por `branches.*` que a tela, as rotinas e os indicadores decidem.
--
-- ESCRITA. As políticas diretas de INSERT e UPDATE em `organization_units` são
-- removidas. Elas vinham da fundação, de quando não havia módulo nem rotina, e
-- hoje são uma segunda porta para o mesmo dado — sem transação, sem validação de
-- CNPJ, sem vínculos atômicos e sem análise de impacto. Toda escrita passa a
-- vir das rotinas da Etapa 09, como nas Etapas 06, 07 e 08.
--
-- A importação de colaboradores não é afetada: `private.resolve_master_data`
-- roda dentro de rotinas SECURITY DEFINER e nunca dependeu dessas políticas.
-- =============================================================================

insert into public.permissions (code, module, name, description) values
  ('branches.view',              'branches', 'Ver filiais',
   'Listar filiais, endereços, operações vinculadas e indicadores'),
  ('branches.create',            'branches', 'Cadastrar filiais',
   'Criar novas unidades organizacionais'),
  ('branches.update',            'branches', 'Editar filiais',
   'Alterar dados gerais, endereço e observações, e transferir veículos entre filiais'),
  ('branches.deactivate',        'branches', 'Inativar filiais',
   'Inativar e reativar filiais, após a análise de dependências'),
  ('branches.manage_operations', 'branches', 'Gerenciar operações da filial',
   'Vincular e desvincular operações atendidas pela filial'),
  ('branches.view_employees',    'branches', 'Ver colaboradores da filial',
   'Consultar os colaboradores lotados na filial'),
  ('branches.view_vehicles',     'branches', 'Ver frotas da filial',
   'Consultar os veículos sob responsabilidade da filial'),
  ('branches.import',            'branches', 'Importar filiais',
   'Importar filiais por arquivo, pelo fluxo validado'),
  ('branches.export',            'branches', 'Exportar filiais',
   'Exportar o cadastro de filiais e os seus vínculos'),
  ('branches.view_audit',        'branches', 'Ver histórico da filial',
   'Ler a trilha de auditoria das alterações da filial')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Matriz padrão
--
-- Administrador é dono do cadastro. Gestão lê tudo, inclusive a auditoria e a
-- exportação. Gestor de Frota lê a filial e as suas frotas, e pode transferir
-- veículos entre filiais — é a pessoa que responde por onde a frota está lotada.
-- Liderança de Operações lê. Ninguém mais recebe nada por aproximação.
-- -----------------------------------------------------------------------------
insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('administrador', 'branches.view'),
    ('administrador', 'branches.create'),
    ('administrador', 'branches.update'),
    ('administrador', 'branches.deactivate'),
    ('administrador', 'branches.manage_operations'),
    ('administrador', 'branches.view_employees'),
    ('administrador', 'branches.view_vehicles'),
    ('administrador', 'branches.import'),
    ('administrador', 'branches.export'),
    ('administrador', 'branches.view_audit'),

    ('gestao', 'branches.view'),
    ('gestao', 'branches.view_employees'),
    ('gestao', 'branches.view_vehicles'),
    ('gestao', 'branches.export'),
    ('gestao', 'branches.view_audit'),

    ('gestor_frota', 'branches.view'),
    ('gestor_frota', 'branches.update'),
    ('gestor_frota', 'branches.view_vehicles'),
    ('gestor_frota', 'branches.export'),

    ('lideranca_operacoes', 'branches.view'),
    ('lideranca_operacoes', 'branches.view_employees')
  ) as d (profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Leitura
--
-- Filial é estrutura: quem lê frota, colaboradores ou operações precisa do nome
-- da filial para desenhar uma linha de tabela. Por isso a leitura aceita tanto
-- `branches.view` quanto o `units.view` da fundação, que já é concedido a quem
-- opera esses módulos.
--
-- Arquivadas (deleted_at) só aparecem para quem pode inativar — é a mesma regra
-- que a política original já aplicava com `units.manage`.
-- -----------------------------------------------------------------------------
drop policy if exists organization_units_select on public.organization_units;
create policy organization_units_select on public.organization_units
  for select to authenticated
  using (
    (
      organization_id in (select private.permitted_org_ids('branches.view'))
      or organization_id in (select private.permitted_org_ids('units.view'))
    )
    and (
      deleted_at is null
      or organization_id in (select private.permitted_org_ids('branches.deactivate'))
      or organization_id in (select private.permitted_org_ids('units.manage'))
    )
  );

-- A porta direta fecha. Quem precisa escrever usa as rotinas.
drop policy if exists organization_units_insert on public.organization_units;
drop policy if exists organization_units_update on public.organization_units;

revoke insert, update, delete, truncate on public.organization_units from anon, authenticated;

-- -----------------------------------------------------------------------------
-- organization_unit_operations e vehicle_unit_assignments
-- -----------------------------------------------------------------------------
alter table public.organization_unit_operations enable row level security;
alter table public.organization_unit_operations force row level security;
alter table public.vehicle_unit_assignments     enable row level security;
alter table public.vehicle_unit_assignments     force row level security;

revoke all on public.organization_unit_operations, public.vehicle_unit_assignments
  from anon, authenticated;

-- O vínculo filial × operação é lido por quem lê filiais. O escopo por operação
-- NÃO é aplicado aqui de propósito: esconder de um usuário que a filial atende
-- uma operação que ele não alcança tornaria a contagem de operações da filial
-- mentirosa na própria tela dele. O que ele não alcança continua sendo os dados
-- DENTRO da operação — colaboradores, veículos, BRs —, e isso as políticas
-- daqueles módulos já garantem.
drop policy if exists unit_operations_select on public.organization_unit_operations;
create policy unit_operations_select on public.organization_unit_operations
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('branches.view'))
    or organization_id in (select private.permitted_org_ids('units.view'))
  );

-- Já a movimentação de um veículo entre filiais é dado do veículo, e segue o
-- escopo do veículo — quem não alcança o veículo não lê a sua história.
drop policy if exists vehicle_unit_assignments_select on public.vehicle_unit_assignments;
create policy vehicle_unit_assignments_select on public.vehicle_unit_assignments
  for select to authenticated
  using (
    (
      organization_id in (select private.permitted_org_ids('branches.view_vehicles'))
      or organization_id in (select private.permitted_org_ids('vehicles.view'))
    )
    and private.vehicle_in_scope(organization_id, vehicle_id)
  );

grant select on public.organization_unit_operations, public.vehicle_unit_assignments
  to authenticated;

grant select on public.organization_units to authenticated;
