-- =============================================================================
-- ETAPA 05 · ACCESS PROFILES — THE OFFICIAL CATALOGUE
--
-- Three different things used to be called "perfil" in conversation and they
-- are kept apart here on purpose:
--
--   1. the organizational profile that comes from the QLP base
--      (public.business_profiles — what the person does in the company);
--   2. the HFM access profile (this file — what the person may do in HFM);
--   3. the operation scope (membership_operation_scopes — which operations
--      the account may read).
--
-- Only (2) decides authorization, and it is never derived from (1).
--
-- The seven official codes are fixed by a check constraint: adding an eighth
-- profile is a migration, not a click. Names and descriptions may be adjusted;
-- the technical code a permission check depends on never changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New permission codes
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('roles.simulate', 'roles', 'Simulate access profiles',
   'Preview, read-only, what a profile or an account is allowed to do')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- The platform's own full-admin role gains every new platform capability at the
-- moment it is created. Doing it here, before any membership is migrated, is
-- what lets the migration below refuse to grant anybody a permission they did
-- not already hold: org_admin and Administrador then describe the same power.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  cross join public.permissions p
 where r.organization_id is null
   and r.code = 'org_admin'
   and p.code = 'roles.simulate'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- public.access_profiles — the seven official profiles
-- -----------------------------------------------------------------------------
create table if not exists public.access_profiles (
  code             text primary key,
  name             text not null,
  description      text not null,
  sort_order       smallint not null,
  -- The profile that administers access. Exactly one, and the last active
  -- holder of it can never be removed.
  is_administrator boolean not null default false,
  created_at       timestamptz not null default now(),

  constraint access_profiles_code_check check (code in (
    'operacional', 'seguranca', 'lideranca_operacoes',
    'gestor_frota', 'gente', 'administrador', 'gestao'
  )),
  constraint access_profiles_name_check check (length(btrim(name)) between 1 and 120)
);

comment on table public.access_profiles is
  'Official HFM access profiles. The code is the stable identity a permission check may rely on; routes and screen names are not.';

-- Exactly one administrator profile: the last-holder protection below has to
-- know, without ambiguity, which profile it is guarding.
create unique index if not exists access_profiles_administrator_key
  on public.access_profiles (is_administrator) where is_administrator;

insert into public.access_profiles (code, name, description, sort_order, is_administrator) values
  ('operacional',         'Operacional',            'Executa a operação do dia a dia. Enxerga apenas as operações às quais está vinculado.',          10, false),
  ('seguranca',           'Segurança',              'Acompanha segurança operacional, condutores e habilitações das operações vinculadas.',           20, false),
  ('lideranca_operacoes', 'Liderança de Operações', 'Lidera operações: acompanha pessoas, frota e indicadores das operações sob sua responsabilidade.', 30, false),
  ('gestor_frota',        'Gestor de Frota',        'Responsável pela frota: veículos, condutores, unidades e centros de custo.',                      40, false),
  ('gente',               'Gente',                  'Responsável pelos dados das pessoas. Não concede, altera nem remove acesso ao HFM.',              50, false),
  ('gestao',              'Gestão',                 'Visão executiva de leitura sobre toda a organização, incluindo trilha de auditoria.',             60, false),
  ('administrador',       'Administrador',          'Controle total do HFM, inclusive perfis de acesso, permissões e escopo de operações.',            70, true)
on conflict (code) do update
  set name = excluded.name, description = excluded.description,
      sort_order = excluded.sort_order, is_administrator = excluded.is_administrator;

alter table public.access_profiles enable row level security;

drop policy if exists access_profiles_select on public.access_profiles;
create policy access_profiles_select on public.access_profiles
  for select to authenticated using (true);

grant select on public.access_profiles to authenticated;

-- -----------------------------------------------------------------------------
-- public.access_profile_defaults — the official matrix
--
-- Stored, not hard-coded in a function, so "restaurar padrões" has something
-- real to restore to and the screen can show which cells an organization has
-- moved away from the default.
-- -----------------------------------------------------------------------------
create table if not exists public.access_profile_defaults (
  profile_code    text not null references public.access_profiles (code) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  constraint access_profile_defaults_pkey primary key (profile_code, permission_code)
);

comment on table public.access_profile_defaults is
  'Default permission matrix of each official profile. The baseline an organization starts from and can be restored to.';

alter table public.access_profile_defaults enable row level security;

drop policy if exists access_profile_defaults_select on public.access_profile_defaults;
create policy access_profile_defaults_select on public.access_profile_defaults
  for select to authenticated using (true);

grant select on public.access_profile_defaults to authenticated;

-- Rewritten wholesale: the file is the source of truth for the default matrix.
delete from public.access_profile_defaults;

