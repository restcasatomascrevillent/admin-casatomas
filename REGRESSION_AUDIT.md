# Auditoría de regresión — adminpanelct + casa-tomas-story

**Fecha:** 18–19/10/2026 · **Ramas:** `audit/regresion-2026-10-18` en cada repositorio (sin push, sin despliegue)
**Base auditada:** `origin/main` de cada repo = lo que está en producción en Vercel (panel `992680f`, web `c7cb11a`; verificado en los despliegues *READY* de Vercel).
**Entorno:** macOS, Node 25.2.1, npm 11.6.2, Chrome 155 del sistema (Playwright 1.63), PGlite 0.5.8.

> Este informe distingue entre **bug confirmado** (reproducido y, salvo que se diga, con test que fallaba antes y pasa después), **posible bug**, **seguridad**, **deuda técnica** y **mejora opcional**. Donde algo no se pudo ejecutar se dice expresamente.

---

## 1. Resumen ejecutivo

**Estado general.** Ambos proyectos compilan, sus suites existentes pasan y las capas más delicadas (cheques regalo en base de datos, autenticación, bloqueo de usuarios, RLS frente a anónimos) están bien construidas. La auditoría encontró **fallos funcionales reales en producción** en la carta de vinos y en la compra de cheques, **un error de cálculo monetario** en la facturación y **un riesgo de pérdida de datos** (fotos) en la gestión de la carta. Todos ellos están corregidos en las ramas de auditoría con tests de regresión.

| | Panel (`adminpanelct`) | Web (`casa-tomas-story`) | Total |
|---|---|---|---|
| Incidencias corregidas | 7 | 8 | **15** |
| — de producto (afectan al usuario o a los datos) | 3 | 7 | 10 |
| — de infraestructura de pruebas/instalación | 4 | 1 | 5 |
| Pendientes documentadas (no corregidas) | 9 (panel/BD) | 9 | **21** (+2 de ambos, +1 transversal) |
| Tests añadidos | 3 ficheros + 1 script SQL (41 comprobaciones) | 2 ficheros + 1 suite E2E (12 escenarios) | |

**Bugs de producto corregidos (los más relevantes):**

1. **Carta de vinos (web) — ALTA, confirmado en producción.** La paginación ordenaba por `categoria, orden` y **184 de 207 vinos activos empatan** en ese par: tras pulsar «Mostrar más» hasta el final, producción enseñaba 207 fichas con solo 202 nombres distintos — **4 vinos repetidos y 4 que no aparecen nunca**.
2. **Buscador de vinos (web) — ALTA, confirmado en producción.** Solo buscaba entre las 24 fichas cargadas. Buscar «Pousada» en producción devuelve «No hay vinos que coincidan». Con la corrección y los **datos reales** de Supabase: 207 fichas, 206 nombres distintos (el par legítimo «Pazo la Cuesta» tinto/blanco) y «Pousada» encontrado.
3. **Facturación OficiosOsIA (panel) — ALTA.** El redondeo a céntimos fallaba con medio céntimo exacto: **IVA 21 % de 21,50 € = 4,51 €** (correcto 4,52 €). Medido: 478 de cada millón de bases al 21 % y 4.573 al 10 %. En producción no hay ninguna factura emitida todavía (solo un borrador con importes redondos), así que ningún documento enviado cambia.
4. **Fotos de la carta (panel) — ALTA, riesgo de pérdida de datos.** En producción **9 pares botella normal / Magnum comparten el mismo fichero de foto**. Eliminar una ficha (o quitarle la foto) borraba el fichero y dejaba a la otra sin imagen en la web. Además la foto se borraba *antes* que la fila.
5. **Compra de cheques regalo (web) — MEDIA.** Doble clic en «Ir al pago seguro» creaba **dos cheques pendientes y dos sesiones de Stripe**; un importe de 5 € o 1.500 € no se rechazaba hasta el último paso; sin conexión se mostraba «Failed to fetch» en inglés.

**Riesgos que requieren decisión (no corregidos, ver §5):**

- **Seguridad (MEDIA):** las políticas RLS de **escritura** de `novedades` (contenido de la web pública), `resenas`, `espacios_reserva`, `planos_espacio`, `imagenes_base64` y `config_google_places` aceptan a **cualquier usuario autenticado**, sin permiso de sección. Si el registro público de Supabase Auth está activo, cualquiera podría crear una cuenta y modificar las novedades de la web. No se puede comprobar ese ajuste desde aquí.
- **Publicación (MEDIA):** un cambio de carta hecho dentro de los 10 minutos de antirrebote de `rebuild-webs` queda «pendiente» y **solo se publica si llega otra edición después** (no hay cron). Las páginas de platos son 100 % estáticas.
- **Dependencias (MEDIA):** `jspdf` (crítica), `fabric` (XSS en exportación SVG) y `react-router-dom` (open redirect) tienen avisos en `npm audit`; corregirlos exige actualizaciones, algunas mayores.
- **Regla de negocio pendiente:** el encargo pide que la carta de vinos abra en «Tintos Ribera», pero el commit reciente `3b6c8db` («abrir la carta de vinos en Todos por defecto») lo cambió deliberadamente. **No se ha tocado**: decide tú cuál es la regla.
- **Despliegue/SEO:** el dominio oficial `restaurantecasatomascrevillente.es` sirve hoy un WordPress; la web React vive en `casa-tomas-story.vercel.app` y declara canónicas y sitemap en el dominio oficial, donde esas rutas devuelven 404.

