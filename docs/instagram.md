# Instagram en el panel: generar y publicar piezas

Sección **Marketing → Instagram**. El panel monta la pieza (plantilla + textos
+ foto), el servidor la convierte en un JPEG exacto y la publica en Instagram
con la API oficial de Meta. Cuenta de pruebas: **@oficiososia**.

## Arquitectura

```
 Panel (navegador)                     Vercel (funciones Node)                 Supabase                     Meta
 ───────────────────                   ─────────────────────────               ─────────────                ─────────────────────
 editor + vista previa  ── JWT ──►  POST /api/instagram-render
 (mismo HTML que el                    validarPieza + construirDocumento
  servidor: src/lib/instagram)         Chromium (playwright-core +
                                       @sparticuz/chromium) → captura
                                       sharp → JPEG 92, 4:4:4, ≤ 8 MB  ──►  bucket público «instagram»
                                                                           piezas/AAAA-MM/<id>.jpg
                                                                       ──►  instagram_piezas (estado
                                                                            «generada», RLS Marketing)
                       ── JWT ──►  POST /api/instagram-publicar
                                       caption · HEAD de la URL pública · cuota
                                       contenedor ─────────────────────────────────────────────────►  POST /{ig}/media
                                       sondeo hasta FINISHED ──────────────────────────────────────►  GET /{contenedor}
                                       (solo si no es prueba) media_publish + permalink ───────────►  POST /{ig}/media_publish
                                                                       ──►  instagram_piezas («prueba_ok»
                                                                            o «publicada» + permalink)
                       ── JWT ──►  GET /api/instagram-estado  (comprobar conexión) ────────────────►  identidad, token, cuota
```

- **Un solo núcleo** (`src/lib/instagram/`): las plantillas, la validación, el
  HTML y las comprobaciones de maquetación son el mismo código en la vista
  previa del panel y en el servidor. Lo que se ve es lo que se publica.
- **El bucket es solo una escala** (decisión del dueño, 04/11/2026): el
  archivo definitivo de las piezas vive en Drive. Tras una publicación REAL,
  `instagram-publicar` borra el JPEG del bucket (con el JWT del usuario; la
  RLS `instagram_objetos_delete_seccion` lo permite a quien tiene Marketing).
  `imagen_ruta` se conserva en la fila: una pieza «publicada» ya no tiene el
  fichero en el bucket, salvo que su `error` empiece por «Publicada, pero el
  JPEG no se pudo borrar…». La respuesta lo dice en `imagenEnBucket`. En una
  **prueba** (dryRun) **no** se borra: el contenedor necesita la URL hasta
  que se publique.
- **Recursos**: las **fuentes y logos** van en el propio panel
  (`public/instagram/`, ~1 MB). La función de render los lleva dentro de su
  bundle (`vercel.json` → `includeFiles`) y se los sirve a Chromium desde
  disco, sin salir a la red: el documento se carga como
  `<origen del panel>/__pieza-instagram.html` y las peticiones a
  `<origen>/instagram/…` se contestan con esos ficheros (mismo origen, así
  las @font-face no necesitan CORS). Las **fotos** de la biblioteca están en
  el bucket público «instagram» (`fotos/<marca>/…`, migración
  `20261105090000_instagram.sql`; las sube `scripts/instagram/subir-recursos.mjs`)
  y Chromium las descarga por su URL pública.
- **Siempre como el usuario**: las funciones usan la clave pública de Supabase
  y el JWT de quien pulsa el botón, así que la RLS de `instagram_piezas` y del
  bucket decide (escritura solo con permiso de **Marketing**,
  `can_write_section('marketing')`). Nunca `service_role`.
- **Secretos solo en el servidor**: el token de Meta vive en variables de
  Vercel sin prefijo `VITE_` y nunca sale en respuestas, errores ni registros
  (todo pasa por `api/_lib/instagram/secretos.ts`; hay tests que capturan la
  consola y lo comprueban).

Código: `api/instagram-render.ts`, `api/instagram-publicar.ts`,
`api/instagram-estado.ts` y `api/_lib/instagram/` (cliente de la Graph API,
errores en castellano, saneado, arranque de Chromium, render). Tests:
`api/_lib/__tests__/instagram.test.ts` (sin red ni Chromium).

## Variables de Vercel

Proyecto **admin-casatomas → Settings → Environment Variables**. Todas en
**Production** y **Preview** (la demo es Preview). Después de crearlas o
cambiarlas hay que **volver a desplegar** (Deployments → ⋯ → Redeploy) para que
las funciones las lean.

