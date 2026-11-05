# Instagram: fechas y campañas (fase 2)

La IA propone **campañas de 2 a 4 semanas** y **ideas para la semana** a partir de la carta, las novedades, las fechas señaladas (Galicia, temporada de producto gallego, Crevillent, Alicante y comerciales), lo que mejor ha funcionado en las métricas y la guía de cada marca.

**Lo hace una persona.** La IA solo propone. Una campaña se guarda como *propuesta*; al pulsar **«Aceptar y llevar al calendario»** las piezas marcadas se crean como **BORRADORES** con fecha prevista. Nada se programa ni se publica: eso sigue siendo el clic de siempre en «Crear» (generar la imagen, «Programar» o «Publicar»).

Diseño: `instagram-studio/propuesta/PROPUESTA.md`, apartados 3.1-3.6, 4.5 y fila «2» del apartado 7. Maqueta: pantallas «Campañas» y «Estudio» de `instagram-studio/propuesta/maqueta/`. Fase 1 (textos): [instagram-ia.md](instagram-ia.md). Calendario: [instagram-programar.md](instagram-programar.md).

## Piezas

| Pieza | Dónde |
|---|---|
| Migración | `supabase/migrations/20261109000000_instagram_campanas.sql`; rollback en `supabase/rollbacks/20261109000000_instagram_campanas_ROLLBACK.sql` |
| Edge Function | `supabase/functions/instagram-ia/`: `campanas.ts` (acciones `proponer_campana` e `ideas_semana`), `prompts-campanas.ts` (prompts y esquemas), `plantillas.ts` (ahora con formatos, foto y si sirve para campañas) e `ia.ts` (despacha las acciones nuevas) |
| Validadores | `supabase/functions/_shared/instagram/validar-campana.ts` (lógica pura; usa los de `validar-ia.ts`) |
| Panel | `src/components/instagram/campanas/`: `CampanasInstagram.tsx` (pestaña), `SugerenciaSemana.tsx` (para un futuro Inicio), `api.ts` y `logica.ts`. Calendario: `src/components/instagram/programar/` (borradores). Página: `src/pages/Instagram.tsx` |
| Pruebas | `supabase/functions/instagram-ia/__tests__/campanas.test.ts` y `validar-campana.test.ts`, `src/components/instagram/campanas/__tests__/` y `scripts/test-instagram-campanas.mjs` (PGlite) |

## En el panel

Pestaña **Campañas**, entre «Crear» y «Reels» (`/instagram?tab=campanas`). Sin scroll de página: desde `lg` cada columna hace scroll por dentro.

- **Izquierda**: las propuestas (título, marca, duración, fechas, piezas y estado) y el formulario: **«¿Qué quieres empujar?»** (texto libre, 500 caracteres como mucho; el servidor quita correos y teléfonos), marca, semanas (2, 3 o 4), día de inicio y piezas por semana. **«Proponer campaña»**.
- **Derecha**: la ficha. Objetivo, público y mensaje; la línea de tiempo con sus fases y un punto por pieza; y las piezas por fase, cada una con su casilla, fecha, hora, formato, plantilla, plato, «por qué» y **«Falta foto»** si la plantilla lleva foto y no hay una buena en la biblioteca.
  - **«Proponer de nuevo»** pide otra con lo mismo. La anterior se descarta solo cuando ya ha llegado la nueva.
  - **«Descartar»**.
  - **«Aceptar y llevar al calendario»**: solo las piezas marcadas. Cada una se crea como borrador (estado `borrador`, `origen = 'ia'`, `fecha_prevista` y `campana_id`) con la plantilla, el formato, la foto (si la hay), el antetítulo, el titular, el texto con los hashtags y el texto alternativo.
  - En una campaña aceptada se ven sus borradores con **«Abrir en Crear»**.
