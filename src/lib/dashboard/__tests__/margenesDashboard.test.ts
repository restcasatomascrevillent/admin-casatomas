import { describe, expect, it } from "vitest";
import { normalizarMargenes } from "@/lib/analisis/margenesCarta";
import { normalizarAlertas } from "@/lib/facturas/alertas";
import {
  articulosFiables,
  cifraMargen,
  costeYVenta,
  cuentasMargenes,
  enlaceArticulo,
  leerArticuloEnlace,
  peoresMargenes,
  subidasQueAfectan,
  ultimaFacturaCorta,
  umbralMargen,
} from "@/lib/dashboard/margenesDashboard";

// Mismos datos que Facturas › Márgenes (MargenesCarta.test.tsx), más un plato revisado y otro sin revisar.
const DATOS = normalizarMargenes({
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, multiplicador_min_peso: 2, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  platos: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta: 17.27,
      coste: 10.95, pct: 63.39, banderas: ["coste_alto"],
      ingredientes: [{ id: 1, producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g", eur: 109.5 }],
    },
    {
      id: "p2", nombre: "Croquetas", categoria: "ENTRANTES", precio: 12, unidad: "Ración", venta: 10.9, coste: 5, pct: 45.9,
      revisado: true, banderas: ["coste_alto", "sube_coste"], variacion_pct: 18,
      ingredientes: [{ id: 2, producto_id: 500, producto: "Jamón ibérico", cantidad: 40, unidad: "g", eur: 60 }],
    },
    {
      id: "p3", nombre: "Ensaladilla", categoria: "ENTRANTES", precio: 9, unidad: "Ración", venta: 8.2, coste: 4, pct: 48,
      revisado: false, banderas: ["coste_alto"],
      ingredientes: [{ id: 3, producto_id: 600, producto: "Atún", cantidad: 50, unidad: "g", eur: 20 }],
    },
  ],
  vinos: [
    { id: "v1", nombre: "Laurent-Perrier Millésimé", categoria: "CHAMPAGNE", precio: 110, venta: 100, producto_id: 1785, producto: "LP 75 cl",
      coste: 80.4, multiplicador: 1.37, pct: 80.4, banderas: ["multiplicador_bajo"] },
    { id: "v2", nombre: "Albariño", categoria: "BLANCOS", precio: 30, venta: 27, producto_id: 1790, coste: 8, multiplicador: 3.75, pct: 30, banderas: [] },
  ],
  peso: [
    { id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta_kg: 172.73,
      producto_id: 301, compra_kg: 110, multiplicador: 1.57, pct: 63.68, banderas: ["multiplicador_bajo"] },
    { id: "p9", nombre: "Bogavante", categoria: "MARISCOS", precio: 95, unidad: "kg", gramos_venta: 1000, venta_kg: 86.36,
      producto_id: 218, compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [] },
  ],
});

const alerta = (id: string, productoId: number, variacion: number, impacto: number | null, tipo = "facturas_precio_sube") =>
  normalizarAlertas([
    { id, tipo, titulo: `Sube ${id}`, datos: { producto_id: productoId, producto: `Producto ${productoId}`, proveedor: "PROVEEDOR S.L.", variacion_pct: variacion, impacto_mes: impacto } },
  ])[0];

