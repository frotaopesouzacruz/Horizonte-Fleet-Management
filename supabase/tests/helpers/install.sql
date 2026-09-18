-- =============================================================================
-- HFM test harness
--
-- Creates a `tests` schema with the assertion helpers used by every test file.
-- Each test file runs inside BEGIN ... ROLLBACK, so the schema, the helpers and
-- every row they create disappear when the test ends. Nothing persists.
--
-- Run a file with psql / `supabase test db`, or paste the flattened output of
-- `supabase/tests/build_script.sh <file>` into any SQL console.
-- =============================================================================

create schema if not exists tests;

-- Per-transaction result collector.
create or replace function tests.init() returns void language plpgsql as $$
begin
  create temp table if not exists t_results (
    seq serial primary key, name text not null, ok boolean not null, detail text
  );
  truncate t_results restart identity;
  execute 'grant select, insert on t_results to authenticated, anon, service_role';
  execute 'grant usage, select on sequence t_results_seq_seq to authenticated, anon, service_role';
end; $$;

-- assert(condition)
create or replace function tests.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
    using p_name, coalesce(p_ok, false), p_detail;
end; $$;

-- assert the statement fails (optionally with a specific SQLSTATE)
create or replace function tests.throws(p_name text, p_sql text, p_state text default null)
returns void language plpgsql as $$
begin
  execute p_sql;
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
    using p_name, false, 'expected an error, statement succeeded';
exception when others then
  if p_state is null or sqlstate = p_state then
    execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
      using p_name, true, sqlstate || ' ' || sqlerrm;
  else
    execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
      using p_name, false, format('expected %s got %s: %s', p_state, sqlstate, sqlerrm);
  end if;
end; $$;

-- assert the statement succeeds
create or replace function tests.lives(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)' using p_name, true, null::text;
exception when others then
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
    using p_name, false, sqlstate || ' ' || sqlerrm;
end; $$;

-- assert the statement affects exactly N rows (RLS hides rows instead of raising)
create or replace function tests.rows_affected(p_name text, p_sql text, p_expected int)
returns void language plpgsql as $$
declare v_rows int;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
    using p_name, v_rows = p_expected, format('rows=%s expected=%s', v_rows, p_expected);
exception when others then
  execute 'insert into t_results (name, ok, detail) values ($1,$2,$3)'
    using p_name, false, sqlstate || ' ' || sqlerrm;
end; $$;

-- Creates an auth user (development/test databases only). The password hash is
-- a throwaway constant: these rows never leave the test transaction.
create or replace function tests.new_user(p_email text, p_full_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
  values
    (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     extensions.crypt('test-only-not-a-real-password', extensions.gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', coalesce(p_full_name, p_email)), now(), now(), false, false);
  return v_id;
end; $$;

-- Impersonation: mirrors what PostgREST does for an API request.
create or replace function tests.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role','authenticated','aud','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end; $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end; $$;

create or replace function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end; $$;

-- Back to the privileged session (migrations / maintenance context).
create or replace function tests.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;

-- Failures first, then the totals.
create or replace function tests.report()
returns table (result text) language plpgsql as $$
begin
  return query execute $q$
    select line from (
      select seq as ord,
             format('%s %s - %s%s', case when ok then 'ok' else 'NOT OK' end, seq, name,
                    case when ok or detail is null then '' else ' >> ' || replace(detail, chr(10), ' ') end) as line
      from t_results where not ok
      union all
      select 2147483647,
             format('TOTAL: %s passed, %s failed',
                    count(*) filter (where ok), count(*) filter (where not ok))
      from t_results
    ) x order by ord
  $q$;
end; $$;

grant usage on schema tests to authenticated, anon, service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;
