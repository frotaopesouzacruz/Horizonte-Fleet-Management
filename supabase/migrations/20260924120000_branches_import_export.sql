-- =============================================================================
-- ETAPA 09 (continuação) · IMPORTAÇÃO, EXPORTAÇÃO E CENTROS DE CUSTO DAS FILIAIS
--
-- Fecha as três pendências que a entrega da Etapa 09 declarou:
--
-- 1. IMPORTAÇÃO (§58–§60, §62). O fluxo oficial do HFM — `import_batches` →
--    `import_rows` / `import_errors` → validar → processar — ganha o tipo
--    `branches`:
--      · `stage_branch_import` valida linha a linha NO BANCO e devolve a
--        prévia. Não toca em filial nenhuma: só grava o lote e as linhas.
--      · `process_branch_import` grava o que a prévia prometeu, pelas rotinas
--        oficiais (`save_branch`) e só para quem validou o lote.
--    A filial existente é identificada pelo CÓDIGO INTERNO dentro da
--    organização (§60), e a prévia mostra atual × recebido campo a campo.
--    Coluna vazia é "não informado", nunca "apagar". A importação NUNCA:
--    desvincula ou reescreve vínculo operacional histórico (só acrescenta os
--    que não existem), muda filial de colaborador ou de veículo, inativa ou
--    reativa filial, troca o CNPJ de uma filial que já tem CNPJ, recria filial
--    arquivada, ou toca em Perfil de Acesso, roles, permissions, memberships e
--    escopos (§62). Dado ambíguo — código repetido no arquivo, nome ou CNPJ de
--    outra filial, cidade sem estado — é erro, nunca um palpite.
--
-- 2. EXPORTAÇÃO (§61). As linhas saem das views `security_invoker` que a tela
--    já usa, com o cliente de quem exporta; esta migration só acrescenta
--    `log_branch_export`, que grava a auditoria (`audit_logs`, action EXPORT)
--    e o evento `branch.exported`. A rota recusa o arquivo quando o registro
--    falha: sem auditoria não há exportação.
--
-- 3. CENTROS DE CUSTO (§38). `cost_centers.organization_unit_id` já existia; o
--    que faltava era a rotina. `set_branch_cost_center` associa e desassocia um
--    centro EXISTENTE (nunca cria), confere a organização dos dois lados e
--    exige `branches.update` + `cost_centers.manage`. Filial e centro de custo
--    continuam entidades separadas; uma filial pode ter vários centros, e um
--    centro já associado a outra filial não é "roubado" em silêncio.
--
-- Nada aqui é destrutivo: um CHECK ampliado (superconjunto do atual), funções
-- e uma view novas, e `branch_audit_trail` recriada com mais fontes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipo de lote `branches`
--
-- O CHECK é reconstruído como SUPERCONJUNTO do que estiver valendo na hora —
-- lido do catálogo, não copiado de uma migration antiga — para não desfazer
-- tipos que outra etapa tenha acrescentado em paralelo.
-- -----------------------------------------------------------------------------
do $$
declare
  v_def    text;
  v_values text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.import_batches'::regclass
     and c.conname = 'import_batches_type_check';

  -- O catálogo pode mostrar a lista como ARRAY['a'::text, …] ou como
  -- '{a,b}'::text[]; as duas formas são lidas. A nova é escrita como IN (…),
  -- que o catálogo devolve na primeira forma.
  select coalesce(array_agg(distinct v order by v), '{}')
    into v_values
    from (
      select btrim(p, ' {}"') as v
        from regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') as t(m),
             regexp_split_to_table(t.m[1], ',') as p
      union
      select unnest(array['employees', 'vehicles', 'adherence', 'operation_brs', 'fidelization', 'branches'])
    ) q
   where v <> '';

  alter table public.import_batches drop constraint if exists import_batches_type_check;
  execute format(
    'alter table public.import_batches add constraint import_batches_type_check check (type in (%s))',
    (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_values) as x));
end;
$$;

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------
create or replace function private.branch_import_issue(
  p_level text, p_field text, p_code text, p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('level', p_level, 'field', p_field, 'code', p_code, 'message', p_message);
$$;

-- "Operações vinculadas": separadas por ponto e vírgula, barra vertical ou
-- quebra de linha. A vírgula só separa quando nada mais separa (ver stage).
create or replace function private.branch_import_operation_tokens(p_value text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by ord) filter (where t is not null), '{}'::text[])
    from (
      select nullif(btrim(x), '') as t, ord
        from regexp_split_to_table(coalesce(p_value, ''), '\s*[;|\r\n]+\s*') with ordinality as s(x, ord)
    ) q;
$$;

