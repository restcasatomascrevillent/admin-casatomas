-- =====================================================================
-- ROLLBACK de supabase/migrations/20260923140000_webhook_resend_actua_sobre_eventos.sql
-- Restaura el estado EXACTO anterior a la migración.
--
-- ATENCIÓN: ejecutar esto DESHACE lo que la migración preparó:
--   - Quita estado_entrega / estado_entrega_at / estado_entrega_detalle de
--     envios_email_reserva (con su CHECK y el índice idx_envios_resend_id).
--     El código YA desplegado de resend-webhook seguirá intentando
--     escribir en esas columnas -- volverá a fallar en silencio (try/catch,
--     ver index.ts) exactamente como si la migración nunca se hubiera
--     aplicado: el archivado en email_eventos sigue funcionando, el
--     enriquecimiento no.
--   - Borra la tabla direcciones_email_suprimidas ENTERA, con cualquier
--     dirección que se hubiera registrado desde que se aplicó la
--     migración. emails-reserva dejará de poder consultar supresiones (el
--     código ya desplegado, si lo hubiera, fallaría abierto -- ver
--     estaDireccionSuprimida en emails-reserva/index.ts: un error de
--     lectura se trata como "no suprimida", nunca bloquea el envío).
--   - Devuelve el CHECK de notificaciones_dashboard.origen a solo
--     ('reservas_web', 'emails_reserva'). Cualquier aviso ya insertado con
--     origen='resend_webhook' seguirá en la tabla (esto no borra filas de
--     notificaciones_dashboard) pero un INSERT nuevo con ese origen
--     empezará a violar el CHECK.
--
-- Usar solo si algo se rompió en producción tras aplicar la migración y
-- hay que volver atrás con prisa.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Inverso de PIEZA 3 — vuelve el CHECK de origen a los dos valores
-- originales de 20260923120000_origen_prioridad_notificaciones.sql.
-- ---------------------------------------------------------------------

alter table public.notificaciones_dashboard drop constraint if exists notificaciones_dashboard_origen_valido;
alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_origen_valido
  check (origen is null or origen in ('reservas_web', 'emails_reserva'));

-- ---------------------------------------------------------------------
-- Inverso de PIEZA 2 — borra la tabla de supresión ENTERA.
-- ---------------------------------------------------------------------

drop policy if exists "direcciones_email_suprimidas_select_seccion" on public.direcciones_email_suprimidas;
drop policy if exists "direcciones_email_suprimidas_service_role" on public.direcciones_email_suprimidas;
drop table if exists public.direcciones_email_suprimidas;

-- ---------------------------------------------------------------------
-- Inverso de PIEZA 1 — quita índice, columnas y su CHECK.
-- ---------------------------------------------------------------------

drop index if exists public.idx_envios_resend_id;

alter table public.envios_email_reserva drop constraint if exists envios_email_reserva_estado_entrega_valido;
alter table public.envios_email_reserva drop column if exists estado_entrega_detalle;
alter table public.envios_email_reserva drop column if exists estado_entrega_at;
alter table public.envios_email_reserva drop column if exists estado_entrega;

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACIÓN — ejecutar DESPUÉS de este rollback.
-- ---------------------------------------------------------------------------
--
-- select column_name from information_schema.columns
-- where table_name='envios_email_reserva' and column_name like 'estado_entrega%';
--   -- esperado: 0 filas
--
-- select table_name from information_schema.tables
-- where table_schema='public' and table_name='direcciones_email_suprimidas';
--   -- esperado: 0 filas
-- ---------------------------------------------------------------------------
