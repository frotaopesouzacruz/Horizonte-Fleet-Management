-- =============================================================================
-- ETAPA 05 · THE PERMISSION CATALOGUE IN PORTUGUESE
--
-- Until now nobody read these strings: they lived in seed files and were
-- resolved by code. The Perfis e permissões screen puts all forty-four of them
-- in front of an administrator who has to decide, cell by cell, what each one
-- means for a real person — and "Manage administrative master data" is not a
-- sentence that helps anybody decide anything.
--
-- The codes are untouched. A permission code is the identity every check in the
-- product depends on; only the words a person reads change here.
-- =============================================================================

update public.permissions p
   set name = t.name,
       description = t.description
  from (values
    ('organization.view',             'Ver organização',                'Ler os dados e as configurações da organização'),
    ('organization.manage',           'Gerenciar organização',          'Editar os dados e as configurações da organização'),

    ('members.view',                  'Ver membros',                    'Listar os membros da organização e seus perfis'),
    ('members.manage',                'Gerenciar membros',              'Convidar, suspender e atribuir perfis a membros'),

    ('roles.view',                    'Ver perfis e permissões',        'Consultar os perfis de acesso e o que cada um permite'),
    ('roles.manage',                  'Gerenciar perfis e permissões',  'Editar a matriz de permissões e restaurar o padrão oficial'),
    ('roles.simulate',                'Simular perfis de acesso',       'Pré-visualizar, sem alterar nada, o que um perfil permite'),

    ('units.view',                    'Ver filiais e unidades',         'Listar as unidades organizacionais'),
    ('units.manage',                  'Gerenciar filiais e unidades',   'Criar, editar e arquivar unidades organizacionais'),

    ('cost_centers.view',             'Ver centros de custo',           'Listar os centros de custo'),
    ('cost_centers.manage',           'Gerenciar centros de custo',     'Criar, editar e arquivar centros de custo'),

    ('vehicle_catalog.manage',        'Gerenciar catálogo de veículos', 'Criar marcas e modelos próprios da organização'),
    ('vehicles.view',                 'Ver veículos',                   'Listar veículos e o histórico de situação'),
    ('vehicles.create',               'Cadastrar veículos',             'Registrar veículos na frota'),
    ('vehicles.update',               'Editar veículos',                'Alterar os dados do veículo e a sua situação'),
    ('vehicles.archive',              'Arquivar veículos',              'Arquivar, restaurar e visualizar veículos arquivados'),

    ('drivers.view',                  'Ver condutores',                 'Listar condutores'),
    ('drivers.create',                'Cadastrar condutores',           'Registrar condutores'),
    ('drivers.update',                'Editar condutores',              'Alterar os dados de um condutor'),
    ('drivers.archive',               'Arquivar condutores',            'Arquivar, restaurar e visualizar condutores arquivados'),

    ('audit.view',                    'Ver trilha de auditoria',        'Ler o registro de auditoria da organização'),

    ('users.view',                    'Ver colaboradores',              'Listar colaboradores e o seu vínculo organizacional'),
    ('users.view_sensitive',          'Ver dados pessoais',             'Ver CPF, data de nascimento e número completo da CNH'),
    ('users.create',                  'Cadastrar colaboradores',        'Registrar colaboradores'),
    ('users.update',                  'Editar colaboradores',           'Alterar dados, vínculo e CNH do colaborador'),
    ('users.archive',                 'Inativar colaboradores',         'Inativar colaboradores e visualizar cadastros inativos'),
    ('users.import',                  'Importar colaboradores',         'Enviar e processar arquivos de importação da base'),
    ('users.export',                  'Exportar colaboradores',         'Exportar a lista de colaboradores'),
    ('users.export_sensitive',        'Exportar dados pessoais',        'Incluir CPF, data de nascimento e dados de CNH em uma exportação'),
    ('users.invite',                  'Convidar para o HFM',            'Enviar o e-mail de convite de acesso'),
    ('users.manage_access',           'Gerenciar acesso ao HFM',        'Conceder, suspender e reativar o acesso ao sistema'),
    ('users.manage_roles',            'Gerenciar perfis de acesso',     'Atribuir e remover o perfil de acesso de uma conta'),
    ('users.manage_operation_scope',  'Gerenciar escopo de operações',  'Definir quais operações uma conta pode enxergar'),
    ('users.bulk_manage',             'Ações em massa',                 'Aplicar uma ação a uma seleção de colaboradores'),
    ('users.audit_view',              'Ver histórico do colaborador',   'Ler a trilha de auditoria de um cadastro'),
    ('users.manage_master_data',      'Gerenciar cadastros auxiliares', 'Criar e editar cargos, áreas, localidades e perfis organizacionais'),

    ('operations.view',               'Ver operações',                  'Listar as operações da organização'),
    ('operations.manage',             'Gerenciar operações',            'Criar, editar e arquivar operações'),
    ('operations.create',             'Cadastrar operações',            'Registrar uma nova operação'),
    ('operations.update',             'Editar operações',               'Alterar nome, descrição e situação de uma operação'),
    ('operations.deactivate',         'Inativar operações',             'Tirar uma operação de uso sem perder o seu histórico'),
    ('operations.manage_geography',   'Gerenciar abrangência',          'Definir os estados e municípios cobertos por uma operação'),
    ('operations.view_audit',         'Ver histórico da operação',      'Ler a trilha de auditoria de uma operação'),
    ('operations.access_all',         'Acessar todas as operações',     'Ler dados de todas as operações. Sem esta permissão a conta enxerga apenas as operações atribuídas a ela')
  ) as t (code, name, description)
 where p.code = t.code;
