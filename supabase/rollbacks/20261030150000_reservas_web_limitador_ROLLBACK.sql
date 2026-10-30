-- ROLLBACK de migrations/20261030150000_reservas_web_limitador.sql (CT-REM-FN-07).
-- A mano. ANTES, volver a desplegar la versión anterior de reservas-web: la
-- nueva falla en cerrado (503) sin estas RPC.
-- Efecto: /reservas-web/crear vuelve a no tener límite por IP ni cupo diario
-- y los correos de rechazo vuelven a enviarse sin tope por dirección.
begin;
drop function if exists public.reservas_web_reservar_correo_rechazo(text);
drop function if exists public.reservas_web_reservar_cupo(text);
drop table if exists public.reservas_web_correos_rechazo;
drop table if exists public.reservas_web_intentos;
alter table public.configuracion_reservas
  drop constraint if exists configuracion_reservas_limite_web_crear_ip_hora_check,
  drop constraint if exists configuracion_reservas_limite_web_crear_dia_check,
  drop column if exists limite_web_crear_ip_hora,
  drop column if exists limite_web_crear_dia;
commit;
