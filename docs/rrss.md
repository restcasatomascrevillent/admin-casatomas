# RRSS: Instagram, Facebook y editor IA de fotos y vídeos

Sección **RRSS** del menú (ruta `/rrss`, 08/11/2026). Antes se llamaba
«Instagram». Mismo permiso: la sección `marketing` (y el mismo interruptor del
Super Admin). La agencia (`instagram_agencia` sin Marketing) solo ve
Instagram › Encargos.

| Pestaña | Qué hace | Código |
|---|---|---|
| **Instagram** | Todo lo de antes, sin cambios (Estudio, Crear, Campañas, Reels, Calendario, Encargos, Métricas). Ver [instagram.md](instagram.md). | `src/pages/Instagram.tsx` (`ContenidoInstagram`) |
| **Facebook** | Preparar contenido para Facebook con el mismo editor (formatos y textos de Facebook), guardar borradores, descargar y copiar. **No publica**: no hay integración con Facebook y la pantalla lo dice («No conectado»). | `src/components/rrss/facebook/FacebookRRSS.tsx` |
| **Subida de fotos** — *Editor IA de fotos y vídeos* | Subir fotos y vídeos, elegir destino, contenido y estilo, que la IA proponga la edición y el motor la haga de verdad; ajustar, regenerar una parte, guardar y descargar. Y «Dame ideas para grabar». | `src/components/rrss/editor/`, `src/components/rrss/ideas/` |

**Rutas antiguas**: `/instagram?…` redirige a `/rrss?red=instagram&…`
conservando `tab`, `encargo`, `pieza`… (marcadores, avisos y los enlaces de
`notificar-video` siguen funcionando). `/instagram/rapido` (acceso directo del
móvil) no cambia. `?red=instagram|facebook|editor` abre una pestaña y
`?trabajo=<id>` un trabajo del editor.

## La IA propone, el motor transforma

```
 Panel (navegador)                 Supabase                                   Vercel (Node)
 ─────────────────                 ────────                                   ─────────────
 1. sube los ORIGINALES ─────────► cubo privado «rrss» originales/<trabajo>/…
    (XHR con progreso)             rrss_archivos («subido»)
 2. «analizar» ───────────────────────────────────────────────────────────►  /api/rrss-foto | /api/rrss-video
                                   previas/…, hoja de contactos, audio ◄────  sharp (previa) · ffmpeg (medidas,
                                   rrss_archivos («listo», análisis)           duración, HDR, 9 fotogramas, audio 16 kHz)
 3. «Generar con IA» ────────────► Edge Function rrss-ia «proponer»
                                   ve previas y hojas (URL firmadas 15 min) ─► OpenAI (gpt-5.6-luna, Structured Outputs)
                                   normalizarPlan + validadores
                                   rrss_proyectos.plan / plan_ia / textos
 4. generar() ───────────────────► rrss_generaciones «pendiente»
                                   (índice único: una viva por trabajo)
    POST generar ─────────────────────────────────────────────────────────►  reclama (lease 6 min) → 202
                                                                               waitUntil: sharp / ffmpeg editan
                                   resultados/<trabajo>/<generación>/<n>.jpg|mp4 ◄─ y suben el resultado
                                   rrss_resultados (vigente), progreso ◄──────
 5. el panel sigue la fila cada 2 s (y la recupera al volver a la sección)
```

- **IA (rrss-ia, Supabase)**: devuelve un **plan** (números y textos), nunca
  un archivo. Contrato en `src/lib/rrss/plan.ts` (copia en
  `supabase/functions/_shared/rrss/`, que genera `node scripts/rrss/copiar-contratos.mjs`;
  un test falla si se separan).
- **Motor (Vercel)**: `api/rrss-foto.ts` (sharp + máscara IS-Net para lo
  creativo) y `api/rrss-video.ts` (ffmpeg estático de `ffmpeg-static`,
  300 s). Lógica en `api/_lib/rrss/` (`foto.ts`, `video.ts`, `trabajo.ts`,
  `http.ts`). Trabajan **como el usuario** (su JWT + clave pública: RLS),
  nunca con `service_role`. Responden 202 y siguen en segundo plano con
  `waitUntil` de Fluid compute; el estado vive en `rrss_generaciones`.
- **Sin IA**: si la IA no está disponible, el panel ofrece «Generar con la
  edición básica» (`planBasico`: estilo y encuadre centrado; vídeo con los
  clips en orden). El motor funciona igual.

