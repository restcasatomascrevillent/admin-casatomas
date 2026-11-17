# Descuentos, promociones y regalos en las compras · informe de revisión

Revisión del 17/11/2026 sobre los datos de **producción** (solo lectura): 4.556 documentos de compra
(facturas, albaranes y abonos) y sus **30.478 líneas**, de septiembre de 2023 al 16/11/2026. Se han
cruzado con las 60 fichas de proveedor de `conocimiento-facturas/fichas/`, con el código de lectura
(`procesar-factura`), con la clasificación de productos y con las funciones que calculan precios,
costes y márgenes. Las reservas quedan fuera.

> **Límite de esta versión.** Los PDF originales que guarda el panel están en el Drive de la cuenta
> del panel, y el conector de Drive de Claude no tiene acceso a esa carpeta. Todo lo que sigue sale de
> las líneas guardadas y de las fichas. Lo que hay que cotejar con el papel está en el apartado 7: se
> hará en cuanto se comparta la carpeta «Facturas Casa Tomás» en solo lectura. Drive devuelve el texto
> de cada PDF, así que el cotejo será rápido.

---

## 1. Lo importante, en seis puntos

1. **Unos 131.000 € de descuentos no rebajan el producto que descuentan.** Hay 1.750 líneas de
   descuento aparte («DESCUENTO HEINEKEN…», «- 20 % BONIFICAC S/ …», «COMPRA MÁS PAGA MENOS»…) que se
   guardan como si fueran productos sueltos de **Servicios**. El producto queda con su precio de
   tarifa: el **barril de Cruzcampo de 50 l** figura a **200 €** cuando cuesta de verdad **99,57 €**,
   y la **Heineken 1/3 caja 24**, a 40,66 € en vez de 24,38 €.
2. **El coste de los vinos y los márgenes salen mal** donde hay bonificación en el pie: los vinos de
   **Marqués de Riscal** llevan un 20 % de bonificación que no se resta, así que su coste en la carta
   está un **25 % por encima** del real. Lo mismo pasa con las alertas de «subida de precio», el
   informe «Subidas y proveedor» y las respuestas del copiloto sobre precios.
3. **Las familias del Análisis están desplazadas**: unos 128.000 € de descuentos están en
   **Servicios** (que sale 128.000 € más barata de lo que es) y no en Cervezas, Vinos o Licores (que
   salen más caras). En 2026 son 55.133 €.
4. **Fallo grave de la clasificación con IA, no solo de descuentos**: desde el 08/11/2026 el producto
   «Mostaza de cerveza Rooftop 150 g» ha recibido **252 líneas que no son mostaza (13.530 €)**:
   alquileres, luz, fontanería, bonificaciones de Riscal, promociones de Makro… La causa está
   localizada: la categoría Servicios tiene el número 11, el producto «mostaza» también, y el modelo
   pone ese 11 donde va el producto.
5. **Los regalos se marcan a medias**: hay 607 líneas a 0 € con cantidad; solo 101 están marcadas como
   regaladas (100 % de descuento). Lo que se sube ahora por el panel **no guarda nunca** la marca de
   regalo ni lo que valía, aunque la lectura lo detecta.
6. **El 97 % del importe de los descuentos se puede asociar solo** a su producto con reglas seguras
   (nombre del producto, «línea anterior», % sobre la línea o sobre el total). Lo que queda (sobre
   todo promociones de **Makro**, 1.534 €) necesita el original o un cambio en la lectura.

---

## 2. Cifras de partida

| Qué | Líneas | Importe |
|---|---:|---:|
| Líneas de descuento, promoción o rappel aparte (negativas, en documentos positivos) | 1.750 | −130.952 € |
| Devoluciones de envase y de género (negativas, no son descuentos) | 686 | −18.091 € |
| Líneas con descuento dentro de la línea (`descuento_pct` entre 0 y 100) | 1.318 | — |
| Líneas a 0 € con cantidad (regalos, notas, servicios a 0) | 607 | 0 € |
| … de ellas marcadas como regalo (`descuento_pct = 100`) | 101 | — |
| Líneas que citan su albarán dentro de una factura (`albaran_ref`) | 20.046 | — |
| Albaranes guardados como documento | 136 | — |

