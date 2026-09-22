-- =============================================================================
-- Etapa 12 — APLICATIVOS: travas, auditoria, RBAC e RLS
--
-- Segunda metade da fundação, aplicada como migration própria. Separada da
-- criação das tabelas porque responde a outra pergunta: a primeira diz o que
-- existe, esta diz quem pode mexer e o que o banco recusa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8. Imutabilidade da versão publicada (§43 e CA18)
--
-- "Publicada é imutável" só é verdade se o banco recusar a alteração. Uma regra
-- escrita apenas na tela é uma regra que o primeiro script contorna — e o que
-- está em jogo é a comparabilidade de toda execução já feita sob aquela versão.
--
-- O que permanece permitido numa versão publicada: arquivá-la. É mudança de
-- ciclo de vida, não de conteúdo.
-- -----------------------------------------------------------------------------
create or replace function private.tg_checklist_version_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_label  text;
begin
  if tg_table_name = 'checklist_app_versions' then
    if tg_op = 'DELETE' then
      if old.status = 'published' then
        raise exception 'A versão % já foi publicada e não pode ser excluída.', old.label
          using errcode = 'invalid_parameter_value';
      end if;
      return old;
    end if;

    if old.status = 'published' then
      -- Só a transição para 'archived' passa, e nada mais junto com ela.
      if new.status = 'archived'
         and new.major = old.major and new.minor = old.minor
         and new.app_id = old.app_id then
        return new;
      end if;
      raise exception 'A versão % já foi publicada e é imutável. Crie uma nova versão para editar.',
        old.label using errcode = 'invalid_parameter_value';
    end if;
    return new;
  end if;

  -- Filhos: cluster, pergunta, condicional e regra seguem o status da versão.
  select v.status, v.label into v_status, v_label
    from public.checklist_app_versions v
   where v.id = coalesce(new.version_id, old.version_id);

  if v_status = 'published' then
    raise exception 'A versão % já foi publicada e é imutável. Crie uma nova versão para editar.',
      v_label using errcode = 'invalid_parameter_value';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger checklist_versions_immutable
  before update or delete on public.checklist_app_versions
  for each row execute function private.tg_checklist_version_immutable();

create trigger checklist_clusters_immutable
  before insert or update or delete on public.checklist_clusters
  for each row execute function private.tg_checklist_version_immutable();

create trigger checklist_questions_immutable
  before insert or update or delete on public.checklist_questions
  for each row execute function private.tg_checklist_version_immutable();

create trigger checklist_conditionals_immutable
  before insert or update or delete on public.checklist_question_conditionals
  for each row execute function private.tg_checklist_version_immutable();

create trigger checklist_rules_immutable
  before insert or update or delete on public.checklist_question_rules
  for each row execute function private.tg_checklist_version_immutable();

-- -----------------------------------------------------------------------------
-- 9. Auditoria (§62) — configuração muda pouco e importa muito
-- -----------------------------------------------------------------------------
create trigger checklist_versions_audit
  after insert or update or delete on public.checklist_app_versions
  for each row execute function private.tg_audit();

create trigger checklist_questions_audit
  after insert or update or delete on public.checklist_questions
  for each row execute function private.tg_audit();

create trigger checklist_conditionals_audit
  after insert or update or delete on public.checklist_question_conditionals
  for each row execute function private.tg_audit();

create trigger checklist_rules_audit
  after insert or update or delete on public.checklist_question_rules
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 10. Permissões (§63)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('applications.view',                        'applications', 'Ver aplicativos',
   'Consultar os aplicativos operacionais disponíveis na organização'),
  ('applications.checklist_fleet.execute',     'applications', 'Executar Check List de Frota',
   'Realizar checklists de saída e retorno de rota'),
  ('applications.checklist_fleet.view_own',    'applications', 'Ver os próprios checklists',
   'Consultar o histórico das execuções realizadas pelo próprio colaborador'),
  ('applications.checklist_fleet.view_details','applications', 'Ver checklists do escopo',
   'Consultar execuções de outros colaboradores dentro do escopo operacional autorizado'),
  ('applications.checklist_fleet.configure',   'applications', 'Configurar Check List de Frota',
   'Editar clusters, perguntas e campos condicionais da versão de trabalho'),
  ('applications.checklist_fleet.create_version','applications', 'Criar versão do Check List',
   'Abrir uma nova versão de trabalho a partir da última versão publicada'),
  ('applications.checklist_fleet.publish',     'applications', 'Publicar versão do Check List',
   'Tornar uma versão de trabalho a versão vigente do aplicativo'),
  ('applications.checklist_fleet.manage_rules','applications', 'Gerenciar regras de aplicabilidade',
   'Definir quais perguntas se aplicam a cada tipo de equipamento e operação'),
  ('applications.checklist_fleet.view_audit',  'applications', 'Ver auditoria do Check List',
   'Ler a trilha de auditoria de configuração, publicação e execução')
