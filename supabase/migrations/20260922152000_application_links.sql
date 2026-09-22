-- =============================================================================
-- Refinamento da Etapa 12 — vínculos Aplicativo × Operação e Aplicativo × Tipo
-- de Equipamento como fonte única de disponibilidade (§8–§27, CA04–CA10, CA26)
--
-- NENHUMA tabela nova. As duas estruturas já existiam e são reaproveitadas:
--
--   checklist_app_operations   (Etapa 12)  aplicativo × operação, `is_enabled`
--   vehicle_type_apps          (Etapa 07)  aplicativo × tipo de equipamento
--
-- O nome da primeira carrega o prefixo histórico `checklist_`; a estrutura é
-- genérica desde o início (FK para operational_apps) e passa a ser o vínculo
-- de QUALQUER aplicativo. Renomear quebraria as rotinas que a citam sem ganho
-- funcional — o que importa é que exista uma só fonte, lida por todas as telas.
--
-- O que muda:
--   · as duas tabelas ganham vigência (`effective_from`/`effective_to`) e
--     carimbo de atualização; `vehicle_type_apps` ganha `is_enabled`, para que
--     desabilitar seja um registro auditável e não a ausência de linha;
--   · três permissões novas (§27) e as rotinas de leitura e gravação que as
--     telas de Operações, Tipos de Equipamento e do Gerenciador compartilham;
--   · a elegibilidade do veículo passa a ser uma rotina do servidor (§23,
--     §38): aplicativo ativo + operação habilitada + tipo habilitado + veículo
--     na operação na data + situação compatível. Contexto, tipos, placas,
--     formulário e envio conferem a MESMA rotina;
--   · a Aderência só espera checklist de tipo habilitado na data (§45), sem
--     apagar nada do passado.
--
-- SEMÂNTICA DA AUSÊNCIA DE VÍNCULO (§13, §20): sem linha = NÃO habilitado.
-- Uma operação ou um tipo recém-cadastrado não aparece em aplicativo nenhum
-- até que alguém autorize explicitamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vigência e carimbos (§22)
-- -----------------------------------------------------------------------------
alter table public.checklist_app_operations
  add column if not exists effective_from date,
  add column if not exists effective_to   date,
  add column if not exists updated_at     timestamptz not null default now(),
  add column if not exists updated_by     uuid references auth.users (id) on delete set null;

