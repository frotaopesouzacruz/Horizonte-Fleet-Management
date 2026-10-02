-- =============================================================================
-- Manutenção — conciliação do ciclo preventivo: MP informado à frente do KM
--
-- Complementa 20261002107000. O MP informado maior que o último realizado
-- valia sempre; com MPs trocados na planilha ("MP2" aos 10.050 km e depois
-- "MP1" aos 20.100 km, regra de 10 mil) a primeira realizava o MP2 e a segunda,
-- por ser repetida, ia ao MP3 — o MP1 ficava aberto e o MP3 era dado como
-- feito 10 mil km antes do marco. Agora o informado só vale se a entrada não
-- foi mais de meio intervalo antes do marco dele; senão o ciclo sai do KM
-- (marco mais próximo entre os ainda não realizados), com o motivo na trilha
-- e no aviso do lote. Revisão feita depois do marco (atrasada) segue valendo
-- pelo informado.
--
-- A importação passa a registrar um evento por mudança: quando o vínculo muda,
-- o evento da conciliação (com o MP informado); quando só o informado muda, o
-- evento diz o MP novo e onde o vínculo ficou.
--
-- Só create or replace; nada é removido.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Conciliação de um veículo
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_preventive_reconcile_vehicle(
  p_vehicle_id uuid, p_dry_run boolean default false, p_batch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_plate     text;
  v_last      integer := 0;
  v_rec       record;
  v_eff       integer;
  v_reason    text;
  v_visits    jsonb := '[]'::jsonb;
  v_taken     integer[] := '{}';
  v_plan      jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_target    uuid;
  v_ms        integer;
  v_gap       integer;
  v_changes   jsonb := '[]'::jsonb;
  v_reopened  integer := 0;
  v_completed integer := 0;
  v_source    text := case when p_batch_id is not null then 'import' else 'system' end;
begin
  select v.organization_id, v.license_plate into v_org, v_plate from public.vehicles v where v.id = p_vehicle_id;
  if v_org is null or not exists (select 1 from public.maintenance_preventive_cycles c where c.vehicle_id = p_vehicle_id) then
    return jsonb_build_object('vehicle_id', p_vehicle_id, 'license_plate', v_plate, 'changes', '[]'::jsonb,
                              'reopened', 0, 'completed', 0);
  end if;

  if not p_dry_run then
    perform 1 from public.maintenance_preventive_cycles c where c.vehicle_id = p_vehicle_id for update;
    -- O que está ligado hoje e nunca foi registrado como informado passa a ser o informado.
    update public.maintenances m set preventive_cycle_declared = c.cycle_number
      from public.maintenance_preventive_cycles c
     where c.id = m.preventive_cycle_id and m.vehicle_id = p_vehicle_id
       and m.maintenance_type_code = 'preventive' and m.preventive_cycle_declared is null;
  end if;

  -- Realizadas, na ordem das visitas (no mesmo dia, o MP informado menor primeiro).
  for v_rec in
    select m.id, m.code, m.status, m.entry_date, m.entry_km,
           c.cycle_number::integer as linked,
           coalesce(m.preventive_cycle_declared, c.cycle_number)::integer as declared,
           coalesce(m.entry_date, m.exit_date) as visit_date
      from public.maintenances m
      left join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id
     where m.vehicle_id = p_vehicle_id and m.maintenance_type_code = 'preventive' and m.status = 'completed'
       and coalesce(m.preventive_cycle_declared, c.cycle_number) is not null
     order by coalesce(m.entry_date, m.exit_date), coalesce(m.preventive_cycle_declared, c.cycle_number),
              m.entry_km nulls last, m.code
  loop
    v_eff := null;
    v_reason := null;
    v_ms := null;
    select (x ->> 'cycle')::integer into v_eff
      from jsonb_array_elements(v_visits) x
     where (x ->> 'date')::date = v_rec.visit_date
       and (((x ->> 'km') is null and v_rec.entry_km is null)
            or abs((x ->> 'km')::integer - v_rec.entry_km) <= 100)
     limit 1;
    if v_eff is not null then
      v_reason := 'same_visit';
    elsif v_rec.declared > v_last then
      -- O informado vale, salvo quando a entrada foi bem antes do marco dele
      -- (mais de meio intervalo): aí a revisão é a do marco mais próximo.
      select c.milestone_km, c.milestone_km - coalesce((select p.milestone_km from public.maintenance_preventive_cycles p
                                                         where p.vehicle_id = p_vehicle_id and p.cycle_number = c.cycle_number - 1), 0)
        into v_ms, v_gap
        from public.maintenance_preventive_cycles c
       where c.vehicle_id = p_vehicle_id and c.cycle_number = v_rec.declared;
      if v_ms is null then
        v_reason := 'out_of_plan';
      elsif v_rec.entry_km is not null and v_rec.entry_km < v_ms - v_gap / 2 then
        select c.cycle_number into v_eff
          from public.maintenance_preventive_cycles c
         where c.vehicle_id = p_vehicle_id and c.cycle_number > v_last
         order by abs(c.milestone_km - v_rec.entry_km), c.cycle_number
         limit 1;
        v_reason := case when v_eff = v_rec.declared then 'declared' else 'km_early' end;
      else
        v_eff := v_rec.declared;
        v_reason := 'declared';
      end if;
    else
      select c.cycle_number into v_eff
        from public.maintenance_preventive_cycles c
       where c.vehicle_id = p_vehicle_id and c.cycle_number > v_last
       order by case when v_rec.entry_km is null then 0 else abs(c.milestone_km - v_rec.entry_km) end, c.cycle_number
       limit 1;
      v_reason := case when v_eff is null then 'out_of_plan' else 'km_inferred' end;
    end if;
    if v_eff is not null and v_reason <> 'same_visit' then
      v_last := greatest(v_last, v_eff);
      v_visits := v_visits || jsonb_build_array(jsonb_build_object('date', v_rec.visit_date, 'km', v_rec.entry_km, 'cycle', v_eff));
    end if;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'id', v_rec.id, 'code', v_rec.code, 'status', v_rec.status, 'entry_date', v_rec.entry_date,
      'entry_km', v_rec.entry_km, 'declared', v_rec.declared, 'declared_milestone_km', v_ms,
      'from', v_rec.linked, 'to', v_eff, 'reason', v_reason));
  end loop;

  -- Abertas: as que ainda apontam para um MP não realizado escolhem primeiro.
  for v_rec in
    select m.id, m.code, m.status, m.entry_date, m.entry_km,
           c.cycle_number::integer as linked,
           coalesce(m.preventive_cycle_declared, c.cycle_number)::integer as declared
      from public.maintenances m
      left join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id
     where m.vehicle_id = p_vehicle_id and m.maintenance_type_code = 'preventive'
       and m.status in ('to_schedule', 'scheduled', 'in_progress')
       and coalesce(m.preventive_cycle_declared, c.cycle_number) is not null
     order by (coalesce(m.preventive_cycle_declared, c.cycle_number) <= v_last),
              coalesce(m.preventive_cycle_declared, c.cycle_number), m.requested_on, m.code
  loop
    v_eff := null;
    if v_rec.declared > v_last then
      if v_rec.declared = any (v_taken) then
        v_reason := 'cycle_has_open_maintenance';
      elsif exists (select 1 from public.maintenance_preventive_cycles c
                     where c.vehicle_id = p_vehicle_id and c.cycle_number = v_rec.declared) then
        v_eff := v_rec.declared;
        v_reason := 'declared';
      else
        v_reason := 'out_of_plan';
      end if;
    else
      select min(c.cycle_number) into v_eff
        from public.maintenance_preventive_cycles c
       where c.vehicle_id = p_vehicle_id and c.cycle_number > v_last and not (c.cycle_number = any (v_taken));
      v_reason := case when v_eff is null then 'no_free_cycle' else 'next_pending' end;
    end if;
    if v_eff is not null then
      v_taken := v_taken || v_eff;
    end if;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'id', v_rec.id, 'code', v_rec.code, 'status', v_rec.status, 'entry_date', v_rec.entry_date,
      'entry_km', v_rec.entry_km, 'declared', v_rec.declared, 'from', v_rec.linked, 'to', v_eff, 'reason', v_reason));
  end loop;

  select coalesce(jsonb_agg(x || jsonb_build_object('license_plate', v_plate)), '[]'::jsonb) into v_changes
    from jsonb_array_elements(v_plan) x
   where (x ->> 'to') is not null and (x ->> 'to') is distinct from (x ->> 'from');

  if p_dry_run then
    return jsonb_build_object('vehicle_id', p_vehicle_id, 'license_plate', v_plate, 'dry_run', true,
                              'changes', v_changes, 'plan', v_plan, 'reopened', 0, 'completed', 0);
  end if;

  -- Abertas que mudam de ciclo soltam o atual antes (uma aberta por ciclo).
  update public.maintenances m set preventive_cycle_id = null
   where m.id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_changes) x
                   where x ->> 'status' in ('to_schedule', 'scheduled', 'in_progress'));

  for v_item in select x from jsonb_array_elements(v_changes) x loop
    select c.id into v_target from public.maintenance_preventive_cycles c
     where c.vehicle_id = p_vehicle_id and c.cycle_number = (v_item ->> 'to')::integer;
    update public.maintenances set preventive_cycle_id = v_target where id = (v_item ->> 'id')::uuid;
    perform private.maintenance_log(v_org, (v_item ->> 'id')::uuid, 'preventive_updated', null, null,
      format('Ciclo preventivo conciliado: %s → MP%s. %s',
             coalesce('MP' || (v_item ->> 'from'), 'sem ciclo'), v_item ->> 'to',
             case v_item ->> 'reason'
               when 'km_inferred' then format(
                 'A planilha informa MP%s, ciclo já realizado por outra manutenção; pelo KM de entrada (%s km) a revisão corresponde ao MP%s.',
                 v_item ->> 'declared',
                 coalesce(replace(to_char((v_item ->> 'entry_km')::integer, 'FM999,999,999'), ',', '.'), 'sem KM'),
                 v_item ->> 'to')
               when 'km_early' then format(
                 'A planilha informa MP%s (marco de %s km), mas a entrada foi aos %s km, longe desse marco; pelo KM a revisão corresponde ao MP%s.',
                 v_item ->> 'declared',
                 replace(to_char((v_item ->> 'declared_milestone_km')::integer, 'FM999,999,999'), ',', '.'),
                 replace(to_char((v_item ->> 'entry_km')::integer, 'FM999,999,999'), ',', '.'),
                 v_item ->> 'to')
               when 'same_visit' then format(
                 'Mesma visita (data e KM) da preventiva que realizou o MP%s: não realiza outro ciclo (a planilha informa MP%s).',
                 v_item ->> 'to', v_item ->> 'declared')
               when 'next_pending' then format(
                 'A planilha informa MP%s, já realizado; a manutenção em aberto passa ao próximo ciclo pendente.',
                 v_item ->> 'declared')
               else format('Ciclo informado%s: MP%s.', case when p_batch_id is not null then ' na importação' else '' end,
                           v_item ->> 'declared')
             end),
      v_item || jsonb_build_object('reconciled', true, 'batch_id', p_batch_id),
      v_source);
  end loop;

  -- O ciclo é realizado pela primeira preventiva concluída ligada a ele; o que
  -- ficou sem nenhuma volta a ficar em aberto (realização manual não é tocada).
  with d as (
    select distinct on (m.preventive_cycle_id) m.preventive_cycle_id as cycle_id
      from public.maintenances m
     where m.vehicle_id = p_vehicle_id and m.status = 'completed' and m.preventive_cycle_id is not null
     order by m.preventive_cycle_id)
  update public.maintenance_preventive_cycles c set
    completed_on = null, completed_km = null, completed_maintenance_id = null, completion_source = null
   where c.vehicle_id = p_vehicle_id and c.completed_maintenance_id is not null
     and not exists (select 1 from d where d.cycle_id = c.id);
  get diagnostics v_reopened = row_count;

  with d as (
    select distinct on (m.preventive_cycle_id) m.preventive_cycle_id as cycle_id, m.id,
           coalesce(m.exit_date, m.entry_date) as done_on, m.entry_km, m.import_batch_id
      from public.maintenances m
     where m.vehicle_id = p_vehicle_id and m.status = 'completed' and m.preventive_cycle_id is not null
     order by m.preventive_cycle_id, coalesce(m.exit_date, m.entry_date), m.code)
  update public.maintenance_preventive_cycles c set
    completed_on = d.done_on,
    completed_km = d.entry_km,
    completed_maintenance_id = d.id,
    completion_source = case when c.completed_maintenance_id = d.id and c.completion_source is not null then c.completion_source
                             when d.import_batch_id is not null then 'import'
                             else 'maintenance' end
    from d
   where c.id = d.cycle_id and c.completion_source is distinct from 'manual' and d.done_on is not null
     and (c.completed_maintenance_id is distinct from d.id
          or c.completed_km is distinct from d.entry_km
          or c.completed_on is distinct from d.done_on);
  get diagnostics v_completed = row_count;

  return jsonb_build_object('vehicle_id', p_vehicle_id, 'license_plate', v_plate, 'dry_run', false,
                            'changes', v_changes, 'reopened', v_reopened, 'completed', v_completed);
