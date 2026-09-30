-- =============================================================================
-- Manutenção — importação: o lote certo e os layouts das bases reais
--
-- 1. Correção: as partes de validação e a prévia chegam sem "kind"; o banco
--    assumia "records" e procurava o lote como tipo `maintenance`. Os lotes de
--    cadastro (clusters, serviços, fornecedores, parâmetros) são
--    `maintenance_catalog`, não eram achados, e a tela dizia "Esta importação
--    não está mais aberta. Envie a planilha novamente.". O tipo e a base agora
--    vêm do próprio lote.
--
-- 2. Os layouts das planilhas de cadastro e da base de manutenções que a
--    operação usa (06 Clusters, 07 Fornecedores, 08 Parâmetros, 09 Serviços,
--    10 Manutenções):
--      * fornecedor ganha código externo (Cod Rodopar), categoria, tipo,
--        modelo de pagamento, validação financeira e "outros nomes" (de-para);
--      * serviço ganha "outros nomes" (nomes antigos que a base ainda usa);
--      * a base de manutenções reconhece fornecedor pelo nome, nome fantasia,
--        outros nomes, CNPJ ou pela forma canônica do nome (sem "Ltda", "S/A",
--        pontuação) — só quando o reconhecimento é único; fornecedor não
--        reconhecido não bloqueia a linha: a manutenção entra sem vínculo e
--        guarda o nome informado (`supplier_name_informed`);
--      * serviço é reconhecido pelo nome ou outro nome; se o cluster da linha
--        diverge do cadastro e o nome é único, vale o cadastro (aviso);
--      * a mesma entrada em oficina = veículo + tipo + data + OS + fornecedor
--        informado; linhas da mesma entrada com situações diferentes deixam a
--        manutenção na situação menos avançada e cada serviço com a sua; a
--        saída é a última do grupo;
--      * datas de entrada/saída só são exigidas e checadas quando a situação
--        é de fato (Em execução, Concluído); KM com casas decimais é lido
--        como número;
--      * parâmetros preventivos aceitam subcategoria no lugar do tipo ("Toco",
--        "Truck") e no lugar do modelo ("10,5 m³"), "—" como vazio, e trazem
--        criticidade e situação;
--      * reimportar um cadastro não apaga o que o arquivo não traz.
--
-- Nada aqui cria veículo, operação, serviço ou fornecedor a partir da base de
-- manutenções, nem toca em Perfis & Permissões. Colunas só são acrescentadas.
-- As rotinas de carga e gravação (stage/process) estão em
-- 20261001100100_maintenance_import_routines.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas (aditivas)
-- -----------------------------------------------------------------------------
alter table public.maintenance_suppliers
  add column if not exists external_code        text,
  add column if not exists category             text,
  add column if not exists service_type         text,
  add column if not exists payment_terms        text,
  add column if not exists financial_validation text,
  add column if not exists alias_names          text[] not null default '{}';

comment on column public.maintenance_suppliers.external_code is 'Código do parceiro no sistema de origem (ex.: Cod Rodopar). Informativo; não identifica o fornecedor sozinho.';
comment on column public.maintenance_suppliers.category is 'Categoria do parceiro comercial (Mecânica, Funilaria, Peças e Acessórios…).';
comment on column public.maintenance_suppliers.service_type is 'Tipo de serviço prestado (Revisões Preventivas e Corretivas, Lava Jato…).';
comment on column public.maintenance_suppliers.payment_terms is 'Modelo de pagamento (30 Dias, 15 Dias, vencimento…).';
comment on column public.maintenance_suppliers.financial_validation is 'Validação do financeiro (ex.: OK).';
comment on column public.maintenance_suppliers.alias_names is 'Outros nomes pelos quais o fornecedor aparece nas planilhas (de-para da importação).';

alter table public.maintenance_services
  add column if not exists alias_names text[] not null default '{}';
comment on column public.maintenance_services.alias_names is 'Outros nomes pelos quais o serviço aparece nas planilhas (de-para da importação).';

alter table public.maintenances
  add column if not exists supplier_name_informed text;
comment on column public.maintenances.supplier_name_informed is 'Fornecedor informado na importação que não foi reconhecido no catálogo. Some quando o vínculo é feito.';

