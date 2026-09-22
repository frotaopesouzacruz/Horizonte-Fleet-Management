-- =============================================================================
-- Etapa 12 — configuração inicial do Check List de Frota: versão 1.0
--
-- 9 clusters, 34 perguntas, 7 campos condicionais, 2 perguntas invertidas.
-- Conteúdo funcional herdado da versão 1.1 do HFC; no HFM nasce como 1.0 (§44).
--
-- NENHUM id é escrito à mão: tipos de equipamento e operações são resolvidos
-- por código. Um seed com uuid colado funciona uma vez, no banco onde foi
-- escrito, e falha em qualquer outro.
--
-- Roda por organização e é idempotente: se o aplicativo já tem versão, pula.
-- =============================================================================
do $seed$
declare
  o           record;
  v_app       uuid;
  v_version   uuid;
  v_cluster   uuid;
  c           record;
  q           record;
  v_truck     uuid;
  v_van       uuid;
  v_merch     uuid;
begin
  for o in select id from public.organizations where deleted_at is null and status = 'active'
  loop
    insert into public.operational_apps
      (organization_id, code, name, slug, description, platform,
       is_active, is_official, is_configurable, allows_attachments)
    values
      (o.id, 'checklist_frota', 'Check List de Frota', 'check-list-frota',
       'Aplicativo de inspeção operacional da frota para saída e retorno de rota.',
       'mobile_responsive', true, true, true, false)
    on conflict (organization_id, code) do update
      set slug = excluded.slug,
          name = excluded.name,
          description = excluded.description,
          is_official = true,
          is_configurable = true,
          allows_attachments = false
    returning id into v_app;

    if exists (select 1 from public.checklist_app_versions where app_id = v_app) then
      continue;
    end if;

    select id into v_truck from public.vehicle_types
     where code = 'truck' and (organization_id = o.id or organization_id is null)
       and deleted_at is null limit 1;
    select id into v_van from public.vehicle_types
     where code = 'van' and (organization_id = o.id or organization_id is null)
       and deleted_at is null limit 1;
    select id into v_merch from public.operations
     where organization_id = o.id and code = 'OP-00005' and deleted_at is null limit 1;

    insert into public.checklist_app_versions
      (organization_id, app_id, major, minor, status, notes, source_note,
       min_duration_seconds, max_duration_seconds)
    values
      (o.id, v_app, 1, 0, 'draft',
       'Configuração inicial do Check List de Frota no HFM.',
       'Conteúdo funcional herdado da versão 1.1 do Horizonte Fleet Command: 9 clusters, 34 perguntas, 7 campos condicionais.',
       60, 600)
    returning id into v_version;

    for c in
      select * from (values
        ('5s',          '5S',                       1),
        ('funilaria',   'Funilaria',                2),
        ('extintor',    'Extintor',                 3),
        ('implementos', 'Implementos / Carroceria', 4),
        ('seguranca',   'Itens de Segurança',       5),
        ('luzes',       'Luzes e Sinalização',      6),
        ('mecanica',    'Mecânica',                 7),
        ('pneus',       'Pneus',                    8),
        ('qualidade',   'Qualidade',                9)
      ) as t(cluster_key, name, sort_order)
    loop
      insert into public.checklist_clusters
        (organization_id, version_id, cluster_key, name, sort_order, is_required)
      values (o.id, v_version, c.cluster_key, c.name, c.sort_order, true);
    end loop;

    -- `conforming_answer` é 'no' nas DUAS invertidas — avaria e problema
    -- mecânico. Uma regra global "SIM = conforme" aprovaria um veículo avariado.
    for q in
      select * from (values
        ('5s','5s.limpeza_externa',1,'A frota está limpa externamente?','yes','media'),
        ('5s','5s.limpeza_interna',2,'A frota está limpa internamente, incluindo a cabine?','yes','media'),
        ('funilaria','funilaria.avaria',1,'Possui alguma avaria? Exemplo: amassado, arranhão, quebra ou dano aparente.','no','media'),
        ('extintor','extintor.validade_pressao',1,'O extintor de incêndio do veículo está dentro do prazo de validade e pressurizado na faixa verde?','yes','critica'),
        ('extintor','extintor.capacidade_8kg',2,'O veículo possui extintor de incêndio de 8 kg?','yes','critica'),
        ('implementos','implementos.camera_re',1,'A câmera de ré está funcionando?','yes','media'),
        ('implementos','implementos.sirene_re',2,'A sirene de ré está funcionando?','yes','media'),
        ('implementos','implementos.plataforma_hidraulica',3,'A plataforma hidráulica elevatória está funcionando?','yes','media'),
        ('implementos','implementos.controle_auxiliar',4,'O controle auxiliar, também conhecido como mão amiga, está funcionando?','yes','media'),
        ('implementos','implementos.prateleiras',5,'As prateleiras estão em boas condições?','yes','media'),
        ('implementos','implementos.tela_multimidia',6,'A tela multimídia está funcionando?','yes','media'),
        ('seguranca','seguranca.cintos',1,'As travas dos cintos de segurança estão funcionando?','yes','critica'),
        ('seguranca','seguranca.limpadores',2,'Os limpadores de para-brisa estão funcionando?','yes','media'),
        ('seguranca','seguranca.alarme',3,'O alarme está funcionando?','yes','media'),
        ('seguranca','seguranca.buzina',4,'A buzina está funcionando?','yes','media'),
        ('seguranca','seguranca.macaco',5,'O veículo possui macaco hidráulico?','yes','media'),
        ('seguranca','seguranca.chave_roda',6,'O veículo possui chave de roda?','yes','media'),
        ('seguranca','seguranca.carregador_celular',7,'O carregador de celular está funcionando?','yes','media'),
        ('luzes','luzes.freio',1,'As luzes de freio estão funcionando?','yes','critica'),
        ('luzes','luzes.farois',2,'Os faróis estão funcionando?','yes','media'),
        ('luzes','luzes.setas',3,'As setas estão funcionando?','yes','media'),
        ('luzes','luzes.re',4,'As luzes de ré estão funcionando?','yes','media'),
        ('mecanica','mecanica.freios_servico',1,'Os freios de serviço estão funcionando?','yes','critica'),
        ('mecanica','mecanica.freio_estacionario',2,'O freio estacionário, também conhecido como freio de mão, está funcionando?','yes','critica'),
        ('mecanica','mecanica.nivel_oleo',3,'O nível de óleo do motor está adequado?','yes','media'),
        ('mecanica','mecanica.problema_mecanico',4,'A frota apresenta algum problema mecânico? Exemplo: câmbio, embreagem, motor ou ruído anormal.','no','critica'),
        ('mecanica','mecanica.nivel_agua_radiador',5,'O nível de água do radiador está adequado?','yes','media'),
        ('mecanica','mecanica.nivel_arla',6,'O nível de ARLA está adequado?','yes','media'),
        ('pneus','pneus.dianteiros',1,'Os pneus dianteiros estão em boas condições?','yes','critica'),
        ('pneus','pneus.traseiros',2,'Os pneus traseiros estão em boas condições?','yes','critica'),
        ('pneus','pneus.estepe',3,'O veículo possui estepe?','yes','media'),
        ('qualidade','qualidade.inspecao_mercadoria',1,'A mercadoria foi inspecionada visualmente antes do carregamento para garantir que não há danos visíveis?','yes','media'),
        ('qualidade','qualidade.embalagens',2,'Todas as embalagens estão intactas e adequadas para proteger os produtos durante o transporte?','yes','media'),
        ('qualidade','qualidade.verificacoes_previas',3,'Foram realizadas verificações prévias no veículo para garantir a ausência de condições que possam afetar a qualidade da mercadoria?','yes','media')
      ) as t(cluster_key, question_key, sort_order, question_text, conforming_answer, criticality)
    loop
      select id into v_cluster from public.checklist_clusters
       where version_id = v_version and cluster_key = q.cluster_key;

      insert into public.checklist_questions
        (organization_id, version_id, cluster_id, question_key, sort_order, question_text,
         answer_type, conforming_answer, criticality, is_required,
         generates_action_plan, allows_note, note_required, status)
      values
        (o.id, v_version, v_cluster, q.question_key, q.sort_order, q.question_text,
         'yes_no', q.conforming_answer, q.criticality, true, true, true, false, 'active');
    end loop;

    -- Os 7 campos condicionais (§25).
    insert into public.checklist_question_conditionals
      (organization_id, version_id, question_id, field_key, trigger_answer, label, field_type, is_required, options)
    select o.id, v_version, qq.id, d.field_key, d.trigger_answer, d.label, d.field_type, true, d.options
      from (values
        ('funilaria.avaria', 'descricao_avaria', 'yes',
         'Descreva a avaria identificada.', 'text', '[]'::jsonb),
        ('implementos.prateleiras', 'local_inconformidade', 'no',
         'Onde está a inconformidade?', 'single_select',
         '[{"value":"bau_lateral","label":"Baú lateral"},{"value":"bau_traseiro","label":"Baú traseiro"}]'::jsonb),
        ('luzes.freio', 'lado_falha', 'no',
         'Qual lado apresenta falha?', 'single_select',
         '[{"value":"esquerdo","label":"Esquerdo"},{"value":"direito","label":"Direito"}]'::jsonb),
        ('luzes.farois', 'itens_falha', 'no',
         'Qual item apresenta falha?', 'multi_select',
         '[{"value":"farol_esquerdo","label":"Farol esquerdo"},{"value":"farol_direito","label":"Farol direito"},{"value":"milha_esquerdo","label":"Milha esquerdo"},{"value":"milha_direito","label":"Milha direito"}]'::jsonb),
        ('luzes.setas', 'setas_falha', 'no',
         'Qual seta apresenta falha?', 'multi_select',
         '[{"value":"dianteira_esquerda","label":"Dianteira esquerda"},{"value":"dianteira_direita","label":"Dianteira direita"},{"value":"traseira_esquerda","label":"Traseira esquerda"},{"value":"traseira_direita","label":"Traseira direita"}]'::jsonb),
        ('luzes.re', 'lado_falha', 'no',
         'Qual lado apresenta falha?', 'single_select',
         '[{"value":"esquerdo","label":"Esquerdo"},{"value":"direito","label":"Direito"}]'::jsonb),
        ('mecanica.problema_mecanico', 'descricao_problema', 'yes',
         'Descreva o problema mecânico identificado.', 'text', '[]'::jsonb)
      ) as d(question_key, field_key, trigger_answer, label, field_type, options)
      join public.checklist_questions qq
        on qq.version_id = v_version and qq.question_key = d.question_key;

    -- Regras de aplicabilidade por VÍNCULO (§23), nunca por texto.
    if v_truck is not null then
      insert into public.checklist_question_rules
        (organization_id, version_id, question_id, rule_kind, mode, vehicle_type_id)
      select o.id, v_version, qq.id, 'vehicle_type', 'include', v_truck
        from public.checklist_questions qq
       where qq.version_id = v_version
         and qq.question_key in ('implementos.plataforma_hidraulica',
                                 'implementos.controle_auxiliar',
                                 'mecanica.nivel_arla');
    end if;

    if v_van is not null then
      insert into public.checklist_question_rules
        (organization_id, version_id, question_id, rule_kind, mode, vehicle_type_id)
      select o.id, v_version, qq.id, 'vehicle_type', 'include', v_van
        from public.checklist_questions qq
       where qq.version_id = v_version
         and qq.question_key in ('implementos.prateleiras', 'mecanica.nivel_arla');
    end if;

    -- §16: orientação, não restrição. A pergunta segue valendo em toda operação.
    if v_merch is not null then
      insert into public.checklist_question_rules
        (organization_id, version_id, question_id, rule_kind, mode, operation_id, guidance)
      select o.id, v_version, qq.id, 'operation', 'guidance', v_merch,
             'Nesta operação os veículos podem não sair de fábrica com este equipamento. Conforme regra operacional aprovada, responda SIM quando o veículo não o possuir.'
        from public.checklist_questions qq
       where qq.version_id = v_version
         and qq.question_key in ('implementos.camera_re', 'implementos.sirene_re');
    end if;

    insert into public.checklist_app_operations (organization_id, app_id, operation_id, is_enabled)
    select o.id, v_app, op.id, true
      from public.operations op
     where op.organization_id = o.id and op.deleted_at is null and op.status = 'active'
    on conflict do nothing;

    -- Publica. Daqui em diante a versão é imutável (§43).
    update public.checklist_app_versions
       set status = 'published', published_at = now()
     where id = v_version;
  end loop;
end
$seed$;
