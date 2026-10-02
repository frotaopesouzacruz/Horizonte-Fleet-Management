-- =============================================================================
-- Manutenção — o ciclo preventivo informado na planilha × o ciclo realizado
--
-- A importação ligava cada preventiva ao MP da coluna "Ciclo Preventivo" sem
-- conferir. Quando a coluna repete um MP já realizado (SNT8I36: "MP1" aos
-- 60.126 km, depois do MP1 e do MP2), a manutenção ficava ligada a um ciclo já
-- fechado por outra e o MP verdadeiro (MP3) continuava pendente na Preventiva.
-- Quando a mesma visita aparece duas vezes com MPs diferentes (SNT8E16 e
-- SNT8G06: MP3 e MP4 no mesmo dia e KM), o MP seguinte era dado como feito.
-- E preventivas importadas antes de existir a regra do veículo nunca eram
-- ligadas depois que a regra era cadastrada (SNU9C19).
--
-- Agora:
--   * maintenances.preventive_cycle_declared guarda o MP INFORMADO (planilha ou
--     tela); preventive_cycle_id é o ciclo EFETIVO, conciliado por veículo:
--       - informado maior que o último realizado  → vale o informado;
--       - informado repetido/menor                → o ciclo sai do KM de entrada
--                                                  (marco mais próximo entre os
--                                                  ainda não realizados);
--       - mesma visita (data e KM) de outra preventiva → não realiza outro ciclo;
--       - aberta cujo MP já foi realizado          → próximo ciclo pendente.
--     Cada mudança fica na trilha (evento preventive_updated, com o informado,
--     o anterior, o novo e o motivo).
--   * A conciliação roda: ao concluir um lote de importação de manutenções
--     (que também corrige o KM de entrada vindo da planilha quando ele veio da
--     importação e ninguém o alterou), ao gerar/ajustar ciclos (salvar a regra
--     preventiva) e quando a importação informa o ciclo de uma existente.
--   * A importação compara o MP informado (não o efetivo): reimportar o mesmo
--     arquivo continua sem mudanças.
--
-- Só create or replace, uma coluna nova e gatilhos novos; nada é removido.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. MP informado
-- -----------------------------------------------------------------------------
alter table public.maintenances add column if not exists preventive_cycle_declared smallint;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.maintenances'::regclass
                  and conname = 'maintenances_preventive_cycle_declared_check') then
    alter table public.maintenances add constraint maintenances_preventive_cycle_declared_check
      check (preventive_cycle_declared is null or preventive_cycle_declared between 1 and 999);
  end if;
end
$chk$;

comment on column public.maintenances.preventive_cycle_declared is
  'MP informado para a preventiva (coluna Ciclo Preventivo da planilha ou escolhido na tela). O ciclo efetivo é preventive_cycle_id, conciliado pela sequência e pelo KM de entrada (private.maintenance_preventive_reconcile_vehicle).';

-- O informado de hoje: o ciclo ligado; sem ligação, o MP da última importação
-- concluída que trouxe a manutenção.
update public.maintenances m set preventive_cycle_declared = c.cycle_number
  from public.maintenance_preventive_cycles c
 where c.id = m.preventive_cycle_id and m.maintenance_type_code = 'preventive' and m.preventive_cycle_declared is null;

update public.maintenances m set preventive_cycle_declared = l.cycle
  from (select distinct on ((x.normalized_data ->> 'existing_id')::uuid)
               (x.normalized_data ->> 'existing_id')::uuid as mid,
               (x.normalized_data ->> 'preventive_cycle')::smallint as cycle
          from public.import_rows x
          join public.import_batches b on b.id = x.batch_id
         where b.type = 'maintenance' and b.status = 'completed'
           and x.normalized_data ->> 'existing_id' is not null
           and x.normalized_data ->> 'preventive_cycle' ~ '^[0-9]{1,3}$'
         order by (x.normalized_data ->> 'existing_id')::uuid, b.processed_at desc nulls last, x.row_number) l
 where l.mid = m.id and m.maintenance_type_code = 'preventive' and m.preventive_cycle_declared is null
   and l.cycle between 1 and 999;

-- -----------------------------------------------------------------------------
-- 2. Conciliação de um veículo
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
    select (x ->> 'cycle')::integer into v_eff
      from jsonb_array_elements(v_visits) x
     where (x ->> 'date')::date = v_rec.visit_date
       and (((x ->> 'km') is null and v_rec.entry_km is null)
            or abs((x ->> 'km')::integer - v_rec.entry_km) <= 100)
     limit 1;
    if v_eff is not null then
      v_reason := 'same_visit';
    elsif v_rec.declared > v_last then
      if exists (select 1 from public.maintenance_preventive_cycles c
                  where c.vehicle_id = p_vehicle_id and c.cycle_number = v_rec.declared) then
        v_eff := v_rec.declared;
        v_reason := 'declared';
      else
        v_reason := 'out_of_plan';
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
      'entry_km', v_rec.entry_km, 'declared', v_rec.declared, 'from', v_rec.linked, 'to', v_eff, 'reason', v_reason));
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
               when 'same_visit' then format(
                 'Mesma visita (data e KM) da preventiva que realizou o MP%s: não realiza outro ciclo (a planilha informa MP%s).',
                 v_item ->> 'to', v_item ->> 'declared')
               when 'next_pending' then format(
                 'A planilha informa MP%s, já realizado; a manutenção em aberto passa ao próximo ciclo pendente.',
                 v_item ->> 'declared')
               else format('Ciclo informado: MP%s.', v_item ->> 'declared')
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
  'Concilia o MP informado (preventive_cycle_declared) com o ciclo realizado: informado crescente vale; repetido/menor sai do KM de entrada; mesma visita não realiza outro ciclo; aberta de MP já realizado vai ao próximo pendente. p_dry_run só devolve o plano.';

-- -----------------------------------------------------------------------------
-- 3. Conciliação pela tela/rotina (organização inteira ou um veículo)
-- -----------------------------------------------------------------------------
create or replace function public.maintenance_reconcile_preventive(
  p_organization_id uuid, p_vehicle_id uuid default null, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle   uuid;
  v_res       jsonb;
  v_changes   jsonb := '[]'::jsonb;
  v_vehicles  integer := 0;
  v_reopened  integer := 0;
  v_completed integer := 0;
begin
  if not private.has_permission(p_organization_id, 'maintenance.manage_parameters') then
    raise exception 'Sem permissão para conciliar os ciclos preventivos.' using errcode = 'insufficient_privilege';
  end if;
  for v_vehicle in
    select distinct c.vehicle_id from public.maintenance_preventive_cycles c
     where c.organization_id = p_organization_id and (p_vehicle_id is null or c.vehicle_id = p_vehicle_id)
  loop
    v_res := private.maintenance_preventive_reconcile_vehicle(v_vehicle, p_dry_run, null);
    v_vehicles := v_vehicles + 1;
    v_changes := v_changes || coalesce(v_res -> 'changes', '[]'::jsonb);
    v_reopened := v_reopened + coalesce((v_res ->> 'reopened')::integer, 0);
    v_completed := v_completed + coalesce((v_res ->> 'completed')::integer, 0);
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'vehicles', v_vehicles, 'changed', jsonb_array_length(v_changes),
                            'cycles_reopened', v_reopened, 'cycles_completed', v_completed, 'changes', v_changes);
end;
$$;

revoke all on function public.maintenance_reconcile_preventive(uuid, uuid, boolean) from public, anon;
grant execute on function public.maintenance_reconcile_preventive(uuid, uuid, boolean) to authenticated, service_role;

comment on function public.maintenance_reconcile_preventive(uuid, uuid, boolean) is
  'Concilia os ciclos preventivos da organização (ou de um veículo). Exige maintenance.manage_parameters. Por padrão só simula (p_dry_run = true).';

-- -----------------------------------------------------------------------------
-- 4. A importação informa o MP; a conciliação decide o vínculo
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
  if v_prev is distinct from p_cycle_number then
    update public.maintenances set preventive_cycle_declared = p_cycle_number where id = v_m.id;
    perform private.maintenance_log(v_m.organization_id, v_m.id, 'preventive_updated', null, null,
      format('Ciclo preventivo informado na importação: MP%s.', p_cycle_number),
      jsonb_build_object('batch_id', p_batch_id, 'declared_from', v_prev, 'declared_to', p_cycle_number), 'import');
  elsif v_m.preventive_cycle_declared is null then
    update public.maintenances set preventive_cycle_declared = p_cycle_number where id = v_m.id;
  end if;

  perform private.maintenance_preventive_reconcile_vehicle(v_m.vehicle_id, false, p_batch_id);

  select c.* into v_c from public.maintenances m
    join public.maintenance_preventive_cycles c on c.id = m.preventive_cycle_id
   where m.id = v_m.id;
  return jsonb_build_object('linked', v_c.id is not null, 'cycle_id', v_c.id, 'cycle_number', v_c.cycle_number,
                            'declared', p_cycle_number, 'completed', v_m.status = 'completed');
end;
$$;

