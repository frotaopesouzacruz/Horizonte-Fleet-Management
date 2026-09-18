-- =============================================================================
-- HFM · 009 · Structural seeds
-- Permission catalog, platform roles and vehicle types. Idempotent.
-- No customer, user, vehicle or driver data is seeded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- permissions
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('organization.view',       'organization',    'View organization',        'Read organization data and settings'),
  ('organization.manage',     'organization',    'Manage organization',      'Edit organization data and settings'),
  ('members.view',            'members',         'View members',             'List organization members and their roles'),
  ('members.manage',          'members',         'Manage members',           'Invite, suspend and assign roles to members'),
  ('roles.view',              'roles',           'View roles',               'List roles and their permissions'),
  ('roles.manage',            'roles',           'Manage roles',             'Create and edit custom roles'),
  ('units.view',              'units',           'View units',               'List organization units'),
  ('units.manage',            'units',           'Manage units',             'Create, edit and archive organization units'),
  ('cost_centers.view',       'cost_centers',    'View cost centers',        'List cost centers'),
  ('cost_centers.manage',     'cost_centers',    'Manage cost centers',      'Create, edit and archive cost centers'),
  ('vehicle_catalog.manage',  'vehicles',        'Manage vehicle catalog',   'Create organization-specific makes and models'),
  ('vehicles.view',           'vehicles',        'View vehicles',            'List vehicles and their status history'),
  ('vehicles.create',         'vehicles',        'Create vehicles',          'Register vehicles'),
  ('vehicles.update',         'vehicles',        'Update vehicles',          'Edit vehicle data and change status'),
  ('vehicles.archive',        'vehicles',        'Archive vehicles',         'Archive/restore vehicles and see archived ones'),
  ('drivers.view',            'drivers',         'View drivers',             'List drivers'),
  ('drivers.create',          'drivers',         'Create drivers',           'Register drivers'),
  ('drivers.update',          'drivers',         'Update drivers',           'Edit driver data'),
  ('drivers.archive',         'drivers',         'Archive drivers',          'Archive/restore drivers and see archived ones'),
  ('audit.view',              'audit',           'View audit trail',         'Read the organization audit log')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- platform roles (global, system, not editable by organizations)
-- -----------------------------------------------------------------------------
insert into public.roles (organization_id, code, name, description, is_system, is_editable) values
  (null, 'org_admin',     'Organization administrator', 'Full control of the organization',                         true, false),
  (null, 'fleet_manager', 'Fleet manager',              'Manages fleet master data, units and cost centers',        true, false),
  (null, 'leadership',    'Leadership',                 'Read access to everything including audit trail',          true, false),
  (null, 'operator',      'Operator',                   'Operates the fleet: creates and updates vehicles/drivers', true, false),
  (null, 'viewer',        'Viewer',                     'Read-only access',                                         true, false)
on conflict (code) where organization_id is null do update
  set name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- role_permissions
-- -----------------------------------------------------------------------------
with grants (role_code, permission_code) as (
  values
  -- org_admin: everything
  ('org_admin', 'organization.view'), ('org_admin', 'organization.manage'),
  ('org_admin', 'members.view'),      ('org_admin', 'members.manage'),
  ('org_admin', 'roles.view'),        ('org_admin', 'roles.manage'),
  ('org_admin', 'units.view'),        ('org_admin', 'units.manage'),
  ('org_admin', 'cost_centers.view'), ('org_admin', 'cost_centers.manage'),
  ('org_admin', 'vehicle_catalog.manage'),
  ('org_admin', 'vehicles.view'),     ('org_admin', 'vehicles.create'),
  ('org_admin', 'vehicles.update'),   ('org_admin', 'vehicles.archive'),
  ('org_admin', 'drivers.view'),      ('org_admin', 'drivers.create'),
  ('org_admin', 'drivers.update'),    ('org_admin', 'drivers.archive'),
  ('org_admin', 'audit.view'),
  -- fleet_manager: master data management, no member/role administration
  ('fleet_manager', 'organization.view'),
  ('fleet_manager', 'members.view'),      ('fleet_manager', 'roles.view'),
  ('fleet_manager', 'units.view'),        ('fleet_manager', 'units.manage'),
  ('fleet_manager', 'cost_centers.view'), ('fleet_manager', 'cost_centers.manage'),
  ('fleet_manager', 'vehicle_catalog.manage'),
  ('fleet_manager', 'vehicles.view'),     ('fleet_manager', 'vehicles.create'),
  ('fleet_manager', 'vehicles.update'),   ('fleet_manager', 'vehicles.archive'),
  ('fleet_manager', 'drivers.view'),      ('fleet_manager', 'drivers.create'),
  ('fleet_manager', 'drivers.update'),    ('fleet_manager', 'drivers.archive'),
  ('fleet_manager', 'audit.view'),
  -- leadership: read everything
  ('leadership', 'organization.view'), ('leadership', 'members.view'), ('leadership', 'roles.view'),
  ('leadership', 'units.view'),        ('leadership', 'cost_centers.view'),
  ('leadership', 'vehicles.view'),     ('leadership', 'drivers.view'),  ('leadership', 'audit.view'),
  -- operator: day-to-day fleet operations
  ('operator', 'organization.view'),
  ('operator', 'units.view'),     ('operator', 'cost_centers.view'),
  ('operator', 'vehicles.view'),  ('operator', 'vehicles.create'), ('operator', 'vehicles.update'),
  ('operator', 'drivers.view'),   ('operator', 'drivers.create'),  ('operator', 'drivers.update'),
  -- viewer: read-only, no audit
  ('viewer', 'organization.view'),
  ('viewer', 'units.view'),    ('viewer', 'cost_centers.view'),
  ('viewer', 'vehicles.view'), ('viewer', 'drivers.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from grants g
join public.roles r       on r.code = g.role_code and r.organization_id is null
join public.permissions p on p.code = g.permission_code
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- vehicle_types
-- -----------------------------------------------------------------------------
insert into public.vehicle_types (code, name, sort_order) values
  ('car',        'Automóvel',   10),
  ('utility',    'Utilitário',  20),
  ('van',        'Van',         30),
  ('truck',      'Caminhão',    40),
  ('motorcycle', 'Motocicleta', 50),
  ('other',      'Outros',      90)
on conflict (code) do update
  set name = excluded.name, sort_order = excluded.sort_order;
