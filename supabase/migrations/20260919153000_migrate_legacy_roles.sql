-- =============================================================================
-- ETAPA 05 · MOVING THE EXISTING ACCOUNTS ONTO THE OFFICIAL PROFILES
--
-- The rule for this migration is the one rule a privilege migration has:
-- it never grants anybody anything they did not already hold.
--
-- Each legacy platform role has an intended official equivalent. Before the
-- equivalent is assigned, its permission set is compared with what the account
-- already holds. If the equivalent would add even one permission, the account
-- gets the most restrictive official profile instead and a review is queued
-- for a person to settle. Losing a permission is allowed; gaining one is not.
-- =============================================================================

do $$
declare
  v_map constant jsonb := jsonb_build_object(
    'org_admin',     'administrador',
    'fleet_manager', 'gestor_frota',
    'leadership',    'gestao',
    'operator',      'operacional',
    'viewer',        'operacional'
  );
  v_member   record;
  v_target   text;
  v_role_id  uuid;
  v_added    text[];
begin
  for v_member in
    select distinct m.id as membership_id, m.organization_id, m.employee_id, r.code as legacy_code
      from public.organization_memberships m
      join public.membership_roles mr on mr.membership_id = m.id
      join public.roles r             on r.id = mr.role_id
     where r.organization_id is null
       and r.code in ('org_admin', 'fleet_manager', 'leadership', 'operator', 'viewer')
  loop
    v_target := v_map ->> v_member.legacy_code;

    -- Permissions the official profile would add to what this account already has.
    select coalesce(array_agg(d.permission_code order by d.permission_code), array[]::text[])
      into v_added
      from public.access_profile_defaults d
     where d.profile_code = v_target
       and d.permission_code not in (
         select p.code
           from public.membership_roles mr
           join public.roles r             on r.id = mr.role_id and r.deleted_at is null
           join public.role_permissions rp on rp.role_id = r.id
           join public.permissions p       on p.id = rp.permission_id
          where mr.membership_id = v_member.membership_id
       );

    if array_length(v_added, 1) > 0 then
      -- Refuse to decide. Floor profile now, question recorded for a person.
      v_target := 'operacional';

      insert into public.access_profile_reviews
        (organization_id, membership_id, employee_id, reason_code, details)
      values
        (v_member.organization_id, v_member.membership_id, v_member.employee_id,
         'legacy_role_without_equivalent',
         jsonb_build_object(
           'legacy_role',          v_member.legacy_code,
           'intended_profile',     v_map ->> v_member.legacy_code,
           'assigned_profile',     'operacional',
           'permissions_withheld', to_jsonb(v_added)
         ));
    end if;

    select r.id into v_role_id
      from public.roles r
     where r.organization_id = v_member.organization_id
       and r.code = v_target
       and r.deleted_at is null;

    if v_role_id is null then
      raise exception 'official profile % missing for organization %', v_target, v_member.organization_id;
    end if;

    -- Assign first, remove after: the last-administrator protection must never
    -- see a moment where the organization has nobody.
    insert into public.membership_roles (membership_id, role_id)
    values (v_member.membership_id, v_role_id)
    on conflict (membership_id, role_id) do nothing;

    delete from public.membership_roles mr
     using public.roles r
     where mr.membership_id = v_member.membership_id
       and r.id = mr.role_id
       and r.organization_id is null
       and r.code = v_member.legacy_code;
  end loop;
end;
$$;

-- An account that ends up with no profile at all is a question, not a default.
insert into public.access_profile_reviews
  (organization_id, membership_id, employee_id, reason_code, details)
select m.organization_id, m.id, m.employee_id, 'membership_without_profile', '{}'::jsonb
  from public.organization_memberships m
 where m.status in ('invited', 'active', 'suspended')
   and not exists (select 1 from public.membership_roles mr where mr.membership_id = m.id)
   and not exists (
     select 1 from public.access_profile_reviews ar
      where ar.membership_id = m.id and ar.status = 'pending'
        and ar.reason_code = 'membership_without_profile'
   );

-- The legacy platform roles are retired. Archiving them takes them out of every
-- picker and every membership; the official profiles carry the access now.
update public.roles
   set deleted_at = now()
 where organization_id is null
   and deleted_at is null
   and code in ('org_admin', 'fleet_manager', 'leadership', 'operator', 'viewer');
