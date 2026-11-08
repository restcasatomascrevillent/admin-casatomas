# Instagram · Biblioteca de fotos en Google Drive

Complemento de [instagram.md](instagram.md). Desde el 05/11/2026 (decisión del dueño) el archivo de
verdad de las fotos vive en **Google Drive**, dentro de la carpeta «marketing» cuyo id está en el
secreto de Supabase `GOOGLE_DRIVE_MARKETING_FOLDER_ID` (carpeta creada a mano por el dueño). El
bucket público «instagram» de Supabase queda solo como **escala temporal**: Meta y el render
necesitan una URL JPEG pública directa, y Drive no la da.

## Estructura en Drive

La app crea lo que falte (con el alcance `drive.file`, ver más abajo, solo si ve la carpeta raíz):

```
marketing/                         ← GOOGLE_DRIVE_MARKETING_FOLDER_ID (a mano)
└── instagram/
    ├── fotos/
    │   ├── casa-tomas/            ← biblioteca de Casa Tomás
    │   └── touza/                 ← biblioteca de Touza
    └── publicadas/
        └── AAAA-MM/               ← JPEG de cada pieza publicada (lo guarda instagram-publicar)
```

Nombres: las fotos subidas desde el panel, `AAAA-MM-DD-<descripción>-<8 del uuid>.jpg` (la
descripción también va en la descripción del fichero de Drive); las publicadas,
`AAAA-MM-DD_<marca>_<formato>_<8 del id de la pieza>.jpg` (el pie de foto va en la descripción).

## Flujo

1. **Biblioteca**: el panel (sección **Instagram** del menú → selector de foto) llama a
   `instagram-drive` con `listar` y la marca. Salen las imágenes de `fotos/<marca>`; su tipo y
   descripción salen de `instagram_fotos` (por `drive_id`). Una foto **sin fila** (por ejemplo,
   arrastrada a mano a Drive con el alcance completo) sale como **«Sin clasificar»** (`tipo` null):
   vale para cualquier plantilla y su aptitud para post/story se deduce de sus medidas
   (`imageMediaMetadata` de Drive, ya girada según EXIF). Si Drive aún no sabe sus medidas, sale
   en gris con el motivo. HEIC u otros formatos, o más de 8 MB, salen en gris con «súbela desde el
   panel».
2. **Miniaturas**: cada una se pide a `instagram-drive` (`miniatura`) con la sesión y se enseña
   como blob URL. La función usa la `thumbnailLink` de Drive (solo `*.googleusercontent.com`) a 400 px.
3. **Subir foto**: el navegador la prepara (abajo) y la manda en un `FormData` a
   `instagram-drive?accion=subir`. La función solo acepta JPEG, lee las medidas del propio fichero
   (no se fía de las del cliente), la sube a `fotos/<marca>` y guarda la fila (`drive_id`, tipo,
   descripción). Si la fila falla (por ejemplo, falta la migración), la foto se queda en Drive y
   sale «Sin clasificar», con un aviso.
4. **Elegir una foto → preparar**: el panel llama a `preparar`. La función comprueba que el fichero
   está **dentro** de `fotos/<marca>` (aunque el token vea más cosas, como las facturas), lo copia
   al bucket como `tmp/<uuid>.jpg` y devuelve su URL pública. Esa URL es la que usan la vista previa
   y el render. De paso borra las copias `tmp/` de más de 24 h (limpieza oportunista). El panel
   reutiliza la copia 12 h.
5. **Generar imagen**: el panel manda al render `fotoPreparada` (`{ id: "drive:<id>", url, ancho,
   alto, tipo, marca }`). El render **solo** acepta una URL `tmp/<uuid>.(jpg|png|webp)` del bucket
   «instagram» de **su** Supabase (`rutaTmpDeUrl` en `src/lib/instagram/fotos.ts`): mismo origen
   (esquema, host y puerto), sin credenciales, sin otra carpeta ni otro bucket. Si no, 400 y no
   renderiza. Además reconstruye la URL desde la ruta: nunca carga la URL que llega (sin SSRF).
6. **Publicar**: tras una publicación real, `instagram-publicar` guarda el JPEG en
   `publicadas/AAAA-MM`, anota su `drive_id` en `instagram_piezas` y **solo entonces** borra el
   JPEG del bucket y la copia `tmp/` de la foto usada (`fotoTmp`). Si Drive falla o no está
   configurado, **no borra nada** y lo avisa (la fila queda con `error` empezando por «Publicada,
   pero no se pudo guardar en Google Drive…»).

