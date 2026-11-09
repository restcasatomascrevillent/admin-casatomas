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
  - **Los 404 y los bots no abren tickets**: los 404 solo si lo activas, por encima de su umbral diario; los bots nunca cuentan.
  - Los patrones de ruido conocidos (`ResizeObserver`, extensiones del navegador…) dejan la incidencia como «ignorada».
- **Sin duplicados**:
  - `UNIQUE (entorno, huella)` y un advisory lock al agrupar;
  - un arrendamiento por incidencia antes de tocar su ticket;
  - el ticket se crea en Linear con un **id determinista** (`linear_uuid`): si una respuesta se pierde, el reintento recupera el ticket existente en vez de crear otro.
- **Repeticiones**: se comenta el ticket con la frecuencia nueva cada 6 h, o antes si las ocurrencias se duplican.
- **Reaparición de una resuelta** (configurable): reabrirla y avisar en el mismo ticket (por defecto), crear un ticket nuevo que enlaza el anterior, o dejarla resuelta.
- **Estado de Linear**: si el ticket se cierra en Linear, la incidencia pasa a «resuelta» aquí, y si el error vuelve, se reabre. Si se cancela en Linear, pasa a «ignorada».
- **Contenido del ticket**:
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

## IA

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

**Linear real (cuando se quiera):**

1. Crear una clave personal en Linear (*Settings › Security & access*).
2. Guardarla como secreto: `npx supabase secrets set LINEAR_API_KEY=… --project-ref <ref>`.
3. En Logs › Configuración, poner el id del equipo (y, si se quiere, proyecto y etiquetas) y cambiar el destino a «Linear».

Las incidencias creadas en el destino de pruebas no se repiten en Linear. Para mandar una, usa «Reenviar al destino actual».

**Producción (`haqmmdfdzzatdnrrcgez`)**: solo después de aceptar los PR y con el «sí» del dueño. Mismo orden: migraciones 100000 y 100100, las tres funciones, el secreto y Vault, y la migración del cron. La web empieza a mandar datos cuando se publica el PR de `web-casatomas`.

## Límites conocidos

- La cobertura de sesiones depende del consentimiento, que empieza en cero para quien ya había elegido.
- Los errores que ocurren antes de cargar el bundle principal no se ven.
- `sendBeacon` al cerrar la página es «lo mejor posible»: si el navegador lo descarta, se pierde el último lote. Los ids impiden duplicados en los reintentos.
- Los días de Vercel son UTC y los nuestros, hora de Madrid. La cobertura es orientativa.
- El análisis de IA y el resumen dependen de la clave de OpenAI de la función.
- Los errores del resto de funciones del servidor se registran cuando cada una se vuelve a desplegar con el envoltorio nuevo.

## Deshacer

1. Quitar el job: `supabase/rollbacks/20261118100200_logs_web_cron_ROLLBACK.sql`.
2. Quitar los triggers: `20261118100100_..._ROLLBACK.sql`.
3. Borrar tablas y RPC: `20261118100000_..._ROLLBACK.sql`.

La web sigue funcionando sin tablas: el rastreador descarta en silencio.
