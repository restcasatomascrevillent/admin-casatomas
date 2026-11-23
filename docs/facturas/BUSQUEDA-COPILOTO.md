# Cómo busca el copiloto de Facturas un producto o un proveedor

Estado tras la migración `20261217100000_chat_facturas_busqueda_por_partes` (23/11/2026). Todo vive en SQL
(`supabase/migrations`); el bucle (`supabase/functions/chat-facturas`) solo decide qué herramienta llamar.

## Productos

`compras_producto`, `historial_precios`, `grafico_precio`, `variacion_precios` y `volumen_comprado` buscan las
líneas con `lineas_producto_agente(texto)`. Pasos, en orden; el primero que encuentra algo gana:

| Paso | Qué casa | Ejemplo | Se avisa |
|---|---|---|---|
| 0. Siglas | Las letras con punto de la pregunta se unen | «L.P.ROSE» = `lp rose` | no |
| 1. Texto | TODAS las palabras (por raíz) en la línea, en su producto del catálogo o en un alias | «gamba roja» | no |
| 1b. Abreviaturas | Palabras cortadas con punto y siglas del mismo proveedor y familia | «sierra cantabria» = «S.CANTABRIA» | `aproximada` |
| 2. Derivada | Aumentativos y diminutivos | gamba → gambón | `aproximada` |
| 3. Errata | Parecido por trigramas, o una letra de más, de menos, cambiada o dos bailadas | «petlaos negros» | `aproximada` |
| 4. Por partes | Ninguna línea lleva todas las palabras (`parcial_producto_agente`) | ver abajo | `aproximada` + `por_partes` |

Paso 4, por partes (solo desde `lineas_producto_agente`; la comparación de presupuestos usa la base y no lo aplica):

- **unión**: cada palabra está en la línea, en su producto del catálogo, en un alias, en el **nombre del proveedor**
  que la factura («aceite palo» = «HACIENDA EL PALO PREMIUM» de Aceites Hacienda El Palo) o es una **inicial con
  punto** («leon beyer» = «L.Beyer Gewurztraminer»).
- **familia**: la palabra que falta es una familia o un producto genérico (`terminos_agente`, nombres de
  categoría) y la línea es de esa familia («vino aalto», «cerveza alhambra»).
- **único**: la palabra que falta no existe en ningún producto y el resto señala un solo producto del catálogo.
- La **añada** pedida filtra si alguna línea la lleva; si no, se da el producto y sale en `palabras_sin_casar`.
- Si todas las palabras son el nombre de un proveedor y ninguna es un producto, no se busca producto: devuelve
  `es_proveedor` y el bucle consulta `ficha_proveedor` en la misma ronda («gasto de suministros altamira»).
- Si no se puede dar nada, `sugerencias` (y `sugerencias_detalle`, con el proveedor que lo trae): productos que
  llevan la palabra que más distingue, o que la contienen («quita grasa» → «desengrasante»). Nunca se suman;
  el panel las enseña como botones.

Nunca entran servicios (portes, reparaciones) ni las palabras excluidas.

## Proveedores

`ficha_proveedor`, `filtrar_documentos`, `albaranes_sin_factura` y el filtro `proveedor` de `compras_producto`
usan `proveedor_buscar_agente(texto)`:

| Método | Qué casa | Claro (se usa sin preguntar) |
|---|---|---|
| `exacto` | Nombre, nombre comercial o alias | sí |
| `contiene` | El texto seguido dentro del nombre | sí (el de más documentos) |
| `palabras` | Todas las palabras, enteras o empezadas, en cualquier orden y aunque falten las de en medio («suministros altamira», «marques riscal») | si es el único que las lleva así de enteras, o tiene 4 veces más documentos |
| `parecido` | Trigramas; errata = una letra cambiada, de más, de menos o dos bailadas | solo si es errata y es la única candidata |

Si no está claro, devuelve `proveedores_parecidos` para preguntar y nunca cifras de otro proveedor.
`ficha_proveedor` sin proveedor pero con un producto de ese nombre devuelve `es_producto` (el bucle consulta sus compras).

## Medición (copia de producción del 23/11/2026)

Banco generado de los productos y proveedores reales (cómo los escribiría una persona):

| Productos (3.348 consultas) | Antes | Ahora |
|---|---|---|
| Nombre del catálogo o de la factura tal cual | 99-100 % | 99-100 % |
| Dos palabras con una errata de teclado | 72 % | 97 % |
| Palabra de familia + marca («vino X», «botella X») | 46 % | 100 % |
| Vino con una añada que no está en el nombre | 8 % | 88 % |
| Total encontrado (o al menos sugerido) | 88 % (94 %) | 92 % (98 %) |

| Proveedores (2.237 consultas) | Antes | Ahora |
|---|---|---|
| Primera y última palabra del nombre | 52 % | 92 % |
| Palabra distintiva con errata | 41 % | 80 % |
| Total con acierto claro | 82 % | 92 % |

Batería del copiloto (`scripts/eval-chat-fallos.mjs --bateria --en-vivo`): sin regresiones; categoría
`busqueda_por_partes` con las conversaciones reales que fallaban (17 casos).

## Rendimiento

- `albaranes_facturados_agente` (la llaman 13 RPC en cada pregunta) va por el índice
  `productos_factura_albaran_ref_norm_idx`: de ~100 ms a ~5 ms, mismo resultado.
- Índices GIN nuevos: `productos_catalogo_raices_nombre_gin`, `productos_catalogo_palabras_nombre_gin`,
  `productos_alias_raices_texto_gin`, `productos_factura_palabras_nombre_gin`. Sin ellos cada búsqueda recorría
  entero el catálogo y los alias (en producción, en frío, 225 ms y 177 ms).
- Batería en la demo: mediana de 154 ms a 82 ms por consulta. Las preguntas que antes daban «no hay» y ahora
  pasan por la búsqueda por partes tardan 150-350 ms más.

## Pruebas

- `npm run test:chat-busqueda:db` (PGlite): funciones nuevas con los casos reales.
- `npx vitest run supabase/functions/chat-facturas`: el bucle (`proveedor-producto.test.ts`) y la forma de la batería.
- `node scripts/eval-chat-fallos.mjs --bateria --en-vivo [--categoria busqueda_por_partes]` contra la demo o producción (solo lectura).