### Fotos (sharp)

Orientación EXIF → niveles automáticos (opcional) → **encuadre** al formato
(centro x/y + zoom; `src/lib/rrss/geometria.ts`, la misma cuenta que la vista
previa) → [creativo] → **corrección + tratamiento del estilo** (brillo,
saturación, contraste con negros levantados, temperatura, nitidez) → viñeta →
**composición** del estilo (degradado, banda, bloque, cartel, mínimo, marco)
con **rótulos en las fuentes de marca** (Pango: Libre Baskerville en Casa
Tomás; Cormorant Garamond y Montserrat en TOUZA), **píldora del CTA** y
**logo** → JPEG sRGB 90 % 4:4:4 **sin metadatos** (se quitan GPS y datos del
móvil). Fuentes en TTF en `api/_lib/rrss/fuentes/` (OFL; convertidas de los
woff2 del panel, Pango no lee woff2); logos de `public/instagram/logos`.

### Vídeo (ffmpeg)

Una sola codificación: cada toma (fragmento `inicio–fin` de un clip, o una foto)
se recorta al formato, pasa de HDR a SDR si hace falta (zscale + tonemap),
va a 30 fps y recibe la corrección del estilo (`eq`, `colorbalance`,
`unsharp`, `vignette`); las fotos se mueven (zoompan: acercar, alejar,
paneo); transiciones `xfade` (fundido, deslizar, zoom) o cortes, también en el
audio (`acrossfade`); cierre opcional con el logo y la llamada a la acción;
**títulos y subtítulos con libass** y las mismas fuentes de marca; logo en la
esquina; `loudnorm`. Salida H.264 high 4:2:0 + AAC 48 kHz, `+faststart`, sin
listas de edición (lo que pide Meta para reels). Los **subtítulos** salen de
la transcripción de la voz del clip (rrss-ia «transcribir», whisper-1),
pasada al tiempo del vídeo final.

### Fidelidad

- La corrección es **suave** (±0,6 en exposición, contraste, saturación y
  temperatura; el estilo suma su carácter encima) y nunca cambia el contenido.
- **Cambiar o desenfocar el fondo** (`creativo`) modifica la escena: solo si el
  trabajo tiene marcado «Permitir transformaciones creativas». Si la IA lo
  propone sin permiso, `normalizarPlan` lo quita y avisa. El motor separa el
  producto con la misma máscara del recorte de la carta (etiquetas y platos
  quedan tal cual).
- Los textos pasan por `_shared/rrss/validar.ts`: sin precios ni promociones
  que no estén en las instrucciones del usuario, sin datos personales, sin
  alérgenos ni dietas, TOUZA sin reservas, sin emoji.
- **Los originales nunca se tocan** y nada se publica solo.

## Estilos

`src/lib/rrss/estilos.ts`: cada estilo son números (tratamiento por marca),
reglas de composición (tipo, tipografías, colores de marca, logo) y ritmo de
vídeo (segundos por plano, transición, movimiento). La vista previa del panel
(`previaCss`) y el motor usan los mismos valores.

| Estilo | Tratamiento | Composición | Vídeo |
|---|---|---|---|
| Elegante y gastronómico | contraste profundo, cálido, viñeta | degradado oscuro + titular con serifa | 3 s/plano, fundido |
| Natural y artesanal | luz cálida, negros mate | banda de papel + cursiva | 2,6 s, fundido |
| Moderno y dinámico | color vivo, contraste alto, nítido | bloque de color + mayúsculas | 1,4 s, deslizar |
| Promoción o evento | luminoso, vivo | cartel centrado + CTA | 1,8 s, zoom |
| Minimalista | limpio, color contenido | rótulo pequeño, sin caja (color según el fondo) | 3,2 s, fundido lento |
| Identidad de la marca | según la marca | marco de oro + medallón | 2,2 s, fundido |

## Formatos

`src/lib/rrss/formatos.ts`. Instagram: publicación y carrusel 1080×1350
(4:5), story y reel 1080×1920 (9:16, zona segura 250/320), pieza animada
1080×1350. Facebook: publicación 4:5, carrusel 1:1 (álbum), story y reel 9:16,
pieza animada 1:1.

## Instrucciones de la IA

