# Super Admin › Logs: actividad de la web, errores e incidencias en Linear

Pantalla nueva en **Super Admin › Logs** (`/super-admin/logs`) y sección **Comportamiento** en **Tráfico web**. Sirve para:

- reconstruir el recorrido de una visita, desde la entrada hasta la última actividad observada;
- detectar errores solos, agruparlos y abrir o actualizar tickets en Linear;
- sacar estadísticas de comportamiento (embudos, contenidos, procedencia…) con las mismas definiciones en Logs, Tráfico web y el informe en PDF.

Todo son datos reales de la web y de sus servicios. No hay históricos anteriores al primer evento recibido.

## Cómo funciona

```
Navegador (web-casatomas, src/lib/actividad)
  └─ lotes text/plain cada 5 s / al ocultar la página (sendBeacon) ──►  Edge Function registrar-actividad-web
                                                                         (origen permitido, saneado, bots, HMAC de la IP)
Funciones del servidor (envoltorio audit-client: los 5xx) ───────────►  RPC web_logs_ingerir ──► web_eventos + web_sesiones
Base de datos (triggers en reservas y cheques_regalo) ───────────────►        (sin duplicados, topes por sesión, IP y día)
pg_cron cada 5 min ──► Edge Function procesar-logs-web
                        ├─ recolectores: tareas de pg_cron fallidas, sincronización de Tráfico web, despliegues de Vercel en ERROR
                        ├─ web_logs_agrupar_errores: incidencias por huella, umbrales, reapertura
                        ├─ tickets: Linear real o destino de pruebas (web_linear_prueba), con análisis de IA
                        └─ purga diaria (retención)
Panel: Super Admin › Logs y Tráfico web › Comportamiento ──► RPC web_* (solo super admin, RLS)
```

Migraciones (todas con rollback en `supabase/rollbacks/`):

| Migración | Qué hace |
|---|---|
| `20261118100000_logs_web.sql` | Tablas `web_*`, RLS solo super admin, ingesta, agrupación, estadísticas, retención y estado de la recogida. |
| `20261118100100_logs_web_operaciones_bd.sql` | Triggers en `reservas` (canal web) y `cheques_regalo` (origen web) que apuntan cada operación completada. Nunca rompen la operación. |
| `20261118100200_logs_web_cron.sql` | Job `procesar-logs-web` cada 5 min. Necesita antes el secreto (ver «Puesta en marcha»). |

Funciones: `registrar-actividad-web` (pública, con protección propia), `procesar-logs-web` (cron o super admin) y `resumen-logs-web` (solo super admin).

## Cuatro cosas distintas

| Qué | Dónde | Ejemplo |
|---|---|---|
| **Actividad del usuario** | `web_eventos.categoria = 'actividad'` | páginas, clics, carta, formularios, contacto |
| **Operaciones completadas** | `categoria = 'operacion'` | `reserva_solicitada` (el servidor respondió 201), `cheque_pagado`, `reserva_creada_bd` |
| **Peticiones técnicas** | `categoria = 'tecnico'` | `peticion` (endpoint, código, duración), `carga_pagina` (TTFB, LCP) |
| **Errores** | `categoria = 'error'` | JavaScript, promesas, recursos, peticiones 5xx, React, 404, funciones, integraciones, despliegues |
| **Incidencias agrupadas** | `web_incidencias` | Una por entorno y huella, con frecuencia, sesiones y ticket |

Pulsar «Reservar» es un `clic`. Solo cuenta como conversión la respuesta del servidor: la solicitud de reserva guardada (201, que queda pendiente de que el restaurante la confirme) o el pago de un cheque. El catálogo completo, con lo que significa cada evento y desde cuándo hay datos, está en **Logs › Configuración › Cobertura**.

## Qué se observa y qué no (cobertura)

- **La actividad solo se recoge de visitantes que aceptan «Estadísticas de uso»** en el aviso de cookies. Es una categoría nueva y opcional, en los tres idiomas y en la política de privacidad.
  - Quien ya había elegido antes de este cambio cuenta como «no» y no vuelve a ver el aviso; puede activarla desde «Configurar cookies».
  - La señal **Global Privacy Control** desactiva la recogida aunque se acepte.
  - Por todo esto, las sesiones son **una parte** de las visitas. La pantalla muestra la cobertura frente a las páginas vistas de Vercel, que cuenta a todos los visitantes y no usa cookies.