Para **quitar** una foto de la biblioteca se borra en Drive: el panel no borra nada de Drive.

En las piezas, el id de una foto de Drive es `drive:<id de Drive>` (lo que guarda `datos.foto`); el de
una foto de la carta, `carta:<id del plato>` (ver «Fotos de la carta»).

## Fotos de la carta

Desde el 05/11/2026 (petición del dueño) la biblioteca enseña también las **fotos de los platos de
la carta**, junto a las de Drive. Encima de las miniaturas hay un filtro **Todas · Drive · Carta**
(con cuántas hay de cada origen) y cada foto de la carta lleva la etiqueta **«Carta»**; todo dentro
del mismo selector, sin recargar y sin scroll de página.

- **De dónde salen**: tabla `"Platos"`, leída por el panel con su cliente de Supabase (la sesión
  del usuario; decide la RLS): `activado = true`, `imagen_url` no nula y de la marca elegida
  (`restaurante = true` para Casa Tomás, `touza = true` para Touza). Ids de plato válidos:
  `[A-Za-z0-9_-]{1,100}` (los demás no salen).
- **Cómo salen**: tipo **«plato»**, descripción `nombre · categoría`, miniatura directa desde la URL
  pública del bucket `platos`. El id en la pieza es **`carta:<id del plato>`** (`datos.foto`), que
  `validarPieza` acepta como cualquier foto del catálogo.
- **Aptitud post/story**: con las medidas reales de la imagen (`naturalWidth`/`naturalHeight` al
  cargar la miniatura, guardadas en la caché de React Query) y la misma regla que Drive
  (`esAptaPara`). Mientras no se saben, la foto **no se bloquea**: al elegirla, «preparar» devuelve
  las medidas del propio fichero y la validación de la pieza manda.
- **Preparar**: el panel llama a `instagram-drive` con
  `{ accion: "preparar", origen: "carta", marca, platoId }`. La función lee el plato con el **JWT
  del usuario**, exige que sea de la marca y esté activo (si no, 404) y que su `imagen_url` sea del
  bucket público **`platos` de su propio Supabase** (`SUPABASE_URL`: mismo origen, sin credenciales,
  sin `..` ni `%`-codificados); si no, **400**. Reconstruye la URL desde la ruta (no descarga la de
  la fila), no sigue redirecciones, solo acepta JPEG/PNG/WebP de ≤ 8 MB y la sube a
  `tmp/<uuid>.<jpg|png|webp>` con su content-type. Lee las medidas del fichero (también de WebP y
  PNG). La limpieza oportunista de `tmp/` de más de 24 h es la misma. **No necesita los secretos de
  Google**: funciona aunque Drive no esté configurado.
- **Render**: `fotoPreparada` acepta `id: "carta:<id>"` igual que `drive:<id>`, con la **misma**
  comprobación anti-SSRF de la URL (solo `tmp/` del bucket «instagram» de su Supabase). El tipo de
  una foto de la carta es siempre «plato» (no se fía del que llega).
- Para quitar una foto de la carta de la biblioteca, se quita la foto del plato (o se desactiva el
  plato) en la gestión de la carta.

Código: `fotosDesdePlatos`, `fotoDesdePlato`, `idFotoCarta`, `platoIdDeFoto`, `fotoPreparable` y
`rutaPlatoDeUrl` en `src/lib/instagram/fotos.ts`; `usePlatosConFoto` y `anotarMedidasCarta` en
`useFotosInstagram.ts`; `prepararFotoCarta` en `api.ts`; `prepararCarta`, `rutaPlatoDeUrl` y
`medidasImagen` en `supabase/functions/instagram-drive/drive.ts`. Pruebas:
`src/lib/instagram/__tests__/fotosCarta.test.ts`, el bloque «preparar una foto de la carta» de
`instagram-drive/__tests__/drive.test.ts`, el de «carta» de `api/_lib/__tests__/instagramFotos.test.ts`
y el recorrido de `EditorInstagram.test.tsx`. Sin migraciones. Hay que volver a desplegar
`instagram-drive` (Supabase) y el panel con `/api/instagram-render` (Vercel).

## Foto enmarcada: plantillas para las fotos de la carta (08/11/2026)

