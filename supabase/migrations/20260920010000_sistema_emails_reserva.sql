-- ============================================================================
-- SISTEMA DE CORREOS DE RESERVA — contraoferta, plantillas, recordatorio T-2,
-- ausencias sin avisar
-- ============================================================================
-- Autor: agente "emails-reserva". Migración propia, no toca ninguna otra.
--
-- ESQUEMA DE PARTIDA (verificado contra `docs/funcionalidades/01-reservas.md`,
-- consultado contra producción el 2026-09-18 vía information_schema/pg_catalog
-- — la carpeta migrations/ NO refleja el estado real de `reservas`, así que
-- esa es la fuente de verdad usada aquí, no un grep de migraciones antiguas):
--   reservas(id, fecha date, hora time, numero_comensales int, estado varchar
--     CHECK IN ('pendiente','verificada','confirmada','cancelada','completada',
--     'no_show'), notas_cliente, created_at, updated_at, nombre, telefono,
--     email, en_blacklist bool, importante bool, espacio_id uuid FK, canal text)
--   espacios_reserva(id, nombre, descripcion, capacidad_maxima, activa, ...)
--   blacklist(id, tipo CHECK IN ('email','telefono'), valor, nombre, motivo,
--     created_at, updated_at) UNIQUE(tipo, valor)
--   configuracion_reservas: singleton, sin novedad aquí.
--   pg_cron instalado (1 job: delete-old-call-logs). pg_net NO instalado.
--
-- LAS CUATRO PIEZAS (ver informe final para el porqué de cada decisión):
--   1. Contraoferta: snapshot de lo solicitado en la propia fila de `reservas`
--      (columnas, no tabla aparte) + trigger BEFORE INSERT.
--   2. Plantillas editables: esqueleto fijo en código (emails-reserva/
--      plantillas.ts), contenido en `plantillas_email_reserva` con historial
--      de versiones append-only.
--   3. Recordatorio T-2: pg_net + pg_cron (instalado aquí), secreto vía Vault,
--      registro de envíos con índice único parcial para idempotencia real.
--   4. Ausencias: detección + sugerencia en `sugerencias_blacklist`; aprobar
--      sigue siendo un acto humano que escribe en `blacklist` (ampliada con
--      quién y hasta cuándo).
-- ============================================================================

begin;

-- ============================================================================
-- PIEZA 1 — CONTRAOFERTA: qué pidió el cliente vs. qué se le ofrece
-- ----------------------------------------------------------------------------
-- `reservas.hora` / `reservas.espacio_id` siguen siendo el valor VIGENTE
-- (lo que hoy edita ModalVerificacionReserva.tsx sin que yo toque ese
-- fichero). Se añaden dos columnas que capturan, una única vez, lo que el
-- cliente pidió originalmente:
--
--   hora_solicitada          — hora tal y como llegó la reserva (INSERT)
--   espacio_solicitado_id    — espacio tal y como llegó la reserva (INSERT)
--
-- Alternativa descartada: un snapshot jsonb de la fila entera. Se descarta
-- porque (a) el encargo mismo acota el cambio a hora y zona — nombre,
-- fecha y comensales no forman parte de la contraoferta y no hace falta
-- congelarlos; (b) columnas tipadas permiten FK real sobre
-- espacio_solicitado_id (detecta espacios borrados) y comparar en SQL sin
-- parsear JSON; (c) es el único snapshot en todo el esquema — jsonb habría
-- sido la excepción, no la norma, sin necesidad real.
--
-- Por qué un TRIGGER y no rellenarlo en cada INSERT de cada canal: hay
-- CUATRO vías de alta (teléfono, web-n8n, panel, Touza) en tres repos
-- distintos, dos de ellas fuera de mi alcance de fichero y una (n8n) ni
-- siquiera auditable desde este repositorio. Un trigger BEFORE INSERT es el
-- único punto que garantiza el snapshot pase lo que pase por delante.
--
-- Por qué SOLO INSERT (nunca UPDATE): `hora_solicitada` tiene que ser
-- inmutable — es histórico. Si fuera BEFORE INSERT OR UPDATE arrastraría el
-- valor equivocado en cualquier UPDATE futuro que no sea explícitamente "yo
-- ya la rellené". Al ser solo-INSERT no compite por orden de ejecución con
-- `trg_validar_capacidad` (que sí dispara en UPDATE de hora): ambos
-- triggers BEFORE INSERT tocan columnas distintas, así que el orden entre
-- ellos es irrelevante.
--
-- La condición `IS NULL` (en vez de incondicional) es a propósito: si algún
-- día un caller quiere fijar explícitamente "lo solicitado" distinto del
-- valor inicial (p.ej. una migración de datos), puede mandarlo en el mismo
-- INSERT y el trigger no lo pisa.
-- ============================================================================

