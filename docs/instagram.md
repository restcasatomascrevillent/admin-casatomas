# Instagram en el panel: generar y publicar piezas

Sección **Instagram** del menú lateral (ruta `/instagram`, justo debajo de
Newsletter; desde el 05/11/2026 ya no es una pestaña de Newsletter). Mismo
permiso que Newsletter: la sección `marketing` (y el mismo interruptor del
Super Admin). El panel monta la pieza (plantilla + textos + foto), el servidor
la convierte en un JPEG exacto y la publica en Instagram con la API oficial de
Meta. Cuenta de pruebas: **@oficiososia**. La página no hace scroll vertical:
mide el alto de la pantalla (`useAlturaDisponible`) y cada columna del editor
hace su propio scroll (`src/pages/Instagram.tsx`).

El **archivo** (fotos de la biblioteca y JPEG publicados) vive en **Google
Drive**, en la carpeta «marketing» del secreto
`GOOGLE_DRIVE_MARKETING_FOLDER_ID`; el bucket «instagram» es solo una escala
temporal. Detalle en [instagram-fotos.md](instagram-fotos.md).

## Arquitectura

```
 Panel (navegador)                     Vercel (función Node)                   Supabase                     Meta
 ───────────────────                   ─────────────────────────               ─────────────                ─────────────────────
 editor + vista previa  ── JWT ──►  POST /api/instagram-render
 (mismo HTML que el                    validarPieza + construirDocumento
  servidor: src/lib/instagram)         Chromium (playwright-core +
                                       @sparticuz/chromium) → captura
                                       sharp → JPEG 92, 4:4:4, ≤ 8 MB  ──►  bucket público «instagram»
                                                                           piezas/AAAA-MM/<id>.jpg
                                                                       ──►  instagram_piezas (estado
                                                                            «generada», RLS Marketing)

                       ── JWT + apikey ──►  Edge Function instagram-publicar (Supabase, Deno)
                                       caption · HEAD de la URL pública · cuota
                                       contenedor ─────────────────────────────────────────────────►  POST /{ig}/media
                                       sondeo hasta FINISHED ──────────────────────────────────────►  GET /{contenedor}
                                       (solo si no es prueba) media_publish + permalink ───────────►  POST /{ig}/media_publish
                                                                       ──►  instagram_piezas («prueba_ok»
                                                                            o «publicada» + permalink)
                       ── JWT + apikey ──►  Edge Function instagram-estado (comprobar conexión) ───►  identidad, token, cuota
                                                                                                      + Google Drive (secretos, alcance, carpeta)

 Biblioteca de fotos   ── JWT + apikey ──►  Edge Function instagram-drive   ◄──►  Google Drive marketing/instagram/fotos/<marca>
 (listar, subir,                       preparar: copia la foto elegida  ──►  bucket «instagram» tmp/<uuid>.jpg
  miniatura, preparar)                 (la URL que usan vista previa y render; se borran a las 24 h)

 Tras publicar:  instagram-publicar ──► Drive marketing/instagram/publicadas/AAAA-MM  (y SOLO entonces borra el JPEG del bucket)
```

- **Secretos de Meta SOLO en Supabase** (decisión del dueño, 04/11/2026):
  como el resto del panel (facturas, Drive…), `IG_ACCESS_TOKEN` y compañía
  viven en **Supabase → Edge Functions → Secrets**, sin duplicarlos en
  Vercel. Por eso publicar y comprobar la conexión son **Edge Functions**
  (`supabase/functions/instagram-publicar` e `instagram-estado`). El render
  sigue en Vercel porque necesita Chromium y **no usa ningún secreto de Meta**.
  Al estar en Supabase, publicar y comprobar también funcionan con
  `npm run dev` (el panel llama a `${VITE_SUPABASE_URL}/functions/v1/…`); solo
  «Generar imagen» necesita la demo de Vercel.
- **Un solo núcleo** (`src/lib/instagram/`): las plantillas, la validación, el
  HTML y las comprobaciones de maquetación son el mismo código en la vista
  previa del panel y en el servidor. Lo que se ve es lo que se publica.