create or replace function private.branch_format_cnpj(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_value ~ '^[0-9]{14}$' then
             substr(p_value, 1, 2) || '.' || substr(p_value, 3, 3) || '.' || substr(p_value, 6, 3) || '/' ||
             substr(p_value, 9, 4) || '-' || substr(p_value, 13, 2)
           else p_value
         end;
$$;

-- O retrato da filial que a prévia mostrou. `process_branch_import` compara
-- com a filial de agora: se qualquer campo mudou, a diferença exibida já não
-- vale e a linha falha. `updated_at` não serve para isso — é `now()`, o
-- instante da transação, e não distingue duas escritas na mesma transação.
create or replace function private.branch_import_snapshot(p_unit public.organization_units)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_unit.id is null then null else jsonb_build_object(
    'code', p_unit.code, 'name', p_unit.name, 'legal_name', p_unit.legal_name,
    'document_number', p_unit.document_number, 'status', p_unit.status, 'notes', p_unit.notes,
    'postal_code', p_unit.postal_code, 'street', p_unit.street, 'street_number', p_unit.street_number,
    'complement', p_unit.complement, 'district', p_unit.district,
    'state_id', p_unit.state_id, 'city_id', p_unit.city_id) end;
$$;

revoke all on function private.branch_import_issue(text, text, text, text) from public;
revoke all on function private.branch_import_operation_tokens(text) from public;
revoke all on function private.branch_format_cnpj(text) from public;
revoke all on function private.branch_import_snapshot(public.organization_units) from public;

-- =============================================================================
-- §58–§60 · stage_branch_import — valida o arquivo e devolve a prévia
-- =============================================================================
create or replace function public.stage_branch_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_batch       uuid;
  v_already     boolean := false;
  v_can_create  boolean;
  v_can_update  boolean;
  v_can_ops     boolean;
  v_can_deact   boolean;
  v_code_counts jsonb;
  v_doc_counts  jsonb;
  v_name_codes  jsonb;

  r             jsonb;
  v_row_no      integer;
  v_issues      jsonb;
  v_status      text;
  v_action      text;
  v_is_new      boolean;

  v_code        text;
  v_name        text;
  v_legal       text;
  v_doc_raw     text;
  v_doc         text;
  v_st_raw      text;
  v_st          text;
  v_cep_raw     text;
  v_cep         text;
  v_state_raw   text;
  v_city_raw    text;
  v_state       public.states;
  v_city_id     integer;
  v_city_name   text;
  v_elsewhere   text;
  v_street      text;
  v_number      text;
  v_complement  text;
  v_district    text;
  v_notes       text;
  v_final_state smallint;
  v_final_city  integer;

  v_cur         public.organization_units;
  v_cur_uf      text;
  v_cur_city    text;
  v_other_code  text;
  v_other_name  text;

  v_tokens      text[];
  v_tok         text;
  v_op          public.operations;
  v_ops         jsonb;
  v_add         jsonb;
  v_seen        uuid[];
  v_kept        text[];
  v_changes     jsonb;
  v_norm        jsonb;
  i             jsonb;

  n_total  integer := 0; n_valid integer := 0; n_warn integer := 0; n_err integer := 0;
  n_create integer := 0; n_update integer := 0; n_skip integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão não identificada. Entre novamente para importar filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'branches.import') then
    raise exception 'Você não possui permissão para importar filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
    raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_payload -> 'rows') > 5000 then
    raise exception 'A planilha excede 5000 linhas.' using errcode = 'invalid_parameter_value';
  end if;

  -- O que cada linha pode fazer depende das permissões de quem importa, não só
  -- de `branches.import`: criar, editar, vincular e cadastrar inativa têm dono.
  v_can_create := private.has_permission(p_organization_id, 'branches.create');
  v_can_update := private.has_permission(p_organization_id, 'branches.update');
  v_can_ops    := private.has_permission(p_organization_id, 'branches.manage_operations');
  v_can_deact  := private.has_permission(p_organization_id, 'branches.deactivate');

  -- Repetições dentro do próprio arquivo: código, CNPJ e nome com códigos
  -- diferentes. Qualquer uma delas torna a identidade ambígua (§58, §59).
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_code_counts
    from (select private.normalize_code(x ->> 'code') as k, count(*) as n
            from jsonb_array_elements(p_payload -> 'rows') x
           where private.normalize_code(x ->> 'code') is not null
           group by 1) q;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_doc_counts
    from (select private.normalize_document(x ->> 'document_number') as k, count(*) as n
            from jsonb_array_elements(p_payload -> 'rows') x
           where private.normalize_document(x ->> 'document_number') is not null
           group by 1) q;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_name_codes
    from (select lower(btrim(x ->> 'name')) as k, count(distinct private.normalize_code(x ->> 'code')) as n
            from jsonb_array_elements(p_payload -> 'rows') x
           where nullif(btrim(coalesce(x ->> 'name', '')), '') is not null
             and private.normalize_code(x ->> 'code') is not null
           group by 1) q;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'branches' and b.status = 'completed'
       and b.file_hash = nullif(p_payload ->> 'file_hash', '')) into v_already;

  insert into public.import_batches
    (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
  values
    (p_organization_id, 'branches', 'create_update', 'draft',
     left(coalesce(nullif(btrim(p_payload ->> 'file_name'), ''), 'filiais'), 300),
     nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
     coalesce(p_payload -> 'column_mapping', '{}'::jsonb), v_uid, v_uid)
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_payload -> 'rows') loop
    n_total := n_total + 1;
    v_row_no := coalesce(nullif(r ->> 'row_number', '')::integer, n_total + 1);
    v_issues := '[]'::jsonb; v_action := 'create'; v_is_new := true;
    v_code := null; v_name := null; v_legal := null; v_doc_raw := null; v_doc := null;
    v_st_raw := null; v_st := null; v_cep_raw := null; v_cep := null; v_state_raw := null; v_city_raw := null;
    v_state := null; v_city_id := null; v_city_name := null; v_elsewhere := null;
    v_street := null; v_number := null; v_complement := null; v_district := null; v_notes := null;
    v_final_state := null; v_final_city := null;
    v_cur := null; v_cur_uf := null; v_cur_city := null;
    v_tokens := '{}'; v_ops := '[]'::jsonb; v_add := '[]'::jsonb; v_seen := '{}'; v_kept := '{}';
    v_changes := '[]'::jsonb;

    begin
      -- ----------------------------------------------------------- código ---
      v_code := private.normalize_code(r ->> 'code');
      if v_code is null then
        v_issues := v_issues || private.branch_import_issue('error', 'code', 'required',
          'Informe o código interno da filial.');
      elsif v_code !~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' then
        v_issues := v_issues || private.branch_import_issue('error', 'code', 'invalid_value',
          format('Código inválido: %s. Use até 30 letras, números, ponto, hífen ou sublinhado, começando por letra ou número.', v_code));
      else
        if coalesce((v_code_counts ->> v_code)::integer, 0) > 1 then
          v_issues := v_issues || private.branch_import_issue('error', 'code', 'duplicate',
            format('O código %s aparece em mais de uma linha do arquivo. Nenhuma delas é importada até a repetição ser resolvida.', v_code));
        end if;
        if coalesce((r ->> 'code_numeric')::boolean, false) then
          v_issues := v_issues || private.branch_import_issue('warning', 'code', 'code_numeric',
            'O código veio como número na planilha; confira se zeros à esquerda não se perderam (087 e 87 são códigos diferentes).');
        end if;

        -- §60: a filial existente é a do mesmo código interno, nesta organização.
        select u.* into v_cur
          from public.organization_units u
         where u.organization_id = p_organization_id and u.deleted_at is null
           and private.normalize_code(u.code) = v_code;

        if v_cur.id is null and exists (
          select 1 from public.organization_units u
           where u.organization_id = p_organization_id and u.deleted_at is not null
             and private.normalize_code(u.code) = v_code) then
          v_issues := v_issues || private.branch_import_issue('error', 'code', 'archived',
            format('O código %s pertence a uma filial arquivada. A importação não recria nem restaura filiais arquivadas.', v_code));
        end if;
      end if;
      v_is_new := v_cur.id is null;
      if not v_is_new then
        select s.uf::text into v_cur_uf from public.states s where s.id = v_cur.state_id;
        select c.name into v_cur_city from public.cities c where c.id = v_cur.city_id;
      end if;

      -- ------------------------------------------------------------- nome ---
      v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
      if v_name is null then
        if v_is_new then
          v_issues := v_issues || private.branch_import_issue('error', 'name', 'required',
            'Informe o nome da filial.');
        end if;
      elsif length(v_name) > 200 then
        v_issues := v_issues || private.branch_import_issue('error', 'name', 'invalid_value',
          'O nome da filial excede 200 caracteres.');
      else
        -- O nome é único por organização (organization_units_org_name_key).
        select u.code, u.name into v_other_code, v_other_name
          from public.organization_units u
         where u.organization_id = p_organization_id and u.deleted_at is null
           and lower(u.name) = lower(v_name) and u.id is distinct from v_cur.id
         limit 1;
        if found then
          v_issues := v_issues || private.branch_import_issue('error', 'name', 'identity_conflict',
            format('O nome %s já pertence à filial de código %s. Confira o código antes de importar.',
              v_name, coalesce(v_other_code, '(sem código)')));
        end if;
        if coalesce((v_name_codes ->> lower(v_name))::integer, 0) > 1 then
          v_issues := v_issues || private.branch_import_issue('error', 'name', 'identity_conflict',
            format('O nome %s aparece no arquivo com códigos diferentes; a identidade da filial seria ambígua.', v_name));
        end if;
      end if;

      -- ---------------------------------------------------- razão social ---
      v_legal := nullif(btrim(coalesce(r ->> 'legal_name', '')), '');
      if v_legal is not null and length(v_legal) > 200 then
        v_issues := v_issues || private.branch_import_issue('error', 'legal_name', 'invalid_value',
          'A razão social excede 200 caracteres.');
      end if;

      -- ------------------------------------------------------------- CNPJ ---
      v_doc_raw := nullif(btrim(coalesce(r ->> 'document_number', '')), '');
      v_doc := private.normalize_document(v_doc_raw);
      if v_doc_raw is not null then
        if v_doc is null or length(v_doc) <> 14 or not private.is_valid_cnpj(v_doc) then
          v_issues := v_issues || private.branch_import_issue('error', 'document_number', 'cnpj',
            format('CNPJ inválido: %s. Confira os 14 dígitos e os dígitos verificadores.', v_doc_raw));
          v_doc := null;
        else
          if coalesce((v_doc_counts ->> v_doc)::integer, 0) > 1 then
            v_issues := v_issues || private.branch_import_issue('error', 'document_number', 'duplicate',
              format('O CNPJ %s aparece em mais de uma linha do arquivo.', private.branch_format_cnpj(v_doc)));
          end if;
          select u.code, u.name into v_other_code, v_other_name
            from public.organization_units u
           where u.organization_id = p_organization_id and u.deleted_at is null
             and u.document_number = v_doc and u.id is distinct from v_cur.id
             and u.unit_type in ('branch', 'headquarters')
           limit 1;
          if found then
            v_issues := v_issues || private.branch_import_issue('error', 'document_number', 'identity_conflict',
              format('O CNPJ %s já pertence à filial %s (código %s).',
                private.branch_format_cnpj(v_doc), v_other_name, coalesce(v_other_code, '—')));
          end if;
          if not v_is_new and v_cur.document_number is not null and v_cur.document_number <> v_doc then
            v_issues := v_issues || private.branch_import_issue('error', 'document_number', 'identity_conflict',
              format('O CNPJ do arquivo (%s) difere do cadastrado para a filial %s (%s). A troca de CNPJ não é feita por importação: use a edição da filial.',
                private.branch_format_cnpj(v_doc), v_cur.name, private.branch_format_cnpj(v_cur.document_number)));
          end if;
        end if;
      end if;

      -- --------------------------------------------------------- situação ---
      v_st_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
      v_st := case private.import_text_key(v_st_raw)
                when 'ativa' then 'active' when 'ativo' then 'active' when 'active' then 'active'
                when 'inativa' then 'inactive' when 'inativo' then 'inactive' when 'inactive' then 'inactive'
              end;
      if v_st_raw is not null and v_st is null then
        v_issues := v_issues || private.branch_import_issue('error', 'status', 'invalid_value',
          format('Situação inválida: %s (use Ativa ou Inativa).', v_st_raw));
      elsif v_is_new and v_st = 'inactive' then
        if not v_can_deact then
          v_issues := v_issues || private.branch_import_issue('error', 'status', 'permission',
            'Você não possui permissão para cadastrar uma filial já inativa.');
        else
          v_issues := v_issues || private.branch_import_issue('warning', 'status', 'inactive',
            'A filial será criada já inativa.');
        end if;
      elsif not v_is_new and v_st is not null and v_st <> v_cur.status then
        v_issues := v_issues || private.branch_import_issue('warning', 'status', 'status_divergence',
          format('A situação no arquivo (%s) difere da atual (%s). A importação não inativa nem reativa filiais: use Inativar/Reativar na tela, que mostra o impacto antes.',
            case v_st when 'active' then 'Ativa' else 'Inativa' end,
            case v_cur.status when 'active' then 'Ativa' else 'Inativa' end));
      end if;

      -- -------------------------------------------------------------- CEP ---
      v_cep_raw := nullif(btrim(coalesce(r ->> 'postal_code', '')), '');
      v_cep := private.normalize_document(v_cep_raw);
      if v_cep_raw is not null and (v_cep is null or length(v_cep) <> 8) then
        v_issues := v_issues || private.branch_import_issue('error', 'postal_code', 'invalid_value',
          format('CEP inválido: %s (use 8 dígitos).', v_cep_raw));
        v_cep := null;
      end if;

      -- -------------------------------------------------- estado e cidade ---
      v_state_raw := nullif(btrim(coalesce(r ->> 'state', '')), '');
      v_city_raw  := nullif(btrim(coalesce(r ->> 'city', '')), '');
      if v_state_raw is not null then
        select s.* into v_state
          from public.states s
         where upper(btrim(s.uf::text)) = upper(v_state_raw)
            or private.import_text_key(s.name) = private.import_text_key(v_state_raw)
         order by (upper(btrim(s.uf::text)) = upper(v_state_raw)) desc
         limit 1;
        if v_state.id is null then
          v_issues := v_issues || private.branch_import_issue('error', 'state', 'state',
            format('Estado não encontrado: %s. Use a sigla (ex.: MG) ou o nome.', v_state_raw));
        end if;
      end if;
      if v_city_raw is not null then
        if v_state_raw is null then
          v_issues := v_issues || private.branch_import_issue('error', 'state', 'state_city',
            format('Informe o estado da cidade %s: há municípios com o mesmo nome em estados diferentes.', v_city_raw));
        elsif v_state.id is not null then
          select c.id, c.name into v_city_id, v_city_name
            from public.cities c
           where c.state_id = v_state.id
             and private.import_text_key(c.name) = private.import_text_key(v_city_raw)
           order by c.is_municipality desc
           limit 1;
          if v_city_id is null then
            select string_agg(distinct s.uf::text, ', ') into v_elsewhere
              from public.cities c join public.states s on s.id = c.state_id
             where private.import_text_key(c.name) = private.import_text_key(v_city_raw);
            v_issues := v_issues || private.branch_import_issue('error', 'city', 'state_city',
              format('A cidade %s não pertence ao estado %s%s.', v_city_raw, btrim(v_state.uf::text),
                case when v_elsewhere is not null then ' (encontrada em: ' || v_elsewhere || ')' else '' end));
          end if;
        end if;
      end if;

      if v_is_new then
        v_final_state := v_state.id;
        v_final_city  := v_city_id;
      elsif v_state.id is not null then
        v_final_state := v_state.id;
        v_final_city  := coalesce(v_city_id, case when v_state.id = v_cur.state_id then v_cur.city_id end);
        if v_state.id is distinct from v_cur.state_id and v_city_raw is null and v_cur.city_id is not null then
          v_issues := v_issues || private.branch_import_issue('error', 'city', 'state_city',
            format('O estado informado (%s) difere do atual (%s) e a cidade não foi informada. Informe a cidade do novo estado.',
              btrim(v_state.uf::text), coalesce(v_cur_uf, '—')));
        end if;
      else
        v_final_state := v_cur.state_id;
        v_final_city  := v_cur.city_id;
      end if;

      -- ---------------------------------------------- endereço e observações ---
      v_street     := nullif(btrim(coalesce(r ->> 'street', '')), '');
      v_number     := nullif(btrim(coalesce(r ->> 'street_number', '')), '');
      v_complement := nullif(btrim(coalesce(r ->> 'complement', '')), '');
      v_district   := nullif(btrim(coalesce(r ->> 'district', '')), '');
      v_notes      := nullif(btrim(coalesce(r ->> 'notes', '')), '');
      if v_street is not null and length(v_street) > 200 then
        v_issues := v_issues || private.branch_import_issue('error', 'street', 'invalid_value', 'O endereço excede 200 caracteres.');
      end if;
      if v_number is not null and length(v_number) > 20 then
        v_issues := v_issues || private.branch_import_issue('error', 'street_number', 'invalid_value', 'O número excede 20 caracteres.');
      end if;
      if v_complement is not null and length(v_complement) > 120 then
        v_issues := v_issues || private.branch_import_issue('error', 'complement', 'invalid_value', 'O complemento excede 120 caracteres.');
      end if;
      if v_district is not null and length(v_district) > 120 then
        v_issues := v_issues || private.branch_import_issue('error', 'district', 'invalid_value', 'O bairro excede 120 caracteres.');
      end if;
      if v_notes is not null and length(v_notes) > 2000 then
        v_issues := v_issues || private.branch_import_issue('error', 'notes', 'invalid_value', 'As observações excedem 2000 caracteres.');
      end if;

      -- ----------------------------------------------- operações vinculadas ---
      v_tokens := private.branch_import_operation_tokens(r ->> 'operations');
      -- A vírgula só separa quando nada mais separa e o valor inteiro não é o
      -- nome de uma operação — "OP-00001, OP-00002" funciona, e um nome com
      -- vírgula continua funcionando.
      if coalesce(array_length(v_tokens, 1), 0) = 1 and position(',' in v_tokens[1]) > 0
         and (private.import_find_operation(p_organization_id, v_tokens[1])).id is null then
        v_tokens := private.branch_import_operation_tokens(replace(v_tokens[1], ',', ';'));
      end if;

      foreach v_tok in array v_tokens loop
        v_op := null;
        if v_tok ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          select o.* into v_op from public.operations o
           where o.id = v_tok::uuid and o.organization_id = p_organization_id and o.deleted_at is null;
          if v_op.id is null then
            if exists (select 1 from public.operations o where o.id = v_tok::uuid and o.organization_id <> p_organization_id) then
              -- §59 "operação de outra organização": diz que é de fora, sem dizer de quem nem qual.
              v_issues := v_issues || private.branch_import_issue('error', 'operations', 'other_organization',
                'Uma das operações informadas pertence a outra organização e não pode ser vinculada.');
            else
              v_issues := v_issues || private.branch_import_issue('error', 'operations', 'operation',
                format('Operação não encontrada nesta organização: %s.', v_tok));
            end if;
            continue;
          end if;
        else
          v_op := private.import_find_operation(p_organization_id, v_tok);
          if v_op.id is null then
            v_issues := v_issues || private.branch_import_issue('error', 'operations', 'operation',
              format('Operação não encontrada nesta organização: %s.', v_tok));
            continue;
          end if;
        end if;

        if v_op.id = any (v_seen) then
          continue;
        end if;
        v_seen := v_seen || v_op.id;

        if not v_is_new and exists (
          select 1 from public.organization_unit_operations l
           where l.organization_unit_id = v_cur.id and l.operation_id = v_op.id
             and (l.effective_to is null or l.effective_to >= current_date)) then
          v_ops := v_ops || jsonb_build_object('id', v_op.id, 'code', v_op.code, 'name', v_op.name, 'link', 'kept');
        elsif v_op.status <> 'active' then
          v_issues := v_issues || private.branch_import_issue('error', 'operations', 'operation_inactive',
            format('A operação %s está inativa e não recebe vínculo novo.', v_op.name));
        elsif not private.can_access_operation(v_op.id) then
          v_issues := v_issues || private.branch_import_issue('error', 'operations', 'scope',
            format('A operação %s não faz parte do seu escopo de acesso.', v_op.name));
        elsif not v_can_ops then
          v_issues := v_issues || private.branch_import_issue('error', 'operations', 'permission',
            format('Vincular a operação %s exige a permissão de gerenciar as operações da filial.', v_op.name));
        else
          v_ops := v_ops || jsonb_build_object('id', v_op.id, 'code', v_op.code, 'name', v_op.name, 'link', 'add');
          v_add := v_add || to_jsonb(v_op.id);
        end if;
      end loop;

      -- §60: o que está vinculado hoje e não veio no arquivo continua vinculado.
      if not v_is_new and coalesce(array_length(v_tokens, 1), 0) > 0 then
        select coalesce(array_agg(o.name order by o.name), '{}') into v_kept
          from public.organization_unit_operations l
          join public.operations o on o.id = l.operation_id
         where l.organization_unit_id = v_cur.id
           and (l.effective_to is null or l.effective_to >= current_date)
           and not (l.operation_id = any (v_seen));
        if coalesce(array_length(v_kept, 1), 0) > 0 then
          v_issues := v_issues || private.branch_import_issue('warning', 'operations', 'links_kept',
            format('Vínculos atuais que não estão no arquivo continuam como estão: %s. A importação nunca desvincula operações.',
              array_to_string(v_kept, ', ')));
        end if;
      end if;

      -- ----------------------------------------- diferenças atual × recebido ---
      if not v_is_new then
        if v_name is not null and v_name is distinct from v_cur.name then
          v_changes := v_changes || jsonb_build_object('field', 'name', 'label', 'Nome da filial', 'current', v_cur.name, 'received', v_name);
        end if;
        if v_legal is not null and v_legal is distinct from v_cur.legal_name then
          v_changes := v_changes || jsonb_build_object('field', 'legal_name', 'label', 'Razão social', 'current', v_cur.legal_name, 'received', v_legal);
        end if;
        if v_doc is not null and v_cur.document_number is null then
          v_changes := v_changes || jsonb_build_object('field', 'document_number', 'label', 'CNPJ', 'current', null, 'received', v_doc);
        end if;
        if v_cep is not null and v_cep is distinct from v_cur.postal_code then
          v_changes := v_changes || jsonb_build_object('field', 'postal_code', 'label', 'CEP', 'current', v_cur.postal_code, 'received', v_cep);
        end if;
        if v_final_state is distinct from v_cur.state_id then
          v_changes := v_changes || jsonb_build_object('field', 'state', 'label', 'Estado', 'current', v_cur_uf, 'received', btrim(v_state.uf::text));
        end if;
        if v_final_city is distinct from v_cur.city_id then
          v_changes := v_changes || jsonb_build_object('field', 'city', 'label', 'Cidade', 'current', v_cur_city, 'received', v_city_name);
        end if;
        if v_street is not null and v_street is distinct from v_cur.street then
          v_changes := v_changes || jsonb_build_object('field', 'street', 'label', 'Endereço', 'current', v_cur.street, 'received', v_street);
        end if;
        if v_number is not null and v_number is distinct from v_cur.street_number then
          v_changes := v_changes || jsonb_build_object('field', 'street_number', 'label', 'Número', 'current', v_cur.street_number, 'received', v_number);
        end if;
        if v_complement is not null and v_complement is distinct from v_cur.complement then
          v_changes := v_changes || jsonb_build_object('field', 'complement', 'label', 'Complemento', 'current', v_cur.complement, 'received', v_complement);
        end if;
        if v_district is not null and v_district is distinct from v_cur.district then
          v_changes := v_changes || jsonb_build_object('field', 'district', 'label', 'Bairro', 'current', v_cur.district, 'received', v_district);
        end if;
        if v_notes is not null and v_notes is distinct from v_cur.notes then
          v_changes := v_changes || jsonb_build_object('field', 'notes', 'label', 'Observações', 'current', v_cur.notes, 'received', v_notes);
        end if;
      end if;

      -- -------------------------------------------------- ação e permissão ---
      if v_is_new then
        v_action := 'create';
        if not v_can_create then
          v_issues := v_issues || private.branch_import_issue('error', null, 'permission',
            'Você não possui permissão para cadastrar filiais.');
        end if;
      elsif jsonb_array_length(v_changes) > 0 or jsonb_array_length(v_add) > 0 then
        v_action := 'update';
        if jsonb_array_length(v_changes) > 0 and not v_can_update then
          v_issues := v_issues || private.branch_import_issue('error', null, 'permission',
            'Você não possui permissão para editar filiais.');
        end if;
        v_issues := v_issues || private.branch_import_issue('warning', null, 'existing',
          format('Filial já cadastrada (código %s): %s campo(s) a atualizar e %s operação(ões) a vincular. Nada é apagado.',
            v_code, jsonb_array_length(v_changes), jsonb_array_length(v_add)));
      else
        v_action := 'skip';
        v_issues := v_issues || private.branch_import_issue('warning', null, 'existing',
          format('Filial já cadastrada (código %s); nada a alterar.', v_code));
      end if;
    exception when others then
      v_issues := v_issues || private.branch_import_issue('error', null, 'unexpected', sqlerrm);
    end;

    v_status := case
      when exists (select 1 from jsonb_array_elements(v_issues) x where x ->> 'level' = 'error') then 'error'
      when jsonb_array_length(v_issues) > 0 then 'warning'
      else 'valid' end;
    if v_status = 'error' then
      v_action := 'skip';
    end if;

    v_norm := jsonb_build_object(
      'code', v_code, 'name', v_name, 'legal_name', v_legal, 'document_number', v_doc,
      'status', v_st, 'status_raw', v_st_raw, 'postal_code', v_cep,
      'state_id', v_state.id, 'state_uf', btrim(v_state.uf::text), 'city_id', v_city_id, 'city_name', v_city_name,
      'final_state_id', v_final_state, 'final_city_id', v_final_city,
      'street', v_street, 'street_number', v_number, 'complement', v_complement, 'district', v_district,
      'notes', v_notes,
      'operations', v_ops, 'operations_to_add', v_add, 'links_kept_outside_file', to_jsonb(v_kept),
      'branch_id', v_cur.id, 'current_name', v_cur.name, 'current_status', v_cur.status,
      'current_updated_at', v_cur.updated_at, 'current_snapshot', private.branch_import_snapshot(v_cur),
      'changes', v_changes);

    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    values (p_organization_id, v_batch, v_row_no, coalesce(r -> 'raw', '{}'::jsonb), v_norm, v_status, v_action);

    for i in select * from jsonb_array_elements(v_issues) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, v_batch, v_row_no, i ->> 'level', i ->> 'field', i ->> 'code', i ->> 'message');
    end loop;

    if v_status = 'valid' then n_valid := n_valid + 1;
    elsif v_status = 'warning' then n_warn := n_warn + 1;
    else n_err := n_err + 1; end if;
    if v_status <> 'error' then
      if v_action = 'create' then n_create := n_create + 1;
      elsif v_action = 'update' then n_update := n_update + 1;
      else n_skip := n_skip + 1; end if;
    end if;
  end loop;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         summary = jsonb_build_object('create', n_create, 'update', n_update, 'skip', n_skip),
         updated_at = now(), updated_by = v_uid
   where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'already_imported', v_already,
    'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
    'create_rows', n_create, 'update_rows', n_update, 'skip_rows', n_skip,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'row_number', x.row_number, 'status', x.status, 'action', x.action, 'data', x.normalized_data,
               'issues', coalesce((
                 select jsonb_agg(jsonb_build_object('level', e.level, 'field', e.field, 'code', e.code, 'message', e.message)
                                  order by (e.level = 'error') desc, e.created_at)
                   from public.import_errors e
                  where e.batch_id = v_batch and e.row_number = x.row_number), '[]'::jsonb))
             order by x.row_number)
        from (select * from public.import_rows where batch_id = v_batch order by row_number limit 500) x), '[]'::jsonb));
