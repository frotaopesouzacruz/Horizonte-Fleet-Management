-- =============================================================================
-- 16b · Lideranças — exportação (Etapa 08 §20) e prévia de impacto da edição
--       histórica (Etapa 13 §13–§14)
--
-- Suíte transacional contra o banco COM DADOS. Usa uma designação real de
-- cidade (a mais antiga, aberta) e simula corrigir o seu início para cinco
-- dias atrás: os dias entre o início real e a nova data perdem a liderança.
-- Nada do que ela escreve sobrevive: cada bloco termina em
-- `raise exception 'ROLLBACK_TESTES …'` DE PROPÓSITO.
--
-- O que cada bloco protege:
--   Bloco 1 (exportação e prévia, como administrador)
--   E1  `leadership.export` existe no módulo leadership com os MESMOS perfis
--       padrão de `fidelization.export`, e chegou aos papéis; a correção
--       histórica existe e fica com o Administrador
--   E2  exportar grava UMA linha de auditoria (EXPORT, ator real, linhas,
--       filtros da tela — e só eles)
--   E3  formato inválido é recusado (sem registro, a rota não entrega)
--   I1  prévia de um período passado real: BRs, veículos, motoristas,
--       checklists e obrigações batem com consultas diretas feitas com o
--       resolvedor oficial `private.br_leadership_at`
--   I2  a prévia não grava nada: vínculos, auditoria e obrigações idênticos;
--       a função é STABLE (o banco recusaria escrita)
--   I3  alteração só no futuro, ou só de observação: não retroativa
--   I4  gravar a correção sem motivo é recusado; com motivo grava, devolve
--       `retroactive`, guarda o motivo na linha e na auditoria com o ator
--       real — e NÃO regrava a liderança das obrigações já geradas
--   Bloco 2 (perfil, escopo e organização)
--   S1  Liderança Operações (manage sem correção histórica): prévia e
--       gravação retroativas recusadas; encerrar no passado recusado pelo
--       gatilho (vale para qualquer caminho); futuro permitido; exporta
--   S2  Operacional: não exporta, não vê prévia
--   S3  Gestão: exporta, não vê prévia (sem manage)
--   S4  escopo de outra operação: prévia recusada ("escopo")
--   S5  organização trocada: prévia e exportação recusadas
--
-- Última execução: 23/09/2026 (projeto jgyvaltwqntpcjqounty), 12/12 PASS
--   Bloco 1:
--   PASS E1 leadership.export com os mesmos perfis de fidelization.export (administrador, gestao, gestor_frota, lideranca_operacoes) e nos papeis; correcao historica so do Administrador
--   PASS E2 exportacao auditada: 1 linha EXPORT com ator real, formato, 7 linhas e so os filtros da tela
--   PASS E3 formato invalido recusado
--   PASS I1 previa de 01/01/2026 a 17/09/2026 bate com o resolvedor oficial: 38 BRs, 60 veiculos, 0 motoristas, 0 checklists, 1156 obrigacoes
--   PASS I2 previa nao grava nada: vinculos, obrigacoes e auditoria identicos; funcao STABLE
--   PASS I3 vinculo novo no futuro e edicao so de observacao: nao retroativos
--   PASS I4 sem motivo recusado; com motivo grava (retroactive), motivo na linha e na auditoria com o ator real; obrigacoes ja geradas intactas
--   Bloco 2:
--   PASS S1 lideranca operacoes: previa, gravacao e encerramento no passado recusados (rotina e gatilho); futuro permitido; exporta
--   PASS S4 operacao fora do escopo: previa recusada
--   PASS S5 organizacao trocada: previa e exportacao recusadas
--   PASS S2 operacional: exportacao recusada e sem registro; previa recusada
--   PASS S3 gestao: exporta, nao ve previa (sem manage)
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; v_new_from date; v_last date;
  l public.leadership_assignments;
  v_res jsonb; v_res2 jsonb; r text := '';
  n int; n2 int; n3 int; n4 int; n5 int;
  d_brs int; d_veh int; d_drv int; d_exe int; d_obl int;
  v_md5_la text; v_md5_la2 text; v_md5_obl text; v_md5_obl2 text; v_audit0 int; v_audit1 int;
  v_vol char;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id into v_user from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.fidelization_today();
  v_new_from := v_today - 5;
  v_last := v_new_from - 1;

  -- A designação de cidade aberta mais antiga que tenha obrigações da Aderência
  -- no período que a correção alcança.
  select la.* into l
    from public.leadership_assignments la
   where la.organization_id = v_org and la.status = 'active' and la.responsibility_type = 'principal'
     and la.scope_level = 'city' and la.effective_to is null and la.effective_from < v_new_from - 1
   order by (select count(*) from public.checklist_obligations o
               join public.operation_brs b on b.id = o.operation_br_id
              where b.operation_city_id = la.operation_city_id and o.is_active
                and o.operational_date between la.effective_from and v_last) desc,
            la.effective_from, la.id
   limit 1;
  if l.id is null then
    raise exception 'FIXTURE: nenhuma designação de cidade aberta e antiga.';
  end if;
  -- Sem liderança por operação nesta operação, "depois" é ninguém — e a
  -- consulta direta pode ser só "dias em que o resolvedor oficial devolve l".
  if exists (select 1 from public.leadership_assignments x
              where x.operation_id = l.operation_id and x.scope_level = 'operation'
                and x.responsibility_type = 'principal' and x.status = 'active') then
    raise exception 'FIXTURE: a operação tem liderança por operação; escolha outra designação.';
  end if;

  -- ------------------------------------------------------------------ E1 ---
  select count(*) into n from (
    select profile_code from public.access_profile_defaults where permission_code = 'leadership.export'
    except
    select profile_code from public.access_profile_defaults where permission_code = 'fidelization.export') x;
  select count(*) into n2 from (
    select profile_code from public.access_profile_defaults where permission_code = 'fidelization.export'
    except
    select profile_code from public.access_profile_defaults where permission_code = 'leadership.export') x;
  select count(*) into n3 from public.permissions
   where code in ('leadership.export', 'leadership.manage_historical_data') and module = 'leadership';
  -- Todo papel da organização com o padrão recebeu a permissão.
  select count(*) into n4
    from public.roles ro
    join public.access_profile_defaults d on d.profile_code = ro.code
   where ro.organization_id = v_org and ro.deleted_at is null
     and d.permission_code in ('leadership.export', 'leadership.manage_historical_data')
     and not exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                      where rp.role_id = ro.id and p.code = d.permission_code);
  select count(*) into n5 from public.access_profile_defaults
   where permission_code = 'leadership.manage_historical_data' and profile_code <> 'administrador';
  if n = 0 and n2 = 0 and n3 = 2 and n4 = 0 and n5 = 0
     and exists (select 1 from public.access_profile_defaults where permission_code = 'leadership.export') then
    r := r || format('PASS E1 leadership.export com os mesmos perfis de fidelization.export (%s) e nos papeis; correcao historica so do Administrador',
      (select string_agg(profile_code, ', ' order by profile_code) from public.access_profile_defaults where permission_code = 'leadership.export')) || chr(10);
  else r := r || format('FAIL E1 a_mais=%s a_menos=%s perms=%s papeis_sem=%s hist_extra=%s', n, n2, n3, n4, n5) || chr(10); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ------------------------------------------------------------------ E2 ---
  select count(*) into v_audit0 from public.audit_logs where entity_type = 'leadership_export';
  perform public.log_leadership_export(v_org, 'xlsx', 7,
    jsonb_build_object('ano', '2026', 'mes', '9', 'operacao', l.operation_id, 'lixo', repeat('x', 5000)));
  reset role;
  select count(*) into v_audit1 from public.audit_logs where entity_type = 'leadership_export';
  select count(*) into n from public.audit_logs
   where entity_type = 'leadership_export' and action = 'EXPORT' and user_id = v_user and organization_id = v_org
     and new_data ->> 'format' = 'xlsx' and (new_data ->> 'row_count')::int = 7
     and new_data -> 'filters' ->> 'operacao' = l.operation_id::text
     and not (new_data -> 'filters' ? 'lixo')
     and created_at >= now() - interval '1 minute';
  if v_audit1 - v_audit0 = 1 and n = 1 then
    r := r || 'PASS E2 exportacao auditada: 1 linha EXPORT com ator real, formato, 7 linhas e so os filtros da tela' || chr(10);
  else r := r || format('FAIL E2 delta=%s encontrada=%s', v_audit1 - v_audit0, n) || chr(10); end if;

  -- ------------------------------------------------------------------ E3 ---
  set local role authenticated;
  begin
    perform public.log_leadership_export(v_org, 'pdf', 1, '{}'::jsonb);
    r := r || 'FAIL E3 formato pdf aceito' || chr(10);
  exception when others then
    if sqlerrm like '%Formato de exportação inválido%' then
      r := r || 'PASS E3 formato invalido recusado' || chr(10);
    else r := r || 'FAIL E3 ' || sqlerrm || chr(10); end if;
  end;
  reset role;

  -- ------------------------------------------------------------------ I1 ---
  -- Consultas diretas com o resolvedor oficial: os dias em que a BR responde
  -- por `l` entre o início real e a véspera do novo início.
  with brs as (
    select b.id from public.operation_brs b
     where b.operation_city_id = l.operation_city_id and b.deleted_at is null
  ), pairs as (
    select b.id as br_id, g::date as day
      from brs b, generate_series(l.effective_from::timestamp, v_last::timestamp, interval '1 day') g
  ), hit as (
    select p.br_id, p.day from pairs p
     where (select x.leadership_assignment_id from private.br_leadership_at(p.br_id, p.day) x) = l.id
  )
  select (select count(distinct br_id) from hit),
         (select count(distinct a.vehicle_id) from public.fidelization_assignments a
           where a.status <> 'cancelled' and exists (select 1 from hit h where h.br_id = a.operation_br_id
                  and h.day between a.start_date and coalesce(a.end_date, 'infinity'::date))),
         (select count(distinct dr.employee_id) from public.fidelization_drivers dr
            join public.fidelization_assignments a on a.id = dr.fidelization_assignment_id and a.status <> 'cancelled'
           where dr.status <> 'cancelled' and exists (select 1 from hit h where h.br_id = a.operation_br_id
                  and h.day between greatest(a.start_date, dr.start_date)
                                and least(coalesce(a.end_date, 'infinity'::date), coalesce(dr.end_date, 'infinity'::date)))),
         (select count(*) from public.checklist_executions e
           where e.status = 'submitted' and exists (select 1 from hit h where h.br_id = e.operation_br_id and h.day = e.operational_date)),
         (select count(*) from public.checklist_obligations o
           where o.is_active and exists (select 1 from hit h where h.br_id = o.operation_br_id and h.day = o.operational_date))
    into d_brs, d_veh, d_drv, d_exe, d_obl;

  select md5(string_agg(x::text, '|' order by x.id)) into v_md5_la from public.leadership_assignments x;
  select md5(string_agg(o.id::text || coalesce(o.leader_employee_id::text, '-') || o.updated_at::text, '|' order by o.id))
    into v_md5_obl from public.checklist_obligations o;
  select count(*) into v_audit0 from public.audit_logs;

  set local role authenticated;
  v_res := public.leadership_change_impact(v_org, jsonb_build_object(
    'id', l.id, 'employee_id', l.employee_id, 'scope_level', 'city', 'operation_id', l.operation_id,
    'operation_city_id', l.operation_city_id, 'responsibility_type', 'principal',
    'effective_from', v_new_from, 'effective_to', null));
  reset role;

  if (v_res ->> 'retroactive')::boolean
     and (v_res -> 'periods' -> 0 ->> 'from')::date = l.effective_from
     and (v_res -> 'periods' -> 0 ->> 'to')::date = v_last
     and (v_res -> 'brs' ->> 'count')::int = d_brs
     and (v_res -> 'vehicles' ->> 'count')::int = d_veh
     and (v_res -> 'drivers' ->> 'count')::int = d_drv
     and (v_res -> 'checklists' ->> 'count')::int = d_exe
     and (v_res -> 'obligations' ->> 'count')::int = d_obl
     and d_brs > 0
     and (v_res ->> 'snapshots_preserved')::boolean
     and jsonb_array_length(v_res -> 'brs' -> 'sample') = least(d_brs, 8) then
    r := r || format('PASS I1 previa de %s a %s bate com o resolvedor oficial: %s BRs, %s veiculos, %s motoristas, %s checklists, %s obrigacoes',
      to_char(l.effective_from, 'DD/MM/YYYY'), to_char(v_last, 'DD/MM/YYYY'), d_brs, d_veh, d_drv, d_exe, d_obl) || chr(10);
  else r := r || format('FAIL I1 previa=%s/%s/%s/%s/%s direto=%s/%s/%s/%s/%s periodos=%s',
      v_res -> 'brs' ->> 'count', v_res -> 'vehicles' ->> 'count', v_res -> 'drivers' ->> 'count',
      v_res -> 'checklists' ->> 'count', v_res -> 'obligations' ->> 'count',
      d_brs, d_veh, d_drv, d_exe, d_obl, v_res -> 'periods') || chr(10); end if;

  -- ------------------------------------------------------------------ I2 ---
  select md5(string_agg(x::text, '|' order by x.id)) into v_md5_la2 from public.leadership_assignments x;
  select md5(string_agg(o.id::text || coalesce(o.leader_employee_id::text, '-') || o.updated_at::text, '|' order by o.id))
    into v_md5_obl2 from public.checklist_obligations o;
  select count(*) into v_audit1 from public.audit_logs;
  select p.provolatile into v_vol from pg_proc p
   where p.oid = 'public.leadership_change_impact(uuid, jsonb)'::regprocedure;
  if v_md5_la = v_md5_la2 and v_md5_obl = v_md5_obl2 and v_audit0 = v_audit1 and v_vol = 's' then
    r := r || 'PASS I2 previa nao grava nada: vinculos, obrigacoes e auditoria identicos; funcao STABLE' || chr(10);
  else r := r || format('FAIL I2 vinculos=%s obrigacoes=%s auditoria=%s->%s volatilidade=%s',
      v_md5_la = v_md5_la2, v_md5_obl = v_md5_obl2, v_audit0, v_audit1, v_vol) || chr(10); end if;

  -- ------------------------------------------------------------------ I3 ---
  set local role authenticated;
  v_res := public.leadership_change_impact(v_org, jsonb_build_object(
    'employee_id', l.employee_id, 'scope_level', 'city', 'operation_id', l.operation_id,
    'operation_city_id', l.operation_city_id, 'responsibility_type', 'substitute',
    'effective_from', v_today + 40, 'effective_to', v_today + 70));
  v_res2 := public.leadership_change_impact(v_org, jsonb_build_object(
    'id', l.id, 'employee_id', l.employee_id, 'scope_level', 'city', 'operation_id', l.operation_id,
    'operation_city_id', l.operation_city_id, 'responsibility_type', 'principal',
    'effective_from', l.effective_from, 'effective_to', null, 'notes', 'so observacao'));
  reset role;
  if not (v_res ->> 'retroactive')::boolean and not (v_res2 ->> 'retroactive')::boolean
     and (v_res -> 'brs' ->> 'count')::int = 0 then
    r := r || 'PASS I3 vinculo novo no futuro e edicao so de observacao: nao retroativos' || chr(10);
  else r := r || format('FAIL I3 futuro=%s observacao=%s', v_res ->> 'retroactive', v_res2 ->> 'retroactive') || chr(10); end if;

  -- ------------------------------------------------------------------ I4 ---
  set local role authenticated;
  begin
    perform public.save_leadership_assignment(v_org, jsonb_build_object(
      'id', l.id, 'employee_id', l.employee_id, 'scope_level', 'city', 'operation_id', l.operation_id,
      'operation_city_id', l.operation_city_id, 'responsibility_type', 'principal',
      'effective_from', v_new_from, 'effective_to', null));
    n := 0;
  exception when others then
    n := case when sqlerrm like '%Informe o motivo da correção histórica%' then 1 else -1 end;
  end;
  v_res := public.save_leadership_assignment(v_org, jsonb_build_object(
    'id', l.id, 'employee_id', l.employee_id, 'scope_level', 'city', 'operation_id', l.operation_id,
    'operation_city_id', l.operation_city_id, 'responsibility_type', 'principal',
    'effective_from', v_new_from, 'effective_to', null, 'notes', l.notes,
    'change_reason', 'Suite 16b: correcao do inicio da vigencia'));
  reset role;
  select count(*) into n2 from public.leadership_assignments
   where id = l.id and effective_from = v_new_from and change_reason = 'Suite 16b: correcao do inicio da vigencia'
     and updated_by = v_user;
  select count(*) into n3 from public.audit_logs
   where entity_type = 'public.leadership_assignments' and entity_id = l.id::text and action = 'UPDATE'
     and user_id = v_user and new_data ->> 'change_reason' = 'Suite 16b: correcao do inicio da vigencia'
     and 'effective_from' = any (changed_fields) and created_at >= now() - interval '1 minute';
  select md5(string_agg(o.id::text || coalesce(o.leader_employee_id::text, '-') || o.updated_at::text, '|' order by o.id))
    into v_md5_obl2 from public.checklist_obligations o;
  if n = 1 and (v_res ->> 'retroactive')::boolean and n2 = 1 and n3 = 1 and v_md5_obl = v_md5_obl2 then
    r := r || 'PASS I4 sem motivo recusado; com motivo grava (retroactive), motivo na linha e na auditoria com o ator real; obrigacoes ja geradas intactas' || chr(10);
  else r := r || format('FAIL I4 sem_motivo=%s retro=%s linha=%s auditoria=%s obrigacoes_intactas=%s',
      n, v_res ->> 'retroactive', n2, n3, v_md5_obl = v_md5_obl2) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 2 · Perfil, escopo e organização
