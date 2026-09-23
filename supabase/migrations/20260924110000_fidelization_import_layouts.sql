-- =============================================================================
-- Etapa 15 · Importação da Fidelização: mapeamento de colunas e layouts salvos
--
-- A importação reconhece as colunas pelo nome (aliases, Etapa 13). Quando o
-- arquivo usa outros nomes, a pessoa liga cada coluna a um campo do HFM — e
-- pode guardar essa ligação como um layout, para o próximo arquivo do mesmo
-- formato (§46–§54). O HFC guardava isso em `fidelization_import_layouts`,
-- global e sem dono; aqui o layout é da organização, lido com a permissão de
-- importar e gravado só pelas rotinas abaixo, com auditoria.
--
-- O layout guarda só a ligação cabeçalho → campo. Ele não grava dados, não
-- cria BR, veículo nem colaborador, e não mexe em perfil, papel ou permissão.
-- =============================================================================

create table if not exists public.import_layouts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('fidelization_allocations', 'fidelization_brs')),
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  -- { "<cabeçalho normalizado>": "<campo>" | "" }; "" = ignorar a coluna.
  mapping         jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);

comment on table public.import_layouts is
  'Layouts salvos de mapeamento de colunas das importações da Fidelização (Etapa 15). Só a ligação cabeçalho → campo; gravado por save_import_layout.';

create unique index if not exists import_layouts_name_uq
  on public.import_layouts (organization_id, kind, lower(btrim(name)));

drop trigger if exists import_layouts_set_stamps on public.import_layouts;
create trigger import_layouts_set_stamps
  before insert or update on public.import_layouts
  for each row execute function private.tg_set_stamps();

drop trigger if exists import_layouts_prevent_tenant_change on public.import_layouts;
create trigger import_layouts_prevent_tenant_change
  before update on public.import_layouts
  for each row execute function private.tg_prevent_tenant_change();

drop trigger if exists import_layouts_audit on public.import_layouts;
create trigger import_layouts_audit
  after insert or update or delete on public.import_layouts
  for each row execute function private.tg_audit();

alter table public.import_layouts enable row level security;

revoke all on public.import_layouts from anon, authenticated;
grant select on public.import_layouts to authenticated;

drop policy if exists import_layouts_select on public.import_layouts;
create policy import_layouts_select on public.import_layouts
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('fidelization.import')));

-- -----------------------------------------------------------------------------
-- Campos aceitos por tipo de arquivo (os mesmos de import-columns.ts).
-- -----------------------------------------------------------------------------
create or replace function private.import_layout_fields(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'fidelization_allocations' then array[
      'operation', 'state', 'city', 'br_code', 'fleet_code', 'license_plate',
      'start_date', 'end_date', 'vehicle_role', 'status', 'reason']
    when 'fidelization_brs' then array[
      'operation', 'state', 'city', 'code', 'description', 'status', 'notes']
    else array[]::text[]
  end;
$$;

revoke execute on function private.import_layout_fields(text) from public, anon, authenticated;

create or replace function private.assert_import_layout_access(p_organization_id uuid, p_kind text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'fidelization.import') then
    raise exception 'Você não possui permissão para importar a fidelização.' using errcode = 'insufficient_privilege';
  end if;
  -- O arquivo de BRs é cadastro: pede também quem pode cadastrar BRs.
  if p_kind = 'fidelization_brs' and not private.has_permission(p_organization_id, 'fidelization.manage_brs') then
    raise exception 'Você não possui permissão para importar o cadastro de BRs.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function private.assert_import_layout_access(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- save_import_layout: cria ou atualiza (pelo nome) um layout da organização.
-- -----------------------------------------------------------------------------
create or replace function public.save_import_layout(
  p_organization_id uuid,
  p_kind            text,
  p_name            text,
  p_mapping         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields  text[];
  v_name    text := btrim(coalesce(p_name, ''));
  v_clean   jsonb := '{}'::jsonb;
  v_key     text;
  v_value   jsonb;
  v_field   text;
  v_used    text[] := array[]::text[];
  v_id      uuid;
begin
  if p_kind not in ('fidelization_allocations', 'fidelization_brs') then
    raise exception 'Tipo de arquivo desconhecido.' using errcode = 'invalid_parameter_value';
  end if;
  perform private.assert_import_layout_access(p_organization_id, p_kind);

  if char_length(v_name) = 0 or char_length(v_name) > 80 then
    raise exception 'Informe um nome de até 80 caracteres para o layout.' using errcode = 'invalid_parameter_value';
  end if;
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'object' then
    raise exception 'O mapeamento de colunas é inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from jsonb_object_keys(p_mapping)) > 60 then
    raise exception 'O layout aceita no máximo 60 colunas.' using errcode = 'invalid_parameter_value';
  end if;

  v_fields := private.import_layout_fields(p_kind);
  for v_key, v_value in select * from jsonb_each(p_mapping) loop
    if char_length(btrim(v_key)) = 0 or char_length(v_key) > 120 then
      raise exception 'Nome de coluna inválido no layout.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'O campo da coluna "%" é inválido.', v_key using errcode = 'invalid_parameter_value';
    end if;
    v_field := v_value #>> '{}';
    if v_field <> '' then
      if not (v_field = any (v_fields)) then
        raise exception 'O campo "%" não existe neste tipo de arquivo.', v_field using errcode = 'invalid_parameter_value';
      end if;
      if v_field = any (v_used) then
        raise exception 'O campo "%" foi ligado a mais de uma coluna.', v_field using errcode = 'invalid_parameter_value';
      end if;
      v_used := v_used || v_field;
    end if;
    v_clean := v_clean || jsonb_build_object(lower(btrim(v_key)), v_field);
  end loop;

  select l.id into v_id
    from public.import_layouts l
   where l.organization_id = p_organization_id and l.kind = p_kind
     and lower(btrim(l.name)) = lower(v_name)
   for update;

  if v_id is null then
    insert into public.import_layouts (organization_id, kind, name, mapping)
    values (p_organization_id, p_kind, v_name, v_clean)
    returning id into v_id;
  else
    update public.import_layouts
       set name = v_name, mapping = v_clean
     where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_import_layout(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_import_layout(uuid, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_import_layout: remove um layout (a auditoria guarda o que era).
-- -----------------------------------------------------------------------------
create or replace function public.delete_import_layout(p_organization_id uuid, p_layout_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  -- A permissão vem antes da busca: quem não importa não descobre se o layout existe.
  perform private.assert_import_layout_access(p_organization_id, 'fidelization_allocations');
  select l.kind into v_kind
    from public.import_layouts l
   where l.id = p_layout_id and l.organization_id = p_organization_id;
  if v_kind is null then
    raise exception 'Layout não encontrado.' using errcode = 'no_data_found';
  end if;
  perform private.assert_import_layout_access(p_organization_id, v_kind);
  delete from public.import_layouts where id = p_layout_id;
end;
$$;

revoke execute on function public.delete_import_layout(uuid, uuid) from public, anon;
grant execute on function public.delete_import_layout(uuid, uuid) to authenticated;