Las fotos de la carta (tabla «Platos», bucket `platos`) miden **1200×900**, apaisadas y comprimidas
para la web. Las plantillas a sangre (`ct-foto-titular`, `tz-foto-titular`) tendrían que ampliarlas
más del 50 % y se verían borrosas. Para ellas (y para cualquier foto apaisada o pequeña) están las
plantillas **«Foto enmarcada»**: `ct-marco` (Casa Tomás: papel, paspartú blanco y filete oro,
Libre Baskerville) y `tz-marco` (Touza: negro, filete oro al 40 %, wordmark TOUZA, Cormorant y
Montserrat). Post (que también es cada imagen del carrusel) y story.

- **La foto va entera**: sin recortar ni ampliar (`max-width`/`max-height` al 100 % de su hueco: una
  de 1200 px se reduce a unos 880 px de ancho; una pequeña se queda en su tamaño). En story, la
  foto cae en el tercio central y los textos van arriba (antetítulo y titular) y abajo (nombre del
  plato o cita, botón y pie), dentro de la zona segura del sistema de marca (220 / 320 / 64).
- **Campos**: antetítulo, titular (6 palabras), `cita` (nombre del plato o una frase corta), CTA y
  pie. Límites en `src/lib/instagram/plantillas/ct-marco|tz-marco/index.ts`, calibrados renderizando.
- **Aptitud según la plantilla** (`encaje` en `Plantilla`: `"sangre"` por defecto o `"marco"`):
  `esAptaPara(foto, formato, plantilla)` y `validarPieza` exigen a sangre cubrir ampliando ≤ 5 % y,
  enmarcada, solo **lado largo ≥ 800 px** (`LADO_MINIMO_MARCO`). `motivoNoApta` (SelectorFoto)
  hace lo mismo: con la enmarcada las fotos de la carta dejan de salir en gris; con una a sangre
  explican «Usa la plantilla Foto enmarcada». En «Crear» (BibliotecaFotos) la plantilla la elige
  después la IA, así que una foto vale si vale enmarcada.
- **IA**: si una foto no cubre, `montar_pieza` elige la enmarcada y, si el modelo devuelve una a
  sangre, el servidor la corrige y avisa; en campañas, una foto `carta:` con plantilla a sangre se
  corrige igual (ver [instagram-ia.md](instagram-ia.md)).
- Pruebas: `src/components/marketing/instagram/__tests__/aptitudMarco.test.ts` (aptitud),
  `src/lib/instagram/__tests__/marco.render.test.ts` (Chromium: foto entera y sin ampliar, tercio
  central, zona segura, textos largos) y `api/_lib/__tests__/instagram-marco.test.ts`
  (`/api/instagram-render`, pieza y carrusel con Chromium; con `INSTAGRAM_CAPTURAS_MARCO=<carpeta>`
  guarda 2 JPEG de muestra; las del 08/11/2026 están en
  `instagram-studio/propuesta/evaluacion/capturas-marco/`).

## Plantillas v2 por papel (08/11/2026)

El dueño pidió plantillas «que no parezcan de IA». Fuente: su sistema de marca
(`instagram-studio/propuesta/marca-base`: `templates/redes-posts.html`, `templates/video-9x16.html`
y los reels con `reel-kit.jsx`). Un juego por marca, cada plantilla con un **papel** (`papel` en
`Plantilla`) y en post y story:

| Papel | Casa Tomás | Touza | Qué lleva |
|---|---|---|---|
| portada | `ct-portada`, `ct-portada-marco` | `tz-portada`, `tz-portada-marco` | titular de la idea, frase, marca; botón solo en un post suelto |
| plato (interior) | `ct-plato`, `ct-plato-marco` | `tz-plato`, `tz-plato-marco` | foto limpia y el nombre pequeño (rótulo de los reels); sin logo ni botón |
| cierre | `ct-cierre`, `ct-cierre-marco`, `ct-cierre-marca` (sin foto) | `tz-cierre`, `tz-cierre-marco`, `tz-cierre-marca` (sin foto) | logo / TOUZA, lema, botón e información |
| tipográfica | `ct-frase` | `tz-frase` (y `tz-tipografica`, la de la lista) | una frase o un anuncio, sin foto |

- `*-marco` = foto entera sin ampliar (fotos de la carta, 1200×900): foto arriba (a la izquierda en
  la portada, saliendo por la derecha en el plato) y texto debajo, alineado a la izquierda.
- Sin velo en toda la foto: degradado solo donde va el texto. Sin rombos ni filetes.
  `ct-portada` es el post del plato del dueño; `ct-cierre-marca`, su post del lema (centrado, tal
  cual); `tz-cierre`, su post de Touza (foto al 80 %, como su 75 %).
