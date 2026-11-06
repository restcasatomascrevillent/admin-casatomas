# Cómo hacer la ficha de un proveedor

Carpeta base: `C:/Users/migue/Desktop/Oficiosos/codigo-restaurante/facturas-conocimiento`

1. Lee `FORMATO-FICHA.md`: es el formato EXACTO de la salida y las reglas de producto.
2. Para cada proveedor que te toque, en `fase2/<CIF>/` tienes:
   - `info.json`: nombre, categoría, nº de PDF y lista de muestras.
   - `Rxxx.txt`: texto de las muestras digitales, con las filas reconstruidas y las columnas separadas por " | ".
   - `img/Rxxx_pN.png`: páginas de las muestras escaneadas (léelas con Read).
   - `catalogo_lineas.txt`: TODAS las líneas con importe que han salido en el año en sus PDF digitales (con cuántas veces). Úsalo para el catálogo de `productos` y para los rangos de precio. Puede estar vacío si el proveedor solo manda escaneos: entonces el catálogo sale de las muestras.
3. Estudia las muestras como si tuvieras que enseñar a otra persona a leer las facturas de ese proveedor sin equivocarse:
   - qué es cada columna; si la cantidad son cajas, unidades, kilos o botellas; dónde están número y fecha;
   - descuentos por línea; cargos o descuentos en el pie (punto verde, portes, pronto pago, bonificaciones); IVA y R.E.; envases;
   - cómo cuadra la factura (comprueba con números reales de una muestra que tus `reglas_cuadre` funcionan);
   - trampas que harían fallar a un OCR.
4. Catálogo de `productos`: uno por artículo distinto (mismo artículo con otro formato = otro producto). Rellena presentación y formato siguiendo las reglas de producto. En el vino y las bebidas, deja claro si la cantidad son botellas o cajas, cuántas trae la caja y el formato de la botella (37,5 cl, 75 cl, magnum…). Precio mínimo y máximo vistos y por qué unidad. Si el catálogo tiene más de 120 artículos, quédate con los 120 más frecuentes y pon en `dudas` cuántos quedan fuera.
5. `guia_ocr`: máximo 120 palabras, en imperativo, solo lo específico de este proveedor.
6. Escribe con Write `fichas/<CIF>.json` (JSON válido, UTF-8). No inventes nada: lo que no salga de las facturas va `null` o en `dudas`.

No ejecutes código y no toques nada fuera de `fichas/`.
Al terminar responde en 3 líneas por proveedor: tipo de documento, lo más importante para leerlo bien y nº de productos del catálogo.
