# Lista de despliegue a producción

Proyecto Supabase: `jeamoczmbfsnwkfjxcyo` · URL base: `https://jeamoczmbfsnwkfjxcyo.supabase.co`

Estado comprobado contra producción el **19-09-2026**:
última migración aplicada `20260918120000_rls_por_permisos_de_seccion`.
Quedan **8 migraciones** pendientes y **16 funciones** por desplegar.
No hay migraciones remotas sin fichero local ni versiones duplicadas: `db push`
aplicará exactamente esas 8, en orden de nombre.

Confirmado con `supabase db push --dry-run --project-ref jeamoczmbfsnwkfjxcyo`
(CLI 2.117.0): las 8 esperadas, en orden, sin errores, `20260920000000` la última.

Orden global, sin saltarse pasos:

> **Paso 0 (secrets)** → **Paso 1 (migraciones)** → **Paso 2 (funciones)** → **Paso 3 (frontend)**

---

## ⚠️ ANTES DE EMPEZAR — lo que rompe si no lo tocas

Cinco cosas. Las tres primeras son bloqueantes.

### 1. `RESERVAS_WEB_TOKEN_SECRET` no existe. Sin él, confirmar/cancelar está muerto igualmente

Es el motivo de todo este despliegue y no basta con `verify_jwt = false`.
Sin ese secret la función falla **por los dos lados**:

- `verifyReservaToken` es *fail-closed*: `if (!TOKEN_SECRET) return null`
  (`supabase/functions/reservas-web/index.ts:331-334`) → **todos** los enlaces de
  confirmar y cancelar devuelven "Enlace no válido".
- (`signReservaToken` y `POST /notificar-estado` se retiraron el 2026-09-30:
  la ruta estaba abierta sin secreto. Solo queda la verificación de los
  enlaces ya enviados.)

**Defínelo en el Paso 0 o no despliegues `reservas-web`.**

### 2. `RESERVAS_WEB_SHARED_SECRET`: **NO lo definas**

Definirlo devuelve **401 en el formulario de reservas de la web pública**, porque
`casa-tomas-story` a propósito no manda la cabecera `x-webhook-secret`. Parece que
añades seguridad y tiras el canal de reservas. **Detalle completo en el Paso 0, §0.0.**

### 3. `vapi-analytics` nunca se ha desplegado y `VAPI_API_KEY` no existe

Está **commiteada** desde `e85ebe1` pero **nunca desplegada**: no aparece en la
lista de funciones del proyecto. Y el panel ya la llama
(`src/hooks/useVapiAnalytics.ts:36`), desde una página que además va en esta tanda
(`src/pages/AsistenteTelefonico.tsx`). Hoy da **404**; desplegada sin el secret
daría **500** en cada carga del panel de telefonía.

**Recomendación: desplegarla en esta tanda** (va en el Paso 2, orden 9), y definir
`VAPI_API_KEY` en el Paso 0. El motivo es que el panel que la consume sale sí o sí
en el Paso 3: si la dejas fuera, el despliegue introduce un 404 visible en una
pantalla que hoy ya existe. Aplazarla no te ahorra nada, porque no puedes aplazar
media build del panel.

**Si hoy no puedes conseguir la `VAPI_API_KEY`**, despliégala igualmente: el 500
con el mensaje `VAPI_API_KEY secret not configured` (`index.ts:166-175`) es más
diagnosticable que un 404 sin pista, y en cuanto pongas el secret funciona sin
volver a desplegar.

Deuda que NO bloquea esto: `vapi-analytics` valida el JWT de usuario pero **no
comprueba permisos**, así que cualquier usuario autenticado ve la analítica de
VAPI. Su propia cabecera dice que solo admins; el código no lo cumple. Anotado en
el apéndice.

### 4. ~~La migración `20260919120002_rebuild_webs_state.sql`~~ — YA CORREGIDA

Ese fichero traía dos defectos, **ya arreglados en el árbol**. Se deja anotado
para que no vuelvan a colarse:

- Tenía `begin;` … `commit;` propios. `supabase db push` ya aplica cada migración
  dentro de su transacción, así que ese `commit` **cerraba la transacción externa
  antes de tiempo** y rompía la atomicidad del resto. **Eliminados.**