- **Clásicas** (`clasica: true`): `ct-foto-titular`, `ct-marco`, `ct-tipografica`,
  `tz-foto-titular`, `tz-marco`. Se siguen abriendo, validando y publicando (piezas guardadas), pero
  no salen en los selectores (`plantillasVisibles`, que añade la actual si es clásica con
  «(clásica)») ni las eligen la IA ni las campañas.
- Ayudas en `src/lib/instagram/plantillas/index.ts`: `plantillasVisibles`, `plantillaPara(marca,
  formato, papel, encaje)`, `varianteConEncaje` y `plantillaEnmarcada` (por defecto, la de portada).
  Copia del servidor: `supabase/functions/instagram-ia/plantillas.ts` (con `papel` y `clasica`;
  `plantillas.test.ts` la compara).
- Pruebas: `src/lib/instagram/__tests__/editorial.render.test.ts` (Chromium: cada plantilla v2 en
  post y story con textos normales y al límite, más largos → error con el campo; carruseles por
  papel). Con `INSTAGRAM_CAPTURAS_V2=<carpeta>` guarda los JPEG y `hoja-de-contacto.jpg`; las del
  08/11/2026 están en `instagram-studio/propuesta/evaluacion/plantillas-v2/`.

## Vinos de la carta

Desde el 05/11/2026 la biblioteca enseña también los **vinos de la carta** con foto (tabla `"Vinos"`, bucket público `vinos`), con el filtro **Vinos** y la etiqueta «Vino». Funciona igual que los platos:

- Salen los vinos con `activado = true`, `imagen_url` no nula y de la marca (`restaurante` / `touza`). Tipo **«bebida»**, descripción `nombre · D.O.`, id **`vino:<id del vino>`**.
- **Preparar**: `{ accion: "preparar", origen: "vino", marca, vinoId }` en `instagram-drive`, con las mismas comprobaciones que la carta (fila con el JWT, de la marca y activa; foto del bucket `vinos` de su Supabase; URL reconstruida; sin redirecciones; ≤ 8 MB).
- **Render**: `fotoPreparada` acepta `vino:<id>`; el tipo es siempre «bebida».
- La IA de textos reconoce el vino y usa sus datos (`docs/instagram-ia.md`).

Código: `idFotoVino`, `vinoIdDeFoto`, `fotoDesdeVino`, `fotosDesdeVinos` en `src/lib/instagram/fotos.ts`; `useVinosConFoto` en `useFotosInstagram.ts`; `prepararFotoVino` y `prepararFotoOrigen` en `api.ts`; `prepararCarta` con `CARTA_VINOS` en `instagram-drive/drive.ts`. Sin migraciones.

## Originales de la carta en Drive

Desde el 08/11/2026 (petición del dueño). Y desde ese mismo día **el original vive SOLO en Drive**: en Supabase queda solo la versión web (ver «En Supabase solo el sticker», más abajo). La carta guarda la foto **para la web** (1200×900 webp con el fondo de carta en platos, 900×1200 en vinos), que no sirve a sangre en Instagram. Ahora, cada vez que alguien sube o cambia la foto de un **plato** o un **vino** en Gestión web › Carta (alta, edición y «foto rápida»), además de la versión web se guarda el **ORIGINAL** en Google Drive:

```
marketing/                         ← GOOGLE_DRIVE_MARKETING_FOLDER_ID
└── carta/
    ├── casa-tomas/<nombre-del-plato>-<id>.jpg
    └── touza/<nombre-del-plato>-<id>.jpg
```

