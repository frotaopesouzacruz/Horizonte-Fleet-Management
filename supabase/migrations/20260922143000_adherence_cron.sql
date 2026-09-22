-- =============================================================================
-- Etapa 11 — Aderência: a rotina programada (§38)
--
-- A base de referência não depende de ninguém abrir página. O pg_cron roda
-- dentro do banco, a cada 15 minutos, `private.adherence_cron_tick()`: gera as
-- obrigações de ontem/hoje/horizonte para cada organização ativa e consome o
-- outbox pendente da Etapa 12. Cada rodada fica em `adherence_runs`.
--
-- A conciliação em si não espera a rotina: o gatilho `outbox_adherence_consume`
-- concilia o checklist na transação em que ele é enviado. A rotina é a rede
-- de segurança (retry) e a materialização diária.
-- =============================================================================
create extension if not exists pg_cron;

grant usage on schema cron to postgres;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'hfm_adherence_tick' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule('hfm_adherence_tick', '*/15 * * * *', $$select private.adherence_cron_tick();$$);