| Variable | Obligatoria | Sensitive | Qué es |
|---|---|---|---|
| `IG_ACCESS_TOKEN` | sí | **sí** | Token del **usuario del sistema** de Meta (no caduca). Permisos `instagram_basic` + `instagram_content_publish`. |
| `IG_USER_ID` | sí | no | ID **numérico** de la cuenta profesional de Instagram (no el @usuario). «Comprobar conexión» lista los que ve el token. |
| `META_APP_ID` | sí | no | developers.facebook.com → Mis apps → (app) → Configuración → Básica. |
| `META_API_VERSION` | no | no | `vNN.N`; por defecto `v26.0`. |
| `META_APP_SECRET` | no | **sí** | Opcional. Con ella la comprobación del token usa `debug_token` con token de app (método documentado: caducidad, app y permisos). |

Las funciones usan además las de Supabase que ya tiene el panel
(`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, o `SUPABASE_URL` /
`SUPABASE_ANON_KEY`): en Preview apuntan a la demo y en Production a
producción, y de ahí sale también la URL pública de los recursos.

**Nunca** pongas el token con prefijo `VITE_` (acabaría dentro del JavaScript
del navegador) ni lo pegues en chats, capturas o el repositorio.

Cómo conseguir el token, el usuario del sistema y el ID de la cuenta: igual
que en el prototipo (`instagram-studio/docs/meta-setup.md`, pasos 1-5),
cambiando «.env» por las variables de Vercel. Resumen: Meta Business Suite →
Configuración del negocio → Usuarios del sistema → (usuario) → Asignar activos
(cuenta de Instagram con control total + la app) → Generar token (la app,
caducidad «Nunca», `instagram_basic` e `instagram_content_publish`).

## Probar la conexión desde el panel

1. Entra en la demo con un usuario que tenga **Marketing**.
2. **Marketing → Instagram → Comprobar conexión** (llama a
   `GET /api/instagram-estado`). Muestra:
   - las variables (presentes o no; del token, como mucho `…abcd`);
   - la cuenta (`@usuario` e id) y si coincide con `IG_USER_ID`;
   - la cuota de publicación (usadas / total en 24 h);
   - con qué método se ha verificado el token y qué no se ha podido verificar;
   - para cada fallo, **cómo arreglarlo**.
3. Genera una pieza y pulsa **Probar publicación** (`dryRun: true`): crea el
   contenedor en Meta y espera a FINISHED **sin publicar**. Si sale bien, la
   pieza queda en «prueba_ok».
4. Solo entonces **Publicar** (`dryRun: false`).

Diagnóstico del render: `GET /api/instagram-render` con sesión de Marketing
arranca Chromium y captura un lienzo de prueba (sin guardar nada); devuelve la
plataforma y los tiempos.

## Contratos de las funciones

Todas: `Authorization: Bearer <JWT de Supabase>`. 401 sin sesión, 403 sin
Marketing. Respuestas JSON con `ok`; los errores llevan `error` y, cuando
aplica, `problemas: string[]` y `comoArreglarlo`.

**POST /api/instagram-render** — cuerpo `{ "pieza": {…}, "id"?: "<uuid>", "caption"?: "…" }`
→ 200 `{ ok, id, estado: "generada", urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos }`.
422 si la pieza no es válida, si no carga un recurso (fuente, logo, foto) o si
no pasa la maquetación (desbordes, márgenes, zona segura del story, campos
vacíos). 404 si el `id` no existe; 409 si esa pieza ya está publicada.

**POST /api/instagram-publicar** — cuerpo `{ "id": "<uuid>", "caption"?: "…", "dryRun": true|false, "contenedorId"?: "…" }`
→ 200 `{ ok, id, dryRun, publicado, estado: "prueba_ok"|"publicada", contenedor: { id, estado }, urlJpeg, mediaId, permalink, cuota: { usadas, total, restantes, ventanaHoras }, caption: { caracteres, hashtags, menciones }, avisos }`.
Al publicar de verdad la respuesta añade `imagenEnBucket` (`false` = el JPEG
ya se borró del bucket).
→ 202 `{ ok, estado: "en_proceso", contenedor, reintentar: { id, contenedorId, dryRun } }`
si Meta no ha terminado de procesar la imagen dentro del tiempo de la función:
repetir la misma petición con ese `contenedorId` (no crea otro contenedor).

**GET /api/instagram-estado** → 200 `{ ok, variables, faltan, identidad, cuota, metodoVerificacion, versionApi, tokenEnmascarado, comprobaciones, noVerificado, entornoSupabase }`.

## Límites

- **Imagen**: solo JPEG (sRGB), ≤ 8 MB; feed entre 4:5 y 1,91:1 y de 320 a
  1440 px de ancho (las piezas son 1080×1350); story 9:16 (1080×1920).
- **Texto**: ≤ 2200 caracteres, ≤ 30 hashtags, ≤ 20 menciones. Las stories no
  admiten texto por la API (se ignora).
- **Cuota**: Meta limita las publicaciones por cuenta en 24 h; el total lo da
  Meta (`config.quota_total`) y la función **no publica si está agotada**.
- **Contenedores**: caducan a las 24 h. Una prueba no gasta cuota.
- **Tiempo**: render ≤ 60 s y publicación ≤ 90 s (`vercel.json`). El primer
  render de cada instancia descomprime Chromium en `/tmp` (1-3 s más).
- **Memoria**: Chromium necesita ~1,5 GB. Con Fluid Compute la memoria se
  configura en el panel de Vercel (Settings → Functions), no en
  `vercel.json`; el plan Hobby da 2 GB, suficiente.

## Propuesta (sin hacer): limpiar los JPEG que no se publican

Las piezas generadas o probadas que nunca se publican dejan su JPEG en el
bucket. Propuesta para más adelante (**no implementada**): una tarea de
`pg_cron` diaria que borre los JPEG de `piezas/` cuya fila lleve más de 24 h
sin publicar (estado «generada», «prueba_ok» o «error»; a las 24 h el
contenedor de Meta ya ha caducado y la URL no hace falta) y deje la fila con
una marca de «imagen borrada» para que el panel ofrezca «Volver a generar».
Habría que hacerlo con una función `security definer` que borre por la API de
Storage (no con `delete from storage.objects`, que deja el fichero huérfano en
el almacenamiento) o con una Edge Function llamada desde `pg_cron` con
`pg_net`, y conviene antes una columna propia en `instagram_piezas` (por
ejemplo `imagen_borrada_at timestamptz`) en lugar de deducirlo del estado.

## Errores frecuentes

| Qué dice | Por qué | Qué hacer |
|---|---|---|
| «El token de acceso no es válido» (190) | Token caducado, revocado o la app/cuenta se desasignó | Regenerar el token del usuario del sistema y cambiar `IG_ACCESS_TOKEN` en Vercel; redesplegar |
| «Al token le faltan permisos» (10, 200-299) | Falta `instagram_content_publish` o la cuenta no está asignada | Regenerar el token con los dos permisos; asignar la cuenta con control total |
| «Se ha alcanzado el límite de publicaciones» (2207042) | Cuota de 24 h agotada | Esperar; «Comprobar conexión» muestra el uso |
| «Meta no ha podido descargar la imagen» (9004 / 2207052) | La URL pública no responde o no es JPEG | Comprobar que el bucket «instagram» es público y regenerar la pieza |
| «Instagram no ha podido procesar la imagen (ERROR)» | Formato/medidas no admitidos | Regenerar; revisar que es JPEG 1080×1350 o 1080×1920 |
| «Falta configurar Instagram en Vercel: …» (503) | Faltan variables | Crearlas (tabla de arriba) y redesplegar |
| 422 «Hay recursos de la pieza que no cargan» | Fotos no subidas al bucket de ese entorno (o falta algo en `public/instagram/`) | Ejecutar `scripts/instagram/subir-recursos.mjs` contra ese Supabase; la lista dice qué URL falla |

Los mensajes de Meta se guardan, saneados, en `instagram_piezas.error` y la
pieza pasa a «error»; se puede regenerar y volver a intentar.

## Probar en local

`@sparticuz/chromium` solo funciona en Linux (Vercel). Fuera de Vercel
(Windows/macOS, o Linux sin `VERCEL`) las funciones usan el Chromium que
instala Playwright (`npx playwright install chromium`; versión emparejada con
`playwright-core` 1.63). `INSTAGRAM_CHROMIUM_PATH` permite usar otro
ejecutable. Las versiones van juntas: `playwright-core` 1.63 ↔ Chromium 153 ↔
`@sparticuz/chromium` 153.0.0; si se actualiza uno, actualizar los otros.