end;
$$;

-- =============================================================================
-- §58–§62 · process_branch_import — grava o que a prévia prometeu
-- =============================================================================
create or replace function public.process_branch_import(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_batch    public.import_batches;
  x          record;
  v_id       uuid;
  v_cur      public.organization_units;
  v_op_id    uuid;
  v_op_st    text;
  v_added    jsonb;
  n_created  integer := 0;
  n_updated  integer := 0;
  n_links    integer := 0;
  n_failed   integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão não identificada. Entre novamente para importar filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'branches.import') then
    raise exception 'Você não possui permissão para importar filiais.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_batch from public.import_batches
   where id = p_batch_id and organization_id = p_organization_id and type = 'branches'
   for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status <> 'validated' then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  -- A prévia confirmada é a que a própria pessoa viu.
  if v_batch.created_by is distinct from v_uid then
    raise exception 'Esta importação foi validada por outra pessoa. Valide o arquivo novamente para confirmar.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.import_batches set status = 'processing', updated_at = now(), updated_by = v_uid where id = p_batch_id;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
  loop
    if x.action not in ('create', 'update') then
      update public.import_rows set status = 'skipped' where id = x.id;
      continue;
    end if;

    begin
      v_added := '[]'::jsonb;

      if x.action = 'create' then
        -- Pela rotina oficial: mesma validação de CNPJ, mesmas permissões.
        v_id := public.save_branch(p_organization_id, jsonb_build_object(
          'code', x.d ->> 'code', 'name', x.d ->> 'name', 'legal_name', x.d ->> 'legal_name',
          'document_number', x.d ->> 'document_number', 'status', coalesce(x.d ->> 'status', 'active'),
          'notes', x.d ->> 'notes', 'postal_code', x.d ->> 'postal_code',
          'street', x.d ->> 'street', 'street_number', x.d ->> 'street_number',
          'complement', x.d ->> 'complement', 'district', x.d ->> 'district',
          'state_id', x.d -> 'final_state_id', 'city_id', x.d -> 'final_city_id'));
      else
        select u.* into v_cur from public.organization_units u
         where u.id = (x.d ->> 'branch_id')::uuid and u.organization_id = p_organization_id and u.deleted_at is null
         for update;
        if v_cur.id is null then
          raise exception 'A filial % não existe mais nesta organização.', x.d ->> 'code' using errcode = 'no_data_found';
        end if;
        -- As diferenças mostradas valem para a filial como estava na prévia.
        if private.branch_import_snapshot(v_cur) is distinct from (x.d -> 'current_snapshot') then
          raise exception 'A filial % foi alterada depois da prévia. Valide o arquivo de novo para ver as diferenças atuais.', v_cur.name
            using errcode = 'serialization_failure';
        end if;
        v_id := v_cur.id;

        if jsonb_array_length(coalesce(x.d -> 'changes', '[]'::jsonb)) > 0 then
          -- Coluna vazia é "não informado": o que não veio fica como está. Sem
          -- `status` (situação muda pela tela) e sem `operations` (os vínculos
          -- são acrescentados abaixo, nunca substituídos).
          perform public.save_branch(p_organization_id, jsonb_build_object(
            'id', v_cur.id, 'code', v_cur.code,
            'name', coalesce(x.d ->> 'name', v_cur.name),
            'legal_name', coalesce(x.d ->> 'legal_name', v_cur.legal_name),
            'document_number', coalesce(v_cur.document_number, x.d ->> 'document_number'),
            'notes', coalesce(x.d ->> 'notes', v_cur.notes),
            'postal_code', coalesce(x.d ->> 'postal_code', v_cur.postal_code),
            'street', coalesce(x.d ->> 'street', v_cur.street),
            'street_number', coalesce(x.d ->> 'street_number', v_cur.street_number),
            'complement', coalesce(x.d ->> 'complement', v_cur.complement),
            'district', coalesce(x.d ->> 'district', v_cur.district),
            'state_id', x.d -> 'final_state_id', 'city_id', x.d -> 'final_city_id',
            'expected_updated_at', v_cur.updated_at));
        end if;
      end if;

      -- Vínculos: só os que não existem. Nada é encerrado, nada é reaberto.
      for v_op_id in
        select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(x.d -> 'operations_to_add', '[]'::jsonb))
      loop
        if not private.has_permission(p_organization_id, 'branches.manage_operations') then
          raise exception 'Você não possui permissão para gerenciar as operações da filial.'
            using errcode = 'insufficient_privilege';
        end if;
        if exists (select 1 from public.organization_unit_operations l
                    where l.organization_unit_id = v_id and l.operation_id = v_op_id
                      and (l.effective_to is null or l.effective_to >= current_date)) then
          continue;
        end if;
        select o.status into v_op_st from public.operations o
         where o.id = v_op_id and o.organization_id = p_organization_id and o.deleted_at is null;
        if v_op_st is distinct from 'active' then
          raise exception 'Uma das operações da prévia não existe mais ou foi inativada. Valide o arquivo de novo.'
            using errcode = 'invalid_parameter_value';
        end if;
        insert into public.organization_unit_operations
          (organization_id, organization_unit_id, operation_id, effective_from, notes)
        values
          (p_organization_id, v_id, v_op_id, current_date, left('Importação: ' || v_batch.file_name, 500));
        perform private.emit_event(p_organization_id, 'branch.operation_added', 'organization_unit', v_id,
          jsonb_build_object('operation_id', v_op_id, 'source', 'import', 'batch_id', p_batch_id, 'actor', v_uid));
        v_added := v_added || to_jsonb(v_op_id);
        n_links := n_links + 1;
      end loop;

      -- §65 branch.imported: quem, quando, qual filial, o que mudou.
      insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
      values (p_organization_id, v_uid, 'branch_import', v_id::text,
              case when x.action = 'create' then 'INSERT' else 'UPDATE' end,
              jsonb_build_object('batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', x.row_number,
                                 'action', x.action, 'changes', coalesce(x.d -> 'changes', '[]'::jsonb),
                                 'operations_added', v_added));
      perform private.emit_event(p_organization_id, 'branch.imported', 'organization_unit', v_id,
        jsonb_build_object('batch_id', p_batch_id, 'action', x.action, 'actor', v_uid));

      update public.import_rows set status = case when x.action = 'create' then 'created' else 'updated' end
       where id = x.id;
      if x.action = 'create' then n_created := n_created + 1; else n_updated := n_updated + 1; end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
      n_failed := n_failed + 1;
    end;
  end loop;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created, updated_rows = n_updated,
         skipped_rows = (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
         summary = summary || jsonb_build_object('links_added', n_links, 'failed', n_failed),
         updated_at = now(), updated_by = v_uid
   where id = p_batch_id;

  return jsonb_build_object(
    'created', n_created, 'updated', n_updated, 'links_added', n_links, 'failed', n_failed,
    'skipped', (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'message', e.message) order by e.row_number)
                          from public.import_errors e where e.batch_id = p_batch_id and e.code = 'process'), '[]'::jsonb));
