-- =============================================================================
-- Importação e exportação sem teto de linhas
--
-- Os tetos de 5.000 (Fidelização, BRs, Filiais) e 20.000 linhas (Aderência)
-- existiam porque cada arquivo era validado e gravado numa chamada só, e uma
-- chamada tem 8 s no banco. Um arquivo de 5.000 alocações levava 31 s — o
-- teto nem chegava a proteger. Agora nenhuma rotina de importação limita o
-- número de linhas: o arquivo chega em partes e é validado e gravado em
-- partes, cada uma bem dentro do tempo de uma chamada.
--
--   stage_*_import   `phase` = load | validate | finalize | all
--                    load grava as linhas como pendentes; validate valida as
--                    próximas `limit` pendentes, na ordem do arquivo; finalize
--                    fecha a prévia com os números lidos das linhas. `all`
--                    (o padrão) faz tudo numa chamada, como antes.
--   validate_*_import p_limit: valida só as próximas pendentes.
--   process_*_import  p_limit: grava as próximas; a última chamada fecha o
--                    lote. Um lote em `processing` é retomado de onde parou.
--
-- A regra de cada linha não muda: as mesmas conferências, na mesma ordem, as
-- mesmas mensagens. As conferências "dentro do próprio arquivo" passam a ter
-- índice próprio no lote, para que o custo por linha não cresça com o
-- tamanho do arquivo.
-- =============================================================================

-- Índices do lote para as conferências dentro do arquivo -----------------------
-- Os índices do lote usam normalize_plate e normalize_renavam, e a tela de
-- Frota grava import_rows como `authenticated`: o índice é calculado com o
-- privilégio de quem grava. As duas só normalizam texto, sem ler tabela
-- nenhuma — como normalize_code e normalize_label, já executáveis por esse papel.
grant execute on function private.normalize_plate(text) to authenticated, service_role;
grant execute on function private.normalize_renavam(text) to authenticated, service_role;

create index if not exists import_rows_batch_identity_idx
  on public.import_rows (batch_id, (normalized_data ->> 'identity'));
create index if not exists import_rows_batch_br_idx
  on public.import_rows (batch_id, (normalized_data ->> 'br_id'));
create index if not exists import_rows_batch_vehicle_idx
  on public.import_rows (batch_id, vehicle_id);
create index if not exists import_rows_batch_plate_idx
  on public.import_rows (batch_id, private.normalize_plate(normalized_data ->> 'license_plate'));
create index if not exists import_rows_batch_fleet_idx
  on public.import_rows (batch_id, private.normalize_code(normalized_data ->> 'fleet_code'));
create index if not exists import_rows_batch_vin_idx
  on public.import_rows (batch_id, private.normalize_plate(normalized_data ->> 'vin'));
create index if not exists import_rows_batch_renavam_idx
  on public.import_rows (batch_id, private.normalize_renavam(normalized_data ->> 'renavam'));
create index if not exists import_rows_batch_employee_code_idx
  on public.import_rows (batch_id, upper(btrim(coalesce(normalized_data ->> 'employee_code', ''))));
create index if not exists import_rows_batch_cpf_idx
  on public.import_rows (batch_id, regexp_replace(coalesce(normalized_data ->> 'cpf', ''), '[^0-9]', '', 'g'));
create index if not exists import_rows_batch_full_name_idx
  on public.import_rows (batch_id, private.normalize_label(normalized_data ->> 'full_name'));
-- Os apontamentos de uma linha, para a prévia linha a linha das Filiais.
create index if not exists import_errors_batch_row_idx
  on public.import_errors (batch_id, row_number);

-- As buscas por veículo e por BR de cada linha, sem varrer a tabela ------------
create index if not exists vehicles_org_fleet_upper_idx
  on public.vehicles (organization_id, upper(btrim(fleet_code))) where deleted_at is null;
create index if not exists vehicles_org_plate_norm_idx
  on public.vehicles (organization_id, private.normalize_plate(license_plate)) where deleted_at is null;
create index if not exists operation_brs_org_code_norm_idx
  on public.operation_brs (organization_id, private.normalize_code(code)) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Validação em partes: stage_*_import
-- -----------------------------------------------------------------------------

create or replace function public.stage_fidelization_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit    integer := nullif(p_payload ->> 'limit', '')::integer;
  v_pend     record;
  v_loaded   integer;
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
  -- Sem teto de linhas: o arquivo chega em partes. `phase` diz o que esta
  -- chamada faz — load (grava as linhas como pendentes), validate (valida
  -- as próximas `limit` pendentes, em ordem), finalize (fecha a prévia) ou
  -- all (tudo de uma vez, o comportamento original). Cada chamada termina
  -- bem dentro do tempo de uma requisição, qualquer que seja o tamanho do
  -- arquivo; a regra de cada linha é a mesma de antes.
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
    values
      (p_organization_id, 'fidelization', 'create', 'draft',
       coalesce(nullif(p_payload ->> 'file_name', ''), 'fidelizacao'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'fidelization'
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if not found then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    -- Reenviar a mesma parte (uma resposta perdida no caminho) não duplica linha.
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch,
      'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;


  if v_phase in ('all', 'validate') then
  for v_pend in
    select x.id, x.row_number, x.normalized_data from public.import_rows x
     where x.batch_id = v_batch and x.status = 'pending'
     order by x.row_number
     limit greatest(coalesce(v_limit, 2147483647), 1)
  loop
    r := v_pend.normalized_data;
    v_row_no := v_pend.row_number;
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
        -- As duas metades pelos índices do lote (BR e veículo), para que o
        -- custo por linha não cresça com o tamanho do arquivo.
        select min(q.row_number) into v_n from (
          select ir.row_number from public.import_rows ir
           where ir.batch_id = v_batch and ir.normalized_data ->> 'br_id' = v_br.id::text
             and v_role = 'primary' and ir.normalized_data ->> 'vehicle_role' = 'primary'
             and ir.status <> 'error' and ir.action in ('create', 'substitute')
             and daterange((ir.normalized_data ->> 'start_date')::date, nullif(ir.normalized_data ->> 'end_date', '')::date, '[]')
                 && daterange(v_start, v_end, '[]')
          union all
          select ir.row_number from public.import_rows ir
           where ir.batch_id = v_batch and ir.vehicle_id = v_veh_id
             and ir.status <> 'error' and ir.action in ('create', 'substitute')
             and daterange((ir.normalized_data ->> 'start_date')::date, nullif(ir.normalized_data ->> 'end_date', '')::date, '[]')
                 && daterange(v_start, v_end, '[]')) q;
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

    update public.import_rows
       set normalized_data = v_norm, status = v_status, action = v_action, vehicle_id = v_veh_id
     where id = v_pend.id;

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
  if v_phase = 'validate' then
    return jsonb_build_object('batch_id', v_batch,
      'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
  end if;
  end if;

  -- Fechamento: os números saem das linhas gravadas, não de contadores
  -- desta chamada, porque a validação pode ter vindo em várias.
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  select count(*)::integer,
         count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer,
         count(*) filter (where x.status = 'error')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'create')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'substitute')::integer,
         count(*) filter (where x.status <> 'error' and x.action not in ('create', 'substitute'))::integer
    into n_total, n_valid, n_warn, n_err, n_create, n_sub, n_skip
    from public.import_rows x where x.batch_id = v_batch;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'fidelization' and b.status = 'completed'
       and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch)) into v_already;

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


create or replace function public.stage_br_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit    integer := nullif(p_payload ->> 'limit', '')::integer;
  v_pend     record;
  v_loaded   integer;
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
  -- Sem teto de linhas: o arquivo chega em partes. `phase` diz o que esta
  -- chamada faz — load (grava as linhas como pendentes), validate (valida
  -- as próximas `limit` pendentes, em ordem), finalize (fecha a prévia) ou
  -- all (tudo de uma vez, o comportamento original). Cada chamada termina
  -- bem dentro do tempo de uma requisição, qualquer que seja o tamanho do
  -- arquivo; a regra de cada linha é a mesma de antes.
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
    values
      (p_organization_id, 'operation_brs', 'create_update', 'draft',
       coalesce(nullif(p_payload ->> 'file_name', ''), 'brs'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'operation_brs'
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if not found then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    -- Reenviar a mesma parte (uma resposta perdida no caminho) não duplica linha.
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch,
      'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;


  if v_phase in ('all', 'validate') then
  for v_pend in
    select x.id, x.row_number, x.normalized_data from public.import_rows x
     where x.batch_id = v_batch and x.status = 'pending'
     order by x.row_number
     limit greatest(coalesce(v_limit, 2147483647), 1)
  loop
    r := v_pend.normalized_data;
    v_row_no := v_pend.row_number;
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
                    where ir.batch_id = v_batch and ir.status <> 'pending'
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

    update public.import_rows
       set normalized_data = v_norm, status = v_status, action = v_action
     where id = v_pend.id;

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
  if v_phase = 'validate' then
    return jsonb_build_object('batch_id', v_batch,
      'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
  end if;
  end if;

  -- Fechamento: os números saem das linhas gravadas, não de contadores
  -- desta chamada, porque a validação pode ter vindo em várias.
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  select count(*)::integer,
         count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer,
         count(*) filter (where x.status = 'error')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'create')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'update')::integer,
         count(*) filter (where x.status <> 'error' and x.action not in ('create', 'update'))::integer
    into n_total, n_valid, n_warn, n_err, n_create, n_update, n_skip
    from public.import_rows x where x.batch_id = v_batch;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'operation_brs' and b.status = 'completed'
       and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch)) into v_already;

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