alter table public.reservas
  add column if not exists hora_solicitada time without time zone;

alter table public.reservas
  add column if not exists espacio_solicitado_id uuid references public.espacios_reserva(id) on delete set null;

comment on column public.reservas.hora_solicitada is
  'Hora tal y como la pidió el cliente al crear la reserva (snapshot inmutable, rellenado por trg_snapshot_solicitud_original). reservas.hora es la hora VIGENTE y puede diferir tras una contraoferta del restaurante.';
comment on column public.reservas.espacio_solicitado_id is
  'Espacio tal y como lo pidió el cliente al crear la reserva (snapshot inmutable). reservas.espacio_id es el espacio VIGENTE.';

create or replace function public.fn_snapshot_solicitud_original()
returns trigger
language plpgsql
as $$
begin
  if new.hora_solicitada is null then
    new.hora_solicitada := new.hora;
  end if;
  if new.espacio_solicitado_id is null then
    new.espacio_solicitado_id := new.espacio_id;
  end if;
  return new;
end;
$$;

comment on function public.fn_snapshot_solicitud_original() is
  'BEFORE INSERT en reservas: congela hora_solicitada/espacio_solicitado_id al valor de alta si no vienen ya rellenos. Nunca se ejecuta en UPDATE — el snapshot es inmutable a propósito.';

drop trigger if exists trg_snapshot_solicitud_original on public.reservas;
create trigger trg_snapshot_solicitud_original
  before insert on public.reservas
  for each row
  execute function public.fn_snapshot_solicitud_original();

-- Backfill: las reservas ya existentes no pasaron por el trigger. Se rellenan
-- con su propio valor vigente (es la mejor aproximación posible — no hay
-- forma de recuperar lo que se pidió de verdad si ya se sobrescribió), de
-- modo que "vigente == solicitado" para el histórico y ninguna plantilla
-- muestre una contraoferta fantasma sobre datos anteriores a esta migración.
update public.reservas
  set hora_solicitada = hora
  where hora_solicitada is null;

update public.reservas
  set espacio_solicitado_id = espacio_id
  where espacio_solicitado_id is null and espacio_id is not null;


-- ============================================================================
-- PIEZA 2 — PLANTILLAS EDITABLES DESDE EL PANEL
-- ----------------------------------------------------------------------------
-- Esqueleto (tablas HTML, estilos en línea, orden de bloques) vive en código:
-- supabase/functions/emails-reserva/plantillas.ts. Esta tabla SOLO guarda
-- contenido de texto/color/flags — nunca HTML libre (ver cabecera de
-- plantillas.ts para el motivo y el contrato completo de tokens {{...}}).
--
-- Versionado append-only: cada guardado desde el panel INSERTA una fila
-- nueva con version = max(version)+1 para ese tipo y es_actual = true; la
-- fila anterior pasa es_actual = false. Nunca se hace UPDATE de una versión
-- ya guardada — así el historial es perfecto y "volver atrás" es
-- reproducible (ver fn_restaurar_version_plantilla más abajo). El índice
-- único parcial impide dos versiones "actuales" a la vez para el mismo tipo.
-- ============================================================================

create table public.plantillas_email_reserva (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio')),
  version integer not null check (version > 0),
  es_actual boolean not null default false,

  -- --- contenido editable (todo texto plano; ver plantillas.ts sobre {{tokens}} y por qué no se acepta HTML) ---
  asunto text not null,
  saludo text not null,
  cuerpo text not null,
  texto_boton_principal text,
  texto_boton_secundario text,
  pie text,

  -- --- marca ---
  color_acento text not null default '#B8936A',
  color_oscuro text not null default '#1C1F22',
  logo_url text,

  -- --- qué bloques OPCIONALES se pintan (ver plantillas.ts: la comparación
  -- solicitado/ofrecido de la contraoferta NO está aquí porque es automática
  -- según los datos de la reserva, no una preferencia editorial) ---
  bloques jsonb not null default '{}'::jsonb,

  nota_version text,
  creado_por uuid references auth.users(id) on delete set null,
  creado_at timestamptz not null default now(),

  constraint chk_plantilla_colores_hex check (
    color_acento ~ '^#[0-9A-Fa-f]{6}$' and color_oscuro ~ '^#[0-9A-Fa-f]{6}$'
  )
);

comment on table public.plantillas_email_reserva is
  'Contenido editable de los 5 correos de reserva. El esqueleto HTML fijo vive en supabase/functions/emails-reserva/plantillas.ts — esta tabla nunca guarda HTML, solo texto plano con tokens {{nombre}}, {{fecha}}, etc. Historial append-only: una fila por versión, es_actual marca la vigente.';