alter table public.vehicle_type_apps
  add column if not exists is_enabled     boolean not null default true,
  add column if not exists effective_from date,
  add column if not exists effective_to   date,
  add column if not exists updated_at     timestamptz not null default now(),
  add column if not exists updated_by     uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_app_ops_vigencia_check') then
    alter table public.checklist_app_operations
      add constraint checklist_app_ops_vigencia_check
      check (effective_to is null or effective_from is null or effective_to >= effective_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_type_apps_vigencia_check') then
    alter table public.vehicle_type_apps
      add constraint vehicle_type_apps_vigencia_check
      check (effective_to is null or effective_from is null or effective_to >= effective_from);
  end if;
end $$;

comment on table public.checklist_app_operations is
  'Vínculo APLICATIVO × OPERAÇÃO — fonte única de "aplicativos habilitados" da '
  'operação, lida pelo módulo Operações, pelo Gerenciador de Aplicativos e '
  'pelos executores. Sem linha ou is_enabled = false: o aplicativo não está '
  'disponível para a operação. O prefixo checklist_ é histórico; a FK é para '
  'operational_apps e a estrutura serve a qualquer aplicativo.';

comment on table public.vehicle_type_apps is
  'Vínculo APLICATIVO × TIPO DE EQUIPAMENTO — fonte única de "aplicativos '
  'habilitados" do tipo, lida pelo módulo Tipos de Equipamento, pelo '
  'Gerenciador de Aplicativos e pelos executores. Sem linha ou is_enabled = '
  'false: os veículos do tipo não aparecem no aplicativo.';

-- -----------------------------------------------------------------------------
-- 2. Permissões (§27)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('applications.manage_operation_links', 'applications', 'Habilitar aplicativos por operação',
   'Definir quais aplicativos cada operação pode utilizar'),
  ('applications.manage_equipment_links', 'applications', 'Habilitar aplicativos por tipo de equipamento',
   'Definir quais aplicativos os veículos de cada tipo de equipamento podem utilizar'),
  ('applications.manage_eligibility', 'applications', 'Gerenciar elegibilidade de aplicativos',
   'Consultar e revisar a elegibilidade consolidada (operação × tipo × veículo) dos aplicativos')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('administrador', 'applications.manage_operation_links'),
    ('administrador', 'applications.manage_equipment_links'),
    ('administrador', 'applications.manage_eligibility'),
    ('gestor_frota',  'applications.manage_operation_links'),
    ('gestor_frota',  'applications.manage_equipment_links'),
    ('gestor_frota',  'applications.manage_eligibility')
  ) as d(profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Auxiliares de elegibilidade (§23, §25)
-- -----------------------------------------------------------------------------

-- Operação habilitada no aplicativo NA DATA.
create or replace function private.app_operation_enabled(
  p_app_id uuid, p_operation_id uuid, p_date date default current_date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.checklist_app_operations ao
     where ao.app_id = p_app_id and ao.operation_id = p_operation_id and ao.is_enabled
       and (ao.effective_from is null or ao.effective_from <= p_date)
       and (ao.effective_to is null or ao.effective_to >= p_date));
$$;

-- Tipo de equipamento habilitado no aplicativo NA DATA, para a organização.
create or replace function private.app_vehicle_type_enabled(
  p_organization_id uuid, p_app_id uuid, p_vehicle_type_id uuid, p_date date default current_date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.vehicle_type_apps ta
     where ta.organization_id = p_organization_id and ta.app_id = p_app_id
       and ta.vehicle_type_id = p_vehicle_type_id and ta.is_enabled
       and (ta.effective_from is null or ta.effective_from <= p_date)
       and (ta.effective_to is null or ta.effective_to >= p_date));
$$;

-- O veículo pertence à operação na data: pela Fidelização (BR primário
-- confirmado/executado) OU pela alocação operacional do cadastro (§24, §33).
create or replace function private.vehicle_in_operation(
  p_organization_id uuid, p_vehicle_id uuid, p_operation_id uuid, p_date date default current_date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.fidelization_assignments fa
      join public.operation_brs b on b.id = fa.operation_br_id and b.deleted_at is null
     where fa.organization_id = p_organization_id and fa.vehicle_id = p_vehicle_id
       and fa.status in ('confirmed', 'executed') and fa.vehicle_role = 'primary'
       and fa.start_date <= p_date and (fa.end_date is null or fa.end_date >= p_date)
       and b.operation_id = p_operation_id)
  or exists (
    select 1 from public.vehicle_operation_assignments a
     where a.organization_id = p_organization_id and a.vehicle_id = p_vehicle_id
       and a.operation_id = p_operation_id
       and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date));
$$;

-- A REGRA PRINCIPAL (§23): todas as condições, no servidor. O escopo do
-- usuário é conferido pelas rotinas chamadoras (can_access_operation,
-- vehicle_in_scope) — esta responde apenas se a COMBINAÇÃO é permitida.
create or replace function private.app_vehicle_eligible(
  p_organization_id uuid, p_app_id uuid, p_vehicle_id uuid, p_operation_id uuid,
  p_date date default current_date)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_app record;
  v_op  record;
  v_veh record;
  v_restrict boolean;
