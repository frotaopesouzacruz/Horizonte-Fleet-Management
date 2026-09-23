-- =============================================================================
-- Etapa 12 · Check List de Frota — correção administrativa de execução enviada
-- (§60, §62) e vigência na validação da publicação (§46)
--
-- Aditiva. Nenhuma coluna existente muda, nenhum dado é apagado, nenhuma
-- execução é reescrita por esta migration.
--
--  1. Permissão `applications.checklist_fleet.correct` — padrão só em
--     Administrador e Gestor de Frota (o gatilho de sincronização da Etapa 09 a
--     leva aos papéis reais).
--  2. `checklist_execution_corrections` (cabeçalho: motivo, ator, quando,
--     resumo antes/depois) e `checklist_execution_correction_items` (antes e
--     depois POR PERGUNTA: resposta, conformidade, campo condicional,
--     observação). As duas são imutáveis — nem o dono da tabela altera ou
--     apaga —, têm RLS de leitura (quem vê a execução vê a correção) e nenhuma
--     permissão de escrita direta. Auditoria oficial (`private.tg_audit`) nas
--     duas.
--  3. A selagem do enviado fica mais estrita:
--       · sem o portão `hfm.checklist_correction`, NADA muda numa execução
--         enviada (antes, só alguns campos eram vigiados);
--       · com o portão, só os contadores de conformidade mudam na execução, só
--         resposta/conformidade/condicional/observação mudam na resposta e só
--         `non_conforming` muda no resumo por cluster;
--       · identidade (veículo, data, tipo saída/retorno, operação, BR,
--         colaborador, versão, pergunta respondida) NUNCA muda, nem com o
--         portão: é ela que a Aderência concilia;
--       · execução enviada não muda de situação; resposta e resumo de execução
--         enviada nunca são excluídos.
--  4. `correct_checklist_execution` — a rotina: motivo obrigatório, prévia
--     exata (`dry_run`), antes/depois preservado, resumo de conformidade
--     recalculado pela regra DA PERGUNTA (§11), numa transação.
--  5. Leituras: `checklist_execution_correction_form` (o que pode ser
--     corrigido, com a definição do campo condicional) e
--     `checklist_execution_detail` acrescido do histórico de correções.
--  6. `validate_checklist_version` passa a contar só vínculos de operação
--     VIGENTES hoje (antes: `is_enabled` sem olhar `effective_from/to`).
--
-- FORA DO ESCOPO DESTE PROCEDIMENTO, de propósito: veículo, data operacional,
-- tipo (saída/retorno), operação, BR e colaborador. São a identidade da
-- execução e alimentam a conciliação da Aderência (obrigação do veículo no dia
-- e no contexto). Corrigi-los aqui reescreveria em silêncio uma obrigação já
-- conciliada; o procedimento os recusa e o banco os sela.
--
-- Sem anexo (§26): a correção não aceita, não guarda e não referencia foto,
-- arquivo ou evidência. Só texto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissão
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, name, description) values
  ('applications.checklist_fleet.correct', 'applications', 'Corrigir execução do Check List',
   'Corrigir respostas, campos condicionais e observações de um checklist já enviado, com motivo obrigatório e trilha auditada (antes e depois)')
on conflict (code) do nothing;

insert into public.access_profile_defaults (profile_code, permission_code) values
  ('administrador', 'applications.checklist_fleet.correct'),
  ('gestor_frota',  'applications.checklist_fleet.correct')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Registro das correções
-- -----------------------------------------------------------------------------
create table if not exists public.checklist_execution_corrections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  execution_id      uuid not null references public.checklist_executions (id) on delete restrict,
  -- 1ª, 2ª, 3ª correção da mesma execução.
  sequence          smallint not null,
  reason            text not null,
  -- O ator é quem está na sessão, nunca "Sistema". O nome fica congelado: a
  -- trilha continua legível mesmo que o perfil mude de nome depois.
  corrected_by      uuid not null references auth.users (id) on delete restrict,
  corrected_by_name text,
  corrected_at      timestamptz not null default now(),
  items_count       smallint not null,
  -- {applicable, answered, conforming, non_conforming, critical_non_conforming}
  summary_before    jsonb not null,
  summary_after     jsonb not null,

  constraint checklist_correction_reason_check check (length(btrim(reason)) between 10 and 1000),
  constraint checklist_correction_sequence_check check (sequence > 0),
  constraint checklist_correction_items_check check (items_count > 0)
);

create unique index if not exists checklist_correction_sequence_unique
  on public.checklist_execution_corrections (execution_id, sequence);
create index if not exists checklist_correction_org_idx
  on public.checklist_execution_corrections (organization_id, corrected_at desc);

comment on table public.checklist_execution_corrections is
  'Correção administrativa de um Check List de Frota já enviado (§60): motivo, ator, data e resumo de '
  'conformidade antes/depois. Imutável. Não altera a identidade da execução (veículo, data, tipo, operação, BR).';

create table if not exists public.checklist_execution_correction_items (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  correction_id            uuid not null references public.checklist_execution_corrections (id) on delete restrict,
  execution_id             uuid not null references public.checklist_executions (id) on delete restrict,
  answer_id                uuid not null references public.checklist_execution_answers (id) on delete restrict,
  question_id              uuid not null references public.checklist_questions (id) on delete restrict,
  question_key             text not null,
  cluster_key              text not null,
  question_text_snapshot   text not null,
  criticality              text not null,
  -- Subconjunto de {answer, conditional_value, note}: o que de fato mudou.
  changed_fields           text[] not null,
  answer_before            text not null,
  answer_after             text not null,
  is_conforming_before     boolean not null,
  is_conforming_after      boolean not null,
  conditional_value_before jsonb,
  conditional_value_after  jsonb,
  note_before              text,
  note_after               text,

  constraint checklist_correction_item_answer_check
    check (answer_before in ('yes', 'no') and answer_after in ('yes', 'no')),
  constraint checklist_correction_item_fields_check
    check (cardinality(changed_fields) > 0
           and changed_fields <@ array['answer', 'conditional_value', 'note']::text[])
);

create unique index if not exists checklist_correction_item_unique
  on public.checklist_execution_correction_items (correction_id, answer_id);
