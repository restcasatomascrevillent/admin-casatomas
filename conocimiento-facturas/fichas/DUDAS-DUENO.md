# Dudas de las fichas para el dueño

Solo el dueño (o quien recibe el género) puede contestarlas. Cada respuesta mejora la ficha de ese proveedor.

## ELADIO PAZOS BREA (33288687M)
- [ ] No se ve si hay piezas: la cantidad es siempre kg (de 12,50 a 59 kg por albarán)
- [ ] La unidad de la cantidad de portes parece kg de pan (coincide con el albarán casi siempre) pero el 28/09/2026 el pan son 35,60 kg y los portes 25,60: puede ser error del original
- [ ] Líneas PORTESNA con un solo número y sin importe (03/06/2026: 33,40; 31/08/2026: 34,50): se deduce que no se cobran porque no entran en la base, no está confirmado
- [ ] Cuando aparece PORTESGA frente a PORTESNA (Galicia vs nacionales) el precio es el mismo; no se sabe por qué cambia
- [ ] Significado de las comillas "L" y "BRAZO" en la descripción: no consta en las facturas
- [ ] No se han visto fechas de caducidad útiles: la columna sale vacía o repite la fecha del lote

## CASIMIRO PEREZ RODRIGUEZ (46914230A)
- [ ] Presentación del marisco: la factura nunca dice vivo, fresco, cocido ni congelado, por eso presentacion va null. Falta que el dueño confirme cuáles llegan cocidos (¿camarón, buey, centolla, bogavante, percebe?)
- [ ] La unidad de la columna Cantidad no está impresa: se deduce de que cantidad × precio = total. Kilos para todo salvo la ostra (unidades, múltiplos de 12). Nada se factura por docena: el precio de la ostra es por unidad (2,40-2,80)
- [ ] BUEY: no pone 'de mar'. Enchenta factura BUEY DE MAR a 13,50 €/kg; aquí sale a 19,00 €/kg. Confirmar que es el mismo producto
- [ ] DORADA a 62 €/kg es muy alto frente al resto: confirmar si es dorada o si cantidad/precio van en otra unidad
- [ ] OSTRA frente a OSTRA S.E.: no se sabe qué significa S.E. (mismo precio visto, 2,40)
- [ ] Los rangos de precio salen solo de las 4 muestras y de un ejemplo por artículo del catálogo; no hay mínimos ni máximos reales de todo el año
- [ ] VOLANDEIRA aparece sin precio ni total en el único ejemplo visto
- [ ] La columna DTO. existe pero no se ha visto ningún valor; el pie tampoco muestra pronto pago, portes ni financiación
- [ ] Catálogo completo (30 artículos): no queda ninguno fuera de la ficha

## Tomás Nicolás Riquelme (74187840Y)
- [ ] Catálogo sacado solo de 4 muestras manuscritas (de 35 escaneos): 3 artículos vistos; faltan otros.
- [ ] 'L/' se interpreta como 'lata' sin confirmar; tampoco se sabe el tamaño de la lata ni qué son 'OH' y 'FSY 180'.
- [ ] R25 (8/1): el año manuscrito parece 2025, pero el número de factura 7 sugiere enero de 2026. Revisar la fecha real.
- [ ] R1670: en la línea de capellán, la palabra tras 'seco' es ilegible (¿'act', 'aceite'?); precio 10,50 frente a 10,30 en las otras tres facturas.
- [ ] R1670: el precio de las rellenas se lee 12,50 pero el importe 38,70 cuadra con 12,90 (3 × 12,90). Se toma 12,90.

## HERMANOS FERNANDEZ LOPEZ, SAU (A08620056)
- [ ] Catálogo de 57 artículos; todos incluidos, nada fuera de la lista. Los veces_visto salen de las líneas agrupadas y son aproximados (el grupo mezcla lotes y orígenes distintos).
- [ ] IVA 10 %: no hay ninguna muestra con IVA 10 %. Se deduce del '10%' del nombre (almendra, pistacho, gominola) y de que el catálogo cuenta 66 filas de IVA para 60 facturas (6 facturas con segunda fila). Nuez pelada y tomate seco no dicen nada: iva_pct null.
- [ ] El cuadro 'CARGO / ABONO ENVASES' está vacío en todas las muestras; no se sabe cómo salen las fianzas de envases si las hubiera. Las líneas '(ENV)-AGUACATE' y '(ENV)-MAN PINK LADY' parecen producto con envase propio de marca, no cargo; sin confirmar.
- [ ] Peso exacto del bulto: se toma del nombre ('20K', '2,5K'). 'PATATA I ES' sin peso sale con 15 kg por bulto (10 BT = 150,20 kg bruto) en la muestra R7, sin confirmar.
- [ ] 'ROSIÑOL I LAUMONT 3K RU' y 'JINJOL' y 'CIR': normalización dudosa (rosiñol podría ser cereza o ciruela; CIR = ciruela abreviado), no confirmada.
- [ ] Algunas líneas del catálogo repiten el mismo artículo con 'x KG' y 'x BT' (guindilla, nuez, pistacho): no se sabe si cambia el criterio de facturación por lote o es una errata.
- [ ] El cliente impreso es 'CÓDIGO 32536 CASA TOMAS · MASIDE 2011 S.L.U.'; no aparece ninguna entrega para Touza en las muestras.

## GRUPO OSBORNE, S.A. (A11535564)
- [ ] Osborne NO es proveedor de bebida: en las 26 facturas solo salen jamón, paleta, lomo, pluma y conservas Real Conservera Española. La categoría 'bebidas' del info.json parece mal asignada.
- [ ] Cajas de conserva de 12 latas deducidas de CANTIDAD × latas (2 CA = 24 UN, 5 CA = 60 UN); la factura no lo dice. Peso/formato de la lata tampoco figura (nombre truncado).
- [ ] Jamón de 7-8 y 8-9 kg: se factura unas veces por PI (pieza) y otras por KG; el precio por kg del jamón N24 (54,80) y SRC (45,00) es coherente con ~520 EUR por pieza de 9-10 kg.
- [ ] Solo se han podido leer 4 muestras; los precios min/max salen de las líneas agrupadas del catálogo (un único ejemplo por artículo, sin fecha excepto los de las muestras).
- [ ] Punto verde aparece en las 26 facturas pero no está en el total en las muestras; falta comprobar si alguna factura lo suma.

## Makro Distribucion Mayorista, S.A. (A28647451)
- [ ] El catálogo completo del año supera los 120 artículos: se han incluido los 120 más frecuentes; quedan fuera unos 200 artículos más (estimación, casi todos vistos 1 vez: menaje, pastelería, charcutería, especias, productos asiáticos).
- [ ] Variante de reparto (Distribución de Hostelería): en el catálogo salen líneas 'Pago en entrega' y 'Total página' / 'Total de la última página' (facturas multipágina, p. ej. R42 con 17 apariciones), pero no hay muestra de texto de ese formato; el cuadre de la ficha se ha comprobado solo con el formato de tienda (R10, R39).
- [ ] Significado exacto de las marcas 'M' delante del código (p. ej. 'M 216831', 'M 8437003049675') y 'P' / 'HD' al final de línea: no se explica en las muestras.
- [ ] Significado de 'Cont P.' en unidades sueltas de menaje (p. ej. TENEDOR MARISCO BS, Cont P. 6): se interpreta como unidades dentro del bulto, no verificado.
- [ ] El código de IVA 3 (u otros) no aparece en las muestras; solo 1 = 10%, 2 = 21%, 5 = 4%.
- [ ] Unidad real de algunos artículos (pack de 6 leches, 24 latas) se deduce de Prec. Ud. × Cont P. = Precio; el 'Cont' (PK, BL, BJ, CJ...) no lo especifica.
- [ ] Los descuentos 'COMPRA MÁS PAGA MENOS' no indican a qué línea concreta pertenecen más que por el código de promoción final (p. ej. 27597 enlaza con la línea con 'Prec.Ud.*' 3,480).
- [ ] Los precios por kg o por bulto de un mismo artículo cambian con el tiempo y con el EAN (p. ej. Limas 12,49 en unas fechas y 15,99 en otras); los mínimos/máximos son del año completo.

