-- =============================================================================
-- Etapa 16 — Manutenção · correções encontradas pela suíte remota 20
--
-- 1. Padrões de perfil que não chegaram aos papéis.
--    A fundação inseriu os padrões em DOIS comandos: primeiro Administrador e
--    Gestor de Frota com o módulo inteiro, depois Gestão, Liderança de
--    Operações e Segurança com um subconjunto. O gatilho
--    `access_profile_defaults_sync` roda por comando e é conservador de
--    propósito: só entrega um código que a organização NUNCA viu em papel
--    nenhum. O primeiro comando fez a organização "ver" os 20 códigos; o
--    segundo, então, não entregou nada. Resultado: Gestão, Liderança e
--    Segurança ficaram sem nenhuma permissão de manutenção.
--
--    A correção entrega os padrões da Manutenção só a papéis que hoje não têm
--    NENHUMA permissão `maintenance.*` — um papel nessa situação nunca teve o
--    módulo, então não há retirada deliberada a respeitar. Papel que já tem
--    alguma permissão do módulo (foi customizado) não é tocado. Nada aqui
--    altera o Perfil de Acesso de pessoa alguma: muda o que o papel pode, não
--    quem tem qual papel.
--
-- 2. Ordem da trilha dentro de uma transação.
--    `maintenance_events.occurred_at` usava `now()`, que é o início da
--    transação: eventos gravados na mesma transação (abertura + agendamento
--    pela importação, por exemplo) empatavam e a trilha podia sair fora de
--    ordem. Passa a usar `clock_timestamp()`, a hora real de cada gravação.
--    Só muda o padrão da coluna; nenhuma linha existente é reescrita.
-- =============================================================================

do $$
begin
  perform private.access_change_begin();

  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
    from public.roles r
    join public.access_profile_defaults d on d.profile_code = r.code
    join public.permissions p on p.code = d.permission_code
   where r.deleted_at is null
     and r.organization_id is not null
     and p.module = 'maintenance'
     and not exists (
       select 1 from public.role_permissions rp
         join public.permissions px on px.id = rp.permission_id
        where rp.role_id = r.id and px.module = 'maintenance')
  on conflict do nothing;

  perform set_config('hfm.access_change', '', true);
end $$;

alter table public.maintenance_events alter column occurred_at set default clock_timestamp();

comment on column public.maintenance_events.occurred_at is
  'Hora real da gravação do evento (clock_timestamp): eventos da mesma transação mantêm a ordem em que aconteceram.';
