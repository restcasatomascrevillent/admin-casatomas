-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   Correo «reserva modificada». Aplicar ANTES de desplegar             ##
-- ##   emails-reserva y el panel con la casilla «Avisar al cliente del      ##
-- ##   cambio». Idempotente. Solo toca las dos tablas de correos de reserva ##
-- ##   (ni reservas, ni aforo, ni funciones, ni crons).                     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- Encargo del dueño (2026-09-30): cuando el personal cambia el DÍA, la HORA
-- o los COMENSALES de una reserva desde «Editar» del panel y deja marcada
-- «Avisar al cliente del cambio», el cliente recibe un correo con qué ha
-- cambiado (antes → ahora) y cómo queda. Si la reserva está 'verificada', el
-- correo lleva un enlace NUEVO «Confirma tu reserva» (el del correo anterior
-- deja de valer si cambió la hora). Código: supabase/functions/emails-reserva/
-- reserva-modificada.ts (decisiones), plantillas.ts (punto 9: bloque
-- «Cambios en tu reserva»), index.ts (POST /notificar-modificacion).
--
-- QUÉ HACE ESTA MIGRACIÓN (y nada más):
--   1. 'reserva_modificada' entra en los CHECK de plantillas_email_reserva.tipo
--      y de envios_email_reserva.tipo_email (nombres verificados en
--      producción el 2026-09-30 con pg_constraint, solo lectura).
--   2. Dos columnas nuevas en envios_email_reserva, NULL en todas las filas de
--      los otros tipos:
--        · clave_aviso text  — identifica UN aviso de cambio dentro de
--          (reserva, 'reserva_modificada'): huella de los datos NUEVOS
--          (YYYY-MM-DD|HH:MM|comensales) + id del aviso de modificación
--          anterior de la misma reserva ("...|tras:<id>" o "...|tras:ninguno").
--        · detalle jsonb     — {antes, ahora, estado} del aviso: lo que hace
--          falta para que un reintento del cron mande EXACTAMENTE el mismo
--          correo (misma Idempotency-Key en Resend => mismo contenido) y para
--          saber si ese correo sigue siendo verdad al reintentarlo.
--      Un CHECK ata las dos cosas: clave_aviso existe si y solo si el tipo es
--      'reserva_modificada'.
--   3. uq_envio_email_reserva_activo pasa de (reserva_id, tipo_email) a
--      (reserva_id, tipo_email, coalesce(clave_aviso, '')), mismo filtro
--      parcial (pendiente | enviado). Para los otros cinco tipos clave_aviso
--      es NULL => '' => la unidad de idempotencia sigue siendo exactamente
--      (reserva, tipo), sin ningún cambio de comportamiento.
--      Por qué no bastaba (reserva, tipo): una reserva se puede modificar
--      varias veces y el segundo aviso chocaría con el primero. Por qué no
--      basta la huella de los datos nuevos: un ida y vuelta A→B→A→B dejaría
--      sin enviar el tercero y el cliente se quedaría creyendo A. El doble clic
--      o el reintento no duplican: si el último aviso ya lleva los mismos datos
--      nuevos no se repite (lo decide la función), y dos peticiones simultáneas
--      calculan la MISMA clave (leen el mismo «último aviso») y este índice
--      deja pasar solo una (23505 = "ya en curso", no es un fallo).
--      Mismo nombre de índice a propósito (lo citan comentarios y docs).
--   4. Plantilla por defecto 'reserva_modificada' v1 (vigente), si no existe.
--      Editable desde el panel como las otras cinco, con su historial.
--
-- CÓMO SE APLICA Y EN QUÉ ORDEN (lo hace el dueño, a mano, desde adminpanelct/).
-- NO con `supabase db push`: el historial remoto no está al día y se llevaría
-- las demás migraciones pendientes. Se aplica sin registrarla, como las
-- anteriores:
--   1. Que no haya transacciones largas abiertas (esta migración espera como
--      mucho 5 s por sus candados). Debe salir vacío:
--        npx supabase db query --linked "select pid, state, now() - xact_start as dura, left(query, 60) as consulta from pg_stat_activity where xact_start < now() - interval '1 minute' and pid <> pg_backend_pid();"
--   2. Aplicarla:
--        npx supabase db query --linked -f supabase/migrations/20260930211000_email_reserva_modificada.sql
--      Si falla con 55P03 (lock_not_available: otra sesión tenía cogida una de
--      las dos tablas más de 5 s), NO se ha aplicado nada (todo va en una
--      transacción): reintentar desde el paso 1.
--   3. Probarla:
--        npx supabase db query --linked -f supabase/tests/email_reserva_modificada.sql
--      y las consultas de VERIFICACIÓN del pie de este fichero.
--   4. Desplegar las dos funciones:
--        npx supabase functions deploy emails-reserva
--        npx supabase functions deploy resend-webhook
--      (la segunda nombra este correo en los avisos de rebote y les da
--      prioridad alta; sin ella salen con el nombre interno y prioridad normal).
--   5. Aplicar la migración de aforo 20260930212000, con su propia
--      verificación y su test.
--   6. npm test
--   7. Commit y push del panel (incluye src/hooks/useDisponibilidad.ts; lo hace
--      el orquestador cuando el dueño lo indique).
--   8. Con el panel YA publicado (antes no existe la pestaña): Plantillas de
--      correo → «Reserva modificada» → «Enviar prueba» a su propio correo.
--   9. Prueba real con una reserva VERIFICADA propia (con su email y para un día
--      futuro): «Editar», cambiar la hora con la casilla marcada y guardar;
--      comprobar que llega el correo, que el enlace nuevo «Confirma tu reserva»
--      vale y que el del correo anterior ya no.
--
-- ORDEN DE DESPLIEGUE (falla cerrado en cualquier otro):
--   · función desplegada SIN esta migración: /notificar-modificacion responde
--     plantilla_no_configurada_reserva_modificada (no hay plantilla) y no
--     escribe nada; el resto de correos y los reintentos siguen igual (el cron
--     lee envios_email_reserva con select *).
--   · panel publicado SIN la función nueva: la ruta no existe (404) y el panel
--     le dice al personal que no se ha podido pedir el aviso.
--
-- CANDADOS: cambiar los CHECK y crear el índice toma candados exclusivos sobre
-- plantillas_email_reserva y envios_email_reserva (dos tablas pequeñas: se
-- sueltan en milisegundos). `lock_timeout = 5s` evita quedarse esperando
-- detrás de otra transacción (y dejar en cola a los correos que llegan
-- mientras): si no los consigue en 5 s, aborta con 55P03 y no cambia nada.
--
-- Pruebas SQL (después de aplicarla): supabase/tests/email_reserva_modificada.sql
-- Rollback: supabase/rollbacks/20260930211000_email_reserva_modificada_ROLLBACK.sql
-- (revertir ANTES el código de emails-reserva y el del panel).
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. El tipo nuevo en los dos CHECK
-- ---------------------------------------------------------------------------
alter table public.plantillas_email_reserva
  drop constraint if exists plantillas_email_reserva_tipo_check;