- **Calendario**: los borradores salen en su fecha prevista con **borde discontinuo** y la etiqueta «Borrador». Al pulsar uno se abre en «Crear» con sus datos. Si la pieza ya tiene una programación activa o está publicada, sale como tal y no como borrador.
- **Al abrir un borrador** (desde el calendario o desde la campaña), la página lee la pieza y la pasa a `EditorInstagram` (prop `abrir`, que usa el mismo `abrirPieza` del historial) y cambia a «Crear». A partir de ahí: elegir o pedir la foto, «Generar imagen», «Programar» o «Publicar».

`SugerenciaSemana` está hecho pero no montado (será para la pantalla de Inicio):

```tsx
import { SugerenciaSemana } from "@/components/instagram/campanas";

<SugerenciaSemana marca="casa-tomas" onCrear={(idea) => …} onVerCampanas={() => setPestana("campanas")} />
```

Enseña gratis (sin IA) las fechas señaladas de la semana (`marketing_fechas_entre`) y solo al pulsar **«Pedir ideas a la IA»** llama a `ideas_semana`. «Otra idea» pasa a la siguiente; «Crear» se la da a quien lo monte (no crea nada por sí solo).

## Contrato de la función

`POST /functions/v1/instagram-ia` con `Authorization: Bearer <JWT del panel>` y **Marketing en edición**, igual que `sugerir_texto`.

```jsonc
{ "accion": "proponer_campana", "marca": "casa-tomas",
  "desde": "2026-11-09",        // opcional: por defecto mañana; de hoy a +60 días
  "semanas": 3,                 // 2..4 (3)
  "piezasPorSemana": 3,         // 1..5 (3)
  "objetivo": "Llenar los mediodías de diciembre" }   // opcional, ≤ 500
```

Respuesta 200: `{ ok, accion, campanaId, sugerenciaId, modelo, versionGuia, campana: { titulo, objetivo, publico, mensaje, razonamiento, desde, hasta, fases[], piezas[{ fecha, hora, formato, plantilla, platoId, plato, foto, faltaFoto, antetitulo, titular, gancho, caption, hashtags, altText, porQue, fase, encargoSugerido, avisos[] }] }, descartadas[{ donde, motivos[] }], avisos[] }`.

```jsonc
{ "accion": "ideas_semana", "marca": "touza", "semana": "2026-11-12" }  // cualquier día: se toma su lunes; hasta 8 semanas vista
```

Respuesta 200: `{ ok, accion, sugerenciaId, desde, hasta, ideas[{ fecha, titulo, idea, motivo, formato, plantilla, platoId, plato, gancho, avisos[] }], fechas[], descartadas[], avisos[] }`.

Códigos como en la fase 1: 400 entrada, 401/403, 422 (nada pasó los validadores ni al reintento; trae `descartadas`), 429 (el **mismo** cupo diario: cuentan todas las acciones), 502 (OpenAI, la base de datos o no se pudo guardar la campaña) y 503 (falta la clave o la migración `20261109000000`).

### Qué recibe el modelo

Como datos, en el bloque `<<<DATOS … DATOS>>>`:

- La guía de la marca.
- El contexto de la RPC `instagram_ia_contexto(marca, desde, hasta)`:
  - la carta activa de la marca, con los `featured` primero: id, nombre, categoría, descripción (160 caracteres) y si tiene foto. **Sin precios y sin alérgenos** (los alérgenos se usan solo para validar);
  - las novedades activas del periodo (solo Casa Tomás: la tabla es de la web del restaurante);
  - las fechas señaladas del periodo;
  - las fotos de la biblioteca (`instagram_fotos` con Drive): id, tipo y descripción;
  - el resumen de métricas de 90 días: por formato, plantilla, tipo de foto, día y franja de 2 horas, con tasa de interacción y guardados por alcance. Solo publicaciones que salieron del panel;
  - los ganchos de las 15 últimas piezas, para no repetirse.
- Las plantillas de la marca que sirven para campañas (formatos, si llevan foto y límites). `tz-tipografica` no: necesita la lista de cócteles con precios.
- Lo que se quiere empujar, ya anonimizado.

