-- =============================================================================
-- Etapa 13 (continuação) — importação validada, situação do vínculo e exportação
--
-- Fecha três pendências declaradas na entrega do Planner de Locais e BRs:
--
-- 1. IMPORTAÇÃO PELA TELA (§56, §57, §58, CA23). A base histórica entrou por
--    rotina transacional; faltava o fluxo oficial `import_batches` →
--    `import_rows` → validar → processar, com prévia honesta. Dois tipos de
--    arquivo, duas duplas de rotinas security definer:
--      · `stage_br_import` / `process_br_import` — cadastro de BRs (§56);
--      · `stage_fidelization_import` / `process_fidelization_import` —
--        planejamento de veículos por BR (§57), com a prévia da §58: registros
--        existentes, vínculos novos, substituições, sobreposições, BRs
--        desconhecidos, veículos não encontrados e erros de competência.
--    O que a importação de alocações NUNCA faz: criar veículo, BR ou
--    colaborador; sobrescrever vínculo histórico em silêncio; tocar em Perfil
--    de Acesso. Uma sobreposição que não é uma substituição limpa é erro.
--
-- 2. SITUAÇÃO DO VÍNCULO. Os estados planejado / confirmado / executado /
--    cancelado existiam desde a Etapa 08, mas nada os movia: todo planejamento
--    novo nascia `planned` e ficava. `set_fidelization_assignment_status` faz a
--    transição com regras: confirmar e cancelar valem para o planejado e o
--    confirmado; executar exige que o período já tenha começado; executado e
--    cancelado são terminais; cancelar exige motivo e encerra os motoristas.
--
-- 3. EXPORTAÇÃO AUDITADA (`fidelization.export`). A permissão existia sem
--    rotina. `log_fidelization_export` registra cada exportação na auditoria,
--    como as de frotas e usuários.
--
-- Nada aqui é destrutivo: só CHECKs ampliados e funções novas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos de lote e ação de linha
-- -----------------------------------------------------------------------------
alter table public.import_batches drop constraint if exists import_batches_type_check;
alter table public.import_batches
  add constraint import_batches_type_check
  check (type in ('employees', 'vehicles', 'adherence', 'operation_brs', 'fidelization'));

alter table public.import_rows drop constraint if exists import_rows_action_check;
alter table public.import_rows
  add constraint import_rows_action_check
  check (action in ('create', 'update', 'skip', 'substitute'));

-- -----------------------------------------------------------------------------
-- Defeito pré-existente corrigido de passagem: a Etapa 13 criou a versão de
-- `assert_vehicle_fidelizable` com o parâmetro de período (com default) SEM
-- retirar a versão antiga de três parâmetros. Toda chamada com três argumentos
-- — a de `substitute_fidelization_vehicle`, por exemplo — passou a ser ambígua
-- ("function … is not unique") e a substituição de veículo estava quebrada no
-- banco. A versão nova, com default, atende as duas formas de chamada.
-- -----------------------------------------------------------------------------
drop function if exists private.assert_vehicle_fidelizable(uuid, uuid, uuid);