comment on column public.plantillas_email_reserva.bloques is
  'Flags editoriales por tipo, p.ej. {"mostrar_boton_secundario": true, "mostrar_pie_contacto": true}. Ver el contrato completo (claves válidas por tipo) en la cabecera de emails-reserva/plantillas.ts.';

create unique index uq_plantilla_actual on public.plantillas_email_reserva (tipo) where es_actual;
create unique index uq_plantilla_tipo_version on public.plantillas_email_reserva (tipo, version);
create index idx_plantilla_tipo on public.plantillas_email_reserva (tipo, version desc);

-- Rollback reproducible: copia el CONTENIDO de una versión antigua a una
-- versión nueva y la marca actual. Nunca "resucita" la fila vieja (eso
-- rompería el historial append-only y dejaría huecos de versión si se
-- volviera a restaurar otra vez).
create or replace function public.fn_restaurar_version_plantilla(
  p_tipo text,
  p_version_a_restaurar integer,
  p_actor uuid default auth.uid()
)
returns public.plantillas_email_reserva
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_origen public.plantillas_email_reserva;
  v_siguiente integer;
  v_nueva public.plantillas_email_reserva;
begin
  -- SECURITY DEFINER se ejecuta como el propietario de la función, que por
  -- defecto SALTA la RLS de la tabla (no está en FORCE ROW LEVEL SECURITY).
  -- El GRANT EXECUTE de más abajo por sí solo dejaría entrar a cualquier
  -- `authenticated`, no solo a quien tiene permiso de la sección 'reservas'
  -- en el panel — se repite aquí a propósito el mismo chequeo que ya hacen
  -- las políticas RLS del resto del esquema.
  if not public.can_write_section('reservas') then
    raise exception 'No tienes permiso de escritura en la sección reservas';
  end if;

  select * into v_origen
    from public.plantillas_email_reserva
    where tipo = p_tipo and version = p_version_a_restaurar;

  if not found then
    raise exception 'No existe la version % de la plantilla %', p_version_a_restaurar, p_tipo;
  end if;

  select coalesce(max(version), 0) + 1 into v_siguiente
    from public.plantillas_email_reserva
    where tipo = p_tipo;

  update public.plantillas_email_reserva set es_actual = false where tipo = p_tipo and es_actual;

  insert into public.plantillas_email_reserva (
    tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal,
    texto_boton_secundario, pie, color_acento, color_oscuro, logo_url, bloques,
    nota_version, creado_por
  ) values (
    v_origen.tipo, v_siguiente, true, v_origen.asunto, v_origen.saludo, v_origen.cuerpo,
    v_origen.texto_boton_principal, v_origen.texto_boton_secundario, v_origen.pie,
    v_origen.color_acento, v_origen.color_oscuro, v_origen.logo_url, v_origen.bloques,
    'Restaurada desde la version ' || p_version_a_restaurar, p_actor
  )
  returning * into v_nueva;

  return v_nueva;
end;
$$;

comment on function public.fn_restaurar_version_plantilla(text, integer, uuid) is
  'Contrato para el panel: "volver atrás" = duplicar el contenido de una version antigua como version nueva y marcarla actual. Nunca reescribe una version ya guardada.';

revoke all on function public.fn_restaurar_version_plantilla(text, integer, uuid) from public, anon;
grant execute on function public.fn_restaurar_version_plantilla(text, integer, uuid) to authenticated, service_role;

-- Semilla: contenido inicial de las 5 plantillas para que el sistema
-- funcione end-to-end sin depender de que el panel exista todavía (el panel
-- lo construirá otro agente después — ver el contrato en plantillas.ts).
insert into public.plantillas_email_reserva
  (tipo, version, es_actual, asunto, saludo, cuerpo, texto_boton_principal, texto_boton_secundario, pie, bloques, nota_version)