create or replace function public.stage_branch_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit    integer := nullif(p_payload ->> 'limit', '')::integer;
  v_pend     record;
  v_loaded   integer;
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
  -- O que cada linha pode fazer depende das permissões de quem importa, não só
  -- de `branches.import`: criar, editar, vincular e cadastrar inativa têm dono.
  v_can_create := private.has_permission(p_organization_id, 'branches.create');
  v_can_update := private.has_permission(p_organization_id, 'branches.update');
  v_can_ops    := private.has_permission(p_organization_id, 'branches.manage_operations');
  v_can_deact  := private.has_permission(p_organization_id, 'branches.deactivate');

  -- Sem teto de linhas: o arquivo chega em partes. `phase` diz o que esta
  -- chamada faz — load (grava as linhas como pendentes), validate (valida
  -- as próximas `limit` pendentes, em ordem), finalize (fecha a prévia) ou
  -- all (tudo de uma vez, o comportamento original). Cada chamada termina
  -- bem dentro do tempo de uma requisição, qualquer que seja o tamanho do
  -- arquivo; a regra de cada linha é a mesma de antes.
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
    values
      (p_organization_id, 'branches', 'create_update', 'draft',
       left(coalesce(nullif(btrim(p_payload ->> 'file_name'), ''), 'filiais'), 300),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), v_uid, v_uid)
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'branches'
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if not found then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    -- Reenviar a mesma parte (uma resposta perdida no caminho) não duplica linha.
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch,
      'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;


  if v_phase in ('all', 'validate') then
    -- Repetições dentro do próprio arquivo: código, CNPJ e nome com códigos
    -- diferentes. Qualquer uma delas torna a identidade ambígua (§58, §59).
    -- Contadas uma vez, sobre o arquivo inteiro, antes da primeira linha ser
    -- validada; cada linha guarda as suas contagens até ser validada.
    if not exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      with src as (
        select x.id, x.normalized_data as d from public.import_rows x where x.batch_id = v_batch
      ), codes as (
        select private.normalize_code(s.d ->> 'code') as k, count(*) as n
          from src s where private.normalize_code(s.d ->> 'code') is not null group by 1
      ), docs as (
        select private.normalize_document(s.d ->> 'document_number') as k, count(*) as n
          from src s where private.normalize_document(s.d ->> 'document_number') is not null group by 1
      ), names as (
        select lower(btrim(s.d ->> 'name')) as k, count(distinct private.normalize_code(s.d ->> 'code')) as n
          from src s
         where nullif(btrim(coalesce(s.d ->> 'name', '')), '') is not null
           and private.normalize_code(s.d ->> 'code') is not null
         group by 1
      )
      update public.import_rows t
         set normalized_data = t.normalized_data || jsonb_build_object('_file_counts',
               jsonb_build_object('code', c.n, 'doc', dd.n, 'name', nm.n))
        from src s
        left join codes c on c.k = private.normalize_code(s.d ->> 'code')
        left join docs dd on dd.k = private.normalize_document(nullif(btrim(coalesce(s.d ->> 'document_number', '')), ''))
        left join names nm on nm.k = lower(nullif(btrim(coalesce(s.d ->> 'name', '')), ''))
       where t.id = s.id;
    end if;

  for v_pend in
    select x.id, x.row_number, x.normalized_data from public.import_rows x
     where x.batch_id = v_batch and x.status = 'pending'
     order by x.row_number
     limit greatest(coalesce(v_limit, 2147483647), 1)
  loop
    r := v_pend.normalized_data;
    v_row_no := v_pend.row_number;
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
        if coalesce((r -> '_file_counts' ->> 'code')::integer, 0) > 1 then
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
        if coalesce((r -> '_file_counts' ->> 'name')::integer, 0) > 1 then
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
          if coalesce((r -> '_file_counts' ->> 'doc')::integer, 0) > 1 then
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

    update public.import_rows
       set normalized_data = v_norm, status = v_status, action = v_action
     where id = v_pend.id;

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
  if v_phase = 'validate' then
    return jsonb_build_object('batch_id', v_batch,
      'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
  end if;
  end if;

  -- Fechamento: os números saem das linhas gravadas, não de contadores
  -- desta chamada, porque a validação pode ter vindo em várias.
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  select count(*)::integer,
         count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer,
         count(*) filter (where x.status = 'error')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'create')::integer,
         count(*) filter (where x.status <> 'error' and x.action = 'update')::integer,
         count(*) filter (where x.status <> 'error' and x.action not in ('create', 'update'))::integer
    into n_total, n_valid, n_warn, n_err, n_create, n_update, n_skip
    from public.import_rows x where x.batch_id = v_batch;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'branches' and b.status = 'completed'
       and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch)) into v_already;

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


create or replace function public.stage_adherence_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_phase    text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_limit    integer := nullif(p_payload ->> 'limit', '')::integer;
  v_pend     record;
  v_loaded   integer;
  v_batch uuid;
  v_today date := private.adherence_today(p_organization_id);
  r jsonb;
  v_rownum int; v_fleet text; v_plate text; v_date date; v_ctx text; v_status_raw text; v_code text;
  v_just text; v_evid text; v_vehicle uuid;
  v_obl record; v_reason record;
  v_level text; v_action text; v_msg text; v_field text; v_errcode text;
  n_total int := 0; n_valid int := 0; n_warn int := 0; n_err int := 0;
  v_norm jsonb;
  v_already boolean;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;
  -- Sem teto de linhas: o arquivo chega em partes. `phase` diz o que esta
  -- chamada faz — load (grava as linhas como pendentes), validate (valida
  -- as próximas `limit` pendentes, em ordem), finalize (fecha a prévia) ou
  -- all (tudo de uma vez, o comportamento original). Cada chamada termina
  -- bem dentro do tempo de uma requisição, qualquer que seja o tamanho do
  -- arquivo; a regra de cada linha é a mesma de antes.
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, created_by, updated_by)
    values
      (p_organization_id, 'adherence', 'create', 'draft',
       coalesce(nullif(p_payload ->> 'file_name', ''), 'aderencia'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    perform 1 from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id and b.type = 'adherence'
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if not found then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    -- Reenviar a mesma parte (uma resposta perdida no caminho) não duplica linha.
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch,
      'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;


  if v_phase in ('all', 'validate') then
  for v_pend in
    select x.id, x.row_number, x.normalized_data from public.import_rows x
     where x.batch_id = v_batch and x.status = 'pending'
     order by x.row_number
     limit greatest(coalesce(v_limit, 2147483647), 1)
  loop
    r := v_pend.normalized_data;
    v_rownum := v_pend.row_number;
    v_fleet := nullif(btrim(coalesce(r ->> 'fleet_code', '')), '');
    v_plate := private.normalize_plate(nullif(btrim(coalesce(r ->> 'license_plate', '')), ''));
    v_ctx := lower(btrim(coalesce(r ->> 'context', '')));
    v_ctx := case when v_ctx in ('retorno', 'r', 'volta') then 'retorno'
                  when v_ctx in ('', 'saida', 'saída', 's', 'ida') then 'saida' else v_ctx end;
    v_status_raw := nullif(btrim(coalesce(r ->> 'status', '')), '');
    v_code := private.adherence_import_reason_code(v_status_raw);
    v_just := nullif(btrim(coalesce(r ->> 'justification', '')), '');
    v_evid := nullif(btrim(coalesce(r ->> 'evidence_reference', '')), '');
    begin
      v_date := nullif(btrim(coalesce(r ->> 'operational_date', '')), '')::date;
    exception when others then
      v_date := null;
    end;

    v_vehicle := null; v_level := 'valid'; v_action := 'create'; v_msg := null; v_field := null; v_errcode := null;

    if v_fleet is not null then
      select v.id into v_vehicle from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null and upper(v.fleet_code) = upper(v_fleet) limit 1;
    end if;
    if v_vehicle is null and v_plate is not null then
      select v.id into v_vehicle from public.vehicles v
       where v.organization_id = p_organization_id and v.deleted_at is null and private.normalize_plate(v.license_plate) = v_plate limit 1;
    end if;

    select s.* into v_obl from public.adherence_obligation_status s
     where v_vehicle is not null and v_date is not null and v_ctx in ('saida', 'retorno')
       and s.organization_id = p_organization_id and s.vehicle_id = v_vehicle
       and s.operational_date = v_date and s.checklist_context = v_ctx;

    if v_vehicle is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'fleet_code'; v_errcode := 'import_unknown_vehicle';
      v_msg := 'Veiculo nao encontrado pela frota nem pela placa. A importacao nao cria veiculos.';
    elsif v_date is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'invalid_date';
      v_msg := 'Data operacional ausente ou invalida.';
    elsif v_date > v_today then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'future_date';
      v_msg := 'Data futura: nao ha descumprimento a justificar.';
    elsif v_ctx not in ('saida', 'retorno') then
      v_level := 'error'; v_action := 'skip'; v_field := 'context'; v_errcode := 'invalid_context';
      v_msg := 'Contexto deve ser saida ou retorno.';
    elsif v_code is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'import_unknown_status';
      v_msg := format('Status "%s" desconhecido. Nada e aprovado automaticamente; a linha vira inconsistencia.', coalesce(v_status_raw, ''));
    elsif v_obl.id is null then
      v_level := 'error'; v_action := 'skip'; v_field := 'operational_date'; v_errcode := 'no_obligation';
      v_msg := 'Nao ha obrigacao para este veiculo, data e contexto. Reconcilie o periodo antes; a importacao nao cria obrigacoes.';
    elsif v_code = 'NAO_FEZ' then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'no_change';
      v_msg := format('Status atual no HFM: %s. "Nao fez" e o padrao do motor; nada a gravar.', v_obl.status_code);
    elsif v_obl.is_done then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_done';
      v_msg := format('A obrigacao ja possui checklist valido no HFM. Valor recebido (%s) nao sobrescreve a execucao oficial.', coalesce(v_status_raw, ''));
    elsif v_obl.is_excluded then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'already_excluded';
      v_msg := format('A obrigacao ja possui expurgo aprovado (%s). Valor recebido: %s.', v_obl.status_code, coalesce(v_status_raw, ''));
    elsif v_obl.has_pending_request then
      v_level := 'warning'; v_action := 'skip'; v_errcode := 'pending_conflict';
      v_msg := format('Ja existe solicitacao pendente para esta obrigacao. Valor recebido: %s.', coalesce(v_status_raw, ''));
    else
      select x.* into v_reason from public.adherence_exclusion_reasons x
       where x.organization_id = p_organization_id and x.code = v_code and x.is_active;
      if v_reason.id is null then
        v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'reason_inactive';
        v_msg := format('Motivo %s inativo nesta organizacao.', v_code);
      elsif (v_ctx = 'saida' and not v_reason.applies_to_departure) or (v_ctx = 'retorno' and not v_reason.applies_to_return) then
        v_level := 'error'; v_action := 'skip'; v_field := 'status'; v_errcode := 'reason_context';
        v_msg := format('Motivo %s nao se aplica ao contexto %s.', v_code, v_ctx);
      elsif v_reason.requires_evidence and v_evid is null then
        v_level := 'error'; v_action := 'skip'; v_field := 'evidence_reference'; v_errcode := 'evidence_required';
        v_msg := format('Motivo %s exige referencia de evidencia (OS, chamado, documento).', v_code);
      end if;
    end if;

    v_norm := jsonb_build_object(
      'fleet_code', v_fleet, 'license_plate', v_plate, 'operational_date', v_date,
      'context', case when v_ctx in ('saida', 'retorno') then v_ctx end,
      'status_raw', v_status_raw, 'reason_code', case when v_code = 'NAO_FEZ' then null else v_code end,
      'justification', v_just, 'evidence_reference', v_evid,
      'obligation_id', v_obl.id, 'current_status', v_obl.status_code, 'code', v_errcode);

    update public.import_rows
       set normalized_data = v_norm, status = v_level, action = v_action, vehicle_id = v_vehicle
     where id = v_pend.id;

    if v_msg is not null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, v_batch, v_rownum, v_level, v_field, v_errcode, v_msg);
    end if;

    if v_level = 'valid' then n_valid := n_valid + 1;
    elsif v_level = 'warning' then n_warn := n_warn + 1;
    else n_err := n_err + 1; end if;
  end loop;
  if v_phase = 'validate' then
    return jsonb_build_object('batch_id', v_batch,
      'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
  end if;
  end if;

  -- Fechamento: os números saem das linhas gravadas, não de contadores
  -- desta chamada, porque a validação pode ter vindo em várias.
  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  select count(*)::integer,
         count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer,
         count(*) filter (where x.status = 'error')::integer
    into n_total, n_valid, n_warn, n_err
    from public.import_rows x where x.batch_id = v_batch;

  select exists (
    select 1 from public.import_batches b
     where b.organization_id = p_organization_id and b.type = 'adherence' and b.status = 'completed'
       and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch)) into v_already;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         created_rows = 0, updated_rows = 0, skipped_rows = n_warn + n_err,
         summary = jsonb_build_object('requests_to_create', n_valid, 'already_imported', v_already),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch, 'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn,
    'error_rows', n_err, 'create_rows', n_valid, 'already_imported', v_already,
    'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field, 'code', e.code, 'message', e.message) order by e.level, e.row_number)
                   from (select * from public.import_errors x where x.batch_id = v_batch order by x.level, x.row_number limit 300) e), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', i.row_number, 'status', i.status, 'action', i.action, 'data', i.normalized_data) order by i.row_number)
                 from (select * from public.import_rows x where x.batch_id = v_batch order by x.row_number limit 12) i), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Validação em partes: Frota e Usuários (as linhas chegam pela API)
