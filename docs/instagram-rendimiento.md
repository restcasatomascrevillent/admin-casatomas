# Instagram: qué se pide al abrir /instagram (rendimiento)

Medido el 07/11/2026 sobre `staging` (793e1e2d) y la rama `feat/instagram-rapidez`.
Tiempos razonados con el código: arranque en frío de una Edge Function de 1 a 3 s,
cada llamada a Meta o a Google de 0,3 a 1 s y cada consulta PostgREST de 0,1 a 0,3 s.
Tamaños: `npm run build`, sumando el chunk de la página y todo lo que importa de forma
estática (sin `main`, `index` ni `vendor-*`, que ya están cargados en el panel).

## Antes

Al abrir `/instagram` (pestaña «Estudio», escritorio):

| # | Quién la pide | Qué es | Servicio externo | Cascada | Se repite en | Coste estimado |
|---|---|---|---|---|---|---|
| 0 | La ruta | JS de la página: **1.006 kB** (314 kB gzip), con los gráficos de Métricas (recharts, 366 kB), Reels, Crear, CrearMovil, Calendario, Campañas y Encargos | — | Todo lo demás espera a que se descargue y se ejecute | — | 1-3 s en la tablet |
| 1 | `IndicadorCuenta` (barra) | Edge Function `instagram-estado` | **Meta** (debug_token, perfil, cuota, páginas) y **Google Drive** | — | Diálogo «Conexión» | 1-3 s + 4×0,3-1 s → «Comprobando…» 2,5-7 s |
| 2 | Estudio, cifras (`useMetricasInstagram`) | Edge Function `instagram-metricas` («leer») | — (5 lecturas + piezas + fotos: 3 rondas de BD) | Dentro de la función, 3 rondas seguidas | Métricas | 1-3 s + 0,5-1 s → «Cargando cifras…» |
| 3 | Estudio, semana y próximas (`useCalendarioInstagram`) | 3 PostgREST en paralelo (programaciones, publicadas, borradores) | — | — | Calendario (otro rango) | 0,3 s |
| 4 | Estudio, encargos (`useEncargos`) | PostgREST `instagram_encargos` | — | **Esperaba a los permisos** (`useRolesEncargos`) | Contador de la pestaña, Encargos | 0,3 s + lo que tarden los permisos |
| 5 | Página, contador de Campañas | PostgREST `instagram_campanas` | — | **Esperaba a los permisos** | Campañas | 0,3 s |
| 6 | Sugerencia de la semana | RPC `marketing_fechas_entre` | — (la IA ya iba solo al pulsar) | — | — | 0,2 s (spinner) |
| 7 | «Crear» montada aunque no se vea | Edge Function `instagram-drive` («listar») + PostgREST `Platos` y `Vinos` | **Google Drive** | — | Crear | 1-3 s + 0,3-1 s, compitiendo con lo anterior |

En el móvil, en lugar del 7, el asistente `CrearMovil` también se montaba escondido.

Volver al Estudio desde otra pestaña lo desmontaba y volvía a montar: cifras y
calendario sin `staleTime` (30 s por defecto) y caché de 5 min → otra vez «Cargando…».

## Después

| # | Qué se pide al abrir | Servicio externo | Cascada | Coste estimado |
|---|---|---|---|---|
| 0 | JS de la página: **263 kB** (90 kB gzip): Estudio, barra y pestañas (sin su contenido) | — | — | 4 veces menos |
| 1 | Indicador: **nada**. Pinta la última cuenta comprobada (caché de TanStack Query o `localStorage`, 45 min; luego el @usuario en gris). `instagram-estado` solo al abrir el diálogo «Conexión con Instagram» o con su botón «Comprobar» | — | — | 0 s |
| 2 | Cifras: **1 PostgREST** a `instagram_metricas_cuenta` (RLS de marketing), mismo cálculo que la función | — | — | 0,2 s |
| 3 | Calendario: 3 PostgREST en paralelo (igual) | — | — | 0,3 s |
| 4 | Encargos: 1 PostgREST, **a la vez** que lo demás (la RLS filtra; solo se para si ya se sabe que no tiene permiso) | — | No | 0,3 s |
| 5 | Campañas: 1 PostgREST, a la vez | — | No | 0,3 s |
| 6 | Fechas de la semana: 1 RPC, guardada 1 h; la IA solo al pulsar | — | — | 0,2 s |
| 7 | Crear: **nada** hasta abrir la pestaña (luego se queda montada para no perder lo que se edita) | — | — | 0 s |

En total: **0 Edge Functions y 0 llamadas a Meta o Google** al abrir; 7 consultas
PostgREST en una sola ronda. Mientras llegan se ven esqueletos grises con la forma
de cada bloque (no «Cargando…» con spinner).

Caché: calendario y encargos 1 min frescos, cifras 5 min, fechas 1 h; todo se guarda
30 min (las fechas, 2 h). Al montarse, la página pide por adelantado todo lo del
Estudio (`prefetchEstudio`, mismas claves): volver al Estudio desde cualquier pestaña
pinta al momento y refresca por detrás. Al cambiar de marca, las cifras anteriores se
ven hasta que llegan las nuevas (`placeholderData`).

## Paquetes por pestaña (se descargan la primera vez que se abren)

| Pestaña | Chunk |
|---|---|
| Crear (escritorio) | `CrearInstagram` 48 kB |
| Crear (móvil) | `CrearMovil` 58 kB |
| Campañas | `CampanasInstagram` 19 kB |
| Reels (motor incluido) | `PestanaReels` 38 kB (+ ReelKit) |
| Calendario | `CalendarioInstagram` 19 kB |
| Encargos | `EncargosInstagram` 27 kB |
| Métricas (gráficos) | `MetricasInstagram` 22 kB + recharts 366 kB |
| Diálogo «Conexión» | `ConexionInstagram` 9 kB |

Chunk `Instagram-*.js`: 271 kB → 70 kB. Cierre estático de `/instagram`: 1.006 kB → 263 kB.

## Dónde está

- `src/components/instagram/estudio/consultas.ts`: claves y tiempos del Estudio y `prefetchEstudio`.
- `src/components/instagram/metricas/resumenEstudio.ts`: cifras desde la tabla. Si hay
  varias cuentas en la tabla y no se sabe cuál es la de la marca, o la lectura falla
  (tabla sin migrar…), usa la Edge Function como antes. Una prueba compara el cálculo
  con `supabase/functions/instagram-metricas/resumen.ts`.
- `src/components/marketing/instagram/cuentaGuardada.ts`: cuenta guardada del indicador
  (solo ok, @usuario e id por marca; nunca secretos ni detalles).
- `src/pages/Instagram.tsx`: pestañas con `lazy()` y esqueleto mientras se descargan.
- `src/components/instagram/programar/Miniatura.tsx`: miniatura y título de un evento,
  fuera del calendario para que el Estudio no lo arrastre.

No se ha cambiado ninguna Edge Function ni hay migraciones: no hay que desplegar nada
en Supabase, basta con publicar el panel.
