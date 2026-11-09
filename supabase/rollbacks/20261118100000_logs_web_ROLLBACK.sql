-- ROLLBACK de 20261118100000_logs_web.sql (Super Admin › Logs).
-- Aplicar a mano SOLO si hay que deshacerlo, y DESPUÉS de los rollbacks de
-- 20261118100200 (cron) y 20261118100100 (triggers de reservas y cheques).
-- Borra TODOS los eventos, sesiones, incidencias (con su enlace a Linear),
-- resúmenes de IA y la configuración de Logs. No toca Linear (los tickets ya
-- creados siguen allí), ni ningún secreto, ni otras tablas.
-- La lista de exclusión de auditoría conserva los nombres web_* (inofensivo).
-- Las Edge Functions registrar-actividad-web / procesar-logs-web sin tablas
-- responden 503 y la web sigue funcionando (el rastreador descarta en silencio).
begin;
drop function if exists public.web_logs_fallos_cron(timestamptz);
drop function if exists public.web_incidencia_pedir_ticket(bigint);
drop function if exists public.web_comportamiento(date, date, text, boolean);
drop function if exists public.web_comportamiento_resumen(date, date, text, boolean);
drop function if exists public.web_logs_estado_recogida(text);
drop function if exists public.web_contexto_evento(bigint, integer, integer);
drop function if exists public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer);
drop function if exists public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer);
drop function if exists public.web_logs_purgar(integer);
drop function if exists public.web_logs_agrupar_errores(integer);
drop function if exists public.web_logs_ingerir(jsonb, jsonb);
drop function if exists public.web_logs_recalcular_sesiones(uuid[]);
drop table if exists public.web_resumenes_ia;
drop table if exists public.web_linear_prueba;
drop table if exists public.web_logs_limite_ip;
drop table if exists public.web_logs_ingesta_diaria;
drop table if exists public.web_logs_estado;
drop table if exists public.web_sesiones;
drop table if exists public.web_eventos;
drop table if exists public.web_incidencias;
drop table if exists public.web_eventos_catalogo;
drop table if exists public.web_logs_config;
drop function if exists public.web_incidencias_al_editar();
drop function if exists public.web_logs_config_al_editar();
commit;
