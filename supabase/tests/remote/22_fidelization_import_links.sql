-- =============================================================================
-- 22 · Importação registra a troca; mobilizações contam as trocas inferidas
--
-- Migrations 20260930110000_fidelization_import_links_changes e
-- 20260930120000_fidelization_mobilizations_inferred. Suíte transacional contra
-- o banco COM DADOS; termina em `raise exception 'ROLLBACK_TESTES …'` — nada do
-- que ela grava sobrevive. Usa Junho/2027 (mês sem vínculos) e três BRs reais
-- da mesma operação com os seus veículos de Setembro/2026.
--
--   I1  Lote 1 (primeiros períodos): vínculos `import`, sem ligação — não há
--       titular que termine na véspera
--   I2  Lote 2: A e B trocam de veículo no mesmo dia → as duas linhas ficam
--       ligadas ao período anterior com `source = 'inversion'`
--   I3  Lote 2: C recebe outro veículo, sem par → `substitution`, ligada
--   I4  Resumo do lote 2: 1 substituição e 2 linhas de inversão ligadas
--   I5  Histórico: inversão ×2 e substituição ×1, explícitas (não inferidas),
--       origem "import", com o lote no detalhe
--   I6  Painel (Junho/2027, a operação): 1 substituição + 1 inversão
--       explícitas = 2 mobilizações; nenhuma inferida
--   M1  Troca inferida sem par (vínculo gravado sem ligação) conta como 1
--       substituição nas mobilizações e aparece em inferred_substitutions
--   M2  Setembro/2026 (dados reais): as 16 trocas inferidas são 8 pares →
--       8 inversões nas mobilizações; estabilidade inalterada
-- =============================================================================
select set_config('request.jwt.claims',
  (select json_build_object('sub', m.user_id, 'role', 'authenticated')::text
     from public.organization_memberships m
     join public.organizations o on o.id = m.organization_id
    where o.deleted_at is null and o.status = 'active' and m.status = 'active'
    order by o.created_at limit 1), true);

do $t$
declare
  v_org uuid := (select id from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1);
  v_op uuid;
  br record;
  a_code text; b_code text; c_code text; d_code text; g_id uuid; g_code text;
  va text; vb text; vc text; vd text;
  a_id uuid; b_id uuid; c_id uuid;
  b1 uuid; b2 uuid; j jsonb; s jsonb;
  a1 public.fidelization_assignments; a2 public.fidelization_assignments;
  bb1 public.fidelization_assignments; bb2 public.fidelization_assignments;
  c1 public.fidelization_assignments; c2 public.fidelization_assignments;
  n int; n2 int; n3 int; ok boolean; k int := 0;
  r text := '';
