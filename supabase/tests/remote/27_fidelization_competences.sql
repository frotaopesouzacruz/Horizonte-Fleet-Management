-- =============================================================================
-- 27 · Fidelização — competência mensal contínua (Frota × BR × Local)
--      migration 20261002106000_fidelization_competences
--
-- Suíte transacional: cria as próprias operações, coberturas, BRs, motorista,
-- liderança e vínculos (em 2031, meses sem dado real) usando veículos reais
-- livres. Tudo existe só dentro da transação: o bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO, e nada persiste.
-- Rodar o arquivo inteiro numa transação (psql -1 -f, ou um comando só no SQL
-- Editor). Os gatilhos diferidos são disparados com SET CONSTRAINTS ALL
-- IMMEDIATE depois de cada gravação — o mesmo efeito do COMMIT.
--
-- Origem 09/2031 → destino 10/2031 → seguinte 11/2031.
--   C1  Prévia manual: lê só o ÚLTIMO dia da origem (a placa que mudou de BR
--       em 15/09 vai com a BR de 15/09 em diante), novo/já existente/
--       conflito/ignorado, data de referência e placas encontradas; não grava
--   C2  Rotina automática (sem usuário: claims vazias): cria o cabeçalho
--       (Replicação automática), vínculos mensais NOVOS 01–31/10 confirmados,
--       motorista junto; setembro intacto
--   C3  Rotina de novo: não faz nada (o cabeçalho já existe)
--   C4  Origem por extenso: Replicação automática / manual / Alteração
--       manual / Importação histórica
--   C5  Replicação manual depois da automática: avisa que já foi criada,
--       complementa só a placa que falta; repetir = 0 novos; nenhuma placa ×
--       BR × competência duplicada; replicar não gera mobilização
--   C6  Substituição no meio de outubro → a replicação 10→11 usa a posição de
--       31/10; outubro intacto
--   C7  Lideranças intactas (hash da tabela antes e depois)
--   C8  Carga do histórico: 2024 sem BR (NULL de verdade, "-" e "BR 000" =
--       NULL), 2025 com BR resolvida e não resolvida (aviso), 2026 recusada,
--       placa desconhecida recusada, idempotente, prévia sem gravar
--   C9  Leituras do histórico: linhas com BR nula, filtros, evolução do ano
--   C10 Imutável e só consulta: posição não muda (UPDATE recusado) nem sai
--       (gatilho BEFORE DELETE conferido no catálogo — a suíte não roda
--       DELETE); cabeçalho não muda de origem nem sai; replicar de/para
--       competência histórica recusado
--   C11 Resumo: situação derivada (Planejada, Não criada, Em andamento,
--       Encerrada, Histórica), origem, contagens e mês anterior
--   C12 RLS/escopo: sem escopo não vê nada; com escopo vê só a sua operação
--   C13 Sem permissão: resumo e replicação recusados
-- =============================================================================

create or replace function pg_temp.s27_flush()
returns void
language plpgsql
as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_claims text;
  v_p date := date '2031-09-01';
  v_m date := date '2031-10-01';
  v_n date := date '2031-11-01';
  v_opa uuid; v_opb uuid; v_oca uuid; v_ocb uuid;
  br_a1 uuid; br_a2 uuid; br_a3 uuid; br_e uuid; br_f uuid; br_g uuid; br_h uuid; br_i uuid; br_b1 uuid;
  v_brs uuid[];
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid; v6 uuid; v7 uuid; v8 uuid; v9 uuid; v10 uuid;
  p1 text; p2 text; p3 text; p4 text; p5 text; p6 text;
  v_ids jsonb; v_emp uuid; v_leader uuid; v_x uuid;
  j jsonb; j2 jsonb; k jsonb; rows jsonb;
  hc public.fidelization_competences;
  n int; n2 int; n3 int; n4 int; mv0 int; mv1 int;
  h_sep1 text; h_sep2 text; h_oct1 text; h_oct2 text; l1 text; l2 text;
  ok boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean;
  txt text;
  r text := '';