---

## 2. Arquitectura y recursos compartidos

- **Panel** (`adminpanelct`): React 18 + Vite + shadcn, React Query, Supabase JS. Vercel `admin-panel` → `admin-panel-alpha-eight-66.vercel.app`. Contiene las **309 migraciones** y casi todas las Edge Functions.
- **Web** (`casa-tomas-story`): React 18 + `vite-react-ssg` (prerender de 57 páginas en es/en/fr). Vercel `casatomas` → `casa-tomas-story.vercel.app`. Contiene las funciones de cheques regalo (`cheques-regalo-web`, `stripe-webhook-cheques-regalo`, `cheques-regalo-admin`).
- **Supabase compartido:** proyecto `jeamoczmbfsnwkfjxcyo` (Postgres 17).
  - Carta: `Platos`, `Vinos`, `Bebidas`, `Cocteles`, `menus_diarios`, `tapas`, `novedades`, `configuracion_web` (la web los lee como `anon`; el panel escribe).
  - Cheques: `cheques_regalo`, `plantilla_cheques_regalo`, `plantilla_factura_cheques`, `facturas_cheques` (sin acceso directo: solo RPC con permiso de sección o `service_role`).
  - Reservas: `reservas`, `configuracion_reservas`, `cierres_reserva`… vía `reservas-web` y RPC públicas (`servicios_cerrados_reserva`).
  - Storage: buckets `platos`, `vinos`, `bebidas`, `cocteles`, `novedades`.
  - Publicación: `rebuild-webs` dispara los Deploy Hooks de Vercel con antirrebote (`web_rebuild_state`).
- **Sincronización panel → web:** la carta de **vinos y bebidas** se refresca en vivo en el navegador; **platos** y el resto del contenido prerenderizado dependen de un nuevo build (`rebuild-webs`). Las **novedades** se refrescan en vivo.

---

## 3. Matriz de pruebas

Leyenda: ✅ ejecutado y correcto · 🐞 ejecutado, bug encontrado (ver §4) · ⚠️ ejecutado parcialmente · ⛔ no ejecutable aquí (motivo).