Los totales de los documentos cuadran: en 4.478 de 4.550 documentos las líneas suman exactamente la
base impresa. Es decir, **los descuentos están leídos**; el problema es **a qué se asignan**.

---

## 3. Hallazgos

### 3.1 Descuentos en línea aparte que no llegan a su producto

Cómo está hoy: la lectura guarda cada descuento como una línea más, con su importe negativo, y la
clasificación le da un producto propio («Descuento Heineken», «Bonificación comercial», «Compra más,
paga menos» —con cinco variantes—…) de la familia **Servicios**. Ninguna tabla ni función une ese
descuento con la línea del producto. El precio de compra de cada producto se calcula solo con sus
propias líneas, así que sale **sin descuento**.

Proveedores afectados (importe total de sus líneas de descuento):

| Proveedor | Líneas | Importe | Cómo imprime el descuento |
|---|---:|---:|---|
| Distribuciones de Bebidas **Catral** | 1.116 | −104.754,80 € | Una línea «DESC./DESCUENTO + nombre del producto» justo debajo de cada producto, también en barriles |
| **Marqués de Riscal** | 11 | −17.312 € | «- 20 % BONIFICAC S/ base» en el pie: 20 % exacto de todas las líneas |
| **Distribuciones Directas 2004** | 40 | −3.898 € | Descuento comercial del 9 % en la casilla «% DTO.» del pie |
| **Makro** | 516 | −1.575 € | «COMPRA MÁS PAGA MENOS (DT nnnnn)», «DESCUENTO VENTA PROACTIVA», «10 % DE DESCUENTO PICO»… en la página de resumen, sin decir a qué artículo van |
| **Disjover** | 9 | −1.566 € | «Descuento 5 %» / «Descuento 10 %» bajo la línea del producto |
| Mª Carmen **Virola** | 11 | −608 € | 20 % sobre el total con IVA (manuscrito) |
| Cárnicas **Joselito** | 1 | −526 € | «RAPPEL POR MARKETING Y ESCAPARATE» |
| **Noara** | 6 | −72 € | «PROMOCIÓN ESPECIAL» bajo el producto; «CREMA DE ORUJO SIN CARGO» |
| **Negociants** (Vila Viniteca) | 3 | −127 € | «100 % de DESC. (línea anterior …)» |
| Naturcid | 2 | −14 € | 10 % sobre el bruto, en el pie |
| Servicios: Orange, Avatel, Solred, dos notarías | 34 | −496 € | Promociones y descuentos de cuota; no afectan a productos |

Efecto en el precio real de lo que más se compra a **Catral** (todas las compras guardadas):

| Producto | Compras | Precio sin descuento | Precio real | Descuento |
|---|---:|---:|---:|---:|
| Barril Cruzcampo 50 L | 95 | 200,02 € | 99,57 € | 50,2 % |
| Heineken 1/3 L caja 24 | 151 | 40,66 € | 24,38 € | 40,0 % |
| Barril Cruzcampo 20 L | 80 | 90,81 € | 37,65 € | 58,5 % |
| Barril El Águila Sin Filtrar 20 L | 83 | 98,82 € | 52,73 € | 46,6 % |
| Heineken 0,0 % 1/3 L caja 24 | 101 | 42,48 € | 25,50 € | 40,0 % |
| El Águila 1/3 L caja 24 | 93 | 36,00 € | 23,29 € | 35,3 % |
| Amstel Oro 0 % 1/3 L caja 24 | 108 | 39,70 € | 24,30 € | 38,8 % |
| 18/70 La Rubia 1/3 L caja 24 | 80 | 34,16 € | 23,90 € | 30,0 % |
| Cruzcampo Especial Sin Gluten 1/3 L caja 12 | 92 | 19,05 € | 11,98 € | 37,1 % |
| Copas serigrafiadas Casa Tomás 6 ud | 3 | 14,18 € | 0,00 € | 100 % (regalo) |

