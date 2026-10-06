-- =============================================================================
-- Gestão de Pneus — Central de Auditoria dos Dados
--
-- Substitui a lista de "problemas por código" por uma ferramenta de auditoria:
-- um catálogo de regras (`tire_audit_rules`: categoria, gravidade, campo e
-- valor esperado), achados persistidos com ciclo de vida
-- (`tire_data_findings`: aberto → resolvido, com primeira e última detecção,
-- ocorrências e reabertura) e o registro de cada varredura
-- (`tire_audit_scans`). A varredura roda ao confirmar dados (sincronização ou
-- envio manual), diariamente pelo pg_cron (prazos envelhecem, parâmetros
-- mudam) e sob demanda. Nada é corrigido automaticamente: o achado aponta
-- onde, o quê, o valor encontrado e o esperado; a correção é feita na origem
-- (Rodopar/planilha, Cadastro de Frotas, Parâmetros) e a próxima varredura
-- resolve o achado.
--
-- Aditiva: tabelas novas e `create or replace` de private.tire_after_confirm.
-- =============================================================================

create table if not exists public.tire_audit_rules (
  code         text primary key,
  category     text not null,
  severity     text not null,
  title        text not null,
  description  text not null,
  field        text,
  expected     text,
  sort         smallint not null default 100,
  is_active    boolean not null default true,
  constraint tire_audit_rules_category_check check (category in ('cadastro', 'duplicidade', 'relacionamento', 'localizacao', 'posicao',
                                                                 'medicao', 'calibragem', 'datas', 'configuracao', 'historico')),
  constraint tire_audit_rules_severity_check check (severity in ('critica', 'alta', 'media', 'baixa'))
);
comment on table public.tire_audit_rules is 'Catálogo das regras da Central de Auditoria dos Dados de Pneus (global, versionado por migration).';