`supabase/functions/rrss-ia/prompts.ts`, en tres capas que nunca se mezclan:

1. **Permanentes** (mensaje de sistema): `ORIENTACION` (la del dueño, tal cual)
   + `REGLAS` + la tarea. Para cambiar cómo trabaja la IA, se cambia ese
   fichero y se despliega la función.
2. **Datos del restaurante** (`<<<DATOS … DATOS>>>`): guía de la marca
   (`instagram_guias_marca`), nombres de la carta y de los vinos, formato,
   catálogo de estilos y descripción de los archivos (medidas, duración, voz
   transcrita, segundos de la hoja de contactos).
3. **Instrucciones del usuario** (`<<<USUARIO … USUARIO>>>`), anonimizadas
   (sin correos, teléfonos, DNI ni IBAN). Son preferencias: no pueden saltarse
   las reglas.

Acciones: `proponer` (plan completo), `pieza` (rehace solo una foto),
`textos` (solo el texto), `ideas` («Dame ideas para grabar»: idea, objetivo,
gancho, guion, planos con cómo grabarlos con el móvil, texto en pantalla, voz
en off, material, copy y CTA) y `transcribir` (voz de un clip).

## Base de datos y permisos

Migración `supabase/migrations/20261118100000_rrss.sql` (rollback en
`supabase/rollbacks/`; pruebas PGlite `npm run test:rrss:db`):
`rrss_proyectos`, `rrss_archivos`, `rrss_generaciones`, `rrss_resultados`,
`rrss_ideas`, `rrss_ia_peticiones` y el cubo **privado** `rrss` (50 MB por
archivo, el máximo del plan; rutas comprobadas por `rrss_ruta_valida`).

- Leer con «Ver» en Marketing; crear, subir, generar y usar la IA con
  «Editar». Sesión de panel viva y no bloqueada (también en el cubo).
- **Una generación viva por trabajo** (índice único): no hay duplicados aunque
  se pulse dos veces o haya dos pestañas. Una generación no vuelve a
  «pendiente» y solo se pueden cambiar sus columnas de estado.
- **Topes diarios** (día de Madrid, atómicos): 120 ediciones de fotos y 20
  vídeos por usuario; 40 vídeos entre todos (CPU de Vercel Hobby); 80
  peticiones a la IA por usuario.
- `rrss-ia` está en `ia_funciones` (costes en Super Admin › Servicios).

## Configuración pendiente y despliegue

Demo primero (`sfonaclosuafvlhutkon`); producción solo cuando el dueño acepte
el PR y lo pida.

1. Migración: `npx supabase db query --linked -f supabase/migrations/20261118100000_rrss.sql`
   (termina en «rrss: aplicada»).
2. Función: `npx supabase functions deploy rrss-ia --project-ref <ref>`
   (`verify_jwt = true` en `supabase/config.toml`). Usa `OPENAI_API_KEY`, que
   ya existe. Opcionales: `RRSS_IA_MODEL` (por defecto `gpt-5.6-luna`) y
   `RRSS_TRANSCRIPCION_MODEL` (`whisper-1`).
3. `update public.ia_funciones set instrumentada = true where funcion = 'rrss-ia';`
4. Vercel sale con el despliegue normal (`vercel.json`: `api/rrss-foto.ts`
   120 s con el modelo IS-Net; `api/rrss-video.ts` 300 s con el binario de
   ffmpeg). Diagnóstico sin sesión: `GET /api/rrss-foto` y `GET /api/rrss-video`
   (versión de ffmpeg, fuentes y logos en el bundle).

## Límites conocidos

- Archivos de hasta **50 MB** (límite del plan de Supabase): un vídeo 4K largo
  hay que recortarlo o grabarlo en 1080p. HEIC se convierte a JPEG en el
  navegador si sabe (Safari); si no, se pide «Más compatible».
- El vídeo se monta en una función de Vercel (≤ 300 s, 1 vCPU): pensado para
  piezas de hasta ~60 s con clips de móvil; los topes protegen la CPU del plan.
- La transcripción usa `whisper-1`: su coste va por minutos y `ia_uso` solo
  cuenta la llamada (sin importe).
- El cubo `rrss` no tiene limpieza automática: borrar un trabajo borra sus
  ficheros; los archivados se quedan.
- Facebook: sin integración de publicación (lo que haría falta está en la
  pestaña, en «Para Oficiosos»).