-- -----------------------------------------------------------------------------
-- 2. Leitura de valores e reconhecimento de nomes
-- -----------------------------------------------------------------------------
-- Número como a planilha escreve: 148398.88, 61.067,60, 10,5, "10 km".
create or replace function private.maintenance_import_number(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(btrim(coalesce(p_value, '')), '[^0-9,.\-]', '', 'g');
begin
  if v = '' then
    return null;
  end if;
  if v ~ '^-?\d{1,3}(\.\d{3})+(,\d+)?$' then
    v := replace(replace(v, '.', ''), ',', '.');
  elsif v ~ '^-?\d{1,3}(,\d{3})+(\.\d+)?$' then
    v := replace(v, ',', '');
  elsif v ~ ',' then
    v := replace(v, ',', '.');
  end if;
  return v::numeric;
exception when others then
  return null;
end;
$$;

create or replace function private.maintenance_import_criticality(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case private.maintenance_norm(p_value)
           when 'baixa' then 'low' when 'low' then 'low'
           when 'media' then 'medium' when 'medium' then 'medium'
           when 'alta' then 'high' when 'high' then 'high'
           when 'critica' then 'critical' when 'critical' then 'critical' end;
$$;

create or replace function private.maintenance_import_active(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case private.maintenance_norm(p_value)
           when 'ativo' then 'active' when 'ativa' then 'active' when 'active' then 'active' when 'sim' then 'active'
           when 'inativo' then 'inactive' when 'inativa' then 'inactive' when 'inactive' then 'inactive' when 'nao' then 'inactive' end;
$$;

-- "—", "-" e vazio são "não informado".
create or replace function private.maintenance_import_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p_value, '')) in ('', '-', '—', '–', '--') then null else btrim(p_value) end;
$$;

-- Forma canônica de um nome de empresa: sem acento, caixa, pontuação e sufixo
-- societário. "Mecânica Cristo Rei" = "Mecanica Cristo Rei Ltda";
-- "LL Baterias & Auto Eletrica" = "Ll Baterias E Auto-Eletrica Ltda".
create or replace function private.maintenance_canonical(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
           coalesce(private.maintenance_norm(replace(coalesce(p_value, ''), '&', ' e ')), ''),
           '[^a-z0-9]+', ' ', 'g'),
           '\m(ltda|sa|s a|eireli|epp|me|mei|cia|limitada)\M', ' ', 'g'),
           '\s+', ' ', 'g')), '');
$$;