create index if not exists checklist_correction_item_exec_idx
  on public.checklist_execution_correction_items (execution_id);
create index if not exists checklist_correction_item_answer_idx
  on public.checklist_execution_correction_items (answer_id);
create index if not exists checklist_correction_item_question_idx
  on public.checklist_execution_correction_items (question_id);

comment on table public.checklist_execution_correction_items is
  'Antes e depois de cada pergunta corrigida numa correção administrativa (§60, §62). Imutável.';

-- RLS: quem vê a execução vê as correções dela (a política da execução já
-- exige view_own do próprio colaborador ou view_details no escopo). Nenhuma
-- política de escrita: só a rotina `security definer` grava.
alter table public.checklist_execution_corrections      enable row level security;
alter table public.checklist_execution_correction_items enable row level security;

drop policy if exists checklist_corrections_select on public.checklist_execution_corrections;
create policy checklist_corrections_select on public.checklist_execution_corrections
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('applications.view'))
    and exists (select 1 from public.checklist_executions e
                 where e.id = execution_id
                   and e.organization_id = checklist_execution_corrections.organization_id)
  );

drop policy if exists checklist_correction_items_select on public.checklist_execution_correction_items;
create policy checklist_correction_items_select on public.checklist_execution_correction_items
  for select to authenticated
  using (
    organization_id in (select private.permitted_org_ids('applications.view'))
    and exists (select 1 from public.checklist_executions e
                 where e.id = execution_id
                   and e.organization_id = checklist_execution_correction_items.organization_id)
  );

revoke all on public.checklist_execution_corrections, public.checklist_execution_correction_items from anon;
revoke insert, update, delete, truncate
  on public.checklist_execution_corrections, public.checklist_execution_correction_items from authenticated;
grant select on public.checklist_execution_corrections, public.checklist_execution_correction_items to authenticated;

create or replace function private.tg_checklist_correction_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O registro de correção administrativa é imutável. Uma nova correção entra como um novo registro.'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function private.tg_checklist_correction_immutable() from public, anon;

drop trigger if exists checklist_corrections_immutable on public.checklist_execution_corrections;
create trigger checklist_corrections_immutable
  before update or delete on public.checklist_execution_corrections
  for each row execute function private.tg_checklist_correction_immutable();

drop trigger if exists checklist_correction_items_immutable on public.checklist_execution_correction_items;
create trigger checklist_correction_items_immutable
  before update or delete on public.checklist_execution_correction_items
  for each row execute function private.tg_checklist_correction_immutable();

drop trigger if exists checklist_corrections_audit on public.checklist_execution_corrections;
create trigger checklist_corrections_audit
  after insert or update or delete on public.checklist_execution_corrections
  for each row execute function private.tg_audit();

drop trigger if exists checklist_correction_items_audit on public.checklist_execution_correction_items;
create trigger checklist_correction_items_audit
  after insert or update or delete on public.checklist_execution_correction_items
  for each row execute function private.tg_audit();

