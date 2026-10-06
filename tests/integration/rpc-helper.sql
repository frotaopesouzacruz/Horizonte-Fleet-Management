-- Apoio dos testes de integração (SOMENTE em banco local de teste, nunca em
-- produção): chama uma rotina pública pelo nome com argumentos nomeados em
-- JSON, sob as claims informadas, e devolve {data} ou {error:{code,message,hint}}
-- — o mesmo contrato que o PostgREST entrega ao cliente supabase-js.
create schema if not exists hfm_test;

create or replace function hfm_test.rpc(p_fn text, p_args jsonb, p_claims jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_names text[]; v_types text[]; v_ret text; v_list text := ''; k text; i int; v_res jsonb;
  v_state text; v_msg text; v_hint text;
begin
  select p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t), format_type(p.prorettype, null)
    into v_names, v_types, v_ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_fn
   order by p.pronargs desc limit 1;
  if v_names is null then raise exception 'rotina % inexistente', p_fn; end if;
  for k in select jsonb_object_keys(p_args) loop
    i := array_position(v_names, k);
    if i is null then raise exception 'argumento % inexistente em %', k, p_fn; end if;
    v_list := v_list || case when v_list = '' then '' else ', ' end ||
      format('%I => %s', k, case when jsonb_typeof(p_args -> k) = 'null' then format('null::%s', v_types[i])
                                 when v_types[i] in ('jsonb', 'json') then format('%L::%s', (p_args -> k)::text, v_types[i])
                                 else format('%L::%s', p_args ->> k, v_types[i]) end);
  end loop;
  perform set_config('request.jwt.claims', p_claims::text, true);
  execute format('set local role %I', coalesce(p_claims ->> 'role', 'authenticated'));
  begin
    if v_ret = 'void' then
      execute format('select public.%I(%s)', p_fn, v_list);
      v_res := 'null'::jsonb;
    else
      execute format('select to_jsonb(public.%I(%s))', p_fn, v_list) into v_res;
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    execute 'reset role';
    return jsonb_build_object('error', jsonb_build_object('code', v_state, 'message', v_msg, 'hint', nullif(v_hint, '')));
  end;
  execute 'reset role';
  return jsonb_build_object('data', v_res);
end;
$$;
