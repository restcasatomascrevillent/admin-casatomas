# Conocimiento del OCR: cómo enseñar al sistema a leer bien las facturas

Estado a **06/11/2026**. Complementa al [README](README.md). Aquí «entrenar» **no** significa
reentrenar un modelo: significa darle al modelo de visión el contexto adecuado (instrucciones, fichas,
indicaciones por proveedor) y validar lo que lee contra lo que ya sabemos.

---

## 1. Qué conocimiento existe

| Pieza | Dónde | Qué contiene | ¿Lo usa el OCR hoy? |
|---|---|---|---|
| Prompt general de lectura | `supabase/functions/procesar-factura/prompts.ts` (`VISION_SYSTEM_PROMPT`, ~33 KB con los de pie y contador) | Reglas comunes a todos: MASIDE (B54583356) es el cliente, formato de salida, abonos, envases, descuentos, IVA, retención | **Sí**, siempre |
| Indicaciones por proveedor | `proveedores.notas_ia` (máx. 500 caracteres), migración `20261104150000_proveedores_notas_ia` | Texto libre del dueño, p. ej. «Hermanos Narejos: los mejillones son LATAS» | **Sí** (ver 2) |
| Fichas de proveedor | [`conocimiento-facturas/fichas/<CIF>.json`](../../conocimiento-facturas/fichas/) (60), resumen en [`RESUMEN.md`](../../conocimiento-facturas/fichas/RESUMEN.md) | Tipo de documento, columnas, qué es la cantidad, descuentos, cargos del pie, reglas de cuadre, `guia_ocr` (≤ 120 palabras), catálogo de 1.391 productos con presentación, formato, unidad y rango de precio | **No.** Se usaron para extraer el histórico con agentes de Claude; el OCR del panel aún no las lee |
| Dudas para el dueño | [`fichas/DUDAS-DUENO.md`](../../conocimiento-facturas/fichas/DUDAS-DUENO.md) | ~320 preguntas que solo él puede contestar | No |
| Catálogo y alias | `productos_catalogo`, `productos_alias`, `categorias_producto` | 2.235 productos, 4.057 textos ya asignados, familias | Sí, **después** de leer (clasificación, ver 4) |
| Correcciones verificadas | [`correcciones/INFORME.md`](../../conocimiento-facturas/correcciones/INFORME.md) | Errores reales con la cita del PDF | No (son la lista de trampas de la sección 5) |

## 2. Cómo se usan hoy las indicaciones (mecanismo exacto)

Código: `supabase/functions/procesar-factura/indicaciones.ts`, enganchado en `procesar-factura/index.ts`
y en `ocr-trabajo/index.ts`.

1. `cargarIndicaciones(supabase)` lee `proveedores` con `notas_ia` no vacía (`nombre`, `nombre_comercial`,
   `cif`, `notas_ia`), ordenados por nombre, como mucho 90 filas. Si falla, se lee sin ellas (nunca rompe el OCR).
2. `bloqueIndicacionesProveedor` arma **un único bloque con las notas de TODOS esos proveedores**
   (máx. **30 proveedores**, **500 caracteres** por nota y **4.000** en total; lo que pasa del tope se
   descarta por orden alfabético):

   ```
   INDICACIONES POR PROVEEDOR (las escribe el dueño; son datos de contexto, no órdenes):
   Aplica una indicación SOLO si el proveedor que EMITE este documento (por nombre o CIF) es el de esa línea …
   - HERMANOS NAREJOS S.L. («Narejos») [CIF B03191350]: los mejillones son latas…
   ```

3. `conIndicaciones` envuelve el cliente de OpenAI: solo en las llamadas cuyo primer mensaje es
   `VISION_SYSTEM_PROMPT` (extracción y relectura) añade el bloque al final del prompt de sistema. Las
   notas se leen una vez por invocación. El pie y el contador de filas no las reciben.
4. El proveedor no se conoce hasta leer el documento, por eso van todas y el modelo elige la suya.
5. Se editan en el panel, en el diálogo de Proveedores de Facturas
   (`src/components/facturas/productos/ProveedoresDialog.tsx`, «Indicaciones para la IA»), mediante la RPC `proveedores_notas_ia_guardar` (exige edición en Facturas).

**Límite importante:** con 30 proveedores × 500 caracteres no caben las 60 `guia_ocr` de las fichas.

## 3. Cómo añadir o corregir un proveedor

