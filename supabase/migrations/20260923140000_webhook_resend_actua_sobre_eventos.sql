-- ===========================================================================
-- ##                                                                       ##
-- ##   ESTADO A FECHA DE ESCRITURA (2026-09-23): NO aplicada por este      ##
-- ##   agente -- el encargo prohíbe aplicar migraciones desde aquí. No se  ##
-- ##   afirma "NO APLICADA" a secas porque esa marca concreta ya ha        ##
-- ##   engañado a cuatro personas en este proyecto en tres días (ver       ##
-- ##   ejemplo real más abajo). Antes de asumir el estado de ESTA          ##
-- ##   migración, comprobarlo:                                            ##
-- ##     select column_name from information_schema.columns               ##
-- ##       where table_name='envios_email_reserva'                        ##
-- ##         and column_name='estado_entrega';                            ##
-- ##   (0 filas = no aplicada; 1 fila = aplicada). O bien vía MCP/CLI:     ##
-- ##   list_migrations / `supabase migration list`.                       ##
-- ##                                                                       ##
-- ##   EJEMPLO REAL de por qué no basta con confiar en la cabecera de un   ##
-- ##   fichero (encontrado HOY, verificando el estado de esta MISMA base   ##
-- ##   de datos antes de escribir esto): la cabecera de                    ##
-- ##   20260923120000_origen_prioridad_notificaciones.sql dice "NO         ##
-- ##   APLICADA" y afirma haberlo verificado el 2026-09-23 contra          ##
-- ##   information_schema. Consultado DE NUEVO ahora mismo (2026-09-23,    ##
-- ##   vía Management API, sesión de esta entrega):                        ##
-- ##   notificaciones_dashboard SÍ tiene `origen` y `prioridad` en          ##
-- ##   producción -- esa migración SÍ está aplicada. La cabecera quedó      ##
-- ##   obsoleta en algún momento entre su escritura y hoy. No se toca ese   ##
-- ##   fichero (fuera del territorio de esta sesión: solo ficheros NUEVOS   ##
-- ##   con sello >= 20260923140000) -- se deja constancia aquí y en el      ##
-- ##   informe de esta entrega para que alguien con permiso lo corrija.     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- RESEND-WEBHOOK ACTÚA SOBRE LOS EVENTOS (no solo los archiva)
-- ===========================================================================
-- Autor: agente "cierre del círculo resend-webhook". Depende de que
-- 20260920010000_sistema_emails_reserva.sql (crea envios_email_reserva) y
-- 20260923120000_origen_prioridad_notificaciones.sql (añade origen/prioridad
-- a notificaciones_dashboard) YA estén aplicadas -- ambas anteriores por
-- fecha y VERIFICADAS aplicadas hoy contra esta base de datos (ver arriba y
-- las columnas confirmadas más abajo), así que un `supabase db push` normal
-- las aplica primero de todas formas.
--
-- CONTEXTO (verificado en vivo, QA contra producción, sesión 2026-09-23):
-- Resend acepta el envío de forma SÍNCRONA (HTTP 200, la fila de
-- envios_email_reserva queda 'enviado' con su resend_id). El resultado REAL
-- (¿llegó, rebotó, se marcó como spam, ni se intentó?) llega ~0.4s después
-- por webhook. Antes de esta migración + el código que la acompaña
-- (supabase/functions/resend-webhook/index.ts), ese webhook solo hacía
-- INSERT en `email_eventos` -- nada volvía a mirar la fila de
-- envios_email_reserva. Verificado con bounced@resend.dev,
-- complained@resend.dev y suppressed@resend.dev: los tres devolvían ok:true
-- y la fila se quedaba 'enviado' para siempre, indistinguible de un correo
-- que sí llegó.
--
-- QUÉ CAMBIA (código en resend-webhook/index.ts + eventos.ts -- no lo hace
-- esta migración, ella solo prepara el terreno, mismo criterio que
-- 20260922160000_reintentos_emails_reserva.sql):
--   1. bounced/complained/suppressed/delivered se enlazan con su fila de
--      envios_email_reserva por resend_id = data.email_id del evento, y esa
--      fila se marca con un estado NUEVO y ortogonal a `resultado`
--      ('estado_entrega'): `resultado` sigue significando "lo mandamos"
--      (nunca cambia por esto -- un rebote NO debe liberar el hueco del
--      índice único uq_envio_email_reserva_activo ni hacer que
--      /reintentar-fallidos lo recoja, porque reenviar a una dirección que
--      no existe no la hace existir); 'estado_entrega' pasa a significar
--      "qué pasó después: llegó, rebotó, se quejó, o Resend ni lo intentó".
--   2. bounced/complained/suppressed generan un aviso en
--      notificaciones_dashboard (alta si el tipo_email era
--      propuesta/confirmada, normal si no -- mismo criterio que
--      prioridadEmailFallido en emails-reserva/reintentos.ts) y añaden la
--      dirección a una lista de supresión propia (PIEZA 2) que
--      emails-reserva consulta antes de intentar un envío futuro: seguir
--      escribiendo a quien marcó como spam daña la reputación del dominio y
--      perjudica la entrega al resto de clientes.
--
-- Esta migración solo aporta lo que ese código necesita en la base de
-- datos: tres columnas nuevas + un índice en envios_email_reserva, una
-- tabla nueva de supresión, y un tercer valor de `origen` en
-- notificaciones_dashboard para que resend-webhook tenga su propio carril
-- de cooldown anti-aluvión (ver PIEZA 3).
-- ===========================================================================

