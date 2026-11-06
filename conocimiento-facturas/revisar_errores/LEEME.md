# Facturas que no entraron en el ensayo de la demo (05/11/2026)

Ensayo: 1.857 facturas → 1.836 importadas (1.826 con PDF en Drive). Quedan fuera las 21 de esta carpeta.

## 14 con error (`manifest.json`, 60.045,26 €)

Esta carpeta se puede volver a importar tal cual con **Importación histórica** cuando esté el arreglo.

**Causa probable (sin confirmar con el mensaje de error):** son facturas mensuales que agrupan muchos albaranes
(Nicolás y Valero, Luga, Altamira, Beneoliva…). El disparador `trg_productos_factura_vincular_albaranes`
es FOR EACH ROW y llama a `vincular_albaranes_proveedor()` una vez por cada línea con `albaran_ref`
(~225 ms por llamada con Nicolás y Valero). Con 40-97 líneas se pasa de `statement_timeout=8s` y el insert
de líneas se cancela. En producción pasaría igual con las subidas normales del OCR en cuanto haya un año de datos.

**Arreglo propuesto:** pasar ese disparador a FOR EACH STATEMENT con tablas de transición (una llamada por
proveedor y sentencia), igual que ya hacen `trg_productos_factura_aviso_precio_*` y `..._alertas_*`.

R1265 (Tomás Nicolás Riquelme, 4 líneas, sin albaranes) no encaja en esta causa: mirarla aparte.

## 7 duplicadas (`duplicadas.json`, 8.117,15 €)

- R27, R66, R117, R1572, R1622 y R1670 ya estaban en la demo desde antes (subidas por OCR). En producción
  dependerá de lo que ya haya allí.
- R1165 (Sokol Vin, A352/26, 01/07, 91,00 €) tiene el mismo número que R988 (25/06, 95,68 €, ya importada):
  comprobar en el PDF si es un error de lectura del número o si el proveedor repitió el número.
