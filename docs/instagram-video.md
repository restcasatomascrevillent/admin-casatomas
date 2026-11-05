# Reels en MP4: generar, probar, publicar y programar (fase 6)

Desde la pestaña **Reels** de `/instagram` se monta el reel (fase 5,
[instagram-reels.md](instagram-reels.md)), se pulsa **«Generar vídeo»** y un
**trabajador** que corre en un ordenador de Oficiosos lo convierte en MP4.
Después, los mismos pasos que una imagen: **probar**, **publicar** o
**programar**. Diseño: `instagram-studio/propuesta/PROPUESTA.md` §5.3-5.7 y la
fila 6 de §7.

```
 Panel (pestaña Reels)                    Supabase                                  Ordenador de Oficiosos (o servidor)
 ─────────────────────                    ────────                                  ───────────────────────────────────
 EstudioReel + PanelVideoReel
 «Generar vídeo»
   prepara fotos (instagram-drive → tmp/)
   RPC instagram_render_encolar  ───────► instagram_piezas (tipo_medio = reel)
                                          instagram_trabajos_render «pendiente» ◄── RPC instagram_render_reclamar (SKIP LOCKED)
                                                                                     Chromium abre __reel-instagram.html
                                                                                     t = n/30 → captura JPEG → ffmpeg (H.264 + AAC)
                                                                                     ffprobe + cajas del MP4
                                          cubo «instagram-video» ◄────────────────── sube reels/AAAA-MM/<pieza>-<trabajo>.mp4 / .jpg
                                          pieza «generada» ◄──────────────────────── RPC instagram_render_terminar
 aviso push «Reel listo» ◄──────────────  notificar-video (tipo «reel») ◄─────────── el trabajador avisa
 «Prueba sin publicar» / «Publicar» ────► instagram-publicar: media_type=REELS
                                            si Meta tarda: pieza «procesando» + 202
                                          pg_cron (5 min) → instagram-programador: cierra los «procesando»
 «Programar…» ──────────────────────────► instagram_programar (igual que las imágenes)
```

## Dónde está

| Qué | Fichero |
|---|---|
| Migración (columnas, cola, RPC, cubo, cron) | `supabase/migrations/20261109100000_instagram_video.sql` (rollback en `supabase/rollbacks/`) |
| Prueba SQL (PGlite) | `scripts/test-instagram-video.mjs` (`npm run test:instagram-video:db`, en el CI) |
| Página de captura | `__reel-instagram.html` (segunda entrada de Vite) + `src/instagram-captura/reel.tsx` |
| Lógica de la captura (instantes de medida, portada, textos) | `src/lib/instagram/reels/captura.ts` |
| Trabajador | `scripts/instagram/render-reels.mjs` (cola) y `scripts/instagram/render-reels-lib.mjs` (Chromium, ffmpeg, comprobaciones) |
| Pruebas del trabajador (MP4 real de 2 s) | `scripts/instagram/__tests__/render-reels.test.ts` |
| Publicar reels | `supabase/functions/instagram-publicar/reel.ts` (enganchado en `publicar.ts`), `_shared/instagram/cliente.ts` |
| Cerrar los «procesando» | `supabase/functions/instagram-programador/procesando.ts` (y `clasificar` en `programador.ts`) |
| Aviso push | `supabase/functions/notificar-video` (tipo `reel`) |
| Panel | `src/components/instagram/video/` (`PestanaReels`, `PanelVideoReel`, `AccionesReel`, `DialogoFotoReel`, `useVideoReel`, `logica`) |

## Requisitos de Meta para reels

Fuente: referencia oficial `POST /{ig-user-id}/media`
(https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media,
«Reel Specifications» y «Reels Cover Photo Specifications») y la guía
https://developers.facebook.com/docs/instagram-platform/content-publishing/,
consultadas el 05/11/2026.