-- Lista de nomes: texto separado por ";" ou quebra de linha, ou array JSON.
-- Vírgula não separa: há nomes com vírgula ("Serginho Farois, Retrovisores…").
create or replace function private.maintenance_clean_names(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(q.n order by q.n), '{}')
    from (select distinct on (private.maintenance_norm(x)) btrim(x) as n
            from jsonb_array_elements_text(case jsonb_typeof(p_value)
                                             when 'array' then p_value
                                             when 'string' then to_jsonb(regexp_split_to_array(p_value #>> '{}', '\s*[;\n]\s*'))
                                             else '[]'::jsonb end) x
           where private.maintenance_norm(x) is not null
           order by private.maintenance_norm(x), x) q;
$$;

-- Fornecedor pelo texto da planilha. Devolve um id só quando o reconhecimento é
-- único: nome, nome fantasia ou outro nome (exatos, sem acento e caixa) →
-- CNPJ/CPF → forma canônica → a parte antes de "|" ("Fabio Alves Prates | SKY
-- Tracker"). Ambíguo = não reconhecido.
create or replace function private.maintenance_match_supplier(p_organization_id uuid, p_text text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_norm  text := private.maintenance_norm(p_text);
  v_canon text;
  v_doc   text;
  v_ids   uuid[];
begin
  if v_norm is null then
    return null;
  end if;

  select array_agg(distinct s.id) into v_ids
    from public.maintenance_suppliers s
   where s.organization_id = p_organization_id and s.deleted_at is null
     and (private.maintenance_norm(s.name) = v_norm
          or private.maintenance_norm(s.trade_name) = v_norm
          or exists (select 1 from unnest(s.alias_names) a where private.maintenance_norm(a) = v_norm));
  if cardinality(v_ids) = 1 then
    return v_ids[1];
  elsif cardinality(v_ids) > 1 then
    return null;
  end if;

  v_doc := regexp_replace(p_text, '[^0-9]', '', 'g');
  if length(v_doc) in (11, 14) then
    select array_agg(s.id) into v_ids
      from public.maintenance_suppliers s
     where s.organization_id = p_organization_id and s.deleted_at is null and s.document_number = v_doc;
    if cardinality(v_ids) = 1 then
      return v_ids[1];
    end if;
  end if;

  v_canon := private.maintenance_canonical(p_text);
  if v_canon is not null then
    select array_agg(distinct s.id) into v_ids
      from public.maintenance_suppliers s
     where s.organization_id = p_organization_id and s.deleted_at is null
       and (private.maintenance_canonical(s.name) = v_canon
            or private.maintenance_canonical(s.trade_name) = v_canon
            or exists (select 1 from unnest(s.alias_names) a where private.maintenance_canonical(a) = v_canon));
    if cardinality(v_ids) = 1 then
      return v_ids[1];
    elsif cardinality(v_ids) > 1 then
      return null;
    end if;
  end if;

  if position('|' in p_text) > 1 then
    return private.maintenance_match_supplier(p_organization_id, split_part(p_text, '|', 1));
  end if;
  return null;
end;
$$;

-- Serviço pelo texto da planilha: nome ou outro nome, no cluster informado; se
-- não houver no cluster e o nome for único no catálogo, vale o cadastro e
-- o_cluster_mismatch avisa.
create or replace function private.maintenance_match_service(
  p_organization_id uuid, p_service text, p_cluster text,
  out o_service_id uuid, out o_cluster_id uuid, out o_cluster_mismatch boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_norm text := private.maintenance_norm(p_service);
  v_cl   text := private.maintenance_norm(p_cluster);
  v_ids  uuid[];
begin
  o_cluster_mismatch := false;
  if v_norm is null then
    return;
  end if;

  if v_cl is not null then
    select s.id, s.cluster_id into o_service_id, o_cluster_id
      from public.maintenance_services s
      join public.maintenance_clusters c on c.id = s.cluster_id
     where s.organization_id = p_organization_id and s.deleted_at is null
       and (private.maintenance_norm(s.name) = v_norm
            or exists (select 1 from unnest(s.alias_names) a where private.maintenance_norm(a) = v_norm))
       and (private.maintenance_norm(c.name) = v_cl or c.code = upper(btrim(p_cluster)))
     order by (private.maintenance_norm(s.name) = v_norm) desc, (s.status = 'active') desc
     limit 1;
    if o_service_id is not null then
      return;
    end if;
  end if;

  select array_agg(s.id) into v_ids
    from public.maintenance_services s
   where s.organization_id = p_organization_id and s.deleted_at is null
     and (private.maintenance_norm(s.name) = v_norm
          or exists (select 1 from unnest(s.alias_names) a where private.maintenance_norm(a) = v_norm));
  if cardinality(v_ids) = 1 then
    o_service_id := v_ids[1];
    select s.cluster_id into o_cluster_id from public.maintenance_services s where s.id = o_service_id;
    o_cluster_mismatch := v_cl is not null;
  end if;
end;
$$;

-- Reimportar um cadastro atualiza o que o arquivo traz e mantém o resto (antes,
-- uma coluna ausente apagava descrição, tipos de equipamento, clusters
-- atendidos…). Outros nomes somam; o código do cluster não muda.
create or replace function private.maintenance_import_merge(p_kind text, p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base  jsonb;
  v_alias jsonb;
begin
  v_base := case p_kind
              when 'clusters' then (select to_jsonb(c) from public.maintenance_clusters c where c.id = p_id)
              when 'services' then (select to_jsonb(s) from public.maintenance_services s where s.id = p_id)
              when 'suppliers' then (select to_jsonb(s) from public.maintenance_suppliers s where s.id = p_id)
              when 'preventive_rules' then (select to_jsonb(r) from public.maintenance_preventive_rules r where r.id = p_id)
            end;
  if v_base is null then
    return p_payload;
  end if;
  v_base := v_base - 'organization_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' - 'deleted_at' - 'deleted_by';
  if p_kind = 'clusters' then
    return v_base || (jsonb_strip_nulls(p_payload) - 'code');
  end if;
  if p_kind in ('services', 'suppliers') then
    select coalesce(to_jsonb(private.maintenance_clean_names(coalesce(v_base -> 'alias_names', '[]') || coalesce(p_payload -> 'alias_names', '[]'))), '[]')
      into v_alias;
    return v_base || jsonb_strip_nulls(p_payload) || jsonb_build_object('alias_names', v_alias);
  end if;
  return v_base || jsonb_strip_nulls(p_payload);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Cadastros — os campos novos
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_save_supplier(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name     text := btrim(coalesce(p_payload ->> 'name', ''));
  v_doc      text := nullif(regexp_replace(coalesce(p_payload ->> 'document_number', ''), '[^0-9]', '', 'g'), '');
  v_state    smallint := nullif(p_payload ->> 'state_id', '')::smallint;
  v_city     integer := nullif(p_payload ->> 'city_id', '')::integer;
  v_clusters uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'cluster_ids'), '{}');
  v_services uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'service_ids'), '{}');
  v_cities   integer[] := coalesce(private.jsonb_int_array(p_payload -> 'served_city_ids'), '{}');
  v_aliases  text[] := private.maintenance_clean_names(p_payload -> 'alias_names');
  v_clash    text;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_suppliers');
  if length(v_name) < 2 then
    raise exception 'Informe o nome do fornecedor.' using errcode = 'invalid_parameter_value';
  end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then
    raise exception 'CNPJ/CPF inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is not null and not exists (select 1 from public.cities c where c.id = v_city and (v_state is null or c.state_id = v_state)) then
    raise exception 'Cidade não pertence ao estado informado.' using errcode = 'invalid_parameter_value';
  end if;
  if v_city is not null and v_state is null then
    select c.state_id into v_state from public.cities c where c.id = v_city;
  end if;
  if exists (select 1 from unnest(v_clusters) x
              where not exists (select 1 from public.maintenance_clusters c
                                 where c.id = x and c.organization_id = p_organization_id and c.deleted_at is null)) then
    raise exception 'Categoria atendida inválida (cluster).' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_services) x
              where not exists (select 1 from public.maintenance_services s
                                 where s.id = x and s.organization_id = p_organization_id and s.deleted_at is null)) then
    raise exception 'Serviço atendido inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_cities) x where not exists (select 1 from public.cities c where c.id = x)) then
    raise exception 'Local atendido inválido.' using errcode = 'invalid_parameter_value';
  end if;
  -- Um outro nome que já identifica outro fornecedor tornaria o de-para ambíguo.
  if p_payload ? 'alias_names' then
    select format('"%s" já identifica o fornecedor %s.', a, s.name) into v_clash
      from unnest(v_aliases) a
      join public.maintenance_suppliers s
        on s.organization_id = p_organization_id and s.deleted_at is null and s.id is distinct from v_id
       and (private.maintenance_norm(s.name) = private.maintenance_norm(a)
            or private.maintenance_norm(s.trade_name) = private.maintenance_norm(a)
            or exists (select 1 from unnest(s.alias_names) b where private.maintenance_norm(b) = private.maintenance_norm(a)))
     limit 1;
    if v_clash is not null then
      raise exception 'Outro nome em conflito: %', v_clash using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_id is not null then
    if not exists (select 1 from public.maintenance_suppliers
                    where id = v_id and organization_id = p_organization_id and deleted_at is null) then
      raise exception 'Fornecedor não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.maintenance_suppliers set
      name = v_name, trade_name = nullif(btrim(p_payload ->> 'trade_name'), ''), document_number = v_doc,
      address = nullif(btrim(p_payload ->> 'address'), ''), state_id = v_state, city_id = v_city,
      cluster_ids = v_clusters, service_ids = v_services, served_city_ids = v_cities,
      status = coalesce(nullif(p_payload ->> 'status', ''), status), notes = nullif(btrim(p_payload ->> 'notes'), ''),
      external_code = case when p_payload ? 'external_code' then nullif(btrim(p_payload ->> 'external_code'), '') else external_code end,
      category = case when p_payload ? 'category' then nullif(btrim(p_payload ->> 'category'), '') else category end,
      service_type = case when p_payload ? 'service_type' then nullif(btrim(p_payload ->> 'service_type'), '') else service_type end,
      payment_terms = case when p_payload ? 'payment_terms' then nullif(btrim(p_payload ->> 'payment_terms'), '') else payment_terms end,
      financial_validation = case when p_payload ? 'financial_validation' then nullif(btrim(p_payload ->> 'financial_validation'), '') else financial_validation end,
      alias_names = case when p_payload ? 'alias_names' then v_aliases else alias_names end
    where id = v_id;
    return v_id;
  end if;

  insert into public.maintenance_suppliers
    (organization_id, name, trade_name, document_number, address, state_id, city_id, cluster_ids, service_ids,
     served_city_ids, status, notes, external_code, category, service_type, payment_terms, financial_validation, alias_names)
  values
    (p_organization_id, v_name, nullif(btrim(p_payload ->> 'trade_name'), ''), v_doc,
     nullif(btrim(p_payload ->> 'address'), ''), v_state, v_city, v_clusters, v_services, v_cities,
     coalesce(nullif(p_payload ->> 'status', ''), 'active'), nullif(btrim(p_payload ->> 'notes'), ''),
     nullif(btrim(p_payload ->> 'external_code'), ''), nullif(btrim(p_payload ->> 'category'), ''),
     nullif(btrim(p_payload ->> 'service_type'), ''), nullif(btrim(p_payload ->> 'payment_terms'), ''),
     nullif(btrim(p_payload ->> 'financial_validation'), ''), v_aliases)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um fornecedor com este nome ou documento.' using errcode = 'unique_violation';
end;
$$;

create or replace function public.maintenance_save_service(p_organization_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
  v_cluster uuid := nullif(p_payload ->> 'cluster_id', '')::uuid;
  v_types   text[] := coalesce(private.jsonb_text_array(p_payload -> 'maintenance_type_codes'), '{}');
  v_vtypes  uuid[] := coalesce(private.jsonb_uuid_array(p_payload -> 'vehicle_type_ids'), '{}');
  v_status  text := coalesce(nullif(p_payload ->> 'status', ''), 'active');
  v_hours   numeric := nullif(p_payload ->> 'expected_hours', '')::numeric;
  v_aliases text[] := private.maintenance_clean_names(p_payload -> 'alias_names');
  v_clash   text;
begin
  perform private.maintenance_assert_permission(p_organization_id, 'maintenance.manage_services');
  if length(v_name) < 2 then
    raise exception 'Informe o nome do serviço.' using errcode = 'invalid_parameter_value';
  end if;
  if v_cluster is null or not exists (
       select 1 from public.maintenance_clusters c
        where c.id = v_cluster and c.organization_id = p_organization_id and c.deleted_at is null
          and (c.status = 'active' or v_status = 'inactive')) then
    raise exception 'Selecione um cluster técnico ativo: todo serviço pertence a um cluster.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_types) t where t not in (select code from public.maintenance_types)) then
    raise exception 'Tipo de manutenção inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_vtypes) t
              where not exists (select 1 from public.vehicle_types vt
                                 where vt.id = t and (vt.organization_id is null or vt.organization_id = p_organization_id)
                                   and vt.deleted_at is null)) then
    raise exception 'Tipo de equipamento inválido.' using errcode = 'invalid_parameter_value';
  end if;
  -- Um outro nome que já é o nome (ou outro nome) de outro serviço tornaria o
  -- de-para ambíguo.
  if p_payload ? 'alias_names' then
    select format('"%s" já identifica o serviço %s.', a, s.name) into v_clash
      from unnest(v_aliases) a
      join public.maintenance_services s
        on s.organization_id = p_organization_id and s.deleted_at is null and s.id is distinct from v_id
       and (private.maintenance_norm(s.name) = private.maintenance_norm(a)
            or exists (select 1 from unnest(s.alias_names) b where private.maintenance_norm(b) = private.maintenance_norm(a)))
     limit 1;
    if v_clash is not null then
      raise exception 'Outro nome em conflito: %', v_clash using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_id is not null then
    if not exists (select 1 from public.maintenance_services
                    where id = v_id and organization_id = p_organization_id and deleted_at is null) then
      raise exception 'Serviço não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.maintenance_services set
      cluster_id             = v_cluster,
      name                   = v_name,
      description            = nullif(btrim(p_payload ->> 'description'), ''),
      criticality            = coalesce(nullif(p_payload ->> 'criticality', ''), criticality),
      maintenance_type_codes = v_types,
      vehicle_type_ids       = v_vtypes,
      expected_hours         = v_hours,
      is_predictive          = coalesce((p_payload ->> 'is_predictive')::boolean, is_predictive),
      status                 = v_status,
      alias_names            = case when p_payload ? 'alias_names' then v_aliases else alias_names end
    where id = v_id;
    return v_id;
  end if;

  insert into public.maintenance_services
    (organization_id, cluster_id, name, description, criticality, maintenance_type_codes, vehicle_type_ids,
     expected_hours, is_predictive, status, alias_names)
  values
    (p_organization_id, v_cluster, v_name, nullif(btrim(p_payload ->> 'description'), ''),
     coalesce(nullif(p_payload ->> 'criticality', ''), 'medium'), v_types, v_vtypes, v_hours,
     coalesce((p_payload ->> 'is_predictive')::boolean, false), v_status, v_aliases)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe um serviço com este nome neste cluster.' using errcode = 'unique_violation';
end;
$$;

create or replace function public.maintenance_catalog(p_organization_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'types', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name, 'description', t.description)
                                        order by t.sort_order), '[]')
                from public.maintenance_types t where t.is_active),
    'origins', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', o.id, 'code', o.code, 'name', o.name, 'description', o.description, 'is_system', o.is_system,
                  'manual_selectable', o.manual_selectable, 'is_active', o.is_active, 'organization_id', o.organization_id)
                  order by o.sort_order, o.name), '[]')
                  from public.maintenance_origins o
                 where o.organization_id is null or o.organization_id = p_organization_id),
    'clusters', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', c.id, 'code', c.code, 'name', c.name, 'description', c.description,
                   'default_criticality', c.default_criticality, 'status', c.status, 'sort_order', c.sort_order,
                   'services', (select count(*) from public.maintenance_services s where s.cluster_id = c.id and s.deleted_at is null))
                   order by c.sort_order, c.name), '[]')
                   from public.maintenance_clusters c
                  where c.organization_id = p_organization_id and c.deleted_at is null),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'cluster_id', s.cluster_id, 'cluster_name', c.name, 'name', s.name,
                   'description', s.description, 'criticality', s.criticality,
                   'maintenance_type_codes', to_jsonb(s.maintenance_type_codes),
                   'vehicle_type_ids', to_jsonb(s.vehicle_type_ids), 'expected_hours', s.expected_hours,
                   'is_predictive', s.is_predictive, 'status', s.status, 'alias_names', to_jsonb(s.alias_names),
                   'checklist_links', (select coalesce(jsonb_agg(jsonb_build_object(
                                          'id', l.id, 'app_id', l.app_id, 'question_key', l.question_key,
                                          'field_key', l.field_key, 'action_key', l.action_key, 'auto_resolve', l.auto_resolve)
                                          order by l.question_key), '[]')
                                         from public.maintenance_checklist_service_links l
                                        where l.service_id = s.id and l.is_active))
                   order by c.name, s.name), '[]')
                   from public.maintenance_services s
                   join public.maintenance_clusters c on c.id = s.cluster_id
                  where s.organization_id = p_organization_id and s.deleted_at is null),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', s.id, 'name', s.name, 'trade_name', s.trade_name, 'document_number', s.document_number,
                    'address', s.address, 'state_id', s.state_id, 'city_id', s.city_id,
                    'city_name', ci.name, 'state_uf', st.uf, 'cluster_ids', to_jsonb(s.cluster_ids),
                    'service_ids', to_jsonb(s.service_ids), 'served_city_ids', to_jsonb(s.served_city_ids),
                    'status', s.status, 'notes', s.notes,
                    'external_code', s.external_code, 'category', s.category, 'service_type', s.service_type,
                    'payment_terms', s.payment_terms, 'financial_validation', s.financial_validation,
                    'alias_names', to_jsonb(s.alias_names))
                    order by s.name), '[]')
                    from public.maintenance_suppliers s
                    left join public.cities ci on ci.id = s.city_id
                    left join public.states st on st.id = s.state_id
                   where s.organization_id = p_organization_id and s.deleted_at is null),
    'settings', (select to_jsonb(ms) - 'organization_id' - 'updated_by'
                   from public.maintenance_settings ms where ms.organization_id = p_organization_id));