begin
  select a.id, a.is_active into v_app from public.operational_apps a
   where a.id = p_app_id and a.organization_id = p_organization_id and a.deleted_at is null;
  if v_app.id is null or not v_app.is_active then return false; end if;

  select o.id into v_op from public.operations o
   where o.id = p_operation_id and o.organization_id = p_organization_id
     and o.deleted_at is null and o.status = 'active';
  if v_op.id is null then return false; end if;

  if not private.app_operation_enabled(p_app_id, p_operation_id, p_date) then return false; end if;

  select v.id, v.vehicle_type_id, v.status into v_veh from public.vehicles v
   where v.id = p_vehicle_id and v.organization_id = p_organization_id and v.deleted_at is null;
  if v_veh.id is null or v_veh.status <> 'active' then return false; end if;

  if not private.app_vehicle_type_enabled(p_organization_id, p_app_id, v_veh.vehicle_type_id, p_date) then
    return false;
  end if;

  -- Etapa 07: um tipo pode restringir as operações em que atua.
  select s.operation_restriction_enabled into v_restrict from public.vehicle_type_settings s
   where s.organization_id = p_organization_id and s.vehicle_type_id = v_veh.vehicle_type_id;
  if coalesce(v_restrict, false) and not exists (
       select 1 from public.vehicle_type_operations vo
        where vo.organization_id = p_organization_id
          and vo.vehicle_type_id = v_veh.vehicle_type_id and vo.operation_id = p_operation_id) then
    return false;
  end if;

  return private.vehicle_in_operation(p_organization_id, p_vehicle_id, p_operation_id, p_date);
end;
$$;

revoke execute on function private.app_operation_enabled(uuid, uuid, date) from public, anon;
revoke execute on function private.app_vehicle_type_enabled(uuid, uuid, uuid, date) from public, anon;
revoke execute on function private.vehicle_in_operation(uuid, uuid, uuid, date) from public, anon;
revoke execute on function private.app_vehicle_eligible(uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function private.app_operation_enabled(uuid, uuid, date) to authenticated, service_role;
grant execute on function private.app_vehicle_type_enabled(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function private.vehicle_in_operation(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function private.app_vehicle_eligible(uuid, uuid, uuid, uuid, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Leitura dos vínculos — UMA rotina para as três telas (§26)
--
-- security definer com conferência de permissão: quem vê Operações, Tipos de
-- Equipamento ou Aplicativos pode ler o estado dos vínculos. Ler não é sensível;
-- gravar é, e fica nas rotinas da seção 5.
-- -----------------------------------------------------------------------------
create or replace function public.application_links_overview(
  p_organization_id uuid,
  p_app_id          uuid default null,
  p_operation_id    uuid default null,
  p_vehicle_type_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (private.has_permission(p_organization_id, 'applications.view')
          or private.has_permission(p_organization_id, 'operations.view')
          or private.has_permission(p_organization_id, 'equipment_types.view')
          or private.has_permission(p_organization_id, 'applications.manage_operation_links')
          or private.has_permission(p_organization_id, 'applications.manage_equipment_links')
          or private.has_permission(p_organization_id, 'applications.manage_eligibility')) then
    raise exception 'Você não possui permissão para consultar os vínculos de aplicativos.'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'apps', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'slug', a.slug,
                                          'is_active', a.is_active) order by a.name)
        from public.operational_apps a
       where a.organization_id = p_organization_id and a.deleted_at is null
         and (p_app_id is null or a.id = p_app_id)), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'status', o.status)
                       order by o.name)
        from public.operations o
       where o.organization_id = p_organization_id and o.deleted_at is null
         and (p_operation_id is null or o.id = p_operation_id)), '[]'::jsonb),
    'vehicle_types', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name,
                                          'is_active', t.is_active,
                                          'scope', case when t.organization_id is null then 'global' else 'organization' end)
                       order by t.name)
        from public.vehicle_types t
       where t.deleted_at is null
         and (t.organization_id = p_organization_id or t.organization_id is null)
         and (p_vehicle_type_id is null or t.id = p_vehicle_type_id)), '[]'::jsonb),
    'operation_links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'app_id', ao.app_id, 'operation_id', ao.operation_id, 'is_enabled', ao.is_enabled,
               'effective_from', ao.effective_from, 'effective_to', ao.effective_to,
               'updated_at', ao.updated_at,
               'in_force', private.app_operation_enabled(ao.app_id, ao.operation_id, current_date)))
        from public.checklist_app_operations ao
       where ao.organization_id = p_organization_id
         and (p_app_id is null or ao.app_id = p_app_id)
         and (p_operation_id is null or ao.operation_id = p_operation_id)), '[]'::jsonb),
    'type_links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'app_id', ta.app_id, 'vehicle_type_id', ta.vehicle_type_id, 'is_enabled', ta.is_enabled,
               'effective_from', ta.effective_from, 'effective_to', ta.effective_to,
               'updated_at', ta.updated_at,
               'in_force', private.app_vehicle_type_enabled(p_organization_id, ta.app_id, ta.vehicle_type_id, current_date)))
        from public.vehicle_type_apps ta
       where ta.organization_id = p_organization_id
         and (p_app_id is null or ta.app_id = p_app_id)
         and (p_vehicle_type_id is null or ta.vehicle_type_id = p_vehicle_type_id)), '[]'::jsonb));