begin;

-- ============================================================================
-- PIEZA 1 — Columnas nuevas en envios_email_reserva: "qué pasó DESPUÉS de
-- mandarlo", separado de `resultado` ("lo mandamos" -- ver arriba el porqué
-- de no reutilizar esa columna).
-- ============================================================================

alter table public.envios_email_reserva
  add column if not exists estado_entrega text;

do $$
begin
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'envios_email_reserva'
      and con.conname = 'envios_email_reserva_estado_entrega_valido'
  ) then
    alter table public.envios_email_reserva
      add constraint envios_email_reserva_estado_entrega_valido
      check (estado_entrega is null or estado_entrega in ('entregado', 'rebotado', 'quejado', 'suprimido'));
  end if;
end;
$$;

alter table public.envios_email_reserva
  add column if not exists estado_entrega_at timestamptz;

alter table public.envios_email_reserva
  add column if not exists estado_entrega_detalle text;

comment on column public.envios_email_reserva.estado_entrega is
  'Qué pasó DESPUÉS de que resultado=''enviado'' (poblado por resend-webhook vía sus eventos asíncronos): entregado | rebotado | quejado | suprimido. NULL = todavía sin confirmar (recién enviado, o el email_id no coincidió con ningún evento). Ortogonal a `resultado`, que sigue significando solo "lo mandamos" -- un rebote NUNCA debe liberar uq_envio_email_reserva_activo ni hacer que /reintentar-fallidos recoja la fila.';
comment on column public.envios_email_reserva.estado_entrega_at is
  'Cuándo se recibió el evento que fijó estado_entrega (no cuándo se envió -- eso es enviado_at).';
comment on column public.envios_email_reserva.estado_entrega_detalle is
  'Detalle libre del evento (p.ej. el mensaje de bounce de Resend), cuando está disponible. NULL si no hay detalle o el evento no lo trae.';

-- resend-webhook busca por resend_id en CADA evento que le llega -- índice
-- parcial (solo filas con resend_id, que son las que ya se intentaron
-- mandar) para que esa búsqueda no escanee toda la tabla según crezca el
-- histórico.
create index if not exists idx_envios_resend_id
  on public.envios_email_reserva (resend_id)
  where resend_id is not null;


-- ============================================================================
-- PIEZA 2 — Supresión de direcciones (bounced duro / complained / suppressed)
-- ----------------------------------------------------------------------------
-- Tabla NUEVA y deliberadamente separada de `blacklist` (verificado su
-- esquema antes de decidir esto: id/tipo/valor/nombre/motivo/created_at/
-- updated_at/aprobado_por/aprobada_en/caduca_el -- tiene flujo de
-- aprobación y sirve para bloquear RESERVAS futuras de un cliente, p.ej.
-- por no-shows repetidos). Son dos preocupaciones completamente distintas:
-- un cliente que marca un correo como spam sigue siendo bienvenido a
-- reservar mesa -- lo único que cambia es que dejamos de escribirle por
-- email. Meter esto en `blacklist` habría bloqueado sus RESERVAS por un
-- motivo de entrega de correo, que es un error de producto, no solo de
-- diseño de esquema.
-- ============================================================================

