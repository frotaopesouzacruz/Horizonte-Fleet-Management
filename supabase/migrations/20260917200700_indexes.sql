-- =============================================================================
-- HFM · 008 · Indexes
-- Unique business keys live next to their tables. This file holds the access
-- path indexes for real queries: tenant scans, FK lookups and RLS helpers.
-- =============================================================================

-- organization_units / cost_centers ------------------------------------------
create index organization_units_org_active_idx
  on public.organization_units (organization_id, status) where deleted_at is null;

create index cost_centers_org_active_idx
  on public.cost_centers (organization_id, status) where deleted_at is null;
create index cost_centers_unit_idx
  on public.cost_centers (organization_unit_id) where organization_unit_id is not null;

-- memberships / RBAC (hot path of every RLS check) ----------------------------
create index organization_memberships_user_active_idx
  on public.organization_memberships (user_id, organization_id) where status = 'active';
create index organization_memberships_org_status_idx
  on public.organization_memberships (organization_id, status);

create index membership_roles_role_idx
  on public.membership_roles (role_id);

create index role_permissions_permission_idx
  on public.role_permissions (permission_id);

create index roles_org_idx
  on public.roles (organization_id) where organization_id is not null;

-- platform_admins: PK on user_id already covers is_platform_admin()

-- fleet ----------------------------------------------------------------------
create index vehicle_makes_org_idx
  on public.vehicle_makes (organization_id) where organization_id is not null;
create index vehicle_models_org_idx
  on public.vehicle_models (organization_id) where organization_id is not null;

create index vehicles_org_status_idx
  on public.vehicles (organization_id, status) where deleted_at is null;
create index vehicles_org_unit_idx
  on public.vehicles (organization_id, organization_unit_id) where organization_unit_id is not null;
create index vehicles_org_cost_center_idx
  on public.vehicles (organization_id, cost_center_id) where cost_center_id is not null;
create index vehicles_type_idx
  on public.vehicles (vehicle_type_id);
create index vehicles_model_idx
  on public.vehicles (vehicle_model_id) where vehicle_model_id is not null;
create index vehicles_org_created_idx
  on public.vehicles (organization_id, created_at desc);

create index vehicle_status_history_vehicle_idx
  on public.vehicle_status_history (vehicle_id, changed_at desc);
create index vehicle_status_history_org_changed_idx
  on public.vehicle_status_history (organization_id, changed_at desc);

create index drivers_org_status_idx
  on public.drivers (organization_id, status) where deleted_at is null;
create index drivers_org_unit_idx
  on public.drivers (organization_id, organization_unit_id) where organization_unit_id is not null;
create index drivers_user_idx
  on public.drivers (user_id) where user_id is not null;

-- audit / outbox -------------------------------------------------------------
create index audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_user_created_idx
  on public.audit_logs (user_id, created_at desc) where user_id is not null;

create index outbox_events_pending_idx
  on public.outbox_events (created_at) where status in ('pending', 'failed');
create index outbox_events_aggregate_idx
  on public.outbox_events (aggregate_type, aggregate_id);

-- FK support on audit columns is intentionally omitted: created_by/updated_by
-- are never used as query predicates; ON DELETE SET NULL on auth.users is rare.