| Área | Qué se comprobó | Cómo | Resultado |
|---|---|---|---|
| Instalación | `npm ci` reproducible | ambos repos | 🐞 panel (lockfile) → corregido; ✅ web |
| Build | build de producción | `vite build` / `vite-react-ssg build` (lectura pública de Supabase) | ✅ ambos |
| Typecheck / lint | sin errores nuevos | `tsc --noEmit`, `eslint` vs. línea base | ✅ sin cambios (deuda previa: panel 20 TS / 480 ESLint; web 21 TS / 10 ESLint) |
| Tests existentes | suites completas | vitest | 🐞 web: 235 tests fallan con Node ≥25; panel: 16 ficheros no cargan sin `.env` y 5 tests con mock desfasado → corregidos |
| Auth: rutas privadas | sin sesión, 10 rutas privadas + superadmin | Playwright contra producción | ✅ redirigen a login, **0 peticiones de datos**, sin errores |
| Auth: refresco de sesión | no desmonta la página | test existente | ✅ (tras arreglar su mock) |
| Auth: bloqueo y revocación | sesiones borradas, tokens antiguos rechazados, RLS/Storage | `scripts/verificar-bloqueo-usuarios.mjs` (PGlite) | ✅ |
| Superadmin | concesión/retirada atómica, idempotencia | `scripts/verificar-gestion-superadmin.mjs` | ✅ |
| API anónima | lectura de tablas sensibles y RPC | `curl` GET/RPC de solo lectura con la clave pública | ✅ 0 filas o *permission denied* |
| RLS y permisos | políticas, grants, `SECURITY DEFINER` | catálogo de producción + advisors | ⚠️ ver P-01…P-04 |
| Cheques: ciclo SQL | pago → listado → verificación → canje → caducidad → reembolso → factura → compra manual | `npm run test:cheques:db` (PGlite, funciones reales) | ✅ 41 comprobaciones |
| Cheques: datos de producción | invariantes (pendientes sin código, pagados con caducidad, PI únicos…) | SQL agregado de solo lectura | ✅ 17 cheques, 0 violaciones |
| Cheques: paridad repo/producción | funciones desplegadas = repo | hash del cuerpo de 11 funciones | ✅ (una difiere solo en comentarios) |
| Cheques: compra web | éxito, cancelación, sin red, doble clic, rango | Playwright, Stripe simulado | 🐞 3 bugs → corregidos |
| Cheques: webhook Stripe | firma, idempotencia, reembolso | revisión de código + sentencias SQL en PGlite | ⚠️ lógica SQL ✅; función Deno ⛔ (sin Deno ni cuenta Stripe test) |
| Facturación | IVA, descuentos, retención, redondeo | tests + barrido exhaustivo 0,01–10.000 € | 🐞 redondeo → corregido (0 errores en 7 tipos de IVA) |
| Auditoría | identidad, reversión, permisos, ruido | `test:auditoria:db`, `verificar-auditoria.mjs`, tests UI | ✅ (test SQL inestable → corregido) |
| Carta (panel) | borrado de fichas y fotos | tests + datos de producción | 🐞 fotos compartidas → corregido |
| Carta de vinos (web) | Todos, «Mostrar más», buscador, tipo + D.O., foto/info, móvil | vitest + Playwright (40 vinos) + datos reales | 🐞 3 bugs → corregidos |
| D.O. | sin inventar ni estimar | SQL de producción | ✅ 18 sin D.O. = 18 en «Origen pendiente»; 0 estimadas |
| Bebidas (web) | buscador, paginación | vitest | 🐞 → corregido |
| Web pública en producción | 48 URLs del sitemap + 404, a 375 y 1280 px | Playwright, solo lectura | ✅ 200, sin errores JS, sin peticiones fallidas, sin imágenes rotas, sin desbordes; ⚠️ 404 con error de hidratación; `/reservas` sin `<h1>` |
| Web: responsive | 13 rutas × 375/768/1280 | Playwright (build E2E) | ✅ |
| Panel: responsive | 20 rutas + todas sus pestañas × 375/820/1280 | Playwright con Supabase simulado (sesión ficticia) | ✅ 0 desbordes; ⚠️ 2 señales que resultaron artefactos del simulador |
| Migraciones | objetos de las migraciones recientes existen en producción | catálogo | ✅ |
| Edge Functions | desplegadas vs. repo | MCP de Supabase | ✅ (3 sin desplegar, ninguna usada) |
| Publicación panel → web | `rebuild-webs`, estado, despliegues | código + `web_rebuild_state` + Vercel | ⚠️ P-06 |
| CRUD real en BD | crear/editar/eliminar platos, vinos, novedades |— | ⛔ prohibido escribir en producción y sin entorno aislado (crear una rama de Supabase tiene coste) — cubierto con tests y mocks |
| Subida de imágenes a Storage | sustituir/eliminar |— | ⛔ no ejecutado contra Storage real — cubierto con tests del helper |
| Emails y PDF | envío Resend, PDF del cheque |— | ⛔ no ejecutado (sin entorno de pruebas de Resend) — tests existentes de plantillas ✅ |
| Navegadores | Safari/Firefox, táctil real |— | ⛔ solo Chrome; móvil emulado por tamaño |

---

## 4. Incidencias corregidas

