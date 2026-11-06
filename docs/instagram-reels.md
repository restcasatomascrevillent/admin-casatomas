# Reels en el panel (fase 5, sin MP4 todavía)

Montar un reel con las 5 bases del dueño (las de `instagram-studio/propuesta/marca-base`),
cambiar fotos, textos y duración de cada escena y verlo animado en vivo. El paso a MP4
es la fase 6 (ver «Qué falta» abajo). Diseño: `PROPUESTA.md` §5.1, §5.2, §5.6 y fila 5 de §7.

Esta fase **no** lleva migraciones ni toca Supabase, Meta ni Drive.

## Dónde está

| Qué | Fichero |
|---|---|
| Motor de tiempo (easing, `interpolate`, tiempos, 30 fps, zona segura) | `src/lib/instagram/reels/motor.ts` |
| Temas de color, textos fijos de cada marca, CTAs, `@font-face` | `src/lib/instagram/reels/marca.ts` |
| Esquema `ReelPieza` (zod/v4) y `validarReel` | `src/lib/instagram/reels/esquema.ts` |
| Las 5 bases (y la «libre») | `src/lib/instagram/reels/bases.ts` |
| Fotos: ids, muestras y resolver de URLs | `src/lib/instagram/reels/fotos.ts` |
| Operaciones puras del editor (añadir, quitar, mover…) | `src/lib/instagram/reels/edicion.ts` |
| `ReelEnInstante` / `pintarReelEnInstante` (el reel pintado en `t`) | `src/lib/instagram/reels/ReelKit.tsx` |
| `EditorReel`, `VistaPreviaReel`, `EstudioReel` | `src/components/instagram/reels/` |
| Fotos de muestra de las bases (29, 720 px de lado corto, 1,8 MB) | `public/instagram/reels/muestras/` |
| Pruebas | `src/lib/instagram/reels/__tests__/`, `src/components/instagram/reels/__tests__/` |

`src/lib/instagram/reels` va **aparte** de `src/lib/instagram/index.ts` porque usa React y
ese índice lo importan las funciones de Vercel.

## El motor: todo es función de `t`

- `pintarReelEnInstante(reel, t, opciones)` (o el componente `<ReelEnInstante reel t />`)
  devuelve el lienzo de **1080×1920** en el instante `t` (segundos). Es **puro**: sin
  estado, efectos, `Math.random`, `Date`, ni animaciones o transiciones CSS. Mismo
  `(reel, t)` → mismo DOM (probado con `renderToStaticMarkup` en todas las bases).
- La vista previa solo mueve `t` con `requestAnimationFrame`; la fase 6 fijará
  `t = n / 30` y capturará cada fotograma. Lo que se ve es lo que se renderizará.
- Es un port **fiel** de `reel-kit.jsx`: mismas curvas (`easeOutCubic`, `easeInOutCubic`,
  `easeOutBack` a través de `MOVIMIENTO.entrar/suavizar/saltar`), mismos tiempos de
  entrada de cada rótulo, mismas 9 transiciones, cierre, marco «premium» de Touza y
  fundido final. Las curvas de la web (`--ease-smooth`, `--ease-bounce`, `--ease-touza`
  de `tokens/motion.css`) están en `CURVAS_MARCA` y `entradaMarca()` para lo que el
  panel añada fuera del kit.
- Cambios a propósito respecto al original:
  - logo de Casa Tomás = `public/instagram/logos/casa-tomas-logo-blanco.png` (antes, el
    negro con `invert(1)`: se ve igual);
  - teléfono, @, dirección y «EST. 2023 · CREVILLENTE» salen de `DATOS_MARCA_REEL`
    (`marca.ts`), no de cada reel;
  - en el rótulo «letters» cada palabra va en un bloque que no se parte (el original
    podía cortar una palabra a media línea);
  - una escena sin foto pinta un hueco oscuro rotulado «Sin foto · <escena>».
- Colores: los de `reel-kit` (oro de Casa Tomás `#B6852F`, no el `#8e6725` de las
  imágenes; decisión abierta 2 de la propuesta). Fuentes: las de `public/instagram/fuentes`
  (sin Google Fonts ni unpkg).
- Reglas de vídeo: 30 fps, 9:16, zona segura 220 / 320 / 64 (`ZONA_SEGURA_REEL`; los
  rótulos van a 380-420 px del borde inferior y a 80 px de los lados, dentro).

## Esquema `ReelPieza`