- Su `create policy "web_rebuild_state_service_role"` no llevaba
  `drop policy if exists` delante: un reintento tras un push a medias moría con
  `42710: policy already exists`. **Guard añadido**, la migración ya es reejecutable.

Verificado con `supabase db push --dry-run`: siguen siendo las **8 pendientes**, en
orden y sin errores. No hace falta hacer nada aquí.

### 5. `RESEND_FROM_EMAIL` no existe → los clientes no reciben nada, y nadie se entera

Sin ese secret, `reservas-web` cae al remitente de pruebas de Resend
(`onboarding@resend.dev`, `index.ts:47`). El sandbox de Resend **solo entrega al
dueño de la cuenta**: la función registra el envío como correcto y el cliente no
recibe el correo. Fallo silencioso. Defínelo en el Paso 0.

---

## Paso 0 — Secrets (lo hace el dueño, antes de nada)

### 🚫 0.0 — El secret que NO debes definir: `RESERVAS_WEB_SHARED_SECRET`

**Léelo antes de tocar nada.** Es la trampa más fácil de pisar de toda esta lista:
parece que añades seguridad y lo que haces es **tirar el canal de reservas de la web**.

Si ese secret **no** existe, `checkSharedSecret` devuelve `true` y no bloquea nada
(`supabase/functions/reservas-web/index.ts:96`). Si **sí** existe, pasa a exigir la
cabecera `x-webhook-secret` en las dos rutas POST: `/disponibilidad` y `/crear`
(`/notificar-estado` se retiró el 2026-09-30).

El problema: **`casa-tomas-story` no manda esa cabecera, y es a propósito.** Era el
secreto de n8n (`VITE_N8N_WEBHOOK_SECRET`), viajaba vacío en el bundle y además
`chat-web` ni siquiera lo permitía en el preflight CORS, así que se quitó — está
documentado en `casa-tomas-story/src/lib/supabase-functions.ts:43-46`.

→ Definirlo hoy = **401 en `/disponibilidad` y `/crear`** = el formulario de
reservas de la web pública deja de funcionar por completo, para todos los
visitantes, sin que nadie se entere hasta que alguien intente reservar.

**Déjalo sin definir.** Solo se podrá poner cuando `casa-tomas-story` mande la
cabecera; eso es otro cambio, en otro repo, y no va en este despliegue.

Contrapartida que debes conocer, porque es real: con `verify_jwt = false` y sin
shared secret, `POST /crear` queda abierto a internet. Lo único que lo frena son
los límites por teléfono y por email de `configuracion_reservas`
(`index.ts:1118-1141`). Es deuda conocida y aceptada para esta tanda, no un
bloqueo. El arreglo de verdad es que la web mande la cabecera y entonces sí
definir el secret — las dos cosas a la vez, nunca una sola.

---

Los nombres definidos **hoy** en el proyecto son estos 16:

```
GOOGLE_PLACES_API_KEY   LOVABLE_API_KEY        MAPBOX_ACCESS_TOKEN
METRICS_SUPABASE_SERVICE_ROLE_KEY              METRICS_SUPABASE_URL
OPENAI_API_KEY          PERPLEXITY_API_KEY     RESEND_API_KEY
RESEND_WEBHOOK_SECRET   SUPABASE_ANON_KEY      SUPABASE_DB_URL
SUPABASE_JWKS           SUPABASE_PUBLISHABLE_KEYS
SUPABASE_SECRET_KEYS    SUPABASE_SERVICE_ROLE_KEY   SUPABASE_URL
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta la plataforma sola.

### 0.A — Obligatorios (sin esto el despliegue sale roto)

| Secret | Lo usa | Qué pasa si falta |
|---|---|---|
| `RESERVAS_WEB_TOKEN_SECRET` | `reservas-web` | **Confirmar/cancelar muerto** por partida doble (ver ⚠️ 1). Cadena aleatoria larga, p. ej. `openssl rand -base64 48`. |
| `RESEND_FROM_EMAIL` | `reservas-web` | Cae al sandbox de Resend: los clientes **no reciben el correo** y la función lo da por enviado (ver ⚠️ 5). Formato `Casa Tomás <reservas@tu-dominio.es>`, con el dominio verificado en Resend. |
| `VAPI_API_KEY` | `vapi-analytics` | 500 en cada carga del panel de telefonía (`index.ts:166-175`). |

### 0.B — Recomendados (funciona sin ellos, pero degrada en silencio)

| Secret | Lo usa | Qué pasa si falta |
|---|---|---|
| `VERCEL_DEPLOY_HOOK_CASA_TOMAS` | `rebuild-webs` | `dispararHook` devuelve `sin_hook_configurado`, la respuesta sigue siendo **200 `ok:true`** y la web **nunca se reconstruye**. Silencioso. |
| `VERCEL_DEPLOY_HOOK_TOUZA` | `rebuild-webs` | Igual que el anterior, para Touza. |
| `CHAT_WEB_ALLOWED_ORIGIN` | `chat-web` | Cae a `"*"`: CORS abierto a cualquier origen (`index.ts:64`). Ponle `https://restaurantecasatomascrevillente.es`. |
| `RESERVAS_WEB_ALLOWED_ORIGIN` | `reservas-web` | Cae a `"*"` (`index.ts:50`). Mismo dominio que el anterior. |
| `ALLOWED_ORIGIN` | `vapi-analytics` | Cae a `"*"` (`index.ts:28`). Ponle la URL del panel. |

