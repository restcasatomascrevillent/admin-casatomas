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
