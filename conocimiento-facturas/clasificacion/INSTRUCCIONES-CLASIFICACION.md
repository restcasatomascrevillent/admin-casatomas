# Clasificar líneas de factura en productos del catálogo y familias

Cada lote (`lotes/loteNN.json`) es una lista de textos de línea SIN clasificar:
`{ t: texto normalizado (clave), ejemplo: cómo viene impreso, proveedores: [..], unidad, precio: mediana €/ud sin IVA, n: nº de líneas, gasto: € sin IVA }`.

Tu salida: `salida/loteNN.json` = lista de ITEMS. Cada texto `t` del lote aparece EXACTAMENTE en un item.

```json
[
  { "textos": ["merluza pincho 2 3 kg", "merluza de pincho"], "producto_id": 37 },
  { "textos": ["mejillon cocido conserva lata"], "nombre": "Mejillón en conserva", "categoria_id": 18, "unidad": "lata" }
]
```

- `producto_id`: si el texto es un producto que YA está en `catalogo_actual.json` (mismo producto y presentación). Si no, `nombre` + `categoria_id` (+ `unidad` opcional: kg, l, ud, caja, botella, lata…).
- Agrupa en el MISMO item los textos que son el mismo producto (variaciones de escritura, calibres o pesos de caja que no cambian qué es).

## Nombre del producto (canónico)
- Español, mayúscula solo al principio y en nombres propios: «Merluza de pincho», «Gamba roja», «Tomate raf», «Aceite de oliva virgen extra».
- Útil para comparar precios: distingue lo que cambia el precio o el uso — fresco/congelado/en conserva/cocido («Mejillón fresco» ≠ «Mejillón en conserva»), pieza/filete/lomo, formato de bebida.
- Vinos, licores, cervezas, refrescos: marca + tipo + formato: «Marqués de Riscal Reserva 75 cl», «Estrella Galicia barril 30 l», «Coca-Cola lata 33 cl», «Agua Font Vella 1,5 l». Mismo vino en caja de 6 o botella suelta = mismo producto (la unidad la da la línea).
- No metas el proveedor, el lote, el calibre exacto ni el peso de la caja en el nombre salvo que sea parte del producto («Huevos XL»).
- Antes de inventar un nombre, busca en `catalogo_actual.json` y en `nombres_usados.txt` (nombres que ya han dado otros lotes; respeta EXACTAMENTE su escritura si es el mismo producto).

## Familias (`categoria_id`, usa siempre la más concreta)
| id | familia |
|---|---|
| 12 | Bebidas › Vinos (también cava, champán, vermut, sangría) |
| 13 | Bebidas › Cervezas |
| 14 | Bebidas › Licores y destilados |
| 15 | Bebidas › Refrescos y aguas (zumos, tónicas, gaseosas) |
| 16 | Bebidas › Café e infusiones |
| 17 | Pescado y marisco › Pescado (fresco, congelado, salazón, ahumado) |
| 18 | Pescado y marisco › Marisco (crustáceos, moluscos, cefalópodos: pulpo, calamar, sepia) |
| 19 | Carnes y embutidos › Carne (también aves) |
| 20 | Carnes y embutidos › Embutidos e ibéricos (jamón, chorizo, quesos NO) |
| 4 | Lácteos y huevos (quesos, nata, mantequilla, leche, yogur) |
| 5 | Frutas y verduras (también setas, hierbas frescas) |
| 6 | Despensa (aceite, sal, harina, arroz, legumbres, conservas vegetales, especias, salsas, azúcar) |
| 7 | Panadería y repostería (pan, bollería, postres, helados) |
| 8 | Congelados (solo si es un preparado congelado que no encaja arriba: croquetas, patatas congeladas…) |
| 9 | Limpieza y desechables (detergentes, papel, guantes, bolsas, film, envases de un uso) |
| 10 | Menaje y equipamiento (vajilla, cristalería, utensilios, maquinaria, reparaciones de equipos) |
| 11 | Servicios (portes, envases retornables y fianzas, energía, agua, gas, teléfono, alquileres, renting, gestoría, mantenimiento, residuos, comisiones, descuentos/rappels) |

Usa las fichas de proveedor (`../fichas/<CIF>.json`, ver `../fichas/RESUMEN.md`) si te ayudan a saber qué es un producto (presentación, si es conserva, formato de botella…).

Si un texto es ilegible o no se sabe qué es: `nombre` = el texto tal cual en mayúscula inicial, familia la más probable por el proveedor, y añade `"duda": "motivo"` al item.