## ÁNGEL LINARES MONTALBÁN, S.A. (A30228837)
- [ ] Catálogo de 41 productos: son todos los artículos con código de 9 dígitos que aparecen en las muestras y el catalogo_lineas.txt (no pasa de 120, no queda ninguno fuera).
- [ ] Congelado/fresco: solo es explícito en 'Cinta de lomo congelada', 'Carrillada … congelada' e 'IQF'/'Bolsa (congelados)'. El resto se marca como probable o sin confirmar.
- [ ] Algunas líneas de detalle (Caja…, Bolsa…) no se han podido emparejar con certeza con su artículo cuando no estaban en las 5 muestras; en esos casos el formato es aproximado (p. ej. hamburguesa vacuno 5,4 kg/30 uds, bacon 4 × 2,27 kg).
- [ ] Alguna unidad de venta marcada 'U' puede ser caja, bolsa o cubo según la fila de detalle; no hay una columna que lo diga.
- [ ] Los precios unitarios cambian ligeramente en el año (brownies 12,50 a 16,73; milanesa 48,54 a 49,20).
- [ ] IVA 4 % en pan sin gluten, almendra, patatas fritas, queso Edam, bocata y focaccia: es lo impreso en la factura, no se ha contrastado con la normativa.

## MUSGRAVE ESPAÑA, S.A.U. (A80837941)
- [ ] Catálogo sacado solo de 7 páginas de muestra (5 PDF de 50 escaneos): faltan muchos artículos que Musgrave vende; no hay catalogo_lineas porque no hay PDF digitales.
- [ ] Significado de la letra M / P suelta antes de la columna Cajas: no se sabe (¿marca propia / pesado?). No afecta al cálculo.
- [ ] Las cajas de cada artículo (12 bricks, 10 azúcar/harina, 6 tomate troceado) se deducen de Cajas × Unidades en la misma línea; del resto no se sabe.
- [ ] En R1577 'SECRETO CERDO DUROC' (3,76 kg) muestra 4 en Cajas y las piezas de pollo ninguna: la columna Cajas no es fiable en productos a peso.
- [ ] Tomate cherry rama: precio muy variable (5,81 a 8,31 €/kg); no se sabe si es cambio de calidad o de mercado.
- [ ] Los abonos citan la factura que anulan ('Esta factura anula a la factura: 99041600016707 de 22-04-2026'): ese número viene sin guion.

## BODEGAS DE LOS HEREDEROS DEL MARQUÉS DE RISCAL, S.L.U. (B01414531)
- [ ] El nombre del proveedor en la base ('VINOS FLORES (CODITRAL)') no coincide con el CIF: B01414531 y el membrete de TODAS las facturas es BODEGAS DE LOS HEREDEROS DEL MARQUÉS DE RISCAL, S.L.U. (Elciego, Álava). 'ENTREGADO: VINOS FLORES (CODITRAL)' solo aparece en OBSERVACIONES de R1079: es quien entrega la mercancía (distribuidor), no el emisor.
- [ ] 'LP' no se explica en la factura; por los nombres (La Cuvée, Ultrabrut, Millésimé, Grand Siècle, Alexandra Rosé, Héritage) parece champán Laurent-Perrier, pero es una inferencia.
- [ ] Cantidad = cajas, precio = por caja: confirmado con importes (6 × 552,00 = 3.312,00; 75 × 42,60 = 3.195,00). El nº de botellas por caja sale de TOTAL BOTELLAS ÷ CAJAS y de 'C/nB'.
- [ ] En varios vinos (Grand Siècle It.26, Tinto XR, Chirel, Limousin, Montico, Verdejo, GRVA, Ultrabrut, Héritage, Alexandra) no se imprime el volumen de la botella; se asume 75 cl pero no está escrito.
- [ ] Significado de 'S' en 'C/6BS', 'C/1BS' y de '(EI)' no consta.
- [ ] Los ejemplos 'R227', 'R581', 'R1374'… son facturas del año vistas solo en el catálogo de líneas; su fecha no se conoce.
- [ ] El catálogo cubre todos los artículos vistos (28 entradas, algunas agrupan variantes 'Sin Cargo'); no hay artículos fuera por tope.

## ROMÁN Y MARTOS ALIMENTACIÓN, S.L. (B02873545)
- [ ] Los calibres 2000/3000, 800/1000 y 1000/2000 se leen como gramos por pieza; el 5/6 y 9/10 del rape no está claro si son kg por pieza (parece, por 5,40 kg y 18,90 kg por caja) o cola/entero.
- [ ] El rape negro sale 4 veces en el catálogo con números quitados, sin separar los calibres 5/6 y 9/10; veces_visto va a null.
- [ ] El catálogo de 6 PDF incluye otras dos facturas (R337, R1464) sin muestra: el atún rojo sale a 15 €/kg con 18,37 kg y el rape 9/10 con 18,90 kg.
- [ ] 'Fresco' se deduce de la fecha de caducidad corta (2 a 6 días) y de ser pescado al peso; no lo pone la factura.

## PESCADOS MOLTO, S.L. (B03092038)
- [ ] Las facturas NO dicen si el pescado es fresco, congelado o salado; solo traen 'Met. Prod.: Capturado' o 'De cría' y el arte. Mejillón, bivalvos, bogavante y ostras se entienden vivos; el resto (quisquilla, gambas, zamburiña) queda como 'no indicado'. No aparece ninguna salazón.
- [ ] Ostras: se deduce que la columna Kilos son piezas porque el precio (1,24-2,19) es imposible por kg. Gillardeau salió con 24 piezas en el catálogo y con 48 en R1229; no se sabe cuántas trae la caja (Cajas siempre 1, incluso con 144 piezas de Peter Pan).
- [ ] Catálogo completo: 16 artículos, todos incluidos. Los rangos de precio salen del catálogo y de 5 muestras; solo se dan mínimo/máximo donde se vieron varios importes.
- [ ] Los precios de Bogavante Canadá (2025) y Cola rape G (2025) son de lotes de diciembre 2025/julio 2025 y pueden estar desfasados.

## LICORES Y DISTRIBUCIONES BELLOD, S.L. (B03141165)
- [ ] La base marcaba 'bebidas' pero casi todo lo facturado es alimentación (marchapán, espárragos, patatas fritas); solo hay 2 líneas de vino (R489). Se ha puesto 'alimentacion-general'.
- [ ] Unidades por caja deducidas de CAJAS y CANTD (50 ÷ 2 = 25; 28 ÷ 2 = 14; 24 ÷ 2 = 12), no impresas como tal.
- [ ] El significado de la columna 'Gº' no consta (en las muestras está vacía); podría ser graduación o grupo.
- [ ] IVA 21 % del vino deducido de la suma de R489 (137,40 × 1,21 + 41,60 = 207,85), no leído directamente (esa factura solo está en el catálogo de líneas).
- [ ] R333/R855: el nombre exacto de la marca de espárrago está cortado ('EL NAVAR…'); en R333 se ve 'EL NAVARRICO'.

## HERMANOS NAREJOS S.L. (B03191350)
- [ ] Solo hay 1 PDF digital (R1307) y 4 escaneos de muestra: el catálogo son los 8 artículos vistos; 23 escaneos más no se han estudiado.
- [ ] Los precios mínimo/máximo salen solo de las muestras y de las líneas de R1307, no de todos los PDF.
- [ ] La cantidad se da por kg por el cuadre (p. ej. 62,20 × 72,00 = 4.478,40) y por los decimales; mejillón con cantidades enteras (10, 12, 20) a 4-4,50 también cuadra como kg, pero no se ha visto ninguna unidad escrita en el papel.
- [ ] Mejillón: en todas las muestras es mejillón gallego vivo a granel (Mytilus galloprovincialis); no aparece conserva ni docena.
- [ ] Carabinero a 26,10 €/kg y rape a 10,00 €/kg son precios bajos: podrían ser congelado o piezas pequeñas; la factura no lo dice.
- [ ] Descuento por línea: la columna existe pero está vacía en las 4 muestras.