| ID | Repo | Módulo | Severidad | Tipo | Problema | Causa raíz | Solución | Estado |
|---|---|---|---|---|---|---|---|---|
| W-01 | web | Carta de vinos | **ALTA** | Bug confirmado (producción) | «Mostrar más» repite vinos y omite otros (prod: 4 repetidos, 4 nunca visibles) | Orden paginado `categoria, orden` sin desempate; 184/207 vinos empatan y Postgres no garantiza el mismo orden entre consultas | Desempate `id` en la consulta y en el orden del SSG de vinos (la semilla coincide con la primera página) | ✅ Corregido y verificado con datos reales |
| W-02 | web | Carta de vinos | **ALTA** | Bug confirmado (producción) | El buscador no encuentra vinos fuera de las 24 primeras (prod: «Pousada» → «No hay vinos») | Filtra en cliente solo lo cargado; desde que la carta abre en «Todos» (207 vinos) afecta a casi todo el catálogo | Con búsqueda activa se carga el resto de la categoría en una petición; sin reintento en bucle si falla | ✅ Corregido y verificado con datos reales |
| W-03 | web | Carta de vinos | MEDIA | Bug confirmado | El refresco automático (60 s, foco, red) encoge la lista a 24 fichas mientras se lee la 40 | El refresco pedía solo la primera página | Pide tantas filas como hay a la vista | ✅ |
| W-04 | web | Carta de bebidas | BAJA | Bug confirmado | Buscador limitado a 24 (prod: «Cervezas» tiene 25) y «TODAS» sin desempate (63/75 empatan) | Mismo patrón que W-01/W-02 | Mismo arreglo | ✅ |
| W-05 | web | Cheques (compra) | MEDIA | Bug confirmado | 5 € o 1.500 €: se rellena todo el asistente y el servidor lo rechaza al final | El cliente solo validaba `> 0` (`min="1"`) frente a 10–1000 € del servidor | Validación con los mismos límites antes de abrir el asistente + `min/max` en el campo + texto en es/en/fr | ✅ |
| W-06 | web | Cheques (compra) | MEDIA | Bug confirmado | Doble clic → 2 peticiones: 2 cheques pendientes y 2 sesiones de Stripe | El botón se deshabilita en el siguiente render; dos clics en el mismo instante pasan | Guardia síncrona con `useRef` | ✅ |
| W-07 | web | Cheques (compra) | BAJA | Bug confirmado | Sin conexión se muestra «Failed to fetch» (en inglés) | Se mostraba `error.message` del `TypeError` de `fetch` | Mensaje propio traducido; reintento posible | ✅ |
| W-08 | web | Infra de tests | MEDIA | Deuda (tests) | 235 tests fallan con Node ≥25 | Node 25 expone un `localStorage` global sin métodos que tapa al de jsdom | Almacén en memoria en `setup.ts` solo si el de jsdom no funciona | ✅ |
| A-01 | panel | Carta (todas) | **ALTA** | Bug confirmado (riesgo de datos) | Borrar una ficha o quitarle la foto borra un fichero que otra ficha usa (prod: 9 pares normal/Magnum) y la foto se borraba antes que la fila | Borrado del objeto de Storage sin comprobar referencias y en orden inverso | `borrarFotoSiNoSeUsa()`: solo borra si nadie más lo usa (ante error, conserva); fila primero, foto después; modales: foto antigua tras guardar | ✅ (Platos, Vinos, Bebidas, Cócteles) |
| A-02 | panel | Carta (todas) | MEDIA | Bug confirmado | Un `DELETE` denegado por RLS (0 filas) se mostraba como «eliminado» | PostgREST no da error cuando la RLS filtra la fila | Se verifica que el borrado afectó a una fila | ✅ |
| A-03 | panel | Facturación | **ALTA** | Bug confirmado | IVA/descuentos/retenciones con 1 céntimo de menos en medio céntimo exacto (21,50 € al 21 % → 4,51 €) | `Math.round((n + EPSILON) * 100)` solo compensa números cercanos a 1 | Redondeo comercial con `toPrecision(15)`, simétrico en negativos y sin `-0` | ✅ 0 errores en 1.000.000 bases × 7 tipos |
| A-04 | panel | Instalación | MEDIA | Deuda (build) | `npm ci` falla: «nan@2.29.0 does not satisfy nan@2.30.0» | Lockfile desincronizado (dependencia opcional huérfana) | Lockfile regenerado; único cambio `nan` 2.29.0 → 2.30.0 | ✅ |
| A-05 | panel | Infra de tests | MEDIA | Deuda (tests) | 16 ficheros de test no cargan sin `.env` (y con un `.env` real podrían hablar con producción) | El cliente de Supabase lanza si faltan las variables | Variables ficticias en `vitest.config.ts` (host local inalcanzable) | ✅ |
| A-06 | panel | Auth (tests) | BAJA | Test desfasado | 5 tests de «refresco de sesión no desmonta» fallan | El mock no tenía `channel/removeChannel`, que usa el bloqueo de acceso | Mock completado | ✅ |
| A-07 | panel | Auditoría (tests) | BAJA | Test inestable | `test-auditoria.mjs` falla ~1 de cada 3 veces | Desempate por UUID aleatorio cuando dos filas comparten `created_at` en PGlite | Desempate por `xmin` | ✅ 10/10 |

---

## 5. Incidencias pendientes (documentadas, no corregidas)

