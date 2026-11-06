# Ficha de proveedor — formato

Una ficha por proveedor en `fichas/<CIF>.json`. Sirve para dos cosas:
1. **Al leer** un escaneo nuevo del proveedor, se mete `guia_ocr` en el prompt del OCR.
2. **Después de leer**, se compara lo leído con `productos` (nombres, formato, precios) y con `reglas_cuadre`.

Todo lo que se escriba tiene que salir de las facturas de muestra. Si no se sabe, `null`; no se inventa.

```json
{
  "cif": "B54968045",
  "nombre": "SERVICIOS HOSTELEROS DISBEYA, S.L.",
  "nombres_impresos": ["DISBEYA", "SERVICIOS HOSTELEROS DISBEYA"],
  "categoria": "bebidas",
  "locales": ["casa_tomas", "touza"],
  "muestras": ["R1415.pdf", "..."],

  "documento": {
    "tipo_habitual": "factura mensual que agrupa albaranes | factura por entrega | albarán valorado | ticket",
    "varias_facturas_por_pdf": false,
    "paginas_tipicas": "1-3",
    "numero_factura": { "ejemplos": ["2026/001677"], "patron": "^2026/\\d{6}$", "donde": "casilla Nº FACTURA arriba a la izquierda" },
    "fecha": "casilla Fecha junto al número, DD/MM/AAAA",
    "albaranes": "cabecera 'ALBARAN Nº : 2026/001891 DE FECHA : 06/08/2026' antes de sus líneas"
  },

  "lectura": {
    "columnas": ["Código", "Cantidad", "Descripción", "Precio", "%IVA", "Dto", "Total neto"],
    "cantidad_es": "cajas | unidades | kg | botellas …",
    "columna_peso": null,
    "precio_es_por": "caja | ud | kg | l",
    "descuento_por_linea": { "existe": true, "columna": "Dto", "valores_habituales": [17, 20] },
    "iva_por_linea": true,
    "tipos_iva": [21],
    "recargo_equivalencia": false,
    "retencion_irpf": false,
    "envases": "líneas 'ENVASE …' con importe positivo; devoluciones con cantidad negativa",
    "cargos_y_descuentos_pie": [],
    "trampas": ["El escáner tuerce la hoja: precios y totales quedan media fila por debajo del nombre"]
  },

  "reglas_cuadre": [
    "total_linea = cantidad × precio × (1 − dto/100)",
    "base = suma de total neto de líneas",
    "total = base + IVA"
  ],

  "guia_ocr": "Texto corto (máx. 120 palabras) en imperativo para el modelo que lea un escaneo de este proveedor: qué significa cada columna, dónde están número y fecha, qué trampas tiene.",

  "productos": [
    {
      "nombre_impreso": "COCA COLA 237 CL. * 24",
      "nombre_normalizado": "Coca-Cola 23,7 cl (caja 24)",
      "familia": "refresco",
      "presentacion": "botella vidrio retornable",
      "formato": { "envase": "botella", "contenido": 23.7, "unidad_contenido": "cl", "unidades_por_bulto": 24, "bulto": "caja" },
      "unidad_factura": "caja",
      "precio": { "min": 25.66, "max": 25.66, "por": "caja", "ejemplos": [["2026-08-06", 25.66]] },
      "iva_pct": 21,
      "veces_visto": 3
    }
  ],

  "dudas": []
}
```

## Reglas de producto (lo que pidió el dueño)
- **presentacion**: distingue lo que cambia el producto. Ejemplos: mejillón *vivo/fresco* o *en conserva*; pescado *fresco* o *congelado*; carne *con hueso* o *sin hueso*; *granel* o *envasado*.
- **formato**: en bebidas y vino, separa el **envase** (botella, lata, barril, bag-in-box), su **contenido** (37,5 cl, 75 cl, magnum 150 cl, 20 L…) y **cuántas unidades trae el bulto** (caja de 6, de 12, de 24).
- **unidad_factura**: qué cuenta de verdad la columna de cantidad en ESTE proveedor (¿cajas o botellas?). Si la factura no lo dice claro, se deduce del precio (p. ej. 4,80 € no puede ser una caja de 24 de vino) y se apunta en `dudas`.
- Un mismo artículo con formatos distintos son **productos distintos** (Albariño 75 cl ≠ Albariño magnum).
