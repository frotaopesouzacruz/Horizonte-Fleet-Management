-- =============================================================================
-- ADMINISTRATION — HFM ACCESS AND OPERATION SCOPES
--
-- Two different things that must never be conflated:
--   employee_assignments.operation_id      where the person works
--   membership_operation_scopes            which operations their account reads
--
-- Access to every operation is an explicit permission (operations.access_all),
-- never the absence of scope rows: "no rows" means "no operation", so a
-- forgotten scope fails closed instead of leaking the whole tenant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organization_memberships.employee_id — the person behind the account.
-- Lives on the membership, not on the profile: one auth user may belong to
-- several organizations and is a different employee in each.
-- -----------------------------------------------------------------------------
alter table public.organization_memberships
  add column if not exists employee_id uuid,
  add constraint organization_memberships_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete set null;

create unique index organization_memberships_employee_key on public.organization_memberships
  (organization_id, employee_id) where employee_id is not null;

comment on column public.organization_memberships.employee_id is
  'Employee this account belongs to in this organization. At most one membership per employee per organization.';

-- -----------------------------------------------------------------------------
-- membership_operation_scopes
-- -----------------------------------------------------------------------------
create table public.membership_operation_scopes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  membership_id   uuid not null,
  operation_id    uuid not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint membership_operation_scopes_key unique (membership_id, operation_id),
  constraint membership_operation_scopes_membership_fk
    foreign key (organization_id, membership_id)
    references public.organization_memberships (organization_id, id) on delete cascade,
  constraint membership_operation_scopes_operation_fk
    foreign key (organization_id, operation_id)
    references public.operations (organization_id, id) on delete cascade
);
comment on table public.membership_operation_scopes is
  'Operations an account may read. Generic on purpose: every future module scopes its own data through private.accessible_operation_ids().';

create index membership_operation_scopes_operation_idx on public.membership_operation_scopes
  (organization_id, operation_id);
create index membership_operation_scopes_membership_idx on public.membership_operation_scopes
  (membership_id);

-- -----------------------------------------------------------------------------
-- access_profile_mappings — optional bridge from an imported organizational
-- profile to an HFM role. Disabled until an administrator approves it, and even
-- then it is only ever offered as a suggestion: an import never applies it.
-- -----------------------------------------------------------------------------
create table public.access_profile_mappings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  business_profile_id uuid not null,
  role_id             uuid not null references public.roles (id) on delete cascade,
  is_enabled          boolean not null default false,
  approved_by         uuid references auth.users (id) on delete set null,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,

  constraint access_profile_mappings_key unique (organization_id, business_profile_id, role_id),
  constraint access_profile_mappings_approval_check
    check (not is_enabled or (approved_by is not null and approved_at is not null)),
  constraint access_profile_mappings_profile_fk
    foreign key (organization_id, business_profile_id)
    references public.business_profiles (organization_id, id) on delete cascade
);
comment on table public.access_profile_mappings is
  'Suggested role for an imported organizational profile. Never applied automatically: it only pre-fills the access form once an administrator enables it.';

-- -----------------------------------------------------------------------------
-- private.tg_operation_scope_guard()
-- The scope is a privilege: assigning one requires users.manage_operation_scope,
-- and nobody may widen their own account.
-- -----------------------------------------------------------------------------
create or replace function private.tg_operation_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row           public.membership_operation_scopes;
  v_membership    public.organization_memberships;
begin
  v_row := coalesce(new, old);

  select * into v_membership
    from public.organization_memberships m
   where m.id = v_row.membership_id;

  if v_membership.id is null then
    raise exception 'membership % does not exist', v_row.membership_id using errcode = 'foreign_key_violation';
  end if;
  if v_membership.organization_id is distinct from v_row.organization_id then
    raise exception 'membership % belongs to another organization', v_row.membership_id using errcode = 'check_violation';
  end if;

  if private.is_privileged_context() then
    return coalesce(new, old);
  end if;

  if not private.has_permission(v_row.organization_id, 'users.manage_operation_scope') then
    raise exception 'permission users.manage_operation_scope is required to change operation scopes'
      using errcode = 'insufficient_privilege';
  end if;

  -- self-service escalation: an operator could otherwise hand themselves the
  -- operations they are not scoped to
  if v_membership.user_id = auth.uid() and not private.is_platform_admin() then
    raise exception 'an account cannot change its own operation scope'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- private.tg_membership_revoke_scopes()
-- Removing a membership drops its scopes; suspension keeps them so a
-- reactivation restores exactly what was there.
-- -----------------------------------------------------------------------------
create or replace function private.tg_membership_revoke_scopes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'removed' and old.status is distinct from 'removed' then
    delete from public.membership_operation_scopes where membership_id = new.id;
  end if;
  return new;
end;
$$;

create trigger membership_operation_scopes_guard
  before insert or update or delete on public.membership_operation_scopes
  for each row execute function private.tg_operation_scope_guard();
create trigger membership_operation_scopes_set_stamps
  before insert or update on public.membership_operation_scopes
  for each row execute function private.tg_set_stamps();
create trigger membership_operation_scopes_audit
  after insert or update or delete on public.membership_operation_scopes
  for each row execute function private.tg_audit();

create trigger organization_memberships_revoke_scopes
  after update on public.organization_memberships
  for each row execute function private.tg_membership_revoke_scopes();

create trigger access_profile_mappings_set_stamps
  before insert or update on public.access_profile_mappings
  for each row execute function private.tg_set_stamps();
create trigger access_profile_mappings_prevent_tenant_change
  before update on public.access_profile_mappings
  for each row execute function private.tg_prevent_tenant_change();
create trigger access_profile_mappings_audit
  after insert or update or delete on public.access_profile_mappings
  for each row execute function private.tg_audit();
