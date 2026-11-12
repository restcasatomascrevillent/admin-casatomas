# Instagram desde el móvil: publicar en un minuto

Pedido del dueño (05/11/2026): «subo seis fotos de producto fresco y la IA me
monta el carrusel; o una sola y sale un post». Asistente de 3 pasos a pantalla
completa, pensado para 375×812 y una mano (botones abajo, 48 px o más).

- **Dónde:** en `/instagram`, pestaña «Crear», cuando la pantalla mide menos de
  768 px (salvo que se abra una pieza desde Campañas o el Calendario, o se
  pulse «Usar el editor completo»). Y a pantalla completa, sin menú, en
  **`/instagram/rapido`**: es la dirección que hay que guardar en la pantalla
  de inicio del móvil (Safari: Compartir → «Añadir a pantalla de inicio»;
  Chrome: ⋮ → «Añadir a pantalla de inicio»). Permiso: sección Marketing.
- **Código:** `src/components/instagram/movil/` (`CrearMovil.tsx` y sus piezas),
  `src/pages/InstagramRapido.tsx`. Pruebas en `__tests__/` (sin red ni IA).

## Espacio en la pestaña «Crear» del móvil (05/11/2026)

Con el asistente a la vista (< 768 px) la página le deja todo el alto: sin la
fila «Las dos / CT / TZ · @cuenta» (el asistente tiene su selector y la cuenta
es el punto de color de su cabecera, `IndicadorCuenta compacto`), pestañas solo
con iconos (`PestanasPagina soloIconosEnMovil`, la etiqueta queda como nombre
accesible) y el asistente de borde a borde hasta abajo, con los botones fijos
dentro de la zona segura. Cabecera de una línea: «Paso 2/3 · Montar con IA» con
la barra de progreso. En el paso 1, «Editor completo» y «Pantalla completa»
(abre `/instagram/rapido`). Mientras la IA trabaja se ven las fotos elegidas en
gris con un brillo (quieto con «reducir movimiento»), los pasos y «Lo que me
has contado» (`MontandoPrevia.tsx`). Capturas y comprobaciones (sin scroll
horizontal, botón principal a la vista, textos ≥ 14 px) a 360×740, 375×812 y
390×844: `tests/e2e-movil/instagram-movil.capturas.mjs`.

## Los tres pasos

1. **Fotos.** «Hacer fotos o elegir del carrete» (`<input type="file"
   accept="image/*" multiple>` **sin** `capture`: con `capture` iOS y Android
   abren solo la cámara; sin él ofrecen cámara y carrete). «Hacer foto» sí
   lleva `capture="environment"` para ir directo a la cámara. También «De la
   carta» (platos con foto de la marca). De 1 a 10 fotos: miniaturas que se
   reordenan manteniendo pulsado y arrastrando (o tocando la foto → «Antes» /
   «Después»), y se quitan con la ✕. Marca (Casa Tomás / Touza) y «¿Algo que
   contar?» (opcional, se puede dictar con el micro del teclado).
   Cada foto se convierte en el móvil a JPEG (`convertirFoto`: orientación
   EXIF, ≤ 2560 px, sin GPS) **y se sube en cuanto se elige**, de 2 en 2.
2. **Montar con IA.** Llama a `instagram-ia` → `montar_pieza`
   (contrato en `src/lib/instagram/montar.ts`). Mensajes cortos mientras
   trabaja. Luego: carrusel que se desliza con el dedo (mismo HTML que el
   render del servidor), lo que ha entendido la IA, el texto editable (con los
   hashtags al final) y «Otra versión» / «Cambiar tono».
3. **Publicar.** «Publicar ahora» o «Programar · mañana a las 13:00» con la
   hora sugerida por la IA ya puesta (si no hay, la próxima 13:00 o 20:30) y
   «Hoy / Mañana / Otro día» + hora. Sin paso de prueba. Progreso «Preparando
   imágenes 3/6 → Publicando…» y, al acabar, «Ver en Instagram».

## Subida de fotos (rápida en el móvil)

Directa al bucket «instagram» como `tmp/<uuid>.jpg` con la sesión del usuario
(la política `instagram_objetos_insert_seccion` deja escribir a quien tiene
Marketing): un solo salto, sin pasar por la Edge Function ni por Drive. Es la
misma «copia preparada» que usan el render y `montar_pieza`, con id
`subida:<uuid>`. Si se corta, se reintenta con el **mismo** uuid (un «ya
existe» cuenta como subida). Las de la carta se preparan con `instagram-drive`
→ `preparar` (origen «carta»).

**Archivo en Drive DESPUÉS**: al publicar o programar, las fotos hechas con el
móvil se suben en segundo plano a la biblioteca de Drive de la marca
(`subirFotoDrive`, tipo «plato», descripción = «¿Algo que contar?» o el
resumen de la IA). Si falla, se avisa; la publicación no se toca.

