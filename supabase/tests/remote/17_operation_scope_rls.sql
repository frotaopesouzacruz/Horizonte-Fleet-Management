-- =============================================================================
-- 17 · RLS por operação avaliada uma vez por consulta, e o relógio da Aderência
--
-- Migration 20260924160000_operation_scope_rls_performance. Suíte transacional
-- contra o banco COM DADOS; cada bloco termina em `raise exception
-- 'ROLLBACK_TESTES …'` DE PROPÓSITO — nada do que ela troca sobrevive.
--
-- O que cada bloco protege:
--   Bloco 1 (quem vê o quê não mudou)
--   E1  Para cada perfil — o atual (Administrador), Liderança Operações com
--       escopo em UMA operação, Liderança Operações sem escopo, Gestão e
--       Operacional — e para cada tabela cuja política foi reescrita
--       (checklist_obligations, checklist_executions, leadership_assignments,
--       operation_brs): o conjunto de linhas que a política NOVA mostra à
--       pessoa é exatamente o conjunto que o predicado ANTIGO
--       (`private.can_access_operation(operation_id)`) aceitava. O antigo é
--       avaliado como `postgres` (que ignora RLS) com a identidade da pessoa;
--       o novo, como `authenticated`.
--   Bloco 2 (a view dá o mesmo resultado)
--   V1  `adherence_obligation_status` tem uma linha por obrigação ativa (o
--       relógio por organização não descarta nem duplica linha)
--   V2  `today` de cada linha = `private.adherence_today(organização)`
--   V3  `status_code` e `is_due` = o cálculo por linha da definição anterior
--   Bloco 3 (desempenho)
--   T1  Como a pessoa real, a sequência summary + heatmap + matrix + monthly +
--       insights + return_tracking do mês corrente cabe em 4 s — antes, só o
--       insights levava ~13 s e a página estourava o limite de 8 s.
--   Os perfis são simulados trocando o papel do único membro ativo DENTRO da
--   transação desfeita, com a marca das rotinas de administração de acesso;
--   a troca é UPDATE (a guarda do último Administrador dispara no DELETE).
-- =============================================================================

-- =============================================================================
-- Bloco 1 · E1
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_mem uuid; v_op uuid; v_admin_role uuid;
  r text := ''; p text; tbl text; v_old text; v_new text; n_old int; n_new int;
  v_profiles text[] := array['atual', 'lideranca_escopo', 'gestao', 'operacional', 'lideranca_sem_escopo'];
  v_tables text[] := array['checklist_obligations', 'checklist_executions', 'leadership_assignments', 'operation_brs'];
  v_fail int := 0; v_checks int := 0;
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m.user_id, m.id into v_user, v_mem from public.organization_memberships m
   where m.organization_id = v_org and m.status = 'active' and m.employee_id is not null limit 1;
  select mr.role_id into v_admin_role from public.membership_roles mr where mr.membership_id = v_mem limit 1;
  -- A operação com mais obrigações: o escopo de uma operação só vale se corta alguma coisa.
  select o.operation_id into v_op from public.checklist_obligations o
   where o.organization_id = v_org and o.operation_id is not null
   group by o.operation_id order by count(*) desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  foreach p in array v_profiles loop
    -- Monta o perfil (como postgres, com a marca de administração de acesso).
    perform set_config('hfm.access_change', 'on', true);
    if p = 'lideranca_escopo' then
      -- O escopo entra enquanto a pessoa ainda é Administrador: a guarda exige
      -- que QUEM altera o escopo possa fazê-lo.
      delete from public.membership_operation_scopes where membership_id = v_mem;
      insert into public.membership_operation_scopes (organization_id, membership_id, operation_id) values (v_org, v_mem, v_op);
      update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
      update public.membership_roles set role_id = (
        select ro.id from public.roles ro where ro.code = 'lideranca_operacoes' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
         order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
    elsif p in ('gestao', 'operacional') then
      update public.membership_roles set role_id = (
        select ro.id from public.roles ro where ro.code = p and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
         order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
    elsif p = 'lideranca_sem_escopo' then
      -- Tirar o escopo é, de novo, coisa de administrador da plataforma (a
      -- guarda recusa a pessoa mexer no próprio escopo): volta, tira, revoga.
      update public.membership_roles set role_id = v_admin_role where membership_id = v_mem;
      update public.platform_admins set revoked_at = null where user_id = v_user and revoked_at = now();
      delete from public.membership_operation_scopes where membership_id = v_mem;
      update public.platform_admins set revoked_at = now() where user_id = v_user and revoked_at is null;
      update public.membership_roles set role_id = (
        select ro.id from public.roles ro where ro.code = 'lideranca_operacoes' and (ro.organization_id = v_org or ro.organization_id is null) and ro.deleted_at is null
         order by ro.organization_id nulls last limit 1) where membership_id = v_mem;
    end if;
    perform set_config('hfm.access_change', '', true);

    foreach tbl in array v_tables loop
      -- Antigo: o predicado da política anterior, sem RLS, com a identidade da pessoa.
      if tbl = 'checklist_obligations' then
        select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) into n_old, v_old
          from public.checklist_obligations
         where organization_id in (select private.permitted_org_ids('adherence.view'))
           and private.can_access_operation(operation_id);
      elsif tbl = 'leadership_assignments' then
        select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) into n_old, v_old
          from public.leadership_assignments
         where organization_id in (select private.permitted_org_ids('leadership.view'))
           and private.can_access_operation(operation_id);
      elsif tbl = 'operation_brs' then
        select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) into n_old, v_old
          from public.operation_brs
         where (organization_id in (select private.permitted_org_ids('fidelization.view'))
                or organization_id in (select private.permitted_org_ids('leadership.view')))
           and private.can_access_operation(operation_id);
      else
        select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) into n_old, v_old
          from public.checklist_executions e
         where (e.organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_own'))
                and e.employee_id in (select m.employee_id from public.organization_memberships m
                                       where m.user_id = auth.uid() and m.organization_id = e.organization_id and m.status = 'active'))
            or (e.organization_id in (select private.permitted_org_ids('applications.checklist_fleet.view_details'))
                and private.can_access_operation(e.operation_id));
      end if;

      -- Novo: o que a política mostra à pessoa.
      set local role authenticated;
      execute format('select count(*), md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.%I', tbl)
        into n_new, v_new;
      reset role;

      v_checks := v_checks + 1;
      if n_old <> n_new or v_old <> v_new then
        v_fail := v_fail + 1;
        r := r || format('FAIL E1 %s/%s antigo=%s novo=%s', p, tbl, n_old, n_new) || chr(10);
      else
        r := r || format('     E1 %s/%s: %s linha(s) nos dois', p, tbl, n_new) || chr(10);
      end if;
    end loop;
  end loop;

  if v_fail = 0 then
    r := format('PASS E1 %s comparacoes (5 perfis x 4 tabelas): a politica nova mostra exatamente o que a antiga aceitava', v_checks) || chr(10) || r;
  end if;
  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 2 · V1–V3
