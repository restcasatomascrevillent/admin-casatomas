# Facturas de Casa Tomás · documento maestro

Para personas y para agentes de IA que vayan a mantener o mejorar la sección **Facturas** del
panel (`admin-casatomas`). Estado a **06/11/2026**.

Documentos hermanos:

- [CONOCIMIENTO-OCR.md](CONOCIMIENTO-OCR.md): cómo «entrenar» al sistema para que lea mejor los PDF.
- [PROMPT-COMPANERO.md](PROMPT-COMPANERO.md): prompt para arrancar el agente de un compañero.
- [../PROCESO-DE-CAMBIOS.md](../PROCESO-DE-CAMBIOS.md): de staging a producción (obligatorio).
- [../tests-chatbot-facturas.md](../tests-chatbot-facturas.md): rondas de prueba del chatbot.
- [EVAL-MODELOS.md](EVAL-MODELOS.md): coste y calidad de modelos para el copiloto (07/11/2026) y cómo repetir la evaluación.
- [../../supabase/functions/DEPLOY-facturas.md](../../supabase/functions/DEPLOY-facturas.md): secretos y despliegue de las funciones.
- [../../supabase/rollbacks/README.md](../../supabase/rollbacks/README.md): un rollback por migración.
- [../../conocimiento-facturas/](../../conocimiento-facturas/): base de conocimiento (fichas de proveedor, scripts, clasificación, correcciones y paquete de importación sin PDF).

---

## 1. Qué es

El restaurante (sociedad **MASIDE 2011 S.L.U.**, CIF **B54583356**, con dos locales: **Casa Tomás** y
**Touza Cocktail Bar**) recibe facturas y albaranes de unos 170 proveedores en PDF, fotos y escaneos.
El sistema los lee con IA, los guarda con sus líneas, los clasifica por producto y familia y permite
analizar el gasto. **MASIDE es siempre el CLIENTE, nunca el proveedor.**

La pantalla `Facturas` (`src/pages/Facturas.tsx`) tiene tres pestañas:

| Pestaña | URL | Qué hace | Código |
|---|---|---|---|
| **Análisis** | `?tab=chat` (nombre histórico) | Tablero fijo de gasto, explorador (medida × eje × color × filtros), «Ver documentos» desde cualquier cifra con visor del PDF, copiloto de IA plegado en un panel lateral | `src/components/facturas/analisis/*`, `copiloto/*`, `ChatFacturas.tsx` |
| **Compras** | `?tab=compras` | Lista de documentos por mes y proveedor (ligera), ficha del documento con sus líneas, búsqueda en servidor, proveedores y productos | `src/components/facturas/compras/*`, `shared/*`, `productos/*` |
| **Cargar** | `?tab=cargar` | Subida con OCR (cola en segundo plano), «Importación histórica» (solo admin) y monitor de gasto de IA | `SubidaFacturas.tsx`, `ColaSubidaProvider.tsx`, `ImportacionHistoricaDialog.tsx`, `MonitorGastoIA.tsx` |

Datos de la demo a 06/11/2026: unos **1.900 documentos**, **~12.500 líneas**, **1,4 M€** de gasto,
**2.235 productos** de catálogo y **4.057 alias**, casi todo del histórico del zip de la gestoría
(«FACTURAS CONTABILIZADAS», 1.673 PDF, de febrero de 2025 a noviembre de 2026).

---

## 2. Arquitectura

### 2.1 Tablas principales