-- -----------------------------------------------------------------------------
-- Chave textual para casar nomes vindos de planilha (acento, caixa e espaços)
-- -----------------------------------------------------------------------------
create or replace function private.import_text_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(translate(btrim(coalesce(p_value, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g'), '');
$$;

-- Resolve a operação pelo nome ou pelo código, dentro da organização.
create or replace function private.import_find_operation(p_organization_id uuid, p_value text)
returns public.operations
language sql
stable
set search_path = ''
as $$
  select o.* from public.operations o
   where o.organization_id = p_organization_id and o.deleted_at is null
     and (private.import_text_key(o.name) = private.import_text_key(p_value)
          or private.normalize_code(o.code) = private.normalize_code(p_value))
   order by (private.normalize_code(o.code) = private.normalize_code(p_value)) desc
   limit 1;
$$;

-- -----------------------------------------------------------------------------
-- §56 · stage_br_import — valida o cadastro de BRs e devolve a prévia
-- -----------------------------------------------------------------------------
create or replace function public.stage_br_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   uuid;
  v_already boolean := false;
  r         jsonb;
  v_row_no  integer;
  v_issues  jsonb;
  v_status  text;
  v_action  text;
  v_code    text;
  v_desc    text;
  v_notes   text;
  v_st_raw  text;
  v_st      text;
  v_op      public.operations;
  v_cov_id  uuid; v_cov_city integer; v_cov_state smallint; v_cov_city_name text; v_cov_uf text;
  v_n       integer;
  v_br      public.operation_brs;
  v_other_id uuid; v_other_city text;
  v_norm    jsonb;
  i         jsonb;
  n_total   integer := 0; n_valid integer := 0; n_warn integer := 0; n_err integer := 0;
  n_create  integer := 0; n_update integer := 0; n_skip integer := 0;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import')
     or not private.has_permission(p_organization_id, 'fidelization.manage_brs') then
    raise exception 'Você não possui permissão para importar posições operacionais.'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
    raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_payload -> 'rows') > 5000 then
    raise exception 'A planilha excede 5000 linhas.' using errcode = 'invalid_parameter_value';
  end if;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'operation_brs' and b.status = 'completed'
       and b.file_hash = p_payload ->> 'file_hash') into v_already;

  insert into public.import_batches
    (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
  values
    (p_organization_id, 'operation_brs', 'create_update', 'draft',
     coalesce(nullif(p_payload ->> 'file_name', ''), 'brs'),
     nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
     coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_payload -> 'rows') loop
    n_total := n_total + 1;
    v_row_no := coalesce((r ->> 'row_number')::integer, n_total + 1);
    v_issues := '[]'::jsonb; v_action := 'create'; v_norm := '{}'::jsonb;
    v_op := null; v_br := null; v_other_id := null; v_other_city := null;
    v_cov_id := null; v_cov_city := null; v_cov_state := null; v_cov_city_name := null; v_cov_uf := null;

    begin
      v_code   := private.normalize_code(r ->> 'code');
      v_desc   := left(nullif(btrim(coalesce(r ->> 'description', '')), ''), 240);
      v_notes  := left(nullif(btrim(coalesce(r ->> 'notes', '')), ''), 2000);
      v_st_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
      v_st := case private.import_text_key(v_st_raw)
                when 'ativo' then 'active' when 'ativa' then 'active' when 'active' then 'active'
                when 'inativo' then 'inactive' when 'inativa' then 'inactive' when 'inactive' then 'inactive'
                else null end;
      if v_st_raw is null then v_st := 'active'; end if;

      if v_code is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'code', 'code', 'code', 'message', 'Informe o código da BR.');
      elsif length(v_code) > 40 then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'code', 'code', 'code', 'message', 'O código da BR excede 40 caracteres.');
      end if;
      if v_st is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'status',
          'message', format('Situação inválida: %s (use Ativo ou Inativo).', v_st_raw));
      end if;

      -- Operação: pelo nome ou pelo código, ativa e dentro do escopo de quem importa.
      if nullif(btrim(coalesce(r ->> 'operation', '')), '') is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'operation', 'code', 'operation', 'message', 'Informe a operação.');
      else
        v_op := private.import_find_operation(p_organization_id, r ->> 'operation');
        if v_op.id is null then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'operation', 'code', 'operation',
            'message', format('Operação não encontrada: %s.', btrim(r ->> 'operation')));
        elsif v_op.status <> 'active' then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'operation', 'code', 'operation',
            'message', format('A operação %s está inativa.', v_op.name));
        elsif not private.can_access_operation(v_op.id) then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'operation', 'code', 'scope',
            'message', format('A operação %s não faz parte do seu escopo de acesso.', v_op.name));
        end if;
      end if;

      -- Cidade: precisa estar na cobertura da operação (§10, §33).
      if v_op.id is not null and v_op.status = 'active' then
        if nullif(btrim(coalesce(r ->> 'city', '')), '') is null then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'city', 'code', 'city', 'message', 'Informe a cidade.');
        else
          select count(*) into v_n
            from public.operation_cities c
            join public.cities ci on ci.id = c.city_id
            join public.states s on s.id = c.state_id
           where c.organization_id = p_organization_id and c.operation_id = v_op.id
             and private.import_text_key(ci.name) = private.import_text_key(r ->> 'city')
             and (nullif(btrim(coalesce(r ->> 'state', '')), '') is null or upper(btrim(s.uf::text)) = upper(btrim(r ->> 'state')));
          if v_n = 0 then
            v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'city', 'code', 'city',
              'message', format('A cidade %s%s não faz parte da cobertura da operação %s.',
                btrim(r ->> 'city'), case when nullif(btrim(coalesce(r ->> 'state', '')), '') is null then '' else '/' || upper(btrim(r ->> 'state')) end, v_op.name));
          elsif v_n > 1 then
            v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'city', 'code', 'city',
              'message', format('A cidade %s aparece mais de uma vez na cobertura da operação %s; informe o estado.', btrim(r ->> 'city'), v_op.name));
          else
            select c.id, c.city_id, c.state_id, ci.name, s.uf::text
              into v_cov_id, v_cov_city, v_cov_state, v_cov_city_name, v_cov_uf
              from public.operation_cities c
              join public.cities ci on ci.id = c.city_id
              join public.states s on s.id = c.state_id
             where c.organization_id = p_organization_id and c.operation_id = v_op.id
               and private.import_text_key(ci.name) = private.import_text_key(r ->> 'city')
               and (nullif(btrim(coalesce(r ->> 'state', '')), '') is null or upper(btrim(s.uf::text)) = upper(btrim(r ->> 'state')));
          end if;
        end if;
      end if;

      if v_code is not null and v_cov_city is not null then
        -- Repetido dentro do próprio arquivo.
        if exists (select 1 from public.import_rows ir
                    where ir.batch_id = v_batch
                      and ir.normalized_data ->> 'identity' = v_op.id::text || '|' || v_cov_city::text || '|' || v_code) then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'code', 'code', 'duplicate',
            'message', format('O código %s repete-se no arquivo para %s/%s em %s.', v_code, v_cov_city_name, v_cov_uf, v_op.name));
        end if;

        -- Identidade ambígua (§56): o mesmo código na mesma operação, em outra cidade.
        select b.id, ci.name into v_other_id, v_other_city
          from public.operation_brs b join public.cities ci on ci.id = b.city_id
         where b.organization_id = p_organization_id and b.operation_id = v_op.id and b.deleted_at is null
           and private.normalize_code(b.code) = v_code and b.city_id <> v_cov_city
         limit 1;
        if v_other_id is not null then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'code', 'code', 'ambiguous',
            'message', format('O código %s já existe na operação %s em %s; a identidade seria ambígua.', v_code, v_op.name, v_other_city));
        end if;

        select b.* into v_br from public.operation_brs b
         where b.organization_id = p_organization_id and b.operation_id = v_op.id and b.city_id = v_cov_city
           and b.deleted_at is null and private.normalize_code(b.code) = v_code;

        if v_br.id is not null then
          -- Coluna vazia no arquivo é "não informado", nunca "apagar o que existe".
          v_desc  := coalesce(v_desc, v_br.description);
          v_notes := coalesce(v_notes, v_br.notes);
          if v_br.description is distinct from v_desc or v_br.notes is distinct from v_notes then
            v_action := 'update';
            v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', null, 'code', 'existing',
              'message', 'BR já cadastrada; a descrição e as observações serão atualizadas.');
          else
            v_action := 'skip';
            v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', null, 'code', 'existing',
              'message', 'BR já cadastrada; nada a alterar.');
          end if;
          if v_st is not null and v_br.status <> v_st then
            v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'status_divergence',
              'message', format('A situação no arquivo (%s) difere da do HFM (%s); a importação não altera a situação de uma BR existente.',
                case v_st when 'active' then 'Ativa' else 'Inativa' end, case v_br.status when 'active' then 'Ativa' else 'Inativa' end));
          end if;
        elsif v_st = 'inactive' then
          v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'inactive',
            'message', 'A BR será criada já inativa.');
        end if;
      end if;
    exception when others then
      v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'unexpected', 'message', sqlerrm);
    end;

    v_status := case
      when exists (select 1 from jsonb_array_elements(v_issues) x where x ->> 'level' = 'error') then 'error'
      when jsonb_array_length(v_issues) > 0 then 'warning'
      else 'valid' end;
    if v_status = 'error' then v_action := 'skip'; end if;

    v_norm := jsonb_build_object(
      'identity', case when v_op.id is not null and v_cov_city is not null and v_code is not null
                       then v_op.id::text || '|' || v_cov_city::text || '|' || v_code end,
      'operation_id', v_op.id, 'operation_name', v_op.name,
      'operation_city_id', v_cov_id, 'city_id', v_cov_city, 'state_id', v_cov_state,
      'city_name', v_cov_city_name, 'state_uf', v_cov_uf,
      'code', v_code, 'description', v_desc, 'notes', v_notes, 'status', v_st, 'status_raw', v_st_raw,
      'br_id', v_br.id, 'current_status', v_br.status);

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
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'already_imported', v_already,
    'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
    'create_rows', n_create, 'update_rows', n_update, 'skip_rows', n_skip,
    'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field, 'code', e.code, 'message', e.message)
                                  order by (e.level = 'error') desc, e.row_number)
                            from (select * from public.import_errors where batch_id = v_batch order by (level = 'error') desc, row_number limit 300) e), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', x.row_number, 'status', x.status, 'action', x.action, 'data', x.normalized_data) order by x.row_number)
                          from (select * from public.import_rows where batch_id = v_batch order by row_number limit 12) x), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- §56 · process_br_import — cria e atualiza pelas rotinas oficiais
