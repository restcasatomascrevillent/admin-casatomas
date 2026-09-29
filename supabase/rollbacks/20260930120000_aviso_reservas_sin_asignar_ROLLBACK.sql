-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260930120000_aviso_reservas_sin_asignar.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- (psql / SQL editor) y solo para deshacer un despliegue que salio mal.
--
-- QUE REVIERTE (en este orden):
--   1. Quita el job pg_cron 'reservas-aviso-sin-asignar' (primero, para que
--      no llame a una funcion ya borrada).
--   2. Borra public.fn_avisar_reservas_sin_asignar().
--   3. Borra la tabla public.avisos_reserva_enviados.
--
-- QUE SE PIERDE: el libro de avisos ya emitidos. Aceptado en el diseno: si
-- se reaplica la migracion, las reservas sin asignar que sigan dentro de la
-- ventana vuelven a avisar UNA vez.
--
-- NO borra las notificaciones 'reserva_sin_asignar' ya creadas en
-- notificaciones_dashboard (son del personal: se leen o se borran desde la
-- campana). Si se quieren quitar:
--   delete from public.notificaciones_dashboard where tipo = 'reserva_sin_asignar';
--
-- No toca reservas, espacio_id, asignaciones_mesa ni configuracion_reservas
-- (las columnas asignacion_* son de 20260930110000).
-- ===========================================================================

begin;

select cron.unschedule('reservas-aviso-sin-asignar') where exists (
  select 1 from cron.job where jobname = 'reservas-aviso-sin-asignar'
);

drop function if exists public.fn_avisar_reservas_sin_asignar();

drop table if exists public.avisos_reserva_enviados;

commit;

-- VERIFICACION:
--   select count(*) from cron.job where jobname = 'reservas-aviso-sin-asignar';   -- 0
--   select to_regclass('public.avisos_reserva_enviados');                          -- null
