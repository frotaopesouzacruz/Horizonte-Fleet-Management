-- =============================================================================
-- FIX — work_locations has no `code` column
--
-- The master-data migration attached private.tg_normalize_org_code() to all
-- five catalogues in a loop, treating them as identical. work_locations has no
-- code, so the trigger failed on every insert ("record new has no field code").
-- =============================================================================
drop trigger if exists work_locations_normalize on public.work_locations;