- **Los errores se recogen de todos los visitantes**, sin identificadores persistentes. Sin consentimiento, el navegador manda un id efímero de la pestaña: solo relaciona los errores de esa carga de página y no crea sesión ni recorrido.
- **Operaciones de la BD**: las reservas web y los cheques pagados quedan apuntados para todos los visitantes. Sirven de referencia para saber cuántas conversiones no se ven en las sesiones.
- **Errores del servidor**: los registra el envoltorio común de las funciones en cuanto cada función se vuelve a desplegar. Hoy solo lo llevan las tres funciones nuevas; el resto lo tendrá al redesplegarse.
- **Integraciones**: tareas de pg_cron fallidas y sincronización de Tráfico web. **Hosting**: despliegues de `web-casatomas` en ERROR, si hay token de Vercel.
- **Fuera de alcance por ahora**: la web de Touza (otro repositorio), la actividad del propio panel, los logs de Postgres de Supabase (necesitan un token de gestión) y los logs de ejecución de Vercel (la web es estática).
- **No se graba**: ni pantallas ni pulsaciones, ni contenido libre de formularios, ni el texto de las búsquedas (solo longitud y resultados), ni contraseñas o pagos, ni la IP. Para el límite por minuto se usa un HMAC de la IP con sal diaria, que se borra a la hora.
- **Tráfico interno**: visitando la web con `?ct_interno=1` se marca ese navegador (y con `?ct_interno=0` se desmarca). Las pruebas automáticas (`navigator.webdriver`) y los bots se marcan solos. Las estadísticas los excluyen salvo que actives «Incluir internas y pruebas»; los bots, siempre.

## Definiciones (las mismas en todas las pantallas)

Fuente única: `src/components/trafico-web/comportamiento/definiciones.ts`. El cálculo está en la RPC `web_comportamiento`.

- **Visitas** (Vercel): páginas vistas de todos los visitantes, sin cookies, por días en UTC.
- **Sesiones**: visitas seguidas de un navegador con consentimiento; 30 minutos sin actividad abren otra.
- **Visitantes estimados**: navegadores distintos (identificador seudónimo de hasta 6 meses). **No son personas.**
- **Tiempo activo**: página visible y con interacción en el último minuto. Se usa la mediana.
- **Embudo**: entrada → consulta (abre reservas o consulta disponibilidad; abre «Regala») → inicio (formulario o pago) → finalización (operación completada).
- **Abandono estimado**: empezó la operación y no la terminó en esa sesión (pudo terminarla por teléfono u otro día).
- **Última página observada**: no es una salida confirmada.
- Días y franjas en **hora de Madrid**. El periodo anterior tiene la misma duración. Con menos de 30 sesiones se avisa de que la muestra es pequeña.

## Incidencias y Linear