- **Qué se guarda**: el fichero que eligió el usuario, ANTES del recorte y de la compresión (`fotoCarta.original`), convertido en el navegador a JPEG calidad 0,92 con la orientación EXIF aplicada, fondo blanco si tenía transparencia, lado mayor ≤ 4000 px (nunca amplía) y ≤ 8 MB (baja la calidad y, si hace falta, el lado a 3000). HEIC solo si el navegador lo abre (la carta, de momento, no admite HEIC). Código: `src/components/carta/originalCarta.ts`, enganchado en `trasGuardarFotoCarta` (`recorte/avisoGuardadoSinFondo.ts`), que llaman todos los formularios después de guardar la ficha.
- **No bloquea**: va en segundo plano después de guardar. Si Drive falla (o falta la migración, o los secretos), la foto de la web ya está guardada y sale el aviso «El original no se ha podido guardar en Drive» con el motivo.
- **Servidor**: `instagram-drive?accion=subir_original` (multipart: `tabla` Platos|Vinos, `id`, `archivo`). Permiso: **«Editar» en la carta** (`can_edit_section('gestor_carta')`), no el de Marketing. Solo JPEG (lee las medidas del propio fichero), lado ≤ 4000, ≤ 8 MB. Marca: `restaurante` → casa-tomas; si no, `touza` → touza. Si la ficha ya tenía original en esa carpeta, **reemplaza su contenido** (mismo id de Drive); si no, crea el fichero. Guarda el id en `carta_fotos_originales` con el JWT del usuario.
- **Instagram lo usa**: en la biblioteca, las fotos de la carta con original salen con las **medidas del original** (y su aptitud post/story) y una marca discreta **«Original»**; las demás, **«Solo web»** (`src/lib/instagram/originalesCarta.ts`, `useOriginalesCarta`, `EtiquetaOriginal.tsx`). Al **preparar** (origen carta o vino), si hay original y Drive está configurado, la función copia ESE a `tmp/` (comprobando que está dentro de `marketing/carta/<marca>`, es JPEG y ≤ 8 MB) y responde `original: true`; si falla, usa la versión web con `original: false` y un `aviso`. El render y la IA reciben las medidas del fichero preparado.
- **Fotos que ya existían**: no tienen original. `scripts/instagram/importar-originales.mjs` los sube desde una carpeta local según un CSV `id_plato,fichero[,tabla]` (con la misma Edge Function y la sesión de alguien con «Editar» en la carta), y con `--sugerir` propone los emparejamientos por nombre de fichero y de plato (revísalos a mano: p. ej. `arroz.jpg` sale como «Arroz con leche»). `--simular` convierte sin subir. Sugerencias de las fotos de `instagram-studio/propuesta/marca-base/assets/local` contra la demo: `scripts/instagram/originales-sugerencias-demo.csv`.

**Límite conocido**: si la foto de la web cambia por otro camino (restaurar una foto anterior, scripts), el original de Drive no se toca y puede quedar desfasado hasta la próxima subida desde el formulario. (El recorte en un ordenador potente sí lo sube: ver abajo.)

### En Supabase solo el sticker (08/11/2026)

Decisión del dueño: «En Supabase no quiero guardar más que el sticker, para no pasarme de memoria». Medido en la demo: los originales de platos eran 103 ficheros y 58 MB frente a 8 MB de stickers.

| | Supabase (bucket público) | Google Drive (`marketing/carta/<marca>/`) |
|---|---|---|
| Foto de plato / vino con fondo de carta | **solo** el sticker `<id>-carta-<ext>.webp` (`platos`, `vinos`) | el original `<nombre>-<id>.jpg` (`carta_fotos_originales`) |
| Foto guardada con «Usar foto original» (o recorte fallido) | `<id>.<ext>`: es la foto de la web | también el original |
| Vídeo del plato | el vídeo de la web `<id>-video.<mp4\|webm>` | el bruto `videos/<id>.<ext>` (uno por plato) |
| Bebidas y cócteles | siguen con `<id>.<ext>` + sticker (aún no tienen original en Drive) | — |

