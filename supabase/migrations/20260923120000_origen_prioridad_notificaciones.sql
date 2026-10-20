-- ===========================================================================
-- ##                                                                       ##
-- ##                          APLICADA el 23/09/2026 (verificado: las columnas origen y prioridad existen)                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.       ##
-- ##   Queda preparado para que el dueño lo revise y decida. Verificado    ##
-- ##   2026-09-23: `notificaciones_dashboard` hoy solo tiene id/tipo/      ##
-- ##   titulo/mensaje/referencia_id/referencia_tipo/leida/created_at       ##
-- ##   (information_schema.columns, API de Supabase, solo lectura) — sin   ##
-- ##   `origen` ni `prioridad`. Es aditiva (dos ADD COLUMN con DEFAULT      ##
-- ##   seguro) y no borra ni renombra nada. Desplegar el código que la     ##
-- ##   usa (reservas-web/emails-reserva) SIN aplicar esto primero rompe    ##
-- ##   sus INSERT a notificaciones_dashboard (columna inexistente) —       ##
-- ##   aplicar migración y desplegar funciones JUNTAS.                    ##
-- ##                                                                       ##
-- ===========================================================================
--
-- CONTEXTO (QA contra producción, sesión 2026-09-23, verificado con datos
-- reales — dos fallos distintos, este fichero es para el segundo):
--
--   `avisarEnviosDefinitivamentePerdidos` (emails-reserva/index.ts) mira la
--   última fila de `notificaciones_dashboard` con `tipo='email_fallido'`
--   SIN distinguir de qué tubería vino, y `reservas-web` (index.ts,
--   `avisarEmailFallido`) escribía ese mismo `tipo` SIN ningún margen
--   propio. Verificado en la prueba: un fallo de baja prioridad (el correo
--   de "solicitud recibida", de reservas-web) tapó 30 minutos el aviso de
--   uno de alta prioridad (una "propuesta"/"confirmación", de
--   emails-reserva) de una reserva distinta — el cooldown de 30 min de
--   emails-reserva (AVISO_COOLDOWN_MINUTOS_POR_DEFECTO,
--   emails-reserva/reintentos.ts) veía la fila de reservas-web como "aviso
--   reciente" y omitía el suyo propio.
--
-- MECANISMO ELEGIDO: DOS columnas nuevas, DOS ejes independientes — no uno
-- solo. El código (ya escrito, ver supabase/functions/reservas-web/
-- plantillas.ts::debeCrearAvisoEmailFallido/prioridadAvisoEmailFallido y
-- supabase/functions/emails-reserva/reintentos.ts::prioridadEmailFallido,
-- ambos con el razonamiento completo) consulta el cooldown filtrando por
-- AMBAS columnas:
--
--   - `origen` ('reservas_web' | 'emails_reserva'): cada tubería solo mira
--     SUS PROPIOS avisos anteriores. Ya arregla el caso EXACTO de la
--     prueba (solicitud_recibida es de reservas-web; propuesta/confirmada
--     son de emails-reserva — orígenes distintos).
--   - `prioridad` ('alta' | 'normal'): DENTRO de la misma tubería,
--     emails-reserva manda tanto tipos de baja prioridad
--     (solicitud_recibida, rechazada, recordatorio) como de alta
--     (propuesta, confirmada) — "por origen" solo no evita que un
--     solicitud_recibida fallido tape, dentro de esa MISMA tubería, un
--     propuesta/confirmada fallido posterior. De ahí el segundo eje.
--
-- Combinadas dan 4 carriles de cooldown TOTALMENTE independientes:
-- (reservas_web,alta) / (reservas_web,normal) / (emails_reserva,alta) /
-- (emails_reserva,normal). Cada carril conserva su propio margen de 30 min
-- (una caída de Resend sigue sin poder generar doscientos avisos DENTRO de
-- un carril — el requisito no desaparece), pero ningún carril puede tapar a
-- otro. Es la forma más simple de garantizar "un aviso importante nunca
-- queda tapado por uno menor" verificable por inspección, sin tener que
-- razonar sobre un orden parcial entre avisos de distinta prioridad.
--
-- ALTERNATIVAS CONSIDERADAS Y DESCARTADAS:
--   - Codificar origen/prioridad DENTRO del valor de `tipo` (p.ej.
--     'email_fallido_alta_reservas_web'): evitaba esta migración, pero
--     cambia un valor que ya consume el frontend (useNotificacionesDashboard.ts,
--     types.ts — fuera del territorio de esta sesión) sin necesidad; dos
--     columnas nuevas y NULLABLE/con DEFAULT son estrictamente más seguras
--     porque NINGÚN consumidor existente de `tipo='email_fallido'` deja de
--     reconocer las filas nuevas.
--   - Un único campo `carril` tipo 'alta:reservas_web': misma información,
--     pero dos filtros `.eq()` (uno por columna) son más simples de leer y
--     de indexar por separado que parsear un string compuesto.
--
-- BACKFILL DE FILAS EXISTENTES
--   `origen`: se deja NULL para todo lo existente (y para tipos que no sean
--   `email_fallido` en el futuro, vía el trigger `fn_notificar_solicitud`,
--   que no se toca) — no hay forma de reconstruir con certeza qué tubería
--   generó un aviso `email_fallido` ya insertado antes de esta migración,
--   y NULL es la respuesta honesta ("no se sabe / no aplica"), no un valor
--   inventado. El código de ambas funciones SIEMPRE manda `origen`
--   explícito en cada INSERT nuevo, así que ninguna fila nueva de
--   `email_fallido` se queda en NULL.
--   `prioridad`: NOT NULL DEFAULT 'normal' — a diferencia de `origen`, un
--   valor neutro por defecto SÍ tiene sentido aquí (ninguna fila existente
--   necesita tratarse como urgente retroactivamente), así que se evita la
--   lógica de tres valores (alta/normal/NULL) en cualquier consulta futura.
-- ===========================================================================

