# Extracción completa de facturas (con ficha de proveedor)

Carpeta base: `C:/Users/migue/Desktop/Oficiosos/codigo-restaurante/facturas-conocimiento`

Vas a pasar a JSON TODAS las facturas de un proveedor. Antes de empezar:
1. Lee la ficha del proveedor `fichas/<CIF>.json`, sobre todo `documento`, `lectura`, `reglas_cuadre`, `guia_ocr` y `productos`. Es lo que sabemos de cómo factura. Úsala, pero **manda lo que está impreso**: si una factura no encaja con la ficha, extrae lo impreso y apúntalo en `alertas`.
2. Tus documentos están en `lote1/<CIF>/`: `Rxxx.txt` (texto de los PDF digitales, con filas reconstruidas y columnas separadas por " | ") o `img/Rxxx_pN.png` (páginas de escaneos; léelas con Read). Haz SOLO los ficheros de tu lista.

Escribe un JSON por PDF en `lote1/<CIF>/salida/Rxxx.json` con Write. Si el PDF trae varias facturas (números distintos), el fichero es un ARRAY con una por factura. Las páginas de un escaneo pueden venir en orden inverso: ordénalas por «Hoja n/N» o por «Suma anterior».

## Formato (exactamente estas claves)
```json
{
  "archivo": "R47.pdf",
  "paginas_pdf": [1],                       // páginas del PDF que pertenecen a ESTA factura
  "tipo": "factura",                        // factura | albaran | abono
  "proveedor": "CASIMIRO PEREZ RODRIGUEZ",
  "cif": "46914230A",
  "local": "casa_tomas",                    // casa_tomas | touza | no_consta (según el destinatario impreso)
  "numero_documento": "1 260007",
  "fecha": "2026-01-14",                    // YYYY-MM-DD (en el papel DD/MM/AAAA)
  "productos": [
    {
      "orden": 1,
      "pagina": 1,
      "nombre": "ALMEJA FINA",              // tal cual, sin código ni lote
      "producto_ficha": "Almeja fina",      // nombre_normalizado del catálogo de la ficha si es ese artículo; null si no está
      "cantidad": 2.0,                      // lo que multiplica al precio (kg, uds, botellas, cajas… según la ficha)
      "unidad": "kg",                       // kg | l | ud | caja | botella | docena | pieza …
      "bultos": null,                       // cajas/bultos físicos si se imprimen aparte
      "contenido_cantidad": null,           // contenido de cada unidad (75 para botella de 75 cl, 25 para saco de 25 kg)
      "contenido_unidad": null,             // cl | l | kg | g | ud
      "precio_unitario": 90.0,
      "descuento_pct": null,                // % de descuento de la línea si lo hay
      "total": 180.0,                       // importe impreso de la línea (ya con descuento). Negativo en devoluciones/abonos
      "iva_pct": 10,
      "albaran_ref": "1-000377",
      "bonificada": false                   // true si es regalo / sin cargo
    }
  ],
  "cargos_pie": [ { "concepto": "Portes", "importe": 12.0, "iva_pct": 21 } ],   // lo que suma/resta en el pie y NO es línea
  "subtotal": 267.0,                        // base imponible TOTAL impresa (suma de bases si hay varias)
  "desglose_iva": [ { "base": 267.0, "pct": 10, "cuota": 26.7 } ],
  "iva": 26.7,                              // suma de cuotas de IVA
  "recargo_equivalencia": null,
  "retencion_irpf": null,
  "total": 293.7,                           // TOTAL A PAGAR impreso
  "observaciones": "forma de pago, vencimiento, avisos útiles",
  "alertas": []                             // lo que no cuadra, no se lee o no encaja con la ficha
}
```

## Reglas
- UNA entrada por cada fila impresa de producto, en orden, con sus repeticiones. Lotes, caducidades, textos legales, subtotales de albarán y «suma anterior» NO son productos.
- Envases retornables, portes y cargos que van COMO LÍNEA de la tabla → son productos (con su signo). Si van solo en el pie → `cargos_pie`.
- Números JSON con punto decimal. Respeta el formato de miles/decimales que diga la ficha.
- Nunca inventes ni «arregles» un importe: si no cuadra, se deja lo impreso y se explica en `alertas`.
- Si una página no es factura (justificante de transferencia, listado de cobros), no la extraigas; menciónala en `observaciones`.

Al terminar responde SOLO con: nº de PDF hechos, nº de facturas, y cuántas tienen alertas.