- **El bucket es solo una escala** (decisión del dueño, 04-05/11/2026): el
  archivo definitivo vive en **Google Drive**. Tras una publicación REAL,
  `instagram-publicar` sube el JPEG a `marketing/instagram/publicadas/AAAA-MM/`,
  guarda su id en `instagram_piezas.drive_id` y **solo entonces** borra el JPEG
  del bucket y la copia `tmp/` de la foto usada (con el JWT del usuario; la
  RLS `instagram_objetos_delete_seccion` lo permite a quien tiene Marketing).
  **Si Drive falla o no está configurado, no se borra nada** y la respuesta y
  la fila lo avisan (`error` empieza por «Publicada, pero no se pudo guardar
  en Google Drive…»). `imagen_ruta` se conserva en la fila: una pieza
  «publicada» con `drive_id` ya no tiene el fichero en el bucket, salvo que su
  `error` empiece por «Publicada, pero el JPEG no se pudo borrar…». La
  respuesta lo dice en `imagenEnBucket` y `driveId`. En una **prueba**
  (dryRun) **no** se toca nada: el contenedor necesita la URL hasta que se
  publique.
- **Recursos**: las **fuentes y logos** van en el propio panel
  (`public/instagram/`, ~1 MB). La función de render los lleva dentro de su
  bundle (`vercel.json` → `includeFiles`) y se los sirve a Chromium desde
  disco, sin salir a la red: el documento se carga como
  `<origen del panel>/__pieza-instagram.html` y las peticiones a
  `<origen>/instagram/…` se contestan con esos ficheros (mismo origen, así
  las @font-face no necesitan CORS). Las **fotos** de la biblioteca están en
  Google Drive; la elegida se copia al bucket (`tmp/<uuid>.jpg`, Edge Function
  `instagram-drive` → `preparar`) y Chromium la descarga por esa URL pública.
  El render **solo** acepta URLs `tmp/` del bucket «instagram» de su propio
  Supabase y la reconstruye desde la ruta (sin SSRF; ver
  [instagram-fotos.md](instagram-fotos.md)). El catálogo estático
  (`fotos/<marca>/…`, `scripts/instagram/subir-recursos.mjs`) ya no se enseña
  en el panel: queda de respaldo en el render para piezas antiguas.
- **Siempre como el usuario**: las funciones usan la clave pública de Supabase
  y el JWT de quien pulsa el botón, así que la RLS de `instagram_piezas` y del
  bucket decide (escritura solo con permiso de **Marketing**,
  `can_write_section('marketing')`). Nunca `service_role` (el envoltorio de
  auditoría común de las Edge Functions solo lo usa para saber quién llama).
- **Secretos solo en el servidor**: el token de Meta nunca sale en
  respuestas, errores ni registros (todo pasa por
  `supabase/functions/_shared/instagram/secretos.ts`; hay tests que capturan
  la consola y lo comprueban).

Código:
- Edge Functions: `supabase/functions/instagram-publicar/`,
  `supabase/functions/instagram-estado/` y `supabase/functions/instagram-drive/`
  (`index.ts` solo engancha; la lógica en `publicar.ts` / `estado.ts` /
  `drive.ts`), el cliente de Drive `supabase/functions/_shared/google-drive.ts` y
  `supabase/functions/_shared/instagram/` (cliente de la Graph API, errores
  en castellano, saneado, comprobación, secretos, acceso a Supabase como el
  usuario). Tests en sus `__tests__/` (sin red).
- Vercel: `api/instagram-render.ts` y `api/_lib/instagram/` (arranque de
  Chromium, render, saneado, acceso a Supabase). Tests:
  `api/_lib/__tests__/instagram.test.ts` (sin red ni Chromium).
- Panel: `src/pages/Instagram.tsx` (página y ruta `/instagram`, entrada en
  `src/components/AppSidebar.tsx`) y `src/components/marketing/instagram/`
  (`api.ts`, `EditorInstagram.tsx`, `useFotosInstagram.ts`…).