-- -----------------------------------------------------------------------------

drop function if exists public.validate_vehicle_import(uuid);

create function public.validate_vehicle_import(p_batch_id uuid, p_limit integer default null)
returns table (
  total_rows   integer,
  valid_rows   integer,
  warning_rows integer,
  error_rows   integer,
  create_rows  integer,
  update_rows  integer,
  pending_rows integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_mode  text;
  r       record;
  d       jsonb;
  v_status text;
  v_action text;

  v_plate  text;
  v_code   text;
  v_vin    text;
  v_renavam text;

  v_by_plate uuid;
  v_by_code  uuid;
  v_by_vin   uuid;
  v_by_ren   uuid;
  v_target   uuid;

  v_type_id uuid;
  v_sub_id  uuid;
  v_make_id uuid;
  v_model_id uuid;
  v_op_id   uuid;
  v_state_id smallint;
  v_city_id integer;
  v_unit_id uuid;
  v_cc_id   uuid;
  v_op_matches integer;

  v_cur_op  uuid;
  v_cur_city integer;
  v_cur_km  integer;
  v_issue   jsonb;
begin
  select organization_id, mode into v_org, v_mode
    from public.import_batches where id = p_batch_id and type = 'vehicles';
  if v_org is null then
    raise exception 'Lote de importação não encontrado.' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'vehicles.import') then
    raise exception 'Você não possui permissão para importar frotas.' using errcode = 'insufficient_privilege';
  end if;

  -- Sem p_limit: revalida o lote inteiro, como antes. Com p_limit: só as
  -- próximas linhas ainda pendentes, que por definição não têm apontamento.
  if p_limit is null then
    delete from public.import_errors where batch_id = p_batch_id;
  end if;

  for r in
    select id, row_number, normalized_data from public.import_rows
     where batch_id = p_batch_id and (p_limit is null or status = 'pending')
     order by row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    d := r.normalized_data;
    v_status := 'valid';
    v_action := 'create';
    v_target := null;

    -- 0. o que o parser já reprovou
    for v_issue in select * from jsonb_array_elements(coalesce(d -> 'parse_errors', '[]'::jsonb))
    loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number,
              coalesce(v_issue ->> 'level', 'error'), v_issue ->> 'field',
              coalesce(v_issue ->> 'code', 'parse'), coalesce(v_issue ->> 'message', 'Valor inválido.'));
      if coalesce(v_issue ->> 'level', 'error') = 'error' then v_status := 'error'; end if;
    end loop;

    v_code    := private.normalize_code(nullif(d ->> 'fleet_code', ''));
    v_plate   := private.normalize_plate(d ->> 'license_plate');
    v_vin     := private.normalize_plate(d ->> 'vin');
    v_renavam := private.normalize_renavam(d ->> 'renavam');

    -- 1. identificação mínima
    if v_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'required', 'Informe o código da frota.');
      v_status := 'error';
    end if;
    if v_plate is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'required', 'Informe a placa.');
      v_status := 'error';
    elsif v_plate !~ '^[A-Z0-9]{5,10}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'format',
              format('Placa %s não tem um formato reconhecido.', d ->> 'license_plate'));
      v_status := 'error';
    end if;
    if v_vin is not null and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'format', 'Chassi deve ter 17 caracteres válidos.');
      v_status := 'error';
    end if;
    if v_renavam is not null and v_renavam !~ '^[0-9]{11}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'format', 'RENAVAM deve ter 11 dígitos.');
      v_status := 'error';
    end if;

    -- 2. duplicidade dentro da própria planilha
    if v_plate is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_plate(o.normalized_data ->> 'license_plate') = v_plate
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'duplicate_in_file',
              format('A placa %s aparece mais de uma vez no arquivo.', v_plate));
      v_status := 'error';
    end if;
    if v_code is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_code(o.normalized_data ->> 'fleet_code') = v_code
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'duplicate_in_file',
              format('O código de frota %s aparece mais de uma vez no arquivo.', v_code));
      v_status := 'error';
    end if;

    -- Chassi e RENAVAM identificam o veículo tanto quanto a placa, e o banco
    -- tem índice único para os dois. Conferir só placa e código aqui deixava a
    -- duplicidade passar pela validação e estourar lá na gravação, que é
    -- exatamente o que a área de staging existe para evitar.
    if v_vin is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_plate(o.normalized_data ->> 'vin') = v_vin
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'duplicate_in_file',
              format('O chassi %s aparece mais de uma vez no arquivo.', v_vin));
      v_status := 'error';
    end if;
    if v_renavam is not null and exists (
      select 1 from public.import_rows o
       where o.batch_id = p_batch_id and o.row_number < r.row_number
         and private.normalize_renavam(o.normalized_data ->> 'renavam') = v_renavam
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'duplicate_in_file',
              format('O RENAVAM %s aparece mais de uma vez no arquivo.', v_renavam));
      v_status := 'error';
    end if;

    -- 3. correspondência com a base: regra explícita, nunca aproximação
    v_by_plate := null; v_by_code := null; v_by_vin := null; v_by_ren := null;
    if v_plate is not null then
      select id into v_by_plate from public.vehicles
       where organization_id = v_org and license_plate = v_plate and deleted_at is null;
    end if;
    if v_code is not null then
      select id into v_by_code from public.vehicles
       where organization_id = v_org and fleet_code = v_code and deleted_at is null;
    end if;
    if v_vin is not null then
      select id into v_by_vin from public.vehicles
       where organization_id = v_org and vin = v_vin and deleted_at is null;
    end if;
    if v_renavam is not null then
      select id into v_by_ren from public.vehicles
       where organization_id = v_org and renavam = v_renavam and deleted_at is null;
    end if;

    if v_by_plate is not null and v_by_code is not null and v_by_plate <> v_by_code then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'identity_conflict',
              'A placa e o código de frota desta linha pertencem a veículos diferentes. Corrija a identidade antes de importar.');
      v_status := 'error';
    elsif v_by_plate is not null and v_by_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'fleet_code', 'identity_change',
              'Esta placa já está cadastrada com outro código de frota. Trocar a identidade exige o fluxo de correção cadastral.');
      v_status := 'error';
    elsif v_by_code is not null and v_by_plate is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'license_plate', 'identity_change',
              'Este código de frota já está cadastrado com outra placa. Trocar a identidade exige o fluxo de correção cadastral.');
      v_status := 'error';
    else
      v_target := coalesce(v_by_plate, v_by_code);
    end if;

    if v_by_vin is not null and v_target is distinct from v_by_vin then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'vin', 'duplicate', 'Este chassi já pertence a outro veículo.');
      v_status := 'error';
    end if;
    if v_by_ren is not null and v_target is distinct from v_by_ren then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'renavam', 'duplicate', 'Este RENAVAM já pertence a outro veículo.');
      v_status := 'error';
    end if;

    v_action := case when v_target is null then 'create' else 'update' end;

    -- 4. classificação
    v_type_id := null; v_sub_id := null; v_make_id := null; v_model_id := null;
    if nullif(d ->> 'type_name', '') is not null then
      select id into v_type_id from public.vehicle_types
       where private.normalize_label(name) = private.normalize_label(d ->> 'type_name')
          or private.normalize_label(code) = private.normalize_label(d ->> 'type_name')
       limit 1;
      if v_type_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'unknown',
                format('Tipo de equipamento "%s" não existe no catálogo.', d ->> 'type_name'));
        v_status := 'error';
      end if;

      -- Um tipo inativo continua classificando quem já classificava, mas não
      -- entra em cadastro novo. A regra existia só na gravação: a validação
      -- aprovava as 95 linhas e o lote inteiro estourava no primeiro veículo
      -- do tipo desligado, sem dizer qual linha.
      if v_type_id is not null and v_action = 'create' and not exists (
        select 1
          from public.vehicle_types t
          left join public.vehicle_type_settings s
                 on s.vehicle_type_id = t.id and s.organization_id = v_org
         where t.id = v_type_id and t.is_active and coalesce(s.is_enabled, true)
      ) then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'inactive',
                format('O tipo de equipamento "%s" está inativo e não pode ser usado em cadastros novos.',
                       d ->> 'type_name'));
        v_status := 'error';
      end if;
    elsif v_action = 'create' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'type_name', 'required', 'Informe o tipo de equipamento.');
      v_status := 'error';
    end if;

    if nullif(d ->> 'subcategory_name', '') is not null and v_type_id is not null then
      select id into v_sub_id from public.vehicle_subcategories
       where vehicle_type_id = v_type_id
         and (organization_id is null or organization_id = v_org)
         and private.normalize_label(name) = private.normalize_label(d ->> 'subcategory_name')
       order by (organization_id is not null) desc
       limit 1;
      if v_sub_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'subcategory_name', 'unknown',
                format('Subcategoria "%s" não pertence ao tipo informado e foi ignorada.', d ->> 'subcategory_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- Subcategoria obrigatória é regra explícita da organização e vale para o
    -- cadastro novo. Mesma história: só era vista na hora de gravar.
    if v_type_id is not null and v_action = 'create' and v_sub_id is null
       and coalesce((select s.requires_subcategory
                       from public.vehicle_type_settings s
                      where s.organization_id = v_org and s.vehicle_type_id = v_type_id), false) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'subcategory_name', 'required',
              format('O tipo "%s" exige subcategoria.', d ->> 'type_name'));
      v_status := 'error';
    end if;

    if nullif(d ->> 'make_name', '') is not null then
      select id into v_make_id from public.vehicle_makes
       where organization_id = v_org and private.normalize_label(name) = private.normalize_label(d ->> 'make_name')
       limit 1;
    end if;
    if nullif(d ->> 'model_name', '') is not null then
      select m.id into v_model_id from public.vehicle_models m
       where m.organization_id = v_org
         and private.normalize_label(m.name) = private.normalize_label(d ->> 'model_name')
         and (v_make_id is null or m.vehicle_make_id = v_make_id)
       limit 1;
      if v_model_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'model_name', 'unknown',
                format('Modelo "%s" não está no cadastro mestre e foi ignorado. Cadastre-o para vinculá-lo.', d ->> 'model_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 5. filial e centro de custo
    v_unit_id := null; v_cc_id := null;
    if nullif(d ->> 'unit_name', '') is not null then
      select id into v_unit_id from public.organization_units
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'unit_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'unit_name'))
       limit 1;
      if v_unit_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'unit_name', 'unknown',
                format('Filial "%s" não existe e foi ignorada.', d ->> 'unit_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;
    if nullif(d ->> 'cost_center_name', '') is not null then
      select id into v_cc_id from public.cost_centers
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'cost_center_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'cost_center_name'))
       limit 1;
      if v_cc_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'cost_center_name', 'unknown',
                format('Centro de custo "%s" não existe e foi ignorado.', d ->> 'cost_center_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 6. operação, estado e cidade
    v_op_id := null; v_state_id := null; v_city_id := null;
    if nullif(d ->> 'operation_name', '') is not null then
      select count(*) into v_op_matches
        from public.operations
       where organization_id = v_org and deleted_at is null
         and (private.normalize_label(name) = private.normalize_label(d ->> 'operation_name')
              or private.normalize_code(code) = private.normalize_code(d ->> 'operation_name'));
      if v_op_matches = 1 then
        select id into v_op_id
          from public.operations
         where organization_id = v_org and deleted_at is null
           and (private.normalize_label(name) = private.normalize_label(d ->> 'operation_name')
                or private.normalize_code(code) = private.normalize_code(d ->> 'operation_name'))
         limit 1;
      elsif v_op_matches = 0 then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'operation_name', 'unknown',
                format('Operação "%s" não existe. Operações não são criadas por importação.', d ->> 'operation_name'));
        v_status := 'error';
      else
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'operation_name', 'ambiguous',
                format('"%s" corresponde a mais de uma operação. Resolva a ambiguidade no arquivo.', d ->> 'operation_name'));
        v_status := 'error';
      end if;
    end if;

    if v_op_id is not null and nullif(d ->> 'city_name', '') is not null then
      select c.id, c.state_id into v_city_id, v_state_id
        from public.operation_cities oc
        join public.cities c on c.id = oc.city_id
        join public.states s on s.id = c.state_id
       where oc.organization_id = v_org and oc.operation_id = v_op_id
         and private.normalize_label(c.name) = private.normalize_label(d ->> 'city_name')
         and (nullif(d ->> 'state_uf', '') is null or s.uf = upper(d ->> 'state_uf'))
       limit 1;
      if v_city_id is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'error', 'city_name', 'not_covered',
                format('A cidade "%s" não faz parte da cobertura da operação "%s".',
                       d ->> 'city_name', d ->> 'operation_name'));
        v_status := 'error';
      end if;
    elsif v_op_id is not null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, r.row_number, 'error', 'city_name', 'required',
              'Informe a cidade para alocar o veículo na operação.');
      v_status := 'error';
    end if;

    -- 7. o que a importação NÃO vai fazer num veículo existente
    if v_target is not null then
      v_cur_op   := null;
      v_cur_city := null;
      v_cur_km   := null;
      select a.operation_id, a.city_id into v_cur_op, v_cur_city
        from public.vehicle_operation_assignments a
       where a.vehicle_id = v_target
         and a.effective_from <= current_date
         and (a.effective_to is null or a.effective_to >= current_date)
       order by a.effective_from desc limit 1;

      if v_op_id is not null and (v_cur_op is distinct from v_op_id or v_cur_city is distinct from v_city_id) then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'operation_name', 'assignment_divergence',
                format('O arquivo indica %s/%s, diferente da alocação vigente. A alocação NÃO foi alterada: use a transferência, que tem data de vigência.',
                       d ->> 'operation_name', d ->> 'city_name'));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;

      select o.odometer_km into v_cur_km
        from public.vehicle_odometer_readings o
       where o.vehicle_id = v_target and o.superseded_by is null
       order by o.reading_date desc, o.created_at desc limit 1;

      if nullif(d ->> 'odometer_km', '') is not null
         and v_cur_km is distinct from (d ->> 'odometer_km')::integer then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, r.row_number, 'warning', 'odometer_km', 'odometer_divergence',
                format('O arquivo informa %s km e a leitura homologada é %s km. A leitura NÃO foi alterada: use a correção de quilometragem.',
                       d ->> 'odometer_km', coalesce(v_cur_km::text, 'ausente')));
        if v_status = 'valid' then v_status := 'warning'; end if;
      end if;
    end if;

    -- 8. modo do lote
    if v_status <> 'error' then
      if v_mode = 'validate' then
        v_action := 'skip';
      elsif v_mode = 'create' and v_action = 'update' then
        v_action := 'skip';
      end if;
    else
      v_action := 'skip';
    end if;

    update public.import_rows
       set status = v_status,
           action = v_action,
           vehicle_id = v_target,
           normalized_data = d
             || (jsonb_build_object(
                  'resolved_fleet_code',     v_code,
                  'resolved_license_plate',  v_plate,
                  'resolved_vin',            v_vin,
                  'resolved_renavam',        v_renavam,
                  'resolved_type_id',        v_type_id,
                  'resolved_subcategory_id', v_sub_id,
                  'resolved_model_id',       v_model_id,
                  'resolved_unit_id',        v_unit_id,
                  'resolved_cost_center_id', v_cc_id,
                  'resolved_operation_id',   v_op_id,
                  'resolved_state_id',       v_state_id,
                  'resolved_city_id',        v_city_id))
     where id = r.id;
  end loop;

  -- Em partes (p_limit), o lote só fecha quando não sobra linha pendente.
  if exists (select 1 from public.import_rows x where x.batch_id = p_batch_id and x.status = 'pending') then
    return query select 0, 0, 0, 0, 0, 0,
      (select count(*)::integer from public.import_rows x where x.batch_id = p_batch_id and x.status = 'pending');
    return;
  end if;

  update public.import_batches b
     set status = 'validated',
         total_rows   = c.total,
         valid_rows   = c.valid,
         warning_rows = c.warning,
         error_rows   = c.error
    from (
      select count(*) as total,
             count(*) filter (where status = 'valid')   as valid,
             count(*) filter (where status = 'warning') as warning,
             count(*) filter (where status = 'error')   as error
        from public.import_rows where batch_id = p_batch_id
    ) c
   where b.id = p_batch_id;

  return query
    select b.total_rows, b.valid_rows, b.warning_rows, b.error_rows,
           (select count(*)::integer from public.import_rows where batch_id = p_batch_id and action = 'create'),
           (select count(*)::integer from public.import_rows where batch_id = p_batch_id and action = 'update'),
           0
      from public.import_batches b where b.id = p_batch_id;