begin
  -- ---------------------------------------------------------------- setup --
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' order by m.created_at limit 1;
  v_claims := json_build_object('sub', v_user, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  if not private.has_permission(v_org, 'fidelization.plan')
     or not private.has_permission(v_org, 'fidelization.manage_historical_data')
     or not private.has_permission(v_org, 'fidelization.import') then
    raise exception 'FIXTURE: o primeiro membro ativo precisa ser Administrador';
  end if;

  insert into public.operations (organization_id, name, code) values (v_org, 'Suite27 Operação A', 'S27-OPA') returning id into v_opa;
  insert into public.operations (organization_id, name, code) values (v_org, 'Suite27 Operação B', 'S27-OPB') returning id into v_opb;
  insert into public.operation_states (organization_id, operation_id, state_id) values (v_org, v_opa, 31), (v_org, v_opb, 31);
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id) values (v_org, v_opa, 31, 3118601) returning id into v_oca; -- Contagem
  insert into public.operation_cities (organization_id, operation_id, state_id, city_id) values (v_org, v_opb, 31, 3106705) returning id into v_ocb; -- Betim
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-A1', 'active') returning id into br_a1;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-A2', 'active') returning id into br_a2;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-A3', 'active') returning id into br_a3;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status, status_reason)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-E', 'inactive', 'Suite27: inativa') returning id into br_e;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-F', 'active') returning id into br_f;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-G', 'active') returning id into br_g;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-H', 'active') returning id into br_h;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opa, v_oca, 31, 3118601, 'S27-I', 'active') returning id into br_i;
  insert into public.operation_brs (organization_id, operation_id, operation_city_id, state_id, city_id, code, status)
  values (v_org, v_opb, v_ocb, 31, 3106705, 'S27-B1', 'active') returning id into br_b1;
  v_brs := array[br_a1, br_a2, br_a3, br_e, br_f, br_g, br_h, br_i, br_b1];

  -- Dez veículos reais, ativos, com placa e livres em 2031.
  select jsonb_agg(jsonb_build_object('id', x.id, 'plate', x.license_plate) order by x.license_plate) into v_ids from (
    select v.id, v.license_plate from public.vehicles v
     where v.organization_id = v_org and v.status = 'active' and v.deleted_at is null and v.license_plate is not null
       and not exists (select 1 from public.fidelization_assignments a
                        where a.vehicle_id = v.id and a.status <> 'cancelled'
                          and a.start_date <= date '2031-12-31' and coalesce(a.end_date, 'infinity'::date) >= date '2031-08-01')
     order by v.license_plate limit 10) x;
  if coalesce(jsonb_array_length(v_ids), 0) < 10 then
    raise exception 'FIXTURE: são precisos 10 veículos ativos livres em 2031';
  end if;
  v1 := (v_ids -> 0 ->> 'id')::uuid; v2 := (v_ids -> 1 ->> 'id')::uuid; v3 := (v_ids -> 2 ->> 'id')::uuid;
  v4 := (v_ids -> 3 ->> 'id')::uuid; v5 := (v_ids -> 4 ->> 'id')::uuid; v6 := (v_ids -> 5 ->> 'id')::uuid;
  v7 := (v_ids -> 6 ->> 'id')::uuid; v8 := (v_ids -> 7 ->> 'id')::uuid; v9 := (v_ids -> 8 ->> 'id')::uuid;
  v10 := (v_ids -> 9 ->> 'id')::uuid;
  p1 := v_ids -> 0 ->> 'plate'; p2 := v_ids -> 1 ->> 'plate'; p3 := v_ids -> 2 ->> 'plate';
  p4 := v_ids -> 3 ->> 'plate'; p5 := v_ids -> 4 ->> 'plate'; p6 := v_ids -> 5 ->> 'plate';

  -- O tipo de equipamento restrito a outras operações também é admitido nas de teste.
  insert into public.vehicle_type_operations (organization_id, vehicle_type_id, operation_id)
  select distinct v_org, v.vehicle_type_id, o.id
    from public.vehicles v cross join (values (v_opa), (v_opb)) o(id)
   where v.id in (v1, v2, v3, v4, v5, v6, v7, v8, v9, v10) and v.vehicle_type_id is not null
     and exists (select 1 from public.vehicle_type_operations t where t.organization_id = v_org and t.vehicle_type_id = v.vehicle_type_id)
  on conflict do nothing;

  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S27-MOT-1', 'Suite27 Motorista') returning id into v_emp;
  insert into public.employees (organization_id, employee_code, full_name) values (v_org, 'S27-LID-1', 'Suite27 Liderança') returning id into v_leader;
  begin
    insert into public.leadership_assignments (organization_id, employee_id, scope_level, operation_id, effective_from, status)
    values (v_org, v_leader, 'operation', v_opa, v_p, 'active');
  exception when others then
    r := r || 'INFO liderança de teste não criada (' || sqlerrm || '); o hash compara a tabela como está' || chr(10);
  end;

  -- Setembro/2031: V1 sai de A1 para A2 em 15/09 (A1 recebe V4); A3 termina
  -- antes do último dia; E está inativa; G e I têm o veículo/BR ocupados em
  -- outubro por um pré-planejamento manual.
  insert into public.fidelization_assignments
    (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason) values
    (v_org, br_a1, v1, 'primary', date '2031-09-01', date '2031-09-14', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_a2, v1, 'primary', date '2031-09-15', date '2031-09-30', 'confirmed', 'manual', 'Suite27: mudou de BR em 15/09'),
    (v_org, br_a1, v4, 'primary', date '2031-09-15', date '2031-09-30', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_b1, v2, 'primary', date '2031-09-01', date '2031-09-30', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_a3, v3, 'primary', date '2031-09-01', date '2031-09-20', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_e,  v5, 'primary', date '2031-09-01', date '2031-09-30', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_g,  v7, 'primary', date '2031-09-01', date '2031-09-30', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_i,  v8, 'primary', date '2031-09-01', date '2031-09-30', 'confirmed', 'manual', 'Suite27'),
    (v_org, br_h,  v7, 'primary', date '2031-10-01', date '2031-10-31', 'planned', 'manual', 'Suite27: pré-planejado'),
    (v_org, br_i,  v9, 'primary', date '2031-10-01', date '2031-10-31', 'planned', 'manual', 'Suite27: pré-planejado');
  insert into public.fidelization_drivers
    (organization_id, fidelization_assignment_id, employee_id, driver_role, start_date, end_date, status)
  select v_org, a.id, v_emp, 'primary', date '2031-09-01', date '2031-09-30', 'confirmed'
    from public.fidelization_assignments a where a.operation_br_id = br_b1 and a.start_date = v_p;
  perform pg_temp.s27_flush();

  select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into h_sep1
    from public.fidelization_assignments a where a.operation_br_id = any (v_brs) and a.start_date < v_m;
  select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) into l1 from public.leadership_assignments l;
  select count(*) into mv0 from public.fidelization_movements m where m.operation_br_id = any (v_brs);

  -- ------------------------------------------------------------------ C1 --
  begin
    select count(*) into n from public.fidelization_assignments where operation_br_id = any (v_brs);
    j := public.replicate_fidelization_competence(v_org, 2031, 9, 2031, 10, null, true, true);
    select count(*) into n2 from public.fidelization_assignments where operation_br_id = any (v_brs);
    rows := j -> 'rows';
    ok := (j ->> 'dry_run')::boolean and n = n2
          and not exists (select 1 from public.fidelization_competences c where c.organization_id = v_org and c.competence = v_m);
    ok2 := (j ->> 'reference_date') = '2031-09-30' and (j ->> 'plates_found')::int = 6
           and not (j ->> 'already_created')::boolean
           and (j -> 'vehicles' ->> 'new')::int = 3 and (j -> 'vehicles' ->> 'kept')::int = 0
           and (j -> 'vehicles' ->> 'conflicts')::int = 2 and (j -> 'vehicles' ->> 'skipped')::int = 1;
    ok3 := exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_a2 and (x ->> 'vehicle_id')::uuid = v1 and x ->> 'status' = 'new')
       and exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_a1 and (x ->> 'vehicle_id')::uuid = v4 and x ->> 'status' = 'new')
       and not exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_a1 and (x ->> 'vehicle_id')::uuid = v1)
       and not exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_a3)
       and exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_e and x ->> 'status' = 'skipped_inactive_br')
       and exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_g and x ->> 'conflict_kind' = 'vehicle_elsewhere')
       and exists (select 1 from jsonb_array_elements(rows) x where (x ->> 'br_id')::uuid = br_i and x ->> 'conflict_kind' = 'br_occupied');
    r := r || format('%s C1  prévia: não grava %s; ref. 30/09, 6 placas, 3 novas/0 existentes/2 conflitos/1 ignorada %s; placa que mudou em 15/09 vai com a BR nova, A3 (fim em 20/09) fora, conflitos nomeados %s (%s)%s',
         case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, ok, ok2, ok3, j -> 'vehicles', chr(10));
  exception when others then r := r || 'FAIL C1 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C2 --
  begin
    -- A rotina do pg_cron roda sem usuário (claims sem "sub").
    perform set_config('request.jwt.claims', '{}', true);
    ok5 := auth.uid() is null;
    j := private.fidelization_competence_tick(date '2031-10-01');
    perform pg_temp.s27_flush();
    perform set_config('request.jwt.claims', v_claims, true);

    select * into hc from public.fidelization_competences c where c.organization_id = v_org and c.competence = v_m;
    ok := hc.id is not null and hc.kind = 'operational' and hc.origin = 'auto_replication'
          and hc.source_competence = v_p and hc.reference_date = date '2031-09-30' and hc.runs = 1
          and hc.created_by is null and hc.last_run ->> 'mode' = 'auto'
          and exists (select 1 from jsonb_array_elements(j -> 'results') x
                       where (x ->> 'organization_id')::uuid = v_org and (x -> 'vehicles' ->> 'new')::int = 3);
    select count(*) into n from public.fidelization_assignments a
     where a.operation_br_id = any (v_brs) and a.source = 'replication' and a.start_date = v_m;
    ok2 := n = 3
       and not exists (select 1 from public.fidelization_assignments a
                        where a.operation_br_id = any (v_brs) and a.source = 'replication'
                          and (a.end_date <> date '2031-10-31' or a.status <> 'confirmed' or a.created_by is not null
                               or a.reason <> 'Replicado de 09/2031'))
       and exists (select 1 from public.fidelization_assignments a where a.operation_br_id = br_a1 and a.vehicle_id = v4 and a.start_date = v_m)
       and exists (select 1 from public.fidelization_assignments a where a.operation_br_id = br_a2 and a.vehicle_id = v1 and a.start_date = v_m)
       and exists (select 1 from public.fidelization_assignments a where a.operation_br_id = br_b1 and a.vehicle_id = v2 and a.start_date = v_m)
       and not exists (select 1 from public.fidelization_assignments a where a.operation_br_id in (br_a3, br_e, br_g) and a.start_date >= v_m)
       and (select count(*) from public.fidelization_assignments a where a.operation_br_id = br_i and a.start_date >= v_m) = 1;
    ok3 := exists (select 1 from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
                    where a.operation_br_id = br_b1 and a.start_date = v_m and d.employee_id = v_emp
                      and d.start_date = v_m and d.end_date = date '2031-10-31' and d.status = 'confirmed');
    select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into h_sep2
      from public.fidelization_assignments a where a.operation_br_id = any (v_brs) and a.start_date < v_m;
    select count(*) into mv1 from public.fidelization_movements m where m.operation_br_id = any (v_brs);
    ok4 := h_sep1 = h_sep2 and mv1 = mv0;
    r := r || format('%s C2  rotina automática (auth.uid() nulo=%s): cabeçalho Replicação automática ref. 30/09 %s; 3 vínculos novos 01–31/10 confirmados, sem usuário %s; motorista junto %s; setembro intacto e nenhuma mobilização %s%s',
         case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, ok5, ok, ok2, ok3, ok4, chr(10));
  exception when others then
    perform set_config('request.jwt.claims', v_claims, true);
    r := r || 'FAIL C2 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C3 --
  begin
    select count(*) into n from public.fidelization_assignments;
    perform set_config('request.jwt.claims', '{}', true);
    j := private.fidelization_competence_tick(date '2031-10-01');
    j2 := private.fidelization_competence_tick(date '2031-10-20');
    perform pg_temp.s27_flush();
    perform set_config('request.jwt.claims', v_claims, true);
    select count(*) into n2 from public.fidelization_assignments;
    ok := n = n2
          and not exists (select 1 from jsonb_array_elements(j -> 'results') x where (x ->> 'organization_id')::uuid = v_org)
          and not exists (select 1 from jsonb_array_elements(j2 -> 'results') x where (x ->> 'organization_id')::uuid = v_org)
          and (select runs from public.fidelization_competences c where c.organization_id = v_org and c.competence = v_m) = 1;
    r := r || format('%s C3  rotina de novo (01/10 e 20/10): nada criado, cabeçalho com 1 execução %s%s',
         case when ok then 'PASS' else 'FAIL' end, ok, chr(10));
  exception when others then
    perform set_config('request.jwt.claims', v_claims, true);
    r := r || 'FAIL C3 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C4 --
  begin
    select private.fidelization_origin_label(a.source, a.created_by) into txt
      from public.fidelization_assignments a where a.operation_br_id = br_b1 and a.start_date = v_m;
    ok := txt = 'Replicação automática'
          and private.fidelization_origin_label('replication', v_user) = 'Replicação manual'
          and private.fidelization_origin_label('import', v_user) = 'Importação histórica'
          and private.fidelization_origin_label('manual', v_user) = 'Alteração manual'
          and private.fidelization_origin_label('substitution', null) = 'Alteração manual'
          and private.fidelization_origin_label('inversion', v_user) = 'Alteração manual'
          and private.fidelization_competence_origin_label('auto_replication') = 'Replicação automática'
          and private.fidelization_competence_origin_label('historical_import') = 'Importação histórica'
          and private.fidelization_competence_label(v_m) = 'Outubro/2031';
    r := r || format('%s C4  origem por extenso (vínculo replicado pela rotina = "%s"; manual, importação, alterações) %s%s',
         case when ok then 'PASS' else 'FAIL' end, txt, ok, chr(10));
  exception when others then r := r || 'FAIL C4 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C5 --
  begin
    -- Correção tardia de setembro: F recebe V6 no último dia.
    insert into public.fidelization_assignments
      (organization_id, operation_br_id, vehicle_id, vehicle_role, start_date, end_date, status, source, reason)
    values (v_org, br_f, v6, 'primary', date '2031-09-30', date '2031-09-30', 'confirmed', 'manual', 'Suite27: correção tardia');
    perform pg_temp.s27_flush();
    select count(*) into mv0 from public.fidelization_movements m where m.operation_br_id = any (v_brs);

    j := public.replicate_fidelization_competence(v_org, 2031, 9, 2031, 10, null, true, true);
    ok := (j ->> 'already_created')::boolean and j -> 'destination' ->> 'origin' = 'auto_replication'
          and j -> 'destination' ->> 'origin_label' = 'Replicação automática'
          and (j ->> 'plates_found')::int = 7
          and (j -> 'vehicles' ->> 'new')::int = 1 and (j -> 'vehicles' ->> 'kept')::int = 3
          and (j -> 'vehicles' ->> 'conflicts')::int = 2 and (j -> 'vehicles' ->> 'skipped')::int = 1
          and exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'br_id')::uuid = br_f and x ->> 'status' = 'new');

    j2 := public.replicate_fidelization_competence(v_org, 2031, 9, 2031, 10, null, true, false);
    perform pg_temp.s27_flush();
    select * into hc from public.fidelization_competences c where c.organization_id = v_org and c.competence = v_m;
    ok2 := (j2 -> 'vehicles' ->> 'new')::int = 1
           and exists (select 1 from public.fidelization_assignments a
                        where a.operation_br_id = br_f and a.vehicle_id = v6 and a.start_date = v_m and a.end_date = date '2031-10-31'
                          and a.source = 'replication' and a.created_by = v_user and a.status = 'planned'
                          and private.fidelization_origin_label(a.source, a.created_by) = 'Replicação manual')
           and hc.origin = 'auto_replication' and hc.runs = 2 and hc.last_run ->> 'mode' = 'manual';

    select count(*) into n from public.fidelization_assignments where operation_br_id = any (v_brs);
    k := public.replicate_fidelization_competence(v_org, 2031, 9, 2031, 10, null, true, false);
    perform pg_temp.s27_flush();
    select count(*) into n2 from public.fidelization_assignments where operation_br_id = any (v_brs);
    select count(*) into n3 from (
      select a.operation_br_id, a.vehicle_id from public.fidelization_assignments a
       where a.operation_br_id = any (v_brs) and a.status <> 'cancelled'
         and a.start_date <= date '2031-10-31' and coalesce(a.end_date, 'infinity'::date) >= v_m
       group by 1, 2 having count(*) > 1) d;
    select count(*) into mv1 from public.fidelization_movements m where m.operation_br_id = any (v_brs);
    ok3 := (k -> 'vehicles' ->> 'new')::int = 0 and (k ->> 'already_created')::boolean and n = n2 and n3 = 0;
    ok4 := mv1 = mv0;
    r := r || format('%s C5  manual depois da automática: já criada (Replicação automática), 7 placas, só 1 a complementar %s; complementou 1 (Replicação manual), origem mantida, 2 execuções %s; repetir = 0 novos, sem duplicidade %s; replicar não gera mobilização %s (%s→%s)%s',
         case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, ok, ok2, ok3, ok4, mv0, mv1, chr(10));
  exception when others then r := r || 'FAIL C5 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C6 --
  begin
    -- Em produção cada chamada é uma transação; aqui o contexto da replicação
    -- anterior ainda está na sessão.
    perform set_config('hfm.fidelization_context', '', true);
    select a.id into v_x from public.fidelization_assignments a
     where a.operation_br_id = br_a1 and a.vehicle_id = v4 and a.start_date = v_m and a.status <> 'cancelled';
    perform public.substitute_fidelization_vehicle(v_x, v10, date '2031-10-15', 'Suite27: troca no meio do mês');
    perform pg_temp.s27_flush();
    ok := exists (select 1 from public.fidelization_assignments a where a.id = v_x and a.end_date = date '2031-10-14')
          and exists (select 1 from public.fidelization_assignments a
                       where a.operation_br_id = br_a1 and a.vehicle_id = v10 and a.start_date = date '2031-10-15'
                         and a.end_date = date '2031-10-31' and a.source = 'substitution'
                         and private.fidelization_origin_label(a.source, a.created_by) = 'Alteração manual');
    select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into h_oct1
      from public.fidelization_assignments a where a.operation_br_id = any (v_brs) and a.start_date between v_m and date '2031-10-31';

    j := public.replicate_fidelization_competence(v_org, 2031, 10, 2031, 11, null, true, true);
    ok2 := (j ->> 'reference_date') = '2031-10-31' and (j ->> 'plates_found')::int = 6 and not (j ->> 'already_created')::boolean
           and exists (select 1 from jsonb_array_elements(j -> 'rows') x
                        where (x ->> 'br_id')::uuid = br_a1 and (x ->> 'vehicle_id')::uuid = v10 and x ->> 'status' = 'new')
           and not exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'vehicle_id')::uuid = v4);
    j2 := public.replicate_fidelization_competence(v_org, 2031, 10, 2031, 11, null, true, false);
    perform pg_temp.s27_flush();
    select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) into h_oct2
      from public.fidelization_assignments a where a.operation_br_id = any (v_brs) and a.start_date between v_m and date '2031-10-31';
    ok3 := (j2 -> 'vehicles' ->> 'new')::int = 6
           and exists (select 1 from public.fidelization_assignments a
                        where a.operation_br_id = br_a1 and a.vehicle_id = v10 and a.start_date = v_n
                          and a.end_date = date '2031-11-30' and a.status = 'planned' and a.reason = 'Replicado de 10/2031')
           and (select c.origin from public.fidelization_competences c where c.organization_id = v_org and c.competence = v_n) = 'manual_replication'
           and exists (select 1 from public.fidelization_drivers d join public.fidelization_assignments a on a.id = d.fidelization_assignment_id
                        where a.operation_br_id = br_b1 and a.start_date = v_n and d.employee_id = v_emp)
           and h_oct1 = h_oct2;
    r := r || format('%s C6  troca em 15/10 %s; 10→11 lê 31/10 (A1 vai com o substituto, 6 placas) %s; novembro criado (Replicação manual, planejado), outubro intacto %s%s',
         case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, ok, ok2, ok3, chr(10));
  exception when others then r := r || 'FAIL C6 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C7 --
  select md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) into l2 from public.leadership_assignments l;
  r := r || format('%s C7  lideranças intactas depois da rotina, das replicações e da troca (hash igual) %s%s',
       case when l1 = l2 then 'PASS' else 'FAIL' end, l1 = l2, chr(10));

  -- ------------------------------------------------------------------ C8 --
  begin
    rows := jsonb_build_array(
      jsonb_build_object('competence', '2024-03', 'plate', p1, 'operation', 'suite27 operacao a', 'uf', 'MG', 'city', 'Contagem',
                         'br_code', null, 'first_day', '2024-03-01', 'last_day', '2024-03-31', 'days', 31),
      jsonb_build_object('competence', '2024-03', 'plate', lower(p2), 'operation', 'Suite27 Operação A', 'uf', 'MG', 'city', '3118601',
                         'br_code', '-', 'first_day', '01/03/2024', 'last_day', '15'),
      jsonb_build_object('competence', '03/2024', 'plate', p3, 'operation', 'S27-OPB', 'uf', 'MG', 'city', 'Betim', 'br_code', 'BR 000'),
      jsonb_build_object('competence', '2025-05', 'plate', p4, 'operation', 'Suite27 Operação A', 'uf', 'MG', 'city', 'Contagem',
                         'br_code', 's27-a1', 'first_day', '2025-05-01', 'last_day', '2025-05-31', 'days', 31),
      jsonb_build_object('competence', '2025-05', 'plate', p5, 'operation', 'Suite27 Operação A', 'uf', 'MG', 'city', 'Contagem',
                         'br_code', 'XYZ-999', 'first_day', '2025-05-10', 'last_day', '2025-05-31', 'days', 22),
      jsonb_build_object('competence', '2026-02', 'plate', p6, 'operation', 'Suite27 Operação A', 'uf', 'MG', 'city', 'Contagem'),
      jsonb_build_object('competence', '2025-05', 'plate', 'ZZZ9Z99', 'operation', 'Suite27 Operação A', 'uf', 'MG', 'city', 'Contagem'));

    select (select count(*) from public.fidelization_history_positions), (select count(*) from public.fidelization_competences) into n, n3;
    j := public.import_fidelization_history(v_org, rows, 'suite27-previa', true);
    select (select count(*) from public.fidelization_history_positions), (select count(*) from public.fidelization_competences) into n2, n4;
    ok := (j ->> 'dry_run')::boolean and (j ->> 'inserted')::int = 5 and (j ->> 'errors')::int = 2 and n = n2 and n3 = n4;

    j := public.import_fidelization_history(v_org, rows, 'suite27');
    ok2 := (j ->> 'inserted')::int = 5 and (j ->> 'duplicates')::int = 0 and (j ->> 'errors')::int = 2 and (j ->> 'warnings')::int = 1
           and exists (select 1 from jsonb_array_elements(j -> 'error_examples') e where (e ->> 'row')::int = 6 and e ->> 'message' like '%operacional%')
           and exists (select 1 from jsonb_array_elements(j -> 'error_examples') e where (e ->> 'row')::int = 7 and e ->> 'message' like '%não cadastrado%')
           and exists (select 1 from jsonb_array_elements(j -> 'warning_examples') e where e ->> 'message' like '%XYZ-999%');
    -- 2024: BR nula de verdade ("-" e "BR 000" também); 2025: BR resolvida e não resolvida.
    ok3 := (select count(*) from public.fidelization_history_positions p
             where p.organization_id = v_org and p.competence = date '2024-03-01' and p.operation_id in (v_opa, v_opb)) = 3
       and not exists (select 1 from public.fidelization_history_positions p
                        where p.organization_id = v_org and p.competence = date '2024-03-01' and p.operation_id in (v_opa, v_opb)
                          and (p.br_code_snapshot is not null or p.operation_br_id is not null))
       and exists (select 1 from public.fidelization_history_positions p
                    where p.vehicle_id = v2 and p.competence = date '2024-03-01' and p.last_day = date '2024-03-15' and p.days = 15)
       and exists (select 1 from public.fidelization_history_positions p
                    where p.vehicle_id = v4 and p.competence = date '2025-05-01' and p.operation_br_id = br_a1 and p.br_code_snapshot = 's27-a1')
       and exists (select 1 from public.fidelization_history_positions p
                    where p.vehicle_id = v5 and p.competence = date '2025-05-01' and p.operation_br_id is null and p.br_code_snapshot = 'XYZ-999')
       and (select c.kind || '/' || c.origin from public.fidelization_competences c
             where c.organization_id = v_org and c.competence = date '2024-03-01') = 'historical/historical_import'
       and not exists (select 1 from public.fidelization_assignments a where a.start_date < date '2026-01-01' and a.operation_br_id = any (v_brs));

    k := public.import_fidelization_history(v_org, rows, 'suite27');
    ok4 := (k ->> 'inserted')::int = 0 and (k ->> 'duplicates')::int = 5;
    r := r || format('%s C8  histórico: prévia não grava %s; 5 gravadas, 2026 e placa desconhecida recusadas, BR não achada avisada %s; 2024 com BR nula ("-", "BR 000" = NULL), 2025 com BR, nada em vínculos %s; reimportar = 5 duplicadas %s%s',
         case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, ok, ok2, ok3, ok4, chr(10));
  exception when others then r := r || 'FAIL C8 ' || sqlerrm || chr(10);
  end;

  -- ------------------------------------------------------------------ C9 --
  begin
    j := public.fidelization_history_rows(v_org, 2024, 3, jsonb_build_object('operation_ids', jsonb_build_array(v_opa, v_opb)));
    ok := (j ->> 'has_br') = 'false' and (j ->> 'total')::int = 3
          and (j -> 'totals' ->> 'brs')::int = 0 and (j -> 'totals' ->> 'locais')::int = 2 and (j -> 'totals' ->> 'plates')::int = 3
          and not exists (select 1 from jsonb_array_elements(j -> 'rows') x where jsonb_typeof(x -> 'br_code') <> 'null')
          and j ->> 'kind' = 'historical' and (j ->> 'loaded')::boolean;
    j := public.fidelization_history_rows(v_org, 2025, 5, jsonb_build_object('operation_ids', jsonb_build_array(v_opa)));
    j2 := public.fidelization_history_rows(v_org, 2025, 5, jsonb_build_object('br_ids', jsonb_build_array(br_a1)));
    k := public.fidelization_history_rows(v_org, 2025, 5, jsonb_build_object('q', lower(p5), 'operation_ids', jsonb_build_array(v_opa)));
    ok2 := (j ->> 'has_br')::boolean and (j ->> 'total')::int = 2 and (j -> 'totals' ->> 'brs')::int = 2
           and exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'br_id')::uuid = br_a1 and x ->> 'br_code' = 's27-a1')
           and (j2 ->> 'total')::int = 1 and (k ->> 'total')::int = 1
           and exists (select 1 from jsonb_array_elements(j -> 'options' -> 'brs') b where b ->> 'code' = 'XYZ-999');
    j := public.fidelization_history_evolution(v_org, 2025);
    select x into k from jsonb_array_elements(j -> 'months') x where (x ->> 'month')::int = 5;
    ok3 := jsonb_array_length(j -> 'months') = 12 and (k ->> 'plates')::int >= 2 and (k ->> 'loaded')::boolean
           and (k ->> 'brs')::int >= 2;
    r := r || format('%s C9  leituras: 2024 sem BR (has_br falso, br_code null, 2 locais) %s; 2025 com BR, filtros por operação/BR/placa %s; evolução do ano (12 meses, maio %s) %s%s',
         case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, ok, ok2, k, ok3, chr(10));
  exception when others then r := r || 'FAIL C9 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- C10 --
  begin
    ok := false; ok2 := false; ok3 := false; ok4 := false; ok5 := false;
    begin
      update public.fidelization_history_positions set days = days where organization_id = v_org and operation_id = v_opa;
    exception when others then ok := true; end;
    -- Sem DELETE na suíte (o conector de produção pede confirmação para
    -- comandos destrutivos): a exclusão é provada pelo gatilho BEFORE DELETE
    -- que recusa sempre (private.tg_block_mutation), nas duas tabelas.
    ok2 := exists (select 1 from pg_trigger t
                    where t.tgrelid = 'public.fidelization_history_positions'::regclass and not t.tgisinternal
                      and t.tgfoid = 'private.tg_block_mutation()'::regprocedure
                      and (t.tgtype & 2) <> 0 and (t.tgtype & 8) <> 0 and (t.tgtype & 16) <> 0);
    begin
      update public.fidelization_competences set origin = 'manual' where organization_id = v_org and competence = v_m;
    exception when others then ok3 := true; end;
    begin
      perform private.fidelization_replicate(v_org, date '2025-12-01', date '2026-01-01', false, true, 'manual', 'planned', null, false);
    exception when others then ok4 := sqlerrm like '%histórica%'; end;
    begin
      perform public.replicate_fidelization_competence(v_org, 2024, 2, 2024, 3, null, false, true);
    exception when others then ok5 := sqlerrm like '%histórica%'; end;
    ok5 := ok5 and exists (select 1 from pg_trigger t
                            where t.tgrelid = 'public.fidelization_competences'::regclass and not t.tgisinternal
                              and t.tgfoid = 'private.tg_block_mutation()'::regprocedure
                              and (t.tgtype & 2) <> 0 and (t.tgtype & 8) <> 0);
    r := r || format('%s C10 só consulta: posição não muda %s nem sai (gatilho) %s; cabeçalho não muda de origem %s; replicar a partir de 2025 recusado %s; para 2024 recusado e cabeçalho não sai (gatilho) %s%s',
         case when ok and ok2 and ok3 and ok4 and ok5 then 'PASS' else 'FAIL' end, ok, ok2, ok3, ok4, ok5, chr(10));
  exception when others then r := r || 'FAIL C10 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- C11 --
  begin
    txt := '';
    j := public.fidelization_competence_summary(v_org, 2031, 10);
    select count(distinct a.vehicle_id), count(distinct a.operation_br_id) into n, n2
      from public.fidelization_assignments a join public.operation_brs b on b.id = a.operation_br_id
     where a.organization_id = v_org and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= date '2031-10-31' and coalesce(a.end_date, 'infinity'::date) >= v_m;
    ok := j ->> 'label' = 'Outubro/2031' and j ->> 'kind' = 'operational' and (j ->> 'exists')::boolean
          and j ->> 'situation' = 'planned' and j ->> 'situation_label' = 'Planejada'
          and j ->> 'origin' = 'auto_replication' and j ->> 'origin_label' = 'Replicação automática'
          and j ->> 'source_competence' = '2031-09' and j ->> 'reference_date' = '2031-09-30'
          and (j -> 'counts' ->> 'plates')::int = n and (j -> 'counts' ->> 'brs')::int = n2
          and (j -> 'counts' ->> 'plates')::int >= 7 and (j -> 'counts' ->> 'locais')::int >= 2
          and j ->> 'last_updated_at' is not null
          and j -> 'previous' ->> 'reference_date' = '2031-09-30' and (j -> 'previous' ->> 'plates_found')::int >= 7;
    txt := txt || format('out/2031 %s (%s placas, %s BRs); ', ok, j -> 'counts' ->> 'plates', j -> 'counts' ->> 'brs');

    j := public.fidelization_competence_summary(v_org, 2031, 12);
    ok2 := j ->> 'situation' = 'not_created' and j ->> 'situation_label' = 'Não criada' and not (j ->> 'exists')::boolean
           and j -> 'previous' ->> 'reference_date' = '2031-11-30' and (j -> 'previous' ->> 'plates_found')::int >= 6;
    j2 := public.fidelization_competence_summary(v_org, 2031, 11);
    ok2 := ok2 and j2 ->> 'origin_label' = 'Replicação manual' and j2 ->> 'situation' = 'planned';

    -- Em andamento e Encerrada: o mês corrente e um mês passado de 2026.
    insert into public.fidelization_competences (organization_id, competence, kind, origin)
    values (v_org, date_trunc('month', private.fidelization_today())::date, 'operational', 'manual')
    on conflict (organization_id, competence) do nothing;
    insert into public.fidelization_competences (organization_id, competence, kind, origin)
    values (v_org, date '2026-01-01', 'operational', 'historical_import')
    on conflict (organization_id, competence) do nothing;
    j := public.fidelization_competence_summary(v_org, extract(year from private.fidelization_today())::int,
                                                extract(month from private.fidelization_today())::int);
    j2 := public.fidelization_competence_summary(v_org, 2026, 1);
    ok3 := j ->> 'situation_label' = 'Em andamento' and j2 ->> 'situation_label' = 'Encerrada'
           and j2 ->> 'origin_label' = 'Importação histórica';

    j := public.fidelization_competence_summary(v_org, 2024, 3);
    ok4 := j ->> 'kind' = 'historical' and j ->> 'situation_label' = 'Histórica (consulta)'
           and (j -> 'counts' ->> 'plates')::int >= 3 and j ->> 'origin_label' = 'Importação histórica';
    j2 := public.fidelization_competence_summary(v_org, 2024, 7);
    ok4 := ok4 and j2 ->> 'kind' = 'historical' and (j2 -> 'counts' ->> 'plates')::int = 0;
    r := r || format('%s C11 resumo: %sNão criada/Replicação manual %s; Em andamento/Encerrada %s; Histórica (consulta) %s%s',
         case when ok and ok2 and ok3 and ok4 then 'PASS' else 'FAIL' end, txt, ok2, ok3, ok4, chr(10));
  exception when others then r := r || 'FAIL C11 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- C12 --
  begin
    -- Gestor de Frota (sem "todas as operações") e nenhum escopo nas operações de teste.
    perform set_config('hfm.access_change', 'on', true);
    update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gestor_frota'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);

    set local role authenticated;
    select count(*) into n from public.fidelization_history_positions where operation_id in (v_opa, v_opb);
    select count(*) into n4 from public.fidelization_competences where organization_id = v_org and competence = v_m;
    j := public.fidelization_competence_summary(v_org, 2031, 10);
    j2 := public.fidelization_history_rows(v_org, 2024, 3, '{}'::jsonb);
    reset role;
    ok := n = 0 and (j -> 'counts' ->> 'plates')::int = 0 and not exists (
            select 1 from jsonb_array_elements(j2 -> 'rows') x where (x ->> 'operation_id')::uuid in (v_opa, v_opb))
          and n4 = 1;

    -- O escopo é dado pela administração de acesso (aqui, contexto de manutenção sem usuário).
    perform set_config('request.jwt.claims', '{}', true);
    perform set_config('hfm.access_change', 'on', true);
    insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_opa)
      on conflict (membership_id, operation_id) do nothing;
    perform set_config('hfm.access_change', '', true);
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    select count(*) filter (where operation_id = v_opa), count(*) filter (where operation_id = v_opb) into n2, n3
      from public.fidelization_history_positions where operation_id in (v_opa, v_opb);
    j := public.fidelization_competence_summary(v_org, 2031, 10);
    j2 := public.fidelization_history_rows(v_org, 2024, 3, '{}'::jsonb);
    k := public.replicate_fidelization_competence(v_org, 2031, 10, 2031, 11, null, false, true);
    reset role;
    select count(distinct a.vehicle_id) into n4
      from public.fidelization_assignments a join public.operation_brs b on b.id = a.operation_br_id
     where b.operation_id = v_opa and a.vehicle_role = 'primary' and a.status <> 'cancelled'
       and a.start_date <= date '2031-10-31' and coalesce(a.end_date, 'infinity'::date) >= v_m;
    ok2 := n2 = 4 and n3 = 0 and (j -> 'counts' ->> 'plates')::int = n4
           and not exists (select 1 from jsonb_array_elements(j2 -> 'rows') x where (x ->> 'operation_id')::uuid = v_opb)
           and exists (select 1 from jsonb_array_elements(j2 -> 'rows') x where (x ->> 'operation_id')::uuid = v_opa)
           and not exists (select 1 from jsonb_array_elements(k -> 'rows') x where (x ->> 'operation_id')::uuid = v_opb)
           and (k ->> 'plates_found')::int = 5;
    r := r || format('%s C12 escopo: sem escopo não vê posições nem placas (cabeçalho visível) %s; com escopo em A vê A (%s posições) e nada de B, resumo e prévia no escopo %s%s',
         case when ok and ok2 then 'PASS' else 'FAIL' end, ok, n2, ok2, chr(10));
  exception when others then
    reset role;
    r := r || 'FAIL C12 ' || sqlerrm || chr(10);
  end;

  -- ----------------------------------------------------------------- C13 --
  begin
    perform set_config('hfm.access_change', 'on', true);
    update public.membership_roles set role_id = (select ro.id from public.roles ro where ro.code = 'gente'
      and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null order by ro.organization_id nulls last limit 1)
     where membership_id = v_mem;
    perform set_config('hfm.access_change', '', true);
    ok := false; ok2 := false; ok3 := false;
    begin perform public.fidelization_competence_summary(v_org, 2031, 10);
    exception when insufficient_privilege then ok := true; end;
    begin perform public.replicate_fidelization_competence(v_org, 2031, 10, 2031, 11, null, false, true);
    exception when insufficient_privilege then ok2 := true; end;
    begin perform public.import_fidelization_history(v_org, '[]'::jsonb, 'x');
    exception when insufficient_privilege then ok3 := true; end;
    r := r || format('%s C13 sem permissão: resumo %s, replicação %s e carga do histórico %s recusados%s',
         case when ok and ok2 and ok3 then 'PASS' else 'FAIL' end, ok, ok2, ok3, chr(10));
  exception when others then r := r || 'FAIL C13 ' || sqlerrm || chr(10);
  end;

  raise exception 'ROLLBACK_TESTES%', chr(10) || r;
end $t$;
