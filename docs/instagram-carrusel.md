# Instagram: carruseles (2–10 imágenes) y publicar sin paso de prueba

05/11/2026. El dueño sube, por ejemplo, 6 fotos de producto fresco, la IA
monta el carrusel («Montar con IA», `src/lib/instagram/montar.ts`) y se
publica (o se programa) como **una sola publicación** de Instagram con 6
imágenes. Además, **ya no hace falta «Prueba sin publicar»**: publicar y
programar validan y crean el contenedor por dentro.

Rama `feat/instagram-carrusel` (lleva fusionada `feat/instagram-seguridad`:
usa su `can_edit_section`, su cerrojo de ficheros y su protección contra la
doble publicación).

## Cómo funciona

```
 Panel ── 1 llamada ──►  POST /api/instagram-render  { tipo: "carrusel", marca, diapositivas[2–10] }
                          valida CADA imagen con validarPieza (como un post de la marca)
                          1 Chromium, 3 páginas a la vez (reutilizadas) → N JPEG 1080×1350
                          ──► bucket «instagram» piezas/AAAA-MM/<id>-01.jpg … -NN.jpg
                          ──► instagram_piezas: UNA fila (tipo_medio = formato = 'carrusel',
                              diapositivas = [{ foto, plantilla, datos, alt_text, imagen_ruta }])

 Panel ──────────────►  instagram-publicar  { id }                    (publicar YA, sin prueba)
                          HEAD de las N imágenes · cuota (un carrusel = 1 publicación)
                          N contenedores hijo (is_carousel_item, image_url, alt_text) → FINISHED
                          contenedor CAROUSEL (children, caption) → FINISHED
                          media_publish UNA vez → media_id guardado al momento
                          Drive: las N imágenes; si están TODAS, se borran del bucket
                       ─  instagram-publicar  { id, programarPara }   (programar, sin prueba)
                          valida texto, textos alternativos e imágenes → RPC instagram_programar
                          (con el JWT del usuario y el texto en la misma llamada)

 pg_cron ── instagram-programador ── publicarConSesion({ id, dryRun: false }) ── igual que «publicar»
```

## Contratos (para el panel)

Todas con `Authorization: Bearer <JWT>` (y `apikey` en las Edge Functions);
401 sin sesión, 403 sin «Editar» en Marketing.

### Render: `POST /api/instagram-render`

```jsonc
{
  "tipo": "carrusel",
  "marca": "casa-tomas",            // o "touza"
  "diapositivas": [                 // 2–10, en el orden de publicación; la 1.ª es la portada
    {
      "foto": "subida:<uuid>",      // o "drive:<id>", "carta:<id>", id del catálogo, o null (tipográfica)
      "plantilla": "ct-foto-titular",
      "datos": { "antetitulo": "Hoy", "titular": "Llegó del Cantábrico" },  // rótulos (DatosPieza)
      "altText": "Ostras sobre hielo picado",                               // opcional, ≤ 1000
      "fotoPreparada": { "id": "subida:<uuid>", "url": "<SUPABASE>/storage/v1/object/public/instagram/tmp/<uuid>.jpg",
                         "ancho": 3024, "alto": 4032, "tipo": "plato", "marca": "casa-tomas" }
    }
    // …
  ],
  "id": "<uuid>",                   // opcional: regenerar ese carrusel
  "caption": "Texto #casatomas"     // opcional
}
```

Cada diapositiva es una `DiapositivaMontada` (lo que devuelve la IA) más su
`fotoPreparada`. Se valida como el post
`{ ...datos, marca, plantilla, formato: "post", foto }` con el esquema de
siempre.

- **200** `{ ok, id, estado: "generada", tipoMedio: "carrusel", urlJpeg, imagenRuta,
  diapositivas: [{ orden, urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos, tiempos }],
  avisos, msRender, msTotal }` (`urlJpeg`/`imagenRuta` = la portada).
- **422** `{ error, problemas: ["Imagen 2: El titular tiene 9 palabras…", …] }`
  (de todas las imágenes a la vez; también si no pasa la maquetación:
  `tipo`, `imagenes: [4]`). Si falla una, **no se sube ninguna**.
- **400** marca o cuerpo; **404** id; **409** ya publicada o el `id` no es
  un carrusel (`tipo: "no_es_carrusel"`: una pieza no cambia de tipo).

Fotos subidas desde el móvil: `subida:<uuid>` con el JPEG ya en
`tmp/<uuid>.(jpg|png|webp)` del bucket «instagram». Se aceptan igual que
`drive:`/`carta:` (pieza suelta o carrusel): solo con `fotoPreparada` cuya
URL sea `tmp/` de NUESTRO Supabase **y de ese mismo uuid** (sin SSRF).

Tiempo: un solo Chromium y `INSTAGRAM_RENDER_PARALELO` páginas a la vez
(3 por defecto, de 1 a 6; variable de entorno de Vercel, opcional). Cada
página renderiza varias imágenes seguidas: abrir una página cuesta más que
renderizar en ella. Medido en local (Windows, Chromium de Playwright): 6
imágenes en ~9 s, de ellos ~1,5 s de arranque. Límite de la función: 60 s.