begin;

-- `origen`: NULLABLE a propósito (ver BACKFILL arriba) — solo las filas de
-- `tipo='email_fallido'` lo rellenan, con uno de los dos valores del CHECK.
alter table public.notificaciones_dashboard
  add column origen text;

alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_origen_valido
  check (origen is null or origen in ('reservas_web', 'emails_reserva'));

-- `prioridad`: NOT NULL + DEFAULT 'normal' a nivel de BASE DE DATOS (no solo
-- en el código de las Edge Functions) para que cualquier INSERT que no la
-- mande —el trigger fn_notificar_solicitud, o cualquier camino futuro—
-- caiga siempre en 'normal', nunca en NULL. El ADD COLUMN backfillea las
-- filas existentes en la misma sentencia (comportamiento estándar de
-- PostgreSQL, no hace falta un UPDATE aparte).
alter table public.notificaciones_dashboard
  add column prioridad text not null default 'normal';

alter table public.notificaciones_dashboard
  add constraint notificaciones_dashboard_prioridad_valida
  check (prioridad in ('alta', 'normal'));

comment on column public.notificaciones_dashboard.origen is
  'Qué Edge Function generó el aviso (reservas_web | emails_reserva). NULL '
  'para filas que no sean tipo=email_fallido (no aplica) o para '
  'email_fallido insertado antes de esta migración (no se puede reconstruir '
  'con certeza). Ver supabase/functions/{reservas-web,emails-reserva} — '
  'margen anti-aluvión por carril (origen + prioridad).';

comment on column public.notificaciones_dashboard.prioridad is
  'alta | normal, DEFAULT normal. Determina en qué carril de cooldown '
  'anti-aluvión cae un aviso de tipo email_fallido, para que uno de baja '
  'prioridad nunca tape a uno de alta. Ver '
  'reservas-web/plantillas.ts::prioridadAvisoEmailFallido y '
  'emails-reserva/reintentos.ts::prioridadEmailFallido.';

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACIÓN — ejecutar DESPUÉS de aplicar esta migración.
-- Solo lee, no escribe nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) Las columnas existen, con el nullable/default esperado:
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'notificaciones_dashboard'
--   and column_name in ('origen', 'prioridad');
--   -- esperado: origen (YES, NULL) / prioridad (NO, 'normal'::text)
--
-- -- 2) Todas las filas existentes quedan con prioridad='normal' y
-- --    origen=NULL (ninguna fila anterior a esta migración puede tener
-- --    otro valor, porque no existían las columnas):
-- select origen, prioridad, count(*) from public.notificaciones_dashboard
-- group by origen, prioridad;
--   -- esperado antes de que el código nuevo inserte nada: una sola fila,
--   -- (NULL, 'normal', <total de notificaciones_dashboard de hoy>)
--
-- -- 3) El CHECK rechaza valores fuera de rango (debe fallar con
-- --    "violates check constraint"):
-- -- insert into public.notificaciones_dashboard (tipo, titulo, origen)
-- --   values ('email_fallido', 'prueba', 'otra_cosa');
-- -- insert into public.notificaciones_dashboard (tipo, titulo, prioridad)
-- --   values ('email_fallido', 'prueba', 'urgente');
-- ---------------------------------------------------------------------------
