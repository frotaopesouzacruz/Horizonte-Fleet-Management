-- =============================================================================
-- ETAPA 07 · PERMISSÕES E LEITURA
--
-- Nove permissões, porque as nove coisas são realmente diferentes: quem pode
-- criar um tipo não é necessariamente quem decide em quais operações ele é
-- admitido, e nenhuma das duas é quem mexe na elegibilidade de um módulo que
-- alimenta indicador.
--
-- ESCRITA. Nenhuma destas tabelas recebe política de INSERT, UPDATE ou DELETE.
-- Isso é deliberado: toda alteração passa pelas rotinas da Etapa 07, que são
-- transacionais, conferem permissão e deixam auditoria. Uma política de escrita
-- aqui seria uma segunda porta para o mesmo dado, sem nenhuma dessas garantias.
-- =============================================================================

insert into public.permissions (code, module, name, description) values
  ('equipment_types.view',                 'equipment_types', 'Ver tipos de equipamento',
   'Listar tipos, subcategorias e a parametrização da organização'),
  ('equipment_types.create',               'equipment_types', 'Cadastrar tipos de equipamento',
   'Criar novos tipos no catálogo da organização'),
  ('equipment_types.update',               'equipment_types', 'Editar tipos de equipamento',
   'Alterar nome, descrição e configuração do tipo'),
  ('equipment_types.deactivate',           'equipment_types', 'Inativar tipos de equipamento',
   'Inativar e reativar tipos, após a análise de impacto'),
  ('equipment_types.manage_subcategories', 'equipment_types', 'Gerenciar subcategorias',
   'Criar, editar e inativar as subcategorias de um tipo'),
  ('equipment_types.manage_operations',    'equipment_types', 'Gerenciar operações do tipo',
   'Definir em quais operações o tipo é admitido'),
  ('equipment_types.manage_apps',          'equipment_types', 'Gerenciar aplicativos do tipo',
   'Vincular e desvincular aplicativos operacionais'),
  ('equipment_types.manage_eligibility',   'equipment_types', 'Gerenciar elegibilidade de módulos',
   'Definir se o tipo é consultável, elegível e contabilizado em cada módulo'),
  ('equipment_types.view_audit',           'equipment_types', 'Ver histórico do tipo',
   'Ler a trilha de auditoria das alterações do tipo')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Matriz padrão
--
-- Gestor de Frota é o dono do módulo — é a pessoa que sabe o que é um Furgão e
-- em que operação ele roda. Liderança e Gestão leem. Ninguém mais recebe nada
-- por aproximação, e nada é concedido a perfis existentes: só o padrão muda.
-- -----------------------------------------------------------------------------
insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('gestor_frota',  'equipment_types.view'),
    ('gestor_frota',  'equipment_types.create'),
    ('gestor_frota',  'equipment_types.update'),
    ('gestor_frota',  'equipment_types.deactivate'),
    ('gestor_frota',  'equipment_types.manage_subcategories'),
    ('gestor_frota',  'equipment_types.manage_operations'),
    ('gestor_frota',  'equipment_types.manage_apps'),
    ('gestor_frota',  'equipment_types.manage_eligibility'),
    ('gestor_frota',  'equipment_types.view_audit'),
    ('lideranca_operacoes', 'equipment_types.view'),
    ('gestao',        'equipment_types.view'),
    ('gestao',        'equipment_types.view_audit'),
    ('administrador', 'equipment_types.view'),
    ('administrador', 'equipment_types.create'),
    ('administrador', 'equipment_types.update'),
    ('administrador', 'equipment_types.deactivate'),
    ('administrador', 'equipment_types.manage_subcategories'),
    ('administrador', 'equipment_types.manage_operations'),
    ('administrador', 'equipment_types.manage_apps'),
    ('administrador', 'equipment_types.manage_eligibility'),
    ('administrador', 'equipment_types.view_audit')
  ) as d (profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Leitura
-- -----------------------------------------------------------------------------
drop policy if exists vehicle_type_settings_select on public.vehicle_type_settings;
create policy vehicle_type_settings_select on public.vehicle_type_settings
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

drop policy if exists vehicle_type_operations_select on public.vehicle_type_operations;
create policy vehicle_type_operations_select on public.vehicle_type_operations
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

drop policy if exists vehicle_type_apps_select on public.vehicle_type_apps;
create policy vehicle_type_apps_select on public.vehicle_type_apps
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

drop policy if exists vehicle_type_module_rules_select on public.vehicle_type_module_rules;
create policy vehicle_type_module_rules_select on public.vehicle_type_module_rules
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

drop policy if exists operational_apps_select on public.operational_apps;
create policy operational_apps_select on public.operational_apps
  for select to authenticated
  using (organization_id in (select private.member_org_ids()));

-- O catálogo de módulos do produto não tem segredo nenhum e é igual para todos.
drop policy if exists operational_modules_select on public.operational_modules;
create policy operational_modules_select on public.operational_modules
  for select to authenticated using (true);

grant select on public.vehicle_type_settings, public.vehicle_type_operations,
                public.vehicle_type_apps, public.vehicle_type_module_rules,
                public.operational_apps, public.operational_modules
  to authenticated;
