-- =============================================================================
-- Manutenção — importação: operação e cidade da planilha; manutenção aberta
-- que mudou de OS ou de data
--
-- A base de manutenções ("10 Manutenções") ganhou duas colunas: "Operação" e
-- "Cidade/UF" (a cidade costuma vir sem a UF e às vezes sem acento). E a
-- planilha revisada mexeu na identificação de manutenções ainda abertas: a OS
-- some de linhas "Há agendar" e uma preventiva agendada muda de data. Como a
-- chave da importação é veículo + tipo + data + OS + fornecedor (+ serviço),
-- essas linhas viravam manutenções NOVAS (duplicadas).
--
-- Contexto (operação e cidade)
--   * A validação resolve a operação pelo nome normalizado (sem acento, sem
--     caixa, "/" e "-" com ou sem espaço valem o mesmo) ou pelo código, e a
--     cidade por nome + UF quando a UF vem; sem UF, pela abrangência da
--     operação (operation_cities), depois pelos estados da operação, depois
--     pelo nome único no país. Operação ou cidade não encontrada (ou cidade
--     ambígua) é AVISO: a linha entra, só sem esse dado.
--   * Manutenção nova: o contexto oficial (Fidelização → alocação, na data)
--     continua mandando; só quando ele não dá operação vale o da planilha.
--   * Manutenção existente sem operação: recebe a operação/cidade da planilha
--     (evento import_updated, change = context_filled, autor = quem importou).
--     Já com operação diferente: nada é sobrescrito — aviso "Contexto
--     divergente". Alterada por usuário (conflito): só o contexto vazio é
--     preenchido; o resto continua intocado.
--   * context_source: o CHECK aceita só fidelization/allocation/none, e
--     estendê-lo exigiria remover a constraint atual, o que as migrations
--     desta base não fazem. A manutenção fica com context_source = 'none'
--     (é a verdade: na data não havia fonte oficial) e a origem "planilha"
--     fica registrada no evento (payload.context_source = 'import' no
--     import_updated; payload.context_from_sheet no imported) e na linha da
--     importação (normalized_data.context_fill / context_applied = 'sheet').
--
-- Manutenção aberta reidentificada (ver private.maintenance_import_reidentify)
--   Linhas abertas (Há agendar/Agendado) sem correspondência exata são
--   comparadas, por entrada do arquivo, com as manutenções abertas do mesmo
--   veículo e tipo, importadas e nunca alteradas por usuário, com exatamente o
--   mesmo conjunto de serviços (e o mesmo MP, quando há) e que não estejam no
--   arquivo por outra linha. Uma única candidata = a mesma manutenção:
--   atualiza (reprogramação registrada na trilha; OS vazia na planilha mantém
--   a do HFM, com aviso). Mais de uma = aviso com as candidatas e o
--   comportamento de antes.
--
-- Só create or replace: nenhum objeto é removido nem esvaziado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rótulo normalizado para casar nomes da planilha
-- -----------------------------------------------------------------------------
-- Minúsculas, sem acento, e qualquer sequência de pontuação/espaço vira um
-- espaço: "Redespacho Belem/Pa", "Redespacho Belém / PA" e "Redespacho
-- Belém-PA" dão o mesmo rótulo.
create or replace function private.maintenance_import_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p_value, ''),
           'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
           'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

revoke all on function private.maintenance_import_label(text) from public, anon;
grant execute on function private.maintenance_import_label(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Operação e cidade informadas na linha
-- -----------------------------------------------------------------------------
-- Devolve os ids resolvidos e os avisos (nunca erro). A cidade aceita
-- "Belém/PA", "Belém - PA", "Belém (PA)" ou só "Belém". Sem UF:
--   1º as cidades da abrangência da operação (operation_cities);
--   2º as cidades dos estados da operação (operation_states);
--   3º o nome único entre os municípios do país;
-- e, se ainda houver mais de uma, a cidade fica vazia (aviso com as UFs).
create or replace function private.maintenance_import_resolve_context(p_organization_id uuid, p_operation text, p_city text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_op_raw   text := nullif(btrim(coalesce(p_operation, '')), '');
  v_city_raw text := nullif(btrim(coalesce(p_city, '')), '');
  v_op       record;
  v_city     record;
  v_n        integer;
  v_parts    text[];
  v_name     text;
  v_uf       text;
  v_ufs      text;
  v_oc       uuid;
  v_msgs     jsonb := '[]'::jsonb;
begin
  select null::uuid as id, null::text as name into v_op;
  select null::integer as id, null::text as name, null::smallint as state_id, null::text as uf into v_city;
  -- Operação: nome normalizado ou código. Nunca cria.
  if v_op_raw is not null then
    select count(*) into v_n from public.operations o
     where o.organization_id = p_organization_id and o.deleted_at is null
       and (private.maintenance_import_label(o.name) = private.maintenance_import_label(v_op_raw)
            or (o.code is not null and o.code = upper(v_op_raw)));
    if v_n = 1 then
      select o.id, o.name into v_op from public.operations o
       where o.organization_id = p_organization_id and o.deleted_at is null
         and (private.maintenance_import_label(o.name) = private.maintenance_import_label(v_op_raw)
              or (o.code is not null and o.code = upper(v_op_raw)));
    elsif v_n > 1 then
      v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'ambiguous_operation',
                'message', format('Operação "%s" corresponde a mais de uma operação cadastrada: a linha entra sem operação.', v_op_raw));
    else
      v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'unknown_operation',
                'message', format('Operação "%s" não encontrada: a linha entra sem operação (a importação não cria operação).', v_op_raw));
    end if;
  end if;

  -- Cidade: "Nome/UF", "Nome - UF", "Nome (UF)" ou só o nome.
  if v_city_raw is not null then
    v_name := v_city_raw; v_uf := null;
    v_parts := regexp_match(v_city_raw, '^(.*[^\s/(,-])\s*(?:[/,-]|\()\s*([A-Za-z]{2})\s*\)?$');
    if v_parts is not null and exists (select 1 from public.states s where s.uf::text = upper(v_parts[2])) then
      v_name := btrim(v_parts[1]); v_uf := upper(v_parts[2]);
    end if;

    if v_uf is not null then
      select c.id, c.name, c.state_id, s.uf::text as uf into v_city
        from public.cities c join public.states s on s.id = c.state_id
       where private.normalize_label(c.name) = private.normalize_label(v_name) and s.uf::text = v_uf
       order by c.is_municipality desc, c.id limit 1;
      if v_city.id is null then
        select c.id, c.name, c.state_id, s.uf::text as uf into v_city
          from public.cities c join public.states s on s.id = c.state_id
         where s.uf::text = v_uf and private.maintenance_import_label(c.name) = private.maintenance_import_label(v_name)
         order by c.is_municipality desc, c.id limit 1;
      end if;
      if v_city.id is null then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'unknown_city',
                  'message', format('Cidade "%s" não encontrada: a linha entra sem cidade.', v_city_raw));
      end if;
    else
      -- 1º abrangência da operação
      if v_op.id is not null then
        select count(*) into v_n
          from public.operation_cities oc join public.cities c on c.id = oc.city_id
         where oc.operation_id = v_op.id
           and private.maintenance_import_label(c.name) = private.maintenance_import_label(v_name);
        if v_n = 1 then
          select c.id, c.name, c.state_id, s.uf::text as uf into v_city
            from public.operation_cities oc join public.cities c on c.id = oc.city_id join public.states s on s.id = c.state_id
           where oc.operation_id = v_op.id
             and private.maintenance_import_label(c.name) = private.maintenance_import_label(v_name);
        end if;
      end if;
      -- 2º estados da operação
      if v_city.id is null and v_op.id is not null then
        select count(*) into v_n
          from public.cities c join public.operation_states os on os.state_id = c.state_id and os.operation_id = v_op.id
         where private.normalize_label(c.name) = private.normalize_label(v_name) and c.is_municipality;
        if v_n = 1 then
          select c.id, c.name, c.state_id, s.uf::text as uf into v_city
            from public.cities c join public.operation_states os on os.state_id = c.state_id and os.operation_id = v_op.id
            join public.states s on s.id = c.state_id
           where private.normalize_label(c.name) = private.normalize_label(v_name) and c.is_municipality;
        end if;
      end if;
      -- 3º nome único no país (com e, se preciso, sem a pontuação do nome)
      if v_city.id is null then
        select count(*), string_agg(distinct s.uf::text, ', ' order by s.uf::text) into v_n, v_ufs
          from public.cities c join public.states s on s.id = c.state_id
         where private.normalize_label(c.name) = private.normalize_label(v_name) and c.is_municipality;
        if v_n = 0 then
          select count(*), string_agg(distinct s.uf::text, ', ' order by s.uf::text) into v_n, v_ufs
            from public.cities c join public.states s on s.id = c.state_id
           where private.maintenance_import_label(c.name) = private.maintenance_import_label(v_name);
          if v_n = 1 then
            select c.id, c.name, c.state_id, s.uf::text as uf into v_city
              from public.cities c join public.states s on s.id = c.state_id
             where private.maintenance_import_label(c.name) = private.maintenance_import_label(v_name);
          end if;
        elsif v_n = 1 then
          select c.id, c.name, c.state_id, s.uf::text as uf into v_city
            from public.cities c join public.states s on s.id = c.state_id
           where private.normalize_label(c.name) = private.normalize_label(v_name) and c.is_municipality;
        end if;
        if v_city.id is null and v_n > 1 then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'ambiguous_city',
                    'message', format('Cidade "%s" existe em mais de um estado (%s)%s: informe a UF (ex.: %s/%s). A linha entra sem cidade.',
                                      v_city_raw, v_ufs,
                                      case when v_op.id is not null then format(' e não está na abrangência de %s', v_op.name) else '' end,
                                      v_name, split_part(v_ufs, ', ', 1)));
        elsif v_city.id is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'unknown_city',
                    'message', format('Cidade "%s" não encontrada: a linha entra sem cidade.', v_city_raw));
        end if;
      end if;
    end if;

    -- A cidade da abrangência dá o vínculo operação × cidade (liderança).
    if v_city.id is not null and v_op.id is not null then
      select oc.id into v_oc from public.operation_cities oc
       where oc.operation_id = v_op.id and oc.city_id = v_city.id;
      if v_oc is null then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'city_outside_operation',
                  'message', format('%s/%s não está na abrangência cadastrada de %s: gravada assim mesmo.', v_city.name, v_city.uf, v_op.name));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'operation_id', v_op.id, 'operation_name', v_op.name, 'operation_city_id', v_oc,
    'city_id', v_city.id, 'state_id', v_city.state_id, 'city_name', v_city.name, 'state_uf', v_city.uf,
    'messages', v_msgs);
end;
$$;

