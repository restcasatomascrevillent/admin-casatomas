-- ===========================================================================
-- ##                                                                       ##
-- ##                            APLICADA                                   ##
-- ##                                                                       ##
-- ##   Corregido 2026-09-23: SI esta aplicado -- su version aparece en      ##
-- ##   supabase_migrations.schema_migrations (API de Supabase, solo         ##
-- ##   lectura). SQL sin tocar.                                            ##
-- ##                                                                       ##
-- ===========================================================================
--
-- REINTENTO DE ENVÍOS DE CORREO FALLIDOS + AVISO INTERNO AL AGOTARSE
-- ===========================================================================
-- Autor: agente "robustez de envío de emails-reserva". Depende de que
-- 20260920010000_sistema_emails_reserva.sql YA esté aplicada (crea
-- envios_email_reserva) y de que 20260313000000_solicitudes_y_notificaciones.sql
-- también lo esté (crea notificaciones_dashboard) — ambas anteriores a esta
-- por fecha, así que un `supabase db push` normal ya las aplica en orden.
--
-- DIAGNÓSTICO CONFIRMADO ANTES DE ESCRIBIR ESTO (leyendo el código real de
-- emails-reserva/index.ts tal y como estaba antes de este cambio, no de
-- oídas ni del informe de capacidad sin más — ver también
-- docs/CAPACIDAD-RESERVAS-EMAIL.md, que apunta en la misma dirección):
--   - Cuando Resend devuelve un error al mandar un correo de reserva, la
--     fila de `envios_email_reserva` quedaba en resultado='fallido' con el
--     motivo en `error`, y AHÍ SE QUEDABA PARA SIEMPRE. Ningún cron, ninguna
--     tarea, nada volvía a mirar esa fila.
--   - Solo dos resultados existían: 'enviado' y 'fallido' — ningún tercer
--     estado que distinguiera "puede que se reintente" de "ya se ha
--     abandonado del todo".
--   - Nada escribía en `notificaciones_dashboard` desde emails-reserva. El
--     personal no tenía forma de enterarse salvo yendo a mirar la tabla a
--     propósito.
--
-- QUÉ CAMBIA (código en supabase/functions/emails-reserva/index.ts +
-- reintentos.ts — no lo hace esta migración, ella solo prepara el terreno):
--   1. Cada fallo se clasifica como reintentable (429/5xx/409-concurrencia/
--      sin respuesta HTTP) o permanente (400/401/403/404/405/422, o 409 de
--      payload distinto con la misma clave de idempotencia) —
--      reintentos.ts:clasificarErrorEnvio.
--   2. Los reintentables se reintentan con espera creciente (10/20/40/80
--      minutos) hasta un máximo de intentos (5 en total); al agotarse, o
--      directamente si el fallo es permanente, la fila pasa a un estado
--      NUEVO y distinguible: 'fallido_definitivo'.
--   3. Cada intento (el original Y cada reintento) manda a Resend con la
--      cabecera `Idempotency-Key` fijada al id de la propia fila de
--      envios_email_reserva — estable entre reintentos porque el reintento
--      hace UPDATE de la misma fila, nunca INSERT de una nueva. Resend
--      conserva esa clave 24h y, si la misma clave se repite con el mismo
--      contenido, devuelve el envío original SIN mandarlo dos veces
--      (resend.com/changelog/idempotency-keys, consultado 22-09-2026). Es
--      la garantía real contra duplicados, no solo "cruzar los dedos".
--   4. Al llegar a 'fallido_definitivo' se inserta un aviso en
--      `notificaciones_dashboard` (la campana que ya existe en el panel,
--      CentroNotificaciones.tsx) — agrupado (nunca uno por reserva) y con
--      un cooldown entre avisos, para no generar un aluvión si Resend cae
--      un rato y arrastra a varias reservas a la vez.
--
-- Esta migración solo aporta lo que ese código necesita en la base de
-- datos: dos columnas nuevas, un estado más en el CHECK de `resultado`, un
-- índice, y una tercera tarea programada (además de las dos que ya
-- instaló 20260920010000) que llama a la ruta nueva /reintentar-fallidos.
-- ===========================================================================

begin;