end;
$$;

revoke all on function private.maintenance_preventive_reconcile_vehicle(uuid, boolean, uuid) from public, anon;
grant execute on function private.maintenance_preventive_reconcile_vehicle(uuid, boolean, uuid) to authenticated, service_role;

comment on function private.maintenance_preventive_reconcile_vehicle(uuid, boolean, uuid) is
  'Concilia o MP informado (preventive_cycle_declared) com o ciclo realizado: informado crescente vale (salvo entrada mais de meio intervalo antes do marco dele); repetido/menor sai do KM de entrada; mesma visita não realiza outro ciclo; aberta de MP já realizado vai ao próximo pendente. p_dry_run só devolve o plano.';

-- -----------------------------------------------------------------------------
-- 2. A importação informa o MP; a conciliação decide o vínculo
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_import_link_cycle(p_maintenance_id uuid, p_cycle_number integer, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m    public.maintenances;
  v_prev integer;
  v_res  jsonb;
  v_c    public.maintenance_preventive_cycles;
begin
  select * into v_m from public.maintenances where id = p_maintenance_id for update;
  if v_m.id is null or v_m.maintenance_type_code <> 'preventive' or p_cycle_number is null then
    return jsonb_build_object('linked', false, 'reason', 'not_applicable');
  end if;
  perform private.maintenance_sync_preventive_vehicle(v_m.vehicle_id);
  if not exists (select 1 from public.maintenance_preventive_cycles c
                  where c.vehicle_id = v_m.vehicle_id and c.cycle_number = p_cycle_number) then
    return jsonb_build_object('linked', false, 'reason', 'no_cycle');
  end if;

  v_prev := coalesce(v_m.preventive_cycle_declared,
                     (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = v_m.preventive_cycle_id));
  if v_m.preventive_cycle_declared is distinct from p_cycle_number then
    update public.maintenances set preventive_cycle_declared = p_cycle_number where id = v_m.id;
  end if;

  v_res := private.maintenance_preventive_reconcile_vehicle(v_m.vehicle_id, false, p_batch_id);

  select c.* into v_c from public.maintenances m
    join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id
   where m.id = v_m.id;
  -- Vínculo mudou: o evento da conciliação já traz o MP informado. Só o
  -- informado mudou: a trilha registra o novo MP e onde o vínculo ficou.
  if v_prev is distinct from p_cycle_number
     and not exists (select 1 from jsonb_array_elements(coalesce(v_res -> 'changes', '[]'::jsonb)) x
                      where x ->> 'id' = v_m.id::text) then
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'preventive_updated', null, null,
      format('Ciclo preventivo informado na importação: MP%s%s.', p_cycle_number,
             case when v_c.id is null or v_c.cycle_number = p_cycle_number then ''
                  else format('; o vínculo continua no MP%s (sequência e KM de entrada)', v_c.cycle_number) end),
      jsonb_build_object('batch_id', p_batch_id, 'declared_from', v_prev, 'declared_to', p_cycle_number,
                         'cycle_number', v_c.cycle_number), 'import');
  end if;
  return jsonb_build_object('linked', v_c.id is not null, 'cycle_id', v_c.id, 'cycle_number', v_c.cycle_number,
                            'declared', p_cycle_number, 'completed', v_m.status = 'completed');
