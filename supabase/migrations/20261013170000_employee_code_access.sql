-- =============================================================================
-- HFM · Acesso por matrícula (perfil Operacional): sem e-mail, senha inicial = CPF
--
-- Regra do negócio: quem está num perfil organizacional com
-- business_profiles.login_method = 'employee_code' (hoje, Operacional: 123
-- pessoas, nenhuma com e-mail) entra no HFM com a matrícula e uma senha, e a
-- senha inicial são os 6 primeiros dígitos do CPF cadastrado. Nenhum e-mail é
-- exigido para conceder o acesso e nenhum e-mail é enviado: a conta nasce
-- confirmada.
--
-- O que muda:
--   * private.employee_login_method — como uma pessoa entra, lido do perfil
--     organizacional vigente (sem perfil: por e-mail). Um lugar só.
--   * public.prepare_employee_access_v2 — a validação que já existia, mais a
--     resposta de COMO a pessoa entra: login_method, matrícula, nome e, só
--     para quem ainda não tem conta num perfil por matrícula, a senha inicial.
--     Exige CPF nesse caso e e-mail corporativo no outro. Só com
--     users.manage_access.
--   * public.employee_code_initial_password — "Redefinir senha inicial" de
--     uma conta por matrícula já existente (não há e-mail para receber um
--     link). Devolve a senha inicial e registra user.initial_password_issued
--     com quem pediu; a aplicação aplica a senha pela API de administração.
--   * public.employee_directory ganha login_method no fim (create or replace
--     view só acrescenta colunas ao final).
--   * public.prepare_employee_access (assinatura antiga) passa a ler a nova:
--     nenhum chamador quebra e a regra vive num lugar só.
--   * public.grant_employee_access_v2 — a concessão de sempre, e a conta por
--     matrícula nasce ativa; public.accept_my_invitations — quem entra por
--     e-mail ativa o próprio convite ao definir a senha (antes nada fazia isso).
--
-- A senha inicial sai do banco só por estas duas funções, só para quem tem
-- users.manage_access, e nunca é gravada: é derivada do CPF no momento da
-- concessão ou da redefinição. Nada aqui apaga ou reescreve dados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.employee_login_method(uuid)
-- -----------------------------------------------------------------------------
create or replace function private.employee_login_method(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bp.login_method
       from public.employee_assignments a
       join public.business_profiles bp on bp.id = a.business_profile_id
      where a.employee_id = p_employee_id and a.is_current
      order by a.effective_from desc
      limit 1),
    'email');
$$;
revoke execute on function private.employee_login_method(uuid) from public, anon, authenticated;

comment on function private.employee_login_method(uuid) is
  'Internal: ''email'' or ''employee_code'' — how this person signs in, from the current assignment''s business profile. No profile means e-mail.';