revoke all on function private.maintenance_import_resolve_context(uuid, text, text) from public, anon;
grant execute on function private.maintenance_import_resolve_context(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Preencher o contexto vazio de uma manutenção com o da planilha
-- -----------------------------------------------------------------------------
-- Só quando a manutenção não tem operação (nunca sobrescreve). A liderança
-- vem do planner (cidade → operação) na data do contexto, se houver.
-- p_log = false na manutenção recém-criada: o evento "imported" já conta.
create or replace function private.maintenance_import_fill_context(
  p_maintenance_id uuid, p_row jsonb, p_batch_id uuid, p_file_name text, p_log boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.maintenances;
  v_leader record;
begin
  if nullif(p_row ->> 'operation_id', '') is null then
    return false;
  end if;
  select * into v_m from public.maintenances where id = p_maintenance_id for update;
  if v_m.id is null or v_m.operation_id is not null then
    return false;
  end if;
  select * into v_leader
    from private.adherence_leader_at((p_row ->> 'operation_id')::uuid, (p_row ->> 'operation_city_id')::uuid, null, v_m.context_date)
   limit 1;
  update public.maintenances set
    operation_id             = (p_row ->> 'operation_id')::uuid,
    operation_city_id        = (p_row ->> 'operation_city_id')::uuid,
    state_id                 = (p_row ->> 'state_id')::smallint,
    city_id                  = (p_row ->> 'city_id')::integer,
    operation_name_snapshot  = p_row ->> 'operation_name',
    city_name_snapshot       = p_row ->> 'city_name',
    state_uf_snapshot        = p_row ->> 'state_uf',
    leader_employee_id       = coalesce(leader_employee_id, v_leader.employee_id),
    leadership_assignment_id = coalesce(leadership_assignment_id, v_leader.leadership_assignment_id),
    leader_name_snapshot     = coalesce(leader_name_snapshot,
                                        (select e.full_name from public.employees e where e.id = v_leader.employee_id))
  where id = v_m.id;
  if p_log then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'import_updated', null, null,
      'Operação e cidade informadas na planilha ' || coalesce(p_file_name, 'importada'),
      jsonb_build_object('batch_id', p_batch_id, 'change', 'context_filled', 'context_source', 'import',
                         'operation_id', p_row ->> 'operation_id', 'operation_name', p_row ->> 'operation_name',
                         'city_id', p_row ->> 'city_id', 'city_name', p_row ->> 'city_name', 'state_uf', p_row ->> 'state_uf'),
      'import');
  end if;
  return true;
end;
$$;

revoke all on function private.maintenance_import_fill_context(uuid, jsonb, uuid, text, boolean) from public, anon;
grant execute on function private.maintenance_import_fill_context(uuid, jsonb, uuid, text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Manutenção aberta que mudou de OS ou de data (prévia)
-- -----------------------------------------------------------------------------
-- A chave da importação inclui a data de referência e a OS: quando a planilha
-- apaga a OS de uma linha aberta ou reprograma a data, a linha não acha mais
-- a sua manutenção e nasceria outra. Esta etapa, na primeira prévia do lote
-- (depois de todas as linhas validadas), reconhece a manutenção. Regra, por
-- entrada do arquivo (group_key):
--   a) a entrada só tem linhas abertas na planilha (Há agendar/Agendado) e
--      nenhuma reconhecida pela OS (fornecedor reescrito) nem em conflito;
--   b) linhas "sobrando" da entrada: a chave não existe no HFM (seria nova),
--      ou a manutenção da chave não tem o serviço (seria item novo nela), ou
--      o serviço repete outra linha da mesma entrada (a OS sumiu e a linha
--      caiu na entrada vizinha, que já tem esse serviço);
--   c) candidatas: manutenções abertas (to_schedule/scheduled) do mesmo
--      veículo e tipo, criadas pela importação (import_key) e sem nenhum
--      evento de usuário, com EXATAMENTE o mesmo conjunto de serviços das
--      linhas sobrando, com o mesmo MP (quando a planilha traz MP e a
--      manutenção tem ciclo), e que o arquivo não cita por outra linha (nem
--      pela chave, nem como manutenção existente);
--   d) uma única candidata, e que não seja candidata de outra entrada = é a
--      mesma manutenção. As linhas passam a apontar para ela (group_key
--      'reid:<id>', existing_id) e a ação é "atualizar" quando algo muda
--      (situação, fornecedor, data agendada — reprogramação —, OS informada,
--      MP, contexto vazio) ou "sem mudança". OS vazia na planilha mantém a do
--      HFM (aviso). A chave do arquivo passa para a manutenção quando a
--      entrada é toda dela (reimportar o mesmo arquivo casa direto);
--   e) mais de uma candidata: aviso com os códigos; a linha segue como antes.
create or replace function private.maintenance_import_reidentify(p_organization_id uuid, p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g      record;
  v_row    record;
  v_m      record;
  v_id     uuid;
  v_d      jsonb;
  v_change boolean;
  v_msgs   jsonb;
  v_msg    jsonb;
  v_sched  date;
  v_n      integer := 0;
begin
  for v_g in
    with rows as (
      select x.id, x.row_number, x.action, x.normalized_data as d
        from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning')
    ), eligible as (
      select r.d ->> 'group_key' as g
        from rows r
       group by 1
      having bool_and(r.d ->> 'status' in ('to_schedule', 'scheduled'))
         and bool_and(not coalesce((r.d ->> 'matched_by_os')::boolean, false))
         and bool_and(not coalesce((r.d ->> 'context_only')::boolean, false))
    ), residual as (
      select r.* from rows r join eligible e on e.g = r.d ->> 'group_key'
       where r.d ->> 'vehicle_id' is not null and r.d ->> 'service_id' is not null and r.d ->> 'type' is not null
         and ((r.action in ('create', 'update') and r.d ->> 'existing_id' is null)
              or (r.action = 'update' and r.d ->> 'existing_id' is not null
                  and not coalesce((r.d ->> 'existing_has_item')::boolean, true))
              or r.d ? 'dup_of')
    ), grp as (
      select r.d ->> 'group_key' as g,
             min(r.d ->> 'vehicle_id')::uuid as vehicle_id, min(r.d ->> 'type') as type_code,
             array_agg(distinct (r.d ->> 'service_id')::uuid order by (r.d ->> 'service_id')::uuid) as services,
             min((r.d ->> 'preventive_cycle')::integer) as cycle_min, max((r.d ->> 'preventive_cycle')::integer) as cycle_max,
             array_agg(r.id order by r.row_number) as row_ids, min(r.row_number) as first_row
        from residual r group by 1
    ), claimed_keys as (
      select distinct x.normalized_data ->> 'group_key' as k from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ? 'group_key'
    ), claimed_ids as (
      select distinct (x.normalized_data ->> 'existing_id')::uuid as id from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ? 'existing_id'
    ), cand as (
      select g.g, m.id, m.code
        from grp g
        join public.maintenances m
          on m.organization_id = p_organization_id and m.vehicle_id = g.vehicle_id
         and m.maintenance_type_code = g.type_code and m.status in ('to_schedule', 'scheduled')
         and m.import_key is not null
       where g.cycle_min is not distinct from g.cycle_max
         and not exists (select 1 from claimed_keys c where c.k = m.import_key)
         and not exists (select 1 from claimed_ids c where c.id = m.id)
         and not exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user')
         and (select array_agg(distinct i.service_id order by i.service_id) from public.maintenance_items i
               where i.maintenance_id = m.id) = g.services
         and (g.cycle_min is null or m.preventive_cycle_id is null
              or (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id) = g.cycle_min)
    ), ranked as (
      select c.*, count(*) over (partition by c.g) as n_g, count(*) over (partition by c.id) as n_m from cand c
    )
    select g.g, g.row_ids, g.first_row,
           (select r.id from ranked r where r.g = g.g and r.n_g = 1 and r.n_m = 1) as target_id,
           (select string_agg(r.code, ', ' order by r.code) from ranked r where r.g = g.g) as codes,
           (select bool_or(r.n_m > 1) from ranked r where r.g = g.g) as shared,
           not exists (select 1 from rows r where r.d ->> 'group_key' = g.g and r.d ->> 'existing_id' is not null) as move_key
      from grp g
     where exists (select 1 from ranked r where r.g = g.g)
     order by g.first_row
  loop
    if v_g.target_id is null then
      -- Mais de uma candidata (ou a mesma candidata serve a outra entrada):
      -- nada é reaproveitado; o aviso lista as candidatas.
      foreach v_id in array v_g.row_ids loop
        select x.id, x.row_number into v_row from public.import_rows x where x.id = v_id;
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, 'warning', null, 'reidentify_ambiguous',
                format('Mais de uma manutenção aberta do mesmo veículo, tipo e serviços pode ser esta linha (%s)%s: nenhuma foi reaproveitada e a linha segue como estava. Confira antes de gravar.',
                       v_g.codes, case when v_g.shared then ', ou a candidata também serve a outra linha do arquivo' else '' end));
        update public.import_rows set status = 'warning' where id = v_id and status = 'valid';
      end loop;
      continue;
    end if;

    select m.*, (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id) as cycle_number
      into v_m from public.maintenances m where m.id = v_g.target_id;

    foreach v_id in array v_g.row_ids loop
      select x.id, x.row_number, x.normalized_data as d into v_row from public.import_rows x where x.id = v_id;
      -- O que a validação comparou com a manutenção da chave (contexto) não
      -- vale mais: a comparação agora é com a manutenção reconhecida.
      v_d := v_row.d - 'dup_of' - 'context_fill';
      v_msgs := '[]'::jsonb;
      v_change := false;
      v_sched := (v_d ->> 'scheduled_date')::date;

      -- Situação e fornecedor: as mesmas regras da gravação.
      if (v_d ->> 'status') is distinct from v_m.status then
        v_change := true;
      end if;
      if ((v_d ->> 'supplier_id') is not null and (v_d ->> 'supplier_id')::uuid is distinct from v_m.supplier_id)
         or (v_m.supplier_id is null and (v_d ->> 'supplier_name_informed') is distinct from v_m.supplier_name_informed) then
        v_change := true;
      end if;
      -- Data agendada diferente numa agendada: reprogramação (nunca antes da
      -- solicitação, como na reprogramação pela tela).
      if v_d ->> 'status' = 'scheduled' and v_m.status = 'scheduled' and v_sched is not null
         and v_sched is distinct from v_m.scheduled_date then
        if v_sched < v_m.requested_on then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'scheduled_date', 'code', 'reschedule_before_request',
                    'message', format('Data agendada %s anterior à solicitação de %s (%s): mantida a do HFM (%s).',
                                      to_char(v_sched, 'DD/MM/YYYY'), v_m.code, to_char(v_m.requested_on, 'DD/MM/YYYY'),
                                      to_char(v_m.scheduled_date, 'DD/MM/YYYY')));
        else
          v_change := true;
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'scheduled_date', 'code', 'rescheduled',
                    'message', format('%s reprogramada de %s para %s (registrado na trilha como reprogramação).',
                                      v_m.code, to_char(v_m.scheduled_date, 'DD/MM/YYYY'), to_char(v_sched, 'DD/MM/YYYY')));
        end if;
      end if;
      -- OS: vazia na planilha mantém a do HFM; informada e diferente, atualiza.
      if v_d ->> 'service_order_number' is null and v_m.service_order_number is not null then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service_order_number', 'code', 'os_kept',
                  'message', format('OS ausente na planilha; mantida a do HFM (%s).', v_m.service_order_number));
      elsif v_d ->> 'service_order_number' is not null
            and upper(btrim(v_d ->> 'service_order_number')) is distinct from upper(btrim(v_m.service_order_number)) then
        v_change := true;
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service_order_number', 'code', 'os_changed',
                  'message', format('OS de %s passa de %s para %s.', v_m.code, coalesce(v_m.service_order_number, '(vazia)'),
                                    v_d ->> 'service_order_number'));
      end if;
      if v_m.maintenance_type_code = 'preventive' and (v_d ->> 'preventive_cycle') is not null
         and v_m.cycle_number is distinct from (v_d ->> 'preventive_cycle')::integer then
        v_change := true;
      end if;
      -- Contexto: preenche o vazio; diferente, avisa e mantém.
      if v_m.operation_id is null and (v_d ->> 'operation_id') is not null then
        v_change := true;
        v_d := v_d || jsonb_build_object('context_fill', true);
      elsif v_m.operation_id is not null and (v_d ->> 'operation_id') is not null
            and v_m.operation_id <> (v_d ->> 'operation_id')::uuid then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'context_divergent',
                  'message', format('Contexto divergente: mantido o do HFM (%s); planilha: %s.',
                                    concat_ws(' — ', v_m.operation_name_snapshot, v_m.city_name_snapshot || coalesce('/' || v_m.state_uf_snapshot, '')),
                                    concat_ws(' — ', v_d ->> 'operation_name', (v_d ->> 'city_name') || coalesce('/' || (v_d ->> 'state_uf'), ''))));
      end if;

      v_msgs := jsonb_build_array(jsonb_build_object('level', 'warning', 'field', null, 'code', 'reidentified',
                  'message', format('Reconhecida como %s: manutenção aberta do mesmo veículo, tipo e serviços%s, criada pela importação e sem alteração de usuário. A planilha mudou a OS, a data ou o fornecedor; %s, sem criar outra.',
                                    v_m.code, case when v_m.cycle_number is not null then format(' (MP%s)', v_m.cycle_number) else '' end,
                                    case when v_change then 'a manutenção é atualizada' else 'nada muda' end)))
                || v_msgs;
      if not v_change then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'unchanged',
                  'message', format('%s já importada, sem mudança.', v_m.code));
      end if;

      delete from public.import_errors e
       where e.batch_id = p_batch_id and e.row_number = v_row.row_number and e.code in ('duplicate_in_file', 'context_divergent');
      update public.import_rows set
        normalized_data = v_d || jsonb_build_object(
          'existing_id', v_m.id, 'existing_code', v_m.code, 'existing_cycle', v_m.cycle_number, 'existing_has_item', true,
          'matched_by_os', false, 'reidentified', true, 'file_group_key', v_g.g, 'move_key', v_g.move_key,
          'group_key', 'reid:' || v_m.id::text, 'item_key', 'reid:' || v_m.id::text || ':' || (v_d ->> 'service_id')),
        action = case when v_change then 'update' else 'skip' end,
        status = 'warning'
      where id = v_row.id;
      for v_msg in select * from jsonb_array_elements(v_msgs) loop
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, v_msg ->> 'level', v_msg ->> 'field', v_msg ->> 'code', v_msg ->> 'message');
      end loop;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke all on function private.maintenance_import_reidentify(uuid, uuid) from public, anon;