revoke all on function private.maintenance_import_link_cycle(uuid, integer, uuid) from public, anon;
grant execute on function private.maintenance_import_link_cycle(uuid, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Lote de manutenções concluído: KM da planilha e conciliação dos veículos
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

create or replace function private.maintenance_import_batches_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.maintenance_import_after_batch(new.id);
  return null;
end;
$$;

revoke all on function private.maintenance_import_batches_completed() from public, anon;

create or replace trigger import_batches_maintenance_completed
  after update of status on public.import_batches
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed' and new.type = 'maintenance')
  execute function private.maintenance_import_batches_completed();

-- -----------------------------------------------------------------------------
-- 6. Ciclos gerados ou ajustados pela regra (salvar a regra preventiva): concilia
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_cycles_reconcile_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle uuid;
begin
  for v_vehicle in select distinct n.vehicle_id from new_cycles n loop
    perform private.maintenance_preventive_reconcile_vehicle(v_vehicle, false, null);
  end loop;
  return null;
end;
$$;

create or replace function private.maintenance_cycles_reconcile_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle uuid;
begin
  -- Só mudança de regra/marco; a própria conciliação (realização) não volta aqui.
  for v_vehicle in
    select distinct n.vehicle_id from new_cycles n join old_cycles o on o.id = n.id
     where n.milestone_km is distinct from o.milestone_km or n.rule_id is distinct from o.rule_id
  loop
    perform private.maintenance_preventive_reconcile_vehicle(v_vehicle, false, null);
  end loop;
  return null;
end;
$$;

revoke all on function private.maintenance_cycles_reconcile_inserted() from public, anon;
revoke all on function private.maintenance_cycles_reconcile_updated() from public, anon;

create or replace trigger maintenance_preventive_cycles_reconcile_ins
  after insert on public.maintenance_preventive_cycles
  referencing new table as new_cycles
  for each statement
  execute function private.maintenance_cycles_reconcile_inserted();

create or replace trigger maintenance_preventive_cycles_reconcile_upd
  after update on public.maintenance_preventive_cycles
  referencing old table as old_cycles new table as new_cycles
  for each statement
  execute function private.maintenance_cycles_reconcile_updated();

-- -----------------------------------------------------------------------------
-- 7. Linha da manutenção: MP efetivo e MP informado
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_row_json(p_m public.maintenances, p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_m.id, 'code', p_m.code, 'vehicle_id', p_m.vehicle_id,
    'license_plate', p_m.license_plate_snapshot, 'fleet_code', p_m.fleet_code_snapshot,
    'type', p_m.maintenance_type_code, 'type_name', (select t.name from public.maintenance_types t where t.code = p_m.maintenance_type_code),
    'origin_id', p_m.origin_id, 'origin_name', (select o.name from public.maintenance_origins o where o.id = p_m.origin_id),
    'priority', p_m.priority, 'status', p_m.status,
    'requested_on', p_m.requested_on, 'scheduled_date', p_m.scheduled_date, 'scheduled_time', p_m.scheduled_time,
    'expected_exit_date', p_m.expected_exit_date, 'expected_exit_time', p_m.expected_exit_time,
    'entry_date', p_m.entry_date, 'entry_time', p_m.entry_time, 'exit_date', p_m.exit_date, 'exit_time', p_m.exit_time,
    'duration_hours', p_m.duration_hours, 'duration_precision', p_m.duration_precision,
    'supplier_id', p_m.supplier_id, 'supplier_name', (select s.name from public.maintenance_suppliers s where s.id = p_m.supplier_id),
    'supplier_name_informed', p_m.supplier_name_informed,
    'service_order_number', p_m.service_order_number,
    'entry_km', p_m.entry_km, 'entry_km_status', p_m.entry_km_status, 'entry_km_source', p_m.entry_km_source,
    'current_km', p_m.current_km_snapshot,
    'operation_id', p_m.operation_id, 'operation_name', p_m.operation_name_snapshot,
    'city_id', p_m.city_id, 'city_name', p_m.city_name_snapshot, 'state_uf', p_m.state_uf_snapshot,
    'br_id', p_m.operation_br_id, 'br_code', p_m.br_code_snapshot,
    'leader_id', p_m.leader_employee_id, 'leader_name', p_m.leader_name_snapshot, 'unit_name', p_m.unit_name_snapshot,
    'preventive_cycle_id', p_m.preventive_cycle_id, 'predictive_cycle_id', p_m.predictive_cycle_id,
    'description', p_m.description, 'reopen_count', p_m.reopen_count,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'service_id', i.service_id, 'service', i.service_name_snapshot,
                'cluster_id', i.cluster_id, 'cluster', i.cluster_name_snapshot,
                'criticality', i.criticality, 'status', i.status, 'result', i.result) order by i.sort_order), '[]')
                from public.maintenance_items i where i.maintenance_id = p_m.id and i.status <> 'cancelled'),
    'late_entry', p_m.status = 'scheduled' and p_m.scheduled_date < p_today,
    'exit_overdue', p_m.status = 'in_progress' and p_m.expected_exit_date < p_today,
    'age_days', case when p_m.status in ('to_schedule', 'scheduled', 'in_progress')
                     then p_today - coalesce(p_m.entry_date, p_m.requested_on) end,
    'created_at', p_m.created_at, 'updated_at', p_m.updated_at)
  || jsonb_build_object(
    'preventive_cycle_number', (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = p_m.preventive_cycle_id),
    'preventive_cycle_declared', p_m.preventive_cycle_declared);
$$;