**No recibe nunca** reservas, clientes, teléfonos, correos, facturas ni conversaciones. La RPC es `SECURITY INVOKER`: cada tabla se lee con la RLS del usuario.

### Validadores

En `_shared/instagram/validar-campana.ts`, después del modelo y antes de devolver o guardar nada. Son los **mismos** de la fase 1 (`validar-ia.ts`) más estas reglas:

| Regla | Qué pasa |
|---|---|
| `plato_id` que no está en la carta activa de la marca (los platos van **solo por id**) | **Descarta** la pieza |
| Nombre de un plato concreto que no está en la carta, en cualquier texto | **Descarta** la pieza (o la campaña, si está en el título, el objetivo…) |
| TOUZA con «reservar», «reserva»… en cualquier texto (título, objetivo, mensaje, por qué, encargo, rótulos, texto o hashtags) | **Descarta** la pieza o la campaña |
| Emoji en cualquier texto | Se **quitan** y se avisa |
| Fecha fuera de la campaña (o de la semana) o que no existe | **Descarta** la pieza |
| Hora no válida | Se pone 13:00 y se avisa |
| Plantilla de otra marca, o formato que la plantilla no admite | **Descarta** la pieza |
| Foto que no está en la biblioteca, o de la carta sin foto | Queda como **«falta foto»** y se avisa |
| Precio, alérgenos, dietas, datos personales, límites de Instagram y de la plantilla (titular de 6 palabras como mucho…) | Igual que en la fase 1 |
| Fases fuera del rango | Se recortan |
| Menos de la mitad de las piezas pedidas (y menos de 2) | **Descarta** la campaña |

Si la campaña se descarta, se pide **una vez más** al modelo con los motivos. Si vuelve a fallar, 422.

La RPC `instagram_aceptar_campana` vuelve a validar cada pieza al aceptar: fecha dentro de la campaña, hora, formato, plantilla de la marca, foto `drive:`/`carta:` y longitudes. No se fía del JSON guardado.

### Modelo, clave y coste

Los mismos que la fase 1: `claveOpenAI("otros")` (secreto `OPENAI_API_KEY`), `gpt-5.6-luna` (o `INSTAGRAM_IA_MODEL`), Structured Outputs, `AcumuladorUso` y `registrarUso()` en el `finally`.

- `max_completion_tokens`: 8000 en campañas y 2500 en ideas.
- Disparador: `campana:<uuid>` si la campaña se guardó; si no, `usuario:<uuid>`.
- Coste estimado: unos 0,007 $ por campaña de 3 semanas y unos 0,002 $ por ideas (apartado 3.3 de la propuesta, tarifa **sin verificar hoy**).

## Base de datos

Migración `20261109000000_instagram_campanas.sql`:

- **`marketing_fechas`**: fechas señaladas. Cada fila es anual (con el año 2000 y repetida cada año; si `hasta` es anterior a `desde`, cruza el año, como el marisco de septiembre a abril) o de un año concreto.
  - Se siembra con 28 fechas de Galicia, temporada de producto gallego, Crevillent, Alicante y comerciales.
  - Columna **`verificacion`**: `verificada` solo en fechas de calendario fijas o calculadas. La Pascua de 2027 cae el 28/03 (cómputo gregoriano): Semana Santa del 21 al 28 de marzo, Entroido del 6 al 9 de febrero. El Día de la Madre de 2027 es el 2 de mayo.
  - Van **«sin verificar»** las fiestas locales (Moros y Cristianos y fiestas patronales de Crevillent, Fogueres, Festa do Marisco, Magosto) y todas las temporadas de producto. **Las tiene que confirmar el dueño.**
  - La IA no escribe el día exacto de una fecha «sin verificar».
  - Marketing la lee; Marketing en edición añade y cambia (activar, desactivar, corregir, marcar como verificada). Nadie del panel borra. Volver a aplicar la migración no pisa lo editado.
  - Las fechas de un año (Semana Santa, Entroido, Día de la Madre) hay que añadirlas cada año.