## COMERCIAL TABARCA, S.L. (B03286184)
- [ ] El proveedor venía sin nombre en la base; el nombre sale del pie de las facturas: 'CIF B03286184 - COMERCIAL TABARCA, S.L.' (Polígono Pla de la Vallonga, Alicante).
- [ ] Cantidad vs precio en la columna Unid. 'CJ': confirmado con importes que en Vichy (0,30 L*24) y Puleva la cantidad son botellas/briks y el precio es por unidad (48 × 0,814 = 39,07; 36 × 1,51 = 54,36). En Schweppes, Seven Up y La Casera el precio es por caja.
- [ ] Briks por caja de Puleva (1 L y 1,5 L): todas las cantidades vistas son múltiplos de 6 (12, 24, 36, 60), pero la factura no lo dice.
- [ ] Unidades por caja de Seven Up Zero 20 cl y significado de 'SR' (La Casera tinto 275): no impresos.
- [ ] El IVA de AXL 350ml y de los zumos no se ha podido comprobar contra una base de pie.
- [ ] Los precios con descuento: el precio impreso es el de tarifa y el dto 40-50 % se aplica después; el coste real por caja es precio × (1 − dto), p. ej. tónica 31,92 → 19,15.
- [ ] El catálogo incluye 25 entradas; no hay artículos fuera por tope.

## Panaderia Garcia, S.L. (B03354073)
- [ ] No se sabe cuándo cambió la maqueta: junio sale antigua y agosto/septiembre nueva
- [ ] En la maqueta antigua los totales no muestran claramente el % de IVA (aparece '4%' y una etiqueta '10%'); el cálculo confirma 4%
- [ ] Las líneas de 1/2 kilo y 1 kilo nunca han tenido cantidad en las muestras; no se sabe si se facturarán algún día
- [ ] Facturas observadas: enero, abril, junio, agosto y septiembre; el resto de meses (9 PDF en total) no está en las muestras

## CONGELADOS EL MILITAR, S.L. (B03409315)
- [ ] Ficha basada en 5 PDF de muestra (12 en total); el catálogo sale de las 20 líneas del catalogo_lineas.txt.
- [ ] VIEIRA CARNE 30/40 X1: la factura la cuenta en UN (10 UN a 20,00 €); se asume bolsa de 1 kg pero no está explícito.
- [ ] TORT. CAMARON y ROLLITO: la columna Cajas es igual a las unidades (60 cajas = 60 UN) y el precio es por unidad (1,00 €), aunque el nombre dice 30 UNI / 25 UND por caja. No está claro si 'Cajas' son realmente cajas.
- [ ] COLAS ALISTAO: no se sabe de qué especie son las colas; se deja la familia genérica.
- [ ] CAL.LIMPIO 10/20 X1 figura en UN con precio 8,00 (parece precio por kg/bolsa de 1 kg).
- [ ] El IVA del REVUELTO SETAS (4 %) es el impreso en la factura; el resto de líneas va al 10 %.
- [ ] El recargo de equivalencia aparece como % en el pie pero no entra en el total.

## CONGELADOS PINTO, S.L. (B03680253)
- [ ] La letra X (IVA) en CANELON AUDENS (AD220) no sale en ninguna muestra con su base en el pie: no se sabe qué tipo es.
- [ ] Burrata 5402 y mini palitos 5801: en el catálogo el Total (44,00 y 53,70) es exactamente la mitad de Cantidad × Precio (20 × 4,40 y 12 × 8,95); no hay muestra con su factura completa para saber cuál de los dos números está mal leído o si Cantidad cuenta otra cosa.
- [ ] En 'Cajas/Ud.' a veces hay cajas y a veces bolsas/unidades (p. ej. 4X500: 4 bolsas = 2 kg); solo Cantidad (kg) es fiable para el cálculo.
- [ ] Las notas libres bajo la línea ('3 cajas ojo de cerdo') parecen indicar el contenido real de la caja; no se ha podido comprobar.
- [ ] El catálogo (70 líneas digitales) cubre 39 PDF; todos los artículos distintos caben en la lista (menos de 120). Precios con un único valor visto por artículo: no hay variación observada en el año.
- [ ] Tarifa por kg: 'unidades_por_bulto' y 'contenido' se han sacado del texto NxM de la descripción; en artículos a peso variable (carrilladas, cabecero, secreto, chocos) no se imprime peso de caja.

## Exclusivas Uriarte, S.L. (B03821576)
- [ ] 17 de 18 PDF son escaneos y solo se han leído 4 (R33, R564, R1174, R1556): el catálogo es muy corto y probablemente incompleto.
- [ ] La disposición exacta de las cifras bajo Cajas/U.C/Uds/Kilos en el arroz (8 | 8,00 | 16,00) no está del todo clara en el escaneo; el cuadre solo funciona con Kilos 16 × 8,20 = 131,20.
- [ ] Las dos últimas filas (trompeta y Bosque de Matasnos) salen del catálogo digital R1138, no de las muestras; su IVA y el formato de la botella (75 cl) no se ven: se deducen.
- [ ] La ventresca no indica el peso de la lata ('N' final recortado): el 'N' podría ser 'NATURAL'.
- [ ] El arroz aparece con fecha 28/07 y 22/09 con mismo importe y mismo precio: mismo pedido repetido, no duplicado.

## CAFES JUFERNA S.L. (B03969375)
- [ ] La categoría del info.json dice 'bebidas', pero las facturas son de conservas, salsas, condimentos, pasta e infusiones; no aparece café (kilos, paquetes o cápsulas) en ninguna factura vista.
- [ ] Maíz dulce 300 g 12 uds a 12,95 es precio de pack de 12 (≈1,08 la lata); Colacao 'estuche 50 sobres 10 U/C' (20,25) y Mantequilla 100 uds (14,65) también parecen precio por caja/estuche, pero la factura no lo dice y se deduce del importe.
- [ ] Ketchup/Barbacoa Chovi '6UND' / '6 uds.': el precio 4,95/7,90 cuadra con un bote de 1,9 kg, no con la caja de 6; cantidad 1 = un bote.
- [ ] Atún RO-900: la marca del albarán varía entre MONTEY y DIAMIR para la misma referencia 31073 (se tratan como el mismo producto).
- [ ] Tomate entero 5 kg: solo se ve en la devolución (R983) y en otra factura; precio de la devolución negativo.
- [ ] Catálogo completo: 26 artículos en 8 PDF; ninguno queda fuera.

## DISTRIBUCIONES GASTRONÓMICAS NICOLÁS Y VALERO, S.R.L. (B06805246)
- [ ] El catálogo digital tiene unos 170 artículos distintos; aquí van los 120 más repetidos. Quedan fuera 23+ artículos con 1 sola aparición (sobre todo pescado/marisco fresco de una entrega, repostería y pequeños envasados), p. ej.: PUERRO CONFITADO EN ACEITE 1.85 KG; CHIMAKI ZASA (HOJA BAMBU 100 PZ) (5264); STP-CROQUETA QUISQUILLA 35g 3x1K (30689); COF-GUINDILLA REBOZADA EN TEMPURA PRECOC. 1.KG C/2 UD (13650); (C)VIB-CEBOLLAS PLATILLO FRESCAS CARAM.500 GRS.C/6U (7870); LA-REBOZUELO SILVESTRE A GRANEL C/3KG (14021); TREZ-ESFERA SALMOREJO 25MM 25U C/4U (15413); TREZ-ESFERA MELON S/ALC 25MM 35U C/4U (15410); TRA-TROCADERO INDIVID. C/12 UDS CONG (14534); TRA-GOLDROCHE INDIVID. C/15 UDS CONG (11791); (E)SO-GELCREM FRIO 500 GRS/UNIDAD (5282); (E)SO-PROMAYO 600 GRS (15391).
- [ ] veces_visto es un mínimo: el texto lateral repetido ('Inscrip.', 'Tomo', 'VALERO', etc.) pega prefijos distintos delante de la misma línea y parte el recuento (p. ej. ATUN ROJO sumaría ~55, no 38).
- [ ] No se ha podido confirmar si el cargo de 1,82 €/entrega entra en la base del 10 % o del 21 %: solo se ha deducido en R58 (dif. 10,92 = 6 × 1,82) y no se ha repetido el cálculo en las otras muestras porque la extracción de líneas está partida por texto lateral.
- [ ] En las facturas de enero no hay IVA por línea; el IVA de los artículos solo vistos en enero (iva_pct null) no está confirmado.
- [ ] Las dos facturas R127 (enero) y R1641 (septiembre) tienen la misma base al 4 % (851,82) y el mismo IVA 34,07; posible casualidad o dato repetido, no comprobado.
- [ ] En coberturas de chocolate (6192, 6189) y trufa a granel no queda claro si Cantidad son kg o unidades de 1 kg; los precios bajan de 15,99 a 11,44 (blanco) y de 18,72 a 13,40 (negro) entre enero y marzo/junio.
- [ ] Cuando el cliente aparece como 'MASIDE 2011 SLU – RESTAURANTE CASA TOMAS' no hay muestras de Touza en las 5 facturas leídas.
- [ ] Importe a veces ≠ Cantidad × Precio (setas 14084: 8 × 4,95 = 39,60 pero 37,52; esfera vermut 23,85 → 22,86): hay un descuento por unidad no impreso en esas líneas; no se ha deducido su regla.

