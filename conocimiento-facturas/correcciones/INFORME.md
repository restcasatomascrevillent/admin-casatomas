# Correcciones de calidad de Facturas comprobadas contra el original (06/11/2026)

Base de datos: SOLO la demo `sfonaclosuafvlhutkon`. Producción no se ha tocado.

## Ficheros

| Fichero | Para qué |
|---|---|
| `demo/c1_…sql` … `demo/c8b_…sql` | Lo aplicado en la demo: una transacción por caso |
| `corregir_json.py` | Corrige `importar/json` (idempotente, comprueba el valor de partida). **Si se vuelve a ejecutar `scripts/preparar_importacion.py`, se pierden las correcciones: hay que volver a pasar este script.** |
| `originales/` | Copia de los 36 JSON antes de corregirlos, más `tablero_compras_antes.json` y `_despues.json` |
| `diff_json.txt` (`diff_json.py`) | Diferencia campo a campo entre el original y el corregido |
| `aplicar_en_produccion.sql` | Lo que no cabe en el JSON (vínculo, revisadas, catálogo, alias). Usa import_clave, número + CIF y nombres. Se ha probado en la demo con ROLLBACK: funciona |
| `verificar_tablero.sql`, `tablero.sh` | Comparan `tablero_compras` con SQL directo |
| `img/` | Recortes de los PDF y de las fotos que se usaron como prueba |
| `pdf.py`, `recorte.py`, `foto.py`, `buscar.py` | Herramientas para leer PDF y fotos |

Originales de los documentos que no tienen import_clave: los albaranes Campoluz 46 y 48, la carta de porte de Enchenta 47, el albarán de Joselito 38 y la factura de MR FRIOSAT 35 están en las fotos de `Desktop/Oficiosos/facturas` (WhatsApp 03/02/2026, fotos 9, 12, 11, 4 y 1). **No se han encontrado** los originales de 351, 361, 373, 386, 407 y 520: están en Drive y su copia temporal en Storage ya no existe.

## Cuadre del tablero (SQL directo frente a `tablero_compras`, todo el histórico)

Ha cuadrado después de cada caso. Las cifras finales son iguales en la función y en el SQL directo:

| Indicador | Antes | Después |
|---|---|---|
| Gasto | 1.398.707,68 | 1.398.707,68 |
| Documentos | 1.902 | 1.901 (el albarán 386 ya facturado) |
| Albaranes sin factura | 44 | 43 |
| Regalado (líneas) | 28.204,45 (862) | 28.787,59 (874) |
| Líneas sin importe | 32 | 28 |
| Suma de líneas (familias) | 1.233.128,14 | 1.233.016,56 |

Descuadres de más de 1 € entre líneas y subtotal: antes 13, ahora 3. Quedan 520 (no se ha tocado) y 2045 y 1554, que están bien (suplidos y tasa exentos).

---

## Caso 1 · D12 · Albaranes sin factura

| Albarán | Factura propuesta | Decisión | Prueba |
|---|---|---|---|
| 386 Makro 9-242608469 (06/10) | 2360 (R1664) | **VINCULADO** con `vincular_albaran_factura(386, 2360)`, origen manual | R1664.pdf p.1: «*** Número de pedido 9-242608469 … Fecha: 06/10/2026». Las 12 líneas coinciden con las del albarán (hojas de pan 12 × 3,91 = 46,92; brioche 10 × 4,34 = 43,40…) |
| 373 (07/10, 45,00) y 407 (10/10, 90,00) Narejos | 520 (Narejos 5419) | **NO tocado**: no hay ningún original visible (520, 373 y 407 están en Drive) | Hay un indicio fuerte, pero sale de la lectura del OCR y no del original: en `ocr_trabajo_paginas`, la franja 3 de la 520 lee «albarán 15.219 de Fecha: 10/10/2026, 20,00 kg de mejillón a 4,50 = 90,00». Es justo el 407 y explica los 90 € que faltan en la 520. La franja 2 lee los albaranes 15.054 (10 kg, 45,00, que sería el 373) y 15.127. El dueño tiene que mirar IMG_1153.png en Drive |
| 351 Panadería Divina C.15 29/09 | 2324 (R1606) | NO | R1606 p.1-2 cita los albaranes C.21, C.31, C.18, C.28, C.28, C.24 y C.17. El del 29/09 es el **C.17**, con 106,80 de pan blanco «L»; el 351 es de 38 «bolos» (58,90). El pan de la factura suma exactamente 629,40 sin el 351 |
| 47 Enchenta carta de porte 1-24669 (30/12/2025) | 562 (R61) | NO | R61 solo factura los albaranes 3-1 (02/01) y 3-2 (07/01), y R60 los 3-5 y 3-8. Ninguna factura del paquete cita la carta de porte 1-24669 (foto 11). Su factura no está en el paquete |
| 361 Once de Enero 202610501 (2.986,50) | 2281 / 2335 | NO | R1627 es el albarán 202610469 y R1628 el 202610793. Ninguna factura cita el 202610501 |
| 38 Joselito 2509134 (15/12/2025, 13 jamones sin precio, foto 4) | 577 / 584 / 605 | NO | R120 cita el albarán F-2650051, R54 el M-2600157, R71 la reserva RV-982 (pluma) y R378 la RV-1031. Ninguna cita el 2509134 ni lleva jamones |