-- -----------------------------------------------------------------------------
-- 3. Selagem do enviado, mais estrita
-- -----------------------------------------------------------------------------
create or replace function private.tg_checklist_execution_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- O que a correção administrativa pode mudar na execução: o resumo de
  -- conformidade, recalculado pela regra da pergunta. Nada mais.
  c_correctable constant text[] := array[
    'conforming_answers', 'non_conforming_answers', 'critical_non_conforming', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Uma execução enviada não pode ser excluída.'
      using errcode = 'invalid_parameter_value';
  end if;

  if old.status = 'submitted' then
    if new.status is distinct from old.status then
      raise exception 'Uma execução enviada não muda de situação.'
        using errcode = 'invalid_parameter_value';
    end if;
    if current_setting('hfm.checklist_correction', true) is distinct from 'on' then
      if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
        raise exception 'Esta execução já foi enviada. Use o procedimento de correção administrativa.'
          using errcode = 'invalid_parameter_value';
      end if;
    elsif (to_jsonb(new) - c_correctable) is distinct from (to_jsonb(old) - c_correctable) then
      raise exception 'A correção administrativa não altera a identidade da execução (veículo, data, tipo saída/retorno, operação, BR, colaborador e versão).'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.tg_checklist_answers_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  c_correctable constant text[] := array['answer', 'is_conforming', 'conditional_value', 'note'];
begin
  select e.status into v_status from public.checklist_executions e
   where e.id = coalesce(new.execution_id, old.execution_id);
  if v_status = 'submitted' then
    if tg_op = 'DELETE' then
      raise exception 'As respostas de uma execução enviada não podem ser excluídas.'
        using errcode = 'invalid_parameter_value';
    end if;
    if current_setting('hfm.checklist_correction', true) is distinct from 'on' then
      raise exception 'As respostas de uma execução enviada não podem ser alteradas.'
        using errcode = 'invalid_parameter_value';
    end if;
    if (to_jsonb(new) - c_correctable) is distinct from (to_jsonb(old) - c_correctable) then
      raise exception 'A correção administrativa altera só a resposta, o campo condicional e a observação; a pergunta respondida não muda.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- O resumo por cluster não tinha selagem própria.
create or replace function private.tg_checklist_exec_clusters_sealed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select e.status into v_status from public.checklist_executions e
   where e.id = coalesce(new.execution_id, old.execution_id);
  if v_status = 'submitted' then
    if tg_op = 'DELETE' then
      raise exception 'O resumo por cluster de uma execução enviada não pode ser excluído.'
        using errcode = 'invalid_parameter_value';
    end if;
    if current_setting('hfm.checklist_correction', true) is distinct from 'on' then
      raise exception 'O resumo por cluster de uma execução enviada não pode ser alterado.'
        using errcode = 'invalid_parameter_value';
    end if;
    if (to_jsonb(new) - 'non_conforming') is distinct from (to_jsonb(old) - 'non_conforming') then
      raise exception 'A correção administrativa só recalcula as inconformidades do cluster.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function private.tg_checklist_exec_clusters_sealed() from public, anon;

drop trigger if exists checklist_exec_clusters_sealed on public.checklist_execution_clusters;
create trigger checklist_exec_clusters_sealed
  before update or delete on public.checklist_execution_clusters
  for each row execute function private.tg_checklist_exec_clusters_sealed();

-- -----------------------------------------------------------------------------
-- 4. A rotina de correção
--
-- payload: {
--   execution_id, reason (10–1000 caracteres), dry_run (opcional),
--   items: [{ question_id, answer?, conditional_value?, note? }]
-- }
-- Qualquer outra chave — vehicle_id, operational_date, checklist_type,
-- operation_id, operation_br_id, employee_id, version_id… — é recusada.
--
-- Regras, as mesmas do envio:
--   · resposta SIM/NÃO; a conformidade é recalculada pela resposta conforme DA
--     PERGUNTA (§11) — as invertidas continuam invertidas;
--   · o condicional só existe quando a resposta o aciona; trocar a resposta
--     descarta o valor anterior (§25); acionado e obrigatório, precisa de
--     valor; escolha só entre as opções da pergunta;
--   · observação até 2000 caracteres; pergunta que não aceita observação não
--     ganha uma.
-- Item sem mudança é recusado: a trilha registra só o que mudou.
-- -----------------------------------------------------------------------------
create or replace function public.correct_checklist_execution(
  p_organization_id uuid,
  p_payload         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := auth.uid();
  v_reason    text;
  v_items     jsonb;
  v_dry       boolean;
  v_exec_id   uuid;
  e           public.checklist_executions;
  it          jsonb;
  a           record;
  cd          record;
  v_forbidden text;
  v_qid       uuid;
  v_seen      uuid[] := '{}';
  v_answer    text;
  v_cond      jsonb;
  v_val       jsonb;
  v_text      text;
  v_note      text;
  v_fields    text[];
  v_plan      jsonb := '[]'::jsonb;
  v_before    jsonb;
  v_after     jsonb;
  v_seq       integer;
  v_corr      uuid;
  v_name      text;
  v_now       timestamptz := now();
begin
  if v_actor is null then
    raise exception 'Sessão não identificada. Entre novamente para corrigir o checklist.'
      using errcode = 'insufficient_privilege';
  end if;
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.correct') then
    raise exception 'Você não possui permissão para corrigir execuções do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Correção inválida.' using errcode = 'invalid_parameter_value';
  end if;

  -- A identidade da execução não passa por aqui (ver cabeçalho).
  select string_agg(k, ', ' order by k) into v_forbidden
    from jsonb_object_keys(p_payload) k
   where k not in ('execution_id', 'reason', 'items', 'dry_run');
  if v_forbidden is not null then
    raise exception 'A correção administrativa altera apenas respostas, campos condicionais e observações. Veículo, data, tipo (saída/retorno), operação, BR, colaborador e versão não são corrigidos por este procedimento (recebido: %).',
      v_forbidden using errcode = 'invalid_parameter_value';
  end if;

  v_reason := btrim(coalesce(p_payload ->> 'reason', ''));
  if length(v_reason) < 10 then
    raise exception 'Informe o motivo da correção administrativa (pelo menos 10 caracteres).'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'O motivo da correção deve ter no máximo 1000 caracteres.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_items := p_payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Escolha ao menos um item para corrigir.' using errcode = 'invalid_parameter_value';
  end if;
  v_dry := coalesce((p_payload ->> 'dry_run')::boolean, false);
  v_exec_id := nullif(p_payload ->> 'execution_id', '')::uuid;

  -- Trava a execução: duas correções simultâneas não podem cruzar.
  select * into e from public.checklist_executions x
   where x.id = v_exec_id and x.organization_id = p_organization_id
   for update;
  if e.id is null then
    raise exception 'Execução não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if e.status <> 'submitted' then
    raise exception 'Só um checklist enviado recebe correção administrativa.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_operation(e.operation_id) then
    raise exception 'Esta execução não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  for it in select value from jsonb_array_elements(v_items)
  loop
    if jsonb_typeof(it) <> 'object' then
      raise exception 'Item de correção inválido.' using errcode = 'invalid_parameter_value';
    end if;
    select string_agg(k, ', ' order by k) into v_forbidden
      from jsonb_object_keys(it) k
     where k not in ('question_id', 'answer', 'conditional_value', 'note');
    if v_forbidden is not null then
      raise exception 'Um item de correção altera só a resposta, o campo condicional e a observação (recebido: %).',
        v_forbidden using errcode = 'invalid_parameter_value';
    end if;

    v_qid := nullif(it ->> 'question_id', '')::uuid;
    if v_qid is null then
      raise exception 'Item de correção sem pergunta.' using errcode = 'invalid_parameter_value';
    end if;
    if v_qid = any (v_seen) then
      raise exception 'A mesma pergunta aparece duas vezes na correção.' using errcode = 'invalid_parameter_value';
    end if;
    v_seen := v_seen || v_qid;

    select an.id, an.question_id, an.question_key, an.cluster_key, an.question_text_snapshot,
           an.criticality, an.answer, an.is_conforming, an.conditional_value, an.note,
           q.conforming_answer, q.allows_note
      into a
      from public.checklist_execution_answers an
      join public.checklist_questions q on q.id = an.question_id
     where an.execution_id = e.id and an.question_id = v_qid;
    if a.id is null then
      raise exception 'Esta pergunta não foi respondida nesta execução; a correção altera respostas existentes.'
        using errcode = 'invalid_parameter_value';
    end if;

    select c.field_key, c.trigger_answer, c.label, c.field_type, c.is_required, c.options
      into cd
      from public.checklist_question_conditionals c
     where c.question_id = a.question_id
     order by c.sort_order
     limit 1;

    -- Resposta
    v_answer := coalesce(nullif(it ->> 'answer', ''), a.answer);
    if v_answer not in ('yes', 'no') then
      raise exception 'Resposta inválida para "%": %.', left(a.question_text_snapshot, 80), it ->> 'answer'
        using errcode = 'invalid_parameter_value';
    end if;

    -- Campo condicional (§25)
    if cd.field_key is null then
      if it ? 'conditional_value' and jsonb_typeof(it -> 'conditional_value') = 'object'
         and it -> 'conditional_value' <> '{}'::jsonb then
        raise exception '"%" não possui campo condicional.', left(a.question_text_snapshot, 80)
          using errcode = 'invalid_parameter_value';
      end if;
      v_cond := null;
    elsif v_answer <> cd.trigger_answer then
      -- A resposta não aciona o campo: o valor anterior é descartado.
      v_cond := null;
    else
      if it ? 'conditional_value' then
        v_cond := case when jsonb_typeof(it -> 'conditional_value') = 'object'
                       then it -> 'conditional_value' end;
      elsif v_answer = a.answer then
        v_cond := a.conditional_value;
      else
        v_cond := null;
      end if;

      if v_cond is not null then
        if exists (select 1 from jsonb_object_keys(v_cond) k where k <> cd.field_key) then
          raise exception 'O campo condicional de "%" é "%".', left(a.question_text_snapshot, 80), cd.label
            using errcode = 'invalid_parameter_value';
        end if;
        v_val := v_cond -> cd.field_key;

        if v_val is null or v_val = 'null'::jsonb then
          v_cond := null;
        elsif cd.field_type = 'text' then
          if jsonb_typeof(v_val) <> 'string' then
            raise exception '"%" espera um texto.', cd.label using errcode = 'invalid_parameter_value';
          end if;
          v_text := btrim(v_val #>> '{}');
          if v_text = '' then
            v_cond := null;
          elsif length(v_text) > 2000 then
            raise exception '"%" aceita no máximo 2000 caracteres.', cd.label using errcode = 'invalid_parameter_value';
          else
            v_cond := jsonb_build_object(cd.field_key, v_text);
          end if;
        elsif cd.field_type = 'single_select' then
          if jsonb_typeof(v_val) <> 'string' then
            raise exception '"%" espera uma única opção.', cd.label using errcode = 'invalid_parameter_value';
          end if;
          v_text := v_val #>> '{}';
          if v_text = '' then
            v_cond := null;
          elsif not exists (select 1 from jsonb_array_elements(cd.options) o where o ->> 'value' = v_text) then
            raise exception 'Opção inválida para "%": %.', cd.label, v_text using errcode = 'invalid_parameter_value';
          else
            v_cond := jsonb_build_object(cd.field_key, v_text);
          end if;
        else
          if jsonb_typeof(v_val) <> 'array' then
            raise exception '"%" espera uma lista de opções.', cd.label using errcode = 'invalid_parameter_value';
          end if;
          if exists (select 1 from jsonb_array_elements(v_val) x
                      where jsonb_typeof(x) <> 'string'
                         or not exists (select 1 from jsonb_array_elements(cd.options) o
                                         where o ->> 'value' = x #>> '{}')) then
            raise exception 'Há opção inválida para "%".', cd.label using errcode = 'invalid_parameter_value';
          end if;
          -- Na ordem das opções da pergunta, sem repetição.
          select jsonb_agg(opt.val ->> 'value' order by opt.ord) into v_val
            from jsonb_array_elements(cd.options) with ordinality as opt(val, ord)
           where exists (select 1 from jsonb_array_elements(v_val) x where x #>> '{}' = opt.val ->> 'value');
          v_cond := case when v_val is null then null else jsonb_build_object(cd.field_key, v_val) end;
        end if;
      end if;

      if v_cond is null and cd.is_required then
        raise exception 'Preencha "%": o campo é obrigatório quando a resposta de "%" é %.',
          cd.label, left(a.question_text_snapshot, 80),
          case cd.trigger_answer when 'yes' then 'SIM' else 'NÃO' end
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    -- Observação
    if it ? 'note' then
      v_note := nullif(btrim(coalesce(it ->> 'note', '')), '');
      if length(v_note) > 2000 then
        raise exception 'A observação deve ter no máximo 2000 caracteres.' using errcode = 'invalid_parameter_value';
      end if;
      if v_note is not null and v_note is distinct from a.note and not a.allows_note then
        raise exception '"%" não aceita observação.', left(a.question_text_snapshot, 80)
          using errcode = 'invalid_parameter_value';
      end if;
    else
      v_note := a.note;
    end if;

    v_fields := array_remove(array[
      case when v_answer is distinct from a.answer then 'answer' end,
      case when v_cond is distinct from a.conditional_value then 'conditional_value' end,
      case when v_note is distinct from a.note then 'note' end], null);
    if cardinality(v_fields) = 0 then
      raise exception 'Nada muda em "%": altere a resposta, o campo condicional ou a observação, ou retire o item da correção.',
        left(a.question_text_snapshot, 80) using errcode = 'invalid_parameter_value';
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'answer_id', a.id,
      'question_id', a.question_id,
      'question_key', a.question_key,
      'cluster_key', a.cluster_key,
      'question_text', a.question_text_snapshot,
      'criticality', a.criticality,
      'changed_fields', to_jsonb(v_fields),
      'before', jsonb_build_object(
        'answer', a.answer, 'is_conforming', a.is_conforming,
        'conditional_value', a.conditional_value, 'note', a.note),
      'after', jsonb_build_object(
        'answer', v_answer,
        -- §11: a conformidade é da PERGUNTA.
        'is_conforming', v_answer = a.conforming_answer,
        'conditional_value', v_cond, 'note', v_note)));
  end loop;

  v_before := jsonb_build_object(
    'applicable', e.applicable_questions,
    'answered', e.answered_questions,
    'conforming', e.conforming_answers,
    'non_conforming', e.non_conforming_answers,
    'critical_non_conforming', e.critical_non_conforming);

  select jsonb_build_object(
           'applicable', e.applicable_questions,
           'answered', e.answered_questions,
           'conforming', count(*) filter (where s.conf),
           'non_conforming', count(*) filter (where not s.conf),
           'critical_non_conforming', count(*) filter (where not s.conf and s.criticality = 'critica'))
    into v_after
    from (select an.criticality,
                 coalesce((p.item -> 'after' ->> 'is_conforming')::boolean, an.is_conforming) as conf
            from public.checklist_execution_answers an
            left join lateral (
              select x as item from jsonb_array_elements(v_plan) x
               where (x ->> 'answer_id')::uuid = an.id) p on true
           where an.execution_id = e.id) s;

  -- Prévia exata: a mesma validação e o mesmo cálculo, sem gravar nada.
  if v_dry then
    return jsonb_build_object(
      'dry_run', true, 'execution_id', e.id, 'items', v_plan,
      'summary_before', v_before, 'summary_after', v_after);
  end if;

  -- O portão abre só aqui dentro, para esta transação, e fecha antes de sair.
  perform set_config('hfm.checklist_correction', 'on', true);

  update public.checklist_execution_answers an
     set answer = p.item -> 'after' ->> 'answer',
         is_conforming = (p.item -> 'after' ->> 'is_conforming')::boolean,
         conditional_value = case when jsonb_typeof(p.item -> 'after' -> 'conditional_value') = 'object'
                                  then p.item -> 'after' -> 'conditional_value' end,
         note = p.item -> 'after' ->> 'note'
    from (select x as item from jsonb_array_elements(v_plan) x) p
   where an.id = (p.item ->> 'answer_id')::uuid
     and an.execution_id = e.id;

  update public.checklist_execution_clusters ec
     set non_conforming = s.nc
    from (select an.cluster_key, count(*) filter (where an.is_conforming = false) as nc
            from public.checklist_execution_answers an
           where an.execution_id = e.id
           group by an.cluster_key) s
   where ec.execution_id = e.id
     and ec.cluster_key = s.cluster_key
     and ec.non_conforming is distinct from s.nc;

  update public.checklist_executions
     set conforming_answers = (v_after ->> 'conforming')::smallint,
         non_conforming_answers = (v_after ->> 'non_conforming')::smallint,
         critical_non_conforming = (v_after ->> 'critical_non_conforming')::smallint,
         updated_at = v_now
   where id = e.id;

  select coalesce(max(c.sequence), 0) + 1 into v_seq
    from public.checklist_execution_corrections c where c.execution_id = e.id;
  select coalesce(nullif(btrim(p.display_name), ''), p.full_name) into v_name
    from public.profiles p where p.user_id = v_actor;

  insert into public.checklist_execution_corrections (
    organization_id, execution_id, sequence, reason, corrected_by, corrected_by_name,
    corrected_at, items_count, summary_before, summary_after)
  values (
    p_organization_id, e.id, v_seq, v_reason, v_actor, v_name,
    v_now, jsonb_array_length(v_plan), v_before, v_after)
  returning id into v_corr;

  insert into public.checklist_execution_correction_items (
    organization_id, correction_id, execution_id, answer_id, question_id, question_key, cluster_key,
    question_text_snapshot, criticality, changed_fields,
    answer_before, answer_after, is_conforming_before, is_conforming_after,
    conditional_value_before, conditional_value_after, note_before, note_after)
  select p_organization_id, v_corr, e.id, (x ->> 'answer_id')::uuid, (x ->> 'question_id')::uuid,
         x ->> 'question_key', x ->> 'cluster_key', x ->> 'question_text', x ->> 'criticality',
         array(select jsonb_array_elements_text(x -> 'changed_fields')),
         x -> 'before' ->> 'answer', x -> 'after' ->> 'answer',
         (x -> 'before' ->> 'is_conforming')::boolean, (x -> 'after' ->> 'is_conforming')::boolean,
         nullif(x -> 'before' -> 'conditional_value', 'null'::jsonb),
         nullif(x -> 'after' -> 'conditional_value', 'null'::jsonb),
         x -> 'before' ->> 'note', x -> 'after' ->> 'note'
    from jsonb_array_elements(v_plan) x;

  perform set_config('hfm.checklist_correction', '', true);

  return jsonb_build_object(
    'dry_run', false, 'execution_id', e.id, 'correction_id', v_corr, 'sequence', v_seq,
    'corrected_at', v_now, 'corrected_by_name', v_name,
    'items', v_plan, 'summary_before', v_before, 'summary_after', v_after);
end;
$$;

revoke execute on function public.correct_checklist_execution(uuid, jsonb) from public, anon;
grant execute on function public.correct_checklist_execution(uuid, jsonb) to authenticated;

comment on function public.correct_checklist_execution(uuid, jsonb) is
  'Correção administrativa de um Check List de Frota enviado (§60): respostas, campos condicionais e observações, '
  'com motivo obrigatório, antes/depois preservado, resumo recalculado e dry_run. Recusa veículo, data, tipo, '
  'operação, BR, colaborador e versão — a identidade da execução alimenta a Aderência e não se corrige aqui.';

-- -----------------------------------------------------------------------------
-- 5a. O que pode ser corrigido numa execução, com a definição do condicional.
--     Só para quem tem `correct`, na organização e no escopo da execução.
-- -----------------------------------------------------------------------------
create or replace function public.checklist_execution_correction_form(
  p_organization_id uuid,
  p_execution_id    uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.checklist_executions;
begin
  if not private.has_permission(p_organization_id, 'applications.checklist_fleet.correct') then
    raise exception 'Você não possui permissão para corrigir execuções do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into e from public.checklist_executions x
   where x.id = p_execution_id and x.organization_id = p_organization_id;
  if e.id is null then
    raise exception 'Execução não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;
  if e.status <> 'submitted' then
    raise exception 'Só um checklist enviado recebe correção administrativa.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not private.can_access_operation(e.operation_id) then
    raise exception 'Esta execução não faz parte do seu escopo de acesso.'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'execution_id', e.id,
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cluster_key', ec.cluster_key,
               'name', ec.cluster_name,
               'answers', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'answer_id', an.id,
                          'question_id', an.question_id,
                          'question_key', an.question_key,
                          'text', an.question_text_snapshot,
                          'answer', an.answer,
                          'is_conforming', an.is_conforming,
                          'conforming_answer', q.conforming_answer,
                          'criticality', an.criticality,
                          'allows_note', q.allows_note,
                          'conditional_value', an.conditional_value,
                          'note', an.note,
                          'conditional', (
                            select jsonb_build_object(
                                     'field_key', c.field_key,
                                     'trigger_answer', c.trigger_answer,
                                     'label', c.label,
                                     'field_type', c.field_type,
                                     'is_required', c.is_required,
                                     'options', c.options)
                              from public.checklist_question_conditionals c
                             where c.question_id = an.question_id
                             order by c.sort_order limit 1))
                        order by q.sort_order, an.question_key)
                   from public.checklist_execution_answers an
                   join public.checklist_questions q on q.id = an.question_id
                  where an.execution_id = e.id and an.cluster_key = ec.cluster_key
               ), '[]'::jsonb))
             order by ec.sort_order)
        from public.checklist_execution_clusters ec
       where ec.execution_id = e.id
    ), '[]'::jsonb));
