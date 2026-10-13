-- =============================================================================
-- IMPORTAÇÃO · CAIXA DE ENTRADA POR API E STATUS DIÁRIO DO HFC
--
-- 1. Status diário do HFC. O relatório "Status Diário Aderência" do HFC usa
--    rótulos que a leitura do histórico de Check List não conhecia:
--    "Fez Check List Retorno" (com ou sem "· fora da elegibilidade") e
--    "Herdado da Saída — <motivo>" (o retorno herda o expurgo da saída). Eles
--    passam a ser lidos como o status equivalente. Nenhum status novo é criado.
--
-- 2. Caixa de entrada de importação por API (`import_mailbox_*`). Uma carga
--    grande (dezenas de milhares de linhas, respostas de checklist) pode ser
--    enviada em partes por HTTP, sem passar pelo navegador:
--      · quem tem a permissão de importar do módulo ABRE uma caixa
--        (`import_mailbox_open`) e recebe um token de uso único, com prazo;
--      · as partes entram por `import_mailbox_put` (token + sequência +
--        conteúdo), que só grava — não lê nada, não cria lote, não decide;
--      · a importação oficial do módulo lê as partes da caixa e segue a sua
--        própria esteira (prévia, validação, gravação), com o mesmo usuário
--        que abriu a caixa. A caixa não cria caminho paralelo: é só o
--        transporte.
--    O token nunca é guardado em claro (só o SHA-256); expira; a caixa aceita
--    um número máximo de partes e um tamanho máximo por parte; depois de lida,
--    é esvaziada (`import_mailbox_purge`) e o registro fica como trilha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Status diário do HFC → código
-- -----------------------------------------------------------------------------
create or replace function private.checklist_history_status_code(p_status text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when s in ('FEZ', 'FEZCHECKLIST', 'FEZCHECK', 'REALIZADO', 'REALIZOU', 'EXECUTADO', 'OK', 'SIM', 'FEITO',
               'FEZCHECKLISTRETORNO', 'FEZCHECKLISTRETORNOFORADAELEGIBILIDADE', 'FEZCHECKLISTSAIDA') then 'FEZ'
    when s in ('NAOFEZ', 'NAOFEZCHECKLIST', 'NAOFEZCHECK', 'PENDENTE', 'NAO', 'NF', 'NAOREALIZADO', 'NAOREALIZOU',
               'NAOFEZCHECKLISTRETORNO', 'NAOFEZCHECKLISTSAIDA') then 'NAO_FEZ'
    when s in ('SEMROTA', 'HERDADODASAIDASEMROTA') then 'SEM_ROTA'
    when s in ('MANUTENCAO', 'EMMANUTENCAO', 'MANUT', 'OFICINA', 'HERDADODASAIDAMANUTENCAO') then 'MANUTENCAO'
    when s in ('RESERVA', 'FROTARESERVA', 'RESERVANAOESCALADA', 'HERDADODASAIDAFROTARESERVA', 'HERDADODASAIDARESERVA') then 'RESERVA'
    when s in ('EMVIAGEM', 'VIAGEM', 'HERDADODASAIDAEMVIAGEM') then 'EM_VIAGEM'
    when s in ('FROTANAOATIVA', 'NAOATIVA', 'NAOATIVO', 'INATIVO', 'INATIVA', 'DESATIVADO', 'FROTAINATIVA',
               'HERDADODASAIDAFROTANAOATIVA') then 'FROTA_NAO_ATIVA'
    when s in ('OUTROS', 'OUTRO', 'HERDADODASAIDAOUTROS') then 'OUTROS'
    else null end
  from (select regexp_replace(upper(translate(coalesce(p_status, ''),
          'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCAAAAEEIOOOUUC')), '[^A-Z0-9]', '', 'g') as s) x;
$$;
revoke execute on function private.checklist_history_status_code(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Caixa de entrada
-- -----------------------------------------------------------------------------
create table if not exists private.import_mailbox_uploads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  permission_code  text not null,
  token_hash       bytea not null,
  max_chunks       integer not null default 200 check (max_chunks between 1 and 2000),
  max_chunk_bytes  integer not null default 4194304 check (max_chunk_bytes between 1024 and 16777216),
  received_chunks  integer not null default 0,
  received_bytes   bigint not null default 0,
  expires_at       timestamptz not null,
  closed_at        timestamptz,
  purged_at        timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists import_mailbox_uploads_token_idx on private.import_mailbox_uploads (token_hash);
create index if not exists import_mailbox_uploads_org_idx on private.import_mailbox_uploads (organization_id, created_at desc);
comment on table private.import_mailbox_uploads is
  'Caixa de entrada de importação por API: uma carga enviada em partes por HTTP com token de uso único. Só transporte; a importação oficial do módulo lê daqui.';

create table if not exists private.import_mailbox_chunks (
  upload_id    uuid not null references private.import_mailbox_uploads(id) on delete cascade,
  seq          integer not null check (seq >= 1),
  payload      jsonb,
  bytes        integer not null,
  received_at  timestamptz not null default now(),
  primary key (upload_id, seq)
);

revoke all on private.import_mailbox_uploads from public, anon, authenticated;
revoke all on private.import_mailbox_chunks from public, anon, authenticated;

-- Abre uma caixa. Exige a permissão de importação do módulo (sempre uma
-- permissão "*.import"); devolve o token UMA vez — só o hash fica gravado.
create or replace function public.import_mailbox_open(
  p_organization_id uuid, p_name text, p_permission_code text,
  p_max_chunks integer default 200, p_max_chunk_bytes integer default 4194304, p_ttl_minutes integer default 180)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sessão necessária.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_permission_code, '') !~ '^[a-z_.]+\.import$' then
    raise exception 'Informe a permissão de importação do módulo (por exemplo adherence.import).' using errcode = 'invalid_parameter_value';
  end if;
  if not private.has_permission(p_organization_id, p_permission_code) then
    raise exception 'Você não possui permissão para importar neste módulo.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Informe o nome da carga.' using errcode = 'invalid_parameter_value';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + make_interval(mins => least(greatest(coalesce(p_ttl_minutes, 180), 5), 1440));
  insert into private.import_mailbox_uploads
    (organization_id, name, permission_code, token_hash, max_chunks, max_chunk_bytes, expires_at, created_by)
  values
    (p_organization_id, btrim(p_name), p_permission_code, extensions.digest(v_token, 'sha256'),
     least(greatest(coalesce(p_max_chunks, 200), 1), 2000), least(greatest(coalesce(p_max_chunk_bytes, 4194304), 1024), 16777216),
     v_exp, auth.uid())
  returning id into v_id;
  return jsonb_build_object('upload_id', v_id, 'token', v_token, 'expires_at', v_exp);
end;
$$;
revoke execute on function public.import_mailbox_open(uuid, text, text, integer, integer, integer) from public, anon;
grant execute on function public.import_mailbox_open(uuid, text, text, integer, integer, integer) to authenticated;

-- Recebe uma parte. Só grava: não lê dados da organização, não cria lote,
-- não decide nada. Reenviar a mesma sequência substitui a parte. É a única
-- rotina da caixa aberta a chamadas sem sessão: o token é a credencial.
create or replace function public.import_mailbox_put(p_token text, p_seq integer, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_up    private.import_mailbox_uploads;
  v_bytes integer;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    perform pg_sleep(0.3);
    raise exception 'Token inválido ou expirado.' using errcode = 'invalid_authorization_specification';
  end if;
  select u.* into v_up from private.import_mailbox_uploads u
   where u.token_hash = extensions.digest(p_token, 'sha256')
   for update;
  if v_up.id is null or v_up.closed_at is not null or v_up.expires_at < now() then
    perform pg_sleep(0.3);
    raise exception 'Token inválido ou expirado.' using errcode = 'invalid_authorization_specification';
  end if;
  if p_seq is null or p_seq < 1 or p_seq > v_up.max_chunks then
    raise exception 'Sequência fora do limite da caixa (1 a %).', v_up.max_chunks using errcode = 'invalid_parameter_value';
  end if;
  if p_payload is null then
    raise exception 'Conteúdo vazio.' using errcode = 'invalid_parameter_value';
  end if;
  v_bytes := pg_column_size(p_payload);
  if v_bytes > v_up.max_chunk_bytes then
    raise exception 'Parte maior que o permitido (% bytes).', v_up.max_chunk_bytes using errcode = 'invalid_parameter_value';
  end if;
  insert into private.import_mailbox_chunks (upload_id, seq, payload, bytes)
  values (v_up.id, p_seq, p_payload, v_bytes)
  on conflict (upload_id, seq) do update set payload = excluded.payload, bytes = excluded.bytes, received_at = now();
  update private.import_mailbox_uploads u
     set received_chunks = (select count(*) from private.import_mailbox_chunks c where c.upload_id = u.id),
         received_bytes = (select coalesce(sum(c.bytes), 0) from private.import_mailbox_chunks c where c.upload_id = u.id)
   where u.id = v_up.id
   returning u.received_chunks into v_up.received_chunks;
  return jsonb_build_object('upload_id', v_up.id, 'seq', p_seq, 'received_chunks', v_up.received_chunks);
end;
$$;
revoke execute on function public.import_mailbox_put(text, integer, jsonb) from public;
grant execute on function public.import_mailbox_put(text, integer, jsonb) to anon, authenticated;

-- Fecha a caixa (nenhuma parte entra depois) e devolve o resumo. Só quem abriu.
create or replace function public.import_mailbox_close(p_upload_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_up private.import_mailbox_uploads;
begin
  update private.import_mailbox_uploads u
     set closed_at = coalesce(u.closed_at, now())
   where u.id = p_upload_id and u.created_by = auth.uid()
   returning u.* into v_up;
  if v_up.id is null then
    raise exception 'Caixa não encontrada.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('upload_id', v_up.id, 'name', v_up.name, 'received_chunks', v_up.received_chunks,
                            'received_bytes', v_up.received_bytes, 'closed_at', v_up.closed_at,
                            'missing', (select coalesce(jsonb_agg(s), '[]'::jsonb) from generate_series(1, v_up.received_chunks) s
                                         where not exists (select 1 from private.import_mailbox_chunks c where c.upload_id = v_up.id and c.seq = s)));
end;
$$;
revoke execute on function public.import_mailbox_close(uuid) from public, anon;
grant execute on function public.import_mailbox_close(uuid) to authenticated;

-- Esvazia o conteúdo depois de lido; o registro da caixa fica como trilha.
create or replace function private.import_mailbox_purge(p_upload_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  update private.import_mailbox_chunks set payload = null where upload_id = p_upload_id and payload is not null;
  get diagnostics n = row_count;
  update private.import_mailbox_uploads set purged_at = now(), closed_at = coalesce(closed_at, now()) where id = p_upload_id;
  return n;
end;
$$;
revoke execute on function private.import_mailbox_purge(uuid) from public, anon, authenticated;
