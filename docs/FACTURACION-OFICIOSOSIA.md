# Facturación de OficiosOsIA

Ruta: /super-admin/gestor-gasto. El acceso sigue protegido por SuperAdminRoute.

## Pestañas y creación rápida

- Facturas emitidas: búsqueda por número, cliente o NIF, filtro de fechas,
  edición, duplicado con un nuevo número y descarga directa sin modificar
  el documento guardado.
- Nueva factura: número sugerido, datos del emisor reutilizables, selección
  de clientes guardados y módulos o paquetes en un clic.
- Módulos y paquetes: catálogo de servicios con tarifas, periodicidad e IVA
  editables, servicios personalizados y agrupación de módulos en paquetes.

El catálogo inicial usa los módulos existentes del panel y precios a cero
para que el superadmin defina sus tarifas. Los paquetes añaden sus servicios
sin duplicar conceptos ya seleccionados ni cambiar precios editados en la
factura. El catálogo se conserva dentro del documento de configuración JSON;
no requiere una migración adicional.

La detección de servicios del cliente usa su NIF y su última factura por
fecha. Recupera los conceptos recurrentes con sus precios y descuentos,
excluyendo los cargos puntuales. No deduce contratación a partir de permisos.

La sección de descuentos permite aplicar un porcentaje global y porcentajes
por concepto. El global se calcula después del descuento de cada concepto
y antes de impuestos. «Aplicar IVA» permite desactivar el impuesto completo
sin borrar los porcentajes: se recuperan al activarlo. La vista previa y el
PDF omiten la columna y el desglose de IVA cuando está desactivado.

El gestor permite editar emisor, cliente, número, fechas, instalación, licencias,
módulos, soporte, cantidades, precios, descuentos, IVA por concepto, retención,
forma de pago y observaciones. Los borradores pueden tener datos pendientes;
guardar una factura o descargarla requiere los datos fiscales básicos completos.
La descarga guarda primero la factura y genera un PDF A4 con texto vectorial,
logo, desglose de impuestos y paginación.

## Base de datos

Aplicar la migración supabase/migrations/20261003160000_facturacion_oficiososia.sql
en el proyecto Supabase antes de usar el guardado. Se puede ejecutar desde el
editor SQL del proyecto o con el flujo habitual de migraciones.

La migración crea dos tablas exclusivas de superadmin y dos RPC:

- oficiososia_facturacion_config: último borrador compartido y tarifas.
- oficiososia_facturas: documentos guardados con número único y autor.
- oficiososia_facturacion_leer: carga el borrador y el historial.
- oficiososia_facturacion_guardar: guarda de forma atómica y comprueba versiones.

Los roles anon y authenticated no tienen acceso directo de escritura. Las RPC
verifican is_super_admin(auth.uid()); las lecturas aplican RLS. Dos editores no
pueden sobrescribirse silenciosamente: un cambio de versión produce un error.
No se modifica la contabilidad de facturas de proveedores.

## Uso

1. Completar los datos del emisor y cliente.
2. Introducir un número de factura único.
3. Editar conceptos y el periodo de servicio en su descripción u observaciones.
4. Guardar borrador para conservar la edición o guardar factura para archivarla.
5. Descargar PDF. También se puede abrir y actualizar una factura guardada.

Nueva factura conserva los datos del emisor y limpia el cliente y los importes.
Cada línea factura las unidades indicadas. La periodicidad no multiplica su
importe; para servicios anuales se introduce el precio anual.

Costes usa la cuota recurrente del último borrador guardado, sin impuestos y
con descuentos. Excluye importes puntuales y divide los anuales entre doce.
Sin una configuración guardada, el margen muestra «sin datos».

## Diseño y límites

El logo procede del encabezado del PDF aportado por el usuario. El diseño usa
negro, amarillo y papel claro. No se inventan NIF, dirección fiscal ni IBAN.
El editor limita a 100 conceptos por documento. No envía facturas ni cobra.
El PDF es una hoja comercial; no implementa firma, registro fiscal ni
comunicación con servicios de la Administración.

### Nueva factura compacta

El editor muestra un único paso cada vez: Cliente, Servicios, Ajustes y Revisar. Se puede navegar con Anterior/Siguiente o directamente por la barra de pasos sin perder los datos. El total permanece visible; los conceptos se distribuyen en dos columnas en escritorio y ocultan tipo, periodicidad e IVA tras un desplegable. La selección de paquetes se pliega al añadir servicios. Emitir y descargar están en el paso Revisar, junto con la vista previa; pago y observaciones se editan en Ajustes (paso 3); el borrador puede guardarse desde cualquier paso.

### Facturas y borradores

La pestaña Facturas reúne las emitidas y los borradores, identificados por estado. Permite filtrar por estado, cliente/NIF/número y rango de fechas y limpiar los filtros. Los importes emitidos y en borrador se muestran por separado. Los borradores pueden continuarse o duplicarse; el PDF corresponde a facturas emitidas. Cada borrador se guarda independientemente y desaparece de la lista de pendientes al emitirse, sin eliminar otros borradores.

Aplicar `20261003181000_facturacion_borradores.sql` después de la migración inicial. Añade la tabla de borradores y la RPC v2, recupera el borrador previo y conserva acceso exclusivo del superadmin y control de versiones.

### IVA general de la factura

El catálogo y los conceptos no ofrecen IVA individual. El paso 3 permite activar/desactivar el impuesto y fijar un único porcentaje, aplicado y redondeado sobre la base total después de descuentos. Las facturas nuevas usan el 21% como valor inicial editable. Los PDF históricos sin `ivaGlobal` conservan su cálculo anterior; al editar y guardar se adopta el porcentaje general mostrado. No requiere migración adicional.