## Secretos de Supabase

Van en **Supabase → Edge Functions → Secrets** del proyecto (demo
`sfonaclosuafvlhutkon` primero; producción `haqmmdfdzzatdnrrcgez` solo cuando
el dueño lo diga). **Nada en Vercel**. Los cambios se aplican sin volver a
desplegar la función.

| Secreto | Obligatorio | Qué es |
|---|---|---|
| `IG_ACCESS_TOKEN` | sí | Token del **usuario del sistema** de Meta (no caduca). Permisos `instagram_basic` + `instagram_content_publish`. |
| `IG_USER_ID` | sí | ID **numérico** de la cuenta profesional de Instagram (no el @usuario). «Comprobar conexión» lista los que ve el token. |
| `META_APP_ID` | sí | developers.facebook.com → Mis apps → (app) → Configuración → Básica. |
| `META_API_VERSION` | no | `vNN.N`; por defecto `v26.0`. |
| `META_APP_SECRET` | no | Opcional. Con él la comprobación del token usa `debug_token` con token de app (método documentado: caducidad, app y permisos). |
| `IG_USER_ID_CASA_TOMAS`, `IG_USER_ID_TOUZA` | no | Cuenta **propia** de cada marca. Sin ellos, la marca publica en `IG_USER_ID` (hoy las dos van a @oficiososia, la cuenta de pruebas). |
| `IG_ACCESS_TOKEN_CASA_TOMAS`, `IG_ACCESS_TOKEN_TOUZA` | no | Token propio de la marca, solo si el general no ve su cuenta (otro usuario del sistema u otro portfolio). Sin él, se usa `IG_ACCESS_TOKEN`. |
| `GOOGLE_DRIVE_MARKETING_FOLDER_ID` | sí, para el archivo | Id de la carpeta «marketing» de Drive (lo que va tras `/folders/` en su enlace). Sin él, la biblioteca de fotos no carga y al publicar el JPEG se queda en el bucket. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | sí, para el archivo | Los **mismos** de las facturas (ya están). Ojo con el alcance del token: ver «TRAMPA: el alcance drive.file» en [instagram-fotos.md](instagram-fotos.md). |

Por línea de comandos, desde la raíz del repo (`admin-casatomas/`):

```
npx supabase secrets set IG_ACCESS_TOKEN=… IG_USER_ID=… META_APP_ID=… --project-ref sfonaclosuafvlhutkon
```

o en el Dashboard: **Edge Functions → Secrets → Add new secret**.

**Cuenta por marca** (07/11/2026). Cada pieza se publica, se programa y se
mide con la cuenta de **su marca**: `IG_USER_ID_<MARCA>` /
`IG_ACCESS_TOKEN_<MARCA>` si existen y, si no, `IG_USER_ID` /
`IG_ACCESS_TOKEN`. Sin tocar nada todo sigue como antes. Cuando Touza tenga
su cuenta de Instagram (en el mismo portfolio y asignada al usuario del
sistema), basta con:

```
npx supabase secrets set IG_USER_ID_TOUZA=<ID numérico> --project-ref sfonaclosuafvlhutkon
```

«Comprobar conexión» enseña en qué cuenta publica cada marca y de qué
secreto sale; el diálogo de «Publicar» nombra la cuenta de la marca de la
pieza; «Métricas» captura cada cuenta distinta y deja elegirla.
`SUPABASE_URL` y `SUPABASE_ANON_KEY` los pone la plataforma en todas las
funciones; de ahí sale la URL pública del JPEG.

**Nunca** pongas el token con prefijo `VITE_` (acabaría dentro del JavaScript
del navegador) ni lo pegues en chats, capturas o el repositorio.

Cómo conseguir el token, el usuario del sistema y el ID de la cuenta: igual
que en el prototipo (`instagram-studio/docs/meta-setup.md`, pasos 1-5),
cambiando «.env» por los secretos de Supabase. Resumen: Meta Business Suite →
Configuración del negocio → Usuarios del sistema → (usuario) → Asignar activos
(cuenta de Instagram con control total + la app) → Generar token (la app,
caducidad «Nunca», `instagram_basic` e `instagram_content_publish`).