-- =============================================================================
do $t$
declare
  r text := ''; n_view int; n_active int; n_today int; n_status int; n_due int;
begin
  select count(*) into n_view from public.adherence_obligation_status;
  select count(*) into n_active from public.checklist_obligations where is_active;
  if n_view = n_active and n_view > 0 then
    r := r || format('PASS V1 uma linha por obrigacao ativa (%s)', n_view) || chr(10);
  else r := r || format('FAIL V1 view=%s ativas=%s', n_view, n_active) || chr(10); end if;

  select count(*) into n_today from public.adherence_obligation_status s
   where s.today is distinct from private.adherence_today(s.organization_id);
  if n_today = 0 then r := r || 'PASS V2 hoje de cada linha = adherence_today(organizacao)' || chr(10);
  else r := r || format('FAIL V2 %s linha(s) com outro dia', n_today) || chr(10); end if;

  select count(*) filter (where s.status_code is distinct from private.adherence_status_code(
           s.is_done, s.decision_effect, s.status_code_applied, s.checklist_context,
           s.operational_date, private.adherence_today(s.organization_id), s.deadline_at, now())),
         count(*) filter (where s.is_due is distinct from (case
           when coalesce(s.decision_effect = 'exclude', false) and not s.is_done then false
           when s.is_done then true
           when s.operational_date <= private.adherence_today(s.organization_id)
                and (s.checklist_context = 'saida' or now() >= s.deadline_at) then true
           else false end))
    into n_status, n_due
    from public.adherence_obligation_status s;
  if n_status = 0 and n_due = 0 then r := r || 'PASS V3 status e devida iguais ao calculo por linha' || chr(10);
  else r := r || format('FAIL V3 status=%s devida=%s', n_status, n_due) || chr(10); end if;

  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;

-- =============================================================================
-- Bloco 3 · T1
-- =============================================================================
do $t$
declare
  v_org uuid; v_user uuid; v_today date; y int; m int; d0 date; d1 date;
  t0 timestamptz; ms int; j jsonb; r text := '';
begin
  select id into v_org from public.organizations where deleted_at is null and status = 'active' order by created_at limit 1;
  select m2.user_id into v_user from public.organization_memberships m2
   where m2.organization_id = v_org and m2.status = 'active' and m2.employee_id is not null limit 1;
  v_today := private.adherence_today(v_org);
  y := extract(year from v_today)::int; m := extract(month from v_today)::int;
  d0 := make_date(y, m, 1); d1 := (d0 + interval '1 month - 1 day')::date;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t0 := clock_timestamp();
  j := public.adherence_summary(v_org, d0, d1, 'saida', '{}'::jsonb, 'operation');
  j := public.adherence_heatmap(v_org, y, m, 'saida', '{}'::jsonb);
  j := public.adherence_matrix(v_org, y, m, 'saida', '{}'::jsonb, 1, 50);
  j := public.adherence_monthly(v_org, y, 'saida', '{}'::jsonb);
  j := public.adherence_insights(v_org, y, m, 'saida', '{}'::jsonb);
  j := public.adherence_return_tracking(v_org, d0, d1, '{}'::jsonb, 200);
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  reset role;
  if ms < 4000 then r := r || format('PASS T1 seis RPCs da Aderencia em %s ms (limite 4000)', ms) || chr(10);
  else r := r || format('FAIL T1 %s ms', ms) || chr(10); end if;
  raise exception E'ROLLBACK_TESTES\n%', r;
end $t$;