## GARCIMAR, SL (B08057531)
- [ ] La factura no dice 'congelado'. Se deduce de ser distribuidor de congelados y de 'IQF'; confirmar con el dueño, sobre todo calamar, cerdo y gildas.
- [ ] IVA de haba baby, mini hamburguesa de langostino, base smoothie, gildas y caja porex no se pudo comprobar en las muestras (las de haba fina y cebolla sí: 4 %).
- [ ] Hay un abono (R946): calamar -10 kg / -113,37 EUR con importe negativo; el IVA del abono sigue el del producto.
- [ ] Los rangos de precio salen de las muestras y los 4 ejemplos del catálogo; el precio impreso va redondeado a 2 decimales.

## EL CAPRICHO DE LOREN, S.L. (B09707274)
- [ ] El catálogo trae el mismo producto en las 9 facturas; cantidades siempre 8,00 bandejas por albarán. No se sabe si la gilda es fresca o refrigerada.
- [ ] Precio de lista subió de 22,91 a 23,57 entre enero y abril de 2026.

## PRODUCTOS DE ALMADRABA, S.L. (B11545027)
- [ ] No se sabe si la ventresca llega fresca o congelada: la factura solo dice 'ATÚN ROJO SALVAJE' o 'ATUN ALMADRABA'.
- [ ] Dos artículos de ventresca (C015 a 48 €/kg 'salvaje máx. CA' y F015 a 35 €/kg) distintos en precio; no se sabe si es calidad o tipo de pesca.
- [ ] Con tantos pocos PDF (7), el rango de precios es solo de dos precios fijos.

## EXCLUSIVAS GALICIA, S.L. (B30055404)
- [ ] Solo 6 escaneos de muestra; los nombres salen truncados por la columna y no se puede ver el nombre completo (p. ej. 'COOK1250N BASE NEGRA OVALADO ... PA…', 'TAPA PP ... F…').
- [ ] Subida de precios entre enero/febrero y septiembre en envases PP: COOK1250N 0,1456 → 0,1689, tapa 0,1491 → 0,1730, COOK400N 0,0702 → 0,0814, tapa 0,0716 → 0,0831 (≈ +16 %). No consta motivo.
- [ ] El orden de numeración no coincide con el de las fechas en septiembre: FV26/9763 (02/09/2026) y FV26/9795 (02/09/2026) son del mismo día.
- [ ] Bayetas: Uds/Caja (20 o 10) se ha interpretado como bayetas del rollo; el nombre dice ROLLO pero la cantidad se factura por bayeta suelta.
- [ ] El archivo catalogo_lineas.txt está vacío (proveedor sin PDF digitales); el catálogo sale solo de las 6 muestras.

## DISTRIBUIDORAS DE BODEGAS, S.L. (D.I.B.O.S.) (B30224109)
- [ ] Botellas por caja deducidas de Bultos/Cantidad (Godeval 6, Gramona 6, Balbás 4); la descripción no lo dice.
- [ ] Godeval: se regala 1 botella por cada 2 pagadas (24+12, 12+6); no se sabe si es regla fija.
- [ ] Solo 4 muestras vistas de 7 PDF (3 digitales + 1 escaneo); 3 escaneos más sin ver, pueden traer otros vinos.
- [ ] Se asume que el número de factura es el de 4 cifras y que '1/2026' es serie/ejercicio.

## CORPORACIÓN DIPER (Exclusivas Diper, S.L.) (B30321574)
- [ ] El nombre del listado era 'CORPORACIÓN DIPER' y las facturas imprimen 'Exclusivas Diper, S.L.' en el texto vertical del Registro Mercantil: se asume la misma empresa.
- [ ] Los envases de pomodoraccino, tomate seco, cracker, quesillo, aceite de trufa y salsas no indican contenido; los 'unidades_por_bulto' (4, 2, 12, 6) se deducen de las columnas BTS/UDS de las líneas y no de una etiqueta.
- [ ] No consta si las lasañas, focaccia, croquetas, calamar y Q. cabra son congelados o refrigerados.
- [ ] Para algunas líneas con una sola cifra entre PRECIO y NETO no se distingue BONIF de DTO a simple vista; solo el NETO lo confirma.
- [ ] Ejemplos de precio con fecha solo en las líneas de las 5 muestras; el resto de rangos vienen del catálogo anual de 9 PDF.

## FRUTOS SECOS EL LLANO, S.L. (B30341598)
- [ ] En los PDF digitales el texto no incluye número de factura ni fecha de factura (solo albarán y su fecha); el escaneo R878 sí los muestra (13685/25, 10/06/26). El sufijo /25 del número en un documento de 2026 es sospechoso pero se lee así.
- [ ] Las bayas de goji se anuncian de 900 g pero la columna Kg indica 1,00 y el precio 9,15: no queda claro si el precio es por bolsa o por kg.
- [ ] El 'Jake Mini Max' no tiene código de lote en la línea vista; la ficha no confirma su IVA más allá del 10 % impreso.
- [ ] Un 'Fini Mix' de 12 kg cuenta 1 bulto y no 12 bolsas: la cantidad real de bolsas se deduce del 'B/ 1 KG' y del Kg 12,00.

## PRODUCTOS CONTINENTAL, S.L. (Cafés Salzillo) (B30444285)
- [ ] El nombre social del proveedor no figura en el listado inicial ('sin nombre'); sale de las facturas: PRODUCTOS CONTINENTAL, S.L., con marca Cafés Salzillo (salzillo@cafes-salzillo.es).
- [ ] No consta si el café Barrocco/Esmeralda es en grano o molido.
- [ ] Se interpreta 'Und' como una lata, tubo o caja entera según el nombre del artículo; la factura no dice cuántas unidades trae cada una más allá de la descripción.
- [ ] Las líneas a 0 € (tazas 510C/511C/510B, taza mug 496, mercancía en depósito 999000004, visita comercial 1010500) no se incluyen en el catálogo de productos.

## CONFITERÍA CERVIÑO, S.L. (B32106940)
- [ ] Qué significan 'Agt.' y la segunda cifra de 'Página' en la cabecera: se ha deducido que el número es 26/0000nnn y que la página es 1
- [ ] Boquillas, azúcar de coco, queso semicurado y ravioli de verduritas solo salen en PDF sin texto de muestra: sin fecha, sin ejemplos de precio
- [ ] Si BOMBAS y BOMBAS CON CREMA son artículos distintos (mismo código 123 y mismo precio)
- [ ] Qué producto exacto es una 'caña' (hojaldre relleno o de masa): la factura no lo dice; el precio por unidad es 0,48 €