end;
$$;

drop function if exists public.validate_employee_import(uuid);

create function public.validate_employee_import(p_batch_id uuid, p_limit integer default null)
returns table (
  total_rows   integer,
  valid_rows   integer,
  warning_rows integer,
  error_rows   integer,
  create_rows  integer,
  update_rows  integer,
  pending_rows integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_row      record;
  v_data     jsonb;
  v_code     text;
  v_email    text;
  v_cpf      text;
  v_errors   integer;
  v_warns    integer;
  v_employee uuid;
  v_msg      jsonb;
  v_finding  record;
begin
  select b.organization_id into v_org from public.import_batches b where b.id = p_batch_id;
  if v_org is null then
    raise exception 'import batch not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.import') then
    raise exception 'permission users.import is required' using errcode = 'insufficient_privilege';
  end if;

  -- Sem p_limit: revalida o lote inteiro, como antes. Com p_limit: só as
  -- próximas linhas ainda pendentes, que por definição não têm apontamento.
  if p_limit is null then
    delete from public.import_errors where batch_id = p_batch_id;
  end if;

  for v_row in
    select r.id, r.row_number, r.normalized_data
      from public.import_rows r
     where r.batch_id = p_batch_id and (p_limit is null or r.status = 'pending')
     order by r.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    v_data   := v_row.normalized_data;
    v_errors := 0;
    v_warns  := 0;
    v_code   := nullif(btrim(coalesce(v_data ->> 'employee_code', '')), '');
    v_email  := nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), '');
    v_cpf    := nullif(regexp_replace(coalesce(v_data ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
    v_employee := null;

    if v_code is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'employee_code', 'missing_code', 'Matrícula não informada.');
      v_errors := v_errors + 1;
    end if;

    if nullif(btrim(coalesce(v_data ->> 'full_name', '')), '') is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'full_name', 'missing_name', 'Nome não informado.');
      v_errors := v_errors + 1;
    end if;

    if v_code is not null and exists (
      select 1 from public.import_rows r2
       where r2.batch_id = p_batch_id and r2.id <> v_row.id
         and upper(btrim(coalesce(r2.normalized_data ->> 'employee_code', ''))) = upper(v_code)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'employee_code', 'duplicate_code_in_file',
              'Matrícula repetida dentro do arquivo.');
      v_errors := v_errors + 1;
    end if;

    if v_cpf is not null and exists (
      select 1 from public.import_rows r2
       where r2.batch_id = p_batch_id and r2.id <> v_row.id
         and regexp_replace(coalesce(r2.normalized_data ->> 'cpf', ''), '[^0-9]', '', 'g') = v_cpf
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'duplicate_cpf_in_file',
              'CPF repetido dentro do arquivo.');
      v_errors := v_errors + 1;
    end if;

    if v_cpf is not null and not private.is_valid_cpf(v_cpf) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'invalid_cpf', 'CPF inválido.');
      v_errors := v_errors + 1;
    end if;

    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'corporate_email', 'invalid_email', 'E-mail inválido.');
      v_errors := v_errors + 1;
    end if;

    -- dates the application parsed but the domain rejects
    for v_finding in select * from private.import_date_findings(v_data) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, v_finding.level, v_finding.field, v_finding.code, v_finding.message);
      if v_finding.level = 'error' then v_errors := v_errors + 1; else v_warns := v_warns + 1; end if;
    end loop;

    for v_msg in select * from jsonb_array_elements(coalesce(v_data -> 'parse_errors', '[]'::jsonb)) loop
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number,
              coalesce(v_msg ->> 'level', 'error'), v_msg ->> 'field',
              coalesce(v_msg ->> 'code', 'parse_error'), v_msg ->> 'message');
      if coalesce(v_msg ->> 'level', 'error') = 'error' then v_errors := v_errors + 1;
      else v_warns := v_warns + 1; end if;
    end loop;

    if v_code is not null then
      select e.id into v_employee
        from public.employees e
       where e.organization_id = v_org and upper(e.employee_code) = upper(v_code) and e.deleted_at is null;
    end if;

    if v_cpf is not null and exists (
      select 1 from public.employee_private_data p
       where p.organization_id = v_org and p.cpf = v_cpf
         and (v_employee is null or p.employee_id <> v_employee)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'cpf', 'cpf_other_employee',
              'CPF já cadastrado para outra matrícula.');
      v_errors := v_errors + 1;
    end if;

    if v_email is not null and exists (
      select 1 from public.employees e
       where e.organization_id = v_org and e.corporate_email = v_email and e.deleted_at is null
         and (v_employee is null or e.id <> v_employee)
    ) then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'error', 'corporate_email', 'email_other_employee',
              'E-mail já cadastrado para outra matrícula.');
      v_errors := v_errors + 1;
    end if;

    if nullif(btrim(coalesce(v_data ->> 'manager_name', '')), '') is not null
       and not exists (
         select 1 from public.employees e
          where e.organization_id = v_org and e.deleted_at is null
            and private.normalize_label(e.full_name) = private.normalize_label(v_data ->> 'manager_name')
       )
       and not exists (
         select 1 from public.import_rows r3
          where r3.batch_id = p_batch_id
            and private.normalize_label(r3.normalized_data ->> 'full_name')
              = private.normalize_label(v_data ->> 'manager_name')
       )
    then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'manager_name', 'manager_not_found',
              format('Líder "%s" não encontrado; o vínculo ficará sem líder.', v_data ->> 'manager_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'license_category', '') is not null
       and (v_data ->> 'license_category') !~ '^[A-E]{1,3}$' then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'license_category', 'invalid_license_category',
              'Categoria de CNH não reconhecida; a CNH será ignorada.');
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'operation_name', '') is not null
       and private.resolve_master_data(v_org, 'operation', null, v_data ->> 'operation_name', false) is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'operation_name', 'new_operation',
              format('Operação "%s" será criada.', v_data ->> 'operation_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'work_location_name', '') is not null
       and private.resolve_master_data(v_org, 'work_location', null, v_data ->> 'work_location_name', false) is null then
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (v_org, p_batch_id, v_row.row_number, 'warning', 'work_location_name', 'new_work_location',
              format('Localidade "%s" será criada.', v_data ->> 'work_location_name'));
      v_warns := v_warns + 1;
    end if;

    if nullif(v_data ->> 'unit_code', '') is not null or nullif(v_data ->> 'unit_name', '') is not null then
      if private.resolve_master_data(v_org, 'organization_unit', v_data ->> 'unit_code', v_data ->> 'unit_name', false) is null then
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (v_org, p_batch_id, v_row.row_number, 'warning', 'unit_name', 'new_unit',
                format('Filial "%s" será criada.', coalesce(v_data ->> 'unit_name', v_data ->> 'unit_code')));
        v_warns := v_warns + 1;
      end if;
    end if;

    update public.import_rows
       set status = case when v_errors > 0 then 'error'
                         when v_warns > 0 then 'warning'
                         else 'valid' end,
           action = case when v_errors > 0 then 'skip'
                         when v_employee is null then 'create'
                         else 'update' end,
           employee_id = v_employee
     where id = v_row.id;
  end loop;

  -- Em partes (p_limit), o lote só fecha quando não sobra linha pendente.
  if exists (select 1 from public.import_rows x where x.batch_id = p_batch_id and x.status = 'pending') then
    return query select 0, 0, 0, 0, 0, 0,
      (select count(*)::integer from public.import_rows x where x.batch_id = p_batch_id and x.status = 'pending');
    return;
  end if;

  update public.import_batches b set
    status       = 'validated',
    total_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id),
    valid_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'valid'),
    warning_rows = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'warning'),
    error_rows   = (select count(*) from public.import_rows r where r.batch_id = p_batch_id and r.status = 'error')
  where b.id = p_batch_id;

  return query
    select b.total_rows, b.valid_rows, b.warning_rows, b.error_rows,
           (select count(*)::integer from public.import_rows r where r.batch_id = p_batch_id and r.action = 'create'),
           (select count(*)::integer from public.import_rows r where r.batch_id = p_batch_id and r.action = 'update'),
           0
      from public.import_batches b where b.id = p_batch_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gravação em partes. Cada process_* aceita p_limit: grava as próximas