$$;

create or replace function private.maintenance_row_json(p_m public.maintenances, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_m.id, 'code', p_m.code, 'vehicle_id', p_m.vehicle_id,
    'license_plate', p_m.license_plate_snapshot, 'fleet_code', p_m.fleet_code_snapshot,
    'type', p_m.maintenance_type_code, 'type_name', (select t.name from public.maintenance_types t where t.code = p_m.maintenance_type_code),
    'origin_id', p_m.origin_id, 'origin_name', (select o.name from public.maintenance_origins o where o.id = p_m.origin_id),
    'priority', p_m.priority, 'status', p_m.status,
    'requested_on', p_m.requested_on, 'scheduled_date', p_m.scheduled_date, 'scheduled_time', p_m.scheduled_time,
    'expected_exit_date', p_m.expected_exit_date, 'expected_exit_time', p_m.expected_exit_time,
    'entry_date', p_m.entry_date, 'entry_time', p_m.entry_time, 'exit_date', p_m.exit_date, 'exit_time', p_m.exit_time,
    'duration_hours', p_m.duration_hours, 'duration_precision', p_m.duration_precision,
    'supplier_id', p_m.supplier_id, 'supplier_name', (select s.name from public.maintenance_suppliers s where s.id = p_m.supplier_id),
    'supplier_name_informed', p_m.supplier_name_informed,
    'service_order_number', p_m.service_order_number,
    'entry_km', p_m.entry_km, 'entry_km_status', p_m.entry_km_status, 'entry_km_source', p_m.entry_km_source,
    'current_km', p_m.current_km_snapshot,
    'operation_id', p_m.operation_id, 'operation_name', p_m.operation_name_snapshot,
    'city_id', p_m.city_id, 'city_name', p_m.city_name_snapshot, 'state_uf', p_m.state_uf_snapshot,
    'br_id', p_m.operation_br_id, 'br_code', p_m.br_code_snapshot,
    'leader_id', p_m.leader_employee_id, 'leader_name', p_m.leader_name_snapshot, 'unit_name', p_m.unit_name_snapshot,
    'preventive_cycle_id', p_m.preventive_cycle_id, 'predictive_cycle_id', p_m.predictive_cycle_id,
    'description', p_m.description, 'reopen_count', p_m.reopen_count,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'service_id', i.service_id, 'service', i.service_name_snapshot,
                'cluster_id', i.cluster_id, 'cluster', i.cluster_name_snapshot,
                'criticality', i.criticality, 'status', i.status, 'result', i.result) order by i.sort_order), '[]')
                from public.maintenance_items i where i.maintenance_id = p_m.id and i.status <> 'cancelled'),
    'late_entry', p_m.status = 'scheduled' and p_m.scheduled_date < p_today,
    'exit_overdue', p_m.status = 'in_progress' and p_m.expected_exit_date < p_today,
    'age_days', case when p_m.status in ('to_schedule', 'scheduled', 'in_progress')
                     then p_today - coalesce(p_m.entry_date, p_m.requested_on) end,
    'created_at', p_m.created_at, 'updated_at', p_m.updated_at);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.maintenance_import_number(text)', 'private.maintenance_import_criticality(text)',
    'private.maintenance_import_active(text)', 'private.maintenance_import_text(text)',
    'private.maintenance_canonical(text)', 'private.maintenance_clean_names(jsonb)',
    'private.maintenance_match_supplier(uuid, text)', 'private.maintenance_match_service(uuid, text, text)',
    'private.maintenance_import_merge(text, uuid, jsonb)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
