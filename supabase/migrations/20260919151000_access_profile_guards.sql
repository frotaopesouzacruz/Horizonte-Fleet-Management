-- =============================================================================
-- ETAPA 05 · ACCESS PROFILES — THE GUARDS
--
-- The rule this file exists for:
--
--   a spreadsheet, an API, the QLP base, an ERP, a webhook or any other
--   synchronisation NEVER changes somebody's access profile.
--
-- A file that says "Administrador" in a column is describing a job, not
-- granting one. The HFM access profile is changed by a person who holds the
-- authority, through an RPC, with a reason — or it is not changed.
--
-- That is enforced here, in the database, and not only in the interface:
-- membership_roles, membership_operation_scopes and role_permissions refuse
-- every write that does not arrive through one of those audited RPCs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.is_migration_context()
-- A migration running as the database owner. Not service_role: an integration
-- holding the service key is exactly what the rule above is about.
-- -----------------------------------------------------------------------------
create or replace function private.is_migration_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() is null and auth.uid() is null and session_user <> 'authenticator';
$$;

grant execute on function private.is_migration_context() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.access_change_begin()
-- Opens the gate for the rest of the transaction. Called at the top of the few
-- RPCs allowed to move privilege, and nowhere else.
-- -----------------------------------------------------------------------------
create or replace function private.access_change_begin()
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('hfm.access_change', 'on', true);
$$;

revoke execute on function private.access_change_begin() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The guard itself.
-- -----------------------------------------------------------------------------
create or replace function private.tg_access_privilege_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_migration_context() then
    return coalesce(new, old);
  end if;
  if coalesce(current_setting('hfm.access_change', true), '') <> 'on' then
    raise exception
      'Perfil de acesso, escopo de operação e matriz de permissões só podem ser alterados pelas rotinas de administração de acesso. Importações, integrações e sincronizações não alteram acesso.'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function private.tg_access_privilege_guard() from public;

drop trigger if exists membership_roles_access_guard on public.membership_roles;
create trigger membership_roles_access_guard
  before insert or update or delete on public.membership_roles
  for each row execute function private.tg_access_privilege_guard();

drop trigger if exists membership_operation_scopes_access_guard on public.membership_operation_scopes;
create trigger membership_operation_scopes_access_guard
  before insert or update or delete on public.membership_operation_scopes
  for each row execute function private.tg_access_privilege_guard();

drop trigger if exists role_permissions_access_guard on public.role_permissions;
create trigger role_permissions_access_guard
  before insert or update or delete on public.role_permissions
  for each row execute function private.tg_access_privilege_guard();

-- -----------------------------------------------------------------------------
-- Administrator authority
-- -----------------------------------------------------------------------------

-- Does this organization still have somebody who can administer access?
create or replace function private.has_active_administrator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
      join public.membership_roles mr on mr.membership_id = m.id
      join public.roles r             on r.id = mr.role_id
      join public.access_profiles ap  on ap.code = r.code and ap.is_administrator
     where m.organization_id = p_organization_id
       and m.status = 'active'
       and r.organization_id = p_organization_id
       and r.deleted_at is null
  );
$$;

grant execute on function private.has_active_administrator(uuid) to authenticated, service_role;

-- The last active Administrador cannot be demoted, suspended or removed.
-- An organization that never had one is not affected: the check only runs when
-- the change touches the administrator profile.
create or replace function private.tg_protect_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_was_admin boolean := false;
begin
  if tg_table_name = 'membership_roles' then
    select m.organization_id into v_org
      from public.organization_memberships m where m.id = old.membership_id;
    -- the membership itself is going away: nothing left to protect here
    if v_org is null then return null; end if;

    select exists (
      select 1 from public.roles r
        join public.access_profiles ap on ap.code = r.code and ap.is_administrator
       where r.id = old.role_id and r.organization_id = v_org
    ) into v_was_admin;
  else
    v_org := old.organization_id;
    v_was_admin := old.status = 'active'
               and new.status is distinct from 'active'
               and exists (
                     select 1
                       from public.membership_roles mr
                       join public.roles r            on r.id = mr.role_id
                       join public.access_profiles ap on ap.code = r.code and ap.is_administrator
                      where mr.membership_id = old.id and r.organization_id = v_org
                   );
  end if;

  if not v_was_admin then return null; end if;

  if not private.has_active_administrator(v_org) then
    raise exception 'Esta ação deixaria a organização sem um Administrador ativo.'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function private.tg_protect_last_administrator() from public;