end;
$$;

revoke all on function private.maintenance_import_link_cycle(uuid, integer, uuid) from public, anon;
grant execute on function private.maintenance_import_link_cycle(uuid, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Lote de manutenções concluído: aviso do novo motivo
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_import_after_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b       public.import_batches;
  r         record;
  v_km      integer := 0;
  v_vehicle uuid;
  v_res     jsonb;
  v_changes jsonb := '[]'::jsonb;
begin
  select * into v_b from public.import_batches where id = p_batch_id;
  if v_b.id is null or v_b.type <> 'maintenance' then
    return jsonb_build_object('skipped', true);
  end if;

  -- KM de entrada que veio da importação (ou faltava) e a planilha corrigiu;
  -- registro alterado por usuário nunca é tocado.
  for r in
    select distinct on (m.id) m.id, m.organization_id, m.entry_km as km_from,
           (x.normalized_data ->> 'entry_km')::integer as km_to, x.row_number
      from public.import_rows x
      join public.maintenances m on m.id = (x.normalized_data ->> 'existing_id')::uuid
     where x.batch_id = p_batch_id and x.normalized_data ->> 'existing_id' is not null
       and x.normalized_data ->> 'entry_km' ~ '^[0-9]{1,7}$'
       and m.status in ('in_progress', 'completed')
       and (m.entry_km is null or m.entry_km_source = 'import')
       and m.entry_km is distinct from (x.normalized_data ->> 'entry_km')::integer
       and not exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user')
     order by m.id, x.row_number
  loop
    update public.maintenances set
      entry_km = r.km_to,
      entry_km_source = 'import',
      entry_km_status = case when entry_km_status is null or entry_km_status in ('not_found', 'to_review') then 'manual'
                             else entry_km_status end
     where id = r.id;
    perform private.maintenance_log(r.organization_id, r.id, 'km_changed', null, null,
      format('KM de entrada corrigido pela planilha %s: %s → %s km.', coalesce(v_b.file_name, ''),
             coalesce(r.km_from::text, 'vazio'), r.km_to),
      jsonb_build_object('batch_id', p_batch_id, 'km_from', r.km_from, 'km_to', r.km_to, 'row_number', r.row_number),
      'import');
    v_km := v_km + 1;
  end loop;

  -- MP informado das preventivas do lote que ainda não o têm: as criadas agora
  -- (pela chave da entrada) e as existentes que o arquivo trouxe (veículo ainda
  -- sem regra, por exemplo) — sem ele, cadastrar a regra depois não teria o que
  -- conciliar.
  update public.maintenances m set preventive_cycle_declared = l.cycle
    from (select distinct on (x.normalized_data ->> 'group_key') x.normalized_data ->> 'group_key' as gk,
                 (x.normalized_data ->> 'preventive_cycle')::smallint as cycle
            from public.import_rows x
           where x.batch_id = p_batch_id and x.normalized_data ->> 'preventive_cycle' ~ '^[0-9]{1,3}$'
             and x.normalized_data ->> 'group_key' is not null
           order by x.normalized_data ->> 'group_key', x.row_number) l
   where m.organization_id = v_b.organization_id and m.import_key = l.gk
     and m.maintenance_type_code = 'preventive' and m.preventive_cycle_declared is null and l.cycle between 1 and 999;
  update public.maintenances m set preventive_cycle_declared = l.cycle
    from (select distinct on ((x.normalized_data ->> 'existing_id')::uuid) (x.normalized_data ->> 'existing_id')::uuid as mid,
                 (x.normalized_data ->> 'preventive_cycle')::smallint as cycle
            from public.import_rows x
           where x.batch_id = p_batch_id and x.normalized_data ->> 'preventive_cycle' ~ '^[0-9]{1,3}$'
             and x.normalized_data ->> 'existing_id' is not null
           order by (x.normalized_data ->> 'existing_id')::uuid, x.row_number) l
   where m.id = l.mid and m.maintenance_type_code = 'preventive' and m.preventive_cycle_declared is null
     and l.cycle between 1 and 999;

  for v_vehicle in
    select distinct (x.normalized_data ->> 'vehicle_id')::uuid
      from public.import_rows x
     where x.batch_id = p_batch_id and x.normalized_data ->> 'type' = 'preventive'
       and x.normalized_data ->> 'vehicle_id' is not null
  loop
    v_res := private.maintenance_preventive_reconcile_vehicle(v_vehicle, false, p_batch_id);
    v_changes := v_changes || coalesce(v_res -> 'changes', '[]'::jsonb);
  end loop;

  -- O que a conciliação mudou fica também como aviso do lote.
  insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
  select v_b.organization_id, p_batch_id,
         (select min(x.row_number) from public.import_rows x
           where x.batch_id = p_batch_id
             and (x.normalized_data ->> 'existing_id' = c ->> 'id'
                  or x.normalized_data ->> 'group_key' = (select m.import_key from public.maintenances m where m.id = (c ->> 'id')::uuid))),
         'warning', 'preventive_cycle', 'cycle_reconciled',
         format('%s (%s): informado MP%s, vinculada ao MP%s — %s.', c ->> 'code', c ->> 'license_plate', c ->> 'declared', c ->> 'to',
                case c ->> 'reason'
                  when 'km_inferred' then 'MP informado já realizado; ciclo definido pelo KM de entrada'
                  when 'km_early' then 'entrada bem antes do marco do MP informado; ciclo definido pelo KM de entrada'
                  when 'same_visit' then 'mesma visita de outra preventiva; não realiza outro ciclo'
                  when 'next_pending' then 'MP informado já realizado; passa ao próximo ciclo pendente'
                  else 'ciclo informado' end)
    from jsonb_array_elements(v_changes) c
   where c ->> 'reason' <> 'declared';

  return jsonb_build_object('km_fixed', v_km, 'cycles_reconciled', jsonb_array_length(v_changes));
end;
$$;

revoke all on function private.maintenance_import_after_batch(uuid) from public, anon;
grant execute on function private.maintenance_import_after_batch(uuid) to authenticated, service_role;
