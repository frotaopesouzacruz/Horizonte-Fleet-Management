-- =============================================================================
-- Manutenção — contexto vazio na entrada não apaga o contexto conhecido
--
-- `maintenance_start` (e as demais rotinas que fixam o contexto) recalculam
-- onde o veículo estava NA DATA de entrada e gravam o resultado. Quando nessa
-- data o veículo não tem fidelização nem alocação (fonte 'none'), o resultado
-- é vazio e apagava a operação/cidade que a manutenção já tinha — a da
-- solicitação ou a preenchida pela planilha importada (20261002105000).
--
-- Agora, com fonte 'none', a operação, a cidade e o estado (e os nomes
-- congelados correspondentes) já gravados são mantidos; BR, liderança, filial
-- e vínculo de fidelização seguem o recálculo (vazios). Com contexto oficial
-- encontrado, nada muda: ele prevalece, como antes.
-- =============================================================================

create or replace function private.maintenance_apply_context(p_maintenance_id uuid, p_context jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.maintenances m set
    context_date               = (p_context ->> 'date')::date,
    context_source             = coalesce(p_context ->> 'source', 'none'),
    operation_id               = case when k.keep then m.operation_id else (p_context ->> 'operation_id')::uuid end,
    operation_city_id          = case when k.keep then m.operation_city_id else (p_context ->> 'operation_city_id')::uuid end,
    state_id                   = case when k.keep then m.state_id else (p_context ->> 'state_id')::smallint end,
    city_id                    = case when k.keep then m.city_id else (p_context ->> 'city_id')::integer end,
    operation_br_id            = (p_context ->> 'operation_br_id')::uuid,
    fidelization_assignment_id = (p_context ->> 'fidelization_assignment_id')::uuid,
    organization_unit_id       = (p_context ->> 'organization_unit_id')::uuid,
    leader_employee_id         = (p_context ->> 'leader_employee_id')::uuid,
    leadership_assignment_id   = (p_context ->> 'leadership_assignment_id')::uuid,
    operation_name_snapshot    = case when k.keep then m.operation_name_snapshot else p_context ->> 'operation_name' end,
    city_name_snapshot         = case when k.keep then m.city_name_snapshot else p_context ->> 'city_name' end,
    state_uf_snapshot          = case when k.keep then m.state_uf_snapshot else p_context ->> 'state_uf' end,
    br_code_snapshot           = p_context ->> 'br_code',
    unit_name_snapshot         = p_context ->> 'unit_name',
    leader_name_snapshot       = p_context ->> 'leader_name'
    from (select coalesce(p_context ->> 'source', 'none') = 'none'
                 and (p_context ->> 'operation_id') is null as keep) k
   where m.id = p_maintenance_id;
$$;