- **Huella estable**: no cambia con los números, los ids, el hash de los ficheros de Vite ni la línea. Sí cambia con el tipo, el mensaje normalizado o la función donde salta; en los 404, con la ruta.
- **Umbrales** (configurables):
  - por defecto, 3 ocurrencias y 2 sesiones distintas en 24 h;
  - los errores del servidor no exigen sesiones;
  - los **críticos** abren ticket a la primera: la petición de reserva o de cheque que falla, o una función de pago con 5xx.
  - con «No contar pruebas automáticas…» (por defecto) tampoco cuenta el **tráfico interno** (`?ct_interno=1`): solo lo que afecta a clientes.
  - **Versión antigua tras publicar** («Failed to fetch dynamically imported module», «Importing a module script failed», `vite:preloadError`…): quien tenía la web abierta durante una publicación pide ficheros que ya no existen. La web decide qué hacer y lo dice en `accion` (web-casatomas, `src/lib/recarga-por-version.ts`): `recuperado_tras_recarga`, `recarga_sin_efecto`, `aviso_version_nueva`, `sin_version_nueva` o `sin_conexion`. También añade una nota al final del mensaje, que no cuenta para la huella (`quitarNotaRecarga`). Cada ocurrencia se clasifica en `web_eventos.tras_publicar` (migración 20261129143000):

    | Clase | Cuándo | ¿Cuenta para los umbrales? |
    |---|---|---|
    | «esperado tras publicar · sin impacto» | `recuperado_tras_recarga`; en eventos sin `accion`: `recargado`, o la sesión siguió con actividad | No |
    | «sin datos de después» | sin `accion` ni nada después: visitante sin «Estadísticas», cuyo id cambia en cada carga, así que es lo normal | No |
    | «sin conexión del visitante» | `sin_conexion` | No |
    | «no se arregló al recargar · revisar» | `recarga_sin_efecto`, `aviso_version_nueva`; en eventos sin `accion`, volvió a fallar en la misma sesión tras recargar | **Sí** |
    | (ninguna: error normal) | `sin_version_nueva` (red o fichero que falta de verdad) | **Sí** |

    Los bots no se clasifican: llevan horas falsas y nunca cuentan. En la lista de errores y en cada ocurrencia se ve lo que decidió la web. La ingesta guarda `recargado`, `origen`, `despliegue_anterior` y `build_anterior` de esos errores. El patrón SQL es el mismo que `PATRON_CHUNK_CADUCADO` (`huella.ts`); las pruebas PGlite lo comprueban.
  - **Los 404 y los bots no abren tickets**: los 404 solo si lo activas, por encima de su umbral diario; los bots nunca cuentan.
  - Los patrones de ruido conocidos (`ResizeObserver`, extensiones del navegador…) dejan la incidencia como «ignorada».
- **Sin duplicados**:
  - `UNIQUE (entorno, huella)` y un advisory lock al agrupar;
  - un arrendamiento por incidencia antes de tocar su ticket;
  - el ticket se crea en Linear con un **id determinista** (`linear_uuid`): si una respuesta se pierde, el reintento recupera el ticket existente en vez de crear otro.
- **Repeticiones**: se comenta el ticket con la frecuencia nueva cada 6 h, o antes si las ocurrencias se duplican.
- **Reaparición de una resuelta** (configurable): reabrirla y avisar en el mismo ticket (por defecto), crear un ticket nuevo que enlaza el anterior, o dejarla resuelta. Al reabrir, el ticket de Linear vuelve al estado elegido o, si no se elige, al primero «por hacer» de su equipo; si en Linear seguía abierto, solo se comenta (no se mueve de «En curso» a «Por hacer»).
- **Estado de Linear**: si el ticket se cierra en Linear, la incidencia pasa a «resuelta» aquí, y si el error vuelve, se reabre. Si se cancela en Linear, pasa a «ignorada». Si se borra en Linear, se suelta: si el error vuelve a cumplir los umbrales, se abre otro (con id nuevo).
- **Tope diario**: como mucho `linear_max_tickets_dia` tickets nuevos al día (hora de Madrid) en el destino actual. Se atienden primero los más graves y con más visitantes afectados; el resto espera.
- **Resuelta antes de tener ticket**: no se crea (si vuelve, pasa a «reabierta» y entonces sí).
- **Al pasar del destino de pruebas a Linear**: los tickets de prueba no se mandan a Linear. Si una de esas incidencias sigue repitiéndose, se crea su ticket en Linear (con id nuevo, dentro del tope diario); las que ya pararon se quedan como estaban.
- **Errores de Linear legibles**: clave mala o caducada, sin permiso, equipo o ticket que no existe, límite de peticiones o Linear caído se guardan con una frase en español que dice qué hacer. Con la clave rechazada, la pasada se para (y se avisa) en vez de insistir con cada incidencia.
- **Contenido del ticket**:
  - **En pocas palabras** (arriba del todo, en lenguaje llano): qué pasa, a quién afecta, desde cuándo y qué hacer;
  - debajo, los detalles técnicos:
  - título;
  - impacto;
  - entorno, versión y despliegue;
  - primera y última detección;
  - frecuencia y sesiones;
  - evidencias saneadas;
  - recorrido previo;
  - pasos de reproducción;
  - diagnóstico con **hechos** (de los datos) e **hipótesis (IA · sin verificar)**;
  - propuesta (no verificada);
  - cómo validar;
  - enlace al detalle en Super Admin.

  Lo que viene de los logs va siempre como código: no puede inyectar enlaces ni formato.