create table if not exists public.direcciones_email_suprimidas (
  email text primary key,
  motivo text not null check (motivo in ('bounced', 'complained', 'suppressed')),
  detalle text,
  origen_email_id text,
  created_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

comment on table public.direcciones_email_suprimidas is
  'Direcciones a las que emails-reserva NO debe volver a escribir (poblada por resend-webhook al recibir bounced/complained/suppressed). email en minúsculas y sin espacios (normalizado por el código, no por la BD). NO tiene relación con `blacklist` (esa bloquea reservas futuras del cliente; esta solo evita mandarle más correo). motivo se sobrescribe con el más reciente en cada upsert -- no hay precedencia entre bounced/complained/suppressed, cualquiera de los tres es motivo suficiente para dejar de escribir.';

alter table public.direcciones_email_suprimidas enable row level security;

create policy "direcciones_email_suprimidas_select_seccion" on public.direcciones_email_suprimidas
  for select to authenticated using (public.can_read_section('reservas'));
create policy "direcciones_email_suprimidas_service_role" on public.direcciones_email_suprimidas
  for all to service_role using (true) with check (true);
revoke select on public.direcciones_email_suprimidas from anon;
-- Sin insert/update/delete para `authenticated` a propósito, mismo criterio
-- que envios_email_reserva: solo las Edge Functions (service_role) escriben
-- aquí.


-- ============================================================================
-- PIEZA 3 — Nuevo `origen` para los avisos de resend-webhook
-- ----------------------------------------------------------------------------
-- Mismo razonamiento que 20260923120000_origen_prioridad_notificaciones.sql
-- (que introdujo origen/prioridad para que reservas_web y emails_reserva no
-- se taparan avisos entre sí): resend-webhook es una TERCERA tubería
-- independiente que también escribe tipo='email_fallido'. Si usara
-- origen='emails_reserva' compartiría carril de cooldown con los avisos de
-- fallos de ENVÍO de emails-reserva (reintentos.ts) -- un aviso de
-- "propuesta fallida al enviar" podría tapar 30 minutos un "propuesta
-- rebotada tras enviarse", que es justo el tipo de aluvión cruzado que esa
-- migración ya corrigió una vez para otras dos tuberías. Se le da su propio
-- valor para que la protección sea real: (resend_webhook, alta) y
-- (resend_webhook, normal) quedan como dos carriles más, totalmente
-- independientes de los cuatro que ya existían.
--
-- Se busca la constraint por catálogo (no se asume su nombre) antes de
-- tocarla, mismo criterio defensivo que
-- 20260922160000_reintentos_emails_reserva.sql para envios_email_reserva_
-- resultado_check -- aunque en este caso el nombre SÍ se conoce y se ha
-- verificado hoy contra producción (notificaciones_dashboard_origen_valido,
-- CHECK ((origen IS NULL) OR (origen = ANY (ARRAY['reservas_web'::text,
-- 'emails_reserva'::text])))), se prefiere no asumirlo por si el orden real
-- de aplicación de migraciones en producción llega a diferir de este.
-- ============================================================================

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'notificaciones_dashboard'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%origen%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.notificaciones_dashboard drop constraint %I', v_constraint_name);
  end if;

  alter table public.notificaciones_dashboard
    add constraint notificaciones_dashboard_origen_valido
    check (origen is null or origen in ('reservas_web', 'emails_reserva', 'resend_webhook'));
end;
$$;

commit;

-- ============================================================================
-- CHECKLIST POST-MIGRACIÓN (no lo hace esta migración; pasos de quien
-- despliegue, fuera del alcance de "no apliques migraciones" de este
-- encargo -- resend-webhook YA se ha desplegado con este código durante
-- esta sesión, ver informe, pero SIN esta migración aplicada, por lo que
-- hasta que se aplique el enriquecimiento (PIEZA 1/2/3) falla en
-- silencio -- try/catch, ver index.ts -- y solo el archivado en
-- email_eventos funciona, exactamente como antes de esta entrega):
--
--   1. Aplicar esta migración (supabase db push, o el SQL editor).
--   2. No hace falta volver a desplegar resend-webhook: el código ya está
--      desplegado y empezará a marcar filas / avisar / suprimir en cuanto
--      las columnas y la tabla existan, sin cambios adicionales.
--   3. Confirmar: select estado_entrega, estado_entrega_at from
--      public.envios_email_reserva where resend_id is not null order by
--      estado_entrega_at desc nulls last limit 5;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACIÓN — ejecutar DESPUÉS de aplicar esta migración.
-- Solo lee, no escribe nada.
-- ---------------------------------------------------------------------------
--
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'envios_email_reserva'
--   and column_name like 'estado_entrega%';
--   -- esperado: 3 filas (estado_entrega, estado_entrega_at, estado_entrega_detalle)
--
-- select table_name from information_schema.tables
-- where table_schema='public' and table_name='direcciones_email_suprimidas';
--   -- esperado: 1 fila
--
-- select pg_get_constraintdef(con.oid) from pg_constraint con
-- join pg_class rel on rel.oid = con.conrelid
-- where rel.relname = 'notificaciones_dashboard' and con.conname = 'notificaciones_dashboard_origen_valido';
--   -- esperado: incluye 'resend_webhook' en el ARRAY
-- ---------------------------------------------------------------------------
