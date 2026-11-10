set client_encoding = 'UTF8';
-- ===========================================================================
-- JUEVES DE TAPAS: EL LOCAL ABRE, SIN RESERVAS WEB (dueño, 2026-11-10)
-- ===========================================================================
-- Petición: «En el calendario de la sección de reservas los jueves aparece
-- cerrado y están abiertos». Decisión del dueño: «Abierto, sin reservas web»:
-- el jueves se ve ABIERTO en el panel, pero la web y el bot telefónico siguen
-- SIN coger reservas ese día.
--
-- CAUSA: no es un fallo de fechas. La migración 20261013120000_cierres_reserva
-- guardó la regla «sin reservas por web/teléfono» del 13/10 (lunes, JUEVES
-- —día de tapas— y domingo noche) en configuracion_reservas
-- (dias_cerrados_comida {1,4}, dias_cerrados_cena {0,1,4}), y el panel pintaba
-- esos servicios como «Cerrado» aunque el local abra.
--
-- QUÉ HACE (solo añade; la regla de los canales NO cambia)
--   · Columna `dias_abiertos_sin_reserva_online int[]` (0 = domingo … 6 =
--     sábado): días en que el local ABRE aunque la regla semanal no coja
--     reservas web/teléfono. La rellena con {4} (jueves) si la regla actual
--     cierra el jueves en los dos servicios.
--   · NO toca dias_cerrados_comida/cena, ni `cierres_reserva`, ni la RPC
--     `servicios_cerrados_reserva`: reservas-web (la web) y el bot siguen
--     recibiendo el jueves como no reservable, exactamente igual que antes.
--   · Solo el PANEL lee la columna (calendario, pop-up del día y alta de
--     reserva: `separarCierres` en supabase/functions/_shared/cierres.ts) para
--     enseñar el jueves abierto con «Sin reservas web» y sin aviso de cierre.
--     Si la columna aún no existe, el panel ya supone {4}.
--
-- Idempotente. Vuelta atrás:
--   supabase/rollbacks/20261122103000_jueves_abiertos_sin_reserva_web_ROLLBACK.sql
-- Prueba (PGlite): npm run test:jueves-abiertos:db
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'configuracion_reservas'
      and column_name = 'dias_cerrados_comida'
  ) then
    raise exception 'Falta la migración 20261013120000_cierres_reserva.sql (dias_cerrados_comida no existe): aplíquela antes.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'configuracion_reservas'
      and column_name = 'dias_abiertos_sin_reserva_online'
  ) then
    alter table public.configuracion_reservas
      add column dias_abiertos_sin_reserva_online integer[] not null default '{}';
    -- Solo la primera vez: el jueves de tapas, si la regla lo deja sin reservas todo el día.
    update public.configuracion_reservas
    set dias_abiertos_sin_reserva_online = '{4}'
    where 4 = any (dias_cerrados_comida) and 4 = any (dias_cerrados_cena);
  end if;
end $$;

comment on column public.configuracion_reservas.dias_abiertos_sin_reserva_online is
  'Días de la semana (0=domingo…6=sábado) en que el local ABRE aunque la regla (dias_cerrados_*) no coja reservas por web/teléfono (jueves de tapas). Solo lo usa el panel; los canales siguen con servicios_cerrados_reserva.';

alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_dias_abiertos_sin_online_validos;
alter table public.configuracion_reservas
  add constraint configuracion_reservas_dias_abiertos_sin_online_validos
  check (dias_abiertos_sin_reserva_online <@ array[0,1,2,3,4,5,6]);

commit;
