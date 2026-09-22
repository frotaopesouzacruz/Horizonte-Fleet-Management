-- =============================================================================
-- Etapa 11 — Aderência: search_path fixo nas duas funções puras
--
-- O linter do Supabase (0011) aponta funções sem `search_path` fixo. As duas
-- são puras e não leem tabela alguma, mas a regra vale para todas: fixar
-- vazio e nada muda no comportamento.
-- =============================================================================
alter function private.adherence_status_code(boolean, text, text, text, date, date, timestamptz, timestamptz)
  set search_path = '';
alter function private.adherence_import_reason_code(text)
  set search_path = '';
