-- ===========================================================================
--  Tráfico web tras la migración de cuenta · columna `datos_desde`
--
--  Sin aplicar: la aplica el dueño (demo primero). Va ANTES de desplegar la
--  versión de sync-trafico-web que la lee (index.ts pide `datos_desde`), y las
--  dos ANTES de activar Web Analytics en Vercel (ver abajo por qué).
--
--  Por qué: desde el corte (27-10-2026) la sincronización falla cada noche con
--  "Vercel 400 (by=day): Web Analytics is not enabled for this project": los
--  proyectos nuevos de Vercel (web-casatomas, touza-casatomas, equipo "Casa
--  tomas") se crearon con Web Analytics apagado y Vercel no guarda visitas.
--  Cuando se active, la API devolverá los días anteriores RELLENOS con 0, y la
--  función los guardaría como "0 visitas" en vez de dejarlos como hueco
--  (en el panel, NULL = sin datos).
--
--  `datos_desde` = primer día en que Vercel puede tener datos del proyecto.
--  La función lo sube al día de cada intento que encuentra Web Analytics
--  apagado y no pide nada anterior. Aquí se siembra con el mayor de:
--    · 2026-11-01: ese día (~07:20 UTC) se comprobó con la API de Vercel que
--      los dos proyectos nuevos tenían Web Analytics desactivado.
--    · el día del último intento que falló por ese motivo (PROD: 2026-11-01).
--  Nunca baja un valor ya puesto. Se puede corregir a mano:
--    update public.trafico_web_sync_estado set datos_desde = '<día>' where proyecto = '<slug>';
--
--  Idempotente. Rollback: supabase/rollbacks/20261101093700_trafico_web_datos_desde_ROLLBACK.sql
-- ===========================================================================

begin;

alter table public.trafico_web_sync_estado
  add column if not exists datos_desde date;

comment on column public.trafico_web_sync_estado.datos_desde is
  'Primer dia (UTC) en que Vercel puede tener datos del proyecto. sync-trafico-web no pide dias anteriores (con Web Analytics apagado Vercel no guarda nada y la API los devolveria como 0) y lo sube al dia de cada intento que encuentra Web Analytics desactivado. NULL = sin suelo propio (solo PRIMER_DIA del codigo).';

with suelo as (
  select proyecto,
         greatest(
           datos_desde,
           date '2026-11-01',
           case
             when ultimo_error ~* '(web_analytics_not_enabled|web analytics is not enabled)'
               then (ultimo_intento_en at time zone 'UTC')::date
           end
         ) as nuevo
    from public.trafico_web_sync_estado
)
update public.trafico_web_sync_estado e
   set datos_desde = s.nuevo
  from suelo s
 where s.proyecto = e.proyecto
   and e.datos_desde is distinct from s.nuevo;

commit;