### 0.C — Opcionales (fallback sano, decisión del dueño)

| Secret | Lo usa | Comportamiento sin él |
|---|---|---|
| `SUPER_ADMIN_EMAILS` | `admin-create-user`, `admin-delete-user`, `admin-update-user-password`, `list-users` | Fail-closed **a propósito**: no hay ningún super admin y la autorización recae en `is_admin()` (rol en `user_roles`). Solo rompe si nadie tiene el rol `admin`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_PARENT_FOLDER_ID` | `procesar-factura` | `DRIVE_ENABLED = false` y el original se guarda en el bucket privado `facturas-originales` en vez de Drive. Es el diseño previsto. Cómo sacar el refresh token: `supabase/functions/DEPLOY-facturas.md` §2. |
| `NEWSLETTER_UNSUB_SECRET` | `enviar-newsletter`, `newsletter-baja` | Ambas caen a `SUPABASE_SERVICE_ROLE_KEY`, **el mismo fallback**, así que las firmas siguen cuadrando. ⚠️ Si lo defines **más adelante**, los enlaces de baja ya enviados dejan de validar. Decídelo ahora o nunca. |
| `RESERVAS_WEB_PUBLIC_URL` | `reservas-web` | Se deriva de `SUPABASE_URL`: los enlaces del correo apuntan a `…supabase.co/functions/v1/reservas-web/…`. Funciona; solo cámbialo si quieres un dominio propio. |
| `N8N_TRADUCIR_NOVEDAD_WEBHOOK` | `traducir-novedad` | **Devuelve traducciones falsas** (`"Título (EN)"`, `"Título (FR)"`) y lo guarda como si fueran buenas (`index.ts:40-49`). No rompe, pero ensucia datos. `traducir-contenido` ya la sustituye en casi todos los sitios. |

**Comando** (solo los que decidas poner):

```bash
supabase secrets set \
  RESERVAS_WEB_TOKEN_SECRET='<cadena-aleatoria-larga>' \
  RESEND_FROM_EMAIL='Casa Tomás <reservas@tu-dominio.es>' \
  VAPI_API_KEY='<key-de-vapi>' \
  --project-ref jeamoczmbfsnwkfjxcyo