grant execute on function private.maintenance_import_reidentify(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Validação
-- -----------------------------------------------------------------------------
create or replace function public.stage_maintenance_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase   text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_kind    text := coalesce(nullif(p_payload ->> 'kind', ''), 'records');
  v_limit   integer := nullif(p_payload ->> 'limit', '')::integer;
  v_type    text;
  v_batch   uuid;
  v_loaded  integer;
  v_pend    record;
  r         jsonb;
  v_today   date := private.maintenance_today(p_organization_id);
  -- linha
  v_level text; v_action text; v_msgs jsonb; v_norm jsonb;
  v_vehicle record; v_type_code text; v_origin_code text; v_status text; v_raw text;
  v_service uuid; v_cluster uuid; v_supplier uuid; v_mismatch boolean; v_informed text;
  v_req date; v_sched date; v_entry date; v_exit date; v_ref date; v_expected date;
  v_key text; v_group text; v_existing record; v_other record; v_dup boolean;
  v_km integer; v_km_num numeric; v_cycle integer; v_times_ok boolean;
  v_rule record; v_fallback boolean; v_candidates integer;
  v_name text; v_code text; v_vtype uuid; v_sub uuid; v_model uuid; v_doc text; v_ext text; v_types jsonb;
  n_total int; n_valid int; n_warn int; n_err int; v_msg jsonb;
  -- operação/cidade da planilha e o estado do lote antes desta chamada
  v_ctx jsonb; v_fill boolean; v_dup_row integer; v_batch_status text := 'draft';
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  if v_kind not in ('records', 'clusters', 'services', 'suppliers', 'preventive_rules') then
    raise exception 'Tipo de importação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  v_type := case when v_kind = 'records' then 'maintenance' else 'maintenance_catalog' end;

  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values
      (p_organization_id, v_type, 'create_update', 'draft', coalesce(nullif(p_payload ->> 'file_name', ''), 'manutencao'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), jsonb_build_object('kind', v_kind), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    -- A base é a do lote: as partes de validação e a prévia não mandam "kind".
    select b.summary ->> 'kind', b.type, b.status into v_kind, v_type, v_batch_status from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id
       and b.type in ('maintenance', 'maintenance_catalog')
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if v_kind is null then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch, 'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  if v_phase in ('all', 'validate') then
    for v_pend in
      select x.id, x.row_number, x.normalized_data from public.import_rows x
       where x.batch_id = v_batch and x.status = 'pending'
       order by x.row_number
       limit greatest(coalesce(v_limit, 2147483647), 1)
    loop
      r := v_pend.normalized_data;
      v_level := 'valid'; v_action := 'create'; v_msgs := '[]'::jsonb; v_norm := '{}'::jsonb; v_dup := false;

      if v_kind = 'records' then
        -- Veículo: pela frota, depois pela placa. Nunca cria.
        v_vehicle := null;
        select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
         where v.organization_id = p_organization_id and nullif(btrim(r ->> 'fleet_code'), '') is not null
           and upper(btrim(v.fleet_code)) = upper(btrim(r ->> 'fleet_code'))
         order by v.deleted_at nulls first limit 1;
        if v_vehicle.id is null and nullif(btrim(r ->> 'license_plate'), '') is not null then
          select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
           where v.organization_id = p_organization_id
             and private.normalize_plate(v.license_plate) = private.normalize_plate(r ->> 'license_plate')
           order by v.deleted_at nulls first limit 1;
        end if;
        if v_vehicle.id is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'license_plate', 'code', 'unknown_vehicle',
                    'message', 'Veículo não encontrado pela frota nem pela placa. A importação não cria veículos.');
        end if;

        -- Tipo (equivalência exata; Avaria tem fluxo próprio).
        v_raw := private.maintenance_norm(r ->> 'maintenance_type');
        v_type_code := case v_raw
                         when 'preventiva' then 'preventive' when 'preventive' then 'preventive'
                         when 'corretiva' then 'corrective' when 'corrective' then 'corrective'
                         when 'preditiva' then 'predictive' when 'predictive' then 'predictive'
                         when 'socorro em rota' then 'corrective' when 'entrega tecnica' then 'corrective'
                       end;
        v_origin_code := case v_raw when 'socorro em rota' then 'roadside_assistance' when 'entrega tecnica' then 'technical_delivery' end;
        if v_raw = 'avaria' then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'damage_flow',
                    'message', 'Avarias têm fluxo próprio (Sinistros e Avarias) e não entram na base de manutenção.');
        elsif v_type_code is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'unknown_type',
                    'message', format('Tipo de manutenção "%s" não reconhecido (use Preventiva, Corretiva ou Preditiva).', coalesce(r ->> 'maintenance_type', '')));
        elsif v_origin_code is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'maintenance_type', 'code', 'type_mapped',
                    'message', format('"%s" é origem no HFM: importado como Corretiva com essa origem.', r ->> 'maintenance_type'));
        end if;

        -- Situação (equivalência exata).
        v_raw := private.maintenance_norm(r ->> 'status');
        v_status := case v_raw
                      when 'ha agendar' then 'to_schedule' when 'a agendar' then 'to_schedule' when 'aguardando agendamento' then 'to_schedule'
                      when 'agendado' then 'scheduled' when 'agendada' then 'scheduled' when 'reprogramado' then 'scheduled'
                      when 'em execucao' then 'in_progress' when 'em andamento' then 'in_progress'
                      when 'concluido' then 'completed' when 'concluida' then 'completed' when 'realizada' then 'completed' when 'realizado' then 'completed'
                      when 'cancelado' then 'cancelled' when 'cancelada' then 'cancelled'
                      when 'nao realizada' then 'not_performed' when 'nao realizado' then 'not_performed'
                    end;
        if v_raw is null then
          v_status := 'to_schedule';
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'status_default',
                    'message', 'Situação vazia: importada como Há agendar.');
        elsif v_status is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'unknown_status',
                    'message', format('Situação "%s" não reconhecida.', r ->> 'status'));
        end if;

        -- Origem.
        if v_origin_code is null then
          v_raw := private.maintenance_norm(r ->> 'origin');
          if v_raw is null then
            v_origin_code := 'import';
          else
            select o.code into v_origin_code from public.maintenance_origins o
             where (o.organization_id is null or o.organization_id = p_organization_id) and o.is_active
               and (private.maintenance_norm(o.name) = v_raw or o.code = v_raw
                    or (v_raw = 'plano de acao checklist' and o.code = 'action_plan')
                    or (v_raw in ('relato motorista', 'relato de motorista') and o.code = 'driver_report')
                    or (v_raw = 'preventiva programada' and o.code = 'preventive_schedule'))
             order by o.organization_id nulls last limit 1;
            if v_origin_code is null then
              v_origin_code := 'not_informed';
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'origin', 'code', 'unknown_origin',
                        'message', format('Origem "%s" não está no catálogo: importada como Não informado.', r ->> 'origin'));
            end if;
          end if;
        end if;

        -- Serviço: nome ou outro nome; o cluster desempata, e o cadastro vale
        -- quando o cluster da linha diverge e o nome é único.
        v_service := null; v_cluster := null; v_mismatch := false;
        if nullif(btrim(r ->> 'service'), '') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'missing_service',
                    'message', 'Serviço ausente.');
        else
          select m.o_service_id, m.o_cluster_id, m.o_cluster_mismatch into v_service, v_cluster, v_mismatch
            from private.maintenance_match_service(p_organization_id, r ->> 'service', r ->> 'cluster') m;
          if v_service is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                      'message', format('Serviço "%s"%s não está no catálogo (nem entre os outros nomes dos serviços). Cadastre-o ou informe o nome antigo no serviço equivalente.',
                                        r ->> 'service', coalesce(' (cluster ' || nullif(btrim(r ->> 'cluster'), '') || ')', '')));
          elsif v_mismatch then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'cluster', 'code', 'cluster_mismatch',
                      'message', format('Serviço "%s" está no cluster %s do cadastro; a linha informava "%s". Vale o cadastro.',
                                        r ->> 'service', (select c.name from public.maintenance_clusters c where c.id = v_cluster), r ->> 'cluster'));
          end if;
        end if;

        -- Fornecedor: não reconhecido não bloqueia; o nome informado fica guardado.
        v_informed := nullif(btrim(r ->> 'supplier'), '');
        v_supplier := case when v_informed is null then null else private.maintenance_match_supplier(p_organization_id, v_informed) end;
        if v_informed is not null and v_supplier is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'supplier', 'code', 'unknown_supplier',
                    'message', format('Fornecedor "%s" não reconhecido no catálogo (nome, nome fantasia, outros nomes ou CNPJ): a manutenção entra sem vínculo e guarda o nome informado.', v_informed));
        end if;

        -- Datas. Entrada e saída reais só contam quando a situação é de fato.
        v_req := private.maintenance_import_date(r ->> 'requested_on');
        v_sched := private.maintenance_import_date(r ->> 'scheduled_date');
        v_entry := private.maintenance_import_date(r ->> 'entry_date');
        v_exit := private.maintenance_import_date(r ->> 'exit_date');
        v_expected := private.maintenance_import_date(r ->> 'expected_exit_date');
        if nullif(btrim(r ->> 'requested_on'), '') is not null and v_req is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'requested_on', 'code', 'invalid_date',
                    'message', format('Data de solicitação "%s" inválida: ignorada.', r ->> 'requested_on'));
        end if;
        if nullif(btrim(r ->> 'scheduled_date'), '') is not null and v_sched is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status = 'scheduled' then 'error' else 'warning' end,
                    'field', 'scheduled_date', 'code', 'invalid_date',
                    'message', format('Data agendada "%s" inválida%s.', r ->> 'scheduled_date', case when v_status = 'scheduled' then '' else ': ignorada' end));
        end if;
        if nullif(btrim(r ->> 'expected_exit_date'), '') is not null and v_expected is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'expected_exit_date', 'code', 'invalid_date',
                    'message', format('Previsão de saída "%s" inválida: ignorada.', r ->> 'expected_exit_date'));
        end if;
        if nullif(btrim(r ->> 'entry_date'), '') is not null and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status in ('in_progress', 'completed') then 'error' else 'warning' end,
                    'field', 'entry_date', 'code', 'invalid_date', 'message', format('Data de entrada "%s" inválida.', r ->> 'entry_date'));
        end if;
        if nullif(btrim(r ->> 'exit_date'), '') is not null and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status = 'completed' then 'error' else 'warning' end,
                    'field', 'exit_date', 'code', 'invalid_date', 'message', format('Data de saída "%s" inválida.', r ->> 'exit_date'));
        end if;
        v_ref := coalesce(v_entry, v_sched, v_req);
        v_req := coalesce(v_req, least(coalesce(v_entry, v_sched), v_today), v_today);
        if v_status = 'scheduled' and v_sched is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'scheduled_date', 'code', 'missing_scheduled',
                    'message', 'Agendado exige a data agendada.');
        end if;
        if v_status in ('in_progress', 'completed') and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'missing_entry',
                    'message', 'Em execução ou concluído exige a data de entrada real.');
        end if;
        if v_status = 'completed' and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'missing_exit',
                    'message', 'Concluído exige a data de saída real.');
        end if;
        if v_status = 'completed' and v_exit < v_entry then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'exit_before_entry',
                    'message', format('Saída (%s) anterior à entrada (%s).', to_char(v_exit, 'DD/MM/YYYY'), to_char(v_entry, 'DD/MM/YYYY')));
        end if;
        if v_status in ('in_progress', 'completed') and (v_entry > v_today or (v_status = 'completed' and v_exit > v_today)) then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'future_fact',
                    'message', 'Entrada ou saída real no futuro.');
        end if;
        if v_status = 'in_progress' and v_exit is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'exit_date', 'code', 'exit_ignored',
                    'message', 'Em execução com data de saída: a saída foi ignorada.');
          v_exit := null;
        end if;
        if v_status not in ('in_progress', 'completed') then
          v_exit := null;
        end if;
        -- Saída no mesmo dia, mas antes da hora de entrada: os horários não
        -- servem; o tempo em oficina fica por data.
        v_times_ok := not (v_exit is not null and v_exit = v_entry
                           and private.maintenance_import_time(r ->> 'exit_time') < private.maintenance_import_time(r ->> 'entry_time'));
        if not v_times_ok then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'exit_time', 'code', 'exit_time_before_entry',
                    'message', format('Saída às %s antes da entrada às %s no mesmo dia: horários ignorados (tempo em oficina por data).',
                                      to_char(private.maintenance_import_time(r ->> 'exit_time'), 'HH24:MI'),
                                      to_char(private.maintenance_import_time(r ->> 'entry_time'), 'HH24:MI')));
        end if;

        -- KM: número como a planilha escreve (148398.88 → 148398).
        v_km_num := private.maintenance_import_number(r ->> 'entry_km');
        v_km := null;
        if nullif(btrim(r ->> 'entry_km'), '') is not null and v_km_num is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'entry_km', 'code', 'invalid_km',
                    'message', format('KM de entrada "%s" não é um número: ignorado (o KM oficial será usado).', r ->> 'entry_km'));
        elsif v_km_num is not null and (v_km_num < 0 or v_km_num > 9999999) then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'entry_km', 'code', 'km_out_of_range',
                    'message', 'KM de entrada fora da faixa: ignorado (o KM oficial será usado).');
        elsif v_km_num is not null then
          v_km := trunc(v_km_num)::integer;
        end if;
        if v_expected is not null and v_sched is not null and v_expected < v_sched then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'expected_exit_date', 'code', 'expected_before_schedule',
                    'message', 'Previsão de saída anterior ao agendamento: ignorada.');
          v_expected := null;
        end if;
        v_cycle := nullif(substring(coalesce(r ->> 'preventive_cycle', '') from '(\d+)'), '')::integer;
        if v_type_code = 'preventive' and v_cycle is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'no_cycle',
                    'message', 'Preventiva sem ciclo (MP): importada sem vínculo com a matriz preventiva.');
        end if;
        -- O MP só vira vínculo se o veículo tiver regra preventiva e o ciclo
        -- existir nela; senão a linha entra, mas o aviso diz por que a matriz
        -- não muda.
        if v_type_code = 'preventive' and v_cycle is not null and v_vehicle.id is not null then
          v_rule := null;
          select pr.id, pr.cycle_count into v_rule from public.maintenance_preventive_rules pr
           where pr.id = private.maintenance_preventive_rule_for(v_vehicle.id);
          if v_rule.id is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'no_preventive_rule',
                      'message', format('MP%s informado, mas o veículo não tem regra preventiva (tipo, subcategoria ou modelo): a manutenção entra sem vínculo com a matriz.', v_cycle));
          elsif v_cycle > v_rule.cycle_count then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'cycle_out_of_plan',
                      'message', format('MP%s acima dos %s ciclos da regra preventiva do veículo: a manutenção entra sem vínculo com a matriz.', v_cycle, v_rule.cycle_count));
          end if;
        end if;

        -- Operação e cidade da planilha: nunca bloqueiam a linha. Não entram
        -- na chave — a mesma entrada com a operação corrigida continua sendo
        -- a mesma manutenção.
        v_ctx := private.maintenance_import_resolve_context(p_organization_id, r ->> 'operation', r ->> 'city');
        v_msgs := v_msgs || coalesce(v_ctx -> 'messages', '[]'::jsonb);

        -- A entrada em oficina (a manutenção) e o item. O fornecedor entra como
        -- foi escrito: dois fornecedores no mesmo dia são duas entradas, e a
        -- chave não muda quando o de-para do fornecedor muda.
        v_group := md5(concat_ws('|', v_vehicle.id, v_type_code, v_ref, upper(btrim(coalesce(r ->> 'service_order_number', ''))),
                                 coalesce(private.maintenance_norm(v_informed), '')));
        v_key := v_group || ':' || coalesce(v_service::text, '');

        v_other := null;
        v_dup_row := null;
        select x.row_number into v_other from public.import_rows x
         where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
           and x.normalized_data ->> 'item_key' = v_key
         order by x.row_number limit 1;
        if v_other.row_number is not null and v_service is not null then
          v_dup := true;
          v_dup_row := v_other.row_number;
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service', 'code', 'duplicate_in_file',
                    'message', format('Serviço repetido na mesma manutenção (mesmo veículo, tipo, data, OS e fornecedor da linha %s): a linha não cria outro item.', v_other.row_number));
        end if;
        v_other := null;
        select x.row_number, x.normalized_data ->> 'status' as status into v_other from public.import_rows x
         where x.batch_id = v_batch and x.id <> v_pend.id and x.status in ('valid', 'warning')
           and x.normalized_data ->> 'group_key' = v_group and (x.normalized_data ->> 'status') is distinct from v_status
         order by x.row_number limit 1;
        if v_other.row_number is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'group_status_mixed',
                    'message', format('A linha %s da mesma manutenção tem outra situação: a manutenção fica na situação menos avançada e cada serviço com a sua.', v_other.row_number));
        end if;

        -- Já existe no HFM?
        v_existing := null;
        v_fallback := false;
        select m.id, m.code, m.status, m.supplier_id, m.supplier_name_informed, m.imported_at, m.updated_at,
               m.operation_id, m.operation_name_snapshot, m.city_name_snapshot, m.state_uf_snapshot,
               exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user') as touched,
               exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service) as has_item,
               (select i.status from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service
                 order by i.sort_order limit 1) as item_status,
               (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id) as cycle_number
          into v_existing
          from public.maintenances m
         where m.organization_id = p_organization_id and m.import_key = v_group;
        -- A mesma entrada com o fornecedor escrito de outro jeito (a planilha
        -- corrigiu o nome): a chave muda, mas a OS identifica. Só com um único
        -- candidato importado do mesmo veículo, tipo e data — senão é outra
        -- entrada e nasce como nova.
        if v_existing.id is null and v_vehicle.id is not null and v_ref is not null
           and nullif(btrim(r ->> 'service_order_number'), '') is not null then
          select count(*) into v_candidates
            from public.maintenances m
           where m.organization_id = p_organization_id and m.import_key is not null and m.import_key <> v_group
             and m.status <> 'cancelled' and m.vehicle_id = v_vehicle.id and m.maintenance_type_code = v_type_code
             and m.context_date = v_ref
             and upper(btrim(coalesce(m.service_order_number, ''))) = upper(btrim(r ->> 'service_order_number'));
          if v_candidates = 1 then
            select m.id, m.code, m.status, m.supplier_id, m.supplier_name_informed, m.imported_at, m.updated_at,
               m.operation_id, m.operation_name_snapshot, m.city_name_snapshot, m.state_uf_snapshot,
               exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user') as touched,
               exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service) as has_item,
               (select i.status from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service
                 order by i.sort_order limit 1) as item_status,
               (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id) as cycle_number
              into v_existing
              from public.maintenances m
             where m.organization_id = p_organization_id and m.import_key is not null and m.import_key <> v_group
               and m.status <> 'cancelled' and m.vehicle_id = v_vehicle.id and m.maintenance_type_code = v_type_code
               and m.context_date = v_ref
               and upper(btrim(coalesce(m.service_order_number, ''))) = upper(btrim(r ->> 'service_order_number'));
            v_fallback := true;
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'supplier', 'code', 'matched_by_os',
                      'message', format('Mesma entrada de %s (veículo, tipo, data e OS %s): o fornecedor foi escrito de outro jeito e a manutenção é atualizada, não duplicada.',
                                        v_existing.code, r ->> 'service_order_number'));
          end if;
        end if;

        v_norm := jsonb_build_object(
          'vehicle_id', v_vehicle.id, 'type', v_type_code, 'origin_code', v_origin_code, 'status', v_status,
          'service_id', v_service, 'cluster_id', v_cluster, 'supplier_id', v_supplier,
          'supplier_name_informed', case when v_supplier is null then v_informed end,
          'requested_on', v_req, 'scheduled_date', v_sched, 'scheduled_time', private.maintenance_import_time(r ->> 'scheduled_time'),
          'expected_exit_date', v_expected, 'entry_date', v_entry,
          'entry_time', case when v_times_ok then private.maintenance_import_time(r ->> 'entry_time') end,
          'exit_date', v_exit, 'exit_time', case when v_exit is not null and v_times_ok then private.maintenance_import_time(r ->> 'exit_time') end,
          'entry_km', v_km, 'preventive_cycle', v_cycle,
          'service_order_number', nullif(btrim(r ->> 'service_order_number'), ''),
          'priority', coalesce(private.maintenance_import_criticality(r ->> 'priority'), 'medium'),
          'description', nullif(btrim(r ->> 'description'), ''), 'notes', nullif(btrim(r ->> 'notes'), ''),
          'group_key', v_group, 'item_key', v_key,
          'license_plate', r ->> 'license_plate', 'fleet_code', r ->> 'fleet_code', 'service', r ->> 'service', 'supplier', v_informed,
          'operation', nullif(btrim(r ->> 'operation'), ''), 'city', nullif(btrim(r ->> 'city'), ''),
          'operation_id', v_ctx ->> 'operation_id', 'operation_name', v_ctx ->> 'operation_name',
          'operation_city_id', v_ctx ->> 'operation_city_id', 'city_id', (v_ctx ->> 'city_id')::integer,
          'state_id', (v_ctx ->> 'state_id')::integer, 'city_name', v_ctx ->> 'city_name', 'state_uf', v_ctx ->> 'state_uf',
          'city_label', (v_ctx ->> 'city_name') || coalesce('/' || (v_ctx ->> 'state_uf'), ''));
        if v_dup then
          -- A prévia pode reconhecer a linha repetida como outra manutenção
          -- aberta (a OS sumiu): ver private.maintenance_import_reidentify.
          v_norm := v_norm || jsonb_build_object('dup_of', v_dup_row);
        end if;

        -- Manutenção existente sem operação recebe a da planilha; com outra
        -- operação, o HFM é mantido (aviso), nunca sobrescrito.
        v_fill := v_existing.id is not null and v_existing.operation_id is null and (v_ctx ->> 'operation_id') is not null;
        if v_existing.id is not null and not v_dup and v_existing.operation_id is not null and (v_ctx ->> 'operation_id') is not null
           and v_existing.operation_id <> (v_ctx ->> 'operation_id')::uuid then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'context_divergent',
                    'message', format('Contexto divergente: mantido o do HFM (%s); planilha: %s.',
                                      concat_ws(' — ', v_existing.operation_name_snapshot,
                                                v_existing.city_name_snapshot || coalesce('/' || v_existing.state_uf_snapshot, '')),
                                      concat_ws(' — ', v_ctx ->> 'operation_name', v_norm ->> 'city_label')));
        end if;

        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif v_dup then
          v_level := 'warning'; v_action := 'skip';
        elsif v_existing.id is not null then
          if v_existing.touched and v_fill then
            -- Alterada por usuário: nada do arquivo sobrescreve; só o contexto,
            -- que estava vazio, é preenchido.
            v_level := 'warning'; v_action := 'update';
            v_norm := v_norm || jsonb_build_object('context_only', true, 'context_fill', true);
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'conflict',
                      'message', format('%s já foi alterada no HFM depois da importação; o arquivo não sobrescreve (conflito) — só a operação e a cidade, que estavam vazias, são preenchidas.', v_existing.code));
          elsif v_existing.touched then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'conflict',
                      'message', format('%s já foi alterada no HFM depois da importação; o arquivo não sobrescreve (conflito).', v_existing.code));
          elsif v_existing.has_item
                and (v_existing.status = v_status or (v_status = 'completed' and v_existing.item_status = 'done'))
                and v_existing.supplier_id is not distinct from v_supplier
                and (v_supplier is not null or v_existing.supplier_name_informed is not distinct from v_informed)
                and (v_type_code <> 'preventive' or v_cycle is null or v_existing.cycle_number is not distinct from v_cycle)
                and not v_fallback and not v_fill then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'unchanged',
                      'message', format('%s já importada, sem mudança.', v_existing.code));
          else
            v_action := 'update';
            if v_fill then
              v_norm := v_norm || jsonb_build_object('context_fill', true);
            end if;
          end if;
          v_norm := v_norm || jsonb_build_object('existing_id', v_existing.id, 'existing_code', v_existing.code,
                                                 'existing_cycle', v_existing.cycle_number, 'matched_by_os', v_fallback,
                                                 'existing_has_item', coalesce(v_existing.has_item, false));
        elsif exists (select 1 from public.import_rows x
                       where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                         and x.normalized_data ->> 'group_key' = v_group and x.action = 'create') then
          v_action := 'update';  -- mais um serviço da mesma manutenção deste arquivo
        end if;
        if v_level = 'valid' and exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;

      elsif v_kind = 'clusters' then
        v_name := nullif(btrim(r ->> 'name'), '');
        v_code := upper(coalesce(nullif(btrim(r ->> 'code'), ''), private.maintenance_code_from_name(v_name)));
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do cluster ausente.');
        end if;
        v_cluster := null;
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (c.code = v_code or private.maintenance_norm(c.name) = private.maintenance_norm(v_name))
         order by (private.maintenance_norm(c.name) = private.maintenance_norm(v_name)) desc limit 1;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_action := case when v_cluster is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_cluster, 'name', v_name, 'code', v_code, 'description', nullif(btrim(r ->> 'description'), ''),
                                     'default_criticality', private.maintenance_import_criticality(r ->> 'criticality'),
                                     'status', private.maintenance_import_active(r ->> 'status'),
                                     'item_key', 'cluster:' || coalesce(v_cluster::text, v_code));

      elsif v_kind = 'services' then
        v_name := nullif(btrim(r ->> 'name'), '');
        v_cluster := null; v_service := null;
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'cluster') or c.code = upper(btrim(coalesce(r ->> 'cluster', ''))))
         limit 1;
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do serviço ausente.');
        end if;
        if v_cluster is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'cluster', 'code', 'unknown_cluster',
                    'message', format('Cluster "%s" não existe. Todo serviço pertence a um cluster; importe os clusters antes.', coalesce(r ->> 'cluster', '')));
        end if;
        select s.id into v_service from public.maintenance_services s
         where s.organization_id = p_organization_id and s.deleted_at is null and s.cluster_id = v_cluster
           and private.maintenance_norm(s.name) = private.maintenance_norm(v_name) limit 1;
        -- Tipos: "Não se aplica" (ou "Nenhum") é lista vazia; coluna ausente mantém o que há.
        v_types := null;
        if nullif(btrim(r ->> 'maintenance_types'), '') is not null then
          select coalesce(jsonb_agg(distinct q.t) filter (where q.t is not null), '[]'::jsonb) into v_types from (
            select case private.maintenance_norm(x) when 'preventiva' then 'preventive' when 'corretiva' then 'corrective'
                                                    when 'preditiva' then 'predictive' end as t
              from regexp_split_to_table(r ->> 'maintenance_types', '[;,|/]') x) q;
          if exists (select 1 from regexp_split_to_table(r ->> 'maintenance_types', '[;,|/]') x
                      where private.maintenance_norm(x) is not null
                        and private.maintenance_norm(x) not in ('preventiva', 'corretiva', 'preditiva', 'nao se aplica', 'nenhum', 'todos')) then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'maintenance_types', 'code', 'unknown_type',
                      'message', format('Tipo(s) "%s": só Preventiva, Corretiva e Preditiva são reconhecidos; os demais foram ignorados.', r ->> 'maintenance_types'));
          end if;
        end if;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_action := case when v_service is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_service, 'cluster_id', v_cluster, 'name', v_name,
                    'criticality', private.maintenance_import_criticality(r ->> 'criticality'),
                    'expected_hours', private.maintenance_import_number(r ->> 'expected_hours'),
                    'is_predictive', case when nullif(btrim(r ->> 'is_predictive'), '') is not null
                                            then private.maintenance_norm(r ->> 'is_predictive') in ('sim', 's', 'true', '1', 'x', 'yes')
                                          when v_types is not null then v_types ? 'predictive' end,
                    'maintenance_type_codes', v_types,
                    'status', private.maintenance_import_active(r ->> 'status'),
                    'alias_names', case when nullif(btrim(r ->> 'alias_names'), '') is not null
                                        then to_jsonb(private.maintenance_clean_names(to_jsonb(r ->> 'alias_names'))) end,
                    'item_key', 'service:' || coalesce(v_cluster::text, '') || ':' || coalesce(private.maintenance_norm(v_name), ''));

      elsif v_kind = 'suppliers' then
        v_name := nullif(btrim(r ->> 'name'), '');
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do fornecedor ausente.');
        end if;
        -- Quem é o fornecedor: pelo nome. CNPJ, código externo e nome fantasia
        -- não renomeiam ninguém — há filiais e cadastros diferentes com o
        -- mesmo CNPJ na base de origem.
        v_supplier := null;
        select s.id into v_supplier from public.maintenance_suppliers s
         where s.organization_id = p_organization_id and s.deleted_at is null
           and private.maintenance_norm(s.name) = private.maintenance_norm(v_name)
         limit 1;
        v_raw := private.maintenance_import_text(r ->> 'document_number');
        v_doc := nullif(regexp_replace(coalesce(v_raw, ''), '[^0-9]', '', 'g'), '');
        if v_raw is not null and (v_doc is null or length(v_doc) not in (11, 14)) then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'invalid_document',
                    'message', format('CNPJ/CPF "%s" inválido: fornecedor importado sem documento.', v_raw));
          v_doc := null;
        end if;
        if v_doc is not null then
          v_other := null;
          select s.name into v_other from public.maintenance_suppliers s
           where s.organization_id = p_organization_id and s.deleted_at is null and s.document_number = v_doc
             and s.id is distinct from v_supplier limit 1;
          if v_other.name is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'duplicate_document',
                      'message', format('CNPJ/CPF %s já pertence a "%s": este fornecedor entra sem documento.', v_raw, v_other.name));
            v_doc := null;
          else
            v_other := null;
            select x.row_number, x.normalized_data ->> 'name' as name into v_other from public.import_rows x
             where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
               and x.normalized_data ->> 'document_number' = v_doc
             order by x.row_number limit 1;
            if v_other.row_number is not null then
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'duplicate_document',
                        'message', format('CNPJ/CPF %s repetido no arquivo (linha %s, "%s"): este fornecedor entra sem documento.', v_raw, v_other.row_number, v_other.name));
              v_doc := null;
            end if;
          end if;
        end if;
        v_ext := regexp_replace(coalesce(private.maintenance_import_text(r ->> 'external_code'), ''), '\.0+$', '');
        v_ext := nullif(v_ext, '');
        if v_ext is not null then
          v_other := null;
          select x.row_number into v_other from public.import_rows x
           where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
             and x.normalized_data ->> 'external_code' = v_ext
           order by x.row_number limit 1;
          if v_other.row_number is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'external_code', 'code', 'duplicate_external_code',
                      'message', format('Código %s repetido no arquivo (linha %s): mantido nos dois.', v_ext, v_other.row_number));
          end if;
        end if;
        v_action := case when v_supplier is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_supplier, 'name', v_name,
                    'trade_name', private.maintenance_import_text(r ->> 'trade_name'),
                    'document_number', v_doc,
                    'external_code', v_ext,
                    'category', private.maintenance_import_text(r ->> 'category'),
                    'service_type', private.maintenance_import_text(r ->> 'service_type'),
                    'payment_terms', private.maintenance_import_text(r ->> 'payment_terms'),
                    'financial_validation', private.maintenance_import_text(r ->> 'financial_validation'),
                    'address', private.maintenance_import_text(r ->> 'address'),
                    'status', private.maintenance_import_active(r ->> 'status'),
                    'city_id', (select c.id from public.cities c join public.states s on s.id = c.state_id
                                 where private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'city')
                                   and (nullif(btrim(r ->> 'state'), '') is null or upper(s.uf) = upper(btrim(r ->> 'state')))
                                 order by c.is_municipality desc limit 1),
                    'cluster_ids', case when nullif(btrim(r ->> 'clusters'), '') is not null then
                                     (select coalesce(jsonb_agg(distinct c.id), '[]'::jsonb)
                                        from regexp_split_to_table(r ->> 'clusters', '[;,|/]') x
                                        join public.maintenance_clusters c on c.organization_id = p_organization_id and c.deleted_at is null
                                         and private.maintenance_norm(c.name) = private.maintenance_norm(x)) end,
                    'alias_names', case when nullif(btrim(r ->> 'alias_names'), '') is not null
                                        then to_jsonb(private.maintenance_clean_names(to_jsonb(r ->> 'alias_names'))) end,
                    'item_key', 'supplier:' || coalesce(private.maintenance_norm(v_name), ''));
        if nullif(btrim(r ->> 'city'), '') is not null and v_norm ->> 'city_id' is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'unknown_city',
                    'message', format('Cidade "%s" não encontrada: fornecedor importado sem cidade.', r ->> 'city'));
        end if;

      else  -- preventive_rules
        -- Tipo de equipamento; a planilha pode trazer a subcategoria no lugar
        -- do tipo ("Toco", "Truck") e no lugar do modelo ("10,5 m³").
        v_vtype := null; v_sub := null; v_model := null;
        v_raw := private.maintenance_import_text(r ->> 'vehicle_type');
        select t.id into v_vtype from public.vehicle_types t
         where (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null
           and (private.maintenance_norm(t.name) = private.maintenance_norm(v_raw) or lower(t.code) = lower(coalesce(v_raw, '')))
         order by t.organization_id nulls last limit 1;
        if v_vtype is null and v_raw is not null then
          select s.id, s.vehicle_type_id into v_sub, v_vtype
            from public.vehicle_subcategories s join public.vehicle_types t on t.id = s.vehicle_type_id
           where (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null
             and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw)
             and (select count(*) from public.vehicle_subcategories s2 join public.vehicle_types t2 on t2.id = s2.vehicle_type_id
                   where (t2.organization_id is null or t2.organization_id = p_organization_id) and t2.deleted_at is null
                     and s2.deleted_at is null and private.maintenance_norm(s2.name) = private.maintenance_norm(v_raw)) = 1;
          if v_sub is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'vehicle_type', 'code', 'type_from_subcategory',
                      'message', format('"%s" é subcategoria de %s: o parâmetro vale para essa subcategoria.',
                                        v_raw, (select t.name from public.vehicle_types t where t.id = v_vtype)));
          end if;
        end if;
        if v_vtype is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'vehicle_type', 'code', 'unknown_vehicle_type',
                    'message', format('Tipo de equipamento "%s" não existe.', coalesce(r ->> 'vehicle_type', '')));
        end if;
        v_raw := private.maintenance_import_text(r ->> 'subcategory');
        if v_raw is not null then
          v_code := null;
          select s.id::text into v_code from public.vehicle_subcategories s
           where s.vehicle_type_id = v_vtype and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw) limit 1;
          if v_code is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'subcategory', 'code', 'unknown_subcategory',
                      'message', format('Subcategoria "%s" não existe neste tipo.', v_raw));
          elsif v_sub is not null and v_sub <> v_code::uuid then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'subcategory', 'code', 'subcategory_conflict',
                      'message', format('Subcategoria "%s" diverge da informada no tipo.', v_raw));
          else
            v_sub := v_code::uuid;
          end if;
        end if;
        v_raw := private.maintenance_import_text(r ->> 'model');
        if v_raw is not null then
          select m.id into v_model from public.vehicle_models m
           where (m.organization_id = p_organization_id or m.organization_id is null)
             and private.maintenance_norm(m.name) = private.maintenance_norm(v_raw) limit 1;
          if v_model is null and v_sub is null then
            select s.id into v_sub from public.vehicle_subcategories s
             where s.vehicle_type_id = v_vtype and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw) limit 1;
            if v_sub is not null then
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'model', 'code', 'model_is_subcategory',
                        'message', format('"%s" é subcategoria, não modelo: o parâmetro vale para essa subcategoria.', v_raw));
            end if;
          end if;
          if v_model is null and v_sub is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'model', 'code', 'unknown_model',
                      'message', format('Modelo "%s" não existe.', v_raw));
          end if;
        end if;
        v_service := null;
        if private.maintenance_import_text(r ->> 'service') is not null then
          select m.o_service_id into v_service from private.maintenance_match_service(p_organization_id, r ->> 'service', null) m;
          if v_service is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                      'message', format('Serviço "%s" não está no catálogo.', r ->> 'service'));
          end if;
        end if;
        if coalesce(private.maintenance_import_number(r ->> 'interval_km'), 0) < 100 then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'interval_km', 'code', 'invalid_interval',
                    'message', 'Intervalo de KM ausente ou menor que 100.');
        end if;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_cluster := (select pr.id from public.maintenance_preventive_rules pr
                       where pr.organization_id = p_organization_id and pr.deleted_at is null and pr.vehicle_type_id = v_vtype
                         and pr.vehicle_subcategory_id is not distinct from v_sub and pr.vehicle_model_id is not distinct from v_model);
        v_action := case when v_cluster is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object(
          'id', v_cluster, 'vehicle_type_id', v_vtype, 'vehicle_subcategory_id', v_sub, 'vehicle_model_id', v_model, 'service_id', v_service,
          'interval_km', trunc(private.maintenance_import_number(r ->> 'interval_km')),
          'initial_km', trunc(private.maintenance_import_number(r ->> 'initial_km')),
          'cycle_count', trunc(private.maintenance_import_number(r ->> 'cycle_count')),
          'alert_before_pct', private.maintenance_import_number(r ->> 'alert_before_pct'),
          'tolerance_after_pct', private.maintenance_import_number(r ->> 'tolerance_after_pct'),
          'criticality', private.maintenance_import_criticality(r ->> 'criticality'),
          'status', private.maintenance_import_active(r ->> 'status'),
          'item_key', 'rule:' || concat_ws(':', v_vtype, v_sub, v_model));
      end if;

      if v_kind <> 'records' then
        if exists (select 1 from public.import_rows x
                    where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                      and x.normalized_data ->> 'item_key' = v_norm ->> 'item_key') then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', null, 'code', 'duplicate_in_file',
                    'message', 'Registro repetido no arquivo.');
        end if;
        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;
      end if;

      update public.import_rows
         set normalized_data = v_norm, status = v_level, action = v_action,
             vehicle_id = case when v_kind = 'records' then (v_norm ->> 'vehicle_id')::uuid end
       where id = v_pend.id;
      for v_msg in select * from jsonb_array_elements(v_msgs) loop
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, v_batch, v_pend.row_number, v_msg ->> 'level', v_msg ->> 'field', v_msg ->> 'code', v_msg ->> 'message');
      end loop;
    end loop;
    if v_phase = 'validate' then
      return jsonb_build_object('batch_id', v_batch,
        'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
    end if;
  end if;

  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  -- Com todas as linhas validadas: manutenção aberta que mudou de OS ou de
  -- data. Só na primeira prévia do lote (rever a prévia não repete avisos).
  if v_kind = 'records' and v_batch_status = 'draft' then
    perform private.maintenance_import_reidentify(p_organization_id, v_batch);
  end if;
  select count(*)::integer, count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer, count(*) filter (where x.status = 'error')::integer
    into n_total, n_valid, n_warn, n_err
    from public.import_rows x where x.batch_id = v_batch;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         created_rows = 0, updated_rows = 0, skipped_rows = 0,
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
           'create_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'create'),
           'update_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'update'),
           'unchanged_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'unchanged'),
           'conflict_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'conflict'),
           'duplicate_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'duplicate_in_file'),
           'maintenances', (select count(distinct x.normalized_data ->> 'group_key') from public.import_rows x
                             where x.batch_id = v_batch and x.action in ('create', 'update')),
           'context_fill_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'update'
                                    and coalesce((x.normalized_data ->> 'context_fill')::boolean, false)),
           'reidentified_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch
                                    and coalesce((x.normalized_data ->> 'reidentified')::boolean, false)),
           'unknown_suppliers', (select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'rows', q.n) order by q.n desc, q.name), '[]'::jsonb)
                                   from (select x.normalized_data ->> 'supplier_name_informed' as name, count(*) as n
                                           from public.import_rows x
                                          where x.batch_id = v_batch and x.normalized_data ->> 'supplier_name_informed' is not null
                                          group by 1 order by 2 desc, 1 limit 100) q),
           'already_imported', exists (select 1 from public.import_batches b
                                        where b.organization_id = p_organization_id and b.type = v_type and b.status = 'completed'
                                          and b.file_hash is not null
                                          and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch))),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return (
    select jsonb_build_object(
      'batch_id', v_batch, 'kind', v_kind, 'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
      'summary', b.summary,
      'categories', (select coalesce(jsonb_object_agg(e.code, e.cnt), '{}'::jsonb)
                       from (select code, count(*) as cnt from public.import_errors where batch_id = v_batch group by code) e),
      'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field,
                                                                'code', e.code, 'message', e.message) order by e.level, e.row_number)
                              from (select * from public.import_errors x where x.batch_id = v_batch
                                     order by (x.level = 'error') desc, x.row_number limit 300) e), '[]'::jsonb),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', i.row_number, 'status', i.status, 'action', i.action,
                                                              'data', i.normalized_data) order by i.row_number)
                            from (select * from public.import_rows x where x.batch_id = v_batch order by x.row_number limit 12) i), '[]'::jsonb))
      from public.import_batches b where b.id = v_batch);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Gravação