## Aceites Crevillente, S.L. (B53012969)
- [ ] La factura no dice el tamaño de envase del refinado; se supone garrafa de 25 L porque las cantidades son múltiplos de 25 y el oleico lo indica en el nombre (25L).
- [ ] El código impreso en la plantilla antigua (107, 102) y en ClassicGes (4, 3) son códigos distintos para el mismo aceite; solo se han visto estos dos productos en todo el año.
- [ ] Sin muestra de las facturas de febrero, marzo, mayo, julio y agosto (solo catálogo de líneas): puede haber otros formatos de plantilla.

## EXCLUSIVAS DIALSE, S.L. (B53166138)
- [ ] Anchoa Hansa, ventresca, boquerones y conservas de tomate: la descripción da cajas de N y el peso/volumen del envase, pero no dice si es lata, tarro o bote; envase queda null salvo en Salmorreta (tarro) y Fondo de pescado (lata). En la anchoa ni siquiera se sabe el contenido por unidad.
- [ ] IVA no comprobado (iva_pct null) en ventresca, tomate seco, tomate asado leña, lomo mitades Frimancha, jamón y queso de untar porque salen solo en facturas no muestreadas; se deja por no inventar.
- [ ] Queso de untar OLD-1684485: el prefijo OLD- parece un código descatalogado; solo una aparición.
- [ ] En R671 hay líneas de lomo con kilos pero sin precio ni importe (la original y su anulación) y textos 'DIF PRECIO ALB…'; comprobado que el bruto 595,79 sale sumando solo las filas con importe (31,07+124,74+42,03+104,04+31,57+26,57+173,40+62,37).
- [ ] Fondo de Montaña solo visto una vez (R172).

## DISTRIBUCIONES DE BEBIDAS CATRAL, S.L. (B53167433)
- [ ] veces_visto son recuentos aproximados sobre las 5 muestras (cerca de 5 hojas cada una); el proveedor tiene 22 PDF y no hay PDF digitales, así que el catálogo sale solo de las muestras: puede haber artículos que no aparecen (p. ej. Paulaner, Guinness, Desperados, Ladrón de Manzanas, cuyos logos salen en el membrete)
- [ ] '1/3' se interpreta como tercio (33 cl) y '1/4' como 25 cl; la factura no escribe el contenido en cl
- [ ] Significado exacto de N.R./NR (no retornable), B.R./RECUP. (retornable/recuperable), E.R. (¿envase retornable?) y L.N (long neck) deducido por el contexto: los artículos con ENVASE aparte (Heineken LN, Amstel) son retornables; para Amstel Oro 0%, Radler y El Águila no se vio línea de envase propia
- [ ] 'ESP. SK' en los barriles Cruzcampo: no se sabe qué significa SK (sistema de conexión / tipo de barril)
- [ ] 'DAVID' en ENVASE BARRIL 20 L: tipo o marca del casco, sin confirmar
- [ ] Qué es exactamente 'PLASTICO HEINEKEN 1/3 L.N' (caja o separadores de plástico): solo aparece una vez, con −8 uds a 1,54
- [ ] Los descuentos -D por unidad varían por artículo y se infirieron de las muestras; neto_por_ud es precio lista menos ese descuento y no figura impreso
- [ ] Rappel A00047: la factura trae líneas con código 0 y precio 0,00 y un texto cortado ('… DEL 3ER T. 2026 - A…'); se entiende que es el rappel del 3.er trimestre pero el texto no se lee entero. El PDF incluye una transferencia bancaria de Catral a Maside por 519,49 € (pago del abono)
- [ ] Línea anómala en R664 hoja 2/2: 6 barriles El Águila 20 L con descuento 'BARRIL CRUZCAMPO 20 L' ×6 a 53,16 en lugar del 45,90 de El Águila; los totales impresos cuadran con lo impreso
- [ ] En las hojas intermedias el pie está vacío y 'SUMA ANTERIOR' solo salió impresa en R162 y R664; en R311 y R1603 no se vio
- [ ] Solo se han visto facturas a Casa Tomás (cliente 03393, ruta MMR1); no hay evidencia de Touza con este proveedor

## SUMINISTROS HOSTELEROS ALTAMIRA, S. L. (B53363974)
- [ ] El catálogo digital tiene unos 150 artículos distintos; se han recogido 117 (todos los repetidos y la mayoría de los sueltos). Quedan fuera unos 30 artículos de una sola aparición (menaje y herramientas: cuchillos mondadores Arcos, tijera, soplete, zapato de seguridad, brocheta, caliche, palo aluminio, haragán, funda/bolsa portacuchillos Arcos, lavafrutas, escobilla, etc.).
- [ ] La columna 'Cant.' (1,000) coexiste a veces con 'Unidades'; con 'PALM c/10' y 20 unidades no cuadra como nº de cajas, así que se ha tratado como dato sin significado. No se ha podido comprobar qué representa.
- [ ] En estropajos (P/10U, P/12u) y paños (12u) la cantidad coincide con el tamaño del pack; se ha asumido precio por pieza suelta en estropajos (0,344 €/ud) pero el paño de vajilla 12u (7,644) parece precio por pack.
- [ ] Factura de enero (R131) con Fecha Factura 01/01/2026 pero albaranes del 08 al 28/01 y vencimiento 08/01/2026 en el pie; fecha impresa dudosa.
- [ ] IVA 10 % en capellanes, colorante, pimienta, mayonesa, tomate, té y cebolla; 4 % en leche entera Covap. Confirmar que la lectura 'IVA por línea' se respeta aunque el artículo parezca de limpieza.
- [ ] Aparece 'FACTURA RECTIFICATIVA DE A-26/0001446' como línea de texto sin importe (probable factura rectificativa posterior a R1612); su documento no está entre las muestras.

## BODEGA CAMPOLUZ, S.L. (B53375358)
- [ ] Cantidad = botellas sueltas: lo confirman los precios (Macallan 543,43 por botella; Gran Rodma 38,95-41,85 por botella de 75 cl). No se imprime ninguna caja ni nº de botellas por caja.
- [ ] El envase de los puré Monin (plástico/vidrio) no está impreso; se pone 'botella' por el precio unitario; 'LTO.' = 1 litro.
- [ ] Los Monin son 10 % de IVA (verificado en las bases de R152 y R1205); si algún día aparece un Monin al 21 % revisar.
- [ ] Hay un abono (R153) con cantidad negativa y facturas de solo gastos de devolución (R189, R526): se ven en el catálogo de líneas pero no se han podido leer en detalle como muestra.

## SUMINISTROS HOSTELEROS BENISSA, S.L.U. (B53414637)
- [ ] Solo hay 4 PDF digitales; el catálogo es pequeño (15 artículos) y los precios de las parrillas Josper subieron un 5 % entre agosto (152,00) y septiembre (159,60).
- [ ] No se sabe si el 20 % de descuento es fijo en cuchilleria Comas (aparece en R1314 y R1346, no en HQ Montblanc de R1346); se trata como dato de línea.
- [ ] Las líneas 'PRECIO ESPECIAL' sin importe indican una condición comercial pactada, no un producto; no consta su alcance.

## BODEGA SELECCIÓN VINOS CALDERÓN, S.L.U. (B53804522)
- [ ] Murrieta Reserva 2021: precio 14,25 en R654 y 18,18 en R146/R399; no se ve el motivo (promoción o bonificación).
- [ ] Magnum de Murrieta (escaneo R188): nombre y añada cortados; 36 €/botella parece bajo para un magnum, contrastar con otra factura. La segunda línea de 1,00 ud. sin precio parece regalo.
- [ ] Pazo de Barrantes Gran Vino y La Comtessa solo salen en el catálogo (sin muestra de texto): formato no confirmado. 80 €/ud. para La Comtessa es alto para 75 cl (¿magnum?); 9 unidades no son caja de 6, así que la cantidad son botellas.
- [ ] Solo 5 artículos distintos en 7 PDF; 1 de los 2 escaneos no se ha visto.