insert into public.tire_audit_rules (code, category, severity, title, description, field, expected, sort) values
  ('fogo_duplicado', 'duplicidade', 'critica', 'Nº Fogo duplicado', 'O mesmo Nº Fogo aparece em mais de uma linha da planilha (o lote fica bloqueado; nada é aplicado).', 'Nº Fogo', 'Um Nº Fogo por linha', 10),
  ('posicao_duplicada', 'duplicidade', 'critica', 'Posição duplicada', 'Dois ou mais pneus em uso na mesma frota e posição (o lote fica bloqueado).', 'Posição', 'Um pneu por posição', 11),
  ('pneu_duplicado', 'duplicidade', 'alta', 'Pneu duplicado', 'Nº Fogo que só diferem por zeros à esquerda (ex.: 076225 e 76225): provável mesmo pneu cadastrado duas vezes. O Nº Fogo nunca é convertido para número — a regra só aponta.', 'Nº Fogo', 'Um cadastro por pneu', 12),
  ('em_uso_sem_veiculo', 'relacionamento', 'critica', 'Pneu em uso sem veículo', 'Situação em uso sem frota informada na planilha.', 'N. Frota', 'Frota do veículo', 20),
  ('frota_nao_encontrada', 'relacionamento', 'alta', 'Frota sem correspondência no cadastro', 'A frota/placa informada não existe no Cadastro de Frotas do HFM (nenhum veículo é criado).', 'N. Frota', 'Frota cadastrada no HFM', 21),
  ('ausente_planilha', 'relacionamento', 'media', 'Pneu ausente na planilha', 'O pneu estava na base e não veio na planilha mais recente (mantido com a última situação conhecida).', 'Nº Fogo', 'Presente na planilha', 22),
  ('placa_sem_operacao', 'localizacao', 'alta', 'Frota sem operação', 'Veículo do pneu em uso sem operação vigente na data dos dados.', 'Operação', 'Operação vigente', 30),
  ('sem_local_operacao', 'localizacao', 'media', 'Frota sem local de operação', 'Veículo do pneu em uso sem local (cidade) de operação na data.', 'Local de operação', 'Local vigente', 31),
  ('frota_sem_lideranca', 'localizacao', 'media', 'Frota sem liderança', 'Veículo do pneu em uso sem liderança responsável na data.', 'Liderança', 'Liderança vigente', 32),
  ('pneu_sem_posicao', 'posicao', 'alta', 'Pneu em uso sem posição', 'Pneu em uso numa frota, sem posição informada.', 'Posição', 'Posição do layout', 40),
  ('posicao_invalida', 'posicao', 'alta', 'Posição inválida', 'Código de posição fora do dicionário de posições.', 'Posição', 'Posição do dicionário', 41),
  ('posicao_fora_layout', 'posicao', 'media', 'Posição fora do layout do veículo', 'A posição existe, mas não faz parte do layout do veículo.', 'Posição', 'Posição do layout do veículo', 42),
  ('quantidade_incompativel', 'posicao', 'media', 'Quantidade incompatível de pneus', 'O número de pneus em uso no veículo difere do número de posições do seu layout.', 'Pneus em uso', 'Posições do layout', 43),
  ('posicao_layout_vazia', 'posicao', 'baixa', 'Posição do layout sem pneu', 'Posição prevista no layout do veículo sem pneu em uso.', 'Posição', 'Pneu montado', 44),
  ('eixo_medidas_diferentes', 'posicao', 'media', 'Eixo com medidas diferentes', 'Pneus do mesmo eixo do veículo com medidas (dimensões) diferentes.', 'Medida', 'Mesma medida no eixo', 45),
  ('fabricante_ausente', 'cadastro', 'media', 'Fabricante ausente', 'Pneu sem marca/fabricante.', 'Marca', 'Fabricante informado', 50),
  ('modelo_ausente', 'cadastro', 'baixa', 'Modelo ausente', 'Pneu sem modelo.', 'Modelo', 'Modelo informado', 51),
  ('medida_ausente', 'cadastro', 'alta', 'Medida ausente', 'Pneu sem dimensão/medida — impede a regra de PSI por medida.', 'Medida', 'Medida informada', 52),
  ('situacao_nao_reconhecida', 'cadastro', 'media', 'Situação não reconhecida', 'Situação Rodopar fora das situações conhecidas (classificada como Outro).', 'Situação', 'Situação conhecida', 53),
  ('vida_invalida', 'cadastro', 'baixa', 'Vida inválida', 'Nº da vida inválido no relatório.', 'Vida', 'Número inteiro ≥ 1', 54),
  ('sem_medicao', 'medicao', 'alta', 'Medição inexistente', 'Pneu em uso sem data de medição de sulco.', 'Dt. Medição', 'Data da última medição', 60),
  ('sulco_invalido', 'medicao', 'alta', 'MM inválido', 'Sulco negativo ou acima do limite técnico (descartado na leitura).', 'Sulco', 'Entre 0 e o limite técnico', 61),
  ('menor_mm_divergente', 'medicao', 'baixa', 'Menor MM divergente', 'A menor milimetragem informada difere da menor medida nos sulcos além da tolerância.', 'Menor MM', 'Igual ao menor sulco medido', 62),
  ('km_real_negativo', 'medicao', 'baixa', 'KM Real negativo', 'KM Real negativo no relatório (preservado como diagnóstico, nunca somado).', 'KM Real', 'Valor ≥ 0', 63),
  ('sem_calibragem', 'calibragem', 'alta', 'Calibragem inexistente', 'Pneu em uso sem data de calibragem.', 'Dt. Calibragem', 'Data da última calibragem', 70),
  ('psi_invalido', 'calibragem', 'alta', 'PSI inválido', 'PSI fora dos limites plausíveis (negativo ou acima do limite técnico).', 'Calibragem', 'Entre 0 e o limite técnico', 71),
  ('numero_formatado_como_data', 'calibragem', 'baixa', 'Número gravado como data', 'Valor numérico salvo com formato de data no Rodopar (recuperado na leitura).', 'Calibragem/Sulco', 'Número', 72),
  ('sem_parametro_psi', 'configuracao', 'media', 'Sem parâmetro de PSI', 'Não há regra de PSI para o tipo, medida e posição — a pressão não pode ser avaliada.', 'Regra de PSI', 'Regra cadastrada em Parâmetros', 80),
  ('data_futura', 'datas', 'media', 'Data futura', 'Data posterior à data de referência dos dados (ignorada).', 'Data', 'Até a data de referência', 90),
  ('data_invalida', 'datas', 'media', 'Data inválida', 'Data que não pôde ser interpretada (ignorada).', 'Data', 'Data válida', 91),
  ('datas_inconsistentes', 'datas', 'baixa', 'Datas inconsistentes', 'Medição ou calibragem anterior à compra/cadastro do pneu.', 'Datas', 'Após a compra/cadastro', 92),
  ('desatualizado', 'datas', 'baixa', 'Registro desatualizado', 'Última alteração do pneu no Rodopar mais antiga que o limite configurado.', 'Última alteração', 'Dentro do limite de atualização', 93),
  ('vida_regrediu', 'historico', 'media', 'Vida regrediu', 'A vida do pneu diminuiu em relação aos dados anteriores.', 'Vida', 'Vida igual ou maior', 100),
  ('reativado_apos_baixa', 'historico', 'media', 'Voltou após descarte/baixa', 'Pneu descartado/baixado reapareceu em uso ou estoque.', 'Situação', 'Sem retorno após baixa', 101)
on conflict (code) do update set category = excluded.category, severity = excluded.severity, title = excluded.title,
  description = excluded.description, field = excluded.field, expected = excluded.expected, sort = excluded.sort;

create table if not exists public.tire_audit_scans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  trigger          text not null,
  reference_date   date,
  batch_id         uuid references public.tire_import_batches (id) on delete restrict,
  status           text not null default 'em_andamento',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  opened           integer not null default 0,
  reopened         integer not null default 0,
  refreshed        integer not null default 0,
  resolved         integer not null default 0,
  open_total       integer not null default 0,
  error_message    text,
  requested_by     uuid references auth.users (id) on delete set null,
  requested_by_name text,
  constraint tire_audit_scans_trigger_check check (trigger in ('confirmacao', 'agendada', 'manual')),
  constraint tire_audit_scans_status_check check (status in ('em_andamento', 'concluida', 'falhou'))
);
create index if not exists tire_audit_scans_org_idx on public.tire_audit_scans (organization_id, started_at desc);