| Tabla | Para qué |
|---|---|
| `facturas` | Cabecera de **facturas, albaranes y abonos** (`tipo` solo admite `factura` y `albaran`: un abono es una factura con importes negativos). Columnas clave: `proveedor_id`, `numero_documento`, `fecha`, `subtotal`, `iva`, `total`, `retencion_irpf`, `retencion_irpf_pct`, `local`, `import_clave` (único, `zip2026:Rxxx.pdf#i`), `facturado_en_id` (albarán → su factura), `drive_url`, `archivo_path` (solo temporal), `verificada`/`verificacion_origen`, `alertas_validacion` |
| `productos_factura` | Líneas. `nombre`, `cantidad`, `unidad`, `precio_unitario`, `total`, `iva_pct`, `bultos`, `contenido_cantidad`/`contenido_unidad`, `descuento_pct`, `importe_bruto`/`importe_bruto_estimado`, `producto_id` (catálogo). Columnas generadas: `nombre_normalizado`, `nombre_busqueda`, `raices_nombre`, `palabras_nombre` (no se insertan nunca) |
| `proveedores`, `proveedores_alias` | Proveedor canónico (`normalizar_proveedor` + trigger) y sus variantes de nombre. `proveedores.notas_ia` = indicaciones para el OCR |
| `productos_catalogo`, `productos_alias`, `categorias_producto` | Catálogo de productos, textos de línea ya asignados (el trigger asigna solo) y familias en árbol (`clave` del tipo `pescado_marisco.conservas`) |
| `nombres_linea_no_producto` | Caché «¿esta línea es producto o servicio/portes/envase?» con trigger; la leen el tablero y el explorador |
| `ocr_trabajos`, `ocr_trabajo_paginas` | OCR en segundo plano de documentos largos, por piezas |
| `chat_facturas_conversaciones`, `chat_facturas_mensajes` | Historial del copiloto |
| `configuracion_facturas`, `ia_uso`, `notificaciones_dashboard` | Umbrales, gasto de IA y avisos (campana) |

### 2.2 RPC clave (Postgres; casi toda la lógica vive en SQL)

| RPC | Migración | Uso |
|---|---|---|
| `documentos_lista()` | `20261105190000_compras_lista_ligera` | TODAS las cabeceras en un JSON compacto `{v:1, proveedores, docs:[[…]]}` (~0,55 MB, ~0,1 s): nº de líneas, avisos, regalado, precio atípico, meses incompletos ya calculados |
| `documento_compras(id)` | ídem (+ `20261106300000`) | Ficha de un documento con líneas, ruta de familia, media de referencia y retención |
| `buscar_documentos_compras(texto)` | ídem | Ids de documentos que contienen cada palabra (cabecera, observaciones o líneas), sin tildes |
| `tablero_compras(desde, hasta, local)` | `20261105150500` (+ `191000`, `20261106120000`, `310000`) | Todo el tablero de Análisis en una llamada |
| `explorar_compras(…)`, `documentos_de_cifra(…)` | `20261105170000` | Explorador y «Ver documentos». Leen la MISMA tabla de hechos: la lista de documentos cuadra con la cifra por construcción |
| `meses_compras_incompletos(local)` | `20261106310000` | Meses con datos parciales (ver 3.7) |
| `facturas_alertas_activas(desde, hasta, local)` | `20261107300000` | Alertas vigentes para Análisis («Requiere atención» y marcas en las gráficas). Las genera `facturas_generar_alertas()` (SECURITY DEFINER, solo service_role) con el cron `facturas-alertas` (06:15 UTC) en `notificaciones_dashboard` (`clave` sin duplicar, `caduca_en`, `datos`). Ver 3.13 |
| `proveedores_listado()` | `20261105130000` | Totales por proveedor sin albaranes ya facturados |
| `*_agente` (≈40: `resumen_periodo_agente`, `estadisticas_globales_agente`, `buscar_facturas_agente`, `buscar_productos_agente`, `detalle_documento_agente`, `ficha_proveedor_agente`, `variacion_precios_agente`, `serie_precios_agente`, `gasto_categorias_agente`, `albaranes_facturados_agente`…) | varias | Herramientas del chatbot (`chat-facturas/herramientas.ts`). Una RPC precisa por tipo de pregunta, para gastar pocos tokens |
| `productos_aplicar_clasificacion_ia(items)` | `20261007160000` | Aplica clasificaciones (crea productos y alias, asigna líneas) |
| `vincular_albaran_factura(alb, fac)`, `vincular_albaranes_proveedor()` | `20261010110000`, `20261105120500` | Albarán → factura (manual o por cita del nº de albarán) |
| `verificar_duplicado_factura(…)` | antigua | Deduplicación del OCR |

### 2.3 Edge Functions

