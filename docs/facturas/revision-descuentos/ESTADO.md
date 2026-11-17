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
- [x] Fase 1.A: esquema y código actual (cómo se leen y guardan descuentos, regalos, abonos).
- [x] Fase 1.B: reglas SQL sobre todas las líneas de producción (solo lectura).
- [ ] Fase 1.C: búsqueda en el texto de los originales de Drive. **Bloqueado**: falta acceso a la carpeta del panel (pedido al dueño). `read_file_content` de Drive devuelve el texto OCR del PDF: barato.
- [ ] Fase 1.D: verificación visual de los originales marcados.
- [x] Fase 1.E: informe (`INFORME.md`), versión 1 sin el cotejo con originales (apartado 7 del informe).
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
- **Fallo grave de clasificación IA (no solo descuentos)**: el producto 11 «Mostaza de cerveza Rooftop
  150 g» tiene 191 alias ajenos y 252 líneas ajenas (13.530 €: alquileres, luz, fontanería, «- 20 %
  BONIFICAC», «COMPRA MAS PAGA MENOS»…), creados desde el 08/11/2026. Causa: la categoría Servicios
  tiene id 11 y el modelo pone ese 11 en `producto_id`; `validarAsignaciones`
  (`supabase/functions/clasificar-productos/clasificacion.ts`) lo acepta porque el producto 11 existe.
- Catral: 847 de 854 líneas «DESC./DESCUENTO <producto>» casan con su producto en el mismo documento
  (similitud ≥ 0,6, línea anterior). 4 líneas de descuento de Catral están en POSITIVO (+128,52 €).
- Makro: 516 líneas de promo en la página de resumen, sin el código que las une al artículo (la ficha
  dice que el código de promo enlaza con la línea «Prec.Ud.*»): no se pueden asociar sin el original.
- Descuentos de pie como línea: Riscal «- 20 % BONIFICAC S/ base» (−17.312 €, 11 facturas), Directas
  9 % (−3.898 €), Disjover 5/10 %, Virola 20 %, Naturcid 10 %.
- Regalos: 607 líneas a 0 € con cantidad; solo 101 marcadas `descuento_pct = 100`. La mayoría son
  botellas bonificadas reales (Directas, Tabarca, Guillén, Hisumer, DIBOS, Calderón, Disjover S/C…);
  otras son notas, material promocional o servicios a 0.
- Descuento en la línea (`descuento_pct` parcial, 1.318): 1.308 guardan precio neto y cuadran; 7 no
  cuadran; 74 tienen `importe_bruto = total` pese al descuento.
- 20.046 líneas (2.611 facturas) llevan `albaran_ref`: la asociación descuento→producto debe hacerse
  dentro del mismo albarán.
- Originales: los `drive_url` (4.554) están en el Drive de la cuenta del panel, que el conector de Drive
  de Claude NO ve. Pedido al dueño que comparta la carpeta «Facturas Casa Tomás» en lectura.