```

**Verificación del Paso 0** — los nombres tienen que aparecer en la lista:

```bash
supabase secrets list --project-ref jeamoczmbfsnwkfjxcyo
```

**Rollback:** `supabase secrets unset NOMBRE --project-ref jeamoczmbfsnwkfjxcyo`.
Ojo: quitar `RESERVAS_WEB_TOKEN_SECRET` invalida todos los enlaces ya enviados.

---

## Paso 1 — Las 8 migraciones, en este orden exacto

```bash
supabase db push --project-ref jeamoczmbfsnwkfjxcyo
```

`db push` ordena por el prefijo de versión, así que el orden de la tabla sale
solo. **Lo crítico es el par 1 ↔ 8** (ver la nota al final del paso).

| # | Fichero | Qué hace |
|---|---|---|
| 1 | `20260919100000_facturas_busqueda_y_herramientas_chatbot.sql` | Índice HNSW sobre `facturas.embedding` (el viejo apuntaba a una columna vacía) y 3 RPC nuevas para el chatbot; `buscar_facturas_agente` pasa a 4 argumentos con `p_tipo`. |
| 2 | `20260919110000_facturas_archivo_original_y_validacion.sql` | Columnas `facturas.archivo_path` y `facturas.alertas_validacion`, bucket privado `facturas-originales`, `validar_cordura_factura()` y **`UPDATE` sobre toda la tabla `facturas`** para rellenar las alertas. |
| 3 | `20260919120000_newsletter_baja_rgpd.sql` | `newsletter_suscriptores.fecha_baja` + `origen_baja` (con CHECK) y reconcilia `newsletter_envios.tipo_newsletter` / `estado`. |
| 4 | `20260919120002_rebuild_webs_state.sql` | Tabla `web_rebuild_state` (antirrebote de los deploys de Vercel), RLS solo `service_role`. |
| 5 | `20260919130000_fix_vista_ocupacion_hoy_estados.sql` | Rehace `vista_ocupacion_hoy` para no contar las canceladas y añade `reservas_activas` / `comensales_activos`. |
| 6 | `20260919140000_missing_indexes.sql` | 4 índices de reservas y blacklist. |
| 7 | `20260919150000_chat_web_memoria.sql` | Tablas `chat_web_conversaciones` y `chat_web_mensajes` + los 3 índices del limitador de tasa. |
| 8 | `20260920000000_fix_cifras_rpc_agente_facturas.sql` | **Rehace** `historial_precios_agente` y `resumen_periodo_agente` de la #1 para corregir dos bugs de cifras, y añade metadatos de IVA/truncado a `estadisticas_globales_agente`. |

### 🔴 La #8 va DESPUÉS de la #1. Nunca al revés

La #1 hace `drop function if exists historial_precios_agente(text,integer)` y
`resumen_periodo_agente(date,date)`, y `create or replace` de
`estadisticas_globales_agente()`. Si ejecutas la #1 **después** de la #8,
**borra las versiones corregidas y recrea las que tienen el bug, sin dar ningún
error**. Los dos bugs que volverían:

- `historial_precios_agente` ordenaba `asc … limit 30`, o sea se quedaba con las
  **30 compras más antiguas**: el "precio actual" era el de la 30ª compra más
  vieja. Además comparaba `min()` en un extremo con `max()` en el otro, así que
  todo producto "subía" de precio aunque no hubiera evolución.
- `resumen_periodo_agente` hacía `coalesce(p_desde, min(fecha))`: si el modelo
  mandaba una fecha mal formateada, **devolvía el histórico completo presentado
  como el del mes pedido**.

Con `db push` el orden es correcto por sí solo (`20260920000000` > `20260919100000`).
El riesgo real es ejecutar ficheros sueltos a mano en el editor SQL. **No lo hagas.**

### Verificación del Paso 1

Una sola consulta. Las 8 columnas tienen que dar el valor esperado:

```sql
select
  -- #1
  (select count(*) from pg_indexes where schemaname='public'
     and indexname='idx_facturas_embedding_hnsw')                        as m1_hnsw,        -- 1
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname, pg_get_function_identity_arguments(p.oid)) in (
       ('buscar_facturas_agente','vector, integer, double precision, text'),
       ('buscar_documentos_agente','text, text, date, date, integer'),
       ('historial_precios_agente','text, integer'),
       ('resumen_periodo_agente','date, date')))                         as m1_rpcs,        -- 4
  -- #2
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='facturas'
     and column_name in ('archivo_path','alertas_validacion'))           as m2_cols,        -- 2
  (select count(*) from storage.buckets
     where id='facturas-originales' and public=false)                    as m2_bucket,      -- 1
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
     and policyname like 'facturas_originales_%')                        as m2_politicas,   -- 3
  -- #3
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='newsletter_suscriptores'
     and column_name in ('fecha_baja','origen_baja'))                    as m3_cols,        -- 2
  -- #4
  (select count(*) from pg_tables where schemaname='public'
     and tablename='web_rebuild_state')                                  as m4_tabla,       -- 1
  -- #5
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='vista_ocupacion_hoy'
     and column_name in ('reservas_activas','comensales_activos'))       as m5_cols,        -- 2
  -- #6
  (select count(*) from pg_indexes where schemaname='public'
     and indexname in ('idx_reservas_telefono','idx_reservas_fecha_estado',
                       'idx_blacklist_tipo_valor','idx_blacklist_valor_lower')) as m6_idx,  -- 4
  -- #7
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('chat_web_conversaciones','chat_web_mensajes'))   as m7_tablas;      -- 2
```

**La #8 necesita su propia comprobación**, porque las funciones ya existen desde
la #1 y por catálogo se ven iguales. Esta distingue las dos versiones:

```sql
select (public.resumen_periodo_agente(null, null) ->> 'error') is not null as m8_aplicada;
-- true  → está la #8 (sin fechas devuelve error, que es lo correcto)
-- false → sigue la #1 (sin fechas devuelve el histórico completo: el bug)
```

Y que la versión quede registrada:

```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 8;   -- la primera fila debe ser 20260920000000
```

### Rollback del Paso 1

Los scripts están en `supabase/rollbacks/`, con su `README.md`. Se ejecutan **a
mano** (editor SQL o psql), nunca se devuelven a `supabase/migrations/`.

- De estas 8, **solo la #4 tiene rollback escrito**:
  `supabase/rollbacks/20260919120000_rebuild_webs_state_ROLLBACK.sql`
  (borra la política y la tabla `web_rebuild_state`).
- Los otros dos ficheros de esa carpeta revierten migraciones **ya en
  producción** (`20260918084909`, `20260918120000`). El primero **reabre la fuga
  de datos personales accesible con la anon key**. No los toques en este despliegue.
- **Las otras 7 no tienen rollback y casi ninguna lo necesita**: son aditivas
  (`add column if not exists`, `create table/index if not exists`,
  `create or replace`). La única con marcha atrás incómoda es la **#1**, que borra
  el índice `idx_facturas_embedding`; recrearlo es una línea y ese índice apuntaba
  a una columna vacía, así que no perderías nada real.
- Si algo falla a mitad de push: mira `supabase_migrations.schema_migrations`,
  identifica la última versión registrada y vuelve a lanzar `db push`. Las 8 son
  reejecutables sin tocar nada a mano (la #4 lo es desde el arreglo de la ⚠️ 4).

---

## Paso 2 — Funciones, en este orden

**Despliega siempre por nombre.** Un `supabase functions deploy` sin nombre
tocaría las 27 y aplicaría de golpe todos los cambios de `verify_jwt`.

Primero las que dependen de lo que acabas de migrar — **si las despliegas antes
del Paso 1, estos bots se quedan rotos**:

| Orden | Función | Depende de | Qué pasa si va antes |
|---|---|---|---|
| 1 | `chat-web` | migración **#7** | Su limitador de tasa es *fail-closed*: sin `chat_web_mensajes` **rechaza el 100 % de las peticiones** con 503. El bot de la web queda muerto. |
| 2 | `chat-facturas` | migraciones **#1 y #8** | Llama a `buscar_documentos_agente`, `historial_precios_agente`, `resumen_periodo_agente` y a `buscar_facturas_agente` con 4 argumentos. Sin la #1 no existen; sin la #8 **contesta cifras equivocadas sin avisar**, que es peor. |
| 3 | `procesar-factura` | migración **#2** | Escribe `archivo_path` y `alertas_validacion` y sube al bucket `facturas-originales`. Sin la #2 el OCR falla al guardar. |
| 4 | `newsletter-baja` | migración **#3** | Hace `update … fecha_baja, origen_baja`. Sin la #3 **toda baja del newsletter falla** (incumplimiento RGPD, además). |
| 5 | `enviar-newsletter` | migración **#3** | Inserta en `newsletter_envios` con `tipo_newsletter` y `estado`. Sin la #3 no se registra el historial de envíos. |
| 6 | `rebuild-webs` | migración **#4** | Su única tabla es `web_rebuild_state`. Sin la #4, 500 en cada guardado de la carta. |

Después, las que no dependen de ninguna migración pendiente:

| Orden | Función | Nota |
|---|---|---|
| 7 | `reservas-web` | **Nueva.** No depende de ninguna de las 8 (usa `reservas`, `blacklist`, `configuracion_reservas`, `configuracion_turnos`, `espacios_reserva`, `solicitudes_pendientes`, todas ya en producción). Sí depende del secret `RESERVAS_WEB_TOKEN_SECRET` del Paso 0. |
| 8 | `notify-reservation-change` | Llama a `emails-reserva/notificar` (ya no a `reservas-web/notificar-estado`, retirada el 2026-09-30). |
| 9 | `vapi-analytics` | **Nunca desplegada**, y el panel ya la llama. Necesita `VAPI_API_KEY`. Va en esta tanda a propósito: ver ⚠️ 3. |
| 10 | `traducir-contenido` | **Nueva.** Sustituye a `traducir-carta` / `traducir-novedad` en 12 sitios del panel. |
| 11 | `admin-create-user` · `admin-delete-user` · `admin-update-user-password` · `list-users` | Cambios de código. |
| 12 | `format-novedad` · `sync-google-reviews` | Cambios de código. |

```bash
R=jeamoczmbfsnwkfjxcyo
for f in chat-web chat-facturas procesar-factura newsletter-baja enviar-newsletter \
         rebuild-webs reservas-web notify-reservation-change vapi-analytics \
         traducir-contenido admin-create-user admin-delete-user \
         admin-update-user-password list-users format-novedad sync-google-reviews; do
  supabase functions deploy "$f" --project-ref "$R" || { echo "FALLO EN $f"; break; }
