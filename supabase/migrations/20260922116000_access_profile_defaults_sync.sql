-- =============================================================================
-- Perfis de acesso — o catálogo padrão volta a chegar aos papéis
--
-- Defeito encontrado ao testar o endurecimento das Filiais, e é o mais grave
-- dos que apareceram: 32 permissões criadas nas Etapas 07, 08 e 09 —
-- `equipment_types.*` (9), `leadership.*` (5), `fidelization.*` (8) e
-- `branches.*` (10) — estavam em `public.permissions` e em
-- `public.access_profile_defaults`, e em NENHUM papel.
--
-- A causa é `private.provision_access_profiles`: ela só copia os padrões quando
-- CRIA o papel; para um papel que já existe ela dá `continue`. Como a
-- organização já existia quando esses módulos nasceram, o catálogo foi
-- atualizado e os papéis ficaram para trás. As três etapas seguiram o mesmo
-- caminho e as três esqueceram a mesma linha.
--
-- O efeito não aparece em teste com a conta atual, que é administrador de
-- plataforma e portanto passa por cima de qualquer verificação de permissão.
-- Para qualquer pessoa real, inclusive quem tem o perfil Administrador da
-- organização, Tipos de Equipamento, Lideranças, Fidelização e Filiais estavam
-- invisíveis no menu e fechados nas rotas — quatro módulos entregues e
-- inalcançáveis.
--
-- A correção tem duas partes, porque corrigir só os dados deixaria a Etapa 11
-- repetir o erro:
--
--   1. `private.sync_access_profile_defaults`, que materializa o catálogo nos
--      papéis já existentes;
--   2. um gatilho em `access_profile_defaults`, para que toda permissão nova
--      que entre no catálogo chegue aos papéis na mesma transação.
--
-- A sincronização é ADITIVA e conservadora: só entrega um código de permissão
-- a uma organização que nunca o viu em papel nenhum. Se um administrador
-- decidiu retirar uma permissão de um papel, essa decisão é dele e continua
-- valendo — quem quer o padrão de volta chama `public.restore_role_defaults`.
-- Nada aqui altera o Perfil de Acesso de nenhuma pessoa: mexe no que cada
-- papel pode, nunca em quem tem qual papel.
-- =============================================================================

create or replace function private.sync_access_profile_defaults(
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer := 0;
begin
  perform private.access_change_begin();

  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
    from public.roles r
    join public.access_profile_defaults d on d.profile_code = r.code
    join public.permissions p             on p.code = d.permission_code
   where r.deleted_at is null
     and r.organization_id is not null
     and (p_organization_id is null or r.organization_id = p_organization_id)
     -- ainda não está neste papel
     and not exists (
       select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_id = p.id
     )
     -- e é um código que esta organização nunca viu em papel nenhum: é módulo
     -- novo, não permissão que alguém retirou de propósito
     and not exists (
       select 1
         from public.role_permissions rp
         join public.roles r2 on r2.id = rp.role_id
        where r2.organization_id = r.organization_id
          and rp.permission_id = p.id
     )
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke execute on function private.sync_access_profile_defaults(uuid) from public, anon, authenticated;

comment on function private.sync_access_profile_defaults(uuid) is
  'Materializa access_profile_defaults nos papéis existentes. Aditiva: só '
  'entrega um código que a organização nunca teve em papel nenhum, para nunca '
  'desfazer uma retirada deliberada. Não altera o perfil de ninguém.';

-- -----------------------------------------------------------------------------
-- O gatilho que impede a próxima etapa de repetir o esquecimento.
--
-- Nível de comando, porque uma etapa insere o catálogo inteiro de uma vez e
-- basta sincronizar uma vez no fim. AFTER INSERT apenas: retirar um padrão do
-- catálogo não retira permissão de ninguém — isso é decisão de administração,
-- não de migração.
-- -----------------------------------------------------------------------------
create or replace function private.tg_access_defaults_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_access_profile_defaults(null);
  return null;
end;
$$;

revoke execute on function private.tg_access_defaults_sync() from public, anon, authenticated;

drop trigger if exists access_profile_defaults_sync on public.access_profile_defaults;
create trigger access_profile_defaults_sync
  after insert on public.access_profile_defaults
  for each statement execute function private.tg_access_defaults_sync();

-- -----------------------------------------------------------------------------
-- `provision_access_profiles` passa a completar também os papéis que já
-- existem. Ela continua não tocando no que foi customizado: quem decide isso é
-- a regra aditiva acima.
-- -----------------------------------------------------------------------------
create or replace function private.provision_access_profiles(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_profile record;
  v_role_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = 'invalid_parameter_value';
  end if;

  perform private.access_change_begin();

  for v_profile in
    select code, name, description from public.access_profiles order by sort_order
  loop
    select r.id into v_role_id
      from public.roles r
     where r.organization_id = p_organization_id and r.code = v_profile.code;

    if v_role_id is not null then
      update public.roles
         set deleted_at = null, deleted_by = null
       where id = v_role_id and deleted_at is not null;
      continue;
    end if;

    insert into public.roles (organization_id, code, name, description, is_system, is_editable)
    values (p_organization_id, v_profile.code, v_profile.name, v_profile.description, false, true)
    returning id into v_role_id;

    insert into public.role_permissions (role_id, permission_id)
    select v_role_id, p.id
      from public.access_profile_defaults d
      join public.permissions p on p.code = d.permission_code
     where d.profile_code = v_profile.code
    on conflict do nothing;

    v_created := v_created + 1;
  end loop;

  -- Papéis que já existiam recebem o que entrou no catálogo desde que foram
  -- criados. Era exatamente isto que faltava.
  perform private.sync_access_profile_defaults(p_organization_id);

  return v_created;
end;
$$;

revoke execute on function private.provision_access_profiles(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Correção do que já está no banco, e conferência: se as quatro famílias não
-- chegarem aos papéis, esta migração falha em vez de passar em silêncio.
-- -----------------------------------------------------------------------------
do $$
declare
  v_added   integer;
  v_missing text;
begin
  v_added := private.sync_access_profile_defaults(null);
  raise notice 'sync_access_profile_defaults: % vínculos criados', v_added;

  select string_agg(distinct d.profile_code || '/' || d.permission_code, ', ')
    into v_missing
    from public.access_profile_defaults d
    join public.permissions p on p.code = d.permission_code
    join public.roles r       on r.code = d.profile_code and r.deleted_at is null
                             and r.organization_id is not null
   where split_part(d.permission_code, '.', 1)
           in ('branches', 'leadership', 'fidelization', 'equipment_types')
     and not exists (
       select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_id = p.id
     );

  if v_missing is not null then
    raise exception 'Permissões do catálogo ainda ausentes nos papéis: %', v_missing;
  end if;
end $$;
