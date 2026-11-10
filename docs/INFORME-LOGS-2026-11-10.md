# Informe de logs y tickets automáticos — 10/11/2026

Revisión pedida por el dueño: «Logs que den más info de lo que ocurre + revisar todos los actuales y ver qué ha pasado, revisar generación de tickets automática».

**Fuentes (solo lectura):** tablas `web_*` y `cron.job_run_details` de producción (`haqmmdfdzzatdnrrcgez`) y demo (`sfonaclosuafvlhutkon`), logs de las funciones edge de producción de las últimas 24 h (lo que guarda Supabase). Los datos de Logs existen desde el 08/11/2026 (primer evento): no hay históricos anteriores. No se ha creado, cerrado ni modificado nada en remoto.

## 1. Resumen

| | Producción | Demo |
|---|---|---|
| Eventos guardados | 426 | 396 |
| Incidencias | 19 (9 de solo bots o pruebas, con 0 ocurrencias reales) | 11 (casi todas de los e2e del CI) |
| Tickets | 7, **todos al destino de pruebas** (`linear_modo = prueba`, sin equipo de Linear) | 1 (destino de pruebas) |
| Proceso en segundo plano (cada 5 min) | Funciona; última pasada 10:45 sin errores | Funciona |

Lo importante:

1. **Ningún ticket llega a Linear.** Producción está en modo «prueba» y no tiene equipo configurado: los tickets se guardan en `web_linear_prueba`. Para que lleguen hace falta el secreto `LINEAR_API_KEY` en producción, el equipo en *Super Admin › Logs › Configuración* y pasar a modo «real» (decisión del dueño).
2. **Un único problema real abrió 6 tickets**: la caída de pg_cron del 08/11 (ver 2.1). Ya agrupa en uno.
3. **El mismo error salía como incidencias distintas en cada publicación** porque el hash de los ficheros de Vite puede llevar «-» y no se quitaba (ver 2.2). Arreglado.
4. **La mitad de las incidencias de producción eran de bots o pruebas** (0 ocurrencias reales) e inflaban el contador «activas». Ahora se ocultan por defecto.
5. **Los tickets de errores del servidor no decían qué fallaba** (ni la tarea, ni la función): la IA escribía «no se especifica qué job falla» y especulaba con «la red entre Vercel y Supabase». Ahora el ticket lleva «Qué falla», datos clave y, si encaja, la «Causa conocida».
6. **Una cola de tickets podía dejar sin crear los pendientes antiguos** (ver 3). Arreglado.
7. **Fuera de Logs**: `registrar-metrica`/`leer-metricas` llaman a un proyecto de Supabase que ya no existe (500 por DNS) y hubo dos peticiones al webhook de Stripe sin firma (ver 2.6–2.7).

## 2. Qué ha pasado (producción salvo que se diga)

### 2.1 pg_cron no pudo arrancar las tareas — 08/11, 16:20–21:53 UTC
- **331 fallos «job startup timeout»** en 6 tareas: `reanudar-trabajos-ocr` (179, va cada minuto), `instagram-programador` (48), `clasificar-productos` (47), `facturas-originales-drive` (25), `reservas-aviso-sin-asignar` (16), `emails-reserva-reintentar-fallidos` (16). Desde las 21:53 no ha vuelto a pasar. Logs solo recogió 94 (empezó a recoger a las 19:56; el primer día mira 24 h atrás pero la tabla de ejecuciones ya se había leído desde ese punto).
- **Causa probable:** pg_cron no consiguió conexión para lanzar las tareas a tiempo (`cron.use_background_workers = off`, `max_worker_processes = 6`): base de datos saturada o en mantenimiento. Coincide con el día del cambio de proceso de releases y migraciones grandes. En la demo pasó lo mismo, más leve, el 05/11 (3 fallos).
- **Efecto:** durante ~5 h no corrieron OCR, Instagram programado, clasificación, originales en Drive, avisos de reservas sin asignar ni reintentos de emails. Se reanudaron solos.
- **Tickets:** se abrieron **6 tickets** (PRUEBA-1…6), uno por tarea, para la misma causa.
- **Qué haría falta:** mirar en Supabase › Reports la CPU y conexiones de esa franja; si se repite, espaciar `reanudar-trabajos-ocr` (cada minuto) o activar `cron.use_background_workers`. **En este PR:** una sola incidencia `cron:*` para todas las tareas (la tarea va en los datos) y causa conocida en el ticket.