| Requisito de Meta | Lo que hace el trabajador |
|---|---|
| MOV o MP4, **moov delante**, **sin listas de edición** | MP4 con `-movflags +faststart -use_editlist 0`; se comprueba leyendo las cajas del fichero |
| H.264 o HEVC progresivo, **GOP cerrado**, **4:2:0** | `libx264` high, `-flags +cgop`, `yuv420p`, BT.709 rango limitado |
| 23-60 fps | 30 fps (t = n/30) |
| Como mucho 1920 px de ancho; 9:16 recomendado | 1080×1920 |
| Vídeo ≤ 25 Mbps (VBR) | `-maxrate` calculado para el peso objetivo (≤ 8 Mbps) |
| Audio AAC, ≤ 48 kHz, 1-2 canales, 128 kbps | AAC 48 kHz estéreo 128 kbps |
| De 3 s a 15 min | Los reels del panel duran de 5 a 90 s (`validarReel`) |
| ≤ 300 MB | Objetivo < 25 MB (`RENDER_OBJETIVO_MB`); el cubo admite 50 MB |
| Portada: JPEG, ≤ 8 MB, sRGB, 9:16 | Captura JPEG del mismo lienzo en el instante elegido |
| `cover_url` manda sobre `thumb_offset` | Se manda `cover_url`; sin portada válida, `thumb_offset = 0` |
| `alt_text`: «Images only. Reels and stories are not supported» | Los reels no llevan texto alternativo (si llega, se ignora con aviso) |
| `share_to_feed` (solo reels) | Siempre `true` (el reel sale también en el feed) |
| `status_code`: consultar una vez por minuto, como mucho 5 min | La función espera 20 s; si no, «procesando» y lo cierra el cron cada 5 min |
| Límite de publicaciones por API en 24 h | El mismo control de cuota que las imágenes (`content_publishing_limit`) |

**Audio**: la documentación oficial **no** dice que un reel tenga que llevar
audio (solo cómo tiene que ser si lo lleva). Aun así, por prudencia, el vídeo
**siempre** lleva una pista AAC: de silencio por defecto. **Sin verificar** en
la práctica qué hace Instagram con un MP4 sin pista de audio.

## Música

- **Por defecto, sin música**: pista de silencio AAC estéreo a 48 kHz
  (`anullsrc` de ffmpeg). No hay ninguna biblioteca de pago.
- **Pista propia** (opcional, en «Música y portada» del panel): un fichero
  M4A, MP3, AAC o WAV de hasta 50 MB **con licencia del restaurante**. Se sube
  al cubo (`audio/<uuid>.<ext>`), el trabajador la recorta a la duración del
  reel, la rellena con silencio si es más corta y le pone un fundido de salida
  de 1,5 s.
- La música de Instagram no se puede usar al publicar por la API (`audio_name`
  solo renombra el audio original del vídeo).

## Arrancar el trabajador en el ordenador de Oficiosos (Windows)

Una vez:

1. **Usuario del trabajador**: en el panel (Super Admin → Usuarios), crear un
   usuario `render@…` con **solo la sección Marketing** (ver y editar). El
   trabajador entra con él: **nunca** con la clave `service_role`.
2. **Programas**: Node 22, Git y ffmpeg (incluye ffprobe):
   ```powershell
   winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg
   ```
3. **Código** (una carpeta solo para esto):
   ```powershell
   git clone https://github.com/restcasatomascrevillent/admin-casatomas.git render-reels
   cd render-reels
   git checkout staging        # demo; para producción, main
   npm ci
   npx playwright install chromium
   npm run build               # la página de captura sale en dist/
   ```
4. **Variables**: crear `render-reels.cmd` FUERA del repositorio (no se
   sube), con los valores de la demo:
   ```bat
   @echo off
   set RENDER_SUPABASE_URL=https://sfonaclosuafvlhutkon.supabase.co
   set RENDER_SUPABASE_ANON_KEY=<clave pública (la del panel)>
   set RENDER_EMAIL=render@...
   set RENDER_PASSWORD=<contraseña del usuario render>
   set RENDER_DISPOSITIVO=PC Oficiosos
   cd /d C:\ruta\a\render-reels
   npm run instagram:render-reels
   ```
5. **Que arranque solo**: Programador de tareas de Windows → Crear tarea →
   «Al iniciar sesión» → Acción: ese `render-reels.cmd`. Mientras el ordenador
   esté encendido y con sesión, mira la cola cada 30 s.

Comprobación rápida (sesión, permiso, ffmpeg, página y cola, sin renderizar):

```powershell
node scripts/instagram/render-reels.mjs --comprobar
```

Otras órdenes: `--una-vez` (hace lo que haya y sale) y `--trabajo <id>` (solo
ese). Con Ctrl+C devuelve a la cola el trabajo que tuviera a medias.

