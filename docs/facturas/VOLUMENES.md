# Litros y kilos comprados (Facturas)

Migración `supabase/migrations/20261106400000_facturas_volumenes.sql` (06/11/2026).
Test: `supabase/tests/facturas_volumenes_test.sql`. Deshacer:
`supabase/rollbacks/20261106400000_facturas_volumenes_ROLLBACK.sql`.

Bebidas en el chatbot (formatos, botellas por producto, familias por categoría):
`20261113100000_chat_facturas_bebidas.sql`, test `tests/chat_facturas_bebidas_test.sql`,
rollback `rollbacks/20261113100000_chat_facturas_bebidas_ROLLBACK.sql`. Ver
[Bebidas en el chatbot](#bebidas-en-el-chatbot-20261113100000).

Responde a «¿cuántos litros de cerveza he comprado?», «¿cuántas cervezas?»,
«¿cuántos barriles?», «litros de vino tinto», «litros de aceite», «kilos de gamba»
aunque se compre en cajas, packs, barriles o botellines. Antes respondía «no hay
datos»: la cerveza se factura en cajas («HEINEKEN 1/3 LONG NET * 24») o barriles,
el contenido del catálogo estaba vacío y ninguna RPC sumaba volumen.

## Dónde se usa

| Sitio | Qué |
|---|---|
| Chatbot (`chat-facturas`) | Herramienta `volumen_comprado` → RPC `volumen_comprado_agente(p_texto, p_categoria, p_desde, p_hasta, p_local, p_medida, p_limite, p_orden)`. También le llegan las familias de bebidas pedidas por `buscar_productos`, `compras_producto` o `ranking` por cantidad |
| Análisis › Explorador | Medidas **Litros** y **Kilos** (`explorar_compras` con `p_medida = 'litros' | 'kilos'`) |
| SQL | Vista `volumen_lineas` (security_invoker: la misma RLS que facturas) |

## Modelo

Dos piezas, ninguna con IA:

1. **Catálogo** (`productos_catalogo`), columnas nuevas:
   - `envase_cantidad` + `envase_unidad` (`l` o `kg`): lo que lleva **un** envase
     (botella, lata, botellín, barril, garrafa, bolsa…).
   - `envases_por_bulto`: envases por caja/pack habituales.
   - `envase_origen`: `nombre` (leído del nombre canónico), `lineas` (solo
     unidades por caja aprendidas de las líneas), `por_defecto` (vino sin formato
     en el nombre: 0,75 l), `manual` (puesto a mano; nada lo pisa).
2. **Línea**: `litros (o kilos) = cantidad × lo que lleva la unidad en que se facturó`,
   calculado al vuelo por `volumen_linea(...)`.

> **No confundir** con `productos_catalogo.contenido_cantidad/contenido_unidad`
> (migración 20261008140000): esas son el contenido de la **unidad facturada** y las
> usan las RPC de precio (€/kg, €/l). Poner ahí 0,33 l a una cerveza que se compra por
> cajas rompería el €/l. Por eso el envase va en columnas aparte.

### Cómo se rellena el catálogo (`productos_envase_recalcular`)

- Envase = lo que dice `envase_texto(nombre canónico)`: una sola cifra con unidad
  («Heineken 33 cl» 0,33 l; «Cruzcampo barril 50 l» 50 l; «Azúcar Alteza 1 kg»;
  «Agua Solán de Cabras 1,5 l»), o «Magnum» 1,5 l, «Jeroboam»/«doble magnum» 3 l,
  «litro» 1 l, «1/3» 0,33 l (tercio), «1/2» 0,5 l, «1/4» 0,25 l, «1/5» 0,2 l.
  Si hay dos cifras distintas («lata 1550 g (2500 g)») no se adivina.
- Vino (categoría Vinos) sin formato en el nombre: 0,75 l, `por_defecto` (26
  productos en la demo; la RPC lo dice en `envase_supuesto_lineas`).
- Unidades por caja = la cifra que más se repite en los textos de sus líneas
  (solo ≥ 2): «* 24», «*28», «24x33cl», «C/6», «C/6B», «C6», «C24», «c/3u»,
  «12 unidades», «35 unidades», «10UND». No cuentan los calibres («C 25/35»,
  «C60/80») ni los pesos («C/2K»).
- Se recalcula solo: trigger al crear/renombrar un producto o cambiarlo de
  categoría, y trigger por sentencia al insertar/actualizar líneas (unidades por
  caja de los productos tocados). Los triggers son SECURITY DEFINER (quien sube
  líneas no necesita permiso para editar el catálogo).

### Cómo se convierte una línea (`volumen_linea`)

Unidad de la línea normalizada con `unidad_agente`. Envase = el del catálogo; si el
producto no lo tiene, el que se lea del texto de la línea; si tampoco, el contenido
de la línea (`productos_factura.contenido_*`) cuando es l o kg. Unidades por caja =
las del texto de la línea; si no, las del catálogo.

| Unidad de la línea | Por unidad | `metodo` |
|---|---|---|
| `l`, `kg` | 1 | `unidad` |
| `caja`, `pack`, `fardo`, `jaula`, `estuche`, `cj`, `bulto`, `lote`, `display`, `retractilado` | envase × unidades por caja (`C/1B` = caja de 1) | `caja` |
| caja sin unidades pero con el total escrito y ≥ 1 («caja 10 kg», «CJ 5 K») y mayor que 2 envases del catálogo | ese total | `texto` |
| `ud`, `botella`, `botellín`, `lata`, `bote`, `brik`, `barril`, `bidón`, `garrafa`, `cubo`, `bolsa`, `tarro`, `frasco`, `tarrina`, `paquete`, `bandeja`, `saco`, `malla`, `tubo`, `pieza`… | 1 envase | `envase` |
| …pero a un precio imposible para un envase suelto: **Cervezas > 20 €/l**, **Refrescos y aguas > 15 €/l** (`volumen_max_eur_litro`) y se conocen las unidades por caja | envase × unidades por caja | `precio` |

En vinos y licores no hay tope de precio (hay botellas de 1.400 €): una «ud» es
siempre una botella.

Envases (`envases`): cajas × unidades por caja, o la cantidad si es un envase.

### Lo que NO se convierte (no suma, se cuenta aparte)

`metodo` = motivo, `medida` = null:

- `sin_contenido`: no se sabe cuánto lleva el envase (infusiones en sobres, «Anchoa x10»).
- `sin_unidades_por_caja`: caja/pack sin número de botellas en el texto ni en el catálogo
  («REFRESCO SEVEN UP ZERO RETORNABLE 200», «Juan Gil etiqueta nácar» en cajas).
- `precio_dudoso`: «ud»/«lata» con precio de caja pero sin saber cuántas lleva
  («AQUARIUS LT 33CL LIMON» a 17,59 €).
- `unidad_no_convertible`: docena, hora, servicio, metros…

La RPC devuelve `lineas_sin_convertir`, su importe, los motivos y 5 ejemplos; el
explorador, `total.lineas_sin_convertir` («N sin convertir» junto al total).
**Nunca se inventa un contenido.**

### Fuera de la cuenta

- Familias raíz **Servicios** (envases retornables, alquileres), **Limpieza y
  desechables** y **Menaje y equipamiento**.
- Albaranes ya facturados (como en el resto del panel). Las devoluciones (cantidad
  negativa) restan.
- Explorador: en Litros solo entran las líneas pasadas a litros y, como «sin
  convertir», las de Bebidas que no se pudieron pasar; en Kilos, las pasadas a kilos y
  las sin convertir de Pescado y marisco y Carnes. Litros y Kilos no admiten el filtro
  «unidad» (ya convierten). El filtro de familias del explorador es por familia raíz
  (Bebidas = 1), como siempre.

## RPC `volumen_comprado_agente`

- `p_categoria` («cerveza», «vino», «refresco», «licor»: `categoria_agente`) y/o
  `p_texto` (producto: «agua», «aceite», «gamba», «tinto»: `lineas_producto_agente`).
  Si llega solo `p_texto` y es una familia («cerveza», «vinos», «licores»…) se trata
  como categoría (si no, «cerveza» solo encontraría las líneas que dicen «cerveza»).
  Con las dos, se cruzan y `resto_categoria` da lo que queda fuera del texto (p. ej.
  vino sin «tinto» en el nombre: el catálogo no distingue tinto/blanco).
- `p_medida`: `l` / `kg`; null = la que tenga más líneas convertidas (el resto va en
  `otra_unidad`).
- `p_limite` (1-40, por defecto 12) y `p_orden` (`envases`/`botellas` = más botellas
  primero; si no, por litros).
- Devuelve `total`, `unidad`, `envases` (botellas/latas/barriles con las cajas abiertas),
  `cajas`, `importe_base` (sin IVA), `lineas_convertidas`, `lineas_sin_convertir`,
  `por_producto` (total, envases, envase «33 cl», `formato` «tercio 33 cl», `compra` = «380
  caja de 24» o «99 caja de 6, 4 botella», `proveedor` principal «… (+1)»), `productos`,
  `productos_truncado`, `por_envase` (`formato` «barril 50 l», `envase` «50 l», envases,
  total), `por_proveedor` (total, envases, productos), `por_mes`, `sin_convertir` (con
  cantidad en los ejemplos) y `nota`.

## Bebidas en el chatbot (20261113100000)

Prueba del dueño en la demo (06/11/2026, 08:43) que salió mal:

| Pregunta | Qué contestaba | Por qué |
|---|---|---|
| «¿Tenemos registros de cerveza?» (y «la bebida cerveza») | «CERVEZA EL ALCAZAR» y «MOSTAZA DE CERVEZA» | `buscar_productos` busca el **texto**: Heineken o los barriles de Cruzcampo no llevan la palabra y la mostaza (Despensa) sí |
| «¿Cuántos litros de cerveza en 2026?» | «No hay datos» | `volumen_comprado` aún no estaba desplegado (lo estuvo a las 10:04) |
| «Botellas por vino» | «Laurent-Perrier La Cuvée: 4 botellas y 99 cajas» | Sumaba la cantidad por unidad; son 598 botellas (99 × 6 + 4) |

Arreglo, sin IA y sin tocar datos:

1. **Familias por categoría** (`chat-facturas/herramientas.ts`, `familiaDeBebida`): «cerveza»,
   «los vinos», «la bebida cerveza», «licores», «refrescos», «bebidas» pedidos a
   `buscar_productos`, `compras_producto` o `ranking` por cantidad van a
   `volumen_comprado_agente` **por categoría del catálogo** (nada de comida). El resultado
   lleva `nota_ruta` explicándolo. No entran «agua», «cava» ni «champán» (como categoría
   serían todos los refrescos o todos los vinos) ni un producto concreto («mostaza de
   cerveza», «vino blanco», «heineken»).
2. **Formato con nombre** (`volumen_tipo_envase`): `barril` (texto «barril»/«keg», o cerveza
   ≥ 5 l), `lata` («lata», «LT 33CL»), `brick`, `bidón`, `garrafa`; en cerveza `tercio` 33 cl,
   `quinto` 20 cl, `botellín` 25 cl; en vino `magnum` 1,5 l, `doble magnum` 3 l, `media
   botella` 37,5 cl; si no, `botella`. Mira el producto, el texto de la línea y la unidad.
3. **Botellas por producto**: `p_orden = 'envases'` (25 productos si el modelo no dice otro
   número) y `compra` legible. El resultado de esta herramienta puede llegar a 12.000
   caracteres (30 vinos ≈ 9.200; el tope general es 6.000).
4. **Cómo contestar** va en `nota_respuesta` del resultado (solo viaja si se usa): «598
   botellas (99 cajas de 6 y 4 sueltas)», nunca «4 botellas y 99 cajas»; tipos con
   `por_envase.formato`; proveedores; líneas sin convertir. En el prompt solo hay una línea en
   HERRAMIENTAS y la regla 15 (+256 caracteres, ~65 tokens por ronda).

Cifras de la demo con la versión nueva (2026):

- Cerveza: 20.520,88 l; 192 barriles de 50 l, 176 de 20 l, 22.236 tercios, 120 botellas de
  50 cl y 12 botellines de 25 cl; 1.038 cajas; todo de Distribuciones de Bebidas Catral.
- Vino: 214 vinos, 7.709 botellas (6.006 de 75 cl, 764 magnum, 698 brick de 1 l…). Arienzo
  720 (120 cajas de 6), Laurent-Perrier La Cuvée 598 (99 cajas de 6 y 4 sueltas), Viña
  Lanzar 564 brick, Marqués de Murrieta Reserva 402.

## Cifras de la demo (06/11/2026, 2026 hasta octubre)

Cerveza: **20.520,88 l**, 459 de 459 líneas convertidas.

| Producto | Compra | Litros |
|---|---|---|
| Cruzcampo barril 50 l | 192 barriles | 9.600 |
| Heineken 33 cl | 380 cajas de 24 | 3.009,6 |
| El Águila sin filtrar barril 20 l | 90 barriles | 1.800 |
| Cruzcampo barril 20 l | 86 barriles | 1.720 |
| El Águila 33 cl | 104 cajas de 24 | 823,7 |
| Heineken 0,0 33 cl | 103 cajas de 24 | 815,8 |
| Amstel Oro 0,0 33 cl | 84 cajas de 24 | 665,3 |
| La Rubia 18/70 33 cl | 73 cajas de 24 | 578,2 |
| Cruzcampo Especial sin gluten 33 cl | 111 cajas de 12 | 439,6 |
| El Águila sin filtrar 33 cl | 65 cajas de 12 | 257,4 |
| Resto (10 productos) | cajas de 12/20/24 | 811,4 |

Por envase: 192 barriles de 50 l, 176 de 20 l, 22.236 botellines de 33 cl, 120 de
50 cl y 12 de 25 cl. Otras familias 2026: refrescos y aguas 23.550 l (457/488
líneas), vino 6.698 l (444/452), licores 1.628 l (240/240).

## Pendiente / decisiones abiertas

- Cajas sin número de botellas (Seven Up Zero 20 cl, La Casera 50 cl, Juan Gil, Montecillo,
  Grand Siècle Magnum) y latas/packs a precio de caja: poner `envases_por_bulto` a mano
  (`envase_origen = 'manual'`) o pedirlo al proveedor. No hay pantalla para editarlo.
- Una caja de vino a precio de botella («C/6 ARIENZO 0,75L» a 21,30 €) se cuenta como
  caja de 6: sin tope de precio en vinos no se puede distinguir.
- «agua», «aceite», «gamba» buscan por texto: incluyen «anchoa en aceite»,
  «croqueta de gambas»… (salen por producto en la respuesta).