end;
$$;

revoke execute on function public.checklist_execution_correction_form(uuid, uuid) from public, anon;
grant execute on function public.checklist_execution_correction_form(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5b. O detalhe da execução ganha o histórico de correções
--
-- Só acrescenta chaves: `question_id` e `corrected` em cada resposta;
-- `correction_count`, `last_corrected_at` e `corrections` no topo. Continua
-- `security invoker`: a RLS da execução e das correções decide o que volta.
-- -----------------------------------------------------------------------------
create or replace function public.checklist_execution_detail(p_execution_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'operational_date', e.operational_date,
    'checklist_type', e.checklist_type,
    'license_plate', e.license_plate_snapshot,
    'fleet_code', e.fleet_code_snapshot,
    'operation_name', op.name,
    'br_code', b.code,
    'city_name', ci.name,
    'state_uf', st.uf,
    'version_label', ver.label,
    'employee_name', emp.full_name,
    'employee_code', emp.employee_code,
    'leader_name', led.full_name,
    'started_at', e.started_at,
    'submitted_at', e.submitted_at,
    'duration_seconds', e.duration_seconds,
    'applicable', e.applicable_questions,
    'conforming', e.conforming_answers,
    'non_conforming', e.non_conforming_answers,
    'critical_non_conforming', e.critical_non_conforming,
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cluster_key', ec.cluster_key,
               'name', ec.cluster_name,
               'applicable', ec.applicable_questions,
               'non_conforming', ec.non_conforming,
               'answers', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'question_id', an.question_id,
                          'question_key', an.question_key,
                          'text', an.question_text_snapshot,
                          'answer', an.answer,
                          'is_conforming', an.is_conforming,
                          'criticality', an.criticality,
                          'conditional_value', an.conditional_value,
                          'note', an.note,
                          'corrected', exists (
                            select 1 from public.checklist_execution_correction_items ci2
                             where ci2.answer_id = an.id)) order by an.question_key)
                   from public.checklist_execution_answers an
                  where an.execution_id = e.id and an.cluster_key = ec.cluster_key
               ), '[]'::jsonb)
             ) order by ec.sort_order)
        from public.checklist_execution_clusters ec
       where ec.execution_id = e.id
    ), '[]'::jsonb),
    'correction_count', (select count(*) from public.checklist_execution_corrections c
                          where c.execution_id = e.id),
    'last_corrected_at', (select max(c.corrected_at) from public.checklist_execution_corrections c
                           where c.execution_id = e.id),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'sequence', c.sequence,
               'reason', c.reason,
               'corrected_by_name', c.corrected_by_name,
               'corrected_at', c.corrected_at,
               'summary_before', c.summary_before,
               'summary_after', c.summary_after,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'question_id', i.question_id,
                          'question_key', i.question_key,
                          'cluster_key', i.cluster_key,
                          'question_text', i.question_text_snapshot,
                          'criticality', i.criticality,
                          'changed_fields', to_jsonb(i.changed_fields),
                          'answer_before', i.answer_before,
                          'answer_after', i.answer_after,
                          'is_conforming_before', i.is_conforming_before,
                          'is_conforming_after', i.is_conforming_after,
                          'conditional_value_before', i.conditional_value_before,
                          'conditional_value_after', i.conditional_value_after,
                          'note_before', i.note_before,
                          'note_after', i.note_after,
                          'conditional', (
                            select jsonb_build_object('label', cq.label, 'options', cq.options)
                              from public.checklist_question_conditionals cq
                             where cq.question_id = i.question_id
                             order by cq.sort_order limit 1)) order by i.cluster_key, i.question_key)
                   from public.checklist_execution_correction_items i
                  where i.correction_id = c.id
               ), '[]'::jsonb)) order by c.sequence desc)
        from public.checklist_execution_corrections c
       where c.execution_id = e.id
    ), '[]'::jsonb))
    from public.checklist_executions e
    join public.operations op on op.id = e.operation_id
    join public.checklist_app_versions ver on ver.id = e.version_id
    join public.employees emp on emp.id = e.employee_id
    left join public.operation_brs b on b.id = e.operation_br_id
    left join public.cities ci on ci.id = e.city_id
    left join public.states st on st.id = e.state_id
    left join public.employees led on led.id = e.leader_employee_id
   where e.id = p_execution_id;
