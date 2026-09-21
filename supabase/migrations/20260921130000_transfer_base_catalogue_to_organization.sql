-- =============================================================================
-- O catálogo base de tipos de equipamento passa a pertencer à organização
--
-- A Etapa 07 manteve `vehicle_types.organization_id is null` como catálogo base
-- compartilhado da plataforma: visível para todas as organizações e editável
-- por nenhuma, porque renomear um tipo compartilhado mudaria o catálogo das
-- outras. A regra está certa para uma plataforma com várias empresas.
--
-- Só que esta instalação tem uma organização, e todos os 6 tipos e 17
-- subcategorias que ela enxerga são do catálogo base. Na prática o cadastro
-- inteiro nasce somente leitura: o administrador abre qualquer tipo e encontra
-- nome e descrição bloqueados, sem nada que ele possa editar de fato.
--
-- Esta migration transfere o catálogo para a organização. Depois dela os tipos
-- são dela: podem ser renomeados, descritos, ter subcategorias criadas e
-- renomeadas, e ser inativados — pelas mesmas rotinas e com as mesmas
-- permissões de sempre. Nada em RBAC, RLS ou tenancy é afrouxado.
--
-- Por que é seguro agora: não há nenhum veículo cadastrado, então nenhum
-- veículo muda de classificação. Os `id` dos tipos não mudam, e tudo que os
-- referencia (parametrização, vínculos de operação, regras de módulo) continua
-- apontando para as mesmas linhas.
--
-- Consequência aceita: a plataforma deixa de ter catálogo base. Uma segunda
-- organização, quando existir, começará com o catálogo vazio e criará os seus
-- próprios tipos — ou receberá uma cópia, numa etapa que decida isso.
--
-- Os códigos não mudam. `van`, `truck` e os demais continuam como estão, porque
-- o código de um tipo é imutável depois de criado e essa garantia não se
-- suspende por conveniência. Tipos novos seguem recebendo `EQ-00001` em diante.
--
-- Em um ambiente com zero ou mais de uma organização ativa, a transferência não
-- se aplica sozinha: a migration avisa e não faz nada, porque escolher a
-- organização dona do catálogo não é decisão de script.
-- =============================================================================

do $$
declare
  v_org   uuid;
  v_orgs  integer;
  v_types integer;
  v_subs  integer;
begin
  select count(*) into v_orgs
    from public.organizations
   where deleted_at is null and status = 'active';

  if v_orgs <> 1 then
    raise notice
      'Catálogo base preservado: % organizações ativas (a transferência exige exatamente 1).',
      v_orgs;
    return;
  end if;

  select id into v_org
    from public.organizations
   where deleted_at is null and status = 'active';

  -- Os dois gatilhos impedem que um registro troque de organização em tempo de
  -- execução, que é uma proteção de tenancy e continua valendo depois daqui.
  -- Uma migration é o único lugar onde essa transferência é uma decisão
  -- deliberada e auditável, e não um efeito colateral de alguma tela.
  alter table public.vehicle_types         disable trigger vehicle_types_code_immutable;
  alter table public.vehicle_subcategories disable trigger vehicle_subcategories_prevent_tenant_change;

  update public.vehicle_types
     set organization_id = v_org
   where organization_id is null;
  get diagnostics v_types = row_count;

  update public.vehicle_subcategories
     set organization_id = v_org
   where organization_id is null;
  get diagnostics v_subs = row_count;

  alter table public.vehicle_types         enable trigger vehicle_types_code_immutable;
  alter table public.vehicle_subcategories enable trigger vehicle_subcategories_prevent_tenant_change;

  raise notice 'Catálogo transferido: % tipos e % subcategorias agora pertencem a %.',
    v_types, v_subs, v_org;
end $$;