## DISTRIBUCIONES DIRECTAS 2004, S.L. (B53980611)
- [ ] El tamaño de botella solo se imprime en algunas líneas (0.70, 70cl., LITRO); en las demás (Tanqueray, Gin Mare, Brugal, Legendario, Macallan, Patrón Añejo, Don Papa, Limón Villa Massa, Orujo Café, Granadina) queda null por no estar en la factura.
- [ ] La caja se deduce de 6 botellas por caja (2 cajas = 12 UNID, 15 cajas = 90 UNID); para Gin Mare, Patrón y Granadina solo hay botellas sueltas y no se confirma.
- [ ] Los 'precios' de Tanqueray 0,0, Johnnie Walker Black y Don Papa solo aparecen como botellas bonificadas a 0,000: sin precio de compra.
- [ ] Hay productos a 3 decimales distintos entre dos facturas del mismo producto (Pacharán Berezko 11,090 compra / 11,088 abono; Sambuca 14,27 sin descuento / 14,48 con 9 % en línea).
- [ ] No se ha visto cómo se imprime un descuento distinto del 9 %.
- [ ] Descuento del 9 % en pie: se supone fijo del proveedor, pero solo se ha comprobado en 4 facturas.

## Once de Enero Artesanos del Mar (B54157011)
- [ ] Las facturas solo dicen 'FRESCO' en las cocochas de merluza. En el resto no se indica fresco/congelado/salazón; hay pistas (Luna de Mar pelada, 14X1 Pescanova, 6X2, 8x1, 'a bordo' suelen ser congelados) pero no están confirmadas, por eso van como 'no indicado'. No aparece ninguna salazón.
- [ ] Catálogo completo: 27 artículos distintos, todos incluidos. Se han unificado los códigos cortos distintos de un mismo nombre largo (ej. QPELA y QPL, CLGAM1 y CLG1) y 'ESPADA 30/50' con 'ESPADA 30/50 FAO 87 PACIFICO' (mismo código EM3-5).
- [ ] 'FTE.' (Fte. Lubina, Fte. Dorada) no se explica en las facturas.
- [ ] Cola de alistado 14X1: en R1104 aparece '3 | 3,00 | 27,90 | 83,70' (3 cajas, 3,00 y 27,90 por 83,70). Cuadra 3 x 27,90, así que la cantidad podría ser cajas/bolsas y el precio por unidad de 1 kg, no por caja de 14 kg. Sin confirmar.
- [ ] Gamba blanca 4 Italia 105/110: 8,00 x 2,00 = 16,00; el precio de 2,00 por kg parece muy bajo y puede ser un precio por pieza o un error de factura. Sin confirmar.
- [ ] Setas salteadas: 5,00 x 3,10 = 15,50 al 4 % de IVA. Se asume bolsa de 1 kg a 3,10 €/kg, pero también podrían ser 5 bolsas a 3,10 € cada una.
- [ ] Solomillo de cerdo no es pescado pero sale en el catálogo del proveedor (categoría carne).
- [ ] El nº de lote de las cocochas de R1105 ('2511220131746-2') difiere en formato de las demás; no se usa como dato fiable.

## GRANJA AVÍCOLA AVIQUES, S.L. (B54182407)
- [ ] No se sabe cómo llegan físicamente (cartones de 30 u otros): las cantidades son múltiplos de 15 docenas (15, 30, 45, 60, 75), lo que encaja con cartones de 30 huevos, pero no consta en la factura
- [ ] Fecha exacta del cambio de precio 2,50 -> 2,30: está entre el 29/04 y el 03/06 de 2026
- [ ] Significado del LOTE (parece el nº de semana del año) y por qué falta en alguna línea
- [ ] Catálogo: solo hay un artículo visto en las muestras

## CREVI-GELATS, S.L. (B54211685)
- [ ] Un único producto en todas las facturas; el precio sube de 26,42 a 28,05 en el año.
- [ ] No se sabe qué es la columna Unidades2 (vacía en todas las muestras).
- [ ] Los PDF son de una sola factura: no hay agrupación mensual.

## ARLANDIZ LLORCA, S.L. (armador 'PEPE ARMONIA'; aparece dentro de los PDF de la lonja de la Cofradía de Pescadores de Santa Pola) (B54490115)
- [ ] Las líneas son por familia taxonómica; no se sabe qué especie concreta compra Casa Tomás (p. ej. si 'Macruros' son gamba roja/langostino por su precio de 14 a 204 €/kg). Hay que preguntar al dueño o mirar los albaranes de subasta.
- [ ] Los 'veces_visto' vienen del catálogo agregado de 8 PDF (cuentan líneas de todos los armadores, no solo de ARLANDIZ LLORCA).
- [ ] Los rangos €/kg se calcularon dividiendo importe entre kilos de las muestras y 4 ejemplos del catálogo; son aproximados.
- [ ] No se ve si hay facturas de armador con otros tipos de IVA; en las 30 páginas leídas siempre es 10 %.
- [ ] El nº de página y el orden de armadores cambia de un mes a otro; no hay un orden fijo.

## Luga Sabores S.L. (B54529045)
- [ ] Los prefijos 'CG.' y 'FR.' (CG. MANGA HUEVO, CG. SECRETO, CG. HAMBURGUESA, FR. COSTILLA, FR. ENTRECOT) se interpretan como congelado/fresco; no lo dice ninguna factura.
- [ ] El cargo RGA del 21 % (1,68 €/albarán): casa con R488 (5,04 = 3 albaranes), R646 (6,72 = 4) y R995 (10,08 = 6), pero en R1642 la base 21 % es 11,53 con 6 albaranes; no se ha podido explicar la diferencia (¿otras tasas sumadas?).
- [ ] La columna 'Dto%' está en el encabezado pero no se ha visto ningún descuento por línea en las muestras ni en el catálogo.
- [ ] Natop viene en briks de 2 L; no consta cuántos hay por caja ; lo que se factura son los 24 litros de la línea de 12 briks (o 12 L si son 6).
- [ ] El tamaño real de las 'láminas de hojaldre' (0,5 kg por caja de 72 raciones) sale de la columna Kilos y puede ser un peso de referencia del proveedor.
- [ ] 62 artículos en el catálogo, todos incluidos (menos de 120); muchos se han visto solo una vez.
- [ ] En R1642 'FLOR DE ALCACHOFA' sale con lote partido en varias filas (26001000-65, 26000592-70); y 'HELADO DE JENGIBRE' con o sin asterisco inicial: es el mismo artículo (SA350).

## SERVICIOS HOSTELEROS DISBEYA, S.L. (B54968045)
- [ ] El proveedor tiene 19 PDF solo escaneados; no hay PDF digitales, así que el catálogo sale de las 5 muestras y solo de las hojas visibles (las muestras muestran como mucho las 3 últimas hojas: faltan p. ej. las hojas 1/4 de R164 y 1-2/5 de R1216 y R1601). Pueden existir artículos no vistos; veces_visto es aproximado y solo de esas hojas
- [ ] No se han visto barriles ni líneas de barril en las muestras de Disbeya (sí en Catral)
- [ ] Contenidos: la factura imprime '350 CL', '237 CL', '300 CL' y '200CL'; se interpretan como 35 cl, 23,7 cl, 30 cl y 20 cl (escala de décimas de cl del proveedor). Coincide con 'LANJARON 0'50 L' = 50 cl y 1 L
- [ ] E.R. se interpreta como envase retornable, pero los Aquarius y Fuze Tea 'E.R.' no tienen línea ENVASE propia en las muestras: no se sabe si son retornables o PET
- [ ] ZUMO PIÑA TUAREG '200CL. 24 UNID*1': no se sabe si es brik o botella de 20 cl; solo aparece una vez (Touza, R1029)
- [ ] FANTA NARANJA ZERO LATAS: no consta el contenido de la lata (se supone 33 cl, no confirmado)
- [ ] Las líneas ENVASE se detectan por el código -E, pero no se ve si en la factura aparecen para toda botella retornable: se asume que cada caja 237/350/Lanjarón retornable lleva su envase y se abona con cantidad negativa al devolverla
- [ ] Lanjarón 0,50 L en septiembre pasa a 6,12 con Dto 10 % (antes 5,31 sin Dto): precio y descuento confirmados en R1601, pero faltan datos de agosto para saber cuándo cambió
- [ ] R1029 (Touza) es la única factura de Touza en las muestras (cliente 03397, ruta MXT); el resto de la muestra es de Casa Tomás

