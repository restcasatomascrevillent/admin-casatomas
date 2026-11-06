# Anexo: documentos de proveedores SIN ficha (lote 6)

Sigue `INSTRUCCIONES-EXTRACCION.md` (mismo formato JSON), con estas diferencias:

1. **No hay ficha**: lee cada documento tal cual. El proveedor es quien EMITE (nunca MASIDE 2011 / Casa Tomás / Touza, CIF B54583356).
2. **Facturas de servicios** (luz, agua, gas, teléfono, alarma, SGAE, mantenimiento, reparaciones, asesoría, notaría, publicidad…): cada concepto con importe es una línea de `productos` (cantidad 1, unidad «servicio», o la que imprima: kWh, días, meses). Impuesto eléctrico, alquiler de equipos, bono social → también líneas.
3. **Alquileres**: suelen llevar **retención IRPF** → `retencion_irpf` en positivo (el validador la resta). total = base + IVA − IRPF.
4. **Documentos que NO son facturas de proveedor** (recibos o cuotas de préstamo/leasing del banco, justificantes de transferencia, extractos, avisos de dividendos, nóminas, tickets sin datos fiscales, presupuestos): NO los conviertas en factura. Escribe solo:
   `{"archivo": "Rxxx.pdf", "no_es_factura": true, "que_es": "recibo de cuota de leasing BBVA, 450,00 €, 05/03/2026"}`
   Si el documento es un **ticket simplificado** con proveedor e importe, sí es factura (tipo «factura»).
5. **Abonos/rectificativas**: tipo «abono» e importes en negativo.
6. `local`: casa_tomas / touza según el destinatario impreso; si solo pone MASIDE, «no_consta».

Al terminar responde SOLO: PDF hechos, facturas, no-facturas y cuántas con alertas.