### 2.2 Ficheros de una versión anterior tras publicar — 09–10/11
- `TypeError: Failed to fetch dynamically imported module …/NovedadesSection-D-0lW2q6.js` (1), `Unable to preload CSS for /assets/EspaciosGallery-CmTTVDlw.css` (1), y recursos `client-CHi__bHm.js` y `clock-8WO4Qfr6.js` que no cargan (1 cada uno), todos en la v1.1.1 de la web.
- **Causa:** el visitante tenía abierta la web antes de una publicación (el 09/11 hubo varias, incluido el despliegue a mano y los *Promote*) y pidió ficheros que ya no existen. No es un fallo de esos componentes.
- **Problema de agrupación:** cada fichero y cada despliegue daban una incidencia distinta (4 incidencias para lo mismo), porque el hash de Vite (`D-0lW2q6`, `C0ct-iG8`) puede llevar guion y la normalización solo quitaba hashes sin guion. En la demo, por lo mismo, «Minified React error #423» salía dos veces (#1 y #9) y #418 otras dos (#4 y #7). En producción ninguna llegaba al umbral de ticket porque cada una tenía 1 ocurrencia.
- **Qué haría falta en la web pública** (no se toca aquí): recargar la página una vez al recibir `vite:preloadError` o un error de import dinámico. **En este PR:** se quita bien el hash y todos esos mensajes van a una única incidencia «chunk caducado», con su causa conocida.

### 2.3 Hidratación de React (#418/#423) — demo
- 4 incidencias en la demo, todas de los e2e del CI (`127.0.0.1:4173`, `es_prueba`), en `/esta-pagina-no-existe`. El HTML pre-renderizado no coincide con lo que pinta React. No hay ocurrencias en producción. Causa conocida añadida.