-- -----------------------------------------------------------------------------
create or replace function public.process_br_import(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   public.import_batches;
  x         record;
  v_id      uuid;
  n_created integer := 0; n_updated integer := 0; n_skipped integer := 0;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import')
     or not private.has_permission(p_organization_id, 'fidelization.manage_brs') then
    raise exception 'Você não possui permissão para importar posições operacionais.'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_batch from public.import_batches
   where id = p_batch_id and organization_id = p_organization_id and type = 'operation_brs' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status <> 'validated' then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
  loop
    begin
      if x.action = 'create' then
        v_id := public.save_operation_br(p_organization_id, jsonb_build_object(
          'operation_city_id', x.d ->> 'operation_city_id', 'code', x.d ->> 'code',
          'description', x.d ->> 'description', 'notes', x.d ->> 'notes'));
        if x.d ->> 'status' = 'inactive' then
          perform public.set_operation_br_status(v_id, 'inactive', 'Importação: ' || v_batch.file_name);
        end if;
        update public.import_rows set status = 'created' where id = x.id;
        n_created := n_created + 1;
      elsif x.action = 'update' then
        perform public.save_operation_br(p_organization_id, jsonb_build_object(
          'id', x.d ->> 'br_id', 'operation_city_id', x.d ->> 'operation_city_id', 'code', x.d ->> 'code',
          'description', x.d ->> 'description', 'notes', x.d ->> 'notes'));
        update public.import_rows set status = 'updated' where id = x.id;
        n_updated := n_updated + 1;
      else
        update public.import_rows set status = 'skipped' where id = x.id;
        n_skipped := n_skipped + 1;
      end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
      n_skipped := n_skipped + 1;
    end;
  end loop;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created, updated_rows = n_updated,
         skipped_rows = (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;

  return jsonb_build_object('created', n_created, 'updated', n_updated,
    'skipped', (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')));
end;
$$;

-- -----------------------------------------------------------------------------
-- §57/§58 · stage_fidelization_import — valida o planejamento e classifica
-- -----------------------------------------------------------------------------
create or replace function public.stage_fidelization_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch    uuid;
  v_already  boolean := false;
  v_can_sub  boolean := private.has_permission(p_organization_id, 'fidelization.change_vehicle');
  r          jsonb;
  v_row_no   integer;
  v_issues   jsonb;
  v_status   text;
  v_action   text;
  v_code     text;
  v_op       public.operations;
  v_br       public.operation_brs;
  v_n        integer;
  v_veh_id   uuid; v_veh_fleet text; v_veh_plate text;
  v_start    date;
  v_end      date;
  v_role     text;
  v_role_raw text;
  v_st_raw   text;
  v_st       text;
  v_reason   text;
  v_ex       record;
  v_busy     record;
  v_norm     jsonb;
  v_replaces uuid;
  v_prev_veh text;
  v_hist     boolean;
  i          jsonb;
  n_total    integer := 0; n_valid integer := 0; n_warn integer := 0; n_err integer := 0;
  n_create   integer := 0; n_sub integer := 0; n_skip integer := 0;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import') then
    raise exception 'Você não possui permissão para importar alocações.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_payload -> 'rows') <> 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
    raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_payload -> 'rows') > 5000 then
    raise exception 'A planilha excede 5000 linhas.' using errcode = 'invalid_parameter_value';
  end if;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'fidelization' and b.status = 'completed'
       and b.file_hash = p_payload ->> 'file_hash') into v_already;

  insert into public.import_batches
    (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
  values
    (p_organization_id, 'fidelization', 'create', 'draft',
     coalesce(nullif(p_payload ->> 'file_name', ''), 'fidelizacao'),
     nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
     coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_payload -> 'rows') loop
    n_total := n_total + 1;
    v_row_no := coalesce((r ->> 'row_number')::integer, n_total + 1);
    v_issues := '[]'::jsonb; v_action := 'create'; v_norm := '{}'::jsonb;
    v_op := null; v_br := null; v_veh_id := null; v_veh_fleet := null; v_veh_plate := null;
    v_start := null; v_end := null; v_replaces := null; v_prev_veh := null; v_st := null;

    begin
      v_code   := private.normalize_code(r ->> 'br_code');
      v_reason := left(nullif(btrim(coalesce(r ->> 'reason', '')), ''), 500);
      v_role_raw := nullif(btrim(coalesce(r ->> 'vehicle_role', '')), '');
      v_role := case private.import_text_key(v_role_raw)
                  when 'titular' then 'primary' when 'primary' then 'primary' when 'principal' then 'primary'
                  when 'apoio' then 'support' when 'support' then 'support' when 'reserva' then 'support'
                  else null end;
      if v_role_raw is null then v_role := 'primary'; end if;
      if v_role is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle_role', 'code', 'role',
          'message', format('Tipo de alocação inválido: %s (use Titular ou Apoio).', v_role_raw));
      end if;

      -- Competência (§58: erros de competência).
      begin
        v_start := nullif(r ->> 'start_date', '')::date;
      exception when others then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'start_date', 'code', 'competence',
          'message', format('Data inicial inválida: %s.', r ->> 'start_date'));
      end;
      begin
        v_end := nullif(r ->> 'end_date', '')::date;
      exception when others then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'end_date', 'code', 'competence',
          'message', format('Data final inválida: %s.', r ->> 'end_date'));
      end;
      if v_start is null and nullif(r ->> 'start_date', '') is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'start_date', 'code', 'competence', 'message', 'Informe a data inicial.');
      end if;
      if v_start is not null and v_end is not null and v_end < v_start then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'end_date', 'code', 'competence',
          'message', format('A data final (%s) é anterior à inicial (%s).', to_char(v_end, 'DD/MM/YYYY'), to_char(v_start, 'DD/MM/YYYY')));
      end if;
      v_hist := v_end is not null and v_end < current_date;

      -- Situação do vínculo: o passado é fato; o resto nasce planejado.
      v_st_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
      v_st := case private.import_text_key(v_st_raw)
                when 'planejado' then 'planned' when 'planned' then 'planned'
                when 'confirmado' then 'confirmed' when 'confirmed' then 'confirmed'
                when 'executado' then 'executed' when 'executed' then 'executed'
                else null end;
      if v_st_raw is null then
        v_st := case when v_hist then 'executed' else 'planned' end;
      elsif v_st is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'status',
          'message', format('Situação inválida: %s (use Planejado, Confirmado ou Executado).', v_st_raw));
      elsif v_st = 'executed' and v_start is not null and v_start > current_date then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'status',
          'message', 'Um vínculo que ainda não começou não pode entrar como executado.');
      end if;

      -- BR: resolução inequívoca (§57). Operação e cidade, quando vierem, restringem.
      if v_code is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'br_code', 'code', 'unknown_br', 'message', 'Informe o código da BR.');
      else
        if nullif(btrim(coalesce(r ->> 'operation', '')), '') is not null then
          v_op := private.import_find_operation(p_organization_id, r ->> 'operation');
          if v_op.id is null then
            v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'operation', 'code', 'unknown_br',
              'message', format('Operação não encontrada: %s.', btrim(r ->> 'operation')));
          end if;
        end if;
        if not exists (select 1 from jsonb_array_elements(v_issues) x where x ->> 'code' = 'unknown_br') then
          select count(*) into v_n
            from public.operation_brs b
            join public.cities ci on ci.id = b.city_id
            join public.states s on s.id = b.state_id
           where b.organization_id = p_organization_id and b.deleted_at is null
             and private.normalize_code(b.code) = v_code
             and (v_op.id is null or b.operation_id = v_op.id)
             and (nullif(btrim(coalesce(r ->> 'city', '')), '') is null
                  or private.import_text_key(ci.name) = private.import_text_key(r ->> 'city'))
             and (nullif(btrim(coalesce(r ->> 'state', '')), '') is null or upper(btrim(s.uf::text)) = upper(btrim(r ->> 'state')));
          if v_n = 0 then
            v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'br_code', 'code', 'unknown_br',
              'message', format('BR não encontrada: %s%s.', v_code,
                case when v_op.id is not null then ' em ' || v_op.name else '' end));
          elsif v_n > 1 then
            v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'br_code', 'code', 'unknown_br',
              'message', format('O código %s corresponde a %s BRs; informe operação e cidade.', v_code, v_n));
          else
            select b.* into v_br
              from public.operation_brs b
              join public.cities ci on ci.id = b.city_id
              join public.states s on s.id = b.state_id
             where b.organization_id = p_organization_id and b.deleted_at is null
               and private.normalize_code(b.code) = v_code
               and (v_op.id is null or b.operation_id = v_op.id)
               and (nullif(btrim(coalesce(r ->> 'city', '')), '') is null
                    or private.import_text_key(ci.name) = private.import_text_key(r ->> 'city'))
               and (nullif(btrim(coalesce(r ->> 'state', '')), '') is null or upper(btrim(s.uf::text)) = upper(btrim(r ->> 'state')));
            if not private.can_access_operation(v_br.operation_id) then
              v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'br_code', 'code', 'scope',
                'message', format('A BR %s pertence a uma operação fora do seu escopo de acesso.', v_br.code));
              v_br := null;
            elsif v_br.status <> 'active' then
              if v_hist then
                v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', 'br_code', 'code', 'br_inactive',
                  'message', format('A BR %s está inativa; o período já encerrado entra como histórico.', v_br.code));
              else
                v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'br_code', 'code', 'br_inactive',
                  'message', format('A BR %s está inativa e não recebe novo planejamento.', v_br.code));
              end if;
            end if;
          end if;
        end if;
      end if;

      -- Veículo: frota ou placa, nunca criado (§57).
      if nullif(btrim(coalesce(r ->> 'fleet_code', '')), '') is null and private.normalize_plate(r ->> 'license_plate') is null then
        v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle', 'code', 'vehicle_not_found', 'message', 'Informe a frota ou a placa do veículo.');
      else
        select count(*) into v_n from public.vehicles v
         where v.organization_id = p_organization_id and v.deleted_at is null
           and ((nullif(btrim(coalesce(r ->> 'fleet_code', '')), '') is not null and upper(btrim(v.fleet_code)) = upper(btrim(r ->> 'fleet_code')))
             or (private.normalize_plate(r ->> 'license_plate') is not null and private.normalize_plate(v.license_plate) = private.normalize_plate(r ->> 'license_plate')));
        if v_n = 0 then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle', 'code', 'vehicle_not_found',
            'message', format('Veículo não encontrado: %s. A importação não cria veículos.',
              coalesce(nullif(btrim(coalesce(r ->> 'fleet_code', '')), ''), private.normalize_plate(r ->> 'license_plate'))));
        elsif v_n > 1 then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle', 'code', 'vehicle_not_found',
            'message', format('Frota e placa apontam para veículos diferentes: %s / %s.', btrim(r ->> 'fleet_code'), private.normalize_plate(r ->> 'license_plate')));
        else
          select v.id, v.fleet_code, v.license_plate into v_veh_id, v_veh_fleet, v_veh_plate from public.vehicles v
           where v.organization_id = p_organization_id and v.deleted_at is null
             and ((nullif(btrim(coalesce(r ->> 'fleet_code', '')), '') is not null and upper(btrim(v.fleet_code)) = upper(btrim(r ->> 'fleet_code')))
               or (private.normalize_plate(r ->> 'license_plate') is not null and private.normalize_plate(v.license_plate) = private.normalize_plate(r ->> 'license_plate')));
          if v_br.id is not null then
            begin
              perform private.assert_vehicle_fidelizable(p_organization_id, v_veh_id, v_br.operation_id, v_end);
            exception when others then
              v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle', 'code', 'vehicle_ineligible', 'message', sqlerrm);
            end;
          end if;
        end if;
      end if;

      -- Classificação (§58), só quando BR, veículo e período estão resolvidos.
      if v_br.id is not null and v_veh_id is not null and v_start is not null
         and not exists (select 1 from jsonb_array_elements(v_issues) x where x ->> 'level' = 'error') then

        -- Sobreposição dentro do próprio arquivo.
        -- Só as linhas que serão gravadas contam: uma linha "existente" ou
        -- com erro não ocupa a BR nem o veículo.
        select ir.row_number into v_n from public.import_rows ir
         where ir.batch_id = v_batch and ir.status <> 'error' and ir.action in ('create', 'substitute')
           and ((ir.normalized_data ->> 'br_id')::uuid = v_br.id and v_role = 'primary' and ir.normalized_data ->> 'vehicle_role' = 'primary'
                or ir.vehicle_id = v_veh_id)
           and daterange((ir.normalized_data ->> 'start_date')::date, nullif(ir.normalized_data ->> 'end_date', '')::date, '[]')
               && daterange(v_start, v_end, '[]')
         limit 1;
        if v_n is not null then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'overlap',
            'message', format('Sobreposição dentro do arquivo com a linha %s.', v_n));
        end if;

        -- O veículo ocupado em OUTRA BR no período (§31).
        select a.id, b.code as br_code, a.start_date, a.end_date into v_busy
          from public.fidelization_assignments a join public.operation_brs b on b.id = a.operation_br_id
         where a.organization_id = p_organization_id and a.vehicle_id = v_veh_id and a.status <> 'cancelled'
           and a.operation_br_id <> v_br.id
           and daterange(a.start_date, a.end_date, '[]') && daterange(v_start, v_end, '[]')
         order by a.start_date limit 1;
        if v_busy.id is not null then
          v_issues := v_issues || jsonb_build_object('level', 'error', 'field', 'vehicle', 'code', 'overlap',
            'message', format('O veículo já está vinculado à BR %s de %s a %s.', v_busy.br_code,
              to_char(v_busy.start_date, 'DD/MM/YYYY'), coalesce(to_char(v_busy.end_date, 'DD/MM/YYYY'), 'em aberto')));
        end if;

        -- Ocupação da BR (titular): existente, substituição ou sobreposição.
        -- A base real planeja por competência (vínculos que terminam no fim do
        -- mês), então "substituir" é: a BR tem um titular que cobre a data
        -- inicial do arquivo, começou antes dela, e é outro veículo. O novo
        -- vínculo herda o fim do atual quando o arquivo não informa fim.
        if v_role = 'primary' then
          select a.*, coalesce(v.fleet_code, v.license_plate) as vehicle_label into v_ex
            from public.fidelization_assignments a join public.vehicles v on v.id = a.vehicle_id
           where a.operation_br_id = v_br.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
             and a.start_date <= v_start and (a.end_date is null or a.end_date >= v_start)
           limit 1;
          if v_ex.id is not null then
            if v_ex.vehicle_id = v_veh_id and v_ex.start_date = v_start and v_ex.end_date is not distinct from v_end then
              v_action := 'skip';
              v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', null, 'code', 'existing',
                'message', 'Vínculo já existente no HFM; nada a fazer.');
            elsif v_ex.vehicle_id = v_veh_id then
              v_action := 'skip';
              v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', null, 'code', 'existing',
                'message', format('O veículo já está vinculado a esta BR de %s a %s; o período do arquivo não altera um vínculo existente.',
                  to_char(v_ex.start_date, 'DD/MM/YYYY'), coalesce(to_char(v_ex.end_date, 'DD/MM/YYYY'), 'em aberto')));
            elsif v_ex.start_date < v_start then
              select count(*) into v_n from public.fidelization_assignments a
               where a.operation_br_id = v_br.id and a.vehicle_role = 'primary' and a.status <> 'cancelled' and a.id <> v_ex.id
                 and daterange(a.start_date, a.end_date, '[]') && daterange(v_start, coalesce(v_end, v_ex.end_date), '[]');
              if v_n > 0 then
                v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'overlap',
                  'message', format('Sobreposição: além do vínculo atual (%s), o período cruza %s outro(s) vínculo(s) desta BR.', v_ex.vehicle_label, v_n));
              elsif v_can_sub then
                v_action := 'substitute'; v_replaces := v_ex.id; v_prev_veh := v_ex.vehicle_label;
                -- O novo vínculo herda o fim do atual: é esse período que ocupa a BR e o veículo.
                v_end := coalesce(v_end, v_ex.end_date);
                v_issues := v_issues || jsonb_build_object('level', 'warning', 'field', null, 'code', 'substitution',
                  'message', format('Substituirá %s a partir de %s; o vínculo atual será encerrado em %s%s.',
                    v_ex.vehicle_label, to_char(v_start, 'DD/MM/YYYY'), to_char(v_start - 1, 'DD/MM/YYYY'),
                    case when nullif(r ->> 'end_date', '') is null and v_ex.end_date is not null
                         then ' e o novo vínculo herda o fim em ' || to_char(v_ex.end_date, 'DD/MM/YYYY') else '' end));
              else
                v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'permission',
                  'message', format('Esta linha substituiria %s e você não possui permissão para substituir veículos.', v_ex.vehicle_label));
              end if;
            else
              v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'overlap',
                'message', format('Sobreposição: a BR já tem %s desde %s. Substituir a partir do mesmo dia apagaria o vínculo atual, e um vínculo histórico não é sobrescrito pela importação.',
                  v_ex.vehicle_label, to_char(v_ex.start_date, 'DD/MM/YYYY')));
            end if;
          else
            select count(*) into v_n from public.fidelization_assignments a
             where a.operation_br_id = v_br.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
               and daterange(a.start_date, a.end_date, '[]') && daterange(v_start, v_end, '[]');
            if v_n > 0 then
              select a.*, coalesce(v.fleet_code, v.license_plate) as vehicle_label into v_ex
                from public.fidelization_assignments a join public.vehicles v on v.id = a.vehicle_id
               where a.operation_br_id = v_br.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
                 and daterange(a.start_date, a.end_date, '[]') && daterange(v_start, v_end, '[]')
               order by a.start_date limit 1;
              v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'overlap',
                'message', format('Sobreposição: a BR tem %s de %s a %s dentro do período. Um vínculo existente não é sobrescrito pela importação.',
                  v_ex.vehicle_label, to_char(v_ex.start_date, 'DD/MM/YYYY'), coalesce(to_char(v_ex.end_date, 'DD/MM/YYYY'), 'em aberto')));
            end if;
          end if;
        end if;
      end if;
    exception when others then
      v_issues := v_issues || jsonb_build_object('level', 'error', 'field', null, 'code', 'unexpected', 'message', sqlerrm);
    end;

    v_status := case
      when exists (select 1 from jsonb_array_elements(v_issues) x where x ->> 'level' = 'error') then 'error'
      when jsonb_array_length(v_issues) > 0 then 'warning'
      else 'valid' end;
    if v_status = 'error' then v_action := 'skip'; end if;

    v_norm := jsonb_build_object(
      'br_id', v_br.id, 'br_code', coalesce(v_br.code, v_code),
      'operation_id', v_br.operation_id,
      'operation_name', (select o.name from public.operations o where o.id = v_br.operation_id),
      'city_name', (select ci.name from public.cities ci where ci.id = v_br.city_id),
      'state_uf', (select s.uf::text from public.states s where s.id = v_br.state_id),
      'vehicle_id', v_veh_id, 'fleet_code', coalesce(v_veh_fleet, nullif(btrim(coalesce(r ->> 'fleet_code', '')), '')),
      'license_plate', coalesce(v_veh_plate, private.normalize_plate(r ->> 'license_plate')),
      'start_date', v_start, 'end_date', v_end, 'vehicle_role', v_role, 'status', v_st, 'status_raw', v_st_raw,
      'reason', v_reason, 'replaces_assignment_id', v_replaces, 'previous_vehicle', v_prev_veh);

    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action, vehicle_id)
    values (p_organization_id, v_batch, v_row_no, coalesce(r -> 'raw', '{}'::jsonb), v_norm, v_status, v_action, v_veh_id);

    for i in select * from jsonb_array_elements(v_issues) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, v_batch, v_row_no, i ->> 'level', i ->> 'field', i ->> 'code', i ->> 'message');
    end loop;

    if v_status = 'valid' then n_valid := n_valid + 1;
    elsif v_status = 'warning' then n_warn := n_warn + 1;
    else n_err := n_err + 1; end if;
    if v_status <> 'error' then
      if v_action = 'create' then n_create := n_create + 1;
      elsif v_action = 'substitute' then n_sub := n_sub + 1;
      else n_skip := n_skip + 1; end if;
    end if;
  end loop;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         summary = jsonb_build_object('create', n_create, 'substitute', n_sub, 'skip', n_skip),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'already_imported', v_already,
    'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
    'create_rows', n_create, 'substitute_rows', n_sub, 'skip_rows', n_skip,
    -- §58: as sete categorias da prévia, contadas por linha.
    'categories', jsonb_build_object(
      'existing',           (select count(distinct row_number) from public.import_errors where batch_id = v_batch and code = 'existing'),
      'new',                n_create,
      'substitutions',      n_sub,
      'overlaps',           (select count(distinct row_number) from public.import_errors where batch_id = v_batch and code = 'overlap'),
      'unknown_brs',        (select count(distinct row_number) from public.import_errors where batch_id = v_batch and code in ('unknown_br', 'scope', 'br_inactive') and level = 'error'),
      'vehicles_not_found', (select count(distinct row_number) from public.import_errors where batch_id = v_batch and code in ('vehicle_not_found', 'vehicle_ineligible')),
      'competence_errors',  (select count(distinct row_number) from public.import_errors where batch_id = v_batch and code = 'competence')),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field, 'code', e.code, 'message', e.message)
                                  order by (e.level = 'error') desc, e.row_number)
                            from (select * from public.import_errors where batch_id = v_batch order by (level = 'error') desc, row_number limit 300) e), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', x.row_number, 'status', x.status, 'action', x.action, 'data', x.normalized_data) order by x.row_number)
                          from (select * from public.import_rows where batch_id = v_batch order by row_number limit 12) x), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- §57 · process_fidelization_import — grava o que a prévia prometeu