## Caso 2 · D13 · Subtotales

| id | Campo | Antes | Después | Prueba |
|---|---|---|---|---|
| 532, 729, 1061, 1455, 1954 (Virola R267, R594, R1002, R1293, R1650) | subtotal | 252,94 / 302,86 / 271,22 / 223,84 / 278,32 | 200,33 / 239,86 / 214,81 / 177,28 / 220,43 (= total − IVA) | Facturas manuscritas: «Base 252,94 · 4 % · 263,05 · Descuento 20 % · TOTAL 210,44». El 20 % se aplica sobre el total CON IVA, así que la base impresa es la de antes del descuento. Las líneas (que incluyen la línea de descuento) ya sumaban total − IVA. En el JSON queda una nota en observaciones |
| 1658 (R1009), 1907 (R1205) y, por la misma causa, 1923 (R1226), 2126 (R1402), 531 (R152), 529 (R153), 2308 (R1580), 1131 (R525), 1444 (R797) | línea nueva | — | «Punto verde (P.V.) 21 % / 10 %» con 0,59+0,49 / 0,86+0,16 / 0,70 / 0,19 / 0,55 / −0,48 / 0,44 / 0,35 / 0,04, producto «Embalajes, logística y punto verde» | Pie de Campoluz, por ejemplo en R1009: «P.V.: 0.585€(21%) 0.491€(10%) … 1,08€ … Base Imponible 1.197,77€ · *P.V. incluido en la base imponible». No eran redondeos: era el punto verde, que no estaba en ninguna línea |
| 1531 (R1072 #1, abono) | total de la línea de descuento | −32,93 | +32,93 | R1072 p.2: −365,90 de pacharán y −32,93 de descuento dan una base de −332,97. El importador ponía el descuento en negativo por ser abono. En el JSON el tipo pasa de abono a factura, con los signos explícitos |
| 1716 (R1042, abono Makro) | línea «Oferta Calendario…» | −0,95 | +0,95 | R1042: «9,50-» y «Oferta … 0,95» dan «8,55-». El JSON se corrige igual que el anterior |
| 46 albarán Campoluz AL2025/0009781 (foto 9) | líneas | Amaretto 100 %: 2 ud; Brugal 1888: 1 × 34,05; Gestión: 2 × 2,37 = 4,74; JW Red 100 %: 1 | 1 ud; 2 × 34,05 = 68,10; 1 × 2,37; 2 ud; más P.V. 6,00 | En la foto se lee «1 AMARETTO … 100 %», «2 BRUGAL 1888 … 68,10», «1 GESTION Y LOGISTICA 2,37», «2 JOHNNIE WALKER RED … 100 %» y «P.V. 6.000€(21%) · Base Imponible 2.488,11€». Ahora cuadra al céntimo |
| 48 albarán Campoluz AL2025/0009780 (foto 12) | línea nueva | — | P.V. 0,72 | «P.V.: 0.720€(21%) · Base 262,78€» |
| 520 | — | — | **no tocado** | No se ve el original (ver el caso 1) |

## Caso 3 · D14 · IVA negativo en facturas positivas: los dos están bien y no se cambian

- **1103** Tabarca (R475 p.2). El pie impreso dice: 4 % → base 290,28, cuota 11,61; 10 % → 72,67, 7,27; 21 % → −173,58, −36,45; total 189,37 / −17,57 / 171,80. La devolución de envases al 21 % deja el IVA neto en negativo.
- **1762** Santacruz (R1066). Impreso: 4 % → 21,00 / 0,84; 21 % → −6,60 / −1,39 (bateas devueltas); IVA −0,55 y total 13,85. Es correcto.

## Caso 4 · D5 · Líneas a 0 € con precio (9 líneas)

Todas llevan «Dto. 100 %» impreso. Se aplica `importe_bruto = cantidad × precio`, `importe_bruto_estimado = false` y `descuento_pct = 100`. En total valen 341,79 € (la propuesta decía 343,48 € porque las cantidades del 46 estaban mal).

| id | Doc | Antes | Después | Prueba |
|---|---|---|---|---|
| 363 | 35 MR FRIOSAT 000016 (foto 1) | importe_bruto null | 120,00 | «SERVICIO DE GUARDIA 1,00 120,00 € 120,00 € 100,00 %» |
| 407, 415, 417, 422, 423, 424 | 46 (foto 9) | null | 45,60; 17,40; 12,95; 22,52; 11,95; 83,88 | Líneas con «100 %». En el pie: «Total Descuentos 194,30€», que es justo la suma |
| 429, 432 | 48 (foto 12) | null | 25,12; 2,37 | «Total Descuentos 27,49€» |

## Caso 5 · D6 · Fecha del abono Campoluz 529 (R153): **no se cambia**

R153.pdf (PDF con texto, no escaneado) dice: «Fra. Rectificativa nº AB2025/0000455 · Fecha de emisión: 28/02/25 · Fecha de vencimiento: 10/03/25». La fecha 2025-02-28 es la impresa. La hipótesis de que el OCR había confundido 02 y 12 no se sostiene. Que el histórico del panel empiece en febrero de 2025 se tendría que resolver en el tablero, no en el dato.

## Caso 6 · Líneas con total NULL y precio

| id | Doc | Antes | Después | Prueba |
|---|---|---|---|---|
| 8597 | 1511 D. Primeras (R860) | total null | total 0,00, dto 100 % (importe_bruto 83,70) | Fila «198068 Fefiñanes 2025 0,75 6 Botella 13,95 · % Descuento 100 · Importe (en blanco)» |
| 9598, 9600 | 1665 (R1017) | null | 0,00 y dto 100 % (115,80 y 41,85) | En el recorte: «El Seque 2022 … 6 Botella 19,3 100» y «Fefiñanes 2025 … 3 Botella 13,95 100» |
| 2681–2683 | 582 Musgrave (R34, abono del lote de Navidad) | precio 34,05 / 157,82 / 84,34; importe_bruto −170,25 / −789,10 / −421,70 | precio 6,81 / 31,56 / 16,87; importe_bruto −34,05 / −157,82 / −84,34; **total sigue NULL** | En el escaneo los componentes no tienen «Total»: solo «Pvp S/Iva −34,050 / −157,820 / −84,340», que son las bases de las 5 unidades (coinciden con el cuadro de IVA). El total −276,21 va en la línea del lote. Ponerles total duplicaría el importe; el bruto anterior estaba multiplicado por 5 |

## Caso 7 · D17 · Importes extremos: todos confirmados

| Línea | Prueba | Acción |
|---|---|---|
| 7314 Embajadores, factura 1300 (R670) | «SOLOMILLO TERNERA 750.20 33.00 24,756.60 … 34,106.83 €» | Factura **marcada como revisada** (verificada, origen manual). El aviso `total_documento_extremo` lo vuelve a calcular la base de datos y no se puede borrar |
| 8983 Galmar, factura 1574 (R881) | «754,00 PULPO P3 … 11.159,20 · 14,80 … TOTAL FACTURA 25.294,56» | Marcada como revisada |
| 2803 Joselito, factura 605 (R71) | «PLUMA JOSELITO CONGELADA 32,0000 · 350,000 kg · 11.200,00» | Ya estaba verificada |
| 12911 Embajadores, factura 2158 (R1479) | «CORDERO LECHAL PALETILLA … 425,75KG 23,50 10.005,13» | La línea está bien, pero **no se marca**: su aviso es de CIF (carpeta B75143214 frente a B20691994 impreso) y queda fuera de este encargo |

## Caso 8 · Productos con «duda» (REPASO.md)

| Producto | Hallazgo en el PDF | Cambio |
|---|---|---|
| **Brillante** (17 líneas, Colorao) | R415, R1500, R824 y R760 tienen las columnas «Nº CAJAS · PESO · CONCEPTO · LOTE · PRECIO · TOTAL», por ejemplo «4 · 5,00 · BRILLANTE 8/9 PZ · plesiopenaeus edwardsianus · 104,00 · 520,00». El precio NO es por pieza: es €/kg, y la extracción había cambiado peso por precio. El nombre científico impreso corresponde al **carabinero** | En las 22 líneas de producto de Colorao (brillante, **cigalas** y quisquillas) se intercambian cantidad y precio. Ejemplo: 104 kg × 5,00 pasa a **5,00 kg × 104,00 €/kg**; el total no cambia. El producto 2147 se llama ahora **«Carabinero brillante»** (Marisco). Las cigalas también eran €/kg (2,70 kg × 85,00) |
| **Bj** | R891: «METRO Chef Pimiento California amarillo ristra 500g · BJ · 1,860». BJ es el código de envase (bandeja) | Línea 8885 renombrada y pasada al producto existente **#534 «Pimiento California amarillo»**. Producto falso 636 borrado y alias «bj» quitado |
| **Bo** | R718: «LA ESPECIERA DEL NORTE Ñora en bote 380g · BO · 17,770» | Línea 7769 renombrada y pasada al producto existente **#746 «Ñora»** (Makro «ÑORA 380G»). Producto 637 borrado y alias «bo» quitado |
| **Sierra Cantabria (obsequio)** | R1439: «Albarán 2618212 · OBSEQUIO SIERRA CANTABRIA» es el rótulo del albarán. El obsequio son las líneas propias «EL PUNTIDO 21 1EMa.x3L» y «SAN VICENTE 19 MAGNUM», sin precio | Línea 12743 (el rótulo) borrada en la demo y quitada del JSON. El producto 1831 queda sin líneas |
| Aceituna partida | R1265 (manuscrita): «'' '' partidas T3 … 13,90 27,80» | Correcto; no se cambia |
| Pechuga de pollo (gran cuk) | R708: «POLLO PECHUGA GRAN CUK BJ KG 9,950» | Es pechuga de una marca de calidad; sigue en #314 |
| QS | R1138: «1073 QS · lote LQS19-UE/NA · 6 UxC · 5 · 27,90 · 139,50», y otra línea igual a 0,00 (regalo) | Es un vino de caja de 6 (probablemente Quinta Sardonia «QS» 2019), pero no está impreso: no se cambia |
| Aceite de oliva virgen extra 280 g | 9 líneas «CO(K) - ACEITE OLIVA 280 GR - TRITICUM» con IVA del 4 %. Triticum es una panadería | «Virgen extra» no está impreso y es posible que sea un pan (coca de aceite): no queda claro, no se cambia |
| Hueva (R359), Curuxo (R61, R461, R1089, R1668), Rey (R1549), Pomodoraccino («POMODORACCINO EUROPI», R114), Cantonales Garre (R345), Boquillas (R289), Crema (R821, 0 €), Gilda salmón-queso Bokazas (R1608), Rollo Floor fucsia (R1612) | El PDF solo dice eso | Sin cambio (no se inventa) |
| Lote de Navidad, Anticipo de cliente, Mercancía en depósito, Visita comercial | Confirmados como líneas de lote, anticipo e informativas a 0 € | Sin cambio |

## Pendiente o para decidir

1. **520 ← 373 y 407 (Narejos)**: mirar IMG_1153.png en Drive. Si confirma el albarán 15.219 (y el 15.054), vincular y añadir la línea de 90,00 que falta.
2. ¿Fusionar «Carabinero brillante» (Colorao, 49–118 €/kg) con #285 «Carabinero» (Narejos)? Es la misma especie.
3. Líneas «ENVASES C0SA» de Colorao: la columna PESO se ha guardado como precio (con importe 0, así que no afecta a ninguna cifra). No se cambia porque no está claro qué cuenta.
4. 2158: aviso de CIF de Embajadores (Gipuzkoa frente a Madrid).