insert into public.access_profile_defaults (profile_code, permission_code)
-- Administrador holds the whole catalogue, by definition and by construction:
-- a permission added by a future migration is his the moment it exists.
select 'administrador', p.code from public.permissions p
union all
select d.profile_code, d.permission_code
  from (values
    -- operacional — the floor. Reads the operation it belongs to and nothing else.
    ('operacional', 'organization.view'),
    ('operacional', 'operations.view'),
    ('operacional', 'units.view'),
    ('operacional', 'cost_centers.view'),
    ('operacional', 'vehicles.view'),
    ('operacional', 'drivers.view'),

    -- seguranca — condutores e habilitações. Reads people, updates drivers.
    -- users.view_sensitive (CPF, data de nascimento) is deliberately NOT here:
    -- it is added deliberately by an Administrador when the role needs it.
    ('seguranca', 'organization.view'),
    ('seguranca', 'operations.view'),
    ('seguranca', 'units.view'),
    ('seguranca', 'cost_centers.view'),
    ('seguranca', 'vehicles.view'),
    ('seguranca', 'drivers.view'),
    ('seguranca', 'drivers.update'),
    ('seguranca', 'users.view'),
    ('seguranca', 'users.export'),
    ('seguranca', 'audit.view'),

    -- lideranca_operacoes — leads its own operations. No operations.access_all:
    -- the scope is what makes "sem escopo, nenhuma operação" mean anything.
    ('lideranca_operacoes', 'organization.view'),
    ('lideranca_operacoes', 'operations.view'),
    ('lideranca_operacoes', 'units.view'),
    ('lideranca_operacoes', 'cost_centers.view'),
    ('lideranca_operacoes', 'vehicles.view'),
    ('lideranca_operacoes', 'drivers.view'),
    ('lideranca_operacoes', 'users.view'),
    ('lideranca_operacoes', 'users.export'),
    ('lideranca_operacoes', 'users.audit_view'),
    ('lideranca_operacoes', 'audit.view'),

    -- gestor_frota — owns fleet master data.
    ('gestor_frota', 'organization.view'),
    ('gestor_frota', 'operations.view'),
    ('gestor_frota', 'units.view'),
    ('gestor_frota', 'units.manage'),
    ('gestor_frota', 'cost_centers.view'),
    ('gestor_frota', 'cost_centers.manage'),
    ('gestor_frota', 'vehicle_catalog.manage'),
    ('gestor_frota', 'vehicles.view'),
    ('gestor_frota', 'vehicles.create'),
    ('gestor_frota', 'vehicles.update'),
    ('gestor_frota', 'vehicles.archive'),
    ('gestor_frota', 'drivers.view'),
    ('gestor_frota', 'drivers.create'),
    ('gestor_frota', 'drivers.update'),
    ('gestor_frota', 'drivers.archive'),
    ('gestor_frota', 'users.view'),
    ('gestor_frota', 'users.export'),
    ('gestor_frota', 'audit.view'),

    -- gente — owns the people record, never the access privilege.
    -- users.invite, users.manage_access, users.manage_roles and
    -- users.manage_operation_scope are absent on purpose: editing who someone
    -- is must not become editing what they may do.
    ('gente', 'organization.view'),
    ('gente', 'operations.view'),
    ('gente', 'units.view'),
    ('gente', 'cost_centers.view'),
    ('gente', 'users.view'),
    ('gente', 'users.view_sensitive'),
    ('gente', 'users.create'),
    ('gente', 'users.update'),
    ('gente', 'users.archive'),
    ('gente', 'users.import'),
    ('gente', 'users.export'),
    ('gente', 'users.export_sensitive'),
    ('gente', 'users.bulk_manage'),
    ('gente', 'users.audit_view'),
    ('gente', 'users.manage_master_data'),
    ('gente', 'audit.view'),

    -- gestao — executive reading, across every operation, changing nothing.
    ('gestao', 'organization.view'),
    ('gestao', 'operations.view'),
    ('gestao', 'operations.access_all'),
    ('gestao', 'members.view'),
    ('gestao', 'roles.view'),
    ('gestao', 'units.view'),
    ('gestao', 'cost_centers.view'),
    ('gestao', 'vehicles.view'),
    ('gestao', 'drivers.view'),
    ('gestao', 'users.view'),
    ('gestao', 'users.export'),
    ('gestao', 'users.audit_view'),
    ('gestao', 'audit.view')
  ) as d (profile_code, permission_code)
  join public.permissions p on p.code = d.permission_code;

-- -----------------------------------------------------------------------------
-- private.provision_access_profiles(uuid)
--
-- Gives an organization its seven roles. Idempotent, and deliberately
-- conservative: an existing role is left exactly as the organization has it.
-- Only a role created right here is filled from the default matrix, so running
-- this again never quietly re-grants a permission an Administrador removed.
-- -----------------------------------------------------------------------------
create or replace function private.provision_access_profiles(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_profile record;
  v_role_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = 'invalid_parameter_value';
  end if;

  for v_profile in
    select code, name, description from public.access_profiles order by sort_order
  loop
    select r.id into v_role_id
      from public.roles r
     where r.organization_id = p_organization_id and r.code = v_profile.code;

    if v_role_id is not null then
      -- Restore an archived official profile rather than creating a duplicate,
      -- but do not touch its grants.
      update public.roles
         set deleted_at = null, deleted_by = null
       where id = v_role_id and deleted_at is not null;
      continue;
    end if;

    insert into public.roles (organization_id, code, name, description, is_system, is_editable)
    values (p_organization_id, v_profile.code, v_profile.name, v_profile.description, false, true)
    returning id into v_role_id;

    insert into public.role_permissions (role_id, permission_id)
    select v_role_id, p.id
      from public.access_profile_defaults d
      join public.permissions p on p.code = d.permission_code
     where d.profile_code = v_profile.code
    on conflict do nothing;

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke execute on function private.provision_access_profiles(uuid) from public, anon, authenticated;

comment on function private.provision_access_profiles(uuid) is
  'Creates the seven official profiles for one organization. Idempotent; never rewrites the grants of a role that already exists.';

-- Every organization that exists today.
select private.provision_access_profiles(o.id) from public.organizations o;