### 2.4 Bots y pruebas
- 9 de las 19 incidencias de producción son de bots o pruebas automáticas (0 ocurrencias reales): 5 imágenes `salon-*.avif` que un bot no cargó (04:38, mismo milisegundo), 2 «Sin respuesta» de `rest:configuracion_web`/`rest:menus_diarios` desde un bot a medianoche, y dos 404 de pruebas (`/<script>…`, `/espacios`). Una de ellas (#20) tiene un ticket pedido a mano.
- Las cifras ya excluían bots, pero la incidencia se creaba igual y contaba como «activa». **En este PR:** se ocultan por defecto (interruptor «Ocultar las de solo bots y pruebas») y no cuentan en el contador de la pestaña.
- En la demo llegan los eventos de los e2e del CI de la web (`127.0.0.1:4173`): van marcados `es_prueba`, pero ensucian la lista (ver 5).

### 2.5 Funciones edge (24 h)
- `reservas-web/disponibilidad` 400 ×12 y `/crear` 409 ×1: validación (fecha/aforo), esperado.
- `cheques-regalo-web/crear` 422 ×4: validación del formulario, esperado.
- `procesar-logs-web` 546 ×1 (límite de recursos del worker) y 401 ×1: aislados; las pasadas siguientes terminaron bien.
- `instagram-drive` 404 ×4, `instagram-metricas` 503 ×1, varias 401 de funciones del panel (sesión caducada): sin patrón.
- Avisos del OCR de albaranes (descuadres, CIF que no pasa el control): funcionamiento normal.

### 2.6 `registrar-metrica` y `leer-metricas` apuntan a un proyecto inexistente
- `Error inserting metric: … https://yfnrkmxnmtrqmdtfvqix.supabase.co … dns error` (500). Las dos funciones tienen esa URL fija (`supabase/functions/registrar-metrica/index.ts:39`, `leer-metricas/index.ts:24`). Ese proyecto no es ninguno de los actuales: las métricas se pierden. **Qué haría falta:** decidir si se siguen usando; si sí, usar `SUPABASE_URL`; si no, retirar las llamadas. No se cambia aquí (fuera de la zona de este PR); ahora sale con causa conocida «servidor que ya no existe».

### 2.7 Webhook de Stripe sin firma
- `stripe-webhook-cheques-regalo`: «falta firma o STRIPE_WEBHOOK_SECRET» ×2 (09/11 19:08 y 10/11 05:58). Si fueran pagos reales sin secreto, fallarían todos; con un único pago de cheque correcto el 09/11 (`cheque_pagado_bd`), lo más probable es que sean peticiones sin firma (sondeos). Conviene confirmar en Stripe › Webhooks que no hay entregas fallidas.

## 3. Revisión de la generación automática de tickets

| Pregunta | Resultado |
|---|---|
| ¿Se crean cuando deben? | Sí según los umbrales (3 ocurrencias y 2 sesiones en 24 h; críticas a la primera). Pero en producción van al **destino de pruebas**, no a Linear. Los errores que cambian de fichero en cada publicación no llegaban nunca al umbral (arreglado con la agrupación). |
| ¿Hay duplicados? | No de la misma incidencia (id determinista y reclamo por incidencia funcionan). **Sí de la misma causa**: 6 tickets por la caída de pg_cron, y varias incidencias por el hash de Vite. Arreglado. |
| ¿Se pierden? | Posible: el proceso leía una sola lista de 200 incidencias con ticket ordenada por «última vez»; con muchos tickets ya creados, una pendiente con «última vez» antigua quedaba fuera y no se creaba nunca. Ahora son dos colas (por crear, por intento; con ticket, por última sincronización). Los fallos de Linear o IA se reintentan con espera (sin cambios). |
| ¿Llevan la información necesaria? | No en los errores de servidor e integraciones: faltaba qué tarea o función falla, salían «Abrir la página `(sin ruta)`», navegador «desconocido 100 %» y «0 sesiones observadas». Los repartos incluían bots. Ahora: «Qué falla» (objetivos y datos clave: tarea, endpoint, método, estado, componente…), «Causa conocida» con qué hacer, sin apartados de navegador para el servidor, repartos sin bots, y la IA recibe esos datos. |

## 4. Cambios de este PR

- **Agrupación** (`_shared/logs-web/huella.ts`): hash de Vite con «-»/«_» e imágenes; «chunk caducado» = una incidencia; fallos de pg_cron de plataforma = una incidencia `cron:*`.
- **Causas conocidas** (`_shared/logs-web/causas.ts`): chunk caducado, pg_cron sin arrancar, hidratación de React, petición sin respuesta, servidor inexistente (DNS), falta de secreto. Las usan el ticket, la IA y el panel.
- **Errores de funciones edge** (`_shared/logs-web/servidor.ts`, `audit-client.ts`): ahora guardan el método HTTP, si fue excepción y la **pila saneada** (antes solo el mensaje).
- **Tickets** (`procesar-logs-web`): contexto nuevo, dos colas, muestras sin bots.
- **Panel** (*Super Admin › Logs › Errores e incidencias*): filtros por tipo y orden (recientes, ocurrencias, sesiones), búsqueda también en la pila, ocultar solo bots/pruebas (por defecto), etiqueta de causa conocida en la lista; en el detalle, causa conocida, «Qué falla y dónde» (objetivos, datos, navegador, sistema, dispositivo y versión), error completo de cada ocurrencia y botón «Copiar para el informe».
- Sin datos personales nuevos: todo pasa por el saneado existente (correos, teléfonos, tokens) y solo se citan claves técnicas.

## 5. Qué cambiar en la web pública (repo web-casatomas, no se toca aquí)

1. **Recargar ante ficheros caducados:** `window.addEventListener("vite:preloadError", …)` y en el `catch` de los `lazy()`, recargar una sola vez (marca en `sessionStorage` con la versión) y mandar el evento con `propiedades.recargado = true`.
2. **No mandar eventos desde los e2e** a la demo, o mandarlos con una marca explícita de prueba (ya llegan como `es_prueba`, pero mejor no enviarlos: hoy son casi toda la lista de la demo).
3. **Versión en todos los eventos:** algunos 404 y peticiones llegan con `version = null`; mandar siempre `version` y `despliegue` (el commit corto de `/version.json`).
4. **Errores de petición:** añadir `metodo`, `status` y la duración siempre; para estado 0, distinguir «cancelada por el navegador» (navegación o `AbortController`) de «sin red» (`navigator.onLine`), para no abrir incidencias por visitantes que cambian de página.
5. **Errores de React:** mandar el nombre del componente del *error boundary* (ya va como `componente`) también en `error_js`/`error_promesa` cuando se conozca la pantalla.

## 6. Pasos para el dueño

1. Desplegar en la **demo** `procesar-logs-web` y `registrar-actividad-web` (y, para la pila de los errores del servidor, el resto de funciones cuando se desplieguen; no es urgente). Sin migraciones.
2. Para tickets reales en Linear (producción): secreto `LINEAR_API_KEY`, equipo en Configuración y modo «real». Hasta entonces seguirán en el destino de pruebas.
3. Opcional, limpieza en producción: marcar resueltas las 6 incidencias de pg_cron del 08/11 (no se repite desde entonces) e ignorar las de solo bots.