- **Si Linear o la IA fallan**: la incidencia se queda pendiente con su próximo intento (5, 10, 20… minutos, máximo 6 h). Si la IA falla dos veces, el ticket sale sin análisis y lo dice. Hay tope de tickets nuevos al día.
- **Destino**: `linear_modo` puede valer:
  - `prueba` (por defecto): guarda en `web_linear_prueba` exactamente lo que se mandaría, y en el panel se ve con «Ver lo enviado al destino de pruebas»;
  - `real`: necesita `LINEAR_API_KEY` y el equipo;
  - `desactivado`.
- La automatización **solo detecta, analiza y crea o actualiza tickets**. Nunca ejecuta lo que digan los logs ni toca producción.

## Origen: fallo de la web, servicio externo o no depende de la web

Petición del dueño (14/11/2026): «En logs diferencia entre error web, error que no depende de la web, diferentes colores y se tratan diferente». La lista de la demo eran 17 «Error» en rojo, casi todas «Sin respuesta de rest:… (sin conexión)»: el móvil del visitante sin cobertura.

Cada error (`web_eventos.origen`) y cada incidencia (`web_incidencias.origen`, `origen_proveedor`, `origen_prioridad`) se clasifican con **reglas fijas, sin IA** (migración 20261130100000, `web_logs_origen_error()`; espejo en `supabase/functions/_shared/logs-web/origen.ts`, con los mismos casos en `__tests__/logs-web-origen-casos.json` para el SQL y para TypeScript):

| Color | Origen | Cuándo | Tickets |
|---|---|---|---|
| **Rojo** | Fallo de la web | JS de nuestro código, React, promesas que no son de red, 404 de nuestras páginas o ficheros, 5xx de nuestras funciones, despliegue fallido, falta una clave nuestra, versión antigua que **no** se arregló al recargar o sin versión nueva | Sí (umbrales). Cuenta en el número rojo de la pestaña |
| **Ámbar** | Servicio externo | Google Maps, Mapbox, Instagram/Meta, Stripe, OpenAI, Google (IA, Drive, reseñas), Resend, Vercel, Telegram, Vapi, Google Fonts, YouTube, Supabase saturado (pg_cron) o un recurso de otro dominio | Solo si se activa «Los servicios externos también pueden abrir ticket» (Configuración › Incidencias y avisos). Se cuentan aparte («Externos: N») |
| **Gris** | Conexión del visitante | Petición sin respuesta (estado 0, «Sin respuesta de…»), «Failed to fetch», «Load failed», «NetworkError», cancelada, sin conexión | Nunca |
| **Gris** | Navegador o extensión | `chrome-extension://`, `moz-extension://`, `safari-web-extension://`…, scripts de los navegadores de las apps, «ResizeObserver loop», «Script error.», rastreadores bloqueados | Nunca |
| **Gris** | Versión antigua (se arregló sola) | `tras_publicar` sin impacto o sin datos de después | Nunca |
| **Gris** | Bots y pruebas | Solo ocurrencias de bots, pruebas automáticas o tráfico interno (si «No contar pruebas…» está activado) | Nunca |

- **Incidencia**: basta una ocurrencia real de la web para que sea «Fallo de la web»; si no, externo; si no hay ninguna real, «Bots y pruebas»; si no, la que más se repite. Para los umbrales solo cuentan las ocurrencias de la web (y las externas con el interruptor).
- **Tickets ya creados** de lo que ahora no depende de la web: no se cierran ni se tocan (no se reabren ni se comentan); solo se sigue leyendo su estado. Las pendientes que ya no pueden se devuelven a «sin ticket» con el motivo. **«Pedir ticket» a mano vale para cualquiera** (el motivo empieza siempre por «Pedido a mano» y el proceso lo respeta).
- **Panel**: por defecto, «Errores e incidencias» enseña los fallos de la web y los externos (primero los de la web), con las cuentas de cada color, una leyenda y, abajo, «No dependen de la web (N)». Filtro «Origen: todos / Fallos de la web y externos / Fallo de la web / Externos / No dependen de la web». «Ocultar las de solo bots y pruebas» también quita las de origen «Bots y pruebas». Los mismos colores en el detalle (con una línea en llano de qué es y qué hacer), en la línea de tiempo de las sesiones, en los eventos sueltos y en los errores de cada sesión (`web_sesiones.errores_web`, `errores_externos`).
- **IA**: lo que no depende de la web no se explica con IA (ya tiene su texto fijo).
- **Sin la migración** el panel funciona como antes (calcula los colores con las mismas reglas, sin filtro ni cuentas por origen) y `procesar-logs-web` trata todas como antes.