Al regenerar con menos imágenes, las que sobran se borran del bucket.

### Publicar: `POST ${SUPABASE_URL}/functions/v1/instagram-publicar`

```jsonc
{
  "id": "<uuid del carrusel>",
  "caption": "…",                   // opcional (si no, el guardado)
  "altTexts": ["…", "…"],           // opcional: uno por imagen, en orden (si no, los guardados)
  "fotosTmp": ["tmp/<uuid>.jpg"],   // opcional: copias tmp/ de las fotos; se borran al publicar
  "dryRun": false                   // OPCIONAL (por defecto false). true = solo crear y comprobar
}
```

- **200** `{ ok, publicado: true, estado: "publicada", tipoMedio: "carrusel", mediaId, permalink,
  contenedor: { id, estado, hijos }, urlsJpeg, imagenEnBucket, driveId, driveIds, cuota, cuenta, caption, avisos }`.
- **202** `{ estado: "en_proceso", reintentar: { id, contenedorId, dryRun } }`: Meta
  aún procesa; repetir con ese `contenedorId` (no crea otro).
- **409** `tipo: "publicacion_en_curso" | "programada" | "publicada" | "imagen_borrada" | "sin_imagenes"`.
- **422** texto, textos alternativos (si llegan, tantos como imágenes) o
  imágenes que Meta no podría descargar («Imagen 3: …»).
- Error de Meta en una imagen → la pieza queda en «error» con «Imagen N del
  carrusel: …» y **no se publica nada**.

Lo mismo vale para posts, stories y reels: `dryRun` ya no es obligatorio.

### Programar: el mismo endpoint con `programarPara`

```jsonc
{ "id": "<uuid>", "programarPara": "2026-12-24T10:00:00+01:00", "confirmarConflicto": false,
  "caption": "…", "altText": "…" /* post */, "altTexts": ["…"] /* carrusel */ }
```

Valida el texto y los textos alternativos, comprueba por HEAD que Meta podrá
descargar las imágenes y llama a la RPC `instagram_programar` **con el JWT
del usuario** (que comprueba «Editar», la fecha y los conflictos), pasándole
el texto: no hace falta ninguna prueba previa.

- **200** `{ ok, programado: true, accion: "programada"|"reprogramada", programacion, conflictos }`
- **409** `{ requiereConfirmacion: true, conflictos }` → repetir con `confirmarConflicto: true`.
- **422** mensaje de la RPC (p. ej. «Hay que programarla con al menos 10 minutos de margen»).

O directamente la RPC (el panel ya la usa):
`instagram_programar(p_pieza_id, p_para, p_confirmar_conflicto default false,
p_caption text default null, p_alt_text text default null, p_alt_texts text[] default null)`.
`null` = se conserva lo guardado. La llamada de 3 argumentos sigue valiendo.

Para un carrusel se programa **la pieza del carrusel** (su id): el
programador publica el grupo entero.

## Base de datos (migración `20261112000000_instagram_carrusel`)

**Una columna JSON (`instagram_piezas.diapositivas`) y no una tabla hija**:

- las imágenes se leen y se escriben siempre juntas (máximo 10) y no hay
  consultas por imagen;
- todas las reglas de `instagram_piezas` son por fila (RLS con
  `can_edit_section('marketing')`, estado solo por el servidor, pieza
  programada protegida, auditoría, limpieza): con una columna el carrusel
  queda cubierto sin duplicarlas en otra tabla;
- es el patrón de las migraciones de Instagram (`datos`, el reel y la cola de
  render también son jsonb).

Lo que añade:

| Qué | Para qué |
|---|---|
| `tipo_medio`/`formato` = `'carrusel'` (uno implica el otro) | |
| `diapositivas jsonb` + CHECK `instagram_diapositivas_validas` | 2–10 objetos `{ foto, plantilla, datos, alt_text ≤ 1000, imagen_ruta }`; la ruta tiene que ser `piezas/AAAA-MM/<id de ESA pieza>-NN.jpg` en SU posición (el panel no puede colar rutas de otra pieza para que se borren al publicar). `imagen_ruta` de la fila = la de la portada. |
| `drive_ids text[]` | id en Drive de cada JPEG publicado (`drive_id` = la portada). Solo el servidor. |
| trigger `instagram_piezas_proteger_carrusel` | el panel no escribe `drive_ids`; un carrusel programado o publicándose no cambia sus imágenes (los textos alternativos sí). |
| `instagram_objeto_bloqueado` (de 20261111000000) | también protege en el cubo las imágenes de un carrusel programado o publicándose. |
| `instagram_piezas_reclamar_jpeg_caducados` | la limpieza diaria devuelve TODAS las imágenes de un carrusel (una fila por imagen; misma firma). Nunca las de uno programado. |
| `instagram_programacion_pieza` | un carrusel se programa si tiene sus imágenes y no se han borrado. |
| `instagram_programar(…, p_caption, p_alt_text, p_alt_texts)` | texto en la misma llamada. |