- **`instagram_campanas`**: marca, título, objetivo, público, mensaje, razonamiento, petición (anonimizada), `desde`/`hasta` (31 días como mucho), estado (`propuesta` → `aceptada` | `descartada`; `en_curso` y `cerrada` quedan para más adelante), la propuesta validada (`jsonb`), la sugerencia, el modelo y quién decidió.
  - La inserta la función con el JWT del usuario y nace siempre como `propuesta` (trigger).
  - Aceptar y descartar, **solo por RPC**: `authenticated` no tiene UPDATE ni DELETE.
- **Borradores con fecha prevista: columnas en `instagram_piezas`, no una tabla aparte.** Columnas `fecha_prevista`, `campana_id` y `origen` (`manual` | `ia` | `encargo`). Por qué:
  - un borrador de campaña **es** una pieza: se abre en el editor, se genera, se prueba y se programa por el camino de siempre, que ya trabaja sobre `instagram_piezas`;
  - la programación va en tabla aparte (`instagram_programaciones`) porque tiene bloqueo, intentos e historial, y porque un estado «programada» en la pieza se pisaría al regenerar. La fecha prevista no tiene nada de eso y nadie la reescribe al cambiar el estado;
  - así lo prevé el apartado 3.6 de la propuesta.

  `origen` y `campana_id` solo los pone el servidor (trigger `instagram_piezas_proteger_campana`). Desde el panel una pieza nueva es siempre `manual`. `fecha_prevista` sí se puede mover.
- **`instagram_sugerencias_ia.tipo`** admite `proponer_campana` e `ideas_semana`.
- **RPC**:
  - `marketing_fechas_entre(desde, hasta, marca)`;
  - `instagram_ia_contexto(marca, desde, hasta)` (62 días como mucho);
  - `instagram_aceptar_campana(campaña, piezas[])`: crea los borradores, **nunca programa**;
  - `instagram_descartar_campana(campaña)`.

  Las dos últimas son `SECURITY DEFINER`, con Marketing en edición y sesión de panel viva.
- Las dos tablas nuevas llevan RLS de Marketing, la política restrictiva `acceso_panel_no_bloqueado` y triggers de auditoría. anon, nada.

## Desplegar (demo primero)

