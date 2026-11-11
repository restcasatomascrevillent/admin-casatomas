import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  dominioLog,
  marcasLog,
  normalizarCompras,
  normalizarMargenes,
  pctDeMultiplicador,
  pctDeMultiplicadorPeso,
  platosBorrador,
  problemas,
  puntosDispersion,
  razon,
  resumenFiable,
} from "../margenesCarta";

// Forma del jsonb de margenes_carta (datos reales de la demo, recortados).
const RPC = {
  hoy: "2026-11-07",
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  resumen: {
    platos: { total: 3, con_datos: 2, food_cost_medio: 43.2, food_cost_mediana: 43.2, en_rojo: 1, sube_coste: 1, sin_datos: 1, revisados: 0 },
    vinos: { total: 1, con_datos: 1, multiplicador_medio: 1.37, multiplicador_mediana: 1.37, en_rojo: 1, sube_coste: 0, sin_datos: 0, revisados: 0 },
  },
  platos: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100,
      venta: 17.2727, coste: 10.95, pct: 63.39, margen: 6.32, variacion_pct: null, principal: "Percebe", principal_coste: 10.95,
      origen: "estimado", revisado: false, motivo: null, banderas: ["coste_alto"],
      ingredientes: [{ id: 1, producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g", origen: "estimado", medida: "kg", eur: 109.5, coste: 10.95 }],
    },
    {
      id: "p2", nombre: "Mejillones al vapor", categoria: "MARISCOS", precio: 9.75, unidad: "Unidad", gramos_venta: null,
      venta: 8.8636, coste: 2.25, pct: 25.38, margen: 6.61, variacion_pct: 12.5, principal: "Mejillones",
      origen: "estimado", revisado: false, banderas: ["sube_coste", "otra_desconocida"],
      ingredientes: [{ id: 2, producto_id: 211, producto: "Mejillones", cantidad: 500, unidad: "g", medida: "kg", eur: 4.5, coste: 2.25 }],
    },
    { id: "p3", nombre: "Santiaguiño gallego", categoria: "MARISCOS", precio: 22, unidad: "100 g", motivo: "No hay compras de santiaguiño", banderas: ["sin_mapear"], ingredientes: [] },
    { nombre: "sin id: se descarta" },
  ],
  vinos: [
    {
      id: "v1", nombre: "Laurent‑Perrier Millésimé", categoria: "CHAMPAGNE", precio: 110, venta: 100, producto_id: 1785,
      producto: "Laurent-Perrier Millésimé 75 cl", litros: 0.75, coste: 80.4, multiplicador: 1.37, pct: 80.4, margen: 19.6,
      banderas: ["multiplicador_bajo"],
    },
  ],
};

describe("normalizarMargenes", () => {
  it("lee el jsonb y descarta lo que no sirve", () => {
    const d = normalizarMargenes(RPC);
    expect(d.platos).toHaveLength(3);
    expect(d.platos[1].banderas).toEqual(["sube_coste"]);
    expect(d.platos[0].ingredientes[0]).toMatchObject({ productoId: 301, cantidad: 100, unidad: "g", eur: 109.5 });
    expect(d.vinos[0]).toMatchObject({ tipo: "vino", multiplicador: 1.37, productoId: 1785 });
    expect(d.resumen.platos.foodCostMediana).toBe(43.2);
  });

  it("aguanta una respuesta vacía con los umbrales por defecto", () => {
    const d = normalizarMargenes(null);
    expect(d.platos).toEqual([]);
    expect(d.config).toEqual(CONFIG_POR_DEFECTO);
  });
});

