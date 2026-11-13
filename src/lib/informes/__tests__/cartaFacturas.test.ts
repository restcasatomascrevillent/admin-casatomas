import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { informeCartaFacturas, ultimasCompras, type ArticuloCarta, type LineaCompra } from "../fuentes/cartaFacturas";
import type { InformeTabla } from "../tabla";

const articulo = (id: string, nombre: string, categoria: string | null, extra: Partial<ArticuloCarta> = {}): ArticuloCarta => ({
  id,
  nombre,
  categoria,
  precio_eur: 30,
  activado: true,
  imagen_url: null,
  ...extra,
});

const linea = (id: number, producto_id: number, fecha: string, total: number, cantidad: number, extra: Partial<LineaCompra["facturas"]> = {}, unidad = "botella"): LineaCompra => ({
  id,
  producto_id,
  cantidad,
  unidad,
  total,
  facturas: { fecha, tipo: "factura", local: "casa_tomas", total: 100, facturado_en_id: null, ...extra },
});

describe("informes «Vinos/Platos: facturas y carta»", () => {
  it("vinos: última compra válida de su producto, «—» sin vínculo, orden por categoría y nombre", () => {
    const compras = ultimasCompras([
      linea(1, 10, "2026-09-01", 60, 6),
      linea(2, 10, "2026-10-05", 72, 6),
      // No cuentan: Touza, albarán ya facturado y abono.
      linea(3, 10, "2026-11-01", 90, 6, { local: "touza" }),
      linea(4, 10, "2026-11-02", 90, 6, { tipo: "albaran", facturado_en_id: 9 }),
      linea(5, 10, "2026-11-03", 90, 6, { total: -90 }),
      linea(6, 20, "2026-08-10", 45, 1, {}, "caja"),
    ]);
    const r = informeCartaFacturas(
      "vinos",
      {
        articulos: [
          articulo("b", "Muga Reserva", "VINOS TINTOS — RIOJA", { imagen_url: "https://x/muga.jpg" }),
          articulo("a", "Albariño", "VINOS BLANCOS — RÍAS BAIXAS", { activado: false, precio_eur: 24 }),
          articulo("c", "Arzuaga", "VINOS TINTOS — RIBERA DEL DUERO"),
          articulo("d", "Sin categoría", null),
        ],
        vinculos: [
          { articuloId: "b", productoId: 10, producto: "Muga Reserva 75 cl", orden: 0 },
          { articuloId: "a", productoId: 20, producto: "Albariño", orden: 0 },
        ],
        compras,
        margenes: new Map([["b", 2.3], ["a", null]]),
      },
      { hoy: "2026-11-11" },
    ) as InformeTabla;

    const t = r.tablas[0];
    expect(t.columnas.map((c) => c.id)).toEqual(["nombre", "categoria", "precio", "compra", "margen", "unidad", "fecha", "activo", "foto"]);
    // Margen (12/11/2026): el multiplicador de Facturas › Márgenes y el beneficio sobre la venta; sin coste, vacío.
    // 13/11/2026: el % lleva su nombre («beneficio»), para no confundirlo con el % de coste.
    expect(t.filas.find((f) => f.nombre === "Muga Reserva")).toMatchObject({ margen: "×2,30 · beneficio 57 %" });
    expect(t.filas.find((f) => f.nombre === "Albariño")).toMatchObject({ margen: null });
    expect(t.filas.map((f) => f.nombre)).toEqual(["Albariño", "Arzuaga", "Muga Reserva", "Sin categoría"]);
    expect(t.filas[0]).toMatchObject({ precio: 24, compra: 45, unidad: "caja", fecha: "10/08/2026", activo: "No", foto: "No" });
    expect(t.filas[1]).toMatchObject({ compra: null, unidad: null, fecha: null, activo: "Sí" });
    expect(t.filas[2]).toMatchObject({ precio: 30, compra: 12, unidad: "botella", fecha: "05/10/2026", foto: "Sí" });
    expect(r.descripcion).toContain("4 vinos: 3 activos, 1 con foto y 2 con compra");
    expect(r.nombreArchivo).toBe("informe-vinos-facturas-y-carta-2026-11-11");
  });

  it("platos: cuenta el ingrediente principal del escandallo (menor orden)", () => {
    const r = informeCartaFacturas(
      "platos",
      {
        articulos: [articulo("p", "Pulpo a la gallega", "Entrantes", { precio_eur: 22 })],
        vinculos: [
          { articuloId: "p", productoId: 2, producto: "Patata", orden: 1 },
          { articuloId: "p", productoId: 1, producto: "Pulpo congelado", orden: 0 },
        ],
        compras: ultimasCompras([linea(1, 1, "2026-10-20", 150, 10, {}, "kg"), linea(2, 2, "2026-10-21", 8, 10, {}, "kg")]),
      },
      { hoy: "2026-11-11" },
    ) as InformeTabla;
    expect(r.tablas[0].columnas.map((c) => c.id)).toContain("producto");
    expect(r.tablas[0].filas[0]).toMatchObject({ producto: "Pulpo congelado", precio: 22, compra: 15, unidad: "kg", fecha: "20/10/2026" });
  });

  it("platos sin escandallo: «Falta el escandallo» y la cuenta en la descripción (12/11/2026)", () => {
    const r = informeCartaFacturas(
      "platos",
      {
        articulos: [articulo("p", "Pulpo a la gallega", "Entrantes"), articulo("q", "Croquetas", "Entrantes")],
        vinculos: [{ articuloId: "p", productoId: 1, producto: "Pulpo congelado", orden: 0 }],
        compras: new Map(),
      },
      { hoy: "2026-11-11" },
    ) as InformeTabla;
    expect(r.tablas[0].filas.find((f) => f.nombre === "Croquetas")).toMatchObject({ producto: "Falta el escandallo", compra: null });
    expect(r.tablas[0].columnas.map((c) => c.id)).not.toContain("margen");
    expect(r.descripcion).toContain("a 1 le falta el escandallo");
  });
});