**Actualizar**: `git pull && npm ci && npm run build` (la página de captura y
el motor de reels van con el código: tras cambios en los reels hay que volver a
compilar, o usar `RENDER_PAGINA` con la URL del panel publicado).

### Variables

| Variable | Obligatoria | Qué es |
|---|---|---|
| `RENDER_SUPABASE_URL` | sí (o `VITE_SUPABASE_URL`) | `https://<ref>.supabase.co` del entorno (demo o producción) |
| `RENDER_SUPABASE_ANON_KEY` | sí (o `VITE_SUPABASE_PUBLISHABLE_KEY`) | Clave **pública** del proyecto |
| `RENDER_EMAIL`, `RENDER_PASSWORD` | sí | Usuario del panel con Marketing |
| `RENDER_PAGINA` | no | `dist` (por defecto si existe `dist/`), `vite` (sin compilar; usa las devDependencies) o la URL del panel publicado |
| `RENDER_DISPOSITIVO` | no | Nombre que se ve en el panel («Renderizando en …»); por defecto el nombre del equipo |
| `RENDER_INTERVALO_S` | no | Cada cuánto mira la cola (30) |
| `RENDER_OBJETIVO_MB` | no | Peso objetivo del MP4 (25; entre 5 y 45) |
| `RENDER_CRF` | no | Calidad de x264 (20; menos = más calidad y más peso) |
| `RENDER_FFMPEG`, `RENDER_FFPROBE` | no | Rutas si no están en el PATH. Sin ffmpeg en el sistema usa `ffmpeg-static` (ya en las devDependencies; no trae ffprobe: entonces solo se comprueba la estructura del MP4, con un aviso) |
| `RENDER_CHROMIUM` | no | Otro Chromium (por defecto, el de Playwright) |
| `RENDER_TMP` | no | Carpeta de trabajo (por defecto, la temporal del sistema; se borra al terminar cada vídeo) |

### En un servidor pequeño (más adelante)

El mismo código y las mismas variables, sin cambios. En Debian/Ubuntu:

```bash
sudo apt-get install -y ffmpeg git
git clone … render-reels && cd render-reels && npm ci && npx playwright install --with-deps chromium && npm run build
```

y un servicio de systemd (`Restart=always`) que ejecute
`node scripts/instagram/render-reels.mjs` con las variables en
`EnvironmentFile=` (fichero con permisos 600, fuera del repositorio).

## Seguridad del trabajador (por qué así)

- **Sin `service_role`** en el ordenador: si alguien se lo lleva, solo tiene
  un usuario del panel con Marketing, que se puede bloquear o cambiar de
  contraseña desde el panel (la sesión deja de valer:
  `private.sesion_panel_permitida`).
- La base de datos solo le deja **reclamar** trabajos, marcar su **progreso**
  y **cerrar los suyos** (`procesado_por = auth.uid()`), y escribir en el cubo
  `instagram-video` (RLS de Marketing). Para cerrar uno como listo, el MP4 y
  la portada tienen que estar ya en el cubo con la ruta de **esa** pieza.
- Se eligió esto frente a un «secreto de trabajador» porque reutiliza la
  autenticación, el bloqueo y la auditoría del panel (como `trabajos_video`) y
  no añade otro secreto que rotar.
- **Chromium solo puede pedir** su propio origen (código, fuentes, logos y
  muestras), las fotos del trabajo y las copias `tmp/` del cubo «instagram» de
  ese Supabase; lo demás se bloquea. El trabajador rechaza fotos que no son
  copias `tmp/` (`fotosPermitidas`).
- No imprime secretos ni contraseñas.

## Estados

```
Trabajo:  pendiente ──(reclamar)──► renderizando ──► listo
             │                           │  └──► error (y avisos)
             └──(Cancelar)──► cancelado  └── sin latido 10 min → otro equipo lo retoma (al 3.er abandono: error)

Pieza (reel): borrador ──(trabajo listo)──► generada ──(prueba)──► prueba_ok ──(publicar)──► publicada
                                               │  └──► procesando ──(cron / Comprobar ahora)──┘
                                               └──── cambiar el reel ⇒ el vídeo se quita y vuelve a «borrador»
```

- Un solo trabajo vivo por pieza. Volver a pulsar «Generar vídeo» sustituye al
  pendiente; si se está renderizando, hay que esperar (o cancelarlo si lleva
  10 min sin latido). Como mucho 20 pendientes en total.