begin
  -- Cinco BRs da mesma operação, cada uma com o seu titular de Setembro/2026.
  select b.operation_id into v_op
    from public.operation_brs b
    join public.fidelization_assignments a on a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
   where b.organization_id = v_org and b.deleted_at is null and b.status = 'active'
     and a.start_date <= date '2026-09-15' and coalesce(a.end_date, 'infinity') >= date '2026-09-15'
   group by b.operation_id order by count(*) desc limit 1;

  for br in
    select b.id, b.code, v.fleet_code
      from public.operation_brs b
      join public.fidelization_assignments a on a.operation_br_id = b.id and a.vehicle_role = 'primary' and a.status <> 'cancelled'
           and a.start_date <= date '2026-09-15' and coalesce(a.end_date, 'infinity') >= date '2026-09-15'
      join public.vehicles v on v.id = a.vehicle_id and v.status = 'active' and v.fleet_code is not null
     where b.organization_id = v_org and b.deleted_at is null and b.status = 'active' and b.operation_id = v_op
       and not exists (select 1 from public.fidelization_assignments x
                        where x.operation_br_id = b.id and x.status <> 'cancelled'
                          and x.start_date <= date '2027-07-31' and coalesce(x.end_date, 'infinity') >= date '2027-06-01')
     order by b.code limit 5
  loop
    k := k + 1;
    if k = 1 then a_code := br.code; a_id := br.id; va := br.fleet_code;
    elsif k = 2 then b_code := br.code; b_id := br.id; vb := br.fleet_code;
    elsif k = 3 then c_code := br.code; c_id := br.id; vc := br.fleet_code;
    elsif k = 4 then d_code := br.code; vd := br.fleet_code;
    else g_code := br.code; g_id := br.id;
    end if;
  end loop;
  if k < 5 then
    raise exception 'FIXTURE incompleta: % BRs livres em Junho/2027 na operação', k;
  end if;

  execute 'set local role authenticated';

  -- Lote 1: os primeiros períodos.
  j := public.stage_fidelization_import(v_org, jsonb_build_object('file_name', 'suite22-a.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'br_code', a_code, 'fleet_code', va, 'start_date', '2027-06-05', 'end_date', '2027-06-10'),
    jsonb_build_object('row_number', 3, 'br_code', b_code, 'fleet_code', vb, 'start_date', '2027-06-05', 'end_date', '2027-06-10'),
    jsonb_build_object('row_number', 4, 'br_code', c_code, 'fleet_code', vc, 'start_date', '2027-06-05', 'end_date', '2027-06-10'))));
  b1 := (j ->> 'batch_id')::uuid;
  j := public.process_fidelization_import(v_org, b1);

  select * into a1 from public.fidelization_assignments where operation_br_id = a_id and start_date = date '2027-06-05';
  select * into bb1 from public.fidelization_assignments where operation_br_id = b_id and start_date = date '2027-06-05';
  select * into c1 from public.fidelization_assignments where operation_br_id = c_id and start_date = date '2027-06-05';
  ok := (j ->> 'done')::boolean and a1.source = 'import' and bb1.source = 'import' and c1.source = 'import'
        and a1.replaces_assignment_id is null and bb1.replaces_assignment_id is null and c1.replaces_assignment_id is null;
  r := r || format('%s I1 lote 1: 3 vínculos import sem ligação (%s/%s/%s)%s',
       case when ok then 'PASS' else 'FAIL' end, a1.source, bb1.source, c1.source, chr(10));

  -- Lote 2: A e B trocam de veículo em 11/06; C recebe o veículo de D.
  -- As linhas vêm fora de ordem de propósito: a gravação segue a data.
  j := public.stage_fidelization_import(v_org, jsonb_build_object('file_name', 'suite22-b.xlsx', 'rows', jsonb_build_array(
    jsonb_build_object('row_number', 2, 'br_code', b_code, 'fleet_code', va, 'start_date', '2027-06-11', 'end_date', '2027-06-20'),
    jsonb_build_object('row_number', 3, 'br_code', c_code, 'fleet_code', vd, 'start_date', '2027-06-11', 'end_date', '2027-06-20'),
    jsonb_build_object('row_number', 4, 'br_code', a_code, 'fleet_code', vb, 'start_date', '2027-06-11', 'end_date', '2027-06-20'))));
  b2 := (j ->> 'batch_id')::uuid;
  -- Em partes: a primeira linha gravada (B) só tem o par ainda por gravar no lote.
  j := public.process_fidelization_import(v_org, b2, 1);
  j := public.process_fidelization_import(v_org, b2);

  select * into a2 from public.fidelization_assignments where operation_br_id = a_id and start_date = date '2027-06-11';
  select * into bb2 from public.fidelization_assignments where operation_br_id = b_id and start_date = date '2027-06-11';
  select * into c2 from public.fidelization_assignments where operation_br_id = c_id and start_date = date '2027-06-11';
  ok := a2.source = 'inversion' and bb2.source = 'inversion'
        and a2.replaces_assignment_id = a1.id and bb2.replaces_assignment_id = bb1.id;
  r := r || format('%s I2 troca recíproca A↔B: %s/%s, ligadas ao período anterior=%s%s',
       case when ok then 'PASS' else 'FAIL' end, a2.source, bb2.source,
       a2.replaces_assignment_id = a1.id and bb2.replaces_assignment_id = bb1.id, chr(10));

  ok := c2.source = 'substitution' and c2.replaces_assignment_id = c1.id;
  r := r || format('%s I3 troca sem par em C: %s, ligada=%s%s',
       case when ok then 'PASS' else 'FAIL' end, c2.source, c2.replaces_assignment_id = c1.id, chr(10));

  select summary into s from public.import_batches where id = b2;
  ok := (s ->> 'linked_substitutions')::int = 1 and (s ->> 'linked_inversion_rows')::int = 2 and (j ->> 'done')::boolean;
  r := r || format('%s I4 resumo do lote 2: substituições ligadas=%s, linhas de inversão=%s%s',
       case when ok then 'PASS' else 'FAIL' end, s ->> 'linked_substitutions', s ->> 'linked_inversion_rows', chr(10));

  -- O histórico é gravado no fim da transação; aqui, antes do fim.
  execute 'set constraints all immediate';
  select count(*) filter (where m.movement_type = 'vehicle_inversion'),
         count(*) filter (where m.movement_type = 'vehicle_substitution' and not m.is_inferred),
         count(*) filter (where m.origin <> 'import' or m.is_inferred)
    into n, n2, n3
    from public.fidelization_movements m
   where m.details ->> 'import_batch_id' = b2::text and m.subject = 'vehicle';
  ok := n = 2 and n2 = 1 and n3 = 0;
  r := r || format('%s I5 histórico do lote 2: inversões=%s substituições=%s, fora de origem import ou inferidas=%s%s',
       case when ok then 'PASS' else 'FAIL' end, n, n2, n3, chr(10));

  j := public.fidelization_stability(v_org, 2027, 6, jsonb_build_object('operation_id', v_op));
  ok := (j ->> 'explicit_substitutions')::int = 1 and (j ->> 'explicit_inversions')::int = 1
        and (j ->> 'mobilizations')::int = 2 and (j ->> 'inferred_vehicle_changes')::int = 0
        and (j ->> 'brs_with_vehicle_change')::int = 3;
  r := r || format('%s I6 painel Junho/2027: explícitas %s subst. + %s inv. = %s mobilizações, inferidas=%s, BRs com troca=%s%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'explicit_substitutions', j ->> 'explicit_inversions',
       j ->> 'mobilizations', j ->> 'inferred_vehicle_changes', j ->> 'brs_with_vehicle_change', chr(10));

  -- M1: dois períodos consecutivos sem ligação, em outra BR (como uma carga antiga).
  execute 'reset role';
  insert into public.fidelization_assignments (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
  select v_org, g_id, v.id, 'primary', date '2027-07-01', date '2027-07-10', 'planned', 'manual', 'Suite 22'
    from public.vehicles v where v.organization_id = v_org and v.fleet_code = va;
  insert into public.fidelization_assignments (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
  select v_org, g_id, v.id, 'primary', date '2027-07-11', date '2027-07-20', 'planned', 'manual', 'Suite 22'
    from public.vehicles v where v.organization_id = v_org and v.fleet_code = vb;
  j := public.fidelization_stability(v_org, 2027, 7, jsonb_build_object('operation_id', v_op));
  ok := (j ->> 'inferred_vehicle_changes')::int = 1 and (j ->> 'inferred_substitutions')::int = 1
        and (j ->> 'inferred_inversions')::int = 0 and (j ->> 'mobilizations')::int = 1
        and (j ->> 'explicit_mobilizations')::int = 0 and (j ->> 'vehicle_substitutions')::int = 1;
  r := r || format('%s M1 troca inferida sem par: inferidas=%s → %s substituição, mobilizações=%s (explícitas %s)%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'inferred_vehicle_changes', j ->> 'inferred_substitutions',
       j ->> 'mobilizations', j ->> 'explicit_mobilizations', chr(10));

  -- M2: os dados reais de Setembro/2026.
  j := public.fidelization_stability(v_org, 2026, 9, '{}'::jsonb);
  ok := (j ->> 'inferred_vehicle_changes')::int = 16 and (j ->> 'inferred_inversions')::int = 8
        and (j ->> 'inferred_substitutions')::int = 0
        and (j ->> 'mobilizations')::int = (j ->> 'explicit_mobilizations')::int + 8
        and (j ->> 'vehicle_change_links')::int = 16 + (j ->> 'explicit_substitutions')::int + 2 * (j ->> 'explicit_inversions')::int
        and (j ->> 'fleet_stability_pct')::numeric = 88.6;
  r := r || format('%s M2 Setembro/2026: %s trocas inferidas = %s inversões; mobilizações=%s; vínculos por troca=%s; estabilidade %s%%%s',
       case when ok then 'PASS' else 'FAIL' end, j ->> 'inferred_vehicle_changes', j ->> 'inferred_inversions',
       j ->> 'mobilizations', j ->> 'vehicle_change_links', j ->> 'fleet_stability_pct', chr(10));

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end;
$t$;
