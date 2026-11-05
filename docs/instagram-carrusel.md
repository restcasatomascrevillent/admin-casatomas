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
 Panel ── N llamadas (una por imagen, como hoy) ──►  POST /api/instagram-render { pieza, fotoPreparada, caption }
                                                      → una pieza suelta «generada» por imagen: { id, urlJpeg }

 Panel ──►  instagram-publicar { ids: [id1…idN], caption, altTexts, fotosTmp }        (publicar YA, sin prueba)
             1 id   → esa pieza (post o story), como siempre
             2–10   → MONTA un carrusel (ensamblar.ts): id determinista, copia los JPEG a
                      piezas/AAAA-MM/<carrusel>-NN.jpg, crea UNA fila carrusel y borra las sueltas
             HEAD de las imágenes · cuota (un carrusel = 1 publicación)
             N contenedores hijo (is_carousel_item, image_url, alt_text) → FINISHED
             contenedor CAROUSEL (children, caption) → FINISHED
             media_publish UNA vez → media_id guardado al momento
             Drive: las N imágenes; si están TODAS, se borran del bucket

 Panel ──►  instagram-publicar { accion: "programar", ids, caption, altTexts, programarPara }
             monta igual (si son 2–10) → valida texto, textos alternativos e imágenes
             → RPC instagram_programar(id, para, …, p_caption, p_alt_texts) con el JWT del usuario

 pg_cron ── instagram-programador ── publicarConSesion({ id, dryRun: false }) ── igual que «publicar»
```

Opcional: el render también genera un carrusel entero en UNA llamada
(`tipo: "carrusel"`, abajo). Las dos vías acaban en la misma fila carrusel.

## Contrato final (para el panel de escritorio y el móvil)

Todas con `Authorization: Bearer <JWT>` (y `apikey` en las Edge Functions);
401 sin sesión, 403 sin «Editar» en Marketing.

### 1. Render de cada imagen: `POST /api/instagram-render` (sin cambios)

```jsonc
{ "pieza": { "marca": "casa-tomas", "plantilla": "ct-foto-titular", "formato": "post",
             "foto": "subida:<uuid>", "antetitulo": "Hoy", "titular": "Llegó del Cantábrico" },
  "fotoPreparada": { "id": "subida:<uuid>", "url": "<SUPABASE_URL>/storage/v1/object/public/instagram/tmp/<uuid>.jpg",
                     "ancho": 3024, "alto": 4032, "tipo": "plato", "marca": "casa-tomas" },
  "caption": "…", "id": "<uuid para regenerar>" }
→ 200 { ok, id, estado: "generada", urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos }
```

- Para un carrusel, cada imagen con `formato: "post"` (1080×1350; Meta recorta
  todas como la primera). Las claves de más (p. ej. `carrusel: { grupo, indice, total }`
  del móvil) se ignoran.
- `foto`: `subida:<uuid>` (JPEG subido por el panel a `tmp/<uuid>.(jpg|png|webp)`),
  `drive:<id>`, `carta:<id>`, `vino:<id>` (este llega con la rama
  `feat/instagram-ia-vision`; fusiona sin conflicto con esta), un id del
  catálogo o nada (plantillas tipográficas). Las preparadas solo con
  `fotoPreparada` cuya URL sea `tmp/` de NUESTRO Supabase; la de `subida:`,
  además, de ESE uuid (sin SSRF).

### 2. Publicar ahora: `POST ${SUPABASE_URL}/functions/v1/instagram-publicar`

```jsonc
{
  "ids": ["<uuid>", "…"],          // 1 = post o story; 2–10 = carrusel EN ESTE ORDEN (la 1.ª es la portada)
  "caption": "Texto #casatomas",   // opcional (si no, el guardado; en un carrusel nuevo, el de la 1.ª pieza)
  "altTexts": ["…", "…"],          // opcional: carrusel, uno por imagen (si no, los guardados de cada pieza)
  "altText": "…",                  // opcional: post (1 id)
  "fotosTmp": ["tmp/<uuid>.jpg"],  // opcional: copias tmp/ de las fotos; se borran al publicar
  "contenedorId": "…",             // solo al repetir tras un 202
  "directo": true,                 // admitido e ignorado
  "dryRun": false                  // OPCIONAL (por defecto false); true = solo crear y comprobar (uso interno)
}
```

`"id": "<uuid>"` en vez de `ids` sigue valiendo (una pieza, o un carrusel
ya montado). Alias del móvil: `"carrusel": { "ids": […], "altTexts": […] }`.

- **200** `{ ok, id, publicado: true, estado: "publicada", mediaId, permalink, contenedor: { id, estado, hijos? },
  cuota, cuenta, caption, avisos, imagenEnBucket, driveId }`; en un carrusel además
  `tipoMedio: "carrusel"`, `urlsJpeg`, `driveIds`. **`id` es el del carrusel** (el
  que hay que usar después para programar, ver o reintentar).
- **202** `{ ok: true, estado: "en_proceso", id, contenedor: { id }, reintentar: { id, contenedorId, dryRun } }`:
  repetir con `contenedorId` (con los mismos `ids` o con `id`: llega al mismo carrusel).
- **409** `tipo: "publicacion_en_curso" | "programada" | "publicada" | "imagen_borrada" | "sin_imagenes"`;
  al montar, si alguna pieza está programada.
- **422** texto, textos alternativos (si llegan, tantos como imágenes),
  imágenes que Meta no podría descargar, o piezas que no se pueden juntar
  (`problemas: ["Imagen 2: tiene que ser una imagen de feed…", "Imagen 3: es de otra marca…"]`).
- Error de Meta en una imagen → la pieza queda en «error» con «Imagen N del
  carrusel: …» y **no se publica nada**. Reintentar con los mismos `ids`
  reutiliza el carrusel ya montado.

### 3. Programar: el mismo endpoint con `accion: "programar"`

```jsonc
{ "accion": "programar", "ids": ["…"], "programarPara": "2026-12-24T10:00:00+01:00",
  "confirmarConflicto": false, "caption": "…", "altTexts": ["…"], "altText": "…" }
