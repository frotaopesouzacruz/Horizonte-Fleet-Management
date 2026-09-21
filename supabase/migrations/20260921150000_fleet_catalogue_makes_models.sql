-- =============================================================================
-- Marcas e modelos da frota da organização
--
-- A importação de frotas não cria marca nem modelo por diferença de escrita —
-- é regra da Etapa 06, e boa: uma planilha com "Mercedes Benz" e outra com
-- "Mercedes-Benz" inventaria dois fabricantes. O efeito colateral é que, com o
-- cadastro mestre vazio, uma importação entra sem vincular nenhum dos dois.
--
-- Esta migration cadastra o que a base real de 95 veículos usa: 5 marcas e 7
-- modelos. Os nomes vêm da própria planilha, aparados e com a caixa corrigida
-- — nada foi inventado e nenhum modelo foi renomeado para outro produto:
--
--   " 417 Sprinter F"   → "417 Sprinter F"     (espaço à esquerda)
--   " 517 Sprinter F"   → "517 Sprinter F"     (espaço à esquerda)
--   "Fiorino"           → "Fiorino"            (inalterado)
--   "Polo Track Ma"     → "Polo Track"         (o "Ma" é truncamento da origem)
--   "Vm 290 6X2 R"      → "VM 290 6x2R"        (caixa e espaçamento)
--   "Vm 290 4X2R"       → "VM 290 4x2R"        (caixa)
--   " Frontier. Le X4"  → "Frontier LE X4"     (espaço, ponto solto e caixa)
--
-- Idempotente: rodar de novo não duplica nada. E, como em toda migration que
-- escolhe uma organização, não age sozinha quando há zero ou mais de uma.
-- =============================================================================

do $$
declare
  v_org   uuid;
  v_orgs  integer;
  v_make  uuid;
  v_makes integer := 0;
  v_models integer := 0;
  r       record;
begin
  select count(*) into v_orgs
    from public.organizations where deleted_at is null and status = 'active';

  if v_orgs <> 1 then
    raise notice 'Catálogo de marcas não aplicado: % organizações ativas (esperado 1).', v_orgs;
    return;
  end if;

  select id into v_org
    from public.organizations where deleted_at is null and status = 'active';

  for r in
    select *
      from (values
        ('Mercedes-Benz', '417 Sprinter F'),
        ('Mercedes-Benz', '517 Sprinter F'),
        ('Fiat',          'Fiorino'),
        ('Volkswagen',    'Polo Track'),
        ('Volvo',         'VM 290 6x2R'),
        ('Volvo',         'VM 290 4x2R'),
        ('Nissan',        'Frontier LE X4')
      ) as t(make_name, model_name)
  loop
    select id into v_make
      from public.vehicle_makes
     where organization_id = v_org and lower(name) = lower(r.make_name);

    if v_make is null then
      insert into public.vehicle_makes (organization_id, name)
      values (v_org, r.make_name)
      returning id into v_make;
      v_makes := v_makes + 1;
    end if;

    if not exists (
      select 1 from public.vehicle_models
       where organization_id = v_org
         and vehicle_make_id = v_make
         and lower(name) = lower(r.model_name)
    ) then
      insert into public.vehicle_models (organization_id, vehicle_make_id, name)
      values (v_org, v_make, r.model_name);
      v_models := v_models + 1;
    end if;
  end loop;

  raise notice 'Catálogo da frota: % marcas e % modelos cadastrados.', v_makes, v_models;
end $$;