end;
$$;

revoke execute on function public.application_links_overview(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.application_links_overview(uuid, uuid, uuid, uuid) to authenticated;

-- §9 "consultar histórico de alterações": a trilha oficial de auditoria dos
-- dois vínculos, com o nome de quem alterou resolvido pelo vínculo de membro.
create or replace function public.application_link_history(
  p_organization_id uuid,
  p_filters         jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_app  uuid := nullif(p_filters ->> 'app_id', '')::uuid;
  v_op   uuid := nullif(p_filters ->> 'operation_id', '')::uuid;
  v_type uuid := nullif(p_filters ->> 'vehicle_type_id', '')::uuid;
  v_lim  int  := greatest(1, least(coalesce((p_filters ->> 'limit')::int, 50), 200));
begin
  if not (private.has_permission(p_organization_id, 'audit.view')
          or private.has_permission(p_organization_id, 'applications.manage_operation_links')
          or private.has_permission(p_organization_id, 'applications.manage_equipment_links')
          or private.has_permission(p_organization_id, 'applications.manage_eligibility')) then
    raise exception 'Você não possui permissão para consultar o histórico dos vínculos.'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc)
      from (
        select jsonb_build_object(
                 'id', l.id,
                 'created_at', l.created_at,
                 'action', l.action,
                 'kind', case when l.entity_type like '%checklist_app_operations' then 'operation' else 'vehicle_type' end,
                 'app_id', coalesce(l.new_data ->> 'app_id', l.old_data ->> 'app_id'),
                 'operation_id', coalesce(l.new_data ->> 'operation_id', l.old_data ->> 'operation_id'),
                 'vehicle_type_id', coalesce(l.new_data ->> 'vehicle_type_id', l.old_data ->> 'vehicle_type_id'),
                 'before', case when l.old_data is null then null else jsonb_build_object(
                             'is_enabled', (l.old_data ->> 'is_enabled')::boolean,
                             'effective_from', l.old_data ->> 'effective_from',
                             'effective_to', l.old_data ->> 'effective_to') end,
                 'after', case when l.new_data is null then null else jsonb_build_object(
                             'is_enabled', (l.new_data ->> 'is_enabled')::boolean,
                             'effective_from', l.new_data ->> 'effective_from',
                             'effective_to', l.new_data ->> 'effective_to') end,
                 'changed_fields', to_jsonb(l.changed_fields),
                 'user_name', (select e.full_name from public.organization_memberships m
                                 join public.employees e on e.id = m.employee_id
                                where m.user_id = l.user_id and m.organization_id = p_organization_id
                                limit 1)) as x
          from public.audit_logs l
         where l.organization_id = p_organization_id
           and (l.entity_type like '%checklist_app_operations' or l.entity_type like '%vehicle_type_apps')
           and (v_app is null or coalesce(l.new_data ->> 'app_id', l.old_data ->> 'app_id') = v_app::text)
           and (v_op is null or coalesce(l.new_data ->> 'operation_id', l.old_data ->> 'operation_id') = v_op::text)
           and (v_type is null or coalesce(l.new_data ->> 'vehicle_type_id', l.old_data ->> 'vehicle_type_id') = v_type::text)
         order by l.created_at desc
         limit v_lim
      ) s), '[]'::jsonb);