-- p_limit linhas ainda não gravadas e devolve quantas faltam; a última
-- chamada fecha o lote com os números lidos das próprias linhas. Sem
-- p_limit, faz tudo numa chamada, como antes. Um lote em `processing` pode
-- ser retomado de onde parou: o que já foi gravado não é gravado de novo,
-- porque a linha gravada deixa de estar em 'valid'/'warning'.
-- -----------------------------------------------------------------------------

drop function if exists public.process_br_import(uuid, uuid);
create function public.process_br_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   public.import_batches;
  x         record;
  v_id      uuid;
  v_left    integer;
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
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  end if;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
            limit greatest(coalesce(p_limit, 2147483647), 1)
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
      elsif x.action = 'update' then
        perform public.save_operation_br(p_organization_id, jsonb_build_object(
          'id', x.d ->> 'br_id', 'operation_city_id', x.d ->> 'operation_city_id', 'code', x.d ->> 'code',
          'description', x.d ->> 'description', 'notes', x.d ->> 'notes'));
        update public.import_rows set status = 'updated' where id = x.id;
      else
        update public.import_rows set status = 'skipped' where id = x.id;
      end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
    end;
  end loop;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left);
  end if;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';
  select count(*) filter (where r.status = 'created')::integer,
         count(*) filter (where r.status = 'updated')::integer,
         count(*) filter (where r.status in ('skipped', 'failed'))::integer
    into n_created, n_updated, n_skipped
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created, updated_rows = n_updated,
         skipped_rows = n_skipped, updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;

  return jsonb_build_object('done', true, 'remaining', 0, 'created', n_created, 'updated', n_updated, 'skipped', n_skipped);