- **Subir** (`subirFotoCarta.ts`, `BUCKETS_SOLO_STICKER`): en platos y vinos con fondo de carta ya NO se sube `<id>.<ext>` al bucket; el original va solo a Drive con `subir_original` (`trasGuardarFotoCarta`). Si Drive falla, la foto de la web se guarda igual y sale «El original no se ha podido guardar en Drive».
- **Leer el original** (`src/components/carta/originalDrive.ts` → `instagram-drive?accion=descargar_original` `{ tabla, id, tipo?: "foto"|"video", comprobar?: true }`): devuelve los bytes al panel (nada se copia a Supabase). Permiso: **«Editar» en la carta** (`gestor_carta`); 404 `{ sinOriginal: true }` si no hay. Solo sirve ficheros de `marketing/carta/<marca>` (o `…/videos`). Orden en el panel: Drive → original antiguo del bucket (`<id>.<ext>`, hasta que se mueva) → la foto de la web (el sticker), **avisando** «No hay original guardado: se usa la foto de la web». Lo usan:
  - **«Cambiar fondo» / «Quitar fondo»** (`BotonCambiarFondo`, recibe `tabla` e `id`). Un original que viene de Drive queda marcado (`esOriginalDeDrive`) y al guardar **no se vuelve a subir** (no se recomprime); si pesa más de 5 MB se reduce para la carta, pero el de Drive no cambia.
  - **«Volver a la foto original»** (vinos): carga el original de Drive con «Usar foto original» elegido; si aún es uno antiguo del bucket, la ficha vuelve a apuntar a él como antes.
  - **Leer la etiqueta con IA** (vinos): usa la foto nueva o la de la web.
  - **Recorte en un ordenador potente** (`recortarFotoGuardada`, trabajos del móvil): la ficha tenía `<id>.<ext>` como foto de la web; tras ponerle el sticker, ese fichero se sube a Drive y **solo si queda allí** se borra del bucket.
  - **Vídeos** (`subirVideoPlato.ts`): `guardarOriginalVideo` → `subir_original_video` (subida reanudable de Drive, ≤ 50 MB, mp4/mov/m4v/webm/3gp/mkv mirando la cabecera); `buscarOriginalVideo` → `comprobar`; `descargarOriginalVideo` → `descargar_original` con `tipo: "video"`; el flujo potente sube el bruto a Drive y borra `pendientes/` siempre (si Drive falla, avisa). «Mandar a un dispositivo potente» baja el original de Drive y sube una copia temporal a `pendientes/`.
  - **Instagram** (`preparar` con origen carta o vino) ya leía el original de Drive y copia una temporal a `tmp/` del bucket «instagram».
- **Migrar lo que ya hay**: `scripts/carta/mover-originales-a-drive.mjs` (ver su cabecera). Por defecto **simula** (lista y suma MB, sin tocar nada); solo con `--aplicar` sube a Drive con la Edge Function (`subir_original` / `subir_original_video`, misma conversión que el panel), lo anota en `carta_fotos_originales`, comprueba en Drive tamaño y medidas (`descargar_original` con `comprobar`) y **solo entonces** borra del bucket lo que ninguna ficha usa como foto de la web. Nunca toca stickers, fotos de la web, vídeos de la web, `pendientes/` ni los «huérfanos» sin ficha (los lista). Se autentica **sin service_role**, con la sesión de una cuenta con «Editar» en la carta (`PANEL_JWT` o `PANEL_EMAIL` + `PANEL_PASSWORD`). Para simular sin sesión: `--sql` imprime una consulta de solo lectura y `--inventario <json>` lee su salida de `npx supabase db query --linked -o json`. `--limite N` para ir por tandas.
  - Simulación en la DEMO (08/11/2026): **232 ficheros, 72,41 MB** de 198 fichas (platos: 103 fotos, 58,19 MB, y 1 vídeo, 0,90 MB; vinos: 128 fotos, 13,32 MB). 43 platos tienen 2 originales (p. ej. `.JPG` y `.webp`): se sube el de más píxeles y se borran los dos. 9 ficheros de vinos son de dos fichas (Magnum): se borran cuando las dos están en Drive. 4 platos sin foto en la web tienen original en el bucket (4,81 MB): también se mueven.
- **Despliegue**: hay que volver a desplegar `instagram-drive` (acciones nuevas `descargar_original` y `subir_original_video`) y el panel. Sin migraciones. Orden: desplegar la función → el panel → `--simular` → `--aplicar` (primero en la demo).

**Instagram en Supabase** (revisado el 08/11/2026 en la demo): el bucket «instagram» solo tiene temporales: `tmp/` (copias de fotos, se borran a las 24 h al preparar otra y cada noche con el cron `instagram-limpieza-bucket`) y `piezas/` de piezas aún sin publicar (3 en la demo, de 4 días; el cron las borra a los 7 días sin publicar, o al publicar tras guardarlas en Drive). Lo único permanente que puede dejar Instagram son las **pistas de audio** de los reels (`instagram-video/audio/<uuid>.<ext>`, que sube «Vídeo para reel»): la limpieza nocturna no toca `audio/` a propósito (`limpieza.ts`); en la demo no hay ninguna. También quedan (si existieran) las fotos subidas al bucket antes de Drive (`fotos/<marca>/subidas/`, `instagram_fotos.ruta`): en la demo, ninguna.

**Límites**: el original de Drive no se borra al quitar la foto o el vídeo de una ficha (el panel no borra nada de Drive). El vídeo original pasa por la Edge Function (hasta 50 MB por petición): **sin verificar** contra Google desde aquí con un vídeo real de ese tamaño.