-- -----------------------------------------------------------------------------
-- 8. A importação compara o MP informado (reidentificação e prévia)
-- -----------------------------------------------------------------------------
create or replace function private.maintenance_import_reidentify(p_organization_id uuid, p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g      record;
  v_row    record;
  v_m      record;
  v_id     uuid;
  v_d      jsonb;
  v_change boolean;
  v_msgs   jsonb;
  v_msg    jsonb;
  v_sched  date;
  v_n      integer := 0;
begin
  for v_g in
    with rows as (
      select x.id, x.row_number, x.action, x.normalized_data as d
        from public.import_rows x
       where x.batch_id = p_batch_id and x.status in ('valid', 'warning')
    ), eligible as (
      select r.d ->> 'group_key' as g
        from rows r
       group by 1
      having bool_and(r.d ->> 'status' in ('to_schedule', 'scheduled'))
         and bool_and(not coalesce((r.d ->> 'matched_by_os')::boolean, false))
         and bool_and(not coalesce((r.d ->> 'context_only')::boolean, false))
    ), residual as (
      select r.* from rows r join eligible e on e.g = r.d ->> 'group_key'
       where r.d ->> 'vehicle_id' is not null and r.d ->> 'service_id' is not null and r.d ->> 'type' is not null
         and ((r.action in ('create', 'update') and r.d ->> 'existing_id' is null)
              or (r.action = 'update' and r.d ->> 'existing_id' is not null
                  and not exists (select 1 from public.maintenance_items i
                                   where i.maintenance_id = (r.d ->> 'existing_id')::uuid
                                     and i.service_id = (r.d ->> 'service_id')::uuid))
              or r.d ? 'dup_of')
    ), grp as (
      select r.d ->> 'group_key' as g,
             min(r.d ->> 'vehicle_id')::uuid as vehicle_id, min(r.d ->> 'type') as type_code,
             array_agg(distinct (r.d ->> 'service_id')::uuid order by (r.d ->> 'service_id')::uuid) as services,
             min((r.d ->> 'preventive_cycle')::integer) as cycle_min, max((r.d ->> 'preventive_cycle')::integer) as cycle_max,
             array_agg(r.id order by r.row_number) as row_ids, min(r.row_number) as first_row
        from residual r group by 1
    ), claimed_keys as (
      select distinct x.normalized_data ->> 'group_key' as k from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ? 'group_key'
    ), claimed_ids as (
      select distinct (x.normalized_data ->> 'existing_id')::uuid as id from public.import_rows x
       where x.batch_id = p_batch_id and x.normalized_data ? 'existing_id'
    ), cand as (
      select g.g, m.id, m.code
        from grp g
        join public.maintenances m
          on m.organization_id = p_organization_id and m.vehicle_id = g.vehicle_id
         and m.maintenance_type_code = g.type_code and m.status in ('to_schedule', 'scheduled')
         and m.import_key is not null
       where g.cycle_min is not distinct from g.cycle_max
         and not exists (select 1 from claimed_keys c where c.k = m.import_key)
         and not exists (select 1 from claimed_ids c where c.id = m.id)
         and not exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user')
         and (select array_agg(distinct i.service_id order by i.service_id) from public.maintenance_items i
               where i.maintenance_id = m.id) = g.services
         and (g.cycle_min is null or m.preventive_cycle_id is null
              or coalesce(m.preventive_cycle_declared, (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id)) = g.cycle_min)
    ), ranked as (
      select c.*, count(*) over (partition by c.g) as n_g, count(*) over (partition by c.id) as n_m from cand c
    )
    select g.g, g.row_ids, g.first_row,
           (select r.id from ranked r where r.g = g.g and r.n_g = 1 and r.n_m = 1) as target_id,
           (select string_agg(r.code, ', ' order by r.code) from ranked r where r.g = g.g) as codes,
           (select bool_or(r.n_m > 1) from ranked r where r.g = g.g) as shared,
           not exists (select 1 from rows r where r.d ->> 'group_key' = g.g and r.d ->> 'existing_id' is not null) as move_key
      from grp g
     where exists (select 1 from ranked r where r.g = g.g)
     order by g.first_row
  loop
    if v_g.target_id is null then
      -- Mais de uma candidata (ou a mesma candidata serve a outra entrada):
      -- nada é reaproveitado; o aviso lista as candidatas.
      foreach v_id in array v_g.row_ids loop
        select x.id, x.row_number into v_row from public.import_rows x where x.id = v_id;
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, 'warning', null, 'reidentify_ambiguous',
                format('Mais de uma manutenção aberta do mesmo veículo, tipo e serviços pode ser esta linha (%s)%s: nenhuma foi reaproveitada e a linha segue como estava. Confira antes de gravar.',
                       v_g.codes, case when v_g.shared then ', ou a candidata também serve a outra linha do arquivo' else '' end));
        update public.import_rows set status = 'warning' where id = v_id and status = 'valid';
      end loop;
      continue;
    end if;

    select m.*, coalesce(m.preventive_cycle_declared, (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id)) as cycle_number
      into v_m from public.maintenances m where m.id = v_g.target_id;

    foreach v_id in array v_g.row_ids loop
      select x.id, x.row_number, x.normalized_data as d into v_row from public.import_rows x where x.id = v_id;
      -- O que a validação comparou com a manutenção da chave (contexto) não
      -- vale mais: a comparação agora é com a manutenção reconhecida.
      v_d := v_row.d - 'dup_of' - 'context_fill';
      v_msgs := '[]'::jsonb;
      v_change := false;
      v_sched := (v_d ->> 'scheduled_date')::date;

      -- Situação e fornecedor: as mesmas regras da gravação.
      if (v_d ->> 'status') is distinct from v_m.status then
        v_change := true;
      end if;
      if ((v_d ->> 'supplier_id') is not null and (v_d ->> 'supplier_id')::uuid is distinct from v_m.supplier_id)
         or (v_m.supplier_id is null and (v_d ->> 'supplier_name_informed') is distinct from v_m.supplier_name_informed) then
        v_change := true;
      end if;
      -- Data agendada diferente numa agendada: reprogramação (nunca antes da
      -- solicitação, como na reprogramação pela tela).
      if v_d ->> 'status' = 'scheduled' and v_m.status = 'scheduled' and v_sched is not null
         and v_sched is distinct from v_m.scheduled_date then
        if v_sched < v_m.requested_on then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'scheduled_date', 'code', 'reschedule_before_request',
                    'message', format('Data agendada %s anterior à solicitação de %s (%s): mantida a do HFM (%s).',
                                      to_char(v_sched, 'DD/MM/YYYY'), v_m.code, to_char(v_m.requested_on, 'DD/MM/YYYY'),
                                      to_char(v_m.scheduled_date, 'DD/MM/YYYY')));
        else
          v_change := true;
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'scheduled_date', 'code', 'rescheduled',
                    'message', format('%s reprogramada de %s para %s (registrado na trilha como reprogramação).',
                                      v_m.code, to_char(v_m.scheduled_date, 'DD/MM/YYYY'), to_char(v_sched, 'DD/MM/YYYY')));
        end if;
      end if;
      -- OS: vazia na planilha mantém a do HFM; informada e diferente, atualiza.
      if v_d ->> 'service_order_number' is null and v_m.service_order_number is not null then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service_order_number', 'code', 'os_kept',
                  'message', format('OS ausente na planilha; mantida a do HFM (%s).', v_m.service_order_number));
      elsif v_d ->> 'service_order_number' is not null
            and upper(btrim(v_d ->> 'service_order_number')) is distinct from upper(btrim(v_m.service_order_number)) then
        v_change := true;
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service_order_number', 'code', 'os_changed',
                  'message', format('OS de %s passa de %s para %s.', v_m.code, coalesce(v_m.service_order_number, '(vazia)'),
                                    v_d ->> 'service_order_number'));
      end if;
      if v_m.maintenance_type_code = 'preventive' and (v_d ->> 'preventive_cycle') is not null
         and v_m.cycle_number is distinct from (v_d ->> 'preventive_cycle')::integer
         and exists (select 1 from public.maintenance_preventive_rules pr
                      where pr.id = private.maintenance_preventive_rule_for(v_m.vehicle_id)
                        and (v_d ->> 'preventive_cycle')::integer <= pr.cycle_count) then
        v_change := true;
      end if;
      -- Contexto: preenche o vazio; diferente, avisa e mantém.
      if v_m.operation_id is null and (v_d ->> 'operation_id') is not null then
        v_change := true;
        v_d := v_d || jsonb_build_object('context_fill', true);
      elsif v_m.operation_id is not null and (v_d ->> 'operation_id') is not null
            and v_m.operation_id <> (v_d ->> 'operation_id')::uuid then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'context_divergent',
                  'message', format('Contexto divergente: mantido o do HFM (%s); planilha: %s.',
                                    concat_ws(' — ', v_m.operation_name_snapshot, v_m.city_name_snapshot || coalesce('/' || v_m.state_uf_snapshot, '')),
                                    private.maintenance_import_context_of((v_d ->> 'operation_id')::uuid, (v_d ->> 'city_id')::integer) ->> 'label'));
      end if;

      v_msgs := jsonb_build_array(jsonb_build_object('level', 'warning', 'field', null, 'code', 'reidentified',
                  'message', format('Reconhecida como %s: manutenção aberta do mesmo veículo, tipo e serviços%s, criada pela importação e sem alteração de usuário. A planilha mudou a OS, a data ou o fornecedor; %s, sem criar outra.',
                                    v_m.code, case when v_m.cycle_number is not null then format(' (MP%s)', v_m.cycle_number) else '' end,
                                    case when v_change then 'a manutenção é atualizada' else 'nada muda' end)))
                || v_msgs;
      if not v_change then
        v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'unchanged',
                  'message', format('%s já importada, sem mudança.', v_m.code));
      end if;

      -- Os achados que a reidentificação torna superados não são apagados: ficam
      -- marcados como 'superseded', com a mensagem original — a
      -- trilha da validação continua completa e as contagens da prévia (por
      -- código exato) deixam de considerá-los.
      update public.import_errors e
         set code = 'superseded',
             message = '[Superado pela reidentificação] ' || e.message
       where e.batch_id = p_batch_id and e.row_number = v_row.row_number and e.code in ('duplicate_in_file', 'context_divergent');
      update public.import_rows set
        normalized_data = v_d || jsonb_build_object(
          'existing_id', v_m.id, 'existing_code', v_m.code, 'existing_cycle', v_m.cycle_number,
          'matched_by_os', false, 'reidentified', true, 'file_group_key', v_g.g, 'move_key', v_g.move_key,
          'group_key', 'reid:' || v_m.id::text, 'item_key', 'reid:' || v_m.id::text || ':' || (v_d ->> 'service_id')),
        action = case when v_change then 'update' else 'skip' end,
        status = 'warning'
      where id = v_row.id;
      for v_msg in select * from jsonb_array_elements(v_msgs) loop
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, p_batch_id, v_row.row_number, v_msg ->> 'level', v_msg ->> 'field', v_msg ->> 'code', v_msg ->> 'message');
      end loop;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