end;
$$;

comment on function public.process_br_import(uuid, uuid, integer) is
  'Etapa 13 §56: cria e atualiza BRs de um lote validado pelas rotinas oficiais (save_operation_br). Nunca altera a situação de uma BR existente. Em partes com p_limit (sem teto de linhas).';

drop function if exists public.process_fidelization_import(uuid, uuid);
create function public.process_fidelization_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
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
  v_left  integer;
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
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = auth.uid() where id = p_batch_id;
  end if;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
            limit greatest(coalesce(p_limit, 2147483647), 1)
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
      else
        update public.import_rows set status = 'skipped' where id = x.id;
      end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
    end;
  end loop;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left);
  end if;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';
  select count(*) filter (where r.status = 'created' and r.action = 'create')::integer,
         count(*) filter (where r.status = 'created' and r.action = 'substitute')::integer,
         count(*) filter (where r.status in ('skipped', 'failed'))::integer
    into n_created, n_sub, n_skipped
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created + n_sub,
         skipped_rows = n_skipped,
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('created', n_created, 'substituted', n_sub),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;

  return jsonb_build_object('done', true, 'remaining', 0, 'created', n_created, 'substituted', n_sub, 'skipped', n_skipped);
end;
$$;

comment on function public.process_fidelization_import(uuid, uuid, integer) is
  'Etapa 13 §57: grava os vínculos novos (source=import) e executa as substituições pela rotina oficial. Sobreposições ficam de fora. Em partes com p_limit (sem teto de linhas).';

drop function if exists public.process_branch_import(uuid, uuid);
create function public.process_branch_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
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
  v_left     integer;
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
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;
  -- A prévia confirmada é a que a própria pessoa viu.
  if v_batch.created_by is distinct from v_uid then
    raise exception 'Esta importação foi validada por outra pessoa. Valide o arquivo novamente para confirmar.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_batch.status = 'validated' then
    update public.import_batches set status = 'processing', updated_at = now(), updated_by = v_uid where id = p_batch_id;
  end if;

  for x in select r.id, r.row_number, r.action, r.normalized_data as d
             from public.import_rows r
            where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
            order by r.row_number
            limit greatest(coalesce(p_limit, 2147483647), 1)
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

      -- As operações vinculadas ficam na linha: o total do lote é a soma delas.
      update public.import_rows
         set status = case when x.action = 'create' then 'created' else 'updated' end,
             normalized_data = normalized_data || jsonb_build_object('operations_added', v_added)
       where id = x.id;
      if x.action = 'create' then n_created := n_created + 1; else n_updated := n_updated + 1; end if;
    exception when others then
      update public.import_rows set status = 'failed' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'error', null, 'process', sqlerrm);
      n_failed := n_failed + 1;
    end;
  end loop;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning');
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left);
  end if;

  update public.import_rows set status = 'skipped' where batch_id = p_batch_id and status = 'error';
  select count(*) filter (where r.status = 'created')::integer,
         count(*) filter (where r.status = 'updated')::integer,
         coalesce(sum(jsonb_array_length(coalesce(r.normalized_data -> 'operations_added', '[]'::jsonb)))
                    filter (where r.status in ('created', 'updated')), 0)::integer,
         count(*) filter (where r.status = 'failed')::integer
    into n_created, n_updated, n_links, n_failed
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created, updated_rows = n_updated,
         skipped_rows = (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
         summary = summary || jsonb_build_object('links_added', n_links, 'failed', n_failed),
         updated_at = now(), updated_by = v_uid
   where id = p_batch_id;

  return jsonb_build_object(
    'done', true, 'remaining', 0,
    'created', n_created, 'updated', n_updated, 'links_added', n_links, 'failed', n_failed,
    'skipped', (select count(*) from public.import_rows where batch_id = p_batch_id and status in ('skipped', 'failed')),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'message', e.message) order by e.row_number)
                          from public.import_errors e where e.batch_id = p_batch_id and e.code = 'process'), '[]'::jsonb));
end;
$$;

comment on function public.process_branch_import(uuid, uuid, integer) is
  'Etapa 09 §58–§62: cria e atualiza filiais de um lote validado pela própria pessoa, via save_branch. Só acrescenta vínculos operacionais; nunca desvincula, nunca muda situação, filial de colaborador ou veículo, nem perfis, roles, permissions ou escopos. Em partes com p_limit (sem teto de linhas).';

