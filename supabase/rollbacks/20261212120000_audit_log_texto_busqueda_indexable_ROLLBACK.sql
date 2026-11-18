set client_encoding = 'UTF8';
-- Vuelta atrás de 20261212120000_audit_log_texto_busqueda_indexable (no toca datos): la vista vuelve a calcular
-- `texto_busqueda` con `concat_ws`, como en 20261013082609. La búsqueda encuentra lo mismo pero deja de usar el
-- índice idx_audit_log_busqueda y vuelve a ser lenta.
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
  concat_ws(' ', a.actor_label, a.tabla, a.detalles->>'pregunta', a.detalles->>'respuesta', a.detalles->'despues'->>'nombre', a.detalles->'antes'->>'nombre', a.detalles->'despues'->>'contenido', a.detalles->'antes'->>'contenido', a.detalles->'despues'->>'content', a.detalles->'antes'->>'content', a.detalles->>'operacion') AS texto_busqueda
FROM public.audit_log a
WHERE public.audit_tabla_util(a.tabla) OR (a.tabla='conversaciones' AND a.accion IN ('crear','eliminar'));
REVOKE ALL ON public.audit_log_visible FROM PUBLIC, anon;
GRANT SELECT ON public.audit_log_visible TO authenticated, service_role;

COMMIT;