create or replace function public.stage_maintenance_import(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase   text := coalesce(nullif(p_payload ->> 'phase', ''), 'all');
  v_kind    text := coalesce(nullif(p_payload ->> 'kind', ''), 'records');
  v_limit   integer := nullif(p_payload ->> 'limit', '')::integer;
  v_type    text;
  v_batch   uuid;
  v_loaded  integer;
  v_pend    record;
  r         jsonb;
  v_today   date := private.maintenance_today(p_organization_id);
  -- linha
  v_level text; v_action text; v_msgs jsonb; v_norm jsonb;
  v_vehicle record; v_type_code text; v_origin_code text; v_status text; v_raw text;
  v_service uuid; v_cluster uuid; v_supplier uuid; v_mismatch boolean; v_informed text;
  v_req date; v_sched date; v_entry date; v_exit date; v_ref date; v_expected date;
  v_key text; v_group text; v_existing record; v_other record; v_dup boolean;
  v_km integer; v_km_num numeric; v_cycle integer; v_times_ok boolean;
  v_rule record; v_fallback boolean; v_candidates integer;
  v_name text; v_code text; v_vtype uuid; v_sub uuid; v_model uuid; v_doc text; v_ext text; v_types jsonb;
  n_total int; n_valid int; n_warn int; n_err int; v_msg jsonb;
  -- operação/cidade da planilha e o estado do lote antes desta chamada
  v_ctx jsonb; v_fill boolean; v_dup_row integer; v_batch_status text := 'draft';
  v_cycle_ok boolean;  -- o MP da linha pode virar vínculo (há regra e o ciclo está nela)
begin
  if not private.has_permission(p_organization_id, 'maintenance.import') then
    raise exception 'Você não possui permissão para importar manutenção.' using errcode = 'insufficient_privilege';
  end if;
  if v_phase not in ('all', 'load', 'validate', 'finalize') then
    raise exception 'Etapa de importação inválida: %.', v_phase using errcode = 'invalid_parameter_value';
  end if;
  if v_kind not in ('records', 'clusters', 'services', 'suppliers', 'preventive_rules') then
    raise exception 'Tipo de importação inválido.' using errcode = 'invalid_parameter_value';
  end if;
  v_type := case when v_kind = 'records' then 'maintenance' else 'maintenance_catalog' end;

  v_batch := nullif(p_payload ->> 'batch_id', '')::uuid;
  if v_batch is null then
    if v_phase not in ('all', 'load') then
      raise exception 'Informe a importação em andamento.' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' or jsonb_array_length(p_payload -> 'rows') = 0 then
      raise exception 'A planilha não possui linhas de dados.' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.import_batches
      (organization_id, type, mode, status, file_name, file_hash, file_size, column_mapping, summary, created_by, updated_by)
    values
      (p_organization_id, v_type, 'create_update', 'draft', coalesce(nullif(p_payload ->> 'file_name', ''), 'manutencao'),
       nullif(p_payload ->> 'file_hash', ''), nullif(p_payload ->> 'file_size', '')::bigint,
       coalesce(p_payload -> 'column_mapping', '{}'::jsonb), jsonb_build_object('kind', v_kind), auth.uid(), auth.uid())
    returning id into v_batch;
  else
    -- A base é a do lote: as partes de validação e a prévia não mandam "kind".
    select b.summary ->> 'kind', b.type, b.status into v_kind, v_type, v_batch_status from public.import_batches b
     where b.id = v_batch and b.organization_id = p_organization_id
       and b.type in ('maintenance', 'maintenance_catalog')
       and b.created_by = auth.uid()
       and (b.status = 'draft' or (v_phase = 'finalize' and b.status = 'validated'))
       for update;
    if v_kind is null then
      raise exception 'Esta importação não está mais aberta. Envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if v_phase in ('all', 'load') and jsonb_typeof(p_payload -> 'rows') = 'array' then
    if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status <> 'pending') then
      raise exception 'A validação desta importação já começou; envie a planilha novamente.' using errcode = 'invalid_parameter_value';
    end if;
    select count(*)::integer into v_loaded from public.import_rows x where x.batch_id = v_batch;
    insert into public.import_rows (organization_id, batch_id, row_number, raw_data, normalized_data, status, action)
    select p_organization_id, v_batch,
           coalesce(nullif(e.value ->> 'row_number', '')::integer, v_loaded + e.ord::integer + 1),
           coalesce(e.value -> 'raw', '{}'::jsonb), e.value - 'raw', 'pending', 'skip'
      from jsonb_array_elements(p_payload -> 'rows') with ordinality as e(value, ord)
    on conflict (batch_id, row_number) do nothing;
  end if;
  if v_phase = 'load' then
    return jsonb_build_object('batch_id', v_batch, 'loaded', (select count(*) from public.import_rows x where x.batch_id = v_batch));
  end if;

  if v_phase in ('all', 'validate') then
    for v_pend in
      select x.id, x.row_number, x.normalized_data from public.import_rows x
       where x.batch_id = v_batch and x.status = 'pending'
       order by x.row_number
       limit greatest(coalesce(v_limit, 2147483647), 1)
    loop
      r := v_pend.normalized_data;
      v_level := 'valid'; v_action := 'create'; v_msgs := '[]'::jsonb; v_norm := '{}'::jsonb; v_dup := false;

      if v_kind = 'records' then
        -- Veículo: pela frota, depois pela placa. Nunca cria.
        v_vehicle := null;
        select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
         where v.organization_id = p_organization_id and nullif(btrim(r ->> 'fleet_code'), '') is not null
           and upper(btrim(v.fleet_code)) = upper(btrim(r ->> 'fleet_code'))
         order by v.deleted_at nulls first limit 1;
        if v_vehicle.id is null and nullif(btrim(r ->> 'license_plate'), '') is not null then
          select v.id, v.vehicle_type_id, v.status, v.deleted_at into v_vehicle from public.vehicles v
           where v.organization_id = p_organization_id
             and private.normalize_plate(v.license_plate) = private.normalize_plate(r ->> 'license_plate')
           order by v.deleted_at nulls first limit 1;
        end if;
        if v_vehicle.id is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'license_plate', 'code', 'unknown_vehicle',
                    'message', 'Veículo não encontrado pela frota nem pela placa. A importação não cria veículos.');
        end if;

        -- Tipo (equivalência exata; Avaria tem fluxo próprio).
        v_raw := private.maintenance_norm(r ->> 'maintenance_type');
        v_type_code := case v_raw
                         when 'preventiva' then 'preventive' when 'preventive' then 'preventive'
                         when 'corretiva' then 'corrective' when 'corrective' then 'corrective'
                         when 'preditiva' then 'predictive' when 'predictive' then 'predictive'
                         when 'socorro em rota' then 'corrective' when 'entrega tecnica' then 'corrective'
                       end;
        v_origin_code := case v_raw when 'socorro em rota' then 'roadside_assistance' when 'entrega tecnica' then 'technical_delivery' end;
        if v_raw = 'avaria' then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'damage_flow',
                    'message', 'Avarias têm fluxo próprio (Sinistros e Avarias) e não entram na base de manutenção.');
        elsif v_type_code is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'maintenance_type', 'code', 'unknown_type',
                    'message', format('Tipo de manutenção "%s" não reconhecido (use Preventiva, Corretiva ou Preditiva).', coalesce(r ->> 'maintenance_type', '')));
        elsif v_origin_code is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'maintenance_type', 'code', 'type_mapped',
                    'message', format('"%s" é origem no HFM: importado como Corretiva com essa origem.', r ->> 'maintenance_type'));
        end if;

        -- Situação (equivalência exata).
        v_raw := private.maintenance_norm(r ->> 'status');
        v_status := case v_raw
                      when 'ha agendar' then 'to_schedule' when 'a agendar' then 'to_schedule' when 'aguardando agendamento' then 'to_schedule'
                      when 'agendado' then 'scheduled' when 'agendada' then 'scheduled' when 'reprogramado' then 'scheduled'
                      when 'em execucao' then 'in_progress' when 'em andamento' then 'in_progress'
                      when 'concluido' then 'completed' when 'concluida' then 'completed' when 'realizada' then 'completed' when 'realizado' then 'completed'
                      when 'cancelado' then 'cancelled' when 'cancelada' then 'cancelled'
                      when 'nao realizada' then 'not_performed' when 'nao realizado' then 'not_performed'
                    end;
        if v_raw is null then
          v_status := 'to_schedule';
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'status_default',
                    'message', 'Situação vazia: importada como Há agendar.');
        elsif v_status is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'status', 'code', 'unknown_status',
                    'message', format('Situação "%s" não reconhecida.', r ->> 'status'));
        end if;

        -- Origem.
        if v_origin_code is null then
          v_raw := private.maintenance_norm(r ->> 'origin');
          if v_raw is null then
            v_origin_code := 'import';
          else
            select o.code into v_origin_code from public.maintenance_origins o
             where (o.organization_id is null or o.organization_id = p_organization_id) and o.is_active
               and (private.maintenance_norm(o.name) = v_raw or o.code = v_raw
                    or (v_raw = 'plano de acao checklist' and o.code = 'action_plan')
                    or (v_raw in ('relato motorista', 'relato de motorista') and o.code = 'driver_report')
                    or (v_raw = 'preventiva programada' and o.code = 'preventive_schedule'))
             order by o.organization_id nulls last limit 1;
            if v_origin_code is null then
              v_origin_code := 'not_informed';
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'origin', 'code', 'unknown_origin',
                        'message', format('Origem "%s" não está no catálogo: importada como Não informado.', r ->> 'origin'));
            end if;
          end if;
        end if;

        -- Serviço: nome ou outro nome; o cluster desempata, e o cadastro vale
        -- quando o cluster da linha diverge e o nome é único.
        v_service := null; v_cluster := null; v_mismatch := false;
        if nullif(btrim(r ->> 'service'), '') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'missing_service',
                    'message', 'Serviço ausente.');
        else
          select m.o_service_id, m.o_cluster_id, m.o_cluster_mismatch into v_service, v_cluster, v_mismatch
            from private.maintenance_match_service(p_organization_id, r ->> 'service', r ->> 'cluster') m;
          if v_service is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                      'message', format('Serviço "%s"%s não está no catálogo (nem entre os outros nomes dos serviços). Cadastre-o ou informe o nome antigo no serviço equivalente.',
                                        r ->> 'service', coalesce(' (cluster ' || nullif(btrim(r ->> 'cluster'), '') || ')', '')));
          elsif v_mismatch then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'cluster', 'code', 'cluster_mismatch',
                      'message', format('Serviço "%s" está no cluster %s do cadastro; a linha informava "%s". Vale o cadastro.',
                                        r ->> 'service', (select c.name from public.maintenance_clusters c where c.id = v_cluster), r ->> 'cluster'));
          end if;
        end if;

        -- Fornecedor: não reconhecido não bloqueia; o nome informado fica guardado.
        v_informed := nullif(btrim(r ->> 'supplier'), '');
        v_supplier := case when v_informed is null then null else private.maintenance_match_supplier(p_organization_id, v_informed) end;
        if v_informed is not null and v_supplier is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'supplier', 'code', 'unknown_supplier',
                    'message', format('Fornecedor "%s" não reconhecido no catálogo (nome, nome fantasia, outros nomes ou CNPJ): a manutenção entra sem vínculo e guarda o nome informado.', v_informed));
        end if;

        -- Datas. Entrada e saída reais só contam quando a situação é de fato.
        v_req := private.maintenance_import_date(r ->> 'requested_on');
        v_sched := private.maintenance_import_date(r ->> 'scheduled_date');
        v_entry := private.maintenance_import_date(r ->> 'entry_date');
        v_exit := private.maintenance_import_date(r ->> 'exit_date');
        v_expected := private.maintenance_import_date(r ->> 'expected_exit_date');
        if nullif(btrim(r ->> 'requested_on'), '') is not null and v_req is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'requested_on', 'code', 'invalid_date',
                    'message', format('Data de solicitação "%s" inválida: ignorada.', r ->> 'requested_on'));
        end if;
        if nullif(btrim(r ->> 'scheduled_date'), '') is not null and v_sched is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status = 'scheduled' then 'error' else 'warning' end,
                    'field', 'scheduled_date', 'code', 'invalid_date',
                    'message', format('Data agendada "%s" inválida%s.', r ->> 'scheduled_date', case when v_status = 'scheduled' then '' else ': ignorada' end));
        end if;
        if nullif(btrim(r ->> 'expected_exit_date'), '') is not null and v_expected is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'expected_exit_date', 'code', 'invalid_date',
                    'message', format('Previsão de saída "%s" inválida: ignorada.', r ->> 'expected_exit_date'));
        end if;
        if nullif(btrim(r ->> 'entry_date'), '') is not null and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status in ('in_progress', 'completed') then 'error' else 'warning' end,
                    'field', 'entry_date', 'code', 'invalid_date', 'message', format('Data de entrada "%s" inválida.', r ->> 'entry_date'));
        end if;
        if nullif(btrim(r ->> 'exit_date'), '') is not null and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', case when v_status = 'completed' then 'error' else 'warning' end,
                    'field', 'exit_date', 'code', 'invalid_date', 'message', format('Data de saída "%s" inválida.', r ->> 'exit_date'));
        end if;
        v_ref := coalesce(v_entry, v_sched, v_req);
        v_req := coalesce(v_req, least(coalesce(v_entry, v_sched), v_today), v_today);
        if v_status = 'scheduled' and v_sched is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'scheduled_date', 'code', 'missing_scheduled',
                    'message', 'Agendado exige a data agendada.');
        end if;
        if v_status in ('in_progress', 'completed') and v_entry is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'missing_entry',
                    'message', 'Em execução ou concluído exige a data de entrada real.');
        end if;
        if v_status = 'completed' and v_exit is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'missing_exit',
                    'message', 'Concluído exige a data de saída real.');
        end if;
        if v_status = 'completed' and v_exit < v_entry then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'exit_date', 'code', 'exit_before_entry',
                    'message', format('Saída (%s) anterior à entrada (%s).', to_char(v_exit, 'DD/MM/YYYY'), to_char(v_entry, 'DD/MM/YYYY')));
        end if;
        if v_status in ('in_progress', 'completed') and (v_entry > v_today or (v_status = 'completed' and v_exit > v_today)) then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'entry_date', 'code', 'future_fact',
                    'message', 'Entrada ou saída real no futuro.');
        end if;
        if v_status = 'in_progress' and v_exit is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'exit_date', 'code', 'exit_ignored',
                    'message', 'Em execução com data de saída: a saída foi ignorada.');
          v_exit := null;
        end if;
        if v_status not in ('in_progress', 'completed') then
          v_exit := null;
        end if;
        -- Saída no mesmo dia, mas antes da hora de entrada: os horários não
        -- servem; o tempo em oficina fica por data.
        v_times_ok := not (v_exit is not null and v_exit = v_entry
                           and private.maintenance_import_time(r ->> 'exit_time') < private.maintenance_import_time(r ->> 'entry_time'));
        if not v_times_ok then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'exit_time', 'code', 'exit_time_before_entry',
                    'message', format('Saída às %s antes da entrada às %s no mesmo dia: horários ignorados (tempo em oficina por data).',
                                      to_char(private.maintenance_import_time(r ->> 'exit_time'), 'HH24:MI'),
                                      to_char(private.maintenance_import_time(r ->> 'entry_time'), 'HH24:MI')));
        end if;

        -- KM: número como a planilha escreve (148398.88 → 148398).
        v_km_num := private.maintenance_import_number(r ->> 'entry_km');
        v_km := null;
        if nullif(btrim(r ->> 'entry_km'), '') is not null and v_km_num is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'entry_km', 'code', 'invalid_km',
                    'message', format('KM de entrada "%s" não é um número: ignorado (o KM oficial será usado).', r ->> 'entry_km'));
        elsif v_km_num is not null and (v_km_num < 0 or v_km_num > 9999999) then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'entry_km', 'code', 'km_out_of_range',
                    'message', 'KM de entrada fora da faixa: ignorado (o KM oficial será usado).');
        elsif v_km_num is not null then
          v_km := trunc(v_km_num)::integer;
        end if;
        if v_expected is not null and v_sched is not null and v_expected < v_sched then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'expected_exit_date', 'code', 'expected_before_schedule',
                    'message', 'Previsão de saída anterior ao agendamento: ignorada.');
          v_expected := null;
        end if;
        v_cycle := nullif(substring(coalesce(r ->> 'preventive_cycle', '') from '(\d+)'), '')::integer;
        if v_type_code = 'preventive' and v_cycle is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'no_cycle',
                    'message', 'Preventiva sem ciclo (MP): importada sem vínculo com a matriz preventiva.');
        end if;
        -- O MP só vira vínculo se o veículo tiver regra preventiva e o ciclo
        -- existir nela; senão a linha entra, mas o aviso diz por que a matriz
        -- não muda.
        v_cycle_ok := false;
        if v_type_code = 'preventive' and v_cycle is not null and v_vehicle.id is not null then
          v_rule := null;
          select pr.id, pr.cycle_count into v_rule from public.maintenance_preventive_rules pr
           where pr.id = private.maintenance_preventive_rule_for(v_vehicle.id);
          v_cycle_ok := v_rule.id is not null and v_cycle <= v_rule.cycle_count;
          if v_rule.id is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'no_preventive_rule',
                      'message', format('MP%s informado, mas o veículo não tem regra preventiva (tipo, subcategoria ou modelo): a manutenção entra sem vínculo com a matriz.', v_cycle));
          elsif v_cycle > v_rule.cycle_count then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'preventive_cycle', 'code', 'cycle_out_of_plan',
                      'message', format('MP%s acima dos %s ciclos da regra preventiva do veículo: a manutenção entra sem vínculo com a matriz.', v_cycle, v_rule.cycle_count));
          end if;
        end if;

        -- Operação e cidade da planilha: nunca bloqueiam a linha. Não entram
        -- na chave — a mesma entrada com a operação corrigida continua sendo
        -- a mesma manutenção.
        v_ctx := private.maintenance_import_resolve_context(p_organization_id, r ->> 'operation', r ->> 'city');
        v_msgs := v_msgs || coalesce(v_ctx -> 'messages', '[]'::jsonb);

        -- A entrada em oficina (a manutenção) e o item. O fornecedor entra como
        -- foi escrito: dois fornecedores no mesmo dia são duas entradas, e a
        -- chave não muda quando o de-para do fornecedor muda.
        v_group := md5(concat_ws('|', v_vehicle.id, v_type_code, v_ref, upper(btrim(coalesce(r ->> 'service_order_number', ''))),
                                 coalesce(private.maintenance_norm(v_informed), '')));
        v_key := v_group || ':' || coalesce(v_service::text, '');

        v_other := null;
        v_dup_row := null;
        select x.row_number into v_other from public.import_rows x
         where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
           and x.normalized_data ->> 'item_key' = v_key
         order by x.row_number limit 1;
        if v_other.row_number is not null and v_service is not null then
          v_dup := true;
          v_dup_row := v_other.row_number;
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'service', 'code', 'duplicate_in_file',
                    'message', format('Serviço repetido na mesma manutenção (mesmo veículo, tipo, data, OS e fornecedor da linha %s): a linha não cria outro item.', v_other.row_number));
        end if;
        v_other := null;
        select x.row_number, x.normalized_data ->> 'status' as status into v_other from public.import_rows x
         where x.batch_id = v_batch and x.id <> v_pend.id and x.status in ('valid', 'warning')
           and x.normalized_data ->> 'group_key' = v_group and (x.normalized_data ->> 'status') is distinct from v_status
         order by x.row_number limit 1;
        if v_other.row_number is not null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'status', 'code', 'group_status_mixed',
                    'message', format('A linha %s da mesma manutenção tem outra situação: a manutenção fica na situação menos avançada e cada serviço com a sua.', v_other.row_number));
        end if;

        -- Já existe no HFM?
        v_existing := null;
        v_fallback := false;
        select m.id, m.code, m.status, m.supplier_id, m.supplier_name_informed, m.imported_at, m.updated_at,
               m.operation_id, m.operation_name_snapshot, m.city_name_snapshot, m.state_uf_snapshot,
               exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user') as touched,
               exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service) as has_item,
               (select i.status from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service
                 order by i.sort_order limit 1) as item_status,
               coalesce(m.preventive_cycle_declared, (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id)) as cycle_number
          into v_existing
          from public.maintenances m
         where m.organization_id = p_organization_id and m.import_key = v_group;
        -- A mesma entrada com o fornecedor escrito de outro jeito (a planilha
        -- corrigiu o nome): a chave muda, mas a OS identifica. Só com um único
        -- candidato importado do mesmo veículo, tipo e data — senão é outra
        -- entrada e nasce como nova.
        if v_existing.id is null and v_vehicle.id is not null and v_ref is not null
           and nullif(btrim(r ->> 'service_order_number'), '') is not null then
          select count(*) into v_candidates
            from public.maintenances m
           where m.organization_id = p_organization_id and m.import_key is not null and m.import_key <> v_group
             and m.status <> 'cancelled' and m.vehicle_id = v_vehicle.id and m.maintenance_type_code = v_type_code
             and m.context_date = v_ref
             and upper(btrim(coalesce(m.service_order_number, ''))) = upper(btrim(r ->> 'service_order_number'));
          if v_candidates = 1 then
            select m.id, m.code, m.status, m.supplier_id, m.supplier_name_informed, m.imported_at, m.updated_at,
               m.operation_id, m.operation_name_snapshot, m.city_name_snapshot, m.state_uf_snapshot,
               exists (select 1 from public.maintenance_events e where e.maintenance_id = m.id and e.source = 'user') as touched,
               exists (select 1 from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service) as has_item,
               (select i.status from public.maintenance_items i where i.maintenance_id = m.id and i.service_id = v_service
                 order by i.sort_order limit 1) as item_status,
               coalesce(m.preventive_cycle_declared, (select c.cycle_number from public.maintenance_preventive_cycles c where c.id = m.preventive_cycle_id)) as cycle_number
              into v_existing
              from public.maintenances m
             where m.organization_id = p_organization_id and m.import_key is not null and m.import_key <> v_group
               and m.status <> 'cancelled' and m.vehicle_id = v_vehicle.id and m.maintenance_type_code = v_type_code
               and m.context_date = v_ref
               and upper(btrim(coalesce(m.service_order_number, ''))) = upper(btrim(r ->> 'service_order_number'));
            v_fallback := true;
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'supplier', 'code', 'matched_by_os',
                      'message', format('Mesma entrada de %s (veículo, tipo, data e OS %s): o fornecedor foi escrito de outro jeito e a manutenção é atualizada, não duplicada.',
                                        v_existing.code, r ->> 'service_order_number'));
          end if;
        end if;

        v_norm := jsonb_build_object(
          'vehicle_id', v_vehicle.id, 'type', v_type_code, 'origin_code', v_origin_code, 'status', v_status,
          'service_id', v_service, 'cluster_id', v_cluster, 'supplier_id', v_supplier,
          'supplier_name_informed', case when v_supplier is null then v_informed end,
          'requested_on', v_req, 'scheduled_date', v_sched, 'scheduled_time', private.maintenance_import_time(r ->> 'scheduled_time'),
          'expected_exit_date', v_expected, 'entry_date', v_entry,
          'entry_time', case when v_times_ok then private.maintenance_import_time(r ->> 'entry_time') end,
          'exit_date', v_exit, 'exit_time', case when v_exit is not null and v_times_ok then private.maintenance_import_time(r ->> 'exit_time') end,
          'entry_km', v_km, 'preventive_cycle', v_cycle,
          'service_order_number', nullif(btrim(r ->> 'service_order_number'), ''),
          'priority', coalesce(private.maintenance_import_criticality(r ->> 'priority'), 'medium'),
          'description', nullif(btrim(r ->> 'description'), ''), 'notes', nullif(btrim(r ->> 'notes'), ''),
          'group_key', v_group, 'item_key', v_key,
          'license_plate', r ->> 'license_plate', 'fleet_code', r ->> 'fleet_code', 'service', r ->> 'service', 'supplier', v_informed,
          -- Só os ids (nomes por private.maintenance_import_context_of): a
          -- linha precisa caber sem compressão.
          'operation_id', v_ctx ->> 'operation_id', 'city_id', (v_ctx ->> 'city_id')::integer);
        if v_dup then
          -- A prévia pode reconhecer a linha repetida como outra manutenção
          -- aberta (a OS sumiu): ver private.maintenance_import_reidentify.
          v_norm := v_norm || jsonb_build_object('dup_of', v_dup_row);
        end if;

        -- Manutenção existente sem operação recebe a da planilha; com outra
        -- operação, o HFM é mantido (aviso), nunca sobrescrito.
        v_fill := v_existing.id is not null and v_existing.operation_id is null and (v_ctx ->> 'operation_id') is not null;
        if v_existing.id is not null and not v_dup and v_existing.operation_id is not null and (v_ctx ->> 'operation_id') is not null
           and v_existing.operation_id <> (v_ctx ->> 'operation_id')::uuid then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'operation', 'code', 'context_divergent',
                    'message', format('Contexto divergente: mantido o do HFM (%s); planilha: %s.',
                                      concat_ws(' — ', v_existing.operation_name_snapshot,
                                                v_existing.city_name_snapshot || coalesce('/' || v_existing.state_uf_snapshot, '')),
                                      concat_ws(' — ', v_ctx ->> 'operation_name',
                                                (v_ctx ->> 'city_name') || coalesce('/' || (v_ctx ->> 'state_uf'), ''))));
        end if;

        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif v_dup then
          v_level := 'warning'; v_action := 'skip';
        elsif v_existing.id is not null then
          if v_existing.touched and v_fill then
            -- Alterada por usuário: nada do arquivo sobrescreve; só o contexto,
            -- que estava vazio, é preenchido.
            v_level := 'warning'; v_action := 'update';
            v_norm := v_norm || jsonb_build_object('context_only', true, 'context_fill', true);
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'conflict',
                      'message', format('%s já foi alterada no HFM depois da importação; o arquivo não sobrescreve (conflito) — só a operação e a cidade, que estavam vazias, são preenchidas.', v_existing.code));
          elsif v_existing.touched then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'conflict',
                      'message', format('%s já foi alterada no HFM depois da importação; o arquivo não sobrescreve (conflito).', v_existing.code));
          elsif v_existing.has_item
                and (v_existing.status = v_status or (v_status = 'completed' and v_existing.item_status = 'done'))
                and v_existing.supplier_id is not distinct from v_supplier
                and (v_supplier is not null or v_existing.supplier_name_informed is not distinct from v_informed)
                -- MP que não pode virar vínculo (sem regra, além da regra) não
                -- é mudança: reimportar não acusaria "atualizar" para sempre.
                and (v_type_code <> 'preventive' or v_cycle is null or not v_cycle_ok
                     or v_existing.cycle_number is not distinct from v_cycle)
                and not v_fallback and not v_fill then
            v_level := 'warning'; v_action := 'skip';
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', null, 'code', 'unchanged',
                      'message', format('%s já importada, sem mudança.', v_existing.code));
          else
            v_action := 'update';
            if v_fill then
              v_norm := v_norm || jsonb_build_object('context_fill', true);
            end if;
          end if;
          v_norm := v_norm || jsonb_build_object('existing_id', v_existing.id, 'existing_code', v_existing.code,
                                                 'existing_cycle', v_existing.cycle_number, 'matched_by_os', v_fallback);
        elsif exists (select 1 from public.import_rows x
                       where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                         and x.normalized_data ->> 'group_key' = v_group and x.action = 'create') then
          v_action := 'update';  -- mais um serviço da mesma manutenção deste arquivo
        end if;
        if v_level = 'valid' and exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;

      elsif v_kind = 'clusters' then
        v_name := nullif(btrim(r ->> 'name'), '');
        v_code := upper(coalesce(nullif(btrim(r ->> 'code'), ''), private.maintenance_code_from_name(v_name)));
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do cluster ausente.');
        end if;
        v_cluster := null;
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (c.code = v_code or private.maintenance_norm(c.name) = private.maintenance_norm(v_name))
         order by (private.maintenance_norm(c.name) = private.maintenance_norm(v_name)) desc limit 1;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_action := case when v_cluster is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_cluster, 'name', v_name, 'code', v_code, 'description', nullif(btrim(r ->> 'description'), ''),
                                     'default_criticality', private.maintenance_import_criticality(r ->> 'criticality'),
                                     'status', private.maintenance_import_active(r ->> 'status'),
                                     'item_key', 'cluster:' || coalesce(v_cluster::text, v_code));

      elsif v_kind = 'services' then
        v_name := nullif(btrim(r ->> 'name'), '');
        v_cluster := null; v_service := null;
        select c.id into v_cluster from public.maintenance_clusters c
         where c.organization_id = p_organization_id and c.deleted_at is null
           and (private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'cluster') or c.code = upper(btrim(coalesce(r ->> 'cluster', ''))))
         limit 1;
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do serviço ausente.');
        end if;
        if v_cluster is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'cluster', 'code', 'unknown_cluster',
                    'message', format('Cluster "%s" não existe. Todo serviço pertence a um cluster; importe os clusters antes.', coalesce(r ->> 'cluster', '')));
        end if;
        select s.id into v_service from public.maintenance_services s
         where s.organization_id = p_organization_id and s.deleted_at is null and s.cluster_id = v_cluster
           and private.maintenance_norm(s.name) = private.maintenance_norm(v_name) limit 1;
        -- Tipos: "Não se aplica" (ou "Nenhum") é lista vazia; coluna ausente mantém o que há.
        v_types := null;
        if nullif(btrim(r ->> 'maintenance_types'), '') is not null then
          select coalesce(jsonb_agg(distinct q.t) filter (where q.t is not null), '[]'::jsonb) into v_types from (
            select case private.maintenance_norm(x) when 'preventiva' then 'preventive' when 'corretiva' then 'corrective'
                                                    when 'preditiva' then 'predictive' end as t
              from regexp_split_to_table(r ->> 'maintenance_types', '[;,|/]') x) q;
          if exists (select 1 from regexp_split_to_table(r ->> 'maintenance_types', '[;,|/]') x
                      where private.maintenance_norm(x) is not null
                        and private.maintenance_norm(x) not in ('preventiva', 'corretiva', 'preditiva', 'nao se aplica', 'nenhum', 'todos')) then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'maintenance_types', 'code', 'unknown_type',
                      'message', format('Tipo(s) "%s": só Preventiva, Corretiva e Preditiva são reconhecidos; os demais foram ignorados.', r ->> 'maintenance_types'));
          end if;
        end if;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_action := case when v_service is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_service, 'cluster_id', v_cluster, 'name', v_name,
                    'criticality', private.maintenance_import_criticality(r ->> 'criticality'),
                    'expected_hours', private.maintenance_import_number(r ->> 'expected_hours'),
                    'is_predictive', case when nullif(btrim(r ->> 'is_predictive'), '') is not null
                                            then private.maintenance_norm(r ->> 'is_predictive') in ('sim', 's', 'true', '1', 'x', 'yes')
                                          when v_types is not null then v_types ? 'predictive' end,
                    'maintenance_type_codes', v_types,
                    'status', private.maintenance_import_active(r ->> 'status'),
                    'alias_names', case when nullif(btrim(r ->> 'alias_names'), '') is not null
                                        then to_jsonb(private.maintenance_clean_names(to_jsonb(r ->> 'alias_names'))) end,
                    'item_key', 'service:' || coalesce(v_cluster::text, '') || ':' || coalesce(private.maintenance_norm(v_name), ''));

      elsif v_kind = 'suppliers' then
        v_name := nullif(btrim(r ->> 'name'), '');
        if v_name is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'name', 'code', 'missing_name', 'message', 'Nome do fornecedor ausente.');
        end if;
        -- Quem é o fornecedor: pelo nome. CNPJ, código externo e nome fantasia
        -- não renomeiam ninguém — há filiais e cadastros diferentes com o
        -- mesmo CNPJ na base de origem.
        v_supplier := null;
        select s.id into v_supplier from public.maintenance_suppliers s
         where s.organization_id = p_organization_id and s.deleted_at is null
           and private.maintenance_norm(s.name) = private.maintenance_norm(v_name)
         limit 1;
        v_raw := private.maintenance_import_text(r ->> 'document_number');
        v_doc := nullif(regexp_replace(coalesce(v_raw, ''), '[^0-9]', '', 'g'), '');
        if v_raw is not null and (v_doc is null or length(v_doc) not in (11, 14)) then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'invalid_document',
                    'message', format('CNPJ/CPF "%s" inválido: fornecedor importado sem documento.', v_raw));
          v_doc := null;
        end if;
        if v_doc is not null then
          v_other := null;
          select s.name into v_other from public.maintenance_suppliers s
           where s.organization_id = p_organization_id and s.deleted_at is null and s.document_number = v_doc
             and s.id is distinct from v_supplier limit 1;
          if v_other.name is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'duplicate_document',
                      'message', format('CNPJ/CPF %s já pertence a "%s": este fornecedor entra sem documento.', v_raw, v_other.name));
            v_doc := null;
          else
            v_other := null;
            select x.row_number, x.normalized_data ->> 'name' as name into v_other from public.import_rows x
             where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
               and x.normalized_data ->> 'document_number' = v_doc
             order by x.row_number limit 1;
            if v_other.row_number is not null then
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'document_number', 'code', 'duplicate_document',
                        'message', format('CNPJ/CPF %s repetido no arquivo (linha %s, "%s"): este fornecedor entra sem documento.', v_raw, v_other.row_number, v_other.name));
              v_doc := null;
            end if;
          end if;
        end if;
        v_ext := regexp_replace(coalesce(private.maintenance_import_text(r ->> 'external_code'), ''), '\.0+$', '');
        v_ext := nullif(v_ext, '');
        if v_ext is not null then
          v_other := null;
          select x.row_number into v_other from public.import_rows x
           where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
             and x.normalized_data ->> 'external_code' = v_ext
           order by x.row_number limit 1;
          if v_other.row_number is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'external_code', 'code', 'duplicate_external_code',
                      'message', format('Código %s repetido no arquivo (linha %s): mantido nos dois.', v_ext, v_other.row_number));
          end if;
        end if;
        v_action := case when v_supplier is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object('id', v_supplier, 'name', v_name,
                    'trade_name', private.maintenance_import_text(r ->> 'trade_name'),
                    'document_number', v_doc,
                    'external_code', v_ext,
                    'category', private.maintenance_import_text(r ->> 'category'),
                    'service_type', private.maintenance_import_text(r ->> 'service_type'),
                    'payment_terms', private.maintenance_import_text(r ->> 'payment_terms'),
                    'financial_validation', private.maintenance_import_text(r ->> 'financial_validation'),
                    'address', private.maintenance_import_text(r ->> 'address'),
                    'status', private.maintenance_import_active(r ->> 'status'),
                    'city_id', (select c.id from public.cities c join public.states s on s.id = c.state_id
                                 where private.maintenance_norm(c.name) = private.maintenance_norm(r ->> 'city')
                                   and (nullif(btrim(r ->> 'state'), '') is null or upper(s.uf) = upper(btrim(r ->> 'state')))
                                 order by c.is_municipality desc limit 1),
                    'cluster_ids', case when nullif(btrim(r ->> 'clusters'), '') is not null then
                                     (select coalesce(jsonb_agg(distinct c.id), '[]'::jsonb)
                                        from regexp_split_to_table(r ->> 'clusters', '[;,|/]') x
                                        join public.maintenance_clusters c on c.organization_id = p_organization_id and c.deleted_at is null
                                         and private.maintenance_norm(c.name) = private.maintenance_norm(x)) end,
                    'alias_names', case when nullif(btrim(r ->> 'alias_names'), '') is not null
                                        then to_jsonb(private.maintenance_clean_names(to_jsonb(r ->> 'alias_names'))) end,
                    'item_key', 'supplier:' || coalesce(private.maintenance_norm(v_name), ''));
        if nullif(btrim(r ->> 'city'), '') is not null and v_norm ->> 'city_id' is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'city', 'code', 'unknown_city',
                    'message', format('Cidade "%s" não encontrada: fornecedor importado sem cidade.', r ->> 'city'));
        end if;

      else  -- preventive_rules
        -- Tipo de equipamento; a planilha pode trazer a subcategoria no lugar
        -- do tipo ("Toco", "Truck") e no lugar do modelo ("10,5 m³").
        v_vtype := null; v_sub := null; v_model := null;
        v_raw := private.maintenance_import_text(r ->> 'vehicle_type');
        select t.id into v_vtype from public.vehicle_types t
         where (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null
           and (private.maintenance_norm(t.name) = private.maintenance_norm(v_raw) or lower(t.code) = lower(coalesce(v_raw, '')))
         order by t.organization_id nulls last limit 1;
        if v_vtype is null and v_raw is not null then
          select s.id, s.vehicle_type_id into v_sub, v_vtype
            from public.vehicle_subcategories s join public.vehicle_types t on t.id = s.vehicle_type_id
           where (t.organization_id is null or t.organization_id = p_organization_id) and t.deleted_at is null
             and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw)
             and (select count(*) from public.vehicle_subcategories s2 join public.vehicle_types t2 on t2.id = s2.vehicle_type_id
                   where (t2.organization_id is null or t2.organization_id = p_organization_id) and t2.deleted_at is null
                     and s2.deleted_at is null and private.maintenance_norm(s2.name) = private.maintenance_norm(v_raw)) = 1;
          if v_sub is not null then
            v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'vehicle_type', 'code', 'type_from_subcategory',
                      'message', format('"%s" é subcategoria de %s: o parâmetro vale para essa subcategoria.',
                                        v_raw, (select t.name from public.vehicle_types t where t.id = v_vtype)));
          end if;
        end if;
        if v_vtype is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'vehicle_type', 'code', 'unknown_vehicle_type',
                    'message', format('Tipo de equipamento "%s" não existe.', coalesce(r ->> 'vehicle_type', '')));
        end if;
        v_raw := private.maintenance_import_text(r ->> 'subcategory');
        if v_raw is not null then
          v_code := null;
          select s.id::text into v_code from public.vehicle_subcategories s
           where s.vehicle_type_id = v_vtype and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw) limit 1;
          if v_code is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'subcategory', 'code', 'unknown_subcategory',
                      'message', format('Subcategoria "%s" não existe neste tipo.', v_raw));
          elsif v_sub is not null and v_sub <> v_code::uuid then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'subcategory', 'code', 'subcategory_conflict',
                      'message', format('Subcategoria "%s" diverge da informada no tipo.', v_raw));
          else
            v_sub := v_code::uuid;
          end if;
        end if;
        v_raw := private.maintenance_import_text(r ->> 'model');
        if v_raw is not null then
          select m.id into v_model from public.vehicle_models m
           where (m.organization_id = p_organization_id or m.organization_id is null)
             and private.maintenance_norm(m.name) = private.maintenance_norm(v_raw) limit 1;
          if v_model is null and v_sub is null then
            select s.id into v_sub from public.vehicle_subcategories s
             where s.vehicle_type_id = v_vtype and s.deleted_at is null and private.maintenance_norm(s.name) = private.maintenance_norm(v_raw) limit 1;
            if v_sub is not null then
              v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'model', 'code', 'model_is_subcategory',
                        'message', format('"%s" é subcategoria, não modelo: o parâmetro vale para essa subcategoria.', v_raw));
            end if;
          end if;
          if v_model is null and v_sub is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'model', 'code', 'unknown_model',
                      'message', format('Modelo "%s" não existe.', v_raw));
          end if;
        end if;
        v_service := null;
        if private.maintenance_import_text(r ->> 'service') is not null then
          select m.o_service_id into v_service from private.maintenance_match_service(p_organization_id, r ->> 'service', null) m;
          if v_service is null then
            v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'service', 'code', 'unknown_service',
                      'message', format('Serviço "%s" não está no catálogo.', r ->> 'service'));
          end if;
        end if;
        if coalesce(private.maintenance_import_number(r ->> 'interval_km'), 0) < 100 then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', 'interval_km', 'code', 'invalid_interval',
                    'message', 'Intervalo de KM ausente ou menor que 100.');
        end if;
        if nullif(btrim(r ->> 'criticality'), '') is not null and private.maintenance_import_criticality(r ->> 'criticality') is null then
          v_msgs := v_msgs || jsonb_build_object('level', 'warning', 'field', 'criticality', 'code', 'unknown_criticality',
                    'message', format('Criticidade "%s" não reconhecida (Baixa, Média, Alta, Crítica): mantida a padrão.', r ->> 'criticality'));
        end if;
        v_cluster := (select pr.id from public.maintenance_preventive_rules pr
                       where pr.organization_id = p_organization_id and pr.deleted_at is null and pr.vehicle_type_id = v_vtype
                         and pr.vehicle_subcategory_id is not distinct from v_sub and pr.vehicle_model_id is not distinct from v_model);
        v_action := case when v_cluster is not null then 'update' else 'create' end;
        v_norm := jsonb_build_object(
          'id', v_cluster, 'vehicle_type_id', v_vtype, 'vehicle_subcategory_id', v_sub, 'vehicle_model_id', v_model, 'service_id', v_service,
          'interval_km', trunc(private.maintenance_import_number(r ->> 'interval_km')),
          'initial_km', trunc(private.maintenance_import_number(r ->> 'initial_km')),
          'cycle_count', trunc(private.maintenance_import_number(r ->> 'cycle_count')),
          'alert_before_pct', private.maintenance_import_number(r ->> 'alert_before_pct'),
          'tolerance_after_pct', private.maintenance_import_number(r ->> 'tolerance_after_pct'),
          'criticality', private.maintenance_import_criticality(r ->> 'criticality'),
          'status', private.maintenance_import_active(r ->> 'status'),
          'item_key', 'rule:' || concat_ws(':', v_vtype, v_sub, v_model));
      end if;

      if v_kind <> 'records' then
        if exists (select 1 from public.import_rows x
                    where x.batch_id = v_batch and x.id <> v_pend.id and x.status <> 'pending'
                      and x.normalized_data ->> 'item_key' = v_norm ->> 'item_key') then
          v_msgs := v_msgs || jsonb_build_object('level', 'error', 'field', null, 'code', 'duplicate_in_file',
                    'message', 'Registro repetido no arquivo.');
        end if;
        if exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'error') then
          v_level := 'error'; v_action := 'skip';
        elsif exists (select 1 from jsonb_array_elements(v_msgs) m where m ->> 'level' = 'warning') then
          v_level := 'warning';
        end if;
      end if;

      update public.import_rows
         set normalized_data = v_norm, status = v_level, action = v_action,
             vehicle_id = case when v_kind = 'records' then (v_norm ->> 'vehicle_id')::uuid end
       where id = v_pend.id;
      for v_msg in select * from jsonb_array_elements(v_msgs) loop
        insert into public.import_errors (organization_id, batch_id, row_number, level, field, code, message)
        values (p_organization_id, v_batch, v_pend.row_number, v_msg ->> 'level', v_msg ->> 'field', v_msg ->> 'code', v_msg ->> 'message');
      end loop;
    end loop;
    if v_phase = 'validate' then
      return jsonb_build_object('batch_id', v_batch,
        'pending', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.status = 'pending'));
    end if;
  end if;

  if exists (select 1 from public.import_rows x where x.batch_id = v_batch and x.status = 'pending') then
    raise exception 'Ainda há linhas desta importação por validar.' using errcode = 'invalid_parameter_value';
  end if;
  -- Com todas as linhas validadas: manutenção aberta que mudou de OS ou de
  -- data. Só na primeira prévia do lote (rever a prévia não repete avisos).
  if v_kind = 'records' and v_batch_status = 'draft' then
    perform private.maintenance_import_reidentify(p_organization_id, v_batch);
  end if;
  select count(*)::integer, count(*) filter (where x.status = 'valid')::integer,
         count(*) filter (where x.status = 'warning')::integer, count(*) filter (where x.status = 'error')::integer
    into n_total, n_valid, n_warn, n_err
    from public.import_rows x where x.batch_id = v_batch;

  update public.import_batches
     set status = 'validated', total_rows = n_total, valid_rows = n_valid, warning_rows = n_warn, error_rows = n_err,
         created_rows = 0, updated_rows = 0, skipped_rows = 0,
         summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object(
           'create_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'create'),
           'update_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'update'),
           'unchanged_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'unchanged'),
           'conflict_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'conflict'),
           'duplicate_rows', (select count(*) from public.import_errors e where e.batch_id = v_batch and e.code = 'duplicate_in_file'),
           'maintenances', (select count(distinct x.normalized_data ->> 'group_key') from public.import_rows x
                             where x.batch_id = v_batch and x.action in ('create', 'update')),
           'context_fill_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch and x.action = 'update'
                                    and coalesce((x.normalized_data ->> 'context_fill')::boolean, false)),
           'reidentified_rows', (select count(*) from public.import_rows x where x.batch_id = v_batch
                                    and coalesce((x.normalized_data ->> 'reidentified')::boolean, false)),
           'unknown_suppliers', (select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'rows', q.n) order by q.n desc, q.name), '[]'::jsonb)
                                   from (select x.normalized_data ->> 'supplier_name_informed' as name, count(*) as n
                                           from public.import_rows x
                                          where x.batch_id = v_batch and x.normalized_data ->> 'supplier_name_informed' is not null
                                          group by 1 order by 2 desc, 1 limit 100) q),
           'already_imported', exists (select 1 from public.import_batches b
                                        where b.organization_id = p_organization_id and b.type = v_type and b.status = 'completed'
                                          and b.file_hash is not null
                                          and b.file_hash = (select me.file_hash from public.import_batches me where me.id = v_batch))),
         updated_at = now(), updated_by = auth.uid()
   where id = v_batch;

  return (
    select jsonb_build_object(
      'batch_id', v_batch, 'kind', v_kind, 'total_rows', n_total, 'valid_rows', n_valid, 'warning_rows', n_warn, 'error_rows', n_err,
      'summary', b.summary,
      'categories', (select coalesce(jsonb_object_agg(e.code, e.cnt), '{}'::jsonb)
                       from (select code, count(*) as cnt from public.import_errors where batch_id = v_batch group by code) e),
      'findings', coalesce((select jsonb_agg(jsonb_build_object('row_number', e.row_number, 'level', e.level, 'field', e.field,
                                                                'code', e.code, 'message', e.message) order by e.level, e.row_number)
                              from (select * from public.import_errors x where x.batch_id = v_batch
                                     order by (x.level = 'error') desc, x.row_number limit 300) e), '[]'::jsonb),
      'sample', coalesce((select jsonb_agg(jsonb_build_object('row_number', i.row_number, 'status', i.status, 'action', i.action,
                                                              'data', case when v_kind = 'records' and (i.normalized_data ? 'operation_id' or i.normalized_data ? 'city_id')
                                                                           then i.normalized_data || jsonb_build_object(
                                                                                  'operation_name', c.ctx ->> 'operation_name',
                                                                                  'city_label', (c.ctx ->> 'city_name') || coalesce('/' || (c.ctx ->> 'state_uf'), ''))
                                                                           else i.normalized_data end) order by i.row_number)
                            from (select * from public.import_rows x where x.batch_id = v_batch order by x.row_number limit 12) i
                            left join lateral (select private.maintenance_import_context_of((i.normalized_data ->> 'operation_id')::uuid,
                                                                                            (i.normalized_data ->> 'city_id')::integer) as ctx) c
                              on v_kind = 'records'), '[]'::jsonb))
      from public.import_batches b where b.id = v_batch);
end;
$$;