Aplicar (después de `20261111000000_instagram_seguridad`; demo primero, nunca `db push`):

```
npx supabase db query --linked -f supabase/migrations/20261112000000_instagram_carrusel.sql
```

Deshacer: `supabase/rollbacks/20261112000000_instagram_carrusel_ROLLBACK.sql`
(**borra los carruseles**). Pruebas: `npm run test:instagram-carrusel:db`.

## Meta: lo que dice la documentación oficial (consultada el 05/11/2026)

- [Content publishing → Carousel posts](https://developers.facebook.com/docs/instagram-platform/content-publishing):
  un contenedor por imagen con `is_carousel_item=true`; después el
  contenedor con `media_type=CAROUSEL` y `children` (ids separados por
  comas); después `media_publish`. Un carrusel cuenta como **una**
  publicación en la cuota. Hasta 20 imágenes (el panel se queda en 10).
  Todas se recortan como la primera (por eso todas son 1080×1350).
- [IG User → Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media):
  `alt_text` «Only supported on a single image or image media in a
  carousel»: va en **cada hijo**, no en el contenedor del carrusel. Los
  hijos no llevan `caption`; va en el contenedor.
- La documentación no dice que haya que esperar a que cada hijo esté
  FINISHED antes de crear el carrusel; se espera igualmente (una consulta por
  hijo, las imágenes suelen estar listas al momento) para que un hijo con
  error pare todo antes de publicar.

## Doble publicación (mismo patrón que feat/instagram-seguridad)

- El contenedor que se guarda en la pieza es el del **carrusel** (los hijos
  no se publican solos). Antes de crear otro se mira si el anterior ya salió
  (`PUBLISHED` → se recupera el medio, no se crea nada).
- `media_publish` **nunca se reintenta** (`publicarSinDuplicar`): si falla o
  se agota el tiempo, se mira el contenedor.
- `media_id` y «publicada» se guardan **nada más** publicarse, antes del
  enlace, de Drive y de borrar nada.
- Cerrojo `instagram_pieza_reservar_publicacion` (409 «publicacion_en_curso»)
  y 409 «programada» al publicar a mano una pieza programada.

## Panel móvil (feat/instagram-movil): cómo encaja

El móvil (`src/components/instagram/movil/apiReal.ts`, `publicar.ts`) se
escribió contra otro contrato: un render **por imagen** con
`carrusel: { grupo, indice, total }` (una pieza por imagen) y publicar con
`carrusel: { grupo, ids, altTexts }`. El servidor de esta rama **no** usa
grupos de piezas: un carrusel es UNA pieza. Al integrar hay que cambiar en
el móvil:

| El móvil hace hoy | Con esta rama |
|---|---|
| N × `POST /api/instagram-render { pieza, caption, fotoPreparada, carrusel: { grupo, indice, total } }` | 1 × `POST /api/instagram-render { tipo: "carrusel", marca, diapositivas: [{ foto, plantilla, datos, altText, fotoPreparada }], caption }` → `{ id, urlJpeg, diapositivas[] }` |
| `instagram-publicar { carrusel: { grupo, ids, altTexts }, caption, dryRun: false, fotosTmp }` | `instagram-publicar { id, caption, altTexts, fotosTmp }` (`dryRun` sobra) |
| `instagram_programar` con la primera imagen como portada | `instagram_programar(p_pieza_id = id del carrusel, p_para, …, p_caption, p_alt_texts)` o `instagram-publicar { id, programarPara, caption, altTexts }` |

Las fotos `subida:<uuid>` en `tmp/<uuid>.jpg` ya se aceptan tal cual.

## Funciones que hay que volver a desplegar

- Vercel: `api/instagram-render.ts` (va con el despliegue de la rama).
- Edge Functions: `instagram-publicar` e `instagram-programador` (comparten
  `_shared/instagram/`; el programador importa `publicarConSesion`):

```
npx supabase functions deploy instagram-publicar instagram-programador --project-ref sfonaclosuafvlhutkon
```

## Pruebas

- `npm run test:instagram-carrusel:db` (PGlite): forma del carrusel, «Editar»,
  estado y `drive_ids` solo del servidor, programar con el texto, imágenes de
  un carrusel programado intocables (tabla y cubo), limpieza de todas las
  imágenes, rollback.
- `api/_lib/__tests__/instagram-carrusel.test.ts`: render (un lote, N
  subidas, una fila, errores de todas las imágenes, regenerar con menos,
  `subida:<uuid>` y anti-SSRF) y **6 imágenes con Chromium real** si está el
  de Playwright.
- `supabase/functions/instagram-publicar/__tests__/carrusel.test.ts`: cliente
  (hijos, padre, error en un hijo → nada publicado), publicar sin prueba,
  textos alternativos, Drive, doble publicación en carrusel, programador y
  programar directamente.