on conflict (code) do nothing;

-- A matriz padrão. O gatilho `access_profile_defaults_sync` da Etapa 09 leva
-- estas linhas para os papéis reais da organização — foi criado exatamente para
-- impedir a repetição do que aconteceu na Etapa 09, quando 32 permissões
-- ficaram no catálogo e em nenhum papel, deixando módulos inteiros inalcançáveis.
insert into public.access_profile_defaults (profile_code, permission_code)
select d.profile_code, d.permission_code
  from (values
    ('administrador', 'applications.view'),
    ('administrador', 'applications.checklist_fleet.execute'),
    ('administrador', 'applications.checklist_fleet.view_own'),
    ('administrador', 'applications.checklist_fleet.view_details'),
    ('administrador', 'applications.checklist_fleet.configure'),
    ('administrador', 'applications.checklist_fleet.create_version'),
    ('administrador', 'applications.checklist_fleet.publish'),
    ('administrador', 'applications.checklist_fleet.manage_rules'),
    ('administrador', 'applications.checklist_fleet.view_audit'),

    -- Gestor de Frota administra o formulário: é quem conhece o equipamento.
    ('gestor_frota', 'applications.view'),
    ('gestor_frota', 'applications.checklist_fleet.execute'),
    ('gestor_frota', 'applications.checklist_fleet.view_own'),
    ('gestor_frota', 'applications.checklist_fleet.view_details'),
    ('gestor_frota', 'applications.checklist_fleet.configure'),
    ('gestor_frota', 'applications.checklist_fleet.create_version'),
    ('gestor_frota', 'applications.checklist_fleet.publish'),
    ('gestor_frota', 'applications.checklist_fleet.manage_rules'),
    ('gestor_frota', 'applications.checklist_fleet.view_audit'),

    -- Liderança enxerga o escopo dela e não configura o formulário (§64).
    ('lideranca_operacoes', 'applications.view'),
    ('lideranca_operacoes', 'applications.checklist_fleet.execute'),
    ('lideranca_operacoes', 'applications.checklist_fleet.view_own'),
    ('lideranca_operacoes', 'applications.checklist_fleet.view_details'),

    -- Operacional executa e vê o que fez. Nada além disso.
    ('operacional', 'applications.view'),
    ('operacional', 'applications.checklist_fleet.execute'),
    ('operacional', 'applications.checklist_fleet.view_own'),

    ('gestao',     'applications.view'),
    ('gestao',     'applications.checklist_fleet.view_details'),
    ('seguranca',  'applications.view'),
    ('seguranca',  'applications.checklist_fleet.view_details')
  ) as d(profile_code, permission_code)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 11. RLS
--
-- Leitura da configuração: quem pode executar precisa ler o formulário, e quem
-- configura precisa ler para editar. Escrita NUNCA por policy — toda alteração
-- passa pelas rotinas transacionais da migração seguinte, como nas Etapas 06-13.
-- -----------------------------------------------------------------------------
alter table public.checklist_app_versions          enable row level security;
alter table public.checklist_clusters              enable row level security;
alter table public.checklist_questions             enable row level security;
alter table public.checklist_question_conditionals enable row level security;
alter table public.checklist_question_rules        enable row level security;
alter table public.checklist_app_operations        enable row level security;

create policy checklist_versions_select on public.checklist_app_versions
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('applications.checklist_fleet.execute'))
    or organization_id in (select private.permitted_org_ids('applications.checklist_fleet.configure'))
    or organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_details'))
  );

create policy checklist_clusters_select on public.checklist_clusters
  for select to authenticated
  using (exists (select 1 from public.checklist_app_versions v where v.id = version_id));

create policy checklist_questions_select on public.checklist_questions
  for select to authenticated
  using (exists (select 1 from public.checklist_app_versions v where v.id = version_id));

create policy checklist_conditionals_select on public.checklist_question_conditionals
  for select to authenticated
  using (exists (select 1 from public.checklist_app_versions v where v.id = version_id));

create policy checklist_rules_select on public.checklist_question_rules
  for select to authenticated
  using (exists (select 1 from public.checklist_app_versions v where v.id = version_id));

create policy checklist_app_ops_select on public.checklist_app_operations
  for select to authenticated
  using (organization_id in (select private.permitted_org_ids('applications.view')));

grant select on public.checklist_app_versions, public.checklist_clusters,
                public.checklist_questions, public.checklist_question_conditionals,
                public.checklist_question_rules, public.checklist_app_operations
  to authenticated;