describe("Dashboard › Márgenes de precio: reutiliza las cuentas de Facturas › Márgenes", () => {
  it("cuentan al peso, vinos y SOLO los platos del borrador revisados (como en Facturas › Márgenes)", () => {
    const ids = articulosFiables(DATOS).map((a) => `${a.tipo}:${a.id}`);
    expect(ids).toEqual(["peso:p1", "peso:p9", "vino:v1", "vino:v2", "plato:p2"]);
  });

  it("los peores márgenes, del más alejado de su umbral al menos, sin los que están bien", () => {
    const peores = peoresMargenes(DATOS);
    // Champán ×1,37 frente a ×2,50 (82 % por debajo), percebes ×1,57 frente a ×2 (27 %), croquetas 46 % frente a 35 %.
    expect(peores.map((a) => a.nombre)).toEqual(["Laurent-Perrier Millésimé", "Percebes", "Croquetas"]);
    expect(peoresMargenes(DATOS, 1)).toHaveLength(1);
  });

  it("cifra y umbral cortos: ×1,37 / mín. ×2,50 en vinos y «coste: 46 % de lo que cobras» / máx. 35 % en platos", () => {
    const [vino, peso, plato] = peoresMargenes(DATOS);
    expect(cifraMargen(vino)).toBe("×1,37");
    expect(umbralMargen(vino, DATOS)).toBe("mín. ×2,50");
    // 13/11/2026: el % de coste es de lo que se COBRA (precio de venta sin IVA), y se dice.
    expect(cifraMargen(plato)).toBe("46 % coste sobre venta");
    expect(umbralMargen(plato, DATOS)).toBe("máx. 35 % coste sobre venta");
    expect(umbralMargen(peso, DATOS)).toBe("mín. ×2,00");
  });

  it("lo que cuesta (última factura) y a cuánto se vende, en sencillo; y de qué factura sale", () => {
    const [vino, peso] = peoresMargenes(DATOS);
    expect(costeYVenta(vino)).toBe("te cuesta 80,40 € · lo vendes a 100,00 €");
    expect(costeYVenta(peso)).toBe("el kilo te cuesta 110,00 € · lo vendes a 172,73 €");
    expect(ultimaFacturaCorta(vino)).toBeNull();
    const conFactura = normalizarMargenes({
      vinos: [{ id: "v", nombre: "Vino", coste: 12, venta: 30, multiplicador: 2.5, banderas: [],
        factura: { id: 7, fecha: "2026-11-03", proveedor: "BODEGA X", unidad_compra: "botella", precio_unidad: 12, medida: "l", eur_base: 16 } }],
    }).vinos[0];
    expect(ultimaFacturaCorta(conFactura, "2026-11-13")).toBe("Última factura: BODEGA X, 03/11 · 12,00 € la botella (16,00 €/l)");
  });

  it("cuentas de arriba: margen en rojo y coste subiendo (solo lo fiable)", () => {
    expect(cuentasMargenes(DATOS)).toEqual({ enRojo: 3, subeCoste: 1 });
  });

  it("enlace a la ficha en Facturas › Márgenes y su lectura (los «al peso» son platos)", () => {
    const [vino, peso] = peoresMargenes(DATOS);
    expect(enlaceArticulo(vino)).toBe("/facturas?tab=margenes&articulo=vino:v1");
    expect(enlaceArticulo(peso)).toBe("/facturas?tab=margenes&articulo=plato:p1");
    expect(leerArticuloEnlace("vino:v1")).toEqual({ tipo: "vino", id: "v1" });
    expect(leerArticuloEnlace("plato:a:b")).toEqual({ tipo: "plato", id: "a:b" });
    expect(leerArticuloEnlace("otro:1")).toBeNull();
    expect(leerArticuloEnlace(null)).toBeNull();
  });

  it("subidas de proveedor que tocan la carta: cruza el producto de la alerta con escandallos, botellas y «al peso»", () => {
    const alertas = [
      alerta("a1", 301, 12, 40), // percebe → Percebes (al peso y plato: una sola vez)
      alerta("a2", 600, 30, 80), // atún → Ensaladilla (borrador sin revisar: el producto sí es suyo)
      alerta("a3", 9999, 50, 500), // no está en la carta
      alerta("a4", 1785, 8, null), // botella del champán, sin € al mes: detrás
      alerta("a5", 218, 20, 90, "facturas_precio_baja"), // bajada: no cuenta
    ];
    const s = subidasQueAfectan(DATOS, alertas, 5);
    expect(s.map((x) => x.alerta.id)).toEqual(["a2", "a1", "a4"]);
    expect(s[1].articulos.map((a) => a.nombre)).toEqual(["Percebes"]);
    expect(s[0].articulos.map((a) => a.nombre)).toEqual(["Ensaladilla"]);
    expect(subidasQueAfectan(DATOS, alertas, 1)).toHaveLength(1);
    expect(subidasQueAfectan(DATOS, [])).toEqual([]);
  });
});