done
```

### Lo que cambia de `verify_jwt` al desplegar

`supabase/config.toml` ya tiene **entrada explícita para las 27 funciones**: antes
faltaban 10 y heredaban `true` por defecto sin que nadie lo hubiera decidido.
Las entradas solo surten efecto cuando se **redespliega** esa función, así que
las que no están en la lista de arriba conservan su valor actual hasta que las
toques.

De las 16 que despliegas, estas cambian de estado en el gateway:

| Función | Antes (remoto) | Ahora | Por qué no rompe |
|---|---|---|---|
| `reservas-web` | *(sin desplegar)* | **`false`** | **Es el arreglo.** Los GET de confirmar/cancelar llegan desde Gmail sin cabeceras. Su autenticación real es el HMAC de un solo uso. Los 3 POST siguen recibiendo `apikey` desde la web. |
| `newsletter-baja` | *(sin desplegar)* | **`false`** | Mismo caso: enlace de baja dentro del correo + HMAC propio. |
| `chat-web` | *(sin desplegar)* | `true` | `AIChatbot.tsx` manda siempre `apikey` + `Authorization` con la publishable key. |
| `rebuild-webs`, `vapi-analytics`, `traducir-contenido` | *(sin desplegar)* | `true` | Los llama el panel con `functions.invoke()` y sesión iniciada. |
| `admin-create-user`, `admin-delete-user`, `admin-update-user-password`, `chat-facturas`, `enviar-newsletter`, `format-novedad`, `procesar-factura`, `sync-google-reviews` | `false` | `true` | Todas se invocan desde el panel con sesión, que manda JWT. Ganan un filtro y no pierden nada. |
| `list-users`, `notify-reservation-change` | `true` | `true` | Sin cambio. |

Recordatorio del criterio, que está escrito también en la cabecera de
`config.toml`: **`verify_jwt = true` no es autenticación**. La anon key es un JWT
válido y viaja en el bundle público. Es solo un filtro de gateway para peticiones
sin ninguna cabecera; la autorización de verdad la hace cada función.

### Verificación del Paso 2

**A) El caso que motiva todo esto: enlace de confirmación sin cabeceras.**
Exactamente lo que hace el navegador del cliente al pulsar desde Gmail: sin
`Authorization`, sin `apikey`.

```bash
curl -s -o /tmp/r.html -w 'HTTP %{http_code}\n' \
  'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/reservas-web/confirmar?token=token-falso'