- Si el reel cambia mientras se renderiza, el trabajo queda «listo» pero la
  pieza **no** se toca (el vídeo ya no corresponde).
- **«procesando»** (Meta aún procesa el vídeo): la función espera 20 s y, si
  no ha terminado, deja la pieza así con `procesando_accion` (prueba o
  publicar) y responde 202. El cron del programador (cada 5 min; la migración
  hace que también llame cuando hay reels «procesando») la cierra con el
  mismo contenedor; a las 24 h, error (el contenedor caduca). El panel tiene
  «Comprobar ahora».
- **Programar**: igual que una imagen (necesita el MP4 y no estar
  «procesando»). Si Meta aún procesa a la hora de publicar, la programación se
  aplaza sin contar intento durante la primera hora (sale unos minutos tarde).
- **Publicar tras una prueba correcta** reutiliza su contenedor (ya está
  FINISHED) si el texto no ha cambiado y no han pasado 23 h.

## Límites

- 1080×1920, 30 fps, de 5 a 90 s (las bases duran 20-32 s: 600-960 fotogramas).
- Objetivo < 25 MB; más de 50 MB no cabe en el cubo y el trabajo falla.
- Textos: antes de capturar, la página **mide en el DOM** cada rótulo ya
  entero (`data-campo`). Un texto que se sale del vídeo **bloquea** el trabajo
  (error con el texto y el segundo); uno fuera de la zona segura (220 arriba,
  320 abajo, 64 a los lados) es un **aviso** que se ve en el panel.
- Fotos: las de muestra se pueden renderizar (baja resolución, con aviso). Las
  copias `tmp/` caducan a las 24 h: si el equipo de render estuvo apagado más
  tiempo, el trabajo falla y basta con volver a pulsar «Generar vídeo» (el
  panel las vuelve a preparar).
- Tiempo: en el portátil de desarrollo, 60 fotogramas (2 s) tardan unos 14 s
  con arranque incluido; un reel de 20 s, del orden de 1-2 min (sin medir en
  el PC de Oficiosos: es la «prueba de un día» de la propuesta).

## Desplegar (demo primero)

1. Migración (después de `20261107010000_instagram_limpieza_bucket`):
   ```
   npx supabase db query --linked -f supabase/migrations/20261109100000_instagram_video.sql
   ```
   Termina en «instagram_video: aplicada».
2. Funciones que cambian:
   ```
   npx supabase functions deploy instagram-publicar instagram-programador notificar-video --project-ref sfonaclosuafvlhutkon
   ```
   (sin secretos nuevos; `notificar-video` usa los VAPID que ya tiene).
3. El panel (Vercel) publica solo la página de captura con el resto.
4. Arrancar el trabajador (arriba) apuntando a la demo.

Producción (`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el
«sí» del dueño; el trabajador de producción, con su propio usuario `render@…`.

## Qué probar en la demo

1. Reels → base «Del mar» → cambiar 2-3 fotos por fotos de la biblioteca
   (botón de la foto de cada escena: abre la biblioteca de Drive / carta).
2. «Generar vídeo» → sale «En cola»; con el trabajador encendido, «Renderizando»
   con progreso y, al terminar, «Listo» con el MP4 y el aviso push.
3. «Prueba sin publicar» → «Prueba correcta» (o «Instagram está procesando…»
   que se cierra solo en ≤ 5 min).
4. «Publicar» → sale en @oficiososia; o «Programar…» a +11 min y comprobar
   en el calendario que pasa a «Publicada».

## Pendiente y riesgos

- **Archivo en Drive de los MP4**: no se hace todavía (la subida simple de
  Drive es para ficheros pequeños; hace falta la reanudable, «por trozos»).
  Los MP4 y portadas **se quedan en el cubo** `instagram-video` tras
  publicar; tampoco hay limpieza automática del cubo. Con ~20 MB por reel,
  vigilar el espacio de Storage.
- La programación crea el contenedor a la hora: un reel puede salir unos
  minutos tarde (la propuesta sugería crearlo 30 min antes).
- Stories de vídeo y carruseles: no (fase 7).
- Los tipos de `src/integrations/supabase/types.ts` no incluyen la cola ni las
  columnas nuevas (se consultan sin tipos).
- **Sin verificar**: comportamiento real de Meta con estos MP4 (se probará
  con la prueba sin publicar en @oficiososia) y tiempos de procesado.
