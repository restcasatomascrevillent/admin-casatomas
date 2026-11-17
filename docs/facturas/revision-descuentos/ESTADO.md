# Revisión de descuentos, promociones y regalos · estado del trabajo

Encargo del dueño (17/11/2026): revisión completa de facturas y albaranes de compra (originales en
Drive, líneas y embeddings en Supabase) de **todo lo que tenga que ver con descuentos, promociones y
regalos**, para todos los productos:

- si la factura trae un descuento, que quede asociado al producto correcto;
- si el descuento aparece en el albarán (y no en la factura, o al revés), detectarlo y asociarlo;
- precisión máxima: que no se escape ninguno.

Reglas del encargo:

1. **Fase 1, informe**: solo lectura. No se tocan datos ni código de producto. Informe completo en
   `INFORME.md` (esta carpeta).
2. **Fase 2, correcciones**: cuando el informe esté terminado, implementar las correcciones, PR a
   `staging`, fusionar y desplegar funciones en la demo (`sfonaclosuafvlhutkon`) **sin preguntar**.
   Comprobar que Vercel publica la demo (READY).
3. Nada de reservas. Nada en producción (`haqmmdfdzzatdnrrcgez` solo se lee).
4. Si se acaba el uso, se retoma solo (tarea programada cada 2 h que despierta la sesión). Al
   terminar todo, borrar esa tarea.

## Avance

- [x] Fase 0: rama `feature/revision-descuentos`, este archivo, tarea programada de reanudación.
- [ ] Fase 1.A: esquema y código actual (cómo se leen y guardan descuentos, regalos, abonos).
- [ ] Fase 1.B: reglas SQL sobre todas las líneas de producción (solo lectura).
- [ ] Fase 1.C: búsqueda en el texto de los originales de Drive.
- [ ] Fase 1.D: verificación visual de los originales marcados.
- [ ] Fase 1.E: informe completo.
- [ ] Fase 2: correcciones, PR a staging, demo.

## Notas para retomar

(se van añadiendo)

### Hallazgos provisionales (17/11, fase 1.B en curso)

- Prod: 4.556 documentos, 30.478 líneas. 1.958 con `descuento_pct` (101 al 100 %, 1.318 parciales),
  607 líneas a 0 € con cantidad (509 sin marcar como regalo), 2.434 líneas negativas en documentos
  positivos.
- **Líneas de descuento aparte (1.191, −62.261 €)** catalogadas como productos sueltos de Servicios
  («Descuento Heineken» −17.289 €, «Descuento comercial», «Compra más paga menos» ×5 variantes…): el
  descuento NO llega al producto que descuenta → coste de producto inflado.
- Asignaciones erróneas: «Mostaza de cerveza Rooftop 150 g» recibe 26 líneas de descuento (−3.054 €,
  «- 20 % BONIFICAC S/ …», «COMPRA MAS PAGA MENOS»).