Dónde se nota en el panel:

- **Análisis › familias**: −127.851 € de descuentos están en Servicios y −3.082 € en Despensa (por el
  fallo del punto 3.2), en lugar de en Cervezas, Vinos y Licores.
- **Coste de la carta de vinos** (`vinos_coste_carta_datos`) y **márgenes de la carta**
  (`margenes_carta_datos`): solo cuentan las líneas del propio vino y las botellas a 0 €. La
  bonificación del 20 % de Riscal no entra, así que el coste de sus vinos está un 25 % por encima.
- **Alertas de «subida de precio» y «más barato en otro proveedor»**, e **informe «Subidas y
  proveedor»**: comparan precios sin descuento. Si un mes Catral cambia el descuento, sale como
  subida o bajada de precio aunque el neto sea el mismo.
- **Copiloto (chat)**: sus funciones de precio (`lineas_producto_base_agente` y las que la usan)
  descartan las líneas negativas, así que responde el precio de tarifa. Los embeddings por nombre
  (`productos_nombre_embedding`) sí encuentran «DESCUENTO HEINEKEN…» al preguntar por Heineken, pero
  esa línea no rebaja el precio que da.

### 3.2 La clasificación con IA mete líneas ajenas en «Mostaza de cerveza Rooftop 150 g»

- 191 textos de línea ajenos asignados a ese producto (todos desde el 08/11/2026, salvo uno manual),
  que arrastran **252 líneas y 13.530 €**: alquileres del local, términos de luz y agua, trabajos de
  fontanería, «albarán 63», «- 20 % BONIFICAC S/ 12.975,5», «COMPRA MÁS PAGA MENOS (…)», «Descuentos y
  promociones»…
- **Causa**: en la respuesta del modelo, el campo `producto_id` lleva un 11 que en realidad es la
  categoría **Servicios** (id 11). El producto 11 existe (es la mostaza) y
  `validarAsignaciones` (`supabase/functions/clasificar-productos/clasificacion.ts`) acepta cualquier
  id que exista, sin mirar si tiene que ver con el texto ni si su categoría encaja.
- Hay otros productos de Servicios que han recogido textos parecidos entre sí (luz, agua, logística,
  telefonía). Eso es razonable y no es este fallo; la mostaza es el único caso de cruce entre familias.

### 3.3 Regalos (líneas a 0 € con cantidad)

- **607 líneas**; **101** marcadas como regalo (100 % de descuento) y **302** con «valor sin
  descuento». La mayoría son **botellas bonificadas reales**: Directas (61), Tabarca (56), Guillén
  (24), Hisumer (22), DIBOS (14), Calderón (9), Disjover «S/C» (9), Primeras Marcas (9)… En muchas, el
  mismo producto aparece pagado en el mismo documento (12 + 1, 24 + 12).
- **Lo que se sube por el panel no guarda la marca de regalo.** La lectura la detecta (`bonificada`),
  pero `extraccion.ts` dice expresamente que no tiene columna y `guardado.ts` no la convierte en
  `descuento_pct = 100` ni calcula el valor. Las 52 líneas a 0 € subidas por el panel están todas sin
  marcar.
- El **coste efectivo con regalos** (pagado ÷ unidades pagadas + regaladas) solo se aplica en la carta
  de vinos y en el copiloto. Para el resto de productos (licores bonificados, género de Tabarca…) el
  precio no baja.
- No todo lo que está a 0 € es regalo: hay **notas y rótulos** («PRECIO ESPECIAL», «SERVIDO …»),
  **material promocional** (copas y sacacorchos de Riscal, tazas de Salzillo), **servicios a 0**
  (energía reactiva, motor de reservas), **envases** y **portes regalados** (Almadraba). Se distinguen
  por proveedor y por familia; las fichas ya lo describen.