-- -----------------------------------------------------------------------------
create or replace function public.process_maintenance_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   record;
  v_kind    text;
  v_group   record;
  v_row     record;
  v_m       public.maintenances;
  v_code    text;
  v_origin  uuid;
  v_context jsonb;
  v_km      jsonb;
  v_cycle   uuid;
  v_first   jsonb;
  v_agg     record;
  v_payload jsonb;
  v_tz      text;
  v_left    integer;
  v_done    integer := 0;
  v_limit   integer := greatest(coalesce(p_limit, 2147483647), 1);
  v_new     boolean;
  v_was_completed boolean;
  v_items_added boolean;
  v_ctx_row jsonb;      -- primeira linha da entrada com operação reconhecida
  v_ctx_applied text;   -- 'sheet' quando o contexto gravado veio da planilha
  v_sheet   jsonb;
  v_after   jsonb;
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type in ('maintenance', 'maintenance_catalog') for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  v_kind := v_batch.summary ->> 'kind';
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  end if;
  select coalesce(nullif(o.timezone, ''), 'America/Sao_Paulo') into v_tz from public.organizations o where o.id = p_organization_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  if v_kind = 'records' then
    for v_group in
      select x.normalized_data ->> 'group_key' as group_key, min(x.row_number) as first_row
        from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       group by 1 order by 2
       limit v_limit
    loop
      select x.normalized_data into v_first from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
         and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       order by x.row_number limit 1;
      -- A entrada em oficina fica na situação menos avançada das suas linhas,
      -- e a saída é a última delas. Contam também as linhas sem mudança do
      -- arquivo (ação "skip"), senão reimportar concluiria uma entrada que
      -- ainda tem serviço em execução.
      select (array_agg(x.normalized_data ->> 'status' order by
                case x.normalized_data ->> 'status' when 'to_schedule' then 1 when 'scheduled' then 2 when 'in_progress' then 3
                                                    when 'completed' then 4 when 'not_performed' then 5 else 6 end, x.row_number))[1] as status,
             max((x.normalized_data ->> 'exit_date')::date) as exit_date,
             (array_agg(x.normalized_data ->> 'exit_time' order by (x.normalized_data ->> 'exit_date')::date desc nulls last,
                                                                  x.normalized_data ->> 'exit_time' desc nulls last))[1] as exit_time
        into v_agg
        from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
         and x.status in ('valid', 'warning');
      v_first := v_first || jsonb_build_object('status', v_agg.status,
                   'exit_date', case when v_agg.status = 'completed' then v_agg.exit_date end,
                   'exit_time', case when v_agg.status = 'completed' then v_agg.exit_time end);
      -- Linhas da mesma entrada com horários que não fecham (saída do grupo no
      -- mesmo dia, antes da hora de entrada da primeira linha): tempo por data.
      if v_first ->> 'status' = 'completed' and (v_first ->> 'exit_date')::date = (v_first ->> 'entry_date')::date
         and (v_first ->> 'exit_time')::time < (v_first ->> 'entry_time')::time then
        v_first := v_first || jsonb_build_object('entry_time', null, 'exit_time', null);
      end if;

      -- Operação/cidade da planilha: a da primeira linha da entrada que a tem.
      select x.normalized_data into v_ctx_row from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
         and x.status in ('valid', 'warning') and x.action in ('create', 'update')
         and x.normalized_data ->> 'operation_id' is not null
       order by x.row_number limit 1;
      v_ctx_applied := null;

      select * into v_m from public.maintenances
       where organization_id = p_organization_id and import_key = v_group.group_key for update;
      -- Reconhecida pela OS na validação (o fornecedor mudou de grafia): a
      -- manutenção passa a responder pela chave nova. Reidentificada na prévia
      -- (OS ou data mudou numa aberta): a chave do arquivo só passa para ela
      -- quando a entrada do arquivo é toda dela (move_key) e está livre.
      if v_m.id is null and v_first ? 'existing_id' then
        select * into v_m from public.maintenances
         where organization_id = p_organization_id and id = (v_first ->> 'existing_id')::uuid for update;
        if v_m.id is not null and coalesce((v_first ->> 'reidentified')::boolean, false) then
          if coalesce((v_first ->> 'move_key')::boolean, false) and v_first ->> 'file_group_key' is not null
             and not exists (select 1 from public.maintenances x
                              where x.organization_id = p_organization_id and x.import_key = v_first ->> 'file_group_key') then
            update public.maintenances set import_key = v_first ->> 'file_group_key' where id = v_m.id;
            v_m.import_key := v_first ->> 'file_group_key';
          end if;
        elsif v_m.id is not null and not exists (select 1 from public.maintenances x
                                                  where x.organization_id = p_organization_id and x.import_key = v_group.group_key) then
          update public.maintenances set import_key = v_group.group_key where id = v_m.id;
          v_m.import_key := v_group.group_key;
        end if;
      end if;
      v_new := v_m.id is null;
      v_was_completed := coalesce(v_m.status = 'completed', false);
      v_items_added := false;

      -- Alterada por usuário (conflito) e sem operação: só o contexto vazio é
      -- preenchido; situação, fornecedor, ciclo e itens ficam como estão.
      if v_m.id is not null and coalesce((v_first ->> 'context_only')::boolean, false) then
        if private.maintenance_import_fill_context(v_m.id, coalesce(v_ctx_row, v_first), p_batch_id, v_batch.file_name, true) then
          v_ctx_applied := 'sheet';
        end if;
        update public.import_rows set status = 'updated',
               normalized_data = case when v_ctx_applied is not null
                                      then normalized_data || jsonb_build_object('context_applied', v_ctx_applied) else normalized_data end
         where batch_id = p_batch_id and normalized_data ->> 'group_key' = v_group.group_key
           and status in ('valid', 'warning') and action in ('create', 'update');
        v_done := v_done + 1;
        continue;
      end if;

      -- Reidentificada: a planilha reprogramou a data ou trocou a OS de uma
      -- manutenção aberta. Reprogramação como na tela (data nunca antes da
      -- solicitação; valor anterior e novo na trilha), mas com origem
      -- "importação" — não conta como alteração de usuário. OS vazia na
      -- planilha mantém a do HFM.
      if v_m.id is not null and coalesce((v_first ->> 'reidentified')::boolean, false) then
        if v_m.status = 'scheduled' and v_first ->> 'status' = 'scheduled' and (v_first ->> 'scheduled_date') is not null
           and (v_first ->> 'scheduled_date')::date is distinct from v_m.scheduled_date
           and (v_first ->> 'scheduled_date')::date >= v_m.requested_on then
          update public.maintenances set
            scheduled_date     = (v_first ->> 'scheduled_date')::date,
            scheduled_time     = coalesce((v_first ->> 'scheduled_time')::time, scheduled_time),
            expected_exit_date = case
                                   when (v_first ->> 'expected_exit_date')::date >= (v_first ->> 'scheduled_date')::date
                                     then (v_first ->> 'expected_exit_date')::date
                                   when expected_exit_date < (v_first ->> 'scheduled_date')::date then null
                                   else expected_exit_date end,
            imported_at = now(), import_batch_id = p_batch_id
          where id = v_m.id
          returning jsonb_build_object('scheduled_date', scheduled_date, 'scheduled_time', scheduled_time,
                                       'supplier_id', supplier_id, 'expected_exit_date', expected_exit_date,
                                       'expected_exit_time', expected_exit_time)
            into v_after;
          perform private.maintenance_log(p_organization_id, v_m.id, 'rescheduled', null, null,
            'Reprogramado pela planilha ' || coalesce(v_batch.file_name, 'importada'),
            jsonb_build_object('batch_id', p_batch_id,
                               'before', jsonb_build_object('scheduled_date', v_m.scheduled_date, 'scheduled_time', v_m.scheduled_time,
                                                            'supplier_id', v_m.supplier_id, 'expected_exit_date', v_m.expected_exit_date,
                                                            'expected_exit_time', v_m.expected_exit_time),
                               'after', v_after),
            'import');
        end if;
        if nullif(btrim(v_first ->> 'service_order_number'), '') is not null
           and upper(btrim(v_first ->> 'service_order_number')) is distinct from upper(btrim(v_m.service_order_number)) then
          update public.maintenances set service_order_number = btrim(v_first ->> 'service_order_number'),
                 imported_at = now(), import_batch_id = p_batch_id
           where id = v_m.id;
          perform private.maintenance_log(p_organization_id, v_m.id, 'import_updated', null, null,
            'OS informada na planilha ' || coalesce(v_batch.file_name, 'importada'),
            jsonb_build_object('batch_id', p_batch_id, 'change', 'service_order_number',
                               'os_from', v_m.service_order_number, 'os_to', btrim(v_first ->> 'service_order_number')),
            'import');
        end if;
        select * into v_m from public.maintenances where id = v_m.id;
      end if;

      if v_m.id is null then
        select o.id into v_origin from public.maintenance_origins o
         where o.code = v_first ->> 'origin_code' and (o.organization_id is null or o.organization_id = p_organization_id)
         order by o.organization_id nulls last limit 1;
        v_code := private.next_entity_code(p_organization_id,
                    'maintenance:' || extract(year from (v_first ->> 'requested_on')::date)::int,
                    'MAN-' || extract(year from (v_first ->> 'requested_on')::date)::int || '-', 6);
        v_cycle := null;
        if v_first ->> 'type' = 'preventive' and v_first ->> 'preventive_cycle' is not null then
          perform private.maintenance_sync_preventive_vehicle((v_first ->> 'vehicle_id')::uuid);
          select c.id into v_cycle from public.maintenance_preventive_cycles c
           where c.vehicle_id = (v_first ->> 'vehicle_id')::uuid and c.cycle_number = (v_first ->> 'preventive_cycle')::integer;
          -- Um ciclo com manutenção aberta não recebe outra aberta.
          if v_cycle is not null and v_first ->> 'status' in ('to_schedule', 'scheduled', 'in_progress')
             and exists (select 1 from public.maintenances mm where mm.preventive_cycle_id = v_cycle
                           and mm.status in ('to_schedule', 'scheduled', 'in_progress')) then
            v_cycle := null;
          end if;
        end if;

        insert into public.maintenances
          (organization_id, code, vehicle_id, license_plate_snapshot, fleet_code_snapshot, vehicle_type_id, vehicle_subcategory_id,
           vehicle_model_id, maintenance_type_code, origin_id, priority, status, context_date, requested_on,
           scheduled_date, scheduled_time, expected_exit_date, entry_date, entry_time, exit_date, exit_time,
           supplier_id, supplier_name_informed, service_order_number, preventive_cycle_id, description, notes,
           import_batch_id, import_key, imported_at)
        select p_organization_id, v_code, v.id, v.license_plate, v.fleet_code, v.vehicle_type_id, v.vehicle_subcategory_id,
               v.vehicle_model_id, v_first ->> 'type', v_origin, coalesce(v_first ->> 'priority', 'medium'), v_first ->> 'status',
               coalesce((v_first ->> 'entry_date')::date, (v_first ->> 'scheduled_date')::date, (v_first ->> 'requested_on')::date),
               (v_first ->> 'requested_on')::date, (v_first ->> 'scheduled_date')::date, (v_first ->> 'scheduled_time')::time,
               (v_first ->> 'expected_exit_date')::date,
               case when v_first ->> 'status' in ('in_progress', 'completed') then (v_first ->> 'entry_date')::date end,
               case when v_first ->> 'status' in ('in_progress', 'completed') then (v_first ->> 'entry_time')::time end,
               case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_date')::date end,
               case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_time')::time end,
               (v_first ->> 'supplier_id')::uuid, v_first ->> 'supplier_name_informed', v_first ->> 'service_order_number', v_cycle,
               v_first ->> 'description', v_first ->> 'notes', p_batch_id, v_group.group_key, now()
          from public.vehicles v where v.id = (v_first ->> 'vehicle_id')::uuid
        returning * into v_m;

        v_context := private.maintenance_context(p_organization_id, v_m.vehicle_id, v_m.context_date);
        perform private.maintenance_apply_context(v_m.id, v_context);
        -- O contexto oficial manda; sem operação nele, vale o da planilha
        -- (context_source continua 'none' e a origem fica no evento). Com
        -- operação diferente da planilha, fica o oficial e o lote avisa.
        v_sheet := null;
        if v_ctx_row is not null then
          if (v_context ->> 'operation_id') is null then
            if private.maintenance_import_fill_context(v_m.id, v_ctx_row, p_batch_id, v_batch.file_name, false) then
              v_ctx_applied := 'sheet';
              v_sheet := jsonb_build_object('context_source', 'import',
                           'operation_id', v_ctx_row ->> 'operation_id', 'operation_name', v_ctx_row ->> 'operation_name',
                           'city_id', v_ctx_row ->> 'city_id', 'city_name', v_ctx_row ->> 'city_name', 'state_uf', v_ctx_row ->> 'state_uf');
            end if;
          elsif (v_context ->> 'operation_id')::uuid <> (v_ctx_row ->> 'operation_id')::uuid then
            insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
            values (p_organization_id, p_batch_id, v_group.first_row, 'warning', 'operation', 'context_divergent',
                    format('Contexto divergente: mantido o do HFM (%s); planilha: %s.',
                           concat_ws(' — ', v_context ->> 'operation_name',
                                     (v_context ->> 'city_name') || coalesce('/' || (v_context ->> 'state_uf'), '')),
                           concat_ws(' — ', v_ctx_row ->> 'operation_name', v_ctx_row ->> 'city_label')));
          end if;
        end if;
        if v_m.entry_date is not null then
          if v_first ->> 'entry_km' is not null then
            v_km := private.maintenance_check_manual_km(p_organization_id, v_m.vehicle_id, v_m.entry_date, (v_first ->> 'entry_km')::integer)
                    || jsonb_build_object('source', 'import');
          else
            v_km := private.maintenance_resolve_km(p_organization_id, v_m.vehicle_id, v_m.entry_date);
          end if;
          perform private.maintenance_apply_entry_km(v_m.id, v_km, null);
        end if;
        perform private.maintenance_log(p_organization_id, v_m.id, 'imported', null, v_m.status,
          'Importado de ' || coalesce(v_batch.file_name, 'arquivo'),
          jsonb_build_object('batch_id', p_batch_id, 'first_row', v_group.first_row, 'context', v_context,
                             'context_from_sheet', v_sheet), 'import');
      elsif (v_first ->> 'status') is distinct from v_m.status
            or ((v_first ->> 'supplier_id') is not null and (v_first ->> 'supplier_id')::uuid is distinct from v_m.supplier_id)
            or (v_m.supplier_id is null and (v_first ->> 'supplier_name_informed') is distinct from v_m.supplier_name_informed) then
        -- Situação ou fornecedor diferente num registro ainda intocado: novo
        -- evento, nunca reescrita.
        update public.maintenances set
          status = v_first ->> 'status',
          scheduled_date = coalesce((v_first ->> 'scheduled_date')::date, scheduled_date),
          entry_date = case when v_first ->> 'status' in ('in_progress', 'completed') then coalesce((v_first ->> 'entry_date')::date, entry_date) else entry_date end,
          exit_date = case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_date')::date else null end,
          exit_time = case when v_first ->> 'status' = 'completed' then (v_first ->> 'exit_time')::time else null end,
          supplier_id = coalesce((v_first ->> 'supplier_id')::uuid, supplier_id),
          supplier_name_informed = case when coalesce((v_first ->> 'supplier_id')::uuid, supplier_id) is not null then null
                                        else coalesce(v_first ->> 'supplier_name_informed', supplier_name_informed) end,
          imported_at = now(), import_batch_id = p_batch_id
        where id = v_m.id;
        perform private.maintenance_log(p_organization_id, v_m.id, 'import_updated', v_m.status, v_first ->> 'status',
          'Atualizado por ' || coalesce(v_batch.file_name, 'arquivo'),
          jsonb_build_object('batch_id', p_batch_id,
                             'supplier_from', v_m.supplier_id, 'supplier_to', coalesce((v_first ->> 'supplier_id')::uuid, v_m.supplier_id)),
          'import');
        select * into v_m from public.maintenances where id = v_m.id;
      end if;

      -- Ciclo preventivo informado no arquivo para uma manutenção que já
      -- existia: vincula (ou corrige o vínculo) e, se concluída, realiza o MP.
      if not v_new and v_m.maintenance_type_code = 'preventive' and v_first ->> 'preventive_cycle' is not null then
        perform private.maintenance_import_link_cycle(v_m.id, (v_first ->> 'preventive_cycle')::integer, p_batch_id);
        select * into v_m from public.maintenances where id = v_m.id;
      end if;

      -- Existente sem operação: recebe a da planilha (evento import_updated,
      -- change = context_filled). Com operação, nunca é sobrescrita.
      if not v_new and v_m.operation_id is null and v_ctx_row is not null then
        if private.maintenance_import_fill_context(v_m.id, v_ctx_row, p_batch_id, v_batch.file_name, true) then
          v_ctx_applied := 'sheet';
        end if;
        select * into v_m from public.maintenances where id = v_m.id;
      end if;

      -- Itens: um por serviço distinto do grupo, cada um com a situação da sua linha.
      for v_row in
        select x.id, x.normalized_data as d from public.import_rows x
         where x.batch_id = p_batch_id and x.normalized_data ->> 'group_key' = v_group.group_key
           and x.status in ('valid', 'warning') and x.action in ('create', 'update')
         order by x.row_number
      loop
        -- Qualquer item do serviço (inclusive cancelado) já representa a linha:
        -- reimportar não cria outro.
        if not exists (select 1 from public.maintenance_items i
                        where i.maintenance_id = v_m.id and i.service_id = (v_row.d ->> 'service_id')::uuid) then
          insert into public.maintenance_items
            (organization_id, maintenance_id, service_id, cluster_id, service_name_snapshot, cluster_name_snapshot, criticality,
             status, result, completed_at, sort_order)
          select p_organization_id, v_m.id, s.id, c.id, s.name, c.name, s.criticality,
                 case when v_m.status = 'completed' or v_row.d ->> 'status' = 'completed' then 'done'
                      when v_m.status in ('cancelled', 'not_performed') or v_row.d ->> 'status' in ('cancelled', 'not_performed') then 'cancelled'
                      else 'pending' end,
                 case when v_m.status = 'completed' or v_row.d ->> 'status' = 'completed' then 'resolved' end,
                 case when v_m.status = 'completed' or v_row.d ->> 'status' = 'completed' then
                        coalesce(((coalesce((v_row.d ->> 'exit_date')::date, v_m.exit_date)
                                   + coalesce((v_row.d ->> 'exit_time')::time, v_m.exit_time, time '12:00')) at time zone v_tz), now()) end,
                 (select coalesce(max(i.sort_order), 0) + 1 from public.maintenance_items i where i.maintenance_id = v_m.id)
            from public.maintenance_services s join public.maintenance_clusters c on c.id = s.cluster_id
           where s.id = (v_row.d ->> 'service_id')::uuid;
          v_items_added := true;
        elsif v_m.status = 'completed' or v_row.d ->> 'status' = 'completed' then
          update public.maintenance_items set status = 'done', result = coalesce(result, 'resolved'), completed_at = coalesce(completed_at, now())
           where maintenance_id = v_m.id and service_id = (v_row.d ->> 'service_id')::uuid and status = 'pending';
        end if;
        update public.import_rows set status = case when v_row.d ? 'existing_id' then 'updated' else 'created' end,
               normalized_data = case when v_ctx_applied is not null
                                      then normalized_data || jsonb_build_object('context_applied', v_ctx_applied) else normalized_data end
         where id = v_row.id;
      end loop;

      -- Preventiva importada como concluída realiza o ciclo; preditiva coberta reinicia.
      if v_m.status = 'completed' then
        if v_m.preventive_cycle_id is not null then
          update public.maintenance_preventive_cycles set
            completed_on = v_m.exit_date, completed_km = v_m.entry_km, completed_maintenance_id = v_m.id, completion_source = 'import'
          where id = v_m.preventive_cycle_id and completed_on is null;
        end if;
        -- Os ganchos da conclusão (preditiva) só correm para o que concluiu
        -- agora: reprocessar uma manutenção antiga não mexe nas referências.
        if v_new or not v_was_completed or v_items_added then
          perform private.maintenance_on_completed(v_m.id);
        end if;
      end if;
      v_done := v_done + 1;
    end loop;
  else
    for v_row in
      select x.id, x.row_number, x.action, x.normalized_data as d from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
       order by x.row_number limit v_limit
    loop
      begin
        -- Atualizar mantém o que o arquivo não traz.
        v_payload := jsonb_strip_nulls(v_row.d - 'item_key');
        if v_row.action = 'update' and v_row.d ->> 'id' is not null then
          v_payload := private.maintenance_import_merge(v_kind, (v_row.d ->> 'id')::uuid, v_payload);
        end if;
        if v_kind = 'clusters' then
          perform public.maintenance_save_cluster(p_organization_id, v_payload);
        elsif v_kind = 'services' then
          perform public.maintenance_save_service(p_organization_id, v_payload);
        elsif v_kind = 'suppliers' then
          perform public.maintenance_save_supplier(p_organization_id, v_payload);
        else
          perform public.maintenance_save_preventive_rule(p_organization_id, v_payload);
        end if;
        update public.import_rows set status = case when v_row.action = 'update' then 'updated' else 'created' end where id = v_row.id;
      exception when others then
        update public.import_rows set status = 'failed', action = 'skip' where id = v_row.id;
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, 'error', null, 'process_failed', sqlerrm);
      end;
      v_done := v_done + 1;
    end loop;
  end if;

  select count(*)::integer into v_left from public.import_rows x
   where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left, 'batch_id', p_batch_id);
  end if;

  update public.import_batches set
    status = 'completed', processed_at = now(),
    created_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'created'),
    updated_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'updated'),
    skipped_rows = (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status in ('warning', 'error', 'skipped', 'failed')),
    summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
      'maintenances_created', (select count(*) from public.maintenances m where m.import_batch_id = p_batch_id
                                  and exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.event_type = 'imported'
                                                and e.payload ->> 'batch_id' = p_batch_id::text)),
      'failed_rows', (select count(*) from public.import_rows x where x.batch_id = p_batch_id and x.status = 'failed')),
    updated_at = now(), updated_by = auth.uid()
  where id = p_batch_id;

  return (select jsonb_build_object('done', true, 'remaining', 0, 'batch_id', p_batch_id,
                                    'created_rows', b.created_rows, 'updated_rows', b.updated_rows, 'skipped_rows', b.skipped_rows,
                                    'summary', b.summary)
            from public.import_batches b where b.id = p_batch_id);
end;
$$;

comment on function public.stage_maintenance_import(uuid, jsonb) is
  'Importação da Manutenção (carga/validação/prévia em partes). A base (kind) vem do lote nas partes seguintes. Reconhece fornecedor e serviço pelos outros nomes; fornecedor desconhecido não bloqueia a linha. Ciclo preventivo diferente do vínculo atual atualiza a manutenção; a mesma entrada com o fornecedor reescrito é reconhecida pela OS. Operação e cidade da planilha resolvidas por nome normalizado (aviso, nunca erro); manutenção aberta que perdeu a OS ou mudou de data é reconhecida (mesmo veículo, tipo e serviços, candidata única) e atualizada em vez de duplicada.';
comment on function public.process_maintenance_import(uuid, uuid, integer) is
  'Gravação da importação da Manutenção, em partes e idempotente. Manutenção nova sem contexto oficial na data recebe a operação/cidade da planilha (context_source continua none; a origem fica no evento imported). Existente sem operação é preenchida (evento import_updated, change = context_filled); com operação diferente, nunca é sobrescrita. Reidentificada: reprogramação registrada como evento rescheduled (source import).';