### Base de datos

Migración `supabase/migrations/20261117100000_carta_fotos_originales.sql` (rollback en `supabase/rollbacks/`, que deja los ficheros en Drive). **Tabla aparte** `carta_fotos_originales` y no columnas en `"Platos"`/`"Vinos"`: esas tablas las lee `anon` desde las webs (se publicarían los ids de Drive), tienen triggers al editar (updated_at, publicación de vinos, auditoría) que se dispararían sin que nadie cambie la ficha, y así los permisos son propios. Una fila por plato **o** por vino (CHECK, UNIQUE, ON DELETE CASCADE): `drive_id`, `marca`, `nombre`, `ancho`, `alto`, `bytes`, `subido_por` (lo pone la BD). RLS: escribe `gestor_carta` («Editar»); leen `gestor_carta` y `marketing` («Ver»); `anon`, nada. Prueba: `npm run test:carta-originales:db` (PGlite, en el CI).

Aplicar en la demo y desplegar (desde `wt/instagram-panel`, enlazado a la demo):

```
npx supabase db query --linked -f supabase/migrations/20261117100000_carta_fotos_originales.sql
npx supabase functions deploy instagram-drive --project-ref sfonaclosuafvlhutkon
```

Tiene que terminar en «carta_fotos_originales: aplicada». Producción solo después de aceptar el PR y con el «sí» del dueño.

## Preparación en el navegador (Subir foto)

- Acepta JPEG, PNG y WebP; HEIC/HEIF solo si el navegador sabe abrirlo (Safari sí; Chrome y
  Firefox, no). Si no: «Este formato no se puede leer en este navegador; expórtala como JPEG».
- Orientación EXIF aplicada (`createImageBitmap(…, { imageOrientation: "from-image" })`), lado mayor
  ≤ 2560 px (nunca amplía), canvas sRGB con fondo blanco → JPEG calidad 0,9. Si pasa de 8 MB baja la
  calidad hasta 0,7; si aun así no cabe, la rechaza. Se pierden los metadatos EXIF (también el GPS).
- Vista previa con las medidas reales y si sirve para **post 1080×1350** y **story 1080×1920**
  (misma regla que `esAptaPara`/`validarPieza`: cubrir ampliando ≤ 5 %).
- Campos: marca, tipo (`TIPOS_FOTO`) y descripción corta (≤ 140).

## TRAMPA: el alcance `drive.file`

El refresh token de Google (`GOOGLE_REFRESH_TOKEN`, el mismo que usan las facturas) tiene un alcance
(scope). Con **`drive.file`** la app **solo ve lo que ella misma ha creado**:

- **No ve la carpeta «marketing»** si se creó a mano → «Comprobar» (pestaña Conexión) da fallo en
  «Carpeta «marketing»» y explica las dos salidas: (1, recomendada) volver a autorizar la app de
  Google con el alcance completo `https://www.googleapis.com/auth/drive` y guardar el refresh token
  nuevo en `GOOGLE_REFRESH_TOKEN` (las facturas siguen funcionando), o (2) usar como «marketing» una
  carpeta creada por la propia app y poner su id en `GOOGLE_DRIVE_MARKETING_FOLDER_ID`.
- **No ve las fotos arrastradas a mano** a Drive, aunque estén en la carpeta buena: solo las
  subidas desde el panel. El selector lo avisa encima de las fotos.

Con el alcance completo (`drive`) se ve todo, y por eso la función comprueba siempre que cada
fichero está dentro de `instagram/fotos/<marca>` antes de servirlo.

**Sin verificar** (no se ha podido probar contra Google desde aquí): qué alcance tiene hoy el
token de las facturas. «Comprobar» lo dice al momento.

## Código

