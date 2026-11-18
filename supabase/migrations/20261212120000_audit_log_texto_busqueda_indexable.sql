set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261212120000_audit_log_texto_busqueda_indexable — la búsqueda de Auditoría usa su índice (18/11/2026)
-- ===========================================================================
-- Igual que la vista de 20261013082609_bloquear_acceso_usuarios con un solo
-- cambio: `texto_busqueda` se calcula con `||` y `coalesce` en vez de
-- `concat_ws`, con la expresión exacta del índice de trigramas
-- idx_audit_log_busqueda (20261212110000), para que el `ilike` del buscador lo
-- use. Busca lo mismo que antes (mismos campos; donde faltaba uno queda un
-- espacio de más, que no cambia lo que encuentra). Las columnas van por nombre
-- en vez de `a.*` para que una columna nueva en audit_log no rompa el
-- `create or replace` (las 15 de hoy, en el mismo orden).
--
-- Lanza ANTES 20261212110000 (el índice); sin él esto funciona, pero la
-- búsqueda sigue lenta.
-- Vuelta atrás: supabase/rollbacks/20261212120000_audit_log_texto_busqueda_indexable_ROLLBACK.sql.
BEGIN;

CREATE OR REPLACE VIEW public.audit_log_visible WITH (security_invoker = true) AS
SELECT a.id, a.created_at, a.actor_user_id, a.actor_email, a.accion, a.tabla, a.registro_id, a.detalles, a.user_agent,
  a.actor_label, a.actor_origin, a.device_id, a.ip_address, a.request_id, a.session_id,
  CASE
    WHEN a.accion='ejecutar' AND a.detalles->>'tipo_evento' IS NOT NULL THEN a.detalles->>'tipo_evento'
    WHEN a.tabla='conversaciones' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'crear_chat_ia' END
    WHEN a.tabla='mensajes_chat' THEN CASE WHEN a.accion='eliminar' THEN 'eliminar_chat_ia' ELSE 'mensaje_ia' END
    WHEN a.tabla='user_permissions' THEN 'cambiar_permisos'
    WHEN a.tabla IN ('user_roles','super_admins') THEN 'cambiar_roles'
    WHEN a.accion='actualizar' AND a.tabla='auth.users'
      AND (a.detalles->'antes'->'banned_until') IS DISTINCT FROM (a.detalles->'despues'->'banned_until')
      THEN CASE WHEN nullif(a.detalles->'despues'->>'banned_until','')::timestamptz > a.created_at
        THEN 'bloquear_acceso' ELSE 'desbloquear_acceso' END
    WHEN a.detalles->>'credenciales_actualizadas'='true' THEN 'cambiar_credenciales'
    WHEN a.accion='actualizar' AND a.tabla='cheques_regalo' AND (
      (a.detalles->'antes'->'usado') IS DISTINCT FROM (a.detalles->'despues'->'usado') OR
      (a.detalles->'antes'->'canjeado_en') IS DISTINCT FROM (a.detalles->'despues'->'canjeado_en')) THEN 'canjear_cheque'
    WHEN a.accion='actualizar' AND (a.detalles->'antes'->'precio_eur') IS DISTINCT FROM (a.detalles->'despues'->'precio_eur') THEN 'cambiar_precio'
    WHEN a.accion='actualizar' AND (a.detalles->'antes'->'activado') IS DISTINCT FROM (a.detalles->'despues'->'activado') THEN 'cambiar_visibilidad'
    ELSE a.accion
  END AS tipo_evento,
  CASE WHEN a.accion IN ('login_fallido','acceso_denegado') THEN 'fallida' ELSE coalesce(a.detalles->>'resultado','completada') END AS resultado,
  a.accion NOT IN ('acceso','intento_login') AS visible_por_defecto,
  -- Misma expresión que el índice idx_audit_log_busqueda (20261212110000): no cambiar una sin la otra.
  coalesce(a.actor_label, '') || ' '
  || coalesce(a.tabla, '') || ' '
  || coalesce(a.detalles ->> 'pregunta', '') || ' '
  || coalesce(a.detalles ->> 'respuesta', '') || ' '
  || coalesce(a.detalles -> 'despues' ->> 'nombre', '') || ' '
  || coalesce(a.detalles -> 'antes' ->> 'nombre', '') || ' '
  || coalesce(a.detalles -> 'despues' ->> 'contenido', '') || ' '
  || coalesce(a.detalles -> 'antes' ->> 'contenido', '') || ' '
  || coalesce(a.detalles -> 'despues' ->> 'content', '') || ' '
  || coalesce(a.detalles -> 'antes' ->> 'content', '') || ' '
  || coalesce(a.detalles ->> 'operacion', '')
  AS texto_busqueda
FROM public.audit_log a
WHERE public.audit_tabla_util(a.tabla) OR (a.tabla='conversaciones' AND a.accion IN ('crear','eliminar'));
REVOKE ALL ON public.audit_log_visible FROM PUBLIC, anon;
GRANT SELECT ON public.audit_log_visible TO authenticated, service_role;

COMMIT;