## Explicación en sencillo (para el dueño)

Cada incidencia y cada sesión empiezan con un bloque en español llano; lo técnico va debajo, plegado («Detalles técnicos», «Paso a paso y datos técnicos»):

- **Qué hizo el cliente**: del recorrido de su sesión («Entró en la carta, abrió 2 vinos y pulsó «Reservar»»). Sin consentimiento, lo dice en vez de inventarlo. En los errores del servidor: «Ningún cliente: lo hace una tarea automática…».
- **Qué falló**: los errores conocidos tienen un texto fijo (`causas.ts`, campo `sencillo`). Por ejemplo, la versión antigua: «La página tenía una versión antigua abierta justo cuando publicamos; se recarga sola». Las tareas programadas se nombran en llano (`sencillo.ts`, `TAREAS`): «La tarea que retoma la lectura de facturas atascadas no arrancó a tiempo; las facturas pueden tardar más en leerse». Los errores nuevos llevan una **explicación de la IA escrita una vez por incidencia** y guardada en `web_incidencias.explicacion_ia`, marcada «Explicación de la IA · sin comprobar».
- **¿Afecta?**: cuántos visitantes en total y hoy, veces en 24 h, si es grave, y en la versión antigua si se arregló sola o se repitió.
- **Qué hacer**: qué tiene que hacer el dueño (casi siempre «nada» o «avisa al técnico»), y si ya hay ticket.

El ticket de Linear empieza con el mismo resumen.

## IA

- **Explicación en sencillo** (`procesar-logs-web/explicar.ts`): solo para incidencias reales sin causa conocida, como mucho 3 por pasada, 2 intentos por incidencia y la mitad del tope diario de IA (el tope es uno para todo: análisis de tickets + explicaciones). Solo ve la incidencia agrupada y saneada (sin datos personales) y lo que falla según las muestras. No ve visitas sueltas.
- **Incidencias**: solo se analiza la incidencia agrupada (mensaje y pila saneados, reparto de navegadores y versiones, y el recorrido previo descrito en frases), nunca cada visita. Los logs van como datos, con la orden de ignorar instrucciones dentro de ellos. Si la IA cita un archivo que no aparece en las evidencias, se sustituye por «(archivo no presente en las evidencias)». Si falta contexto, lo tiene que decir. Tope diario configurable.
- **Resumen del periodo** (Estadísticas y Tráfico web): solo con cifras agregadas, en cinco apartados.
  - Cada conclusión **tiene que citar una cifra del periodo**; si no, se descarta.
  - Va marcada como observación o hipótesis. Las mejoras son siempre hipótesis.
  - Caché de 6 h.
- **Modelo**: `gpt-4.1-mini` por defecto, elegible en **Servicios › Modelos** (funciones `procesar-logs-web` y `resumen-logs-web`). El coste se contabiliza en `ia_uso`.

## Configuración (Logs › Configuración)

- **Fuentes**: actividad, errores del navegador, peticiones, funciones, integraciones, despliegues.
- **Entornos**: de cuáles se aceptan eventos y cuáles abren tickets. Por defecto se aceptan producción y demo, y solo producción abre tickets.
- **Exclusiones**: rutas y patrones de error.
- **Umbrales y reapertura.**
- **Linear**: destino, equipo, proyecto, etiquetas y estado al reabrir.
- **IA**: activada o no, y análisis por día.
- **Retención**: actividad 90 días y errores 180 días.
- **Límites de coste**: eventos por día (50.000), por sesión (400) y por IP y minuto (300).