## Francisco José Santacruz Gambín, S.L.U. (B54968961)
- [ ] Catálogo completo en 80 entradas (70 de producto y 10 de envase); no queda nada fuera. Los veces_visto salen de las líneas agrupadas del catálogo y son aproximados.
- [ ] El peso de una caja/batea/bandeja no figura en la factura: unidades_por_bulto y contenido van a null salvo cuando el nombre lo dice (bolsa 2,7 kg, caja 4 kg).
- [ ] El IVA de fruta y verdura es 4 % en todas las muestras; no se ha visto ninguna factura con otro tipo para producto.
- [ ] El nombre de la columna Envase de cada línea (QUENTAR, CAJA TURIA, BATEA PAQUITO MAR, BAND.50X30X14.5, CAJA EBRO...) indica el envase usado, pero solo los del 'Resumen envases' generan cargo; no se sabe qué envases son depósito y cuáles ya están en el precio.
- [ ] No se ha visto ninguna factura con varios albaranes; es probable que sea siempre uno por factura.
- [ ] Las muestras digitales llevan 'Att.cliente: frutasp.martin@gmail.com' y el escaneo 'info@frutaspaquitomartin.es': el membrete cambió durante el año.
- [ ] El cliente impreso es MASIDE 2011 S.L.U. (B54583356); se ha asignado a casa_tomas por el cliente del otro proveedor de la misma sociedad, no porque la factura lo diga.

## ILISAL LEVANTE, S.L.U. (Esclapez) (B54976311)
- [ ] Solo hay escaneos manuscritos: el nombre exacto de la tercera sal se lee 'fomuta/fonuta/pomuta' y no se puede confirmar.
- [ ] La abreviatura tras '25 kg' en las sal pastillas ('s/imp…') no se lee con seguridad.
- [ ] No se sabe el peso del saco de sal Tipo I ni del de 'fomuta' (solo se indica 25 kg en las pastillas).
- [ ] En R1855 el precio de la 'fomuta' parece 6,71 pero el importe (27 por 4 sacos) implica 6,75.
- [ ] El IVA 21 % en pastillas y 10 % en las otras sales sale de las muestras; se supone que las pastillas son de uso no alimentario (descalcificador/lavavajillas) pero no lo pone la factura.
- [ ] Solo 6 de 14 PDF vistos; puede haber otros productos del proveedor (sal gorda, sal para piscina, etc.).

## Racionalismo Dulce, S.L. (B54977780)
- [ ] Los sabores suben de precio a lo largo del año (p. ej. Yema quemada 24,96 a 29,52, Frambuesa 28,80 a 32,40); Cobertura negra baja de 32,40 a 31,20.
- [ ] El número entre corchetes del código de lote coincide con la cantidad en las muestras, pero no está confirmado que lo signifique.
- [ ] El formato '2400 ml' se interpreta como cubeta de 2,4 L; la factura no dice 'cubeta'.

## DISTRIBUCIONES GUTI E HIJOS, S.L. (B72748676)
- [ ] Solo escaneos: 13 PDF en el año y 6 vistos; puede haber más artículos (otros quesos, otras cecinas).
- [ ] No se sabe el peso medio de cada pieza (los kilos varían: ~1,4-1,5 kg por pieza de queso curado).
- [ ] No hay ejemplos con descuento por línea: la columna %Dto va vacía en todas las muestras.
- [ ] El IVA del pie puede tener dos filas si una factura mezcla quesos (4 %) y cecina (10 %); no se ha visto un caso.

## Salazones Garre (B73028474)
- [ ] No se ve en ninguna muestra si el bonito entero es fresco, congelado o en salazón; solo se sabe que viene de Salazones Garre con lote AA.
- [ ] Precios por kg constantes todo el año (bonito 12, maruca 42, mojama 36, mújol 70, atún rojo 120): una variación es señal de lectura errónea.
- [ ] El ejemplo de fecha del atún rojo (R691) no está entre las muestras leídas; solo se conoce de catalogo_lineas (1,480 kg × 120 = 177,60).
- [ ] El IVA 10% sale en el cuadro del pie, no por línea; solo se vio 10% en las 4 muestras.

## ZAMBU HIGIENE, S.L. (B73056269)
- [ ] No se sabe qué cuenta exactamente el primer número (bultos): en toallas es 20 paquetes por caja, en bobinas 6, pero en ambientador sale 6 bultos con 6 unidades. Para cuadrar solo vale Unidades × Precio.
- [ ] Toallita perfumada Luxe: 1 bulto con 5 u. a 99,00 y 1 bulto con 8 u. a 104,22; no queda claro si la unidad es la caja de 12 o un bote; el precio unitario (~100 €) sugiere caja o lote grande.
- [ ] Los '-100%' no traen precio en las líneas de dispensadores: confirmar que el importe es 0,00.
- [ ] Los precios de catálogo salen de 9 PDF digitales (varios con una sola referencia repetida); el catálogo es pequeño (10 entradas, 4 de ellas gratuitas o de servicio).

## SALVADOR PINAR JIMÉNEZ, S.L.U. (B73417701)
- [ ] No hay fruta ni verdura fresca en las muestras: la categoría fruta-verdura del info.json no coincide; no se ve bruto, tara ni neto en ninguna columna (la columna Kilos parece peso servido)
- [ ] Qué es la columna 'Promo' (siempre vacía) y qué cuenta exactamente 'unid.' en cada caja: se deduce del cociente unid./cajas (5, 10, 8, 6, 2, 5 según artículo)
- [ ] Contenido de la bolsa de la coca mini: 'Grs 20U' se ha leído como 20 piezas de 20 g por bolsa; no está confirmado
- [ ] Precio del ravioli de verduritas, azúcar de coco y queso semicurado: solo hay una muestra, sin tipo de IVA confirmado (null)
- [ ] La columna Lote a veces trae fechas (caducidad probable): sin confirmar
- [ ] Nombre de marca 'Soc Chef' escrito junto como SOCCHEF; 'EL PESEBRE' cae en la línea siguiente al queso

## VINOS Y LICORES GAMBÍN, S.L. (B73483042)
- [ ] Confirmado con la factura R200 (36 unidades × 52,25 = 1 881,00) y las demás muestras: el PRECIO es por botella/unidad, no por caja, y 'CAJA x UD' son cajas. Mismo patrón en las 24 facturas del catálogo.
- [ ] El IVA por producto no sale por línea: solo hay 21 % (Macan, Campari, anís, pacharán; el resto de alcohol se supone igual) y 10 % (agua Solán 50 cl) en las muestras. Los demás artículos van con iva_pct null o inferido (alcohol = 21).
- [ ] Precios min/max = un único precio visto por artículo (el catálogo agrupado solo da un ejemplo); si el mismo artículo cambia de precio en otras facturas no se refleja.
- [ ] 'REF'/'N/REF' en la descripción (refrigerado / no refrigerado, o referencia) no está aclarado; no cambia el formato. 'S/A' = sin alcohol (supuesto). 'RO900' = lata de 900 g aprox. (no impreso).
- [ ] Material de las botellas de agua (cristal/PET) solo consta en San Pellegrino ('CRIS' = cristal).
- [ ] Sin magnum ni formatos de 37,5 cl en las facturas vistas; todo es 70 cl, 75 cl, 1 L (más 33 cl, 50 cl, 50,5 cl y 2 L en agua).
- [ ] Catálogo completo (68 artículos < 120); ninguno queda fuera. Solo se leyeron 4 PDF; el resto de líneas viene del catálogo agrupado.