## Desplegar las Edge Functions

Desde la raíz del repo (`admin-casatomas/`):

```
npx supabase functions deploy instagram-drive instagram-publicar instagram-estado --project-ref sfonaclosuafvlhutkon
```

Antes, la migración de Drive en la demo (una sola vez, nunca `db push`):

```
npx supabase db query --linked -f supabase/migrations/20261105150000_instagram_drive.sql
```

**Sin `--no-verify-jwt`**: en `supabase/config.toml` las tres tienen
`verify_jwt = true` (como el resto de funciones que llama el panel con
sesión; la CLI lo lee de ahí). La autorización de verdad la hace cada
función (sesión + `can_write_section('marketing')`). Producción
(`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí» del
dueño, y con sus propios secretos.

## Probar la conexión desde el panel

1. Entra en la demo con un usuario que tenga **Marketing**.
2. **Instagram** (menú lateral) **→ pestaña Conexión → Comprobar** (llama a
   la Edge Function `instagram-estado`). Muestra:
   - los secretos (presentes o no; del token, como mucho `…abcd`);
   - la cuenta (`@usuario` e id) y si coincide con `IG_USER_ID`;
   - la cuota de publicación (usadas / total en 24 h);
   - con qué método se ha verificado el token y qué no se ha podido verificar;
   - para cada fallo, **cómo arreglarlo**;
   - debajo, **Google Drive**: si están los secretos (nunca su valor), el
     permiso (alcance) del token (nunca el token), si la carpeta «marketing»
     se ve y si se puede escribir en ella. Con `drive.file` y la carpeta
     creada a mano, explica qué hacer.
3. Genera una pieza y pulsa **Probar publicación** (`dryRun: true`): crea el
   contenedor en Meta y espera a FINISHED **sin publicar**. Si sale bien, la
   pieza queda en «prueba_ok».
4. Solo entonces **Publicar** (`dryRun: false`).

Diagnóstico del render: `GET /api/instagram-render` con sesión de Marketing
arranca Chromium y captura un lienzo de prueba (sin guardar nada); devuelve la
plataforma y los tiempos.

## Contratos de las funciones

Todas: `Authorization: Bearer <JWT de Supabase>` (las Edge Functions,
además, `apikey: <clave pública>`). 401 sin sesión, 403 sin Marketing. Respuestas JSON con `ok`; los errores llevan `error` y, cuando
aplica, `problemas: string[]` y `comoArreglarlo`.

**POST /api/instagram-render** — cuerpo `{ "pieza": {…}, "id"?: "<uuid>", "caption"?: "…", "fotoPreparada"?: { id: "drive:<id>", url, ancho, alto, tipo, marca } }`
(`fotoPreparada.url` solo puede ser `tmp/<uuid>.(jpg|png|webp)` del bucket «instagram» de ese Supabase: si no, 400)
→ 200 `{ ok, id, estado: "generada", urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos }`.
422 si la pieza no es válida, si no carga un recurso (fuente, logo, foto) o si
no pasa la maquetación (desbordes, márgenes, zona segura del story, campos
vacíos). 404 si el `id` no existe; 409 si esa pieza ya está publicada.

**POST `${SUPABASE_URL}/functions/v1/instagram-publicar`** — cuerpo `{ "id": "<uuid>", "caption"?: "…", "dryRun": true|false, "contenedorId"?: "…", "fotoTmp"?: "tmp/<uuid>.jpg" }`
→ 200 `{ ok, id, dryRun, publicado, estado: "prueba_ok"|"publicada", contenedor: { id, estado }, urlJpeg, mediaId, permalink, cuota: { usadas, total, restantes, ventanaHoras }, caption: { caracteres, hashtags, menciones }, avisos }`.
Al publicar de verdad la respuesta añade `driveId` (id del JPEG en Drive, o
`null` si no se pudo guardar) e `imagenEnBucket` (`false` = el JPEG ya se
borró del bucket; nunca se borra sin `driveId`).
→ 202 `{ ok, estado: "en_proceso", contenedor, reintentar: { id, contenedorId, dryRun } }`
si Meta no ha terminado de procesar la imagen dentro del tiempo de la función:
repetir la misma petición con ese `contenedorId` (no crea otro contenedor).

**GET `${SUPABASE_URL}/functions/v1/instagram-estado`** → 200 `{ ok, variables, faltan, identidad, cuota, metodoVerificacion, versionApi, tokenEnmascarado, comprobaciones, noVerificado, entornoSupabase, drive: { ok, alcance, alcances, carpeta, comprobaciones, avisos } }`.
`ok` sigue siendo «se puede publicar en Instagram»; Drive va aparte en `drive.ok`.

**`${SUPABASE_URL}/functions/v1/instagram-drive`** — `POST { accion: "listar", marca }`,
`POST ?accion=subir` (multipart: `archivo`, `marca`, `tipo`, `descripcion`),
`GET ?accion=miniatura&marca=…&id=…` (bytes) y `POST { accion: "preparar", marca, id }`
→ `{ ruta: "tmp/<uuid>.jpg", url, ancho, alto }`. 503 si faltan los secretos de
Google; 502 si Drive falla (con `comoArreglarlo`). Detalle en [instagram-fotos.md](instagram-fotos.md).

## Límites

- **Imagen**: solo JPEG (sRGB), ≤ 8 MB; feed entre 4:5 y 1,91:1 y de 320 a
  1440 px de ancho (las piezas son 1080×1350); story 9:16 (1080×1920).
- **Texto**: ≤ 2200 caracteres, ≤ 30 hashtags, ≤ 20 menciones. Las stories no
  admiten texto por la API (se ignora).
- **Cuota**: Meta limita las publicaciones por cuenta en 24 h; el total lo da
  Meta (`config.quota_total`) y la función **no publica si está agotada**.
- **Contenedores**: caducan a las 24 h. Una prueba no gasta cuota.
- **Tiempo**: render ≤ 60 s (`vercel.json`). La publicación espera
  FINISHED unos 55 s (la Edge Function tiene ~150 s de reloj) y, si Meta no
  ha terminado, responde 202 «en_proceso» para reintentar. El primer
  render de cada instancia descomprime Chromium en `/tmp` (1-3 s más).
- **Memoria**: Chromium necesita ~1,5 GB. Con Fluid Compute la memoria se
  configura en el panel de Vercel (Settings → Functions), no en
  `vercel.json`; el plan Hobby da 2 GB, suficiente.

## Estado de publicación solo por el servidor y doble publicación

Desde la migración `20261107000000_instagram_publicacion_servidor`:

- El panel (rol `authenticated`) **no** puede poner una pieza en
  «prueba_ok», «publicada» o «error», ni escribir `contenedor_id`,
  `media_id`, `permalink` o `drive_id`, ni tocar una pieza publicada. Solo
  lo que hace el render: crear o regenerar en «generada». Lo demás lo
  escriben `instagram-publicar` (con `service_role` **después** de
  autorizar al usuario con su JWT; la auditoría guarda la función y el
  usuario) y `instagram-programador`.
- **Cerrojo**: antes de llamar a Meta, `instagram-publicar` reserva la pieza
  (RPC `instagram_pieza_reservar_publicacion`, solo `service_role`, caduca
  a los 3 min). Una segunda prueba o publicación a la vez → 409
  «publicacion_en_curso».
- **Publicar a mano una pieza programada → 409 «programada»**: hay que
  cancelar la programación en el calendario antes. El programador no pasa
  por esa comprobación (la programación es suya) y, si alguien la tiene
  reservada, la aplaza a la siguiente pasada.
- **Texto alternativo** (`instagram_piezas.alt_text`, ≤ 1000): campo
  opcional bajo el texto de la publicación. Va a Meta (`alt_text`) en los
  posts (las stories no lo admiten) y se guarda al probar, así que el
  programador lo reutiliza.

## Limpieza del bucket (JPEG que no se publican)

Migración `20261107010000_instagram_limpieza_bucket`. Cada día a las 03:30
UTC el cron `instagram-limpieza-bucket` llama a `instagram-programador` con
`{ "accion": "limpiar" }` (mismo secreto que el programador):

- borra por la API de Storage los JPEG de `piezas/` que llevan **7 días** sin
  cambios y sin publicar, y les pone `imagen_borrada_at`;
- **nunca** los de una pieza con una programación activa (programada o
  publicándose; se puede programar a 75 días), ni los publicados, ni los que
  se están publicando;
- borra también las copias `tmp/` de más de 24 h (ninguna programación las
  necesita: el JPEG ya lleva la foto dentro).

Una pieza con la imagen borrada sale en el historial con el aviso «vuelve a
generarla»; no se puede programar ni publicar hasta regenerarla (al
regenerar, `imagen_borrada_at` vuelve a null).

## Errores frecuentes

| Qué dice | Por qué | Qué hacer |
|---|---|---|
| «El token de acceso no es válido» (190) | Token caducado, revocado o la app/cuenta se desasignó | Regenerar el token del usuario del sistema y cambiar el secreto `IG_ACCESS_TOKEN` en Supabase |
| «Al token le faltan permisos» (10, 200-299) | Falta `instagram_content_publish` o la cuenta no está asignada | Regenerar el token con los dos permisos; asignar la cuenta con control total |
| «Se ha alcanzado el límite de publicaciones» (2207042) | Cuota de 24 h agotada | Esperar; «Comprobar conexión» muestra el uso |
| «Meta no ha podido descargar la imagen» (9004 / 2207052) | La URL pública no responde o no es JPEG | Comprobar que el bucket «instagram» es público y regenerar la pieza |
| «Instagram no ha podido procesar la imagen (ERROR)» | Formato/medidas no admitidos | Regenerar; revisar que es JPEG 1080×1350 o 1080×1920 |
| «Falta configurar Instagram en los secretos de Supabase: …» (503) | Faltan secretos | Crearlos (tabla de arriba) con `npx supabase secrets set …` o en el Dashboard |
| «La función de Instagram no está desplegada en este Supabase» (404) | No se han desplegado las Edge Functions | `npx supabase functions deploy instagram-drive instagram-publicar instagram-estado --project-ref …` |
| 422 «Hay recursos de la pieza que no cargan» | La copia `tmp/` de la foto ya se borró (más de 24 h) o falta algo en `public/instagram/` | Volver a elegir la foto (se prepara otra copia) y regenerar; la lista dice qué URL falla |
| «No se pueden cargar las fotos de Drive» / «Google Drive: …» | Faltan secretos de Google, el token no ve la carpeta (`drive.file`) o no puede escribir | Pestaña Conexión → Comprobar: el bloque «Google Drive» dice qué falla y cómo arreglarlo |
| «Publicada, pero no se pudo guardar en Google Drive…» | Drive falló al publicar | La publicación está hecha; el JPEG sigue en el bucket. Arreglar Drive (Comprobar) |

Los mensajes de Meta se guardan, saneados, en `instagram_piezas.error` y la
pieza pasa a «error»; se puede regenerar y volver a intentar.

## Probar en local

Publicar y «Comprobar conexión» funcionan con `npm run dev` tal cual (van a
las Edge Functions del Supabase de `VITE_SUPABASE_URL`). El render no: con
`vite` no existe `/api/instagram-render`.

`@sparticuz/chromium` solo funciona en Linux (Vercel). Fuera de Vercel
(Windows/macOS, o Linux sin `VERCEL`) la función de render usa el Chromium que
instala Playwright (`npx playwright install chromium`; versión emparejada con
`playwright-core` 1.63). `INSTAGRAM_CHROMIUM_PATH` permite usar otro
ejecutable. Las versiones van juntas: `playwright-core` 1.63 ↔ Chromium 153 ↔
`@sparticuz/chromium` 153.0.0; si se actualiza uno, actualizar los otros.