describe("razon", () => {
  const d = normalizarMargenes(RPC);
  it("plato al peso de un solo ingrediente: €/kg de compra frente a €/kg de venta sin IVA", () => {
    expect(razon(d.platos[0], d.config)).toBe("Percebes: cuesta 110 €/kg y se vende a 172,73 €/kg sin IVA → 63 % de coste.");
  });
  it("sube el coste sin subir la carta", () => {
    expect(razon(d.platos[1], d.config)).toContain("el coste ha subido un 13 % en 6 meses y la carta sigue igual");
  });
  it("sin mapear: el motivo", () => {
    expect(razon(d.platos[2], d.config)).toBe("Santiaguiño gallego: No hay compras de santiaguiño.");
  });
  it("vino: botella y multiplicador", () => {
    expect(razon(d.vinos[0], d.config)).toBe(
      "Laurent‑Perrier Millésimé: la botella cuesta 80,40 € y se vende a 100,00 € sin IVA (110,00 € en carta) → 1,37× (mínimo 2,50×).",
    );
  });
  it("vino con la tienda por debajo y comprado en otro formato", () => {
    const v = normalizarMargenes({
      ...RPC,
      vinos: [{
        id: "v2", nombre: "Godeval (Magnum)", precio: 42, venta: 38.18, coste: 33.7, multiplicador: 1.13, litros: 1.5, litros_producto: 0.75,
        formato_distinto: true, en_tienda: true, precio_tienda: 29.4, venta_tienda: 24.3, multiplicador_tienda: 0.72,
        banderas: ["formato_distinto", "multiplicador_bajo", "tienda_bajo"],
      }],
    }).vinos[0];
    expect(razon(v, { ...CONFIG_POR_DEFECTO })).toBe(
      "Godeval (Magnum): la botella cuesta 33,70 € y se vende a 38,18 € sin IVA (42,00 € en carta) → 1,13× (mínimo 2,30×); " +
        "en la tienda, a 29,40 € (24,30 € sin IVA) → 0,72× (mínimo 1,50×); coste estimado desde la botella de 75 cl.",
    );
  });
});

