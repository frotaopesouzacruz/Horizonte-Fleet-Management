-- =============================================================================
-- ETAPA 06 · PERMISSÕES E ESCOPO OPERACIONAL DA FROTA
--
-- `vehicles.view` já existia e protegia o tenant. Faltava a segunda metade: um
-- líder da operação Merchandising não deve enxergar os veículos do Last Mile
-- MG só porque pertencem à mesma empresa. O escopo por operação passa a valer
-- para veículos exatamente como já vale para colaboradores.
--
-- E o caso que uma regra descuidada deixa passar: veículo sem alocação. Ele não
-- pertence a operação nenhuma, então "as operações que você pode ver" não o
-- alcança — e o resultado fácil seria torná-lo visível para todos. Aqui ele
-- exige permissão própria.
-- =============================================================================

insert into public.permissions (code, module, name, description) values
  ('vehicles.import',            'vehicles', 'Importar frotas',
   'Enviar e processar arquivos de importação da frota'),
  ('vehicles.export',            'vehicles', 'Exportar frotas',
   'Exportar a lista de veículos'),
  ('vehicles.audit',             'vehicles', 'Ver histórico do veículo',
   'Ler a trilha de auditoria e o histórico de um veículo'),
  ('vehicles.manage_assignment', 'vehicles', 'Gerenciar alocação operacional',
   'Alocar e transferir veículos entre operações, estados e cidades'),
  ('vehicles.correct_odometer',  'vehicles', 'Corrigir quilometragem',
   'Registrar correção da leitura oficial de hodômetro, com motivo'),
  ('vehicles.view_unassigned',   'vehicles', 'Ver veículos sem alocação',
   'Enxergar veículos que ainda não pertencem a nenhuma operação')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- Traduz o catálogo de frota que já existia e nunca foi lido por ninguém.
update public.permissions p set name = t.name, description = t.description
  from (values
    ('vehicles.view',          'Ver veículos',              'Listar veículos e o histórico de situação'),
    ('vehicles.create',        'Cadastrar veículos',        'Registrar veículos na frota'),
    ('vehicles.update',        'Editar veículos',           'Alterar os dados cadastrais do veículo'),
    ('vehicles.archive',       'Arquivar veículos',         'Arquivar, restaurar e visualizar veículos arquivados'),
    ('vehicle_catalog.manage', 'Gerenciar catálogo de veículos',
     'Criar marcas, modelos e subcategorias próprios da organização')
  ) as t (code, name, description)
 where p.code = t.code;

-- -----------------------------------------------------------------------------
-- Matriz padrão
--
-- Gestor de Frota é o dono do módulo. Liderança e Gestão leem e exportam dentro
-- do seu escopo; ninguém mais recebe nada por aproximação.
-- -----------------------------------------------------------------------------
insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('gestor_frota', 'vehicles.import'),
    ('gestor_frota', 'vehicles.export'),
    ('gestor_frota', 'vehicles.audit'),
    ('gestor_frota', 'vehicles.manage_assignment'),
    ('gestor_frota', 'vehicles.correct_odometer'),
    ('gestor_frota', 'vehicles.view_unassigned'),
    ('lideranca_operacoes', 'vehicles.export'),
    ('gestao',       'vehicles.export'),
    ('gestao',       'vehicles.audit'),
    ('administrador', 'vehicles.import'),
    ('administrador', 'vehicles.export'),
    ('administrador', 'vehicles.audit'),
    ('administrador', 'vehicles.manage_assignment'),
    ('administrador', 'vehicles.correct_odometer'),
    ('administrador', 'vehicles.view_unassigned')
  ) as d (profile_code, permission_code)
on conflict do nothing;

-- Aplica o novo padrão apenas aos perfis que ainda estão exatamente no padrão.
-- Um perfil que um Administrador já ajustou não é alterado por uma migration —
-- a diferença aparece no painel de inconsistências, onde uma pessoa decide.
with untouched as (
  select v.role_id, v.code
    from public.access_profile_overview v
   where cardinality(v.added_permissions) = 0
     and cardinality(v.removed_permissions) = 0
)
insert into public.role_permissions (role_id, permission_id)
select u.role_id, p.id
  from untouched u
  join public.access_profile_defaults d on d.profile_code = u.code
  join public.permissions p on p.code = d.permission_code
 where p.code like 'vehicles.%'
on conflict do nothing;

-- O Administrador possui o catálogo inteiro por definição, tenha ou não sido
-- ajustado: é ele quem garante que a organização nunca fique sem quem administre.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.access_profiles ap on ap.code = r.code and ap.is_administrator
  cross join public.permissions p
 where r.organization_id is not null and r.deleted_at is null
on conflict do nothing;

insert into public.access_profile_defaults (profile_code, permission_code)
select 'administrador', p.code from public.permissions p
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- private.accessible_vehicle_ids() — o escopo, num lugar só
-- -----------------------------------------------------------------------------
create or replace function private.vehicle_in_scope(p_organization_id uuid, p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- quem enxerga todas as operações enxerga toda a frota da organização
    private.is_platform_admin()
    or p_organization_id in (select private.permitted_org_ids('operations.access_all'))
    or exists (
      select 1
        from public.vehicle_operation_assignments a
       where a.vehicle_id = p_vehicle_id
         and a.effective_to is null
         and a.operation_id in (select private.accessible_operation_ids())
    )
    -- sem alocação: não pertence a operação nenhuma, então nenhum escopo o
    -- alcança. Isso não o torna público — torna-o administrativo.
    or (
      p_organization_id in (select private.permitted_org_ids('vehicles.view_unassigned'))
      and not exists (
        select 1 from public.vehicle_operation_assignments a
         where a.vehicle_id = p_vehicle_id and a.effective_to is null
      )
    );
$$;

grant execute on function private.vehicle_in_scope(uuid, uuid) to authenticated, service_role;

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('vehicles.view'))
    and (deleted_at is null or organization_id in (select private.permitted_org_ids('vehicles.archive')))
    and private.vehicle_in_scope(organization_id, id)
  );