```ts
{
  marca: "casa-tomas" | "touza",
  base: "bienvenido" | "del-mar" | "bodega" | "brasa" | "touza" | "libre",
  escenas: [{                      // de 1 a 15
    id, nombre, nota?,             // nota = qué foto pide la base
    duracion_s,                    // 1,5–10 s
    foto?,                         // "drive:<id>" | "carta:<id>" | "plato:<id>" | "muestra:<nombre>"
    encuadre: { pos: "50% 55%", origen?, zoom: [a, b], desplazamientoX?, desplazamientoY?, paneo? },
    transicion?,                   // cómo ENTRA (en la 1.ª no se usa)
    rotulo?: { estilo, antetitulo?, titulo?, sub?, alinear?, tamano? }
  }],
  cierre: { duracion_s /* 3–8 */, foto?, encuadre, transicion?, frase, tamanoFrase?, cta, datos? },
  transicion_s?: { entrada, salida },   // solape de transiciones (Touza: 1,3 / 1,5)
  salidaRotulo_s?                        // lo que tarda en irse cada rótulo (Touza: 1,0)
}
```

- **Duración total entre 5 y 90 s** (suma de escenas + cierre). Al cambiar una
  duración se mueven todos los cortes siguientes (`calcularTiempos`).
- Estilos de rótulo: `intro` (logo + antetítulo), `hook`, `label`, `mask`, `box`,
  `letters`, `pill`, `number`.
- Transiciones: el editor ofrece primero las **recomendadas** (`dissolve`, `zoom`, `rise`,
  `blur`: «sin transiciones llamativas») y aparte las **avanzadas** (`wipe`, `push`, `iris`,
  `flash`, `glass`), que usan las bases del dueño.
- CTA: lista cerrada (`CTAS_REEL`, las del readme). `datos` vacío = los de la marca.
- `validarReel(json, { medidasFoto? })` → `{ ok, reel, avisos }` o `{ ok: false, problemas, avisos }`:
  - **problemas** (bloquean): forma (zod), duración total, título > 5 palabras, emojis,
    estilo sin título, `pill`/`box` sin antetítulo, cifras largas en `number`, ids repetidos
    y **textos que se salen**: se estima el ancho de cada línea con el ancho medio de
    cada fuente y se reparte por palabras como el navegador; error si una palabra no cabe
    a lo ancho o si el texto pasa de las líneas del estilo (p. ej. 2 en `mask`, 1 en
    `number`). Es una regla rápida y algo conservadora; la medición exacta en el DOM
    será del render.
  - **avisos** (se puede seguir): escena sin foto, fotos de muestra, foto con lado corto
    < 2000 px (el zoom llega a ×1,9), rótulo que no termina de entrar antes de irse,
    cierre demasiado corto para leer CTA y datos, escena sin transición.

## Las 5 bases

`crearReelDesdeBase(base, marca?)` devuelve una **copia** (las bases son valores iniciales).

| Base | Marca | Escenas + cierre | Duración |
|---|---|---|---|
| `bienvenido` (Reel 01, pasado al kit) | Casa Tomás | 6 + cierre | 24 s |
| `del-mar` (Reel 02) | Casa Tomás | 5 + cierre | 20,5 s (615 fotogramas) |
| `bodega` (Reel 03) | Casa Tomás | 5 + cierre | 20,5 s |
| `brasa` (Reel 04) | Casa Tomás | 5 + cierre | 20,5 s |
| `touza` (Reel 05) | Touza | 6 + cierre | 32 s |
| `libre` | la que se pida | 2 + cierre | 11,5 s |

El Reel 01 tenía un componente propio (`reel-bienvenido.jsx`); ahora es la misma
`ReelKit` con estilos: Intro → `intro`, Sala → `mask`, Galicia → `box` (tamaño 110 %),
Vitrina → `letters` (82 %), Mesa → `pill`, Barra → `number`. Diferencias mínimas: los
tiempos de entrada de cada rótulo son los del kit (decenas de milisegundos) y los datos
del cierre van en Montserrat como en los demás reels.

Las bases traen **fotos de muestra** (`muestra:<nombre>`, las del dueño reducidas) para
que se vean como él las diseñó. Para el MP4 hay que cambiarlas por fotos de la biblioteca:
la validación lo avisa.

## Cómo integrarlo en la sección Instagram

Lo más sencillo es `EstudioReel` (editor + vista previa, lado a lado en apaisado y uno
encima del otro en vertical; ocupa el alto del padre, sin scroll de página):

```tsx
import { EstudioReel, crearReelDesdeBase, validarReel, type ReelPieza } from "@/components/instagram/reels";

const [reel, setReel] = useState<ReelPieza>(() => crearReelDesdeBase("del-mar"));

<div className="h-full min-h-0">
  <EstudioReel
    reel={reel}
    onChange={setReel}
    elegirFoto={async ({ marca, escena, nombre, nota, fotoActual }) => {
      // abrir la biblioteca (Drive o carta) filtrada por marca y, al elegir,
      // «preparar» la foto para tener su URL tmp/ del bucket:
      // return { id: "drive:<id>", url, ancho, alto }  — o null si se cancela
    }}
    urlFoto={(id) => urlsConocidas[id]}   // opcional: al reabrir un reel guardado
  />
</div>
```