end;
$$;

-- =============================================================================
-- §61 · log_branch_export — sem registro, sem arquivo
-- =============================================================================
create or replace function public.log_branch_export(
  p_organization_id uuid,
  p_format          text,
  p_row_count       integer,
  p_kind            text,
  p_details         jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Sessão não identificada. Entre novamente para exportar filiais.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_format is null or p_format not in ('xlsx', 'csv') then
    raise exception 'Formato de exportação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind is null or p_kind not in ('todas', 'filtradas', 'selecionadas', 'operacoes', 'modelo') then
    raise exception 'Tipo de exportação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'modelo' then
    if not (private.has_permission(p_organization_id, 'branches.import')
            or private.has_permission(p_organization_id, 'branches.export')) then
      raise exception 'Você não possui permissão para baixar o modelo de importação de filiais.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not private.has_permission(p_organization_id, 'branches.export') then
    raise exception 'Você não possui permissão para exportar filiais.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_logs (organization_id, user_id, entity_type, entity_id, action, new_data)
  values (p_organization_id, v_uid, 'branch_export', null, 'EXPORT',
          jsonb_build_object(
            'format', p_format, 'kind', p_kind, 'row_count', greatest(coalesce(p_row_count, 0), 0),
            'details', case when pg_column_size(coalesce(p_details, '{}'::jsonb)) > 16384
                            then jsonb_build_object('truncated', true)
                            else coalesce(p_details, '{}'::jsonb) end))
  returning id into v_id;

  perform private.emit_event(p_organization_id, 'branch.exported', 'organization', p_organization_id,
    jsonb_build_object('audit_id', v_id, 'format', p_format, 'kind', p_kind,
                       'row_count', greatest(coalesce(p_row_count, 0), 0), 'actor', v_uid));
  return v_id;
end;
$$;

-- =============================================================================
-- §38 · Centros de custo da filial
-- =============================================================================
create or replace view public.branch_cost_center_directory
with (security_invoker = on) as
select
  c.id,
  c.organization_id,
  c.code,
  c.name,
  c.status,
  c.organization_unit_id,
  u.code as branch_code,
  u.name as branch_name,
  c.updated_at
from public.cost_centers c
left join public.organization_units u
  on u.id = c.organization_unit_id and u.organization_id = c.organization_id
where c.deleted_at is null;

comment on view public.branch_cost_center_directory is
  'Centros de custo vivos com a filial a que estão associados. security_invoker: quem não tem cost_centers.view não vê nenhum.';

grant select on public.branch_cost_center_directory to authenticated;

create or replace function public.set_branch_cost_center(
  p_organization_unit_id uuid,
  p_cost_center_id       uuid,
  p_linked               boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_unit  public.organization_units;
  v_cc    public.cost_centers;
  v_other text;
begin
  if v_uid is null then
    raise exception 'Sessão não identificada. Entre novamente.' using errcode = 'insufficient_privilege';
  end if;
  if p_linked is null then
    raise exception 'Informe se o centro de custo deve ser associado ou desassociado.'
      using errcode = 'invalid_parameter_value';
  end if;

  select u.* into v_unit from public.organization_units u
   where u.id = p_organization_unit_id and u.deleted_at is null;
  -- Quem não enxerga filiais desta organização recebe "não encontrada", não "sem permissão".
  if v_unit.id is null or not private.has_permission(v_unit.organization_id, 'branches.view') then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_unit.organization_id, 'branches.update')
     or not private.has_permission(v_unit.organization_id, 'cost_centers.manage') then
    raise exception 'Você não possui permissão para associar centros de custo à filial.'
      using errcode = 'insufficient_privilege';
  end if;

  select c.* into v_cc from public.cost_centers c
   where c.id = p_cost_center_id and c.deleted_at is null
   for update;
  -- A organização dos dois lados é conferida aqui; a FK composta de
  -- cost_centers recusaria de qualquer forma.
  if v_cc.id is null or v_cc.organization_id <> v_unit.organization_id then
    raise exception 'Centro de custo não encontrado nesta organização.' using errcode = 'no_data_found';
  end if;

  if p_linked then
    if v_cc.organization_unit_id = v_unit.id then
      return jsonb_build_object('changed', false, 'cost_center_id', v_cc.id, 'organization_unit_id', v_unit.id);
    end if;
    if v_cc.organization_unit_id is not null then
      select u.name into v_other from public.organization_units u where u.id = v_cc.organization_unit_id;
      raise exception 'O centro de custo % já está associado à filial %. Desassocie-o lá antes de associá-lo a esta.',
        v_cc.name, coalesce(v_other, '(outra filial)') using errcode = 'invalid_parameter_value';
    end if;
    if v_unit.status <> 'active' then
      raise exception 'Uma filial inativa não recebe novos centros de custo.' using errcode = 'invalid_parameter_value';
    end if;
    if v_cc.status <> 'active' then
      raise exception 'O centro de custo % está inativo e não pode ser associado.', v_cc.name
        using errcode = 'invalid_parameter_value';
    end if;

    update public.cost_centers set organization_unit_id = v_unit.id where id = v_cc.id;
    perform private.emit_event(v_unit.organization_id, 'branch.cost_center_added', 'organization_unit', v_unit.id,
      jsonb_build_object('cost_center_id', v_cc.id, 'actor', v_uid));
  else
    if v_cc.organization_unit_id is distinct from v_unit.id then
      raise exception 'O centro de custo % não está associado a esta filial.', v_cc.name
        using errcode = 'invalid_parameter_value';
    end if;
    update public.cost_centers set organization_unit_id = null where id = v_cc.id;
    perform private.emit_event(v_unit.organization_id, 'branch.cost_center_removed', 'organization_unit', v_unit.id,
      jsonb_build_object('cost_center_id', v_cc.id, 'actor', v_uid));
  end if;

  return jsonb_build_object('changed', true, 'cost_center_id', v_cc.id,
                            'organization_unit_id', case when p_linked then v_unit.id end);
end;
$$;

-- =============================================================================
-- Histórico da filial: importações e centros de custo entram na aba
-- =============================================================================
create or replace function public.branch_audit_trail(
  p_organization_unit_id uuid,
  p_limit                integer default 100
)
returns table (
  id             uuid,
  entity_type    text,
  action         text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  actor_name     text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_cc_view boolean;
begin
  select u.organization_id into v_org
    from public.organization_units u
   where u.id = p_organization_unit_id;

  if v_org is null then
    raise exception 'Filial não encontrada.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'branches.view_audit') then
    raise exception 'Você não possui permissão para ler o histórico da filial.'
      using errcode = 'insufficient_privilege';
  end if;
  -- As linhas de centro de custo carregam o cadastro do centro: só para quem o lê.
  v_cc_view := private.has_permission(v_org, 'cost_centers.view');

  return query
    select a.id, a.entity_type, a.action, a.changed_fields, a.old_data, a.new_data,
           e.full_name, a.created_at
      from public.audit_logs a
      left join public.organization_memberships m
        on m.organization_id = a.organization_id and m.user_id = a.user_id
      left join public.employees e
        on e.organization_id = a.organization_id and e.id = m.employee_id
     where a.organization_id = v_org
       and (
         (a.entity_type = 'public.organization_units'
          and a.entity_id = p_organization_unit_id::text)
         or (a.entity_type = 'public.organization_unit_operations'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
         or (a.entity_type = 'public.vehicle_unit_assignments'
             and coalesce(a.new_data ->> 'organization_unit_id',
                          a.old_data ->> 'organization_unit_id') = p_organization_unit_id::text)
         or (a.entity_type = 'branch_import'
             and a.entity_id = p_organization_unit_id::text)
         or (v_cc_view
             and a.entity_type = 'public.cost_centers'
             and (a.new_data ->> 'organization_unit_id' = p_organization_unit_id::text
                  or a.old_data ->> 'organization_unit_id' = p_organization_unit_id::text))
       )
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.stage_branch_import(uuid, jsonb) from public, anon;
revoke all on function public.process_branch_import(uuid, uuid) from public, anon;
revoke all on function public.log_branch_export(uuid, text, integer, text, jsonb) from public, anon;
revoke all on function public.set_branch_cost_center(uuid, uuid, boolean) from public, anon;
revoke all on function public.branch_audit_trail(uuid, integer) from public, anon;
grant execute on function public.stage_branch_import(uuid, jsonb) to authenticated;
grant execute on function public.process_branch_import(uuid, uuid) to authenticated;
grant execute on function public.log_branch_export(uuid, text, integer, text, jsonb) to authenticated;
grant execute on function public.set_branch_cost_center(uuid, uuid, boolean) to authenticated;
grant execute on function public.branch_audit_trail(uuid, integer) to authenticated;

comment on function public.stage_branch_import(uuid, jsonb) is
  'Etapa 09 §58–§60: valida um arquivo de filiais (código, nome, razão social, CNPJ, situação, CEP, estado, cidade, endereço, operações, observações) e devolve a prévia com as diferenças atual × recebido. Não altera filial nenhuma. Exige branches.import.';
comment on function public.process_branch_import(uuid, uuid) is
  'Etapa 09 §58–§62: cria e atualiza filiais de um lote validado pela própria pessoa, via save_branch. Só acrescenta vínculos operacionais; nunca desvincula, nunca muda situação, filial de colaborador ou veículo, nem perfis, roles, permissions ou escopos.';
comment on function public.log_branch_export(uuid, text, integer, text, jsonb) is
  'Etapa 09 §61/§65: registra uma exportação de filiais em audit_logs (EXPORT) e emite branch.exported. Exige branches.export (ou branches.import para o modelo vazio).';
comment on function public.set_branch_cost_center(uuid, uuid, boolean) is
  'Etapa 09 §38: associa ou desassocia um centro de custo existente de uma filial da mesma organização. Exige branches.update e cost_centers.manage. Nunca cria centro de custo.';