drop trigger if exists membership_roles_protect_last_admin on public.membership_roles;
create trigger membership_roles_protect_last_admin
  after delete on public.membership_roles
  for each row execute function private.tg_protect_last_administrator();

drop trigger if exists memberships_protect_last_admin on public.organization_memberships;
create trigger memberships_protect_last_admin
  after update of status on public.organization_memberships
  for each row execute function private.tg_protect_last_administrator();

-- -----------------------------------------------------------------------------
-- public.access_profile_changes — who changed whose profile, and why
--
-- audit_logs already records the row change. This table records the decision:
-- the profiles before and after, in codes a person reads, and the reason the
-- administrator had to type. Append-only.
-- -----------------------------------------------------------------------------
create table if not exists public.access_profile_changes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  membership_id   uuid,
  target_user_id  uuid,
  actor_user_id   uuid,
  previous_codes  text[] not null default array[]::text[],
  new_codes       text[] not null default array[]::text[],
  reason          text not null,
  created_at      timestamptz not null default now(),

  constraint access_profile_changes_reason_check check (length(btrim(reason)) between 3 and 500)
);

comment on table public.access_profile_changes is
  'Append-only record of every access-profile change: before, after, actor and the reason given.';

create index if not exists access_profile_changes_org_idx
  on public.access_profile_changes (organization_id, created_at desc);
create index if not exists access_profile_changes_membership_idx
  on public.access_profile_changes (membership_id, created_at desc);

alter table public.access_profile_changes enable row level security;

drop trigger if exists access_profile_changes_append_only on public.access_profile_changes;
create trigger access_profile_changes_append_only
  before update or delete on public.access_profile_changes
  for each row execute function private.tg_block_mutation();

drop policy if exists access_profile_changes_select on public.access_profile_changes;
create policy access_profile_changes_select on public.access_profile_changes
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('roles.view')));

grant select on public.access_profile_changes to authenticated;

-- -----------------------------------------------------------------------------
-- public.access_profile_reviews — the pending-review queue
--
-- Where the system refuses to decide on its own it says so instead of guessing.
-- A spreadsheet claiming a profile, or a legacy role with no exact equivalent,
-- lands here for a person to settle.
-- -----------------------------------------------------------------------------
create table if not exists public.access_profile_reviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  membership_id   uuid,
  employee_id     uuid,
  reason_code     text not null,
  details         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid,

  constraint access_profile_reviews_reason_check check (reason_code in (
    'legacy_role_without_equivalent',
    'import_declared_profile_ignored',
    'membership_without_profile',
    'profile_outside_catalog'
  )),
  constraint access_profile_reviews_status_check check (status in ('pending', 'resolved', 'dismissed'))
);

comment on table public.access_profile_reviews is
  'Open questions about someone''s access profile that the system deliberately refused to answer automatically.';

create index if not exists access_profile_reviews_open_idx
  on public.access_profile_reviews (organization_id, status, created_at desc);

alter table public.access_profile_reviews enable row level security;

drop policy if exists access_profile_reviews_select on public.access_profile_reviews;
create policy access_profile_reviews_select on public.access_profile_reviews
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('roles.view')));

drop policy if exists access_profile_reviews_update on public.access_profile_reviews;
create policy access_profile_reviews_update on public.access_profile_reviews
  for update to authenticated
  using (organization_id in (select private.permitted_org_ids('roles.manage')))
  with check (organization_id in (select private.permitted_org_ids('roles.manage')));

grant select, update on public.access_profile_reviews to authenticated;