create table if not exists public.tire_data_findings (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  rule_code             text not null references public.tire_audit_rules (code) on delete restrict,
  fingerprint           text not null,
  category              text not null,
  severity              text not null,
  status                text not null default 'aberta',
  tire_id               uuid,
  fire_number           text,
  vehicle_id            uuid,
  license_plate         text,
  fleet_number          text,
  position_code         text,
  operation_id          uuid,
  operation_name        text,
  city_id               integer,
  city_label            text,
  leader_id             uuid,
  leader_name           text,
  field                 text,
  found_value           text,
  expected_value        text,
  detail                text,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  resolved_at           timestamptz,
  first_reference_date  date,
  last_reference_date   date,
  occurrences           integer not null default 1,
  reopened_count        integer not null default 0,
  last_scan_id          uuid references public.tire_audit_scans (id) on delete set null,
  constraint tire_data_findings_key unique (organization_id, fingerprint),
  constraint tire_data_findings_status_check check (status in ('aberta', 'resolvida'))
);
comment on table public.tire_data_findings is
  'Achados da Central de Auditoria dos Dados de Pneus: onde (pneu, frota, posição, operação, local, liderança), qual regra, valor encontrado e esperado, e o ciclo de vida (primeira/última detecção, resolução, reabertura).';
create index if not exists tire_data_findings_open_idx on public.tire_data_findings (organization_id, status, severity);
create index if not exists tire_data_findings_rule_idx on public.tire_data_findings (organization_id, rule_code, status);

create or replace trigger tire_data_findings_prevent_tenant_change before update on public.tire_data_findings
  for each row execute function private.tg_prevent_tenant_change();
create or replace trigger tire_audit_scans_prevent_tenant_change before update on public.tire_audit_scans
  for each row execute function private.tg_prevent_tenant_change();

