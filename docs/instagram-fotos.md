# Instagram · Fotos subidas desde el panel

Complemento de [instagram.md](instagram.md). Desde el 05/11/2026 la biblioteca de fotos de las piezas
tiene dos orígenes:

1. **Catálogo estático** (`src/lib/instagram/fotos.ts` → `FOTOS`), que sube
   `scripts/instagram/subir-recursos.mjs` a `fotos/<marca>/<nombre>.jpg`.
2. **Fotos subidas por los usuarios** desde Marketing › Instagram › «Subir foto»: tabla
   `public.instagram_fotos` + fichero `fotos/<marca>/subidas/<uuid>.jpg` en el bucket «instagram».
   El id de la foto (lo que guarda la pieza en `datos.foto`) es el uuid de la fila.

## Cómo se usa

- En el selector de fotos, botón **«Subir foto»**. Acepta JPEG, PNG y WebP; HEIC/HEIF solo si el
  navegador sabe abrirlo (Safari sí; Chrome y Firefox, no). Si no: «Este formato no se puede leer
  en este navegador; expórtala como JPEG».
- El navegador la prepara (nada pesado en el servidor): orientación EXIF aplicada
  (`createImageBitmap(…, { imageOrientation: "from-image" })`), lado mayor ≤ 2560 px (nunca amplía),
  canvas sRGB con fondo blanco → JPEG calidad 0,9. Si pasa de 8 MB baja la calidad hasta 0,7; si aun
  así no cabe, la rechaza. Al recodificar se pierden los metadatos EXIF (también la ubicación GPS).
- Vista previa con las medidas reales y si sirve para **post 1080×1350** y **story 1080×1920**, con
  la misma regla que `esAptaPara`/`validarPieza` (cubrir ampliando ≤ 5 %). Si no sirve para ninguno,
  avisa («Es pequeña: no sirve a sangre en post ni story») pero deja subirla.
- Campos: marca (por defecto la de la pieza), tipo (`TIPOS_FOTO` en español; por defecto el primero
  que admite la plantilla) y descripción corta (≤ 140).
- Se sube con el cliente de Supabase del usuario (RLS) y se guarda la fila; si la fila falla, se
  borra el fichero. La foto aparece en la cuadrícula marcada «Subida» y queda elegida (si es de la
  marca de la pieza).
- **Borrar**: papelera en las fotos subidas (las del catálogo estático no se borran). Pide
  confirmación y avisa si alguna pieza guardada la usa (deja borrar igualmente). Borra la fila y
  luego el fichero.

## Código

| Qué | Dónde |
|---|---|
| Fila → `Foto`, catálogo combinado, ruta, límites, nombres de tipo | `src/lib/instagram/fotos.ts` (`fotoDesdeFila`, `combinarCatalogo`, `rutaFotoSubida`, `NOMBRE_TIPO_FOTO`) |
| URL por `ruta` con catálogo | `urlFoto(base, id, fotos)` (`recursos.ts`), `construirDocumento(…, { fotos })` |
| Validación | `validarPieza(json, { fotos })` (sin `fotos`, el catálogo estático: no cambia nada) |
| Hook | `src/components/marketing/instagram/useFotosInstagram.ts` (`useFotosInstagram(marca, formato?)` → `{ fotos, catalogo }`) |
| Conversión en el navegador | `convertirFoto.ts` |
| Subir / borrar (Storage + tabla) | `fotosSubidas.ts`, `SubirFotoDialog.tsx`, `SelectorFoto.tsx` |
| Render en el servidor | `api/_lib/instagram/fotos.ts` (`catalogoParaPieza`): si `pieza.foto` no está en `FOTOS` y es un UUID, la busca en `instagram_fotos` por PostgREST con el JWT del usuario y la añade al catálogo con el que valida y construye el HTML. |

## Base de datos

Migración `supabase/migrations/20261105120000_instagram_fotos.sql` (después de
`20261105090000_instagram.sql`). Rollback en `supabase/rollbacks/20261105120000_instagram_fotos_ROLLBACK.sql`.

- `ruta` tiene que ser exactamente `fotos/<marca>/subidas/<id>.jpg` (CHECK): una fila no puede
  apuntar a otro fichero del bucket.
- `ancho`/`alto` entre 1 y 2560; `tipo` en `TIPOS_FOTO`; `descripcion` ≤ 140.
- `subida_por` = `auth.uid()` (no se falsea); al editar solo cambian `tipo` y `descripcion`.
- RLS: leer con `can_read_section('marketing')`; subir, editar y borrar con
  `can_write_section('marketing')`; usuarios bloqueados fuera (`acceso_panel_no_bloqueado`); anon nada.
  Se audita (`trg_auditoria`).
- El bucket ya admitía `image/jpeg|png|webp` y 8 MB; sus políticas (sección marketing) ya cubren
  `fotos/<marca>/subidas/`.

Pruebas: `npm run test:instagram:db` (PGlite, sección 6), y vitest:
`src/lib/instagram/__tests__/fotosSubidas.test.ts`,
`src/components/marketing/instagram/__tests__/{convertirFoto.test.ts,SubirFoto.test.tsx}`,
`api/_lib/__tests__/instagramFotos.test.ts`.

## Límites conocidos

- HEIC solo donde el navegador lo decodifica (Safari). En Chrome/Firefox hay que exportarla a JPEG.
- Fotos de más de ~16 000 px de lado pueden no decodificarse en algunos navegadores (límite del
  canvas/memoria del dispositivo).
- Una foto subida que use una pieza ya generada se puede borrar: el JPEG ya generado sigue, pero
  la pieza no se podrá volver a generar sin elegir otra foto.
- Las piezas publicadas en Instagram no dependen de la foto (Instagram guarda su copia).
