# Instagram: story del jueves de tapas (12/11/2026)

Pedido del dueño: «Hoy es día de tapas: que se suba la historia a Instagram con
las tapas cuando estén las tapas. Te paso la que hacen ahora. Hay que mantener
las plantillas que tienen ahora y mejorarlas.»

## Plantillas (solo story 1080×1920, papel «anuncio»)

| Plantilla | Qué es |
|---|---|
| `ct-tapas-clasica` | Réplica de la story que publican hoy (`instagram-studio/propuesta/referencias-actuales/story-jueves-de-tapas.jpg`): sala oscurecida y desenfocada, logo blanco, «Jueves» en oro claro, «DE TAPAS», filete oro y las tapas en blanco, sin precios, en Montserrat. |
| `ct-tapas` | La mejorada: Libre Baskerville y el oro oficial, velo pizarra más denso (contraste), fecha («Jueves / 12 de noviembre»), «— DE TAPAS —», todo dentro de la zona segura de la marca (220 arriba, 320 abajo, 64 a los lados) y pie con los turnos («Turnos 20:30 y 22:00», de `configuracion_turnos.horas_fijas` del jueves). |

- Código: `src/lib/instagram/plantillas/ct-tapas/index.ts` (copia en el
  servidor: `supabase/functions/instagram-ia/plantillas.ts`, test de igualdad).
- La lista se ajusta sola de 4 a 10 tapas (`medidasTapas`); si no cabe a un
  tamaño legible, `problemasTapas` lo dice antes de generar nada.
- El papel «anuncio» no sale en los selectores de Crear ni lo elige la IA.
- Comparar: `instagram-studio/propuesta/evaluacion/tapas/` (las dos con las 7
  tapas de la captura junto a `referencia-actual.jpg`, y con 4 y 10). Se
  rehacen con `INSTAGRAM_CAPTURAS_TAPAS=<carpeta> npx vitest run src/lib/instagram/__tests__/tapas.render.test.ts`.

## Automático

```
Gestión web › Tapas «Guardar»  ─┐                     (sesión de quien guarda; sin esperar)
Interruptor «Tapas» encendido ──┴─► asegurarStoryTapas (src/components/instagram/tapas/storyTapas.ts)
   ajustes activos + «Tapas» en la web + día no pasado + tapas que caben
   RPC instagram_story_tapas_reclamar(fecha, huella)   → crear | regenerar | nada  (cerrojo 3 min)
   [regenerar: cancela la programación]  /api/instagram-render (MISMA pieza)  RPC instagram_programar
   RPC instagram_story_tapas_registrar  → fila de la semana + aviso en la campana
```

- **Cuándo**: al guardar unas tapas con «Tapas» activo en la web, o al
  encender «Tapas» (coge las de hoy o las siguientes guardadas).
- **Hora**: la de los ajustes (12:00 de Madrid) del día de las tapas; si ya
  ha pasado, dentro de 15 min. Al regenerar se mantiene la hora que tenía
  (también si se cambió a mano).
- **Una por semana**: tabla `instagram_story_tapas` (clave = lunes). Publicada
  → nunca otra (ni a mano). Cancelada → el automático no la rehace; el botón
  manual sí. Siempre la misma pieza por semana (y `instagram-publicar` no
  publica dos veces una pieza).
- **Si cambian las tapas** antes de publicarse, se regenera sola (huella de
  fecha + tapas).
- **Aviso en la campana** (`notificaciones_dashboard`, tipo
  `instagram_story_tapas`, uno por semana): «Ver», «Publicar ahora»,
  «Cambiar hora» y «Cancelar».
- **Ajustes**: RRSS › Instagram › **Ajustes**: interruptor «Story automática
  del jueves de tapas» (activado), hora, plantilla (mejorada o la de siempre),
  foto de fondo de la biblioteca (Drive, carta o subida; por defecto el salón,
  `ct-salon-5`) y cómo va la de esta semana. Al lado, «Lo que publicáis ahora»
  (ver [instagram.md](instagram.md), «Referencias»).
- **Botón manual**: «Crear story de Instagram» bajo las tapas del editor:
  vista previa, plantilla, foto, hora, «Programar» o «Publicar ahora».
- **Permisos**: hace falta «Editar» en Marketing (render, programar y las
  RPC). Sin él, guardar las tapas funciona igual y la story no se crea (en
  silencio).

## Base de datos

Migración `supabase/migrations/20261127090000_instagram_story_tapas.sql`
(rollback en `supabase/rollbacks/`; pruebas PGlite
`npm run test:instagram-story-tapas:db`): `instagram_story_tapas_ajustes`
(fila única), `instagram_story_tapas` (una por semana) y las RPC
`instagram_story_tapas_reclamar | _registrar | _fallo | _cancelar | _ver`.
Leer: «Ver» en Marketing. Escribir: ajustes con «Editar»; la tabla de la semana,
solo por las RPC.

## Desplegar (demo primero)

1. `npx supabase db query --linked -f supabase/migrations/20261127090000_instagram_story_tapas.sql`
   (termina en «instagram_story_tapas: aplicada»).
2. Ninguna Edge Function nueva para el automático (usa `/api/instagram-render`
   de Vercel, `instagram_programar` y el programador de siempre).
   `instagram-estado` sí, por «Lo que publicáis ahora».
