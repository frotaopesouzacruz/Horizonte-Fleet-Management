-- =============================================================================
-- private.tg_sync_vehicle_unit — tirar e repor a filial no mesmo dia
--
-- Defeito do gatilho criado em 20260922115000, encontrado pelo próprio teste
-- dele. Ao limpar a filial de um veículo cuja linha de vigência começou hoje, o
-- gatilho encerrava a linha em `effective_to = effective_from` — isto é, um dia
-- de duração, hoje. Correto como histórico, e fatal para o que vem depois:
-- atribuir uma filial de novo no mesmo dia tentava abrir `[hoje, ∞)`, que
-- sobrepõe `[hoje, hoje]`, e a constraint `vehicle_unit_no_overlap` derrubava a
-- gravação com um erro cru do PostgreSQL.
--
-- Não é hipótese de laboratório: é alguém que apaga a filial no formulário de
-- frota, percebe o engano e escolhe a certa antes de salvar de novo.
--
-- A correção troca o eixo da decisão. Em vez de procurar "a linha aberta", o
-- gatilho procura **a linha que cobre hoje** — aberta ou fechada — e só então
-- decide. Uma linha que começou hoje é a de hoje: ela é corrigida no lugar, que
-- é o que o dia ainda permite. Uma linha que começou antes é passado: essa se
-- encerra ontem e a nova começa hoje.
--
-- Observação para quem mexer nisto depois: linhas com início no futuro não são
-- produzidas por nenhum caminho do produto — `transfer_vehicle_branch` recusa
-- data futura desde 20260922115000, justamente porque ninguém promove uma linha
-- agendada. Se um dia existirem, este gatilho precisará considerá-las.
-- =============================================================================

create or replace function private.tg_sync_vehicle_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur record;
begin
  if tg_op = 'INSERT' and new.organization_unit_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.organization_unit_id is not distinct from old.organization_unit_id then
    return null;
  end if;

  -- A linha que responde por hoje, esteja ela aberta ou já encerrada hoje.
  select * into v_cur
    from public.vehicle_unit_assignments
   where vehicle_id = new.id
     and effective_from <= current_date
     and (effective_to is null or effective_to >= current_date)
   order by effective_from desc
   limit 1
   for update;

  -- `transfer_vehicle_branch` insere a linha certa antes de tocar na coluna:
  -- aqui não há nada a fazer, e mexer nela violaria o período.
  if v_cur.id is not null
     and v_cur.organization_unit_id = new.organization_unit_id
     and v_cur.effective_to is null then
    return null;
  end if;

  if new.organization_unit_id is null then
    if v_cur.id is null or v_cur.effective_to is not null then
      return null;                                   -- já não há vínculo aberto
    end if;
    if v_cur.effective_from >= current_date then
      update public.vehicle_unit_assignments
         set effective_to = v_cur.effective_from     -- durou o dia de hoje
       where id = v_cur.id;
    else
      update public.vehicle_unit_assignments
         set effective_to = current_date - 1
       where id = v_cur.id;
    end if;
    return null;
  end if;

  if v_cur.id is not null and v_cur.effective_from >= current_date then
    -- Começou hoje: hoje ainda se corrige. Reabre na filial nova em vez de
    -- empilhar uma segunda linha no mesmo dia.
    update public.vehicle_unit_assignments
       set organization_unit_id = new.organization_unit_id,
           effective_to         = null
     where id = v_cur.id;
    return null;
  end if;

  if v_cur.id is not null and v_cur.effective_to is null then
    update public.vehicle_unit_assignments
       set effective_to = current_date - 1
     where id = v_cur.id;
  end if;

  insert into public.vehicle_unit_assignments
    (organization_id, vehicle_id, organization_unit_id, effective_from, reason)
  values
    (new.organization_id, new.id, new.organization_unit_id, current_date,
     'Filial definida pelo Cadastro de Frotas.');

  return null;
end;
$$;

revoke execute on function private.tg_sync_vehicle_unit() from public, anon;

comment on function private.tg_sync_vehicle_unit() is
  'Mantém vehicle_unit_assignments em dia quando vehicles.organization_unit_id '
  'é escrito fora de transfer_vehicle_branch (§34). Decide pela linha que cobre '
  'hoje: a que começou hoje é corrigida no lugar, a anterior encerra ontem.';