-- -----------------------------------------------------------------------------
create or replace function public.process_fidelization_import(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_br    public.operation_brs;
  x       record;
  v_new   uuid;
  v_res   jsonb;
  v_why   text;
  n_created integer := 0; n_sub integer := 0; n_skipped integer := 0;
begin
  if not private.has_permission(p_organization_id, 'fidelization.import') then
    raise exception 'Você não possui permissão para importar alocações.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_batch from public.import_batches
   where id = p_batch_id and organization_id = p_organization_id and type = 'fidelization' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status <> 'validated' then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
  loop
    begin
      v_why := coalesce(x.d ->> 'reason', 'Importação: ' || v_batch.file_name);
      if x.action = 'create' then
        -- As mesmas travas da gravação manual, com a permissão de importar.
        v_br := private.lock_br((x.d ->> 'br_id')::uuid, 'fidelization.import');
        if v_br.organization_id <> p_organization_id then
          raise exception 'Esta BR não pertence a esta organização.' using errcode = 'insufficient_privilege';
        end if;
        perform private.assert_vehicle_fidelizable(p_organization_id, (x.d ->> 'vehicle_id')::uuid, v_br.operation_id,
                                                   nullif(x.d ->> 'end_date', '')::date);
        insert into public.fidelization_assignments
          (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
        values
          (p_organization_id, v_br.id, (x.d ->> 'vehicle_id')::uuid, x.d ->> 'vehicle_role',
           (x.d ->> 'start_date')::date, nullif(x.d ->> 'end_date', '')::date, x.d ->> 'status', 'import', v_why)
        returning id into v_new;
        update public.import_rows set status = 'created' where id = x.id;
        n_created := n_created + 1;
      elsif x.action = 'substitute' then
        -- A rotina oficial encerra o anterior e cria o novo na mesma transação (§33).
        v_res := public.substitute_fidelization_vehicle((x.d ->> 'replaces_assignment_id')::uuid,
                   (x.d ->> 'vehicle_id')::uuid, (x.d ->> 'start_date')::date, v_why);
        v_new := (v_res ->> 'new_id')::uuid;
        update public.fidelization_assignments
           set end_date = coalesce(nullif(x.d ->> 'end_date', '')::date, end_date),
               status   = coalesce(x.d ->> 'status', status)
         where id = v_new;
        update public.import_rows set status = 'created' where id = x.id;
        n_sub := n_sub + 1;
      else
        update public.import_rows set status = 'skipped' where id = x.id;
        n_skipped := n_skipped + 1;
      end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
      n_skipped := n_skipped + 1;
    end;
  end loop;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created + n_sub,
         skipped_rows = (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('created', n_created, 'substituted', n_sub),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;

  return jsonb_build_object('created', n_created, 'substituted', n_sub,
    'skipped', (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')));
end;
$$;

-- -----------------------------------------------------------------------------
-- Situação do vínculo: planejado → confirmado → executado; cancelamento
-- -----------------------------------------------------------------------------
create or replace function public.set_fidelization_assignment_status(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_to     text := nullif(btrim(coalesce(p_payload ->> 'status', '')), '');
  v_why    text := left(nullif(btrim(coalesce(p_payload ->> 'reason', '')), ''), 500);
  v_row    public.fidelization_assignments;
begin
  if v_id is null then
    raise exception 'Informe o vínculo.' using errcode = 'invalid_parameter_value';
  end if;
  if v_to not in ('confirmed', 'executed', 'cancelled') then
    raise exception 'Situação inválida para um vínculo: %.', coalesce(v_to, '(vazia)') using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.fidelization_assignments
   where id = v_id and organization_id = p_organization_id for update;
  if v_row.id is null then
    raise exception 'Vínculo de fidelização não encontrado.' using errcode = 'no_data_found';
  end if;

  perform private.lock_br(v_row.operation_br_id, 'fidelization.plan');

  if v_row.status = v_to then
    return jsonb_build_object('id', v_id, 'status', v_row.status, 'changed', false);
  end if;
  if v_row.status in ('executed', 'cancelled') then
    raise exception 'Um vínculo % não muda mais de situação.',
      case v_row.status when 'executed' then 'executado' else 'cancelado' end
      using errcode = 'invalid_parameter_value';
  end if;

  if v_to = 'executed' and v_row.start_date > current_date then
    raise exception 'O vínculo só pode ser marcado como executado depois de % (início do período).',
      to_char(v_row.start_date, 'DD/MM/YYYY') using errcode = 'invalid_parameter_value';
  end if;

  if v_to = 'cancelled' then
    if v_why is null then
      raise exception 'Informe o motivo do cancelamento.' using errcode = 'invalid_parameter_value';
    end if;
    -- Motoristas primeiro: o gatilho recusa cancelar um vínculo com motorista aberto.
    perform private.close_assignment_drivers(v_id, null, v_why);
    update public.fidelization_assignments
       set status = 'cancelled', end_reason = v_why
     where id = v_id;
  else
    update public.fidelization_assignments
       set status = v_to,
           reason = case when v_why is not null then v_why else reason end
     where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'status', v_to, 'changed', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Exportação auditada (§61 da Etapa 08; permissão fidelization.export)
--
-- Defeito pré-existente corrigido de passagem: `audit_logs.action` só aceitava
-- INSERT, UPDATE e DELETE, e `log_vehicle_export` / `log_user_export` gravam
-- 'EXPORT'. As rotas de exportação ignoram o erro da rotina, então frotas e
-- usuários eram exportados SEM registro na auditoria desde a Etapa 03 — zero
-- linhas de exportação no banco de desenvolvimento. A lista passa a aceitar
-- EXPORT; nenhuma linha existente é afetada.
-- -----------------------------------------------------------------------------
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check check (action in ('INSERT', 'UPDATE', 'DELETE', 'EXPORT'));

create or replace function public.log_fidelization_export(
  p_organization_id uuid, p_format text, p_row_count integer, p_kind text default 'planner')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_organization_id, 'fidelization.export') then
    raise exception 'Você não possui permissão para exportar a fidelização.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_logs
    (organization_id, user_id, entity_type, entity_id, action, new_data)
  values
    (p_organization_id, (select auth.uid()), 'fidelization_export', null, 'EXPORT',
     jsonb_build_object('format', p_format, 'row_count', p_row_count, 'kind', coalesce(p_kind, 'planner')));
end;
$$;

revoke all on function public.stage_br_import(uuid, jsonb) from public;
revoke all on function public.process_br_import(uuid, uuid) from public;
revoke all on function public.stage_fidelization_import(uuid, jsonb) from public;
revoke all on function public.process_fidelization_import(uuid, uuid) from public;
revoke all on function public.set_fidelization_assignment_status(uuid, jsonb) from public;
revoke all on function public.log_fidelization_export(uuid, text, integer, text) from public;
grant execute on function public.stage_br_import(uuid, jsonb) to authenticated;
grant execute on function public.process_br_import(uuid, uuid) to authenticated;
grant execute on function public.stage_fidelization_import(uuid, jsonb) to authenticated;
grant execute on function public.process_fidelization_import(uuid, uuid) to authenticated;
grant execute on function public.set_fidelization_assignment_status(uuid, jsonb) to authenticated;
grant execute on function public.log_fidelization_export(uuid, text, integer, text) to authenticated;

comment on function public.stage_br_import(uuid, jsonb) is
  'Etapa 13 §56: valida um arquivo de BRs (operação, estado, cidade, código, descrição, situação, observações) e devolve a prévia. Exige fidelization.import e fidelization.manage_brs.';
comment on function public.process_br_import(uuid, uuid) is
  'Etapa 13 §56: cria e atualiza BRs de um lote validado pelas rotinas oficiais (save_operation_br). Nunca altera a situação de uma BR existente.';
comment on function public.stage_fidelization_import(uuid, jsonb) is
  'Etapa 13 §57/§58: valida o planejamento de veículos por BR e classifica cada linha: existente, novo, substituição, sobreposição, BR desconhecida, veículo não encontrado, erro de competência. Nunca cria veículo, BR ou colaborador.';
comment on function public.process_fidelization_import(uuid, uuid) is
  'Etapa 13 §57: grava os vínculos novos (source=import) e executa as substituições pela rotina oficial. Sobreposições ficam de fora.';
comment on function public.set_fidelization_assignment_status(uuid, jsonb) is
  'Situação do vínculo: planejado/confirmado → confirmado, executado (período iniciado) ou cancelado (motivo obrigatório; motoristas encerrados). Executado e cancelado são terminais.';
comment on function public.log_fidelization_export(uuid, text, integer, text) is
  'Registra uma exportação da fidelização (planner ou histórico) na auditoria. Exige fidelization.export.';
