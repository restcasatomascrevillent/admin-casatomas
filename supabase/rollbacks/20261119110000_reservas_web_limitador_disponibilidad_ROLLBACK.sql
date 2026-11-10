-- ROLLBACK de migrations/20261119110000_reservas_web_limitador_disponibilidad.sql (CT-REM-FN-07b).
-- A mano. La función reservas-web usa este cupo FALLANDO EN ABIERTO, así que
-- deshacerlo NO rompe /disponibilidad: simplemente vuelve a no tener límite por
-- IP. No hace falta redesplegar la función antes (al revés que el de /crear).
begin;
drop function if exists public.reservas_web_reservar_cupo_disponibilidad(text);
drop table if exists public.reservas_web_intentos_disponibilidad;
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_limite_web_disp_ip_hora_check,
  drop constraint if exists configuracion_reservas_limite_web_disp_dia_check,
  drop column if exists limite_web_disponibilidad_ip_hora,
  drop column if exists limite_web_disponibilidad_dia;
commit;