--   Os perfis são simulados trocando o papel do único membro ativo DENTRO da
--   transação desfeita (com a marca das rotinas de administração de acesso).
--   A troca é um UPDATE do papel, não DELETE + INSERT: a guarda do último
--   Administrador dispara no DELETE e, com um único membro, recusaria o teste.
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_today date; v_other_op uuid; v_rand uuid := gen_random_uuid();
  l public.leadership_assignments;
  v_past jsonb; v_future jsonb; v_res jsonb; r text := ''; n int; n2 int; n3 int; n4 int; n5 int;
  v_msg text; v_msg2 text;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  v_today := private.fidelization_today();

  select la.* into l from public.leadership_assignments la
   where la.organization_id = v_org and la.status = 'active' and la.responsibility_type = 'principal'
     and la.scope_level = 'city' and la.effective_to is null and la.effective_from < v_today - 10
   order by la.effective_from, la.id limit 1;
  select o.id into v_other_op from public.operations o
   where o.organization_id = v_org and o.deleted_at is null and o.id <> l.operation_id order by o.name limit 1;

  v_past := jsonb_build_object('id', l.id, 'employee_id', l.employee_id, 'scope_level', 'city',
    'operation_id', l.operation_id, 'operation_city_id', l.operation_city_id, 'responsibility_type', 'principal',
    'effective_from', v_today - 5, 'effective_to', null, 'change_reason', 'Suite 16b');
  v_future := jsonb_build_object('employee_id', l.employee_id, 'scope_level', 'city',
    'operation_id', l.operation_id, 'operation_city_id', l.operation_city_id, 'responsibility_type', 'substitute',
    'effective_from', v_today + 40, 'effective_to', v_today + 70);

  perform set_config('hfm.access_change', 'on', true);
  delete from public.membership_operation_scopes where membership_id = v_mem;
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, l.operation_id);
  update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'lideranca_operacoes' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);

  -- ------------------------------------------------------------------ S1 ---
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.leadership_change_impact(v_org, v_past);
    n := 0;
  exception when others then
    n := case when sqlerrm like '%Corrigir dados históricos da liderança%' then 1 else -1 end; v_msg := sqlerrm;
  end;
  begin
    perform public.save_leadership_assignment(v_org, v_past);
    n2 := 0;
  exception when others then
    n2 := case when sqlerrm like '%Corrigir dados históricos da liderança%' then 1 else -1 end;
  end;
  begin
    perform public.end_leadership_assignment(l.id, v_today - 10, 'Suite 16b');
    n3 := 0;
  exception when others then
    n3 := case when sqlerrm like '%correção histórica%' then 1 else -1 end; v_msg2 := sqlerrm;
  end;
  v_res := public.leadership_change_impact(v_org, v_future);
  begin
    perform public.log_leadership_export(v_org, 'csv', 3, '{}'::jsonb);
    n4 := 1;
  exception when others then n4 := -1; end;
  reset role;
  if n = 1 and n2 = 1 and n3 = 1 and not (v_res ->> 'retroactive')::boolean and n4 = 1 then
    r := r || 'PASS S1 lideranca operacoes: previa, gravacao e encerramento no passado recusados (rotina e gatilho); futuro permitido; exporta' || chr(10);
  else r := r || format('FAIL S1 previa=%s gravar=%s encerrar=%s futuro=%s exporta=%s msg=%s / %s', n, n2, n3, v_res ->> 'retroactive', n4, v_msg, v_msg2) || chr(10); end if;

  -- ------------------------------------------------------------------ S4 ---
  -- Escopo trocado sem sessão (contexto das rotinas de administração): com a
  -- sessão do próprio membro, a guarda de escopo recusaria a troca.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('hfm.access_change', 'on', true);
  delete from public.membership_operation_scopes where membership_id = v_mem;
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_other_op);
  perform set_config('hfm.access_change', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.leadership_change_impact(v_org, v_future);
    n := 0;
  exception when others then
    n := case when sqlerrm like '%escopo%' then 1 else -1 end;
  end;
  reset role;
  if n = 1 then
    r := r || 'PASS S4 operacao fora do escopo: previa recusada' || chr(10);
  else r := r || format('FAIL S4 escopo=%s', n) || chr(10); end if;

  -- ------------------------------------------------------------------ S5 ---
  set local role authenticated;
  begin
    perform public.leadership_change_impact(v_rand, v_future);
    n := 0;
  exception when others then n := case when sqlerrm like '%permissão%' then 1 else -1 end; end;
  begin
    perform public.log_leadership_export(v_rand, 'xlsx', 1, '{}'::jsonb);
    n2 := 0;
  exception when others then n2 := case when sqlerrm like '%permissão para exportar%' then 1 else -1 end; end;
  reset role;
  if n = 1 and n2 = 1 then
    r := r || 'PASS S5 organizacao trocada: previa e exportacao recusadas' || chr(10);
  else r := r || format('FAIL S5 previa=%s exporta=%s', n, n2) || chr(10); end if;

  -- ------------------------------------------------------------------ S2 ---
  perform set_config('request.jwt.claims', '', true);
  perform set_config('hfm.access_change', 'on', true);
  delete from public.membership_operation_scopes where membership_id = v_mem;
  insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, l.operation_id);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'operacional' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  select count(*) into n5 from public.audit_logs where entity_type = 'leadership_export';
  set local role authenticated;
  begin
    perform public.log_leadership_export(v_org, 'xlsx', 1, '{}'::jsonb);
    n := 0;
  exception when others then n := case when sqlerrm like '%permissão para exportar lideranças%' then 1 else -1 end; end;
  begin
    perform public.leadership_change_impact(v_org, v_future);
    n2 := 0;
  exception when others then n2 := case when sqlerrm like '%permissão para gerenciar lideranças%' then 1 else -1 end; end;
  reset role;
  select count(*) into n3 from public.audit_logs where entity_type = 'leadership_export';
  if n = 1 and n2 = 1 and n3 = n5 then
    r := r || 'PASS S2 operacional: exportacao recusada e sem registro; previa recusada' || chr(10);
  else r := r || format('FAIL S2 exporta=%s previa=%s registros=%s->%s', n, n2, n5, n3) || chr(10); end if;

  -- ------------------------------------------------------------------ S3 ---
  perform set_config('hfm.access_change', 'on', true);
  update public.membership_roles set role_id = (
    select ro.id from public.roles ro where ro.code = 'gestao' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
     order by ro.organization_id nulls last limit 1)
   where membership_id = v_mem;
  perform set_config('hfm.access_change', '', true);
  set local role authenticated;
  begin
    perform public.log_leadership_export(v_org, 'csv', 2, '{}'::jsonb);
    n := 1;
  exception when others then n := -1; end;
  begin
    perform public.leadership_change_impact(v_org, v_future);
    n2 := 0;
  exception when others then n2 := case when sqlerrm like '%permissão para gerenciar lideranças%' then 1 else -1 end; end;
  reset role;
  if n = 1 and n2 = 1 then
    r := r || 'PASS S3 gestao: exporta, nao ve previa (sem manage)' || chr(10);
  else r := r || format('FAIL S3 exporta=%s previa=%s', n, n2) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