| Función | JWT | Qué hace |
|---|---|---|
| `procesar-factura` | sí | OCR síncrono de un documento: imagen/PDF → OpenAI Vision (modelo en `modelo.ts`, por defecto `gpt-5.6-luna`, cambiable con `OCR_MODELO`) → normalización → validación y cuadre (`calidad.ts`, `consolidacion.ts`) → guardado (`guardado.ts`) → embeddings → original a Drive (`archivo.ts`). Añade al prompt las `notas_ia` de proveedores (`indicaciones.ts`) |
| `ocr-trabajo` | no (`x-ocr-secret`) | Mismo OCR en segundo plano por piezas para documentos largos; la llama Postgres (`ocr_despachar`, cron `reanudar-trabajos-ocr`) |
| `importar-factura-historica` | sí (admin) | Carga una factura ya extraída a JSON (formato de `conocimiento-facturas/INSTRUCCIONES-EXTRACCION.md`) + su PDF a Drive, **sin OCR**, por el mismo camino de guardado |
| `facturas-originales-drive` | no (`x-ocr-secret` o JWT admin) | Rescata a Drive lo que quedó en Storage; cron cada 10 min |
| `chat-facturas` | sí | Copiloto: bucle de *function calling* sobre las RPC `*_agente` |
| `clasificar-productos` | no (`x-ocr-secret` o JWT con edición) | Clasifica las líneas nuevas que no casan con ningún alias (cron cada 5 min o botón «Clasificar con IA») |