drop function if exists public.process_adherence_import(uuid, uuid);
create function public.process_adherence_import(p_organization_id uuid, p_batch_id uuid, p_limit integer default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch record;
  x record;
  v_reason uuid;
  v_run uuid;
  v_left int;
  n_created int := 0; n_skipped int := 0; n_inc int := 0;
begin
  if not private.has_permission(p_organization_id, 'adherence.import') then
    raise exception 'Você não possui permissão para importar aderência.' using errcode = 'insufficient_privilege';
  end if;

  select b.* into v_batch from public.import_batches b
   where b.id = p_batch_id and b.organization_id = p_organization_id and b.type = 'adherence' for update;
  if v_batch.id is null then
    raise exception 'Importação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_batch.status not in ('validated', 'processing') then
    raise exception 'Esta importação já foi processada ou ainda não foi validada.' using errcode = 'invalid_parameter_value';
  end if;

  if v_batch.status = 'validated' then
    insert into public.adherence_runs (organization_id, kind, reason, requested_by)
    values (p_organization_id, 'import', 'Importação ' || coalesce(v_batch.file_name, ''), auth.uid())
    returning id into v_run;
    -- A execução é uma só para o lote inteiro, mesmo gravado em partes.
    update public.import_batches
       set status = 'processing', summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('run_id', v_run),
           updated_at = now(), updated_by = auth.uid()
     where id = p_batch_id;
  else
    v_run := nullif(v_batch.summary ->> 'run_id', '')::uuid;
  end if;

  for x in
    select r.* from public.import_rows r
     where r.batch_id = p_batch_id and r.status = 'valid' and r.action = 'create'
     order by r.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    select rs.id into v_reason from public.adherence_exclusion_reasons rs
     where rs.organization_id = p_organization_id and rs.code = x.normalized_data ->> 'reason_code';
    begin
      -- O "solicitante" é o arquivo, não quem importou: fica sem requested_by
      -- para que a decisão continue segregada e possível (§32).
      insert into public.adherence_requests
        (organization_id, obligation_id, reason_id, checklist_context, justification, evidence_reference,
         source, requested_by, requested_employee_id, import_batch_id)
      values
        (p_organization_id, (x.normalized_data ->> 'obligation_id')::uuid, v_reason, x.normalized_data ->> 'context',
         coalesce(x.normalized_data ->> 'justification',
                  format('Importado de %s (linha %s). Status informado: %s.', coalesce(v_batch.file_name, 'arquivo'), x.row_number, coalesce(x.normalized_data ->> 'status_raw', ''))),
         x.normalized_data ->> 'evidence_reference', 'import', null, null, p_batch_id);
      update public.import_rows set status = 'created' where id = x.id;
    exception when unique_violation then
      update public.import_rows set status = 'skipped', action = 'skip' where id = x.id;
      insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
      values (p_organization_id, p_batch_id, x.row_number, 'warning', null, 'pending_conflict',
              'Ja existia solicitacao pendente no momento do processamento.');
    end;
  end loop;

  select count(*)::int into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status = 'valid' and r.action = 'create';
  if v_left > 0 then
    return jsonb_build_object('done', false, 'remaining', v_left, 'batch_id', p_batch_id);
  end if;

  select count(*) filter (where r.status = 'created')::int,
         count(*) filter (where r.status = 'skipped')::int
    into n_created, n_skipped
    from public.import_rows r where r.batch_id = p_batch_id;

  -- §21: o que não foi entendido vira inconsistência, nunca decisão.
  insert into public.adherence_inconsistencies (organization_id, kind, vehicle_id, operational_date, checklist_context, details)
  select p_organization_id,
         case when r.normalized_data ->> 'code' = 'import_unknown_vehicle' then 'import_unknown_vehicle' else 'import_unknown_status' end,
         r.vehicle_id,
         nullif(r.normalized_data ->> 'operational_date', '')::date,
         case when r.normalized_data ->> 'context' in ('saida', 'retorno') then r.normalized_data ->> 'context' end,
         jsonb_build_object('batch_id', p_batch_id, 'file_name', v_batch.file_name, 'row_number', r.row_number,
                            'status_raw', r.normalized_data ->> 'status_raw',
                            'fleet_code', r.normalized_data ->> 'fleet_code', 'license_plate', r.normalized_data ->> 'license_plate')
    from public.import_rows r
   where r.batch_id = p_batch_id and r.status = 'error'
     and r.normalized_data ->> 'code' in ('import_unknown_status', 'import_unknown_vehicle');
  get diagnostics n_inc = row_count;

  update public.import_batches
     set status = 'completed', processed_at = now(), created_rows = n_created,
         skipped_rows = n_skipped + (select count(*) from public.import_rows i where i.batch_id = p_batch_id and i.status in ('warning', 'error', 'skipped')),
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc),
         updated_at = now(), updated_by = auth.uid()
   where id = p_batch_id;
  update public.adherence_runs
     set status = 'completed', finished_at = now(),
         stats = jsonb_build_object('requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc, 'batch_id', p_batch_id)
   where id = v_run;

  return jsonb_build_object('done', true, 'remaining', 0, 'batch_id', p_batch_id,
    'requests_created', n_created, 'skipped', n_skipped, 'inconsistencies', n_inc);
end;
$$;

drop function if exists public.process_vehicle_import(uuid);
create function public.process_vehicle_import(p_batch_id uuid, p_limit integer default null)
returns table (created_rows integer, updated_rows integer, skipped_rows integer, remaining_rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_left integer;
  r record;
  d jsonb;
  v_id uuid;
begin
  select b.organization_id, b.status into v_org, v_status
    from public.import_batches b
   where b.id = p_batch_id and b.type = 'vehicles' and b.status in ('validated', 'processing')
   for update;
  if v_org is null then
    raise exception 'Lote não está validado.' using errcode = 'invalid_parameter_value';
  end if;
  if not private.has_permission(v_org, 'vehicles.import') then
    raise exception 'Você não possui permissão para importar frotas.' using errcode = 'insufficient_privilege';
  end if;

  if v_status = 'validated' then
    update public.import_batches set status = 'processing' where id = p_batch_id;
  end if;

  for r in
    select x.id, x.row_number, x.action, x.vehicle_id, x.normalized_data
      from public.import_rows x
     where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update')
     order by x.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    d := r.normalized_data;

    if r.action = 'create' then
      insert into public.vehicles (
        organization_id, fleet_code, license_plate, vin, renavam,
        vehicle_type_id, vehicle_subcategory_id, vehicle_model_id,
        manufacture_year, model_year, ownership_type, status,
        asset_value, antt_code, has_tachograph, tachograph_number, notes,
        organization_unit_id, cost_center_id
      ) values (
        v_org,
        d ->> 'resolved_fleet_code',
        d ->> 'resolved_license_plate',
        d ->> 'resolved_vin',
        d ->> 'resolved_renavam',
        (d ->> 'resolved_type_id')::uuid,
        nullif(d ->> 'resolved_subcategory_id', '')::uuid,
        nullif(d ->> 'resolved_model_id', '')::uuid,
        nullif(d ->> 'manufacture_year', '')::smallint,
        nullif(d ->> 'model_year', '')::smallint,
        coalesce(nullif(d ->> 'ownership_type', ''), 'owned'),
        coalesce(nullif(d ->> 'status', ''), 'active'),
        nullif(d ->> 'asset_value', '')::numeric,
        nullif(d ->> 'antt_code', ''),
        coalesce((d ->> 'has_tachograph')::boolean, false),
        nullif(d ->> 'tachograph_number', ''),
        nullif(d ->> 'notes', ''),
        nullif(d ->> 'resolved_unit_id', '')::uuid,
        nullif(d ->> 'resolved_cost_center_id', '')::uuid
      )
      returning id into v_id;

      -- Alocação e leitura inicial só existem na criação. Num veículo que já
      -- existe, ambas têm rotina própria — é o §55 inteiro.
      if nullif(d ->> 'resolved_operation_id', '') is not null then
        insert into public.vehicle_operation_assignments
          (organization_id, vehicle_id, operation_id, state_id, city_id, effective_from, reason)
        values (v_org, v_id, (d ->> 'resolved_operation_id')::uuid,
                (d ->> 'resolved_state_id')::smallint, (d ->> 'resolved_city_id')::integer,
                current_date, 'Alocação informada na importação cadastral.');
      end if;

      if nullif(d ->> 'odometer_km', '') is not null then
        insert into public.vehicle_odometer_readings
          (organization_id, vehicle_id, reading_date, odometer_km, source, notes)
        values (v_org, v_id, current_date, (d ->> 'odometer_km')::integer, 'import',
                'Leitura informada na importação cadastral.');
      end if;

      update public.import_rows set status = 'created', vehicle_id = v_id where id = r.id;
      v_created := v_created + 1;

    else
      -- Campos cadastrais, e só eles. Identidade, alocação e hodômetro ficam
      -- de fora por construção: não estão nesta lista.
      update public.vehicles set
        vehicle_type_id        = coalesce(nullif(d ->> 'resolved_type_id', '')::uuid, vehicle_type_id),
        vehicle_subcategory_id = coalesce(nullif(d ->> 'resolved_subcategory_id', '')::uuid, vehicle_subcategory_id),
        vehicle_model_id       = coalesce(nullif(d ->> 'resolved_model_id', '')::uuid, vehicle_model_id),
        manufacture_year       = coalesce(nullif(d ->> 'manufacture_year', '')::smallint, manufacture_year),
        model_year             = coalesce(nullif(d ->> 'model_year', '')::smallint, model_year),
        ownership_type         = coalesce(nullif(d ->> 'ownership_type', ''), ownership_type),
        status                 = coalesce(nullif(d ->> 'status', ''), status),
        asset_value            = coalesce(nullif(d ->> 'asset_value', '')::numeric, asset_value),
        antt_code              = coalesce(nullif(d ->> 'antt_code', ''), antt_code),
        has_tachograph         = coalesce((d ->> 'has_tachograph')::boolean, has_tachograph),
        tachograph_number      = coalesce(nullif(d ->> 'tachograph_number', ''), tachograph_number),
        notes                  = coalesce(nullif(d ->> 'notes', ''), notes),
        organization_unit_id   = coalesce(nullif(d ->> 'resolved_unit_id', '')::uuid, organization_unit_id),
        cost_center_id         = coalesce(nullif(d ->> 'resolved_cost_center_id', '')::uuid, cost_center_id)
      where id = r.vehicle_id and organization_id = v_org;

      update public.import_rows set status = 'updated' where id = r.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  select count(*)::integer into v_left from public.import_rows x
   where x.batch_id = p_batch_id and x.status in ('valid', 'warning') and x.action in ('create', 'update');
  if v_left > 0 then
    return query select 0, 0, 0, v_left;
    return;
  end if;

  update public.import_rows x set status = 'skipped'
   where x.batch_id = p_batch_id and x.action = 'skip' and x.status <> 'error';
  select count(*) filter (where x.status = 'created')::integer,
         count(*) filter (where x.status = 'updated')::integer,
         count(*) filter (where x.status in ('skipped', 'error'))::integer
    into v_created, v_updated, v_skipped
    from public.import_rows x where x.batch_id = p_batch_id;

  update public.import_batches b
     set status = 'completed', processed_at = now(),
         created_rows = v_created, updated_rows = v_updated, skipped_rows = v_skipped
   where b.id = p_batch_id;

  perform private.emit_event(v_org, 'vehicle.import_processed', 'import_batch', p_batch_id,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return query select v_created, v_updated, v_skipped, 0;
end;
$$;

drop function if exists public.process_employee_import(uuid);
create function public.process_employee_import(p_batch_id uuid, p_limit integer default null)
returns table (created_rows integer, updated_rows integer, skipped_rows integer, remaining_rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_mode       text;
  v_status     text;
  v_row        record;
  v_data       jsonb;
  v_employee   uuid;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_skipped    integer := 0;
  v_left       integer;
  v_position   uuid;
  v_area       uuid;
  v_operation  uuid;
  v_location   uuid;
  v_profile    uuid;
  v_unit       uuid;
  v_manager    uuid;
  v_license_id uuid;
  v_category   text;
begin
  select b.organization_id, b.mode, b.status into v_org, v_mode, v_status
    from public.import_batches b where b.id = p_batch_id for update;
  if v_org is null then
    raise exception 'import batch not found' using errcode = 'no_data_found';
  end if;
  if not private.has_permission(v_org, 'users.import') then
    raise exception 'permission users.import is required' using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('validated', 'processing') then
    raise exception 'batch must be validated before processing (current status: %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if v_mode = 'validate' then
    raise exception 'this batch was created in validation-only mode' using errcode = 'invalid_parameter_value';
  end if;

  if v_status = 'validated' then
    update public.import_batches set status = 'processing' where id = p_batch_id;
    perform private.emit_event(v_org, 'user.import_started', 'import_batch', p_batch_id,
      jsonb_build_object('mode', v_mode));
  end if;

  for v_row in
    select r.* from public.import_rows r
     where r.batch_id = p_batch_id and r.status in ('valid', 'warning')
     order by r.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    v_data := v_row.normalized_data;

    if v_row.action = 'skip' or (v_row.action = 'update' and v_mode = 'create') then
      update public.import_rows set status = 'skipped' where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_position  := private.resolve_master_data(v_org, 'job_position', v_data ->> 'job_position_code', v_data ->> 'job_position_name');
    v_area      := private.resolve_master_data(v_org, 'employment_area', null, v_data ->> 'employment_area_name');
    v_operation := private.resolve_master_data(v_org, 'operation', null, v_data ->> 'operation_name');
    v_location  := private.resolve_master_data(v_org, 'work_location', null, v_data ->> 'work_location_name');
    v_profile   := private.resolve_master_data(v_org, 'business_profile', null, v_data ->> 'business_profile_name');
    v_unit      := private.resolve_master_data(v_org, 'organization_unit', v_data ->> 'unit_code', v_data ->> 'unit_name');

    if v_row.action = 'create' then
      insert into public.employees (
        organization_id, employee_code, full_name, corporate_email,
        employment_status, admission_date
      ) values (
        v_org,
        v_data ->> 'employee_code',
        v_data ->> 'full_name',
        nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), ''),
        coalesce(nullif(v_data ->> 'employment_status', ''), 'active'),
        nullif(v_data ->> 'admission_date', '')::date
      )
      returning id into v_employee;
      v_created := v_created + 1;
    else
      v_employee := v_row.employee_id;
      update public.employees set
        full_name         = coalesce(nullif(v_data ->> 'full_name', ''), full_name),
        corporate_email   = coalesce(nullif(lower(btrim(coalesce(v_data ->> 'corporate_email', ''))), ''), corporate_email),
        employment_status = coalesce(nullif(v_data ->> 'employment_status', ''), employment_status),
        admission_date    = coalesce(nullif(v_data ->> 'admission_date', '')::date, admission_date)
      where id = v_employee;
      v_updated := v_updated + 1;
    end if;

    if nullif(v_data ->> 'cpf', '') is not null or nullif(v_data ->> 'birth_date', '') is not null then
      insert into public.employee_private_data (employee_id, organization_id, cpf, birth_date)
      values (
        v_employee, v_org,
        nullif(regexp_replace(coalesce(v_data ->> 'cpf', ''), '[^0-9]', '', 'g'), ''),
        nullif(v_data ->> 'birth_date', '')::date
      )
      on conflict (employee_id) do update set
        cpf = coalesce(excluded.cpf, public.employee_private_data.cpf),
        birth_date = coalesce(excluded.birth_date, public.employee_private_data.birth_date);
    end if;

    update public.employee_assignments set
      job_position_id      = coalesce(v_position, job_position_id),
      employment_area_id   = coalesce(v_area, employment_area_id),
      operation_id         = coalesce(v_operation, operation_id),
      organization_unit_id = coalesce(v_unit, organization_unit_id),
      work_location_id     = coalesce(v_location, work_location_id),
      business_profile_id  = coalesce(v_profile, business_profile_id)
    where employee_id = v_employee and is_current;

    if not found then
      insert into public.employee_assignments (
        organization_id, employee_id, job_position_id, employment_area_id, operation_id,
        organization_unit_id, work_location_id, business_profile_id, effective_from, is_current
      ) values (
        v_org, v_employee, v_position, v_area, v_operation, v_unit, v_location, v_profile,
        coalesce(nullif(v_data ->> 'admission_date', '')::date, current_date), true
      );
    end if;

    v_category := nullif(upper(btrim(coalesce(v_data ->> 'license_category', ''))), '');
    if v_category is not null and v_category ~ '^[A-E]{1,3}$' then
      select id into v_license_id from public.driver_licenses
        where employee_id = v_employee and deleted_at is null;

      if v_license_id is null then
        insert into public.driver_licenses (
          organization_id, employee_id, category, license_number,
          expiration_date, first_license_date, points
        ) values (
          v_org, v_employee, v_category,
          nullif(regexp_replace(coalesce(v_data ->> 'license_number', ''), '[^0-9]', '', 'g'), ''),
          nullif(v_data ->> 'license_expiration_date', '')::date,
          nullif(v_data ->> 'license_first_date', '')::date,
          nullif(v_data ->> 'license_points', '')::smallint
        );
      else
        update public.driver_licenses set
          category           = v_category,
          license_number     = coalesce(nullif(regexp_replace(coalesce(v_data ->> 'license_number', ''), '[^0-9]', '', 'g'), ''), license_number),
          expiration_date    = coalesce(nullif(v_data ->> 'license_expiration_date', '')::date, expiration_date),
          first_license_date = coalesce(nullif(v_data ->> 'license_first_date', '')::date, first_license_date),
          points             = coalesce(nullif(v_data ->> 'license_points', '')::smallint, points)
        where id = v_license_id;
      end if;
    end if;

    update public.import_rows
       set status = case when v_row.action = 'create' then 'created' else 'updated' end,
           employee_id = v_employee
     where id = v_row.id;
  end loop;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id and r.status in ('valid', 'warning');
  if v_left > 0 then
    return query select 0, 0, 0, v_left;
    return;
  end if;

  -- Líderes depois de todas as pessoas gravadas, para achar quem veio no
  -- mesmo arquivo; também em partes, marcando cada linha já conferida.
  for v_row in
    select r.id, r.normalized_data, r.employee_id
      from public.import_rows r
     where r.batch_id = p_batch_id
       and r.status in ('created', 'updated')
       and nullif(btrim(coalesce(r.normalized_data ->> 'manager_name', '')), '') is not null
       and not coalesce((r.normalized_data ->> '_manager_checked')::boolean, false)
     order by r.row_number
     limit greatest(coalesce(p_limit, 2147483647), 1)
  loop
    v_manager := null;
    select e.id into v_manager
      from public.employees e
     where e.organization_id = v_org and e.deleted_at is null
       and private.normalize_label(e.full_name)
         = private.normalize_label(v_row.normalized_data ->> 'manager_name')
       and e.id <> v_row.employee_id
     limit 1;

    if v_manager is not null then
      update public.employee_assignments
         set manager_employee_id = v_manager
       where employee_id = v_row.employee_id and is_current;
    end if;

    update public.import_rows
       set normalized_data = normalized_data || '{"_manager_checked": true}'::jsonb
     where id = v_row.id;
  end loop;

  select count(*)::integer into v_left from public.import_rows r
   where r.batch_id = p_batch_id
     and r.status in ('created', 'updated')
     and nullif(btrim(coalesce(r.normalized_data ->> 'manager_name', '')), '') is not null
     and not coalesce((r.normalized_data ->> '_manager_checked')::boolean, false);
  if v_left > 0 then
    return query select 0, 0, 0, v_left;
    return;
  end if;

  select count(*) filter (where r.status = 'created')::integer,
         count(*) filter (where r.status = 'updated')::integer,
         count(*) filter (where r.status = 'skipped')::integer
    into v_created, v_updated, v_skipped
    from public.import_rows r where r.batch_id = p_batch_id;

  update public.import_batches set
    status       = 'completed',
    created_rows = v_created,
    updated_rows = v_updated,
    skipped_rows = v_skipped,
    processed_at = now(),
    summary = jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped)
  where id = p_batch_id;

  perform private.emit_event(v_org, 'user.import_completed', 'import_batch', p_batch_id,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped));

  return query select v_created, v_updated, v_skipped, 0;
end;
$$;

-- Assinaturas novas: só quem está autenticado executa --------------------------
revoke all on function public.validate_vehicle_import(uuid, integer) from public, anon;
revoke all on function public.validate_employee_import(uuid, integer) from public, anon;
revoke all on function public.process_br_import(uuid, uuid, integer) from public, anon;
revoke all on function public.process_fidelization_import(uuid, uuid, integer) from public, anon;
revoke all on function public.process_branch_import(uuid, uuid, integer) from public, anon;
revoke all on function public.process_adherence_import(uuid, uuid, integer) from public, anon;
revoke all on function public.process_vehicle_import(uuid, integer) from public, anon;
revoke all on function public.process_employee_import(uuid, integer) from public, anon;

grant execute on function public.validate_vehicle_import(uuid, integer) to authenticated, service_role;
grant execute on function public.validate_employee_import(uuid, integer) to authenticated, service_role;
grant execute on function public.process_br_import(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.process_fidelization_import(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.process_branch_import(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.process_adherence_import(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.process_vehicle_import(uuid, integer) to authenticated, service_role;
grant execute on function public.process_employee_import(uuid, integer) to authenticated, service_role;