grep -o '<title>[^<]*</title>' /tmp/r.html
```

- ✅ **`HTTP 200`** + `<title>Enlace no válido - Casa Tomás Crevillente</title>`
  → la función se ha ejecutado y ha sido **su HMAC** quien ha rechazado el token
  falso. Es lo que queremos.
- ❌ `HTTP 401` con `{"code":401,"message":"Missing authorization header"}`
  → el gateway sigue filtrando: `verify_jwt` no se aplicó. Revisa `config.toml`
  y vuelve a desplegar `reservas-web`.

Repite con las otras dos rutas GET, que deben dar lo mismo:

```bash
for ruta in 'cancelar?token=x' 'cancelar/ejecutar?token=x'; do
  curl -s -o /dev/null -w "$ruta -> HTTP %{http_code}\n" \
    "https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/reservas-web/$ruta"
done   # los dos: 200
```

**Prueba de extremo a extremo** (la de verdad): en el panel, pon una reserva en
estado `verificada` → debe llegar el correo "Confirma tu asistencia" → pulsa
**Confirmar** desde el propio correo → tiene que salir "¡Reserva confirmada!" y
la reserva quedar en `confirmada`:

```sql
select id, nombre, estado, updated_at from public.reservas
where estado = 'confirmada' order by updated_at desc limit 5;
```

Y que el segundo clic en el mismo enlace ya dé "Enlace no válido" (token de un
solo uso: el `UPDATE` mueve `updated_at` y rompe la huella).

**B) Las demás rutas siguen vivas** (con cabeceras, como la web pública):

```bash
KEY='<publishable-key>'
curl -s -o /dev/null -w 'disponibilidad -> HTTP %{http_code}\n' \
  -X POST 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/reservas-web/disponibilidad' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"fecha":"2026-09-25"}'    # 200