| Qué | Dónde |
|---|---|
| Cliente de Drive (OAuth refresh token, carpetas, listado, subida, descarga, miniaturas) | `supabase/functions/_shared/google-drive.ts` (procesar-factura NO lo usa: sigue con su `archivo.ts`) |
| Estructura, configuración, alcance y «Comprobar» de Drive | `supabase/functions/_shared/instagram/drive.ts` |
| Edge Function de la biblioteca | `supabase/functions/instagram-drive/` (`drive.ts` con la lógica) |
| Escala temporal y filas (como el usuario) | `supabase/functions/_shared/instagram/supabase.ts` (`subirObjeto`, `listarObjetos`, `borrarObjetos`, `leerFotosDrive`, `insertarFotoDrive`, `anotarDrivePieza`) |
| Foto de Drive → `Foto`, ids `drive:…`, validación de la URL tmp/ | `src/lib/instagram/fotos.ts` (`fotoDesdeDrive`, `idFotoDrive`, `driveIdDeFoto`, `rutaTmpDeUrl`) |
| Llamadas del panel | `src/components/marketing/instagram/api.ts` (`listarFotosDrive`, `subirFotoDrive`, `prepararFotoDrive`, `miniaturaDrive`) |
| Hooks | `useFotosInstagram.ts` (`useFotosInstagram`, `useFotoPreparada`) |
| UI | `SelectorFoto.tsx`, `SubirFotoDialog.tsx`, `fotosSubidas.ts`, `ConexionInstagram.tsx` |
| Render | `api/_lib/instagram/fotos.ts` (`fotoDesdePreparada`, `catalogoParaPieza`) |

El catálogo estático (`FOTOS` de `src/lib/instagram/fotos.ts`) ya **no se enseña**: sus rutas del
bucket no existen en la demo (salían fotos rotas). Queda de respaldo en el render para piezas
antiguas, igual que las fotos subidas al bucket antes de Drive (`instagram_fotos` con `ruta`).

## Base de datos

Migración nueva `supabase/migrations/20261105150000_instagram_drive.sql` (después de
`20261105090000_instagram.sql` y `20261105120000_instagram_fotos.sql`). Rollback:
`supabase/rollbacks/20261105150000_instagram_drive_ROLLBACK.sql` (borra las filas que solo están
en Drive y las columnas `drive_id`; los ficheros siguen en Drive).

- `instagram_fotos.drive_id`: id de Drive, único, solo `[A-Za-z0-9_-]{10,200}`; no cambia al editar.
- `instagram_fotos.ruta` pasa a ser opcional (las de Drive no tienen fichero en el bucket); si la
  hay, sigue siendo `fotos/<marca>/subidas/<id>.jpg`. Cada fila tiene `ruta` o `drive_id`.
- `instagram_piezas.drive_id`: id en Drive del JPEG publicado.
- RLS y permisos, sin cambios (sección marketing).

### Aplicar en la demo y desplegar

Desde `wt/instagram-panel` (o la raíz del repo `admin-casatomas/`), con el proyecto demo enlazado:

```
npx supabase link --project-ref sfonaclosuafvlhutkon
npx supabase db query --linked -f supabase/migrations/20261105150000_instagram_drive.sql
npx supabase secrets set GOOGLE_DRIVE_MARKETING_FOLDER_ID=<id de la carpeta marketing> --project-ref sfonaclosuafvlhutkon
npx supabase functions deploy instagram-drive instagram-publicar instagram-estado --project-ref sfonaclosuafvlhutkon
```

Tiene que terminar en «instagram_drive: aplicada». `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y
`GOOGLE_REFRESH_TOKEN` ya están (son los de las facturas). Después: sección **Instagram** →
pestaña **Conexión** → **Comprobar**, y mirar el bloque «Google Drive».

Producción (`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí» del dueño.

## Pruebas

- `npm run test:instagram:db` (PGlite, sección 7: migración de Drive, CHECK, inmutabilidad, rollback).
- vitest (sin red): `supabase/functions/_shared/__tests__/google-drive.test.ts` (cliente con fetch
  falso), `supabase/functions/instagram-drive/__tests__/drive.test.ts` (la función: permisos,
  carpeta de la marca, tmp/, drive.file), `instagram-publicar` (Drive antes de borrar),
  `instagram-estado` (bloque Drive), `api/_lib/__tests__/instagramFotos.test.ts` (render con
  `fotoPreparada` y SSRF), `src/lib/instagram/__tests__/fotosSubidas.test.ts`,
  `src/components/marketing/instagram/__tests__/{SubirFoto.test.tsx,EditorInstagram.test.tsx}`.

## Límites conocidos

- HEIC solo donde el navegador lo decodifica (Safari). En Chrome/Firefox hay que exportarla a JPEG.
- Fotos arrastradas a mano a Drive en HEIC o de más de 8 MB no se pueden usar tal cual: hay que
  subirlas desde el panel (que las convierte).
- Las fotos «Sin clasificar» valen para cualquier plantilla: el panel aún no deja ponerles tipo.
- Las piezas publicadas en Instagram no dependen de la foto (Instagram guarda su copia).
