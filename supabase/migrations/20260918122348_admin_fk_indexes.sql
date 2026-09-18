-- =============================================================================
-- Covering indexes for the composite foreign keys on a real access path
-- (cascade deletes and the directory filters). Authorship columns
-- (created_by / updated_by / deleted_by) stay unindexed on purpose: nothing
-- queries by them and indexing every stamp taxes every write.
-- =============================================================================
create index if not exists employee_private_data_org_employee_idx
  on public.employee_private_data (organization_id, employee_id);

create index if not exists employee_assignments_org_employee_idx
  on public.employee_assignments (organization_id, employee_id);

create index if not exists employee_assignments_org_area_idx
  on public.employee_assignments (organization_id, employment_area_id) where is_current;

create index if not exists employee_assignments_org_profile_idx
  on public.employee_assignments (organization_id, business_profile_id) where is_current;

create index if not exists driver_licenses_org_employee_idx
  on public.driver_licenses (organization_id, employee_id);

create index if not exists membership_operation_scopes_org_membership_idx
  on public.membership_operation_scopes (organization_id, membership_id);

create index if not exists access_profile_mappings_role_idx
  on public.access_profile_mappings (role_id);

create index if not exists import_rows_org_batch_idx
  on public.import_rows (organization_id, batch_id);

create index if not exists import_rows_org_employee_idx
  on public.import_rows (organization_id, employee_id) where employee_id is not null;

create index if not exists import_errors_org_batch_idx
  on public.import_errors (organization_id, batch_id);