Desde la raíz del repo (`admin-casatomas/`). **Nunca `db push`.** Producción (`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí» del dueño.

```bash
# 1. Migración. Necesita 20261105090000_instagram.sql y 20261108000000_instagram_ia.sql.
#    Las métricas, las fotos y la programación son opcionales (si faltan, el contexto va sin ellas).
#    Tiene que terminar en «instagram_campanas: aplicada».
npx supabase db query --linked -f supabase/migrations/20261109000000_instagram_campanas.sql

# 2. Función: hay que VOLVER A DESPLEGAR instagram-ia (ia.ts, campanas.ts, prompts, plantillas y validadores).
#    No hay secretos nuevos: usa OPENAI_API_KEY y, si están, INSTAGRAM_IA_MODEL e INSTAGRAM_IA_CUPO_DIARIO.
npx supabase functions deploy instagram-ia --project-ref sfonaclosuafvlhutkon
```

3. El panel se publica con Vercel al subir a `staging`, como siempre.

Orden recomendado: migración → función → panel. Si el panel llega antes que la migración, la pestaña «Campañas» dice que falta la migración y el calendario sigue funcionando sin borradores. Si la función llega antes, las acciones nuevas responden 503.

Comprobación en la demo:

1. «Campañas» → «¿Qué quieres empujar?»: «setas y cocido de noviembre», Casa Tomás, 3 semanas → «Proponer campaña». Tiene que salir una campaña sin emoji ni precios, con piezas en noviembre y alguna «Falta foto» si la biblioteca no tiene la foto.
2. Desmarca una pieza y pulsa «Aceptar y llevar al calendario». En «Calendario» salen los borradores con borde discontinuo y **ninguna programada nueva**:
   ```sql
   select count(*) from instagram_programaciones where created_at > now() - interval '10 minutes';  -- 0
   select estado, origen, fecha_prevista, campana_id from instagram_piezas where campana_id is not null order by fecha_prevista;
   ```
3. Pulsa un borrador del calendario: se abre en «Crear» con sus rótulos, foto y texto.
4. Touza: pide una campaña. Ningún texto puede decir «reservar».
5. Coste: `select disparador, coste_usd from ia_uso where funcion = 'instagram-ia' order by created_at desc limit 5;` (disparador `campana:<uuid>`).
6. Revisa las fechas «sin verificar»: `select clave, titulo, desde, hasta from marketing_fechas where verificacion = 'sin verificar' order by ambito, desde;`. Las confirmadas se marcan con `update marketing_fechas set verificacion = 'verificada', desde = …, hasta = … where clave = …;`.

Deshacer:

1. Retira primero el panel.
2. Vuelve a desplegar la versión anterior de `instagram-ia`.
3. Ejecuta el rollback. **Borra** las fechas y las campañas; los borradores se quedan como piezas normales, sin fecha prevista.

## Pruebas

```bash
npx vitest run supabase/functions/instagram-ia src/components/instagram/campanas src/components/instagram/programar   # sin red; OpenAI simulado
npm run test:instagram-campanas:db                                                                                     # PGlite: tablas, RLS, siembra, contexto, aceptar, rollback
```

- **Función**:
  - plato inexistente, TOUZA con «reservar» y fechas fuera de rango, que se bloquean;
  - el reintento y el 422;
  - la foto que no está en la biblioteca, que queda como «falta foto»;
  - los emoji, que se corrigen;
  - el contexto sin precios, alérgenos ni datos personales;
  - el guardado de la campaña;
  - el disparador `campana:<uuid>`;
  - el cupo, la migración sin aplicar y el fallo al guardar.
- **Componente**:
  - la ficha;
  - aceptar manda solo las piezas marcadas y nunca programa;
  - «¿Qué quieres empujar?» llega a la IA;
  - «Proponer de nuevo» descarta la anterior solo después;
  - el 422 con sus motivos;
  - los borradores de una campaña aceptada;
  - `SugerenciaSemana`;
  - los borradores en el calendario.
- **PGlite**:
  - aceptar crea borradores con fecha prevista en hora de Madrid y **ninguna programación**;
  - las validaciones al aceptar y descartar;
  - la RLS;
  - el panel no puede falsear `origen` ni `campana_id`;
  - el contexto (carta sin precios, métricas por franja y tipo de foto, nada de reservas);
  - `marketing_fechas_entre`, incluidas las fechas que cruzan el año;
  - el rollback.

## Límites conocidos

- La pantalla de **Inicio** no existe aún: `SugerenciaSemana` está listo para montarlo.
- **Encargos**: `encargoSugerido` solo se enseña. El botón «Encargar a Oficiosos» llegará con la fase 4.
- Las piezas son de imagen (post o story). Los reels y los carruseles de la maqueta quedan para las fases 5-7.
- Arrastrar un borrador a otra fecha en el calendario no está hecho. La fecha prevista se cambia hoy por SQL o volviendo a aceptar otra campaña.
- Detectar platos inventados sigue siendo heurístico (ver [instagram-ia.md](instagram-ia.md)). Con el id obligatorio, el plato de cada pieza siempre existe; un nombre suelto en el texto se comprueba contra la lista de platos conocidos.
- Las fechas locales y de temporada están **sin verificar**: las confirma el dueño.
- Los tipos de `src/integrations/supabase/types.ts` no incluyen las tablas ni las RPC nuevas: se usan sin tipos, como en la fase 1.