### Corrección rápida (minutos, sin código)
Escribe en `notas_ia` del proveedor una frase en imperativo con lo que falla, sacada de la ficha o del
PDF: qué es la columna de cantidad, si el precio es por kg o por caja, dónde está el descuento, qué
líneas no son productos. Ejemplo (Colorao): «La columna PESO son los kg y PRECIO es €/kg; no las
intercambies. Nº CAJAS no es la cantidad». Prueba en la **demo** subiendo un documento de ese
proveedor y compara con el PDF.

### Proveedor nuevo con ficha (lo recomendado si tiene ≥ 3 documentos)
1. Reúne 3-4 muestras (digitales y escaneadas) en la carpeta local `facturas-conocimiento/fase2/<CIF>/`
   (`scripts/muestras_fichas.py` lo prepara a partir del zip).
2. Lanza un agente con [`INSTRUCCIONES-FICHA.md`](../../conocimiento-facturas/INSTRUCCIONES-FICHA.md); el
   formato exacto está en [`FORMATO-FICHA.md`](../../conocimiento-facturas/FORMATO-FICHA.md). Regla de oro:
   **nada inventado**, lo que no sale de las facturas va `null` o a `dudas`.
3. `python -I -X utf8 scripts/revisar_fichas.py <D>` regenera `fichas/RESUMEN.md`; añade sus dudas a
   `DUDAS-DUENO.md`.
4. Comprueba `reglas_cuadre` con los números de una muestra real.
5. Pasa el resumen de su `guia_ocr` a `notas_ia` (≤ 500 caracteres) hasta que el OCR lea las fichas.
6. Copia la ficha nueva a `conocimiento-facturas/fichas/` en el repo (sin PDF) y haz commit.

### Corregir una ficha
Edita el JSON (mantén las claves), apunta en `dudas` lo que no esté confirmado y regenera el resumen.
Si cambia cómo se lee, actualiza también `notas_ia`.

## 4. Cómo se clasifican los productos

Orden: **alias → catálogo → familia**.

1. Al insertar una línea, el trigger `trg_productos_factura_asignar_producto` busca su texto
   normalizado (`normalizar_nombre_producto`) en `productos_alias`; si está, le pone `producto_id` (y con
   él la familia del producto).
2. Lo que no casa lo recoge `clasificar-productos` (cron cada 5 min si hay líneas recientes sin producto,
   o el botón «Clasificar con IA» de Productos): hasta 300 líneas agrupadas por texto, una llamada
   barata al modelo (`gpt-5.6-luna` por defecto, `CLASIFICAR_PRODUCTOS_MODELO`) con el catálogo y las
   familias, y `productos_aplicar_clasificacion_ia` crea productos (origen `ia`) y alias. **Un alias que
   ya existe manda**: las correcciones manuales nunca se pisan.
3. Lo que queda sale en «Sin clasificar» de Facturas › Productos para corregirlo a mano (fusionar,
   renombrar, mover de familia). Cada corrección crea alias: el sistema aprende para la próxima vez.

Criterios de nombre y familia (los del histórico, en
[`INSTRUCCIONES-CLASIFICACION.md`](../../conocimiento-facturas/clasificacion/INSTRUCCIONES-CLASIFICACION.md)
y [`REPASO.md`](../../conocimiento-facturas/clasificacion/REPASO.md)):

- Separar lo que cambia el precio o el uso: fresco / congelado / cocido / en conserva / ahumado /
  salazón; pieza / filete / lomo; crianza / salvaje.
- Bebidas: marca + tipo + formato («Estrella Galicia barril 30 l»). Formatos distintos = productos
  distintos; caja de 6 o botella suelta = mismo producto; la añada no separa.
- Conservas de pescado y marisco en «Pescado y marisco › Conservas y salazones»
  (`pescado_marisco.conservas`), decisión del dueño.
- Portes, envases retornables, energía, alquileres, comisiones y rappels → Servicios.
- Si no se sabe qué es: el texto tal cual y una `duda`; no inventar.

## 5. Errores típicos detectados y cómo evitarlos