alter table public.plantillas_email_reserva
  add constraint plantillas_email_reserva_tipo_check
  check (tipo in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio', 'reserva_modificada'));

alter table public.envios_email_reserva
  drop constraint if exists envios_email_reserva_tipo_email_check;
alter table public.envios_email_reserva
  add constraint envios_email_reserva_tipo_email_check
  check (tipo_email in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio', 'reserva_modificada'));

-- ---------------------------------------------------------------------------
-- 2. clave_aviso + detalle (solo para 'reserva_modificada')
-- ---------------------------------------------------------------------------
alter table public.envios_email_reserva add column if not exists clave_aviso text;
alter table public.envios_email_reserva add column if not exists detalle jsonb;

comment on column public.envios_email_reserva.clave_aviso is
  'Solo tipo_email=''reserva_modificada'': identifica el aviso = huella de los datos NUEVOS (YYYY-MM-DD|HH:MM|comensales) + ''|tras:'' + id del aviso de modificación anterior de la misma reserva (o ''ninguno''). Entra en uq_envio_email_reserva_activo: impide duplicar el MISMO aviso (doble clic, reintento) sin bloquear los siguientes cambios de la reserva. NULL en el resto de tipos. Ver emails-reserva/reserva-modificada.ts.';
comment on column public.envios_email_reserva.detalle is
  'Solo tipo_email=''reserva_modificada'': {antes:{fecha,hora,comensales}, ahora:{...}, estado} con los que se avisó. Lo usa /reintentar-fallidos para mandar exactamente el mismo correo y para abandonar el aviso si la reserva ya volvió a cambiar. NULL en el resto de tipos.';

alter table public.envios_email_reserva
  drop constraint if exists envios_email_reserva_clave_aviso_solo_modificada;
alter table public.envios_email_reserva
  add constraint envios_email_reserva_clave_aviso_solo_modificada
  check ((tipo_email = 'reserva_modificada') = (clave_aviso is not null));

-- ---------------------------------------------------------------------------
-- 3. Índice único de idempotencia: (reserva, tipo) -> (reserva, tipo, clave)
--    Se crea el nuevo ANTES de quitar el viejo (dentro de la misma
--    transacción): no hay ningún instante sin garantía contra duplicados.
-- ---------------------------------------------------------------------------
drop index if exists public.uq_envio_email_reserva_activo_nuevo;
create unique index uq_envio_email_reserva_activo_nuevo
  on public.envios_email_reserva (reserva_id, tipo_email, coalesce(clave_aviso, ''))
  where resultado in ('pendiente', 'enviado');
drop index if exists public.uq_envio_email_reserva_activo;
alter index public.uq_envio_email_reserva_activo_nuevo rename to uq_envio_email_reserva_activo;

comment on index public.uq_envio_email_reserva_activo is
  'Idempotencia de los correos de reserva: como mucho una fila pendiente|enviado por (reserva, tipo, clave_aviso). clave_aviso es NULL (=> '''') en todos los tipos salvo ''reserva_modificada'', así que para ellos la unidad sigue siendo (reserva, tipo). Migración 20260930211000.';

comment on table public.envios_email_reserva is
  'Registro de cada intento de correo de reserva. La unidad de idempotencia es (reserva_id, tipo_email) y, para ''reserva_modificada'', además clave_aviso: ver uq_envio_email_reserva_activo. resend_id cruza con email_eventos (tabla de resend-webhook) para tracking de apertura/rebote.';

-- ---------------------------------------------------------------------------
-- 4. Plantilla por defecto (texto plano con {{tokens}}, nunca HTML: ver la
--    cabecera de emails-reserva/plantillas.ts). El bloque «Cambios en tu
--    reserva» (antes/ahora), la frase según el estado y los enlaces NO están
--    aquí: los pone el correo solo (punto 9 del contrato). Los dos botones
--    solo se ven cuando la reserva está 'verificada' (el correo trae enlace).
-- ---------------------------------------------------------------------------
insert into public.plantillas_email_reserva
  (tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal, texto_boton_secundario, pie, bloques, nota_version)
select
  'reserva_modificada', 1, true,
  'Hemos modificado tu reserva - {{negocio}}',
  'Hola, {{nombre}}',
  E'Te escribimos porque hemos modificado tu reserva en {{negocio}}. Aquí tienes lo que ha cambiado y cómo queda.\n\nSi los nuevos datos no te vienen bien o tienes cualquier duda, llámanos y buscamos una solución.',
  'Sí, confirmo mi asistencia',
  'No puedo, cancelar reserva',
  'Si necesitas cambiar algo más o cancelarla, llámanos con antelación.',
  '{"mostrar_tabla_detalles": true, "mostrar_boton_secundario": true, "mostrar_pie_contacto": true}'::jsonb,
  'Version inicial (migracion 20260930211000)'
where not exists (
  select 1 from public.plantillas_email_reserva where tipo = 'reserva_modificada'
);

comment on table public.plantillas_email_reserva is
  'Contenido editable de los 6 correos de reserva (el 6º, reserva_modificada, desde 20260930211000). El esqueleto HTML fijo vive en supabase/functions/emails-reserva/plantillas.ts — esta tabla nunca guarda HTML, solo texto plano con tokens {{nombre}}, {{fecha}}, etc. Historial append-only: una fila por versión, es_actual marca la vigente.';

commit;

-- ===========================================================================
-- DESPUÉS: los pasos 3 a 9 de la cabecera. Sin secretos nuevos: usa
-- RESEND_API_KEY y EMAILS_RESERVA_TOKEN_SECRET, que ya existen. No hace falta
-- desplegar notify-reservation-change.
--
-- VERIFICACIÓN (paso 3; solo lectura, con npx supabase db query --linked "..."):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('plantillas_email_reserva_tipo_check',
--                      'envios_email_reserva_tipo_email_check',
--                      'envios_email_reserva_clave_aviso_solo_modificada');
--   -- -> los dos CHECK de tipo incluyen 'reserva_modificada', y el tercero existe
--   select indexdef from pg_indexes where indexname = 'uq_envio_email_reserva_activo';
--   -- -> ... (reserva_id, tipo_email, COALESCE(clave_aviso, ''::text)) WHERE ...
--   select tipo, version, es_actual, asunto from public.plantillas_email_reserva
--    where tipo = 'reserva_modificada';
--   -- -> una fila: 1, true, 'Hemos modificado tu reserva - {{negocio}}'
--   Junto con el test SQL del paso 3: npx supabase db query --linked -f supabase/tests/email_reserva_modificada.sql
-- ===========================================================================