## Red del móvil

- Las fotos (ya en JPEG), el orden, la marca, el texto y el montaje se guardan
  **en el propio móvil** (IndexedDB; si no hay, en memoria) hasta publicar. Al
  volver, «Hemos recuperado lo que dejaste a medias» (o «Empezar de cero»).
  Una copia `tmp/` de más de 20 h se vuelve a subir sola (el servidor las
  borra a las 24 h).
- Subidas y render con reintentos y espera creciente (`reintentos.ts`). Sin
  cobertura no se gastan intentos: se espera al evento `online` y aparece el
  aviso «Sin cobertura…».
- Si se cierra o recarga a mitad, el navegador pregunta (`beforeunload`); la
  ✕ de `/instagram/rapido` también.
- **Publicar NO se reintenta solo** (podría salir dos veces): el error se
  enseña con «Reintentar» y las imágenes ya generadas no se repiten.

## Cuota de IA

Solo se llama a la IA al pulsar «Montar con IA», «Otra versión» o un tono;
nunca en un efecto ni en bucle. Con las mismas fotos, marca y texto se
reutiliza el montaje (volver atrás y adelante no gasta). Tope de 6 montajes por
sesión del asistente (`MAX_MONTAJES_SESION`). Los errores de cupo (429) no se
reintentan.

## Contrato `prepararYPublicar(pieza, opciones)`

En `src/components/instagram/movil/publicar.ts` (detalle en su cabecera). La
pieza: `{ marca, formato, fotos: FotoParaMontar[], diapositivas, caption }`.
Opciones: `{ cuando: {tipo:"ahora"} | {tipo:"programar", instante}, api,
onProgreso, cache, signal }`. Valida (1–10 imágenes, post = 1, texto ≤ 2200, ≤ 30
hashtags, hora ≥ ahora + 10 min y ≤ 75 días), genera una imagen por
diapositiva (`api.renderizarImagen`, con reintentos y caché), y luego
`api.publicar` o `api.programar`. Devuelve `{ estado, piezaIds, permalink,
programadaPara, avisos }`. `crearApiPublicacionSimulada()` para pruebas.

Lo que la API real (`apiReal.ts`) espera del servidor:

| Paso | Llamada | Estado hoy |
|---|---|---|
| Render de cada imagen | `POST /api/instagram-render` `{ pieza, caption, fotoPreparada: {id, url, ancho, alto, tipo: null, marca}, carrusel?: {grupo, indice, total} }` → `{ id, urlJpeg }` | Hoy solo acepta fotos `drive:`/`carta:`; `subida:<uuid>` y `carrusel` los añade el servidor de carruseles. |
| Publicar post | `instagram-publicar` `{ id, caption, altText, dryRun: false, fotoTmp }` | Existe. |
| Publicar carrusel | `instagram-publicar` `{ carrusel: {grupo, ids, altTexts}, caption, dryRun: false, fotosTmp }` → `{ estado: "publicada", permalink }` | Pendiente del servidor de carruseles. |
| Programar | RPC `instagram_programar(p_pieza_id = 1.ª imagen, p_para, p_confirmar_conflicto = true)` | Existe para posts; para carruseles el servidor tiene que publicar el grupo de la portada. |

## Probar sin servidor

`<CrearMovil simulado />` usa `serviciosSimulados()`: subidas a object URLs,
carta de muestra, IA y publicación falsas, sin gastar nada.

## RRSS en el móvil, de punta a punta (12/11/2026)

Revisión de toda la sección `/rrss` por debajo de 768 px (tablet y escritorio, píxel a píxel iguales).
- **Redes abajo:** Instagram, Facebook, Subida y Métricas van en una barra inferior (`components/rrss/BarraRedesMovil.tsx`, 56 px, al alcance del pulgar). Se quita con el teclado abierto (`hooks/useTecladoAbierto.ts`).
- **Secciones de Instagram:** una sola fila de 48 px: botón «Estudio ▾» que abre una hoja inferior con las seis secciones y sus contadores (`instagram/SeccionesMovil.tsx`), más el filtro de marca; la cuenta conectada va en el pie de la hoja.
- **Estudio:** semana en tira con scroll horizontal y hoy centrado; fechas de la sugerencia resumidas («3 fechas esta semana», desplegable); cifras en filas sin gráfica.
- **Calendario** sin alto fijo y con «Filtros» plegado; **Encargos** con columnas a 86 % con imán; **Facebook** con «Publicar en Facebook · No conectado» plegado.
- **Regla global** `.rrss-movil` (src/index.css): controles ≥ 48 px y textos ≥ 14 px en toda la sección.
- Capturas: `tests/e2e-movil/rrss-movil.capturas.mjs <carpeta>` (mide scroll, controles bajos y letra pequeña).