| ID | Repo | Severidad | Tipo | Problema | Por qué no se ha corregido / propuesta |
|---|---|---|---|---|---|
| P-01 | BD | MEDIA | Seguridad (posible) | Escritura en `novedades`, `resenas`, `espacios_reserva`, `planos_espacio`, `imagenes_base64` y `config_google_places` permitida a **cualquier autenticado** (`auth.uid() IS NOT NULL`), sin permiso de sección. Hoy hay 4 usuarios, todos con rol y permisos: sin indicios de abuso. | Cambiar RLS en producción requiere autorización. Propuesta: sustituir por `can_write_section('gestion_web')` (o la sección que corresponda) como el resto de tablas, y **desactivar el registro público** en Supabase Auth si no se usa. Mismo patrón que ya se aplicó a Storage en `20261001190000`. |
| P-02 | BD | BAJA | Seguridad (endurecimiento) | `anon` y `authenticated` conservan todos los privilegios de tabla sobre `cheques_regalo`; solo la RLS (sin políticas permisivas) lo bloquea. Comprobado: lectura anónima → 0 filas. | `revoke all on public.cheques_regalo from anon, authenticated;` (defensa en profundidad). |
| P-03 | BD | BAJA | Seguridad | `is_admin(uuid)` / `is_super_admin(uuid)` y las RPC de facturación OficiosOsIA son ejecutables por `anon` (las de facturación se protegen dentro con `is_super_admin(auth.uid())`). | `revoke execute ... from anon`. |
| P-04 | BD | BAJA | Seguridad (config) | Protección de contraseñas filtradas (HaveIBeenPwned) desactivada en Supabase Auth. | Activar en el dashboard. |
| P-05 | ambos | MEDIA | Seguridad (dependencias) | `npm audit`: panel 2 críticas / 34 altas, web 3 / 30. En el navegador: `jspdf` (crítica, PDF de cheques/facturas), `fabric` (XSS en exportación SVG, planos), `react-router-dom` (open redirect). El resto son de herramientas de desarrollo/build. | Requiere actualizaciones (algunas mayores: `jspdf` 3→4, `fabric` 6→7) con su propia regresión. Rama aparte recomendada. |
| P-06 | panel | MEDIA | Bug de diseño | `rebuild-webs`: un cambio dentro del antirrebote de 10 min queda «pendiente» y solo se dispara con **otra llamada posterior**; no hay cron. Las páginas de platos son estáticas: el último cambio de una sesión de edición puede no publicarse hasta la siguiente edición, mientras el panel lo presenta como «en curso». Hoy la web está al día (último build posterior a todas las modificaciones). | Requiere un `pg_cron` o un disparo diferido y desplegar la función (autorización). |
| P-07 | panel | MEDIA | Posible bug | La CSP del panel (`connect-src 'self' https://*.supabase.co`, `script-src 'self'…`) no permite `api.vapi.ai` ni `*.daily.co`: el simulador de llamadas de Superadmin › Asistente telefónico probablemente no funciona en producción. | No verificado en ejecución: exige sesión de superadmin y lanzaría una llamada real con coste. |
| P-08 | web | MEDIA | Configuración/SEO | La web React (`casa-tomas-story.vercel.app`) declara canónicas, hreflang y sitemap en `restaurantecasatomascrevillente.es`, que hoy sirve WordPress (esas rutas dan 404). | Se resuelve al migrar el dominio a Vercel; mientras tanto la web nueva no es indexable correctamente. |
| P-09 | web | — | Regla de negocio | El encargo pide abrir la carta de vinos en «Tintos Ribera»; el commit `3b6c8db` la abre en «Todos» a propósito. | **No modificado.** Si se quiere volver a Ribera, es un cambio de una línea en `CartaVinos.tsx` (y la semilla en `Vinos.tsx`). |
| P-10 | web | BAJA | Bug | Las páginas 404 dan errores de hidratación React (#418/#423); React se recupera y la página se ve bien. | Limitación del 404 estático único de SSG frente a rutas distintas. |
| P-11 | web | BAJA | Accesibilidad/SEO | `/reservas` (es/en/fr) no tiene `<h1>` (el título es `<h2>`). | Cambio visual/semántico menor. |
| P-12 | web | BAJA | Mejora | Precios con punto y sin céntimos fijos en toda la carta («18.5€»; 49 vinos con decimales). | Patrón antiguo y consistente; cambiarlo es un cambio visual. |
| P-13 | panel | BAJA | Incoherencia | En el listado de cheques, el contador «Canjeados» incluye cheques reembolsados que estaban canjeados, mientras el filtro los muestra como «Cancelados». 0 casos en producción. | Ajuste del RPC `listar_cheques_regalo_v3` (migración). |
| P-14 | web | BAJA | Bug | Lo tecleado en el importe del cheque antes de que la página hidrate se pierde (detectado al automatizar). | Poco probable en uso humano. |
| P-15 | panel | BAJA | Robustez | La tarjeta de Resend tumba la pestaña Marketing › Suscriptores si la función respondiera 200 sin `configurado` (la versión desplegada siempre lo envía). | `if (error \|\| !estado?.configurado)`. |
| P-16 | web | BAJA | Seguridad/integridad | `cheques-regalo-admin` acción `eliminar` borra cualquier cheque (incluso pagado) sin mirar su estado; no está expuesta en la interfaz (y falla si ya tiene factura por la clave foránea). | Limitar a no pagados o retirar la acción. |
| P-17 | web | BAJA | Robustez | El webhook de Stripe responde 500 si la sesión o el importe no coinciden con el cheque: Stripe reintentará durante días un evento que nunca se arreglará. | Registrar y responder 200 en ese caso concreto. |
| P-18 | panel | — | Deuda | Edge Functions en el repo sin desplegar ni usar (`buscar-precios-mercado`, `enviar-imagen-webhook`, `vapi-analytics`); `CartaPlatos.tsx` en la web sin uso; tipos de Supabase desfasados en la web (columnas `fecha` de `menus_diarios`/`tapas` existen en BD). | Limpieza. |
| P-19 | ambos | — | Deuda | Typecheck y ESLint en rojo de antes (panel 20/480, web 21/10). No hay CI en `main`. | CI propuesta en `.github/workflows/ci.yml` (no bloquea por ahora en typecheck/lint). |
| P-20 | ambos | BAJA | Tests inestables por tiempos | Web: `VistaRegaloCompra.test.tsx` (1 fallo por *timeout* bajo carga). Panel: `SubidaFacturas.sustituir`, `PlanoEspacio2D.asignacion`, `PlanoEspacio2D.tactil`, `GestorReservasKanban.mapa`, `VistaHoy.altura`, `EditorFacturacion` fallan a veces con la máquina muy cargada o con cobertura (esperas de 1 s de Testing Library y `testTimeout` de 5 s). Los fallos coincidieron con una carga media del sistema muy alta (≈24 a 15 min) y cambiaban de test en cada ejecución; con la máquina descargada pasaron 4/4 en la rama y 7/7 en `origin/main` (en la base no llegó a observarse ningún fallo). No se han modificado esos componentes, salvo que `EditorFacturacion` usa `modelo.ts` (redondeo corregido): su suite de facturación pasó 5/5 en repetición. | Subir `testTimeout`/esperas en esos ficheros o en la config de CI. |
| P-21 | — | — | No verificable | Función Deno del webhook de Stripe, envío de emails, PDF en navegador, Vapi, Safari/Firefox, táctil real. | Ver §7. |

---

## 6. Resultados de testing

### 6.1 Línea base (antes de tocar nada, `origin/main`)

| | Panel | Web |
|---|---|---|
| `npm ci` | ❌ lockfile desincronizado | ✅ |
| Tests (Node 25, sin flags) | no medido (ejecución interrumpida para repetirla con el flag) | 365 ✅ · 235 ❌ (`localStorage` de Node 25) |
| Tests con `--no-experimental-webstorage` | 5.990 ✅ · 5 ❌ · 1 omitido · 16 ficheros sin cargar (falta `.env`) | 599 ✅ · 1 ❌ (timeout; pasa en aislado 2/2) |
| Los 18 ficheros afectados, con variables ficticias | 220 ✅ · 5 ❌ (`authRefrescoNoDesmonta`, mock desfasado) | — |
| E2E | — (no hay) | 46 ✅ |
| Build | ✅ | ✅ (57 páginas) |
| Typecheck | 20 errores | 21 errores |
| ESLint | 480 errores / 43 avisos | 10 errores / 21 avisos |

### 6.2 Final (ramas de auditoría, instalación limpia con `npm ci`)

| | Panel | Web |
|---|---|---|
| `npm ci` | ✅ | ✅ |
| Tests unitarios/componentes (vitest, Node 25 sin flags) | **6.190 ✅ · 0 ❌ · 1 omitido** (315 ficheros) | **605 ✅ · 0 ❌** (54 ficheros) |
| Pruebas SQL en PGlite | `test:cheques:db` 41 ✅ · `test:auditoria:db` 145 ✅ (10/10 ejecuciones) · `verificar-auditoria` ✅ · `verificar-bloqueo-usuarios` ✅ · `verificar-gestion-superadmin` ✅ | — |
| E2E (Playwright, Chrome del sistema) | — | **58 ✅ · 0 ❌** (46 previos + 12 nuevos), dos ejecuciones completas seguidas |
| Build de producción | ✅ | ✅ (57 páginas, HTML verificado, sitemap con 48 URLs) |
| Typecheck | 20 errores (= línea base) | 21 errores (= línea base) |
| ESLint | 480 errores / 43 avisos (= línea base) | 10 errores / 21 avisos (= línea base) |
| Tests nuevos que fallaban antes de cada corrección y pasan después | 10 (redondeo 6, fotos 4) | 5 unitarios (vinos 3, bebidas 2) + 3 E2E de cheques (rango, doble clic, sin red) |

Durante la verificación final un escenario E2E propio (doble clic) falló por una espera mal planteada en el test (no del producto): se corrigió (`7229916`) y la suite pasó completa dos veces seguidas. En una ejecución de estrés (`--repeat-each 3`, 36 ejecuciones en paralelo) 1 escenario agotó el tiempo **al crear el contexto del navegador** por saturación de la máquina; no es un fallo funcional.

### 6.3 Pruebas contra producción (solo lectura)

- **Web pública:** 52 URLs (48 del sitemap + 4 de control) × 2 anchos = 104 cargas: todas las del sitemap 200, 0 errores JS, 0 peticiones fallidas, 0 imágenes rotas, 0 desbordes, título/idioma/description correctos. 404 correctos con `noindex`.
- **Panel sin sesión:** 13 rutas × 2 anchos: privadas → login, 0 peticiones de datos, 0 errores.
- **Panel con Supabase simulado** (build local contra un host inalcanzable, sesión ficticia de superadmin, todo interceptado en el navegador, sin pulsar «guardar»): 20 rutas y todas sus pestañas × 375/820/1280 px → **0 desbordes horizontales**. Dos señales analizadas y descartadas como artefactos del simulador: Marketing › Suscriptores caía en el ErrorBoundary porque la respuesta simulada no traía `configurado` (la función desplegada siempre lo envía; queda la mejora defensiva P-15), y Gestor de gasto mostraba «Cargando» a los 3,5 s porque React Query reintentaba la respuesta inválida del simulador (no es una carga infinita).
- **API anónima:** tablas sensibles 0 filas / *permission denied*; RPC de cheques *permission denied*.
- **Datos:** cheques (17, sin incoherencias), carta (D.O., duplicados, empates), migraciones, funciones, cron, despliegues.

### 6.4 Cobertura

Configurada con `@vitest/coverage-v8` en ambos repos (`npm run test:coverage`). Medida en las ramas de auditoría:

| | Líneas | Sentencias | Funciones | Ramas | Ámbito medido |
|---|---|---|---|---|---|
| Panel | 52,07 % | 50,86 % | 49,11 % | 47,26 % | `src/hooks`, `src/config`, `src/components` (configuración del repo) |
| Web | 76,56 % | 76,56 % | 71,28 % | 81,55 % | `src/**` salvo UI de shadcn e integraciones |

Con la instrumentación de cobertura algunos tests pesados de UI del panel fallan por tiempos (distintos en cada ejecución; ver P-20). Sin cobertura, la suite completa del panel dio 0 fallos en las 3 ejecuciones completas realizadas.

### 6.5 Evidencias relevantes

```
# Producción, carta de vinos (antes de la corrección)
{"inicial":24,"clicsMostrarMas":8,"totalFichas":207,"distintas":202,
 "repetidos":["Vila do Corpus","Terras Gauda","Pazo Vedoira Camelia","Ruinart Rosé","Pazo la Cuesta"]}
{"buscado":"Pousada","resultados":0,"encontrado":false,"mensajeVacio":true}

# Rama de auditoría, mismos datos reales de Supabase
{"inicial":24,"clicsMostrarMas":8,"totalFichas":207,"distintas":206,"repetidos":["Pazo la Cuesta"]}
{"buscado":"Pousada","resultados":1,"encontrado":true,"mensajeVacio":false}

# Redondeo de facturas (antes → después), 1.000.000 de bases de 0,01 a 10.000 €
IVA 21%: 478 → 0 errores · IVA 10%: 4573 → 0 errores · IVA 4%: 0 → 0
# Tras la corrección, también 0 errores al 7, 15, 33 y 50 %

# Compra de cheques en navegador (antes de la corrección)
doble clic → 2 peticiones /cheques-regalo-web/crear
sin red   → alerta "Failed to fetch"
5 €       → se abre el asistente de 9 pasos
```

---

## 7. Lo que no se ha podido comprobar

- **Escrituras reales** (crear/editar/eliminar platos, vinos, novedades, subir fotos, emitir facturas, canjear cheques): prohibido en producción y no hay entorno aislado (una rama de Supabase tiene coste y requiere tu autorización). Cubierto con tests, PGlite y mocks.
- **Webhook de Stripe ejecutado de verdad:** no hay Deno en la máquina y el conector de Stripe requiere autorización. Se verificaron su código y, en PGlite, exactamente las sentencias SQL que lanza.
- **Envío de emails (Resend) y PDF del cheque/factura en el navegador.**
- **Pantallas autenticadas del panel con datos reales:** sin credenciales (y no se deben introducir). Se recorrieron con sesión y datos simulados.
- **Simulador de llamadas Vapi** (P-07) y **Safari/Firefox/táctil real**.
- **Ajuste «registro público» de Supabase Auth** (condiciona la gravedad de P-01).

---

## 8. Archivos modificados

### Panel (`adminpanelct`, rama `audit/regresion-2026-10-18`)

| Archivo | Cambio y motivo |
|---|---|
| `package-lock.json` | `nan` 2.29.0 → 2.30.0 para que `npm ci` funcione (A-04). |
| `package.json` | Script `test:cheques:db`. |
| `vitest.config.ts` | Variables de Supabase ficticias para los tests (A-05). |
| `src/hooks/__tests__/authRefrescoNoDesmonta.test.tsx` | Mock de `channel/removeChannel` (A-06). |
| `scripts/test-auditoria.mjs` | Desempate determinista (A-07). |
| `scripts/test-cheques-regalo.mjs` | **Nuevo.** Ciclo completo de cheques en PGlite con las funciones reales (41 comprobaciones). |
| `src/components/facturacion/modelo.ts` | `redondear()` correcto (A-03). |
| `src/components/facturacion/__tests__/modelo.redondeo.test.ts` | **Nuevo.** Regresión del redondeo, incluido barrido exhaustivo. |
| `src/lib/storage-carta.ts` | **Nuevo.** `rutaEnBucket()` y `borrarFotoSiNoSeUsa()` (A-01). |
| `src/hooks/use{Platos,Vinos,Bebidas,Cocteles}.ts` | Fila antes que foto, verificación de 0 filas y foto solo si no se usa (A-01, A-02). |
| `src/components/carta/Editar{Plato,Vino,Bebida,Coctel}Modal.tsx` | La foto antigua se borra tras guardar y con la misma comprobación (A-01). |
| `src/hooks/__tests__/useVinos.eliminarFoto.test.tsx`, `src/lib/__tests__/storage-carta.test.ts` | **Nuevos.** Regresión A-01/A-02. |
| `.github/workflows/ci.yml` | **Nuevo.** CI propuesta. |
| `REGRESSION_AUDIT.md` | Este informe. |

### Web (`casa-tomas-story`, rama `audit/regresion-2026-10-18`)

| Archivo | Cambio y motivo |
|---|---|
| `src/components/carta/CartaVinos.tsx` | Desempate `id`, buscador sobre la categoría completa, refresco sin colapsar (W-01, W-02, W-03). |
| `scripts/carta-ssg.mjs` | Desempate `id` solo para Vinos en el SSG (la semilla coincide con la primera página). |
| `src/components/carta/CartaBebidas.tsx` | Mismo arreglo para bebidas (W-04). |
| `src/components/ContactoSection.tsx` | Rango 10–1000 €, guardia de doble envío, mensaje de red traducido (W-05, W-06, W-07). |
| `src/i18n/languages/{es,en,fr}.ts` | Texto `giftAmountRange`. |
| `src/__tests__/setup.ts` | Web Storage operativo con Node ≥25 (W-08). |
| `src/__tests__/CartaVinos.paginacion.test.tsx`, `src/__tests__/CartaBebidas.busqueda.test.tsx` | **Nuevos.** Regresión W-01…W-04. |
| `e2e/carta-cheques.e2e.ts` | **Nuevo.** 12 escenarios E2E: carta de vinos, compra de cheques, barrido responsive. |
| `.github/workflows/ci.yml` | **Nuevo.** CI propuesta. |
| `REGRESSION_AUDIT.md` | Copia de este informe. |

Ningún cambio toca migraciones, Edge Functions desplegadas, datos de producción, pagos, facturas emitidas ni cheques.

---

## 9. Recomendaciones

1. **Fusionar las dos ramas de auditoría** tras revisarlas (PR por repo); ninguna requiere migración ni despliegue de funciones.
2. **Activar la CI** propuesta (`.github/workflows/ci.yml`) y exigirla en las PR; dejar de hacer push directo a `main`, que despliega a producción sin revisión.
3. **Cerrar P-01** (RLS de escritura por sección + desactivar el registro público si no se usa) y aplicar los endurecimientos P-02/P-03/P-04.
4. **Rama de actualización de dependencias** (P-05), empezando por `jspdf`, `fabric` y `react-router-dom`, con la suite completa y la E2E como red.
5. **Publicación garantizada** (P-06): un `pg_cron` cada 5 minutos que procese `web_rebuild_state.pendiente`, o un disparo diferido al final del antirrebote.
6. **Regla de paginación:** toda consulta paginada debe acabar en una columna única (`id`). Revisar cualquier `.range()` nuevo con ese criterio.
7. **Entorno de pruebas aislado** (rama de Supabase o proyecto de staging con Stripe en modo test) para poder ejecutar los flujos de escritura de punta a punta: crear plato → ver en web, pagar cheque test → webhook → canje.
8. **Fijar la versión de Node** del proyecto (`engines` y `.nvmrc`, p. ej. 22 LTS) para que los resultados de los tests no dependan de la máquina.
9. **Decidir P-09** (vista inicial de la carta de vinos) y **P-08** (migración del dominio).
10. Regenerar los tipos de Supabase en la web y empezar a bajar a cero los errores de typecheck/ESLint para poder hacerlos bloqueantes.