do $rls$
declare t text;
begin
  foreach t in array array['tire_audit_rules', 'tire_audit_scans', 'tire_data_findings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_audit_rules' and policyname = 'tire_audit_rules_select') then
    create policy tire_audit_rules_select on public.tire_audit_rules for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_audit_scans' and policyname = 'tire_audit_scans_select') then
    create policy tire_audit_scans_select on public.tire_audit_scans for select to authenticated
      using (private.has_permission(organization_id, 'tires.quality.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tire_data_findings' and policyname = 'tire_data_findings_select') then
    create policy tire_data_findings_select on public.tire_data_findings for select to authenticated
      using (private.has_permission(organization_id, 'tires.quality.view')
             and (private.is_platform_admin()
                  or organization_id in (select private.permitted_org_ids('operations.access_all'))
                  or (operation_id is not null and operation_id in (select private.accessible_operation_ids()))
                  or (operation_id is null and vehicle_id is not null and private.tire_vehicle_visible(organization_id, vehicle_id))));
  end if;
end $rls$;

-- -----------------------------------------------------------------------------
-- Varredura: calcula os achados da situação atual e concilia com os persistidos
-- -----------------------------------------------------------------------------
create or replace function private.tire_audit_scan(p_organization_id uuid, p_trigger text, p_batch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan   uuid;
  v_ref    date := private.tire_latest_reference(p_organization_id);
  v_as_of  date;
  p        public.tire_parameter_sets;
  v_blocked public.tire_import_batches;
  n_open integer := 0; n_reopen integer := 0; n_ref integer := 0; n_res integer := 0; n_total integer := 0;
begin
  insert into public.tire_audit_scans (organization_id, trigger, reference_date, batch_id, requested_by, requested_by_name)
  values (p_organization_id, p_trigger, v_ref, p_batch_id, auth.uid(),
          case when auth.uid() is null then 'Varredura automática' else private.tire_actor_name(p_organization_id) end)
  returning id into v_scan;
  if v_ref is null then
    update public.tire_audit_scans s set status = 'concluida', finished_at = now() where s.id = v_scan;
    return jsonb_build_object('scan_id', v_scan, 'reference_date', null);
  end if;
  v_as_of := greatest(private.maintenance_today(p_organization_id), v_ref);
  p := private.tire_params_at(p_organization_id, v_as_of);
  -- lote bloqueado mais recente que os dados vigentes: seus erros bloqueantes também são achados
  select * into v_blocked from public.tire_import_batches b
   where b.organization_id = p_organization_id and b.status = 'blocked'
     and b.created_at > coalesce((select max(x.confirmed_at) from public.tire_import_batches x
                                   where x.organization_id = p_organization_id and x.status = 'confirmed'), '-infinity'::timestamptz)
   order by b.created_at desc limit 1;

  perform set_config('hfm.tire_org_wide', 'on', true);
  create temp table if not exists tmp_tire_findings (
    rule_code text, fingerprint text, tire_id uuid, fire_number text, vehicle_id uuid, license_plate text, fleet_number text,
    position_code text, operation_id uuid, operation_name text, city_id integer, city_label text, leader_id uuid, leader_name text,
    field text, found_value text, expected_value text, detail text) on commit drop;
  truncate tmp_tire_findings;

  insert into tmp_tire_findings
  with r as materialized (select * from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', v_ref), v_as_of)),
  ctx as (select r.*, coalesce(r.city_name || ' · ' || r.state_uf, null) as city_label from r),
  iss as (
    -- inconsistências gravadas pela leitura: campo, valor e mensagem vêm do lote
    select c.*, i ->> 'code' as code, i ->> 'field' as i_field, i ->> 'value' as i_value, i ->> 'message' as i_msg
      from ctx c
      join public.tire_import_staging st on st.batch_id = c.import_batch_id and st.tire_id = c.tire_id
      cross join lateral jsonb_array_elements(st.issues) i
     where (i ->> 'code') = any (c.quality_flags)),
  lay as (
    select v.vehicle_id, l.layout_source, l.position_codes
      from (select distinct r.vehicle_id from r where r.vehicle_id is not null and r.canonical_status = 'em_uso') v
      cross join lateral private.tire_vehicle_layout(p_organization_id, v.vehicle_id, v_ref) l),
  veh as (
    select r.vehicle_id, min(r.license_plate) as plate, min(r.fleet_number) as fleet, (array_agg(r.operation_id))[1] as op,
           min(r.operation_name) as op_name, (array_agg(r.city_id))[1] as city, min(r.city_name || ' · ' || r.state_uf) as city_label,
           (array_agg(r.leader_employee_id))[1] as leader, min(r.leader_name) as leader_name, count(*) as in_use
      from r where r.canonical_status = 'em_uso' and r.vehicle_id is not null group by r.vehicle_id)
  -- 1. flags da leitura
  select case iss.code when 'em_uso_sem_frota' then 'em_uso_sem_veiculo' else iss.code end,
         iss.code || ':' || iss.tire_id || ':' || coalesce(iss.i_field, ''),
         iss.tire_id, iss.fire_number, iss.vehicle_id, iss.license_plate, iss.fleet_number, iss.position_code,
         iss.operation_id, iss.operation_name, iss.city_id, iss.city_label, iss.leader_employee_id, iss.leader_name,
         iss.i_field, iss.i_value, null, iss.i_msg
    from iss
   where iss.code in ('sulco_invalido', 'menor_mm_divergente', 'km_real_negativo', 'psi_invalido', 'numero_formatado_como_data',
                      'data_futura', 'data_invalida', 'vida_invalida', 'situacao_nao_reconhecida', 'vida_regrediu', 'reativado_apos_baixa')
  union all
  -- 2. relacionamento
  select 'em_uso_sem_veiculo', 'em_uso_sem_veiculo:' || c.tire_id, c.tire_id, c.fire_number, null, null, null, c.position_code,
         null, null, null, null, null, null, 'N. Frota', null, null, 'Pneu em uso sem frota informada.'
    from ctx c where c.canonical_status = 'em_uso' and c.fleet_number_raw is null
  union all
  select 'frota_nao_encontrada', 'frota_nao_encontrada:' || c.tire_id, c.tire_id, c.fire_number, null, null, c.fleet_number_raw, c.position_code,
         null, null, null, null, null, null, 'N. Frota', c.fleet_number_raw, 'Frota cadastrada no HFM',
         format('Frota "%s" não existe no Cadastro de Frotas.', c.fleet_number_raw)
    from ctx c where c.enrichment_status = 'frota_nao_encontrada'
  union all
  select 'ausente_planilha', 'ausente_planilha:' || t.id, t.id, t.fire_number, t.current_vehicle_id, v.license_plate, v.fleet_code,
         t.current_position_code, null, null, null, null, null, null, 'Nº Fogo', 'ausente desde ' || to_char(t.absent_since, 'DD/MM/YYYY'),
         'Presente na planilha', 'Mantido com a última situação conhecida.'
    from public.tires t left join public.vehicles v on v.id = t.current_vehicle_id
   where t.organization_id = p_organization_id and t.presence_status = 'absent'
  union all
  -- 3. localização do veículo (uma vez por veículo)
  select 'placa_sem_operacao', 'placa_sem_operacao:' || veh.vehicle_id, null, null, veh.vehicle_id, veh.plate, veh.fleet, null,
         null, null, veh.city, veh.city_label, veh.leader, veh.leader_name, 'Operação', null, 'Operação vigente',
         format('%s pneu(s) em uso sem operação na data dos dados.', veh.in_use)
    from veh where veh.op is null
  union all
  select 'sem_local_operacao', 'sem_local_operacao:' || veh.vehicle_id, null, null, veh.vehicle_id, veh.plate, veh.fleet, null,
         veh.op, veh.op_name, null, null, veh.leader, veh.leader_name, 'Local de operação', null, 'Local vigente', null
    from veh where veh.city is null
  union all
  select 'frota_sem_lideranca', 'frota_sem_lideranca:' || veh.vehicle_id, null, null, veh.vehicle_id, veh.plate, veh.fleet, null,
         veh.op, veh.op_name, veh.city, veh.city_label, null, null, 'Liderança', null, 'Liderança vigente', null
    from veh where veh.leader is null
  union all
  -- 4. posição e eixo
  select 'pneu_sem_posicao', 'pneu_sem_posicao:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, null,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Posição', null, 'Posição do layout', null
    from ctx c where c.canonical_status = 'em_uso' and c.fleet_number_raw is not null and c.position_code is null
  union all
  select 'posicao_invalida', 'posicao_invalida:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Posição', c.position_code, 'Posição do dicionário', null
    from ctx c where c.position_code is not null
     and not exists (select 1 from public.tire_positions pos where pos.organization_id = p_organization_id and pos.code = c.position_code)
  union all
  select 'posicao_fora_layout', 'posicao_fora_layout:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Posição', c.position_code,
         array_to_string(lay.position_codes, ', '), null
    from ctx c join lay on lay.vehicle_id = c.vehicle_id
   where c.canonical_status = 'em_uso' and lay.layout_source <> 'snapshot' and c.position_code is not null
     and not (c.position_code = any (lay.position_codes))
     and exists (select 1 from public.tire_positions pos where pos.organization_id = p_organization_id and pos.code = c.position_code)
  union all
  select 'posicao_layout_vazia', 'posicao_layout_vazia:' || lay.vehicle_id || ':' || pc, null, null, lay.vehicle_id, veh.plate, veh.fleet, pc,
         veh.op, veh.op_name, veh.city, veh.city_label, veh.leader, veh.leader_name, 'Posição', 'vazia', 'Pneu montado', null
    from lay join veh on veh.vehicle_id = lay.vehicle_id cross join lateral unnest(lay.position_codes) pc
   where lay.layout_source <> 'snapshot'
     and not exists (select 1 from r where r.vehicle_id = lay.vehicle_id and r.canonical_status = 'em_uso' and r.position_code = pc)
  union all
  select 'quantidade_incompativel', 'quantidade_incompativel:' || lay.vehicle_id, null, null, lay.vehicle_id, veh.plate, veh.fleet, null,
         veh.op, veh.op_name, veh.city, veh.city_label, veh.leader, veh.leader_name, 'Pneus em uso', veh.in_use::text,
         cardinality(lay.position_codes)::text, format('Layout com %s posições; %s pneu(s) em uso.', cardinality(lay.position_codes), veh.in_use)
    from lay join veh on veh.vehicle_id = lay.vehicle_id
   where lay.layout_source <> 'snapshot' and veh.in_use <> cardinality(lay.position_codes)
  union all
  select 'eixo_medidas_diferentes', 'eixo_medidas_diferentes:' || e.vehicle_id || ':' || e.axle_group, null, null, e.vehicle_id, veh.plate, veh.fleet, null,
         veh.op, veh.op_name, veh.city, veh.city_label, veh.leader, veh.leader_name, 'Medida', e.dims, 'Mesma medida no eixo',
         format('Eixo %s com medidas diferentes.', e.axle_group)
    from (select r.vehicle_id, r.axle_group, string_agg(distinct coalesce(r.dimension, '?'), ' / ') as dims
            from r where r.canonical_status = 'em_uso' and r.vehicle_id is not null and r.axle_group is not null and r.dimension_key is not null
           group by r.vehicle_id, r.axle_group having count(distinct r.dimension_key) > 1) e
    join veh on veh.vehicle_id = e.vehicle_id
  union all
  -- 5. cadastro
  select x.code, x.code || ':' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, x.field, null, x.expected, null
    from ctx c cross join lateral (values
      ('fabricante_ausente', 'Marca', 'Fabricante informado', c.brand is null),
      ('modelo_ausente', 'Modelo', 'Modelo informado', c.model is null),
      ('medida_ausente', 'Medida', 'Medida informada', c.dimension_key is null)) x(code, field, expected, hit)
   where x.hit
  union all
  -- (o "nº de série" do Rodopar guarda semana/ano de fabricação e não é único: não serve para duplicidade)
  select 'pneu_duplicado', 'pneu_duplicado:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Nº Fogo', c.fire_number, 'Um cadastro por pneu',
         format('Nº Fogo equivalentes: %s.', d.fires)
    from ctx c join (select ltrim(r.fire_number, '0') as k, string_agg(r.fire_number, ', ' order by r.fire_number) as fires from r
                      where ltrim(r.fire_number, '0') <> ''
                      group by 1 having count(*) > 1) d on d.k = ltrim(c.fire_number, '0')
  union all
  -- 6. medição, calibragem e configuração
  select 'sem_medicao', 'sem_medicao:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Dt. Medição', null, 'Data da última medição', null
    from ctx c where c.canonical_status = 'em_uso' and c.measurement_date is null
  union all
  select 'sem_calibragem', 'sem_calibragem:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Dt. Calibragem', null, 'Data da última calibragem', null
    from ctx c where c.canonical_status = 'em_uso' and c.calibration_date is null
  union all
  select 'sem_parametro_psi', 'sem_parametro_psi:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Regra de PSI',
         concat_ws(' · ', c.vehicle_type_name, c.dimension, c.position_code), 'Regra cadastrada em Parâmetros', null
    from ctx c where c.canonical_status = 'em_uso' and c.pressure_rule_id is null
  union all
  -- 7. datas
  select 'datas_inconsistentes', 'datas_inconsistentes:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Datas',
         concat_ws(' · ', 'compra ' || to_char(sn.purchase_date, 'DD/MM/YYYY'), 'medição ' || to_char(c.measurement_date, 'DD/MM/YYYY'),
                   'calibragem ' || to_char(c.calibration_date, 'DD/MM/YYYY')), 'Medição/calibragem após a compra', null
    from ctx c join public.tire_daily_snapshots sn on sn.id = c.snapshot_id
   where sn.purchase_date is not null
     and (c.measurement_date < sn.purchase_date or c.calibration_date < sn.purchase_date)
  union all
  select 'desatualizado', 'desatualizado:' || c.tire_id, c.tire_id, c.fire_number, c.vehicle_id, c.license_plate, c.fleet_number, c.position_code,
         c.operation_id, c.operation_name, c.city_id, c.city_label, c.leader_employee_id, c.leader_name, 'Última alteração',
         to_char(c.rodopar_updated_at, 'DD/MM/YYYY'), format('Até %s dias', p.stale_update_days), null
    from ctx c where c.canonical_status = 'em_uso' and c.stale_days > p.stale_update_days
  union all
  -- 8. erros bloqueantes do lote mais recente (dados não aplicados)
  select case i ->> 'code' when 'colisao_posicao' then 'posicao_duplicada' else 'fogo_duplicado' end,
         'lote:' || v_blocked.id || ':' || (i ->> 'code') || ':' || st.row_number, null, st.fire_number, st.vehicle_id, null, st.fleet_number_raw,
         st.position_code, null, null, null, null, null, null, i ->> 'field', i ->> 'value', null,
         format('Linha %s da planilha (%s): %s', st.row_number, v_blocked.file_name, i ->> 'message')
    from public.tire_import_staging st cross join lateral jsonb_array_elements(st.issues) i
   where v_blocked.id is not null and st.batch_id = v_blocked.id and (i ->> 'code') in ('fogo_duplicado', 'colisao_posicao');
  perform set_config('hfm.tire_org_wide', '', true);

  -- conciliação com os achados persistidos
  with up as (
    insert into public.tire_data_findings as fd (organization_id, rule_code, fingerprint, category, severity, tire_id, fire_number,
                                                 vehicle_id, license_plate, fleet_number, position_code, operation_id, operation_name,
                                                 city_id, city_label, leader_id, leader_name, field, found_value, expected_value, detail,
                                                 first_reference_date, last_reference_date, last_scan_id)
    select p_organization_id, t.rule_code, t.fingerprint, ru.category, ru.severity, t.tire_id, t.fire_number, t.vehicle_id, t.license_plate,
           t.fleet_number, t.position_code, t.operation_id, t.operation_name, t.city_id, t.city_label, t.leader_id, t.leader_name,
           coalesce(t.field, ru.field), left(t.found_value, 500), coalesce(t.expected_value, ru.expected), left(t.detail, 1000),
           v_ref, v_ref, v_scan
      from (select distinct on (x.fingerprint) x.* from tmp_tire_findings x order by x.fingerprint) t
      join public.tire_audit_rules ru on ru.code = t.rule_code and ru.is_active
    on conflict (organization_id, fingerprint) do update set
      severity = excluded.severity, category = excluded.category, vehicle_id = excluded.vehicle_id, license_plate = excluded.license_plate,
      fleet_number = excluded.fleet_number, position_code = excluded.position_code, operation_id = excluded.operation_id,
      operation_name = excluded.operation_name, city_id = excluded.city_id, city_label = excluded.city_label, leader_id = excluded.leader_id,
      leader_name = excluded.leader_name, field = excluded.field, found_value = excluded.found_value, expected_value = excluded.expected_value,
      detail = excluded.detail, last_seen_at = now(), last_reference_date = excluded.last_reference_date, last_scan_id = excluded.last_scan_id,
      occurrences = fd.occurrences + case when fd.last_reference_date is distinct from excluded.last_reference_date or fd.status = 'resolvida' then 1 else 0 end,
      reopened_count = fd.reopened_count + case when fd.status = 'resolvida' then 1 else 0 end,
      status = 'aberta', resolved_at = null
    returning (xmax = 0) as inserted, fd.reopened_count)
  select count(*) filter (where up.inserted), count(*) filter (where not up.inserted)
    into n_open, n_ref from up;

  update public.tire_data_findings fd set status = 'resolvida', resolved_at = now(), last_scan_id = v_scan
   where fd.organization_id = p_organization_id and fd.status = 'aberta'
     and not exists (select 1 from tmp_tire_findings t where t.fingerprint = fd.fingerprint);
  get diagnostics n_res = row_count;
  select count(*) into n_total from public.tire_data_findings fd where fd.organization_id = p_organization_id and fd.status = 'aberta';

  update public.tire_audit_scans s set status = 'concluida', finished_at = now(), opened = n_open, refreshed = n_ref, resolved = n_res,
         open_total = n_total
   where s.id = v_scan;
  return jsonb_build_object('scan_id', v_scan, 'reference_date', v_ref, 'opened', n_open, 'refreshed', n_ref, 'resolved', n_res, 'open_total', n_total);
end;
$$;

-- a confirmação dos dados (sincronização ou envio manual) dispara a varredura;
-- uma falha da auditoria nunca desfaz a confirmação dos dados
create or replace function private.tire_after_confirm(p_organization_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    return jsonb_build_object('audit', private.tire_audit_scan(p_organization_id, 'confirmacao', p_batch_id));
  exception when others then
    return jsonb_build_object('audit_error', left(sqlerrm, 300));
  end;
end;
$$;

create or replace function private.tire_audit_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o record; v_out jsonb := '[]'::jsonb;
begin
  for o in select distinct p.organization_id from public.tire_parameter_sets p loop
    begin
      v_out := v_out || jsonb_build_array(private.tire_audit_scan(o.organization_id, 'agendada'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('organization_id', o.organization_id, 'error', left(sqlerrm, 300)));
    end;
  end loop;
  return v_out;
end;
$$;

create or replace function public.tire_audit_rescan(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_organization_id, 'tires.import') or private.has_permission(p_organization_id, 'tires.parameters.manage')
          or private.is_privileged_context()) then
    raise exception 'Sem permissão para esta ação na Gestão de Pneus.' using errcode = 'insufficient_privilege';
  end if;
  return private.tire_audit_scan(p_organization_id, 'manual');
end;
$$;

-- -----------------------------------------------------------------------------
-- Leitura da Central de Auditoria (agregada e paginada no banco, no escopo)
-- -----------------------------------------------------------------------------
create or replace function public.tires_audit_center(
  p_organization_id uuid, p_filters jsonb default '{}'::jsonb, p_category text default null, p_rule text default null,
  p_severity text default null, p_status text default 'aberta', p_group_by text default 'rule',
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f        jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_all    boolean := private.is_platform_admin() or private.is_privileged_context()
                      or p_organization_id in (select private.permitted_org_ids('operations.access_all'));
  v_ops    uuid[] := '{}';
  f_ops    uuid[] := private.km_uuid_array(f -> 'operation_ids');
  f_cities integer[] := private.km_int_array(f -> 'city_ids');
  f_leaders uuid[] := private.km_uuid_array(f -> 'leader_ids');
  f_veh    uuid[] := private.km_uuid_array(f -> 'vehicle_ids');
  f_search text := nullif(btrim(f ->> 'search'), '');
  v_total_tires integer;
  v_res    jsonb;
begin
  perform private.tire_require(p_organization_id, 'tires.quality.view');
  if coalesce(p_status, 'aberta') not in ('aberta', 'resolvida', 'todas') then raise exception 'Situação inválida.' using errcode = 'invalid_parameter_value'; end if;
  if coalesce(p_group_by, 'rule') not in ('rule', 'category', 'operation', 'city', 'leader', 'severity') then
    raise exception 'Agrupamento inválido.' using errcode = 'invalid_parameter_value';
  end if;
  if not v_all then select coalesce(array_agg(x), '{}') into v_ops from private.accessible_operation_ids() x; end if;
  select count(*) into v_total_tires from private.tire_rows(p_organization_id, jsonb_build_object('reference_date', private.tire_latest_reference(p_organization_id)));

  with vis as materialized (
    select fd.*, ru.title as rule_title, ru.sort as rule_sort,
           case fd.severity when 'critica' then 4 when 'alta' then 3 when 'media' then 2 else 1 end as sev_rank
      from public.tire_data_findings fd join public.tire_audit_rules ru on ru.code = fd.rule_code
     where fd.organization_id = p_organization_id
       and (v_all or (fd.operation_id is not null and fd.operation_id = any (v_ops))
                  or (fd.operation_id is null and fd.vehicle_id is not null and private.tire_vehicle_visible(fd.organization_id, fd.vehicle_id)))
       and (f_ops is null or cardinality(f_ops) = 0 or fd.operation_id = any (f_ops))
       and (f_cities is null or cardinality(f_cities) = 0 or fd.city_id = any (f_cities))
       and (f_leaders is null or cardinality(f_leaders) = 0 or fd.leader_id = any (f_leaders))
       and (f_veh is null or cardinality(f_veh) = 0 or fd.vehicle_id = any (f_veh))
       and (f_search is null or fd.fire_number ilike '%' || f_search || '%' or fd.license_plate ilike '%' || f_search || '%'
            or fd.fleet_number ilike '%' || f_search || '%')),
  cur as (select * from vis where vis.status = 'aberta'),
  sel as (
    select vis.*, row_number() over (order by vis.sev_rank desc, vis.rule_sort, vis.fleet_number nulls last, vis.position_code, vis.fire_number) as rn
      from vis
     where (coalesce(p_status, 'aberta') = 'todas' or vis.status = coalesce(p_status, 'aberta'))
       and (p_category is null or p_category = '' or vis.category = p_category)
       and (p_rule is null or p_rule = '' or vis.rule_code = p_rule)
       and (p_severity is null or p_severity = '' or vis.severity = p_severity)),
  grp as (
    select case coalesce(p_group_by, 'rule') when 'rule' then cur.rule_code when 'category' then cur.category when 'severity' then cur.severity
                when 'operation' then coalesce(cur.operation_id::text, '—') when 'city' then coalesce(cur.city_id::text, '—')
                else coalesce(cur.leader_id::text, '—') end as key,
           case coalesce(p_group_by, 'rule') when 'rule' then min(cur.rule_title) when 'category' then min(cur.category) when 'severity' then min(cur.severity)
                when 'operation' then coalesce(min(cur.operation_name), 'Sem operação') when 'city' then coalesce(min(cur.city_label), 'Sem local')
                else coalesce(min(cur.leader_name), 'Sem liderança') end as label,
           count(*) as findings, count(distinct coalesce(cur.tire_id::text, cur.vehicle_id::text, cur.fingerprint)) as records,
           count(*) filter (where cur.severity = 'critica') as critica, count(*) filter (where cur.severity = 'alta') as alta,
           count(*) filter (where cur.severity = 'media') as media, count(*) filter (where cur.severity = 'baixa') as baixa,
           max(cur.sev_rank) as worst, min(cur.rule_sort) as sort
      from cur
     where (p_category is null or p_category = '' or cur.category = p_category)
       and (p_severity is null or p_severity = '' or cur.severity = p_severity)
     group by 1)
  select jsonb_build_object(
    'last_scan', (select to_jsonb(s) from public.tire_audit_scans s where s.organization_id = p_organization_id order by s.started_at desc limit 1),
    'total_tires', v_total_tires,
    'kpis', jsonb_build_object(
      'open', (select count(*) from cur),
      'records', (select count(distinct coalesce(cur.tire_id::text, cur.vehicle_id::text, cur.fingerprint)) from cur),
      'tires_affected', (select count(distinct cur.tire_id) from cur where cur.tire_id is not null),
      'vehicles_affected', (select count(distinct cur.vehicle_id) from cur where cur.vehicle_id is not null),
      'pct_base', (select round(100.0 * count(distinct cur.tire_id) / nullif(v_total_tires, 0), 1) from cur where cur.tire_id is not null),
      'critical', (select count(*) from cur where cur.severity = 'critica'),
      'high', (select count(*) from cur where cur.severity = 'alta'),
      'new_7d', (select count(*) from cur where cur.first_seen_at > now() - interval '7 days'),
      'resolved_30d', (select count(*) from vis where vis.status = 'resolvida' and vis.resolved_at > now() - interval '30 days'),
      'reopened', (select count(*) from cur where cur.reopened_count > 0),
      'by_category', coalesce((select jsonb_object_agg(x.category, x.n) from (select cur.category, count(*) as n from cur group by 1) x), '{}'::jsonb),
      'by_severity', coalesce((select jsonb_object_agg(x.severity, x.n) from (select cur.severity, count(*) as n from cur group by 1) x), '{}'::jsonb)),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('code', ru.code, 'category', ru.category, 'severity', ru.severity, 'title', ru.title,
                                                           'description', ru.description, 'field', ru.field, 'expected', ru.expected,
                                                           'open', (select count(*) from cur where cur.rule_code = ru.code)) order by ru.sort)
                         from public.tire_audit_rules ru where ru.is_active), '[]'::jsonb),
    'group_by', coalesce(p_group_by, 'rule'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('key', grp.key, 'label', grp.label, 'findings', grp.findings, 'records', grp.records,
                                                            'critica', grp.critica, 'alta', grp.alta, 'media', grp.media, 'baixa', grp.baixa)
                                         order by grp.worst desc, grp.findings desc, grp.sort, grp.label) from grp), '[]'::jsonb),
    'filters', jsonb_build_object('category', p_category, 'rule', p_rule, 'severity', p_severity, 'status', coalesce(p_status, 'aberta')),
    'total', (select count(*) from sel),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sel.id, 'rule_code', sel.rule_code, 'rule_title', sel.rule_title, 'category', sel.category, 'severity', sel.severity,
        'status', sel.status, 'tire_id', sel.tire_id, 'fire_number', sel.fire_number, 'vehicle_id', sel.vehicle_id,
        'license_plate', sel.license_plate, 'fleet_number', sel.fleet_number, 'position_code', sel.position_code,
        'operation_name', sel.operation_name, 'city_label', sel.city_label, 'leader_name', sel.leader_name,
        'field', sel.field, 'found_value', sel.found_value, 'expected_value', sel.expected_value, 'detail', sel.detail,
        'first_seen_at', sel.first_seen_at, 'last_seen_at', sel.last_seen_at, 'resolved_at', sel.resolved_at,
        'first_reference_date', sel.first_reference_date, 'last_reference_date', sel.last_reference_date,
        'occurrences', sel.occurrences, 'reopened_count', sel.reopened_count) order by sel.rn)
        from sel where sel.rn > v_offset and sel.rn <= v_offset + v_limit), '[]'::jsonb),
    'limit', v_limit, 'offset', v_offset)
    into v_res;
  return v_res;
end;
$$;

do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'hfm_tires_audit_daily') then
    -- 06:20 em São Paulo (09:20 UTC): prazos envelhecem e parâmetros mudam sem nova planilha
    perform cron.schedule('hfm_tires_audit_daily', '20 9 * * *', 'select private.tire_audit_tick()');
  end if;
end $cron$;

revoke execute on function private.tire_audit_scan(uuid, text, uuid), private.tire_audit_tick() from public, anon, authenticated;
revoke execute on function public.tire_audit_rescan(uuid),
  public.tires_audit_center(uuid, jsonb, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.tire_audit_rescan(uuid),
  public.tires_audit_center(uuid, jsonb, text, text, text, text, text, integer, integer) to authenticated, service_role;