end;
$$;

revoke execute on function public.application_link_history(uuid, jsonb) from public, anon;
grant execute on function public.application_link_history(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Gravação dos vínculos (§27, §48, §50)
-- -----------------------------------------------------------------------------
create or replace function public.set_application_operation_link(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_app     record;
  v_op      record;
  v_enabled boolean := coalesce((p_payload ->> 'is_enabled')::boolean, true);
  v_from    date := nullif(p_payload ->> 'effective_from', '')::date;
  v_to      date := nullif(p_payload ->> 'effective_to', '')::date;
begin
  if not private.has_permission(p_organization_id, 'applications.manage_operation_links') then
    raise exception 'Você não possui permissão para habilitar aplicativos por operação.'
      using errcode = 'insufficient_privilege';
  end if;

  select a.id, a.name into v_app from public.operational_apps a
   where a.id = nullif(p_payload ->> 'app_id', '')::uuid
     and a.organization_id = p_organization_id and a.deleted_at is null;
  if v_app.id is null then
    raise exception 'Aplicativo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  select o.id, o.name into v_op from public.operations o
   where o.id = nullif(p_payload ->> 'operation_id', '')::uuid
     and o.organization_id = p_organization_id and o.deleted_at is null;
  if v_op.id is null then
    raise exception 'Operação não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'A vigência final não pode ser anterior à inicial.' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.checklist_app_operations
    (organization_id, app_id, operation_id, is_enabled, effective_from, effective_to, created_by, updated_by)
  values (p_organization_id, v_app.id, v_op.id, v_enabled, v_from, v_to, auth.uid(), auth.uid())
  on conflict (app_id, operation_id) do update
    set is_enabled = excluded.is_enabled,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('app_id', v_app.id, 'app_name', v_app.name,
                            'operation_id', v_op.id, 'operation_name', v_op.name,
                            'is_enabled', v_enabled, 'effective_from', v_from, 'effective_to', v_to,
                            'in_force', private.app_operation_enabled(v_app.id, v_op.id, current_date));
end;
$$;

revoke execute on function public.set_application_operation_link(uuid, jsonb) from public, anon;
grant execute on function public.set_application_operation_link(uuid, jsonb) to authenticated;

create or replace function public.set_application_vehicle_type_link(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_app     record;
  v_type    record;
  v_enabled boolean := coalesce((p_payload ->> 'is_enabled')::boolean, true);
  v_from    date := nullif(p_payload ->> 'effective_from', '')::date;
  v_to      date := nullif(p_payload ->> 'effective_to', '')::date;
begin
  if not private.has_permission(p_organization_id, 'applications.manage_equipment_links') then
    raise exception 'Você não possui permissão para habilitar aplicativos por tipo de equipamento.'
      using errcode = 'insufficient_privilege';
  end if;

  select a.id, a.name into v_app from public.operational_apps a
   where a.id = nullif(p_payload ->> 'app_id', '')::uuid
     and a.organization_id = p_organization_id and a.deleted_at is null;
  if v_app.id is null then
    raise exception 'Aplicativo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  -- Tipos globais (organization_id nulo) são compartilhados; tipos de outra
  -- organização não existem para esta (§48).
  select t.id, t.name into v_type from public.vehicle_types t
   where t.id = nullif(p_payload ->> 'vehicle_type_id', '')::uuid and t.deleted_at is null
     and (t.organization_id = p_organization_id or t.organization_id is null);
  if v_type.id is null then
    raise exception 'Tipo de equipamento não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'A vigência final não pode ser anterior à inicial.' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.vehicle_type_apps
    (organization_id, vehicle_type_id, app_id, is_enabled, effective_from, effective_to, created_by, updated_by)
  values (p_organization_id, v_type.id, v_app.id, v_enabled, v_from, v_to, auth.uid(), auth.uid())
  on conflict (organization_id, vehicle_type_id, app_id) do update
    set is_enabled = excluded.is_enabled,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('app_id', v_app.id, 'app_name', v_app.name,
                            'vehicle_type_id', v_type.id, 'vehicle_type_name', v_type.name,
                            'is_enabled', v_enabled, 'effective_from', v_from, 'effective_to', v_to,
                            'in_force', private.app_vehicle_type_enabled(p_organization_id, v_app.id, v_type.id, current_date));
end;
$$;

revoke execute on function public.set_application_vehicle_type_link(uuid, jsonb) from public, anon;
grant execute on function public.set_application_vehicle_type_link(uuid, jsonb) to authenticated;

-- A rotina específica do checklist criada horas antes seria uma segunda porta
-- para a mesma autorização. Sai; a genérica fica.
drop function if exists public.set_checklist_app_operation(uuid, jsonb);

-- -----------------------------------------------------------------------------
-- 6. O executor: contexto → tipos → placas, tudo pela mesma elegibilidade
-- -----------------------------------------------------------------------------
create or replace function public.checklist_fleet_context(p_organization_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_app     record;
  v_version record;
  v_actor   record;
begin
  select a.id, a.name, a.slug, a.is_active, a.allows_attachments into v_app
    from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
     and a.deleted_at is null;

  if v_app.id is null then
    return jsonb_build_object('available', false, 'reason', 'nao_cadastrado');
  end if;

  select v.id, v.label, v.min_duration_seconds, v.max_duration_seconds into v_version
    from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc limit 1;

  select * into v_actor from private.checklist_actor(p_organization_id);

  return jsonb_build_object(
    'available', v_app.is_active and v_version.id is not null,
    'reason', case when not v_app.is_active then 'inativo'
                   when v_version.id is null then 'sem_versao' else null end,
    'app', jsonb_build_object('id', v_app.id, 'name', v_app.name,
                              'allows_attachments', v_app.allows_attachments),
    'version', case when v_version.id is null then null else jsonb_build_object(
                 'id', v_version.id, 'label', v_version.label,
                 'min_duration_seconds', v_version.min_duration_seconds,
                 'max_duration_seconds', v_version.max_duration_seconds) end,
    'actor', case when v_actor.employee_id is null then null else jsonb_build_object(
               'employee_id', v_actor.employee_id,
               'name', v_actor.employee_name,
               'employee_code', v_actor.employee_code) end,
    -- §30: só operações ativas, habilitadas NA DATA e dentro do escopo.
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object('id', op.id, 'name', op.name) order by op.name)
        from public.operations op
       where op.organization_id = p_organization_id and op.deleted_at is null
         and op.status = 'active'
         and private.app_operation_enabled(v_app.id, op.id, current_date)
         and private.can_access_operation(op.id)
    ), '[]'::jsonb));
end;
$$;

-- §31: os tipos de equipamento disponíveis na operação — habilitados para o
-- aplicativo E com pelo menos um veículo elegível no escopo de quem pergunta.
create or replace function public.checklist_equipment_options(
  p_organization_id uuid,
  p_operation_id    uuid,
  p_date            date default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_app uuid;
  v_dia date := coalesce(p_date, current_date);
begin
  select a.id into v_app from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota' and a.deleted_at is null;
  if v_app is null or not private.can_access_operation(p_operation_id) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'vehicles', t.n)
                     order by t.name)
      from (
        select vt.id, vt.code, vt.name, count(v.id) as n
          from public.vehicle_types vt
          join public.vehicles v on v.vehicle_type_id = vt.id
         where vt.deleted_at is null and vt.is_active
           and (vt.organization_id = p_organization_id or vt.organization_id is null)
           and v.organization_id = p_organization_id and v.deleted_at is null
           and private.app_vehicle_eligible(p_organization_id, v_app, v.id, p_operation_id, v_dia)
           and private.vehicle_in_scope(p_organization_id, v.id)
         group by vt.id, vt.code, vt.name
      ) t), '[]'::jsonb);