### 3.4 Descuento dentro de la propia línea

- 1.318 líneas con `descuento_pct` parcial: **1.308 cuadran** (guardan el precio neto y el importe neto,
  y en 1.240 el valor sin descuento es coherente con el %). **7 no cuadran** y **74** tienen el valor
  sin descuento igual al importe, a pesar del descuento.
- La lectura del panel no guarda el % de descuento de la línea (solo el neto). El precio es correcto,
  pero se pierde el «valor sin descuento».

### 3.5 Albaranes y facturas

- **2.611 facturas agrupan albaranes** (20.046 líneas con su `albaran_ref`). Un descuento que va dentro
  de un albarán debe repartirse **entre los productos de ese albarán**, no de toda la factura. Así se
  propone en el punto 5.
- De los 136 albaranes guardados como documento, **ninguno tiene un descuento que no esté en su
  factura, ni al revés**, según los datos. Las diferencias entre albarán y factura que hay son otra
  cosa: embalaje de Nicolás y Valero (1,82 €), RGA de Luga (1,97 €), punto verde de Campoluz (6 €).
  Esto se comprobó con el original del albarán AL2025/0009781 de Campoluz.
- **3 albaranes ya facturados no están unidos a su factura** y se cuentan dos veces (3.452 € de base):
  Campoluz AL2025/0009781 y AL2025/0009780 (en la factura FA2025/0027964) y Enchenta «Carta de Porte
  1-24669» (en la factura 1-4772).

### 3.6 Makro: promociones sin artículo

- 516 líneas de promoción (−1.575 €, 237 tickets) van en la página de resumen. Según la ficha de Makro,
  el código final de la promoción («DT 27597») enlaza con la línea del artículo marcada con
  «Prec.Ud.*». Esa marca y el código del artículo no se guardan, así que hoy no se pueden asociar.
  Hace falta el original para el histórico y un cambio en la lectura para lo nuevo.

### 3.7 Otros casos para revisar

- **Cuatro descuentos de Catral en positivo** (+128,52 €: facturas 000919, 000619, 002314 y 001630). La
  factura cuadra con ellos, así que puede que estén impresos así (una regularización). Hay que
  confirmarlo con el original.
- **Descuadres de pie relacionados con descuentos**: Mª Carmen Virola factura 6 (−48,12 €, descuento
  del 20 % sobre el total con IVA) y Orange (5 facturas con +33,56 €, «descuento línea adicional
  fija»). Ya tienen aviso en el panel.
- **Rappel de Joselito** (−526,26 €, «por marketing y escaparate»): es un rappel comercial, no un
  descuento de un producto concreto. Se propone dejarlo en Servicios, salvo que el dueño prefiera
  repartirlo entre los jamones de esa factura.

---

## 4. Qué se puede asociar automáticamente

Reglas probadas sobre las 1.750 líneas de descuento (dentro del mismo albarán si la línea lo cita y, si
no, del documento):

| Regla | Líneas | Importe |
|---|---:|---:|
| A. El texto del descuento nombra el producto (similitud ≥ 0,5) | 1.119 | −103.869,24 € |
| B. «x %» del texto = x % de la línea anterior | 17 | −2.968,71 € |
| C. «x %» del texto = x % del total del albarán o del documento → reparto proporcional (Riscal, Directas, Naturcid) | 53 | −20.207,44 € |
| C2. Sin % en el texto, pero el importe es un % redondo del total → reparto | 2 | −114,54 € |
| C3. «x %» sobre el total con IVA (Virola) → reparto | 6 | −324,59 € |
| D. El texto dice «línea anterior» | 3 | −126,80 € |
| **Sin asociar**: Makro (489), Catral con texto raro (7, «DESPEPADOS», «DTO ESPECIE»), rappel de Joselito, servicios | 550 | −3.340,24 € |
| **Total** | **1.750** | **−130.951,56 €** |

