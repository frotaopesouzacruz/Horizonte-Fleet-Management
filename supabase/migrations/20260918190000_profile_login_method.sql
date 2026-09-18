-- =============================================================================
-- HFM · How a profile signs in
--
-- Rule from the business: people on the "Operacional" profile sign in with their
-- matrícula; every other profile signs in with the registered corporate e-mail.
-- The data agrees exactly — of 143 live employees, the 123 on Operacional have
-- no e-mail at all, and all 20 on the other six profiles have one.
--
-- This is stored as an explicit column rather than matched against
-- business_profiles.name. Two reasons, and both are the same reason:
--   * renaming the profile would silently lock 123 people out of the system,
--     the way a mutable slug would orphan an identity;
--   * the Perfil column of the QLP sheet must never decide anything about the
--     system on the strength of its text alone.
-- The seed below is a one-time reading of today's data, not a rule. From here
-- an administrator sets it.
-- =============================================================================

alter table public.business_profiles
  add column if not exists login_method text not null default 'email';

alter table public.business_profiles
  drop constraint if exists business_profiles_login_method_check;

alter table public.business_profiles
  add constraint business_profiles_login_method_check
    check (login_method in ('email', 'employee_code'));

-- One-time alignment with the imported base. Deliberately matches the
-- normalized label once, here, so that nothing downstream ever has to.
update public.business_profiles
   set login_method = 'employee_code'
 where private.normalize_label(name) = 'operacional'
   and login_method <> 'employee_code';

comment on column public.business_profiles.login_method is
  'Which credential identifies a person on this profile: ''email'' (the registered corporate e-mail) or ''employee_code'' (the matrícula). Set explicitly — never inferred from the profile name, so renaming a profile cannot change how anyone signs in.';