end;
$$;

revoke execute on function public.checklist_equipment_options(uuid, uuid, date) from public, anon;
grant execute on function public.checklist_equipment_options(uuid, uuid, date) to authenticated;

-- §33–§36: as placas da operação E do tipo, elegíveis. A assinatura muda
-- (ganha o tipo), então a antiga sai para não deixar duas portas.
drop function if exists public.checklist_vehicle_options(uuid, uuid, text, date);

create or replace function public.checklist_vehicle_options(
  p_organization_id uuid,
  p_operation_id    uuid,
  p_vehicle_type_id uuid,
  p_search          text default null,
  p_date            date default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_app uuid;
  v_dia date := coalesce(p_date, current_date);
begin
  select a.id into v_app from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota' and a.deleted_at is null;
  if v_app is null or not private.can_access_operation(p_operation_id) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(x order by x ->> 'sort_key')
      from (
        select jsonb_build_object(
                 'id', v.id,
                 'license_plate', v.license_plate,
                 'fleet_code', v.fleet_code,
                 'vehicle_type_id', v.vehicle_type_id,
                 'vehicle_type_name', t.name,
                 'operation_br_id', b.id,
                 'br_code', b.code,
                 'expected', b.id is not null,
                 'sort_key', case when b.id is not null then '0' else '1' end
                             || coalesce(v.license_plate, v.fleet_code, '')) as x
          from public.vehicles v
          join public.vehicle_types t on t.id = v.vehicle_type_id
          left join lateral (
            select b2.id, b2.code
              from public.fidelization_assignments fa
              join public.operation_brs b2 on b2.id = fa.operation_br_id and b2.deleted_at is null
             where fa.organization_id = p_organization_id and fa.vehicle_id = v.id
               and fa.vehicle_role = 'primary' and fa.status in ('confirmed', 'executed')
               and fa.start_date <= v_dia and (fa.end_date is null or fa.end_date >= v_dia)
               and b2.operation_id = p_operation_id
             order by fa.start_date desc limit 1) b on true
         where v.organization_id = p_organization_id and v.deleted_at is null
           and v.vehicle_type_id = p_vehicle_type_id
           and private.app_vehicle_eligible(p_organization_id, v_app, v.id, p_operation_id, v_dia)
           and private.vehicle_in_scope(p_organization_id, v.id)
           and (p_search is null or btrim(p_search) = ''
                or v.license_plate ilike '%' || btrim(p_search) || '%'
                or v.fleet_code ilike '%' || btrim(p_search) || '%')
         limit 200
      ) s), '[]'::jsonb);
