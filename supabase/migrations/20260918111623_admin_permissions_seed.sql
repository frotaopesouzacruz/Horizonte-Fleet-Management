-- =============================================================================
-- ADMINISTRATION — PERMISSION CATALOGUE
-- Granular codes for the Users module plus the operation-scope privilege.
-- Idempotent; no customer data.
-- =============================================================================

insert into public.permissions (code, module, name, description) values
  ('users.view',                    'users',      'View users',                 'List employees and their organizational assignment'),
  ('users.view_sensitive',          'users',      'View personal data',         'See CPF, birth date and full licence number'),
  ('users.create',                  'users',      'Create users',               'Register employees'),
  ('users.update',                  'users',      'Update users',               'Edit employee data, assignment and licence'),
  ('users.archive',                 'users',      'Archive users',              'Deactivate employees and see archived ones'),
  ('users.import',                  'users',      'Import users',               'Upload and process employee import files'),
  ('users.export',                  'users',      'Export users',               'Export the employee list'),
  ('users.export_sensitive',        'users',      'Export personal data',       'Include CPF, birth date and licence data in an export'),
  ('users.invite',                  'users',      'Invite users',               'Send the access invitation e-mail'),
  ('users.manage_access',           'users',      'Manage HFM access',          'Grant, suspend and reactivate system access'),
  ('users.manage_roles',            'users',      'Manage access profiles',     'Assign HFM roles to an account'),
  ('users.manage_operation_scope',  'users',      'Manage operation scope',     'Define which operations an account may read'),
  ('users.bulk_manage',             'users',      'Bulk actions',               'Apply an action to a selection of users'),
  ('users.audit_view',              'users',      'View user history',          'Read the audit trail of a user record'),
  ('users.manage_master_data',      'users',      'Manage administrative master data',
                                                                                'Create and edit positions, areas, locations and organizational profiles'),
  ('operations.view',               'operations', 'View operations',            'List the operations of the organization'),
  ('operations.manage',             'operations', 'Manage operations',          'Create, edit and archive operations'),
  ('operations.access_all',         'operations', 'Access every operation',
                                                                                'Read data of every operation. Explicit privilege: without it an account only sees the operations assigned to it')
on conflict (code) do update
  set module = excluded.module, name = excluded.name, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Grants to the platform roles.
--
-- operations.access_all is deliberately narrow: administrators and leadership
-- only. Everyone else is scoped through membership_operation_scopes, which is
-- what makes "no scope means no operation" safe.
-- -----------------------------------------------------------------------------
with grants (role_code, permission_code) as (
  values
    ('org_admin', 'users.view'),
    ('org_admin', 'users.view_sensitive'),
    ('org_admin', 'users.create'),
    ('org_admin', 'users.update'),
    ('org_admin', 'users.archive'),
    ('org_admin', 'users.import'),
    ('org_admin', 'users.export'),
    ('org_admin', 'users.export_sensitive'),
    ('org_admin', 'users.invite'),
    ('org_admin', 'users.manage_access'),
    ('org_admin', 'users.manage_roles'),
    ('org_admin', 'users.manage_operation_scope'),
    ('org_admin', 'users.bulk_manage'),
    ('org_admin', 'users.audit_view'),
    ('org_admin', 'users.manage_master_data'),
    ('org_admin', 'operations.view'),
    ('org_admin', 'operations.manage'),
    ('org_admin', 'operations.access_all'),

    ('fleet_manager', 'users.view'),
    ('fleet_manager', 'users.export'),
    ('fleet_manager', 'operations.view'),

    ('leadership', 'users.view'),
    ('leadership', 'users.export'),
    ('leadership', 'users.audit_view'),
    ('leadership', 'operations.view'),
    ('leadership', 'operations.access_all'),

    ('operator', 'operations.view'),

    ('viewer', 'operations.view')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from grants g
  join public.roles r on r.code = g.role_code and r.organization_id is null
  join public.permissions p on p.code = g.permission_code
on conflict (role_id, permission_id) do nothing;