Piezas sueltas, si se quiere otra maqueta:

- `EditorReel` — props: `reel`, `onChange(reel)`, `elegirFoto?(peticion)` →
  `FotoElegida | null` (síncrona o promesa), `onFotoElegida?(foto)` (para guardar su URL),
  `urlFoto?` (miniaturas), `seleccion?` / `onSeleccion?(indice)` (índice = nº de escenas
  → el cierre), `permitirCambiarBase?` (por defecto sí), `className?`. Escenas: añadir
  (detrás de la seleccionada), quitar (siempre queda una), reordenar arrastrando el asa
  (`ListaOrdenable`) o con flechas; foto, nombre, duración, transición, encuadre (zoom
  inicial y final, centro) y rótulo (estilo y textos según el estilo). Enseña la duración
  total, los problemas y los avisos.
- `VistaPreviaReel` — props: `reel`, `urlFoto?`, `baseRecursos?` (`"/instagram"`),
  `reproducirAlMontar?`, `bucle?` (sí), `zonaSeguraInicial?` (sí), `instanteInicial?`
  (1,5 s), `onInstante?(t)`, `className?`. `ref` → `{ irA(t), reproducir(), pausar() }`.
  Play/pausa, volver al principio, barra de tiempo con paso de un fotograma y zona
  segura conmutable, en un marco 9:16 que se escala al hueco.
- `pintarReelEnInstante(reel, t, { urlFoto, baseRecursos, zonaSegura, incluirFuentes, marcarHuecos })`
  — para el render futuro.

**Guardar**: el reel es JSON puro (sin URLs; solo ids de fotos), pensado para
`instagram_piezas.datos` con `tipo_medio = 'reel'` (columna de la fase 6). Antes de
guardar, `validarReel(reel).ok`.

**Las URLs de Drive** son copias temporales (`tmp/<uuid>`, se borran a las 24 h): no se
guardan en la pieza. Al reabrir un reel guardado hay que volver a «preparar» sus fotos y
pasar las URLs por `urlFoto`; mientras tanto se ve el hueco «Sin foto».

## Qué falta para el MP4 (fase 6)

> **Hecho** (salvo el archivo en Drive de los MP4 y la «Sugerir rótulos» del punto 6): ver
> [instagram-video.md](instagram-video.md). Lo de abajo queda como el plan original.

1. **Página de captura** `__reel-instagram.html?trabajo=<id>` que monte
   `ReelEnInstante` a 1080×1920 sin escala ni controles y exponga
   `window.__fijarTiempo(t)` (con `flushSync`) y `window.__listo()` (espera
   `document.fonts.ready` y `img.decode()` de todas las fotos).
2. **Trabajador Node** (Playwright + ffmpeg + ffprobe) que recorra `n = 0…fotogramas-1`,
   capture y pase los JPEG por tubería a `ffmpeg -f image2pipe` con los parámetros de la
   propuesta §5.4 (H.264 high, yuv420p, 30 fps, AAC, `+faststart`). Cola
   `instagram_trabajos_render`, cubo `instagram-video`, portada en un instante elegido.
3. **Medición exacta de textos** en el DOM capturado (los textos llevan `data-campo`)
   como `comprobarMaquetacion` de las imágenes, contra la zona segura.
4. **Fotos**: exigir fotos de la biblioteca (no muestras) y ≥ 2000 px de lado corto,
   preparadas en `tmp/` antes de lanzar el trabajo.
5. **Música** (pista con licencia, o silencio AAC), columnas nuevas de
   `instagram_piezas` (`tipo_medio`, `video_ruta`, `portada_ruta`, `duracion_s`, `bytes`),
   REELS en `cliente.ts`/`publicar.ts` y el estado `procesando`.
6. «Sugerir rótulos» con IA (fase 1) puede rellenar `rotulo` y `cierre.frase`.

## Riesgos y pendientes

- **Rendimiento de la vista previa**: los `blur()` y `backdrop-filter` de algunas
  transiciones son caros; en tablets modestas la reproducción puede ir a menos de 30 fps
  (solo en la vista previa; el render captura fotograma a fotograma).
- **Estimación de anchos**: es aproximada; textos muy al límite pueden pasar la regla y
  rozar el borde (o al revés). La medición en el DOM de la fase 6 lo cierra.
- **Fotos apaisadas**: con `object-fit: cover` en 9:16 se recorta mucho; usar `paneo`.
- **«Crevillente» / «Crevillent»**: el marco de Touza dice «Crevillente» como en el reel
  del dueño; el resto del material dice «Crevillent». Pendiente de decidir (se cambia en
  `DATOS_MARCA_REEL`).
- **Oro de Casa Tomás**: los reels usan `#B6852F` (el del dueño); las imágenes del panel,
  `#8e6725`. Decisión abierta 2 de la propuesta.
