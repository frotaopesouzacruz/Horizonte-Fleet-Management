-- =============================================================================
-- Etapa 12 — o modo `guidance` das regras de aplicabilidade (§16)
--
-- A orientação de Merchandising para câmera e sirene de ré NÃO pode restringir
-- a aplicabilidade: a pergunta continua valendo para todo mundo. Um terceiro
-- modo resolve — `guidance` carrega o texto orientativo e é ignorado por
-- `private.checklist_question_applies`, que só lê 'include' e 'exclude'.
-- =============================================================================
alter table public.checklist_question_rules
  drop constraint if exists checklist_rules_mode_check;

alter table public.checklist_question_rules
  add constraint checklist_rules_mode_check
  check (mode in ('include', 'exclude', 'guidance'));

-- Orientação sem texto é uma regra que não orienta nada.
alter table public.checklist_question_rules
  drop constraint if exists checklist_rules_guidance_text_check;

alter table public.checklist_question_rules
  add constraint checklist_rules_guidance_text_check
  check (mode <> 'guidance' or nullif(btrim(coalesce(guidance, '')), '') is not null);
