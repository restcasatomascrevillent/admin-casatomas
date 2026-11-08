-- ===========================================================================
--  Super Admin › Logs: actividad de la web, errores e incidencias (Linear)
--
--  Sin aplicar en producción: demo primero (sfonaclosuafvlhutkon); producción
--  (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del dueño.
--  Idempotente. Tiene que terminar en «logs_web: aplicada».
--  Deshacer: supabase/rollbacks/20261118100000_logs_web_ROLLBACK.sql
--  Pruebas: npm run test:logs-web:db (PGlite). Documentación: docs/LOGS-WEB.md
--
--  Flujo:
--    navegador (web-casatomas, src/lib/actividad) --lotes text/plain-->
--    Edge Function `registrar-actividad-web` (valida, sanea, clasifica) -->
--    web_logs_ingerir() --> web_eventos + web_sesiones (+ contadores).
--    Funciones del servidor (audit-client) y recolectores (cron, despliegues,
--    integraciones) escriben por la misma RPC con fuente servidor/hosting/…
--    Cada 5 min, pg_cron --> `procesar-logs-web`: web_logs_agrupar_errores()
--    agrupa por huella en web_incidencias, aplica umbrales y la función crea o
--    actualiza el ticket en Linear (o en el destino de pruebas
--    web_linear_prueba), con análisis de IA de la incidencia agrupada.
--    Panel: Super Admin › Logs y la sección «Comportamiento» de Tráfico web
--    leen con las RPC web_* (solo super admin, comprobado aquí con RLS).
--
--  Cuatro cosas distintas, cuatro sitios:
--    · Actividad del usuario  → web_eventos.categoria in ('actividad','operacion')
--                               ('operacion' = operación COMPLETADA, no el clic)
--    · Peticiones técnicas    → web_eventos.categoria = 'tecnico'
--    · Errores                → web_eventos.categoria = 'error'
--    · Incidencias agrupadas  → web_incidencias (una por entorno + huella)
--
--  Datos personales: ni IP (solo un HMAC de la IP con sal diaria para el
--  límite por minuto, en web_logs_limite_ip, borrado a la hora), ni contenido
--  libre de formularios, ni texto de búsquedas, ni datos de pago. Los
--  identificadores de sesión y visitante son UUID aleatorios seudónimos que el
--  navegador solo crea con el consentimiento «Estadísticas». La función de
--  ingesta sanea textos (correos, teléfonos, tokens, query strings) ANTES de
--  llamar a esta RPC; los CHECK de longitud son la última barrera.
--
--  AUDITORÍA: las tablas de datos derivados (eventos, sesiones, incidencias,
--  contadores) entran en la lista de exclusión de instalar_auditoria_panel()
--  y fn_audit_nueva_tabla() (como ia_uso); la configuración SÍ se audita.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'logs_web: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. Auditoría: las tablas derivadas entran en la lista de exclusión ─────
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('instalar_auditoria_panel', 'fn_audit_nueva_tabla')
  loop
    if position('''ia_uso'',' in v_def) > 0 and position('''web_eventos''' in v_def) = 0 then
      execute replace(v_def, '''ia_uso'',',
        '''ia_uso'',''web_eventos'',''web_sesiones'',''web_incidencias'',''web_logs_estado'',''web_logs_ingesta_diaria'',''web_logs_limite_ip'',''web_linear_prueba'',''web_resumenes_ia'',''web_eventos_catalogo'',');
    end if;
  end loop;
end;
$$;

-- ─── 1. Configuración (fila única, editable por super admin) ────────────────
create table if not exists public.web_logs_config (
  id boolean primary key default true check (id),
  -- Fuentes
  recoger_actividad          boolean not null default true,
  recoger_errores_navegador  boolean not null default true,
  recoger_peticiones         boolean not null default true,
  recoger_errores_servidor   boolean not null default true,
  recoger_integraciones      boolean not null default true,
  recoger_hosting            boolean not null default true,
  -- Entornos: de cuáles se aceptan eventos y cuáles pueden abrir tickets.
  entornos_aceptados  text[] not null default array['produccion', 'demo'],
  entornos_ticket     text[] not null default array['produccion'],
  -- Exclusiones
  rutas_excluidas     text[] not null default array[]::text[],
  mensajes_ignorados  text[] not null default array[
    'ResizeObserver loop', 'Script error.', 'chrome-extension://', 'moz-extension://', 'safari-extension://',
    'Non-Error promise rejection captured', 'AbortError'
  ],
  -- Umbrales de ticket
  umbral_ocurrencias      integer not null default 3  check (umbral_ocurrencias between 1 and 100000),
  umbral_sesiones         integer not null default 2  check (umbral_sesiones between 1 and 100000),
  umbral_ventana_horas    integer not null default 24 check (umbral_ventana_horas between 1 and 720),
  tickets_404             boolean not null default false,
  umbral_404_diario       integer not null default 20 check (umbral_404_diario between 1 and 100000),
  excluir_pruebas_tickets boolean not null default true,
  reapertura              text    not null default 'reabrir' check (reapertura in ('reabrir', 'nuevo_ticket', 'ignorar')),
  -- Retención y límites de coste
  retencion_actividad_dias integer not null default 90  check (retencion_actividad_dias between 7 and 400),
  retencion_errores_dias   integer not null default 180 check (retencion_errores_dias between 7 and 730),
  limite_eventos_dia       integer not null default 50000 check (limite_eventos_dia between 100 and 2000000),
  limite_eventos_sesion    integer not null default 400   check (limite_eventos_sesion between 20 and 5000),
  limite_eventos_ip_minuto integer not null default 300   check (limite_eventos_ip_minuto between 10 and 10000),
  -- Linear (la clave LINEAR_API_KEY vive en los secretos de la función, nunca aquí)
  linear_modo              text not null default 'prueba' check (linear_modo in ('desactivado', 'prueba', 'real')),
  linear_equipo_id         text check (linear_equipo_id is null or linear_equipo_id ~ '^[A-Za-z0-9-]{1,64}$'),
  linear_proyecto_id       text check (linear_proyecto_id is null or linear_proyecto_id ~ '^[A-Za-z0-9-]{1,64}$'),
  linear_etiquetas         text[] not null default array[]::text[],
  linear_estado_reabrir_id text check (linear_estado_reabrir_id is null or linear_estado_reabrir_id ~ '^[A-Za-z0-9-]{1,64}$'),
  linear_max_tickets_dia   integer not null default 10 check (linear_max_tickets_dia between 0 and 500),
  -- IA (solo sobre incidencias agrupadas y estadísticas agregadas, nunca por visita)
  ia_activada              boolean not null default true,
  ia_max_analisis_dia      integer not null default 20 check (ia_max_analisis_dia between 0 and 500),
  -- Entorno de ESTA base de datos (para los eventos que nacen en la BD).
  entorno_bd               text not null default 'produccion' check (entorno_bd in ('produccion', 'demo', 'local')),
  actualizado_en           timestamptz not null default now(),
  actualizado_por          uuid,
  constraint web_logs_config_entornos_chk check (
    entornos_aceptados <@ array['produccion', 'demo', 'local'] and entornos_ticket <@ array['produccion', 'demo', 'local']),
  constraint web_logs_config_listas_chk check (
    cardinality(rutas_excluidas) <= 50 and cardinality(mensajes_ignorados) <= 100 and cardinality(linear_etiquetas) <= 10)
);
comment on table public.web_logs_config is
  'Super Admin › Logs › Configuración: fuentes, entornos, exclusiones, umbrales de ticket, retención, límites de coste, Linear e IA. Fila única. Las credenciales (LINEAR_API_KEY, OpenAI) son secretos de las Edge Functions.';

-- La demo es una copia de producción: se marca por el project_url de Vault
-- (SQL dinámico: donde no hay Vault, como en las pruebas, no se consulta).
insert into public.web_logs_config (id) values (true) on conflict (id) do nothing;
do $$
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$
      update public.web_logs_config set entorno_bd = 'demo'
       where id and entorno_bd <> 'demo'
         and exists (select 1 from vault.decrypted_secrets
                      where name = 'project_url' and decrypted_secret like '%sfonaclosuafvlhutkon%')
    $q$;
  end if;
end;
$$;

create or replace function public.web_logs_config_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := coalesce(auth.uid(), old.actualizado_por);
  return new;
end;
$$;
revoke all on function public.web_logs_config_al_editar() from public, anon, authenticated;
drop trigger if exists web_logs_config_al_editar on public.web_logs_config;
create trigger web_logs_config_al_editar before update on public.web_logs_config
  for each row execute function public.web_logs_config_al_editar();

-- La configuración se audita (la demo no tiene el event trigger de tablas nuevas).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.web_logs_config'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.web_logs_config';
    execute 'create trigger trg_auditoria after insert or update or delete on public.web_logs_config
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- ─── 2. Catálogo: qué actividad se puede observar ───────────────────────────
create table if not exists public.web_eventos_catalogo (
  tipo                    text primary key check (tipo ~ '^[a-z0-9_]{2,40}$'),
  categoria               text not null check (categoria in ('actividad', 'operacion', 'tecnico', 'error')),
  fuente                  text not null check (fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')),
  operacion               text check (operacion in ('reserva', 'cheque', 'contacto', 'carta', 'pedido')),
  etapa_embudo            smallint check (etapa_embudo between 1 and 4),
  requiere_consentimiento boolean not null default true,
  descripcion             text not null,
  orden                   smallint not null default 100
);
comment on table public.web_eventos_catalogo is
  'Tipos de evento que existen y qué significan (Super Admin › Logs › Cobertura). etapa_embudo: 1 entrada, 2 consulta, 3 inicio de operación, 4 operación completada. El «desde cuándo» se calcula con el primer evento recibido de cada tipo: no hay históricos anteriores.';

insert into public.web_eventos_catalogo (tipo, categoria, fuente, operacion, etapa_embudo, requiere_consentimiento, descripcion, orden) values
  ('pagina_vista',           'actividad', 'navegador', null,       1,    true,  'Página vista (entrada, procedencia y orden de navegación). Navegación en cliente incluida.', 10),
  ('pagina_salida',          'actividad', 'navegador', null,       null, true,  'Fin de una página: tiempo de actividad visible (delta en ms) y profundidad máxima de scroll. «Última página observada», no salida confirmada.', 11),
  ('scroll',                 'actividad', 'navegador', null,       null, true,  'Hito de scroll (25, 50, 75 o 100 % de la página).', 12),
  ('clic',                   'actividad', 'navegador', null,       null, true,  'Clic en botón, enlace o llamada a la acción (texto visible o data-track, nunca valores de campos).', 20),
  ('contacto',               'actividad', 'navegador', 'contacto', null, true,  'Clic en teléfono, WhatsApp, correo, mapa o red social. Es un clic: no confirma que la llamada o el mensaje se hicieran.', 21),
  ('carta_categoria',        'actividad', 'navegador', 'carta',    2,    true,  'Cambio o apertura de categoría de la carta.', 30),
  ('plato_abierto',          'actividad', 'navegador', 'carta',    2,    true,  'Ficha o información de un plato abierta.', 31),
  ('vino_abierto',           'actividad', 'navegador', 'carta',    2,    true,  'Ficha, información o copa de un vino abierta.', 32),
  ('bebida_abierta',         'actividad', 'navegador', 'carta',    2,    true,  'Información de una bebida o cóctel abierta.', 33),
  ('busqueda',               'actividad', 'navegador', 'carta',    null, true,  'Búsqueda en la carta: longitud y número de resultados. El texto buscado NO se guarda.', 34),
  ('filtro',                 'actividad', 'navegador', 'carta',    null, true,  'Filtro aplicado (tipo de vino, dieta, alérgenos, categoría).', 35),
  ('mapa_vinos',             'actividad', 'navegador', 'carta',    null, true,  'Interacción con el mapa de zonas de vino.', 36),
  ('pedido',                 'actividad', 'navegador', 'pedido',   null, true,  '«Mi mesa»: añadir, quitar o compartir el pedido orientativo (no es una compra).', 37),
  ('media',                  'actividad', 'navegador', null,       null, true,  'Imágenes y vídeos: abrir galería, reproducir, pausar, terminar.', 40),
  ('formulario',             'actividad', 'navegador', null,       3,    true,  'Formulario: inicio, avance (n.º de campos, nunca valores), envío, error de validación y abandono estimado.', 50),
  ('chat',                   'actividad', 'navegador', null,       null, true,  'Asistente «Tomy»: abrir, enviar mensaje (sin el texto), respuesta o error.', 51),
  ('reserva_disponibilidad', 'actividad', 'navegador', 'reserva',  2,    true,  'Consulta de disponibilidad: con huecos, completo, cerrado o error.', 60),
  ('reserva_solicitada',     'operacion', 'navegador', 'reserva',  4,    true,  'El servidor aceptó la solicitud de reserva (HTTP 201). Queda PENDIENTE de confirmar por el restaurante.', 61),
  ('reserva_rechazada',      'operacion', 'navegador', 'reserva',  null, true,  'El servidor rechazó la solicitud (motivo codificado, sin datos del cliente).', 62),
  ('cheque_checkout',        'actividad', 'navegador', 'cheque',   3,    true,  'Redirección al pago de Stripe de un cheque regalo (todavía no pagado).', 70),
  ('cheque_pagado',          'operacion', 'navegador', 'cheque',   4,    true,  'Vuelta de Stripe con el pago confirmado por el servidor.', 71),
  ('carga_pagina',           'tecnico',   'navegador', null,       null, true,  'Tiempos de carga de la página (TTFB, DOM listo, carga, LCP).', 80),
  ('peticion',               'tecnico',   'navegador', null,       null, true,  'Petición del navegador a una función del servidor: endpoint, código HTTP y duración (sin cuerpo).', 81),
  ('error_js',               'error',     'navegador', null,       null, false, 'Excepción de JavaScript no capturada (mensaje y pila saneados).', 90),
  ('error_promesa',          'error',     'navegador', null,       null, false, 'Promesa rechazada sin capturar.', 91),
  ('error_recurso',          'error',     'navegador', null,       null, false, 'Imagen, script o estilo que no cargó.', 92),
  ('error_peticion',         'error',     'navegador', null,       null, false, 'Petición a una función del servidor con 5xx o sin respuesta.', 93),
  ('error_react',            'error',     'navegador', null,       null, false, 'Error de pintado capturado por un límite de errores de React.', 94),
  ('error_404',              'error',     'navegador', null,       null, false, 'Página no encontrada (404). No abre ticket salvo umbral y si se activa en Configuración.', 95),
  ('error_servidor',         'error',     'servidor',  null,       null, false, 'Edge Function que respondió 5xx o lanzó una excepción (sin cuerpo de petición).', 100),
  ('error_integracion',      'error',     'integracion', null,     null, false, 'Integración o tarea programada con fallo (sincronizaciones, cron).', 101),
  ('error_despliegue',       'error',     'hosting',   null,       null, false, 'Despliegue de Vercel en estado ERROR.', 102),
  ('reserva_creada_bd',      'operacion', 'base_datos','reserva',  null, false, 'Reserva del canal web creada en la base de datos (todos los visitantes, con o sin consentimiento).', 110),
  ('reserva_confirmada_bd',  'operacion', 'base_datos','reserva',  null, false, 'Reserva del canal web que el restaurante confirma o verifica.', 111),
  ('cheque_pagado_bd',       'operacion', 'base_datos','cheque',   null, false, 'Cheque regalo comprado por la web que pasa a pagado en la base de datos.', 112)
on conflict (tipo) do update set
  categoria = excluded.categoria, fuente = excluded.fuente, operacion = excluded.operacion,
  etapa_embudo = excluded.etapa_embudo, requiere_consentimiento = excluded.requiere_consentimiento,
  descripcion = excluded.descripcion, orden = excluded.orden;

-- ─── 3. Incidencias agrupadas ───────────────────────────────────────────────
create table if not exists public.web_incidencias (
  id                   bigint generated always as identity primary key,
  entorno              text not null check (entorno in ('produccion', 'demo', 'local')),
  huella               text not null check (huella ~ '^[a-f0-9]{16,64}$'),
  titulo               text not null check (length(titulo) between 1 and 200),
  tipo                 text not null check (tipo ~ '^[a-z0-9_]{2,40}$'),
  fuente               text not null,
  proyecto             text not null,
  gravedad             text not null default 'error' check (gravedad in ('info', 'aviso', 'error', 'critico')),
  estado               text not null default 'nueva' check (estado in ('nueva', 'abierta', 'resuelta', 'reabierta', 'ignorada')),
  primera_vez          timestamptz not null,
  ultima_vez           timestamptz not null,
  ocurrencias          integer not null default 0,
  sesiones_afectadas   integer not null default 0,
  ocurrencias_ventana  integer not null default 0,
  sesiones_ventana     integer not null default 0,
  ocurrencias_24h      integer not null default 0,
  rutas                jsonb not null default '[]'::jsonb check (jsonb_typeof(rutas) = 'array'),
  version_primera      text,
  version_ultima       text,
  despliegue_ultimo    text,
  mensaje              text check (length(mensaje) <= 500),
  pila                 text check (length(pila) <= 4000),
  ejemplo_evento_id    bigint,
  -- Ticket
  requiere_ticket      boolean not null default false,
  motivo_ticket        text,
  linear_estado        text not null default 'sin_ticket'
                       check (linear_estado in ('sin_ticket', 'pendiente', 'creado', 'error', 'no_aplica')),
  linear_uuid          uuid not null default gen_random_uuid(),
  linear_issue_id      text,
  linear_identificador text,
  linear_url           text,
  linear_estado_remoto text,
  linear_destino       text check (linear_destino in ('prueba', 'real')),
  linear_intentos      integer not null default 0,
  linear_ultimo_error  text check (length(linear_ultimo_error) <= 500),
  linear_proximo_intento timestamptz,
  linear_bloqueo_hasta timestamptz,
  linear_ultima_sync   timestamptz,
  linear_creado_en     timestamptz,
  linear_pendiente_reapertura boolean not null default false,
  ocurrencias_en_ticket integer not null default 0,
  -- IA (hechos/hipótesis separados; ver procesar-logs-web/ia.ts)
  analisis_ia          jsonb,
  analisis_ia_en       timestamptz,
  analisis_ia_error    text check (length(analisis_ia_error) <= 500),
  -- Seguimiento
  resuelta_en          timestamptz,
  reabierta_veces      integer not null default 0,
  nota                 text check (length(nota) <= 2000),
  actualizado_en       timestamptz not null default now(),
  constraint web_incidencias_entorno_huella_key unique (entorno, huella)
);
comment on table public.web_incidencias is
  'Errores agrupados por huella estable (una fila por entorno + huella). La crea y recalcula web_logs_agrupar_errores(); el ticket lo crea procesar-logs-web con linear_uuid como id determinista (sin duplicados aunque se reintente). Un super admin puede cambiar estado y nota.';
create index if not exists web_incidencias_ultima_idx on public.web_incidencias (entorno, ultima_vez desc);
alter table public.web_incidencias add column if not exists linear_creado_en timestamptz;
create index if not exists web_incidencias_linear_idx on public.web_incidencias (linear_estado, linear_proximo_intento)
  where linear_estado in ('pendiente', 'error', 'creado');

-- ─── 4. Eventos ─────────────────────────────────────────────────────────────
create table if not exists public.web_eventos (
  id             bigint generated always as identity primary key,
  evento_id      uuid not null,
  recibido_en    timestamptz not null default now(),
  ocurrido_en    timestamptz not null,
  entorno        text not null check (entorno in ('produccion', 'demo', 'local')),
  proyecto       text not null check (proyecto ~ '^[a-z0-9-]{2,40}$'),
  fuente         text not null check (fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')),
  categoria      text not null check (categoria in ('actividad', 'operacion', 'tecnico', 'error')),
  tipo           text not null check (tipo ~ '^[a-z0-9_]{2,40}$'),
  accion         text check (accion ~ '^[a-z0-9_]{1,40}$'),
  sesion_id      uuid,
  visitante_id   uuid,
  secuencia      integer check (secuencia >= 0),
  ruta           text check (length(ruta) <= 300),
  objetivo       text check (length(objetivo) <= 200),
  valor          numeric,
  propiedades    jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(propiedades) = 'object' and length(propiedades::text) <= 4000),
  dispositivo    text check (dispositivo in ('movil', 'tablet', 'escritorio', 'desconocido')),
  navegador      text check (length(navegador) <= 40),
  so             text check (length(so) <= 40),
  es_bot         boolean not null default false,
  es_interno     boolean not null default false,
  es_prueba      boolean not null default false,
  consentimiento boolean not null default false,
  version        text check (length(version) <= 40),
  despliegue     text check (length(despliegue) <= 80),
  gravedad       text check (gravedad in ('info', 'aviso', 'error', 'critico')),
  huella         text check (huella ~ '^[a-f0-9]{16,64}$'),
  mensaje        text check (length(mensaje) <= 500),
  pila           text check (length(pila) <= 4000),
  incidencia_id  bigint references public.web_incidencias (id) on delete set null,
  constraint web_eventos_evento_id_key unique (evento_id),
  constraint web_eventos_error_huella_chk check (categoria <> 'error' or huella is not null)
);
comment on table public.web_eventos is
  'Eventos estructurados de la web y sus servicios. evento_id lo genera el emisor: reenvíos y reintentos no duplican. ocurrido_en = hora del emisor acotada a [recepción − 2 días, recepción + 5 min]. Sin IP ni contenido libre de formularios.';
create index if not exists web_eventos_ocurrido_idx on public.web_eventos (entorno, ocurrido_en desc);
create index if not exists web_eventos_sesion_idx on public.web_eventos (sesion_id, ocurrido_en, secuencia) where sesion_id is not null;
create index if not exists web_eventos_tipo_idx on public.web_eventos (tipo, ocurrido_en desc);
create index if not exists web_eventos_incidencia_idx on public.web_eventos (incidencia_id, ocurrido_en desc) where incidencia_id is not null;
create index if not exists web_eventos_sin_agrupar_idx on public.web_eventos (id) where categoria = 'error' and incidencia_id is null;
create index if not exists web_eventos_recibido_idx on public.web_eventos (fuente, recibido_en desc);

-- ─── 5. Sesiones (resumen exacto, recalculado desde web_eventos) ────────────
create table if not exists public.web_sesiones (
  sesion_id        uuid primary key,
  visitante_id     uuid,
  entorno          text not null,
  proyecto         text not null,
  inicio           timestamptz not null,
  ultima_actividad timestamptz not null,
  pagina_entrada   text,
  ultima_pagina    text,
  origen_tipo      text check (origen_tipo in ('buscador', 'campana', 'qr', 'red_social', 'enlace', 'directo', 'interno', 'desconocido')),
  origen_detalle   text check (length(origen_detalle) <= 200),
  campana          text check (length(campana) <= 200),
  idioma           text check (idioma in ('es', 'en', 'fr')),
  dispositivo      text,
  navegador        text,
  so               text,
  paginas_vistas   integer not null default 0,
  eventos          integer not null default 0,
  errores          integer not null default 0,
  scroll_max       smallint,
  tiempo_activo_ms bigint not null default 0,
  inicio_operacion boolean not null default false,
  conversiones     integer not null default 0,
  es_bot           boolean not null default false,
  es_interno       boolean not null default false,
  es_prueba        boolean not null default false,
  consentimiento   boolean not null default false,
  actualizado_en   timestamptz not null default now()
);
comment on table public.web_sesiones is
  'Una fila por sesión seudónima (30 min de inactividad). Se recalcula entera desde web_eventos en cada lote, bajo un advisory lock por sesión: lo que dice coincide con los eventos. ultima_pagina es la última OBSERVADA, no una salida confirmada.';
create index if not exists web_sesiones_inicio_idx on public.web_sesiones (entorno, inicio desc);
create index if not exists web_sesiones_visitante_idx on public.web_sesiones (visitante_id) where visitante_id is not null;

-- ─── 6. Estado, contadores, límite por IP, destino de pruebas, resúmenes ────
create table if not exists public.web_logs_estado (
  id                     boolean primary key default true check (id),
  ultimo_proceso_inicio  timestamptz,
  ultimo_proceso_fin     timestamptz,
  ultimo_proceso_ok      timestamptz,
  ultimo_error           text check (length(ultimo_error) <= 1000),
  ultimo_resumen         jsonb not null default '{}'::jsonb,
  cursores               jsonb not null default '{}'::jsonb,
  proceso_bloqueado_hasta timestamptz,
  ultima_purga           timestamptz
);
insert into public.web_logs_estado (id) values (true) on conflict (id) do nothing;

create table if not exists public.web_logs_ingesta_diaria (
  dia         date not null,
  entorno     text not null,
  aceptados   integer not null default 0,
  duplicados  integer not null default 0,
  descartados integer not null default 0,
  rechazados  integer not null default 0,
  bots        integer not null default 0,
  lotes       integer not null default 0,
  primary key (dia, entorno)
);
comment on table public.web_logs_ingesta_diaria is
  'Contadores de la ingesta por día (Europe/Madrid) y entorno: aceptados, duplicados (reenvíos), descartados (límites/filtros), rechazados (inválidos u origen no permitido), bots. Sirve para el aviso «la recogida ha dejado de funcionar» y para vigilar el coste.';

create table if not exists public.web_logs_limite_ip (
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{16,64}$'),
  minuto  timestamptz not null,
  n       integer not null default 0,
  primary key (ip_hash, minuto)
);
comment on table public.web_logs_limite_ip is 'HMAC (sal diaria) de la IP y eventos por minuto. Se borra pasada una hora. Nunca la IP en claro.';

create table if not exists public.web_linear_prueba (
  id            bigint generated always as identity primary key,
  creado_en     timestamptz not null default now(),
  incidencia_id bigint references public.web_incidencias (id) on delete cascade,
  operacion     text not null check (operacion in ('crear', 'comentar', 'reabrir', 'consultar')),
  linear_uuid   uuid,
  titulo        text,
  cuerpo        text check (length(cuerpo) <= 60000),
  prioridad     smallint,
  etiquetas     text[] not null default array[]::text[]
);
comment on table public.web_linear_prueba is
  'Destino de pruebas de Linear (linear_modo = prueba): lo que se mandaría a Linear, tal cual, para verificar el flujo sin tocar el Linear real.';

create table if not exists public.web_resumenes_ia (
  id          bigint generated always as identity primary key,
  creado_en   timestamptz not null default now(),
  creado_por  uuid,
  desde       date not null,
  hasta       date not null,
  entorno     text not null,
  cifras      jsonb not null,
  resumen     jsonb,
  modelo      text,
  estado      text not null check (estado in ('ok', 'error')),
  error       text check (length(error) <= 500),
  check (hasta >= desde)
);
create index if not exists web_resumenes_ia_periodo_idx on public.web_resumenes_ia (entorno, desde, hasta, creado_en desc);

-- Tablas derivadas: sin trigger de auditoría (por si el event trigger se lo puso).
drop trigger if exists trg_auditoria on public.web_eventos;
drop trigger if exists trg_auditoria on public.web_sesiones;
drop trigger if exists trg_auditoria on public.web_incidencias;
drop trigger if exists trg_auditoria on public.web_logs_estado;
drop trigger if exists trg_auditoria on public.web_logs_ingesta_diaria;
drop trigger if exists trg_auditoria on public.web_logs_limite_ip;
drop trigger if exists trg_auditoria on public.web_linear_prueba;
drop trigger if exists trg_auditoria on public.web_resumenes_ia;
drop trigger if exists trg_auditoria on public.web_eventos_catalogo;

-- ─── 7. RLS: solo super admin lee; solo service_role escribe ────────────────
do $$
declare
  t text;
begin
  foreach t in array array['web_logs_config', 'web_eventos_catalogo', 'web_incidencias', 'web_eventos', 'web_sesiones',
                           'web_logs_estado', 'web_logs_ingesta_diaria', 'web_logs_limite_ip', 'web_linear_prueba', 'web_resumenes_ia']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role', t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role', t);
    if t <> 'web_logs_limite_ip' then
      execute format('grant select on public.%I to authenticated', t);
      execute format('drop policy if exists %I on public.%I', t || '_select_super_admin', t);
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_super_admin((select auth.uid()))))',
                     t || '_select_super_admin', t);
    end if;
    if to_regprocedure('private.sesion_panel_permitida()') is not null then
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end if;
  end loop;
end;
$$;

-- Lo que un super admin puede cambiar desde el panel.
grant update (recoger_actividad, recoger_errores_navegador, recoger_peticiones, recoger_errores_servidor, recoger_integraciones,
              recoger_hosting, entornos_aceptados, entornos_ticket, rutas_excluidas, mensajes_ignorados, umbral_ocurrencias,
              umbral_sesiones, umbral_ventana_horas, tickets_404, umbral_404_diario, excluir_pruebas_tickets, reapertura,
              retencion_actividad_dias, retencion_errores_dias, limite_eventos_dia, limite_eventos_sesion, limite_eventos_ip_minuto,
              linear_modo, linear_equipo_id, linear_proyecto_id, linear_etiquetas, linear_estado_reabrir_id, linear_max_tickets_dia,
              ia_activada, ia_max_analisis_dia)
  on public.web_logs_config to authenticated;
drop policy if exists web_logs_config_update_super_admin on public.web_logs_config;
create policy web_logs_config_update_super_admin on public.web_logs_config for update to authenticated
  using ((select public.is_super_admin((select auth.uid())))) with check ((select public.is_super_admin((select auth.uid()))));

grant update (estado, nota) on public.web_incidencias to authenticated;
drop policy if exists web_incidencias_update_super_admin on public.web_incidencias;
create policy web_incidencias_update_super_admin on public.web_incidencias for update to authenticated
  using ((select public.is_super_admin((select auth.uid())))) with check ((select public.is_super_admin((select auth.uid()))));

-- Cambiar el estado a mano deja rastro coherente (resuelta_en, actualizado_en).
create or replace function public.web_incidencias_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'resuelta' then
      new.resuelta_en := now();
    elsif old.estado = 'resuelta' and new.estado in ('abierta', 'reabierta') then
      new.resuelta_en := null;
    end if;
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function public.web_incidencias_al_editar() from public, anon, authenticated;
drop trigger if exists web_incidencias_al_editar on public.web_incidencias;
create trigger web_incidencias_al_editar before update on public.web_incidencias
  for each row execute function public.web_incidencias_al_editar();

-- ─── 8. Ingesta (solo service_role) ─────────────────────────────────────────
-- p_eventos: array de eventos YA validados y saneados por la Edge Function.
-- p_ctx: { entorno, ip_hash? }. Devuelve { aceptados, duplicados, descartados, motivo? }.
create or replace function public.web_logs_ingerir(p_eventos jsonb, p_ctx jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_entorno text := p_ctx ->> 'entorno';
  v_ip text := p_ctx ->> 'ip_hash';
  v_total integer;
  v_validos integer := 0;
  v_aceptados integer := 0;
  v_bots integer := 0;
  v_n_ip integer;
  v_hoy_aceptados bigint;
  v_cupo integer;
  v_sesiones uuid[];
  v_sid uuid;
begin
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    raise exception 'web_logs_ingerir: p_eventos debe ser un array' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_eventos);
  if v_total = 0 then
    return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', 0);
  end if;
  if v_total > 200 then
    raise exception 'web_logs_ingerir: como mucho 200 eventos por lote' using errcode = '22023';
  end if;

  select * into c from public.web_logs_config where id;
  if not found then
    insert into public.web_logs_config (id) values (true) on conflict do nothing;
    select * into c from public.web_logs_config where id;
  end if;

  if v_entorno is null or not (v_entorno = any (c.entornos_aceptados)) then
    if v_entorno in ('produccion', 'demo', 'local') then
      insert into public.web_logs_ingesta_diaria as d (dia, entorno, rechazados, lotes) values (v_hoy, v_entorno, v_total, 1)
      on conflict (dia, entorno) do update set rechazados = d.rechazados + excluded.rechazados, lotes = d.lotes + 1;
    end if;
    return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', v_total, 'motivo', 'entorno_no_aceptado');
  end if;

  -- Límite por IP (HMAC) y minuto: atómico por INSERT … ON CONFLICT.
  if v_ip is not null and v_ip ~ '^[a-f0-9]{16,64}$' then
    insert into public.web_logs_limite_ip as l (ip_hash, minuto, n) values (v_ip, date_trunc('minute', v_ahora), v_total)
    on conflict (ip_hash, minuto) do update set n = l.n + excluded.n
    returning n into v_n_ip;
    if v_n_ip > c.limite_eventos_ip_minuto then
      insert into public.web_logs_ingesta_diaria as d (dia, entorno, descartados, lotes) values (v_hoy, v_entorno, v_total, 1)
      on conflict (dia, entorno) do update set descartados = d.descartados + excluded.descartados, lotes = d.lotes + 1;
      return jsonb_build_object('aceptados', 0, 'duplicados', 0, 'descartados', v_total, 'motivo', 'limite_ip');
    end if;
    -- Limpieza barata y acotada de minutos viejos.
    delete from public.web_logs_limite_ip where minuto < v_ahora - interval '1 hour';
  end if;

  -- Cupo diario global (coste): lo que no cabe se descarta, primero los errores.
  select coalesce(sum(aceptados), 0) into v_hoy_aceptados from public.web_logs_ingesta_diaria where dia = v_hoy;
  v_cupo := greatest(c.limite_eventos_dia - v_hoy_aceptados, 0)::integer;

  -- Un advisory lock por sesión (ordenado: sin interbloqueos) serializa dos
  -- lotes concurrentes de la misma sesión: el recálculo ve los dos.
  for v_sid in
    select distinct (e ->> 'sesion_id')::uuid
      from jsonb_array_elements(p_eventos) e
     where e ->> 'sesion_id' ~ '^[0-9a-fA-F-]{36}$'
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('web_sesion:' || v_sid::text, 0));
  end loop;

  -- CTAS: copia los tipos, no los NOT NULL ni la identidad.
  create temporary table if not exists web_lote on commit drop as
    select evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id, secuencia, ruta,
           objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno, es_prueba, consentimiento, version,
           despliegue, gravedad, huella, mensaje, pila
      from public.web_eventos limit 0;
  truncate pg_temp.web_lote;

  insert into pg_temp.web_lote (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id,
                                secuencia, ruta, objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno,
                                es_prueba, consentimiento, version, despliegue, gravedad, huella, mensaje, pila)
  select e.evento_id,
         least(greatest(coalesce(e.ocurrido_en, v_ahora), v_ahora - interval '2 days'), v_ahora + interval '5 minutes'),
         v_entorno, coalesce(e.proyecto, 'casa-tomas-story'), e.fuente, e.categoria, e.tipo, e.accion,
         -- Sin consentimiento no hay identificadores persistentes que guardar.
         e.sesion_id, case when coalesce(e.consentimiento, false) then e.visitante_id end,
         e.secuencia, left(e.ruta, 300), left(e.objetivo, 200), e.valor, coalesce(e.propiedades, '{}'::jsonb),
         e.dispositivo, left(e.navegador, 40), left(e.so, 40), coalesce(e.es_bot, false), coalesce(e.es_interno, false),
         coalesce(e.es_prueba, false), coalesce(e.consentimiento, false), left(e.version, 40), left(e.despliegue, 80),
         e.gravedad, e.huella, left(e.mensaje, 500), left(e.pila, 4000)
    from jsonb_to_recordset(p_eventos) as e(
           evento_id uuid, ocurrido_en timestamptz, proyecto text, fuente text, categoria text, tipo text, accion text,
           sesion_id uuid, visitante_id uuid, secuencia integer, ruta text, objetivo text, valor numeric, propiedades jsonb,
           dispositivo text, navegador text, so text, es_bot boolean, es_interno boolean, es_prueba boolean,
           consentimiento boolean, version text, despliegue text, gravedad text, huella text, mensaje text, pila text)
   where e.evento_id is not null
     and e.tipo ~ '^[a-z0-9_]{2,40}$'
     and e.categoria in ('actividad', 'operacion', 'tecnico', 'error')
     and e.fuente in ('navegador', 'servidor', 'base_datos', 'hosting', 'integracion')
     and (e.accion is null or e.accion ~ '^[a-z0-9_]{1,40}$')
     and (e.categoria <> 'error' or e.huella ~ '^[a-f0-9]{16,64}$')
     and (e.propiedades is null or (jsonb_typeof(e.propiedades) = 'object' and length(e.propiedades::text) <= 4000))
     and (e.dispositivo is null or e.dispositivo in ('movil', 'tablet', 'escritorio', 'desconocido'))
     and (e.gravedad is null or e.gravedad in ('info', 'aviso', 'error', 'critico'))
     and (e.proyecto is null or e.proyecto ~ '^[a-z0-9-]{2,40}$')
     and (e.secuencia is null or e.secuencia >= 0);
  get diagnostics v_validos = row_count;

  -- Fuentes desactivadas y rutas excluidas.
  delete from pg_temp.web_lote l
   where (l.fuente = 'navegador' and l.categoria in ('actividad', 'operacion') and not c.recoger_actividad)
      or (l.fuente = 'navegador' and l.categoria = 'tecnico' and not c.recoger_peticiones)
      or (l.fuente = 'navegador' and l.categoria = 'error' and not c.recoger_errores_navegador)
      or (l.fuente = 'servidor' and not c.recoger_errores_servidor)
      or (l.fuente = 'integracion' and not c.recoger_integraciones)
      or (l.fuente = 'hosting' and not c.recoger_hosting)
      or (l.ruta is not null and exists (select 1 from unnest(c.rutas_excluidas) r where r <> '' and l.ruta like r || '%'));

  -- Tope por sesión (los errores no cuentan para el tope) y cupo diario.
  delete from pg_temp.web_lote l
   using (
     select x.evento_id, row_number() over (partition by x.sesion_id order by x.secuencia nulls last, x.ocurrido_en) as rn,
            coalesce(s.eventos, 0) as previos
       from pg_temp.web_lote x
       left join public.web_sesiones s on s.sesion_id = x.sesion_id
      where x.sesion_id is not null and x.categoria <> 'error'
   ) n
   where n.evento_id = l.evento_id and n.previos + n.rn > c.limite_eventos_sesion;

  delete from pg_temp.web_lote l
   using (
     select x.evento_id, row_number() over (order by (x.categoria = 'error') desc, x.ocurrido_en) as rn
       from pg_temp.web_lote x
   ) n
   where n.evento_id = l.evento_id and n.rn > v_cupo;

  with ins as (
    insert into public.web_eventos (evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id,
                                    visitante_id, secuencia, ruta, objetivo, valor, propiedades, dispositivo, navegador, so,
                                    es_bot, es_interno, es_prueba, consentimiento, version, despliegue, gravedad, huella,
                                    mensaje, pila)
    select evento_id, ocurrido_en, entorno, proyecto, fuente, categoria, tipo, accion, sesion_id, visitante_id, secuencia,
           ruta, objetivo, valor, propiedades, dispositivo, navegador, so, es_bot, es_interno, es_prueba, consentimiento,
           version, despliegue, gravedad, huella, mensaje, pila
      from pg_temp.web_lote
    on conflict (evento_id) do nothing
    returning sesion_id, es_bot
  )
  select count(*), count(*) filter (where es_bot), array_agg(distinct sesion_id) filter (where sesion_id is not null)
    into v_aceptados, v_bots, v_sesiones
    from ins;

  if v_sesiones is not null then
    perform public.web_logs_recalcular_sesiones(v_sesiones);
  end if;

  insert into public.web_logs_ingesta_diaria as d (dia, entorno, aceptados, duplicados, descartados, rechazados, bots, lotes)
  values (v_hoy, v_entorno, v_aceptados,
          greatest((select count(*) from pg_temp.web_lote) - v_aceptados, 0),
          greatest(v_validos - (select count(*) from pg_temp.web_lote), 0),
          v_total - v_validos, v_bots, 1)
  on conflict (dia, entorno) do update set
    aceptados = d.aceptados + excluded.aceptados, duplicados = d.duplicados + excluded.duplicados,
    descartados = d.descartados + excluded.descartados, rechazados = d.rechazados + excluded.rechazados,
    bots = d.bots + excluded.bots, lotes = d.lotes + 1;

  return jsonb_build_object(
    'aceptados', v_aceptados,
    'duplicados', greatest((select count(*) from pg_temp.web_lote) - v_aceptados, 0),
    'descartados', greatest(v_validos - (select count(*) from pg_temp.web_lote), 0),
    'rechazados', v_total - v_validos);
end;
$$;
revoke all on function public.web_logs_ingerir(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.web_logs_ingerir(jsonb, jsonb) to service_role;

-- Recalcula el resumen de las sesiones dadas DESDE sus eventos (exacto).
create or replace function public.web_logs_recalcular_sesiones(p_sesiones uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.web_sesiones as s (
    sesion_id, visitante_id, entorno, proyecto, inicio, ultima_actividad, pagina_entrada, ultima_pagina, origen_tipo,
    origen_detalle, campana, idioma, dispositivo, navegador, so, paginas_vistas, eventos, errores, scroll_max,
    tiempo_activo_ms, inicio_operacion, conversiones, es_bot, es_interno, es_prueba, consentimiento, actualizado_en)
  select e.sesion_id,
         (array_agg(e.visitante_id order by e.ocurrido_en, e.secuencia) filter (where e.visitante_id is not null))[1],
         (array_agg(e.entorno order by e.ocurrido_en, e.secuencia))[1], (array_agg(e.proyecto order by e.ocurrido_en, e.secuencia))[1],
         min(e.ocurrido_en), max(e.ocurrido_en),
         (array_agg(e.ruta order by e.ocurrido_en, e.secuencia) filter (where e.tipo = 'pagina_vista'))[1],
         (array_agg(e.ruta order by e.ocurrido_en desc, e.secuencia desc) filter (where e.tipo = 'pagina_vista'))[1],
         (array_agg(e.propiedades ->> 'origen_tipo' order by e.ocurrido_en, e.secuencia)
            filter (where e.propiedades ->> 'origen_tipo' in ('buscador', 'campana', 'qr', 'red_social', 'enlace', 'directo', 'interno', 'desconocido')))[1],
         left((array_agg(e.propiedades ->> 'origen_detalle' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ? 'origen_detalle'))[1], 200),
         left((array_agg(e.propiedades ->> 'campana' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ? 'campana'))[1], 200),
         (array_agg(e.propiedades ->> 'idioma' order by e.ocurrido_en, e.secuencia) filter (where e.propiedades ->> 'idioma' in ('es', 'en', 'fr')))[1],
         (array_agg(e.dispositivo order by e.ocurrido_en, e.secuencia) filter (where e.dispositivo is not null))[1],
         (array_agg(e.navegador order by e.ocurrido_en, e.secuencia) filter (where e.navegador is not null))[1],
         (array_agg(e.so order by e.ocurrido_en, e.secuencia) filter (where e.so is not null))[1],
         count(*) filter (where e.tipo = 'pagina_vista'),
         count(*),
         count(*) filter (where e.categoria = 'error'),
         least(max(case when e.tipo = 'pagina_salida' and e.propiedades ->> 'scroll_max' ~ '^\d{1,3}$'
                        then (e.propiedades ->> 'scroll_max')::integer end), 100)::smallint,
         coalesce(sum(case when e.tipo = 'pagina_salida' and e.valor between 0 and 3600000 then e.valor end), 0)::bigint,
         bool_or((e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo in ('reserva', 'cheque')) or e.tipo = 'cheque_checkout'),
         count(*) filter (where e.categoria = 'operacion' and e.tipo in ('reserva_solicitada', 'cheque_pagado')),
         bool_or(e.es_bot), bool_or(e.es_interno), bool_or(e.es_prueba), bool_or(e.consentimiento), now()
    from public.web_eventos e
   where e.sesion_id = any (p_sesiones)
   group by e.sesion_id
  on conflict (sesion_id) do update set
    visitante_id = excluded.visitante_id, entorno = excluded.entorno, proyecto = excluded.proyecto, inicio = excluded.inicio,
    ultima_actividad = excluded.ultima_actividad, pagina_entrada = excluded.pagina_entrada, ultima_pagina = excluded.ultima_pagina,
    origen_tipo = excluded.origen_tipo, origen_detalle = excluded.origen_detalle, campana = excluded.campana,
    idioma = excluded.idioma, dispositivo = excluded.dispositivo, navegador = excluded.navegador, so = excluded.so,
    paginas_vistas = excluded.paginas_vistas, eventos = excluded.eventos, errores = excluded.errores,
    scroll_max = excluded.scroll_max, tiempo_activo_ms = excluded.tiempo_activo_ms,
    inicio_operacion = excluded.inicio_operacion, conversiones = excluded.conversiones, es_bot = excluded.es_bot,
    es_interno = excluded.es_interno, es_prueba = excluded.es_prueba, consentimiento = excluded.consentimiento,
    actualizado_en = excluded.actualizado_en;
$$;
revoke all on function public.web_logs_recalcular_sesiones(uuid[]) from public, anon, authenticated;
grant execute on function public.web_logs_recalcular_sesiones(uuid[]) to service_role;

-- ─── 9. Agrupación de errores en incidencias (solo service_role) ────────────
-- Un único proceso a la vez (advisory lock): la UNIQUE (entorno, huella) más
-- el lock impiden incidencias duplicadas aunque el cron y el botón «Procesar
-- ahora» coincidan. Recalcula las cifras de cada incidencia tocada desde TODOS
-- sus eventos (exacto), aplica la reapertura y los umbrales de ticket.
create or replace function public.web_logs_agrupar_errores(p_limite integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ids bigint[];
  v_afectadas bigint[];
  v_nuevas integer := 0;
  v_reabiertas integer := 0;
  v_pendientes integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('web_logs_agrupar_errores')) then
    return jsonb_build_object('ocupado', true);
  end if;
  select * into c from public.web_logs_config where id;

  select array_agg(id order by id) into v_ids
    from (select id from public.web_eventos
           where categoria = 'error' and incidencia_id is null and huella is not null
           order by id limit greatest(p_limite, 1)) t;

  if v_ids is not null then
    with nuevas as (
      insert into public.web_incidencias (entorno, huella, titulo, tipo, fuente, proyecto, gravedad, primera_vez, ultima_vez,
                                          mensaje, pila, ejemplo_evento_id)
      select distinct on (e.entorno, e.huella)
             e.entorno, e.huella,
             left(coalesce(nullif(e.mensaje, ''), e.tipo) || coalesce(' · ' || nullif(e.objetivo, ''), ''), 200),
             e.tipo, e.fuente, e.proyecto, coalesce(e.gravedad, 'error'), e.ocurrido_en, e.ocurrido_en, e.mensaje, e.pila, e.id
        from public.web_eventos e
       where e.id = any (v_ids)
       order by e.entorno, e.huella, e.id
      on conflict (entorno, huella) do nothing
      returning 1
    )
    select count(*) into v_nuevas from nuevas;

    update public.web_eventos e
       set incidencia_id = i.id
      from public.web_incidencias i
     where e.id = any (v_ids) and i.entorno = e.entorno and i.huella = e.huella;

    select array_agg(distinct incidencia_id) into v_afectadas from public.web_eventos where id = any (v_ids);
  end if;

  -- También las que tienen ocurrencias que salen de las ventanas (cifras al día).
  select array_agg(distinct x) into v_afectadas
    from (select unnest(coalesce(v_afectadas, array[]::bigint[])) as x
          union
          select id from public.web_incidencias
           where ocurrencias_ventana > 0 or ocurrencias_24h > 0) t;

  if v_afectadas is null then
    return jsonb_build_object('agrupados', 0, 'nuevas', 0, 'reabiertas', 0, 'pendientes_linear', 0);
  end if;

  with st as (
    select e.incidencia_id as id,
           min(e.ocurrido_en) as primera,
           max(e.ocurrido_en) as ultima,
           count(*) filter (where not e.es_bot) as n,
           count(distinct e.sesion_id) filter (where not e.es_bot) as ses,
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not e.es_prueba)
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not e.es_prueba)
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and e.ocurrido_en > now() - interval '24 hours') as n24,
           max(case e.gravedad when 'critico' then 4 when 'error' then 3 when 'aviso' then 2 else 1 end) as grav,
           (array_agg(e.version order by e.ocurrido_en) filter (where e.version is not null))[1] as vprim,
           (array_agg(e.version order by e.ocurrido_en desc) filter (where e.version is not null))[1] as vult,
           (array_agg(e.despliegue order by e.ocurrido_en desc) filter (where e.despliegue is not null))[1] as dult
      from public.web_eventos e
     where e.incidencia_id = any (v_afectadas)
     group by e.incidencia_id
  ), rutas as (
    select r.incidencia_id as id, jsonb_agg(jsonb_build_object('ruta', r.ruta, 'n', r.n) order by r.n desc) as rutas
      from (select e.incidencia_id, coalesce(e.ruta, '(sin ruta)') as ruta, count(*) as n,
                   row_number() over (partition by e.incidencia_id order by count(*) desc) as rk
              from public.web_eventos e
             where e.incidencia_id = any (v_afectadas)
             group by e.incidencia_id, coalesce(e.ruta, '(sin ruta)')) r
     where r.rk <= 5
     group by r.incidencia_id
  )
  update public.web_incidencias i
     set primera_vez = st.primera,
         ultima_vez = st.ultima,
         ocurrencias = st.n,
         sesiones_afectadas = st.ses,
         ocurrencias_ventana = st.n_ventana,
         sesiones_ventana = st.ses_ventana,
         ocurrencias_24h = st.n24,
         gravedad = case st.grav when 4 then 'critico' when 3 then 'error' when 2 then 'aviso' else 'info' end,
         rutas = coalesce(rutas.rutas, '[]'::jsonb),
         version_primera = st.vprim,
         version_ultima = st.vult,
         despliegue_ultimo = st.dult,
         actualizado_en = now()
    from st left join rutas on rutas.id = st.id
   where i.id = st.id
     and (i.ultima_vez, i.ocurrencias, i.ocurrencias_ventana, i.ocurrencias_24h, i.sesiones_afectadas, i.rutas)
         is distinct from (st.ultima, st.n::integer, st.n_ventana::integer, st.n24::integer, st.ses::integer, coalesce(rutas.rutas, '[]'::jsonb));

  -- Incidencias cuyos eventos ya se purgaron: ventanas a cero.
  update public.web_incidencias i
     set ocurrencias_ventana = 0, sesiones_ventana = 0, ocurrencias_24h = 0
   where i.id = any (v_afectadas)
     and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
     and (i.ocurrencias_ventana > 0 or i.ocurrencias_24h > 0);

  -- Patrones ignorados (extensiones del navegador, ruido conocido).
  update public.web_incidencias i
     set estado = 'ignorada', linear_estado = case when i.linear_estado = 'pendiente' then 'no_aplica' else i.linear_estado end,
         motivo_ticket = 'Coincide con un patrón ignorado en Configuración'
   where i.id = any (v_afectadas) and i.estado = 'nueva'
     and exists (select 1 from unnest(c.mensajes_ignorados) p
                  where p <> '' and (position(lower(p) in lower(coalesce(i.mensaje, ''))) > 0
                                     or position(lower(p) in lower(coalesce(i.pila, ''))) > 0));

  -- Reaparición de una resuelta: nueva ocurrencia posterior a la resolución.
  --   reabrir      → estado «reabierta» y, si había ticket, se reabre/comenta el mismo.
  --   nuevo_ticket → estado «reabierta» y un ticket NUEVO (id nuevo), enlazando el anterior.
  --   ignorar      → sigue resuelta (las ocurrencias se cuentan igual).
  with r as (
    update public.web_incidencias i
       set estado = 'reabierta',
           reabierta_veces = i.reabierta_veces + 1,
           linear_pendiente_reapertura = (c.reapertura = 'reabrir' and i.linear_estado = 'creado'),
           linear_estado = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then 'sin_ticket' else i.linear_estado end,
           linear_uuid = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then gen_random_uuid() else i.linear_uuid end,
           linear_issue_id = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then null else i.linear_issue_id end,
           motivo_ticket = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                then left('Reaparecida tras resolverse (ticket anterior: ' || coalesce(i.linear_identificador, i.linear_issue_id, '?') || ')', 500)
                                else i.motivo_ticket end
     where i.id = any (v_afectadas) and i.estado = 'resuelta' and i.resuelta_en is not null
       and c.reapertura <> 'ignorar'
       and exists (select 1 from public.web_eventos e where e.incidencia_id = i.id and e.ocurrido_en > i.resuelta_en and not e.es_bot)
    returning 1
  )
  select count(*) into v_reabiertas from r;

  -- Umbrales de ticket.
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = coalesce(i.linear_proximo_intento, now()),
         motivo_ticket = case
           when i.gravedad = 'critico' then 'Gravedad crítica: se abre con la primera ocurrencia'
           when i.tipo = 'error_404' then format('%s 404 en 24 h (umbral %s)', i.ocurrencias_24h, c.umbral_404_diario)
           else format('%s ocurrencias y %s sesiones en %s h (umbral %s y %s)', i.ocurrencias_ventana, i.sesiones_ventana,
                       c.umbral_ventana_horas, c.umbral_ocurrencias, c.umbral_sesiones)
         end || case when i.motivo_ticket like 'Reaparecida%' then ' · ' || i.motivo_ticket else '' end
   where i.id = any (v_afectadas)
     and i.linear_estado = 'sin_ticket'
     and i.estado in ('nueva', 'abierta', 'reabierta')
     and c.linear_modo <> 'desactivado'
     and i.entorno = any (c.entornos_ticket)
     and i.ocurrencias_ventana > 0
     and (
       (i.tipo = 'error_404' and c.tickets_404 and i.ocurrencias_24h >= c.umbral_404_diario)
       or (i.tipo <> 'error_404' and (
             i.gravedad = 'critico'
             or (i.ocurrencias_ventana >= c.umbral_ocurrencias
                 and (i.fuente <> 'navegador' or i.sesiones_ventana >= c.umbral_sesiones))))
     );

  select count(*) into v_pendientes from public.web_incidencias
   where linear_estado in ('pendiente', 'error') or linear_pendiente_reapertura;

  return jsonb_build_object('agrupados', coalesce(cardinality(v_ids), 0), 'nuevas', v_nuevas,
                            'reabiertas', v_reabiertas, 'pendientes_linear', v_pendientes);
end;
$$;
revoke all on function public.web_logs_agrupar_errores(integer) from public, anon, authenticated;
grant execute on function public.web_logs_agrupar_errores(integer) to service_role;

-- ─── 10. Retención (solo service_role, la llama procesar-logs-web) ──────────
create or replace function public.web_logs_purgar(p_lote integer default 20000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_eventos integer := 0;
  v_errores integer := 0;
  v_sesiones integer := 0;
  v_incidencias integer := 0;
begin
  select * into c from public.web_logs_config where id;

  with d as (
    delete from public.web_eventos where id in (
      select id from public.web_eventos
       where categoria <> 'error' and ocurrido_en < now() - make_interval(days => c.retencion_actividad_dias)
       limit p_lote)
    returning 1)
  select count(*) into v_eventos from d;

  with d as (
    delete from public.web_eventos where id in (
      select id from public.web_eventos
       where categoria = 'error' and ocurrido_en < now() - make_interval(days => c.retencion_errores_dias)
       limit p_lote)
    returning 1)
  select count(*) into v_errores from d;

  with d as (
    delete from public.web_sesiones s
     where s.ultima_actividad < now() - make_interval(days => c.retencion_actividad_dias)
       and not exists (select 1 from public.web_eventos e where e.sesion_id = s.sesion_id)
    returning 1)
  select count(*) into v_sesiones from d;

  -- Incidencias cerradas (resueltas o ignoradas) sin eventos y fuera de retención.
  with d as (
    delete from public.web_incidencias i
     where i.estado in ('resuelta', 'ignorada')
       and i.ultima_vez < now() - make_interval(days => c.retencion_errores_dias)
       and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
    returning 1)
  select count(*) into v_incidencias from d;

  delete from public.web_logs_limite_ip where minuto < now() - interval '1 hour';
  delete from public.web_linear_prueba where creado_en < now() - interval '90 days';
  delete from public.web_resumenes_ia where creado_en < now() - interval '400 days';
  delete from public.web_logs_ingesta_diaria where dia < current_date - 400;

  update public.web_logs_estado set ultima_purga = now() where id;
  return jsonb_build_object('eventos', v_eventos, 'errores', v_errores, 'sesiones', v_sesiones, 'incidencias', v_incidencias);
end;
$$;
revoke all on function public.web_logs_purgar(integer) from public, anon, authenticated;
grant execute on function public.web_logs_purgar(integer) to service_role;

-- ─── 11. Lecturas del panel (super admin) ───────────────────────────────────
-- Filtro común de exclusión: bots fuera siempre (salvo p_incluir_bots);
-- tráfico interno y pruebas fuera salvo p_incluir_internos.

-- Sesiones con filtros, búsqueda y paginación. total = filas que cumplen.
create or replace function public.web_buscar_sesiones(
  p_desde timestamptz, p_hasta timestamptz, p_entorno text default null, p_ruta text default null,
  p_tipo text default null, p_origen text default null, p_dispositivo text default null, p_texto text default null,
  p_con_error boolean default null, p_con_conversion boolean default null,
  p_incluir_internos boolean default false, p_incluir_bots boolean default false,
  p_limite integer default 25, p_offset integer default 0)
returns table (sesion public.web_sesiones, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s, count(*) over ()
    from public.web_sesiones s
   where s.inicio >= p_desde and s.inicio < p_hasta
     and (p_entorno is null or s.entorno = p_entorno)
     and (p_incluir_bots or not s.es_bot)
     and (p_incluir_internos or not (s.es_interno or s.es_prueba))
     and (p_origen is null or s.origen_tipo = p_origen)
     and (p_dispositivo is null or s.dispositivo = p_dispositivo)
     and (p_con_error is null or (s.errores > 0) = p_con_error)
     and (p_con_conversion is null or (s.conversiones > 0) = p_con_conversion)
     and (p_ruta is null or exists (select 1 from public.web_eventos e
                                     where e.sesion_id = s.sesion_id and e.tipo = 'pagina_vista' and e.ruta = p_ruta))
     and (p_tipo is null or exists (select 1 from public.web_eventos e where e.sesion_id = s.sesion_id and e.tipo = p_tipo))
     and (p_texto is null or p_texto = ''
          or s.sesion_id::text like lower(p_texto) || '%'
          or s.pagina_entrada ilike '%' || p_texto || '%'
          or s.ultima_pagina ilike '%' || p_texto || '%'
          or s.campana ilike '%' || p_texto || '%'
          or s.origen_detalle ilike '%' || p_texto || '%')
   order by s.inicio desc
   limit least(greatest(p_limite, 1), 200) offset greatest(p_offset, 0);
$$;

-- Eventos con filtros, búsqueda y paginación.
create or replace function public.web_buscar_eventos(
  p_desde timestamptz, p_hasta timestamptz, p_entorno text default null, p_categoria text default null,
  p_tipo text default null, p_ruta text default null, p_fuente text default null, p_gravedad text default null,
  p_dispositivo text default null, p_texto text default null,
  p_incluir_internos boolean default false, p_incluir_bots boolean default false,
  p_limite integer default 50, p_offset integer default 0)
returns table (evento public.web_eventos, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e, count(*) over ()
    from public.web_eventos e
   where e.ocurrido_en >= p_desde and e.ocurrido_en < p_hasta
     and (p_entorno is null or e.entorno = p_entorno)
     and (p_categoria is null or e.categoria = p_categoria
          or (p_categoria = 'actividad' and e.categoria = 'operacion'))
     and (p_tipo is null or e.tipo = p_tipo)
     and (p_ruta is null or e.ruta = p_ruta)
     and (p_fuente is null or e.fuente = p_fuente)
     and (p_gravedad is null or e.gravedad = p_gravedad)
     and (p_dispositivo is null or e.dispositivo = p_dispositivo)
     and (p_incluir_bots or not e.es_bot)
     and (p_incluir_internos or not (e.es_interno or e.es_prueba))
     and (p_texto is null or p_texto = ''
          or e.sesion_id::text like lower(p_texto) || '%'
          or e.ruta ilike '%' || p_texto || '%'
          or e.objetivo ilike '%' || p_texto || '%'
          or e.mensaje ilike '%' || p_texto || '%'
          or e.tipo ilike '%' || p_texto || '%')
   order by e.ocurrido_en desc, e.id desc
   limit least(greatest(p_limite, 1), 500) offset greatest(p_offset, 0);
$$;

-- Contexto de un evento: lo que pasó antes y después en la MISMA sesión.
create or replace function public.web_contexto_evento(p_evento_id bigint, p_antes integer default 15, p_despues integer default 10)
returns setof public.web_eventos
language sql
stable
security invoker
set search_path = ''
as $$
  with ref as (select * from public.web_eventos where id = p_evento_id)
  (select e.* from public.web_eventos e, ref
    where ref.sesion_id is not null and e.sesion_id = ref.sesion_id
      and (e.ocurrido_en, coalesce(e.secuencia, 0), e.id) < (ref.ocurrido_en, coalesce(ref.secuencia, 0), ref.id)
    order by e.ocurrido_en desc, e.secuencia desc nulls last, e.id desc
    limit least(greatest(p_antes, 0), 100))
  union all
  (select ref.* from ref)
  union all
  (select e.* from public.web_eventos e, ref
    where ref.sesion_id is not null and e.sesion_id = ref.sesion_id
      and (e.ocurrido_en, coalesce(e.secuencia, 0), e.id) > (ref.ocurrido_en, coalesce(ref.secuencia, 0), ref.id)
    order by e.ocurrido_en, e.secuencia nulls last, e.id
    limit least(greatest(p_despues, 0), 100));
$$;

-- Salud de la recogida (para distinguir «no hay actividad» de «la recogida se ha parado»).
create or replace function public.web_logs_estado_recogida(p_entorno text default 'produccion')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not (coalesce(public.is_super_admin(auth.uid()), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un super admin puede ver el estado de la recogida' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'ahora', now(),
    'entorno', p_entorno,
    'fuentes', coalesce((
      select jsonb_agg(jsonb_build_object('fuente', f.fuente, 'ultimo_recibido', f.ultimo, 'n_1h', f.n1, 'n_24h', f.n24) order by f.fuente)
        from (select e.fuente, max(e.recibido_en) as ultimo,
                     count(*) filter (where e.recibido_en > now() - interval '1 hour') as n1,
                     count(*) filter (where e.recibido_en > now() - interval '24 hours') as n24
                from public.web_eventos e
               where e.entorno = p_entorno and e.recibido_en > now() - interval '30 days'
               group by e.fuente) f), '[]'::jsonb),
    'primer_evento', (select min(ocurrido_en) from public.web_eventos where entorno = p_entorno),
    'primer_evento_por_tipo', coalesce((
      select jsonb_object_agg(tipo, primero) from (
        select tipo, min(ocurrido_en) as primero from public.web_eventos where entorno = p_entorno group by tipo) t), '{}'::jsonb),
    'primer_evento_por_categoria', coalesce((
      select jsonb_object_agg(categoria, primero) from (
        select categoria, min(ocurrido_en) as primero from public.web_eventos where entorno = p_entorno group by categoria) t), '{}'::jsonb),
    'ingesta', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.dia desc)
        from public.web_logs_ingesta_diaria d
       where d.entorno = p_entorno and d.dia > (now() at time zone 'Europe/Madrid')::date - 8), '[]'::jsonb),
    'proceso', (select to_jsonb(s) - 'cursores' from public.web_logs_estado s where id),
    'config', (select jsonb_build_object('linear_modo', linear_modo, 'entornos_aceptados', entornos_aceptados,
                                         'entornos_ticket', entornos_ticket, 'recoger_actividad', recoger_actividad,
                                         'recoger_errores_navegador', recoger_errores_navegador)
                 from public.web_logs_config where id),
    -- Referencia independiente: visitas de Vercel Web Analytics (sin cookies) del último día cerrado.
    'vercel_ultimo_dia', (select jsonb_build_object('fecha', d.fecha, 'visitas', d.visitas)
                            from public.trafico_web_diario d
                           where d.proyecto = 'casa-tomas-story' and d.ruta = '*'
                           order by d.fecha desc limit 1)
  ) into v;
  return v;
end;
$$;
revoke all on function public.web_logs_estado_recogida(text) from public, anon;
grant execute on function public.web_logs_estado_recogida(text) to authenticated, service_role;

-- ─── 12. Estadísticas de comportamiento (super admin) ───────────────────────
-- Días y horas en Europe/Madrid. Una sesión cuenta en el periodo si EMPIEZA en
-- él. Definiciones (las mismas que muestran Tráfico web y Logs, ver
-- src/components/trafico-web/comportamiento/definiciones.ts):
--   sesiones             sesiones seudónimas con consentimiento (30 min sin actividad = nueva)
--   visitantes_estimados navegadores distintos (visitante_id); NO son personas
--   paginas_vistas       eventos pagina_vista de esas sesiones
--   conversiones         operaciones COMPLETADAS (reserva_solicitada, cheque_pagado)
--   ultima página        la última observada, no una salida confirmada
create or replace function public.web_comportamiento_resumen(
  p_desde date, p_hasta date, p_entorno text default 'produccion', p_incluir_internos boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select * from public.web_sesiones x
     where x.entorno = p_entorno and not x.es_bot
       and (p_incluir_internos or not (x.es_interno or x.es_prueba))
       and x.inicio >= (p_desde::timestamp at time zone 'Europe/Madrid')
       and x.inicio < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
  )
  select jsonb_build_object(
    'sesiones', count(*),
    'visitantes_estimados', count(distinct visitante_id),
    'paginas_vistas', coalesce(sum(paginas_vistas), 0),
    'paginas_por_sesion', round(avg(paginas_vistas)::numeric, 2),
    'sesiones_una_pagina', count(*) filter (where paginas_vistas <= 1),
    'tiempo_activo_medio_s', round(avg(tiempo_activo_ms) / 1000.0, 1),
    'tiempo_activo_mediana_s', round((percentile_cont(0.5) within group (order by tiempo_activo_ms) / 1000.0)::numeric, 1),
    'scroll_medio', round(avg(scroll_max)::numeric, 1),
    'sesiones_inicio_operacion', count(*) filter (where inicio_operacion),
    'sesiones_con_conversion', count(*) filter (where conversiones > 0),
    'conversiones', coalesce(sum(conversiones), 0),
    'errores', coalesce(sum(errores), 0),
    'sesiones_con_error', count(*) filter (where errores > 0)
  ) from s;
$$;

create or replace function public.web_comportamiento(
  p_desde date, p_hasta date, p_entorno text default 'produccion', p_incluir_internos boolean default false)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ini timestamptz := (p_desde::timestamp at time zone 'Europe/Madrid');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid');
  v_dias integer := (p_hasta - p_desde) + 1;
  r jsonb;
begin
  if p_hasta < p_desde or v_dias > 400 then
    raise exception 'Periodo no válido (como mucho 400 días)' using errcode = '22023';
  end if;

  with wc_s as materialized (
    select * from public.web_sesiones x
     where x.entorno = p_entorno and not x.es_bot
       and (p_incluir_internos or not (x.es_interno or x.es_prueba))
       and x.inicio >= v_ini and x.inicio < v_fin
  ), wc_e as materialized (
    select e.* from public.web_eventos e join wc_s on wc_s.sesion_id = e.sesion_id
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias', v_dias, 'zona', 'Europe/Madrid', 'entorno', p_entorno),
    'datos_desde', (select min(ocurrido_en) from public.web_eventos where entorno = p_entorno and fuente = 'navegador' and consentimiento),
    'resumen', public.web_comportamiento_resumen(p_desde, p_hasta, p_entorno, p_incluir_internos),
    'anterior', public.web_comportamiento_resumen(p_desde - v_dias, p_desde - 1, p_entorno, p_incluir_internos),
    'excluidas', jsonb_build_object(
      'bots', (select count(*) from public.web_sesiones x where x.entorno = p_entorno and x.es_bot and x.inicio >= v_ini and x.inicio < v_fin),
      'internas_pruebas', (select count(*) from public.web_sesiones x where x.entorno = p_entorno and not x.es_bot
                             and (x.es_interno or x.es_prueba) and x.inicio >= v_ini and x.inicio < v_fin),
      'incluidas_internas', p_incluir_internos),
    'serie', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'sesiones', coalesce(t.sesiones, 0), 'paginas_vistas', coalesce(t.pv, 0),
                                          'conversiones', coalesce(t.conv, 0), 'errores', coalesce(t.err, 0)) order by d.dia)
        from generate_series(p_desde, p_hasta, interval '1 day') as d(dia)
        left join (select (inicio at time zone 'Europe/Madrid')::date as dia, count(*) as sesiones, sum(paginas_vistas) as pv,
                          sum(conversiones) as conv, sum(errores) as err
                     from wc_s group by 1) t on t.dia = d.dia::date), '[]'::jsonb),
    'paginas', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.vistas desc, p.ruta)
        from (select v.ruta, count(*) as vistas, count(distinct v.sesion_id) as sesiones,
                     round(avg(sal.tiempo_ms) / 1000.0, 1) as tiempo_medio_s, round(avg(sal.scroll)::numeric, 1) as scroll_medio
                from wc_e v
                left join lateral (
                  select sum(case when o.valor between 0 and 3600000 then o.valor end) as tiempo_ms,
                         max(case when o.propiedades ->> 'scroll_max' ~ '^\d{1,3}$' then (o.propiedades ->> 'scroll_max')::integer end) as scroll
                    from wc_e o
                   where o.sesion_id = v.sesion_id and o.tipo = 'pagina_salida' and o.ruta = v.ruta
                     and (o.propiedades ->> 'vista_id') = (v.propiedades ->> 'vista_id')
                ) sal on true
               where v.tipo = 'pagina_vista'
               group by v.ruta order by count(*) desc limit 20) p), '[]'::jsonb),
    'contenidos', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.tipo, c.n desc)
        from (select tipo, objetivo, n, sesiones from (
                select e.tipo, e.objetivo, count(*) as n, count(distinct e.sesion_id) as sesiones,
                       row_number() over (partition by e.tipo order by count(*) desc, e.objetivo) as rk
                  from wc_e e
                 where e.tipo in ('carta_categoria', 'plato_abierto', 'vino_abierto', 'bebida_abierta', 'media', 'mapa_vinos', 'pedido')
                   and e.objetivo is not null
                 group by e.tipo, e.objetivo) t where rk <= 10) c), '[]'::jsonb),
    'clics', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.n desc)
        from (select e.tipo, e.accion, e.objetivo, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e
               where e.tipo in ('clic', 'contacto') and e.objetivo is not null
               group by e.tipo, e.accion, e.objetivo order by count(*) desc limit 20) c), '[]'::jsonb),
    'contactos', coalesce((
      select jsonb_agg(jsonb_build_object('accion', accion, 'n', n, 'sesiones', ses) order by n desc)
        from (select e.accion, count(*) as n, count(distinct e.sesion_id) as ses
                from wc_e e where e.tipo = 'contacto' group by e.accion) c), '[]'::jsonb),
    'busquedas', (select jsonb_build_object('total', count(*), 'sin_resultados', count(*) filter (where e.valor = 0),
                                            'sesiones', count(distinct e.sesion_id))
                    from wc_e e where e.tipo = 'busqueda'),
    'filtros', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.n desc)
        from (select e.accion, e.objetivo, count(*) as n from wc_e e where e.tipo = 'filtro'
               group by e.accion, e.objetivo order by count(*) desc limit 15) f), '[]'::jsonb),
    'origenes', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select coalesce(origen_tipo, 'desconocido') as origen_tipo, count(*) as sesiones,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s group by 1) o), '[]'::jsonb),
    'campanas', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select origen_tipo, coalesce(campana, origen_detalle) as nombre, count(*) as sesiones,
                     count(*) filter (where inicio_operacion) as inicios,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s
               where origen_tipo in ('campana', 'qr', 'red_social', 'buscador', 'enlace')
               group by 1, 2 order by count(*) desc limit 20) o), '[]'::jsonb),
    'dispositivos', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.sesiones desc)
        from (select coalesce(dispositivo, 'desconocido') as dispositivo, count(*) as sesiones,
                     count(*) filter (where conversiones > 0) as sesiones_con_conversion
                from wc_s group by 1) o), '[]'::jsonb),
    'horas', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'sesiones', coalesce(n, 0)) order by h)
        from generate_series(0, 23) h
        left join (select extract(hour from inicio at time zone 'Europe/Madrid')::integer as hora, count(*) as n
                     from wc_s group by 1) t on t.hora = h), '[]'::jsonb),
    'dias_semana', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d, 'sesiones', coalesce(n, 0)) order by d)
        from generate_series(1, 7) d
        left join (select extract(isodow from inicio at time zone 'Europe/Madrid')::integer as dia, count(*) as n
                     from wc_s group by 1) t on t.dia = d), '[]'::jsonb),
    'tiempo', (select jsonb_build_object(
                 'menos_10s', count(*) filter (where tiempo_activo_ms < 10000),
                 'de_10s_a_1m', count(*) filter (where tiempo_activo_ms >= 10000 and tiempo_activo_ms < 60000),
                 'de_1m_a_3m', count(*) filter (where tiempo_activo_ms >= 60000 and tiempo_activo_ms < 180000),
                 'mas_3m', count(*) filter (where tiempo_activo_ms >= 180000))
               from wc_s),
    'scroll', (select jsonb_build_object(
                 'hasta_25', count(*) filter (where sc < 25),
                 'de_25_a_50', count(*) filter (where sc >= 25 and sc < 50),
                 'de_50_a_75', count(*) filter (where sc >= 50 and sc < 75),
                 'de_75_a_100', count(*) filter (where sc >= 75),
                 'vistas_medidas', count(*))
               from (select max(case when e.propiedades ->> 'scroll_max' ~ '^\d{1,3}$' then (e.propiedades ->> 'scroll_max')::integer end) as sc
                       from wc_e e where e.tipo = 'pagina_salida'
                      group by e.sesion_id, coalesce(e.propiedades ->> 'vista_id', e.ruta)) v
              where sc is not null),
    'recorridos', coalesce((
      select jsonb_agg(jsonb_build_object('recorrido', recorrido, 'sesiones', n) order by n desc, recorrido)
        from (select recorrido, count(*) as n from (
                select sesion_id, string_agg(ruta, ' → ' order by pos) as recorrido
                  from (select sesion_id, ruta, row_number() over (partition by sesion_id order by ocurrido_en, secuencia) as pos
                          from (select sesion_id, ruta, ocurrido_en, secuencia,
                                       lag(ruta) over (partition by sesion_id order by ocurrido_en, secuencia) as previa
                                  from wc_e where tipo = 'pagina_vista') x
                         where previa is distinct from ruta) y
                 where pos <= 3
                 group by sesion_id) z
              group by recorrido order by count(*) desc limit 10) w), '[]'::jsonb),
    'ultimas_paginas', coalesce((
      select jsonb_agg(jsonb_build_object('ruta', ultima_pagina, 'sesiones', n) order by n desc)
        from (select ultima_pagina, count(*) as n from wc_s where ultima_pagina is not null
               group by 1 order by count(*) desc limit 10) u), '[]'::jsonb),
    'embudos', jsonb_build_array(
      (select jsonb_build_object('operacion', 'reserva',
         'entrada', (select count(*) from wc_s),
         'consulta', count(distinct e.sesion_id) filter (where (e.tipo = 'pagina_vista' and e.ruta ~ '^(/(en|fr))?/reservas$')
                                                           or e.tipo = 'reserva_disponibilidad'),
         'inicio', count(distinct e.sesion_id) filter (where e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo = 'reserva'),
         'envio', count(distinct e.sesion_id) filter (where e.tipo = 'formulario' and e.accion = 'envio' and e.objetivo = 'reserva'),
         'fin', count(distinct e.sesion_id) filter (where e.tipo = 'reserva_solicitada'),
         'rechazos', count(*) filter (where e.tipo = 'reserva_rechazada'))
         from wc_e e),
      (select jsonb_build_object('operacion', 'cheque',
         'entrada', (select count(*) from wc_s),
         'consulta', count(distinct e.sesion_id) filter (where e.tipo = 'pagina_vista' and e.ruta ~ '^(/(en|fr))?/regala$'),
         'inicio', count(distinct e.sesion_id) filter (where (e.tipo = 'formulario' and e.accion = 'inicio' and e.objetivo = 'cheque')
                                                         or e.tipo = 'cheque_checkout'),
         'envio', count(distinct e.sesion_id) filter (where e.tipo = 'cheque_checkout'),
         'fin', count(distinct e.sesion_id) filter (where e.tipo = 'cheque_pagado'),
         'rechazos', 0)
         from wc_e e)),
    'formularios', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.objetivo)
        from (select e.objetivo,
                     count(distinct e.sesion_id) filter (where e.accion = 'inicio') as inicios,
                     count(distinct e.sesion_id) filter (where e.accion = 'envio') as envios,
                     count(distinct e.sesion_id) filter (where e.accion = 'abandono') as abandonos,
                     count(*) filter (where e.accion = 'error_validacion') as errores_validacion
                from wc_e e where e.tipo = 'formulario' and e.objetivo is not null
               group by e.objetivo) f), '[]'::jsonb),
    'errores_por_ruta', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select coalesce(e.ruta, '(sin ruta)') as ruta, e.tipo, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e where e.categoria = 'error'
               group by 1, 2 order by count(*) desc limit 15) x), '[]'::jsonb),
    'errores_por_operacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.n desc)
        from (select coalesce(e.propiedades ->> 'endpoint', e.tipo) as operacion, count(*) as n, count(distinct e.sesion_id) as sesiones
                from wc_e e where e.tipo in ('error_peticion', 'reserva_rechazada')
               group by 1 order by count(*) desc limit 10) x), '[]'::jsonb),
    -- Operaciones registradas en la BD (TODOS los visitantes, con o sin consentimiento).
    'operaciones_bd', (select jsonb_build_object(
                         'reservas_web', count(*) filter (where e.tipo = 'reserva_creada_bd'),
                         'reservas_confirmadas', count(*) filter (where e.tipo = 'reserva_confirmada_bd'),
                         'cheques_web', count(*) filter (where e.tipo = 'cheque_pagado_bd'))
                       from public.web_eventos e
                      where e.entorno = p_entorno and e.fuente = 'base_datos' and e.ocurrido_en >= v_ini and e.ocurrido_en < v_fin)
  ) into r;
  return r;
end;
$$;

revoke all on function public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer) from public, anon;
revoke all on function public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer) from public, anon;
revoke all on function public.web_contexto_evento(bigint, integer, integer) from public, anon;
revoke all on function public.web_comportamiento_resumen(date, date, text, boolean) from public, anon;
revoke all on function public.web_comportamiento(date, date, text, boolean) from public, anon;
grant execute on function public.web_buscar_sesiones(timestamptz, timestamptz, text, text, text, text, text, text, boolean, boolean, boolean, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.web_buscar_eventos(timestamptz, timestamptz, text, text, text, text, text, text, text, text, boolean, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.web_contexto_evento(bigint, integer, integer) to authenticated, service_role;
grant execute on function public.web_comportamiento_resumen(date, date, text, boolean) to authenticated, service_role;
grant execute on function public.web_comportamiento(date, date, text, boolean) to authenticated, service_role;

-- ─── 12 bis. Acciones del panel y lecturas para los recolectores ───────────
-- «Pedir ticket» (aunque no llegue al umbral) o «Reenviar a Linear» (p. ej. tras
-- pasar de destino de pruebas a Linear real). Solo super admin. Si el ticket
-- anterior se creó en OTRO destino, se usa un id nuevo para no chocar con él.
create or replace function public.web_incidencia_pedir_ticket(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modo text;
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'Solo un super admin puede pedir tickets' using errcode = '42501';
  end if;
  select linear_modo into v_modo from public.web_logs_config where id;
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = now(),
         linear_intentos = 0,
         linear_ultimo_error = null,
         linear_uuid = case when i.linear_destino is not null and i.linear_destino <> v_modo then gen_random_uuid() else i.linear_uuid end,
         linear_issue_id = case when i.linear_destino is not null and i.linear_destino <> v_modo then null else i.linear_issue_id end,
         motivo_ticket = coalesce(i.motivo_ticket, 'Pedido a mano desde Super Admin › Logs'),
         estado = case when i.estado = 'ignorada' then 'abierta' else i.estado end
   where i.id = p_id
     and (i.linear_estado <> 'creado' or (i.linear_destino is not null and i.linear_destino <> v_modo));
end;
$$;
revoke all on function public.web_incidencia_pedir_ticket(bigint) from public, anon;
grant execute on function public.web_incidencia_pedir_ticket(bigint) to authenticated;

-- Tareas programadas que fallaron (pg_cron). Solo si existe pg_cron.
do $$
begin
  if to_regclass('cron.job_run_details') is not null then
    execute $f$
      create or replace function public.web_logs_fallos_cron(p_desde timestamptz)
      returns table (runid bigint, jobname text, status text, return_message text, start_time timestamptz)
      language sql
      stable
      security definer
      set search_path = ''
      as $q$
        select d.runid, j.jobname, d.status, left(d.return_message, 500), d.start_time
          from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
         where d.status = 'failed' and d.start_time > p_desde
         order by d.start_time
         limit 200
      $q$
    $f$;
    execute 'revoke all on function public.web_logs_fallos_cron(timestamptz) from public, anon, authenticated';
    execute 'grant execute on function public.web_logs_fallos_cron(timestamptz) to service_role';
  end if;
end;
$$;

-- ─── 13. Funciones de IA: modelo elegible y consumo contabilizado ──────────
-- Solo si existe el centro de modelos (20261107500000) y el catálogo de costes.
do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo) values
        ('procesar-logs-web', 'Logs web: análisis de una incidencia agrupada antes de crear su ticket en Linear (hechos e hipótesis separados).', true, 'incidencia', 950, true),
        ('resumen-logs-web',  'Logs web y Tráfico web: resumen del periodo a partir de estadísticas agregadas (nunca visitas sueltas).', true, 'resumen', 951, true)
      on conflict (funcion) do nothing
    $q$;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    execute $q$
      insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado) values
        ('procesar-logs-web', 'gpt-4.1-mini, en código', true),
        ('resumen-logs-web',  'gpt-4.1-mini, en código', true)
      on conflict (funcion) do nothing
    $q$;
  end if;
end;
$$;

do $$ begin raise notice 'logs_web: aplicada'; end $$;

commit;
