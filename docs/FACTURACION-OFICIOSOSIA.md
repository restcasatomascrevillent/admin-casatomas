# Gestor Gasto de OficiosOsIA: recibos y control

Ruta: `/super-admin/gestor-gasto` (menú del Super Admin, grupo «Costes»). El acceso sigue protegido
por `SuperAdminRoute`.

Desde el 17/11/2026 (petición del dueño) el Gestor Gasto ya no hace facturas: hace **recibos**, sin
membrete y sin ningún dato fiscal, y tiene una pestaña para llevar el Excel de control sin abrirlo.

## Pestañas

| Pestaña | Qué es |
|---|---|
| **Recibos** | Los recibos emitidos y los borradores: búsqueda por número, cliente o mes; filtros por tipo, estado y fechas; editar, duplicar con un número nuevo, eliminar y descargar el PDF. |
| **Nuevo recibo** | El editor, en tres pasos: Datos, Conceptos y Revisar. |
| **Tarifas** | La cuota mensual fija y el catálogo de módulos y paquetes (para las licencias). |
| **Control Excel** | El estado de este cliente en el Excel de control y sus cobros y gastos, editables. Ver [CONTROL-EXCEL.md](CONTROL-EXCEL.md). |

## Recibos: qué llevan y qué no

Un recibo dice quién paga («Recibí de»), qué paga (conceptos con cantidad, precio y descuento), el
total, la forma de pago y las observaciones. Arriba, «RECIBO», el tipo, el número y la fecha.

No lleva — ni en pantalla, ni en el PDF, ni al guardar — membrete (logo, franja de marca), NIF,
dirección, email, IVA, retención ni vencimiento. Los documentos guardados de cuando eran facturas se
leen igual, pero se enseñan y se descargan como recibos (`sinDatosFiscales` en
`src/components/facturacion/modelo.ts`): su total es el importe sin impuestos. Al volver a
guardarlos quedan ya limpios. No es un documento fiscal: no sustituye a una factura.

La numeración de los recibos es propia: `R-AAAA-NNN` (las antiguas `FO-…` no cuentan).

## Dos tipos de recibo

### Licencia global

Pago único: instalación, licencias, módulos, soporte. En el paso «Conceptos» se añaden módulos o
paquetes del catálogo con un clic (con las tarifas de la pestaña «Tarifas») y cada importe se puede
cambiar en el recibo.

### Pago mensual

El pago de un mes concreto («Mes que se paga»). Lleva:

1. **La cuota fija**: el precio de «Tarifas › Cuota mensual fija». Se pone sola como primer concepto
   («Cuota mensual · noviembre de 2026»).
2. **Los gastos de ese mes que se ven en Super Admin › Servicios › Costes** (IA, hosting, dominio…):
   un concepto por servicio con coste. Es el mismo cálculo que el informe mensual de Servicios: lo
   metido a mano para ese mes manda; si no, la cuota del plan más el uso leído. Lo que cuesta 0 € no
   se añade, y lo que en Servicios «falta meter» se avisa y no entra hasta que se meta.

Los gastos se ponen solos al crear el pago mensual y al cambiar de mes, y **se modifican en su
propio bloque**, «Gastos de Servicios» (paso «Conceptos»):

- cada gasto tiene su **precio** y su **descuento (%)**, y al lado «En el recibo»: lo que de verdad
  se cobra por él;
- «**Descuento a todos (%)**» pone el mismo descuento a todos los servicios de una vez (la cuota y
  los conceptos a mano no se tocan);
- la papelera quita un gasto del recibo y «Añadir» lo vuelve a poner con su importe de Servicios;
- «Volver a traer los importes» repone los precios de Servicios conservando los descuentos.

El bloque dice cuánto suman los servicios en el recibo frente a lo que marcan en Servicios y cuánto
se descuenta. La lista «Conceptos del recibo» de debajo lleva solo la cuota y lo que se añada a
mano (que se coloca antes de los servicios). Hay además un descuento global para todo el recibo.

Para el mes en curso los importes estimados aún pueden crecer: el recibo guarda lo que había al
hacerlo (o lo que se haya editado).

## Vista previa del PDF

«Vista previa» (en cada recibo de la lista, emitido o borrador) y «Vista previa del PDF» (paso
«Revisar») enseñan el PDF tal cual, hoja a hoja, **sin guardar ni emitir nada**. De un recibo
emitido es el mismo PDF que se descarga, y se puede descargar desde ahí. De un borrador sale marcado
«BORRADOR · SIN EMITIR», aunque le falten datos (pone «pendiente»), y no se descarga: para eso hay
que emitirlo.

## Guardado

Sin cambios en la base de datos: los documentos siguen en las tablas y RPC de siempre
(`oficiososia_facturacion_config`, `oficiososia_facturas`, `oficiososia_borradores`;
`oficiososia_facturacion_leer`, `…_guardar_v2`, `…_eliminar`; migraciones `20261003160000`,
`20261003181000` y `20261003190000`), exclusivas del super admin y con control de versiones: dos
editores no se pisan en silencio. El documento JSON añade `tipo` («licencia» | «mensual»), `mes`
(«AAAA-MM»), `proveedor` en los conceptos traídos de Servicios y `cuotaMensual` en el catálogo; todo
opcional, así que no hace falta migración.

Guardar borrador admite datos pendientes; emitir o descargar exige número, cliente, mes (si es
mensual) y descripción en todos los conceptos. La descarga guarda primero el recibo y genera un PDF
A4 con texto vectorial y paginación. El editor limita a 100 conceptos por recibo. No envía recibos
ni cobra.

Servicios › Costes sigue usando, para el margen «frente a lo facturado», la cuota recurrente del
último borrador guardado (conceptos mensuales, y anuales entre doce; los puntuales no cuentan).

## Eliminar

Cada recibo y borrador tiene «Eliminar» con confirmación (diálogo integrado, no el del navegador).
La RPC comprueba super admin y versión antes de borrar.