## SOKOL VIN, S.L. (B73698615)
- [ ] La trufa de verano pasa de 550 €/kg (R741, mayo) a 330 €/kg (R1437, agosto): puede ser variación estacional real; no es un error de lectura si cuadra.
- [ ] La trufa lleva IVA 4% impreso en R741 y R1437 (poco habitual): se transcribe tal cual; la melanosporum (R317) no se ha leído, su IVA se desconoce.
- [ ] El aceite con trufa lleva 4% (deducido del 6,24 sobre 156,00 en R159).
- [ ] La factura no dice si el caviar va en lata o tarro ni si el cangrejo es congelado o pasteurizado.
- [ ] Cucharas de nácar: IVA no verificado (R862 no está entre las muestras leídas).
- [ ] El catálogo completo cabe en la ficha (11 artículos); no hay artículos fuera.

## OROWINES LEVANTE, S.L. (ORO Wines) (B73903429)
- [ ] La factura no dice si Juan Gil Nácar es tinto, blanco o rosado.
- [ ] Solo escaneos (6 de 6 vistos): el único artículo es Juan Gil Nácar, siempre 4 cajas (259,20 + 54,43 = 313,63).
- [ ] Solo en R773 se regalan 4 botellas sueltas (100 % dto.); en las demás no hay bonificación.

## CIELO DE BOCA, S.L. (B73915944)
- [ ] Foie (5 | 5.00 | 39,95), buñuelos (12 | 12.00 | 18,25), croquetas (12 | 12.00 | 13,95) y donut (14 | 14.00 | 6,20): cantidad y kg son iguales, así que cantidad × precio y kg × precio dan lo mismo. Por precio parecen kg el foie (39,95 €/kg) y los buñuelos; en croquetas y donut podría ser kg o bolsa.
- [ ] Banda de manzana: la cantidad 3 con precio 13,13 puede ser 3 bandas sueltas o 3 cajas; el importe solo confirma cantidad × precio.
- [ ] No consta si la pluma ibérica y el secreto son frescos o congelados; solo la caducidad (12-24 meses) sugiere congelado.
- [ ] Los 17 productos son los que salen en las 9 facturas digitales; no queda ninguno fuera del catálogo.

## EMBAJADORES MADRID, S.L.U. (B75143214)
- [ ] La base marcaba la categoría como 'bebidas', pero TODAS las facturas son de carne (ternera, vaca, cerdo, cordero, casquería); se ha puesto 'carne'.
- [ ] El escaneo R1479 está emitido por CARNES IBÉRICAS DEL NORTE S.L. (B20691994, Astigarraga, Gipuzkoa) y no por EMBAJADORES MADRID, S.L.U. (B75143214, Mercamadrid) como las digitales: probablemente grupo/marca Embajadores, pero el CIF impreso en el pie del escaneo es otro.
- [ ] PALETILLA LECHAL: en una línea ('7 | 7.00 | 16.00 | 112.00') parece por pieza (UNIDADES = CANTIDAD); en las demás es por kg a 10,50. Es la misma pauta que cochinillo.
- [ ] Significado de 'S/C' (costillas) y '5+' (lomo bajo vacío) no consta; el código 'LOMO VACA BAJO VACIO' y 'TROZO LOMO ALTO VACIO' podrían referirse al corte 'vacío' y no al envasado.
- [ ] La segunda línea de cada artículo ('000025 | 03') se interpreta como lote/trazabilidad por su posición, pero no hay cabecera que lo confirme.
- [ ] Ejemplos con 'R806', 'R504', 'R1305', 'R1478', 'R1648' son facturas vistas solo en el catálogo de líneas; su fecha no se conoce.
- [ ] El catálogo cubre todos los artículos vistos (31 entradas); no hay artículos fuera por tope.

## CETAREA ANGELMAR S.L. (B88665229)
- [ ] El catálogo agrupa por especie y calidad; los calibres de la descripción (San Martiño, Lubina, Buey, Curuxo, Rodaballo) varían factura a factura y no se han separado como productos.
- [ ] 'Ameixa Fina' tiene 3 niveles de precio (35, 92,8, 108 €/kg) según calibre; las 7 apariciones del grupo no se pueden repartir entre ellos con el catálogo disponible.
- [ ] No se sabe qué pescado es 'Curuxo'; se deja el nombre impreso.
- [ ] Diferencia 'Lubina Galega' vs 'Lubina Galega anzuelo': el nombre solo indica que una es de anzuelo; el origen de la otra no está impreso.
- [ ] Los rangos de precio vienen de las 4 muestras y del catálogo (4 ejemplos por línea), no de las 12 facturas completas.

## Enchenta SLU (B94186988)
- [ ] Presentación del marisco: la factura nunca dice vivo, fresco, cocido ni congelado, por eso presentacion va null (solo se distingue LUBINA SALVAJE). El dueño debe confirmar cómo llegan los productos, sobre todo MEJILLÓN, PERCEBE, SANMARTIÑO y BUEY DE MAR
- [ ] La unidad de Cantidad no está impresa: se deduce de que cantidad × precio = total y del orden de precio. Kilos para casi todo; la ostra plana va en unidades (múltiplos de 12) con precio por unidad; nada se vende por docena en la factura
- [ ] REY, CORUXO y ESCARAPOTA: no se sabe a qué especie corresponden; REY a 73 €/kg parece un pescado muy caro (¿pez rey?). Confirmar
- [ ] SALMONETE sale con dos códigos (SL a 26,00 y SAL a 34,00): se dejan como dos productos hasta confirmar si son el mismo
- [ ] CABRACHO: una línea con cantidad 3.00 y precio 0,00 (R1115, regalo o abono); el mínimo 0,00 viene de ahí, el precio real ronda 33,00
- [ ] En R636 la suma de IVA por tipo (90,34 + 15,09) da 105,43 y el pie imprime 105,42: el redondeo no es estrictamente por tipo; tolerar 1 céntimo
- [ ] Los rangos de precio salen de las 5 muestras y de los ejemplos del catálogo digital; la mayoría de artículos tienen pocos datos
- [ ] El catálogo digital contiene 18 artículos, todos incluidos en la ficha; no queda ninguno fuera

## Herederos Ángel Mariño Hermo C.B. (E13781760)
- [ ] Catálogo completo: 22 filas (todos los artículos de las 15 facturas digitales); no se ha recortado nada.
- [ ] Los precios mínimo y máximo salen de las líneas únicas del catálogo y de las 4 muestras; en artículos vistos varias veces el rango real puede ser mayor y las fechas de los ejemplos son aproximadas.
- [ ] La unidad se deduce como kg por los decimales (5,80; 9,10) y por el cuadre; berberecho, erizo, ameixa y longueirón vienen con cantidades enteras (2,00; 3,00) y a 18-119 €/kg encajan como kg, pero ninguna factura escribe la unidad.
- [ ] Mejillón (Mexillon G, 2,90 €/kg): se asume vivo a granel; la factura no pone 'vivo' ni 'conserva'.
- [ ] Curuxo: no se ha podido identificar la especie.
- [ ] Centolla 'hembra 1-1.5 kg,' a 49,00 €/kg (31-12-2025) está muy por encima del resto del año (29,90-35,90): subida de Navidad, no error.
- [ ] Camarón cocido extra aparece una sola vez; es el único artículo cocido.

## BENEOLIVA, S. COOP. V.L. (F54450895)
- [ ] La cabecera dice 'Cajas Unidades' pero 27 x 9,20 = 248,40 y 3 x 14,95 = 44,85 indican que la cantidad son botellas/garrafas sueltas. Las cantidades del Capri (27, 18, 9, 18) son múltiplos de 9: ¿caja de 9 botellas? No consta en la factura.
- [ ] Las líneas OLIBEN (hasta abril) y BENEOLIVE (desde abril) comparten código y precio: se tratan como el mismo producto; las líneas 'OLIBEN' se cuentan dentro de veces_visto.
- [ ] Falta saber si 'T' en 'PICUAL T' es 'temprano'. El Virgen y el Orujo no indican si el virgen es extra.
- [ ] El CIF F54450895 no figura en el texto de las facturas digitales: se identifica por el nombre Beneoliva.

## COFRADÍA DE PESCADORES DE SANTA POLA (G03065158)
- [ ] La base de la comisión (8.677,59 en enero) debería ser el total de lo comprado ese mes en la lonja (facturas de armadores, B54490115); no se ha comprobado que coincida.
