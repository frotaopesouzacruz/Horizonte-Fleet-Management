-- =============================================================================
-- Carga complementar do QLP: dois líderes INATIVOS e as 6 vigências que
-- ficaram de fora da carga da Base Lideranças (20260921_base_liderancas.sql).
--
-- A base oficial de lideranças atribui Vitor Souza Silva a 5 cidades de Last
-- Mille MG (jan–jun/2026) e Leandro Carvalho Silva a Belém (jan–set/2026).
-- Nenhum dos dois estava no cadastro de colaboradores porque o QLP importado
-- só trazia gente ativa; a planilha complementar do PO (01_QLP - Copia) traz os
-- dois como INATIVOS, e é assim que entram: colaborador inativo, sem e-mail,
-- sem conta de acesso, sem perfil de acesso — só o que é preciso para que as
-- vigências históricas apontem para uma pessoa real.
--
-- Mapeamentos assumidos (confirmados com o PO):
--   · operação "Redespacho - Belém" da planilha  = "Redespacho - Belém/Pa" no HFM;
--   · localidade "Belém Do Pará"                 = local de trabalho já existente;
--   · cargo "187 - Supervisor De Operacoes Jr", área "Administrativo", perfil de
--     negócio "Liderança Operações", filiais 87 e 124 e o líder imediato já
--     existem — o script resolve tudo por código/nome e falha se algo não bater.
--
-- O que NÃO entra, de propósito (minimização de dados, LGPD): CPF, data de
-- nascimento e CNH. São colaboradores inativos, sem função no sistema além de
-- responder pelo histórico; a matrícula já garante a unicidade e evita que uma
-- reimportação do QLP os duplique. Se algum dia forem reativados, o cadastro se
-- completa pela tela de Usuários.
--
-- Vigências: Vitor fecha em 30/06 (Walace e Rodrigo assumem em 01/07, já
-- carregados). Leandro segue a premissa da carga anterior — período que continua
-- em setembro fica EM ABERTO —, mesmo estando inativo: a base não traz sucessor
-- nem data de saída, e inventar uma seria pior do que mostrar o fato. A RPC
-- avisa (não bloqueia) que o colaborador não está ativo; o aviso é esperado.
--
-- Tudo passa pelas RPCs (`save_employee`, `save_leadership_assignment`), nunca
-- por INSERT direto: é o que aplica permissão, validação e auditoria.
-- Idempotente: se a matrícula já existir, o script para sem gravar nada.
-- Ensaio: rodar com `select set_config('hfm.dry_run', '1', true);` antes —
-- o bloco termina em exceção com o resumo e nada é gravado.
-- =============================================================================
do $x$
declare
  v_org    uuid;
  v_user   uuid;
  v_dry    boolean := coalesce(current_setting('hfm.dry_run', true), '') = '1';
  r        record;
  v_emp    uuid; v_op uuid; v_oc uuid;
  v_cargo  uuid; v_area uuid; v_perfil uuid; v_filial uuid; v_local uuid; v_lider uuid;
  v_res    jsonb;
  n_emp    int := 0;
  n_la     int := 0;
  avisos   text := '';
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select user_id into v_user from public.organization_memberships
   where organization_id = v_org and status = 'active' limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  if exists (select 1 from public.employees
              where organization_id = v_org and employee_code in ('140539', '290000')) then
    raise exception 'Carga ja aplicada: matricula 140539 ou 290000 ja existe.';
  end if;

  select id into v_cargo  from public.job_positions
   where organization_id = v_org and code = '187';
  select id into v_area   from public.employment_areas
   where organization_id = v_org and name = 'Administrativo';
  select id into v_perfil from public.business_profiles
   where organization_id = v_org and name = 'Liderança Operações';
  select id into v_lider  from public.employees
   where organization_id = v_org and deleted_at is null
     and full_name = 'Rodrigo De Souza Mantovani';
  if v_cargo is null or v_area is null or v_perfil is null or v_lider is null then
    raise exception 'Referencia nao resolvida: cargo=% area=% perfil=% lider=%',
      v_cargo, v_area, v_perfil, v_lider;
  end if;

  -- ------------------------------------------------------------ colaboradores
  for r in
    select * from (values
      ('140539', 'Vitor Souza Silva',      date '2025-06-20', 'Last Mille MG',         '87',  'Contagem'),
      ('290000', 'Leandro Carvalho Silva', date '2024-06-03', 'Redespacho - Belém/Pa', '124', 'Belém Do Pará')
    ) as t(matricula, nome, admissao, op_nome, filial_cod, localidade)
  loop
    select id into v_op from public.operations
     where organization_id = v_org and deleted_at is null and name = r.op_nome;
    select id into v_filial from public.organization_units
     where organization_id = v_org and code = r.filial_cod;
    select id into v_local from public.work_locations
     where organization_id = v_org and name = r.localidade;
    if v_op is null or v_filial is null or v_local is null then
      raise exception 'Referencia nao resolvida para %: operacao=% filial=% localidade=%',
        r.nome, v_op, v_filial, v_local;
    end if;

    v_emp := public.save_employee(v_org, jsonb_build_object(
      'employee_code',     r.matricula,
      'full_name',         r.nome,
      'employment_status', 'inactive',
      'admission_date',    to_char(r.admissao, 'YYYY-MM-DD'),
      'notes',             'Cadastro histórico a partir do QLP (planilha do PO, set/2026). '
                           'Colaborador inativo, registrado para vincular as vigências de liderança da Base Lideranças.',
      'assignment', jsonb_build_object(
        'job_position_id',      v_cargo,
        'employment_area_id',   v_area,
        'operation_id',         v_op,
        'organization_unit_id', v_filial,
        'work_location_id',     v_local,
        'business_profile_id',  v_perfil,
        'manager_employee_id',  v_lider)));
    n_emp := n_emp + 1;
  end loop;

  -- --------------------------------------------------------------- vigências
  for r in
    select * from (values
      ('Last Mille MG',         'Divinopolis',   'Vitor Souza Silva',      date '2026-01-01', date '2026-06-30'),
      ('Last Mille MG',         'Mariana',       'Vitor Souza Silva',      date '2026-01-01', date '2026-06-30'),
      ('Last Mille MG',         'Montes Claros', 'Vitor Souza Silva',      date '2026-01-01', date '2026-06-30'),
      ('Last Mille MG',         'Pouso Alegre',  'Vitor Souza Silva',      date '2026-01-01', date '2026-06-30'),
      ('Last Mille MG',         'Varginha',      'Vitor Souza Silva',      date '2026-01-01', date '2026-06-30'),
      ('Redespacho - Belém/Pa', 'Belém',         'Leandro Carvalho Silva', date '2026-01-01', null::date)
    ) as t(op_nome, cidade, gestor, ini, fim)
  loop
    v_op := null; v_oc := null; v_emp := null;

    select o.id into v_op from public.operations o
     where o.organization_id = v_org and o.name = r.op_nome and o.deleted_at is null;

    select oc.id into v_oc
      from public.operation_cities oc
      join public.cities c on c.id = oc.city_id
     where oc.operation_id = v_op
       and lower(translate(c.name,'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucaaaaeeiooouuc'))
         = lower(translate(r.cidade,'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucaaaaeeiooouuc'));

    select e.id into v_emp from public.employees e
     where e.organization_id = v_org and e.deleted_at is null and e.full_name = r.gestor;

    if v_op is null or v_oc is null or v_emp is null then
      raise exception 'Nao resolveu: operacao=% cidade=% gestor=% (op=% cidade=% emp=%)',
        r.op_nome, r.cidade, r.gestor, v_op, v_oc, v_emp;
    end if;

    v_res := public.save_leadership_assignment(v_org, jsonb_build_object(
      'employee_id',         v_emp,
      'scope_level',         'city',
      'operation_id',        v_op,
      'operation_city_id',   v_oc,
      'responsibility_type', 'principal',
      'effective_from',      to_char(r.ini, 'YYYY-MM-DD'),
      'effective_to',        case when r.fim is null then null else to_char(r.fim, 'YYYY-MM-DD') end,
      'notes',               'Base Lideranças (planilha oficial), competências Jan a Set/2026. '
                             'Gestor cadastrado como colaborador inativo a partir do QLP.'));

    n_la := n_la + 1;
    if jsonb_array_length(coalesce(v_res -> 'warnings', '[]'::jsonb)) > 0 then
      avisos := avisos || format('  %s / %s / %s -> %s', r.op_nome, r.cidade, r.gestor, v_res -> 'warnings') || chr(10);
    end if;
  end loop;

  if v_dry then
    raise exception E'ENSAIO (nada gravado)\ncolaboradores: %\nresponsabilidades: %\navisos:\n%',
      n_emp, n_la, coalesce(nullif(avisos, ''), '  (nenhum)');
  end if;

  raise notice E'RESULTADO\ncolaboradores: %\nresponsabilidades: %\navisos:\n%',
    n_emp, n_la, coalesce(nullif(avisos, ''), '  (nenhum)');
end $x$;