```

Monta el carrusel si son 2–10 ids, valida el texto y los textos
alternativos, comprueba por HEAD que Meta podrá descargar las imágenes y
llama a la RPC `instagram_programar` **con el JWT del usuario** (comprueba
«Editar», la fecha y los conflictos), pasándole el texto. Sin prueba previa.

- **200** `{ ok: true, id, programado: true, accion: "programada"|"reprogramada",
  programacion: { id, programada_para, … }, conflictos }`
- **200** `{ ok: false, id, requiereConfirmacion: true, conflictos }` → repetir con `confirmarConflicto: true`.
- **422** mensaje de la RPC (p. ej. «Hay que programarla con al menos 10 minutos de margen»).

(`programarPara` sin `accion` también programa.) El programador publica el
carrusel entero (programa la pieza carrusel, no la primera imagen).

La RPC directa sigue disponible:
`instagram_programar(p_pieza_id, p_para, p_confirmar_conflicto default false,
p_caption text default null, p_alt_text text default null, p_alt_texts text[] default null)`
(`null` = se conserva lo guardado; la llamada de 3 argumentos sigue valiendo).
Para un carrusel, `p_pieza_id` tiene que ser el id del carrusel ya montado.

### 4. Opcional: carrusel entero en UNA llamada al render

```jsonc
{ "tipo": "carrusel", "marca": "casa-tomas",
  "diapositivas": [ { "foto": "subida:<uuid>", "plantilla": "ct-foto-titular",
                      "datos": { "antetitulo": "Hoy", "titular": "Llegó del Cantábrico" },
                      "altText": "Ostras sobre hielo", "fotoPreparada": { … } }, … ],   // 2–10 (DiapositivaMontada + fotoPreparada)
  "caption": "…", "id": "<uuid para regenerar>" }
→ 200 { ok, id, estado: "generada", tipoMedio: "carrusel", urlJpeg, imagenRuta,
        diapositivas: [{ orden, urlJpeg, imagenRuta, ancho, alto, bytes, calidad, avisos, tiempos }], avisos, msRender, msTotal }
→ 422 { problemas: ["Imagen 2: …"] } (de todas las imágenes a la vez; si falla una, no se sube ninguna)
```

Un solo Chromium y `INSTAGRAM_RENDER_PARALELO` páginas a la vez (3 por
defecto, de 1 a 6; variable de Vercel opcional) que se reutilizan. Medido en
local (Windows, Chromium de Playwright): 6 imágenes en ~9 s (~1,5 s de
arranque). Se publica con `{ id }`.

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

## Qué cambia en los clientes

| Cliente hoy | Contrato final |
|---|---|
| Escritorio (`feat/instagram-crear`, `API_SERVIDOR`): `{ directo, dryRun: false, ids, caption, altTexts, fotosTmp, contenedorId? }` | **Igual.** Usar el `id` de la respuesta (el del carrusel) para lo que venga después. |
| Escritorio: `{ accion: "programar", ids, caption, altTexts, programarPara, confirmarConflicto }` | **Igual.** 200 con `programacion` o con `requiereConfirmacion`. |
| Móvil (`feat/instagram-movil`): render por imagen con `carrusel: { grupo, indice, total }` | Igual (la clave `carrusel` se ignora). |
| Móvil: `{ carrusel: { grupo, ids, altTexts }, caption, dryRun: false, fotosTmp }` | Vale tal cual (alias); mejor `{ ids, altTexts, caption, fotosTmp }`. |
| Móvil: `instagram_programar` con la primera imagen como portada | `instagram-publicar { accion: "programar", ids, … }` (con la primera imagen sola programaría un post). |
| Fotos `subida:<uuid>` en `tmp/<uuid>.jpg` | Se aceptan en el render. |

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
- `supabase/functions/instagram-publicar/__tests__/ids.test.ts`: el contrato con
  `ids` (montar el carrusel, id determinista, reintento sin duplicar, piezas que
  no se pueden juntar, alias del móvil y `accion: "programar"`).
- `supabase/functions/instagram-publicar/__tests__/carrusel.test.ts`: cliente
  (hijos, padre, error en un hijo → nada publicado), publicar sin prueba,
  textos alternativos, Drive, doble publicación en carrusel, programador y
  programar directamente.