```

**C) `chat-web` responde y guarda memoria:**

```bash
curl -s -X POST 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/chat-web' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"mensaje":"¿a qué hora abrís?","idioma":"es","id":"prueba-despliegue"}'
```
Debe devolver `{"success":true,"respuesta":"…"}`. Un `503 rate_limit_unavailable`
significa que **falta la migración #7**. Confirma que ha escrito:

```sql
select count(*) from public.chat_web_mensajes where session_id = 'prueba-despliegue';  -- > 0
```

**D) `chat-facturas` usa las RPC corregidas:** en el panel, pestaña de chat de
facturas, pregunta *"¿cuánto gasté en marzo?"*. Si contesta con el gasto de todo
el histórico, la #8 no está aplicada.

**E) `vapi-analytics` y el resto:** abre el panel de telefonía. No debe haber 404
ni 500. Revisa logs de cualquiera con:

```bash
supabase functions logs <nombre> --project-ref jeamoczmbfsnwkfjxcyo
```

### Rollback del Paso 2

Las Edge Functions **versionan en Supabase**: cada despliegue crea una versión
nueva y la anterior sigue ahí.

- **Vuelta atrás rápida de una función concreta:** `git checkout` del commit
  anterior de esa carpeta y `supabase functions deploy <nombre>` otra vez.
- **Solo quieres deshacer el `verify_jwt`:** cambia el valor en `config.toml` y
  redespliega esa función. No hace falta tocar el código.
- **Funciones nuevas** (`reservas-web`, `chat-web`, `rebuild-webs`,
  `newsletter-baja`, `traducir-contenido`, `vapi-analytics`): si hay que
  retirarlas, `supabase functions delete <nombre> --project-ref jeamoczmbfsnwkfjxcyo`.
  Antes de borrar `reservas-web`, ten en cuenta que dejarás sin destino los
  enlaces de confirmar/cancelar ya enviados.
- **`notify-reservation-change`** es *fire-and-forget* en los dos llamadores del
  panel: si falla, no verás error en la interfaz. Míralo en los logs.

---

## Paso 3 — Frontend (siempre el último)

El orden importa: **migraciones → funciones → frontend**. El panel ya lee
columnas que solo existen después del Paso 1 (`facturas.alertas_validacion`,
`facturas.archivo_path`, `vista_ocupacion_hoy.reservas_activas`); si lo
despliegas antes, la tabla de facturas y la ocupación del día fallan.

| Orden | Repo | Qué lleva | Depende de |
|---|---|---|---|
| 1 | `adminpanelct` | Panel: facturas (original + alertas), reservas, telefonía, gestión web | Pasos 1 y 2 completos |
| 2 | `casa-tomas-story` | Formulario de reservas contra `reservas-web` y chatbot contra `chat-web` (los dos dejan de hablar con n8n) | `reservas-web` y `chat-web` desplegadas |
| 3 | `touza-restaurant-website` | SEO/canonical y carta | Nada de lo anterior |
| 4 | `restaurante-phone` | `api/vapi-prompt.js` | Nada de lo anterior |

Variables de build nuevas, en Vercel, **antes** de lanzar cada build:

- `casa-tomas-story`: `VITE_MAPBOX_TOKEN` (vacío = el mapa de vinos no se monta y
  no se descargan los ~458 KB de `mapbox-gl`), `VITE_SITE_URL`, `VITE_GOOGLE_PLACE_ID`.
- `touza-restaurant-website`: `VITE_SITE_URL` (⚠️ el dominio definitivo está sin
  decidir; `touzabar.es` no resuelve hoy).

### Verificación del Paso 3

1. **Panel** — facturas: la columna de alertas se pinta y el botón de ver el
   original abre el fichero. Reservas → pestaña *Hoy*: los comensales del día ya
   **no** cuentan las canceladas.
2. **Web pública** — reserva de prueba de principio a fin: rellenar el formulario
   → 201 → llega el correo → confirmar desde el correo. Es el camino de la
   verificación A del Paso 2, ahora con el formulario real.
3. **Chatbot de la web** — una pregunta cualquiera; sin errores en consola y sin
   429/503.
4. **Typecheck** del panel (8 errores preexistentes, no deben ser más):
   ```bash
   cd adminpanelct && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'   # 8
   ```

### Rollback del Paso 3

Vercel guarda todos los despliegues: **Deployments → el anterior → Promote to
Production**. Es inmediato y no toca la base de datos. Como todas las migraciones
de este lote son aditivas, el frontend anterior sigue funcionando contra el
esquema nuevo: puedes revertir solo el frontend sin tocar los Pasos 1 y 2.

---

## Apéndice — cosas que he visto y NO son de este despliegue

No las arregles hoy, pero que no te pillen por sorpresa:

- **`calcular-distribucion-mesas` no existe.** `src/components/reservas/PlanoEspacio2D.tsx:1256`
  la llama por URL y no está desplegada ni hay código fuente en ningún repo. El
  botón "Calcular distribución óptima con IA" siempre enseña el toast de error.
  Es previo a este despliegue.
- **6 funciones desplegadas sin código local:** `check-availability`,
  `create-reservation`, `fetch-noticias-hosteleria`, `get-mapbox-token`,
  `migrate-menu-data`, `sync-google-reviews-debug`. Las dos primeras las sustituye
  `reservas-web`; `fetch-noticias-hosteleria` se ha borrado en local en este
  mismo cambio pero **sigue viva en producción**. Desplegar por nombre no las
  toca. Límpialas en una pasada aparte, cuando lo nuevo lleve unos días estable.
- **3 funciones huérfanas con código y cero llamadores:** `enviar-imagen-webhook`,
  `leer-metricas`, `notify-config-bot-change`. Esta última es un relay **sin
  autenticar** hacia un webhook de n8n hardcodeado (`index.ts:8`). Candidatas a borrar.
- **Ocho funciones no comprueban absolutamente nada** por su cuenta
  (`buscar-precios-mercado`, `procesar-dibujo-perimetro`, `sync-google-reviews`,
  `traducir-contenido` en modo normal, las cuatro `traducir-*`). Las he dejado en
  `verify_jwt = true`, que es un filtro, **no una barrera**. La deuda real es
  darles una comprobación de permiso propia al estilo de `rebuild-webs`.
  `sync-google-reviews` es la más expuesta: no mira `req.method` ni lee el body,
  así que un GET pelado dispara la sincronización entera con service role.
- **`vapi-analytics` valida el JWT pero no comprueba permisos:** cualquier usuario
  autenticado del proyecto ve la analítica de VAPI. Su cabecera dice que solo
  admins; el código no lo cumple.
- **La migración #5 rompería un `supabase db reset`.** La última definición de
  `vista_ocupacion_hoy` en el repo (`20260216065846`) tiene columnas incompatibles
  con el `CREATE OR REPLACE VIEW` de la #5. Contra producción pasa bien (la vista
  ya tiene la forma nueva porque se editó a mano en su día), pero una rama nueva
  o un reset fallarían.
- **La migración #6 es casi un no-op:** `idx_reservas_telefono` (ya parcial) y
  `idx_reservas_fecha_estado` **ya existen** en producción, e
  `idx_blacklist_tipo_valor` es redundante con el índice único
  `blacklist_tipo_valor_key`. Lo único nuevo de verdad es
  `idx_blacklist_valor_lower`.