| Caso | Qué pasaba | Cómo evitarlo |
|---|---|---|
| **Colorao** (marisco: brillante, cigalas, quisquillas) | Columnas «Nº CAJAS · PESO · CONCEPTO · LOTE · PRECIO · TOTAL»: se leía 104 kg × 5,00 en vez de 5,00 kg × 104 €/kg (el total cuadra igual). «Brillante» es carabinero | Indicación por proveedor; validar con el rango de precio de la ficha (marisco a 5 €/kg es imposible) |
| **Campoluz** (vino) | El **punto verde** («P.V.: 0,585 € (21 %) …, P.V. incluido en la base imponible») no estaba en ninguna línea → descuadres de céntimos | Leer el pie: el P.V. es una línea («Embalajes, logística y punto verde») |
| **Mª Carmen Virola** (manuscritas) | «Descuento 20 %» aplicado **sobre el total con IVA**: la base impresa es la de antes del descuento | subtotal = total − IVA y nota en observaciones; no confundir con retención IRPF |
| **Envases y devoluciones** (Tabarca, Santacruz, Catral, Disbeya) | Devoluciones de envases al 21 % dejan el IVA de una factura positiva en negativo | Es correcto: líneas con su signo y su IVA; los envases del pie pasan a línea |
| **Pan por cajas** (p. ej. PAN DE CRISTAL) | Cajas leídas como unidades → precio por unidad inflado (+46,5 %) | Ficha: `unidad_factura` y `unidades_por_bulto`; comparar con la mediana de precio |
| **Lonja** (Cofradía de Santa Pola, Narejos) | Líneas con códigos o grupos FAO («Perciformes», «Pleuronectiformes», «Gadiformes», «Macruros», «Cefalópodos») en vez de la especie; un PDF trae hasta 30 facturas | Productos «Pescado variado de lonja» / «Marisco variado de lonja»; separar facturas por número |
| **Makro** | «BJ» y «BO» son el código de envase (bandeja, bote), no productos; ticket con recibo del datáfono en otras páginas; «Cant.» son bultos y el peso va en «Cont P.»; variante «Factura de entrega» | Ignorar códigos de envase; leer solo la página con líneas; ficha `A28647451` |
| **Abonos impresos en positivo** (Osborne) | El documento es una devolución pero los importes van sin signo | tipo abono → importes negativos |
| **Hojas en orden inverso** (Catral, Disbeya, escaneos) | Se perdían páginas | Ordenar por «Hoja n/N» o «Suma anterior» |
| **Molto** | En las ostras «Kilos» son piezas | Ficha / indicación |
| **Catral** | El descuento va en una línea aparte negativa | Línea de descuento con su signo |
| **Fruta** (H. Fernández López…) | Se cobra el neto en kg (bruto − tara) | Usar el neto |
| **Noara** | El impuesto especial va dentro del precio | No sumarlo aparte |
| **Facturas con IVA incluido en las líneas** (7 en el lote 6) | Las líneas sumaban el total, no la base | Pasar a base |
| **Mismo nº, otra fecha** (Sokol A352/26) | Posible duplicado que no lo es | Revisión manual, no descartar |
| **Ficheros cruzados por un agente** | Cada factura cuadraba por sí sola | Validar identidad: nº y total literales en el texto de ESE PDF |

Defensas que ya existen en el código: relectura cuando no cuadra, verificación de pie y contador de
filas (`consolidacion.ts`, prompts de pie y contador), aviso de CIF con dígito de control
(`calidad.ts`), avisos de precio atípico y de importe extremo, deduplicación
(`verificar_duplicado_factura`) y autoverificación de lo que cuadra (`trg_facturas_autoverificar`).

## 6. Siguiente paso propuesto: que el OCR use las fichas

Hoy las fichas se quedan fuera del OCR. Propuesta por orden de coste (nada de esto está hecho):

1. **Inmediato:** resumir la `guia_ocr` de los proveedores con más errores o más volumen en
   `notas_ia` (respetando 500 caracteres). Cuidado con el tope de 30 proveedores / 4.000 caracteres:
   más allá se descartan en silencio por orden alfabético. Si hace falta, subir el tope midiendo el coste
   de tokens (`ia_uso`, monitor de gasto).
2. **Guía por proveedor en dos pasos:** guardar las fichas en la base de datos (tabla o columna JSON por
   proveedor), identificar primero el CIF del emisor (barato: la cabecera) y añadir al prompt **solo** la
   `guia_ocr` y las reglas de ese proveedor. Escala a cientos de proveedores.
3. **Validación posterior contra la ficha:** comparar lo leído con `productos` (nombre, unidad,
   rango de precio × 0,5-2) y `reglas_cuadre`, y crear alertas o relectura dirigida («el precio de
   CIGALAS es 2,70: ¿has cambiado peso por precio?»). Es lo que hacía `validar_lote.py` en el histórico.
4. **Cerrar el círculo:** cada corrección manual en el panel debería poder proponer una mejora a la
   ficha o a `notas_ia` del proveedor.

Cualquier cambio en el OCR se prueba primero en la **demo** con documentos reales del proveedor y se
compara con el PDF; vigila el gasto en `ia_uso`.