values
  (
    'solicitud_recibida', 1, true,
    'Hemos recibido tu solicitud - Casa Tomás',
    'Hola, {{nombre}}',
    E'Hemos recibido tu solicitud de reserva en Casa Tomás. Nuestro equipo la revisará y te confirmaremos la disponibilidad a la mayor brevedad posible.\n\nNo es necesario que hagas nada más. Recibirás un correo en cuanto esté todo listo.',
    null, null,
    'Casa Tomás · Crevillente',
    '{"mostrar_tabla_detalles": true, "mostrar_pie_contacto": true}'::jsonb,
    'Version inicial (migracion 20260920010000)'
  ),
  (
    'propuesta', 1, true,
    'Confirma tu reserva - Casa Tomás',
    'Hola, {{nombre}}',
    E'Tu mesa está casi lista. Revisa los datos de tu reserva y confirma tu asistencia para garantizarla.',
    'Sí, confirmo mi asistencia', 'No puedo, cancelar reserva',
    'Si no confirmas, la mesa puede quedar disponible para otros clientes.',
    '{"mostrar_tabla_detalles": true, "mostrar_boton_secundario": true, "mostrar_pie_contacto": true}'::jsonb,
    'Version inicial (migracion 20260920010000)'
  ),
  (
    'confirmada', 1, true,
    'Reserva confirmada - Casa Tomás',
    'Gracias, {{nombre}}',
    E'Tu reserva en Casa Tomás queda confirmada. Te esperamos.',
    null, null,
    'Si necesitas modificarla o cancelarla, llámanos con antelación.',
    '{"mostrar_tabla_detalles": true, "mostrar_pie_contacto": true}'::jsonb,
    'Version inicial (migracion 20260920010000)'
  ),
  (
    'rechazada', 1, true,
    'Estado de tu reserva - Casa Tomás',
    'Estimado/a {{nombre}}',
    E'Lamentamos informarte de que no ha sido posible confirmar tu reserva para los datos solicitados.\n\nSi lo deseas, contacta con nosotros por teléfono para buscar una alternativa.',
    null, null,
    'Casa Tomás · Crevillente',
    '{"mostrar_tabla_detalles": true, "mostrar_pie_contacto": true}'::jsonb,
    'Version inicial (migracion 20260920010000)'
  ),
  (
    'recordatorio', 1, true,
    'Te esperamos pasado mañana - Casa Tomás',
    'Hola, {{nombre}}',
    E'Este es un recordatorio de tu reserva en Casa Tomás dentro de dos días. Si ha cambiado algo, avísanos con tiempo.',
    null, null,
    'Casa Tomás · Crevillente',
    '{"mostrar_tabla_detalles": true, "mostrar_pie_contacto": true}'::jsonb,
    'Version inicial (migracion 20260920010000)'
  );


-- ============================================================================
-- PIEZA 3a — REGISTRO DE ENVÍOS (idempotencia real)
-- ----------------------------------------------------------------------------
-- `enviar-newsletter` durante mucho tiempo no registraba nada por
-- destinatario (solo un contador de campaña); si el cron se reintenta, ese
-- diseño reenviaría a todo el mundo. Aquí la unidad de idempotencia es
-- (reserva_id, tipo_email), con un índice único PARCIAL que solo restringe
-- las filas "activas" (pendiente | enviado):
--
--   1. Para mandar, se intenta INSERT ... resultado='pendiente'. Si choca
--      con el índice (ya hay un pendiente o un enviado para ese par), se
--      trata como "ya reclamado" y no se llama a Resend — esto evita
--      mandar dos veces aunque dos ejecuciones se solapen en el tiempo,
--      no solo cuando se ejecutan en serie.
--   2. Tras llamar a Resend, esa misma fila pasa a 'enviado' (éxito,
--      guardando el id de Resend) o a 'fallido' (error, guardando el
--      motivo). 'fallido' NO cuenta para el índice único, así que libera
--      el hueco para un reintento futuro.
--   3. Una fila 'pendiente' más vieja que EMAILS_RESERVA_RECLAMO_MINUTOS
--      (ver emails-reserva/resend-lote.ts) se considera abandonada (la
--      función murió a media ejecución) y se reclama como 'fallido' antes
--      de procesar el lote siguiente — así nunca queda bloqueada para
--      siempre.
--
-- `resend_id` permite además cruzar cada envío con `email_eventos`
-- (poblada por supabase/functions/resend-webhook, ya existente y genérica
-- para cualquier remitente) y ver aperturas/rebotes sin tabla nueva.
-- ============================================================================

create table public.envios_email_reserva (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  tipo_email text not null check (tipo_email in ('solicitud_recibida', 'propuesta', 'confirmada', 'rechazada', 'recordatorio')),
  destinatario text not null,
  plantilla_id uuid references public.plantillas_email_reserva(id) on delete set null,
  resultado text not null default 'pendiente' check (resultado in ('pendiente', 'enviado', 'fallido')),
  resend_id text,
  error text,
  intentos integer not null default 1,
  creado_at timestamptz not null default now(),
  enviado_at timestamptz
);

comment on table public.envios_email_reserva is
  'Registro de cada intento de correo de reserva. La unidad de idempotencia es (reserva_id, tipo_email): ver uq_envio_email_reserva_activo. resend_id cruza con email_eventos (tabla de resend-webhook) para tracking de apertura/rebote.';

