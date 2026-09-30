-- =============================================================================
-- 21 · Estabilidade da frota conta a troca que chegou sem evento
--
-- Migration 20260930100000_fidelization_stability_inferred_changes. Suíte
-- contra o banco COM DADOS, sobre Setembro/2026 — o mês em que a importação de
-- 21/09 trouxe 16 trocas de titular como períodos consecutivos, sem
-- `replaces_assignment_id`, e a estabilidade dizia 100%. Não grava nada; o
-- bloco termina em `raise exception 'ROLLBACK_TESTES …'` como as outras.
--
--   S1  "BRs com troca" = BRs ativas com substituição, inversão OU troca
--       inferida no mês, cada BR uma vez — conferido contra uma contagem
--       independente, feita aqui, sobre os vínculos
--   S2  Estabilidade da frota = 1 − BRs com troca / BRs com veículo
--   S3  Mobilizações = eventos explícitos + trocas inferidas (migration
--       20260930120000): as substituições explícitas batem com a contagem
--       independente, e o total soma as duas partes sem contar duas vezes
--   S4  Os recortes por operação somam as mesmas BRs com troca, e a
--       estabilidade de cada operação segue a mesma fórmula
--   S5  Se o mês tem troca inferida, a estabilidade não é 100%
-- =============================================================================
do $t$
declare
  v_org uuid := (select id from public.organizations order by created_at limit 1);
  v_start date := date '2026-09-01';
  v_end   date := date '2026-09-30';
  j jsonb;
  r text := '';
  n_expected int; n_inferred_brs int; n_explicit int; n_with_vehicle int; n_ops_sum int;
  ok boolean;
begin
  j := public.fidelization_stability(v_org, 2026, 9, '{}'::jsonb);

  -- Contagem independente: BR ativa com vínculo titular que começou no mês e
  -- (a) aponta o vínculo que substitui, ou (b) segue, no dia seguinte, um
  -- vínculo titular de outro veículo na mesma BR.
  with active_brs as (
    select b.id from public.operation_brs b
     where b.organization_id = v_org and b.deleted_at is null and b.status = 'active'
  ),
  changed as (
    select distinct a.operation_br_id
      from public.fidelization_assignments a
      join active_brs b on b.id = a.operation_br_id
     where a.status <> 'cancelled' and a.start_date between v_start and v_end
       and (a.replaces_assignment_id is not null
            or (a.vehicle_role = 'primary' and exists (
                  select 1 from public.fidelization_assignments p
                   where p.operation_br_id = a.operation_br_id and p.vehicle_role = 'primary'
                     and p.status <> 'cancelled' and p.end_date = a.start_date - 1
                     and p.vehicle_id <> a.vehicle_id)))
  ),
  inferred_only as (
    select distinct a.operation_br_id
      from public.fidelization_assignments a
      join active_brs b on b.id = a.operation_br_id
     where a.status <> 'cancelled' and a.vehicle_role = 'primary' and a.replaces_assignment_id is null
       and a.start_date between v_start and v_end
       and exists (select 1 from public.fidelization_assignments p
                    where p.operation_br_id = a.operation_br_id and p.vehicle_role = 'primary'
                      and p.status <> 'cancelled' and p.end_date = a.start_date - 1 and p.vehicle_id <> a.vehicle_id)
  )
  select (select count(*) from changed), (select count(*) from inferred_only) into n_expected, n_inferred_brs;

  select count(*) into n_explicit
    from public.fidelization_assignments a
    join public.operation_brs b on b.id = a.operation_br_id
   where b.organization_id = v_org and b.deleted_at is null and b.status = 'active'
     and a.replaces_assignment_id is not null and a.status <> 'cancelled'
     and a.start_date between v_start and v_end and a.source <> 'inversion';

  n_with_vehicle := (j ->> 'brs_with_vehicle')::int;

  ok := (j ->> 'brs_with_vehicle_change')::int = n_expected;
  r := r || format('%s S1 BRs com troca = %s (contagem independente %s, das quais %s só por troca inferida)%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'brs_with_vehicle_change', n_expected, n_inferred_brs, chr(10));

  ok := n_with_vehicle > 0
        and (j ->> 'fleet_stability_pct')::numeric = round(100.0 * (1 - n_expected::numeric / n_with_vehicle), 1);
  r := r || format('%s S2 estabilidade da frota %s%% = 1 − %s/%s%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'fleet_stability_pct', n_expected, n_with_vehicle, chr(10));

  ok := (j ->> 'explicit_substitutions')::int = n_explicit
        and (j ->> 'explicit_mobilizations')::int = (j ->> 'explicit_substitutions')::int + (j ->> 'explicit_inversions')::int
        and (j ->> 'mobilizations')::int = (j ->> 'explicit_mobilizations')::int
              + (j ->> 'inferred_substitutions')::int + (j ->> 'inferred_inversions')::int
        and (j ->> 'mobilizations')::int = (j ->> 'vehicle_substitutions')::int + (j ->> 'vehicle_inversions')::int
        and (j ->> 'inferred_substitutions')::int + 2 * (j ->> 'inferred_inversions')::int
              >= (j ->> 'inferred_vehicle_changes')::int
        and (j ->> 'inferred_vehicle_changes')::int >= n_inferred_brs;
  r := r || format('%s S3 mobilizações %s = explícitas %s (%s subst. + %s inv.) + inferidas %s (%s subst. + %s inv.)%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'mobilizations', j ->> 'explicit_mobilizations',
       j ->> 'explicit_substitutions', j ->> 'explicit_inversions', j ->> 'inferred_vehicle_changes',
       j ->> 'inferred_substitutions', j ->> 'inferred_inversions', chr(10));

  select coalesce(sum((x ->> 'brs_with_change')::int), 0) into n_ops_sum
    from jsonb_array_elements(j -> 'by_operation') x;
  ok := n_ops_sum = n_expected
        and not exists (select 1 from jsonb_array_elements(j -> 'by_operation') x
                         where (x ->> 'with_vehicle')::int > 0
                           and (x ->> 'stability_pct')::numeric
                               <> round(100.0 * (1 - (x ->> 'brs_with_change')::numeric / (x ->> 'with_vehicle')::int), 1));
  r := r || format('%s S4 recortes por operação somam %s BRs com troca e seguem a fórmula%s',
       case when ok then 'PASS' else 'FAIL' end, n_ops_sum, chr(10));

  ok := n_inferred_brs = 0 or (j ->> 'fleet_stability_pct')::numeric < 100;
  r := r || format('%s S5 com %s BR(s) com troca inferida a estabilidade não fica em 100%% (%s%%)%s',
       case when ok then 'PASS' else 'FAIL' end, n_inferred_brs, j ->> 'fleet_stability_pct', chr(10));

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end;
$t$;
