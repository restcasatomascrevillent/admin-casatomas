> ## ⛔ AVISO (2026-09-19): ESTE DOCUMENTO ES INCORRECTO
>
> **La tabla `historial_precios` NO fue eliminada. Existe, tiene 26 filas y sigue
> llenandose** por el trigger `trigger_historial_precios` (AFTER INSERT sobre
> `productos_factura`, solo para documentos de tipo `factura` y con
> `precio_unitario IS NOT NULL`). Verificado contra produccion.
>
> Lo unico cierto de este informe es que **nada en `src/` la lee**.
>
> La consulta de evolucion de precios del chatbot (`historial_precios_agente`)
> NO usa esta tabla, sino `productos_factura` + `facturas`, porque el trigger es
> insert-only: si alguien corrige un precio desde el panel, `historial_precios`
> queda desfasada, y ademas nunca registra albaranes.
>
> Se conserva el texto original solo como registro historico de la decision.

---

# 📊 Decisión sobre `historial_precios` - ELIMINADA

## 📅 Fecha: 2026-02-08

---

## 🗑️ **ACCIÓN TOMADA**

La tabla `historial_precios` ha sido **ELIMINADA** de la base de datos.

### **Razón:**
Toda la información necesaria ya existe en la relación entre:
- `facturas` (cabecera, proveedor, fecha)
- `productos_factura` (detalle de productos, precios)

La tabla `historial_precios` estaba causando duplicidad de datos y problemas de integridad referencial al eliminar facturas.

---

## 🔄 **NUEVA LÓGICA**

En `useFacturas.ts`, la lógica de obtención de productos se ha simplificado:

1. Se obtienen los productos directamente de `productos_factura`.
2. Se calcula el precio total por línea (`precio_unitario * cantidad` o `total`).
3. El proveedor se obtiene de la factura padre si es necesario.

---

## ✅ **BENEFICIOS**

- **Menos complejidad**: Una tabla menos que mantener.
- **Sin bloqueos**: Eliminar una factura ahora borra sus productos en cascada (si está configurado) o simplemente no hay restricciones externas.
- **Datos únicos**: Una única fuente de verdad para los precios (`productos_factura`).

---

**Estado:** Tabla eliminada y código actualizado.