create unique index uq_envio_email_reserva_activo
  on public.envios_email_reserva (reserva_id, tipo_email)
  where resultado in ('pendiente', 'enviado');

create index idx_envios_reserva on public.envios_email_reserva (reserva_id);
create index idx_envios_pendientes_antiguos on public.envios_email_reserva (creado_at) where resultado = 'pendiente';


-- ============================================================================
-- PIEZA 3b — PROGRAMACIÓN DEL RECORDATORIO T-2 y DETECCIÓN DE AUSENCIAS
-- ----------------------------------------------------------------------------
-- DECISIÓN: instalar pg_net y programar con pg_cron en esta migración, en
-- vez de configurar el planificador del panel de Supabase a mano.
--
-- Pros de pg_net + migración (elegido):
--   + Reproducible: una branch nueva o un `db reset` recrean el cron sin
--     pasos manuales fuera de git (coherente con delete-old-call-logs, que
--     ya sigue este patrón).
--   + Auditable en el propio repo: el "qué se ejecuta y cuándo" es texto
--     revisable en PR, no un clic en un dashboard que nadie más ve.
--   + El secreto NO viaja en el fichero: se referencia por nombre desde
--     Supabase Vault (vault.decrypted_secrets), nunca en texto plano en git.
-- Contras (asumidos):
--   - Requiere el paso manual de `select vault.create_secret(...)` UNA VEZ
--     tras aplicar la migración (no puede automatizarse sin poner el
--     secreto en el propio fichero — ver checklist al final).
--   - pg_net añade un extension/worker más a mantener.
--
-- Pros del planificador del panel de Supabase (descartado):
--   + Cero SQL que escribir; UI guiada, gestiona el secreto por ti.
--   + Igual de válido si el equipo prefiere configuración fuera de git.
-- Contras (por qué se descarta aquí):
--   - No queda ninguna traza en el repositorio: otro agente (o el dueño en
--     seis meses) no puede ver qué cron existe leyendo el código.
--   - Hay que repetirlo a mano en cada entorno (branches de Supabase,
--     entorno de pruebas) — ya hay precedente de justo este problema en
--     este proyecto (ver `supabase/rollbacks/README.md` y el aviso de
--     `20260228151635_...sql` sobre cambios aplicados solo por dashboard).
--
-- Se instala pg_net aquí porque hoy NO lo usa nada más: la migración de
-- "noticias" que iba a instalarlo (20260919120001, nunca aplicada, ver
-- `docs/REVISION-PUERTOS-N8N.md`) no es la que termina necesitándolo.
-- ============================================================================

create extension if not exists pg_net;

-- Secreto compartido que emails-reserva exige en la cabecera
-- `x-webhook-secret` de sus rutas internas (/notificar, /recordatorios,
-- /detectar-ausencias). emails-reserva tiene verify_jwt=false (rutas GET de
-- cliente sin cabeceras, igual que reservas-web y newsletter-baja), así que
-- ese secreto —no el gateway— es la autenticación real de las rutas
-- internas, y FALLA CERRADO si falta (a diferencia de checkSharedSecret en
-- reservas-web hoy, ver docs/REVISION-PUERTOS-N8N.md A-3: aquí se decide no
-- repetir ese fallo).
--
-- PASO MANUAL OBLIGATORIO tras aplicar esta migración (no se puede hacer
-- desde una migración sin dejar el secreto en texto plano en git):
--   select vault.create_secret('<valor-aleatorio-largo>', 'emails_reserva_cron_secret');
-- y el MISMO valor como secret de la Edge Function:
--   supabase secrets set EMAILS_RESERVA_SHARED_SECRET=<el-mismo-valor>
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'emails_reserva_cron_secret') then
    raise notice 'PENDIENTE: falta "select vault.create_secret(''<valor>'', ''emails_reserva_cron_secret'')". Hasta entonces los crons de emails-reserva llamaran sin cabecera x-webhook-secret y la funcion los rechazara (falla cerrado a proposito).';
  end if;
end;
$$;

select cron.unschedule('emails-reserva-recordatorios-t2') where exists (
  select 1 from cron.job where jobname = 'emails-reserva-recordatorios-t2'
);

