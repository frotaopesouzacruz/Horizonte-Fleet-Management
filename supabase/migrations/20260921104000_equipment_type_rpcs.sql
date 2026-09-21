-- =============================================================================
-- ETAPA 07 · AS ROTINAS DO TIPO DE EQUIPAMENTO
--
-- `save_equipment_type` grava tudo numa transação só (§36): dados gerais,
-- configuração, subcategorias, operações, aplicativos e elegibilidade. Se
-- qualquer parte falhar, nada entra — o cadastro nunca fica metade salvo.
--
-- CADA SEÇÃO TEM A SUA PERMISSÃO. O payload traz apenas o que se quer alterar:
-- uma chave ausente significa "não mexer nisto", e só as seções presentes
-- exigem a permissão correspondente. Quem só pode editar o nome não precisa da
-- permissão de elegibilidade para salvar o nome.
--
-- STATUS. Um tipo do catálogo global é compartilhado: uma organização não pode
-- inativá-lo para as outras. Por isso o status mora em dois lugares, e cada um
-- responde por um caso — `vehicle_types.is_active` para o tipo que a
-- organização criou, `vehicle_type_settings.is_enabled` para o tipo global que
-- ela decidiu não usar.
-- =============================================================================

create or replace function private.assert_type_writable(
  p_organization_id uuid,
  p_vehicle_type_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_exists boolean := false;
begin
  select organization_id, true into v_owner, v_exists
    from public.vehicle_types where id = p_vehicle_type_id and deleted_at is null;

  if not v_exists then
    raise exception 'Tipo de equipamento não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_owner is not null and v_owner <> p_organization_id then
    raise exception 'Este tipo de equipamento pertence a outra organização.'
      using errcode = 'insufficient_privilege';
  end if;
  return v_owner;
end;
$$;

revoke execute on function private.assert_type_writable(uuid, uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- public.save_equipment_type(uuid, jsonb)
-- -----------------------------------------------------------------------------
create or replace function public.save_equipment_type(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_is_new   boolean := v_id is null;
  v_owner    uuid;
  v_code     text;
  v_expected timestamptz := nullif(p_payload ->> 'expected_updated_at', '')::timestamptz;
  v_current  timestamptz;
  v_name     text := btrim(coalesce(p_payload ->> 'name', ''));
  v_sub      jsonb;
  v_sub_id   uuid;
  v_keep     uuid[] := array[]::uuid[];
  v_rule     jsonb;
  v_existing record;
begin
  -- ---------------------------------------------------------------- criar ---
  if v_is_new then
    if not private.has_permission(p_organization_id, 'equipment_types.create') then
      raise exception 'Você não possui permissão para cadastrar tipos de equipamento.'
        using errcode = 'insufficient_privilege';
    end if;
    if length(v_name) = 0 then
      raise exception 'Informe o nome do tipo de equipamento.' using errcode = 'invalid_parameter_value';
    end if;

    -- Os dois índices únicos cobrem cada escopo por separado, e nenhum deles
    -- impede criar "Van" ao lado da "Van" do catálogo base — que para quem usa
    -- a tela seriam dois tipos com o mesmo nome na mesma lista.
    perform private.assert_type_name_available(p_organization_id, v_name, null);

    -- Contador atômico: dois administradores cadastrando ao mesmo tempo
    -- recebem códigos diferentes.
    v_code := private.next_entity_code(p_organization_id, 'equipment_type', 'EQ-', 5);

    insert into public.vehicle_types (organization_id, code, name, description, is_active, sort_order)
    values (p_organization_id, v_code, v_name, nullif(btrim(coalesce(p_payload ->> 'description','')), ''),
            coalesce((p_payload ->> 'is_active')::boolean, true), 100)
    returning id into v_id;

    v_owner := p_organization_id;

  -- --------------------------------------------------------------- editar ---
  else
    if not private.has_permission(p_organization_id, 'equipment_types.update') then
      raise exception 'Você não possui permissão para editar tipos de equipamento.'
        using errcode = 'insufficient_privilege';
    end if;
    v_owner := private.assert_type_writable(p_organization_id, v_id);

    -- §38: quem salvou por último não apaga o trabalho de quem salvou antes
    -- sem saber. Se a linha mudou desde que o formulário a leu, a gravação
    -- para e a pessoa é avisada.
    if v_expected is not null then
      select updated_at into v_current from public.vehicle_types where id = v_id;
      if v_current is distinct from v_expected then
        raise exception 'Este tipo foi alterado por outra pessoa enquanto você editava. Recarregue para ver a versão atual.'
          using errcode = 'serialization_failure';
      end if;
    end if;

    -- Identidade de um tipo global não é editável por uma organização (§41).
    if v_owner is not null and (p_payload ? 'name' or p_payload ? 'description') then
      if (p_payload ? 'name') and length(v_name) = 0 then
        raise exception 'Informe o nome do tipo de equipamento.' using errcode = 'invalid_parameter_value';
      end if;
      if p_payload ? 'name' then
        perform private.assert_type_name_available(p_organization_id, v_name, v_id);
      end if;
      update public.vehicle_types
         set name = case when p_payload ? 'name' then v_name else name end,
             description = case when p_payload ? 'description'
                                then nullif(btrim(coalesce(p_payload ->> 'description','')), '')
                                else description end
       where id = v_id;
    elsif v_owner is null and (p_payload ? 'name' or p_payload ? 'description') then
      raise exception 'Este tipo pertence ao catálogo base da plataforma e o seu nome não é editável. A parametrização da sua organização continua disponível.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ------------------------------------------------------------ settings ---
  -- A configuração da organização existe sempre, inclusive para o tipo global.
  insert into public.vehicle_type_settings (organization_id, vehicle_type_id)
  values (p_organization_id, v_id)
  on conflict (organization_id, vehicle_type_id) do nothing;

  if p_payload ? 'settings' then
    update public.vehicle_type_settings s set
      operation_restriction_enabled =
        coalesce((p_payload -> 'settings' ->> 'operation_restriction_enabled')::boolean,
                 s.operation_restriction_enabled),
      requires_subcategory =
        coalesce((p_payload -> 'settings' ->> 'requires_subcategory')::boolean, s.requires_subcategory),
      notes = nullif(btrim(coalesce(p_payload -> 'settings' ->> 'notes', '')), '')
     where s.organization_id = p_organization_id and s.vehicle_type_id = v_id;
  end if;

  -- ------------------------------------------------------- subcategorias ---
  if p_payload ? 'subcategories' then
    if not private.has_permission(p_organization_id, 'equipment_types.manage_subcategories') then
      raise exception 'Você não possui permissão para gerenciar subcategorias.'
        using errcode = 'insufficient_privilege';
    end if;

    for v_sub in select * from jsonb_array_elements(p_payload -> 'subcategories')
    loop
      v_sub_id := nullif(v_sub ->> 'id', '')::uuid;

      if v_sub_id is null then
        insert into public.vehicle_subcategories
          (organization_id, vehicle_type_id, name, description, is_active)
        values (p_organization_id, v_id, btrim(v_sub ->> 'name'),
                nullif(btrim(coalesce(v_sub ->> 'description','')), ''),
                coalesce((v_sub ->> 'is_active')::boolean, true))
        returning id into v_sub_id;
      else
        -- Uma subcategoria do catálogo base não é editável pela organização.
        if exists (select 1 from public.vehicle_subcategories
                    where id = v_sub_id and organization_id is null) then
          raise exception 'Esta subcategoria pertence ao catálogo base e não pode ser alterada pela organização.'
            using errcode = 'insufficient_privilege';
        end if;
        update public.vehicle_subcategories set
          name = btrim(v_sub ->> 'name'),
          description = nullif(btrim(coalesce(v_sub ->> 'description','')), ''),
          is_active = coalesce((v_sub ->> 'is_active')::boolean, is_active)
         where id = v_sub_id
           and organization_id = p_organization_id
           and vehicle_type_id = v_id;
        if not found then
          raise exception 'Subcategoria não encontrada neste tipo.' using errcode = 'no_data_found';
        end if;
      end if;

      v_keep := v_keep || v_sub_id;
    end loop;

    -- §15: o que saiu da lista é inativado, nunca apagado. Os veículos que
    -- apontam para ele continuam apontando, e o histórico continua legível.
    update public.vehicle_subcategories
       set is_active = false
     where vehicle_type_id = v_id
       and organization_id = p_organization_id
       and deleted_at is null
       and not (id = any (v_keep));
  end if;

  -- ------------------------------------------------------------ operações ---
  if p_payload ? 'operations' then
    if not private.has_permission(p_organization_id, 'equipment_types.manage_operations') then
      raise exception 'Você não possui permissão para gerenciar as operações do tipo.'
        using errcode = 'insufficient_privilege';
    end if;

    delete from public.vehicle_type_operations
     where organization_id = p_organization_id and vehicle_type_id = v_id
       and operation_id not in (
         select (value #>> '{}')::uuid from jsonb_array_elements(p_payload -> 'operations'));

    insert into public.vehicle_type_operations (organization_id, vehicle_type_id, operation_id)
    select p_organization_id, v_id, (value #>> '{}')::uuid
      from jsonb_array_elements(p_payload -> 'operations')
    on conflict (organization_id, vehicle_type_id, operation_id) do nothing;
  end if;

  -- ---------------------------------------------------------- aplicativos ---
  if p_payload ? 'apps' then
    if not private.has_permission(p_organization_id, 'equipment_types.manage_apps') then
      raise exception 'Você não possui permissão para gerenciar os aplicativos do tipo.'
        using errcode = 'insufficient_privilege';
    end if;

    delete from public.vehicle_type_apps
     where organization_id = p_organization_id and vehicle_type_id = v_id
       and app_id not in (
         select (value #>> '{}')::uuid from jsonb_array_elements(p_payload -> 'apps'));

    insert into public.vehicle_type_apps (organization_id, vehicle_type_id, app_id)
    select p_organization_id, v_id, (value #>> '{}')::uuid
      from jsonb_array_elements(p_payload -> 'apps')
    on conflict (organization_id, vehicle_type_id, app_id) do nothing;
  end if;

  -- -------------------------------------------------------- elegibilidade ---
  -- §55: só o que foi escolhido é gravado. Nada de vincular todos os módulos
  -- porque um tipo novo foi criado.
  if p_payload ? 'module_rules' then
    if not private.has_permission(p_organization_id, 'equipment_types.manage_eligibility') then
      raise exception 'Você não possui permissão para alterar a elegibilidade de módulos.'
        using errcode = 'insufficient_privilege';
    end if;

    for v_rule in select * from jsonb_array_elements(p_payload -> 'module_rules')
    loop
      select * into v_existing
        from public.vehicle_type_module_rules r
       where r.organization_id = p_organization_id
         and r.vehicle_type_id = v_id
         and r.module_code = v_rule ->> 'module_code'
         and r.capability = v_rule ->> 'capability'
         and r.effective_to is null;

      if v_existing.id is null then
        insert into public.vehicle_type_module_rules
          (organization_id, vehicle_type_id, module_code, capability, is_eligible, reason)
        values (p_organization_id, v_id, v_rule ->> 'module_code', v_rule ->> 'capability',
                (v_rule ->> 'is_eligible')::boolean,
                nullif(btrim(coalesce(v_rule ->> 'reason','')), ''));

      elsif v_existing.is_eligible is distinct from (v_rule ->> 'is_eligible')::boolean then
        -- §29: a regra anterior é encerrada, não sobrescrita. O indicador de
        -- agosto continua sabendo o que valia em agosto.
        if v_existing.effective_from >= current_date then
          -- Ainda é de hoje: corrigir no lugar não perde história nenhuma.
          update public.vehicle_type_module_rules
             set is_eligible = (v_rule ->> 'is_eligible')::boolean,
                 reason = nullif(btrim(coalesce(v_rule ->> 'reason','')), '')
           where id = v_existing.id;
        else
          update public.vehicle_type_module_rules
             set effective_to = current_date - 1
           where id = v_existing.id;

          insert into public.vehicle_type_module_rules
            (organization_id, vehicle_type_id, module_code, capability, is_eligible,
             effective_from, reason)
          values (p_organization_id, v_id, v_rule ->> 'module_code', v_rule ->> 'capability',
                  (v_rule ->> 'is_eligible')::boolean, current_date,
                  nullif(btrim(coalesce(v_rule ->> 'reason','')), ''));
        end if;
      end if;
    end loop;
  end if;

  perform private.emit_event(p_organization_id,
    case when v_is_new then 'equipment_type.created' else 'equipment_type.updated' end,
    'equipment_type', v_id,
    jsonb_build_object('name', v_name, 'reason', nullif(btrim(coalesce(p_payload ->> 'reason','')), '')));

  return v_id;
end;
$$;

revoke execute on function public.save_equipment_type(uuid, jsonb) from public, anon;
grant  execute on function public.save_equipment_type(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Situação do tipo
-- -----------------------------------------------------------------------------
create or replace function public.set_equipment_type_status(
  p_organization_id uuid,
  p_vehicle_type_id uuid,
  p_is_active       boolean,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not private.has_permission(p_organization_id, 'equipment_types.deactivate') then
    raise exception 'Você não possui permissão para alterar a situação de tipos de equipamento.'
      using errcode = 'insufficient_privilege';
  end if;

  v_owner := private.assert_type_writable(p_organization_id, p_vehicle_type_id);

  if v_owner is null then
    -- Tipo do catálogo base: a organização desliga para si, não para as outras.
    insert into public.vehicle_type_settings (organization_id, vehicle_type_id, is_enabled)
    values (p_organization_id, p_vehicle_type_id, p_is_active)
    on conflict (organization_id, vehicle_type_id) do update set is_enabled = excluded.is_enabled;
  else
    update public.vehicle_types set is_active = p_is_active where id = p_vehicle_type_id;
  end if;

  -- §56: nenhum veículo muda de situação por causa disto. O tipo sai das
  -- listas de novos cadastros e continua classificando quem já classificava.
  perform private.emit_event(p_organization_id,
    case when p_is_active then 'equipment_type.activated' else 'equipment_type.deactivated' end,
    'equipment_type', p_vehicle_type_id,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;

revoke execute on function public.set_equipment_type_status(uuid, uuid, boolean, text) from public, anon;
grant  execute on function public.set_equipment_type_status(uuid, uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Situação de uma subcategoria
--
-- Exclusão física não é oferecida. Uma subcategoria em uso tem veículos
-- apontando para ela, e apagá-la significaria ou perder a classificação deles
-- ou apagá-los junto (§15, §58).
-- -----------------------------------------------------------------------------
create or replace function public.set_equipment_subcategory_status(
  p_organization_id uuid,
  p_subcategory_id  uuid,
  p_is_active       boolean,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_type  uuid;
begin
  if not private.has_permission(p_organization_id, 'equipment_types.manage_subcategories') then
    raise exception 'Você não possui permissão para gerenciar subcategorias.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id, vehicle_type_id into v_owner, v_type
    from public.vehicle_subcategories where id = p_subcategory_id;

  if v_type is null then
    raise exception 'Subcategoria não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_owner is null then
    raise exception 'Esta subcategoria pertence ao catálogo base e não pode ser alterada pela organização.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_owner <> p_organization_id then
    raise exception 'Esta subcategoria pertence a outra organização.' using errcode = 'insufficient_privilege';
  end if;

  update public.vehicle_subcategories set is_active = p_is_active where id = p_subcategory_id;

  perform private.emit_event(p_organization_id,
    case when p_is_active then 'equipment_subcategory.activated' else 'equipment_subcategory.deactivated' end,
    'equipment_subcategory', p_subcategory_id,
    jsonb_build_object('vehicle_type_id', v_type, 'reason', nullif(btrim(coalesce(p_reason,'')), '')));
end;
$$;

revoke execute on function public.set_equipment_subcategory_status(uuid, uuid, boolean, text) from public, anon;
grant  execute on function public.set_equipment_subcategory_status(uuid, uuid, boolean, text) to authenticated;