Secretos: `OPENAI_API_KEY`, `OCR_TRABAJOS_SECRET` (también en Vault como `ocr_trabajos_secret`),
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_PARENT_FOLDER_ID`.
Opcionales: `OCR_MODELO`, `CLASIFICAR_PRODUCTOS_MODELO`. **Nunca se pegan en el chat ni en el repo;**
los mete el dueño en Supabase → Edge Functions → Secrets. Guía de Drive:
[`conocimiento-facturas/GUIA-DRIVE-CUENTA-NUEVA.md`](../../conocimiento-facturas/GUIA-DRIVE-CUENTA-NUEVA.md).

---

## 3. Reglas de negocio (no romperlas)

1. **Gasto = documentos con IVA.** El gasto de un periodo o proveedor suma `facturas.total` (con IVA,
   neto de retención). Cuando se agrupa por **familia, producto o unidad** se suman **líneas** y la
   medida pasa a **base sin IVA**. Por eso «suma de familias» ≠ «gasto»: es correcto.
2. **Importe de una línea = solo `productos_factura.total`.** Nunca `coalesce(total, cantidad × precio)`
   (descuadraba 1.139,70 € en 2026).
3. **Los albaranes ya facturados no suman** (`facturado_en_id is not null`): su importe está en la
   factura. Los albaranes sin factura sí suman (son gasto real pendiente de facturar).
4. **`local` NULL = Casa Tomás.** Valores: `casa_tomas`, `touza`. Lo que solo dice «MASIDE 2011» va a
   Casa Tomás con una alerta.
5. **Abonos**: tipo `factura` con importes (y cantidades) negativos. Las devoluciones de envases con IVA
   pueden dejar el IVA de una factura positiva en negativo y es correcto (Tabarca, Santacruz).
6. **Regalado / 100 % de descuento**: `total = 0`, `descuento_pct = 100`, `importe_bruto = cantidad ×
   precio` (lo que vale). Si el precio no está impreso, `importe_bruto` se estima con el último precio
   del proveedor y `importe_bruto_estimado = true`. El panel lo enseña como «Valor sin descuento».
7. **Retención IRPF** (alquileres, profesionales): `facturas.retencion_irpf` con el mismo signo que la
   base (NULL = sin retención) y `retencion_irpf_pct`. `total = subtotal + iva − retencion_irpf` (lo
   pagado). Explicada al chatbot en la nota de `detalle_documento_agente`, no en el prompt (está al
   límite de tamaño).
8. **Meses incompletos**: un mes con < 40 % de los documentos de la mediana de los 12 últimos meses con
   datos, si es uno de los 3 últimos o del arranque del histórico, se marca incompleto y no se calcula
   su variación (el zip de la gestoría acaba el 23/10/2026).
9. **Variación vs periodo anterior** solo si el anterior tiene ≥ 50 % de documentos.
10. **Precios atípicos**: > 3× o < 1/3 de la mediana con ≥ 3 compras.
11. **Originales SOLO en Google Drive** (carpeta proveedor → «AAAA-MM Mes»). El bucket
    `facturas-originales` de Storage es **temporal**: `pendientes/{uid}/{trabajo}/` mientras dura el OCR
    y `temporal/…` si Drive falla; el cron `facturas-originales-drive` lo sube y lo borra. Orden del
    dueño: «no se puede guardar nada en Supabase Storage». Demo y producción comparten la carpeta de
    Drive: no importes el histórico en las dos.
12. **Nunca inventar ni «arreglar» un importe.** Si algo no cuadra se deja lo impreso y una alerta.
13. **Alertas diarias** (`20261107300000_facturas_alertas`, umbrales en `configuracion_facturas.alertas`;
    el % de subida es `umbral_subida_precio_pct`): subida de precio (última compra > 10 % sobre la
    mediana de los 90 días anteriores, mismo proveedor y texto de línea, €/kg o €/l si se conoce el
    envase; alta si > 25 % o ≥ 500 € en 90 días), más barato en otro proveedor (mismo producto del
    catálogo, €/kg o €/l, 15-45 % más barato con ≥ 2 compras), gasto de una familia (mes en curso
    proyectado desde el día 10 o último mes completo > 25 % sobre la media de los 6 meses completos
    anteriores), albaranes sin factura > 35 días (no si el mes siguiente está incompleto), proveedor
    nuevo (45 días), importe > 3× la media del proveedor (sin luz/alquiler/servicios) y revisión
    (duplicados probables y avisos de lectura sin revisar > 7 días). Nunca cuentan portes, envases,
    energía ni Servicios/Menaje, ni albaranes ya facturados, ni precios atípicos. Lo que deja de
    cumplirse caduca (y queda leído) en la pasada siguiente.

## 4. Reglas de rendimiento

- **RLS siempre `USING ((select can_read_section('facturas')))`** (o `can_write/edit_section`), envuelto en
  `select` para que se evalúe una vez por consulta. Sin envolver, el tablero pasó de 0,5 s a 3 s.
  `20261105200000_rls_permisos_una_vez` lo arregla de forma idempotente; vuelve a pasarla al final de
  cada tanda de migraciones.
- **Nada en el cliente puede descargar las ~12.500 líneas.** La lista usa `documentos_lista()` y la ficha
  `documento_compras(id)`; todo cálculo agregado va en SQL.
- **Columnas precalculadas** (`raices_nombre`, `palabras_nombre`, `nombre_busqueda`) y cachés con
  trigger (`nombres_linea_no_producto`). Añadir una columna generada a `productos_factura` reescribe la
  tabla y su índice HNSW (> 2 min): mejor caché con trigger.
- Funciones SQL con `SET search_path` no se *inlinean* (10-20 µs por llamada): no llamarlas fila a fila
  sobre 12.500 líneas. Ojo también al revés: hacer *inlineable* `es_linea_no_producto_tablero` cambió el
  plan de `tablero_compras` a 2 min.
- Disparadores **FOR EACH STATEMENT** con tablas de transición (`20261105120500`): con FOR EACH ROW,
  las facturas de 40-97 líneas superaban el `statement_timeout` de 8 s.
- Medidas de referencia en la demo: tablero 0,2-0,5 s, `documentos_lista` 0,1 s (0,6 s como usuario),
  búsqueda 50-110 ms, ficha ~30 ms.

---

## 5. Cómo se trabaja

- **Rama `staging`** (o rama propia fusionada en `staging`). Nunca push a `main`, nunca fusionar PR,
  nunca *force*. Commits con `git -c user.name=Claude -c user.email=noreply@anthropic.com commit` (el
  plan Hobby de Vercel bloquea otros autores; también los *merges*). Nada de `git add -A` ni
  `git clean`: puede haber otros agentes trabajando.
- **Demo primero**: Supabase `sfonaclosuafvlhutkon`. **Producción** `haqmmdfdzzatdnrrcgez` solo tras
  aceptar el dueño el PR y decir «sí». El proyecto viejo `jeamoczmbfsnwkfjxcyo` no se toca.
- **Migraciones**: `supabase/migrations/AAAAMMDDHHMMSS_nombre.sql`, **número sin repetir** (ya hubo
  colisiones: `120500` y `150500` son renumeradas), idempotentes, con un rollback en
  `supabase/rollbacks/<misma versión>_ROLLBACK.sql` y su fila en el README de rollbacks.
- **Aplicar** con la CLI global (`supabase` 2.105; `npx --no-install supabase` falla en este PC):
  `supabase db query --linked -f supabase/migrations/<fichero>.sql` desde el checkout principal (el
  enlace `.temp` está allí; desde un worktree usa `--workdir <repo principal>`). **Nunca** `db push` ni
  `migration repair`. `db query` no acepta `--project-ref` y solo devuelve la última sentencia.
- **Tests SQL**: `supabase/tests/*_test.sql`, dentro de `BEGIN … ROLLBACK`, con `temp table` + `select`
  final. Para probar como usuario del panel: `set local request.jwt.claims` con `sub` y un
  `session_id` real de `auth.sessions`. Tests de Facturas útiles: `tablero_compras_test`,
  `explorar_compras_test`, `compras_lista_ligera_test`, `facturas_cifras_coherentes_test`,
  `facturas_retencion_irpf_test`, `compras_meses_incompletos_test`, `facturas_originales_drive_test`.
  Ya fallaban antes en la demo (datos del proyecto viejo, no son regresión): los `chatbot_*_test.sql`
  antiguos, `productos_catalogo_categorias_test`, `compras_lista_ligera` T6, `ocr_trabajos_multipagina`
  T1, `albaranes_factura_cotejo`.
- **Funciones**: `npx supabase functions deploy <función> --project-ref sfonaclosuafvlhutkon`. Si una
  función nueva usa `conAuditoriaDePeticion` sin JWT de usuario, hay que añadirla a
  `ADMITE_INTEGRACION` (`_shared/audit-client.ts`) y a su test, o responde 401.
- **Antes de subir**: `npm test`, `npm run test:cheques:db`, `npm run build`. Después, comprobar que
  Vercel publica la demo y decir al dueño qué probar y en qué versión.
- El dueño trabaja en **tablet**: sin scroll vertical de página (solo dentro de listas).

---

## 6. Pipeline del histórico (cómo se hizo y cómo repetirlo)

Todo lo necesario está en [`conocimiento-facturas/`](../../conocimiento-facturas/). Los scripts reciben
`<D>` = carpeta `facturas-conocimiento` y `<S>` = carpeta de trabajo con el zip extraído en
`zip_facturas/FACTURAS CONTABILIZADAS/` y PyMuPDF en `pylib/`. Ejecutar siempre con `python -I -X utf8`.
Varios scripts de `correcciones/` llevan rutas absolutas del PC del dueño: cámbialas antes de usarlos.

1. **Inventario e identificación del proveedor** (`scripts/inventario.py`, `cifs.py`, `unir_fase1.py`)
   → `mapa_proveedores.json` (PDF → CIF, nombre, categoría) y `proveedores_zip.csv`. El CIF del cliente
   (B54583356) se excluye; se elige el CIF más repetido; Makro no imprime CIF (regla por nombre).
2. **Ficha por proveedor** (`scripts/muestras_fichas.py` + agentes con
   [`INSTRUCCIONES-FICHA.md`](../../conocimiento-facturas/INSTRUCCIONES-FICHA.md) y
   [`FORMATO-FICHA.md`](../../conocimiento-facturas/FORMATO-FICHA.md)) → `fichas/<CIF>.json`.
   `scripts/revisar_fichas.py` genera `fichas/RESUMEN.md`; las dudas van a `fichas/DUDAS-DUENO.md`.
   Hoy: **60 fichas, 1.391 productos, ~320 dudas**, que cubren 1.203 de los 1.673 PDF.
3. **Extracción por lotes** (`scripts/preparar_lote.py <D> <S> loteN CIF1,CIF2…`): texto de los PDF
   digitales con filas reconstruidas (`muestras_lineas.py`, columnas separadas por « | ») e imágenes a
   170 dpi de los escaneos. Agentes Haiku para texto, Sonnet para escaneos, 20-25 PDF por agente y
   **cada agente con su carpeta de trabajo**. Prompt:
   [`INSTRUCCIONES-EXTRACCION.md`](../../conocimiento-facturas/INSTRUCCIONES-EXTRACCION.md) (con ficha) o
   [`INSTRUCCIONES-SIN-FICHA.md`](../../conocimiento-facturas/INSTRUCCIONES-SIN-FICHA.md) (servicios,
   alquileres, no-facturas).
4. **Normalización** (`scripts/normalizar_lote.py <D> loteN`): envases del pie a línea, local de la
   ficha, signo de abonos; guarda copia en `salida_orig/`.
5. **Validación de cuadres** (`scripts/validar_lote.py <D> loteN` → `loteN/INFORME.md`): suma de líneas +
   cargos ≈ base; base + IVA + R.E. − IRPF ≈ total; cuota ≈ base × tipo; duplicados; y **identidad**
   (el nº de factura y el total tienen que estar literalmente en el texto de ESE PDF: un agente llegó a
   cruzar dos ficheros y cada uno cuadraba por sí solo). Resultado: L1 99 %, L2 100 %, L3 99 %, L4 95 %,
   L5 100 %, L6 93 %; lo que no cuadra son duplicados reales o casos con alerta. Informes en
   [`conocimiento-facturas/lotes/`](../../conocimiento-facturas/lotes/).
6. **Paquete de importación** (`scripts/preparar_importacion.py <D> <S>`) → `importar/manifest.json`
   (clave `zip2026:Rxxx.pdf#i`, páginas, proveedor, total, fecha, local), `json/` y `pdf/`. 1.857
   facturas por 1.400.554,69 €; 22 duplicados y 50 no-facturas en `fuera_de_la_carga.json`.
   **Si se vuelve a ejecutar, borra las correcciones del paso 9: hay que pasar otra vez
   `correcciones/corregir_json.py`.**
7. **Importación**: Facturas › Cargar › «Importación histórica» (admin), eligiendo la carpeta
   `importar/` **con los PDF** (la del PC del dueño, no la copia del repo). Es reanudable: lo ya
   importado no se repite. Ensayo en demo: 1.836 de 1.857; las 21 restantes en
   [`revisar_errores/LEEME.md`](../../conocimiento-facturas/revisar_errores/LEEME.md) (14 eran el
   timeout del disparador, ya arreglado; 7 duplicadas).
8. **Clasificación** ([`clasificacion/INSTRUCCIONES-CLASIFICACION.md`](../../conocimiento-facturas/clasificacion/INSTRUCCIONES-CLASIFICACION.md)):
   3.780 textos de línea → 2.103 productos con 8 agentes Sonnet y un repaso con reglas
   (`clasificacion/repaso/`, informe en [`REPASO.md`](../../conocimiento-facturas/clasificacion/REPASO.md)).
   Resultado en `items_final.json`; se aplica con `aplicar_clasificacion.sql`.
9. **Correcciones verificadas en el PDF** ([`correcciones/INFORME.md`](../../conocimiento-facturas/correcciones/INFORME.md)):
   cada cambio con su cita del original. `corregir_json.py` corrige los JSON (idempotente),
   `demo/*.sql` es lo aplicado en la demo y `aplicar_en_produccion.sql` lo que no cabe en el JSON. El
   tablero se comprueba con `verificar_tablero.sql` (SQL directo frente a `tablero_compras`).

Para **ampliar** (nuevo zip, nuevo trimestre): pasos 1 → 3 → 5 con los proveedores nuevos, ficha
primero si un proveedor tiene ≥ 3 PDF, y deduplicar contra lo que ya hay (`import_clave` y
proveedor + número). Coste orientativo: ~11 k tokens de subagente por PDF.

---

## 7. Estado actual y pasos a producción

**Producción** (`main`) está en el PR #21 (04/11/2026). Todo lo de Facturas posterior está solo en la
**demo**. Cuando el dueño acepte el PR `staging → main` y diga «sí», en este orden:

**A. Migraciones** (orden numérico; todas en la demo):

1. `20261104150000_proveedores_notas_ia`
2. `20261104170000_facturas_importacion_historica`
3. `20261105120500_vincular_albaranes_por_sentencia`
4. `20261105130000_proveedores_listado_sin_albaranes_facturados`
5. `20261105150500_tablero_compras`
6. `20261105170000_explorar_compras`
7. `20261105180000_productos_raices_precalculadas` (reescribe `productos_factura`: > 100 s; el API da 524
   pero termina; mejor por `psql`)
8. `20261105190000_compras_lista_ligera`
9. `20261105191000_analisis_rapido`
10. `20261105193000_facturas_originales_drive`
11. `20261105200000_rls_permisos_una_vez`
12. `20261106120000_facturas_cifras_coherentes`
13. `20261106130000_facturas_clasificacion_no_producto`
14. `20261106140000_chatbot_gasto_como_el_panel`
15. `20261106150000_facturas_sin_anon`
16. `20261106200000_facturas_cargar_qa`
17. `20261106300000_facturas_retencion_irpf`
18. `20261106310000_compras_meses_incompletos`
19. `20261106510000_permisos_facturas_subida` («Ver» solo consulta y permiso «Facturas · Subida»; a la vez
    que `procesar-factura`, `chat-facturas` y `buscar-precios-mercado` y el panel nuevo)
19b. `20261107300000_facturas_alertas` (alertas diarias + cron `facturas-alertas`; test
    `tests/facturas_alertas_test.sql`).
20. **Otra vez** `20261105200000_rls_permisos_una_vez` (idempotente) para envolver las políticas creadas
    después.

Comprobar además que `20261104120000_productos_factura_alertas_al_anadir_borrar` (ya en `main`) está
aplicada en producción. Las migraciones de Instagram, vinos, etc. de esa tanda son de otras secciones.

**B. Funciones** a desplegar en producción: `procesar-factura`, `ocr-trabajo`, `chat-facturas`,
`importar-factura-historica` (nueva), `facturas-originales-drive` (nueva), `buscar-precios-mercado`
(exige «Editar» desde el 06/11/2026). `clasificar-productos` no
cambió, pero comparte `_shared/`: redesplegarla también es lo seguro.

**C. Datos** (después de A y B):

1. Importar `importar/` con la pantalla de Importación histórica, **desde la carpeta del PC del dueño**
   (tiene los PDF) y con los JSON ya corregidos por `corregir_json.py`. Solo en producción (Drive
   compartido con la demo).
2. Reimportar los 14 de `revisar_errores/` (ya no deberían fallar).
3. `conocimiento-facturas/clasificacion/aplicar_clasificacion.sql` **traduciendo antes los ids**: los
   `producto_id` de `items_final.json` y los ids fijos de la cabecera del SQL (251, 298, 281, 260, 220,
   231, 106→303, 222→211, familias 2 y 4-20) son de la **demo**. Traducir por nombre con
   `clasificacion/catalogo_actual.json` (id → nombre de la demo en ese momento) y comprobar los ids de
   `categorias_producto` en producción. Tarda > 100 s.
4. `supabase/snippets/2026-11-06_retencion_irpf_historico.sql` (42 facturas, 5.920,09 €; casa por
   `import_clave`).
5. `conocimiento-facturas/correcciones/aplicar_en_produccion.sql` (usa claves estables, idempotente).
6. Comprobar con `correcciones/verificar_tablero.sql` que el tablero cuadra con el SQL directo.
7. El cron `facturas-originales-drive` sube solo a Drive lo que haya quedado en Storage.

Demo y producción tienen los secretos de Drive (el ensayo del 05/11 subió 1.826 PDF a Drive desde la
demo). Compruébalo con `supabase secrets list` (solo nombres, nunca valores).

---

## 8. Pendientes y decisiones abiertas

1. ~~**`variacion_precios_agente` tarda ~50 s**~~ Resuelto el 07/11/2026 con
   `20261107200000_variacion_precios_rapida` (una pasada por ventanas, mismos resultados: 54 s → 0,3 s con
   todo 2026; aplicada en la demo). Queda lento aparte `lineas_producto_agente('aceite')` (~3,7 s), que
   usa `variacion_precios_agente` cuando el chatbot pide un producto concreto.
2. **Factura 520 de Hermanos Narejos (nº 5419)**: faltan 90 € y probablemente los albaranes 373 y 407; el
   dueño tiene que mirar `IMG_1153.png` en Drive antes de vincular y añadir la línea.
3. **Factura 2158 de Embajadores**: aviso de CIF (carpeta B75143214 frente a B20691994 impreso).
4. ¿Fusionar «Carabinero brillante» (Colorao) con #285 «Carabinero» (Narejos)?
5. Líneas «ENVASES C0SA» de Colorao: la columna PESO quedó como precio (importe 0, no afecta cifras).
6. **Modo oscuro** del panel en Facturas: pedido, sin hacer.
7. **Volúmenes de bebida** (litros por formato): no hay documento ni trabajo en `staging` a 06/11/2026
   (no existe `docs/facturas/VOLUMENES.md`). Si se retoma, documentarlo en esa ruta y enlazarlo aquí.
8. Las **~320 dudas** de `fichas/DUDAS-DUENO.md` sin contestar por el dueño.
9. Las fichas **no se usan todavía en el OCR** (ver [CONOCIMIENTO-OCR.md](CONOCIMIENTO-OCR.md)): el siguiente
   gran paso de calidad.
10. Rangos de precio de las fichas: recalcularlos con todo el año (los de la tanda 1 tienen min = max).
11. Política de privacidad usada en la app de Google: cambiar a `/politica-privacidad` de la web nueva
    cuando el dominio se mueva.
12. Avisos para el dueño del histórico: R195 (Acciona, regularización), R1448 (Mr Frío, cambio de cuenta
    bancaria: posible fraude), R1165/R988 de Sokol (mismo nº con fechas distintas).

## 9. Trampas conocidas

- **CLI en paralelo**: varias `supabase db query` a la vez fallan con `SASL`/`28P01`. Reintentar con
  espera (ver `conocimiento-facturas/correcciones/q.sh`) y no lanzar agentes que consulten a la vez.
- **524 a los 100 s**: el API corta, pero la sentencia termina en el servidor. Comprobar el resultado
  antes de reintentar (podrías aplicar dos veces algo no idempotente).
- **`preparar_importacion.py` borra las correcciones** si se reejecuta → volver a pasar `corregir_json.py`.
- **Merges con autor Claude**: un merge con otro autor bloquea Vercel Hobby; se arregla con un commit
  vacío de Claude.
- **Vitest recoge los worktrees** sin seguimiento de `.claude/worktrees/agent-*` (decenas de fallos que
  no son reales): ejecuta los tests desde el checkout bueno o excluye esa carpeta.
- **Windows no distingue mayúsculas** en carpetas: normalizar a minúsculas las carpetas de grupo.
- **Listas para agentes completas**: nunca de una salida recortada (`cut`, `head`); se perdieron PDF así.
- **PostgREST en inserts por lotes** pone NULL en las columnas que faltan: manda todas las columnas
  NOT NULL en cada fila.
- **Secretos con salto de línea** (`GOOGLE_CLIENT_ID` con `\n` → `invalid_client`): el código hace trim;
  para diagnosticar se compara el hash de `supabase secrets list`.
- **Drive en modo «Prueba»** caduca el token a los 7 días: la app de Google tiene que estar publicada.
- `productos_factura.nombre_normalizado` es generada: no se inserta en tests.
- `ilike` con «Ó» no casa en la demo (ctype C): usar `lower(unaccent(…))`.
- La vista previa de Drive pide sesión de Google si el fichero no es público; la CSP necesita
  `frame-src https://drive.google.com https://*.supabase.co`.
- El prompt de `chat-facturas` está al límite que vigilan sus tests (~5.730 caracteres).
- El mock de `localStorage` de `src/test/setup.ts` no tiene `key()`/`length`.

## 10. Qué hay en `conocimiento-facturas/` (y qué no)

Está: fichas, instrucciones, scripts, informes de lotes, clasificación, correcciones (SQL, scripts, JSON
originales de antes de corregir), `importar/manifest.json` + `importar/json/` (1.857 JSON, ~10 MB) y
`revisar_errores/` sin PDF. **Los IBAN de las observaciones están ocultos** (`ES** … 1234`), así que esta
copia es de consulta: para importar se usa la carpeta del PC del dueño.

No está (por tamaño o por ser datos sensibles; sigue en
`C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\facturas-conocimiento\` del dueño y los originales
en Drive): `importar/pdf/` (459 MB), `correcciones/img/` (recortes de facturas), `lote1…lote6/`
(texto y escaneos por PDF, ~500 MB), `fase2/` y `piloto/` (muestras), `inventario.json` (texto bruto
completo de los 1.673 PDF), `proveedores_digitales.json`, `importar_prueba/`, `clasificacion/lotes`,
`salida`, `pendientes.json` y `repaso/listado.txt` (intermedios), y el zip original de la gestoría.
