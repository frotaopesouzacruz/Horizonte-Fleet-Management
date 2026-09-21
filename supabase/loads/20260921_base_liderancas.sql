-- =============================================================================
-- Carga da Base Lideranças (planilha oficial do PO) — competências jan–set/2026
--
-- A planilha é um retrato MENSAL: Mês · Tipo Operação · Gestor · Local de
-- Operação, 198 linhas. O módulo não guarda mês: `docs/modules/leadership.md`
-- fixa que "a competência (ano/mês) é uma janela sobre os períodos, nunca uma
-- coluna". Então as 198 linhas viram 27 períodos de vigência — um por
-- (operação, cidade, líder) contíguo —, dos quais 21 entraram aqui.
--
-- A troca de julho é o que torna a conversão interessante: Vitor Souza Silva
-- responde por 5 cidades de Last Mille MG até junho e some a partir de julho,
-- quando Divinópolis e Mariana passam a Walace e Montes Claros, Pouso Alegre e
-- Varginha passam a Rodrigo. No modelo de vigência isso é um período fechado e
-- outro aberto, não duas linhas soltas.
--
-- NÃO ENTRARAM 6 períodos (39 das 198 linhas), porque o gestor não existe no
-- cadastro de colaboradores e uma carga não inventa gente:
--   · Vitor Souza Silva      — 5 cidades de Last Mille MG, jan–jun
--   · Leandro Carvalho Silva — Belém, jan–set (a operação tem 6 colaboradores
--                              no cadastro, todos motoristas; o supervisor não
--                              veio na base do QLP)
--
-- Premissas assumidas, ambas reversíveis:
--   · ano 2026 (a planilha traz só o nome do mês; set/2026 é o mês corrente);
--   · períodos que seguem em setembro ficam EM ABERTO, porque o vínculo
--     continua valendo — não se encerram em 30/09.
--
-- Tudo passa por `public.save_leadership_assignment`, nunca por INSERT direto:
-- é o que aplica permissão, a exclusividade do principal por escopo e a
-- auditoria. Rodou primeiro em ensaio com rollback (21/21, sem avisos).
-- =============================================================================
do $x$
declare
  v_org   uuid;
  v_user  uuid;
  r       record;
  v_emp   uuid; v_op uuid; v_oc uuid;
  v_res   jsonb;
  n_ok    int := 0;
  avisos  text := '';
begin
  select id into v_org from public.organizations
   where deleted_at is null and status = 'active' order by created_at limit 1;
  select user_id into v_user from public.organization_memberships
   where organization_id = v_org and status = 'active' limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  for r in
    select * from (values
    ('Last Mille MG', 'Contagem', 'Walace Rocha de Souza', date '2026-01-01', null::date),
    ('Last Mille MG', 'Divinopolis', 'Walace Rocha de Souza', date '2026-07-01', null::date),
    ('Last Mille MG', 'Governador Valadares', 'Rodrigo Correa', date '2026-01-01', null::date),
    ('Last Mille MG', 'Ipatinga', 'Rodrigo Correa', date '2026-01-01', null::date),
    ('Last Mille MG', 'Itabira', 'Walace Rocha de Souza', date '2026-01-01', null::date),
    ('Last Mille MG', 'Juiz de Fora', 'Rodrigo Correa', date '2026-01-01', null::date),
    ('Last Mille MG', 'Manhuaçu', 'Rodrigo Correa', date '2026-01-01', null::date),
    ('Last Mille MG', 'Mariana', 'Walace Rocha de Souza', date '2026-07-01', null::date),
    ('Last Mille MG', 'Montes Claros', 'Rodrigo Correa', date '2026-07-01', null::date),
    ('Last Mille MG', 'Patos de Minas', 'Daniela Chaves Mariano', date '2026-01-01', null::date),
    ('Last Mille MG', 'Pouso Alegre', 'Rodrigo Correa', date '2026-07-01', null::date),
    ('Last Mille MG', 'Uberaba', 'Daniela Chaves Mariano', date '2026-01-01', null::date),
    ('Last Mille MG', 'Uberlândia', 'Daniela Chaves Mariano', date '2026-01-01', null::date),
    ('Last Mille MG', 'Varginha', 'Rodrigo Correa', date '2026-07-01', null::date),
    ('Merchandising', 'Brasilia', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Merchandising', 'Campo Grande', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Merchandising', 'Contagem', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Merchandising', 'Cuiaba', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Merchandising', 'Goiania', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Merchandising', 'Uberlândia', 'Flaviano Lucio Dos Santos', date '2026-01-01', null::date),
    ('Redespacho - MG', 'Contagem', 'Marco Vieira Dos Santos', date '2026-01-01', null::date)
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
     where e.organization_id = v_org and e.deleted_at is null
       and lower(translate(e.full_name,'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucaaaaeeiooouuc'))
         = lower(translate(r.gestor,'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucaaaaeeiooouuc'));

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
      'notes',               'Base Lideranças (planilha oficial), competências Jan a Set/2026.'));

    n_ok := n_ok + 1;
    if jsonb_array_length(coalesce(v_res -> 'warnings', '[]'::jsonb)) > 0 then
      avisos := avisos || format('  %s / %s / %s -> %s', r.op_nome, r.cidade, r.gestor, v_res -> 'warnings') || chr(10);
    end if;
  end loop;

  raise notice E'RESULTADO\nresponsabilidades gravadas: %\navisos:\n%', n_ok,
    coalesce(nullif(avisos, ''), '  (nenhum)');
end $x$;