-- -----------------------------------------------------------------------------
-- public.prepare_employee_access_v2(uuid, uuid[], uuid[])
-- Everything that can be checked before an auth user exists is checked here,
-- so provisioning never leaves an account behind without a membership. The
-- answer also says how the account must be created.
-- -----------------------------------------------------------------------------
create or replace function public.prepare_employee_access_v2(
  p_employee_id   uuid,
  p_role_ids      uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns table (
  organization_id  uuid,
  login_method     text,
  email            text,
  employee_code    text,
  full_name        text,
  initial_password text,
  membership_id    uuid,
  account_user_id  uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_email  text;
  v_code   text;
  v_name   text;
  v_method text;
  v_cpf    text;
  v_op     uuid;
begin
  select e.organization_id, e.corporate_email, e.employee_code, e.full_name
    into v_org, v_email, v_code, v_name
    from public.employees e
   where e.id = p_employee_id and e.deleted_at is null;

  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;

  v_method := private.employee_login_method(p_employee_id);

  if v_method = 'employee_code' then
    select pd.cpf into v_cpf from public.employee_private_data pd where pd.employee_id = p_employee_id;
    if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
      raise exception 'Este colaborador não possui CPF cadastrado. No acesso por matrícula a senha inicial são os 6 primeiros dígitos do CPF: informe o CPF antes de conceder o acesso.'
        using errcode = 'invalid_parameter_value';
    end if;
    -- O e-mail corporativo, quando existe, não é o login desta pessoa.
    v_email := null;
  elsif v_email is null then
    raise exception 'Este colaborador não possui e-mail corporativo. Cadastre um e-mail válido antes de conceder acesso.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.assert_can_assign_roles(v_org, null, p_role_ids);

  if coalesce(array_length(p_operation_ids, 1), 0) > 0
     and not private.has_permission(v_org, 'users.manage_operation_scope') then
    raise exception 'permission users.manage_operation_scope is required' using errcode = 'insufficient_privilege';
  end if;

  foreach v_op in array coalesce(p_operation_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.operations o
                    where o.id = v_op and o.organization_id = v_org and o.deleted_at is null) then
      raise exception 'operation % is not available in this organization', v_op using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  return query
    -- Já tem conta: a senha inicial não é reemitida por aqui.
    select v_org, v_method, v_email, v_code, v_name, null::text, m.id, m.user_id
      from public.organization_memberships m
     where m.organization_id = v_org and m.employee_id = p_employee_id
    union all
    select v_org, v_method, v_email, v_code, v_name,
           case when v_method = 'employee_code' then left(v_cpf, 6) end,
           null::uuid, null::uuid
     where not exists (
       select 1 from public.organization_memberships m2
        where m2.organization_id = v_org and m2.employee_id = p_employee_id
     );
end;
$$;
revoke execute on function public.prepare_employee_access_v2(uuid, uuid[], uuid[]) from public, anon;
grant  execute on function public.prepare_employee_access_v2(uuid, uuid[], uuid[]) to authenticated;

comment on function public.prepare_employee_access_v2(uuid, uuid[], uuid[]) is
  'Validates a grant before the auth user exists and says how the account signs in. login_method ''employee_code'': no e-mail, initial_password = first 6 digits of the CPF (only while there is no account). ''email'': the corporate e-mail receives the invitation.';

-- -----------------------------------------------------------------------------
-- public.prepare_employee_access(uuid, uuid[], uuid[]) — assinatura antiga,
-- mesma resposta de antes, lida da nova função.
-- -----------------------------------------------------------------------------
create or replace function public.prepare_employee_access(
  p_employee_id   uuid,
  p_role_ids      uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns table (organization_id uuid, email text, membership_id uuid, account_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select v.organization_id, v.email, v.membership_id, v.account_user_id
    from public.prepare_employee_access_v2(p_employee_id, p_role_ids, p_operation_ids) v;
$$;

-- -----------------------------------------------------------------------------
-- public.employee_code_initial_password(uuid)
-- "Redefinir senha inicial" de quem entra por matrícula. Não grava nada além
-- do evento; a aplicação aplica a senha pela API de administração.
-- -----------------------------------------------------------------------------
create or replace function public.employee_code_initial_password(p_employee_id uuid)
returns table (organization_id uuid, employee_code text, account_user_id uuid, initial_password text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_code       text;
  v_cpf        text;
  v_membership uuid;
  v_user       uuid;
  v_status     text;
begin
  select e.organization_id, e.employee_code into v_org, v_code
    from public.employees e
   where e.id = p_employee_id and e.deleted_at is null;

  if v_org is null then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.manage_access') then
    raise exception 'permission users.manage_access is required' using errcode = 'insufficient_privilege';
  end if;
  if private.employee_login_method(p_employee_id) <> 'employee_code' then
    raise exception 'Este colaborador entra com e-mail: a senha é redefinida pelo link enviado ao e-mail corporativo, não por aqui.'
      using errcode = 'invalid_parameter_value';
  end if;

  select m.id, m.user_id, m.status into v_membership, v_user, v_status
    from public.organization_memberships m
   where m.organization_id = v_org and m.employee_id = p_employee_id;

  if v_user is null then
    raise exception 'Este colaborador ainda não possui conta no HFM: conceda o acesso em vez de redefinir a senha.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_status = 'removed' then
    raise exception 'O acesso deste colaborador foi removido: conceda o acesso de novo em vez de redefinir a senha.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_user = (select auth.uid()) then
    raise exception 'A própria senha não é redefinida por aqui.' using errcode = 'invalid_parameter_value';
  end if;

  select pd.cpf into v_cpf from public.employee_private_data pd where pd.employee_id = p_employee_id;
  if v_cpf is null or v_cpf !~ '^[0-9]{11}$' then
    raise exception 'Este colaborador não possui CPF cadastrado. A senha inicial são os 6 primeiros dígitos do CPF: informe o CPF antes de redefinir a senha.'
      using errcode = 'invalid_parameter_value';
  end if;

  perform private.emit_event(
    v_org, 'user.initial_password_issued', 'employee', p_employee_id,
    jsonb_build_object('membership_id', v_membership, 'actor_user_id', (select auth.uid()), 'method', 'employee_code')
  );

  return query select v_org, v_code, v_user, left(v_cpf, 6);
end;
$$;
revoke execute on function public.employee_code_initial_password(uuid) from public, anon;
grant  execute on function public.employee_code_initial_password(uuid) to authenticated;

comment on function public.employee_code_initial_password(uuid) is
  'Issues the initial password (first 6 digits of the CPF) of an existing employee_code account to an administrator with users.manage_access, recording user.initial_password_issued. The application applies it through the Auth Admin API.';

-- -----------------------------------------------------------------------------
-- public.employee_directory — mesma view, mais login_method ao final.
-- -----------------------------------------------------------------------------
create or replace view public.employee_directory
with (security_invoker = on) as
select
  e.id,
  e.organization_id,
  e.employee_code,
  e.full_name,
  e.corporate_email,
  e.employment_status,
  e.admission_date,
  e.termination_date,
  e.deleted_at,
  e.created_at,
  e.updated_at,
  -- normalized forms so search and ordering are accent-insensitive
  private.normalize_label(e.full_name) as search_name,

  a.id                   as assignment_id,
  a.job_position_id,
  jp.name                as job_position_name,
  jp.code                as job_position_code,
  a.employment_area_id,
  ar.name                as employment_area_name,
  a.operation_id,
  op.name                as operation_name,
  a.organization_unit_id,
  ou.name                as organization_unit_name,
  ou.code                as organization_unit_code,
  a.work_location_id,
  wl.name                as work_location_name,
  a.business_profile_id,
  bp.name                as business_profile_name,
  a.manager_employee_id,
  mg.full_name           as manager_name,

  dl.id                  as driver_license_id,
  dl.category            as license_category,
  dl.expiration_date     as license_expiration_date,
  dl.points              as license_points,
  case
    when dl.id is null or dl.expiration_date is null then null
    when dl.expiration_date < current_date then 'expired'
    when dl.expiration_date <= current_date + 60 then 'expiring'
    else 'valid'
  end                    as license_state,

  m.id                   as membership_id,
  m.user_id              as account_user_id,
  -- Employment situation and HFM access are different things and are reported
  -- separately on purpose.
  coalesce(m.status, 'none') as access_status,
  m.joined_at            as access_since,
  m.updated_at           as access_updated_at,
  coalesce(r.role_codes, array[]::text[]) as access_role_codes,
  coalesce(r.role_names, array[]::text[]) as access_role_names,
  coalesce(s.operation_count, 0)          as access_operation_count,
  coalesce(r.has_access_all, false)       as access_all_operations,
  -- Como a pessoa entra no HFM (e-mail ou matrícula), pelo perfil organizacional vigente.
  coalesce(bp.login_method, 'email')     as login_method
from public.employees e
left join public.employee_assignments a
       on a.employee_id = e.id and a.is_current
left join public.job_positions      jp on jp.id = a.job_position_id
left join public.employment_areas   ar on ar.id = a.employment_area_id
left join public.operations         op on op.id = a.operation_id
left join public.organization_units ou on ou.id = a.organization_unit_id
left join public.work_locations     wl on wl.id = a.work_location_id
left join public.business_profiles  bp on bp.id = a.business_profile_id
left join public.employees          mg on mg.id = a.manager_employee_id
left join public.driver_licenses    dl on dl.employee_id = e.id and dl.deleted_at is null
left join public.organization_memberships m
       on m.organization_id = e.organization_id and m.employee_id = e.id
left join lateral (
  select array_agg(ro.code order by ro.code)  as role_codes,
         array_agg(ro.name order by ro.code)  as role_names,
         bool_or(exists (
           select 1 from public.role_permissions rp
             join public.permissions pe on pe.id = rp.permission_id
            where rp.role_id = ro.id and pe.code = 'operations.access_all'
         ))                                    as has_access_all
    from public.membership_roles mr
    join public.roles ro on ro.id = mr.role_id
   where mr.membership_id = m.id
) r on m.id is not null
left join lateral (
  select count(*) as operation_count
    from public.membership_operation_scopes sc
   where sc.membership_id = m.id
) s on m.id is not null;

-- -----------------------------------------------------------------------------
-- public.grant_employee_access_v2(uuid, uuid, uuid[], uuid[])
-- A concessão de sempre (grant_employee_access, intacta), mais a regra de quem
-- entra por matrícula: a conta nasce 'active', porque não há convite a aceitar.
-- A de quem entra por e-mail continua 'invited' até a pessoa definir a própria
-- senha (accept_my_invitations, abaixo).
-- -----------------------------------------------------------------------------
create or replace function public.grant_employee_access_v2(
  p_employee_id   uuid,
  p_user_id       uuid,
  p_role_ids      uuid[] default array[]::uuid[],
  p_operation_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership uuid;
begin
  v_membership := public.grant_employee_access(p_employee_id, p_user_id, p_role_ids, p_operation_ids);

  if private.employee_login_method(p_employee_id) = 'employee_code' then
    update public.organization_memberships m
       set status = 'active',
           joined_at = coalesce(m.joined_at, now())
     where m.id = v_membership and m.status = 'invited';
  end if;

  return v_membership;
end;
$$;
revoke execute on function public.grant_employee_access_v2(uuid, uuid, uuid[], uuid[]) from public, anon;
grant  execute on function public.grant_employee_access_v2(uuid, uuid, uuid[], uuid[]) to authenticated;

comment on function public.grant_employee_access_v2(uuid, uuid, uuid[], uuid[]) is
  'grant_employee_access plus the matrícula rule: an employee_code account is born active (no invitation to accept); an e-mail account stays invited until accept_my_invitations().';

-- -----------------------------------------------------------------------------
-- public.accept_my_invitations()
-- Quem entra pelo link do convite e define a própria senha ativa os próprios
-- convites. Antes nada fazia isso: a conta ficava 'invited' e a sessão, que só
-- carrega vínculos 'active', mandava a pessoa para /sem-organizacao.
-- -----------------------------------------------------------------------------
create or replace function public.accept_my_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_row   record;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    update public.organization_memberships m
       set status = 'active',
           joined_at = coalesce(m.joined_at, now())
     where m.user_id = v_user and m.status = 'invited'
    returning m.id, m.organization_id, m.employee_id
  loop
    perform private.emit_event(
      v_row.organization_id, 'user.invitation_accepted',
      case when v_row.employee_id is null then 'membership' else 'employee' end,
      coalesce(v_row.employee_id, v_row.id),
      jsonb_build_object('membership_id', v_row.id)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke execute on function public.accept_my_invitations() from public, anon;
grant  execute on function public.accept_my_invitations() to authenticated;

comment on function public.accept_my_invitations() is
  'Activates the caller''s own invited memberships (status invited → active, joined_at set) and records user.invitation_accepted. Called when the invited person sets their password.';