end;
$$;

revoke execute on function public.checklist_vehicle_options(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.checklist_vehicle_options(uuid, uuid, uuid, text, date) to authenticated;

-- §38: o formulário só abre para uma combinação elegível. Requisição alterada
-- com veículo fora da lista é recusada aqui, antes de qualquer pergunta.
create or replace function public.checklist_fleet_form(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_operation_id    uuid
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_app     record;
  v_version record;
  v_vehicle record;
begin
  select a.id, a.name, a.slug into v_app
    from public.operational_apps a
   where a.organization_id = p_organization_id and a.slug = 'check-list-frota'
     and a.deleted_at is null;

  if v_app.id is null then
    raise exception 'O aplicativo Check List de Frota não está cadastrado nesta organização.'
      using errcode = 'no_data_found';
  end if;

  select v.* into v_version
    from public.checklist_app_versions v
   where v.app_id = v_app.id and v.status = 'published'
   order by v.major desc, v.minor desc
   limit 1;

  if v_version.id is null then
    raise exception 'O Check List de Frota ainda não possui versão publicada.'
      using errcode = 'no_data_found';
  end if;

  select v.id, v.vehicle_type_id, v.vehicle_subcategory_id, v.license_plate, v.fleet_code
    into v_vehicle
    from public.vehicles v
   where v.id = p_vehicle_id and v.organization_id = p_organization_id and v.deleted_at is null;

  if v_vehicle.id is null then
    raise exception 'Veículo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  if not private.can_access_operation(p_operation_id)
     or not private.vehicle_in_scope(p_organization_id, v_vehicle.id)
     or not private.app_vehicle_eligible(p_organization_id, v_app.id, v_vehicle.id, p_operation_id, current_date) then
    raise exception 'Este veículo não está disponível para o Check List de Frota nesta operação.'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'app_id',       v_app.id,
    'app_name',     v_app.name,
    'version_id',   v_version.id,
    'version_label', v_version.label,
    'min_duration_seconds', v_version.min_duration_seconds,
    'max_duration_seconds', v_version.max_duration_seconds,
    'vehicle', jsonb_build_object(
      'id', v_vehicle.id,
      'license_plate', v_vehicle.license_plate,
      'fleet_code', v_vehicle.fleet_code,
      'vehicle_type_id', v_vehicle.vehicle_type_id,
      'vehicle_subcategory_id', v_vehicle.vehicle_subcategory_id),
    'clusters', private.checklist_build_form(
      v_version.id, p_operation_id, v_vehicle.vehicle_type_id, v_vehicle.vehicle_subcategory_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Estado inicial aprovado (§10, §11, §17, CA07–CA09)
--
-- Uma vez, por organização, pelos registros OFICIAIS existentes — nenhuma
-- operação ou tipo é criado. As operações são reconhecidas pelo nome cadastrado
-- ("Redespacho - Belém/Pa" é o nome oficial de "Redespacho Belém do Pará");
-- o tipo, pelo código imutável `car` (Frota Leve ADM). Quem não está na lista
-- fica DESABILITADO de forma explícita e auditável (linha com is_enabled=false),
-- e não pela ausência de linha — assim a tela mostra a decisão tomada.
-- -----------------------------------------------------------------------------
do $seed$
declare
  o     record;
  v_app uuid;
  r     record;
  n_on  int; n_off int; t_on int; t_off int;
begin
  for o in select id, name from public.organizations where deleted_at is null and status = 'active'
  loop
    select a.id into v_app from public.operational_apps a
     where a.organization_id = o.id and a.slug = 'check-list-frota' and a.deleted_at is null;
    if v_app is null then continue; end if;

    n_on := 0; n_off := 0;
    for r in select op.id, op.name from public.operations op
              where op.organization_id = o.id and op.deleted_at is null
    loop
      if lower(r.name) in ('last mille mg', 'last mile mg', 'merchandising',
                           'redespacho - mg', 'redespacho mg',
                           'redespacho - belém/pa', 'redespacho belém do pará', 'redespacho belém') then
        insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled)
        values (o.id, v_app, r.id, true)
        on conflict (app_id, operation_id) do update set is_enabled = true, updated_at = now();
        n_on := n_on + 1;
      else
        insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled)
        values (o.id, v_app, r.id, false)
        on conflict (app_id, operation_id) do update set is_enabled = false, updated_at = now();
        n_off := n_off + 1;
      end if;
    end loop;

    t_on := 0; t_off := 0;
    for r in select t.id, t.code, t.name from public.vehicle_types t
              where t.deleted_at is null and (t.organization_id = o.id or t.organization_id is null)
    loop
      if r.code = 'car' then
        insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled)
        values (o.id, r.id, v_app, false)
        on conflict (organization_id, vehicle_type_id, app_id) do update set is_enabled = false, updated_at = now();
        t_off := t_off + 1;
      else
        insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id, is_enabled)
        values (o.id, r.id, v_app, true)
        on conflict (organization_id, vehicle_type_id, app_id) do update set is_enabled = true, updated_at = now();
        t_on := t_on + 1;
      end if;
    end loop;

    raise notice 'Check List de Frota em %: % operacoes habilitadas, % desabilitadas; % tipos habilitados, % desabilitados',
      o.name, n_on, n_off, t_on, t_off;
  end loop;
end $seed$;