-- ============================================================================
-- PIEZA 1 — Columnas nuevas en envios_email_reserva
-- ----------------------------------------------------------------------------
-- `ultimo_intento_at` distingue "cuándo fue el intento MÁS RECIENTE" de
-- `creado_at` (solo el primero) y `enviado_at` (solo si tuvo éxito) — hace
-- falta para poder razonar sobre "¿cuánto hace del último intento?" en el
-- futuro, aunque el mecanismo de hoy decide el próximo intento con
-- `proximo_reintento_en` (ya calculado) y no recalculando a partir de esta
-- columna.
-- `proximo_reintento_en` es la hora exacta (ya calculada por
-- reintentos.ts:calcularProximoReintento con espera creciente) a partir de
-- la cual esta fila 'fallido' vuelve a ser candidata. NULL si nunca falló
-- o si ya pasó a 'fallido_definitivo' (no hay "próximo" para eso).
-- ============================================================================

alter table public.envios_email_reserva
  add column if not exists ultimo_intento_at timestamptz not null default now();

alter table public.envios_email_reserva
  add column if not exists proximo_reintento_en timestamptz;

comment on column public.envios_email_reserva.ultimo_intento_at is
  'Cuándo se hizo el intento más reciente sobre esta fila (éxito o fallo). A diferencia de creado_at (solo el primer intento) y enviado_at (solo si tuvo éxito). Se actualiza en cada reclamo de reintento y en cada marcado de resultado — ver marcarEnviado/marcarFallidoReintentable/marcarFallidoDefinitivo/reclamarReintento en emails-reserva/index.ts.';
comment on column public.envios_email_reserva.proximo_reintento_en is
  'Próxima vez que POST /reintentar-fallidos debe intentar esta fila si sigue en resultado=''fallido''. NULL si nunca falló, o si ya está en ''fallido_definitivo'' (no hay próximo intento). Calculado con espera creciente por emails-reserva/reintentos.ts (calcularProximoReintento): 10/20/40/80 minutos, tope 6h.';

-- Backfill defensivo — no debería haber filas todavía (el sistema de
-- correos de 20260920010000 sigue sin aplicar según el propio informe de
-- capacidad), pero si las hubiera, se les da un valor razonable en vez de
-- dejarlas con NULL en una columna NOT NULL.
update public.envios_email_reserva
  set ultimo_intento_at = coalesce(enviado_at, creado_at)
  where ultimo_intento_at is null;


-- ============================================================================
-- PIEZA 2 — Nuevo estado 'fallido_definitivo'
-- ----------------------------------------------------------------------------
-- Encargo, punto 2: "...un número máximo de intentos tras el cual el correo
-- se da por perdido y se marca de forma DISTINGUIBLE." 'fallido' pasa a
-- significar "todavía puede reintentarse"; 'fallido_definitivo' significa
-- "se acabó, hace falta que lo resuelva un humano" (llamar al cliente,
-- revisar configuración, etc. — ver el aviso de PIEZA 4).
--
-- El nombre exacto de la constraint de CHECK sobre `resultado` no se da por
-- supuesto (podría no coincidir con el nombre por defecto de Postgres si
-- algún día cambia cómo se creó la tabla): se busca por catálogo antes de
-- tocarla, en vez de asumir `envios_email_reserva_resultado_check` a ciegas
-- — esta migración no se ha podido probar contra una base de datos real
-- (sin acceso a Supabase en esta sesión), así que se prefiere la vía que no
-- depende de acertar un nombre.
--
-- 'fallido_definitivo' NO se añade al índice único parcial
-- uq_envio_email_reserva_activo (que solo cubre 'pendiente'/'enviado',
-- PIEZA 3a de 20260920010000): igual que 'fallido' hoy, deja el hueco
-- libre para un envío futuro si la reserva vuelve a pasar por el mismo
-- tipo de correo más adelante (p.ej. una nueva verificación tras editar la
-- reserva). No hace falta tocar ese índice para esto.
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
    and rel.relname = 'envios_email_reserva'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%resultado%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.envios_email_reserva drop constraint %I', v_constraint_name);
  end if;

  alter table public.envios_email_reserva
    add constraint envios_email_reserva_resultado_check
    check (resultado in ('pendiente', 'enviado', 'fallido', 'fallido_definitivo'));
end;
$$;

comment on constraint envios_email_reserva_resultado_check on public.envios_email_reserva is
  'pendiente=reclamado, en curso. enviado=éxito. fallido=falló pero puede reintentarse (ver proximo_reintento_en). fallido_definitivo=se agotaron los intentos o el fallo era permanente; estado final, genera aviso en notificaciones_dashboard (tipo=''email_fallido'') y nada vuelve a tocar la fila salvo un humano.';


