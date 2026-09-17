-- =============================================================================
-- HFM test helpers (loaded by each test file; safe to run repeatedly)
-- Plain SQL/plpgsql, TAP output — runs with `supabase test db` (pg_prove) and
-- through any SQL console. Every test file runs inside a transaction that is
-- rolled back, so nothing persists.
-- =============================================================================

create temp table if not exists t_results (
  seq    serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);
grant select, insert on t_results to authenticated, anon, service_role;
grant usage, select on sequence t_results_seq_seq to authenticated, anon, service_role;

-- t_check(name, condition, detail)
create or replace function pg_temp.t_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- t_throws(name, sql, expected_sqlstate_or_null): passes when the statement fails
create or replace function pg_temp.t_throws(p_name text, p_sql text, p_state text default null)
returns void language plpgsql as $$
begin
  execute p_sql;
  insert into t_results (name, ok, detail) values (p_name, false, 'expected an error, statement succeeded');
exception when others then
  if p_state is null or sqlstate = p_state then
    insert into t_results (name, ok, detail) values (p_name, true, sqlstate || ' ' || sqlerrm);
  else
    insert into t_results (name, ok, detail)
    values (p_name, false, format('expected %s got %s: %s', p_state, sqlstate, sqlerrm));
  end if;
end;
$$;

-- t_lives(name, sql): passes when the statement succeeds
create or replace function pg_temp.t_lives(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  insert into t_results (name, ok, detail) values (p_name, true, null);
exception when others then
  insert into t_results (name, ok, detail) values (p_name, false, sqlstate || ' ' || sqlerrm);
end;
$$;

-- t_rows(name, dml, expected_rows): passes when the DML affects exactly N rows
create or replace function pg_temp.t_rows(p_name text, p_sql text, p_expected int)
returns void language plpgsql as $$
declare v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  insert into t_results (name, ok, detail)
  values (p_name, v_rows = p_expected, format('rows=%s expected=%s', v_rows, p_expected));
exception when others then
  insert into t_results (name, ok, detail) values (p_name, false, sqlstate || ' ' || sqlerrm);
end;
$$;

-- t_user(email): creates an auth user (dev/test databases only) and returns its id
create or replace function pg_temp.t_user(p_email text, p_full_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
  values
    (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     extensions.crypt('test-password-not-real', extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', coalesce(p_full_name, p_email)), now(), now(), false, false);
  return v_id;
end;
$$;

-- t_as(user_id): impersonate an authenticated user for the rest of the transaction
create or replace function pg_temp.t_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- t_as_anon(): impersonate the anon role
create or replace function pg_temp.t_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- t_as_service(): impersonate service_role (bypasses RLS)
create or replace function pg_temp.t_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- t_reset(): back to the session owner with no JWT
create or replace function pg_temp.t_reset()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- pg_temp functions are executable by PUBLIC (default), so impersonated roles can call them.

-- t_tap(): TAP report (trailing plan)
create or replace function pg_temp.t_tap()
returns setof text language sql as $$
  select line from (
    select seq as ord,
           format('%s %s - %s%s',
                  case when ok then 'ok' else 'not ok' end, seq, name,
                  case when ok or detail is null then '' else E'\n# ' || replace(detail, E'\n', ' ') end) as line
    from t_results
    union all
    select 2147483647, '1..' || count(*) from t_results
    union all
    select 2147483646,
           format('# %s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok))
    from t_results
  ) x order by ord;
$$;
