import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { comprasPorAnada, informeCartaFacturas, ultimasCompras, type ArticuloCarta, type LineaCompra, type VinculoCompra } from "../fuentes/cartaFacturas";
import { esSubfila, type InformeTabla } from "../tabla";

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
    expect(t.columnas.map((c) => c.id)).toEqual(["nombre", "precio", "venta", "compra", "compra_iva", "margen", "unidad", "fecha", "activo", "foto"]);
    // Margen (12/11/2026): el multiplicador de Facturas › Márgenes y el beneficio sobre la venta; sin coste, vacío.
    // 13/11/2026: el % lleva su nombre («beneficio»), para no confundirlo con el % de coste.
    expect(t.filas.find((f) => f.nombre === "Muga Reserva")).toMatchObject({ margen: "×2,30 · beneficio 57 %" });
    expect(t.filas.find((f) => f.nombre === "Albariño")).toMatchObject({ margen: null });
    expect(t.filas.map((f) => f.nombre)).toEqual(["Albariño", "Arzuaga", "Muga Reserva", "Sin categoría"]);
    expect(t.filas[0]).toMatchObject({ precio: 24, venta: 21.82, compra: 45, compra_iva: 54.45, unidad: "caja", fecha: "10/08/2026", activo: "No", foto: "No" });
    expect(t.filas[1]).toMatchObject({ compra: null, compra_iva: null, unidad: null, fecha: null, activo: "Sí" });
    expect(t.filas[2]).toMatchObject({ precio: 30, venta: 27.27, compra: 12, compra_iva: 14.52, unidad: "botella", fecha: "05/10/2026", foto: "Sí" });
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
        compras: ultimasCompras([{ ...linea(1, 1, "2026-10-20", 150, 10, {}, "kg"), iva_pct: 4 }, linea(2, 2, "2026-10-21", 8, 10, {}, "kg")]),
      },
      { hoy: "2026-11-11" },
    ) as InformeTabla;
    expect(r.tablas[0].columnas.map((c) => c.id)).toContain("producto");
    expect(r.tablas[0].filas[0]).toMatchObject({ producto: "Pulpo congelado", precio: 22, venta: 20, compra: 15, compra_iva: 15.6, unidad: "kg", fecha: "20/10/2026" });
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

  // 17/11/2026 (dueño: «hay información mal, por ejemplo Fefiñanes; si hay compra de varias añadas aunque no
  // esté en carta, añádelo»). Los datos reales: la carta dice 2024, enlazado al producto «Fefiñanes 2025»;
  // el 2023 es otro producto del catálogo, sin enlazar.
  describe("vinos con compras de varias añadas (Fefiñanes)", () => {
    const PRIMERAS = "D. PRIMERAS MARCAS, S.A.U.";
    const compra = (id: number, producto: number, nombre: string, fecha: string, total: number, cantidad: number): LineaCompra => ({
      ...linea(id, producto, fecha, total, cantidad, { proveedor: PRIMERAS }),
      nombre,
      iva_pct: 21,
    });
    const lineas = [
      compra(21499, 11130, "Fefiñanes 2023", "2025-04-30", 825, 60),
      compra(21500, 11130, "Fefiñanes 2023", "2025-04-30", 0, 12), // sin cargo: no cuenta
      compra(8921, 2332, "Fefiñanes 2025 (cód. 198068)", "2026-05-31", 837, 60),
      compra(8922, 2332, "Fefiñanes 2025 (cód. 198068), segunda línea", "2026-05-31", 0, 6),
      compra(9939, 2332, "Fefiñanes 2025 (cód. 198068)", "2026-06-30", 460.35, 33),
      compra(9940, 2332, "Fefiñanes 2025 (cód. 198068), segunda línea", "2026-06-30", 0, 3),
      compra(1, 50, "MUGA RESERVA 2021", "2026-09-01", 90, 6),
      compra(2, 60, "MACAN 2020 (ref. 145275)", "2026-03-01", 300, 6),
      compra(3, 60, "MACAN 2021 (ref. 150076)", "2026-08-01", 330, 6),
    ];
    const catalogo = [
      { id: 2332, nombre: "Fefiñanes 2025" },
      { id: 11130, nombre: "Fefiñanes 2023" },
      { id: 50, nombre: "Muga Reserva 2021" },
      { id: 60, nombre: "Macán" },
      { id: 70, nombre: "Fefiñanes III Año 2021" }, // otro vino: no se junta
    ];
    const vinculos: VinculoCompra[] = [
      { articuloId: "f", productoId: 2332, producto: "Fefiñanes 2025", orden: 0 },
      { articuloId: "fm", productoId: 2332, producto: "Fefiñanes 2025", orden: 0 },
      { articuloId: "m", productoId: 50, producto: "Muga Reserva 2021", orden: 0 },
      { articuloId: "mc", productoId: 60, producto: "Macán", orden: 0 },
    ];
    const informe = () =>
      informeCartaFacturas(
        "vinos",
        {
          articulos: [
            articulo("f", "Fefiñanes 2024", "VINOS BLANCOS — RÍAS BAIXAS", { precio_eur: 26.5, anada: 2024 }),
            articulo("fm", "Fefiñanes 2024 (Magnum)", "VINOS BLANCOS — RÍAS BAIXAS", { precio_eur: 52.2, anada: 2024 }),
            articulo("m", "Muga Reserva 2021", "VINOS TINTOS — RIOJA", { anada: 2021 }),
            articulo("mc", "Macán 2020", "VINOS TINTOS — RIOJA"),
          ],
          vinculos,
          compras: ultimasCompras(lineas),
          anadas: comprasPorAnada(vinculos, catalogo, lineas),
        },
        { hoy: "2026-11-17" },
      ) as InformeTabla;

    it("la última compra de cada añada, con su proveedor, aunque el producto no esté enlazado", () => {
      expect(comprasPorAnada(vinculos, catalogo, lineas).get("f")).toEqual([
        { anada: 2025, eurUd: 13.95, unidad: "botella", ivaPct: 21, fecha: "2026-06-30", proveedor: PRIMERAS },
        { anada: 2023, eurUd: 13.75, unidad: "botella", ivaPct: 21, fecha: "2025-04-30", proveedor: PRIMERAS },
      ]);
    });

    it("una subfila por añada comprada, diciendo si es la de la carta; la fila del vino no cambia", () => {
      const filas = informe().tablas[0].filas;
      const i = filas.findIndex((f) => f.nombre === "Fefiñanes 2024");
      expect(filas[i]).toMatchObject({ precio: 26.5, compra: 13.95, compra_iva: 16.88, fecha: "30/06/2026" });
      expect(filas.slice(i + 1, i + 3).map((f) => [esSubfila(f), f.nombre, f.compra, f.compra_iva, f.unidad, f.fecha, f.proveedor])).toEqual([
        [true, "Añada 2025 · no está en carta", 13.95, 16.88, "botella", "30/06/2026", PRIMERAS],
        [true, "Añada 2023 · no está en carta", 13.75, 16.64, "botella", "30/04/2025", PRIMERAS],
      ]);
      // Las añadas salen del nombre de la factura aunque sea un solo producto («Macán»); la de la carta se señala.
      const j = filas.findIndex((f) => f.nombre === "Macán 2020");
      expect(filas.slice(j + 1, j + 3).map((f) => f.nombre)).toEqual(["Añada 2021 · no está en carta", "Añada 2020 · la de la carta"]);
      // Una sola añada y es la de la carta: sin subfilas.
      expect(filas.filter((f) => f.vino === "Muga Reserva 2021")).toEqual([]);
    });

    it("las subfilas no cuentan como vinos y salen con el proveedor en «Compras por añada»", () => {
      const r = informe();
      expect(r.descripcion).toContain("4 vinos: 4 activos, 0 con foto y 4 con compra");
      expect(r.descripcion).toContain("De 3 vinos se enseña la compra de cada añada.");
      const t = r.tablas[1];
      expect(t.titulo).toBe("Compras por añada");
      expect(t.columnas.map((c) => c.id)).toEqual(["vino", "anada", "en_carta", "compra", "compra_iva", "unidad", "fecha", "proveedor"]);
      expect(t.filas.some(esSubfila)).toBe(false);
      expect(t.filas.filter((f) => f.vino === "Fefiñanes 2024")).toMatchObject([
        { anada: "2025", en_carta: "No", compra: 13.95, fecha: "30/06/2026", proveedor: PRIMERAS },
        { anada: "2023", en_carta: "No", compra: 13.75, fecha: "30/04/2025", proveedor: PRIMERAS },
      ]);
      expect(t.filas.filter((f) => f.vino === "Macán 2020").map((f) => [f.anada, f.en_carta])).toEqual([["2021", "No"], ["2020", "Sí"]]);
    });

    it("sin compras de otras añadas no hay segunda tabla", () => {
      const r = informeCartaFacturas(
        "vinos",
        { articulos: [articulo("m", "Muga Reserva 2021", "RIOJA")], vinculos: [vinculos[2]], compras: ultimasCompras(lineas), anadas: comprasPorAnada([vinculos[2]], catalogo, lineas) },
        { hoy: "2026-11-17" },
      ) as InformeTabla;
      expect(r.tablas).toHaveLength(1);
      expect(r.tablas[0].filas).toHaveLength(1);
    });
  });
});