**Resultado: 1.200 líneas y el 97,4 % del importe (127.611,32 €) se asocian sin intervención.** Lo
que queda se marca «sin asociar» para revisarlo a mano o con el original.

---

## 5. Correcciones propuestas (fase 2, en este orden)

1. **Clasificación con IA**: no aceptar un `producto_id` que repite la categoría propuesta, que es de
   otra familia o que no se parece al texto (test con el caso «11»). Quitar de la mostaza los 191
   textos y las 252 líneas ajenas para que se vuelvan a clasificar.
2. **Asociar cada descuento a su producto** sin tocar lo impreso:
   - tabla `productos_factura_descuentos` (línea de descuento → línea de producto, importe asignado,
     regla y confianza);
   - función que aplica las reglas del punto 4 a un documento; relleno de todo el histórico; y llamada
     tras guardar cada lectura (`procesar-factura`, `ocr-trabajo`, importación histórica);
   - por línea, «importe neto» y «precio neto» (importe + descuentos asignados).
3. **Usar el neto donde se calcula un precio o un coste**: coste de la carta de vinos, márgenes de la
   carta, alertas de subida y «más barato», informe «Subidas y proveedor», funciones de precio del
   copiloto; y repartir los descuentos asociados en la familia de su producto en el Análisis.
4. **Regalos**: que la lectura guarde `bonificada` como 100 % de descuento con su valor (precio impreso
   o último precio del proveedor, marcado como estimado); marcar las líneas históricas que son
   producto; y aplicar el coste efectivo con regalos a todos los productos, no solo al vino.
5. **Lectura de nuevos documentos**: pedir al modelo, para cada línea de descuento, a qué línea se
   aplica («anterior», número de línea o «todo el documento»), y en Makro, el código de promoción en
   las dos líneas.
6. **Unir los 3 albaranes** a su factura.

Todo va primero a la **demo**. En producción solo entra con la release que tú aceptes. Los arreglos de
datos van como migraciones, con su vuelta atrás.

---

## 6. Qué no cambia

- El **gasto** (suma de documentos con IVA) no cambia: los descuentos ya están restados en el total de
  cada factura. Cambia **a qué producto y a qué familia** se atribuyen.
- No se toca ningún importe impreso: las líneas de descuento se quedan como están y la asociación va
  aparte.

---

## 7. Pendiente de cotejar con los originales

En cuanto haya acceso a la carpeta del panel en Drive:

1. **Búsqueda en el texto de todos los originales** de «descuento», «dto», «bonif», «promoción»,
   «regalo», «sin cargo», «rappel», «pronto pago»… y cruce con lo guardado. Es la prueba de que no se
   ha escapado ningún descuento que la lectura no viera.
2. **Makro**: los 237 tickets con promociones, para unir cada «DT nnnnn» con su artículo.
3. **Riscal** (11), **Directas** (40), **Disjover** (9), **Virola** (11), **Noara** (3): base y % del
   descuento del pie.
4. **Catral**: las 4 líneas en positivo y las 7 sin asociar; y una muestra de 10 facturas.
5. **Regalos sin marcar**: una muestra por proveedor (Directas, Tabarca, Guillén, Hisumer, Salzillo…).
6. Las **7 líneas con descuento que no cuadran** y las **74 sin valor bruto**.

---

## 8. Cómo se ha hecho

Consultas SQL de solo lectura sobre producción (`haqmmdfdzzatdnrrcgez`) con el conector de Supabase:
recuento por tipo de línea, detección de descuentos por texto (con y sin palabras de envase),
emparejamiento por similitud de trigramas (`pg_trgm`) dentro del documento y del albarán, comprobación
de % sobre la línea anterior y sobre el total, cuadre línea a línea (cantidad × precio × descuento),
cuadre de las líneas con la base impresa y cruce albarán ↔ factura por número citado. Más la lectura de
las fichas de proveedor y del código de lectura, clasificación y costes. El estado del trabajo está en
[ESTADO.md](ESTADO.md).