Las credenciales nunca se guardan aquí: son secretos de las funciones.

## Puesta en marcha

**Demo (`sfonaclosuafvlhutkon`), hecho el 09/11/2026:**

- migraciones 20261118100000 y 20261118100100 aplicadas;
- las tres funciones desplegadas;
- prueba de humo y recorridos controlados (ver el PR).

**Pendiente en la demo (lo hace el dueño): el cron.**

```bash
SECRETO=$(openssl rand -hex 32)
npx supabase secrets set LOGS_WEB_CRON_SECRET="$SECRETO" --project-ref sfonaclosuafvlhutkon
```

En el SQL Editor de la demo, con el mismo valor:

```sql
select vault.create_secret('<el mismo valor>', 'logs_web_cron_secret');
```

Y aplicar la migración del cron:

```bash
npx supabase db query --remote=sfonaclosuafvlhutkon -f supabase/migrations/20261118100200_logs_web_cron.sql
```

Hasta entonces el aviso de Logs dice «El proceso en segundo plano todavía no ha terminado ninguna pasada». Con una sesión de super admin también se puede lanzar a mano con **Procesar ahora** (Configuración).

**Linear real (cuando se quiera)** — los mismos pasos salen en el panel (Logs › Configuración › Linear › «Cómo conectar Linear»):

1. En Linear: *Settings › Security & access › Personal API keys › New API key* (nombre, por ejemplo, «Casa Tomás · Logs»).
2. En Supabase: *Edge Functions › Secrets › Add new secret*, nombre `LINEAR_API_KEY` (o `npx supabase secrets set LINEAR_API_KEY=… --project-ref <ref>`). Primero en la demo.
3. En Logs › Configuración › Linear, **«Probar conexión con Linear»**: dice si la clave funciona y el nombre del espacio de trabajo, y deja elegir en desplegables el equipo, el proyecto, las etiquetas y el estado al reabrir (ya no hace falta pegar ids; siguen en «Avanzado»). Sin clave, dice «Falta la clave de Linear» y remite a estos pasos.
4. Cambiar «Destino de los tickets» a «Linear» y **Guardar configuración**.

La prueba la hace `procesar-logs-web` con `{ "accion": "probar_linear" }`, solo para super admin; no procesa nada y la clave nunca sale del servidor. Las incidencias del destino de pruebas solo pasan a Linear si siguen repitiéndose (ver «Al pasar del destino de pruebas a Linear»). Para mandar una a mano, «Reenviar al destino actual».

**Producción (`haqmmdfdzzatdnrrcgez`)**: solo después de aceptar los PR y con el «sí» del dueño. Mismo orden: migraciones 100000 y 100100, las tres funciones, el secreto y Vault, y la migración del cron. La web empieza a mandar datos cuando se publica el PR de `web-casatomas`.

## Límites conocidos

- La cobertura de sesiones depende del consentimiento, que empieza en cero para quien ya había elegido.
- Los errores que ocurren antes de cargar el bundle principal no se ven.
- `sendBeacon` al cerrar la página es «lo mejor posible»: si el navegador lo descarta, se pierde el último lote. Los ids impiden duplicados en los reintentos.
- Los días de Vercel son UTC y los nuestros, hora de Madrid. La cobertura es orientativa.
- El análisis de IA y el resumen dependen de la clave de OpenAI de la función.
- Los errores del resto de funciones del servidor se registran cuando cada una se vuelve a desplegar con el envoltorio nuevo.

## Deshacer

0. Solo el origen (colores y tickets por origen): `supabase/rollbacks/20261130100000_logs_web_origen_ROLLBACK.sql` (vuelve a la agrupación de 20261129143000).
1. Quitar el job: `supabase/rollbacks/20261118100200_logs_web_cron_ROLLBACK.sql`.
2. Quitar los triggers: `20261118100100_..._ROLLBACK.sql`.
3. Borrar tablas y RPC: `20261118100000_..._ROLLBACK.sql`.

La web sigue funcionando sin tablas: el rastreador descarta en silencio.