-- ============================================================================
-- PIEZA 3 — Índice para la consulta de candidatas a reintento
-- ----------------------------------------------------------------------------
-- POST /reintentar-fallidos consulta `where resultado = 'fallido' order by
-- proximo_reintento_en` en cada pasada del cron (cada 15 min, PIEZA 4) — un
-- índice parcial (solo filas 'fallido', que en cualquier escala realista
-- para este restaurante son pocas — ver docs/CAPACIDAD-RESERVAS-EMAIL.md)
-- lo resuelve sin escanear toda la tabla según crezca el histórico de
-- envíos.
-- ============================================================================

create index if not exists idx_envios_fallidos_reintento
  on public.envios_email_reserva (proximo_reintento_en)
  where resultado = 'fallido';


-- ============================================================================
-- PIEZA 4 — Tercera tarea programada: reintentar cada 15 minutos
-- ----------------------------------------------------------------------------
-- Mismo patrón EXACTO que los dos jobs ya instalados por 20260920010000
-- (pg_net + pg_cron + cabecera x-webhook-secret leída de
-- vault.decrypted_secrets con el MISMO secreto 'emails_reserva_cron_secret'
-- que ya pedían esos dos — no hace falta un secreto nuevo ni un paso manual
-- adicional si ya se hizo el de aquella migración).
--
-- Frecuencia DISTINTA a propósito: 'emails-reserva-recordatorios-t2' y
-- 'emails-reserva-detectar-ausencias' son avisos de una vez al día porque
-- su trabajo es "revisa qué toca hoy". Este job reintenta con espera
-- creciente en minutos/horas (reintentos.ts: 10/20/40/80 min) — comprobarlo
-- solo una vez al día dejaría la espera creciente sin ningún efecto
-- práctico (un cliente esperando su confirmación no debería tener que
-- esperar hasta la mañana siguiente porque Resend tuvo un blip de cinco
-- minutos). Cada 15 minutos es holgado de sobra frente a pg_net (pensado
-- para del orden de 200 peticiones POR SEGUNDO, sección 2.3 del informe de
-- capacidad) y frente al límite de Resend (10 req/s, y la mayoría de las
-- pasadas no encuentran ninguna fila que reintentar: el SELECT vuelve
-- vacío y la función termina casi al instante).
-- ============================================================================

select cron.unschedule('emails-reserva-reintentar-fallidos') where exists (
  select 1 from cron.job where jobname = 'emails-reserva-reintentar-fallidos'
);

select cron.schedule(
  'emails-reserva-reintentar-fallidos',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/emails-reserva/reintentar-fallidos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'emails_reserva_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

commit;

-- ============================================================================
-- CHECKLIST POST-MIGRACIÓN (no lo hace esta migración; pasos de quien
-- despliegue, fuera del alcance de "no apliques migraciones, no despliegues"
-- de este encargo):
--
--   1. Si 20260920010000_sistema_emails_reserva.sql y su paso manual
--      (select vault.create_secret('<valor>', 'emails_reserva_cron_secret'))
--      ya están hechos, NO hace falta ningún secreto nuevo para esta
--      migración — reutiliza el mismo. Si no lo están, hacerlo primero (esta
--      migración depende de que EMAILS_RESERVA_SHARED_SECRET y el secreto de
--      Vault ya existan; si faltan, /reintentar-fallidos rechazará las
--      llamadas del cron con 401, igual que /recordatorios y
--      /detectar-ausencias hoy — falla cerrado a propósito).
--   2. supabase functions deploy emails-reserva   (recoge index.ts +
--      reintentos.ts — ambos ficheros nuevos/modificados de esta entrega).
--   3. Confirmar tras desplegar: select jobname, schedule, active from
--      cron.job where jobname like 'emails-reserva-%'; deben aparecer los
--      TRES jobs (recordatorios-t2, detectar-ausencias, reintentar-fallidos).
--   4. Opcional: EMAILS_RESERVA_REINTENTO_MAX_FILAS (por defecto 50) si se
--      quiere ajustar cuántas filas 'fallido' se evalúan como máximo por
--      pasada del cron — ver emails-reserva/index.ts.
--   5. Si el proyecto cambia de ref/URL alguna vez, esta migración tiene su
--      propia URL literal en el cron.schedule(...) de la PIEZA 4 — mismo
--      punto ya señalado para los otros dos jobs en 20260920010000.
-- ============================================================================
