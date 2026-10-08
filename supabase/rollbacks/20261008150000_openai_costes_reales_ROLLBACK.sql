set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261008150000_openai_costes_reales.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO,
-- POR TERMINAL (no en el SQL Editor):
--   npx supabase db query --linked -f supabase/rollbacks/20261008150000_openai_costes_reales_ROLLBACK.sql
--
-- ANTES: revertir el panel si ya llama a gasto_ia_real_resumen /
-- tipo_cambio_usd_eur_actual (sin ellas la pantalla pierde el gasto real; el
-- estimado de ia_uso no depende de esto). Quita el cron
-- «sincronizar-costes-openai», las funciones y las tres tablas (SE PIERDEN los
-- costes sincronizados y el mapeo proyecto → proceso: volver a aplicar la
-- migración y esperar a la siguiente sincronización los recupera; el mapeo hay
-- que rehacerlo). La Edge Function desplegada empezará a fallar al escribir:
-- bórrala (supabase functions delete sincronizar-costes-openai) o ignora el
-- error. Las claves por proceso (OPENAI_API_KEY_OCR / _CHAT) no tienen
-- relación con la base de datos.
-- Imprime «openai_costes_reales: revertida | 0».
-- ===========================================================================

begin;
set local lock_timeout = '5s';

select cron.unschedule('sincronizar-costes-openai')
 where exists (select 1 from cron.job where jobname = 'sincronizar-costes-openai');

drop function if exists public.openai_despachar_sincronizacion_costes();
drop function if exists public.gasto_ia_real_resumen(integer);
drop function if exists public.tipo_cambio_usd_eur_actual();
drop function if exists public.ia_proceso_de_funcion(text);

drop table if exists public.openai_costes_diarios;
drop table if exists public.openai_proyectos;
drop table if exists public.tipo_cambio_usd_eur;

commit;

select 'openai_costes_reales: revertida' as resultado,
       (select count(*) from pg_proc where proname in ('gasto_ia_real_resumen', 'tipo_cambio_usd_eur_actual',
          'ia_proceso_de_funcion', 'openai_despachar_sincronizacion_costes'))
       + (select count(*) from cron.job where jobname = 'sincronizar-costes-openai') as objetos_que_quedan;