$$;

comment on function public.checklist_execution_detail(uuid) is
  'Detalhe de uma execução do Check List de Frota (cabeçalho, KPIs, clusters, respostas e histórico de correções '
  'administrativas). Security invoker: a RLS de checklist_executions e das correções decide a visibilidade.';

-- -----------------------------------------------------------------------------
-- 6. Validação da publicação: só vínculos de operação VIGENTES hoje
--
-- Idêntica à versão da Etapa 12, exceto em dois pontos: a contagem de
-- operações habilitadas e o aviso de regra por operação passam por
-- `private.app_operation_enabled(app, operação, current_date)` — a mesma
-- leitura de vigência do contexto do executor, dos tipos e das placas. Um
-- vínculo `is_enabled` já vencido (effective_to < hoje) ou ainda futuro
-- (effective_from > hoje) não conta.
-- -----------------------------------------------------------------------------
create or replace function public.validate_checklist_version(
  p_organization_id uuid,
  p_version_id      uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v          record;
  v_app      record;
  v_errors   jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_pub      uuid;
  r          record;
  n          integer;
  n_ops      integer;
  n_active   integer;
  n_inactive integer;
  n_cond     integer;
  n_rules    integer;
  n_crit     integer;
begin
  if not (private.has_permission(p_organization_id, 'applications.checklist_fleet.configure')
          or private.has_permission(p_organization_id, 'applications.checklist_fleet.publish')
          or private.has_permission(p_organization_id, 'applications.checklist_fleet.create_version')) then
    raise exception 'Você não possui permissão para validar versões do Check List de Frota.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.checklist_app_versions
   where id = p_version_id and organization_id = p_organization_id;
  if v.id is null then
    raise exception 'Versão não encontrada nesta organização.' using errcode = 'no_data_found';
  end if;

  select a.id, a.is_active, a.allows_attachments into v_app
    from public.operational_apps a where a.id = v.app_id;

  select v2.id into v_pub from public.checklist_app_versions v2
   where v2.app_id = v.app_id and v2.status = 'published' and v2.id <> v.id
   order by v2.major desc, v2.minor desc limit 1;

  -- Clusters
  select count(*) into n from public.checklist_clusters where version_id = v.id;
  if n = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_clusters',
      'message', 'A versão não possui nenhum cluster.');
  end if;

  if exists (
    select 1 from (select sort_order, row_number() over (order by sort_order) as rn
                     from public.checklist_clusters where version_id = v.id) s
     where s.sort_order <> s.rn) then
    v_errors := v_errors || jsonb_build_object('code', 'ordem_clusters',
      'message', 'A ordem dos clusters possui lacunas. Reordene os clusters.');
  end if;

  for r in
    select c.id, c.name,
           (select count(*) from public.checklist_questions q where q.cluster_id = c.id and q.status = 'active') as ativas,
           (select count(*) from public.checklist_questions q where q.cluster_id = c.id) as total
      from public.checklist_clusters c where c.version_id = v.id order by c.sort_order
  loop
    if r.ativas = 0 then
      v_errors := v_errors || jsonb_build_object('code', 'cluster_vazio', 'cluster_id', r.id,
        'message', format('O cluster "%s" não possui pergunta ativa.', r.name));
    end if;
    if exists (
      select 1 from (select sort_order, row_number() over (order by sort_order) as rn
                       from public.checklist_questions where cluster_id = r.id) s
       where s.sort_order <> s.rn) then
      v_errors := v_errors || jsonb_build_object('code', 'ordem_perguntas', 'cluster_id', r.id,
        'message', format('A ordem das perguntas do cluster "%s" possui lacunas. Reordene as perguntas.', r.name));
    end if;
  end loop;

  -- Perguntas
  select count(*) filter (where status = 'active'), count(*) filter (where status <> 'active'),
         count(*) filter (where status = 'active' and criticality = 'critica')
    into n_active, n_inactive, n_crit
    from public.checklist_questions where version_id = v.id;

  if n_active = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_perguntas',
      'message', 'A versão não possui nenhuma pergunta ativa.');
  end if;

  for r in
    select q.*, c.name as cluster_name from public.checklist_questions q
      join public.checklist_clusters c on c.id = q.cluster_id
     where q.version_id = v.id order by c.sort_order, q.sort_order
  loop
    if r.answer_type <> 'yes_no' then
      v_errors := v_errors || jsonb_build_object('code', 'tipo_resposta', 'question_id', r.id,
        'message', format('"%s": o executor não executa o tipo de resposta "%s".', left(r.question_text, 60), r.answer_type));
    end if;
    if r.conforming_answer not in ('yes', 'no') then
      v_errors := v_errors || jsonb_build_object('code', 'resposta_conforme', 'question_id', r.id,
        'message', format('"%s": resposta conforme inválida.', left(r.question_text, 60)));
    end if;
    if r.criticality not in ('media', 'critica') then
      v_errors := v_errors || jsonb_build_object('code', 'criticidade', 'question_id', r.id,
        'message', format('"%s": criticidade inválida.', left(r.question_text, 60)));
    end if;
    if length(btrim(r.question_text)) < 3 or length(btrim(r.question_text)) > 500 then
      v_errors := v_errors || jsonb_build_object('code', 'texto', 'question_id', r.id,
        'message', format('"%s": o texto deve ter entre 3 e 500 caracteres.', left(r.question_text, 60)));
    end if;
    if r.question_key !~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' then
      v_errors := v_errors || jsonb_build_object('code', 'identidade', 'question_id', r.id,
        'message', format('"%s": identidade técnica inválida (%s).', left(r.question_text, 60), r.question_key));
    end if;
    if r.note_required and not r.allows_note then
      v_errors := v_errors || jsonb_build_object('code', 'observacao', 'question_id', r.id,
        'message', format('"%s": exige observação mas não permite observação.', left(r.question_text, 60)));
    end if;

    select count(*) into n from public.checklist_question_conditionals where question_id = r.id;
    if n > 1 then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_multiplo', 'question_id', r.id,
        'message', format('"%s": possui %s campos condicionais; o executor apresenta um por pergunta.', left(r.question_text, 60), n));
    end if;
  end loop;

  -- Condicionais
  select count(*) into n_cond from public.checklist_question_conditionals where version_id = v.id;
  for r in
    select cd.*, q.question_text from public.checklist_question_conditionals cd
      join public.checklist_questions q on q.id = cd.question_id
     where cd.version_id = v.id
  loop
    if r.field_type not in ('text', 'single_select', 'multi_select') then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_tipo', 'question_id', r.question_id,
        'message', format('"%s": o executor não executa campo condicional do tipo "%s".', left(r.question_text, 60), r.field_type));
    end if;
    if r.trigger_answer not in ('yes', 'no') then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_gatilho', 'question_id', r.question_id,
        'message', format('"%s": resposta que aciona o campo inválida.', left(r.question_text, 60)));
    end if;
    if r.field_type = 'text' and jsonb_array_length(r.options) <> 0 then
      v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
        'message', format('"%s": campo de texto não pode ter opções.', left(r.question_text, 60)));
    end if;
    if r.field_type <> 'text' then
      if jsonb_array_length(r.options) < 2 then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": o campo de escolha precisa de pelo menos duas opções.', left(r.question_text, 60)));
      end if;
      if exists (select 1 from jsonb_array_elements(r.options) o
                  where nullif(btrim(coalesce(o ->> 'value', '')), '') is null
                     or nullif(btrim(coalesce(o ->> 'label', '')), '') is null) then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": há opção sem valor ou sem rótulo.', left(r.question_text, 60)));
      end if;
      if (select count(*) from jsonb_array_elements(r.options) o) <>
         (select count(distinct o ->> 'value') from jsonb_array_elements(r.options) o) then
        v_errors := v_errors || jsonb_build_object('code', 'condicional_opcoes', 'question_id', r.question_id,
          'message', format('"%s": há opções com o mesmo valor.', left(r.question_text, 60)));
      end if;
    end if;
  end loop;

  -- Regras
  select count(*) into n_rules from public.checklist_question_rules where version_id = v.id;
  for r in
    select ru.*, q.question_text,
           t.deleted_at as type_deleted, s.deleted_at as sub_deleted, o.deleted_at as op_deleted,
           t.organization_id as type_org, s.organization_id as sub_org, o.organization_id as op_org,
           coalesce(t.name, s.name, o.name) as target_name,
           case when ru.operation_id is not null
                then private.app_operation_enabled(v.app_id, ru.operation_id, current_date) end as op_enabled
      from public.checklist_question_rules ru
      join public.checklist_questions q on q.id = ru.question_id
      left join public.vehicle_types t on t.id = ru.vehicle_type_id
      left join public.vehicle_subcategories s on s.id = ru.vehicle_subcategory_id
      left join public.operations o on o.id = ru.operation_id
     where ru.version_id = v.id
  loop
    if r.target_name is null
       or r.type_deleted is not null or r.sub_deleted is not null or r.op_deleted is not null
       or (r.type_org is not null and r.type_org <> p_organization_id)
       or (r.sub_org is not null and r.sub_org <> p_organization_id)
       or (r.op_org is not null and r.op_org <> p_organization_id) then
      v_errors := v_errors || jsonb_build_object('code', 'regra_alvo', 'question_id', r.question_id,
        'message', format('"%s": há regra apontando para %s inexistente ou excluído.', left(r.question_text, 60),
          case r.rule_kind when 'vehicle_type' then 'tipo de equipamento'
                           when 'vehicle_subcategory' then 'subcategoria' else 'operação' end));
    end if;
    if r.mode = 'guidance' and nullif(btrim(coalesce(r.guidance, '')), '') is null then
      v_errors := v_errors || jsonb_build_object('code', 'regra_orientacao', 'question_id', r.question_id,
        'message', format('"%s": regra de orientação sem texto.', left(r.question_text, 60)));
    end if;
    if r.rule_kind = 'operation' and coalesce(r.op_enabled, false) = false then
      v_warnings := v_warnings || jsonb_build_object('code', 'regra_operacao_desabilitada', 'question_id', r.question_id,
        'message', format('"%s": a regra aponta para a operação "%s", que não está habilitada para o aplicativo.', left(r.question_text, 60), r.target_name));
    end if;
  end loop;

  -- Operações habilitadas E vigentes hoje
  select count(*) into n_ops
    from public.checklist_app_operations ao
    join public.operations o on o.id = ao.operation_id
   where ao.app_id = v.app_id and o.deleted_at is null and o.status = 'active'
     and private.app_operation_enabled(ao.app_id, ao.operation_id, current_date);
  if n_ops = 0 then
    v_errors := v_errors || jsonb_build_object('code', 'sem_operacoes',
      'message', 'Nenhuma operação ativa está habilitada para o aplicativo.');
  end if;

  -- Compatibilidade com o executor (§26, §39)
  if coalesce(v_app.allows_attachments, false) then
    v_errors := v_errors || jsonb_build_object('code', 'anexos',
      'message', 'O aplicativo está marcado para permitir anexos; o Check List de Frota não admite anexos e o executor não os executa.');
  end if;
  if v.min_duration_seconds < 0 or v.max_duration_seconds <= v.min_duration_seconds then
    v_errors := v_errors || jsonb_build_object('code', 'duracao',
      'message', 'Os limites de tempo são inválidos: o máximo deve ser maior que o mínimo.');
  end if;
  if v.max_duration_seconds > 3600 then
    v_warnings := v_warnings || jsonb_build_object('code', 'duracao_longa',
      'message', 'O tempo máximo é maior que uma hora.');
  end if;
  if not coalesce(v_app.is_active, false) then
    v_warnings := v_warnings || jsonb_build_object('code', 'app_inativo',
      'message', 'O aplicativo está inativo: a versão pode ser publicada, mas ninguém a executará até a reativação.');
  end if;

  -- Avisos informativos
  if n_crit = 0 and n_active > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'sem_criticas',
      'message', 'Nenhuma pergunta ativa é crítica.');
  end if;
  if n_inactive > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'perguntas_inativas',
      'message', format('%s pergunta(s) inativa(s) não serão apresentadas ao motorista.', n_inactive));
  end if;

  -- §47: comparabilidade com a versão publicada — identidades que somem e que nascem.
  if v_pub is not null then
    select count(*) into n from public.checklist_questions pq
     where pq.version_id = v_pub and pq.status = 'active'
       and not exists (select 1 from public.checklist_questions dq
                        where dq.version_id = v.id and dq.question_key = pq.question_key and dq.status = 'active');
    if n > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'identidades_retiradas',
        'message', format('%s pergunta(s) ativa(s) na versão publicada não seguem ativas nesta versão; o histórico delas fica preservado, mas a comparação futura para.', n));
    end if;
    select count(*) into n from public.checklist_questions dq
     where dq.version_id = v.id and dq.status = 'active'
       and not exists (select 1 from public.checklist_questions pq
                        where pq.version_id = v_pub and pq.question_key = dq.question_key);
    if n > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'identidades_novas',
        'message', format('%s pergunta(s) com identidade nova: passam a ser medidas a partir desta versão.', n));
    end if;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'version_id', v.id,
    'label', v.label,
    'status', v.status,
    'errors', v_errors,
    'warnings', v_warnings,
    'summary', jsonb_build_object(
      'clusters', (select count(*) from public.checklist_clusters where version_id = v.id),
      'questions_active', n_active,
      'questions_inactive', n_inactive,
      'conditionals', n_cond,
      'rules', n_rules,
      'operations_enabled', n_ops,
      'answer_types', (select coalesce(jsonb_agg(distinct answer_type), '[]'::jsonb)
                         from public.checklist_questions where version_id = v.id),
      'allows_attachments', coalesce(v_app.allows_attachments, false)));
end;
$$;

revoke execute on function public.validate_checklist_version(uuid, uuid) from public, anon;
grant execute on function public.validate_checklist_version(uuid, uuid) to authenticated;

comment on function public.validate_checklist_version(uuid, uuid) is
  'Validação da publicação do Check List de Frota (§46): erros impedem publicar, avisos informam. Conta só '
  'vínculos de operação vigentes hoje (private.app_operation_enabled), não apenas is_enabled.';