describe("problemas y gráfica", () => {
  const d = normalizarMargenes(RPC);
  it("solo lo que falla, primero lo que más se pasa del umbral", () => {
    const lista = problemas(d.platos, d.config);
    expect(lista.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
  it("puntos con precio y % (sin los que no tienen datos), en rojo por encima del umbral", () => {
    const puntos = puntosDispersion(d.platos, 35);
    expect(puntos).toHaveLength(2);
    expect(puntos.find((p) => p.id === "p1")?.rojo).toBe(true);
    expect(puntos.find((p) => p.id === "p2")?.rojo).toBe(false);
  });
  it("vinos sin IVA / sin IVA (20261125100000): 2,3× = 43,5 % de coste", () => {
    expect(pctDeMultiplicador(2.3)).toBeCloseTo(43.478, 2);
  });
});

describe("normalizarCompras", () => {
  it("convierte las filas en documentos para el visor", () => {
    const filas = normalizarCompras({
      filas: [
        { linea_id: 9, id: 33, fecha: "2026-10-03", proveedor: "MARISCOS X", tipo: "factura", local: "casa_tomas", total: 500, drive_url: null,
          archivo_path: "a/b.pdf", nombre_linea: "PERCEBE", cantidad: 2, unidad: "kg", importe_aportado: 220, medida: "kg", eur_base: 110, eur_ud: 110 },
        { linea_id: 10 },
      ],
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: 33, aporta: 220, archivoPath: "a/b.pdf", eurBase: 110, tipo: "factura" });
  });
});

// ─── «Por peso» (20261115410000_margenes_por_peso) ────────────────────────
const RPC_PESO = {
  ...RPC,
  config: { ...RPC.config, multiplicador_min_peso: 2 },
  peso: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100,
      venta_kg_iva: 190, venta_kg: 172.73, producto_id: 301, producto: "Percebe", compra_kg: 110, medida: "kg", lineas: 8,
      ultimo_proveedor: "CETAREA ANGELMAR S.L.", ultima_fecha: "2026-10-03", multiplicador: 1.57, pct: 63.68, banderas: ["multiplicador_bajo"],
    },
    {
      id: "pb", nombre: "Bogavante de la ría", categoria: "MARISCOS", precio: 95, unidad: "kg", gramos_venta: 1000,
      venta_kg_iva: 95, venta_kg: 86.36, producto_id: 218, producto: "Bogavante", compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [],
    },
    { id: "p3", nombre: "Santiaguiño gallego", precio: 22, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 220, venta_kg: 200,
      motivo: "No hay compras de santiaguiño", banderas: ["sin_mapear"] },
    { id: "pc", nombre: "Caviar", precio: 26, unidad: "10 g", gramos_venta: 10, venta_kg_iva: 2600, venta_kg: 2363.64, producto_id: 9,
      producto: "Caviar lata", motivo: "Las compras de «Caviar lata» no traen el peso (se compran por pieza o unidad)", banderas: ["sin_datos"] },
  ],
};

describe("Por peso", () => {
  const d = normalizarMargenes(RPC_PESO);
  it("lee la lista al peso y el umbral (por defecto ×2 si no viene)", () => {
    expect(d.peso).toHaveLength(4);
    expect(d.peso[0]).toMatchObject({ tipo: "peso", compraKg: 110, ventaKg: 172.73, ventaKgIva: 190, multiplicador: 1.57, ultimoProveedor: "CETAREA ANGELMAR S.L." });
    expect(d.config.multiplicadorMinPeso).toBe(2);
    expect(normalizarMargenes(RPC).config.multiplicadorMinPeso).toBe(2);
    expect(normalizarMargenes(RPC).peso).toEqual([]);
  });
  it("el porqué en €/kg, con el precio de carta", () => {
    expect(razon(d.peso[0], d.config)).toBe(
      "Percebes: lo compras a 110,00 €/kg y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,57, 64 % de coste.",
    );
  });
  it("sin datos: el motivo (pieza sin peso, sin compras)", () => {
    expect(razon(d.peso[3], d.config)).toBe("Caviar: Las compras de «Caviar lata» no traen el peso (se compran por pieza o unidad).");
    expect(razon(d.peso[2], d.config)).toBe("Santiaguiño gallego: No hay compras de santiaguiño.");
  });
  it("problemas: solo los que bajan del multiplicador", () => {
    expect(problemas(d.peso, d.config).map((p) => p.id)).toEqual(["p1"]);
  });
  it("la gráfica usa el precio del kilo con IVA", () => {
    const puntos = puntosDispersion(d.peso, pctDeMultiplicadorPeso(2));
    expect(puntos.map((p) => [p.id, p.precio, p.rojo])).toEqual([["p1", 190, true], ["pb", 95, false]]);
  });
  it("las cifras de arriba: peso + vinos; los platos del borrador solo si están revisados", () => {
    const r = resumenFiable(d);
    expect(r.peso).toMatchObject({ total: 4, conDatos: 2, multiplicadorMediana: 2.51, enRojo: 1, sinDatos: 2 });
    expect(r.vinos).toMatchObject({ total: 1, conDatos: 1, multiplicadorMediana: 1.37, enRojo: 1 });
    // p1 y p3 tienen gramos de venta: el borrador es solo «Mejillones al vapor».
    expect(platosBorrador(d).map((p) => p.id)).toEqual(["p2"]);
    expect(r.borrador).toEqual({ total: 1, revisados: 0, enRojoRevisados: 0 });
  });
});

describe("eje X logarítmico", () => {
  it("las marcas llegan hasta el máximo real", () => {
    expect(marcasLog(2.5, 180)).toEqual([2, 5, 10, 20, 50, 100, 200]);
    expect(marcasLog(60, 2600)).toEqual([50, 100, 200, 500, 1000, 2000, 5000]);
    expect(dominioLog([2.5, 180])).toEqual([2, 200]);
    expect(marcasLog(0, 10)).toEqual([]);
  });
});