-- Recordatorio a T-2 dias: una vez al dia, 08:00 UTC (~09:00-10:00 Madrid,
-- fuera de los dos turnos de servicio). El endpoint es idempotente por si
-- este job se reintenta o se solapa (ver PIEZA 3a) y procesa en lotes (ver
-- emails-reserva/resend-lote.ts) para no saturar el limite de Resend
-- (10 req/s por defecto en toda la cuenta, verificado en
-- resend.com/docs/api-reference/rate-limit).
--
-- La URL del proyecto se deja literal (no es secreta: ya viaja en el
-- bundle publico de las 3 webs dentro de la publishable key, y en
-- supabase/.temp/project-ref versionable). El unico valor que va por Vault
-- es el secreto que autentica la llamada.
select cron.schedule(
  'emails-reserva-recordatorios-t2',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/emails-reserva/recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'emails_reserva_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

select cron.unschedule('emails-reserva-detectar-ausencias') where exists (
  select 1 from cron.job where jobname = 'emails-reserva-detectar-ausencias'
);

-- Deteccion de ausencias: una vez al dia, 04:00 UTC (~05:00-06:00 Madrid),
-- con margen suficiente para que haya pasado el turno de cena mas tardio
-- (servicio hasta ~23:30 + margen de gracia, ver ausencias.ts) del dia
-- anterior antes de evaluar quien no se presento.
select cron.schedule(
  'emails-reserva-detectar-ausencias',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/emails-reserva/detectar-ausencias',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'emails_reserva_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

comment on extension pg_net is
  'Instalada por 20260920010000_sistema_emails_reserva.sql para que pg_cron pueda invocar Edge Functions (recordatorio T-2 y deteccion de ausencias). No la usaba nada mas en este proyecto antes de esta migracion.';


-- ============================================================================
-- PIEZA 4 — AUSENCIA SIN AVISAR → SUGERENCIA DE LISTA NEGRA (nunca veto automático)
-- ----------------------------------------------------------------------------
-- `blacklist` ya existe (id, tipo, valor, nombre, motivo, created_at,
-- updated_at). Le faltan los tres campos que exige tratar esto como lo que
-- es — un veto sobre una persona, no un simple flag técnico:
--   aprobado_por  — quién lo autorizó (un humano, nunca el cron)
--   aprobada_en   — cuándo se aprobó (created_at es cuándo se detectó/creó
--                   la sugerencia asociada, no lo mismo)
--   caduca_el     — un veto perpetuo es desproporcionado (RGPD: dato
--                   personal con finalidad y plazo, no indefinido)
-- Todas NULLABLE a propósito: la fila ya existente (1 hoy) y cualquier alta
-- manual desde GestionBlacklist.tsx (no es mío, no le exijo estos campos)
-- siguen funcionando sin ellos.
-- ============================================================================

alter table public.blacklist add column if not exists aprobado_por uuid references auth.users(id) on delete set null;
alter table public.blacklist add column if not exists aprobada_en timestamptz;
alter table public.blacklist add column if not exists caduca_el date;

comment on column public.blacklist.aprobado_por is 'Usuario que aprobó esta entrada (NULL si se dio de alta manualmente antes de este campo, o desde GestionBlacklist.tsx sin pasar por una sugerencia).';
comment on column public.blacklist.aprobada_en is 'Cuándo se aprobó la entrada (vía fn_aprobar_sugerencia_blacklist). NULL si no viene de una sugerencia.';
comment on column public.blacklist.caduca_el is 'Fecha a partir de la cual esta entrada deja de aplicar. NULL = sin caducidad definida (no recomendado para entradas nuevas; ver informe). No hay job de purga automática todavía — el filtro por caducidad lo debe aplicar quien consulte la tabla.';

create index if not exists idx_blacklist_caduca_el on public.blacklist (caduca_el) where caduca_el is not null;

-- --- Sugerencias -------------------------------------------------------
create table public.sugerencias_blacklist (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  telefono text,
  email text,
  nombre_cliente text,
  motivo text not null default 'no_show',
  historial jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  blacklist_id uuid references public.blacklist(id) on delete set null,
  creada_at timestamptz not null default now(),
  revisada_por uuid references auth.users(id) on delete set null,
  revisada_at timestamptz,
  nota_revision text
);

comment on table public.sugerencias_blacklist is
  'Propuestas de veto generadas automaticamente (hoy: por ausencia sin avisar). NUNCA escriben blacklist directamente — el paso pendiente->aprobada solo ocurre via fn_aprobar_sugerencia_blacklist, invocado por un humano desde el panel (bandeja de aprobacion: la construye otro agente). "historial" es una FOTO en el momento de crear la sugerencia (conteos de no_show/completadas previas de ese telefono), para que quien apruebe vea el contexto sin tener que reconstruirlo.';

create unique index uq_sugerencia_por_reserva on public.sugerencias_blacklist (reserva_id);
create index idx_sugerencias_estado on public.sugerencias_blacklist (estado) where estado = 'pendiente';
create index idx_sugerencias_telefono on public.sugerencias_blacklist (telefono) where telefono is not null;

-- Aprobar: unico camino para que una sugerencia se convierta en blacklist.
-- Atomico (una sola transaccion): inserta en blacklist Y marca la
-- sugerencia, o no hace ninguna de las dos cosas.
create or replace function public.fn_aprobar_sugerencia_blacklist(
  p_sugerencia_id uuid,
  p_caduca_el date,
  p_motivo text default null,
  p_actor uuid default auth.uid()
)
returns public.blacklist
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sug public.sugerencias_blacklist;
  v_tipo text;
  v_valor text;
  v_blacklist public.blacklist;
begin
  -- Ver el comentario equivalente en fn_restaurar_version_plantilla: SECURITY
  -- DEFINER salta la RLS de la tabla, así que el permiso de sección se
  -- comprueba aquí explícitamente y no solo vía GRANT EXECUTE.
  if not public.can_write_section('reservas') then
    raise exception 'No tienes permiso de escritura en la sección reservas';
  end if;

  if p_caduca_el is null or p_caduca_el <= current_date then
    raise exception 'caduca_el es obligatorio y debe ser una fecha futura (veto perpetuo no permitido por esta funcion)';
  end if;

  select * into v_sug from public.sugerencias_blacklist where id = p_sugerencia_id for update;
  if not found then
    raise exception 'No existe la sugerencia %', p_sugerencia_id;
  end if;
  if v_sug.estado <> 'pendiente' then
    raise exception 'La sugerencia % ya esta en estado %, no se puede aprobar de nuevo', p_sugerencia_id, v_sug.estado;
  end if;

  -- Prioridad telefono sobre email, igual que el resto del dominio de
  -- reservas (verificarBlacklist en reservas-web/vapi-webhook.js trata el
  -- telefono como identificador primario).
  if v_sug.telefono is not null then
    v_tipo := 'telefono';
    v_valor := v_sug.telefono;
  elsif v_sug.email is not null then
    v_tipo := 'email';
    v_valor := v_sug.email;
  else
    raise exception 'La sugerencia % no tiene telefono ni email con los que dar de alta el veto', p_sugerencia_id;
  end if;

  insert into public.blacklist (tipo, valor, nombre, motivo, aprobado_por, aprobada_en, caduca_el)
  values (v_tipo, v_valor, v_sug.nombre_cliente, coalesce(p_motivo, 'Ausencia sin avisar (' || v_sug.motivo || ')'), p_actor, now(), p_caduca_el)
  on conflict (tipo, valor) do update
    set motivo = excluded.motivo,
        aprobado_por = excluded.aprobado_por,
        aprobada_en = excluded.aprobada_en,
        caduca_el = excluded.caduca_el,
        updated_at = now()
  returning * into v_blacklist;

  update public.sugerencias_blacklist
    set estado = 'aprobada', blacklist_id = v_blacklist.id, revisada_por = p_actor, revisada_at = now()
    where id = p_sugerencia_id;

  return v_blacklist;
end;
$$;

comment on function public.fn_aprobar_sugerencia_blacklist(uuid, date, text, uuid) is
  'Unico camino soportado para pasar una sugerencia a blacklist real. Exige caduca_el futuro (no se puede vetar sin plazo). Si ya existe una fila blacklist con el mismo (tipo,valor) actualiza motivo/caduca_el en vez de duplicar (UNIQUE(tipo,valor) ya existente).';

create or replace function public.fn_rechazar_sugerencia_blacklist(
  p_sugerencia_id uuid,
  p_nota text default null,
  p_actor uuid default auth.uid()
)
returns public.sugerencias_blacklist
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sug public.sugerencias_blacklist;
begin
  if not public.can_write_section('reservas') then
    raise exception 'No tienes permiso de escritura en la sección reservas';
  end if;

  select * into v_sug from public.sugerencias_blacklist where id = p_sugerencia_id for update;
  if not found then
    raise exception 'No existe la sugerencia %', p_sugerencia_id;
  end if;
  if v_sug.estado <> 'pendiente' then
    raise exception 'La sugerencia % ya esta en estado %', p_sugerencia_id, v_sug.estado;
  end if;

  update public.sugerencias_blacklist
    set estado = 'rechazada', revisada_por = p_actor, revisada_at = now(), nota_revision = p_nota
    where id = p_sugerencia_id
    returning * into v_sug;

  return v_sug;
end;
$$;

comment on function public.fn_rechazar_sugerencia_blacklist(uuid, text, uuid) is
  'Descarta una sugerencia sin tocar blacklist. Un no-show puede ser culpa del restaurante — esta funcion es el "no" explicito de esa revision humana.';

revoke all on function public.fn_aprobar_sugerencia_blacklist(uuid, date, text, uuid) from public, anon;
revoke all on function public.fn_rechazar_sugerencia_blacklist(uuid, text, uuid) from public, anon;
grant execute on function public.fn_aprobar_sugerencia_blacklist(uuid, date, text, uuid) to authenticated, service_role;
grant execute on function public.fn_rechazar_sugerencia_blacklist(uuid, text, uuid) to authenticated, service_role;


-- ============================================================================
-- RLS — mismo patron que 20260918120000_rls_por_permisos_de_seccion.sql:
-- seccion 'reservas' (can_read_section / can_write_section), service_role
-- explicito por si algun dia se retira BYPASSRLS, y SIN acceso de anon
-- (defensa en profundidad: Supabase concede privilegios por defecto a anon
-- sobre el esquema public y aqui no hace falta, a diferencia del INSERT
-- publico que sí necesita `reservas`).
-- ============================================================================

alter table public.plantillas_email_reserva enable row level security;
alter table public.envios_email_reserva enable row level security;
alter table public.sugerencias_blacklist enable row level security;

create policy "plantillas_email_reserva_select_seccion" on public.plantillas_email_reserva
  for select to authenticated using (public.can_read_section('reservas'));
create policy "plantillas_email_reserva_insert_seccion" on public.plantillas_email_reserva
  for insert to authenticated with check (public.can_write_section('reservas'));
create policy "plantillas_email_reserva_update_seccion" on public.plantillas_email_reserva
  for update to authenticated using (public.can_write_section('reservas')) with check (public.can_write_section('reservas'));
create policy "plantillas_email_reserva_delete_seccion" on public.plantillas_email_reserva
  for delete to authenticated using (public.can_write_section('reservas'));
create policy "plantillas_email_reserva_service_role" on public.plantillas_email_reserva
  for all to service_role using (true) with check (true);
revoke select on public.plantillas_email_reserva from anon;

create policy "envios_email_reserva_select_seccion" on public.envios_email_reserva
  for select to authenticated using (public.can_read_section('reservas'));
create policy "envios_email_reserva_service_role" on public.envios_email_reserva
  for all to service_role using (true) with check (true);
revoke select on public.envios_email_reserva from anon;
-- Sin insert/update/delete para `authenticated` a proposito: este registro
-- solo lo escribe la Edge Function (service_role). El panel solo lee, para
-- que nadie pueda maquillar el historial de envios desde la UI.

create policy "sugerencias_blacklist_select_seccion" on public.sugerencias_blacklist
  for select to authenticated using (public.can_read_section('reservas'));
create policy "sugerencias_blacklist_update_seccion" on public.sugerencias_blacklist
  for update to authenticated using (public.can_write_section('reservas')) with check (public.can_write_section('reservas'));
create policy "sugerencias_blacklist_service_role" on public.sugerencias_blacklist
  for all to service_role using (true) with check (true);
revoke select on public.sugerencias_blacklist from anon;
-- Sin insert para `authenticated`: las sugerencias solo las crea la deteccion
-- automatica (service_role). El UPDATE de arriba es para que la futura
-- bandeja de aprobacion pueda llamar a las funciones fn_aprobar_.../
-- fn_rechazar_..., que son SECURITY DEFINER pero igualmente conviene que la
-- fila sea legible/editable por quien tiene permiso de la seccion.

commit;

-- ============================================================================
-- CHECKLIST POST-MIGRACIÓN (no lo hace esta migración; son pasos del dueño
-- o de quien despliegue, fuera del alcance de "no apliques migraciones, no
-- despliegues" de este encargo):
--
--   1. select vault.create_secret('<valor-aleatorio-largo>', 'emails_reserva_cron_secret');
--   2. supabase secrets set EMAILS_RESERVA_SHARED_SECRET=<mismo-valor-que-1>
--   3. supabase secrets set EMAILS_RESERVA_TOKEN_SECRET=<otro-valor-aleatorio>
--      -- firma HMAC de los enlaces aceptar/rechazar de la contraoferta
--   4. Confirmar RESEND_API_KEY y RESEND_FROM_EMAIL ya provisionados (ver
--      informe: hoy caen al sandbox de Resend, que no entrega a clientes).
--   5. supabase functions deploy emails-reserva
--   6. supabase functions deploy notify-reservation-change  (contrato de
--      payload sin cambios; solo cambia a dónde reenvía internamente)
--   7. Si el proyecto cambia de ref/URL alguna vez, actualizar la URL
--      literal dentro de los dos cron.schedule(...) de esta migración (o
--      sustituirla por una migración nueva que reprograme los jobs).
-- ============================================================================
